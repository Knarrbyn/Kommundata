#!/usr/bin/env node
/**
 * scripts/fill-archive-urls.mjs
 *
 * Körs i CI (GitHub Actions) EFTER `git commit` i BÅDA repona (huvudrepot
 * OCH arkiv-repot, se DECISION_LOG.md 2026-07-23), men FÖRE `git push` av
 * huvudrepots uppföljande commit. Löser sekvensproblemet i src/archive.ts:
 * archive-steget körs innan commit-SHA:erna existerar, så det kan bara
 * sätta en PENDING-markör ("git-pending:{repo}:{relativePath}").
 *
 * UTÖKAD 2026-07-23: markören innehåller nu VILKET repo filen hör hemma
 * i (huvudrepot eller det separata "kalla" arkiv-repot), eftersom de får
 * OLIKA commit-SHA:er i samma körning — två separata repon, två separata
 * commits. Detta skript behöver därför känna till BÅDA SHA:erna:
 *   - Huvudrepots egen SHA: läses av direkt (`git rev-parse HEAD`,
 *     eftersom skriptet körs FRÅN huvudrepots checkout).
 *   - Arkiv-repots SHA: MÅSTE skickas in via miljövariabeln
 *     ARCHIVE_REPO_SHA, satt av workflow-filen EFTER att arkiv-repots
 *     egen commit+push redan skett (kronologisk ordning: arkiv-repot
 *     committas FÖRST, dess SHA blir känd, SEDAN körs det här skriptet).
 *
 * Körs så här (i CI, efter publish + git add + git commit i båda repona):
 *   ARCHIVE_REPO_SHA=<sha> node scripts/fill-archive-urls.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { ARCHIVE_REPO } from "../src/config.ts";

const ARENDEN_PATH = "data/published/arenden.json";

function buildGitArchiveUrl(repo, commitSha, relativePath) {
  return `https://github.com/${repo}/blob/${commitSha}/${relativePath}`;
}

/** Plockar isär "git-pending:{repo}:{relativePath}". Hanterar även det GAMLA formatet utan repo ("git-pending:{relativePath}") som bakåtkompatibilitet — tolkas då som huvudrepot. */
function parseMarker(marker, mainRepo) {
  const rest = marker.slice("git-pending:".length);
  const sepIndex = rest.indexOf(":");
  // Om det som står innan första ":" innehåller ett "/" är det troligen
  // ett repo (ägare/repo-format) — annars är hela strängen en sökväg i
  // det gamla, repo-lösa formatet.
  if (sepIndex !== -1 && rest.slice(0, sepIndex).includes("/")) {
    return { repo: rest.slice(0, sepIndex), relativePath: rest.slice(sepIndex + 1) };
  }
  return { repo: mainRepo, relativePath: rest };
}

async function main() {
  const mainRepo = process.env.GITHUB_REPOSITORY;
  if (!mainRepo) {
    console.error("GITHUB_REPOSITORY saknas i miljön — avbryter (körs detta utanför CI?).");
    process.exit(1);
  }

  const mainRepoSha = execSync("git rev-parse HEAD").toString().trim();
  const archiveRepoSha = process.env.ARCHIVE_REPO_SHA || null;
  console.error(`Huvudrepots commit-SHA: ${mainRepoSha}`);
  console.error(`Arkiv-repots commit-SHA: ${archiveRepoSha || "(inte satt — arkiv-repo-markörer hoppas över denna gång)"}`);

  const raw = await readFile(ARENDEN_PATH, "utf-8");
  const arenden = JSON.parse(raw);

  let filled = 0;
  let skippedNoArchiveSha = 0;
  for (const arende of arenden) {
    for (const step of arende.steps ?? []) {
      const source = step.source;
      if (typeof source?.archive_url !== "string" || !source.archive_url.startsWith("git-pending:")) continue;

      const { repo, relativePath } = parseMarker(source.archive_url, mainRepo);
      if (repo === mainRepo) {
        source.archive_url = buildGitArchiveUrl(mainRepo, mainRepoSha, relativePath);
        filled++;
      } else if (repo === ARCHIVE_REPO && archiveRepoSha) {
        source.archive_url = buildGitArchiveUrl(ARCHIVE_REPO, archiveRepoSha, relativePath);
        filled++;
      } else if (repo === ARCHIVE_REPO && !archiveRepoSha) {
        // Arkiv-repots commit hann inte ske (eller SHA:n skickades inte
        // in) denna körning — lämna PENDING, försök igen nästa gång
        // istället för att gissa fel.
        skippedNoArchiveSha++;
      }
      // Annat repo än något av de två kända: lämnas orört (bör inte
      // hända i praktiken, men hellre orört än fel).
    }
  }

  if (skippedNoArchiveSha > 0) {
    console.error(
      `⚠️  ${skippedNoArchiveSha} markörer pekar mot arkiv-repot men ARCHIVE_REPO_SHA saknades — ` +
        `lämnade PENDING, försöks igen nästa körning.`
    );
  }

  if (filled === 0) {
    console.error("Inga PENDING-markörer kunde fyllas i denna gång — inget att göra.");
    return;
  }

  await writeFile(ARENDEN_PATH, JSON.stringify(arenden, null, 2));
  console.error(`${filled} arkivlänkar ifyllda i ${ARENDEN_PATH}.`);

  execSync(`git add ${ARENDEN_PATH}`);
  execSync(`git commit -m "Fyll i arkivlänkar för commit ${mainRepoSha.slice(0, 7)}"`);
  console.error("Uppföljande commit skapad. Kör 'git push' därefter (görs av CI-workflowen).");
}

main().catch((err) => {
  console.error("Fel i fill-archive-urls.mjs:", err);
  process.exit(1);
});
