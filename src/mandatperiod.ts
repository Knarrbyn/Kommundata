/**
 * mandatperiod.ts — mandatperiod-filtrering.
 *
 * Se ägarbeslut 2026-09-05 (`claude/beslut-mandatperiod-hantering-2026-09-05.md`
 * i Mjörninstitutet-projektet): efter varje kommunval börjar sajten blanda
 * ihop flera mandatperioders ärenden i /sok och /namnd/[slug]. Lösningen är
 * ren filtrering/uppdelning per mandatperiod — INGEN konstellations- eller
 * röstningsanalys per majoritet (avstod medvetet: av 4304 steg i
 * produktionsdatan vid beslutstillfället hade bara 83 en registrerad
 * röstsiffra och NOLL en per-parti-nedbrytning — för tunt underlag).
 *
 * BRYTPUNKT: juridiskt tillträder fullmäktige redan 15 oktober valåret,
 * medan nämnder/kommunstyrelse tillträder 1 januari påföljande år.
 * Ägarbeslutet valde ETT globalt brytdatum för hela sajten — 1 januari
 * påföljande år — framför juridisk exakthet per instans. Konsekvens:
 * fullmäktiges och kommunstyrelsens beslut i oktober–december ett valår
 * visas fortfarande under FÖREGÅENDE mandatperiod. Se
 * MANDATPERIOD_FORKLARING nedan för texten till besökaren om detta.
 *
 * Rena funktioner, ingen AI, inget nätverk, helt offline — samma mönster
 * som gates.ts och link.ts.
 */

// Valår kongruenta med 2022 (mod 4): ..., 2018, 2022, 2026, 2030, ...
// Mandatperioden "E–E+4" gäller för datum >= (E+1)-01-01 och < (E+5)-01-01,
// dvs. hela E+1 till och med E+4 (fyra kalenderår), plus valåret E+4 självt
// räknas ännu INTE hit förrän 1 januari E+5 (se ägarbeslutet ovan).
const REFERENCE_ELECTION_YEAR = 2022;

/**
 * Härleder vilken mandatperiod ett enskilt datum (ÅÅÅÅ-MM-DD) tillhör,
 * enligt det globala brytdatumet 1 januari. Exempel: "2026-11-03" →
 * "2022-2026" (fortfarande föregående period enligt ägarbeslutet), men
 * "2027-01-01" → "2026-2030".
 */
export function deriveMandatperiod(date: string): string {
  const year = Number(date.slice(0, 4));
  if (!Number.isFinite(year) || date.length < 10) {
    throw new Error(`Ogiltigt datum, kan inte härleda mandatperiod: "${date}"`);
  }
  const periodIndex = Math.floor((year - (REFERENCE_ELECTION_YEAR + 1)) / 4);
  const startYear = REFERENCE_ELECTION_YEAR + periodIndex * 4;
  return `${startYear}-${startYear + 4}`;
}

/**
 * Härleder samtliga mandatperioder som en mängd datum (typiskt ett
 * ärendes `steps[].date`) sträcker sig över. Array, inte en enda sträng
 * — ett ärendes steg kan sträcka sig över ett årsskifte (t.ex. en motion
 * väckt hösten 2026 med KF-beslut våren 2027 blir
 * `["2022-2026", "2026-2030"]`). Unik, sorterad kronologiskt (äldsta
 * perioden först). Tom input ger tom array.
 */
export function deriveMandatperioder(dates: string[]): string[] {
  const unique = new Set(dates.map(deriveMandatperiod));
  return Array.from(unique).sort((a, b) => Number(a.slice(0, 4)) - Number(b.slice(0, 4)));
}

/**
 * Mandatperioden som gäller just nu (eller vid ett givet datum, för
 * testbarhet), så sajtens default-filter kan visa innevarande period utan
 * manuellt ingrepp och byta automatiskt vid varje årsskifte.
 */
export function currentMandatperiod(now: Date = new Date()): string {
  return deriveMandatperiod(now.toISOString().slice(0, 10));
}

/**
 * Lägger till `mandatperioder` på varje ärende i en lista, härlett ur dess
 * `steps[].date`. Ren, icke-muterande funktion — returnerar en NY array,
 * rör aldrig indata.
 *
 * Anropas explicit i pipelineskripten (run-weekly-pipeline.mjs,
 * run-backfill.mjs, publish-cli.ts) INNAN preparePublish/renderSite, så
 * att den canoniserade databasen, dist-bygget och dist/api/arenden.json
 * alltid är konsekventa. Medvetet INTE inbakat i publish.ts:s
 * preparePublish — det skulle ändra dess hash-/diff-kontrakt (se
 * publish.test.ts, som jämför `computeDataHash(current)` rakt av). Det
 * här är ett separat, valfritt anrikningssteg, precis som moten.ts:s
 * upsertMotesIndex.
 */
export function addMandatperioder<T extends { steps: Array<{ date: string }> }>(
  arenden: T[]
): (T & { mandatperioder: string[] })[] {
  return arenden.map((a) => ({
    ...a,
    mandatperioder: deriveMandatperioder(a.steps.map((s) => s.date)),
  }));
}

/**
 * Texten som förklarar brytpunkts-avvägningen för besökaren (tooltip vid
 * filtret på /sok och /namnd/[slug], samt utskriven i sin helhet på
 * /om-sidan). Hålls här som en enda källa istället för att dupliceras i
 * templates/site.html, även om själva sajt-JS:en (som inte importerar
 * denna fil — statisk sajt utan delad build) håller en egen kopia av
 * texten; ändra båda om texten justeras.
 */
export const MANDATPERIOD_FORKLARING =
  "Kommunfullmäktige och kommunstyrelsen får nya ledamöter redan i " +
  "oktober–december valåret, men för enkelhetens skull räknar " +
  "Faktagranskaren hela sajten som att en ny mandatperiod börjar 1 " +
  "januari året därpå. Beslut som fullmäktige och kommunstyrelsen " +
  "fattar under hösten ett valår visas därför fortfarande under den " +
  "föregående mandatperioden.";
