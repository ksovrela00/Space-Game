// Пост командира «Прометея»: кресло на помосте посреди мостика, две
// стойки экранов по бокам и консоль с локатором впереди — то, что видно
// с места пилота.
//
// ЧТО БЫЛО. Мостик обставлялся мебелью из набора помещений: офисное
// кресло на крестовине посреди зала, столы с мониторами по бортам, — а
// приборов у кресла не было вовсе: они рисовались поверх кадра, как в
// виде из-за спины. Крейсер с мостиком конторы.
//
// ЧТО ТЕПЕРЬ. Пост собран так же, как у «Челленджера» (js/models/cockpit.js):
// своя сетка в осях глаза, ручка и РУД на подлокотниках, экраны —
// текстуры, которые рисует тот же софт мониторов (js/ui/panels.js). Но
// раскладка — своя, от мостика, а не от фонаря истребителя:
//
//   * у «Челленджера» глаз в метре от лобового стекла, и приборы — на
//     доске под ним. У «Прометея» до стекла 4.5 м, и между креслом и окном
//     стоят посты рулевого и штурмана. Доска во всю ширину закрыла бы и
//     их, и нос корабля. Поэтому экраны — ВОКРУГ кресла: две стойки по
//     бокам (по два монитора и табло между ними) и консоль впереди, ниже
//     кромки окна. Над консолью остаётся нос: его кончик на 13° ниже
//     горизонта, кромка консоли — на 16.5°;
//   * локатор — широкий (2:1), а не 3:2: на консоли командира он главный,
//     и эллипс диска на нём шире (js/ui/panels.js, номинал 660 × 330);
//   * кресло — на помосте в 30 см: глаз сидящего на 1.6 м над палубой
//     (так стоит глаз мостика корпуса, js/models/prometheus.js), и
//     сиденье обычной высоты ставит его туда только с помоста.
//
// Числа — в метрах от глаза. Проверки сверяют, что все экраны целиком в
// кадре (68° по вертикали, ±50° по горизонтали), ничем не заслонены и не
// зеркальны (tools/test.mjs, «пост командира «Прометея»»).
//
// Оси — оси корабля (x вправо, y вверх, z вперёд), начало — глаз в кресле.

import { v3 } from '../core/vec3.js';
import { Kit, CMAT, dirAt, buildStick, buildThrottle } from './cockpit.js';

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

// Палитра. Сталь — голубовато-серая, в тон обшивке крейсера; корпуса
// экранов и консоль — чёрный композит; обивка — графит. Акценты — синие
// светодиоды по кромкам и янтарь на опорах: по ним в полумраке мостика
// видно, где кончается помост и где стоят стойки.
const C = {
  steel: [86, 93, 104],
  steelLt: [122, 130, 140],
  panel: [62, 68, 78],
  dark: [33, 36, 41],
  bezel: [19, 21, 25],
  deck: [58, 62, 68],
  trim: [44, 48, 54],
  seat: [36, 38, 43],
  seatEdge: [54, 58, 66],
  metal: [150, 156, 164],
  key: [48, 52, 58],
  ledBlue: [86, 172, 250],
  ledAmber: [255, 172, 80],
  lampAmber: [255, 184, 72],
  lampGreen: [96, 226, 126],
  lampBlue: [86, 168, 245],
  lampRed: [240, 84, 62],
};

// --- размеры ------------------------------------------------------------------

