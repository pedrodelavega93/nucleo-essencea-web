// ============================================================
// NÚCLEO essences — comportamiento del sitio
// ============================================================

// --- Nav flotante: aparece después del hero ---
const topnav = document.querySelector('.topnav');
const hero = document.querySelector('.hero');
if (topnav && hero) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        topnav.classList.toggle('show', !entry.isIntersecting);
      });
    },
    { threshold: 0.05 }
  );
  io.observe(hero);
}

// --- Dropdown "NÚCLEO BUSINESS" en el nav superior ---
document.querySelectorAll('[data-nav-dropdown]').forEach((dd) => {
  const toggle = dd.querySelector('.nav-dropdown-toggle');
  if (!toggle) return;

  // En escritorio abre por hover (CSS); el click también alterna para
  // pantallas táctiles / accesibilidad por teclado.
  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    const abierto = dd.classList.toggle('open');
    toggle.setAttribute('aria-expanded', abierto ? 'true' : 'false');
  });

  // Al elegir una opción, cierra el menú (el scroll lo hace el ancla).
  dd.querySelectorAll('.nav-dropdown-menu a').forEach((link) => {
    link.addEventListener('click', () => {
      dd.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });

  // Cierra al hacer click fuera del dropdown.
  document.addEventListener('click', (e) => {
    if (!dd.contains(e.target)) {
      dd.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
});

// --- Revelado suave de secciones al hacer scroll ---
const revealEls = document.querySelectorAll('.reveal');
if (revealEls.length) {
  const revealIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          revealIO.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.14 }
  );
  revealEls.forEach((el) => revealIO.observe(el));
}

// --- Modal de video ("Ver funcionamiento") ---
const modal = document.getElementById('videoModal');
const modalVideo = document.getElementById('modalVideo');
const modalLabel = document.getElementById('modalLabel');
const modalClose = document.getElementById('modalClose');

function openVideo(src, poster, label) {
  modalVideo.setAttribute('poster', poster || '');
  modalVideo.querySelector('source').setAttribute('src', src);
  modalVideo.load();
  modalLabel.textContent = label || '';
  modal.classList.add('open');
  modalVideo.play().catch(() => {
    /* autoplay bloqueado por el navegador: el usuario puede darle play manualmente */
  });
  document.body.style.overflow = 'hidden';
}

function closeVideo() {
  modal.classList.remove('open');
  modalVideo.pause();
  modalVideo.currentTime = 0;
  document.body.style.overflow = '';
}

document.querySelectorAll('[data-video]').forEach((btn) => {
  btn.addEventListener('click', () => {
    openVideo(btn.dataset.video, btn.dataset.poster, btn.dataset.label);
  });
});

modalClose.addEventListener('click', closeVideo);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeVideo();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal.classList.contains('open')) closeVideo();
});

// --- Selección de aromas del cliente (para autollenar el checkout) ---
const selectedAromas = { perfumes: '', ambientales: '', carpro: '', 'aromas-sub': '' };

// --- Selector de aroma de regalo (CAR PRO) ---
const carproPicker = document.getElementById('carproAromaPicker');
const carproHint = document.getElementById('carproAromaHint');
if (carproPicker && carproHint) {
  carproPicker.querySelectorAll('.mini-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      carproPicker.querySelectorAll('.mini-chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedAromas.carpro = chip.dataset.aroma;
      carproHint.textContent = 'Aroma seleccionado: ' + chip.dataset.aroma + ' ✓ (ya quedará prellenado en tu pago)';
    });
  });
}

// --- Banner de pago exitoso + botón "Gestionar mi suscripción" ---
(function initSuccessBanner() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('pago') !== 'exitoso') return;

  const banner = document.getElementById('successBanner');
  const bannerText = document.getElementById('successBannerText');
  const manageBtn = document.getElementById('manageSubBtn');
  const closeBtn = document.getElementById('successBannerClose');
  if (!banner) return;

  banner.classList.add('show');
  closeBtn.addEventListener('click', () => banner.classList.remove('show'));

  const sessionId = params.get('session_id');
  if (params.get('sub') === '1' && sessionId) {
    bannerText.textContent = '¡Tu suscripción quedó activa!';
    manageBtn.style.display = 'inline-block';
    manageBtn.addEventListener('click', async () => {
      manageBtn.textContent = 'Abriendo…';
      try {
        const resp = await fetch('/api/create-portal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkoutSessionId: sessionId }),
        });
        const data = await resp.json();
        if (data.url) {
          window.location.href = data.url;
          return;
        }
        throw new Error(data.error || 'Sin URL de portal');
      } catch (err) {
        console.error('No se pudo abrir el portal:', err);
        manageBtn.textContent = 'Gestionar mi suscripción →';
        alert('No se pudo abrir el portal de gestión. Escríbenos por WhatsApp para ayudarte con tu suscripción.');
      }
    });
  }
})();

