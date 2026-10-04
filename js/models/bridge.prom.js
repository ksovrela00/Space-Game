// Мостик «Прометея»: посты экипажа, штурманский стол, потолок и свет —
// всё, кроме поста командира (его рисует проход кабины,
// js/models/cockpit.prom.js) и стен с окнами (сборщик помещений,
// js/models/interior.js).
//
// ЗАЧЕМ ОТДЕЛЬНО. Мостик обставлялся тем же, чем каюты: письменные столы
// пака, компьютеры на них и офисные кресла на крестовине. В зале 24 × 15 м
// под пятиметровым потолком это читалось конторой. Боевой корабль
// обставлен не мебелью, а постами: пульт — это тумба с наклонной панелью
// экранов, кресло — на колонне, привинченной к палубе, над головой —
// силовые рёбра подволока. Всё это собрано здесь кодом, коробками и
// гранями, в осях корабля.
//
// РАССТАНОВКА — от кресла командира и окон:
//
//   * впереди, у лобовых окон, — четыре поста лицом к окнам: тактика,
//     рулевой, штурман, связь. Рулевой и штурман — по бокам от оси, и
//     между ними остаётся проход взгляда на нос: их пульты ниже кромки
//     окна (1.02 м против 0.3 м подоконника — но в 3 м от глаза это 10.6°
//     под горизонтом, а нос — на 13°, ровно в просвете между ними);
//   * по бортам — по два поста лицом к борту, под окнами: высота пульта
//     ниже подоконника (1.05 м), и окна остаются окнами;
//   * за креслом — штурманский стол с картой, светящейся сверху; на
//     задней стене по бокам от двери — два больших экрана;
//   * подволок — рёбра поперёк зала через 2.6 м и лампы между ними; над
//     помостом командира — кольцо подсветки.
//
// Экраны постов — не текстуры: их софт рисует только пост командира.
// Здесь это светящиеся грани (CMAT.led): тёмная подложка, рамка и
// строки, шкалы, развёртка — по виду поста. Свет им не нужен, и в
// темноте мостика они читаются экранами.

import { lamp } from './interior.js';
import { CMAT } from './cockpit.js';
import { PCP, podSolids } from './cockpit.prom.js';

// Палитра — та же, что у поста командира: голубоватая сталь, чёрный
// композит, графитовая обивка.
const C = {
  steel: [86, 93, 104],
  steelLt: [122, 130, 140],
  panel: [64, 70, 80],
  dark: [33, 36, 41],
  bezel: [19, 21, 25],
  seat: [36, 38, 43],
  seatEdge: [54, 58, 66],
  rib: [70, 76, 86],
  ledBlue: [86, 172, 250],
  ledAmber: [255, 172, 80],
  scrBase: [7, 16, 26],
  scrEdge: [40, 110, 160],
  cyan: [90, 200, 255],
  amber: [255, 180, 80],
  green: [110, 230, 140],
  red: [240, 90, 70],
};

// --- рамы ------------------------------------------------------------------------

/**
 * Рама на палубе: начало o (оси корабля), «вперёд» f — единичный вектор
 * в горизонтали. Точка P(u, y, w): u — вправо, y — вверх от o, w — вперёд.
 */
function frameOn(o, f) {
  const r = [f[2], 0, -f[0]];
  return (u, y, w) => [o[0] + r[0] * u + f[0] * w, o[1] + y, o[2] + r[2] * u + f[2] * w];
}

/** Коробка в раме P: [u0, u1] × [y0, y1] × [w0, w1]. */
function obox(b, P, u0, u1, y0, y1, w0, w1, col, mat, em = 0) {
  const c = [P(u0, y0, w0), P(u1, y0, w0), P(u1, y1, w0), P(u0, y1, w0),
    P(u0, y0, w1), P(u1, y0, w1), P(u1, y1, w1), P(u0, y1, w1)];
  const q = (a, bb, cc, d) => b.poly([c[a], c[bb], c[cc], c[d]], col, mat, em);
  q(0, 1, 2, 3); q(5, 4, 7, 6); q(4, 0, 3, 7); q(1, 5, 6, 2); q(3, 2, 6, 7); q(4, 5, 1, 0);
}

/** Габарит точек — коробка твёрдого (рамы здесь повёрнуты на прямые углы). */
function boxOf(pts) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  return { lo, hi };
}

// --- экраны постов --------------------------------------------------------------

