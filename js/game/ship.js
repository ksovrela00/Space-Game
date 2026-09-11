// Корабль игрока. Модель полёта аркадная, как в Elite: тяга задаёт целевую
// скорость, вектор движения совпадает с направлением носа. Полностью
// ньютоновская инерция сделала бы стыковку непроходимой на старте.

import { v3, copy, clamp, approach } from '../core/vec3.js';
import { makeBasis, rotateBasis } from '../core/basis.js';
import { input } from '../core/input.js';

export const SHIP = {
  maxSpeed: 1.2,      // км/с при круизе x1
  accel: 0.45,        // км/с²
  brake: 0.75,
  pitchRate: 0.85,    // рад/с
  yawRate: 0.55,
  rollRate: 1.9,
  rotSharp: 7.0,      // скорость выхода на заданную угловую скорость
  throttleRate: 0.7,  // единиц тяги в секунду
  maxHull: 100,

  // Посадочное оборудование
  gearTime: 2.4,      // секунды на выпуск или уборку шасси
  gearSpeed: 0.35,    // доля максимальной скорости с выпущенным шасси
  gearClear: 0.010,   // высота центра корабля над грунтом на шасси, км
  hoverSpeed: 0.09,   // км/с — горизонтальный ход на посадочных движках
  vtolRate: 0.06,     // км/с — вертикальный ход
  vtolSharp: 2.2,     // как быстро посадочные движки выходят на заданную
};

export function makeShip() {
  const s = {
    pos: v3(),
    basis: makeBasis(),
    vel: v3(),          // мировая скорость (км/с, без множителя круиза)
    speed: 0,
    throttle: 0,
    cruise: 1,          // множитель круизного ускорителя
    rot: { pitch: 0, yaw: 0, roll: 0 },
    hull: SHIP.maxHull,
    dockedAt: null,
    autopilot: null,
    docking: null,
    mesh: null,
    control: { pitch: 0, yaw: 0, roll: 0, thr: 0, lift: 0 },
    // Посадка: шасси (t — доля выпуска), посадочный режим с векторной
    // тягой, тело, на котором стоим, и посадочный компьютер.
    gear: { t: 0, out: false },
    vtol: null,
    landedAt: null,
    landing: null,
  };
  return s;
}

// Ручное управление -> control. Автопилот пишет в те же поля.
export function readControls(ship) {
  const c = ship.control;
  c.pitch = input.axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
  // Буквы — схема WASD: A/D рыскают, Q/E кренят.
  // Стрелки — классическая схема Elite: тангаж и крен.
  c.roll = input.axis(['KeyQ', 'ArrowLeft'], ['KeyE', 'ArrowRight']);
  c.yaw = input.axis(['KeyA'], ['KeyD']);
  // В посадочном режиме Shift/Ctrl управляют не тягой, а вертикальным
  // ходом посадочных движков: тяга там задаёт только горизонтальный ход.
  if (ship.vtol) {
    c.lift = input.axis(['ControlLeft', 'ControlRight'], ['ShiftLeft', 'ShiftRight']);
    c.thr = 0;
  } else {
    c.thr = input.axis(['ControlLeft', 'ControlRight'], ['ShiftLeft', 'ShiftRight']);
  }
  if (input.pressed('KeyX')) ship.throttle = 0;
  if (input.pressed('KeyF')) ship.throttle = 1;
}

export function clearControls(ship) {
  const c = ship.control;
  c.pitch = 0; c.roll = 0; c.yaw = 0; c.thr = 0; c.lift = 0;
}

/**
 * @param dt     реальный шаг (управление, вращение, разгон)
 * @param moveDt шаг для перемещения (dt, умноженный на круиз)
 */
export function updateShip(ship, dt, moveDt) {
  const c = ship.control;

  ship.throttle = clamp(ship.throttle + c.thr * SHIP.throttleRate * dt, 0, 1);

  const r = ship.rot;
  r.pitch = approach(r.pitch, c.pitch * SHIP.pitchRate, SHIP.rotSharp, dt);
  r.yaw = approach(r.yaw, c.yaw * SHIP.yawRate, SHIP.rotSharp, dt);
  r.roll = approach(r.roll, c.roll * SHIP.rollRate, SHIP.rotSharp, dt);
  rotateBasis(ship.basis, r.pitch * dt, r.yaw * dt, r.roll * dt);

  // Посадочный режим: перемещение задаётся ВЕКТОРОМ (посадочные движки),
  // а не направлением носа — иначе сесть брюхом вниз невозможно, корабль
  // умеет двигаться только туда, куда смотрит. Круиз в этом режиме всегда
  // x1, поэтому шаг перемещения — реальный dt.
  if (ship.vtol) {
    ship.vel.x = ship.vtol.x;
    ship.vel.y = ship.vtol.y;
    ship.vel.z = ship.vtol.z;
    ship.speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
    ship.pos.x += ship.vel.x * dt;
    ship.pos.y += ship.vel.y * dt;
    ship.pos.z += ship.vel.z * dt;
    return;
  }

  // С выпущенным шасси скорость ограничена — на нём не летают.
  const target = ship.throttle * SHIP.maxSpeed *
    (ship.gear && ship.gear.t > 0.02 ? SHIP.gearSpeed : 1);
  const a = (target > ship.speed ? SHIP.accel : SHIP.brake) * dt;
  ship.speed += clamp(target - ship.speed, -a, a);
  if (ship.speed < 1e-5) ship.speed = 0;

  const f = ship.basis.fwd;
  ship.vel.x = f.x * ship.speed;
  ship.vel.y = f.y * ship.speed;
  ship.vel.z = f.z * ship.speed;

  ship.pos.x += f.x * ship.speed * moveDt;
  ship.pos.y += f.y * ship.speed * moveDt;
  ship.pos.z += f.z * ship.speed * moveDt;
}

// Мгновенно поставить корабль в точку с заданной ориентацией.
export function placeShip(ship, pos, basis) {
  copy(ship.pos, pos);
  if (basis) {
    copy(ship.basis.right, basis.right);
    copy(ship.basis.up, basis.up);
    copy(ship.basis.fwd, basis.fwd);
  }
  ship.speed = 0;
  ship.throttle = 0;
  ship.rot.pitch = ship.rot.yaw = ship.rot.roll = 0;
}
