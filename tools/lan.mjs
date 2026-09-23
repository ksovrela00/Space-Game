// Готова ли машина к игре по локальной сети.
//
//   npm run lan
//
// Отвечает на один вопрос: почему с другого компьютера не подключается.
// Ответ почти всегда один из трёх — не тот адрес, не запущен сервер,
// закрыт брандмауэр, — и все три здесь видно сразу, вместе с командой,
// которой чинится третий.
//
// Ничего не меняет: правила брандмауэра требуют прав администратора, и
// открывать порты втихую эта проверка не должна.

import { networkInterfaces } from 'node:os';
import { createConnection } from 'node:net';
import { execFileSync } from 'node:child_process';

const PORTS = [
  { port: 80, what: 'Apache: игра и API' },
  { port: 3893, what: 'сокет: кто где летает' },
];

const ok = (s) => '  [32mOK[0m   ' + s;
const bad = (s) => '  [31m--[0m   ' + s;

console.log('\n== игра по локальной сети ==\n');

// --- адрес -------------------------------------------------------------------

const addrs = [];
for (const [name, list] of Object.entries(networkInterfaces())) {
  for (const a of list || []) {
    // 169.254.x — адрес «сети нет»: его выдаёт сама Windows, когда не
    // получила настоящий. Такой адрес в списке только путает.
    if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
      addrs.push({ name, address: a.address });
    }
  }
}

if (!addrs.length) {
  console.log(bad('сетевого адреса нет вовсе — машина не в сети'));
} else {
  for (const a of addrs) {
    console.log(ok(`адрес ${a.address}  (${a.name})`));
  }
  const main = addrs[0].address;
  console.log('');
  console.log('  с другого компьютера открывать:');
  console.log('    http://' + main + '/space_game/');
}

// --- порты -------------------------------------------------------------------

console.log('');
const alive = (port) => new Promise((res) => {
  const s = createConnection({ port, host: '127.0.0.1' });
  const done = (v) => { s.destroy(); res(v); };
  s.setTimeout(700);
  s.on('connect', () => done(true));
  s.on('timeout', () => done(false));
  s.on('error', () => done(false));
});

const listening = {};
for (const p of PORTS) {
  listening[p.port] = await alive(p.port);
  console.log(listening[p.port]
    ? ok(`порт ${p.port} слушается — ${p.what}`)
    : bad(`порт ${p.port} закрыт — ${p.what}`));
}
if (!listening[80]) console.log('       запустить Apache в панели XAMPP');
if (!listening[3893]) console.log('       запустить: npm run ws');

// --- брандмауэр ---------------------------------------------------------------

console.log('');
let rules = '';
try {
  // netsh читается без прав администратора — менять правила ими нельзя,
  // а смотреть можно.
  rules = execFileSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=all', 'dir=in'],
    { encoding: 'latin1', maxBuffer: 32 * 1024 * 1024 });
} catch (e) {
  console.log(bad('не удалось спросить брандмауэр: ' + e.message));
}

/** Есть ли ВКЛЮЧЁННОЕ разрешающее правило на этот порт. */
const allowed = (port) => {
  // Правила идут блоками, разделёнными пустой строкой; нас интересует
  // блок, где сошлись три условия: включено, разрешает, тот самый порт.
  for (const block of rules.split(/\r?\n\r?\n/)) {
    if (!new RegExp('(?:LocalPort|Локальный порт):\\s*' + port + '\\s*$', 'm').test(block)) continue;
    const on = /(?:Enabled|Включено):\s*(Yes|Да)/i.test(block);
    const allow = /(?:Action|Действие):\s*(Allow|Разрешить)/i.test(block);
    if (on && allow) return true;
  }
  return false;
};

const closed = [];
for (const p of PORTS) {
  const good = rules ? allowed(p.port) : null;
  if (good === null) continue;
  console.log(good
    ? ok(`брандмауэр пропускает порт ${p.port}`)
    : bad(`брандмауэр НЕ пропускает порт ${p.port}`));
  if (!good) closed.push(p);
}

if (closed.length) {
  console.log('');
  console.log('  Открыть порты (PowerShell ОТ ИМЕНИ АДМИНИСТРАТОРА):');
  for (const p of closed) {
    console.log(`    New-NetFirewallRule -DisplayName "Solar Trader ${p.port}" \``);
    console.log(`      -Direction Inbound -Protocol TCP -LocalPort ${p.port} \``);
    console.log('      -Action Allow -Profile Domain,Private');
  }
  console.log('');
  console.log('  Убрать потом:');
  console.log('    Remove-NetFirewallRule -DisplayName "Solar Trader *"');
}

console.log('');
