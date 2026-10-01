// Перегон ДЕТАЛЕЙ ПОМЕЩЕНИЙ корабля из двух CC0-паков в формат движка.
//
// Запуск: npm run interior        node tools/interior.mjs --list
//
// Зачем готовые детали. Внутри корабля глаз стоит в полуметре от стены,
// и всё, что слеплено кодом из коробок, там выдаёт себя сразу: ровная
// плоскость в три метра читается картоном, а не обшивкой. У пака
// Quaternius «Modular Sci-Fi» стены, пол и потолок собраны из панелей с
// фасками, полосами и решётками — ровно то, что делает переборку
// переборкой. Мебели в нём нет вовсе, поэтому койки, камбуз и стол взяты
// из второго пака — Kenney «Furniture Kit».
//
// Оба пака без текстур: цвет лежит в материалах (Kd в .mtl), а кабина
// красит по грани своим шейдером (js/gl/cabin.js). Цвет здесь ЛЕЖИТ
// РОЛЯМИ, как у растительности (tools/nature.mjs): мебель Kenney —
// домашняя, с деревом и розовыми диванами, и в корабле она смотрелась бы
// игрушкой. Красит её корабль (js/models/interior.js, PALETTE): дерево
// становится графитовым композитом, ткань — обивкой. Геометрия авторская,
// до единой вершины.
//
// ОСИ. У стен Quaternius лицо смотрит в +z (так записаны и обход граней,
// и нормали OBJ), а обратной стороны у деталей нет вовсе: пак рассчитан на
// отсечение задних граней. Мебель Kenney, наоборот, лицом в −z — её здесь
// разворачивает на пол-оборота, чтобы у всех деталей лицо было +z.
// Модульные детали Quaternius не сдвигаются: их начало координат — это
// сетка пака (стена стоит на линии, плитка — в клетке), и по ней они и
// раскладываются. Мебель приводится к центру по x и z и к нулю снизу.
//
// Результат — js/models/interior.parts.js, обычный модуль с числами в
// целых миллиметрах пака.

import { mkdir, readdir, access, rm, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseObj } from './ship.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'js', 'models', 'interior.parts.js');
const TMP = join(tmpdir(), 'space-game-interior');

const PACKS = {
  q: {
    url: 'https://opengameart.org/sites/default/files/ultimate_modular_sci-fi_-_feb_2021.zip',
    page: 'https://opengameart.org/content/lowpoly-modular-sci-fi-environments',
    title: 'Quaternius Ultimate Modular Sci-Fi', license: 'CC0', mb: 10.5,
    dir: 'pack', obj: ['Ultimate Modular Sci-Fi - Feb 2021', 'OBJ'],
  },
  k: {
    url: 'https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip',
    page: 'https://kenney.nl/assets/furniture-kit',
    title: 'Kenney Furniture Kit', license: 'CC0', mb: 2.4,
    dir: 'furniture', obj: ['Models', 'OBJ format'],
  },
};

/**
 * Роли граней. Номер роли записан числом в interior.parts.js, и по нему
 * js/models/interior.js подставляет цвет и материал кабины.
 *
 * Порядок менять нельзя: он записан числами.
 */
export const ROLES = [
  'main', 'light', 'dark', 'accent', 'accentDark', 'black', 'glass', 'pipes',
  'wood', 'woodDark', 'fabric', 'fabricRed', 'fabricDark', 'fabricBlue',
  'metal', 'metalMid', 'metalDark', 'white', 'lamp', 'plant',
];

/** Материал пака -> роль. Незнакомый материал роняет перегон. */
const ROLE_OF = {
  // Quaternius
  Main: 'main', Light: 'light', DarkGrey: 'dark', Accent: 'accent', DarkAccent: 'accentDark',
  Black: 'black', Glass: 'glass', Pipes: 'pipes',
  // Kenney
  wood: 'wood', woodDark: 'woodDark', carpetWhite: 'fabric', carpet: 'fabricRed',
  carpetDarker: 'fabricDark', carpetBlue: 'fabricBlue', metal: 'metal', metalMedium: 'metalMid',
  metalDark: 'metalDark', metalLight: 'white', _defaultMat: 'white', glass: 'glass',
  lamp: 'lamp', plant: 'plant',
};

