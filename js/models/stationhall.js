// Зал станции: тоннель за щелью, зал с тяжестью, площадки, терминал и
// галерея на его кровле — сеткой мира (км, оси станции).
//
// ОБОЛОЧКА И СЕКЦИИ. Сетка зала (hallMesh) — только то, что видно снаружи:
// тоннель, зал, площадки, терминал и галерея снаружи. Она входит в сетку
// станции и рисуется с ней. Внутренности — по секциям (sectionMesh): холл
// площадки с кабиной лифта и галерея с помещениями; каждая собирается при
// первом показе, а рисует их сцена, только когда их видно
// (js/main.js, stationSections). Раньше весь терминал с мебелью (18–34
// тысячи треугольников) входил в сетку станции и рисовался и из космоса.
//
// Планировку даёт js/game/stationplan.js, план для шага — js/game/stationwalk.js:
// здесь только то, как они выглядят. Всё, обо что можно удариться и на что
// сесть (стены зала, площадки, терминал), лежит ровно там, где его считает
// полёт (js/game/berth.js), а стены помещений, проёмы дверей и мебель —
// там, где в них упирается пешеход: из тех же коробок, а не на глаз.
//
// СВЕТ. Солнца в зале нет: его закрывает корпус станции, и шейдер сеток
// гасит его внутри коробки зала (js/gl/shaders.js, HALL_GLSL), а светят
// потолочные ряды — светом сверху и рассеянным. Светящиеся полосы и
// панели здесь — сами светильники: по ним видно, откуда этот свет.
//
// ФАКТУРЫ. Полы, стены и мебель — фотограмметрия CC0 (js/gl/stationtex.js):
// бетон ангара, терраццо конкорса, резиновая плитка залов ожидания,
// паркет бара. Номер материала — у грани (mat), цвет грани — оттенок и
// средняя яркость: фотография даёт рисунок, палитра — тон.

import { v3 } from '../core/vec3.js';
import { makeMesh } from './geometry.js';
import { PAD, TERM, GAL } from '../game/stationplan.js';
import { stationPlan, DOOR } from '../game/stationwalk.js';
import { STMAT } from '../gl/stationtex.js';

const KM = 1e-3;

// Палитра зала.
const FLOOR_A = [148, 150, 152];      // бетон перрона
const FLOOR_B = [138, 140, 143];
const WALL = [118, 124, 134];         // стены зала: бетонные панели
const WALL_DARK = [84, 90, 100];
const RIB = [96, 102, 112];
const CEIL = [70, 74, 82];
const TUNNEL = [92, 98, 108];
const PAD_C = [96, 100, 106];         // площадка — темнее перрона: её видно сверху
const PAD_RING = [210, 214, 218];
const YELLOW = [228, 182, 40];
const DARK = [40, 42, 46];
const LAMP = [255, 246, 226];
const GREEN = [90, 255, 130];
const RED = [255, 90, 80];
const AMBER = [255, 190, 90];
const TERM_WALL = [176, 182, 190];    // корпус терминала — светлый: на нём читаются номера выходов
const TERM_TRIM = [96, 104, 116];
const GLASS = [120, 170, 205];
const SIGN = [250, 250, 240];

// Палитра помещений: оттенок фотографии (средняя яркость грани).
const IN = {
  terrazzo: [206, 202, 194],
  rubber: [74, 80, 92],
  tiles: [204, 202, 196],
  parquet: [176, 176, 176],
  wall: [214, 216, 218],
  wallWarm: [222, 214, 200],
  wallCool: [190, 198, 208],
  wood: [124, 116, 108],
  ceil: [226, 227, 229],
  frame: [70, 76, 86],              // рамы дверей и окон, плинтус
  mullion: [58, 64, 72],
  leather: [70, 74, 84],
  leatherBar: [150, 150, 150],
  steel: [132, 138, 146],
  counterTop: [220, 220, 216],
  white: [232, 234, 236],
  plant: [72, 118, 74],
  soil: [56, 46, 38],
};
// Цвет таблички над дверью — по виду помещения: их ищут глазами из
// конкорса, издали, раньше, чем читают.
const KIND_SIGN = {
  gate: [255, 190, 90], bar: [190, 120, 255], office: [110, 170, 255], hangar: [255, 140, 60],
  med: [90, 230, 130], shop: [80, 220, 220], lift: [120, 210, 255],
};

/** Набор граней: квадраты и коробки в метрах, на выходе — сетка в километрах. */
class Build {
  constructor() { this.verts = []; this.defs = []; }

  /** Многоугольник по точкам (м). */
  poly(P, c, opts = {}) {
    const base = this.verts.length;
    for (const p of P) this.verts.push(v3(p[0] * KM, p[1] * KM, p[2] * KM));
    this.defs.push({ v: P.map((_, i) => base + i), c, twoSided: opts.two !== false, emissive: opts.glow || 0,
      ...(opts.mat ? { mat: opts.mat } : {}) });
  }

  /** Прямоугольник в плоскости: центр o, полуоси a и b (м). */
  rect(o, a, b, c, opts) {
    this.poly([
      [o[0] - a[0] - b[0], o[1] - a[1] - b[1], o[2] - a[2] - b[2]],
      [o[0] + a[0] - b[0], o[1] + a[1] - b[1], o[2] + a[2] - b[2]],
      [o[0] + a[0] + b[0], o[1] + a[1] + b[1], o[2] + a[2] + b[2]],
      [o[0] - a[0] + b[0], o[1] - a[1] + b[1], o[2] - a[2] + b[2]],
    ], c, opts);
  }

  /** Коробка по двум углам (м). */
  box(lo, hi, c, opts = {}) {
    const [x0, y0, z0] = lo, [x1, y1, z1] = hi;
    const top = opts.top || c;
    const q = (P, cc, m) => this.poly(P, cc, { two: false, glow: opts.glow, mat: m });
    q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c, opts.mat);
    q([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], c, opts.mat);
    q([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], c, opts.mat);
    q([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], c, opts.mat);
    q([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], top, opts.topMat || opts.mat);
    if (!opts.noBottom) q([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], c, opts.mat);
  }

  /** Прямоугольник стены с дырами: u, v — в плоскости, дыры — [u0,u1,v0,v1]. */
  holed(at, u0, u1, v0, v1, holes, put) {
    let rects = [[u0, u1, v0, v1]];
    for (const h of holes) {
      const next = [];
      for (const r of rects) {
        const iu0 = Math.max(r[0], h[0]), iu1 = Math.min(r[1], h[1]);
        const iv0 = Math.max(r[2], h[2]), iv1 = Math.min(r[3], h[3]);
        if (iu1 - iu0 <= 1e-6 || iv1 - iv0 <= 1e-6) { next.push(r); continue; }
        if (iu0 > r[0]) next.push([r[0], iu0, r[2], r[3]]);
        if (iu1 < r[1]) next.push([iu1, r[1], r[2], r[3]]);
        if (iv0 > r[2]) next.push([iu0, iu1, r[2], iv0]);
        if (iv1 < r[3]) next.push([iu0, iu1, iv1, r[3]]);
      }
      rects = next;
    }
    for (const r of rects) put(r);
  }

  mesh() {
    const m = makeMesh(this.verts, this.defs);
    return m;
  }
}

