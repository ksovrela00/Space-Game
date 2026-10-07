// Разделы порта в бортовом терминале: порт, рынок, верфь, корабли.
//
// Терминал в порту открывается сам, как только корабль встал, и живёт,
// пока он там стоит (рамка — js/ui/terminal.js). Разделов четыре — то,
// зачем в порт вообще летают:
//
//   ПОРТ     что это за станция и что нужно кораблю перед вылетом:
//            топливо, ремонт, трюм — с кнопками прямо здесь
//   РЫНОК    товары на перевозку: список слева, сделка справа
//   ОСНАЩЕНИЕ модули по гнёздам: что стоит, что предлагают, и чем
//            предложенное лучше или хуже стоящего — числами
//   ВЕРФЬ    свои корабли в доке, корабли на продажу, ангар
//
// Рядом с ними в порту — разделы пилота (js/ui/menu.js): трюм, подряды,
// финансы. Одно окно на всё, а не два меню, каждое со своими клавишами.
//
// Заправка и ремонт раньше были отдельным разделом. Это два самых частых
// дела в порту, и делают их перед вылетом — поэтому они переехали на
// первый раздел, который открывается при стыковке.
//
// Цены, склады, остаток крон и то, что станет с кораблём после замены
// модуля, считает СЕРВЕР (server/src/Market.php, Outfit.php, Fuel.php).
// Здесь только показ его ответов и «что и сколько»: ни одной цены,
// посчитанной на месте, кроме произведения цены на тонны в подписи кнопки.
// Посчитай их игра — и первый же желающий купил бы тысячу тонн за крону.

import { fmtDist } from './hud.js';
import { KIND_RU } from './screens.js';
import { SHIP } from '../game/ship.js';
import { cargoTons, applyServer } from '../game/player.js';
import { fuelCap, fuelReserve, fuelLevel, warpRange } from '../game/fuel.js';
import { useShipEquipment, specsDoc, typeSpec } from '../game/specs.js';
import { describeModule, moduleDetail, moduleSpec } from '../game/loadout.js';
import { say } from '../game/state.js';
import {
  session, isOnline, refuel as serverRefuel, buyGoods, sellGoods,
  buyModule, sellModule, buyHull, readPort,
} from '../net/session.js';
import { stations as apiStations } from '../net/api.js';
import { L, numLocale } from '../core/lang.js';
import { esc, kr, t1, btn, meter, kv, empty, head } from './termkit.js';
import { SLOT_GROUPS, groupOf, hullState } from './menu.js';

// «Оснащение» — модули, «верфь» — корабли: так их зовут в космосимах, и
// закладка «КОРАБЛИ» не встаёт рядом с «КОРАБЛЕМ» пилота.
export const TABS = [['port', 'ПОРТ'], ['market', 'РЫНОК'], ['outfit', 'ОСНАЩЕНИЕ'], ['ships', 'ВЕРФЬ']];

// Подписи гнёзд на верфи. Ключ — гнездо, а не модуль: видов на гнездо
// бывает несколько, и заголовок у них один.
const SLOT = {
  engine: 'МАРШЕВЫЙ ДВИГАТЕЛЬ', rcs: 'МАНЕВРОВЫЕ', lift: 'ПОДЪЁМНЫЕ ДВИГАТЕЛИ',
  boost: 'ФОРСАЖ', drive: 'КВАНТОВЫЙ ПРИВОД', warp: 'ВАРП-ПРИВОД', tank: 'ДОПОЛНИТЕЛЬНЫЙ БАК',
  hold: 'ТРЮМ', shield: 'ЩИТЫ', scanner: 'СКАНЕР', computer: 'КОМПЬЮТЕРЫ', lamp: 'ФАРЫ',
  gear: 'ШАССИ',
};

/** Состояние порта: ответы сервера, занятость, выбор на рынке и верфи. */
export const makeStation = () => ({
  at: null,          // в каком порту собраны ответы ниже
  market: null,      // прайс: {goods, station, fuelPrice}
  outfit: null,      // верфь: {open, slots, resale}
  ships: null,       // верфь корпусов: {open, tech, hulls, here, hangar}
  yards: null,       // порты системы с верфью — для «здесь верфи нет»
  err: {},           // почему раздел не загрузился
  busy: false,       // запрос в пути: кнопки заперты
  note: '',
  noteKind: '',      // '' | 'good' | 'warn'
  good: null,        // рынок: выбранный товар (код)
  side: 'buy',       // рынок: 'buy' | 'sell'
  qty: null,         // рынок: тонн в сделке; null — по умолчанию стороны
  slot: null,        // верфь: выбранное гнездо
  arm: null,         // дорогая кнопка, ждущая второго нажатия
});

const st = (game) => game.station || (game.station = makeStation());

// Имя корпуса по коду — из каталога (js/game/specs.js).
const hullName = (code) => {
  const t = specsDoc() && specsDoc().shipTypes.find((x) => x.code === code);
  return t ? t.name : code;
};

/**
 * Перерисовать терминал. Сам он здесь не виден (рамка импортирует этот
 * модуль, а не наоборот), поэтому зовём то, что рамка оставила в
 * game.menu, — или просто помечаем, и рамка перерисует в кадре.
 */
function redraw(game) {
  if (!game.menu) return;
  game.menu.dirty = true;
  if (game.menu.paint) game.menu.paint();
}

// --- обмен с сервером ------------------------------------------------------------

/**
 * Разложить свежее состояние пилота по игре: деньги и трюм, модули, бак,
 * корпус. После верфи меняется сама лётная модель — модули пересобирают
 * корабль (js/game/specs.js), — и бак с щитом обязаны встать в её пределы.
 */
export function syncFromServer(game, state = session.player) {
  if (!state) return;
  applyServer(game.player, state);
  const sh = state.ship || {};
  if (Array.isArray(sh.equipment) && sh.equipment.length) useShipEquipment(sh.equipment);
  if (typeof sh.fuelT === 'number') game.ship.fuel = Math.min(sh.fuelT, fuelCap());
  if (typeof sh.hull === 'number') game.ship.hull = sh.hull;
  if (typeof sh.shield === 'number') game.ship.shield = Math.min(sh.shield, SHIP.maxShield || 0);
}

