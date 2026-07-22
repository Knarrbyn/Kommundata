/**
 * build-cli.ts — körbar ingångspunkt för build-steget (spec §5, steg 9).
 *
 * Körs så här:
 *   node --experimental-strip-types src/build-cli.ts
 *
 * Läser `data/published/arenden.json` och skriver:
 *   dist/index.html      — den statiska sajten (renderSite, se build.ts)
 *   dist/api/arenden.json — öppet JSON-API, spec §7 (/api), CORS sätts av
 *                            hostingplattformen (Netlify _headers), inte här.
 *
 * Helt offline — inget nätverk eller API-nyckel krävs.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { renderSite } from "./build.ts";
import type { PublishedArende } from "./link.ts";

const PUBLISHED_PATH = "data/published/arenden.json";
const OUT_HTML_PATH = "dist/index.html";
const OUT_API_PATH = "dist/api/arenden.json";

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
  const html = await renderSite(arenden);

  await mkdir("dist/api", { recursive: true });
  await writeFile(OUT_HTML_PATH, html);
  await writeFile(OUT_API_PATH, JSON.stringify(arenden, null, 2) + "\n");

  console.error(`Byggt: ${OUT_HTML_PATH} (${arenden.length} ärenden), ${OUT_API_PATH}`);
}

main().catch((err) => {
  console.error("Ohanterat fel i build-cli.ts:", err);
  process.exit(1);
});
