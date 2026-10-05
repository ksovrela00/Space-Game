// Пост водителя вездехода: кресло, руль, доска с тремя мониторами и
// табло, — то, что видно с места водителя.
//
// Собран так же, как посты кораблей (js/models/cockpit.js,
// js/models/cockpit.prom.js): своя сетка в осях глаза, экраны — текстуры,
// которые рисует софт мониторов (js/ui/panels.js), подвижные детали — по
// тому же договору (stick, throttle). Своё у него — раскладка, от машины:
//
//   * экранов три, а не пять: у вездехода нет ни приводов, ни щита, ни
//     оружия. Слева — навигация (курс, куда до корабля), посередине — ход
//     (скорость, руль, наклон, колёса), справа — системы (корпус, дверь,
//     воздух кабины, фары). Над ними — табло сигнализации;
//   * вместо ручки — руль. Он крутится за колёсами (yoke.wheel — их
//     поворот, js/game/rover.js) с передачей WHEEL.ratio: колёса доходят
//     до упора — руль на полтора оборота меньше, чем у машины, но видно,
//     куда он повёрнут, по янтарной метке на ободе;
//   * вместо РУДа — рычаг хода на правом подлокотнике: вперёд — газ,
//     назад — задний ход (yoke.lever — педаль, js/game/rover.js);
//   * доска — ниже кромки лобового стекла и ниже, чем у кораблей: вездеход
//     ездит по камням, и дорогу перед ним надо видеть. Козырёк доски — на
//     16° под горизонтом, грунт из-за него виден с шести метров перед
//     носом. Обод руля в кадре — снизу, сквозь него виден средний монитор,
//     как приборы в машине: он заслоняет только нижнюю кромку экрана, где
//     подписи кнопок (проверка меряет — tools/test.mjs, «пост вездехода»).
//
// Числа — в метрах от глаза. Оси — оси вездехода (x вправо, y вверх, z
// вперёд, js/models/rover.js), начало — глаз в кресле (RV.eye).

import { v3 } from '../core/vec3.js';
import { Kit, CMAT, dirAt, buildThrottle, beamSection } from './cockpit.js';
import { RV } from './rover.js';

const DEG = Math.PI / 180;

