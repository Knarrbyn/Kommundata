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

## 2026-07-22 — initiativ_typ-luckan löst: R11, väg B (exkludera, ingen ny kategori)

Ägarbeslut, efter genomgång av alternativen: de sex befintliga
`initiativ_typ`-kategorierna räcker. Avsägelser av uppdrag och kommunala
kompletteringsval/fyllnadsval (7 av 22 ärenden i KF 2026-03-25 — nästan en
tredjedel av ett typiskt möte) exkluderas nu HELT ur scope, på samma sätt
som rena informationspunkter redan exkluderades. `src/extract.ts`
uppdaterad med en ny R11-regel i prompten. Ingen kodstrukturell ändring
(bara prompttext), 116/116 tester fortsatt gröna.

**Inte live-verifierat ännu** — ingen ANTHROPIC_API_KEY tillgänglig i den
här sessionen för en skarp omkörning mot samma 2026-03-25-data. Nästa
riktiga extract-körning (skarpt, via GitHub Actions eller manuellt) blir
det facto-testet av att modellen faktiskt respekterar R11.

Ägaren har samtidigt beslutat att betrakta Faktagranskaren som en
FRISTÅENDE app, utan ytterligare arkitektur-återanvändning mot andra
planerade civic-tech-appar (Grön Väg-uppföljaren visade sig i produktsamtal
vara en helt orelaterad reseplanerare för elbilsresor, inte civic-tech —
hör inte hemma i den här familjen alls). Detta var den sista öppna punkten
i den överenskomna prioritetsordningen för att "bli klar" med appen.

## 2026-07-22 — Tre autonoma förbättringar (ingen ägarinsats krävdes)

Efter att ägaren frågade vilka kvarstående punkter jag kunde åtgärda själv:

**1. `samhallsbyggnadsnamnden` verifierad.** Websökning bekräftade riktiga
möten/protokoll under `/committees/samhallsbyggnadsnamnden` (t.ex.
mote-2021-01-25). `confirmed: false` → `true` i `config.ts`, med
källhänvisning. Bekräftade samtidigt att arbetsutskottet ligger på en
separat slug, konsekvent med att AU redan medvetet exkluderas.

**2. Repo-städning.** Alla utvecklings-/smoke-test-artefakter (från
2026-07-20, innan pipelinen automatiserades) flyttade till
`dev-artifacts/2026-07-20-smoke-test/` med en förklarande README, istället
för att ligga blandat med produktionskoden i `data/`. `data/needs_review`,
`data/ready`, `data/archived`, `data/raw` behåller sin katalogstruktur
(`.gitkeep`) redo för riktig drift. **Viktigt att komma ihåg:** de 18
ärendena som fortfarande är publicerade på `faktagranskaren.netlify.app`
kommer ursprungligen från just den flyttade smoke-test-körningen — se
`dev-artifacts/README.md` för fullständig spårbarhet.

**3. Två saknade sidor från spec §7 byggda: `/sök` och `/nämnd/[slug]`.**
Lagt till `viewNamnd(slug)` (alla ärenden med minst ett steg hos en given
instans, samma kortmönster som `/parti/[kod]`) och `viewSok()`
(fritextsök i titel+citat, kombinerat med nämnd- och statusfilter).
Sökfältets input uppdaterar bara resultatlistan via
`document.getElementById`, inte hela `render()`, för att inte tappa fokus
i inputfältet vid varje tangenttryckning. Nämndnamnet i varje ärendes
tidslinje är nu klickbart och länkar till `/namnd/[slug]`. Lade till
"Sök" i huvudnavigeringen.

