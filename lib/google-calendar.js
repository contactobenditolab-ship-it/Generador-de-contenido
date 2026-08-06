// lib/google-calendar.js — Sincroniza los posts programados con Google
// Calendar, reutilizando el MISMO token OAuth que bendito-os (mismo
// proyecto Supabase, tabla google_drive_auth, autorizado desde
// Configuración → Drive en bendito-os). No hace falta un flujo OAuth
// propio aquí: si bendito-os tiene la conexión activa, este repo también.
//
// A propósito NO se escribe en el calendario "primary" que usa bendito-os
// (presupuestos, producción, recordatorios…): estos posts van a un
// calendario secundario propio ("Redes sociales · Bendito Lab"), para que
// en Google Calendar se puedan activar/desactivar por separado — aquí solo
// interesan las redes, en bendito-os interesa todo junto.
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const NOMBRE_CALENDARIO = 'Redes sociales · Bendito Lab';
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
 * Devuelve el ID del calendario secundario "Redes sociales" (cacheado en
 * google_drive_auth.redes_calendar_id), creándolo la primera vez.
 */
async function getRedesCalendarId(calendar) {
  const supabase = db();
  const { data } = await supabase
    .from('google_drive_auth')
    .select('redes_calendar_id')
    .eq('id', 1)
    .maybeSingle();

  if (data?.redes_calendar_id) return data.redes_calendar_id;

  // No hay ID cacheado: puede que ya exista de una ejecución anterior sin
  // guardar (fallo a mitad), así que se busca por nombre antes de crear uno
  // nuevo y duplicarlo.
  const lista = await calendar.calendarList.list();
  const existente = (lista.data.items || []).find((c) => c.summary === NOMBRE_CALENDARIO);
  let calendarId = existente?.id;

  if (!calendarId) {
    const creado = await calendar.calendars.insert({
      requestBody: { summary: NOMBRE_CALENDARIO, timeZone: 'Europe/Madrid' },
    });
    calendarId = creado.data.id;
  }

  await supabase.from('google_drive_auth').update({ redes_calendar_id: calendarId }).eq('id', 1);
  return calendarId;
}

/**
 * Crea o actualiza el evento de un post programado en el calendario
 * "Redes sociales". Devuelve el gcalId (nuevo o el mismo si ya existía) o
 * null si Calendar no está conectado.
 */
async function sincronizarPostCalendar(post) {
  const calendar = await getCalendarClient();
  if (!calendar) return null;
  const calendarId = await getRedesCalendarId(calendar);

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
      const res = await calendar.events.update({ calendarId, eventId: post.gcal_id, requestBody: evento });
      return res.data.id ?? post.gcal_id;
    }
    const res = await calendar.events.insert({ calendarId, requestBody: evento });
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
    const calendarId = await getRedesCalendarId(calendar);
    await calendar.events.delete({ calendarId, eventId: gcalId });
  } catch (err) {
    console.error('Error eliminando evento de Google Calendar:', err.message);
  }
}

module.exports = { sincronizarPostCalendar, eliminarEventoPost };
