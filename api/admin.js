// ============================================================
// NÚCLEO essences — ADMIN: un solo endpoint que combina todas las
// acciones del panel de administración (antes eran 5 archivos
// separados: admin-subscriptions, admin-create-subscription,
// admin-cancel-subscription, admin-update-subscription,
// admin-mark-paid). Se unieron en uno solo para no pasarnos del
// límite de 12 Serverless Functions del plan gratuito de Vercel.
//
// Recibe { password, action, ...datos } donde action es una de:
//   'list'      → lista todas las suscripciones
//   'create'    → da de alta una suscripción en efectivo
//   'cancel'    → cancela (da de baja) una suscripción
//   'update'    → modifica aroma/plan/tamaño/monto
//   'markPaid'  → marca como pagado el recibo abierto del mes
//
// Protegido con ADMIN_PASSWORD. Requiere STRIPE_SECRET_KEY.
// ============================================================

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const ESTADOS_VIGENTES = ['active', 'trialing', 'past_due', 'unpaid'];

// Cualquier suscripción cancelada ANTES de esta fecha se ignora por
// completo (nunca vuelve a aparecer en el panel, ni en "Finalizadas").
// Las canceladas a partir de hoy sí aparecerán ahí. Es una fecha FIJA
// (no "ahora"), para que no se mueva sola cada vez que corre la función.
const CORTE_CANCELADAS = Math.floor(new Date('2026-08-07T00:00:00Z').getTime() / 1000);

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

function normalizarTelefono(input) {
  if (!input) return '';
  let digitos = String(input).replace(/[^\d]/g, '');
  if (!digitos) return '';
  if (digitos.length === 10) digitos = '52' + digitos;
  return '+' + digitos;
}

// ---------- action: list ----------
async function accionList() {
  const subs = [];
  let startingAfter;
  while (true) {
    const page = await stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      starting_after: startingAfter,
      expand: ['data.customer'],
    });

    for (const sub of page.data) {
      if (!ESTADOS_VIGENTES.includes(sub.status)) {
        const canceladaRecientemente = sub.status === 'canceled' && sub.canceled_at && sub.canceled_at >= CORTE_CANCELADAS;
        if (!canceladaRecientemente) continue;
      }

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

  subs.sort((a, b) => (a.creadoISO < b.creadoISO ? 1 : -1));
  return { subscriptions: subs };
}

// ---------- action: create ----------
// Calcula el próximo vencimiento mensual a partir de la fecha real en
// que el cliente se suscribió (puede ser en el pasado). Le suma meses
// hasta llegar a la primera fecha que sea hoy o futura.
// Devuelve null si esa fecha es HOY (facturación normal, sin truco), o
// un timestamp Unix si hay que "adelantar" el primer cobro con trial_end.
function calcularVencimiento(fechaInicioStr) {
  if (!fechaInicioStr) return null;
  const hoyStr = new Date().toISOString().slice(0, 10);
  let anchor = new Date(fechaInicioStr + 'T12:00:00Z');
  if (isNaN(anchor.getTime())) return null;
  let anchorStr = anchor.toISOString().slice(0, 10);
  while (anchorStr < hoyStr) {
    anchor.setUTCMonth(anchor.getUTCMonth() + 1);
    anchorStr = anchor.toISOString().slice(0, 10);
  }
  if (anchorStr === hoyStr) return null;
  return Math.floor(anchor.getTime() / 1000);
}

