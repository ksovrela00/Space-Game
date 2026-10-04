// Перегон КАМНЕЙ: фотосканы валунов с Poly Haven (CC0) в формат движка.
//
// Запуск: npm run rocks          node tools/rocks.mjs --list | --clean
//
// Почему сканы. Камень на грунте нужен глазу как МЕРА — предмет
// известного размера, по которому читается высота (js/gl/rocks.js). Но
// мера работает, только если предмет узнаётся: процедурный восьмигранник
// читался серой пирамидой, а пирамида — это не камень, и масштаба она не
// даёт. У скана настоящий силуэт: скол, округлый бок, уступ.
//
// Сканы весят по сто–двести тысяч треугольников, а камней в поле —
// сотни. Поэтому каждый упрощается до нескольких сотен треугольников
// честным способом — схлопыванием рёбер по квадрикам ошибки (Гарланд и
// Хекберт, 1997): ребро, схлопывание которого меньше всего сдвигает
// поверхность, уходит первым. Силуэт при этом остаётся авторским, а
// мелкий рельеф, который сетка уже не держит, возвращает фактура.
//
// ФАКТУРА — тоже скан, тайловая поверхность валуна (rock_boulder_dry): из
// неё, как из фотографии грунта (tools/ground.mjs), берутся рельеф
// (нормаль) и тон, а ЦВЕТ выбрасывается. Красит камень мир, на котором
// он лежит (js/gl/rocks.js, цвет грунта): на ледяном мире камень не
// обязан быть земным песчаником. Укладывается фактура по граням куба —
// у упрощённой сетки своих UV не остаётся, а у камня нет «лица», которое
// развёртка обязана была бы сохранить.
//
// Результат — js/models/rocks.parts.js (формы) и assets/texture/rock.png
// (фактура).

import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  API, page, encodePng, fetchJson, fetchCached, grab, channel, shrink, lowPass,
  mean, std, clamp01, byte, seam,
} from './polyhaven.mjs';
import { GROUND } from '../js/gl/ground.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'js', 'models', 'rocks.parts.js');
// Исходники — десятки мегабайт, и они КЭШИРУЮТСЯ во временной папке.
const TMP = join(tmpdir(), 'space-game-rocks');

/**
 * Формы. Валуны от семидесяти сантиметров до трёх метров — ровно
 * размер камней поля (ROCKS.sizeMin..sizeMax): у мелкой гальки и у
 * скалы силуэт другой, и масштабом его не подделать.
 */
const MODELS = [
  'boulder_01',
  'namaqualand_boulder_02',
  'namaqualand_boulder_03',
  'namaqualand_boulder_04',
  'namaqualand_boulder_05',
  'namaqualand_boulder_06',
];

// Треугольников на камень. Камней в поле до 520 (js/core/quality.js), и
// 320 на каждый — это 170 тысяч на поле у самой земли: меньше, чем одна
// десятая грунта в кадре. Меньше 200 круглый валун уже гранится.
const TRIS = 320;

// Фактура поверхности камня.
const SURF = { slug: 'rock_boulder_dry', maps: ['Diffuse', 'nor_gl', 'Displacement'] };

// --- glTF --------------------------------------------------------------------

/** Мировые матрицы узлов сцены (столбцами, как в glTF). */
function nodeMatrices(json) {
  const mul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
    return o;
  };
  const local = (n) => {
    if (n.matrix) return n.matrix.slice();
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = n.scale || [1, 1, 1];
    const [tx, ty, tz] = n.translation || [0, 0, 0];
    return [
      (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1,
    ];
  };
  const out = [];
  const walk = (i, parent) => {
    const n = json.nodes[i];
    const m = mul(parent, local(n));
    if (n.mesh !== undefined) out.push({ mesh: n.mesh, m });
    for (const c of n.children || []) walk(c, m);
  };
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = json.scenes[json.scene || 0];
  for (const i of scene.nodes) walk(i, id);
  return out;
}

