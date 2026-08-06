// lib/auth.js — Firma/verificación de tokens de sesión del admin (HMAC, sin dependencias).
const crypto = require('crypto');

const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 días — el token se guarda en localStorage, no en sessionStorage

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error('ADMIN_SESSION_SECRET no configurada');
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const idx = token.lastIndexOf('.');
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  let expected;
  try {
    expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function issueToken() {
  return sign({ role: 'admin', exp: Date.now() + TTL_MS });
}

// Devuelve el payload si la petición trae un Bearer token válido; si no,
// responde 401 y devuelve null (el handler debe `return` inmediatamente).
function requireAuth(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verify(token);
  if (!payload) {
    res.status(401).json({ error: 'No autorizado' });
    return null;
  }
  return payload;
}

module.exports = { issueToken, verify, requireAuth };