export const PCP = {
  floorY: -1.6,             // палуба мостика: глаз сидящего на 1.6 м над ней
  // Помост: восьмиугольник с фасками, от затылка кресла до консоли.
  dais: { h: 0.30, hx: 1.75, z0: -1.75, z1: 1.55, ch: 0.5 },
  // Сиденье: верх подушки на 0.8 м под глазом — рост сидящего.
  seat: { y: -0.81, z0: -0.31, z1: 0.21, hw: 0.26 },
  arm: { x: 0.335, y: -0.605, z0: -0.36, z1: 0.30, hw: 0.065 },
  // Ручка — справа, РУД — слева, как у «Челленджера»: рука на подлокотнике.
  stick: { x: 0.335, y: -0.60, z: 0.25 },
  throttle: { x: -0.335, y: -0.60, z: 0.21 },
  // Стойка: плоскость лицом к глазу на азимуте ±az, угле места el и
  // расстоянии d. Мониторы — над и под табло, через gap от него. Монитор
  // в 26 см на метре от глаза — в кадре 1600 × 900 около 170 точек в
  // ширину, как монитор «Челленджера» (23 см на 85 см): софт тот же, и
  // кегль его рассчитан на этот размер (js/ui/panels.js). Ближе и крупнее
  // — и две стойки закрывали бы половину окна. Угол места — от кромки
  // кадра: прямолинейная проекция растягивает высоту сбоку в 1/cos az, и
  // на азимуте 37° низ кадра — уже не −34°, а −28°.
  tower: { az: 37, el: -13.5, d: 1.0, w: 0.26, h: 0.168, gap: 0.117, strip: 0.035, rim: 0.026, depth: 0.07 },
  // Консоль: локатор (w × h) и табло связи над ним (lift — от центра
  // локатора); лицо — от bot под центром до top над ним.
  desk: { el: -27, d: 0.98, w: 0.42, h: 0.21, strip: 0.042, lift: 0.146, hw: 0.29, top: 0.196, bot: 0.15, back: 1.25, drop: 0.10 },
};

/** Экраны поста: где какой. Софт — тот же, что у «Челленджера». */
export const PROM_SCREENS = [
  { id: 'systems', kind: 'mfd', side: -1, row: 1 },
  { id: 'flight', kind: 'mfd', side: -1, row: -1 },
  { id: 'map', kind: 'mfd', side: 1, row: 1 },
  { id: 'target', kind: 'mfd', side: 1, row: -1 },
  { id: 'annL', kind: 'strip', side: -1, row: 0 },
  { id: 'annR', kind: 'strip', side: 1, row: 0 },
  { id: 'scope', kind: 'wide', nom: [660, 330] },
  { id: 'comms', kind: 'strip', desk: true },
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
 * Выпуклый многоугольник в плане ([x, z]), каждая сторона которого
 * сдвинута внутрь на d: вершины — пересечения соседних сдвинутых сторон.
 */
function offsetIn(pts, d) {
  const n = pts.length;
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0] / n; cz += p[1] / n; }
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
    let nx = -tz / l, nz = tx / l;
    if ((cx - a[0]) * nx + (cz - a[1]) * nz < 0) { nx = -nx; nz = -nz; }
    return { p: [a[0] + nx * d, a[1] + nz * d], t: [tx / l, tz / l] };
  });
  return pts.map((_, i) => {
    const A = lines[(i + n - 1) % n], B = lines[i];
    const den = A.t[0] * B.t[1] - A.t[1] * B.t[0];
    const s = ((B.p[0] - A.p[0]) * B.t[1] - (B.p[1] - A.p[1]) * B.t[0]) / den;
    return [A.p[0] + A.t[0] * s, A.p[1] + A.t[1] * s];
  });
}

/** Лицевая плита на плоскости F с проёмами экранов. */
function plate(k, F, rect, holes, o, col, mat) {
  for (const r of minus(rect, holes)) {
    k.poly([at(F, r.u[0], r.v[1], o), at(F, r.u[1], r.v[1], o), at(F, r.u[1], r.v[0], o), at(F, r.u[0], r.v[0], o)],
      col, mat);
  }
}

/**
 * Корпус на плоскости F: фаска по передней кромке (лицо — o0), бока до
 * o1 и задняя стенка. Само лицо — плита (plate), с проёмами.
 */
function housing(k, F, u0, u1, v0, v1, o0, o1, ch, col, mat) {
  const ring = (d, o) => [[u0 + d, v1 - d], [u1 - d, v1 - d], [u1 - d, v0 + d], [u0 + d, v0 + d]].map(([u, v]) => at(F, u, v, o));
  const rf = ring(ch, o0), rm = ring(0, o0 - ch), rb = ring(0, o1);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    k.poly([rf[i], rf[j], rm[j], rm[i]], col, mat);
    k.poly([rm[i], rm[j], rb[j], rb[i]], col, mat);
  }
  k.poly(rb.slice().reverse(), col, mat);
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
  return {
    id: s.id, kind: s.kind, pos: q(0, 0), right: F.right, up: F.up, normal: F.n, w, h, corners,
    nom: s.nom || null,
  };
}

