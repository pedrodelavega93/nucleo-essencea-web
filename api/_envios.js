// ============================================================
// NÚCLEO essences — CÓDIGOS DE ENVÍO NACIONAL (cotizaciones)
//
// Flujo:
//   1) El cliente de fuera de Monterrey cotiza por WhatsApp.
//   2) Tú generas un código en /cotizaciones con el monto cotizado
//      (por ejemplo ENV-7K3P9 = $480).
//   3) El cliente escribe el código en el carrito y en el pago de Stripe
//      le aparece "Envío nacional" con ese monto: paga todo junto.
//
// El nombre empieza con "_" para que Vercel no lo cuente como función.
// Se usa desde /api/create-checkout (validar y cobrar) y /api/admin
// (crear, listar y borrar). Se guarda en la misma base KV (Upstash).
// ============================================================

const crypto = require('crypto');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const PREFIJO = 'nucleo-envio:';
const LISTA = 'nucleo-envios';
const VIGENCIA_DIAS = 15;

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
  if (!resp.ok || data.error) throw new Error('KV: ' + (data.error || resp.status));
  return data.result;
}

// Sin letras que se confunden (0/O, 1/I/L).
function nuevoCodigo() {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(5);
  let c = '';
  for (let i = 0; i < 5; i++) c += letras[bytes[i] % letras.length];
  return 'ENV-' + c;
}

function normalizar(code) {
  let c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.startsWith('ENV')) c = c.slice(3);
  return c ? 'ENV-' + c : '';
}

// Devuelve la cotización vigente o lanza un error legible.
async function buscar(code) {
  const c = normalizar(code);
  if (!/^ENV-[A-Z0-9]{5}$/.test(c)) throw { status: 400, error: 'El código de envío no es válido. Revisa que esté bien escrito (ej. ENV-7K3P9).' };
  const v = await kv(['GET', PREFIJO + c]);
  if (!v) throw { status: 404, error: 'Ese código de envío no existe o ya venció. Pídenos uno nuevo por WhatsApp.' };
  const envio = JSON.parse(v);
  if (envio.pagado) throw { status: 400, error: 'Ese código de envío ya se usó en un pedido pagado. Pídenos uno nuevo por WhatsApp.' };
  return envio;
}

// La llama el webhook de Stripe cuando el pedido ya se pagó: el código
// queda marcado como usado para que no se vuelva a aplicar.
async function marcarPagado(code) {
  const c = normalizar(code);
  const v = await kv(['GET', PREFIJO + c]);
  if (!v) return;
  const envio = JSON.parse(v);
  envio.pagado = new Date().toISOString();
  await kv(['SET', PREFIJO + c, JSON.stringify(envio), 'KEEPTTL']);
}

// ---------- público ----------
async function validar(body) {
  const e = await buscar(body.code);
  return { code: e.code, monto: e.monto };
}

// Tarifa de envío para Stripe: reemplaza a las opciones normales.
function opcionStripe(envio) {
  return [{
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: Math.round(envio.monto * 100), currency: 'mxn' },
      display_name: `Envío nacional (cotización ${envio.code})`,
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 3 },
        maximum: { unit: 'business_day', value: 7 },
      },
    },
  }];
}

// ---------- panel ----------
async function crear(body) {
  const monto = Math.round(Number(String(body.monto || '').replace(/[$,\s]/g, '')));
  if (!(monto >= 1 && monto <= 20000)) throw { status: 400, error: 'Escribe el monto del envío en pesos (ej. 480).' };
  const nota = String(body.nota || '').replace(/\s+/g, ' ').trim().slice(0, 80);

  let code;
  for (let i = 0; i < 5; i++) {
    code = nuevoCodigo();
    if (!(await kv(['GET', PREFIJO + code]))) break;
  }
  const ahora = new Date();
  const envio = {
    code,
    monto,
    nota,
    creado: ahora.toISOString(),
    vence: new Date(ahora.getTime() + VIGENCIA_DIAS * 86400000).toISOString(),
  };
  await kv(['SET', PREFIJO + code, JSON.stringify(envio), 'EX', String(VIGENCIA_DIAS * 86400)]);
  await kv(['LPUSH', LISTA, code]);
  await kv(['LTRIM', LISTA, '0', '99']);
  return { envio };
}

async function listar() {
  const codes = (await kv(['LRANGE', LISTA, '0', '99'])) || [];
  if (!codes.length) return { envios: [] };
  const vals = (await kv(['MGET'].concat(codes.map((c) => PREFIJO + c)))) || [];
  const envios = [];
  vals.forEach((v) => { if (v) { try { envios.push(JSON.parse(v)); } catch (e) {} } });
  return { envios };
}

async function borrar(body) {
  const c = normalizar(body.code);
  await kv(['DEL', PREFIJO + c]);
  await kv(['LREM', LISTA, '0', c]);
  return { deleted: c };
}

module.exports = { validar, buscar, opcionStripe, crear, listar, borrar, marcarPagado };
