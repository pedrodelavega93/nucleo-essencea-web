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

// Normaliza un teléfono a formato E.164 (+52XXXXXXXXXX) para poder
// buscarlo con la Search API de Stripe. Acepta con o sin código de
// país, con o sin espacios/guiones.
function normalizarTelefono(input) {
  if (!input) return '';
  let digitos = String(input).replace(/[^\d]/g, '');
  if (!digitos) return '';
  if (digitos.length === 10) digitos = '52' + digitos;
  return '+' + digitos;
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
    const { email, phone } = req.body || {};

    const correo = email && typeof email === 'string' && email.includes('@')
      ? email.trim().toLowerCase()
      : '';
    const telefono = phone && typeof phone === 'string' ? normalizarTelefono(phone) : '';

    if (!correo && !telefono) {
      res.status(400).json({ error: 'Ingresa un correo o un número de WhatsApp válido.' });
      return;
    }

    // Buscamos al cliente en Stripe por correo o por teléfono.
    let customers;
    if (correo) {
      customers = await stripe.customers.list({ email: correo, limit: 100 });
      customers = customers.data;
    } else {
      const resultado = await stripe.customers.search({
        query: `phone:'${telefono}'`,
        limit: 100,
      });
      customers = resultado.data;
    }

    if (!customers.length) {
      res.status(404).json({
        error: correo
          ? 'No encontramos ninguna suscripción con ese correo.'
          : 'No encontramos ninguna suscripción con ese número de WhatsApp.',
      });
      return;
    }

    const ahora = Math.floor(Date.now() / 1000);
    const subs = [];

    for (const customer of customers) {
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
          customerId: customer.id,
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
      res.status(404).json({
        error: correo
          ? 'No encontramos suscripciones activas con ese correo.'
          : 'No encontramos suscripciones activas con ese número de WhatsApp.',
      });
      return;
    }

    res.status(200).json({
      email: correo || null,
      phone: telefono || null,
      subscriptions: subs,
    });
  } catch (err) {
    console.error('[v0] Error listando suscripciones:', err);
    res.status(500).json({ error: 'No se pudieron cargar tus suscripciones. Intenta de nuevo.' });
  }
};
