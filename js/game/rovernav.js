// Навигация вездехода: курс, наклон кузова и куда ехать к своему кораблю.
//
// Читают её двое — мониторы поста водителя (js/ui/panels.js) и приборы
// от третьего лица (js/ui/hud.js). Две копии одного расчёта разъехались бы
// так же, как разъезжаются две копии палитры (js/ui/theme.js), и в кабине
// курс был бы один, а за спиной машины — другой.
//
// Всё — в осях тела, на котором стоит машина (js/game/rover.js: lp, lb):
// север — его ось вращения (y осей тела, js/game/world.js, bodyBasis),
// положенная на грунт.

import { bodyLocal } from './vessels.js';

const DEG = 180 / Math.PI;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** «Вверх», «на север» и «на восток» у точки lp (оси тела). */
export function roverFrame(lp) {
  const l = Math.hypot(lp.x, lp.y, lp.z) || 1;
  const up = { x: lp.x / l, y: lp.y / l, z: lp.z / l };
  // У самого полюса оси на грунте нет — север там любая ось поперёк.
  let n = { x: -up.y * up.x, y: 1 - up.y * up.y, z: -up.y * up.z };
  let nl = Math.hypot(n.x, n.y, n.z);
  if (nl < 1e-6) { n = { x: 0, y: 0, z: 1 }; nl = 1; }
  n = { x: n.x / nl, y: n.y / nl, z: n.z / nl };
  const e = { x: n.y * up.z - n.z * up.y, y: n.z * up.x - n.x * up.z, z: n.x * up.y - n.y * up.x };
  return { up, n, e };
}

/** Курс направления d (оси тела) в рамке F: градусы от севера по часовой, 0..360. */
export function bearingOf(F, d) {
  const a = Math.atan2(d.x * F.e.x + d.y * F.e.y + d.z * F.e.z, d.x * F.n.x + d.y * F.n.y + d.z * F.n.z) * DEG;
  return (a + 360) % 360;
}

/** Курс машины, градусы. */
export const roverHeading = (rv) => bearingOf(roverFrame(rv.lp), rv.lb.fwd);

/** Наклон кузова от отвеса: тангаж (нос вверх — плюс) и крен (правым бортом вниз — плюс), градусы. */
export function roverTilt(rv) {
  const l = Math.hypot(rv.lp.x, rv.lp.y, rv.lp.z) || 1;
  const u = { x: rv.lp.x / l, y: rv.lp.y / l, z: rv.lp.z / l };
  const b = rv.lb;
  return {
    pitch: Math.asin(clamp(b.fwd.x * u.x + b.fwd.y * u.y + b.fwd.z * u.z, -1, 1)) * DEG,
    roll: -Math.asin(clamp(b.right.x * u.x + b.right.y * u.y + b.right.z * u.z, -1, 1)) * DEG,
  };
}

/** Широта и долгота точки lp (оси тела), градусы. */
export function latLon(lp) {
  const l = Math.hypot(lp.x, lp.y, lp.z) || 1;
  return { lat: Math.asin(clamp(lp.y / l, -1, 1)) * DEG, lon: Math.atan2(lp.x, lp.z) * DEG };
}

/**
 * Свой корабль — носитель вездехода (game.roverHome, js/main.js): где он в
 * осях тела, сколько до него (км, по хорде — на этих дальностях то же, что
 * по грунту), его курс от машины и на сколько к нему повернуть (градусы,
 * плюс — вправо). Носителя не видно — null.
 */
export function roverHomeInfo(game) {
  const rv = game.rover, body = rv && rv.body;
  const home = body && game.roverHome ? game.roverHome() : null;
  if (!home) return null;
  const l = bodyLocal(body, home.pos);
  const d = { x: l.x - rv.lp.x, y: l.y - rv.lp.y, z: l.z - rv.lp.z };
  const F = roverFrame(rv.lp);
  const bearing = bearingOf(F, d);
  const head = bearingOf(F, rv.lb.fwd);
  return {
    vessel: home.vessel || null, name: home.name || '', l,
    dist: Math.hypot(d.x, d.y, d.z), bearing, turn: ((bearing - head + 540) % 360) - 180,
  };
}