async function accionCreate(body) {
  const { nombre, correo, telefono, tipoPedido, planNombre, tamano, aroma, montoMensual, fechaInicio } = body;

  const correoValido = correo && typeof correo === 'string' && correo.includes('@');
  const telefonoValido = telefono && typeof telefono === 'string' && telefono.trim();
  if (!correoValido) {
    throw {
      status: 400,
      error: 'El correo es obligatorio: Stripe lo necesita para poder generarte el recibo mensual de esta suscripción (aunque el pago sea en efectivo). El WhatsApp puede quedar como dato de contacto adicional.',
    };
  }
  if (!nombre || !nombre.trim()) {
    throw { status: 400, error: 'Falta el nombre del cliente.' };
  }
  if (!tipoPedido || !['suscripcion_renta', 'suscripcion_aromas'].includes(tipoPedido)) {
    throw { status: 400, error: 'Tipo de suscripción no válido.' };
  }
  if (!montoMensual || isNaN(Number(montoMensual)) || Number(montoMensual) <= 0) {
    throw { status: 400, error: 'El monto mensual no es válido.' };
  }

  const correoNorm = correoValido ? correo.trim().toLowerCase() : '';
  const telefonoNorm = telefonoValido ? normalizarTelefono(telefono) : '';

  let customer;
  let existentes = { data: [] };
  if (correoNorm) {
    existentes = await stripe.customers.list({ email: correoNorm, limit: 1 });
  } else if (telefonoNorm) {
    existentes = await stripe.customers.search({ query: `phone:'${telefonoNorm}'`, limit: 1 });
  }

  if (existentes.data.length) {
    customer = existentes.data[0];
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

  const producto = await stripe.products.create({
    name: planNombre || 'Suscripción NÚCLEO essences (efectivo)',
  });

  const subscriptionConfig = {
    customer: customer.id,
    items: [
      {
        price_data: {
          currency: 'mxn',
          unit_amount: Math.round(Number(montoMensual) * 100),
          recurring: { interval: 'month' },
          product: producto.id,
        },
      },
    ],
    collection_method: 'send_invoice',
    days_until_due: 3,
    metadata,
  };

  // Si nos dieron una fecha real de suscripción (distinta de hoy), usamos
  // trial_end para que el primer cobro/vencimiento caiga en la fecha
  // correcta (un mes después de esa fecha original), en vez de contar un
  // mes completo a partir de HOY.
  const vencimientoTs = calcularVencimiento(fechaInicio);
  if (vencimientoTs) {
    subscriptionConfig.trial_end = vencimientoTs;
  }

  const subscription = await stripe.subscriptions.create(subscriptionConfig);

  return { subscriptionId: subscription.id, customerId: customer.id };
}

// ---------- action: cancel ----------
async function accionCancel(body) {
  const { subscriptionId, inmediato } = body;
  if (!subscriptionId) throw { status: 400, error: 'Falta la suscripción a cancelar.' };

  let sub;
  if (inmediato) {
    sub = await stripe.subscriptions.cancel(subscriptionId);
  } else {
    sub = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  }
  return { status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end || false };
}

// ---------- action: update ----------
async function accionUpdate(body) {
  const { subscriptionId, aroma, planNombre, tamano, montoMensual } = body;
  if (!subscriptionId) throw { status: 400, error: 'Falta la suscripción a modificar.' };

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const metaActual = sub.metadata || {};
  const metaNueva = Object.assign({}, metaActual);
  if (aroma !== undefined) metaNueva.aroma_elegido = String(aroma).slice(0, 200);
  if (planNombre !== undefined) metaNueva.plan_nombre = String(planNombre).slice(0, 200);
  if (tamano !== undefined) metaNueva.tamano = String(tamano).slice(0, 100);

  const updatePayload = { metadata: metaNueva };

  if (montoMensual !== undefined && montoMensual !== null && montoMensual !== '') {
    const item = sub.items.data[0];
    const producto = await stripe.products.create({
      name: planNombre || metaActual.plan_nombre || 'Suscripción NÚCLEO essences',
    });
    updatePayload.items = [
      {
        id: item.id,
        price_data: {
          currency: item.price.currency,
          unit_amount: Math.round(Number(montoMensual) * 100),
          recurring: { interval: 'month' },
          product: producto.id,
        },
      },
    ];
    updatePayload.proration_behavior = 'none';
  }

  const actualizada = await stripe.subscriptions.update(subscriptionId, updatePayload);
  return { subscriptionId: actualizada.id, metadata: actualizada.metadata };
}

// ---------- action: markPaid ----------
async function accionMarkPaid(body) {
  const { subscriptionId } = body;
  if (!subscriptionId) throw { status: 400, error: 'Falta la suscripción.' };

  const facturas = await stripe.invoices.list({ subscription: subscriptionId, status: 'open', limit: 1 });
  if (!facturas.data.length) {
    throw { status: 404, error: 'No hay ningún recibo pendiente de pago para esta suscripción en este momento.' };
  }

  const factura = await stripe.invoices.pay(facturas.data[0].id, { paid_out_of_band: true });
  return { invoiceId: factura.id, status: factura.status };
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
    const body = req.body || {};
    const { password, action } = body;

    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    let resultado;
    switch (action) {
      case 'list':
        resultado = await accionList();
        break;
      case 'create':
        resultado = await accionCreate(body);
        break;
      case 'cancel':
        resultado = await accionCancel(body);
        break;
      case 'update':
        resultado = await accionUpdate(body);
        break;
      case 'markPaid':
        resultado = await accionMarkPaid(body);
        break;
      default:
        return res.status(400).json({ error: 'Acción no reconocida.' });
    }

    res.status(200).json(Object.assign({ ok: true }, resultado));
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.error });
    }
    console.error('[admin] Error:', err);
    res.status(500).json({ error: err.message || 'Ocurrió un error inesperado.' });
  }
};
