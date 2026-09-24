// Перегон ДЕТАЛЕЙ наземного города из CC0-паков в формат движка.
//
// Запуск: npm run city          node tools/city.mjs --list
//
// Паков два, и это не жадность.
//
//   * «Space Kit» — космопорт: ангары, площадки, баки, тарелки, фермы,
//     монорельс. Оттуда же берутся детали орбитальных станций
//     (tools/station.mjs), и качать его второй раз не приходится.
//   * «City Kit (Commercial)» — собственно ГОРОД: башни, кварталы,
//     низкая застройка. В космическом паке зданий нет вовсе, а колония
//     без домов — это склад, а не город.
//
// Цвет в паках берётся по-разному, и обе дороги уже проложены:
// у космического он лежит в материалах (Kd в .mtl), у городского — в
// общем атласе, и его снимают выборкой по UV каждой грани, как с
// корабельной модели (tools/ship.mjs, faceColor).
//
// ОКНА СВЕТЯТСЯ. В атласе городского пака стекло — единственная СИНЯЯ
// колонка палитры, остальное серое и бежевое. По этому и опознаётся:
// грань, у которой синева заметно выше красноты, получает свечение.
// Без этого ночная сторона безатмосферного мира съедает город целиком —
// свет там ровно один, и тот из-за горизонта.
//
// Результат — js/models/city.parts.js, обычный модуль с числами: город
// нужен в первом же кадре подлёта, ждать ради него сеть неправильно.

import { mkdir, readdir, access, rm, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseObj, decodePng, faceColor } from './ship.mjs';
import { parseMtl, normalize } from './station.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'js', 'models', 'city.parts.js');

const PACKS = {
  space: {
    url: 'https://kenney.nl/media/pages/assets/space-kit/20874c75ac-1677698978/kenney_space-kit.zip',
    page: 'https://kenney.nl/assets/space-kit',
    // Тот же кэш, что у деталей станции: пак один и тот же.
    tmp: join(tmpdir(), 'space-game-station'),
    zip: 'space-kit.zip',
    color: 'mtl',
  },
  city: {
    url: 'https://kenney.nl/media/pages/assets/city-kit-commercial/a742d900eb-1753115042/kenney_city-kit-commercial_2.1.zip',
    page: 'https://kenney.nl/assets/city-kit-commercial',
    tmp: join(tmpdir(), 'space-game-city'),
    zip: 'city-kit.zip',
    color: 'atlas',
    atlas: 'colormap.png',
  },
};

const PACK_AUTHOR = 'Kenney';
const PACK_LICENSE = 'CC0';

/**
 * Что берём.
 *
 * `name` — как деталь зовётся у нас, `file` — как в паке, `pack` —
 * откуда. Осей не трогаем: в обоих паках Y смотрит вверх, как и у нас, а
 * куда деталь развёрнута в городе, решает место установки
 * (js/models/city.js).
 *
 * Полноразмерных зданий взято немного и намеренно: одно такое — это
 * две-пять тысяч граней, и город из сорока подробных башен стоил бы
 * четверти миллиона. Поэтому центр собирается из подробных, а окраина —
 * из низкодетальных, которых в паке отдельная серия.
 */
