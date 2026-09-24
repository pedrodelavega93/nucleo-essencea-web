// ============================================================
// NÚCLEO essences — código de bienvenida ÚNICO por persona (10%)
//
// El pop-up de bienvenida pide nombre, correo y WhatsApp. Aquí:
//   1. Buscamos en Stripe si ya existe un cliente con ese correo
//      o ese WhatsApp.
//   2. Si ya compró antes  → no se genera código (es solo para
//      primera compra).
//   3. Si ya pidió su código antes → le devolvemos el MISMO código
//      (no se generan códigos nuevos para la misma persona).
//   4. Si es nuevo → lo damos de alta como cliente en Stripe y
//      creamos un código único tipo NUCLEO-7K3QX que:
//        · se puede usar UNA sola vez (max_redemptions: 1)
//        · solo aplica en primera compra (first_time_transaction)
//        · usa el mismo cupón de 10% que BIENVENIDO10
//   5. Le mandamos el código por correo y te avisamos a ti.
//
// No usa base de datos: todo queda guardado en Stripe
// (Clientes → metadata "welcome_code" y en Códigos de promoción).
//
// Requiere STRIPE_SECRET_KEY y RESEND_API_KEY.
// Opcional: WELCOME_COUPON_ID (si no está, se toma el cupón del
// código promocional BIENVENIDO10).
// ============================================================

const Stripe = require('stripe');
const { Resend } = require('resend');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const REMITENTE = 'NÚCLEO essences <pedidos@nucleoessences.com>';
const CORREO_INTERNO = 'pedro.delavega93@gmail.com';
const CODIGO_BASE = 'BIENVENIDO10';

function normalizarTelefono(input) {
  if (!input) return '';
  let digitos = String(input).replace(/[^\d]/g, '');
  if (!digitos) return '';
  if (digitos.length === 10) digitos = '52' + digitos;
  return '+' + digitos;
}

function correoValido(c) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c);
}

function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

let cuponCache = null;
async function obtenerCupon() {
  if (process.env.WELCOME_COUPON_ID) return process.env.WELCOME_COUPON_ID;
  if (cuponCache) return cuponCache;
  const lista = await stripe.promotionCodes.list({ code: CODIGO_BASE, limit: 1 });
  const promo = lista.data[0];
  if (!promo) throw new Error('No existe el código ' + CODIGO_BASE + ' en Stripe');
  cuponCache = typeof promo.coupon === 'string' ? promo.coupon : promo.coupon.id;
  return cuponCache;
}

function codigoAleatorio() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I
  let s = '';
  for (let i = 0; i < 5; i++) s += letras[Math.floor(Math.random() * letras.length)];
  return 'NUCLEO-' + s;
}

async function yaCompro(customerId) {
  const pagos = await stripe.paymentIntents.list({ customer: customerId, limit: 10 });
  if (pagos.data.some((p) => p.status === 'succeeded')) return true;
  const facturas = await stripe.invoices.list({ customer: customerId, status: 'paid', limit: 1 });
  return facturas.data.some((f) => f.amount_paid > 0);
}

async function buscarClientes(correo, telefono) {
  const encontrados = new Map();
  const porCorreo = await stripe.customers.list({ email: correo, limit: 10 });
  porCorreo.data.forEach((c) => encontrados.set(c.id, c));
  if (telefono) {
    try {
      const porTel = await stripe.customers.search({ query: `phone:'${telefono}'`, limit: 10 });
      porTel.data.forEach((c) => encontrados.set(c.id, c));
    } catch (e) {
      console.error('[welcome] búsqueda por teléfono falló:', e.message);
    }
  }
  return [...encontrados.values()];
}

