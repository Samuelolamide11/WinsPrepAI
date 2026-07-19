// Vercel serverless function: /api/generate
// Keeps the real Gemini API key on the server (as an environment variable),
// so nobody using the deployed app ever sees or needs to enter their own key.
//
// Setup on Vercel:
//   1. In your Vercel project -> Settings -> Environment Variables
//   2. Add: GEMINI_API_KEY = <your real key from aistudio.google.com/apikey>
//   3. Redeploy (env vars only take effect on new deployments)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed. Use POST.' } });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: { message: 'Server is missing GEMINI_API_KEY. Set it in your Vercel project environment variables and redeploy.' }
    });
    return;
  }

  const { systemPrompt, contents, maxOutputTokens, model } = req.body || {};

  if (!contents || !Array.isArray(contents)) {
    res.status(400).json({ error: { message: 'Request body must include a "contents" array.' } });
    return;
  }

  // A small allowlist keeps the proxy from being used to hit arbitrary/expensive models.
  const ALLOWED_MODELS = ['gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
  const modelName = ALLOWED_MODELS.includes(model) ? model : 'gemini-flash-latest';

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const body = {
    contents,
    generationConfig: { maxOutputTokens: maxOutputTokens || 700 }
  };
  if (systemPrompt) {
    body.system_instruction = { parts: [{ text: systemPrompt }] };
  }

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json(data);
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: 'Could not reach Gemini right now.', detail: String(err) } });
  }
}
