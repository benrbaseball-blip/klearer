const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function callClaude(apiKey, prompt, maxTokens = 1500) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'API error');
  return data.content.map(b => b.text || '').join('');
}

function parseJSON(raw) {
  const clean = raw.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in response');
  return JSON.parse(clean.slice(start, end + 1));
}

app.post('/api/analyze', async (req, res) => {
  const { text } = req.body;
  if (!text || text.length < 50) return res.status(400).json({ error: 'Offer letter text is too short.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });
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
    const raw = await callClaude(apiKey, prompt);
    const result = parseJSON(raw);
    res.json(result);
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/negotiate', async (req, res) => {
  const { role, company, salary, offerText } = req.body;
  if (!role) return res.status(400).json({ error: 'Missing offer details.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });
  const prompt = `You are an expert salary negotiation coach. Write a personalized negotiation script for someone who just received a job offer.

Details:
- Role: ${role}
- Company: ${company || 'the company'}
- Offered salary: ${salary || 'not specified'}
- Offer context: ${offerText ? offerText.slice(0, 1000) : 'not provided'}

Write a negotiation script they can use in an email or phone call. Make it:
- Confident but professional and warm
- Specific — mention the role and show genuine excitement
- Ask for 10-15% more than offered, or improvements to benefits/PTO if salary seems fair
- Include 2-3 talking points justifying the ask (market data, skills, value they bring)
- End with an easy out so the conversation stays positive

Format it as a ready-to-send email with subject line. Keep it under 200 words. Write it in first person as if you are the candidate.`;
  try {
    const script = await callClaude(apiKey, prompt, 800);
    res.json({ script: script.trim() });
  } catch (err) {
    console.error('Negotiate error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/benchmark', async (req, res) => {
  const { role, salary } = req.body;
  if (!role) return res.status(400).json({ error: 'Missing role.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });
  const prompt = `You are a compensation data expert. Provide national salary benchmark data for the following role based on your knowledge of US compensation data from sources like Bureau of Labor Statistics, Glassdoor, LinkedIn, and Levels.fyi.

Role: ${role}
Offered salary: ${salary || 'not specified'}

Return ONLY a valid JSON object, no markdown, no explanation:
{
  "role": "normalized job title",
  "national_median": "$XX,XXX",
  "range_low": "$XX,XXX",
  "range_high": "$XX,XXX",
  "percentile": "25th|50th|75th|90th",
  "verdict": "below|at|above",
  "verdict_text": "one sentence plain english verdict e.g. Your offer is right at the national median for this role.",
  "sources": "Based on BLS, Glassdoor, and LinkedIn data",
  "top_paying_industries": ["industry 1", "industry 2", "industry 3"],
  "negotiation_tip": "one specific tip based on where their salary falls in the range"
}`;
  try {
    const raw = await callClaude(apiKey, prompt, 600);
    const result = parseJSON(raw);
    res.json(result);
  } catch (err) {
    console.error('Benchmark error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Klearer running at http://localhost:${PORT}`));
