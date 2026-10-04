// Кабина: то, что видно с места пилота.
//
// ЧТО БЫЛО НЕ ТАК — дважды.
//
// Сначала кабина была коробкой в полтора метра с прямоугольным проёмом:
// плоские серые борта в сантиметре от плеча, потолок над самой головой и
// наклейки приборов поверх доски — «гроб с окном».
//
// Потом у неё появились свой фонарь, стекло над головой и мониторы — но
// она по-прежнему висела В ПУСТОТЕ: глаз стоял в двенадцати метрах перед
// центром корабля и в шести над ним, то есть в девяти метрах над носом и
// снаружи корпуса, а сам корпус от первого лица не рисовался вовсе.
// Кабина рисовалась отдельным проходом поверх кадра — и читалась ровно
// так: худ, положенный на картинку. Своего носа пилот не видел, хотя на
// настоящем корабле он лежит прямо перед ним.
//
// ЧТО ТЕПЕРЬ. Глаз — в РУБКЕ, под настоящим фонарём корабля
// (js/models/hulldetail.js, BRIDGE), и вокруг рисуется весь корпус: сквозь
// стекло рубки виден свой нос, крылья и корма, а стойки и переплёт — это
// переплёт самого фонаря, тот же, что видно снаружи. Здесь собран только
// пост пилота на палубе рубки:
//
//   * ПРИБОРНАЯ ДОСКА — наклонная панель с пятью мониторами в корпусах с
//     кнопками, над ней чёрный матовый козырёк с табло и лампами
//     сигнализации. Матовый — чтобы доска не отражалась в лобовом
//     стекле, нависает — чтобы солнце не засвечивало экраны;
//   * РУЧКА И РУД на подлокотниках, как у истребителя, вместо штурвала:
//     колонка посреди доски закрывала бы центральный монитор — локатор;
//   * БОКОВЫЕ ПУЛЬТЫ с тумблерами и лампами, кресло за спиной;
//   * ПАЛУБА — по сечению фонаря на высоте пола: ниже неё корпус пуст
//     изнутри, и без палубы, опустив взгляд, пилот видел бы изнанку
//     днища в десяти метрах под собой.
//
// Всё задано в МЕТРАХ от глаза и от поля зрения игры (68° по вертикали,
// ±50° по горизонтали), а не на глаз: мониторы обязаны уместиться между
// козырьком (−20°) и нижней кромкой кадра (−34°), прицел — оставаться
// чистым, нос — быть виден над козырьком. Проверки сверяют это числами
// (tools/test.mjs, «кабина»).
//
// Рисуется пост своим проходом и своим шейдером (js/gl/cabin.js): краска
// с фотографии, тени от солнца сквозь переплёт фонаря, свет от экранов на
// доске. Экраны — настоящие текстуры: софт мониторов рисует их на своих
// холстах (js/ui/panels.js).
//
// Начало координат — глаз пилота, оси — оси корабля (x вправо, y вверх,
// z вперёд), единица — метр.

import { v3 } from '../core/vec3.js';
import { faceNormal } from './geometry.js';
import { buildCobra } from './ships.js';
import { MAT as HULL_MAT, BRIDGE } from './hulldetail.js';

/** Глаз пилота в осях модели корабля, м (там же — начало координат кабины). */
export const EYE = BRIDGE.eye;

const DEG = Math.PI / 180;

/** Материал грани — число в атрибуте aMat шейдера кабины (js/gl/cabin.js). */
export const CMAT = {
  paint: 1,     // крашеный металл: фотография краски, блеск по потёртостям
  trim: 2,      // тёмный композит: козырёк, корпуса мониторов
  metal: 3,     // голый металл: рычаги, петли
  screen: 4,    // экран: текстура софта
  lamp: 5,      // лампа: светится сама
  rubber: 6,    // резина: рукоятки, чехол ручки
  hazard: 7,    // жёлто-чёрная полоса
  led: 8,       // светодиодная лента подсветки
  tread: 9,     // рифлёный пол
  grille: 10,   // решётка вентиляции
  glass: 11,    // стекло фонаря (отдельная сетка)
};

// Палитра. Корпус — графит в тон обшивке корабля; козырёк и корпуса
// мониторов — почти чёрный мат; акценты — янтарь и жёлто-чёрная полоса,
// по которым в кабине и различают, где рукоятки.
const C = {
  frame: [84, 90, 98],
  hood: [19, 21, 24],
  lip: [28, 31, 35],
  panel: [76, 81, 89],
  shelf: [76, 81, 88],
  lower: [58, 62, 69],
  floor: [48, 50, 54],
  bezel: [26, 28, 32],
  key: [52, 55, 60],
  metal: [150, 154, 160],
  rubber: [24, 25, 27],
  grip: [36, 38, 42],
  accent: [200, 124, 44],
  hazard: [214, 168, 40],
  ledCyan: [110, 205, 245],
  ledWarm: [255, 222, 176],
  lampRed: [240, 84, 62],
  lampGreen: [96, 226, 126],
  lampAmber: [255, 184, 72],
  lampBlue: [86, 168, 245],
  grille: [34, 37, 41],
};