// --- Botón flotante "subir arriba" ---
const scrollTopBtn = document.getElementById('scrollTopBtn');
if (scrollTopBtn) {
  window.addEventListener('scroll', () => {
    scrollTopBtn.classList.toggle('show', window.scrollY > window.innerHeight * 0.6);
  });
  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// --- Checkout dinámico con aroma prellenado ---
// Cualquier botón con [data-product] crea la sesión de pago en el servidor
// (api/create-checkout.js) mandando el aroma que el cliente eligió, para
// que llegue ya prellenado en el formulario de Stripe.
async function goToCheckout(btn) {
  const productKey = btn.dataset.product;
  const catalogSource = btn.dataset.aromaFrom; // 'perfumes' | 'ambientales' | 'carpro' | 'aromas-sub' | undefined
  const aroma = catalogSource ? selectedAromas[catalogSource] : '';

  // La Suscripción de Aromas requiere elegir el aroma inicial antes de pagar.
  if (btn.classList.contains('aroma-sub-cta') && !(aroma && aroma.trim())) {
    const hint = document.getElementById('aromaSubHint');
    if (hint) {
      hint.textContent = 'Primero elige tu aroma inicial en el catálogo ☝️';
      hint.classList.remove('selected');
    }
    openCatalog('aromas-sub');
    return;
  }

  const originalText = btn.textContent;
  btn.textContent = 'Abriendo pago…';
  btn.style.pointerEvents = 'none';

  try {
    const resp = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productKey, aroma }),
    });
    const data = await resp.json();
    if (data.url) {
      // Redirección directa al checkout de pago de Stripe.
      window.location.href = data.url;
      return;
    }
    throw new Error(data.error || 'Sin URL de pago');
  } catch (err) {
    // El flujo de compra/suscripción NUNCA debe caer a WhatsApp: si Stripe
    // falla, mostramos el motivo real para poder corregirlo, y el cliente
    // permanece en el sitio en lugar de ser desviado.
    console.error('No se pudo abrir el checkout de Stripe:', err);
    alert(
      'No pudimos abrir el pago en este momento.\n\n' +
      'Detalle: ' + (err && err.message ? err.message : 'error desconocido') +
      '\n\nPor favor inténtalo de nuevo en unos segundos.'
    );
  } finally {
    btn.textContent = originalText;
    btn.style.pointerEvents = '';
  }
}

// Solo los botones de pago directo (suscripciones / compra inmediata) usan
// goToCheckout. Los botones de "Añadir al carrito" también llevan
// data-product, así que se excluyen aquí y se manejan en el módulo de carrito.
// CORREGIDO: también se excluyen los botones de tamaño del selector de
// aceite (.catalog-size), que llevan data-product solo para identificar
// el tamaño elegido y NO deben disparar el checkout directo.
document.querySelectorAll('[data-product]:not([data-add-to-cart]):not(.catalog-size)').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    goToCheckout(btn);
  });
});

// --- Modal de catálogo (perfumes / aromas ambientales) ---
const catalogModal = document.getElementById('catalogModal');
const catalogClose = document.getElementById('catalogModalClose');
const catalogInput = document.getElementById('catalogSearchInput');
const catalogResults = document.getElementById('catalogResults');
const catalogCount = document.getElementById('catalogResultsCount');
const catalogTitle = document.getElementById('catalogModalTitle');
const catalogSub = document.getElementById('catalogModalSub');

// Panel de compra de aceite (destacados + tamaños + añadir al carrito).
const catalogFeatured = document.getElementById('catalogFeatured');
const catalogFeaturedChips = document.getElementById('catalogFeaturedChips');
const catalogBuy = document.getElementById('catalogBuy');
const catalogBuyAroma = document.getElementById('catalogBuyAroma');
const catalogBuySizes = document.getElementById('catalogBuySizes');
const catalogBuyAdd = document.getElementById('catalogBuyAdd');

