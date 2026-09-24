// Что стоит на корабле: гнёзда, модули и их числа.
//
// Модуль — это ПРЕДМЕТ, и числа принадлежат ему. Двигатель знает свою
// скорость, разгон и тормоз, щит — свою ёмкость, трюм — тоннаж, шасси —
// время выпуска. Корпусу остаётся только его собственное: прочность,
// бак, радиус попадания. Поэтому «другой двигатель, который летит
// быстрее» — это строка в базе, а не правка игры.
//
// Лётная модель корабля СОБИРАЕТСЯ: корпус, а поверх него числа всех
// установленных модулей (flightModel). Ровно так же её собирает сервер
// (server/src/Specs.php, mergeFlight) — разойдись эти две сборки, клиент
// и сервер по-разному ответили бы на вопрос, с какой скоростью летит
// один и тот же корабль, а в онлайне это решается не в пользу клиента.
//
// Списка два, и это не дубль:
//
//   MODULES — КАТАЛОГ: всё, что бывает, включая то, чего на корабле нет
//   (второй двигатель, оружие в разработке). Приходит с характеристиками
//   (`catalog.specs`), то есть из equipment_type.
//
//   INSTALLED — что стоит В ГНЁЗДАХ ЭТОГО корабля. Приходит с состоянием
//   пилота (`ship.equipment`), то есть из ship_equipment. Пока пилот не
//   вошёл — заводская комплектация из каталога, иначе в автономном режиме
//   корабль остался бы без двигателя вовсе.

import { WEAPONS } from './weapons.js';
import { L, numLocale } from '../core/lang.js';

/**
 * Ступени дальности сканера, км.
 *
 * Это свойство ЖЕЛЕЗА, поэтому приезжает вместе с модулем сканера — тем,
 * который стоит на корабле. Прибор лишь выбирает ближайшую ступень, в
 * которую помещается всё вокруг (js/main.js), и поэтому
 * game.scannerRange — текущий масштаб кольца, а не дальность сканера. В
 * карточке корабля стоит последняя ступень — предел железа.
 *
 * Массив тот же самый, а не заменяется новым: его держит у себя main.js.
 */
export const SCANNER_STEPS = [];

/** Каталог: всё снаряжение, какое бывает. */
export const MODULES = [];

/** Что стоит в гнёздах этого корабля. */
const INSTALLED = [];

/** Заводская комплектация из каталога: то, что помечено `installed`. */
const factory = () => MODULES.filter((m) => m.installed);

/**
 * Разложить установленное.
 *
 * Ступени сканера обновляются здесь же: сменили сканер — сменились и они,
 * а второго места, где они бы «тоже обновлялись», нет.
 */
function setInstalled(list) {
  INSTALLED.length = 0;
  for (const m of list || []) INSTALLED.push(m);
  const scanner = INSTALLED.find((m) => m.slot === 'scanner');
  SCANNER_STEPS.length = 0;
  for (const step of (scanner && scanner.spec && scanner.spec.steps) || []) SCANNER_STEPS.push(step);
}

/** Принять каталог. Пока сервер не сказал иного — комплектация заводская. */
export function applyModuleSpecs(list) {
  MODULES.length = 0;
  for (const m of list || []) MODULES.push(m);
  setInstalled(factory());
  return MODULES;
}

/**
 * Принять то, что стоит на КОНКРЕТНОМ корабле (`ship.equipment`).
 *
 * Строки приходят из ship_equipment со своими числами, поэтому берутся
 * как есть, а не разыскиваются в каталоге: если пилоту поставили
 * двигатель, которого в каталоге уже нет, корабль всё равно обязан лететь
 * по тому, что на нём стоит.
 */
export function applyShipEquipment(list) {
  if (!Array.isArray(list) || !list.length) return INSTALLED;
  setInstalled(list.map((e) => ({
    code: e.code, name: e.name, slot: e.slot, spec: e.spec || {}, installed: true,
  })));
  return INSTALLED;
}

/** Что стоит в гнёздах. */
export const installedModules = () => INSTALLED;

/** Модуль в этом гнезде (первый, если их там несколько). */
export const installedIn = (slot) => INSTALLED.find((m) => m.slot === slot) || null;

/** Приехали ли модули. */
export const modulesReady = () => MODULES.length > 0;

/**
 * Лётная модель: корпус, а поверх — числа установленных модулей.
 *
 * Пустое гнездо не даёт ничего, и это не недосмотр: без двигателя не
 * летают. Число, которого нет, даст NaN на первом же кадре — это видно
 * сразу, в отличие от тихой подстановки «значения по умолчанию».
 */
