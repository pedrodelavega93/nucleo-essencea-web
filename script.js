// ============================================================
// NÚCLEO essences — comportamiento del sitio
// ============================================================

// URL del webhook de Zapier para el correo de recuperación de carrito
// abandonado. REEMPLAZAR con la URL real de tu "Catch Hook" en Zapier.
const ABANDONED_CART_WEBHOOK = 'https://hook.us2.make.com/95k56of8z8yv179ea7dtp54pnc0h3s9y';

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

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    const abierto = dd.classList.toggle('open');
    toggle.setAttribute('aria-expanded', abierto ? 'true' : 'false');
  });

  dd.querySelectorAll('.nav-dropdown-menu a').forEach((link) => {
    link.addEventListener('click', () => {
      dd.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });

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

  // Compra completada: limpiamos el carrito guardado y avisamos al webhook
  // que la compra sí se completó (evita el correo de recordatorio).
  if (typeof window.clearNucleoCart === 'function') window.clearNucleoCart();
  try {
    const savedEmail = localStorage.getItem('nucleo_cart_email');
    if (savedEmail) {
      fetch(ABANDONED_CART_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'cart_completed', email: savedEmail, timestamp: new Date().toISOString() }),
      }).catch(() => {});
    }
    localStorage.removeItem('nucleo_cart_email');
  } catch (e) {}

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

// --- Botón flotante "bajar al final" ---
const scrollBottomBtn = document.getElementById('scrollBottomBtn');
if (scrollBottomBtn) {
  scrollBottomBtn.addEventListener('click', () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });
}

