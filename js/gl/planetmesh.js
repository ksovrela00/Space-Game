// Сборка меша тела: икосфера + смещение вершин рельефом + цвет биома +
// нормали. Меш живёт в единичном радиусе, масштаб задаётся матрицей
// объекта, поэтому одну и ту же геометрию можно использовать для тела
// любого размера.
//
// Генерация не мгновенная: уровень 6 — это 41 тысяча вершин и около
// 60 мс работы. Поэтому меши собираются ПОРЦИЯМИ в фоновой очереди
// (pumpBuilds), а пока подробный уровень не готов, рисуется тот, что
// уже есть. Иначе первый же подлёт к телу давал бы провал кадра.

import { icosphere, computeNormals, levelForPixels, edgeAngle } from './icosphere.js';
import { terrainOf } from './terrain.js';
import { buildIndexedMesh } from './mesh.js';

export { terrainOf };

/**
 * Порционный сборщик геометрии. step(n) обрабатывает n вершин и
 * возвращает true, когда всё готово (результат — в .result).
 */
export function planetBuilder(body, level) {
  const base = icosphere(level);
  const terrain = terrainOf(body);
  const detail = terrain.detailForCell(edgeAngle(level));
  const n = base.positions.length / 3;

  const positions = new Float32Array(base.positions.length);
  const colors = new Float32Array(n * 4);
  const rgb = [0, 0, 0];

  // Светило — однородный самосветящийся шар своего цвета: процедурные
  // биомы ему не нужны (иначе досталась бы серая каменная палитра).
  const isStar = body.kind === 'star';
  const sr = body.color[0] / 255, sg = body.color[1] / 255, sb = body.color[2] / 255;

  let i = 0;
  let result = null;

  return {
    body, level, total: n,
    get result() { return result; },
    get progress() { return i / n; },
    step(count = 1 << 30) {
      const end = Math.min(n, i + count);
      for (; i < end; i++) {
        const x = base.positions[i * 3];
        const y = base.positions[i * 3 + 1];
        const z = base.positions[i * 3 + 2];
        const h = 1 + (isStar ? 0 : terrain.sample(x, y, z, detail, rgb));
        positions[i * 3] = x * h;
        positions[i * 3 + 1] = y * h;
        positions[i * 3 + 2] = z * h;
        colors[i * 4] = isStar ? sr : rgb[0];
        colors[i * 4 + 1] = isStar ? sg : rgb[1];
        colors[i * 4 + 2] = isStar ? sb : rgb[2];
        colors[i * 4 + 3] = isStar ? 1 : 0;          // альфа = «сам светится»
      }
      if (i < n) return false;
      // Нормали считаем по УЖЕ смещённой геометрии, иначе рельеф не будет
      // виден в освещении — только силуэтом на кромке.
      const normals = terrain.isFlat
        ? base.positions.slice()
        : computeNormals(positions, base.indices);
      result = {
        positions, normals, colors, indices: base.indices,
        level, detail, faces: base.faceCount,
      };
      return true;
    },
  };
}

/** Геометрия планеты целиком — этой частью пользуются проверки. */
export function planetGeometry(body, level) {
  const b = planetBuilder(body, level);
  b.step();
  return b.result;
}

// --- Очередь сборки ----------------------------------------------------------

const QUEUE = [];

/**
 * Меш нужного уровня, если он готов. Иначе — лучший из готовых, а нужный
 * ставится в очередь. Совсем пустой случай закрывается грубым уровнем:
 * он собирается мгновенно.
 */
export function requestPlanetMesh(gl, locs, body, level) {
  if (!body._glMeshes) body._glMeshes = new Map();
  const meshes = body._glMeshes;
  const exact = meshes.get(level);
  if (exact) return exact;

  if (!body._glQueued) body._glQueued = new Set();
  if (!body._glQueued.has(level)) {
    body._glQueued.add(level);
    QUEUE.push(planetBuilder(body, level));
  }

  // Ближайший готовый уровень: сначала ищем ниже (он точно дешевле).
  for (let lv = level - 1; lv >= 0; lv--) {
    const m = meshes.get(lv);
    if (m) return m;
  }
  for (let lv = level + 1; lv <= 6; lv++) {
    const m = meshes.get(lv);
    if (m) return m;
  }
  const fallback = Math.min(level, 2);
  const geo = planetGeometry(body, fallback);
  const mesh = buildIndexedMesh(gl, locs, geo);
  mesh.faces = geo.faces;
  meshes.set(fallback, mesh);
  return mesh;
}

/**
 * Довести очередь сборки за отведённое время (мс). Вызывается раз в кадр.
 * @returns сколько мешей дособрано
 */
export function pumpBuilds(gl, locs, msBudget = 4) {
  if (!QUEUE.length) return 0;
  const t0 = performance.now();
  let built = 0;
  while (QUEUE.length) {
    const b = QUEUE[0];
    // Уровень, который уже неактуален (тело далеко), досчитывать незачем.
    if (b.body._glLevel !== undefined && Math.abs(b.body._glLevel - b.level) > 1) {
      b.body._glQueued.delete(b.level);
      QUEUE.shift();
      continue;
    }
    const done = b.step(2048);
    if (done) {
      const geo = b.result;
      const mesh = buildIndexedMesh(gl, locs, geo);
      mesh.faces = geo.faces;
      b.body._glMeshes.set(b.level, mesh);
      b.body._glQueued.delete(b.level);
      QUEUE.shift();
      built++;
    }
    if (performance.now() - t0 >= msBudget) break;
  }
  return built;
}

export const pendingBuilds = () => QUEUE.length;

/**
 * Освободить всё, что собрано для этих тел: буферы GPU и очередь сборки.
 *
 * Нужно при смене звёздной системы. Меши висят НА САМИХ телах
 * (`body._glMeshes`), поэтому сборщик мусора убрал бы их вместе со старым
 * миром — но только объекты-обёртки. Буферы живут в драйвере и по ссылкам
 * из JS не считаются: их надо удалять руками, иначе каждый прыжок оставлял
 * бы в видеопамяти целую систему.
 *
 * Очередь чистится тем же вызовом: в ней лежат задания на тела, которых
 * уже нет, и pumpBuilds честно достроил бы их и залил в GPU.
 */
export function disposePlanetMeshes(bodies) {
  const dead = new Set(bodies);
  let freed = 0;
  for (const body of bodies) {
    if (body._glMeshes) {
      for (const m of body._glMeshes.values()) { m.dispose(); freed++; }
      body._glMeshes.clear();
    }
    if (body._glQueued) body._glQueued.clear();
    body._glLevel = undefined;
  }
  for (let i = QUEUE.length - 1; i >= 0; i--) {
    if (dead.has(QUEUE[i].body)) QUEUE.splice(i, 1);
  }
  return freed;
}

/** Выбор уровня по видимому размеру с гистерезисом. */
export function planetLevel(body, screenPx) {
  const prev = body._glLevel === undefined ? -1 : body._glLevel;
  const lv = levelForPixels(screenPx, prev);
  body._glLevel = lv;
  return lv;
}