/** Светящаяся полоска на плоскости F (светодиод, лампа). */
function strip(k, F, u0, u1, v0, v1, o, col, mat, em) {
  k.poly([at(F, u0, v1, o), at(F, u1, v1, o), at(F, u1, v0, o), at(F, u0, v0, o)], col, mat, { emissive: em });
}

// --- части --------------------------------------------------------------------------

/**
 * Помост: восьмиугольник с фасками в 30 см над палубой. По кромке верха —
 * стальной кант, под ним синяя лента: ночью по ней видно край, с
 * которого шагают вниз.
 */
function dais(k) {
  const D = PCP.dais, y0 = PCP.floorY, y1 = y0 + D.h;
  const oct = [[-D.hx + D.ch, D.z0], [D.hx - D.ch, D.z0], [D.hx, D.z0 + D.ch], [D.hx, D.z1 - D.ch],
    [D.hx - D.ch, D.z1], [-D.hx + D.ch, D.z1], [-D.hx, D.z1 - D.ch], [-D.hx, D.z0 + D.ch]];
  const cz = (D.z0 + D.z1) / 2;
  const inner = offsetIn(oct, 0.09);
  k.poly(inner.map(([x, z]) => v3(x, y1, z)), C.deck, CMAT.tread);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    k.poly([v3(oct[i][0], y1, oct[i][1]), v3(oct[j][0], y1, oct[j][1]),
      v3(inner[j][0], y1, inner[j][1]), v3(inner[i][0], y1, inner[i][1])], C.steelLt, CMAT.paint);
    // Борт помоста и лента под кантом — чуть наружу от борта.
    const a = oct[i], b = oct[j];
    const ex = b[0] - a[0], ez = b[1] - a[1], el = Math.hypot(ex, ez);
    let nx = ez / el, nz = -ex / el;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (nx * mx + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
    k.poly([v3(a[0], y0, a[1]), v3(b[0], y0, b[1]), v3(b[0], y1, b[1]), v3(a[0], y1, a[1])], C.trim, CMAT.paint);
    const o = 0.003;
    k.poly([v3(a[0] + nx * o, y1 - 0.05, a[1] + nz * o), v3(b[0] + nx * o, y1 - 0.05, b[1] + nz * o),
      v3(b[0] + nx * o, y1 - 0.035, b[1] + nz * o), v3(a[0] + nx * o, y1 - 0.035, a[1] + nz * o)],
    C.ledBlue, CMAT.led, { emissive: 0.75 });
  }
  // Подножка перед креслом: наклонная плита — ноги сидящего стоят на ней.
  const tilt = 22 * DEG;
  k.box(v3(0, y1 + 0.06, 0.52), X, v3(0, Math.cos(tilt), -Math.sin(tilt)), v3(0, Math.sin(tilt), Math.cos(tilt)),
    0.24, 0.025, 0.13, C.steel, CMAT.paint);
  k.box(v3(0, y1 + 0.03, 0.52), X, Y, Z, 0.20, 0.03, 0.08, C.dark, CMAT.trim);
}

/**
 * Кресло командира: литая чаша на колонне, высокая спинка с крыльями на
 * уровне плеч и подголовником, подлокотники с пультами на концах. Сзади —
 * стальная оболочка спинки с рёбрами: со спины его видно весь мостик.
 */
