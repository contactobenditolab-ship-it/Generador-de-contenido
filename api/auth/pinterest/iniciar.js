// GET /api/auth/pinterest/iniciar?token=<sesión admin> — redirige a Pinterest
// para pedir permiso. El token va en la URL (no en un header) porque esto
// se abre con una navegación normal del navegador, no un fetch.
const { verify } = require('../../../lib/auth');
const { getAuthUrl } = require('../../../lib/pinterest');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  const token = req.query.token;
  if (!verify(token)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const state = crypto.randomBytes(16).toString('hex');
    // El state va firmado dentro de una cookie de corta duración para
    // comprobarlo en el callback y evitar CSRF — más simple que una tabla.
    res.setHeader('Set-Cookie', 'pinterest_state=' + state + '; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax');
    return res.redirect(302, getAuthUrl(state));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
