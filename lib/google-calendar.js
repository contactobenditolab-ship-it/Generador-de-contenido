// lib/google-calendar.js — Sincroniza los posts programados con el MISMO
// Google Calendar que usa bendito-os (mismo proyecto Supabase, tabla
// google_drive_auth con el refresh_token ya autorizado desde Configuración
// → Drive en bendito-os). No hace falta un flujo OAuth propio aquí: si
// bendito-os tiene la conexión activa, este repo también.
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const CALENDAR_ID = 'primary';
// Solo se usa para construir el cliente OAuth2; como aquí nunca se pide
// consentimiento (se reutiliza el refresh_token ya guardado), el valor no
// necesita coincidir con ningún endpoint real de este repo.
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

async function getCalendarClient() {
  const supabase = db();
  const { data } = await supabase
    .from('google_drive_auth')
    .select('refresh_token')
    .eq('id', 1)
    .maybeSingle();

  if (!data?.refresh_token) return null;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: data.refresh_token });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Crea o actualiza el evento de un post programado. Devuelve el gcalId
 * (nuevo o el mismo si ya existía) o null si Calendar no está conectado.
 */
async function sincronizarPostCalendar(post) {
  const calendar = await getCalendarClient();
  if (!calendar) return null;

  const resumen = (post.cuenta === 'dilobonito' ? 'Dilo Bonito' : 'Bendito Lab') +
    ' · ' + (post.carpeta ? post.carpeta : 'Publicación en redes');
  const descripcion = [post.ig_caption, post.wa_text].filter(Boolean).join('\n\n').slice(0, 500) ||
    'Post generado en el generador de contenido de Bendito Lab.';

  const evento = {
    summary: '📱 ' + resumen,
    description: descripcion,
    start: { date: post.fecha_programada },
    end: { date: post.fecha_programada }, // se ajusta abajo (exclusivo)
  };
  const finExclusivo = new Date(post.fecha_programada + 'T00:00:00Z');
  finExclusivo.setUTCDate(finExclusivo.getUTCDate() + 1);
  evento.end.date = finExclusivo.toISOString().slice(0, 10);

  try {
    if (post.gcal_id) {
      const res = await calendar.events.update({ calendarId: CALENDAR_ID, eventId: post.gcal_id, requestBody: evento });
      return res.data.id ?? post.gcal_id;
    }
    const res = await calendar.events.insert({ calendarId: CALENDAR_ID, requestBody: evento });
    return res.data.id ?? null;
  } catch (err) {
    console.error('Error sincronizando post con Google Calendar:', err.message);
    return null;
  }
}

async function eliminarEventoPost(gcalId) {
  if (!gcalId) return;
  const calendar = await getCalendarClient();
  if (!calendar) return;
  try {
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: gcalId });
  } catch (err) {
    console.error('Error eliminando evento de Google Calendar:', err.message);
  }
}

module.exports = { sincronizarPostCalendar, eliminarEventoPost };