function chair(k) {
  const S = PCP.seat, A = PCP.arm;
  const base = PCP.floorY + PCP.dais.h;
  const zc = (S.z0 + S.z1) / 2;
  // Основание: шайба на помосте, колонна, поворотный узел.
  k.tube(v3(0, base, zc), v3(0, base + 0.045, zc), 0.34, 0.31, 16, C.steel, CMAT.metal, { cap: {} });
  k.tube(v3(0, base + 0.045, zc), v3(0, S.y - 0.17, zc), 0.10, 0.085, 12, C.dark, CMAT.trim);
  k.tube(v3(0, S.y - 0.19, zc), v3(0, S.y - 0.14, zc), 0.16, 0.16, 12, C.steel, CMAT.metal, { cap: {} });
  // Чаша сиденья и подушка с валиками по бокам.
  k.box(v3(0, S.y - 0.115, zc), X, Y, Z, S.hw + 0.04, 0.035, (S.z1 - S.z0) / 2 + 0.02, C.steel, CMAT.paint);
  k.box(v3(0, S.y - 0.045, zc - 0.01), X, Y, Z, S.hw - 0.03, 0.045, (S.z1 - S.z0) / 2 - 0.01, C.seat, CMAT.rubber);
  for (const s of [-1, 1]) {
    k.box(v3(s * (S.hw - 0.01), S.y - 0.025, zc), X, Y, Z, 0.035, 0.06, (S.z1 - S.z0) / 2, C.seatEdge, CMAT.rubber);
  }
  // Край подушки спереди — валик под колени.
  k.tube(v3(-S.hw + 0.03, S.y - 0.03, S.z1), v3(S.hw - 0.03, S.y - 0.03, S.z1), 0.04, 0.04, 8, C.seatEdge, CMAT.rubber);

  // Спинка: наклон 8° назад; у поясницы её лицо в 24 см за глазом.
  const lean = 8 * DEG;
  const ay = v3(0, Math.cos(lean), -Math.sin(lean)), az = v3(0, Math.sin(lean), Math.cos(lean));
  const bc = v3(0, -0.37, -0.36);
  k.box(bc, X, ay, az, 0.24, 0.42, 0.065, C.seat, CMAT.rubber);
  // Оболочка спинки — шире подушки, сталь; по ней три ребра.
  const shell = add(bc, az, -0.095);
  k.box(shell, X, ay, az, 0.29, 0.47, 0.035, C.steel, CMAT.paint);
  for (const u of [-0.16, 0, 0.16]) k.box(add(add(shell, X, u), az, -0.045), X, ay, az, 0.022, 0.40, 0.015, C.trim, CMAT.paint);
  // Крылья спинки — валики на уровне плеч, развёрнуты внутрь.
  for (const s of [-1, 1]) {
    const yaw = -s * 18 * DEG;
    const ax2 = v3(Math.cos(yaw), 0, -Math.sin(yaw)), az2 = norm(v3(Math.sin(yaw) * az.z, az.y, Math.cos(yaw) * az.z));
    const c = add(add(add(bc, X, s * 0.255), ay, 0.10), az, 0.03);
    k.box(c, ax2, ay, az2, 0.04, 0.27, 0.075, C.seatEdge, CMAT.rubber);
  }
  // Подголовник на двух штангах из оболочки.
  const head = v3(0, 0.03, -0.27);
  k.box(head, X, Y, Z, 0.13, 0.10, 0.055, C.seat, CMAT.rubber);
  k.box(add(head, Z, -0.07), X, Y, Z, 0.15, 0.115, 0.018, C.steel, CMAT.paint);
  for (const s of [-1, 1]) k.tube(v3(s * 0.08, -0.07, -0.33), v3(s * 0.08, 0.0, -0.33), 0.012, 0.012, 6, C.metal, CMAT.metal);

  // Подлокотники: опора от чаши, рама, мягкий верх; на конце — пульт.
  for (const s of [-1, 1]) {
    const x = s * A.x;
    const zm = (A.z0 + A.z1) / 2, half = (A.z1 - A.z0) / 2;
    k.box(v3(x, (A.y - 0.09 + S.y - 0.13) / 2, -0.17), X, Y, Z, 0.04, (A.y - 0.09 - (S.y - 0.13)) / 2, 0.09, C.steel, CMAT.paint);
    k.box(v3(x, A.y - 0.065, zm), X, Y, Z, A.hw + 0.01, 0.025, half, C.steel, CMAT.paint);
    k.box(v3(x, A.y - 0.022, zm - 0.07), X, Y, Z, A.hw - 0.005, 0.02, half - 0.07, C.seat, CMAT.rubber);
    // Пульт: тёмная площадка, на ней ручка (справа) или РУД (слева).
    k.box(v3(x, A.y - 0.018, A.z1 - 0.07), X, Y, Z, A.hw + 0.012, 0.016, 0.075, C.dark, CMAT.trim);
    // Кнопки по внутренней кромке пульта.
    for (let i = 0; i < 3; i++) {
      const p = v3(x - s * (A.hw - 0.012), A.y + 0.001, A.z1 - 0.125 + i * 0.03);
      k.box(p, X, Y, Z, 0.008, 0.004, 0.009, C.key, CMAT.rubber, { top: { emissive: 0.5 } });
      k.poly([v3(p.x - 0.004, p.y + 0.0045, p.z - 0.004), v3(p.x + 0.004, p.y + 0.0045, p.z - 0.004),
        v3(p.x + 0.004, p.y + 0.0045, p.z + 0.004), v3(p.x - 0.004, p.y + 0.0045, p.z + 0.004)],
      [C.lampAmber, C.lampGreen, C.lampBlue][i], CMAT.lamp, { emissive: 1 });
    }
    // Синяя лента по наружной кромке подлокотника.
    k.poly([v3(x + s * (A.hw + 0.0115), A.y - 0.075, A.z0 + 0.04), v3(x + s * (A.hw + 0.0115), A.y - 0.075, A.z1 - 0.02),
      v3(x + s * (A.hw + 0.0115), A.y - 0.062, A.z1 - 0.02), v3(x + s * (A.hw + 0.0115), A.y - 0.062, A.z0 + 0.04)],
    C.ledBlue, CMAT.led, { emissive: 0.7 });
  }
}

