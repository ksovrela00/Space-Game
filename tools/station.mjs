// Перегон ДЕТАЛЕЙ станции из CC0-пака в формат движка.
//
// Запуск: npm run station        node tools/station.mjs --list
//
// Почему детали, а не станция целиком.
//
// Корпус станции — это не украшение, а игровая геометрия: в нём щель
// порта на оси вращения, по нему считается столкновение и по нему же
// ведёт докинг-компьютер. Скачанная модель ничего этого не знает: у неё
// нет ни щели нужных размеров, ни оси, ни соответствия между тем, что
// нарисовано, и тем, во что врезается корабль. Поэтому корпус строится
// кодом (js/models/stations.js) и проверяется тестами.
//
// А вот всё остальное — тарелки, генераторы, баки, фермы, турели — это
// ровно то, чего своими руками не налепишь и что отличает станцию от
// серой фигурки. Оно берётся готовым.
//
// Пак Kenney удобен тем, что в нём НЕТ текстур: цвет лежит в материалах
// (Kd в .mtl), а движок как раз красит по грани и рисует плоским
// затенением. Перегон получается без потерь — не усреднение текстуры, а
// тот самый цвет, который задумал автор.
//
// Результат — js/models/station.parts.js, обычный модуль с числами:
// станция нужна в первом же кадре, ждать ради неё сеть неправильно.

import { mkdir, readdir, access, rm, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseObj, ascii } from './ship.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'js', 'models', 'station.parts.js');
const TMP = join(tmpdir(), 'space-game-station');

const PACK = {
  url: 'https://kenney.nl/media/pages/assets/space-kit/20874c75ac-1677698978/kenney_space-kit.zip',
  page: 'https://kenney.nl/assets/space-kit',
  author: 'Kenney',
  license: 'CC0',
};

/**
 * Что берём из пака.
 *
 * `name` — как деталь зовётся у нас, `file` — как в паке. Осей не
 * трогаем: в паке они Y-вверх, как и у нас, а куда деталь смотрит на
 * станции, решает место установки (js/models/stations.js).
 */
const PARTS = [
  { name: 'dish', file: 'satelliteDish_large' },        // тарелка связи
  { name: 'dishSmall', file: 'satelliteDish_detailed' },
  { name: 'generator', file: 'machine_generatorLarge' }, // энергоблок
  { name: 'machine', file: 'machine_wirelessCable' },    // машинерия с антенной
  { name: 'tank', file: 'machine_barrelLarge' },         // бак
  { name: 'tanks', file: 'barrels_rail' },               // батарея баков
  { name: 'truss', file: 'structure_detailed' },         // ферма
  { name: 'trussDiag', file: 'structure_diagonal' },     // ферма с раскосом
  { name: 'mast', file: 'pipe_supportHigh' },            // мачта
  { name: 'turret', file: 'turret_double' },             // турель обороны
  { name: 'module', file: 'corridor_windowClosed' },     // жилой модуль с окном
  { name: 'moduleEnd', file: 'corridor_end' },
  { name: 'hangar', file: 'hangar_roundB' },             // зев ангара
  { name: 'platform', file: 'platform_large' },          // площадка
];

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

/** Цвета материалов: newmtl + Kd. Текстур в паке нет вовсе. */
function parseMtl(text) {
  const out = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s.startsWith('newmtl ')) {
      cur = s.slice(7).trim();
      out[cur] = [150, 150, 155];
    } else if (s.startsWith('Kd ') && cur) {
      const p = s.split(/\s+/);
      out[cur] = [
        Math.round(Math.min(1, Math.max(0, +p[1])) * 255),
        Math.round(Math.min(1, Math.max(0, +p[2])) * 255),
        Math.round(Math.min(1, Math.max(0, +p[3])) * 255),
      ];
    }
  }
  return out;
}

/**
 * Привести деталь к общему виду: центр по X и Z, низ на нуле, наибольший
 * размер — ровно 1000.
 *
 * Тысячные доли собственного размера, а не миллиметры пака: детали
 * ставятся на станцию РАЗНОГО размера (тарелка в полсотни метров, ферма
 * в двести), и удобнее задавать размер на месте установки, чем помнить,
 * в каких единицах автор рисовал каждую.
 */
function normalize(verts) {
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const v of verts) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]);
  }
  const ext = [0, 1, 2].map((i) => max[i] - min[i]);
  const k = 1000 / Math.max(...ext, 1e-9);
  const mid = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  const out = verts.map((v) => [
    Math.round((v[0] - mid[0]) * k),
    Math.round((v[1] - mid[1]) * k),
    Math.round((v[2] - mid[2]) * k),
  ]);
  return { verts: out, size: ext.map((e) => Math.round(e * k)) };
}

