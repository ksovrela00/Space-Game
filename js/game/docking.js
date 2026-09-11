// Стыковка со станцией: проверка условий входа в порт, столкновения
// с корпусом и докинг-компьютер (скриптованный подлёт).

import { v3, normalize, dot, clamp } from '../core/vec3.js';
import { toLocal, toWorld } from '../core/basis.js';
import { SHIP } from './ship.js';
import { aimAt, flyVelocity, levelRoll } from './pilot.js';
import { STATION_R, STATION_D, SLOT } from '../models/station.js';

export const LIMITS = {
  speed: 0.28,     // км/с — максимальная относительная скорость входа
  align: 0.86,     // косинус угла между носом и осью порта
  roll: 0.78,      // косинус рассогласования крена (по модулю)
};

const DRUM_RI = STATION_R * 0.9239;   // радиус вписанной окружности восьмигранника
const _lp = v3();
const _rel = v3();

export function stationLocal(ship, station, out = _lp) {
  return toLocal(station.basis, station.pos, ship.pos, out);
}

// Относительная скорость корабля и станции.
export function relSpeed(ship, station) {
  _rel.x = ship.vel.x - station.vel.x;
  _rel.y = ship.vel.y - station.vel.y;
  _rel.z = ship.vel.z - station.vel.z;
  return Math.hypot(_rel.x, _rel.y, _rel.z);
}

// Насколько корабль готов войти в порт (для подсказок HUD).
export function dockingQuality(ship, station) {
  const align = -dot(ship.basis.fwd, station.basis.fwd);   // нос против оси порта
  const roll = Math.abs(dot(ship.basis.right, station.basis.right));
  const speed = relSpeed(ship, station);
  const p = stationLocal(ship, station);
  return {
    align, roll, speed,
    local: { x: p.x, y: p.y, z: p.z },
    inSlot: Math.abs(p.x) < SLOT.hw && Math.abs(p.y) < SLOT.hh,
    ok: align > LIMITS.align && roll > LIMITS.roll && speed < LIMITS.speed,
  };
}

/**
 * Проверка положения корабля относительно станции.
 * @returns null | 'docked' | 'crash'
 */
export function checkStation(ship, station) {
  const p = stationLocal(ship, station);
  if (p.z > STATION_D || p.z < -STATION_D) return null;

  const rad = Math.hypot(p.x, p.y);
  if (rad > DRUM_RI) return null;              // проходим мимо, снаружи барабана

  const margin = 0.006;                        // полуразмер корабля
  const inSlot = Math.abs(p.x) < SLOT.hw - margin && Math.abs(p.y) < SLOT.hh - margin;
  if (!inSlot) return 'crash';                 // впечатались в раму или в борт

  // В створе порта: считаем стыковку состоявшейся, когда прошли раму.
  if (p.z < STATION_D - 0.03) {
    const q = dockingQuality(ship, station);
    return q.ok ? 'docked' : 'crash';
  }
  return null;
}

// --- Докинг-компьютер --------------------------------------------------------

export const DOCK_RANGE = 120;   // км — дальше компьютер не берётся
const GATE_Z = 1.2;              // км перед створом порта

export function startDockingComputer(ship, station) {
  const d = Math.hypot(
    station.pos.x - ship.pos.x,
    station.pos.y - ship.pos.y,
    station.pos.z - ship.pos.z);
  if (d > DOCK_RANGE) return { ok: false, reason: 'СТАНЦИЯ СЛИШКОМ ДАЛЕКО — АВТОПИЛОТ (J)' };
  ship.docking = { station, phase: 'gate' };
  ship.autopilot = null;
  return { ok: true };
}

export function stopDockingComputer(ship) { ship.docking = null; }

const _pt = v3();
const _vec = v3();
const stationPoint = (st, x, y, z) => toWorld(st.basis, st.pos, v3(x, y, z), _pt);

const distTo = (ship, p) =>
  Math.hypot(p.x - ship.pos.x, p.y - ship.pos.y, p.z - ship.pos.z);

// Наведение носа, полёт заданным вектором скорости и гашение крена —
// в js/game/pilot.js: тем же приёмом пользуются автопилот и посадка.

// Согласование крена с вращающейся станцией (по модулю 180°).
const matchRoll = (ship, station, k = 2.0) => {
  const tr = station.basis.right;
  let err = Math.atan2(dot(tr, ship.basis.up), dot(tr, ship.basis.right));
  if (Math.abs(err) > Math.PI / 2) err -= Math.sign(err) * Math.PI;
  // Вперёд подаём скорость вращения станции, иначе регулятор всё время
  // отстаёт от вращающегося порта.
  const feed = station.spinRate * (dot(station.basis.fwd, ship.basis.fwd) < 0 ? 1 : -1);
  ship.control.roll = clamp((-err * k + feed) / SHIP.rollRate, -1, 1);
  return Math.abs(err);
};

