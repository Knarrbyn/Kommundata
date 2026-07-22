/**
 * archive.ts — pipeline §5, steg 6.
 *
 * OMSKRIVEN 2026-07-20 (se DECISION_LOG.md för fullständigt resonemang).
 *
 * PRIMÄRT ARKIV: git-historiken (ARKITEKTURMALL §2, punkt 5 — "Sten kan
 * inte hackas"). Den nedladdade rå-PDF:en committas tillsammans med
 * resten av pipelinens data (`data/raw/{instans}/{datum}/...`), och en
 * permalänk pinnad mot den specifika commit-SHA:n fungerar som den
 * "arkiverade kopian" spec §3 lovar vid varje citat. Inget beroende av
 * en extern tredje part alls — varken Wayback Machine/Internet Archive
 * eller någon annan. Detta är ett MEDVETET BÄTTRE VAL, inte en
 * avvikelse: starkare i det att arkivet aldrig kan försvinna om en
 * extern tjänst läggs ner eller blockeras, svagare i det att det saknas
 * en oberoende tredjepartsbekräftelse av att dokumentet fanns vid den
 * tidpunkten — en rimlig avvägning givet att den publika sajten redan är
 * helt statisk och varje citat är grindat av verbatimgrinden (R2).
 *
 * SEKVENSPROBLEM OCH LÖSNING: git-commit görs INTE av pipelinekoden (se
 * publish.ts) — det är CI:s (GitHub Actions) ansvar, EFTER att
 * publish/build körts. Archive-steget känner alltså ÄNNU INTE till vilken
 * commit-SHA rå-PDF:en hamnar i när det körs. Lösning: `buildPendingGitArchiveMarker`
 * sätter en tydlig PENDING-markör (aldrig en trasig länk eller ett bokstavligt
 * "TODO" som kan läcka till produktion, se DECISION_LOG.md), och ett separat
 * litet efterkomsteg i CI (se `scripts/fill-archive-urls.mjs`) körs EFTER
 * `git commit`, läser av `git rev-parse HEAD`, och fyller i den riktiga
 * permalänken i en uppföljande commit.
 *
 * SEKUNDÄRT, FRIVILLIGT ARKIV: Wayback Machine/SPN2-koden längre ner i den
 * här filen är oförändrad men nu explicit VALFRI — avstängd som standard,
 * körs bara om ARCHIVE_ACCESS_KEY/ARCHIVE_SECRET_KEY finns satta (se
 * archive-cli.ts), och ett misslyckande där blockerar ALDRIG pipelinen
 * eftersom git-arkivet redan är den garanterade primärkällan.
 */

import { createHash } from "node:crypto";
import type { CandidateArende } from "./extract.ts";

export interface GitArchiveContext {
  /** t.ex. "mjorninstitutet/faktagranskaren" */
  githubRepo: string;
  /** Sökväg relativt repo-roten, t.ex. "data/raw/kommunfullmaktige/2026-03-25/protokoll.pdf" */
  relativePath: string;
}

/**
 * SHA-256 av rå-PDF-innehållet. Ren integritetskontroll (går att verifiera
 * oberoende av git) — sparas tillsammans med archive_url så att en
 * granskare kan bekräfta att filen på den arkiverade länken faktiskt är
 * bit-för-bit samma fil som ursprungligen hämtades, utan att behöva lita
 * på git ensamt.
 */
export function computeFileHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Bygger en PENDING-markör för archive_url innan commit-SHA:n är känd.
 * Aldrig en trasig länk eller ett bokstavligt "TODO" (jfr testriggens
 * äldre `"archive_url": "TODO"` — det får ALDRIG nå produktion, se
 * DECISION_LOG.md). Byggmallen (templates/site.html) känner igen detta
 * prefix och döljer arkivlänken snyggt istället för att visa den trasig.
 */
export function buildPendingGitArchiveMarker(relativePath: string): string {
  return `git-pending:${relativePath}`;
}

export function isPendingGitArchiveMarker(archiveUrl: string | null | undefined): boolean {
  return typeof archiveUrl === "string" && archiveUrl.startsWith("git-pending:");
}

/**
 * Bygger den slutgiltiga, commit-pinnade GitHub-permalänken. Körs av
 * `scripts/fill-archive-urls.mjs` EFTER att CI:s `git commit` har skett,
 * när `commitSha` faktiskt är känd.
 */
export function buildGitArchiveUrl(ctx: GitArchiveContext, commitSha: string): string {
  return `https://github.com/${ctx.githubRepo}/blob/${commitSha}/${ctx.relativePath}`;
}

