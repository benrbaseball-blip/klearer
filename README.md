# Klearer

Understand your job offer before you sign it.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Add your API key
```bash
cp .env.example .env
```
Open `.env` and replace `your_api_key_here` with your Anthropic API key.
Get one at: https://console.anthropic.com

### 3. Run locally
```bash
node server.js
```
Open http://localhost:3000

## Deploy to Vercel (free)

### 1. Install Vercel CLI
```bash
npm install -g vercel
```

### 2. Create vercel.json in the project root
```json
{
  "version": 2,
  "builds": [{ "src": "server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "server.js" }]
}
```

### 3. Deploy
```bash
vercel
```

### 4. Add your API key to Vercel
In the Vercel dashboard → your project → Settings → Environment Variables
Add: `ANTHROPIC_API_KEY` = your key

Then redeploy:
```bash
vercel --prod
```

## Stack
- Node.js + Express (backend)
- Vanilla HTML/CSS/JS (frontend)
- Anthropic Claude API (analysis)
