// «Прометей» — боевой крейсер BC-303 (вселенная «Звёздных врат»).
//
// ОТКУДА ФОРМА. Готовой модели под открытой лицензией нет: в сети
// лежат фанатские, под CC-BY, для 3D-печати (без цветов, сотни тысяч
// граней) — и скачать их можно только с учётной записью. Поэтому
// корпус собран здесь кодом из простых тел (js/models/kit.js) по
// рендерам Victor Keyes (blenderartists.org, тема 633211) и по канону
// сериала. Заодно это даёт то, чего у чужой модели не было бы: окна
// стоят на палубах, люки — у помещений шлюзов, ниши шасси — над
// стойками, и проверка знает, где всё это должно быть.
//
// ЧТО ВЗЯТО ИЗ КАНОНА (StargateWiki, «Prometheus: Construction Features
// and Compartments», «Propulsion and Maneuvering»):
//
//   * габарит 195 × 80 × 65 м — втрое длиннее «Челленджера» (65 м);
//   * шасси — ТРЕНОГА: одна стойка в носу, две в корме; под тонким
//     средним корпусом опор нет;
//   * трюм и ангар — в носу («Fwd Cargo Hangar»), ворота смотрят вперёд;
//   * шлюзы — вдоль среднего корпуса;
//   * каюты экипажа — в корме, над двумя маршевыми двигателями;
//   * прямоугольные гондолы гипердвигателя — по бокам кормы, на их
//     передних стенках — тормозные сопла (те самые треугольные ниши);
//   * антигравитационный блок — внизу кормы (здесь: решётки подъёмных
//     двигателей на днище);
//   * рубка — наверху башни-«острова» (корабль задуман авианосцем), у неё
//     три больших смотровых окна вперёд.
//
// ОСИ СБОРКИ — метры: z от кормы (срез сопел, 0) к носу (195), y от
// киля среднего корпуса (0) вверх, x — вправо (правый борт, как у
// «Челленджера», js/models/ships.js). В оси модели (км, центр в нуле)
// корпус переводит buildPrometheus в самом конце, и начало осей — в
// центре масс: вокруг него корабль вертится.

import { v3 } from '../core/vec3.js';
import { MAT, DETAIL } from './hulldetail.js';
import { Kit, mirror, inset, rectCh } from './kit.js';
import { rcsPorts, HULL_DENSITY } from './ships.js';
import { buildLegs, tripodShares, sizeLeg } from './gear.js';

// --- цвета --------------------------------------------------------------------
//
// Канонический «Прометей» — тёмный оружейный металл. Совсем тёмным его
// делать нельзя: в космосе свет один, и тёмный корпус на чёрном небе
// читается дыркой (см. цвета станций, js/models/stations.js). Поэтому
// средне-серый, а глубину дают ниши, полки и швы.
const COL = {
  deck: [146, 149, 156],
  side: [128, 132, 140],
  under: [100, 104, 112],
  edge: [118, 122, 130],
  dark: [42, 45, 51],
  slot: [30, 32, 37],
  greeble: [112, 116, 124],
  greebleDk: [86, 90, 98],
  metal: [100, 104, 112],
  nozzle: [64, 67, 74],
  rib: [122, 126, 134],
  glass: [26, 34, 44],
  bay: [168, 142, 98],        // нутро ангара: тёплый свет за воротами
  hyper: [96, 150, 255],      // гипердвигатель светится синим (канон)
  burn: [255, 150, 70],       // жар в сопле маршевого
  hatch: [112, 116, 124],
  mast: [150, 154, 160],
};

// Цвет грани по тому, куда она смотрит: крыша светлее борта, днище
// темнее. Свет в игре один, и без этого торцы и полки сливались бы.
const byNormal = (kit, top = COL.deck, side = COL.side, bot = COL.under) => (i, k, out) => {
  if (!out) return kit.tone(top);
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  const ny = out[1] / l;
  return kit.tone(ny > 0.6 ? top : ny < -0.6 ? bot : side);
};

// --- проект -------------------------------------------------------------------

/**
 * Проект корабля: всё, на что опираются модель, проверки и (дальше)
 * помещения, шлюзы и шасси. Оси сборки, метры.
 */
export const PROM = {
  code: 'prometheus',
  name: 'Prometheus',
  length: 195,
  // Палубы — шагом в четыре метра: стена пака помещений 3.32 м
  // (js/models/interior.js, масштаб 0.75) и перекрытие. Номера — как в
  // сериале: первая палуба — рубка, дальше вниз.
  decks: [
    { n: 1, floor: 46, where: 'башня', what: 'рубка: кресло командира, рулевой справа, штурман слева, звёздная карта позади' },
    { n: 2, floor: 42, where: 'башня', what: 'пост управления полётами (авианосец), каюта командира' },
    { n: 3, floor: 38, where: 'башня', what: 'связь и сенсоры' },
    { n: 4, floor: 34, where: 'башня', what: 'зал совещаний с окном в шесть створок' },
    { n: 5, floor: 30, where: 'башня', what: 'каюты офицеров, гауптвахта' },
    { n: 6, floor: 26, where: 'башня', what: 'вестибюль лифта; выход на верхнюю палубу — к стыковочному узлу' },
    { n: 7, floor: 22, where: 'корпус', what: 'жилая палуба кормы (над маршевыми), кают-компания с окном' },
    { n: 8, floor: 18, where: 'корпус', what: 'каюты экипажа, медотсек — иллюминаторы по бортам среднего корпуса' },
    { n: 9, floor: 14, where: 'корпус', what: 'арсенал, склады; желоб с башнями ПРО снаружи' },
    { n: 10, floor: 10, where: 'корпус', what: 'машинное отделение кормы, реактор' },
    { n: 11, floor: 6, where: 'корпус', what: 'шлюзы среднего корпуса (выход в пустоту), стыковочные узлы по бортам' },
    { n: 12, floor: 2, where: 'корпус', what: 'трюмные коридоры, топливо' },
    { n: 13, floor: -3, where: 'нос', what: 'носовой ангар-трюм в две палубы высотой; бортовые шлюзы с трапами на грунт' },
  ],
  // Где пяты касаются грунта на шасси. Днище гондол на y = −9, нос — на
  // −7.5; стойки выходят из колодцев глубиной 2.2 м. Ниже грунт — длиннее
  // трапы: порог бортового шлюза носа и так в десяти метрах над землёй.
  ground: -13.5,
};

// Глаз командира на мостике (оси сборки, м): кресло в 4.5 м от стекла,
// глаз на 1.6 м над палубой 1. Ближе — окно на весь кадр, и рубки не видно
// вовсе; дальше — нос уходит под подоконник. Отсюда подоконник на 16° ниже
// горизонта, кончик носа — на 13°: палуба видна до самого носа, а рамы
// окон обрамляют кадр.
const BRIDGE_EYE = [0, 47.6, 66.5];

// Лоб носа: на 0.8 м позади габарита — столько выступают козырьки ворот.
const BOW_Z = 194.2;
// Высота спины носа: от плеч (z = 158, y = 29) вниз к воротам (y = 18).
const bowRoof = (z) => 29 - 11 * Math.max(0, Math.min(1, (z - 158) / (BOW_Z - 158)));

// --- сборка -------------------------------------------------------------------

