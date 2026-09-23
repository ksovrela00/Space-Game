// Клиент серверного API.
//
// Пока НЕ ПОДКЛЮЧЁН к игре: сохранение по-прежнему идёт в localStorage.
// Так сделано намеренно. Перевод игры на сервер — это переход с
// мгновенного сохранения на сетевое, то есть «сохранить» перестаёт быть
// мгновенным и начинает иногда не получаться; чинить это надо отдельным
// шагом и с проверками, а не заодно с появлением базы.
//
// Модуль здесь для того, чтобы этот шаг был коротким, и чтобы уже сейчас
// можно было поговорить с сервером из консоли браузера:
//
//   const api = await import('./js/net/api.js');
//   await api.ping();
//   await api.register('pilot', 'secret');
//   await api.state();
//
// Токен хранится в localStorage. Это не «безопасное хранилище» (XSS его
// достанет), но у страницы всё равно нет ничего секретнее самого токена,
// а альтернатива — просить пароль при каждой загрузке.

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
export async function call(route, data = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = token();
  if (t) headers['X-Auth-Token'] = t;

  let res;
  try {
    res = await fetch(base() + '?r=' + encodeURIComponent(route), {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
  } catch (e) {
    // Сети нет вовсе — это не ошибка сервера, и различать их важно:
    // на одно игра предлагает повторить, на другое — нет.
    const err = new Error('сервер недоступен');
    err.code = 'offline';
    throw err;
  }

  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    const err = new Error('сервер ответил не по-нашему (' + res.status + ')');
    err.code = 'protocol';
    throw err;
  }

  if (!body || body.ok !== true) {
    const e = body && body.error ? body.error : { code: 'server', message: 'неизвестная ошибка' };
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

export const systems = () => call('galaxy.systems');
export const system = (id) => call('galaxy.system', { id });
export const commodities = () => call('catalog.commodities');

export const prices = (where = {}) => call('market.prices', where);
export const buy = (code, tons) => call('market.buy', { code, tons });
export const sell = (code, tons) => call('market.sell', { code, tons });

export const board = (where = {}) => call('missions.board', where);
export const accept = (id) => call('missions.accept', { id });
export const complete = (id) => call('missions.complete', { id });
export const abandon = (id) => call('missions.abandon', { id });

export const ledger = (limit = 40) => call('ledger.list', { limit });
