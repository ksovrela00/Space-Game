// Перегон РАСТИТЕЛЬНОСТИ из CC0-пака в формат движка.
//
// Запуск: npm run nature         node tools/nature.mjs --list
//
// Почему готовые модели, а не процедурные кусты. Дерево — предмет с
// узнаваемым силуэтом: ствол, развилка, крона. Процедурный конус на
// палке читается как конус на палке, и никакой шум этого не лечит. А
// главное — дерево нужно глазу не само по себе, а как МЕРА: предмет
// известного размера, по которому считывается высота и скорость
// (ровно та же работа, что у камней, js/gl/rocks.js, только дерево
// вчетверо выше и потому видно вчетверо дальше).
//
// Пак Kenney удобен тем же, чем и космический: текстур нет вовсе, цвет
// лежит в материалах (Kd в .mtl), а движок красит по грани.
//
// ЦВЕТ ЛЕЖИТ РОЛЯМИ, и это единственное отличие от station.mjs. У
// автора палитра мультяшная — листва бирюзовая, кора лососевая, — и на
// оливковом грунте здешних миров она смотрелась бы игрушкой. Но дело
// даже не во вкусе: растения на Lave II не обязаны быть земной зеленью,
// и цвет им должен задавать МИР, а не пак. Поэтому каждая грань
// помечена ролью — кора, листва, трава, цветок, — а красит её уже
// js/gl/flora.js по палитре тела. Геометрия при этом авторская, до
// единой вершины.
//
// Размер нормируется ПО ВЫСОТЕ (у station.mjs — по наибольшему
// размеру). Дерево заказывают высотой: «сосна двенадцать метров», а не
// «сосна, у которой наибольший габарит двенадцать». У раскидистого
// куста наибольший габарит — ширина, и нормировка по нему давала бы
// кусты вдвое ниже заказанного.
//
// Результат — js/models/nature.parts.js, обычный модуль с числами.

import { mkdir, readdir, access, rm, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseObj } from './ship.mjs';
import { parseMtl } from './station.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'js', 'models', 'nature.parts.js');
const TMP = join(tmpdir(), 'space-game-nature');

const PACK = {
  url: 'https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip',
  page: 'https://kenney.nl/assets/nature-kit',
  author: 'Kenney',
  license: 'CC0',
};

/**
 * Роли граней. Номер роли едет в палитре детали, и по нему flora.js
 * подставляет цвет мира.
 *
 * Порядок менять нельзя: он записан числами в nature.parts.js.
 */
export const ROLES = ['bark', 'leaf', 'grass', 'flower'];

/** Материал пака -> роль. Всё незнакомое считается корой: это ствол. */
const ROLE_OF = {
  leafsGreen: 'leaf',
  leafsDark: 'leaf',
  woodBark: 'bark',
  woodBarkDark: 'bark',
  woodInner: 'bark',
  grass: 'grass',
  colorRed: 'flower',
  colorYellow: 'flower',
  colorPurple: 'flower',
};

/**
 * Что берём.
 *
 * `kind` — ярус, в котором деталь растёт (js/gl/flora.js):
 *   tree  — то, что выше корабельной стойки и видно за километр;
 *   bush  — кусты в рост человека, видны с сотни метров;
 *   blade — трава и цветы под самыми ногами.
 *
 * Деталей взято немного и намеренно. Лес из трёх пород читается лесом,
 * а каждая лишняя модель — это и файл, и лишняя ветка в сборщике поля.
 * Зато формы разные: круглая крона, узкая, конус хвои. Одинаковые
 * силуэты в поле видно сразу — выходит не лес, а обои.
 */
const PARTS = [
  // --- деревья
  { name: 'treeRound', file: 'tree_default', kind: 'tree' },
  { name: 'treeOak', file: 'tree_oak', kind: 'tree' },
  { name: 'treeThin', file: 'tree_thin', kind: 'tree' },
  { name: 'treeSmall', file: 'tree_small', kind: 'tree' },
  { name: 'pineTall', file: 'tree_pineTallA', kind: 'tree' },
  { name: 'pineRound', file: 'tree_pineRoundC', kind: 'tree' },
  { name: 'pineSmall', file: 'tree_pineSmallA', kind: 'tree' },
  // --- кусты
  // Пень — в ярусе кустов, и это не мелочь. Нормировка идёт ПО ВЫСОТЕ, а
  // пень в паке шире собственной высоты втрое: поставленный деревом в
  // пятнадцать метров, он выходит плитой в сорок метров поперёк и в
  // кадре читается как рухнувший ангар. Так и выглядело на снимке.
  { name: 'stump', file: 'stump_old', kind: 'bush' },
  { name: 'bush', file: 'plant_bush', kind: 'bush' },
  { name: 'bushLarge', file: 'plant_bushLarge', kind: 'bush' },
  { name: 'bushSmall', file: 'plant_bushSmall', kind: 'bush' },
  // --- трава и цветы
  { name: 'grass', file: 'grass_leafs', kind: 'blade' },
  { name: 'grassLarge', file: 'grass_leafsLarge', kind: 'blade' },
  { name: 'grassTuft', file: 'grass', kind: 'blade' },
  { name: 'flowerA', file: 'flower_redA', kind: 'blade' },
  { name: 'flowerB', file: 'flower_yellowA', kind: 'blade' },
];

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

