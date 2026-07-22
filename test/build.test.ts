import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import {
  renderSite,
  injectArendenData,
  escapeForInlineScript,
} from "../src/build.ts";
import type { PublishedArende } from "../src/link.ts";

const TEMPLATE_PATH = new URL("../templates/site.html", import.meta.url);

// ---------------------------------------------------------------------
// Fixtur: två riktiga ärenden från testriggen (case-45-vattenlek.json
// och case-51-initiativarende-parkering.json), förkortade. Vattenlek-
// ärendet bär det 43-ords citatet som är R2-fyndets bevis (gates.ts) —
// här används det för att bekräfta att den RIKTIGA mallen inte trasar
// sönder långa, semantiskt viktiga citat vid escaping. Sista steget har
// dessutom ett konstruerat citat med citattecken, en </script>-sekvens
// och en radbrytning, för att stresstesta escapeForInlineScript.
// ---------------------------------------------------------------------
const VATTENLEK: PublishedArende = {
  id: "a-2025-0368",
  title: "Motion om vattenlek i Alingsås",
  initiativ_typ: "motion",
  initiators: [
    { name: "Marcus Wallin", party: "v" },
    { name: "Sanna Dabolins", party: "v" },
  ],
  category: "infrastruktur",
  status: "avgjort",
  diarienummer: "2025.368 KS",
  steps: [
    {
      step_id: "s-2025-motion-368",
      instance: "kommunfullmaktige",
      type: "motion_inlamnad",
      date: "2025-09-03",
      quote: "Att Alingsås anlägger minst en offentlig vattenlek/plaskdamm i kommunen.",
      source: { protocol_ref: "§172 KF 2025-09-03", pdf_url: "https://example.org/motion.pdf" },
    },
    {
      step_id: "s-2025-tn-368",
      instance: "tekniska_namnden",
      type: "namndyttrande",
      date: "2025-12-15",
      quote:
        "Tekniska nämnden beslutade att avstyrka motionens första att-sats med förslag att minst en offentlig vattenlek/plaskdamm ska anläggas i kommunen, och att tillstyrka motionens andra att-sats, om att vattenlekplatserna ska utformas tillgängliga för barn med olika funktionsvariationer och med sitt- och skuggplatser till medföljande.",
      decision: "delvis",
      voting: { recorded: false, note: "Röstfördelning ej redovisad i protokollet" },
      reservations: [],
      source: { protocol_ref: "§62 TEN 2025-12-15", pdf_url: "https://example.org/ten.pdf" },
    },
    {
      step_id: "s-2026-kf-beslut-368",
      instance: "kommunfullmaktige",
      type: "beslut",
      date: "2026-02-25",
      quote: 'Motionen avslås. Ett citat med "citattecken", en </script>-tagg och en rad-\nbrytning.',
      decision: "avslag",
      voting: { recorded: false, note: "Röstfördelning ej redovisad i protokollet" },
      reservations: [{ parties: ["m", "kd"], quote: "Vi reserverar oss.", source: { protocol_ref: "§45 KF 2026-02-25" } }],
      protocol_anteckning: [{ parties: ["c"], quote: "En anteckning.", source: { protocol_ref: "§45 KF 2026-02-25" } }],
      source: { protocol_ref: "§45 KF 2026-02-25", pdf_url: "https://example.org/kf.pdf" },
    },
  ],
} as PublishedArende;

const PARKERING: PublishedArende = {
  id: "a-2026-0288-init-parkering",
  title: "Initiativärende gällande utökad parkeringskapacitet vid Nolhaga",
  initiativ_typ: "initiativarende",
  initiators: [{ name: "Jan-Erik Wallin", party: "m" }],
  category: "infrastruktur",
  status: "avgjort",
  diarienummer: "2026.288 KS",
  steps: [
    {
      step_id: "s-2026-init-vackt-parkering",
      instance: "kommunstyrelsen",
      type: "initiativarende_vackt",
      date: "2026-06-01",
      quote: "Utredning av utökad parkeringskapacitet vid Nolhaga.",
      source: { protocol_ref: "§110 KS 2026-06-01" },
    },
  ],
} as PublishedArende;

test("escapeForInlineScript: bryter en </script>-sekvens så den inte avslutar scriptblocket", () => {
  const json = JSON.stringify({ quote: "Ett citat med </script> mitt i." });
  const escaped = escapeForInlineScript(json);
  assert.ok(!escaped.includes("</script>"));
  assert.ok(escaped.includes("<\\/script>"));
});

