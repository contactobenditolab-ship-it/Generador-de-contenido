// lib/google-drive.js — Sube los PDF de posts a Google Drive, dentro de
// Contenido/<subcarpeta> en la misma carpeta raíz que usa bendito-os
// (Configuración → Drive) — "Redes sociales" para el PDF final listo para
// publicar, "Pendiente redes sociales" para el PDF de trabajo (prompts,
// logo, inspiración). Reutiliza el mismo refresh_token guardado en
// google_drive_auth. No hace falta autorizar nada aparte aquí.
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const REDIRECT_URI = 'https://app.benditolab.com/api/auth/google/callback';

let cachedClient = null;
function db() {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas');
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

async function getDriveClient() {
  const supabase = db();
  const { data } = await supabase
    .from('google_drive_auth')
    .select('refresh_token, carpeta_raiz_id')
    .eq('id', 1)
    .maybeSingle();

  if (!data?.refresh_token) return null;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: data.refresh_token });

  return { drive: google.drive({ version: 'v3', auth: oauth2Client }), carpetaRaizId: data.carpeta_raiz_id };
}

async function buscarOCrearCarpeta(drive, nombre, parentId) {
  const q = "name = '" + nombre.replace(/'/g, "\\'") + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false" +
    (parentId ? " and '" + parentId + "' in parents" : " and 'root' in parents");
  const res = await drive.files.list({ q, fields: 'files(id, name)' });
  const existente = res.data.files && res.data.files[0];
  if (existente && existente.id) return existente.id;

  const creado = await drive.files.create({
    requestBody: {
      name: nombre,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id',
  });
  return creado.data.id;
}

/** Sube un PDF a Drive, en <raíz de bendito-os>/Contenido/<subcarpeta>. Devuelve el link o null si Drive no está conectado. */
async function subirPdfAContenido(nombreArchivo, buffer, subcarpeta) {
  const cliente = await getDriveClient();
  if (!cliente) return null;
  const { drive, carpetaRaizId } = cliente;

  const carpetaContenido = await buscarOCrearCarpeta(drive, 'Contenido', carpetaRaizId);
  const carpetaDestino = await buscarOCrearCarpeta(drive, subcarpeta, carpetaContenido);

  const { Readable } = await import('stream');
  const stream = Readable.from(buffer);

  const res = await drive.files.create({
    requestBody: { name: nombreArchivo, parents: [carpetaDestino] },
    media: { mimeType: 'application/pdf', body: stream },
    fields: 'id, webViewLink',
  });

  return res.data.webViewLink || null;
}

module.exports = { subirPdfAContenido };
