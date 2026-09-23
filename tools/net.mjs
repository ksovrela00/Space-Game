// Проверка сетевого запуска игры: вход, состояние с сервера, сохранение.
//
// Отдельный набор, а не шаги в tools/smoke.mjs, по простой причине:
// main.js читает окружение (токен, адрес, ответы сервера) ОДИН раз при
// загрузке модуля, и три разных случая в одном процессе не проверить. Эта
// проверка запускает саму себя тремя дочерними процессами:
//
//   server   — токен есть, сервер отвечает: игра поднимается с сервера;
//   offline  — токен есть, сервера нет: игра поднимается из кэша браузера;
//   notoken  — токена нет: игра не стартует, а уходит на страницу входа.
//
// Сервер здесь поддельный: настоящий PHP проверяется своим набором
// (server/tests/run.php). Здесь проверяется КЛИЕНТ — то, как игра ведёт
// себя при каждом из трёх ответов.

import { spawnSync } from 'node:child_process';

const arg = process.argv.find((a) => a.startsWith('--case='));
const CASE = arg ? arg.slice(7) : null;

// --- запуск всех случаев ------------------------------------------------------

if (!CASE) {
  console.log('\n== сеть: запуск игры с сервером ==');
  let bad = 0;
  for (const name of ['server', 'offline', 'notoken']) {
    const r = spawnSync(process.execPath, [process.argv[1], '--case=' + name], {
      stdio: 'inherit',
    });
    if (r.status !== 0) bad++;
  }
  console.log('\n' + (bad === 0 ? 'СЕТЬ: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : bad + ' СЛУЧАЕВ УПАЛО'));
  process.exit(bad ? 1 : 0);
}

// --- мелкий стенд: DOM, canvas, хранилище ------------------------------------

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + '[' + CASE + '] ' + msg);
};

const ctx = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'measureText') return (t) => ({ width: String(t).length * 7 });
    if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
      return () => ({ addColorStop() {} });
    }
    if (typeof prop === 'string') return () => {};
    return undefined;
  },
  set() { return true; },
});

const el = (id) => ({
  id, innerHTML: '', textContent: '', className: '', style: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
    contains(c) { return this._s.has(c); }, toggle() {} },
  listeners: {},
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
  appendChild() {}, getContext: () => ctx, width: 0, height: 0,
});
const nodes = { screen: el('screen'), hud: el('hud'), overlay: el('overlay'),
  panel: el('panel'), boot: el('boot'), bootBtn: el('bootBtn') };
globalThis.document = { getElementById: (id) => nodes[id] || el(id), createElement: () => el('div') };

const winListeners = {};
globalThis.window = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); },
  removeEventListener() {},
};
let beacons = 0;
// В Node navigator уже есть и только для чтения, поэтому подменяем его
// свойством, а не присваиванием.
Object.defineProperty(globalThis, 'navigator', {
  value: { sendBeacon: () => { beacons++; return true; } },
  configurable: true,
  writable: true,
});

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

globalThis.location = {
  origin: 'http://localhost',
  pathname: '/space_game/index.html',
  search: '?renderer=2d',
  replaced: null,
  replace(url) { this.replaced = url; },
};

let nowMs = 0;
globalThis.performance = { now: () => nowMs };
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
const frames = (n, dtMs = 16.7) => {
  for (let i = 0; i < n; i++) {
    nowMs += dtMs;
    const cb = rafCb;
    rafCb = null;
    if (!cb) return false;
    cb(nowMs);
  }
  return true;
};

// --- поддельный сервер --------------------------------------------------------

const TOKEN = 'a'.repeat(64);

