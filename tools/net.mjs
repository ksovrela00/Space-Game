// Проверка сетевого запуска игры: вход, состояние с сервера, сохранение.
//
// Отдельный набор, а не шаги в tools/smoke.mjs, по простой причине:
// main.js читает окружение (токен, адрес, ответы сервера) ОДИН раз при
// загрузке модуля, и три разных случая в одном процессе не проверить. Эта
// проверка запускает саму себя тремя дочерними процессами:
//
//   server   — токен есть, сервер отвечает: игра поднимается с сервера;
//   lost     — токен есть, сервера нет: игра НЕ стартует, на экране «нет
//              связи», попытки снова; сервер ответил — поднимается сама;
//   notoken  — токена нет: игра не стартует, а уходит на страницу входа.
//
// Сервер здесь поддельный: настоящий PHP проверяется своим набором
// (server/tests/run.php). Здесь проверяется КЛИЕНТ — то, как игра ведёт
// себя при каждом из трёх ответов.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const arg = process.argv.find((a) => a.startsWith('--case='));
const CASE = arg ? arg.slice(7) : null;

// --- запуск всех случаев ------------------------------------------------------

if (!CASE) {
  console.log('\n== сеть: запуск игры с сервером ==');
  let bad = 0;
  for (const name of ['server', 'lost', 'notoken', 'wreck', 'onfoot', 'outside', 'rider']) {
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
  // Фокус и прокрутка: настоящий узел умеет и то и другое, а экраны этим
  // пользуются — длинную справку прокручивают клавишами, и панель берёт
  // фокус при открытии (js/ui/screens.js).
  tabIndex: 0, scrollTop: 0, scrollHeight: 0, clientHeight: 0,
  focus() {}, closest: () => null,
});
const nodes = { screen: el('screen'), hud: el('hud'), overlay: el('overlay'),
  panel: el('panel'), boot: el('boot'), bootBtn: el('bootBtn'), bootBody: el('bootBody'),
  link: el('link'), linkTitle: el('linkTitle'), linkBody: el('linkBody') };
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

// Язык проверок — русский: в них сверяются НАДПИСИ, и держать их в двух
// видах значило бы писать каждую проверку дважды. Английский путь
// проверяется отдельным шагом, который язык переключает сам.
const store = { solar_lang: 'ru' };
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