**Ett verkligt, live-påverkande fel hittat och fixat under arbetet:**
`INSTANCE_NAMES` i `templates/site.html` använde understreck
(`vard_och_omsorgsnamnden`) som nycklar, men både `config.ts` och — viktigast
— den FAKTISKA skarpa extraherade datan (kontrollerat direkt i
`data/published/arenden.json`) använder bindestreck
(`vard-och-omsorgsnamnden`), matchande de riktiga URL-sökvägarna. Det
betydde att nämndnamn för allt utom de fyra ursprungligen hårdkodade
instanserna visades som råa, oformaterade slugs på den LIVE sajten redan
innan denna fix. Rättat och kompletterat till alla nio bevakade instanser.

**Även uppdaterat:** `/metod`-sidans beskrivning av arkivering (påstod
fortfarande Wayback Machine — nu ärligt beskriven som git-baserad) och av
verify-steget (nu tydligt märkt som tillfälligt avstängt, utan att påstå
"dubbel oberoende AI-granskning" som om det vore aktivt).

**Verifierat:** byggde sajten lokalt med den riktiga publicerade datan,
körde den injicerade sidans JS i en sandlåda (samma mönster som
`build.test.ts`), och testade `viewNamnd`/`viewSok` direkt — båda
fungerar, okänd nämnd-slug hanteras snyggt utan krasch. 116/116 tester
fortsatt gröna.

## 2026-07-22 — "Om tjänsten"-texten korrigerad (ägarbeslut)

Footer-meningen "byggd på samma öppna arkitekturmall som övriga
civic-tech-projekt från institutet" togs bort — den antydde en aktiv
familjegemenskap med andra Mjörninstitutet-appar som ägaren uttryckligen
inte vill kommunicera just nu (Faktagranskaren betraktas som fristående,
se tidigare post om Grön Väg-produktsamtalet). "Skapad av Tankesmedjan
Mjörninstitutet" (både i header och footer) behålls oförändrat — det är
bara attribution, inte ett påstående om delad arkitektur.

## 2026-07-22 — Processlärdom sparad som stående minne

Efter ägarens feedback om att flera separata tekniska delval (token-scope,
secret-namn, build-inställningar) krävde bedömningar hen som lekman inte
hade förutsättningar att göra: en instruktion har lagts till i Claudes
minnessystem (inte i det här repot) om att lägga fram samlade planer med
motivering istället för sekventiella delval vid framtida tekniska
projekt. Ett jargonfritt referensdokument om GitHub/GitHub Actions/Netlify
levererades samtidigt till ägaren, för att fylla kunskapsluckan direkt.

## 2026-07-22 — GitHub Pages aktiverad som gratis, kreditfri reserv

Bakgrund: en kostnadsdiskussion med ägaren avslöjade att Netlify bytte till
en kreditbaserad prismodell i september 2025 (efter min kunskapsgräns) —
gratisnivån är nu ~15 GB bandbredd/månad (300 krediter, 20 kr/GB) snarare
än den tidigare mer generösa 100 GB-modellen, och deploys kostar också
krediter (15 st). Vid överskriden gräns går sajten OFFLINE tills nästa
månad snarare än att fakturera — en risk för en civic-tech-tjänst om
trafiktoppar (t.ex. kring ett omdebatterat beslut) skulle sammanfalla med
slut på krediter.

Löst genom att aktivera GitHub Pages som en helt gratis, obegränsad
(publikt repo) reserv — exakt vad spec §2 punkt 5 ursprungligen
efterlyste ("tre parallella deploys"). `.github/workflows/weekly-pipeline.yml`
uppdaterad: nya `pages`/`id-token`-permissions, tre nya steg
(configure-pages, upload-pages-artifact, deploy-pages) EFTER commit-stegen,
medvetet UTAN `if: changed`-villkor (till skillnad från Netlify som redan
sköter sig själv via sin egen GitHub-integration) — Pages ska alltid
spegla den redan committade `dist/`-mappen oavsett om just den körningen
hittade ny data, annars hade Pages aldrig hunnit ikapp vid denna första
aktivering.

