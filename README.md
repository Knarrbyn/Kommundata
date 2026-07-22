# Faktagranskaren — pipeline

Implementerar spec §5, ALLA nio steg: **fetch → download → extract →
gates → verify → archive → link → publish → build**. Hela kedjan är byggd.

Node 22 LTS, TypeScript utan build-steg (`--experimental-strip-types`), inga
egna produktionsberoenden utöver `pdf-parse`.

## Snabbstart

```bash
npm install
npm test          # 110 tester, körs helt offline, inget nätverk eller nyckel krävs
                   # (räkna alltid själv med npm test — se DECISION_LOG.md,
                   # detta talet i prosa har varit fel förut)
```

## Vad varje steg gör, och vad som faktiskt är verifierat

| Steg | Fil | Kräver skarpt | Status |
|---|---|---|---|
| fetch | `src/fetch.ts` | nätverk (sajten) | Kört mot skarp, aktuell data (se nedan) |
| download | `src/download.ts` | nätverk (sajten) | Kört mot skarp, aktuell data — en bugg hittad och fixad |
| extract | `src/extract.ts` | nätverk + `ANTHROPIC_API_KEY` | PDF-extraktion + LLM-anropet BÅDA skarpt testade (se nedan); en bugg i gates hittad och fixad som resultat |
| gates | `src/gates.ts` | inget — helt offline | Fullt testat, inkl. ett R2-fynd från testriggen OCH ett från det skarpa LLM-testet |
| verify | `src/verify.ts` | nätverk + en andra LLM-nyckel | Byggd, otestad; öppen fråga om modellfamilj |
| archive | `src/archive.ts` | nätverk + archive.org-konto | Byggd enbart mot dokumentation, helt otestad |
| link | `src/link.ts` | inget — helt offline | Fullt testat mot de riktiga R7-Beslutsunderlag-texterna. En falsk-positiv-bugg för flerärende-protokoll hittad via smoke-test och fixad 2026-07-20 (se DECISION_LOG.md) |
| publish | `src/publish.ts` | inget — helt offline | Fullt testat (determinism, hash, changelog) |
| build | `src/build.ts` | inget — helt offline | Fullt testat mot den RIKTIGA `templates/site.html`, inkl. full end-to-end-körning |

**Genomgående begränsning:** den här sandboxen når varken
`sammantradesportal.alingsas.se`, `web.archive.org`, eller har någon
API-nyckel. `web_fetch`-verktyget (tillgängligt för mig i konversationen,
inte för pipelinens egen kod) kunde nå sajten och gav två konkreta resultat
— se "Liveresultat" nedan.

---

## Liveresultat (2026-07-20)

- **`extractMeetingRefs`** kört mot en genuint aktuell startsida — hittade
  korrekt alla 8 kommunfullmäktige-möten, uteslöt andra instanser rätt.
- **`extractProtocolPdfUrl`** kört mot ett mötesdatum (2026-06-10) vars
  protokoll inte är publicerat än — bekräftade att länken i det läget
  bokstavligen är `javascript:void(0);`, och att funktionen korrekt
  returnerar `null`.
- **`extractAgendaBilagaLinks`** kört mot samma mötes fullständiga
  kallelselista (15 ärendepunkter, ~50 bilagor) — **hittade en riktig
  bugg**: vissa bilaga-URL:er har ett numeriskt suffix mellan filnamnet och
  frågetecknet (`...debatterpdf-19038?downloadMode=open`), vilket den
  ursprungliga regexen trunkerade. Skulle gett en trasig (404) nedladdnings-
  länk i skarp drift. **Fixat**, med nya tester som fångar exakt fallet.
- **`extractPdfText`** (pdf-parse) INTE verifierat mot en riktig kommun-PDF.
  `web_fetch` returnerar alltid förkonverterad text, även med
  `web_fetch_pdf_extract_text: false` — går inte att hämta rådata därifrån.
  Koden är bevisat fungerande mot en handbyggd giltig PDF, men om Alingsås
  PDF:er t.ex. är skannade bilder utan textlager vet vi inte förrän du kör
  `download` + testar `extractPdfText` mot en riktigt nedladdad fil.
- **LLM-anropen (extract och verify)** helt otestade — ingen API-nyckel
  tillgänglig i den här sessionen.

