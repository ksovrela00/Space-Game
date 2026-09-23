// Загрузка геометрии в буферы GPU.
//
// Форматы на входе два:
//   * {verts, faces} из js/models/* — корабли и станция. Вершины
//     дублируются по граням, нормаль и цвет берутся у грани: так
//     сохраняется плоское «ретро»-затенение.
//   * типизированные массивы — планеты. Там нормали в вершинах, потому
//     что затенение должно быть гладким.

import { icosphere } from './icosphere.js';

export class GlMesh {
  constructor(gl, vao, count, mode, indexType, buffers = null) {
    this.gl = gl;
    this.vao = vao;
    this.count = count;
    this.mode = mode;
    this.indexType = indexType;   // null, если без индексов
    this.buffers = buffers;       // для освобождения
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (this.indexType) gl.drawElements(this.mode, this.count, this.indexType, 0);
    else gl.drawArrays(this.mode, 0, this.count);
  }

  /**
   * Освободить память GPU. Нужно мешам, которые пересобираются на ходу
   * (заплатки поверхности): без этого при посадке утекали бы десятки
   * мегабайт видеопамяти.
   */
  dispose() {
    const gl = this.gl;
    if (this.buffers) for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.buffers = null;
    this.vao = null;
    this.count = 0;
  }

  get tris() { return this.mode === this.gl.TRIANGLES ? this.count / 3 : 0; }
}

const arrayBuffer = (gl, data) => {
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return b;
};