**Manuellt UI-steg krävdes av ägaren** (samma mönster som workflow-filen
tidigare): fine-grained PAT saknar behörighet att ändra Pages-inställningar
via API (`403 Resource not accessible`, samma familj av begränsning som
workflow-filerna). Ägaren satte Source: GitHub Actions själv i
Settings → Pages, jag förberedde och laddade upp den uppdaterade
workflow-filen.

**Verifierat i skarp drift:** körning lyckades, alla tre nya steg gröna.
Live på `https://knarrbyn.github.io/Kommundata/`, oberoende av Netlifys
infrastruktur och kreditsystem helt.

## 2026-07-22 — Backfill-lösning byggd (manuellt styrbar, kostnadstak per omgång)

Ägarbeslut efter diskussion om att fylla på historik till hela
mandatperioden (2022–2026): bygg ett separat, manuellt styrbart
backfill-läge — INTE en automatisk bakåtgående cron, av kostnads- och
riskskäl (rate-limiting, oväntat stor API-räkning på en gång).

**Viktigt fynd som förenklade lösningen rejält:** varje mötessidas
sidmeny på sammantradesportal.alingsas.se innehåller redan länkar till
HELA historiken bakåt (bekräftat till 2009 för kommunfullmäktige, via
`web_fetch` mot en riktig mötessida). Ingen separat
bläddrings-/pagineringslogik behövde byggas — `extractMeetingRefs`
(redan befintlig kod i `fetch.ts`) plockar upp alla historiska datum
direkt ur en enda sidhämtning. **Inte 100 % verifierat:** antagandet att
den BARA listsidan (`/committees/{slug}`, utan ett specifikt möte)
har samma fullständiga sidmeny som en enskild mötessida — bekräftat bara
för den senare. Bör verifieras första gången backfill faktiskt körs
skarpt; om listsidan visar sig ha en kortare historik än mötessidorna är
en enkel fix att istället utgå från en känd, nyligen hämtad mötes-URL.

**`scripts/run-backfill.mjs`** — tar instans-slug, start-/slutdatum, och
ett kostnadstak (`max-möten-denna-körning`, default 10) som argument.
Hämtar all historik, filtrerar på datumintervall OCH mot `data/seen.json`
(delas med den vanliga veckopipelinen — ingen risk för dubbelbearbetning
mellan de två), sorterar äldst-först, tar bara upp till taket. Rapporterar
tydligt hur många möten som återstår inom intervallet efter varje
körning, så nästa omgång vet var den ska fortsätta. Kör i övrigt samma
extract→gates→verify→archive→link→publish→build-kedja som
`run-weekly-pipeline.mjs`.

**`.github/workflows/backfill.yml`** — `workflow_dispatch` MED
inmatningsfält (instans, start-/slutdatum, kostnadstak) — medvetet INGEN
`schedule`-trigger. Speglar även till GitHub Pages efter varje omgång
(samma mönster som veckopipelinen, nu med kostnadstak-medvetenhet given
Netlifys kreditsystem — se tidigare post om det).

**Kostnadsuppskattning, given tidigare bekräftad ~cent/möte:** en full
backfill av alla nio instanser över fyra år (uppskattningsvis 100–150+
möten totalt) landar sannolikt i storleksordningen 10–30 USD i
Anthropic-kostnad, spritt över flera manuella omgångar snarare än en
enda stor räkning.

**Verifierat:** skriptet laddar felfritt (alla imports), validerar
korrekt (avvisar okänd/obekräftad instans-slug), och testkörning mot en
riktig instans (`samhallsbyggnadsnamnden`) gick igenom hela vägen till
sandboxens förväntade nätverksbegränsning. 116/116 tester fortsatt
gröna. **INTE verifierat:** en fullständig, skarp backfill-körning i CI
— kräver att ägaren laddar upp `backfill.yml` manuellt (samma
fine-grained-PAT-begränsning som tidigare workflow-filer) och triggar en
första testomgång.

## 2026-07-22 — Diagnostikfil tillagd i backfill, pga svårighet att läsa GitHub Actions-loggar

