// Навигация: выбор цели, дистанции/ETA и автопилот-перелёт.

import { v3, set, normalize, dot, clamp } from '../core/vec3.js';
import { aimAngles } from '../core/basis.js';
import { LEVELS } from './cruise.js';
import { SHIP } from './ship.js';

const _detour = v3();

export function makeNav(world) {
  const list = [];
  for (const b of world.bodies) {
    list.push(b);
    if (b.station) list.push(b.station);
  }
  const home = world.home && world.home.station ? list.indexOf(world.home.station) : 0;
  return { list, index: Math.max(0, home) };
}

export const currentTarget = (nav) => nav.list[nav.index] || null;

export function cycleTarget(nav, dir) {
  const n = nav.list.length;
  nav.index = ((nav.index + dir) % n + n) % n;
  return currentTarget(nav);
}

export function targetLabel(t) {
  if (!t) return '—';
  if (t.isStation) return t.name;
  if (t.kind === 'star') return t.name + ' (звезда)';
  if (t.kind === 'moon') return t.name + ' (луна)';
  return t.name;
}

// Дистанция до поверхности/габарита цели и оценка времени подлёта.
export function navInfo(ship, target, cruiseLevel) {
  if (!target) return null;
  const dx = target.pos.x - ship.pos.x;
  const dy = target.pos.y - ship.pos.y;
  const dz = target.pos.z - ship.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  const gap = Math.max(0, dist - target.radius);
  const dir = normalize(v3(dx, dy, dz));
  const closing = ship.speed * cruiseLevel * dot(dir, ship.basis.fwd);
  const eta = closing > 0.001 ? gap / closing : Infinity;
  return { dist, gap, dir, closing, eta, offAxis: Math.acos(clamp(dot(dir, ship.basis.fwd), -1, 1)) };
}

/**
 * Точка, к которой ведёт автопилот.
 *
 * Станция висит на низкой орбите своей планеты, то есть внутри той зоны,
 * которую автопилот обходит. Поэтому подход к станции разбит на два плеча:
 *   1) «парковка» — точка на линии планета→станция, но снаружи защитной
 *      сферы планеты; до неё летим с обходом препятствий;
 *   2) «финал» — створ порта в 12 км от станции; на этом плече планета уже
 *      не обходится, но путь идёт строго по радиусу и её не пересекает.
 */
export function approachPoint(target, out = v3(), finalLeg = true) {
  if (target.isStation) {
    const radial = target.basis.fwd;         // наружу от планеты
    let d = 12;
    if (!finalLeg && target.parent) {
      const par = target.parent;
      const fromCenter = Math.hypot(
        target.pos.x - par.pos.x,
        target.pos.y - par.pos.y,
        target.pos.z - par.pos.z);
      d = Math.max(12, par.radius * 1.7 + 100 - fromCenter);
    }
    out.x = target.pos.x + radial.x * d;
    out.y = target.pos.y + radial.y * d;
    out.z = target.pos.z + radial.z * d;
    return out;
  }
  // Тела обходим сверху, чтобы не влететь в них на подлёте.
  const r = target.radius * 1.8 + 40;
  out.x = target.pos.x;
  out.y = target.pos.y + r;
  out.z = target.pos.z;
  return out;
}

/**
 * Обход тел на курсе. Прямая на цель может проходить сквозь планету —
 * в первую очередь сквозь свою же при отлёте от станции.
 *
 * Вокруг тела строится защитная сфера. Если направление на цель входит
 * в конус этой сферы, курс отклоняется ровно до касательной к сфере
 * (в сторону, ближнюю к цели). Вдоль касательной корабль гарантированно
 * обходит тело и не попадает в mass lock. Если корабль уже внутри
 * защитной сферы — сначала уходим наружу.
 *
 * Важно выбрать САМОЕ БЛИЗКОЕ мешающее тело: если брать первое подходящее
 * из списка, далёкая звезда перебивает планету под носом, и корабль идёт
 * почти прямым курсом сквозь её зону mass lock.
 */
