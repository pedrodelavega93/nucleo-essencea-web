    const { checkoutSessionId } = req.body || {};
    if (!checkoutSessionId) {
      res.status(400).json({ error: 'Falta checkoutSessionId' });
      return;
    }

    // Recupera la sesión de checkout original para obtener el ID del
    // cliente de Stripe que se creó al suscribirse.
    const checkoutSession = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    const customerId = checkoutSession.customer;

    if (!customerId) {
      res.status(400).json({ error: 'Esta sesión no tiene un cliente asociado (¿fue una suscripción?)' });
      return;
    }

    const origin = req.headers.origin || ('https://' + req.headers.host);

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: origin + '/',
    });

    res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error('Error creando sesión del portal de Stripe:', err);
    res.status(500).json({ error: 'No se pudo abrir el portal de gestión' });
  }
};
