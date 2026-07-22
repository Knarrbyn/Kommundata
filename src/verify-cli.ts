/**
 * verify-cli.ts — körbar ingångspunkt för verify-steget.
 *
 * Körs så här:
 *   node --experimental-strip-types src/verify-cli.ts <ready-arenden.json> <source-text.txt>
 *
 * Miljövariabler:
 *   VERIFY_API_KEY   — API-nyckel för LLM B:s leverantör (OBLIGATORISK)
 *   VERIFY_API_URL    — endpoint, default: Anthropics /v1/messages
 *   VERIFY_MODEL      — modellnamn, default: claude-sonnet-4-6
 *
 * ⚠️ Se varningen i verify.ts om modellfamiljs-oberoende — default-
 * konfigurationen använder SAMMA leverantör som extract-steget eftersom
 * det är den enda som är verifierad tillgänglig i den här utvecklings-
 * miljön. Byt VERIFY_API_URL/VERIFY_MODEL (och anpassa fetch-anropets
 * body/headers om leverantörens API-format skiljer sig från Anthropics)
 * till en faktiskt annan modellfamilj innan detta litas på i produktion.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { buildVerificationPrompt, parseVerificationResponse, reconcile } from "./verify.ts";
import type { CandidateArende } from "./extract.ts";
import type { GateResult } from "./gates.ts";

const API_URL = process.env.VERIFY_API_URL ?? "https://api.anthropic.com/v1/messages";
const MODEL = process.env.VERIFY_MODEL ?? "claude-sonnet-4-6";

async function callVerifyLLM(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Verify-API-fel: HTTP ${res.status} — ${body}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
  if (!textBlock) throw new Error("Inget textsvar i verify-API-responsen");
  return textBlock.text;
}

async function main() {
  const [, , readyPath, sourceTextPath] = process.argv;
  if (!readyPath || !sourceTextPath) {
    console.error(
      "Användning: node --experimental-strip-types src/verify-cli.ts <ready-arenden.json> <source-text.txt>"
    );
    process.exit(1);
  }

  const apiKey = process.env.VERIFY_API_KEY;
  if (!apiKey) {
    console.error("VERIFY_API_KEY saknas i miljön.");
    process.exit(1);
  }

  console.error(
    `⚠️  VERIFY_MODEL=${MODEL} mot ${API_URL} — se verify.ts för varningen om att detta INTE ` +
      `är bevisat vara en annan modellfamilj än extract-steget, om du inte satt egna env-variabler.`
  );

  const readyRaw = await readFile(readyPath, "utf-8");
  const sourceText = await readFile(sourceTextPath, "utf-8");
  // data/ready/*.json innehåller CandidateArende[] direkt (se gates-cli.ts) —
  // vi bygger om ett minimalt GateResult här eftersom verify inte behöver
  // gates-detaljerna, bara att vi VET att gates redan godkänt varje post
  // (annars hade den inte legat i ready/).
  const arenden: CandidateArende[] = JSON.parse(readyRaw);

  const reconciled = [];
  for (const arende of arenden) {
    const prompt = buildVerificationPrompt(arende, sourceText);
    const raw = await callVerifyLLM(prompt, apiKey);
    const verifyResult = parseVerificationResponse(raw);
    const fakeGateResult: GateResult = { arende, passed: true, checks: [] };
    const result = reconcile(fakeGateResult, verifyResult);
    reconciled.push(result);
    console.error(
      `${result.finalStatus === "publish" ? "✓" : "✗"} "${arende.title}" → ${result.verifyDecision} (${result.reasoning})`
    );
  }

  const toPublish = reconciled.filter((r) => r.finalStatus === "publish");
  const toReview = reconciled.filter((r) => r.finalStatus === "needs_review");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir("data/verified", { recursive: true });
  await mkdir("data/needs_review", { recursive: true });
  await writeFile(`data/verified/${timestamp}.json`, JSON.stringify(toPublish.map((r) => r.arende), null, 2));
  await writeFile(`data/needs_review/${timestamp}-verify.json`, JSON.stringify(toReview, null, 2));

  console.error(`\n${toPublish.length} redo för publish, ${toReview.length} till needs_review (verify-steget).`);
}

main().catch((err) => {
  console.error("Ohanterat fel i verify-cli.ts:", err);
  process.exit(1);
});
