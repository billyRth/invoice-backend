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
import { spawn, spawnSync } from "node:child_process";

const SUPA = "https://nreazrayjskpgyeeznda.supabase.co";
const SHIM = "http://127.0.0.1:54321";

// A fresh database for every run. Without this the suite quietly stops testing
// what it says: three runs each filing one no-answer report on the same
// listing is three distinct reporters, so the app pauses it - correctly - and
// the later assertions fail for a reason that has nothing to do with the code
// under test.
const MIGRATIONS = ["0001_init", "0002_payments", "0004_lock_down_functions",
                    "0005_districts", "0006_district_centres", "0007_null_uid_guards",
                    "0008_default_privileges", "0009_signals_and_telegram",
                    "0011_lock_new_functions"];

function psql(args, opts = {}) {
  const r = spawnSync("psql", ["-q", "-v", "ON_ERROR_STOP=1", ...args], {
    env: { ...process.env, PGHOST: process.env.PGHOST || "/tmp",
           PGPORT: process.env.PGPORT || "5433", PGUSER: process.env.PGUSER || "pg" },
    encoding: "utf8", ...opts,
  });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error("psql failed: " + (r.stderr || r.stdout));
  }
  return r;
}

const root = new URL("../../", import.meta.url).pathname;
psql(["-d", "postgres", "-c", "drop database if exists ptas_app"], { allowFail: true });
psql(["-d", "postgres", "-c", "create database ptas_app"]);
psql(["-d", "ptas_app", "-f", root + "supabase/tests/00-local-shim.sql"]);
for (const m of MIGRATIONS) psql(["-d", "ptas_app", "-f", `${root}supabase/migrations/${m}.sql`]);
psql(["-d", "ptas_app", "-f", root + "supabase/seed.sql"]);
psql(["-d", "ptas_app", "-c",
      "insert into receiving_accounts (version, display_name, bank, qr_path, is_active, activated_at) " +
      "values (1,'PTAS / TEST','ABA','v1.png',true,now())"]);

// The shim is started here rather than by hand, so one command runs the suite
// and nothing is left listening afterwards.
const shim = spawn(process.execPath, [new URL("postgrest-shim.mjs", import.meta.url).pathname],
  { stdio: ["ignore", "pipe", "inherit"] });
process.on("exit", () => shim.kill());
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("shim did not start")), 10000);
  shim.stdout.on("data", d => {
    if (String(d).includes("shim on")) { clearTimeout(timer); resolve(); }
  });
  shim.on("exit", c => reject(new Error("shim exited with " + c)));
});
let pass = 0, fail = 0;

// A fresh phone number per run. The free fortnight is once per landlord ever,
// so reusing one number makes every run after the first a different test than
// the one that was written.
let seq = 0;
const newPhone = () => "012 " + String(700000 + Date.now() % 90000 + (seq++)).slice(0, 6);
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

  // Compared against what the server actually returns, not a fixed number:
  // the database accumulates listings as these tests post them.
  const served = await page.evaluate(async () => {
    const r = await fetch("https://nreazrayjskpgyeeznda.supabase.co/rest/v1/rpc/search_listings",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p_limit: 60 }) });
    return (await r.json()).length;
  });
  const count = await page.$eval("#result-count", e => e.textContent);
  ok("result count matches the server", count.includes(String(served)), count + " vs " + served);

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

