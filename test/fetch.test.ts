import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractMeetingRefs,
  extractProtocolPdfUrl,
  diffNewMeetings,
  fetchNewMeetingsForCommittee,
  markSeen,
} from "../src/fetch.ts";
import { COMMITTEES } from "../src/config.ts";

// ---------------------------------------------------------------------
// Fixture: en förenklad men URL-strukturellt TROGEN kopia av vad
// /committees/kommunfullmaktige faktiskt innehöll, byggd på de riktiga
// länkarna vi hämtade under research-arbetet (se README.md, "Verifierat
// mot verkliga data"). Detta är INTE en gissning på DOM-struktur — bara
// på att länkarna med dessa exakta hrefs förekommer någonstans i svaret.
// ---------------------------------------------------------------------
const FIXTURE_COMMITTEE_LIST_HTML = `
<html><body>
<nav>
  <ul>
    <li><a href="https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-06-10">2026-06-10</a></li>
    <li><a href="https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-05-06">2026-05-06</a></li>
    <li><a href="https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-03-25">2026-03-25</a></li>
    <li><a href="https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-02-25">2026-02-25</a></li>
    <li><a href="https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-01-28">2026-01-28</a></li>
  </ul>
</nav>
<!-- decoy: en länk till en ANNAN instans ska INTE matchas när vi frågar efter kommunfullmaktige -->
<a href="https://sammantradesportal.alingsas.se/committees/kommunstyrelsen/mote-2026-02-25">KS samma datum</a>
<!-- decoy: dubblett av samma möte, förekommer ofta två gånger (nav + huvudlista) -->
<a href="https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-02-25">Möte 2026-02-25</a>
</body></html>
`;

const FIXTURE_MEETING_PAGE_WITH_PROTOCOL_HTML = `
<html><body>
<a href="https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-02-25/agenda/kallelse-kf-2026-02-25pdf?downloadMode=open">Öppna kallelse</a>
<a href="https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-02-25/protocol/protokoll-kf-2026-02-25pdf?downloadMode=open">Öppna protokoll</a>
</body></html>
`;

// Ett möte som HÅLLITS men INTE justerats än (finns kallelse, inget protokoll) —
// bekräftat verkligt fall: många framtida/nyliga möten i sammanträdesportalen
// visar bara "Kallelse"-fliken tills protokollet är signerat (spec §2.1).
const FIXTURE_MEETING_PAGE_NO_PROTOCOL_YET_HTML = `
<html><body>
<a href="https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-09-02/agenda/kallelse-kf-2026-09-02pdf?downloadMode=open">Öppna kallelse</a>
<p>Det finns ingen information att visa</p>
</body></html>
`;

// Filnamnsmönstret varierar mellan instanser — nämnder använder ofta
// "protokoll-skapad-{slug}-{skapad-datum}-{tid}pdf" istället för
// "protokoll-{slug}-{mötesdatum}pdf". Bekräftat i VON-protokollet.
const FIXTURE_MEETING_PAGE_ALT_FILENAME_HTML = `
<html><body>
<a href="https://sammantradesportal.alingsas.se/committees/vard-och-omsorgsnamnden/mote-2026-02-18/protocol/protokoll-skapad-von-2026-02-20-092808pdf?downloadMode=open">Öppna protokoll</a>
</body></html>
`;

test("extractMeetingRefs: hittar möten för rätt instans, ignorerar andra instanser", () => {
  const refs = extractMeetingRefs("kommunfullmaktige", FIXTURE_COMMITTEE_LIST_HTML);
  const dates = refs.map((r) => r.date);
  assert.deepEqual(dates, ["2026-06-10", "2026-05-06", "2026-03-25", "2026-02-25", "2026-01-28"]);
  // kommunstyrelsen-länken (decoy) ska INTE dyka upp
  assert.ok(!refs.some((r) => r.committeeSlug !== "kommunfullmaktige"));
});

test("extractMeetingRefs: dedupear samma möte som förekommer flera gånger på sidan", () => {
  const refs = extractMeetingRefs("kommunfullmaktige", FIXTURE_COMMITTEE_LIST_HTML);
  const feb25Count = refs.filter((r) => r.date === "2026-02-25").length;
  assert.equal(feb25Count, 1, "2026-02-25 förekommer två gånger i fixturen men ska bara ge en träff");
});

test("extractMeetingRefs: tom lista om instansen inte finns i html", () => {
  const refs = extractMeetingRefs("overformyndarnamnden", FIXTURE_COMMITTEE_LIST_HTML);
  assert.deepEqual(refs, []);
});