/** Все треугольники сцены в мировых координатах: вершины и индексы. */
function readGltf(json, bin) {
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = (ai) => {
    const a = json.accessors[ai];
    const bv = json.bufferViews[a.bufferView];
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType];
    const stride = bv.byteStride || comps * size;
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const out = new Float64Array(a.count * comps);
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < comps; c++) {
        const o = base + i * stride + c * size;
        out[i * comps + c] = a.componentType === 5126 ? dv.getFloat32(o, true)
          : a.componentType === 5125 ? dv.getUint32(o, true)
            : a.componentType === 5123 ? dv.getUint16(o, true) : dv.getUint8(o);
      }
    }
    return out;
  };
  const pos = [], idx = [];
  for (const { mesh, m } of nodeMatrices(json)) {
    for (const prim of json.meshes[mesh].primitives) {
      if (prim.mode !== undefined && prim.mode !== 4) continue;     // только треугольники
      const p = read(prim.attributes.POSITION);
      const first = pos.length / 3;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        pos.push(m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
      const ix = prim.indices !== undefined ? read(prim.indices) : Array.from({ length: p.length / 3 }, (_, i) => i);
      for (const i of ix) idx.push(first + i);
    }
  }
  return { pos: Float64Array.from(pos), idx: Int32Array.from(idx) };
}

/**
 * Сварка: glTF режет вершины по швам развёртки, и одна точка поверхности
 * лежит в нескольких копиях. Для упрощения нужна связность — иначе шов
 * развёртки распался бы трещиной.
 */
function weld(pos, idx) {
  let lo = Infinity, hi = -Infinity;
  for (const v of pos) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const q = (hi - lo) * 1e-6;
  const map = new Map();
  const remap = new Int32Array(pos.length / 3);
  const out = [];
  for (let i = 0; i < remap.length; i++) {
    const key = `${Math.round(pos[i * 3] / q)},${Math.round(pos[i * 3 + 1] / q)},${Math.round(pos[i * 3 + 2] / q)}`;
    let j = map.get(key);
    if (j === undefined) {
      j = out.length / 3;
      map.set(key, j);
      out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    }
    remap[i] = j;
  }
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]], b = remap[idx[t + 1]], c = remap[idx[t + 2]];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  return { pos: Float64Array.from(out), idx: Int32Array.from(tris) };
}

// --- упрощение по квадрикам ошибки -------------------------------------------
//
// Квадрика вершины — сумма квадратов расстояний до плоскостей её граней
// (с весом площади): 10 чисел симметричной 4×4. Ребро схлопывается в
// точку, где сумма квадрик двух концов минимальна, и цена ребра — эта
// сумма в этой точке. Края дыр (снизу скан открыт: валун лежал на земле)
// держатся плоскостями поперёк края с большим весом — иначе край
// стягивался бы внутрь, и камень приподнимался бы над грунтом.

const qAdd = (q, o, a, b, c, d, w) => {
  q[o] += w * a * a; q[o + 1] += w * a * b; q[o + 2] += w * a * c; q[o + 3] += w * a * d;
  q[o + 4] += w * b * b; q[o + 5] += w * b * c; q[o + 6] += w * b * d;
  q[o + 7] += w * c * c; q[o + 8] += w * c * d; q[o + 9] += w * d * d;
};
const qErr = (q, x, y, z) => q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x
  + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];

class Heap {
  constructor() { this.a = []; }
  push(e) {
    const a = this.a; a.push(e);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].c <= e.c) break; a[i] = a[p]; i = p; }
    a[i] = e;
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mc = last.c;
        if (l < a.length && a[l].c < mc) { m = l; mc = a[l].c; }
        if (r < a.length && a[r].c < mc) m = r;
        if (m === i) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top;
  }
  get size() { return this.a.length; }
}