console.log("\n== a landlord posts, and it reaches the feed ==");
{
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });

  // Sign in. The shim accepts 000000 and hands back an identity; every query
  // after this runs as that user under the real policies.
  await page.evaluate(() => document.getElementById("gate").hidden = false);
  await page.fill("#gate-phone", newPhone());
  await page.click("#gate-continue");
  await page.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  ok("signing in reaches the role step", true);
  const devNote = await page.$eval("#gate-devnote", e => ({ hidden: e.hidden, text: e.textContent }));
  ok("and the gate admits the number is not checked yet",
     !devNote.hidden && devNote.text.trim().length > 0, JSON.stringify(devNote));
  await page.click('.rolecard[data-role="landlord"]');
  await page.waitForTimeout(600);

  // Post a room.
  await page.click("#post-start");
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById("new-addphoto").click());
  await page.waitForTimeout(200);

  // Offline the button stands in a placeholder; connected it opens a picker,
  // so the file is handed over directly.
  await page.setInputFiles("#new-files", {
    name: "room.jpg", mimeType: "image/jpeg",
    buffer: Buffer.from("ffd8ffdb0000", "hex")
  });
  await page.waitForTimeout(300);
  await page.click("#new-next");
  await page.waitForTimeout(300);

  const TITLE = "បន្ទប់សាកល្បង " + Date.now();
  await page.fill("#new-title", TITLE);
  await page.selectOption("#new-district", "sensok");
  await page.fill("#new-area", "ក្បែរផ្សារ");
  await page.click("#new-next");
  await page.waitForTimeout(300);
  await page.fill("#new-rent", "175");
  await page.click("#new-next");
  await page.waitForTimeout(300);
  await page.click("#new-next");                 // publish
  await page.waitForTimeout(1800);

  const mine = await page.textContent("#my-listings");
  ok("the new listing is on the landlord's own list", mine.includes(TITLE), mine.slice(0, 120));
  const pill = await page.$eval("#my-listings .pill", e => e.className);
  ok("and it started on the free fortnight", /\btrial\b/.test(pill), pill);

  // A renter, signed out, must be able to find it.
  const { ctx: ctx2, page: page2 } = await open();
  await page2.waitForSelector(".card", { timeout: 8000 });
  const feed = await page2.$$eval(".card-title", els => els.map(e => e.textContent));
  const server = await page2.evaluate(async () => {
    const r = await fetch("https://nreazrayjskpgyeeznda.supabase.co/rest/v1/rpc/search_listings",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p_limit: 60 }) });
    return (await r.json()).map(x => x.title);
  });
  ok("a renter sees it in the feed", feed.includes(TITLE),
     "cards=" + feed.length + " server=" + server.length + " serverHas=" + server.includes(TITLE));
  await ctx2.close();

  await ctx.close();
}

console.log("\n== the dollar ==");
{
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });
  await page.evaluate(() => document.getElementById("gate").hidden = false);
  await page.fill("#gate-phone", newPhone());
  await page.click("#gate-continue");
  await page.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  await page.click('.rolecard[data-role="landlord"]');
  await page.waitForTimeout(600);

  // Post, then take the trial away, so paying is the only way through. That is
  // the state every landlord reaches on their second listing.
  await page.click("#post-start");
  await page.waitForTimeout(400);
  await page.setInputFiles("#new-files", {
    name: "b.jpg", mimeType: "image/jpeg", buffer: Buffer.from("ffd8ffdb0000", "hex")
  });
  await page.waitForTimeout(200);
  await page.click("#new-next"); await page.waitForTimeout(250);
  const T2 = "បន្ទប់ទីពីរ " + Date.now();
  await page.fill("#new-title", T2);
  await page.selectOption("#new-district", "toulkork");
  await page.fill("#new-area", "ក្បែរវិទ្យាល័យ");
  await page.click("#new-next"); await page.waitForTimeout(250);
  await page.fill("#new-rent", "200");
  await page.click("#new-next"); await page.waitForTimeout(250);
  await page.click("#new-next");
  await page.waitForTimeout(1800);

  // Second listing: the fortnight is spent, so the payment sheet opens itself.
  await page.click("#post-start");
  await page.waitForTimeout(400);
  await page.setInputFiles("#new-files", {
    name: "c.jpg", mimeType: "image/jpeg", buffer: Buffer.from("ffd8ffdb0000", "hex")
  });
  await page.waitForTimeout(200);
  await page.click("#new-next"); await page.waitForTimeout(250);
  const T3 = "បន្ទប់ទីបី " + Date.now();
  await page.fill("#new-title", T3);
  await page.selectOption("#new-district", "meanchey");
  await page.fill("#new-area", "ក្បែរផ្លូវ");
  await page.click("#new-next"); await page.waitForTimeout(250);
  await page.fill("#new-rent", "150");
  await page.click("#new-next"); await page.waitForTimeout(250);
  await page.click("#new-next");
  await page.waitForTimeout(2000);

  const sheetOpen = await page.$eval("#pay-sheet", e => !e.hidden);
  ok("with the fortnight spent, the second listing asks for the dollar", sheetOpen);

  await page.waitForFunction(
    () => document.getElementById("pay-code").textContent.trim() !== "\u2014",
    null, { timeout: 6000 }
  ).catch(() => {});
  const code = await page.textContent("#pay-code");
  const payErr = await page.textContent("#pay-error");
  ok("and it carries a transfer code to quote", /^P-[A-Z0-9]{6}$/.test(code.trim()),
     JSON.stringify({ code, payErr }));

  // A receipt is required: the whole check is a person matching it to a code.
  await page.click("#pay-send");
  await page.waitForTimeout(300);
  const err = await page.textContent("#pay-error");
  ok("sending without a receipt is refused", err.trim().length > 0, err);

  await page.setInputFiles("#pay-proof", {
    name: "receipt.jpg", mimeType: "image/jpeg", buffer: Buffer.from("ffd8ffdb0000", "hex")
  });
  await page.click("#pay-send");
  await page.waitForFunction(() => !document.getElementById("pay-state").hidden,
    null, { timeout: 6000 }).catch(() => {});
  const state = await page.$eval("#pay-state", e => ({ hidden: e.hidden, text: e.textContent }));
  ok("with one, it says it is waiting to be checked", !state.hidden && state.text.length > 0,
     JSON.stringify(state));

  // Still invisible: nobody has approved anything.
  const { ctx: ctx3, page: page3 } = await open();
  await page3.waitForSelector(".card", { timeout: 8000 });
  const feed3 = await page3.$$eval(".card-title", els => els.map(e => e.textContent));
  ok("an unpaid listing stays out of the feed", !feed3.includes(T3));
  await ctx3.close();

  await ctx.close();
}

