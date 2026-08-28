const express = require('express');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GROQ_API_KEY;

// Comma-separated allowlist, e.g. "https://example.com,https://www.example.com".
// Unset => allow any origin (convenient for local dev and the current prototypes).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Guardrails on incoming requests.
const MAX_BODY_BYTES = '64kb';
const MAX_PROMPT_CHARS = 8000;

// Simple in-memory rate limit. Good enough for a single Render instance; swap for
// a shared store (Redis/Upstash) if this ever runs on more than one instance.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

if (!API_KEY) {
  console.warn('WARNING: GROQ_API_KEY is not set. AI endpoints will return 500 until it is configured.');
}

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; needed for correct client IPs.
app.use(cors(ALLOWED_ORIGINS.length ? { origin: ALLOWED_ORIGINS } : {}));
app.use(express.json({ limit: MAX_BODY_BYTES }));

const rateLimitHits = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  const hits = (rateLimitHits.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (hits.length >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - hits[0])) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  hits.push(now);
  rateLimitHits.set(key, hits);
  next();
}

// Drop stale rate-limit entries so the map does not grow forever.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [key, hits] of rateLimitHits) {
    const fresh = hits.filter((t) => t > cutoff);
    if (fresh.length) rateLimitHits.set(key, fresh);
    else rateLimitHits.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// Validates and returns the prompt, or sends the error response and returns null.
function readPrompt(req, res) {
  const { prompt } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'Missing prompt' });
    return null;
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    res.status(413).json({ error: `Prompt is too long (max ${MAX_PROMPT_CHARS} characters).` });
    return null;
  }
  return prompt;
}

function extractJSON(text) {
  let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in AI response');
  }
  let jsonStr = cleaned.slice(start, end + 1);

  const attempts = [
    (s) => s,
    // trailing commas before ] or }
    (s) => s.replace(/,(\s*[\]}])/g, '$1'),
    // missing commas between adjacent objects/arrays: "} {" or "] ["
    (s) => s.replace(/,(\s*[\]}])/g, '$1').replace(/}(\s*){/g, '},$1{').replace(/](\s*)\[/g, '],$1['),
  ];

  let lastErr;
  for (const fix of attempts) {
    try {
      return JSON.parse(fix(jsonStr));
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error('Could not parse AI response as JSON: ' + lastErr.message);
  err.rawResponse = jsonStr.slice(0, 500);
  throw err;
}

async function callGroq(systemPrompt) {
  if (!API_KEY) {
    const err = new Error('Server is missing GROQ_API_KEY. Set it in the environment and restart.');
    err.status = 500;
    throw err;
  }

  let response;
  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        max_tokens: 1600,
        temperature: 0,
        messages: [{ role: 'user', content: systemPrompt }]
      })
    });
  } catch (e) {
    const err = new Error(`Could not reach the AI provider: ${e.message}`);
    err.status = 504;
    throw err;
  }

  if (!response.ok) {
    const errText = await response.text();
    const err = new Error(`Groq API error (${response.status}): ${errText}`);
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  const textBlock = data.choices && data.choices[0] && data.choices[0].message;
  if (!textBlock || !textBlock.content) {
    const err = new Error('AI returned no text content');
    err.status = 502;
    throw err;
  }

  return extractJSON(textBlock.content);
}

