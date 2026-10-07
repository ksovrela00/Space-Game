// Зал станции: тоннель за щелью, зал с тяжестью, площадки и корпус
// терминала — сеткой мира (км, оси станции).
//
// Планировку даёт js/game/stationplan.js: здесь только то, как она
// выглядит. Всё, обо что можно удариться и на что сесть (стены зала,
// площадки, терминал), лежит ровно там, где его считает полёт
// (js/game/berth.js), — из тех же чисел, а не на глаз.
//
// СВЕТ. Солнца в зале нет: его закрывает корпус станции, и шейдер сеток
// гасит его внутри коробки зала (js/gl/shaders.js, HALL_GLSL), а светят
// потолочные ряды — светом сверху и рассеянным. Светящиеся полосы здесь —
// сами светильники: по ним видно, откуда этот свет, а в тени от солнца
// снаружи зал не проваливается в черноту.
//
// Цвета — не «космический серый». Настоящие ангары светлые: бетон и
// крашеная сталь, жёлтая разметка, зелёные и красные огни подхода, и в
// таком зале корабль виден, а не тонет.

import { v3 } from '../core/vec3.js';
import { makeMesh } from './geometry.js';
import { PAD, TERM } from '../game/stationplan.js';

const KM = 1e-3;

// Палитра зала.
const FLOOR_A = [148, 150, 152];      // бетон перрона
const FLOOR_B = [138, 140, 143];
const WALL = [118, 124, 134];         // крашеная сталь стен
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

/** Набор граней: квадраты и коробки в метрах, на выходе — сетка в километрах. */
class Build {
  constructor() { this.verts = []; this.defs = []; }

