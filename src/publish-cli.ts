/**
 * publish-cli.ts — körbar ingångspunkt för publish-steget (spec §5, steg 8).
 *
 * Körs så här:
 *   node --experimental-strip-types src/publish-cli.ts [run-id]
 *
 * Läser `data/published/arenden.json` (den "levande databasen" som
 * link-cli.ts skriver till), kanoniserar den, räknar ut en data_hash,
 * jämför mot föregående körnings snapshot (`data/publish/last-published.json`)
 * och skriver en changelog-post. Helt offline — inget nätverk eller
 * API-nyckel krävs, precis som gates och link.
 *
 * git-commit görs INTE här. CI (GitHub Actions) committar de skrivna
 * filerna som ett separat steg efter att detta CLI körts klart — se
 * kommentaren i publish.ts för varför.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { preparePublish } from "./publish.ts";
import type { PublishedArende } from "./link.ts";
import type { ChangelogEntry } from "./publish.ts";

const PUBLISHED_PATH = "data/published/arenden.json";
const LAST_SNAPSHOT_PATH = "data/publish/last-published.json";
const CHANGELOG_PATH = "data/publish/changelog.json";
const DATA_HASH_PATH = "data/publish/data_hash.txt";

async function loadJsonOrEmpty<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  const [, , runIdArg] = process.argv;
  const runId = runIdArg ?? new Date().toISOString();

  const current: PublishedArende[] = await loadJsonOrEmpty(PUBLISHED_PATH, []);
  if (current.length === 0) {
    console.error(`Inget att publicera — ${PUBLISHED_PATH} saknas eller är tom. Kör link-cli.ts först.`);
    process.exit(1);
  }

  const previous: PublishedArende[] = await loadJsonOrEmpty(LAST_SNAPSHOT_PATH, []);
  const existingChangelog: ChangelogEntry[] = await loadJsonOrEmpty(CHANGELOG_PATH, []);

  const { canonical, dataHash, changelogEntry } = preparePublish(current, previous, runId);

  await mkdir("data/publish", { recursive: true });

  // Kanonisera själva "levande databasen" på plats också, så downstream-
  // steg (build) och nästa körnings gates/link alltid läser samma
  // fältordning.
  await writeFile(PUBLISHED_PATH, JSON.stringify(canonical, null, 2) + "\n");
  await writeFile(LAST_SNAPSHOT_PATH, JSON.stringify(canonical, null, 2) + "\n");
  await writeFile(DATA_HASH_PATH, dataHash + "\n");
  await writeFile(CHANGELOG_PATH, JSON.stringify([...existingChangelog, changelogEntry], null, 2) + "\n");

  console.error(`data_hash: ${dataHash}`);
  console.error(
    `Nya ärenden: ${changelogEntry.new_arenden.length}, uppdaterade ärenden: ${changelogEntry.updated_arenden.length}, totalt: ${changelogEntry.arende_count}`
  );
  if (changelogEntry.new_arenden.length === 0 && changelogEntry.updated_arenden.length === 0) {
    console.error("Ingen förändring sedan förra körningen — inget nytt att committa.");
  }
  console.error(`\nSkrivet: ${PUBLISHED_PATH}, ${LAST_SNAPSHOT_PATH}, ${DATA_HASH_PATH}, ${CHANGELOG_PATH}`);
  console.error("OBS: git-commit görs INTE av detta script — det är CI:s ansvar (se publish.ts).");
}

main().catch((err) => {
  console.error("Ohanterat fel i publish-cli.ts:", err);
  process.exit(1);
});