globalThis.location = {
  origin: 'http://localhost',
  pathname: '/space_game/index.html',
  search: '',
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

// --- пилот не в кресле -----------------------------------------------------------
//
// Центр игры — пилот, а не корабль: при входе он обязан оказаться там,
// где был, — на палубе, на грунте, пассажиром в чужом корабле, — а не
// за штурвалом. Корабль при этом стоит там, где его оставили.
const { systemById } = await import('../js/game/galaxy.js');
const { makeSystem } = await import('../js/game/world.js');
const { isLandable, groundRadius } = await import('../js/game/surface.js');
const landOn = (sysId) => makeSystem(systemById(sysId)).bodies.find((b) => isLandable(b) && b.kind !== 'moon');
const poseOn = (R, dx = 0) => {
  const l = Math.hypot(dx, R);
  return { dir: { x: dx / l, y: R / l, z: 0 }, radius: R + 0.006,
    right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, fwd: { x: 0, y: 0, z: 1 } };
};
const HOME_LAND = landOn(0);
const DECK = [0.6, 0, -6.5];
if (CASE === 'onfoot' || CASE === 'outside' || CASE === 'rider') {
  Object.assign(SERVER_STATE.position, {
    systemId: 0, pos: { x: 0, y: 0, z: 0 }, landedBody: HOME_LAND.id,
    landedPose: poseOn(HOME_LAND.radius), landedSecured: true, view: 'cockpit', hatches: ['nL'],
  });
  SERVER_STATE.ship.gearOut = true;
}
if (CASE === 'onfoot') {
  SERVER_STATE.me = { systemId: 0, aboard: 1, seated: false, out: null,
    walk: { pos: DECK, yaw: 0.7, pitch: -0.1 } };
}
if (CASE === 'outside') {
  // Записан он на грунте (в сорока сантиметрах над ним), а не на уровне
  // моря: под рельефом не стоят (js/game/walker.js), и пилота с такой
  // записи поднимает на грунт — на Lave I здесь это четырнадцать с
  // половиной километров.
  const q = { x: 0.03, y: HOME_LAND.radius, z: 0.02 }, ql = Math.hypot(q.x, q.y, q.z);
  const at = groundRadius(HOME_LAND, { x: q.x / ql, y: q.y / ql, z: q.z / ql }) + 0.0004;
  SERVER_STATE.me = { systemId: 0, aboard: null, seated: false, walk: null,
    out: { body: HOME_LAND.id, o: { x: q.x / ql * at, y: q.y / ql * at, z: q.z / ql * at },
      f: { x: 1, y: 0, z: 0 }, pitch: 0.2 } };
}
const RIDE_SYS = 2;
const RIDE_LAND = CASE === 'rider' ? landOn(RIDE_SYS) : null;
if (CASE === 'rider') {
  SERVER_STATE.me = { systemId: RIDE_SYS, aboard: 77, seated: false, out: null,
    walk: { pos: DECK, yaw: -1.2, pitch: 0 } };
  SERVER_STATE.aboard = { id: 77, ownerId: 5, ownerName: 'ХОЗЯИН', name: '', type: { code: 'challenger' },
    systemId: RIDE_SYS, pos: { x: 0, y: 0, z: 0 }, basis: null, dockedBody: null,
    landedBody: RIDE_LAND.id, landedPose: poseOn(RIDE_LAND.radius, 0.2), landedSecured: true,
    anchorBody: null, anchorPose: null, gearOut: true, hatches: ['nR'] };
}

// --- характеристики: с сервера или из слепка -----------------------------------
//
// Числа корабля игра берёт у бэкенда, и здесь проверяется, у КАКОГО
// именно. Поддельный сервер отдаёт заведомо другой предел скорости, чем
// лежит в слепке: совпади они — и проверка не смогла бы отличить «взяли
// с сервера» от «взяли с диска», а это и есть весь её смысл.

const SNAPSHOT = JSON.parse(readFileSync('server/data/specs.json', 'utf8'));
const SERVER_TOP_SPEED = 2.5;
const SERVER_SPECS = JSON.parse(JSON.stringify(SNAPSHOT));
// Скорость принадлежит ДВИГАТЕЛЮ, а не корпусу: подменяем её там же,
// где её берёт игра, иначе проверка проверяла бы несуществующий путь.
/** Предел хода в слепке: он у двигателя, который стоит в гнезде. */
const snapshotTopSpeed = () => SNAPSHOT.modules
  .find((m) => m.slot === 'engine' && m.installed).spec.flight.maxSpeed;

SERVER_SPECS.modules.find((m) => m.slot === 'engine').spec.flight.maxSpeed = SERVER_TOP_SPEED;

const calls = [];
let saved = null;
// Случай lost: сервер «лежит», пока проверка его не поднимет.
let serverUp = CASE !== 'lost';
// Цена топлива у поддельного порта и варп, который он «списал» при
// следующем сохранении.
const FUEL_PRICE = 80;
let SERVER_WARP = 0;

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

  if (!serverUp) {
    // Сервера нет вовсе: fetch падает так же, как при обрыве сети.
    throw new TypeError('failed to fetch');
  }
  const reply = (data) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });

  if (route === 'catalog.specs') {
    return reply(SERVER_SPECS);
  }
  if (route === 'player.state' && CASE === 'wreck') {
    // Разбитый корабль: корпус РОВНО ноль. Случай не выдуманный — ровно
    // так и лежат в базе пилоты, которых сбили и которые не возродились.
    const wreck = JSON.parse(JSON.stringify(SERVER_STATE));
    wreck.ship.hull = 0;
    wreck.ship.shield = 0;
    return reply(wreck);
  }
  if (route === 'player.state') {
    if (!opts.headers || opts.headers['X-Auth-Token'] !== TOKEN) {
      return { ok: false, status: 401, json: async () => ({ ok: false,
        error: { code: 'auth', message: 'нужен вход' } }) };
    }
    return reply(SERVER_STATE);
  }
  if (route === 'player.save') {
    saved = body.save;
    // Сервер подтверждает варп, о котором узнал из сохранения: игра гасит
    // этим свой долг по прыжку.
    const warpFuel = SERVER_WARP;
    SERVER_WARP = 0;
    return reply({ saved: true, fields: 12, fuel: SERVER_STATE.ship.fuelT, warpFuel });
  }
  // --- порт: заправка, рынок, верфь. Поддельный сервер меняет СВОЁ
  // состояние, и игра обязана узнать об этом из него, а не посчитать сама.
  if (route === 'market.prices') {
    return reply({ station: { name: 'ПОРТ', tech: 5 }, fuelPrice: FUEL_PRICE, goods: [
      { code: 'water', name: 'ВОДА', category: 'сырьё', legal: true, base_price: 30, price: 30, stock: 100 },
      { code: 'grain', name: 'ЗЕРНО', category: 'продовольствие', legal: true, base_price: 65, price: 60, stock: 50 },
    ] });
  }
  if (route === 'station.refuel') {
    const room = 12 - SERVER_STATE.ship.fuelT;
    const tons = typeof body.tons === 'number' ? Math.min(body.tons, room) : room;
    const cost = Math.ceil(tons * FUEL_PRICE);
    SERVER_STATE.ship.fuelT += tons;
    SERVER_STATE.player.balance -= cost;
    return reply({ fuel: SERVER_STATE.ship.fuelT, cap: 12, tons, price: FUEL_PRICE, cost,
      balance: SERVER_STATE.player.balance });
  }
  if (route === 'market.buy') {
    const sum = Math.round(30 * body.tons);
    SERVER_STATE.player.balance -= sum;
    SERVER_STATE.cargo.push({ commodity_id: 1, code: body.code, name: 'ВОДА', category: 'сырьё',
      legal: true, tons: body.tons, avg_price: 30 });
    return reply({ code: body.code, tons: body.tons, price: 30, sum: -sum,
      balance: SERVER_STATE.player.balance });
  }
  if (route === 'outfit.list') {
    return reply({ open: true, resale: 0.6, balance: SERVER_STATE.player.balance, slots: [] });
  }
  if (route === 'outfit.buy') {
    // Заменили двигатель: состояние пилота приходит с новым набором
    // модулей, и корабль обязан пересобраться по нему.
    SERVER_STATE.ship.equipment = SERVER_SPECS.modules
      .filter((m) => m.installed && m.slot !== 'engine').concat([
        SERVER_SPECS.modules.find((m) => m.code === body.code)])
      .map((m) => ({ code: m.code, name: m.name, slot: m.slot, spec: m.spec, level: 1, health: 100 }));
    SERVER_STATE.player.balance -= 23800;
    return reply({ installed: body.code, removed: 'engine', cost: 23800,
      balance: SERVER_STATE.player.balance, fuel: SERVER_STATE.ship.fuelT, refund: 0 });
  }
  if (route === 'pilot.move') {
    return reply({ moved: true, me: SERVER_STATE.me || null });
  }
  if (route === 'station.dock') {
    return reply({ station: { systemId: 0, localId: body.station, name: 'ПОРТ', tech: 4,
      fee: 68, repairRate: 18, pads: 6,
      services: { market: true, board: true, repair: true, outfit: true } },
    fee: 68, charged: true, balance: 12277 });
  }
  return reply({});
};

