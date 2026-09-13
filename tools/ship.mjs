// Перегон готовой модели корабля (OBJ + текстура) в формат движка.
//
// Запуск: npm run ship [Имя]        node tools/ship.mjs --list
//
// Зачем конвертер, а не загрузка OBJ на лету. Движок рисует корабли
// ПЛОСКИМ затенением и без текстур: цвет живёт на грани (js/gl/mesh.js,
// buildFlatMesh). Значит, всё нужное от исходника берётся один раз
// заранее:
//
//   * геометрия — четырёхугольники как есть, движок их понимает;
//   * цвет — усреднением текстуры по UV-развёртке каждой грани. Для
//     плоского затенения это не потеря, а ровно то, что нужно: ливрея,
//     тёмный фонарь и оранжевые накладки остаются, а панельные линии в
//     затенении по грани всё равно не пережили бы;
//   * оси и масштаб — модель приводится к осям игры (нос +Z, верх +Y,
//     центр в нуле) и к длине корпуса из js/models/ships.js.
//
// Результат — js/models/hull.data.js, обычный модуль с числами, а не
// внешний файл: корпус нужен в первом же кадре, и ждать ради него сеть
// неправильно.

import { mkdir, readdir, access, rm, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'js', 'models', 'hull.data.js');
// Пак весит 98 МБ, поэтому он КЭШИРУЕТСЯ — и не в репозитории, а в
// системном temp: перегон другого корабля идёт уже без сети.
// Освободить место: node tools/ship.mjs --clean
const TMP = join(tmpdir(), 'space-game-ships');

const PACK = {
  url: 'https://opengameart.org/sites/default/files/ultimate_spaceships_-_may_2021.zip',
  page: 'https://opengameart.org/content/lowpoly-spaceships-pack',
  author: 'Quaternius',
  license: 'CC0',
};

// Длина корпуса в километрах — та же, что была у процедурной «Кобры»
// (65 м). От неё зависят посадка, камера и тень, поэтому она задаётся
// здесь, а не подгонкой модели.
const TARGET_LENGTH = 0.065;

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

// --- PNG (8 бит, RGB/RGBA, без интерлейса) ----------------------------------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('не PNG');
  let w = 0, h = 0, depth = 0, type = 0;
  const idat = [];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const tag = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (tag === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; type = data[9];
      if (depth !== 8 || (type !== 2 && type !== 6) || data[12] !== 0) {
        throw new Error(`нужен PNG 8 бит RGB/RGBA без интерлейса (глубина ${depth}, тип ${type})`);
      }
    } else if (tag === 'IDAT') idat.push(data);
    else if (tag === 'IEND') break;
    o += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  // Развёртка фильтров PNG: каждая строка предсказана по соседям.
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  return { w, h, bpp, px };
}

// --- OBJ --------------------------------------------------------------------
function parseObj(text) {
  const verts = [], uvs = [], norms = [], faces = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s.startsWith('v ')) {
      const p = s.split(/\s+/);
      verts.push([+p[1], +p[2], +p[3]]);
    } else if (s.startsWith('vt ')) {
      const p = s.split(/\s+/);
      uvs.push([+p[1], +p[2]]);
    } else if (s.startsWith('vn ')) {
      const p = s.split(/\s+/);
      norms.push([+p[1], +p[2], +p[3]]);
    } else if (s.startsWith('f ')) {
      const v = [], t = [], n = [];
      for (const p of s.split(/\s+/).slice(1)) {
        const [vi, ti, ni] = p.split('/');
        const idx = (x, len) => { const i = parseInt(x, 10); return i > 0 ? i - 1 : len + i; };
        v.push(idx(vi, verts.length));
        if (ti) t.push(idx(ti, uvs.length));
        if (ni) n.push(idx(ni, norms.length));
      }
      faces.push({ v, t, n });
    }
  }
  return { verts, uvs, norms, faces };
}

/**
 * Средний цвет грани: выборка по её UV-развёртке.
 *
 * Именно среднее по площади, а не «цвет в середине»: в середину грани
 * нередко попадает панельная линия или люк, и тогда вся деталь красится
 * в белое. Среднее даёт тон материала, а не случайной точки.
 */
