// Бортовой терминал: одно окно на дела пилота и на порт.
//
// Раньше их было два, и разных до мелочей. Меню пилота (I) рисовалось на
// холсте приборов: без прокрутки — длинный трюм и лента операций
// обрезались, — без единой кнопки, и открывалось только в полёте. Экран
// порта был разметкой, но прыгал размером от раздела к разделу, вкладки
// и «вылет» уезжали при прокрутке, а рынок был стеной из шести кнопок в
// строке, половина из которых заперта без объяснений.
//
// Теперь окно одно и одного размера. Шапка — где ты и с чем: счёт, трюм,
// бак, корпус, а в полёте ещё и скорость (мир под терминалом не стоит).
// Под ней закладки: в порту — разделы порта и разделы пилота, вне порта —
// только пилота. Прокручивается одно тело, шапка и подвал на месте.
//
// Клавиши: 1–9 — раздел по номеру, Q/E и ←/→ — соседний, ↑/↓ — строка в
// списке (рынок, верфь), I и Esc — закрыть (в порту I — к своим делам,
// Esc — обратно к порту). W/A/S/D здесь не делают ничего: в окне без
// пространства им двигать нечего, а листать ими разделы значило бы
// приучить руку к тому, что WASD что-то выбирает.
//
// Видимость — по состоянию игры, а не по вызовам «показать/спрятать»:
// рамка каждый кадр сверяет, должен ли терминал быть на экране
// (terminalFrame), и прячет его под картой, справкой, на ногах в порту, в
// тоннеле. Так он не остаётся висеть поверх того, что его закрыло, — а
// вызовов, где его надо было не забыть спрятать, набралось больше десятка.

import { L } from '../core/lang.js';
import { input } from '../core/input.js';
import { SHIP } from '../game/ship.js';
import { cargoTons } from '../game/player.js';
import { fuelCap, fuelLevel } from '../game/fuel.js';
import { session } from '../net/session.js';
import { VERSION } from '../core/version.js';
import { fmtSpeed } from './hud.js';
import { esc, kr, t1, pct, btn, kbd } from './termkit.js';
import * as P from './menu.js';
import * as S from './station.js';

export function makeMenu() {
  return {
    open: false,       // терминал вне порта открыт (I)
    tab: 'ship',       // раздел на экране — порта или пилота
    lastPort: 'port',  // куда вернуть Esc в порту
    lastPilot: 'ship', // с чего открывать I
    shown: false,      // терминал сейчас на экране
    port: false,       // показан в порту (с разделами порта)
    dirty: true,       // разметку надо пересобрать
    sig: '',           // отпечаток данных прошлой сборки
    liveAt: 0,         // когда последний раз ставились живые числа
    paint: null,       // пересобрать сейчас (ставится при показе)
  };
}

/** Разделы на экране: в порту — порта и пилота, вне порта — пилота. */
export const tabsFor = (port) => (port ? [...S.TABS, ...P.TABS] : P.TABS);
const isPilotTab = (tab) => P.TABS.some(([k]) => k === tab);

/** Поставить раздел; негодный для места — первый раздел места. */
function useTab(game, port, tab) {
  const M = game.menu;
  const list = tabsFor(port);
  if (!list.some(([k]) => k === tab)) tab = list[0][0];
  if (M.tab !== tab) {
    M.tab = tab;
    if (game.station) { game.station.note = ''; game.station.arm = null; }
  }
  if (isPilotTab(tab)) M.lastPilot = tab; else M.lastPort = tab;
  M.dirty = true;
}

// --- разметка ---------------------------------------------------------------------

