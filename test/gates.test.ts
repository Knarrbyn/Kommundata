import { test } from "node:test";
import assert from "node:assert/strict";
import { verbatimGate, gateStep, gateArende, runGates, normalizeWhitespace } from "../src/gates.ts";
import type { CandidateArende, CandidateStep } from "../src/extract.ts";

// ---------------------------------------------------------------------
// Fixture: äkta utdrag ur KF-protokollet 2026-02-25, §45 (vattenlek).
// Detta ÄR det verkliga 43-ords citatet som testriggens verbatim-gate.js
// medvetet lät underkännas (flat 40-ordsgräns) för att bevisa R2-fyndet.
// Här testar vi att DENNA pipelines differentierade gräns (60 ord för
// namndyttrande) faktiskt löser det, istället för att bara dokumentera det.
// ---------------------------------------------------------------------
const SOURCE_TEXT_KF_2026_02_25 = `
§ 45 2025.368 KS 
Svar på motion om vattenlek i Alingsås - Marcus Wallin (V) med flera 
Tekniska nämnden beslutade att avstyrka motionens första att-sats med förslag att minst en 
offentlig vattenlek/plaskdamm ska anläggas i kommunen, och att tillstyrka motionens andra 
att-sats, om att vattenlekplatserna ska utformas tillgängliga för barn med olika 
funktionsvariationer och med sitt- och skuggplatser till medföljande.
Beslut
Motionen avslås.

§ 44 2025.393 KS 
Svar på motion gällande införande av fritidsbank - Pamela Nilsson Ludvigsson (S) med flera 
Beslut
Motionen bifalls.
Anteckning
Ingbritt Johansson (C), Heidi Hankanen Ängberg (C), Theresa Montebelli (C), Annika 
Qarlsson (C) och Ali Said (C) lämnar följande protokollsanteckning:
Centerpartiet är positiva till att kommunen utreder möjligheterna att införa Fritidsbank för att 
öka möjligheterna till en aktiv fritid för alla.
`;

const REAL_NAMNDYTTRANDE_QUOTE_43_WORDS =
  "Tekniska nämnden beslutade att avstyrka motionens första att-sats med förslag att minst en offentlig vattenlek/plaskdamm ska anläggas i kommunen, och att tillstyrka motionens andra att-sats, om att vattenlekplatserna ska utformas tillgängliga för barn med olika funktionsvariationer och med sitt- och skuggplatser till medföljande.";

test("verbatimGate: normaliserar whitespace innan jämförelse", () => {
  const r = verbatimGate("Motionen   bifalls.", "...\nMotionen\nbifalls.\n...");
  assert.equal(r.passed, true);
});

test("verbatimGate: tomt citat underkänns direkt", () => {
  const r = verbatimGate("", SOURCE_TEXT_KF_2026_02_25);
  assert.equal(r.passed, false);
  assert.match(r.reason, /Tomt citat/);
});

test("verbatimGate: DET ÄKTA 43-ords R2-fyndet UNDERKÄNNS vid default-gräns (40 ord)", () => {
  const wordCount = normalizeWhitespace(REAL_NAMNDYTTRANDE_QUOTE_43_WORDS).split(" ").length;
  assert.equal(wordCount, 43, "sanity check: citatet ska faktiskt vara 43 ord, annars testar vi fel sak");
  const r = verbatimGate(REAL_NAMNDYTTRANDE_QUOTE_43_WORDS, SOURCE_TEXT_KF_2026_02_25, 40);
  assert.equal(r.passed, false);
  assert.match(r.reason, /överskrider 40 ord/);
});

test("verbatimGate: SAMMA äkta citat GODKÄNNS vid 60-ordsgränsen (R2-lösningen tillämpad)", () => {
  const r = verbatimGate(REAL_NAMNDYTTRANDE_QUOTE_43_WORDS, SOURCE_TEXT_KF_2026_02_25, 60);
  assert.equal(r.passed, true);
  assert.match(r.reason, /verifierat ordagrant/);
});

test("gateStep: namndyttrande-typ får automatiskt 60-ordsgränsen, inte 40", () => {
  const step: CandidateStep = {
    step_id: "s-1",
    instance: "tekniska_namnden",
    type: "namndyttrande",
    date: "2025-12-15",
    quote: REAL_NAMNDYTTRANDE_QUOTE_43_WORDS,
    source: { protocol_ref: "§62 TEN 2025-12-15" },
  };
  const results = gateStep(step, SOURCE_TEXT_KF_2026_02_25);
  assert.equal(results.length, 1);
  assert.equal(results[0].passed, true, "namndyttrande ska automatiskt använda 60-ordsgränsen via wordLimitFor()");
});

test("gateStep: beslut-typ håller sig vid default 40-ordsgränsen (samma citat skulle underkännas som ett 'beslut')", () => {
  const step: CandidateStep = {
    step_id: "s-1",
    instance: "kommunfullmaktige",
    type: "beslut", // fel typ avsiktligt, för att bevisa att gränsen verkligen är typberoende
    date: "2026-02-25",
    quote: REAL_NAMNDYTTRANDE_QUOTE_43_WORDS,
    source: { protocol_ref: "§45 KF 2026-02-25" },
  };
  const results = gateStep(step, SOURCE_TEXT_KF_2026_02_25);
  assert.equal(results[0].passed, false, "beslut-typ ska INTE få 60-ordsundantaget");
});