// --- размеры ------------------------------------------------------------------
//
// Пост стоит на палубе рубки перед лобовым стеклом корабля. Передняя
// кромка доски — дуга в плане (радиус 1.08 м от глаза) на одном отношении
// y/z, то есть в кадре — горизонталь; по бокам пост ограничен линией,
// вдоль которой идут боковые пульты.
export const CP = {
  baseR: 1.08,              // передняя кромка доски: радиус в плане
  baseT: -0.30,             // её наклон от глаза: y/z (в кадре — горизонталь, см. elAt)
  pillarAz: 48,             // градусов — края доски
  sillBack: { x: 1.0, y: -0.24, z: -0.30 },                     // задний край боковых пультов
  floorY: BRIDGE.deck - BRIDGE.eye.y,   // палуба рубки, от глаза
  // Козырёк — дугой вокруг глаза: [угол места посередине, расстояние].
  lipTop: [-17.2, 0.845],    // кромка козырька
  lipBot: [-20.5, 0.84],     // низ его лицевой полосы — ближе верха панели: козырёк нависает
  // Панель мониторов — плоская: её центр на угле места el и расстоянии d,
  // и она перпендикулярна взгляду туда (см. «приборная доска»). Шаг
  // мониторов по x — ширина корпуса и полсантиметра зазора.
  mfd: { el: -27.2, d: 0.85, w: 0.23, h: 0.149, side: 0.02, cap: 0.026, depth: 0.035, step: 0.275 },
  panUp: 0.105,              // верх панели над центром мониторов, м по плоскости
  panDown: 0.13,             // низ — под ним
  shelf: { z: 0.56, y: -0.53 },   // полка под мониторами
  knee: { z: 0.70, y: -1.10 },    // низ доски у пола
  // Табло на кромке козырька.
  strip: { el: -18.85, d: 0.838, h: 0.040 },
  // Ручка и РУД: оси качания.
  stick: { x: 0.32, y: -0.64, z: 0.30 },
  throttle: { x: -0.32, y: -0.64, z: 0.26 },
};

/** Экраны кабины: что где стоит. Софт для каждого — в js/ui/panels.js. */
export const SCREENS = [
  { id: 'systems', kind: 'mfd', slot: -2 },
  { id: 'flight', kind: 'mfd', slot: -1 },
  { id: 'scope', kind: 'mfd', slot: 0 },
  { id: 'target', kind: 'mfd', slot: 1 },
  { id: 'map', kind: 'mfd', slot: 2 },
  { id: 'annL', kind: 'strip', az: -26, w: 0.30 },
  { id: 'comms', kind: 'strip', az: 0, w: 0.40 },
  { id: 'annR', kind: 'strip', az: 26, w: 0.30 },
];

// --- векторы -----------------------------------------------------------------
const add = (a, b, k = 1) => v3(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, k) => v3(a.x * k, a.y * k, a.z * k);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
};
const cross = (a, b) => v3(
  a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const lerp = (a, b, t) => v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
const X = v3(1, 0, 0), Y = v3(0, 1, 0), Z = v3(0, 0, 1);

/** Направление от глаза: азимут (вправо +) и угол места, градусы. */
export const dirAt = (az, el) => v3(
  Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG),
  Math.cos(az * DEG) * Math.cos(el * DEG));
const polar = (az, el, d) => mul(dirAt(az, el), d);
/** Точка в вертикальной полуплоскости азимута: расстояние от оси и высота. */
const ring = (az, rho, y) => v3(Math.sin(az * DEG) * rho, y, Math.cos(az * DEG) * rho);

/**
 * Угол места кромки доски на азимуте az, если посередине он el.
 *
 * ЗАЧЕМ. Доска идёт дугой вокруг глаза, и кромка на ОДНОМ угле места —
 * это в кадре не прямая, а дуга, опущенная к краям: прямолинейная
 * проекция кладёт точку на высоту tg(el)/cos(az). В первом заходе так и
 * вышло — крайние мониторы уехали за нижнюю кромку кадра. Если же
 * держать tg(el) = tg(el₀)·cos(az), кромка ложится в кадре ровной
 * горизонталью: в пространстве это плоскость через глаз, то есть доска,
 * срезанная по линии взгляда, — как у настоящей, чей козырёк из кресла
 * виден одной линией.
 */
export const elAt = (el, az) => Math.atan(Math.tan(el * DEG) * Math.cos(az * DEG)) / DEG;
/** Точка профиля доски: [угол места посередине, расстояние] на азимуте az. */
const prof = (az, [el, d]) => polar(az, elAt(el, az), d);

// --- ключевые линии поста ---------------------------------------------------------

/** Нижняя кромка лобового стекла, az — градусы в пределах стоек. В кадре — горизонталь. */
const baseAt = (az) => ring(az, CP.baseR, CP.baseR * CP.baseT * Math.cos(az * DEG));
const PILLAR_FOOT = (s) => baseAt(s * CP.pillarAz);
const SILL_BACK = (s) => v3(s * CP.sillBack.x, CP.sillBack.y, CP.sillBack.z);

/** |x| борта на данном z (борт вертикальный, в плане — прямая). */
function wallX(z) {
  const a = PILLAR_FOOT(1), b = SILL_BACK(1);
  const u = (z - a.z) / (b.z - a.z);
  return a.x + (b.x - a.x) * Math.max(0, Math.min(1, u));
}

// --- сборщик сетки -----------------------------------------------------------------

/**
 * Сетка кабины. Формат граней — как у js/models/geometry.js, плюс то,
 * что нужно шейдеру кабины: материал, гладкость (сглаженные нормали по
 * общим вершинам), текстурные координаты экрана и его имя.
 */