/**
 * Картинка экрана поста гранями: подложка, рамка и содержимое по виду.
 * Q(u, v) — точка на стекле (u вправо, v вверх, метры от середины);
 * kind — 'bars' (шкалы), 'scope' (развёртка), 'trace' (график),
 * 'ship' (схема корабля), 'text' (строки).
 */
function fakeScreen(b, Q, w, h, kind, seed = 0) {
  const hw = w / 2, hh = h / 2;
  const quad = (u0, v0, u1, v1, col, em = 1) => b.poly([Q(u0, v1), Q(u1, v1), Q(u1, v0), Q(u0, v0)], col, CMAT.led, em);
  const line = (a, c, t, col, em = 1) => {
    const du = c[0] - a[0], dv = c[1] - a[1], l = Math.hypot(du, dv) || 1;
    const nu = -dv / l * t / 2, nv = du / l * t / 2;
    b.poly([Q(a[0] + nu, a[1] + nv), Q(c[0] + nu, c[1] + nv), Q(c[0] - nu, c[1] - nv), Q(a[0] - nu, a[1] - nv)], col, CMAT.led, em);
  };
  quad(-hw, -hh, hw, hh, C.scrBase, 1);
  const t = Math.min(w, h) * 0.012;
  const lift = (f) => (u, v) => Q(u, v, f);
  // Содержимое — на миллиметр ближе подложки: иначе у них общая глубина.
  const Q1 = lift(0.0012);
  const quad1 = (u0, v0, u1, v1, col, em = 1) => b.poly([Q1(u0, v1), Q1(u1, v1), Q1(u1, v0), Q1(u0, v0)], col, CMAT.led, em);
  const line1 = (a, c, tt, col, em = 1) => {
    const du = c[0] - a[0], dv = c[1] - a[1], l = Math.hypot(du, dv) || 1;
    const nu = -dv / l * tt / 2, nv = du / l * tt / 2;
    b.poly([Q1(a[0] + nu, a[1] + nv), Q1(c[0] + nu, c[1] + nv), Q1(c[0] - nu, c[1] - nv), Q1(a[0] - nu, a[1] - nv)], col, CMAT.led, em);
  };
  // Рамка и строка заголовка.
  line([-hw, hh - t], [hw, hh - t], t, C.scrEdge, 0.8);
  line([-hw, -hh + t], [hw, -hh + t], t, C.scrEdge, 0.8);
  quad1(-hw + t * 3, hh - h * 0.13, -hw + w * 0.38, hh - h * 0.07, C.cyan, 0.75);
  const rnd = (i) => { const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return s - Math.floor(s); };
  if (kind === 'bars') {
    for (let i = 0; i < 5; i++) {
      const v = hh - h * 0.25 - i * h * 0.15;
      const k = 0.25 + 0.7 * rnd(i);
      quad1(-hw + w * 0.08, v - h * 0.04, -hw + w * 0.08 + w * 0.8 * k, v + h * 0.04, k > 0.85 ? C.amber : C.cyan, 0.9);
      quad1(-hw + w * 0.08 + w * 0.8 * k, v - h * 0.04, hw - w * 0.12, v + h * 0.04, C.scrEdge, 0.35);
    }
  } else if (kind === 'scope') {
    const r = Math.min(hw, hh) * 0.72, cv = -h * 0.05;
    for (let i = 0; i < 12; i++) {
      const a0 = i / 12 * Math.PI * 2, a1 = (i + 1) / 12 * Math.PI * 2;
      line1([Math.cos(a0) * r, cv + Math.sin(a0) * r], [Math.cos(a1) * r, cv + Math.sin(a1) * r], t, C.cyan, 0.8);
      line1([Math.cos(a0) * r * 0.5, cv + Math.sin(a0) * r * 0.5], [Math.cos(a1) * r * 0.5, cv + Math.sin(a1) * r * 0.5], t * 0.7, C.scrEdge, 0.8);
    }
    line1([-r, cv], [r, cv], t * 0.6, C.scrEdge, 0.7);
    line1([0, cv - r], [0, cv + r], t * 0.6, C.scrEdge, 0.7);
    const sa = rnd(9) * Math.PI * 2;
    line1([0, cv], [Math.cos(sa) * r, cv + Math.sin(sa) * r], t * 1.5, C.green, 0.9);
    for (let i = 0; i < 4; i++) {
      const a = rnd(i + 20) * Math.PI * 2, d = r * (0.25 + 0.65 * rnd(i + 30));
      const u = Math.cos(a) * d, v = cv + Math.sin(a) * d, s = r * 0.06;
      quad1(u - s, v - s, u + s, v + s, i === 0 ? C.red : C.amber, 1);
    }
  } else if (kind === 'trace') {
    for (let i = 1; i < 4; i++) line1([-hw + w * 0.06, -hh + h * 0.2 * i], [hw - w * 0.06, -hh + h * 0.2 * i], t * 0.5, C.scrEdge, 0.5);
    let prev = null;
    for (let i = 0; i <= 10; i++) {
      const u = -hw + w * 0.06 + (w * 0.88) * i / 10;
      const v = -hh + h * (0.2 + 0.5 * rnd(i + 40));
      if (prev) line1(prev, [u, v], t * 1.4, C.green, 0.9);
      prev = [u, v];
    }
  } else if (kind === 'ship') {
    // Силуэт крейсера сбоку: корпус, башня, гондолы.
    const k = Math.min(w * 0.8, h * 1.6);
    const R = (u0, v0, u1, v1, col) => quad1(u0 * k, v0 * k - h * 0.05, u1 * k, v1 * k - h * 0.05, col, 0.85);
    R(-0.5, -0.06, 0.5, 0.04, C.cyan);
    R(-0.42, -0.14, -0.02, -0.06, C.scrEdge);
    R(-0.30, 0.04, -0.12, 0.20, C.cyan);
    R(0.30, -0.10, 0.5, -0.06, C.scrEdge);
    R(-0.2 + rnd(3) * 0.5, -0.04, -0.14 + rnd(3) * 0.5, 0.02, C.amber);
  } else {
    for (let i = 0; i < 6; i++) {
      const v = hh - h * 0.24 - i * h * 0.12;
      quad1(-hw + w * 0.07, v - h * 0.025, -hw + w * (0.2 + 0.6 * rnd(i + 50)), v + h * 0.025, i === 2 ? C.amber : C.cyan, 0.7);
    }
  }
}

