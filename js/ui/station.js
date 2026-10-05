// Экран станции: порт, рынок, верфь, заправка.
//
// Открывается сам, как только корабль встал в порт, и живёт, пока он там
// стоит. Четыре раздела — то, зачем в порт вообще летают:
//
//   1 ПОРТ      что это за станция, какие в ней услуги, чем она берёт
//   2 РЫНОК     товары на перевозку: купить здесь, продать там
//   3 ВЕРФЬ     модули: поставить недостающий, заменить на лучший,
//               продать установленный
//   4 ЗАПРАВКА  топливо по цене здешнего водорода и ремонт корпуса
//
// Цены, склады, остаток крон и то, что станет с кораблём после замены
// модуля, считает СЕРВЕР (server/src/Market.php, Outfit.php, Fuel.php).
// Экран только показывает его ответы и присылает «что и сколько»: здесь
// нет ни одной цены, посчитанной на месте. Посчитай их игра — и первый
// же желающий купил бы тысячу тонн за одну крону.
//
// Без сервера игры нет вовсе (js/boot.js), а пропала связь посреди
// стоянки — игра стоит под надписью «нет связи» (js/main.js), и экран
// порта под ней ждёт вместе с ней.
//
// Вёрстка — DOM, а не холст: это таблицы, кнопки и прокрутка, и браузер
// делает их лучше, чем сделала бы игра. Нажатия разбирает один
// обработчик на всю панель (data-act): кнопки перерисовываются после
// каждой сделки, и вешать слушатель на каждую значило бы копить их.

import { fmtDist } from './hud.js';
import { KIND_RU, hideOverlay } from './screens.js';
import { ST } from '../game/state.js';
import { SHIP } from '../game/ship.js';
import { cargoTons } from '../game/player.js';
import { fuelCap, fuelReserve, fuelLevel, warpRange } from '../game/fuel.js';
import { useShipEquipment, specsDoc, typeSpec } from '../game/specs.js';
import { describeModule, moduleDetail } from '../game/loadout.js';
import { applyServer } from '../game/player.js';
import { say } from '../game/state.js';
import {
  session, isOnline, refuel as serverRefuel, buyGoods, sellGoods,
  buyModule, sellModule, buyHull, readPort,
} from '../net/session.js';
import { stations as apiStations } from '../net/api.js';
import { L, numLocale } from '../core/lang.js';

export const TABS = [
  ['port', 'ПОРТ'], ['market', 'РЫНОК'], ['outfit', 'ВЕРФЬ'], ['fuel', 'ЗАПРАВКА'], ['ships', 'КОРАБЛИ'],
];

// Подписи гнёзд на верфи. Ключ — гнездо, а не модуль: видов на гнездо
// бывает несколько, и заголовок у них один.
const SLOT = {
  engine: 'МАРШЕВЫЙ ДВИГАТЕЛЬ', rcs: 'МАНЕВРОВЫЕ', lift: 'ПОДЪЁМНЫЕ ДВИГАТЕЛИ',
  boost: 'ФОРСАЖ', drive: 'КВАНТОВЫЙ ПРИВОД', warp: 'ВАРП-ПРИВОД', tank: 'ДОПОЛНИТЕЛЬНЫЙ БАК',
  hold: 'ТРЮМ', shield: 'ЩИТЫ', scanner: 'СКАНЕР', computer: 'КОМПЬЮТЕРЫ', lamp: 'ФАРЫ',
  gear: 'ШАССИ',
};

/** Состояние экрана: раздел, ответы сервера, занятость, последнее сообщение. */
export const makeStation = () => ({
  tab: 'port',
  at: null,          // в каком порту собраны ответы ниже
  market: null,      // прайс: {goods, station, fuelPrice}
  outfit: null,      // верфь: {open, slots, resale}
  ships: null,       // верфь корпусов: {open, tech, hulls, here}
  yards: null,       // порты системы с верфью — для «здесь верфи нет»
  err: {},           // почему раздел не загрузился
  busy: false,       // запрос в пути: кнопки заперты
  note: '',
  noteKind: '',      // '' | 'good' | 'warn'
});

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// «|| 0» — против «−0 кр»: ноль, округлённый из минус десятитысячной,
// печатается со знаком.
const kr = (n) => (Math.round(n) || 0).toLocaleString(numLocale()) + ' ' + L('кр');
const t1 = (v) => (Math.round(v * 10) / 10).toLocaleString(numLocale()) + ' ' + L('т');
const btn = (label, act, data = {}, cls = '', off = false) =>
  `<button class="btn ${cls}"${off ? ' disabled' : ''} data-act="${act}"${
    Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('')}>${esc(label)}</button>`;

