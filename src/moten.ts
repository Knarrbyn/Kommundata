/**
 * moten.ts — spec-tillägg (se DECISION_LOG.md 2026-08-24): ett nytt,
 * fristående datalager vid sidan av `arenden.json`.
 *
 * PROBLEM: `arenden.json` visar bara protokoll som gav upphov till minst
 * ett extraherbart ärende. Rena informationsmöten (t.ex. "§62 Information",
 * uttryckligen utanför scope per spec §1.4) lämnar inget spår alls —
 * varken i sajten eller i någon publicerad fil. Man kan alltså inte idag
 * se "här är ALLA möten en instans haft under en period", bara de möten
 * som råkade producera ett ärende.
 *
 * LÖSNING: fånga mötesmetadata (instans, datum, protokoll-URL) för VARJE
 * möte pipelinen besöker, oavsett utfall, och koppla ihop med vilka
 * ärende-id:n (om några) som kom ur just det mötet. Kräver ingen ny
 * AI-extraktion — datan (datum/instans/protokoll-URL) finns redan i
 * `MeetingWithProtocol` under pipeline-körningen (se fetch.ts), den
 * kasserades bara tidigare istället för att publiceras separat.
 */

export interface MotesPost {
  instance: string;
  date: string; // ÅÅÅÅ-MM-DD
  protocol_pdf_url: string;
  archive_url: string | null;
  arende_ids: string[];
}

/**
 * Bygger en enskild mötespost. `arendeIds` ska vara TOM array (inte null/
 * undefined) för rena informationsmöten — det är själva poängen: ett möte
 * utan ärenden är fortfarande ett riktigt möte, inte en avsaknad av data.
 */
export function buildMotesEntry(
  instance: string,
  date: string,
  protocolPdfUrl: string,
  arendeIds: string[]
): MotesPost {
  return {
    instance,
    date,
    protocol_pdf_url: protocolPdfUrl,
    archive_url: null,
    arende_ids: [...arendeIds].sort(),
  };
}

/**
 * Slår in en mötespost i ett befintligt index. Nyckel är (instance, date)
 * — samma instans+datum kan aldrig vara två olika möten. Om posten redan
 * finns (t.ex. en omkörning som hittar samma möte igen) ersätts den med
 * den nya versionen, så att uppdaterade arende_ids eller en nyss ifylld
 * archive_url inte går förlorade.
 */
export function upsertMotesIndex(existing: MotesPost[], entry: MotesPost): MotesPost[] {
  const key = (m: MotesPost) => `${m.instance}\u0000${m.date}`;
  const map = new Map(existing.map((m) => [key(m), m]));

  const prior = map.get(key(entry));
  const merged: MotesPost =
    prior && !entry.archive_url && prior.archive_url ? { ...entry, archive_url: prior.archive_url } : entry;

  map.set(key(entry), merged);
  return Array.from(map.values()).sort((a, b) =>
    a.instance === b.instance ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : a.instance.localeCompare(b.instance)
  );
}

/**
 * Kanoniserar mötesindexet inför publicering — samma stil som
 * publish.ts's canonicalize: sorterade objektnycklar, bevarad array-
 * ordning (redan kronologiskt sorterad av upsertMotesIndex).
 */
export function canonicalizeMoten(moten: MotesPost[]): unknown {
  function canon(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canon);
    if (value !== null && typeof value === "object") {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[k] = canon((value as Record<string, unknown>)[k]);
      }
      return sorted;
    }
    return value;
  }
  return canon(moten);
}
