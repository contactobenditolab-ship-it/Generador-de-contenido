// lib/anthropic.js — Llamada a Claude con imagen + texto que espera JSON de
// vuelta. Se ejecuta SIEMPRE en el servidor (api/bendito.js) para no exponer
// la ANTHROPIC_API_KEY en el navegador.
async function callClaudeVisionJSON({ system, userText, base64, mediaType, maxTokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: maxTokens || 1000,
      system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: userText },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Anthropic API error (' + res.status + '): ' + errText);
  }

  const data = await res.json();
  const textBlocks = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const clean = textBlocks.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(clean);
}

module.exports = { callClaudeVisionJSON };