/** Какой ответ сервера нужен разделу. Трюм в порту — ради здешних цен. */
const NEED = { port: 'market', market: 'market', cargo: 'market', outfit: 'outfit', ships: 'ships' };

/** Догрузить то, что нужно открытому разделу. Повторный вызов ничего не шлёт. */
export function stationLoad(game, tab) {
  const s = st(game);
  // Связь пропала — запрос подождёт: раздел перерисуют, когда она вернётся.
  if (!isOnline()) return;
  const need = NEED[tab];
  if (!need || s[need] || s.err[need] === 'loading') return;
  s.err[need] = 'loading';
  const at = s.at;
  readPort(need).then((r) => {
    if (st(game).at !== at) return;               // пока ждали, улетели
    s[need] = r;
    s.err[need] = null;
    if ((need === 'outfit' || need === 'ships') && r && !r.open && !s.yards) loadYards(game);
    redraw(game);
  }).catch((e) => {
    s.err[need] = e.message || String(e);
    redraw(game);
  });
}

/** Где в этой системе есть верфь — чтобы «здесь нет» не было тупиком. */
function loadYards(game) {
  const s = st(game);
  s.yards = [];
  apiStations(game.sys.id).then((r) => {
    s.yards = (r.stations || []).filter((x) => x.services && x.services.outfit).map((x) => x.name);
    redraw(game);
  }).catch(() => { /* список — подсказка, без него раздел всё равно цел */ });
}

/**
 * Забыть ответы сервера о порту: прайс, верфь, корабли дока. Они — про
 * КОРАБЛЬ, а не только про порт: верфь показывает его модули, прайс — его
 * трюм, список кораблей — в чьём кресле пилот. После пересадки они чужие:
 * экран показывал «Прометей» с кнопкой «пересесть», в который пилот уже
 * пересел, и модули «Челленджера» на верфи — и казалось, что пересадки не
 * было.
 */
export function forgetPort(game) {
  const s = st(game);
  s.market = null;
  s.outfit = null;
  s.ships = null;
  s.err = {};
}

/**
 * Действие с ценой: заправка, сделка, модуль.
 *
 * Кнопки на время запроса запираются: второй щелчок по «купить» до
 * ответа на первый — это вторая покупка, а не нетерпение.
 */
async function run(game, fn, done) {
  const s = st(game);
  if (s.busy) return;
  s.busy = true;
  s.arm = null;
  s.note = L('ЗАПРОС…');
  s.noteKind = '';
  redraw(game);
  try {
    const r = await fn();
    syncFromServer(game);
    s.note = done(r);
    s.noteKind = 'good';
    s.qty = null;
    say(game.state, s.note, '#78e08f', 3);
  } catch (e) {
    s.note = L('ОТКАЗ: ') + (e.message || String(e));
    s.noteKind = 'warn';
  } finally {
    s.busy = false;
    // Склады и верфь после сделки другие: перечитываем то, что открыто.
    forgetPort(game);
    redraw(game);
  }
}

// --- рынок: пределы сделки ---------------------------------------------------------

const floor1 = (v) => Math.floor(v * 10 + 1e-6) / 10;

/**
 * Сколько можно купить и продать и ЧТО держит предел: склад, трюм или
 * деньги. Причина пишется под кнопкой словами — запертая кнопка без
 * объяснения читается как поломка.
 */
export function tradeLimits(game, g) {
  const hold = SHIP.hold || 0;
  const free = Math.max(0, hold - cargoTons(game.player));
  const money = Math.max(0, game.player.balance);
  const byMoney = g.price > 0 ? money / g.price : Infinity;
  const have = game.player.cargo.find((c) => c.code === g.code);
  const held = have ? have.tons : 0;
  const lim = [['stock', g.stock], ['room', free], ['money', byMoney]].sort((a, b) => a[1] - b[1])[0];
  return { buyMax: floor1(Math.min(g.stock, free, byMoney)), why: lim[0], held, have, free, money };
}

/** Тонн в сделке: выбранное игроком или то, с чего сторона начинается. */
function tradeQty(s, lim) {
  const max = s.side === 'sell' ? lim.held : lim.buyMax;
  const q = s.qty === null ? (s.side === 'sell' ? lim.held : Math.min(10, lim.buyMax)) : s.qty;
  return Math.max(0, Math.min(max, q));
}

const goodOf = (s) => (s.market ? s.market.goods.find((g) => g.code === s.good) || null : null);

/** Выбрать товар: сторона сделки — продажа, если он уже в трюме. */
function pickGood(game, code) {
  const s = st(game);
  s.good = code;
  const g = goodOf(s);
  s.side = g && tradeLimits(game, g).held > 0 ? 'sell' : 'buy';
  s.qty = null;
}

// --- действия ----------------------------------------------------------------

/**
 * Разобрать нажатие. Отдельной функцией, а не внутри обработчика щелчка:
 * так её зовут и клавиши, и проверки, у которых нет настоящего DOM.
 */
