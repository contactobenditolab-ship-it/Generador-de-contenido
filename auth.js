// POST /api/auth — login del panel admin. Body: { password }.
const crypto = require('crypto');
const { issueToken } = require('../lib/auth');
const { dentroDelLimite, ipDesdeRequest } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!dentroDelLimite('auth:' + ipDesdeRequest(req), 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Demasiados intentos, inténtalo más tarde' });
  }

  // .trim() en ambos lados: un espacio o salto de línea de más al pegar el
  // valor en Vercel (Settings → Environment Variables) o al escribirlo en el
  // formulario rompía el login con un simple "contraseña incorrecta", sin
  // ninguna pista de que el problema era un carácter invisible.
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim();
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD no configurada en el servidor' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const password = typeof (body && body.password) === 'string' ? body.password.trim() : '';
  if (!password) {
    return res.status(400).json({ error: 'Falta password' });
  }

  const a = Buffer.from(password);
  const b = Buffer.from(ADMIN_PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ ok: false });

  let token;
  try {
    token = issueToken();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  return res.status(200).json({ ok: true, token });
};
