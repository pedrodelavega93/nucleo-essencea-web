// ============================================================
// NÚCLEO essences — RESEÑAS DE CLIENTES
//
// OJO: el nombre empieza con "_" para que Vercel NO lo cuente como
// función aparte (el plan Hobby permite máximo 12 y ya estamos en 12).
// Se usa desde:
//   · /api/create-checkout  → parte pública (enviar reseña, listar las
//                              publicadas y mostrar las fotos)
//   · /api/admin            → parte privada (aprobar / ocultar / borrar),
//                              protegida con ADMIN_PASSWORD
//
// Todo se guarda en la misma base de datos KV (Upstash) que ya usa
// Control Total. No hace falta configurar nada nuevo en Vercel.
//
//   nucleo-review:<id>        → la reseña (JSON)
//   nucleo-review-photo:<id>  → cada foto (imagen comprimida)
//   nucleo-reviews            → lista con los IDs, la más nueva primero
//
// Estados: 'pendiente' (recién enviada, NO se ve en la página) y
// 'publicada' (aprobada por ti, sí se ve).
// ============================================================

const crypto = require('crypto');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const LISTA = 'nucleo-reviews';
const PREFIJO = 'nucleo-review:';
const PREFIJO_FOTO = 'nucleo-review-photo:';

const MAX_FOTOS = 3;
const MAX_FOTO_CHARS = 700000; // ~500 KB por foto (el navegador ya la comprime)
const MAX_RESENAS_LEIDAS = 300;

const REMITENTE = 'NÚCLEO essences <pedidos@nucleoessences.com>';
const CORREO_INTERNO = 'pedro.delavega93@gmail.com';

// ---------- base de datos ----------
async function kv(comando) {
  if (!KV_URL || !KV_TOKEN) {
    throw { status: 500, error: 'La base de datos no está conectada (faltan KV_REST_API_URL / KV_REST_API_TOKEN).' };
  }
  const resp = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(comando),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) {
    throw new Error('KV: ' + (data.error || resp.status));
  }
  return data.result;
}

function nuevoId() {
  return Date.now().toString(36) + crypto.randomBytes(5).toString('hex');
}

function limpiarTexto(s, max) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

async function leerTodas() {
  const ids = (await kv(['LRANGE', LISTA, '0', String(MAX_RESENAS_LEIDAS - 1)])) || [];
  if (!ids.length) return [];
  const valores = (await kv(['MGET'].concat(ids.map((id) => PREFIJO + id)))) || [];
  const resenas = [];
  valores.forEach((v) => {
    if (!v) return;
    try { resenas.push(JSON.parse(v)); } catch (e) { /* ignorar registros dañados */ }
  });
  return resenas;
}

async function leerUna(id) {
  if (!id || !/^[a-z0-9]{6,40}$/i.test(String(id))) throw { status: 400, error: 'Reseña no válida.' };
  const v = await kv(['GET', PREFIJO + id]);
  if (!v) throw { status: 404, error: 'La reseña ya no existe.' };
  return JSON.parse(v);
}

// Lo que se puede mostrar al público (sin datos internos).
function versionPublica(r) {
  return {
    id: r.id,
    nombre: r.nombre,
    estrellas: r.estrellas,
    producto: r.producto || '',
    comentario: r.comentario,
    fotos: (r.fotos || []).map((pid) => '/api/create-checkout?review_photo=' + pid),
    fecha: r.creado,
  };
}

