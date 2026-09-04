import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMotesEntry, upsertMotesIndex, canonicalizeMoten } from "../src/moten.ts";

test("buildMotesEntry: rent informationsmöte får tom arende_ids-array, inte null/undefined", () => {
  const m = buildMotesEntry("kommunfullmaktige", "2026-02-25", "https://example.se/protokoll.pdf", []);
  assert.deepEqual(m.arende_ids, []);
  assert.equal(m.archive_url, null);
});

test("buildMotesEntry: arende_ids sorteras deterministiskt", () => {
  const m = buildMotesEntry("kommunstyrelsen", "2026-03-16", "https://x.se/p.pdf", ["a-2026-0099", "a-2026-0001"]);
  assert.deepEqual(m.arende_ids, ["a-2026-0001", "a-2026-0099"]);
});

test("upsertMotesIndex: nytt möte läggs till, sorterat kronologiskt inom samma instans", () => {
  const existing = [buildMotesEntry("kommunstyrelsen", "2026-01-10", "url1", [])];
  const result = upsertMotesIndex(existing, buildMotesEntry("kommunstyrelsen", "2026-03-16", "url2", []));
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((m) => m.date), ["2026-01-10", "2026-03-16"]);
});

test("upsertMotesIndex: samma instans+datum ersätter, skapar inte en dubblett", () => {
  const existing = [buildMotesEntry("kommunstyrelsen", "2026-03-16", "url-gammal", [])];
  const result = upsertMotesIndex(
    existing,
    buildMotesEntry("kommunstyrelsen", "2026-03-16", "url-gammal", ["a-2026-0063"])
  );
  assert.equal(result.length, 1, "ska fortfarande vara EN post, inte två");
  assert.deepEqual(result[0].arende_ids, ["a-2026-0063"], "arende_ids ska uppdateras vid omkörning");
});

test("upsertMotesIndex: en tidigare ifylld archive_url tappas inte om den nya posten saknar den", () => {
  const withArchive: ReturnType<typeof buildMotesEntry> = {
    ...buildMotesEntry("kommunstyrelsen", "2026-03-16", "url", []),
    archive_url: "https://web.archive.org/web/xyz",
  };
  const result = upsertMotesIndex([withArchive], buildMotesEntry("kommunstyrelsen", "2026-03-16", "url", ["a-2026-0063"]));
  assert.equal(result[0].archive_url, "https://web.archive.org/web/xyz", "archive_url ska bevaras, inte skrivas över med null");
  assert.deepEqual(result[0].arende_ids, ["a-2026-0063"], "men arende_ids ska ändå uppdateras");
});

test("upsertMotesIndex: olika instanser blandas inte ihop trots samma datum", () => {
  const existing = [buildMotesEntry("kommunstyrelsen", "2026-03-16", "url-ks", [])];
  const result = upsertMotesIndex(existing, buildMotesEntry("kommunfullmaktige", "2026-03-16", "url-kf", []));
  assert.equal(result.length, 2, "samma datum, olika instans = två separata möten");
});

test("upsertMotesIndex: sortering är instans-först, sedan datum inom instansen", () => {
  const result = upsertMotesIndex(
    [
      buildMotesEntry("kommunstyrelsen", "2026-05-01", "u1", []),
      buildMotesEntry("barn-och-ungdomsnamnden", "2026-01-01", "u2", []),
    ],
    buildMotesEntry("kommunstyrelsen", "2026-01-01", "u3", [])
  );
  assert.deepEqual(
    result.map((m) => `${m.instance} ${m.date}`),
    ["barn-och-ungdomsnamnden 2026-01-01", "kommunstyrelsen 2026-01-01", "kommunstyrelsen 2026-05-01"]
  );
});

test("canonicalizeMoten: sorterar objektnycklar rekursivt men bevarar array-ordning", () => {
  const moten = [buildMotesEntry("kommunstyrelsen", "2026-01-01", "url", ["a-1"])];
  const canon = canonicalizeMoten(moten) as Array<Record<string, unknown>>;
  assert.deepEqual(Object.keys(canon[0]), ["archive_url", "arende_ids", "date", "instance", "protocol_pdf_url"].sort());
});
