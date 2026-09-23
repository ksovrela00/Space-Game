// Живая проверка сокета: настоящий сервер, настоящая база, два клиента.
//
//   npm run ws:live
//
// В отличие от server/tests/hub.php, здесь проверяется ВСЯ цепочка —
// Ratchet, рукопожатие WebSocket, разбор кадров, база. Поэтому она и не
// входит в `npm run check`: ей нужны и запущенный MySQL, и Apache (за
// токенами), и свободный порт 3893. Логика присутствия проверяется без
// всего этого — там же, в hub.php.
//
// Сервер эта проверка поднимает и гасит сама.

import { spawn, spawnSync } from 'node:child_process';

const API = process.env.SOLAR_API || 'http://localhost/space_game/server/api.php';
const WS = 'ws://127.0.0.1:3893';

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + msg);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ждать СОБЫТИЯ, а не времени.
 *
 * Первая версия ждала «600 мс и хватит» — и мигала: тик сервера идёт раз
 * в 200 мс, но и он, и доставка сообщения зависят от загрузки машины.
 * Проверка, которая иногда проходит, хуже отсутствующей.
 */
async function until(cond, what, ms = 4000) {
  const till = Date.now() + ms;
  while (Date.now() < till) {
    if (cond()) return true;
    await wait(40);
  }
  ok(false, 'не дождались: ' + what);
  return false;
}

/**
 * Временный пилот для проверки.
 *
 * Заводим своих, а не ходим под настоящими: проверка не должна знать
 * ничьих паролей и не должна ломаться оттого, что пароль сменили (так и
 * вышло в первый раз). В конце они удаляются вместе с кораблём и лентой.
 */
const TEMP = ['wslive_a', 'wslive_b'];
async function tempPilot(login) {
  const res = await fetch(API + '?r=auth.register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, pass: 'wslive-' + Math.random().toString(36).slice(2), name: login }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(login + ': ' + body.error.message);
  return body.data.token;
}

function dropTemp() {
  for (const login of TEMP) {
    spawnSync(process.execPath, ['tools/php.mjs', 'server/cli/player.php', 'drop', login],
      { stdio: 'ignore' });
  }
}

/** Клиент: копит входящие сообщения. */
function client(name) {
  const ws = new WebSocket(WS);
  const got = [];
  ws.addEventListener('message', (e) => {
    try { got.push(JSON.parse(e.data)); } catch (err) { /* не наше */ }
  });
  return {
    name, ws, got,
    ready: new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', () => rej(new Error(name + ': не подключился')));
    }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    last: (t) => [...got].reverse().find((m) => m.t === t) || null,
    close: () => ws.close(),
  };
}

console.log('\n== сокет: живая проверка ==');

// PHP ищем тем же способом, что и остальные команды.
const php = spawnSync(process.execPath, ['tools/php.mjs', '-r', 'echo PHP_VERSION;'], {
  encoding: 'utf8',
});
if (php.status !== 0) {
  console.log('  PHP не найден — проверка пропущена');
  process.exit(0);
}

const server = spawn(process.execPath, ['tools/php.mjs', 'server/ws/server.php', '--quiet'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverErr = '';
server.stderr.on('data', (d) => { serverErr += d; });

const stop = () => { try { server.kill(); } catch (e) { /* уже мёртв */ } };
process.on('exit', stop);

try {
  await wait(1500);
  if (server.exitCode !== null) {
    console.log('  сервер не поднялся: ' + serverErr.trim().split('\n').pop());
    process.exit(1);
  }

  dropTemp();                                 // вдруг остались с прошлого раза
  const [t1, t2] = await Promise.all([tempPilot(TEMP[0]), tempPilot(TEMP[1])]);
  ok(!!t1 && !!t2, 'два временных пилота заведены, токены получены по HTTP');

  const a = client('A');
  const b = client('B');
  await Promise.all([a.ready, b.ready]);
  ok(true, 'оба клиента подключились к ' + WS);

  a.send({ t: 'hello', token: t1 });
  b.send({ t: 'hello', token: t2 });
  await until(() => a.last('welcome') && b.last('welcome'), 'приветствия от сервера');
  ok(a.last('welcome') !== null && b.last('welcome') !== null,
    'обоих пустили: ' + [a.last('welcome'), b.last('welcome')]
      .map((w) => (w ? w.you.name : '—')).join(' и '));

  // Ставим обоих в одну систему и ждём пару тиков.
  a.send({ t: 'pos', sys: 0, x: 100, y: 0, z: 0, v: 0.4, mode: 'flight' });
  b.send({ t: 'pos', sys: 0, x: 500, y: 0, z: 0, v: 0.2, mode: 'flight' });
  // Ищем ДРУГ ДРУГА ПО ИМЕНИ, а не считаем длину списка: в той же системе
  // может летать кто-то ещё — живой игрок в браузере, например. Проверка,
  // которой нужен пустой мир, падает не по делу, и ровно так и вышло: в
  // списках оказался чужой корабль, и длина стала двойкой.
  const sees = (who, name) => ((who.last('peers') || { list: [] }).list)
    .find((p) => p.name === name) || null;

  await until(() => sees(a, TEMP[1]) && sees(b, TEMP[0]),
    'снимка, где оба видят друг друга');

  const seenByA = sees(a, TEMP[1]);
  const seenByB = sees(b, TEMP[0]);
  ok(!!seenByA && Math.abs(seenByA.x - 500) < 1e-6,
    'A видит B на x = ' + (seenByA ? seenByA.x : '—'));
  ok(!!seenByB && Math.abs(seenByB.x - 100) < 1e-6,
    'B видит A на x = ' + (seenByB ? seenByB.x : '—'));

  // Разводим по системам — видеть друг друга перестают.
  b.send({ t: 'pos', sys: 4, x: 0, y: 0, z: 0, v: 0, mode: 'flight' });
  await until(() => !sees(a, TEMP[1]), 'снимка без соседа');
  ok(!sees(a, TEMP[1]), 'после варпа в другую систему сосед пропал из виду');

  // Возвращаем B в общую систему: сообщение об уходе рассылается тем, кто
  // рядом, и «ушёл из другой системы» до A дойти не должно — в первом
  // заходе проверка падала именно на этом, и падала по делу.
  b.send({ t: 'pos', sys: 0, x: 500, y: 0, z: 0, v: 0.2, mode: 'flight' });
  await until(() => sees(a, TEMP[1]), 'возвращения соседа');

  // Уход: сообщение приходит сразу.
  b.close();
  await until(() => a.last('leave') !== null, 'сообщения об уходе');
  ok(a.last('leave') !== null, 'об уходе сообщили сразу');

  a.close();
  await wait(200);
} catch (e) {
  ok(false, 'проверка оборвалась: ' + e.message);
} finally {
  stop();
  dropTemp();
}

console.log('\n' + (fails === 0 ? 'СОКЕТ: ЖИВАЯ ПРОВЕРКА ПРОЙДЕНА' : fails + ' ПРОВЕРОК УПАЛО'));
process.exit(fails ? 1 : 0);
