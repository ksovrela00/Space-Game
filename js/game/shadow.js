// Тень корабля на грунте.
//
// Полноценных карт теней здесь нет и не нужно: тень отбрасывает ровно
// один предмет — сам корабль, и ровно на одну поверхность — на грунт под
// ним. Для такого случая силуэт считается прямо: вершины корпуса
// проецируются вдоль луча от солнца на плоскость грунта, по ним строится
// выпуклая оболочка, и она рисуется одним тёмным многоугольником.
//
// Это дёшево (сотня вершин и оболочка на кадр, без второго прохода
// рендера и без текстуры глубины) и на безатмосферном теле физически
// уместно: там тени резкие и чёрные, размывать их нечем.
//
// Заодно тень — второй после кольца признак высоты: по расстоянию между
// кораблём и его тенью сразу видно, насколько он над грунтом.

import { v3, normalize, dot } from '../core/vec3.js';
import { altitudeOf } from './surface.js';

// Ниже этого синуса высоты солнца тень не строим: у самого горизонта она
// растягивается в бесконечность, а точность луча падает.
export const SUN_MIN = 0.12;
export const SHADOW_MAX_ALT = 3;      // км — выше тень уже не разглядеть

const _up = v3();
const _hit = v3();
const _p = v3();
const _e1 = v3();
const _e2 = v3();
const _probe = v3();
const _alt = { dir: v3() };

/**
 * Найти точку, где луч от корабля по направлению «от солнца» упирается в
 * грунт. Рельеф считается тем же кодом, что и всё остальное, поэтому
 * тень ложится на настоящую поверхность, а не на сферу.
 */
function groundHit(body, from, dir, alt0, out) {
  // Первая оценка — плоская земля, дальше уточняем по рельефу.
  let lo = 0, hi = Math.max(0.001, alt0 * 3 + 0.05);
  const at = (t) => {
    _probe.x = from.x + dir.x * t;
    _probe.y = from.y + dir.y * t;
    _probe.z = from.z + dir.z * t;
    return altitudeOf(body, _probe, _alt).alt;
  };
  // Расширяем отрезок, пока не окажемся под поверхностью (не больше
  // нескольких шагов: если не нашли — солнце слишком низко).
  let guard = 0;
  while (at(hi) > 0 && guard++ < 6) { lo = hi; hi *= 2; }
  if (at(hi) > 0) return false;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > 0) lo = mid; else hi = mid;
  }
  const t = (lo + hi) / 2;
  out.x = from.x + dir.x * t;
  out.y = from.y + dir.y * t;
  out.z = from.z + dir.z * t;
  return true;
}