// Aromas destacados ("Los más pedidos") para el modo compra de aceite.
const FEATURED_AROMAS = [
  'Palacio de Hierro',
  'Metropolitan',
  'Hotel Xcaret',
  'Santal 33',
  'Berries/Muy Mucho',
  'Pink Peony',
  'Green Tea & Bergamot',
];

let currentCatalogData = [];
let currentCatalogType = 'perfumes';
// Cuando se define, al elegir un aroma se llama esta función en lugar del
// comportamiento por defecto (se usa para el cambio de aroma en la gestión).
let catalogOnSelect = null;
// Modo compra de aceite: muestra destacados + selector de tamaño + añadir.
let catalogBuyMode = false;
// Aroma y tamaño elegidos dentro del modal en modo compra.
let buyAroma = '';
let buyProductKey = '';

function selectAromaFromCatalog(type, name) {
  selectedAromas[type] = name;
  document.querySelectorAll('[data-catalog="' + type + '"]').forEach((btn) => {
    btn.textContent = 'Aroma elegido: ' + name + ' (cambiar) →';
  });
  // Refresca el texto de ayuda de la sección "Suscripción de Aromas".
  if (type === 'aromas-sub') {
    const hint = document.getElementById('aromaSubHint');
    if (hint) {
      hint.textContent = 'Aroma inicial: ' + name + ' ✓ — ya puedes suscribirte.';
      hint.classList.add('selected');
    }
  }
}