// --- посты ---------------------------------------------------------------------------

/**
 * Пульт поста: тумба с цоколем, полка под руки и наклонная панель с
 * экранами, к оператору — по f. o — середина передней кромки на палубе,
 * len — длина вдоль кромки. Высота задней кромки — 1.02 м: ниже
 * подоконника бортовых окон.
 */
function console_(ctx, b, o, f, len, screens) {
  const P = frameOn(o, f);
  const D = 0.85, hl = len / 2;
  // Цоколь, тумба, полка.
  obox(b, P, -hl + 0.04, hl - 0.04, 0, 0.10, 0.14, D - 0.03, C.bezel, CMAT.trim);
  obox(b, P, -hl, hl, 0.10, 0.70, 0.30, D, C.panel, CMAT.paint);
  obox(b, P, -hl, hl, 0.70, 0.76, 0.0, 0.40, C.dark, CMAT.trim);
  // Наклонная панель: профиль (w, y) — выпуклый, грани веером.
  const prof = [[0.36, 0.76], [D - 0.12, 1.02], [D, 1.02], [D, 0.70], [0.36, 0.70]];
  for (let i = 0; i < prof.length; i++) {
    const a = prof[i], c = prof[(i + 1) % prof.length];
    b.poly([P(-hl, a[1], a[0]), P(hl, a[1], a[0]), P(hl, c[1], c[0]), P(-hl, c[1], c[0])], i === 0 ? C.dark : C.panel,
      i === 0 ? CMAT.trim : CMAT.paint);
  }
  for (const u of [-hl, hl]) b.poly(prof.map(([w, y]) => P(u, y, w)), C.steel, CMAT.paint);
  // Светодиод по кромке полки и янтарь по углам тумбы.
  b.poly([P(-hl, 0.725, -0.002), P(hl, 0.725, -0.002), P(hl, 0.738, -0.002), P(-hl, 0.738, -0.002)], C.ledBlue, CMAT.led, 0.8);
  for (const u of [-hl - 0.002, hl + 0.002]) {
    b.poly([P(u, 0.14, 0.30), P(u, 0.68, 0.30), P(u, 0.68, 0.33), P(u, 0.14, 0.33)], C.ledAmber, CMAT.led, 0.7);
  }
  // Экраны на наклонной панели. Ось v — вверх по наклону, к задней кромке.
  const s0 = [0.36, 0.76], s1 = [D - 0.12, 1.02];
  const sl = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
  const dw = (s1[0] - s0[0]) / sl, dy = (s1[1] - s0[1]) / sl;
  const nW = -dy, nY = dw;
  const n = screens.length;
  const sw = Math.min(0.52, (len - 0.12) / n - 0.06), sh = Math.min(0.30, sl - 0.08);
  screens.forEach((kind, i) => {
    const uc = -hl + (i + 0.5) * len / n;
    const Q = (u, v, d = 0) => {
      const ww = (s0[0] + s1[0]) / 2 + dw * v + nW * (0.003 + d), yy = (s0[1] + s1[1]) / 2 + dy * v + nY * (0.003 + d);
      return P(uc + u, yy, ww);
    };
    // Рамка экрана — тёмная плита чуть шире стекла.
    b.poly([Q(-sw / 2 - 0.02, sh / 2 + 0.02, -0.001), Q(sw / 2 + 0.02, sh / 2 + 0.02, -0.001),
      Q(sw / 2 + 0.02, -sh / 2 - 0.02, -0.001), Q(-sw / 2 - 0.02, -sh / 2 - 0.02, -0.001)], C.bezel, CMAT.trim);
    fakeScreen(b, Q, sw, sh, kind, o[0] * 3.1 + o[2] * 1.7 + i);
  });
  // Клавиши на полке — ряд под руки.
  for (let i = 0; i < Math.floor(len / 0.11); i++) {
    const u = -hl + 0.12 + i * 0.11;
    if (u > hl - 0.12) break;
    const lit = (i * 7 + Math.round(o[2] * 3)) % 5 === 0;
    obox(b, P, u - 0.035, u + 0.035, 0.76, 0.772, 0.12, 0.17, lit ? C.ledAmber : C.panel, lit ? CMAT.led : CMAT.rubber, lit ? 0.6 : 0);
  }
  const bb = boxOf([P(-hl, 0, 0), P(hl, 1.02, D)]);
  ctx.solids.push({ ...bb, prop: 'console' });
}