const add = (a, b, k = 1) => v3(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, k) => v3(a.x * k, a.y * k, a.z * k);
const norm = (a) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
};
const cross = (a, b) => v3(
  a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const X = v3(1, 0, 0), Y = v3(0, 1, 0), Z = v3(0, 0, 1);

// Палитра — в тон кузову: светло-серая сталь и янтарь (js/models/rover.js),
// доска и корпуса экранов — чёрный композит, обивка — графит.
const C = {
  steel: [96, 101, 108],
  steelLt: [140, 146, 152],
  panel: [70, 74, 80],
  dash: [46, 49, 54],
  dark: [30, 32, 36],
  bezel: [19, 21, 25],
  floor: [62, 65, 70],
  seat: [38, 40, 44],
  seatEdge: [58, 61, 67],
  metal: [150, 156, 164],
  key: [48, 52, 58],
  grip: [28, 29, 32],
  amber: [206, 132, 46],
  ledAmber: [255, 172, 80],
  ledWarm: [255, 222, 176],
  lampAmber: [255, 184, 72],
  lampGreen: [96, 226, 126],
  lampBlue: [86, 168, 245],
  lampRed: [240, 84, 62],
};

// --- размеры ------------------------------------------------------------------

const E = RV.eye, B = RV.body;

export const RCP = {
  floorY: RV.floor - E[1],               // пол кабины, от глаза
  ceilY: RV.ceil - E[1],                 // потолок
  rear: 0.4 - E[2],                      // задняя стенка кабины (проход в шлюз)
  wall: B.side - 0.03,                   // |x| обшивки бортов изнутри
  // Лобовое стекло: верхняя кромка (у крыши) и нижняя (у носа), [y, z].
  glassTop: [B.top - E[1], B.windZ - E[2]],
  glassBot: [B.nose - E[1], B.z1 - E[2]],
  // Мониторы: плоскость лицом к глазу на угле места el и расстоянии d;
  // монитор w × h (510 × 330 софта), шаг step. Табло — над средним, на той
  // же плите (strip: ширина, высота и место; 10 : 1, как табло связи у
  // «Челленджера», — софт верстает его на 800 × 80). top и bot — край плиты
  // над и под мониторами, по плоскости.
  mfd: { el: -26.5, d: 0.70, w: 0.20, h: 0.1294, step: 0.222, rim: 0.012, depth: 0.07, top: 0.125, bot: 0.078 },
  strip: { w: 0.40, h: 0.040, v: 0.093 },
  hood: 0.03,                            // козырёк над плитой — к глазу
  // Профиль доски по ширине кабины: [y, z] — выпуклый многоугольник от
  // кромки под мониторами через верх к основанию стекла и назад, к коленям,
  // по наклонному низу (под ним ноги). Верх уходит вниз круче взгляда — из
  // кресла его не видно. Посередине доска на 3.5 см глубже плиты мониторов:
  // иначе её кромка ложилась на нижние края экранов.
  dash: [[-0.43, 0.60], [-0.25, 0.70], [B.nose - E[1], B.z1 - E[2]], [-0.95, B.z1 - E[2]], [-0.66, 0.62]],
  // Ниша для ног: под доской до пола, спереди — наклонная подножка.
  foot: [[-0.95, B.z1 - E[2]], [RV.floor - E[1], B.z1 - E[2]], [RV.floor - E[1], 1.0], [-0.95, 1.25]],
  // Руль: ступица, радиус обода и наклон колонки (её ось к водителю — на
  // tilt над горизонтом).
  wheel: { y: -0.45, z: 0.42, r: 0.165, tube: 0.016, tilt: 25 },
  // Сиденье: верх подушки на 0.8 м под глазом.
  seat: { y: -0.80, z0: -0.32, z1: 0.20, hw: 0.25 },
  arm: { x: 0.33, y: -0.60, z0: -0.34, z1: 0.24, hw: 0.06 },
  // Рычаг хода — справа, на подлокотнике.
  lever: { x: 0.33, y: -0.585, z: 0.17 },
};

// Руль: на сколько он поворачивается на радиан поворота колёс. Колёса
// ходят на 30° (server/data/specs.php, steerMax), руль — на 150°: у машины
// руль от упора до упора — полтора-два оборота, и в кадре такой руль не
// успевал бы за клавишей. Это показания, а не физика — как у ручки (YOKE).
export const WHEEL = { ratio: 5, lever: 0.32, ramp: 0.15 };

/** Экраны поста: где какой. Софт — js/ui/panels.js. */
export const ROVER_SCREENS = [
  { id: 'rnav', kind: 'mfd', slot: -1 },
  { id: 'rdrive', kind: 'mfd', slot: 0 },
  { id: 'rsys', kind: 'mfd', slot: 1 },
  { id: 'rann', kind: 'strip' },
];

// --- плоскости ------------------------------------------------------------------

/** Плоскость лицом к глазу: центр на (az, el, d), оси экрана, нормаль к пилоту. */
function facing(az, el, d) {
  const dir = dirAt(az, el);
  const right = norm(cross(Y, dir));
  return { c: mul(dir, d), right, up: cross(dir, right), n: mul(dir, -1) };
}

/** Точка плоскости F: u — вправо, v — вверх, o — к пилоту. */
const at = (F, u, v, o = 0) => add(add(add(F.c, F.right, u), F.up, v), F.n, o);

const PANEL = facing(0, RCP.mfd.el, RCP.mfd.d);

/** Прямоугольник минус дыры — набор прямоугольников ({u: [a, b], v: [c, d]}). */
function minus(rect, holes) {
  let out = [rect];
  for (const h of holes) {
    const next = [];
    for (const r of out) {
      const u0 = Math.max(r.u[0], h.u[0]), u1 = Math.min(r.u[1], h.u[1]);
      const v0 = Math.max(r.v[0], h.v[0]), v1 = Math.min(r.v[1], h.v[1]);
      if (u1 - u0 <= 1e-6 || v1 - v0 <= 1e-6) { next.push(r); continue; }
      if (u0 - r.u[0] > 1e-6) next.push({ u: [r.u[0], u0], v: r.v });
      if (r.u[1] - u1 > 1e-6) next.push({ u: [u1, r.u[1]], v: r.v });
      if (v0 - r.v[0] > 1e-6) next.push({ u: [u0, u1], v: [r.v[0], v0] });
      if (r.v[1] - v1 > 1e-6) next.push({ u: [u0, u1], v: [v1, r.v[1]] });
    }
    out = next;
  }
  return out;
}

/**
 * Экран, утопленный на 4 мм в плиту: стекло и стенки колодца. Ось
 * «вправо» — вправо по кадру (иначе картинка зеркальная; проверка меряет).
 */
function screen(k, s, F, cu, cv, w, h) {
  const hw = w / 2, hh = h / 2, f = 0.004;
  const q = (u, v, o = 0) => at(F, cu + u, cv + v, o);
  const corners = [q(-hw, hh), q(hw, hh), q(hw, -hh), q(-hw, -hh)];
  k.poly(corners, [255, 255, 255], CMAT.screen, { screen: s.id, uv: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  const front = [q(-hw, hh, f), q(hw, hh, f), q(hw, -hh, f), q(-hw, -hh, f)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    k.poly([front[i], front[j], corners[j], corners[i]], C.bezel, CMAT.trim);
  }
  return { id: s.id, kind: s.kind, pos: q(0, 0), right: F.right, up: F.up, normal: F.n, w, h, corners, nom: s.nom || null };
}

// --- части --------------------------------------------------------------------------

/**
 * Доска во всю ширину кабины: призма по профилю RCP.dash, от борта до
 * борта. Под мониторами — колени, наверху — уходящий к стеклу скат, внизу
 * — ниша для ног с наклонной подножкой.
 */
function dashBody(k) {
  const P = RCP.dash, w = RCP.wall;
  const pt = (x, p) => v3(x, p[0], p[1]);
  const prism = (Q, col, mat) => {
    for (let i = 0; i < Q.length; i++) {
      const a = Q[i], b = Q[(i + 1) % Q.length];
      k.poly([pt(-w, a), pt(w, a), pt(w, b), pt(-w, b)], col(i), mat(i));
    }
    k.poly(Q.map((p) => pt(-w, p)).reverse(), C.panel, CMAT.paint);
    k.poly(Q.map((p) => pt(w, p)), C.panel, CMAT.paint);
  };
  // Грани доски: 0 — колени под мониторами, 1 — скат к стеклу, 2 — нос
  // изнутри, 3 — низ над ногами, 4 — колени. У ниши грань 3 — подножка.
  prism(P, (i) => (i === 1 ? C.dash : C.panel), (i) => (i === 1 ? CMAT.trim : CMAT.paint));
  prism(RCP.foot, (i) => (i === 3 ? C.steel : C.panel), (i) => (i === 3 ? CMAT.tread : CMAT.paint));
  // Кант по кромке ската — стальной валик: по нему в кадре видно, где
  // кончается доска и начинается дорога.
  k.tube(pt(-w, [P[1][0] + 0.004, P[1][1]]), pt(w, [P[1][0] + 0.004, P[1][1]]), 0.012, 0.012, 8, C.steelLt, CMAT.metal);
  // Решётки обдува стекла на скате — по бокам от мониторов.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = s * (0.55 + i * 0.07);
      const t0 = 0.12, t1 = 0.30;
      const lerpP = (t) => [P[1][0] + (P[2][0] - P[1][0]) * t + 0.002, P[1][1] + (P[2][1] - P[1][1]) * t];
      k.poly([pt(x - 0.025, lerpP(t0)), pt(x + 0.025, lerpP(t0)), pt(x + 0.025, lerpP(t1)), pt(x - 0.025, lerpP(t1))],
        C.dark, CMAT.grille);
    }
  }
  // Янтарная лента вдоль колен — ночью по ней видно край доски.
  const lerpK = (t) => [P[4][0] + (P[0][0] - P[4][0]) * t, P[4][1] + (P[0][1] - P[4][1]) * t];
  for (const s of [-1, 1]) {
    const x0 = s * 0.42, x1 = s * (w - 0.05);
    const a = lerpK(0.86), b = lerpK(0.92);
    k.poly([v3(x0, a[0], a[1] - 0.003), v3(x1, a[0], a[1] - 0.003), v3(x1, b[0], b[1] - 0.003), v3(x0, b[0], b[1] - 0.003)],
      C.ledAmber, CMAT.led, { emissive: 0.75 });
  }
  // Педалей нет — газ и тормоз у вездехода на рычаге; на подножке упор для ног.
  const Q = RCP.foot;
  const fp = (t) => [Q[2][0] + (Q[3][0] - Q[2][0]) * t, Q[2][1] + (Q[3][1] - Q[2][1]) * t];
  const f0 = fp(0.35), f1 = fp(0.75);
  k.box(v3(0, (f0[0] + f1[0]) / 2 + 0.02, (f0[1] + f1[1]) / 2 - 0.02), X, norm(v3(0, f1[0] - f0[0], f1[1] - f0[1])),
    norm(cross(X, norm(v3(0, f1[0] - f0[0], f1[1] - f0[1])))), 0.22, Math.hypot(f1[0] - f0[0], f1[1] - f0[1]) / 2, 0.012,
    C.metal, CMAT.tread);
}

/**
 * Блок мониторов: плита лицом к глазу, три монитора и табло над средним,
 * корпус назад до доски, козырёк сверху и подсветка под ним.
 */
function binnacle(k, out) {
  const M = RCP.mfd, S = RCP.strip, F = PANEL, f = 0.004;
  const hw = M.step + M.w / 2 + M.rim + 0.012;
  const v0 = -M.bot, v1 = M.top;
  // Корпус: бока и задняя стенка до доски.
  const ring = (o) => [[-hw, v1], [hw, v1], [hw, v0], [-hw, v0]].map(([u, v]) => at(F, u, v, o));
  const rf = ring(f), rb = ring(-M.depth);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    k.poly([rf[i], rf[j], rb[j], rb[i]], C.dark, CMAT.trim);
  }
  k.poly(rb.slice().reverse(), C.dark, CMAT.trim);
  // Плита с проёмами экранов.
  const holes = [];
  for (const s of ROVER_SCREENS) {
    if (s.kind === 'mfd') holes.push({ u: [s.slot * M.step - M.w / 2, s.slot * M.step + M.w / 2], v: [-M.h / 2, M.h / 2] });
  }
  holes.push({ u: [-S.w / 2, S.w / 2], v: [S.v - S.h / 2, S.v + S.h / 2] });
  for (const r of minus({ u: [-hw, hw], v: [v0, v1] }, holes)) {
    k.poly([at(F, r.u[0], r.v[1], f), at(F, r.u[1], r.v[1], f), at(F, r.u[1], r.v[0], f), at(F, r.u[0], r.v[0], f)],
      C.bezel, CMAT.trim);
  }
  for (const s of ROVER_SCREENS) {
    out[s.id] = s.kind === 'mfd' ? screen(k, s, F, s.slot * M.step, 0, M.w, M.h) : screen(k, s, F, 0, S.v, S.w, S.h);
  }
  // Кнопки по нижней кромке мониторов — по пять, как у кораблей: подписи
  // их рисует софт (js/ui/panels.js).
  for (const s of ROVER_SCREENS) {
    if (s.kind !== 'mfd') continue;
    for (let i = 0; i < 5; i++) {
      const u = s.slot * M.step + (i - 2) * (M.w / 5);
      k.box(at(F, u, -M.h / 2 - M.rim * 0.5 - 0.004, f + 0.003), F.right, F.up, F.n, 0.009, 0.004, 0.003,
        C.key, CMAT.rubber, { front: { emissive: 0.2 } });
    }
  }
  // Козырёк: плита над корпусом, на hood к глазу; под кромкой — тёплая
  // лента подсветки (она же лампа поста, lights).
  const H = RCP.hood;
  const a0 = at(F, -hw - 0.01, v1, H), a1 = at(F, hw + 0.01, v1, H);
  const b0 = at(F, -hw - 0.01, v1, -M.depth - 0.05), b1 = at(F, hw + 0.01, v1, -M.depth - 0.05);
  const lift = mul(F.up, 0.016);
  k.poly([add(a0, lift), add(a1, lift), add(b1, lift), add(b0, lift)], C.dash, CMAT.trim);
  k.poly([a0, a1, add(a1, lift), add(a0, lift)], C.dark, CMAT.trim);
  k.poly([a0, a1, at(F, hw + 0.01, v1, f), at(F, -hw - 0.01, v1, f)], C.dark, CMAT.trim);
  for (const [p, q] of [[a0, b0], [a1, b1]]) k.poly([p, q, add(q, lift), add(p, lift)], C.dark, CMAT.trim);
  k.poly([at(F, -hw + 0.02, v1 - 0.0005, H - 0.004), at(F, hw - 0.02, v1 - 0.0005, H - 0.004),
    at(F, hw - 0.02, v1 - 0.0005, H - 0.012), at(F, -hw + 0.02, v1 - 0.0005, H - 0.012)], C.ledWarm, CMAT.led, { emissive: 1 });
  // Наружные кромки корпуса — янтарные полосы.
  for (const s of [-1, 1]) {
    const u = s * (hw + 0.0015);
    k.poly([at(F, u, v0 + 0.02, -0.01), at(F, u, v1 - 0.02, -0.01), at(F, u, v1 - 0.02, -0.022), at(F, u, v0 + 0.02, -0.022)],
      C.ledAmber, CMAT.led, { emissive: 0.8 });
  }
}