export function avoidBodies(world, from, dir, distToTarget, goal = null, out = v3()) {
  let best = null, bestD = Infinity, bestInside = false;

  for (const b of world.bodies) {
    const cx = b.pos.x - from.x, cy = b.pos.y - from.y, cz = b.pos.z - from.z;
    const d = Math.hypot(cx, cy, cz);
    if (d < 1e-6) continue;
    const safe = b.radius * 1.7 + 40;

    // Если точка назначения сама лежит внутри защитной сферы (станция
    // висит на низкой орбите своей планеты), обходить эту сферу нельзя:
    // условие никогда не выполнится и автопилот встанет в клинч.
    if (goal) {
      const gx = goal.x - b.pos.x, gy = goal.y - b.pos.y, gz = goal.z - b.pos.z;
      if (gx * gx + gy * gy + gz * gz < safe * safe) continue;
    }

    const inside = d < safe;
    if (!inside) {
      const along = cx * dir.x + cy * dir.y + cz * dir.z;
      if (along <= 0) continue;                       // тело позади
      if (along - safe > distToTarget) continue;      // тело дальше цели
      const cosT = along / d;
      const sinA = safe / d;
      if (cosT <= Math.sqrt(Math.max(0, 1 - sinA * sinA))) continue;   // мимо
    }
    // Внутри сферы — безусловный приоритет; иначе побеждает ближайшее.
    if ((inside && !bestInside) || ((inside === bestInside) && d < bestD)) {
      best = { b, d, cx, cy, cz, safe, inside };
      bestD = d;
      bestInside = inside;
    }
  }

  if (!best) return null;

  const { d, cx, cy, cz, safe, inside } = best;
  const ux = cx / d, uy = cy / d, uz = cz / d;

  // Радиальный уход наружу, если мы внутри защитной сферы.
  if (inside) {
    return normalize(set(out,
      -ux + dir.x * 0.5,
      -uy + dir.y * 0.5,
      -uz + dir.z * 0.5), out);
  }

  const along = cx * dir.x + cy * dir.y + cz * dir.z;
  const cosT = along / d;
  const sinA = safe / d;
  const cosA = Math.sqrt(Math.max(0, 1 - sinA * sinA));

  // Оси плоскости обхода: на тело и перпендикуляр в сторону цели.
  let px = dir.x - ux * cosT, py = dir.y - uy * cosT, pz = dir.z - uz * cosT;
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-9) {
    // Точно в лоб — уводим в произвольную перпендикулярную сторону.
    const tv = Math.abs(uy) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    px = uy * tv.z - uz * tv.y;
    py = uz * tv.x - ux * tv.z;
    pz = ux * tv.y - uy * tv.x;
    pl = Math.hypot(px, py, pz) || 1;
  }
  px /= pl; py /= pl; pz /= pl;

  return normalize(set(out,
    ux * cosA + px * sinA,
    uy * cosA + py * sinA,
    uz * cosA + pz * sinA), out);
}

export function startAutopilot(ship, target) {
  if (!target) return null;
  ship.autopilot = { target, arrived: false, finalLeg: !target.isStation, point: v3() };
  return ship.autopilot;
}

export function stopAutopilot(ship) { ship.autopilot = null; }

/**
 * Автопилот пишет в ship.control и подбирает уровень круиза.
 * Возвращает желаемый индекс круиза (или null, если не активен).
 */
export function updateAutopilot(ship, world, dt) {
  const ap = ship.autopilot;
  if (!ap) return null;
  const t = ap.target;
  const p = approachPoint(t, ap.point, ap.finalLeg);

  const dx = p.x - ship.pos.x, dy = p.y - ship.pos.y, dz = p.z - ship.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  let dir = normalize(v3(dx, dy, dz));

  // Объезд тел на курсе (в первую очередь — своей же планеты при отлёте).
  const detour = world ? avoidBodies(world, ship.pos, dir, dist, p, _detour) : null;
  ap.detour = !!detour;
  if (detour) dir = detour;

  // Довернуть нос на точку подхода.
  // Команда = заданная угловая скорость / максимальная (см. docking.js:
  // релейный P-регулятор по углу здесь уходит в автоколебания).
  const ang = aimAngles(ship.basis, dir);
  const c = ship.control;
  c.pitch = clamp(ang.pitch * 1.6 / SHIP.pitchRate, -1, 1);
  c.yaw = clamp(ang.yaw * 1.6 / SHIP.yawRate, -1, 1);
  // Гасим остаточный крен, чтобы «горизонт» не болтался.
  c.roll = clamp(-ship.rot.roll * 2 / SHIP.rollRate, -1, 1);
  c.thr = 0;

  const aligned = Math.hypot(ang.pitch, ang.yaw);
  const arriveAt = t.isStation ? 1.5 : 60;

  // Дошли до парковки — переключаемся на финальное плечо к створу порта.
  if (!ap.finalLeg && dist < 8) {
    ap.finalLeg = true;
    return 0;
  }

  if (dist < arriveAt) {
    ship.throttle = 0;
    ap.arrived = true;
    return 0;
  }

  // Экспоненциальный подход: чем ближе, тем медленнее.
  let vEff = clamp(dist / 8, 0.02, 60000);
  // Пока нос не на курсе — не разгоняемся, иначе проскочим мимо. Порог
  // мягкий: при обходе препятствия курс всё время немного меняется, и
  // жёсткое ограничение до 1.2 км/с растягивало перелёт в разы.
  if (aligned > 0.45) vEff = Math.min(vEff, SHIP.maxSpeed);
  else if (aligned > 0.10) vEff = Math.min(vEff, SHIP.maxSpeed * 100);

  // Берём минимальный уровень круиза, на котором нужная скорость достижима
  // тягой <= 1, иначе тяга упёрлась бы в потолок и подход стал бы линейным.
  let idx = LEVELS.length - 1;
  for (let i = 0; i < LEVELS.length; i++) {
    if (SHIP.maxSpeed * LEVELS[i] >= vEff) { idx = i; break; }
  }
  ship.throttle = clamp(vEff / (SHIP.maxSpeed * LEVELS[idx]), 0, 1);
  return idx;
}