/** Где пилот — строка под именем в шапке. */
function whereLine(game, port) {
  const st = game.state, ship = game.ship;
  if (port && ship.dockedAt) {
    const planet = ship.dockedAt.parent;
    return { kick: L('ПОРТ') + (game.port ? ' · ' + L('УРОВЕНЬ ') + game.port.tech : ''),
      name: ship.dockedAt.name, sub: planet ? L('орбита ') + planet.name : '' };
  }
  const who = session.name ? ' · ' + session.name.toUpperCase() : '';
  const shipName = ship.mesh && ship.mesh.name ? ship.mesh.name : (SHIP.typeName || L('КОРАБЛЬ'));
  let sub = game.sys ? L('система ') + game.sys.name : '';
  if (game.walk && game.walk.on) sub = L('на ногах') + (sub ? ' · ' + sub : '');
  else if (st.mode === 'landed') sub = L('на грунте') + (ship.landedAt ? ' · ' + ship.landedAt.name : '');
  else if (st.mode === 'docked') sub = L('в порту') + (ship.dockedAt ? ' · ' + ship.dockedAt.name : '');
  return { kick: L('БОРТОВОЙ ТЕРМИНАЛ') + who, name: shipName, sub };
}

/** Показатели в шапке: на них смотрят из любого раздела. */
function stats(game, port) {
  const { ship, player } = game;
  const hold = SHIP.hold || 0;
  const used = cargoTons(player);
  const cap = fuelCap();
  const lvl = fuelLevel(ship);
  const h = P.hullState(ship);
  const fuelCls = lvl === 'ok' ? '' : (lvl === 'low' ? 'low' : 'bad');
  const cell = (k, v, frac, cls = '', live = '') => `<div class="stat ${cls}"><span>${esc(k)}</span><b${
    live ? ` data-live="${live}"` : ''}>${esc(v)}</b>${frac === null ? '' : `<i><s${live ? ` data-bar="${live}Bar"` : ''} style="width:${pct(frac)}"></s></i>`}</div>`;
  const flying = !port && game.state.mode === 'flight' && !(game.walk && game.walk.on);
  return cell(L('СЧЁТ'), kr(player.balance), null, player.balance < 0 ? 'bad' : '')
    + cell(L('ТРЮМ'), t1(used) + ' / ' + t1(hold), hold > 0 ? used / hold : 0, used >= hold - 1e-6 && hold > 0 ? 'low' : '')
    + cell(L('БАК'), t1(ship.fuel) + ' / ' + t1(cap), cap > 0 ? ship.fuel / cap : 0, fuelCls, 'tank')
    + cell(L('КОРПУС'), h.pct + ' %', h.f, h.cls === 'good' ? '' : h.cls)
    + (flying ? cell(L('СКОРОСТЬ'), fmtSpeed(Math.abs(ship.speed)), null, 'speed', 'speed') : '');
}

/** Разметка терминала целиком — строкой: по ней он проверяется без браузера. */
export function terminalHtml(game, port = false) {
  const M = game.menu;
  const tabs = tabsFor(port);
  if (!tabs.some(([k]) => k === M.tab)) M.tab = tabs[0][0];
  const w = whereLine(game, port);
  const tabHtml = tabs.map(([k, name], i) => {
    const grp = port && (i === 0 || i === S.TABS.length)
      ? `<span class="grp">${esc(i === 0 ? L('СТАНЦИЯ') : L('ПИЛОТ'))}</span>` : '';
    return `${grp}<button class="tab${M.tab === k ? ' on' : ''}" data-act="tab" data-tab="${k}">${i < 9 ? kbd(String(i + 1)) : ''}${esc(L(name))}</button>`;
  }).join('');
  const body = isPilotTab(M.tab) ? P.pilotBody(game, M.tab, port) : S.stationBody(game, M.tab);

  const s = game.station;
  const note = port && s && s.note
    ? `<div class="note ${s.noteKind || ''}">${esc(s.note)}</div>`
    : `<div class="note dim">${kbd('Q')}${kbd('E')}${esc(L('разделы'))}${port ? ' &nbsp; ' + kbd('↑') + kbd('↓') + esc(L('выбор')) : ''}</div>`;
  const foot = port
    ? `${btn(esc(L('КАРТА')) + ' ' + kbd('M'), 'map')}${game.cockpit ? btn(esc(L('ВСТАТЬ')) + ' ' + kbd('Y'), 'stand') : ''}${
      btn(esc(L('ВЫЛЕТ')) + ' ' + kbd(L('ПРОБЕЛ')), 'launch', {}, 'pri')}`
    : btn(esc(L('ЗАКРЫТЬ')) + ' ' + kbd('I'), 'close');

  return `<div class="tw">
    <header class="th"><div class="who"><span class="kick">${esc(w.kick)}</span><h1>${esc(w.name)}</h1>${
    w.sub ? `<span class="sub">${esc(w.sub)}</span>` : ''}</div><div class="stats">${stats(game, port)}</div>${
    port ? '' : `<button class="x" data-act="close" title="${esc(L('ЗАКРЫТЬ'))}">✕</button>`}</header>
    <nav class="tt">${tabHtml}<span class="ver">SOLAR TRADER v${esc(VERSION)}</span></nav>
    <main class="tb scroll" tabindex="-1">${body}</main>
    <footer class="tf">${note}<div class="acts">${foot}</div></footer>
  </div>`;
}

