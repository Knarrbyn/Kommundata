import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalize,
  computeDataHash,
  diffPublishedData,
  buildChangelogEntry,
  preparePublish,
} from "../src/publish.ts";
import type { PublishedArende } from "../src/link.ts";

// ---------------------------------------------------------------------
// Fixtur baserad på det riktiga ärendet i case-48-valmojlighet-vardig-
// vard.json (motion om "valmöjlighet i värdig vård", VON 2026-02-18 →
// KF 2026-05-06) — samma ärende testriggen använde för att bevisa R7.
// Förkortad till det som är relevant för publish-steget.
// ---------------------------------------------------------------------
function vonSteg() {
  return {
    step_id: "s-2026-von-271",
    instance: "vard_och_omsorgsnamnden",
    type: "namndyttrande",
    date: "2026-02-18",
    quote: "Med 7 ja-röster och 6 nej-röster finner ordföranden att nämnden beslutar att anse motionen besvarad.",
    decision: "ingen rekommendation",
    voting: { recorded: true, question: "Ja-röst för att motionen ska anses besvarad. Nej-röst för att motionen ska tillstyrkas." },
    reservations: [],
    source: { protocol_ref: "§2 VON 2026-02-18" },
  };
}

function kfBeslutSteg() {
  return {
    step_id: "s-2026-kf-beslut-271",
    instance: "kommunfullmaktige",
    type: "beslut",
    date: "2026-05-06",
    quote: "Med 20 ja-röster och 26 nej-röster finner ordföranden att kommunfullmäktige beslutar att motionen ska anses besvarad.",
    decision: "besvarad",
    voting: { recorded: true, question: "Ja-röst för bifall..." },
    reservations: [],
    source: { protocol_ref: "§92 KF 2026-05-06" },
  };
}

function baseArende(overrides: Partial<PublishedArende> = {}): PublishedArende {
  return {
    id: "a-2025-0271",
    title: "Motion gällande rätt till valmöjlighet i värdig vård",
    initiativ_typ: "motion",
    initiators: [
      { name: "Gunilla Gomér", party: "sd" },
      { name: "Kjerstin Hansson", party: "sd" },
    ],
    category: "vård-omsorg",
    status: "avgjort",
    diarienummer: "2025.511 KS",
    steps: [vonSteg()],
    ...overrides,
  } as PublishedArende;
}

test("canonicalize: sorterar objektnycklar rekursivt (alfabetiskt) men rör aldrig array-ordning", () => {
  const input = { title: "B", id: "a-1", steps: [{ z: 1, a: 2 }, { b: 1, a: 1 }] };
  const canonical = canonicalize(input) as any;
  assert.deepEqual(Object.keys(canonical), ["id", "steps", "title"]);
  assert.deepEqual(Object.keys(canonical.steps[0]), ["a", "z"]);
  // Array-ELEMENTENS ordning (kronologisk stegordning, R1) är orörd:
  assert.equal(canonical.steps[0].z, 1);
  assert.equal(canonical.steps[1].b, 1);
});

test("canonicalize: rör inte primitiver eller null", () => {
  assert.equal(canonicalize("motion"), "motion");
  assert.equal(canonicalize(42), 42);
  assert.equal(canonicalize(null), null);
  assert.equal(canonicalize(true), true);
});

test("computeDataHash: stabil oavsett i vilken ordning fälten kom in", () => {
  const a = { id: "x", title: "Y", steps: [] };
  const b = { steps: [], title: "Y", id: "x" };
  assert.equal(computeDataHash(a), computeDataHash(b));
});

test("computeDataHash: ändrar sig när INNEHÅLLET faktiskt ändras", () => {
  const a = { id: "x", steps: [] };
  const b = { id: "x", steps: [{ step_id: "s-1" }] };
  assert.notEqual(computeDataHash(a), computeDataHash(b));
});

