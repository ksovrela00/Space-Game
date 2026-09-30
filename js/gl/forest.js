// Дальний лес: те же деревья, что в поле у корабля, — до горизонта.
//
// ЧТО БЫЛО. Деревья жили только в поле вокруг камеры: у земли его радиус
// 420 м, и редеть лес начинал уже с двухсот шестидесяти. С камеры под
// брюхом это читалось однозначно — лес вокруг корабля, дальше голая
// равнина до горизонта. А горизонт с пятидесяти метров на Lave II — в
// двадцати одном километре.
//
// СКОЛЬКО НАДО. Дерево среднего роста (15 м) занимает пиксель примерно с
// десяти-пятнадцати километров (фокус около 700 точек), дальше оно — доля
// пикселя, и лес там живёт в цвете грунта (js/gl/terrain.js, FOREST).
// Значит деревья нужны ровно до этого предела. В самом лесном месте
// Lave II это сто тысяч деревьев — полными моделями (полтораста граней)
// их не нарисовать, поэтому вдали дерево — силуэт по профилю своей же
// модели в двадцать пять треугольников, освещённый тем же солнцем.
//
// ТЕ ЖЕ САМЫЕ ДЕРЕВЬЯ. Расстановка — та же решётка граней куба, тот же
// хеш и та же густота, что у поля растений (js/gl/flora.js,
// scatterFlora): у дерева в пяти километрах ровно то место, порода и
// рост, какие будут, когда корабль подлетит. Поэтому, приближаясь, лес
// не «переставляется», а только проступает подробностями.
//
// КТО РИСУЕТ ДЕРЕВО — поле или дальний лес — решается одним числом на
// дерево, его рангом: rank = h0 / (chance·g). Поле берёт дерево, если
// rank ≤ fade (fade — редение к краю поля), дальний лес — если rank >
// fade. Это ровно разбиение: каждое дерево рисуется один раз, и на краю
// поля полные модели плавно сменяются силуэтами без дыр и без двойных.
//
// Здесь — только геометрия, без единого обращения к GL: файл работает и
// в рабочем потоке (js/gl/forestworker.js), и в проверках под node.

import { FLORA, growth, hash4, BY_KIND } from './flora.js';
import { terrainOf, canopyTint } from './terrain.js';
import { faceDir } from './quadtree.js';
import { CUBE_FACES } from './bake.js';

const QUARTER = Math.PI / 4;

export const FAR = {
  // Кусок леса — квадрат решётки деревьев: 64 клетки по 38 м, 2.4 км. Кусок
  // собирается один раз и рисуется одним вызовом; мельче — больше вызовов,
  // крупнее — дольше сборка и дальше лишние деревья за краем круга.
  chunk: 64,
  // Цвет полога — по грубой сетке через четыре клетки (152 м): он меняется
  // медленно, а выборка цвета грунта стоит четыре микросекунды.
  coarse: 4,
  // Дальше этого дерево среднего роста мельче этой доли пикселя, и
  // рисовать его незачем: там лес — цвет грунта.
  pxMin: 0.7,
  hMean: 0.015,          // км — рост «среднего» дерева для этого предела
  // Прореживание вдали. Когда одиночная крона уже мельче полутора
  // пикселей, рисуется каждое четвёртое дерево (подрешётка через одно по
  // обеим осям), вдвое шире; вдвое дальше — каждое шестнадцатое, вчетверо
  // шире. Площадь крон при этом сохраняется, и лес у горизонта не редеет,
  // а число силуэтов падает в разы. Подрешётка — та же, что у поля при
  // прореживании: номер клетки у дерева не меняется.
  crownPx: 1.5,
  crownW: 0.006,         // км — поперечник одиночной кроны
  // Кольцо, на котором одно прореживание плавно сменяет другое (доля
  // расстояния): без него на границе был бы виден шов густоты.
  band: 0.15,
  // Ствол у силуэта — доля высоты; с километра он тоньше пикселя, но без
  // него крона висит над землёй просветом.
  trunk: 0.04,
  // Дерево утоплено на сотую высоты, как у поля: на склоне модель,
  // приложенная плоским дном, видна.
  sink: 0.01,
};

