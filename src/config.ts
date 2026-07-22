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
  note?: string;
}

export const COMMITTEES: Committee[] = [
  { slug: "kommunfullmaktige", name: "Kommunfullmäktige", confirmed: true },
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
