// ============================================================
// NÚCLEO essences — lista las suscripciones activas de un cliente
// (Renta de Difusores y Suscripción de Aromas) a partir de su
// correo, con el aroma actual, el tamaño (si aplica) y la próxima
// fecha de entrega/cobro. También indica si el cambio de aroma está
// permitido según la regla de 5 días de anticipación.
//
// Requiere STRIPE_SECRET_KEY.
// ============================================================

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const DIAS_MINIMOS = 5;
const SEG_POR_DIA = 86400;

// Estados de suscripción que consideramos "vigentes" para gestionar.
const ESTADOS_VIGENTES = ['active', 'trialing', 'past_due', 'unpaid'];

// Formatea una fecha (Date) a texto legible en español, p. ej. "5 de marzo de 2026".
function fechaLegible(date) {
  try {
    return date.toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}

// A partir del tipo de pedido guardado en la metadata, devuelve una
// etiqueta amigable y si se trata de la Suscripción de Aromas.
function describirTipo(meta) {
  const tipo = meta.tipo_pedido || '';
  if (tipo === 'suscripcion_aromas') {
    return { etiqueta: 'Suscripción de Aromas', esAroma: true };
  }
  if (tipo === 'suscripcion_renta') {
    return { etiqueta: 'Renta de Difusores', esAroma: false };
  }
  // Respaldo para suscripciones antiguas sin tipo_pedido en metadata.
  return { etiqueta: meta.plan_nombre || 'Suscripción', esAroma: false };
}

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
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'Ingresa un correo válido.' });
      return;
    }

    const correo = email.trim().toLowerCase();

    // Puede haber más de un cliente en Stripe con el mismo correo.
    const customers = await stripe.customers.list({ email: correo, limit: 100 });
    if (!customers.data.length) {
      res.status(404).json({ error: 'No encontramos ninguna suscripción con ese correo.' });
      return;
    }

    const ahora = Math.floor(Date.now() / 1000);
    const subs = [];

    for (const customer of customers.data) {
      const lista = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 100,
      });

      for (const sub of lista.data) {
        if (!ESTADOS_VIGENTES.includes(sub.status)) continue;

        const meta = sub.metadata || {};
        const { etiqueta, esAroma } = describirTipo(meta);
        const proximoTs = sub.current_period_end;
        const proximaFecha = new Date(proximoTs * 1000);
        const segundosRestantes = proximoTs - ahora;
        const puedeCambiar = segundosRestantes >= DIAS_MINIMOS * SEG_POR_DIA;

        subs.push({
          id: sub.id,
          etiqueta,
          esAroma,
          tamano: meta.tamano || '',
          aroma: meta.aroma_elegido || '',
          estado: sub.status,
          proximaFechaISO: proximaFecha.toISOString(),
          proximaFechaLabel: fechaLegible(proximaFecha),
          puedeCambiar,
          // Si está bloqueado, la próxima oportunidad es después del próximo
          // cargo (cuando vuelve a haber >5 días hasta la siguiente entrega).
          cambiarDesdeLabel: puedeCambiar ? '' : fechaLegible(proximaFecha),
        });
      }
    }

    if (!subs.length) {
      res.status(404).json({ error: 'No encontramos suscripciones activas con ese correo.' });
      return;
    }

    res.status(200).json({ email: correo, subscriptions: subs });
  } catch (err) {
    console.error('[v0] Error listando suscripciones:', err);
    res.status(500).json({ error: 'No se pudieron cargar tus suscripciones. Intenta de nuevo.' });
  }
};
