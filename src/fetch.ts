/**
 * fetch.ts — pipeline §5, steg 1.
 *
 * Ansvar: för varje bevakad instans, hitta möten med JUSTERADE protokoll
 * (dvs. protokollet är giltigt, se spec §2.1) som vi inte redan bearbetat,
 * och lämna ut en lista med { committee, date, meetingUrl, protocolPdfUrl }
 * redo för download-steget (§5, steg 2).
 *
 * DESIGNVAL: extraktion sker via URL-mönstermatchning (regex på hela
 * svarskroppen), INTE via CSS-selektorer/DOM-parsing (t.ex. cheerio).
 * Anledning: jag har bara sett MeetingPlus-sidorna genom ett verktyg som
 * konverterar HTML till markdown åt mig — jag har aldrig sett den råa
 * DOM-strukturen (CSS-klasser, elementhierarki) och kan därför inte skriva
 * selektorer jag vet stämmer. URL:erna däremot följer ett mycket
 * konsekvent, upprepade gånger bekräftat mönster:
 *   /committees/{slug}/mote-ÅÅÅÅ-MM-DD
 *   /committees/{slug}/mote-ÅÅÅÅ-MM-DD/protocol/{filnamn}pdf?downloadMode=open
 * Regex på råtext är robust mot att CSS-klasser eller markup ändras, så
 * länge URL-strukturen (som är en de-facto API-kontrakt) står still.
 * NACKDEL: fångar falska positiva om samma mönster råkar förekomma i t.ex.
 * en kommentar eller ett skript på sidan. Bedömt som osannolikt men bör
 * övervakas — se test/fetch.test.ts för gränsfall.
 */

import { BASE_URL, type Committee } from "./config.ts";

export interface MeetingRef {
  committeeSlug: string;
  date: string; // ÅÅÅÅ-MM-DD
  meetingUrl: string;
}

export interface MeetingWithProtocol extends MeetingRef {
  protocolPdfUrl: string;
}

const MEETING_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Extraherar unika mötesreferenser (datum + url) för en instans ur den
 * hämtade sidans råtext (HTML).
 *
 * VIKTIGT FYND (2026-07-22, se DECISION_LOG.md): sidans länkar visade sig
 * vara RELATIVA (t.ex. `href="/committees/kommunfullmaktige/mote-2026-01-28"`)
 * i den råa HTML:en som en vanlig `fetch()` faktiskt får, INTE fullständiga
 * URL:er med domän. Tidigare antogs alltid fullständiga URL:er, baserat på
 * hur `web_fetch` (Claude:s eget verktyg, som tycks normalisera länkar till
 * absoluta vid HTML→markdown-konvertering) visade sidan — aldrig verifierat
 * mot ett riktigt `fetch()`-svar förrän en skarp körning avslöjade att 0
 * möten hittades trots att sidan bevisligen innehöll rätt text. BASE_URL-
 * prefixet är därför nu VALFRITT i mönstret — matchar båda formerna.
 */
export function extractMeetingRefs(committeeSlug: string, html: string): MeetingRef[] {
  const pattern = new RegExp(
    `(?:${escapeRegex(BASE_URL)})?/committees/${escapeRegex(committeeSlug)}/mote-(\\d{4}-\\d{2}-\\d{2})(?![\\w/-])`,
    "g"
  );
  const seen = new Set<string>();
  const refs: MeetingRef[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const date = match[1];
    if (!MEETING_DATE_RE.test(date)) continue;
    if (seen.has(date)) continue;
    seen.add(date);
    refs.push({
      committeeSlug,
      date,
      meetingUrl: `${BASE_URL}/committees/${committeeSlug}/mote-${date}`,
    });
  }
  return refs;
}

/**
 * Extraherar länken till det JUSTERADE protokollets PDF från en mötessidas
 * råtext. Returnerar null om inget protokoll finns publicerat än (mötet har
 * hållits men inte justerats, eller ligger i framtiden — se spec §2.1).
 *
 * Mönster bekräftat i denna konversation, t.ex.:
 *   .../protocol/protokoll-kf-2026-02-25pdf?downloadMode=open
 *   .../protocol/protokoll-skapad-von-2026-02-20-092808pdf?downloadMode=open
 * Filnamnsdelen varierar (ibland "protokoll-{instans}-{datum}",
 * ibland "protokoll-skapad-{instans}-{skapad-datum}-{tid}") så den
 * matchas generellt, inte med ett specifikt filnamnsmönster.
 */