function renderCatalogRows(data) {
  if (!data.length) {
    catalogResults.innerHTML = '<div class="catalog-empty">Sin resultados — prueba con otro nombre o marca.</div>';
    catalogCount.textContent = '';
    return;
  }
  catalogCount.textContent = data.length + (currentCatalogType === 'perfumes' ? ' perfumes' : ' aromas');
  const rows = data.map((item) => {
    const safeName = item.name.replace(/"/g, '&quot;');
    if (currentCatalogType === 'perfumes') {
      return '<div class="catalog-row" data-name="' + safeName + '"><span class="cr-name">' + item.name + '</span><span class="cr-meta">' + item.brand + ' · ' + item.gender + '</span></div>';
    }
    const meta = item.accords ? item.accords : item.category;
    return '<div class="catalog-row" data-name="' + safeName + '"><span class="cr-name">' + item.name + '</span><span class="cr-meta">' + meta + '</span></div>';
  });
  catalogResults.innerHTML = rows.join('');
  catalogResults.querySelectorAll('.catalog-row').forEach((row) => {
    row.addEventListener('click', () => {
      const name = row.dataset.name;
      if (catalogBuyMode) {
        // En modo compra, elegir un aroma NO cierra el modal: se guarda para
        // combinarlo con el tamaño y añadirlo al carrito.
        setBuyAroma(name);
      } else if (typeof catalogOnSelect === 'function') {
        const cb = catalogOnSelect;
        closeCatalog();
        cb(name);
      } else {
        selectAromaFromCatalog(currentCatalogType, name);
        closeCatalog();
      }
    });
  });
}

// --- Modo compra de aceite: destacados, aroma y tamaño ---
function setBuyAroma(name) {
  buyAroma = name;
  catalogBuyAroma.textContent = name;
  catalogBuy.style.display = 'block';
  // Marca visualmente el chip destacado correspondiente (si aplica).
  catalogFeaturedChips.querySelectorAll('.catalog-featured-chip').forEach((c) => {
    c.classList.toggle('selected', c.dataset.aroma === name);
  });
  updateBuyAddState();
  // Lleva el foco al panel de compra para continuar el flujo.
  catalogBuy.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateBuyAddState() {
  catalogBuyAdd.disabled = !(buyAroma && buyProductKey);
}

function renderFeaturedChips() {
  catalogFeaturedChips.innerHTML = FEATURED_AROMAS.map((name) => {
    const safe = name.replace(/"/g, '&quot;');
    return '<button type="button" class="catalog-featured-chip" data-aroma="' + safe + '">' + name + '</button>';
  }).join('');
  catalogFeaturedChips.querySelectorAll('.catalog-featured-chip').forEach((chip) => {
    chip.addEventListener('click', () => setBuyAroma(chip.dataset.aroma));
  });
}

// Selección del tamaño dentro del panel de compra.
if (catalogBuySizes) {
  catalogBuySizes.querySelectorAll('.catalog-size').forEach((btn) => {
    btn.addEventListener('click', () => {
      catalogBuySizes.querySelectorAll('.catalog-size').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      buyProductKey = btn.dataset.product;
      updateBuyAddState();
    });
  });
}

// Añadir al carrito el aceite (aroma + tamaño) y cerrar el modal.
if (catalogBuyAdd) {
  catalogBuyAdd.addEventListener('click', () => {
    if (!buyAroma || !buyProductKey) return;
    if (typeof window.addOilToCart === 'function') {
      window.addOilToCart({ productKey: buyProductKey, aroma: buyAroma });
    }
    closeCatalog();
  });
}

function filterCatalog(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    renderCatalogRows(currentCatalogData);
    return;
  }
  const filtered = currentCatalogData.filter((item) => {
    if (currentCatalogType === 'perfumes') {
      return item.name.toLowerCase().includes(q) || item.brand.toLowerCase().includes(q);
    }
    return item.name.toLowerCase().includes(q) || (item.accords && item.accords.toLowerCase().includes(q));
  });
  renderCatalogRows(filtered);
}

function openCatalog(type, onSelect, options) {
  const opts = options || {};
  catalogOnSelect = typeof onSelect === 'function' ? onSelect : null;
  // El modo compra solo aplica al catálogo de aromas ambientales.
  catalogBuyMode = opts.buy === true && type === 'ambientales';
  currentCatalogType = type;
  currentCatalogData = type === 'perfumes' ? (window.PERFUMES_DATA || []) : (window.AMBIENTALES_DATA || []);

  // Reset del estado de compra.
  buyAroma = '';
  buyProductKey = '';

  if (catalogBuyMode) {
    catalogTitle.textContent = 'Elige tu aceite ambiental';
    catalogSub.textContent = 'Escoge un aroma (o búscalo), elige la presentación y añádelo al carrito.';
    renderFeaturedChips();
    catalogFeatured.style.display = 'block';
    catalogBuy.style.display = 'none';
    catalogBuyAroma.textContent = '—';
    catalogBuySizes.querySelectorAll('.catalog-size').forEach((b) => b.classList.remove('selected'));
    updateBuyAddState();
  } else {
    catalogTitle.textContent = type === 'perfumes' ? 'Catálogo de perfumes' : 'Catálogo de aromas ambientales';
    catalogSub.textContent = type === 'perfumes'
      ? 'Busca por nombre o marca y toca el que quieras — se elegirá automáticamente.'
      : 'Busca tu aroma favorito y toca el que quieras — se elegirá automáticamente.';
    catalogFeatured.style.display = 'none';
    catalogBuy.style.display = 'none';
  }

  catalogInput.value = '';
  renderCatalogRows(currentCatalogData);
  catalogModal.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => catalogInput.focus(), 50);
}

function closeCatalog() {
  catalogModal.classList.remove('open');
  document.body.style.overflow = '';
  catalogOnSelect = null;
  catalogBuyMode = false;
  buyAroma = '';
  buyProductKey = '';
}

document.querySelectorAll('[data-catalog]').forEach((btn) => {
  btn.addEventListener('click', () =>
    openCatalog(btn.dataset.catalog, null, { buy: btn.dataset.catalogMode === 'buy' })
  );
});
catalogClose.addEventListener('click', closeCatalog);
catalogModal.addEventListener('click', (e) => {
  if (e.target === catalogModal) closeCatalog();
});
catalogInput.addEventListener('input', () => filterCatalog(catalogInput.value));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && catalogModal.classList.contains('open')) closeCatalog();
});