const attrib = (gl, loc, buf, size) => {
  if (loc === undefined || loc < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
};

/** Меш из {verts, faces}: плоское затенение, без индексов. */
export function buildFlatMesh(gl, locs, mesh) {
  let tris = 0;
  for (const f of mesh.faces) tris += Math.max(0, f.v.length - 2);
  const n = tris * 3;

  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const col = new Float32Array(n * 4);

  let o = 0;
  for (const f of mesh.faces) {
    const idx = f.v;
    const r = f.c[0] / 255, g = f.c[1] / 255, b = f.c[2] / 255;
    const em = f.emissive ? 1 : 0;
    for (let t = 1; t + 1 < idx.length; t++) {
      const tri = [idx[0], idx[t], idx[t + 1]];
      for (const vi of tri) {
        const v = mesh.verts[vi];
        pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
        nrm[o * 3] = f.n.x; nrm[o * 3 + 1] = f.n.y; nrm[o * 3 + 2] = f.n.z;
        col[o * 4] = r; col[o * 4 + 1] = g; col[o * 4 + 2] = b; col[o * 4 + 3] = em;
        o++;
      }
    }
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  attrib(gl, locs.aPos, arrayBuffer(gl, pos), 3);
  attrib(gl, locs.aNormal, arrayBuffer(gl, nrm), 3);
  attrib(gl, locs.aColor, arrayBuffer(gl, col), 4);
  gl.bindVertexArray(null);
  return new GlMesh(gl, vao, n, gl.TRIANGLES, null);
}

/** Меш с индексами и нормалями в вершинах: планеты, атмосфера. */
export function buildIndexedMesh(gl, locs, data) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const bufs = [];
  const add = (loc, arr, size) => {
    const b = arrayBuffer(gl, arr);
    bufs.push(b);
    attrib(gl, loc, b, size);
  };
  add(locs.aPos, data.positions, 3);
  if (data.normals) add(locs.aNormal, data.normals, 3);
  if (data.colors) add(locs.aColor, data.colors, 4);
  if (data.uv) add(locs.aUv, data.uv, 2);
  if (data.t) add(locs.aT, data.t, 1);

  const ib = gl.createBuffer();
  bufs.push(ib);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  const type = data.indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
  return new GlMesh(gl, vao, data.indices.length, gl.TRIANGLES, type, bufs);
}

/**
 * Оболочка ударной волны — по самому корпусу корабля.
 *
 * Что было сломано. Волна строилась телом вращения: парабола вокруг
 * вектора скорости. Форма корабля в ней не участвовала вовсе, и в кадре
 * это читалось как оранжевый кокон, из которого торчат крылья, — а не
 * как обтекание.
 *
 * Волна на гиперзвуке ОТХОДИТ от лобовых поверхностей и прижимается к
 * бортам, то есть повторяет тело. Поэтому геометрия берётся у корпуса:
 * вершины разводятся наружу по сглаженным нормалям.
 *
 * Дальше оболочка СГЛАЖИВАЕТСЯ несколько раз, и это не косметика. У
 * корпуса есть щели между крылом и фюзеляжем и ступеньки надстроек, а
 * волна в такие щели не заходит — она их перекрывает. Без сглаживания
 * раздутый корпус протыкает сам себя, и на просвет каждая складка видна
 * удвоенной яркостью.
 *
 * После сглаживания вершины возвращаются наружу вдоль своих нормалей,
 * если их утянуло под обшивку: оболочка обязана остаться снаружи, иначе
 * корабль будет торчать из собственного пламени.
 *
 * @param stand  отход от обшивки в долях длины корпуса
 * @param passes сколько раз сгладить
 */
export function shockGeometry(mesh, stand = 0.055, passes = 2, level = 3) {
  const L = mesh.length || 1;
  // Центр — середина габаритов: оболочка задаётся лучами из центра, и
  // сдвинутый центр перекосил бы её.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.verts) {
    lo[0] = Math.min(lo[0], v.x); hi[0] = Math.max(hi[0], v.x);
    lo[1] = Math.min(lo[1], v.y); hi[1] = Math.max(hi[1], v.y);
    lo[2] = Math.min(lo[2], v.z); hi[2] = Math.max(hi[2], v.z);
  }
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2, cz = (lo[2] + hi[2]) / 2;

  const sph = icosphere(level);
  const dirs = sph.positions;
  const idx = sph.indices;
  const n = dirs.length / 3;
  const off = stand * L;

  // 1. Опорные плоскости корпуса: докуда он достаёт в каждом
  //    направлении. Плоскость отодвигается наружу на зазор — и зазор
  //    получается честным, отсчитанным по нормали плоскости, а не по
  //    лучу.
  const h = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dx = dirs[i * 3], dy = dirs[i * 3 + 1], dz = dirs[i * 3 + 2];
    let m = -Infinity;
    for (const v of mesh.verts) {
      const d = (v.x - cx) * dx + (v.y - cy) * dy + (v.z - cz) * dz;
      if (d > m) m = d;
    }
    h[i] = m + off;
  }

  // 2. Оболочка — ПЕРЕСЕЧЕНИЕ этих полуплоскостей, посчитанное по
  //    лучам: вдоль луча берётся ближайшая плоскость, которая его
  //    ограничивает.
  //
  //    Пересечение здесь принципиально. Соблазн взять сам радиус
  //    опорной функции (h вдоль своего же направления) — и это была
  //    первая попытка: у плоского тела она раздувает оболочку в шар (у
  //    диска радиуса R даёт толщину R/2 там, где тела нет вовсе), и
  //    вместо обтекания опять выходит кокон. Луч до самой дальней грани
  //    корпуса — другая крайность: тонкие концы крыльев между
  //    направлениями выборки проскакивают, и они торчат из волны. А
  //    пересечение полуплоскостей даёт выпуклую оболочку, которая и
  //    содержит корабль целиком, и лежит к нему вплотную.
  const rad = new Float64Array(n);
  const MIN_DOT = 0.05;           // почти перпендикулярные луч не ограничивают
  for (let i = 0; i < n; i++) {
    const dx = dirs[i * 3], dy = dirs[i * 3 + 1], dz = dirs[i * 3 + 2];
    let r = Infinity;
    for (let j = 0; j < n; j++) {
      const c = dx * dirs[j * 3] + dy * dirs[j * 3 + 1] + dz * dirs[j * 3 + 2];
      if (c <= MIN_DOT) continue;
      const t = h[j] / c;
      if (t < r) r = t;
    }
    rad[i] = r;
  }

  // 3. Сглаживание РАДИУСОВ, и только наружу. По лучам поверхность
  //    остаётся лучевой при любом сглаживании, то есть не может ни
  //    вывернуться, ни пересечь себя; «только наружу» гарантирует, что
  //    корабль не вылезет из своей же волны на рёбрах многогранника.
  const nb = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) {
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const i = idx[t + a], j = idx[t + b];
      if (!nb[i].includes(j)) nb[i].push(j);
      if (!nb[j].includes(i)) nb[j].push(i);
    }
  }
  const tmp = new Float64Array(n);
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const j of nb[i]) s += rad[j];
      tmp[i] = Math.max(rad[i], rad[i] * 0.6 + (s / nb[i].length) * 0.4);
    }
    rad.set(tmp);
  }

  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = cx + dirs[i * 3] * rad[i];
    positions[i * 3 + 1] = cy + dirs[i * 3 + 1] * rad[i];
    positions[i * 3 + 2] = cz + dirs[i * 3 + 2] * rad[i];
  }

  // Нормали оболочки: по ним шейдер считает и наветренность, и свечение
  // по кромке. Радиальное направление тут не годится — у вытянутого
  // корпуса оно расходится с настоящей нормалью на десятки градусов.
  const normals = new Float32Array(n * 3);
  const ax = new Float64Array(n), ay = new Float64Array(n), az = new Float64Array(n);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1],
      uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1],
      wz = positions[c + 2] - positions[a + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    for (const v of [idx[t], idx[t + 1], idx[t + 2]]) { ax[v] += fx; ay[v] += fy; az[v] += fz; }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(ax[i], ay[i], az[i]);
    if (l > 1e-12) {
      normals[i * 3] = ax[i] / l; normals[i * 3 + 1] = ay[i] / l; normals[i * 3 + 2] = az[i] / l;
    } else {
      normals[i * 3] = dirs[i * 3]; normals[i * 3 + 1] = dirs[i * 3 + 1];
      normals[i * 3 + 2] = dirs[i * 3 + 2];
    }
  }

  const indices = n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return { positions, normals, indices, verts: n, center: { x: cx, y: cy, z: cz }, rad, gap: off };
}

