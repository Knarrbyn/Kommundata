/**
 * archive-cli.ts — körbar ingångspunkt för archive-steget.
 *
 * Körs så här (git-arkivet, primärt — inget nätverk eller nyckel krävs):
 *   node --experimental-strip-types src/archive-cli.ts <verified-arenden.json> <raw-dir>
 *
 * <raw-dir> ska vara samma katalog som download-steget skrev till, t.ex.
 * "data/raw" — filerna hittas via samma relativa sökvägsstruktur som
 * download.ts skapade (data/raw/{instans}/{datum}/protokoll.pdf).
 *
 * Sätter en PENDING-markör (aldrig en trasig länk eller ett bokstavligt
 * "TODO") på varje steg vars källfil hittades. Den riktiga, commit-pinnade
 * GitHub-permalänken fylls i EFTER `git commit` av `scripts/fill-archive-urls.mjs`
 * i CI — se modulkommentaren i archive.ts för varför sekvensen måste vara sådan.
 *
 * FRIVILLIGT, ICKE-BLOCKERANDE EXTRA: om ARCHIVE_ACCESS_KEY och
 * ARCHIVE_SECRET_KEY finns satta i miljön, försöker skriptet ÄVEN skicka
 * varje käll-URL till Wayback Machine (SPN2) som ett sekundärt arkiv.
 * Ett misslyckande där stoppar ALDRIG pipelinen eller skriver över
 * git-arkivets PENDING-markör — git-arkivet är den garanterade primärkällan
 * (se DECISION_LOG.md, 2026-07-20, för det fulla resonemanget om varför).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { archiveArendenWithGit, archiveUrl, type ArchiveDeps, type RawFileEntry } from "./archive.ts";
import type { CandidateArende } from "./extract.ts";

async function fetchText(url: string, init: RequestInit): Promise<string> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} från ${url}: ${text.slice(0, 300)}`);
  }
  return text;
}

const waybackDeps: ArchiveDeps = {
  fetchText,
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Hittar alla nedladdade rå-filer under <raw-dir> och matchar dem mot pdf_url via en medföljande manifest.json (skriven av download-cli.ts). */
async function loadRawFiles(rawDir: string): Promise<RawFileEntry[]> {
  const manifestPath = `${rawDir}/manifest.json`;
  let manifest: Array<{ pdfUrl: string; relativePath: string }>;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  } catch {
    console.error(
      `Ingen manifest.json hittad i ${rawDir} — inget att arkivera via git. ` +
        `(download-cli.ts ska skriva en sådan; se DECISION_LOG.md om detta saknas i din version.)`
    );
    return [];
  }

  const entries: RawFileEntry[] = [];
  // OBS (2026-07-23): det här manuella CLI-verktyget är INTE uppdaterat
  // för tvårepo-uppdelningen (se DECISION_LOG.md) — det förutsätter
  // fortfarande att rå-filer ligger i HUVUDrepot, inte det separata
  // "kalla" arkiv-repot. Bra för snabb enstaka-mötes-felsökning lokalt,
  // men skarp drift går numera via scripts/run-weekly-pipeline.mjs /
  // scripts/run-backfill.mjs, som båda är uppdaterade.
  const repo = process.env.GITHUB_REPOSITORY || "OKÄNT_REPO_SÄTT_GITHUB_REPOSITORY";
  for (const m of manifest) {
    try {
      const bytes = await readFile(m.relativePath);
      entries.push({ pdfUrl: m.pdfUrl, relativePath: m.relativePath, bytes: new Uint8Array(bytes), repo });
    } catch (e) {
      console.error(`  ⚠ Kunde inte läsa ${m.relativePath}: ${(e as Error).message}`);
    }
  }
  return entries;
}

async function main() {
  const [, , inputPath, rawDir] = process.argv;
  if (!inputPath || !rawDir) {
    console.error(
      "Användning: node --experimental-strip-types src/archive-cli.ts <verified-arenden.json> <raw-dir>"
    );
    process.exit(1);
  }

  const raw = await readFile(inputPath, "utf-8");
  const arenden: CandidateArende[] = JSON.parse(raw);

  // Primärt arkiv: git. Offline, inget nätverk krävs.
  const rawFiles = await loadRawFiles(rawDir);
  const { arenden: archivedArenden, fileHashes } = archiveArendenWithGit(arenden, rawFiles);
  const matched = Object.keys(fileHashes).length;
  console.error(`Git-arkiv (primärt): ${matched} rå-filer matchade och PENDING-markerade.`);

  // Sekundärt, frivilligt: Wayback Machine — bara om nycklar finns, och
  // ett misslyckande här stoppar ALDRIG resten av pipelinen.
  const accessKey = process.env.ARCHIVE_ACCESS_KEY;
  const secretKey = process.env.ARCHIVE_SECRET_KEY;
  if (accessKey && secretKey) {
    console.error("\nARCHIVE_ACCESS_KEY/SECRET_KEY funna — försöker även Wayback Machine (frivilligt, sekundärt)...");
    const urlToWayback = new Map<string, string | null>();
    for (const arende of archivedArenden) {
      for (const step of arende.steps) {
        const url = (step.source as { pdf_url?: string }).pdf_url;
        if (url && !urlToWayback.has(url)) urlToWayback.set(url, null);
      }
    }
    for (const url of urlToWayback.keys()) {
      try {
        const result = await archiveUrl(url, accessKey, secretKey, waybackDeps);
        if (result.archivedUrl) {
          urlToWayback.set(url, result.archivedUrl);
          console.error(`  ✓ Wayback: ${result.archivedUrl}`);
        } else {
          console.error(`  ✗ Wayback misslyckades (icke-blockerande): ${result.error}`);
        }
      } catch (e) {
        console.error(`  ✗ Wayback-fel (icke-blockerande): ${(e as Error).message}`);
      }
    }
    // Wayback-länken sparas separat, skriver INTE över git-arkivets
    // PENDING-markör i archive_url — se DECISION_LOG.md.
    for (const arende of archivedArenden) {
      for (const step of arende.steps) {
        const source = step.source as { pdf_url?: string; wayback_url?: string };
        if (source.pdf_url && urlToWayback.get(source.pdf_url)) {
          source.wayback_url = urlToWayback.get(source.pdf_url)!;
        }
      }
    }
  } else {
    console.error(
      "\n(Wayback Machine hoppas över — ARCHIVE_ACCESS_KEY/SECRET_KEY inte satta. " +
        "Det är förväntat och blockerar inget: git-arkivet är primärkällan.)"
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir("data/archived", { recursive: true });
  await writeFile(`data/archived/${timestamp}.json`, JSON.stringify(archivedArenden, null, 2));
  await writeFile(`data/archived/${timestamp}.hashes.json`, JSON.stringify(fileHashes, null, 2));
  console.error(`\nSkrivet: data/archived/${timestamp}.json (+ .hashes.json)`);
}

main().catch((err) => {
  console.error("Ohanterat fel i archive-cli.ts:", err);
  process.exit(1);
});
