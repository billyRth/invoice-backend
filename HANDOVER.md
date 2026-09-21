# Handover: Pteas and the scholarships page

Written 21 September 2026 so the work can continue on any machine. Everything
below lives on the branch `claude/new-session-0zohhs` of
`github.com/billyRth/invoice-backend`; nothing important is anywhere else.
(`main` still holds the old invoice/BOQ service that gave the repo its name.)

## 1. Moving to a new computer (do this first)

```
npm install -g @anthropic-ai/claude-code
git clone https://github.com/billyRth/invoice-backend.git
cd invoice-backend
git checkout claude/new-session-0zohhs
claude --teleport session_01Rmb3aKa2egsnn1pErSHCHH
```

`claude --teleport` must be typed in the plain terminal, inside the repo
folder, not inside a running Claude session. It loads the whole conversation
history and checks out the branch. Sign in with the same claude.ai account.
If it cannot find the session, run `claude --teleport` with no id and pick it
from the list, or just run `claude` and say "read HANDOVER.md and continue".

Then, once per machine, the plugins (user scope, so every project gets them):

```
/plugin marketplace add multica-ai/andrej-karpathy-skills
/plugin install andrej-karpathy-skills@karpathy-skills
/plugin marketplace add thedotmack/claude-mem
/plugin install claude-mem@thedotmack
```

Optional tools that are not plugins: `uv tool install graphifyy && graphify install`
(a `/graphify` skill), `npm install -g omniroute` (a model gateway; only if you
want Claude Code routed through other providers), `pip install headroom-ai`
then `headroom wrap claude` (compresses tool output to save usage; it can cap
the context window, see its issue #1158).

Local dev needs Node 20+ and, for the browser tests, either Playwright's
browser (`npx playwright install chromium`) or `CHROME_PATH` pointing at an
installed Chrome/Edge.

## 2. What exists

### Pteas, the rental app (live)

* `rental-app/pteas.html`: the whole client in one file, no build step. Khmer
  first, EN toggle, light/dark/Khmer themes, installable (manifest + `sw.js`).
* Live at https://pteas.onrender.com (Render static site, publish dir
  `rental-app`, build step copies `pteas.html` to `index.html`).
* Backend: Supabase project `pteas`, ref `eycfpacmwderetosrsss`, region
  Singapore, in your own org "thi org". 16 migrations in `supabase/migrations`,
  three edge functions in `supabase/functions` (`dev-signin`,
  `telegram-webhook`, `notify`), seed data in `supabase/seed.sql`.
  `supabase/README.md` is the operating manual (make yourself admin, add a
  receiving account, approve payments, switch on Telegram).
* Business rules are in the database, not the page: a listing is visible only
  while paid (14-day free trial once per landlord, then $1/month by KHQR,
  approved by hand), recording a tenancy takes the room off the market, stale
  listings sink, two "already rented" or three "no answer" reports pause it.
* Sign-in is deliberately fake for the friends-only test (`PTEAS.devAuth =
  true`): a phone number is taken at its word. Real OTP (Twilio) is a later
  step, before strangers can post.
* Tests: `npm run test:app` (Playwright against a local Postgres that mirrors
  the schema, 51 checks), `npm run audit:app` (contrast, tap targets,
  overflow), `npm run test:db` (SQL rules, 67 checks). See
  `rental-app/test/README.md`.

### The scholarships page (live, waiting for your verdict)

* `rental-app/scholarships.html`, served at
  https://pteas.onrender.com/scholarships.html. Same shell and tokens as
  Pteas so it can be folded in later. Browse with search, place / country /
  level / fully-funded / closing-soon filters, a 12-month deadline calendar,
  a saved list (on the phone), a how-to-apply guide with a scam warning, and
  the 27 official and community places Cambodian students actually look.
* Data: 169 programs (36 in Cambodia, 133 abroad, 35 countries, 113 fully
  funded, 21 with an exact next deadline), every one with Khmer copy.
* How it is built: `npm run build:scholarships` runs
  `rental-app/tools/scholarships-data.mjs` (research folder -> `scholarships-data.json`)
  then `rental-app/tools/scholarships-build.mjs` (injects the JSON into the
  page). `npm run test:scholarships` drives the page in a browser, 35 checks.
* Research folder `rental-app/research/scholarships/`: `merged.json` (every
  program found, deduplicated), `km-*.json` (Khmer copy, matched by exact
  `name`), `sources*.json`, `names.json` (the app-name study), and a README.
* Share card for Telegram/Facebook: `share-scholarships.png`.

**Caveat that matters.** The research machine could not open most official
scholarship sites (network policy), so the entries come from web search
results, not from reading each official page. Deadlines are "usually month X"
unless a date was published. The page says so on every card. Before you
promote it, spot-check the programs you care about against their official
pages; a local session can do this properly because it has normal internet.

### The name question

You asked for a Khmer word that markets better than "Pteas" for a broader
student app. The study is in `rental-app/research/scholarships/names.json`.
Its verdict: keep Pteas as the name of the rentals product, pick an umbrella
name for the company/app. Top three: **Ponlok** (ពន្លក, sprout), **Spean**
(ស្ពាន, bridge), **Cheh** (ចេះ, to know how). Before choosing: say them to five
friends aged 18-25, check .com/.com.kh, Facebook page names and the Ministry
of Commerce trademark register. The conflicts listed in the file were found
without live web access, so treat them as a starting point.

## 3. Things only you can do (still open)

1. Open https://pteas.onrender.com on your phone and use it. Nobody has yet.
2. Supabase dashboard -> Edge Functions -> Secrets -> add `ADMIN_PIN`, then run
   the "make admin" SQL from `supabase/README.md` with your number.
3. Render -> Account Settings -> GitHub -> disconnect and reconnect, then
   re-authorise `invoice-backend`. Until then pushes do not auto-deploy; a
   deploy has to be triggered by hand (Render dashboard "Manual deploy", or
   Claude via the Render tools).
4. Later: Telegram bot token + webhook secret + `PTEAS_APP_URL` secrets, the
   vault `service_key`, and `PTEAS_BOT` in `pteas.html` to switch on alerts;
   a real KHQR image and `receiving_accounts` row so payments can be approved.
5. Your brother should delete the old `ptas` project from his Supabase org.
   The unused default project in Tokyo in your org can be deleted too.

## 4. Sensible next steps for the app

* Decide on the scholarships page. If yes: add a tab to Pteas that opens it
  (or merge it in), and move the data into a Supabase `scholarships` table so
  deadlines can be edited without a deploy.
* Verify and refresh the scholarship deadlines from official pages (the local
  machine can fetch them; the research container could not).
* Real photos for listings (deferred on purpose for the friends-only test).
* Real sign-in (Twilio OTP, `PTEAS.devAuth = false`) before opening to strangers.
* Pick the umbrella name; then rename in `pteas.html` head, manifest, share
  cards and the Render service URL.

## 5. Working conventions

* One branch, `claude/new-session-0zohhs`; commit and push often, Render does
  not need anything else once the webhook is fixed.
* Two Claude sessions on the same branch will collide; pull before pushing.
  The web session that wrote this is done and will not push again.
* Commit messages explain why, not what; Khmer copy is written for students
  on a phone, in the register of a good university Facebook page.
* Never put secrets in the repo. The publishable Supabase key in `pteas.html`
  is meant to be public; the service role key, `ADMIN_PIN` and Telegram
  secrets live only in Supabase.