// --- цифры: семь отрезков -----------------------------------------------------------
//
// Номера площадок и выходов — те же цифры, что на табло: семь полос. Текста
// движок не рисует, а номер площадки обязан читаться сверху, с подлёта.
const SEG = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};

/**
 * Число цифрами в плоскости: o — левый нижний угол первой цифры, r и u —
 * единичные «вправо» и «вверх» в этой плоскости, h — высота цифры (м).
 */
function digits(B, n, o, r, u, h, c, glow = 0) {
  const s = String(n);
  const w = h * 0.55, t = h * 0.13, gap = h * 0.22;
  const P = (x, y) => [o[0] + r[0] * x + u[0] * y, o[1] + r[1] * x + u[1] * y, o[2] + r[2] * x + u[2] * y];
  const bar = (x0, y0, x1, y1) => B.poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], c, { glow });
  let x = 0;
  for (const ch of s) {
    const segs = SEG[ch] || '';
    const hm = h / 2;
    if (segs.includes('a')) bar(x, h - t, x + w, h);
    if (segs.includes('b')) bar(x + w - t, hm, x + w, h);
    if (segs.includes('c')) bar(x + w - t, 0, x + w, hm);
    if (segs.includes('d')) bar(x, 0, x + w, t);
    if (segs.includes('e')) bar(x, 0, x + t, hm);
    if (segs.includes('f')) bar(x, hm, x + t, h);
    if (segs.includes('g')) bar(x, hm - t / 2, x + w, hm + t / 2);
    x += w + gap;
  }
  return x - gap;
}
/** Ширина числа цифрами высотой h, м. */
const digitsWidth = (n, h) => String(n).length * h * 0.55 + (String(n).length - 1) * h * 0.22;

// --- тоннель ----------------------------------------------------------------------------

/**
 * Тоннель от рамы щели до зала. Стены тёмные, а вдоль них — огни: белые
 * по полу посередине (ось захода), зелёные по верху стен и красные по низу
 * — как и ряды у створа снаружи: по ним видно и ось, и крен.
 */
function buildTunnel(B, L) {
  const t = L.tunnel, hw = t.hw, hh = t.hh, z0 = t.z0, z1 = t.z1;
  const P = { mat: STMAT.panels };
  // Губа рамы: от щели (176 × 96) к сечению тоннеля.
  const sw = 88, sh = 48;
  B.poly([[-hw, -hh, z1], [hw, -hh, z1], [hw, -sh, z1], [-hw, -sh, z1]], TUNNEL, P);
  B.poly([[-hw, sh, z1], [hw, sh, z1], [hw, hh, z1], [-hw, hh, z1]], TUNNEL, P);
  B.poly([[-hw, -sh, z1], [-sw, -sh, z1], [-sw, sh, z1], [-hw, sh, z1]], TUNNEL, P);
  B.poly([[sw, -sh, z1], [hw, -sh, z1], [hw, sh, z1], [sw, sh, z1]], TUNNEL, P);
  // Стены — кусками по сорок метров, через один чуть темнее: иначе длинная
  // гладкая труба не даёт глазу ни одной метки скорости.
  const n = Math.max(1, Math.round((z1 - z0) / 40));
  for (let i = 0; i < n; i++) {
    const a = z0 + (z1 - z0) * i / n, b = z0 + (z1 - z0) * (i + 1) / n;
    const c = i % 2 ? TUNNEL : WALL_DARK;
    B.poly([[-hw, -hh, a], [hw, -hh, a], [hw, -hh, b], [-hw, -hh, b]], c, P);
    B.poly([[-hw, hh, a], [hw, hh, a], [hw, hh, b], [-hw, hh, b]], c, P);
    B.poly([[-hw, -hh, a], [-hw, hh, a], [-hw, hh, b], [-hw, -hh, b]], c, P);
    B.poly([[hw, -hh, a], [hw, hh, a], [hw, hh, b], [hw, -hh, b]], c, P);
  }
  // Огни: через двадцать метров.
  for (let z = z0 + 10; z < z1; z += 20) {
    B.rect([0, -hh + 0.3, z], [3, 0, 0], [0, 0, 1.2], LAMP, { glow: 1 });
    for (const s of [-1, 1]) {
      B.rect([s * (hw - 0.3), hh * 0.7, z], [0, 1.2, 0], [0, 0, 2.5], GREEN, { glow: 1 });
      B.rect([s * (hw - 0.3), -hh * 0.7, z], [0, 1.2, 0], [0, 0, 2.5], RED, { glow: 1 });
    }
  }
}

// --- зал ----------------------------------------------------------------------------------

