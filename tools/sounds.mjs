// Пересборка assets/sound из исходных CC0-паков с OpenGameArt.
//
// Зачем скрипт, если файлы и так лежат в репозитории: он держит
// ПРОВЕНАНС. По нему видно, что именно взято, откуда и под какой
// лицензией, и его можно прогнать, чтобы заменить набор — скажем,
// подобрав другой рокот из того же пака.
//
// Запуск: npm run sounds [--force]
// Без --force уже имеющиеся файлы не трогаются.

import { createWriteStream } from 'node:fs';
import { mkdir, readdir, copyFile, access, rm, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'sound');
const TMP = join(ROOT, '.sfx-tmp');

const PACKS = [
  { id: 'loops', url: 'https://opengameart.org/sites/default/files/sfx_loops.zip',
    page: 'https://opengameart.org/content/30-cc0-sfx-loops' },
  { id: 'scifi', url: 'https://opengameart.org/sites/default/files/sci-fi-sfx.zip',
    page: 'https://opengameart.org/content/50-cc0-sci-fi-sfx' },
  { id: 'metal', url: 'https://opengameart.org/sites/default/files/100-CC0-wood-metal-SFX.zip',
    page: 'https://opengameart.org/content/100-cc0-metal-and-wood-sfx' },
  { id: 'sfx100', url: 'https://opengameart.org/sites/default/files/100-CC0-SFX_0.zip',
    page: 'https://opengameart.org/content/100-cc0-sfx' },
  { id: 'sfx100b', url: 'https://opengameart.org/sites/default/files/sfx_100_v2.zip',
    page: 'https://opengameart.org/content/100-cc0-sfx-2' },
];

// Роль в игре -> откуда взято. Тот же список, что в CREDITS.md.
const MAP = [
  ['engine_low.ogg', 'loops', 'ambient_01.ogg'],
  ['engine_mid.ogg', 'scifi', 'loop_machine_02.ogg'],
  ['exhaust.ogg', 'loops', 'noise_01.ogg'],
  ['drive.ogg', 'scifi', 'loop_machine_03.ogg'],
  ['thruster.ogg', 'loops', 'noise_03.ogg'],
  ['station.ogg', 'scifi', 'loop_ambient_01.ogg'],
  // Скрип — это дверь, а не удар по листу железа: у двери энергия
  // ТЯНЕТСЯ, а у листа вся сидит в атаке. С листов и начиналось, и
  // звучало соответственно.
  ['creak_01.ogg', 'sfx100', 'door_01.ogg'],
  ['creak_02.ogg', 'sfx100', 'door_02.ogg'],
  ['creak_03.ogg', 'sfx100b', 'sfx100v2_misc_12.ogg'],
  ['creak_04.ogg', 'sfx100b', 'sfx100v2_misc_23.ogg'],
  // Запасные варианты для прослушивания (tools/audition.html).
  ['alt/creak_alt_01.ogg', 'sfx100b', 'sfx100v2_misc_22.ogg'],
  ['alt/creak_alt_02.ogg', 'sfx100b', 'sfx100v2_misc_28.ogg'],
  ['alt/creak_alt_03.ogg', 'metal', 'metal_sheet_03.ogg'],
  ['alt/creak_alt_04.ogg', 'metal', 'metal_falling_01.ogg'],
  ['hit_01.ogg', 'metal', 'metal_hit_03.ogg'],
  ['hit_02.ogg', 'metal', 'metal_hit_04.ogg'],
  ['slam.ogg', 'metal', 'metal_slam_01.ogg'],
  ['clamp.ogg', 'metal', 'metal_close_01.ogg'],
  ['servo.ogg', 'metal', 'metal_open_01.ogg'],
  ['latch.ogg', 'metal', 'lock_open_01.ogg'],
  ['spool.ogg', 'scifi', 'teleport_01.ogg'],
];

const force = process.argv.includes('--force');
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

// Проверка без сети: всё ли на месте.
if (process.argv.includes('--check')) {
  let miss = 0;
  for (const [name] of MAP) if (!await exists(join(OUT, name))) { console.log('НЕТ ' + name); miss++; }
  console.log(miss ? `не хватает файлов: ${miss}` : `все ${MAP.length} файлов на месте`);
  process.exit(miss ? 1 : 0);
}

if (!force) {
  const have = [];
  for (const [name] of MAP) if (await exists(join(OUT, name))) have.push(name);
  if (have.length === MAP.length) {
    console.log(`Все ${MAP.length} файлов уже лежат в assets/sound. Пересобрать: --force`);
    process.exit(0);
  }
}

await mkdir(TMP, { recursive: true });
await mkdir(OUT, { recursive: true });

for (const p of PACKS) {
  const zip = join(TMP, p.id + '.zip');
  if (!await exists(zip)) {
    console.log('качаю ' + p.url);
    const r = await fetch(p.url);
    if (!r.ok) { console.error('не скачалось: ' + r.status); process.exit(1); }
    await writeFile(zip, Buffer.from(await r.arrayBuffer()));
  }
  const dir = join(TMP, p.id);
  if (!await exists(dir)) {
    // Без зависимостей: распаковку делает сама система.
    const cmd = process.platform === 'win32'
      ? ['powershell', ['-NoProfile', '-Command',
        `Expand-Archive -Path '${zip}' -DestinationPath '${dir}' -Force`]]
      : ['unzip', ['-o', '-q', zip, '-d', dir]];
    const res = spawnSync(cmd[0], cmd[1], { stdio: 'inherit' });
    if (res.status !== 0) { console.error('не распаковалось: ' + p.id); process.exit(1); }
  }
}

// Файлы в архивах могут лежать во вложенной папке — ищем по имени.
const index = {};
for (const p of PACKS) {
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(join(d, e.name));
      else index[p.id + '/' + e.name] = join(d, e.name);
    }
  };
  await walk(join(TMP, p.id));
}

let done = 0;
await mkdir(join(OUT, 'alt'), { recursive: true });
for (const [name, pack, src] of MAP) {
  const from = index[pack + '/' + src];
  if (!from) { console.error(`НЕ НАЙДЕН ${pack}/${src}`); continue; }
  await copyFile(from, join(OUT, name));
  done++;
}
await rm(TMP, { recursive: true, force: true });

console.log(`\nassets/sound: ${done} из ${MAP.length} файлов.`);
console.log('Лицензия всех паков — CC0, подробности в assets/sound/CREDITS.md:');
for (const p of PACKS) console.log('  ' + p.page);
