// Загрузка геометрии в буферы GPU.
//
// Форматы на входе два:
//   * {verts, faces} из js/models/* — корабли и станция. Вершины
//     дублируются по граням, нормаль и цвет берутся у грани: так
//     сохраняется плоское «ретро»-затенение.
//   * типизированные массивы — планеты. Там нормали в вершинах, потому
//     что затенение должно быть гладким.

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
 * Оболочка ударной волны для входа в атмосферу.
 *
 * Поверхность вращения: от лобовой точки (z = 0) назад по следу
 * (z = -1). Профиль — корень: у лба радиус растёт круто, дальше почти
 * не меняется. Это форма головной волны у ТУПОГО тела, а корабль на
 * гиперзвуке ведёт себя именно так: волна отходит от него и обнимает
 * корпус, а не тянется тонкой иглой от носа.
 *
 * Меш единичный; настоящие размеры задают uRad и uLen в шейдере.
 */
export function buildPlumeMesh(gl, locs, rings = 14, segments = 28) {
  const verts = (rings + 1) * (segments + 1);
  const positions = new Float32Array(verts * 3);
  const t = new Float32Array(verts);
  for (let i = 0; i <= rings; i++) {
    const s = i / rings;
    // Радиус: круто от нуля, потом полого; к хвосту след чуть сужается.
    const r = Math.sqrt(s) * (1 - 0.28 * s * s);
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const o = i * (segments + 1) + j;
      positions[o * 3] = Math.cos(a) * r;
      positions[o * 3 + 1] = Math.sin(a) * r;
      positions[o * 3 + 2] = -s;
      t[o] = s;
    }
  }
  const indices = new Uint16Array(rings * segments * 6);
  let o = 0;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j, b = a + 1;
      const c = a + segments + 1, d = c + 1;
      indices[o++] = a; indices[o++] = c; indices[o++] = b;
      indices[o++] = b; indices[o++] = c; indices[o++] = d;
    }
  }
  return buildIndexedMesh(gl, locs, { positions, t, indices });
}

/**
 * Поток частиц для квантового прыжка: по две вершины на частицу
 * (голова и конец хвоста). В атрибут кладутся не координаты, а ПАРАМЕТРЫ
 * частицы — сторона вокруг оси, удаление от оси и фаза; саму траекторию
 * считает вершинный шейдер (см. WARP_VS).
 *
 * Удаление берётся как sqrt(случайного): так частицы ложатся равномерно
 * по площади кольца, а не сбиваются к оси.
 */
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
