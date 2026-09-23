// Связь игры с сервером: вход, состояние, сохранение.
//
// Главная разница с localStorage, из-за которой этот модуль вообще нужен:
// сохранение перестало быть мгновенным и начало иногда не получаться.
// Отсюда три правила, на которых здесь всё построено.
//
// 1. Игра НЕ ЖДЁТ сервер. Сохранение ставится в очередь и уходит фоном;
//    полёт при этом не замирает ни на кадр. Ждать сеть в игровом цикле
//    нельзя — это будет видно как рывок раз в несколько секунд.
//
// 2. Сеть отвалилась — играем дальше. Состояние продолжает писаться в
//    localStorage, в приборах загорается «АВТОНОМНО», и как только связь
//    вернётся, накопленное уйдёт на сервер. Выкидывать игрока из полёта
//    из-за пропавшего вайфая — худшее, что можно сделать.
//
// 3. Сервер главнее при ЗАГРУЗКЕ. Если вход есть и сервер ответил, игра
//    начинается с его состояния, а не с местного: местное — кэш, а не
//    правда. Иначе два браузера с одним пилотом разъедутся молча.

import * as api from './api.js';

/** Не чаще раза в столько секунд дёргаем сервер сохранением. */
export const SAVE_EVERY = 8;

/** Сколько ждём ответа при запуске: дольше — игрок смотрит в пустой экран. */
export const BOOT_TIMEOUT = 4000;

export const session = {
  // 'none' — вход не выполнен; 'online' — сервер отвечает;
  // 'offline' — вход есть, но связи нет.
  mode: 'none',
  player: null,       // последний снимок player.state
  name: '',
  error: null,        // текст последней сетевой беды, для приборов
  dirty: null,        // что ещё не ушло на сервер
  sending: false,
  lastSent: 0,        // отметка времени последней удачной отправки
  fails: 0,
};

export const isOnline = () => session.mode === 'online';
export const hasToken = () => api.online();

/**
 * Загрузка состояния при запуске.
 *
 * @returns {'none'|'online'|'offline'} — что делать дальше: отправлять на
 * страницу входа, играть с сервера или играть из местного кэша.
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
    session.mode = e.code === 'auth' ? 'none' : 'offline';
    session.error = e.message;
  }
  return session.mode;
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

/** Отправить накопленное. Ошибку не бросает: игре от неё толку нет. */
export async function flush() {
  if (!hasToken() || session.sending || !session.dirty) return false;
  const payload = session.dirty;
  session.sending = true;
  try {
    await api.save(payload);
    // Чистим ТОЛЬКО если за время отправки ничего нового не накопилось.
    if (session.dirty === payload) session.dirty = null;
    session.lastSent = Date.now();
    session.fails = 0;
    if (session.mode === 'offline') {
      session.mode = 'online';
      session.error = null;
    }
    return true;
  } catch (e) {
    session.fails++;
    if (e.code === 'auth') {
      session.mode = 'none';
    } else {
      session.mode = 'offline';
    }
    session.error = e.message;
    // Отметку времени двигаем и при неудаче: иначе игра будет долбить
    // мёртвый сервер каждым кадром сохранения.
    session.lastSent = Date.now();
    return false;
  } finally {
    session.sending = false;
  }
}

/** Последняя попытка при закрытии вкладки. */
export function flushOnExit(payload) {
  if (!hasToken()) return;
  api.saveBeacon(payload || session.dirty);
}

/**
 * Стыковка на сервере: сбор за место и отметка о порте.
 *
 * Вынесено отдельным вызовом, а не полем сохранения, потому что это
 * ДЕЙСТВИЕ, а не состояние: у него есть цена, и повторить его нельзя.
 */
export async function dock(systemId, localId) {
  if (!isOnline()) return null;
  try {
    const r = await api.dock(systemId, localId);
    await refresh();
    return r;
  } catch (e) {
    session.error = e.message;
    if (e.code !== 'auth') session.mode = 'offline';
    return null;
  }
}

/**
 * Ремонт корпуса за деньги.
 *
 * Раньше стыковка чинила корабль даром прямо в игре. С сервером это
 * стало действием с ценой, и решает её сервер: он знает и ставку порта,
 * и остаток крон.
 */
export async function repair() {
  if (!isOnline()) throw Object.assign(new Error('нет связи с сервером'), { code: 'offline' });
  const r = await api.repair();
  await refresh();
  return r;
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
    else session.mode = 'offline';
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