/**
 * Что берём. `name` — как деталь зовётся у нас, `file` — в паке.
 * У модульных деталей (стены, плитки, колонны) сетка пака сохраняется.
 */
const PARTS = [
  // Стены: лицо в +z на z ≈ −0.21 м, ширина 4 м, высота 4.43 м.
  { name: 'wall1', pack: 'q', file: 'Wall_1' },
  { name: 'wall2', pack: 'q', file: 'Wall_2' },
  { name: 'wall3', pack: 'q', file: 'Wall_3' },
  { name: 'wall4', pack: 'q', file: 'Wall_4' },
  { name: 'wall5', pack: 'q', file: 'Wall_5' },
  { name: 'wallPlain', pack: 'q', file: 'Wall_Empty' },
  // Проём двери: сторона А — с рамой-тоннелем вглубь стены, сторона Б —
  // лицо соседней комнаты; сама дверь — створка в тоннеле.
  { name: 'doorWallA', pack: 'q', file: 'DoorSingle_Wall_SideA' },
  { name: 'doorWallB', pack: 'q', file: 'DoorSingle_Wall_SideB' },
  { name: 'door', pack: 'q', file: 'Door_Single' },
  // Пол и потолок: плитка 2 × 2 м, узор сверху (потолок переворачивается).
  { name: 'floor', pack: 'q', file: 'FloorTile_Basic' },
  { name: 'floor2', pack: 'q', file: 'FloorTile_Basic2' },
  { name: 'floorPlain', pack: 'q', file: 'FloorTile_Empty' },
  { name: 'floorSide', pack: 'q', file: 'FloorTile_Side' },
  { name: 'roof', pack: 'q', file: 'RoofTile_Plate' },
  { name: 'roofVents', pack: 'q', file: 'RoofTile_Vents' },
  { name: 'roofPipes', pack: 'q', file: 'RoofTile_Pipes1' },
  { name: 'roofDetails', pack: 'q', file: 'RoofTile_Details' },
  { name: 'roofSmallVents', pack: 'q', file: 'RoofTile_SmallVents' },
  { name: 'roofPlain', pack: 'q', file: 'RoofTile_Empty' },
  { name: 'column', pack: 'q', file: 'Column_1' },
  { name: 'columnSlim', pack: 'q', file: 'Column_Slim' },
  { name: 'pipes', pack: 'q', file: 'Pipes' },
  // Груз и машинерия.
  { name: 'crate', pack: 'q', file: 'Props_Crate', center: true },
  { name: 'crateLong', pack: 'q', file: 'Props_CrateLong', center: true },
  { name: 'container', pack: 'q', file: 'Props_ContainerFull', center: true },
  { name: 'chest', pack: 'q', file: 'Props_Chest', center: true },
  { name: 'shelf', pack: 'q', file: 'Props_Shelf', center: true },
  { name: 'shelfTall', pack: 'q', file: 'Props_Shelf_Tall', center: true },
  { name: 'computer', pack: 'q', file: 'Props_Computer', center: true },
  { name: 'computerSmall', pack: 'q', file: 'Props_ComputerSmall', center: true },
  { name: 'capsule', pack: 'q', file: 'Props_Capsule', center: true },
  { name: 'pod', pack: 'q', file: 'Props_Pod', center: true },
  { name: 'vessel', pack: 'q', file: 'Props_Vessel', center: true },
  { name: 'vesselTall', pack: 'q', file: 'Props_Vessel_Tall', center: true },
  { name: 'ventPlate', pack: 'q', file: 'Details_Vent_1', center: true },
  { name: 'plateLarge', pack: 'q', file: 'Details_Plate_Large', center: true },
  { name: 'pipesLong', pack: 'q', file: 'Details_Pipes_Long', center: true },
  // Мебель: камбуз, кают-компания, каюта, санузел.
  { name: 'bunk', pack: 'k', file: 'bedBunk' },
  { name: 'cabinet', pack: 'k', file: 'kitchenCabinet' },
  { name: 'cabinetUpper', pack: 'k', file: 'kitchenCabinetUpper' },
  { name: 'stove', pack: 'k', file: 'kitchenStoveElectric' },
  { name: 'sink', pack: 'k', file: 'kitchenSink' },
  { name: 'fridge', pack: 'k', file: 'kitchenFridgeLarge' },
  { name: 'coffee', pack: 'k', file: 'kitchenCoffeeMachine' },
  { name: 'microwave', pack: 'k', file: 'kitchenMicrowave' },
  { name: 'table', pack: 'k', file: 'table' },
  { name: 'chair', pack: 'k', file: 'chairModernCushion' },
  { name: 'sofa', pack: 'k', file: 'loungeSofa' },
  { name: 'coffeeTable', pack: 'k', file: 'tableCoffee' },
  { name: 'desk', pack: 'k', file: 'desk' },
  { name: 'deskChair', pack: 'k', file: 'chairDesk' },
  { name: 'screen', pack: 'k', file: 'computerScreen' },
  { name: 'laptop', pack: 'k', file: 'laptop' },
  { name: 'locker', pack: 'k', file: 'bookcaseClosedDoors' },
  { name: 'sideTable', pack: 'k', file: 'sideTableDrawers' },
  { name: 'shower', pack: 'k', file: 'shower' },
  { name: 'toilet', pack: 'k', file: 'toilet' },
  { name: 'washSink', pack: 'k', file: 'bathroomSink' },
  { name: 'mirror', pack: 'k', file: 'bathroomMirror' },
  { name: 'washer', pack: 'k', file: 'washerDryerStacked' },
  { name: 'trash', pack: 'k', file: 'trashcan' },
  { name: 'rug', pack: 'k', file: 'rugRectangle' },
  { name: 'tv', pack: 'k', file: 'televisionModern' },
  { name: 'plant', pack: 'k', file: 'pottedPlant' },
];

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

