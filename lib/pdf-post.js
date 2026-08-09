// lib/pdf-post.js — Genera dos PDF distintos de un post:
//
// - generarPdfFinal: solo las imágenes que componen el post (portada +
//   variantes/carrusel) y el copy de cada canal — la pieza lista para
//   publicar. Va a Drive → Contenido/Redes sociales.
// - generarPdfPendiente: además de eso, los prompts (el del copywriter y
//   el de edición de imagen), la imagen de inspiración original y el
//   logo usado — material de trabajo para seguir editando en otra IA. Va
//   a Drive → Contenido/Pendiente redes sociales.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const sharp = require('sharp');

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

async function construirPdf(post, opciones) {
  opciones = opciones || {};
  const inspiracion = opciones.inspiracion || null;
  const incluirMaterialDeTrabajo = !!opciones.incluirMaterialDeTrabajo;

  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  var page = doc.addPage([PAGE_W, PAGE_H]);
  var y = PAGE_H - MARGEN;

  function nuevaPagina() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGEN;
  }

  function asegurarEspacio(alto) {
    if (y - alto < MARGEN) nuevaPagina();
  }

  page.drawText('BENDITO LAB - GENERADOR DE CONTENIDO' + (incluirMaterialDeTrabajo ? ' (PENDIENTE)' : ''), {
    x: MARGEN, y, size: 9, font: fontBold, color: GRIS,
  });
  y -= 24;

  async function dibujarImagen(url, etiqueta) {
    try {
      const imgRes = await fetch(url);
      const imgBuf = Buffer.from(await imgRes.arrayBuffer());
      const contentType = imgRes.headers.get('content-type') || '';
      let embedded;
      if (contentType.includes('png')) {
        embedded = await doc.embedPng(imgBuf);
      } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
        embedded = await doc.embedJpg(imgBuf);
      } else {
        // pdf-lib solo sabe incrustar PNG/JPG — cualquier otro formato
        // (webp, gif, o content-type ausente/desconocido) se normaliza a
        // PNG primero. Cubre las subidas en WebP/GIF que la app sí admite
        // (ver EXT_BY_MIME en api/bendito.js) pero que antes rompían
        // silenciosamente el PDF final.
        const pngBuf = await sharp(imgBuf).png().toBuffer();
        embedded = await doc.embedPng(pngBuf);
      }

      const maxW = PAGE_W - MARGEN * 2;
      const maxH = 260;
      const ratio = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
      const w = embedded.width * ratio;
      const h = embedded.height * ratio;

      asegurarEspacio(h + 24);
      if (etiqueta) {
        page.drawText(limpiarParaPdf(etiqueta), { x: MARGEN, y, size: 9, font: fontBold, color: GRIS });
        y -= 14;
      }
      page.drawImage(embedded, { x: MARGEN, y: y - h, width: w, height: h });
      y -= h + 16;
    } catch (e) {
      asegurarEspacio(20);
      page.drawText(limpiarParaPdf('(No se pudo incrustar la imagen: ' + e.message + ')'), { x: MARGEN, y, size: 9, font: fontRegular, color: GRIS });
      y -= 20;
    }
  }

  function seccion(titulo, textoOriginal) {
    const texto = limpiarParaPdf(textoOriginal);
    if (!texto) return;
    const lineas = envolverTexto(fontRegular, 11, texto, PAGE_W - MARGEN * 2);
    asegurarEspacio(14 + lineas.length * 15 + 10);
    page.drawText(titulo, { x: MARGEN, y, size: 9, font: fontBold, color: GRIS });
    y -= 14;
    lineas.forEach(function (linea) {
      asegurarEspacio(15);
      page.drawText(linea, { x: MARGEN, y, size: 11, font: fontRegular, color: INK });
      y -= 15;
    });
    y -= 10;
  }

  // ── Datos generales ──────────────────────────────────
  seccion('CUENTA', post.cuenta === 'dilobonito' ? 'Dilo Bonito' : 'Bendito Lab');
  if (post.carpeta) seccion('CARPETA', post.carpeta);
  if (post.fecha_programada) seccion('FECHA DE PUBLICACION', post.fecha_programada);

  // ── Todas las imágenes del post: portada + variantes (carrusel) ──
  const variantes = Array.isArray(post.variantes) ? post.variantes : [];
  const todasLasImagenes = [post.image_url].concat(variantes.filter(function (u) { return u !== post.image_url; }));
  for (let i = 0; i < todasLasImagenes.length; i++) {
    await dibujarImagen(todasLasImagenes[i], todasLasImagenes.length > 1 ? 'IMAGEN ' + (i + 1) + ' DE ' + todasLasImagenes.length + (todasLasImagenes[i] === post.image_url ? ' (PORTADA)' : '') : 'IMAGEN');
  }

  if (incluirMaterialDeTrabajo) {
    // ── Imagen de inspiración original (si es distinta de las anteriores) ──
    if (inspiracion && inspiracion.image_url && todasLasImagenes.indexOf(inspiracion.image_url) === -1) {
      await dibujarImagen(inspiracion.image_url, 'IMAGEN DE INSPIRACION ORIGINAL');
    }
    // ── Logo usado ──────────────────────────────────────
    if (post.logo_url) {
      await dibujarImagen(post.logo_url, 'LOGO USADO');
    }
    // ── Prompts ─────────────────────────────────────────
    if (inspiracion && inspiracion.prompt) seccion('PROMPT (PARA EL COPYWRITER)', inspiracion.prompt);
    if (post.prompt_edicion_externa) seccion('PROMPT DE EDICION DE IMAGEN (PARA OTRA IA)', post.prompt_edicion_externa);
  }

  // ── Copy por canal ──────────────────────────────────
  seccion('INSTAGRAM', [post.ig_caption, post.ig_hashtags].filter(Boolean).join('\n'));
  seccion('LINKEDIN', [post.li_caption, post.li_hashtags].filter(Boolean).join('\n'));
  seccion('WHATSAPP', post.wa_text);
  seccion('STORIES', post.stories_text);

  return Buffer.from(await doc.save());
}

/** PDF "limpio": solo las imágenes del post y el copy — la pieza lista para publicar. */
function generarPdfFinal(post) {
  return construirPdf(post, { incluirMaterialDeTrabajo: false });
}

/** PDF de trabajo: además, prompts, imagen de inspiración y logo — para seguir editando. */
function generarPdfPendiente(post, inspiracion) {
  return construirPdf(post, { incluirMaterialDeTrabajo: true, inspiracion: inspiracion });
}

module.exports = { generarPdfFinal, generarPdfPendiente };
