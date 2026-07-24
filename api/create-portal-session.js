// ============================================================
// NÚCLEO essences — busca al cliente en Stripe por su correo y
// genera una sesión del Customer Portal para que pueda ver,
// cambiar o cancelar su suscripción él mismo.
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
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { email } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Correo no proporcionado' });
    }

    const customers = await stripe.customers.list({
      email: email.trim().toLowerCase(),
      limit: 1,
    });

    if (!customers.data.length) {
      return res.status(404).json({
        error: 'No encontramos ninguna suscripción activa con ese correo.',
      });
    }

    const customer = customers.data[0];

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${getBaseUrl(req)}/`,
    });

    return res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error('Error creando sesión del portal:', err);
    return res.status(500).json({
      error: 'Ocurrió un error al generar el acceso. Intenta de nuevo.',
    });
  }
};

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