export class Kit {
  constructor() { this.verts = []; this.faces = []; }
  pt(p) { this.verts.push(v3(p.x, p.y, p.z)); return this.verts.length - 1; }
  face(idx, c, mat, o = {}) {
    const f = {
      v: idx, c, mat,
      emissive: o.emissive || 0,
      smooth: !!o.smooth,
      uv: o.uv || null,
      screen: o.screen || null,
      n: faceNormal(this.verts, idx),
    };
    this.faces.push(f);
    return f;
  }
  poly(points, c, mat, o) { return this.face(points.map((p) => this.pt(p)), c, mat, o); }
  /** Полоса между рядами точек: у соседних граней вершины общие. */
  loft(rows, c, mat, o = {}) {
    const ids = rows.map((r) => r.map((p) => this.pt(p)));
    for (let i = 0; i + 1 < ids.length; i++) {
      for (let j = 0; j + 1 < ids[i].length; j++) {
        this.face([ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j]], c, mat, o);
      }
    }
  }
  /**
   * Брус вдоль ломаной. Сечение — [s, o]: s поперёк, o — от глаза
   * наружу (outOf). Внутренняя грань со скошенными кромками смотрит на
   * пилота: по бликам на фасках брус и читается объёмным.
   */
  sweep(path, outOf, section, c, mat, o = {}) {
    const n = path.length;
    const rings = [];
    for (let i = 0; i < n; i++) {
      const p = path[i];
      const t = norm(sub(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)]));
      let out = outOf(p);
      out = norm(sub(out, mul(t, dot(out, t))));
      const s = cross(t, out);
      rings.push(section.map(([a, b]) => add(add(p, s, a), out, b)));
    }
    const m = section.length;
    for (let i = 0; i + 1 < n; i++) {
      for (let j = 0; j < m; j++) {
        const j1 = (j + 1) % m;
        this.poly([rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]], c, mat, o);
      }
    }
    // Торцы.
    this.poly(rings[0].slice().reverse(), c, mat, o);
    this.poly(rings[n - 1], c, mat, o);
  }
  /** Коробка: центр, три оси, полуразмеры. */
  box(c, ax, ay, az, hx, hy, hz, col, mat, o = {}) {
    const P = (sx, sy, sz) => add(add(add(c, ax, sx * hx), ay, sy * hy), az, sz * hz);
    const q = (a, b, cc, d, oo = o) => this.poly([a, b, cc, d], col, mat, oo);
    const v = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1),
      P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
    // Лицевая грань (+az) может быть своей: у кнопок светится именно она.
    q(v[0], v[1], v[2], v[3]); q(v[5], v[4], v[7], v[6], o.front || o);
    q(v[4], v[0], v[3], v[7]); q(v[1], v[5], v[6], v[2]);
    q(v[3], v[2], v[6], v[7], o.top || o); q(v[4], v[5], v[1], v[0]);
  }
  /** Цилиндр вдоль оси: от a к b, радиусы r0 → r1. */
  tube(a, b, r0, r1, sides, col, mat, o = {}) {
    const t = norm(sub(b, a));
    const h = Math.abs(t.y) < 0.9 ? Y : X;
    const u = norm(cross(h, t)), w = cross(t, u);
    const ra = [], rb = [];
    for (let i = 0; i < sides; i++) {
      const g = (i / sides) * Math.PI * 2;
      const d = add(mul(u, Math.cos(g)), w, Math.sin(g));
      ra.push(add(a, d, r0)); rb.push(add(b, d, r1));
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.poly([ra[i], ra[j], rb[j], rb[i]], col, mat, { ...o, smooth: true });
    }
    this.poly(ra.slice().reverse(), col, mat, o);
    this.poly(rb, col, mat, o.cap || o);
  }
  mesh() { return { verts: this.verts, faces: this.faces }; }
}

/** Сечение бруса: видимая ширина w, толщина d, фаска c. */
export const beamSection = (w, d, c = 0.012) => [
  [-w / 2, d * 0.45], [-w / 2, -d * 0.55 + c], [-w / 2 + c, -d * 0.55],
  [w / 2 - c, -d * 0.55], [w / 2, -d * 0.55 + c], [w / 2, d * 0.45],
];

// --- части -----------------------------------------------------------------------------

/**
 * Корпус корабля в осях кабины (метры от глаза). Из него берутся стекло
 * фонаря (слой стекла над видом и проверки) и палуба; целиком он уходит
 * в карту теней кабины — солнце на доску падает сквозь переплёт, а
 * корма и днище его закрывают.
 */
function hullInCabin(hull) {
  const K = 1000;
  const verts = hull.verts.map((v) => v3(v.x * K - EYE.x, v.y * K - EYE.y, v.z * K - EYE.z));
  const faces = hull.faces.map((f) => ({ v: f.v, c: f.c, n: f.n, mat: f.mat || 0, glass: f.mat === HULL_MAT.glass }));
  return { verts, faces };
}

/** Стекло фонаря — отдельной сеткой: поверх вида его кладёт проход кабины. */
function hullGlass(H, g) {
  const panes = [];
  for (const f of H.faces) {
    if (!f.glass) continue;
    const pts = f.v.map((i) => H.verts[i]);
    panes.push(pts);
    g.poly(pts, [200, 220, 235], CMAT.glass);
  }
  return panes;
}

/**
 * Палуба рубки: сечение фонаря плоскостью пола, полосами по z. Ширина в
 * каждой полосе — до ближайшей к оси стенки корпуса на этой высоте, то
 * есть до стекла: палуба доходит до него и не вылезает наружу.
 */