function buildHall(B, L) {
  const { lo, hi } = L.hall;
  const t = L.tunnel;
  // Пол: плиты по сорок метров, через одну чуть темнее — по швам видно и
  // масштаб, и как быстро пол приближается; фотография бетона ангара —
  // зерно и пятна в шаге от трапа.
  const tile = 40;
  const nx = Math.round((hi[0] - lo[0]) / tile), nz = Math.round((hi[2] - lo[2]) / tile);
  const dx = (hi[0] - lo[0]) / nx, dz = (hi[2] - lo[2]) / nz;
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const x0 = lo[0] + i * dx, z0 = lo[2] + k * dz;
      B.poly([[x0, lo[1], z0], [x0 + dx, lo[1], z0], [x0 + dx, lo[1], z0 + dz], [x0, lo[1], z0 + dz]],
        (i + k) % 2 ? FLOOR_A : FLOOR_B, { mat: STMAT.concrete });
    }
  }
  // Потолок и ряды светильников вдоль зала.
  B.poly([[lo[0], hi[1], lo[2]], [hi[0], hi[1], lo[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]]], CEIL, { mat: STMAT.panels });
  for (let x = lo[0] + 60; x < hi[0] - 30; x += 80) {
    B.rect([x, hi[1] - 0.5, (lo[2] + hi[2]) / 2], [4, 0, 0], [0, 0, (hi[2] - lo[2]) / 2 - 30], LAMP, { glow: 1 });
  }
  // Стены: задняя и боковые целиком, передняя — с проёмом тоннеля.
  const H = hi[1] - lo[1];
  const P = { mat: STMAT.panels };
  B.poly([[lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], hi[1], lo[2]], [lo[0], hi[1], lo[2]]], WALL, P);
  B.poly([[lo[0], lo[1], lo[2]], [lo[0], lo[1], hi[2]], [lo[0], hi[1], hi[2]], [lo[0], hi[1], lo[2]]], WALL, P);
  B.poly([[hi[0], lo[1], lo[2]], [hi[0], lo[1], hi[2]], [hi[0], hi[1], hi[2]], [hi[0], hi[1], lo[2]]], WALL, P);
  B.holed(hi[2], lo[0], hi[0], lo[1], hi[1], [[-t.hw, t.hw, -t.hh, t.hh]],
    (r) => B.poly([[r[0], r[2], hi[2]], [r[1], r[2], hi[2]], [r[1], r[3], hi[2]], [r[0], r[3], hi[2]]], WALL, P));
  // Рёбра по стенам — через шестьдесят метров, и пояс на трети высоты:
  // гладкая стена в полкилометра читается картоном.
  const rib = (x0, z0, x1, z1) => B.box([Math.min(x0, x1), lo[1], Math.min(z0, z1)], [Math.max(x0, x1), hi[1], Math.max(z0, z1)], RIB, P);
  for (let z = lo[2] + 60; z < hi[2] - 20; z += 60) {
    rib(lo[0], z - 2.5, lo[0] + 4, z + 2.5);
    rib(hi[0] - 4, z - 2.5, hi[0], z + 2.5);
  }
  for (let x = lo[0] + 60; x < hi[0] - 20; x += 60) {
    rib(x - 2.5, lo[2], x + 2.5, lo[2] + 4);
    if (Math.abs(x) > t.hw + 6) rib(x - 2.5, hi[2] - 4, x + 2.5, hi[2]);
  }
  const belt = lo[1] + H / 3;
  B.box([lo[0], belt, lo[2]], [lo[0] + 2, belt + 3, hi[2]], WALL_DARK, P);
  B.box([hi[0] - 2, belt, lo[2]], [hi[0], belt + 3, hi[2]], WALL_DARK, P);
  B.box([lo[0], belt, lo[2]], [hi[0], belt + 3, lo[2] + 2], WALL_DARK, P);
  // Окна диспетчерских высоко на стенах — светятся: в зале работают люди.
  for (let z = lo[2] + 90; z < hi[2] - 40; z += 120) {
    for (const s of [-1, 1]) {
      const x = s > 0 ? hi[0] - 0.4 : lo[0] + 0.4;
      B.rect([x, hi[1] - 40, z], [0, 4, 0], [0, 0, 22], GLASS, { glow: 0.7 });
    }
  }
  // Проём тоннеля — рамой огней: из зала видно, где выход.
  for (const s of [-1, 1]) {
    B.rect([s * (t.hw + 3), 0, hi[2] - 0.4], [1, 0, 0], [0, t.hh + 3, 0], AMBER, { glow: 1 });
    B.rect([0, s * (t.hh + 3), hi[2] - 0.4], [t.hw + 4, 0, 0], [0, 1, 0], AMBER, { glow: 1 });
  }
}

// --- площадки -----------------------------------------------------------------------------

/**
 * Площадка: тёмная плита вровень с полом (на 5 см выше — без мерцания),
 * жёлто-чёрная кромка, круг посадки в середине, огни по углам и номер у
 * края со стороны терминала — его видно с подлёта.
 */
function buildPad(B, p) {
  const y = p.lo[1] + 0.05;
  const [x0, , z0] = p.lo, [x1, , z1] = p.hi;
  B.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], PAD_C, { mat: STMAT.concrete });
  // Торцы плиты: пять сантиметров рифлёного листа.
  for (const [a, b] of [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]]) {
    B.poly([[a[0], p.lo[1], a[1]], [b[0], p.lo[1], b[1]], [b[0], y, b[1]], [a[0], y, a[1]]], IN.steel, { mat: STMAT.tread });
  }
  // Кромка: полосы по два метра, жёлтые через чёрную.
  const k = 2, ye = y + 0.03;
  const stripe = (a0, a1, b0, b1, alongX) => {
    const len = alongX ? a1 - a0 : b1 - b0;
    const n = Math.max(2, Math.round(len / 6));
    for (let i = 0; i < n; i++) {
      const c = i % 2 ? DARK : YELLOW;
      if (alongX) {
        const u0 = a0 + (a1 - a0) * i / n, u1 = a0 + (a1 - a0) * (i + 1) / n;
        B.poly([[u0, ye, b0], [u1, ye, b0], [u1, ye, b1], [u0, ye, b1]], c, { mat: STMAT.concrete });
      } else {
        const u0 = b0 + (b1 - b0) * i / n, u1 = b0 + (b1 - b0) * (i + 1) / n;
        B.poly([[a0, ye, u0], [a1, ye, u0], [a1, ye, u1], [a0, ye, u1]], c, { mat: STMAT.concrete });
      }
    }
  };
  stripe(x0, x1, z0, z0 + k, true);
  stripe(x0, x1, z1 - k, z1, true);
  stripe(x0, x0 + k, z0 + k, z1 - k, false);
  stripe(x1 - k, x1, z0 + k, z1 - k, false);
  // Круг посадки: кольцо в середине, по нему садятся «в точку».
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const r = Math.min(x1 - x0, z1 - z0) * 0.32, rw = 1.6, n = 32;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    B.poly([[cx + Math.cos(a) * r, ye, cz + Math.sin(a) * r], [cx + Math.cos(b) * r, ye, cz + Math.sin(b) * r],
      [cx + Math.cos(b) * (r - rw), ye, cz + Math.sin(b) * (r - rw)], [cx + Math.cos(a) * (r - rw), ye, cz + Math.sin(a) * (r - rw)]], PAD_RING);
  }
  // Крест в круге: по нему видно, куда смотрит площадка.
  B.rect([cx, ye, cz], [r * 0.5, 0, 0], [0, 0, 0.8], PAD_RING);
  B.rect([cx, ye, cz], [0.8, 0, 0], [0, 0, r * 0.5], PAD_RING);
  // Огни по углам — янтарные: площадка видна и сверху, и сбоку.
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    B.box([x - 1.2, y, z - 1.2], [x + 1.2, y + 1.2, z + 1.2], AMBER, { glow: 1, noBottom: true });
  }
  // Номер — у края со стороны терминала, читается от терминала наружу и
  // с подлёта сверху (низ цифр — к терминалу).
  const h = Math.min(18, (z1 - z0) * 0.22);
  const wN = digitsWidth(p.n, h);
  const s = p.side;
  // «Вверх» у цифр — от терминала (по x наружу), «вправо» — вдоль ряда.
  const u = [s, 0, 0], rr = [0, 0, -s];
  const edge = s > 0 ? x0 + 6 : x1 - 6;
  const o = [edge, ye + 0.01, cz + s * wN / 2];
  digits(B, p.n, o, rr, u, h, SIGN, 0.25);
}

