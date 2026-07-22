#!/usr/bin/env node
/**
 * scripts/run-weekly-pipeline.mjs
 *
 * Binder ihop HELA pipelinen (spec §5, alla nio steg) i en enda körning,
 * avsedd för GitHub Actions (.github/workflows/weekly-pipeline.yml).
 * Anropar funktionerna i src/*.ts direkt (inte via separata *-cli.ts-
 * processer) för att slippa bräcklig fil-baserad ihopkoppling mellan
 * flera möten i samma körning — CLI-skripten (fetch-cli.ts osv.) finns
 * kvar för manuell felsökning av ett enskilt steg, men detta skript är
 * vad som faktiskt körs skarpt varje vecka.
 *
 * Miljövariabler:
 *   ANTHROPIC_API_KEY   — OBLIGATORISK (LLM A, extract-steget)
 *   VERIFY_API_KEY       — FRIVILLIG (LLM B). Saknas den, hoppas verify-
 *                           steget över helt och gates-godkända ärenden
 *                           går direkt vidare — se DECISION_LOG.md, öppen
 *                           fråga om modellfamiljs-oberoende. Loggas
 *                           tydligt varje körning, döljs aldrig.
 *   VERIFY_API_URL/VERIFY_MODEL — se verify-cli.ts
 *   ARCHIVE_ACCESS_KEY/ARCHIVE_SECRET_KEY — FRIVILLIGA (Wayback som extra,
 *                           sekundärt arkiv utöver git-primärarkivet).
 *   GITHUB_REPOSITORY    — sätts automatiskt av GitHub Actions.
 *
 * Körs så här (i CI, se workflow-filen för hela sekvensen inkl. commit):
 *   ANTHROPIC_API_KEY=sk-... node --experimental-strip-types scripts/run-weekly-pipeline.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { COMMITTEES, BASE_URL, SEEN_FILE } from "../src/config.ts";
import { loadSeen, fetchNewMeetingsForCommittee, markSeen } from "../src/fetch.ts";
import { downloadMeetingFiles } from "../src/download.ts";
import { extractPdfText, buildExtractionPrompt, parseExtractionResponse, stampPdfUrl } from "../src/extract.ts";
import { runGates } from "../src/gates.ts";
import { buildVerificationPrompt, parseVerificationResponse, reconcile } from "../src/verify.ts";
import { archiveArendenWithGit } from "../src/archive.ts";
import { linkArende, generateArendeId } from "../src/link.ts";
import { preparePublish } from "../src/publish.ts";
import { renderSite } from "../src/build.ts";

const USER_AGENT =
  "FaktagranskarenBot/0.1 (+https://mjorninstitutet.se/faktagranskaren; civic-tech, se metod-sida)";
const EXTRACT_MODEL = "claude-sonnet-4-6";

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
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error("ANTHROPIC_API_KEY saknas — avbryter (extract-steget kan inte köras utan den).");
    process.exit(1);
  }
  const verifyKey = process.env.VERIFY_API_KEY;
  const verifyApiUrl = process.env.VERIFY_API_URL ?? "https://api.anthropic.com/v1/messages";
  const verifyModel = process.env.VERIFY_MODEL ?? "claude-sonnet-4-6";
  if (!verifyKey) {
    console.error(
      "⚠️  VERIFY_API_KEY saknas — verify-steget (LLM B) HOPPAS ÖVER HELT denna körning. " +
        "Gates-godkända ärenden går direkt till link/publish utan en andra AI-granskning. " +
        "Se DECISION_LOG.md, öppen fråga om modellfamiljs-oberoende. Detta är en medveten, " +
        "loggad avvikelse — inte ett dolt fel."
    );
  } else if (verifyApiUrl.includes("anthropic.com")) {
    console.error(
      "⚠️  VERIFY_API_URL pekar mot Anthropic — samma leverantör som extract-steget (LLM A). " +
        "Modellfamiljs-oberoende (spec §2/§5) är INTE uppfyllt, bara ett andra, oberoende anrop. " +
        "Se DECISION_LOG.md."
    );
  }

  const seen = await loadSeen(SEEN_FILE, (p) => readFile(p, "utf-8"));
  const confirmedCommittees = COMMITTEES.filter((c) => c.confirmed);

  // KOSTNADSTAK (tillagt 2026-07-22, se DECISION_LOG.md): innan
  // seedMeetingUrl-fixen fanns ingen risk att en enda körning skulle
  // hitta orimligt många "nya" möten (listsidan visade bara ett fåtal
  // aktuella möten). Nu när en instans kan falla tillbaka på en
  // mötessidas fullständiga historik (potentiellt tillbaka till 2009)
  // MÅSTE veckopipelinen ha samma sorts hårda tak som backfill redan
  // har — annars kan en instans med tomt seen.json (t.ex. första
  // körningen efter att ett nytt seedMeetingUrl satts) plötsligt försöka
  // bearbeta hundratals historiska möten i EN körning, helt oavsiktligt.
  // Veckopipelinens jobb är att hänga med FRAMÅT, inte fylla på historik
  // — det är vad `scripts/run-backfill.mjs` finns för, med sitt eget
  // explicita, manuellt styrda tak.
  const MAX_NEW_MEETINGS_PER_RUN = 15;

  console.error(`Söker nya möten hos ${confirmedCommittees.length} bevakade instanser...`);
  const newMeetings = [];
  const perCommitteeResults = [];
  let cappedAnyCommittee = false;
  for (const committee of confirmedCommittees) {
    try {
      const found = await fetchNewMeetingsForCommittee(committee, seen, fetchText);
      if (found.length > 0) console.error(`  ${committee.name}: ${found.length} nytt`);
      newMeetings.push(...found);
      perCommitteeResults.push({ slug: committee.slug, foundCount: found.length, error: null });
    } catch (e) {
      console.error(`  ${committee.name}: FEL vid fetch — ${e.message} (hoppar över denna instans denna körning)`);
      perCommitteeResults.push({ slug: committee.slug, foundCount: 0, error: e.message });
    }
  }

  if (newMeetings.length > MAX_NEW_MEETINGS_PER_RUN) {
    cappedAnyCommittee = true;
    console.error(
      `\n⚠️  ${newMeetings.length} möten hittades, men taket är ${MAX_NEW_MEETINGS_PER_RUN} per körning. ` +
        `Bearbetar bara de ${MAX_NEW_MEETINGS_PER_RUN} äldsta nu — resten plockas upp i kommande körningar ` +
        `(veckovis, eller kör scripts/run-backfill.mjs manuellt för snabbare påfyllning). Detta är ett tecken ` +
        `på att en instans troligen just fått ett nytt seedMeetingUrl och har mycket historik att hämta in — ` +
        `INTE ett fel i sig, men värt att vara medveten om.`
    );
  }
  newMeetings.sort((a, b) => a.date.localeCompare(b.date)); // äldst först, konsekvent med backfill
  const cappedMeetings = newMeetings.slice(0, MAX_NEW_MEETINGS_PER_RUN);

  // Diagnostikfil, ALLTID skriven — samma resonemang som i
  // scripts/run-backfill.mjs (se DECISION_LOG.md 2026-07-22): GitHub
  // Actions egna loggar har visat sig opålitliga att komma åt både via
  // webbgränssnittet och via API. En committad fil går alltid att läsa
  // via contents-API:et, oberoende av det.
  const runTimestampForDiag = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir("data/weekly-run-log", { recursive: true });
  await writeFile(
    `data/weekly-run-log/${runTimestampForDiag}.json`,
    JSON.stringify(
      {
        timestamp: runTimestampForDiag,
        committeesChecked: confirmedCommittees.map((c) => c.slug),
        perCommitteeResults,
        totalNewMeetingsFound: newMeetings.length,
        cappedAtThisRun: cappedAnyCommittee,
        maxPerRun: MAX_NEW_MEETINGS_PER_RUN,
        meetingsThisRun: cappedMeetings.map((m) => `${m.committeeSlug} ${m.date}`),
      },
      null,
      2
    )
  );

  if (cappedMeetings.length === 0) {
    console.error("\nInga nya justerade protokoll hittades. Klart — inget att publicera denna vecka.");
    return;
  }
  console.error(`\n${cappedMeetings.length} möten att bearbeta denna körning${cappedAnyCommittee ? " (kapat, se varning ovan)" : ""}.\n`);

  const manifest = [];
  const allNeedsReview = [];
  const allToPublish = [];
  const rawTextByMeeting = new Map(); // pdfUrl -> extraherad källtext, för link-steget

  const downloadDeps = {
    fetchBinary,
    ensureDir: (p) => mkdir(p, { recursive: true }),
    writeFile: (p, data) => writeFile(p, data),
  };

  for (const meeting of cappedMeetings) {
    console.error(`--- ${meeting.committeeSlug} ${meeting.date} ---`);
    try {
      const meetingUrl = `${BASE_URL}/committees/${meeting.committeeSlug}/mote-${meeting.date}`;
      const meetingHtml = await fetchText(meetingUrl);
      const downloaded = await downloadMeetingFiles(meeting, meetingHtml, downloadDeps);
      manifest.push({ pdfUrl: meeting.protocolPdfUrl, relativePath: downloaded.protocolPath });

      const protocolBytes = await readFile(downloaded.protocolPath);
      const sourceText = await extractPdfText(new Uint8Array(protocolBytes));
      rawTextByMeeting.set(meeting.protocolPdfUrl, sourceText);

      const protocolRef = `§XX ${meeting.committeeSlug.toUpperCase()} ${meeting.date}`;
      const prompt = buildExtractionPrompt(sourceText, { protocolRef, date: meeting.date });
      const rawResponse = await callAnthropic({
        apiUrl: "https://api.anthropic.com/v1/messages",
        model: EXTRACT_MODEL,
        apiKey: anthropicKey,
        prompt,
        maxTokens: 16000,
      });
      const extractResult = parseExtractionResponse(rawResponse);
      if (!extractResult.ok) {
        console.error(`  ⚠ Extraktionsfel (${extractResult.errors.length}), fortsätter med giltiga poster:`);
        extractResult.errors.forEach((e) => console.error(`    - ${e}`));
      }
      stampPdfUrl(extractResult.arenden, meeting.protocolPdfUrl);
      console.error(`  ${extractResult.arenden.length} kandidatärenden extraherade.`);

      const { ready, needsReview } = runGates(extractResult.arenden, sourceText);
      console.error(`  gates: ${ready.length} godkända, ${needsReview.length} till needs_review.`);
      allNeedsReview.push(...needsReview);

      let toPublishThisMeeting = ready.map((r) => r.arende);
      if (verifyKey) {
        const reconciled = [];
        for (const arende of ready.map((r) => r.arende)) {
          const vPrompt = buildVerificationPrompt(arende, sourceText);
          const vRaw = await callAnthropic({
            apiUrl: verifyApiUrl,
            model: verifyModel,
            apiKey: verifyKey,
            prompt: vPrompt,
            maxTokens: 2000,
          });
          const vResult = parseVerificationResponse(vRaw);
          const fakeGateResult = { arende, passed: true, checks: [] };
          reconciled.push(reconcile(fakeGateResult, vResult));
        }
        toPublishThisMeeting = reconciled.filter((r) => r.finalStatus === "publish").map((r) => r.arende);
        const verifyRejected = reconciled.filter((r) => r.finalStatus === "needs_review");
        allNeedsReview.push(...verifyRejected);
        console.error(`  verify: ${toPublishThisMeeting.length} godkända, ${verifyRejected.length} till needs_review.`);
      }

      allToPublish.push(...toPublishThisMeeting);
      markSeen(seen, meeting.committeeSlug, meeting.date);
    } catch (e) {
      console.error(`  ✗ FEL vid bearbetning av detta möte, hoppar över: ${e.message}`);
    }
  }

  await mkdir("data/needs_review", { recursive: true });
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(`data/needs_review/${runTimestamp}.json`, JSON.stringify(allNeedsReview, null, 2));
  console.error(`\n${allNeedsReview.length} poster totalt till needs_review (se data/needs_review/${runTimestamp}.json).`);

  // Arkiv: git-primärt, offline (se DECISION_LOG.md 2026-07-20).
  await mkdir("data/raw", { recursive: true });
  const existingManifestRaw = await readFile("data/raw/manifest.json", "utf-8").catch(() => "[]");
  const fullManifest = [...JSON.parse(existingManifestRaw), ...manifest];
  await writeFile("data/raw/manifest.json", JSON.stringify(fullManifest, null, 2));

  const rawFiles = [];
  for (const m of manifest) {
    rawFiles.push({ pdfUrl: m.pdfUrl, relativePath: m.relativePath, bytes: new Uint8Array(await readFile(m.relativePath)) });
  }
  const { arenden: archivedArenden } = archiveArendenWithGit(allToPublish, rawFiles);
  console.error(`Git-arkiv: ${rawFiles.length} rå-filer PENDING-markerade (fylls i efter commit av fill-archive-urls.mjs).`);

  // Link: koppla mot befintlig databas, samma logik som link-cli.ts.
  const publishedDbRaw = await readFile("data/published/arenden.json", "utf-8").catch(() => "[]");
  const publishedDb = JSON.parse(publishedDbRaw);
  const existingIds = new Set(publishedDb.map((a) => a.id));

  for (const candidate of archivedArenden) {
    const pdfUrl = candidate.steps[candidate.steps.length - 1]?.source?.pdf_url;
    const sourceText = pdfUrl ? rawTextByMeeting.get(pdfUrl) ?? "" : "";
    const match = linkArende(candidate, sourceText, publishedDb);

    if (match.kind === "paragraph_ref") {
      console.error(`✓ "${candidate.title}" → kopplad till ${match.existing.id}`);
      match.existing.steps.push(...candidate.steps);
      match.existing.status = candidate.status;
    } else {
      const year = parseInt(candidate.steps[0]?.date?.slice(0, 4) ?? new Date().getFullYear().toString(), 10);
      const id = generateArendeId(year, existingIds);
      existingIds.add(id);
      const flag =
        match.kind === "fuzzy_title"
          ? { _link_flag: `Möjlig dubblett av ${match.existing.id} (titel-likhet ${match.score.toFixed(2)}) — ej auto-sammanslagen` }
          : {};
      console.error(`+ "${candidate.title}" → nytt ärende ${id}${match.kind === "fuzzy_title" ? " (flaggad, se _link_flag)" : ""}`);
      publishedDb.push({ ...candidate, id, ...flag });
    }
  }

  // Publish: kanonisera, hasha, changelog.
  const previous = JSON.parse(await readFile("data/publish/last-published.json", "utf-8").catch(() => "[]"));
  const { canonical, dataHash, changelogEntry } = preparePublish(publishedDb, previous, runTimestamp);
  await mkdir("data/publish", { recursive: true });
  await writeFile("data/published/arenden.json", JSON.stringify(canonical, null, 2));
  await writeFile("data/publish/last-published.json", JSON.stringify(canonical, null, 2));
  await writeFile("data/publish/data_hash.txt", dataHash);
  const changelogRaw = await readFile("data/publish/changelog.json", "utf-8").catch(() => "[]");
  const changelog = JSON.parse(changelogRaw);
  changelog.push(changelogEntry);
  await writeFile("data/publish/changelog.json", JSON.stringify(changelog, null, 2));
  console.error(`\nPublish: ${publishedDb.length} ärenden totalt, data_hash ${dataHash.slice(0, 12)}...`);

  // Build: statisk sajt.
  const html = await renderSite(publishedDb);
  await mkdir("dist/api", { recursive: true });
  await writeFile("dist/index.html", html);
  await writeFile("dist/api/arenden.json", JSON.stringify(publishedDb, null, 2));
  console.error(`Build: dist/index.html (${publishedDb.length} ärenden), dist/api/arenden.json`);

  // seen.json uppdateras EFTER publish (se markSeen-kommentaren i fetch.ts).
  await writeFile(SEEN_FILE, JSON.stringify(seen, null, 2));
  console.error(`Uppdaterat: ${SEEN_FILE}`);
}

main().catch((err) => {
  console.error("Ohanterat fel i run-weekly-pipeline.mjs:", err);
  process.exit(1);
});
