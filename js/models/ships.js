// Модель корабля игрока: клиновидный корпус в духе Cobra Mk III.
// Все размеры в километрах (полная длина ~65 м).

import { v3 } from '../core/vec3.js';
import { loft, box, prismZ, mergeMeshes, transformMesh } from './geometry.js';

const HULL_TOP = [198, 206, 220];
const HULL_SIDE = [150, 158, 172];
const HULL_BOT = [104, 112, 126];
const CANOPY = [46, 104, 150];
const NOZZLE = [70, 74, 84];
const FIN = [176, 96, 72];

const boundOf = (mesh) => {
  let m = 0;
  for (const v of mesh.verts) m = Math.max(m, Math.hypot(v.x, v.y, v.z));
  mesh.bound = m;
  return mesh;
};

export function buildCobra() {
  const L = 0.0325, W = 0.026, H = 0.010;

  // Планформа: нос, изломы кромки крыла, срез кормы (в плоскости XZ).
  const pfn = [
    { x: 0.00, z: 1.00 },
    { x: 0.26, z: 0.34 },
    { x: 1.00, z: -0.58 },
    { x: 0.66, z: -1.00 },
    { x: -0.66, z: -1.00 },
    { x: -1.00, z: -0.58 },
    { x: -0.26, z: 0.34 },
  ];
  const topn = [0.10, 0.52, 0.14, 0.34, 0.34, 0.14, 0.52];
  const botn = [-0.07, -0.34, -0.09, -0.24, -0.24, -0.09, -0.34];

  const pf = pfn.map((p) => ({ x: p.x * W, z: p.z * L }));
  const top = topn.map((y) => y * H);
  const bot = botn.map((y) => y * H);

  const hull = loft(pf, top, bot, HULL_TOP, HULL_BOT, HULL_SIDE);

  const canopy = box(W * 0.17, H * 0.34, L * 0.20, CANOPY, v3(0, H * 0.62, L * 0.16));

  const nozzle = (x) => transformMesh(
    prismZ(6, W * 0.085, L * 0.10, NOZZLE, [40, 42, 50]),
    { offset: v3(x, H * 0.1, -L * 1.02) });

  const fin = box(W * 0.02, H * 0.7, L * 0.14, FIN, v3(0, H * 0.95, -L * 0.78));

  const mesh = mergeMeshes([hull, canopy, nozzle(-W * 0.24), nozzle(W * 0.24), fin]);

  // Точки выхлопа — для факелов двигателей.
  mesh.exhausts = [v3(-W * 0.24, H * 0.1, -L * 1.12), v3(W * 0.24, H * 0.1, -L * 1.12)];
  mesh.length = L * 2;
  return boundOf(mesh);
}

// Небольшой транспорт — понадобится для NPC и как «чужой» силуэт.
export function buildShuttle() {
  const L = 0.022, W = 0.014, H = 0.011;
  const pf = [
    { x: 0, z: 1.0 }, { x: 0.7, z: 0.2 }, { x: 0.7, z: -1.0 },
    { x: -0.7, z: -1.0 }, { x: -0.7, z: 0.2 },
  ].map((p) => ({ x: p.x * W, z: p.z * L }));
  const top = [0.2, 0.8, 0.7, 0.7, 0.8].map((y) => y * H);
  const bot = [-0.15, -0.5, -0.45, -0.45, -0.5].map((y) => y * H);
  const mesh = loft(pf, top, bot, [190, 180, 150], [110, 104, 88], [150, 142, 120]);
  mesh.exhausts = [v3(0, H * 0.1, -L * 1.1)];
  mesh.length = L * 2;
  return boundOf(mesh);
}
