/* Drives rental-app/pteas-next.html in a real browser.
 *
 *   node rental-app/test/next.mjs
 *   CHROME_PATH=/path/to/chrome node rental-app/test/next.mjs
 *
 * The page has no backend, so this is the whole test: open it at the widths
 * people actually hold, work every control, and fail on a console error, a
 * filter that lies, a tap target under 44px, text below AA contrast, or
 * anything that pushes the page sideways.
 */
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = pathToFileURL(resolve(root, "rental-app/pteas-next.html")).href;

let chromium;
for (const pkg of ["playwright", "playwright-core"]) {
  try { ({ chromium } = await import(pkg)); break; } catch {}
}
if (!chromium) { console.error("no playwright. npm i -D playwright"); process.exit(1); }

const launch = {};
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
let browser;
try { browser = await chromium.launch(launch); }
catch { console.error("no browser found. Install one, or point CHROME_PATH at chrome."); process.exit(1); }

let pass = 0, fail = 0;
const ok = (n, d = "") => { pass++; console.log(`  ok   ${n}${d ? "  (" + d + ")" : ""}`); };
const no = (n, d = "") => { fail++; console.log(`  FAIL ${n}${d ? "  (" + d + ")" : ""}`); };
const is = (c, n, d) => (c ? ok(n, d) : no(n, d));
const head = (n) => console.log(`\n== ${n} ==`);

/* contrast, the same maths the WCAG formula uses */
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/* Chrome hands back color-mix() results as "color(srgb 0.96 0.96 0.96 / .86)",
   where the channels are 0-1 floats, not 0-255. Reading those as bytes makes
   a near-white surface look black and every label on it fail. */
