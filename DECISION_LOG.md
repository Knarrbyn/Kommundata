# DECISION_LOG.md

Loggar avvikelser och egna val enligt FAKTAGRANSKAREN-SPEC.md §0, punkt 4.

## 2026-07-20 — publish.ts och build.ts byggda i efterhand, från grunden

**Vad:** `src/publish.ts`, `src/publish-cli.ts`, `src/build.ts`, `src/build-cli.ts`
samt tillhörande tester saknades i den pipeline-leverans som lämnades över
från föregående session, trots att `pipeline-README.md` i kunskapslagret
beskrev alla nio pipeline-stegen (spec §5) som byggda och fullt testade,
inklusive ett end-to-end-test mot en riktig prototypfil `templates/site.html`.

**Beslut:** byggde båda modulerna från grunden i den här sessionen, i
samma kodstil och med samma testmönster (`node:test`, riktig data från
testriggens `case-*.json`/protokoll där det gick) som de sex redan
befintliga modulerna.

**RÄTTELSE (samma dag, senare):** ovanstående var FEL. Personen letade
igenom en tidigare chattsession och hittade `faktagranskaren.html` —
prototypen existerade, den fanns bara i en session vars filer inte följde
med i det som lämnades över till den här. Filen bekräftades äkta: den
använder exakt de nio ärendena ur testriggens `case-*.json`, har en
`verifyStamp()`-funktion som är precis den "verifieringsstämpel"-design
som beskrevs, och URL-schemat (`/`, `/arende/[id]`, `/parti/[kod]`,
`/metod`, `/om`) matchar spec §7. Min tidigare slutsats — att den "aldrig
skapats" — byggde på att jag inte hade filen tillgänglig, vilket jag
felaktigt generaliserade till att den inte fanns alls. Det är en viktig
skillnad: "jag har inte tillgång till X" är inte samma sak som "X
existerar inte", och jag borde ha varit tydligare med den avgränsningen
i loggen från förra passet.

**Åtgärd:** `templates/site.html` skapades genom att ta den uppladdade
filen och ersätta den hårdkodade `const ARENDEN = [...]`-arrayen (rad
349–518 i originalfilen) med en enda platshållarmarkör,
`const ARENDEN = __ARENDEN_JSON__;` — exakt det README alltid beskrev
("templatiserad med en enda platshållarmarkör istället för hårdkodad
data"). Allt annat i filen (CSS, typsnitt, `renderStep`, `renderCard`,
`viewArende`, `viewParti`, `viewMetod`, `viewOm`, routern) är orört —
det är prototypens egen, redan färdiga kod. `build.ts` skrevs om helt
(andra versionen) för att läsa den här mallen och injicera riktig
publicerad data i platshållaren, istället för att rendera min egen
nydesignade sajt. Se `test/build.test.ts` för bevis: ett test läser
`templates/site.html` direkt och kräver att `verifyStamp`/`viewParti`
finns kvar orörda, och ett annat kör hela det injicerade klientscriptet
genom `vm` mot verklig testdata (inklusive vattenlek-ärendets 43-ords
R2-citat och ett konstruerat citat med `</script>` mitt i).

**Kvarstående, korrekt del av det ursprungliga fyndet:** README:ts
konkreta påstående om att `build.ts` var *"fullt testat mot den RIKTIGA
templates/site.html, inkl. full end-to-end-körning"* går fortfarande
inte att bekräfta för den ARBETSKOD som fanns i den mottagna zip-filen
— den koden fanns inte, oavsett om mallen den skulle testas mot gjorde
det. Så: mallen fanns, men själva `build.ts`-modulen och dess tester
saknades ändå i leveransen, precis som ursprungligen konstaterat. Det är
bara förklaringen till VARFÖR som ändras, inte att luckan fanns.

**Testantalet, för ordningens skull:** README:ts påstådda "102 tester"
stämmer fortfarande inte — varken mot dess egna sju delsummor (84) eller
mot koden (86, innan publish/build lades till). Se separat post nedan.
Räkna alltid om med `npm test` istället för att lita på prosa-siffror.

---

**(Ursprunglig, nu delvis inaktuell text bevarad nedan för spårbarhet.)**