export function stationAct(game, act, arg = {}) {
  const s = st(game);
  if (act === 'tab') {
    if (game.menu) game.menu.tab = arg.tab;
    s.note = '';
    s.arm = null;
    redraw(game);
    return true;
  }
  if (act === 'launch') { game.launch(true); return true; }
  if (act === 'stand') { if (game.rise) game.rise(); return true; }
  if (act === 'map') { game.openMap(); return true; }
  if (act === 'repair') { if (!s.busy) game.repair(); return true; }
  // Выбор и подготовка сделки — не запросы: работают и пока сервер думает.
  if (act === 'good') { pickGood(game, arg.code); s.arm = null; redraw(game); return true; }
  if (act === 'side') { s.side = arg.side === 'sell' ? 'sell' : 'buy'; s.qty = null; redraw(game); return true; }
  if (act === 'qty' || act === 'qset') {
    const g = goodOf(s);
    if (!g) return true;
    const lim = tradeLimits(game, g);
    const max = s.side === 'sell' ? lim.held : lim.buyMax;
    let q = act === 'qty' ? tradeQty(s, lim) + (+arg.d || 0)
      : (arg.v === 'max' ? max : +arg.v);
    q = Math.round(Math.max(0, Math.min(max, q)) * 10) / 10;
    s.qty = q;
    redraw(game);
    return true;
  }
  if (act === 'slot') { s.slot = arg.slot; s.arm = null; redraw(game); return true; }
  // Дорогая кнопка: первое нажатие только взводит её, второе — делает.
  if (act === 'arm') { s.arm = arg.key; redraw(game); return true; }
  if (s.busy) return false;
  if (act === 'trade') {
    const g = goodOf(s);
    if (!g) return false;
    const lim = tradeLimits(game, g);
    let tons = tradeQty(s, lim);
    if (!(tons > 0)) return false;
    // «Всё» — ровно столько, сколько лежит, а не округлённое вниз: иначе
    // в трюме оставались бы сотые доли тонны.
    if (s.side === 'sell' && tons >= lim.held - 0.05) tons = lim.held;
    return stationAct(game, s.side, { code: g.code, name: g.name, tons });
  }
  const tons = +arg.tons;
  if (act === 'buy' && tons > 0) {
    run(game, () => buyGoods(arg.code, tons),
      (r) => L('КУПЛЕНО: ') + L(arg.name || arg.code) + ', ' + t1(r.tons) + ' · ' + kr(r.sum));
    return true;
  }
  if (act === 'sell' && tons > 0) {
    run(game, () => sellGoods(arg.code, tons),
      (r) => L('ПРОДАНО: ') + L(arg.name || arg.code) + ', ' + t1(r.tons) + ' · ' + kr(r.sum, true));
    return true;
  }
  if (act === 'fit') {
    run(game, () => buyModule(arg.code),
      (r) => L('УСТАНОВЛЕНО: ') + L(arg.name || arg.code) + ' · ' + kr(-r.cost));
    return true;
  }
  if (act === 'unfit') {
    run(game, () => sellModule(arg.code),
      (r) => L('ПРОДАНО: ') + L(arg.name || arg.code) + ' · ' + kr(r.credit + (r.refund || 0), true));
    return true;
  }
  if (act === 'hull') {
    run(game, () => buyHull(arg.code),
      () => L('КУПЛЕН КОРАБЛЬ: ') + (arg.name || arg.code) + ' · ' + kr(-arg.price) + L(' · ОН В ЭТОМ ДОКЕ'));
    return true;
  }
  if (act === 'rover') {
    // Вездеход покупают тем же вызовом верфи, что корабль (Shipyard::buy):
    // встаёт он не в док, а в трюм того корабля, которым командуют.
    run(game, () => buyHull(arg.code),
      () => L('КУПЛЕН ВЕЗДЕХОД: ') + (arg.name || arg.code) + ' · ' + kr(-arg.price) + L(' · ОН В ТРЮМЕ'));
    return true;
  }
  if (act === 'retrieve') {
    // Вызов из хранилища пешком, у пульта: пилот остаётся на ногах (js/main.js).
    if (!game.retrieveShip) return true;
    s.busy = true;
    s.note = L('ЗАПРОС…');
    s.noteKind = '';
    redraw(game);
    Promise.resolve(game.retrieveShip(+arg.id)).finally(() => {
      s.busy = false;
      s.note = '';
      forgetPort(game);
      redraw(game);
    });
    return true;
  }
  if (act === 'path') {
    // К кораблю на площадке — путь по станции; терминал закрывается.
    if (game.setWalkGoal) game.setWalkGoal('pad' + arg.pad);
    if (game.closeTerminal) game.closeTerminal();
    return true;
  }
  if (act === 'board') {
    // Пересесть — не сделка, а смена корабля: её ведёт игра (js/main.js),
    // и она же забывает ответы о прежнем корабле (forgetPort). Кнопки на
    // время пересадки заперты: второй щелчок ушёл бы вдогонку первому.
    if (!game.switchShip) return true;
    s.busy = true;
    s.note = L('ЗАПРОС…');
    s.noteKind = '';
    redraw(game);
    Promise.resolve(game.switchShip(+arg.id)).finally(() => {
      s.busy = false;
      s.note = '';
      forgetPort(game);
      redraw(game);
    });
    return true;
  }
  if (act === 'refuel') {
    run(game, () => serverRefuel(arg.tons === undefined || arg.tons === 'full' ? null : tons),
      (r) => L('ЗАПРАВКА: ') + t1(r.tons) + ' · ' + kr(-r.cost));
    return true;
  }
  return false;
}

/** Порядок строк раздела — для ↑/↓ (js/ui/terminal.js). */
export function stationRows(game, tab) {
  const s = st(game);
  if (tab === 'market' && s.market) return { act: 'good', keys: s.market.goods.map((g) => g.code), cur: s.good };
  if (tab === 'outfit' && s.outfit) return { act: 'slot', keys: slotOrder(s.outfit).map((x) => x.slot), cur: s.slot };
  return null;
}

// --- общее -----------------------------------------------------------------------

const loading = (what) => `<p class="hint">${esc(what)}</p>`;
const failed = (msg) => `<p class="warn">${esc(msg)}</p>`;

/** Верфи здесь нет: где она есть — чтобы это не было тупиком. */
function noYard(s, tech, what) {
  const where = s.yards && s.yards.length ? L(' Верфь в этой системе: ') + s.yards.join(', ') + '.' : '';
  return `<div class="banner warn"><b>${esc(L('ВЕРФИ ЗДЕСЬ НЕТ'))}</b><span>${esc(L(what) + tech + '.' + where)}</span></div>`;
}

