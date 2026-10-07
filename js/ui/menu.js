// Разделы пилота в бортовом терминале (клавиша I): корабль, трюм,
// подряды, финансы.
//
// Сам терминал — рамка, закладки, клавиши, показ — живёт в
// js/ui/terminal.js; здесь только содержимое четырёх разделов, строкой
// HTML. Строкой — потому что по ней раздел проверяется без браузера
// (tools/test.mjs), а браузер нужен лишь, чтобы её показать.
//
// Раньше меню рисовалось на холсте приборов, и у холста не было ни
// прокрутки, ни переноса строк: длинный трюм и лента операций обрезались
// по нижней кромке («…ещё 12 записей выше»), а нажать в них было нечего.
// Разметка даёт всё это даром, и теми же кнопками, что в порту.
//
// Мир под терминалом НЕ ОСТАНАВЛИВАЕТСЯ: в сети остановить его нельзя, и
// корабль летит дальше. Поэтому в шапке всё время видна скорость, а
// числа, которые меняются на ходу (бак, щиты, сроки подрядов), обновляет
// рамка на месте (liveValues), не пересобирая раздел.

import { SHIP } from '../game/ship.js';
import { HULL } from '../game/hull.js';
import { CROWN, cargoTons, ledgerTotals, missionExpired } from '../game/player.js';
import { fmtTime } from './hud.js';
import { modules } from '../game/loadout.js';
import { fuelCap, fuelReserve, fuelLevel, warpRange, massT } from '../game/fuel.js';
import { L, numLocale } from '../core/lang.js';
import { esc, kr, t1, meter, kv, empty, head } from './termkit.js';

export const TABS = [['ship', 'КОРАБЛЬ'], ['cargo', 'ТРЮМ'], ['contracts', 'ПОДРЯДЫ'], ['money', 'ФИНАНСЫ']];

/** Кроны с разрядами и знаком: «+1 200 кр», «−35 кр». */
export const fmtCrowns = (n, signed = false) => {
  const v = Math.round(Math.abs(n)).toLocaleString(numLocale());
  const sign = n < 0 ? '−' : (signed ? '+' : '');
  return sign + v + ' ' + L(CROWN);
};

/** Часы пилота: сколько он в деле. */
export const fmtClock = (s) => {
  const t = Math.max(0, Math.floor(s));
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  return hh + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
};

/**
 * Когда была операция. Сервер ставит время в UTC («2026-10-04 06:01:00»),
 * показываем местное: сегодня — часы и минуты, раньше — ещё и число.
 *
 * Раньше в ленте стояли «часы пилота» — одно и то же время у всех строк:
 * при разборе ответа сервера им всем ставился нынешний счётчик игры.
 */
export function fmtAt(at, now = new Date()) {
  const d = at ? new Date(String(at).replace(' ', 'T') + 'Z') : null;
  if (!d || isNaN(d.getTime())) return '—';
  const p2 = (n) => String(n).padStart(2, '0');
  const hm = p2(d.getHours()) + ':' + p2(d.getMinutes());
  const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return same ? hm : p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + ' ' + hm;
}

/** Доля корпуса и его цвет: процент — от предела ЭТОГО корпуса. */
export function hullState(ship) {
  const max = SHIP.maxHull || 100;
  const f = Math.max(0, Math.min(1, ship.hull / max));
  return { f, pct: Math.round(f * 100), cls: f > 0.6 ? 'good' : f > 0.3 ? 'low' : 'bad' };
}

const fuelCls = (ship) => ({ ok: '', low: 'low', reserve: 'bad', dry: 'bad' })[fuelLevel(ship)] || '';

/** Сколько квантового хода в баке сверх резерва, млн км. */
const quantumRange = (ship) => (SHIP.quantumFuel > 0
  ? Math.max(0, ship.fuel - fuelReserve()) / SHIP.quantumFuel : 0);

// Гнёзда по смыслу. Порядок и подписи общие с верфью (js/ui/station.js):
// на карточке корабля и на верфи модуль ищут в одном и том же месте.
export const SLOT_GROUPS = [
  ['ДВИЖЕНИЕ', ['engine', 'rcs', 'lift', 'boost']],
  ['ПРЫЖКИ И ТОПЛИВО', ['drive', 'warp', 'tank']],
  ['СИСТЕМЫ', ['hold', 'shield', 'scanner', 'computer', 'lamp', 'gear']],
];
export const groupOf = (slot) => {
  for (const [g, list] of SLOT_GROUPS) if (list.includes(slot)) return g;
  return 'СИСТЕМЫ';
};

