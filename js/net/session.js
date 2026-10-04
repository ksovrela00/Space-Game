// Связь игры с сервером: вход, состояние, сохранение.
//
// Игра без сервера НЕ ИДЁТ. Автономного режима нет и не будет: игра,
// которая без сервера живёт по своим правилам — даром чинит корпус,
// заправляет бак и буксирует, — молча расходится с настоящей, и пилот,
// вернувшись в сеть, оказывается не там и не с тем. Поэтому:
//
// 1. Без сервера игра не запускается (js/boot.js): нет входа — страница
//    входа, сервер не отвечает — экран «нет связи» и попытки снова.
//
// 2. Связь пропала посреди игры — игра СТОИТ (js/main.js, linkHeld) и
//    раз в RETRY_EVERY стучится снова; ответил — едет дальше с того же
//    места. Сохранять в это время нечего: ничего не происходит.
//
// 3. Сохранение по-прежнему фоном: ставится в очередь и уходит не чаще
//    SAVE_EVERY. Ждать сеть в игровом цикле нельзя — это рывок раз в
//    несколько секунд. Местной копии нет: правда одна, и она на сервере.

import * as api from './api.js';
import { L } from '../core/lang.js';

/** Не чаще раза в столько секунд дёргаем сервер сохранением. */
export const SAVE_EVERY = 8;

/** Сколько ждём ответа при запуске: дольше — игрок смотрит в пустой экран. */
export const BOOT_TIMEOUT = 4000;

/**
 * Обрыв ли это связи, а не отказ сервера по делу. Сеть упала, ответ не
 * разобрать (PHP упал посреди ответа), сервер сам сказал «ошибка у
 * меня» — связь потеряна. «Не в порту», «мало денег» — это ответ, и
 * игра на нём не останавливается.
 */
export const linkError = (e) => !!e && (e.code === 'offline' || e.code === 'protocol' || e.code === 'server');

export const session = {
  // 'none' — вход не выполнен (страница входа); 'online' — сервер
  // отвечает; 'lost' — вход есть, а связь пропала: игра стоит и ждёт.
  mode: 'none',
  player: null,       // последний снимок player.state
  name: '',
  error: null,        // текст последней сетевой беды, для приборов
  dirty: null,        // что ещё не ушло на сервер
  sending: false,
  lastSent: 0,        // отметка времени последней удачной отправки
  fails: 0,
  // Кому отдать ответ на сохранение. В нём бак по счёту сервера и то,
  // сколько он списал за варп, — игра гасит этим свой долг по прыжку
  // (js/game/fuel.js, warpSettled).
  onSaved: null,
};

export const isOnline = () => session.mode === 'online';
export const hasToken = () => api.online();

/**
 * Загрузка состояния при запуске.
 *
 * @returns {'none'|'online'|'lost'} — что делать дальше: отправлять на
 * страницу входа, играть или ждать связи (js/boot.js: игра не стартует).
 */
export async function start() {
  if (!api.online()) {
    session.mode = 'none';
    return 'none';
  }
  try {
    session.player = await api.call('player.state', {}, BOOT_TIMEOUT);
    session.name = session.player.player.name || session.player.player.login;
    session.mode = 'online';
    session.error = null;
    session.fails = 0;
  } catch (e) {
    // Протухший токен — это «входа нет», а не «сети нет»: api.js такой
    // токен уже забыл, и игроку надо на страницу входа.
    session.mode = e.code === 'auth' ? 'none' : 'lost';
    session.error = e.message;
  }
  return session.mode;
}

/** Как часто без связи пробуем сервер снова, мс. */
export const RETRY_EVERY = 3000;
let probeAt = 0;
let probing = false;

/**
 * Без связи — раз в RETRY_EVERY спросить состояние: ответил — снова в
 * сети. Зовётся каждый кадр (js/main.js), пока игра стоит; сам решает,
 * пора ли, и не шлёт второй вопрос, пока первый без ответа.
 */
export function retryLink(now = Date.now()) {
  if (session.mode !== 'lost' || !hasToken() || session.sending || probing) return false;
  if (now - probeAt < RETRY_EVERY) return false;
  probeAt = now;
  probing = true;
  refresh().finally(() => { probing = false; });
  return true;
}

/**
 * Поставить сохранение в очередь.
 *
 * Копится ПОСЛЕДНЕЕ состояние, а не очередь состояний: промежуточные
 * положения корабля никому не нужны, нужно текущее.
 */
export function queueSave(payload, now = Date.now()) {
  session.dirty = payload;
  if (!hasToken()) return false;
  if (session.sending) return false;
  if (now - session.lastSent < SAVE_EVERY * 1000) return false;
  flush();
  return true;
}

/**
 * Отправить накопленное СЕЙЧАС и дождаться ответа — даже если отправка
 * уже идёт: тогда сперва дождаться её. Нужно перед пересадкой: место
 * прежнего корабля обязано дойти до неё, иначе писать его будет некому
 * (сохранение за корабль, которым уже не командуют, сервер не пишет).
 */
export async function flushNow() {
  while (session.sending) await new Promise((ok) => setTimeout(ok, 15));
  return flush();
}