// --- терминал: проёмы ---------------------------------------------------------------------
//
// Двери и окна — дыры в обеих гранях стены (её толщина — TERM.wall) и
// откосы между ними: стена в шестьдесят сантиметров без откосов видна
// насквозь как лист бумаги. Проём — ровно тот, что у твёрдого шага
// (js/game/stationwalk.js, DOOR): пешеход проходит там, где видит дверь.

const W = TERM.wall;

/**
 * Окна холла в наружную стену терминала (оси станции, м): холл смотрит на
 * свою площадку. Кусками по обе стороны двери, на 1–3.4 м над полом.
 */
function windowsOf(r, doorZ) {
  if (r.kind !== 'gate') return [];
  const y0 = r.lo[1] + 1.0, y1 = r.lo[1] + 3.4;
  const out = [];
  const a = r.lo[2] + 1.2, b = r.hi[2] - 1.2;
  const gap = doorZ === null ? null : [doorZ - DOOR.gate.half - 1.4, doorZ + DOOR.gate.half + 1.4];
  if (gap) {
    if (gap[0] - a > 1.5) out.push([a, gap[0], y0, y1]);
    if (b - gap[1] > 1.5) out.push([gap[1], b, y0, y1]);
  } else if (b - a > 1.5) out.push([a, b, y0, y1]);
  return out;
}

/** Откосы проёма [u0, u1, v0, v1] в стене толщиной [f0, f1] по оси ax (0 — стена x = const). */
function reveals(B, ax, f0, f1, h, c, mat, sill = true) {
  const [u0, u1, v0, v1] = h;
  const P = (f, u, v) => (ax === 0 ? [f, v, u] : [u, v, f]);
  const q = (A, Bp, C, D) => B.poly([A, Bp, C, D], c, { mat });
  q(P(f0, u0, v0), P(f1, u0, v0), P(f1, u0, v1), P(f0, u0, v1));
  q(P(f0, u1, v0), P(f1, u1, v0), P(f1, u1, v1), P(f0, u1, v1));
  q(P(f0, u0, v1), P(f1, u0, v1), P(f1, u1, v1), P(f0, u1, v1));
  if (sill) q(P(f0, u0, v0), P(f1, u0, v0), P(f1, u1, v0), P(f0, u1, v0));
}

/** Переплёт окна: стойки через 1.6 м и рама по краю (в середине толщины стены). */
function mullions(B, ax, f, h) {
  const [u0, u1, v0, v1] = h;
  const n = Math.max(1, Math.round((u1 - u0) / 1.6));
  const bar = (a0, a1, b0, b1) => {
    const lo = ax === 0 ? [f - 0.05, b0, a0] : [a0, b0, f - 0.05];
    const hi = ax === 0 ? [f + 0.05, b1, a1] : [a1, b1, f + 0.05];
    B.box(lo, hi, IN.mullion, { noBottom: true });
  };
  for (let i = 1; i < n; i++) {
    const u = u0 + (u1 - u0) * i / n;
    bar(u - 0.04, u + 0.04, v0, v1);
  }
  bar(u0, u1, v0 + (v1 - v0) * 0.62 - 0.03, v0 + (v1 - v0) * 0.62 + 0.03);
}

/**
 * Порог: пол проёма в толщине стены — рифлёный лист. Без него в двери
 * виден бетон зала под полом помещений.
 */
function sill(B, ax, f0, f1, u, half, y) {
  const P = ax === 0
    ? [[f0, y, u - half], [f1, y, u - half], [f1, y, u + half], [f0, y, u + half]]
    : [[u - half, y, f0], [u + half, y, f0], [u + half, y, f1], [u - half, y, f1]];
  B.poly(P, IN.steel, { mat: STMAT.tread });
}

/** Рама двери: наличник по обе стороны стены, в цвет рам. */
function doorTrim(B, ax, f0, f1, u, half, y0, height) {
  const t = 0.12, d = 0.04;
  for (const [f, s] of [[f0, -1], [f1, 1]]) {
    const fa = f, fb = f + s * d;
    const box = (u0, u1, v0, v1) => {
      const lo = ax === 0 ? [Math.min(fa, fb), v0, u0] : [u0, v0, Math.min(fa, fb)];
      const hi = ax === 0 ? [Math.max(fa, fb), v1, u1] : [u1, v1, Math.max(fa, fb)];
      B.box(lo, hi, IN.frame, { noBottom: true });
    };
    box(u - half - t, u - half, y0, y0 + height + t);
    box(u + half, u + half + t, y0, y0 + height + t);
    box(u - half - t, u + half + t, y0 + height, y0 + height + t);
  }
}

// --- терминал снаружи ------------------------------------------------------------------------

/**
 * Корпус терминала снаружи: стены с дверями выходов и окнами залов
 * ожидания, кровля, над каждым выходом — номер площадки, от выхода к
 * площадке — разметка перрона.
 */