/** Та же оболочка, загруженная в буферы GL. */
export function buildShockMesh(gl, locs, mesh, stand, passes) {
  return buildIndexedMesh(gl, locs, shockGeometry(mesh, stand, passes));
}

export function buildWarpMesh(gl, locs, count, rng, rMin = 0.06, rMax = 1.35) {
  const par = new Float32Array(count * 6);
  const t = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const phi = rng.range(0, Math.PI * 2);
    const rp = rMin + (rMax - rMin) * Math.sqrt(rng.range(0, 1));
    const seed = rng.range(0, 1);
    for (let k = 0; k < 2; k++) {
      const o = i * 2 + k;
      par[o * 3] = phi;
      par[o * 3 + 1] = rp;
      par[o * 3 + 2] = seed;
      t[o] = k;
    }
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  attrib(gl, locs.aParam, arrayBuffer(gl, par), 3);
  attrib(gl, locs.aT, arrayBuffer(gl, t), 1);
  gl.bindVertexArray(null);
  return new GlMesh(gl, vao, count * 2, gl.LINES, null);
}

/**
 * Пылинки за бортом: по две вершины на пылинку (она сама и место, где
 * она была экспозицию назад). В атрибут кладётся только её место
 * ВНУТРИ ячейки решётки — всё остальное считает вершинный шейдер
 * (см. MOTE_VS).
 *
 * Буфер строится один раз на запуск и больше не трогается: на кадр
 * приходится один вызов отрисовки и три числа сдвига решётки. Процессор
 * тут не участвует вовсе — иначе на каждую пылинку пришлось бы вести
 * запись, а их сотни.
 */
export function buildMoteMesh(gl, locs, count, rng) {
  const cell = new Float32Array(count * 6);
  const t = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, 1), y = rng.range(0, 1), z = rng.range(0, 1);
    for (let k = 0; k < 2; k++) {
      const o = i * 2 + k;
      cell[o * 3] = x; cell[o * 3 + 1] = y; cell[o * 3 + 2] = z;
      t[o] = k;
    }
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  attrib(gl, locs.aCell, arrayBuffer(gl, cell), 3);
  attrib(gl, locs.aT, arrayBuffer(gl, t), 1);
  gl.bindVertexArray(null);
  return new GlMesh(gl, vao, count * 2, gl.LINES, null);
}

