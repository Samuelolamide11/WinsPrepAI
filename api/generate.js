// Vercel Serverless Function: keeps GEMINI_API_KEY on the server.
// Configure GEMINI_API_KEY in Vercel Project Settings → Environment Variables.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI service is not configured yet.' });

  const body = req.body || {};
  const { systemPrompt, messages, maxTokens } = body;
  if (typeof systemPrompt !== 'string' || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid AI request.' });
  }

  // Keep anonymous browser requests bounded. Add authentication/rate limiting
  // before using this public endpoint at significant scale.
  if (systemPrompt.length > 12000 || messages.length > 40) {
    return res.status(413).json({ error: 'Request is too large.' });
  }

  const contents = messages.map(message => {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const content = message.content;
    const parts = Array.isArray(content)
      ? content.map(part => {
          if (part.type === 'text') return { text: String(part.text || '') };
          if (part.type === 'image_url') {
            const match = String(part.image_url && part.image_url.url || '').match(/^data:(.*?);base64,(.*)$/);
            if (match) return { inline_data: { mime_type: match[1], data: match[2] } };
          }
          return { text: '' };
        })
      : [{ text: String(content || '') }];
    return { role, parts };
  });

  const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: Math.min(Math.max(Number(maxTokens) || 700, 1), 4096) }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error && data.error.message || 'The AI service is temporarily unavailable.' });
    }
    const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    return res.status(200).json({ text: parts ? parts.map(part => part.text || '').join('') : '' });
  } catch (error) {
    return res.status(502).json({ error: 'Could not reach the AI service.' });
  }
};