function buildTerminal(B, L, plan) {
  const T = L.terminal;
  const [x0, y0, z0] = T.lo, [x1, y1, z1] = T.hi;
  const holesX = { 1: [], [-1]: [] };
  const holesZ = { 1: [], [-1]: [] };
  for (const d of plan.doors) {
    if (d.edge) continue;
    const h = [d.pos[d.ax === 0 ? 2 : 0] - d.half, d.pos[d.ax === 0 ? 2 : 0] + d.half, y0, y0 + d.height];
    if (d.gate) holesX[Math.sign(d.pos[0])].push(h);
    else if (d.main) holesZ[d.pos[2] > (z0 + z1) / 2 ? 1 : -1].push(h);
  }
  for (const r of plan.rooms) {
    if (r.kind !== 'gate') continue;
    const s = r.lo[0] + r.hi[0] > 0 ? 1 : -1;
    const door = plan.doors.find((d) => d.gate && d.rooms[0] === r.id);
    for (const w of windowsOf(r, door ? door.pos[2] : null)) holesX[s].push(w);
  }
  const P = { mat: STMAT.panels };
  for (const s of [-1, 1]) {
    const x = s > 0 ? x1 : x0;
    B.holed(x, z0, z1, y0, y1, holesX[s], (r) => B.poly([[x, r[2], r[0]], [x, r[2], r[1]], [x, r[3], r[1]], [x, r[3], r[0]]], TERM_WALL, P));
    const z = s > 0 ? z1 : z0;
    B.holed(z, x0, x1, y0, y1, holesZ[s], (r) => B.poly([[r[0], r[2], z], [r[1], r[2], z], [r[1], r[3], z], [r[0], r[3], z]], TERM_WALL, P));
    // Откосы и переплёты проёмов наружной стены.
    const xi = x - s * W;
    for (const h of holesX[s]) {
      const isDoor = h[2] <= y0 + 1e-6;
      reveals(B, 0, Math.min(x, xi), Math.max(x, xi), h, isDoor ? IN.frame : TERM_TRIM, STMAT.tread, !isDoor);
      if (!isDoor) mullions(B, 0, (x + xi) / 2, h);
      else {
        doorTrim(B, 0, Math.min(x, xi), Math.max(x, xi), (h[0] + h[1]) / 2, (h[1] - h[0]) / 2, y0, h[3] - y0);
        sill(B, 0, Math.min(x, xi), Math.max(x, xi), (h[0] + h[1]) / 2, (h[1] - h[0]) / 2, y0 + 0.02);
      }
    }
    const zi = z - s * W;
    for (const h of holesZ[s]) {
      reveals(B, 2, Math.min(z, zi), Math.max(z, zi), h, IN.frame, STMAT.tread, false);
      doorTrim(B, 2, Math.min(z, zi), Math.max(z, zi), (h[0] + h[1]) / 2, (h[1] - h[0]) / 2, y0, h[3] - y0);
      sill(B, 2, Math.min(z, zi), Math.max(z, zi), (h[0] + h[1]) / 2, (h[1] - h[0]) / 2, y0 + 0.02);
    }
  }
  B.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], TERM_TRIM, P);
  // Карниз и цоколь: полосы, по которым видно, что это постройка, а не ящик.
  B.box([x0 - 0.6, y1 - 1.2, z0 - 0.6], [x1 + 0.6, y1 + 0.4, z1 + 0.6], TERM_TRIM, { noBottom: true, mat: STMAT.panels });
  B.box([x0 - 0.3, y0, z0 - 0.3], [x0, y0 + 0.5, z1 + 0.3], TERM_TRIM, { noBottom: true, mat: STMAT.tread });
  B.box([x1, y0, z0 - 0.3], [x1 + 0.3, y0 + 0.5, z1 + 0.3], TERM_TRIM, { noBottom: true, mat: STMAT.tread });
  // Полоса витрин на высоте второго яруса: свет помещений сквозь стекло.
  for (const s of [-1, 1]) {
    const x = (s > 0 ? x1 : x0) + s * 0.05;
    for (let z = z0 + 6; z < z1 - 6; z += 12) {
      B.rect([x, y0 + 8.5, z], [0, 1.3, 0], [0, 0, 5], GLASS, { glow: 0.55 });
    }
  }
  // Кровля: вентиляция и техника — коробками, как на крышах вокзалов.
  // Там, где стоит галерея, — её нет.
  const G = L.gallery;
  for (let z = z0 + 30; z < z1 - 20; z += 70) {
    if (G && z + 8 > G.lo[2] && z - 8 < G.hi[2]) continue;
    B.box([-10, y1 + 0.4, z - 6], [-2, y1 + 3.4, z + 6], WALL_DARK, { noBottom: true, mat: STMAT.tread });
    B.box([4, y1 + 0.4, z - 3], [12, y1 + 2.2, z + 3], RIB, { noBottom: true, mat: STMAT.tread });
  }
  // Выходы: козырёк над дверью, номер площадки над козырьком, огни по
  // сторонам и разметка перрона до площадки.
  for (const d of plan.doors) {
    if (!d.gate) continue;
    const p = L.pads.find((q) => q.n === d.gate);
    const s = p.side, x = s > 0 ? x1 : x0, z = d.pos[2];
    B.box([Math.min(x, x + s * 3), y0 + 3.4, z - 3], [Math.max(x, x + s * 3), y0 + 3.7, z + 3], TERM_TRIM, { mat: STMAT.tread });
    // Табло с номером — светится: выход ищут глазами с перрона.
    const h = 2.4, wN = digitsWidth(p.n, h);
    B.rect([x + s * 0.08, y0 + 5.8, z], [0, 1.9, 0], [0, 0, wN / 2 + 1.2], DARK);
    // «Вправо» для того, кто смотрит на стену с перрона: up × fwd.
    digits(B, p.n, [x + s * 0.15, y0 + 4.6, z - s * wN / 2], [0, 0, s], [0, 1, 0], h, AMBER, 1);
    for (const dz of [-DOOR.gate.half - 0.6, DOOR.gate.half + 0.6]) {
      B.rect([x + s * 0.06, y0 + 1.1, z + dz], [0, 0.9, 0], [0, 0, 0.12], GREEN, { glow: 1 });
    }
    // Дорожка: две жёлтые линии от двери до кромки площадки.
    const xa = x, xb = s > 0 ? p.lo[0] : p.hi[0];
    for (const dz of [-2.4, 2.4]) {
      B.poly([[xa, y0 + 0.04, z + dz - 0.2], [xb, y0 + 0.04, z + dz - 0.2], [xb, y0 + 0.04, z + dz + 0.2], [xa, y0 + 0.04, z + dz + 0.2]], YELLOW);
    }
  }
}

// --- галерея снаружи -------------------------------------------------------------------------

/**
 * Окна площади галереи (м): на оба ряда площадок — по длинным стенам,
 * от пола почти до потолка, в границах площади (у торцов — помещения).
 * [u0, u1, v0, v1]: u — вдоль z, v — высота.
 */
function galleryWindows(L, plan) {
  const G = L.gallery, P = plan.roomById.concourse;
  if (!G || !P) return [];
  return [[P.lo[2] + 0.8, P.hi[2] - 0.8, G.floor + 0.7, G.floor + GAL.h - 0.9]];
}

/**
 * Галерея снаружи: стены с окнами на площадки, кровля с карнизом и
 * откосы окон. Изнутри её рисует секция 'concourse' (sectionMesh).
 */