// Состояние, заведомо ОТЛИЧНОЕ от местного кэша: только так видно, чьё
// именно состояние взяла игра.
const SERVER_STATE = {
  // Время мира — общее для всех и приходит только с сервера. Число взято
  // заведомо не равным ни налёту пилота, ни нулю: ошибка, из-за которой
  // сюда попадал playTimeS, иначе не видна (см. serverToSave).
  world: { time: 98765 },
  player: {
    id: 1, login: 'pilot', name: 'ПИЛОТ', balance: 12345, playTimeS: 4200,
    stats: { flownKm: 77, docks: 3, landings: 1, crashes: 0 },
  },
  position: {
    // Не родная система намеренно: при входе в неё мир собирается заново,
    // и время мира проходит через другой путь. Пока здесь стоял ноль,
    // этот путь не проверялся вовсе.
    systemId: 4, pos: { x: 1234567, y: 4321, z: -7654 }, basis: null,
    dockedBody: null, landedBody: null, landedPose: null, landedSecured: false,
    targetBody: null, warpTo: null, lastStation: null, view: 'chase',
  },
  ship: {
    id: 1, name: '', hull: 61.5, shield: 17, fuelT: 12, gearOut: false,
    type: { code: 'challenger', name: 'Challenger', title: '', hullMax: 100, shieldMax: 0,
      holdT: 20, fuelMaxT: 12, maxSpeed: 1.2, accel: 0.45, brake: 0.75, lateral: 0.5,
      quantumSpeed: 60000, boostMax: 3, boostBurn: 10, lengthM: 65, widthM: 67.1, heightM: 19.3 },
    equipment: [],
  },
  cargo: [{ commodity_id: 3, code: 'grain', name: 'ЗЕРНО', category: 'продовольствие',
    legal: true, tons: 7, avg_price: 64 }],
  holdUsedT: 7,
  missions: [{ id: 9, kind: 'deliver', title: 'ДОСТАВКА · RIOR STATION', descr: 'Довезти зерно.',
    reward: 1500, penalty: 500, tons: 7, commodity: { code: 'grain', name: 'ЗЕРНО' },
    target: { name: 'Rior Station', system: 'Lave', systemId: 0, localId: 9 },
    timeLimitS: 900, leftS: 780, state: 'active' }],
  ledger: [{ at: '2026-09-23 06:00:00', label: 'НАЧАЛЬНЫЙ КАПИТАЛ', amount: 12345,
    balance_after: 12345, ref: 'start' }],
};

const calls = [];
let saved = null;

globalThis.fetch = async (url, opts = {}) => {
  const href = String(url);
  // Через fetch игра тянет не только API, но и звуки. Записываем ВСЁ, а
  // разбираем по адресу: первая версия проверки считала обращением к
  // серверу загрузку каждого сэмпла.
  calls.push(href);
  if (href.indexOf('api.php') < 0) {
    return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0),
      json: async () => ({}) };
  }
  const route = href.split('r=')[1] || '';
  const body = opts.body ? JSON.parse(opts.body) : {};

  if (CASE === 'offline') {
    // Сервера нет вовсе: fetch падает так же, как при обрыве сети.
    throw new TypeError('failed to fetch');
  }
  const reply = (data) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });

  if (route === 'player.state') {
    if (!opts.headers || opts.headers['X-Auth-Token'] !== TOKEN) {
      return { ok: false, status: 401, json: async () => ({ ok: false,
        error: { code: 'auth', message: 'нужен вход' } }) };
    }
    return reply(SERVER_STATE);
  }
  if (route === 'player.save') {
    saved = body.save;
    return reply({ saved: true, fields: 12 });
  }
  if (route === 'station.dock') {
    return reply({ station: { systemId: 0, localId: body.station, name: 'ПОРТ', tech: 4,
      fee: 68, repairRate: 18, pads: 6,
      services: { market: true, board: true, repair: true, outfit: true } },
    fee: 68, charged: true, balance: 12277 });
  }
  return reply({});
};

// Кэш браузера с ЧУЖИМ положением: если игра возьмёт его вместо
// серверного, это сразу будет видно.
const LOCAL_X = 999999;
store['solar_trader_save_v2'] = JSON.stringify({
  system: 0, pos: { x: LOCAL_X, y: 0, z: 0 },
  basis: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, fwd: { x: 0, y: 0, z: 1 } },
  hull: 100, view: 'cockpit', gear: false, time: 10,
  stats: { docks: 0, crashes: 0, flownKm: 0, landings: 0 },
});
if (CASE !== 'notoken') store['solar_trader_token'] = TOKEN;

// --- поехали ------------------------------------------------------------------

const mod = await import('../js/main.js');
// Запуск игры асинхронный: ждём, пока он доберётся до конца.
await new Promise((r) => setTimeout(r, 50));
const game = globalThis.window.GAME;
const { session } = await import('../js/net/session.js');

if (CASE === 'notoken') {
  ok(location.replaced === 'login.html', 'без входа игра уходит на страницу входа');
  ok(!game || !rafCb, 'кадры при этом не запускаются');
  const apiCalls = calls.filter((u) => u.indexOf('api.php') >= 0);
  ok(apiCalls.length === 0, 'к серверу не ходим вовсе: спрашивать нечего');
}