const st = (game) => game.station || (game.station = makeStation());

// Имя корпуса по коду — из каталога (js/game/specs.js).
const hullName = (code) => {
  const t = specsDoc() && specsDoc().shipTypes.find((x) => x.code === code);
  return t ? t.name : code;
};

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

/** Догрузить то, что нужно открытому разделу. Повторный вызов ничего не шлёт. */
function load(game) {
  const s = st(game);
  // Связь пропала — запрос подождёт: экран перерисуют, когда она вернётся.
  if (!isOnline()) return;
  const need = s.tab === 'market' || s.tab === 'fuel' ? 'market'
    : (s.tab === 'outfit' ? 'outfit' : (s.tab === 'ships' ? 'ships' : null));
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
  }).catch(() => { /* список — подсказка, без него экран всё равно цел */ });
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
  s.note = L('ЗАПРОС…');
  s.noteKind = '';
  redraw(game);
  try {
    const r = await fn();
    syncFromServer(game);
    s.note = done(r);
    s.noteKind = 'good';
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

// --- действия ----------------------------------------------------------------

/**
 * Разобрать нажатие. Отдельной функцией, а не внутри обработчика щелчка:
 * так её зовут и клавиши (1–4), и проверки, у которых нет настоящего DOM.
 */
export function stationAct(game, act, arg = {}) {
  const s = st(game);
  if (act === 'tab') {
    if (TABS.some(([k]) => k === arg.tab)) s.tab = arg.tab;
    s.note = '';
    redraw(game);
    return true;
  }
  if (act === 'launch') { game.launch(); return true; }
  if (act === 'stand') { if (game.rise) game.rise(); return true; }
  if (act === 'map') { game.openMap(); return true; }
  if (act === 'repair') { game.repair(); return true; }
  if (s.busy) return false;
  const tons = +arg.tons;
  if (act === 'buy' && tons > 0) {
    run(game, () => buyGoods(arg.code, tons),
      (r) => L('КУПЛЕНО: ') + L(arg.name || arg.code) + ', ' + t1(r.tons) + ' · −' + kr(-r.sum));
    return true;
  }
  if (act === 'sell' && tons > 0) {
    run(game, () => sellGoods(arg.code, tons),
      (r) => L('ПРОДАНО: ') + L(arg.name || arg.code) + ', ' + t1(r.tons) + ' · +' + kr(r.sum));
    return true;
  }
  if (act === 'fit') {
    run(game, () => buyModule(arg.code),
      (r) => L('УСТАНОВЛЕНО: ') + L(arg.name || arg.code) + ' · −' + kr(r.cost));
    return true;
  }
  if (act === 'unfit') {
    run(game, () => sellModule(arg.code),
      (r) => L('ПРОДАНО: ') + L(arg.name || arg.code) + ' · +' + kr(r.credit + (r.refund || 0)));
    return true;
  }
  if (act === 'hull') {
    run(game, () => buyHull(arg.code),
      () => L('КУПЛЕН КОРАБЛЬ: ') + (arg.name || arg.code) + ' · −' + kr(+arg.price) + L(' · ОН В ЭТОМ ДОКЕ'));
    return true;
  }
  if (act === 'rover') {
    // Вездеход покупают тем же вызовом верфи, что корабль (Shipyard::buy):
    // встаёт он не в док, а в трюм того корабля, которым командуют.
    run(game, () => buyHull(arg.code),
      () => L('КУПЛЕН ВЕЗДЕХОД: ') + (arg.name || arg.code) + ' · −' + kr(+arg.price) + L(' · ОН В ТРЮМЕ'));
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
      (r) => L('ЗАПРАВКА: ') + t1(r.tons) + ' · −' + kr(r.cost));
    return true;
  }
  return false;
}

// --- разделы -----------------------------------------------------------------------