function buildGallery(B, L, plan) {
  const G = L.gallery;
  if (!G) return;
  // Кровля — над потолком площади, цоколь — под её полом: в одной плоскости
  // с ними они перебивали бы их (потолок выходил тёмными панелями кровли,
  // пол — рифлёным листом цоколя).
  const [x0, y0, z0] = G.lo, [x1, , z1] = G.hi, GF = G.floor, y1 = G.hi[1] + 0.3;
  const P = { mat: STMAT.panels };
  const win = galleryWindows(L, plan);
  for (const s of [-1, 1]) {
    const x = s > 0 ? x1 : x0;
    B.holed(x, z0, z1, y0, y1, win, (r) => B.poly([[x, r[2], r[0]], [x, r[2], r[1]], [x, r[3], r[1]], [x, r[3], r[0]]], TERM_WALL, P));
    const z = s > 0 ? z1 : z0;
    B.poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], TERM_WALL, P);
    const xi = x - s * W;
    for (const h of win) {
      reveals(B, 0, Math.min(x, xi), Math.max(x, xi), h, TERM_TRIM, STMAT.tread, true);
      mullions(B, 0, (x + xi) / 2, h);
    }
  }
  B.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], TERM_TRIM, P);
  B.box([x0 - 0.4, y1 - 0.8, z0 - 0.4], [x1 + 0.4, y1 + 0.3, z1 + 0.4], TERM_TRIM, { noBottom: true, mat: STMAT.panels });
  B.box([x0 - 0.2, y0, z0 - 0.2], [x1 + 0.2, GF - 0.05, z1 + 0.2], TERM_TRIM, { noBottom: true, mat: STMAT.tread });
  // Полоса света под карнизом: галерею видно с перрона и с подлёта.
  for (const s of [-1, 1]) {
    const x = (s > 0 ? x1 : x0) + s * 0.05;
    B.rect([x, y1 - 1.2, (z0 + z1) / 2], [0, 0.12, 0], [0, 0, (z1 - z0) / 2 - 1], LAMP, { glow: 0.8 });
  }
}

// --- терминал изнутри ---------------------------------------------------------------------

/** Пол, потолок и стены помещения — по его коробке. Материалы — по виду. */
function roomLook(r) {
  switch (r.kind) {
    case 'concourse': return { floor: [STMAT.terrazzo, IN.terrazzo], wall: [STMAT.wall, IN.wall] };
    case 'lift': return { floor: [STMAT.tread, IN.steel], wall: [STMAT.panels, IN.wallCool] };
    case 'gate': return { floor: [STMAT.rubber, IN.rubber], wall: [STMAT.wall, IN.wallCool] };
    case 'bar': return { floor: [STMAT.parquet, IN.parquet], wall: [STMAT.wood, IN.wood] };
    case 'med': return { floor: [STMAT.tiles, IN.white], wall: [STMAT.wall, IN.white] };
    case 'hangar': return { floor: [STMAT.tiles, IN.tiles], wall: [STMAT.panels, IN.wallCool] };
    case 'office': return { floor: [STMAT.tiles, IN.tiles], wall: [STMAT.wall, IN.wallWarm] };
    default: return { floor: [STMAT.tiles, IN.tiles], wall: [STMAT.wall, IN.wall] };
  }
}

/**
 * Стена помещения с проёмами — гранью внутрь. ax — ось нормали стены
 * (0 — стена x = const), at — её плоскость, u — отрезок вдоль, holes —
 * [u0, u1, v0, v1].
 */
function roomWall(B, ax, at, u0, u1, y0, y1, holes, look) {
  B.holed(at, u0, u1, y0, y1, holes, (r) => {
    const P = ax === 0
      ? [[at, r[2], r[0]], [at, r[2], r[1]], [at, r[3], r[1]], [at, r[3], r[0]]]
      : [[r[0], r[2], at], [r[1], r[2], at], [r[1], r[3], at], [r[0], r[3], at]];
    B.poly(P, look[1], { mat: look[0] });
  });
  // Плинтус — тёмной полосой: стена встаёт на пол, а не висит над ним.
  const solid = [];
  B.holed(at, u0, u1, y0, y0 + 0.1, holes.map((h) => [h[0], h[1], y0 - 1, y0 + 1]), (r) => solid.push(r));
  for (const r of solid) {
    const lo = ax === 0 ? [at - 0.015, y0, r[0]] : [r[0], y0, at - 0.015];
    const hi = ax === 0 ? [at + 0.015, y0 + 0.1, r[1]] : [r[1], y0 + 0.1, at + 0.015];
    B.box(lo, hi, IN.frame, { noBottom: true });
  }
}

/** Светильники потолка: панели сеткой (у площади галереи — полосы поперёк). */
function ceilingLights(B, r, y) {
  const x0 = r.lo[0], x1 = r.hi[0], z0 = r.lo[2], z1 = r.hi[2];
  if (r.kind === 'concourse') {
    for (let z = z0 + 3; z < z1 - 2; z += 6) B.rect([(x0 + x1) / 2, y - 0.02, z], [(x1 - x0) / 2 - 1.5, 0, 0], [0, 0, 0.25], LAMP, { glow: 1 });
    return;
  }
  if (r.kind === 'lift') {
    B.rect([(x0 + x1) / 2, y - 0.02, (z0 + z1) / 2], [0.7, 0, 0], [0, 0, 0.7], LAMP, { glow: 1 });
    return;
  }
  const nx = Math.max(1, Math.round((x1 - x0) / 4)), nz = Math.max(1, Math.round((z1 - z0) / 4));
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const x = x0 + (x1 - x0) * (i + 0.5) / nx, z = z0 + (z1 - z0) * (k + 0.5) / nz;
      B.rect([x, y - 0.02, z], [0.6, 0, 0], [0, 0, 0.6], LAMP, { glow: r.kind === 'bar' ? 0.7 : 1 });
    }
  }
}