test("extractProtocolPdfUrl: hittar protokoll-länk när protokollet är justerat", () => {
  const url = extractProtocolPdfUrl("kommunfullmaktige", "2026-02-25", FIXTURE_MEETING_PAGE_WITH_PROTOCOL_HTML);
  assert.equal(
    url,
    "https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-02-25/protocol/protokoll-kf-2026-02-25pdf?downloadMode=open"
  );
});

test("extractProtocolPdfUrl: LIVEFYND — 'Öppna protokoll'-länken är javascript:void(0) när protokollet inte är justerat än (KF 2026-06-10)", () => {
  // Verklig, aldrig tidigare sedd mötessida (2026-06-10) visade att när protokollet
  // inte är publicerat blir länken bokstavligen "javascript:void(0);", inte frånvarande.
  // Bekräftar att extractProtocolPdfUrl korrekt returnerar null i detta verkliga fall.
  const html = `
    - [Öppna protokoll](javascript:void(0);)
    - [Ladda ner allt](javascript:void(0);)
    ## Det finns ingen information att visa
    Inget protokoll har publicerats
  `;
  const url = extractProtocolPdfUrl("kommunfullmaktige", "2026-06-10", html);
  assert.equal(url, null);
});

test("extractProtocolPdfUrl: returnerar null om protokollet inte är justerat än (bara kallelse finns)", () => {
  const url = extractProtocolPdfUrl("kommunfullmaktige", "2026-09-02", FIXTURE_MEETING_PAGE_NO_PROTOCOL_YET_HTML);
  assert.equal(url, null);
});

test("extractProtocolPdfUrl: hanterar det alternativa 'protokoll-skapad-...'-filnamnsmönstret", () => {
  const url = extractProtocolPdfUrl(
    "vard-och-omsorgsnamnden",
    "2026-02-18",
    FIXTURE_MEETING_PAGE_ALT_FILENAME_HTML
  );
  assert.equal(
    url,
    "https://sammantradesportal.alingsas.se/committees/vard-och-omsorgsnamnden/mote-2026-02-18/protocol/protokoll-skapad-von-2026-02-20-092808pdf?downloadMode=open"
  );
});

test("diffNewMeetings: filtrerar bort möten som redan finns i seen.json", () => {
  const refs = extractMeetingRefs("kommunfullmaktige", FIXTURE_COMMITTEE_LIST_HTML);
  const seen = { kommunfullmaktige: ["2026-02-25", "2026-01-28"] };
  const fresh = diffNewMeetings(refs, seen);
  const dates = fresh.map((r) => r.date).sort();
  assert.deepEqual(dates, ["2026-03-25", "2026-05-06", "2026-06-10"]);
});

test("diffNewMeetings: seen.json utan instansen alls → alla möten är nya", () => {
  const refs = extractMeetingRefs("kommunfullmaktige", FIXTURE_COMMITTEE_LIST_HTML);
  const fresh = diffNewMeetings(refs, {});
  assert.equal(fresh.length, 5);
});

test("markSeen: lägger till datum, dedupear, håller sorterat", () => {
  let seen: Record<string, string[]> = {};
  seen = markSeen(seen, "kommunfullmaktige", "2026-02-25");
  seen = markSeen(seen, "kommunfullmaktige", "2026-01-28");
  seen = markSeen(seen, "kommunfullmaktige", "2026-02-25"); // dubblett, ska inte ge dubblett i listan
  assert.deepEqual(seen.kommunfullmaktige, ["2026-01-28", "2026-02-25"]);
});

test("fetchNewMeetingsForCommittee: full integrationstest med mockad fetchText, ingen nätverksåtkomst", async () => {
  const committee = COMMITTEES.find((c) => c.slug === "kommunfullmaktige")!;
  const seen = { kommunfullmaktige: ["2026-05-06", "2026-03-25", "2026-01-28"] };

  const pages: Record<string, string> = {
    "https://sammantradesportal.alingsas.se/committees/kommunfullmaktige": FIXTURE_COMMITTEE_LIST_HTML,
    "https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-06-10":
      FIXTURE_MEETING_PAGE_NO_PROTOCOL_YET_HTML.replace(/2026-09-02/g, "2026-06-10"),
    "https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-02-25":
      FIXTURE_MEETING_PAGE_WITH_PROTOCOL_HTML,
  };

  const fetchText = async (url: string) => {
    if (!(url in pages)) throw new Error(`Oväntad URL i test: ${url}`);
    return pages[url];
  };

  const result = await fetchNewMeetingsForCommittee(committee, seen, fetchText);

  // Två möten är "nya" enligt seen.json: 2026-06-10 och 2026-02-25.
  // Men 2026-06-10 saknar justerat protokoll än → ska INTE komma med i resultatet.
  // 2026-02-25 har protokoll → ska komma med.
  assert.equal(result.length, 1);
  assert.equal(result[0].date, "2026-02-25");
  assert.equal(
    result[0].protocolPdfUrl,
    "https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-02-25/protocol/protokoll-kf-2026-02-25pdf?downloadMode=open"
  );
});