/**
 * Отпечаток данных, из которых собран раздел. Сменился — разметка
 * пересобирается. Бак, щиты и скорость в него НЕ входят: они меняются
 * каждый кадр и ставятся на место (live), иначе раздел пересобирался бы
 * непрерывно и терял нажатия.
 */
function signature(game, port) {
  const p = game.player, ship = game.ship;
  return [
    port ? 1 : 0, game.menu.tab, game.state.mode, ship.id, SHIP.code, Math.round(ship.hull),
    p.balance, p.ledger.length, p.cargo.map((c) => c.code + ':' + c.tons).join(','),
    p.missions.map((m) => m.id + (m.done ? 'd' : '') + (m.left <= 0 ? 'x' : '')).join(','),
    port ? Math.round(ship.fuel * 10) : 0, game.port ? game.port.tech : -1, game.walk && game.walk.on ? 1 : 0,
  ].join('|');
}

// --- показ ---------------------------------------------------------------------------

const termEl = () => (typeof document !== 'undefined' ? document.getElementById('term') : null);

function paint(game) {
  const el = termEl();
  const M = game.menu;
  if (!el || !M.shown) return;
  const body = el.querySelector ? el.querySelector('.tb') : null;
  const keep = body ? body.scrollTop : 0;
  const sameTab = M.paintedTab === M.tab;
  el.innerHTML = terminalHtml(game, M.port);
  M.paintedTab = M.tab;
  M.dirty = false;
  M.sig = signature(game, M.port);
  const nb = el.querySelector ? el.querySelector('.tb') : null;
  // Прокрутка: после сделки глаз остаётся на строке, а новый раздел
  // открывается сверху.
  if (nb) nb.scrollTop = sameTab ? keep : 0;
  live(game, el, true);
  if (M.port) S.stationLoad(game, M.tab);
}

/** Живые числа — на место, без пересборки. */
function live(game, el, force = false) {
  const M = game.menu;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!force && now - M.liveAt < 200) return;
  M.liveAt = now;
  if (!el.querySelectorAll) return;
  const text = P.liveText(game);
  const bars = P.liveBars(game);
  text.tank = text.fuel;
  bars.tankBar = bars.fuelBar;
  text.speed = fmtSpeed(Math.abs(game.ship.speed));
  for (const n of el.querySelectorAll('[data-live]')) {
    const v = text[n.dataset.live];
    if (v !== undefined && n.textContent !== v) n.textContent = v;
  }
  for (const n of el.querySelectorAll('[data-bar]')) {
    const v = bars[n.dataset.bar];
    if (v !== undefined) n.style.width = pct(v);
  }
}

/** Щелчок по терминалу: одна точка на все кнопки. */
function onClick(game, e) {
  const t = e && e.target && e.target.closest ? e.target.closest('[data-act]') : null;
  if (!t || t.disabled) return;
  // Фокус с кнопки снимаем: иначе пробел, которым в порту вылетают,
  // заодно нажал бы и её — вторую покупку того же товара.
  if (t.blur) t.blur();
  terminalAct(game, t.dataset.act, { ...t.dataset });
}

/** Нажатие в терминале — от кнопки, клавиши или проверки. */
export function terminalAct(game, act, arg = {}) {
  const M = game.menu;
  if (act === 'tab') { useTab(game, M.port, arg.tab); if (M.paint) M.paint(); return true; }
  if (act === 'close') { if (game.closeTerminal) game.closeTerminal(); else M.open = false; return true; }
  if (P.pilotAct(game, act, arg)) { useTab(game, M.port, M.tab); if (M.paint) M.paint(); return true; }
  return S.stationAct(game, act, arg);
}

