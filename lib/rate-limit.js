// lib/rate-limit.js — Limitador por IP persistido en Supabase.
//
// Antes: contador en memoria (Map), que se reseteaba en cada cold start y
// no se compartía entre instancias/regiones — no protegía frente a abuso
// distribuido ni ráfagas repartidas entre varias invocaciones serverless.
//
// Ahora: reutiliza la misma tabla `rate_limit_hits` que ya usa Bendito OS
// (src/lib/rate-limit.ts), en el mismo proyecto Supabase. RLS en esa tabla
// no tiene ninguna política para roles autenticados/anónimos — solo el
// service role puede leer/escribir, así que SUPABASE_SERVICE_ROLE_KEY es
// obligatoria aquí (nunca debe exponerse al cliente).
//
// Requiere estas variables de entorno en el proyecto Vercel de este sitio
// (Settings → Environment Variables): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// — mismos valores que ya usa el proyecto bendito-os.
const { createClient } = require('@supabase/supabase-js');

let cachedClient = null;
function client() {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas');
  }
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

async function dentroDelLimite(clave, maxIntentos, ventanaMs) {
  const supabase = client();
  const desde = new Date(Date.now() - ventanaMs).toISOString();

  const { count, error } = await supabase
    .from('rate_limit_hits')
    .select('*', { count: 'exact', head: true })
    .eq('clave', clave)
    .gte('created_at', desde);

  if (error) {
    // Fail-open: un fallo de Supabase (caída, credenciales mal puestas) no
    // debe tumbar los formularios públicos del sitio; se registra para
    // detectarlo, pero se deja pasar la petición.
    console.error('rate-limit: fallo al consultar Supabase, se permite la petición:', error.message);
    return true;
  }

  if ((count ?? 0) >= maxIntentos) return false;

  await supabase.from('rate_limit_hits').insert({ clave });
  // Purga oportunista de registros viejos (>24h) para no acumular basura.
  await supabase
    .from('rate_limit_hits')
    .delete()
    .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  return true;
}

function ipDesdeRequest(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'desconocida';
}

module.exports = { dentroDelLimite, ipDesdeRequest };