/**
 * Кресло поста: колонна на палубе, чаша, спинка с подголовником. Лицо —
 * к пульту (f). Низ спинки — в 45 см за серединой сиденья.
 */
function crewSeat(ctx, b, o, f) {
  const P = frameOn(o, f);
  // Основание и колонна.
  obox(b, P, -0.24, 0.24, 0, 0.04, -0.24, 0.24, C.steel, CMAT.metal);
  obox(b, P, -0.06, 0.06, 0.04, 0.38, -0.06, 0.06, C.dark, CMAT.trim);
  // Чаша и подушка.
  obox(b, P, -0.25, 0.25, 0.38, 0.43, -0.24, 0.24, C.steel, CMAT.paint);
  obox(b, P, -0.22, 0.22, 0.43, 0.50, -0.22, 0.22, C.seat, CMAT.rubber);
  for (const s of [-1, 1]) obox(b, P, s * 0.19, s * 0.25, 0.43, 0.54, -0.22, 0.22, C.seatEdge, CMAT.rubber);
  // Спинка: подушка, стальная оболочка и подголовник.
  obox(b, P, -0.22, 0.22, 0.50, 1.12, -0.30, -0.22, C.seat, CMAT.rubber);
  obox(b, P, -0.25, 0.25, 0.44, 1.16, -0.34, -0.30, C.steel, CMAT.paint);
  obox(b, P, -0.13, 0.13, 1.16, 1.36, -0.32, -0.24, C.seat, CMAT.rubber);
  obox(b, P, -0.05, 0.05, 1.12, 1.18, -0.33, -0.29, C.dark, CMAT.trim);
  // Подлокотники.
  for (const s of [-1, 1]) {
    obox(b, P, s * 0.25, s * 0.31, 0.62, 0.66, -0.26, 0.16, C.seat, CMAT.rubber);
    obox(b, P, s * 0.26, s * 0.30, 0.43, 0.62, -0.22, -0.16, C.steel, CMAT.paint);
  }
  const bb = boxOf([P(-0.31, 0, -0.34), P(0.31, 1.36, 0.24)]);
  ctx.solids.push({ ...bb, prop: 'seat' });
}

/**
 * Штурманский стол: восьмиугольная столешница с картой, светящейся
 * сверху (сетка, орбиты, отметки), на тумбе с цоколем.
 */