test("computeDataHash: array-ordning påverkar hashen (semantiskt meningsfull, R1)", () => {
  const a = { steps: ["motion", "beslut"] };
  const b = { steps: ["beslut", "motion"] };
  assert.notEqual(computeDataHash(a), computeDataHash(b), "kronologisk stegordning ska INTE kunna kastas om tyst");
});

test("diffPublishedData: identifierar ett helt nytt ärende (id saknas i föregående)", () => {
  const previous: PublishedArende[] = [];
  const current: PublishedArende[] = [baseArende()];
  const diff = diffPublishedData(previous, current);
  assert.deepEqual(diff.new_arenden, ["a-2025-0271"]);
  assert.deepEqual(diff.updated_arenden, []);
});

test("diffPublishedData: ett nytt steg på ett KÄNT ärende räknas som uppdatering, inte nytt ärende", () => {
  const previous: PublishedArende[] = [baseArende({ steps: [vonSteg()] })];
  const current: PublishedArende[] = [baseArende({ steps: [vonSteg(), kfBeslutSteg()] })];
  const diff = diffPublishedData(previous, current);
  assert.deepEqual(diff.new_arenden, []);
  assert.deepEqual(diff.updated_arenden, [{ id: "a-2025-0271", new_step_ids: ["s-2026-kf-beslut-271"] }]);
});

test("diffPublishedData: inga förändringar → tomma listor", () => {
  const snapshot: PublishedArende[] = [baseArende()];
  const diff = diffPublishedData(snapshot, snapshot);
  assert.deepEqual(diff.new_arenden, []);
  assert.deepEqual(diff.updated_arenden, []);
});

test("diffPublishedData: ett ärende som försvann ur current flaggas INTE som fel — bara frånvarande ur diffen", () => {
  const previous: PublishedArende[] = [baseArende(), baseArende({ id: "a-2025-0999", title: "Annat ärende", steps: [] })];
  const current: PublishedArende[] = [baseArende()];
  const diff = diffPublishedData(previous, current);
  assert.deepEqual(diff.new_arenden, []);
  assert.deepEqual(diff.updated_arenden, []);
});

test("buildChangelogEntry: bygger en komplett post med run_id, hash och antal", () => {
  const previous: PublishedArende[] = [];
  const current: PublishedArende[] = [baseArende()];
  const hash = computeDataHash(current);
  const entry = buildChangelogEntry(previous, current, "run-2026-07-20T06:00", hash, "2026-07-20T06:00:00.000Z");
  assert.equal(entry.run_id, "run-2026-07-20T06:00");
  assert.equal(entry.data_hash, hash);
  assert.equal(entry.arende_count, 1);
  assert.deepEqual(entry.new_arenden, ["a-2025-0271"]);
});

test("preparePublish: kombinerar kanonisering, hash och changelog i ett svep", () => {
  const previous: PublishedArende[] = [baseArende({ steps: [vonSteg()] })];
  const current: PublishedArende[] = [baseArende({ steps: [vonSteg(), kfBeslutSteg()] })];
  const result = preparePublish(current, previous, "run-1");

  assert.equal(result.dataHash, computeDataHash(current));
  assert.equal(result.changelogEntry.updated_arenden.length, 1);
  assert.equal(result.changelogEntry.updated_arenden[0].id, "a-2025-0271");

  // canonical ska ha sorterade nycklar men samma stegordning (kronologisk)
  const canonicalArende = (result.canonical as any[])[0];
  assert.deepEqual(
    canonicalArende.steps.map((s: any) => s.step_id),
    ["s-2026-von-271", "s-2026-kf-beslut-271"]
  );
});

test("preparePublish: två körningar med identiskt innehåll ger identisk hash (idempotent)", () => {
  const current: PublishedArende[] = [baseArende()];
  const run1 = preparePublish(current, [], "run-1");
  const run2 = preparePublish(current, [], "run-2");
  assert.equal(run1.dataHash, run2.dataHash);
});
