// Квантовый привод: перелёт между телами системы.
//
// Это РЕЖИМ, а не множитель. Пока привод работает, корабль идёт по
// рельсам: своей физики у него нет, скорость задаётся профилем, а
// столкновения не проверяются вовсе — вместо них перед стартом
// проверяется коридор. Так убирается класс проблем, который был у
// ступенчатого круиза: за кадр на 60 000 км/с корабль проходит тысячу
// километров, и никакая проверка касания на таком шаге не работает.
//
// Прыжок состоит из трёх частей:
//   * калибровка — держать цель на прицеле QUANTUM.spool секунд;
//   * разгон и ход — профиль по времени, см. updateQuantum;
//   * выход — в QUANTUM.exitAlt над поверхностью цели, со скоростью
//     ноль ОТНОСИТЕЛЬНО неё.
//
// Короткий прыжок укорачивает себя сам: на 40 000 км корабль просто не
// успевает разогнаться до потолка, и всё занимает секунды. Отдельного
// правила для ближних целей не нужно.

import { v3, normalize } from '../core/vec3.js';
import { lookAlong, aimAngles } from '../core/basis.js';
import { bodyPosAt } from './world.js';

export const QUANTUM = {
  // Скорость — характеристика КОРАБЛЯ (ship.quantumSpeed), здесь только
  // значение по умолчанию для тех, у кого её нет.
  speed: 60000,       // км/с
  rampIn: 2,          // с — разгон с нуля до потолка
  rampOut: 5,         // с — торможение с потолка до нуля
  spool: 3,           // с — калибровка
  align: 3 * Math.PI / 180,   // допуск по прицелу, рад
  // Сбил прицел — прогресс не обнуляется, а тает: иначе случайное
  // касание ручки в конце калибровки означало бы начать сначала.
  fade: 0.5,          // доля прогресса, теряемая за секунду
  exitAlt: 250,       // км над поверхностью тела
  // У больших тел 250 км — это впритык к оболочке рельефа, и выход
  // оказывался бы внутри собственного запаса. Поэтому у крупных берётся
  // доля радиуса: над светилом это 3100 км, над газовым гигантом 410.
  exitFrac: 0.05,
  exitStation: 40,    // км до станции
  exitMin: 2,         // км — остаток до точки в пустоте
  // Оболочка рельефа: самый рваный тип поверхности поднимается на 1.7%
  // радиуса (js/gl/terrain.js), поэтому запас взят с небольшим походом.
  relief: 0.02,
  clearPad: 10,       // км — чтобы у мелких лун запас не выродился
  // На сколько кусков режется трасса при проверке коридора. Внутри
  // куска тело считается неподвижным, а расстояние до отрезка —
  // аналитически. Точками трассу проверять НЕЛЬЗЯ: на перелёте в
  // полтора миллиона километров даже полсотни точек стоят в 30 000 км
  // друг от друга, и планета целиком проваливается между ними.
  segs: 12,
  minSpeed: 1.2,      // км/с — ниже этого привод выключается
};

export const makeQuantum = () => ({
  phase: 'idle',      // idle | calib | jump
  target: null,
  calib: 0,           // 0..1 — готовность привода
  speed: 0,           // текущая скорость прыжка, км/с
  dist: 0,            // остаток до точки выхода, км
  aligned: false,
  block: null,        // тело, перекрывающее коридор
  reason: '',         // почему прыжок невозможен или чем кончился
  flash: 0,           // 0..1 — вспышка входа и выхода, для эффектов
  punch: 0,           // 0..1 — удар по полю зрения в момент разгона
  // Фаза потока частиц вокруг корабля, 0..1. Копится ЗДЕСЬ, а не в
  // сцене: иначе картинка зависела бы от частоты кадров, а при смене
  // скорости потока фаза прыгала бы назад.
  warp: 0,
});

export const quantumSpeed = (ship) => (ship && ship.quantumSpeed) || QUANTUM.speed;

/** Запас, с которым коридор обязан обходить тело. */
export const clearOf = (b) => b.radius * (1 + QUANTUM.relief) + QUANTUM.clearPad;