  /** Многоугольник по точкам (м). */
  poly(P, c, opts = {}) {
    const base = this.verts.length;
    for (const p of P) this.verts.push(v3(p[0] * KM, p[1] * KM, p[2] * KM));
    this.defs.push({ v: P.map((_, i) => base + i), c, twoSided: opts.two !== false, emissive: opts.glow || 0 });
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
    const q = (P, cc) => this.poly(P, cc, { two: false, glow: opts.glow });
    q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c);
    q([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], c);
    q([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], c);
    q([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], c);
    q([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], top);
    if (!opts.noBottom) q([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], c);
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
  // Губа рамы: от щели (176 × 96) к сечению тоннеля.
  const sw = 88, sh = 48;
  B.poly([[-hw, -hh, z1], [hw, -hh, z1], [hw, -sh, z1], [-hw, -sh, z1]], TUNNEL);
  B.poly([[-hw, sh, z1], [hw, sh, z1], [hw, hh, z1], [-hw, hh, z1]], TUNNEL);
  B.poly([[-hw, -sh, z1], [-sw, -sh, z1], [-sw, sh, z1], [-hw, sh, z1]], TUNNEL);
  B.poly([[sw, -sh, z1], [hw, -sh, z1], [hw, sh, z1], [sw, sh, z1]], TUNNEL);
  // Стены — кусками по сорок метров, через один чуть темнее: иначе длинная
  // гладкая труба не даёт глазу ни одной метки скорости.
  const n = Math.max(1, Math.round((z1 - z0) / 40));
  for (let i = 0; i < n; i++) {
    const a = z0 + (z1 - z0) * i / n, b = z0 + (z1 - z0) * (i + 1) / n;
    const c = i % 2 ? TUNNEL : WALL_DARK;
    B.poly([[-hw, -hh, a], [hw, -hh, a], [hw, -hh, b], [-hw, -hh, b]], c);
    B.poly([[-hw, hh, a], [hw, hh, a], [hw, hh, b], [-hw, hh, b]], c);
    B.poly([[-hw, -hh, a], [-hw, hh, a], [-hw, hh, b], [-hw, -hh, b]], c);
    B.poly([[hw, -hh, a], [hw, hh, a], [hw, hh, b], [hw, -hh, b]], c);
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
  // Пол: плиты по сорок метров, через одну чуть темнее — пол из бетона, а
  // не лист бумаги: по швам видно и масштаб, и как быстро он приближается.
  const tile = 40;
  const nx = Math.round((hi[0] - lo[0]) / tile), nz = Math.round((hi[2] - lo[2]) / tile);
  const dx = (hi[0] - lo[0]) / nx, dz = (hi[2] - lo[2]) / nz;
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const x0 = lo[0] + i * dx, z0 = lo[2] + k * dz;
      B.poly([[x0, lo[1], z0], [x0 + dx, lo[1], z0], [x0 + dx, lo[1], z0 + dz], [x0, lo[1], z0 + dz]],
        (i + k) % 2 ? FLOOR_A : FLOOR_B);
    }
  }
  // Потолок и ряды светильников вдоль зала.
  B.poly([[lo[0], hi[1], lo[2]], [hi[0], hi[1], lo[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]]], CEIL);
  for (let x = lo[0] + 60; x < hi[0] - 30; x += 80) {
    B.rect([x, hi[1] - 0.5, (lo[2] + hi[2]) / 2], [4, 0, 0], [0, 0, (hi[2] - lo[2]) / 2 - 30], LAMP, { glow: 1 });
  }
  // Стены: задняя и боковые целиком, передняя — с проёмом тоннеля.
  const H = hi[1] - lo[1];
  B.poly([[lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], hi[1], lo[2]], [lo[0], hi[1], lo[2]]], WALL);
  B.poly([[lo[0], lo[1], lo[2]], [lo[0], lo[1], hi[2]], [lo[0], hi[1], hi[2]], [lo[0], hi[1], lo[2]]], WALL);
  B.poly([[hi[0], lo[1], lo[2]], [hi[0], lo[1], hi[2]], [hi[0], hi[1], hi[2]], [hi[0], hi[1], lo[2]]], WALL);
  B.holed(hi[2], lo[0], hi[0], lo[1], hi[1], [[-t.hw, t.hw, -t.hh, t.hh]],
    (r) => B.poly([[r[0], r[2], hi[2]], [r[1], r[2], hi[2]], [r[1], r[3], hi[2]], [r[0], r[3], hi[2]]], WALL));
  // Рёбра по стенам — через шестьдесят метров, и пояс на трети высоты:
  // гладкая стена в полкилометра читается картоном.
  const rib = (x0, z0, x1, z1) => B.box([Math.min(x0, x1), lo[1], Math.min(z0, z1)], [Math.max(x0, x1), hi[1], Math.max(z0, z1)], RIB);
  for (let z = lo[2] + 60; z < hi[2] - 20; z += 60) {
    rib(lo[0], z - 2.5, lo[0] + 4, z + 2.5);
    rib(hi[0] - 4, z - 2.5, hi[0], z + 2.5);
  }
  for (let x = lo[0] + 60; x < hi[0] - 20; x += 60) {
    rib(x - 2.5, lo[2], x + 2.5, lo[2] + 4);
    if (Math.abs(x) > t.hw + 6) rib(x - 2.5, hi[2] - 4, x + 2.5, hi[2]);
  }
  const belt = lo[1] + H / 3;
  B.box([lo[0], belt, lo[2]], [lo[0] + 2, belt + 3, hi[2]], WALL_DARK);
  B.box([hi[0] - 2, belt, lo[2]], [hi[0], belt + 3, hi[2]], WALL_DARK);
  B.box([lo[0], belt, lo[2]], [hi[0], belt + 3, lo[2] + 2], WALL_DARK);
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
  B.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], PAD_C);
  // Кромка: полосы по два метра, жёлтые через чёрную.
  const k = 2, ye = y + 0.03;
  const stripe = (a0, a1, b0, b1, alongX) => {
    const len = alongX ? a1 - a0 : b1 - b0;
    const n = Math.max(2, Math.round(len / 6));
    for (let i = 0; i < n; i++) {
      const c = i % 2 ? DARK : YELLOW;
      if (alongX) {
        const u0 = a0 + (a1 - a0) * i / n, u1 = a0 + (a1 - a0) * (i + 1) / n;
        B.poly([[u0, ye, b0], [u1, ye, b0], [u1, ye, b1], [u0, ye, b1]], c);
      } else {
        const u0 = b0 + (b1 - b0) * i / n, u1 = b0 + (b1 - b0) * (i + 1) / n;
        B.poly([[a0, ye, u0], [a1, ye, u0], [a1, ye, u1], [a0, ye, u1]], c);
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

// --- терминал -------------------------------------------------------------------------------

/**
 * Корпус терминала снаружи: стены с дверями выходов, кровля, полосы
 * витрин, над каждым выходом — номер площадки, от выхода к площадке —
 * разметка перрона. Помещения внутри рисует проход кабины по той же
 * планировке (js/models/interior.station.js): двери стоят в проёмах этих
 * стен, ровно там, где их считает ходьба.
 */
function buildTerminal(B, L) {
  const T = L.terminal;
  const [x0, y0, z0] = T.lo, [x1, y1, z1] = T.hi;
  // Проёмы дверей в наружных стенах — по планировке (двери на перрон).
  const doorHalf = 0.567 + 0.25, doorTop = 1.965 + 0.25;
  const holesX = { 1: [], [-1]: [] };
  const holesZ = { 1: [], [-1]: [] };
  for (const d of L.doors) {
    if (d.gate) {
      const p = L.pads.find((q) => q.n === d.gate);
      holesX[p.side].push([d.c - doorHalf, d.c + doorHalf, y0, y0 + doorTop]);
    } else if (d.main) {
      holesZ[d.b === 'apronF' ? 1 : -1].push([d.c - doorHalf, d.c + doorHalf, y0, y0 + doorTop]);
    }
  }
  for (const s of [-1, 1]) {
    const x = s > 0 ? x1 : x0;
    B.holed(x, z0, z1, y0, y1, holesX[s], (r) => B.poly([[x, r[2], r[0]], [x, r[2], r[1]], [x, r[3], r[1]], [x, r[3], r[0]]], TERM_WALL));
    const z = s > 0 ? z1 : z0;
    B.holed(z, x0, x1, y0, y1, holesZ[s], (r) => B.poly([[r[0], r[2], z], [r[1], r[2], z], [r[1], r[3], z], [r[0], r[3], z]], TERM_WALL));
  }
  B.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], TERM_TRIM);
  // Карниз и цоколь: полосы, по которым видно, что это постройка, а не ящик.
  B.box([x0 - 0.6, y1 - 1.2, z0 - 0.6], [x1 + 0.6, y1 + 0.4, z1 + 0.6], TERM_TRIM, { noBottom: true });
  B.box([x0 - 0.3, y0, z0 - 0.3], [x0, y0 + 0.5, z1 + 0.3], TERM_TRIM, { noBottom: true });
  B.box([x1, y0, z0 - 0.3], [x1 + 0.3, y0 + 0.5, z1 + 0.3], TERM_TRIM, { noBottom: true });
  // Полоса витрин на высоте второго яруса: свет помещений сквозь стекло.
  for (const s of [-1, 1]) {
    const x = (s > 0 ? x1 : x0) + s * 0.05;
    for (let z = z0 + 6; z < z1 - 6; z += 12) {
      B.rect([x, y0 + 8.5, z], [0, 1.3, 0], [0, 0, 5], GLASS, { glow: 0.55 });
    }
  }
  // Кровля: вентиляция и техника — коробками, как на крышах вокзалов.
  for (let z = z0 + 30; z < z1 - 20; z += 70) {
    B.box([-10, y1 + 0.4, z - 6], [-2, y1 + 3.4, z + 6], WALL_DARK, { noBottom: true });
    B.box([4, y1 + 0.4, z - 3], [12, y1 + 2.2, z + 3], RIB, { noBottom: true });
  }
  // Выходы: козырёк над дверью, номер площадки над козырьком, огни по
  // сторонам и разметка перрона до площадки.
  for (const d of L.doors) {
    if (!d.gate) continue;
    const p = L.pads.find((q) => q.n === d.gate);
    const s = p.side, x = s > 0 ? x1 : x0, z = d.c;
    B.box([Math.min(x, x + s * 3), y0 + 3.2, z - 3], [Math.max(x, x + s * 3), y0 + 3.5, z + 3], TERM_TRIM);
    // Табло с номером — светится: выход ищут глазами с перрона.
    const h = 2.4, wN = digitsWidth(p.n, h);
    B.rect([x + s * 0.08, y0 + 5.6, z], [0, 1.9, 0], [0, 0, wN / 2 + 1.2], DARK);
    // «Вправо» для того, кто смотрит на стену с перрона: up × fwd.
    digits(B, p.n, [x + s * 0.15, y0 + 4.4, z - s * wN / 2], [0, 0, s], [0, 1, 0], h, AMBER, 1);
    for (const dz of [-1.6, 1.6]) {
      B.rect([x + s * 0.06, y0 + 1.1, z + dz], [0, 0.9, 0], [0, 0, 0.12], GREEN, { glow: 1 });
    }
    // Дорожка: две жёлтые линии от двери до кромки площадки.
    const xa = x, xb = s > 0 ? p.lo[0] : p.hi[0];
    for (const dz of [-2.4, 2.4]) {
      B.poly([[xa, y0 + 0.04, z + dz - 0.2], [xb, y0 + 0.04, z + dz - 0.2], [xb, y0 + 0.04, z + dz + 0.2], [xa, y0 + 0.04, z + dz + 0.2]], YELLOW);
    }
  }
  // Главные входы по торцам: козырёк и огни.
  for (const d of L.doors) {
    if (!d.main) continue;
    const s = d.b === 'apronF' ? 1 : -1, z = s > 0 ? z1 : z0;
    B.box([-5, y0 + 3.2, Math.min(z, z + s * 4)], [5, y0 + 3.5, Math.max(z, z + s * 4)], TERM_TRIM);
    B.rect([0, y0 + 4.6, z + s * 0.08], [4.5, 0, 0], [0, 0.6, 0], LAMP, { glow: 1 });
  }
}

/**
 * Сетка зала станции (км, оси станции): тоннель, зал, площадки, терминал.
 * Сетку корпуса станции (js/models/stations.js) она дополняет, а не
 * заменяет: снаружи станция та же.
 */
export function hallMesh(L) {
  const B = new Build();
  buildTunnel(B, L);
  buildHall(B, L);
  for (const p of L.pads) buildPad(B, p);
  buildTerminal(B, L);
  return B.mesh();
}

export { PAD, TERM };
