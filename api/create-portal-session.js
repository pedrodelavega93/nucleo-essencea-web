
    const customers = await stripe.customers.list({
      email: email.trim().toLowerCase(),
      limit: 1,
    });

    if (!customers.data.length) {
      return res.status(404).json({
        error: 'No encontramos ninguna suscripción activa con ese correo.',
      });
    }

    const customer = customers.data[0];

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${getBaseUrl(req)}/`,
    });

    return res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error('Error creando sesión del portal:', err);
    return res.status(500).json({
      error: 'Ocurrió un error al generar el acceso. Intenta de nuevo.',
    });
  }
};

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
