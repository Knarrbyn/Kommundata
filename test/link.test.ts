import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractParagraphRefs,
  paragraphKeyFromProtocolRef,
  normalizeTitle,
  titleSimilarity,
  linkArende,
  generateArendeId,
  type PublishedArende,
} from "../src/link.ts";
import type { CandidateArende } from "../src/extract.ts";

// ---------------------------------------------------------------------
// Riktiga Beslutsunderlag-texter, ordagrant ur VON-protokollet (§2,
// 2026-02-18) och det slutgiltiga KF-beslutet (§92, 2026-05-06) för
// samma ärende — motion om "valmöjlighet i värdig vård". Detta ÄR det
// konkreta beviset för R7 (diarienummer höll inte: 2025.271 VON vs
// 2025.511 KS, men paragraf-referenserna gjorde det).
// ---------------------------------------------------------------------
const VON_BESLUTSUNDERLAG = `
Beslutsunderlag
• §10 VONAU Svar på motion gällande rätt till valmöjlighet i värdig vård - Gunilla 
Gomer (SD) och Kjerstin Hansson (SD)
• Tjänsteskrivelse - Svar på motion gällande rätt till valmöjlighet i värdig vård - Gunilla 
Gomer (SD) och Kjerstin Hansson (SD)
• Expediering §225/2025 KF - Motion gällande rätt till valmöjlighet i värdig vård - 
Gunilla Gomer (SD) och Kjerstin Hansson (SD)
• Motion gällande rätt till valmöjlighet i värdig vård - Gunilla Gomer (SD) och Kjerstin 
Hansson (SD)
`;

const KF_BESLUT_BESLUTSUNDERLAG = `
Beslutsunderlag
• §59 KS Motion gällande rätt till valmöjlighet i värdig vård - Gunilla Gomér (SD) och 
Kjerstin Hansson (SD)
• Tjänsteskrivelse - Svar på motion gällande rätt till valmöjlighet i värdig vård - Gunilla 
Gomér (SD)
• Motion gällande rätt till valmöjlighet i värdig vård - Gunilla Gomér (SD) och Kjerstin 
Hansson (SD)
• § 2 VON - Svar på motion gällande rätt till valmöjlighet i värdig vård - Gunilla Gomer 
(SD) och Kjerstin Hansson (SD)
• §225 KF Motion gällande rätt till valmöjlighet i värdig vård - Gunilla Gomer (SD) och 
Kjerstin Hansson (SD)
`;

/* ============ extractParagraphRefs ============ */

test("extractParagraphRefs: hittar '§225 KF' (rent format, utan snedstreck)", () => {
  const refs = extractParagraphRefs(KF_BESLUT_BESLUTSUNDERLAG);
  assert.ok(refs.some((r) => r.paragraf === "225" && r.instans === "KF"));
});

test("extractParagraphRefs: hittar '§ 2 VON' (mellanslag efter §, kort paragrafnummer)", () => {
  const refs = extractParagraphRefs(KF_BESLUT_BESLUTSUNDERLAG);
  assert.ok(refs.some((r) => r.paragraf === "2" && r.instans === "VON"));
});

test("extractParagraphRefs: hittar '§59 KS'", () => {
  const refs = extractParagraphRefs(KF_BESLUT_BESLUTSUNDERLAG);
  assert.ok(refs.some((r) => r.paragraf === "59" && r.instans === "KS"));
});

test("extractParagraphRefs: hanterar det RIKTIGA '§NUMMER/ÅR INSTANS'-formatet ('§225/2025 KF')", () => {
  const refs = extractParagraphRefs(VON_BESLUTSUNDERLAG);
  assert.ok(
    refs.some((r) => r.paragraf === "225" && r.instans === "KF"),
    "ska tolka '§225/2025 KF' som paragraf 225, instans KF — inte missa den pga snedstrecket"
  );
});

test("extractParagraphRefs: hittar '§10 VONAU'", () => {
  const refs = extractParagraphRefs(VON_BESLUTSUNDERLAG);
  assert.ok(refs.some((r) => r.paragraf === "10" && r.instans === "VONAU"));
});

test("extractParagraphRefs: dedupear samma referens om den nämns flera gånger", () => {
  const text = "§44 KF och senare igen §44 KF i samma stycke.";
  const refs = extractParagraphRefs(text);
  assert.equal(refs.length, 1);
});