const PARTS = [
  // --- город: башни и кварталы
  { name: 'towerA', file: 'building-skyscraper-a', pack: 'city' },
  { name: 'towerB', file: 'building-skyscraper-b', pack: 'city' },
  { name: 'towerC', file: 'building-skyscraper-e', pack: 'city' },
  { name: 'blockA', file: 'building-a', pack: 'city' },
  { name: 'blockB', file: 'building-c', pack: 'city' },
  { name: 'blockC', file: 'building-d', pack: 'city' },
  { name: 'blockD', file: 'building-h', pack: 'city' },
  // --- город: низкая застройка (окраина, дёшево по граням)
  { name: 'lowA', file: 'low-detail-building-a', pack: 'city' },
  { name: 'lowB', file: 'low-detail-building-c', pack: 'city' },
  { name: 'lowC', file: 'low-detail-building-e', pack: 'city' },
  { name: 'lowD', file: 'low-detail-building-k', pack: 'city' },
  { name: 'lowE', file: 'low-detail-building-n', pack: 'city' },
  { name: 'lowWide', file: 'low-detail-building-wide-a', pack: 'city' },
  // --- космопорт
  { name: 'hangar', file: 'hangar_largeA', pack: 'space' },
  { name: 'hangarRound', file: 'hangar_roundGlass', pack: 'space' },
  { name: 'platform', file: 'platform_large', pack: 'space' },
  { name: 'generator', file: 'machine_generatorLarge', pack: 'space' },
  { name: 'tank', file: 'machine_barrelLarge', pack: 'space' },
  { name: 'tanks', file: 'barrels_rail', pack: 'space' },
  { name: 'dish', file: 'satelliteDish_large', pack: 'space' },
  { name: 'mast', file: 'pipe_supportHigh', pack: 'space' },
  { name: 'truss', file: 'structure_detailed', pack: 'space' },
  { name: 'turret', file: 'turret_double', pack: 'space' },
  // --- транспорт: монорельс через город и стоящая техника
  { name: 'railTrack', file: 'monorail_trackStraight', pack: 'space' },
  { name: 'railSupport', file: 'monorail_trackSupport', pack: 'space' },
  { name: 'railCar', file: 'monorail_trainPassenger', pack: 'space' },
  { name: 'rover', file: 'rover', pack: 'space' },
  { name: 'freighter', file: 'craft_cargoA', pack: 'space' },
];

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

/**
 * Светится ли грань. В атласе городского пака стекло — синяя колонка
 * палитры: у неё синева на сотню выше красноты, тогда как у бетона
 * разрыв в пару десятков. Порог посередине, с запасом в обе стороны.
 */
export const isGlass = (c) => c[2] - c[0] > 55 && c[2] > 110;

/**
 * Свечение окна.
 *
 * Почти в полную силу, и это не произвол. На безатмосферном теле ночь
 * абсолютно чёрная: ни воздуха, ни рассеянного света, только ambient в
 * четырнадцать сотых. Окно размером три на пять метров с километра
 * занимает ОДИН пиксель, и если светить вполсилы, город ночью
 * превращается в невидимое пятно — что и произошло на первом снимке.
 * Днём разницы нет вовсе: солнце ярче любого окна.
 */
export const GLASS_GLOW = 0.85;

// Шаг огрубления цвета. Восемь уровней на канал — это 3% яркости:
// меньше, чем разница между двумя гранями одной стены в нашем плоском
// затенении, и заметно меньше того, что вообще видно на экране.
export const PAL_STEP = 8;