function simplify(pos, idx, target) {
  const nv = pos.length / 3, nt = idx.length / 3;
  const P = Float64Array.from(pos);
  const T = Int32Array.from(idx);
  const deadT = new Uint8Array(nt);
  const deadV = new Uint8Array(nv);
  const ver = new Int32Array(nv);
  const Q = new Float64Array(nv * 10);
  const vt = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vt[T[t * 3 + k]].push(t);

  const faceN = (t, out) => {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    out[0] = uy * wz - uz * wy; out[1] = uz * wx - ux * wz; out[2] = ux * wy - uy * wx;
    return out;
  };
  const n3 = [0, 0, 0];
  let scale = 0;
  for (let t = 0; t < nt; t++) {
    faceN(t, n3);
    const l = Math.hypot(n3[0], n3[1], n3[2]);
    if (l === 0) continue;
    const nx = n3[0] / l, ny = n3[1] / l, nz = n3[2] / l;
    const a = T[t * 3] * 3;
    const d = -(nx * P[a] + ny * P[a + 1] + nz * P[a + 2]);
    const area = l / 2;
    scale += area;
    for (let k = 0; k < 3; k++) qAdd(Q, T[t * 3 + k] * 10, nx, ny, nz, d, area);
  }
  // Края: ребро, у которого одна грань.
  const edgeCount = new Map();
  const ekey = (a, b) => (a < b ? a * nv + b : b * nv + a);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3];
      const key = ekey(a, b);
      const e = edgeCount.get(key);
      if (e) e.n++; else edgeCount.set(key, { n: 1, t, a, b });
    }
  }
  const BORDER = 1000;
  for (const e of edgeCount.values()) {
    if (e.n !== 1) continue;
    faceN(e.t, n3);
    const ax = P[e.a * 3], ay = P[e.a * 3 + 1], az = P[e.a * 3 + 2];
    const ex = P[e.b * 3] - ax, ey = P[e.b * 3 + 1] - ay, ez = P[e.b * 3 + 2] - az;
    // Плоскость через ребро поперёк грани.
    let px = ey * n3[2] - ez * n3[1], py = ez * n3[0] - ex * n3[2], pz = ex * n3[1] - ey * n3[0];
    const pl = Math.hypot(px, py, pz);
    if (pl === 0) continue;
    px /= pl; py /= pl; pz /= pl;
    const d = -(px * ax + py * ay + pz * az);
    const w = BORDER * Math.hypot(ex, ey, ez) ** 2;
    qAdd(Q, e.a * 10, px, py, pz, d, w);
    qAdd(Q, e.b * 10, px, py, pz, d, w);
  }

  // Точка схлопывания: минимум суммы квадрик, если система разрешима;
  // иначе лучшая из концов и середины.
  const q = new Float64Array(10);
  const best = (a, b, out) => {
    for (let i = 0; i < 10; i++) q[i] = Q[a * 10 + i] + Q[b * 10 + i];
    const A = q[0], B = q[1], C = q[2], D = q[4], E = q[5], F = q[7];
    const det = A * (D * F - E * E) - B * (B * F - E * C) + C * (B * E - D * C);
    if (Math.abs(det) > 1e-12 * scale * scale * scale) {
      const r0 = -q[3], r1 = -q[6], r2 = -q[8];
      out[0] = (r0 * (D * F - E * E) - B * (r1 * F - E * r2) + C * (r1 * E - D * r2)) / det;
      out[1] = (A * (r1 * F - E * r2) - r0 * (B * F - E * C) + C * (B * r2 - r1 * C)) / det;
      out[2] = (A * (D * r2 - r1 * E) - B * (B * r2 - r1 * C) + r0 * (B * E - D * C)) / det;
      return qErr(q, out[0], out[1], out[2]);
    }
    let bc = Infinity;
    for (const s of [0, 0.5, 1]) {
      const x = P[a * 3] + (P[b * 3] - P[a * 3]) * s;
      const y = P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * s;
      const z = P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * s;
      const c = qErr(q, x, y, z);
      if (c < bc) { bc = c; out[0] = x; out[1] = y; out[2] = z; }
    }
    return bc;
  };
  const heap = new Heap();
  const at = [0, 0, 0];
  const pushEdge = (a, b) => {
    const c = best(a, b, at);
    heap.push({ c, a, b, va: ver[a], vb: ver[b] });
  };
  for (const e of edgeCount.values()) pushEdge(e.a, e.b);

  // Схлопывание не должно выворачивать грани: нормаль, повернувшаяся
  // больше чем на ~80°, — это складка, и её не будет видно, пока камень
  // не повернётся к свету тем самым боком.
  const flips = (v, other, x, y, z) => {
    for (const t of vt[v]) {
      if (deadT[t]) continue;
      const i0 = T[t * 3], i1 = T[t * 3 + 1], i2 = T[t * 3 + 2];
      if (i0 === other || i1 === other || i2 === other) continue;   // уйдёт вместе с ребром
      faceN(t, n3);
      const ox = n3[0], oy = n3[1], oz = n3[2];
      const save = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
      faceN(t, n3);
      P[v * 3] = save[0]; P[v * 3 + 1] = save[1]; P[v * 3 + 2] = save[2];
      const lo = Math.hypot(ox, oy, oz), ln = Math.hypot(n3[0], n3[1], n3[2]);
      if (ln === 0 || (ox * n3[0] + oy * n3[1] + oz * n3[2]) < 0.2 * lo * ln) return true;
    }
    return false;
  };

  let live = nt;
  while (live > target && heap.size) {
    const e = heap.pop();
    const { a, b } = e;
    if (deadV[a] || deadV[b] || ver[a] !== e.va || ver[b] !== e.vb) continue;
    best(a, b, at);
    const [x, y, z] = at;
    if (flips(a, b, x, y, z) || flips(b, a, x, y, z)) continue;
    // a остаётся в новой точке, b уходит.
    P[a * 3] = x; P[a * 3 + 1] = y; P[a * 3 + 2] = z;
    for (let i = 0; i < 10; i++) Q[a * 10 + i] += Q[b * 10 + i];
    deadV[b] = 1;
    for (const t of vt[b]) {
      if (deadT[t]) continue;
      const has = T[t * 3] === a || T[t * 3 + 1] === a || T[t * 3 + 2] === a;
      if (has) { deadT[t] = 1; live--; continue; }
      for (let k = 0; k < 3; k++) if (T[t * 3 + k] === b) T[t * 3 + k] = a;
      vt[a].push(t);
    }
    vt[a] = vt[a].filter((t) => !deadT[t]);
    ver[a]++;
    // Цена изменилась только у рёбер самой a: у прочих рёбер соседей
    // квадрики концов те же. Старые записи о рёбрах a в куче отсеет
    // счётчик версий, о рёбрах b — то, что b больше нет.
    const nb = new Set();
    for (const t of vt[a]) for (let k = 0; k < 3; k++) if (T[t * 3 + k] !== a) nb.add(T[t * 3 + k]);
    for (const v of nb) pushEdge(a, v);
  }
  // Сборка: только живые вершины и грани.
  const re = new Int32Array(nv).fill(-1);
  const outP = [], outI = [];
  for (let t = 0; t < nt; t++) {
    if (deadT[t]) continue;
    for (let k = 0; k < 3; k++) {
      const v = T[t * 3 + k];
      if (re[v] < 0) { re[v] = outP.length / 3; outP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
      outI.push(re[v]);
    }
  }
  return { pos: Float64Array.from(outP), idx: Int32Array.from(outI) };
}

