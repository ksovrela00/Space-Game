// Камера карты: облёт вокруг точки фокуса.
//
// Карта системы и галактики — трёхмерная: её вращают, приближают и
// сдвигают, как модель на столе. Камера смотрит на ФОКУС (выбранное тело,
// корабль или точку, куда её сдвинули) с расстояния dist, под углом yaw
// вокруг вертикали карты и pitch над её плоскостью. Вертикаль — ось Y мира:
// это нормаль эклиптики (орбиты наклонены к ней на градусы), а у галактики
// — нормаль её диска.
//
// У вида две копии чисел: где он сейчас и куда идёт (g). Мышь и клавиши
// меняют цель, а вид догоняет её экспоненциально — без рывков, и любое
// новое действие перехватывает движение на полпути, а не ждёт конца
// «анимации». Дистанция догоняется в логарифме: с края системы до станции
// у планеты — пять порядков, и линейный ход сначала пролетал бы всё, а
// потом полз.
//
// Всё здесь — без мира и без рендера: проверяется в Node (tools/test.mjs).

import { v3 } from '../core/vec3.js';

const DEG = Math.PI / 180;

export const MAPCAM = {
  fov: 50 * DEG,        // поле зрения карты — уже полётного: перспектива без «рыбьего глаза»
  pitch: 34 * DEG,      // обзорный наклон: плоскость читается, орбиты не сливаются в черту
  pitchMin: -84 * DEG,  // почти снизу и почти сверху, но не через полюс:
  pitchMax: 84 * DEG,   // у самого полюса «вправо» вырождается
  ease: 7,              // 1/с — вид догоняет цель за ~0.4 с
  turn: 0.006,          // рад на пиксель — поворот мышью
  wheel: 0.0016,        // масштаб на единицу колеса (экспонента)
  step: 1.35,           // масштаб на нажатие клавиши
};

/** Новая камера карты: всё в одной точке, дистанция — единица. */
export function makeMapCam() {
  const pose = () => ({ fx: 0, fy: 0, fz: 0, yaw: 0, pitch: MAPCAM.pitch, dist: 1 });
  return {
    ...pose(),
    g: pose(),
    // За кем едет фокус (у объекта есть pos): тела идут по орбитам, и
    // стоящий на месте фокус через минуту смотрел бы в пустоту.
    follow: null,
    lo: 1e-6,              // пределы дистанции: их ставит карта по виду
    hi: 1e12,
  };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Встать в цель сразу, без догоняния: открытие карты, сброс. */
export function snapMapCam(mc) {
  const g = mc.g;
  if (mc.follow && mc.follow.pos) { g.fx = mc.follow.pos.x; g.fy = mc.follow.pos.y; g.fz = mc.follow.pos.z; }
  mc.fx = g.fx; mc.fy = g.fy; mc.fz = g.fz;
  mc.yaw = g.yaw; mc.pitch = g.pitch; mc.dist = g.dist;
  return mc;
}

/** Цель вида — точка (без слежения). */
export function aimAt(mc, p, dist = null) {
  mc.follow = null;
  mc.g.fx = p.x; mc.g.fy = p.y; mc.g.fz = p.z;
  if (dist !== null) mc.g.dist = clamp(dist, mc.lo, mc.hi);
  return mc;
}

/** Цель вида — объект: фокус едет за ним. */
export function followObj(mc, obj, dist = null) {
  mc.follow = obj;
  if (obj && obj.pos) { mc.g.fx = obj.pos.x; mc.g.fy = obj.pos.y; mc.g.fz = obj.pos.z; }
  if (dist !== null) mc.g.dist = clamp(dist, mc.lo, mc.hi);
  return mc;
}

/** Шаг: вид догоняет цель. */
export function stepMapCam(mc, dt) {
  const g = mc.g;
  if (mc.follow && mc.follow.pos) { g.fx = mc.follow.pos.x; g.fy = mc.follow.pos.y; g.fz = mc.follow.pos.z; }
  g.dist = clamp(g.dist, mc.lo, mc.hi);
  g.pitch = clamp(g.pitch, MAPCAM.pitchMin, MAPCAM.pitchMax);
  const k = 1 - Math.exp(-MAPCAM.ease * Math.max(0, dt));
  mc.fx += (g.fx - mc.fx) * k;
  mc.fy += (g.fy - mc.fy) * k;
  mc.fz += (g.fz - mc.fz) * k;
  mc.yaw = wrap(mc.yaw + wrap(g.yaw - mc.yaw) * k);
  mc.pitch += (g.pitch - mc.pitch) * k;
  const ld = Math.log(Math.max(1e-12, mc.dist)), lg = Math.log(Math.max(1e-12, g.dist));
  mc.dist = Math.exp(ld + (lg - ld) * k);
  // Последние доли процента догоняются сразу: иначе фокус «доползает»
  // до тела бесконечно, и щелчок по нему всё время попадает в движущееся.
  if (Math.abs(lg - Math.log(Math.max(1e-12, mc.dist))) < 1e-4) mc.dist = g.dist;
  return mc;
}

/** Направление от фокуса к глазу (единичное) для угла и наклона. */
export function eyeDir(yaw, pitch, out = v3()) {
  const cp = Math.cos(pitch);
  out.x = cp * Math.sin(yaw);
  out.y = Math.sin(pitch);
  out.z = cp * Math.cos(yaw);
  return out;
}

const _d = v3();
/**
 * Поставить камеру (js/render/camera.js) в текущий вид: глаз на дистанции
 * от фокуса, взгляд — в фокус, «вверх» — к вертикали карты.
 * Оси — как у кораблей: right = up × fwd (x вправо, y вверх, z вперёд).
 */
export function poseCamera(mc, cam) {
  const d = eyeDir(mc.yaw, mc.pitch, _d);
  cam.pos.x = mc.fx + d.x * mc.dist;
  cam.pos.y = mc.fy + d.y * mc.dist;
  cam.pos.z = mc.fz + d.z * mc.dist;
  const f = cam.basis.fwd, r = cam.basis.right, u = cam.basis.up;
  f.x = -d.x; f.y = -d.y; f.z = -d.z;
  // right = (0,1,0) × fwd
  let rx = f.z, rz = -f.x;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-9) { rx = Math.cos(mc.yaw); rz = -Math.sin(mc.yaw); } else { rx /= rl; rz /= rl; }
  r.x = rx; r.y = 0; r.z = rz;
  // up = fwd × right
  u.x = f.y * r.z - f.z * r.y;
  u.y = f.z * r.x - f.x * r.z;
  u.z = f.x * r.y - f.y * r.x;
  return cam;
}