/** Ось колонки руля (к водителю) и «верх» обода — в осях глаза. */
function wheelAxes() {
  const t = RCP.wheel.tilt * DEG;
  return { axis: v3(0, Math.sin(t), -Math.cos(t)), top: v3(0, Math.cos(t), Math.sin(t)) };
}

/** Колонка руля: кожух от доски до ступицы, с рычажками по бокам. */
function column(k) {
  const W = RCP.wheel, { axis, top } = wheelAxes();
  const hub = v3(0, W.y, W.z);
  const a = add(hub, axis, -0.04), b = add(hub, axis, -0.34);
  k.tube(a, b, 0.032, 0.045, 12, C.dark, CMAT.trim, { cap: {} });
  // Кожух у доски — шире: в нём замок и подрулевые рычаги.
  const c = add(hub, axis, -0.14);
  k.box(c, X, top, mul(axis, -1), 0.06, 0.05, 0.07, C.dash, CMAT.trim);
  for (const s of [-1, 1]) {
    const p0 = add(add(c, X, s * 0.06), axis, 0.02);
    k.tube(p0, add(add(p0, X, s * 0.10), axis, 0.03), 0.006, 0.005, 6, C.metal, CMAT.metal);
    k.box(add(add(p0, X, s * 0.105), axis, 0.032), X, top, axis, 0.012, 0.009, 0.009, C.amber, CMAT.paint);
  }
}