// --- силуэт ------------------------------------------------------------------------

/**
 * Профиль кроны модели: где она начинается, где шире всего и насколько
 * — в долях высоты. Считается по листве (роль 1) самой модели, а не
 * задаётся на глаз: у сосны крона от самой земли и шире всего внизу, у
 * дуба — на полпути и шире всего у середины.
 *
 * @returns [низ кроны, радиус внизу, высота самого широкого места, радиус там]
 */
export function crownProfile(part) {
  const v = part.verts, f = part.faces, pal = part.pal;
  const leaf = new Set();
  for (let i = 0; i < f.length;) {
    const n = f[i];
    const ci = f[i + n + 1];
    if (pal[ci * 4 + 3] === 1) for (let k = 1; k <= n; k++) leaf.add(f[i + k]);
    i += n + 2;
  }
  let yLo = 1, rMax = 0, yMax = 0;
  for (const k of leaf) {
    const y = v[k * 3 + 1] / 1000, r = Math.hypot(v[k * 3], v[k * 3 + 2]) / 1000;
    yLo = Math.min(yLo, y);
    if (r > rMax) { rMax = r; yMax = y; }
  }
  let rLo = 0;
  const span = Math.max(1e-3, 1 - yLo);
  for (const k of leaf) {
    const y = v[k * 3 + 1] / 1000;
    if (y <= yLo + span * 0.12) rLo = Math.max(rLo, Math.hypot(v[k * 3], v[k * 3 + 2]) / 1000);
  }
  if (!leaf.size) return [0.3, 0.2, 0.5, 0.3];
  return [yLo, rLo, Math.max(yMax, yLo), rMax];
}

/** Породы деревьев в том порядке, в каком их выбирает хеш у поля. */
export const TREE_MODELS = BY_KIND.tree || [];
export const TREE_PROFILES = TREE_MODELS.map((m) => crownProfile(m.part));

/**
 * Единичный силуэт: кольца на высотах 0, низ кроны, самое широкое место
 * и верхушка; пять граней по кругу. На вершину — (угол, кольцо, угол
 * середины грани, пояс): высоты и радиусы колец берутся из профиля в
 * шейдере, поэтому одна сетка служит всем породам.
 *
 * Пять граней, а не четыре: четырёхгранная крона читается кристаллом.
 * Три пояса по пять четырёхугольников, последний — треугольники к
 * верхушке: 25 треугольников.
 */
export const PROXY_SIDES = 5;
export function proxyGeometry() {
  const S = PROXY_SIDES;
  const out = [];
  const tau = Math.PI * 2;
  for (let band = 0; band < 3; band++) {
    for (let k = 0; k < S; k++) {
      const a0 = k / S * tau, a1 = (k + 1) / S * tau, am = (k + 0.5) / S * tau;
      const lo = band, hi = band + 1;
      const put = (a, ring) => out.push(a, ring, am, band);
      if (band < 2) {
        put(a0, lo); put(a1, lo); put(a1, hi);
        put(a0, lo); put(a1, hi); put(a0, hi);
      } else {
        put(a0, lo); put(a1, lo); put(a0, hi);    // к верхушке: кольцо 3 — точка
      }
    }
  }
  return new Float32Array(out);
}

// --- куски --------------------------------------------------------------------------

/** Шаг решётки деревьев в параметрах грани (тот же, что у поля). */
export const cellStep = (body) => (FLORA.layers[0].cell / body.radius) / QUARTER;

/** Число плавающих на дерево в куске. */
export const INST = 12;