app.post('/api/fill-invoice', rateLimit, async (req, res) => {
  try {
    const prompt = readPrompt(req, res);
    if (prompt === null) return;

    const parsed = await callGroq(`You are an invoice-extraction engine for a business tool. Read the description below and return ONLY a single raw JSON object — no markdown fences, no explanation, no questions, no comments, no trailing commas. The JSON must be strictly valid and parseable by JSON.parse().

Rules:
- ALWAYS return valid JSON matching the schema, even if the description is vague, terse, or incomplete. Invent sensible professional defaults for anything missing.
- Never ask questions. Never refuse. Best-guess everything.
- lineItems are ONLY actual products or services being billed (what was sold or done). Handle terse formats too, e.g. "5 Gummybear 3 dollar each" means qty=5, description="Gummybear", rate=3. "10 Pringles 1.5$ each" means qty=10, description="Pringles", rate=1.5.
- charges are separate add-on amounts that are NOT products/services — things like tax, service fee, commission, discount, shipping fee, processing fee. NEVER put these in lineItems. Each charge has a type: "percent" (percentage of the item subtotal) or "flat" (a fixed dollar amount). If someone says "8% tax", that's {"label":"Tax","type":"percent","value":8} — value is the plain percentage number, NOT a decimal (write 8, not 0.08). If someone says "$20 shipping fee", that's {"label":"Shipping","type":"flat","value":20}.
- A discount should be a charge with a negative value (e.g. "10% discount" => {"label":"Discount","type":"percent","value":-10}).
- paymentSchedule: ONLY populate this if the description explicitly describes multiple payments, a deposit/balance split, installments, or milestone-based payments (e.g. "50% upfront, 50% on completion", "3 equal installments", "deposit now, rest in 30 days", "pay in 4 installments over 4 months"). Each entry: {"label": short name like "Deposit" or "Payment 1", "type": "percent"|"flat" (percent of the FINAL total including charges), "value": number, "when": short human description of timing, e.g. "Due at signing", "Due in 30 days", "Due on completion"}.
- If the description does NOT mention any installment/deposit/milestone structure, leave paymentSchedule as an empty array — this means it's a single lump-sum payment, which is the default and most common case. Simple payment terms like "net 15" or "net 30" alone do NOT count as a schedule — that's just a due date for one lump sum, not multiple payments.
- If a payment schedule is used, the percentages (or flat amounts) should add up to roughly 100% of the total — split evenly unless the user specifies otherwise.
- recurringPayment: use this ONLY for open-ended recurring billing by time interval — words like "per fortnight", "per week", "per month", "weekly", "biweekly", "monthly" describing HOW OFTEN payment happens, as opposed to a fixed one-time installment schedule. Set {"frequency": one of "Weekly"|"Biweekly"|"Monthly"|other short label, "installments": number of payments if the person specified a duration or count (e.g. "for 6 months" => 6, "over 4 fortnights" => 4), or null if they mentioned a frequency but NOT how many payments / how long it runs}. If no recurring frequency is mentioned at all, set recurringPayment to null.
- warnings: an array of short, plain-English strings flagging anything important that's missing or ambiguous and would affect accuracy — e.g. if recurringPayment.installments is null, include a warning like "Payment frequency was mentioned (fortnightly) but not how many payments or the total duration — please specify for an accurate per-payment breakdown." Leave this an empty array if nothing is missing.

Schema:
{
  "fromName": string, "fromDetail": string,
  "toName": string, "toDetail": string,
  "lineItems": [{"description": string, "qty": number, "rate": number}],
  "charges": [{"label": string, "type": "percent"|"flat", "value": number}],
  "paymentSchedule": [{"label": string, "type": "percent"|"flat", "value": number, "when": string}],
  "recurringPayment": {"frequency": string, "installments": number|null} or null,
  "warnings": [string],
  "notes": string
}

Description: "${prompt.replace(/"/g, '\\"')}"`);

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/fill-boq', rateLimit, async (req, res) => {
  try {
    const prompt = readPrompt(req, res);
    if (prompt === null) return;

    const parsed = await callGroq(`You are a construction cost-estimation engine for a business tool used by contractors in Cambodia. Read the project description below and return ONLY a single raw JSON object — no markdown fences, no explanation, no questions, no comments, no trailing commas. The JSON must be strictly valid and parseable by JSON.parse().

Rules:
- ALWAYS return valid JSON matching the schema, even if the description is vague or incomplete. Invent sensible, realistic default quantities, units, and unit rates for anything not specified — use plausible construction-industry rates in USD (Cambodia commonly prices construction in USD).
- Never ask questions. Never refuse. Best-guess everything, using standard construction practice.
- Break the project down into realistic line items grouped into categories. Standard categories: "Preliminaries" (site setup, permits, mobilization), "Materials" (concrete, steel, brick, roofing, wiring, etc.), "Labor" (crew time by trade or general labor), "Equipment" (rented machinery, tools), and any other category that fits the described work (e.g. "Electrical", "Plumbing", "Finishing"). Only include categories that are actually relevant to the description.
- Each line item needs a realistic unit of measurement appropriate to construction: m² (area), m³ (volume, e.g. concrete), m (linear, e.g. piping/wiring runs), kg or ton (weight, e.g. rebar/steel), no. / pcs (countable items, e.g. doors, fixtures), LS (lump sum, e.g. a fixed-price sub-task), day or hour (labor time).
- Labor line items should reflect crew size and duration if mentioned (e.g. "crew of 6 for 25 days" could be one line item "General labor" with qty=150 (6×25), unit="day", or broken into a few labor lines by trade if trades are implied).
- markups: contingency, overhead & profit, and VAT/tax are NOT line items — they go in a separate markups array, each with {"label": string, "type": "percent"|"flat", "value": number}. If nothing is specified, still include a reasonable default: {"label":"Contingency","type":"percent","value":10}.
- warnings: an array of short, plain-English strings flagging important missing info that would materially affect accuracy (e.g. missing location which affects material cost assumptions, missing finish quality/grade, missing timeline). Leave empty if nothing significant is missing.

Schema:
{
  "projectName": string,
  "preparedBy": string,
  "clientName": string,
  "categories": [{"name": string, "items": [{"description": string, "unit": string, "qty": number, "rate": number}]}],
  "markups": [{"label": string, "type": "percent"|"flat", "value": number}],
  "warnings": [string],
  "notes": string
}

Description: "${prompt.replace(/"/g, '\\"')}"`);

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/fill-wedding', rateLimit, async (req, res) => {
  try {
    const prompt = readPrompt(req, res);
    if (prompt === null) return;

    const parsed = await callGroq(`You are a wedding-invitation content engine. A couple describes their wedding in plain language and you turn it into the structured content of a single-page invitation site. Return ONLY a single raw JSON object — no markdown fences, no explanation, no questions, no comments, no trailing commas. The JSON must be strictly valid and parseable by JSON.parse().

Rules:
- ALWAYS return valid JSON matching the schema, even if the description is vague or incomplete. Invent warm, plausible defaults for anything missing, and flag what you invented in warnings.
- Never ask questions. Never refuse. Best-guess everything.
- Write in the couple's voice: first person plural ("we", "our"), warm, plain, specific. Never marketing language. Never filler verbs like "elevate", "seamless", "unforgettable", "magical".
- NEVER use em-dashes or en-dashes in any string you produce. Use a comma, a period, or a regular hyphen.
- names: partnerOne and partnerTwo are the two first names as they should read on the invitation, in the order the description gives them.
- date: dateISO is machine-readable ("2026-04-11"). dateLabel is how it should read to a guest ("Saturday 11 April 2026"). If the description gives no year, assume the next occurrence of that date in the future.
- schedule: the running order of the day, earliest first. Each entry is {"time": "15:00" 24-hour string, "title": short name of the moment (2 to 4 words, e.g. "Blessing ceremony", "Drinks in the courtyard", "Dinner", "Speeches, then dancing"), "titleKh": the Khmer name of the rite in Khmer script if and only if this is a named traditional Khmer rite you are confident of, otherwise "", "note": one sentence of practical detail a guest actually needs, max 20 words, or "" if nothing useful to add}. Aim for 4 to 7 entries. If the description mentions a second day (a brunch, a recovery breakfast), include it as a final entry.
- Khmer fields (partnerOneKh, partnerTwoKh, invitationHeadingKh, invitationNoteKh, and schedule titleKh) are OPTIONAL. Fill them ONLY when the description is clearly a Khmer or Cambodian wedding. Otherwise set every one of them to "". Never transliterate a non-Khmer name into Khmer script, and never invent Khmer for a rite you are not sure of: an empty string is always better than wrong Khmer. If you fill any Khmer field, add a warning saying the Khmer should be checked by a native speaker before the invitation is sent.
- A traditional Khmer wedding is a sequence of named rites rather than one ceremony. When the description implies one, use the real running order and real names: ហែជំនូន (the procession of gifts), សែនដូនតា (honouring the ancestors), កាត់សក់ (the symbolic hair cutting), បង្វិលពពិល (the passing of candles), ចងដៃ (the tying of wrists), then the reception. Only include the rites the description actually supports.
- families: who is doing the inviting. On a Khmer invitation the parents invite the guests to the wedding of their children, and their names carry more weight than the couple's, so fill this whenever the description names any parents. {"partnerOneParents": the first partner's parents as they should read, e.g. "Mr Chhun Sokha and Mrs Meas Chantha", or "" if not given, "partnerTwoParents": the same for the second partner, or "", "invitingLineKh": a short formal Khmer line naming the two families as the hosts, only for a Khmer wedding, otherwise ""}. If no parents are named anywhere, set all three to "" and do not invent names.
- venue: name, oneLine (a short orienting sentence, e.g. "A small riverside house 20 minutes upstream from Kampot town"), address, gettingThere (transport, parking, shuttles), staying (accommodation held or suggested, or "" if not mentioned).
- details: practical guest questions. Each is {"heading": 1 to 3 words, "body": max 30 words}. Use only headings the description supports, drawn from: dress code, children, gifts, weather, food, transport, photographs, accessibility. Between 3 and 5 entries.
- rsvp: {"deadlineISO": "2026-02-28", "deadlineLabel": "Saturday 28 February 2026", "email": contact email if given else "", "maxGuestsPerReply": number, default 4}.
- invitationNote: two or three sentences for the top of the page, in the couple's voice, saying who is inviting and what the day is. This is the one place a little warmth and personal detail belongs. Max 60 words.
- photoSlots: the photographs this invitation needs, so the couple knows what to gather. Each is {"slot": one of "portrait"|"venue"|"gallery", "alt": a plain description of what the photo should show, "aspect": "3:4"|"3:2"|"4:5"}. Always include exactly one "portrait" (3:4) and one "venue" (3:2), plus 3 to 4 "gallery" (4:5).
- warnings: short plain-English strings naming anything important the description left out that a guest would need, for example a missing ceremony time, no address, or no RSVP deadline. Also flag details you invented. Empty array if the description covered everything.

Schema:
{
  "partnerOne": string,
  "partnerTwo": string,
  "partnerOneKh": string,
  "partnerTwoKh": string,
  "dateISO": string,
  "dateLabel": string,
  "cityLabel": string,
  "invitationHeadingKh": string,
  "families": {"partnerOneParents": string, "partnerTwoParents": string, "invitingLineKh": string},
  "invitationNote": string,
  "invitationNoteKh": string,
  "schedule": [{"time": string, "titleKh": string, "title": string, "note": string}],
  "venue": {"name": string, "oneLine": string, "address": string, "gettingThere": string, "staying": string},
  "details": [{"heading": string, "body": string}],
  "rsvp": {"deadlineISO": string, "deadlineLabel": string, "email": string, "maxGuestsPerReply": number},
  "photoSlots": [{"slot": string, "alt": string, "aspect": string}],
  "warnings": [string]
}

Description: "${prompt.replace(/"/g, '\\"')}"`);

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    aiConfigured: Boolean(API_KEY)
  });
});

app.get('/', (req, res) => res.send('Invoice AI backend is running.'));

// JSON body parse / size errors land here as well as anything unhandled above.
app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  if (err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  res.status(err.status || 500).json({ error: err.message || 'Unexpected server error' });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