/**
 * Руль — деталь, которая крутится (договор поста: stick). Оси детали:
 * y — ось колонки к водителю, z — верх обода, x — вправо; начало —
 * середина ступицы. Обод — тор с толстыми накладками на «без четверти
 * три», три спицы и янтарная метка на макушке: по ней видно, насколько
 * руль повёрнут.
 */
export function buildSteeringWheel() {
  const k = new Kit();
  const W = RCP.wheel, R = W.r, r = W.tube;
  const N = 36, M = 8;
  const ringAt = (a, rr) => {
    const c = v3(Math.sin(a) * R, 0, Math.cos(a) * R);
    const out = v3(Math.sin(a), 0, Math.cos(a));
    const row = [];
    for (let j = 0; j <= M; j++) {
      const b = (j / M) * Math.PI * 2;
      row.push(add(add(c, out, Math.cos(b) * rr), Y, Math.sin(b) * rr));
    }
    return row;
  };
  // Обод — по участкам: накладки под ладони толще и темнее.
  const grip = (a) => {
    const d = Math.abs(Math.sin(a));
    return d > 0.82;
  };
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const thick = grip(am) ? r * 1.25 : r;
    const top = Math.abs(Math.atan2(Math.sin(am), Math.cos(am))) < 0.09;
    k.loft([ringAt(a0, thick), ringAt(a1, thick)], top ? C.amber : grip(am) ? C.grip : C.seat,
      top ? CMAT.paint : CMAT.rubber, { smooth: true });
  }
  // Ступица: чашка и янтарный знак посередине.
  k.tube(v3(0, -0.03, 0), v3(0, 0.022, 0), 0.055, 0.05, 16, C.dark, CMAT.trim, { cap: {} });
  k.tube(v3(0, 0.022, 0), v3(0, 0.028, 0), 0.026, 0.024, 12, C.amber, CMAT.paint, { cap: {} });
  // Спицы: на три и девять часов — плоские, на шесть — двойная.
  const spoke = (a, w) => {
    const d = v3(Math.sin(a), 0, Math.cos(a));
    const s = v3(Math.cos(a), 0, -Math.sin(a));
    const c = mul(d, (0.05 + R - r) / 2);
    k.box(add(c, Y, 0.004), s, Y, d, w, 0.009, (R - r - 0.05) / 2 + 0.006, C.steel, CMAT.paint);
  };
  spoke(Math.PI / 2, 0.022);
  spoke(-Math.PI / 2, 0.022);
  spoke(Math.PI - 0.13, 0.014);
  spoke(Math.PI + 0.13, 0.014);
  // Кнопки на боковых спицах: фары (слева) и связь (справа).
  for (const s of [-1, 1]) {
    const p = v3(s * 0.085, 0.016, 0.0);
    k.box(p, X, Y, Z, 0.011, 0.004, 0.009, C.key, CMAT.rubber, { top: { emissive: 0.4 } });
    k.poly([v3(p.x - 0.005, p.y + 0.0045, p.z - 0.004), v3(p.x + 0.005, p.y + 0.0045, p.z - 0.004),
      v3(p.x + 0.005, p.y + 0.0045, p.z + 0.004), v3(p.x - 0.005, p.y + 0.0045, p.z + 0.004)],
    s < 0 ? C.lampAmber : C.lampBlue, CMAT.lamp, { emissive: 1 });
  }
  return k.mesh();
}