Konsekvens att känna till (URSPRUNGLIG, FELAKTIG SLUTSATS): den tidigare
prototypen `faktagranskaren.html` som README:t refererade till (med en
"verifieringsstämpel"-designsignatur) har bekräftats aldrig ha skapats i
någon tidigare session — inte bara otillgänglig i den här. `build.ts`
renderar därför en NY, från grunden designad statisk sajt.

**Vad som är skarpt bevisat om de nya modulerna (inte bara enhetstestat):**
- Full `link → publish → build`-kedja kördes mot sex riktiga ärenden ur
  testriggens `case-44/45/47/49/51/52`-filer och producerade en giltig,
  25 kB `dist/index.html` samt `dist/api/arenden.json`.
- `publish`-steget kördes två gånger i rad mot identisk indata — andra
  körningen gav exakt samma `data_hash` och `"Ingen förändring sedan
  förra körningen"`, vilket bevisar den avsedda idempotensen.
- Det injicerade klient-JavaScripten i `dist/index.html` validerades
  genom att faktiskt köras i Node:s `vm`-modul (inte bara strängmatchning)
  — inklusive ett konstruerat citat med citattecken, en radbrytning OCH en
  bokstavlig `</script>`-sekvens, för att bevisa att `escapeForInlineScript`
  håller även i värsta fall.

## 2026-07-20 — falsk positiv i link-matchning upptäckt under smoke-testet (INTE en bugg i publish/build)

Under e2e-smoke-testet ovan matchade `linkArende` (redan befintlig,
tidigare fullt testad kod) felaktigt ihop flera fristående ärenden från
samma KF-sammanträde (2026-02-25) som varandra, med `kind: "paragraph_ref"`.
Orsaken: smoke-testskriptet skickade in HELA mötesprotokollets text (alla
ärendens `Beslutsunderlag`-sektioner tillsammans) som `beslutsunderlagText`
för VARJE enskilt ärende, istället för bara det enskilda ärendets egen
Beslutsunderlag-lista. `extractParagraphRefs` plockade då upp
paragraf-referenser som hörde till HELT ANDRA ärenden i samma möte, och
några av dem råkade sammanfalla med `protocol_ref` på redan tillagda
ärenden.