/* ============ GESTIONAR SUSCRIPCIÓN (lista + cambio de aroma) ============ */
(function () {
  const openBtn = document.getElementById('manageSubFloat');
  const modal = document.getElementById('subModal');
  const closeBtn = document.getElementById('subModalClose');
  const cancelBtn = document.getElementById('subCancelBtn');
  const continueBtn = document.getElementById('subContinueBtn');
  const input = document.getElementById('subEmailInput');
  const errorMsg = document.getElementById('subError');
  const stepEmail = document.getElementById('subStepEmail');
  const stepList = document.getElementById('subStepList');
  const listEmail = document.getElementById('subListEmail');
  const listEl = document.getElementById('subList');
  const portalLink = document.getElementById('subPortalLink');
  const backBtn = document.getElementById('subBackBtn');
  if (!openBtn || !modal) return;

  let currentEmail = '';

  function showStep(which) {
    stepEmail.style.display = which === 'email' ? 'block' : 'none';
    stepList.style.display = which === 'list' ? 'block' : 'none';
  }

  function openModal() {
    errorMsg.textContent = '';
    input.value = '';
    currentEmail = '';
    showStep('email');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => input.focus(), 50);
  }
  function closeModal() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  backBtn.addEventListener('click', () => { showStep('email'); setTimeout(() => input.focus(), 50); });
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---- Paso 1: buscar suscripciones por correo ----
  async function submitEmail() {
    const email = input.value.trim();
    errorMsg.textContent = '';
    if (!email || !email.includes('@')) {
      errorMsg.textContent = 'Ingresa un correo válido.';
      return;
    }

    continueBtn.disabled = true;
    continueBtn.textContent = 'Buscando...';
    try {
      const resp = await fetch('/api/list-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await resp.json();
      if (resp.ok && Array.isArray(data.subscriptions)) {
        currentEmail = data.email || email;
        renderList(data.subscriptions);
        showStep('list');
      } else {
        errorMsg.textContent = data.error || 'No encontramos esa suscripción.';
      }
    } catch (err) {
      errorMsg.textContent = 'Error de conexión. Intenta de nuevo.';
    } finally {
      continueBtn.disabled = false;
      continueBtn.textContent = 'Ver mis suscripciones';
    }
  }

  // ---- Paso 2: pintar la lista de suscripciones ----
  function renderList(subs) {
    listEmail.textContent = currentEmail;
    if (!subs.length) {
      listEl.innerHTML = '<div class="sub-list-empty">No encontramos suscripciones activas con este correo.</div>';
      return;
    }
    listEl.innerHTML = subs.map((s, i) => {
      const tamano = s.tamano ? ' · ' + esc(s.tamano) : '';
      const aromaActual = s.aroma ? esc(s.aroma) : 'Sin aroma definido';

      // Zona de cambio de aroma (solo aplica a suscripciones con aroma).
      let aromaBloque = '';
      if (s.puedeCambiar) {
        aromaBloque =
          '<div class="sub-card-aroma">' +
            '<button type="button" class="sub-choose-aroma" data-choose="' + i + '">Cambiar aroma (elegir del catálogo)</button>' +
            '<button type="button" class="sub-save-aroma" data-save="' + i + '" disabled>Guardar</button>' +
          '</div>' +
          '<p class="sub-card-msg" data-msg="' + i + '"></p>';
      } else {
        aromaBloque =
          '<div class="sub-card-locked">Ya no es posible cambiar el aroma para tu próxima entrega ' +
          '(se requiere al menos 5 días de anticipación). Podrás cambiarlo de nuevo a partir del ' +
          esc(s.cambiarDesdeLabel || s.proximaFechaLabel) + '.</div>';
      }

      return (
        '<div class="sub-card" data-card="' + i + '" data-sub-id="' + esc(s.id) + '">' +
          '<div class="sub-card-head">' +
            '<span class="sub-card-title">' + esc(s.etiqueta) + tamano + '</span>' +
            '<span class="sub-card-badge">' + esc(s.estado === 'active' ? 'Activa' : s.estado) + '</span>' +
          '</div>' +
          '<div class="sub-card-row">Aroma actual: <strong data-aroma-actual="' + i + '">' + aromaActual + '</strong></div>' +
          '<div class="sub-card-row">Próxima entrega: <strong>' + esc(s.proximaFechaLabel) + '</strong></div>' +
          aromaBloque +
        '</div>'
      );
    }).join('');

    // Estado local del aroma pendiente por tarjeta.
    const pendiente = {};

    listEl.querySelectorAll('[data-choose]').forEach((btn) => {
      const i = btn.dataset.choose;
      const card = listEl.querySelector('[data-card="' + i + '"]');
      const saveBtn = listEl.querySelector('[data-save="' + i + '"]');
      const msg = listEl.querySelector('[data-msg="' + i + '"]');
      btn.addEventListener('click', () => {
        // Reutilizamos el catálogo de aromas ambientales con callback.
        openCatalog('ambientales', (name) => {
          pendiente[i] = name;
          btn.textContent = 'Nuevo aroma: ' + name + ' (cambiar)';
          saveBtn.disabled = false;
          if (msg) { msg.textContent = ''; msg.className = 'sub-card-msg'; }
        });
      });

      saveBtn.addEventListener('click', async () => {
        const nuevo = pendiente[i];
        if (!nuevo) return;
        const subId = card.dataset.subId;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Guardando...';
        if (msg) { msg.textContent = ''; msg.className = 'sub-card-msg'; }
        try {
          const resp = await fetch('/api/update-aroma', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentEmail, subscriptionId: subId, aroma: nuevo }),
          });
          const data = await resp.json();
          if (resp.ok && data.ok) {
            const actualEl = listEl.querySelector('[data-aroma-actual="' + i + '"]');
            if (actualEl) actualEl.textContent = data.aromaNuevo;
            if (msg) { msg.textContent = '¡Listo! Tu próxima entrega llegará con ' + data.aromaNuevo + '. Te enviamos un correo de confirmación.'; msg.className = 'sub-card-msg ok'; }
            btn.textContent = 'Cambiar aroma (elegir del catálogo)';
            delete pendiente[i];
          } else {
            if (msg) { msg.textContent = data.error || 'No se pudo cambiar el aroma.'; msg.className = 'sub-card-msg err'; }
            saveBtn.disabled = false;
          }
        } catch (err) {
          if (msg) { msg.textContent = 'Error de conexión. Intenta de nuevo.'; msg.className = 'sub-card-msg err'; }
          saveBtn.disabled = false;
        } finally {
          saveBtn.textContent = 'Guardar';
        }
      });
    });
  }

  // ---- Portal de Stripe para pago / cancelación ----
  portalLink.addEventListener('click', async () => {
    if (!currentEmail) return;
    const original = portalLink.textContent;
    portalLink.textContent = 'Abriendo portal...';
    portalLink.disabled = true;
    try {
      const resp = await fetch('/api/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentEmail }),
      });
      const data = await resp.json();
      if (resp.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      portalLink.textContent = data.error || 'No se pudo abrir el portal.';
    } catch (err) {
      portalLink.textContent = 'Error de conexión. Intenta de nuevo.';
    } finally {
      setTimeout(() => { portalLink.textContent = original; portalLink.disabled = false; }, 2500);
    }
  });

  continueBtn.addEventListener('click', submitEmail);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.nativeEvent?.isComposing) submitEmail();
  });
})();