/** Точка выхода: не сама цель, а подступ к ней с той стороны, откуда идём. */
export function exitPoint(target, from, out = v3()) {
  const gap = target.isStation ? QUANTUM.exitStation
    : (target.isMarker ? QUANTUM.exitMin
      : target.radius + Math.max(QUANTUM.exitAlt, target.radius * QUANTUM.exitFrac));
  const dx = from.x - target.pos.x, dy = from.y - target.pos.y, dz = from.z - target.pos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) {
    out.x = target.pos.x + gap; out.y = target.pos.y; out.z = target.pos.z;
    return out;
  }
  const k = gap / d;
  out.x = target.pos.x + dx * k;
  out.y = target.pos.y + dy * k;
  out.z = target.pos.z + dz * k;
  return out;
}

/**
 * Сколько продлится прыжок на дистанцию dist: разгон, ход, торможение.
 * Если до потолка разогнаться не успеваем, профиль треугольный — именно
 * поэтому ближний прыжок получается коротким сам собой.
 */
export function jumpTime(dist, vTop) {
  const aIn = vTop / QUANTUM.rampIn, aOut = vTop / QUANTUM.rampOut;
  const peak = Math.sqrt(2 * dist / (1 / aIn + 1 / aOut));
  if (peak < vTop) return peak / aIn + peak / aOut;
  const dRamp = vTop * vTop * 0.5 * (1 / aIn + 1 / aOut);
  return QUANTUM.rampIn + QUANTUM.rampOut + (dist - dRamp) / vTop;
}

const _p = v3();
const _bp = v3();

/**
 * Помеха на трассе. Проверяется ОДИН РАЗ, на входе в прыжок, но с
 * учётом движения тел: орбиты аналитические, положение на любой момент
 * считается даром, а греть процессор каждый кадр незачем.
 *
 * @returns тело-помеха или null
 */
export function corridorBlock(world, from, target, vTop = QUANTUM.speed) {
  exitPoint(target, from, _p);
  const dx = _p.x - from.x, dy = _p.y - from.y, dz = _p.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return null;
  const total = jumpTime(dist, vTop);

  for (const b of world.bodies) {
    const clear = clearOf(b);
    // Особый случай: корабль СТОИТ на теле или висит над ним, то есть уже
    // внутри его запаса. Запрещать прыжок целиком нельзя — с поверхности
    // тогда не улететь вовсе. Значит, требование другое: расстояние до
    // тела не должно уменьшаться. Курс выше местного горизонта проходит,
    // курс в грунт — нет.
    const d0 = Math.hypot(from.x - b.pos.x, from.y - b.pos.y, from.z - b.pos.z);
    const inside = d0 < clear;
    // Точка выхода внутри запаса означает, что мы к этому телу и летим:
    // тогда оно себе не помеха.
    const near = Math.hypot(_p.x - b.pos.x, _p.y - b.pos.y, _p.z - b.pos.z) < clear;
    if (inside && near) continue;
    const limit = inside ? d0 * 0.999 : clear;

    for (let i = 0; i < QUANTUM.segs; i++) {
      const s0 = i / QUANTUM.segs, s1 = (i + 1) / QUANTUM.segs;
      // Время по пути считается линейно: тела за прыжок проходят сотни
      // километров при запасе в тысячи, точнее не нужно.
      bodyPosAt(b, world.time + total * (s0 + s1) * 0.5, _bp);
      if (segDist(from, dx, dy, dz, s0, s1, _bp) < limit) return b;
    }
  }
  return null;
}

/** Ближайшее расстояние от точки p до куска трассы [s0, s1]. */
function segDist(from, dx, dy, dz, s0, s1, p) {
  const ax = from.x + dx * s0, ay = from.y + dy * s0, az = from.z + dz * s0;
  const ex = dx * (s1 - s0), ey = dy * (s1 - s0), ez = dz * (s1 - s0);
  const len2 = ex * ex + ey * ey + ez * ez;
  let t = 0;
  if (len2 > 1e-12) {
    t = ((p.x - ax) * ex + (p.y - ay) * ey + (p.z - az) * ez) / len2;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
  }
  return Math.hypot(ax + ex * t - p.x, ay + ey * t - p.y, az + ez * t - p.z);
}

