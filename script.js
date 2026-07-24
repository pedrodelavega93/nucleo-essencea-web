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
const selectedAromas = { perfumes: '', ambientales: '', carpro: '' };

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
  const catalogSource = btn.dataset.aromaFrom; // 'perfumes' | 'ambientales' | 'carpro' | undefined
  const aroma = catalogSource ? selectedAromas[catalogSource] : '';

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
document.querySelectorAll('[data-product]:not([data-add-to-cart])').forEach((btn) => {
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

let currentCatalogData = [];
let currentCatalogType = 'perfumes';

function selectAromaFromCatalog(type, name) {
  selectedAromas[type] = name;
  document.querySelectorAll('[data-catalog="' + type + '"]').forEach((btn) => {
    btn.textContent = 'Aroma elegido: ' + name + ' (cambiar) →';
  });
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
      selectAromaFromCatalog(currentCatalogType, row.dataset.name);
      closeCatalog();
    });
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

function openCatalog(type) {
  currentCatalogType = type;
  currentCatalogData = type === 'perfumes' ? (window.PERFUMES_DATA || []) : (window.AMBIENTALES_DATA || []);
  catalogTitle.textContent = type === 'perfumes' ? 'Catálogo de perfumes' : 'Catálogo de aromas ambientales';
  catalogSub.textContent = type === 'perfumes'
    ? 'Busca por nombre o marca y toca el que quieras — se elegirá automáticamente.'
    : 'Busca tu aroma favorito y toca el que quieras — se elegirá automáticamente.';
  catalogInput.value = '';
  renderCatalogRows(currentCatalogData);
  catalogModal.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => catalogInput.focus(), 50);
}

function closeCatalog() {
  catalogModal.classList.remove('open');
  document.body.style.overflow = '';
}

document.querySelectorAll('[data-catalog]').forEach((btn) => {
  btn.addEventListener('click', () => openCatalog(btn.dataset.catalog));
});
catalogClose.addEventListener('click', closeCatalog);
catalogModal.addEventListener('click', (e) => {
  if (e.target === catalogModal) closeCatalog();
});
catalogInput.addEventListener('input', () => filterCatalog(catalogInput.value));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && catalogModal.classList.contains('open')) closeCatalog();
});


/* ============ GESTIONAR SUSCRIPCIÓN (Stripe Customer Portal) ============ */
(function () {
  const openBtn = document.getElementById('manageSubFloat');
  const modal = document.getElementById('subModal');
  const closeBtn = document.getElementById('subModalClose');
  const cancelBtn = document.getElementById('subCancelBtn');
  const continueBtn = document.getElementById('subContinueBtn');
  const input = document.getElementById('subEmailInput');
  const errorMsg = document.getElementById('subError');
  if (!openBtn || !modal) return;

  function openModal() {
    errorMsg.textContent = '';
    input.value = '';
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
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

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
      const resp = await fetch('/api/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await resp.json();

      if (resp.ok && data.url) {
        window.location.href = data.url;
      } else {
        errorMsg.textContent = data.error || 'No encontramos esa suscripción.';
      }
    } catch (err) {
      errorMsg.textContent = 'Error de conexión. Intenta de nuevo.';
    } finally {
      continueBtn.disabled = false;
      continueBtn.textContent = 'Continuar';
    }
  }

  continueBtn.addEventListener('click', submitEmail);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.nativeEvent?.isComposing) submitEmail();
  });
})();
