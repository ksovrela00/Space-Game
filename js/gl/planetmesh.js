// Сборка меша планеты: икосфера + смещение вершин рельефом + цвет
// биома + нормали. Меш живёт в единичном радиусе, масштаб задаётся
// матрицей объекта, поэтому одну и ту же геометрию можно использовать
// для тела любого размера.

import { icosphere, computeNormals, levelForPixels } from './icosphere.js';
import { makeTerrain } from './terrain.js';
import { buildIndexedMesh } from './mesh.js';

/** Геометрия планеты на CPU — эту часть можно проверить без браузера. */
export function planetGeometry(body, level) {
  const base = icosphere(level);
  const terrain = body._terrain || (body._terrain = makeTerrain(body));
  const n = base.positions.length / 3;

  const positions = new Float32Array(base.positions.length);
  const colors = new Float32Array(n * 4);
  const rgb = [0, 0, 0];

  // Светило — однородный самосветящийся шар своего цвета: процедурные
  // биомы ему не нужны (иначе досталась бы серая каменная палитра).
  const isStar = body.kind === 'star';

  for (let i = 0; i < n; i++) {
    const x = base.positions[i * 3];
    const y = base.positions[i * 3 + 1];
    const z = base.positions[i * 3 + 2];
    const h = 1 + terrain.displace(x, y, z);
    positions[i * 3] = x * h;
    positions[i * 3 + 1] = y * h;
    positions[i * 3 + 2] = z * h;

    if (isStar) {
      rgb[0] = body.color[0] / 255;
      rgb[1] = body.color[1] / 255;
      rgb[2] = body.color[2] / 255;
    } else {
      terrain.color(x, y, z, rgb);
    }
    colors[i * 4] = rgb[0];
    colors[i * 4 + 1] = rgb[1];
    colors[i * 4 + 2] = rgb[2];
    colors[i * 4 + 3] = isStar ? 1 : 0;                // альфа = «сам светится»
  }

  // Нормали считаем по УЖЕ смещённой геометрии, иначе рельеф не будет
  // виден в освещении — только силуэтом на кромке.
  const normals = terrain.isFlat
    ? base.positions.slice()
    : computeNormals(positions, base.indices);

  return { positions, normals, colors, indices: base.indices, level, faces: base.faceCount };
}

/**
 * Меш планеты для нужного уровня LOD. Кэшируется на самом теле:
 * генерация уровня 5 (20 тыс. граней) занимает десятки миллисекунд,
 * каждый кадр её делать нельзя.
 */
export function planetMesh(gl, locs, body, level) {
  if (!body._glMeshes) body._glMeshes = new Map();
  const cached = body._glMeshes.get(level);
  if (cached) return cached;
  const geo = planetGeometry(body, level);
  const mesh = buildIndexedMesh(gl, locs, geo);
  mesh.faces = geo.faces;
  body._glMeshes.set(level, mesh);
  return mesh;
}

/** Выбор уровня по видимому размеру с гистерезисом. */
export function planetLevel(body, screenPx) {
  const prev = body._glLevel === undefined ? -1 : body._glLevel;
  const lv = levelForPixels(screenPx, prev);
  body._glLevel = lv;
  return lv;
}

/**
 * Локальный базис тела: y — ось вращения, поворот вокруг неё — суточное
 * вращение. Меш статичен, вращение целиком в этой матрице.
 */
export function bodyBasis(body, out) {
  const p = body.pole, a = body.eqRef, s = body.eqSide;
  const c = Math.cos(body.spinPhase), sn = Math.sin(body.spinPhase);
  // right = eqRef, повёрнутый вокруг полюса; up = полюс.
  out.right.x = a.x * c + s.x * sn;
  out.right.y = a.y * c + s.y * sn;
  out.right.z = a.z * c + s.z * sn;
  out.up.x = p.x; out.up.y = p.y; out.up.z = p.z;
  // fwd = right x up (правая тройка, как и у камеры)
  out.fwd.x = out.right.y * p.z - out.right.z * p.y;
  out.fwd.y = out.right.z * p.x - out.right.x * p.z;
  out.fwd.z = out.right.x * p.y - out.right.y * p.x;
  return out;
}