// --- форма в формат движка ---------------------------------------------------

/**
 * Камень лежит на грунте: низ — ноль, по горизонтали — середина, а
 * полуширина — единица (ROCKS.sizeMin..sizeMax задают именно её).
 * Нормали — гладкие, по площади граней: валун круглый, и плоская
 * огранка на трёхстах треугольниках читалась бы той же пирамидой. UV —
 * по граням куба: ось, к которой грань повёрнута сильнее, выбрасывается.
 */
function finish(m) {
  const n = m.pos.length / 3;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, m.pos[i * 3]); x1 = Math.max(x1, m.pos[i * 3]);
    y0 = Math.min(y0, m.pos[i * 3 + 1]); y1 = Math.max(y1, m.pos[i * 3 + 1]);
    z0 = Math.min(z0, m.pos[i * 3 + 2]); z1 = Math.max(z1, m.pos[i * 3 + 2]);
  }
  const half = Math.max(x1 - x0, z1 - z0) / 2;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const p = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    p[i * 3] = (m.pos[i * 3] - cx) / half;
    p[i * 3 + 1] = (m.pos[i * 3 + 1] - y0) / half;
    p[i * 3 + 2] = (m.pos[i * 3 + 2] - cz) / half;
  }
  // Гладкие нормали.
  const nr = new Float64Array(n * 3);
  const fn = [];
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    fn.push(nx, ny, nz);
    for (const v of [a, b, c]) { nr[v] += nx; nr[v + 1] += ny; nr[v + 2] += nz; }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2]) || 1;
    nr[i * 3] /= l; nr[i * 3 + 1] /= l; nr[i * 3 + 2] /= l;
  }
  // UV куба: вершина размножается по осям проекции граней вокруг неё.
  const pos = [], nrm = [], uv = [], idx = [];
  const key = new Map();
  for (let t = 0; t < m.idx.length / 3; t++) {
    const ax = Math.abs(fn[t * 3]), ay = Math.abs(fn[t * 3 + 1]), az = Math.abs(fn[t * 3 + 2]);
    const axis = ax >= ay && ax >= az ? 0 : (ay >= az ? 1 : 2);
    for (let k = 0; k < 3; k++) {
      const v = m.idx[t * 3 + k];
      const id = v * 3 + axis;
      let j = key.get(id);
      if (j === undefined) {
        j = pos.length / 3;
        key.set(id, j);
        const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
        pos.push(x, y, z);
        nrm.push(nr[v * 3], nr[v * 3 + 1], nr[v * 3 + 2]);
        if (axis === 0) uv.push(z, y); else if (axis === 1) uv.push(x, z); else uv.push(x, y);
      }
      idx.push(j);
    }
  }
  return { pos, nrm, uv, idx, height: (y1 - y0) / half, sizeM: half * 2 };
}