function plotTable(ctx, b, room, x, z, hx, hz) {
  const y = room.lo[1], top = y + 0.95, ch = 0.45;
  const oct = [[-hx + ch, -hz], [hx - ch, -hz], [hx, -hz + ch], [hx, hz - ch], [hx - ch, hz], [-hx + ch, hz], [-hx, hz - ch], [-hx, -hz + ch]];
  const at = (p, yy, k = 1) => [x + p[0] * k, yy, z + p[1] * k];
  // Тумба, цоколь, кромка столешницы.
  b.poly(oct.map((p) => at(p, top)), C.steel, CMAT.paint);
  for (let i = 0; i < 8; i++) {
    const a = oct[i], c = oct[(i + 1) % 8];
    b.poly([at(a, top - 0.08), at(c, top - 0.08), at(c, top), at(a, top)], C.steelLt, CMAT.paint);
    b.poly([at(a, y, 0.72), at(c, y, 0.72), at(c, top - 0.08, 0.72), at(a, top - 0.08, 0.72)], C.panel, CMAT.paint);
    b.poly([at(a, top - 0.085, 0.72), at(c, top - 0.085, 0.72), at(c, top - 0.08, 1), at(a, top - 0.08, 1)], C.dark, CMAT.trim);
    b.poly([at(a, y + 0.06, 0.725), at(c, y + 0.06, 0.725), at(c, y + 0.075, 0.725), at(a, y + 0.075, 0.725)], C.ledBlue, CMAT.led, 0.8);
  }
  // Карта: стекло стола светится — подложка, сетка, звезда, орбиты, курс.
  const k = 0.9;
  const Q = (u, v, d = 0) => [x + u, top + 0.004 + d, z - v];
  b.poly(oct.map((p) => Q(p[0] * k, -p[1] * k)), C.scrBase, CMAT.led, 1);
  const Q1 = (u, v) => Q(u, v, 0.0015);
  const seg = (a, c, t, col, em) => {
    const du = c[0] - a[0], dv = c[1] - a[1], l = Math.hypot(du, dv) || 1;
    const nu = -dv / l * t / 2, nv = du / l * t / 2;
    b.poly([Q1(a[0] + nu, a[1] + nv), Q1(c[0] + nu, c[1] + nv), Q1(c[0] - nu, c[1] - nv), Q1(a[0] - nu, a[1] - nv)], col, CMAT.led, em);
  };
  for (let i = -4; i <= 4; i++) {
    seg([i * hx * k / 4.5, -hz * k + 0.05], [i * hx * k / 4.5, hz * k - 0.05], 0.006, C.scrEdge, 0.45);
    if (Math.abs(i) <= 3) seg([-hx * k + 0.05, i * hz * k / 3.5], [hx * k - 0.05, i * hz * k / 3.5], 0.006, C.scrEdge, 0.45);
  }
  for (const [r, col] of [[0.32, C.cyan], [0.58, C.cyan], [0.8, C.scrEdge]]) {
    for (let i = 0; i < 24; i++) {
      const a0 = i / 24 * Math.PI * 2, a1 = (i + 1) / 24 * Math.PI * 2;
      seg([Math.cos(a0) * r * 1.3, Math.sin(a0) * r], [Math.cos(a1) * r * 1.3, Math.sin(a1) * r], 0.009, col, 0.8);
    }
  }
  const s = 0.05;
  b.poly([Q1(-s, -s), Q1(s, -s), Q1(s, s), Q1(-s, s)], C.amber, CMAT.led, 1);
  seg([0.42, 0.0], [-0.72, 0.52], 0.012, C.green, 0.9);
  for (const [u, v, col] of [[0.416, 0.0, C.cyan], [-0.30, 0.48, C.amber], [0.62, -0.42, C.red]]) {
    b.poly([Q1(u - 0.03, v - 0.03), Q1(u + 0.03, v - 0.03), Q1(u + 0.03, v + 0.03), Q1(u - 0.03, v + 0.03)], col, CMAT.led, 1);
  }
  ctx.solids.push({ lo: [x - hx, y, z - hz], hi: [x + hx, top, z + hz], prop: 'plot' });
  ctx.lamps.push({ pos: [x, top + 0.5, z], dir: [0, 1, 0], cos: -2, color: [0.12, 0.32, 0.6], range: 2.4,
    room: room.id, kind: 'ceiling' });
}