export function extractProtocolPdfUrl(committeeSlug: string, date: string, html: string): string | null {
  const pattern = new RegExp(
    `(?:${escapeRegex(BASE_URL)})?/committees/${escapeRegex(committeeSlug)}/mote-${escapeRegex(date)}` +
      `/protocol/[^"'\\s)>]+?pdf(?:\\?downloadMode=open)?`,
    "i"
  );
  const match = pattern.exec(html);
  if (!match) return null;
  // Om matchningen var relativ (inget domän-prefix), gör den absolut —
  // resten av pipelinen (download.ts m.fl.) förväntar sig fullständiga URL:er.
  return match[0].startsWith("http") ? match[0] : `${BASE_URL}${match[0]}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Läser in vilka (instans, datum)-par som redan är bearbetade.
 */
export async function loadSeen(path: string, readFile: (p: string) => Promise<string>): Promise<Record<string, string[]>> {
  try {
    const raw = await readFile(path);
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Jämför hittade möten mot seen.json och returnerar bara de som är nya.
 */
export function diffNewMeetings(
  refs: MeetingRef[],
  seen: Record<string, string[]>
): MeetingRef[] {
  return refs.filter((ref) => {
    const seenDates = seen[ref.committeeSlug] ?? [];
    return !seenDates.includes(ref.date);
  });
}

/**
 * Orkestrerar hela fetch-steget för en instans: hämta möteslista, filtrera
 * mot seen.json, hämta protokollänk för varje ny träff, hoppa över möten
 * utan justerat protokoll än.
 *
 * `fetchText` injiceras (istället för att anropa fetch() direkt) för att
 * göra funktionen testbar utan nätverk — se test/fetch.test.ts.
 */
export async function fetchNewMeetingsForCommittee(
  committee: Committee,
  seen: Record<string, string[]>,
  fetchText: (url: string) => Promise<string>
): Promise<MeetingWithProtocol[]> {
  const listUrl = `${BASE_URL}/committees/${committee.slug}`;
  const listHtml = await fetchText(listUrl);
  let allRefs = extractMeetingRefs(committee.slug, listHtml);

  // KRITISKT FYND (2026-07-22, se DECISION_LOG.md): listsidan har visat
  // sig sakna mötalänkar helt i skarp drift (bekräftat empiriskt, inte
  // bara en teoretisk risk) — troligen renderas den olikt en enskild
  // mötessida. Enskilda mötessidor har bevisat en fullständig sidmeny
  // med hela historiken, så om listsidan ger NOLL träffar faller vi
  // tillbaka på en känd mötes-URL (`committee.seedMeetingUrl`) istället.
  // Om inget frö är satt för instansen: logga tydligt (INTE bara "0 nya
  // möten", som osynliggör att UPPTÄCKTEN misslyckades strukturellt,
  // skiljt från det normala "inget nytt sedan sist").
  if (allRefs.length === 0) {
    if (committee.seedMeetingUrl) {
      const seedHtml = await fetchText(committee.seedMeetingUrl);
      allRefs = extractMeetingRefs(committee.slug, seedHtml);
    } else {
      throw new Error(
        `Listsidan (${listUrl}) gav noll mötalänkar och inget seedMeetingUrl är satt i config.ts för ` +
          `"${committee.slug}" — mötesupptäckt för denna instans är strukturellt trasig, inte bara ` +
          `"inget nytt". Sätt committee.seedMeetingUrl till en känd mötes-URL för instansen.`
      );
    }
  }

  const newRefs = diffNewMeetings(allRefs, seen);

  const results: MeetingWithProtocol[] = [];
  for (const ref of newRefs) {
    const meetingHtml = await fetchText(ref.meetingUrl);
    const protocolUrl = extractProtocolPdfUrl(ref.committeeSlug, ref.date, meetingHtml);
    if (protocolUrl) {
      results.push({ ...ref, protocolPdfUrl: protocolUrl });
    }
    // Om protocolUrl är null: mötet finns men protokollet är inte justerat
    // än. Hoppas medvetet över — kommer plockas upp igen nästa körning,
    // eftersom vi INTE lägger till datumet i seen.json förrän vi faktiskt
    // hittat och bearbetat ett protokoll (se markSeen nedan, som anropas
    // av orkestreringsskriptet EFTER publish-steget, inte härifrån).
  }
  return results;
}

/**
 * Uppdaterar seen-strukturen med de möten som nu faktiskt bearbetats
 * (dvs. hade ett protokoll och gick igenom hela vägen till publish-steget).
 * Ren funktion — anropas av orkestreringsskriptet efter publish, inte här.
 */
export function markSeen(
  seen: Record<string, string[]>,
  committeeSlug: string,
  date: string
): Record<string, string[]> {
  const existing = seen[committeeSlug] ?? [];
  if (existing.includes(date)) return seen;
  return {
    ...seen,
    [committeeSlug]: [...existing, date].sort(),
  };
}
