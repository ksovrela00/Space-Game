// Геометрия одной плитки поверхности. Чистый счёт: ни GL, ни DOM.
//
// Вынесено из js/gl/tiles.js отдельным файлом ровно за этим: этот код
// должен одинаково работать и в кадре, и в рабочем потоке (см.
// js/gl/tileworker.js). Всё, что ему нужно, — параметры тела и адрес
// плитки; всё, что он отдаёт, — типизированные массивы, которые можно
// передать между потоками без копирования.

import { terrainOf } from './terrain.js';
import { computeNormals } from './icosphere.js';
import { TILE_GRID, faceDir, tileBounds, tileCellAngle } from './quadtree.js';

export const BUILD_CHUNK = 512;             // вершин за один заход

/**
 * Порционный сборщик геометрии плитки. Меш живёт в единичном радиусе, в
 * локальных осях тела, поэтому рисуется той же матрицей, что и сфера.
 *
 * Порциями — потому что в главном потоке он делит кадр с отрисовкой. В
 * рабочем потоке делить не с чем, и там его гоняют одним заходом.
 */
export function tileBuilder(body, t) {
  const terrain = terrainOf(body);
  const detail = terrain.detailForCell(tileCellAngle(t.level));
  const b = tileBounds(t.level, t.tx, t.ty);
  const g = TILE_GRID, n = g + 1;
  const gridVerts = n * n;
  const ring = 4 * g;                              // юбка по краю

  const positions = new Float32Array((gridVerts + ring) * 3);
  const normals = new Float32Array((gridVerts + ring) * 3);
  const colors = new Float32Array((gridVerts + ring) * 4);
  const uv = new Float32Array((gridVerts + ring) * 2);
  // Вершин меньше 65536, поэтому индексы короткие: на плитку это 13 КБ
  // вместо 26, а плиток в кэше сотни.
  const indices = new Uint16Array((g * g + ring) * 6);

  // Юбка уходит вниз на то, что этот уровень не в состоянии показать:
  // на стыке с более грубым соседом иначе видна щель.
  const cell = tileCellAngle(t.level);
  const drop = terrain.detailGap(detail) * 1.5 + cell * cell / 8 * 3 + 1e-7;

  const rgb = [0, 0, 0];
  const dir = { x: 0, y: 0, z: 0 };
  let i = 0;
  let result = null;

  return {
    total: gridVerts,
    step(count = BUILD_CHUNK) {
      const end = Math.min(gridVerts, i + count);
      for (; i < end; i++) {
        const ix = i % n, iy = (i - ix) / n;
        const su = b.u0 + (b.u1 - b.u0) * (ix / g);
        const sv = b.v0 + (b.v1 - b.v0) * (iy / g);
        faceDir(t.face, su, sv, dir);
        const h = 1 + terrain.sample(dir.x, dir.y, dir.z, detail, rgb);
        positions[i * 3] = dir.x * h;
        positions[i * 3 + 1] = dir.y * h;
        positions[i * 3 + 2] = dir.z * h;
        colors[i * 4] = rgb[0];
        colors[i * 4 + 1] = rgb[1];
        colors[i * 4 + 2] = rgb[2];
        colors[i * 4 + 3] = 0;
        uv[i * 2] = ix / g;
        uv[i * 2 + 1] = iy / g;
      }
      if (i < gridVerts) return false;

      let o = 0;
      for (let y = 0; y < g; y++) {
        for (let x = 0; x < g; x++) {
          const a = y * n + x, b2 = a + 1, c = a + n, d = c + 1;
          indices[o++] = a; indices[o++] = b2; indices[o++] = d;
          indices[o++] = a; indices[o++] = d; indices[o++] = c;
        }
      }
      computeNormals(positions, indices.subarray(0, o), normals);

      // Юбка по периметру: те же вершины, опущенные вниз.
      const path = [];
      for (let x = 0; x < g; x++) path.push(x);
      for (let y = 0; y < g; y++) path.push(y * n + g);
      for (let x = g; x > 0; x--) path.push(g * n + x);
      for (let y = g; y > 0; y--) path.push(y * n);
      const first = gridVerts;
      for (let k = 0; k < path.length; k++) {
        const src = path[k], s = first + k;
        const r = Math.hypot(
          positions[src * 3], positions[src * 3 + 1], positions[src * 3 + 2]);
        const k2 = (r - drop) / (r || 1);
        for (let c2 = 0; c2 < 3; c2++) {
          positions[s * 3 + c2] = positions[src * 3 + c2] * k2;
          normals[s * 3 + c2] = normals[src * 3 + c2];
        }
        for (let c2 = 0; c2 < 4; c2++) colors[s * 4 + c2] = colors[src * 4 + c2];
        uv[s * 2] = uv[src * 2];
        uv[s * 2 + 1] = uv[src * 2 + 1];
      }
      for (let k = 0; k < path.length; k++) {
        const a = path[k], b2 = path[(k + 1) % path.length];
        const sa = first + k, sb = first + (k + 1) % path.length;
        indices[o++] = a; indices[o++] = b2; indices[o++] = sb;
        indices[o++] = a; indices[o++] = sb; indices[o++] = sa;
      }

      result = {
        positions, normals, colors, uv,
        indices: indices.subarray(0, o),
        faces: o / 3,
        level: t.level,
      };
      return true;
    },
    get result() { return result; },
  };
}

/**
 * Собрать плитку целиком. Этим пользуется рабочий поток: делить кадр
 * ему не с кем.
 *
 * @param spec {kind, name, id} — того же тела, что и в главном потоке.
 *             Больше makeTerrain ничего и не смотрит, поэтому передавать
 *             планету целиком (с орбитой, лунами и мешами) не нужно.
 */
export function buildTileGeo(spec, t) {
  const b = tileBuilder(spec, t);
  while (!b.step(1e9)) { /* один заход */ }
  return b.result;
}

/**
 * Разложить результат на то, что переносится между потоками. Индексы
 * лежат подмассивом в буфере с запасом, поэтому длина едет отдельным
 * числом: копировать 26 КБ на каждую плитку незачем.
 */
export function geoToTransfer(geo) {
  return {
    positions: geo.positions.buffer,
    normals: geo.normals.buffer,
    colors: geo.colors.buffer,
    uv: geo.uv.buffer,
    indices: geo.indices.buffer,
    indexCount: geo.indices.length,
    faces: geo.faces,
    level: geo.level,
  };
}

/** Обратно: буферы -> представления, с которыми работает mesh.js. */
export function geoFromTransfer(m) {
  return {
    positions: new Float32Array(m.positions),
    normals: new Float32Array(m.normals),
    colors: new Float32Array(m.colors),
    uv: new Float32Array(m.uv),
    indices: new Uint16Array(m.indices, 0, m.indexCount),
    faces: m.faces,
    level: m.level,
  };
}
