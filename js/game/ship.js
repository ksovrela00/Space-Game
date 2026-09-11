// Корабль игрока.
//
// Скорость — настоящий ВЕКТОР со своей инерцией, а тяга и подъёмные
// движки задают лишь то, куда корабль хочет лететь. Разница между
// «хочет» и «летит» гасится с ограниченным ускорением, и отсюда всё
// поведение: разворот на скорости уводит в занос, торможение требует
// расстояния, а от удара о грунт есть что отражать — раньше вектор
// назначался напрямую, и отскакивать было нечему.
//
// Полная ньютоновщина здесь всё же не нужна: поперёк носа у движков своя
// власть (SHIP.lateral), и она достаточно велика, чтобы занос ощущался,
// но не превращал каждый манёвр в задачу по баллистике. Это осознанно
// чуть казуально.

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
  accel: 0.45,        // км/с² — разгон вдоль носа
  brake: 0.75,        // торможение вдоль носа
  // Власть движков ПОПЕРЁК носа: ею гасится занос после разворота.
  // Меньше — дольше несёт боком; больше — инерции не чувствуется вовсе.
  lateral: 0.5,       // км/с²
  // После удара о грунт корабль на это время теряет управление и летит
  // свободно — только тяготение и то, что осталось от скорости. Без
  // паузы отскока не видно: стабилизация гасит его за десятую долю
  // секунды, и удар читается как мгновенная остановка.
  stunMin: 0.35,      // с — самый лёгкий удар
  stunMax: 1.4,       // с
  tumbleDamp: 0.6,    // 1/с — как быстро затухает кувырок, пока оглушены
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
  hullClear: 0.004,   // то же, когда корабль лежит на брюхе
  // Подъёмные движки (R/F) дают ТЯГУ, а не заданную скорость: с
  // настоящей гравитацией «задать вертикальную скорость» нельзя, её
  // можно только создать двигателем. Сила привязана к местной тяжести —
  // полный ход даёт втрое больше веса, то есть зависание приходится
  // примерно на треть хода на любом теле. Это сознательное упрощение:
  // иначе на луне ручка была бы неуправляемо чувствительной, а на
  // тяжёлой планете её не хватало бы.
  liftTWR: 3,         // во сколько раз полная тяга движков больше веса
  liftMin: 0.004,     // км/с² — тяга вдали от тел, где веса нет вовсе
  // Компенсатор высоты работает, пока шасси убрано: он в точности гасит
  // вес, и корабль летит, не проваливаясь. С выпущенным шасси
  // компенсатор выключается — дальше только тяга движков против
  // настоящего тяготения.
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
    stun: 0,            // сколько ещё лететь без управления после удара
    hull: SHIP.maxHull,
    dockedAt: null,
    autopilot: null,
    docking: null,
    mesh: null,
    control: { pitch: 0, yaw: 0, roll: 0, thr: 0, lift: 0 },
    // Ход подъёмных движков за прошлый кадр — нужен приборам.
    lift: 0,
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
 * @param field  тяготение под кораблём: {up, g} — местная вертикаль и
 *               ускорение свободного падения (null вне захвата тела)
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

  // Оглушение после удара: управления нет, вращение просто затухает —
  // корабль кувыркается по инерции.
  const stunned = ship.stun > 0;
  if (stunned) ship.stun = Math.max(0, ship.stun - dt);

  const r = ship.rot;
  if (stunned) {
    const k = Math.max(0, 1 - SHIP.tumbleDamp * dt);
    r.pitch *= k; r.yaw *= k; r.roll *= k;
  } else {
    r.pitch = approach(r.pitch, c.pitch * SHIP.pitchRate, SHIP.rotSharp, dt);
    r.yaw = approach(r.yaw, c.yaw * SHIP.yawRate, SHIP.rotSharp, dt);
    r.roll = approach(r.roll, c.roll * SHIP.rollRate, SHIP.rotSharp, dt);
  }
  rotateBasis(ship.basis, r.pitch * dt, r.yaw * dt, r.roll * dt);

  // Оглушённый корабль — просто тело в поле тяжести: ни тяги, ни
  // стабилизации. Именно здесь живёт отскок.
  if (stunned) {
    if (field) {
      ship.vel.x -= field.up.x * field.g * dt;
      ship.vel.y -= field.up.y * field.g * dt;
      ship.vel.z -= field.up.z * field.g * dt;
    }
    ship.speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
    ship.pos.x += ship.vel.x * moveDt;
    ship.pos.y += ship.vel.y * moveDt;
    ship.pos.z += ship.vel.z * moveDt;
    return;
  }

  // --- Двигатели, тяготение и гашение заноса.
  //
  // Никакой «заданной скорости» тут больше нет: есть ускорения, и они
  // складываются. Аркадного в модели остаётся одно — маневровые движки
  // гасят снос поперёк носа, иначе каждый разворот пришлось бы
  // отрабатывать вручную, как в орбитальном симуляторе.
  //
  // С выпущенным шасси корабль переходит в посадочную конфигурацию:
  // главные движки работают ТОЛЬКО по горизонту, а вертикаль остаётся
  // тяготению и подъёмным движкам. Иначе тяга, отрабатывая «остановись»,
  // съедала бы и падение — гравитация переставала бы чувствоваться ровно
  // там, где она и нужна.
  const f = ship.basis.fwd, u = ship.basis.up;
  const gearOut = !!(ship.gear && ship.gear.t > 0.02);
  const free = !!field && gearOut;
  const up = field ? field.up : null;
  const g = field ? field.g : 0;

  // Вертикаль (только в посадочной конфигурации) считается отдельно.
  let vUp = 0;
  if (free) {
    vUp = ship.vel.x * up.x + ship.vel.y * up.y + ship.vel.z * up.z;
    ship.vel.x -= up.x * vUp; ship.vel.y -= up.y * vUp; ship.vel.z -= up.z * vUp;
  }

  // Направление тяги: нос, а в посадочной конфигурации — его проекция на
  // горизонт. У самого зенита проекция вырождается, и тяги просто нет.
  let fx = f.x, fy = f.y, fz = f.z;
  if (free) {
    const fu = f.x * up.x + f.y * up.y + f.z * up.z;
    fx -= up.x * fu; fy -= up.y * fu; fz -= up.z * fu;
    const fl = Math.hypot(fx, fy, fz);
    if (fl > 0.08) { fx /= fl; fy /= fl; fz /= fl; } else { fx = fy = fz = 0; }
  }

  // Главные движки: разгон до скорости, заданной тягой. С выпущенным
  // шасси предел ниже — на нём не летают.
  const lim = SHIP.maxSpeed * (gearOut ? SHIP.gearSpeed : 1);
  const target = ship.throttle * lim * (ship.throttle < 0 ? SHIP.reverse : 1);
  const cur = ship.vel.x * fx + ship.vel.y * fy + ship.vel.z * fz;
  const aLim = (Math.abs(target) > Math.abs(cur) ? SHIP.accel : SHIP.brake) * dt;
  const step = clamp(target - cur, -aLim, aLim);
  ship.vel.x += fx * step;
  ship.vel.y += fy * step;
  ship.vel.z += fz * step;

  // Гашение заноса: всё, что не вдоль тяги.
  const dot0 = ship.vel.x * fx + ship.vel.y * fy + ship.vel.z * fz;
  const px = ship.vel.x - fx * dot0, py = ship.vel.y - fy * dot0, pz = ship.vel.z - fz * dot0;
  const perp = Math.hypot(px, py, pz);
  if (perp > 1e-9) {
    const k = Math.min(1, SHIP.lateral * dt / perp);
    ship.vel.x -= px * k;
    ship.vel.y -= py * k;
    ship.vel.z -= pz * k;
  }

  // Подъёмные движки: ТЯГА, а не скорость. Сила привязана к местной
  // тяжести (SHIP.liftTWR), вдали от тел — постоянная.
  const liftAcc = Math.max(SHIP.liftMin, g * SHIP.liftTWR) * c.lift;
  ship.lift = liftAcc;

  if (free) {
    // Вертикаль: подъёмные движки против веса. Компенсатора нет —
    // отпустил ход, и корабль падает.
    const lu = u.x * up.x + u.y * up.y + u.z * up.z;     // куда смотрит «верх»
    vUp += (liftAcc * lu - g) * dt;
    ship.vel.x += up.x * vUp; ship.vel.y += up.y * vUp; ship.vel.z += up.z * vUp;
  } else {
    // Шасси убрано: вес в точности гасит компенсатор высоты, и
    // подъёмные движки работают как обычная тяга вдоль «верха».
    ship.vel.x += u.x * liftAcc * dt;
    ship.vel.y += u.y * liftAcc * dt;
    ship.vel.z += u.z * liftAcc * dt;
  }

  ship.speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
  if (ship.speed < 1e-5) {
    ship.vel.x = ship.vel.y = ship.vel.z = 0;
    ship.speed = 0;
  }

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
  ship.vel.x = ship.vel.y = ship.vel.z = 0;
  ship.throttle = 0;
  ship.zeroHold = 0;
  ship.stun = 0;
  ship.lift = 0;
  ship.rot.pitch = ship.rot.yaw = ship.rot.roll = 0;
}
