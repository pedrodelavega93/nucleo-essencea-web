// ============================================================
// NÚCLEO essences — CONTROL TOTAL: endpoint que guarda y lee los
// datos de ventas/gastos/difusores de forma privada, protegido con
// la misma contraseña que el Panel (ADMIN_PASSWORD).
//
// Recibe { password, action, data? } donde action es una de:
//   'get'  → devuelve los datos guardados (o null si no hay nada)
//   'save' → guarda el objeto { ventas, gastos, difusores }
//
// Usa la base de datos Redis (Upstash) conectada al proyecto vía
// Vercel Storage, hablando directo con su API REST por fetch — así
// no se necesita instalar ningún paquete npm nuevo (evita problemas
// de pnpm-lock.yaml desincronizado).
// ============================================================

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_KEY = 'nucleo-control-total-data';

async function kvGet() {
  const resp = await fetch(`${KV_URL}/get/${KV_KEY}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!resp.ok) throw new Error('Error leyendo de la base de datos (' + resp.status + ')');
  const body = await resp.json();
  if (!body || body.result == null) return null;
  try {
    return JSON.parse(body.result);
  } catch (e) {
    return null;
  }
}

async function kvSet(value) {
  const resp = await fetch(`${KV_URL}/set/${KV_KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(value),
  });
  if (!resp.ok) throw new Error('Error guardando en la base de datos (' + resp.status + ')');
  const body2 = await resp.json();
  return body2 && body2.result === 'OK';
}

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
    if (!KV_URL || !KV_TOKEN) {
      return res.status(500).json({ error: 'La base de datos no está conectada a este proyecto (faltan KV_REST_API_URL / KV_REST_API_TOKEN).' });
    }

    const body = req.body || {};
    const { password, action, data } = body;

    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    if (action === 'get') {
      const value = await kvGet();
      return res.status(200).json({ ok: true, data: value || null });
    }

    if (action === 'save') {
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Faltan datos a guardar.' });
      }
      const ok = await kvSet(data);
      if (!ok) return res.status(500).json({ error: 'La base de datos no confirmó el guardado.' });
      return res.status(200).json({ ok: true });
    }

    if (action === 'linkDifusor') {
      // Usado por el Panel (admin.html) para mandar de un clic una suscripción
      // de renta a la pestaña "Difusores & Rentas" de Control Total.
      if (!data || typeof data !== 'object' || !data.cliente || !data.modelo) {
        return res.status(400).json({ error: 'Faltan datos del difusor a vincular.' });
      }
      const actual = (await kvGet()) || { ventas: [], gastos: [], difusores: [], stock: [] };
      if (!Array.isArray(actual.difusores)) actual.difusores = [];

      // evita duplicar si ya se vinculó antes esta misma suscripción
      if (data.subscriptionId && actual.difusores.some((d) => d.subscriptionId === data.subscriptionId)) {
        return res.status(200).json({ ok: true, yaExistia: true });
      }

      let maxNum = 0;
      actual.difusores.forEach((d) => {
        const m = String(d.id || '').match(/(\d+)$/);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      });
      const nuevo = {
        id: 'd' + (maxNum + 1),
        tipo: 'renta',
        cliente: data.cliente,
        modelo: data.modelo,
        monto: Number(data.monto) || 0,
        fecha: data.fecha || '',
        pagado: !!data.pagado,
        activo: true,
        notas: data.notas || '',
        stockId: null,
        subscriptionId: data.subscriptionId || null,
      };
      actual.difusores.push(nuevo);

      const ok = await kvSet(actual);
      if (!ok) return res.status(500).json({ error: 'La base de datos no confirmó el guardado.' });
      return res.status(200).json({ ok: true, id: nuevo.id });
    }

    return res.status(400).json({ error: 'Acción no reconocida.' });
  } catch (err) {
    console.error('[control-total] Error:', err);
    res.status(500).json({ error: err.message || 'Ocurrió un error inesperado.' });
  }
};