/** Можно ли прыгать: есть цель, корабль в полёте, коридор чист. */
export function canJump(world, ship, target) {
  if (!target) return { ok: false, reason: 'ЦЕЛЬ НЕ ВЫБРАНА' };
  if (ship.landedAt || ship.dockedAt) return { ok: false, reason: 'ПРИВОД НЕ РАБОТАЕТ НА СТОЯНКЕ' };
  const block = corridorBlock(world, ship.pos, target, quantumSpeed(ship));
  if (block) return { ok: false, reason: 'КОРИДОР ПЕРЕКРЫТ: ' + block.name, block };
  return { ok: true };
}

/**
 * Через какую точку прыгать, если прямой коридор перекрыт.
 *
 * Без этого механика маркеров нерабочая: игрок видит «перекрыто» и
 * должен сам догадаться, какая из шести точек над планетой открыта, —
 * а сверху их не различить. Поэтому привод считает это сам: берётся
 * маркер, до которого можно дойти прямо сейчас, и из которого цель уже
 * открывается. Если такого нет — просто ближайший к направлению на
 * цель, следующий шаг подскажется снова.
 *
 * @returns маркер или null, если не поможет ничто
 */
export function suggestHop(world, ship, target, vTop = QUANTUM.speed) {
  if (!target) return null;
  const tx = target.pos.x - ship.pos.x;
  const ty = target.pos.y - ship.pos.y;
  const tz = target.pos.z - ship.pos.z;
  const tl = Math.hypot(tx, ty, tz) || 1;
  let best = null, bestScore = -Infinity;

  for (const b of world.bodies) {
    if (!b.markers) continue;
    for (const m of b.markers) {
      if (m === target) continue;
      if (corridorBlock(world, ship.pos, m, vTop)) continue;
      const mx = m.pos.x - ship.pos.x, my = m.pos.y - ship.pos.y, mz = m.pos.z - ship.pos.z;
      const ml = Math.hypot(mx, my, mz);
      if (ml < 1e-6) continue;
      const along = (mx * tx + my * ty + mz * tz) / (ml * tl);   // −1..1
      const open = corridorBlock(world, m.pos, target, vTop) ? 0 : 1;
      // Открывающий ход важнее направления: он заканчивает маршрут.
      const score = open * 10 + along;
      if (score > bestScore) { bestScore = score; best = m; }
    }
  }
  return best;
}

/** Насколько нос отклонён от точки выхода, рад. */
export function offAxis(ship, target) {
  exitPoint(target, ship.pos, _p);
  const ang = aimAngles(ship.basis, normalize(v3(
    _p.x - ship.pos.x, _p.y - ship.pos.y, _p.z - ship.pos.z)));
  return Math.hypot(ang.pitch, ang.yaw);
}

export function startCalibration(q, target) {
  q.phase = 'calib';
  q.target = target;
  q.calib = 0;
  q.speed = 0;
  q.block = null;
  q.reason = '';
}

export function stopQuantum(q, reason = '') {
  const was = q.phase;
  q.phase = 'idle';
  q.target = null;
  q.calib = 0;
  q.speed = 0;
  q.dist = 0;
  q.reason = reason;
  if (was === 'jump') q.flash = 1;
  return was;
}

const _exit = v3();
const _dir = v3();

/**
 * Шаг привода. Возвращает событие для главного цикла:
 * null | 'engage' | 'arrive' | 'abort'.
 *
 * Во время прыжка корабль ведёт именно этот код: положение, ориентацию
 * и скорость. updateShip в это время не вызывается вовсе.
 */
