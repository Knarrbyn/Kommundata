import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthHeader,
  buildSubmitBody,
  parseSubmitResponse,
  parseStatusResponse,
  archiveUrl,
  computeFileHash,
  buildPendingGitArchiveMarker,
  isPendingGitArchiveMarker,
  buildGitArchiveUrl,
  archiveArendenWithGit,
  type ArchiveDeps,
} from "../src/archive.ts";
import type { CandidateArende } from "../src/extract.ts";

test("buildAuthHeader: formaterar 'LOW access:secret' enligt SPN2:s dokumenterade format", () => {
  assert.equal(buildAuthHeader("ACCESSKEY123", "SECRETKEY456"), "LOW ACCESSKEY123:SECRETKEY456");
});

test("buildSubmitBody: url-encodar käll-URL:en och sätter capture_all=1", () => {
  const body = buildSubmitBody("https://sammantradesportal.alingsas.se/committees/kommunfullmaktige/mote-2026-02-25/protocol/protokoll-kf-2026-02-25pdf?downloadMode=open");
  assert.ok(body.includes("capture_all=1"));
  assert.ok(body.includes("url=https%3A%2F%2Fsammantradesportal"));
});

/* ============ parseSubmitResponse ============ */

test("parseSubmitResponse: lyckad inlämning ger job_id", () => {
  const raw = JSON.stringify({ url: "https://example.com/protokoll.pdf", job_id: "spn2-abc123" });
  const result = parseSubmitResponse(raw);
  assert.equal(result.jobId, "spn2-abc123");
  assert.equal(result.error, null);
});

test("parseSubmitResponse: felmeddelande från API:et fångas som error, inte krasch", () => {
  const raw = JSON.stringify({ message: "You have already reached the limit of active sessions" });
  const result = parseSubmitResponse(raw);
  assert.equal(result.jobId, null);
  assert.match(result.error!, /limit of active sessions/);
});

test("parseSubmitResponse: okänd svarsstruktur ger tydligt fel, kraschar inte", () => {
  const result = parseSubmitResponse(JSON.stringify({ something: "unexpected" }));
  assert.equal(result.jobId, null);
  assert.ok(result.error);
});

test("parseSubmitResponse: ogiltig JSON hanteras defensivt", () => {
  const result = parseSubmitResponse("<html>Rate limited</html>");
  assert.equal(result.jobId, null);
  assert.match(result.error!, /Ogiltig JSON/);
});

/* ============ parseStatusResponse ============ */

test("parseStatusResponse: success bygger arkiv-URL av timestamp + original_url enligt Wayback-mönstret", () => {
  const raw = JSON.stringify({
    status: "success",
    job_id: "spn2-abc123",
    original_url: "https://sammantradesportal.alingsas.se/.../protokoll-kf-2026-02-25pdf",
    timestamp: "20260225210000",
  });
  const result = parseStatusResponse(raw);
  assert.equal(result.status, "success");
  assert.equal(
    result.archivedUrl,
    "https://web.archive.org/web/20260225210000/https://sammantradesportal.alingsas.se/.../protokoll-kf-2026-02-25pdf"
  );
});

test("parseStatusResponse: pending returneras som pending, ingen arkiv-URL än", () => {
  const raw = JSON.stringify({ status: "pending", job_id: "spn2-abc123" });
  const result = parseStatusResponse(raw);
  assert.equal(result.status, "pending");
  assert.equal(result.archivedUrl, null);
});

test("parseStatusResponse: error-status ger errorMessage, kraschar inte", () => {
  const raw = JSON.stringify({ status: "error", message: "Could not resolve host" });
  const result = parseStatusResponse(raw);
  assert.equal(result.status, "error");
  assert.match(result.errorMessage!, /Could not resolve host/);
});

test("parseStatusResponse: success utan timestamp/original_url ger fel istället för trasig URL", () => {
  const raw = JSON.stringify({ status: "success", job_id: "x" });
  const result = parseStatusResponse(raw);
  assert.equal(result.status, "error");
  assert.equal(result.archivedUrl, null);
});

/* ============ archiveUrl: full orkestrering med mockade dependencies ============ */

test("archiveUrl: lyckad arkivering efter en pending-pollning, ingen riktig nätverksväntan i testet", async () => {
  let statusCallCount = 0;
  const deps: ArchiveDeps = {
    fetchText: async (url) => {
      if (url.includes("/save/status/")) {
        statusCallCount++;
        if (statusCallCount === 1) {
          return JSON.stringify({ status: "pending", job_id: "spn2-xyz" });
        }
        return JSON.stringify({
          status: "success",
          original_url: "https://example.com/protokoll.pdf",
          timestamp: "20260101120000",
        });
      }
      // submit-anropet
      return JSON.stringify({ url: "https://example.com/protokoll.pdf", job_id: "spn2-xyz" });
    },
    sleep: async () => {}, // ingen riktig väntan i testet
  };

  const result = await archiveUrl("https://example.com/protokoll.pdf", "AK", "SK", deps);
  assert.equal(result.archivedUrl, "https://web.archive.org/web/20260101120000/https://example.com/protokoll.pdf");
  assert.equal(result.error, null);
  assert.equal(statusCallCount, 2, "ska ha pollat två gånger: en pending, en success");
});