---

## Skarpt LLM-test (2026-07-20) — extract-steget kört mot riktig modell

Du gav mig en Anthropic-nyckel och jag körde ett fullständigt skarpt test:
byggde den riktiga extract-prompten mot ett äkta utdrag ur KF-protokollet
2026-02-25 (§32, §33 informationspunkter + §42 Plantaxa + §44 fritidsbank +
§45 vattenlek + §47 Bidragsportalen — sex ärenden/icke-ärenden, en
representativ blandning), anropade `claude-sonnet-4-6` på riktigt, och körde
sedan svaret genom vår FAKTISKA `gates`-modul (inte en simulering).

**Vad som gick bra:**
- Giltig, schema-korrekt JSON på första försöket.
- §32/§33 (rena informationspunkter utan beslut) korrekt UTESLUTNA — precis
  som G6/prompten kräver.
- Plantaxa korrekt klassificerad `styrelseforslag`, tom `initiators`-array.
- Bidragsportalen korrekt `status: "pågående"`, inga påhittade framtida steg.
- **Det viktigaste enskilda testet:** vattenlek-ärendets 43-ords citat ur
  Tekniska nämndens yttrande — exakt samma citat som bevisade R2-fyndet i
  testriggen — extraherades ORDAGRANT av modellen och klarade gates tack
  vare den differentierade 60-ordsgränsen för `namndyttrande`. Hela R2-
  kedjan (fynd → speclösning → implementation → skarpt LLM-test) är nu
  bevisad end-to-end, inte bara testad mot konstruerade exempel.

**Två verkliga fynd, båda åtgärdade:**
1. **En riktig bugg i `gates.ts`, inte bara en prompt-brist.** Fritidsbank-
   ärendets protokollsanteckning (en redan verifierat äkta 54-ords text från
   testriggens `case-44`) extraherades korrekt av modellen men UNDERKÄNDES
   av vår gates-modul, eftersom R2:s ordgräns felaktigt tillämpades även på
   reservationer/protokollsanteckningar — fria politiska uttalanden utan
   någon sådan gräns i specen. **Fixat:** ordgränsen gäller nu bara
   huvudcitatet som styrker `decision`. Substräng-kontrollen (att citatet
   verkligen finns i källan) gäller fortfarande fullt ut för alla fält.
2. **Två prompt-/robusthetsfynd, mindre allvarliga:** modellen skrev ibland
   en egen sammanfattning i `voting.note` istället för R3:s föreskrivna
   fasta text, och valde "ingen rekommendation" istället för "delvis" för
   ett nämndyttrande som tog olika ställning till olika att-satser. Löst
   på två nivåer: skärpt prompt OCH (viktigare) `parseExtractionResponse`
   tvingar nu fram den korrekta `voting.note`-texten programmatiskt när
   `recorded: false`, oavsett vad modellen faktiskt skrev — bygger inte
   på att modellen lyder prompten perfekt varje gång.

**Efter båda fixarna:** samma skarpa LLM-output går nu genom gates helt
utan anmärkning, alla fyra ärenden godkända.

**Kostnad för testet:** ~3 150 input-tokens, ~3 380 output-tokens — någon
enstaka cent med `claude-sonnet-4-6`-priser.



### 1. Modellfamiljs-oberoende (verify-steget)
Spec (§2, §5) kräver att LLM B (verify) ska vara en ANNAN modellfamilj än
LLM A (extract). Den här miljön har bara haft tillgång till en leverantör.
`verify-cli.ts` är byggd leverantörsagnostiskt (`VERIFY_API_URL`/
`VERIFY_MODEL`/`VERIFY_API_KEY` som miljövariabler) men är inte testad mot
en verkligt annan modellfamilj. Antingen skaffa en nyckel till en annan
leverantör (justera `callVerifyLLM`:s request-format om API-formatet
skiljer sig från Anthropics), eller acceptera avvikelsen och logga den i
`DECISION_LOG.md` (spec §0, punkt 4 kräver att avvikelser loggas).

