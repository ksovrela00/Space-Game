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
import { GROUND, grainPerUnit } from './ground.js';

export const BUILD_CHUNK = 512;             // вершин за один заход

/**
 * Порционный сборщик геометрии плитки. Меш живёт в единичном радиусе и в
 * локальных осях тела, но НЕ от центра тела, а от середины самой плитки
 * (origin, в double): так вершины рисуются с точностью до микрон.
 *
 * Почему не от центра. Шейдер считает положение вершины во float32:
 * матрица переводит её из долей радиуса в километры от камеры. Если
 * вершина отсчитана от центра тела, то и она, и перенос в матрице —
 * числа порядка радиуса (тысячи километров), а их сумма — метры до
 * глаза. У float32 на тысячах километров шаг полметра, и столько же
 * ошибки получает каждая вершина; ошибка зависит от матрицы, то есть от
 * поворота и места камеры. С высоты её не видно, а с роста человека грунт
 * у ног дрожал на десятки сантиметров при каждом движении мыши и
 * «прыгал» вместе с пилотом. От середины плитки вершина — число порядка
 * самой плитки, и перенос в матрице — тоже.
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
  // Координата фотографии грунта — В ПЛИТКАХ ЗЕРНА и ОТ УГЛА ЭТОЙ
  // ПЛИТКИ (js/gl/ground.js). Не от центра планеты: там числа за
  // миллион, и float32 потерял бы всё, что мельче метра.
  const grain = new Float32Array((gridVerts + ring) * 2);
  const gk = grainPerUnit(body.radius, GROUND.grain.sizeKm);
  // Вершин меньше 65536, поэтому индексы короткие: на плитку это 13 КБ
  // вместо 26, а плиток в кэше сотни.
  const indices = new Uint16Array((g * g + ring) * 6);

  // Юбка уходит вниз на то, что этот уровень не в состоянии показать:
  // на стыке с более грубым соседом иначе видна щель.
  const cell = tileCellAngle(t.level);
  const drop = terrain.detailGap(detail) * 1.5 + cell * cell / 8 * 3 + 1e-7;

  // Четвёртая ячейка — высота над морем (terrain.sample): у водного мира
  // она уходит в альфу цвета вершины, км (js/gl/water.js).
  const rgb = [0, 0, 0, 0];
  const sea = terrain.kindCfg.liquid ? body.radius : 0;
  const dir = { x: 0, y: 0, z: 0 };
  // Начало отсчёта — середина плитки на её же рельефе.
  const od = faceDir(t.face, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2, { x: 0, y: 0, z: 0 });
  const oh = 1 + terrain.sample(od.x, od.y, od.z, detail, [0, 0, 0]);
  const origin = [od.x * oh, od.y * oh, od.z * oh];
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
        positions[i * 3] = dir.x * h - origin[0];
        positions[i * 3 + 1] = dir.y * h - origin[1];
        positions[i * 3 + 2] = dir.z * h - origin[2];
        colors[i * 4] = rgb[0];
        colors[i * 4 + 1] = rgb[1];
        colors[i * 4 + 2] = rgb[2];
        colors[i * 4 + 3] = rgb[3] * sea;
        uv[i * 2] = ix / g;
        uv[i * 2 + 1] = iy / g;
        grain[i * 2] = (su - b.u0) * gk;
        grain[i * 2 + 1] = (sv - b.v0) * gk;
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

      // Юбка по периметру: те же вершины, опущенные вниз — к центру тела,
      // поэтому счёт в полных координатах (double), а хранится снова от
      // начала плитки.
      const path = [];
      for (let x = 0; x < g; x++) path.push(x);
      for (let y = 0; y < g; y++) path.push(y * n + g);
      for (let x = g; x > 0; x--) path.push(g * n + x);
      for (let y = g; y > 0; y--) path.push(y * n);
      const first = gridVerts;
      for (let k = 0; k < path.length; k++) {
        const src = path[k], s = first + k;
        const ax = positions[src * 3] + origin[0];
        const ay = positions[src * 3 + 1] + origin[1];
        const az = positions[src * 3 + 2] + origin[2];
        const r = Math.hypot(ax, ay, az);
        const k2 = (r - drop) / (r || 1);
        positions[s * 3] = ax * k2 - origin[0];
        positions[s * 3 + 1] = ay * k2 - origin[1];
        positions[s * 3 + 2] = az * k2 - origin[2];
        for (let c2 = 0; c2 < 3; c2++) normals[s * 3 + c2] = normals[src * 3 + c2];
        for (let c2 = 0; c2 < 4; c2++) colors[s * 4 + c2] = colors[src * 4 + c2];
        uv[s * 2] = uv[src * 2];
        uv[s * 2 + 1] = uv[src * 2 + 1];
        grain[s * 2] = grain[src * 2];
        grain[s * 2 + 1] = grain[src * 2 + 1];
      }
      for (let k = 0; k < path.length; k++) {
        const a = path[k], b2 = path[(k + 1) % path.length];
        const sa = first + k, sb = first + (k + 1) % path.length;
        indices[o++] = a; indices[o++] = b2; indices[o++] = sb;
        indices[o++] = a; indices[o++] = sb; indices[o++] = sa;
      }

      result = {
        positions, normals, colors, uv, grain,
        indices: indices.subarray(0, o),
        faces: o / 3,
        level: t.level,
        origin,
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
    grain: geo.grain.buffer,
    indices: geo.indices.buffer,
    indexCount: geo.indices.length,
    faces: geo.faces,
    level: geo.level,
    origin: geo.origin,
  };
}

/** Обратно: буферы -> представления, с которыми работает mesh.js. */
export function geoFromTransfer(m) {
  return {
    positions: new Float32Array(m.positions),
    normals: new Float32Array(m.normals),
    colors: new Float32Array(m.colors),
    uv: new Float32Array(m.uv),
    grain: new Float32Array(m.grain),
    indices: new Uint16Array(m.indices, 0, m.indexCount),
    faces: m.faces,
    level: m.level,
    origin: m.origin,
  };
}
