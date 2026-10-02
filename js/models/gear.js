// Стойки шасси: телескоп в три ступени, гидроцилиндр, подкос, шаровой
// шарнир и пята.
//
// ЧТО БЫЛО. Стойка — брусок в 13 см с плиткой на конце, одна на всех и
// растянутая на длину ноги. Растягивалась она целиком, вместе с пятой:
// под кораблём в 1 682 т стояли три палочки толщиной полметра — «куриные
// ноги». Растяжка была нужна потому, что стойка выезжает, а другого
// способа показать выезд у единичной сетки нет.
//
// КАК ТЕПЕРЬ. Стойка — ступени, вложенные одна в другую, и каждая
// ступень только ЕДЕТ, а не растягивается: гильза, средняя ступень и
// хромированный шток с пятой. Выезд делится между ними поровну (доли
// 1/3, 2/3 и 1 хода), как у настоящего телескопа, и на любой его доле
// пята остаётся пятой. Убрана — всё собрано в нише над точкой крепления.
//
// РАЗМЕР — ОТ ВЕСА, а не на глаз (LEG ниже). Вес делит статика треноги:
// у «Челленджера» центр масс ровно посередине между носовой стойкой и
// главными, и нос несёт половину — 840 т при 1 g, это два A380 на одной
// ноге; главные — по 420 т. Площадь штока — нагрузка, делённая на
// давление в амортизаторе, отсюда гильза в метр с лишним у носа. Пята —
// нагрузка, делённая на то, что держит грунт: у носовой три с четвертью
// метра в поперечнике. У «Прометея» (38 тысяч тонн) те же формулы дают
// сдвоенные стойки по три метра и пяты по тринадцать.
//
// Всё в метрах при сборке, в километрах на выходе — как корпус.

import { MAT } from './hulldetail.js';
import { Kit } from './kit.js';
import { v3 } from '../core/vec3.js';

/**
 * Расчёт стоек. Числа — не размеры, а то, что выдерживает материал.
 */
export const LEG = {
  // Давление масла в амортизаторе. У авиационных стоек 15–20 МПа: по
  // нему и нагрузке выходит площадь штока, а из неё — его радиус.
  oleo: 20e6,              // Па
  // Шток в модели — 0.6 радиуса гильзы (ступени вложены одна в другую).
  pistonK: 0.6,
  // Что держит грунт под пятой: плотный гравий и скала — около мегапаскаля.
  // На мягком грунте пята проседает, и на это у стойки есть ход.
  ground: 1e6,             // Па
  // Стойка считается на 1 g: тяжелее тел, где садятся, в игре почти нет,
  // а на лёгких запас только растёт.
  g: 9.81,
  // Ход стойки на неровном грунте, м — тот же, что у посадки
  // (LAND.strut, js/game/landing.js; проверка сверяет). На полном ходе
  // соседние ступени расходятся на треть его, и заходить одна в другую
  // им надо с этим запасом — иначе между ними светится щель.
  stroke: 1.5,
};

/**
 * Как вес делится между тремя пятами: статика треноги. Доли — это
 * барицентрические координаты центра масс (x, z) в треугольнике пят.
 */
export function tripodShares(feet, cm = [0, 0]) {
  const [a, b, c] = feet;
  const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const wa = ((b[1] - c[1]) * (cm[0] - c[0]) + (c[0] - b[0]) * (cm[1] - c[1])) / det;
  const wb = ((c[1] - a[1]) * (cm[0] - c[0]) + (a[0] - c[0]) * (cm[1] - c[1])) / det;
  return [wa, wb, 1 - wa - wb];
}

/**
 * Размер стойки по нагрузке (кг на ногу): радиус гильзы (м) и площадь
 * пяты (м²). twin — две стойки на одну пяту, нагрузка пополам.
 */
export function sizeLeg(loadKg, twin = false) {
  const F = loadKg * LEG.g;
  const per = twin ? F / 2 : F;
  const rp = Math.sqrt(per / LEG.oleo / Math.PI);
  return { r: rp / LEG.pistonK, padArea: F / LEG.ground, force: F };
}

const COL = {
  housing: [126, 130, 138],
  stage: [150, 154, 162],
  chrome: [204, 208, 214],
  pad: [86, 90, 98],
  rib: [112, 116, 124],
  dark: [58, 61, 68],
  hydraulic: [70, 74, 82],
  band: [196, 150, 64],        // янтарная полоса на гильзе — как поручни трапа
};