// --- ПОРТ ------------------------------------------------------------------------

function portTab(game) {
  const s = st(game);
  const ship = game.ship;
  const station = ship.dockedAt;
  const planet = station ? station.parent : null;
  const port = game.port;
  const svc = port && port.services ? port.services : {};

  // Услуги — значками, а включённые ещё и ведут в свой раздел: «рынок
  // есть» и «на рынок» — одно нажатие, а не поиск закладки.
  const chips = [
    ['market', 'рынок', svc.market, 'market'], ['outfit', 'верфь', svc.outfit, 'outfit'],
    ['repair', 'ремонт', svc.repair, null], ['fuel', 'заправка', true, null], ['board', 'подряды', svc.board, null],
  ].map(([, name, on, tab]) => (on && tab
    ? `<button class="chip on" data-act="tab" data-tab="${tab}">${esc(L(name))} ›</button>`
    : `<span class="chip ${on ? 'on' : 'off'}">${esc(L(name))}</span>`)).join('');

  const tech = port ? port.tech : 0;
  const techBar = port ? `<span class="pips">${'■'.repeat(tech)}<i>${'■'.repeat(Math.max(0, 5 - tech))}</i></span> ${tech} ${esc(L('из 5'))}` : '—';
  const info = `<section class="card">
    ${head(L('СТАНЦИЯ'))}
    <dl class="kv">
      <dt>${esc(L('Планета'))}</dt><dd>${esc(planet ? planet.name : '—')}</dd>
      <dt>${esc(L('Тип'))}</dt><dd>${esc(planet ? L(KIND_RU[planet.kind] || planet.kind) : '—')}</dd>
      <dt>${esc(L('Высота орбиты'))}</dt><dd>${esc(station && planet ? fmtDist(station.orbit.radius - planet.radius) : '—')}</dd>
      <dt>${esc(L('Уровень порта'))}</dt><dd>${techBar}</dd>
      <dt>${esc(L('Сбор за место'))}</dt><dd>${esc(port ? kr(port.fee) : '—')}</dd>
      <dt>${esc(L('Стыковок выполнено'))}</dt><dd>${esc(String(game.stats.docks))}</dd>
    </dl>
    <div class="chips">${chips}</div>
  </section>`;

  return `<div class="cols2"><div class="stack">${preflight(game, s)}</div><div class="stack">${info}</div></div>`;
}

/**
 * Перед вылетом: бак, корпус, трюм — то, что проверяют, прежде чем
 * отдать швартовы, и с кнопками прямо здесь.
 */
function preflight(game, s) {
  const ship = game.ship;
  const cap = fuelCap();
  const reserve = fuelReserve();
  const lvl = fuelLevel(ship);
  const cls = lvl === 'ok' ? 'cy' : (lvl === 'low' ? 'low' : 'bad');
  const ranges = L('Варп — до ') + warpRange(ship).toFixed(1) + L(' св. г., квантовый ход — до ')
    + (SHIP.quantumFuel > 0 ? (Math.max(0, ship.fuel - reserve) / SHIP.quantumFuel).toFixed(0) : '—') + L(' млн км.');

  let fuelActs;
  if (s.err.market && s.err.market !== 'loading') fuelActs = failed(s.err.market);
  else if (!s.market) fuelActs = loading(L('ЗАПРАШИВАЕМ ЦЕНУ…'));
  else {
    const price = s.market.fuelPrice;
    const room = Math.max(0, cap - ship.fuel);
    const money = game.player.balance;
    const afford = Math.floor(Math.min(room, price > 0 ? money / price : 0) * 10) / 10;
    const full = Math.ceil(room * price - 1e-9);
    fuelActs = room < 0.001
      ? `<p class="good">${esc(L('БАК ПОЛОН'))}</p>`
      : `<div class="acts">${
        btn(esc(L('ДО ПОЛНОГО · ') + t1(room) + ' · ' + kr(full)), 'refuel', { tons: 'full' }, 'pri',
          s.busy || money < full)}${
        btn(esc('+1 ' + L('т') + ' · ' + kr(price)), 'refuel', { tons: 1 }, '', s.busy || money < price)}${
        money < full && afford >= 0.1
          ? btn(esc(L('НА ВСЕ ДЕНЬГИ · ') + t1(afford)), 'refuel', { tons: afford }, '', s.busy) : ''}</div>
        <p class="hint">${esc(L('Водород: тонна стоит здесь ') + kr(price) + L(' — как на рынке порта.'))}</p>`;
  }

  // Ремонт: стоимость — пропавшие единицы корпуса по ставке порта, ровно
  // как считает сервер (Stations::repair).
  const port = game.port;
  const h = hullState(ship);
  const damage = Math.max(0, (SHIP.maxHull || 100) - ship.hull);
  let repair;
  if (damage <= 0.01) repair = `<p class="good">${esc(L('Корпус цел.'))}</p>`;
  else if (!port || !port.services || !port.services.repair) {
    repair = `<p class="warn">${esc(L('Корпус повреждён, а чинить здесь нечем: нужен порт с мастерской.'))}</p>`;
  } else {
    const cost = Math.ceil(damage * port.repairRate);
    repair = `<div class="acts">${btn(esc(L('РЕМОНТ · ') + kr(cost)), 'repair', {}, 'pri',
      s.busy || game.player.balance < cost)}</div>`;
  }

  const used = cargoTons(game.player);
  const hold = SHIP.hold || 0;
  return `<section class="card">
    ${head(L('ПЕРЕД ВЫЛЕТОМ'))}
    <div class="gauge"><span>${esc(L('ТОПЛИВО'))}</span><b class="${cls === 'cy' ? '' : cls}">${esc(t1(ship.fuel) + ' / ' + t1(cap))}</b></div>
    ${meter(cap > 0 ? ship.fuel / cap : 0, cls, cap > 0 ? reserve / cap : null)}
    <p class="hint">${esc(ranges)} ${esc(L('Красная черта — резерв: ниже неё прыжков нет.'))}</p>
    ${fuelActs}
    <div class="gauge sp"><span>${esc(L('КОРПУС'))}</span><b class="${h.cls}">${h.pct} %</b></div>
    ${meter(h.f, h.cls)}
    ${repair}
    <div class="gauge sp"><span>${esc(L('ТРЮМ'))}</span><b>${esc(t1(used) + ' / ' + t1(hold))}</b></div>
    ${meter(hold > 0 ? used / hold : 0, used >= hold - 1e-6 ? 'low' : 'cy')}
    <div class="acts">${btn(esc(L('НА РЫНОК ›')), 'tab', { tab: 'market' })}${used > 0 ? btn(esc(L('ЧТО В ТРЮМЕ ›')), 'tab', { tab: 'cargo' }) : ''}</div>
  </section>`;
}

