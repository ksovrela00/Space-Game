// Что стоит на корабле: список модулей и их числа.
//
// Заведён отдельно, потому что читателей у него два и они в разных
// слоях: карточка корабля в меню (js/ui/menu.js) и сама игра (ступени
// сканера). Список ПУСТ ДО ЗАГРУЗКИ — гнёзда, их названия, цены и
// содержимое приходят из бэкенда (server/data/specs.php -> база ->
// `catalog.specs`).
//
// Числа модуль не хранит, а ЧИТАЕТ ИЗ ЛЁТНОЙ МОДЕЛИ: в бэкенде у него
// записано `reads: ['maxSpeed','accel','brake']`, то есть «покажи вот
// эти числа корабля». Копия была бы удобнее на один вечер и разъехалась
// бы на второй: в карточке одно, в полёте другое, и виноват всегда
// список.

import { SHIP } from './ship.js';
import { WEAPONS } from './weapons.js';
import { L, numLocale } from '../core/lang.js';

/**
 * Ступени дальности сканера, км.
 *
 * Это свойство ЖЕЛЕЗА, поэтому приезжает вместе с модулем сканера.
 * Прибор лишь выбирает ближайшую ступень, в которую помещается всё
 * вокруг (js/main.js), и поэтому game.scannerRange — текущий масштаб
 * кольца, а не дальность сканера. В карточке корабля стоит последняя
 * ступень — предел железа.
 *
 * Массив тот же самый, а не заменяется новым: его держит у себя main.js.
 */
export const SCANNER_STEPS = [];

/** Гнёзда и их содержимое, как их прислал бэкенд. */
export const MODULES = [];

/** Принять список модулей. */
export function applyModuleSpecs(list) {
  MODULES.length = 0;
  for (const m of list || []) MODULES.push(m);
  const scanner = MODULES.find((m) => m.code === 'scanner');
  SCANNER_STEPS.length = 0;
  for (const step of (scanner && scanner.spec && scanner.spec.steps) || []) SCANNER_STEPS.push(step);
  return MODULES;
}

/** Приехали ли модули. */
export const modulesReady = () => MODULES.length > 0;

/**
 * Числа модуля: свои плюс те, что он показывает из лётной модели.
 *
 * `reads` — имена, а не значения, поэтому карточка всегда показывает то,
 * по чему корабль летит ПРЯМО СЕЙЧАС. Поправили maxSpeed в базе — строка
 * в карточке поменялась вместе с полётом, без пересборки чего бы то ни
 * было.
 */
export function moduleSpec(m) {
  const spec = {};
  for (const [k, v] of Object.entries(m.spec || {})) {
    if (k !== 'reads') spec[k] = v;
  }
  for (const key of (m.spec && m.spec.reads) || []) spec[key] = SHIP[key];
  return spec;
}

/**
 * Как модуль подписан в карточке.
 *
 * Здесь остаётся только ФОРМА строки — «×3, 10 с», — а все числа в ней
 * из бэкенда. Формат держать в базе смысла нет: это оформление, оно
 * зависит от языка и от ширины панели, и его место в слое, который
 * рисует.
 *
 * Модуля, которого здесь нет, это не ломает: он покажется общим видом
 * «ключ: значение». Так новое гнездо, заведённое на сервере, попадает в
 * карточку вообще без правки игры.
 */
const CARD = {
  engine: (s) => s.maxSpeed.toFixed(2) + L(' км/с'),
  rcs: (s) => s.lateral.toFixed(2) + L(' км/с²'),
  lift: (s) => '×' + s.liftTWR + L(' к весу'),
  boost: (s) => '×' + s.boostMax + ', ' + s.boostBurn + L(' с'),
  quantum: (s) => (s.quantumSpeed / 1000).toFixed(0) + L(' тыс. км/с'),
  warp: () => L('МЕЖСИСТЕМНЫЙ'),
  dock: () => L('ЕСТЬ'),
  land: () => L('ЕСТЬ'),
  scanner: (s) => (s.steps && s.steps.length
    ? s.steps[s.steps.length - 1].toLocaleString(numLocale()) + L(' км')
    : L('НЕТ')),
  gear: (s) => s.gearTime.toFixed(1) + L(' с'),
  hold: (s) => s.hold + L(' т'),
  shield: (s) => (s.maxShield > 0
    ? s.maxShield + L(' ед., +') + s.shieldRegen + L('/с через ') + s.shieldDelay + L(' с')
    : L('НЕТ')),
};

/** Общий вид для модуля, о котором карточка ничего не знает. */
const plain = (spec) => Object.entries(spec)
  .map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join('/') : v))
  .join(', ');

/**
 * Строка оружия в карточке.
 *
 * Числа берутся из WEAPONS — того же места, откуда их берёт сам бой. В
 * карточке, где написано «3 урона», и в выстреле, который снимает четыре,
 * виноват всегда второй список.
 */
function gun(w) {
  return {
    code: w.code, slot: 'gun', name: L(w.name) + ' · ' + L(w.mountName),
    value: w.ready
      ? w.damage + ' × ' + w.rate + L('/с, до ') + w.range + L(' км')
      : L('ГНЕЗДО СВОБОДНО'),
    installed: !!w.ready,
    spec: {
      kind: w.kind, mount: w.mount, damage: w.damage, rate: w.rate,
      speed: w.speed, range: w.range, cone: w.cone,
    },
  };
}

/**
 * Модули корабля для карточки.
 *
 * Оружие идёт последним и одной группой: в бэкенде это отдельный список
 * (у пушки свои поля — урон, темп, конус), и вклинивать его в середину
 * значило бы задавать порядок дважды.
 */
export function modules() {
  const rows = MODULES.map((m) => {
    const spec = moduleSpec(m);
    const fmt = CARD[m.code];
    return {
      code: m.code,
      slot: m.slot,
      name: L(m.name),
      value: m.installed ? (fmt ? fmt(spec) : plain(spec)) : L('ГНЕЗДО СВОБОДНО'),
      installed: !!m.installed,
      spec,
    };
  });
  for (const w of Object.values(WEAPONS)) rows.push(gun(w));
  return rows;
}