// --- фактура -----------------------------------------------------------------

/**
 * Рельеф и тон поверхности камня — в том же виде, что зерно грунта
 * (tools/ground.mjs, buildGrain): нормаль в R и G, тон в B, знак зелёного
 * сверен с картой высот, крупные пятна вычтены. Камень показывается с
 * пары метров, поэтому вычитается мельче, чем у грунта: остаётся всё,
 * что меньше GROUND.rock.low-й доли куска.
 */
async function buildSurface(cfg, want) {
  const out = want.px;
  const diff = await grab(cfg.slug, 'Diffuse', TMP);
  const nor = await grab(cfg.slug, 'nor_gl', TMP);
  const disp = await grab(cfg.slug, 'Displacement', TMP);
  const w = diff.w;
  if (nor.w !== w || disp.w !== w) throw new Error('карты разного размера');
  const nx = shrink(channel(nor, 0), w, out).map((v) => v * 2 - 1);
  const ny = shrink(channel(nor, 1), w, out).map((v) => v * 2 - 1);
  const h = shrink(channel(disp, 0), w, out);
  const corr = (comp, dy) => {
    let s = 0, a = 0, b = 0;
    for (let y = 1; y < out - 1; y++) {
      for (let x = 1; x < out - 1; x++) {
        const i = y * out + x;
        const g = dy ? (h[i + out] - h[i - out]) / 2 : (h[i + 1] - h[i - 1]) / 2;
        s += -g * comp[i]; a += g * g; b += comp[i] * comp[i];
      }
    }
    return s / Math.sqrt(a * b);
  };
  const cx = corr(nx, false);
  const flipY = corr(ny, true) < 0;
  if (flipY) for (let i = 0; i < ny.length; i++) ny[i] = -ny[i];
  const cy = corr(ny, true);
  if (cx < 0.2 || cy < 0.2) {
    throw new Error(`нормаль не сходится с высотой (${cx.toFixed(2)}, ${cy.toFixed(2)}): бугры выйдут ямками`);
  }
  const r = shrink(channel(diff, 0), w, out, true);
  const g = shrink(channel(diff, 1), w, out, true);
  const b = shrink(channel(diff, 2), w, out, true);
  const lum = r.map((v, i) => 0.299 * v + 0.587 * g[i] + 0.114 * b[i]);
  const lm = mean(lum);
  const tone = lum.map((v) => v / lm);
  const was = [std(nx), std(ny), std(tone)];
  for (const a of [nx, ny]) {
    const low = lowPass(a, out, want.low);
    for (let i = 0; i < a.length; i++) a[i] -= low[i];
  }
  {
    const low = lowPass(tone, out, want.low);
    for (let i = 0; i < tone.length; i++) tone[i] += 1 - low[i];
  }
  const px = Buffer.alloc(out * out * 3);
  for (let i = 0; i < out * out; i++) {
    px[i * 3] = byte(clamp01(nx[i] * 0.5 + 0.5));
    px[i * 3 + 1] = byte(clamp01(ny[i] * 0.5 + 0.5));
    px[i * 3 + 2] = byte(clamp01(tone[i] * 0.5));
  }
  return {
    px,
    report: [
      `нормаль: зелёный канал ${flipY ? 'перевёрнут' : 'как есть'}, согласие с высотой ` +
      `${cx.toFixed(2)} / ${cy.toFixed(2)}`,
      `разброс тона ${std(tone).toFixed(2)} (было ${was[2].toFixed(2)}), шов ${seam([nx, ny, tone], out).toFixed(2)}`,
    ],
  };
}

