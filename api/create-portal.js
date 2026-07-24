// ============================================================
// NÚCLEO essences — crea una sesión del Portal de Cliente de
// Stripe para que el suscriptor pueda cancelar o gestionar su
// plan de renta mensual él mismo.
//
// Requiere que el Customer Portal esté activado en:
// https://dashboard.stripe.com/settings/billing/portal
// ============================================================

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  try {
    const { checkoutSessionId } = req.body || {};
    if (!checkoutSessionId) {
      res.status(400).json({ error: 'Falta checkoutSessionId' });
      return;
    }

    // Recupera la sesión de checkout original para obtener el ID del
    // cliente de Stripe que se creó al suscribirse.
    const checkoutSession = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    const customerId = checkoutSession.customer;

    if (!customerId) {
      res.status(400).json({ error: 'Esta sesión no tiene un cliente asociado (¿fue una suscripción?)' });
      return;
    }

    const origin = req.headers.origin || ('https://' + req.headers.host);

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: origin + '/',
    });

    res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error('Error creando sesión del portal de Stripe:', err);
    res.status(500).json({ error: 'No se pudo abrir el portal de gestión' });
  }
};
