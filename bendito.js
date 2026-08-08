// GET  /api/bendito?tipo=posts|inspirations                          (auth)
// POST /api/bendito { accion, ... }                                   (auth)
//
// Backend del generador de contenido con IA de /bendito-app (pestaña
// "Bendito Lab & Dilo Bonito · App interna de contenido"). Todo en un único
// endpoint (posts, inspiraciones, subida de imagen a Blob, sugerencia de
// prompt y generación de copy con Claude) para no pasar del límite de
// Serverless Functions del plan — mismo criterio que api/db.js.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { put } = require('@vercel/blob');
const { requireAuth } = require('../lib/auth');
const { callGeminiVisionJSON } = require('../lib/gemini-text');
const { DIRECCION_CREATIVA_DEFAULT, promptSugerirSystem, copySystem, promptEdicionExternaSystem } = require('../lib/bendito-prompts');
const { editarImagenConIA, asegurarFondoTransparente } = require('../lib/gemini-image');
const { sincronizarPostCalendar, eliminarEventoPost } = require('../lib/google-calendar');
const { generarPdfFinal, generarPdfPendiente } = require('../lib/pdf-post');
const { subirPdfAContenido, subirArchivoAContenido } = require('../lib/google-drive');
const { listarTableros: listarTablerosPinterest, sincronizarPinesNuevos: sincronizarPinesPinterest } = require('../lib/pinterest');

const MAX_BYTES = 4 * 1024 * 1024; // deja margen bajo el límite de 4.5MB de body de Vercel
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const CUENTAS = ['bendito_lab', 'dilobonito'];

let cachedClient = null;
function db() {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas');
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

/** Dirección creativa activa: la guardada en Ajustes, o si no hay ninguna, la de por defecto. */
async function obtenerDireccionCreativa(supabase) {
  const { data } = await supabase.from('configuracion_generador').select('direccion_creativa').eq('id', 1).maybeSingle();
  return (data && data.direccion_creativa) ? data.direccion_creativa : DIRECCION_CREATIVA_DEFAULT;
}

async function subirImagen(body) {
  const { base64, mediaType, filename } = body;
  if (typeof base64 !== 'string' || !base64) throw new Error('Falta base64');
  const ext = EXT_BY_MIME[mediaType];
  if (!ext) throw new Error('Tipo de imagen no soportado: ' + mediaType);

  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) throw new Error('Imagen vacía');
  if (buf.length > MAX_BYTES) throw new Error('Imagen demasiado grande (máx 4MB)');

  const safeName = String(filename || 'inspiracion').replace(/[^a-zA-Z0-9_-]/g, '-');
  const path = 'bendito-app/' + safeName + '-' + Date.now() + '.' + ext;
  const result = await put(path, buf, { access: 'public', contentType: mediaType, addRandomSuffix: false });
  return { url: result.url, path };
}

const MEDIA_TYPE_BY_CONTENT_TYPE = { 'image/png': 'image/png', 'image/jpeg': 'image/jpeg', 'image/webp': 'image/webp', 'image/gif': 'image/gif' };
const EXT_BY_MEDIA_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Descarga una imagen ya subida (p.ej. un logo guardado) y la devuelve en base64, para pasársela a Gemini. */
async function descargarImagenBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('No se pudo descargar la imagen de referencia (' + res.status + ')');
  const contentType = res.headers.get('content-type') || 'image/png';
  const mediaType = MEDIA_TYPE_BY_CONTENT_TYPE[contentType] || 'image/png';
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString('base64'), mediaType };
}

/**
 * Normaliza las distintas formas en que puede llegar el logo/referencia
 * (un único refBase64/refImageUrl "de toda la vida", o un array
 * refImagenes con varios logos elegidos en el Generador IA) a una lista
 * de { base64, mediaType } lista para mandar a Gemini.
 */
async function resolverRefImagenes({ refBase64, refMediaType, refImageUrl, refImagenes }) {
  const entradas = Array.isArray(refImagenes) && refImagenes.length
    ? refImagenes
    : (refBase64 || refImageUrl) ? [{ base64: refBase64, mediaType: refMediaType, url: refImageUrl }] : [];
  const resueltas = [];
  for (const entrada of entradas) {
    if (entrada.base64) {
      resueltas.push({ base64: entrada.base64, mediaType: entrada.mediaType });
    } else if (entrada.url) {
      resueltas.push(await descargarImagenBase64(entrada.url));
    }
  }
  return resueltas;
}

