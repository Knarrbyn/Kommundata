#!/usr/bin/env node
/**
 * scripts/backfill-mandatperiod-field.mjs
 *
 * ENGÅNGSSKRIPT (men säkert att köra om — helt idempotent): fyller i
 * `mandatperioder`/`mandatperiod` på ALL befintlig, redan publicerad data
 * i data/published/arenden.json och data/published/moten.json, och bygger
 * om dist/ därefter.
 *
 * Behövs eftersom src/mandatperiod.ts (se DECISION_LOG.md,
 * mandatperiod-filtrering, 2026-09-27) lades till EFTER att 3000+ ärenden
 * och 480+ möten redan fanns i databasen. Vecko-/backfill-pipelinen fyller
 * i fältet automatiskt framåt (de anropar addMandatperioder() på hela
 * publishedDb varje körning), men den befintliga datan behöver fyllas i
 * en gång manuellt så att /sok och /namnd/[slug] fungerar korrekt direkt,
 * utan att vänta på nästa veckokörning.
 *
 * Helt offline — inget nätverk, ingen API-nyckel. Rör INTE
 * data/publish/changelog.json (ingen ny "riktig" ärendeförändring har
 * skett, bara ett nytt härlett fält) men uppdaterar last-published.json
 * och data_hash.txt så de speglar den nya, kompletta datan.
 *
 * Körs så här:
 *   node --experimental-strip-types scripts/backfill-mandatperiod-field.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { addMandatperioder, deriveMandatperiod } from "../src/mandatperiod.ts";
import { canonicalize, computeDataHash } from "../src/publish.ts";
import { canonicalizeMoten } from "../src/moten.ts";
import { renderSite } from "../src/build.ts";

async function main() {
  const arendenRaw = await readFile("data/published/arenden.json", "utf-8");
  const arenden = JSON.parse(arendenRaw);
  const motenRaw = await readFile("data/published/moten.json", "utf-8");
  const moten = JSON.parse(motenRaw);

  const arendenMedPeriod = addMandatperioder(arenden);
  const motenMedPeriod = moten.map((m) => ({ ...m, mandatperiod: deriveMandatperiod(m.date) }));

  const canonicalArenden = canonicalize(arendenMedPeriod);
  const dataHash = computeDataHash(arendenMedPeriod);
  const canonicalMoten = canonicalizeMoten(motenMedPeriod);

  await writeFile("data/published/arenden.json", JSON.stringify(canonicalArenden, null, 2) + "\n");
  await writeFile("data/publish/last-published.json", JSON.stringify(canonicalArenden, null, 2) + "\n");
  await writeFile("data/publish/data_hash.txt", dataHash + "\n");
  await writeFile("data/published/moten.json", JSON.stringify(canonicalMoten, null, 2) + "\n");

  const html = await renderSite(arendenMedPeriod, motenMedPeriod);
  await mkdir("dist/api", { recursive: true });
  await writeFile("dist/index.html", html);
  await writeFile("dist/api/arenden.json", JSON.stringify(arendenMedPeriod, null, 2));
  await writeFile("dist/api/moten.json", JSON.stringify(motenMedPeriod, null, 2));

  const periodCounts = {};
  for (const a of arendenMedPeriod) {
    for (const p of a.mandatperioder) periodCounts[p] = (periodCounts[p] || 0) + 1;
  }
  console.error(`Klart. ${arendenMedPeriod.length} ärenden, ${motenMedPeriod.length} möten uppdaterade.`);
  console.error("Ärenden per mandatperiod (ett ärende kan räknas i flera om det spänner ett årsskifte):");
  for (const [p, n] of Object.entries(periodCounts).sort()) console.error(`  ${p}: ${n}`);
  console.error(`data_hash: ${dataHash}`);
}

main().catch((err) => {
  console.error("Ohanterat fel i backfill-mandatperiod-field.mjs:", err);
  process.exit(1);
});
