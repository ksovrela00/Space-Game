// Навигация: список целей, выбор цели, дистанции и ETA.
//
// Автопилота здесь больше нет: перелёты делает квантовый привод
// (js/game/quantum.js), и «долететь самому на маршевых» больше не
// сценарий, а способ потратить час.
//
// Список целей СОБИРАЕТСЯ ЗАНОВО каждый кадр, потому что орбитальные
// маркеры показываются только у того тела, рядом с которым корабль
// сейчас находится. Маркеров шесть на тело и тел десять: держи их в
// списке всегда — перебор клавишей Tab превратится в пытку, а нужны
// они ровно там, где стоишь.

import { v3, normalize, dot, clamp } from '../core/vec3.js';
import { nearestBody } from './world.js';

export function makeNav(world) {
  const nav = { list: [], index: 0 };
  refreshNav(nav, world, null);
  const home = world.home && world.home.station ? nav.list.indexOf(world.home.station) : 0;
  nav.index = Math.max(0, home);
  return nav;
}

/**
 * Пересобрать список целей.
 * @param ship нужен, чтобы понять, чьи маркеры показывать (null — ничьи)
 */
export function refreshNav(nav, world, ship) {
  const prev = nav.list[nav.index] || null;
  const local = ship ? nearestBody(world, ship.pos).body : null;
  nav.list.length = 0;
  for (const b of world.bodies) {
    nav.list.push(b);
    if (b === local && b.markers) for (const m of b.markers) nav.list.push(m);
    if (b.station) nav.list.push(b.station);
  }
  let i = nav.list.indexOf(prev);
  // Цель могла выпасть из списка: улетели от планеты, и её маркеры
  // скрылись. Тогда держимся за само тело, а не сбрасываем выбор.
  if (i < 0 && prev && prev.isMarker) i = nav.list.indexOf(prev.body);
  if (i < 0) i = Math.min(nav.index, nav.list.length - 1);
  nav.index = Math.max(0, i);
  return nav.list;
}

export const currentTarget = (nav) => nav.list[nav.index] || null;

export function cycleTarget(nav, dir) {
  const n = nav.list.length;
  if (!n) return null;
  nav.index = ((nav.index + dir) % n + n) % n;
  return currentTarget(nav);
}

/** Найти цель по идентификатору — для восстановления из сохранения. */
export function targetById(world, id) {
  if (id === null || id === undefined) return null;
  for (const b of world.bodies) if (b.id === id) return b;
  for (const s of world.stations) if (s.id === id) return s;
  for (const m of world.markers) if (m.id === id) return m;
  return null;
}

export function targetLabel(t) {
  if (!t) return '—';
  if (t.isStation) return t.name;
  if (t.isMarker) return t.name;
  if (t.kind === 'star') return t.name + ' (звезда)';
  if (t.kind === 'moon') return t.name + ' (луна)';
  return t.name;
}

// Дистанция до поверхности/габарита цели и оценка времени подлёта.
export function navInfo(ship, target) {
  if (!target) return null;
  const dx = target.pos.x - ship.pos.x;
  const dy = target.pos.y - ship.pos.y;
  const dz = target.pos.z - ship.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  const gap = Math.max(0, dist - target.radius);
  const dir = normalize(v3(dx, dy, dz));
  // Сближение считается по ВЕКТОРУ скорости: с инерцией корабль может
  // лететь не туда, куда смотрит нос, и проекция на нос врала бы.
  const closing = ship.vel.x * dir.x + ship.vel.y * dir.y + ship.vel.z * dir.z;
  const eta = closing > 0.001 ? gap / closing : Infinity;
  return { dist, gap, dir, closing, eta, offAxis: Math.acos(clamp(dot(dir, ship.basis.fwd), -1, 1)) };
}