function deck(k, H) {
  const yd = CP.floorY;
  const rows = [];
  // Видна ли точка из глаза: за задней стеной рубки (наклонная плита от
  // днища к верху фонаря за креслом) пол уже в корме, внутри корпуса.
  const tris = [];
  for (const f of H.faces) {
    for (let t = 1; t + 1 < f.v.length; t++) tris.push([H.verts[f.v[0]], H.verts[f.v[t]], H.verts[f.v[t + 1]]]);
  }
  const seen = (q) => {
    const L = Math.hypot(q.x, q.y, q.z), d = { x: q.x / L, y: q.y / L, z: q.z / L };
    for (const [a, b, c] of tris) {
      const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2);
      const det = dot(e1, p);
      if (Math.abs(det) < 1e-12) continue;
      const tv = mul(a, -1), u = dot(tv, p) / det;
      if (u < 0 || u > 1) continue;
      const qv = cross(tv, e1), v = dot(d, qv) / det;
      if (v < 0 || u + v > 1) continue;
      const t = dot(e2, qv) / det;
      if (t > 1e-6 && t < L - 0.01) return false;
    }
    return true;
  };
  for (let z = 3.2; z >= -10.2; z -= 0.25) {
    let left = -Infinity, right = Infinity, lGlass = false, rGlass = false;
    for (const f of H.faces) {
      const P = f.v.map((i) => H.verts[i]);
      const cut = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        if ((a.z - z) * (b.z - z) < 0) {
          const t = (z - a.z) / (b.z - a.z);
          cut.push([a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t]);
        }
      }
      if (cut.length < 2) continue;
      const [p0, p1] = cut;
      if ((p0[1] - yd) * (p1[1] - yd) > 0) continue;
      const t = (yd - p0[1]) / ((p1[1] - p0[1]) || 1e-9);
      const x = p0[0] + (p1[0] - p0[0]) * t;
      if (x < 0) { if (x > left) { left = x; lGlass = f.glass; } } else if (x < right) { right = x; rGlass = f.glass; }
    }
    // Палуба — только под фонарём: где стенки на высоте пола уже не
    // стекло, там кончается рубка и начинается корма, и пол ушёл бы
    // внутрь корпуса.
    if (isFinite(left) && isFinite(right) && right - left > 0.3 && lGlass && rGlass) {
      const l = left + 0.015, r = right - 0.015;
      if (seen(v3(0, yd, z)) && seen(v3(l + 0.05, yd, z)) && seen(v3(r - 0.05, yd, z))) rows.push({ z, l, r });
    }
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i], b = rows[i + 1];
    if (a.z - b.z > 0.3) continue;
    k.poly([v3(a.l, yd, a.z), v3(a.r, yd, a.z), v3(b.r, yd, b.z), v3(b.l, yd, b.z)], C.floor, CMAT.tread);
  }
  // Светодиодная лента по кромке палубы: ночью по ней видно, где пол
  // кончается и начинается стекло.
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i], b = rows[i + 1];
    if (a.z - b.z > 0.3) continue;
    for (const [xa, xb, sgn] of [[a.l, b.l, 1], [a.r, b.r, -1]]) {
      k.poly([v3(xa, yd + 0.002, a.z), v3(xa + sgn * 0.025, yd + 0.002, a.z),
        v3(xb + sgn * 0.025, yd + 0.002, b.z), v3(xb, yd + 0.002, b.z)], C.ledCyan, CMAT.led, { emissive: 0.45 });
    }
  }
  return rows;
}

// --- приборная доска ------------------------------------------------------------
//
// Панель мониторов — ПЛОСКАЯ и наклонная, а не дуга вокруг глаза, и это
// решает кадр. Экран игры — прямолинейная проекция: она не искажает
// только прямые, параллельные кадру, а всё, что повёрнуто к глазу сбоку,
// растягивает к краям. В первом заходе мониторы стояли дугой, каждый лицом
// к пилоту, — и крайний на азимуте 38° вышел в кадре почти вдвое выше
// среднего (687…934 пикселя против 725…867): верх ушёл под козырёк, низ —
// за кромку кадра. На плоскости, в которой лежит ось x, горизонтали
// остаются горизонталями, и все пять мониторов выходят одного размера и в
// один ряд — как на настоящей приборной панели.
//
// Козырёк же остаётся дугой: его кромки лежат на отношении y/z, одинаковом
// по всей дуге (elAt), — в кадре это тоже ровная горизонталь, а в плане он
// обнимает пилота и сходится с передней стенкой.

/** Плоскость мониторов: центр среднего, «вверх» по плоскости, нормаль к пилоту. */
const PANEL = (() => {
  const dir = dirAt(0, CP.mfd.el);
  return { c: mul(dir, CP.mfd.d), up: cross(dir, X), n: mul(dir, -1) };
})();

/** Ширина кабины на глубине z: борт и передняя стенка (дуга лобового стекла). */
function innerX(z) {
  const arc = Math.sqrt(Math.max(0, CP.baseR * CP.baseR - z * z));
  return Math.min(wallX(z), arc) - 0.004;
}

/**
 * Приборная доска: козырёк, его лицевая полоса, подсветка под ним,
 * панель мониторов, полка и низ до пола. Каждая полоса — своя сетка со
 * сглаженными нормалями вдоль: доска гнутая, а не гранёная.
 */
