// ============================================================
// NÚCLEO essences — ADMIN: modifica una suscripción existente
// (aroma, plan, tamaño y/o monto mensual). A diferencia de
// api/update-aroma.js (que usa el cliente), aquí no aplica la
// regla de 5 días de anticipación — el dueño puede ajustar cuando
// quiera.
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
    const { password, subscriptionId, aroma, planNombre, tamano, montoMensual } = req.body || {};
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Falta la suscripción a modificar.' });
    }

    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const metaActual = sub.metadata || {};
    const metaNueva = Object.assign({}, metaActual);
    if (aroma !== undefined) metaNueva.aroma_elegido = String(aroma).slice(0, 200);
    if (planNombre !== undefined) metaNueva.plan_nombre = String(planNombre).slice(0, 200);
    if (tamano !== undefined) metaNueva.tamano = String(tamano).slice(0, 100);

    const updatePayload = { metadata: metaNueva };

    // Si se cambió el monto mensual, actualizamos el precio del ítem
    // (solo aplica a suscripciones creadas con price_data en línea,
    // que es el caso de las de efectivo y de la Suscripción de Aromas).
    if (montoMensual !== undefined && montoMensual !== null && montoMensual !== '') {
      const item = sub.items.data[0];
      updatePayload.items = [
        {
          id: item.id,
          price_data: {
            currency: item.price.currency,
            unit_amount: Math.round(Number(montoMensual) * 100),
            recurring: { interval: 'month' },
            product_data: { name: planNombre || metaActual.plan_nombre || 'Suscripción NÚCLEO essences' },
          },
        },
      ];
      updatePayload.proration_behavior = 'none';
    }

    const actualizada = await stripe.subscriptions.update(subscriptionId, updatePayload);

    res.status(200).json({ ok: true, subscriptionId: actualizada.id, metadata: actualizada.metadata });
  } catch (err) {
    console.error('[admin] Error modificando suscripción:', err);
    res.status(500).json({ error: err.message || 'No se pudo modificar la suscripción.' });
  }
};
