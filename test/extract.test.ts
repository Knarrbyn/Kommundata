import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  extractPdfText,
  buildExtractionPrompt,
  parseExtractionResponse,
} from "../src/extract.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ============ PDF-textextraktion — RIKTIGT TESTAT, ingen mock ============ */

test("extractPdfText: extraherar riktig text ur en giltig PDF (pdf-parse v2 API)", async () => {
  const pdfPath = path.join(__dirname, "fixtures-plantaxa.pdf");
  const bytes = await readFile(pdfPath);
  const text = await extractPdfText(new Uint8Array(bytes));
  assert.ok(
    text.includes("Ny plantaxa enligt plan- och bygglagen faststalls."),
    `förväntad text saknas i extraherat resultat: ${JSON.stringify(text)}`
  );
});

test("extractPdfText: innehåller INTE sidbrytningsmarkörer (pageJoiner avstängd)", async () => {
  const pdfPath = path.join(__dirname, "fixtures-plantaxa.pdf");
  const bytes = await readFile(pdfPath);
  const text = await extractPdfText(new Uint8Array(bytes));
  assert.ok(!text.includes("--"), "sidbrytningsmarkör ska vara avstängd så citat inte splittras");
});

/* ============ Promptbygge ============ */

test("buildExtractionPrompt: inkluderar källtext, protokollreferens och R9/R10-instruktioner", () => {
  const prompt = buildExtractionPrompt("Exempeltext ur protokollet.", {
    protocolRef: "§9 KF 2026-01-28",
    date: "2026-01-28",
  });
  assert.ok(prompt.includes("Exempeltext ur protokollet."), "källtexten ska vara inbäddad");
  assert.ok(prompt.includes("§9 KF 2026-01-28"), "protokollreferensen ska vara med");
  assert.ok(prompt.includes("R9"), "R9-invarianten (interpellationer/enkla frågor) ska nämnas");
  assert.ok(prompt.includes("R10"), "R10-invarianten (initiativärenden) ska nämnas");
  assert.ok(prompt.includes("OPÅLITLIG DATA"), "anti-injektionsvarning ska finnas");
});

/* ============ Svarsparsning: giltiga svar ============ */

test("parseExtractionResponse: parsar ett korrekt, schema-troget svar (baserat på Plantaxa 2026)", () => {
  const mockLlmResponse = JSON.stringify({
    arenden: [
      {
        title: "Plantaxa 2026",
        initiativ_typ: "styrelseforslag",
        initiators: [],
        category: "ekonomi",
        status: "avgjort",
        diarienummer: "2025.489 KS",
        steps: [
          {
            step_id: "s-1",
            instance: "kommunstyrelsen",
            type: "beredning",
            date: "2026-02-02",
            quote: "Samhällsbyggnadsförvaltningen föreslår kommunstyrelsen att justera plantaxans timersättning.",
            decision: "tillstyrker",
            voting: { recorded: false, note: "Röstfördelning ej redovisad i protokollet" },
            reservations: [],
            protocol_anteckning: [],
            source: { protocol_ref: "§10 KS 2026-02-02" },
          },
          {
            step_id: "s-2",
            instance: "kommunfullmaktige",
            type: "beslut",
            date: "2026-02-25",
            quote: "Ny plantaxa enligt plan- och bygglagen fastställs och börjar gälla den 1 mars 2026.",
            decision: "bifall",
            voting: { recorded: false, note: "Röstfördelning ej redovisad i protokollet" },
            reservations: [],
            protocol_anteckning: [],
            source: { protocol_ref: "§42 KF 2026-02-25" },
          },
        ],
      },
    ],
  });

  const result = parseExtractionResponse(mockLlmResponse);
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.arenden.length, 1);
  assert.equal(result.arenden[0].initiativ_typ, "styrelseforslag");
  assert.equal(result.arenden[0].steps.length, 2);
  assert.deepEqual(result.arenden[0].initiators, []);
});

test("parseExtractionResponse: R3 — voting.note TVINGAS till den exakta fasta texten, oavsett vad LLM:et skrev (skarpt fynd 2026-07-20)", () => {
  const mockLlmResponse = JSON.stringify({
    arenden: [
      {
        title: "Test",
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
            date: "2026-01-01",
            quote: "Motionen avslås.",
            voting: {
              recorded: false,
              // Detta är EXAKT den typen av egen omskrivning en riktig LLM-körning
              // producerade i praktiken, istället för den föreskrivna fasta texten.
              note: "Ordföranden ställer förslagen mot varandra och finner att kommunfullmäktige beslutar att bifalla kommunstyrelsens förslag.",
            },
            source: { protocol_ref: "§1 KF 2026-01-01" },
          },
        ],
      },
    ],
  });
  const result = parseExtractionResponse(mockLlmResponse);
  assert.equal(result.ok, true);
  assert.equal(
    (result.arenden[0].steps[0].voting as { note: string }).note,
    "Röstfördelning ej redovisad i protokollet",
    "note ska tvingas till den fasta R3-texten oavsett vad modellen skrev"
  );
});

