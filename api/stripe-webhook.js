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
  // Preferimos el nombre legible del plan (p. ej. "Suscripción de Aromas —
  // 500 ml") sobre la clave interna del producto (p. ej. "aromasub500").
  if (meta.plan_nombre) partes.push(String(meta.plan_nombre));
  else if (meta.producto) partes.push(String(meta.producto));
  if (meta.aroma_elegido) partes.push('Aroma: ' + String(meta.aroma_elegido));
  if (meta.tipo_pedido === 'suscripcion_aromas') {
    partes.push('Entrega mensual con envío gratis');
  }
  return partes.length ? partes.join(' | ') : 'Tu pedido';
}

// Obtiene el nombre del cliente. Prioridad:
//   1) customer_details.name (nombre de facturación/cuenta)
//   2) nombre de la dirección de envío (shipping_details.name), que
//      según la versión de API puede venir en session.shipping_details
//      o en session.collected_information.shipping_details.
function obtenerNombre(session) {
  const cd = session.customer_details || {};
  if (cd.name) return cd.name;

  const envio = obtenerShippingDetails(session);
  if (envio && envio.name) return envio.name;

  return '';
}

// Devuelve el objeto shipping_details sin importar la versión de API.
// En API 2025-02-24+ la información recolectada se movió a
// `collected_information.shipping_details`; en versiones previas vivía
// directamente en `session.shipping_details`. Revisamos ambas.
function obtenerShippingDetails(session) {
  if (session.shipping_details) return session.shipping_details;
  if (
    session.collected_information &&
    session.collected_information.shipping_details
  ) {
    return session.collected_information.shipping_details;
  }
  return null;
}

// Convierte un objeto address de Stripe en una cadena legible de una línea.
function formatearDireccion(addr) {
  if (!addr) return '';
  const partes = [
    addr.line1,
    addr.line2,
    addr.postal_code ? 'C.P. ' + addr.postal_code : '',
    addr.city,
    addr.state,
    addr.country,
  ].filter(Boolean);
  return partes.join(', ');
}

// Obtiene la dirección relevante del pedido. Prioridad:
//   1) Dirección de instalación del difusor: custom_field de texto
//      `direccion_instalacion` (su valor está en field.text.value).
//   2) Dirección de envío recolectada (shipping_details.address).
//   3) Dirección de facturación (customer_details.address) como último recurso.
function obtenerDireccion(session) {
  // 1) Dirección de instalación escrita como custom_field de texto.
  const campos = Array.isArray(session.custom_fields) ? session.custom_fields : [];
  const instalacion = campos.find((c) => c.key === 'direccion_instalacion');
  if (instalacion && instalacion.text && instalacion.text.value) {
    return { etiqueta: 'Dirección de instalación', valor: instalacion.text.value };
  }

  // 2) Dirección de envío a domicilio.
  const envio = obtenerShippingDetails(session);
  if (envio && envio.address) {
    const valor = formatearDireccion(envio.address);
    if (valor) return { etiqueta: 'Dirección de envío', valor };
  }

  // 3) Dirección de facturación como respaldo.
  const cd = session.customer_details || {};
  if (cd.address) {
    const valor = formatearDireccion(cd.address);
    if (valor) return { etiqueta: 'Dirección', valor };
  }

  return { etiqueta: 'Dirección', valor: '' };
}

// Escapa texto para insertarlo de forma segura dentro del HTML.
function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Construye las filas de datos del cliente (Cliente, Correo, Dirección)
// para el HTML, omitiendo las que no tengan valor.
function filasClienteHtml({ nombre, correo, direccion }) {
  const filas = [];
  const fila = (etiqueta, valor) =>
    `<div style="margin-bottom:6px;"><span style="color:#c9a24b;">${escaparHtml(etiqueta)}:</span> <span style="color:#f5f0e6;">${escaparHtml(valor)}</span></div>`;

  if (nombre) filas.push(fila('Cliente', nombre));
  if (correo) filas.push(fila('Correo', correo));
  if (direccion && direccion.valor) filas.push(fila(direccion.etiqueta, direccion.valor));
  return filas.join('');
}

