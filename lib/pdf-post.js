// lib/pdf-post.js — Genera un PDF de una página por post: imagen + copy de
// cada canal que tenga contenido. Se usa tanto para la descarga directa
// como para la copia que se sube a Drive (Contenido/Redes sociales).
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const INK = rgb(0x14 / 255, 0x11 / 255, 0x0f / 255);
const GRIS = rgb(0.55, 0.55, 0.55);
const PAGE_W = 595; // A4 a 72dpi
const PAGE_H = 842;
const MARGEN = 40;

// Las fuentes estándar de PDF (Helvetica) solo soportan WinAnsi (Latin-1,
// hasta el código 255) — conserva tildes/ñ pero no emojis (📧, 🤖, ✓...),
// que están muy por encima de ese rango y hacían fallar drawText().
function limpiarParaPdf(text) {
  return Array.from(String(text || ''))
    .filter(function (ch) { return ch.codePointAt(0) <= 255; })
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function envolverTexto(font, size, text, maxWidth) {
  var palabras = String(text || '').split(/\s+/);
  var lineas = [];
  var actual = '';
  palabras.forEach(function (palabra) {
    var probando = actual ? actual + ' ' + palabra : palabra;
    if (font.widthOfTextAtSize(probando, size) > maxWidth && actual) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = probando;
    }
  });
  if (actual) lineas.push(actual);
  return lineas;
}

async function generarPdfPost(post) {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGEN;

  page.drawText('BENDITO LAB · GENERADOR DE CONTENIDO', {
    x: MARGEN, y, size: 9, font: fontBold, color: GRIS,
  });
  y -= 24;

  // Imagen
  try {
    const imgRes = await fetch(post.image_url);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get('content-type') || '';
    let embedded;
    if (contentType.includes('png')) embedded = await doc.embedPng(imgBuf);
    else embedded = await doc.embedJpg(imgBuf);

    const maxW = PAGE_W - MARGEN * 2;
    const maxH = 300;
    const ratio = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
    const w = embedded.width * ratio;
    const h = embedded.height * ratio;
    page.drawImage(embedded, { x: MARGEN, y: y - h, width: w, height: h });
    y -= h + 20;
  } catch (e) {
    page.drawText('(No se pudo incrustar la imagen: ' + e.message + ')', { x: MARGEN, y, size: 9, font: fontRegular, color: GRIS });
    y -= 20;
  }

  function seccion(titulo, textoOriginal) {
    const texto = limpiarParaPdf(textoOriginal);
    if (!texto) return;
    if (y < 80) return; // sin paginación por ahora: recorta si no cabe
    page.drawText(titulo, { x: MARGEN, y, size: 9, font: fontBold, color: GRIS });
    y -= 14;
    const lineas = envolverTexto(fontRegular, 11, texto, PAGE_W - MARGEN * 2);
    lineas.forEach(function (linea) {
      if (y < 40) return;
      page.drawText(linea, { x: MARGEN, y, size: 11, font: fontRegular, color: INK });
      y -= 15;
    });
    y -= 10;
  }

  seccion('CUENTA', post.cuenta === 'dilobonito' ? 'Dilo Bonito' : 'Bendito Lab');
  if (post.carpeta) seccion('CARPETA', post.carpeta);
  if (post.fecha_programada) seccion('FECHA DE PUBLICACIÓN', post.fecha_programada);
  seccion('INSTAGRAM', [post.ig_caption, post.ig_hashtags].filter(Boolean).join('\n'));
  seccion('LINKEDIN', [post.li_caption, post.li_hashtags].filter(Boolean).join('\n'));
  seccion('WHATSAPP', post.wa_text);
  seccion('STORIES', post.stories_text);
  if (post.prompt_edicion_externa) seccion('PROMPT DE EDICIÓN DE IMAGEN', post.prompt_edicion_externa);

  return Buffer.from(await doc.save());
}

module.exports = { generarPdfPost };
