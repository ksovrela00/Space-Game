// Поверхность тела с точки зрения игровой логики: высота под кораблём,
// нормаль склона, поиск площадки для посадки.
//
// Считается по тому же процедурному рельефу, что и картинка
// (js/gl/terrain.js — чистая математика, без единого вызова WebGL).
// Это принципиально: корабль должен садиться ровно туда, где нарисована
// земля, иначе он то зависает над ней, то уходит в неё по колено.
//
// Высота всегда берётся на ПОЛНОЙ детализации, а рендер — на той, какую
// способна показать сетка. Расхождение равно амплитуде неучтённых
// мелких деталей: у заплаток под кораблём это сантиметры.

import { v3, normalize, dot, clamp } from '../core/vec3.js';
import { makeBasis, toLocal } from '../core/basis.js';
import { bodyBasis } from './world.js';
import { terrainOf } from '../gl/terrain.js';

// Тело с твёрдой поверхностью: у него есть рельеф, и столкновение с ним
// считается по настоящей высоте, а не по сфере.
export const isSolid = (b) => !!b && !!b.isBody &&
  b.kind !== 'star' && b.kind !== 'gas';

// Садиться можно на тела без атмосферы: луны и голые планеты. Для планет
// с атмосферой нужен аэродинамический спуск — это отдельная работа.
export const isLandable = (b) => isSolid(b) && !b.atmo;

const _frame = makeBasis();


/** Базис тела (right/up/fwd), up — полюс; учитывает суточное вращение. */
export const bodyFrame = (body, out = _frame) => bodyBasis(body, out);

/** Направление из центра тела на точку, в локальных осях тела. */
export function localDir(body, pos, out = v3()) {
  const f = bodyFrame(body, _frame);
  toLocal(f, body.pos, pos, out);
  return normalize(out, out);
}

/** Мировая точка по локальному направлению и радиусу. */
export function worldPoint(body, dirLocal, radius, out = v3()) {
  const f = bodyFrame(body, _frame);
  out.x = body.pos.x + (f.right.x * dirLocal.x + f.up.x * dirLocal.y + f.fwd.x * dirLocal.z) * radius;
  out.y = body.pos.y + (f.right.y * dirLocal.x + f.up.y * dirLocal.y + f.fwd.y * dirLocal.z) * radius;
  out.z = body.pos.z + (f.right.z * dirLocal.x + f.up.z * dirLocal.y + f.fwd.z * dirLocal.z) * radius;
  return out;
}

/**
 * Мировая скорость точки поверхности: орбитальная скорость тела плюс
 * вращение. Посадка считается ОТНОСИТЕЛЬНО этой скорости — так же, как
 * в жизни: садятся не «в ноль по звёздам», а на движущийся грунт.
 */
export function surfaceVelocity(body, pos, out = v3()) {
  // Ось вращения — в мировых осях, длина = угловая скорость.
  const w = body.spin;
  const rx = pos.x - body.pos.x, ry = pos.y - body.pos.y, rz = pos.z - body.pos.z;
  const p = body.pole;
  out.x = body.vel.x + (p.y * rz - p.z * ry) * w;
  out.y = body.vel.y + (p.z * rx - p.x * rz) * w;
  out.z = body.vel.z + (p.x * ry - p.y * rx) * w;
  return out;
}

/** Локальное направление -> мировое (без сдвига). */
export function dirToWorldBody(body, dirLocal, out = v3()) {
  const f = bodyFrame(body, _frame);
  out.x = f.right.x * dirLocal.x + f.up.x * dirLocal.y + f.fwd.x * dirLocal.z;
  out.y = f.right.y * dirLocal.x + f.up.y * dirLocal.y + f.fwd.y * dirLocal.z;
  out.z = f.right.z * dirLocal.x + f.up.z * dirLocal.y + f.fwd.z * dirLocal.z;
  return out;
}

/** Высота рельефа над сферой радиуса body.radius, км. */
export function groundHeight(body, dirLocal) {
  if (!body.isBody) return 0;
  return terrainOf(body).displace(dirLocal.x, dirLocal.y, dirLocal.z) * body.radius;
}

/** Радиус поверхности в данном направлении, км от центра тела. */
export const groundRadius = (body, dirLocal) =>
  body.radius + groundHeight(body, dirLocal);

/**
 * Высота над поверхностью и всё, что для неё посчитано.
 * @returns {alt, dist, groundR, dir} — dir в локальных осях тела
 */
export function altitudeOf(body, pos, out = {}) {
  const dir = localDir(body, pos, out.dir || (out.dir = v3()));
  const dist = Math.hypot(pos.x - body.pos.x, pos.y - body.pos.y, pos.z - body.pos.z);
  const groundR = groundRadius(body, dir);
  out.dist = dist;
  out.groundR = groundR;
  out.alt = dist - groundR;
  return out;
}

const _pa = v3(), _pb = v3(), _pc = v3();
const _u = v3(), _v = v3();

