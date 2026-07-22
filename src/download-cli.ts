/**
 * download-cli.ts — körbar ingångspunkt för download-steget.
 *
 * Läser JSON-listan som fetch-cli.ts skriver till stdout (spara den till
 * en fil eller piepa direkt) och laddar ner protokoll + kallelsebilagor
 * för varje möte.
 *
 * Körs så här:
 *   node --experimental-strip-types src/fetch-cli.ts > /tmp/new-meetings.json
 *   node --experimental-strip-types src/download-cli.ts /tmp/new-meetings.json
 *
 * OBS: kräver nätverksåtkomst — se README.md för samma begränsning som
 * fetch-cli.ts har i den här sandboxen.
 */

import { readFile, mkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { downloadMeetingFiles, type DownloadDeps } from "./download.ts";
import type { MeetingWithProtocol } from "./fetch.ts";

const USER_AGENT =
  "FaktagranskarenBot/0.1 (+https://mjorninstitutet.se/faktagranskaren; civic-tech, se metod-sida)";

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Fetch misslyckades: ${url} → HTTP ${res.status}`);
  return res.text();
}

async function fetchBinary(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Fetch misslyckades: ${url} → HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

const deps: DownloadDeps = {
  fetchBinary,
  ensureDir: async (path: string) => {
    await mkdir(path, { recursive: true });
  },
  writeFile: async (path: string, data: Uint8Array) => {
    await fsWriteFile(path, data);
  },
};

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Användning: node --experimental-strip-types src/download-cli.ts <meetings.json>");
    process.exit(1);
  }

  const raw = await readFile(inputPath, "utf-8");
  const meetings: MeetingWithProtocol[] = JSON.parse(raw);

  console.error(`${meetings.length} möten att ladda ner...`);

  // Manifest kopplar varje nedladdad fils lokala sökväg till dess
  // ursprungliga käll-URL — archive-cli.ts (git-primärt arkiv, se
  // DECISION_LOG.md 2026-07-20) behöver detta för att veta vilken fil som
  // hör till vilket `step.source.pdf_url` utan att gissa på filnamn.
  const manifest: Array<{ pdfUrl: string; relativePath: string }> = [];

  for (const meeting of meetings) {
    try {
      // Samma sida som fetch-steget redan tittade på (Kallelse + Protokoll
      // i en och samma sidladdning) — hämtas här igen eftersom fetch-cli.ts
      // inte sparade HTML:en, bara det extraherade resultatet. Går att
      // optimera senare (skicka med HTML i JSON-payloaden) om
      // dubbelhämtningen visar sig kosta för mycket i skarp drift.
      const meetingUrl = `https://sammantradesportal.alingsas.se/committees/${meeting.committeeSlug}/mote-${meeting.date}`;
      const meetingHtml = await fetchText(meetingUrl);

      const result = await downloadMeetingFiles(meeting, meetingHtml, deps);
      manifest.push({ pdfUrl: meeting.protocolPdfUrl, relativePath: result.protocolPath });
      console.error(
        `✓ ${meeting.committeeSlug} ${meeting.date}: protokoll + ${result.bilagaPaths.length} bilagor`
      );
    } catch (err) {
      console.error(`✗ ${meeting.committeeSlug} ${meeting.date}: FEL — ${(err as Error).message}`);
    }
  }

  await mkdir("data/raw", { recursive: true });
  await fsWriteFile("data/raw/manifest.json", JSON.stringify(manifest, null, 2));
  console.error(`\nSkrivet: data/raw/manifest.json (${manifest.length} filer)`);
}

main().catch((err) => {
  console.error("Ohanterat fel i download-cli.ts:", err);
  process.exit(1);
});