export { parseMtl, normalize };

// --- дальше — сам перегон ----------------------------------------------------
const isMain = import.meta.url === new URL(process.argv[1], 'file:///').href
  || import.meta.url.endsWith('/station.mjs') && process.argv[1].endsWith('station.mjs');
if (!isMain) { /* импортируют как библиотеку */ } else {

const args = process.argv.slice(2);

if (args.includes('--clean')) {
  await rm(TMP, { recursive: true, force: true });
  console.log('кэш пака удалён: ' + TMP);
  process.exit(0);
}

await mkdir(TMP, { recursive: true });
const packDir = join(TMP, 'pack');
if (!await exists(packDir)) {
  const zip = join(TMP, 'space-kit.zip');
  if (!await exists(zip)) {
    console.log('качаю ' + PACK.url + ' (6.4 МБ)');
    const r = await fetch(PACK.url);
    if (!r.ok) { console.error('не скачалось: ' + r.status); process.exit(1); }
    await writeFile(zip, Buffer.from(await r.arrayBuffer()));
  }
  const cmd = process.platform === 'win32'
    ? ['powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Path '${zip}' -DestinationPath '${packDir}' -Force`]]
    : ['unzip', ['-o', '-q', zip, '-d', packDir]];
  const res = spawnSync(cmd[0], cmd[1], { stdio: 'inherit' });
  if (res.status !== 0) { console.error('не распаковалось'); process.exit(1); }
}

const objDir = join(packDir, 'Models', 'OBJ format');
if (!await exists(objDir)) {
  console.error('в паке нет папки «Models/OBJ format»: ' + objDir);
  process.exit(1);
}

if (args.includes('--list')) {
  const all = (await readdir(objDir)).filter((f) => f.endsWith('.obj'))
    .map((f) => f.replace(/\.obj$/, ''));
  console.log(`В паке ${PACK.author} (${PACK.license}), ${all.length} деталей:`);
  console.log(all.join(', '));
  process.exit(0);
}

const chunks = [];
const names = [];
let totalV = 0, totalF = 0;

for (const p of PARTS) {
  const objPath = join(objDir, p.file + '.obj');
  if (!await exists(objPath)) {
    console.error(`нет детали «${p.file}» в паке`);
    process.exit(1);
  }
  const obj = parseObj(await readFile(objPath, 'utf8'));
  const mtl = parseMtl(await readFile(join(objDir, p.file + '.mtl'), 'utf8'));
  const { verts, size } = normalize(obj.verts);

  // Грани с цветом материала. Вырожденные (меньше трёх вершин) в паке
  // попадаются — молча пропускаем: рисовать нечего.
  const faces = [];
  for (const f of obj.faces) {
    if (f.v.length < 3) continue;
    const c = mtl[f.m] || [150, 150, 155];
    faces.push(f.v.length, ...f.v, ...c);
  }

  names.push(p.name);
  totalV += verts.length;
  totalF += obj.faces.length;
  chunks.push(`  ${p.name}: {\n`
    + `    from: '${p.file}',\n`
    + `    size: [${size.join(', ')}],\n`
    + `    verts: [${verts.flat().join(',')}],\n`
    + `    faces: [${faces.join(',')}],\n`
    + `  },`);
  console.log(`${p.name.padEnd(10)} <- ${p.file.padEnd(24)} `
    + `${obj.verts.length} вершин, ${obj.faces.length} граней, `
    + `${size.join('x')}`);
}

const head = `// СГЕНЕРИРОВАНО tools/station.mjs — руками не править.
//
// Детали станций из пака «${PACK.author} Space Kit» (${PACK.license}):
// ${PACK.page}
//
// Координаты — целые ТЫСЯЧНЫЕ собственного размера детали: центр по X и
// Z, низ на нуле, наибольший размер ровно 1000. Размер в километрах
// задаётся на месте установки (js/models/stations.js) — одна и та же
// ферма идёт и на мачту, и в обвязку порта.
//
// Цвет — на грань, из материала (Kd): текстур в паке нет, а движок
// рисует плоским затенением (js/gl/mesh.js). Формат граней тот же, что у
// корпуса корабля: длина, индексы вершин, три байта цвета.
//
// Пересобрать: npm run station

export const PART_NAMES = ${JSON.stringify(names)};

export const PARTS = {
${chunks.join('\n')}
};
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, head, 'utf8');
console.log(`\nвсего ${totalV} вершин, ${totalF} граней -> ${OUT}`);

}