/* ============ Sekundärt, frivilligt arkiv: Wayback Machine / SPN2 ============
 * Allt nedan är OFÖRÄNDRAT sedan den ursprungliga versionen, men nu
 * explicit valfritt (se modulkommentaren ovan). Behålls eftersom en andra,
 * oberoende extern arkivering fortfarande är ett trevligt extra skydd för
 * den som vill sätta upp ett archive.org-konto — bara inte en förutsättning
 * längre för att G2/§3:s "arkiverad kopia"-löfte ska hållas.
 * ============================================================================ */

/**
 * ⚠️ HELT OTESTAT MOT RIKTIGA NÄTVERKET — dubbel anledning:
 * 1. Sandboxens bash-nätverk når inte web.archive.org (samma begränsning
 *    som sammantradesportal.alingsas.se).
 * 2. Efter research visade det sig att den enkla, oautentiserade
 *    GET-genvägen (`web.archive.org/save/<url>`) som ofta nämns i äldre
 *    exempel/blogginlägg rapporteras vara opålitlig eller trasig av flera
 *    oberoende källor (GitHub-issues 2020–2022) — ibland saknas
 *    "Content-Location"-headern som svaret ska bygga på. Det korrekta,
 *    moderna sättet är SPN2 ("Save Page Now 2"), som KRÄVER ett gratis
 *    archive.org-konto med S3-liknande API-nycklar (access key + secret
 *    key från https://archive.org/account/s3.php), skickade via en
 *    "Authorization: LOW <access_key>:<secret_key>"-header i en POST.
 * Den här modulen är byggd mot SPN2:s dokumenterade format (asynkront:
 * submit → job_id → pollа status → arkiverad URL), men eftersom jag varken
 * kunnat nå API:et eller skaffa nycklar är HELA flödet konstruerat utifrån
 * dokumentation, inte verifierat mot ett riktigt svar. Betrakta detta som
 * en FÖRSTA VERSION att stämma av skarpt, inte en färdig lösning — mer så
 * än något annat steg i den här pipelinen.
 */

export interface SubmitResponse {
  jobId: string | null;
  error: string | null;
}

export interface StatusResponse {
  status: "success" | "pending" | "error";
  archivedUrl: string | null;
  errorMessage: string | null;
}

const SPN2_SUBMIT_URL = "https://web.archive.org/save";
const SPN2_STATUS_URL = "https://web.archive.org/save/status";

export function buildAuthHeader(accessKey: string, secretKey: string): string {
  return `LOW ${accessKey}:${secretKey}`;
}

/**
 * Bygger POST-body för submit-anropet. `capture_all=1` ber crawlern spara
 * sidan även om den svarar med ett fel-statuskod (annars sparas bara 200
 * OK) — relevant om ett kommunprotokoll tillfälligt är otillgängligt.
 */
export function buildSubmitBody(url: string): string {
  const params = new URLSearchParams({ url, capture_all: "1" });
  return params.toString();
}

/**
 * Parsar submit-svaret. SPN2 förväntas svara med JSON som innehåller
 * "job_id" vid lyckad inlämning. Faller tillbaka på ett tydligt fel om
 * strukturen inte stämmer, istället för att krascha eller anta framgång.
 */
export function parseSubmitResponse(rawBody: string): SubmitResponse {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    if (typeof parsed.job_id === "string" && parsed.job_id.length > 0) {
      return { jobId: parsed.job_id, error: null };
    }
    if (typeof parsed.message === "string") {
      return { jobId: null, error: parsed.message };
    }
    return { jobId: null, error: "Svaret innehöll varken job_id eller message — okänt format" };
  } catch (e) {
    return { jobId: null, error: `Ogiltig JSON i submit-svar: ${(e as Error).message}` };
  }
}

/**
 * Parsar ett status-svar (pollning av en pågående arkivering). Bygger den
 * slutgiltiga arkiverade URL:en av `timestamp` + `original_url` enligt
 * Wayback Machines kända URL-mönster (`/web/{timestamp}/{original_url}`)
 * när status är "success".
 */
