// Небо системы: полоса галактического диска и туманности.
//
// Почему это ФОН, а не объекты в системе. Настоящая туманность — это
// сотни световых лет газа; ближайшая к нам в тысячу раз дальше, чем
// размер всей планетной системы. Внутри системы её нельзя ни облететь,
// ни приблизить: она просто рисунок на небе, который не двигается,
// сколько ни лети. Поэтому туманности живут ровно там же, где звёзды, —
// на бесконечности, в повороте камеры и без глубины.
//
// Отсюда же следует и цена: небо не зависит ни от времени, ни от места,
// значит его можно посчитать ОДИН раз в кубическую карту и дальше брать
// одной выборкой на пиксель. Считать шум на каждый пиксель каждого
// кадра было бы вторым по дороговизне проходом после поверхности — при
// том, что результат от кадра к кадру не меняется вовсе.
//
// Всё — из seed системы. Ничего узнаваемого здесь нет намеренно: у
// следующей звезды будет свой seed, а значит другой наклон полосы,
// другая сторона, где ядро, другие облака и другие их цвета.

import { makeRng } from '../core/rng.js';
import { galaxyFor } from '../render/starfield.js';

// Сколько облаков рисуем. Больше пяти небо превращается в кашу: они
// начинают перекрываться, и по цвету уже не понять, где какое.
export const SKY_BLOBS = 4;
// Ближе этого облака не ставим (косинус угла; 0.82 ≈ 35°) — иначе два
// цветных пятна сливаются в одно грязное.
const BLOB_APART = 0.82;
// Облака лежат в диске, а не где попало: газ, из которого они состоят,
// собран в ту же плоскость, что и звёзды. Это ±25° от плоскости.
const BLOB_LAT = 0.42;

/**
 * Виды туманностей и их цвета. Основание физическое: светятся они
 * линиями конкретных элементов, и цвет у каждой линии свой. Поэтому
 * палитра не «красивые оттенки», а четыре разных механизма свечения —
 * и от системы к системе меняется не цвет линии, а то, какие из них
 * попались и в какой пропорции.
 */
export const NEBULA_KINDS = [
  { name: 'водородная', color: [1.00, 0.28, 0.40] },   // линия Hα, розово-красная
  { name: 'кислородная', color: [0.26, 0.95, 0.76] },  // дважды ионизованный O III
  { name: 'отражательная', color: [0.38, 0.55, 1.00] }, // пыль рассеивает синее
  { name: 'пылевая', color: [0.95, 0.60, 0.30] },      // тёплая, почти бурая
];

const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Описание неба по seed системы: диск и облака.
 *
 * @returns {galaxy, blobs} — blobs: {dir, color, size, gain, freq, kind}
 */
export function skyFor(seed) {
  const galaxy = galaxyFor(seed);
  const rng = makeRng((seed ^ 0x5b3d) >>> 0);
  const { e1, e2, pole } = galaxy;
  const blobs = [];
  for (let i = 0; i < SKY_BLOBS; i++) {
    let dir = null;
    // Место ищем с попытками: облако не должно сесть на соседа. Не
    // нашлось за два десятка попыток — значит небо уже занято, и облаков
    // просто будет меньше. Это лучше, чем ставить их внахлёст.
    for (let t = 0; t < 24 && !dir; t++) {
      const lat = rng.range(-1, 1) * BLOB_LAT;
      const th = rng.range(0, Math.PI * 2);
      const s = Math.sqrt(1 - lat * lat);
      const c = Math.cos(th), sn = Math.sin(th);
      const d = {
        x: s * (e1.x * c + e2.x * sn) + pole.x * lat,
        y: s * (e1.y * c + e2.y * sn) + pole.y * lat,
        z: s * (e1.z * c + e2.z * sn) + pole.z * lat,
      };
      if (blobs.every((b) => dot3(b.dir, d) < BLOB_APART)) dir = d;
    }
    if (!dir) continue;
    const kind = NEBULA_KINDS[rng.int(0, NEBULA_KINDS.length - 1)];
    // Оттенок чуть гуляет: даже одна и та же линия выглядит иначе, если
    // сквозь облако просвечивает пыль.
    const jitter = (v) => Math.max(0, Math.min(1, v * rng.range(0.88, 1.12)));
    blobs.push({
      dir,
      kind: kind.name,
      color: kind.color.map(jitter),
      size: rng.range(0.16, 0.52),    // угловой радиус, рад (9°..30°)
      gain: rng.range(0.55, 1.0),
      freq: rng.range(2.4, 6.0),      // частота шума, лепящего форму
    });
  }
  return { galaxy, blobs };
}

/**
 * Значения для шейдера: плоские массивы под uniform-ы.
 * Длина фиксирована (SKY_BLOBS) — в GLSL границы циклов должны быть
 * известны при сборке.
 */