/**
 * Ведёт корабль в порт. Пишет в ship.control / ship.throttle.
 * @returns строка статуса для HUD
 */
export function updateDockingComputer(ship, dt) {
  const d = ship.docking;
  if (!d) return null;
  const st = d.station;
  const p = stationLocal(ship, st);
  const lateral = Math.hypot(p.x, p.y);
  const b = st.basis;

  // Мировой вектор бокового смещения от оси порта — его и гасим.
  const latX = b.right.x * p.x + b.up.x * p.y;
  const latY = b.right.y * p.x + b.up.y * p.y;
  const latZ = b.right.z * p.x + b.up.z * p.y;

  // Подход с обратной стороны: сначала обходим станцию сбоку, иначе
  // прямая на створ прошла бы сквозь корпус.
  if (d.phase !== 'enter' && p.z < 1.0) d.phase = 'skirt';
  // Промахнулись в створ — уходим на повторный круг, а не в обшивку.
  if (d.phase === 'enter' && p.z < STATION_D + 0.02 && lateral > SLOT.hw * 0.7) {
    d.phase = 'skirt';
  }

  if (d.phase === 'skirt') {
    let ux = p.x, uy = p.y;
    const l = Math.hypot(ux, uy);
    if (l < 0.05) { ux = 1; uy = 0; } else { ux /= l; uy /= l; }
    const skirt = stationPoint(st, ux * 4, uy * 4, GATE_Z * 2);
    const dist = distTo(ship, skirt);
    const off = aimAt(ship, skirt);
    levelRoll(ship);
    ship.throttle = clamp(
      (Math.min(dist / 10, off > 0.3 ? 0.25 : SHIP.maxSpeed)) / SHIP.maxSpeed, 0, 1);
    if (dist < 0.5) d.phase = 'gate';
    return `ДОКИНГ-КОМПЬЮТЕР: ОБХОД СТАНЦИИ ${dist.toFixed(1)} км`;
  }

  if (d.phase === 'gate') {
    const gate = stationPoint(st, 0, 0, GATE_Z);
    const dist = distTo(ship, gate);
    const off = aimAt(ship, gate);
    levelRoll(ship);
    ship.throttle = clamp(
      (Math.min(dist / 8, off > 0.25 ? 0.25 : SHIP.maxSpeed)) / SHIP.maxSpeed, 0, 1);
    if (dist < 0.25) d.phase = 'hold';
    return `ДОКИНГ-КОМПЬЮТЕР: ПОДХОД К СТВОРУ ${dist.toFixed(1)} км`;
  }

  if (d.phase === 'hold') {
    // Держимся на оси порта в километре от створа и подгоняем крен.
    // Требовать нос точно по оси здесь нельзя: чтобы не отставать от
    // станции, нос смотрит немного «в дрейф».
    const rollErr = matchRoll(ship, st);
    _vec.x = st.vel.x - latX * 0.35 + b.fwd.x * (GATE_Z - p.z) * 0.2;
    _vec.y = st.vel.y - latY * 0.35 + b.fwd.y * (GATE_Z - p.z) * 0.2;
    _vec.z = st.vel.z - latZ * 0.35 + b.fwd.z * (GATE_Z - p.z) * 0.2;
    flyVelocity(ship, { x: _vec.x, y: _vec.y, z: _vec.z });
    if (lateral < 0.02 && rollErr < 0.10) d.phase = 'enter';
    return `ДОКИНГ-КОМПЬЮТЕР: ВЫРАВНИВАНИЕ, снос ${(lateral * 1000).toFixed(0)} м, крен ${(rollErr * 57.3).toFixed(0)}°`;
  }

  // enter: сближение по оси со скоростью, привязанной к остатку пути,
  // плюс скорость станции и гашение бокового сноса.
  const gap = p.z - STATION_D;
  const closing = clamp(gap / 8, 0.03, 0.12);
  matchRoll(ship, st, 2.2);
  const vx = st.vel.x - b.fwd.x * closing - latX * 0.5;
  const vy = st.vel.y - b.fwd.y * closing - latY * 0.5;
  const vz = st.vel.z - b.fwd.z * closing - latZ * 0.5;
  flyVelocity(ship, { x: vx, y: vy, z: vz }, 2.0);
  return `ДОКИНГ-КОМПЬЮТЕР: ВХОД ${(Math.max(0, gap) * 1000).toFixed(0)} м, снос ${(lateral * 1000).toFixed(0)} м`;
}