function dash(k) {
  const N = 33;
  const rows = { A: [], B: [], C: [], D: [], E: [], F: [], G: [] };
  const back = mul(PANEL.n, -0.012);             // панель — за корпусами мониторов
  const D0 = add(add(PANEL.c, PANEL.up, CP.panUp), back);
  const E0 = add(add(PANEL.c, PANEL.up, -CP.panDown), back);
  const line = (p0, t) => v3(t * innerX(p0.z), p0.y, p0.z);
  for (let i = 0; i < N; i++) {
    const t = -1 + (2 * i) / (N - 1);
    const az = t * CP.pillarAz;
    rows.A.push(baseAt(az));
    rows.B.push(prof(az, CP.lipTop));
    rows.C.push(prof(az, CP.lipBot));
    rows.D.push(line(D0, t));
    rows.E.push(line(E0, t));
    rows.F.push(line(v3(0, CP.shelf.y, CP.shelf.z), t));
    rows.G.push(line(v3(0, CP.knee.y, CP.knee.z), t));
  }
  // Передняя стенка доски — от кромки козырька до палубы: доска стоит на
  // полу рубки, а не висит под стеклом.
  k.loft([rows.A.map((p) => v3(p.x, CP.floorY, p.z)), rows.A], C.lower, CMAT.paint);
  k.loft([rows.A, rows.B], C.hood, CMAT.trim, { smooth: true });
  k.loft([rows.B, rows.C], C.lip, CMAT.trim, { smooth: true });
  k.loft([rows.C, rows.D], C.hood, CMAT.trim, { smooth: true });
  k.loft([rows.D, rows.E], C.panel, CMAT.paint, { smooth: true });
  k.loft([rows.E, rows.F], C.shelf, CMAT.paint, { smooth: true });
  k.loft([rows.F, rows.G], C.lower, CMAT.paint, { smooth: true });
  // Торцы доски.
  for (const i of [0, N - 1]) {
    const pts = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((r) => rows[r][i]);
    k.poly(pts, C.lower, CMAT.paint);
  }
  // Подсветка доски — лента под козырьком, тёплый свет вниз на мониторы.
  // Светит она не только в шейдере (лампы кабины, cabinLights), но и
  // видна сама: тонкая нить по нижней кромке козырька.
  const led = [], led2 = [];
  for (let i = 3; i < N - 3; i++) {
    led.push(add(lerp(rows.C[i], rows.D[i], 0.06), Y, -0.0012));
    led2.push(add(lerp(rows.C[i], rows.D[i], 0.12), Y, -0.0012));
  }
  k.loft([led, led2], C.ledWarm, CMAT.led, { emissive: 1 });
  // Полка: ряды кнопок между мониторами.
  const up = norm(sub(E0, v3(0, CP.shelf.y, CP.shelf.z)));
  const n = norm(cross(up, X));
  for (const j of [-1.5, -0.5, 0.5, 1.5]) {
    const c = add(lerp(E0, v3(0, CP.shelf.y, CP.shelf.z), 0.45), X, j * CP.mfd.step);
    for (let r = 0; r < 2; r++) {
      for (let q = 0; q < 3; q++) {
        const p = add(add(add(c, X, (q - 1) * 0.024), up, (r - 0.5) * 0.03), n, 0.004);
        const lit = (r + q) % 3 === 0;
        k.box(p, X, up, n, 0.008, 0.009, 0.004, C.key, CMAT.rubber, {
          front: lit ? { emissive: 0.45 } : null,
        });
        if (lit) {
          const f = add(p, n, 0.0041);
          k.poly([add(add(f, X, -0.005), up, -0.002), add(add(f, X, 0.005), up, -0.002),
            add(add(f, X, 0.005), up, 0.002), add(add(f, X, -0.005), up, 0.002)],
          [C.lampAmber, C.lampGreen, C.lampBlue][q], CMAT.lamp, { emissive: 1 });
        }
      }
    }
  }
}

/**
 * Монитор: корпус с фаской, утопленный экран и кнопки по рамке — пять
 * сверху, пять снизу и по три с боков, как у многофункционального
 * индикатора в самолёте. Подписи кнопок рисует сам софт на краю экрана
 * (js/ui/panels.js): кнопка без подписи — это не прибор, а декор.
 */
function mfd(k, s) {
  const m = CP.mfd;
  const c = add(PANEL.c, X, s.slot * m.step);
  const right = X, up = PANEL.up, out = PANEL.n;   // out — к пилоту
  const hw = m.w / 2, hh = m.h / 2;
  const ow = hw + m.side, oh = hh + m.cap;
  const P = (x, y, o = 0) => add(add(add(c, right, x), up, y), out, o);
  // Колодец экрана — четыре миллиметра: у крайнего монитора, который
  // виден под углом 33°, более глубокий закрывал бы край картинки.
  const face = 0.004, ch = 0.004;
  // Лицевая рамка: кольцо между экраном и фаской.
  const inner = [P(-hw, hh, face), P(hw, hh, face), P(hw, -hh, face), P(-hw, -hh, face)];
  const outer = [P(-ow + ch, oh - ch, face), P(ow - ch, oh - ch, face),
    P(ow - ch, -oh + ch, face), P(-ow + ch, -oh + ch, face)];
  const back = [P(-ow, oh, face - ch), P(ow, oh, face - ch), P(ow, -oh, face - ch), P(-ow, -oh, face - ch)];
  const base = [P(-ow, oh, -m.depth), P(ow, oh, -m.depth), P(ow, -oh, -m.depth), P(-ow, -oh, -m.depth)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    k.poly([outer[i], outer[j], inner[j], inner[i]], C.bezel, CMAT.trim);
    k.poly([back[i], back[j], outer[j], outer[i]], C.bezel, CMAT.trim);
    k.poly([base[i], base[j], back[j], back[i]], C.bezel, CMAT.trim);
    // Стенки колодца экрана: экран утоплен на глубину рамки.
    const si = add(inner[i], out, -face), sj = add(inner[j], out, -face);
    k.poly([inner[i], inner[j], sj, si], C.hood, CMAT.trim);
  }
  // Экран. Ось «вправо» — вправо по кадру: иначе картинка выходит
  // зеркальной, как когда-то у табло на стойках (проверка это меряет).
  k.poly([P(-hw, hh), P(hw, hh), P(hw, -hh), P(-hw, -hh)], [255, 255, 255], CMAT.screen, {
    screen: s.id, uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
  });
  // Кнопки: пять сверху и снизу, по три с боков.
  const key = (x, y, bw, bh) => {
    k.box(P(x, y, face + 0.003), right, up, out, bw, bh, 0.003, C.key, CMAT.rubber, {
      front: { emissive: 0.18 },
    });
  };
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * (m.w / 5);
    key(x, hh + m.cap * 0.5, 0.0095, 0.0052);
    key(x, -hh - m.cap * 0.5, 0.0095, 0.0052);
  }
  for (let i = 0; i < 3; i++) {
    const y = (1 - i) * (m.h / 3.4);
    key(-hw - m.side * 0.5, y, 0.005, 0.008);
    key(hw + m.side * 0.5, y, 0.005, 0.008);
  }
  // Датчик освещённости в углу рамки — точка, по которой монитор
  // узнаётся монитором.
  k.poly([P(ow - 0.015, -oh + 0.011, face + 0.0005), P(ow - 0.009, -oh + 0.011, face + 0.0005),
    P(ow - 0.009, -oh + 0.017, face + 0.0005), P(ow - 0.015, -oh + 0.017, face + 0.0005)],
  C.lampGreen, CMAT.lamp, { emissive: 0.8 });
  return {
    id: s.id, kind: 'mfd', pos: c, right, up, normal: out, w: m.w, h: m.h,
    corners: [P(-hw, hh), P(hw, hh), P(hw, -hh), P(-hw, -hh)],
  };
}

