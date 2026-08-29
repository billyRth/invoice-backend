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

const SUPA = "https://eycfpacmwderetosrsss.supabase.co";
const SHIM = "http://127.0.0.1:54321";

// A fresh database for every run. Without this the suite quietly stops testing
// what it says: three runs each filing one no-answer report on the same
// listing is three distinct reporters, so the app pauses it - correctly - and
// the later assertions fail for a reason that has nothing to do with the code
// under test.
const MIGRATIONS = ["0001_init", "0002_payments", "0004_lock_down_functions",
                    "0005_districts", "0006_district_centres", "0007_null_uid_guards",
                    "0008_default_privileges", "0009_signals_and_telegram",
                    "0011_lock_new_functions", "0012_lock_the_locker",
                    "0013_payment_messages", "0014_record_tenancy",
                    "0015_tenant_sees_the_room"];

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
// A shim left running from an interrupted run still holds connections, and
// DROP DATABASE fails while they exist - quietly, because the drop tolerates
// failure, so the create then fails with a confusing "already exists".
psql(["-d", "postgres", "-c",
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'ptas_app'"],
     { allowFail: true });
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

async function open({ offline = false, seedSession = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Each context has its own localStorage, so a session has to be planted
  // before the page script runs rather than written into a previous context
  // and hoped for.
  if (seedSession) {
    await ctx.addInitScript(v => {
      localStorage.setItem("ptas-session", JSON.stringify(v));
    }, seedSession);
  }
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
  // Browsing needs no account, so a test starts the way a first-time renter
  // does: past the gate, signed out. A seeded session is already past it, and
  // there is nothing to click.
  if (await page.isVisible("#gate-browse")) await page.click("#gate-browse");
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
    const r = await fetch("https://eycfpacmwderetosrsss.supabase.co/rest/v1/rpc/search_listings",
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
    const r = await fetch("https://eycfpacmwderetosrsss.supabase.co/rest/v1/rpc/search_listings",
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

console.log("\n== recording a tenancy takes the room off the market ==");
{
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });
  await page.evaluate(() => document.getElementById("gate").hidden = false);
  await page.fill("#gate-phone", newPhone());
  await page.click("#gate-continue");
  await page.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  await page.click('.rolecard[data-role="landlord"]');
  await page.waitForTimeout(600);

  // Post a room, then rent it out.
  await page.click("#post-start");
  await page.waitForTimeout(400);
  await page.setInputFiles("#new-files", {
    name: "r.jpg", mimeType: "image/jpeg", buffer: Buffer.from("ffd8ffdb0000", "hex")
  });
  await page.waitForTimeout(200);
  await page.click("#new-next"); await page.waitForTimeout(250);
  const T = "បន្ទប់ជួលហើយ " + Date.now();
  await page.fill("#new-title", T);
  await page.selectOption("#new-district", "daunpenh");
  await page.fill("#new-area", "ក្បែរវត្ត");
  await page.click("#new-next"); await page.waitForTimeout(250);
  await page.fill("#new-rent", "190");
  await page.click("#new-next"); await page.waitForTimeout(250);
  await page.click("#new-next");
  await page.waitForTimeout(1800);

  // It is live, so a renter can see it.
  const { ctx: c1, page: p1 } = await open();
  await p1.waitForSelector(".card", { timeout: 8000 });
  const before = await p1.$$eval(".card-title", els => els.map(e => e.textContent));
  ok("the new room is on the market", before.includes(T));
  await c1.close();

  // Record the tenancy from the landlord's own listing.
  await page.click(`#my-listings .myrow`);
  await page.waitForTimeout(300);
  const openedRecord = await page.evaluate((title) => {
    const rows = [...document.querySelectorAll("#my-listings .myrow")];
    const row = rows.find(r => r.textContent.includes(title));
    if (!row) return false;
    const btn = [...row.querySelectorAll("button")]
      .find(b => b.hasAttribute("data-rented"));
    if (!btn) return false;
    btn.click();
    return true;
  }, T);
  ok("the landlord can mark it rented", openedRecord);
  await page.waitForTimeout(1500);

  // And now no renter can find it, because the database flipped it.
  const { ctx: c2, page: p2 } = await open();
  await p2.waitForSelector(".card", { timeout: 8000 });
  const after = await p2.$$eval(".card-title", els => els.map(e => e.textContent));
  ok("a rented room leaves the market", !after.includes(T),
     after.filter(x => x === T).length + " still showing");
  await c2.close();

  await ctx.close();
}

console.log("\n== the tenant sees the record too ==");
{
  // The renter signs in first, so an account exists for their number to match.
  const tenantPhone = newPhone();
  const { ctx: rc, page: rp } = await open();
  await rp.waitForSelector(".card", { timeout: 8000 });
  await rp.evaluate(() => document.getElementById("gate").hidden = false);
  await rp.fill("#gate-phone", tenantPhone);
  await rp.click("#gate-continue");
  await rp.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  await rp.click('.rolecard[data-role="renter"]');
  await rp.waitForTimeout(600);
  await rc.close();

  // A landlord posts a room and records the tenancy against that number.
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });
  await page.evaluate(() => document.getElementById("gate").hidden = false);
  await page.fill("#gate-phone", newPhone());
  await page.click("#gate-continue");
  await page.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  await page.click('.rolecard[data-role="landlord"]');
  await page.waitForTimeout(600);

  await page.click("#post-start");
  await page.waitForTimeout(400);
  await page.setInputFiles("#new-files", {
    name: "t.jpg", mimeType: "image/jpeg", buffer: Buffer.from("ffd8ffdb0000", "hex")
  });
  await page.waitForTimeout(200);
  await page.click("#new-next"); await page.waitForTimeout(250);
  const T = "បន្ទប់មានអ្នកជួល " + Date.now();
  await page.fill("#new-title", T);
  await page.selectOption("#new-district", "chamkarmon");
  await page.fill("#new-area", "ក្បែរផ្សារ");
  await page.click("#new-next"); await page.waitForTimeout(250);
  await page.fill("#new-rent", "230");
  await page.click("#new-next"); await page.waitForTimeout(250);
  await page.click("#new-next");
  await page.waitForTimeout(1800);

  // Open it from the feed and record the tenancy.
  await page.click('.tab[data-tab="s-explore"]');
  await page.waitForTimeout(600);
  const opened = await page.evaluate((title) => {
    const card = [...document.querySelectorAll(".card")]
      .find(c => c.textContent.includes(title));
    if (!card) return false;
    card.click();
    return true;
  }, T);
  ok("the landlord can open their own listing", opened);
  await page.waitForTimeout(800);

  await page.click("#d-agree");
  await page.waitForTimeout(500);
  await page.fill("#rec-name", "Sokha");
  await page.fill("#rec-phone", tenantPhone);
  await page.click("#rec-save");
  await page.waitForTimeout(1600);
  await ctx.close();

  // The renter opens the app again and finds it waiting.
  const { ctx: rc2, page: rp2 } = await open();
  await rp2.waitForSelector(".card", { timeout: 8000 });
  await rp2.evaluate(() => document.getElementById("gate").hidden = false);
  await rp2.fill("#gate-phone", tenantPhone);
  await rp2.click("#gate-continue");
  await rp2.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  await rp2.click('.rolecard[data-role="renter"]');
  await rp2.waitForTimeout(1800);

  await rp2.click('.tab[data-tab-slot="third"]');
  await rp2.waitForTimeout(600);
  const panelShown = await rp2.$eval("#tenancy-panel", e => !e.hidden).catch(() => false);
  const body = await rp2.textContent("#tenancy-body").catch(() => "");
  ok("the renter's own screen shows the tenancy", panelShown, "panel hidden");
  ok("named after the room they moved into", body.includes(T), body.slice(0, 90));
  await rc2.close();
}

console.log("\n== a shortlist survives closing the app ==");
{
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });
  const phone = newPhone();
  await page.evaluate(() => document.getElementById("gate").hidden = false);
  await page.fill("#gate-phone", phone);
  await page.click("#gate-continue");
  await page.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  await page.click('.rolecard[data-role="renter"]');
  await page.waitForTimeout(700);

  const saved = await page.$eval(".card .savebtn, .card [aria-label*='ave'], .card button",
    el => { el.click(); return true; }).catch(() => false);
  ok("a listing can be saved", saved);
  await page.waitForTimeout(900);
  const savedTitle = await page.$eval("#saved-feed .card-title", e => e.textContent).catch(() => null);
  await ctx.close();

  // Same person, fresh app.
  const { ctx: c2, page: p2 } = await open();
  await p2.waitForSelector(".card", { timeout: 8000 });
  await p2.evaluate(() => document.getElementById("gate").hidden = false);
  await p2.fill("#gate-phone", phone);
  await p2.click("#gate-continue");
  await p2.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  await p2.click('.rolecard[data-role="renter"]');
  await p2.waitForTimeout(1500);
  const back = await p2.$eval("#saved-feed .card-title", e => e.textContent).catch(() => null);
  ok("and it is still there when they come back", back !== null && back === savedTitle,
     JSON.stringify({ savedTitle, back }));
  await c2.close();
}

