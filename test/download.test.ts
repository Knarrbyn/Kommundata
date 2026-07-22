import { test } from "node:test";
import assert from "node:assert/strict";
import { extractAgendaBilagaLinks, localPathsFor, downloadMeetingFiles } from "../src/download.ts";
import type { MeetingWithProtocol } from "../src/fetch.ts";

// ---------------------------------------------------------------------
// Fixture: byggd på de FAKTISKA bilaga-länkarna från KF 2026-01-28 §9
// (interpellationssvaret som bevisade R9 — se FAKTAGRANSKAREN-SPEC.md).
// Det är exakt den typen av citat (interpellationens svarstext) som
// INTE finns i protokollets löptext och därför måste hämtas härifrån.
// ---------------------------------------------------------------------
const FIXTURE_MEETING_PAGE_HTML = `
<html><body>
<h2>Kallelse</h2>
<a href="https://sammantradesportal.alingsas.se/welcome-sv/namnder-styrelser/kommunfullmaktige/mote-2026-01-28/agenda/ss228-ks-revidering-av-foretagspolicy-for-alingsas-kommunkoncernpdf?downloadMode=open">§228 KS Revidering av företagspolicy.pdf</a>
<a href="https://sammantradesportal.alingsas.se/welcome-sv/namnder-styrelser/kommunfullmaktige/mote-2026-01-28/agenda/svar-pa-interpellation-till-vard-och-omsorgsnamndens-ordforande-gallande-arbetsmiljon-pa-forvaltningen-marcus-wallin-v-pdf-61201?downloadMode=open">Svar på interpellation.pdf</a>
<a href="https://sammantradesportal.alingsas.se/welcome-sv/namnder-styrelser/kommunfullmaktige/mote-2026-01-28/agenda/interpellation-till-vard-och-omsorgsnamndens-ordforande-gallande-arbetsmiljon-pa-forvaltningen-marcus-wallin-v-pdf-75630?downloadMode=open">Interpellation.pdf</a>
<!-- samma bilaga länkad två gånger (rubrik + nedladdningsknapp) -->
<a href="https://sammantradesportal.alingsas.se/welcome-sv/namnder-styrelser/kommunfullmaktige/mote-2026-01-28/agenda/ss228-ks-revidering-av-foretagspolicy-for-alingsas-kommunkoncernpdf?downloadMode=open">Ladda ner dokument</a>
<h2>Protokoll</h2>
<a href="https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-01-28/protocol/protokoll-kf-2026-01-28pdf?downloadMode=open">Öppna protokoll</a>
</body></html>
`;

test("extractAgendaBilagaLinks: hittar alla kallelsebilagor, inklusive interpellationssvaret", () => {
  const refs = extractAgendaBilagaLinks(FIXTURE_MEETING_PAGE_HTML);
  const filenames = refs.map((r) => r.filename);
  assert.ok(filenames.some((f) => f.includes("svar-pa-interpellation")), "interpellationssvaret ska hittas");
  assert.ok(filenames.some((f) => f.includes("interpellation-till-vard")), "själva interpellationsfrågan ska hittas");
  assert.ok(filenames.some((f) => f.includes("foretagspolicy")), "en vanlig ärendebilaga ska också hittas");
});

test("extractAgendaBilagaLinks: dedupear bilagor som länkas flera gånger på sidan", () => {
  const refs = extractAgendaBilagaLinks(FIXTURE_MEETING_PAGE_HTML);
  const foretagspolicyCount = refs.filter((r) => r.filename.includes("foretagspolicy")).length;
  assert.equal(foretagspolicyCount, 1, "företagspolicy-bilagan förekommer två gånger i fixturen men ska bara ge en träff");
});

test("extractAgendaBilagaLinks: fångar INTE protokoll-länken (fel URL-mönster, /committees/ inte /welcome-sv/)", () => {
  const refs = extractAgendaBilagaLinks(FIXTURE_MEETING_PAGE_HTML);
  assert.ok(!refs.some((r) => r.url.includes("/protocol/")), "protokollänken hör inte hemma bland kallelsebilagor");
});

test("extractAgendaBilagaLinks: tom lista om sidan saknar kallelsebilagor", () => {
  const refs = extractAgendaBilagaLinks("<html><body>Inga bilagor här.</body></html>");
  assert.deepEqual(refs, []);
});