/** Выпуклая оболочка набора точек на плоскости (обход Эндрю). */
export function convexHull(pts, n) {
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  idx.sort((a, b) => (pts[a * 2] - pts[b * 2]) || (pts[a * 2 + 1] - pts[b * 2 + 1]));
  const cross = (o, a, b) =>
    (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) -
    (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
  const build = (src) => {
    const st = [];
    for (const i of src) {
      while (st.length >= 2 && cross(st[st.length - 2], st[st.length - 1], i) <= 0) st.pop();
      st.push(i);
    }
    st.pop();
    return st;
  };
  const lower = build(idx);
  const upper = build(idx.slice().reverse());
  return lower.concat(upper);
}

/**
 * Силуэт корабля на грунте.
 *
 * @param zone обстановка у поверхности (js/game/landing.js → landingContext)
 * @param ship корабль
 * @param mesh модель корпуса ({verts})
 * @param sunPos положение светила
 * @param out   {verts: Float32Array} — куда положить вершины (координаты
 *              ОТНОСИТЕЛЬНО корабля: так они остаются мелкими числами и
 *              не теряют точность на межпланетных расстояниях)
 * @returns число вершин многоугольника или 0, если тени нет
 */
export function shipShadow(zone, ship, mesh, sunPos, out) {
  if (!zone || !mesh || !mesh.verts || !mesh.verts.length) return 0;
  if (!(zone.alt > 0) || zone.alt > SHADOW_MAX_ALT) return 0;
  const body = zone.body;

  normalize(v3(sunPos.x - ship.pos.x, sunPos.y - ship.pos.y, sunPos.z - ship.pos.z), _up);
  const sun = { x: _up.x, y: _up.y, z: _up.z };          // направление НА солнце
  const cos = dot(sun, zone.upWorld);
  if (cos < SUN_MIN) return 0;                            // солнце у горизонта или за ним

  // Луч от корабля прочь от солнца до грунта.
  const dir = { x: -sun.x, y: -sun.y, z: -sun.z };
  if (!groundHit(body, ship.pos, dir, zone.alt, _hit)) return 0;

  // Плоскость грунта в точке падения: нормаль — местная вертикаль, она
  // устойчивее нормали рельефа (та скачет на камнях, и тень бы дрожала).
  normalize(v3(_hit.x - body.pos.x, _hit.y - body.pos.y, _hit.z - body.pos.z), _up);
  const denom = dot(dir, _up);
  if (denom > -1e-4) return 0;

  // Оси плоскости.
  const helper = Math.abs(_up.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  normalize(v3(
    helper.y * _up.z - helper.z * _up.y,
    helper.z * _up.x - helper.x * _up.z,
    helper.x * _up.y - helper.y * _up.x), _e1);
  _e2.x = _up.y * _e1.z - _up.z * _e1.y;
  _e2.y = _up.z * _e1.x - _up.x * _e1.z;
  _e2.z = _up.x * _e1.y - _up.y * _e1.x;

  // Проекция вершин корпуса на плоскость вдоль луча.
  const verts = mesh.verts;
  const n = verts.length;
  const flat = out.flat && out.flat.length >= n * 2 ? out.flat : (out.flat = new Float32Array(n * 2));
  const b = ship.basis;
  for (let i = 0; i < n; i++) {
    const v = verts[i];
    _p.x = ship.pos.x + b.right.x * v.x + b.up.x * v.y + b.fwd.x * v.z;
    _p.y = ship.pos.y + b.right.y * v.x + b.up.y * v.y + b.fwd.y * v.z;
    _p.z = ship.pos.z + b.right.z * v.x + b.up.z * v.y + b.fwd.z * v.z;
    const s = ((_hit.x - _p.x) * _up.x + (_hit.y - _p.y) * _up.y + (_hit.z - _p.z) * _up.z) / denom;
    const qx = _p.x + dir.x * s - _hit.x;
    const qy = _p.y + dir.y * s - _hit.y;
    const qz = _p.z + dir.z * s - _hit.z;
    flat[i * 2] = qx * _e1.x + qy * _e1.y + qz * _e1.z;
    flat[i * 2 + 1] = qx * _e2.x + qy * _e2.y + qz * _e2.z;
  }

  const hull = convexHull(flat, n);
  if (hull.length < 3) return 0;

  // Обратно в мир, относительно корабля, с подъёмом над грунтом: иначе
  // тень спорит с рельефом за глубину и мерцает.
  const lift = Math.max(0.0004, zone.alt * 0.004);
  const dst = out.verts && out.verts.length >= hull.length * 3
    ? out.verts : (out.verts = new Float32Array(Math.max(96, hull.length * 3)));
  for (let k = 0; k < hull.length; k++) {
    const a = flat[hull[k] * 2], c = flat[hull[k] * 2 + 1];
    dst[k * 3] = _hit.x + _e1.x * a + _e2.x * c + _up.x * lift - ship.pos.x;
    dst[k * 3 + 1] = _hit.y + _e1.y * a + _e2.y * c + _up.y * lift - ship.pos.y;
    dst[k * 3 + 2] = _hit.z + _e1.z * a + _e2.z * c + _up.z * lift - ship.pos.z;
  }
  out.count = hull.length;
  return hull.length;
}
