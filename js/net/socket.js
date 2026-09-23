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

/** Порт сокет-сервера (server/ws/server.php). */
export const PORT = 3893;

/** Как часто шлём своё положение, мс. Чаще сервера всё равно не нужно. */
export const SEND_EVERY = 200;

/** Ступени задержки перед повторным соединением, мс. */
const BACKOFF = [1000, 2000, 5000, 10000, 20000];

export const net = {
  // 'off' — не подключались; 'connecting'; 'live'; 'down' — оборвалось.
  state: 'off',
  peers: [],          // [{id, name, x, y, z, v, mode}] — только своя система
  you: null,
  error: null,
  sent: 0,
  got: 0,
};

let ws = null;
let timer = null;
let tries = 0;
let lastSend = 0;
let getPose = null;      // откуда брать своё положение
let stopped = false;

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
}

function open() {
  if (stopped) return;
  net.state = 'connecting';
  try {
    ws = new WebSocket(url());
  } catch (e) {
    net.state = 'down';
    net.error = 'сокет не открылся';
    retry();
    return;
  }

  ws.onopen = () => {
    tries = 0;
    // Первым делом представляемся — тем же токеном, что у API: две двери
    // с разными правилами рано или поздно разъезжаются.
    send({ t: 'hello', token: token() });
    if (timer) clearInterval(timer);
    timer = setInterval(pushPose, SEND_EVERY);
  };

  ws.onmessage = (ev) => {
    net.got++;
    let msg = null;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (!msg || !msg.t) return;

    if (msg.t === 'welcome') {
      net.state = 'live';
      net.you = msg.you;
      net.peers = msg.peers || [];
      net.error = null;
    } else if (msg.t === 'peers') {
      net.peers = msg.list || [];
    } else if (msg.t === 'leave') {
      net.peers = net.peers.filter((p) => p.id !== msg.id);
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
    net.state = stopped ? 'off' : 'down';
    if (timer) { clearInterval(timer); timer = null; }
    retry();
  };

  ws.onerror = () => { net.error = 'обрыв связи'; };
}

function retry() {
  if (stopped) return;
  const wait = BACKOFF[Math.min(tries, BACKOFF.length - 1)];
  tries++;
  // Ступенчатая задержка, а не постоянная: сервер могли просто не
  // запустить, и долбить его раз в секунду весь вечер незачем.
  setTimeout(open, wait);
}

function pushPose() {
  if (!ws || ws.readyState !== 1 || !getPose) return;
  const now = Date.now();
  if (now - lastSend < SEND_EVERY - 20) return;
  const p = getPose();
  if (!p) return;
  lastSend = now;
  send({
    t: 'pos', sys: p.sys,
    // Округляем до метра: дальше идут разряды, которых не видит ни один
    // прибор, а трафик они удваивают.
    x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
    v: +p.v.toFixed(3), mode: p.mode,
  });
}

function send(msg) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(msg));
    net.sent++;
  } catch (e) { /* закрылся между проверкой и отправкой */ }
}
