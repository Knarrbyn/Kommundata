/**
 * fetch-cli.ts — körbar ingångspunkt för fetch-steget.
 *
 * Körs så här (Node 22+, inget build-steg krävs tack vare
 * --experimental-strip-types):
 *
 *   node --experimental-strip-types src/fetch-cli.ts
 *
 * Skriver en lista över nya, justerade möten (redo för download-steget)
 * till stdout som JSON, och uppdaterar INTE seen.json här — det görs av
 * publish-steget (§5, steg 8) när ett ärende faktiskt har publicerats,
 * inte bara hittats. Se fetch.ts för resonemanget.
 *
 * OBS: kräver nätverksåtkomst till sammantradesportal.alingsas.se. Denna
 * sandbox tillåter det inte (se README.md) — kör detta i GitHub Actions
 * eller lokalt på din egen maskin för ett skarpt test.
 */

import { readFile } from "node:fs/promises";
import { COMMITTEES, SEEN_FILE } from "./config.ts";
import { fetchNewMeetingsForCommittee, loadSeen, type MeetingWithProtocol } from "./fetch.ts";

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      // Ärlig, identifierbar user-agent — inte att maskera sig som en
      // vanlig webbläsare. Civic-tech-principen (ARKITEKTURMALL §"Varför
      // det spelar roll") bygger på öppenhet, inte kringgående.
      "User-Agent": "FaktagranskarenBot/0.1 (+https://mjorninstitutet.se/faktagranskaren; civic-tech, se metod-sida)",
    },
  });
  if (!res.ok) {
    throw new Error(`Fetch misslyckades: ${url} → HTTP ${res.status}`);
  }
  return res.text();
}

async function main() {
  const unconfirmed = COMMITTEES.filter((c) => !c.confirmed);
  if (unconfirmed.length > 0) {
    console.warn(
      `⚠️  ${unconfirmed.length} instans(er) i config.ts är INTE bekräftade mot riktiga sajten:\n` +
        unconfirmed.map((c) => `   - ${c.slug}: ${c.note}`).join("\n") +
        `\n   Dessa körs ändå (kommer bara ge tomt resultat om slugen är fel), men verifiera manuellt.`
    );
  }

  const seen = await loadSeen(SEEN_FILE, (p) => readFile(p, "utf-8"));

  const allNew: Array<MeetingWithProtocol & { committeeName: string }> = [];
  for (const committee of COMMITTEES) {
    try {
      const newMeetings = await fetchNewMeetingsForCommittee(committee, seen, fetchText);
      for (const m of newMeetings) {
        allNew.push({ ...m, committeeName: committee.name });
      }
      console.error(`${committee.name}: ${newMeetings.length} nya justerade protokoll`);
    } catch (err) {
      console.error(`${committee.name}: FEL — ${(err as Error).message}`);
    }
  }

  console.log(JSON.stringify(allNew, null, 2));
}

main().catch((err) => {
  console.error("Ohanterat fel i fetch-cli.ts:", err);
  process.exit(1);
});