/* ============ paragraphKeyFromProtocolRef ============ */

test("paragraphKeyFromProtocolRef: bygger jämförbar nyckel av vårt eget protocol_ref-format", () => {
  assert.equal(paragraphKeyFromProtocolRef("§225 KF 2025-11-11"), "225|KF");
  assert.equal(paragraphKeyFromProtocolRef("§2 VON 2026-02-18"), "2|VON");
});

test("paragraphKeyFromProtocolRef: returnerar null för text utan paragrafreferens", () => {
  assert.equal(paragraphKeyFromProtocolRef("Ingen paragraf här"), null);
});

/* ============ titleSimilarity ============ */

test("titleSimilarity: identiska titlar ger 1.0", () => {
  assert.equal(titleSimilarity("Motion om vattenlek", "Motion om vattenlek"), 1);
});

test("titleSimilarity: stavningsvariant (Gomer vs Gomér, jfr spec §9) ger hög likhet trots liten skillnad", () => {
  const score = titleSimilarity(
    "Motion gällande rätt till valmöjlighet i värdig vård - Gunilla Gomer (SD)",
    "Motion gällande rätt till valmöjlighet i värdig vård - Gunilla Gomér (SD)"
  );
  assert.ok(score > 0.7, `förväntade hög likhet, fick ${score}`);
});

test("titleSimilarity: helt orelaterade titlar ger låg likhet", () => {
  const score = titleSimilarity("Motion om vattenlek i Alingsås", "Plantaxa 2026");
  assert.ok(score < 0.3, `förväntade låg likhet, fick ${score}`);
});

/* ============ linkArende: full integration mot riktiga data ============ */

function makeExisting(id: string, title: string, steps: Array<{ protocol_ref: string }>): PublishedArende {
  return {
    id,
    title,
    initiativ_typ: "motion",
    initiators: [{ name: "Gunilla Gomér", party: "sd" }],
    category: "vård-omsorg",
    status: "pågående",
    diarienummer: null,
    steps: steps.map((s, i) => ({
      step_id: `s-${i}`,
      instance: "kommunfullmaktige",
      type: "motion_inlamnad",
      date: "2025-11-11",
      quote: "x",
      source: { protocol_ref: s.protocol_ref },
    })),
  };
}

test("linkArende: KOPPLAR KF-beslutet till det befintliga VON-ärendet via '§ 2 VON' (R7 i praktiken, riktig data)", () => {
  const existing = [
    makeExisting("a-2025-0271", "Motion gällande rätt till valmöjlighet i värdig vård", [
      { protocol_ref: "§225 KF 2025-11-11" },
      { protocol_ref: "§2 VON 2026-02-18" },
    ]),
  ];

  const candidate: CandidateArende = {
    title: "Svar på motion gällande rätt till valmöjlighet i värdig vård",
    initiativ_typ: "motion",
    initiators: [],
    category: "vård-omsorg",
    status: "avgjort",
    diarienummer: "2025.511 KS", // MEDVETET annat diarienummer än VON-steget (2025.271 VON) — det är HELA poängen med R7
    steps: [],
  };

  const result = linkArende(candidate, KF_BESLUT_BESLUTSUNDERLAG, existing);
  assert.equal(result.kind, "paragraph_ref");
  if (result.kind === "paragraph_ref") {
    assert.equal(result.existing.id, "a-2025-0271");
  }
});

test("linkArende: koppling fungerar TROTS att diarienumret skiljer sig helt (2025.271 VON vs 2025.511 KS)", () => {
  // Samma test som ovan, men med fokus på att bevisa att diarienummer INTE
  // spelade någon roll för att matchningen lyckades — candidate.diarienummer
  // matchar inte NÅGOT i existing, och det är precis poängen.
  const existing = [makeExisting("a-2025-0271", "Motion om valmöjlighet i värdig vård", [{ protocol_ref: "§2 VON 2026-02-18" }])];
  const candidate: CandidateArende = {
    title: "Annan rubrikformulering helt",
    initiativ_typ: "motion",
    initiators: [],
    category: "vård-omsorg",
    status: "avgjort",
    diarienummer: "2025.511 KS",
    steps: [],
  };
  const result = linkArende(candidate, "Beslutsunderlag\n• § 2 VON - Svar på motion...", existing);
  assert.equal(result.kind, "paragraph_ref", "matchningen ska lyckas via paragrafreferens trots helt olika titel och diarienummer");
});