Efter första testkörningen av backfill (5 sekunder, misstänkt 0 möten
bearbetade): flera försök att läsa den faktiska konsolutskriften
misslyckades — både via GitHub:s webbgränssnitt (svårt för ägaren att
hitta rätt klickyta i den lilla logg-panelen) och via API från min sida
(logg-nedladdning omdirigerar till en Azure blob-lagringsdomän som ligger
utanför sandboxens tillåtna nätverk, och `check-runs`-API:et gav inget
för det här repot).

Löst mer robust: `run-backfill.mjs` skriver nu ALLTID en liten
diagnostikfil (`data/backfill-log/{instans}-{tidsstämpel}.json`) med
nyckeltal (hur många möten hittades totalt, hur många i datumintervallet,
hur många redan bearbetade, vilken batch som kördes) — oavsett om
körningen faktiskt bearbetade något eller inte. Filen committas
automatiskt (redan befintlig `git status --porcelain`-logik i
`backfill.yml` fångar den som en förändring). Ger framtida felsökning en
pålitlig väg via GitHub:s contents-API, helt oberoende av att navigera
Actions-loggarnas UI eller kämpa mot nätverksbegränsningar för
logg-nedladdning.

## 2026-07-22 — KRITISKT FYND: listsidan saknar mötalänkar, påverkade även veckopipelinen

Bakgrund: första backfill-testkörningen avslutades misstänkt snabbt.
Den nya diagnostikfilen (se föregående post) avslöjade orsaken:
`totalRefsOnListingPage: 0` — den BARA listsidan
(`/committees/{slug}`, utan ett specifikt möte) innehåller INGA
mötalänkar när den hämtas programmatiskt, trots att en ENSKILD
mötessida bevisat har en fullständig sidmeny med hela historiken
(verifierat via `web_fetch` mot `mote-2026-01-28`, som visade länkar
tillbaka till 2009).

**Detta är allvarligare än bara ett backfill-problem** — `fetch.ts`s
`fetchNewMeetingsForCommittee` (som ANVÄNDS AV DEN VANLIGA
VECKOPIPELINEN) hämtar exakt samma listsides-URL. Det betyder att de
tidigare "lyckade" veckokörningarna som rapporterade "inga nya justerade
protokoll hittades" möjligen inte var genuint sanna — de kan ha
misslyckats strukturellt med att upptäcka möten överhuvudtaget, och bara
RÅKAT se likadana ut som ett äkta "inget nytt"-utfall utåt sett.

**Fixat på två ställen:**
1. `src/config.ts` — nytt valfritt fält `Committee.seedMeetingUrl`: en
   känd, fungerande mötes-URL att falla tillbaka på om listsidan ger
   noll träffar. Satt för `kommunfullmaktige`
   (`.../mote-2026-01-28`, den URL som redan bevisligen fungerar).
   **INTE satt för de övriga åtta instanserna** — inga påhittade URL:er;
   kräver antingen att en riktig sådan hittas manuellt, eller att
   veckopipelinen råkar bearbeta ett första möte för dem via backfill
   (vilket automatiskt skulle ge `data/published/arenden.json` ett
   pdf_url att härleda ett frö ifrån).