// ---------- aviso por correo ----------
async function avisarNuevaResena(r) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    await resend.emails.send({
      from: REMITENTE,
      to: CORREO_INTERNO,
      subject: `Nueva reseña por aprobar — ${r.nombre} (${r.estrellas}★)`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#222;max-width:520px;">
          <h2 style="margin:0 0 12px;">Nueva reseña por aprobar</h2>
          <p style="margin:0 0 6px;"><b>${esc(r.nombre)}</b> — ${'★'.repeat(r.estrellas)}${'☆'.repeat(5 - r.estrellas)}</p>
          ${r.producto ? `<p style="margin:0 0 6px;color:#666;">Producto: ${esc(r.producto)}</p>` : ''}
          <p style="margin:12px 0;padding:12px;background:#f5f1ea;border-radius:6px;">${esc(r.comentario)}</p>
          <p style="margin:0 0 16px;color:#666;">Fotos adjuntas: ${(r.fotos || []).length}</p>
          <p>No aparecerá en la página hasta que la apruebes:</p>
          <p><a href="https://nucleoessences.com/resenas-admin" style="display:inline-block;background:#b8905e;color:#111;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;">Revisar reseñas</a></p>
        </div>`,
    });
  } catch (e) {
    console.error('[reviews] No se pudo enviar el aviso por correo:', e);
  }
}

// ============================================================
// PARTE PÚBLICA
// ============================================================

// Enviar una reseña nueva (queda como 'pendiente').
async function enviar(req, body) {
  // Campo trampa: los humanos no lo ven; los bots sí lo llenan.
  if (body.sitio_web) return { ok: true };

  const nombre = limpiarTexto(body.nombre, 60);
  const producto = limpiarTexto(body.producto, 80);
  const comentario = String(body.comentario || '').trim().slice(0, 1000);
  const estrellas = parseInt(body.estrellas, 10);

  if (nombre.length < 2) throw { status: 400, error: 'Escribe tu nombre.' };
  if (!(estrellas >= 1 && estrellas <= 5)) throw { status: 400, error: 'Elige tu calificación de 1 a 5 estrellas.' };
  if (comentario.length < 10) throw { status: 400, error: 'Cuéntanos un poco más en tu comentario (mínimo 10 caracteres).' };

  const fotosEntrada = Array.isArray(body.fotos) ? body.fotos.slice(0, MAX_FOTOS) : [];
  for (const f of fotosEntrada) {
    if (typeof f !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f)) {
      throw { status: 400, error: 'Una de las fotos no es válida. Usa imágenes JPG o PNG.' };
    }
    if (f.length > MAX_FOTO_CHARS) {
      throw { status: 400, error: 'Una de las fotos es demasiado pesada. Intenta con otra.' };
    }
  }

  // Límite: una reseña cada 2 minutos por conexión (evita spam).
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'x').split(',')[0].trim();
  const permitido = await kv(['SET', 'nucleo-review-rl:' + ip, '1', 'NX', 'EX', '120']);
  if (!permitido) {
    throw { status: 429, error: 'Ya recibimos una reseña desde aquí hace un momento. Intenta de nuevo en unos minutos.' };
  }

  const fotos = [];
  for (const f of fotosEntrada) {
    const pid = nuevoId();
    await kv(['SET', PREFIJO_FOTO + pid, f]);
    fotos.push(pid);
  }

  const resena = {
    id: nuevoId(),
    nombre,
    estrellas,
    producto,
    comentario,
    fotos,
    estado: 'pendiente',
    creado: new Date().toISOString(),
  };
  await kv(['SET', PREFIJO + resena.id, JSON.stringify(resena)]);
  await kv(['LPUSH', LISTA, resena.id]);

  await avisarNuevaResena(resena);
  return { ok: true };
}

// Reseñas publicadas + promedio (para la página).
async function listarPublicas() {
  const publicadas = (await leerTodas()).filter((r) => r.estado === 'publicada');
  const total = publicadas.length;
  const promedio = total ? publicadas.reduce((s, r) => s + r.estrellas, 0) / total : 0;
  return {
    total,
    promedio: Math.round(promedio * 10) / 10,
    reviews: publicadas.map(versionPublica),
  };
}

// Responde la foto como imagen (con caché larga: nunca cambia).
async function enviarFoto(res, pid) {
  if (!pid || !/^[a-z0-9]{6,40}$/i.test(String(pid))) {
    res.status(400).end();
    return;
  }
  const dataUrl = await kv(['GET', PREFIJO_FOTO + pid]);
  const m = dataUrl && String(dataUrl).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', m[1]);
  res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
  res.status(200).send(Buffer.from(m[2], 'base64'));
}

// ============================================================
// PARTE PRIVADA (panel)
// ============================================================

async function adminListar() {
  const todas = await leerTodas();
  return {
    reviews: todas.map((r) => Object.assign(versionPublica(r), { estado: r.estado })),
  };
}

async function adminCambiarEstado(body, estado) {
  const r = await leerUna(body.reviewId);
  r.estado = estado;
  await kv(['SET', PREFIJO + r.id, JSON.stringify(r)]);
  return { review: Object.assign(versionPublica(r), { estado: r.estado }) };
}

async function adminBorrar(body) {
  const r = await leerUna(body.reviewId);
  for (const pid of r.fotos || []) {
    await kv(['DEL', PREFIJO_FOTO + pid]);
  }
  await kv(['DEL', PREFIJO + r.id]);
  await kv(['LREM', LISTA, '0', r.id]);
  return { deleted: r.id };
}

module.exports = {
  enviar,
  listarPublicas,
  enviarFoto,
  adminListar,
  adminAprobar: (body) => adminCambiarEstado(body, 'publicada'),
  adminOcultar: (body) => adminCambiarEstado(body, 'pendiente'),
  adminBorrar,
};