test("linkArende: paragrafreferenser fanns men matchade INGET → 'none', ingen fuzzy-fallback (undviker felaktig sammanslagning)", () => {
  const existing = [makeExisting("a-2025-0001", "Ett helt annat ärende", [{ protocol_ref: "§99 KF 2025-01-01" }])];
  const candidate: CandidateArende = {
    title: "Nytt ärende med referenser som inte matchar något befintligt",
    initiativ_typ: "motion",
    initiators: [],
    category: "övrigt",
    status: "avgjort",
    diarienummer: null,
    steps: [],
  };
  const result = linkArende(candidate, "Beslutsunderlag\n• §12 KS Något annat ärende", existing);
  assert.equal(result.kind, "none");
});

test("linkArende: INGA paragrafreferenser alls (t.ex. förstagångsmotion) → fuzzy titel-fallback", () => {
  const existing = [makeExisting("a-2025-0368", "Motion om vattenlek i Alingsås", [{ protocol_ref: "§172 KF 2025-09-03" }])];
  const candidate: CandidateArende = {
    title: "Motion om vattenlek i Alingsås kommun", // nästan identisk titel
    initiativ_typ: "motion",
    initiators: [],
    category: "infrastruktur",
    status: "pågående",
    diarienummer: null,
    steps: [],
  };
  const result = linkArende(candidate, "Ingen Beslutsunderlag-lista alls i den här texten.", existing);
  assert.equal(result.kind, "fuzzy_title");
  if (result.kind === "fuzzy_title") {
    assert.equal(result.existing.id, "a-2025-0368");
    assert.ok(result.score >= 0.6);
  }
});

test("linkArende: inga referenser och ingen titel-likhet → 'none', nytt ärende ska skapas", () => {
  const existing = [makeExisting("a-2025-0001", "Motion om vattenlek", [{ protocol_ref: "§1 KF 2025-01-01" }])];
  const candidate: CandidateArende = {
    title: "Plantaxa 2026",
    initiativ_typ: "styrelseforslag",
    initiators: [],
    category: "ekonomi",
    status: "avgjort",
    diarienummer: null,
    steps: [],
  };
  const result = linkArende(candidate, "Inga referenser.", existing);
  assert.equal(result.kind, "none");
});

/* ============ scopeToOwnSection (avgränsningsbugg, se handoff-summary v2) ============ */

// Ordagrant utdrag ur KF-protokollet 2026-02-25, §42 (Plantaxa) och §44
// (Fritidsbank) i följd — precis den situation där flera ärenden från
// SAMMA möte länkas i samma körning och riskerar att dela källtext.
const KF_2026_02_25_MULTI_ARENDE = `
§ 42 2025.489 KS 
Plantaxa 2026 
Beredning 
Kommunstyrelsen har den 2 februari 2026, § 10 behandlat ärendet. 
Beslut
Ny plantaxa enligt plan- och bygglagen fastställs och börjar gälla den 1 mars 2026.
Beslutsunderlag
• §10 KS Plantaxa 2026
• Plantaxa 2026, efter KSAU
• Tjänsteskrivelse - Plantaxa 2026

§ 44 2025.393 KS 
Svar på motion gällande införande av fritidsbank - Pamela Nilsson 
Ludvigsson (S) med flera 
Beslut
Motionen bifalls.
Beslutsunderlag
• §12 KS Svar på motion gällande införande av fritidsbank - Pamela Nilsson 
Ludvigsson (S) med flera
• § 112 KUN - Svar på motion gällande införande av fritidsbank
• §171 KF Motion gällande införande av fritidsbank - Pamela Nilsson Ludvigsson (S) 
med flera
`;

