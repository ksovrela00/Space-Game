// Сокет: кто ещё летает в этой системе.
//
// Отдельно от api.js, потому что это про другое. API — «сделай и ответь»
// (купи, почини, сохрани), и каждый его вызов сам по себе. Сокет — «что
// происходит прямо сейчас», и он живёт всё время, пока игрок в игре.
//
// Почему не опрос по HTTP: положение чужих кораблей нужно по нескольку
// раз в секунду. На опросе это десятки запросов в секунду на игрока — с
// полным разбором PHP и новым соединением к базе каждый раз. Сокет
// держит одно соединение и получает по нему один снимок на тик.
//
// Своей записи о мире сокет не ведёт: он только отдаёт список чужих
// кораблей, а рисуют их приборы (js/main.js -> сканер). Это нужно, чтобы
// пропажа связи не ломала игру — список просто пустеет.

import { token } from './api.js';
import { smoothPing } from './quality.js';
import { L } from '../core/lang.js';

/** Порт сокет-сервера (server/ws/server.php). */
export const PORT = 3893;

/** Как часто шлём своё положение, мс. Чаще сервера всё равно не нужно. */
export const SEND_EVERY = 200;

/**
 * Как часто меряем пинг, мс.
 *
 * Реже, чем шлём положение: замер — это лишний пакет в обе стороны, а
 * задержка сети за две секунды не меняется настолько, чтобы это было
 * видно в цифре.
 */
export const PING_EVERY = 2000;

/** Ступени задержки перед повторным соединением, мс. */
const BACKOFF = [1000, 2000, 5000, 10000, 20000];

export const net = {
  // 'off' — не подключались; 'connecting'; 'live'; 'down' — оборвалось.
  state: 'off',
  // Корабли своей системы: [{id — номер корабля, by — кто ведёт, name,
  // x..z или b, lx..lz (оси тела), осанка, шасси, люки, dorm — спит}].
  peers: [],
  // Люди: [{id — игрок, name, st, s | b, x..z | lx..lz, yaw, pitch, v, air}].
  people: [],
  // Состав сети целиком: [{id, name, sys}] по ВСЕЙ галактике. Не
  // то же, что peers: те рядом и с координатами, а эти где угодно и
  // только числом системы. Приходит не в тик, а при изменениях
  // (server/src/Hub.php, sendRoster).
  roster: [],
  // Номер снимка. По нему игра отличает НОВЫЙ список от того же самого:
  // сглаживание чужого движения считает временем снимка время его
  // прихода, и принять один список дважды значит сказать, что корабль
  // полтика простоял на месте.
  rev: 0,
  // Кто ушёл: [{id — игрок или null, ship — корабль или null}]; игра
  // разбирает и очищает.
  left: [],
  // Время мира из последнего снимка (server/src/Clock.php). По нему игра
  // держит орбиты в одной фазе со всеми — иначе станция у каждого своя.
  wt: null,
  you: null,
  error: null,
  sent: 0,
  got: 0,
  // Задержка до сервера, мс (сглаженная), и приходы снимков — по ним
  // считается качество связи (js/net/quality.js).
  ping: null,
  beats: [],
  tick: 0.2,
  // Бой: чужие выстрелы и полученный урон. Очередь, а не поле, потому что
  // за один кадр их приходит несколько, а разбирает их игра — в своём
  // темпе и в своём порядке (js/main.js).
  events: [],
};

let ws = null;
let timer = null;
let tries = 0;
let lastSend = 0;
let getPose = null;      // откуда брать своё положение
let stopped = false;
let pingAt = 0;          // когда ушёл последний ping
let pingDue = 0;         // когда пора слать следующий
// Номер снимка положения и то, сколько топлива игра успела списать к
// его отправке (ship.burned). Сервер присылает бак «после снимка n», и
// по этой записи игра вычитает то, что потратила, пока ответ шёл назад
// (js/game/fuel.js, applyServerFuel). Окна в 64 снимка — тринадцать
// секунд — хватает с запасом на любую задержку.
let seq = 0;
const BURN_RING = 64;
const burnAt = new Array(BURN_RING).fill(null);

