/**
 * gates-cli.ts — körbar ingångspunkt för gates-steget.
 *
 * Körs så här (efter att extract-cli.ts skrivit kandidatärenden till fil,
 * och du har källtexten som pdf-parse extraherade ur samma protokoll):
 *
 *   node --experimental-strip-types src/gates-cli.ts \
 *     /tmp/candidates.json /tmp/source-text.txt
 *
 * Skriver två filer:
 *   data/ready/{run-tidsstämpel}.json       — ärenden som klarade grinden
 *   data/needs_review/{run-tidsstämpel}.json — ärenden som INTE klarade grinden,
 *                                               med fullständig felmotivering
 *
 * Inget nätverk eller LLM krävs här — helt körbart offline, alltid.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { runGates } from "./gates.ts";
import type { CandidateArende } from "./extract.ts";

async function main() {
  const [, , candidatesPath, sourceTextPath] = process.argv;
  if (!candidatesPath || !sourceTextPath) {
    console.error(
      "Användning: node --experimental-strip-types src/gates-cli.ts <candidates.json> <source-text.txt>"
    );
    process.exit(1);
  }

  const candidatesRaw = await readFile(candidatesPath, "utf-8");
  const sourceText = await readFile(sourceTextPath, "utf-8");
  const arenden: CandidateArende[] = JSON.parse(candidatesRaw);

  const { ready, needsReview } = runGates(arenden, sourceText);

  console.error(`${ready.length} ärenden klarade grinden, ${needsReview.length} till needs_review.`);
  for (const r of needsReview) {
    console.error(`\n✗ "${r.arende.title}":`);
    for (const c of r.checks.filter((c) => !c.passed)) {
      console.error(`   [${c.step_id}] ${c.field}: ${c.reason}`);
      console.error(`   Citat: "${c.quote.slice(0, 80)}${c.quote.length > 80 ? "…" : ""}"`);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir("data/ready", { recursive: true });
  await mkdir("data/needs_review", { recursive: true });
  await writeFile(`data/ready/${timestamp}.json`, JSON.stringify(ready.map((r) => r.arende), null, 2));
  await writeFile(`data/needs_review/${timestamp}.json`, JSON.stringify(needsReview, null, 2));

  console.error(`\nSkrivet: data/ready/${timestamp}.json, data/needs_review/${timestamp}.json`);
}

main().catch((err) => {
  console.error("Ohanterat fel i gates-cli.ts:", err);
  process.exit(1);
});
