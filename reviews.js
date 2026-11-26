// ============================================================
// NÚCLEO essences — Reseñas de clientes (página principal)
//
// · Carga las reseñas YA APROBADAS y las muestra en tarjetas.
// · Formulario "Deja tu reseña": nombre, estrellas, producto,
//   comentario y hasta 3 fotos (se comprimen en el celular antes de
//   enviarse). Las reseñas nuevas quedan pendientes hasta que se
//   aprueban en /resenas-admin.
// ============================================================
(function () {
  var API = '/api/create-checkout';
  var MAX_FOTOS = 3;

  var track = document.getElementById('reviewsTrack');
  if (!track) return;

  var $ = function (id) { return document.getElementById(id); };

  // ---------- utilidades ----------
  function estrellasTexto(n) {
    var s = '';
    for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '☆';
    return s;
  }
  function estrellasPromedio(prom) {
    var llenas = Math.round(prom);
    return estrellasTexto(llenas);
  }
  function fechaCorta(iso) {
    try {
      return new Date(iso).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    } catch (e) { return ''; }
  }
  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto; // textContent: nunca se interpreta como HTML
    return e;
  }

  // ---------- visor de fotos ----------
  var lightbox = $('reviewLightbox');
  var lightboxImg = $('reviewLightboxImg');
  function abrirFoto(src) {
    lightboxImg.src = src;
    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function cerrarFoto() {
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
    lightboxImg.removeAttribute('src');
    if (!modal.classList.contains('open')) document.body.style.overflow = '';
  }
  $('reviewLightboxClose').addEventListener('click', cerrarFoto);
  lightbox.addEventListener('click', function (e) { if (e.target === lightbox) cerrarFoto(); });

  // ---------- mostrar reseñas publicadas ----------
  function tarjeta(r) {
    var card = el('article', 'review-card');

    card.appendChild(el('div', 'review-stars', estrellasTexto(r.estrellas)));

    var texto = el('p', 'review-text', r.comentario);
    card.appendChild(texto);
    if (r.comentario.length > 220) {
      texto.classList.add('clamped');
      var mas = el('button', 'review-more', 'Ver más');
      mas.type = 'button';
      mas.addEventListener('click', function () {
        var abierto = texto.classList.toggle('clamped');
        mas.textContent = abierto ? 'Ver más' : 'Ver menos';
      });
      card.appendChild(mas);
    }

    if (r.fotos && r.fotos.length) {
      var fotos = el('div', 'review-card-photos');
      r.fotos.forEach(function (src) {
        var b = el('button', 'review-thumb');
        b.type = 'button';
        b.setAttribute('aria-label', 'Ver foto');
        var img = document.createElement('img');
        img.src = src;
        img.loading = 'lazy';
        img.alt = 'Foto de ' + r.nombre;
        b.appendChild(img);
        b.addEventListener('click', function () { abrirFoto(src); });
        fotos.appendChild(b);
      });
      card.appendChild(fotos);
    }

    var pie = el('div', 'review-meta');
    pie.appendChild(el('div', 'review-name', r.nombre));
    var detalle = [r.producto, fechaCorta(r.fecha)].filter(Boolean).join(' · ');
    if (detalle) pie.appendChild(el('div', 'review-product', detalle));
    card.appendChild(pie);

    return card;
  }

  function cargarResenas() {
    fetch(API + '?reviews=1')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) {
        track.innerHTML = '';
        var lista = (data && data.reviews) || [];
        if (!lista.length) {
          $('reviewsEmpty').hidden = false;
          $('reviewsSummary').hidden = true;
          return;
        }
        $('reviewsEmpty').hidden = true;
        lista.forEach(function (r) { track.appendChild(tarjeta(r)); });
        $('reviewsAvg').textContent = Number(data.promedio).toFixed(1);
        $('reviewsAvgStars').textContent = estrellasPromedio(data.promedio);
        $('reviewsCount').textContent = data.total === 1 ? '1 reseña' : data.total + ' reseñas';
        $('reviewsSummary').hidden = false;
      })
      .catch(function () {
        $('reviewsEmpty').hidden = false;
      });
  }

  // ---------- formulario ----------
  var modal = $('reviewModal');
  var form = $('reviewForm');
  var gracias = $('reviewThanks');
  var errorEl = $('reviewError');
  var btnEnviar = $('reviewSubmit');
  var estrellas = 0;
  var fotos = []; // data URLs ya comprimidas

  function abrirModal() {
    form.hidden = false;
    gracias.hidden = true;
    errorEl.textContent = '';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function cerrarModal() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
  function reiniciar() {
    form.reset();
    estrellas = 0;
    pintarEstrellas(0);
    fotos = [];
    pintarFotos();
    $('reviewCommentCount').textContent = '0';
  }

  $('reviewOpenBtn').addEventListener('click', abrirModal);
  $('reviewModalClose').addEventListener('click', cerrarModal);
  $('reviewThanksClose').addEventListener('click', cerrarModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) cerrarModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (lightbox.classList.contains('open')) cerrarFoto();
    else if (modal.classList.contains('open')) cerrarModal();
  });

  // Estrellas
  var botonesEstrella = document.querySelectorAll('#reviewStarPicker button');
  function pintarEstrellas(n) {
    botonesEstrella.forEach(function (b) {
      var v = Number(b.dataset.stars);
      b.classList.toggle('on', v <= n);
      b.setAttribute('aria-checked', v === n ? 'true' : 'false');
    });
  }
  botonesEstrella.forEach(function (b) {
    b.setAttribute('role', 'radio');
    b.addEventListener('click', function () {
      estrellas = Number(b.dataset.stars);
      pintarEstrellas(estrellas);
    });
  });

  // Contador de caracteres
  $('reviewComment').addEventListener('input', function () {
    $('reviewCommentCount').textContent = this.value.length;
  });

  // Fotos: se reducen a máx. 1200 px y se guardan como JPG ligero.
  function comprimir(file) {
    return new Promise(function (resolve, reject) {
      if (!file.type || file.type.indexOf('image/') !== 0) return reject(new Error('tipo'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var max = 1200;
        var escala = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.round(img.naturalWidth * escala);
        var h = Math.round(img.naturalHeight * escala);
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        var calidad = 0.8;
        var data = canvas.toDataURL('image/jpeg', calidad);
        while (data.length > 600000 && calidad > 0.4) {
          calidad -= 0.15;
          data = canvas.toDataURL('image/jpeg', calidad);
        }
        resolve(data);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('lectura')); };
      img.src = url;
    });
  }

  var contFotos = $('reviewPhotos');
  var addFoto = $('reviewPhotoAdd');
  function pintarFotos() {
    contFotos.querySelectorAll('.review-photo-prev').forEach(function (n) { n.remove(); });
    fotos.forEach(function (src, i) {
      var p = el('div', 'review-photo-prev');
      var img = document.createElement('img');
      img.src = src;
      img.alt = 'Foto ' + (i + 1);
      var x = el('button', 'review-photo-remove', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', 'Quitar foto');
      x.addEventListener('click', function () { fotos.splice(i, 1); pintarFotos(); });
      p.appendChild(img);
      p.appendChild(x);
      contFotos.insertBefore(p, addFoto);
    });
    addFoto.style.display = fotos.length >= MAX_FOTOS ? 'none' : '';
  }

  $('reviewPhotoInput').addEventListener('change', function () {
    var archivos = Array.prototype.slice.call(this.files || [], 0, MAX_FOTOS - fotos.length);
    this.value = '';
    if (!archivos.length) return;
    errorEl.textContent = '';
    addFoto.classList.add('loading');
    Promise.all(archivos.map(function (f) { return comprimir(f).catch(function () { return null; }); }))
      .then(function (res) {
        var fallidas = res.filter(function (r) { return !r; }).length;
        res.forEach(function (r) { if (r && fotos.length < MAX_FOTOS) fotos.push(r); });
        if (fallidas) errorEl.textContent = 'No pudimos leer ' + (fallidas === 1 ? 'una foto' : fallidas + ' fotos') + '. Intenta con otra imagen.';
        pintarFotos();
      })
      .finally(function () { addFoto.classList.remove('loading'); });
  });

  // Enviar
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorEl.textContent = '';

    var nombre = $('reviewName').value.trim();
    var comentario = $('reviewComment').value.trim();
    if (nombre.length < 2) { errorEl.textContent = 'Escribe tu nombre.'; return; }
    if (!estrellas) { errorEl.textContent = 'Elige tu calificación con las estrellas.'; return; }
    if (comentario.length < 10) { errorEl.textContent = 'Cuéntanos un poco más en tu comentario (mínimo 10 caracteres).'; return; }

    btnEnviar.disabled = true;
    btnEnviar.textContent = 'Enviando…';

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'review_submit',
        nombre: nombre,
        estrellas: estrellas,
        producto: $('reviewProduct').value,
        comentario: comentario,
        fotos: fotos,
        sitio_web: $('reviewHp').value,
      }),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.error || 'No se pudo enviar tu reseña. Intenta de nuevo.');
          return d;
        });
      })
      .then(function () {
        reiniciar();
        form.hidden = true;
        gracias.hidden = false;
      })
      .catch(function (err) {
        errorEl.textContent = err.message || 'No se pudo enviar tu reseña. Intenta de nuevo.';
      })
      .finally(function () {
        btnEnviar.disabled = false;
        btnEnviar.textContent = 'Enviar reseña';
      });
  });

  cargarResenas();
})();