export function updateQuantum(q, ship, world, dt) {
  if (q.flash > 0) q.flash = Math.max(0, q.flash - dt * 1.6);
  if (q.punch > 0) q.punch = Math.max(0, q.punch - dt * 2.2);
  if (q.phase === 'idle') return null;

  const t = q.target;
  if (!t) { stopQuantum(q); return 'abort'; }

  if (q.phase === 'calib') {
    q.aligned = offAxis(ship, t) <= QUANTUM.align;
    if (q.aligned) q.calib = Math.min(1, q.calib + dt / QUANTUM.spool);
    else q.calib = Math.max(0, q.calib - dt * QUANTUM.fade);
    if (q.calib >= 1) {
      const res = canJump(world, ship, t);
      if (!res.ok) {
        const block = res.block || null;
        stopQuantum(q, res.reason);
        q.block = block;
        return 'abort';
      }
      q.phase = 'jump';
      q.speed = QUANTUM.minSpeed;
      q.flash = 1;
      q.punch = 1;
      return 'engage';
    }
    return null;
  }

  // --- ход
  exitPoint(t, ship.pos, _exit);
  const dx = _exit.x - ship.pos.x, dy = _exit.y - ship.pos.y, dz = _exit.z - ship.pos.z;
  const rem = Math.hypot(dx, dy, dz);
  q.dist = rem;
  if (rem < 1e-9) { arrive(q, ship); return 'arrive'; }
  _dir.x = dx / rem; _dir.y = dy / rem; _dir.z = dz / rem;

  const vTop = quantumSpeed(ship);
  const aIn = vTop / QUANTUM.rampIn, aOut = vTop / QUANTUM.rampOut;
  // Торможение считается кинематически (v = √(2·a·s)), а не как
  // затухание «доля от остатка»: затухание до точки не доходит никогда,
  // а так корабль встаёт ровно там, где надо, и ровно за rampOut.
  q.speed = Math.min(vTop, q.speed + aIn * dt, Math.sqrt(2 * aOut * rem));

  const stepLen = q.speed * dt;
  if (stepLen >= rem) {
    ship.pos.x = _exit.x; ship.pos.y = _exit.y; ship.pos.z = _exit.z;
    arrive(q, ship);
    return 'arrive';
  }
  ship.pos.x += _dir.x * stepLen;
  ship.pos.y += _dir.y * stepLen;
  ship.pos.z += _dir.z * stepLen;
  lookAlong(ship.basis, _dir, ship.basis.up);
  // Поток частиц: у точки схода они еле ползут, у края кадра летят.
  // Частота обновления привязана к скорости, но не падает в ноль на
  // торможении — иначе поток замирает раньше, чем гаснет тоннель.
  q.warp = (q.warp + dt * (0.22 + 0.75 * (q.speed / vTop))) % 1;

  // Приборы и звук смотрят на ship.vel — пусть видят настоящий ход.
  ship.vel.x = _dir.x * q.speed;
  ship.vel.y = _dir.y * q.speed;
  ship.vel.z = _dir.z * q.speed;
  ship.speed = q.speed;
  return null;
}

/**
 * Выход. Скорость — ноль ОТНОСИТЕЛЬНО цели.
 *
 * Внутри захвата корабль и так переносится вместе с телом, поэтому для
 * тела и его маркеров это буквально ноль. А вот станция крутится вокруг
 * своей планеты сама, и выйти рядом с ней в нуле значит смотреть, как
 * она уезжает на четырёх километрах в секунду.
 */
function arrive(q, ship) {
  const t = q.target;
  const tv = t.isMarker ? t.body.vel : t.vel;
  const own = t.isMarker ? t.body : (t.isStation ? t.parent : t);
  const cx = own && own.vel ? own.vel.x : 0;
  const cy = own && own.vel ? own.vel.y : 0;
  const cz = own && own.vel ? own.vel.z : 0;
  ship.vel.x = tv ? tv.x - cx : 0;
  ship.vel.y = tv ? tv.y - cy : 0;
  ship.vel.z = tv ? tv.z - cz : 0;
  ship.speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
  ship.throttle = 0;
  stopQuantum(q);
  q.flash = 1;
}
