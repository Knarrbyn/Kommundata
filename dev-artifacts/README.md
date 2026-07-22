# Utvecklingsartefakter — INTE en del av produktionsflödet

Den här katalogen innehåller kvarlevor från manuella smoke-tester och
skarpa engångskörningar som gjordes under utvecklingen (2026-07-20),
INNAN den riktiga GitHub Actions-pipelinen (`.github/workflows/weekly-pipeline.yml`
+ `scripts/run-weekly-pipeline.mjs`) fanns på plats. Sparad för spårbarhet
och som konkret bevis i `DECISION_LOG.md`, men rör INTE den skarpa
drift-datan i `data/published/`, `data/publish/` eller `dist/`.

## Innehåll

- `data/needs_review/`, `data/ready/`, `data/archived/` — mellansteg från
  ett manuellt kört smoke-test av gates → link → publish → build mot
  KF 2026-03-25, innan pipelinen automatiserades.
- `data/raw/manifest.json` + `data/raw/kommunfullmaktige/2026-03-25/protokoll.pdf` —
  **OBS: `protokoll.pdf` är i själva verket en textfil**, en kopia av
  `source-texts-live/protokoll-kf-2026-03-25.txt`, döpt om för att kunna
  användas som stand-in i `archive-cli.ts`s smoke-test (git-arkivets
  matchningslogik testades mot filnamnet/sökvägen, inte mot ett riktigt
  PDF-binärt innehåll). Förväxla den INTE med en riktig nedladdad PDF.
- `source-texts-live/protokoll-kf-2026-03-25.txt` — det riktiga,
  ordagrant hämtade protokollet för KF 2026-03-25 (via `web_fetch` mot
  den skarpa sajten, eftersom utvecklingssandboxens `bash`-nätverk var
  domänbegränsat). Detta ÄR äkta källdata, bara inte hämtad via
  pipelinens egen `fetch.ts`/`download.ts`-kod.
- `data/live/` — kandidatärenden från den skarpa extract-körningen
  (riktigt LLM A-anrop) mot ovanstående källtext.
- `run-live-extract.mjs` — engångsskriptet som gjorde den körningen.
  Användbart som mall om ni vill köra en enskild extraktion manuellt för
  felsökning, men ersätts av `scripts/run-weekly-pipeline.mjs` för skarp,
  schemalagd drift.

## Varför de 18 publicerade ärendena i produktion kommer härifrån

`data/published/arenden.json` (och därmed `dist/`, och den live sajten på
`faktagranskaren.netlify.app`) innehåller fortfarande just dessa 18
ärenden — de kommer från den ursprungliga manuella smoke-test-körningen,
inte från en riktig GitHub Actions-körning (som ännu inte hittat något
nytt att publicera). Se `DECISION_LOG.md`, posterna daterade 2026-07-20
och 2026-07-22, för hela resonemanget.
