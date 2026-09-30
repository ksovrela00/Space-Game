// Струя движков у грунта: чем гнёт деревья и поднимает пыль.
//
// Зачем. Корабль длиной в шестьдесят пять метров висит над лесом — и лес
// об этом не знает: ни одна ветка не шевелится. А это как раз то, по
// чему глаз узнаёт размер и вес: вертолёт в полторы тонны пригибает
// траву, «Чинук» валит с ног людей в двадцати метрах, «Харриер» сдувает
// щебень с полосы. Корабль, под которым лес стоит смирно, весит ровно
// столько, сколько нарисованная картинка.
//
// Физика здесь настоящая, и из неё выходит главное — ДО КУДА достаёт
// струя. Поток держится на двух законах турбулентных струй:
//
//   * свободная круглая струя сохраняет поток импульса J (это и есть
//     тяга, Н), а скорость на её оси падает как 1/x:
//         u = jetK · √(J/ρ) / x;
//   * ударившись о грунт, она растекается настильной радиальной струёй,
//     и там скорость падает как 1/r от точки удара:
//         u = wallK · √(J/ρ) / r.
//
// Коэффициенты — из опытов (Rajaratnam, «Turbulent Jets»; Poreh, Tsuei,
// Cermak, 1967), а не подобраны. Любопытное следствие: деревья гнёт
// скоростной НАПОР q = ρu²/2, и плотность воздуха из него сокращается:
//         q = ½ · J · k² / x².
// Тонкий воздух гонит струю быстрее, но толкает с той же силой. Плотность
// нужна только пыли: срывает её скорость ветра, а не напор.
//
// Тяга на зависании — это вес, а веса в лётной модели нет: она задаёт
// ускорения, а не силы. Масса выводится из ОБЪЁМА КОРПУСА (он считается
// по самой модели, js/models/ships.js) и одного допущения — средней
// плотности корабля. Это единственное число здесь, которое не выводится
// ни из чего.

import { SHIP } from './ship.js';
import { HULL_VOLUME_M3 } from '../models/ships.js';
import { bodyBasis } from './world.js';
import { toLocal } from '../core/basis.js';
import { v3 } from '../core/vec3.js';

export const WASH = {
  // Средняя плотность корабля, кг/м³. Взята плотность авиалайнера на
  // взлётном весе: у «Боинга-747» четыреста тонн на две с половиной
  // тысячи кубометров фюзеляжа и крыла — около ста пятидесяти. Корпус
  // здешнего корабля — 11 200 м³, значит в нём тысяча семьсот тонн.
  density: 150,
  // Плотность воздуха при давлении в один бар и 15 °C, кг/м³. Давление
  // тела (bodyinfo.js, press) масштабирует её линейно — температуры в
  // модели мира нет, и ради пыли заводить её незачем.
  rho1: 1.225,
  // Круглая турбулентная струя, скорость на оси: u = jetK·√(J/ρ)/x.
  jetK: 6.5,
  // Настильная радиальная струя за точкой удара: u = wallK·√(J/ρ)/r.
  // Две формулы сходятся на r = h·wallK/jetK ≈ 0.18·h — там, где
  // расширившаяся струя и достаёт до грунта (полуширина ~0.1 длины).
  wallK: 1.16,
  // Полуширина свободной струи на расстоянии x (угол раскрытия ~6°):
  // нужна маршевым — их струя идёт вдоль грунта и задевает его краем.
  spread: 0.1,
  // Подъёмные бьют вдоль «низа» корабля. Перевернулся — струя ушла в
  // небо; лёг на бок — она метёт горизонт. Ниже этого косинуса (78°)
  // считаем, что до грунта она не доходит.
  minCos: 0.2,
};

/** Масса корабля, кг. */
export const SHIP_MASS = HULL_VOLUME_M3 * WASH.density;

/** Плотность воздуха у поверхности тела, кг/м³ (0 — воздуха нет). */
export const airDensity = (body) =>
  (body && body.atmo && body.press > 0 ? WASH.rho1 * body.press : 0);

/**
 * Сколько работают ДВИГАТЕЛИ, доли полного хода: подъёмные и маршевые.
 *
 * Это не то же, что отклонение ручки, и разница видна сразу: корабль
 * висит над грунтом без единого нажатия — а держат его подъёмные,
 * потому что с убранным шасси компенсатор высоты в точности гасит вес
 * (js/game/ship.js). Доля этой тяги выводится из модели: полный ход
 * даёт liftTWR весов, значит на зависание уходит 1/liftTWR.
 *
 * Одна формула на всех, кто смотрит на движки: пыль (js/game/dust.js),
 * струю под кораблём и дрожь камеры (js/game/chase.js). Две копии уже
 * были бы двумя ответами на вопрос «работают ли сейчас движки».
 */
