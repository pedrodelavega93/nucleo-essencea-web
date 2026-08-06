// ============================================================
// NÚCLEO essences — ADMIN: cancela (da de baja) una suscripción,
// sea de tarjeta o de efectivo.
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
    const { password, subscriptionId, inmediato } = req.body || {};
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Falta la suscripción a cancelar.' });
    }

    let sub;
    if (inmediato) {
      // Cancela ya mismo.
      sub = await stripe.subscriptions.cancel(subscriptionId);
    } else {
      // Se cancela al terminar el periodo ya pagado (no corta el servicio a medias).
      sub = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    }

    res.status(200).json({ ok: true, status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end || false });
  } catch (err) {
    console.error('[admin] Error cancelando suscripción:', err);
    res.status(500).json({ error: err.message || 'No se pudo cancelar la suscripción.' });
  }
};