function correoCliente(nombre, codigo, origen) {
  const n = escaparHtml(nombre || '');
  return `
<div style="background:#0a0908;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:460px;margin:0 auto;background:#1a1512;border:1px solid #b8905e;border-radius:12px;padding:32px 26px;text-align:center;color:#efe6da;">
    <div style="font-family:Georgia,serif;font-size:26px;letter-spacing:4px;">NÚCLEO</div>
    <div style="font-family:Georgia,serif;font-style:italic;color:#b8905e;letter-spacing:5px;font-size:13px;margin-bottom:24px;">essences</div>
    <p style="font-size:15px;margin:0 0 6px;">${n ? '¡Hola, ' + n + '!' : '¡Hola!'}</p>
    <p style="font-size:14px;color:#a89a8c;margin:0 0 20px;line-height:1.5;">Este es tu código personal de <strong style="color:#d9bd8e;">10% de descuento</strong> para tu primera compra. Aplica en todos nuestros productos.</p>
    <div style="display:inline-block;border:1.5px dashed #b8905e;border-radius:8px;padding:12px 24px;font-size:22px;letter-spacing:3px;color:#d9bd8e;font-weight:bold;">${codigo}</div>
    <p style="font-size:12px;color:#a89a8c;margin:20px 0 24px;line-height:1.5;">Escríbelo en “Agregar código promocional” al momento de pagar.<br>Válido una sola vez.</p>
    <a href="${origen}/#difusores" style="display:inline-block;background:#3a0e10;border:1px solid #b8905e;border-radius:40px;color:#efe6da;text-decoration:none;padding:13px 28px;font-size:12px;letter-spacing:3px;">IR A LA TIENDA</a>
  </div>
</div>`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido' }); return; }

  try {
    const body = req.body || {};
    const nombre = String(body.nombre || '').trim().slice(0, 80);
    const correo = String(body.correo || '').trim().toLowerCase().slice(0, 120);
    const telefono = normalizarTelefono(body.telefono);
    const origen = req.headers.origin || ('https://' + req.headers.host);

    if (!nombre) return res.status(400).json({ error: 'Escribe tu nombre.' });
    if (!correoValido(correo)) return res.status(400).json({ error: 'Revisa tu correo, parece incompleto.' });
    if (telefono.replace(/\D/g, '').length < 12) return res.status(400).json({ error: 'Escribe tu WhatsApp a 10 dígitos.' });

    const clientes = await buscarClientes(correo, telefono);

    // ¿Ya compró antes?
    for (const c of clientes) {
      if (await yaCompro(c.id)) {
        return res.status(409).json({
          error: 'Este descuento es solo para primera compra y ya tenemos un pedido registrado con estos datos. ¡Gracias por volver!',
        });
      }
    }

    // ¿Ya se le había generado un código? → devolver el mismo si sigue activo.
    for (const c of clientes) {
      const previo = c.metadata && c.metadata.welcome_code;
      if (previo) {
        const lista = await stripe.promotionCodes.list({ code: previo, limit: 1 });
        const promo = lista.data[0];
        if (promo && promo.active) return res.status(200).json({ ok: true, code: previo, nombre, repetido: true });
        return res.status(409).json({ error: 'Ya usaste tu código de bienvenida. Este descuento es solo para primera compra.' });
      }
    }

    // Cliente nuevo (o existente sin compras ni código).
    const cliente = clientes[0]
      ? await stripe.customers.update(clientes[0].id, {
          name: clientes[0].name || nombre,
          phone: clientes[0].phone || telefono,
        })
      : await stripe.customers.create({
          name: nombre,
          email: correo,
          phone: telefono,
          metadata: { origen: 'popup_bienvenida' },
        });

    const cupon = await obtenerCupon();
    let promo = null;
    for (let intento = 0; intento < 4 && !promo; intento++) {
      try {
        promo = await stripe.promotionCodes.create({
          coupon: cupon,
          code: codigoAleatorio(),
          max_redemptions: 1,
          restrictions: { first_time_transaction: true },
          metadata: { customer: cliente.id, correo, telefono, nombre },
        });
      } catch (e) {
        if (!/already exists/i.test(e.message || '')) throw e; // choque de código: reintenta
      }
    }
    if (!promo) throw new Error('No se pudo generar un código único');

    await stripe.customers.update(cliente.id, {
      metadata: Object.assign({}, cliente.metadata, { welcome_code: promo.code, welcome_fecha: new Date().toISOString() }),
    });

    // Correos (si fallan, el cliente igual ve su código en pantalla).
    try {
      await resend.emails.send({
        from: REMITENTE,
        to: correo,
        subject: 'Tu 10% de bienvenida — NÚCLEO essences',
        html: correoCliente(nombre, promo.code, origen),
        text: `Hola ${nombre}, tu código de 10% para tu primera compra en NÚCLEO essences es: ${promo.code}\nEscríbelo en "Agregar código promocional" al pagar. Válido una sola vez.`,
      });
      await resend.emails.send({
        from: REMITENTE,
        to: CORREO_INTERNO,
        subject: `Nuevo registro de bienvenida: ${nombre}`,
        text: `Nombre: ${nombre}\nCorreo: ${correo}\nWhatsApp: ${telefono}\nCódigo: ${promo.code}`,
      });
    } catch (e) {
      console.error('[welcome] error enviando correo:', e.message);
    }

    res.status(200).json({ ok: true, code: promo.code, nombre });
  } catch (err) {
    console.error('[welcome] error:', err);
    res.status(500).json({ error: 'No pudimos generar tu código. Intenta de nuevo o escríbenos por WhatsApp.' });
  }
};
