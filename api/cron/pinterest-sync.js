// GET /api/cron/pinterest-sync — Vercel Cron lo llama según vercel.json
// (una vez al día). Trae a Inspiración los pines nuevos del tablón
// configurado en Ajustes. Protegido con CRON_SECRET (cabecera que Vercel
// añade automáticamente a las llamadas de cron: Authorization: Bearer
// <CRON_SECRET>) para que nadie más pueda dispararlo desde fuera.
const { sincronizarPinesNuevos } = require('../../lib/pinterest');

module.exports = async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.authorization || '';
    if (header !== 'Bearer ' + cronSecret) {
      return res.status(401).json({ error: 'No autorizado' });
    }
  }

  try {
    const result = await sincronizarPinesNuevos();
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error('Error sincronizando Pinterest:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
