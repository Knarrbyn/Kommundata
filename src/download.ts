/**
 * download.ts — pipeline §5, steg 2.
 *
 * Ansvar: för ett möte med känt protokoll (från fetch-steget), ladda ner
 * protokoll-PDF:en OCH alla enskilda kallelsebilagor som PDF-filer till
 * disk, redo för extract-steget (§5, steg 3) att textextrahera.
 *
 * VARFÖR BILAGOR MÅSTE HÄMTAS SEPARAT (inte bara protokollet):
 * R9 (spec v1.5) visade empiriskt att en interpellations svarstext INTE är
 * inbäddad i protokollets löptext — bara konstaterandet att ett svar
 * lämnats. Den faktiska svarstexten ligger i en egen bilaga-PDF. Om
 * pipeline bara laddade ner protokollet skulle sådana citat aldrig gå att
 * verifiera ordagrant (R2/verbatimgrinden).
 *
 * URL-MÖNSTER (bekräftade under research-arbetet, se README.md):
 *   Protokoll:        /committees/{slug}/mote-{datum}/protocol/{fil}pdf?downloadMode=open
 *   Kallelsebilaga:    /welcome-sv/namnder-styrelser/{slug}/mote-{datum}/agenda/{fil}pdf?downloadMode=open
 * Båda mönstren förekommer på SAMMA sida (mötessidan visar Kallelse- och
 * Protokoll-flikarna i en enda sidladdning) — samma HTML som fetch-steget
 * redan hämtade för att hitta protokollänken kan därför återanvändas här
 * utan ett extra nätverksanrop, se downloadMeetingFiles().
 *
 * Samma försiktighetsprincip som fetch.ts: regex på URL-mönster i råtext,
 * inte DOM/CSS-parsing — se den filens header-kommentar för resonemanget.
 */

import type { MeetingWithProtocol } from "./fetch.ts";

export interface BilagaRef {
  url: string;
  /** Härlett filnamn (utan mapp), t.ex. "svar-pa-interpellation-...-vpdf" → "svar-pa-interpellation-....pdf" */
  filename: string;
}

export interface DownloadedMeeting {
  committeeSlug: string;
  date: string;
  protocolPath: string;
  bilagaPaths: string[];
}

// VIKTIGT FYND (2026-07-22, se DECISION_LOG.md): samma sak som i fetch.ts —
// länkar i den råa HTML:en en vanlig fetch() faktiskt får kan vara RELATIVA
// (utan domän-prefix). Domänen är därför valfri i mönstret nedan.
const AGENDA_BILAGA_RE =
  /(?:https:\/\/sammantradesportal\.alingsas\.se)?\/welcome-sv\/namnder-styrelser\/[^"'\s)>]+?\/agenda\/([^"'\s)>/]+?pdf(?:-\d+)?)(?:\?downloadMode=open)?/g;

/**
 * Extraherar alla enskilda kallelsebilaga-PDF:er från en mötessidas råtext.
 * Dedupear (samma bilaga kan länkas flera gånger — t.ex. både i
 * ärenderubriken och i "Ladda ner dokument"-knappen).
 */
export function extractAgendaBilagaLinks(html: string): BilagaRef[] {
  const seen = new Set<string>();
  const refs: BilagaRef[] = [];
  let match: RegExpExecArray | null;
  AGENDA_BILAGA_RE.lastIndex = 0;
  while ((match = AGENDA_BILAGA_RE.exec(html)) !== null) {
    const fullUrl = match[0].startsWith("http") ? match[0] : `https://sammantradesportal.alingsas.se${match[0]}`;
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);
    const slug = match[1];
    refs.push({ url: fullUrl, filename: `${sanitizeFilename(slug)}.pdf` });
  }
  return refs;
}

function sanitizeFilename(slug: string): string {
  // Ta bort den mediala "pdf" (och ev. numeriskt suffix efteråt hanteras separat)
  // så filnamnet inte blir "...pdf.pdf". slug kan sluta med "pdf" eller "pdf-12345".
  const withoutTrailingPdf = slug.replace(/pdf(-\d+)?$/, "$1");
  return withoutTrailingPdf.replace(/[?#].*$/, "").slice(0, 150);
}

/**
 * Bygger den lokala mappstrukturen för ett mötes nedladdade filer:
 *   {baseDir}/{slug}/{datum}/protokoll.pdf
 *   {baseDir}/{slug}/{datum}/bilagor/{filnamn}.pdf
 *
 * `baseDir` är konfigurerbar (tillagt 2026-07-23, se DECISION_LOG.md) —
 * i skarp drift pekas den mot en checkout av det separata "kalla"
 * arkiv-repot (`Kommundata-arkiv`) istället för `data/raw` i huvudrepot,
 * för att hålla huvudrepot smått och snabbt att klona/checka ut vid
 * varje pipeline-körning. Default är oförändrat `data/raw`, så befintlig
 * kod/tester som inte bryr sig om detta fortsätter fungera exakt som förut.
 */
export function localPathsFor(meeting: MeetingWithProtocol, baseDir: string = "data/raw") {
  const dir = `${baseDir}/${meeting.committeeSlug}/${meeting.date}`;
  return {
    dir,
    protocolPath: `${dir}/protokoll.pdf`,
    bilagaDir: `${dir}/bilagor`,
  };
}

export interface DownloadDeps {
  fetchBinary: (url: string) => Promise<Uint8Array>;
  ensureDir: (path: string) => Promise<void>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
}

/**
 * Laddar ner protokoll-PDF + samtliga kallelsebilagor för ett möte.
 * `meetingHtml` ska vara samma sida fetch-steget redan hämtade
 * (ref.meetingUrl) — innehåller både protokoll- och kallelsefliken.
 */
export async function downloadMeetingFiles(
  meeting: MeetingWithProtocol,
  meetingHtml: string,
  deps: DownloadDeps,
  baseDir: string = "data/raw"
): Promise<DownloadedMeeting> {
  const paths = localPathsFor(meeting, baseDir);
  await deps.ensureDir(paths.dir);
  await deps.ensureDir(paths.bilagaDir);

  const protocolBytes = await deps.fetchBinary(meeting.protocolPdfUrl);
  await deps.writeFile(paths.protocolPath, protocolBytes);

  const bilagor = extractAgendaBilagaLinks(meetingHtml);
  const bilagaPaths: string[] = [];
  for (const bilaga of bilagor) {
    const bytes = await deps.fetchBinary(bilaga.url);
    const dest = `${paths.bilagaDir}/${bilaga.filename}`;
    await deps.writeFile(dest, bytes);
    bilagaPaths.push(dest);
  }

  return {
    committeeSlug: meeting.committeeSlug,
    date: meeting.date,
    protocolPath: paths.protocolPath,
    bilagaPaths,
  };
}