if (CASE !== 'notoken') store['solar_trader_token'] = TOKEN;
// Сокет — поддельный (tools/fakeapi.mjs): на hello отвечает welcome, и
// игра, которая без хаба стоит, едет. Настоящий хаб в проверках не нужен.
{
  const { makeFakeServer } = await import('./fakeapi.mjs');
  const sock = makeFakeServer({ specs: SNAPSHOT });
  // Время мира и состав сети у сокета — те же, что у API: сервер один.
  sock.state.world = SERVER_STATE.world;
  sock.roster = [{ id: 1, name: 'ПИЛОТ', sys: SERVER_STATE.position.systemId }];
  if (CASE === 'rider') sock.roster.push({ id: 5, name: 'ХОЗЯИН', sys: RIDE_SYS });
  globalThis.WebSocket = sock.WebSocket;
}

// --- поехали ------------------------------------------------------------------

// Запуск идёт ЧЕРЕЗ ЗАГРУЗЧИК, как в браузере: он получает
// характеристики корабля и только потом поднимает игру. Звать main.js
// напрямую значило бы проверять порядок, которого в игре нет.
// Без сервера загрузчик ждёт его вечно — поэтому в случае lost его не
// дожидаемся, а смотрим, что он делает, пока ждёт.
const booting = import('../js/boot.js');
if (CASE === 'lost') {
  await new Promise((r) => setTimeout(r, 300));
  ok(!globalThis.window.GAME && !rafCb, 'сервера нет — игра не запускается: ни мира, ни кадров');
  ok(/НЕТ СВЯЗИ С СЕРВЕРОМ/.test(nodes.bootBody.innerHTML), 'на стартовом экране — «нет связи с сервером»');
  ok(location.replaced === null, 'на страницу входа не выкидывает: вход-то есть');
  serverUp = true;                // сервер поднялся — загрузчик заметит сам
}
await booting;

