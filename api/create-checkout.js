// ============================================================
// NÚCLEO essences — crea una sesión de pago de Stripe.
//
// Soporta DOS flujos:
//   1) Producto único / suscripción:  body = { productKey, aroma }
//      (se usa para los planes de suscripción y compras directas)
//   2) Carrito de compra única:        body = { items: [ ... ] }
//      donde cada item = { productKey, quantity, color, aroma, name }
//
// Se ejecuta en el servidor (Vercel Serverless Function).
// Requiere la variable de entorno STRIPE_SECRET_KEY configurada
// en Vercel (Project Settings → Environment Variables) — NUNCA
// se debe escribir la clave secreta directamente en este archivo.
// ============================================================

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Catálogo de perfumes (marca y género) — se usa para completar
// automáticamente esos datos en el resumen del pedido a partir del
// nombre del aroma que eligió el cliente.
const { buscarAroma } = require('./_aroma-catalog');

// ------------------------------------------------------------
// Cada "price_..." es el Price ID real de Stripe (Dashboard →
// Product catalog → el producto → sección "Pricing" → el ID que
// empieza con "price_").
// mode: 'payment' para pago único, 'subscription' para renta mensual.
// ------------------------------------------------------------
// Productos que implican instalación física de un difusor y por lo tanto
// requieren pedir la dirección de instalación (además de la de facturación).
// Los perfumes, aerosoles y aceites NO se incluyen aquí.
const DIFUSOR_KEYS = ['a60', 'a300', 'a1000', 'a3000', 'a5000', 'carpro'];

// ---------- Pago "A Plazos" (solo A300, A1000, A3000, A5000) ----------
// Mismas constantes que en script.js — deben coincidir para que el precio
// mostrado en el carrito sea idéntico al que realmente se cobra en Stripe.
const MSI_ELIGIBLE_PRODUCTS = ['a300', 'a1000', 'a3000', 'a5000'];
const MSI_FEES = { 3: 0.05, 6: 0.075, 12: 0.125 };
const CARD_FEE_PCT = 0.036;
const CARD_FEE_FIXED_CENTS = 300; // $3 MXN, en centavos

const PRODUCTS = {
  perfume30:  { price: 'price_1Tv3HPB3WyWa7QbIkGZYMj9D',  mode: 'payment' },
  perfume60:  { price: 'price_1Tv3HlB3WyWa7QbIAcw4YoAz',  mode: 'payment' },
  perfume100: { price: 'price_1Tv3HyB3WyWa7QbILGlyxXhC', mode: 'payment' },
  aerosol250: { price: 'price_1Tv3GXB3WyWa7QbI0f144C2n',    mode: 'payment' },
  aceite250:  { price: 'price_1Tv3IZB3WyWa7QbI7tGML2Gm',  mode: 'payment' },
  aceite500:  { price: 'price_1Tv3K1B3WyWa7QbILWSjSq8X',  mode: 'payment' },
  aceite1l:   { price: 'price_1Tv3KWB3WyWa7QbIzTlhYuNC',   mode: 'payment' },
  a60:        { price: 'price_1Tv398B3WyWa7QbIucxCNSDA', mode: 'payment' },
  a300:       { price: 'price_1TvARuB3WyWa7QbI6Z86y3hi',       mode: 'payment' },
  a1000:      { price: 'price_1TvAUFB3WyWa7QbIPrrvWx5C',      mode: 'payment' },
  a3000:      { price: 'price_1TvAWYB3WyWa7QbITt7KyO7O',      mode: 'payment' },
  a5000:      { price: 'price_1TvAXmB3WyWa7QbI2zUc9Hp9',      mode: 'payment' },
  carpro:     { price: 'price_1TvAZFB3WyWa7QbIBlc2cVVN',     mode: 'payment' },
  esencia:    { price: 'price_1Tv9vlB3WyWa7QbIZL61UoVI',    mode: 'subscription', label: 'Renta de Difusores — Esencia' },
  aura:       { price: 'price_1Tv9yfB3WyWa7QbILG8VV0D1',       mode: 'subscription', label: 'Renta de Difusores — Aura' },
  sublime:    { price: 'price_1Tv9zNB3WyWa7QbIMywDaXBB',    mode: 'subscription', label: 'Renta de Difusores — Sublime' },

  // Suscripción de Aromas: aceite ambiental mensual con envío gratuito.
  // No usan un Price ID pre-creado; el precio recurrente se define en línea
  // con price_data (recurring), así no hace falta configurar nada en el
  // Dashboard. El monto (unit_amount) está en centavos MXN.
  aromasub250: { mode: 'subscription', aromaSub: true, amount: 90000,  size: '250 ml', label: 'Suscripción de Aromas — 250 ml' },
  aromasub500: { mode: 'subscription', aromaSub: true, amount: 130000, size: '500 ml', label: 'Suscripción de Aromas — 500 ml' },
  aromasub1l:  { mode: 'subscription', aromaSub: true, amount: 200000, size: '1 litro', label: 'Suscripción de Aromas — 1 litro' },
};