export function engineLoad(ship, out = { lift: 0, main: 0 }, weight = true) {
  out.lift = 0; out.main = 0;
  if (!ship || ship.stun > 0 || ship.dockedAt) return out;
  const c = ship.control || {};
  // Вес держат только там, где он есть: вдали от тел компенсатору
  // гасить нечего, и подъёмные молчат, пока их не попросят.
  const hover = !weight || (ship.gear && ship.gear.out) ? 0 : 1 / (SHIP.liftTWR || 3);
  out.lift = Math.min(1, hover + Math.abs(c.lift || 0));
  out.main = Math.min(1, Math.abs(ship.throttle || 0));
  return out;
}

/** Тяга подъёмных, Н: полный ход — liftTWR местных весов. */
export function liftThrust(body, lift) {
  const g = Math.max((SHIP.liftMin || 0) * 1000, (body && body.g0 || 0) * (SHIP.liftTWR || 3));
  return SHIP_MASS * g * lift;
}

/** Тяга маршевых, Н: ровно та, что даёт ускорение лётной модели. */
export const mainThrust = (main) => SHIP_MASS * (SHIP.accel || 0) * 1000 * main;

/**
 * Скоростной напор подъёмной струи у грунта, Па.
 *
 * @param T тяга, Н
 * @param h длина струи до грунта, м
 * @param r расстояние по грунту от точки удара, м
 */
export function groundQ(T, h, r) {
  const k = Math.min(WASH.jetK / Math.max(h, 1), WASH.wallK / Math.max(r, 1));
  return 0.5 * T * k * k;
}

/** Скорость ветра по напору, м/с. */
export const windOf = (q, rho) => (rho > 0 ? Math.sqrt(2 * q / rho) : 0);

// --- как гнётся растение -------------------------------------------------------
//
// Наклон пропорционален напору: сила на крону — это q·Cd·S, а прогиб
// ствола под ней — сила, делённая на жёсткость. Пропорция задаётся
// опорной точкой — наклоном при ветре в двадцать метров в секунду
// (восемь баллов по Бофорту, «ветки ломаются, идти против ветра
// трудно»): у дерева крона уходит градусов на десять, куст клонится на
// двадцать пять, трава ложится на пятьдесят пять. Сверху наклон
// упирается в предел — дальше дерево ломается, а трава уже лежит.
//
// Между травой и деревом — по логарифму высоты: жёсткость ствола растёт
// с его толщиной, а толщина — с высотой.
export const BEND = {
  qRef: 0.5 * 1.225 * 20 * 20,     // Па — ветер 20 м/с у моря
  grass: { h: 0.5, ref: 55, cap: 75, hz: 2.4 },
  tree: { h: 15, ref: 10, cap: 30, hz: 0.45 },
};

/** Где растение между травой (0) и деревом (1), по высоте в метрах. */
export const bendClass = (hM) =>
  Math.max(0, Math.min(1, Math.log(hM / BEND.grass.h) / Math.log(BEND.tree.h / BEND.grass.h)));

/** Средний наклон растения под напором q, радианы. */
export function bendAngle(q, hM) {
  const k = bendClass(hM);
  const ref = (BEND.grass.ref + (BEND.tree.ref - BEND.grass.ref) * k) * Math.PI / 180;
  const cap = (BEND.grass.cap + (BEND.tree.cap - BEND.grass.cap) * k) * Math.PI / 180;
  const lin = ref * q / BEND.qRef;
  return cap * (1 - Math.exp(-lin / cap));
}

// --- струя в кадре --------------------------------------------------------------

const _frame = { right: v3(), up: v3(), fwd: v3() };
const _load = { lift: 0, main: 0 };
const _p = v3();

/**
 * Струя сейчас: всё, что нужно рисованию и пыли, в осях ТЕЛА (км).
 *
 * Оси тела, а не мира, по той же причине, что у пыли: внутри захвата
 * корабль переносится вместе с поверхностью (js/game/gravity.js), и
 * точка удара, записанная в мировых координатах, за секунду уезжала бы
 * на сотни метров.
 *
 * @returns out с полем on: false — струи у грунта нет
 */
