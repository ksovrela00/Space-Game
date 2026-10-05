// Вездеход — наземный корабль «Челленджера»: живёт в его трюме и
// выезжает из него на грузовой платформе (js/game/airlock.js, «платформа»).
//
// ЧТО ЭТО. Тип корабля в том же ряду, что «Челленджер» и «Прометей»: у
// пилота он есть так же, как корабль, в его кресло садятся так же — приняв
// командование, — и сервер хранит его как корабль. Своё у него — колёса
// вместо двигателей: летать он не умеет, а ездит (js/game/rover.js).
//
// ЧТО ВНУТРИ. Герметичный кузов: шлюз-коридор с дверью на левом борту и
// кабина на одного у лобового стекла. Дверь — тот же люк, что у корабля:
// цикл давления, створка, выдвижной трап (js/game/airlock.js). Помещения —
// js/models/interior.rover.js, пост водителя — js/models/cockpit.rover.js.
//
// РАЗМЕР — ОТ АНГАРА. Ровер обязан встать на платформу (5.8 × 8.8 м) и
// подняться в трюм высотой 3.32 м. Отсюда всё остальное:
//
//   * высота 3.1 м по крыше и 3.2 по балке огней — под потолком трюма
//     остаётся 12 см (лампы выступают на пять);
//   * пол внутри на 1.15 м над грунтом — над колёсами, а потолок на 3.0:
//     внутри 1.85 м, пилот ростом 1.8 проходит не пригибаясь;
//   * колёса снаружи кузова, по 3.5 м в ширину по шинам — с запасом в 2.3
//     м до краёв платформы;
//   * колёса стоят неровно — 2.3, 0.55 и −2.25 м по длине: между средним и
//     задним — 1.7 м пустого борта, и в нём дверь с трапом шириной 1.4 м.
//     При ровном шаге трап упирался бы в колесо.
//
// Оси — как у корабля: x вправо, y вверх, z вперёд, метры. Начало — на
// грунте под серединой кузова: у вездехода это и есть точка, на которую
// он «садится» (у корабля начало в центре масс, и до грунта — длина стоек).

import { v3 } from '../core/vec3.js';
import { Kit } from './kit.js';
import { MAT } from './hulldetail.js';

export const RV = {
  code: 'rover',
  // Кузов: бока x = ±side, низ bottom, крыша top (по кромкам — roof), лоб —
  // от windZ по крыше до носа на высоте nose.
  // Лоб низкий — 1.6 м: глаз водителя на 2.35, и с носом выше стекло
  // оказывалось над глазом, а дорогу перед машиной закрывал нос (ниже −7°).
  // С ним лобовое стекло опускается до −26° от горизонта.
  // Фаска — 0.3 м: плоский борт до 2.8, и дверь в нём целиком. С фаской в
  // 0.5 борт кончался на 2.6, а проём двери (до 2.95) уходил в фаску — верх
  // тоннеля и панель двери вылезали из кузова.
  body: { z0: -3.0, z1: 3.0, side: 1.25, roof: 1.0, bottom: 0.8, top: 3.1, chamfer: 0.3, windZ: 1.6, nose: 1.6 },
  floor: 1.15,                 // пол внутри
  ceil: 3.0,                   // потолок внутри
  // Колёса: радиус, ширина шины, колея (центр по x) и места по длине.
  // steer — какие ось поворачивают: передняя и задняя, в разные стороны
  // (разворот вдвое теснее), средняя — нет.
  wheel: { r: 0.55, w: 0.42, x: 1.55, z: [2.3, 0.55, -2.25], steer: [1, 0, -1] },
  // Дверь — люк левого борта: панель утоплена на 5 см (inset), проём — по
  // ней. Между средним и задним колесом. В высоту 1.6 м — под фаской крыши:
  // пилот ростом 1.8 в ней пригибается сам (js/game/walker.js, duck), как в
  // бортовом люке корабля на склоне.
  door: { id: 'rdoor', side: -1, skin: 1.25, inset: 1.2, z: [-1.3, -0.4], y: [1.15, 2.75] },
  // Глаз водителя в кресле.
  eye: [0, 2.35, 1.45],
  roofBar: 3.2,                // верх балки огней — самая высокая точка
};

// Палитра: светлый корпус с янтарными полосами — тот же язык, что у
// «Челленджера» (янтарь на поручнях, трапах и рукоятках), шины — графит.
const C = {
  hull: [168, 172, 176],
  hullDk: [118, 122, 128],
  panel: [140, 145, 150],
  under: [58, 61, 66],
  amber: [206, 132, 46],
  dark: [36, 38, 42],
  glass: [40, 58, 70],
  lamp: [255, 240, 210],
  red: [220, 50, 40],
  tire: [34, 35, 38],
  tread: [26, 27, 29],
  hub: [150, 156, 162],
  hubDk: [96, 101, 108],
};

