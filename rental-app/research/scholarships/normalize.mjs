// Turns the workflow batch files into rental-app/scholarships-data.json.
//   node normalize.mjs <sch dir> <out json>
// Reads every <key>-<n>.json (verified + localized batches), keeps keep=true,
// canonicalizes countries, builds ids, merges duplicates (same url or same
// normalized name, plus any groups.json from the dedup judge), and attaches
// the chosen sources (sources-km.json if present, else sources.json subset).
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2], out = process.argv[3];
const LEVELS = ["highschool", "vocational", "bachelor", "master", "phd", "short", "research", "postdoc"];
const COUNTRY = [
  [/^(south )?korea|republic of korea|korea, republic|korea \(south\)/i, "South Korea"],
  [/^(usa|us|u\.s\.a?\.?|united states)/i, "United States"],
  [/^(uk|u\.k\.|united kingdom|britain|great britain|england|scotland|wales)/i, "United Kingdom"],
  [/^t(u|ü)rk/i, "Türkiye"], [/^czech/i, "Czechia"], [/^hong kong/i, "Hong Kong"], [/^maca[ou]/i, "Macau"],
  [/^taiwan|republic of china/i, "Taiwan"], [/^viet ?nam/i, "Vietnam"], [/netherlands/i, "Netherlands"],
  [/^(the )?philippines/i, "Philippines"], [/^lao/i, "Laos"], [/^myanmar|burma/i, "Myanmar"], [/^russia/i, "Russia"],
  [/^(people'?s republic of )?china|^prc/i, "China"], [/^japan/i, "Japan"], [/^cambodia$/i, "Cambodia"],
  [/^(eu|european union|europe)/i, "Europe"], [/^uae|united arab emirates/i, "United Arab Emirates"],
  [/^saudi/i, "Saudi Arabia"], [/^new zealand|^nz$/i, "New Zealand"], [/^australia/i, "Australia"],
];
const KNOWN = new Set(["Cambodia","Japan","South Korea","China","Taiwan","Thailand","Singapore","India","Brunei","Malaysia","Indonesia","Vietnam","Hong Kong","Macau","Philippines","Laos","Myanmar","Mongolia","Kazakhstan","Sri Lanka","Pakistan","Bangladesh","Nepal","Australia","New Zealand","United Kingdom","United States","Canada","Mexico","Chile","Brazil","Cuba","Germany","France","Netherlands","Belgium","Switzerland","Austria","Sweden","Norway","Finland","Denmark","Iceland","Italy","Spain","Portugal","Greece","Ireland","Hungary","Poland","Czechia","Slovakia","Romania","Bulgaria","Serbia","Slovenia","Croatia","Estonia","Latvia","Lithuania","Luxembourg","Ukraine","Georgia","Azerbaijan","Russia","Türkiye","Israel","Saudi Arabia","Qatar","United Arab Emirates","Egypt","Morocco","South Africa","Europe","Asia","Various"]);

function canonCountry(raw) {
  const s = String(raw || "").trim();
  if (!s) return { country: "Various", detail: "" };
  if (/^cambodia$/i.test(s)) return { country: "Cambodia", detail: "" };
  const multi = /various|multiple|several|worldwide|global|any country|,|\/| and | or |\+|partner/i.test(s) && !/^\w[\w ]*\(/.test(s) ? true : /various|multiple|several|worldwide|global/i.test(s);
  if (multi) {
    if (/^europe/i.test(s) || /\b(eu|erasmus)\b/i.test(s)) return { country: "Europe", detail: s };
    return { country: "Various", detail: s };
  }
  const base = s.replace(/\s*\(.*\)$/, "").trim();
  for (const [re, name] of COUNTRY) if (re.test(base)) return { country: name, detail: base !== name ? s : "" };
  if (KNOWN.has(base)) return { country: base, detail: base !== s ? s : "" };
  return { country: base, detail: s !== base ? s : "" };
}
const slug = (s) => String(s).toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
const normName = (s) => String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const normUrl = (u) => String(u || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
const str = (v) => (v == null ? "" : String(v)).trim();
const month = (v) => { const n = parseInt(v, 10); return n >= 1 && n <= 12 ? n : 0; };

const files = readdirSync(dir).filter(f => /^[a-z-]+-\d+\.json$/.test(f)).sort();
let raw = [];
for (const f of files) {
  let j; try { j = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch (e) { console.error("bad json", f, e.message); continue; }
  const entries = Array.isArray(j) ? j : (j.entries || []);
  const cat = f.replace(/-\d+\.json$/, "");
  for (const e of entries) if (e && e.keep !== false && e.name) raw.push(Object.assign({ category: cat, _file: f }, e));
}
console.error(`read ${raw.length} kept entries from ${files.length} files`);

const list = raw.map(e => {
  const c = canonCountry(e.host_country);
  const levels = (e.levels || []).filter(l => LEVELS.includes(l));
  return {
    id: "", name: str(e.name), name_km: str(e.name_km), provider: str(e.provider), provider_km: str(e.provider_km),
    host_country: c.country, host_detail: c.detail, abroad: c.country !== "Cambodia",
    levels, fields: str(e.fields), fields_km: str(e.fields_km),
    funding: ["full", "partial", "varies"].includes(e.funding) ? e.funding : "varies",
    covers: (e.covers || []).map(str).filter(Boolean), covers_km: str(e.covers_km),
    eligibility: str(e.eligibility), eligibility_km: str(e.eligibility_km),
    cambodia_note: str(e.cambodia_note), cambodia_km: str(e.cambodia_km),
    deadline_note: str(e.deadline_note), deadline_km: str(e.deadline_km),
    open_month: month(e.open_month), close_month: month(e.close_month),
    next_deadline: /^\d{4}-\d{2}-\d{2}$/.test(str(e.next_deadline)) ? str(e.next_deadline) : "",
    url: str(e.url), apply_url: str(e.apply_url), language_req: str(e.language_req), language_km: str(e.language_km),
    summary_km: str(e.summary_km), summary_en: str(e.summary_en),
    source_urls: Array.from(new Set((e.source_urls || []).map(str).filter(Boolean))),
    confidence: Math.max(0, Math.min(1, Number(e.confidence) || 0)),
    category: e.category, also_known_as: [],
  };
}).filter(e => e.name && e.url);

// If an exact deadline without a close month is known, derive the month so
// the calendar and the sort still work next year.
for (const e of list) if (e.next_deadline && !e.close_month) e.close_month = parseInt(e.next_deadline.slice(5, 7), 10);

// ---- merge duplicates ----
function merge(keep, o) {
  if (o.confidence > keep.confidence) { const k2 = Object.assign({}, o); Object.assign(o, keep); Object.assign(keep, k2); }
  for (const k of Object.keys(keep)) if ((keep[k] === "" || (Array.isArray(keep[k]) && !keep[k].length)) && o[k] && !(Array.isArray(o[k]) && !o[k].length)) keep[k] = o[k];
  keep.source_urls = Array.from(new Set(keep.source_urls.concat(o.source_urls, [o.url])));
  if (normName(o.name) !== normName(keep.name)) keep.also_known_as = Array.from(new Set(keep.also_known_as.concat(o.also_known_as, [o.name])));
  keep.levels = Array.from(new Set(keep.levels.concat(o.levels)));
  if (!keep.next_deadline && o.next_deadline) keep.next_deadline = o.next_deadline;
}
const groups = existsSync(join(dir, "groups.json")) ? JSON.parse(readFileSync(join(dir, "groups.json"), "utf8")).groups || [] : [];
const byName = new Map(), byUrl = new Map(), dead = new Set();
for (const g of groups) { // indexes refer to the sorted-by-name interim list written last time
  const names = g.filter(n => typeof n === "string");
  const found = names.map(n => list.find(e => e.name === n)).filter(Boolean);
  for (const o of found.slice(1)) { if (!dead.has(o)) { merge(found[0], o); dead.add(o); } }
}
for (const e of list) {
  if (dead.has(e)) continue;
  const kn = normName(e.name), ku = normUrl(e.url);
  const prev = byName.get(kn) || (ku && byUrl.get(ku));
  if (prev && prev !== e) { merge(prev, e); dead.add(e); continue; }
  byName.set(kn, e); if (ku) byUrl.set(ku, e);
}
let final = list.filter(e => !dead.has(e)).sort((a, b) => a.name.localeCompare(b.name));
const ids = new Set();
for (const e of final) { let id = slug(e.name) || "program", n = 2; while (ids.has(id)) id = slug(e.name) + "-" + n++; ids.add(id); e.id = id; delete e.category; }
console.error(`merged ${list.length} -> ${final.length}`);

// ---- sources ----
let sources = [];
if (existsSync(join(dir, "sources-km.json"))) sources = JSON.parse(readFileSync(join(dir, "sources-km.json"), "utf8")).sources || [];
else if (existsSync(join(dir, "sources-pick.json"))) sources = JSON.parse(readFileSync(join(dir, "sources-pick.json"), "utf8")).sources || [];

const stats = { total: final.length, abroad: final.filter(e => e.abroad).length, domestic: final.filter(e => !e.abroad).length,
  exact: final.filter(e => e.next_deadline).length, full: final.filter(e => e.funding === "full").length,
  missing_km: final.filter(e => !e.name_km || !e.summary_km).length, countries: new Set(final.map(e => e.host_country)).size };
console.error(JSON.stringify(stats));
writeFileSync(out, JSON.stringify({ verified: "2026-09", generated_from: files.length + " batches", scholarships: final, sources }, null, 1));
console.error("wrote " + out);
