// Трап и створка люка — сетки мира, как стойки шасси (км, плоское
// затенение, цвет на грань). Они снаружи корабля, поэтому рисуются тем же
// проходом, что и обшивка (js/gl/scene.js): при солнце, в дымке и с тенью
// корабля, а не светом помещений.
//
// Трап — в своих осях: x — наружу от обшивки, y — вверх от порога, z —
// вдоль борта; ставит и поворачивает его js/game/airlock.js (stairPoint).

import { v3 } from '../core/vec3.js';
import { makeMesh, mergeMeshes } from './geometry.js';

const MM = 0.001;            // м -> км

const C = {
  tread: [78, 82, 88],
  nose: [214, 168, 40],      // кромка ступени «осторожно»
  stringer: [96, 101, 108],
  rail: [196, 120, 42],
  post: [150, 156, 162],
};

/** Брусок между точками a и b (м), сечение w. */
function beam(a, b, w, rgb) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const t = d.map((c) => c / l);
  const h = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [h[1] * t[2] - h[2] * t[1], h[2] * t[0] - h[0] * t[2], h[0] * t[1] - h[1] * t[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = u.map((c) => c / ul * w / 2);
  const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
  const ring = (p) => [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([su, sv]) =>
    v3((p[0] + u[0] * su + v[0] * sv) * MM, (p[1] + u[1] * su + v[1] * sv) * MM, (p[2] + u[2] * su + v[2] * sv) * MM));
  const verts = [...ring(a), ...ring(b)];
  const faces = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faces.push({ v: [i, j, 4 + j, 4 + i], c: rgb });
  }
  faces.push({ v: [3, 2, 1, 0], c: rgb }, { v: [4, 5, 6, 7], c: rgb });
  return makeMesh(verts, faces);
}

/** Коробка по двум углам (м). */
function slab(lo, hi, rgb) {
  const [x0, y0, z0] = lo.map((c) => c * MM), [x1, y1, z1] = hi.map((c) => c * MM);
  const verts = [
    v3(x0, y0, z0), v3(x1, y0, z0), v3(x1, y1, z0), v3(x0, y1, z0),
    v3(x0, y0, z1), v3(x1, y0, z1), v3(x1, y1, z1), v3(x0, y1, z1),
  ];
  return makeMesh(verts, [
    { v: [3, 2, 1, 0], c: rgb }, { v: [4, 5, 6, 7], c: rgb },
    { v: [0, 1, 5, 4], c: rgb }, { v: [2, 3, 7, 6], c: rgb },
    { v: [0, 4, 7, 3], c: rgb }, { v: [1, 2, 6, 5], c: rgb },
  ]);
}

/**
 * Трап по своему расчёту (js/game/airlock.js, stairDesign): ступени с
 * жёлтой кромкой, две тетивы по уклону, поручни на стойках.
 */
export function buildStairMesh(d, half = 0.7, rail = 1.0) {
  const parts = [];
  for (let i = 1; i < d.n; i++) {
    const y = -i * d.r, x0 = (i - 1) * d.t - 0.02, x1 = i * d.t + 0.03;
    parts.push(slab([x0, y - 0.05, -half], [x1 - 0.06, y, half], C.tread));
    parts.push(slab([x1 - 0.06, y - 0.05, -half], [x1, y + 0.004, half], C.nose));
  }
  const xEnd = (d.n - 1) * d.t;
  const yEnd = -(d.n - 1) * d.r;
  for (const sz of [-1, 1]) {
    const z = sz * (half + 0.04);
    parts.push(beam([-0.05, -0.12, z], [xEnd + 0.05, yEnd - 0.12, z], 0.08, C.stringer));
    const zr = sz * (half + 0.02);
    parts.push(beam([0, rail, zr], [xEnd, yEnd + rail, zr], 0.05, C.rail));
    for (let i = 0; i <= d.n - 1; i += 4) {
      const x = Math.min(xEnd, i * d.t), y = -i * d.r;
      parts.push(beam([x, y, zr], [x, y + rail, zr], 0.035, C.post));
    }
    parts.push(beam([xEnd, yEnd, zr], [xEnd, yEnd + rail, zr], 0.035, C.post));
  }
  const m = mergeMeshes(parts);
  m.design = d;
  return m;
}

/** Створка люка: плита по проёму, толщиной в десять сантиметров (м -> км). */
export function buildHatchMesh(h) {
  const hz = (h.z[1] - h.z[0]) / 2, hy = (h.y[1] - h.y[0]) / 2;
  return slab([-0.05, -hy, -hz], [0.05, hy, hz], h.rgb);
}
