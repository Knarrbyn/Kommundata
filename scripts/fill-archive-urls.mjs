#!/usr/bin/env node
/**
 * scripts/fill-archive-urls.mjs
 *
 * Körs i CI (GitHub Actions) EFTER `git commit` av data/published/arenden.json
 * och den nedladdade rå-datan, men FÖRE `git push`. Löser sekvensproblemet
 * som beskrivs i src/archive.ts: archive-steget (steg 6 i pipelinen) körs
 * innan commit-SHA:n existerar, så det kan bara sätta en PENDING-markör
 * ("git-pending:{relativePath}"). Det här skriptet:
 *
 *   1. Läser av den nyss skapade commit-SHA:n (`git rev-parse HEAD`).
 *   2. Ersätter varje "git-pending:{path}"-markör i data/published/arenden.json
 *      med den slutgiltiga permalänken (buildGitArchiveUrl).
 *   3. Committar den lilla ändringen som en uppföljande commit ("Fyll i
 *      arkivlänkar för commit <sha>") — så historiken förblir begriplig:
 *      en commit för datan, en liten uppföljare för dess egna arkivlänkar.
 *
 * Förutsätter att GITHUB_REPOSITORY är satt (GitHub Actions sätter detta
 * automatiskt som "{ägare}/{repo}"). Kan även köras manuellt med
 * GITHUB_REPOSITORY satt för hand.
 *
 * Körs så här (i CI, efter publish + git add + git commit):
 *   node scripts/fill-archive-urls.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const ARENDEN_PATH = "data/published/arenden.json";

function buildGitArchiveUrl(repo, commitSha, relativePath) {
  return `https://github.com/${repo}/blob/${commitSha}/${relativePath}`;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error("GITHUB_REPOSITORY saknas i miljön — avbryter (körs detta utanför CI?).");
    process.exit(1);
  }

  const commitSha = execSync("git rev-parse HEAD").toString().trim();
  console.error(`Commit-SHA: ${commitSha}`);

  const raw = await readFile(ARENDEN_PATH, "utf-8");
  const arenden = JSON.parse(raw);

  let filled = 0;
  for (const arende of arenden) {
    for (const step of arende.steps ?? []) {
      const source = step.source;
      if (typeof source?.archive_url === "string" && source.archive_url.startsWith("git-pending:")) {
        const relativePath = source.archive_url.slice("git-pending:".length);
        source.archive_url = buildGitArchiveUrl(repo, commitSha, relativePath);
        filled++;
      }
    }
  }

  if (filled === 0) {
    console.error("Inga PENDING-markörer att fylla i — inget att göra.");
    return;
  }

  await writeFile(ARENDEN_PATH, JSON.stringify(arenden, null, 2));
  console.error(`${filled} arkivlänkar ifyllda i ${ARENDEN_PATH}.`);

  execSync(`git add ${ARENDEN_PATH}`);
  execSync(`git commit -m "Fyll i arkivlänkar för commit ${commitSha.slice(0, 7)}"`);
  console.error("Uppföljande commit skapad. Kör 'git push' därefter (görs av CI-workflowen).");
}

main().catch((err) => {
  console.error("Fel i fill-archive-urls.mjs:", err);
  process.exit(1);
});