/** Балка прямоугольного сечения между точками a и b (м). */
function beam(kit, a, b, w, h, c) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(...d);
  const f = d.map((x) => x / L);
  const ref = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let s = [f[1] * ref[2] - f[2] * ref[1], f[2] * ref[0] - f[0] * ref[2], f[0] * ref[1] - f[1] * ref[0]];
  const sl = Math.hypot(...s); s = s.map((x) => x / sl);
  const u = [s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]];
  const P = [];
  for (const end of [a, b]) {
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      P.push([end[0] + s[0] * w / 2 * i + u[0] * h / 2 * j, end[1] + s[1] * w / 2 * i + u[1] * h / 2 * j, end[2] + s[2] * w / 2 * i + u[2] * h / 2 * j]);
    }
  }
  const neg = (v) => v.map((x) => -x);
  kit.face([P[0], P[1], P[2], P[3]], c, MAT.plain, neg(f));
  kit.face([P[4], P[5], P[6], P[7]], c, MAT.plain, f);
  kit.face([P[0], P[1], P[5], P[4]], c, MAT.plain, neg(u));
  kit.face([P[3], P[2], P[6], P[7]], c, MAT.plain, u);
  kit.face([P[0], P[3], P[7], P[4]], c, MAT.plain, neg(s));
  kit.face([P[1], P[2], P[6], P[5]], c, MAT.plain, s);
}

// Кольцо-хомут на ступени (ровно на высоте y).
const collar = (kit, x, z, y, r, h, c) => kit.cyl('y', x, z, y - h / 2, y + h / 2, r, 16, { c, mat: MAT.plain, solid: false });

/** Пята: плита, ступица и рёбра от ступицы к краю. */
function footPad(kit, x, z, yb, pad) {
  const { w, l, h } = pad;
  const hub = Math.min(w, l) * 0.2;
  if (pad.kind === 'disc') {
    const r = w / 2;
    kit.cyl('y', x, z, yb, yb + h * 0.7, r, 16, { c: COL.pad, mat: MAT.plain, solid: false });
    kit.cyl('y', x, z, yb + h * 0.7, yb + h, r * 0.92, 16, { c: COL.pad, mat: MAT.plain, solid: false, r1: r * 0.84 });
    kit.cyl('y', x, z, yb + h, yb + h * 2.1, hub, 12, { c: COL.rib, mat: MAT.plain, solid: false, r1: hub * 0.75 });
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      beam(kit, [x + ca * hub * 0.9, yb + h * 1.55, z + sa * hub * 0.9], [x + ca * r * 0.8, yb + h * 1.02, z + sa * r * 0.8], h * 0.35, h * 0.5, COL.rib);
    }
  } else {
    kit.box(x - w / 2, x + w / 2, yb, yb + h, z - l / 2, z + l / 2, { c: COL.pad, mat: MAT.plain, solid: false, ch: h * 0.3 });
    kit.box(x - hub, x + hub, yb + h, yb + h * 1.9, z - hub, z + hub, { c: COL.rib, mat: MAT.plain, solid: false, ch: h * 0.2 });
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      beam(kit, [x + dx * hub, yb + h * 1.45, z + dz * hub], [x + dx * (w / 2 - h * 0.6), yb + h * 1.02, z + dz * (l / 2 - h * 0.6)], h * 0.45, h * 0.6, COL.rib);
    }
  }
}

/**
 * Стойки корабля. legs — [{ at: [x, y, z] (м, оси модели — точка
 * крепления), len (м, от неё до низа пяты), r (радиус гильзы, м), pad:
 * { kind: 'disc'|'skid', w, l, h }, twin (м — две стойки на одну пяту,
 * расстояние между ними; 0 — одна), brace: [dx, dz] (куда от стойки
 * уходит подкос, м) }].
 *
 * Возвращает то же, что прежний buildGear (точки крепления и длины —
 * в км), и сами ступени: legs[i].parts — [{ mesh, k }], k — доля хода, с
 * которой ступень едет. Рисует их js/gl/scene.js (drawGearOf).
 */
