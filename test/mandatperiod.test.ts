import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveMandatperiod,
  deriveMandatperioder,
  currentMandatperiod,
  addMandatperioder,
} from "../src/mandatperiod.ts";

test("deriveMandatperiod: datum mitt i en period", () => {
  assert.equal(deriveMandatperiod("2024-06-15"), "2022-2026");
  assert.equal(deriveMandatperiod("2028-03-01"), "2026-2030");
});

test("deriveMandatperiod: valåret självt hör ÄNNU till föregående period (global brytpunkt 1 januari)", () => {
  // Ägarbeslut 2026-09-05: fullmäktige tillträder juridiskt redan 15
  // oktober valåret, men sajten använder ETT globalt brytdatum för
  // enkelhets skull — hela 2026 (inkl. valdagen 13 september och tiden
  // därefter) räknas som "2022-2026" på sajten.
  assert.equal(deriveMandatperiod("2026-01-01"), "2022-2026");
  assert.equal(deriveMandatperiod("2026-09-13"), "2022-2026", "valdagen själv");
  assert.equal(deriveMandatperiod("2026-12-31"), "2022-2026", "sista dagen på året, fortfarande gamla perioden");
});

test("deriveMandatperiod: brytpunkten är exakt 1 januari påföljande år", () => {
  assert.equal(deriveMandatperiod("2027-01-01"), "2026-2030");
});

test("deriveMandatperiod: fungerar bakåt i tiden också (historisk data)", () => {
  assert.equal(deriveMandatperiod("2020-05-01"), "2018-2022");
  assert.equal(deriveMandatperiod("2015-01-01"), "2014-2018");
});

test("deriveMandatperiod: kastar tydligt fel på ogiltigt datum", () => {
  assert.throws(() => deriveMandatperiod("inte-ett-datum"));
  assert.throws(() => deriveMandatperiod(""));
});

test("deriveMandatperioder: ett ärende helt inom en period ger en enda post", () => {
  assert.deepEqual(deriveMandatperioder(["2025-01-10", "2025-06-01"]), ["2022-2026"]);
});

test("deriveMandatperioder: ett ärende som sträcker sig över årsskiftet 2026/2027 ger båda perioderna, kronologiskt sorterat", () => {
  assert.deepEqual(deriveMandatperioder(["2026-11-03", "2027-02-10"]), ["2022-2026", "2026-2030"]);
});

test("deriveMandatperioder: dedupar — flera datum i samma period ger bara en post", () => {
  assert.deepEqual(deriveMandatperioder(["2025-01-01", "2025-06-01", "2026-12-31"]), ["2022-2026"]);
});

test("deriveMandatperioder: tom lista ger tom array", () => {
  assert.deepEqual(deriveMandatperioder([]), []);
});

test("deriveMandatperioder: ordningen på indata spelar ingen roll — resultatet är alltid kronologiskt", () => {
  assert.deepEqual(deriveMandatperioder(["2027-03-01", "2020-01-01", "2025-01-01"]), ["2018-2022", "2022-2026", "2026-2030"]);
});

test("currentMandatperiod: härleder från ett godtyckligt 'nu'-datum (testbarhet)", () => {
  assert.equal(currentMandatperiod(new Date("2026-09-27T12:00:00Z")), "2022-2026");
  assert.equal(currentMandatperiod(new Date("2027-01-01T00:00:00Z")), "2026-2030");
});

function arende(steps: Array<{ date: string }>) {
  return { id: "a-x", steps };
}

test("addMandatperioder: lägger till fältet på varje ärende utan att mutera indata", () => {
  const input = [arende([{ date: "2025-01-01" }]), arende([{ date: "2026-11-01" }, { date: "2027-02-01" }])];
  const result = addMandatperioder(input);
  assert.deepEqual(result[0].mandatperioder, ["2022-2026"]);
  assert.deepEqual(result[1].mandatperioder, ["2022-2026", "2026-2030"]);
  assert.equal((input[0] as any).mandatperioder, undefined, "ursprungsobjektet ska vara orört");
});

test("addMandatperioder: bevarar alla ursprungliga fält oförändrade", () => {
  const input = [{ id: "a-2025-0001", title: "Testärende", steps: [{ date: "2025-05-05" }] }];
  const result = addMandatperioder(input);
  assert.equal(result[0].id, "a-2025-0001");
  assert.equal(result[0].title, "Testärende");
  assert.deepEqual(result[0].mandatperioder, ["2022-2026"]);
});
