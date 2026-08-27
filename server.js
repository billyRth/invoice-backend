const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GROQ_API_KEY;

function extractJSON(text) {
  let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in AI response');
  }
  let jsonStr = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // Common model slip-ups: trailing commas before ] or }
    const repaired = jsonStr.replace(/,(\s*[\]}])/g, '$1');
    return JSON.parse(repaired);
  }
}

app.post('/api/fill-invoice', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        max_tokens: 1600,
        messages: [{
          role: 'user',
          content: `You are an invoice-extraction engine for a business tool. Read the description below and return ONLY a single raw JSON object — no markdown fences, no explanation, no questions, no comments, no trailing commas. The JSON must be strictly valid and parseable by JSON.parse().

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

Description: "${prompt.replace(/"/g, '\\"')}"`
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Groq API error (${response.status}): ${errText}` });
    }

    const data = await response.json();
    const textBlock = data.choices && data.choices[0] && data.choices[0].message;
    if (!textBlock || !textBlock.content) {
      return res.status(502).json({ error: 'AI returned no text content' });
    }

    const parsed = extractJSON(textBlock.content);
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.send('Invoice AI backend is running.'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
