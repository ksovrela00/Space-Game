// Детерминированный ГПСЧ: система и планеты должны быть одинаковыми
// при каждом запуске игры.

export const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const makeRng = (seed) => {
  const r = mulberry32(seed);
  return {
    next: r,
    range: (lo, hi) => lo + r() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + r() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
  };
};

const SYL_A = ['ta', 're', 'la', 'za', 'or', 'be', 'ti', 'qu', 've', 'xe', 'ri', 'so', 'in', 'di', 'ce', 'ma'];
const SYL_B = ['ve', 'ra', 'ni', 'ce', 'ge', 'di', 'so', 'us', 'or', 'an', 'is', 'ed', 'le', 'ka', 'th', 'on'];
const SYL_C = ['us', 'is', 'ar', 'on', 'ei', 'or', 'an', 'es', 'ia', 'um', 'ex', 'il'];

// Имена в духе Elite: 2-3 слога.
export const makeName = (rng) => {
  let s = rng.pick(SYL_A) + rng.pick(SYL_B);
  if (rng.chance(0.55)) s += rng.pick(SYL_C);
  return s[0].toUpperCase() + s.slice(1);
};

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