/** Большой экран на стене: рама и картинка; f — нормаль стены в комнату. */
function wallScreen(b, o, f, w, h, kind, seed) {
  const P = frameOn(o, f);
  obox(b, P, -w / 2 - 0.08, w / 2 + 0.08, -h / 2 - 0.08, h / 2 + 0.08, 0, 0.09, C.dark, CMAT.trim);
  fakeScreen(b, (u, v, d = 0) => P(u, v, 0.092 + d), w, h, kind, seed);
}

/**
 * Подволок: стальные рёбра поперёк зала через 2.6 м — силовой набор
 * головы, на котором держится крыша, — и кольцо подсветки над помостом.
 */
function ceiling(ctx, b, room, zs, ring) {
  const y1 = room.hi[1];
  for (const z of zs) {
    b.box([room.lo[0], y1 - 0.42, z - 0.17], [room.hi[0], y1, z + 0.17], C.rib, CMAT.paint);
    b.box([room.lo[0], y1 - 0.44, z - 0.05], [room.hi[0], y1 - 0.42, z + 0.05], C.dark, CMAT.trim);
    // Кница у борта: ребро уходит в стену.
    for (const x of [room.lo[0], room.hi[0]]) {
      const s = x < 0 ? 1 : -1;
      b.poly([[x, y1 - 0.42, z - 0.17], [x + s * 0.6, y1 - 0.42, z - 0.17], [x, y1 - 1.1, z - 0.17]], C.rib, CMAT.paint);
      b.poly([[x, y1 - 0.42, z + 0.17], [x + s * 0.6, y1 - 0.42, z + 0.17], [x, y1 - 1.1, z + 0.17]], C.rib, CMAT.paint);
      b.poly([[x + s * 0.6, y1 - 0.42, z - 0.17], [x + s * 0.6, y1 - 0.42, z + 0.17], [x, y1 - 1.1, z + 0.17], [x, y1 - 1.1, z - 0.17]],
        C.rib, CMAT.paint);
    }
  }
  // Кольцо над помостом: восьмиугольник светодиодной ленты.
  const [cx, cz, r] = ring;
  for (let i = 0; i < 8; i++) {
    const a0 = (i + 0.5) / 8 * Math.PI * 2, a1 = (i + 1.5) / 8 * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r];
    const q0 = [cx + Math.cos(a0) * (r + 0.25), cz + Math.sin(a0) * (r + 0.25)], q1 = [cx + Math.cos(a1) * (r + 0.25), cz + Math.sin(a1) * (r + 0.25)];
    // Кольцо — ниже рёбер (их низ в 0.44 м под подволоком), иначе оно
    // прошло бы сквозь них.
    const yr = y1 - 0.62;
    b.poly([[p0[0], yr, p0[1]], [p1[0], yr, p1[1]], [q1[0], yr, q1[1]], [q0[0], yr, q0[1]]], C.dark, CMAT.trim);
    b.poly([[p0[0], yr - 0.005, p0[1]], [p1[0], yr - 0.005, p1[1]], [p1[0] * 0.94 + q1[0] * 0.06, yr - 0.005, p1[1] * 0.94 + q1[1] * 0.06],
      [p0[0] * 0.94 + q0[0] * 0.06, yr - 0.005, p0[1] * 0.94 + q0[1] * 0.06]], C.ledBlue, CMAT.led, 0.9);
    // Подвес кольца к подволоку.
    if (i % 2 === 0) b.box([q0[0] - 0.03, yr, q0[1] - 0.03], [q0[0] + 0.03, y1, q0[1] + 0.03], C.steel, CMAT.metal);
  }
}

/**
 * Обставить мостик. R — коробка мостика (оси корабля), A(x, y, z) —
 * точка из осей сборки (м: от среза сопел и киля) в оси модели, eye —
 * глаз в кресле командира (оси модели).
 */
