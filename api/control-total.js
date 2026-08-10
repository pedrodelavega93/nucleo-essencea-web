// ============================================================
// NÚCLEO essences — CONTROL TOTAL: endpoint que guarda y lee los
// datos de ventas/gastos/difusores de forma privada, protegido con
// la misma contraseña que el Panel (ADMIN_PASSWORD).
//
// Recibe { password, action, data? } donde action es una de:
//   'get'  → devuelve los datos guardados (o null si no hay nada)
//   'save' → guarda el objeto { ventas, gastos, difusores }
//
// Requiere una base de datos Vercel KV conectada al proyecto
// (Vercel Dashboard → Storage → Create Database → KV). Al conectarla,
// Vercel agrega automáticamente las variables de entorno necesarias.
// ============================================================

const { kv } = require('@vercel/kv');

const KV_KEY = 'nucleo-control-total-data';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body || {};
    const { password, action, data } = body;

    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    if (action === 'get') {
      const value = await kv.get(KV_KEY);
      return res.status(200).json({ ok: true, data: value || null });
    }

    if (action === 'save') {
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Faltan datos a guardar.' });
      }
      await kv.set(KV_KEY, data);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Acción no reconocida.' });
  } catch (err) {
    console.error('[control-total] Error:', err);
    res.status(500).json({ error: err.message || 'Ocurrió un error inesperado.' });
  }
};
