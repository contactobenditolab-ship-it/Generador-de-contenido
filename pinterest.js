// lib/pinterest.js — Conexión OAuth con Pinterest (API v5) y utilidades
// para listar tableros y traer pines nuevos a Inspiración. Requiere
// PINTEREST_CLIENT_ID y PINTEREST_CLIENT_SECRET (developers.pinterest.com).
const { createClient } = require('@supabase/supabase-js');

const REDIRECT_URI = 'https://generador-de-contenido.vercel.app/api/auth/pinterest/callback';
const AUTH_BASE = 'https://www.pinterest.com/oauth/';
const API_BASE = 'https://api.pinterest.com/v5';

let cachedClient = null;
function db() {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas');
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

function getAuthUrl(state) {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  if (!clientId) throw new Error('PINTEREST_CLIENT_ID no configurada');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'boards:read,pins:read',
    state,
  });
  return AUTH_BASE + '?' + params.toString();
}

function basicAuthHeader() {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PINTEREST_CLIENT_ID / PINTEREST_CLIENT_SECRET no configuradas');
  return 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64');
}

async function intercambiarCodigo(code) {
  const res = await fetch(API_BASE + '/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!res.ok) throw new Error('Pinterest oauth/token error (' + res.status + '): ' + await res.text());
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

async function refrescarToken(refreshToken) {
  const res = await fetch(API_BASE + '/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error('Pinterest refresh_token error (' + res.status + '): ' + await res.text());
  return res.json();
}

/** Devuelve un access_token válido, refrescándolo si hace falta. null si no hay conexión. */
async function obtenerAccessToken() {
  const supabase = db();
  const { data } = await supabase.from('pinterest_auth').select('*').eq('id', 1).maybeSingle();
  if (!data || !data.access_token) return null;
  // Token generado a mano desde el panel de developers.pinterest.com (sin
  // client secret disponible, p.ej. mientras la app está en "trial
  // pendiente"): no hay refresh_token, así que se usa tal cual hasta que
  // caduque y haya que generar uno nuevo.
  if (!data.refresh_token) return data.access_token;

  try {
    const tokens = await refrescarToken(data.refresh_token);
    if (tokens.access_token) {
      await supabase.from('pinterest_auth').update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || data.refresh_token,
        updated_at: new Date().toISOString(),
      }).eq('id', 1);
      return tokens.access_token;
    }
  } catch (e) {
    console.error('No se pudo refrescar el token de Pinterest, se usa el guardado:', e.message);
  }
  return data.access_token || null;
}

async function listarTableros() {
  const token = await obtenerAccessToken();
  if (!token) throw new Error('Pinterest no está conectado');
  const res = await fetch(API_BASE + '/boards?page_size=100', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Pinterest boards error (' + res.status + '): ' + await res.text());
  const data = await res.json();
  return (data.items || []).map((b) => ({ id: b.id, nombre: b.name }));
}

function mejorImagenDePin(pin) {
  const images = pin.media && pin.media.images;
  if (!images) return null;
  const orden = ['1200x', '600x', '400x300', '150x150'];
  for (const clave of orden) {
    if (images[clave] && images[clave].url) return images[clave].url;
  }
  const primera = Object.values(images)[0];
  return primera ? primera.url : null;
}

/** Trae los pines del tablón configurado creados después de la última sincronización. */
async function sincronizarPinesNuevos() {
  const supabase = db();
  const { data: conexion } = await supabase.from('pinterest_auth').select('*').eq('id', 1).maybeSingle();
  if (!conexion || !conexion.board_id) return { importados: 0 };

  const token = await obtenerAccessToken();
  if (!token) return { importados: 0 };

  const res = await fetch(API_BASE + '/boards/' + conexion.board_id + '/pins?page_size=100', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Pinterest pins error (' + res.status + '): ' + await res.text());
  const data = await res.json();
  const pines = data.items || [];

  const desde = conexion.last_sync_at ? new Date(conexion.last_sync_at) : null;
  let importados = 0;

  for (const pin of pines) {
    if (desde && pin.created_at && new Date(pin.created_at) <= desde) continue;
    const url = mejorImagenDePin(pin);
    if (!url) continue;

    const { data: yaExiste } = await supabase.from('inspirations').select('id').eq('image_url', url).maybeSingle();
    if (yaExiste) continue;

    const { data: creada } = await supabase.from('inspirations').insert({ image_url: url, prompt: pin.title || pin.description || null }).select().single();
    importados++;

    // Copia también a Drive (Contenido/Inspiración), igual que las subidas
    // manuales — si falla no bloquea el resto de la sincronización.
    try {
      const { subirArchivoAContenido } = require('./google-drive');
      const resImg = await fetch(url);
      const contentType = resImg.headers.get('content-type') || 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const buffer = Buffer.from(await resImg.arrayBuffer());
      await subirArchivoAContenido('inspiracion-' + (creada ? creada.id : Date.now()) + '.' + ext, buffer, 'Inspiración', contentType);
      if (creada) await supabase.from('inspirations').update({ drive_uploaded: true }).eq('id', creada.id);
    } catch (e) {
      console.error('No se pudo subir el pin a Drive:', e.message);
    }
  }

  await supabase.from('pinterest_auth').update({ last_sync_at: new Date().toISOString() }).eq('id', 1);
  return { importados };
}

module.exports = { getAuthUrl, intercambiarCodigo, listarTableros, sincronizarPinesNuevos };
