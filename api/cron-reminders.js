// ============================================================
// NÚCLEO essences — CRON diario: revisa todas las suscripciones
// vigentes y te avisa por correo cuando a alguna le falten
// exactamente 5 días para su próximo cobro/entrega — así sabes con
// tiempo a quién darle mantenimiento o cambio de aroma, sin tener
// que entrar al panel a revisar.
//
// Se activa automáticamente vía Vercel Cron (ver vercel.json).
// Protegido con CRON_SECRET: solo Vercel puede llamarlo (o alguien
// que conozca ese secreto).
//
// Requiere STRIPE_SECRET_KEY y RESEND_API_KEY.
// ============================================================

const Stripe = require('stripe');
const { Resend } = require('resend');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const REMITENTE = 'NÚCLEO essences <pedidos@nucleoessences.com>';
const CORREO_DUENO = 'pedro.delavega93@gmail.com';
const ESTADOS_VIGENTES = ['active', 'trialing', 'past_due', 'unpaid'];
const DIAS_AVISO = 5;

function fechaLegible(date) {
  try {
    return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}

function describirTipo(meta) {
  const tipo = meta.tipo_pedido || '';
  if (tipo === 'suscripcion_aromas') return 'Suscripción de Aromas';
  if (tipo === 'suscripcion_renta') return 'Renta de Difusores';
  return meta.plan_nombre || 'Suscripción';
}

function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function correoAviso(items) {
  const filasHtml = items
    .map(
      (it) =>
        `<tr>
          <td style="padding:8px 10px; border:1px solid #2a2a2a;">${escaparHtml(it.nombre || '(sin nombre)')}</td>
          <td style="padding:8px 10px; border:1px solid #2a2a2a;">${escaparHtml(it.correo || it.telefono || '—')}</td>
          <td style="padding:8px 10px; border:1px solid #2a2a2a;">${escaparHtml(it.etiqueta)}${it.tamano ? ' · ' + escaparHtml(it.tamano) : ''}</td>
          <td style="padding:8px 10px; border:1px solid #2a2a2a;">${escaparHtml(it.aroma || '—')}</td>
          <td style="padding:8px 10px; border:1px solid #2a2a2a;">${escaparHtml(it.metodoPago)}</td>
          <td style="padding:8px 10px; border:1px solid #2a2a2a;">${escaparHtml(it.fecha)}</td>
        </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0; padding:0; background-color:#0a0a0a; font-family:Georgia,'Times New Roman',serif; color:#f5f0e6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a; padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px; background-color:#141414; border:1px solid #c9a24b; border-radius:12px; overflow:hidden;">
        <tr><td style="background-color:#000; padding:28px 24px; text-align:center; border-bottom:1px solid #c9a24b;">
          <h1 style="margin:0; font-size:22px; letter-spacing:2px; color:#c9a24b;">NÚCLEO essences</h1>
          <p style="margin:8px 0 0; font-size:12px; letter-spacing:3px; color:#8a8a8a; text-transform:uppercase;">Aviso de vencimientos</p>
        </td></tr>
        <tr><td style="padding:28px 24px;">
          <p style="margin:0 0 18px; font-size:15px; line-height:1.6;">
            ${items.length === 1 ? 'Esta suscripción vence' : `Estas ${items.length} suscripciones vencen`} en ${DIAS_AVISO} días — es buen momento para agendar mantenimiento o cambio de aroma:
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:13px; color:#f5f0e6;">
            <tr>
              <th style="padding:8px 10px; border:1px solid #2a2a2a; background:#000; color:#c9a24b; text-align:left;">Cliente</th>
              <th style="padding:8px 10px; border:1px solid #2a2a2a; background:#000; color:#c9a24b; text-align:left;">Contacto</th>
              <th style="padding:8px 10px; border:1px solid #2a2a2a; background:#000; color:#c9a24b; text-align:left;">Plan</th>
              <th style="padding:8px 10px; border:1px solid #2a2a2a; background:#000; color:#c9a24b; text-align:left;">Aroma</th>
              <th style="padding:8px 10px; border:1px solid #2a2a2a; background:#000; color:#c9a24b; text-align:left;">Pago</th>
              <th style="padding:8px 10px; border:1px solid #2a2a2a; background:#000; color:#c9a24b; text-align:left;">Vence</th>
            </tr>
            ${filasHtml}
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [`${items.length} suscripción(es) vencen en ${DIAS_AVISO} días:`, ''].concat(
    items.map((it) => `${it.nombre || '(sin nombre)'} — ${it.etiqueta}${it.tamano ? ' ' + it.tamano : ''} — ${it.aroma || 'sin aroma'} — ${it.metodoPago} — vence ${it.fecha}`)
  ).join('\n');

  return { html, text };
}

module.exports = async (req, res) => {
  // Vercel Cron manda este header automáticamente si configuras
  // CRON_SECRET como variable de entorno — así nadie más puede
  // activar este endpoint llamándolo por su cuenta.
  const auth = req.headers['authorization'] || '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);

    const proximos = [];
    let startingAfter;
    while (true) {
      const page = await stripe.subscriptions.list({
        status: 'all',
        limit: 100,
        starting_after: startingAfter,
        expand: ['data.customer'],
      });

      for (const sub of page.data) {
        if (!ESTADOS_VIGENTES.includes(sub.status)) continue;

        const fin = new Date(sub.current_period_end * 1000);
        fin.setUTCHours(0, 0, 0, 0);
        const dias = Math.round((fin - hoy) / 86400000);

        if (dias === DIAS_AVISO) {
          const meta = sub.metadata || {};
          const customer = sub.customer && typeof sub.customer === 'object' ? sub.customer : null;
          proximos.push({
            nombre: customer ? customer.name || '' : '',
            correo: customer ? customer.email || '' : '',
            telefono: customer ? customer.phone || '' : '',
            etiqueta: describirTipo(meta),
            tamano: meta.tamano || '',
            aroma: meta.aroma_elegido || '',
            metodoPago: meta.metodo_pago === 'efectivo' ? 'Efectivo' : 'Tarjeta',
            fecha: fechaLegible(fin),
          });
        }
      }

      if (!page.has_more || !page.data.length) break;
      startingAfter = page.data[page.data.length - 1].id;
    }

    if (proximos.length) {
      const { html, text } = correoAviso(proximos);
      await resend.emails.send({
        from: REMITENTE,
        to: CORREO_DUENO,
        subject: `${proximos.length} suscripción(es) vencen en ${DIAS_AVISO} días — NÚCLEO essences`,
        html,
        text,
      });
    }

    res.status(200).json({ ok: true, avisos: proximos.length });
  } catch (err) {
    console.error('[cron] Error revisando vencimientos:', err);
    res.status(500).json({ error: 'Error revisando vencimientos.' });
  }
};