export function parseStatusResponse(rawBody: string): StatusResponse {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch (e) {
    return { status: "error", archivedUrl: null, errorMessage: `Ogiltig JSON i status-svar: ${(e as Error).message}` };
  }

  const status = parsed.status;
  if (status === "pending") {
    return { status: "pending", archivedUrl: null, errorMessage: null };
  }
  if (status === "success") {
    const timestamp = parsed.timestamp;
    const originalUrl = parsed.original_url;
    if (typeof timestamp !== "string" || typeof originalUrl !== "string") {
      return {
        status: "error",
        archivedUrl: null,
        errorMessage: "status=success men timestamp/original_url saknas — kan inte bygga arkiv-URL",
      };
    }
    return {
      status: "success",
      archivedUrl: `https://web.archive.org/web/${timestamp}/${originalUrl}`,
      errorMessage: null,
    };
  }
  // status === "error", eller ett okänt värde — behandla defensivt som fel.
  const errorMessage = typeof parsed.message === "string" ? parsed.message : `Okänd status: ${JSON.stringify(status)}`;
  return { status: "error", archivedUrl: null, errorMessage };
}

export interface ArchiveDeps {
  fetchText: (url: string, init: RequestInit) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
}

/**
 * Skickar in en URL för arkivering och pollar tills den är klar (eller
 * misslyckas / timar ut). SPN2 är asynkront — en lyckad submit ger bara
 * ett job_id, inte den slutgiltiga arkiv-URL:en direkt.
 */
export async function archiveUrl(
  originalUrl: string,
  accessKey: string,
  secretKey: string,
  deps: ArchiveDeps,
  maxAttempts = 10,
  pollIntervalMs = 3000
): Promise<{ archivedUrl: string | null; error: string | null }> {
  const authHeader = buildAuthHeader(accessKey, secretKey);

  const submitBody = await deps.fetchText(SPN2_SUBMIT_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: buildSubmitBody(originalUrl),
  });

  const submitResult = parseSubmitResponse(submitBody);
  if (!submitResult.jobId) {
    return { archivedUrl: null, error: submitResult.error };
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await deps.sleep(pollIntervalMs);
    const statusBody = await deps.fetchText(`${SPN2_STATUS_URL}/${submitResult.jobId}`, {
      headers: { Accept: "application/json", Authorization: authHeader },
    });
    const statusResult = parseStatusResponse(statusBody);
    if (statusResult.status === "success") {
      return { archivedUrl: statusResult.archivedUrl, error: null };
    }
    if (statusResult.status === "error") {
      return { archivedUrl: null, error: statusResult.errorMessage };
    }
    // "pending" — fortsätt polla.
  }

  return { archivedUrl: null, error: `Gav upp efter ${maxAttempts} pollningsförsök (job_id: ${submitResult.jobId})` };
}

/* ============ Orkestrering: git-primärt arkiv för en hel ärendemängd ============ */

export interface RawFileEntry {
  /** Måste matcha exakt den pdf_url som står i step.source.pdf_url */
  pdfUrl: string;
  /** Sökväg relativt repo-roten där filen faktiskt sparats på disk/committas, t.ex. "data/raw/kommunfullmaktige/2026-03-25/protokoll.pdf" */
  relativePath: string;
  bytes: Uint8Array;
}

export interface ArchiveResult {
  arenden: CandidateArende[];
  /** relativePath → SHA-256, för en separat integritetslogg om man vill */
  fileHashes: Record<string, string>;
}

/**
 * Primärt arkiveringssteg (git). Rent, offline, inget nätverk krävs.
 * Sätter `source.archive_url` till en PENDING-markör för varje steg vars
 * `pdf_url` matchar en känd rå-fil — den riktiga commit-pinnade länken
 * fylls i EFTER git commit av `scripts/fill-archive-urls.mjs` (se
 * modulkommentaren överst i filen för varför sekvensen måste vara sådan).
 * Steg vars pdf_url INTE matchar någon känd rå-fil (t.ex. en bilaga som
 * download-steget av någon anledning inte sparat) lämnas orörda — hellre
 * ingen arkivlänk alls än en felaktig.
 */
export function archiveArendenWithGit(
  arenden: CandidateArende[],
  rawFiles: RawFileEntry[]
): ArchiveResult {
  const fileHashes: Record<string, string> = {};
  const urlToPath = new Map<string, string>();
  for (const f of rawFiles) {
    urlToPath.set(f.pdfUrl, f.relativePath);
    fileHashes[f.relativePath] = computeFileHash(f.bytes);
  }

  for (const arende of arenden) {
    for (const step of arende.steps) {
      const source = step.source as { protocol_ref: string; pdf_url?: string; archive_url?: string };
      const relativePath = source.pdf_url ? urlToPath.get(source.pdf_url) : undefined;
      if (relativePath) {
        source.archive_url = buildPendingGitArchiveMarker(relativePath);
      }
    }
  }

  return { arenden, fileHashes };
}