const mod = await import('../js/main.js');
// Запуск игры асинхронный: ждём, пока он доберётся до конца.
await new Promise((r) => setTimeout(r, 50));
const game = globalThis.window.GAME;
const { session } = await import('../js/net/session.js');

if (CASE === 'wreck') {
  // Ноль — это число, а не «значения нет». Здесь стояло `s.hull || max`,
  // и разбитый корабль приезжал целёхоньким: на экране сотня, на сервере
  // ноль, и первое же попадание убивало «полный» корпус.
  ok(game && game.ship.hull === 0,
    'корпус ровно 0 доехал нулём, а не полным: ' + (game ? game.ship.hull : 'игры нет'));
  ok(game && game.ship.shield === 0,
    'щит тоже: ' + (game ? game.ship.shield : '—'));
}

if (CASE === 'onfoot' || CASE === 'outside' || CASE === 'rider') {
  // Помещения собираются лениво и только там, где есть кабина: в этом
  // стенде её дают руками (как в tools/smoke.mjs), и пилот встаёт туда,
  // где был, ровно в тот момент, когда они готовы.
  const { buildCockpit } = await import('../js/models/cockpit.js');
  ok(!game.walk.on, 'пока помещений нет, ставить пилота некуда: ждём');
  game.cockpit = buildCockpit();
  await game.loadInterior();
  frames(5);
  const w = game.walk;
  ok(game.state.mode === (CASE === 'rider' ? 'flight' : 'landed'), 'режим: ' + game.state.mode);
  if (CASE === 'onfoot') {
    ok(w.on && w.phase === 'walk' && !w.out && w.vessel === game.ownVessel
      && Math.hypot(w.pos[0] - DECK[0], w.pos[2] - DECK[2]) < 0.05 && Math.abs(w.yaw - 0.7) < 1e-6,
      'при входе пилот на палубе, где ходил, — не в кресле: ' + w.pos.map((v) => v.toFixed(2)).join(', '));
    ok(game.ship.landedAt && game.ship.landedAt.id === HOME_LAND.id && game.interior.air.hatches.find((h) => h.id === 'nL').open === 1,
      'корабль на своей стоянке на ' + HOME_LAND.name + ', люк, оставленный открытым, открыт');
  }
  if (CASE === 'outside') {
    const { groundToWorld } = await import('../js/game/outside.js');
    const { bodyWorld } = await import('../js/game/vessels.js');
    const P = groundToWorld(w.out, w.pos);
    const want = bodyWorld(w.out.body, SERVER_STATE.me.out.o);
    const d = Math.hypot(P.x - want.x, P.y - want.y, P.z - want.z) * 1000;
    ok(w.on && w.out && w.out.body.id === HOME_LAND.id && d < 1.5,
      'при входе пилот на грунте ' + HOME_LAND.name + ' там же, где стоял: ' + d.toFixed(2) + ' м от записи');
  }
  if (CASE === 'rider') {
    const V = w.vessel;
    ok(game.sys.id === RIDE_SYS && game.ship.away === true,
      'пилот в системе ' + game.sys.id + ' пассажиром, свой корабль остался в системе 0');
    ok(w.on && V && !V.own && V.id === 77 && V.name === 'ХОЗЯИН' && V.air
      && Math.hypot(w.pos[0] - DECK[0], w.pos[2] - DECK[2]) < 0.05,
      'стоит на палубе чужого корабля #' + (V && V.id) + ' (' + (V && V.name) + ')');
    const B = game.world.bodies.find((b) => b.id === RIDE_LAND.id);
    const R = Math.hypot(V.pos.x - B.pos.x, V.pos.y - B.pos.y, V.pos.z - B.pos.z);
    ok(Math.abs(R - RIDE_LAND.radius - 0.006) < 1e-6 && V.air.hatches.find((h) => h.id === 'nR').want,
      'чужой корабль на своей стоянке у ' + RIDE_LAND.name + ', его люк открыт');
  }
  // Сохранение: место пилота и место корабля — отдельно. Берётся
  // последнее, что игра положила в очередь к серверу (js/net/session.js):
  // до отправки его держит пауза SAVE_EVERY.
  for (const fn of nodes.bootBtn.listeners.click || []) fn();
  nowMs += 20000;
  frames(60 * 9);
  saved = session.dirty || saved;
  ok(saved && saved.me && saved.me.seated !== true, 'на сервер ушло место пилота: ' + JSON.stringify(saved && saved.me).slice(0, 90));
  if (CASE === 'rider') {
    ok(saved && saved.ship === null && saved.me.aboard === 77 && saved.system === RIDE_SYS,
      'свой корабль из другой системы сервер не переписывает: ship = null, пилот на борту #77');

    // Хозяин вышел из игры. Пока сервер его ждёт (Hub::GRACE), корабль
    // стоит под ногами, и пассажиру об этом говорят — по составу сети:
    // хозяина в нём больше нет.
    const { net } = await import('../js/net/socket.js');
    const said = (part) => game.state.messages.some((m) => m.text.indexOf(part) >= 0);
    const wasState = net.state;
    net.state = 'live';
    net.roster = [{ id: 1, name: 'ПИЛОТ', sys: RIDE_SYS }];
    frames(3);
    ok(said('ЖДЁМ ЕГО') && w.on && w.vessel && w.vessel.id === 77,
      'хозяин вышел из игры — пассажир всё ещё на его палубе, и ему сказали, что его ждут');
    net.state = wasState;
    net.roster = [];
    // Не дождались: сервер посадил пассажира в кресло своего корабля
    // (Hub::strand) — игра забирает место у него.
    SERVER_STATE.me = { systemId: 0, aboard: 1, seated: true, walk: null, out: null };
    SERVER_STATE.aboard = null;
    net.events.push({ t: 'home', ship: 77, by: 5, home: 1 });
    frames(2);
    await new Promise((r) => setTimeout(r, 30));
    frames(5);
    ok(!w.on && game.sys.id === 0 && !game.ship.away && game.ship.landedAt
      && game.ship.landedAt.id === HOME_LAND.id && !game.peers.some((p) => p.id === 77),
      'не дождались — пассажир в кресле своего корабля на ' + HOME_LAND.name + ' (система '
        + game.sys.id + '), чужого корабля в мире нет');
    ok(said('ВЫ НА СВОЁМ КОРАБЛЕ'), 'и ему сказали, почему');
  } else {
    ok(saved && saved.ship && saved.ship.landed && saved.ship.landed.id === HOME_LAND.id
      && saved.ship.hatches.includes('nL'),
      'корабль остался на стоянке с открытым люком: ' + JSON.stringify(saved && saved.ship && saved.ship.hatches));
  }
}