/**
 * Табло на кромке козырька: гнутое по дуге, как сама кромка. Плоское в
 * сорок сантиметров отходило бы от неё к краям на два сантиметра.
 */
function strip(k, s) {
  const st = CP.strip;
  const half = (s.w / st.d) / DEG / 2;          // полуширина по азимуту
  const dh = (st.h / 2 / st.d) / DEG;           // полувысота по углу места
  const N = 4;
  const pts = (el, d) => {
    const row = [];
    for (let i = 0; i <= N; i++) {
      const az = s.az - half + (2 * half * i) / N;
      row.push(polar(az, elAt(el, az), d));
    }
    return row;
  };
  const top = pts(st.el + dh, st.d), bot = pts(st.el - dh, st.d);
  for (let i = 0; i < N; i++) {
    const u0 = i / N, u1 = (i + 1) / N;
    k.poly([top[i], top[i + 1], bot[i + 1], bot[i]], [255, 255, 255], CMAT.screen, {
      screen: s.id, uv: [[u0, 0], [u1, 0], [u1, 1], [u0, 1]],
    });
  }
  // Корпус табло — подложка чуть шире экрана и позади него: по её
  // кромке экран и читается вставленным, а не нарисованным.
  const f = (0.007 / st.d) / DEG;
  const plate = (el) => {
    const row = [];
    for (let i = 0; i <= N; i++) {
      const az = s.az - half - f + (2 * (half + f) * i) / N;
      row.push(polar(az, elAt(el, az), st.d + 0.003));
    }
    return row;
  };
  k.loft([plate(st.el + dh + f), plate(st.el - dh - f)], C.bezel, CMAT.trim);
  const dir = dirAt(s.az, elAt(st.el, s.az));
  const right = norm(cross(Y, dir));
  return {
    id: s.id, kind: 'strip', pos: mul(dir, st.d), right, up: cross(dir, right),
    normal: mul(dir, -1), w: s.w, h: st.h,
    // Настоящие углы гнутого табло: плоская хорда лежит за ним.
    corners: [top[0], top[N], bot[N], bot[0]],
  };
}

/** Ряд тумблеров с лампами на плоскости (c, right, up, n). */
function switches(k, c, right, up, n, count, step, lamps) {
  for (let i = 0; i < count; i++) {
    const p = add(c, right, (i - (count - 1) / 2) * step);
    // Основание и сам рычажок, отклонённый «вверх» по панели.
    k.box(add(p, n, 0.003), right, up, n, 0.009, 0.012, 0.003, C.key, CMAT.trim);
    k.tube(add(p, n, 0.006), add(add(p, n, 0.024), up, 0.008), 0.0028, 0.0022, 6, C.metal, CMAT.metal);
    if (lamps) {
      const lp = add(add(p, up, 0.026), n, 0.0015);
      const col = lamps[i % lamps.length];
      k.poly([add(add(lp, right, -0.004), up, -0.003), add(add(lp, right, 0.004), up, -0.003),
        add(add(lp, right, 0.004), up, 0.003), add(add(lp, right, -0.004), up, 0.003)],
      col, CMAT.lamp, { emissive: 1 });
    }
  }
}