### 2. Archive.org-konto (archive-steget)
Den enkla, oautentiserade `web.archive.org/save/<url>`-genvägen rapporteras
vara opålitlig av flera oberoende källor (GitHub-diskussioner 2020–2022).
Det korrekta sättet, SPN2, kräver ett gratis konto med S3-liknande
API-nycklar från https://archive.org/account/s3.php. `archive.ts` är byggd
mot SPN2:s dokumenterade format men helt otestad mot ett riktigt svar.

### 3. `samhallsbyggnadsnamnden` i `src/config.ts`
Markerad `confirmed: false`. Aldrig faktiskt bekräftad som egen nämnd under
research-arbetet — verifiera mot `/committees` innan den aktiveras skarpt.

### 4. Skannade PDF:er
Om Alingsås använder skannade (bildbaserade) protokoll för vissa
instanser/år ger `pdf-parse` tom eller oanvändbar text — då krävs OCR som
ett extra steg före extract. Inte undersökt.

### 5. `extract.ts` fångar inte Beslutsunderlag-listor — link.ts läser källtexten direkt istället
Upptäcktes när `link.ts` byggdes: R7:s matchningsstrategi (paragraf-
korsreferens) behöver `Beslutsunderlag`-listorna, men `CandidateArende`-
schemat i extract.ts har inget fält för dem. Löst genom att `link.ts`
tar emot RÅ källtext som en separat parameter och letar paragraf-
referenser däri, istället för att förlita sig på ett strukturerat fält.
Fungerar (se `link.test.ts`), men är en omväg. En renare lösning: lägg
till `beslutsunderlag_refs: string[]` i extract-prompten/schemat så
extract-steget fångar det direkt — kräver att extract.ts:s prompt och
tester uppdateras, medvetet inte gjort nu för att undvika att röra ett
redan testat steg mitt i pipelinebygget.

---

## GitHub Actions-schemaläggning (2026-07-20)

`.github/workflows/weekly-pipeline.yml` kör `scripts/run-weekly-pipeline.mjs`
varje måndag (`cron: "0 6 * * 1"`), plus manuellt via `workflow_dispatch`.
Secrets att sätta i repots Settings → Secrets:

| Secret | Krävs | Vad händer om den saknas |
|---|---|---|
| `ANTHROPIC_API_KEY` | Ja | Workflowen avbryter direkt — extract kräver den |
| `VERIFY_API_KEY` | Nej | Verify-steget hoppas över helt, tydligt loggat. Se DECISION_LOG.md |
| `VERIFY_API_URL` / `VERIFY_MODEL` | Nej | Default: samma Anthropic-endpoint som extract (känd begränsning) |
| `ARCHIVE_ACCESS_KEY` / `ARCHIVE_SECRET_KEY` | Nej | Wayback (sekundärt, frivilligt arkiv) hoppas över — git-arkivet är alltid primärt |

**Verifierat i sandboxen:** import/modulladdning, felisolering per instans,
och rent avslut vid "inget nytt". **INTE verifierat:** en fullständig
körning mot riktiga möten i CI (kräver nätverksåtkomst dit sandboxen inte
når) — kör en gång via `workflow_dispatch` och granska resultatet innan
cron-schemat litas på. Se DECISION_LOG.md för fullständig genomgång.

## Archive-steget omskrivet: git som primärt arkiv (2026-07-20)

Wayback Machine/Internet Archive är en extern amerikansk part — på
ägarens begäran är primärt arkiv nu istället repots EGEN git-historik
(se DECISION_LOG.md för fullständigt resonemang). En nedladdad rå-PDF
committas tillsammans med resten av datan; en commit-pinnad GitHub-
permalänk fungerar som "arkiverad kopia". Wayback finns kvar i koden som
en helt frivillig, icke-blockerande extra (`ARCHIVE_ACCESS_KEY`/
`ARCHIVE_SECRET_KEY`, om ni ändå vill sätta upp ett konto senare).

Nytt: `scripts/fill-archive-urls.mjs` körs i CI efter `git commit` och
fyller i den riktiga permalänken (archive-steget självt känner bara till
en PENDING-markör, eftersom commit-SHA:n inte finns än när det körs).
`templates/site.html` renderar nu även arkivlänken (saknades tidigare
helt) — döljs snyggt tills en riktig länk finns, aldrig en trasig sådan.