/** Сечение кузова на высоте крыши top: шестиугольник с фасками. */
function section(top, side = RV.body.side, roof = RV.body.roof) {
  const B = RV.body;
  return [[-side, B.bottom], [side, B.bottom], [side, top - B.chamfer], [roof, top], [-roof, top], [-side, top - B.chamfer]];
}

/**
 * Кузов вездехода (км, оси выше). Сетка мира, как у кораблей: её рисует
 * сцена, а изнутри — проход корпуса изнутри (стёкла лба сквозные).
 */
export function buildRover() {
  const k = new Kit(7);
  const B = RV.body, D = RV.door;
  // Рёбра сечения: 0 — низ, 1 — правый борт, 2 — правая фаска, 3 — крыша,
  // 4 — левая фаска, 5 — левый борт. Пролёты: 0 — корма, 1 — середина,
  // 2 — лоб. Лобовое стекло — крыша и фаски на лбу; левый борт середины
  // строится отдельно — в нём дверь.
  const glass = (i, kk) => kk === 2 && (i === 2 || i === 3 || i === 4);
  k.loft('z', [
    { t: B.z0, p: section(2.8, 1.2, 0.95) },
    { t: B.z0 + 0.3, p: section(B.top) },
    { t: B.windZ, p: section(B.top) },
    { t: B.z1, p: [[-1.25, B.bottom], [1.25, B.bottom], [1.25, B.nose - 0.25], [1.05, B.nose], [-1.05, B.nose], [-1.25, B.nose - 0.25]] },
  ], {
    c: (i, kk) => (glass(i, kk) ? C.glass : i === 0 ? C.under : kk === 0 ? C.hullDk : k.tone(C.hull, 0.03)),
    mats: (i, kk) => (glass(i, kk) ? MAT.clear : i === 0 ? MAT.plain : MAT.plate),
    skip: (i, kk) => i === 5 && kk === 1,
  });
  // Левый борт середины — с проёмом двери, и сама дверь — утопленная
  // панель (её вырезает и подменяет створкой шлюз, js/game/airlock.js).
  const zA = B.z0 + 0.3, zB = B.windZ, yT = B.top - B.chamfer;
  k.panel({ O: [-B.side, 0, 0], U: [0, 0, 1], V: [0, 1, 0], N: [-1, 0, 0] },
    [[zA, B.bottom], [zB, B.bottom], [zB, yT], [zA, yT]],
    [[[D.z[0], D.y[0]], [D.z[1], D.y[0]], [D.z[1], D.y[1]], [D.z[0], D.y[1]]]], C.hull, MAT.plate);
  // Ниша двери: щёки от обшивки до панели и сама панель.
  const x0 = -D.skin, x1 = -D.inset;
  k.face([[x0, D.y[0], D.z[0]], [x1, D.y[0], D.z[0]], [x1, D.y[1], D.z[0]], [x0, D.y[1], D.z[0]]], C.hullDk, MAT.plain, [0, 0, 1]);
  k.face([[x0, D.y[0], D.z[1]], [x0, D.y[1], D.z[1]], [x1, D.y[1], D.z[1]], [x1, D.y[0], D.z[1]]], C.hullDk, MAT.plain, [0, 0, -1]);
  k.face([[x0, D.y[1], D.z[0]], [x1, D.y[1], D.z[0]], [x1, D.y[1], D.z[1]], [x0, D.y[1], D.z[1]]], C.hullDk, MAT.plain, [0, -1, 0]);
  k.face([[x0, D.y[0], D.z[0]], [x0, D.y[0], D.z[1]], [x1, D.y[0], D.z[1]], [x1, D.y[0], D.z[0]]], C.hullDk, MAT.plain, [0, 1, 0]);
  k.face([[x1, D.y[0], D.z[0]], [x1, D.y[0], D.z[1]], [x1, D.y[1], D.z[1]], [x1, D.y[1], D.z[0]]], C.panel, MAT.plate, [-1, 0, 0]);
  // Рама двери — янтарная, как у люков корабля: её видно издали.
  const fr = 0.06, xo = -B.side - 0.012;
  for (const [a, b] of [[[D.z[0] - fr, D.y[0] - fr], [D.z[1] + fr, D.y[0]]], [[D.z[0] - fr, D.y[1]], [D.z[1] + fr, D.y[1] + fr]],
    [[D.z[0] - fr, D.y[0]], [D.z[0], D.y[1]]], [[D.z[1], D.y[0]], [D.z[1] + fr, D.y[1]]]]) {
    k.face([[xo, a[1], a[0]], [xo, a[1], b[0]], [xo, b[1], b[0]], [xo, b[1], a[0]]], C.amber, MAT.plain, [-1, 0, 0]);
  }

  // Днище — ходовая между колёсами: короб рамы и мосты к колёсам.
  k.box(-0.95, 0.95, 0.5, B.bottom + 0.02, B.z0 + 0.2, B.z1 - 0.2, { c: C.under, mat: MAT.plain, solid: false });
  const W = RV.wheel;
  for (const z of W.z) {
    for (const s of [-1, 1]) {
      // Рычаг подвески: от рамы к ступице.
      k.box(s > 0 ? 0.9 : -W.x + W.w / 2 - 0.02, s > 0 ? W.x - W.w / 2 + 0.02 : -0.9, W.r - 0.09, W.r + 0.09, z - 0.12, z + 0.12,
        { c: C.dark, mat: MAT.plain, solid: false });
      // Крыло над колесом: полка с наклонными краями.
      const xa = s * B.side, xb = s * (W.x + W.w / 2 + 0.06);
      const y = W.r * 2 + 0.24, zf = z + W.r + 0.15, zr = z - W.r - 0.15;
      const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
      k.box(lo, hi, y, y + 0.07, zr, zf, { c: C.hullDk, mat: MAT.plain, solid: false });
      for (const [za, zb] of [[zf, zf + 0.35], [zr, zr - 0.35]]) {
        k.face([[lo, y, za], [hi, y, za], [hi, y - 0.32, zb], [lo, y - 0.32, zb]], C.hullDk, MAT.plain, [0, 1, Math.sign(zb - za)]);
      }
    }
  }

  // Бамперы: лебёдочный короб впереди, ящик снаряжения сзади.
  k.box(-1.1, 1.1, 0.6, 1.25, B.z1 - 0.05, B.z1 + 0.32, { c: C.dark, mat: MAT.plain, solid: false, ch: 0.08 });
  k.box(-0.35, 0.35, 0.8, 1.05, B.z1 + 0.32, B.z1 + 0.4, { c: C.amber, mat: MAT.plain, solid: false });
  k.box(-1.05, 1.05, 0.65, 1.6, B.z0 - 0.35, B.z0 + 0.02, { c: C.hullDk, mat: MAT.plain, solid: false, ch: 0.06 });

  // Полоса янтаря вдоль бортов и фары.
  for (const s of [-1, 1]) {
    const x = s * (B.side + 0.005);
    k.face([[x, 1.62, B.z0 + 0.3], [x, 1.62, D.z[0] - 0.1], [x, 1.7, D.z[0] - 0.1], [x, 1.7, B.z0 + 0.3]], C.amber, MAT.plain, [s, 0, 0], { decal: true });
    k.face([[x, 1.62, s < 0 ? D.z[1] + 0.1 : B.z0 + 0.3], [x, 1.62, B.windZ], [x, 1.7, B.windZ], [x, 1.7, s < 0 ? D.z[1] + 0.1 : B.z0 + 0.3]],
      C.amber, MAT.plain, [s, 0, 0], { decal: true });
    // Фары на лбу, над бампером.
    k.face([[s * 0.55, 1.12, B.z1 + 0.005], [s * 1.0, 1.12, B.z1 + 0.005], [s * 1.0, 1.28, B.z1 + 0.005], [s * 0.55, 1.28, B.z1 + 0.005]],
      C.lamp, MAT.plain, [0, 0, 1], { decal: true, emissive: 0.9 });
    // Задние огни.
    k.face([[s * 0.65, 1.95, B.z0 - 0.005], [s * 1.05, 1.95, B.z0 - 0.005], [s * 1.05, 2.1, B.z0 - 0.005], [s * 0.65, 2.1, B.z0 - 0.005]],
      C.red, MAT.plain, [0, 0, -1], { decal: true, emissive: 0.7 });
    // Боковые окна кабины — тёмные накладки: из кабины видно лобовое.
    const xw = s * (B.side + 0.006);
    k.face([[xw, 2.05, 0.75], [xw, 2.05, 1.45], [xw, 2.5, 1.45], [xw, 2.5, 0.75]], C.glass, MAT.window, [s, 0, 0], { decal: true });
  }
  // Балка огней и мачта связи на крыше.
  k.box(-0.85, 0.85, B.top, B.top + 0.06, 1.0, 1.25, { c: C.dark, mat: MAT.plain, solid: false });
  for (const x of [-0.6, -0.2, 0.2, 0.6]) {
    k.face([[x - 0.14, B.top + 0.02, 1.252], [x + 0.14, B.top + 0.02, 1.252], [x + 0.14, RV.roofBar, 1.252], [x - 0.14, RV.roofBar, 1.252]],
      C.lamp, MAT.plain, [0, 0, 1], { emissive: 0.8 });
    k.box(x - 0.15, x + 0.15, B.top + 0.06, RV.roofBar, 1.06, 1.25, { c: C.dark, mat: MAT.plain, solid: false });
  }
  k.box(-0.06, 0.06, B.top, RV.roofBar - 0.02, -2.4, -2.28, { c: C.hubDk, mat: MAT.plain, solid: false });
  k.box(0.55, 0.85, B.top, B.top + 0.12, -1.6, -0.9, { c: C.hullDk, mat: MAT.plain, solid: false, ch: 0.04 });

  // В километры (начало осей — на грунте, сдвига нет).
  const vol = volumeOf(k);
  const M = 1000;
  for (const part of [k, k.decal]) for (const v of part.verts) { v.x /= M; v.y /= M; v.z /= M; }
  const mesh = { verts: k.verts, faces: k.faces, decal: k.decal };
  mesh.name = 'ROVER';
  mesh.length = (B.z1 + 0.4 - B.z0 + 0.35) / M;
  mesh.exhausts = [];
  mesh.rcs = [];
  mesh.guns = [];
  mesh.navLights = [];
  mesh.eye = v3(RV.eye[0] / M, RV.eye[1] / M, RV.eye[2] / M);
  mesh.volumeM3 = vol;
  let bound = 0;
  for (const v of mesh.verts) bound = Math.max(bound, Math.hypot(v.x, v.y, v.z));
  mesh.bound = bound;
  mesh.rover = { inside: (x, y, z, pad = 0) => k.inside(x, y, z, pad) };
  return mesh;
}