export function flightModel(hull) {
  const out = { ...(hull || {}) };
  for (const m of INSTALLED) {
    for (const [k, v] of Object.entries((m.spec && m.spec.flight) || {})) out[k] = v;
  }
  return out;
}

/**
 * Числа модуля для карточки: то, что он даёт кораблю, плюс его
 * собственные настройки.
 *
 * `flight` разворачивается наверх, а не показывается вложенным: в
 * карточке это такие же числа модуля, как дальность у компьютера.
 */
export function moduleSpec(m) {
  const spec = {};
  for (const [k, v] of Object.entries((m && m.spec) || {})) {
    if (k !== 'flight') spec[k] = v;
  }
  for (const [k, v] of Object.entries((m && m.spec && m.spec.flight) || {})) spec[k] = v;
  return spec;
}

/**
 * Как модуль подписан в карточке.
 *
 * Ключ — ГНЕЗДО, а не код модуля: видов на одно гнездо бывает много
 * (два двигателя), а строка у них одна и та же — меняются только числа.
 * Здесь остаётся только ФОРМА строки, «×3, 10 с», а все числа в ней из
 * базы: формат зависит от языка и ширины панели, и его место в слое,
 * который рисует.
 *
 * Гнезда, которого здесь нет, это не ломает: оно покажется общим видом
 * «ключ: значение». Так новое гнездо, заведённое на сервере, попадает в
 * карточку вообще без правки игры.
 */
const CARD = {
  engine: (s) => s.maxSpeed.toFixed(2) + L(' км/с'),
  rcs: (s) => s.lateral.toFixed(2) + L(' км/с²'),
  lift: (s) => '×' + s.liftTWR + L(' к весу'),
  boost: (s) => '×' + s.boostMax + ', ' + s.boostBurn + L(' с'),
  drive: (s) => (s.quantumSpeed / 1000).toFixed(0) + L(' тыс. км/с'),
  warp: () => L('МЕЖСИСТЕМНЫЙ'),
  computer: () => L('ЕСТЬ'),
  scanner: (s) => (s.steps && s.steps.length
    ? s.steps[s.steps.length - 1].toLocaleString(numLocale()) + L(' км')
    : L('НЕТ')),
  gear: (s) => s.gearTime.toFixed(1) + L(' с'),
  lamp: (s) => s.range + L(' км, ') + s.coneDeg + '°/' + s.wideDeg + '°',
  hold: (s) => s.hold + L(' т'),
  shield: (s) => (s.maxShield > 0
    ? s.maxShield + L(' ед., +') + s.shieldRegen + L('/с через ') + s.shieldDelay + L(' с')
    : L('НЕТ')),
};

/** Общий вид для гнезда, о котором карточка ничего не знает. */
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
 * Снаряжение корабля для карточки.
 *
 * Идём по ГНЁЗДАМ каталога, а показываем то, что в них стоит: иначе
 * второй двигатель, которого на корабле нет, занимал бы в карточке свою
 * строку и читался как поломка. Пустое гнездо показывается тоже — пустая
 * строка читается как сломанный прибор, а «ГНЕЗДО СВОБОДНО» как
 * приглашение его занять.
 *
 * Оружие идёт последним и одной группой: в бэкенде это отдельный список
 * (у пушки свои поля — урон, темп, конус), и вклинивать его в середину
 * значило бы задавать порядок дважды.
 */
export function modules() {
  const rows = [];
  const seen = new Set();
  for (const cat of MODULES) {
    if (cat.slot === 'gun' || seen.has(cat.slot)) continue;
    seen.add(cat.slot);
    const here = INSTALLED.filter((m) => m.slot === cat.slot);
    const fmt = CARD[cat.slot];
    if (!here.length) {
      rows.push({
        code: cat.code, slot: cat.slot, name: L(cat.name),
        value: L('ГНЕЗДО СВОБОДНО'), installed: false, spec: {},
      });
      continue;
    }
    for (const m of here) {
      const spec = moduleSpec(m);
      let value;
      try {
        value = fmt ? fmt(spec) : plain(spec);
      } catch (e) {
        // Числа этого модуля не читаются. Случай не выдуманный: они лежат
        // в базе, их правят руками, и одной опечатки в JSON хватает. Про
        // такой модуль надо сказать прямо — но не всей карточкой: рядом
        // десяток исправных приборов, и пилоту они нужны.
        value = L('ЧИСЛА НЕ ЧИТАЮТСЯ');
      }
      rows.push({
        code: m.code,
        slot: m.slot,
        name: L(m.name),
        value,
        installed: true,
        spec,
      });
    }
  }
  for (const w of Object.values(WEAPONS)) rows.push(gun(w));
  return rows;
}