// --- Checkout dinámico con aroma prellenado ---
async function goToCheckout(btn) {
  const productKey = btn.dataset.product;
  const catalogSource = btn.dataset.aromaFrom;
  const aroma = catalogSource ? selectedAromas[catalogSource] : '';

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
      window.location.href = data.url;
      return;
    }
    throw new Error(data.error || 'Sin URL de pago');
  } catch (err) {
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
const catalogGenderFilter = document.getElementById('catalogGenderFilter');
let currentGenderFilter = 'todos';

const catalogFeatured = document.getElementById('catalogFeatured');
const catalogFeaturedChips = document.getElementById('catalogFeaturedChips');
const catalogBuy = document.getElementById('catalogBuy');
const catalogBuyAroma = document.getElementById('catalogBuyAroma');
const catalogBuySizes = document.getElementById('catalogBuySizes');
const catalogBuyAdd = document.getElementById('catalogBuyAdd');

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
let catalogOnSelect = null;
let catalogBuyMode = false;
let buyAroma = '';
let buyProductKey = '';

function selectAromaFromCatalog(type, name) {
  selectedAromas[type] = name;
  document.querySelectorAll('[data-catalog="' + type + '"]').forEach((btn) => {
    btn.textContent = 'Aroma elegido: ' + name + ' (cambiar) →';
  });
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

function setBuyAroma(name) {
  buyAroma = name;
  catalogBuyAroma.textContent = name;
  catalogBuy.style.display = 'block';
  catalogFeaturedChips.querySelectorAll('.catalog-featured-chip').forEach((c) => {
    c.classList.toggle('selected', c.dataset.aroma === name);
  });
  updateBuyAddState();
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
  let data = currentCatalogData;

  if (currentCatalogType === 'perfumes' && currentGenderFilter !== 'todos') {
    data = data.filter((item) => item.gender === currentGenderFilter);
  }

  if (q) {
    data = data.filter((item) => {
      if (currentCatalogType === 'perfumes') {
        return item.name.toLowerCase().includes(q) || item.brand.toLowerCase().includes(q);
      }
      return item.name.toLowerCase().includes(q) || (item.accords && item.accords.toLowerCase().includes(q));
    });
  }

  renderCatalogRows(data);
}

function openCatalog(type, onSelect, options) {
  const opts = options || {};
  catalogOnSelect = typeof onSelect === 'function' ? onSelect : null;
  catalogBuyMode = opts.buy === true && type === 'ambientales';
  currentCatalogType = type;
  currentCatalogData = type === 'perfumes' ? (window.PERFUMES_DATA || []) : (window.AMBIENTALES_DATA || []);

  currentGenderFilter = 'todos';
  if (catalogGenderFilter) {
    catalogGenderFilter.style.display = type === 'perfumes' ? 'flex' : 'none';
    catalogGenderFilter.querySelectorAll('.catalog-gender-chip').forEach((chip) => {
      chip.classList.toggle('selected', chip.dataset.gender === 'todos');
    });
  }

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
if (catalogGenderFilter) {
  catalogGenderFilter.querySelectorAll('.catalog-gender-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      currentGenderFilter = chip.dataset.gender;
      catalogGenderFilter.querySelectorAll('.catalog-gender-chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      filterCatalog(catalogInput.value);
    });
  });
}
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
  const stepOtp = document.getElementById('subStepOtp');
  const stepList = document.getElementById('subStepList');
  const listEmail = document.getElementById('subListEmail');
  const listEl = document.getElementById('subList');
  const portalLink = document.getElementById('subPortalLink');
  const backBtn = document.getElementById('subBackBtn');
  const idTabs = document.getElementById('subIdentifierTabs');
  const otpInput = document.getElementById('subOtpInput');
  const otpError = document.getElementById('subOtpError');
  const otpHint = document.getElementById('subOtpHint');
  const otpContinueBtn = document.getElementById('subOtpContinueBtn');
  const otpResendBtn = document.getElementById('subOtpResendBtn');
  const otpBackBtn = document.getElementById('subOtpBackBtn');
  if (!openBtn || !modal) return;

  // Modo de búsqueda actual: 'email' o 'phone'.
  let identifierMode = 'email';
  let identifierValue = ''; // el correo o teléfono que escribió, para reenviar el código
  // customerId de Stripe obtenido tras verificar el código — se usa
  // para las acciones posteriores (cambiar aroma, abrir portal).
  let currentCustomerId = '';
  let currentLabel = ''; // correo o teléfono, solo para mostrarlo en pantalla

  if (idTabs) {
    idTabs.querySelectorAll('.sub-id-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        identifierMode = tab.dataset.mode;
        idTabs.querySelectorAll('.sub-id-tab').forEach((t) => t.classList.remove('selected'));
        tab.classList.add('selected');
        errorMsg.textContent = '';
        input.value = '';
        if (identifierMode === 'phone') {
          input.type = 'tel';
          input.placeholder = '81 1234 5678';
          input.setAttribute('inputmode', 'tel');
          input.setAttribute('autocomplete', 'tel');
        } else {
          input.type = 'email';
          input.placeholder = 'tu@correo.com';
          input.setAttribute('inputmode', 'email');
          input.setAttribute('autocomplete', 'email');
        }
        setTimeout(() => input.focus(), 30);
      });
    });
  }

  function showStep(which) {
    stepEmail.style.display = which === 'email' ? 'block' : 'none';
    stepOtp.style.display = which === 'otp' ? 'block' : 'none';
    stepList.style.display = which === 'list' ? 'block' : 'none';
  }

  function openModal() {
    errorMsg.textContent = '';
    input.value = '';
    currentCustomerId = '';
    currentLabel = '';
    identifierValue = '';
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

  function identifierBody() {
    return identifierMode === 'email' ? { email: identifierValue } : { phone: identifierValue };
  }

  // ---- Paso 1: pedir el código ----
  async function submitIdentifier() {
    const valor = input.value.trim();
    errorMsg.textContent = '';

    if (identifierMode === 'email') {
      if (!valor || !valor.includes('@')) {
        errorMsg.textContent = 'Ingresa un correo válido.';
        return;
      }
    } else {
      const digitos = valor.replace(/[^\d]/g, '');
      if (digitos.length < 10) {
        errorMsg.textContent = 'Ingresa un número de WhatsApp válido (10 dígitos).';
        return;
      }
    }

    identifierValue = valor;
    continueBtn.disabled = true;
    continueBtn.textContent = 'Enviando...';
    try {
      const resp = await fetch('/api/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identifierBody()),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        otpHint.textContent = 'Te enviamos un código de 6 dígitos a ' + (data.emailMasked || 'tu correo') + '.';
        otpError.textContent = '';
        otpInput.value = '';
        showStep('otp');
        setTimeout(() => otpInput.focus(), 50);
      } else {
        errorMsg.textContent = data.error || 'No se pudo enviar el código.';
      }
    } catch (err) {
      errorMsg.textContent = 'Error de conexión. Intenta de nuevo.';
    } finally {
      continueBtn.disabled = false;
      continueBtn.textContent = 'Enviar código';
    }
  }

  // ---- Paso 2: verificar el código ----
  async function submitOtp() {
    const codigo = otpInput.value.trim();
    otpError.textContent = '';
    if (!codigo || codigo.length !== 6) {
      otpError.textContent = 'Ingresa el código de 6 dígitos completo.';
      return;
    }

    otpContinueBtn.disabled = true;
    otpContinueBtn.textContent = 'Verificando...';
    try {
      const body = Object.assign({ code: codigo }, identifierBody());
      const resp = await fetch('/api/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (resp.ok && Array.isArray(data.subscriptions) && data.subscriptions.length) {
        currentLabel = identifierMode === 'email' ? (data.email || identifierValue) : identifierValue;
        renderList(data.subscriptions);
        showStep('list');
      } else {
        otpError.textContent = data.error || 'Código incorrecto.';
      }
    } catch (err) {
      otpError.textContent = 'Error de conexión. Intenta de nuevo.';
    } finally {
      otpContinueBtn.disabled = false;
      otpContinueBtn.textContent = 'Entrar';
    }
  }

  otpResendBtn.addEventListener('click', async () => {
    otpError.textContent = '';
    otpResendBtn.disabled = true;
    const original = otpResendBtn.textContent;
    otpResendBtn.textContent = 'Reenviando...';
    try {
      const resp = await fetch('/api/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identifierBody()),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        otpHint.textContent = 'Te reenviamos el código a ' + (data.emailMasked || 'tu correo') + '.';
      } else {
        otpError.textContent = data.error || 'No se pudo reenviar el código.';
      }
    } catch (err) {
      otpError.textContent = 'Error de conexión. Intenta de nuevo.';
    } finally {
      otpResendBtn.disabled = false;
      otpResendBtn.textContent = original;
    }
  });

  otpBackBtn.addEventListener('click', () => {
    showStep('email');
    setTimeout(() => input.focus(), 50);
  });

  function renderList(subs) {
    listEmail.textContent = currentLabel;
    // Usamos el customerId de la primera suscripción como identidad
    // de sesión para el portal y los cambios de aroma.
    currentCustomerId = subs[0] && subs[0].customerId ? subs[0].customerId : '';

    if (!subs.length) {
      listEl.innerHTML = '<div class="sub-list-empty">No encontramos suscripciones activas con este dato.</div>';
      return;
    }
    listEl.innerHTML = subs.map((s, i) => {
      const tamano = s.tamano ? ' · ' + esc(s.tamano) : '';
      const aromaActual = s.aroma ? esc(s.aroma) : 'Sin aroma definido';

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

    const pendiente = {};

    listEl.querySelectorAll('[data-choose]').forEach((btn) => {
      const i = btn.dataset.choose;
      const card = listEl.querySelector('[data-card="' + i + '"]');
      const saveBtn = listEl.querySelector('[data-save="' + i + '"]');
      const msg = listEl.querySelector('[data-msg="' + i + '"]');
      btn.addEventListener('click', () => {
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
            body: JSON.stringify({ customerId: currentCustomerId, subscriptionId: subId, aroma: nuevo }),
          });
          const data = await resp.json();
          if (resp.ok && data.ok) {
            const actualEl = listEl.querySelector('[data-aroma-actual="' + i + '"]');
            if (actualEl) actualEl.textContent = data.aromaNuevo;
            if (msg) { msg.textContent = '¡Listo! Tu próxima entrega llegará con ' + data.aromaNuevo + '. Te enviamos un correo de confirmación si tienes uno registrado.'; msg.className = 'sub-card-msg ok'; }
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

  portalLink.addEventListener('click', async () => {
    if (!currentCustomerId) return;
    const original = portalLink.textContent;
    portalLink.textContent = 'Abriendo portal...';
    portalLink.disabled = true;
    try {
      const resp = await fetch('/api/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: currentCustomerId }),
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

  continueBtn.addEventListener('click', submitIdentifier);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.nativeEvent?.isComposing) submitIdentifier();
  });
  otpContinueBtn.addEventListener('click', submitOtp);
  otpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.nativeEvent?.isComposing) submitOtp();
  });
})();


/* ============================================================
   CARRITO DE COMPRA (varios productos en un solo pago Stripe)
   ============================================================ */
(function initCart() {
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

  const CART_STORAGE_KEY = 'nucleo_cart';
  const CART_EMAIL_KEY = 'nucleo_cart_email';

  const selectedColors = {};

  // Estado del carrito: se recupera de localStorage si existe, así el
  // carrito sobrevive si el cliente cierra el checkout de Stripe y vuelve.
  let cart = [];
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (raw) cart = JSON.parse(raw) || [];
  } catch (e) { cart = []; }

  function persistCart() {
    try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); } catch (e) {}
  }

  const money = (n) => '$' + n.toLocaleString('es-MX') + ' MXN';

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
  const cartEmailInput = document.getElementById('cartEmailInput');

  if (!fab || !drawer) return;

  let toastTimer;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

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

  function addToCart(btn) {
    const key = btn.dataset.product;
    const info = PRODUCT_INFO[key];
    if (!info) return;

    const colorFrom = btn.dataset.colorFrom;
    let color = '';
    if (colorFrom) {
      color = selectedColors[colorFrom] || '';
      if (!color) {
        showToast('Elige un color (Blanco o Negro) antes de agregar.');
        return;
      }
    }

    const aromaFrom = btn.dataset.aromaFrom;
    let aroma = '';
    if (aromaFrom) {
      aroma = (selectedAromas[aromaFrom] || '').trim();
      if (!aroma) {
        showToast('Elige primero el aroma del catálogo para este producto.');
        return;
      }
    }

    const group = btn.closest('.feature-copy, .card, .feature, .size-price-row') || document;
    const qtyInput = btn.parentElement.querySelector('.qty-input')
      || (btn.closest('[data-qty]') ? btn.closest('[data-qty]').querySelector('.qty-input') : null)
      || group.querySelector('.qty-input');
    const qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;

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

  function renderCart() {
    persistCart();

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

  // --- Recuperación de carrito abandonado: captura de correo opcional ---
  if (cartEmailInput) {
    try {
      const savedEmail = localStorage.getItem(CART_EMAIL_KEY);
      if (savedEmail) cartEmailInput.value = savedEmail;
    } catch (e) {}

    let emailTimer;
    cartEmailInput.addEventListener('input', () => {
      clearTimeout(emailTimer);
      emailTimer = setTimeout(() => {
        const email = cartEmailInput.value.trim();
        if (!email || !email.includes('@')) return;
        try { localStorage.setItem(CART_EMAIL_KEY, email); } catch (e) {}
        fetch(ABANDONED_CART_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'cart_started',
            email,
            cart: cart.map((it) => ({ name: it.name, quantity: it.quantity, aroma: it.aroma, color: it.color })),
            total: cart.reduce((s, it) => s + it.price * it.quantity, 0),
            timestamp: new Date().toISOString(),
          }),
        }).catch(() => {});
      }, 800);
    });
  }

  payBtn.addEventListener('click', async () => {
    if (!cart.length) return;
    const original = payBtn.innerHTML;
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
      payBtn.innerHTML = original;
      payBtn.disabled = false;
    }
  });

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

  window.clearNucleoCart = function () {
    cart = [];
    persistCart();
    renderCart();
  };

  renderCart();
})();
