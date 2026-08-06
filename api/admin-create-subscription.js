// ============================================================
// NÚCLEO essences — ADMIN: da de alta una suscripción para un
// cliente que se suscribió de forma física y paga en efectivo.
//
// No se cobra tarjeta: la suscripción se crea con
// collection_method "send_invoice" (Stripe genera un recibo cada
// mes, que tú marcas como pagado a mano desde el panel cuando el
// cliente te paga en efectivo — ver api/admin-mark-paid.js).
//
// La suscripción queda con la misma metadata que usa el resto del
// sitio (tipo_pedido, plan_nombre, tamano, aroma_elegido), así que
// el cliente puede usar "Gestionar mi suscripción" y cambiar su
// aroma él mismo, igual que si hubiera pagado con tarjeta.
//
// Protegido con ADMIN_PASSWORD. Requiere STRIPE_SECRET_KEY.
// ============================================================

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Normaliza un teléfono a formato E.164 (+52XXXXXXXXXX) para que
// coincida con lo que guarda Stripe y se pueda buscar después.
function normalizarTelefono(input) {
  if (!input) return '';
  let digitos = String(input).replace(/[^\d]/g, '');
  if (!digitos) return '';
  if (digitos.length === 10) digitos = '52' + digitos;
  return '+' + digitos;
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
    const {
      password,
      nombre,
      correo,
      telefono,
      tipoPedido,     // 'suscripcion_renta' | 'suscripcion_aromas'
      planNombre,     // ej. "Paquete 01 — Esencia" o "Suscripción de Aromas — 500 ml"
      tamano,         // ej. "500 ml" (solo suscripción de aromas)
      aroma,          // aroma elegido
      montoMensual,   // número, en pesos (ej. 1600)
    } = req.body || {};

    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }
    const correoValido = correo && typeof correo === 'string' && correo.includes('@');
    const telefonoValido = telefono && typeof telefono === 'string' && telefono.trim();
    if (!correoValido && !telefonoValido) {
      return res.status(400).json({ error: 'Ingresa al menos un correo o un número de WhatsApp del cliente.' });
    }
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'Falta el nombre del cliente.' });
    }
    if (!tipoPedido || !['suscripcion_renta', 'suscripcion_aromas'].includes(tipoPedido)) {
      return res.status(400).json({ error: 'Tipo de suscripción no válido.' });
    }
    if (!montoMensual || isNaN(Number(montoMensual)) || Number(montoMensual) <= 0) {
      return res.status(400).json({ error: 'El monto mensual no es válido.' });
    }

    const correoNorm = correoValido ? correo.trim().toLowerCase() : '';
    const telefonoNorm = telefonoValido ? normalizarTelefono(telefono) : '';

    // Reutilizamos al cliente si ya existe en Stripe (buscando primero por
    // correo si lo dieron; si no, por teléfono); si no existe, lo creamos.
    let customer;
    let existentes = { data: [] };
    if (correoNorm) {
      existentes = await stripe.customers.list({ email: correoNorm, limit: 1 });
    } else if (telefonoNorm) {
      existentes = await stripe.customers.search({ query: `phone:'${telefonoNorm}'`, limit: 1 });
    }

    if (existentes.data.length) {
      customer = existentes.data[0];
      // Actualizamos nombre/teléfono/correo si vienen y no los tenía.
      const cambios = {};
      if (nombre && nombre.trim() && !customer.name) cambios.name = nombre.trim();
      if (telefonoNorm && !customer.phone) cambios.phone = telefonoNorm;
      if (correoNorm && !customer.email) cambios.email = correoNorm;
      if (Object.keys(cambios).length) {
        customer = await stripe.customers.update(customer.id, cambios);
      }
    } else {
      const datosCustomer = { name: nombre.trim() };
      if (correoNorm) datosCustomer.email = correoNorm;
      if (telefonoNorm) datosCustomer.phone = telefonoNorm;
      customer = await stripe.customers.create(datosCustomer);
    }

    const metadata = {
      tipo_pedido: tipoPedido,
      plan_nombre: planNombre || '',
      tamano: tamano || '',
      aroma_elegido: aroma || '',
      metodo_pago: 'efectivo',
      dado_de_alta_por: 'admin',
    };

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [
        {
          price_data: {
            currency: 'mxn',
            unit_amount: Math.round(Number(montoMensual) * 100),
            recurring: { interval: 'month' },
            product_data: { name: planNombre || 'Suscripción NÚCLEO essences (efectivo)' },
          },
        },
      ],
      collection_method: 'send_invoice',
      days_until_due: 3,
      metadata,
    });

    res.status(200).json({
      ok: true,
      subscriptionId: subscription.id,
      customerId: customer.id,
    });
  } catch (err) {
    console.error('[admin] Error creando suscripción en efectivo:', err);
    res.status(500).json({ error: err.message || 'No se pudo crear la suscripción.' });
  }
};