/** Корпус «Прометея» в осях модели (км), в формате buildCobra. */
export function buildPrometheus() {
  const kit = new Kit(303);
  const hatches = [];
  const lights = [];
  const wells = [];
  let windows = 0, lit = 0;

  // Окно-накладка: светится постоянным светом, как у «Челленджера»
  // (DETAIL.winGlow, js/models/hulldetail.js) — днём темнее обшивки,
  // ночью видно.
  const win = (fr, u0, v0, u1, v1, share = DETAIL.winLit) => {
    const on = kit.rnd() < share;
    const col = (on ? DETAIL.winGlow : DETAIL.winDark).map((c) => Math.round(c * 255));
    kit.decalRect(fr, u0, v0, u1, v1, col, MAT.window, on ? 1 : 0);
    windows++;
    if (on) lit++;
  };
  // Ряд окон по палубе: от u0 до u1 с шагом step, подоконник — над полом.
  const winRow = (fr, u0, u1, floor, opt = {}) => {
    if (u0 > u1) [u0, u1] = [u1, u0];       // левый борт: u = −z
    const w = opt.w || 1.1, h = opt.h || 0.9, step = opt.step || 2.4, sill = opt.sill || 1.05;
    const n = Math.floor((u1 - u0 - w) / step) + 1;
    if (n < 1) return;
    const start = (u0 + u1) / 2 - ((n - 1) * step) / 2;
    for (let i = 0; i < n; i++) {
      if (opt.skip && opt.skip(i)) continue;
      const uc = start + i * step;
      if (opt.fit && !opt.fit(uc, w, floor + sill, floor + sill + h)) continue;
      win(fr, uc - w / 2, floor + sill, uc + w / 2, floor + sill + h, opt.share);
    }
  };
  // Бронеплиты: заплатки другого тона поверх обшивки, рядами в две
  // панели высотой. На рендерах корпус — лоскутное одеяло из светлых и
  // тёмных плит, и без этого большие плоскости читаются игрушечными:
  // швы шейдера (js/gl/hull.js) мельче, они — лист обшивки, а это —
  // броня поверх. Накладкой, на полтора сантиметра над гранью, и с тем
  // же материалом обшивки: швы идут и по ней.
  const plates = (fr, u0, u1, v0, v1, c, opt = {}) => {
    if (u0 > u1) [u0, u1] = [u1, u0];
    const row = opt.row || 4.4, gap = 0.12;
    for (let v = v0; v + 1.2 < v1; v += row) {
      const vh = Math.min(row, v1 - v);
      let u = u0;
      while (u < u1 - 1.5) {
        const ue = Math.min(u1, u + (opt.min || 3.2) + kit.rnd() * (opt.span || 7));
        if (kit.rnd() < (opt.share || 0.5) && (!opt.fit || opt.fit((u + ue) / 2, (v + v + vh) / 2))) {
          const k = kit.rnd() < 0.55 ? 0.88 + kit.rnd() * 0.05 : 1.07 + kit.rnd() * 0.06;
          kit.decalRect(fr, u + gap, v + gap, ue - gap, v + vh - gap, c.map((x) => Math.min(255, Math.round(x * k))), MAT.plate, 0, 0.015);
        }
        u = ue;
      }
    }
  };
  // Плоскости бортов: u — вдоль корабля (z), v — вверх (y).
  const sideFrame = (x, s) => ({ O: [x, 0, 0], U: [0, 0, s], V: [0, 1, 0], N: [s, 0, 0] });
  const uz = (s, z) => z * s;      // координата u на борту знака s

  // ===== СРЕДНИЙ КОРПУС (z 70 → 142) =====================================
  //
  // «Тонкий» средний корпус: 24–28 м в ширину, 26 в высоту. По борту —
  // желоб с шаровыми башнями ПРО, над ним — иллюминаторы кают, под
  // ним — стыковочные узлы и шлюзы. Передняя половина шире задней на
  // четыре метра, переход — скосом.
  const midHalf = (W) => [
    [0, 0], [W - 2.6, 0], [W, 4.5], [W, 11.0], [W - 1.4, 11.6], [W - 1.4, 14.4], [W, 15.0], [W, 23.6], [W - 2.2, 26], [0, 26],
  ];
  kit.loft('z', [
    { t: 70, p: mirror(midHalf(12)) },
    { t: 100, p: mirror(midHalf(12)) },
    { t: 106, p: mirror(midHalf(14)) },
    { t: 142, p: mirror(midHalf(14)) },
  ], { c: byNormal(kit), cap0: false, cap1: false });
  const midW = (z) => (z < 100 ? 12 : z > 106 ? 14 : 12 + 2 * (z - 100) / 6);

  // ===== НОС (z 140 → 195) ================================================
  //
  // Нос выше и ниже среднего корпуса: киль на 7.5 м ниже, плечи — на
  // семь выше крыши. Спина спускается к воротам ангара под 17°.
  const bowHalf = (K, Bk, Yc, Ws, Yt, Wt, Yr) => [[0, K], [Bk, K], [Ws, Yc], [Ws, Yt], [Wt, Yr], [0, Yr]];
  const bowSecs = [
    { t: 140, p: mirror(bowHalf(-7.5, 13.5, -3.5, 18.5, 27, 16.8, 29)) },
    { t: 158, p: mirror(bowHalf(-7.5, 13.5, -3.5, 18.5, 27, 16.8, 29)) },
    { t: 189, p: mirror(bowHalf(-7.5, 13.5, -3.5, 18.5, bowRoof(189) - 2, 16.8, bowRoof(189))) },
    { t: BOW_Z, p: mirror(bowHalf(-5.0, 12.0, -1.5, 17.0, 16.0, 15.5, 18.0)) },
  ];
  // Днище носа от плеч до скулы — панелью: в нём колодец носовой стойки.
  kit.loft('z', bowSecs, { c: byNormal(kit), cap1: false, skip: (i, k) => k === 1 && (i === 0 || i === 9) });
  {
    const fr = { O: [0, -7.5, 0], U: [1, 0, 0], V: [0, 0, 1], N: [0, -1, 0] };
    const well = [[-7.5, 169], [7.5, 169], [7.5, 185], [-7.5, 185]];
    wells.push({ id: 'nose', x0: -7.5, x1: 7.5, z0: 169, z1: 185, y: -7.5, depth: 2.2 });
    kit.panel(fr, [[-13.5, 158], [13.5, 158], [13.5, 189], [-13.5, 189]], [well], COL.under);
    kit.tunnel(fr, well, 2.2, COL.greebleDk, COL.dark);
  }

  // Лоб: ворота ангара — три проёма, как на всех рендерах. Внутри
  // светло: ангар освещён, и ворота видно издали ночью.
  {
    const fr = { O: [0, 0, BOW_Z], U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, 1] };
    const outer = bowSecs[3].p;
    const bays = [[-13.4, -5.4], [-4, 4], [5.4, 13.4]].map(([a, b]) => [[a, 0.5], [b, 0.5], [b, 13], [a, 13]]);
    kit.panel(fr, outer, bays, COL.side);
    for (const h of bays) kit.tunnel(fr, h, 8, COL.greebleDk, COL.bay, { emissive: 0.45 });
    // Створки ворот, уехавшие вверх, — козырёк над каждым проёмом.
    for (const [a, b] of [[-13.4, -5.4], [-4, 4], [5.4, 13.4]]) {
      kit.box(a - 0.3, b + 0.3, 13, 13.6, BOW_Z, BOW_Z + 0.8, { c: COL.edge, solid: false });
    }
    // Огни створа на пилонах между воротами.
    for (const x of [-4.7, 4.7]) lights.push({ p: [x, 13.3, BOW_Z + 0.3], kind: 'nav', color: [1.0, 0.85, 0.5] });
  }

  // Плечи — два блока на спине носа, с клином вперёд.
  for (const s of [1, -1]) {
    const prof = [[6.5, 28.6], [16.5, 28.6], [16.5, 31.8], [15.3, 33], [6.5, 33]];
    const side = (y) => (s > 0 ? prof.map(([x]) => [x, y]) : prof.map(([x]) => [-x, y]).reverse());
    const P = s > 0 ? prof : prof.map(([x, y]) => [-x, y]).reverse();
    kit.loft('z', [{ t: 140.5, p: P }, { t: 155, p: P }, { t: 162, p: side(bowRoof(162) + 0.05) }], { c: byNormal(kit, COL.deck, COL.edge) });
    // Плиты на плечах.
    for (let z = 142; z < 154; z += 4.2) kit.box(s * 8, s * 15, 33, 33.25, z, z + 3.6, { c: COL.deck, solid: false });
  }

  // Спина носа: плиты по оси и «техника» по бокам — блоки, короба,
  // трубы, как на рендерах. Всё в осях наклонной спины.
  {
    const slope = Math.atan2(11, BOW_Z - 158);
    const W = [0, Math.sin(slope), Math.cos(slope)];          // вниз по спине к носу... вперёд
    const H = [0, Math.cos(slope), -Math.sin(slope)];         // нормаль спины
    const U = [1, 0, 0];
    const obox = (u0, u1, w0, w1, h0, h1, c) => {
      // Точка спины на расстоянии w от плеч (z = 158).
      const o = [0, 29, 158];
      const pt = (u, w, h) => [o[0] + U[0] * u + W[0] * w + H[0] * h, o[1] - W[1] * w + H[1] * h, o[2] + W[2] * w + H[2] * h];
      const P = [pt(u0, w0, h0), pt(u1, w0, h0), pt(u1, w1, h0), pt(u0, w1, h0), pt(u0, w0, h1), pt(u1, w0, h1), pt(u1, w1, h1), pt(u0, w1, h1)];
      const f = (a, b, cc, d, out) => kit.face([P[a], P[b], P[cc], P[d]], kit.tone(c, 0.08), MAT.plain, out);
      const Wd = [0, -W[1], W[2]];
      f(4, 5, 6, 7, H);
      f(0, 1, 5, 4, Wd.map((x) => -x));
      f(3, 2, 6, 7, Wd);
      f(0, 3, 7, 4, [-1, 0, 0]);
      f(1, 2, 6, 5, [1, 0, 0]);
    };
    const len = (BOW_Z - 158) / Math.cos(slope);
    // Плиты по оси.
    for (let w = 3; w < len - 4; w += 5.2) obox(-6.2, 6.2, w, w + 4.6, -0.2, 0.22, COL.deck);
    // Техника по бокам: ряды блоков разной высоты.
    for (const s of [1, -1]) {
      for (let w = 5; w < len - 3;) {
        const l = 0.8 + kit.rnd() * 2.6;
        let u = 7.4;
        while (u < 14.6) {
          const du = 0.6 + kit.rnd() * 2.0;
          const h = 0.25 + kit.rnd() * 1.3;
          const u1 = Math.min(14.8, u + du);
          if (kit.rnd() < 0.82) obox(s > 0 ? u : -u1, s > 0 ? u1 : -u, w, w + l, -0.2, h, kit.rnd() < 0.5 ? COL.greeble : COL.greebleDk);
          u = u1 + 0.15 + kit.rnd() * 0.5;
        }
        w += l + 0.2 + kit.rnd() * 0.6;
      }
    }
  }

  // Борта носа: бортовые шлюзы (выход на грунт), окна, решётки.
  for (const s of [1, -1]) {
    const x = 18.5 * s;
    const fr = sideFrame(x, s);
    // Шлюз: рамка вокруг двери 2.6 × 2.8 м, порог на палубе ангара. Панель
    // двери — накладкой с материалом обшивки (MAT.plate): открылся люк — её
    // вырезает та же коробка, что и обшивку (js/gl/shaders.js, hullCarved,
    // режет только обшивку), иначе в проёме висела бы закрытая дверь. Он
    // у самого ангара: дверь шлюза — в борту ангара (js/models/interior.prom.js).
    const zc = 158.1, y0 = -3.0, y1 = -0.2, w = 2.6;
    const fx = (dx) => x + s * dx;
    kit.box(Math.min(fx(0), fx(0.18)), Math.max(fx(0), fx(0.18)), y0 - 0.25, y1 + 0.25, zc - w / 2 - 0.25, zc - w / 2, { c: COL.edge, solid: false, mat: MAT.plain });
    kit.box(Math.min(fx(0), fx(0.18)), Math.max(fx(0), fx(0.18)), y0 - 0.25, y1 + 0.25, zc + w / 2, zc + w / 2 + 0.25, { c: COL.edge, solid: false, mat: MAT.plain });
    kit.box(Math.min(fx(0), fx(0.18)), Math.max(fx(0), fx(0.18)), y1, y1 + 0.25, zc - w / 2, zc + w / 2, { c: COL.edge, solid: false, mat: MAT.plain });
    kit.box(Math.min(fx(0), fx(0.18)), Math.max(fx(0), fx(0.18)), y0 - 0.25, y0, zc - w / 2, zc + w / 2, { c: COL.edge, solid: false, mat: MAT.plain });
    kit.decalRect(fr, uz(s, zc - w / 2), y0, uz(s, zc + w / 2), y1, COL.hatch, MAT.plate, 0, 0.02);
    // Огонь над шлюзом.
    lights.push({ p: [fx(0.3), y1 + 0.6, zc], kind: 'nav', color: [1.0, 0.75, 0.3] });
    hatches.push({ id: s > 0 ? 'bowR' : 'bowL', kind: 'boarding', side: s, z: zc, w, y0, y1, x, deck: 13 });
    // Окна носовых палуб.
    const under = (uc, w, v0, v1) => v1 < bowRoof(Math.abs(uc) + w / 2) - 2.8;
    for (const fl of [6, 10, 14, 18]) winRow(fr, uz(s, 162), uz(s, 186), fl, { w: 1.0, h: 0.8, step: 2.2, share: 0.6, skip: (i) => i % 4 === 3, fit: under });
    // Решётки: тёмный проём с ламелями.
    for (const [z0, z1, yy0, yy1] of [[166, 174, 1.0, 3.6], [176, 184, 1.0, 3.6]]) {
      kit.decalRect(fr, uz(s, z0), yy0, uz(s, z1), yy1, COL.dark, MAT.plain, 0, 0.02);
      for (let y = yy0 + 0.3; y < yy1 - 0.1; y += 0.45) kit.box(Math.min(x, fx(0.12)), Math.max(x, fx(0.12)), y, y + 0.16, z0 + 0.2, z1 - 0.2, { c: COL.greeble, solid: false, mat: MAT.plain });
    }
    // Бортовая броневая полоса — наклонный пояс от плеча к скуле, как
    // на рендерах (тёмная диагональ по борту носа).
    kit.loft('z', [
      { t: 159, p: s > 0 ? [[18.4, 20.0], [19.3, 20.6], [19.3, 24.4], [18.4, 25.0]] : [[-18.4, 20.0], [-18.4, 25.0], [-19.3, 24.4], [-19.3, 20.6]] },
      { t: 186, p: s > 0 ? [[18.4, 8.0], [19.3, 8.6], [19.3, 12.4], [18.4, 13.0]] : [[-18.4, 8.0], [-18.4, 13.0], [-19.3, 12.4], [-19.3, 8.6]] },
    ], { c: COL.edge, solid: false });
  }

  // ===== КОРМА (z 0 → 74) =================================================
  //
  // Широкая палуба-«крылья» во все 80 м, под ней тёмная щель, нижняя
  // плита, а снизу — гондолы гипердвигателя и два маршевых сопла.
  const planHalf = [[0, 9], [27, 9], [36.5, 13], [40, 20], [40, 41], [36.5, 50], [27, 57], [15.5, 63], [13, 66], [12.5, 74], [0, 74]];
  const plan = mirror(planHalf);
  // Верхняя плита: борт двумя ступенями, кромка с фаской.
  kit.loft('y', [
    { t: 18, p: inset(plan, 1.2) },
    { t: 21.6, p: inset(plan, 1.2) },
    { t: 21.6, p: plan },
    { t: 25.4, p: plan },
    { t: 26, p: inset(plan, 0.6) },
  ], { c: byNormal(kit) });
  // Тёмная щель между плитами.
  kit.prism(inset(plan, 4.0), 15, 18, { c: COL.slot, mat: MAT.plain, toneK: 0.02 });
  // Нижняя плита.
  kit.loft('y', [
    { t: 7, p: inset(plan, 3.4) },
    { t: 8.2, p: inset(plan, 2.2) },
    { t: 15, p: inset(plan, 2.2) },
  ], { c: byNormal(kit) });
  // Окна кормы: жилая палуба над маршевыми (канон) — по заднему краю
  // и по концам крыльев.
  {
    const rear = { O: [0, 0, 9], U: [-1, 0, 0], V: [0, 1, 0], N: [0, 0, -1] };
    winRow(rear, -24, 24, 22, { share: 0.8, skip: (i) => i % 5 === 2 });
    const rear2 = { O: [0, 0, 10.2], U: [-1, 0, 0], V: [0, 1, 0], N: [0, 0, -1] };
    winRow(rear2, -22, 22, 18, { share: 0.7, skip: (i) => i % 4 === 0 });
    for (const s of [1, -1]) {
      winRow(sideFrame(40 * s, s), uz(s, 22), uz(s, 39), 22, { w: 1.4, h: 1.0, step: 3.2, share: 0.7 });
      winRow(sideFrame(38.8 * s, s), uz(s, 22), uz(s, 39), 18, { w: 1.0, h: 0.8, step: 2.4, share: 0.5 });
    }
  }
  // Сердцевина кормы — между гондолами, под нижней плитой.
  kit.loft('z', [
    { t: 8, p: mirror([[0, 0], [13, 0], [15, 2], [15, 7.6], [0, 7.6]]) },
    { t: 72, p: mirror([[0, 0], [13, 0], [15, 2], [15, 7.6], [0, 7.6]]) },
  ], { c: byNormal(kit) });
  // Решётки подъёмных двигателей — «антигравитационный блок внизу
  // кормы» (канон). Жар в них — по работе подъёмных, как у
  // «Челленджера» (MAT.vent, js/gl/hull.js).
  const vents = [];
  const ventAt = (fr, u0, v0, u1, v1, y) => {
    kit.decalRect(fr, u0, v0, u1, v1, [40, 38, 36], MAT.vent, 0, 0.03);
    vents.push({ x: (u0 + u1) / 2, y, z: (v0 + v1) / 2, w: u1 - u0, l: v1 - v0 });
  };
  {
    const fr = { O: [0, 0, 0], U: [1, 0, 0], V: [0, 0, 1], N: [0, -1, 0] };
    for (const [z0, z1] of [[20, 32], [42, 54]]) {
      ventAt(fr, -12, z0, -3, z1, 0);
      ventAt(fr, 3, z0, 12, z1, 0);
    }
    // И под носом — иначе корабль на подъёмных висел бы кормой.
    const frb = { O: [0, -7.5, 0], U: [1, 0, 0], V: [0, 0, 1], N: [0, -1, 0] };
    ventAt(frb, -11, 146, -4, 158, -7.5);
    ventAt(frb, 4, 146, 11, 158, -7.5);
  }

  // Маршевые двигатели: два сопла в корме, рёбрами, как на рендерах.
  const exhausts = [];
  for (const s of [1, -1]) {
    const cx = 8.5 * s, cy = 4.5;
    kit.cyl('z', cx, cy, 4.6, 12, 6.6, 24, { c: COL.metal, mat: MAT.plain, cap1: false });
    {
      const circ = (r) => {
        const p = [];
        for (let i = 0; i < 24; i++) {
          const a = (i + 0.5) / 24 * Math.PI * 2;
          p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        return p;
      };
      // Кольца рёбер и проточки между ними — одно тело с полками.
      const secs = [{ t: 0, p: circ(6.35) }];
      for (let z = 0.4; z < 4.5; z += 0.8) {
        secs.push({ t: z, p: circ(6.35) }, { t: z, p: circ(6.05) }, { t: z + 0.38, p: circ(6.05) }, { t: z + 0.38, p: circ(6.35) });
      }
      secs.push({ t: 4.7, p: circ(6.35) });
      kit.loft('z', secs, { c: (i, k, out) => kit.tone(out && Math.abs(out[2]) > 0.5 ? COL.nozzle : (k % 4 === 2 ? COL.nozzle : COL.rib), 0.03), mat: MAT.plain, cap0: false, cap1: false, solid: false });
    }
    // Срез: кольцо и тёмная воронка с жаром в глубине.
    {
      const ring = [];
      for (let i = 0; i < 24; i++) {
        const a = (i + 0.5) / 24 * Math.PI * 2;
        ring.push([Math.cos(a), Math.sin(a)]);
      }
      for (let i = 0; i < 24; i++) {
        const a = ring[i], b = ring[(i + 1) % 24];
        kit.face([[cx + a[0] * 6.35, cy + a[1] * 6.35, 0], [cx + b[0] * 6.35, cy + b[1] * 6.35, 0], [cx + b[0] * 5.3, cy + b[1] * 5.3, 0], [cx + a[0] * 5.3, cy + a[1] * 5.3, 0]], COL.nozzle, MAT.plain, [0, 0, -1]);
        kit.face([[cx + a[0] * 5.3, cy + a[1] * 5.3, 0], [cx + b[0] * 5.3, cy + b[1] * 5.3, 0], [cx + b[0] * 3.0, cy + b[1] * 3.0, 4.2], [cx + a[0] * 3.0, cy + a[1] * 3.0, 4.2]], COL.dark, MAT.plain, [-a[0], -a[1], -0.4]);
      }
      kit.face(ring.map(([u, v]) => [cx + u * 3.0, cy + v * 3.0, 4.2]), COL.burn, MAT.plain, [0, 0, -1], { emissive: 0.55 });
    }
    exhausts.push([cx, cy, -0.5]);
  }

  // Гондолы гипердвигателя.
  for (const s of [1, -1]) {
    const prof = (top, ch) => [[16.5, -9], [30.5, -9], [32, -7.5], [32, top - ch], [30, top], [16.5, top]];
    const P = (top, ch = 2.6) => (s > 0 ? prof(top, ch) : prof(top, ch).map(([x, y]) => [-x, y]).reverse());
    kit.loft('z', [{ t: 5, p: P(7.6) }, { t: 67, p: P(7.6) }, { t: 72, p: P(4.6, 1.6) }], {
      c: byNormal(kit), cap0: false, cap1: false, skip: (i, k) => k === 0 && i === (s > 0 ? 0 : 4),
    });
    {
      // Колодец главной стойки в днище гондолы.
      const fb = { O: [0, -9, 0], U: [1, 0, 0], V: [0, 0, 1], N: [0, -1, 0] };
      const xa = s > 0 ? 16.5 : -30.5, xb = s > 0 ? 30.5 : -16.5;
      const wa = s > 0 ? 20 : -30, wb = s > 0 ? 30 : -20;
      const well = [[wa, 18], [wb, 18], [wb, 34], [wa, 34]];
      wells.push({ id: s > 0 ? 'mainR' : 'mainL', x0: wa, x1: wb, z0: 18, z1: 34, y: -9, depth: 2.2 });
      kit.panel(fb, [[xa, 5], [xb, 5], [xb, 67], [xa, 67]], [well], COL.under);
      kit.tunnel(fb, well, 2.2, COL.greebleDk, COL.dark);
    }
    // Лоб гондолы — ниша тормозных сопел.
    const fr = { O: [0, 0, 72], U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, 1] };
    const hole = s > 0 ? [[22.8, -7.6], [25.6, -7.6], [30.6, 3.2], [17.9, 3.2]] : [[-25.6, -7.6], [-22.8, -7.6], [-17.9, 3.2], [-30.6, 3.2]];
    kit.panel(fr, P(4.6, 1.6), [hole], COL.side);
    kit.tunnel(fr, hole, 5, COL.greebleDk, COL.hyper.map((c) => c * 0.35), { shrink: 0.3, emissive: 0.2 });
    // Корма гондолы — излучатель гипердвигателя: синяя решётка.
    const back = { O: [0, 0, 5], U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, -1] };
    const bh = s > 0 ? [[19, -6.5], [30, -6.5], [30, 4], [19, 4]] : [[-30, -6.5], [-19, -6.5], [-19, 4], [-30, 4]];
    kit.panel(back, P(7.6), [bh], COL.side);
    kit.tunnel(back, bh, 1.6, COL.greebleDk, COL.hyper, { emissive: 0.5 });
    for (let x = 20; x < 29.6; x += 1.5) {
      const xa = s > 0 ? x : -x - 0.35;
      kit.box(xa, xa + 0.35, -6.5, 4, 3.6, 5.0, { c: COL.greebleDk, solid: false, mat: MAT.plain });
    }
    // Рёбра по внешнему борту.
    for (let z = 12; z < 64; z += 7.5) {
      const x0 = s > 0 ? 32 : -32.4, x1 = s > 0 ? 32.4 : -32;
      kit.box(x0, x1, -7, 4.2, z, z + 1.1, { c: COL.edge, solid: false });
    }
  }

  // Террасы на крыльях, мачты и купола сенсоров.
  for (const s of [1, -1]) {
    const mx = (p) => (s > 0 ? p : p.map(([x, z]) => [-x, z]).reverse());
    const t1 = mx(rectCh(25, 38.5, 16, 46, 3));
    kit.loft('y', [{ t: 25.9, p: t1 }, { t: 27.6, p: t1 }, { t: 28.0, p: inset(t1, 0.4) }], { c: byNormal(kit) });
    const t2 = mx(rectCh(28, 36, 22, 39, 2));
    kit.loft('y', [{ t: 27.9, p: t2 }, { t: 29.9, p: t2 }, { t: 30.2, p: inset(t2, 0.3) }], { c: byNormal(kit) });
    kit.box(s > 0 ? 29.5 : -33.5, s > 0 ? 33.5 : -29.5, 30.1, 32.6, 27, 33, { c: COL.greeble, ch: 0.3 });
    for (const [x, z] of [[31, 29.5], [32.6, 31.6]]) {
      kit.box(s * x - 0.16, s * x + 0.16, 32.5, 45, z - 0.16, z + 0.16, { c: COL.mast, solid: false, mat: MAT.plain });
      kit.box(s * x - 0.9, s * x + 0.9, 41.5, 41.7, z - 0.08, z + 0.08, { c: COL.mast, solid: false, mat: MAT.plain });
    }
    kit.sphere(s * 34.5, 30.2, 25.0, 1.4, COL.mast, 10, 5);
    kit.box(s > 0 ? 26.5 : -29.5, s > 0 ? 29.5 : -26.5, 28, 29.2, 41, 44, { c: COL.greeble, solid: false });
  }

  // Башни ПРО на палубе кормы (спаренные рельсовые).
  const turret = (x, y, z, yaw = 0) => {
    kit.box(x - 1.3, x + 1.3, y - 0.05, y + 0.6, z - 1.3, z + 1.3, { c: COL.greebleDk, solid: false, mat: MAT.plain });
    kit.box(x - 1.0, x + 1.0, y + 0.6, y + 1.7, z - 1.1, z + 0.9, { c: COL.greeble, solid: false, mat: MAT.plain, ch: 0.25 });
    const d = yaw === 0 ? 1 : -1;
    for (const dx of [-0.45, 0.45]) kit.box(x + dx - 0.13, x + dx + 0.13, y + 1.05, y + 1.31, d > 0 ? z + 0.9 : z - 4.1, d > 0 ? z + 4.1 : z - 0.9, { c: COL.metal, solid: false, mat: MAT.plain });
  };
  for (const [x, z] of [[-18, 30], [18, 30], [-9, 14], [9, 14]]) turret(x, 26, z, z < 20 ? 1 : 0);

  // ===== БАШНЯ («остров») ================================================
  //
  // Плинтус с зубцами, ствол с рядами окон, поля, голова с рубкой.
  // Перед стволом — наклонный контрфорс, на нём — будка лифта с
  // воротами вперёд: выход на верхнюю палубу и стыковочный узел.
  kit.loft('y', [
    { t: 25.9, p: rectCh(-13.5, 13.5, 30, 66, 3) },
    { t: 29.5, p: rectCh(-13.5, 13.5, 30, 66, 3) },
    { t: 30, p: inset(rectCh(-13.5, 13.5, 30, 66, 3), 0.5) },
  ], { c: byNormal(kit) });
  kit.prism(rectCh(-11, 11, 33, 63, 2.2), 29.9, 42.4, { c: byNormal(kit) });
  // Зубцы у основания — по корме плинтуса (на рендере сзади).
  for (let x = -10.5; x <= 10; x += 3) {
    const tooth = [[30, 25.95], [30, 29.4], [28.2, 25.95]];
    kit.loft('x', [{ t: x, p: tooth }, { t: x + 1.0, p: tooth }], { c: COL.edge, solid: false });
  }
  // Контрфорс: клин от ствола к палубе.
  kit.loft('x', [
    { t: -8.5, p: [[62, 26], [80, 26], [80, 27.2], [63, 42.6], [62, 42.6]] },
    { t: 8.5, p: [[62, 26], [80, 26], [80, 27.2], [63, 42.6], [62, 42.6]] },
  ], { c: byNormal(kit, COL.deck, COL.side) });
  // Будка лифта: ворота смотрят на нос.
  {
    const p = [[-5, 76], [5, 76], [5, 86], [-5, 86]];
    kit.loft('y', [{ t: 25.9, p }, { t: 31.6, p }, { t: 32.6, p: inset(p, 0.9) }], { c: byNormal(kit), skip: (i, k) => i === 2 && k === 0 });
    const fr = { O: [0, 0, 86], U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, 1] };
    const door = [[-3.2, 26], [3.2, 26], [3.2, 30.6], [-3.2, 30.6]];
    kit.panel(fr, [[-5, 25.9], [5, 25.9], [5, 31.6], [-5, 31.6]], [door], COL.side);
    kit.tunnel(fr, door, 4, COL.greebleDk, COL.bay, { emissive: 0.25 });
    // Дверь — в глубине портала, за четырьмя метрами тоннеля.
    hatches.push({ id: 'top', kind: 'dock', z: 82, w: 6.4, y0: 26, y1: 30.6, x: 0, deck: 6 });
    lights.push({ p: [0, 31.2, 86.3], kind: 'nav', color: [1.0, 0.85, 0.5] });
    for (const x of [-4.2, 4.2]) kit.box(x - 0.5, x + 0.5, 32.5, 33.2, 80, 82, { c: COL.greeble, solid: false, mat: MAT.plain });
  }
  // Поля под головой.
  {
    const p = rectCh(-14.2, 14.2, 31, 64, 4);
    kit.loft('y', [{ t: 42.2, p: inset(p, 0.8) }, { t: 43, p }, { t: 44.6, p }], { c: byNormal(kit, COL.deck, COL.edge) });
  }
  // Голова: рубка (палуба 1) за тремя окнами.
  const headP = (yb, yt, ch = 1.5) => [[-12.5, yb], [12.5, yb], [12.5, yt - ch], [11, yt], [-11, yt], [-12.5, yt - ch]];
  const headSecs = [
    { t: 36, p: headP(44.6, 56) },
    { t: 66.5, p: headP(44.6, 56) },
    { t: 69.6, p: headP(44.6, 53.66) },
    { t: 71, p: headP(45.8, 52.6) },
  ];
  kit.loft('z', headSecs, { c: byNormal(kit), cap1: false });
  const bridgeWin = [[-10.9, -4.0], [-3.3, 3.3], [4.0, 10.9]].map(([a, b]) => [[a, 46.3], [b, 46.3], [b, 50.3], [a, 50.3]]);
  {
    const fr = { O: [0, 0, 71], U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, 1] };
    kit.panel(fr, headSecs[3].p, bridgeWin, COL.side);
    // Стекло — смотровое, без переплёта (MAT.clear): окна по 6.7 м.
    for (const h of bridgeWin) kit.tunnel(fr, h, 0.35, COL.edge, COL.glass, { backMat: MAT.clear });
  }
  // Пол и подволок рубки: изнутри головы это палуба 1 и потолок мостика.
  // Нормали — прочь из рубки (у пола вниз, у потолка вверх): так их красит
  // шейдер изнанки (js/gl/hull.js, uHullInside), как и стены рубки. Снаружи
  // они внутри головы, и их не видно.
  kit.face([[-12.3, 46, 36.3], [12.3, 46, 36.3], [12.3, 46, 70.85], [-12.3, 46, 70.85]], COL.side, MAT.plate, [0, -1, 0]);
  kit.face([[-12.3, 51.2, 36.3], [12.3, 51.2, 36.3], [12.3, 51.2, 70.5], [-12.3, 51.2, 70.5]], COL.side, MAT.plate, [0, 1, 0]);

  // Окна башни: по палубам 2–6 со всех сторон.
  // Лоб ствола закрыт контрфорсом, а корма плинтуса — зубцами: окна там
  // легли бы внутрь, их нет.
  for (const fl of [26, 30, 34, 38]) {
    const k = fl === 26 ? 13.5 : 11;
    const [z0, z1] = fl === 26 ? [34.5, 61.5] : [36, 60];
    for (const s of [1, -1]) winRow(sideFrame(k * s, s), uz(s, z0), uz(s, z1), fl, { share: 0.75 });
    if (fl > 26) winRow({ O: [0, 0, 33], U: [-1, 0, 0], V: [0, 1, 0], N: [0, 0, -1] }, -8.5, 8.5, fl, { share: 0.6 });
  }
  // Голова: окна рубки по бортам — высокие, как у мостика корабля.
  for (const s of [1, -1]) {
    winRow(sideFrame(12.5 * s, s), uz(s, 40), uz(s, 66), 46, { w: 1.4, h: 1.9, step: 2.6, share: 0.85 });
  }
  winRow({ O: [0, 0, 36], U: [-1, 0, 0], V: [0, 1, 0], N: [0, 0, -1] }, -9, 9, 46, { w: 1.4, h: 1.2, step: 2.6, share: 0.8 });
  // Крыша головы: короба сенсоров.
  kit.box(-4, 4, 55.9, 56.8, 44, 54, { c: COL.greeble, solid: false, ch: 0.3 });
  kit.box(-9, -6, 55.9, 56.5, 40, 46, { c: COL.greebleDk, solid: false });
  kit.box(6, 9, 55.9, 56.5, 40, 46, { c: COL.greebleDk, solid: false });

  // ===== ДЕТАЛИ СРЕДНЕГО КОРПУСА =========================================
  for (const s of [1, -1]) {
    // Иллюминаторы кают (палуба 8) — над желобом.
    for (const [z0, z1] of [[73, 99], [107, 140]]) {
      const W = midW((z0 + z1) / 2);
      winRow(sideFrame(W * s, s), uz(s, z0), uz(s, z1), 18, { w: 1.5, h: 1.3, step: 5.4, share: 0.8, sill: 1.0 });
      // Палуба 11 — тройки окон, мимо дисков, дверей шлюзов и решёток.
      const busy = [[74, 85], [84.4, 87.8], [114.6, 121.4], [128.4, 131.6], [133.6, 140.6]];
      const free = (uc, w) => !busy.some(([a, b]) => Math.abs(uc) + w / 2 > a && Math.abs(uc) - w / 2 < b);
      winRow(sideFrame(W * s, s), uz(s, z0), uz(s, z1), 6, { w: 0.8, h: 0.8, step: 1.4, share: 0.55, skip: (i) => i % 4 === 3, fit: free });
    }
    // Шаровые башни ПРО в желобе — парами.
    for (const z of [77, 85, 93, 112, 120, 128, 136]) {
      const W = midW(z);
      const xi = (W - 1.4) * s;
      kit.box(Math.min(xi, xi + 0.8 * s), Math.max(xi, xi + 0.8 * s), 12.2, 13.8, z - 1.0, z + 1.0, { c: COL.greebleDk, solid: false, mat: MAT.plain });
      for (const dz of [-0.55, 0.55]) kit.sphere(xi + 1.15 * s, 13.0, z + dz, 0.62, COL.greeble, 8, 4);
    }
    // Стыковочный узел — большой диск по борту (на рендерах).
    {
      const W = 14;
      const x0 = W * s, x1 = (W + 0.5) * s;
      kit.cyl('x', 118, 7.4, Math.min(x0, x1), Math.max(x0, x1), 3.0, 20, { c: COL.greeble, mat: MAT.plain, solid: false });
      kit.cyl('x', 118, 7.4, Math.min(x0, (W + 0.75) * s), Math.max(x0, (W + 0.75) * s), 2.2, 20, { c: COL.hatch, mat: MAT.plain, solid: false });
      hatches.push({ id: s > 0 ? 'midR' : 'midL', kind: 'eva', side: s, z: 118, w: 4.4, y0: 5.2, y1: 9.6, x: x0, deck: 11 });
    }
    // Шлюзы вдоль среднего корпуса (канон): рамки дверей на палубе 11.
    for (const zc of [86, 130]) {
      const W = midW(zc), x = W * s;
      const y0 = 6.0, y1 = 8.8, w = 2.4;
      const fx = (dx) => x + s * dx;
      const xa = Math.min(fx(0), fx(0.16)), xb = Math.max(fx(0), fx(0.16));
      kit.box(xa, xb, y0 - 0.22, y1 + 0.22, zc - w / 2 - 0.22, zc - w / 2, { c: COL.edge, solid: false, mat: MAT.plain });
      kit.box(xa, xb, y0 - 0.22, y1 + 0.22, zc + w / 2, zc + w / 2 + 0.22, { c: COL.edge, solid: false, mat: MAT.plain });
      kit.box(xa, xb, y1, y1 + 0.22, zc - w / 2, zc + w / 2, { c: COL.edge, solid: false, mat: MAT.plain });
      kit.box(xa, xb, y0 - 0.22, y0, zc - w / 2, zc + w / 2, { c: COL.edge, solid: false, mat: MAT.plain });
      kit.decalRect(sideFrame(x, s), uz(s, zc - w / 2), y0, uz(s, zc + w / 2), y1, COL.hatch, MAT.plate, 0, 0.02);
      hatches.push({ id: (s > 0 ? 'lockR' : 'lockL') + zc, kind: 'eva', side: s, z: zc, w, y0, y1, x, deck: 11 });
    }
    // Решётки нижнего пояса.
    for (const [z0, z1] of [[76, 84], [134, 140]]) {
      const W = midW((z0 + z1) / 2), x = W * s;
      kit.decalRect(sideFrame(x, s), uz(s, z0), 6.2, uz(s, z1), 9.6, COL.dark, MAT.plain, 0, 0.02);
      for (let y = 6.5; y < 9.4; y += 0.45) kit.box(Math.min(x, x + 0.12 * s), Math.max(x, x + 0.12 * s), y, y + 0.16, z0 + 0.2, z1 - 0.2, { c: COL.greeble, solid: false, mat: MAT.plain });
    }
  }
  // Крыша среднего корпуса: длинные решётки, рельсы, башни.
  for (const s of [1, -1]) {
    for (const [z0, z1] of [[76, 98], [110, 138]]) {
      const fr = { O: [0, 26, 0], U: [1, 0, 0], V: [0, 0, 1], N: [0, 1, 0] };
      const xa = s > 0 ? 4.6 : -5.6, xb = s > 0 ? 5.6 : -4.6;
      kit.decalRect(fr, xa, z0, xb, z1, COL.dark, MAT.plain, 0, 0.02);
      for (let z = z0 + 0.3; z < z1 - 0.2; z += 0.6) kit.box(xa + 0.05, xb - 0.05, 26, 26.12, z, z + 0.2, { c: COL.greebleDk, solid: false, mat: MAT.plain });
    }
    kit.box(s > 0 ? 9.4 : -9.6, s > 0 ? 9.6 : -9.4, 26, 26.35, 73, 140, { c: COL.mast, solid: false, mat: MAT.plain });
  }
  for (const [x, z] of [[-7.5, 90], [7.5, 90], [-7.5, 124], [7.5, 124], [0, 104]]) turret(x, 26, z);
  // Короба на крыше — люки обслуживания.
  for (const z of [101, 116]) for (const s of [1, -1]) kit.box(s * 1.5, s * 3.3, 26, 26.7, z, z + 2.4, { c: COL.greeble, solid: false, ch: 0.2 });

  // ===== БРОНЯ, ПОЯСА, КИЛЬ ===============================================
  for (const s of [1, -1]) {
    // Средний корпус: верхний и нижний пояс борта.
    for (const [z0, z1] of [[71, 99.5], [106.5, 141.5]]) {
      const W = midW((z0 + z1) / 2), fr = sideFrame(W * s, s);
      plates(fr, uz(s, z0), uz(s, z1), 15.2, 23.4, COL.side, { row: 4.1 });
      plates(fr, uz(s, z0), uz(s, z1), 4.7, 10.8, COL.side, { row: 3.05 });
    }
    // Нос: борт от скулы до кромки (кромка спускается к носу).
    plates(sideFrame(18.5 * s, s), uz(s, 140.5), uz(s, 188), -3.3, 26.5, COL.side, {
      row: 4.4, fit: (u, v) => v + 2.4 < bowRoof(Math.abs(u)) - 2.2,
    });
    // Гондолы: внешний борт.
    plates(sideFrame(32 * s, s), uz(s, 6), uz(s, 66), -7.3, 4.8, COL.side, { row: 4.0, share: 0.45 });
    // Крылья: борт и задняя кромка.
    plates(sideFrame(40 * s, s), uz(s, 20.5), uz(s, 40.5), 21.7, 25.3, COL.side, { row: 3.6, min: 2, span: 4 });
    // Башня: ствол и голова.
    plates(sideFrame(11 * s, s), uz(s, 35.5), uz(s, 60.5), 30.0, 42.3, COL.side, { row: 4.0, share: 0.35 });
    plates(sideFrame(12.5 * s, s), uz(s, 36.5), uz(s, 66), 44.8, 54.3, COL.side, { row: 3.1, share: 0.35 });
  }
  // Крыши: палуба кормы мимо башни и террас, крыша среднего корпуса.
  {
    const roof = { O: [0, 26, 0], U: [1, 0, 0], V: [0, 0, 1], N: [0, 1, 0] };
    const clear = (x, z) => !(Math.abs(x) < 15 && z > 28 && z < 88)                     // башня, контрфорс, будка
      && !(Math.abs(x) > 24 && z > 15 && z < 47)                                         // террасы
      && !(Math.abs(x) > 4 && Math.abs(x) < 6 && z > 75 && z < 139);                     // решётки
    const inPlan = (x, z) => {
      // Палуба кормы: внутри плана с запасом; средний корпус: |x| < 9.6.
      if (z > 72) return Math.abs(x) < 9.2 && z < 140;
      return z > 11 && z < 60 && Math.abs(x) < 37 - Math.max(0, z - 44) * 0.9;
    };
    for (let z = 11; z < 140; z += 4.4) {
      for (let x = -37; x < 37;) {
        const w = 3 + kit.rnd() * 6;
        const xm = x + w / 2, zm = z + 2.2;
        const ok = [[x, z], [x + w, z], [x, z + 4.4], [x + w, z + 4.4]].every(([a, b]) => inPlan(a, b) && clear(a, b));
        if (ok && kit.rnd() < 0.42) {
          const k = kit.rnd() < 0.55 ? 0.9 : 1.08;
          kit.decalRect(roof, x + 0.12, z + 0.12, x + w - 0.12, z + 4.28, COL.deck.map((c) => Math.round(c * k)), MAT.plate, 0, 0.015);
        }
        x += w;
        void xm; void zm;
      }
    }
  }
  // Пояса по палубам башни — уступы, по которым читаются ярусы.
  for (const fl of [30, 34, 38]) {
    const p = rectCh(-11, 11, 33, 63, 2.2);
    kit.prism(inset(p, -0.28), fl - 0.32, fl, { c: COL.edge, solid: false });
  }
  kit.prism(inset(rectCh(-12.5, 12.5, 36, 66.5, 1.2), -0.25), 49.9, 50.2, { c: COL.edge, solid: false });
  // Киль среднего корпуса и купола сенсоров под носом.
  kit.box(-1.4, 1.4, -0.7, 0.02, 73, 141, { c: COL.under, solid: false, ch: 0 });
  for (const z of [92, 124]) kit.box(-3.2, 3.2, -0.5, 0.02, z - 2, z + 2, { c: COL.greebleDk, solid: false });
  for (const [x, z] of [[-6, 168], [6, 168], [0, 186]]) kit.sphere(x, -7.5, z, 1.2, COL.greeble, 10, 5);
  // Палуба кормы: вентиляционные решётки, люки, трубопроводы у башни.
  {
    const roof = { O: [0, 26, 0], U: [1, 0, 0], V: [0, 0, 1], N: [0, 1, 0] };
    for (const [x0, x1, z0, z1] of [[-30, -22, 50, 54], [22, 30, 50, 54], [-6, 6, 15, 19]]) {
      kit.decalRect(roof, x0, z0, x1, z1, COL.dark, MAT.plain, 0, 0.03);
      for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.5) kit.box(x, x + 0.2, 26, 26.14, z0 + 0.15, z1 - 0.15, { c: COL.greebleDk, solid: false, mat: MAT.plain });
    }
    for (const s of [1, -1]) {
      kit.box(s * 14.6, s * 15.4, 26, 26.8, 31, 62, { c: COL.metal, solid: false, mat: MAT.plain });
      kit.box(s * 16.2, s * 16.8, 26, 26.6, 33, 58, { c: COL.metal, solid: false, mat: MAT.plain });
      for (const z of [18, 40]) kit.box(s * 19, s * 22, 26, 26.5, z, z + 2.2, { c: COL.greeble, solid: false, ch: 0.15 });
    }
  }

  // ===== ОГНИ =============================================================
  //
  // По правилам авиации, как у «Челленджера» (hulldetail.js, navLights):
  // красный — левый борт, зелёный — правый, белый — корма; вспышки — на
  // концах крыльев, маяки — сверху и снизу.
  const nav = [
    { p: [-40.35, 23.5, 30.5], kind: 'nav', color: [1.0, 0.12, 0.08] },
    { p: [40.35, 23.5, 30.5], kind: 'nav', color: [0.1, 1.0, 0.35] },
    { p: [0, 23.5, 8.65], kind: 'nav', color: [1.0, 0.96, 0.9] },
    { p: [-40.3, 25.2, 21.5], kind: 'strobe', color: [1.0, 1.0, 1.0] },
    { p: [40.3, 25.2, 21.5], kind: 'strobe', color: [1.0, 1.0, 1.0] },
    { p: [0, 57.2, 49], kind: 'beacon', color: [1.0, 0.1, 0.05] },
    { p: [0, -0.4, 104], kind: 'beacon', color: [1.0, 0.1, 0.05] },
    // Топы мачт — красные заградительные, как у любой мачты.
    ...[1, -1].map((s) => ({ p: [s * 31, 45.3, 29.5], kind: 'beacon', color: [1.0, 0.1, 0.05] })),
  ];

  // ===== В ОСИ МОДЕЛИ =====================================================
  const mass = massOf(kit);
  // Начало осей — в центре масс: вокруг него корабль и вертится. По
  // длине он почти на пятнадцать метров ближе к корме, чем середина: корма
  // широкая, нос — нет. Нос от центра масс дальше кормы, и это видно в
  // развороте: нос заносит сильнее.
  const z0 = mass.cz;
  const y0 = mass.cy;
  const M = 1000;
  const toModel = (p) => v3(p[0] / M, (p[1] - y0) / M, (p[2] - z0) / M);
  for (const part of [kit, kit.decal]) {
    for (const v of part.verts) { v.x /= M; v.y = (v.y - y0) / M; v.z = (v.z - z0) / M; }
  }
  const mesh = { verts: kit.verts, faces: kit.faces, decal: kit.decal };
  mesh.name = PROM.name;
  mesh.length = PROM.length / M;
  mesh.exhausts = exhausts.map(toModel);
  mesh.navLights = [...nav, ...lights].map((l) => ({ pos: toModel(l.p), kind: l.kind, color: l.color }));
  let hx = 0, hy = 0, hz = 0;
  for (const v of mesh.verts) { hx = Math.max(hx, Math.abs(v.x)); hy = Math.max(hy, Math.abs(v.y)); hz = Math.max(hz, Math.abs(v.z)); }
  mesh.rcs = rcsPorts(mesh.verts, { x: hx, y: hy, z: hz });
  mesh.detail = {
    windows, lit,
    vents: vents.map((v) => ({ x: v.x / M, y: (v.y - y0) / M, z: (v.z - z0) / M, w: v.w, l: v.l })),
    glass: mesh.faces.filter((f) => f.mat === MAT.glass).length,
  };
  let bound = 0;
  for (const v of mesh.verts) bound = Math.max(bound, Math.hypot(v.x, v.y, v.z));
  mesh.bound = bound;
  // Объём и глаз командира — как у «Челленджера» (js/models/ships.js):
  // их берёт игра у текущего корпуса (js/game/hull.js).
  mesh.volumeM3 = mass.volume;
  mesh.eye = toModel(BRIDGE_EYE);
  // Сведения для проверок и следующих шагов (помещения, шлюзы, шасси) —
  // в осях модели, метрах: так же, как у помещений «Челленджера».
  const toM = (p) => [p[0], p[1] - y0, p[2] - z0];
  mesh.prom = {
    shift: { y: y0, z: z0 },
    volume: mass.volume,
    centroid: [0, mass.cy - y0, mass.cz - z0],
    decks: PROM.decks.map((d) => ({ ...d, floor: d.floor - y0 })),
    hatches: hatches.map((h) => ({ ...h, y0: h.y0 - y0, y1: h.y1 - y0, z: h.z - z0 })),
    gear: PROM_GEAR.map((g) => ({ ...g, attach: toM(g.attach), foot: toM(g.foot) })),
    bridge: { eye: toM(BRIDGE_EYE), floor: 46 - y0, windows: bridgeWin.map((h) => h.map(([x, y]) => [x, y - y0, 71 - z0])) },
    ground: PROM.ground - y0,
    inside: (x, y, z, pad = 0) => kit.inside(x, y + y0, z + z0, pad),
    // Грань тела (а не навесной детали): у неё нормаль обязана смотреть наружу.
    solidFace: (f) => kit.solidFaces.has(f),
    wells: wells.map((w) => ({ ...w, y: w.y - y0, z0: w.z0 - z0, z1: w.z1 - z0 })),
  };
  return mesh;
}