export function washState(game, out = makeWash()) {
  out.on = false;
  const ship = game && game.ship;
  const zone = game && game.zone;
  const body = zone && zone.body;
  if (!ship || !body || !(zone.alt >= 0)) return out;
  engineLoad(ship, _load);
  out.body = body;
  out.rho = airDensity(body);
  out.lift = _load.lift;
  out.main = _load.main;
  out.T = liftThrust(body, _load.lift);
  out.Tm = mainThrust(_load.main);

  const fr = bodyBasis(body, _frame);
  // Местная вертикаль под кораблём и сам корабль — в осях тела.
  toLocal(fr, body.pos, ship.pos, _p);
  const len = Math.hypot(_p.x, _p.y, _p.z) || 1;
  const ux = _p.x / len, uy = _p.y / len, uz = _p.z / len;
  out.up.x = ux; out.up.y = uy; out.up.z = uz;
  out.ship.x = _p.x; out.ship.y = _p.y; out.ship.z = _p.z;

  // Ось подъёмной струи — «низ» корпуса, тоже в осях тела.
  const b = ship.basis;
  const dx = -(b.up.x * fr.right.x + b.up.y * fr.right.y + b.up.z * fr.right.z);
  const dy = -(b.up.x * fr.up.x + b.up.y * fr.up.y + b.up.z * fr.up.z);
  const dz = -(b.up.x * fr.fwd.x + b.up.y * fr.fwd.y + b.up.z * fr.fwd.z);
  // Насколько она смотрит вниз, к грунту.
  const cosDown = -(dx * ux + dy * uy + dz * uz);
  out.cos = cosDown;
  const hKm = zone.alt;
  if (cosDown > WASH.minCos && out.T > 0) {
    // Длина струи до грунта — по её оси, а не по вертикали: корабль,
    // наклонённый на тридцать градусов, бьёт в грунт наискось и дальше.
    const along = hKm / cosDown;
    out.h = along * 1000;
    out.hit.x = _p.x + dx * along;
    out.hit.y = _p.y + dy * along;
    out.hit.z = _p.z + dz * along;
    out.on = true;
  } else {
    out.h = Infinity;
  }

  // Маршевые: сопла у кормы и струя назад вдоль корпуса.
  const fx = -(b.fwd.x * fr.right.x + b.fwd.y * fr.right.y + b.fwd.z * fr.right.z);
  const fy = -(b.fwd.x * fr.up.x + b.fwd.y * fr.up.y + b.fwd.z * fr.up.z);
  const fz = -(b.fwd.x * fr.fwd.x + b.fwd.y * fr.fwd.y + b.fwd.z * fr.fwd.z);
  out.aft.x = fx; out.aft.y = fy; out.aft.z = fz;
  const tail = (game.shipMesh && game.shipMesh.length || 0.065) * 0.5;
  out.nozzle.x = _p.x + fx * tail;
  out.nozzle.y = _p.y + fy * tail;
  out.nozzle.z = _p.z + fz * tail;
  if (out.Tm > 0) out.on = true;
  return out;
}

export function makeWash() {
  return {
    on: false, body: null, rho: 0, lift: 0, main: 0, T: 0, Tm: 0, h: Infinity, cos: 0,
    up: v3(), ship: v3(), hit: v3(), aft: v3(), nozzle: v3(),
  };
}

/**
 * Напор в точке грунта p (оси тела, км) от обеих струй, Па, и куда он
 * толкает — единичный вектор по касательной. Это ровно то, что считает
 * вершинный шейдер растений (js/gl/wash.js); здесь — для проверок и для
 * пыли.
 */
export function washAt(w, p, dir = null) {
  let px = 0, py = 0, pz = 0;
  const up = w.up;
  if (w.T > 0 && w.h < Infinity) {
    const ex = p.x - w.hit.x, ey = p.y - w.hit.y, ez = p.z - w.hit.z;
    const e = ex * up.x + ey * up.y + ez * up.z;
    const hx = ex - up.x * e, hy = ey - up.y * e, hz = ez - up.z * e;
    const r = Math.hypot(hx, hy, hz) || 1e-9;
    const q = groundQ(w.T, w.h, r * 1000);
    px += hx / r * q; py += hy / r * q; pz += hz / r * q;
  }
  if (w.Tm > 0) {
    const mx = p.x - w.nozzle.x, my = p.y - w.nozzle.y, mz = p.z - w.nozzle.z;
    const x = mx * w.aft.x + my * w.aft.y + mz * w.aft.z;
    if (x > 0.002) {
      const qx = mx - w.aft.x * x, qy = my - w.aft.y * x, qz = mz - w.aft.z * x;
      const bw = WASH.spread * x;
      const qc = 0.5 * w.Tm * (WASH.jetK / (x * 1000)) ** 2;
      // Профиль скорости гауссов с полушириной bw на половине высоты;
      // напор — квадрат скорости, отсюда удвоенный показатель.
      const q = qc * Math.exp(-2 * Math.LN2 * (qx * qx + qy * qy + qz * qz) / (bw * bw));
      const a = w.aft.x * up.x + w.aft.y * up.y + w.aft.z * up.z;
      const hx = w.aft.x - up.x * a, hy = w.aft.y - up.y * a, hz = w.aft.z - up.z * a;
      const hl = Math.hypot(hx, hy, hz);
      if (hl > 1e-3) { px += hx / hl * q; py += hy / hl * q; pz += hz / hl * q; }
    }
  }
  const q = Math.hypot(px, py, pz);
  if (dir) {
    dir.x = q > 0 ? px / q : 0; dir.y = q > 0 ? py / q : 0; dir.z = q > 0 ? pz / q : 0;
  }
  return q;
}