const url = () => 'ws://' + (location.hostname || 'localhost') + ':' + PORT;

/**
 * Начать держать связь.
 *
 * @param {function(): {sys:number,x:number,y:number,z:number,v:number,mode:string}} pose
 *        — игра отдаёт своё положение по запросу, а не присылает его
 *        сама: так сокет не лезет в игровой цикл и не удерживает ссылок
 *        на мир, который вот-вот выгрузят варп-прыжком.
 */
export function connect(pose) {
  if (!token()) return false;
  if (typeof WebSocket !== 'function') return false;
  getPose = pose;
  stopped = false;
  open();
  return true;
}

export function disconnect() {
  stopped = true;
  if (timer) { clearInterval(timer); timer = null; }
  if (ws) { try { ws.close(); } catch (e) { /* уже закрыт */ } }
  ws = null;
  net.state = 'off';
  net.peers = [];
  net.people = [];
  net.roster = [];
}

function open() {
  if (stopped) return;
  net.state = 'connecting';
  try {
    ws = new WebSocket(url());
  } catch (e) {
    net.state = 'down';
    net.error = L('сокет не открылся');
    retry();
    return;
  }

  ws.onopen = () => {
    tries = 0;
    // Первым делом представляемся — тем же токеном, что у API: две двери
    // с разными правилами рано или поздно разъезжаются.
    send({ t: 'hello', token: token() });
    if (timer) clearInterval(timer);
    net.ping = null;
    net.beats.length = 0;
    pingDue = 0;
    timer = setInterval(beat, SEND_EVERY);
  };

  ws.onmessage = (ev) => {
    net.got++;
    let msg = null;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (!msg || !msg.t) return;

    if (msg.t === 'pong') {
      // Ответ на свой же ping: вот она, честно измеренная задержка.
      net.ping = smoothPing(net.ping, now() - pingAt);
      return;
    }

    if (msg.t === 'welcome') {
      net.state = 'live';
      net.you = msg.you;
      if (typeof msg.tick === 'number' && msg.tick > 0) net.tick = msg.tick;
      mark();
      net.peers = msg.peers || [];
      net.people = msg.people || [];
      net.roster = msg.roster || [];
      if (typeof msg.wt === 'number') net.wt = msg.wt;
      net.rev++;
      net.error = null;
    } else if (msg.t === 'peers') {
      // Отмечаем КАЖДЫЙ снимок: по их ритму считаются потери. Сервер шлёт
      // их строго по тику, поэтому «пришло меньше, чем должно было» —
      // это и есть потери, других признаков у нас нет.
      mark();
      net.peers = msg.list || [];
      net.people = msg.people || [];
      if (typeof msg.wt === 'number') net.wt = msg.wt;
      net.rev++;
    } else if (msg.t === 'roster') {
      // Состав не считается снимком: по снимкам идёт счёт потерь
      // (js/net/quality.js), а приходят эти сообщения вразнобой —
      // отметить их значило бы завысить качество связи на ровном месте.
      net.roster = msg.list || [];
    } else if (msg.t === 'leave') {
      // Уходит человек, корабль — или оба. Корабль, на борту которого мы
      // едем, игра не выбросит: его ей пришлют и из прыжка.
      net.left.push({ id: msg.id === undefined ? null : msg.id, ship: msg.ship === undefined ? null : msg.ship });
      if (net.left.length > 64) net.left.shift();
    } else if (msg.t === 'fuel') {
      // Бак по счёту сервера. Идёт в ту же очередь, что и бой: разбирает
      // её игра, в своём темпе, — и к числу приложено, сколько игра
      // списала к отправке снимка n, чтобы вычесть расход после него.
      const at = burnAt[(msg.n | 0) % BURN_RING];
      net.events.push({
        t: 'fuel', fuel: msg.fuel, cap: msg.cap, n: msg.n | 0,
        burnedAt: at && at.n === (msg.n | 0) ? at.b : null,
      });
      if (net.events.length > 128) net.events.shift();
    } else if (msg.t === 'shot' || msg.t === 'hurt' || msg.t === 'hitok'
               || msg.t === 'boom' || msg.t === 'impact' || msg.t === 'hatchreq') {
      // Очередь не копим бесконечно: если игра почему-то перестала её
      // разбирать, сотня событий в памяти полезнее тысячи, а тысяча
      // ничем не лучше сотни.
      net.events.push(msg);
      if (net.events.length > 128) net.events.shift();
    } else if (msg.t === 'error') {
      net.error = msg.message || msg.code;
      // 'replaced' — игрок открыл игру в другом окне. Это не сбой связи,
      // и переподключаться нельзя: два окна начнут выбивать друг друга
      // по кругу.
      if (msg.code === 'replaced' || msg.code === 'auth') stopped = true;
    }
  };

  ws.onclose = () => {
    net.peers = [];
    net.people = [];
    net.roster = [];
    net.ping = null;
    net.beats.length = 0;
    net.state = stopped ? 'off' : 'down';
    if (timer) { clearInterval(timer); timer = null; }
    retry();
  };

  ws.onerror = () => { net.error = L('обрыв связи'); };
}

