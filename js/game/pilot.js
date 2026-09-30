// Общие приёмы наведения для автоматики: докинг-компьютера и
// посадочного компьютера.
//
// Главное правило: команда — это ЗАДАННАЯ УГЛОВАЯ СКОРОСТЬ, делённая на
// максимальную. Прямой P-регулятор по углу с большим коэффициентом
// вырождается в релейное управление и уводит нос в автоколебания на
// десятки градусов — это уже было и лечилось именно так.

import { v3, normalize, dot, clamp, cross, rotateAxis } from '../core/vec3.js';
import { makeBasis, aimAngles } from '../core/basis.js';
import { SHIP } from './ship.js';

const _vec = v3();
const _t = makeBasis();
const _w = v3();
const _axis = v3();
const _f1 = v3();
const _tmp = v3();

/**
 * Команда ручки по угловой ошибке a (рад): заданная угловая скорость в
 * долях предельной.
 *
 * Скорость — наименьшая из трёх: предельная, та, с которой корабль ещё
 * успевает затормозить к цели (кривая торможения √(2εa), с половиной
 * момента в запасе на задержку маневровых), и линейная у самой цели. Её
 * коэффициент ограничен тем, что успевает отработать регулятор угловой
 * скорости (SHIP.rcsBand): прямой P-регулятор с большим коэффициентом на
 * тяжёлом корабле уходит в раскачку — нос проскакивает цель, пока
 * маневровые разворачивают момент.
 */
export function rateCmd(a, rate, accel, k) {
  const m = Math.abs(a);
  const kk = Math.min(k, 1 / (2.5 * (SHIP.rcsBand || 0.4)));
  const w = Math.min(rate, Math.sqrt(accel * m), kk * m);
  return clamp(Math.sign(a) * w / rate, -1, 1);
}

/** Навести нос по направлению. @returns угловая ошибка, рад */
export function aimDir(ship, dir, k = 1.6) {
  const ang = aimAngles(ship.basis, dir);
  const c = ship.control;
  c.pitch = rateCmd(ang.pitch, SHIP.pitchRate, SHIP.pitchAccel, k);
  c.yaw = rateCmd(ang.yaw, SHIP.yawRate, SHIP.yawAccel, k);
  return Math.hypot(ang.pitch, ang.yaw);
}

/** Навести нос на точку. */
export const aimAt = (ship, point, k = 1.6) => aimDir(ship, normalize(v3(
  point.x - ship.pos.x,
  point.y - ship.pos.y,
  point.z - ship.pos.z)), k);

/**
 * Полёт заданным вектором скорости: нос по направлению вектора, тяга по
 * его длине. Корабль умеет двигаться только вдоль носа, поэтому «висеть
 * рядом со станцией» — это лететь с её скоростью, а не стоять на месте.
 * @returns требуемая скорость, км/с
 */
export function flyVelocity(ship, vec, k = 1.6) {
  const sp = Math.hypot(vec.x, vec.y, vec.z);
  if (sp > 1e-7) aimDir(ship, normalize(vec, _vec), k);
  ship.throttle = clamp(sp / SHIP.maxSpeed, 0, 1);
  return sp;
}

/**
 * Погасить остаточный крен: заданная скорость крена — ноль, остальное
 * делает регулятор угловой скорости (js/game/ship.js, spinAxis).
 */
export function levelRoll(ship) {
  ship.control.roll = 0;
}

/**
 * Выйти на ПОЛНУЮ заданную ориентацию (нос + «верх»), а не только на
 * направление носа. Нужно посадке: садиться надо брюхом вниз, а куда
 * при этом смотрит нос — дело десятое.
 *
 * Поворот считается в два шага: сначала «верх» корабля приводится к
 * целевому (одно вращение вокруг их общей нормали), затем нос
 * доворачивается вокруг уже целевого «верха».
 *
 * Соблазнительная короткая формула ω ≈ ½·Σ(свои оси × целевые) здесь не
 * годится: у неё есть НЕПОДВИЖНАЯ ТОЧКА около поворота на 180°, и
 * регулятор честно сходился к ошибке в 76° — ровно с этого и начались
 * «опрокидывания» при посадке.
 *
 * @returns угол рассогласования в радианах
 */
export function alignBasis(ship, fwdTarget, upTarget, k = 1.4) {
  const b = ship.basis;
  normalize(v3(upTarget.x, upTarget.y, upTarget.z), _t.up);

  // Шаг 1: ось и угол поворота, приводящего b.up к целевому «верху».
  cross(b.up, _t.up, _w);
  const s = Math.hypot(_w.x, _w.y, _w.z);
  const c1 = dot(b.up, _t.up);
  const ang = Math.atan2(s, c1);
  if (s > 1e-9) {
    _w.x = _w.x / s * ang; _w.y = _w.y / s * ang; _w.z = _w.z / s * ang;
  } else if (c1 < 0) {
    // Ровно «вверх ногами»: любая ось в плоскости, перпендикулярной up.
    _w.x = b.fwd.x * Math.PI; _w.y = b.fwd.y * Math.PI; _w.z = b.fwd.z * Math.PI;
  } else {
    _w.x = 0; _w.y = 0; _w.z = 0;
  }

  // Шаг 2: где окажется нос после первого поворота и сколько ему не
  // хватает до цели (доворот вокруг целевого «верха»).
  if (ang > 1e-9) {
    const axis = _axis;
    axis.x = _w.x / ang; axis.y = _w.y / ang; axis.z = _w.z / ang;
    rotateAxis(b.fwd, axis, ang, _f1);
  } else {
    _f1.x = b.fwd.x; _f1.y = b.fwd.y; _f1.z = b.fwd.z;
  }
  cross(_f1, fwdTarget, _tmp);
  const ang2 = Math.atan2(dot(_tmp, _t.up), dot(_f1, fwdTarget));
  if (isFinite(ang2)) {
    _w.x += _t.up.x * ang2; _w.y += _t.up.y * ang2; _w.z += _t.up.z * ang2;
  }

  // rotateBasis(pitch, yaw, roll) даёт угловую скорость
  // -pitch·right + yaw·up - roll·fwd, отсюда и знаки.
  const c = ship.control;
  c.pitch = rateCmd(-dot(_w, b.right), SHIP.pitchRate, SHIP.pitchAccel, k);
  c.yaw = rateCmd(dot(_w, b.up), SHIP.yawRate, SHIP.yawAccel, k);
  c.roll = rateCmd(-dot(_w, b.fwd), SHIP.rollRate, SHIP.rollAccel, k);
  return Math.hypot(_w.x, _w.y, _w.z);
}

/** Проекция вектора на плоскость, перпендикулярную up (для «по горизонту»). */
export function horizontal(vec, up, out = v3()) {
  const d = dot(vec, up);
  out.x = vec.x - up.x * d;
  out.y = vec.y - up.y * d;
  out.z = vec.z - up.z * d;
  return out;
}