// --- запуск ------------------------------------------------------------------

const num = (v) => {
  const s = (Math.round(v * 1e4) / 1e4).toString();
  return s === '-0' ? '0' : s;
};

if (process.argv.includes('--clean')) {
  await rm(TMP, { recursive: true, force: true });
  console.log('кэш исходников удалён: ' + TMP);
} else if (process.argv.includes('--list')) {
  for (const slug of [...MODELS, SURF.slug]) {
    const info = await fetchJson(`${API}/info/${slug}`);
    console.log(`${slug.padEnd(24)} ${Object.keys(info.authors).join(', ').padEnd(16)} CC0  ${page(slug)}`);
  }
} else {
  const shapes = [];
  for (const slug of MODELS) {
    const info = await fetchJson(`${API}/info/${slug}`);
    const files = await fetchJson(`${API}/files/${slug}`);
    const g = files.gltf['1k'].gltf;
    const json = JSON.parse((await fetchCached(g.url, g.size, TMP)).toString('utf8'));
    const binName = Object.keys(g.include).find((k) => k.endsWith('.bin'));
    const bin = await fetchCached(g.include[binName].url, g.include[binName].size, TMP);
    const t0 = Date.now();
    const raw = readGltf(json, bin);
    const welded = weld(raw.pos, raw.idx);
    const low = simplify(welded.pos, welded.idx, TRIS);
    const f = finish(low);
    const author = Object.keys(info.authors).join(', ');
    console.log(`${slug}: ${raw.idx.length / 3} -> ${f.idx.length / 3} треугольников за ${Date.now() - t0} мс, ` +
      `${f.sizeM.toFixed(2)} м в поперечнике, высота ${f.height.toFixed(2)} полуширины, ${f.pos.length / 3} вершин`);
    shapes.push({ slug, author, f });
  }
  const want = GROUND.rock;
  const sinfo = await fetchJson(`${API}/info/${SURF.slug}`);
  const sizeKm = sinfo.dimensions[0] / 1e6;
  if (Math.abs(sizeKm - want.sizeKm) > 1e-6) {
    throw new Error(`${SURF.slug}: кусок ${sizeKm * 1000} м, а в js/gl/ground.js записано ${want.sizeKm * 1000} м`);
  }
  const surf = await buildSurface(SURF, want);
  const png = encodePng(want.px, want.px, surf.px);
  await mkdir(dirname(join(ROOT, want.file)), { recursive: true });
  await writeFile(join(ROOT, want.file), png);
  console.log(`фактура ${SURF.slug}: ${want.file}, ${want.px}×${want.px}, ${(png.length / 1024).toFixed(0)} КБ, кусок ${(sizeKm * 1000).toFixed(2)} м`);
  for (const r of surf.report) console.log('  ' + r);
  const sauthor = Object.keys(sinfo.authors).join(', ');

  const lines = [
    '// Камни: формы из фотосканов Poly Haven (CC0), упрощённые tools/rocks.mjs.',
    '// Сгенерировано — не править руками: node tools/rocks.mjs.',
    '//',
    '// Форма в своих осях: y вверх, низ на нуле, полуширина — единица.',
    '// uv — проекция на грани куба в тех же единицах (js/gl/rocks.js',
    '// переводит их в куски фактуры по размеру камня).',
    '',
    `export const ROCK_SURFACE = { slug: '${SURF.slug}', author: '${sauthor}', license: 'CC0', url: '${page(SURF.slug)}' };`,
    '',
    'export const ROCK_SHAPES = [',
  ];
  for (const s of shapes) {
    const f = s.f;
    lines.push('  {');
    lines.push(`    slug: '${s.slug}', author: '${s.author}', license: 'CC0', url: '${page(s.slug)}',`);
    lines.push(`    height: ${num(f.height)},`);
    lines.push(`    pos: [${f.pos.map(num).join(',')}],`);
    lines.push(`    nrm: [${f.nrm.map(num).join(',')}],`);
    lines.push(`    uv: [${f.uv.map(num).join(',')}],`);
    lines.push(`    idx: [${f.idx.join(',')}],`);
    lines.push('  },');
  }
  lines.push('];', '');
  await writeFile(OUT, lines.join('\n'));
  console.log(`готово: ${OUT} — ${shapes.length} форм, ${(lines.join('\n').length / 1024).toFixed(0)} КБ`);
}
