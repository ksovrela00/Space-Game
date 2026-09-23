// Что стоит на корабле: список модулей и их числа.
//
// Заведён отдельно, потому что читателей у него два и они в разных
// слоях: карточка корабля в меню (js/ui/menu.js) и выгрузка каталога в
// базу (tools/export.mjs -> server). Две копии этого списка разъехались
// бы при первой же перенастройке двигателя, причём молча: в игре одно
// число, в магазине сервера другое.
//
// Числа сюда не переписаны, а взяты из SHIP — тех самых констант, по
// которым корабль летает. Строка `value` — то, как модуль подписан в
// карточке; формат простой намеренно, чтобы не тащить в игровой слой
// приборные форматтеры.

import { SHIP } from './ship.js';
import { WEAPONS } from './weapons.js';

/**
 * Ступени дальности сканера, км.
 *
 * Живут здесь, а не в приборе: это свойство ЖЕЛЕЗА. Прибор лишь выбирает
 * ближайшую ступень, в которую помещается всё вокруг (js/main.js), и
 * поэтому game.scannerRange — текущий масштаб кольца, а не дальность
 * сканера. В карточке корабля стоит последняя ступень — предел железа.
 */
export const SCANNER_STEPS = [5, 25, 120, 600, 3000, 20000];

/**
 * Строка оружия в карточке.
 *
 * Числа берутся из WEAPONS — того же места, откуда их берёт сам бой. В
 * карточке, где написано «3 урона», и в выстреле, который снимает четыре,
 * виноват всегда второй список.
 */
function gun(w, installed) {
  return {
    code: w.code, slot: 'gun', name: w.name + ' · ' + w.mountName,
    value: installed
      ? w.damage + ' × ' + w.rate + '/с, до ' + w.range + ' км'
      : 'ГНЕЗДО СВОБОДНО',
    installed,
    spec: {
      kind: w.kind, mount: w.mount, damage: w.damage, rate: w.rate,
      speed: w.speed, range: w.range, cone: w.cone,
    },
  };
}

/**
 * Модули корабля.
 *
 * `spec` — то, что модуль делает в числах: его читает сервер, и он же
 * станет основой уровней и апгрейдов. `installed: false` означает, что
 * гнездо есть, а модуля нет, — и это важно показывать: пустая строка в
 * карточке читается как поломка прибора.
 */
export function modules() {
  return [
    {
      code: 'engine', slot: 'engine', name: 'МАРШЕВЫЙ ДВИГАТЕЛЬ',
      value: SHIP.maxSpeed.toFixed(2) + ' км/с', installed: true,
      spec: { maxSpeed: SHIP.maxSpeed, accel: SHIP.accel, brake: SHIP.brake },
    },
    {
      code: 'rcs', slot: 'rcs', name: 'МАНЕВРОВЫЕ',
      value: SHIP.lateral.toFixed(2) + ' км/с²', installed: true,
      spec: { lateral: SHIP.lateral, pitch: SHIP.pitchRate, yaw: SHIP.yawRate, roll: SHIP.rollRate },
    },
    {
      code: 'lift', slot: 'lift', name: 'ПОДЪЁМНЫЕ ДВИГАТЕЛИ',
      value: '×' + SHIP.liftTWR + ' к весу', installed: true,
      spec: { twr: SHIP.liftTWR, min: SHIP.liftMin },
    },
    {
      code: 'boost', slot: 'boost', name: 'ФОРСАЖ',
      value: '×' + SHIP.boostMax + ', ' + SHIP.boostBurn + ' с', installed: true,
      spec: { mul: SHIP.boostMax, burn: SHIP.boostBurn, fill: SHIP.boostFill },
    },
    {
      code: 'quantum', slot: 'drive', name: 'КВАНТОВЫЙ ПРИВОД',
      value: (SHIP.quantumSpeed / 1000).toFixed(0) + ' тыс. км/с', installed: true,
      spec: { speed: SHIP.quantumSpeed },
    },
    {
      code: 'warp', slot: 'warp', name: 'ВАРП-ПРИВОД',
      value: 'МЕЖСИСТЕМНЫЙ', installed: true,
      spec: { interstellar: true },
    },
    {
      code: 'dock', slot: 'computer', name: 'ДОКИНГ-КОМПЬЮТЕР',
      value: 'ЕСТЬ', installed: true,
      spec: { range: 120 },
    },
    {
      code: 'land', slot: 'computer', name: 'ПОСАДОЧНЫЙ КОМПЬЮТЕР',
      value: 'ЕСТЬ', installed: true,
      spec: { airless: true },
    },
    {
      code: 'scanner', slot: 'scanner', name: 'СКАНЕР',
      value: SCANNER_STEPS[SCANNER_STEPS.length - 1].toLocaleString('ru-RU') + ' км',
      installed: true,
      spec: { steps: SCANNER_STEPS },
    },
    gun(WEAPONS.laser_g, true),
    gun(WEAPONS.missile, false),
    gun(WEAPONS.turret, false),
    {
      code: 'gear', slot: 'gear', name: 'ШАССИ',
      value: SHIP.gearTime.toFixed(1) + ' с', installed: true,
      spec: { time: SHIP.gearTime, speed: SHIP.gearSpeed },
    },
    {
      code: 'hold', slot: 'hold', name: 'ТРЮМ',
      value: SHIP.hold + ' т', installed: true,
      spec: { tons: SHIP.hold },
    },
    {
      code: 'shield', slot: 'shield', name: 'ЩИТЫ',
      value: SHIP.maxShield > 0
        ? SHIP.maxShield + ' ед., +' + SHIP.shieldRegen + '/с через ' + SHIP.shieldDelay + ' с'
        : 'НЕТ',
      installed: SHIP.maxShield > 0,
      spec: { max: SHIP.maxShield, regen: SHIP.shieldRegen, delay: SHIP.shieldDelay },
    },
  ];
}