test("escapeForInlineScript: escapar U+2028/U+2029", () => {
  const json = JSON.stringify({ q: "rad1\u2028rad2\u2029rad3" });
  const escaped = escapeForInlineScript(json);
  assert.ok(!escaped.includes("\u2028"));
  assert.ok(!escaped.includes("\u2029"));
  assert.ok(escaped.includes("\\u2028"));
});

test("injectArendenData: kastar ett TYDLIGT fel om platshållaren saknas, istället för att tyst skriva en trasig sida", () => {
  assert.throws(() => injectArendenData("<html>ingen platshållare här</html>", [VATTENLEK]), /Platshållaren.*hittades inte/);
});

test("injectArendenData: ersätter platshållaren och lämnar resten av mallen orörd", () => {
  const template = '<html><script>const ARENDEN = __ARENDEN_JSON__;\nconsole.log("orörd kod");</script></html>';
  const result = injectArendenData(template, [VATTENLEK]);
  assert.ok(!result.includes("__ARENDEN_JSON__"));
  assert.ok(result.includes('console.log("orörd kod");'));
  assert.ok(result.includes("Motion om vattenlek i Alingsås"));
});

test("templates/site.html: den RIKTIGA mallfilen innehåller fortfarande platshållaren", async () => {
  const templateHtml = await readFile(TEMPLATE_PATH, "utf-8");
  assert.ok(templateHtml.includes("__ARENDEN_JSON__"), "platshållaren saknas i templates/site.html");
  assert.ok(templateHtml.includes("verifyStamp"), "verifieringsstämpel-funktionen ska finnas kvar orörd");
  assert.ok(templateHtml.includes("viewParti"), "/parti/[kod]-vyn ska finnas kvar orörd");
});

test("renderSite: injicerar data i den RIKTIGA mallfilen och producerar giltig HTML med båda ärendenas titlar", async () => {
  const html = await renderSite([VATTENLEK, PARKERING]);
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.includes("Motion om vattenlek i Alingsås"));
  assert.ok(html.includes("Initiativärende gällande utökad parkeringskapacitet"));
  assert.ok(html.includes("FAKTAGRANSKAREN"), "sajtens wordmark ska finnas kvar från mallen");
});

test("renderSite: det injicerade scriptblocket i DEN RIKTIGA MALLEN är syntaktiskt giltig JavaScript (körs genom vm)", async () => {
  const html = await renderSite([VATTENLEK, PARKERING]);
  const scriptMatch = /<script>([\s\S]*)<\/script>\s*<\/body>/.exec(html);
  assert.ok(scriptMatch, "hittade inget avslutande <script>-block i HTML:en");
  const scriptSource = scriptMatch![1];

  const elements: Record<string, any> = {};
  function makeEl() {
    return { innerHTML: "", classList: { add() {}, remove() {} }, addEventListener() {} };
  }
  const sandbox: any = {
    document: {
      getElementById: (id: string) => (elements[id] ??= makeEl()),
      querySelectorAll: () => [],
      querySelector: () => makeEl(),
      addEventListener() {},
    },
    window: { addEventListener() {}, scrollTo() {} },
    location: { hash: "" },
    console,
  };
  vm.createContext(sandbox);

  assert.doesNotThrow(() => {
    vm.runInContext(scriptSource, sandbox);
  }, "prototypens klientscript, med riktig data injicerad, ska vara giltig körbar JavaScript");
});

test("renderSite: citat med citattecken, radbrytning och en </script>-sekvens överlever end-to-end intakt genom mallens riktiga JS", async () => {
  const html = await renderSite([VATTENLEK]);
  const arendenMatch = /const ARENDEN = ([\s\S]*?);\s*\n\s*function partyPill/.exec(html);
  assert.ok(arendenMatch, "hittade inte ARENDEN-tilldelningen i den renderade mallen");
  const parsed = vm.runInNewContext(arendenMatch![1]);
  const problemQuote = parsed[0].steps[2].quote;
  assert.ok(problemQuote.includes('"citattecken"'));
  assert.ok(problemQuote.includes("</script>"));
  assert.ok(problemQuote.includes("\n"));
});

test("renderSite: det långa 43-ords R2-citatet (vattenlek, det verkliga fyndet i gates.ts) kommer igenom orört", async () => {
  const html = await renderSite([VATTENLEK]);
  assert.ok(
    html.includes(
      "Tekniska n\\u00e4mnden beslutade att avstyrka motionens f\\u00f6rsta att-sats"
    ) || html.includes("Tekniska nämnden beslutade att avstyrka motionens första att-sats"),
    "det 43-ords citatet som bevisar R2-lösningen ska nå ända fram till den renderade sidan"
  );
});
