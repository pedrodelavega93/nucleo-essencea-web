// ============================================================
// NÚCLEO essences — cambia el aroma de una suscripción activa
// (Renta de Difusores o Suscripción de Aromas) directamente,
// sin tener que escribir por WhatsApp.
//
// Reglas:
//   - Solo se permite si faltan 5 días o más para la próxima
//     entrega/cobro (current_period_end).
//   - El nuevo aroma se guarda en la metadata de la suscripción.
//   - Se envía un correo de confirmación al cliente y al dueño.
//
// Requiere STRIPE_SECRET_KEY y RESEND_API_KEY.
// ============================================================

const Stripe = require('stripe');
const { Resend } = require('resend');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const REMITENTE = 'NÚCLEO essences <pedidos@nucleoessences.com>';
const CORREO_DUENO = 'pedro.delavega93@gmail.com';
const WHATSAPP_URL = 'https://wa.me/528116551406';

const DIAS_MINIMOS = 5;
const SEG_POR_DIA = 86400;

function fechaLegible(date) {
  try {
    return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}

function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Correo de confirmación para el cliente (identidad dorado/negro).
function correoCliente({ plan, aromaAnterior, aromaNuevo, proximaFecha }) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0; padding:0; background-color:#0a0a0a; font-family:Georgia,'Times New Roman',serif; color:#f5f0e6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a; padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background-color:#141414; border:1px solid #c9a24b; border-radius:12px; overflow:hidden;">
        <tr><td style="background-color:#000; padding:28px 24px; text-align:center; border-bottom:1px solid #c9a24b;">
          <h1 style="margin:0; font-size:24px; letter-spacing:2px; color:#c9a24b;">NÚCLEO essences</h1>
          <p style="margin:8px 0 0; font-size:13px; letter-spacing:3px; color:#8a8a8a; text-transform:uppercase;">Cambio de aroma confirmado</p>
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <h2 style="margin:0 0 16px; font-size:20px; color:#c9a24b;">Tu nuevo aroma está listo 🌿</h2>
          <p style="margin:0 0 20px; font-size:15px; line-height:1.6;">Hemos actualizado el aroma de tu suscripción. Estos son los detalles:</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a; border:1px solid #2a2a2a; border-radius:8px; margin-bottom:24px;">
            <tr><td style="padding:18px 20px; font-size:15px; line-height:1.9;">
              <div><span style="color:#c9a24b;">Suscripción:</span> ${escaparHtml(plan)}</div>
              <div><span style="color:#c9a24b;">Aroma anterior:</span> ${escaparHtml(aromaAnterior)}</div>
              <div><span style="color:#c9a24b;">Aroma nuevo:</span> ${escaparHtml(aromaNuevo)}</div>
              <div><span style="color:#c9a24b;">Próxima entrega:</span> ${escaparHtml(proximaFecha)}</div>
            </td></tr>
          </table>
          <p style="margin:0 0 24px; font-size:15px; line-height:1.6;">Tu próxima entrega llegará ya con el nuevo aroma. Si tienes cualquier duda, escríbenos por WhatsApp.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 8px;">
            <tr><td style="border-radius:6px; background-color:#25D366;">
              <a href="${WHATSAPP_URL}" style="display:inline-block; padding:12px 26px; font-size:14px; color:#0a0a0a; text-decoration:none; font-family:Arial,sans-serif; font-weight:bold;">Escríbenos por WhatsApp</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="background-color:#000; padding:24px; text-align:center; border-top:1px solid #c9a24b;">
          <p style="margin:0 0 6px; font-size:15px; color:#c9a24b; font-style:italic;">Con aroma, NÚCLEO essences</p>
          <p style="margin:0; font-size:12px; color:#8a8a8a;"><a href="${WHATSAPP_URL}" style="color:#c9a24b; text-decoration:none;">${WHATSAPP_URL}</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Correo interno para el dueño (simple).
function correoDueno({ plan, correo, aromaAnterior, aromaNuevo, proximaFecha, subId }) {
  const filas = [
    ['Cliente', correo],
    ['Suscripción', plan],
    ['Aroma anterior', aromaAnterior],
    ['Aroma nuevo', aromaNuevo],
    ['Próxima entrega', proximaFecha],
    ['ID suscripción', subId],
  ];
  const filasHtml = filas
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 10px; border:1px solid #ddd; font-weight:bold; background:#f5f5f5;">${escaparHtml(k)}</td><td style="padding:6px 10px; border:1px solid #ddd;">${escaparHtml(v)}</td></tr>`
    )
    .join('');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"></head>
<body style="margin:0; padding:16px; font-family:Arial,Helvetica,sans-serif; color:#222;">
  <h2 style="margin:0 0 12px; font-size:18px;">Cambio de aroma en una suscripción</h2>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:14px;">${filasHtml}</table>
</body></html>`;
  const text = filas.map(([k, v]) => `${k}: ${v}`).join('\n');
  return { html, text };
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
    const { email, subscriptionId, aroma } = req.body || {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'Correo no válido.' });
      return;
    }
    if (!subscriptionId || typeof subscriptionId !== 'string') {
      res.status(400).json({ error: 'Falta la suscripción a modificar.' });
      return;
    }
    if (!aroma || typeof aroma !== 'string' || !aroma.trim()) {
      res.status(400).json({ error: 'Elige un aroma válido del catálogo.' });
      return;
    }

    const correo = email.trim().toLowerCase();
    const nuevoAroma = aroma.trim().slice(0, 200);

    // Recuperamos la suscripción y su cliente para verificar identidad.
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (!sub || !sub.customer) {
      res.status(404).json({ error: 'No encontramos esa suscripción.' });
      return;
    }

    const customer = await stripe.customers.retrieve(
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    );
    const correoCustomer = (customer && customer.email ? customer.email : '').toLowerCase();

    // Seguridad: la suscripción debe pertenecer al correo indicado.
    if (correoCustomer !== correo) {
      res.status(403).json({ error: 'Esta suscripción no coincide con el correo proporcionado.' });
      return;
    }

    // Regla de 5 días de anticipación (validación en el servidor).
    const ahora = Math.floor(Date.now() / 1000);
    const proximoTs = sub.current_period_end;
    const proximaFecha = new Date(proximoTs * 1000);
    const proximaFechaLabel = fechaLegible(proximaFecha);

    if (proximoTs - ahora < DIAS_MINIMOS * SEG_POR_DIA) {
      res.status(409).json({
        error:
          'Ya no es posible cambiar el aroma para esta entrega (faltan menos de ' +
          DIAS_MINIMOS +
          ' días). Podrás cambiarlo nuevamente a partir del ' +
          proximaFechaLabel +
          '.',
        locked: true,
        cambiarDesdeLabel: proximaFechaLabel,
      });
      return;
    }

    const meta = sub.metadata || {};
    const aromaAnterior = meta.aroma_elegido || '(no especificado)';
    const plan = meta.plan_nombre || (meta.tipo_pedido === 'suscripcion_aromas' ? 'Suscripción de Aromas' : 'Suscripción');

    // Guardamos el nuevo aroma en la metadata (conservando el resto).
    await stripe.subscriptions.update(subscriptionId, {
      metadata: Object.assign({}, meta, { aroma_elegido: nuevoAroma }),
    });

    // Correos de confirmación (no bloquean la respuesta si fallan).
    try {
      await resend.emails.send({
        from: REMITENTE,
        to: correo,
        subject: 'Cambio de aroma confirmado — NÚCLEO essences 🌿',
        html: correoCliente({ plan, aromaAnterior, aromaNuevo: nuevoAroma, proximaFecha: proximaFechaLabel }),
        text: [
          'Cambio de aroma confirmado — NÚCLEO essences',
          'Suscripción: ' + plan,
          'Aroma anterior: ' + aromaAnterior,
          'Aroma nuevo: ' + nuevoAroma,
          'Próxima entrega: ' + proximaFechaLabel,
          '',
          'Con aroma, NÚCLEO essences',
          WHATSAPP_URL,
        ].join('\n'),
      });

      const interno = correoDueno({
        plan,
        correo,
        aromaAnterior,
        aromaNuevo: nuevoAroma,
        proximaFecha: proximaFechaLabel,
        subId: subscriptionId,
      });
      await resend.emails.send({
        from: REMITENTE,
        to: CORREO_DUENO,
        subject: 'Cambio de aroma: ' + correo + ' → ' + nuevoAroma,
        html: interno.html,
        text: interno.text,
      });
    } catch (mailErr) {
      console.error('[v0] Error enviando correos de cambio de aroma:', mailErr);
    }

    res.status(200).json({
      ok: true,
      aromaAnterior,
      aromaNuevo: nuevoAroma,
      proximaFechaLabel,
    });
  } catch (err) {
    console.error('[v0] Error cambiando el aroma:', err);
    res.status(500).json({ error: 'No se pudo cambiar el aroma. Intenta de nuevo.' });
  }
};