test("archiveUrl: ger upp och rapporterar fel om det aldrig blir klart inom maxAttempts", async () => {
  const deps: ArchiveDeps = {
    fetchText: async (url) => {
      if (url.includes("/save/status/")) {
        return JSON.stringify({ status: "pending", job_id: "spn2-xyz" });
      }
      return JSON.stringify({ url: "https://example.com/x.pdf", job_id: "spn2-xyz" });
    },
    sleep: async () => {},
  };

  const result = await archiveUrl("https://example.com/x.pdf", "AK", "SK", deps, 3, 0);
  assert.equal(result.archivedUrl, null);
  assert.match(result.error!, /Gav upp efter 3 pollningsförsök/);
});

test("archiveUrl: misslyckad submit avbryter direkt, pollar aldrig status", async () => {
  let statusCalled = false;
  const deps: ArchiveDeps = {
    fetchText: async (url) => {
      if (url.includes("/save/status/")) {
        statusCalled = true;
        return JSON.stringify({ status: "pending" });
      }
      return JSON.stringify({ message: "Session limit exceeded" });
    },
    sleep: async () => {},
  };

  const result = await archiveUrl("https://example.com/x.pdf", "AK", "SK", deps);
  assert.equal(result.archivedUrl, null);
  assert.match(result.error!, /Session limit exceeded/);
  assert.equal(statusCalled, false, "ska inte polla status om submit redan misslyckades");
});

/* ============ Git-primärt arkiv (2026-07-20, se DECISION_LOG.md) ============ */

test("computeFileHash: deterministisk SHA-256, samma innehåll ger samma hash", () => {
  const bytes = new TextEncoder().encode("innehållet i en pdf, förenklat till text för testet");
  const h1 = computeFileHash(bytes);
  const h2 = computeFileHash(bytes);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("computeFileHash: olika innehåll ger olika hash", () => {
  const a = computeFileHash(new TextEncoder().encode("A"));
  const b = computeFileHash(new TextEncoder().encode("B"));
  assert.notEqual(a, b);
});

test("buildPendingGitArchiveMarker / isPendingGitArchiveMarker: rund-trip och igenkänning", () => {
  const marker = buildPendingGitArchiveMarker("data/raw/kommunfullmaktige/2026-03-25/protokoll.pdf");
  assert.equal(marker, "git-pending:data/raw/kommunfullmaktige/2026-03-25/protokoll.pdf");
  assert.equal(isPendingGitArchiveMarker(marker), true);
  assert.equal(isPendingGitArchiveMarker("https://github.com/x/y/blob/abc123/data/raw/foo.pdf"), false);
  assert.equal(isPendingGitArchiveMarker(null), false);
  assert.equal(isPendingGitArchiveMarker(undefined), false);
});

test("buildGitArchiveUrl: bygger en commit-pinnad GitHub-permalänk", () => {
  const url = buildGitArchiveUrl(
    { githubRepo: "mjorninstitutet/faktagranskaren", relativePath: "data/raw/kommunfullmaktige/2026-03-25/protokoll.pdf" },
    "abc123def456"
  );
  assert.equal(
    url,
    "https://github.com/mjorninstitutet/faktagranskaren/blob/abc123def456/data/raw/kommunfullmaktige/2026-03-25/protokoll.pdf"
  );
});

function makeMinimalArende(pdfUrl: string): CandidateArende {
  return {
    title: "Test",
    initiativ_typ: "styrelseforslag",
    initiators: [],
    category: "övrigt",
    status: "avgjort",
    diarienummer: null,
    steps: [
      {
        step_id: "s1",
        instance: "kommunfullmaktige",
        type: "beslut",
        date: "2026-03-25",
        quote: "x",
        source: { protocol_ref: "§1 KF 2026-03-25", pdf_url: pdfUrl } as unknown as { protocol_ref: string },
      },
    ],
  };
}

test("archiveArendenWithGit: sätter PENDING-markör på steg vars pdf_url matchar en känd rå-fil", () => {
  const arende = makeMinimalArende("https://sammantradesportal.alingsas.se/.../protokoll.pdf");
  const bytes = new TextEncoder().encode("fejk-pdf-innehåll");
  const { arenden, fileHashes } = archiveArendenWithGit([arende], [
    { pdfUrl: "https://sammantradesportal.alingsas.se/.../protokoll.pdf", relativePath: "data/raw/kommunfullmaktige/2026-03-25/protokoll.pdf", bytes },
  ]);

  const source = arenden[0].steps[0].source as { archive_url?: string };
  assert.equal(source.archive_url, "git-pending:data/raw/kommunfullmaktige/2026-03-25/protokoll.pdf");
  assert.equal(fileHashes["data/raw/kommunfullmaktige/2026-03-25/protokoll.pdf"], computeFileHash(bytes));
});

test("archiveArendenWithGit: steg vars pdf_url INTE matchar någon känd rå-fil lämnas orörda (hellre ingen länk än fel länk)", () => {
  const arende = makeMinimalArende("https://sammantradesportal.alingsas.se/okand-url.pdf");
  const { arenden } = archiveArendenWithGit([arende], [
    { pdfUrl: "https://sammantradesportal.alingsas.se/annan-url.pdf", relativePath: "data/raw/x/protokoll.pdf", bytes: new Uint8Array() },
  ]);

  const source = arenden[0].steps[0].source as { archive_url?: string };
  assert.equal(source.archive_url, undefined);
});