test("linkArende: skopar bort ANDRA ärendens Beslutsunderlag-referenser i samma protokolltext (regressionstest, se handoff-summary v2)", () => {
  // Befintligt ärende (Fritidsbank) med ett steg vars protocol_ref pekar
  // på §171 KF — en referens som bara förekommer i FRITIDSBANKS egen
  // Beslutsunderlag-lista i källtexten ovan, inte i Plantaxas.
  const existingFritidsbank = makeExisting(
    "a-2025-0393",
    "Motion gällande införande av fritidsbank",
    [{ protocol_ref: "§171 KF 2025-09-03" }]
  );

  // Ny kandidat: Plantaxa (§42), ett helt orelaterat ärende. Källtexten
  // som skickas in är HELA det tvåärende-utdraget ovan (inte förskopad av
  // anroparen) — precis det scenario som tidigare gav en falsk matchning.
  const plantaxaCandidate: CandidateArende = {
    title: "Plantaxa 2026",
    initiativ_typ: "styrelseforslag",
    initiators: [],
    category: "ekonomi",
    status: "avgjort",
    diarienummer: "2025.489 KS",
    steps: [
      {
        step_id: "s-plantaxa",
        instance: "kommunfullmaktige",
        type: "beslut",
        date: "2026-02-25",
        quote: "x",
        source: { protocol_ref: "§42 KF 2026-02-25" },
      },
    ],
  };

  const result = linkArende(plantaxaCandidate, KF_2026_02_25_MULTI_ARENDE, [existingFritidsbank]);
  assert.equal(
    result.kind,
    "none",
    "Plantaxa ska INTE matchas mot Fritidsbank bara för att §171 KF nämns någon annanstans i samma protokoll"
  );
});

test("linkArende: hittar ändå rätt korsreferens när candidatens egen sektion skopas ur en flerärende-text", () => {
  // Samma flerärende-källtext, men nu ett befintligt ärende vars steg
  // faktiskt MATCHAR en referens i Fritidsbanks EGEN Beslutsunderlag
  // (§12 KS) — ska fortfarande hittas efter skopning.
  const existingKsBeredning = makeExisting("a-2025-0393-ks", "Fritidsbank, kommunstyrelsens beredning", [
    { protocol_ref: "§12 KS 2026-02-02" },
  ]);

  const fritidsbankCandidate: CandidateArende = {
    title: "Motion gällande införande av fritidsbank",
    initiativ_typ: "motion",
    initiators: [],
    category: "vård-omsorg",
    status: "avgjort",
    diarienummer: "2025.393 KS",
    steps: [
      {
        step_id: "s-fritidsbank",
        instance: "kommunfullmaktige",
        type: "beslut",
        date: "2026-02-25",
        quote: "x",
        source: { protocol_ref: "§44 KF 2026-02-25" },
      },
    ],
  };

  const result = linkArende(fritidsbankCandidate, KF_2026_02_25_MULTI_ARENDE, [existingKsBeredning]);
  assert.equal(result.kind, "paragraph_ref");
  if (result.kind === "paragraph_ref") {
    assert.equal(result.existing.id, "a-2025-0393-ks");
  }
});

test("linkArende: candidate utan lokaliserbart eget steg i en flerärende-text → 'none', INTE en falsk matchning (härdning av scopeToOwnSection)", () => {
  // Samma farliga situation som ovan (§171 KF hör till Fritidsbank), men nu
  // saknar candidaten ett steg vars protocol_ref går att hitta en egen
  // sektion för (t.ex. tomt steps[] — ett malformt candidate). Innan
  // härdningen föll scopeToOwnSection tillbaka på HELA flerärende-texten
  // i det läget, vilket återinförde den ursprungliga buggen.
  const existingFritidsbank = makeExisting(
    "a-2025-0393",
    "Motion gällande införande av fritidsbank",
    [{ protocol_ref: "§171 KF 2025-09-03" }]
  );

  const malformedCandidate: CandidateArende = {
    title: "Motion gällande stärkt föreningsliv i Alingsås genom anslutning till Bidragsportalen",
    initiativ_typ: "motion",
    initiators: [],
    category: "demokrati",
    status: "pågående",
    diarienummer: "2026.126 KS",
    steps: [], // medvetet tomt — kantfallet som avslöjade härdningsbehovet
  };

  const result = linkArende(malformedCandidate, KF_2026_02_25_MULTI_ARENDE, [existingFritidsbank]);
  assert.equal(
    result.kind,
    "none",
    "Ett candidate utan lokaliserbart eget steg ska INTE kunna matchas via en annan ärendes paragraf-referens"
  );
});

/* ============ generateArendeId ============ */

test("generateArendeId: genererar första lediga löpnummer för ett år", () => {
  const id = generateArendeId(2026, new Set());
  assert.equal(id, "a-2026-0001");
});

test("generateArendeId: hoppar över redan använda ID:n", () => {
  const id = generateArendeId(2026, new Set(["a-2026-0001", "a-2026-0002"]));
  assert.equal(id, "a-2026-0003");
});