/**
 * Объём и центр масс: доля точек решётки внутри тел корпуса (ниши —
 * пустота). Тела перекрываются (средний корпус заходит в нос и в корму),
 * и объём суммой по телам посчитал бы стыки дважды — решётка их не
 * считает. Шаг в два метра: на корпусе в двести метров центр масс выходит
 * точнее полуметра (проверка сверяет с решёткой в метр), а сборка втрое
 * быстрее, чем с полутораметровым.
 */
function massOf(kit, step = 2) {
  let n = 0, sy = 0, sz = 0;
  const lo = [-41, -12, 0], hi = [41, 60, 196];
  for (let x = lo[0] + step / 2; x < hi[0]; x += step) {
    for (let y = lo[1] + step / 2; y < hi[1]; y += step) {
      for (let z = lo[2] + step / 2; z < hi[2]; z += step) {
        if (!kit.inside(x, y, z)) continue;
        n++; sy += y; sz += z;
      }
    }
  }
  const cell = step * step * step;
  return { volume: n * cell, cy: sy / n, cz: sz / n };
}

// --- шасси --------------------------------------------------------------------
//
// Тренога, как в каноне: стойка под носом и две под гондолами. Каждая
// выходит из колодца глубиной 2.2 м; пяты — на одной высоте
// (PROM.ground), и длина у каждой своя: днище гондол ниже киля носа.
// Толщина и пяты — от веса, который несёт стойка (js/models/gear.js): у
// корабля в 38 тысяч тонн это сдвоенные стойки по три с лишним метра в
// поперечнике и пяты по тринадцать метров. Ширина пяты (padW) — по
// колодцу, в который она убирается; длина — по площади, которую просит
// грунт.
export const PROM_GEAR = [
  { id: 'nose', attach: [0, -5.3, 177], foot: [0, PROM.ground, 177], padW: 11, brace: [0, -3.2] },
  { id: 'mainL', attach: [-25, -6.8, 26], foot: [-25, PROM.ground, 26], padW: 9, brace: [2.6, 0] },
  { id: 'mainR', attach: [25, -6.8, 26], foot: [25, PROM.ground, 26], padW: 9, brace: [-2.6, 0] },
];

/** Стойки шасси «Прометея» — в том же виде, что buildGear «Челленджера». */
export function buildPrometheusGear(hull) {
  const sh = hull.prom.shift;
  const mass = hull.prom.volume * HULL_DENSITY;
  const at = PROM_GEAR.map((g) => [g.attach[0], g.attach[1] - sh.y, g.attach[2] - sh.z]);
  const share = tripodShares(at.map((p) => [p[0], p[2]]));
  return buildLegs(PROM_GEAR.map((g, i) => {
    const s = sizeLeg(mass * share[i], true);
    const l = s.padArea / g.padW;
    return {
      at: at[i], len: g.attach[1] - PROM.ground, r: s.r,
      pad: { kind: 'skid', w: g.padW, l, h: Math.min(g.padW, l) * 0.07 },
      twin: s.r * 2.5, brace: g.brace,
    };
  }));
}