/**
 * Sube la imagen final de un post (la portada, tal cual queda guardada en
 * image_url) a Drive → Contenido/Imágenes finales. Si Drive no está
 * conectado o falla, no bloquea el guardado del post — igual que el resto
 * de subidas a Drive de este archivo.
 */
async function subirImagenFinalADrive(post) {
  try {
    const descargada = await descargarImagenBase64(post.image_url);
    const ext = EXT_BY_MEDIA_TYPE[descargada.mediaType] || 'jpg';
    const nombreBase = ((post.carpeta ? post.carpeta + ' — ' : '') + (post.sub || post.cuenta) + ' — ' + post.id)
      .replace(/[\\/]/g, '-');
    await subirArchivoAContenido(nombreBase + '.' + ext, Buffer.from(descargada.base64, 'base64'), 'Imágenes finales', descargada.mediaType);
  } catch (e) {
    console.error('No se pudo subir la imagen final a Drive:', e.message);
  }
}

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const tipo = req.query.tipo;
      const supabase = db();

      if (tipo === 'posts') {
        const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return res.status(200).json({ data: data || [] });
      }
      if (tipo === 'inspirations') {
        const { data, error } = await supabase.from('inspirations').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return res.status(200).json({ data: data || [] });
      }
      if (tipo === 'logos') {
        const { data, error } = await supabase.from('logos').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return res.status(200).json({ data: data || [] });
      }
      if (tipo === 'carpetas') {
        const { data, error } = await supabase.from('carpetas').select('*').order('nombre', { ascending: true });
        if (error) throw error;
        return res.status(200).json({ data: data || [] });
      }
      if (tipo === 'configuracion') {
        const direccionCreativa = await obtenerDireccionCreativa(supabase);
        return res.status(200).json({ direccion_creativa: direccionCreativa, es_valor_por_defecto: direccionCreativa === DIRECCION_CREATIVA_DEFAULT });
      }
      if (tipo === 'pinterest_estado') {
        const { data } = await supabase.from('pinterest_auth').select('access_token, refresh_token, board_id, board_nombre, last_sync_at').eq('id', 1).maybeSingle();
        return res.status(200).json({
          conectado: !!(data && (data.access_token || data.refresh_token)),
          board_id: data?.board_id || null,
          board_nombre: data?.board_nombre || null,
          last_sync_at: data?.last_sync_at || null,
        });
      }
      return res.status(400).json({ error: 'tipo desconocido' });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      body = body || {};
      const accion = body.accion;
      const supabase = db();

      if (accion === 'subirImagen') {
        const data = await subirImagen(body);
        return res.status(200).json({ ok: true, ...data });
      }

      if (accion === 'sugerirPrompt') {
        const { base64, mediaType } = body;
        if (!base64 || !mediaType) return res.status(400).json({ error: 'Falta base64 o mediaType' });
        const direccionCreativa = await obtenerDireccionCreativa(supabase);
        const result = await callGeminiVisionJSON({
          system: promptSugerirSystem(direccionCreativa),
          userText: 'Genera la ficha estructurada y el prompt sugerido para esta imagen.',
          base64, mediaType, maxTokens: 500,
        });
        return res.status(200).json(result);
      }

      if (accion === 'generarCopy') {
        const { base64, mediaType, prompt, cuenta, formato } = body;
        if (!base64 || !mediaType || !prompt) return res.status(400).json({ error: 'Faltan campos obligatorios' });
        const direccionCreativa = await obtenerDireccionCreativa(supabase);
        const userText = 'Cuenta: ' + (cuenta === 'dilobonito' ? 'Dilo Bonito' : 'Bendito Lab') +
          '\nFormato principal solicitado: ' + formato +
          '\nPrompt del usuario: ' + prompt +
          '\n\nGenera el JSON con el copy para los 4 canales, priorizando calidad especialmente en el formato principal solicitado.';
        const result = await callGeminiVisionJSON({ system: copySystem(direccionCreativa), userText, base64, mediaType, maxTokens: 1000 });
        return res.status(200).json(result);
      }

      if (accion === 'editarConIA') {
        let { baseBase64, baseMediaType, refBase64, refMediaType, refImageUrl, refImagenes, instruccion } = body;
        if (!baseBase64 || !baseMediaType || !instruccion) {
          return res.status(400).json({ error: 'Faltan campos obligatorios (imagen base e instrucción)' });
        }
        const refs = await resolverRefImagenes({ refBase64, refMediaType, refImageUrl, refImagenes });
        const direccionCreativa = await obtenerDireccionCreativa(supabase);
        const result = await editarImagenConIA({ baseBase64, baseMediaType, refImagenes: refs, instruccion, direccionCreativa });
        return res.status(200).json({ ok: true, ...result });
      }

      if (accion === 'generarPromptEdicion') {
        let { baseBase64, baseMediaType, refBase64, refMediaType, refImageUrl, refImagenes, instruccion } = body;
        if (!baseBase64 || !baseMediaType || !instruccion) {
          return res.status(400).json({ error: 'Faltan campos obligatorios (imagen base e instrucción)' });
        }
        const refs = await resolverRefImagenes({ refBase64, refMediaType, refImageUrl, refImagenes });
        const direccionCreativa = await obtenerDireccionCreativa(supabase);
        const userText = 'Instrucción del usuario sobre qué integrar/cambiar: ' + instruccion +
          (refs.length === 1 ? '\n\nLa segunda imagen adjunta es la referencia del logo/texto/dibujo a integrar.'
            : refs.length > 1 ? '\n\nEl resto de imágenes adjuntas (' + refs.length + ') son referencias de los logos/textos/dibujos a integrar.' : '');
        const result = await callGeminiVisionJSON({
          system: promptEdicionExternaSystem(direccionCreativa),
          userText,
          base64: baseBase64,
          mediaType: baseMediaType,
          extraImages: refs.length ? refs : undefined,
          maxTokens: 800,
        });
        return res.status(200).json(result);
      }

      if (accion === 'guardarConfiguracion') {
        const direccionCreativa = typeof body.direccion_creativa === 'string' ? body.direccion_creativa.trim() : '';
        const { data, error } = await supabase
          .from('configuracion_generador')
          .upsert({ id: 1, direccion_creativa: direccionCreativa || null, updated_at: new Date().toISOString() })
          .select().single();
        if (error) throw error;
        return res.status(200).json({ ok: true, data });
      }

      if (accion === 'guardarTokenPinterest') {
        const accessToken = typeof body.access_token === 'string' ? body.access_token.trim() : '';
        if (!accessToken) return res.status(400).json({ error: 'Falta access_token' });
        const { error } = await supabase.from('pinterest_auth').upsert({
          id: 1, access_token: accessToken, updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (accion === 'listarTablerosPinterest') {
        try {
          const tableros = await listarTablerosPinterest();
          return res.status(200).json({ ok: true, tableros });
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }

      if (accion === 'guardarTableroPinterest') {
        const { board_id, board_nombre } = body;
        if (!board_id) return res.status(400).json({ error: 'Falta board_id' });
        const { error } = await supabase.from('pinterest_auth').update({
          board_id, board_nombre: board_nombre || null, updated_at: new Date().toISOString(),
        }).eq('id', 1);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (accion === 'sincronizarPinterestAhora') {
        try {
          const result = await sincronizarPinesPinterest();
          return res.status(200).json({ ok: true, ...result });
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }

      if (accion === 'buscarLogoPorHash') {
        const { image_hash } = body;
        if (!image_hash) return res.status(400).json({ error: 'Falta image_hash' });
        const { data, error } = await supabase.from('logos').select('id, nombre, image_url').eq('image_hash', image_hash).maybeSingle();
        if (error) throw error;
        return res.status(200).json({ existe: !!data, data: data || null });
      }

      if (accion === 'subirLogo') {
        const { base64, mediaType, nombre, image_hash } = body;
        if (!base64 || !mediaType) return res.status(400).json({ error: 'Falta la imagen del logo' });

        if (image_hash) {
          const { data: existente } = await supabase.from('logos').select('id, nombre, image_url').eq('image_hash', image_hash).maybeSingle();
          if (existente) return res.status(200).json({ ok: true, duplicado: true, data: existente });
        }

        // Fondo transparente siempre: si ya lo tiene, la IA la devuelve
        // igual; si no, se lo quita. Si la IA falla (cuota, etc.) no se
        // bloquea el guardado — se sube la imagen original tal cual.
        let procesado = { base64, mediaType };
        try {
          procesado = await asegurarFondoTransparente(base64, mediaType);
        } catch (e) {
          console.error('No se pudo asegurar el fondo transparente del logo, se sube tal cual:', e.message);
        }

        const subido = await subirImagen({ base64: procesado.base64, mediaType: procesado.mediaType, filename: 'logo-' + (nombre || 'sin-nombre') });
        const { data, error } = await supabase
          .from('logos')
          .insert({ nombre: String(nombre || 'Sin nombre').slice(0, 120), image_url: subido.url, image_hash: image_hash || null })
          .select().single();
        if (error) throw error;

        // Copia también en Drive (Contenido/Logos) — si Drive no está
        // conectado o falla, no bloquea el guardado del logo.
        try {
          const ext = EXT_BY_MEDIA_TYPE[procesado.mediaType] || 'png';
          const nombreArchivo = String(nombre || 'logo').replace(/[^a-zA-Z0-9_\- ]+/g, '').trim() + '.' + ext;
          await subirArchivoAContenido(nombreArchivo, Buffer.from(procesado.base64, 'base64'), 'Logos', procesado.mediaType);
        } catch (e) {
          console.error('No se pudo subir el logo a Drive:', e.message);
        }

        return res.status(200).json({ ok: true, data });
      }

      if (accion === 'eliminarLogo') {
        const id = body.id;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        const { error } = await supabase.from('logos').delete().eq('id', id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (accion === 'crearCarpeta') {
        const nombre = String(body.nombre || '').trim().slice(0, 120);
        if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
        const { data, error } = await supabase.from('carpetas').insert({ nombre }).select().single();
        if (error) {
          if (error.code === '23505') return res.status(400).json({ error: 'Ya existe una carpeta con ese nombre' });
          throw error;
        }
        return res.status(200).json({ ok: true, data });
      }

      if (accion === 'eliminarCarpeta') {
        const id = body.id;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        const { error } = await supabase.from('carpetas').delete().eq('id', id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (accion === 'buscarInspiracionPorHash') {
        const { image_hash } = body;
        if (!image_hash) return res.status(400).json({ error: 'Falta image_hash' });
        const { data, error } = await supabase.from('inspirations').select('id, image_url').eq('image_hash', image_hash).maybeSingle();
        if (error) throw error;
        return res.status(200).json({ existe: !!data, data: data || null });
      }

      if (accion === 'crearInspiracionDesdeUrl') {
        const { url, prompt } = body;
        if (!url) return res.status(400).json({ error: 'Falta la URL de la imagen' });

        let descargada;
        try {
          descargada = await descargarImagenBase64(url);
        } catch (e) {
          return res.status(400).json({ error: 'No se pudo descargar esa imagen (¿el enlace es directo a la imagen, no a la página de Pinterest?): ' + e.message });
        }
        const hash = crypto.createHash('sha256').update(Buffer.from(descargada.base64, 'base64')).digest('hex');

        const { data: existente } = await supabase.from('inspirations').select('id, image_url').eq('image_hash', hash).maybeSingle();
        if (existente) return res.status(200).json({ ok: true, duplicado: true, data: existente });

        const subido = await subirImagen({ base64: descargada.base64, mediaType: descargada.mediaType, filename: 'pinterest-url' });
        const { data, error } = await supabase
          .from('inspirations')
          .insert({ image_url: subido.url, prompt: prompt || null, image_hash: hash })
          .select().single();
        if (error) throw error;

        try {
          const ext = EXT_BY_MEDIA_TYPE[descargada.mediaType] || 'jpg';
          await subirArchivoAContenido('inspiracion-' + data.id + '.' + ext, Buffer.from(descargada.base64, 'base64'), 'Inspiración', descargada.mediaType);
          await supabase.from('inspirations').update({ drive_uploaded: true }).eq('id', data.id);
        } catch (e) {
          console.error('No se pudo subir la imagen de inspiración a Drive:', e.message);
        }

        return res.status(200).json({ ok: true, data });
      }

      if (accion === 'crearInspiracion') {
        const { image_url, prompt, image_hash } = body;
        if (!image_url) return res.status(400).json({ error: 'Falta image_url' });
        if (image_hash) {
          const { data: existente } = await supabase.from('inspirations').select('id, image_url').eq('image_hash', image_hash).maybeSingle();
          if (existente) return res.status(200).json({ ok: true, duplicado: true, data: existente });
        }
        const { data, error } = await supabase.from('inspirations').insert({ image_url, prompt: prompt || null, image_hash: image_hash || null }).select().single();
        if (error) throw error;

        // Copia también en Drive (Contenido/Inspiración) — si Drive no
        // está conectado o falla, no bloquea el guardado de la imagen.
        try {
          const descargada = await descargarImagenBase64(image_url);
          const ext = EXT_BY_MEDIA_TYPE[descargada.mediaType] || 'png';
          await subirArchivoAContenido('inspiracion-' + data.id + '.' + ext, Buffer.from(descargada.base64, 'base64'), 'Inspiración', descargada.mediaType);
          await supabase.from('inspirations').update({ drive_uploaded: true }).eq('id', data.id);
        } catch (e) {
          console.error('No se pudo subir la imagen de inspiración a Drive:', e.message);
        }

        return res.status(200).json({ ok: true, data });
      }

      if (accion === 'actualizarInspiracion') {
        const { id, prompt, used, drive_uploaded, prompt_edicion_externa } = body;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        const patch = {};
        if (prompt !== undefined) patch.prompt = prompt;
        if (used !== undefined) patch.used = !!used;
        if (drive_uploaded !== undefined) patch.drive_uploaded = !!drive_uploaded;
        if (prompt_edicion_externa !== undefined) patch.prompt_edicion_externa = prompt_edicion_externa;
        const { data, error } = await supabase.from('inspirations').update(patch).eq('id', id).select().single();
        if (error) throw error;
        return res.status(200).json({ ok: true, data });
      }

      if (accion === 'eliminarInspiracion') {
        const id = body.id;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        const { error } = await supabase.from('inspirations').delete().eq('id', id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (accion === 'crearPost') {
        const d = body.post;
        if (!d || !d.image_url || !CUENTAS.includes(d.cuenta)) return res.status(400).json({ error: 'Datos de post inválidos' });
        const post = {
          cuenta: d.cuenta,
          handle: String(d.handle || '').slice(0, 120),
          sub: d.sub ? String(d.sub).slice(0, 200) : null,
          image_url: d.image_url,
          ig_caption: d.ig_caption || null,
          ig_hashtags: d.ig_hashtags || null,
          li_name: d.li_name || null,
          li_role: d.li_role || null,
          li_caption: d.li_caption || null,
          li_hashtags: d.li_hashtags || null,
          wa_text: d.wa_text || null,
          stories_text: d.stories_text || null,
          fecha: d.fecha || null,
          fecha_programada: d.fecha_programada || null,
          carpeta: d.carpeta ? String(d.carpeta).slice(0, 120) : null,
          prompt_edicion_externa: d.prompt_edicion_externa || null,
          inspiration_id: body.inspiration_id || null,
          logo_url: d.logo_url || null,
        };
        const { data, error } = await supabase.from('posts').insert(post).select().single();
        if (error) throw error;

        subirImagenFinalADrive(data).catch(() => {});

        if (body.inspiration_id) {
          supabase.from('inspirations').update({ used: true }).eq('id', body.inspiration_id).then(() => {});
        }

        if (data.fecha_programada) {
          const gcalId = await sincronizarPostCalendar(data);
          if (gcalId) {
            await supabase.from('posts').update({ gcal_id: gcalId }).eq('id', data.id);
            data.gcal_id = gcalId;
          }
        }
        return res.status(200).json({ ok: true, data });
      }

      if (accion === 'eliminarPost') {
        const id = body.id;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        const { data: existente } = await supabase.from('posts').select('gcal_id').eq('id', id).maybeSingle();
        const { error } = await supabase.from('posts').delete().eq('id', id);
        if (error) throw error;
        if (existente?.gcal_id) eliminarEventoPost(existente.gcal_id).catch(() => {});
        return res.status(200).json({ ok: true });
      }

      if (accion === 'descargarPdfPost') {
        const id = body.id;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        const { data: post, error: e1 } = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
        if (e1) throw e1;
        if (!post) return res.status(404).json({ error: 'Post no encontrado' });

        let inspiracion = null;
        if (post.inspiration_id) {
          const { data } = await supabase.from('inspirations').select('image_url, prompt').eq('id', post.inspiration_id).maybeSingle();
          inspiracion = data || null;
        }

        const nombreBase = ((post.carpeta ? post.carpeta + ' — ' : '') + (post.sub || post.cuenta)).replace(/[\\/]/g, '-');
        const bufferFinal = await generarPdfFinal(post);
        const bufferPendiente = await generarPdfPendiente(post, inspiracion);

        let driveLinkFinal = null;
        let driveLinkPendiente = null;
        try {
          driveLinkFinal = await subirPdfAContenido(nombreBase + '.pdf', bufferFinal, 'Redes sociales');
          driveLinkPendiente = await subirPdfAContenido(nombreBase + ' (pendiente).pdf', bufferPendiente, 'Pendiente redes sociales');
        } catch (e) {
          console.error('No se pudo subir el PDF a Drive:', e.message);
        }

        return res.status(200).json({
          ok: true,
          pdf_base64: bufferFinal.toString('base64'),
          drive_link: driveLinkFinal,
          drive_link_pendiente: driveLinkPendiente,
        });
      }

      if (accion === 'actualizarPost') {
        const id = body.id;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        const patch = {};
        if (body.publicado !== undefined) patch.publicado = !!body.publicado;
        if (body.carpeta !== undefined) patch.carpeta = body.carpeta ? String(body.carpeta).slice(0, 120) : null;
        if (body.fecha_programada !== undefined) patch.fecha_programada = body.fecha_programada || null;
        if (body.prompt_edicion_externa !== undefined) patch.prompt_edicion_externa = body.prompt_edicion_externa;
        if (body.logo_url !== undefined) patch.logo_url = body.logo_url;

        if (body.image_url !== undefined) {
          // Al cambiar la imagen "portada" de un post ya guardado, la
          // anterior no se pierde: pasa a la lista de variantes, para poder
          // volver a elegirla luego como base del generador.
          const { data: actual } = await supabase.from('posts').select('image_url, variantes').eq('id', id).maybeSingle();
          patch.image_url = body.image_url;
          if (actual && actual.image_url && actual.image_url !== body.image_url) {
            const variantes = Array.isArray(actual.variantes) ? actual.variantes.slice() : [];
            if (!variantes.includes(actual.image_url)) variantes.push(actual.image_url);
            patch.variantes = variantes;
          }
        }

        const { data, error } = await supabase.from('posts').update(patch).eq('id', id).select().single();
        if (error) throw error;

        if (patch.image_url !== undefined) {
          subirImagenFinalADrive(data).catch(() => {});
        }

        if (body.fecha_programada !== undefined) {
          if (data.fecha_programada) {
            const gcalId = await sincronizarPostCalendar(data);
            if (gcalId && gcalId !== data.gcal_id) {
              await supabase.from('posts').update({ gcal_id: gcalId }).eq('id', id);
              data.gcal_id = gcalId;
            }
          } else if (data.gcal_id) {
            eliminarEventoPost(data.gcal_id).catch(() => {});
            await supabase.from('posts').update({ gcal_id: null }).eq('id', id);
            data.gcal_id = null;
          }
        }
        return res.status(200).json({ ok: true, data });
      }

      if (accion === 'agregarVariante') {
        const { id, image_url } = body;
        if (!id || !image_url) return res.status(400).json({ error: 'Falta id o image_url' });
        const { data: actual, error: e1 } = await supabase.from('posts').select('variantes').eq('id', id).maybeSingle();
        if (e1) throw e1;
        if (!actual) return res.status(404).json({ error: 'Post no encontrado' });
        const variantes = Array.isArray(actual.variantes) ? actual.variantes.slice() : [];
        if (!variantes.includes(image_url)) variantes.push(image_url);
        const { data, error } = await supabase.from('posts').update({ variantes }).eq('id', id).select().single();
        if (error) throw error;
        return res.status(200).json({ ok: true, data });
      }

      if (accion === 'eliminarVariante') {
        const { id, image_url } = body;
        if (!id || !image_url) return res.status(400).json({ error: 'Falta id o image_url' });
        const { data: actual, error: e1 } = await supabase.from('posts').select('variantes').eq('id', id).maybeSingle();
        if (e1) throw e1;
        if (!actual) return res.status(404).json({ error: 'Post no encontrado' });
        const variantes = (Array.isArray(actual.variantes) ? actual.variantes : []).filter((u) => u !== image_url);
        const { data, error } = await supabase.from('posts').update({ variantes }).eq('id', id).select().single();
        if (error) throw error;
        return res.status(200).json({ ok: true, data });
      }

      return res.status(400).json({ error: 'Acción desconocida' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('Error /api/bendito:', e.message);
    return res.status(500).json({ error: e.message || 'Error en el servidor' });
  }
};