test("parseExtractionResponse: R9 — interpellationssteg med decision/voting=null godkänns", () => {
  const mockLlmResponse = JSON.stringify({
    arenden: [
      {
        title: "Interpellation om arbetsmiljön",
        initiativ_typ: "interpellation",
        initiators: [{ name: "Marcus Wallin", party: "v" }],
        category: "vård-omsorg",
        status: "avgjort",
        diarienummer: "2025.575 KS",
        steps: [
          {
            step_id: "s-1",
            instance: "kommunfullmaktige",
            type: "interpellation_svarad",
            date: "2026-01-28",
            quote: "Vård- och omsorgsnämndens ordförande Eva-Lotta Pamp (M) har i skrivelse den 26 januari 2026 lämnat sitt interpellationssvar.",
            decision: null,
            voting: null,
            reservations: [],
            protocol_anteckning: [],
            source: { protocol_ref: "§9 KF 2026-01-28" },
          },
        ],
      },
    ],
  });

  const result = parseExtractionResponse(mockLlmResponse);
  assert.equal(result.ok, true);
  assert.equal(result.arenden[0].steps[0].decision, null);
  assert.equal(result.arenden[0].steps[0].voting, null);
});

test("parseExtractionResponse: strippar markdown-fences runt JSON", () => {
  const mockLlmResponse = "```json\n" + JSON.stringify({
    arenden: [
      {
        title: "Test",
        initiativ_typ: "motion",
        initiators: [],
        category: "övrigt",
        status: "pågående",
        diarienummer: null,
        steps: [
          {
            step_id: "s-1",
            instance: "kommunfullmaktige",
            type: "motion_inlamnad",
            date: "2026-01-01",
            quote: "Ett citat.",
            source: { protocol_ref: "§1 KF 2026-01-01" },
          },
        ],
      },
    ],
  }) + "\n```";

  const result = parseExtractionResponse(mockLlmResponse);
  assert.equal(result.ok, true);
  assert.equal(result.arenden.length, 1);
});

/* ============ Svarsparsning: ogiltiga svar ska fångas, inte krascha pipelinen ============ */

test("parseExtractionResponse: ogiltig JSON ger ok=false med felmeddelande, kraschar inte", () => {
  const result = parseExtractionResponse("det här är inte JSON alls {{{");
  assert.equal(result.ok, false);
  assert.equal(result.arenden.length, 0);
  assert.ok(result.errors[0].includes("Ogiltig JSON"));
});

test("parseExtractionResponse: saknar arenden-fält", () => {
  const result = parseExtractionResponse(JSON.stringify({ something_else: [] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors[0].includes("arenden"));
});

test("parseExtractionResponse: ogiltig initiativ_typ kasseras med tydligt fel", () => {
  const mockLlmResponse = JSON.stringify({
    arenden: [
      {
        title: "Test",
        initiativ_typ: "pahittad_typ",
        initiators: [],
        category: "övrigt",
        status: "pågående",
        diarienummer: null,
        steps: [{ step_id: "s-1", instance: "kommunfullmaktige", type: "beslut", date: "2026-01-01", quote: "x", source: { protocol_ref: "§1" } }],
      },
    ],
  });
  const result = parseExtractionResponse(mockLlmResponse);
  assert.equal(result.ok, false);
  assert.equal(result.arenden.length, 0);
  assert.ok(result.errors[0].includes("initiativ_typ"));
});

test("parseExtractionResponse: steg utan citat kasseras (kan aldrig nå verbatimgrinden ändå)", () => {
  const mockLlmResponse = JSON.stringify({
    arenden: [
      {
        title: "Test",
        initiativ_typ: "motion",
        initiators: [],
        category: "övrigt",
        status: "pågående",
        diarienummer: null,
        steps: [{ step_id: "s-1", instance: "kommunfullmaktige", type: "beslut", date: "2026-01-01", quote: "", source: { protocol_ref: "§1" } }],
      },
    ],
  });
  const result = parseExtractionResponse(mockLlmResponse);
  assert.equal(result.ok, false);
  assert.equal(result.arenden.length, 0);
});

test("parseExtractionResponse: ogiltigt datumformat fångas", () => {
  const mockLlmResponse = JSON.stringify({
    arenden: [
      {
        title: "Test",
        initiativ_typ: "motion",
        initiators: [],
        category: "övrigt",
        status: "pågående",
        diarienummer: null,
        steps: [{ step_id: "s-1", instance: "kommunfullmaktige", type: "beslut", date: "25 februari 2026", quote: "x", source: { protocol_ref: "§1" } }],
      },
    ],
  });
  const result = parseExtractionResponse(mockLlmResponse);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("datumformat")));
});

/* ============ Integrationspunkt mot verbatimgrinden (R2) ============ */

test("integration: ett parsat citat är en riktig substräng av källtexten (samma regel som R2/verbatim-gate.js)", () => {
  const sourceText = "Beslut\nNy plantaxa enligt plan- och bygglagen fastställs och börjar gälla den 1 mars 2026.\nExpedieras till";
  const mockLlmResponse = JSON.stringify({
    arenden: [
      {
        title: "Plantaxa 2026",
        initiativ_typ: "styrelseforslag",
        initiators: [],
        category: "ekonomi",
        status: "avgjort",
        diarienummer: "2025.489 KS",
        steps: [
          {
            step_id: "s-1",
            instance: "kommunfullmaktige",
            type: "beslut",
            date: "2026-02-25",
            quote: "Ny plantaxa enligt plan- och bygglagen fastställs och börjar gälla den 1 mars 2026.",
            source: { protocol_ref: "§42 KF 2026-02-25" },
          },
        ],
      },
    ],
  });

  const result = parseExtractionResponse(mockLlmResponse);
  assert.equal(result.ok, true);
  const quote = result.arenden[0].steps[0].quote;
  // Samma normaliseringsregel som verbatim-gate.js (R2): whitespace kollapsas, sedan substrängmatchning.
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  assert.ok(normalize(sourceText).includes(normalize(quote)), "citatet ska klara verbatimgrinden");
});
