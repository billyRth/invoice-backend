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
          content: `You are an invoice-extraction engine. Read the description below and return ONLY a raw JSON object — no markdown fences, no explanation, no questions.

Rules:
- ALWAYS return valid JSON matching the schema, even if the description is vague or incomplete. Invent sensible professional defaults for anything missing.
- Never ask questions. Never refuse. Best-guess everything.

Schema:
{
  "fromName": string, "fromDetail": string,
  "toName": string, "toDetail": string,
  "lineItems": [{"description": string, "qty": number, "rate": number}],
  "taxRate": number,
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
