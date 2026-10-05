// Помещения вездехода: шлюз-коридор и кабина на одного.
//
// Тот же сборщик, что у «Челленджера» (js/models/interior.js, makePlan /
// buildInterior), и тот же порядок: план — это данные (комнаты, люк,
// проём, кресло), а стены, пол, люк, свет и твёрдое кладёт сборщик.
//
//   шлюз-коридор (z −1.75 … 0.4) — дверь на левом борту (люк с циклом
//     давления и выдвижным трапом, js/game/airlock.js), пульт двери на
//     передней стенке, проход в кабину справа от пульта;
//   кабина (z 0.4 … 2.9) — «рубка», как у кораблей: её стены — сам кузов
//     изнутри (лобовое стекло сквозное), а кресло, руль и доску с
//     экранами даёт пост водителя (js/models/cockpit.rover.js).
//
// ПОЧЕМУ ВСЯ КАБИНА — ШЛЮЗ. Отдельной камеры между дверью и креслом в
// кузове 6 × 2.5 м не поставить: на неё ушла бы половина машины. Поэтому
// шлюз — коридор, а кабина связана с ним проёмом без двери: открыл дверь —
// стравливается весь объём (пилот всегда в скафандре), задраил — насос
// набирает его обратно. Как у трюма с опущенной платформой.
//
// Оси — оси вездехода (js/models/rover.js): x вправо, y вверх, z вперёд,
// метры, начало на грунте.

import { RV } from './rover.js';
import { makePlan, lamp } from './interior.js';
import { roverPodSolids } from './cockpit.rover.js';

const FLOOR = RV.floor, CEIL = RV.ceil;
const D = RV.door;

export const ROVER_ROOMS = [
  { id: 'rcab', name: 'КАБИНА ВЕЗДЕХОДА', kind: 'bridge', lo: [-1.15, FLOOR, 0.4], hi: [1.15, CEIL, 2.9] },
  // Стены шлюза — тонкие (thin): у деталей пака за лицом четверть метра, и
  // они торчали из кузова наружу — их было видно в открытую дверь. И
  // шлюз уже кабины — ±1.0 м: при ±1.15 верх его стен выходил за фаски
  // крыши (на высоте 3.0 фаска — в 1.05 от оси).
  { id: 'rlock', name: 'ШЛЮЗ ВЕЗДЕХОДА', kind: 'lock', lo: [-1.0, FLOOR, -1.75], hi: [1.0, CEIL, 0.4], thin: true },
];

// Дверь — люк левого борта (js/models/rover.js, RV.door): та же утопленная
// панель, что у корабля, и трап по её порогу до грунта.
export const ROVER_HATCHES = [
  { id: D.id, lock: 'rlock', side: D.side, skin: D.skin, inset: D.inset, z: D.z, y: D.y, rgb: [150, 155, 160] },
];

// Проход в кабину — справа, мимо кресла: слева на передней стенке шлюза
// пульт двери. Метры по x.
export const ROVER_OPENINGS = [
  { a: 'rlock', b: 'rcab', u: [0.2, 0.95] },
];

// Кресло: глаз водителя (js/models/rover.js, RV.eye). Встаёт он справа от
// кресла, у прохода: подлокотник — в 0.4 м от середины, а тело — коробка в
// полметра (js/game/walker.js, WALK.half).
const SEAT = {
  eye: RV.eye,
  stand: [0.68, FLOOR, 0.7],
  zone: { lo: [-1.0, FLOOR - 0.3, 0.42], hi: [1.0, CEIL, 1.4] },
  room: 'rcab',
};

/**
 * Твёрдое кабины: её стены — кузов изнутри, а в плане они не собираются
 * (кабина — «рубка»). Пол, борта, потолок, сползающий к лобовому стеклу, —
 * коробками; доска, руль и кресло — коробками поста (js/models/cockpit.rover.js,
 * в осях глаза).
 */
function cabSolids(ctx) {
  const S = ctx.solids, y = FLOOR, z0 = 0.4, z1 = 2.95;
  S.push({ lo: [-1.3, y - 0.4, z0 - 0.02], hi: [1.3, y, z1] });                 // пол
  S.push({ lo: [-1.6, y - 0.4, z0], hi: [-1.15, CEIL + 0.3, z1] });            // левый борт
  S.push({ lo: [1.15, y - 0.4, z0], hi: [1.6, CEIL + 0.3, z1] });              // правый борт
  S.push({ lo: [-1.3, CEIL, z0], hi: [1.3, CEIL + 0.4, 1.7] });                // потолок
  S.push({ lo: [-1.3, 2.55, 1.7], hi: [1.3, CEIL + 0.4, z1] });                // под лобовым стеклом потолок ниже
  const e = RV.eye;
  for (const s of roverPodSolids()) {
    S.push({ lo: s.lo.map((v, i) => v + e[i]), hi: s.hi.map((v, i) => v + e[i]), prop: 'pod' });
  }
}

function special(ctx) {
  cabSolids(ctx);
}

function furnish(ctx) {
  const L = ctx.P.R.rlock;
  // Свет шлюза — двумя плафонами вдоль: лампа шлюза показывает его цикл
  // (js/game/airlock.js, lockLight) — дежурный, жёлтый на стравливании,
  // красный при открытой двери.
  lamp(ctx, ctx.meshes.rlock, L, 0.2, -1.05, { w: 0.6, range: 2.4, kind: 'lock' });
  lamp(ctx, ctx.meshes.rlock, L, 0.2, -0.05, { w: 0.6, range: 2.2, kind: 'lock' });
}

export const ROVER_PLAN = makePlan({
  code: 'rover',
  rooms: ROVER_ROOMS, stairs: [], doors: [], hatches: ROVER_HATCHES, windows: [], openings: ROVER_OPENINGS,
  special,
  furnish,
  roomAtExtra: (p) => (p[2] >= 0.35 && p[2] <= 3.0 && Math.abs(p[0]) <= 1.3 && p[1] >= FLOOR - 0.3 && p[1] <= CEIL + 0.2
    ? ROVER_ROOMS[0] : null),
  // Выреза кузова нет: стены шлюза тонкие и стоят внутри него, а коробка
  // выреза (прямоугольная) прорезала фаски крыши — в открытую дверь были
  // видны дыры в кузове над ней. Панель двери снимает вырез люка (hatchCut).
  carve: [],
  // Свет снаружи — только в кабину: стекло только там.
  sunBox: { lo: [-1.4, FLOOR - 0.2, 0.3], hi: [1.4, RV.body.top + 0.2, 3.2] },
  seat: SEAT,
  origin: RV.eye,
  pod: true,
});