// Plantilla HTML del correo con la identidad dorado/negro de la marca.
function plantillaCorreo({ resumen, mensajeEntrega, total, nombre, correo, direccion }) {
  const resumenHtml = escaparHtml(resumen).replace(/\s\|\s/g, '<br>');
  const clienteHtml = filasClienteHtml({ nombre, correo, direccion });
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
              ${clienteHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a; border:1px solid #2a2a2a; border-radius:8px; margin-bottom:16px;">
                <tr>
                  <td style="padding:18px 20px; font-size:14px; line-height:1.6;">
                    ${clienteHtml}
                  </td>
                </tr>
              </table>` : ''}
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
function plantillaTexto({ resumen, mensajeEntrega, total, nombre, correo, direccion }) {
  return [
    '¡Gracias por tu compra en NÚCLEO essences! 🌿',
    '',
    nombre ? 'Cliente: ' + nombre : '',
    correo ? 'Correo: ' + correo : '',
    direccion && direccion.valor ? direccion.etiqueta + ': ' + direccion.valor : '',
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

// Normaliza un teléfono a solo dígitos para armar un enlace wa.me.
// Anteponemos "52" (México) si el número viene sin código de país.
function telefonoParaWhatsApp(telefono) {
  if (!telefono) return '';
  let digitos = String(telefono).replace(/\D/g, '');
  if (!digitos) return '';
  // 10 dígitos = número local mexicano sin lada internacional → anteponer 52.
  if (digitos.length === 10) digitos = '52' + digitos;
  return digitos;
}

// Plantilla del correo INTERNO para el dueño del negocio.
// Diseño simple (HTML básico + texto plano), sin identidad de marca.
function plantillaInterna({
  nombre,
  correo,
  telefono,
  resumen,
  total,
  recoleccion,
  direccion,
  paymentId,
}) {
  const waNumero = telefonoParaWhatsApp(telefono);
  const waLink = waNumero ? 'https://wa.me/' + waNumero : '';
  const resumenLineas = String(resumen)
    .split(/\s\|\s/)
    .map((l) => l.trim())
    .filter(Boolean);

  const entregaTexto = recoleccion
    ? 'Cliente eligió RECOLECCIÓN EN TIENDA — no requiere dirección'
    : `Envío a domicilio${direccion && direccion.valor ? ' — ' + direccion.valor : ''}`;

  // Cada fila: [etiqueta, valor de texto, (opcional) HTML del valor].
  // Si se provee HTML propio, se usa en el correo HTML (p. ej. el link de WhatsApp).
  const filas = [
    ['Cliente', nombre || '(sin nombre)'],
    ['Correo', correo || '(sin correo)'],
  ];

  // Fila de WhatsApp/Teléfono: se omite si el cliente no dio número.
  if (telefono) {
    const valorTexto = waLink ? `${telefono} (${waLink})` : telefono;
    const valorHtml = waLink
      ? `<a href="${waLink}" style="color:#128C7E; text-decoration:none;">${escaparHtml(telefono)}</a>`
      : escaparHtml(telefono);
    filas.push(['WhatsApp', valorTexto, valorHtml]);
  }

  filas.push(
    ['Producto(s)', resumenLineas.join(' • ') || resumen],
    ['Total', total || '(sin total)'],
    ['Método de entrega', entregaTexto],
    ['ID de pago (Stripe)', paymentId || '(sin ID)']
  );

  const filasHtml = filas
    .map(
      ([etiqueta, valor, valorHtml]) =>
        `<tr><td style="padding:6px 10px; border:1px solid #ddd; font-weight:bold; background:#f5f5f5; white-space:nowrap;">${escaparHtml(
          etiqueta
        )}</td><td style="padding:6px 10px; border:1px solid #ddd;">${valorHtml || escaparHtml(valor)}</td></tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="margin:0; padding:16px; font-family:Arial, Helvetica, sans-serif; color:#222;">
  <h2 style="margin:0 0 12px; font-size:18px;">Nuevo pedido recibido</h2>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:14px;">
    ${filasHtml}
  </table>
</body></html>`;

  const text = filas.map(([etiqueta, valor]) => `${etiqueta}: ${valor}`).join('\n');

  return { html, text };
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
      expand: [
        'shipping_cost.shipping_rate',
        'custom_fields',
        'customer_details',
      ],
    });

    // Log de diagnóstico: imprime la sesión completa para poder revisar en
    // los logs de Vercel qué estructura de datos realmente llega (nombre,
    // correo, dirección de envío/instalación, custom_fields, etc.).
    console.log('[v0] Sesión completa de Stripe:', JSON.stringify(session, null, 2));

    const email =
      (session.customer_details && session.customer_details.email) ||
      session.customer_email;

    const nombre = obtenerNombre(session);
    const direccion = obtenerDireccion(session);

    if (!email) {
      console.error('[v0] La sesión no tiene correo de cliente; no se envía confirmación.');
      res.status(200).json({ received: true, warning: 'sin email' });
      return;
    }

    const esSuscripcionAromas =
      session.metadata && session.metadata.tipo_pedido === 'suscripcion_aromas';

    const recoleccion = esRecoleccion(session);
    let mensajeEntrega;
    if (esSuscripcionAromas) {
      mensajeEntrega =
        'Tu suscripción quedó activa. En los próximos 3 a 5 días hábiles nos comunicaremos contigo para coordinar tu primera entrega, y a partir de ahí recibirás tu aroma automáticamente cada mes con envío 100% gratuito. Puedes cambiar de aroma o cancelar cuando quieras desde "Gestionar mi suscripción" en nuestro sitio.';
    } else if (recoleccion) {
      mensajeEntrega =
        'En los próximos 3 a 5 días hábiles nos estaremos comunicando contigo para avisarte que tu pedido ya está listo para recolectar.';
    } else {
      mensajeEntrega =
        'En los próximos 3 a 5 días hábiles nos estaremos comunicando contigo por parte de NÚCLEO essences para coordinar la entrega de tu pedido.';
    }

    const resumen = construirResumen(session);
    const total = formatearTotal(session);

    const { error } = await resend.emails.send({
      from: REMITENTE,
      to: email,
      subject: '¡Gracias por tu compra en NÚCLEO essences! 🌿',
      html: plantillaCorreo({ resumen, mensajeEntrega, total, nombre, correo: email, direccion }),
      text: plantillaTexto({ resumen, mensajeEntrega, total, nombre, correo: email, direccion }),
    });

    if (error) {
      console.error('[v0] Error enviando el correo con Resend:', error);
      // Respondemos 200 para que Stripe no reintente indefinidamente,
      // pero dejamos el error en los logs para diagnóstico.
      res.status(200).json({ received: true, emailError: true });
      return;
    }

    console.log('[v0] Correo de confirmación enviado a', email);

    // ── Segundo correo: notificación interna al dueño del negocio ──
    const paymentId =
      (typeof session.payment_intent === 'string' && session.payment_intent) ||
      (session.payment_intent && session.payment_intent.id) ||
      session.id;

    const montoAsunto =
      typeof session.amount_total === 'number'
        ? (session.amount_total / 100).toLocaleString('es-MX', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : '0.00';

    const telefono =
      (session.customer_details && session.customer_details.phone) || '';

    const interno = plantillaInterna({
      nombre,
      correo: email,
      telefono,
      resumen,
      total,
      recoleccion,
      direccion,
      paymentId,
    });

    const { error: errorInterno } = await resend.emails.send({
      from: REMITENTE,
      to: 'pedro.delavega93@gmail.com',
      subject: `Nuevo pedido: ${nombre || 'Cliente'} - $${montoAsunto} MXN`,
      html: interno.html,
      text: interno.text,
    });

    if (errorInterno) {
      console.error('[v0] Error enviando la notificación interna con Resend:', errorInterno);
    } else {
      console.log('[v0] Notificación interna enviada a pedro.delavega93@gmail.com');
    }

    res.status(200).json({ received: true, emailSent: true });
  } catch (err) {
    console.error('[v0] Error procesando checkout.session.completed:', err);
    res.status(500).json({ error: 'Error procesando el evento' });
  }
};