if (CASE === 'notoken') {
  ok(location.replaced === 'login.html', 'без входа игра уходит на страницу входа');
  ok(!game || !rafCb, 'кадры при этом не запускаются');
  // Без входа к серверу не ходим вовсе: спрашивать нечего, а игра без
  // входа не запускается — характеристики корабля ей не нужны.
  const apiCalls = calls.filter((u) => u.indexOf('api.php') >= 0);
  ok(apiCalls.length === 0, 'без входа к серверу не ходим вовсе');
}

if (CASE === 'server') {
  ok(session.mode === 'online', 'режим связи: ' + session.mode);
  // Числа корабля пришли С СЕРВЕРА, а не с диска: предел хода у
  // поддельного сервера свой.
  const { SHIP } = await import('../js/game/ship.js');
  ok(SHIP.maxSpeed === SERVER_TOP_SPEED,
    'предел хода взят у сервера: ' + SHIP.maxSpeed + ' км/с (в слепке '
    + snapshotTopSpeed() + ')');
  ok(calls.some((u) => u.indexOf('catalog.specs') >= 0),
    'за характеристиками игра сходила к серверу');
  ok(!!game, 'игра поднялась');
  ok(Math.abs(game.ship.pos.x - SERVER_STATE.position.pos.x) < 1e-6,
    'место взято с сервера: x = ' + game.ship.pos.x);
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
    frames(5);                      // приветствие сокета (время мира) — до сна, как в жизни
    nowMs += 300000;                // пять минут вкладка была в фоне
    frames(30);
    const behind = SERVER_STATE.world.time + 300 - game.world.time;
    ok(game.world.time - before > 200 && Math.abs(behind) < 5,
      'после спящей вкладки часы догоняют общие: отставание '
      + behind.toFixed(1) + ' с');
  }

  // Местной копии нет: правда одна, и она на сервере.
  ok(!Object.keys(store).some((k) => k.startsWith('solar_trader_save')), 'местного сохранения игра не пишет');

  // Сохранение уходит на сервер — не чаще раза в SAVE_EVERY секунд.
  for (const fn of nodes.bootBtn.listeners.click || []) fn();
  frames(30);
  nowMs += 20000;                 // прошло время — можно слать
  frames(60 * 8);
  ok(saved !== null, 'сохранение ушло на сервер');
  ok(saved && typeof saved.system === 'number' && 'hull' in saved && 'player' in saved,
    'на сервер уходит снимок игры: система, корпус, дела пилота');

  // --- ПОРТ ЧЕРЕЗ СЕРВЕР: заправка, рынок, верфь.
  //
  // Экран станции ничего не считает сам: он шлёт «что и сколько», а бак,
  // деньги, трюм и модули берёт из состояния, которое вернул сервер.
  {
    const S = await import('../js/ui/station.js');
    const { SHIP } = await import('../js/game/ship.js');
    const settle = () => new Promise((r) => setTimeout(r, 10));
    game.ship.dockedAt = game.world.stations[0];
    game.state.mode = 'docked';
    game.port = { tech: 5, fee: 68, repairRate: 18,
      services: { market: true, board: true, repair: true, outfit: true } };
    SERVER_STATE.ship.fuelT = 4;
    game.ship.fuel = 4;
    S.showDocked(game);
    S.stationAct(game, 'tab', { tab: 'fuel' });
    await settle();
    ok(/ДО ПОЛНОГО · 8 т · 640/.test(nodes.panel.innerHTML),
      'цену заправки экран взял у сервера: 8 т по ' + FUEL_PRICE + ' кр');
    const before = game.player.balance;
    S.stationAct(game, 'refuel', { tons: 'full' });
    await settle();
    ok(calls.some((u) => u.indexOf('station.refuel') >= 0) && game.ship.fuel === 12
      && game.player.balance === before - 640,
      'заправка прошла через сервер: бак ' + game.ship.fuel + ' т, счёт ' + game.player.balance);
    ok(/ЗАПРАВКА: 8 т/.test(nodes.panel.innerHTML), 'и экран сказал, сколько налито и почём');

    S.stationAct(game, 'tab', { tab: 'market' });
    await settle();
    S.stationAct(game, 'buy', { code: 'water', name: 'ВОДА', tons: '2' });
    await settle();
    const water = game.player.cargo.find((c) => c.code === 'water');
    ok(water && water.tons === 2, 'купленная вода легла в трюм по ответу сервера');

    S.stationAct(game, 'fit', { code: 'engine_x', name: 'ФОРСИРОВАННЫЙ ДВИГАТЕЛЬ' });
    await settle();
    const fx = SERVER_SPECS.modules.find((m) => m.code === 'engine_x').spec.flight;
    ok(SHIP.maxSpeed === fx.maxSpeed && SHIP.exhaust === fx.exhaust,
      'после замены двигателя корабль пересобран по новому: ' + SHIP.maxSpeed + ' км/с, струя '
      + SHIP.exhaust + ' км/с');

    // Бак по сокету: число сервера за вычетом того, что игра потратила
    // после снимка, по которому он считал.
    const { net } = await import('../js/net/socket.js');
    game.ship.burned += 0.25;
    net.events.push({ t: 'fuel', fuel: 7.5, cap: 12, n: 3, burnedAt: game.ship.burned - 0.25 });
    frames(1);
    ok(Math.abs(game.ship.fuel - 7.25) < 1e-9, 'бак из сокета сведён со своим расходом: ' + game.ship.fuel);

    // Долг по варпу гасится ответом на сохранение. Отправку зовём прямо:
    // очередь сохранений меряет настоящее время, а не время стенда.
    const { flush } = await import('../js/net/session.js');
    game.ship.warpDebt = 3.35;
    SERVER_WARP = 3.35;
    game.ship.dockedAt = null;
    game.state.mode = 'flight';
    frames(60 * 6);
    await flush();
    await settle();
    ok(game.ship.warpDebt === 0, 'сохранение подтвердило варп — долг по прыжку погашен');
  }

  // Закрытие вкладки: последнее сохранение маячком.
  for (const fn of winListeners.beforeunload || []) fn();
  ok(beacons > 0, 'при закрытии вкладки уходит маячок sendBeacon');
}

