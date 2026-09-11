// Генератор икосферы: правильный икосаэдр с рекурсивным дроблением
// граней. Треугольники получаются почти равновеликими — в отличие от
// UV-сферы, у которой на полюсах вырожденные «дольки».
//
// Уровень n: 20·4^n граней, 10·4^n + 2 вершины.
//   0 -> 20 граней      3 -> 1280      5 -> 20480
//   1 -> 80             4 -> 5120      6 -> 81920
// На уровне 4 у планеты во весь экран кромка отходит от идеальной сферы
// примерно на 1 пиксель, то есть огранка уже незаметна. Уровни 5 и 6
// нужны не кромке, а рельефу: чем мельче треугольник, тем более мелкие
// детали поверхности сетка способна показать (см. edgeAngle).
//
// Вблизи поверхности даже уровня 6 не хватает (треугольник — десятки
// километров), поэтому под кораблём рисуются отдельные подробные
// заплатки: js/gl/patches.js.

const CACHE = new Map();

const BASE_VERTS = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  return raw.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  });
})();

// Обход вершин против часовой стрелки, если смотреть снаружи.
const BASE_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/**
 * @returns {positions: Float32Array (единичные векторы), indices: Uint32Array}
 */
export function icosphere(level) {
  const lv = Math.max(0, Math.min(6, level | 0));
  if (CACHE.has(lv)) return CACHE.get(lv);

  let verts = BASE_VERTS.map((v) => v.slice());
  let faces = BASE_FACES.map((f) => f.slice());

  for (let step = 0; step < lv; step++) {
    const mid = new Map();          // ключ ребра -> индекс новой вершины
    const next = [];
    const midpoint = (a, b) => {
      const key = a < b ? a * 1e7 + b : b * 1e7 + a;
      const found = mid.get(key);
      if (found !== undefined) return found;
      const va = verts[a], vb = verts[b];
      let x = va[0] + vb[0], y = va[1] + vb[1], z = va[2] + vb[2];
      const l = Math.hypot(x, y, z) || 1;
      verts.push([x / l, y / l, z / l]);
      const idx = verts.length - 1;
      mid.set(key, idx);
      return idx;
    };
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }

  const positions = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    positions[i * 3] = verts[i][0];
    positions[i * 3 + 1] = verts[i][1];
    positions[i * 3 + 2] = verts[i][2];
  }
  const indices = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    indices[i * 3] = faces[i][0];
    indices[i * 3 + 1] = faces[i][1];
    indices[i * 3 + 2] = faces[i][2];
  }

  const res = { positions, indices, level: lv, faceCount: faces.length, vertCount: verts.length };
  CACHE.set(lv, res);
  return res;
}

/**
 * Нормали как среднее нормалей смежных граней. Нужны ПОСЛЕ смещения
 * вершин рельефом — иначе горы не будут видны в освещении.
 */
export function computeNormals(positions, indices, out = new Float32Array(positions.length)) {
  out.fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a];
    const wy = positions[c + 1] - positions[a + 1];
    const wz = positions[c + 2] - positions[a + 2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= l; out[i + 1] /= l; out[i + 2] /= l;
  }
  return out;
}

/**
 * Угловой размер ребра треугольника на уровне level.
 * Ребро икосаэдра видно из центра под углом acos(1/sqrt5) = 63.43°,
 * каждое дробление делит его вдвое. По этой величине выбирается, какие
 * детали рельефа сетка в состоянии показать (см. terrain.detailForCell).
 */
export const ICO_EDGE = Math.acos(1 / Math.sqrt(5));      // 1.1071 рад

export const edgeAngle = (level) => ICO_EDGE / 2 ** Math.max(0, level);

/**
 * Уровень дробления по видимому радиусу тела в пикселях.
 * Гистерезис: переключаем уровень только при заметном изменении размера,
 * иначе на пороге LOD начинает дребезжать каждый кадр.
 */
const LOD_STEPS = [8, 22, 65, 190, 560, 1600];

export function levelForPixels(px, prevLevel = -1) {
  let lv = LOD_STEPS.length;
  for (let i = 0; i < LOD_STEPS.length; i++) {
    if (px < LOD_STEPS[i]) { lv = i; break; }
  }
  if (prevLevel >= 0 && lv !== prevLevel) {
    // Порог, на котором держимся за прежний уровень (±25%).
    const down = prevLevel > 0 ? LOD_STEPS[prevLevel - 1] * 0.8 : -Infinity;
    const up = prevLevel < LOD_STEPS.length ? LOD_STEPS[prevLevel] * 1.25 : Infinity;
    if (px > down && px < up) return prevLevel;
  }
  return lv;
}