function faceColor(tex, uvs, face) {
  if (!face.t.length) return [150, 150, 155];
  let r = 0, g = 0, b = 0, n = 0;
  const at = (u, v) => {
    // В OBJ координата V снизу вверх, в картинке — сверху вниз.
    const x = Math.max(0, Math.min(tex.w - 1, Math.round(u * (tex.w - 1))));
    const y = Math.max(0, Math.min(tex.h - 1, Math.round((1 - v) * (tex.h - 1))));
    const o = (y * tex.w + x) * tex.bpp;
    r += tex.px[o]; g += tex.px[o + 1]; b += tex.px[o + 2]; n++;
  };
  const T = face.t;
  for (let k = 1; k + 1 < T.length; k++) {
    const a = uvs[T[0]], c = uvs[T[k]], d = uvs[T[k + 1]];
    if (!a || !c || !d) continue;
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; i + j <= 4; j++) {
        const w0 = i / 4, w1 = j / 4, w2 = 1 - w0 - w1;
        at(a[0] * w0 + c[0] * w1 + d[0] * w2, a[1] * w0 + c[1] * w1 + d[1] * w2);
      }
    }
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [150, 150, 155];
}

/**
 * Куда у модели нос.
 *
 * Вверх — ось с наименьшим размахом: корабль плоский. С носом сложнее:
 * длина корпуса и размах крыльев сравнимы. Различает их
 * НЕСИММЕТРИЧНОСТЬ концов — вдоль корпуса сечение у носа узкое, у кормы
 * широкое, а вдоль крыла оба конца одинаково узкие. Продольная ось та,
 * где разница концов больше; нос — тот конец, где сечение меньше.
 */
function guessAxes(verts) {
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const v of verts) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]);
  }
  const ext = [0, 1, 2].map((i) => max[i] - min[i]);
  const up = ext.indexOf(Math.min(...ext));
  const rest = [0, 1, 2].filter((i) => i !== up);

  const section = (axis, other, from, to) => {
    let lo = 1e9, hi = -1e9;
    for (const v of verts) {
      const t = (v[axis] - min[axis]) / (ext[axis] || 1);
      if (t < from || t > to) continue;
      lo = Math.min(lo, v[other]); hi = Math.max(hi, v[other]);
    }
    return hi > lo ? hi - lo : 0;
  };

  let fwd = rest[0], asym = -1, noseAtMax = true;
  for (const axis of rest) {
    const other = rest.find((i) => i !== axis);
    const head = section(axis, other, 0, 0.2);
    const tail = section(axis, other, 0.8, 1);
    const score = Math.abs(head - tail) / Math.max(head, tail, 1e-9);
    // Нос там, где сечение УЖЕ: если узкий конец у максимума оси —
    // значит нос смотрит в плюс.
    if (score > asym) { asym = score; fwd = axis; noseAtMax = tail < head; }
  }
  return { fwd, up, noseAtMax, ext, min, max, asym };
}

