// ============================================================
// NÚCLEO essences — CRON: recordatorio automático por correo
// cuando a una suscripción (renta de difusores o suscripción de
// aromas) le faltan 5 días para su próximo cobro.
//
// Se ejecuta una vez al día vía Vercel Cron (ver vercel.json).
// No requiere contraseña — Vercel llama a esta ruta directamente.
// Si defines la variable de entorno CRON_SECRET, además valida el
// header que Vercel Cron manda automáticamente en cada ejecución,
// para que nadie más pueda disparar el envío llamando a la URL.
//
// Requiere STRIPE_SECRET_KEY y RESEND_API_KEY (esta última es la
// misma que ya usa el sitio principal para correo transaccional).
// ============================================================

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const DIAS_AVISO = 5;
const REMITENTE = 'NÚCLEO essences <recordatorios@nucleoessences.com>';

function fechaLegible(date) {
  try {
    return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}

function diasHasta(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.floor(ms / 86400000);
}

function plantillaCorreo({ nombre, etiqueta, planNombre, aroma, montoMensual, fechaLabel }) {
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,';
  const detallePlan = planNombre ? `<strong>${planNombre}</strong>` : `<strong>${etiqueta}</strong>`;
  const detalleAroma = aroma ? `<p style="margin:0 0 8px;">Aroma actual: <strong>${aroma}</strong></p>` : '';
  const detalleMonto = montoMensual ? `<p style="margin:0 0 8px;">Monto: <strong>$${Number(montoMensual).toLocaleString('es-MX')} MXN</strong></p>` : '';

  return `
  <div style="font-family:Georgia, 'Times New Roman', serif; background:#0a0908; color:#efe6da; padding:32px 24px; max-width:520px; margin:0 auto;">
    <p style="letter-spacing:0.12em; font-size:0.7rem; text-transform:uppercase; color:#b8905e; margin:0 0 18px;">NÚCLEO essences</p>
    <h2 style="font-weight:600; font-size:1.3rem; margin:0 0 16px; color:#efe6da;">${saludo}</h2>
    <p style="line-height:1.6; margin:0 0 16px; color:#efe6da;">
      Tu ${detallePlan} está por renovarse el <strong>${fechaLabel}</strong> — faltan ${DIAS_AVISO} días.
    </p>
    ${detalleAroma}
    ${detalleMonto}
    <p style="line-height:1.6; margin:20px 0 0; color:#a89a8c; font-size:0.85rem;">
      Si tu pago es automático (tarjeta) no necesitas hacer nada. Si tu plan es en efectivo o transferencia,
      este es tu recordatorio para prepararlo a tiempo. Cualquier duda, contáctanos.
    </p>
  </div>`;
}

async function enviarCorreo(destinatario, asunto, html) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: REMITENTE,
      to: destinatario,
      subject: asunto,
      html,
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`Resend respondió ${resp.status}: ${errBody}`);
  }
  return true;
}

module.exports = async (req, res) => {
  // Vercel Cron llama por GET. Si configuraste CRON_SECRET, exigimos el
  // header de autorización que Vercel agrega automáticamente a las
  // ejecuciones programadas, para que la ruta no se pueda disparar desde
  // afuera solo conociendo la URL.
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'No autorizado.' });
    }
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('[cron-recordatorios] Falta RESEND_API_KEY.');
    return res.status(500).json({ error: 'Falta configurar RESEND_API_KEY.' });
  }

  const enviados = [];
  const fallidos = [];

  try {
    let startingAfter;
    while (true) {
      const page = await stripe.subscriptions.list({
        status: 'all',
        limit: 100,
        starting_after: startingAfter,
        expand: ['data.customer'],
      });

      for (const sub of page.data) {
        if (!['active', 'trialing'].includes(sub.status)) continue;

        const proximaFechaISO = new Date(sub.current_period_end * 1000).toISOString();
        const dias = diasHasta(proximaFechaISO);
        if (dias !== DIAS_AVISO) continue;

        const meta = sub.metadata || {};
        // Evita mandar el correo dos veces para el mismo ciclo de cobro:
        // guardamos a qué current_period_end corresponde el último aviso
        // enviado, y solo mandamos otro si ese periodo ya cambió (es
        // decir, ya se renovó y estamos en un ciclo nuevo).
        if (meta.recordatorio_5d_periodo === String(sub.current_period_end)) continue;

        const customer = sub.customer && typeof sub.customer === 'object' ? sub.customer : null;
        const correo = customer ? customer.email : '';
        if (!correo) continue;

        const etiqueta = meta.tipo_pedido === 'suscripcion_aromas' ? 'Suscripción de Aromas' : 'Renta de Difusores';
        const datosCorreo = {
          nombre: customer.name || '',
          etiqueta,
          planNombre: meta.plan_nombre || '',
          aroma: meta.aroma_elegido || '',
          montoMensual: sub.items && sub.items.data[0] ? (sub.items.data[0].price.unit_amount / 100) : null,
          fechaLabel: fechaLegible(new Date(sub.current_period_end * 1000)),
        };

        try {
          await enviarCorreo(
            correo,
            `Tu ${etiqueta.toLowerCase()} NÚCLEO essences vence en ${DIAS_AVISO} días`,
            plantillaCorreo(datosCorreo)
          );
          await stripe.subscriptions.update(sub.id, {
            metadata: Object.assign({}, meta, { recordatorio_5d_periodo: String(sub.current_period_end) }),
          });
          enviados.push({ subscriptionId: sub.id, correo });
        } catch (errEnvio) {
          console.error('[cron-recordatorios] Error enviando a', correo, errEnvio);
          fallidos.push({ subscriptionId: sub.id, correo, error: errEnvio.message });
        }
      }

      if (!page.has_more || !page.data.length) break;
      startingAfter = page.data[page.data.length - 1].id;
    }

    res.status(200).json({ ok: true, enviados: enviados.length, fallidos: fallidos.length, detalle: { enviados, fallidos } });
  } catch (err) {
    console.error('[cron-recordatorios] Error:', err);
    res.status(500).json({ error: err.message || 'Ocurrió un error inesperado.' });
  }
};
