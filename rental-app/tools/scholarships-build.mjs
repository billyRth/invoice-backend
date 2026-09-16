// Refreshes the JSON block inside scholarships.html from scholarships-data.json.
// The page is one file with no build step; this is the one thing that edits it.
//   node rental-app/tools/scholarships-build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, "..", "scholarships.html");
const dataFile = join(here, "..", "scholarships-data.json");

const data = JSON.parse(readFileSync(dataFile, "utf8"));
// A "<" inside a JSON string could spell "</script>" and end the block early,
// so every "<" becomes \u003c, which JSON.parse turns back into "<".
const json = JSON.stringify(data).replace(/</g, "\\u003c");

const html = readFileSync(page, "utf8");
const re = /(<script id="sch-data" type="application\/json">)[\s\S]*?(<\/script>)/;
if (!re.test(html)) throw new Error("no sch-data block in " + page);
writeFileSync(page, html.replace(re, (_, a, b) => a + json + b));
console.log(`injected ${data.scholarships.length} programs, ${data.sources.length} sources into ${page}`);
