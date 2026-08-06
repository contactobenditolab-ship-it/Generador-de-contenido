// lib/gemini-text.js — Llamada a Gemini con imagen + texto que espera JSON
// de vuelta. Sustituye a lib/anthropic.js (Claude) para no depender de
// saldo de pago: Google AI Studio tiene un nivel gratuito con límite de
// peticiones por minuto/día, suficiente para el uso de esta app. Se
// ejecuta SIEMPRE en el servidor (api/bendito.js) para no exponer
// GOOGLE_AI_API_KEY en el navegador. Misma API key que lib/gemini-image.js.
// Alias en vez de una versión fija: Google retira modelos con versión
// explícita para cuentas nuevas cada pocos meses (nos pasó con
// gemini-2.5-flash), y el alias "-latest" se actualiza solo.
const MODEL = 'gemini-flash-latest';

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
          // maxOutputTokens con margen amplio: los modelos Gemini recientes
          // gastan tokens en "pensar" antes de escribir la respuesta, y con
          // un límite ajustado el JSON se corta a mitad (thinkingBudget: 0
          // lo desactiva del todo — no hace falta para esta tarea).
          maxOutputTokens: Math.max(maxTokens || 1000, 2000),
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Gemini API error (' + res.status + '): ' + errText);
  }

  const data = await res.json();
  const finishReason = data.candidates?.[0]?.finishReason;
  const textBlocks = (data.candidates?.[0]?.content?.parts || [])
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n');

  if (!textBlocks) {
    throw new Error('Gemini no devolvió texto (respuesta bloqueada o vacía: ' + JSON.stringify(finishReason || data) + ')');
  }

  const clean = textBlocks.replace(/```json/g, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (err) {
    throw new Error(
      'Gemini devolvió JSON inválido (finishReason: ' + finishReason + '): ' + err.message +
      ' — texto recibido: ' + clean.slice(0, 300)
    );
  }
}

module.exports = { callGeminiVisionJSON };
