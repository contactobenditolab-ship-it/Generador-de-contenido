// GET  /api/bendito?tipo=posts|inspirations                          (auth)
// POST /api/bendito { accion, ... }                                   (auth)
//
// Backend del generador de contenido con IA de /bendito-app (pestaña
// "Bendito Lab & Dilo Bonito · App interna de contenido"). Todo en un único
// endpoint (posts, inspiraciones, subida de imagen a Blob, sugerencia de
// prompt y generación de copy con Claude) para no pasar del límite de
// Serverless Functions del plan — mismo criterio que api/db.js.
const { createClient } = require('@supabase/supabase-js');
const { put } = require('@vercel/blob');
const { requireAuth } = require('../lib/auth');
const { callGeminiVisionJSON } = require('../lib/gemini-text');
const { DIRECCION_CREATIVA_DEFAULT, promptSugerirSystem, copySystem, promptEdicionExternaSystem } = require('../lib/bendito-prompts');
const { editarImagenConIA, asegurarFondoTransparente } = require('../lib/gemini-image');
const { sincronizarPostCalendar, eliminarEventoPost } = require('../lib/google-calendar');

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

/** Descarga una imagen ya subida (p.ej. un logo guardado) y la devuelve en base64, para pasársela a Gemini. */
async function descargarImagenBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('No se pudo descargar la imagen de referencia (' + res.status + ')');
  const contentType = res.headers.get('content-type') || 'image/png';
  const mediaType = MEDIA_TYPE_BY_CONTENT_TYPE[contentType] || 'image/png';
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString('base64'), mediaType };
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
        let { baseBase64, baseMediaType, refBase64, refMediaType, refImageUrl, instruccion } = body;
        if (!baseBase64 || !baseMediaType || !instruccion) {
          return res.status(400).json({ error: 'Faltan campos obligatorios (imagen base e instrucción)' });
        }
        if (!refBase64 && refImageUrl) {
          const descargada = await descargarImagenBase64(refImageUrl);
          refBase64 = descargada.base64;
          refMediaType = descargada.mediaType;
        }
        const direccionCreativa = await obtenerDireccionCreativa(supabase);
        const result = await editarImagenConIA({ baseBase64, baseMediaType, refBase64, refMediaType, instruccion, direccionCreativa });
        return res.status(200).json({ ok: true, ...result });
      }

      if (accion === 'generarPromptEdicion') {
        let { baseBase64, baseMediaType, refBase64, refMediaType, refImageUrl, instruccion } = body;
        if (!baseBase64 || !baseMediaType || !instruccion) {
          return res.status(400).json({ error: 'Faltan campos obligatorios (imagen base e instrucción)' });
        }
        if (!refBase64 && refImageUrl) {
          const descargada = await descargarImagenBase64(refImageUrl);
          refBase64 = descargada.base64;
          refMediaType = descargada.mediaType;
        }
        const direccionCreativa = await obtenerDireccionCreativa(supabase);
        const userText = 'Instrucción del usuario sobre qué integrar/cambiar: ' + instruccion +
          (refBase64 ? '\n\nLa segunda imagen adjunta es la referencia del logo/texto/dibujo a integrar.' : '');
        const result = await callGeminiVisionJSON({
          system: promptEdicionExternaSystem(direccionCreativa),
          userText,
          base64: baseBase64,
          mediaType: baseMediaType,
          extraImages: refBase64 ? [{ base64: refBase64, mediaType: refMediaType }] : undefined,
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

      if (accion === 'subirLogo') {
        const { base64, mediaType, nombre } = body;
        if (!base64 || !mediaType) return res.status(400).json({ error: 'Falta la imagen del logo' });

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
          .insert({ nombre: String(nombre || 'Sin nombre').slice(0, 120), image_url: subido.url })
          .select().single();
        if (error) throw error;
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

      if (accion === 'crearInspiracion') {
        const { image_url, prompt } = body;
        if (!image_url) return res.status(400).json({ error: 'Falta image_url' });
        const { data, error } = await supabase.from('inspirations').insert({ image_url, prompt: prompt || null }).select().single();
        if (error) throw error;
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
        };
        const { data, error } = await supabase.from('posts').insert(post).select().single();
        if (error) throw error;

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

      if (accion === 'actualizarPost') {
        const id = body.id;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        const patch = {};
        if (body.publicado !== undefined) patch.publicado = !!body.publicado;
        if (body.carpeta !== undefined) patch.carpeta = body.carpeta ? String(body.carpeta).slice(0, 120) : null;
        if (body.fecha_programada !== undefined) patch.fecha_programada = body.fecha_programada || null;
        if (body.prompt_edicion_externa !== undefined) patch.prompt_edicion_externa = body.prompt_edicion_externa;

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
