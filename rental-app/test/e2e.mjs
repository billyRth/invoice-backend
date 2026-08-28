/* Drives the real ptas.html against the real schema.
 *
 * The file is not modified: requests to the Supabase host are intercepted and
 * forwarded to the local shim, which runs them against a Postgres carrying the
 * actual migrations and the actual RLS policies. So "the app shows this" here
 * means the app would show it in production too.
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";

const SUPA = "https://nreazrayjskpgyeeznda.supabase.co";
const SHIM = "http://127.0.0.1:54321";
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? "  -> " + detail : "")); }
};

// Serve the app so it has a real origin.
const page_src = fs.readFileSync(new URL("../ptas.html", import.meta.url));
const site = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page_src);
}).listen(8099);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function open({ offline = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route(SUPA + "/**", async (route) => {
    if (offline) return route.abort("failed");
    const req = route.request();
    const target = SHIM + new URL(req.url()).pathname + new URL(req.url()).search;
    const res = await fetch(target, {
      method: req.method(),
      headers: req.headers(),
      body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postData()
    });
    route.fulfill({
      status: res.status,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      body: await res.text()
    });
  });
  // Photo placeholders are blocked in this container; they are not under test.
  await page.route("https://picsum.photos/**", r => r.abort());
  await page.goto("http://127.0.0.1:8099/", { waitUntil: "domcontentloaded" });
  // Browsing needs no account, so every test starts the way a first-time
  // renter does: past the gate, signed out.
  await page.click("#gate-browse");
  return { ctx, page };
}

console.log("\n== connected to the database ==");
{
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });

  const titles = await page.$$eval(".card-title", els => els.map(e => e.textContent.trim()));
  ok("feed renders cards", titles.length > 0, titles.length + " cards");
  ok("cards are the database rows, not the built-in array",
     titles.some(t => t.includes("វិទ្យាស្ថានបច្ចេកវិទ្យា")), titles.slice(0, 2).join(" / "));
  ok("paused listing is absent", !titles.some(t => t.includes("ទួលសង្កែ")));
  ok("trial listing is present", titles.some(t => t.includes("បន្ទប់និស្សិត")));

  const noteHidden = await page.$eval("#data-note", e => e.hidden);
  ok("no offline note when the server answered", noteHidden);

  const count = await page.$eval("#result-count", e => e.textContent);
  ok("result count matches the server", /10/.test(count), count);

  // The rule the whole product rests on.
  await ctx.close();
}

console.log("\n== the district vocabulary ==");
{
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });
  const km = await page.$$eval(".card", els => els.map(e => e.textContent));
  ok("Khmer district name shows by default", km.some(t => t.includes("ទួលគោក")));
  await page.click('button[data-lang="en"]');
  await page.waitForTimeout(400);
  const en = await page.$$eval(".card", els => els.map(e => e.textContent));
  ok("English district name after switching", en.some(t => t.includes("Toul Kork")), en[0]?.slice(0, 80));
  ok("the landlord's own words are not translated",
     en.some(t => t.includes("បន្ទប់ស្ទូឌីយោ")), "title should stay Khmer");
  await ctx.close();
}

console.log("\n== the server is unreachable ==");
{
  const { ctx, page } = await open({ offline: true });
  await page.waitForSelector(".card", { timeout: 8000 });
  const note = await page.$eval("#data-note", e => ({ hidden: e.hidden, text: e.textContent }));
  ok("the app still shows listings", (await page.$$(".card")).length > 0);
  ok("and says they are samples", !note.hidden && note.text.length > 0, JSON.stringify(note));
  await ctx.close();
}

console.log("\n== detail view on a real row ==");
{
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });
  await page.click(".card");
  await page.waitForTimeout(700);
  const body = await page.textContent("#s-detail");
  ok("the detail shows the row's own title", /វិទ្យាស្ថានបច្ចេកវិទ្យា/.test(body));
  ok("and its district", /ទួលគោក/.test(body));

  // The contact is the listing's own, not the account holder's: the schema
  // denormalises it precisely so an agent or a relative can be the contact.
  const who = await page.textContent("#d-landlord");
  ok("the listing's own contact name is shown", who.trim() === "Nou Sokhem", who);

  const href = await page.getAttribute("#d-call", "href");
  ok("Call is a real tel: link to the number in the database",
     href === "tel:012839330", href);
  await ctx.close();
}

await browser.close();
site.close();
console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
