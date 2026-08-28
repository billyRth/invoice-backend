# invoice-backend

AI extraction backend powering two tools:

- **Invoice generator** — plain-English job description → structured invoice JSON (line items, charges, payment schedules, recurring payments, warnings).
- **Construction BOQ estimator** — plain-English project description → categorized Bill of Quantities JSON (line items with construction units, markups, warnings).

Single Node/Express service, no database, no build step. Deployed on Render at
`https://invoice-backend-d6a2.onrender.com`.

## Local setup

```bash
git clone https://github.com/billyRth/invoice-backend.git
cd invoice-backend
npm install
cp .env.example .env      # then paste your Groq key into .env
npm run dev               # http://localhost:3000, restarts on file save
```

`npm run dev` loads `.env` automatically and watches for changes. `npm start` is what
Render runs in production (it reads the environment directly, no `.env` file).

`.env` is gitignored — never commit it, and never paste a real key into `.env.example`.

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `GROQ_API_KEY` | yes | — | From https://console.groq.com. Without it the AI endpoints return 500 and the server logs a warning at startup. |
| `PORT` | no | `3000` | Render sets this automatically. |
| `ALLOWED_ORIGINS` | no | unset = allow all | Comma-separated CORS allowlist, e.g. `https://yourdomain.com,https://www.yourdomain.com`. Tighten this before real users. |

## Endpoints

### `GET /health`

```json
{ "status": "ok", "uptimeSeconds": 42, "aiConfigured": true }
```

Useful for uptime monitoring and for checking a deploy picked up the API key. Never
returns the key itself.

### `GET /`

Plain-text liveness string.

### `POST /api/fill-invoice`

Request: `{ "prompt": "5 gummybears at $3 each, 8% tax, 50% deposit" }`

Response:

```jsonc
{
  "fromName": "string", "fromDetail": "string",
  "toName": "string", "toDetail": "string",
  "lineItems": [{ "description": "string", "qty": 0, "rate": 0 }],
  "charges": [{ "label": "string", "type": "percent|flat", "value": 0 }],
  "paymentSchedule": [{ "label": "string", "type": "percent|flat", "value": 0, "when": "string" }],
  "recurringPayment": { "frequency": "string", "installments": 0 },  // or null
  "warnings": ["string"],
  "notes": "string"
}
```

Key modelling rules baked into the prompt: taxes/fees/discounts are **charges**, never
line items; a discount is a charge with a negative value; `paymentSchedule` stays empty
unless the description actually describes multiple payments (`net 30` alone does not
count); `recurringPayment` is only for open-ended interval billing.

### `POST /api/fill-boq`

Request: `{ "prompt": "two-storey villa, 180 m2, crew of 6 for 25 days, Phnom Penh" }`

Response:

```jsonc
{
  "projectName": "string",
  "preparedBy": "string",
  "clientName": "string",
  "categories": [{ "name": "string", "items": [{ "description": "string", "unit": "string", "qty": 0, "rate": 0 }] }],
  "markups": [{ "label": "string", "type": "percent|flat", "value": 0 }],
  "warnings": ["string"],
  "notes": "string"
}
```

Contingency / overhead / VAT are **markups**, never line items. Units follow construction
convention (m2, m3, m, kg, ton, no., LS, day, hour).

### `POST /api/fill-wedding`

Request: `{ "prompt": "We're marrying by the river in Kampot on 11 April, ceremony at 3, dinner at 6, kids welcome" }`

Response:

```jsonc
{
  "partnerOne": "string", "partnerTwo": "string",
  "dateISO": "2026-04-11", "dateLabel": "Saturday 11 April 2026",
  "cityLabel": "string",
  "invitationNote": "string",
  "schedule": [{ "time": "15:00", "title": "string", "note": "string" }],
  "venue": { "name": "string", "oneLine": "string", "address": "string", "gettingThere": "string", "staying": "string" },
  "details": [{ "heading": "string", "body": "string" }],
  "rsvp": { "deadlineISO": "string", "deadlineLabel": "string", "email": "string", "maxGuestsPerReply": 4 },
  "photoSlots": [{ "slot": "portrait|venue|gallery", "alt": "string", "aspect": "3:4|3:2|4:5" }],
  "warnings": ["string"]
}
```

The schema maps one to one onto `wedding-templates/cobalt-porcelain.html`, so a filled response
populates that page without reshaping. Copy is generated in the couple's voice, and the prompt
forbids em-dashes so output matches the template's typographic rules. `photoSlots` tells the couple
which photographs they still need to supply.

### Error responses

Every error is `{ "error": "human-readable message" }` with a meaningful status:

| Status | Meaning |
| --- | --- |
| 400 | Missing/empty prompt, or malformed JSON body |
| 413 | Prompt over 8,000 characters, or body over 64 KB |
| 429 | Rate limited (20 requests/minute per IP); includes a `Retry-After` header |
| 500 | `GROQ_API_KEY` not configured, or an unexpected failure |
| 502 | Groq returned an error or empty content |
| 504 | Groq unreachable or slower than the 60s timeout |

## How it works

1. `readPrompt()` validates the incoming prompt (type, non-empty, length).
2. `callGroq()` sends a single fully-specified extraction prompt to Groq
   (`openai/gpt-oss-120b`, `temperature: 0`, `max_tokens: 1600`, 60s timeout).
3. `extractJSON()` strips markdown fences, slices to the outermost `{...}`, and tries
   three progressively more aggressive repairs (trailing commas, then missing commas
   between adjacent objects/arrays) before giving up. The model occasionally emits
   slightly malformed JSON; this is why.

## Deploying

Render auto-deploys on every push to `main`.

Work locally now rather than editing files in the GitHub web UI:

```bash
git checkout -b some-change
# edit, then:
npm run check                 # syntax check
npm run dev                   # manual smoke test
git commit -am "..." && git push -u origin some-change
```

Merge to `main` when you are happy; Render picks it up from there.

## Known risks / not yet done

- **Groq model deprecation.** `openai/gpt-oss-120b` is hardcoded in `callGroq()`.
  `llama-3.3-70b-versatile` was already deprecated once mid-project. If extraction starts
  failing with a 502, check Groq's model list first — the fix is one string.
- **Rate limiting is in-memory.** Correct on a single Render instance; it resets on every
  deploy and would need a shared store (Redis/Upstash) across multiple instances.
- **CORS is open by default.** Set `ALLOWED_ORIGINS` before real users.
- **No auth, no quota, no persistence.** Anyone with the URL can spend Groq quota, subject
  only to the per-IP rate limit.
