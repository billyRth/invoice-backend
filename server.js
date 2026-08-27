const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GROQ_API_KEY;

function extractJSON(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in AI response');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
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
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are an invoice-extraction engine for a business tool. Read the description below and return ONLY a raw JSON object — no markdown fences, no explanation, no questions.

Rules:
- ALWAYS return valid JSON matching the schema, even if the description is vague, terse, or incomplete. Invent sensible professional defaults for anything missing.
- Never ask questions. Never refuse. Best-guess everything.
- lineItems are ONLY actual products or services being billed (what was sold or done). Handle terse formats too, e.g. "5 Gummybear 3 dollar each" means qty=5, description="Gummybear", rate=3. "10 Pringles 1.5$ each" means qty=10, description="Pringles", rate=1.5.
- charges are separate add-on amounts that are NOT products/services — things like tax, service fee, commission, discount, shipping fee, processing fee. NEVER put these in lineItems. Each charge has a type: "percent" (percentage of the item subtotal) or "flat" (a fixed dollar amount). If someone says "8% tax", that's {"label":"Tax","type":"percent","value":8} — value is the plain percentage number, NOT a decimal (write 8, not 0.08). If someone says "$20 shipping fee", that's {"label":"Shipping","type":"flat","value":20}.
- A discount should be a charge with a negative value (e.g. "10% discount" => {"label":"Discount","type":"percent","value":-10}).
- paymentSchedule: ONLY populate this if the description explicitly describes multiple payments, a deposit/balance split, installments, or milestone-based payments (e.g. "50% upfront, 50% on completion", "3 equal installments", "deposit now, rest in 30 days", "pay in 4 installments over 4 months"). Each entry: {"label": short name like "Deposit" or "Payment 1", "type": "percent"|"flat" (percent of the FINAL total including charges), "value": number, "when": short human description of timing, e.g. "Due at signing", "Due in 30 days", "Due on completion"}.
- If the description does NOT mention any installment/deposit/milestone structure, leave paymentSchedule as an empty array — this means it's a single lump-sum payment, which is the default and most common case. Simple payment terms like "net 15" or "net 30" alone do NOT count as a schedule — that's just a due date for one lump sum, not multiple payments.
- If a payment schedule is used, the percentages (or flat amounts) should add up to roughly 100% of the total — split evenly unless the user specifies otherwise.

Schema:
{
  "fromName": string, "fromDetail": string,
  "toName": string, "toDetail": string,
  "lineItems": [{"description": string, "qty": number, "rate": number}],
  "charges": [{"label": string, "type": "percent"|"flat", "value": number}],
  "paymentSchedule": [{"label": string, "type": "percent"|"flat", "value": number, "when": string}],
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