**Detta är sannolikt inte en bugg i `link.ts` självt** — i den riktiga
pipelinen ska `extract.ts` leverera en per-ärende-avgränsad källtext (eller
åtminstone ett per-ärende `beslutsunderlag_refs`-fält, se README:ts öppna
fråga #5 om detta). Men det är ett verkligt fynd om en FÖRUTSÄTTNING som
`link-cli.ts` i praktiken förlitar sig på och som inte är explicit
kontrollerad: att `beslutsunderlagText`-parametern verkligen är skopad till
ETT ärende, inte en hel mötesprotokoll-fil. Värt att verifiera explicit
innan `link`-steget körs skarpt mot riktig `extract`-output.

## 2026-07-20 — fyndet ovan fixat: `linkArende` skopar nu sig själv

Beslöt att INTE bara dokumentera förutsättningen utan att göra `linkArende`
robust mot den, eftersom `link-cli.ts` i praktiken *kommer* få hela
protokollets text i normal drift (en `download`-körning ger EN PDF per
möte, inte en per ärende — se `src/download.ts`), så "kräv att anroparen
skopar rätt" hade varit att förlita sig på disciplin snarare än kod, precis
det mönster verbatimgrinden själv finns för att undvika (jfr
ARKITEKTURMALL §2: "en AI kan inte vara sin egen kvalitetskontroll" —
samma princip gäller ren kod som är beroende av att anroparen gör rätt).

Lösning: ny funktion `scopeToOwnSection(fullText, candidate)` i `link.ts`.
Hittar candidatens egen paragraf-sektion i källtexten via dess SENASTE
stegs `protocol_ref` (t.ex. "§42 KF 2026-02-25" → paragraf "42"), genom att
leta upp alla rader som inleder en ärende-sektion (`/^§\s*(\d+)\b/m`) och
skära ut texten mellan candidatens egen rubrik och nästa. `linkArende`
anropar detta INNAN `extractParagraphRefs` körs — anroparen behöver alltså
inte längre skopa text själv för korrekthet (även om det fortfarande är
bäst praxis om man har en redan avgränsad text till hands).

Bevisat med ett konkret repro mot ordagrann text ur
`protokoll-kf-2026-02-25.txt`: Plantaxa (§42) slutade felaktigt matchas mot
Fritidsbank (via §171 KF, en referens som bara finns i Fritidsbanks EGEN
Beslutsunderlag) innan fixen — `kind: "none"` efter fixen, som det ska
vara. Två nya tester i `link.test.ts` täcker både det negativa fallet
(ingen falsk matchning över ärendegränser) och att en GILTIG korsreferens
fortfarande hittas korrekt när den ligger i candidatens egen sektion av en
flerärende-text. 109/110 tester gröna efter fixen (upp från 107, tre nya regressionstester).

**Kvarstående, medvetet inte löst nu:** om `extract.ts` någon gång byggs
om för att leverera `beslutsunderlag_refs` per ärende direkt (README:ts
öppna fråga #5), blir `scopeToOwnSection` överflödig för det normalfallet
— men bör behållas som ett skyddsnät, eftersom heuristiken (sist tillagda
stegets `protocol_ref`) är billig och inte gör någon skada när den redan
avgränsade texten bara innehåller en sektion.

## 2026-07-20 — skarp körning av HELA kedjan mot ett helt, tidigare oanvänt möte

Första gången hela kedjan (fetch → extract → gates → link → publish →
build) körs mot ett komplett, riktigt KF-möte i ett svep, med en verklig
LLM A-nyckel — inte bara enskilda utvalda ärenden som i tidigare sessioner.

**Möte:** Kommunfullmäktige 2026-03-25, §61–82 (22 paragrafer). Valt för
att det var justerat och publicerat men aldrig tidigare använt i något
testfall eller någon tidigare session — genuint osedd data.

**fetch/download:** sandboxens `bash`-nätverk når inte
`sammantradesportal.alingsas.se` (utanför tillåtna domäner), så dessa steg
gjordes med `web_fetch`-verktyget istället för `src/fetch.ts`/`download.ts`
själva. Källtexten sparad ordagrant i `source-texts-live/`. Detta ÄR
alltså inte ett test av `fetch.ts`/`download.ts`-koden, bara av att en
riktig, färsk PDF går att textextrahera och köra vidare i pipelinen.

**extract (LLM A, `claude-sonnet-4-6`, temperatur 0):** kört mot hela
protokolltexten (55 000 tecken) i ETT anrop. Två fynd, båda åtgärdade:

1. **Första körningen gav ogiltig JSON.** Orsak: källtexten innehåller på
   ett ställe (§68, en redaktionell rättelse "fodras" → "fordras") citat
   med RAKA citattecken inuti det ordagranna citatet. Modellen återgav
   citatet korrekt men escapade inte de inre citattecknen (`\"`) i sin
   JSON-utdata, vilket kraschade hela svarsparsningen — inte bara det
   enskilda ärendet. **Fixat i `buildExtractionPrompt`** (extract.ts):
   explicit instruktion + konkret exempel om JSON-escaping av citattecken
   inuti citat. Efter fixen: giltig JSON på första försöket vid omkörning.
2. **Klassificeringslucka i `initiativ_typ`, inte ett buggat extrakt.** De
   sju sista ärendena i mötet (§75–81: tre avsägelser av uppdrag, fyra
   kompletteringsval) klassades av modellen som `"initiativarende"` —
   men det är FEL enligt R10:s egen definition (kommunallagen 4 kap §20,
   rätt att väcka ärende i nämnd). En avsägelse eller ett kompletteringsval
   "väcks" inte av en ledamot i den bemärkelsen; det är administrativa
   personalärenden som kommunfullmäktige beslutar om direkt. Modellen
   tvingades välja närmaste tillgängliga kategori eftersom
   `VALID_INITIATIV_TYP` (motion | interpellation | enkel_fraga |
   medborgarforslag | styrelseforslag | initiativarende) saknar en
   kategori för den här sortens ärenden helt. **INTE åtgärdat** — kräver
   ett produktbeslut (ny `initiativ_typ`, t.ex. `"personalarende"` eller
   liknande, eller ett medvetet beslut att dessa ligger utanför G6:s scope
   trots att de tekniskt sett är beslutsärenden). Se öppen fråga nedan.

**gates:** 18/19 ärenden godkända. Det underkända fallet är LÄRORIKT: LLM
A:s citat ("... hälso- och sjukvårdsavtal ...") matchade inte källtexten
ordagrant — men vid närmare granskning berodde det INTE på att modellen
hittade på eller parafraserade. Källtextens PDF-extraktion (samma artefakt
skulle sannolikt uppstå med `pdf-parse` också, inte bara `web_fetch`s
konvertering) hade på just det stället tappat bindestrecket vid en
radbrytning: `"hälsooch sjukvårdsavtal"` istället för `"hälso- och
sjukvårdsavtal"` (bekräftat: 6 korrekta förekomster av den senare formen
på andra ställen i SAMMA dokument, bara 1 skadad förekomst). Grinden gjorde
exakt vad den ska: vägrade publicera något den inte kunde verifiera
tecken-för-tecken, och la det i `needs_review` istället för att gissa.
**Ingen ändring gjord** — att göra grinden mer tillåtande för
bindestrecks-artefakter skulle öppna en väg för riktiga hallucinationer
att glida igenom också. Detta är avsedd, korrekt konservatism, inte en bugg.

**link:** 18 ärenden länkade, alla korrekt som NYA (ingen falsk
sammanslagning — bekräftar att `scopeToOwnSection`-fixen håller i en
riktig 18-ärendes flerärende-körning, inte bara i de syntetiska
regressionstesterna). Ett korrekt icke-auto-sammanslaget gränsfall:
"Kommunalt kompletteringsval – Ersättare i socialnämnden..." fick
titel-likhet 0.79 mot "...Ledamot i socialnämnden..." (samma personer,
samma nämnd, bara ledamot/ersättare skiljer) — flaggades för manuell
granskning, slogs INTE ihop automatiskt. Exakt rätt beteende, men visar
att `FUZZY_TITLE_THRESHOLD` (0.6) ligger nära nog att ge falska varningar
för denna typ av närbesläktade men distinkta ärenden — inget att åtgärda,
bara värt att känna till.

**publish/build:** helt rent, `dist/index.html` (52 kB) + `dist/api/arenden.json`
byggda från 18 riktiga ärenden.

### Öppen fråga (ny, från denna körning): saknad `initiativ_typ` för personalärenden
Avsägelser och kompletteringsval (fyllnadsval) är en systematiskt
återkommande ärendetyp i KF-protokoll (7 av 22 paragrafer i detta möte —
nästan en tredjedel) som INTE passar någon av de sex befintliga
`initiativ_typ`-kategorierna. Kräver ägarbeslut: antingen (a) en ny
kategori tillagd i schemat, eller (b) ett medvetet beslut att exkludera
denna ärendetyp från G6:s scope (även om den tekniskt är ett
beslutsärende) med motiveringen att den saknar den sortens politiska
sakfråga-karaktär som resten av Faktagranskaren är byggd kring. Rekommenderar
INTE att gissa på en lösning här utan att stämma av med ägaren, av samma
skäl som "enkla frågor" lämnades öppen i spec §9 istället för att gissas
bort.

## 2026-07-20 — archive-steget omskrivet: git som primärt arkiv, inte en avvikelse

Ägarbeslut (efter diskussion): Wayback Machine/Internet Archive är en
extern amerikansk part, vilket ägaren aktivt vill undvika. Istället för
att antingen skaffa archive.org-nycklar eller formellt logga en avvikelse
(spec §0 punkt 4) valdes en tredje, bättre väg: **git-historiken som
primärt arkiv** (ARKITEKTURMALL §2, punkt 5 — "Sten kan inte hackas").

**Vad som byggdes:**
- `archive.ts`: nya funktioner `computeFileHash` (SHA-256 av rå-PDF:en,
  ren integritetskontroll), `buildPendingGitArchiveMarker`/
  `isPendingGitArchiveMarker` (markerar att en commit-SHA ännu inte är
  känd), `buildGitArchiveUrl` (bygger commit-pinnad GitHub-permalänk),
  `archiveArendenWithGit` (orkestrering — matchar steg mot nedladdade
  rå-filer via `pdf_url`). Wayback/SPN2-koden BEHÅLLS oförändrad men är
  nu explicit sekundär och frivillig (körs bara om
  ARCHIVE_ACCESS_KEY/SECRET_KEY finns satta, och ett misslyckande där
  blockerar aldrig pipelinen eller skriver över git-markören).
- `archive-cli.ts` omskriven: läser en `manifest.json` (ny, se nedan) för
  att matcha rå-filer mot `pdf_url`, sätter PENDING-markörer offline
  (inget nätverk krävs för primärvägen), försöker Wayback bara som extra.
- **Sekvensproblem hittat och löst:** git-commit görs INTE av pipelinekoden
  (se publish.ts, redan beslutat tidigare) — det sker i CI, EFTER att
  archive-steget redan körts. Så archive-steget kan omöjligt känna till sin
  egen framtida commit-SHA. Löst med ett tvåfas-flöde: PENDING-markör sätts
  offline av pipelinen, och ett nytt skript `scripts/fill-archive-urls.mjs`
  körs i CI EFTER `git commit`, läser av `git rev-parse HEAD`, och skriver
  in den riktiga permalänken i en liten uppföljande commit.
- **Ett verkligt strukturellt hål hittat under implementationen:**
  `pdf_url` sattes ALDRIG någonstans i den faktiska TypeScript-pipelinen
  — bara i de handskrivna testfallens JSON. `CandidateStep.source` hade
  bara `protocol_ref` i sin typdefinition. Detta hade gjort hela
  git-arkiveringen tandlös i skarp drift (inget att matcha mot). Fixat:
  `pdf_url` läggs nu till DETERMINISTISKT i ren kod, EFTER att LLM A:s svar
  redan är parsat (`stampPdfUrl` i extract.ts) — medvetet INTE något LLM:et
  ombeds fylla i självt, av samma skäl som R7 säger att identifierare inte
  ska litas på från en LLM. `extract-cli.ts` tar nu emot käll-PDF:ens URL
  som ett fjärde obligatoriskt argument.
- **`download-cli.ts` uppdaterad** att skriva `data/raw/manifest.json`
  (pdf_url → lokal sökväg) så archive-cli.ts kan matcha rå-filer utan att
  gissa på filnamn.
- **`templates/site.html` saknade arkivlänken helt** (bara
  "Originalprotokoll ↗" renderades) — spec §3:s "dubbel länk"-löfte gick
  alltså inte att uppfylla oavsett arkivmetod förrän nu. Lagt till
  `renderArchiveLink()`: visar länken bara när `archive_url` är en riktig
  URL, döljer den helt (ingen trasig länk, inget synligt "TODO" eller
  "git-pending:...") när markören fortfarande är PENDING eller saknas.

**Verifierat end-to-end** mot den skarpa 18-ärendes-datan från KF
2026-03-25: archive-cli.ts satte 18 PENDING-markörer (offline, inget
nätverk), link/publish/build gick igenom orört, och den byggda
`dist/index.html` visar noll trasiga eller synliga PENDING-strängar —
bara den riktiga "Originalprotokoll ↗"-länken tills en riktig commit-SHA
finns. 116/116 tester gröna (upp från 110 — sex nya tester för de nya
git-arkiveringsfunktionerna).

**Avvägning, medvetet accepterad:** ingen oberoende tredjepartsbekräftelse
av att dokumentet fanns vid den tidpunkten (till skillnad från Wayback).
Rimligt givet att sajten redan är statisk och varje citat är grindat av
verbatimgrinden (R2) — se den fullständiga jämförelsen i konversationen
med ägaren.

## 2026-07-20 — GitHub Actions-schemaläggning byggd

Implementerat nästa steg i den överenskomna prioritetsordningen.

**`scripts/run-weekly-pipeline.mjs`** — nytt orkestreringsskript som
binder ihop samtliga nio pipeline-steg i EN process, genom att anropa
funktionerna i `src/*.ts` direkt istället för att kedja separata
`*-cli.ts`-processer via filsystemet. Motivering: de befintliga CLI-
skripten är byggda för ETT möte i taget (praktiskt för manuell felsökning,
vilket de förblir till för), men en skarp veckokörning kan hitta flera nya
möten samtidigt över flera instanser — att kedja separata processer med
mellanliggande temp-filer för det hade blivit bräckligt. Skriptet:
1. Hittar nya möten hos alla `confirmed: true`-instanser i `config.ts`.
2. Extraherar (LLM A, `ANTHROPIC_API_KEY` obligatorisk).
3. Kör gates (ren kod).
4. Kör verify (LLM B) OM `VERIFY_API_KEY` finns satt — annars HOPPAS
   VERIFY-STEGET ÖVER HELT, tydligt loggat varje körning (se öppen fråga
   om modellfamiljs-oberoende, ej löst). Gates-godkända ärenden går då
   direkt vidare. Detta är en medveten, synlig avvikelse, inte ett dolt
   beteende — precis principen bakom hur archive-omskrivningen redan
   hanterar frivilliga/saknade beroenden.
5. Arkiverar via git (PENDING-markörer, som redan byggt).
6. Länkar mot befintlig databas (`scopeToOwnSection` gäller automatiskt).
7. Publicerar (kanonisering, hash, changelog).
8. Bygger `dist/index.html` + `dist/api/arenden.json`.
9. Uppdaterar `data/seen.json` EFTER publish, inte innan (matchar
   `markSeen`-kommentaren i fetch.ts — ett möte som fallerar mitt i ska
   plockas upp igen nästa körning, inte tystas ner).

Varje instans/möte är felisolerat (`try/catch` per instans och per möte)
— ett nätverksfel eller en trasig PDF hos EN nämnd stoppar inte de andra.

**`.github/workflows/weekly-pipeline.yml`** — cron `0 6 * * 1` (måndagar,
enligt spec §6) + `workflow_dispatch` för manuell körning. Kör skriptet
ovan, committar `data/` + `dist/` bara om något faktiskt ändrats (annars
inget att göra, inget skräp-commit), kör därefter
`scripts/fill-archive-urls.mjs` som en uppföljande commit (löser
sekvensproblemet för PENDING-markörerna, se föregående post). Netlify
(primär hosting) behöver inget eget deploy-steg — antas redan vara kopplat
direkt mot repot via Netlifys egen GitHub-integration och deployar
automatiskt vid push. GitHub Pages (spec §2, "tre parallella deploys" som
varma reserver) finns förberett som kommenterade steg, redo att aktiveras
när Pages är påslaget i repots inställningar.

**Verifierat:** skriptet kördes med en dummy-nyckel i sandboxen. Alla
imports/moduler laddade felfritt, verify-skip-varningen loggades korrekt,
och nätverksfel mot varje instans (HTTP 403 — sandboxens domänrestriktion,
INTE ett kodfel) hanterades isolerat per instans utan att krascha hela
körningen; ett rent "inget nytt att göra"-avslut skedde när inga möten
hittades. **INTE verifierat:** en fullständig lyckad körning mot riktiga
möten (kräver nätverksåtkomst till sammantradesportal.alingsas.se, som
varken sandboxens bash-nätverk eller CI-miljön testats mot ännu) — de
enskilda byggstenarna (extract, gates, archive, link, publish, build) är
dock redan var för sig bevisade skarpt i tidigare körningar denna session
och föregående, så risken bedöms som låg men är inte noll. Bör köras en
gång manuellt via `workflow_dispatch` och granskas innan cron-schemat
litas på helt.

**Öppen risk, inte undersökt:** okänt om sammantradesportal.alingsas.se
blockerar trafik från GitHub Actions' IP-intervall på samma sätt som den
(förväntat) blockerar sandboxens. Kan bara verifieras genom en faktisk
körning i CI.

## 2026-07-22 — Första skarpa driftsättningen: repo, secrets, och en lyckad körning

**Repo:** `Knarrbyn/Kommundata`, publikt, skapat och pushat av mig via en
fine-grained personal access token (`Contents: Read/write`,
`Actions: Read/write`, `Metadata: Read-only`, scopad till bara detta repo,
kort giltighetstid). Token raderad ur lokal git-config direkt efter varje
push (`git remote set-url` tillbaka till en URL utan credentials).

**Ett verkligt GitHub-platsbegränsning hittad:** fine-grained PATs kan inte
skapa ELLER uppdatera filer under `.github/workflows/` — GitHub kräver den
äldre "classic"-tokens `workflow`-scope, som fine-grained tokens saknar
helt (bekräftat: ingen sådan behörighet finns ens att välja i UI:t).
Löst genom att workflow-filen istället laddas upp manuellt av ägaren via
GitHub:s webbgränssnitt (`/upload/main/.github/workflows`), utanför
token-vägen. **Lärdom, redan tillämpad andra gången:** manuell copy-paste
i GitHub:s lilla textruta trunkerade filen första försöket (68 av 107
rader kom med, ingen felindikation från GitHub) — bytte till att ladda
upp filen som en riktig fil (drag-and-drop) istället för att klistra text,
vilket är immunt mot den typen av trunkering. Verifierat byte-för-byte
efteråt via `contents`-API:et båda gångerna — värt att alltid göra efter
en manuell UI-åtgärd av det här slaget, inte bara lita på att UI:t sa
"Commit changes" utan fel.

**Secret:** `ANTHROPIC_API_KEY` satt av ägaren direkt i GitHub:s
webbgränssnitt (rekommenderad, säkrare väg — värdet gick aldrig genom
chatten). En första secret döptes av misstag "KommunGitHub" (bara namnet,
inte värdet, var fel) — GitHub tillåter inte namnbyte på secrets, löst
genom att skapa en till med korrekt namn `ANTHROPIC_API_KEY`.

**Första skarpa körningen (`workflow_dispatch`, run #1, 2026-07-22):**
`success`, 16s total. Full logg granskad tillsammans med ägaren:
- Alla 9 bevakade instanser genomsökta, INGEN `✗ FEL vid fetch`-rad —
  bekräftar att **nätverksåtkomsten till sammantradesportal.alingsas.se
  fungerar från GitHub Actions**, till skillnad från utvecklingssandboxen
  (som är domänbegränsad). Den öppna risken i förra postens "Öppen risk,
  inte undersökt"-stycke är därmed löst, bekräftat i skarp drift, inte
  bara antaget.
- Verify-skip-varningen (`VERIFY_API_KEY saknas...`) syntes tydligt i
  loggen, precis som avsett.
- Genuint noll nya justerade protokoll denna vecka — rimligt, inte ett
  fel.
- **Ett verkligt fynd i `Sammanfattning`-steget:** `GITHUB_STEP_SUMMARY`
  visade en needs_review-fil daterad 2026-07-20 (två dagar gammal, en
  kvarleva från mina egna manuella smoke-tester som råkade följa med i
  det allra första repo-pushet) som om den hörde till DEN HÄR körningen.
  Orsak: `ls -t data/needs_review/*.json | head -1` plockar den SENAST
  ÄNDRADE filen oavsett ålder, inte filer skapade av just den aktuella
  körningen. Fixat: ett nytt steg `Markera starttid` sätter en
  tidsstämpelfil precis innan pipelinen körs, och sammanfattningen
  filtrerar nu med `find ... -newer` mot den markören — bara genuint nya
  needs_review-filer räknas. Uppladdad och verifierad (123 rader,
  byte-för-byte kontrollerad via API:et).

**Kvarstående städning, inte gjord än:** repot innehåller fortfarande
utvecklingsartefakter från mina tidigare sessioner (`data/live/`,
`source-texts-live/`, `run-live-extract.mjs`, den gamla needs_review-
kvarlevan) som inte hör hemma i en "skarp" produktionsrepo. Ofarligt för
funktionen (fixen ovan neutraliserar redan den mest missvisande effekten),
men värt en städ-commit senare för tydlighetens skull.

**Uppföljning samma dag:** verifieringskörning #2 (`workflow_dispatch`)
bekräftar fixen — `run-pipeline summary` visar nu korrekt "Inga nya
poster till manuell granskning denna körning" istället för att peka på
2026-07-20-kvarlevan. GitHub Actions-schemaläggningen är därmed fullt
verifierad i skarp drift: repo, secrets, manuell körning, och den
schemalagda cron-körningen (0 6 * * 1, måndagar) redo att ta vid.
