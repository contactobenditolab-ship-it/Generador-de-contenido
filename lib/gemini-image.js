// lib/gemini-image.js — Edición de imagen con IA (Gemini 2.5 Flash Image,
// "Nano Banana"): integra un logo/texto/dibujo sobre la imagen base de
// forma realista (perspectiva, sombras, material), en vez de pegarlo como
// un sticker plano. Se ejecuta SIEMPRE en el servidor (api/bendito.js) para
// no exponer GOOGLE_AI_API_KEY en el navegador.
//
// OJO: "gemini-3.1-flash-image" (Nano Banana 2) NO tiene cuota gratuita
// (límite 0 en el free tier — 429 RESOURCE_EXHAUSTED siempre). Este modelo
// (2.5) sí la tiene, hasta 500 imágenes/día. Si en el futuro hace falta
// pasar al modelo nuevo, hará falta activar facturación en Google AI Studio.
const MODEL = 'gemini-2.5-flash-image';

async function llamarGeminiImagen(parts, systemInstruction) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY no configurada');

  const body = { contents: [{ parts }] };
  if (systemInstruction) body.system_instruction = { parts: [{ text: systemInstruction }] };

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + encodeURIComponent(apiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

async function editarImagenConIA({ baseBase64, baseMediaType, refImagenes, instruccion, direccionCreativa }) {
  const refs = (refImagenes || []).filter(Boolean);
  const parts = [
    { inline_data: { mime_type: baseMediaType, data: baseBase64 } },
  ];
  refs.forEach((r) => {
    parts.push({ inline_data: { mime_type: r.mediaType, data: r.base64 } });
  });
  const referenciaTexto = refs.length === 0 ? ''
    : refs.length === 1 ? '. Usa la segunda imagen como referencia del logo/texto/dibujo a aplicar'
    : '. Usa el resto de imágenes adjuntas (' + refs.length + ') como referencia de los logos/textos/dibujos a aplicar, cada uno donde tenga más sentido';
  parts.push({
    text: 'Edita la primera imagen (imagen base) integrando de forma realista lo que pide esta instrucción, ' +
      'respetando la perspectiva, la iluminación, las sombras y el material del objeto original, y siguiendo ' +
      'estrictamente la dirección creativa de Bendito Lab indicada en las instrucciones de sistema (fotografía ' +
      'editorial, imperfecciones reales, microdetalles, nada de aspecto genérico de IA)' +
      referenciaTexto +
      '. Instrucción: ' + instruccion,
  });
  return llamarGeminiImagen(parts, direccionCreativa);
}

/**
 * Se llama siempre al guardar un logo en la librería: si la imagen ya tiene
 * fondo transparente la deja tal cual, si no, elimina el fondo y devuelve un
 * PNG con transparencia — así todos los logos guardados quedan uniformes
 * sin que el usuario tenga que pensar en ello.
 */
async function asegurarFondoTransparente(base64, mediaType) {
  const parts = [
    { inline_data: { mime_type: mediaType, data: base64 } },
    {
      text: 'Esta imagen es un logo. Si ya tiene el fondo transparente, devuélvela exactamente igual, sin ' +
        'ningún cambio. Si tiene un fondo de color, textura o cualquier elemento que no sea parte del logo, ' +
        'elimina ese fondo por completo y devuelve el logo recortado sobre fondo transparente, en formato PNG. ' +
        'No modifiques el logo en sí (forma, colores, texto) — solo el fondo.',
    },
  ];
  return llamarGeminiImagen(parts);
}

module.exports = { editarImagenConIA, asegurarFondoTransparente };
