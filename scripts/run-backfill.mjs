#!/usr/bin/env node
/**
 * scripts/run-backfill.mjs
 *
 * Fyller på historik BAKÅT i tiden för en instans, i begränsade omgångar.
 * Skild helt från scripts/run-weekly-pipeline.mjs (som bara hittar NYA
 * möten framåt) — backfill hanterar en helt annan risk-/kostnadsprofil
 * och ska aldrig köras via det vanliga veckoschemat.
 *
 * VIKTIGT FYND (2026-07-22): varje mötessidas sidmeny på
 * sammantradesportal.alingsas.se innehåller redan länkar till HELA
 * historiken bakåt (bekräftat till 2009 för kommunfullmäktige) — ingen
 * separat bläddrings-/pagineringslogik behövs. Det räcker att hämta EN
 * sida för instansen (listsidan `/committees/{slug}`, antas ha samma
 * sidmeny som enskilda mötessidor — INTE 100 % verifierat, se
 * DECISION_LOG.md) och köra befintliga `extractMeetingRefs` på den, precis
 * som redan görs i fetch.ts.
 *
 * ANVÄNDNING (manuellt styrd, en omgång i taget):
 *   ANTHROPIC_API_KEY=sk-... node --experimental-strip-types scripts/run-backfill.mjs \
 *     <committee-slug> <start-datum ÅÅÅÅ-MM-DD> <slut-datum ÅÅÅÅ-MM-DD> [max-möten-denna-körning]
 *
 * Exempel — första omgången, bara 2025, bara kommunfullmäktige:
 *   node --experimental-strip-types scripts/run-backfill.mjs kommunfullmaktige 2025-01-01 2025-12-31 10
 *
 * KOSTNADSTAK: [max-möten-denna-körning] är standard 10 om inget annat
 * anges — en hård gräns på hur många möten (= hur många LLM A-anrop) EN
 * körning får bearbeta, oavsett hur många som faktiskt matchar
 * datumintervallet. Kör skriptet igen (samma kommando) för nästa omgång —
 * redan bearbetade möten hoppas automatiskt över via data/seen.json,
 * som delas med den vanliga veckopipelinen.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { COMMITTEES, BASE_URL, SEEN_FILE } from "../src/config.ts";
import { extractMeetingRefs, extractProtocolPdfUrl, loadSeen, markSeen } from "../src/fetch.ts";
import { downloadMeetingFiles } from "../src/download.ts";
import { extractPdfText, buildExtractionPrompt, parseExtractionResponse, stampPdfUrl } from "../src/extract.ts";
import { runGates } from "../src/gates.ts";
import { buildVerificationPrompt, parseVerificationResponse, reconcile } from "../src/verify.ts";
import { archiveArendenWithGit } from "../src/archive.ts";
import { linkArende, generateArendeId } from "../src/link.ts";
import { preparePublish } from "../src/publish.ts";
import { renderSite } from "../src/build.ts";

const USER_AGENT =
  "FaktagranskarenBot/0.1 (+https://mjorninstitutet.se/faktagranskaren; civic-tech backfill, se metod-sida)";
const EXTRACT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_PER_RUN = 10;

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Fetch misslyckades: ${url} → HTTP ${res.status}`);
  return res.text();
}
async function fetchBinary(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Fetch misslyckades: ${url} → HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
async function callAnthropic({ apiUrl, model, apiKey, prompt, maxTokens }) {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API-fel: HTTP ${res.status} — ${await res.text()}`);
  const data = await res.json();
  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock) throw new Error("Inget textsvar i API-responsen");
  return textBlock.text;
}

async function main() {
  const [, , committeeSlug, startDate, endDate, maxArg] = process.argv;
  const maxPerRun = maxArg ? parseInt(maxArg, 10) : DEFAULT_MAX_PER_RUN;

  if (!committeeSlug || !startDate || !endDate) {
    console.error(
      "Användning: node --experimental-strip-types scripts/run-backfill.mjs " +
        "<committee-slug> <start-datum ÅÅÅÅ-MM-DD> <slut-datum ÅÅÅÅ-MM-DD> [max-möten-denna-körning]"
    );
    process.exit(1);
  }
  const committee = COMMITTEES.find((c) => c.slug === committeeSlug);
  if (!committee) {
    console.error(`Okänd instans-slug "${committeeSlug}". Giltiga: ${COMMITTEES.map((c) => c.slug).join(", ")}`);
    process.exit(1);
  }
  if (!committee.confirmed) {
    console.error(`"${committeeSlug}" är markerad confirmed:false i config.ts — verifiera innan backfill körs mot den.`);
    process.exit(1);
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error("ANTHROPIC_API_KEY saknas — avbryter.");
    process.exit(1);
  }
  const verifyKey = process.env.VERIFY_API_KEY;
  const verifyApiUrl = process.env.VERIFY_API_URL ?? "https://api.anthropic.com/v1/messages";
  const verifyModel = process.env.VERIFY_MODEL ?? "claude-sonnet-4-6";
  if (!verifyKey) {
    console.error("⚠️  VERIFY_API_KEY saknas — verify-steget hoppas över, precis som i den vanliga veckopipelinen.");
  }

  console.error(`Backfill: ${committee.name} (${committeeSlug}), ${startDate} till ${endDate}, max ${maxPerRun} möten denna körning.`);

  const seen = await loadSeen(SEEN_FILE, (p) => readFile(p, "utf-8"));

  // Hämta EN sida för instansen — sidmenyn på varje mötessida innehåller
  // redan hela historiken (bekräftat till 2009), så en enda hämtning
  // räcker för att harvesta alla datum, oavsett hur långt bak vi vill.
  const listUrl = `${BASE_URL}/committees/${committeeSlug}`;
  const listHtml = await fetchText(listUrl);
  const allRefs = extractMeetingRefs(committeeSlug, listHtml);
  console.error(`Hittade ${allRefs.length} möten totalt i sidmenyn (alla år).`);

  const inRange = allRefs
    .filter((r) => r.date >= startDate && r.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date)); // äldst först — fyll på kronologiskt

  const alreadySeen = seen[committeeSlug] ?? [];
  const remaining = inRange.filter((r) => !alreadySeen.includes(r.date));
  const batch = remaining.slice(0, maxPerRun);

  console.error(
    `${inRange.length} möten inom datumintervallet, ${remaining.length} ännu obearbetade, ` +
      `bearbetar ${batch.length} denna körning.`
  );
  if (batch.length === 0) {
    console.error("Inget att göra — alla möten inom intervallet är redan bearbetade.");
    return;
  }

  const manifest = [];
  const allNeedsReview = [];
  const allToPublish = [];
  const rawTextByMeeting = new Map();
  const downloadDeps = {
    fetchBinary,
    ensureDir: (p) => mkdir(p, { recursive: true }),
    writeFile: (p, data) => writeFile(p, data),
  };

  for (const ref of batch) {
    console.error(`--- ${ref.date} ---`);
    try {
      const meetingHtml = await fetchText(ref.meetingUrl);
      const protocolPdfUrl = extractProtocolPdfUrl(committeeSlug, ref.date, meetingHtml);
      if (!protocolPdfUrl) {
        console.error(`  ⚠ Inget justerat protokoll hittat för ${ref.date} — hoppar över (INTE markerad som seen, försöks igen).`);
        continue;
      }
      const meeting = { ...ref, protocolPdfUrl };

      const downloaded = await downloadMeetingFiles(meeting, meetingHtml, downloadDeps);
      manifest.push({ pdfUrl: protocolPdfUrl, relativePath: downloaded.protocolPath });

      const protocolBytes = await readFile(downloaded.protocolPath);
      const sourceText = await extractPdfText(new Uint8Array(protocolBytes));
      rawTextByMeeting.set(protocolPdfUrl, sourceText);

      const protocolRef = `§XX ${committeeSlug.toUpperCase()} ${ref.date}`;
      const prompt = buildExtractionPrompt(sourceText, { protocolRef, date: ref.date });
      const rawResponse = await callAnthropic({
        apiUrl: "https://api.anthropic.com/v1/messages",
        model: EXTRACT_MODEL,
        apiKey: anthropicKey,
        prompt,
        maxTokens: 16000,
      });
      const extractResult = parseExtractionResponse(rawResponse);
      if (!extractResult.ok) {
        console.error(`  ⚠ Extraktionsfel (${extractResult.errors.length}), fortsätter med giltiga poster.`);
      }
      stampPdfUrl(extractResult.arenden, protocolPdfUrl);
      console.error(`  ${extractResult.arenden.length} kandidatärenden.`);

      const { ready, needsReview } = runGates(extractResult.arenden, sourceText);
      console.error(`  gates: ${ready.length} godkända, ${needsReview.length} till needs_review.`);
      allNeedsReview.push(...needsReview);

      let toPublishThisMeeting = ready.map((r) => r.arende);
      if (verifyKey) {
        const reconciled = [];
        for (const arende of ready.map((r) => r.arende)) {
          const vPrompt = buildVerificationPrompt(arende, sourceText);
          const vRaw = await callAnthropic({ apiUrl: verifyApiUrl, model: verifyModel, apiKey: verifyKey, prompt: vPrompt, maxTokens: 2000 });
          const vResult = parseVerificationResponse(vRaw);
          reconciled.push(reconcile({ arende, passed: true, checks: [] }, vResult));
        }
        toPublishThisMeeting = reconciled.filter((r) => r.finalStatus === "publish").map((r) => r.arende);
        allNeedsReview.push(...reconciled.filter((r) => r.finalStatus === "needs_review"));
      }

      allToPublish.push(...toPublishThisMeeting);
      markSeen(seen, committeeSlug, ref.date);
    } catch (e) {
      console.error(`  ✗ FEL, hoppar över ${ref.date}: ${e.message}`);
    }
  }

  await mkdir("data/needs_review", { recursive: true });
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(`data/needs_review/backfill-${runTimestamp}.json`, JSON.stringify(allNeedsReview, null, 2));

  await mkdir("data/raw", { recursive: true });
  const existingManifestRaw = await readFile("data/raw/manifest.json", "utf-8").catch(() => "[]");
  await writeFile("data/raw/manifest.json", JSON.stringify([...JSON.parse(existingManifestRaw), ...manifest], null, 2));

  const rawFiles = [];
  for (const m of manifest) {
    rawFiles.push({ pdfUrl: m.pdfUrl, relativePath: m.relativePath, bytes: new Uint8Array(await readFile(m.relativePath)) });
  }
  const { arenden: archivedArenden } = archiveArendenWithGit(allToPublish, rawFiles);

  const publishedDbRaw = await readFile("data/published/arenden.json", "utf-8").catch(() => "[]");
  const publishedDb = JSON.parse(publishedDbRaw);
  const existingIds = new Set(publishedDb.map((a) => a.id));

  for (const candidate of archivedArenden) {
    const pdfUrl = candidate.steps[candidate.steps.length - 1]?.source?.pdf_url;
    const sourceText = pdfUrl ? rawTextByMeeting.get(pdfUrl) ?? "" : "";
    const match = linkArende(candidate, sourceText, publishedDb);
    if (match.kind === "paragraph_ref") {
      match.existing.steps.push(...candidate.steps);
      match.existing.status = candidate.status;
      console.error(`✓ "${candidate.title}" → kopplad till ${match.existing.id}`);
    } else {
      const year = parseInt(candidate.steps[0]?.date?.slice(0, 4) ?? new Date().getFullYear().toString(), 10);
      const id = generateArendeId(year, existingIds);
      existingIds.add(id);
      publishedDb.push({ ...candidate, id });
      console.error(`+ "${candidate.title}" → nytt ärende ${id}`);
    }
  }

  const previous = JSON.parse(await readFile("data/publish/last-published.json", "utf-8").catch(() => "[]"));
  const { canonical, dataHash, changelogEntry } = preparePublish(publishedDb, previous, `backfill-${runTimestamp}`);
  await mkdir("data/publish", { recursive: true });
  await writeFile("data/published/arenden.json", JSON.stringify(canonical, null, 2));
  await writeFile("data/publish/last-published.json", JSON.stringify(canonical, null, 2));
  await writeFile("data/publish/data_hash.txt", dataHash);
  const changelog = JSON.parse(await readFile("data/publish/changelog.json", "utf-8").catch(() => "[]"));
  changelog.push(changelogEntry);
  await writeFile("data/publish/changelog.json", JSON.stringify(changelog, null, 2));

  const html = await renderSite(publishedDb);
  await mkdir("dist/api", { recursive: true });
  await writeFile("dist/index.html", html);
  await writeFile("dist/api/arenden.json", JSON.stringify(publishedDb, null, 2));

  await writeFile(SEEN_FILE, JSON.stringify(seen, null, 2));

  const stillRemaining = remaining.length - batch.length;
  console.error(`\n${publishedDb.length} ärenden totalt publicerade.`);
  console.error(
    stillRemaining > 0
      ? `${stillRemaining} möten kvar inom ${startDate}–${endDate} för ${committeeSlug}. Kör samma kommando igen för nästa omgång.`
      : `Klart — alla möten inom ${startDate}–${endDate} för ${committeeSlug} är nu bearbetade.`
  );
}

main().catch((err) => {
  console.error("Ohanterat fel i run-backfill.mjs:", err);
  process.exit(1);
});