/**
 * Кресло водителя: сиденье на тумбе, спинка с крыльями, подголовник и
 * подлокотники; на правом — рычаг хода, на левом — пульт двери и фар.
 */
function seat(k) {
  const S = RCP.seat, A = RCP.arm, y0 = RCP.floorY;
  const zc = (S.z0 + S.z1) / 2;
  // Тумба на полу и рама сиденья.
  k.box(v3(0, (y0 + S.y - 0.12) / 2, zc - 0.03), X, Y, Z, 0.2, (S.y - 0.12 - y0) / 2, 0.2, C.steel, CMAT.paint);
  k.box(v3(0, y0 + 0.012, zc - 0.03), X, Y, Z, 0.26, 0.012, 0.26, C.dark, CMAT.metal);
  k.box(v3(0, S.y - 0.105, zc), X, Y, Z, S.hw + 0.035, 0.03, (S.z1 - S.z0) / 2 + 0.02, C.steel, CMAT.paint);
  k.box(v3(0, S.y - 0.04, zc - 0.01), X, Y, Z, S.hw - 0.03, 0.04, (S.z1 - S.z0) / 2 - 0.01, C.seat, CMAT.rubber);
  for (const s of [-1, 1]) {
    k.box(v3(s * (S.hw - 0.01), S.y - 0.02, zc), X, Y, Z, 0.035, 0.055, (S.z1 - S.z0) / 2, C.seatEdge, CMAT.rubber);
  }
  k.tube(v3(-S.hw + 0.03, S.y - 0.03, S.z1), v3(S.hw - 0.03, S.y - 0.03, S.z1), 0.035, 0.035, 8, C.seatEdge, CMAT.rubber);
  // Спинка: наклон 10° назад.
  const lean = 10 * DEG;
  const ay = v3(0, Math.cos(lean), -Math.sin(lean)), az = v3(0, Math.sin(lean), Math.cos(lean));
  const bc = v3(0, -0.40, -0.37);
  k.box(bc, X, ay, az, 0.23, 0.38, 0.06, C.seat, CMAT.rubber);
  const shell = add(bc, az, -0.09);
  k.box(shell, X, ay, az, 0.27, 0.42, 0.03, C.steel, CMAT.paint);
  for (const s of [-1, 1]) {
    const c = add(add(add(bc, X, s * 0.245), ay, 0.06), az, 0.03);
    k.box(c, X, ay, az, 0.035, 0.26, 0.07, C.seatEdge, CMAT.rubber);
  }
  // Подголовник.
  const head = v3(0, 0.02, -0.29);
  k.box(head, X, Y, Z, 0.12, 0.09, 0.05, C.seat, CMAT.rubber);
  k.box(add(head, Z, -0.065), X, Y, Z, 0.14, 0.10, 0.016, C.steel, CMAT.paint);
  for (const s of [-1, 1]) k.tube(v3(s * 0.07, -0.07, -0.35), v3(s * 0.07, -0.01, -0.35), 0.011, 0.011, 6, C.metal, CMAT.metal);
  // Подлокотники с пультами.
  for (const s of [-1, 1]) {
    const x = s * A.x, zm = (A.z0 + A.z1) / 2, half = (A.z1 - A.z0) / 2;
    k.box(v3(x, (A.y - 0.09 + S.y - 0.12) / 2, -0.16), X, Y, Z, 0.035, (A.y - 0.09 - (S.y - 0.12)) / 2, 0.08, C.steel, CMAT.paint);
    k.box(v3(x, A.y - 0.06, zm), X, Y, Z, A.hw + 0.01, 0.022, half, C.steel, CMAT.paint);
    k.box(v3(x, A.y - 0.02, zm - 0.07), X, Y, Z, A.hw - 0.005, 0.018, half - 0.07, C.seat, CMAT.rubber);
    k.box(v3(x, A.y - 0.017, A.z1 - 0.07), X, Y, Z, A.hw + 0.01, 0.015, 0.07, C.dark, CMAT.trim);
    // Янтарная лента по наружной кромке.
    k.poly([v3(x + s * (A.hw + 0.0105), A.y - 0.07, A.z0 + 0.04), v3(x + s * (A.hw + 0.0105), A.y - 0.07, A.z1 - 0.02),
      v3(x + s * (A.hw + 0.0105), A.y - 0.058, A.z1 - 0.02), v3(x + s * (A.hw + 0.0105), A.y - 0.058, A.z0 + 0.04)],
    C.ledAmber, CMAT.led, { emissive: 0.7 });
  }
  // Левый пульт: три клавиши — дверь, фары, тормоз стоянки.
  for (let i = 0; i < 3; i++) {
    const p = v3(-A.x, A.y + 0.001, A.z1 - 0.11 + i * 0.035);
    k.box(p, X, Y, Z, 0.012, 0.005, 0.012, C.key, CMAT.rubber, { top: { emissive: 0.5 } });
    k.poly([v3(p.x - 0.006, p.y + 0.0055, p.z - 0.005), v3(p.x + 0.006, p.y + 0.0055, p.z - 0.005),
      v3(p.x + 0.006, p.y + 0.0055, p.z + 0.005), v3(p.x - 0.006, p.y + 0.0055, p.z + 0.005)],
    [C.lampAmber, C.lampGreen, C.lampRed][i], CMAT.lamp, { emissive: 1 });
  }
  // Правый пульт: прорезь рычага с метками «вперёд» и «назад».
  const L = RCP.lever;
  k.box(v3(L.x, L.y - 0.004, L.z), X, Y, Z, 0.035, 0.007, 0.075, C.steel, CMAT.paint);
  k.poly([v3(L.x - 0.006, L.y + 0.0035, L.z - 0.06), v3(L.x + 0.006, L.y + 0.0035, L.z - 0.06),
    v3(L.x + 0.006, L.y + 0.0035, L.z + 0.06), v3(L.x - 0.006, L.y + 0.0035, L.z + 0.06)], C.bezel, CMAT.trim);
  for (const [dz, col] of [[0.05, C.lampGreen], [0, C.metal], [-0.05, C.lampAmber]]) {
    k.poly([v3(L.x + 0.012, L.y + 0.0036, L.z + dz - 0.003), v3(L.x + 0.03, L.y + 0.0036, L.z + dz - 0.003),
      v3(L.x + 0.03, L.y + 0.0036, L.z + dz + 0.003), v3(L.x + 0.012, L.y + 0.0036, L.z + dz + 0.003)],
    col, col === C.metal ? CMAT.metal : CMAT.lamp, { emissive: col === C.metal ? 0 : 0.8 });
  }
}

