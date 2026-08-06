// js/bl-api.js — Cliente para /api/auth y /api/bendito (extraído tal cual
// de bendito-lab-canva, sección "Redes sociales · Generador de contenido").
(function (global) {
  const TOKEN_KEY = 'bl_session_token';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function authHeaders(extra) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  async function login(password) {
    const r = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const d = await r.json();
    if (d.ok && d.token) setToken(d.token);
    return d.ok === true;
  }

  async function benditoGet(tipo) {
    const r = await fetch('/api/bendito?tipo=' + encodeURIComponent(tipo), { headers: authHeaders() });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d;
  }

  async function benditoPost(body) {
    const r = await fetch('/api/bendito', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d;
  }

  global.BL_API = {
    TOKEN_KEY,
    getToken,
    setToken,
    authHeaders,
    login,
    benditoGet,
    benditoPost,
  };
})(window);
