// ============================================================
// NÚCLEO essences — Webhook de Stripe.
//
// Escucha el evento `checkout.session.completed` y, cuando un
// pago se completa, envía automáticamente un correo de
// confirmación al cliente usando Resend.
//
// Variables de entorno requeridas (Vercel → Project Settings →
// Environment Variables):
//   - STRIPE_SECRET_KEY       (ya existente)
//   - STRIPE_WEBHOOK_SECRET   (firma del webhook, empieza con "whsec_")
//   - RESEND_API_KEY          (API key de Resend, empieza con "re_")
//
// IMPORTANTE: Stripe exige verificar la firma sobre el cuerpo
// CRUDO (raw body) de la petición. Por eso NO accedemos a
// `req.body` (eso obligaría a Vercel a parsear el cuerpo);
// en su lugar leemos el stream para obtener el Buffer original.
// ============================================================

const Stripe = require('stripe');
const { Resend } = require('resend');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const REMITENTE = 'NÚCLEO essences <pedidos@nucleoessences.com>';
const WHATSAPP_URL = 'https://wa.me/528116551406';

// Lee el cuerpo crudo de la petición sin que Vercel lo parsee.
function leerRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Determina si el pedido fue "recolección en tienda" (true) o
// "envío a domicilio" (false), revisando —en este orden—:
//   1) La tarifa de envío elegida (flujo carrito / pago único).
//   2) El custom_field `metodo_entrega` (flujo suscripción).
// Por defecto asume envío a domicilio.
function esRecoleccion(session) {
  // 1) Método de entrega elegido vía shipping_options
  const displayName =
    session.shipping_cost &&
    session.shipping_cost.shipping_rate &&
    typeof session.shipping_cost.shipping_rate === 'object'
      ? session.shipping_cost.shipping_rate.display_name || ''
      : '';
  if (/recoger/i.test(displayName)) return true;
  if (displayName) return false; // había una tarifa de envío real seleccionada

  // 2) Método de entrega elegido vía custom_field (suscripciones)
  const campos = Array.isArray(session.custom_fields) ? session.custom_fields : [];
  const metodo = campos.find((c) => c.key === 'metodo_entrega');
  if (metodo && metodo.dropdown && metodo.dropdown.value === 'recoger') return true;

  return false;
}

// Construye el resumen del pedido a partir de la metadata guardada
// en el checkout. Soporta el flujo carrito (resumen_pedido) y el
// flujo de producto único / suscripción (producto + aroma).
function construirResumen(session) {
  const meta = session.metadata || {};
  if (meta.resumen_pedido) return meta.resumen_pedido;

  const partes = [];
  if (meta.producto) partes.push(String(meta.producto));
  if (meta.aroma_elegido) partes.push('Aroma: ' + String(meta.aroma_elegido));
  return partes.length ? partes.join(' — ') : 'Tu pedido';
}

