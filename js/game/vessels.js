// Корабли как места: где на корабле точка, где в мире человек.
//
// Пока корабль был один, «оси корабля» означали оси СВОЕГО корабля, и
// всё, что про них знало, брало его из одной переменной. Теперь пилот
// ходит и по чужим палубам, а за бортом между двумя кораблями, и любой
// корабль — своё «место»: точка, базис, шасси и люки (js/game/airlock.js).
// Здесь — то, что одинаково для любого из них: переводы точек туда и
// обратно, кто рядом, где в мире стоит человек.
//
// «Корабль» здесь — что угодно с полями pos (км, мир), basis (right, up,
// fwd), gear ({t, out, drop}) и air (шлюзы): свой корабль (обёртка над
// ним в js/main.js) и чужой (запись js/game/peers.js).
//
// Без мира и без рендера: проверяется в Node (tools/test.mjs).

import { bodyBasis } from './world.js';
import { makeBasis, toLocal, toWorld, dirToWorld } from '../core/basis.js';

/** Точка в осях корабля (м) -> мир (км). */
export function vesselPoint(V, p, out = { x: 0, y: 0, z: 0 }) {
  const b = V.basis;
  out.x = V.pos.x + (b.right.x * p[0] + b.up.x * p[1] + b.fwd.x * p[2]) / 1000;
  out.y = V.pos.y + (b.right.y * p[0] + b.up.y * p[1] + b.fwd.y * p[2]) / 1000;
  out.z = V.pos.z + (b.right.z * p[0] + b.up.z * p[1] + b.fwd.z * p[2]) / 1000;
  return out;
}

/** Направление в осях корабля -> мир. */
export function vesselDir(V, d, out = { x: 0, y: 0, z: 0 }) {
  const b = V.basis;
  out.x = b.right.x * d[0] + b.up.x * d[1] + b.fwd.x * d[2];
  out.y = b.right.y * d[0] + b.up.y * d[1] + b.fwd.y * d[2];
  out.z = b.right.z * d[0] + b.up.z * d[1] + b.fwd.z * d[2];
  return out;
}

/** Мир (км) -> оси корабля (м). */
export function worldToVessel(V, P, out = [0, 0, 0]) {
  const b = V.basis;
  const dx = (P.x - V.pos.x) * 1000, dy = (P.y - V.pos.y) * 1000, dz = (P.z - V.pos.z) * 1000;
  out[0] = dx * b.right.x + dy * b.right.y + dz * b.right.z;
  out[1] = dx * b.up.x + dy * b.up.y + dz * b.up.z;
  out[2] = dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z;
  return out;
}

/** Расстояние от точки мира до корабля, км. */
export const vesselDist = (V, P) => Math.hypot(P.x - V.pos.x, P.y - V.pos.y, P.z - V.pos.z);

/**
 * Корабли ближе range км к точке — по возрастанию расстояния. Пешком
 * дальше сотни метров ни на что не наступают, а перекладывать твёрдое
 * каждого корабля системы в оси грунта каждый кадр незачем.
 */
export function nearVessels(list, P, range, out = []) {
  out.length = 0;
  for (const V of list) {
    if (!V || !V.pos) continue;
    const d = vesselDist(V, P);
    if (d <= range) { V._d = d; out.push(V); }
  }
  out.sort((a, b) => a._d - b._d);
  return out;
}

const _B = makeBasis();

/** Точка мира -> оси тела (км), как их пишет сохранение (anchor, out_pose). */
export function bodyLocal(body, P, out = { x: 0, y: 0, z: 0 }) {
  bodyBasis(body, _B);
  return toLocal(_B, body.pos, P, out);
}

/** Направление мира -> оси тела. */
export function bodyLocalDir(body, d, out = { x: 0, y: 0, z: 0 }) {
  bodyBasis(body, _B);
  return toLocal(_B, { x: 0, y: 0, z: 0 }, d, out);
}

/** Оси тела (км) -> мир. */
export function bodyWorld(body, l, out = { x: 0, y: 0, z: 0 }) {
  bodyBasis(body, _B);
  return toWorld(_B, body.pos, l, out);
}

/** Направление в осях тела -> мир. */
export function bodyWorldDir(body, d, out = { x: 0, y: 0, z: 0 }) {
  bodyBasis(body, _B);
  return dirToWorld(_B, d, out);
}

/**
 * Где в мире стоит человек (запись js/game/peers.js, peoplePoses): ноги и
 * оси тела — «вверх» и «вперёд».
 *
 *   на палубе — в осях корабля: верх — верх корабля, вперёд — по yaw;
 *   на грунте — в осях тела: верх — от центра тела, вперёд — куда смотрит.
 *
 * @param vessel  корабль, на борту которого человек (или null)
 * @param body    тело, на грунте которого он (или null)
 * @returns false, если опоры нет в этом мире (корабль не здесь)
 */
export function personPlace(person, vessel, body, out) {
  if (person.st === 'out') {
    if (!body) return false;
    bodyWorld(body, { x: person.p[0], y: person.p[1], z: person.p[2] }, out.pos);
    const ux = out.pos.x - body.pos.x, uy = out.pos.y - body.pos.y, uz = out.pos.z - body.pos.z;
    const ul = Math.hypot(ux, uy, uz) || 1;
    out.basis.up.x = ux / ul; out.basis.up.y = uy / ul; out.basis.up.z = uz / ul;
    bodyWorldDir(body, person.face, out.basis.fwd);
  } else {
    if (!vessel) return false;
    vesselPoint(vessel, person.p, out.pos);
    const s = Math.sin(person.yaw), c = Math.cos(person.yaw);
    vesselDir(vessel, [0, 1, 0], out.basis.up);
    vesselDir(vessel, [s, 0, c], out.basis.fwd);
  }
  // Вперёд — в плоскость горизонта, вправо — по тройке.
  const u = out.basis.up, f = out.basis.fwd;
  const k = f.x * u.x + f.y * u.y + f.z * u.z;
  f.x -= u.x * k; f.y -= u.y * k; f.z -= u.z * k;
  const fl = Math.hypot(f.x, f.y, f.z);
  if (fl < 1e-6) {
    // Взгляд строго по вертикали — любой перпендикуляр.
    f.x = Math.abs(u.y) < 0.9 ? 0 : 1; f.y = Math.abs(u.y) < 0.9 ? 1 : 0; f.z = 0;
    const kk = f.x * u.x + f.y * u.y;
    f.x -= u.x * kk; f.y -= u.y * kk; f.z -= u.z * kk;
  }
  const l2 = Math.hypot(f.x, f.y, f.z) || 1;
  f.x /= l2; f.y /= l2; f.z /= l2;
  // right = up × fwd (система правая: fwd = right × up).
  out.basis.right.x = u.y * f.z - u.z * f.y;
  out.basis.right.y = u.z * f.x - u.x * f.z;
  out.basis.right.z = u.x * f.y - u.y * f.x;
  return true;
}
