/**
 * extract-cli.ts — körbar ingångspunkt för extract-steget.
 *
 * Körs så här:
 *   ANTHROPIC_API_KEY=sk-... node --experimental-strip-types src/extract-cli.ts \
 *     data/raw/kommunfullmaktige/2026-02-25/protokoll.pdf "§44 KF 2026-02-25" 2026-02-25
 *
 * Skriver kandidatärenden (INTE ännu verifierade mot verbatimgrinden) som
 * JSON till stdout. Nästa steg (gates, §5 steg 4) kör dem genom
 * verbatim-gate.js (se testrigg) innan något publiceras.
 *
 * OBS: kräver ANTHROPIC_API_KEY i miljön. api.anthropic.com är nåbart från
 * den här sandboxen (bekräftat: HTTP 405 på GET utan auth, dvs. inte
 * nätverksblockerat) men ingen nyckel finns konfigurerad här, så detta
 * skript är oprövat mot en riktig modell. Prompten och svarsparsningen
 * (extract.ts) är dock byggda för att vara direkt körbara så fort en
 * nyckel finns.
 */

import { readFile } from "node:fs/promises";
import { extractPdfText, buildExtractionPrompt, parseExtractionResponse, stampPdfUrl } from "./extract.ts";

const MODEL = "claude-sonnet-4-6";

async function callClaude(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      temperature: 0, // spec §5 steg 3: extraktion ska vara deterministisk
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API-fel: HTTP ${res.status} — ${body}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
  if (!textBlock) {
    throw new Error("Inget textsvar i API-responsen");
  }
  return textBlock.text;
}

async function main() {
  const [, , pdfPath, protocolRef, date, pdfUrl] = process.argv;
  if (!pdfPath || !protocolRef || !date || !pdfUrl) {
    console.error(
      "Användning: node --experimental-strip-types src/extract-cli.ts <pdf-path> <protocol_ref> <ÅÅÅÅ-MM-DD> <pdf-url>"
    );
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY saknas i miljön.");
    process.exit(1);
  }

  console.error(`Läser ${pdfPath}...`);
  const pdfBytes = await readFile(pdfPath);
  const text = await extractPdfText(new Uint8Array(pdfBytes));
  console.error(`Extraherade ${text.length} tecken text. Bygger prompt...`);

  const prompt = buildExtractionPrompt(text, { protocolRef, date });
  console.error(`Anropar ${MODEL} (temperatur 0)...`);
  const rawResponse = await callClaude(prompt, apiKey);

  const result = parseExtractionResponse(rawResponse);
  if (!result.ok) {
    console.error("Valideringsfel i LLM-svaret:");
    result.errors.forEach((e) => console.error(`  - ${e}`));
  }
  stampPdfUrl(result.arenden, pdfUrl);
  console.error(`${result.arenden.length} kandidatärenden extraherade. Skickas vidare till gates-steget.`);

  console.log(JSON.stringify(result.arenden, null, 2));
}

main().catch((err) => {
  console.error("Ohanterat fel i extract-cli.ts:", err);
  process.exit(1);
});