// --- КОРАБЛЬ -------------------------------------------------------------------

function shipTab(game) {
  const { ship } = game;
  const h = hullState(ship);
  const cap = fuelCap();
  const m = (km) => (km * 1000).toFixed(1) + L(' м');
  const name = ship.mesh && ship.mesh.name ? ship.mesh.name : (SHIP.typeName || L('КОРАБЛЬ'));

  const shield = SHIP.maxShield > 0
    ? `<div class="gauge"><span>${esc(L('ЩИТЫ'))}</span><b data-live="shield">${esc(liveText(game).shield)}</b></div>
      ${meter(ship.shield / SHIP.maxShield, 'cy', null, 'shieldBar')}`
    : `<div class="gauge"><span>${esc(L('ЩИТЫ'))}</span><b class="dim">${esc(L('НЕ УСТАНОВЛЕНЫ'))}</b></div>`;

  const state = `<section class="card">
    ${head(L('СОСТОЯНИЕ'))}
    <div class="gauge"><span>${esc(L('КОРПУС'))}</span><b class="${h.cls}">${h.pct} %</b></div>
    ${meter(h.f, h.cls)}
    ${shield}
    <div class="gauge"><span>${esc(L('ТОПЛИВО'))}</span><b class="${fuelCls(ship)}" data-live="fuel">${esc(liveText(game).fuel)}</b></div>
    ${meter(cap > 0 ? ship.fuel / cap : 0, fuelCls(ship) || 'cy', cap > 0 ? fuelReserve() / cap : null, 'fuelBar')}
    ${kv([
      [L('Варп'), liveText(game).warp, '', 'warp'],
      [L('Квантовый ход'), liveText(game).quantum, '', 'quantum'],
      [L('Резерв бака'), t1(fuelReserve()), 'dim'],
    ])}
  </section>`;

  const dims = `<section class="card">
    ${head(L('ГАБАРИТЫ'))}
    ${kv([
      [L('Длина × ширина × высота'), m(HULL.size.z) + ' × ' + m(HULL.size.x) + ' × ' + m(HULL.size.y)],
      [L('Масса'), Math.round(massT()).toLocaleString(numLocale()) + L(' т')],
      [L('Трюм'), t1(SHIP.hold || 0)],
      [L('Оружейных гнёзд'), String(Math.max(1, SHIP.gunMounts || 1))],
    ])}
  </section>`;

  // Значения из настоящих констант, а не переписаны сюда: иначе карточка
  // начнёт врать в тот день, когда двигатель перенастроят.
  const perf = `<section class="card">
    ${head(L('ХОДОВЫЕ КАЧЕСТВА'))}
    ${kv([
      [L('Предел хода'), SHIP.maxSpeed.toFixed(2) + L(' км/с')],
      [L('На форсаже'), (SHIP.maxSpeed * SHIP.boostMax).toFixed(1) + L(' км/с')],
      [L('Разгон'), SHIP.accel.toFixed(2) + L(' км/с²')],
      [L('Торможение'), SHIP.brake.toFixed(2) + L(' км/с²')],
      [L('Поперёк курса'), SHIP.lateral.toFixed(2) + L(' км/с²')],
    ])}
  </section>`;

  // Модули — по группам, как на верфи. Список общий с сервером
  // (js/game/loadout.js): карточка и каталог говорят об одном железе.
  const rows = modules();
  const groups = [...SLOT_GROUPS.map(([g]) => g), 'ВООРУЖЕНИЕ'];
  const byGroup = new Map(groups.map((g) => [g, []]));
  for (const r of rows) {
    const g = r.slot === 'gun' || r.slot === 'mounts' ? 'ВООРУЖЕНИЕ' : groupOf(r.slot);
    byGroup.get(g).push(r);
  }
  const mods = `<section class="card">
    ${head(L('УСТАНОВЛЕННЫЕ МОДУЛИ'))}
    ${groups.filter((g) => byGroup.get(g).length).map((g) => `<div class="sub-h">${esc(L(g))}</div>${kv(
      byGroup.get(g).filter((r) => r.slot !== 'mounts').map((r) => [r.name, r.value, r.installed ? '' : 'dim']))}`).join('')}
  </section>`;

  return `<div class="ident"><h2>${esc(name.toUpperCase())}</h2><span>${esc(L(SHIP.typeTitle || 'ЛЁГКИЙ ТОРГОВЫЙ КОРАБЛЬ'))}${
    ship.id !== null && ship.id !== undefined ? ' · №' + esc(ship.id) : ''}</span></div>
    <div class="cols2"><div class="stack">${state}${dims}${perf}</div><div class="stack">${mods}</div></div>`;
}