/** Звёзды: облако точек с направлением и цветом. */
export function buildPointsMesh(gl, locs, dirs, colors) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  attrib(gl, locs.aDir, arrayBuffer(gl, dirs), 3);
  attrib(gl, locs.aColor, arrayBuffer(gl, colors), 4);
  gl.bindVertexArray(null);
  return new GlMesh(gl, vao, dirs.length / 3, gl.POINTS, null);
}

/**
 * Меш, который переписывается каждый кадр (тень корабля): буфер
 * выделяется один раз на максимальное число вершин, дальше меняется
 * только его содержимое. Пересоздавать буфер на кадр нельзя — это
 * мусор в видеопамяти и лишняя работа драйвера.
 */
export function buildDynamicMesh(gl, loc, maxVerts) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, maxVerts * 3 * 4, gl.DYNAMIC_DRAW);
  if (loc !== undefined && loc >= 0) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  }
  gl.bindVertexArray(null);
  const mesh = new GlMesh(gl, vao, 0, gl.TRIANGLES, null, [buf]);
  mesh.maxVerts = maxVerts;
  mesh.update = (data, count) => {
    mesh.count = Math.min(count, maxVerts);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, mesh.count * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  };
  return mesh;
}

/** Квадрат [-1..1]^2 для экранных ореолов. */
/**
 * Буфер болтов: переписывается каждый кадр целиком.
 *
 * Отдельная вещь, потому что живёт иначе, чем всё остальное в сцене: у
 * планет и кораблей геометрия постоянна и заливается один раз, а у болтов
 * её нет вовсе — есть отрезок, который каждый кадр разворачивается к
 * камере заново. Место под них выделяется сразу на предел: перезаливка
 * буфера того же размера драйверу привычна, а рост буфера в кадре — нет.
 */
export function buildBoltBuffer(gl, locs, maxBolts = 96) {
  const verts = maxBolts * 6;                 // два треугольника на болт
  const pos = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const col = new Float32Array(verts * 3);

  const dyn = (data) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return b;
  };
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const bPos = dyn(pos), bUv = dyn(uv), bCol = dyn(col);
  attrib(gl, locs.aPos, bPos, 3);
  attrib(gl, locs.aUv, bUv, 2);
  attrib(gl, locs.aColor, bCol, 3);
  gl.bindVertexArray(null);

  return {
    max: maxBolts, pos, uv, col, count: 0,
    upload(n) {
      this.count = n;
      if (n <= 0) return;
      const v = n * 6;
      gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos, 0, v * 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, bUv);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, uv, 0, v * 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, bCol);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, col, 0, v * 3);
    },
    draw() {
      if (this.count <= 0) return 0;
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.count * 6);
      gl.bindVertexArray(null);
      return this.count * 2;
    },
  };
}

export function buildQuad(gl, loc) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const data = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
  attrib(gl, loc, arrayBuffer(gl, data), 2);
  gl.bindVertexArray(null);
  return new GlMesh(gl, vao, 6, gl.TRIANGLES, null);
}

/**
 * Кольцо планеты: аннулус в плоскости XY (нормаль вдоль Z).
 * aT — нормированный радиус, по нему шейдер рисует щели.
 */
export function buildRingMesh(gl, locs, inner, outer, segments = 192) {
  const verts = (segments + 1) * 2;
  const positions = new Float32Array(verts * 3);
  const t = new Float32Array(verts);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const o = i * 2;
    positions[o * 3] = ca * inner;
    positions[o * 3 + 1] = sa * inner;
    positions[o * 3 + 2] = 0;
    t[o] = 0;
    positions[(o + 1) * 3] = ca * outer;
    positions[(o + 1) * 3 + 1] = sa * outer;
    positions[(o + 1) * 3 + 2] = 0;
    t[o + 1] = 1;
  }
  const indices = new Uint32Array(segments * 6);
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    const o = i * 6;
    indices[o] = a; indices[o + 1] = b; indices[o + 2] = c;
    indices[o + 3] = b; indices[o + 4] = d; indices[o + 5] = c;
  }
  return buildIndexedMesh(gl, locs, { positions, t, indices });
}
