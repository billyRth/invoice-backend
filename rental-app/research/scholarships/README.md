# Scholarship research (September 2026)

Working files behind `rental-app/scholarships.html`, kept so the work can
continue from any machine.

- `merged.json` — 169 programs found by nine category researchers, deduplicated.
  Entries with `name_km` already have Khmer copy; the rest still need it.
- `need-0..5.json` — the batches still waiting for Khmer copy; `km-N.json` is
  the answer file for batch N (same order, same `name`).
- `sources.json` / `sources-pick.json` — where Cambodian students find
  scholarships (66 found, 27 chosen for the page), with notes on how they search.
- `names.json` — Khmer app-name candidates from three angles and a judged shortlist.
- `normalize.mjs` — turns batch files into `rental-app/scholarships-data.json`
  (run it, then `node rental-app/tools/scholarships-build.mjs` to inject).

Caveat: official scholarship sites could not be opened from the research
environment (network policy), so details come from search results and must be
checked on the official page before anyone relies on a deadline.
