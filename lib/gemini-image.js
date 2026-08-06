// lib/gemini-image.js — Edición de imagen con IA (Gemini 3.1 Flash Image,
// "Nano Banana 2"): integra un logo/texto/dibujo sobre la imagen base de
// forma realista (perspectiva, sombras, material), en vez de pegarlo como
// un sticker plano. Se ejecuta SIEMPRE en el servidor (api/bendito.js) para
// no exponer GOOGLE_AI_API_KEY en el navegador.
const MODEL = 'gemini-3.1-flash-image';

async function editarImagenConIA({ baseBase64, baseMediaType, refBase64, refMediaType, instruccion }) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY no configurada');

  const parts = [
    { inline_data: { mime_type: baseMediaType, data: baseBase64 } },
  ];
  if (refBase64) {
    parts.push({ inline_data: { mime_type: refMediaType, data: refBase64 } });
  }
  parts.push({
    text: 'Edita la primera imagen (imagen base) integrando de forma realista lo que pide esta instrucción, ' +
      'respetando la perspectiva, la iluminación, las sombras y el material del objeto original' +
      (refBase64 ? '. Usa la segunda imagen como referencia del logo/texto/dibujo a aplicar' : '') +
      '. Instrucción: ' + instruccion,
  });

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + encodeURIComponent(apiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Gemini API error (' + res.status + '): ' + errText);
  }

  const data = await res.json();
  const responseParts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = responseParts.find((p) => p.inlineData || p.inline_data);
  if (!imagePart) {
    const textPart = responseParts.find((p) => p.text);
    throw new Error(textPart ? 'Gemini no devolvió imagen: ' + textPart.text : 'Gemini no devolvió ninguna imagen');
  }

  const inline = imagePart.inlineData || imagePart.inline_data;
  return { base64: inline.data, mediaType: inline.mimeType || inline.mime_type || 'image/png' };
}

module.exports = { editarImagenConIA };