test("gateStep: kontrollerar huvudcitat + reservationer + protokollsanteckningar i samma steg", () => {
  const step: CandidateStep = {
    step_id: "s-1",
    instance: "kommunfullmaktige",
    type: "beslut",
    date: "2026-02-25",
    quote: "Motionen bifalls.",
    reservations: [],
    protocol_anteckning: [
      {
        parties: ["c"],
        quote:
          "Centerpartiet är positiva till att kommunen utreder möjligheterna att införa Fritidsbank för att öka möjligheterna till en aktiv fritid för alla.",
      },
    ],
    source: { protocol_ref: "§44 KF 2026-02-25" },
  };
  const results = gateStep(step, SOURCE_TEXT_KF_2026_02_25);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.passed));
  assert.equal(results[1].field, "protocol_anteckning[c]");
});

test("gateArende: ärendet UNDERKÄNNS helt om bara ETT av flera citat brister (R2 — hela ärendet till needs_review)", () => {
  const arende: CandidateArende = {
    title: "Test — blandat äkta och fabricerat",
    initiativ_typ: "motion",
    initiators: [],
    category: "övrigt",
    status: "avgjort",
    diarienummer: null,
    steps: [
      {
        step_id: "s-1",
        instance: "kommunfullmaktige",
        type: "beslut",
        date: "2026-02-25",
        quote: "Motionen bifalls.", // äkta, ska godkännas
        source: { protocol_ref: "§44 KF 2026-02-25" },
      },
      {
        step_id: "s-2",
        instance: "kommunfullmaktige",
        type: "beslut",
        date: "2026-02-25",
        quote: "Motionen bifalls enhälligt med extra finansiering.", // fabricerat, finns inte i källan
        source: { protocol_ref: "§44 KF 2026-02-25" },
      },
    ],
  };
  const result = gateArende(arende, SOURCE_TEXT_KF_2026_02_25);
  assert.equal(result.passed, false, "ett underkänt citat ska underkänna HELA ärendet");
  assert.equal(result.checks.filter((c) => c.passed).length, 1);
  assert.equal(result.checks.filter((c) => !c.passed).length, 1);
});

test("runGates: delar upp flera ärenden korrekt i ready/needsReview", () => {
  const goodArende: CandidateArende = {
    title: "Fritidsbank",
    initiativ_typ: "motion",
    initiators: [],
    category: "vård-omsorg",
    status: "avgjort",
    diarienummer: "2025.393 KS",
    steps: [
      {
        step_id: "s-1",
        instance: "kommunfullmaktige",
        type: "beslut",
        date: "2026-02-25",
        quote: "Motionen bifalls.",
        source: { protocol_ref: "§44 KF 2026-02-25" },
      },
    ],
  };
  const badArende: CandidateArende = {
    title: "Fabricerat ärende",
    initiativ_typ: "motion",
    initiators: [],
    category: "övrigt",
    status: "avgjort",
    diarienummer: null,
    steps: [
      {
        step_id: "s-1",
        instance: "kommunfullmaktige",
        type: "beslut",
        date: "2026-02-25",
        quote: "Detta citat finns absolut inte i källan.",
        source: { protocol_ref: "§99 KF 2026-02-25" },
      },
    ],
  };

  const { ready, needsReview } = runGates([goodArende, badArende], SOURCE_TEXT_KF_2026_02_25);
  assert.equal(ready.length, 1);
  assert.equal(needsReview.length, 1);
  assert.equal(ready[0].arende.title, "Fritidsbank");
  assert.equal(needsReview[0].arende.title, "Fabricerat ärende");
});

test("gateStep: protokollsanteckning UTAN ordgräns — äkta 54-ords citat (skarpt fynd 2026-07-20) GODKÄNNS nu", () => {
  const REAL_54_WORD_ANTECKNING =
    "Centerpartiet är positiva till att kommunen utreder möjligheterna att införa Fritidsbank för att öka möjligheterna till en aktiv fritid för alla. Centerpartiet anser att det är viktigt att man i utredningen tittar på hur man kan göra Fritidsbanken tillgänglig, inte bara i centralorten utan i hela kommunen genom filialer i exempelvis Sollebrunn och Ingared.";
  const wordCount = normalizeWhitespace(REAL_54_WORD_ANTECKNING).split(" ").length;
  assert.equal(wordCount, 54, "sanity check: detta ska faktiskt vara 54 ord");

  const step: CandidateStep = {
    step_id: "s-1",
    instance: "kommunfullmaktige",
    type: "beslut", // 40-ordsgräns för huvudcitatet — men ska INTE påverka anteckningen
    date: "2026-02-25",
    quote: "Motionen bifalls.",
    protocol_anteckning: [{ parties: ["c"], quote: REAL_54_WORD_ANTECKNING }],
    source: { protocol_ref: "§44 KF 2026-02-25" },
  };
  const results = gateStep(step, SOURCE_TEXT_KF_2026_02_25 + " " + REAL_54_WORD_ANTECKNING);
  const anteckningResult = results.find((r) => r.field === "protocol_anteckning[c]")!;
  assert.equal(anteckningResult.passed, true, "54-ords protokollsanteckning ska godkännas — ordgränsen gäller bara huvudcitatet");
});

test("gateArende: ärende utan steg (edge case, extract borde ha kasserat det redan) underkänns säkert", () => {
  const arende: CandidateArende = {
    title: "Tomt",
    initiativ_typ: "motion",
    initiators: [],
    category: "övrigt",
    status: "pågående",
    diarienummer: null,
    steps: [],
  };
  const result = gateArende(arende, SOURCE_TEXT_KF_2026_02_25);
  assert.equal(result.passed, false);
});
