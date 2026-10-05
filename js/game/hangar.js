// Ангар: вездеход в трюме своего корабля.
//
// В трюме вездеход — та же машина, что на грунте (js/game/rover.js,
// stepHangar): его ведут, он едет и упирается в стены. Только живёт он там
// в ОСЯХ КОРАБЛЯ-НОСИТЕЛЯ: корабль стоит на грунте, и пол трюма — ровный пол
// в его осях. Здесь — всё, что связывает машину с носителем:
//
//   * пол под ней — палуба трюма или плита грузовой платформы (bayTop):
//     плита едет вниз — машина едет на ней;
//   * во что она упирается — твёрдое трюма: стены, ящики груза, края
//     колодца, пульт на плите (коробки помещений носителя и его шлюзов);
//   * где она в мире — из её места в трюме и места носителя;
//   * съезд и въезд: с плиты, опущенной до грунта, — на грунт, и обратно.
//
// Ничего не делается само (так решено с автором игры): платформу опускает и
// поднимает пилот пультом, в машину садится сам, выезжает сам. Трюм с
// поднятой плитой — просто закрытый гараж: тронулся — упёрся в стену.
//
// Оси — носителя: x вправо, y вверх, z вперёд, метры. Место машины — hg:
// { x, y, z, yaw } (yaw — от оси z корабля к оси x).

import { bayTop, airSolids } from './airlock.js';
import { crateSolids } from './walker.js';

/** Платформа трюма носителя (его шлюзы air), или null — у корабля её нет. */
export const hangarBay = (air) => (air && air.bays && air.bays[0]) || null;

/** Середина плиты в осях носителя (м): там машина, о месте которой в трюме ничего не известно. */
export function bayCenter(bx) {
  const b = bx.b;
  return { x: (b.x[0] + b.x[1]) / 2, z: (b.z[0] + b.z[1]) / 2 };
}

/** Над плитой ли точка (x, z) — с запасом m внутрь от края. */
export function overBay(bx, x, z, m = 0) {
  const b = bx.b;
  return x >= b.x[0] + m && x <= b.x[1] - m && z >= b.z[0] + m && z <= b.z[1] - m;
}

/** Пол под точкой трюма: верх плиты над ней, иначе палуба. */
export function hangarFloor(bx, x, z) {
  return overBay(bx, x, z) ? bayTop(bx) : bx.b.deck;
}

/**
 * Плита у грунта: опустилась до конца хода или легла на грунт — и стоит.
 * Только тогда с неё съезжают и на неё заезжают: с полпути — обрыв.
 */
export function bayDown(bx) {
  return bx.travel > 0.05 && bx.dir === 0 && (bx.floor || bx.travel >= bx.stroke - 1e-3);
}

// Твёрдое трюма — по планировке носителя: коробки, которые задевают трюм
// вместе с колодцем. Остальной корабль машине не нужен (кешируется).
const _holdSolids = new Map();
function holdSolidsOf(I, bx) {
  let list = _holdSolids.get(I);
  if (list) return list;
  const R = I.roomById[bx.room];
  const lo = [R.lo[0] - 1, bx.b.deck - bx.stroke - 1, R.lo[2] - 1];
  const hi = [R.hi[0] + 1, R.hi[1] + 1, R.hi[2] + 1];
  list = I.solids.filter((s) => s.hi[0] > lo[0] && s.lo[0] < hi[0] && s.hi[1] > lo[1] && s.lo[1] < hi[1]
    && s.hi[2] > lo[2] && s.lo[2] < hi[2]);
  _holdSolids.set(I, list);
  return list;
}

const _hs = [], _hAir = [];
/**
 * Во что машина в трюме упирается (оси носителя): стены и всё, что стоит в
 * трюме по планировке, ящики груза (столько, сколько их нарисовано, I.cargo)
 * и то, что ездит с плитой, — пульт на ней (шлюзы носителя).
 */
export function hangarSolids(I, air) {
  const bx = hangarBay(air);
  _hs.length = 0;
  if (!bx) return _hs;
  for (const s of holdSolidsOf(I, bx)) _hs.push(s);
  if (I.cargo > 0) for (const s of crateSolids(I, I.cargo * I.crate.tons)) _hs.push(s);
  for (const s of airSolids(air, _hAir)) _hs.push(s);
  return _hs;
}

/**
 * Машина в мире: точка и оси (out — { pos, basis }) из её места в трюме
 * hg и места носителя C ({ pos, basis }). Поворот — вокруг «вверх» корабля.
 */
export function hangarToWorld(C, hg, out) {
  const b = C.basis, s = Math.sin(hg.yaw), c = Math.cos(hg.yaw);
  const x = hg.x / 1000, y = hg.y / 1000, z = hg.z / 1000;
  out.pos.x = C.pos.x + b.right.x * x + b.up.x * y + b.fwd.x * z;
  out.pos.y = C.pos.y + b.right.y * x + b.up.y * y + b.fwd.y * z;
  out.pos.z = C.pos.z + b.right.z * x + b.up.z * y + b.fwd.z * z;
  const B = out.basis;
  const fx = b.fwd.x * c + b.right.x * s, fy = b.fwd.y * c + b.right.y * s, fz = b.fwd.z * c + b.right.z * s;
  const rx = b.right.x * c - b.fwd.x * s, ry = b.right.y * c - b.fwd.y * s, rz = b.right.z * c - b.fwd.z * s;
  B.fwd.x = fx; B.fwd.y = fy; B.fwd.z = fz;
  B.right.x = rx; B.right.y = ry; B.right.z = rz;
  B.up.x = b.up.x; B.up.y = b.up.y; B.up.z = b.up.z;
  return out;
}

/** Место в трюме из мира: точка P (км) и «вперёд» машины fwd -> hg (оси носителя C). */
export function worldToHangar(C, P, fwd, hg) {
  const b = C.basis;
  const dx = (P.x - C.pos.x) * 1000, dy = (P.y - C.pos.y) * 1000, dz = (P.z - C.pos.z) * 1000;
  hg.x = dx * b.right.x + dy * b.right.y + dz * b.right.z;
  hg.y = dx * b.up.x + dy * b.up.y + dz * b.up.z;
  hg.z = dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z;
  const fr = fwd.x * b.right.x + fwd.y * b.right.y + fwd.z * b.right.z;
  const ff = fwd.x * b.fwd.x + fwd.y * b.fwd.y + fwd.z * b.fwd.z;
  hg.yaw = Math.atan2(fr, ff);
  return hg;
}

/**
 * Поворот и сдвиг из осей машины в оси носителя: p' = R·p + t (R — строки
 * 3×3). Им твёрдое машины — кузов, трап, порог — ложится в трюм повёрнутыми
 * коробками (js/game/walker.js, ob): пешеход в трюме обходит машину и
 * поднимается по её трапу.
 */
export function hangarTransform(hg, T = { R: new Float64Array(9), t: [0, 0, 0] }) {
  const s = Math.sin(hg.yaw), c = Math.cos(hg.yaw), R = T.R;
  R[0] = c; R[1] = 0; R[2] = s;
  R[3] = 0; R[4] = 1; R[5] = 0;
  R[6] = -s; R[7] = 0; R[8] = c;
  T.t[0] = hg.x; T.t[1] = hg.y; T.t[2] = hg.z;
  return T;
}
