// Гравитация тел и система отсчёта рядом с ними.
//
// Зачем это нужно. Мировые координаты инерциальные: планета идёт по
// орбите, вращается вокруг оси, а корабль с нулевой тягой стоит на
// месте — и поверхность уезжает из-под него. Формально верно, играть
// невозможно: «зависнуть над точкой» нельзя в принципе.
//
// Поэтому у каждого тела есть своя гравитация (из плотности и радиуса),
// а у неё — радиус захвата. Внутри захвата корабль ПЕРЕНОСИТСЯ вместе с
// телом: орбитальное движение компенсируется целиком, суточное вращение
// — тем сильнее, чем ближе поверхность. Управление при этом не меняется:
// перенос сдвигает корабль вместе со всей окрестностью, это не тяга и не
// сила, а смена системы отсчёта (так же поступают Elite Dangerous и
// вообще все, у кого есть посадка).
//
// Гравитация из этого же модуля работает и как сила: с выпущенным шасси
// компенсатор высоты отключён, и корабль проседает тем быстрее, чем
// тяжелее тело.

import { v3 } from '../core/vec3.js';
import { altitudeOf } from './surface.js';

// Гравитационная постоянная в километрах: км³/(кг·с²).
const G = 6.674e-20;

// Плотности по типу тела, кг/м³ — числа Солнечной системы: камень 3.3,
// лёд 1.6, газовый гигант 1.3, звезда 1.4 г/см³. Вместе с радиусом они
// задают всю гравитацию тела, отдельного «параметра массы» в генераторе
// не нужно.
export const DENSITY = {
  star: 1400,
  lava: 4000,
  rock: 3300,
  desert: 3000,
  ocean: 5500,
  ice: 1600,
  gas: 1300,
  moon: 3300,
};

// Суточное вращение компенсируется целиком у самой поверхности и совсем
// не компенсируется высоко: иначе на краю захвата корабль носило бы
// вокруг тела с окружной скоростью в километры в секунду.
const SPIN_FULL = 8;      // км — ниже этой высоты поверхность «стоит»
const SPIN_NONE = 80;     // км — выше этой корабль инерциален

/** Гравитационный параметр μ = GM, км³/с². */
export function muOf(body) {
  const rho = (DENSITY[body.kind] || DENSITY.rock) * 1e9;   // кг/км³
  return G * rho * (4 / 3) * Math.PI * body.radius ** 3;
}

/** Ускорение свободного падения на поверхности, м/с². */
export const surfaceG = (body) => (body.mu / (body.radius * body.radius)) * 1000;

/**
 * Радиус гравитационного захвата — сфера действия тела (SOI).
 *
 * Формула стандартная: a·(m/M)^0.4, где a — радиус орбиты, а M — масса
 * того, вокруг чего тело обращается. Внутри этой сферы притяжение тела
 * сильнее притяжения его хозяина, то есть «главным» оказывается именно
 * оно — у луны это несколько её радиусов, у планеты десятки.
 */
export function soiOf(body) {
  const parent = body.parent;
  if (!parent || !body.orbit || !parent.mu) return Infinity;   // светило
  return body.orbit.radius * (body.mu / parent.mu) ** 0.4;
}

/** Заполнить μ, g и радиус захвата. Родители должны быть посчитаны раньше. */
export function setGravity(body) {
  body.mu = muOf(body);
  body.g0 = surfaceG(body);
  body.soi = soiOf(body);
  return body;
}

// Ниже этого притяжения захвата нет, даже внутри сферы действия.
//
// Сфера действия у крупного тела огромна: у здешнего газового гиганта
// это четверть миллиона километров, и формально корабль «в захвате»
// там, где до планеты двое суток лёта, а тяжесть — тысячные доли м/с².
// Считать это захватом бессмысленно: ни держать, ни ощущаться она там
// не может. Порог отсекает именно такие случаи.
export const CAPTURE_G = 3e-5;        // км/с² = 0.03 м/с²

/**
 * В чьём захвате корабль. Из вложенных сфер выбирается самая тесная
 * (луна важнее планеты, планета важнее светила): у неё притяжение в этой
 * точке и сильнее.
 */
export function captureBody(world, pos) {
  let best = null;
  for (const b of world.bodies) {
    if (!isFinite(b.soi)) continue;                // светило — не захват
    const d = Math.hypot(pos.x - b.pos.x, pos.y - b.pos.y, pos.z - b.pos.z);
    if (d > b.soi) continue;
    if (b.mu / (d * d) < CAPTURE_G) continue;
    if (!best || b.soi < best.soi) best = b;
  }
  return best;
}

