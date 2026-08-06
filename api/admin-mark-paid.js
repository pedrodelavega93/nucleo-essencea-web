// ============================================================
// NÚCLEO essences — ADMIN: marca como pagado (en efectivo) el
// recibo/factura abierto del mes para una suscripción de efectivo
// (collection_method "send_invoice"). No cobra nada — solo deja
// el registro en Stripe de que ya te pagaron ese mes.
//
// Protegido con ADMIN_PASSWORD. Requiere STRIPE_SECRET_KEY.
// ============================================================

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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
    const { password, subscriptionId } = req.body || {};
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Falta la suscripción.' });
    }

    const facturas = await stripe.invoices.list({
      subscription: subscriptionId,
      status: 'open',
      limit: 1,
    });

    if (!facturas.data.length) {
      return res.status(404).json({ error: 'No hay ningún recibo pendiente de pago para esta suscripción en este momento.' });
    }

    const factura = await stripe.invoices.pay(facturas.data[0].id, { paid_out_of_band: true });

    res.status(200).json({ ok: true, invoiceId: factura.id, status: factura.status });
  } catch (err) {
    console.error('[admin] Error marcando pago:', err);
    res.status(500).json({ error: err.message || 'No se pudo marcar el pago.' });
  }
};