2. `src/fetch.ts` — `fetchNewMeetingsForCommittee` faller nu tillbaka på
   `committee.seedMeetingUrl` om listsidan ger noll träffar. Om INGET
   frö finns: kastar ett TYDLIGT fel ("mötesupptäckt ... strukturellt
   trasig, inte bara 'inget nytt'") istället för att tyst rapportera
   "0 nya möten" — eftersom de två situationerna (genuint inget nytt vs.
   trasig upptäckt) annars är omöjliga att skilja åt utifrån, precis det
   som hände här.
3. `scripts/run-backfill.mjs` — samma fallback, men härleder i första
   hand fröet automatiskt ur `data/published/arenden.json` (redan kända
   pdf_url:er), med ett valfritt femte CLI-/workflow-argument
   (`seed_meeting_url`) som sista utväg för instanser utan någon
   tidigare publicerad data alls.

**Två nya regressionstester** i `fetch.test.ts` bevisar både
fallback-vägen och att avsaknad av frö ger ett tydligt fel, inte en tyst
felaktig "inget nytt"-rapport. 118/118 tester gröna (upp från 116).

**Kvarstående, viktigt att göra näst:** kör en skarp veckopipeline-körning
NU (efter denna fix) för `kommunfullmaktige` och jämför mot vad som
FAKTISKT borde ha hittats sedan senaste kända mötet i den publicerade
datan (2026-03-25) — om det verkligen dykt upp nya justerade protokoll
sedan dess (t.ex. 2026-05-06, som vi VET existerar och har protokoll,
men som ALDRIG kom med i den publicerade datan) bevisar det definitivt
att tidigare veckokörningar missade riktiga möten. De åtta instanserna
utan seedMeetingUrl kommer nu larma tydligt istället för att tyst
rapportera "inget nytt" — vänta er felmeddelanden för dem tills frön
satts, inte en bugg.

## 2026-07-22 — Kostnadstak retroaktivt tillagt i veckopipelinen (nära missöde)

Direkt efter seedMeetingUrl-fixen (föregående post) triggades en skarp
veckokörning för att verifiera fixen. Innan resultatet hanns kollas
insåg jag ett verkligt hål: veckopipelinen (till skillnad från
`run-backfill.mjs`) hade INGET tak på hur många "nya" möten den fick
bearbeta per körning. Eftersom `data/seen.json` var helt tomt, och
seedMeetingUrl-fallbacken kan hitta en instans hela historik (potentiellt
över hundra möten tillbaka till 2009), fanns en verklig risk att
körningen skulle försöka bearbeta ALLA dessa i en enda, mycket lång och
kostsam körning. Försökte avbryta via API men hann inte — körningen hade
redan slutförts (på 34 sekunder, vilket i efterhand visar att inget
faktiskt bearbetades den gången: `data/seen.json` förblev `{}`).

**Ingen skada skedd denna gång, men en verklig konstruktionslucka.**
Fixat retroaktivt: `MAX_NEW_MEETINGS_PER_RUN = 15` i
`run-weekly-pipeline.mjs`, mötena sorteras äldst-först och kapas till
taket innan bearbetning påbörjas, med en tydlig varning i loggen om
kapning sker. Samma princip som redan fanns i `run-backfill.mjs`, bara
tidigare inte tillämpad på veckopipelinen eftersom risken inte fanns
förrän seedMeetingUrl-fallbacken introducerades.

**Även tillagt:** en alltid skriven diagnostikfil
(`data/weekly-run-log/{tidsstämpel}.json`) för veckopipelinen, samma
mönster som backfill — oberoende, pålitlig felsökningsväg via
GitHub:s contents-API istället för att förlita sig på Actions-loggarnas
UI (som visat sig svåra att komma åt både för ägaren och för mig).

118/118 tester fortsatt gröna.

## 2026-07-22 — GRUNDORSAK HITTAD: relativa URL:er, inte JS-rendering

Uppföljning av föregående post (kommunfullmäktige fick 0 träffar trots
satt seedMeetingUrl). Riktad diagnostik (`diagFetchProbe` i
`run-weekly-pipeline.mjs`, borttagen igen efter användning) visade:
sidan var INTE tom (146 169 tecken), och både "mote-" och
"kommunfullmaktige" förekom i den råa HTML:en — men klassen
`<html class="no-js">` ledde först till en felaktig JS-rendering-hypotes.

**Verklig orsak:** länkarna i den råa HTML:en (det en vanlig `fetch()`
faktiskt får) är RELATIVA (`/committees/kommunfullmaktige/mote-...`),
inte fullständiga URL:er med domän. Alla tre regex-baserade
extraktionsfunktioner (`extractMeetingRefs`, `extractProtocolPdfUrl` i
`fetch.ts`, `extractAgendaBilagaLinks` i `download.ts`) krävde tidigare
ett hårdkodat `https://sammantradesportal.alingsas.se`-prefix och missade
därför ALLA relativa länkar helt.

**Viktig metod-lärdom:** detta antagande hade ALDRIG genuint bevisats
mot pipelinens egen `fetch()`-kod. Varje tidigare "lyckad" testkörning av
just dessa funktioner (dokumenterat i tidigare README-poster som
"Liveresultat") kördes mot HTML hämtad via `web_fetch` (Claude:s eget
verktyg i konversationen) — som tycks normalisera relativa länkar till
absoluta vid sin HTML-till-markdown-konvertering. Det gav en falsk
trygghet: koden "fungerade" i varje tidigare test, men aldrig mot den
faktiska formen av data pipelinens egen körtidsmiljö faktiskt möter.

**Fixat:** domän-prefixet är nu VALFRITT i alla tre regex-mönster,
resultatet absolutiseras alltid innan det returneras (resten av
pipelinen, t.ex. `fetchBinary`, förutsätter fullständiga URL:er). Tre
nya regressionstester bevisar specifikt det relativa fallet.
121/121 tester gröna (upp från 118).

**Detta förklarar sannolikt HELA mönstret** av "0 nya möten"-resultat
genom hela sessionen — inte bara dagens backfill-försök, utan även de
allra första skarpa veckokörningarna tidigare idag. De var förmodligen
ALDRIG genuint "inget nytt", utan strukturellt trasiga hela tiden, ända
sedan den första skarpa driftsättningen.

## 2026-07-22 — Genombrott bekräftat i skarp drift, men avslöjade ett sorteringsfel

Skarp veckokörning EFTER den relativa URL-fixen (föregående post):
`success` efter ~28 minuter (konsekvent med att faktiskt bearbeta flera
riktiga möten). **Total framgång för själva grundfixen:** alla tio
bevakade instanser hittade nu möten — INTE bara kommunfullmäktige med
sitt seedMeetingUrl. Det bevisar att rotorsaken (relativa URL:er) var
den verkliga boven; seedMeetingUrl-fallbacken behövs numera bara om även
listsidan skulle sluta fungera av någon annan anledning.

**Siffror:** 757 "nya" möten hittade totalt över alla instanser (eftersom
`data/seen.json` var helt tomt — kommunstyrelsen ensam hade 122,
vård- och omsorgsnämnden 97, socialnämnden 94, och så vidare). Taket
(15/körning) fångade upp detta korrekt och blockerade en okontrollerad
massbearbetning.

**Ett verkligt designfel avslöjades dock:** möten sorterades äldst-först
(samma logik som redan fanns i `run-backfill.mjs`, kopierad hit utan att
tänka igenom skillnaden i syfte). Med 757 möten i kön bearbetade den
här första körningen 15 möten från JANUARI–MARS 2018 — helt fel
prioritering för en veckopipeline vars jobb är att hålla sajten AKTUELL.
Fixat: sorteringen är nu NYAST FÖRST i `run-weekly-pipeline.mjs`
specifikt (`run-backfill.mjs` behåller sin äldst-först-sortering, som är
rätt för dess syfte — kronologisk historikpåfyllning). Framtida
veckokörningar kommer nu prioritera de senaste mötena, medan den återstående
historiska luckan (2018 fram till nu, minus de 15 redan bearbetade)
lämnas kvar att fyllas på medvetet via `run-backfill.mjs` om/när ägaren
vill det — inte av misstag via veckopipelinen.

121/121 tester fortsatt gröna.

**Rekommenderat nästa steg (inte gjort än):** kör veckopipelinen en gång
till nu, med den nya nyast-först-sorteringen, för att bekräfta att den
faktiskt hämtar in de senaste mötena (t.ex. 2026-05-06 och 2026-06-10 för
kommunfullmäktige, som vi VET existerar men som ännu inte finns i
`data/published/arenden.json`).

## 2026-07-23 — Kallt arkiv-repo för rå-dokument (kostnadsfråga från ägaren)

Bakgrund: en fråga om lagringsutrymme avslöjade att rå-dokument (protokoll
+ kallelsebilagor) redan tagit 249 MB i 423 filer efter bara ~15–18
riktiga möten — extrapolerat skulle en fullständig täckning av
mandatperioden 2022–2026 sannolikt nå flera GB, och hela den kända
bakloggen (757 möten) sannolikt över 10 GB (GitHub:s egen rekommenderade
maxgräns för själva git-databasen). Ägaren frågade separat om historiska
dokument kunde rensas inför en ny mandatperiod — avrådde från faktisk
radering (skulle bryta alla redan publicerade arkivlänkar, som pekar mot
specifika commit-SHA:er) till förmån för denna lösning: nya dokument
skrivs framöver till ett SEPARAT "kallt" repo istället för att växa
huvudrepot, som checkas ut vid VARJE pipeline-körning för alltid framöver.

**Nytt repo:** `Knarrbyn/Kommundata-arkiv`, publikt, skapat av ägaren.
Ny secret `ARCHIVE_REPO_TOKEN` i `Kommundata` (samma PAT-värde som
`faktagranskaren-push`, med utökad behörighet till båda repona).

**Kodändringar:**
- `src/config.ts`: `ARCHIVE_REPO` ("Knarrbyn/Kommundata-arkiv") och
  `ARCHIVE_LOCAL_DIR` ("archive-repo", namnet på den lokala
  checkout-underkatalogen i CI).
- `src/download.ts`: `localPathsFor`/`downloadMeetingFiles` tar nu en
  valfri `baseDir`-parameter (default oförändrat `data/raw`, så
  befintliga anrop/tester fortsätter fungera exakt som förut).
- `src/archive.ts`: PENDING-markören utökad till att innehålla VILKET
  repo filen hör hemma i (`git-pending:{repo}:{relativePath}`, tidigare
  bara `git-pending:{relativePath}`) — nödvändigt eftersom huvudrepot och
  arkiv-repot får OLIKA commit-SHA:er i samma körning, två separata
  commits i två separata repon. Ny `parsePendingGitArchiveMarker`.
  `RawFileEntry` har nu ett obligatoriskt `repo`-fält.
- `scripts/run-weekly-pipeline.mjs` och `scripts/run-backfill.mjs`:
  laddar nu ner till `archive-repo/data/raw/...` (arkiv-repots lokala
  checkout) istället för `data/raw/...` i huvudrepot. `manifest.json`
  stannar kvar i huvudrepot (litet index, inga stora filer).
- `scripts/fill-archive-urls.mjs` omskriven: känner nu till BÅDA
  repornas commit-SHA:er (huvudrepots egen, plus arkiv-repots via en ny
  `ARCHIVE_REPO_SHA`-miljövariabel som workflow-filen sätter EFTER att
  arkiv-repot redan committats och pushats). Bakåtkompatibel med det
  gamla, repo-lösa markörformatet (tolkas som huvudrepot).
- `.github/workflows/weekly-pipeline.yml` och `backfill.yml`: ny
  `actions/checkout`-steg för arkiv-repot (med `ARCHIVE_REPO_TOKEN`,
  `path: archive-repo`), nytt commit+push-steg för arkiv-repot SEPARAT
  från huvudrepots commit, innan "Fyll i arkivlänkar"-steget (som nu tar
  emot arkiv-repots SHA via steg-output).
- `.gitignore`: `archive-repo/` tillagd, så huvudrepots egna
  `git status`-kontroller inte förvirras av den nästlade checkout:en.
- `src/archive-cli.ts` (det äldre, manuella enstaka-möte-verktyget) FICK
  medvetet INTE samma uppdatering — det är fortfarande huvudrepo-
  orienterat, dokumenterat i koden. Skarp drift går via
  `run-weekly-pipeline.mjs`/`run-backfill.mjs`, som båda är uppdaterade.

**Verifierat lokalt:** 121/121 tester gröna (uppdaterade tester för det
nya markörformatet + `parsePendingGitArchiveMarker`). Alla tre skript
(`run-weekly-pipeline.mjs`, `run-backfill.mjs`, `fill-archive-urls.mjs`)
laddar och kör felfritt fram till sandboxens förväntade
nätverksbegränsning. **INTE verifierat i skarp drift ännu** — kräver att
ägaren laddar upp de två workflow-filerna manuellt (samma
fine-grained-PAT-begränsning som tidigare) och att en skarp körning
faktiskt bevisar att båda repona får rätt innehåll och att arkivlänkarna
pekar rätt.

## 2026-07-23 — Kallt arkiv-repo bekräftat fungerande i skarp drift

Efter flera felsökningsvarv (empty repo utan main-gren, en secret som
aldrig faktiskt sparades trots upprepade försök) fungerar nu hela
tvårepo-uppdelningen end-to-end.

**Grundorsaker till de tre misslyckade försöken, i tur och ordning:**
1. `Kommundata-arkiv` var helt tomt (0 commits, ingen `main`-gren) —
   `actions/checkout` hade inget att checka ut. Löst genom att skapa en
   första commit (README.md) direkt via API.
2. `ARCHIVE_REPO_TOKEN` sparades aldrig faktiskt i GitHub trots att
   ägaren trodde det — bekräftat genom ett tillfälligt diagnossteg som
   skrev resultatet till en committad fil (`data/diag/archive-token-check.txt`,
   eftersom vanlig logg-läsning visat sig opålitlig både via UI och API
   under hela den här sessionen). Diagnosen visade "TOM eller helt osatt"
   två gånger i rad — även efter att ägaren trodde sig ha sparat den.
   Löst genom att gå igenom "New repository secret"-flödet extra
   noggrant, med skärmbildsbekräftelse i två steg (formulär ifyllt →
   "Repository secret added"-bekräftelse).

**Skarp verifiering, körning `29983122161` (2026-07-23):**
- Samtliga steg lyckades, inklusive de två nya (checkout + commit/push
  av arkiv-repot).
- `Kommundata-arkiv`: 397 filer, 233,64 MB riktiga dokument (bekräftat
  via git-trädet — API:ts `size`-fält visade missvisande "0 KB", troligen
  en cache-fördröjning i GitHub:s egen statistik, inte verkligheten).
- `Kommundata` (huvudrepot): `data/raw/` oförändrat på 423 filer/254 MB
  (den GAMLA datan från innan uppdelningen — inga NYA filer tillkom,
  vilket bevisar att uppdelningen fungerar: framtida tillväxt går till
  arkiv-repot, inte huvudrepot).
- `data/published/arenden.json`: 232 ärenden, 352 arkivlänkar totalt,
  **noll kvarvarande PENDING-markörer**. 212 pekar korrekt mot de gamla
  commit:arna i huvudrepot (fortsatt giltiga), 140 pekar korrekt mot nya,
  riktiga commit-pinnade länkar i `Kommundata-arkiv`.

**Städat:** det tillfälliga diagnossteget borttaget ur
`weekly-pipeline.yml` (syftet uppfyllt). `data/diag/`-filen lämnas kvar i
huvudrepots historik som spårbar dokumentation av felsökningen, men
skapas inte längre av någon aktiv kod.

**Kvarstående, medvetet inte gjort:** de 249 MB gamla dokument som redan
låg i huvudrepot INNAN uppdelningen ligger kvar där (se tidigare post om
varför en retroaktiv flytt/historikomskrivning avråddes — skulle bryta
212 redan publicerade arkivlänkar). Tillväxtproblemet är löst framåt;
den redan existerande storleken är en engångskostnad, inte ett växande
problem längre.