// --- РЫНОК -----------------------------------------------------------------------

/** Цена против средней по галактике: дёшево — покупать, дорого — продавать. */
function trend(g) {
  if (!(g.base_price > 0)) return { text: '—', cls: 'dim', word: '' };
  const d = g.price / g.base_price - 1;
  const p = Math.round(Math.abs(d) * 100);
  if (p < 5) return { text: '≈', cls: 'dim', word: L('около средней по галактике') };
  return d < 0
    ? { text: '▼ ' + p + '%', cls: 'good', word: L('на ') + p + L('% дешевле средней — здесь выгодно покупать') }
    : { text: '▲ ' + p + '%', cls: 'warn', word: L('на ') + p + L('% дороже средней — здесь выгодно продавать') };
}

function marketTab(game) {
  const s = st(game);
  if (s.err.market && s.err.market !== 'loading') return failed(s.err.market);
  if (!s.market) return loading(L('ЗАПРАШИВАЕМ БИРЖУ…'));
  const goods = s.market.goods;
  if (!goodOf(s) && goods.length) {
    // Первым выбран то, что уже лежит в трюме: в порт чаще прилетают
    // продавать, — а нет такого, то первый товар со склада.
    const mine = goods.find((g) => game.player.cargo.some((c) => c.code === g.code));
    pickGood(game, (mine || goods.find((g) => g.stock > 0) || goods[0]).code);
  }
  const held = new Map(game.player.cargo.map((c) => [c.code, c]));
  const rows = goods.map((g) => {
    const tr = trend(g);
    const h = held.get(g.code);
    return `<tr class="row${g.code === s.good ? ' sel' : ''}${g.legal ? '' : ' illegal'}" data-act="good" data-code="${esc(g.code)}">
      <td><span class="nm">${esc(L(g.name))}</span><span class="sub">${esc(L(g.category))}${g.legal ? '' : ' · ' + esc(L('запрещено'))}</span></td>
      <td class="n">${esc(kr(g.price))}</td><td class="n opt ${tr.cls}">${esc(tr.text)}</td>
      <td class="n${g.stock > 0 ? '' : ' dim'}">${g.stock > 0 ? esc(t1(g.stock)) : '—'}</td>
      <td class="n">${h ? `<b>${esc(t1(h.tons))}</b>` : '<span class="dim">—</span>'}</td></tr>`;
  }).join('');
  const list = `<p class="hint">${esc(L('Цена одна на покупку и продажу. ▼ — дешевле средней по галактике, ▲ — дороже.'))}</p>
    <table class="lt"><thead><tr><th>${esc(L('ТОВАР'))}</th><th class="n">${esc(L('ЦЕНА ЗА Т'))}</th><th class="n opt">${
    esc(L('К СРЕДНЕЙ'))}</th><th class="n">${esc(L('СКЛАД'))}</th><th class="n">${esc(L('В ТРЮМЕ'))}</th></tr></thead><tbody>${rows}</tbody></table>`;
  const g = goodOf(s);
  return `<div class="split"><div>${list}</div><aside class="detail scroll">${g ? tradePanel(game, s, g) : ''}</aside></div>`;
}

/** Сделка с выбранным товаром: что он такое, сколько, почём и почему не больше. */
function tradePanel(game, s, g) {
  const lim = tradeLimits(game, g);
  const tr = trend(g);
  const sell = s.side === 'sell';
  const q = tradeQty(s, lim);
  const max = sell ? lim.held : lim.buyMax;
  const gain = lim.have && lim.have.avgPrice > 0 ? (g.price - lim.have.avgPrice) * lim.held : null;
  const facts = kv([
    [L('На складе'), g.stock > 0 ? t1(g.stock) : L('пусто'), g.stock > 0 ? '' : 'dim'],
    [L('В трюме'), lim.held > 0 ? t1(lim.held) : '—'],
    lim.have && lim.have.avgPrice > 0 ? [L('Куплено по'), kr(lim.have.avgPrice)] : null,
    gain !== null ? [L('Продать всё — итог рейса'), kr(gain, true), gain >= 0 ? 'good' : 'bad'] : null,
  ]);
  const seg = `<div class="seg">${btn(esc(L('КУПИТЬ')), 'side', { side: 'buy' }, sell ? '' : 'on')}${
    btn(esc(L('ПРОДАТЬ')), 'side', { side: 'sell' }, sell ? 'on' : '', lim.held <= 0)}</div>`;
  const step = `<div class="qty">${btn('−', 'qty', { d: -1 }, 'sq', s.busy || q <= 0)}<b class="v">${esc(t1(q))}</b>${
    btn('+', 'qty', { d: 1 }, 'sq', s.busy || q >= max)}</div>`;
  const presets = `<div class="presets">${btn('1 ' + esc(L('т')), 'qset', { v: 1 }, 'sm', max < 1)}${
    btn('10 ' + esc(L('т')), 'qset', { v: 10 }, 'sm', max < 10)}${
    btn(esc((sell ? L('ВСЁ') : L('МАКС')) + ' · ' + t1(max)), 'qset', { v: 'max' }, 'sm', max < 0.1)}</div>`;
  // Почему не больше: держит склад, трюм или деньги.
  let why = '';
  if (!sell) {
    why = max < 0.1
      ? ({ stock: L('Склад пуст — купить нечего.'), room: L('Трюм полон: сначала продайте груз.'),
        money: L('Не хватает крон даже на десятую тонны.') })[lim.why]
      : ({ stock: L('Предел — склад порта: ') + t1(g.stock), room: L('Предел — свободное место в трюме: ') + t1(lim.free),
        money: L('Предел — деньги на счету: хватит на ') + t1(lim.buyMax) })[lim.why];
  }
  const sum = q * g.price;
  const go = btn(esc((sell ? L('ПРОДАТЬ ') : L('КУПИТЬ ')) + t1(q) + ' · ' + (sell ? kr(sum, true) : kr(-sum))),
    'trade', {}, 'pri wide', s.busy || q < 0.1);
  return `<div class="dh"><span class="kick">${esc(L(g.category))}</span><h3>${esc(L(g.name))}</h3></div>
    ${g.legal ? '' : `<p class="warn">${esc(L('Запрещённый товар: возить его — риск.'))}</p>`}
    <div class="price"><b>${esc(kr(g.price))}</b><span>${esc(L('за тонну'))}</span></div>
    ${tr.word ? `<p class="${tr.cls}">${esc(tr.word)}</p>` : ''}
    ${facts}${seg}${step}${presets}${why ? `<p class="hint">${esc(why)}</p>` : ''}${go}`;
}

