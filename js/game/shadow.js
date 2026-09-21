// Тень корабля на грунте.
//
// Полноценных карт теней здесь нет и не нужно: тень отбрасывает ровно
// один предмет — сам корабль, и ровно на одну поверхность — на грунт под
// ним. Для такого случая силуэт считается прямо: вершины корпуса
// проецируются вдоль луча от солнца на плоскость грунта.
//
// Силуэт — НАСТОЯЩИЙ, по граням корпуса.
//
// Раньше здесь строилась выпуклая оболочка проекции, и от корабля
// оставался ромб: у этого корпуса настоящий силуэт занимает лишь 56%
// площади своей оболочки — узкий нос, ступенчатый корпус и широкие
// крылья в корме превращались в один кусок. Теперь на грунт кладутся те
// грани, которые отвёрнуты от солнца (их-то свет и не достаёт), и тень
// повторяет корабль со всеми вырезами.
//
// Накладываться друг на друга проекции граней могут (корпус не выпуклый),
// а смешивание у тени умножающее — двойное перекрытие давало бы чёрные
// пятна. Поэтому грани рисуются в ТРАФАРЕТ, а умножается по нему
// накрывающая сетка (out.cover): каждый пиксель ровно один раз.
//
// Высота берётся не под каждой вершиной: рельеф — самая дорогая функция
// в игре, а вершин у силуэта тысячи. Вместо этого под тенью строится
// сетка GRID×GRID настоящих высот, и вершины садятся на неё
// билинейно. Она же служит и накрывающей сеткой — один расчёт на две
// работы.
//
// Натягивать на рельеф обязательно: плоским многоугольником тень на
// кратере наполовину уходит под грунт, наполовину висит над ним, и
// читается как отдельный предмет, проваливающийся сквозь землю.
//
// Заодно тень — второй после кольца признак высоты: по расстоянию между
// кораблём и его тенью сразу видно, насколько он над грунтом.

import { v3, normalize, dot } from '../core/vec3.js';
import { altitudeOf, worldPoint } from './surface.js';

// Ниже этого синуса высоты солнца тень не строим: у самого горизонта она
// растягивается в бесконечность, а точность луча падает.
export const SUN_MIN = 0.12;
export const SHADOW_MAX_ALT = 3;      // км — выше тень уже не разглядеть

// Узлов сетки высот по стороне габарита тени. Семь на сторону — это 49
// выборок рельефа на кадр, примерно столько же, сколько стоила старая
// тень из двух колец, и вдвое точнее по шагу.
const GRID = 7;

const _up = v3();
const _hit = v3();
const _p = v3();
const _e1 = v3();
const _e2 = v3();
const _probe = v3();
const _n = v3();
const _alt = { dir: v3() };
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
 * @param mesh модель корпуса ({verts, faces})
 * @param sunPos положение светила
 * @param out   куда положить результат. Координаты ОТНОСИТЕЛЬНО корабля:
 *              так они остаются мелкими числами и не теряют точность на
 *              межпланетных расстояниях.
 *                verts/count — треугольники силуэта (в трафарет),
 *                cover/coverCount — накрывающая сетка (её и умножают).
 * @returns число вершин силуэта или 0, если тени нет
 */