/**
 * Повернуть вид мышью: сдвиг в пикселях. Тянешь вправо — сцена едет
 * вправо, то есть глаз обходит фокус влево (yaw растёт: при yaw = 0
 * «вправо» камеры — это −X, и глаз уходит к +X). Тянешь вниз — ближний
 * край плоскости идёт к тебе, и смотришь круче сверху.
 */
export function turnMapCam(mc, dx, dy) {
  mc.g.yaw = wrap(mc.g.yaw + dx * MAPCAM.turn);
  mc.g.pitch = clamp(mc.g.pitch + dy * MAPCAM.turn, MAPCAM.pitchMin, MAPCAM.pitchMax);
  return mc;
}

/** Приблизить (k > 1) или отдалить (k < 1) — к фокусу. */
export function zoomMapCam(mc, k) {
  if (!(k > 0)) return mc;
  mc.g.dist = clamp(mc.g.dist / k, mc.lo, mc.hi);
  return mc;
}

/**
 * Сдвинуть фокус по плоскости карты: тянешь — плоскость едет под рукой.
 * pxKm — сколько километров в пикселе у фокуса; слежение снимается.
 */
export function panMapCam(mc, dx, dy, pxKm) {
  mc.follow = null;
  const s = Math.sin(mc.g.yaw), c = Math.cos(mc.g.yaw);
  // «Вправо» камеры по плоскости — R = (−cos yaw, 0, sin yaw), «от себя» —
  // F = (−sin yaw, 0, −cos yaw) (см. poseCamera). Тянешь вправо — точка
  // под рукой едет вправо, значит фокус уходит на −R; тянешь вниз —
  // плоскость едет к тебе, фокус уходит на +F. Наклон делит ход «от
  // себя»: под острым углом пиксель по вертикали покрывает больше плоскости.
  const sp = Math.max(0.25, Math.abs(Math.sin(mc.g.pitch)));
  const ax = dx * pxKm, ay = dy * pxKm / sp;
  mc.g.fx += c * ax - s * ay;
  mc.g.fz += -s * ax - c * ay;
  return mc;
}

/**
 * Дистанция, с которой предмет поперечником 2·span занимает долю frac
 * меньшей стороны кадра высотой h (пикселей) при поле зрения fov.
 */
export function distFor(span, frac, h, w = h, fov = MAPCAM.fov) {
  const focal = (h / 2) / Math.tan(fov / 2);
  const px = Math.max(1, Math.min(w, h)) * frac;
  return span * focal / px;
}