// Escapa texto para insertarlo de forma segura dentro del HTML.
function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Plantilla HTML del correo con la identidad dorado/negro de la marca.
function plantillaCorreo({ resumen, mensajeEntrega, total }) {
  const resumenHtml = escaparHtml(resumen).replace(/\s\|\s/g, '<br>');
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0; padding:0; background-color:#0a0a0a; font-family:Georgia, 'Times New Roman', serif; color:#f5f0e6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a; padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background-color:#141414; border:1px solid #c9a24b; border-radius:12px; overflow:hidden;">
          <tr>
            <td style="background-color:#000000; padding:28px 24px; text-align:center; border-bottom:1px solid #c9a24b;">
              <h1 style="margin:0; font-size:24px; letter-spacing:2px; color:#c9a24b;">NÚCLEO essences</h1>
              <p style="margin:8px 0 0; font-size:13px; letter-spacing:3px; color:#8a8a8a; text-transform:uppercase;">Aromas que transforman espacios</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;">
              <h2 style="margin:0 0 16px; font-size:20px; color:#c9a24b;">¡Gracias por tu compra! 🌿</h2>
              <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#f5f0e6;">
                Hemos recibido tu pago correctamente. Aquí está el resumen de tu pedido:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a; border:1px solid #2a2a2a; border-radius:8px; margin-bottom:24px;">
                <tr>
                  <td style="padding:18px 20px; font-size:15px; line-height:1.7; color:#f5f0e6;">
                    ${resumenHtml}
                    ${total ? `<div style="margin-top:14px; padding-top:14px; border-top:1px solid #2a2a2a; color:#c9a24b; font-size:16px;">Total: ${escaparHtml(total)}</div>` : ''}
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:#f5f0e6;">
                ${escaparHtml(mensajeEntrega)}
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 8px;">
                <tr>
                  <td style="border-radius:6px; background-color:#25D366;">
                    <a href="${WHATSAPP_URL}" style="display:inline-block; padding:12px 26px; font-size:14px; color:#0a0a0a; text-decoration:none; font-family:Arial, sans-serif; font-weight:bold;">
                      Escríbenos por WhatsApp
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#000000; padding:24px; text-align:center; border-top:1px solid #c9a24b;">
              <p style="margin:0 0 6px; font-size:15px; color:#c9a24b; font-style:italic;">Con aroma, NÚCLEO essences</p>
              <p style="margin:0; font-size:12px; color:#8a8a8a;">
                <a href="${WHATSAPP_URL}" style="color:#c9a24b; text-decoration:none;">${WHATSAPP_URL}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Versión en texto plano (fallback para clientes sin HTML).
function plantillaTexto({ resumen, mensajeEntrega, total }) {
  return [
    '¡Gracias por tu compra en NÚCLEO essences! 🌿',
    '',
    'Resumen de tu pedido:',
    resumen,
    total ? 'Total: ' + total : '',
    '',
    mensajeEntrega,
    '',
    'Con aroma, NÚCLEO essences',
    WHATSAPP_URL,
  ]
    .filter(Boolean)
    .join('\n');
}

// Formatea el total (viene en centavos) a moneda legible.
function formatearTotal(session) {
  if (typeof session.amount_total !== 'number') return '';
  const moneda = (session.currency || 'mxn').toUpperCase();
  const monto = (session.amount_total / 100).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${monto} ${moneda}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  const firma = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await leerRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      firma,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[v0] Falló la verificación de la firma del webhook:', err.message);
    res.status(400).json({ error: `Webhook Error: ${err.message}` });
    return;
  }

  // Solo nos interesa el pago completado.
  if (event.type !== 'checkout.session.completed') {
    res.status(200).json({ received: true });
    return;
  }

  try {
    // Recuperamos la sesión completa con la tarifa de envío y los
    // campos personalizados expandidos para poder determinar el
    // método de entrega y el correo del cliente.
    const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
      expand: ['shipping_cost.shipping_rate', 'custom_fields'],
    });

    const email =
      (session.customer_details && session.customer_details.email) ||
      session.customer_email;

    if (!email) {
      console.error('[v0] La sesión no tiene correo de cliente; no se envía confirmación.');
      res.status(200).json({ received: true, warning: 'sin email' });
      return;
    }

    const recoleccion = esRecoleccion(session);
    const mensajeEntrega = recoleccion
      ? 'En los próximos 3 a 5 días hábiles nos estaremos comunicando contigo para avisarte que tu pedido ya está listo para recolectar.'
      : 'En los próximos 3 a 5 días hábiles nos estaremos comunicando contigo por parte de NÚCLEO essences para coordinar la entrega de tu pedido.';

    const resumen = construirResumen(session);
    const total = formatearTotal(session);

    const { error } = await resend.emails.send({
      from: REMITENTE,
      to: email,
      subject: '¡Gracias por tu compra en NÚCLEO essences! 🌿',
      html: plantillaCorreo({ resumen, mensajeEntrega, total }),
      text: plantillaTexto({ resumen, mensajeEntrega, total }),
    });

    if (error) {
      console.error('[v0] Error enviando el correo con Resend:', error);
      // Respondemos 200 para que Stripe no reintente indefinidamente,
      // pero dejamos el error en los logs para diagnóstico.
      res.status(200).json({ received: true, emailError: true });
      return;
    }

    console.log('[v0] Correo de confirmación enviado a', email);
    res.status(200).json({ received: true, emailSent: true });
  } catch (err) {
    console.error('[v0] Error procesando checkout.session.completed:', err);
    res.status(500).json({ error: 'Error procesando el evento' });
  }
};