export function buildLegs(legs) {
  const M = 1000;
  const out = { hardpoints: [], legLengths: [], legs: [] };
  for (const g of legs) {
    const [hx0, hy0, hz0] = g.at;
    // Ступени строятся в осях точки крепления: их рисуют от неё,
    // каждую со своим подъёмом (stageLift).
    const x = 0, z = 0;
    const L = g.len, r = g.r, pad = g.pad;
    const padH = pad.h * 2.1;                 // пята со ступицей
    const T = Math.max(0.6, L - padH - r * 0.6);   // видимый телескоп, от крепления до шарнира
    const ov = T * 0.12 + LEG.stroke / 3;     // ступени заходят одна в другую
    const xs = g.twin ? [x - g.twin / 2, x + g.twin / 2] : [x];
    const parts = [new Kit(1), new Kit(2), new Kit(3)];   // k = 1/3, 2/3, 1
    const [K1, K2, K3] = parts;
    for (const sx of xs) {
      // Гильза с хомутами и янтарной полосой: её видно издали.
      K1.cyl('y', sx, z, -T / 3, 0.8, r, 16, { c: COL.housing, mat: MAT.plain, solid: false });
      collar(K1, sx, z, -T / 3 + 0.08 * r, r * 1.14, r * 0.28, COL.dark);
      collar(K1, sx, z, -T / 6, r * 1.03, r * 0.4, COL.band);
      // Средняя ступень.
      K2.cyl('y', sx, z, -2 * T / 3, -T / 3 + ov, r * 0.8, 16, { c: COL.stage, mat: MAT.plain, solid: false });
      collar(K2, sx, z, -2 * T / 3 + 0.08 * r, r * 0.92, r * 0.24, COL.dark);
      // Шток — хром.
      K3.cyl('y', sx, z, -T, -2 * T / 3 + ov, r * 0.6, 16, { c: COL.chrome, mat: MAT.plain, solid: false });
      // Подкос: от корпуса к гильзе, едет вместе с ней.
      const [bx, bz] = g.brace;
      beam(K1, [sx + bx, 0.6, z + bz], [sx + bx * 0.12, -T / 3 * 0.75, z + bz * 0.12], r * 0.5, r * 0.62, COL.housing);
      // Гидроцилиндр выпуска — сбоку, против подкоса: корпус на гильзе,
      // шток — на средней ступени.
      const hx = sx - Math.sign(bx) * r * 1.45, hz = z - Math.sign(bz) * r * 1.45;
      K1.cyl('y', hx, hz, -T * 0.36, 0.5, r * 0.24, 10, { c: COL.hydraulic, mat: MAT.plain, solid: false });
      K2.cyl('y', hx, hz, -T * 0.62, -T * 0.36 + ov, r * 0.13, 8, { c: COL.chrome, mat: MAT.plain, solid: false });
      beam(K2, [hx, -T * 0.62, hz], [sx, -T * 0.62, z], r * 0.3, r * 0.3, COL.dark);
      // Шаровой шарнир у пяты.
      K3.sphere(sx, -T - r * 0.25, z, r * 0.78, COL.dark, 12, 6);
    }
    // Две стойки — одна пята и поперечина между штоками.
    if (g.twin) beam(K3, [xs[0], -T * 0.88, z], [xs[1], -T * 0.88, z], r * 0.5, r * 0.6, COL.housing);
    footPad(K3, x, z, -L, pad);
    // В оси модели и в км: точка крепления — начало ступеней.
    const km = (kit) => {
      const v = kit.verts.map((p) => v3(p.x / M, p.y / M, p.z / M));
      let bound = 0;
      for (const p of v) bound = Math.max(bound, Math.hypot(p.x, p.y, p.z));
      return { verts: v, faces: kit.faces, bound };
    };
    out.hardpoints.push(v3(hx0 / M, hy0 / M, hz0 / M));
    out.legLengths.push(L / M);
    out.legs.push({
      parts: [{ mesh: km(K1), k: 1 / 3 }, { mesh: km(K2), k: 2 / 3 }, { mesh: km(K3), k: 1 }],
      r: r / M, pad: { kind: pad.kind, w: pad.w / M, l: pad.l / M, h: padH / M },
      width: (g.twin ? g.twin + 2 * r : 2 * r) / M,
    });
  }
  out.legLength = Math.max(...out.legLengths);
  return out;
}

/**
 * Где ступени стойки при выпуске t (0..1) и ходе drop (км): насколько
 * поднята каждая против полного выпуска (км, вдоль «вверх» корабля).
 * Полный выпуск — ноль; убрана — каждая поднята на свою долю длины.
 */
export function stageLift(leg, len, drop, t, k) {
  const ext = (len + drop) * t;
  return (len - ext) * k;
}

/**
 * Твёрдое стойки для пешехода (оси корабля, м): ствол и пята при выпуске
 * ext (м — от точки крепления до низа пяты).
 */
export function legBoxes(leg, hp, ext, out, i) {
  const x = hp.x * 1000, y = hp.y * 1000, z = hp.z * 1000;
  const hw = leg.width * 500, pw = leg.pad.w * 500, pl = leg.pad.l * 500, ph = leg.pad.h * 1000;
  out.push({ lo: [x - hw, y - ext + ph * 0.5, z - leg.r * 1000], hi: [x + hw, y, z + leg.r * 1000], gear: i });
  out.push({ lo: [x - pw, y - ext, z - pl], hi: [x + pw, y - ext + ph * 0.5, z + pl], gear: i });
}