console.log("\n== the two report reasons weigh differently ==");
{
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });
  await page.evaluate(() => document.getElementById("gate").hidden = false);
  await page.fill("#gate-phone", newPhone());
  await page.click("#gate-continue");
  await page.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  await page.click('.rolecard[data-role="renter"]');
  await page.waitForTimeout(500);

  await page.click(".card");
  await page.waitForTimeout(700);
  const title = await page.textContent("#d-title").catch(() => null);
  ok("both reasons are offered", await page.isVisible("#d-report") && await page.isVisible("#d-noanswer"));

  await page.click("#d-noanswer");
  await page.waitForTimeout(900);
  const stillUp = await page.$eval("#s-detail", e => !e.hidden);
  ok("one unanswered call does not pause anything", stillUp);

  await ctx.close();
}

console.log("\n== watching a search ==");
{
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });
  await page.evaluate(() => document.getElementById("gate").hidden = false);
  await page.fill("#gate-phone", newPhone());
  await page.click("#gate-continue");
  await page.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  await page.click('.rolecard[data-role="renter"]');
  await page.waitForTimeout(600);

  // Filter down to nothing, which is exactly when somebody wants telling.
  await page.click("#open-filters");
  await page.waitForTimeout(400);
  await page.$eval("#f-price", el => {
    el.value = "80";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click("#f-apply");
  await page.waitForTimeout(700);

  const emptyShown = await page.isVisible("#watch-this");
  ok("the offer appears when nothing matched", emptyShown);

  await page.click("#watch-this");
  await page.waitForTimeout(1000);

  // It should be listed under Saved, described by its own filters.
  await page.click('.tab[data-tab="s-saved"]');
  await page.waitForTimeout(500);
  const watch = await page.textContent("#watch-list");
  ok("the saved search is listed", watch.trim().length > 0, watch.slice(0, 80));
  ok("and is named after what it looks for", /\$8?0|\$\d/.test(watch), watch.slice(0, 80));

  await ctx.close();
}

console.log("\n== the approvals queue is only for admins ==");
{
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });
  await page.evaluate(() => document.getElementById("gate").hidden = false);
  await page.fill("#gate-phone", newPhone());
  await page.click("#gate-continue");
  await page.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  await page.click('.rolecard[data-role="renter"]');
  await page.waitForTimeout(900);

  await page.click('.tab[data-tab="s-me"]').catch(() => {});
  await page.waitForTimeout(500);
  const adminHidden = await page.$eval("#admin-panel", e => e.hidden);
  ok("an ordinary person never sees it", adminHidden);
  ok("but everyone is offered Telegram", await page.isVisible("#tg-connect"));

  await ctx.close();
}

await browser.close();
site.close();
shim.kill();
console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
