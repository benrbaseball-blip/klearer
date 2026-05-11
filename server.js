const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

app.post('/api/analyze', async (req, res) => {
  const { text } = req.body;

  if (!text || text.length < 50) {
    return res.status(400).json({ error: 'Offer letter text is too short.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured. Add ANTHROPIC_API_KEY to your .env file.' });
  }

  const prompt = `You are an expert career advisor and compensation analyst. Analyze this job offer letter and return ONLY a valid JSON object — no markdown fences, no explanation, just raw JSON.

Schema:
{
  "role": "job title",
  "company": "company name",
  "stats": [
    { "label": "Base salary", "value": "$X,XXX", "highlight": true },
    { "label": "Total comp (est.)", "value": "$X,XXX", "highlight": true },
    { "label": "PTO", "value": "X days" },
    { "label": "Start date", "value": "Month Day or Not mentioned" }
  ],
  "compensation": [
    { "label": "item name", "description": "plain english explanation for a first-job grad", "value": "amount or description" }
  ],
  "benefits": [
    { "label": "benefit name", "description": "plain english explanation", "badge": "good|warn|danger|neutral", "badgeText": "Strong|Average|Below avg|Great|Watch out" }
  ],
  "flags": [
    { "type": "warn|info|good", "title": "short title", "detail": "plain english explanation of what this means for you and what to watch out for" }
  ]
}

Include all compensation (base, bonus, equity, sign-on), all mentioned benefits, and flag anything unusual like non-competes, clawbacks, vesting cliffs, at-will clauses, IP assignment, or anything worth negotiating.

Offer letter:
${text.slice(0, 4000)}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(500).json({ error: `Anthropic API error: ${data.error?.message || 'Unknown error'}` });
    }

    const raw = data.content.map(b => b.text || '').join('');
    const clean = raw.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');

    if (start === -1 || end === -1) {
      console.error('No JSON in response:', raw);
      return res.status(500).json({ error: 'Could not parse offer analysis. Please try again.' });
    }

    const result = JSON.parse(clean.slice(start, end + 1));
    res.json(result);

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Klearer running at http://localhost:${PORT}`));
