// Станция типа «Кориолис»: восьмигранный барабан, вращающийся вокруг
// собственной оси Z. На передней грани — щелевой стыковочный порт;
// чтобы войти, корабль должен согласовать крен с вращением станции.

import { v3 } from '../core/vec3.js';
import { makeMesh, prismZ, mergeMeshes, orientOutward, octagonPoints } from './geometry.js';

const SIDE = [126, 132, 144];
const SIDE_ALT = [104, 110, 122];
const CAP = [148, 154, 166];
const FRAME = [116, 122, 134];
const TUNNEL = [26, 28, 34];
const LIGHT_G = [90, 255, 130];
const LIGHT_R = [255, 90, 80];

export const STATION_R = 0.5;      // радиус барабана, км
export const STATION_D = 0.22;     // полуглубина
export const SLOT = { hw: 0.088, hh: 0.030 };  // полуразмеры щели порта

export function buildStation() {
  // Барабан без передней крышки — вместо неё рама с портом.
  const drum = prismZ(8, STATION_R, STATION_D, SIDE, CAP, Math.PI / 8);
  drum.faces.splice(0, 1);
  // Чередуем оттенки боковых панелей, чтобы вращение было заметно.
  for (let i = 0; i < drum.faces.length; i++) {
    if (i >= 1 && (i % 2) === 0) drum.faces[i].c = SIDE_ALT;
  }

  // Рама передней грани: внешний восьмиугольник -> прямоугольный проём.
  const outer = octagonPoints(STATION_R);
  const kx = 0.18;
  const inner = [
    { x: SLOT.hw, y: SLOT.hh },
    { x: SLOT.hw * kx, y: SLOT.hh },
    { x: -SLOT.hw * kx, y: SLOT.hh },
    { x: -SLOT.hw, y: SLOT.hh },
    { x: -SLOT.hw, y: -SLOT.hh },
    { x: -SLOT.hw * kx, y: -SLOT.hh },
    { x: SLOT.hw * kx, y: -SLOT.hh },
    { x: SLOT.hw, y: -SLOT.hh },
  ];

  const fVerts = [];
  for (const p of outer) fVerts.push(v3(p.x, p.y, STATION_D));
  for (const p of inner) fVerts.push(v3(p.x, p.y, STATION_D));
  const fFaces = [];
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    fFaces.push({ v: [i, j, 8 + j, 8 + i], c: FRAME });
  }
  const frame = orientOutward(makeMesh(fVerts, fFaces), v3(0, 0, -STATION_D));

  // Тоннель порта: те же 8 точек уходят внутрь барабана.
  const tVerts = [];
  for (const p of inner) tVerts.push(v3(p.x, p.y, STATION_D));
  for (const p of inner) tVerts.push(v3(p.x * 0.92, p.y * 0.92, -STATION_D * 0.5));
  const tFaces = [];
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    tFaces.push({ v: [i, j, 8 + j, 8 + i], c: TUNNEL, twoSided: true });
  }
  // Дно тоннеля
  tFaces.push({ v: [8, 9, 10, 11, 12, 13, 14, 15], c: [16, 18, 22], twoSided: true });
  const tunnel = makeMesh(tVerts, tFaces);

  // Огни у порта: зелёные сверху, красные снизу — по ним видно нужный крен.
  const lights = [];
  for (let s = -1; s <= 1; s += 2) {
    for (let i = -2; i <= 2; i++) {
      const x = i * SLOT.hw * 0.42;
      const y = s * (SLOT.hh + 0.012);
      const w = 0.007, h = 0.004;
      const v = [
        v3(x - w, y - h, STATION_D + 0.002), v3(x + w, y - h, STATION_D + 0.002),
        v3(x + w, y + h, STATION_D + 0.002), v3(x - w, y + h, STATION_D + 0.002),
      ];
      lights.push(makeMesh(v, [{
        v: [0, 1, 2, 3],
        c: s > 0 ? LIGHT_G : LIGHT_R,
        twoSided: true,
        emissive: true,
      }]));
    }
  }
  // makeMesh не пробрасывает emissive — ставим флаг вручную.
  for (const m of lights) m.faces[0].emissive = true;

  const mesh = mergeMeshes([drum, frame, tunnel, ...lights]);
  mesh.bound = Math.hypot(STATION_R, STATION_D);
  return mesh;
}