// --- ВЕРФЬ -------------------------------------------------------------------------

/**
 * Числа, по которым сравнивают модули одного гнезда: подпись, вид и что
 * лучше — больше (+1) или меньше (−1). Двигатель выбирают не по одной
 * скорости: форсированный быстрее, но прожорливее, и это видно сразу.
 */
const fx = (v, d = 2) => (+v).toFixed(d);
const big = (v) => Math.round(v).toLocaleString(numLocale());
const CMP = {
  engine: [['maxSpeed', 'скорость', (v) => fx(v) + L(' км/с'), 1], ['accel', 'разгон', (v) => fx(v) + L(' км/с²'), 1],
    ['exhaust', 'струя (экономичность)', (v) => big(v) + L(' км/с'), 1]],
  rcs: [['lateral', 'поперёк курса', (v) => fx(v) + L(' км/с²'), 1], ['tipAccel', 'оконечности', (v) => fx(v / 9.81, 1) + ' g', 1]],
  lift: [['liftTWR', 'тяга к весу', (v) => '×' + v, 1], ['liftExhaust', 'струя (экономичность)', (v) => big(v) + L(' км/с'), 1]],
  boost: [['boostMax', 'форсаж', (v) => '×' + v, 1], ['boostBurn', 'заряд', (v) => v + L(' с'), 1],
    ['boostFill', 'восстановление', (v) => v + L(' с'), -1]],
  drive: [['quantumSpeed', 'скорость', (v) => big(v / 1000) + L(' тыс. км/с'), 1],
    ['quantumFuel', 'расход', (v) => v + L(' т на млн км'), -1], ['spool', 'калибровка', (v) => v + L(' с'), -1]],
  warp: [['warpFuel', 'расход', (v) => v + L(' т на св. год'), -1]],
  tank: [['fuelTank', 'запас', (v) => '+' + v + L(' т'), 1]],
  hold: [['hold', 'трюм', (v) => v + L(' т'), 1]],
  shield: [['maxShield', 'ёмкость', (v) => v + L(' ед.'), 1], ['shieldRegen', 'восстановление', (v) => '+' + v + L('/с'), 1],
    ['shieldDelay', 'задержка', (v) => v + L(' с'), -1]],
  scanner: [['reach', 'дальность', (v) => big(v) + L(' км'), 1]],
  gear: [['gearTime', 'выпуск', (v) => fx(v, 1) + L(' с'), -1]],
  lamp: [['range', 'дальность', (v) => v + L(' км'), 1]],
};

/** Числа модуля для сравнения: у сканера — последняя ступень. */
function cmpSpec(slot, m) {
  if (!m) return {};
  const sp = moduleSpec({ slot, spec: m.spec });
  if (slot === 'scanner' && Array.isArray(sp.steps)) sp.reach = sp.steps[sp.steps.length - 1];
  return sp;
}

/** Таблица «стоит → предлагают» с разницей, раскрашенной по смыслу. */
function compare(slot, cur, next) {
  const rows = CMP[slot];
  if (!rows) return `<p class="hint">${esc(describeModule({ slot, spec: next.spec }))}</p>`;
  const a = cmpSpec(slot, cur), b = cmpSpec(slot, next);
  return `<table class="cmp">${rows.map(([k, label, f, better]) => {
    const nv = b[k];
    if (typeof nv !== 'number') return '';
    const ov = a[k];
    let delta = '', cls = '';
    if (typeof ov === 'number' && Math.abs(nv - ov) > 1e-9) {
      const up = (nv - ov) * better > 0;
      cls = up ? 'good' : 'bad';
      delta = (nv > ov ? '▲' : '▼');
    }
    return `<tr><td>${esc(L(label))}</td><td class="n dim">${typeof ov === 'number' ? esc(f(ov)) : '—'}</td>
      <td class="n ${cls}">${esc(f(nv))} ${delta}</td></tr>`;
  }).join('')}</table>`;
}

/** Гнёзда в порядке групп, как на карточке корабля. */
function slotOrder(o) {
  const order = SLOT_GROUPS.flatMap(([, list]) => list);
  const idx = (s) => { const i = order.indexOf(s); return i < 0 ? order.length : i; };
  return o.slots.slice().sort((a, b) => idx(a.slot) - idx(b.slot));
}

/** Сколько предложений гнезда можно поставить здесь. */
const offersHere = (o, sl) => (o.open ? sl.offers.filter((m) => m.sold && m.fits !== false).length : 0);