/** Прорезь РУДа с делениями на левом пульте. */
function throttleGate(k) {
  const p = PCP.throttle;
  k.box(v3(p.x, p.y - 0.004, p.z), X, Y, Z, 0.04, 0.008, 0.10, C.steel, CMAT.paint);
  k.poly([v3(p.x - 0.006, p.y + 0.0045, p.z - 0.085), v3(p.x + 0.006, p.y + 0.0045, p.z - 0.085),
    v3(p.x + 0.006, p.y + 0.0045, p.z + 0.085), v3(p.x - 0.006, p.y + 0.0045, p.z + 0.085)], C.bezel, CMAT.trim);
  for (let i = 0; i < 5; i++) {
    const z = p.z - 0.075 + i * 0.0375;
    k.poly([v3(p.x + 0.013, p.y + 0.0046, z - 0.002), v3(p.x + 0.032, p.y + 0.0046, z - 0.002),
      v3(p.x + 0.032, p.y + 0.0046, z + 0.002), v3(p.x + 0.013, p.y + 0.0046, z + 0.002)],
    i === 1 ? C.lampAmber : C.metal, i === 1 ? CMAT.lamp : CMAT.metal, { emissive: i === 1 ? 0.8 : 0 });
  }
}

/**
 * Стойка экранов сбоку от кресла: монитор, табло, монитор — в одном
 * корпусе, повёрнутом к глазу; над ним козырёк от солнца из окон, снизу —
 * опора на помост. side −1 — слева, +1 — справа.
 */
