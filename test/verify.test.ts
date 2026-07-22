import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVerificationPrompt, parseVerificationResponse, reconcile } from "../src/verify.ts";
import type { CandidateArende } from "../src/extract.ts";
import type { GateResult } from "../src/gates.ts";

const SAMPLE_ARENDE: CandidateArende = {
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
      decision: "bifall",
      source: { protocol_ref: "§42 KF 2026-02-25" },
    },
  ],
};

/* ============ Promptbygge ============ */

test("buildVerificationPrompt: innehåller källtext, det extraherade ärendet och en ANNAN vinkel än extract-prompten", () => {
  const prompt = buildVerificationPrompt(SAMPLE_ARENDE, "Källtext här.");
  assert.ok(prompt.includes("Källtext här."), "källtexten ska vara med");
  assert.ok(prompt.includes("Plantaxa 2026"), "det extraherade ärendet ska serialiseras in i prompten");
  assert.ok(/oberoende/i.test(prompt), "prompten ska betona att LLM B inte ska lita blint på LLM A");
  assert.ok(prompt.includes("publish"), "svarsformatet ska specificeras");
  assert.ok(prompt.includes("promptinjektion"), "anti-injektionskontroll ska vara en del av uppdraget");
});

/* ============ Svarsparsning ============ */

test("parseVerificationResponse: giltigt publish-svar", () => {
  const raw = JSON.stringify({ decision: "publish", reasoning: "Allt stämmer.", flagged_issues: [] });
  const result = parseVerificationResponse(raw);
  assert.equal(result.decision, "publish");
  assert.equal(result.flagged_issues.length, 0);
});

test("parseVerificationResponse: giltigt reject-svar med flaggade problem", () => {
  const raw = JSON.stringify({
    decision: "reject",
    reasoning: "Citatet gäller fel instans.",
    flagged_issues: ["instance angavs som kommunfullmaktige men källtexten visar kommunstyrelsen"],
  });
  const result = parseVerificationResponse(raw);
  assert.equal(result.decision, "reject");
  assert.equal(result.flagged_issues.length, 1);
});

test("parseVerificationResponse: strippar markdown-fences", () => {
  const raw = "```json\n" + JSON.stringify({ decision: "review", reasoning: "Oklart.", flagged_issues: [] }) + "\n```";
  const result = parseVerificationResponse(raw);
  assert.equal(result.decision, "review");
});

test("parseVerificationResponse: SÄKER FALLBACK — ogiltig JSON faller tillbaka på 'review', ALDRIG 'publish'", () => {
  const result = parseVerificationResponse("det här är inte JSON {{{");
  assert.equal(result.decision, "review");
  assert.ok(result.flagged_issues.length > 0);
});

test("parseVerificationResponse: SÄKER FALLBACK — ogiltigt decision-värde faller tillbaka på 'review'", () => {
  const raw = JSON.stringify({ decision: "kanske", reasoning: "?", flagged_issues: [] });
  const result = parseVerificationResponse(raw);
  assert.equal(result.decision, "review");
});

test("parseVerificationResponse: SÄKER FALLBACK — saknat decision-fält faller tillbaka på 'review'", () => {
  const raw = JSON.stringify({ reasoning: "Glömde decision-fältet." });
  const result = parseVerificationResponse(raw);
  assert.equal(result.decision, "review");
});

/* ============ reconcile: kombinerar gates (R2) + verify (LLM B) ============ */

function makeGateResult(passed: boolean): GateResult {
  return { arende: SAMPLE_ARENDE, passed, checks: [] };
}

test("reconcile: gate godkänd + verify publish → finalStatus publish", () => {
  const r = reconcile(makeGateResult(true), { decision: "publish", reasoning: "OK", flagged_issues: [] });
  assert.equal(r.finalStatus, "publish");
});

test("reconcile: gate godkänd + verify review → finalStatus needs_review (LLM B kan stoppa trots R2-godkännande)", () => {
  const r = reconcile(makeGateResult(true), { decision: "review", reasoning: "Oklart", flagged_issues: ["x"] });
  assert.equal(r.finalStatus, "needs_review");
});

test("reconcile: gate godkänd + verify reject → finalStatus needs_review", () => {
  const r = reconcile(makeGateResult(true), { decision: "reject", reasoning: "Fel", flagged_issues: ["y"] });
  assert.equal(r.finalStatus, "needs_review");
});

test("reconcile: gate UNDERKÄND + verify publish → finalStatus ÄNDÅ needs_review (gate-godkännande är en förutsättning, inte förbigångsbar)", () => {
  const r = reconcile(makeGateResult(false), { decision: "publish", reasoning: "OK enligt LLM B", flagged_issues: [] });
  assert.equal(r.finalStatus, "needs_review", "publicering ska ALDRIG ske om R2 (ren kod) underkänt ärendet, oavsett vad LLM B säger");
});

test("reconcile: bevarar arende, verifyDecision, reasoning och flaggedIssues i resultatet", () => {
  const r = reconcile(makeGateResult(true), {
    decision: "review",
    reasoning: "Motivering här.",
    flagged_issues: ["problem A", "problem B"],
  });
  assert.equal(r.arende.title, "Plantaxa 2026");
  assert.equal(r.verifyDecision, "review");
  assert.equal(r.reasoning, "Motivering här.");
  assert.deepEqual(r.flaggedIssues, ["problem A", "problem B"]);
  assert.equal(r.gatePassed, true);
});