/**
 * Привести вершины детали к нашему виду, метры пака.
 *
 * Мебель Kenney поворачивается на пол-оборота вокруг вертикали (лицо из
 * −z в +z) и встаёт центром по x и z, низом на ноль. Мелочь Quaternius
 * (ящики, пульты) — только центр и низ: лицо у неё уже в +z. Модульные
 * детали не трогаются вовсе.
 */
function place(verts, pack, center) {
  let out = verts;
  if (pack === 'k') out = out.map(([x, y, z]) => [-x, y, -z]);
  if (pack === 'k' || center) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of out) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]); }
    const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
    out = out.map(([x, y, z]) => [x - cx, y - lo[1], z - cz]);
  }
  return out;
}

export { place, ROLE_OF };

// --- дальше — сам перегон ----------------------------------------------------
const isMain = import.meta.url === new URL(process.argv[1], 'file:///').href
  || import.meta.url.endsWith('/interior.mjs') && process.argv[1].endsWith('interior.mjs');
if (!isMain) { /* импортируют как библиотеку */ } else {

const args = process.argv.slice(2);

if (args.includes('--clean')) {
  await rm(TMP, { recursive: true, force: true });
  console.log('кэш паков удалён: ' + TMP);
  process.exit(0);
}

await mkdir(TMP, { recursive: true });
const objDirs = {};
for (const [key, P] of Object.entries(PACKS)) {
  const dir = join(TMP, P.dir);
  if (!await exists(dir)) {
    const zip = join(TMP, key + '.zip');
    if (!await exists(zip)) {
      console.log(`качаю ${P.url} (${P.mb} МБ)`);
      const r = await fetch(P.url);
      if (!r.ok) { console.error('не скачалось: ' + r.status); process.exit(1); }
      await writeFile(zip, Buffer.from(await r.arrayBuffer()));
    }
    const cmd = process.platform === 'win32'
      ? ['powershell', ['-NoProfile', '-Command',
        `Expand-Archive -Path '${zip}' -DestinationPath '${dir}' -Force`]]
      : ['unzip', ['-o', '-q', zip, '-d', dir]];
    const res = spawnSync(cmd[0], cmd[1], { stdio: 'inherit' });
    if (res.status !== 0) { console.error('не распаковалось: ' + zip); process.exit(1); }
  }
  objDirs[key] = join(dir, ...P.obj);
  if (!await exists(objDirs[key])) {
    console.error(`в паке ${P.title} нет папки «${P.obj.join('/')}»`);
    process.exit(1);
  }
}

if (args.includes('--list')) {
  for (const [key, P] of Object.entries(PACKS)) {
    const all = (await readdir(objDirs[key])).filter((f) => f.endsWith('.obj')).map((f) => f.replace(/\.obj$/, ''));
    console.log(`\n${P.title} (${P.license}), ${all.length} деталей:\n` + all.join(', '));
  }
  process.exit(0);
}

const chunks = [];
const names = [];
const unknown = new Set();
let totalV = 0, totalF = 0;
for (const p of PARTS) {
  const dir = objDirs[p.pack];
  const objPath = join(dir, p.file + '.obj');
  if (!await exists(objPath)) { console.error(`нет детали «${p.file}» в паке`); process.exit(1); }
  const obj = parseObj(await readFile(objPath, 'utf8'));
  const verts = place(obj.verts, p.pack, p.center).map((v) => v.map((x) => Math.round(x * 1000)));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]); }
  // Разворот мебели — это поворот, а не зеркало: обход граней остаётся
  // прежним, и лицо грани — тем же, что задумал автор.
  const faces = [];
  for (const f of obj.faces) {
    if (f.v.length < 3) continue;
    const role = ROLE_OF[f.m];
    if (!role) { unknown.add(p.file + ':' + f.m); continue; }
    faces.push(f.v.length, ...f.v, ROLES.indexOf(role));
  }
  names.push(p.name);
  totalV += verts.length;
  totalF += obj.faces.length;
  chunks.push(`  ${p.name}: {\n`
    + `    from: '${p.file}', pack: '${p.pack}',\n`
    + `    lo: [${lo.join(', ')}], hi: [${hi.join(', ')}],\n`
    + `    verts: [${verts.flat().join(',')}],\n`
    + `    faces: [${faces.join(',')}],\n`
    + `  },`);
  console.log(`${p.name.padEnd(14)} <- ${p.file.padEnd(28)} ${String(obj.verts.length).padStart(5)} вершин, `
    + `${String(obj.faces.length).padStart(5)} граней, ${((hi[0] - lo[0]) / 1000).toFixed(2)} × `
    + `${((hi[1] - lo[1]) / 1000).toFixed(2)} × ${((hi[2] - lo[2]) / 1000).toFixed(2)} м`);
}