export function skyUniforms(sky) {
  const dirs = new Float32Array(SKY_BLOBS * 3);
  const cols = new Float32Array(SKY_BLOBS * 3);
  const pars = new Float32Array(SKY_BLOBS * 3);
  sky.blobs.forEach((b, i) => {
    dirs[i * 3] = b.dir.x; dirs[i * 3 + 1] = b.dir.y; dirs[i * 3 + 2] = b.dir.z;
    cols[i * 3] = b.color[0]; cols[i * 3 + 1] = b.color[1]; cols[i * 3 + 2] = b.color[2];
    pars[i * 3] = b.size; pars[i * 3 + 1] = b.gain; pars[i * 3 + 2] = b.freq;
  });
  const g = sky.galaxy;
  return {
    count: sky.blobs.length,
    dirs, cols, pars,
    pole: new Float32Array([g.pole.x, g.pole.y, g.pole.z]),
    core: new Float32Array([g.core.x, g.core.y, g.core.z]),
    sigma: g.sigma,
  };
}

// --- GLSL --------------------------------------------------------------------

// Общая яркость неба. Оно обязано остаться ФОНОМ: звёзды рисуются
// поверх, и если полоса выйдет ярче их, небо превратится в светящийся
// туман, на котором не видно ни звёзд, ни целей. Ручка одна — эта.
export const SKY_GAIN = 0.17;

export const SKY_GLSL = `
uniform vec3 uPole;          // полюс галактического диска
uniform vec3 uCore;          // направление на ядро (лежит в плоскости)
uniform float uSigma;        // полуширина диска в косинусе широты
uniform float uGain;
uniform int uBlobs;
uniform vec3 uBlobDir[${SKY_BLOBS}];
uniform vec3 uBlobCol[${SKY_BLOBS}];
uniform vec3 uBlobPar[${SKY_BLOBS}];   // размер, яркость, частота
uniform float uSkySeed;

// Шум здесь ЗНАЧЕНИЙ, а не градиентный, как у рельефа: небо считается
// один раз в текстуру, сшивать его не с чем, а облакам нужна мягкая
// клякса, а не аккуратные холмы.
float sHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419) + uSkySeed);
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float sNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = sHash(i), n100 = sHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = sHash(i + vec3(0.0, 1.0, 0.0)), n110 = sHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = sHash(i + vec3(0.0, 0.0, 1.0)), n101 = sHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = sHash(i + vec3(0.0, 1.0, 1.0)), n111 = sHash(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

float sFbm(vec3 p, int oct) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int o = 0; o < 6; o++) {
    if (o >= oct) break;
    sum += amp * sNoise(p);
    norm += amp;
    amp *= 0.5;
    p *= 2.03;                 // не ровно два: иначе решётки октав совпадают
  }
  return sum / max(norm, 1e-6);
}

// Прожилки пыли: гребни шума, а не его значение. Пыль в диске лежит
// длинными волокнами, и именно гребневой шум даёт волокна, а не пятна.
float sRidge(vec3 p, int oct) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int o = 0; o < 4; o++) {
    if (o >= oct) break;
    float n = 1.0 - abs(sNoise(p) * 2.0 - 1.0);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    p *= 2.11;
  }
  return sum / max(norm, 1e-6);
}

/** Цвет неба по направлению (единичному). */
vec3 skyColor(vec3 d) {
  float lat = dot(d, uPole);
  // К ядру диск и ярче, и толще — там балдж.
  float toCore = max(0.0, dot(d, uCore));
  float wide = uSigma * (1.0 + 0.9 * toCore * toCore);
  float band = exp(-lat * lat / (2.0 * wide * wide));
  // Звёздные облака вдоль полосы: без них она выглядит нарисованной
  // кистью — ровная и одинаковая по всей длине.
  float cloud = 0.45 + 0.95 * sFbm(d * 2.6 + 7.3, 4);
  // Тёмные волокна — только у самой плоскости, где пыли больше всего.
  float narrow = wide * 0.55;
  float lane = sRidge(d * 6.5 + 31.7, 3) * exp(-lat * lat / (2.0 * narrow * narrow));
  float disk = band * cloud * (1.0 - 0.72 * lane) * (0.55 + 1.35 * toCore);
  // Цвет полосы — свет неразрешимых звёзд: тёплый и почти белый, с
  // уходом в бурое там, где сквозь него просвечивает пыль.
  vec3 col = mix(vec3(0.78, 0.76, 0.70), vec3(0.62, 0.42, 0.30), lane * 0.8) * disk;

  for (int i = 0; i < ${SKY_BLOBS}; i++) {
    if (i >= uBlobs) break;
    float size = uBlobPar[i].x;
    float c = clamp(dot(d, uBlobDir[i]), -1.0, 1.0);
    float ang = acos(c);
    if (ang >= size) continue;
    // Мягкий край: у туманности нет границы, она растворяется.
    float edge = 1.0 - ang / size;
    edge = edge * edge * (3.0 - 2.0 * edge);
    float n = sFbm(d * uBlobPar[i].z + float(i) * 13.7, 5);
    // Степень даёт клочья вместо ровного пятна: слабое гасится, яркое
    // остаётся.
    float shape = pow(max(0.0, n * 1.35 - 0.28), 2.0);
    col += uBlobCol[i] * edge * shape * uBlobPar[i].y;
  }

  // Общая холодная дымка: совсем чёрное небо между звёздами выглядит
  // дырой, а не пространством.
  col += vec3(0.020, 0.026, 0.042) * (0.35 + 0.65 * sFbm(d * 1.4 + 61.1, 3));
  return col * uGain;
}
`;