const rgb = (s) => {
  const n = (s.match(/-?\d*\.?\d+/g) || []).map(Number);
  if (/^color\(/.test(s)) return n.slice(0, 3).map((v) => Math.round(v * 255));
  return n.slice(0, 3);
};

const WIDTHS = [
  ["iPhone SE", 320, 568, true],
  ["iPhone 15", 393, 852, true],
  ["tablet", 768, 1024, false],
  ["laptop", 1024, 768, false],
  ["desktop", 1440, 900, false],
];

const errs = [];
for (const [name, width, height, mobile] of WIDTHS) {
  head(`${name} · ${width}x${height}`);
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(`${name}: ${e.message}`));
  p.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !/font|ERR_|favicon|picsum|net::/i.test(t)) errs.push(`${name}: ${t}`);
  });
  await p.goto(PAGE);
  await p.waitForTimeout(700);

  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  is(over <= 1, "nothing pushes the page sideways", `${over}px`);

  const rows = await p.locator(".row").count();
  is(rows === 11, "every sample room is listed", `${rows}`);

  /* the two-pane layout only exists above 900 */
  const twoPane = await p.evaluate(() => getComputedStyle(document.querySelector(".app")).gridTemplateColumns.split(" ").length);
  if (width >= 900) is(twoPane === 3, "three panes on a wide screen", `${twoPane} columns`);
  else is(twoPane === 1, "one column on a handset", `${twoPane} column`);

  const tabbar = await p.evaluate(() => getComputedStyle(document.querySelector(".tabbar")).display);
  if (width >= 900) is(tabbar === "none", "no tab bar on a wide screen");
  else is(tabbar !== "none", "tab bar on a handset");

  /* anything you tap has to be reachable with a thumb */
  const small = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll("button, a[href], input, select").forEach((el) => {
      if (!el.offsetParent && el.offsetHeight === 0) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.height < 44 || r.width < 40) out.push(`${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return out;
  });
  if (mobile) is(small.length === 0, "every control is thumb sized", small.slice(0, 3).join(", ") || "clean");
  else ok("pointer sized controls", "not a touch width");

  /* AA on real rendered pairs, both themes */
  for (const theme of ["light", "dark"]) {
    await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await p.waitForTimeout(160);
    const bad = await p.evaluate(() => {
      const out = [];
      const solid = (el) => {
        let n = el;
        while (n && n !== document.documentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
          n = n.parentElement;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      document.querySelectorAll("p,span,b,h1,h2,h3,dt,dd,button,a,output,li").forEach((el) => {
        const txt = (el.childNodes.length && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
        if (!txt) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const cs = getComputedStyle(el);
        out.push({ t: el.textContent.trim().slice(0, 14), fg: cs.color, bg: solid(el), size: parseFloat(cs.fontSize), w: cs.fontWeight });
      });
      return out;
    });
    const fails = bad.filter((s) => {
      const large = s.size >= 24 || (s.size >= 18.66 && Number(s.w) >= 700);
      return ratio(rgb(s.fg), rgb(s.bg)) < (large ? 3 : 4.5) - 0.01;
    });
    is(fails.length === 0, `${theme} text meets AA`,
       fails.slice(0, 2).map((f) => `"${f.t}" ${ratio(rgb(f.fg), rgb(f.bg)).toFixed(2)}:1`).join(" · ") || "clean");
  }
  await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));

  await ctx.close();
}

/* behaviour, once, on a phone */
head("it actually works");
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push("behaviour: " + e.message));
await p.goto(PAGE);
await p.waitForTimeout(700);

const countOf = async () => Number((await p.locator("#count b").innerText()).trim());
is((await countOf()) === 11, "the count matches the list");

/* freshness is the default sort, so the top room is the most recently confirmed */
const firstFresh = await p.locator(".row").first().evaluate((el) => el.querySelector(".fresh").className);
is(/\bnow\b/.test(firstFresh), "the freshest room sorts to the top", firstFresh.replace("fresh ", ""));

await p.locator("#open-filters").click();
await p.waitForTimeout(600);
const fo = p.locator('#sheet-filters .opt[data-f="fresh"][data-v="3"]');
await fo.scrollIntoViewIfNeeded();
await fo.click();
await p.waitForTimeout(350);
const after = await countOf();
is(after > 0 && after < 11, "the freshness filter actually narrows the list", `11 -> ${after}`);
const allFresh = await p.locator(".row .fresh").evaluateAll((els) => els.every((e) => /now|week/.test(e.className)));
is(allFresh, "and nothing stale survives it");

await p.locator("#sheet-reset").click();
await p.waitForTimeout(350);
is((await countOf()) === 11, "clearing the filters restores every room");
await p.locator("#sheet-close").click();
await p.waitForTimeout(500);

await p.fill("#q", "toul kork");
await p.waitForTimeout(350);
const searched = await countOf();
is(searched > 0 && searched < 11, "search narrows the list", `${searched} left`);
await p.locator("#q-clear").click();
await p.waitForTimeout(300);
is((await countOf()) === 11, "clearing the search restores it");

await p.selectOption("#sort", "cheap");
await p.waitForTimeout(350);
const prices = await p.locator(".row .price").evaluateAll((els) => els.map((e) => Number(e.textContent.replace("$", ""))));
is(prices.every((v, i, a) => i === 0 || a[i - 1] <= v), "cheapest-first really is sorted", prices.slice(0, 4).join(" · "));
await p.selectOption("#sort", "fresh");
await p.waitForTimeout(300);

await p.locator(".row-hit").first().click();
await p.waitForTimeout(700);
is(await p.locator("#detail").isVisible(), "a room opens");
is((await p.locator(".dtitle").innerText()).length > 4, "the room has a title", (await p.locator(".dtitle").innerText()).slice(0, 26));
const tel = await p.locator("#d-call").getAttribute("href");
is(/^tel:\d+/.test(tel), "the call button dials a real number", tel);
const total = await p.locator(".costs .total dd").innerText();
is(/^\$\d+$/.test(total), "move-in cost is worked out", total);
is(/#/.test(await p.evaluate(() => location.hash)), "the room is deep linkable", await p.evaluate(() => location.hash));

await p.locator("#d-save").click();
await p.waitForTimeout(350);
is((await p.locator("#d-save").getAttribute("aria-pressed")) === "true", "saving a room sticks");
await p.locator("#detail-back").click();
await p.waitForTimeout(600);
is(!(await p.locator("#detail").isVisible()), "and back closes it");

await p.locator('.tab[data-tab="saved"]').click();
await p.waitForTimeout(400);
is((await p.locator(".row").count()) === 1, "the saved tab shows only what was saved");
await p.locator('.tab[data-tab="browse"]').click();
await p.waitForTimeout(400);

await p.locator('[data-lang="en"]').click();
await p.waitForTimeout(450);
is((await p.locator("#count").innerText()).includes("rooms"), "the language switch reaches the results",
   (await p.locator("#count").innerText()).trim());
is((await p.locator(".row-title").first().innerText()).charCodeAt(0) < 0x1780, "and the rooms themselves");
await p.locator('[data-lang="km"]').click();
await p.waitForTimeout(400);

/* the empty state has to say something useful, not show a blank list */
await p.fill("#q", "zzzzzz");
await p.waitForTimeout(350);
is(await p.locator("#empty").isVisible(), "an impossible search shows the empty state");
await p.locator("#empty-reset").click();
await p.waitForTimeout(350);
is((await countOf()) === 11, "and its reset button works");

head("errors");
is(errs.length === 0, "no console or page errors", errs.slice(0, 3).join(" | ") || "clean");

console.log(`\n${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail ? 1 : 0);