/** Боковые пульты вдоль бортов и подлокотники под ручку и РУД. */
function consoles(k) {
  const fl = CP.floorY;
  for (const s of [-1, 1]) {
    // Пульт у борта: от доски назад до переборки.
    const topY = -0.52, inX = s * 0.64, z0 = 0.58, z1 = -0.62;
    const top = [v3(inX, topY, z0), v3(s * wallX(z0), topY, z0),
      v3(s * wallX(CP.sillBack.z), topY, CP.sillBack.z), v3(s * CP.sillBack.x, topY, z1), v3(inX, topY, z1)];
    k.poly(top, C.shelf, CMAT.paint);
    k.poly([top[0], top[4], v3(inX, fl, z1), v3(inX, fl, z0)], C.lower, CMAT.paint);
    k.poly([top[0], v3(inX, fl, z0), v3(s * wallX(z0), fl, z0), top[1]], C.lower, CMAT.paint);
    k.poly([top[4], top[3], v3(s * CP.sillBack.x, fl, z1), v3(inX, fl, z1)], C.lower, CMAT.paint);
    // Наружная стенка пульта — стен у поста больше нет, за ним палуба рубки.
    for (let i = 1; i < 3; i++) {
      k.poly([top[i], top[i + 1], v3(top[i + 1].x, fl, top[i + 1].z), v3(top[i].x, fl, top[i].z)], C.lower, CMAT.paint);
    }
    // Кант по кромке пульта — светлая полоса с янтарной лентой.
    k.sweep([v3(inX, topY, z0), v3(inX, topY, z1)], () => v3(s, 0.4, 0), beamSection(0.03, 0.02, 0.006),
      C.frame, CMAT.paint);
    k.poly([v3(inX - s * 0.004, topY - 0.012, z0 - 0.02), v3(inX - s * 0.004, topY - 0.012, z1 + 0.02),
      v3(inX - s * 0.004, topY - 0.018, z1 + 0.02), v3(inX - s * 0.004, topY - 0.018, z0 - 0.02)],
    C.ledCyan, CMAT.led, { emissive: 0.6 });
    // Тумблеры и лампы на пульте.
    const n = Y, right = Z, up = v3(-s, 0, 0);
    for (let r = 0; r < 3; r++) {
      const c = v3(s * (0.71 + r * 0.075), topY, 0.12 - r * 0.02);
      switches(k, c, right, up, n, 5 - (r === 2 ? 1 : 0), 0.042,
        r === 0 ? [C.lampGreen, C.lampAmber] : (r === 1 ? [C.lampBlue] : [C.lampRed, C.lampGreen]));
    }
    // Решётка вентиляции на передней стенке пульта.
    k.poly([v3(s * 0.70, -0.62, z0 + 0.001), v3(s * 0.78, -0.62, z0 + 0.001),
      v3(s * 0.78, -0.78, z0 + 0.001), v3(s * 0.70, -0.78, z0 + 0.001)], C.grille, CMAT.grille);

    // Подлокотник: мягкий верх, по переднему краю — площадка под ручку.
    const ax = s * 0.32;
    k.box(v3(ax, -0.70, -0.02), X, Y, Z, 0.085, 0.055, 0.34, C.grip, CMAT.rubber);
    k.box(v3(ax, (CP.floorY - 0.75) / 2, -0.02), X, Y, Z, 0.07, (0.75 + CP.floorY) / -2, 0.30, C.lower, CMAT.paint);
    k.box(v3(ax, -0.655, 0.30), X, Y, Z, 0.07, 0.012, 0.06, C.frame, CMAT.paint);
  }
  // Рифлёная полоса под ногами у доски — чтобы пол читался полом.
  k.poly([v3(-0.5, CP.floorY + 0.002, 0.62), v3(0.5, CP.floorY + 0.002, 0.62),
    v3(0.5, CP.floorY + 0.002, 0.52), v3(-0.5, CP.floorY + 0.002, 0.52)], C.hazard, CMAT.hazard);
}

/** Кресло за спиной: спинка с боковинами и подголовник. */
function seat(k) {
  k.box(v3(0, -0.44, -0.34), X, Y, Z, 0.25, 0.40, 0.05, C.grip, CMAT.rubber);
  k.box(v3(0, 0.05, -0.25), X, Y, Z, 0.14, 0.10, 0.045, C.grip, CMAT.rubber);
  for (const s of [-1, 1]) {
    k.box(v3(s * 0.235, -0.42, -0.29), X, Y, Z, 0.035, 0.36, 0.07, C.lower, CMAT.paint);
    k.tube(v3(s * 0.07, -0.05, -0.29), v3(s * 0.07, 0.0, -0.265), 0.008, 0.008, 6, C.metal, CMAT.metal);
  }
  // Основание кресла — до палубы.
  k.box(v3(0, (CP.floorY - 0.84) / 2, -0.18), X, Y, Z, 0.16, (0.84 + CP.floorY) / -2, 0.16, C.frame, CMAT.paint);
}

// --- подвижное -------------------------------------------------------------------

/** Ручка управления: чехол, шток и рукоятка с гашеткой. От оси качания. */
export function buildStick() {
  const k = new Kit();
  const O = v3(0, 0, 0);
  k.tube(O, v3(0, 0.05, 0), 0.036, 0.018, 10, C.rubber, CMAT.rubber);            // чехол
  k.tube(v3(0, 0.045, 0), v3(0, 0.10, 0.004), 0.011, 0.011, 8, C.metal, CMAT.metal);
  // Рукоятка чуть наклонена вперёд — под ладонь.
  const g0 = v3(0, 0.10, 0.004), g1 = v3(0, 0.19, 0.022);
  k.tube(g0, g1, 0.021, 0.024, 10, C.grip, CMAT.rubber, { cap: {} });
  k.box(v3(0, 0.196, 0.02), X, Y, Z, 0.022, 0.008, 0.026, C.grip, CMAT.rubber);
  // Гашетка спереди и шляпка на макушке.
  k.box(v3(0, 0.165, 0.045), X, Y, Z, 0.006, 0.012, 0.006, C.lampRed, CMAT.paint);
  k.box(v3(0, 0.205, 0.028), X, Y, Z, 0.007, 0.004, 0.007, C.key, CMAT.metal);
  k.box(v3(0.016, 0.18, 0.012), X, Y, Z, 0.004, 0.006, 0.006, C.accent, CMAT.paint);
  return k.mesh();
}

/** РУД: ползун в прорези, рычаг и рукоятка. От оси качания. */
export function buildThrottle() {
  const k = new Kit();
  k.box(v3(0, 0.004, 0.0), X, Y, Z, 0.012, 0.012, 0.03, C.metal, CMAT.metal);
  k.tube(v3(0, 0.0, 0), v3(0, 0.12, 0.012), 0.009, 0.008, 8, C.metal, CMAT.metal);
  k.box(v3(-0.012, 0.14, 0.018), X, Y, Z, 0.03, 0.022, 0.032, C.grip, CMAT.rubber);
  k.box(v3(-0.012, 0.164, 0.026), X, Y, Z, 0.012, 0.004, 0.01, C.accent, CMAT.paint);
  k.box(v3(0.012, 0.15, 0.04), X, Y, Z, 0.004, 0.006, 0.006, C.lampRed, CMAT.paint);
  return k.mesh();
}

