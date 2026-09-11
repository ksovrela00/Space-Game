// Корабль игрока. Модель полёта аркадная, как в Elite: тяга задаёт целевую
// скорость, вектор движения совпадает с направлением носа. Полностью
// ньютоновская инерция сделала бы стыковку непроходимой на старте.

import { v3, copy, clamp, approach } from '../core/vec3.js';
import { makeBasis, rotateBasis } from '../core/basis.js';
import { input } from '../core/input.js';

export const SHIP = {
  maxSpeed: 1.2,      // км/с при круизе x1
  // Задний ход — маневровый режим, а не полёт: те же движки работают
  // против своей геометрии, и тяги у них там заметно меньше.
  reverse: 0.15,      // доля максимальной скорости на заднем ходу
  // Пауза на нуле при сбросе тяги. Без неё остановиться нельзя: тяга
  // проскакивает ноль и корабль сразу ползёт назад. С паузой ноль
  // ощущается как защёлка — задержал Ctrl дольше, поехал назад.
  zeroDwell: 0.45,    // с
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
  liftRate: 0.06,     // км/с — вертикальный ход подъёмных движков (R/F)
  liftSharp: 2.2,     // как быстро движки выходят на заданную скорость
  // Установившаяся скорость снижения с выпущенным шасси = g · sinkTime.
  // Модель полёта задаёт скорость, а не силу, поэтому и притяжение здесь
  // выражено скоростью: свободного падения с разгоном до бесконечности
  // в аркадной схеме всё равно быть не может.
  sinkTime: 3.0,      // с
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
    zeroHold: 0,        // сколько ещё держать тягу на нуле (см. SHIP.zeroDwell)
    hull: SHIP.maxHull,
    dockedAt: null,
    autopilot: null,
    docking: null,
    mesh: null,
    control: { pitch: 0, yaw: 0, roll: 0, thr: 0, lift: 0 },
    // Вертикальный канал: ход подъёмных движков и просадка под своим
    // весом (появляется с выпущенным шасси, см. updateShip).
    lift: 0,
    sink: 0,
    // Посадка: шасси (t — доля выпуска), тело, на котором стоим, и
    // посадочный компьютер.
    gear: { t: 0, out: false },
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
  c.thr = input.axis(['ControlLeft', 'ControlRight'], ['ShiftLeft', 'ShiftRight']);
  // Вертикальный ход — отдельный канал, доступный всегда: с ним можно
  // и садиться брюхом вниз, не опуская нос, и просто держать высоту над
  // поверхностью, продолжая лететь вперёд.
  c.lift = input.axis(['KeyF'], ['KeyR']);
  if (input.pressed('KeyX')) ship.throttle = 0;
  if (input.pressed('KeyZ')) ship.throttle = 1;
}

export function clearControls(ship) {
  const c = ship.control;
  c.pitch = 0; c.roll = 0; c.yaw = 0; c.thr = 0; c.lift = 0;
}

/**
 * @param dt     реальный шаг (управление, вращение, разгон)
 * @param moveDt шаг для перемещения (dt, умноженный на круиз)
 * @param field  тяготение под кораблём: {up, sink} — местная вертикаль и
 *               установившаяся скорость просадки (0, пока шасси убрано:
 *               с убранным шасси высоту держит компенсатор)
 */
export function updateShip(ship, dt, moveDt, field = null) {
  const c = ship.control;

  // Тяга от -1 (полный назад) до +1. Ноль — с защёлкой: сбрасывая тягу,
  // корабль на нём останавливается и только при дальнейшем удержании
  // Ctrl трогается назад.
  let thr = ship.throttle + c.thr * SHIP.throttleRate * dt;
  if (ship.throttle > 0 && thr <= 0) { thr = 0; ship.zeroHold = SHIP.zeroDwell; }
  else if (ship.throttle === 0 && c.thr < 0) {
    ship.zeroHold -= dt;
    if (ship.zeroHold > 0) thr = 0;
  } else if (c.thr >= 0) ship.zeroHold = 0;
  ship.throttle = clamp(thr, -1, 1);

  const r = ship.rot;
  r.pitch = approach(r.pitch, c.pitch * SHIP.pitchRate, SHIP.rotSharp, dt);
  r.yaw = approach(r.yaw, c.yaw * SHIP.yawRate, SHIP.rotSharp, dt);
  r.roll = approach(r.roll, c.roll * SHIP.rollRate, SHIP.rotSharp, dt);
  rotateBasis(ship.basis, r.pitch * dt, r.yaw * dt, r.roll * dt);

  // С выпущенным шасси скорость ограничена — на нём не летают.
  const lim = SHIP.maxSpeed * (ship.gear && ship.gear.t > 0.02 ? SHIP.gearSpeed : 1);
  const target = ship.throttle * lim * (ship.throttle < 0 ? SHIP.reverse : 1);
  const a = (target > ship.speed ? SHIP.accel : SHIP.brake) * dt;
  ship.speed += clamp(target - ship.speed, -a, a);
  if (Math.abs(ship.speed) < 1e-5) ship.speed = 0;

  // Вертикальный канал: подъёмные движки вдоль «верха» корабля плюс
  // просадка вдоль местной вертикали. Второе включается только с
  // выпущенным шасси — так гравитация чувствуется там, где она нужна
  // (на посадке), и не мешает стыковке.
  ship.lift = approach(ship.lift, SHIP.liftRate * ship.control.lift, SHIP.liftSharp, dt);
  ship.sink = approach(ship.sink, field ? field.sink : 0, SHIP.liftSharp, dt);

  const f = ship.basis.fwd, u = ship.basis.up;
  const d = field ? field.up : null;
  ship.vel.x = f.x * ship.speed + u.x * ship.lift - (d ? d.x * ship.sink : 0);
  ship.vel.y = f.y * ship.speed + u.y * ship.lift - (d ? d.y * ship.sink : 0);
  ship.vel.z = f.z * ship.speed + u.z * ship.lift - (d ? d.z * ship.sink : 0);

  ship.pos.x += ship.vel.x * moveDt;
  ship.pos.y += ship.vel.y * moveDt;
  ship.pos.z += ship.vel.z * moveDt;
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
  ship.zeroHold = 0;
  ship.lift = 0;
  ship.sink = 0;
  ship.rot.pitch = ship.rot.yaw = ship.rot.roll = 0;
}