/** Объём кузова — по решётке в 10 см (кузов маленький, решётка точная). */
function volumeOf(k, step = 0.1) {
  const B = RV.body;
  let n = 0;
  for (let x = -B.side; x < B.side; x += step) {
    for (let y = B.bottom; y < B.top; y += step) {
      for (let z = B.z0; z < B.z1; z += step) if (k.inside(x + step / 2, y + step / 2, z + step / 2)) n++;
    }
  }
  return n * step * step * step;
}

/**
 * Колесо (км, оси колеса: x — по оси вращения наружу, начало — в центре).
 * Шина с грунтозацепами и ступица с пятью спицами: по ним видно, что колесо
 * крутится, — у гладкого цилиндра вращения не разглядеть.
 */
export function buildWheel() {
  const k = new Kit(3);
  const W = RV.wheel, hw = W.w / 2, n = 18;
  k.cyl('x', 0, 0, -hw, hw, W.r - 0.035, n, { c: C.tire, mat: MAT.plain, solid: false });
  // Грунтозацепы — бруски поперёк протектора.
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const r0 = W.r - 0.04, r1 = W.r;
    const t = [-sa, ca], half = 0.055;
    const p = (r, s) => [ca * r + t[0] * half * s, sa * r + t[1] * half * s];
    const q = [p(r0, -1), p(r1, -1), p(r1, 1), p(r0, 1)];
    const off = i % 2 ? 0.05 : -0.05;
    k.loft('x', [{ t: -hw + 0.02 + off, p: q.map(([y, z]) => [y, z]) }, { t: hw - 0.02 + off, p: q.map(([y, z]) => [y, z]) }],
      { c: C.tread, mat: MAT.plain, solid: false });
  }
  // Ступица и спицы — на наружной стороне.
  k.cyl('x', 0, 0, hw - 0.02, hw + 0.03, 0.26, 12, { c: C.hub, mat: MAT.plain, solid: false });
  k.cyl('x', 0, 0, hw + 0.03, hw + 0.07, 0.09, 8, { c: C.amber, mat: MAT.plain, solid: false });
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    const y = Math.cos(a), z = Math.sin(a);
    k.face([[hw + 0.032, y * 0.1 - z * 0.03, z * 0.1 + y * 0.03], [hw + 0.032, y * 0.42 - z * 0.04, z * 0.42 + y * 0.04],
      [hw + 0.032, y * 0.42 + z * 0.04, z * 0.42 - y * 0.04], [hw + 0.032, y * 0.1 + z * 0.03, z * 0.1 - y * 0.03]],
    C.hubDk, MAT.plain, [1, 0, 0]);
  }
  const M = 1000;
  for (const v of k.verts) { v.x /= M; v.y /= M; v.z /= M; }
  return { verts: k.verts, faces: k.faces };
}

/**
 * «Шасси» вездехода — в том виде, в каком корпусам его читает игра
 * (js/game/hull.js): точки крепления и длины. У колеса точка крепления —
 * центр, длина — радиус, и просвет «на шасси» выходит нулевым: начало осей
 * и так на грунте.
 */
export function buildRoverGear() {
  const W = RV.wheel, M = 1000;
  const hardpoints = [], legLengths = [];
  for (const z of W.z) for (const s of [-1, 1]) { hardpoints.push(v3(s * W.x / M, W.r / M, z / M)); legLengths.push(W.r / M); }
  return { hardpoints, legLengths, legs: [], legLength: W.r / M, wheels: true };
}