/**
 * Кадр терминала: показать, спрятать, пересобрать, обновить живые числа.
 *
 * @param want должен ли он быть на экране (решает js/main.js по режиму)
 * @param port показан ли в порту — с разделами порта и вылетом
 */
export function terminalFrame(game, want, port) {
  const M = game.menu;
  const el = termEl();
  if (!el) return;
  if (!want) {
    if (M.shown) {
      M.shown = false;
      M.paint = null;
      el.classList.add('hidden');
      el.innerHTML = '';
    }
    return;
  }
  if (!M.shown || M.port !== port) {
    M.shown = true;
    M.port = port;
    useTab(game, port, port ? M.tab : M.lastPilot);
    M.paint = () => paint(game);
    el.onclick = (e) => onClick(game, e);
    // Пробел и Enter в терминале — клавиши игры (вылет), а не «нажать
    // кнопку в фокусе»: иначе пробел вылетал бы и заодно покупал.
    el.onkeydown = (e) => {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Tab'
        || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
    };
    el.classList.toggle('port', port);
    el.classList.remove('hidden');
    paint(game);
    const b = el.querySelector ? el.querySelector('.tb') : null;
    try { if (b) b.focus({ preventScroll: true }); } catch (e) { /* и без фокуса прокрутят колесом */ }
    return;
  }
  // Пересборка — не посреди нажатия: кнопка, пересобранная между
  // mousedown и mouseup, щелчка уже не получит.
  if ((M.dirty || signature(game, port) !== M.sig) && !input.mouse.left) paint(game);
  else live(game, el);
}

// --- клавиши ---------------------------------------------------------------------------

/**
 * Клавиши терминала. Вернёт, что делать игре: 'close' — закрыть, 'map' —
 * закрыть и открыть карту; null — разобрано здесь.
 */
export function terminalKeys(game, inp, port) {
  const M = game.menu;
  const tabs = tabsFor(port);
  if (!port && inp.pressed('KeyI', 'Escape')) return 'close';
  if (!port && inp.pressed('KeyM')) return 'map';
  if (port && inp.pressed('KeyI')) {
    // В порту I — к своим делам и обратно к порту.
    useTab(game, port, isPilotTab(M.tab) ? M.lastPort : M.lastPilot);
    return null;
  }
  if (port && inp.pressed('Escape') && isPilotTab(M.tab)) { useTab(game, port, M.lastPort); return null; }
  for (let i = 0; i < tabs.length && i < 9; i++) {
    if (inp.pressed('Digit' + (i + 1), 'Numpad' + (i + 1))) { useTab(game, port, tabs[i][0]); return null; }
  }
  const step = (inp.pressed('KeyE', 'ArrowRight') ? 1 : 0) - (inp.pressed('KeyQ', 'ArrowLeft') ? 1 : 0);
  if (step) {
    const i = tabs.findIndex(([k]) => k === M.tab);
    useTab(game, port, tabs[(i + step + tabs.length) % tabs.length][0]);
    return null;
  }
  const row = (inp.pressed('ArrowDown') ? 1 : 0) - (inp.pressed('ArrowUp') ? 1 : 0);
  if (row && port) {
    const r = S.stationRows(game, M.tab);
    if (r && r.keys.length) {
      const i = r.keys.indexOf(r.cur);
      const k = r.keys[i < 0 ? 0 : Math.max(0, Math.min(r.keys.length - 1, i + row))];
      S.stationAct(game, r.act, r.act === 'good' ? { code: k } : { slot: k });
      scrollToSel();
    }
  }
  return null;
}

/** Выбранная строка — в поле зрения после ↑/↓. */
function scrollToSel() {
  const el = termEl();
  if (!el || !el.querySelector) return;
  const r = el.querySelector('tr.sel');
  if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });
}

/** Терминал открыт вне порта — для проверок и подсказок. */
export const terminalOpen = (game) => !!game.menu.shown;
