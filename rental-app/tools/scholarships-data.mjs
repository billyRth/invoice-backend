/* Builds rental-app/scholarships-data.json out of the research folder.
 *
 *   node rental-app/tools/scholarships-data.mjs
 *   node rental-app/tools/scholarships-build.mjs      # injects it into the page
 *
 * Inputs, all under rental-app/research/scholarships/:
 *   merged.json       every program the researchers found, already deduplicated
 *   km-*.json         Khmer copy, matched back onto a program by its exact name
 *   sources-km.json   the places students look, in Khmer and English
 *
 * What this adds on top of the raw research: one spelling per country (so the
 * flags and the country filter work), a stable id per program, a close month
 * derived from an exact deadline, and the field order the page reads.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const research = join(here, "..", "research", "scholarships");
const out = join(here, "..", "scholarships-data.json");

const LEVELS = ["highschool", "vocational", "bachelor", "master", "phd", "short", "research", "postdoc"];

/* The page's COUNTRIES table is the list of names that get a Khmer label and a
   flag. Anything else would show up as raw English with a globe, so the
   researchers' spellings are folded into it here. */
const ALIAS = [
  [/^(south )?korea|republic of korea|korea,? (republic|south)/i, "South Korea"],
  [/^(usa|u\.?s\.?a?\.?|united states)/i, "United States"],
  [/^(uk|u\.?k\.?|united kingdom|britain|great britain|england|scotland|wales)/i, "United Kingdom"],
  [/^t(u|ü)rk/i, "Türkiye"],
  [/^czech/i, "Czechia"],
  [/^hong ?kong/i, "Hong Kong"],
  [/^maca[ou]/i, "Macau"],
  [/^taiwan|republic of china/i, "Taiwan"],
  [/^viet ?nam/i, "Vietnam"],
  [/^(the )?netherlands|holland/i, "Netherlands"],
  [/^(the )?philippines/i, "Philippines"],
  [/^lao/i, "Laos"],
  [/^myanmar|burma/i, "Myanmar"],
  [/^russia/i, "Russia"],
  [/^(people'?s republic of )?china$|^prc$/i, "China"],
  [/^uae|united arab emirates/i, "United Arab Emirates"],
  [/^saudi/i, "Saudi Arabia"],
  [/^new ?zealand|^nz$/i, "New Zealand"],
  [/^(the )?eu$|^european union|^europe$/i, "Europe"],
];
const KNOWN = new Set(["Cambodia", "Japan", "South Korea", "China", "Taiwan", "Thailand", "Singapore", "India", "Brunei",
  "Malaysia", "Indonesia", "Vietnam", "Hong Kong", "Macau", "Philippines", "Laos", "Myanmar", "Mongolia", "Kazakhstan",
  "Sri Lanka", "Pakistan", "Bangladesh", "Nepal", "Australia", "New Zealand", "United Kingdom", "United States", "Canada",
  "Mexico", "Chile", "Brazil", "Cuba", "Germany", "France", "Netherlands", "Belgium", "Switzerland", "Austria", "Sweden",
  "Norway", "Finland", "Denmark", "Iceland", "Italy", "Spain", "Portugal", "Greece", "Ireland", "Hungary", "Poland",
  "Czechia", "Slovakia", "Romania", "Bulgaria", "Serbia", "Slovenia", "Croatia", "Estonia", "Latvia", "Lithuania",
  "Luxembourg", "Ukraine", "Georgia", "Azerbaijan", "Russia", "Türkiye", "Israel", "Saudi Arabia", "Qatar",
  "United Arab Emirates", "Egypt", "Morocco", "South Africa", "Europe", "Asia", "Various"]);

function country(raw) {
  const s = String(raw || "").trim();
  if (!s) return { country: "Various", detail: "" };
  /* "Various (Philippines, Thailand, ...)" and friends: one card cannot sit
     under one flag, so it goes under Various and keeps the full text for the
     detail sheet. */
  if (/various|multiple|several|worldwide|global|any country/i.test(s)) {
    if (/^europe|erasmus/i.test(s)) return { country: "Europe", detail: s };
    return { country: "Various", detail: s };
  }
  const base = s.replace(/\s*\(.*\)\s*$/, "").trim();
  for (const [re, name] of ALIAS) if (re.test(base)) return { country: name, detail: base === name ? "" : s };
  if (KNOWN.has(base)) return { country: base, detail: base === s ? "" : s };
  return { country: base, detail: base === s ? "" : s };
}

const str = (v) => (v == null ? "" : String(v)).trim();
const month = (v) => { const n = parseInt(v, 10); return n >= 1 && n <= 12 ? n : 0; };
const slug = (s) => String(s).toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
const key = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/* ---- Khmer copy, matched back on by name ---- */
const km = new Map();
for (const f of readdirSync(research).filter((f) => /^km-\d+[ab]?\.json$/.test(f)).sort()) {
  let j;
  try { j = JSON.parse(readFileSync(join(research, f), "utf8")); }
  catch (e) { console.error(`skipped ${f}: ${e.message}`); continue; }
  for (const e of (j.entries || [])) if (e && e.name) km.set(key(e.name), e);
}

const raw = JSON.parse(readFileSync(join(research, "merged.json"), "utf8"));
const seen = new Set();
let matched = 0;

const scholarships = raw.map((e) => {
  const extra = km.get(key(e.name));
  if (extra) matched++;
  const c = country(e.host_country);
  const m = Object.assign({}, e, extra || {});

  let id = slug(m.name) || "program";
  for (let n = 2; seen.has(id); n++) id = `${slug(m.name)}-${n}`;
  seen.add(id);

  const next = /^\d{4}-\d{2}-\d{2}$/.test(str(m.next_deadline)) ? str(m.next_deadline) : "";
  let close = month(m.close_month);
  /* A published date implies the month it closes, which is what the calendar
     falls back on once that date is past. */
  if (next && !close) close = parseInt(next.slice(5, 7), 10);

  return {
    id,
    name: str(m.name), name_km: str(m.name_km),
    provider: str(m.provider), provider_km: str(m.provider_km),
    host_country: c.country, host_detail: c.detail, abroad: c.country !== "Cambodia",
    levels: (m.levels || []).filter((l) => LEVELS.includes(l)),
    fields: str(m.fields), fields_km: str(m.fields_km),
    funding: ["full", "partial", "varies"].includes(m.funding) ? m.funding : "varies",
    covers: (m.covers || []).map(str).filter(Boolean), covers_km: str(m.covers_km),
    eligibility: str(m.eligibility), eligibility_km: str(m.eligibility_km),
    cambodia_note: str(m.cambodia_note), cambodia_km: str(m.cambodia_km),
    deadline_note: str(m.deadline_note), deadline_km: str(m.deadline_km),
    open_month: month(m.open_month), close_month: close, next_deadline: next,
    url: str(m.url), apply_url: str(m.apply_url),
    language_req: str(m.language_req), language_km: str(m.language_km),
    summary_km: str(m.summary_km), summary_en: str(m.summary_en),
    also_known_as: Array.from(new Set(m.also_known_as || [])),
    confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0)),
  };
}).filter((e) => e.name && e.url);