// --- дальше — сам перегон ----------------------------------------------------
const isMain = process.argv[1] && process.argv[1].endsWith('city.mjs');
if (!isMain) { /* импортируют как библиотеку */ } else {

const args = process.argv.slice(2);

if (args.includes('--clean')) {
  for (const p of Object.values(PACKS)) await rm(p.tmp, { recursive: true, force: true });
  console.log('кэш паков удалён');
  process.exit(0);
}

/** Распакованный пак: качаем и распаковываем при первой надобности. */
async function fetchPack(p) {
  await mkdir(p.tmp, { recursive: true });
  const packDir = join(p.tmp, 'pack');
  if (!await exists(packDir)) {
    const zip = join(p.tmp, p.zip);
    if (!await exists(zip)) {
      console.log('качаю ' + p.url);
      const r = await fetch(p.url);
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
  const out = { objDir };
  if (p.color === 'atlas') {
    out.tex = decodePng(await readFile(join(objDir, 'Textures', p.atlas)));
  }
  return out;
}

const packs = {};
for (const key of Object.keys(PACKS)) {
  if (!PARTS.some((p) => p.pack === key)) continue;
  packs[key] = await fetchPack(PACKS[key]);
}

if (args.includes('--list')) {
  for (const [key, p] of Object.entries(packs)) {
    const all = (await readdir(p.objDir)).filter((f) => f.endsWith('.obj'))
      .map((f) => f.replace(/\.obj$/, ''));
    console.log(`\nПак «${key}» (${PACK_AUTHOR}, ${PACK_LICENSE}), ${all.length} деталей:`);
    console.log(all.join(', '));
  }
  process.exit(0);
}

const chunks = [];
const names = [];
let totalV = 0, totalF = 0, totalGlow = 0;

for (const p of PARTS) {
  const pack = packs[p.pack];
  const objPath = join(pack.objDir, p.file + '.obj');
  if (!await exists(objPath)) {
    console.error(`нет детали «${p.file}» в паке «${p.pack}»`);
    process.exit(1);
  }
  const obj = parseObj(await readFile(objPath, 'utf8'));
  const mtl = pack.tex ? null
    : parseMtl(await readFile(join(pack.objDir, p.file + '.mtl'), 'utf8'));
  const { verts, size } = normalize(obj.verts);

  // Грани с цветом и свечением. Вырожденные (меньше трёх вершин) в паках
  // попадаются — молча пропускаем: рисовать нечего.
  //
  // Цвет лежит в ПАЛИТРЕ, а не на грани. В атласе городского пака каждый
  // материал — вертикальная растяжка, и соседние грани стены снимают с
  // неё десятки оттенков, различить которые нельзя ничем. Поэтому цвет
  // огрубляется до шага PAL_STEP и складывается в палитру: у здания
  // выходит два десятка цветов вместо сотни, а файл — вдвое меньше.
  const faces = [];
  const pal = [];
  const palIdx = new Map();
  let glow = 0;
  for (const f of obj.faces) {
    if (f.v.length < 3) continue;
    const raw = pack.tex
      ? faceColor(pack.tex, obj.uvs, f).map(Math.round)
      : (mtl[f.m] || [150, 150, 155]);
    const c = raw.map((x) => Math.min(255, Math.round(x / PAL_STEP) * PAL_STEP));
    // Светятся только окна городского пака: в космическом синий цвет
    // носят солнечные панели, а они как раз не светятся.
    const lit = pack.tex && isGlass(c) ? Math.round(GLASS_GLOW * 255) : 0;
    if (lit) glow++;
    const key = c.join(',') + '|' + lit;
    let idx = palIdx.get(key);
    if (idx === undefined) {
      idx = pal.length / 4;
      palIdx.set(key, idx);
      pal.push(...c, lit);
    }
    faces.push(f.v.length, ...f.v, idx);
  }

  names.push(p.name);
  totalV += verts.length;
  totalF += faces.length ? obj.faces.length : 0;
  totalGlow += glow;
  chunks.push(`  ${p.name}: {\n`
    + `    from: '${p.file}', pack: '${p.pack}',\n`
    + `    size: [${size.join(', ')}],\n`
    + `    verts: [${verts.flat().join(',')}],\n`
    + `    pal: [${pal.join(',')}],\n`
    + `    faces: [${faces.join(',')}],\n`
    + `  },`);
  console.log(`${p.name.padEnd(12)} <- ${p.file.padEnd(28)} `
    + `${obj.verts.length} вершин, ${obj.faces.length} граней, `
    + `${pal.length / 4} цветов`
    + (glow ? `, окон ${glow}` : '')
    + `, ${size.join('x')}`);
}

const head = `// СГЕНЕРИРОВАНО tools/city.mjs — руками не править.
//
// Детали наземного города из паков ${PACK_AUTHOR} (${PACK_LICENSE}):
// ${PACKS.city.page}
// ${PACKS.space.page}
//
// Координаты — целые ТЫСЯЧНЫЕ собственного размера детали: центр по X и
// Z, низ на нуле, наибольший размер ровно 1000. Размер в километрах
// задаётся на месте установки (js/models/city.js) — одна и та же башня
// идёт и в центр, и на окраину.
//
// Цвет — в ПАЛИТРЕ детали: pal — четвёрки (r, g, b, свечение 0..255), а
// грань хранит длину, индексы вершин и номер цвета. Светятся окна: в
// атласе городского пака стекло — единственная синяя колонка палитры, по
// ней они и опознаны.
//
// Пересобрать: npm run city

export const CITY_PART_NAMES = ${JSON.stringify(names)};

export const CITY_PARTS = {
${chunks.join('\n')}
};
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, head, 'utf8');
console.log(`\nвсего ${totalV} вершин, ${totalF} граней, ${totalGlow} светящихся -> ${OUT}`);

}