/**
 * Пол кабины, потолочный пульт с плафоном и обшивка бортов. Стены кабины
 * — сам кузов изнутри (js/gl/hull.js, uHullInside); на них — панели с
 * поручнями: за них держатся, когда машину качает.
 */
function lining(k) {
  const y0 = RCP.floorY, yc = RCP.ceilY, z0 = RCP.rear, w = RCP.wall;
  const zf = RCP.foot[2][1];
  // Пол — рифлёный лист от прохода до ниши для ног.
  k.poly([v3(-w, y0, z0), v3(w, y0, z0), v3(w, y0, zf), v3(-w, y0, zf)].reverse(), C.floor, CMAT.tread);
  // Порожки вдоль бортов — янтарная кромка.
  for (const s of [-1, 1]) {
    k.box(v3(s * (w - 0.04), y0 + 0.03, (z0 + zf) / 2), X, Y, Z, 0.04, 0.03, (zf - z0) / 2, C.steel, CMAT.paint);
    k.poly([v3(s * (w - 0.08), y0 + 0.0605, z0 + 0.02), v3(s * (w - 0.08), y0 + 0.0605, zf - 0.02),
      v3(s * (w - 0.085), y0 + 0.0605, zf - 0.02), v3(s * (w - 0.085), y0 + 0.0605, z0 + 0.02)],
    C.ledAmber, CMAT.led, { emissive: 0.5 });
  }
  // Потолок над креслом до кромки стекла и пульт на нём.
  const zg = RCP.glassTop[1];
  k.poly([v3(-w, yc, z0), v3(w, yc, z0), v3(w, yc, zg), v3(-w, yc, zg)], C.panel, CMAT.paint);
  const oc = v3(0, yc - 0.035, -0.12);
  k.box(oc, X, Y, Z, 0.22, 0.035, 0.12, C.dash, CMAT.trim);
  for (let i = 0; i < 6; i++) {
    const p = v3(-0.15 + i * 0.06, yc - 0.0705, -0.08);
    const lit = i % 2 === 0;
    k.box(p, X, Y, Z, 0.012, 0.004, 0.016, C.key, CMAT.rubber, { top: lit ? { emissive: 0.4 } : null });
  }
  // Плафон — за головой, над проходом.
  k.box(v3(0, yc - 0.012, -0.55), X, Y, Z, 0.16, 0.012, 0.06, C.ledWarm, CMAT.lamp, { emissive: 0.9 });
  // Панели бортов и поручни.
  for (const s of [-1, 1]) {
    const x = s * (w - 0.004);
    k.poly([v3(x, y0 + 0.25, z0 + 0.05), v3(x, y0 + 0.25, 0.9), v3(x, yc - 0.45, 0.9), v3(x, yc - 0.45, z0 + 0.05)],
      C.panel, CMAT.paint);
    const xr = s * (w - 0.06);
    k.tube(v3(xr, 0.15, -0.75), v3(xr, 0.15, -0.15), 0.014, 0.014, 8, C.amber, CMAT.paint);
    for (const z of [-0.75, -0.15]) k.tube(v3(xr, 0.15, z), v3(s * (w - 0.004), 0.15, z), 0.012, 0.012, 6, C.metal, CMAT.metal);
  }
}