## Skarp körning av HELA kedjan mot ett komplett, tidigare oanvänt möte (2026-07-20)

Kört mot Kommunfullmäktige 2026-03-25 (§61–82, 22 paragrafer) — extract →
gates → link → publish → build, med en riktig `ANTHROPIC_API_KEY` för
extract-steget. 18/19 ärenden godkända av gates (1 till needs_review, se
nedan). Artefakter finns i `data/live/`, `data/ready/`, `data/needs_review/`,
`data/published/arenden.json`, `dist/`. Fullständig genomgång i
`DECISION_LOG.md` under samma datum. Kort sammanfattning:

- **Ett riktigt promptfel hittat och fixat:** citat som själva innehåller
  citattecken (t.ex. en redaktionell rättelse i protokollet, `"fodras"` →
  `"fordras"`) gav ogiltig JSON om modellen inte escapade dem. `buildExtractionPrompt`
  i `extract.ts` uppdaterad med explicit instruktion + exempel.
- **En klassificeringslucka hittad, INTE åtgärdad:** avsägelser och
  kompletteringsval (7 av 22 ärenden i detta möte) passar ingen befintlig
  `initiativ_typ`. Kräver ägarbeslut, se DECISION_LOG.md.
- **Verbatimgrinden underkände korrekt** ett citat som skilde sig från
  källtexten på grund av ett bindestrecks-tapp vid radbrytning i PDF-
  extraktionen — inte en LLM-hallucination. Grinden gjorde exakt vad den
  ska: vägrade gissa, skickade till needs_review.
- **`scopeToOwnSection`-fixen (se nedan) höll** i en riktig 18-ärendes
  flerärende-länkning: inga falska sammanslagningar.

## Köra det skarpt, hela kedjan

```bash
npm run fetch > /tmp/new-meetings.json
npm run download /tmp/new-meetings.json

ANTHROPIC_API_KEY=sk-... npm run extract \
  data/raw/kommunfullmaktige/<datum>/protokoll.pdf \
  "§XX KF <datum>" <datum> > /tmp/candidates.json

# gates kräver inget nätverk eller nyckel — helt offline:
npm run gates /tmp/candidates.json <källtext-som-extract-använde>.txt

VERIFY_API_KEY=sk-... npm run verify data/ready/<tidsstämpel>.json <källtext>.txt

ARCHIVE_ACCESS_KEY=... ARCHIVE_SECRET_KEY=... npm run archive data/verified/<tidsstämpel>.json

# link kräver inget nätverk eller nyckel — helt offline:
npm run link data/archived/<tidsstämpel>.json <källtext>.txt

# publish och build kräver inget nätverk eller nyckel — helt offline:
npm run publish
npm run build
# → dist/index.html är den färdiga, driftklara statiska sajten
```

**Om något inte fungerar som väntat:** det är det mest sannolika utfallet
av att köra kod som bara är verifierad mot dokumentation/fixtures, inte
skarp trafik. Skicka tillbaka felmeddelandet — samma mönster som
bilaga-URL-buggen ovan, som bara gick att hitta genom att faktiskt köra
koden mot en riktig, tidigare osedd sida.

---

## Detaljer per steg

### gates — bevisar ett riktigt R2-fynd från testriggen är löst
`gates.ts` portar samma logik som testriggens `verbatim-gate.js` till
TypeScript. Den enda skillnaden av substans: **den differentierade
ordgränsen från spec §4.2 R2 är nu faktiskt implementerad** (40 ord
default, 60 för `namndyttrande`), inte bara dokumenterad som ett fynd.
`gates.test.ts` använder det ÄKTA 43-ords citatet (Tekniska nämndens
yttrande om vattenlek, KF 2026-02-25 §45) som testriggen medvetet lät
falla igenom, och bevisar att det nu godkänns när steget korrekt typas
`namndyttrande` — men fortfarande underkänns om samma citat felaktigt
typats `beslut`. Gränsen är alltså verkligen typberoende.

Ett `gateArende`-anrop underkänner HELA ärendet om ens ETT citat (huvud-
citat, reservation, eller protokollsanteckning) brister.