test("extractAgendaBilagaLinks: hanterar bilaga-URL:er med numeriskt suffix mellan 'pdf' och querysträngen (LIVEFYND, KF 2026-06-10)", () => {
  // Verkligt exempel: .../tjansteskrivelse-inforande-av-allmanpolitiska-debatterpdf-19038?downloadMode=open
  // Ursprunglig regex trunkerade URL:en vid första "pdf" och tappade "-19038?downloadMode=open",
  // vilket skulle gett en trasig (404) nedladdningslänk i skarp drift. Upptäckt genom att
  // faktiskt hämta en live, aldrig tidigare sedd mötessida — inte genom fixture-gissning.
  const html = `<a href="https://sammantradesportal.alingsas.se/welcome-sv/namnder-styrelser/kommunfullmaktige/mote-2026-06-10/agenda/tjansteskrivelse-inforande-av-allmanpolitiska-debatterpdf-19038?downloadMode=open">Tjänsteskrivelse.pdf</a>`;
  const refs = extractAgendaBilagaLinks(html);
  assert.equal(refs.length, 1);
  assert.equal(
    refs[0].url,
    "https://sammantradesportal.alingsas.se/welcome-sv/namnder-styrelser/kommunfullmaktige/mote-2026-06-10/agenda/tjansteskrivelse-inforande-av-allmanpolitiska-debatterpdf-19038?downloadMode=open"
  );
  assert.equal(refs[0].filename, "tjansteskrivelse-inforande-av-allmanpolitiska-debatter-19038.pdf");
});

test("extractAgendaBilagaLinks: filnamn utan numeriskt suffix blir rent (inget dubbelt '.pdf.pdf')", () => {
  const html = `<a href="https://sammantradesportal.alingsas.se/welcome-sv/namnder-styrelser/kommunfullmaktige/mote-2026-06-10/agenda/ss77-ks-marknadsmassiga-rantepaslag-2027pdf?downloadMode=open">x</a>`;
  const refs = extractAgendaBilagaLinks(html);
  assert.equal(refs[0].filename, "ss77-ks-marknadsmassiga-rantepaslag-2027.pdf");
});

test("localPathsFor: bygger konsekvent mappstruktur per instans+datum", () => {
  const meeting: MeetingWithProtocol = {
    committeeSlug: "kommunfullmaktige",
    date: "2026-01-28",
    meetingUrl: "https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-01-28",
    protocolPdfUrl: "https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-01-28/protocol/protokoll-kf-2026-01-28pdf?downloadMode=open",
  };
  const paths = localPathsFor(meeting);
  assert.equal(paths.dir, "data/raw/kommunfullmaktige/2026-01-28");
  assert.equal(paths.protocolPath, "data/raw/kommunfullmaktige/2026-01-28/protokoll.pdf");
  assert.equal(paths.bilagaDir, "data/raw/kommunfullmaktige/2026-01-28/bilagor");
});

test("downloadMeetingFiles: laddar ner protokoll + samtliga bilagor, skriver till rätt sökvägar", async () => {
  const meeting: MeetingWithProtocol = {
    committeeSlug: "kommunfullmaktige",
    date: "2026-01-28",
    meetingUrl: "https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-01-28",
    protocolPdfUrl:
      "https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-01-28/protocol/protokoll-kf-2026-01-28pdf?downloadMode=open",
  };

  const written: Record<string, Uint8Array> = {};
  const ensuredDirs = new Set<string>();
  const fetchedUrls: string[] = [];

  const deps = {
    fetchBinary: async (url: string) => {
      fetchedUrls.push(url);
      return new TextEncoder().encode(`FAKE-PDF-BYTES:${url}`);
    },
    ensureDir: async (path: string) => {
      ensuredDirs.add(path);
    },
    writeFile: async (path: string, data: Uint8Array) => {
      written[path] = data;
    },
  };

  const result = await downloadMeetingFiles(meeting, FIXTURE_MEETING_PAGE_HTML, deps);

  // Protokollet hämtat och skrivet
  assert.ok(written["data/raw/kommunfullmaktige/2026-01-28/protokoll.pdf"]);
  // Tre unika bilagor hämtade (företagspolicy, interpellationssvar, interpellation)
  assert.equal(result.bilagaPaths.length, 3);
  // Alla bilagor faktiskt skrivna till disk under bilagor/-mappen
  for (const p of result.bilagaPaths) {
    assert.ok(p.startsWith("data/raw/kommunfullmaktige/2026-01-28/bilagor/"));
    assert.ok(written[p], `${p} borde ha skrivits`);
  }
  // Mapparna säkerställdes innan skrivning
  assert.ok(ensuredDirs.has("data/raw/kommunfullmaktige/2026-01-28"));
  assert.ok(ensuredDirs.has("data/raw/kommunfullmaktige/2026-01-28/bilagor"));
  // Totalt 4 nätverksanrop (1 protokoll + 3 bilagor), inte fler (bevisar dedupe funkade)
  assert.equal(fetchedUrls.length, 4);
});