function outfitTab(game) {
  const s = st(game);
  if (s.err.outfit && s.err.outfit !== 'loading') return failed(s.err.outfit);
  if (!s.outfit) return loading(L('ЗАПРАШИВАЕМ ВЕРФЬ…'));
  const o = s.outfit;
  const slots = slotOrder(o);
  if (!slots.some((x) => x.slot === s.slot)) {
    const first = slots.find((x) => offersHere(o, x) > 0) || slots[0];
    s.slot = first ? first.slot : null;
  }
  let group = '';
  const rows = slots.map((sl) => {
    const g = groupOf(sl.slot);
    const gh = g !== group ? `<tr class="grp"><td colspan="3">${esc(L(g))}</td></tr>` : '';
    group = g;
    const inst = sl.installed[0];
    const n = offersHere(o, sl);
    // Гнездо — крупно, модуль в нём — строкой ниже; у заводского модуля
    // имя совпадает с гнездом, и второй раз его не пишем.
    const title = L(SLOT[sl.slot] || sl.slot.toUpperCase());
    const name = inst ? L(inst.name) : '';
    const sub = !inst ? `<span class="sub dim">${esc(L('гнездо свободно'))}</span>`
      : name.toUpperCase() !== title.toUpperCase() ? `<span class="sub">${esc(name)}</span>` : '';
    return `${gh}<tr class="row${sl.slot === s.slot ? ' sel' : ''}" data-act="slot" data-slot="${esc(sl.slot)}">
      <td><span class="nm">${esc(title)}</span>${sub}</td>
      <td class="n">${inst ? esc(describeModule({ slot: sl.slot, spec: inst.spec })) : ''}</td>
      <td class="n">${n ? `<span class="badge">${n}</span>` : ''}</td></tr>`;
  }).join('');
  const top = o.open
    ? `<p class="hint">${esc(L('Замена засчитывает стоящий модуль: верфь берёт его за ') + Math.round(o.resale * 100)
      + L('% цены.'))} ${esc(L('Цифра справа — сколько модулей для гнезда продают здесь.'))}</p>`
    : noYard(s, game.port ? game.port.tech : '?', 'Модули ставят на станциях уровня 4–5, здесь — ');
  const sl = slots.find((x) => x.slot === s.slot);
  return `${top}<div class="split"><div><table class="lt">${rows}</table></div><aside class="detail scroll">${
    sl ? slotPanel(game, s, o, sl) : ''}</aside></div>`;
}

function slotPanel(game, s, o, sl) {
  const money = game.player.balance;
  const title = L(SLOT[sl.slot] || sl.slot.toUpperCase());
  const inst = sl.installed.map((m) => {
    let act = '';
    if (o.open) {
      if (sl.required) act = `<p class="hint">${esc(L('Только замена: без него корабль не выйдет из дока.'))}</p>`;
      else {
        const key = 'unfit:' + m.code;
        act = `<div class="acts">${s.arm === key
          ? btn(esc(L('ТОЧНО ПРОДАТЬ? · ') + kr(m.resale, true)), 'unfit', { code: m.code, name: m.name }, 'warn', s.busy)
          : btn(esc(L('ПРОДАТЬ · ') + kr(m.resale, true)), 'arm', { key }, '', s.busy)}</div>`;
      }
    }
    const detail = moduleDetail({ slot: sl.slot, spec: m.spec });
    return `<div class="inst"><span class="kick">${esc(L('СТОИТ'))}</span><b>${esc(L(m.name))}</b>
      <span class="val">${esc(describeModule({ slot: sl.slot, spec: m.spec }))}</span>${detail ? `<span class="dim">${esc(detail)}</span>` : ''}${act}</div>`;
  });
  if (!sl.installed.length) inst.push(`<div class="inst"><span class="kick">${esc(L('СТОИТ'))}</span><b class="dim">${esc(L('гнездо свободно'))}</b></div>`);
  const cur = sl.installed[0] || null;
  const offers = sl.offers.map((m) => {
    let foot;
    if (!o.open) foot = `<span class="dim">${esc(L('здесь не продают'))}</span>`;
    else if (m.fits === false) foot = `<span class="dim">${esc(L('только для ') + (m.hulls || []).map((h) => hullName(h)).join(', '))}</span>`;
    else if (!m.sold) foot = `<span class="dim">${esc(L('продают на верфях уровня ') + m.tech)}</span>`;
    else {
      const short = money < m.net;
      foot = `<span class="cost">${m.credit > 0 ? esc(kr(m.price) + ' − ' + L('зачёт') + ' ' + kr(m.credit) + ' = ') : ''}<b>${esc(kr(m.net))}</b></span>${
        btn(esc(L('ПОСТАВИТЬ')), 'fit', { code: m.code, name: m.name }, 'pri', s.busy || short)}${
        short ? `<span class="bad">${esc(L('не хватает ') + kr(m.net - money))}</span>` : ''}`;
    }
    return `<div class="offer"><b>${esc(L(m.name))}</b>${compare(sl.slot, cur, m)}<div class="of">${foot}</div></div>`;
  });
  return `<div class="dh"><span class="kick">${esc(L(groupOf(sl.slot)))}</span><h3>${esc(title)}</h3></div>
    ${inst.join('')}${offers.length ? head(L('НА ВЕРФИ')) + offers.join('') : `<p class="hint">${esc(L('Других модулей для этого гнезда нет.'))}</p>`}`;
}

// --- КОРАБЛИ ------------------------------------------------------------------------

/**
 * Корабли: свои в этом доке (пересесть), верфь корпусов (купить), ангар.
 * Числа корпусов — из базы (ship_type): габарит, масса, цена. Покупка —
 * в два нажатия: корабль стоит как сотня рейсов, и купленный случайным
 * щелчком назад уже не сдать.
 */