// Незнакомый материал — это молча неверно покрашенная грань, и заметить
// такое можно только глазами. Поэтому вслух.
if (unknown.size) {
  console.error('\nНЕИЗВЕСТНЫЕ материалы: ' + [...unknown].join(', '));
  console.error('добавьте их в ROLE_OF в tools/interior.mjs');
  process.exit(1);
}

const head = `// СГЕНЕРИРОВАНО tools/interior.mjs — руками не править.
//
// Детали помещений корабля из двух CC0-паков:
//   ${PACKS.q.title}: ${PACKS.q.page}
//   ${PACKS.k.title}: ${PACKS.k.page}
//
// Координаты — целые МИЛЛИМЕТРЫ ПАКА, лицо детали — в +z. Модульные
// детали (стены, плитки, колонны) лежат в сетке пака: стена на линии,
// плитка в клетке 2 × 2 м. Мебель и мелочь — центром по x и z, низом на
// нуле. Масштаб задаётся на месте установки (js/models/interior.js).
//
// Грань: длина, индексы вершин, номер роли в INTERIOR_ROLES. Цвет
// роли — палитра корабля (interior.js, PALETTE), а не автора пака.
//
// Пересобрать: npm run interior

export const INTERIOR_ROLES = ${JSON.stringify(ROLES)};

export const INTERIOR_NAMES = ${JSON.stringify(names)};

export const INTERIOR_PARTS = {
${chunks.join('\n')}
};
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, head, 'utf8');
console.log(`\nвсего ${totalV} вершин, ${totalF} граней -> ${OUT}`);

}
