// GET /api/auth/pinterest/callback — Pinterest redirige aquí tras el
// consentimiento, con ?code=...&state=.... Intercambia el code por los
// tokens y los guarda en pinterest_auth (tabla singleton, id=1).
const { createClient } = require('@supabase/supabase-js');
const { intercambiarCodigo } = require('../../../lib/pinterest');

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function leerCookie(req, nombre) {
  const cabecera = req.headers.cookie || '';
  const match = cabecera.split(';').map((c) => c.trim()).find((c) => c.startsWith(nombre + '='));
  return match ? match.slice(nombre.length + 1) : null;
}

module.exports = async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send('Pinterest denegó el acceso: ' + error);
  }
  if (!code) {
    return res.status(400).send('Falta el código de autorización');
  }
  const stateCookie = leerCookie(req, 'pinterest_state');
  if (!stateCookie || stateCookie !== state) {
    return res.status(400).send('State inválido — vuelve a iniciar la conexión desde Ajustes');
  }

  try {
    const tokens = await intercambiarCodigo(code);
    if (!tokens.access_token) {
      return res.status(400).send('Pinterest no devolvió access_token');
    }

    const supabase = db();
    await supabase.from('pinterest_auth').upsert({
      id: 1,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      updated_at: new Date().toISOString(),
    });

    res.setHeader('Set-Cookie', 'pinterest_state=; Max-Age=0; Path=/');
    return res.redirect(302, '/#pinterest=conectado');
  } catch (e) {
    return res.status(500).send('Error conectando con Pinterest: ' + e.message);
  }
};