/** Прорезь РУДа с делениями — неподвижная часть, в оболочке. */
function throttleGate(k) {
  const p = CP.throttle;
  const c = v3(p.x, p.y - 0.004, p.z);
  k.box(c, X, Y, Z, 0.045, 0.012, 0.11, C.frame, CMAT.paint);
  k.poly([v3(p.x - 0.006, p.y + 0.0085, p.z - 0.09), v3(p.x + 0.006, p.y + 0.0085, p.z - 0.09),
    v3(p.x + 0.006, p.y + 0.0085, p.z + 0.09), v3(p.x - 0.006, p.y + 0.0085, p.z + 0.09)], C.hood, CMAT.trim);
  for (let i = 0; i < 5; i++) {
    const z = p.z - 0.08 + i * 0.04;
    k.poly([v3(p.x + 0.014, p.y + 0.0086, z - 0.002), v3(p.x + 0.036, p.y + 0.0086, z - 0.002),
      v3(p.x + 0.036, p.y + 0.0086, z + 0.002), v3(p.x + 0.014, p.y + 0.0086, z + 0.002)],
    i === 1 ? C.lampAmber : C.metal, i === 1 ? CMAT.lamp : CMAT.metal, { emissive: i === 1 ? 0.8 : 0 });
  }
}

/**
 * Лампы кабины — там же, где их видно: подсветка доски из-под козырька
 * (по лампе на монитор, лучом вниз на рамку), плафон над головой и свет
 * в ногах. Цвет — уже с силой: ночью кабину освещают только они и сами
 * экраны.
 */
function cabinLights() {
  const out = [];
  for (const s of SCREENS) {
    if (s.kind !== 'mfd') continue;
    const c = add(PANEL.c, X, s.slot * CP.mfd.step);
    const top = add(add(c, PANEL.up, CP.panUp), PANEL.n, -0.012);
    // Лампа — под козырьком над монитором, луч — на его нижнюю рамку.
    const pos = v3(c.x, top.y + 0.002, top.z - 0.018);
    const aim = add(c, PANEL.up, -CP.mfd.h * 0.4);
    out.push({ pos, dir: norm(sub(aim, pos)), cos: Math.cos(64 * DEG), color: [0.46, 0.39, 0.30], range: 0.34 });
  }
  out.push({ pos: v3(0, -0.78, 0.56), dir: norm(v3(0, -0.7, -1)), cos: Math.cos(70 * DEG),
    color: [0.06, 0.13, 0.18], range: 0.8 });
  return out;
}

/**
 * Собрать пост пилота в рубке корабля.
 *
 * @param hull корпус (js/models/ships.js, в километрах): по нему палуба и стекло
 * @returns {{shell, glass, hull, stick, throttle, screens, panes, lights, bound, eye, size}}
 */
export function buildCockpit(hull = buildCobra()) {
  const k = new Kit();
  const g = new Kit();
  const H = hullInCabin(hull);
  const panes = hullGlass(H, g);
  dash(k);
  const screens = {};
  for (const s of SCREENS) screens[s.id] = s.kind === 'mfd' ? mfd(k, s) : strip(k, s);
  consoles(k);
  seat(k);
  throttleGate(k);
  // Габарит — самого поста, без палубы: палуба — это рубка, а не кабина.
  const lo = v3(Infinity, Infinity, Infinity), hi = v3(-Infinity, -Infinity, -Infinity);
  for (const v of k.verts) {
    lo.x = Math.min(lo.x, v.x); hi.x = Math.max(hi.x, v.x);
    lo.y = Math.min(lo.y, v.y); hi.y = Math.max(hi.y, v.y);
    lo.z = Math.min(lo.z, v.z); hi.z = Math.max(hi.z, v.z);
  }
  const deckRows = deck(k, H);

  const shell = k.mesh();
  return {
    code: 'challenger',
    shell,
    glass: g.mesh(),
    hull: H,
    deck: deckRows,
    eye: EYE,
    stick: { mesh: buildStick(), pivot: v3(CP.stick.x, CP.stick.y, CP.stick.z) },
    throttle: { mesh: buildThrottle(), pivot: v3(CP.throttle.x, CP.throttle.y, CP.throttle.z) },
    screens,
    panes,
    lights: cabinLights(),
    bound: { lo, hi },
    size: CP,
  };
}

// --- ручка и РУД на ходу ---------------------------------------------------------------

// Пределы отклонения ручки. Это не физика, а показания: по ним видно,
// что ручка отдана, и насколько.
export const YOKE = {
  pitch: 0.30,        // рад — от себя / на себя
  roll: 0.30,         // рад — влево / вправо
  yaw: 0.12,          // рад — доворот рукоятки (педалей нет — крутится она)
  // За столько ручка доходит до упора. Меньше, чем разгоняется сам
  // корабль (SHIP.rotRamp = 1.4 с и задержка маневровых): рука быстрее корпуса, иначе
  // управление выглядит запаздывающим.
  ramp: 0.18,         // с
  // РУД: полный ход вперёд и назад от нейтрали.
  throttle: 0.42,     // рад
};

export const makeYoke = () => ({ pitch: 0, yaw: 0, roll: 0, throttle: 0 });

/**
 * Довести ручку и РУД до положения органов управления.
 *
 * Берутся именно РУЧКИ (ship.control), а не угловые скорости корабля:
 * ручку держит пилот, и стоять она должна там, куда её отклонили, даже
 * если корабль ещё не пошёл. РУД — за заданной тягой (ship.throttle).
 */
export function updateYoke(yoke, control, dt, throttle = 0) {
  const k = Math.min(1, dt / YOKE.ramp);
  const c = control || {};
  yoke.pitch += ((c.pitch || 0) * YOKE.pitch - yoke.pitch) * k;
  yoke.yaw += ((c.yaw || 0) * YOKE.yaw - yoke.yaw) * k;
  yoke.roll += ((c.roll || 0) * YOKE.roll - yoke.roll) * k;
  yoke.throttle += ((throttle || 0) * YOKE.throttle - (yoke.throttle || 0)) * k;
  return yoke;
}
