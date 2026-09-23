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
//
// Правило может быть не только «на порт», но и «на программу» — именно так
// XAMPP заводит Apache, разрешая httpd.exe любые порты. Проверка, которая
// ищет только номер порта, объявляет закрытым то, что открыто, и сбивает
// с толку ровно тогда, когда на неё смотрят. Один такой ложный диагноз
// здесь уже был.

console.log('');

/** Кто слушает порт: имя программы по её PID. */
const listenerOf = (port) => {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'latin1' });
    const line = out.split(/\r?\n/).find((l) =>
      /LISTENING/i.test(l) && new RegExp(':' + port + '\\s').test(l));
    if (!line) return null;
    const pid = line.trim().split(/\s+/).pop();
    const tl = execFileSync('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'],
      { encoding: 'latin1' });
    const m = tl.match(/^"([^"]+)"/);
    return m ? m[1].toLowerCase() : null;
  } catch (e) {
    return null;
  }
};

/** Профиль сети, по которому сейчас живут правила. */
const profileNow = () => {
  try {
    const out = execFileSync('netsh', ['advfirewall', 'show', 'currentprofile'],
      { encoding: 'latin1' });
    const head = out.split(/\r?\n/).find((l) => /Profile Settings|Профиль/i.test(l)) || '';
    if (/Domain|Домен/i.test(head)) return 'Domain';
    if (/Private|Частн/i.test(head)) return 'Private';
    if (/Public|Общ/i.test(head)) return 'Public';
  } catch (e) { /* без прав сюда всё равно пускают, но мало ли */ }
  return null;
};

let rules = '';
try {
  // netsh читается без прав администратора — менять правила ими нельзя,
  // а смотреть можно.
  rules = execFileSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=all',
    'dir=in', 'verbose'], { encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  console.log(bad('не удалось спросить брандмауэр: ' + e.message));
}

const profile = profileNow();
if (profile) console.log('  сеть сейчас в профиле: ' + profile);

/**
 * Что именно пропускает порт: правило на порт, правило на программу или
 * ничего. Возвращает описание или null.
 */
const allows = (port, program) => {
  // Правила идут блоками, разделёнными пустой строкой; в блоке должны
  // сойтись: включено, разрешает, наш профиль и наш порт или наша
  // программа.
  for (const block of rules.split(/\r?\n\r?\n/)) {
    if (!/(?:Enabled|Включено):\s*(Yes|Да)/i.test(block)) continue;
    if (!/(?:Action|Действие):\s*(Allow|Разрешить)/i.test(block)) continue;
    const prof = (block.match(/(?:Profiles|Профили):\s*(.+)/i) || [])[1] || '';
    if (profile && !new RegExp(profile, 'i').test(prof)
        && !/Any|Все|Domain,Private,Public/i.test(prof)) continue;
    if (new RegExp('(?:LocalPort|Локальный порт):\\s*' + port + '\\s*$', 'm').test(block)) {
      return 'по порту';
    }
    if (program) {
      const prog = (block.match(/(?:Program|Программа):\s*(.+)/i) || [])[1] || '';
      if (prog.trim().toLowerCase().endsWith('\\' + program)) {
        // Правило на программу разрешает ей ЛЮБЫЕ порты, поэтому годится
        // только если и порт слушает именно она.
        if (/(?:LocalPort|Локальный порт):\s*(Any|Все)/i.test(block)) {
          return 'по программе ' + program;
        }
      }
    }
  }
  return null;
};

const closed = [];
for (const p of PORTS) {
  const program = listenerOf(p.port);
  const how = rules ? allows(p.port, program) : null;
  if (!rules) continue;
  console.log(how
    ? ok(`брандмауэр пропускает порт ${p.port} (${how})`)
    : bad(`брандмауэр НЕ пропускает порт ${p.port}`
        + (program ? ` — его слушает ${program}, а правила на неё нет` : '')));
  if (!how) closed.push(p);
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
  // Правила групповой политики домена отсюда не видны без прав
  // администратора, и «нет правила» не значит «не пройдёт». Проверка,
  // которая утверждает больше, чем знает, обманывает ровно тогда, когда
  // на неё смотрят: так и вышло — порт 80 объявлялся закрытым, хотя по
  // нему играли.
  console.log('  Если с другой машины при этом ВСЁ РАВНО подключается —');
  console.log('  значит, пропускает правило групповой политики: его отсюда не видно.');
  console.log('');
  console.log('  Убрать потом:');
  console.log('    Remove-NetFirewallRule -DisplayName "Solar Trader *"');
}

console.log('');