/* ============ seedMeetingUrl-fallback (kritiskt fynd 2026-07-22, se DECISION_LOG.md) ============ */

test("extractMeetingRefs: hittar möten även med RELATIVA länkar (utan domän-prefix) — kritiskt fynd 2026-07-22, se DECISION_LOG.md", () => {
  const html = `
<html><body>
<a href="/committees/kommunfullmaktige/mote-2026-06-10">2026-06-10</a>
<a href="/committees/kommunfullmaktige/mote-2026-05-06">2026-05-06</a>
</body></html>`;
  const refs = extractMeetingRefs("kommunfullmaktige", html);
  assert.equal(refs.length, 2);
  assert.deepEqual(
    refs.map((r) => r.date).sort(),
    ["2026-05-06", "2026-06-10"]
  );
  // meetingUrl ska alltid vara ABSOLUT i resultatet, oavsett källformat.
  assert.ok(refs[0].meetingUrl.startsWith("https://sammantradesportal.alingsas.se/"));
});

test("extractProtocolPdfUrl: hittar och absolutiserar en RELATIV protokollänk", () => {
  const html = `<a href="/committees/kommunfullmaktige/mote-2026-02-25/protocol/protokoll-kf-2026-02-25pdf?downloadMode=open">Öppna protokoll</a>`;
  const url = extractProtocolPdfUrl("kommunfullmaktige", "2026-02-25", html);
  assert.equal(
    url,
    "https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-02-25/protocol/protokoll-kf-2026-02-25pdf?downloadMode=open"
  );
});

test("fetchNewMeetingsForCommittee: faller tillbaka på seedMeetingUrl om listsidan ger noll mötalänkar", async () => {
  const committee = {
    slug: "test-instans",
    name: "Testinstans",
    confirmed: true,
    seedMeetingUrl: "https://sammantradesportal.alingsas.se/committees/test-instans/mote-2026-02-25",
  };
  const seen: Record<string, string[]> = {};

  const seedPageHtml = `
<html><body>
<a href="https://sammantradesportal.alingsas.se/committees/test-instans/mote-2026-02-25">2026-02-25</a>
</body></html>`;

  const pages: Record<string, string> = {
    // Listsidan ger medvetet TOM html (simulerar det bekräftade fyndet).
    "https://sammantradesportal.alingsas.se/committees/test-instans": "<html><body>Ingen mötalänk här</body></html>",
    // Seed-sidan har (precis som en riktig mötessida) en mötalänk i sin
    // sidmeny — här bara en, för att hålla testet enkelt.
    "https://sammantradesportal.alingsas.se/committees/test-instans/mote-2026-02-25":
      FIXTURE_MEETING_PAGE_WITH_PROTOCOL_HTML.replace(/kommunfullmaktige/g, "test-instans") + seedPageHtml,
  };
  const fetchText = async (url: string) => {
    if (!(url in pages)) throw new Error(`Oväntad URL i test: ${url}`);
    return pages[url];
  };

  const result = await fetchNewMeetingsForCommittee(committee, seen, fetchText);
  assert.equal(result.length, 1, "ska hitta mötet via seed-sidan trots att listsidan var tom");
  assert.equal(result[0].date, "2026-02-25");
});

test("fetchNewMeetingsForCommittee: kastar ett TYDLIGT fel (inte tyst '0 nya möten') om listsidan är tom OCH inget seedMeetingUrl finns", async () => {
  const committee = { slug: "test-instans-utan-fro", name: "Testinstans utan frö", confirmed: true };
  const seen: Record<string, string[]> = {};
  const fetchText = async () => "<html><body>Ingen mötalänk här</body></html>";

  await assert.rejects(
    () => fetchNewMeetingsForCommittee(committee, seen, fetchText),
    /seedMeetingUrl/,
    "felmeddelandet ska förklara att seedMeetingUrl saknas, inte bara ge ett generiskt fel"
  );
});
