// Конструктор полигональных моделей.
// Формат меша: { verts: [{x,y,z}], faces: [{ v:[индексы], c:[r,g,b], n:{x,y,z}, twoSided }] }
// Нормаль считается из порядка вершин (CCW снаружи, правая система координат).

import { v3 } from '../core/vec3.js';

export const faceNormal = (verts, idx) => {
  const a = verts[idx[0]], b = verts[idx[1]], c = verts[idx[2]];
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const wx = c.x - a.x, wy = c.y - a.y, wz = c.z - a.z;
  const nx = uy * wz - uz * wy;
  const ny = uz * wx - ux * wz;
  const nz = ux * wy - uy * wx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return v3(nx / l, ny / l, nz / l);
};

export const centroidOf = (verts, idx) => {
  let x = 0, y = 0, z = 0;
  for (const i of idx) { x += verts[i].x; y += verts[i].y; z += verts[i].z; }
  return v3(x / idx.length, y / idx.length, z / idx.length);
};

export const makeMesh = (verts, faceDefs) => {
  const faces = faceDefs.map((f) => ({
    v: f.v,
    c: f.c,
    n: faceNormal(verts, f.v),
    twoSided: !!f.twoSided,
    // Свечение — ДОЛЯ, а не признак: окно светится вполсилы, огонь порта
    // в полную. Булево здесь давало бы либо тусклый маяк, либо окна,
    // выжигающие всё вокруг.
    emissive: typeof f.emissive === 'number' ? f.emissive : (f.emissive ? 1 : 0),
  }));
  return { verts, faces };
};

// Разворачивает нормали «наружу» от заданного центра — избавляет от
// ручного контроля порядка вершин при сборке корпусов.
export const orientOutward = (mesh, center = v3()) => {
  for (const f of mesh.faces) {
    if (f.twoSided) continue;
    const g = centroidOf(mesh.verts, f.v);
    const d = (g.x - center.x) * f.n.x + (g.y - center.y) * f.n.y + (g.z - center.z) * f.n.z;
    if (d < 0) {
      f.v = f.v.slice().reverse();
      f.n = faceNormal(mesh.verts, f.v);
    }
  }
  return mesh;
};

export const mergeMeshes = (meshes) => {
  const verts = [];
  const faces = [];
  for (const m of meshes) {
    const off = verts.length;
    for (const v of m.verts) verts.push({ x: v.x, y: v.y, z: v.z });
    for (const f of m.faces) {
      faces.push({
        v: f.v.map((i) => i + off),
        c: f.c, n: f.n,
        twoSided: f.twoSided,
        emissive: f.emissive,
      });
    }
  }
  return { verts, faces };
};

export const transformMesh = (mesh, { scale = 1, offset = null, sx = 1, sy = 1, sz = 1 } = {}) => {
  for (const v of mesh.verts) {
    v.x *= scale * sx; v.y *= scale * sy; v.z *= scale * sz;
    if (offset) { v.x += offset.x; v.y += offset.y; v.z += offset.z; }
  }
  for (const f of mesh.faces) f.n = faceNormal(mesh.verts, f.v);
  return mesh;
};

export const box = (hw, hh, hd, color, offset = null) => {
  const v = [
    v3(-hw, -hh, -hd), v3(hw, -hh, -hd), v3(hw, hh, -hd), v3(-hw, hh, -hd),
    v3(-hw, -hh, hd), v3(hw, -hh, hd), v3(hw, hh, hd), v3(-hw, hh, hd),
  ];
  if (offset) for (const p of v) { p.x += offset.x; p.y += offset.y; p.z += offset.z; }
  const m = makeMesh(v, [
    { v: [0, 1, 2, 3], c: color }, { v: [4, 5, 6, 7], c: color },
    { v: [0, 1, 5, 4], c: color }, { v: [3, 2, 6, 7], c: color },
    { v: [0, 3, 7, 4], c: color }, { v: [1, 2, 6, 5], c: color },
  ]);
  return orientOutward(m, offset || v3());
};

/**
 * Выдавливание плоского контура (планформы) в «линзу»: контур задан в
 * плоскости XZ, толщина — массивами верхних и нижних Y для каждой точки.
 * Так удобно лепить корпуса кораблей.
 */
export const loft = (planform, topY, botY, colorTop, colorBot, colorSide) => {
  const n = planform.length;
  const verts = [];
  for (let i = 0; i < n; i++) verts.push(v3(planform[i].x, topY[i], planform[i].z));
  for (let i = 0; i < n; i++) verts.push(v3(planform[i].x, botY[i], planform[i].z));

  const faceDefs = [];
  const topIdx = [], botIdx = [];
  for (let i = 0; i < n; i++) { topIdx.push(i); botIdx.push(n + i); }
  faceDefs.push({ v: topIdx, c: colorTop });
  faceDefs.push({ v: botIdx, c: colorBot });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faceDefs.push({ v: [i, j, n + j, n + i], c: colorSide });
  }
  return orientOutward(makeMesh(verts, faceDefs));
};

// Призма/цилиндр вдоль оси Z (сопла, ступица «Орбиса»).
export const prismZ = (sides, radius, halfDepth, colorSide, colorCap, twist = 0) => {
  const verts = [];
  for (let i = 0; i < sides; i++) {
    const a = twist + (i / sides) * Math.PI * 2;
    verts.push(v3(Math.cos(a) * radius, Math.sin(a) * radius, halfDepth));
  }
  for (let i = 0; i < sides; i++) {
    const a = twist + (i / sides) * Math.PI * 2;
    verts.push(v3(Math.cos(a) * radius, Math.sin(a) * radius, -halfDepth));
  }
  const faceDefs = [];
  const front = [], back = [];
  for (let i = 0; i < sides; i++) { front.push(i); back.push(sides + i); }
  faceDefs.push({ v: front, c: colorCap });
  faceDefs.push({ v: back, c: colorCap });
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    faceDefs.push({ v: [i, j, sides + j, sides + i], c: colorSide });
  }
  return orientOutward(makeMesh(verts, faceDefs));
};

export const octagonPoints = (radius, twist = Math.PI / 8) => {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = twist + (i / 8) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius, a });
  }
  return pts;
};
