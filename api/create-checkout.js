    // y saber que este checkout incluye una dirección de instalación. El
    // valor que el cliente escriba queda en session.custom_fields
    // (campo "direccion_instalacion") del evento checkout.session.completed,
    // que Zapier puede leer y agregar al correo de aviso de pedido.
    sessionConfig.metadata = {
      producto: productKey,
      aroma_elegido: aroma ? String(aroma).slice(0, 200) : '',
      requiere_instalacion: requiereInstalacion ? 'si' : 'no',
      campo_instalacion_key: requiereInstalacion ? 'direccion_instalacion' : '',
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
