const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function callClaude(apiKey, prompt, maxTokens = 1500) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'API error');
  return data.content.map(b => b.text || '').join('');
}

function parseJSON(raw) {
  const clean = raw.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found');
  return JSON.parse(clean.slice(start, end + 1));
}

app.get('/api/stripe-key', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '' });
});

app.post('/api/analyze', async (req, res) => {
  const { text } = req.body;
  if (!text || text.length < 50) return res.status(400).json({ error: 'Offer letter text is too short.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });
  const prompt = `You are an expert career advisor. Analyze this job offer letter and return ONLY a valid JSON object — no markdown, no explanation.

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
  "compensation": [{ "label": "item name", "description": "plain english explanation", "value": "amount" }],
  "benefits": [{ "label": "benefit name", "description": "plain english explanation", "badge": "good|warn|danger|neutral", "badgeText": "Strong|Average|Below avg|Great|Watch out" }],
  "flags": [{ "type": "warn|info|good", "title": "short title", "detail": "plain english explanation" }]
}

Offer letter:
${text.slice(0, 4000)}`;
  try {
    const raw = await callClaude(apiKey, prompt);
    res.json(parseJSON(raw));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/negotiate', async (req, res) => {
  const { role, company, salary, offerText } = req.body;
  if (!role) return res.status(400).json({ error: 'Missing offer details.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });
  const prompt = `Write a professional salary negotiation email for someone who received a job offer.
Role: ${role}, Company: ${company || 'the company'}, Salary: ${salary || 'not specified'}
Context: ${offerText ? offerText.slice(0, 1000) : 'not provided'}
Make it confident, warm, specific. Ask for 10-15% more. Include 2-3 justifications. Keep under 200 words. Include subject line. Write in first person.`;
  try {
    const script = await callClaude(apiKey, prompt, 800);
    res.json({ script: script.trim() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/benchmark', async (req, res) => {
  const { role, salary } = req.body;
  if (!role) return res.status(400).json({ error: 'Missing role.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });
  const prompt = `Provide US national salary benchmark data for: ${role}. Offered: ${salary || 'not specified'}.
Return ONLY valid JSON:
{"role":"normalized title","national_median":"$XX,XXX","range_low":"$XX,XXX","range_high":"$XX,XXX","verdict":"below|at|above","verdict_text":"one sentence verdict","sources":"Based on BLS, Glassdoor, LinkedIn data","negotiation_tip":"one specific tip"}`;
  try {
    const raw = await callClaude(apiKey, prompt, 600);
    res.json(parseJSON(raw));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/interview-free', async (req, res) => {
  const { jd } = req.body;
  if (!jd || jd.length < 50) return res.status(400).json({ error: 'Job description too short.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });
  const prompt = `Analyze this job description and generate exactly 3 interview questions. Return ONLY valid JSON:
{
  "role": "job title",
  "company": "company name or Unknown",
  "questions": [
    { "question": "interview question", "tip": "what they are testing and how to answer well in 1-2 sentences" }
  ]
}
Generate exactly 3 questions. Make them specific to the role requirements. Focus on behavioral and skills-based questions.
Job description: ${jd.slice(0, 3000)}`;
  try {
    const raw = await callClaude(apiKey, prompt, 1000);
    res.json(parseJSON(raw));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/create-checkout', async (req, res) => {
  const { role, company, jd } = req.body;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured.' });
  try {
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Klearer Interview Prep — Full Pack',
            description: `15 company-specific questions for ${role || 'your role'} at ${company || 'your company'}`,
          },
          unit_amount: 199,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.origin}/interview-success.html?role=${encodeURIComponent(role||'')}&company=${encodeURIComponent(company||'')}&jd=${encodeURIComponent((jd||'').slice(0,500))}`,
      cancel_url: `${req.headers.origin}/interview.html`,
    });
    res.json({ url: session.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/interview-paid', async (req, res) => {
  const { role, company, jd } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });
  const prompt = `You are an expert interview coach. Generate 15 highly specific interview questions for this role and company.
Role: ${role}, Company: ${company}
Job description: ${(jd||'').slice(0, 2000)}

Return ONLY valid JSON:
{
  "company_insights": "2-3 sentences about the company culture, recent news, or what they value",
  "questions": [
    { "category": "Behavioral|Technical|Company-specific|Culture", "question": "specific question", "tip": "what they are testing and how to answer well" }
  ]
}
Make at least 5 questions company-specific. Be specific, not generic.`;
  try {
    const raw = await callClaude(apiKey, prompt, 2000);
    res.json(parseJSON(raw));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Klearer running at http://localhost:${PORT}`));
