/**
 * build-cli.ts — körbar ingångspunkt för build-steget (spec §5, steg 9).
 *
 * Körs så här:
 *   node --experimental-strip-types src/build-cli.ts
 *
 * Läser `data/published/arenden.json` OCH `data/published/moten.json`
 * (det senare valfritt — se nedan) och skriver:
 *   dist/index.html      — den statiska sajten (renderSite, se build.ts)
 *   dist/api/arenden.json — öppet JSON-API, spec §7 (/api)
 *   dist/api/moten.json   — öppet JSON-API för mötesindexet (tillägg
 *                            2026-08-24, se DECISION_LOG.md och src/moten.ts)
 *   CORS sätts av hostingplattformen (Netlify _headers), inte här.
 *
 * Helt offline — inget nätverk eller API-nyckel krävs.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { renderSite } from "./build.ts";
import type { PublishedArende } from "./link.ts";
import type { MotesPost } from "./moten.ts";

const PUBLISHED_PATH = "data/published/arenden.json";
const MOTEN_PATH = "data/published/moten.json";
const OUT_HTML_PATH = "dist/index.html";
const OUT_API_PATH = "dist/api/arenden.json";
const OUT_MOTEN_API_PATH = "dist/api/moten.json";

async function main() {
  let raw: string;
  try {
    raw = await readFile(PUBLISHED_PATH, "utf-8");
  } catch {
    console.error(`Kunde inte läsa ${PUBLISHED_PATH}. Kör link-cli.ts och publish-cli.ts först.`);
    process.exit(1);
    return;
  }

  const arenden: PublishedArende[] = JSON.parse(raw);

  // moten.json är MEDVETET valfri att sakna — filen fanns inte innan
  // 2026-08-24 och en tom mötestidslinje (bara viewNamnd() tomt-fall
  // förblir aktivt, se templates/site.html) är ett giltigt, ofarligt
  // resultat snarare än ett byggfel om filen av någon anledning saknas.
  let moten: MotesPost[] = [];
  try {
    moten = JSON.parse(await readFile(MOTEN_PATH, "utf-8"));
  } catch {
    console.error(`(Ingen ${MOTEN_PATH} hittad — bygger utan mötestidslinje-data. Inte ett fel.)`);
  }

  const html = await renderSite(arenden, moten);

  await mkdir("dist/api", { recursive: true });
  await writeFile(OUT_HTML_PATH, html);
  await writeFile(OUT_API_PATH, JSON.stringify(arenden, null, 2) + "\n");
  await writeFile(OUT_MOTEN_API_PATH, JSON.stringify(moten, null, 2) + "\n");

  console.error(
    `Byggt: ${OUT_HTML_PATH} (${arenden.length} ärenden), ${OUT_API_PATH}, ${OUT_MOTEN_API_PATH} (${moten.length} möten)`
  );
}

main().catch((err) => {
  console.error("Ohanterat fel i build-cli.ts:", err);
  process.exit(1);
});