function tower(k, side, out) {
  const T = PCP.tower;
  const F = facing(side * T.az, T.el, T.d);
  const hw = T.w / 2 + T.rim, top = T.gap + T.h / 2 + T.rim, f = 0.004, ch = 0.012;
  housing(k, F, -hw, hw, -top, top, f, -T.depth, ch, C.dark, CMAT.trim);
  const holes = [
    { u: [-T.w / 2, T.w / 2], v: [T.gap - T.h / 2, T.gap + T.h / 2] },
    { u: [-T.w / 2, T.w / 2], v: [-T.gap - T.h / 2, -T.gap + T.h / 2] },
    { u: [-T.w / 2, T.w / 2], v: [-T.strip / 2, T.strip / 2] },
  ];
  plate(k, F, { u: [-hw + ch, hw - ch], v: [-top + ch, top - ch] }, holes, f, C.bezel, CMAT.trim);
  for (const s of PROM_SCREENS) {
    if (s.side !== side) continue;
    out[s.id] = screen(k, s, F, 0, s.row * T.gap, T.w, s.kind === 'strip' ? T.strip : T.h);
  }
  // Кнопки по бокам мониторов — по три с каждой стороны.
  for (const row of [1, -1]) {
    for (const su of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const v = row * T.gap + (1 - i) * (T.h / 3.4);
        k.box(at(F, su * (T.w / 2 + T.rim / 2), v, f + 0.003), F.right, F.up, F.n, 0.0055, 0.009, 0.003,
          C.key, CMAT.rubber, { front: { emissive: 0.2 } });
      }
    }
  }
  // Козырёк: плита над корпусом, на шесть сантиметров к пилоту; под его
  // кромкой — тёплая лента подсветки (она же лампа поста, lights).
  k.box(at(F, 0, top + 0.009, (0.06 - T.depth) / 2), F.right, F.up, F.n, hw + 0.012, 0.009, (T.depth + 0.06) / 2,
    C.steel, CMAT.paint);
  strip(k, F, -hw + 0.02, hw - 0.02, top - 0.002, top + 0.0005, 0.055, [255, 222, 176], CMAT.led, 1);
  // Наружная кромка корпуса — янтарная лента: стойку видно со всего мостика.
  const ou = side * (hw + 0.0015);
  k.poly([at(F, ou, -top + 0.03, -0.022), at(F, ou, top - 0.03, -0.022), at(F, ou, top - 0.03, -0.034),
    at(F, ou, -top + 0.03, -0.034)], C.ledAmber, CMAT.led, { emissive: 0.8 });
  // Опора: брус от низа корпуса до помоста, по горизонтальным осям стойки.
  const R = norm(v3(F.right.x, 0, F.right.z)), N = norm(v3(F.n.x, 0, F.n.z));
  const b = at(F, 0, -top, -T.depth / 2);
  const base = PCP.floorY + PCP.dais.h;
  const h = (b.y + 0.03 - base) / 2;
  k.box(v3(b.x, base + h, b.z), R, Y, N, 0.045, h, 0.055, C.steel, CMAT.paint);
  k.box(v3(b.x, base + 0.012, b.z), R, Y, N, 0.12, 0.012, 0.12, C.trim, CMAT.metal);
  k.poly([add(v3(b.x, base + 0.05, b.z), add(mul(R, -0.012), N, 0.0565)), add(v3(b.x, base + 0.05, b.z), add(mul(R, 0.012), N, 0.0565)),
    add(v3(b.x, b.y - 0.04, b.z), add(mul(R, 0.012), N, 0.0565)), add(v3(b.x, b.y - 0.04, b.z), add(mul(R, -0.012), N, 0.0565))],
  C.ledAmber, CMAT.led, { emissive: 0.6 });
}

/**
 * Консоль командира перед креслом: широкий локатор и над ним табло
 * связи, на наклонной плите. Корпус — призма вдоль x: лицо, крышка
 * вперёд, задняя стенка до помоста и подрезанный низ — место под ноги.
 */
