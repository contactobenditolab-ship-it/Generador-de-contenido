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

async function callGeminiVisionJSON({ system, userText, base64, mediaType, extraImages, maxTokens }) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY no configurada');

  const parts = [{ inline_data: { mime_type: mediaType, data: base64 } }];
  (extraImages || []).forEach((img) => {
    parts.push({ inline_data: { mime_type: img.mediaType, data: img.base64 } });
  });
  parts.push({ text: userText });

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);
  const requestBody = JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents: [{ parts }],
    generationConfig: {
      // maxOutputTokens con MUCHO margen: los modelos Gemini recientes
      // gastan la mayoría del presupuesto en "pensar" antes de escribir
      // la respuesta visible, y con 2000 seguía cortando el JSON a
      // mitad (thinkingConfig para desactivarlo no se puede usar aquí —
      // el modelo detrás de "gemini-flash-latest" lo rechaza con 400).
      maxOutputTokens: Math.max(maxTokens || 1000, 8000),
      // Sin responseMimeType: forzar JSON estricto parece hacer que el
      // modelo "piense" más antes de escribir (probado: con json mode
      // se agotaban los tokens a mitad de respuesta incluso con 8000 de
      // margen). El prompt del sistema ya pide JSON sin backticks, y el
      // parseo de abajo ya limpia backticks por si acaso.
    },
  });

  // Google devuelve 503 ("modelo saturado") o 429 (límite de peticiones)
  // con bastante frecuencia en el nivel gratuito, y suele resolverse solo
  // a los pocos segundos — de ahí que el botón funcionara "a veces sí, a
  // veces no". Reintentamos un par de veces con espera antes de rendirnos.
  //
  // OJO: un 429 con "limit: 0" en el mensaje es distinto — Google ha
  // dejado la cuota gratuita de ese modelo a cero, no es algo temporal, y
  // reintentar no sirve de nada (seguirá fallando siempre).
  const REINTENTABLES = [503, 429];
  let res, errText;
  for (let intento = 0; intento < 3; intento++) {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody });
    if (res.ok) break;
    errText = await res.text();
    if (res.status === 429 && /limit:\s*0\b/.test(errText)) {
      throw new Error(
        'Gemini ha quitado la cuota gratuita de este modelo (' + MODEL + '). ' +
        'Hace falta activar facturación en Google AI Studio para seguir generando copy con IA — mientras tanto, ' +
        'usa "✍️ Continuar sin IA" para escribir los copys a mano.'
      );
    }
    if (!REINTENTABLES.includes(res.status) || intento === 2) {
      throw new Error('Gemini API error (' + res.status + '): ' + errText);
    }
    await new Promise((r) => setTimeout(r, 1500 * (intento + 1)));
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