/**
 * Рама лобового стекла изнутри: стойки по рёбрам стекла и перекладина
 * над ним. Стекло в кузове — три полосы (крыша лба и две
 * фаски, js/models/rover.js), и без рамы на их стыках кабина из кресла
 * выглядела открытой: небо начиналось прямо от доски, и не было видно, где
 * машина. Брусья — в трёх сантиметрах от стекла внутрь, чтобы не спорить
 * глубиной с кузовом.
 */
function windowFrame(k) {
  const B = RV.body;
  const P = (x, y, z) => v3(x, y - E[1], z - E[2]);
  // Сечение лба: у крыши (windZ) и у носа (z1) — те же точки, что у кузова.
  const top = { side: [B.side, B.top - B.chamfer], edge: [B.roof, B.top], z: B.windZ };
  const bot = { side: [B.side, B.nose - 0.25], edge: [1.05, B.nose], z: B.z1 };
  const inward = (p) => {
    // Внутрь — к оси кабины на высоте глаза: брус от стекла к пилоту.
    const d = norm(v3(-p.x, -p.y * 0.5, -p.z * 0.3));
    return add(p, d, 0.03);
  };
  const out = (p) => norm(v3(p.x, p.y * 0.5 + 0.2, p.z * 0.3));
  const beam = (a, b, w, d, col) => k.sweep([inward(a), inward(b)], out, beamSection(w, d, 0.008), col, CMAT.paint);
  // Низ стоек — чуть выше носа: сечение бруса у самого носа вылезало из
  // кузова, а этот кусок всё равно за доской.
  const low = (a, b) => [a[0] + (b[0] - a[0]) * 0.08, a[1] + (b[1] - a[1]) * 0.08];
  for (const s of [-1, 1]) {
    // Стойка между фаской и бортом (наружная) и между фаской и лбом (внутренняя);
    // верх внутренней — чуть ниже крыши, под перекладиной.
    const sb = low([bot.side[1], bot.z], [top.side[1], top.z]), eb = low([bot.edge[1], bot.z], [top.edge[1], top.z]);
    const et = low([top.edge[1], top.z], [bot.edge[1], bot.z]);
    beam(P(s * (top.side[0] - 0.02), top.side[1], top.z), P(s * (bot.side[0] - 0.02), sb[0], sb[1]), 0.09, 0.05, C.panel);
    beam(P(s * top.edge[0], et[0], et[1]), P(s * bot.edge[0], eb[0], eb[1]), 0.05, 0.04, C.dash);
  }
  // Перекладина над стеклом — по сечению лба. Порога под стеклом нет: его
  // из кресла не видно (он за доской), а брус у самого носа вылезал из кузова.
  // Ниже крыши на пять сантиметров: сечение бруса — от стекла внутрь.
  const across = (S, h) => {
    const pts = [P(-S.side[0] + 0.02, S.side[1] - 0.05, S.z), P(-S.edge[0], S.edge[1] - 0.05, S.z),
      P(S.edge[0], S.edge[1] - 0.05, S.z), P(S.side[0] - 0.02, S.side[1] - 0.05, S.z)];
    for (let i = 0; i + 1 < pts.length; i++) beam(pts[i], pts[i + 1], h, 0.05, C.panel);
  };
  across(top, 0.10);
  // Солнцезащитный козырёк над перекладиной — со стороны водителя.
  // Под самой крышей, у верхней кромки стекла.
  const vz = top.z - E[2] + 0.06, vy = B.top - 0.16 - E[1];
  k.box(v3(0, vy, vz), X, norm(v3(0, 0.3, -1)), norm(v3(0, 1, 0.3)), 0.42, 0.006, 0.09, C.dash, CMAT.trim);
}