function portTab(game) {
  const ship = game.ship;
  const station = ship.dockedAt;
  const planet = station ? station.parent : null;
  const port = game.port;
  const rows = [
    [L('Планета'), planet ? planet.name : '—'],
    [L('Тип'), planet ? L(KIND_RU[planet.kind] || planet.kind) : '—'],
    [L('Радиус планеты'), planet ? fmtDist(planet.radius) : '—'],
    [L('Высота орбиты'), station && planet ? fmtDist(station.orbit.radius - planet.radius) : '—'],
    [L('Стыковок выполнено'), String(game.stats.docks)],
  ];
  if (port) {
    rows.push([L('Уровень порта'), port.tech + ' ' + L('из 5')]);
    rows.push([L('Сбор за место'), kr(port.fee)]);
    const svc = [
      [port.services.market, 'рынок'], [port.services.outfit, 'верфь'],
      [port.services.repair, 'ремонт'], [true, 'заправка'], [port.services.board, 'подряды'],
    ].filter(([on]) => on).map(([, name]) => L(name));
    rows.push([L('Услуги'), svc.join(', ')]);
  }
  const lines = rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="v">${esc(b)}</td></tr>`).join('');
  const note = L('Рынок — товары на перевозку, верфь — модули корабля, заправка — топливо и ремонт. Клавиши 1–4 переключают разделы, Пробел — вылет.');
  return `<table class="rows">${lines}</table><p class="sub">${esc(note)}</p>`;
}

function marketTab(game) {
  const s = st(game);
  if (s.err.market && s.err.market !== 'loading') return `<p class="warn">${esc(s.err.market)}</p>`;
  if (!s.market) return `<p class="sub">${esc(L('ЗАПРАШИВАЕМ БИРЖУ…'))}</p>`;

  const hold = SHIP.hold || 0;
  const used = cargoTons(game.player);
  const free = Math.max(0, hold - used);
  const money = game.player.balance;
  const mine = new Map(game.player.cargo.map((c) => [c.code, c]));
  const rows = s.market.goods.map((g) => {
    const have = mine.get(g.code);
    const canBuy = Math.floor(Math.min(g.stock, free, g.price > 0 ? money / g.price : 0) * 10) / 10;
    const held = have ? have.tons : 0;
    // В плюс или в минус идёт рейс — по средней цене покупки в трюме.
    const gain = have && have.avgPrice > 0 ? (g.price - have.avgPrice) * held : 0;
    const d = { code: g.code, name: g.name };
    return `<tr${g.legal ? '' : ' class="illegal"'}>
      <td>${esc(L(g.name))}<div class="dim">${esc(L(g.category))}${g.legal ? '' : ' · ' + esc(L('запрещено'))}</div></td>
      <td class="v num"><span class="lbl">${esc(L('ЦЕНА ЗА Т'))}</span>${esc(kr(g.price))}</td>
      <td class="v num"><span class="lbl">${esc(L('СКЛАД'))}</span>${g.stock > 0 ? esc(t1(g.stock)) : '—'}</td>
      <td class="v num"><span class="lbl">${esc(L('В ТРЮМЕ'))}</span>${held > 0 ? esc(t1(held)) + `<div class="dim ${gain >= 0 ? 'good' : 'warn'}">${
        gain >= 0 ? '+' : '−'}${esc(kr(Math.abs(gain)))}</div>` : '—'}</td>
      <td class="acts">${btn('+1', 'buy', { ...d, tons: 1 }, 'small', s.busy || canBuy < 1)}${
        btn('+10', 'buy', { ...d, tons: 10 }, 'small', s.busy || canBuy < 10)}${
        btn(L('МАКС'), 'buy', { ...d, tons: canBuy }, 'small', s.busy || canBuy < 0.1)}</td>
      <td class="acts">${btn('−1', 'sell', { ...d, tons: Math.min(1, held) }, 'small ghost', s.busy || held <= 0)}${
        btn(L('ВСЁ'), 'sell', { ...d, tons: held }, 'small ghost', s.busy || held <= 0)}</td>
    </tr>`;
  }).join('');
  return `<p class="sub">${esc(L('ТРЮМ '))}${esc(t1(used))} / ${esc(t1(hold))} · ${
    esc(L('СВОБОДНО '))}${esc(t1(free))}. ${esc(L('Цена одна на покупку и продажу: дёшево там, где товар производят, дорого там, где его ждут.'))}</p>
    <table class="rows trade">
      <tr class="head"><td>${esc(L('ТОВАР'))}</td><td>${esc(L('ЦЕНА ЗА Т'))}</td><td>${
        esc(L('СКЛАД'))}</td><td>${esc(L('В ТРЮМЕ'))}</td><td>${esc(L('КУПИТЬ'))}</td><td>${esc(L('ПРОДАТЬ'))}</td></tr>
      ${rows}
    </table>`;
}

function outfitTab(game) {
  const s = st(game);
  if (s.err.outfit && s.err.outfit !== 'loading') return `<p class="warn">${esc(s.err.outfit)}</p>`;
  if (!s.outfit) return `<p class="sub">${esc(L('ЗАПРАШИВАЕМ ВЕРФЬ…'))}</p>`;
  const o = s.outfit;
  const money = game.player.balance;

  let head = '';
  if (!o.open) {
    const where = s.yards && s.yards.length
      ? L(' Верфь в этой системе: ') + s.yards.join(', ') + '.'
      : '';
    head = `<p class="warn">${esc(L('ВЕРФИ ЗДЕСЬ НЕТ'))}</p><p class="sub">${esc(
      L('Модули ставят на станциях уровня 4–5, здесь — ') + (game.port ? game.port.tech : '?') + '.' + where)}</p>`;
  } else {
    head = `<p class="sub">${esc(L('Замена засчитывает стоящий модуль: верфь берёт его за '))}${
      Math.round(o.resale * 100)}${esc(L('% цены. Двигатель, маневровые и подъёмные можно только заменить — без них корабль не выйдет из дока.'))}</p>`;
  }

  const blocks = o.slots.map((sl) => {
    const title = L(SLOT[sl.slot] || sl.slot.toUpperCase());
    const have = sl.installed.map((m) => {
      const sell = !o.open ? ''
        : (sl.required
          ? `<span class="dim">${esc(L('только замена'))}</span>`
          : btn(L('ПРОДАТЬ · +') + kr(m.resale), 'unfit', { code: m.code, name: m.name }, 'small ghost', s.busy));
      const detail = moduleDetail({ slot: sl.slot, spec: m.spec });
      return `<tr class="mine"><td>${esc(L(m.name))}<div class="dim">${esc(L('стоит на корабле'))}${
        detail ? ' · ' + esc(detail) : ''}</div></td>
        <td class="v">${esc(describeModule({ slot: sl.slot, spec: m.spec }))}</td><td class="acts">${sell}</td></tr>`;
    });
    if (!sl.installed.length) {
      have.push(`<tr class="mine"><td class="dim">${esc(L('ГНЕЗДО СВОБОДНО'))}</td><td></td><td></td></tr>`);
    }
    const offers = sl.offers.map((m) => {
      let act;
      if (!o.open) act = '';
      else if (m.fits === false) {
        act = `<span class="dim">${esc(L('только для ') + (m.hulls || []).map((h) => hullName(h)).join(', '))}</span>`;
      } else if (!m.sold) act = `<span class="dim">${esc(L('уровень ') + m.tech)}</span>`;
      else {
        act = btn(L('ПОСТАВИТЬ · ') + kr(m.net), 'fit', { code: m.code, name: m.name }, 'small',
          s.busy || money < m.net);
        if (m.credit > 0) act += `<div class="dim">${esc(L('с зачётом ') + kr(m.credit))}</div>`;
      }
      return `<tr><td>${esc(L(m.name))}<div class="dim">${esc(moduleDetail({ slot: sl.slot, spec: m.spec }))}</div></td>
        <td class="v">${esc(describeModule({ slot: sl.slot, spec: m.spec }))}</td><td class="acts">${act}</td></tr>`;
    });
    return `<tr><td class="grp" colspan="3">${esc(title)}</td></tr>${have.join('')}${offers.join('')}`;
  }).join('');
  return `${head}<table class="rows fit">${blocks}</table>`;
}

/**
 * Корабли: свои в этом доке (пересесть) и верфь корпусов (купить).
 * Числа корпусов — из базы (ship_type): габарит, масса, цена.
 */
function shipsTab(game) {
  const s = st(game);
  if (s.err.ships && s.err.ships !== 'loading') return `<p class="warn">${esc(s.err.ships)}</p>`;
  if (!s.ships) return `<p class="sub">${esc(L('ЗАПРАШИВАЕМ ВЕРФЬ…'))}</p>`;
  const o = s.ships;
  const money = game.player.balance;
  const m1 = (v) => Math.round(v) + L(' м');
  const here = o.here.map((x) => {
    const act = x.active
      ? `<span class="dim">${esc(L('ВЫ В ЕГО КРЕСЛЕ'))}</span>`
      : btn(L('ПЕРЕСЕСТЬ'), 'board', { id: x.id }, 'small', s.busy);
    return `<tr class="${x.active ? 'mine' : ''}"><td>${esc(x.typeName)}<div class="dim">${esc(L(x.title))} · №${x.id}</div></td>
      <td class="v"></td><td class="acts">${act}</td></tr>`;
  }).join('');
  let head;
  if (!o.open) {
    const where = s.yards && s.yards.length ? L(' Верфь в этой системе: ') + s.yards.join(', ') + '.' : '';
    head = `<p class="warn">${esc(L('ВЕРФИ ЗДЕСЬ НЕТ'))}</p><p class="sub">${esc(
      L('Корабли продают на станциях уровня 4–5, здесь — ') + o.tech + '.' + where)}</p>`;
  } else {
    head = `<p class="sub">${esc(L('Купленный корабль встаёт в этот же док с заводскими модулями и полным баком; ваш остаётся рядом.'))}</p>`;
  }
  const hulls = o.hulls.map((h) => {
    let act;
    if (!o.open) act = '';
    else if (!h.sold) act = `<span class="dim">${esc(L('уровень ') + h.tech)}</span>`;
    else act = btn(L('КУПИТЬ · ') + kr(h.price), 'hull', { code: h.code, name: h.name, price: h.price }, 'small',
      s.busy || money < h.price);
    const dims = m1(h.lengthM) + ' × ' + m1(h.widthM) + ' × ' + m1(h.heightM) + ' · '
      + Math.round(h.massT).toLocaleString(numLocale()) + L(' т');
    // Оружейных гнёзд у корпуса — из каталога (server/data/specs.php): у
    // крейсера их пять, и выбирают его в том числе за это.
    const spec = typeSpec(h.code);
    const guns = spec && spec.gunMounts > 0 ? ' · ' + L('ОРУЖЕЙНЫХ ГНЁЗД: ') + spec.gunMounts : '';
    return `<tr><td>${esc(h.name)}<div class="dim">${esc(L(h.title) + guns)}</div></td>
      <td class="v">${esc(dims)}</td><td class="acts">${act}</td></tr>`;
  }).join('');
  // Ангар корабля, которым командуют: вездеход в трюм (у корабля без
  // ангара строки нет). Приписан он к этому кораблю: после гибели
  // возвращается в его трюм.
  const H = o.hangar;
  let hangar = '';
  if (H) {
    let act;
    if (H.have) act = `<span class="dim">${esc(L('В ТРЮМЕ'))}</span>`;
    else if (!o.open) act = '';
    else act = btn(L('КУПИТЬ · ') + kr(H.price), 'rover', { code: H.code, name: H.name, price: H.price }, 'small',
      s.busy || money < H.price);
    hangar = `<table class="rows fit"><tr><td class="grp" colspan="3">${esc(L('АНГАР КОРАБЛЯ'))}</td></tr>
      <tr><td>${esc(H.name)}<div class="dim">${esc(L(H.title) + ' · ' + L('в трюм корабля №') + H.for)}</div></td>
      <td class="v"></td><td class="acts">${act}</td></tr></table>`;
  }
  return `<table class="rows fit"><tr><td class="grp" colspan="3">${esc(L('В ЭТОМ ДОКЕ'))}</td></tr>${here}</table>
    ${head}<table class="rows fit"><tr><td class="grp" colspan="3">${esc(L('ВЕРФЬ КОРАБЛЕЙ'))}</td></tr>${hulls}</table>${hangar}`;
}

function fuelTab(game) {
  const s = st(game);
  const ship = game.ship;
  const cap = fuelCap();
  const reserve = fuelReserve();
  const lvl = fuelLevel(ship);
  const frac = cap > 0 ? ship.fuel / cap : 0;
  const cls = lvl === 'ok' ? '' : (lvl === 'low' ? 'low' : 'bad');
  const bar = `<div class="fuelbar ${cls}"><div class="fill" style="width:${(frac * 100).toFixed(1)}%"></div>
    <div class="mark" style="left:${(reserve / cap * 100).toFixed(1)}%"></div></div>`;
  const range = `<p class="sub">${esc(L('В баке ') + t1(ship.fuel) + ' / ' + t1(cap) + L(', резерв ') + t1(reserve)
    + L('. Варп — до ') + warpRange(ship).toFixed(1) + L(' св. г., квантовый ход — до ')
    + (SHIP.quantumFuel > 0 ? (Math.max(0, ship.fuel - reserve) / SHIP.quantumFuel).toFixed(0) : '—')
    + L(' млн км.'))}</p>`;

  let fuel;
  if (s.err.market && s.err.market !== 'loading') {
    fuel = `<p class="warn">${esc(s.err.market)}</p>`;
  } else if (!s.market) {
    fuel = `<p class="sub">${esc(L('ЗАПРАШИВАЕМ ЦЕНУ…'))}</p>`;
  } else {
    const price = s.market.fuelPrice;
    const room = Math.max(0, cap - ship.fuel);
    const money = game.player.balance;
    const afford = Math.floor(Math.min(room, price > 0 ? money / price : 0) * 10) / 10;
    const full = Math.ceil(room * price - 1e-9);
    const cost = `<p class="sub">${esc(L('Топливо — водород: тонна стоит здесь столько же, сколько на рынке порта, — '))}${
      esc(kr(price))}.</p>`;
    fuel = room < 0.001 ? cost + `<p class="good">${esc(L('БАК ПОЛОН'))}</p>` : cost + `<div>${
      btn(L('ДО ПОЛНОГО · ') + t1(room) + ' · ' + kr(full), 'refuel', { tons: 'full' }, '',
        s.busy || room < 0.001 || money < full)}${
      btn('+1 ' + L('т') + ' · ' + kr(price), 'refuel', { tons: 1 }, 'ghost', s.busy || room < 0.001 || money < price)}${
      btn(L('НА ВСЕ ДЕНЬГИ · ') + t1(afford), 'refuel', { tons: afford }, 'ghost',
        s.busy || afford < 0.1 || afford >= room - 1e-3)}</div>`;
  }

  // Ремонт живёт здесь же: это то, что делают с кораблём перед вылетом.
  const port = game.port;
  const damage = Math.max(0, (SHIP.maxHull || 100) - Math.round(ship.hull));
  let repair;
  if (damage <= 0) repair = L('Корпус цел.');
  else if (!port || !port.services || !port.services.repair) {
    repair = L('Корпус повреждён, а чинить здесь нечем: нужен порт с мастерской.');
  } else repair = null;
  const repairHtml = repair !== null
    ? `<p class="sub">${esc(repair)}</p>`
    : `<p class="sub">${esc(L('Корпус повреждён на ') + damage + L('%.'))}</p>${
      btn(L('РЕМОНТ · ') + kr(Math.ceil(damage * port.repairRate)), 'repair', {}, '', s.busy)}`;

  return `<h3>${esc(L('ТОПЛИВО'))}</h3>${bar}${range}${fuel}<h3>${esc(L('КОРПУС'))} · ${
    Math.round(ship.hull)}%</h3>${repairHtml}`;
}

// --- экран целиком -----------------------------------------------------------------

/** Разметка экрана целиком — строкой: по ней экран проверяется без браузера. */
export function stationHtml(game) {
  return html(game);
}

function html(game) {
  const s = st(game);
  const ship = game.ship;
  const station = ship.dockedAt;
  const planet = station ? station.parent : null;
  const lvl = fuelLevel(ship);
  const sum = [
    [L('СЧЁТ'), kr(game.player.balance), ''],
    [L('ТРЮМ'), t1(cargoTons(game.player)) + ' / ' + t1(SHIP.hold || 0), ''],
    [L('БАК'), t1(ship.fuel) + ' / ' + t1(fuelCap()), lvl === 'ok' ? '' : (lvl === 'low' ? 'low' : 'bad')],
    [L('КОРПУС'), Math.round(ship.hull) + '%', ship.hull < 40 ? 'bad' : ''],
  ].filter(Boolean).map(([a, b, c]) => `<span>${esc(a)} <b class="${c}">${esc(b)}</b></span>`).join('');
  const tabs = TABS.map(([k, name], i) =>
    `<button class="tab${s.tab === k ? ' on' : ''}" data-act="tab" data-tab="${k}">${i + 1} ${esc(L(name))}</button>`).join('');
  const body = s.tab === 'market' ? marketTab(game)
    : s.tab === 'outfit' ? outfitTab(game)
      : s.tab === 'fuel' ? fuelTab(game)
        : s.tab === 'ships' ? shipsTab(game) : portTab(game);
  const note = s.note ? `<p class="st-note ${s.noteKind}">${esc(s.note)}</p>` : '';
  return `<h1>${esc(L('СТЫКОВКА'))}</h1><h2>${esc(station ? station.name : '')}${
    planet ? ' · ' + esc(planet.name) : ''}</h2>
    <div class="st-sum">${sum}</div>
    <div class="st-tabs">${tabs}</div>
    <div class="st-body">${body}</div>
    ${note}
    <div class="st-foot">${btn(L('ВЫЛЕТ'), 'launch')}${btn(L('КАРТА СИСТЕМЫ'), 'map', {}, 'ghost')}${
  game.cockpit ? btn(L('ПРОЙТИСЬ ПО КОРАБЛЮ · Y'), 'stand', {}, 'ghost') : ''}</div>`;
}

const overlay = () => document.getElementById('overlay');
const panelEl = () => document.getElementById('panel');

/** Разбор щелчка по панели: одна точка на все кнопки экрана. */
function onClick(game, e) {
  const t = e && e.target && e.target.closest ? e.target.closest('[data-act]') : null;
  if (!t || t.disabled) return;
  // Фокус с кнопки снимаем: иначе Enter, которым в порту вылетают,
  // заодно нажал бы и её — вторую покупку того же товара.
  if (t.blur) t.blur();
  const p = panelEl();
  try { p.focus({ preventScroll: true }); } catch (err) { p.focus(); }
  stationAct(game, t.dataset.act, { ...t.dataset });
}

/** Перерисовать, не трогая прокрутку: после сделки глаз остаётся на строке. */
function redraw(game) {
  if (game.state.mode !== ST.DOCKED || !game.ship.dockedAt) return;
  if (game.walk && game.walk.on) return;
  const p = panelEl();
  const keep = p.scrollTop;
  p.innerHTML = html(game);
  p.scrollTop = keep;
  load(game);
}

/**
 * Показать экран станции. Зовётся при стыковке и всякий раз, когда в порту
 * что-то поменялось (ответ сервера на стыковку, ремонт, закрытие карты).
 */
export function showDocked(game) {
  // Пилот ходит по кораблю — экран порта покажется, когда он сядет.
  if (game.walk && game.walk.on) return;
  const s = st(game);
  const here = game.ship.dockedAt;
  if (s.at !== here) {
    // Новый порт — ответы прошлого ни к чему: у него свои цены и верфь.
    Object.assign(s, makeStation(), { tab: s.tab, at: here });
  }
  const p = panelEl();
  p.classList.add('station');
  p.tabIndex = -1;
  p.onclick = (e) => onClick(game, e);
  p.innerHTML = html(game);
  p.scrollTop = 0;
  overlay().classList.remove('hidden');
  try { p.focus({ preventScroll: true }); } catch (e) { p.focus(); }
  load(game);
}

/** Клавиши в порту: 1–5 — разделы. Вылет (Пробел, Enter) разбирает main.js. */
export function stationKeys(game, input) {
  for (let i = 0; i < TABS.length; i++) {
    if (input.pressed('Digit' + (i + 1), 'Numpad' + (i + 1))) {
      stationAct(game, 'tab', { tab: TABS[i][0] });
      return true;
    }
  }
  return false;
}