// --- ТРЮМ ----------------------------------------------------------------------

/**
 * Трюм. В порту рядом с каждым товаром — его здешняя цена и чем кончится
 * продажа: ради этого вопроса трюм в порту и открывают. Щелчок по строке
 * ведёт на рынок, сразу к продаже этого товара.
 */
function cargoTab(game, port) {
  const p = game.player;
  const used = cargoTons(p);
  const hold = SHIP.hold || 0;
  const free = Math.max(0, hold - used);
  const top = `<div class="holdbar"><div class="gauge"><span>${esc(L('ЗАНЯТО'))}</span><b>${esc(t1(used))} / ${esc(t1(hold))}</b>
    <span class="r">${esc(L('СВОБОДНО'))} <b>${esc(t1(free))}</b></span></div>${meter(hold > 0 ? used / hold : 0, free <= 0 ? 'low' : 'cy')}</div>`;
  if (!p.cargo.length) {
    return top + empty(L('ТРЮМ ПУСТ'), L('Груз покупают на рынке порта: дёшево там, где его производят, дорого там, где его ждут.'));
  }
  const market = port && game.station && game.station.market ? game.station.market : null;
  const price = new Map(market ? market.goods.map((g) => [g.code, g.price]) : []);
  const rows = p.cargo.map((c) => {
    const here = price.get(c.code);
    const gain = here !== undefined && c.avgPrice > 0 ? (here - c.avgPrice) * c.tons : null;
    const tail = market
      ? `<td class="n">${here !== undefined ? esc(kr(here)) : '—'}</td><td class="n ${gain === null ? '' : gain >= 0 ? 'good' : 'bad'}">${
        gain === null ? '—' : esc(kr(gain, true))}</td>`
      : '';
    const act = port && here !== undefined ? ` data-act="tomarket" data-code="${esc(c.code)}"` : '';
    return `<tr class="${act ? 'row' : ''}"${act}><td>${esc(L(c.name))}</td><td class="n">${esc(t1(c.tons))}</td>
      <td class="n">${c.avgPrice > 0 ? esc(kr(c.avgPrice)) : '—'}</td><td class="n">${c.avgPrice > 0 ? esc(kr(c.avgPrice * c.tons)) : '—'}</td>${tail}</tr>`;
  }).join('');
  const headRow = `<tr><th>${esc(L('ТОВАР'))}</th><th class="n">${esc(L('ТОНН'))}</th><th class="n">${esc(L('КУПЛЕНО ПО'))}</th><th class="n">${
    esc(L('ЗАТРАЧЕНО'))}</th>${market ? `<th class="n">${esc(L('ЦЕНА ЗДЕСЬ'))}</th><th class="n">${esc(L('ЕСЛИ ПРОДАТЬ'))}</th>` : ''}</tr>`;
  const hint = port
    ? (market ? L('Щелчок по строке — на рынок, к продаже этого товара.') : L('ЗАПРАШИВАЕМ БИРЖУ…'))
    : L('Продают груз на рынке любого порта. Цена одна на покупку и продажу.');
  return `${top}<table class="lt"><thead>${headRow}</thead><tbody>${rows}</tbody></table><p class="hint">${esc(hint)}</p>`;
}

// --- ПОДРЯДЫ -------------------------------------------------------------------

function contractsTab(game) {
  const p = game.player;
  if (!p.missions.length) {
    return empty(L('АКТИВНЫХ ПОДРЯДОВ НЕТ'), L('Подряды берут на доске в порту: доставка груза, срок, награда.'));
  }
  const lt = liveText(game);
  return `<div class="stack">${p.missions.map((m) => {
    const dead = missionExpired(m);
    return `<section class="card mission${dead ? ' dead' : ''}">
      <div class="mh"><b>${esc(L(m.title))}</b><span class="good">${esc(kr(m.reward, true))}</span></div>
      ${kv([
        m.target ? [L('Куда'), m.target + (m.where ? ' · ' + m.where : '')] : null,
        m.tons > 0 ? [L('Груз'), t1(m.tons)] : null,
        m.penalty > 0 ? [L('Штраф за срыв'), kr(m.penalty), 'bad'] : null,
        [L('Срок'), lt['mt' + m.id], dead ? 'bad' : 'warn', 'mt' + m.id],
      ])}
      ${meter(m.total > 0 ? m.left / m.total : 0, dead ? 'bad' : 'low', null, 'mb' + m.id)}
      ${m.desc ? `<p>${esc(L(m.desc))}</p>` : ''}
    </section>`;
  }).join('')}</div>`;
}