function desk(k, out) {
  const D = PCP.desk;
  const F = facing(0, D.el, D.d);
  const f = 0.004;
  const A = at(F, 0, D.top), B = at(F, 0, -D.bot);
  const base = PCP.floorY + PCP.dais.h;
  // Профиль выпуклый: грань рисуется веером треугольников. Крышка идёт
  // вперёд и вниз: её дальняя кромка ниже ближней, иначе в кадре она
  // поднималась бы выше кромки лица (до −13.7°) — туда, где кончик носа.
  const drop = D.drop;
  const prof = [[B.y, B.z], [A.y, A.z], [A.y - drop, D.back], [base, D.back], [base, B.z + 0.10]];
  const P = (x, p) => v3(x, p[0], p[1]);
  for (let i = 1; i < prof.length; i++) {
    const a = prof[i], b = prof[(i + 1) % prof.length];
    k.poly([P(-D.hw, a), P(D.hw, a), P(D.hw, b), P(-D.hw, b)], i === 1 ? C.panel : C.dark, i === 1 ? CMAT.paint : CMAT.trim);
  }
  k.poly(prof.map((p) => P(-D.hw, p)).reverse(), C.panel, CMAT.paint);
  k.poly(prof.map((p) => P(D.hw, p)), C.panel, CMAT.paint);
  plate(k, F, { u: [-D.hw, D.hw], v: [-D.bot, D.top] }, [
    { u: [-D.w / 2, D.w / 2], v: [-D.h / 2, D.h / 2] },
    { u: [-D.w / 2, D.w / 2], v: [D.lift - D.strip / 2, D.lift + D.strip / 2] },
  ], f, C.bezel, CMAT.trim);
  for (const s of PROM_SCREENS) {
    if (s.kind === 'wide') out[s.id] = screen(k, s, F, 0, 0, D.w, D.h);
    if (s.desk) out[s.id] = screen(k, s, F, 0, D.lift, D.w, D.strip);
  }
  // Кромка над табло — стальной валик; за ним по крышке синяя лента.
  k.tube(at(F, -D.hw, D.top, 0.006), at(F, D.hw, D.top, 0.006), 0.012, 0.012, 8, C.steelLt, CMAT.metal);
  k.poly([v3(-D.hw + 0.03, A.y + 0.0015, A.z + 0.03), v3(D.hw - 0.03, A.y + 0.0015, A.z + 0.03),
    v3(D.hw - 0.03, A.y - 0.001, A.z + 0.045), v3(-D.hw + 0.03, A.y - 0.001, A.z + 0.045)], C.ledBlue, CMAT.led, { emissive: 0.8 });
  // Клавиши на крышке: ряд под правую руку дальше, под левую — ближе.
  for (let r = 0; r < 2; r++) {
    for (let q = 0; q < 6; q++) {
      const x = -0.2 + q * 0.08, z = A.z + 0.09 + r * 0.05;
      const y = A.y - drop * ((z - A.z) / (D.back - A.z)) + 0.004;
      const lit = (r * 6 + q) % 4 === 1;
      k.box(v3(x, y, z), X, Y, Z, 0.022, 0.004, 0.014, C.key, CMAT.rubber, { top: lit ? { emissive: 0.45 } : null });
      if (lit) {
        k.poly([v3(x - 0.008, y + 0.0045, z - 0.004), v3(x + 0.008, y + 0.0045, z - 0.004),
          v3(x + 0.008, y + 0.0045, z + 0.004), v3(x - 0.008, y + 0.0045, z + 0.004)],
        q < 3 ? C.lampAmber : C.lampBlue, CMAT.lamp, { emissive: 1 });
      }
    }
  }
  // Боковины — янтарная полоса вдоль кромки лица.
  for (const s of [-1, 1]) {
    const x = s * (D.hw + 0.0015);
    k.poly([v3(x, B.y + 0.02, B.z + 0.012), v3(x, A.y - 0.02, A.z + 0.012), v3(x, A.y - 0.02, A.z + 0.03),
      v3(x, B.y + 0.02, B.z + 0.03)], C.ledAmber, CMAT.led, { emissive: 0.7 });
  }
}

/**
 * Лампы поста: подсветка из-под козырьков стоек на пульты подлокотников
 * и свет в ноги из-под консоли. Цвет — уже с силой.
 */
function lights() {
  const out = [];
  const T = PCP.tower, A = PCP.arm;
  for (const s of [-1, 1]) {
    const F = facing(s * T.az, T.el, T.d);
    const top = T.gap + T.h / 2 + T.rim;
    const pos = at(F, 0, top - 0.004, 0.05);
    const aim = v3(s * A.x, A.y, A.z1 - 0.06);
    out.push({ pos, dir: norm(sub(aim, pos)), cos: Math.cos(55 * DEG), color: [0.30, 0.27, 0.22], range: 1.1 });
  }
  const D = PCP.desk, F = facing(0, D.el, D.d);
  out.push({ pos: at(F, 0, -D.bot - 0.03, -0.02), dir: norm(v3(0, -0.8, -0.6)), cos: Math.cos(65 * DEG),
    color: [0.06, 0.12, 0.18], range: 1.0 });
  return out;
}