/* ---- sources ---- */
let sources = [];
const srcFile = existsSync(join(research, "sources-km.json")) ? "sources-km.json" : "sources-pick.json";
if (existsSync(join(research, srcFile))) {
  sources = (JSON.parse(readFileSync(join(research, srcFile), "utf8")).sources || []).map((s) => ({
    name: str(s.name), name_km: str(s.name_km), url: str(s.url),
    what: str(s.what), what_km: str(s.what_km),
    official: !!s.official, channel: str(s.channel), language: str(s.language),
  })).filter((s) => s.name && s.url);
}

writeFileSync(out, JSON.stringify({ verified: "2026-09", scholarships, sources }, null, 1));

const missing = scholarships.filter((e) => !e.name_km || !e.summary_km);
console.log(`${scholarships.length} programs, ${matched} with Khmer copy attached, ${missing.length} still missing it`);
console.log(`  ${scholarships.filter((e) => !e.abroad).length} in Cambodia, ${scholarships.filter((e) => e.abroad).length} abroad, ` +
  `${new Set(scholarships.map((e) => e.host_country)).size} countries`);
console.log(`  ${scholarships.filter((e) => e.next_deadline).length} with an exact date, ` +
  `${scholarships.filter((e) => e.funding === "full").length} fully funded`);
console.log(`  ${sources.length} sources from ${srcFile}`);
if (missing.length) console.log("  missing Khmer: " + missing.slice(0, 8).map((e) => e.name).join("; "));
console.log(`wrote ${out}`);
