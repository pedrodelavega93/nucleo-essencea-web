// ============================================================
// NÚCLEO essences — Precios Buen Fin 2026
//
// Del 13 de noviembre 00:00 al 17 de noviembre 23:59 (hora de
// Monterrey) el checkout cobra estos precios en automático. Fuera de
// esas fechas todo regresa solo a los precios normales de Stripe.
//
// IMPORTANTE: esta misma tabla está copiada en script.js (BUEN_FIN)
// para mostrar los precios en la página. Si cambias algo aquí,
// cámbialo también allá para que el carrito muestre lo mismo que
// se cobra.
//
// El archivo empieza con "_" para que Vercel NO lo cuente como
// función (el plan Hobby permite máximo 12).
// ============================================================

// México no usa horario de verano desde 2022: Monterrey es UTC-6 todo el año.
const START = Date.parse('2026-11-13T00:00:00-06:00');
const END = Date.parse('2026-11-18T00:00:00-06:00'); // termina el 17 a las 23:59:59

// Precios en pesos MXN.
//   unit:  precio Buen Fin por pieza
//   packs: paquetes [piezas, precio del paquete], del más grande al más chico
const PRICES = {
  perfume100: { unit: 549, packs: [[3, 1499], [2, 1049]] },
  aerosol250: { unit: 549, packs: [[2, 1049]] },
  aceite250: { unit: 849 },
  aceite1l: { unit: 1849 },
  a60: { unit: 1099, packs: [[2, 2099]] },
  a1000: { unit: 8499 },
  carpro: { unit: 1299 },
};

// Combos: solo existen durante el Buen Fin (no tienen Price en Stripe).
const COMBOS = {
  combohogar: {
    name: 'Combo Hogar — Difusor A60 + Spray ambiental 250 ml',
    unit: 1549,
    regular: 1799,
    incluyeDifusor: true,
  },
  comboaroma: {
    name: 'Combo Aroma — Perfume 100 ml + Spray ambiental 250 ml',
    unit: 1099,
    regular: 1200,
    incluyeDifusor: false,
  },
};

// Vista previa: en una URL de prueba de Vercel (*.vercel.app) se puede
// forzar el precio Buen Fin mandando buenfinPreview desde la página
// (?buenfin=preview). En nucleoessences.com nunca se activa antes de
// tiempo. También se puede forzar con la variable BUENFIN_FORCE=1.
function isActive(req, body) {
  if (process.env.BUENFIN_FORCE === '1') return true;
  const now = Date.now();
  if (now >= START && now < END) return true;
  const host = String((req && req.headers && req.headers.host) || '');
  return Boolean(body && body.buenfinPreview) && host.endsWith('.vercel.app');
}

// Precio total (pesos) de Q piezas de un producto con precio Buen Fin.
function groupTotal(key, qty) {
  const p = PRICES[key];
  if (!p) return null;
  let restantes = qty;
  let total = 0;
  for (const [piezas, precio] of p.packs || []) {
    const n = Math.floor(restantes / piezas);
    total += n * precio;
    restantes -= n * piezas;
  }
  return total + restantes * p.unit;
}

// Reparte el total del grupo entre sus piezas en pesos completos
// (p. ej. 3 perfumes por $1,499 → 500 + 500 + 499).
function unitAmounts(total, qty) {
  const base = Math.floor(total / qty);
  const resto = total - base * qty;
  const out = [];
  for (let i = 0; i < qty; i++) out.push(base + (i < resto ? 1 : 0));
  return out;
}

module.exports = { START, END, PRICES, COMBOS, isActive, groupTotal, unitAmounts };
