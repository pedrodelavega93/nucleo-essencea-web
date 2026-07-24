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
