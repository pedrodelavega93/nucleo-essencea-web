// ============================================================
// NÚCLEO essences — genera un código de 6 dígitos y lo envía al
// correo registrado del cliente, como paso previo antes de dejarlo
// ver o modificar su suscripción en "Gestionar mi suscripción".
//
// El cliente puede haber buscado su suscripción por correo o por
// WhatsApp — en ambos casos, el código se manda SIEMPRE al correo
// que Stripe tiene guardado para ese cliente (nunca a un correo
// distinto que alguien más pudiera escribir). Si el cliente no
// tiene correo registrado (se dio de alta solo con WhatsApp), no
// se puede usar este flujo — se le pide contactar por WhatsApp.
//
// El código se guarda temporalmente en la metadata del Customer de
// Stripe (no usamos base de datos aparte) y expira en 10 minutos.
//
// Requiere STRIPE_SECRET_KEY y RESEND_API_KEY.
// ============================================================

const Stripe = require('stripe');
const { Resend } = require('resend');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const REMITENTE = 'NÚCLEO essences <pedidos@nucleoessences.com>';
const VIGENCIA_SEGUNDOS = 10 * 60; // 10 minutos

function normalizarTelefono(input) {
  if (!input) return '';
  let digitos = String(input).replace(/[^\d]/g, '');
  if (!digitos) return '';
  if (digitos.length === 10) digitos = '52' + digitos;
  return '+' + digitos;
}

// Enmascara un correo para mostrarlo en pantalla sin revelarlo
// completo, ej. "pedro.delavega93@gmail.com" -> "pe***@gmail.com".
function enmascararCorreo(correo) {
  const [usuario, dominio] = correo.split('@');
  if (!dominio) return correo;
  const visible = usuario.slice(0, 2);
  return visible + '***@' + dominio;
}

function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function correoCodigo(codigo) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0; padding:0; background-color:#0a0a0a; font-family:Georgia,'Times New Roman',serif; color:#f5f0e6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a; padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#141414; border:1px solid #c9a24b; border-radius:12px; overflow:hidden;">
        <tr><td style="background-color:#000; padding:28px 24px; text-align:center; border-bottom:1px solid #c9a24b;">
          <h1 style="margin:0; font-size:24px; letter-spacing:2px; color:#c9a24b;">NÚCLEO essences</h1>
          <p style="margin:8px 0 0; font-size:13px; letter-spacing:3px; color:#8a8a8a; text-transform:uppercase;">Código de acceso</p>
        </td></tr>
        <tr><td style="padding:32px 28px; text-align:center;">
          <p style="margin:0 0 20px; font-size:15px; line-height:1.6;">Usa este código para entrar a "Gestionar mi suscripción":</p>
          <div style="font-size:36px; letter-spacing:8px; color:#c9a24b; font-weight:bold; margin:0 0 20px;">${escaparHtml(codigo)}</div>
          <p style="margin:0; font-size:13px; line-height:1.6; color:#8a8a8a;">Este código es válido por 10 minutos. Si tú no lo solicitaste, puedes ignorar este correo.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
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
    const { email, phone } = req.body || {};
    const correo = email && typeof email === 'string' && email.includes('@')
      ? email.trim().toLowerCase()
      : '';
    const telefono = phone && typeof phone === 'string' ? normalizarTelefono(phone) : '';

    if (!correo && !telefono) {
      return res.status(400).json({ error: 'Ingresa un correo o un número de WhatsApp válido.' });
    }

    // Buscamos al cliente en Stripe, igual que en /api/list-subscriptions.
    let customers;
    if (correo) {
      const resultado = await stripe.customers.list({ email: correo, limit: 1 });
      customers = resultado.data;
    } else {
      const resultado = await stripe.customers.search({ query: `phone:'${telefono}'`, limit: 1 });
      customers = resultado.data;
    }

    if (!customers.length) {
      return res.status(404).json({
        error: correo
          ? 'No encontramos ninguna suscripción con ese correo.'
          : 'No encontramos ninguna suscripción con ese número de WhatsApp.',
      });
    }

    const customer = customers[0];
    if (!customer.email) {
      return res.status(422).json({
        error: 'Tu suscripción no tiene un correo registrado para poder enviarte el código de acceso. Escríbenos por WhatsApp y con gusto te ayudamos directamente.',
        sinCorreo: true,
      });
    }

    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const expira = Math.floor(Date.now() / 1000) + VIGENCIA_SEGUNDOS;

    await stripe.customers.update(customer.id, {
      metadata: Object.assign({}, customer.metadata, {
        otp_code: codigo,
        otp_expires: String(expira),
      }),
    });

    await resend.emails.send({
      from: REMITENTE,
      to: customer.email,
      subject: 'Tu código de acceso — NÚCLEO essences',
      html: correoCodigo(codigo),
      text: `Tu código de acceso a NÚCLEO essences es: ${codigo}\nEs válido por 10 minutos.`,
    });

    res.status(200).json({ ok: true, emailMasked: enmascararCorreo(customer.email) });
  } catch (err) {
    console.error('[v0] Error generando código de acceso:', err);
    res.status(500).json({ error: 'No se pudo enviar el código. Intenta de nuevo.' });
  }
};