/**
 * Собрать кусок дальнего леса.
 *
 * Деревья идут подряд по 12 чисел: место относительно начала куска (км,
 * оси тела), рост (км), цвет полога, номер породы, ранг, класс
 * подрешётки (0 — любое, 1 — через одно, 2 — через три), разворот и
 * запас. Отсортированы по классу: сначала самые редкие, чтобы дальний
 * кусок рисовал только начало своего списка.
 *
 * @returns {face, bi, bj, origin, n, n1, n2, inst}
 */
export function forestChunk(body, face, bi, bj) {
  const t = terrainOf(body);
  const L = FLORA.layers[0];
  const R = body.radius;
  const C = FAR.chunk, K = FAR.coarse;
  const base = cellStep(body);
  const gi0 = bi * C, gj0 = bj * C;
  const clampU = (u) => Math.max(-1, Math.min(1, u));
  const models = TREE_MODELS;

  // Начало координат куска — грунт под его серединой: всё внутри в
  // пределах пары километров от него, и точности float32 хватает на
  // сотые доли миллиметра.
  const d0 = faceDir(face, clampU((gi0 + C / 2) * base), clampU((gj0 + C / 2) * base), { x: 0, y: 0, z: 0 });
  const h0 = (1 + t.displace(d0.x, d0.y, d0.z)) * R;
  const origin = { x: d0.x * h0, y: d0.y * h0, z: d0.z * h0 };

  // Грубая сетка цвета грунта: по ней красится полог.
  const G = C / K + 1;
  const col = new Float32Array(G * G * 3);
  const rgb = [0, 0, 0];
  for (let b = 0; b < G; b++) {
    for (let a = 0; a < G; a++) {
      const d = faceDir(face, clampU((gi0 + a * K) * base), clampU((gj0 + b * K) * base), { x: 0, y: 0, z: 0 });
      t.color(d.x, d.y, d.z, rgb);
      canopyTint(rgb[0], rgb[1], rgb[2], rgb);
      col.set(rgb, (b * G + a) * 3);
    }
  }

  const list = [];
  const salt = face * 7919 + (body.id | 0) * 104729;       // слой деревьев — нулевой
  const d = { x: 0, y: 0, z: 0 };
  for (let j = 0; j < C; j++) {
    for (let i = 0; i < C; i++) {
      const gi = gi0 + i, gj = gj0 + j;
      const h = hash4(gi, gj, salt);
      if (h[0] > L.chance) continue;
      const u = (gi + (h[1] - 0.5) * 0.92) * base;
      const v = (gj + (h[2] - 0.5) * 0.92) * base;
      if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;      // соседняя грань
      faceDir(face, u, v, d);
      const g = growth(body, t, d.x, d.y, d.z);
      if (g <= 0 || h[0] > L.chance * g) continue;
      const hg = (1 + t.displace(d.x, d.y, d.z)) * R;
      const height = L.hMin + (L.hMax - L.hMin) * (0.25 + 0.75 * h[3]);
      const r = hg - height * FAR.sink;
      // Цвет — билинейно по грубой сетке.
      const fa = i / K, fb = j / K;
      const a0 = Math.min(G - 2, Math.floor(fa)), b0 = Math.min(G - 2, Math.floor(fb));
      const ta = fa - a0, tb = fb - b0;
      const c = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const c00 = col[(b0 * G + a0) * 3 + k], c10 = col[(b0 * G + a0 + 1) * 3 + k];
        const c01 = col[((b0 + 1) * G + a0) * 3 + k], c11 = col[((b0 + 1) * G + a0 + 1) * 3 + k];
        c[k] = (c00 * (1 - ta) + c10 * ta) * (1 - tb) + (c01 * (1 - ta) + c11 * ta) * tb;
      }
      const cls = (gi & 3) === 0 && (gj & 3) === 0 ? 2 : ((gi & 1) === 0 && (gj & 1) === 0 ? 1 : 0);
      list.push({
        x: d.x * r - origin.x, y: d.y * r - origin.y, z: d.z * r - origin.z,
        height, c,
        model: Math.floor(h[3] * models.length) % Math.max(1, models.length),
        rank: h[0] / (L.chance * g),
        cls,
        spin: h[1] * Math.PI * 2,
      });
    }
  }
  list.sort((a, b) => b.cls - a.cls);
  const inst = new Float32Array(list.length * INST);
  let n2 = 0, n1 = 0;
  list.forEach((p, k) => {
    const o = k * INST;
    inst[o] = p.x; inst[o + 1] = p.y; inst[o + 2] = p.z; inst[o + 3] = p.height;
    inst[o + 4] = p.c[0]; inst[o + 5] = p.c[1]; inst[o + 6] = p.c[2]; inst[o + 7] = p.model;
    inst[o + 8] = p.rank; inst[o + 9] = p.cls; inst[o + 10] = p.spin; inst[o + 11] = 0;
    if (p.cls === 2) n2++;
    if (p.cls >= 1) n1++;
  });
  return { face, bi, bj, origin, n: list.length, n1, n2, inst };
}