/** Ускорение свободного падения в точке, км/с². */
export function gravityAt(body, pos) {
  const d2 = (pos.x - body.pos.x) ** 2 + (pos.y - body.pos.y) ** 2 + (pos.z - body.pos.z) ** 2;
  return body.mu / Math.max(d2, body.radius * body.radius * 0.01);
}

const _alt = { dir: v3() };

/**
 * Доля суточного вращения, которую компенсирует перенос.
 *
 * Высота считается НАД РЕЛЬЕФОМ, а не над сферой: у каменистых планет
 * горы поднимаются на десятки километров, и по сфере корабль в шести
 * километрах над грунтом оказывался бы в зоне частичной компенсации —
 * то есть грунт уезжал бы у него из-под ног на полсотни метров в
 * секунду именно там, где он должен стоять.
 */
export function spinCarry(body, pos) {
  const alt = body.isBody ? altitudeOf(body, pos, _alt).alt
    : Math.hypot(pos.x - body.pos.x, pos.y - body.pos.y, pos.z - body.pos.z) - body.radius;
  if (alt <= SPIN_FULL) return 1;
  if (alt >= SPIN_NONE) return 0;
  const t = (alt - SPIN_FULL) / (SPIN_NONE - SPIN_FULL);
  return 1 - t * t * (3 - 2 * t);
}

const _r = v3();

/**
 * Перенести корабль вместе с телом за шаг dt.
 *
 * Орбитальное движение компенсируется целиком: тело ушло по орбите —
 * корабль ушёл с ним. Вращение компенсируется с весом spinCarry, то есть
 * у поверхности корабль висит над одной и той же точкой грунта.
 *
 * Поворот применяется и к осям корабля: иначе за минуту зависания
 * горизонт уехал бы на десяток градусов.
 *
 * @returns вес, с которым скомпенсировано вращение (нужен тем, кто
 *          считает скорость относительно грунта)
 */
export function carryShip(ship, body, dt) {
  ship.pos.x += body.vel.x * dt;
  ship.pos.y += body.vel.y * dt;
  ship.pos.z += body.vel.z * dt;

  const w = spinCarry(body, ship.pos);
  const ang = body.spin * dt * w;
  if (ang === 0) return w;

  const p = body.pole;
  const c = Math.cos(ang), s = Math.sin(ang);
  // Поворот вокруг оси p на угол ang (формула Родрига).
  const rot = (v, ox, oy, oz) => {
    const x = v.x - ox, y = v.y - oy, z = v.z - oz;
    const d = p.x * x + p.y * y + p.z * z;
    const cx = p.y * z - p.z * y, cy = p.z * x - p.x * z, cz = p.x * y - p.y * x;
    v.x = ox + x * c + cx * s + p.x * d * (1 - c);
    v.y = oy + y * c + cy * s + p.y * d * (1 - c);
    v.z = oz + z * c + cz * s + p.z * d * (1 - c);
  };
  rot(ship.pos, body.pos.x, body.pos.y, body.pos.z);
  rot(ship.basis.right, 0, 0, 0);
  rot(ship.basis.up, 0, 0, 0);
  rot(ship.basis.fwd, 0, 0, 0);
  return w;
}

/**
 * Скорость грунта, КАКОЙ ЕЁ ВИДИТ ПИЛОТ: то, что скомпенсировал перенос,
 * из неё вычтено. У поверхности выходит ноль — висящий корабль стоит над
 * точкой; высоко остаётся полная окружная скорость вращения.
 */
export function groundDrift(body, pos, out = v3(), carried = true) {
  const w = carried ? spinCarry(body, pos) : 0;
  const k = (1 - w) * body.spin;
  const rx = pos.x - body.pos.x, ry = pos.y - body.pos.y, rz = pos.z - body.pos.z;
  const p = body.pole;
  out.x = (p.y * rz - p.z * ry) * k;
  out.y = (p.z * rx - p.x * rz) * k;
  out.z = (p.x * ry - p.y * rx) * k;
  if (!carried) { out.x += body.vel.x; out.y += body.vel.y; out.z += body.vel.z; }
  return out;
}

const _fieldUp = v3();

/**
 * Тяготение под кораблём для модели полёта: местная вертикаль и
 * ускорение свободного падения в этой точке.
 *
 * Кто его чувствует, решает уже модель полёта: с убранным шасси вес в
 * точности гасит компенсатор высоты, с выпущенным — не гасит никто.
 */
export function gravityField(body, ship) {
  if (!body) return null;
  const dx = ship.pos.x - body.pos.x, dy = ship.pos.y - body.pos.y, dz = ship.pos.z - body.pos.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  _fieldUp.x = dx / l; _fieldUp.y = dy / l; _fieldUp.z = dz / l;
  return {
    up: _fieldUp,
    g: gravityAt(body, ship.pos),                  // ускорение, км/с²
  };
}
