// Запуск PHP-скрипта из npm.
//
// Нужен потому, что php в PATH нет и, скорее всего, не будет: в XAMPP он
// лежит в своей папке, и на второй машине (см. README, «Перенос») путь
// другой. Прописать в package.json абсолютный путь значит сломать
// команды на другой машине; поэтому интерпретатор ИЩЕТСЯ, а не задаётся.
//
// Порядок поиска: переменная SOLAR_PHP, затем PATH, затем обычные места
// XAMPP. Первое, что откликнулось на `php -v`, и берём.
//
//   node tools/php.mjs server/tests/run.php [аргументы]

import { spawnSync } from 'node:child_process';

const CANDIDATES = [
  process.env.SOLAR_PHP,
  'php',
  'C:/xampp82/php/php.exe',
  'C:/xampp/php/php.exe',
  'C:/xampp81/php/php.exe',
  '/usr/bin/php',
  '/usr/local/bin/php',
].filter(Boolean);

const found = CANDIDATES.find((php) => {
  const probe = spawnSync(php, ['-v'], { stdio: 'ignore' });
  return probe.status === 0;
});

if (!found) {
  console.error('PHP не найден. Укажите его явно: SOLAR_PHP=C:/xampp82/php/php.exe npm run api:test');
  console.error('искали: ' + CANDIDATES.join(', '));
  process.exit(1);
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('нечего запускать: node tools/php.mjs <скрипт.php> [аргументы]');
  process.exit(1);
}

// Предупреждения о чужих расширениях (в этом XAMPP их два) сыплются в
// stderr при каждом запуске и к игре отношения не имеют. Глушим их
// ключом, а не фильтром вывода: ошибки самого скрипта нам нужны.
const run = spawnSync(found, ['-d', 'error_reporting=E_ALL & ~E_WARNING', ...args], {
  stdio: 'inherit',
});
process.exit(run.status === null ? 1 : run.status);
