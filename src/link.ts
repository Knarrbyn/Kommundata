/**
 * link.ts — pipeline §5, steg 7.
 *
 * Ansvar: avgör om ett nytt extraherat steg hör till ett BEFINTLIGT ärende
 * (t.ex. ett nämndyttrande som hör ihop med en motion som redan finns i
 * databasen) eller om det är ett helt nytt ärende.
 *
 * R7 (spec §4.2, bevisat i testrigg): diarienummer är INTE en pålitlig
 * matchningsnyckel — samma sakfråga bar `2025.271 VON` i nämnden och
 * `2025.511 KS` i det slutgiltiga KF-beslutet. Det som HÅLLER genom hela
 * kedjan är paragraf-korsreferenser i `Beslutsunderlag`-listorna: varje
 * protokoll listar exakt vilken paragraf i vilken instans ärendet kom
 * ifrån (t.ex. "§225 KF", "§ 2 VON"), och det är konsekvent i alla
 * granskade fall (case-48-valmojlighet-vardig-vard.json i testriggen).
 *
 * FÖRUTSÄTTNING SOM SAKNADES INNAN DETTA STEG BYGGDES: extract.ts (§5 steg 3)
 * fångade tidigare INTE `Beslutsunderlag`-listorna alls, trots att link-
 * steget helt beror på dem. Det är en design-lucka som fixades i samband
 * med att detta steg byggdes — se `extractParagraphRefs` nedan, som
 * arbetar direkt mot källtexten (inte mot ett fält i CandidateArende) just
 * för att undvika att behöva ändra extract-prompten och köra om alla dess
 * tester igen mitt i pipelinebygget. Om ni bygger vidare på det här: en
 * renare lösning är att lägga till `beslutsunderlag_refs: string[]` som
 * ett fält extract.ts fyller i direkt, se README "Nästa steg".
 */

import type { CandidateArende, CandidateStep } from "./extract.ts";

export interface ParagraphRef {
  paragraf: string; // t.ex. "225"
  instans: string; // normaliserad instanskod, t.ex. "KF", "VON", "KS"
  raw: string; // originaltext, för felsökning/loggning
}

export interface PublishedArende extends CandidateArende {
  id: string;
}

// Kända instanskoder som förekommer i Beslutsunderlag-referenser
// (KF/KS/nämndkoder). Håller regexen specifik istället för att matcha
// vilken versal bokstavskombination som helst efter ett "§".
const KNOWN_INSTANCE_CODES = [
  "KF",
  "KS",
  "KSAU",
  "VON",
  "VONAU",
  "TEN",
  "TENAU",
  "KUN",
  "KUNAU",
  "SN",
  "SNAU",
  "BUN",
  "BUNAU",
  "BMN",
  "BMNAU",
  "ÖFN",
];

const PARAGRAPH_REF_RE = new RegExp(
  `§\\s*(\\d+)(?:/\\d{4})?\\s+(${KNOWN_INSTANCE_CODES.join("|")})\\b`,
  "g"
);

/**
 * Extraherar alla paragraf-referenser (t.ex. "§225 KF", "§ 2 VON") ur ett
 * textutdrag — typiskt en Beslutsunderlag-lista, men fungerar mot vilken
 * text som helst.
 */
