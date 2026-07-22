// Kör extract-steget (LLM A) mot en källtext som redan är textextraherad
// (via web_fetch mot den skarpa sajten, se DECISION_LOG.md), inte mot en
// nedladdad PDF-fil. Återanvänder buildExtractionPrompt/parseExtractionResponse
// oförändrat ur src/extract.ts — enda skillnaden mot extract-cli.ts är att
// extractPdfText hoppas över eftersom texten redan finns.
import { readFile, writeFile } from "node:fs/promises";
import { buildExtractionPrompt, parseExtractionResponse, stampPdfUrl } from "./src/extract.ts";

const MODEL = "claude-sonnet-4-6";

async function callClaude(prompt, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API-fel: HTTP ${res.status} — ${body}`);
  }
  const data = await res.json();
  console.error(`stop_reason: ${data.stop_reason}, output_tokens: ${data.usage?.output_tokens}`);
  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock) throw new Error("Inget textsvar i API-responsen");
  return textBlock.text;
}

async function main() {
  const [, , textPath, protocolRef, date, outPath, pdfUrl] = process.argv;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY saknas i miljön.");
    process.exit(1);
  }

  const text = await readFile(textPath, "utf-8");
  console.error(`Läste ${text.length} tecken text från ${textPath}.`);

  const prompt = buildExtractionPrompt(text, { protocolRef, date });
  console.error(`Anropar ${MODEL} (temperatur 0)...`);
  const t0 = Date.now();
  const rawResponse = await callClaude(prompt, apiKey);
  console.error(`Svar mottaget efter ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  await writeFile(outPath.replace(/\.json$/, ".raw.txt"), rawResponse);
  console.error(`Rådata sparad: ${outPath.replace(/\.json$/, ".raw.txt")}`);

  const result = parseExtractionResponse(rawResponse);
  if (!result.ok) {
    console.error("Valideringsfel i LLM-svaret:");
    result.errors.forEach((e) => console.error(`  - ${e}`));
  }
  console.error(`${result.arenden.length} kandidatärenden extraherade.`);
  if (pdfUrl) stampPdfUrl(result.arenden, pdfUrl);

  await writeFile(outPath, JSON.stringify(result.arenden, null, 2));
  console.error(`Skrivet: ${outPath}`);
}

main().catch((err) => {
  console.error("Ohanterat fel:", err);
  process.exit(1);
});
