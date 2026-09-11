// Тень корабля на грунте.
//
// Полноценных карт теней здесь нет и не нужно: тень отбрасывает ровно
// один предмет — сам корабль, и ровно на одну поверхность — на грунт под
// ним. Для такого случая силуэт считается прямо: вершины корпуса
// проецируются вдоль луча от солнца на плоскость грунта, по ним строится
// выпуклая оболочка, а она уже НАТЯГИВАЕТСЯ НА РЕЛЬЕФ — каждая вершина
// сетки опускается на настоящую высоту грунта под собой.
//
// Натягивать обязательно: плоским многоугольником тень на кратере
// наполовину уходит под грунт, наполовину висит над ним, и читается как
// отдельный предмет, проваливающийся сквозь землю.
//
// Это дёшево (полсотни проекций и полсотни высот на кадр, без второго
// прохода рендера и без текстуры глубины) и на безатмосферном теле
// физически уместно: там тени резкие и чёрные, размывать их нечем.
//
// Заодно тень — второй после кольца признак высоты: по расстоянию между
// кораблём и его тенью сразу видно, насколько он над грунтом.

import { v3, normalize, dot } from '../core/vec3.js';
import { altitudeOf, worldPoint } from './surface.js';

// Ниже этого синуса высоты солнца тень не строим: у самого горизонта она
// растягивается в бесконечность, а точность луча падает.
export const SUN_MIN = 0.12;
export const SHADOW_MAX_ALT = 3;      // км — выше тень уже не разглядеть
// Силуэт кладётся на рельеф сеткой: SECTORS секторов по кругу и два
// кольца от центра. Плоским многоугольником тень нельзя — на кратере
// она наполовину уходит под грунт, наполовину висит над ним, и читается
// как отдельный предмет, проваливающийся сквозь землю.
const SECTORS = 16;

const _up = v3();
const _hit = v3();
const _p = v3();
const _e1 = v3();
const _e2 = v3();
const _probe = v3();
const _alt = { dir: v3() };
let _rad = new Float32Array(0);
let _nodes = new Float32Array(0);

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

  // Центр силуэта и его радиус по каждому направлению: дальше тень
  // строится не как многоугольник, а как сетка, натянутая на рельеф.
  let cx = 0, cy = 0;
  for (const i of hull) { cx += flat[i * 2]; cy += flat[i * 2 + 1]; }
  cx /= hull.length; cy /= hull.length;

  const rad = _rad.length === SECTORS ? _rad : (_rad = new Float32Array(SECTORS));
  for (let k = 0; k < SECTORS; k++) {
    const a = (k / SECTORS) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = 0;
    for (let i = 0; i < hull.length; i++) {
      const p0 = hull[i], p1 = hull[(i + 1) % hull.length];
      const ax = flat[p0 * 2] - cx, ay = flat[p0 * 2 + 1] - cy;
      const bx = flat[p1 * 2] - cx, by = flat[p1 * 2 + 1] - cy;
      // Пересечение луча (dx,dy) с отрезком a->b.
      const den = (bx - ax) * dy - (by - ay) * dx;
      if (Math.abs(den) < 1e-12) continue;
      const u = (ax * dy - ay * dx) / -den;
      if (u < 0 || u > 1) continue;
      const px = ax + (bx - ax) * u, py = ay + (by - ay) * u;
      const t = px * dx + py * dy;
      if (t > best) best = t;
    }
    rad[k] = best;
  }

  // Подъём над грунтом. Сам рельеф рисуется плитками, и их сетка грубее
  // расчётной поверхности на десятки сантиметров — тень должна лежать
  // выше этой разницы, иначе она частями тонет в собственном грунте.
  const lift = Math.min(0.02, Math.max(0.0012, zone.alt * 0.01));

  // Высота грунта считается ОДИН раз на точку сетки: центр, среднее
  // кольцо и внешнее — всего 2·SECTORS+1 отсчёт. Треугольники потом
  // собираются копированием. Если считать её на каждую вершину каждого
  // треугольника, выходит вчетверо больше выборок рельефа — а это самая
  // дорогая часть всей тени.
  const RING = 0.55;
  const nodes = _nodes.length === (2 * SECTORS + 1) * 3
    ? _nodes : (_nodes = new Float32Array((2 * SECTORS + 1) * 3));
  const node = (x, y, i) => {
    _p.x = _hit.x + _e1.x * x + _e2.x * y;
    _p.y = _hit.y + _e1.y * x + _e2.y * y;
    _p.z = _hit.z + _e1.z * x + _e2.z * y;
    const a = altitudeOf(body, _p, _alt);
    worldPoint(body, a.dir, a.groundR + lift, _probe);
    nodes[i * 3] = _probe.x - ship.pos.x;
    nodes[i * 3 + 1] = _probe.y - ship.pos.y;
    nodes[i * 3 + 2] = _probe.z - ship.pos.z;
  };
  node(cx, cy, 0);
  for (let k = 0; k < SECTORS; k++) {
    const a = (k / SECTORS) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    node(cx + dx * rad[k] * RING, cy + dy * rad[k] * RING, 1 + k);
    node(cx + dx * rad[k], cy + dy * rad[k], 1 + SECTORS + k);
  }

  // Треугольники: веер от центра к среднему кольцу и полоса между кольцами.
  // На сектор приходится девять вершин, на вершину — три числа.
  const need = SECTORS * 9 * 3;
  const dst = out.verts && out.verts.length >= need
    ? out.verts : (out.verts = new Float32Array(need));
  let o = 0;
  const put = (i) => {
    dst[o++] = nodes[i * 3];
    dst[o++] = nodes[i * 3 + 1];
    dst[o++] = nodes[i * 3 + 2];
  };
  for (let k = 0; k < SECTORS; k++) {
    const k2 = (k + 1) % SECTORS;
    const m0 = 1 + k, m1 = 1 + k2;
    const e0 = 1 + SECTORS + k, e1 = 1 + SECTORS + k2;
    put(0); put(m0); put(m1);
    put(m0); put(e0); put(e1);
    put(m0); put(e1); put(m1);
  }
  out.count = o / 3;
  return out.count;
}
