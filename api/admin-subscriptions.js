// ============================================================
// NÚCLEO essences — ADMIN: lista TODAS las suscripciones activas
// (de tarjeta vía Stripe Checkout, y las que tú das de alta a mano
// para clientes que pagan en efectivo), para tu panel privado.
//
// Protegido con ADMIN_PASSWORD (variable de entorno en Vercel).
// Requiere STRIPE_SECRET_KEY.
// ============================================================

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const ESTADOS_VIGENTES = ['active', 'trialing', 'past_due', 'unpaid'];

function fechaLegible(date) {
  try {
    return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}

function describirTipo(meta) {
  const tipo = meta.tipo_pedido || '';
  if (tipo === 'suscripcion_aromas') return { etiqueta: 'Suscripción de Aromas', esAroma: true };
  if (tipo === 'suscripcion_renta') return { etiqueta: 'Renta de Difusores', esAroma: false };
  return { etiqueta: meta.plan_nombre || 'Suscripción', esAroma: false };
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
    const { password } = req.body || {};
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    const ahora = Math.floor(Date.now() / 1000);
    const subs = [];

    // Recorremos TODAS las suscripciones de la cuenta, sin filtrar por
    // cliente, paginando con starting_after hasta agotar la lista.
    let startingAfter;
    while (true) {
      const page = await stripe.subscriptions.list({
        status: 'all',
        limit: 100,
        starting_after: startingAfter,
        expand: ['data.customer'],
      });

      for (const sub of page.data) {
        if (!ESTADOS_VIGENTES.includes(sub.status) && sub.status !== 'canceled') continue;

        const meta = sub.metadata || {};
        const { etiqueta, esAroma } = describirTipo(meta);
        const customer = sub.customer && typeof sub.customer === 'object' ? sub.customer : null;
        const proximaFecha = new Date(sub.current_period_end * 1000);

        subs.push({
          id: sub.id,
          customerId: customer ? customer.id : (typeof sub.customer === 'string' ? sub.customer : ''),
          nombre: customer ? (customer.name || '') : '',
          correo: customer ? (customer.email || '') : '',
          telefono: customer ? (customer.phone || '') : '',
          etiqueta,
          esAroma,
          planNombre: meta.plan_nombre || '',
          tamano: meta.tamano || '',
          aroma: meta.aroma_elegido || '',
          metodoPago: meta.metodo_pago === 'efectivo' ? 'efectivo' : 'tarjeta',
          estado: sub.status,
          collectionMethod: sub.collection_method,
          proximaFechaISO: proximaFecha.toISOString(),
          proximaFechaLabel: fechaLegible(proximaFecha),
          montoMensual: sub.items && sub.items.data[0] ? (sub.items.data[0].price.unit_amount / 100) : null,
          creadoISO: new Date(sub.created * 1000).toISOString(),
        });
      }

      if (!page.has_more || !page.data.length) break;
      startingAfter = page.data[page.data.length - 1].id;
    }

    // Más recientes primero.
    subs.sort((a, b) => (a.creadoISO < b.creadoISO ? 1 : -1));

    res.status(200).json({ subscriptions: subs });
  } catch (err) {
    console.error('[admin] Error listando suscripciones:', err);
    res.status(500).json({ error: 'No se pudieron cargar las suscripciones.' });
  }
};