// Opciones de envío / recolección para pagos únicos (Stripe no las
// permite en modo suscripción). El cliente elige aquí su método de entrega.
function buildShippingOptions() {
  return [
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: 10000, currency: 'mxn' }, // $100 MXN
        display_name: 'Envío a domicilio (Zona Metropolitana de Monterrey)',
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 2 },
          maximum: { unit: 'business_day', value: 5 },
        },
      },
    },
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: 0, currency: 'mxn' },
        display_name: 'Recoger en: Abi Corpus Hair Studio (José Peón y Contreras 2125-A, Contry Sol, Guadalupe)',
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 2 },
          maximum: { unit: 'business_day', value: 5 },
        },
      },
    },
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: 25000, currency: 'mxn' }, // $250 MXN
        display_name: 'Envío nacional (fuera de Nuevo León)',
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 5 },
          maximum: { unit: 'business_day', value: 7 },
        },
      },
    },
  ];
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
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  try {
    const body = req.body || {};
    const origin = req.headers.origin || ('https://' + req.headers.host);

    // ========================================================
    // FLUJO 1 — CARRITO DE COMPRA ÚNICA (varios productos)
    // ========================================================
    if (Array.isArray(body.items) && body.items.length) {
      const lineItems = [];
      const resumenPartes = [];
      let hayDifusor = false;

      for (const item of body.items) {
        const product = PRODUCTS[item.productKey];
        if (!product) {
          res.status(400).json({ error: 'Producto no reconocido en el carrito: ' + item.productKey });
          return;
        }
        // Stripe NO permite mezclar suscripciones con pagos únicos en un
        // mismo checkout — el carrito solo admite productos de pago único.
        if (product.mode !== 'payment') {
          res.status(400).json({ error: 'El plan de suscripción no puede agregarse al carrito. Solicítalo por separado.' });
          return;
        }
        if (product.price.includes('PENDIENTE')) {
          res.status(500).json({ error: 'Falta configurar el Price ID de Stripe para "' + item.productKey + '".' });
          return;
        }

        const qty = Math.max(1, parseInt(item.quantity, 10) || 1);

        if (DIFUSOR_KEYS.includes(item.productKey)) hayDifusor = true;

        // Variantes elegidas por el cliente (color y/o aroma). Para el
        // aroma, buscamos su marca y género en el catálogo para que
        // queden reflejados tanto en Stripe como en el correo interno.
        const variantes = [];
        if (item.color) variantes.push('Color: ' + String(item.color));
        if (item.aroma) {
          const info = buscarAroma(item.aroma);
          variantes.push(
            info
              ? `Aroma: ${item.aroma} — ${info.marca} — ${info.genero}`
              : 'Aroma: ' + String(item.aroma)
          );
        }

        // Recuperamos el Price real de Stripe para reutilizar su monto,
        // moneda, nombre e imagen (Stripe sigue siendo la fuente de verdad
        // del precio; el cliente nunca lo define). Con esos datos armamos un
        // "price_data" cuyo product_data.name incluye el color/aroma, para
        // que la variante SÍ se muestre en la página de pago de Stripe
        // (usar solo el Price ID existente muestra únicamente el nombre base).
        const priceObj = await stripe.prices.retrieve(product.price, {
          expand: ['product'],
        });

        const nombreBase =
          (priceObj.product && priceObj.product.name) ||
          (item.name ? String(item.name) : item.productKey);
        const nombreConVariante =
          nombreBase + (variantes.length ? ' — ' + variantes.join(', ') : '');

        const productData = { name: nombreConVariante.slice(0, 250) };
        if (variantes.length) productData.description = variantes.join(', ');
        if (priceObj.product && Array.isArray(priceObj.product.images) && priceObj.product.images.length) {
          productData.images = priceObj.product.images;
        }

        lineItems.push({
          quantity: qty,
          price_data: {
            currency: priceObj.currency,
            unit_amount: priceObj.unit_amount,
            product_data: productData,
          },
        });

        // Resumen legible que viaja en la metadata para los correos de aviso.
        const nombre = item.name ? String(item.name) : item.productKey;
        resumenPartes.push(
          nombre + (variantes.length ? ' (' + variantes.join(', ') + ')' : '') + ' x' + qty
        );
      }

      // ---------- Pago "A Plazos" (solo si TODO el carrito es elegible) ----------
      // Validamos en el servidor, sin confiar en lo que mande el navegador —
      // así nadie puede forzar el precio a plazos sobre productos que no
      // deben llevarlo (perfumes, aceites, etc.).
      const paymentPlan = body.paymentPlan || { type: 'contado' };
      let esPlazos = false;
      let mesesPlazos = null;

      if (paymentPlan.type === 'plazos') {
        mesesPlazos = parseInt(paymentPlan.months, 10);
        const feeMsi = MSI_FEES[mesesPlazos];
        const todosElegibles = body.items.every((it) => MSI_ELIGIBLE_PRODUCTS.includes(it.productKey));

        if (!feeMsi) {
          res.status(400).json({ error: 'El plazo a meses elegido no es válido.' });
          return;
        }
        if (!todosElegibles) {
          res.status(400).json({ error: 'El pago a plazos solo está disponible cuando el carrito contiene únicamente difusores A300, A1000, A3000 o A5000.' });
          return;
        }

        // Ajustamos el precio total (no cada línea por separado) para que el
        // costo fijo de $3 MXN de Stripe se aplique una sola vez por
        // transacción, y luego repartimos el ajuste proporcionalmente entre
        // las líneas del carrito.
        const totalContadoCents = lineItems.reduce(
          (s, li) => s + li.price_data.unit_amount * li.quantity, 0
        );
        const denominador = 1 - CARD_FEE_PCT - feeMsi;
        let totalPlazosCents = Math.round((totalContadoCents + CARD_FEE_FIXED_CENTS) / denominador);
        // Redondeo a peso completo — debe coincidir exactamente con el
        // mismo redondeo que hace calcularPrecioAPlazos() en script.js,
        // para que el total que el cliente vio en el carrito sea idéntico
        // al que realmente se le cobra aquí (sin diferencia de centavos).
        totalPlazosCents = Math.round(totalPlazosCents / 100) * 100;
        const factor = totalPlazosCents / totalContadoCents;

        lineItems.forEach((li) => {
          li.price_data.unit_amount = Math.round(li.price_data.unit_amount * factor);
        });

        esPlazos = true;
      }

      const sessionConfig = {
        mode: 'payment',
        line_items: lineItems,
        shipping_address_collection: { allowed_countries: ['MX'] },
        phone_number_collection: { enabled: true },
        shipping_options: buildShippingOptions(),
        success_url: origin + '/?pago=exitoso',
        cancel_url: origin + '/?pago=cancelado',
      };

      // Activa Meses Sin Intereses de Stripe únicamente en esta sesión — el
      // precio ya viene ajustado arriba para que a NÚCLEO le quede el mismo
      // neto sin importar el plazo que elija el cliente.
      if (esPlazos) {
        sessionConfig.payment_method_options = {
          card: { installments: { enabled: true } },
        };
      }

      const customFields = [];

      // Dirección de instalación solo si el carrito incluye algún difusor.
      if (hayDifusor) {
        customFields.push({
          key: 'direccion_instalacion',
          label: { type: 'custom', custom: 'Dirección de instalación del difusor' },
          type: 'text',
          optional: false,
          text: { minimum_length: 10, maximum_length: 200 },
        });
      }

      if (customFields.length) sessionConfig.custom_fields = customFields;

      // Mensaje sobre el botón de pago: método de entrega + (si aplica) instalación.
      const mensajes = [
        'Elige tu método de entrega arriba. Si seleccionas "Recoger en Abi Corpus Hair Studio", te avisaremos por correo o WhatsApp cuando tu pedido esté listo para recoger.',
      ];
      if (hayDifusor) {
        mensajes.push('En la dirección de instalación del difusor incluye calle, número, colonia y código postal.');
      }
      if (esPlazos) {
        mensajes.push(
          `El precio ya incluye el costo de administración por financiamiento con tarjeta de crédito. Selecciona el plan a ${mesesPlazos} meses cuando tu tarjeta lo muestre como opción.`
        );
      }
      sessionConfig.custom_text = { submit: { message: mensajes.join(' ') } };

      // Metadata para el correo de aviso de pedido (Zapier: Stripe → Gmail).
      sessionConfig.metadata = {
        tipo_pedido: 'carrito',
        resumen_pedido: resumenPartes.join(' | ').slice(0, 500),
        requiere_instalacion: hayDifusor ? 'si' : 'no',
        campo_instalacion_key: hayDifusor ? 'direccion_instalacion' : '',
        plan_pago: esPlazos ? ('plazos_' + mesesPlazos + 'm') : 'contado',
      };

      const session = await stripe.checkout.sessions.create(sessionConfig);
      res.status(200).json({ url: session.url });
      return;
    }

    // ========================================================
    // FLUJO 2 — PRODUCTO ÚNICO / SUSCRIPCIÓN (comportamiento previo)
    // ========================================================
    const { productKey, aroma } = body;
    const product = PRODUCTS[productKey];

    if (!product) {
      res.status(400).json({ error: 'Producto no reconocido: ' + productKey });
      return;
    }
    if (!product.aromaSub && product.price && product.price.includes('PENDIENTE')) {
      res.status(500).json({ error: 'Falta configurar el Price ID de Stripe para "' + productKey + '" en api/create-checkout.js' });
      return;
    }

    // La Suscripción de Aromas define su precio recurrente en línea (no usa
    // un Price ID pre-creado). El nombre incluye el aroma inicial elegido.
    let lineItem;
    if (product.aromaSub) {
      const nombreProducto =
        (product.label || 'Suscripción de Aromas') + (aroma ? ' — ' + String(aroma) : '');
      lineItem = {
        quantity: 1,
        price_data: {
          currency: 'mxn',
          unit_amount: product.amount,
          recurring: { interval: 'month' },
          product_data: {
            name: nombreProducto.slice(0, 250),
            description: 'Aceite ambiental mensual con envío 100% gratuito incluido.',
          },
        },
      };
    } else {
      lineItem = { price: product.price, quantity: 1 };
    }

    const sessionConfig = {
      mode: product.mode,
      line_items: [lineItem],
      shipping_address_collection: { allowed_countries: ['MX'] },
      phone_number_collection: { enabled: true },
      success_url: product.mode === 'subscription'
        ? origin + '/?pago=exitoso&sub=1&session_id={CHECKOUT_SESSION_ID}'
        : origin + '/?pago=exitoso',
      cancel_url: origin + '/?pago=cancelado',
    };

    // Stripe no permite "shipping_options" (tarifas de envío) en modo
    // suscripción — solo en pagos únicos. Para los planes de renta mensual
    // se sigue pidiendo la dirección (arriba) y el método de entrega se
    // ofrece como campo desplegable (custom_field) más abajo.
    if (product.mode === 'payment') {
      sessionConfig.shipping_options = buildShippingOptions();
    }

    // Construimos los custom_fields de forma incremental para no
    // sobreescribir ninguno. Stripe admite hasta 3 custom_fields.
    const customFields = [];

    // 1) Aroma elegido (se conserva tal cual estaba)
    if (aroma && String(aroma).trim()) {
      customFields.push({
        key: 'aroma_elegido',
        label: { type: 'custom', custom: '¿Qué aroma elegiste del catálogo?' },
        type: 'text',
        text: { default_value: String(aroma).slice(0, 140) },
      });
    }

    // 2) Dirección de instalación del difusor — solo para difusores y
    //    planes de RENTA de difusores (implican instalación física).
    //    La Suscripción de Aromas NO instala equipo, así que se excluye.
    const requiereInstalacion =
      (product.mode === 'subscription' && !product.aromaSub) ||
      DIFUSOR_KEYS.includes(productKey);

    if (requiereInstalacion) {
      customFields.push({
        // NOTA: la "key" de un custom_field de Stripe debe ser una cadena
        // alfanumérica válida (no una variable de entorno). Este es el
        // identificador con el que el dato aparece en el objeto session.
        key: 'direccion_instalacion',
        label: {
          type: 'custom',
          // Stripe limita este label a 50 caracteres.
          custom: 'Dirección de instalación del difusor',
        },
        type: 'text',
        optional: false,
        text: {
          minimum_length: 10,
          maximum_length: 200,
        },
      });
    }

    // 3) Método de entrega — solo para la RENTA de difusores (suscripción),
    //    donde Stripe no permite shipping_options. La Suscripción de Aromas
    //    NO ofrece recolección en tienda: siempre es envío a domicilio gratis,
    //    por eso se omite este campo para ella.
    if (product.mode === 'subscription' && !product.aromaSub) {
      customFields.push({
        key: 'metodo_entrega',
        label: { type: 'custom', custom: 'Método de entrega' },
        type: 'dropdown',
        dropdown: {
          options: [
            { label: 'Envío a domicilio', value: 'envio' },
            { label: 'Recoger en Abi Corpus Hair Studio', value: 'recoger' },
          ],
        },
      });
    }

    if (customFields.length) {
      sessionConfig.custom_fields = customFields;
    }

    // Stripe no permite un "placeholder" por campo, así que las aclaraciones
    // se muestran como mensaje sobre el botón de pago.
    const mensajes = [];
    if (product.aromaSub) {
      mensajes.push('Tu aceite ambiental llega a domicilio cada mes con envío 100% gratuito. Puedes cambiar de aroma o cancelar cuando quieras desde "Gestionar mi suscripción".');
    } else if (product.mode === 'subscription') {
      mensajes.push('Elige tu método de entrega. Si seleccionas "Recoger en Abi Corpus Hair Studio", te avisaremos por correo o WhatsApp cuando tu equipo esté listo para recoger.');
    }
    if (requiereInstalacion) {
      mensajes.push('En la dirección de instalación del difusor incluye calle, número, colonia y código postal.');
    }
    if (mensajes.length) {
      sessionConfig.custom_text = { submit: { message: mensajes.join(' ') } };
    }

    // Metadata para que Zapier (Stripe → Gmail) pueda identificar el pedido
    // y saber que este checkout incluye una dirección de instalación. El
    // valor que el cliente escriba queda en session.custom_fields
    // (campo "direccion_instalacion") del evento checkout.session.completed,
    // que Zapier puede leer y agregar al correo de aviso de pedido.
    sessionConfig.metadata = {
      producto: productKey,
      aroma_elegido: aroma ? String(aroma).slice(0, 200) : '',
      requiere_instalacion: requiereInstalacion ? 'si' : 'no',
      campo_instalacion_key: requiereInstalacion ? 'direccion_instalacion' : '',
      // Tipo de pedido para que el webhook y la gestión sepan qué es esto.
      tipo_pedido: product.aromaSub
        ? 'suscripcion_aromas'
        : product.mode === 'subscription'
          ? 'suscripcion_renta'
          : 'producto',
      tamano: product.size || '',
      plan_nombre: product.label || String(productKey),
      envio_gratis: product.aromaSub ? 'si' : 'no',
    };

    // En suscripciones, propagamos también la metadata a la suscripción
    // creada para que el dato viaje a los eventos posteriores.
    if (product.mode === 'subscription') {
      sessionConfig.subscription_data = { metadata: sessionConfig.metadata };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Error creando sesión de Stripe:', err);
    // Devolvemos el mensaje real de Stripe para poder diagnosticar fallos
    // (por ejemplo, un Price ID de suscripción mal configurado).
    res.status(500).json({ error: err.message || 'No se pudo crear la sesión de pago' });
  }
};
