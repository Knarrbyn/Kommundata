/**
 * build.ts — pipeline §5, steg 9.
 *
 * ANDRA VERSIONEN. Den första versionen av den här modulen (byggd innan
 * `templates/site.html` var känd att existera) renderade en helt egen,
 * nydesignad sajt. Det var fel utgångspunkt: prototypen som README:t
 * beskrev (`faktagranskaren.html`, med "verifieringsstämpel"-designen,
 * `/parti/[kod]`-sidor och en filterrad per initiativtyp) fanns hela
 * tiden — bara i en tidigare chattsession, inte i det som lämnades över
 * till den här. Se DECISION_LOG.md för hela turen.
 *
 * Den här versionen gör vad README alltid sa att build-steget skulle
 * göra: läser `templates/site.html` (en kopia av den riktiga prototypen,
 * med den hårdkodade testdata-arrayen ersatt av EN platshållarmarkör,
 * `__ARENDEN_JSON__`) och injicerar den faktiska publicerade datan i
 * dess ställe. Allt annat i mallen — CSS, typsnittsval, alla
 * renderingsfunktioner (renderStep, renderCard, viewArende, viewParti,
 * viewMetod, viewOm, router) — är orört, det är prototypens egen kod.
 */

import { readFile } from "node:fs/promises";
import type { PublishedArende } from "./link.ts";

const PLACEHOLDER = "__ARENDEN_JSON__";
const DEFAULT_TEMPLATE_PATH = new URL("../templates/site.html", import.meta.url);

/**
 * Gör en JSON-sträng säker att klistra in i ett inline <script>-block.
 * Två saker att skydda mot:
 * 1. En sträng i datan som råkar innehålla "</script" skulle annars
 *    avsluta scriptblocket i förtid när webbläsaren parsar HTML:en —
 *    JSON.stringify escapar INTE detta åt oss.
 * 2. U+2028/U+2029 (LINE SEPARATOR/PARAGRAPH SEPARATOR) är giltiga i
 *    JSON-strängar men ogiltiga rått i en JS-strängliteral i äldre
 *    tolkningslägen — escapas defensivt även om moderna motorer klarar det.
 */
export function escapeForInlineScript(json: string): string {
  return json
    .replace(/<\/(script)/gi, "<\\/$1")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Injicerar ärendedatan i mallens platshållare. Ren funktion — tar
 * mallens rådata som sträng snarare än att läsa filen själv, så den går
 * att enhetstesta utan filsystem och kan återanvändas om mallen någon
 * gång läses från en annan plats.
 *
 * Kastar ett tydligt fel om platshållaren saknas, istället för att tyst
 * skriva en fil som ser ut att fungera men som fortfarande visar
 * mallens gamla, hårdkodade testärenden — en lätt att missa bugg annars.
 */
export function injectArendenData(templateHtml: string, arenden: PublishedArende[]): string {
  if (!templateHtml.includes(PLACEHOLDER)) {
    throw new Error(
      `Platshållaren "${PLACEHOLDER}" hittades inte i mallen. Har templates/site.html ändrats så att ` +
        `markören försvunnit eller döpts om? build.ts måste uppdateras i så fall.`
    );
  }
  const json = escapeForInlineScript(JSON.stringify(arenden));
  return templateHtml.replace(PLACEHOLDER, json);
}

/**
 * Läser den faktiska mallfilen och renderar hela sidan. Det här är vad
 * build-cli.ts anropar. `templatePath` kan override:as (används av
 * testerna för att peka på en isolerad testfixtur om det behövs, annars
 * pekar den på den riktiga `templates/site.html`).
 */
export async function renderSite(
  arenden: PublishedArende[],
  templatePath: string | URL = DEFAULT_TEMPLATE_PATH
): Promise<string> {
  const templateHtml = await readFile(templatePath, "utf-8");
  return injectArendenData(templateHtml, arenden);
}