if (CASE === 'lost') {
  // Сервер поднялся — загрузчик это заметил и поднял игру сам, без
  // перезагрузки страницы, и сразу с серверным состоянием.
  const { SHIP } = await import('../js/game/ship.js');
  ok(!!game && session.mode === 'online', 'сервер ответил — игра поднялась сама: ' + session.mode);
  ok(SHIP.maxSpeed === SERVER_TOP_SPEED && Math.abs(game.ship.pos.x - SERVER_STATE.position.pos.x) < 1e-6,
    'и сразу с сервера: характеристики и место');
  for (const fn of nodes.bootBtn.listeners.click || []) fn();
  ok(frames(60), 'кадры идут');

  // Связь пропала посреди полёта — игра стоит под надписью и ждёт.
  serverUp = false;
  const { flush } = await import('../js/net/session.js');
  session.dirty = { probe: 1 };
  await flush();
  const x0 = game.ship.pos.x;
  game.ship.vel.x = 1;
  frames(30);
  const shown = !nodes.link.classList.contains('hidden') && /НЕТ СВЯЗИ/.test(nodes.linkTitle.textContent);
  ok(session.mode === 'lost' && Math.abs(game.ship.pos.x - x0) < 1e-9 && shown,
    'связь пропала — игра стоит под надписью «нет связи»: корабль не сдвинулся ни на метр');
  // Вернулась — игра едет дальше сама.
  // Пробы связи идут по настоящим часам: раз в три секунды.
  serverUp = true;
  await new Promise((r) => setTimeout(r, 3100));
  frames(1);
  await new Promise((r) => setTimeout(r, 30));
  frames(10);
  ok(session.mode === 'online' && game.ship.pos.x > x0 && nodes.link.classList.contains('hidden'),
    'связь вернулась — надпись ушла, игра поехала дальше сама');
}

console.log(fails === 0 ? '  --- случай пройден' : '  --- случай упал');
process.exit(fails ? 1 : 0);