// --- ФИНАНСЫ -------------------------------------------------------------------

function moneyTab(game) {
  const p = game.player;
  const t = ledgerTotals(p);
  const top = `<div class="money"><div><span>${esc(L('НА СЧЕТУ'))}</span><b class="${p.balance < 0 ? 'bad' : ''}">${esc(kr(p.balance))}</b></div>
    <div><span>${esc(L('ПРИШЛО'))}</span><b class="good">${esc(kr(t.in, true))}</b></div>
    <div><span>${esc(L('УШЛО'))}</span><b class="bad">${esc(kr(-t.out))}</b></div></div>`;
  if (!p.ledger.length) return top + empty(L('ДВИЖЕНИЯ СРЕДСТВ НЕ БЫЛО'), '');
  // Свежее — вверху: последнее движение денег — то, ради чего раздел и
  // открывают. Прокручивается вся лента, а не столько, сколько влезло.
  const rows = p.ledger.slice().reverse().map((e) => `<tr><td class="dim">${esc(e.at ? fmtAt(e.at) : fmtClock(e.t))}</td>
    <td>${esc(L(e.label))}</td><td class="n ${e.sum >= 0 ? 'good' : 'bad'}">${esc(kr(e.sum, true))}</td>
    <td class="n dim">${typeof e.after === 'number' ? esc(kr(e.after)) : ''}</td></tr>`).join('');
  return `${top}<table class="lt"><thead><tr><th>${esc(L('КОГДА'))}</th><th>${esc(L('ОПЕРАЦИЯ'))}</th><th class="n">${
    esc(L('СУММА'))}</th><th class="n">${esc(L('ОСТАТОК'))}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// --- наружу ----------------------------------------------------------------------

/** Содержимое раздела пилота. port — терминал открыт в порту. */
export function pilotBody(game, tab, port = false) {
  if (tab === 'cargo') return cargoTab(game, port);
  if (tab === 'contracts') return contractsTab(game);
  if (tab === 'money') return moneyTab(game);
  return shipTab(game);
}

/**
 * Числа, которые меняются на ходу: бак, щиты, дальность, сроки подрядов,
 * скорость. Рамка ставит их в узлы data-live и data-bar раз в несколько
 * кадров — пересобирать ради них раздел значило бы терять нажатие,
 * пришедшееся на пересборку.
 */
export function liveText(game) {
  const { ship } = game;
  const out = {
    fuel: t1(ship.fuel) + ' / ' + t1(fuelCap()),
    shield: SHIP.maxShield > 0 ? Math.round(ship.shield) + ' / ' + SHIP.maxShield : '',
    warp: L('до ') + warpRange(ship).toFixed(1) + L(' св. г.'),
    quantum: L('до ') + quantumRange(ship).toFixed(0) + L(' млн км'),
  };
  for (const m of game.player.missions) out['mt' + m.id] = missionExpired(m) ? L('СРОК ВЫШЕЛ') : L('осталось ') + fmtTime(m.left);
  return out;
}

export function liveBars(game) {
  const { ship } = game;
  const cap = fuelCap();
  const out = {
    fuelBar: cap > 0 ? ship.fuel / cap : 0,
    shieldBar: SHIP.maxShield > 0 ? ship.shield / SHIP.maxShield : 0,
  };
  for (const m of game.player.missions) out['mb' + m.id] = m.total > 0 ? m.left / m.total : 0;
  return out;
}

/** Действия разделов пилота. Вернёт true, если нажатие разобрано. */
export function pilotAct(game, act, arg = {}) {
  if (act === 'tomarket' && game.station) {
    // Из трюма в порту — к продаже этого товара на рынке.
    game.station.good = arg.code;
    game.station.side = 'sell';
    game.station.qty = null;
    game.menu.tab = 'market';
    game.menu.dirty = true;
    return true;
  }
  return false;
}