/** Лампы поста: подсветка из-под козырька, плафон и свет в ноги. Цвет — уже с силой. */
function lights() {
  const M = RCP.mfd, F = PANEL;
  const hood = at(F, 0, M.top - 0.004, RCP.hood - 0.01);
  return [
    { pos: hood, dir: norm(sub(v3(0, RCP.wheel.y, RCP.wheel.z), hood)), cos: Math.cos(60 * DEG), color: [0.26, 0.23, 0.18], range: 1.1 },
    { pos: v3(0, RCP.ceilY - 0.03, -0.55), dir: v3(0, -1, 0), cos: Math.cos(70 * DEG), color: [0.22, 0.21, 0.19], range: 2.2 },
    { pos: v3(0, -0.75, 0.55), dir: norm(v3(0, -0.8, -0.6)), cos: Math.cos(65 * DEG), color: [0.06, 0.10, 0.16], range: 1.0 },
  ];
}

/**
 * Твёрдое поста для пешехода (js/game/walker.js) — коробки в осях глаза:
 * доска, блок мониторов с колонкой руля и кресло с подлокотниками.
 */
export function roverPodSolids() {
  const y0 = RCP.floorY, w = RCP.wall;
  return [
    { lo: [-w, y0 - 0.3, 0.60], hi: [w, -0.25, RCP.glassBot[1] + 0.3], dash: true },
    { lo: [-0.42, -0.62, 0.30], hi: [0.42, -0.18, 0.75], dash: true },
    { lo: [-0.40, y0, -0.50], hi: [0.40, 0.12, RCP.arm.z1 + 0.04], chair: true },
  ];
}

/**
 * Собрать пост водителя.
 *
 * @returns то же, что buildCockpit (js/models/cockpit.js): оболочка, руль
 *   (stick), рычаг (throttle), экраны, лампы, габарит. Стекла у поста нет —
 *   лобовое стекло сквозное в корпусе, а корпус в карту теней — от
 *   помещений.
 */
export function buildRoverCockpit() {
  const k = new Kit();
  const screens = {};
  dashBody(k);
  binnacle(k, screens);
  column(k);
  seat(k);
  lining(k);
  windowFrame(k);
  const lo = v3(Infinity, Infinity, Infinity), hi = v3(-Infinity, -Infinity, -Infinity);
  for (const v of k.verts) {
    lo.x = Math.min(lo.x, v.x); hi.x = Math.max(hi.x, v.x);
    lo.y = Math.min(lo.y, v.y); hi.y = Math.max(hi.y, v.y);
    lo.z = Math.min(lo.z, v.z); hi.z = Math.max(hi.z, v.z);
  }
  const W = RCP.wheel;
  // Руль: деталь в осях «y — колонка, z — верх обода»; поворот в позу —
  // наклон колонки (вокруг x) и поворот руля вокруг неё.
  const tiltX = (W.tilt - 90) * DEG;
  return {
    code: 'rover',
    shell: k.mesh(),
    glass: { verts: [], faces: [] },
    hull: null,
    deck: [],
    eye: v3(E[0], E[1], E[2]),
    stick: {
      mesh: buildSteeringWheel(),
      pivot: v3(0, W.y, W.z),
      // [вокруг x, вокруг z, вокруг y] — как partMatrix (js/gl/cabin.js).
      pose: (y) => [tiltX, 0, (y.wheel || 0) * WHEEL.ratio],
    },
    throttle: {
      mesh: buildThrottle(),
      pivot: v3(RCP.lever.x, RCP.lever.y, RCP.lever.z),
      pose: (y) => [(y.lever || 0) * WHEEL.lever, 0, 0],
    },
    screens,
    panes: [],
    lights: lights(),
    bound: { lo, hi },
    size: RCP,
  };
}

/**
 * Руль и рычаг — за машиной: руль за поворотом колёс (рад), рычаг за
 * педалью (−1..1), по времени игрока — как ручка корабля (updateYoke).
 */
export function updateDriveYoke(yoke, rover, dt) {
  const k = Math.min(1, dt / WHEEL.ramp);
  yoke.wheel = rover.steer || 0;
  yoke.lever = (yoke.lever || 0) + ((rover.pedal || 0) - (yoke.lever || 0)) * k;
  return yoke;
}
