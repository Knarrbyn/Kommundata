/**
 * Bevakade instanser (spec §2.1, §9 "Arbetsutskott").
 *
 * VIKTIGT: `confirmed` markerar om slugen faktiskt observerats i en riktig
 * URL under research-arbetet i den här konversationen, eller om den bara är
 * en rimlig gissning utifrån namnmönstret. Sandboxens nätverk tillåter inte
 * anrop till sammantradesportal.alingsas.se härifrån (se README), så
 * unconfirmed-slugs MÅSTE verifieras manuellt (öppna
 * https://sammantradesportal.alingsas.se/committees i en vanlig webbläsare
 * och jämför listan) innan pipelinen körs skarpt mot dem.
 *
 * Arbetsutskott exkluderas medvetet (spec §2.1: "beredande organ, sällan
 * slutgiltiga beslut").
 */

export interface Committee {
  slug: string;
  name: string;
  confirmed: boolean;
  /**
   * KRITISKT (tillagt 2026-07-22, se DECISION_LOG.md): bara listsidan
   * (/committees/{slug}, utan ett specifikt möte) innehåller INGA
   * mötalänkar när den hämtas programmatiskt — bekräftat empiriskt i
   * skarp drift. En ENSKILD mötessida har däremot bevisat en fullständig
   * sidmeny med hela historiken. `fetch.ts` faller därför tillbaka på
   * detta fält om listsidan ger noll träffar. Sätt det till en KÄND,
   * fungerande mötes-URL för instansen (vilken som helst — gammal eller
   * ny, sidmenyn har allt). Uppdateras gärna över tid till en nyare känd
   * URL, men behöver inte — vilken som helst räcker.
   */
  seedMeetingUrl?: string;
  note?: string;
}

export const COMMITTEES: Committee[] = [
  {
    slug: "kommunfullmaktige",
    name: "Kommunfullmäktige",
    confirmed: true,
    seedMeetingUrl: "https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-01-28",
  },
  { slug: "kommunstyrelsen", name: "Kommunstyrelsen", confirmed: true },
  { slug: "vard-och-omsorgsnamnden", name: "Vård- och omsorgsnämnden", confirmed: true },
  { slug: "tekniska-namnden", name: "Tekniska nämnden", confirmed: true },
  { slug: "kultur-och-utbildningsnamnden", name: "Kultur- och utbildningsnämnden", confirmed: true },
  { slug: "socialnamnden", name: "Socialnämnden", confirmed: true },
  { slug: "barn-och-ungdomsnamnden", name: "Barn- och ungdomsnämnden", confirmed: true },
  { slug: "bygg-och-miljonamnden", name: "Bygg- och miljönämnden", confirmed: true },
  { slug: "overformyndarnamnden", name: "Överförmyndarnämnden", confirmed: true },
  {
    slug: "samhallsbyggnadsnamnden",
    name: "Samhällsbyggnadsnämnden",
    confirmed: true,
    note: "Bekräftad 2026-07-22 via webbsökning mot /committees/samhallsbyggnadsnamnden — " +
      "riktiga möten och protokoll hittade (t.ex. mote-2021-01-25, ett justerat protokoll " +
      "med diariefört ärende). Nämnden finns alltså på riktigt, till skillnad från vad den " +
      "tidigare noten misstänkte. Bekräftade samtidigt att arbetsutskottet ligger på en " +
      "SEPARAT slug (samhallsbyggnadsnamndens-arbetsutskott) — konsekvent med att AU redan " +
      "medvetet exkluderas i v1 (spec §2.1).",
  },
];

export const BASE_URL = "https://sammantradesportal.alingsas.se";

/** Sökväg till filen som håller reda på redan bearbetade protokoll (per instans). */
export const SEEN_FILE = "data/seen.json";

/**
 * "Kallt" arkiv-repo för rå-dokument (protokoll-PDF:er + kallelsebilagor).
 * Tillagt 2026-07-23 (se DECISION_LOG.md) — separat repo istället för att
 * committa allt till huvudrepot, för att hålla huvudrepot (som checkas ut
 * vid VARJE pipeline-körning, veckovis för alltid) smått och snabbt.
 * Kräver en egen secret (`ARCHIVE_REPO_TOKEN`) i workflow-filerna, eftersom
 * GitHub Actions inbyggda token bara har behörighet till sitt eget repo.
 */
export const ARCHIVE_REPO = "Knarrbyn/Kommundata-arkiv";

/** Lokal checkout-katalog för arkiv-repot under en pipeline-körning (se workflow-filerna). */
export const ARCHIVE_LOCAL_DIR = "archive-repo";