if (CASE === 'server') {
  ok(session.mode === 'online', 'режим связи: ' + session.mode);
  ok(!!game, 'игра поднялась');
  ok(Math.abs(game.ship.pos.x - SERVER_STATE.position.pos.x) < 1e-6,
    'место взято С СЕРВЕРА, а не из кэша браузера: x = ' + game.ship.pos.x);
  ok(Math.abs(game.ship.hull - 61.5) < 1e-9, 'корпус с сервера: ' + game.ship.hull);
  // Щит тоже серверный: он тратится в бою и отрастает по серверным
  // часам, и взятый из местного кэша он соврал бы ровно в бою.
  ok(Math.abs(game.ship.shield - 17) < 2, 'щит с сервера: ' + game.ship.shield.toFixed(1));
  ok(game.state.view === 'chase', 'вид камеры с сервера: ' + game.state.view);
  ok(game.player.balance === 12345, 'счёт с сервера: ' + game.player.balance + ' кр');
  ok(game.player.cargo.length === 1 && game.player.cargo[0].name === 'ЗЕРНО',
    'трюм с сервера: ' + game.player.cargo.map((c) => c.name).join(', '));
  ok(game.player.missions.length === 1 && game.player.missions[0].left === 780,
    'подряд с сервера, срок ' + game.player.missions[0].left + ' с');
  ok(game.player.server === true, 'стартовый набор затёрт серверными данными');
  // Орбиты планет и станций считаются от времени мира. Разойдись оно у
  // двоих — и они, стоя рядом, увидят станцию в разных местах; ровно это
  // и было, пока сюда подставлялся налёт пилота (4200 с).
  ok(Math.abs(game.world.time - SERVER_STATE.world.time) < 60,
    'время мира взято с сервера: ' + Math.round(game.world.time)
    + ' с (налёт пилота — ' + SERVER_STATE.player.playTimeS + ' с)');

  // Вкладка в фоне не получает кадров, и её часы отстают от общих на всё
  // это время. Вернувшись к игре, пилот обязан увидеть мир там же, где
  // его видят остальные, а не на пять минут назад.
  {
    const before = game.world.time;
    nowMs += 300000;                // пять минут вкладка была в фоне
    frames(30);
    const behind = SERVER_STATE.world.time + 300 - game.world.time;
    ok(game.world.time - before > 200 && Math.abs(behind) < 5,
      'после спящей вкладки часы догоняют общие: отставание '
      + behind.toFixed(1) + ' с');
  }

  // Кэш браузера приведён к серверному состоянию: следующий запуск без
  // сети должен поднять игру там же, где сервер её оставил.
  const cached = JSON.parse(store['solar_trader_save_v2']);
  ok(Math.abs(cached.pos.x - SERVER_STATE.position.pos.x) < 1e-6,
    'местный кэш переписан серверным состоянием');

  // Сохранение уходит на сервер — не чаще раза в SAVE_EVERY секунд.
  for (const fn of nodes.bootBtn.listeners.click || []) fn();
  frames(30);
  nowMs += 20000;                 // прошло время — можно слать
  frames(60 * 8);
  ok(saved !== null, 'сохранение ушло на сервер');
  ok(saved && typeof saved.system === 'number' && 'hull' in saved && 'player' in saved,
    'на сервер уходит тот же снимок, что и в браузер');

  // Закрытие вкладки: последнее сохранение маячком.
  for (const fn of winListeners.beforeunload || []) fn();
  ok(beacons > 0, 'при закрытии вкладки уходит маячок sendBeacon');
}

if (CASE === 'offline') {
  ok(session.mode === 'offline', 'режим связи: ' + session.mode);
  ok(!!game, 'игра поднялась и без сервера');
  ok(Math.abs(game.ship.pos.x - LOCAL_X) < 1e-6,
    'место взято из кэша браузера: x = ' + game.ship.pos.x);
  ok(location.replaced === null, 'на страницу входа не выкидывает: токен-то есть');
  for (const fn of nodes.bootBtn.listeners.click || []) fn();
  ok(frames(120), 'кадры идут, полёт не сломан');
  ok(game.player.server === false, 'дела пилота — местные, серверных нет');
}

console.log(fails === 0 ? '  --- случай пройден' : '  --- случай упал');
process.exit(fails ? 1 : 0);
