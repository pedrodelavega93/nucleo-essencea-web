// ============================================================
// NÚCLEO essences — verifica el código de 6 dígitos enviado por
// /api/request-otp y, si es correcto, devuelve las suscripciones
// del cliente (mismo formato que /api/list-subscriptions, para que
// el resto del flujo en el sitio no tenga que cambiar).
//
// El código se invalida (de un solo uso) apenas se usa correctamente,
// y también si ya expiró (10 minutos).
//
// Requiere STRIPE_SECRET_KEY.
// ============================================================

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const DIAS_MINIMOS = 5;
const SEG_POR_DIA = 86400;
const ESTADOS_VIGENTES = ['active', 'trialing', 'past_due', 'unpaid'];

function fechaLegible(date) {
  try {
    return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}

function normalizarTelefono(input) {
  if (!input) return '';
  let digitos = String(input).replace(/[^\d]/g, '');
  if (!digitos) return '';
  if (digitos.length === 10) digitos = '52' + digitos;
  return '+' + digitos;
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
    const { email, phone, code } = req.body || {};
    const correo = email && typeof email === 'string' && email.includes('@')
      ? email.trim().toLowerCase()
      : '';
    const telefono = phone && typeof phone === 'string' ? normalizarTelefono(phone) : '';
    const codigo = code && typeof code === 'string' ? code.trim() : '';

    if (!correo && !telefono) {
      return res.status(400).json({ error: 'Falta el correo o WhatsApp original.' });
    }
    if (!codigo || codigo.length !== 6) {
      return res.status(400).json({ error: 'Ingresa el código de 6 dígitos que te enviamos.' });
    }

    // Volvemos a buscar a TODOS los clientes que coincidan (igual que
    // list-subscriptions), pero el código solo se verifica contra el
    // primero — es el mismo que recibió el correo en request-otp.
    let customers;
    if (correo) {
      const resultado = await stripe.customers.list({ email: correo, limit: 100 });
      customers = resultado.data;
    } else {
      const resultado = await stripe.customers.search({ query: `phone:'${telefono}'`, limit: 100 });
      customers = resultado.data;
    }

    if (!customers.length) {
      return res.status(404).json({ error: 'No encontramos esa suscripción.' });
    }

    const principal = customers[0];
    const meta = principal.metadata || {};
    const ahora = Math.floor(Date.now() / 1000);

    if (!meta.otp_code || meta.otp_code !== codigo) {
      return res.status(401).json({ error: 'Código incorrecto.' });
    }
    if (!meta.otp_expires || Number(meta.otp_expires) < ahora) {
      return res.status(401).json({ error: 'Este código ya expiró. Solicita uno nuevo.' });
    }

    // Código válido — lo invalidamos de inmediato (un solo uso).
    await stripe.customers.update(principal.id, {
      metadata: Object.assign({}, meta, { otp_code: '', otp_expires: '' }),
    });

    // Listamos las suscripciones vigentes de todos los clientes que
    // coincidieron con el correo/teléfono (mismo comportamiento que
    // /api/list-subscriptions).
    const subs = [];
    for (const customer of customers) {
      const lista = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 100 });
      for (const sub of lista.data) {
        if (!ESTADOS_VIGENTES.includes(sub.status)) continue;
        const subMeta = sub.metadata || {};
        const { etiqueta, esAroma } = describirTipo(subMeta);
        const proximoTs = sub.current_period_end;
        const proximaFecha = new Date(proximoTs * 1000);
        const segundosRestantes = proximoTs - ahora;
        const puedeCambiar = segundosRestantes >= DIAS_MINIMOS * SEG_POR_DIA;

        subs.push({
          id: sub.id,
          customerId: customer.id,
          etiqueta,
          esAroma,
          tamano: subMeta.tamano || '',
          aroma: subMeta.aroma_elegido || '',
          estado: sub.status,
          proximaFechaISO: proximaFecha.toISOString(),
          proximaFechaLabel: fechaLegible(proximaFecha),
          puedeCambiar,
          cambiarDesdeLabel: puedeCambiar ? '' : fechaLegible(proximaFecha),
        });
      }
    }

    if (!subs.length) {
      return res.status(404).json({ error: 'No encontramos suscripciones activas.' });
    }

    res.status(200).json({ email: correo || null, phone: telefono || null, subscriptions: subs });
  } catch (err) {
    console.error('[v0] Error verificando el código de acceso:', err);
    res.status(500).json({ error: 'No se pudo verificar el código. Intenta de nuevo.' });
  }
};