/**
 * Твёрдое поста для пешехода (js/game/walker.js) — коробки в осях глаза:
 * помост двумя коробками (восьмиугольник без фасок был бы шире на углах),
 * кресло с подлокотниками, консоль и обе стойки с опорами. На помост
 * шагают (30 см — меньше шага, WALK.step), сквозь кресло и стойки — нет.
 */
export function podSolids() {
  const D = PCP.dais, y0 = PCP.floorY, top = y0 + D.h;
  const out = [
    { lo: [-D.hx + D.ch, y0 - 0.3, D.z0], hi: [D.hx - D.ch, top, D.z1], dais: true },
    { lo: [-D.hx, y0 - 0.3, D.z0 + D.ch], hi: [D.hx, top, D.z1 - D.ch], dais: true },
    { lo: [-0.42, top, -0.56], hi: [0.42, 0.20, PCP.arm.z1 + 0.05], chair: true },
    { lo: [-PCP.desk.hw, top, 0.78], hi: [PCP.desk.hw, -0.26, PCP.desk.back], desk: true },
  ];
  const T = PCP.tower;
  for (const s of [-1, 1]) {
    const F = facing(s * T.az, T.el, T.d);
    const hw = T.w / 2 + T.rim, tt = T.gap + T.h / 2 + T.rim;
    const lo = [Infinity, top, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const u of [-hw, hw]) {
      for (const v of [-tt, tt + 0.02]) {
        for (const o of [0.06, -T.depth]) {
          const p = at(F, u, v, o);
          lo[0] = Math.min(lo[0], p.x); hi[0] = Math.max(hi[0], p.x);
          hi[1] = Math.max(hi[1], p.y);
          lo[2] = Math.min(lo[2], p.z); hi[2] = Math.max(hi[2], p.z);
        }
      }
    }
    out.push({ lo, hi, tower: s });
  }
  return out;
}

/**
 * Собрать пост командира.
 *
 * @param hull корпус «Прометея» (js/models/prometheus.js): из него — глаз
 * @returns то же, что buildCockpit (js/models/cockpit.js): оболочка,
 *   ручка, РУД, экраны, лампы, габарит. Стекла у поста нет — окна мостика
 *   рисует проход помещений; корпус в карту теней — тоже от помещений.
 */
export function buildPromCockpit(hull) {
  const k = new Kit();
  const screens = {};
  dais(k);
  chair(k);
  throttleGate(k);
  desk(k, screens);
  for (const s of [-1, 1]) tower(k, s, screens);
  const lo = v3(Infinity, Infinity, Infinity), hi = v3(-Infinity, -Infinity, -Infinity);
  for (const v of k.verts) {
    lo.x = Math.min(lo.x, v.x); hi.x = Math.max(hi.x, v.x);
    lo.y = Math.min(lo.y, v.y); hi.y = Math.max(hi.y, v.y);
    lo.z = Math.min(lo.z, v.z); hi.z = Math.max(hi.z, v.z);
  }
  const e = hull && hull.prom ? hull.prom.bridge.eye : [0, 0, 0];
  return {
    code: 'prometheus',
    shell: k.mesh(),
    glass: { verts: [], faces: [] },
    hull: null,
    deck: [],
    eye: v3(e[0], e[1], e[2]),
    stick: { mesh: buildStick(), pivot: v3(PCP.stick.x, PCP.stick.y, PCP.stick.z) },
    throttle: { mesh: buildThrottle(), pivot: v3(PCP.throttle.x, PCP.throttle.y, PCP.throttle.z) },
    screens,
    panes: [],
    lights: lights(),
    bound: { lo, hi },
    size: PCP,
  };
}
