import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSameCaseArenden, findSameCaseGroups, type PublishedArende } from "../src/link.ts";

// Riktiga data från "Kavlås ängar"-paret (diarienummer 2024.147 KS),
// hämtade direkt ur produktionsdatan (arenden.json) 2026-07-25 — se
// DECISION_LOG.md för sammanhanget. Förkortade citat för läsbarhet i
// testfilen, men datum/instans/decision/step_id är exakt som i original.
const A_2024_0001: PublishedArende = {
  id: "a-2024-0001",
  title: "Kavlås ängar - Utvidgning av verksamhetsområde för allmän dricksvatten-, spillvatten- och dagvattenanläggning",
  diarienummer: "2024.147 KS",
  category: "infrastruktur",
  initiativ_typ: "styrelseforslag",
  initiators: [],
  status: "avgjort",
  steps: [
    {
      step_id: "ten-beslut-86",
      date: "2024-03-18",
      instance: "tekniska-namnden",
      type: "beredning",
      decision: null,
      quote: "Tekniska nämnden beslutade den 18 mars 2024, § 15 att utvidga verksamhetsområde i enlighet med bifogat underlag och skicka vidare för fastställande i kommunfullmäktige.",
      source: { protocol_ref: "§86 KOMMUNFULLMAKTIGE 2024-05-29" },
    },
    {
      step_id: "ks-beslut-86",
      date: "2024-05-06",
      instance: "kommunstyrelsen",
      type: "beredning",
      decision: null,
      quote: "Kommunstyrelsen har den 6 maj 2024, § 67 behandlat ärendet.",
      source: { protocol_ref: "§86 KOMMUNFULLMAKTIGE 2024-05-29" },
    },
    {
      step_id: "kf-beslut-86",
      date: "2024-05-29",
      instance: "kommunfullmaktige",
      type: "beslut",
      decision: "bifall",
      quote: "Utvidgning av verksamhetsområde Kavlås ängar i enlighet med kartbilaga 1 och fastighetslista bilaga 2 fastställs.",
      source: { protocol_ref: "§86 KOMMUNFULLMAKTIGE 2024-05-29" },
    },
  ],
};

const A_2024_0427: PublishedArende = {
  id: "a-2024-0427",
  title: "Kavlås ängar - Utvidgning av verksamhetsområde för allmän dricksvatten-, spillvatten- och dagvattenanläggning",
  diarienummer: "2024.147 KS",
  category: "infrastruktur",
  initiativ_typ: "styrelseforslag",
  initiators: [],
  status: "pågående",
  steps: [
    {
      step_id: "ten-beslut-2024-03-18",
      date: "2024-03-18",
      instance: "tekniska-namnden",
      type: "namndyttrande",
      decision: "tillstyrker",
      quote: "Tekniska nämnden beslutade den 18 mars 2024, § 15 att utvidga verksamhetsområde i enlighet med bifogat underlag och skicka vidare för fastställande i kommunfullmäktige.",
      source: { protocol_ref: "§67 KOMMUNSTYRELSEN 2024-05-06" },
    },
    {
      step_id: "ksau-beredning-2024-04-24",
      date: "2024-04-24",
      instance: "kommunstyrelsen",
      type: "beredning",
      decision: null,
      quote: "Kommunstyrelsens arbetsutskott har den 24 april 2024, § 73 behandlat ärendet.",
      source: { protocol_ref: "§67 KOMMUNSTYRELSEN 2024-05-06" },
    },
    {
      step_id: "ks-beslut-2024-05-06",
      date: "2024-05-06",
      instance: "kommunstyrelsen",
      type: "beslut",
      decision: "bifall",
      quote: "Utvidgning av verksamhetsområde Kavlås ängar i enlighet med kartbilaga 1 och fastighetslista bilaga 2 fastställs.",
      source: { protocol_ref: "§67 KOMMUNSTYRELSEN 2024-05-06" },
    },
  ],
};