### extract — en verklig bugg hittades och fixades under byggandet
Promptmallen innehöll bokstavliga backticks (markdown-kodformat) inuti en
JS-template-literal, vilket avslutade strängen i förtid och kraschade hela
modulen vid import — synligt bara genom att faktiskt köra koden, inte vid
granskning. Fixat.

`pdf-parse` v2.4.5 är en helt omskriven, pdf.js-baserad modul med annan
API-yta (`new PDFParse({data}).getText()`) än den gamla, ofta refererade
1.x-versionen (`pdf-parse(buffer) => {text}`) — värt att veta om du letar
exempel online.

### verify — säker fallback om LLM-svaret är trasigt
Om verify-svaret inte går att tolka faller `parseVerificationResponse`
ALLTID tillbaka på `"review"`, aldrig `"publish"`. `reconcile()` kräver
dessutom att BÅDE gates och verify säger ja — ett gates-underkännande kan
aldrig förbigås av vad LLM B säger. Båda testade explicit.

### download — dedupering, filnamn utan krockar
`extractAgendaBilagaLinks` dedupear bilagor länkade flera gånger på samma
sida, och hanterar det numeriska URL-suffixet (se Liveresultat) utan att
tappa unikhet i de lokala filnamnen.

### gates — en verklig bugg hittades via det SKARPA LLM-testet (inte bara fixtures)
R2:s ordgräns applicerades ursprungligen på reservationer/protokolls-
anteckningar precis som på huvudcitatet. Ett skarpt test (se "Skarpt
LLM-test" ovan) visade att detta felaktigt skulle underkänna en äkta,
redan verifierad 54-ords protokollsanteckning. Fixat: ordgränsen gäller nu
bara huvudcitatet som styrker `decision` — substräng-kontrollen gäller
fortfarande fullt ut för alla fält.

### link — R7 bevisat med riktiga Beslutsunderlag-texter, inte konstruerade
`linkArende` testas mot de ORDAGRANNA `Beslutsunderlag`-texterna ur VON-
protokollet (§2, 2026-02-18) och det slutgiltiga KF-beslutet (§92,
2026-05-06) för samma ärende — motion om "valmöjlighet i värdig vård".
Beviset är konkret: `case-48` i testriggen visade att diarienumret bytte
helt (`2025.271 VON` → `2025.511 KS`), och `link.test.ts` bevisar att
paragraf-korsreferensen (`§ 2 VON`) ändå kopplar ihop dem korrekt. Ett
äkta format-fynd gjordes samtidigt: `Beslutsunderlag`-listor refererar
ibland till paragrafer som `"§225/2025 KF"` (med årtal inbakat i
referensen), inte bara `"§225 KF"` — regexen hanterar båda.

**Uppdatering (se DECISION_LOG.md, 2026-07-20):** ett smoke-test mot ett
riktigt KF-möte med flera ärenden (2026-02-25, §32–60) avslöjade att
`linkArende` gav falska positiva sammanslagningar om `beslutsunderlagText`
inte var förskopad till ETT enda ärende — vilket är det NORMALA fallet i
skarp drift, eftersom `download.ts` hämtar en PDF per MÖTE, inte per
ärende. `linkArende` skopar nu sig själv (`scopeToOwnSection`) till
candidatens egen paragraf-sektion innan matchning, med en säker fallback
(tom text, inte hela dokumentet) om candidatens eget steg inte går att
lokalisera. Bevisat med konkreta repro-tester mot ordagrann text ur
`protokoll-kf-2026-02-25.txt` (Plantaxa/Fritidsbank-fallet).

Fuzzy-titelmatchning (fallback när inga paragraf-referenser alls finns,
t.ex. för en förstagångsmotion) flaggar ALDRIG för automatisk
sammanslagning — bara för manuell granskning. Om `Beslutsunderlag`
innehöll referenser men INGEN av dem matchade ett befintligt ärende
provas fuzzy-matchning inte heller: spec §5 steg 7 är tydlig att en
missad koppling (dubblett, går att rätta manuellt) är bättre än en
felaktig sammanslagning.

### publish — deterministisk JSON, så git diff bara visar riktiga ändringar
`canonicalize` sorterar objektnycklar rekursivt (alfabetiskt) men rör
ALDRIG array-ordning — kronologisk stegordning (R1) är semantiskt
meningsfull och ska inte kunna kastas om. `computeDataHash` är därför
stabil oavsett i vilken ordning fälten råkade komma in från tidigare steg.
git-commit görs medvetet INTE av koden själv — det är CI:s (GitHub
Actions) ansvar, se kommentaren i `publish.ts`.

### build — kopplar ihop pipelinen med webbapp-prototypen, inte en ny sajt
`templates/site.html` ÄR samma prototyp (`faktagranskaren.html`) som
visades tidigare i arbetet, templatiserad med en enda platshållarmarkör
istället för hårdkodad data. `build.test.ts` kör ett riktigt integrations-
test: injicerar data i den FAKTISKA mallfilen och kör resultatets
JavaScript genom Node:s `vm`-modul för att bevisa att det är syntaktiskt
giltigt — inte bara att strängen såg rätt ut. Ett separat test bekräftar
att citattecken och radbrytningar i extraherad data (vanligt i citat och
protokollsanteckningar) escapas korrekt av `JSON.stringify` och inte kan
göra den injicerade sidan trasig.

---

## Filer

```
src/
  config.ts        — bevakade instanser (confirmed/unconfirmed)
  fetch.ts          — mötesdiff + protokoll-URL-extraktion (testbar utan nätverk)
  fetch-cli.ts      — körbar ingång, pratar med riktiga nätverket
  download.ts       — bilaga-extraktion + nedladdningslogik (testbar utan nätverk)
  download-cli.ts   — körbar ingång, pratar med riktiga nätverket
  extract.ts        — PDF-textextraktion (riktigt testad) + promptbygge + svarsparsning
  extract-cli.ts    — körbar ingång, gör riktiga anrop till Anthropic API
  gates.ts          — verbatimgrinden (R2), ren kod, ingen AI, helt offline
  gates-cli.ts      — körbar ingång, läser extract-output + källtext, skriver ready/needs_review
  verify.ts         — LLM B-promptbygge, svarsparsning (säker fallback), reconcile-logik
  verify-cli.ts     — körbar ingång, leverantörsagnostisk (se öppen fråga #1)
  archive.ts        — SPN2-integration mot Wayback Machine (dokumentationsbaserad, otestad)
  archive-cli.ts    — körbar ingång, kräver archive.org-konto (se öppen fråga #2)
  link.ts           — paragraf-korsreferens (R7) + fuzzy-titelfallback, helt offline
  link-cli.ts        — körbar ingång, uppdaterar data/published/arenden.json
test/
  fetch.test.ts     — 11 tester (10 fixture + 1 livefynd)
  download.test.ts  — 8 tester (6 fixture + 2 livefynd, en bugg hittad och löst)
  extract.test.ts   — 12 tester (riktig PDF-extraktion + konstruerade LLM-svar)
  gates.test.ts     — 10 tester (bevisar R2-lösningen mot äkta 43-ords citat)
  verify.test.ts    — 12 tester (promptbygge, säker fallback, alla 4 reconcile-kombinationer)
  archive.test.ts   — 13 tester (SPN2-format enligt dokumentation, orkestrering mockad)
  link.test.ts      — 21 tester (R7 mot riktiga Beslutsunderlag-texter, inkl. "/år"-formatfyndet,
                       samt 3 regressionstester för `scopeToOwnSection` — se DECISION_LOG.md om
                       varför en oskopad flerärende-källtext tidigare kunde ge falska matchningar)
  fixtures-plantaxa.pdf — handbyggd men giltig PDF, används i extract-testerna
data/
  seen.json         — tom startfil; pipeline fyller på efter varje publish
  raw/              — download: {slug}/{datum}/protokoll.pdf + bilagor/
  ready/            — gates: godkända ärenden, redo för verify
  verified/         — verify: godkända av BÅDE gates och LLM B, redo för archive/publish
  archived/         — archive: samma ärenden med ifyllda archive_url-fält
  published/        — link: den "levande databasen", arenden.json med stabila id:n
  needs_review/     — gates/verify: underkända ärenden, full felmotivering
```

## Nästa steg

`publish` (kanonisk sorterad JSON, hash, changelog, git-commit) och `build`
(statisk sajt — se `faktagranskaren.html`-prototypen som redan visar hur
datan ska se ut när den renderas).