/** Отправить накопленное. Ошибку не бросает: игре от неё толку нет. */
export async function flush() {
  if (!hasToken() || session.sending || !session.dirty) return false;
  const payload = session.dirty;
  session.sending = true;
  try {
    const r = await api.save(payload);
    if (session.onSaved && r) session.onSaved(r);
    // Чистим ТОЛЬКО если за время отправки ничего нового не накопилось.
    if (session.dirty === payload) session.dirty = null;
    session.lastSent = Date.now();
    session.fails = 0;
    if (session.mode === 'lost') {
      session.mode = 'online';
      session.error = null;
    }
    return true;
  } catch (e) {
    session.fails++;
    if (e.code === 'auth') session.mode = 'none';
    else if (linkError(e)) session.mode = 'lost';
    session.error = e.message;
    // Отметку времени двигаем и при неудаче: иначе игра будет долбить
    // мёртвый сервер каждым кадром сохранения.
    session.lastSent = Date.now();
    return false;
  } finally {
    session.sending = false;
  }
}

/** Последняя попытка при закрытии вкладки: то, что не успело уйти. */
export function flushOnExit(payload) {
  if (!hasToken()) return;
  api.saveBeacon(payload || session.dirty);
}

/**
 * Действие сервера, которое игра доводит до конца сама, не держа кадр:
 * ответ — { ok, data }; связь оборвалась — { lost } (повторить, когда
 * вернётся); сервер отказал — { refused: его слова, code }.
 */
async function attempt(fn) {
  if (!isOnline()) return { lost: true };
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    session.error = e.message;
    if (linkError(e)) {
      session.mode = 'lost';
      return { lost: true };
    }
    return { refused: e.message, code: e.code };
  }
}

/**
 * Стыковка на сервере: сбор за место и отметка о порте.
 *
 * Вынесено отдельным вызовом, а не полем сохранения, потому что это
 * ДЕЙСТВИЕ, а не состояние: у него есть цена, и повторить его нельзя.
 * Отказ раньше глотался молча — и игра стояла в порту, где у сервера её
 * не было: рынок и заправка отвечали «не в порту».
 */
export async function dock(systemId, localId) {
  const r = await attempt(() => api.dock(systemId, localId));
  if (r.ok) await refresh();
  return r;
}

/** Вылет из порта на сервере (Stations::undock). */
export const undock = () => attempt(() => api.undock());

/** Переход пилота на сервере (Players::move). */
export const movePilot = (me) => attempt(() => api.movePilot(me));

/**
 * Ремонт корпуса за деньги.
 *
 * Раньше стыковка чинила корабль даром прямо в игре. С сервером это
 * стало действием с ценой, и решает её сервер: он знает и ставку порта,
 * и остаток крон.
 */
export const repair = () => act(() => api.repair());

/**
 * Вызов сервера из игры: без связи — отказ словами, а обрыв посреди
 * вызова — потерянная связь (игра встанет и будет ждать, js/main.js).
 */
async function guarded(fn) {
  if (!isOnline()) throw Object.assign(new Error(L('нет связи с сервером')), { code: 'offline' });
  try {
    return await fn();
  } catch (e) {
    if (linkError(e)) session.mode = 'lost';
    throw e;
  }
}

/**
 * Действие в порту с ценой: заправка, сделка, верфь.
 *
 * Всё одинаково: без связи — отказ словами, а не молчание; после ответа
 * состояние перечитывается целиком — деньги, трюм, модули и бак меняются
 * разом, и собирать их по кусочкам из ответов значило бы однажды
 * забыть один.
 */
async function act(fn) {
  const r = await guarded(fn);
  await refresh();
  return r;
}

export const refuel = (tons = null) => act(() => api.refuel(tons));

/** Пересесть в другой свой корабль: ответ — полное состояние с ним. */
export async function command(shipId) {
  session.player = await guarded(() => api.command(shipId));
  return session.player;
}
export const buyGoods = (code, tons) => act(() => api.buy(code, tons));
export const sellGoods = (code, tons) => act(() => api.sell(code, tons));
export const buyModule = (code) => act(() => api.outfitBuy(code));
export const sellModule = (code) => act(() => api.outfitSell(code));
export const buyHull = (code) => act(() => api.shipyardBuy(code));
export const rescue = () => act(() => api.rescue());

/** Прайс порта и верфь — чтения, состояние от них не меняется. */
export function readPort(what) {
  return guarded(() => (what === 'ships' ? api.shipyard() : (what === 'outfit' ? api.outfit() : api.prices())));
}

/** Перечитать состояние (после сделки, ремонта, подряда). */
export async function refresh() {
  if (!hasToken()) return null;
  try {
    session.player = await api.state();
    session.mode = 'online';
    session.error = null;
    return session.player;
  } catch (e) {
    session.error = e.message;
    if (e.code === 'auth') session.mode = 'none';
    else if (linkError(e)) session.mode = 'lost';
    return null;
  }
}

export async function logout() {
  try {
    await api.logout();
  } catch (e) { /* уходим в любом случае */ }
  session.mode = 'none';
  session.player = null;
}
