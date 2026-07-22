/**
 * publish.ts — pipeline §5, steg 8.
 *
 * NY MODUL (byggd i efterhand, saknades i den ursprungliga pipeline-
 * leveransen — se DECISION_LOG.md). Ansvar enligt spec: "kanonisk sorterad
 * JSON, data_hash, changelog, git-commit." De tre första görs här i ren
 * kod, helt offline. Git-commit görs MEDVETET INTE av den här modulen —
 * det är CI:ns (GitHub Actions) ansvar, i linje med hur README beskrev
 * det ursprungliga (saknade) build-steget. Anledning: att låta pipeline-
 * koden själv committa skulle kräva att den har skrivåtkomst till repot
 * och git-identitet konfigurerad, vilket hör hemma i CI-miljön, inte i en
 * testbar, ren funktion.
 *
 * Kanonisering (ARKITEKTURMALL-civic-tech.md §2 punkt 5, "Git som
 * databas"): objektnycklar sorteras REKURSIVT alfabetiskt så att
 * `git diff` bara visar faktiska innehållsändringar, aldrig omkastad
 * fältordning. Array-ordning rörs ALDRIG — steps[]-ordningen (R1,
 * kronologisk) är semantiskt meningsfull och får inte kastas om av en
 * generisk sorteringsrutin.
 */

import { createHash } from "node:crypto";
import type { PublishedArende } from "./link.ts";

/* ============ Kanonisering ============ */

/**
 * Sorterar objektnycklar rekursivt (alfabetiskt, per Unicode-kodpunkt via
 * `Array.prototype.sort`s default). Arrayer bevarar sin ordning — bara
 * varje elements EGNA objektnycklar sorteras, inte elementens inbördes
 * position. `null` och primitiver returneras oförändrade.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    const sorted: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      sorted[k] = canonicalize(v);
    }
    return sorted;
  }
  return value;
}

/**
 * SHA-256-hash av den kanoniserade JSON-representationen. Stabil oavsett
 * i vilken ordning fälten råkade komma in tidigare i pipelinen — två
 * körningar med samma INNEHÅLL men olika fältordning ger samma hash.
 * Används för att snabbt avgöra "ändrades något alls sedan förra
 * körningen?" utan att göra en fullständig diff.
 */
export function computeDataHash(value: unknown): string {
  const canonicalJson = JSON.stringify(canonicalize(value));
  return createHash("sha256").update(canonicalJson, "utf-8").digest("hex");
}

/* ============ Changelog ============ */

export interface ArendeUpdate {
  id: string;
  new_step_ids: string[];
}

export interface PublishDiff {
  new_arenden: string[];
  updated_arenden: ArendeUpdate[];
}

export interface ChangelogEntry extends PublishDiff {
  run_id: string;
  timestamp: string;
  data_hash: string;
  arende_count: number;
}

/**
 * Jämför föregående publicerade snapshot mot den aktuella (redan
 * länkade, se link.ts) listan av ärenden. Matchar på `id` (spec R7: det
 * är den stabila nyckeln, inte diarienummer). Nya `step_id`:n inom ett
 * redan känt ärende räknas som en uppdatering av det ärendet, inte som
 * ett nytt ärende — det speglar hur en riktig ärendekedja växer över tid
 * (G5: samma ärende, fler steg).
 */
export function diffPublishedData(
  previous: PublishedArende[],
  current: PublishedArende[]
): PublishDiff {
  const previousById = new Map(previous.map((a) => [a.id, a]));
  const newArenden: string[] = [];
  const updatedArenden: ArendeUpdate[] = [];

  for (const arende of current) {
    const before = previousById.get(arende.id);
    if (!before) {
      newArenden.push(arende.id);
      continue;
    }
    const beforeStepIds = new Set(before.steps.map((s) => s.step_id));
    const newStepIds = arende.steps.filter((s) => !beforeStepIds.has(s.step_id)).map((s) => s.step_id);
    if (newStepIds.length > 0) {
      updatedArenden.push({ id: arende.id, new_step_ids: newStepIds });
    }
  }

  return { new_arenden: newArenden, updated_arenden: updatedArenden };
}

export function buildChangelogEntry(
  previous: PublishedArende[],
  current: PublishedArende[],
  runId: string,
  dataHash: string,
  timestamp: string = new Date().toISOString()
): ChangelogEntry {
  const diff = diffPublishedData(previous, current);
  return {
    run_id: runId,
    timestamp,
    data_hash: dataHash,
    arende_count: current.length,
    ...diff,
  };
}

/* ============ Sammanhållet publiceringssteg ============ */

export interface PublishResult {
  canonical: unknown;
  dataHash: string;
  changelogEntry: ChangelogEntry;
}

/**
 * Kör hela publish-steget: kanoniserar den inkommande (redan länkade)
 * ärendelistan, räknar ut dess hash, och bygger en changelog-post genom
 * att diffa mot föregående publicerade snapshot. Ren funktion — CLI:t
 * (publish-cli.ts) sköter filsystem och skrivning.
 *
 * OBS: `previous` ska vara den FÖREGÅENDE körningens kanoniska snapshot,
 * inte samma fil som just skrevs över av link-steget — annars blir
 * diffen alltid tom. Se publish-cli.ts för hur det hålls isär
 * (`data/publish/last-published.json`).
 */
export function preparePublish(
  current: PublishedArende[],
  previous: PublishedArende[],
  runId: string
): PublishResult {
  const canonical = canonicalize(current);
  const dataHash = computeDataHash(current);
  const changelogEntry = buildChangelogEntry(previous, current, runId, dataHash);
  return { canonical, dataHash, changelogEntry };
}