console.log("\n== an expired session recovers instead of breaking ==");
{
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });
  const phone = newPhone();
  await page.evaluate(() => document.getElementById("gate").hidden = false);
  await page.fill("#gate-phone", phone);
  await page.click("#gate-continue");
  await page.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  await page.click('.rolecard[data-role="landlord"]');
  await page.waitForTimeout(800);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ptas-session")));
  ok("the refresh token is kept, not just the access token",
     !!stored.refresh, JSON.stringify(Object.keys(stored)));
  await ctx.close();

  // Age the access token the way an hour would, keeping the refresh token.
  const aged = { ...stored, token: "expired-" + stored.token, expiresAt: Date.now() - 1000 };
  const { ctx: c2, page: p2 } = await open({ seedSession: aged });
  await p2.waitForSelector(".card", { timeout: 8000 });
  ok("the feed still loads with a dead token", (await p2.$$(".card")).length > 0);

  await p2.waitForTimeout(1500);
  const after = await p2.evaluate(() => {
    const raw = localStorage.getItem("ptas-session");
    return raw ? JSON.parse(raw) : null;
  });
  ok("and the session was refreshed rather than dropped",
     after && after.token && !String(after.token).startsWith("expired-"),
     JSON.stringify(after && after.token));

  // Still signed in: a write must work without going back through the gate.
  await p2.click('.tab[data-tab-slot="third"]');
  await p2.waitForTimeout(500);
  const gateUp = await p2.$eval("#gate", e => !e.hidden);
  ok("the landlord is still signed in", !gateUp);
  await c2.close();
}

console.log("\n== a session with no refresh token signs out cleanly ==");
{
  const { ctx, page } = await open();
  await page.waitForSelector(".card", { timeout: 8000 });
  await page.evaluate(() => document.getElementById("gate").hidden = false);
  await page.fill("#gate-phone", newPhone());
  await page.click("#gate-continue");
  await page.waitForSelector("#gate-step-role:not([hidden])", { timeout: 8000 });
  await page.click('.rolecard[data-role="renter"]');
  await page.waitForTimeout(800);

  // What a session stored by the previous version of this app looks like:
  // an access token, no refresh token, and an hour gone by.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ptas-session")));
  await ctx.close();

  const legacy = { ...stored, token: "expired-" + stored.token, expiresAt: Date.now() - 1000 };
  delete legacy.refresh;
  const { ctx: c2, page: p2 } = await open({ seedSession: legacy });
  await p2.waitForSelector(".card", { timeout: 8000 });
  ok("browsing still works", (await p2.$$(".card")).length > 0);
  const note = await p2.$eval("#data-note", e => e.hidden);
  ok("and it is not reported as an outage", note);
  await c2.close();
}

await browser.close();
site.close();
shim.kill();
console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