// --- какие куски нужны --------------------------------------------------------------

/** Дальность леса, км: там дерево среднего роста — pxMin пикселя. */
export const farRadius = (focal) => FAR.hMean * focal / FAR.pxMin;

/** Расстояние прореживаний, км: крона мельче crownPx пикселей. */
export const thinAt = (focal) => FAR.crownW * focal / FAR.crownPx;

const dotF = (f, d) => f[0] * d.x + f[1] * d.y + f[2] * d.z;

/**
 * Куски, которые задевает круг радиуса rKm вокруг точки dir (оси тела).
 * Грань выбирается ЛЮБАЯ, до которой круг дотягивается: у ребра куба
 * лес стоит на двух гранях сразу.
 *
 * @returns [{face, bi, bj, dist}] — dist, км, от середины куска
 */
export function chunksAround(body, dir, rKm, out = []) {
  out.length = 0;
  const R = body.radius;
  const base = cellStep(body);
  const C = FAR.chunk;
  const span = C * base;                       // кусок в параметрах грани
  const N = Math.ceil(1 / span);               // кусков на полграни
  const rho = rKm / R;                         // угловой радиус круга
  const half = span * QUARTER * 1.5;           // полудиагональ куска (с запасом), рад
  const d = { x: 0, y: 0, z: 0 };
  for (let face = 0; face < 6; face++) {
    const F = CUBE_FACES[face];
    const cf = dotF(F.F, dir);
    // До грани не дотянуться: она дальше, чем угол до её края плюс круг.
    if (cf < Math.cos(Math.min(Math.PI / 2 - 1e-3, Math.PI / 4 * 1.42 + rho))) continue;
    // Точка камеры на плоскости грани (может лежать и за её краем).
    const s = dotF(F.U, dir) / Math.max(cf, 1e-3), tt = dotF(F.V, dir) / Math.max(cf, 1e-3);
    const u = Math.atan(s) / QUARTER, v = Math.atan(tt) / QUARTER;
    const reach = rho / QUARTER * 2 + span;
    const b0 = Math.max(-N, Math.floor((u - reach) / span)), b1 = Math.min(N - 1, Math.floor((u + reach) / span));
    const c0 = Math.max(-N, Math.floor((v - reach) / span)), c1 = Math.min(N - 1, Math.floor((v + reach) / span));
    for (let bj = c0; bj <= c1; bj++) {
      for (let bi = b0; bi <= b1; bi++) {
        const cu = Math.max(-1, Math.min(1, (bi + 0.5) * span));
        const cv = Math.max(-1, Math.min(1, (bj + 0.5) * span));
        faceDir(face, cu, cv, d);
        const ang = Math.acos(Math.max(-1, Math.min(1, d.x * dir.x + d.y * dir.y + d.z * dir.z)));
        if (ang > rho + half) continue;
        out.push({ face, bi, bj, dist: ang * R });
      }
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

export const chunkKey = (face, bi, bj) => face + ':' + bi + ':' + bj;
