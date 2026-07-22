/**
 * gates.ts — pipeline §5, steg 4.
 *
 * Ansvar: kör varje kandidatärende (från extract-steget) genom verbatim-
 * grinden (R2) i ren kod — INGEN AI här, se ARKITEKTURMALL-civic-tech.md §2.
 * Ärenden där något citat inte klarar grinden går till needs_review.json,
 * publiceras aldrig automatiskt.
 *
 * Detta är samma logik som testriggens verbatim-gate.js (redan bevisat
 * fungerande mot riktiga och fabricerade citat, se testrigg/README.md) —
 * portad till TypeScript och kopplad direkt till extract.ts:s
 * CandidateArende-typ istället för att vara ett fristående skript.
 *
 * SKILLNAD mot testriggens version: här implementeras den differentierade
 * ordgränsen från spec §4.2 R2 fullt ut (40 ord för de flesta stegtyper,
 * 60 för namndyttrande) — testriggen höll den medvetet flat på 40 för att
 * bevisa fyndet; den riktiga pipelinen ska faktiskt tillämpa den lösningen.
 */

import type { CandidateArende, CandidateStep } from "./extract.ts";

export interface QuoteCheckResult {
  step_id: string;
  field: string;
  quote: string;
  passed: boolean;
  reason: string;
}

export interface GateResult {
  arende: CandidateArende;
  passed: boolean;
  checks: QuoteCheckResult[];
}

/** Ordgräns per stegtyp (R2). Allt som inte nämns här faller under default (40). */
const WORD_LIMITS: Record<string, number> = {
  namndyttrande: 60,
};
const DEFAULT_WORD_LIMIT = 40;

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Kontrollerar ett enskilt citat mot källtexten. Ren funktion, inget I/O.
 */
export function verbatimGate(
  quote: string,
  sourceText: string,
  wordLimit: number = DEFAULT_WORD_LIMIT
): { passed: boolean; reason: string } {
  if (!quote || quote.trim().length === 0) {
    return { passed: false, reason: "Tomt citat" };
  }

  const normalizedQuote = normalizeWhitespace(quote);
  const normalizedSource = normalizeWhitespace(sourceText);

  const wordCount = normalizedQuote.split(" ").length;
  if (wordCount > wordLimit) {
    return {
      passed: false,
      reason: `Citat överskrider ${wordLimit} ord (${wordCount} ord) — se spec §4.2 R2`,
    };
  }

  const found = normalizedSource.includes(normalizedQuote);
  return {
    passed: found,
    reason: found
      ? "Citat verifierat ordagrant mot källdokumentet"
      : "KUNDE INTE ÅTERFINNAS ordagrant i källdokumentet — needs_review.json, publiceras EJ (R2)",
  };
}

function wordLimitFor(stepType: string): number {
  return WORD_LIMITS[stepType] ?? DEFAULT_WORD_LIMIT;
}

/**
 * Kör grinden mot ETT steg: huvudcitatet + ev. reservationer + ev.
 * protokollsanteckningar. Returnerar en resultatpost per kontrollerat citat.
 *
 * VIKTIGT (fynd från skarpt test 2026-07-20): ordgränsen (R2, 40/60 ord)
 * tillämpas ENDAST på huvudcitatet — det som styrker `decision`. Reser-
 * vationer och protokollsanteckningar är fria politiska uttalanden utan
 * någon motsvarande gräns i spec, och kan legitimt vara betydligt längre
 * (en riktig, redan verifierad protokollsanteckning i testriggen är 54
 * ord). Att tillämpa samma gräns där — vilket både testriggens ursprungliga
 * verbatim-gate.js och en tidigare version av den här filen gjorde — skulle
 * felaktigt underkänna äkta, ordagranna citat. Substräng-kontrollen (att
 * citatet verkligen finns i källtexten) gäller fortfarande fullt ut för
 * båda fälten; det är bara ordgränsen som inte längre appliceras på dem.
 */
export function gateStep(step: CandidateStep, sourceText: string): QuoteCheckResult[] {
  const results: QuoteCheckResult[] = [];
  const limit = wordLimitFor(step.type);

  if (step.quote) {
    const r = verbatimGate(step.quote, sourceText, limit);
    results.push({ step_id: step.step_id, field: "quote", quote: step.quote, ...r });
  }

  for (const reservation of step.reservations ?? []) {
    if (reservation.quote) {
      const r = verbatimGate(reservation.quote, sourceText, Infinity);
      results.push({
        step_id: step.step_id,
        field: `reservation[${reservation.parties.join("+")}]`,
        quote: reservation.quote,
        ...r,
      });
    }
  }

  for (const anteckning of step.protocol_anteckning ?? []) {
    if (anteckning.quote) {
      const r = verbatimGate(anteckning.quote, sourceText, Infinity);
      results.push({
        step_id: step.step_id,
        field: `protocol_anteckning[${anteckning.parties.join("+")}]`,
        quote: anteckning.quote,
        ...r,
      });
    }
  }

  return results;
}

/**
 * Kör grinden mot ett helt kandidatärende. `passed` är true bara om
 * SAMTLIGA citat i ärendet klarar grinden — ett enda underkänt citat
 * räcker för att hela ärendet ska gå till needs_review.json (R2).
 */
export function gateArende(arende: CandidateArende, sourceText: string): GateResult {
  const checks = arende.steps.flatMap((step) => gateStep(step, sourceText));
  const passed = checks.length > 0 && checks.every((c) => c.passed);
  return { arende, passed, checks };
}

/**
 * Kör grinden mot en lista kandidatärenden och delar upp dem i
 * publiceringsklara respektive needs_review, enligt pipeline §5 steg 4.
 */
export function runGates(
  arenden: CandidateArende[],
  sourceText: string
): { ready: GateResult[]; needsReview: GateResult[] } {
  const results = arenden.map((a) => gateArende(a, sourceText));
  return {
    ready: results.filter((r) => r.passed),
    needsReview: results.filter((r) => !r.passed),
  };
}