/** Мебель плана (js/game/stationwalk.js, roomProps) — по виду, в тех же коробках. */
function buildProp(B, b, room) {
  const [x0, y0, z0] = b.lo, [x1, y1, z1] = b.hi;
  const L = { mat: STMAT.leather }, S = { mat: STMAT.tread };
  switch (b.kind) {
    case 'seats': {
      // Ряд кресел: рама, подушки поштучно, спинка по середине ряда (ряд
      // двусторонний — на обе стороны).
      const along = x1 - x0 > z1 - z0 ? 0 : 2;
      B.box([x0, y0, z0], [x1, y0 + 0.3, z1], IN.steel, S);
      const len = along === 0 ? x1 - x0 : z1 - z0, n = Math.max(1, Math.floor(len / 0.62));
      for (let i = 0; i < n; i++) {
        const a = (along === 0 ? x0 : z0) + len * i / n + 0.03, c = (along === 0 ? x0 : z0) + len * (i + 1) / n - 0.03;
        if (along === 0) B.box([a, y0 + 0.3, z0], [c, y1, z1], IN.leather, L);
        else B.box([x0, y0 + 0.3, a], [x1, y1, c], IN.leather, L);
      }
      if (along === 0) B.box([x0, y1, (z0 + z1) / 2 - 0.05], [x1, y1 + 0.42, (z0 + z1) / 2 + 0.05], IN.leather, L);
      else B.box([(x0 + x1) / 2 - 0.05, y1, z0], [(x0 + x1) / 2 + 0.05, y1 + 0.42, z1], IN.leather, L);
      break;
    }
    case 'counter':
    case 'desk': {
      const bar = room && room.kind === 'bar';
      B.box([x0, y0, z0], [x1, y1 - 0.05, z1], bar ? IN.wood : IN.steel, { mat: bar ? STMAT.wood : STMAT.panels });
      B.box([x0 - 0.05, y1 - 0.05, z0 - 0.05], [x1 + 0.05, y1, z1 + 0.05], IN.counterTop, { mat: STMAT.terrazzo });
      break;
    }
    case 'stool':
      B.box([x0 + 0.12, y0, z0 + 0.12], [x1 - 0.12, y1 - 0.08, z1 - 0.12], IN.steel, S);
      B.box([x0, y1 - 0.08, z0], [x1, y1, z1], IN.leatherBar, L);
      break;
    case 'table':
      B.box([(x0 + x1) / 2 - 0.06, y0, (z0 + z1) / 2 - 0.06], [(x0 + x1) / 2 + 0.06, y1 - 0.04, (z0 + z1) / 2 + 0.06], IN.steel, S);
      B.box([x0, y1 - 0.04, z0], [x1, y1, z1], room && room.kind === 'bar' ? IN.wood : IN.counterTop,
        { mat: room && room.kind === 'bar' ? STMAT.wood : STMAT.terrazzo });
      break;
    case 'kiosk': {
      // Пульт ангарной службы: стойка рифлёного листа и экран — светится
      // оранжевым, как табличка службы над дверью. Экран — внутрь
      // помещения (b.face): к нему подходят, войдя из галереи.
      B.box([x0, y0, z0], [x1, y1, z1], IN.steel, S);
      const f = b.face || [1, 0, 0], c = [(x0 + x1) / 2, y1 - 0.35, (z0 + z1) / 2];
      if (f[0]) B.rect([f[0] > 0 ? x1 + 0.01 : x0 - 0.01, c[1], c[2]], [0, 0.22, 0], [0, 0, 0.3], KIND_SIGN.hangar, { glow: 1 });
      else B.rect([c[0], c[1], f[2] > 0 ? z1 + 0.01 : z0 - 0.01], [0, 0.22, 0], [0.3, 0, 0], KIND_SIGN.hangar, { glow: 1 });
      break;
    }
    case 'bed':
      B.box([x0, y0, z0], [x1, y0 + 0.45, z1], IN.steel, S);
      B.box([x0 + 0.03, y0 + 0.45, z0 + 0.03], [x1 - 0.03, y1, z1 - 0.03], IN.white);
      break;
    case 'shelf': {
      B.box([x0, y0, z0], [x1, y1, z1], IN.steel, S);
      // Товар на полках — коробками разных цветов: магазин пуст, но не голый.
      const along = x1 - x0 > z1 - z0 ? 0 : 2;
      const len = along === 0 ? x1 - x0 : z1 - z0;
      const cols = [[180, 60, 50], [60, 120, 180], [200, 170, 60], [80, 150, 90], [190, 190, 190]];
      for (let lvl = 0; lvl < 4; lvl++) {
        const yy = y0 + 0.15 + lvl * 0.5;
        for (let i = 0; i * 0.5 < len - 0.4; i++) {
          const c = cols[(((i * 7 + lvl * 3 + Math.round(x0 + z0)) % cols.length) + cols.length) % cols.length];
          const a = (along === 0 ? x0 : z0) + 0.2 + i * 0.5;
          const hgt = 0.22 + ((i + lvl) % 3) * 0.06;
          if (along === 0) B.box([a, yy, z0 - 0.02], [a + 0.36, yy + hgt, z1 + 0.02], c);
          else B.box([x0 - 0.02, yy, a], [x1 + 0.02, yy + hgt, a + 0.36], c);
        }
      }
      break;
    }
    default:
      B.box(b.lo, b.hi, IN.steel, S);
  }
}

/**
 * Табличка над дверью помещения — со стороны, откуда её читают (from):
 * цвет вида помещения, у холла — номер площадки. Над дверью кабины —
 * полоса лифта.
 */
function doorSign(B, d, room, from) {
  const c = d.lift ? KIND_SIGN.lift : (KIND_SIGN[room.kind] || KIND_SIGN.shop);
  const ax = d.ax, u = ax === 0 ? 2 : 0;
  // С какой стороны стены читают: к середине помещения from.
  const mid = (from.lo[ax] + from.hi[ax]) / 2;
  const s = mid > d.pos[ax] ? 1 : -1;
  const at = d.pos[ax] + s * (W / 2 + 0.06);
  const y = d.pos[1] + d.height + 0.45;
  const P = (a, v, uu) => { const p = [0, v, 0]; p[ax] = a; p[u] = uu; return p; };
  const lo = P(Math.min(at, at + s * 0.08), y - 0.3, d.pos[u] - 1.2), hi = P(Math.max(at, at + s * 0.08), y + 0.3, d.pos[u] + 1.2);
  B.box(lo, hi, DARK);
  const ua = [0, 0, 0]; ua[u] = 1.15;
  B.rect(P(at + s * 0.09, y + 0.2, d.pos[u]), [0, 0.05, 0], ua, c, { glow: 1 });
  if (room.kind === 'gate' && room.pad) {
    const h = 0.36, wN = digitsWidth(room.pad, h);
    // «Вправо» для читающего: у стены, к которой он стоит лицом.
    const r = [0, 0, 0]; r[u] = ax === 0 ? -s : s;
    digits(B, room.pad, P(at + s * 0.1, y - 0.24, d.pos[u] - r[u] * wN / 2), r, [0, 1, 0], h, c, 1);
  } else if (room.kind === 'med') {
    const a = [0, 0, 0]; a[u] = 0.2;
    const b2 = [0, 0, 0]; b2[u] = 0.07;
    B.rect(P(at + s * 0.1, y - 0.05, d.pos[u]), [0, 0.07, 0], a, c, { glow: 1 });
    B.rect(P(at + s * 0.1, y - 0.05, d.pos[u]), [0, 0.2, 0], b2, c, { glow: 1 });
  }
}

/**
 * Стены помещения изнутри — по граням его коробки, с проёмами дверей и
 * окон этой грани. Окна: у холла — в наружной стене, у площади галереи —
 * в длинных стенах на площадки.
 */
