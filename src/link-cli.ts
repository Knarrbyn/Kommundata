/**
 * link-cli.ts — körbar ingångspunkt för link-steget.
 *
 * Körs så här:
 *   node --experimental-strip-types src/link-cli.ts <archived-arenden.json> <source-text.txt>
 *
 * Läser (om den finns) `data/published/arenden.json` som "databasen" av
 * redan kända ärenden, försöker koppla varje nytt arkiverat ärende till
 * ett befintligt via `linkArende`, och skriver resultatet tillbaka.
 *
 * Helt offline — inget nätverk eller API-nyckel krävs, precis som gates.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { linkArende, generateArendeId, type PublishedArende } from "./link.ts";
import type { CandidateArende } from "./extract.ts";

const PUBLISHED_DB_PATH = "data/published/arenden.json";

async function loadPublishedDb(): Promise<PublishedArende[]> {
  try {
    const raw = await readFile(PUBLISHED_DB_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function main() {
  const [, , archivedPath, sourceTextPath] = process.argv;
  if (!archivedPath || !sourceTextPath) {
    console.error(
      "Användning: node --experimental-strip-types src/link-cli.ts <archived-arenden.json> <source-text.txt>"
    );
    process.exit(1);
  }

  const archivedRaw = await readFile(archivedPath, "utf-8");
  const sourceText = await readFile(sourceTextPath, "utf-8");
  const newArenden: CandidateArende[] = JSON.parse(archivedRaw);

  const publishedDb = await loadPublishedDb();
  const existingIds = new Set(publishedDb.map((a) => a.id));

  for (const candidate of newArenden) {
    const match = linkArende(candidate, sourceText, publishedDb);

    if (match.kind === "paragraph_ref") {
      console.error(
        `✓ "${candidate.title}" → kopplad till befintligt ärende ${match.existing.id} via ${match.matchedOn.raw}`
      );
      match.existing.steps.push(...candidate.steps);
      match.existing.status = candidate.status;
    } else if (match.kind === "fuzzy_title") {
      console.error(
        `~ "${candidate.title}" → sannolikt samma som ${match.existing.id} (titel-likhet ${match.score.toFixed(2)}) — ` +
          `FLAGGAD FÖR MANUELL GRANSKNING, inte auto-sammanslagen (se spec §5 steg 7)`
      );
      // Fuzzy-matchningar slås INTE ihop automatiskt — skapar ett nytt
      // ärende ändå, men med en anteckning som en människa kan agera på.
      const year = parseInt(candidate.steps[0]?.date?.slice(0, 4) ?? new Date().getFullYear().toString(), 10);
      const id = generateArendeId(year, existingIds);
      existingIds.add(id);
      publishedDb.push({ ...candidate, id, _link_flag: `Möjlig dubblett av ${match.existing.id} (titel-likhet ${match.score.toFixed(2)}) — ej auto-sammanslagen` } as PublishedArende);
    } else {
      const year = parseInt(candidate.steps[0]?.date?.slice(0, 4) ?? new Date().getFullYear().toString(), 10);
      const id = generateArendeId(year, existingIds);
      existingIds.add(id);
      console.error(`+ "${candidate.title}" → nytt ärende ${id}`);
      publishedDb.push({ ...candidate, id });
    }
  }

  await mkdir("data/published", { recursive: true });
  await writeFile(PUBLISHED_DB_PATH, JSON.stringify(publishedDb, null, 2));
  console.error(`\nSkrivet: ${PUBLISHED_DB_PATH} (${publishedDb.length} ärenden totalt)`);
}

main().catch((err) => {
  console.error("Ohanterat fel i link-cli.ts:", err);
  process.exit(1);
});
