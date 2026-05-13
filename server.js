const express = require('express');
const path = require('path');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

// TEXT EXTRACTION ENDPOINT
app.post('/api/extract-text', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const { mimetype, originalname, buffer } = req.file;
  const ext = path.extname(originalname).toLowerCase();

  try {
    let text = '';

    if (ext === '.pdf' || mimetype === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      text = data.text;
    } else if (ext === '.docx' || mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (ext === '.doc') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (ext === '.txt' || mimetype === 'text/plain') {
      text = buffer.toString('utf-8');
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Please upload a PDF, Word doc, or text file.' });
    }

    if (!text || text.trim().length < 50) {
      return res.status(400).json({ error: 'Could not extract enough text from this file. Try pasting the text instead.' });
    }

    res.json({ text: text.trim() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read file: ' + err.message });
  }
});
app.post('/api/extract-image-text', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });
  try {
    const base64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
            { type: 'text', text: 'Please extract ALL text from this document image exactly as it appears. Include every word, number, date, and clause. Preserve the structure as much as possible. Return only the extracted text, nothing else.' }
          ]
        }]
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API error');
    const text = data.content.map(b => b.text || '').join('');
    if (!text || text.trim().length < 20) return res.status(400).json({ error: 'Could not extract text from this image. Make sure the document is clearly visible.' });
    res.json({ text: text.trim() });
  } catch (err) { res.status(500).json({ error: 'Failed to read image: ' + err.message }); }
});
app.get('/api/stripe-key', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '' });
});

app.post('/api/analyze', async (req, res) => {
  const { text } = req.body;
  if (!text || text.length < 50) return res.status(400).json({ error: 'Document text is too short.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  const prompt = `You are Klearer, an expert document analyst. Analyze the document below and return ONLY a valid JSON object — no markdown, no explanation.

First identify what type of document this is. Then extract the most important information a regular person needs to know before signing or acting on it.

IMPORTANT: For every insight, flag, and fact — include the page number where it appears in the document (e.g. "page 2" or "page 4, section 3.2"). If the document has no page numbers, reference the section or paragraph instead.

Return this exact JSON schema:
{
  "doc_type": "offer_letter|lease|insurance|car_contract|medical|bank|student_loan|terms|hoa|other",
  "doc_title": "short human-readable title e.g. 'Lease Agreement — 123 Main St' or 'Offer Letter — Google'",
  "facts": [
    { "label": "key fact label", "value": "the value", "location": "page X" }
  ],
  "good": [
    { "title": "positive thing", "detail": "plain english explanation", "location": "page X" }
  ],
  "watch_out": [
    { "title": "red flag or risk", "detail": "plain english explanation of why this matters", "location": "page X", "severity": "high|medium|low" }
  ],
  "plain_english": "2-3 sentence plain English summary of what this document actually means for the person signing it",
  "next_moves": [
    "specific action item the person should take"
  ]
}

Rules:
- facts: pull 4-6 key numbers, dates, names — the things that matter most
- good: 2-4 genuinely positive things working in their favor
- watch_out: 2-5 risks or red flags, ordered by severity
- plain_english: write like you're texting a friend, not writing a legal brief
- next_moves: 1-3 concrete specific actions, not generic advice
- location: always include page number or section reference for every item
- If page numbers aren't visible, reference the section heading or clause number

Document:
${text.slice(0, 6000)}`;

  try {
    const raw = await callClaude(apiKey, prompt, 2000);
    const data = parseJSON(raw);
    res.json(data);
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
      line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Klearer Interview Prep — Full Pack', description: `15 company-specific questions for ${role || 'your role'} at ${company || 'your company'}` }, unit_amount: 199 }, quantity: 1 }],
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
  "questions": [{ "category": "Behavioral|Technical|Company-specific|Culture", "question": "specific question", "tip": "what they are testing and how to answer well" }]
}
Make at least 5 questions company-specific. Be specific, not generic.`;
  try {
    const raw = await callClaude(apiKey, prompt, 2000);
    res.json(parseJSON(raw));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/review-free', async (req, res) => {
  const { role, wins } = req.body;
  if (!role || !wins) return res.status(400).json({ error: 'Missing role or accomplishments.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });
  const prompt = `You are an expert career coach helping someone prepare for their performance review.

Role: ${role}
Accomplishments: ${wins.slice(0, 2000)}

Return ONLY valid JSON:
{
  "preview": "A 3-4 sentence self-evaluation preview written in first person, professional tone, highlighting their strongest impact. End with '...' to indicate there is more.",
  "highlights": ["strongest accomplishment reframed with impact language", "second strongest", "third strongest"]
}
Make the preview compelling and specific. Reframe accomplishments in terms of business impact.`;
  try {
    const raw = await callClaude(apiKey, prompt, 800);
    res.json(parseJSON(raw));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/create-review-checkout', async (req, res) => {
  const { role, wins } = req.body;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured.' });
  try {
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Klearer Performance Review Package', description: 'Full self-evaluation, raise script, promotion case, and gaps analysis' }, unit_amount: 499 }, quantity: 1 }],
      mode: 'payment',
      success_url: `${req.headers.origin}/review-success.html?role=${encodeURIComponent((role||'').slice(0,200))}&wins=${encodeURIComponent((wins||'').slice(0,500))}`,
      cancel_url: `${req.headers.origin}/review.html`,
    });
    res.json({ url: session.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/review-paid', async (req, res) => {
  const { role, wins } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });
  const prompt = `You are an expert career coach. Generate a complete performance review package.

Role: ${role}
Accomplishments: ${(wins||'').slice(0, 2000)}

Return ONLY valid JSON:
{
  "self_evaluation": "Full 4-6 paragraph self-evaluation written in first person, professional tone, ready to submit.",
  "raise_script": "A 150-word script for asking for a raise, referencing their specific accomplishments.",
  "promotion_case": "2-3 sentences making the case for promotion if applicable, or null if not applicable.",
  "gaps": ["one gap or area to address before or during the review", "second gap if applicable"],
  "key_metrics": ["strongest quantified achievement", "second strongest"]
}`;
  try {
    const raw = await callClaude(apiKey, prompt, 2000);
    res.json(parseJSON(raw));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Klearer running at http://localhost:${PORT}`));