function shipsTab(game) {
  const s = st(game);
  if (s.err.ships && s.err.ships !== 'loading') return failed(s.err.ships);
  if (!s.ships) return loading(L('ЗАПРАШИВАЕМ ВЕРФЬ…'));
  const o = s.ships;
  const money = game.player.balance;

  // Где корабль в порту: на площадке или в хранилище (схема 13). Из
  // кресла пересаживаются (из хранилища — с вызовом на площадку); пешком у
  // пульта ангарной службы корабль из хранилища вызывают, к стоящему —
  // прокладывают путь.
  const foot = !!(game.walk && game.walk.on);
  const here = o.here.map((x) => {
    const where = x.stored ? L('В ХРАНИЛИЩЕ ПОРТА') : x.pad ? L('ПЛОЩАДКА ') + x.pad : '';
    let act;
    if (x.stored) {
      act = foot ? btn(esc(L('ВЫЗВАТЬ НА ПЛОЩАДКУ')), 'retrieve', { id: x.id }, 'pri', s.busy)
        : btn(esc(L('ВЫЗВАТЬ И ПЕРЕСЕСТЬ')), 'board', { id: x.id }, 'pri', s.busy);
    } else if (foot) {
      act = x.pad ? btn(esc(L('ПУТЬ К НЕМУ')), 'path', { pad: x.pad }, x.active ? 'pri' : '', s.busy) : '';
    } else {
      act = x.active ? `<span class="tag">${esc(L('ВЫ В ЕГО КРЕСЛЕ'))}</span>`
        : btn(esc(L('ПЕРЕСЕСТЬ')), 'board', { id: x.id }, 'pri', s.busy);
    }
    return `<div class="card ship${x.active ? ' mine' : ''}">
      <b>${esc(x.typeName)}</b><span class="dim">${esc(L(x.title))} · №${esc(x.id)}${where ? ' · ' + esc(where) : ''}</span>
      <div class="acts">${act}</div></div>`;
  }).join('');

  const buy = (act, key, label, data, price) => (s.arm === key
    ? btn(esc(L('ПОДТВЕРДИТЬ · ') + kr(-price)), act, data, 'warn', s.busy || money < price)
    : btn(esc(label + kr(price)), 'arm', { key }, 'pri', s.busy || money < price));

  const hulls = o.hulls.map((h) => {
    let act;
    if (!o.open) act = '';
    else if (!h.sold) act = `<span class="dim">${esc(L('продают на верфях уровня ') + h.tech)}</span>`;
    else {
      act = buy('hull', 'hull:' + h.code, L('КУПИТЬ · '), { code: h.code, name: h.name, price: h.price }, h.price);
      if (money < h.price) act += `<span class="bad">${esc(L('не хватает ') + kr(h.price - money))}</span>`;
    }
    // Оружейных гнёзд у корпуса — из каталога (server/data/specs.php): у
    // крейсера их пять, и выбирают его в том числе за это.
    const spec = typeSpec(h.code);
    return `<div class="card ship"><b>${esc(h.name)}</b><span class="dim">${esc(L(h.title))}</span>
      ${kv([
        [L('Габарит'), Math.round(h.lengthM) + '×' + Math.round(h.widthM) + '×' + Math.round(h.heightM) + L(' м')],
        [L('Масса'), Math.round(h.massT).toLocaleString(numLocale()) + L(' т')],
        spec && spec.gunMounts > 0 ? [L('Оружейных гнёзд'), String(spec.gunMounts)] : null,
        spec && spec.fuelMax > 0 ? [L('Бак'), t1(spec.fuelMax)] : null,
      ])}
      <div class="acts">${act}</div></div>`;
  }).join('');

  // Ангар корабля, которым командуют: вездеход в трюм (у корабля без
  // ангара блока нет). Приписан он к этому кораблю: после гибели
  // возвращается в его трюм.
  const H = o.hangar;
  let hangar = '';
  if (H) {
    let act;
    if (H.have) act = `<span class="tag">${esc(L('В ТРЮМЕ'))}</span>`;
    else if (!o.open) act = '';
    else {
      act = buy('rover', 'rover:' + H.code, L('КУПИТЬ · '), { code: H.code, name: H.name, price: H.price }, H.price);
      if (money < H.price) act += `<span class="bad">${esc(L('не хватает ') + kr(H.price - money))}</span>`;
    }
    hangar = head(L('АНГАР КОРАБЛЯ')) + `<div class="cards"><div class="card ship"><b>${esc(H.name)}</b>
      <span class="dim">${esc(L(H.title) + ' · ' + L('в трюм корабля №') + H.for)}</span><div class="acts">${act}</div></div></div>`;
  }
  const top = o.open
    ? `<p class="hint">${esc(L('Купленный корабль встаёт в этот же док с заводскими модулями и полным баком; ваш остаётся рядом.'))}</p>`
    : noYard(s, o.tech, 'Корабли продают на станциях уровня 4–5, здесь — ');
  return `${head(L('В ЭТОМ ДОКЕ'))}<div class="cards">${here}</div>${head(L('ВЕРФЬ КОРАБЛЕЙ'))}${top}<div class="cards">${hulls}</div>${hangar}`;
}

// --- наружу ---------------------------------------------------------------------------

/** Содержимое раздела порта. */
export function stationBody(game, tab) {
  if (tab === 'market') return marketTab(game);
  if (tab === 'outfit') return outfitTab(game);
  if (tab === 'ships') return shipsTab(game);
  return portTab(game);
}

/**
 * Встали в порт или вернулись к нему (сели в кресло, закрыли карту).
 * Новый порт — ответы прошлого ни к чему: у него свои цены и верфь, и
 * открывается он на первом разделе — с баком и ремонтом. Показывает
 * терминал рамка (js/ui/terminal.js): в порту, в кресле — он на экране.
 */
export function showDocked(game) {
  // На ногах порт показывает только пульт ангарной службы (game.kiosk).
  if (game.walk && game.walk.on && !game.kiosk) return;
  const s = st(game);
  const here = game.ship.dockedAt;
  if (s.at !== here) {
    Object.assign(s, makeStation(), { at: here });
    if (game.menu) game.menu.tab = 'port';
  }
  redraw(game);
}