/* ============================================================
   CARRITO DE COMPRA (varios productos en un solo pago Stripe)
   ============================================================ */
(function initCart() {
  // Nombre y precio (MXN) de cada producto que se puede agregar al carrito.
  // Los planes de suscripción NO se incluyen: van por su propio flujo.
  const PRODUCT_INFO = {
    a60:        { name: 'Difusor A60',      price: 1199 },
    a300:       { name: 'Difusor A300',     price: 3999 },
    a1000:      { name: 'Difusor A1000',    price: 8999 },
    a3000:      { name: 'Difusor A3000',    price: 11999 },
    a5000:      { name: 'Difusor A5000',    price: 16999 },
    carpro:     { name: 'CAR PRO',          price: 1399 },
    aerosol250: { name: 'Home Spray 250 ml', price: 600 },
    perfume30:  { name: 'Perfume 30 ml',    price: 280 },
    perfume60:  { name: 'Perfume 60 ml',    price: 390 },
    perfume100: { name: 'Perfume 100 ml',   price: 600 },
    aceite250:  { name: 'Aceite 250 ml',    price: 900 },
    aceite500:  { name: 'Aceite 500 ml',    price: 1300 },
    aceite1l:   { name: 'Aceite 1 litro',   price: 2000 },
  };

  // Colores elegidos por producto (ej. Difusor A60: Blanco / Negro).
  const selectedColors = {};

  // Estado del carrito: cada línea = { productKey, name, price, quantity, color, aroma }
  let cart = [];

  const money = (n) => '$' + n.toLocaleString('es-MX') + ' MXN';

  // ---------- Elementos del DOM ----------
  const fab = document.getElementById('cartFab');
  const countEl = document.getElementById('cartCount');
  const drawer = document.getElementById('cartDrawer');
  const drawerClose = document.getElementById('cartDrawerClose');
  const itemsEl = document.getElementById('cartItems');
  const emptyEl = document.getElementById('cartEmpty');
  const footEl = document.getElementById('cartFoot');
  const totalEl = document.getElementById('cartTotal');
  const payBtn = document.getElementById('cartPayBtn');
  const toastEl = document.getElementById('toast');

  if (!fab || !drawer) return;

  // ---------- Toast de confirmación ----------
  let toastTimer;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  // ---------- Selectores de color (Difusor A60) ----------
  document.querySelectorAll('[data-color-picker]').forEach((picker) => {
    const key = picker.dataset.colorPicker;
    picker.querySelectorAll('.color-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        picker.querySelectorAll('.color-chip').forEach((c) => {
          c.classList.remove('selected');
          c.setAttribute('aria-pressed', 'false');
        });
        chip.classList.add('selected');
        chip.setAttribute('aria-pressed', 'true');
        selectedColors[key] = chip.dataset.color;
      });
    });
  });

  // ---------- Selectores de cantidad ----------
  document.querySelectorAll('[data-qty]').forEach((group) => {
    const input = group.querySelector('.qty-input');
    const dec = group.querySelector('[data-qty-dec]');
    const inc = group.querySelector('[data-qty-inc]');
    const clamp = () => {
      let v = parseInt(input.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      input.value = v;
    };
    dec.addEventListener('click', () => { input.value = Math.max(1, (parseInt(input.value, 10) || 1) - 1); });
    inc.addEventListener('click', () => { input.value = (parseInt(input.value, 10) || 1) + 1; });
    input.addEventListener('change', clamp);
    input.addEventListener('blur', clamp);
  });

  // ---------- Añadir al carrito ----------
  function addToCart(btn) {
    const key = btn.dataset.product;
    const info = PRODUCT_INFO[key];
    if (!info) return;

    // Color obligatorio si el producto tiene selector de color (A60).
    const colorFrom = btn.dataset.colorFrom;
    let color = '';
    if (colorFrom) {
      color = selectedColors[colorFrom] || '';
      if (!color) {
        showToast('Elige un color (Blanco o Negro) antes de agregar.');
        return;
      }
    }

    // Aroma de regalo obligatorio si el producto lo incluye.
    const aromaFrom = btn.dataset.aromaFrom;
    let aroma = '';
    if (aromaFrom) {
      aroma = (selectedAromas[aromaFrom] || '').trim();
      if (!aroma) {
        showToast('Elige primero el aroma del catálogo para este producto.');
        return;
      }
    }

    // Cantidad desde el control de la tarjeta (si existe).
    const group = btn.closest('.feature-copy, .card, .feature, .size-price-row') || document;
    const qtyInput = btn.parentElement.querySelector('.qty-input')
      || (btn.closest('[data-qty]') ? btn.closest('[data-qty]').querySelector('.qty-input') : null)
      || group.querySelector('.qty-input');
    const qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;

    // Si ya existe una línea idéntica (mismo producto, color y aroma) se suma.
    const existing = cart.find((it) => it.productKey === key && it.color === color && it.aroma === aroma);
    if (existing) {
      existing.quantity += qty;
    } else {
      cart.push({ productKey: key, name: info.name, price: info.price, quantity: qty, color, aroma });
    }

    if (qtyInput) qtyInput.value = 1;
    renderCart();
    showToast(info.name + ' agregado al carrito');
    fab.classList.add('bump');
    setTimeout(() => fab.classList.remove('bump'), 400);
  }

  document.querySelectorAll('[data-add-to-cart]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      addToCart(btn);
    });
  });

  // ---------- Cambios de cantidad / eliminar dentro del carrito ----------
  function changeQty(index, delta) {
    const item = cart[index];
    if (!item) return;
    item.quantity += delta;
    if (item.quantity < 1) cart.splice(index, 1);
    renderCart();
  }
  function removeItem(index) {
    cart.splice(index, 1);
    renderCart();
  }

  // ---------- Render ----------
  function renderCart() {
    const totalUnits = cart.reduce((s, it) => s + it.quantity, 0);
    countEl.textContent = totalUnits;
    countEl.style.display = totalUnits > 0 ? 'grid' : 'none';

    if (!cart.length) {
      itemsEl.innerHTML = '';
      emptyEl.style.display = 'block';
      footEl.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';
    footEl.style.display = 'block';

    itemsEl.innerHTML = cart.map((it, i) => {
      const variantes = [];
      if (it.color) variantes.push('Color: ' + it.color);
      if (it.aroma) variantes.push('Aroma: ' + it.aroma);
      const meta = variantes.length ? '<div class="ci-meta">' + variantes.join(' · ') + '</div>' : '';
      return (
        '<div class="cart-item" data-index="' + i + '">' +
          '<div class="ci-info">' +
            '<div class="ci-name serif">' + it.name + '</div>' +
            meta +
            '<div class="ci-price">' + money(it.price) + ' c/u</div>' +
          '</div>' +
          '<div class="ci-controls">' +
            '<div class="ci-qty">' +
              '<button type="button" class="qty-btn" data-ci-dec aria-label="Quitar uno">−</button>' +
              '<span class="ci-qty-val">' + it.quantity + '</span>' +
              '<button type="button" class="qty-btn" data-ci-inc aria-label="Agregar uno">+</button>' +
            '</div>' +
            '<button type="button" class="ci-remove" data-ci-remove aria-label="Eliminar del carrito">Eliminar</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    const total = cart.reduce((s, it) => s + it.price * it.quantity, 0);
    totalEl.textContent = money(total);

    itemsEl.querySelectorAll('.cart-item').forEach((row) => {
      const i = parseInt(row.dataset.index, 10);
      row.querySelector('[data-ci-dec]').addEventListener('click', () => changeQty(i, -1));
      row.querySelector('[data-ci-inc]').addEventListener('click', () => changeQty(i, 1));
      row.querySelector('[data-ci-remove]').addEventListener('click', () => removeItem(i));
    });
  }

  // ---------- Abrir / cerrar drawer ----------
  function openDrawer() {
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    document.body.style.overflow = '';
  }
  fab.addEventListener('click', openDrawer);
  drawerClose.addEventListener('click', closeDrawer);
  drawer.addEventListener('click', (e) => { if (e.target === drawer) closeDrawer(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
  });

  // ---------- Pagar (crea la sesión de Stripe con todo el carrito) ----------
  payBtn.addEventListener('click', async () => {
    if (!cart.length) return;
    const original = payBtn.textContent;
    payBtn.textContent = 'Abriendo pago…';
    payBtn.disabled = true;
    try {
      const resp = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((it) => ({
            productKey: it.productKey,
            quantity: it.quantity,
            color: it.color,
            aroma: it.aroma,
            name: it.name,
          })),
        }),
      });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error(data.error || 'Sin URL de pago');
    } catch (err) {
      console.error('No se pudo abrir el checkout del carrito:', err);
      alert(
        'No pudimos abrir el pago en este momento.\n\n' +
        'Detalle: ' + (err && err.message ? err.message : 'error desconocido') +
        '\n\nPor favor inténtalo de nuevo en unos segundos.'
      );
    } finally {
      payBtn.textContent = original;
      payBtn.disabled = false;
    }
  });

  // Puente para añadir un aceite ambiental al carrito desde fuera del IIFE
  // (usado por el modal de catálogo en modo "comprar aceite"). Reutiliza el
  // mismo estado, render y toast que el resto del carrito.
  window.addOilToCart = function ({ productKey, aroma }) {
    const info = PRODUCT_INFO[productKey];
    if (!info) return;
    const aromaVal = (aroma || '').trim();
    const existing = cart.find(
      (it) => it.productKey === productKey && it.color === '' && it.aroma === aromaVal
    );
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({ productKey, name: info.name, price: info.price, quantity: 1, color: '', aroma: aromaVal });
    }
    renderCart();
    showToast(info.name + (aromaVal ? ' · ' + aromaVal : '') + ' agregado al carrito');
    fab.classList.add('bump');
    setTimeout(() => fab.classList.remove('bump'), 400);
  };

  // Estado inicial.
  renderCart();
})();