function roomWalls(B, r, plan, L, look) {
  const G = L.gallery;
  for (const ax of [0, 2]) {
    const u = ax === 0 ? 2 : 0;
    for (const side of [-1, 1]) {
      const at = side < 0 ? r.lo[ax] : r.hi[ax];
      const wallMid = at + side * W / 2;
      const holes = plan.doors
        .filter((d) => !d.edge && d.ax === ax && Math.abs(d.pos[ax] - wallMid) < 0.02
          && d.pos[u] > r.lo[u] - 0.01 && d.pos[u] < r.hi[u] + 0.01 && Math.abs(d.pos[1] - r.lo[1]) < 0.5)
        .map((d) => [d.pos[u] - d.half, d.pos[u] + d.half, r.lo[1], r.lo[1] + d.height]);
      if (r.kind === 'gate' && ax === 0 && Math.abs(Math.abs(at) - (TERM.hw - W)) < 0.02) {
        const gate = plan.doors.find((d) => d.gate && d.rooms[0] === r.id);
        holes.push(...windowsOf(r, gate ? gate.pos[2] : null));
      }
      if (r.kind === 'concourse' && ax === 0 && G) holes.push(...galleryWindows(L, plan));
      roomWall(B, ax, at, r.lo[u], r.hi[u], r.lo[1], r.hi[1], holes, look.wall);
    }
  }
}

/** Пульт лифта в кабине: щиток и светящийся экран — внутрь кабины. */
function liftPanel(B, stop, r) {
  const p = stop.panel;
  const ax = Math.abs(p[0] - r.lo[0]) < 0.1 || Math.abs(p[0] - r.hi[0]) < 0.1 ? 0 : 2;
  const u = ax === 0 ? 2 : 0;
  const inward = Math.abs(p[ax] - r.lo[ax]) < Math.abs(p[ax] - r.hi[ax]) ? 1 : -1;
  const lo = p.slice(), hi = p.slice();
  lo[ax] = p[ax] - inward * 0.05; hi[ax] = p[ax] + inward * 0.01;
  lo[u] -= 0.13; hi[u] += 0.13; lo[1] -= 0.22; hi[1] += 0.22;
  B.box([Math.min(lo[0], hi[0]), lo[1], Math.min(lo[2], hi[2])], [Math.max(lo[0], hi[0]), hi[1], Math.max(lo[2], hi[2])], IN.steel, { mat: STMAT.tread });
  const c = p.slice(); c[ax] = p[ax] + inward * 0.02;
  const a = [0, 0, 0]; a[u] = 0.09;
  B.rect(c, a, [0, 0.16, 0], KIND_SIGN.lift, { glow: 1 });
}

/**
 * Секция изнутри (м -> км): полы, потолки со светильниками, стены с
 * проёмами дверей и окон, рамы и таблички, мебель, кабина лифта с пультом.
 * Коробки — плана шага (js/game/stationwalk.js): грань стены — ровно там,
 * где в неё упирается пешеход.
 */
function buildSection(B, L, plan, id) {
  const rooms = plan.rooms.filter((r) => r.section === id && !r.open);
  const lift = plan.lifts[0];
  for (const r of rooms) {
    const look = roomLook(r);
    const [x0, , z0] = r.lo, [x1, y1, z1] = r.hi;
    const yF = r.lo[1] + 0.02;                // пол помещений — над бетоном зала (без мерцания)
    B.poly([[x0, yF, z0], [x1, yF, z0], [x1, yF, z1], [x0, yF, z1]], look.floor[1], { mat: look.floor[0] });
    B.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], IN.ceil, { mat: STMAT.wall });
    ceilingLights(B, r, y1);
    roomWalls(B, r, plan, L, look);
    if (r.kind === 'lift') {
      const stop = lift && lift.stops.find((q) => q.room === r.id);
      if (stop) liftPanel(B, stop, r);
    }
  }
  // Проёмы дверей секции: откосы, рамы, пороги, таблички.
  const ids = new Set(rooms.map((r) => r.id));
  for (const d of plan.doors) {
    if (d.edge || d.gate || !(ids.has(d.rooms[0]) || ids.has(d.rooms[1]))) continue;
    const u = d.ax === 0 ? 2 : 0;
    const f0 = d.pos[d.ax] - W / 2, f1 = d.pos[d.ax] + W / 2, y0 = d.pos[1];
    reveals(B, d.ax, f0, f1, [d.pos[u] - d.half, d.pos[u] + d.half, y0, y0 + d.height], IN.frame, STMAT.tread, false);
    doorTrim(B, d.ax, f0, f1, d.pos[u], d.half, y0, d.height);
    sill(B, d.ax, f0, f1, d.pos[u], d.half, y0 + 0.02);
    // Табличка — со стороны, откуда в дверь входят: из площади в
    // помещение, из холла — в кабину.
    const inner = plan.roomById[d.rooms[0]], outer = plan.roomById[d.rooms[1]];
    doorSign(B, d, d.lift ? outer : inner, outer);
  }
  for (const b of plan.props) if (ids.has(b.room)) buildProp(B, b, plan.roomById[b.room]);
}

/**
 * Внутренность секции станции (км, оси станции): 'gateN' — холл площадки
 * с кабиной лифта, 'concourse' — галерея с помещениями и своей кабиной.
 * Собирается один раз, при первом показе.
 */
export function sectionMesh(L, id) {
  const cache = L._sections || (L._sections = new Map());
  if (cache.has(id)) return cache.get(id);
  const B = new Build();
  buildSection(B, L, stationPlan(L), id);
  const m = B.mesh();
  cache.set(id, m);
  return m;
}

/** Секции станции: холлы площадок и галерея (их и рисует сцена изнутри). */
export const sectionIds = (L) => [...L.pads.map((p) => 'gate' + p.n), 'concourse'];

/**
 * Створка двери кабины (км): коробка шириной в половину проёма, по оси
 * вдоль стены, от пола. ax — ось стены двери (0 — стена x = const). Сцена
 * рисует две створки на дверь и раздвигает их по открытию (door.open).
 */
export function liftLeaf(ax) {
  const key = '_leaf' + ax;
  if (liftLeaf[key]) return liftLeaf[key];
  const B = new Build();
  const hw = DOOR.lift.half / 2, t = 0.03, h = DOOR.lift.height;
  const lo = ax === 0 ? [-t, 0, -hw] : [-hw, 0, -t], hi = ax === 0 ? [t, h, hw] : [hw, h, t];
  B.box(lo, hi, IN.steel, { mat: STMAT.tread });
  liftLeaf[key] = B.mesh();
  return liftLeaf[key];
}

/**
 * Сетка зала станции (км, оси станции): тоннель, зал, площадки, терминал
 * снаружи и изнутри. Сетку корпуса станции (js/models/stations.js) она
 * дополняет, а не заменяет: снаружи станция та же.
 */
export function hallMesh(L) {
  const B = new Build();
  const plan = stationPlan(L);
  buildTunnel(B, L);
  buildHall(B, L);
  for (const p of L.pads) buildPad(B, p);
  buildTerminal(B, L, plan);
  buildGallery(B, L, plan);
  return B.mesh();
}

export { PAD, TERM };