/**
 * Привести деталь к общему виду: центр по X и Z, низ на нуле, ВЫСОТА
 * ровно 1000. Ширина какая вышла — у куста она и должна быть больше
 * высоты.
 */
function normalizeByHeight(verts) {
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const v of verts) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]);
  }
  const ext = [0, 1, 2].map((i) => max[i] - min[i]);
  const k = 1000 / Math.max(ext[1], 1e-9);
  const mid = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  const out = verts.map((v) => [
    Math.round((v[0] - mid[0]) * k),
    Math.round((v[1] - mid[1]) * k),
    Math.round((v[2] - mid[2]) * k),
  ]);
  return { verts: out, size: ext.map((e) => Math.round(e * k)) };
}

// --- дальше — сам перегон ----------------------------------------------------
const isMain = process.argv[1] && process.argv[1].endsWith('nature.mjs');
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
  const zip = join(TMP, 'nature-kit.zip');
  if (!await exists(zip)) {
    console.log('качаю ' + PACK.url + ' (10 МБ)');
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
  console.log(`В паке ${PACK.author} (${PACK.license}), ${all.length} моделей:`);
  console.log(all.join(', '));
  process.exit(0);
}

const chunks = [];
const names = [];
const seenRoles = new Set();
let totalV = 0, totalF = 0;

for (const p of PARTS) {
  const objPath = join(objDir, p.file + '.obj');
  if (!await exists(objPath)) {
    console.error(`нет модели «${p.file}» в паке`);
    process.exit(1);
  }
  const obj = parseObj(await readFile(objPath, 'utf8'));
  const mtl = parseMtl(await readFile(join(objDir, p.file + '.mtl'), 'utf8'));
  const { verts, size } = normalizeByHeight(obj.verts);

  // Цвет складывается в палитру детали: у растения их два-три, а
  // повторять три байта на каждой грани значит утроить файл.
  const faces = [];
  const pal = [];
  const palIdx = new Map();
  for (const f of obj.faces) {
    if (f.v.length < 3) continue;
    const c = mtl[f.m] || [150, 150, 155];
    const role = ROLE_OF[f.m] || 'bark';
    seenRoles.add(f.m);
    const key = c.join(',') + '|' + role;
    let idx = palIdx.get(key);
    if (idx === undefined) {
      idx = pal.length / 4;
      palIdx.set(key, idx);
      pal.push(...c, ROLES.indexOf(role));
    }
    faces.push(f.v.length, ...f.v, idx);
  }

  names.push(p.name);
  totalV += verts.length;
  totalF += obj.faces.length;
  chunks.push(`  ${p.name}: {\n`
    + `    from: '${p.file}', kind: '${p.kind}',\n`
    + `    size: [${size.join(', ')}],\n`
    + `    verts: [${verts.flat().join(',')}],\n`
    + `    pal: [${pal.join(',')}],\n`
    + `    faces: [${faces.join(',')}],\n`
    + `  },`);
  console.log(`${p.name.padEnd(11)} <- ${p.file.padEnd(22)} `
    + `${obj.verts.length} вершин, ${obj.faces.length} граней, `
    + `${pal.length / 4} цветов, ширина ${size[0]}, высота ${size[1]}`);
}

// Неизвестный материал — это молча покрашенная корой листва, и заметить
// такое можно только глазами. Поэтому вслух.
const unknown = [...seenRoles].filter((m) => !ROLE_OF[m]);
if (unknown.length) {
  console.error('\nНЕИЗВЕСТНЫЕ материалы (покрашены как кора): ' + unknown.join(', '));
  console.error('добавьте их в ROLE_OF в tools/nature.mjs');
  process.exit(1);
}

const head = `// СГЕНЕРИРОВАНО tools/nature.mjs — руками не править.
//
// Растительность из пака «${PACK.author} Nature Kit» (${PACK.license}):
// ${PACK.page}
//
// Координаты — целые ТЫСЯЧНЫЕ ВЫСОТЫ растения: центр по X и Z, низ на
// нуле, высота ровно 1000. Высота в километрах задаётся на месте
// посадки (js/gl/flora.js), поэтому одна и та же сосна идёт и в
// подлесок, и в двадцатиметровое дерево.
//
// Цвет — в ПАЛИТРЕ детали: pal — четвёрки (r, g, b, роль), где роль это
// номер в NATURE_ROLES. Авторский цвет здесь справочный: красит
// растение МИР, на котором оно выросло (js/gl/flora.js, tint) — листва
// чужой планеты не обязана быть земной зеленью.
//
// Пересобрать: npm run nature

export const NATURE_ROLES = ${JSON.stringify(ROLES)};

export const NATURE_NAMES = ${JSON.stringify(names)};

export const NATURE_PARTS = {
${chunks.join('\n')}
};
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, head, 'utf8');
console.log(`\nвсего ${totalV} вершин, ${totalF} граней -> ${OUT}`);

}
