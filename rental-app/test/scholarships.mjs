/* Drives rental-app/scholarships.html in a real browser.
 *
 *   node rental-app/test/scholarships.mjs            # pass/fail summary
 *   SHOT=some/dir node rental-app/test/scholarships.mjs   # also write screenshots
 *
 * The page has no backend, so this is the whole test: open the file, click
 * every control a student would touch, and fail on a console error, an empty
 * screen, a filter that returns nothing it should, or anything that sticks out
 * past the right edge of a phone.
 *
 * It borrows whichever browser the machine already has (Playwright's own, or
 * an installed Chrome or Edge) so nobody has to download 150MB to run it.
 */
import { existsSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = pathToFileURL(resolve(root, "rental-app/scholarships.html")).href;
const SHOT = process.env.SHOT ? resolve(process.env.SHOT) : null;
if (SHOT) mkdirSync(SHOT, { recursive: true });

let chromium;
for (const pkg of ["playwright", "playwright-core"]) {
  try { ({ chromium } = await import(pkg)); break } catch { /* try the next one */ }
}
if (!chromium) {
  console.error("needs playwright or playwright-core: npm install --no-save playwright-core");
  process.exit(2);
}

/* Playwright's bundled Chromium if it was downloaded, otherwise a browser the
   machine already has. */
const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
/* executablePath() answers with a path whether or not the download ever
   happened, so the only honest test is whether the file is there. */
let own = null;
try { own = chromium.executablePath() } catch { /* playwright-core has none */ }
const launch = own && existsSync(own) ? {} : { executablePath: CANDIDATES.find((p) => existsSync(p)) };
if ("executablePath" in launch && !launch.executablePath) {
  console.error("no browser found. Install one, or point CHROME_PATH at chrome.exe");
  process.exit(2);
}

const fails = [];
const notes = [];
const check = (name, ok, detail) => {
  (ok ? notes : fails).push(`${ok ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : "  (" + detail + ")"}`);
};

const browser = await chromium.launch(launch);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
page.on("console", (m) => {
  /* Fonts and icons are fetched over the network; their failure is not the
     page's bug and must not be able to fail this test offline. */
  if (m.type() === "error" && !/Failed to load resource|favicon|fonts\./.test(m.text())) consoleErrors.push(m.text());
});
const shot = (n) => (SHOT ? page.screenshot({ path: `${SHOT}/${n}.png` }) : Promise.resolve());
const count = (sel) => page.locator(sel).count();

await page.goto(PAGE);
await page.waitForTimeout(900);

const data = await page.evaluate(() => JSON.parse(document.getElementById("sch-data").textContent));
check("data block parses", Array.isArray(data.scholarships) && data.scholarships.length > 0, `${data.scholarships.length} programs`);
check("every program has a link", data.scholarships.every((e) => /^https?:\/\//.test(e.url)));
check("every program has an id", new Set(data.scholarships.map((e) => e.id)).size === data.scholarships.length);

const shown = await count("#list .card");
check("browse lists every program", shown === data.scholarships.length, `${shown} cards`);
await shot("01-browse");

/* detail sheet */
await page.locator("#list .card [data-open]").first().click();
await page.waitForTimeout(500);
check("detail opens", (await page.locator("#d-title").innerText()).length > 0);
check("detail has facts", (await count("#d-body .kv > div")) >= 3);
check("official link points out", /^https?:\/\//.test(await page.locator("#d-link").getAttribute("href")));
await shot("02-detail");
await page.locator("#d-save").click();
await page.waitForTimeout(250);
check("saving marks the tab", (await page.locator("#saved-dot").innerText()) === "1");
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

/* filters */
await page.locator('[data-where="kh"]').click();
await page.waitForTimeout(350);
const inKh = await count("#list .card");
check("in-Cambodia filter", inKh > 0 && inKh < shown, `${inKh} cards`);
await page.locator("#reset").click();
await page.waitForTimeout(300);

await page.locator("#open-country").click();
await page.waitForTimeout(500);
const countries = await count("#country-seg button");
check("country picker is populated", countries > 5, `${countries} options`);
await shot("03-countries");
const hasJapan = await count('#country-seg [data-country="Japan"]');
if (hasJapan) {
  await page.locator('#country-seg [data-country="Japan"]').click();
  await page.waitForTimeout(500);
  const jp = await count("#list .card");
  check("country filter", jp > 0 && jp < shown, `Japan: ${jp}`);
} else {
  await page.keyboard.press("Escape");
}
await page.waitForTimeout(400);
await page.locator("#reset").click();
await page.waitForTimeout(300);

if (await count('#levels [data-level="master"]')) {
  await page.locator('#levels [data-level="master"]').click();
  await page.waitForTimeout(350);
  const ms = await count("#list .card");
  check("level filter", ms > 0 && ms < shown, `master's: ${ms}`);
  await page.locator("#chip-full").click();
  await page.waitForTimeout(350);
  check("funding filter narrows further", (await count("#list .card")) <= ms);
  await page.locator("#reset").click();
  await page.waitForTimeout(300);
}

await page.locator("#chip-soon").click();
await page.waitForTimeout(350);
const soon = await count("#list .card");
check("closing-soon filter", soon < shown, `${soon} cards`);
const emptyOk = soon > 0 || (await page.locator("#browse-empty").isVisible());
check("empty state appears when nothing matches", emptyOk);
await page.locator("#reset").click();
await page.waitForTimeout(300);

/* search in both languages */
await page.fill("#q", "ជប៉ុន");
await page.waitForTimeout(400);
check("Khmer search", (await count("#list .card")) > 0);
await page.fill("#q", "scholarship");
await page.waitForTimeout(400);
check("English search", (await count("#list .card")) > 0);
await page.fill("#q", "zzzzqqq");
await page.waitForTimeout(400);
check("no-match shows the empty state", await page.locator("#browse-empty").isVisible());
await page.locator("#q-clear").click();
await page.waitForTimeout(300);
check("clearing search restores the list", (await count("#list .card")) === shown);

/* calendar */
await page.locator('[data-tab="s-cal"]').click();
await page.waitForTimeout(600);
check("calendar shows 12 months", (await count("#cal .month")) >= 12);
const rows = await count("#cal .row");
check("calendar lists programs", rows > 0, `${rows} rows`);
await shot("04-calendar");
await page.locator("#cal .row").first().click();
await page.waitForTimeout(500);
check("calendar row opens the detail", (await page.locator("#d-title").innerText()).length > 0);
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

/* saved and guide */
await page.locator('[data-tab="s-saved"]').click();
await page.waitForTimeout(400);
check("saved list keeps the saved program", (await count("#saved-list .card")) === 1);
await page.locator('[data-tab="s-guide"]').click();
await page.waitForTimeout(400);
check("guide has the steps", (await count("#steps .step")) === 5);
check("guide lists official sources", (await count("#sources .src")) > 0);
check("guide separates community pages", (await count("#sources-community .src")) > 0);
await shot("05-guide");

/* language and theme */
await page.locator('[data-tab="s-browse"]').click();
await page.waitForTimeout(300);
/* Compare a card that actually has Khmer: a program still awaiting its
   translation renders its English name in both languages, which would make
   this pass or fail on the luck of the sort order. */
const translated = data.scholarships.find((e) => e.name_km && e.name_km !== e.name);
check("some program has Khmer copy", !!translated);
const kmTitle = translated
  ? await page.locator(`[data-open="${translated.id}"] .card-title`).innerText()
  : null;
const kmTabs = await page.locator('[data-tab="s-cal"] span').first().innerText();
await page.locator('[data-lang="en"]').click();
await page.waitForTimeout(500);
check("English page says so", (await page.evaluate(() => document.documentElement.lang)) === "en");
check("language switch changes the chrome", kmTabs !== (await page.locator('[data-tab="s-cal"] span').first().innerText()));
if (translated) {
  const enTitle = await page.locator(`[data-open="${translated.id}"] .card-title`).innerText();
  check("language switch changes the programs", kmTitle !== enTitle, `${kmTitle.slice(0, 24)} / ${enTitle.slice(0, 24)}`);
}
const noKm = data.scholarships.filter((e) => !e.name_km || !e.summary_km);
check("every program has Khmer copy", noKm.length === 0, `${noKm.length} still English-only`);
await shot("06-english");
await page.locator('[data-lang="km"]').click();
await page.waitForTimeout(400);

await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await page.waitForTimeout(400);
await shot("07-dark");
const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check("dark theme repaints", darkBg !== "rgb(247, 245, 242)", darkBg);
await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
await page.waitForTimeout(300);

/* nothing may stick out past the right edge on a phone */
const wide = await page.evaluate(() => {
  const limit = document.documentElement.clientWidth + 1;
  return [...document.querySelectorAll(".screen:not([hidden]) *")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= limit) return false;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden") return false;
      }
      return true;
    })
    .slice(0, 6)
    .map((el) => (el.className || el.tagName) + " @" + Math.round(el.getBoundingClientRect().right));
});
check("nothing overflows the phone width", wide.length === 0, wide.join(", ") || "clean");

/* deep link */
const target = data.scholarships[Math.min(3, data.scholarships.length - 1)];
await page.goto(PAGE + "#" + target.id);
await page.waitForTimeout(800);
const deep = await page.locator("#d-title").innerText();
check("deep link opens that program", deep.length > 0, deep.slice(0, 40));

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | ") || "clean");

await browser.close();

for (const line of notes) console.log(line);
for (const line of fails) console.log(line);
console.log(`\n${notes.length} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