// Две касательные оси в точке dirLocal (правая тройка: u x v = dir).
function tangents(dirLocal, u, v) {
  const helper = Math.abs(dirLocal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  // u = normalize(helper x dir), v = dir x u
  u.x = helper.y * dirLocal.z - helper.z * dirLocal.y;
  u.y = helper.z * dirLocal.x - helper.x * dirLocal.z;
  u.z = helper.x * dirLocal.y - helper.y * dirLocal.x;
  normalize(u, u);
  v.x = dirLocal.y * u.z - dirLocal.z * u.y;
  v.y = dirLocal.z * u.x - dirLocal.x * u.z;
  v.z = dirLocal.x * u.y - dirLocal.y * u.x;
  return normalize(v, v);
}

// Точка поверхности по смещению (du, dv) от направления dirLocal.
function surfPoint(body, dirLocal, u, v, du, dv, out) {
  out.x = dirLocal.x + u.x * du + v.x * dv;
  out.y = dirLocal.y + u.y * du + v.y * dv;
  out.z = dirLocal.z + u.z * du + v.z * dv;
  normalize(out, out);
  const r = groundRadius(body, out);
  out.x *= r; out.y *= r; out.z *= r;
  return out;
}

/**
 * Нормаль поверхности в локальных осях тела. Считается конечными
 * разностями с шагом порядка размера корабля: нормаль на шаге меньше
 * этого корабль всё равно «не чувствует», а шум в ней мешал бы
 * выравниванию при посадке.
 */
export function surfaceNormal(body, dirLocal, out = v3(), stepKm = 0.05) {
  const eps = Math.max(1e-7, stepKm / body.radius);
  tangents(dirLocal, _u, _v);
  surfPoint(body, dirLocal, _u, _v, 0, 0, _pa);
  surfPoint(body, dirLocal, _u, _v, eps, 0, _pb);
  surfPoint(body, dirLocal, _u, _v, 0, eps, _pc);
  const ax = _pb.x - _pa.x, ay = _pb.y - _pa.y, az = _pb.z - _pa.z;
  const bx = _pc.x - _pa.x, by = _pc.y - _pa.y, bz = _pc.z - _pa.z;
  out.x = ay * bz - az * by;
  out.y = az * bx - ax * bz;
  out.z = ax * by - ay * bx;
  const l = Math.hypot(out.x, out.y, out.z);
  if (l < 1e-12) { out.x = dirLocal.x; out.y = dirLocal.y; out.z = dirLocal.z; return out; }
  out.x /= l; out.y /= l; out.z /= l;
  // Наружу от центра — на всякий случай (при сильном шуме бывает иначе).
  if (dot(out, dirLocal) < 0) { out.x = -out.x; out.y = -out.y; out.z = -out.z; }
  return out;
}

/** Уклон поверхности в радианах (0 — площадка перпендикулярна радиусу). */
export function slopeAt(body, dirLocal, stepKm = 0.05) {
  const n = surfaceNormal(body, dirLocal, v3(), stepKm);
  return Math.acos(clamp(dot(n, dirLocal), -1, 1));
}

/**
 * Поиск площадки: из точек вокруг заданного направления выбирается та,
 * где склон наименьший. Сажать корабль строго «куда смотрел» нельзя —
 * попадание на склон кратерного вала означает опрокидывание.
 *
 * @param spanKm радиус поиска по поверхности
 * @returns {dir, slope, moved} — dir в локальных осях тела
 */
export function findSite(body, dirLocal, spanKm = 4, out = v3()) {
  const span = spanKm / body.radius;
  tangents(dirLocal, _u, _v);
  let best = null;
  const probe = v3();
  // Центр и две «спирали» вокруг него.
  for (let i = 0; i <= 24; i++) {
    let du = 0, dv = 0;
    if (i > 0) {
      const ring = i <= 12 ? 0.45 : 1.0;
      const a = (i % 12) / 12 * Math.PI * 2 + (i > 12 ? 0.26 : 0);
      du = Math.cos(a) * span * ring;
      dv = Math.sin(a) * span * ring;
    }
    probe.x = dirLocal.x + _u.x * du + _v.x * dv;
    probe.y = dirLocal.y + _u.y * du + _v.y * dv;
    probe.z = dirLocal.z + _u.z * du + _v.z * dv;
    normalize(probe, probe);
    // Небольшой штраф за удаление от исходной точки, чтобы при равных
    // склонах садиться там, куда и шли.
    const s = slopeAt(body, probe) + (i === 0 ? 0 : 0.01);
    if (!best || s < best.slope) {
      best = { slope: s, x: probe.x, y: probe.y, z: probe.z, i };
    }
  }
  out.x = best.x; out.y = best.y; out.z = best.z;
  return { dir: out, slope: slopeAt(body, out), moved: best.i !== 0 };
}

/** Широта/долгота в градусах — для экрана после посадки. */
export function latLon(dirLocal) {
  const lat = Math.asin(clamp(dirLocal.y, -1, 1)) * 180 / Math.PI;
  const lon = Math.atan2(dirLocal.z, dirLocal.x) * 180 / Math.PI;
  return { lat, lon };
}