test("mergeSameCaseArenden: Kavlås ängar (riktigt exempel) — 4 unika steg, väljer versionen med ifyllt beslut vid krock", () => {
  const result = mergeSameCaseArenden([A_2024_0001, A_2024_0427]);

  assert.equal(result.merged.steps.length, 4, "ska ha 4 unika (datum,instans)-steg efter sammanslagning");

  const byDate = Object.fromEntries(result.merged.steps.map((s) => [s.date, s]));

  // 2024-03-18: krock — ska välja a-2024-0427:s version (decision=tillstyrker), inte a-2024-0001:s (decision=null)
  assert.equal(byDate["2024-03-18"].decision, "tillstyrker");
  assert.equal(byDate["2024-03-18"].step_id, "ten-beslut-2024-03-18");

  // 2024-04-24: fanns bara i a-2024-0427, ska finnas med
  assert.ok(byDate["2024-04-24"], "det unika KSAU-steget ska finnas med");

  // 2024-05-06: krock — ska välja a-2024-0427:s version (decision=bifall), inte a-2024-0001:s (decision=null)
  assert.equal(byDate["2024-05-06"].decision, "bifall");
  assert.equal(byDate["2024-05-06"].step_id, "ks-beslut-2024-05-06");

  // 2024-05-29: fanns bara i a-2024-0001, ska finnas med
  assert.ok(byDate["2024-05-29"], "KF-beslutssteget ska finnas med");

  // Status: minst en sida (a-2024-0001) var "avgjort" -> den sanna bilden är avgjort
  assert.equal(result.merged.status, "avgjort");

  // Steg ska vara kronologiskt sorterade
  const dates = result.merged.steps.map((s) => s.date);
  assert.deepEqual(dates, [...dates].sort());

  // Basen (flest steg innan sammanslagning — här lika, 3 vs 3, så första i array vinner) ska vara id:t
  assert.ok(["a-2024-0001", "a-2024-0427"].includes(result.merged.id));
  assert.equal(result.droppedIds.length, 1);
  assert.equal(result.conflicts.length, 0, "inga category/initiativ_typ-konflikter i det här fallet");
});

test("mergeSameCaseArenden: kastar fel om diarienummer skiljer sig", () => {
  const a = { ...A_2024_0001, diarienummer: "OLIKA.001" };
  assert.throws(() => mergeSameCaseArenden([a, A_2024_0427]), /diarienummer skiljer sig/);
});

test("mergeSameCaseArenden: kastar fel om titel skiljer sig", () => {
  const a = { ...A_2024_0001, title: "En helt annan titel" };
  assert.throws(() => mergeSameCaseArenden([a, A_2024_0427]), /titel skiljer sig/);
});

test("mergeSameCaseArenden: unionerar initiators utan dubbletter", () => {
  const a = { ...A_2024_0001, initiators: [{ name: "Anna Andersson", party: "s" }] };
  const b = { ...A_2024_0427, initiators: [{ name: "Anna Andersson", party: "s" }, { name: "Bo Berg", party: "m" }] };
  const result = mergeSameCaseArenden([a, b]);
  assert.equal(result.merged.initiators.length, 2);
});

test("mergeSameCaseArenden: flaggar konflikt om category skiljer sig mellan käll-poster", () => {
  const a = { ...A_2024_0001, category: "infrastruktur" };
  const b = { ...A_2024_0427, category: "ekonomi" };
  const result = mergeSameCaseArenden([a, b]);
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0], /category/);
});

test("findSameCaseGroups: hittar Kavlås ängar-paret men slår inte ihop olika titlar/diarienummer", () => {
  const other = { ...A_2024_0001, id: "a-9999-9999", diarienummer: "9999.999 KS", title: "Ett annat ärende" };
  const groups = findSameCaseGroups([A_2024_0001, A_2024_0427, other]);
  assert.equal(groups.length, 1, "bara EN grupp — det unika ärendet ska inte bilda en grupp ensamt");
  assert.equal(groups[0].length, 2);
});

test("mergeSameCaseArenden: kräver minst två poster", () => {
  assert.throws(() => mergeSameCaseArenden([A_2024_0001]), /minst två poster/);
});
