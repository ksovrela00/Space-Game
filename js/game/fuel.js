// Топливо: сколько стоит каждый манёвр и что показать на шкале.
//
// Считает здесь ИГРА — но только для вида и для автономного режима. Счёт,
// который стоит денег, ведёт сервер (server/src/Fuel.php): бак в базе
// пишет только он, а сюда его число приходит по сокету (applyServerFuel).
// Формулы у обеих сторон одни, и числа тоже — модули каталога и масса
// корпуса из меша (js/game/downwash.js, SHIP_MASS): иначе шкала в кабине
// показывала бы одно, а заправка брала бы деньги за другое.
//
// Расходов три, и у каждого своя формула:
//
//   двигатели       масса · Δv / скорость струи, по группам сопел —
//                   маршевые, подъёмные, маневровые (Δv считает модель
//                   полёта, js/game/ship.js, ship.dv)
//   квантовый ход   километры / 10⁶ · quantumFuel
//   варп            световые годы · warpFuel
//
// Бак — семь тысячных массы корабля, и формула Циолковского на такой доле
// совпадает с линейной до трети процента.
//
// Что сервер видит и чего нет. Работу сопел игра ему СООБЩАЕТ счётчиками
// (ship.work, js/net/socket.js) — тонны он считает сам. Квантовый ход он
// меряет по снимкам положения, варп — по смене системы в сохранении.

import { clamp } from '../core/vec3.js';
import { SHIP } from './ship.js';
import { shipMass } from './downwash.js';

/** Масса корабля, т. */
export const massT = () => shipMass() / 1000;

/** Объём бака: корпусной плюс дополнительный (SHIP.fuelCap, applyShipSpec). */
export const fuelCap = () => SHIP.fuelCap;

/** Резерв: его не трогают ни квантовый привод, ни варп. */
export const fuelReserve = () => SHIP.fuelReserve;

/** Тонны за работу сопел: Δv каждой группы, км/с. Снятый модуль не тратит. */
export function thrustTons(main, lift, rcs) {
  let k = 0;
  if (SHIP.exhaust > 0) k += Math.max(0, main) / SHIP.exhaust;
  if (SHIP.liftExhaust > 0) k += Math.max(0, lift) / SHIP.liftExhaust;
  if (SHIP.rcsExhaust > 0) k += Math.max(0, rcs) / SHIP.rcsExhaust;
  return massT() * k;
}

/** Тонны за квантовый ход, км. */
export const quantumTons = (km) => (Math.max(0, km) / 1e6) * SHIP.quantumFuel;

/** Тонны за варп, световые годы. */
export const warpTons = (ly) => Math.max(0, ly) * SHIP.warpFuel;

/**
 * Хватит ли на прыжок, не залезая в резерв.
 *
 * Резерв — то, на чём корабль долетает до порта, где бы ни кончился
 * прыжок: прыжок, после которого его не осталось бы, не начинается.
 */
export const affords = (ship, tons) => ship.fuel - tons >= fuelReserve() - 1e-9;

/** Сколько световых лет варпа в баке сверх резерва. */
export const warpRange = (ship) =>
  (SHIP.warpFuel > 0 ? Math.max(0, ship.fuel - fuelReserve()) / SHIP.warpFuel : 0);

/**
 * Состояние бака для приборов.
 *
 *   'dry'     пусто: сопла не работают вовсе
 *   'reserve' в резерве: прыжков нет, до порта — на двигателях
 *   'low'     меньше четверти: пора думать о заправке
 *   'ok'
 */
export function fuelLevel(ship) {
  if (!(ship.fuel > 0)) return 'dry';
  if (ship.fuel <= fuelReserve() + 1e-9) return 'reserve';
  if (ship.fuel < fuelCap() * 0.25) return 'low';
  return 'ok';
}

/** Учёт расхода на корабле: счётчики для сервера и то, что уже списано. */
export function resetFuelBook(ship) {
  // Работа сопел с начала связи, км/с, — её получает сервер (Hub::meter).
  ship.work = { main: 0, lift: 0, rcs: 0 };
  // Сколько тонн списано здесь, в игре, по тем же формулам: двигатели и
  // квантовый ход. Им сверяется число сервера (applyServerFuel).
  ship.burned = 0;
  // Варп, который сервер ещё не подтвердил: его списывает база при
  // сохранении в новой системе, а до тех пор его число в баке сервера
  // ещё не учтено.
  ship.warpDebt = 0;
  return ship;
}

function take(ship, tons) {
  const t = Math.min(Math.max(0, ship.fuel), tons);
  ship.fuel -= t;
  return t;
}

/**
 * Расход сопел за шаг. Зовётся сразу после updateShip: Δv этого шага
 * модель полёта оставила в ship.dv.
 */
export function burnThrust(ship) {
  const dv = ship.dv;
  if (!dv) return 0;
  if (!ship.work) resetFuelBook(ship);
  ship.work.main += dv.main;
  ship.work.lift += dv.lift;
  ship.work.rcs += dv.rcs;
  const t = take(ship, thrustTons(dv.main, dv.lift, dv.rcs));
  ship.burned += t;
  return t;
}

/** Расход квантового привода на пройденном отрезке, км. */
export function burnQuantum(ship, km) {
  if (!ship.work) resetFuelBook(ship);
  const t = take(ship, quantumTons(km));
  ship.burned += t;
  return t;
}

/**
 * Расход варпа. `owed` — будет ли его списывать и сервер: тогда он
 * помнится долгом, пока сохранение в новой системе не подтвердит.
 */
export function burnWarp(ship, ly, owed) {
  if (!ship.work) resetFuelBook(ship);
  const t = take(ship, warpTons(ly));
  if (owed) ship.warpDebt += t;
  return t;
}

/** Сервер подтвердил варп (ответ на сохранение): долг погашен. */
export function warpSettled(ship, tons) {
  ship.warpDebt = Math.max(0, (ship.warpDebt || 0) - Math.max(0, tons || 0));
}

/**
 * Бак по счёту сервера.
 *
 * Сервер шлёт бак ПОСЛЕ снимка n, а с тех пор, как снимок ушёл, игра
 * успела потратить ещё — пока он шёл до сервера и ответ обратно. Это
 * вычитается: иначе шкала на каждом ответе прыгала бы вверх на расход
 * последних двухсот миллисекунд. Долг по варпу вычитается тоже — сервер
 * о прыжке ещё не знает.
 *
 * @param fuel    бак по серверу, т
 * @param burnedAt ship.burned в момент отправки снимка n (null — неизвестно)
 */
export function applyServerFuel(ship, fuel, burnedAt = null) {
  if (typeof fuel !== 'number' || !Number.isFinite(fuel)) return ship.fuel;
  if (!ship.work) resetFuelBook(ship);
  const since = typeof burnedAt === 'number' ? Math.max(0, ship.burned - burnedAt) : 0;
  ship.fuel = clamp(fuel - since - ship.warpDebt, 0, fuelCap());
  return ship.fuel;
}
