// lib/gemini-text.js — Llamada a Gemini con imagen + texto que espera JSON
// de vuelta. Sustituye a lib/anthropic.js (Claude) para no depender de
// saldo de pago: Google AI Studio tiene un nivel gratuito con límite de
// peticiones por minuto/día, suficiente para el uso de esta app. Se
// ejecuta SIEMPRE en el servidor (api/bendito.js) para no exponer
// GOOGLE_AI_API_KEY en el navegador. Misma API key que lib/gemini-image.js.
const MODEL = 'gemini-2.5-flash';

async function callGeminiVisionJSON({ system, userText, base64, mediaType, maxTokens }) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY no configurada');

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + encodeURIComponent(apiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: userText },
          ],
        }],
        generationConfig: {
          maxOutputTokens: maxTokens || 1000,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Gemini API error (' + res.status + '): ' + errText);
  }

  const data = await res.json();
  const textBlocks = (data.candidates?.[0]?.content?.parts || [])
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n');

  if (!textBlocks) {
    throw new Error('Gemini no devolvió texto (respuesta bloqueada o vacía: ' + JSON.stringify(data.candidates?.[0]?.finishReason || data) + ')');
  }

  const clean = textBlocks.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(clean);
}

module.exports = { callGeminiVisionJSON };