/** Силуэт текстом — проверить оси и обводы, не открывая браузер. */
function ascii(verts, faces, axX, axY, w = 62, h = 24) {
  const grid = Array.from({ length: h }, () => new Array(w).fill(' '));
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const v of verts) {
    minX = Math.min(minX, v[axX]); maxX = Math.max(maxX, v[axX]);
    minY = Math.min(minY, v[axY]); maxY = Math.max(maxY, v[axY]);
  }
  const sx = (maxX - minX) || 1, sy = (maxY - minY) || 1;
  const put = (p) => {
    const x = Math.round((p[axX] - minX) / sx * (w - 1));
    const y = h - 1 - Math.round((p[axY] - minY) / sy * (h - 1));
    if (x >= 0 && x < w && y >= 0 && y < h) grid[y][x] = '#';
  };
  for (const f of faces) {
    for (let k = 0; k < f.v.length; k++) {
      const a = verts[f.v[k]], b = verts[f.v[(k + 1) % f.v.length]];
      for (let s = 0; s <= 24; s++) {
        const t = s / 24;
        put([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
  }
  return grid.map((r) => r.join('')).join('\n');
}

export { decodePng, parseObj, faceColor, guessAxes, ascii, TARGET_LENGTH };

// --- дальше — сам перегон ----------------------------------------------------
const isMain = import.meta.url === new URL(process.argv[1], 'file:///').href
  || import.meta.url.endsWith('/ship.mjs') && process.argv[1].endsWith('ship.mjs');
if (!isMain) { /* импортируют как библиотеку */ } else {

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--')) || 'Challenger';

if (args.includes('--clean')) {
  await rm(TMP, { recursive: true, force: true });
  console.log('кэш пака удалён: ' + TMP);
  process.exit(0);
}

await mkdir(TMP, { recursive: true });
const packDir = join(TMP, 'pack');
if (!await exists(packDir)) {
  const zip = join(TMP, 'ships.zip');
  if (!await exists(zip)) {
    console.log('качаю ' + PACK.url + ' (98 МБ)');
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

const roots = await readdir(packDir);
const base = join(packDir, roots.find((r) => !r.startsWith('.')) || '');
const ships = (await readdir(base, { withFileTypes: true }))
  .filter((e) => e.isDirectory()).map((e) => e.name);

if (args.includes('--list')) {
  console.log(`В паке ${PACK.author} (${PACK.license}): ${ships.join(', ')}`);
  process.exit(0);
}
if (!ships.includes(name)) {
  console.error(`нет корабля «${name}». Есть: ${ships.join(', ')}`);
  process.exit(1);
}

const objDir = join(base, name, 'OBJ');
const obj = parseObj(await readFile(join(objDir, name + '.obj'), 'utf8'));
const texDir = join(base, name, 'Textures');
const texFile = (await readdir(texDir)).find((f) => f.endsWith('.png'));
const tex = decodePng(await readFile(join(texDir, texFile)));
console.log(`${name}: ${obj.verts.length} вершин, ${obj.faces.length} граней, ` +
  `текстура ${texFile} ${tex.w}x${tex.h}`);

// --- оси и масштаб -----------------------------------------------------------
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const axisVec = (i, sign) => { const v = [0, 0, 0]; v[i] = sign; return v; };

const ax = guessAxes(obj.verts);
let fwdVec = axisVec(ax.fwd, ax.noseAtMax ? 1 : -1);
let upVec = axisVec(ax.up, 1);
const override = args.find((a) => a.startsWith('--fwd='));
if (override) {
  const m = /^--fwd=([+-])([xyz])$/.exec(override);
  if (!m) { console.error('вид: --fwd=+z, --fwd=-x'); process.exit(1); }
  fwdVec = axisVec('xyz'.indexOf(m[2]), m[1] === '-' ? -1 : 1);
}
// Правая тройка строится из «вверх» и «вперёд»: зеркалить ничего не
// нужно, а значит и обход вершин у граней сохраняется.
const rightVec = cross(upVec, fwdVec);

const fwdAxis = fwdVec.findIndex((v) => v !== 0);
const scale = TARGET_LENGTH / ax.ext[fwdAxis];
const centre = [0, 1, 2].map((i) => (ax.min[i] + ax.max[i]) / 2);

const verts = obj.verts.map((v) => {
  const p = [v[0] - centre[0], v[1] - centre[1], v[2] - centre[2]];
  return [dot3(p, rightVec) * scale, dot3(p, upVec) * scale, dot3(p, fwdVec) * scale];
});

// --- грани -------------------------------------------------------------------
const faceNormal = (f) => {
  const a = verts[f.v[0]], b = verts[f.v[1]], c = verts[f.v[2]];
  const n = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
};
const centroid = (f) => {
  const c = [0, 0, 0];
  for (const i of f.v) { c[0] += verts[i][0]; c[1] += verts[i][1]; c[2] += verts[i][2]; }
  return [c[0] / f.v.length, c[1] / f.v.length, c[2] / f.v.length];
};

let flipped = 0;
const faces = obj.faces.map((f) => {
  const face = { v: f.v.slice(), c: faceColor(tex, obj.uvs, f) };
  // Обход вершин сверяем с нормалями исходника: движок считает нормаль
  // из порядка вершин, и грань с обратным обходом окажется чёрной.
  if (f.n.length && obj.norms.length) {
    const want = [0, 0, 0];
    for (const ni of f.n) {
      const n = obj.norms[ni];
      if (n) { want[0] += n[0]; want[1] += n[1]; want[2] += n[2]; }
    }
    const w = [dot3(want, rightVec), dot3(want, upVec), dot3(want, fwdVec)];
    if (dot3(faceNormal(face), w) < 0) { face.v.reverse(); flipped++; }
  }
  return face;
});

/**
 * Точки факелов: грани, которые смотрят НАЗАД и стоят в корме, — это
 * срезы дюз. Их центры группируются по знаку X, получаются левая и
 * правая связки, что и нужно рисовать.
 */
function findExhausts() {
  const zs = verts.map((v) => v[2]);
  const back = Math.min(...zs), len = Math.max(...zs) - back;
  const cand = [];
  for (const f of faces) {
    if (faceNormal(f)[2] > -0.75) continue;           // смотрит не назад
    const c = centroid(f);
    if (c[2] > back + len * 0.18) continue;           // стоит не в корме
    cand.push(c);
  }
  const mean = (list) => {
    const m = [0, 0, 0];
    for (const c of list) { m[0] += c[0]; m[1] += c[1]; m[2] += c[2]; }
    return [m[0] / list.length, m[1] / list.length, m[2] / list.length];
  };
  if (!cand.length) return [[0, 0, back - len * 0.04]];
  const left = cand.filter((c) => c[0] < -1e-6);
  const right = cand.filter((c) => c[0] > 1e-6);
  const out = [];
  if (left.length) out.push(mean(left));
  if (right.length) out.push(mean(right));
  if (!out.length) out.push(mean(cand));
  // Факел рисуется чуть позади среза, иначе тонет в корпусе.
  return out.map((c) => [c[0], c[1], c[2] - len * 0.03]);
}
const exhausts = findExhausts();

/**
 * Стойки шасси: одна впереди, две по бортам сзади. Высота берётся по
 * самому низкому месту корпуса вокруг точки — иначе стойка растёт из
 * воздуха или из середины обшивки.
 */
function gearPoints() {
  const zs = verts.map((v) => v[2]), xs = verts.map((v) => Math.abs(v[0]));
  const zMin = Math.min(...zs), zMax = Math.max(...zs);
  const halfW = Math.max(...xs);
  const floorAt = (x0, z0, rx, rz) => {
    let y = 0, found = false;
    for (const v of verts) {
      if (Math.abs(v[0] - x0) > rx || Math.abs(v[2] - z0) > rz) continue;
      if (!found || v[1] < y) { y = v[1]; found = true; }
    }
    return found ? y : 0;
  };
  const zf = zMin + (zMax - zMin) * 0.72;
  const zb = zMin + (zMax - zMin) * 0.28;
  const rx = halfW * 0.3, rz = (zMax - zMin) * 0.12;
  const xb = halfW * 0.42;
  return [
    [0, floorAt(0, zf, rx, rz), zf],
    [-xb, floorAt(-xb, zb, rx, rz), zb],
    [xb, floorAt(xb, zb, rx, rz), zb],
  ];
}
const gear = gearPoints();

// --- запись ------------------------------------------------------------------
// Координаты пишутся целыми МИЛЛИМЕТРАМИ: файл втрое короче, чем с
// плавающей точкой, а миллиметра на корпусе в 65 метров хватает.
const MM = 1e6;
const vFlat = [];
for (const v of verts) for (const c of v) vFlat.push(Math.round(c * MM));
const fFlat = [];
for (const f of faces) fFlat.push(f.v.length, ...f.v, ...f.c);
const pts = (list) => '[' + list
  .map((p) => '[' + p.map((c) => Math.round(c * MM)).join(', ') + ']').join(', ') + ']';
const wrap = (arr, per) => {
  const out = [];
  for (let i = 0; i < arr.length; i += per) out.push('  ' + arr.slice(i, i + per).join(', ') + ',');
  return out.join('\n');
};

await writeFile(OUT, `// СГЕНЕРИРОВАНО tools/ship.mjs — руками не править.
//
// Корпус «${name}» из пака ${PACK.author} (${PACK.license}):
// ${PACK.page}
//
// Координаты — целые МИЛЛИМЕТРЫ в осях игры (нос +Z, верх +Y, центр в
// нуле); цвет — на грань, потому что корабли рисуются плоским
// затенением (js/gl/mesh.js). Пересобрать: npm run ship ${name}

export const HULL_NAME = '${name}';
export const HULL_LENGTH = ${TARGET_LENGTH};

/** x, y, z подряд, в миллиметрах. */
export const HULL_VERTS = [
${wrap(vFlat, 24)}
];

/** Подряд: число вершин, их номера, затем r, g, b. */
export const HULL_FACES = [
${wrap(fFlat, 24)}
];

/** Точки факелов двигателей, миллиметры. */
export const HULL_EXHAUSTS = ${pts(exhausts)};

/** Точки крепления стоек шасси, миллиметры. */
export const HULL_GEAR = ${pts(gear)};
`);

const dim = ['X', 'Y', 'Z'].map((k, i) => {
  const vals = verts.map((v) => v[i]);
  return `${k} ${((Math.max(...vals) - Math.min(...vals)) * 1000).toFixed(1)} м`;
});
const m = (p) => '(' + p.map((c) => (c * 1000).toFixed(1)).join(', ') + ')';
console.log(`оси исходника: вперёд ${'xyz'[ax.fwd]}${ax.noseAtMax ? '+' : '-'}, ` +
  `верх ${'xyz'[ax.up]}, несимметричность концов ${(ax.asym * 100).toFixed(0)}%`);
console.log(`после приведения: ${dim.join(', ')}, масштаб x${scale.toFixed(4)}`);
console.log(`обход вершин исправлен у ${flipped} граней из ${faces.length}`);
console.log(`сопла: ${exhausts.map(m).join('  ')}`);
console.log(`шасси: ${gear.map(m).join('  ')}`);
console.log('\nсверху (нос вверх):\n' + ascii(verts, faces, 0, 2));
console.log('\nсбоку (нос вправо):\n' + ascii(verts, faces, 2, 1));
console.log('\n-> ' + OUT);

}