export function furnishBridge(ctx, b, R, A, eye) {
  const y0 = R.lo[1];
  const fwd = [0, 0, 1], toL = [-1, 0, 0], toR = [1, 0, 0];

  // Пост командира: сам он рисуется проходом кабины, а твёрдое — здесь.
  for (const s of podSolids()) {
    ctx.solids.push({ lo: s.lo.map((v, i) => v + eye[i]), hi: s.hi.map((v, i) => v + eye[i]), prop: 'pod' });
  }

  // Впереди, лицом к окнам: тактика, рулевой, штурман, связь.
  const front = A(0, 46, 68.75)[2];
  const row = [
    [-7.8, 3.2, ['scope', 'bars', 'trace']],
    [-2.15, 2.5, ['ship', 'scope', 'bars']],
    [2.15, 2.5, ['trace', 'scope', 'text']],
    [7.8, 3.2, ['text', 'bars', 'ship']],
  ];
  for (const [x, len, scr] of row) {
    console_(ctx, b, [x, y0, front], fwd, len, scr);
    const seats = len > 3 ? [-0.75, 0.75] : [0];
    for (const u of seats) crewSeat(ctx, b, [x + u, y0, front - 0.62], fwd);
  }

  // По бортам — по два поста лицом к борту, под окнами.
  for (const s of [-1, 1]) {
    const x = s * (R.hi[0] - 0.12 - 0.85);
    const f = s < 0 ? toL : toR;
    const kinds = s < 0 ? [['scope', 'bars', 'text'], ['trace', 'ship', 'bars']] : [['ship', 'trace', 'bars'], ['text', 'scope', 'trace']];
    [[58.2, kinds[0]], [63.4, kinds[1]]].forEach(([z, scr]) => {
      console_(ctx, b, [x, y0, A(0, 46, z)[2]], f, 3.6, scr);
      for (const u of [-0.9, 0.9]) crewSeat(ctx, b, [x - s * 0.62, y0, A(0, 46, z)[2] + u * (s < 0 ? 1 : -1)], f);
    });
    // Экраны на стене между окнами.
    for (const z of [58.2, 60.8, 63.4]) {
      wallScreen(b, [s * (R.hi[0] - 0.2), y0 + 1.55, A(0, 46, z)[2]], s < 0 ? toR : toL, 0.95, 0.5,
        ['bars', 'trace', 'text'][Math.round(z) % 3], z * s);
    }
  }

  // За креслом — штурманский стол; на задней стене — два больших экрана.
  plotTable(ctx, b, R, 0, A(0, 46, 59.4)[2], 1.35, 0.95);
  for (const s of [-1, 1]) {
    wallScreen(b, [s * 6.2, y0 + 1.85, R.lo[2] + 0.2], fwd, 2.8, 1.5, s < 0 ? 'ship' : 'scope', 7 + s);
    // Шкафы аппаратуры в задних углах.
    for (const x of [8.6, 10.3]) {
      const P = frameOn([s * x, y0, R.lo[2] + 0.16], fwd);
      obox(b, P, -0.75, 0.75, 0, 2.3, 0, 0.62, C.panel, CMAT.paint);
      obox(b, P, -0.7, 0.7, 0.05, 2.25, 0.62, 0.64, C.dark, CMAT.trim);
      for (let i = 0; i < 6; i++) {
        obox(b, P, -0.55, 0.55, 0.3 + i * 0.32, 0.32 + i * 0.32, 0.64, 0.646, i % 3 === 0 ? C.ledAmber : C.ledBlue, CMAT.led, 0.6);
      }
      ctx.solids.push({ ...boxOf([P(-0.75, 0, 0), P(0.75, 2.3, 0.64)]), prop: 'rack' });
    }
  }

  // Подволок: рёбра и кольцо над помостом.
  ceiling(ctx, b, R, [57.6, 60.2, 62.8, 65.4, 68.0].map((z) => A(0, 46, z)[2]), [0, eye[2], 1.5]);

  // Свет: прохладный и неяркий — экраны в нём читаются. Кольцо над
  // креслом, ряды над постами, у задней стены.
  const cool = [0.62, 0.68, 0.8];
  lamp(ctx, b, R, 0, eye[2], { w: 1.0, range: 5.0, color: [0.7, 0.72, 0.78] });
  for (const s of [-1, 1]) {
    lamp(ctx, b, R, s * 2.15, A(0, 46, 69.2)[2], { w: 1.2, range: 4.5, color: cool, alongX: true });
    lamp(ctx, b, R, s * 7.8, A(0, 46, 69.2)[2], { w: 1.2, range: 4.5, color: cool, alongX: true });
    lamp(ctx, b, R, s * 9.6, A(0, 46, 58.9)[2], { w: 1.2, range: 5.0, color: cool });
    lamp(ctx, b, R, s * 9.6, A(0, 46, 64.1)[2], { w: 1.2, range: 5.0, color: cool });
    lamp(ctx, b, R, s * 5.0, A(0, 46, 56.4)[2], { w: 1.2, range: 5.0, color: cool, alongX: true });
  }
}

export { PCP };