export function extractParagraphRefs(text: string): ParagraphRef[] {
  const refs: ParagraphRef[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  PARAGRAPH_REF_RE.lastIndex = 0;
  while ((match = PARAGRAPH_REF_RE.exec(text)) !== null) {
    const paragraf = match[1];
    const instans = match[2];
    const key = `${paragraf}|${instans}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ paragraf, instans, raw: match[0] });
  }
  return refs;
}

/**
 * Bygger en jämförbar paragraf-nyckel av en instans + ett protocol_ref-
 * fält (t.ex. "§44 KF 2026-02-25" → "44|KF"). Används för att jämföra ett
 * befintligt ärendes steg mot nya paragraf-referenser.
 */
export function paragraphKeyFromProtocolRef(protocolRef: string): string | null {
  const match = /§\s*(\d+)\s+([A-ZÅÄÖ]+)/.exec(protocolRef);
  if (!match) return null;
  return `${match[1]}|${match[2]}`;
}

/**
 * Hittar startpositionen för varje ärende-sektion i en fullständig
 * protokolltext genom att leta upp rader som inleds med en egen
 * paragrafrubrik, t.ex. "§ 44 2025.393 KS" eller "§42 2025.489 KS".
 * OBS: detta är INTE samma sak som `extractParagraphRefs` — den funktionen
 * hittar korsreferenser INUTI löptexten (t.ex. "§171 KF" nämnt i en
 * Beslutsunderlag-lista), medan den här funktionen hittar var i
 * DOKUMENTET självt varje ärende BÖRJAR.
 */
function findSectionHeaders(fullText: string): Array<{ paragraf: string; index: number }> {
  const headerRe = /^§\s*(\d+)\b/gm;
  const headers: Array<{ paragraf: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(fullText)) !== null) {
    headers.push({ paragraf: m[1], index: m.index });
  }
  return headers;
}

/**
 * KRITISK FÖRUTSÄTTNING som tidigare inte kontrollerades (se DECISION_LOG):
 * `linkArende` antog implicit att `beslutsunderlagText` redan var avgränsad
 * till ETT enda ärende. Skickas hela mötesprotokollets text in (vilket är
 * det normala när flera ärenden från samma möte länkas i samma körning,
 * t.ex. KF 2026-02-25 §32–60), plockar `extractParagraphRefs` upp
 * paragraf-referenser som hör till ANDRA ärendens Beslutsunderlag-listor
 * i samma dokument — vilket kan ge falska positiva sammanslagningar
 * (bevisat: Plantaxa §42 kopplades felaktigt till Fritidsbank via §171 KF,
 * en referens som bara förekommer i Fritidsbanks EGEN Beslutsunderlag,
 * inte Plantaxas).
 *
 * Fix: hitta candidatens egen paragraf-sektion i källtexten (utifrån dess
 * SENASTE stegs `protocol_ref`, eftersom det är steget som just extraherats
 * ur DEN HÄR körningens protokoll) och skär ut bara den sektionen innan
 * `extractParagraphRefs` körs. Om ingen sektionsrubrik alls kan hittas
 * (t.ex. en fristående bilaga-PDF utan §-rubriker) faller funktionen
 * tillbaka på hela texten — oförändrat beteende för redan avgränsad text,
 * som testriggens enskilda protokollutdrag (von-2026-02-18.txt m.fl.).
 */
export function scopeToOwnSection(fullText: string, candidate: CandidateArende): string {
  const headers = findSectionHeaders(fullText);
  if (headers.length === 0) return fullText;

  // Prova candidatens steg i omvänd ordning (senast tillagda steget är
  // normalt det som hör till DEN HÄR körningens protokoll, men vi litar
  // inte blint på det — om det sista steget saknar ett protocol_ref som
  // går att hitta en rubrik för, t.ex. för att candidaten bara innehåller
  // äldre steg från andra möten i den här länkningsomgången, provas
  // tidigare steg också). Bara om INGET av candidatens egna steg går att
  // lokalisera i texten faller vi tillbaka på hela texten oskopad — vilket
  // återger det gamla (osäkra) beteendet, men bara i det läget.
  for (let i = candidate.steps.length - 1; i >= 0; i--) {
    const ownRefMatch = /§\s*(\d+)/.exec(candidate.steps[i]?.source?.protocol_ref ?? "");
    if (!ownRefMatch) continue;
    const ownParagraf = ownRefMatch[1];
    const ownIndex = headers.findIndex((h) => h.paragraf === ownParagraf);
    if (ownIndex === -1) continue;

    const start = headers[ownIndex].index;
    const end = ownIndex + 1 < headers.length ? headers[ownIndex + 1].index : fullText.length;
    return fullText.slice(start, end);
  }

  // Sektionsrubriker FANNS i texten (den är alltså inte redan avgränsad
  // till ett enda ärende), men inget av candidatens egna steg gick att
  // lokalisera till någon av dem — t.ex. ett candidate utan steg, eller
  // med protocol_ref-format som inte känns igen. I det läget är det
  // säkrare att returnera TOM text än hela den ospårade flerärende-texten:
  // en missad matchning (candidate hamnar som "none" eller provas mot
  // fuzzy-titelmatchning) är ofarlig och går att rätta manuellt, men en
  // paragraf-referens plockad ur ett HELT ANNAT ärendes sektion kan ge en
  // felaktig automatisk sammanslagning (se buggen denna funktion fixar).
  return "";
}

/** Normaliserar en titel för ungefärlig jämförelse (fallback-matchning). */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "motion",
  "gällande",
  "om",
  "till",
  "av",
  "i",
  "på",
  "för",
  "och",
  "med",
  "flera",
  "svar",
  "en",
  "ett",
  "att",
]);

/**
 * Enkel token-överlappning (Jaccard-liknande) mellan två titlar, med
 * vanliga civic-tech-stoppord bortfiltrerade (annars dominerar "motion
 * gällande svar på" jämförelsen och allt liknar allt). INTE en riktig
 * fuzzy-matchningsalgoritm (t.ex. Levenshtein) — tillräckligt robust för
 * att fånga stavningsvarianter av samma titel (jfr "Gomer" vs "Gomér" i
 * spec §9), men ska INTE ensamt avgöra en sammanslagning utan mänsklig
 * granskning vid låg konfidens (se linkArende: fallback-matchningar
 * flaggas alltid för review, publiceras aldrig auto-sammanslagna).
 */
export function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeTitle(a).split(" ").filter((t) => t && !STOPWORDS.has(t)));
  const tokensB = new Set(normalizeTitle(b).split(" ").filter((t) => t && !STOPWORDS.has(t)));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection++;
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type LinkMatch =
  | { kind: "paragraph_ref"; existing: PublishedArende; matchedOn: ParagraphRef }
  | { kind: "fuzzy_title"; existing: PublishedArende; score: number }
  | { kind: "none" };

const FUZZY_TITLE_THRESHOLD = 0.6;

/**
 * Avgör om `candidate` hör till något av `existingArenden`. Primär metod:
 * paragraf-korsreferens (R7). Fallback: titel-likhet, men ENDAST om ingen
 * paragraf-referens alls kunde extraheras (annars littar vi hellre fel
 * genom att skapa ett nytt ärende än att slå ihop fel — se spec §5 steg 7:
 * "Misslyckad matchning → nytt ärende skapas hellre än fel koppling").
 *
 * `beslutsunderlagText` behöver INTE längre vara förskopad till ett enda
 * ärende av anroparen — funktionen skopar själv till candidatens egen
 * paragraf-sektion via `scopeToOwnSection` innan matchning sker (se den
 * funktionens kommentar för bakgrunden till varför detta var nödvändigt).
 * Det är fortfarande säkrast att skicka in en redan avgränsad text om
 * anroparen har den till hands, men det krävs inte längre för korrekthet.
 */
export function linkArende(
  candidate: CandidateArende,
  beslutsunderlagText: string,
  existingArenden: PublishedArende[]
): LinkMatch {
  const scopedText = scopeToOwnSection(beslutsunderlagText, candidate);
  const candidateRefs = extractParagraphRefs(scopedText);

  if (candidateRefs.length > 0) {
    for (const existing of existingArenden) {
      for (const step of existing.steps) {
        const existingKey = paragraphKeyFromProtocolRef(step.source.protocol_ref);
        if (!existingKey) continue;
        for (const ref of candidateRefs) {
          if (`${ref.paragraf}|${ref.instans}` === existingKey) {
            return { kind: "paragraph_ref", existing, matchedOn: ref };
          }
        }
      }
    }
    // Paragraf-referenser fanns men matchade inget befintligt ärende —
    // avsiktligt INGEN fuzzy-fallback här. Om protokollet faktiskt angav
    // korsreferenser och ingen av dem kändes igen är det troligare att
    // det är ett genuint nytt ärende än att fuzzy-titelmatchning ska
    // gissa rätt. Undviker att en råkad ordöverlappning felaktigt slår
    // ihop två orelaterade ärenden.
    return { kind: "none" };
  }

  // Inga paragraf-referenser alls i källtexten (t.ex. en förstagångs-
  // motion utan Beslutsunderlag, eller ett styrelseförslag) — fallback
  // till titel-likhet.
  let best: { existing: PublishedArende; score: number } | null = null;
  for (const existing of existingArenden) {
    const score = titleSimilarity(candidate.title, existing.title);
    if (score >= FUZZY_TITLE_THRESHOLD && (!best || score > best.score)) {
      best = { existing, score };
    }
  }
  if (best) {
    return { kind: "fuzzy_title", existing: best.existing, score: best.score };
  }

  return { kind: "none" };
}

/**
 * Genererar ett nytt, stabilt internt ärende-ID (spec §4.2 R7: `id` är den
 * stabila nyckeln, inte diarienummer). Format matchar testriggens data:
 * "a-{år}-{löpnummer}".
 */
export function generateArendeId(year: number, existingIds: Set<string>): string {
  let n = 1;
  let candidate: string;
  do {
    candidate = `a-${year}-${String(n).padStart(4, "0")}`;
    n++;
  } while (existingIds.has(candidate));
  return candidate;
}

/**
 * FYND 2026-07-25 (se DECISION_LOG.md): kartläggning av dubblettstädningen
 * visade 445 diarienummer som förekommer på FLERA toppnivå-ärendeobjekt —
 * dvs `linkArende` ovan har (av okänd, ännu inte fullt utredd anledning)
 * misslyckats koppla ihop steg som tillhör samma sakfråga. 256 av dessa
 * grupper delar EXAKT SAMMA titel inom samma diarienummer — den starkaste
 * signalen för en äkta länkningsmiss, till skillnad från legitima
 * återkommande administrativa rutinbuntar (samma diarienummer använt som
 * "årsnummer" för separata, olikbenämnda poster — dessa ska INTE slås ihop
 * och omfattas inte av den här funktionen).
 *
 * KOMPLIKATION (bevisad empiriskt mot "Kavlås ängar"-paret,
 * diarienummer 2024.147 KS): posterna är INTE bara kompletterande — de
 * överlappar delvis på (datum, instans), med olika detaljnivå beroende på
 * vilket källdokument respektive post extraherades ur (153 av 256 grupper
 * har minst en sådan krock). En enkel array-union skulle antingen duplicera
 * eller godtyckligt tappa data. Denna funktion löser det genom att, vid
 * krock på samma (datum, instans), behålla den version som har MEST
 * information (beslut ifyllt väger tyngst, sedan röstningsdata, sedan
 * längre citat som tie-breaker) — eftersom det speglar att den versionen
 * extraherades ur det mer detaljerade källdokumentet för just det steget.
 */


export interface MergeResult {
  merged: PublishedArende;
  droppedIds: string[];
  conflicts: string[];
}

function stepMergeKey(step: CandidateStep): string {
  return `${step.date}|${step.instance}`;
}

/** Högre poäng = mer komplett/informativ version av samma steg. */
function stepQuality(step: CandidateStep): number {
  let score = 0;
  if (step.decision) score += 2;
  if (step.voting) score += 1;
  score += (step.quote?.length ?? 0) / 1000; // liten tie-breaker, avgör aldrig ensam
  return score;
}

/**
 * Slår ihop N ärendeposter som representerar SAMMA sakfråga (samma
 * diarienummer + exakt samma titel, verifierat av anroparen — se
 * `findSameCaseGroups` nedan för hur grupperna identifieras). Kastar om
 * posterna inte delar diarienummer/titel, för att undvika att av misstag
 * slå ihop olika ärenden.
 */
export function mergeSameCaseArenden(items: PublishedArende[]): MergeResult {
  if (items.length < 2) {
    throw new Error("mergeSameCaseArenden kräver minst två poster att slå ihop");
  }
  const diarienummer = items[0].diarienummer;
  const title = items[0].title;
  for (const it of items) {
    if (it.diarienummer !== diarienummer) {
      throw new Error(
        `mergeSameCaseArenden: diarienummer skiljer sig (${it.diarienummer} vs ${diarienummer}) — ` +
          `vägrar slå ihop, detta är sannolikt inte samma ärende.`
      );
    }
    if (it.title !== title) {
      throw new Error(
        `mergeSameCaseArenden: titel skiljer sig ("${it.title}" vs "${title}") — ` +
          `vägrar slå ihop, detta är sannolikt inte samma ärende.`
      );
    }
  }

  // Bas = posten med flest steg redan innan sammanslagning (mest komplett
  // grundstomme att bygga vidare på för icke-steg-fält som id, source etc.)
  const sorted = [...items].sort((a, b) => b.steps.length - a.steps.length);
  const base = sorted[0];
  const others = sorted.slice(1);

  const stepMap = new Map<string, CandidateStep>();
  for (const step of base.steps) {
    stepMap.set(stepMergeKey(step), step);
  }
  for (const other of others) {
    for (const step of other.steps) {
      const key = stepMergeKey(step);
      const existing = stepMap.get(key);
      if (!existing || stepQuality(step) > stepQuality(existing)) {
        stepMap.set(key, step);
      }
    }
  }
  const mergedSteps = Array.from(stepMap.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );

  // Om NÅGON av käll-posterna nått "avgjort" är den sanna, sammanslagna
  // bilden avgjort — annars hade den delen av historien inte synts alls.
  const status = items.some((it) => it.status === "avgjort") ? "avgjort" : "pågående";

  // initiators: union på namn (dedupe), bevarar parti från första träffen.
  const initiatorMap = new Map<string, { name: string; party: string }>();
  for (const it of items) {
    for (const ini of it.initiators ?? []) {
      if (!initiatorMap.has(ini.name)) initiatorMap.set(ini.name, ini);
    }
  }
  const initiators = Array.from(initiatorMap.values());

  const conflicts: string[] = [];
  const categories = new Set(items.map((it) => it.category).filter(Boolean));
  if (categories.size > 1) {
    conflicts.push(`category skiljer sig mellan käll-posterna: ${[...categories].join(", ")}`);
  }
  const typer = new Set(items.map((it) => it.initiativ_typ).filter(Boolean));
  if (typer.size > 1) {
    conflicts.push(`initiativ_typ skiljer sig mellan käll-posterna: ${[...typer].join(", ")}`);
  }

  const merged: PublishedArende = {
    ...base,
    steps: mergedSteps,
    status,
    initiators,
  };

  return {
    merged,
    droppedIds: items.filter((it) => it.id !== base.id).map((it) => it.id),
    conflicts,
  };
}

/**
 * Hittar grupper av ärenden som delar EXAKT samma diarienummer OCH exakt
 * samma titel — den avgränsning som spec/DECISION_LOG (2026-07-25) pekade
 * ut som den säkra delmängden att slå ihop automatiskt. Ärenden med samma
 * diarienummer men OLIKA titel (t.ex. legitima återkommande rutinbuntar,
 * eller flerstegs-detaljplaner med titel som ändras per fas) rör den här
 * funktionen INTE — de kräver fortfarande manuell granskning.
 */
export function findSameCaseGroups(arenden: PublishedArende[]): PublishedArende[][] {
  const groups = new Map<string, PublishedArende[]>();
  for (const a of arenden) {
    if (!a.diarienummer) continue;
    const key = `${a.diarienummer}\u0000${a.title}`;
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  return Array.from(groups.values()).filter((g) => g.length > 1);
}