function retry() {
  if (stopped) return;
  const wait = BACKOFF[Math.min(tries, BACKOFF.length - 1)];
  tries++;
  // Ступенчатая задержка, а не постоянная: сервер могли просто не
  // запустить, и долбить его раз в секунду весь вечер незачем.
  setTimeout(open, wait);
}

const now = () => (typeof performance === 'object' && performance.now
  ? performance.now() : Date.now());

/** Отметка о пришедшем снимке; храним только окно, нужное для потерь. */
function mark() {
  net.beats.push(now() / 1000);
  if (net.beats.length > 64) net.beats.shift();
}

/** Раз в SEND_EVERY: своё положение, а изредка — замер задержки. */
function beat() {
  pushPose();
  const t = now();
  if (t >= pingDue) {
    pingDue = t + PING_EVERY;
    pingAt = t;
    send({ t: 'ping' });
  }
}

function pushPose() {
  if (!ws || ws.readyState !== 1 || !getPose) return;
  const now = Date.now();
  if (now - lastSend < SEND_EVERY - 20) return;
  const p = getPose();
  if (!p) return;
  lastSend = now;
  seq++;
  send(poseMessage(p, seq));
}

/**
 * Снимок для хаба: корабль, который игра ведёт (если ведёт), и сам пилот.
 *
 * Вынесено ради проверок (tools/test.mjs): что именно и с какой
 * точностью уходит в сеть, видно без сокета.
 */