export function shipShadow(zone, ship, mesh, sunPos, out) {
  out.coverCount = 0;
  if (!zone || !mesh || !mesh.verts || !mesh.verts.length || !mesh.faces) return 0;
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

  // Грани, отвёрнутые от солнца: свет их не достаёт, и на грунте лежит
  // именно их проекция. Освещённые брать нельзя — получилась бы вторая
  // копия того же силуэта, только вывернутая.
  const faces = mesh.faces;
  let tris = 0;
  for (const f of faces) {
    if (!f.v || f.v.length < 3) continue;
    const nn = f.n;
    if (nn && !f.twoSided) {
      _n.x = b.right.x * nn.x + b.up.x * nn.y + b.fwd.x * nn.z;
      _n.y = b.right.y * nn.x + b.up.y * nn.y + b.fwd.y * nn.z;
      _n.z = b.right.z * nn.x + b.up.z * nn.y + b.fwd.z * nn.z;
      if (_n.x * sun.x + _n.y * sun.y + _n.z * sun.z >= 0) continue;   // освещена
    }
    tris += f.v.length - 2;
    f._shade = true;
  }
  if (tris < 1) return 0;

  // Габарит тени в осях плоскости — по ним же строится сетка высот.
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const f of faces) {
    if (!f._shade) continue;
    for (const i of f.v) {
      const uu = flat[i * 2], vv = flat[i * 2 + 1];
      if (uu < u0) u0 = uu;
      if (uu > u1) u1 = uu;
      if (vv < v0) v0 = vv;
      if (vv > v1) v1 = vv;
    }
  }
  // Запас в полшага: накрывающая сетка обязана перекрывать силуэт
  // целиком, иначе по краю тени остаётся светлая кайма.
  const padU = Math.max(1e-6, (u1 - u0) * 0.08);
  const padV = Math.max(1e-6, (v1 - v0) * 0.08);
  u0 -= padU; u1 += padU; v0 -= padV; v1 += padV;

  // Подъём над грунтом. Сам рельеф рисуется плитками, и их сетка грубее
  // расчётной поверхности на десятки сантиметров — тень должна лежать
  // выше этой разницы, иначе она частями тонет в собственном грунте.
  const lift = Math.min(0.02, Math.max(0.0012, zone.alt * 0.01));

  // Сетка настоящих высот под тенью. Это единственное место, где
  // считается рельеф, — GRID² выборок на кадр.
  const nodeCount = GRID * GRID;
  const nodes = _nodes.length === nodeCount * 3 ? _nodes : (_nodes = new Float32Array(nodeCount * 3));
  const du = (u1 - u0) / (GRID - 1), dv = (v1 - v0) / (GRID - 1);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const uu = u0 + du * i, vv = v0 + dv * j;
      _p.x = _hit.x + _e1.x * uu + _e2.x * vv;
      _p.y = _hit.y + _e1.y * uu + _e2.y * vv;
      _p.z = _hit.z + _e1.z * uu + _e2.z * vv;
      const a = altitudeOf(body, _p, _alt);
      worldPoint(body, a.dir, a.groundR + lift, _probe);
      const k = (j * GRID + i) * 3;
      nodes[k] = _probe.x - ship.pos.x;
      nodes[k + 1] = _probe.y - ship.pos.y;
      nodes[k + 2] = _probe.z - ship.pos.z;
    }
  }

  // Точка плоскости -> точка на рельефе: билинейно по сетке узлов.
  const put = (dst, o, uu, vv) => {
    const fi = Math.min(GRID - 1.0001, Math.max(0, (uu - u0) / du));
    const fj = Math.min(GRID - 1.0001, Math.max(0, (vv - v0) / dv));
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    const tu = fi - i0, tv = fj - j0;
    const k00 = (j0 * GRID + i0) * 3, k10 = k00 + 3;
    const k01 = k00 + GRID * 3, k11 = k01 + 3;
    for (let c = 0; c < 3; c++) {
      const a = nodes[k00 + c] + (nodes[k10 + c] - nodes[k00 + c]) * tu;
      const bb = nodes[k01 + c] + (nodes[k11 + c] - nodes[k01 + c]) * tu;
      dst[o + c] = a + (bb - a) * tv;
    }
    return o + 3;
  };

  // Силуэт: треугольники отвёрнутых граней.
  const need = tris * 9;
  const dstV = out.verts && out.verts.length >= need ? out.verts : (out.verts = new Float32Array(need));
  let o = 0;
  for (const f of faces) {
    if (!f._shade) continue;
    f._shade = false;
    const idx = f.v;
    for (let t = 2; t < idx.length; t++) {
      for (const i of [idx[0], idx[t - 1], idx[t]]) {
        o = put(dstV, o, flat[i * 2], flat[i * 2 + 1]);
      }
    }
  }
  out.count = o / 3;

  // Накрывающая сетка: те же узлы, собранные в полосы. Перекрытий в ней
  // нет по построению, поэтому умножать по трафарету можно ею.
  const coverNeed = (GRID - 1) * (GRID - 1) * 6 * 3;
  const dstC = out.cover && out.cover.length >= coverNeed
    ? out.cover : (out.cover = new Float32Array(coverNeed));
  let c = 0;
  const node = (i, j) => {
    const k = (j * GRID + i) * 3;
    dstC[c++] = nodes[k]; dstC[c++] = nodes[k + 1]; dstC[c++] = nodes[k + 2];
  };
  for (let j = 0; j < GRID - 1; j++) {
    for (let i = 0; i < GRID - 1; i++) {
      node(i, j); node(i + 1, j); node(i + 1, j + 1);
      node(i, j); node(i + 1, j + 1); node(i, j + 1);
    }
  }
  out.coverCount = c / 3;
  return out.count;
}
