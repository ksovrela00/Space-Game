// Клиент серверного API: голые вызовы поверх fetch.
//
// Здесь нет ни одного решения о том, КОГДА и ЧТО вызывать, — только как
// позвать и как разобрать ответ. Когда именно игра грузится, сохраняется
// и что делает при обрыве, решает js/net/session.js. Разделение не
// формальное: сетевые правила («не чаще раза в восемь секунд», «оборвалось
// — играем дальше») меняются часто, а формат вызова — почти никогда.
//
// Отсюда же можно поговорить с сервером руками, из консоли браузера:
//
//   const api = await import('./js/net/api.js');
//   await api.ping();
//   await api.state();
//
// Токен хранится в localStorage. Это не «безопасное хранилище» (XSS его
// достанет), но у страницы всё равно нет ничего секретнее самого токена,
// а альтернатива — просить пароль при каждой загрузке.

import { L } from '../core/lang.js';

const TOKEN_KEY = 'solar_trader_token';

/**
 * Где искать сервер. По умолчанию — рядом с игрой: игра лежит в
 * htdocs/space_game/, сервер в htdocs/space_game/server/. Абсолютный
 * адрес не зашит, чтобы игра работала и на localhost, и на любом другом
 * имени машины.
 */
export const base = () => {
  const path = location.pathname.replace(/\/[^/]*$/, '/');
  return location.origin + path + 'server/api.php';
};

export function token() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;   // приватный режим: живём без входа
  }
}

export function setToken(value) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* приватный режим */ }
}

export const online = () => !!token();

/**
 * Вызов маршрута.
 *
 * Ошибка сервера прилетает исключением с полем `code` — тем самым, что
 * пришло в ответе (`no_funds`, `no_room`, `auth`): по нему игра решает,
 * что показать. Разбирать текст сообщения для этого нельзя — он для
 * человека.
 */
export async function call(route, data = {}, timeoutMs = 6000) {
  const headers = { 'Content-Type': 'application/json' };
  const t = token();
  if (t) headers['X-Auth-Token'] = t;

  // Срок ожидания обязателен. Без него зависший сервер вешает загрузку
  // игры насмерть: fetch сам по себе не истекает никогда, а на этом
  // вызове стоит запуск.
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl && timeoutMs > 0 ? setTimeout(() => ctl.abort(), timeoutMs) : null;

  let res;
  try {
    res = await fetch(base() + '?r=' + encodeURIComponent(route), {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal: ctl ? ctl.signal : undefined,
    });
  } catch (e) {
    // Сети нет вовсе — это не ошибка сервера, и различать их важно:
    // на одно игра предлагает повторить, на другое — нет.
    const err = new Error(L('сервер недоступен'));
    err.code = 'offline';
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    const err = new Error(L('сервер ответил не по-нашему (') + res.status + ')');
    err.code = 'protocol';
    throw err;
  }

  if (!body || body.ok !== true) {
    const e = body && body.error ? body.error : { code: 'server', message: L('неизвестная ошибка') };
    const err = new Error(e.message);
    err.code = e.code;
    err.extra = e;
    // Токен протух или чужой — забываем его сами, иначе каждый
    // следующий вызов будет получать тот же отказ.
    if (e.code === 'auth') setToken(null);
    throw err;
  }
  return body.data;
}

// --- то, что нужно игре ------------------------------------------------------

export const ping = () => call('ping');

export async function register(login, pass, name = '') {
  const r = await call('auth.register', { login, pass, name });
  setToken(r.token);
  return r;
}

export async function login(loginName, pass) {
  const r = await call('auth.login', { login: loginName, pass });
  setToken(r.token);
  return r;
}

export async function logout() {
  const t = token();
  if (t) await call('auth.logout', { token: t });
  setToken(null);
}

export const state = () => call('player.state');
export const save = (payload) => call('player.save', { save: payload });

/**
 * Последнее сохранение при закрытии вкладки.
 *
 * fetch на выгрузке страницы браузер обрывает, а sendBeacon — нет: он
 * отдаёт запрос браузеру и тот досылает его сам. Заголовков beacon не
 * умеет вовсе, поэтому токен идёт В ТЕЛЕ — сервер принимает и так.
 */
export function saveBeacon(payload) {
  const t = token();
  if (!t || typeof navigator === 'undefined' || !navigator.sendBeacon) return false;
  const body = new Blob(
    [JSON.stringify({ save: payload, token: t })],
    { type: 'application/json' }
  );
  return navigator.sendBeacon(base() + '?r=player.save', body);
}

export const dock = (system, station) => call('station.dock', { system, station });
export const repair = () => call('station.repair');
export const stations = (system) => call('galaxy.stations', { system });

export const systems = () => call('galaxy.systems');
export const system = (id) => call('galaxy.system', { id });
export const commodities = () => call('catalog.commodities');

/**
 * Характеристики корабля, оружия и модулей.
 *
 * Спрашивается ДО входа и без токена: без этих чисел нечем даже собрать
 * корабль, а одинаковы они для всех.
 */
export const specs = () => call('catalog.specs');

export const prices = (where = {}) => call('market.prices', where);
export const buy = (code, tons) => call('market.buy', { code, tons });
export const sell = (code, tons) => call('market.sell', { code, tons });

export const board = (where = {}) => call('missions.board', where);
export const accept = (id) => call('missions.accept', { id });
export const complete = (id) => call('missions.complete', { id });
export const abandon = (id) => call('missions.abandon', { id });

export const ledger = (limit = 40) => call('ledger.list', { limit });