export function poseMessage(p, n = 0) {
  const msg = { t: 'pos', sys: p.sys };
  if (p.ship) {
    const s = p.ship;
    const w = s.work || { main: 0, lift: 0, rcs: 0 };
    burnAt[n % BURN_RING] = { n, b: s.burned || 0 };
    Object.assign(msg, {
      sid: s.id,
      // Округляем до метра: дальше идут разряды, которых не видит ни один
      // прибор, а трафик они удваивают.
      x: +s.x.toFixed(3), y: +s.y.toFixed(3), z: +s.z.toFixed(3),
      v: +s.v.toFixed(3), mode: s.mode,
      // Куда смотрит нос и где у корабля верх. Без этого чужой корабль
      // нечем развернуть: по положению видно только путь, а не осанку, и
      // на месте он вообще смотрел бы в никуда. Четырёх знаков хватает —
      // это сотые доли градуса.
      fx: +s.fwd.x.toFixed(4), fy: +s.fwd.y.toFixed(4), fz: +s.fwd.z.toFixed(4),
      ux: +s.up.x.toFixed(4), uy: +s.up.y.toFixed(4), uz: +s.up.z.toFixed(4),
      // Шасси, открытые люки и работа подъёмных: соседу — чтобы корабль
      // стоял на стойках, люк был открыт, а сопла тлели как у нас.
      g: s.gear ? 1 : 0, h: s.hatches || [], k: +(s.lift || 0).toFixed(2),
      // Работа сопел с начала связи, км/с: маршевые, подъёмные, маневровые.
      // Это ИЗМЕРЕНИЕ, а не расход: тонны из него считает сервер своими
      // числами и не больше, чем двигатель может дать (server/src/Hub.php,
      // meter). Пять знаков — это сантиметры в секунду.
      wm: +w.main.toFixed(5), wl: +w.lift.toFixed(5), wr: +w.rcs.toFixed(5),
      n,
    });
    // У тела — то же в его осях: сосед рисует корабль с опозданием в
    // четверть секунды, а грунт под ним за это время уезжает на десятки
    // метров (js/game/peers.js). Шесть знаков километра — миллиметр.
    if (s.local) {
      const L = s.local;
      Object.assign(msg, {
        b: L.b, lx: +L.pos.x.toFixed(6), ly: +L.pos.y.toFixed(6), lz: +L.pos.z.toFixed(6),
        lfx: +L.fwd.x.toFixed(4), lfy: +L.fwd.y.toFixed(4), lfz: +L.fwd.z.toFixed(4),
        lux: +L.up.x.toFixed(4), luy: +L.up.y.toFixed(4), luz: +L.up.z.toFixed(4),
      });
    }
  }
  if (p.me) msg.me = p.me;
  return msg;
}

/**
 * Попросить люк ЧУЖОГО корабля (свой игра открывает сама). Решает тот,
 * кто его ведёт, а у спящего — сервер; просить можно только стоя рядом.
 */
export function askHatch(shipId, hatchId, open) {
  if (!ws || ws.readyState !== 1) return false;
  send({ t: 'hatch', ship: shipId | 0, id: String(hatchId), open: !!open });
  return true;
}

/**
 * Сказать всем: я выстрелил.
 *
 * Это ТОЛЬКО картинка — чужие увидят болт. Попадание считается отдельно
 * (reportHit) и проверяется сервером: иначе «вижу выстрел» и «получил
 * урон» пришлось бы выводить одно из другого, а они приходят разными
 * путями и в разное время.
 */
export function shoot(weapon, from, dir) {
  send({
    t: 'shot', w: weapon,
    x: +from.x.toFixed(3), y: +from.y.toFixed(3), z: +from.z.toFixed(3),
    dx: +dir.x.toFixed(4), dy: +dir.y.toFixed(4), dz: +dir.z.toFixed(4),
  });
}

/** Доложить о попадании. Урон посчитает и применит сервер. */
export function reportHit(playerId, weapon) {
  send({ t: 'hit', id: playerId | 0, w: weapon });
}

/**
 * Доложить об ударе о грунт.
 *
 * Шлём ИЗМЕРЕНИЕ, а не урон и тем более не корпус: во сколько обошёлся
 * удар, считает сервер (server/src/Combat.php). Тем же путём, что и
 * попадание в бою, и по той же причине — корпус это счёт, а счёт ведёт
 * не тот, кому он выставлен.
 *
 * @returns дошло ли (сокета может не быть — тогда зовут запрос)
 */
export function reportImpact(m) {
  if (!ws || ws.readyState !== 1) return false;
  send({
    t: 'impact',
    norm: +(m.norm || 0).toFixed(5),
    slide: +(m.slide || 0).toFixed(5),
    gear: !!m.gear,
    pose: !!m.pose,
    fatal: !!m.fatal,
  });
  return true;
}

function send(msg) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(msg));
    net.sent++;
  } catch (e) { /* закрылся между проверкой и отправкой */ }
}
