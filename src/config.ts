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
    confirmed: false,
    note: "Ej bekräftad som egen nämnd under research — 'samhällsbyggnadsförvaltningen' " +
      "förekommer ofta som BEREDANDE förvaltning i ärenden som sedan avgörs av tekniska " +
      "nämnden, bygg- och miljönämnden eller direkt av KS/KF. Kan vara att denna nämnd inte " +
      "finns i Alingsås — verifiera mot /committees innan aktivering.",
  },
];

export const BASE_URL = "https://sammantradesportal.alingsas.se";

/** Sökväg till filen som håller reda på redan bearbetade protokoll (per instans). */
export const SEEN_FILE = "data/seen.json";
