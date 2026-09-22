// Проверки WebGL-слоя без браузера: вся математика считается в Node, а сам
// путь отрисовки прогоняется через мок GL-контекста. Пиксели так не
// проверить — только то, что геометрия, матрицы и вызовы корректны.

import { v3, normalize, dot, len } from '../js/core/vec3.js';
import { makeBasis, toLocal, rotateBasis, lookAlong } from '../js/core/basis.js';
import { icosphere, computeNormals, levelForPixels, edgeAngle, ICO_EDGE } from '../js/gl/icosphere.js';
import {
  makeTerrain, perlin3, fbm, craterProfile, craterProfileD, craterDepth,
  craterField, craterLayer, GAIN, LAC, CRATER_DMAX,
  CRATER_C0, CRATER_STEP, CRATER_SEED, CRATER_RIM, CRATER_RMIN, CRATER_RSPAN,
  CRATER_REACH, CRATER_BOWL, CRATER_RIM_AT, CRATER_RIM_W, CRATER_FRESH_MIN,
  CRATER_MAX_SCALES, CRATER_MARE_FROM, CRATER_MARE_TO, mareWeight,
} from '../js/gl/terrain.js';
import {
  detailWindow, detailUniforms, tileDetailUniforms, DETAIL_GLSL,
  DETAIL_MAX_CS, DETAIL_MAX_OCT, DETAIL_MIN_SCALE, DETAIL_FADE_LO, DETAIL_FADE_HI,
  makeDetailLoad, updateDetailLoad, FW_MAX, FW_TARGET_GPU, FW_TARGET_CPU,
} from '../js/gl/detail.js';
import { MESH_FS, MESH_FS_DETAIL, ATMO_FS, PLUME_VS } from '../js/gl/shaders.js';
import { shockGeometry } from '../js/gl/mesh.js';
import { altitudeOf } from '../js/game/surface.js';
import { buildCobra } from '../js/models/ships.js';
import { ENTRY, airDensity } from '../js/game/entry.js';
import { ATMO_THICK, ATMO_GLOW } from '../js/gl/scene.js';
import { skyFor, skyUniforms, SKY_BLOBS, SKY_GAIN, SKY_GLSL } from '../js/gl/nebula.js';
import { galaxyFor, Starfield } from '../js/render/starfield.js';
import { renderScale, wantAa, resizeCanvas } from '../js/gl/context.js';
import { patchPlan, patchBuilder, PATCH } from '../js/gl/patches.js';
import { cubeLookup } from '../js/gl/bake.js';
import {
  faceDir, tileBounds, tileChildren, TILE_GRID, tileTexelAngle, tileCellAngle,
  selectTiles, TILE_MAX_LEVEL,
} from '../js/gl/quadtree.js';
import { tileBuilder, TILE_TEXEL_TOL } from '../js/gl/tiles.js';
import { planetGeometry } from '../js/gl/planetmesh.js';
import { perspective, modelView, dirToCamera, logDepth, logDepthCoef } from '../js/gl/mat4.js';
import { makeSystem, bodyBasis } from '../js/game/world.js';

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + msg);
};

// --- 1. Икосфера ------------------------------------------------------------
console.log('== икосфера ==');
for (const lv of [0, 1, 2, 3, 4]) {
  const s = icosphere(lv);
  const faces = s.indices.length / 3;
  const verts = s.positions.length / 3;
  const expFaces = 20 * 4 ** lv;
  const expVerts = 10 * 4 ** lv + 2;

  // Все вершины на единичной сфере.
  let worstR = 0;
  for (let i = 0; i < verts; i++) {
    const r = Math.hypot(s.positions[i * 3], s.positions[i * 3 + 1], s.positions[i * 3 + 2]);
    worstR = Math.max(worstR, Math.abs(r - 1));
  }

  // Водонепроницаемость: каждое ребро принадлежит ровно двум граням.
  const edges = new Map();
  let degenerate = 0;
  for (let f = 0; f < faces; f++) {
    const a = s.indices[f * 3], b = s.indices[f * 3 + 1], c = s.indices[f * 3 + 2];
    if (a === b || b === c || a === c) degenerate++;
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  let badEdges = 0;
  for (const n of edges.values()) if (n !== 2) badEdges++;

  // Согласованный обход: нормаль каждой грани смотрит наружу.
  let inward = 0;
  for (let f = 0; f < faces; f++) {
    const ia = s.indices[f * 3] * 3, ib = s.indices[f * 3 + 1] * 3, ic = s.indices[f * 3 + 2] * 3;
    const ux = s.positions[ib] - s.positions[ia];
    const uy = s.positions[ib + 1] - s.positions[ia + 1];
    const uz = s.positions[ib + 2] - s.positions[ia + 2];
    const wx = s.positions[ic] - s.positions[ia];
    const wy = s.positions[ic + 1] - s.positions[ia + 1];
    const wz = s.positions[ic + 2] - s.positions[ia + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const gx = (s.positions[ia] + s.positions[ib] + s.positions[ic]) / 3;
    const gy = (s.positions[ia + 1] + s.positions[ib + 1] + s.positions[ic + 1]) / 3;
    const gz = (s.positions[ia + 2] + s.positions[ib + 2] + s.positions[ic + 2]) / 3;
    if (nx * gx + ny * gy + nz * gz <= 0) inward++;
  }

  ok(faces === expFaces && verts === expVerts && worstR < 1e-6 &&
     badEdges === 0 && degenerate === 0 && inward === 0,
    `уровень ${lv}: ${faces} граней / ${verts} вершин, радиус ±${worstR.toExponential(0)}, ` +
    `рёбер-одиночек ${badEdges}, вывернутых граней ${inward}`);
}

// Кэш должен отдавать тот же объект, а не пересобирать меш каждый раз.
ok(icosphere(3) === icosphere(3), 'икосфера кэшируется по уровню');

// --- 2. Нормали после смещения ---------------------------------------------
console.log('\n== нормали ==');
{
  const s = icosphere(3);
  const pos = Float32Array.from(s.positions);
  // Искусственный рельеф: частая рябь — она и должна наклонять нормали.
  for (let i = 0; i < pos.length; i += 3) {
    const h = 1 + 0.05 * Math.sin(pos[i] * 9) * Math.cos(pos[i + 2] * 9);
    pos[i] *= h; pos[i + 1] *= h; pos[i + 2] *= h;
  }
  const n = computeNormals(pos, s.indices);
  let worstLen = 0, inward = 0, maxTilt = 0;
  for (let i = 0; i < n.length; i += 3) {
    worstLen = Math.max(worstLen, Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1));
    const d = n[i] * s.positions[i] + n[i + 1] * s.positions[i + 1] + n[i + 2] * s.positions[i + 2];
    if (d <= 0) inward++;
    maxTilt = Math.max(maxTilt, Math.acos(Math.max(-1, Math.min(1, d))));
  }
  ok(worstLen < 1e-6 && inward === 0,
    `нормали единичные (±${worstLen.toExponential(0)}) и наружу`);
  // Без этого рельеф был бы виден только силуэтом, но не в освещении.
  ok(maxTilt > 10 * Math.PI / 180,
    `рельеф наклоняет нормали до ${(maxTilt * 180 / Math.PI).toFixed(1)}° от радиуса`);
}

// --- 3. Выбор уровня LOD ----------------------------------------------------
console.log('\n== LOD ==');
{
  let mono = true, prev = -1;
  for (let px = 0.5; px < 2000; px *= 1.15) {
    const lv = levelForPixels(px, -1);
    if (lv < prev) mono = false;
    prev = lv;
  }
  ok(mono, 'уровень не убывает с ростом видимого размера');
  ok(levelForPixels(1, -1) === 0 && levelForPixels(5000, -1) >= 5,
    `край диапазона: 1 px -> ${levelForPixels(1, -1)}, 5000 px -> ${levelForPixels(5000, -1)}`);

  // Гистерезис: болтаясь вокруг порога, уровень не должен дребезжать.
  const threshold = 22;
  let switches = 0, cur = levelForPixels(threshold, -1);
  for (let i = 0; i < 60; i++) {
    const px = threshold + Math.sin(i) * 2;
    const lv = levelForPixels(px, cur);
    if (lv !== cur) switches++;
    cur = lv;
  }
  ok(switches === 0, `на пороге LOD не дребезжит (переключений ${switches})`);
}

// --- 4. Логарифмическая глубина --------------------------------------------
console.log('\n== глубина ==');
{
  const far = 2e9;
  let mono = true, inRange = true, prev = -1;
  for (let w = 0.004; w < far; w *= 1.7) {
    const d = logDepth(w, far);
    if (d <= prev) mono = false;
    if (!(d > 0 && d < 1.0001)) inRange = false;
    prev = d;
  }
  ok(mono && inRange,
    `глубина монотонна и в [0,1] от 4 м до ${(far / 1e6).toFixed(0)} млн км ` +
    `(коэффициент ${logDepthCoef(far).toExponential(2)})`);
  // Ближние объекты должны различаться по глубине — иначе z-fighting.
  const a = logDepth(0.2, far), b = logDepth(0.21, far);
  ok(b - a > 1e-7, `20 см на дистанции 200 м различимы по глубине (шаг ${(b - a).toExponential(1)})`);
}

// --- 5. Матрицы -------------------------------------------------------------
console.log('\n== матрицы ==');
{
  const cam = makeBasis();
  rotateBasis(cam, 0.4, -0.7, 0.3);
  const camPos = v3(1000, -200, 5000);
  const obj = makeBasis();
  rotateBasis(obj, -0.2, 1.1, 0.5);
  const objPos = v3(1040, -180, 5020);

  const mv = new Float32Array(16);
  const nm = new Float32Array(9);
  modelView(cam, camPos, obj, objPos, 2.5, mv, nm);

  // Независимая проверка: локальную точку переводим вручную
  // (модель -> мир -> камера) и сравниваем с результатом матрицы.
  let worst = 0;
  for (const p of [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), v3(-0.3, 0.7, 2)]) {
    const world = v3(
      objPos.x + (obj.right.x * p.x + obj.up.x * p.y + obj.fwd.x * p.z) * 2.5,
      objPos.y + (obj.right.y * p.x + obj.up.y * p.y + obj.fwd.y * p.z) * 2.5,
      objPos.z + (obj.right.z * p.x + obj.up.z * p.y + obj.fwd.z * p.z) * 2.5);
    const ref = toLocal(cam, camPos, world);
    const got = [
      mv[0] * p.x + mv[4] * p.y + mv[8] * p.z + mv[12],
      mv[1] * p.x + mv[5] * p.y + mv[9] * p.z + mv[13],
      mv[2] * p.x + mv[6] * p.y + mv[10] * p.z + mv[14],
    ];
    worst = Math.max(worst,
      Math.abs(got[0] - ref.x), Math.abs(got[1] - ref.y), Math.abs(got[2] - ref.z));
  }
  ok(worst < 1e-3, `modelView совпадает с ручным переводом (ошибка ${worst.toExponential(1)})`);

  // Проекция должна давать то же, что project() в Canvas-камере.
  const proj = perspective(68 * Math.PI / 180, 16 / 9, 0.004, 2e9);
  const focal = (900 / 2) / Math.tan((68 * Math.PI / 180) / 2);
  const X = 30, Y = -12, Z = 500;
  const clipX = proj[0] * X;
  const clipY = proj[5] * Y;
  const w = Z;
  const sx = (clipX / w) * (1600 / 2) + 800;
  const sy = 450 - (clipY / w) * (900 / 2);
  const refX = 800 + focal * X / Z;
  const refY = 450 - focal * Y / Z;
  ok(Math.abs(sx - refX) < 1e-6 && Math.abs(sy - refY) < 1e-6,
    `перспектива совпадает с Canvas-камерой (${sx.toFixed(2)} vs ${refX.toFixed(2)})`);

  // Направление на солнце в координатах камеры.
  const sd = dirToCamera(cam, 3, -4, 12);
  ok(Math.abs(Math.hypot(sd[0], sd[1], sd[2]) - 1) < 1e-6, 'направление на солнце единичное');
}

// --- 6. Точность float32 на больших орбитах --------------------------------
console.log('\n== точность ==');
{
  // Станция в 4 млн км от центра системы, камера в 20 км от неё.
  const cam = makeBasis();
  const far = 4e6;
  const camPos = v3(far, 0, 0);
  const objPos = v3(far + 20, 0.5, -0.25);
  const mv = new Float32Array(16);
  modelView(cam, camPos, makeBasis(), objPos, 1, mv, null);
  const err = Math.max(
    Math.abs(mv[12] - 20), Math.abs(mv[13] - 0.5), Math.abs(mv[14] + 0.25));
  ok(err < 1e-5,
    `смещение от камеры сохраняет точность на орбите 4 млн км (ошибка ${(err * 1000).toExponential(1)} м)`);

  // А вот если бы мировые координаты уходили во float32 напрямую,
  // ошибка была бы катастрофической — проверяем, что это действительно так,
  // то есть что приём «координаты относительно камеры» не напрасен.
  // Деталь размером с корабль (30 м) во float32 на такой орбите просто
  // исчезает — именно поэтому мировые координаты нельзя слать в шейдер.
  const naive = Math.abs(Math.fround(far + 0.03) - Math.fround(far) - 0.03);
  ok(naive > 0.02,
    `без этого приёма деталь в 30 м теряется целиком (ошибка ${(naive * 1000).toFixed(0)} м)`);
}

// --- 7. Базис тела и вращение ----------------------------------------------
console.log('\n== базис планеты ==');
{
  const world = makeSystem(0x1a7e);
  const body = world.home;
  const b = makeBasis();
  bodyBasis(body, b);
  const orth = Math.max(
    Math.abs(dot(b.right, b.up)), Math.abs(dot(b.right, b.fwd)), Math.abs(dot(b.up, b.fwd)),
    Math.abs(len(b.right) - 1), Math.abs(len(b.up) - 1), Math.abs(len(b.fwd) - 1));
  const cross = v3(
    b.right.y * b.up.z - b.right.z * b.up.y,
    b.right.z * b.up.x - b.right.x * b.up.z,
    b.right.x * b.up.y - b.right.y * b.up.x);
  const rightHanded = Math.hypot(cross.x - b.fwd.x, cross.y - b.fwd.y, cross.z - b.fwd.z);
  ok(orth < 1e-9 && rightHanded < 1e-9,
    `базис ортонормирован и правая тройка (ошибка ${orth.toExponential(1)})`);
  ok(Math.abs(dot(b.up, body.pole) - 1) < 1e-9, 'ось y базиса — полюс тела');

  // Суточное вращение обязано поворачивать поверхность.
  const before = { x: b.right.x, y: b.right.y, z: b.right.z };
  body.spinPhase += 0.5;
  bodyBasis(body, b);
  const turned = Math.acos(Math.max(-1, Math.min(1, dot(before, b.right))));
  ok(Math.abs(turned - 0.5) < 1e-6, `сдвиг фазы на 0.5 рад поворачивает базис на ${turned.toFixed(4)} рад`);
}

// --- 8. Рельеф --------------------------------------------------------------
console.log('\n== рельеф ==');
{
  const world = makeSystem(0x1a7e);

  // Шум ограничен и непрерывен.
  let maxAbs = 0, worstJump = 0;
  for (let i = 0; i < 4000; i++) {
    const x = Math.sin(i * 1.7) * 12, y = Math.cos(i * 2.3) * 12, z = Math.sin(i * 0.9) * 12;
    const a = perlin3(1234, x, y, z);
    const b = perlin3(1234, x + 1e-3, y, z);
    maxAbs = Math.max(maxAbs, Math.abs(a));
    worstJump = Math.max(worstJump, Math.abs(a - b));
  }
  ok(maxAbs <= 1.2, `шум Перлина ограничен: |n| <= ${maxAbs.toFixed(3)}`);
  ok(worstJump < 0.02, `шум непрерывен: скачок на шаге 1e-3 не больше ${worstJump.toExponential(1)}`);

  for (const body of world.bodies) {
    const t = makeTerrain(body);
    const t2 = makeTerrain(body);
    let maxH = -Infinity, minH = Infinity, same = true, jump = 0;
    const dirs = [];
    for (let i = 0; i < 2000; i++) {
      const u = -1 + 2 * (i / 1999);
      const a = i * 2.399963;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      dirs.push([s * Math.cos(a), u, s * Math.sin(a)]);
    }
    for (const [x, y, z] of dirs) {
      const h = t.displace(x, y, z);
      if (Math.abs(h - t2.displace(x, y, z)) > 0) same = false;
      maxH = Math.max(maxH, h);
      minH = Math.min(minH, h);
      // Непрерывность на сфере: шаг 0.002 рад не должен давать обрыва.
      const h2 = t.displace(x + 0.002, y, z);
      jump = Math.max(jump, Math.abs(h - h2));
    }
    if (t.isFlat) { maxH = 0; minH = 0; }
    const okBounds = maxH <= t.ampUp + 1e-9 && minH >= -t.ampDown - 1e-9;
    ok(same && okBounds && jump < Math.max(t.amp, 1e-9) * 0.25,
      `${body.name} (${body.kind}): высота ${(minH * 100).toFixed(2)}..${(maxH * 100).toFixed(2)}% ` +
      `радиуса (границы -${(t.ampDown * 100).toFixed(2)}..+${(t.ampUp * 100).toFixed(2)}%), ` +
      `детерминирована, без обрывов`);
  }

  const gas = world.planets.find((p) => p.kind === 'gas');
  const gasT = makeTerrain(gas);
  ok(gasT.displace(0.3, 0.5, 0.8) === 0 && gasT.isFlat,
    'газовый гигант остаётся гладким шаром (полосы только в цвете)');

  // Цвет: в диапазоне 0..1 и зависит от направления.
  const t = makeTerrain(world.home);
  const c1 = t.color(1, 0, 0, [0, 0, 0]);
  const c2 = t.color(0, 1, 0, [0, 0, 0]);
  const valid = [...c1, ...c2].every((v) => v >= 0 && v <= 1);
  ok(valid && (c1[0] !== c2[0] || c1[1] !== c2[1] || c1[2] !== c2[2]),
    'цвет поверхности в диапазоне 0..1 и меняется по направлению');
  const pole = t.color(0, 1, 0, [0, 0, 0]);
  ok(pole[0] > 0.7 && pole[1] > 0.7 && pole[2] > 0.7,
    `на полюсе океанической планеты снежная шапка (${pole.map((v) => v.toFixed(2)).join(', ')})`);
}

// --- 8b. Кратеры ------------------------------------------------------------
// Кратеры — главное, что отличает поверхность луны от «каши» из шума.
console.log('\n== кратеры ==');
{
  // Профиль: плоское дно, вал, гладкий сход в ноль.
  let worstJump = 0, prev = craterProfile(0);
  for (let t = 0; t <= 2; t += 0.001) {
    const v = craterProfile(t);
    worstJump = Math.max(worstJump, Math.abs(v - prev));
    prev = v;
  }
  ok(craterProfile(0) < -0.99 && craterProfile(2) === 0 && worstJump < 0.01,
    `профиль кратера: дно ${craterProfile(0).toFixed(2)}, вал ` +
    `${Math.max(craterProfile(0.9), craterProfile(0.95)).toFixed(2)}, ` +
    `гладкий (макс. шаг ${worstJump.toExponential(1)})`);

  // Глубина: у мелких кратеров — предел DMAX от радиуса, у бассейнов
  // считанные проценты (у Луны самый глубокий — 0.75% радиуса тела).
  const small = craterDepth(1e-5) / 1e-5;
  const basin = craterDepth(0.13) / 0.13;
  ok(Math.abs(small - CRATER_DMAX) < 1e-9 && basin < 0.08 && basin > 0.02,
    `глубина: мелкий кратер ${small.toFixed(2)} радиуса, бассейн ${basin.toFixed(3)}`);

  // Разброс размеров: на одном масштабе радиусы должны отличаться в
  // разы, иначе поверхность выглядит отштампованной.
  ok(CRATER_RSPAN / CRATER_RMIN > 3,
    `радиусы на одном масштабе различаются до ${(1 + CRATER_RSPAN / CRATER_RMIN).toFixed(0)} раз`);

  const world2 = makeSystem(0x1a7e);
  const moon = world2.bodies.find((b) => b.kind === 'moon');
  const t = makeTerrain(moon);

  // «Моря» и «материки»: кратеры должны быть только на вторых, иначе
  // тело выглядит как пузырчатая плёнка, а не как луна.
  let mareN = 0, mareHit = 0, landN = 0, landHit = 0, worstStep = 0, dens = 0;
  const dirs = [];
  for (let i = 0; i < 3000; i++) {
    const u = -1 + 2 * (i / 2999);
    const a = i * 2.399963;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    dirs.push([s * Math.cos(a), u, s * Math.sin(a)]);
  }
  for (const [x, y, z] of dirs) {
    const d = t.craterDensity(x, y, z);
    dens += d;
    const c = t.craterAt(x, y, z);
    const hit = Math.abs(c) > t.amp * 0.02;
    if (d < 0.1) { mareN++; if (hit) mareHit++; }
    if (d > 0.8) { landN++; if (hit) landHit++; }
    const c2 = t.craterAt(x + 1e-4, y, z);
    worstStep = Math.max(worstStep, Math.abs(c - c2));
  }
  const mareFrac = mareN / dirs.length;
  ok(mareFrac > 0.05 && mareFrac < 0.45 && mareHit / Math.max(1, mareN) < 0.02 &&
     landHit / Math.max(1, landN) > 0.25,
    `${moon.name}: «морей» ${(mareFrac * 100).toFixed(0)}% поверхности и в них ` +
    `кратеров ${(mareHit / Math.max(1, mareN) * 100).toFixed(0)}%, ` +
    `на материках — ${(landHit / Math.max(1, landN) * 100).toFixed(0)}% ` +
    `(средняя плотность ${(dens / dirs.length).toFixed(2)})`);

  ok(worstStep < 0.0008,
    `поле кратеров непрерывно: шаг 1e-4 рад меняет высоту не более чем на ` +
    `${(worstStep * moon.radius * 1000).toFixed(0)} м`);

  // Крупных кратеров в «морях» нет, а мелкие есть: их выбило уже после
  // заливки. Проверка предметная — размах рельефа на полукилометре,
  // то есть ровно то, что видно с высоты посадки. Именно такие ровные
  // места выбирает посадочный компьютер, и без мелких кратеров грунт
  // под кораблём выглядел залитым бетоном.
  {
    const mareDir = dirs.find(([x, y, z]) => t.craterDensity(x, y, z) < 0.08);
    const spanM = (detail) => {
      const [x, y, z] = mareDir;
      const a = Math.atan2(z, x);
      const ux = -Math.sin(a), uz = Math.cos(a);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i <= 200; i++) {
        const s = (i / 200) * 0.5 / moon.radius;      // дуга 500 м
        const qx = x + ux * s, qy = y, qz = z + uz * s;
        const l = Math.hypot(qx, qy, qz);
        const h = t.craterAt(qx / l, qy / l, qz / l, detail) * moon.radius * 1000;
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      return hi - lo;
    };
    const fine = spanM(null);                          // все масштабы кратеров
    const coarse = spanM({ oct: t.FULL.oct, cs: 7 });  // только масштабы крупнее 1.7 км
    let mono = true;
    for (let s = 1; s < CRATER_MAX_SCALES; s++) {
      if (mareWeight(s, 0) < mareWeight(s - 1, 0) - 1e-12) mono = false;
      if (Math.abs(mareWeight(s, 1) - 1) > 1e-12) mono = false;   // на материке маски нет
    }
    ok(mono && mareWeight(CRATER_MARE_FROM, 0) === 0 && mareWeight(CRATER_MARE_TO, 0) === 1,
      `маска «морей» растёт от масштаба ${CRATER_MARE_FROM} к ${CRATER_MARE_TO} ` +
      'и не трогает материки');
    ok(fine > 5 && coarse < 2,
      `в «море» на 500 м рельефа ${fine.toFixed(1)} м, и он весь от мелких ` +
      `масштабов (без них ${coarse.toFixed(1)} м)`);
  }

  // У океанического мира кратеров нет — их бы смыло.
  const ocean = makeTerrain(world2.home);
  let any = 0;
  for (let i = 0; i < 200; i++) {
    const a = i * 0.7;
    any += Math.abs(ocean.craterAt(Math.cos(a) * 0.6, 0.5, Math.sin(a) * 0.6));
  }
  ok(any === 0, 'у мира с атмосферой и океаном кратеров нет');
}

// --- 8c. Бюджет детализации -------------------------------------------------
// Ключевое требование: чем мельче ячейка сетки, тем больше деталей, но
// добавление деталей НЕ должно менять крупный рельеф — иначе горы
// «дышали» бы при каждой смене LOD.
console.log('\n== детализация по размеру ячейки ==');
{
  const world3 = makeSystem(0x1a7e);
  const moon = world3.bodies.find((b) => b.kind === 'moon');
  const t = makeTerrain(moon);

  const cells = [ICO_EDGE, ICO_EDGE / 8, ICO_EDGE / 64, 1e-4, 1e-6];
  const dets = cells.map((c) => t.detailForCell(c));
  const octGrow = dets.every((d, i) => i === 0 || d.oct >= dets[i - 1].oct);
  const csGrow = dets.every((d, i) => i === 0 || d.cs >= dets[i - 1].cs);
  ok(octGrow && csGrow && dets[0].oct < dets[dets.length - 1].oct,
    `октав ${dets.map((d) => d.oct).join(' -> ')}, ` +
    `масштабов кратеров ${dets.map((d) => d.cs).join(' -> ')}`);

  // Расхождение между грубой и полной детализацией не превышает
  // заявленной границы detailGap — на ней строятся юбки заплаток и
  // решение «рисовать ли сферу под заплаткой».
  let worst = 0, bound = Infinity;
  for (const d of dets) {
    const g = t.detailGap(d);
    let w = 0;
    for (let i = 0; i < 400; i++) {
      const u = -1 + 2 * (i / 399);
      const a = i * 2.399963;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      const x = s * Math.cos(a), y = u, z = s * Math.sin(a);
      w = Math.max(w, Math.abs(t.displace(x, y, z) - t.displace(x, y, z, d)));
    }
    if (w > g) { worst = Math.max(worst, w / g); }
    bound = Math.min(bound, g / Math.max(w, 1e-12));
  }
  ok(worst === 0,
    `граница detailGap соблюдается на всех уровнях (запас не меньше ${bound.toFixed(1)}x)`);

  // И наоборот: на мелкой ячейке расхождение должно быть мизерным,
  // иначе заплатка «прыгала» бы относительно того, что под ней.
  const fine = t.detailForCell(1e-6);
  ok(t.detailGap(fine) * moon.radius * 1000 < 1,
    `на ячейке 1e-6 рад расхождение с полной детализацией ` +
    `${(t.detailGap(fine) * moon.radius * 1000).toFixed(2)} м`);
}

// --- 8c2. Деталь в шейдере ---------------------------------------------------
// Мелкий рельеф считает фрагментный шейдер. Его код (js/gl/detail.js) —
// построчный перенос terrain.js, и проверить его на GPU здесь нельзя.
// Зато можно проверить ТО, из-за чего он был бы неправильным: шейдер
// обязан считать ровно «хвост» — октавы и масштабы кратеров, не вошедшие
// в сетку. Ошибка в стартовой амплитуде, частоте или seed слоя даёт
// двойной или потерянный рельеф, и увидеть это можно только глазами.
console.log('\n== деталь в шейдере ==');
{
  const world5 = makeSystem(0x1a7e);
  const moon = world5.bodies.find((b) => b.kind === 'moon');
  const t = makeTerrain(moon);
  const P = { x: 0.31, y: 0.67, z: 0.675 };
  const l = Math.hypot(P.x, P.y, P.z);
  P.x /= l; P.y /= l; P.z /= l;

  // Хвост суммы октав — та же арифметика, что в DETAIL_GLSL.
  const noiseTail = (seed, from, to, freq) => {
    let sum = 0, amp = GAIN ** from, f = freq * LAC ** from;
    for (let o = from; o < to; o++) {
      sum += amp * perlin3(seed + o * 1013, P.x * f, P.y * f, P.z * f);
      amp *= GAIN; f *= LAC;
    }
    return sum * (1 - GAIN);
  };
  let worst = 0;
  for (const [from, to] of [[1, 4], [3, 7], [4, 10], [2, 12]]) {
    const diff = fbm(2024, P.x, P.y, P.z, to, 1.7) - fbm(2024, P.x, P.y, P.z, from, 1.7);
    worst = Math.max(worst, Math.abs(diff - noiseTail(2024, from, to, 1.7)));
  }
  ok(worst < 1e-12,
    `хвост октав шума совпадает с разностью сумм (ошибка ${worst.toExponential(1)})`);

  // Хвост кратерных масштабов.
  const craterTail = (seed, from, to) => {
    let sum = 0, c = CRATER_C0 * CRATER_STEP ** from;
    for (let s = from; s < to; s++) {
      sum += craterLayer(seed + s * 7717, c, P.x, P.y, P.z);
      c *= CRATER_STEP;
    }
    return sum;
  };
  let worstC = 0;
  for (const [from, to] of [[0, 3], [3, 6], [2, 10]]) {
    const diff = craterField(777, P.x, P.y, P.z, to) - craterField(777, P.x, P.y, P.z, from);
    worstC = Math.max(worstC, Math.abs(diff - craterTail(777, from, to)));
  }
  ok(worstC < 1e-15,
    `хвост масштабов кратеров совпадает с разностью полей (ошибка ${worstC.toExponential(1)})`);

  // Производная профиля — по ней шейдер наклоняет нормаль.
  let worstD = 0;
  for (let x = 0.01; x < 1.8; x += 0.01) {
    // Пропускаем излом второй производной на кромке чаши и обрез
    // профиля на D_REACH (там профиль обрывается с 2e-7, и численная
    // производная на таком шаге показывает мусор).
    if (Math.abs(x - CRATER_BOWL) < 0.02 || Math.abs(x - CRATER_REACH) < 0.02) continue;
    const num = (craterProfile(x + 1e-5) - craterProfile(x - 1e-5)) / 2e-5;
    worstD = Math.max(worstD, Math.abs(num - craterProfileD(x)));
  }
  ok(worstD < 1e-4,
    `производная профиля кратера совпадает с численной (ошибка ${worstD.toExponential(1)})`);

  // Окно детализации: шейдер продолжает сетку, не перекрывая её.
  const cell6 = edgeAngle(6);
  const from = t.detailForCell(cell6);
  const w = detailWindow(t, cell6, 1e-5);
  ok(w.octFrom === from.oct && w.csFrom === from.cs && w.octTo > w.octFrom && w.csTo > w.csFrom,
    `сетка уровня 6 даёт октав ${w.octFrom} и кратеров ${w.csFrom}, шейдер добавляет ` +
    `до ${w.octTo} и ${w.csTo}`);

  // Чем ближе, тем больше деталей — и никогда меньше, чем в сетке.
  let mono = true, prevOct = -1, prevCs = -1;
  for (const fw of [1e-2, 3e-3, 1e-3, 3e-4, 1e-4, 3e-5, 1e-5, 1e-6, 1e-7]) {
    const ww = detailWindow(t, cell6, fw);
    if (ww.octTo < prevOct || ww.csTo < prevCs) mono = false;
    if (ww.octTo < ww.octFrom || ww.csTo < ww.csFrom) mono = false;
    prevOct = ww.octTo; prevCs = ww.csTo;
  }
  ok(mono, 'окно детализации растёт при приближении и не уходит ниже сетки');

  // Главное требование задачи: с 1000 км кратеры должны быть видны.
  // След пикселя на такой дистанции — около километра, и в окно обязаны
  // попасть масштабы с кратерами в единицы километров.
  {
    const dist = 1000;                       // км до поверхности
    const focal = 800;                       // пикселей (окно ~1080p)
    const fw = (dist / focal) / moon.radius; // рад на пиксель
    const ww = detailWindow(t, cell6, fw);
    const finest = CRATER_C0 * CRATER_STEP ** (ww.csTo - 1) * (CRATER_RMIN + CRATER_RSPAN);
    const finestKm = finest * moon.radius;
    ok(ww.csTo - ww.csFrom >= 2 && finestKm < 12,
      `с 1000 км шейдер добавляет ${ww.csTo - ww.csFrom} масштаба кратеров, ` +
      `самые мелкие — радиусом ${finestKm.toFixed(1)} км ` +
      `(след пикселя ${(fw * moon.radius).toFixed(2)} км)`);
  }

  // Окно всегда начинается ровно там, где кончается сетка, и не уходит
  // ниже предела точности float32: первое — чтобы деталь не считалась
  // дважды, второе — чтобы решётка не проступала ступеньками.
  {
    const cell = 2e-5;
    const from = t.detailForCell(cell);
    const ww = detailWindow(t, cell, 1e-9);
    const finest = CRATER_C0 * CRATER_STEP ** (ww.csTo - 1);
    ok(ww.octFrom === from.oct && ww.csFrom === from.cs &&
       ww.octTo - ww.octFrom <= DETAIL_MAX_OCT && ww.csTo - ww.csFrom <= DETAIL_MAX_CS &&
       finest >= DETAIL_MIN_SCALE,
      `на подробной заплатке окно начинается с сетки и добавляет ` +
      `${ww.octTo - ww.octFrom} октав и ${ww.csTo - ww.csFrom} масштабов кратеров ` +
      `(самый мелкий ${finest.toExponential(1)} рад)`);
  }

  // Плитка: шейдер продолжает не сетку, а ЗАПЕЧЁННУЮ ТЕКСТУРУ, и должен
  // начинаться ровно там, где её собственный вес перестаёт быть полным.
  // Вес в текстуре — smoothstep(LO·тексель, HI·тексель, масштаб), то
  // есть масштабы крупнее HI·текселя лежат в ней целиком, а всё, что
  // мельче, шейдер обязан посчитать сам. Разъехались бы эти две границы
  // — на стыке уровней плиток был бы либо шов, либо двойной рельеф.
  {
    let okStart = true, okFw = true, worst = '';
    for (let level = 2; level <= 14; level++) {
      const texel = tileTexelAngle(level);
      const u = tileDetailUniforms(t, texel);
      if (u.bakeFw !== texel) okFw = false;
      const cAt = (s) => CRATER_C0 * CRATER_STEP ** s;
      const full = DETAIL_FADE_HI * texel;
      // Первый не вошедший целиком масштаб — и предыдущий, который вошёл.
      if (u.csFrom < CRATER_MAX_SCALES &&
          !(cAt(u.csFrom) < full && (u.csFrom === 0 || cAt(u.csFrom - 1) >= full))) {
        okStart = false; worst = `ур.${level}: кратеры с ${u.csFrom}`;
      }
      const wave = (o) => 1 / (t.shaderParams().freq * LAC ** o);
      if (!(wave(u.octFrom) < full && (u.octFrom === 0 || wave(u.octFrom - 1) >= full))) {
        okStart = false; worst = `ур.${level}: октавы с ${u.octFrom}`;
      }
    }
    ok(okStart && okFw,
      'окно шейдера на плитке стыкуется с запечённой текстурой без нахлёста' +
      (worst ? ' — ' + worst : ''));
  }

  // Бюджет: сетке, которую почти целиком закрывает что-то другое,
  // достаётся меньше масштабов (она всё равно платится за пиксели —
  // логарифмическая глубина отключает early-z).
  {
    const full = detailUniforms(t, cell6, 1);
    const low = detailUniforms(t, cell6, 0.34);
    ok(full.on === 1 && low.maxCs < full.maxCs && low.maxCs >= 1 &&
       low.octFrom === full.octFrom,
      `урезанный бюджет: масштабов кратеров ${low.maxCs} вместо ${full.maxCs}, ` +
      `начало окна не меняется`);
    const gasT = makeTerrain(world5.planets.find((p) => p.kind === 'gas'));
    ok(detailUniforms(gasT, cell6).on === 0,
      'у тела без рельефа деталь в шейдере выключена');
  }

  // Текст шейдера: константы обязаны совпадать с JS, иначе картинка
  // разойдётся с физикой посадки.
  {
    const src = DETAIL_GLSL;
    const need = [
      ['D_GAIN', GAIN], ['D_LAC', LAC], ['D_C0', CRATER_C0], ['D_STEP', CRATER_STEP],
      ['D_RIM', CRATER_RIM], ['D_RMIN', CRATER_RMIN], ['D_RSPAN', CRATER_RSPAN],
      ['D_REACH', CRATER_REACH], ['D_BOWL', CRATER_BOWL],
      ['D_RIM_AT', CRATER_RIM_AT], ['D_RIM_W', CRATER_RIM_W],
      ['D_FRESH', CRATER_FRESH_MIN],
      ['D_MIN_SCALE', DETAIL_MIN_SCALE],
      ['D_MARE_FROM', CRATER_MARE_FROM], ['D_MARE_TO', CRATER_MARE_TO],
    ];
    let bad = [];
    for (const [name, val] of need) {
      const m = src.match(new RegExp('const float ' + name + ' = ([-0-9.e]+);'));
      if (!m || Math.abs(Number(m[1]) - val) > 1e-12) bad.push(name);
    }
    const hasSeed = src.includes('D_CRATER_SEED = ' + CRATER_SEED);
    ok(bad.length === 0 && hasSeed,
      `константы в GLSL совпадают с JS (проверено ${need.length + 1})` +
      (bad.length ? ' — разошлись: ' + bad.join(', ') : ''));
  }
}

// --- 8c3. Регулятор детализации и цена кадра --------------------------------
// Деталь на пиксель — самая дорогая работа в кадре, и единственная
// допустимая ручка её цены — расширение следа пикселя (js/gl/detail.js).
// Здесь проверяется не «стало быстрее» (этого без GPU не увидеть), а то,
// из-за чего регулятор был бы вреден: выход за границы, движение в
// мёртвой зоне и несимметричность не в ту сторону.
console.log('\n== регулятор детализации ==');
{
  // Тяжёлый кадр: множитель растёт, но не выше предела.
  const heavy = makeDetailLoad();
  let hist = [];
  for (let i = 0; i < 400; i++) hist.push(updateDetailLoad(heavy, 40, FW_TARGET_GPU));
  const grew = hist.every((v, i) => i === 0 || v >= hist[i - 1]);
  ok(grew && Math.abs(hist[hist.length - 1] - FW_MAX) < 1e-9,
    `при кадре 40 мс след расширяется монотонно до предела ×${FW_MAX} ` +
    `(за ${hist.findIndex((v) => v > FW_MAX - 0.01) + 1} кадров)`);

  // Лёгкий кадр: возвращается к полной резкости и НЕ уходит ниже.
  let back = [];
  for (let i = 0; i < 600; i++) back.push(updateDetailLoad(heavy, 4, FW_TARGET_GPU));
  const fell = back.every((v, i) => i === 0 || v <= back[i - 1]);
  ok(fell && back[back.length - 1] === 1 && Math.min(...back) === 1,
    'при кадре 4 мс возвращается ровно к единице и ниже не опускается');

  // Возврат должен быть медленнее срыва: иначе на пороге картинка
  // «дышит» — резкость то появляется, то уходит каждые несколько кадров.
  const upFrames = hist.findIndex((v) => v > 2) + 1;
  const downFrames = back.findIndex((v) => v < 2) + 1;
  ok(upFrames > 0 && downFrames > upFrames * 2,
    `вверх до ×2 за ${upFrames} кадров, обратно за ${downFrames} — возврат плавнее`);

  // Мёртвая зона: кадр ровно в норме не двигает деталь вовсе.
  const calm = makeDetailLoad();
  for (let i = 0; i < 200; i++) updateDetailLoad(calm, FW_TARGET_GPU, FW_TARGET_GPU);
  ok(calm.scale === 1, 'кадр ровно в норме деталь не трогает');

  // Мусор вместо замера (таймер не готов, окно свернули) не должен
  // сдвинуть ничего: один выброс увёл бы деталь в самую грубую.
  const junk = makeDetailLoad();
  junk.scale = 2.5;
  for (const bad of [0, -1, NaN, Infinity, undefined]) updateDetailLoad(junk, bad, FW_TARGET_GPU);
  ok(junk.scale === 2.5, 'нулевой и нечисловой замер деталь не двигают');

  // Пауза (свернули окно) даёт один кадр длиной в секунды. Деталь от
  // него почти не шевелится и возвращается за доли секунды.
  const stall = makeDetailLoad();
  updateDetailLoad(stall, 5000, FW_TARGET_GPU);
  const afterStall = stall.scale;
  let frames = 0;
  while (stall.scale > 1 && frames < 600) { updateDetailLoad(stall, 4, FW_TARGET_GPU); frames++; }
  ok(afterStall < 1.05 && frames < 60,
    `кадр в 5 с поднимает деталь только до ×${afterStall.toFixed(3)} ` +
    `и отпускает через ${frames} кадров`);

  // Порог по длительности кадра обязан лежать ВЫШЕ синхронизации на
  // шестидесяти: иначе регулятор срезал бы деталь на машине, которая
  // ровно держит 60 кадров в секунду.
  ok(FW_TARGET_CPU > 1000 / 60 && FW_TARGET_GPU < 1000 / 60,
    `порог по кадру ${FW_TARGET_CPU} мс выше 16.7, по таймеру карты ${FW_TARGET_GPU} мс — ниже`);
  const vsync = makeDetailLoad();
  for (let i = 0; i < 300; i++) updateDetailLoad(vsync, 1000 / 60, FW_TARGET_CPU);
  ok(vsync.scale === 1, 'ровные 60 кадров в секунду деталь не срезают');
}

// Главное в регуляторе — что он вообще уменьшает работу. Окно
// детализации считается от следа пикселя, поэтому расширение следа
// обязано срезать и октавы, и масштабы кратеров. Если бы множитель не
// доходил до dLimits, регулятор крутился бы впустую, и заметить это без
// GPU было бы нечем.
{
  const world6 = makeSystem(0x1a7e);
  const moon = world6.bodies.find((b) => b.kind === 'moon');
  const t = makeTerrain(moon);
  // Самый дорогой случай: тексель плитки растянут на весь допуск
  // (TILE_TEXEL_TOL пикселей), то есть шейдер тянет деталь от текселя
  // до пикселя целиком.
  const texel = tileTexelAngle(8);
  const u = tileDetailUniforms(t, texel);
  const work = (k) => {
    const win = detailWindow(t, texel * 2, texel / TILE_TEXEL_TOL * k);
    const oct = Math.min(win.octTo - u.octFrom, DETAIL_MAX_OCT);
    const cs = Math.min(win.csTo - u.csFrom, DETAIL_MAX_CS);
    // Во что это обходится на пиксель: шум считается трижды (значение и
    // два конечных разностных шага) плюс маска «морей», у кратеров
    // каждый масштаб — 27 ячеек решётки.
    return { oct, cs, cost: 3 * Math.max(0, oct) + 3 + Math.max(0, cs) * 27 };
  };
  const one = work(1), top = work(FW_MAX);
  ok(one.oct === DETAIL_MAX_OCT - 1 && one.cs === DETAIL_MAX_CS,
    `на пределе допуска окно почти во весь бюджет: ${one.oct} октав, ` +
    `${one.cs} масштабов кратеров`);
  ok(top.oct < one.oct && top.cs < one.cs && top.cost < one.cost * 0.7,
    `след ×${FW_MAX} срезает окно до ${top.oct} октав и ${top.cs} масштабов: ` +
    `${one.cost} -> ${top.cost} условных единиц на пиксель ` +
    `(${(100 - top.cost / one.cost * 100).toFixed(0)}% работы долой)`);
  // Монотонность: каждая ступень регулятора не должна добавлять работы.
  let prev = one.cost, mono = true;
  for (const k of [1.5, 2, 3, 4, 6, FW_MAX]) {
    const c = work(k).cost;
    if (c > prev) mono = false;
    prev = c;
  }
  ok(mono, 'работа на пиксель монотонно убывает по всей шкале регулятора');
}

// Множитель следа обязан доходить до шейдера и обязан быть не меньше
// единицы: нуль в этом uniform обнулил бы след пикселя, а на него
// делится всё плавное появление деталей.
{
  const src = DETAIL_GLSL;
  ok(MESH_FS_DETAIL.includes('uniform float uFwScale')
    && MESH_FS_DETAIL.includes('max(uFwScale, 1.0)'),
    'шейдер меша объявляет uFwScale и не даёт ему уйти ниже единицы');
  ok(!src.includes('uFwScale'),
    'сам DETAIL_GLSL про множитель не знает — он общий с запеканием, ' +
    'а там след равен текселю');
  ok(!MESH_FS.includes('uFwScale') && !MESH_FS.includes('NIGHT_SKIP'),
    'запасной шейдер без детали собирается без этих uniform-ов');
  // Порог ночи: за ним ни один склон света не поймает. Наклон ограничен
  // 1.6, то есть atan(1.6) = 58°, значит порог обязан быть не мягче
  // косинуса (180 - 58)°.
  const m = MESH_FS_DETAIL.match(/NIGHT_SKIP = (-?[0-9.]+)/);
  const safe = Math.cos(Math.PI - Math.atan(1.6));
  ok(m && Number(m[1]) <= safe,
    `порог ночи ${m ? m[1] : '?'} не мягче предельного склона (${safe.toFixed(3)})`);
}

// Масштаб буфера кадра: ручка на слабую карту. Проверяем разбор и то,
// что он действительно уменьшает буфер, а не только число в адресе.
{
  ok(renderScale('') === 1 && renderScale('?scale=abc') === 1 && renderScale(null) === 1,
    'без ?scale= и при мусоре масштаб буфера — единица');
  ok(renderScale('?scale=0.7') === 0.7 && renderScale('?scale=3') === 1
    && renderScale('?scale=0.01') === 0.35,
    'масштаб зажат в [0.35, 1]');
  ok(wantAa('') && wantAa('?aa=1') && !wantAa('?aa=0'),
    'сглаживание выключается только явным ?aa=0');

  const fake = { width: 0, height: 0, style: {} };
  const glStub = { viewport() {} };
  globalThis.window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1 };
  resizeCanvas(glStub, fake, 2, 1);
  const full = fake.width * fake.height;
  resizeCanvas(glStub, fake, 2, 0.5);
  const half = fake.width * fake.height;
  ok(full === 1600 * 900 && Math.abs(half / full - 0.25) < 0.01,
    `?scale=0.5 оставляет четверть пикселей (${full} -> ${half}), ` +
    'при этом холст приборов не затронут');
}

// --- 8d. Заплатки поверхности -----------------------------------------------
console.log('\n== заплатки поверхности ==');
{
  const world4 = makeSystem(0x1a7e);
  const moon = world4.bodies.find((b) => b.kind === 'moon');
  const t = makeTerrain(moon);

  // План: с высоты заплатки не нужны, у земли — нужны и их много.
  ok(patchPlan(moon, moon.radius, 5) === null,
    'с большой высоты заплатки не строятся (сфера не хуже)');
  const high = patchPlan(moon, 15, 6);
  const low = patchPlan(moon, 0.01, 6);
  ok(high && low && low.levels > high.levels && low.half < high.half,
    `уровней: с 15 км — ${high ? high.levels : '—'}, с 10 м — ${low ? low.levels : '—'}; ` +
    `полуразмер ${high ? (high.half * moon.radius).toFixed(1) : '—'} км -> ` +
    `${low ? (low.half * moon.radius * 1000).toFixed(0) + ' м' : '—'}`);
  const gas = world4.planets.find((p) => p.kind === 'gas');
  ok(patchPlan(gas, 1, 6) === null, 'у газового гиганта заплаток нет (нет и рельефа)');

  // Заплатка всегда шире горизонта: иначе за её краем была бы видна
  // грубая сфера, и стык бросался бы в глаза.
  let coversAll = true;
  for (const alt of [0.01, 0.1, 1, 5, 15]) {
    const p = patchPlan(moon, alt, 6);
    if (!p) continue;
    const horizon = Math.acos(moon.radius / (moon.radius + alt));
    if (p.half < horizon) coversAll = false;
  }
  ok(coversAll, 'внешний край заплатки всегда за горизонтом');

  // Геометрия: считаем набор целиком и проверяем стыковку уровней.
  const plan = patchPlan(moon, 0.05, 6);
  const center = normalize(v3(0.3, 0.7, 0.6));
  let parent = t.detailForCell(plan.sphereCell);
  let parentCell = plan.sphereCell;
  const geos = [];
  for (let k = 0; k < plan.levels; k++) {
    const half = plan.half / 2 ** k;
    const cell = 2 * half / plan.res;
    const detail = t.detailForCell(cell);
    const b = patchBuilder(moon, center, half, k < plan.levels - 1 ? plan.hole : 0,
      detail, parent, parentCell);
    b.step();
    geos.push({ geo: b.result, half, cell, detail });
    parent = detail;
    parentCell = cell;
  }

  let bad = 0, nan = 0;
  for (const { geo } of geos) {
    for (let i = 0; i < geo.positions.length; i++) if (!Number.isFinite(geo.positions[i])) nan++;
    for (let i = 0; i < geo.normals.length; i++) if (!Number.isFinite(geo.normals[i])) nan++;
    for (let i = 0; i < geo.colors.length; i++) {
      if (!(geo.colors[i] >= 0 && geo.colors[i] <= 1)) bad++;
    }
    // Вырожденных треугольников быть не должно.
    for (let f = 0; f < geo.indices.length; f += 3) {
      const a = geo.indices[f], b2 = geo.indices[f + 1], c = geo.indices[f + 2];
      if (a === b2 || b2 === c || a === c) bad++;
    }
  }
  ok(nan === 0 && bad === 0,
    `${geos.length} уровней, ${geos.reduce((s, g) => s + g.geo.faces, 0)} треугольников: ` +
    `ни NaN, ни вырожденных граней, цвета в 0..1`);

  // Нормали единичные и смотрят наружу.
  {
    let worstLen = 0, inward = 0, n = 0;
    for (const { geo } of geos) {
      for (let i = 0; i < geo.positions.length; i += 3) {
        const nl = Math.hypot(geo.normals[i], geo.normals[i + 1], geo.normals[i + 2]);
        if (nl < 0.5) continue;                 // вершины внутри выреза
        n++;
        worstLen = Math.max(worstLen, Math.abs(nl - 1));
        const d = geo.normals[i] * geo.positions[i] +
          geo.normals[i + 1] * geo.positions[i + 1] +
          geo.normals[i + 2] * geo.positions[i + 2];
        if (d <= 0) inward++;
      }
    }
    ok(worstLen < 1e-5 && inward === 0,
      `нормали заплаток единичные (±${worstLen.toExponential(0)}) и наружу (${n} вершин)`);
  }

  // Стыковка: на кромке заплатка обязана совпадать с тем, что под ней
  // (с точностью до огранки), а в середине — быть подробнее.
  {
    const inner = geos[geos.length - 1];
    const middleH = t.displace(center.x, center.y, center.z, inner.detail);
    const rCenter = Math.hypot(
      ...[0, 1, 2].map((k) => inner.geo.positions[(PATCH.res / 2 * (PATCH.res + 1) + PATCH.res / 2) * 3 + k]));
    ok(Math.abs(rCenter - (1 + middleH)) < 1e-6,
      `в центре самой мелкой заплатки высота — полная (${(middleH * moon.radius * 1000).toFixed(0)} м)`);

    // Угловой вершине соответствует высота родительской детализации.
    const g0 = geos[0];
    const corner = 0;                           // вершина (0,0) — угол
    const cx = g0.geo.positions[0], cy = g0.geo.positions[1], cz = g0.geo.positions[2];
    const rc = Math.hypot(cx, cy, cz);
    const dir = v3(cx / rc, cy / rc, cz / rc);
    const hp = t.displace(dir.x, dir.y, dir.z, t.detailForCell(plan.sphereCell));
    ok(Math.abs(rc - (1 + hp)) < 1e-6 && corner === 0,
      `на кромке грубой заплатки высота сведена к сферической ` +
      `(расхождение ${(Math.abs(rc - (1 + hp)) * moon.radius * 1000).toExponential(1)} м)`);
  }

  // Вырез каждого уровня совпадает с внешней границей следующего:
  // иначе в земле были бы либо щели, либо наложения.
  {
    let worst = 0;
    for (let k = 0; k + 1 < geos.length; k++) {
      const holeHalf = geos[k].half * PATCH.hole;
      worst = Math.max(worst, Math.abs(holeHalf - geos[k + 1].half) / geos[k + 1].half);
    }
    ok(worst < 1e-12, `границы выреза и следующего уровня совпадают (ошибка ${worst.toExponential(1)})`);
  }

  // Юбка должна уходить вниз глубже, чем возможное расхождение высот:
  // именно она закрывает щель на стыке разрешений.
  {
    const g0 = geos[0].geo;
    const n = PATCH.res + 1;
    const parentDetail = t.detailForCell(plan.sphereCell);
    // Юбка идёт по тем же направлениям, что кромка, поэтому глубину
    // считаем от высоты поверхности в этом направлении.
    let minSkirt = Infinity, maxSkirt = 0;
    for (let i = n * n; i < g0.positions.length / 3; i++) {
      const x = g0.positions[i * 3], y = g0.positions[i * 3 + 1], z = g0.positions[i * 3 + 2];
      const r = Math.hypot(x, y, z);
      if (r < 0.5) continue;
      const hp = t.displace(x / r, y / r, z / r, parentDetail);
      const drop = (1 + hp) - r;
      minSkirt = Math.min(minSkirt, drop);
      maxSkirt = Math.max(maxSkirt, drop);
    }
    const need = t.detailGap(parentDetail);
    ok(minSkirt > need && maxSkirt < 0.05,
      `юбка уходит вниз на ${(minSkirt * moon.radius * 1000).toFixed(0)}–` +
      `${(maxSkirt * moon.radius * 1000).toFixed(0)} м — глубже возможного ` +
      `расхождения детализаций (${(need * moon.radius * 1000).toFixed(0)} м)`);
  }

  // Стоимость сборки: набор должен укладываться в несколько кадров.
  {
    const t0 = Date.now();
    const p2 = patchPlan(moon, 0.02, 6);
    let par = t.detailForCell(p2.sphereCell), parCell = p2.sphereCell;
    let verts = 0;
    for (let k = 0; k < p2.levels; k++) {
      const half = p2.half / 2 ** k;
      const cell = 2 * half / p2.res;
      const det = t.detailForCell(cell);
      const b = patchBuilder(moon, center, half, k < p2.levels - 1 ? p2.hole : 0, det, par, parCell);
      b.step();
      verts += b.total;
      par = det; parCell = cell;
    }
    const ms = Date.now() - t0;
    ok(ms < 400, `полная пересборка набора (${p2.levels} уровней, ${verts} вершин) — ${ms} мс`);
  }
}

// --- 8e. Плитки поверхности --------------------------------------------------
// Поверхность нарезана квадродеревом на кубе, натянутом на сферу. Здесь
// проверяется то, что нельзя увидеть глазами по частям: что таблица
// граней совпадает с той, по которой выбирает грань само оборудование,
// что плитки стыкуются без щелей и что геометрия плитки корректна.
console.log('\n== плитки поверхности ==');
{
  const world6 = makeSystem(0x1a7e);
  const moon = world6.bodies.find((b) => b.kind === 'moon');

  // Таблица граней: направление -> грань и координаты -> обратно то же
  // направление. Перепутанный знак дал бы поверхность, сшитую наизнанку,
  // и заметить это можно было бы только глазами.
  {
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      const u = -1 + 2 * (i / 2999);
      const a = i * 2.399963;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      const d = { x: r * Math.cos(a), y: u, z: r * Math.sin(a) };
      const look = cubeLookup(d.x, d.y, d.z);
      // cubeLookup даёт координаты куба; параметр грани — их арктангенс.
      const su = Math.atan(look.s) * 4 / Math.PI;
      const sv = Math.atan(look.t) * 4 / Math.PI;
      const back = faceDir(look.face, su, sv, {});
      worst = Math.max(worst, Math.hypot(back.x - d.x, back.y - d.y, back.z - d.z));
    }
    ok(worst < 1e-12,
      `таблица граней куба совпадает с выбором оборудования (ошибка ${worst.toExponential(1)})`);
  }

  // Потомки делят родителя ровно: ни щелей, ни нахлёстов.
  {
    let bad = 0;
    for (const [lv, tx, ty] of [[0, 0, 0], [3, 5, 2], [7, 100, 3]]) {
      const b = tileBounds(lv, tx, ty);
      const kids = tileChildren(0, lv, tx, ty, []);
      let area = 0;
      for (const k of kids) {
        const kb = tileBounds(k.level, k.tx, k.ty);
        area += (kb.u1 - kb.u0) * (kb.v1 - kb.v0);
        if (kb.u0 < b.u0 - 1e-12 || kb.u1 > b.u1 + 1e-12) bad++;
        if (kb.v0 < b.v0 - 1e-12 || kb.v1 > b.v1 + 1e-12) bad++;
      }
      if (Math.abs(area - (b.u1 - b.u0) * (b.v1 - b.v0)) > 1e-12) bad++;
    }
    ok(bad === 0, 'четыре потомка делят плитку ровно, без щелей и нахлёстов');
  }

  // Соседние плитки одного уровня дают на общем ребре одни и те же
  // вершины: иначе между ними была бы щель в геометрии.
  {
    const a = tileBuilder(moon, { face: 2, level: 4, tx: 5, ty: 6 });
    const b = tileBuilder(moon, { face: 2, level: 4, tx: 6, ty: 6 });
    a.step(1 << 20); b.step(1 << 20);
    const ga = a.result, gb = b.result;
    const n = TILE_GRID + 1;
    let worst = 0;
    for (let j = 0; j < n; j++) {
      const ia = (j * n + TILE_GRID) * 3;     // правый край левой плитки
      const ib = (j * n) * 3;                 // левый край правой
      worst = Math.max(worst,
        Math.abs(ga.positions[ia] - gb.positions[ib]),
        Math.abs(ga.positions[ia + 1] - gb.positions[ib + 1]),
        Math.abs(ga.positions[ia + 2] - gb.positions[ib + 2]));
    }
    ok(worst === 0, `на общем ребре соседние плитки совпадают вершина в вершину`);
  }

  // Геометрия плитки: радиусы в пределах рельефа, uv в [0,1], индексы
  // не выходят за короткий тип, юбка уходит вниз.
  {
    const t = makeTerrain(moon);
    const bld = tileBuilder(moon, { face: 1, level: 6, tx: 20, ty: 41 });
    bld.step(1 << 20);
    const g = bld.result;
    const n = TILE_GRID + 1, grid = n * n;
    let bad = 0, minR = Infinity, maxR = 0, minSkirt = Infinity;
    for (let i = 0; i < grid; i++) {
      const r = Math.hypot(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      if (!(g.uv[i * 2] >= 0 && g.uv[i * 2] <= 1)) bad++;
      if (!(g.uv[i * 2 + 1] >= 0 && g.uv[i * 2 + 1] <= 1)) bad++;
    }
    for (let i = grid; i < g.positions.length / 3; i++) {
      const r = Math.hypot(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
      minSkirt = Math.min(minSkirt, r);
    }
    let maxIdx = 0, nan = 0;
    for (let i = 0; i < g.indices.length; i++) maxIdx = Math.max(maxIdx, g.indices[i]);
    for (const arr of [g.positions, g.normals, g.colors, g.uv]) {
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) nan++;
    }
    ok(bad === 0 && nan === 0 && maxIdx < 65536 &&
       minR > 1 - t.ampDown && maxR < 1 + t.ampUp && minSkirt < minR,
      `плитка: ${g.faces} граней, радиус ${minR.toFixed(4)}..${maxR.toFixed(4)}, ` +
      `юбка ниже сетки, индексы влезают в 16 бит`);
  }

  // Стык уровней: соседние плитки должны доводить деталь до одной и той
  // же мелкости.
  //
  // Мелочь под текселем считает шейдер, и бюджет у него конечный:
  // DETAIL_MAX_CS масштабов кратеров и DETAIL_MAX_OCT октав, то есть
  // окно шириной не больше D_FIT. Если тексель плитки во столько-то раз
  // крупнее пикселя, что окно не дотягивается до пикселя, деталь на ней
  // обрывается раньше — и рядом с подробным соседом это видно швом:
  // одна плитка зернистая, другая гладкая, граница прямая.
  //
  // Отсюда и взялся допуск на тексель в выборе уровня: два числа из
  // разных файлов обязаны быть согласованы, и проверка тут именно об
  // этом. Само расхождение нормали проверить headless нельзя.
  {
    const FIT = 2 / Math.min(CRATER_STEP ** -DETAIL_MAX_CS, LAC ** DETAIL_MAX_OCT);
    const finestPx = TILE_TEXEL_TOL * FIT;
    // Порог именно единица: деталь обязана доходить ДО ПИКСЕЛЯ на любой
    // разрешённой плитке. Если обрывается выше, то при смене уровня
    // недостающее появляется разом — кратеры «прогружаются» на глазах.
    ok(finestPx <= 1.05,
      `бюджет шейдера (${DETAIL_MAX_CS} масштабов, ${DETAIL_MAX_OCT} октав) дотягивает деталь ` +
      `до ${finestPx.toFixed(1)} px на самой грубой разрешённой плитке ` +
      `(${TILE_TEXEL_TOL} px на тексель)`);
  }

  // ...и второе условие того же: соседи по кадру не должны отличаться
  // больше чем на два уровня. Без допуска на тексель уровень выбирался
  // только по крупному рельефу, и рядом оказывались плитки, у которых
  // тексель отличался в восемь раз.
  {
    const tt = makeTerrain(moon);
    const R = moon.radius, focal = 1000, alt = 0.25;
    const camDir = normalize(v3(0.3, 0.5, 0.81));
    const mk = (tolScale) => ({
      radius: R, camDir, camAlt: alt, focal, tol: 5 * tolScale, texelTol: TILE_TEXEL_TOL,
      maxLevel: TILE_MAX_LEVEL, relief: tt.ampUp,
      errorOf: (lv) => tt.meshError(tt.detailForCell(tileCellAngle(lv))) + tileCellAngle(lv) ** 2 / 8,
      texelOf: (lv) => tileTexelAngle(lv), ready: () => true, want: () => {},
    });
    let tolScale = 1, out = selectTiles(mk(1), []);
    while (out.length > 220 && tolScale < 80) {
      tolScale = Math.min(80, tolScale * 1.12);
      out = selectTiles(mk(tolScale), []);
    }
    let gap = 0, where = '';
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        if (a.face !== b.face || a.level === b.level) continue;
        const ba = tileBounds(a.level, a.tx, a.ty), bb = tileBounds(b.level, b.tx, b.ty);
        const e = 1e-12;
        let adj = false;
        if (Math.abs(ba.u1 - bb.u0) < e || Math.abs(bb.u1 - ba.u0) < e) {
          adj = Math.min(ba.v1, bb.v1) > Math.max(ba.v0, bb.v0);
        } else if (Math.abs(ba.v1 - bb.v0) < e || Math.abs(bb.v1 - ba.v0) < e) {
          adj = Math.min(ba.u1, bb.u1) > Math.max(ba.u0, bb.u0);
        }
        if (adj && Math.abs(a.level - b.level) > gap) {
          gap = Math.abs(a.level - b.level);
          where = `${a.level}/${b.level}`;
        }
      }
    }
    ok(gap <= 2,
      `с 250 м в кадре ${out.length} плиток, соседи отличаются не больше ` +
      `чем на ${gap} уровня (худшая пара ${where})`);
  }

  // Все атрибуты плитки обязаны доехать до шейдера.
  //
  // uv не доезжал: buildIndexedMesh про него не знал, атрибут оставался
  // непривязанным, и вместо него шейдер получал константу — то есть вся
  // плитка выбирала ОДИН тексель своей текстуры. Освещение выходило
  // плоским на всю плитку, поверхность — шахматкой из светлых и тёмных
  // четырёхугольников. Глазами это ловится мгновенно, а headless — вот
  // так: сверяем список залитых буферов со списком данных.
  {
    const { buildIndexedMesh } = await import('../js/gl/mesh.js');
    const bld = tileBuilder(moon, { face: 1, level: 5, tx: 9, ty: 4 });
    while (!bld.step(4096));
    const geo = bld.result;
    const bound = new Map();
    let cur = null;
    const fake = {
      FLOAT: 1, ARRAY_BUFFER: 2, ELEMENT_ARRAY_BUFFER: 3, STATIC_DRAW: 4, TRIANGLES: 5,
      UNSIGNED_SHORT: 6, UNSIGNED_INT: 7,
      createVertexArray: () => ({}), bindVertexArray() {}, createBuffer: () => ({ id: 1 }),
      bindBuffer(target, b) { if (target === 2) cur = b; },
      bufferData(target, arr) { if (target === 2 && cur) cur.data = arr; },
      enableVertexAttribArray() {},
      vertexAttribPointer(loc, size) { bound.set(loc, { size, data: cur && cur.data }); },
    };
    const locs = { aPos: 0, aNormal: 1, aColor: 2, aUv: 3, aT: 4 };
    buildIndexedMesh(fake, locs, geo);
    const uv = bound.get(locs.aUv);
    ok(bound.size === 4 && uv && uv.size === 2 && uv.data === geo.uv &&
       bound.get(locs.aPos).data === geo.positions,
      `у плитки привязаны все ${bound.size} атрибута, включая uv ` +
      `(${uv ? uv.size : 0} числа на вершину)`);
  }

  // Стоимость: одна плитка собирается порциями, чтобы не ронять кадр.
  {
    const t0 = Date.now();
    const bld = tileBuilder(moon, { face: 0, level: 10, tx: 300, ty: 700 });
    let steps = 0;
    while (!bld.step(512)) steps++;
    ok(Date.now() - t0 < 400 && steps > 2,
      `сборка плитки: ${Date.now() - t0} мс за ${steps + 1} порций`);
  }
}

// --- 8f. Небо системы --------------------------------------------------------
// Главное требование пользователя: ничего узнаваемого и повторяющегося.
// У другой звёздной системы должно быть другое небо, а звёзды и полоса
// диска обязаны лежать в ОДНОЙ плоскости — разъехавшись, они сразу
// выдают, что полоса нарисована отдельно.
console.log('\n== небо системы ==');
{
  const unit = (v) => Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-9;
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

  const g = galaxyFor(0x1a7e);
  ok(unit(g.pole) && unit(g.core) && unit(g.e1) && unit(g.e2),
    'оси диска единичные');
  ok(Math.abs(dot(g.pole, g.core)) < 1e-9 && Math.abs(dot(g.e1, g.e2)) < 1e-9
    && Math.abs(dot(g.pole, g.e1)) < 1e-9,
    'полюс, ядро и оси плоскости взаимно перпендикулярны');
  ok(Math.abs(g.pole.y) >= 0.15 && Math.abs(g.pole.y) <= 0.95,
    `наклон полосы к плоскости системы ${(Math.acos(Math.abs(g.pole.y)) * 57.3).toFixed(0)}° ` +
    '— не вдоль орбит и не точно поперёк');

  // Тот же seed — то же небо (иначе оно менялось бы при каждой
  // перезагрузке), другой seed — другое.
  const same = galaxyFor(0x1a7e);
  ok(dot(g.pole, same.pole) > 1 - 1e-12 && g.sigma === same.sigma,
    'по одному seed небо получается одинаковым');
  // Требовать, чтобы у любых двух систем РАЗОШЁЛСЯ наклон полосы,
  // нельзя: полюс берётся равномерно, и у восьми систем (28 пар)
  // случайное совпадение наклона в пределах десятка градусов —
  // нормальное событие с вероятностью около четверти. Требование другое
  // и точное: не должно совпасть ВСЁ сразу, иначе это буквально одно и
  // то же небо.
  const seeds = [0x1a7e, 0x2b31, 0x77aa, 0xc0de, 0x51ee7, 1, 2, 3, 4, 5];
  const alike = (a, b) => 1 - Math.abs(dot(a, b)) < 0.02;
  let twins = 0, closest = 'нет';
  for (let i = 0; i < seeds.length; i++) {
    for (let j = i + 1; j < seeds.length; j++) {
      const a = galaxyFor(seeds[i]), b = galaxyFor(seeds[j]);
      if (alike(a.pole, b.pole) && alike(a.core, b.core)
        && Math.abs(a.sigma - b.sigma) < 0.005) {
        twins++;
        closest = `${seeds[i].toString(16)} и ${seeds[j].toString(16)}`;
      }
    }
  }
  ok(twins === 0,
    `у десяти систем нет двух одинаковых небес (совпавших пар ${twins}, ${closest})`);
  const sets = seeds.map((s) => skyFor(s).blobs.map((b) => b.kind[0]).join(''));
  ok(new Set(sets).size > 5,
    `набор туманностей у систем разный: ${new Set(sets).size} различных из ` +
    `${seeds.length} (по первым буквам: ${sets.slice(0, 4).join(', ')})`);

  // Облака: в диске, не внахлёст, цвета в пределах разумного.
  const sky = skyFor(0x1a7e);
  ok(sky.blobs.length > 0 && sky.blobs.length <= SKY_BLOBS,
    `туманностей ${sky.blobs.length}: ${sky.blobs.map((b) => b.kind).join(', ')}`);
  let apart = 1, worstLat = 0, badCol = 0;
  for (let i = 0; i < sky.blobs.length; i++) {
    const b = sky.blobs[i];
    if (!unit(b.dir)) badCol++;
    if (b.color.some((c) => !(c >= 0 && c <= 1))) badCol++;
    worstLat = Math.max(worstLat, Math.abs(dot(b.dir, sky.galaxy.pole)));
    for (let j = i + 1; j < sky.blobs.length; j++) {
      apart = Math.min(apart, dot(b.dir, sky.blobs[j].dir));
    }
  }
  ok(badCol === 0 && apart < 0.83,
    `облака не сливаются: ближайшая пара в ${(Math.acos(apart) * 57.3).toFixed(0)}° друг от друга`);
  ok(worstLat <= 0.43,
    `облака лежат в диске: дальше всех ${(Math.asin(worstLat) * 57.3).toFixed(0)}° от плоскости`);

  // Звёзды сгущаются к той же плоскости, что и полоса. Это и есть
  // условие «полоса не отдельно от своих звёзд».
  {
    const seed = 0x51ee7;
    const gal = galaxyFor(seed);
    const field = new Starfield(4000, seed);
    let inBand = 0;
    for (let i = 0; i < field.count; i++) {
      const lat = Math.abs(field.dirs[i * 3] * gal.pole.x
        + field.dirs[i * 3 + 1] * gal.pole.y + field.dirs[i * 3 + 2] * gal.pole.z);
      if (lat < 0.26) inBand++;                 // ±15° от плоскости
    }
    const share = inBand / field.count;
    // Равномерная россыпь дала бы ровно 26% (доля пояса на сфере
    // считается по площади: она равна синусу широты).
    ok(share > 0.40,
      `в полосе ±15° лежит ${(share * 100).toFixed(0)}% звёзд против 26% при ` +
      'равномерной россыпи — сгущение к диску есть');
    let badDir = 0;
    for (let i = 0; i < field.count; i++) {
      const l = Math.hypot(field.dirs[i * 3], field.dirs[i * 3 + 1], field.dirs[i * 3 + 2]);
      if (Math.abs(l - 1) > 1e-9) badDir++;
    }
    ok(badDir === 0, 'все направления звёзд остались единичными');
  }

  // Небо обязано остаться ФОНОМ: ярче звёзд оно превратится в туман, на
  // котором не видно ни звёзд, ни целей.
  ok(SKY_GAIN > 0 && SKY_GAIN < 0.35, `общая яркость неба ${SKY_GAIN} — фоновая`);
  ok(SKY_GLSL.includes('uBlobDir[' + SKY_BLOBS + ']'),
    'границы циклов в GLSL совпадают с числом облаков в JS');
}

// --- 8g. Атмосфера вдоль луча ------------------------------------------------
// Жалоба была конкретная: «очень резкий переход у атмосферы, когда
// корабль пройдёт эту сферу, чёрный космос сразу становится
// атмосферой». Причина была в том, что плотность воздуха в картинке не
// участвовала вовсе — оболочка светилась по кромке и имела КРАЙ.
//
// Проверяем поэтому не «красиво», а три вещи, из-за которых край
// возвращается: столб воздуха считается по той же формуле, что нагрев;
// на верху атмосферы его практически нет; при снижении он растёт без
// скачков.
console.log('\n== атмосфера вдоль луча ==');
{
  // Построчный двойник ATMO_FS: те же пересечения, тот же цикл.
  const STEPS = 16;
  const column = (r, d, ground, top, H, floorR = ground) => {
    const C = { x: 0, y: -r, z: 0 };                  // центр тела от камеры
    const b = d.x * C.x + d.y * C.y + d.z * C.z;
    const cc = r * r;
    const disc = b * b - (cc - top * top);
    if (disc <= 0) return 0;
    const sq = Math.sqrt(disc);
    const t0 = Math.max(b - sq, 0);
    let t1 = b + sq;
    // Луч обрывается по грунту ПОД КАМЕРОЙ, а сфера дополнительно
    // опускается до самой камеры, если та ниже (см. ATMO_FS).
    const gr = Math.min(floorR, Math.sqrt(cc) - 0.002);
    const discG = b * b - (cc - gr * gr);
    if (discG > 0) {
      const tg = b - Math.sqrt(discG);
      if (tg >= 0) t1 = Math.min(t1, tg);
    }
    if (t1 <= t0) return 0;
    const dt = (t1 - t0) / STEPS;
    let sum = 0;
    for (let i = 0; i < STEPS; i++) {
      const t = t0 + (i + 0.5) * dt;
      const alt = Math.hypot(d.x * t - C.x, d.y * t - C.y, d.z * t - C.z) - ground;
      sum += Math.exp(-Math.max(alt, 0) / H);
    }
    return sum * dt / H;                              // в долях вертикального
  };

  const world7 = makeSystem(0x1a7e);
  const body = world7.bodies.find((b) => b.name === 'Lave II');
  const R = body.radius;
  const top = R * (1 + ENTRY.top);
  const H = R * ENTRY.top / ENTRY.scales;
  const tauOf = (alt, d) => ATMO_THICK * column(R + alt, d, R, top, H);
  const alpha = (alt, d) => 1 - Math.exp(-tauOf(alt, d));
  const glow = (alt, d) => 1 - Math.exp(-tauOf(alt, d) * ATMO_GLOW);
  // Луч под углом к надиру — им проверяется вид на грунт сверху.
  const slant = (deg) => ({ x: Math.sin(deg * Math.PI / 180), y: -Math.cos(deg * Math.PI / 180), z: 0 });
  const UP = { x: 0, y: 1, z: 0 }, SIDE = { x: 1, y: 0, z: 0 }, DOWN = { x: 0, y: -1, z: 0 };

  // Плотность в шейдере и плотность, по которой греется обшивка, — одна
  // формула. Разойдись они, пламя начиналось бы там, где воздуха уже не
  // видно (или наоборот).
  let worstRho = 0;
  for (let k = 0; k < 10; k++) {
    const alt = R * ENTRY.top * (k / 10);
    const shader = Math.exp(-Math.max(alt, 0) / H);
    const physics = airDensity(body, alt) / (body.press === undefined ? 1 : body.press);
    worstRho = Math.max(worstRho, Math.abs(shader - physics));
  }
  // Ровно на верхней границе физика обрубает оставшиеся e^-5 в ноль, а
  // картинке обрубать нечего: там просто кончается объём, внутри
  // которого она считает. На интеграле это те самые 0.7% (см. ниже
  // вертикальный столб), и видеть их не в чем.
  ok(worstRho < 1e-12,
    `плотность в шейдере совпадает с airDensity ниже границы ` +
    `(расхождение ${worstRho.toExponential(0)})`);

  // Вертикальный столб от грунта до верха должен дать 1 - e^-5 = 0.993
  // шкалы высоты: это интеграл экспоненты, его можно взять на бумаге.
  // Сойдётся здесь — значит интегрирование в шейдере верное.
  const vert = column(R, UP, R, top, H);
  ok(Math.abs(vert - (1 - Math.exp(-ENTRY.scales))) < 0.02,
    `вертикальный столб ${vert.toFixed(3)} против аналитических ` +
    `${(1 - Math.exp(-ENTRY.scales)).toFixed(3)} шкалы высоты`);

  // У горизонта луч идёт вдоль слоёв и набирает примерно sqrt(πR/2H)
  // столбов. Это тоже берётся на бумаге — и это то, из-за чего у кромки
  // планеты яркая дуга.
  const tangent = column(R, SIDE, R, top, H);
  const expect = Math.sqrt(Math.PI * R / (2 * H));
  ok(tangent / vert > expect * 0.6 && tangent / vert < expect * 1.2,
    `у горизонта воздуха в ${(tangent / vert).toFixed(1)} раз больше, чем в зените ` +
    `(аналитика даёт ${expect.toFixed(1)})`);

  // ГЛАВНОЕ: у верха атмосферы неба практически нет, иначе это и есть
  // та самая резкая граница. Меряем на 0.9 верха — там, где был сделан
  // скриншот с жалобой (134 км из 147): ровно на границе касательный луч
  // вырожден и даёт ноль сам собой.
  const near = alpha(R * ENTRY.top * 0.9, SIDE);
  ok(alpha(R * ENTRY.top * 1.2, SIDE) < 0.02 && near < 0.2,
    `у верхней границы небо почти прозрачно: ${(near * 100).toFixed(0)}% у горизонта ` +
    `на 0.9 верха, ${(alpha(R * ENTRY.top * 1.2, SIDE) * 100).toFixed(1)}% выше границы`);

  // И никаких скачков при снижении: спускаемся от полутора верхов до
  // грунта и смотрим самый большой шаг в обе стороны.
  const sweep = (dir) => {
    let prev = alpha(R * ENTRY.top * 1.5, dir), up = 0, down = 0, at = 0, last = prev;
    for (let i = 1; i <= 600; i++) {
      const alt = R * ENTRY.top * 1.5 * (1 - i / 600);
      const a = alpha(alt, dir);
      if (a - prev > up) { up = a - prev; at = alt; }
      down = Math.min(down, a - prev);
      prev = a;
      last = a;
    }
    return { up, down, at, last };
  };
  for (const [name, dir] of [['к горизонту', SIDE], ['в зенит', UP]]) {
    const s = sweep(dir);
    ok(s.up < 0.03 && s.down > -1e-9,
      `${name}: небо наливается плавно и только густеет — ` +
      `наибольший шаг ${(s.up * 100).toFixed(2)}% на высоте ${s.at.toFixed(0)} км`);
  }
  // Вниз всё наоборот, и это не исключение из правила, а то же правило:
  // столб считается от глаза, а при снижении воздуха ПОД кораблём
  // остаётся всё меньше. На грунте под ногами его нет вовсе.
  {
    const s = sweep(DOWN);
    // На грунте под ногами воздуха практически нет: остаются десятки
    // метров от запаса на точность float32 (см. ATMO_EPS в ATMO_FS),
    // то есть сотые доли процента.
    ok(s.up < 0.03 && Math.abs(s.down) < 0.03 && s.last < 1e-3,
      `вниз: столб под кораблём тает без скачков и на грунте почти пуст ` +
      `(${(s.last * 100).toFixed(3)}%, последний шаг ${(s.down * 100).toFixed(2)}%)`);
  }

  // СВЕЧЕНИЕ И ГАШЕНИЕ — разные числа, и вот зачем. Связав их одним,
  // приходится выбирать: либо небо у грунта чёрное, либо планета с
  // орбиты залита молоком. Второе и случилось, когда толщину подняли
  // ради неба.
  {
    const downOccl = alpha(R * ENTRY.top * 0.9, slant(0));
    const slantOccl = alpha(R * ENTRY.top * 0.9, slant(60));
    ok(downOccl < 0.25 && slantOccl < 0.45,
      `с верха атмосферы грунт под собой виден: гашение ${(downOccl * 100).toFixed(0)}% ` +
      `в надир и ${(slantOccl * 100).toFixed(0)}% под 60°`);
    const zenithOccl = alpha(0, UP), zenithGlow = glow(0, UP);
    ok(zenithGlow > zenithOccl * 1.5 && zenithOccl < 0.3,
      `с грунта небо светится сильнее, чем гасит: свечение ` +
      `${(zenithGlow * 100).toFixed(0)}% против гашения ${(zenithOccl * 100).toFixed(0)}% ` +
      '(ночью сквозь него видны звёзды)');
    // Два конца одной ручки. Небо у горизонта обязано быть плотным, а
    // грунт под собой с орбиты обязан оставаться видимым: при слишком
    // ярком свечении диск планеты заливало ровной синевой, и это было
    // первым, что бросилось в глаза.
    const horizonGlow = glow(0, SIDE), fromSpace = glow(R * ENTRY.top * 1.4, slant(0));
    ok(horizonGlow > 0.9 && fromSpace < 0.45,
      `у горизонта небо плотное (${(horizonGlow * 100).toFixed(0)}%), а с орбиты в надир ` +
      `остаётся дымкой (${(fromSpace * 100).toFixed(0)}%), сквозь которую виден грунт`);
  }

  // Переход через верхнюю границу. Там код меняет ветку — снаружи видна
  // ближняя сторона оболочки, изнутри дальняя, — и картинка обязана
  // этого не заметить. Именно на этой границе было «странно» на двух
  // скриншотах подряд.
  {
    const step = (deg, eps) => {
      const d = slant(deg);
      const hi = R * ENTRY.top + eps, lo = R * ENTRY.top - eps;
      return Math.max(Math.abs(alpha(hi, d) - alpha(lo, d)),
        Math.abs(glow(hi, d) - glow(lo, d)));
    };
    let worst = 0, where = 0;
    for (const deg of [0, 30, 60, 80, 120, 180]) {
      const j = step(deg, 0.5);
      if (j > worst) { worst = j; where = deg; }
    }
    // Порог на КИЛОМЕТР высоты. Он не про «незаметно глазу» (это и так
    // незаметно), а про отсутствие скачка: у разрыва здесь были бы
    // десятки процентов.
    ok(worst < 0.02,
      `на границе атмосферы километр высоты меняет картинку не больше чем на ` +
      `${(worst * 100).toFixed(2)}% (худший угол ${where}°)`);

    // У самой касательной картинка меняется быстрее — у края шара
    // хорда набирается круто. Но это КРУТИЗНА, а не разрыв, и отличить
    // одно от другого просто: уменьшив шаг вчетверо, изменение обязано
    // уменьшиться тоже. У разрыва оно осталось бы прежним.
    const far = step(89, 0.5), near = step(89, 0.125);
    ok(near > 0 && far / near > 1.6,
      `у касательной изменение убывает вместе с шагом (${(far * 100).toFixed(2)}% ` +
      `на ±0.5 км против ${(near * 100).toFixed(2)}% на ±0.125 км) — это крутизна, а не разрыв`);
  }

  // НИЗИНА. Рельеф ниже уровня моря — обычное дело: дно океана на этом
  // теле лежит на 12 км ниже средней сферы, и корабль там оказывается
  // ниже неё. Луч вниз обязан упираться в грунт под собой, а не уходить
  // сквозь планету: иначе в низине кадр заливает молоком, хотя до земли
  // метры. Замер до правки: столб в надир 58 против 0.01 над средней
  // сферой.
  {
    const deep = -10.9;                    // 1.1 км над грунтом на 12 км ниже
    const down = ATMO_THICK * column(R + deep, DOWN, R, top, H);
    const flat = ATMO_THICK * column(R + 1.1, DOWN, R, top, H);
    ok(down < 0.05 && Math.abs(down - flat) < 0.05,
      `в низине вниз смотрится так же, как над средней сферой: столб ${down.toFixed(3)} ` +
      `против ${flat.toFixed(3)}`);
    // А вбок из низины воздуха, наоборот, БОЛЬШЕ: корабль ниже, слой
    // над ним толще. Это не ошибка, это тот же интеграл.
    const side = ATMO_THICK * column(R + deep, SIDE, R, top, H);
    ok(side > ATMO_THICK * column(R + 1.1, SIDE, R, top, H),
      `вбок из низины воздуха больше (${side.toFixed(2)} против ` +
      `${(ATMO_THICK * column(R + 1.1, SIDE, R, top, H)).toFixed(2)})`);
    // И никакого скачка на самой средней сфере — переход через неё
    // ничем не отмечен.
    let worst = 0;
    for (const deg of [0, 45, 80]) {
      const d = slant(deg);
      const hi = ATMO_THICK * column(R + 0.5, d, R, top, H);
      const lo2 = ATMO_THICK * column(R - 0.5, d, R, top, H);
      worst = Math.max(worst, Math.abs((1 - Math.exp(-hi)) - (1 - Math.exp(-lo2))));
    }
    ok(worst < 0.02,
      `переход через уровень средней сферы не виден: наибольшая разница ` +
      `${(worst * 100).toFixed(2)}%`);
  }

  // ЗЕМЛЯ ПОД НОГАМИ. Рельеф отходит от средней сферы на километры, и
  // если обрывать луч о неё, то с возвышенности в сотню метров луч вбок
  // уходит до средней сферы за десятки километров плотного воздуха —
  // близкая земля прямо перед носом тонет в дымке. Это и был «туман на
  // десяти метрах высоты».
  {
    const hill = R + 0.1;                      // грунт на 100 м выше средней
    const eye = hill + 0.01;                   // и корабль в 10 м над ним
    // Смотрим полого вниз — так и видно землю перед собой: под 1° это
    // полкилометра, под четвертью градуса — два с лишним.
    const haze = (deg, floorR) => {
      const a = deg * Math.PI / 180;
      const d = { x: Math.cos(a), y: -Math.sin(a), z: 0 };
      return 1 - Math.exp(-ATMO_THICK * column(eye, d, R, top, H, floorR) * ATMO_GLOW);
    };
    ok(haze(1, hill) < 0.02 && haze(1, R) > 0.05,
      `земля в полукилометре перед носом чистая: дымка ${(haze(1, hill) * 100).toFixed(1)}% ` +
      `по грунту под камерой против ${(haze(1, R) * 100).toFixed(0)}% по средней сфере`);
    ok(haze(0.25, hill) < 0.1 && haze(0.25, R) > 0.5,
      `и в двух километрах тоже: ${(haze(0.25, hill) * 100).toFixed(1)}% против ` +
      `${(haze(0.25, R) * 100).toFixed(0)}% — по средней сфере луч там уходил в касательную`);
    // А горизонт с той же высоты обязан остаться в дымке: там луч идёт
    // вдоль слоёв сотни километров, и это не ошибка, а воздух.
    const hor = 1 - Math.exp(-ATMO_THICK * column(eye, SIDE, R, top, H, hill));
    ok(hor > 0.85,
      `горизонт с той же высоты по-прежнему в дымке (${(hor * 100).toFixed(0)}%)`);
  }

  // Луч в грунт короче касательного: за поверхностью воздуха не видно.
  ok(column(R + 50, DOWN, R, top, H) < column(R + 50, SIDE, R, top, H),
    'луч, упирающийся в грунт, обрывается на нём');
  // И на самой поверхности взгляд вниз не даёт ничего: между глазом и
  // грунтом воздуха нет. Строгое сравнение здесь складывало воздух
  // через всю планету и заливало кадр небом на посадке.
  ok(column(R, DOWN, R, top, H) < 3e-3 && column(R + 0.05, DOWN, R, top, H) < 0.01,
    'на грунте взгляд вниз даёт практически пустой столб');

  // Текст шейдера — тот же, что у двойника выше.
  ok(ATMO_FS.includes('exp(-max(alt, 0.0) / uScaleH)')
    && ATMO_FS.includes('const int STEPS = ' + STEPS)
    && ATMO_FS.includes('1.0 - exp(-tau)')
    // Сравнение с грунтом именно НЕстрогое — на этом был баг.
    && ATMO_FS.includes('if (tg >= 0.0) t1 = min(t1, tg);'),
    'ATMO_FS считает тот же интеграл теми же шагами и так же обрывается о грунт');
  ok(!ATMO_FS.includes('uDensity') && !ATMO_FS.includes('vNormal'),
    'от свечения по кромке (нормаль сферы и uDensity) не осталось следов');
  // Луч обрывается о ПОЛ (грунт под камерой), а плотность считается от
  // СРЕДНЕГО радиуса: перепутать их значит либо утопить близкую землю в
  // дымке, либо сбить профиль плотности на высоту рельефа (а это
  // километры).
  ok(ATMO_FS.includes('float ground = min(uFloor, sqrt(cc) - ATMO_EPS);')
    && ATMO_FS.includes('float alt = length(d * (t0 + (float(i) + 0.5) * dt) - uCenter) - uGround;'),
    'обрыв луча идёт по uFloor, а плотность — по uGround');
  // Запас в зажиме — АБСОЛЮТНЫЙ и маленький. Доля радиуса тут выходит
  // боком: 10⁻⁵ от 4200 км — это 42 м, больше самой высоты полёта у
  // земли, и такой зажим опускает землю ниже, чем она есть.
  {
    const m = ATMO_FS.match(/ATMO_EPS = ([0-9.]+)/);
    ok(m && Number(m[1]) > 0 && Number(m[1]) < 0.01,
      `запас зажима ${m ? (Number(m[1]) * 1000).toFixed(0) : '?'} м — абсолютный и ниже ` +
      'любой высоты, на которой летают');
  }
}

// --- 8h. Оболочка ударной волны ---------------------------------------------
// Жалоба: «этот купол не повторяет реалистичную форму корабля, а просто
// какой то конус». Так и было — волна строилась телом вращения вокруг
// вектора скорости, и корпус в ней не участвовал.
//
// Проверяется поэтому не «красиво», а три свойства, без которых конус
// вернётся: оболочка СОДЕРЖИТ корабль целиком, лежит к нему ВПЛОТНУЮ и
// НЕ является телом вращения.
console.log('\n== оболочка ударной волны ==');
{
  const hull = buildCobra();
  const g = shockGeometry(hull);
  const c = g.center;
  const radAt = (dx, dy, dz) => {
    // Радиус оболочки в направлении точки: берём ближайшую вершину
    // оболочки по углу. Для оценки зазора этого достаточно — сетка
    // икосферы равномерная.
    const r = Math.hypot(dx, dy, dz) || 1e-12;
    let best = -2, out = 0;
    for (let i = 0; i < g.verts; i++) {
      const px = g.positions[i * 3] - c.x, py = g.positions[i * 3 + 1] - c.y,
        pz = g.positions[i * 3 + 2] - c.z;
      const pl = Math.hypot(px, py, pz);
      const cs = (dx * px + dy * py + dz * pz) / (r * pl);
      if (cs > best) { best = cs; out = pl; }
    }
    return out;
  };

  // 1. Корабль внутри. Торчащее из пламени крыло — это ровно то, что
  //    было видно на скриншоте.
  let worstGap = Infinity;
  for (const v of hull.verts) {
    const r = Math.hypot(v.x - c.x, v.y - c.y, v.z - c.z);
    worstGap = Math.min(worstGap, radAt(v.x - c.x, v.y - c.y, v.z - c.z) - r);
  }
  ok(worstGap > 0,
    `корпус внутри оболочки целиком: минимальный зазор ` +
    `${(worstGap * 1000).toFixed(1)} м при заданном ${(g.gap * 1000).toFixed(1)} м`);

  // 2. Оболочка вплотную: габариты растут примерно на два зазора по
  //    каждой оси, а не в разы. Первая попытка (радиус опорной функции)
  //    давала по оси высоты +36 м вместо +7 — тот самый кокон.
  const span = (get, cnt) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < cnt; i++) {
      for (let k = 0; k < 3; k++) {
        const v = get(i, k);
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    return hi.map((x, k) => x - lo[k]);
  };
  const hs = span((i, k) => [hull.verts[i].x, hull.verts[i].y, hull.verts[i].z][k],
    hull.verts.length);
  const gs = span((i, k) => g.positions[i * 3 + k], g.verts);
  const grow = gs.map((v, k) => v - hs[k]);
  ok(grow.every((v) => v > 0 && v < g.gap * 4),
    `оболочка вплотную: прирост габаритов ${grow.map((v) => (v * 1000).toFixed(1)).join(' / ')} м ` +
    `при зазоре ${(g.gap * 1000).toFixed(1)} м`);

  // 3. НЕ тело вращения. У корабля корпус плоский и широкий, и оболочка
  //    обязана это повторять: у конуса или шара поперечные размеры
  //    совпали бы.
  ok(gs[0] / gs[1] > 2,
    `оболочка повторяет силуэт: ${(gs[0] * 1000).toFixed(0)} м в размахе против ` +
    `${(gs[1] * 1000).toFixed(0)} м в высоту (${(gs[0] / gs[1]).toFixed(1)}:1, ` +
    `у корпуса ${(hs[0] / hs[1]).toFixed(1)}:1)`);

  // 4. Лучевая поверхность: радиусы конечны и положительны, поэтому
  //    оболочка не может пересечь сама себя — а самопересечение при
  //    аддитивном смешивании видно удвоенной яркостью в каждой складке.
  let badRad = 0, badNorm = 0;
  for (let i = 0; i < g.verts; i++) {
    if (!(g.rad[i] > 0) || !Number.isFinite(g.rad[i])) badRad++;
    const px = g.positions[i * 3] - c.x, py = g.positions[i * 3 + 1] - c.y,
      pz = g.positions[i * 3 + 2] - c.z;
    if (g.normals[i * 3] * px + g.normals[i * 3 + 1] * py + g.normals[i * 3 + 2] * pz <= 0) {
      badNorm++;
    }
  }
  ok(badRad === 0 && badNorm === 0,
    `все ${g.verts} радиусов положительны, все нормали смотрят наружу`);

  // 5. Доводка под поток — построчный двойник PLUME_VS. При развороте
  //    раскаляться должен подставленный потоку борт, и это должно
  //    следовать из одной наветренности, без отдельных правил.
  const wind = (flow) => {
    let nose = 0, stern = 1, side = 0;
    for (let i = 0; i < g.verts; i++) {
      const nx = g.normals[i * 3], ny = g.normals[i * 3 + 1], nz = g.normals[i * 3 + 2];
      const w = Math.max(0, nx * flow.x + ny * flow.y + nz * flow.z);
      // Нос, корма и правый борт оболочки — по её же вершинам.
      if (nz > 0.9) nose = Math.max(nose, w);
      if (nz < -0.9) stern = Math.min(stern, w);
      if (nx > 0.9) side = Math.max(side, w);
    }
    return { nose, stern, side };
  };
  const straight = wind({ x: 0, y: 0, z: 1 });
  const sideslip = wind({ x: 1, y: 0, z: 0 });
  ok(straight.nose > 0.9 && straight.stern === 0,
    `по курсу наветренный нос (${straight.nose.toFixed(2)}), корма в тени ` +
    `(${straight.stern.toFixed(2)})`);
  ok(sideslip.side > 0.9 && sideslip.nose < 0.4,
    `в скольжении раскаляется борт (${sideslip.side.toFixed(2)}), а не нос ` +
    `(${sideslip.nose.toFixed(2)})`);

  // След тянется НАЗАД и только за кормой: вытяни он весь корпус —
  // оболочка опять перестала бы повторять корабль.
  const stretch = (z, span) => {
    const back = Math.max(0, -z) / span;
    return Math.min(back * back, 1);
  };
  const half = hull.length * 0.5;
  ok(stretch(half, half) === 0 && stretch(-half, half) === 1
    && stretch(-half * 0.5, half) < 0.3,
    `след растёт только к корме: нос ${stretch(half, half)}, ` +
    `середина кормовой половины ${stretch(-half * 0.5, half).toFixed(2)}, корма 1`);

  // И то же самое в самом шейдере: если он снова начнёт строить тело
  // вращения (uRad/uLen), это надо заметить здесь, а не глазами.
  ok(PLUME_VS.includes('dot(aNormal, uFlow)') && PLUME_VS.includes('in vec3 aNormal;')
    && !PLUME_VS.includes('uRad') && !PLUME_VS.includes('uLen'),
    'PLUME_VS строит волну по корпусу и потоку, а не как тело вращения');
}

// --- 9. Геометрия планеты ---------------------------------------------------
console.log('\n== геометрия планеты ==');
{
  const world = makeSystem(0x1a7e);
  for (const body of [world.home, world.planets.find((p) => p.kind === 'gas')]) {
    const geo = planetGeometry(body, 3);
    const n = geo.positions.length / 3;
    let minR = Infinity, maxR = -Infinity, badN = 0, badC = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(geo.positions[i * 3], geo.positions[i * 3 + 1], geo.positions[i * 3 + 2]);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      if (Math.abs(Math.hypot(geo.normals[i * 3], geo.normals[i * 3 + 1], geo.normals[i * 3 + 2]) - 1) > 1e-5) badN++;
      for (let k = 0; k < 4; k++) {
        const v = geo.colors[i * 4 + k];
        if (!(v >= 0 && v <= 1)) badC++;
      }
    }
    const amp = makeTerrain(body).amp;
    ok(badN === 0 && badC === 0 && minR >= 0.999 && maxR <= 1 + amp * 1.05 + 1e-5,
      `${body.name}: ${n} вершин, радиус ${minR.toFixed(4)}..${maxR.toFixed(4)}, ` +
      `нормали и цвета корректны`);
  }
  // Кэш геометрии: та же планета на том же уровне не должна пересчитываться.
  const t0 = Date.now();
  planetGeometry(world.home, 4);
  const cold = Date.now() - t0;
  ok(cold < 3000, `генерация уровня 4 укладывается в ${cold} мс`);
}


// --- 10. Прогон пути отрисовки через мок GL --------------------------------
// Пиксели так не проверить, но всё, что до драйвера, — вполне: что шейдеры
// собираются, буферы заливаются, матрицы не содержат NaN и draw-вызовы
// происходят. Именно здесь ловятся ошибки, из-за которых в браузере был бы
// просто чёрный экран.
console.log('\n== мок GL: путь отрисовки ==');
{
  const state = {
    nan: 0, nanWhere: [], draws: 0, buffers: 0, programs: 0, vaos: 0, stencils: 0,
    textures: 0, texturesFreed: 0, bakes: 0, skyBakes: 0, mipmaps: 0,
    // Размах значений каждого скалярного uniform-а за всё время: по
    // нему видно и то, дошёл ли параметр до шейдера вообще, и то,
    // меняется ли он от плитки к плитке.
    uni: {}, uniMin: {},
  };
  const CONST = {};
  let constCounter = 1;
  let attribIdx = -1;
  // Статус фреймбуфера читается до того, как кто-либо обратится к
  // константе, поэтому её надо завести заранее.
  CONST.FRAMEBUFFER_COMPLETE = constCounter++;

  const checkArgs = (name, args) => {
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) {
        state.nan++; state.nanWhere.push(name);
      } else if (a && a.BYTES_PER_ELEMENT && a.length !== undefined) {
        for (let i = 0; i < a.length; i++) {
          if (!Number.isFinite(a[i])) { state.nan++; state.nanWhere.push(name + '[' + i + ']'); break; }
        }
      }
    }
  };

  const impl = {
    createShader: () => ({}),
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => { state.programs++; return {}; },
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    getAttribLocation: () => { attribIdx = (attribIdx + 1) % 8; return attribIdx; },
    getUniformLocation: (p, name) => ({ name }),
    uniform1f: (loc, v) => {
      if (!loc) return;
      state.uni[loc.name] = Math.max(state.uni[loc.name] ?? -Infinity, v);
      state.uniMin[loc.name] = Math.min(state.uniMin[loc.name] ?? Infinity, v);
    },
    createBuffer: () => { state.buffers++; return {}; },
    createVertexArray: () => { state.vaos++; return {}; },
    drawArrays: () => { state.draws++; },
    drawElements: () => { state.draws++; },
    stencilFunc: () => { state.stencils++; },
    stencilOp: () => { state.stencils++; },
    deleteBuffer: () => {},
    deleteVertexArray: () => {},
    cullFace: (mode) => { state.cull = mode; },
    createTexture: () => { state.textures++; return {}; },
    deleteTexture: () => { state.texturesFreed++; },
    createFramebuffer: () => ({}),
    checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    // Запекание поверхности пишет в обычную текстуру, небо — в ГРАНЬ
    // кубической карты. Считаем их порознь: у неба шесть проходов на
    // весь запуск, у плиток — по проходу на плитку, и перепутать эти
    // счётчики значит не заметить, что небо печётся каждый кадр.
    framebufferTexture2D: (target, attach, texTarget) => {
      if (texTarget === CONST.TEXTURE_2D) state.bakes++;
      else state.skyBakes++;
    },
    generateMipmap: () => { state.mipmaps++; },
    getParameter: () => 'mock-gpu',
    getExtension: () => null,
  };

  const gl = new Proxy(impl, {
    get(t, prop) {
      if (prop in t) {
        const f = t[prop];
        if (typeof f !== 'function') return f;
        return (...args) => { checkArgs(String(prop), args); return f(...args); };
      }
      // Константы GL: любое ИМЯ_ИЗ_ЗАГЛАВНЫХ — уникальное число.
      if (typeof prop === 'string' && /^[A-Z][A-Z0-9_]*$/.test(prop)) {
        if (!(prop in CONST)) CONST[prop] = constCounter++;
        return CONST[prop];
      }
      return (...args) => { checkArgs(String(prop), args); };
    },
  });

  globalThis.window = {
    innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {},
  };
  const canvas = {
    width: 0, height: 0, style: {},
    getContext: () => gl,
    addEventListener() {},
  };

  const { Camera } = await import('../js/render/camera.js');
  const { Starfield } = await import('../js/render/starfield.js');
  const { GlScene } = await import('../js/gl/scene.js');
  const { buildCobra } = await import('../js/models/ships.js');
  const { buildStation } = await import('../js/models/station.js');
  const { makeShip, placeShip } = await import('../js/game/ship.js');

  const cam = new Camera();
  cam.resize(1600, 900);
  const scene = new GlScene(canvas, cam, new Starfield(950, 0x51ee7));
  ok(scene.ok, 'сцена собралась: ' + (scene.error || 'шейдеры и буферы на месте'));
  ok(state.programs === 13,
    `собрано программ: ${state.programs} (меш, звёзды, небо, запекание неба, полосы, тоннель, ` +
    'пылинки, ореол, атмосфера, кольца, плазма входа, тень, запекание поверхности)');

  const world = makeSystem(0x1a7e);
  const ship = makeShip();
  const game = {
    world, ship,
    shipMesh: buildCobra(),
    stationMesh: buildStation(),
    state: { view: 'cockpit', mode: 'flight' },
  };

  const lookAt = (from, at) => {
    cam.pos.x = from.x; cam.pos.y = from.y; cam.pos.z = from.z;
    lookAlong(cam.basis, normalize(v3(at.x - from.x, at.y - from.y, at.z - from.z)));
  };

  const frame = (label) => {
    const before = state.draws;
    scene.render(game);
    return state.draws - before;
  };

  // Кадр у станции.
  const st = world.home.station;
  placeShip(ship, v3(
    st.pos.x + st.basis.fwd.x * 3, st.pos.y + st.basis.fwd.y * 3, st.pos.z + st.basis.fwd.z * 3), null);
  lookAt(ship.pos, st.pos);
  const d1 = frame();
  ok(d1 > 0 && scene.tris > 0,
    `кадр у станции: ${d1} вызовов, ${scene.tris} треугольников`);

  // Небо (js/gl/nebula.js): шесть граней кубической карты, по одной за
  // кадр, и больше НИКОГДА. Небо не зависит ни от времени, ни от места,
  // поэтому пересчёт его в кадре — чистая потеря, которую по картинке не
  // видно вовсе: она выглядит точно так же.
  {
    for (let i = 0; i < 8; i++) scene.render(game);
    const baked = state.skyBakes;
    for (let i = 0; i < 12; i++) scene.render(game);
    ok(baked === 6 && state.skyBakes === 6 && scene.skyFace === 6,
      `небо запечено ${baked} гранями за первые кадры и больше не пересчитывается`);

    // Воздух по обе стороны верхней границы. Жалоба была: «на третьем
    // скриншоте атмосфера вообще пропала». Причина — изнутри оболочки
    // видна её ДАЛЬНЯЯ сторона, а она лежит за планетой, и буфер
    // глубины выбрасывал её над всем грунтом. Теперь веток две, и
    // проверяется главное: ровно одна из них работает на любой высоте,
    // и пустой высоты нет.
    {
      const air = world.bodies.find((b) => b.atmo);
      // Мир из одного тела: в системе их четыре с атмосферой, и дальние
      // тоже попадают в кадр — считать вызовы было бы не по чему.
      const one = { bodies: [air], star: world.star };
      const save = { x: cam.pos.x, y: cam.pos.y, z: cam.pos.z };
      const at = (alt) => {
        cam.pos.x = air.pos.x;
        cam.pos.y = air.pos.y + air.radius + alt;
        cam.pos.z = air.pos.z;
        lookAlong(cam.basis, normalize(v3(0, -1, 0)));
        const a = state.draws;
        scene.drawAir(one, world.star.pos, false);
        const outside = state.draws - a;
        const b = state.draws;
        scene.drawAir(one, world.star.pos, true);
        return { outside, inside: state.draws - b };
      };
      const hTop = air.radius * ENTRY.top;
      const above = at(hTop + 5), below = at(hTop - 5), low = at(2);
      // У самой земли и НИЖЕ средней сферы (рельеф ниже уровня моря —
      // обычное дело, у Lave II дно океана на 12 км ниже): воздух обязан
      // рисоваться и там.
      const ground = at(0.179), basin = at(-5);
      cam.pos.x = save.x; cam.pos.y = save.y; cam.pos.z = save.z;
      ok(above.outside === 1 && above.inside === 0,
        `над границей (${(hTop + 5).toFixed(0)} км) воздух рисует ближняя сторона оболочки`);
      ok(below.outside === 0 && below.inside === 1 && low.outside === 0 && low.inside === 1,
        `под границей (${(hTop - 5).toFixed(0)} км и 2 км) — дальняя, и воздух не пропадает`);
      ok(ground.inside === 1 && ground.outside === 0 && basin.inside === 1 && basin.outside === 0,
        'у самой земли (179 м) и ниже средней сферы (−5 км) воздух тоже рисуется');

      // КАКУЮ сторону оболочки отсекаем. Это стоило чёрного неба у
      // самой земли, и проверить это одним счётом вызовов нельзя:
      // отсечение делает GPU.
      //
      // Соглашение здесь обратное привычному. Камерное пространство
      // ЛЕВОЕ (+z вперёд, см. perspective в js/gl/mat4.js), проекция
      // зеркалит обход вершин, и ближняя половина сферы — обойдённая в
      // модели против часовой — на экране выходит ПО часовой, то есть
      // ЗАДНЕЙ гранью. Поэтому снаружи отсекается FRONT, изнутри BACK.
      // Считаем это прямо из матриц, а не помним наизусть.
      {
        const sp = icosphere(1);
        const cm = makeBasis();
        lookAlong(cm, { x: 0, y: 0, z: 1 });
        const mv = new Float32Array(16);
        modelView(cm, { x: 0, y: 0, z: -10 }, makeBasis(), { x: 0, y: 0, z: 0 }, 1, mv);
        const to = (i) => {
          const x = sp.positions[i * 3], y = sp.positions[i * 3 + 1], z = sp.positions[i * 3 + 2];
          const cz = mv[2] * x + mv[6] * y + mv[10] * z + mv[14];
          return {
            x: (mv[0] * x + mv[4] * y + mv[8] * z + mv[12]) / cz,
            y: (mv[1] * x + mv[5] * y + mv[9] * z + mv[13]) / cz,
            z: cz,
          };
        };
        let nearCW = 0, nearCCW = 0;
        for (let t = 0; t < sp.indices.length; t += 3) {
          const A = to(sp.indices[t]), B = to(sp.indices[t + 1]), C = to(sp.indices[t + 2]);
          if ((A.z + B.z + C.z) / 3 >= 10) continue;            // только ближняя половина
          const area = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
          if (area > 0) nearCCW++; else nearCW++;
        }
        ok(nearCCW === 0 && nearCW > 0,
          `ближняя сторона сферы проецируется ПО часовой (${nearCW} граней из ${nearCW + nearCCW}) ` +
          '— в этом движке она задняя');

        // Пол, на котором обрывается луч. Изнутри это грунт ПОД
        // КАМЕРОЙ, снаружи — средний радиус тела. По средней сфере
        // изнутри близкая земля тонула в дымке (см. ATMO_FS).
        delete state.uni.uFloor;
        delete state.uni.uGround;
        at(2);
        const inCull = state.cull;
        const floorIn = state.uni.uFloor, meanIn = state.uni.uGround;
        const realGround = altitudeOf(air, cam.pos, { dir: v3() }).groundR;
        ok(Math.abs(floorIn - realGround) < 1e-6 && Math.abs(floorIn - meanIn) > 0.01,
          `изнутри луч обрывается о грунт под камерой: ${floorIn.toFixed(3)} км против ` +
          `средних ${meanIn.toFixed(3)} (рельеф ${((floorIn - meanIn) * 1000).toFixed(0)} м)`);

        delete state.uni.uFloor;
        at(air.radius * ENTRY.top + 5);
        const outCull = state.cull;
        ok(state.uni.uFloor === air.radius,
          'снаружи полом служит средний радиус: в кадре вся полусфера сразу');
        // Камеру возвращаем: дальше идут проверки, считающие вызовы в
        // кадре, а с другой точки их число другое.
        cam.pos.x = save.x; cam.pos.y = save.y; cam.pos.z = save.z;
        ok(inCull === CONST.BACK && outCull === CONST.FRONT,
          'изнутри отсекается ближняя сторона, снаружи дальняя — то есть остаётся ровно видимая');
      }

      // ЗАПУСК внутри атмосферы — отдельный случай, а не то же самое.
      // Игра сохраняется в полёте, и после перезагрузки страницы сцена
      // начинается сразу под облаками: всё, что в обычном полёте успело
      // накопиться за предыдущие кадры, здесь отсутствует.
      {
        const camA = new Camera();
        camA.resize(1600, 900);
        camA.pos.x = air.pos.x;
        camA.pos.y = air.pos.y + air.radius + 2;
        camA.pos.z = air.pos.z;
        lookAlong(camA.basis, normalize(v3(0, -1, 0)));
        const fresh = new GlScene(canvas, camA, new Starfield(950, 0x51ee7));
        const savedCam = game.camera;
        game.camera = camA;
        // Проверяем не «drawAir умеет», а что его ЗОВЁТ обычный кадр:
        // uThick доходит до шейдера только из прохода воздуха.
        delete state.uni.uThick;
        const before = state.draws;
        fresh.render(game);
        const first = state.draws - before;
        const drawn = 'uThick' in state.uni;
        game.camera = savedCam;
        ok(first > 0 && drawn,
          `на ПЕРВОМ же кадре после перезагрузки в атмосфере воздух рисуется ` +
          `(${first} вызовов в кадре)`);
      }
    }

    // И стоит оно ровно один вызов отрисовки: выборка из готовой карты.
    const count = () => { const b = state.draws; scene.render(game); return state.draws - b; };
    const withSky = count();
    scene.skyOn = false;
    const without = count();
    scene.skyOn = true;
    ok(withSky - without === 1,
      `небо в кадре — один вызов (${without} без него, ${withSky} с ним)`);
  }

  // Вид от третьего лица: добавляется корабль и факелы двигателей.
  game.state.view = 'chase';
  ship.throttle = 0.8;
  const d2 = frame();
  ok(d2 >= d1, `вид от 3-го лица: ${d2} вызовов (свой корабль и выхлоп)`);
  game.state.view = 'cockpit';
  ship.throttle = 0;

  // Кабина (js/models/cockpit.js): рисуется только от первого лица и
  // отдельным проходом — со своей ближней плоскостью и очисткой
  // глубины. Проверяем не картинку, а то, что проход вообще идёт и что
  // от третьего лица его нет: кабина в метре от глаза, и забытая
  // очистка глубины означала бы, что её съедает ближняя плоскость сцены.
  {
    const { buildCockpit, makeYoke } = await import('../js/models/cockpit.js');
    game.cockpit = buildCockpit();
    game.yoke = makeYoke();
    game.state.view = 'cockpit';
    scene.render(game);
    const inCockpit = scene.cabinDraws;
    game.state.view = 'chase';
    scene.render(game);
    const inChase = scene.cabinDraws;
    game.state.view = 'cockpit';
    ok(inCockpit === 2 && inChase === 0,
      `кабина: ${inCockpit} вызова от первого лица (корпус и штурвал), ` +
      `${inChase} от третьего`);
  }

  // Пылинки за бортом (js/game/flow.js): то, чем в пустоте видно
  // скорость. Проверяем не картинку, а цену и повод — один вызов
  // отрисовки на кадр на форсаже и ни одного, когда корабль стоит.
  // Вся траектория считается в шейдере, буфер статический, поэтому
  // дороже этого одного вызова поток не стоит ничего.
  {
    const { makeFlow, updateFlow, FLOW } = await import('../js/game/flow.js');
    const { SHIP } = await import('../js/game/ship.js');
    game.flow = makeFlow();
    ship.vel.x = 0; ship.vel.y = 0; ship.vel.z = 0;
    updateFlow(game.flow, game, 1 / 60);
    scene.render(game);
    const still = scene.moteDraws;
    ship.vel.x = SHIP.maxSpeed * SHIP.boostMax;
    for (let i = 0; i < 4; i++) updateFlow(game.flow, game, 1 / 60);
    scene.render(game);
    const fast = scene.moteDraws;
    ok(still === 0 && fast === 1 && state.uni.uBox === FLOW.box,
      `пылинки за бортом: ${fast} вызов отрисовки на форсаже и ${still} на месте, ` +
      `решётка ${FLOW.box} км дошла до шейдера`);
    ship.vel.x = 0;
    game.flow = null;
  }

  // Подлёт к планете: уровень LOD должен расти.
  const planet = world.home;
  const levels = [];
  for (const mul of [40, 10, 4, 2, 1.2]) {
    lookAt(v3(planet.pos.x + planet.radius * mul, planet.pos.y, planet.pos.z), planet.pos);
    scene.render(game);
    levels.push(planet._glLevel);
  }
  const grows = levels.every((v, i) => i === 0 || v >= levels[i - 1]);
  ok(grows && levels[levels.length - 1] > levels[0],
    `LOD растёт при подлёте: ${levels.join(' -> ')}`);

  // Плазма входа: лишний вызов отрисовки появляется ровно тогда, когда
  // есть нагрев, и исчезает вместе с ним. Заодно это проверяет, что
  // шейдер собрался: несобранная программа уронила бы сцену выше.
  {
    // Проверяем не число вызовов (оно плавает, пока сцена догружается),
    // а сам факт: uniform нагрева доходит до шейдера ровно тогда, когда
    // нагрев есть, и с тем самым значением.
    delete state.uni.uHeat;
    scene.render(game);
    const coldSeen = 'uHeat' in state.uni;
    game.entry = {
      heat: 0.8, color: [1, 0.6, 0.2], dir: { x: 0, y: 0, z: 1 },
      alt: 12, rho: 0.4, speed: 1.1, body: planet,
    };
    const before = state.draws;
    scene.render(game);
    const drew = state.draws - before;
    const hotSeen = state.uni.uHeat;
    game.entry = null;
    ok(!coldSeen && hotSeen === 0.8 && drew > 0,
      `плазма входа: без нагрева шейдер не зовётся, с нагревом uHeat=${hotSeen} ` +
      `(${drew} вызовов в кадре)`);
  }

  // Квантовый прыжок: тоннель и полосы звёзд.
  //
  // Проверяется не картинка (её отсюда не видно), а то, от чего она
  // зависит: сила эффекта, ось движения и ТОЧКА СХОДА. Последнее
  // важнее всего — тоннель обязан стоять там, куда корабль летит, а не
  // в центре кадра: в виде от третьего лица камеру можно отвернуть.
  {
    const q = { phase: 'jump', speed: 60000, dist: 1e6, target: planet, flash: 0, punch: 0 };
    game.quantum = q;
    lookAt(v3(planet.pos.x + planet.radius * 40, planet.pos.y, planet.pos.z), planet.pos);
    // Скорость — точно по взгляду.
    const b = cam.basis;
    ship.vel.x = b.fwd.x * 60000; ship.vel.y = b.fwd.y * 60000; ship.vel.z = b.fwd.z * 60000;
    ship.pos.x = cam.pos.x; ship.pos.y = cam.pos.y; ship.pos.z = cam.pos.z;
    const base = state.draws;
    scene.render(game);
    const drewJump = state.draws - base;
    const j = scene.jump;
    ok(j.power > 0.9 && Math.abs(j.cx) < 0.02 && Math.abs(j.cy) < 0.02,
      `прыжок: сила ${j.power.toFixed(2)}, точка схода в центре ` +
      `(${j.cx.toFixed(3)}, ${j.cy.toFixed(3)}), ${drewJump} вызовов`);

    // Отворачиваем камеру — точка схода обязана уехать вбок вслед за
    // вектором скорости, а не остаться в прицеле.
    const side = normalize(v3(b.fwd.x + b.right.x * 0.35, b.fwd.y + b.right.y * 0.35,
      b.fwd.z + b.right.z * 0.35));
    lookAlong(cam.basis, side);
    scene.render(game);
    ok(scene.jump.cx < -0.2,
      `камера отвёрнута: точка схода ушла в сторону (${scene.jump.cx.toFixed(2)})`);

    // Фаза потока частиц берётся из состояния привода, а не из часов:
    // иначе картинка зависела бы от частоты кадров.
    q.warp = 0.42;
    scene.render(game);
    ok(scene.jump.phase === 0.42, `фаза потока пришла из привода: ${scene.jump.phase}`);

    // На торможении эффект гаснет вместе со скоростью.
    q.speed = 300;
    scene.render(game);
    const slow = scene.jump.power;
    game.quantum = null;
    scene.render(game);
    ok(slow < 0.3 && scene.jump.power === 0,
      `эффект гаснет со скоростью: на 300 км/с ${slow.toFixed(2)}, вне прыжка 0`);
    ship.vel.x = ship.vel.y = ship.vel.z = 0;
  }

  // Газовый гигант с кольцами и атмосферой.
  const gas = world.planets.find((p) => p.kind === 'gas');
  lookAt(v3(gas.pos.x + gas.radius * 4, gas.pos.y + gas.radius, gas.pos.z), gas.pos);
  const d3 = frame();
  ok(d3 > 0 && gas._ringMesh, `газовый гигант: ${d3} вызовов, кольца построены`);

  // Крайние случаи: внутри планеты, взгляд от планеты, вплотную к солнцу.
  lookAt(v3(planet.pos.x, planet.pos.y, planet.pos.z), v3(0, 0, 0));
  frame();
  lookAt(v3(planet.pos.x + planet.radius * 3, planet.pos.y, planet.pos.z),
    v3(planet.pos.x + planet.radius * 9, planet.pos.y, planet.pos.z));
  frame();
  lookAt(v3(world.star.pos.x + world.star.radius * 1.1, 0, 0), world.star.pos);
  frame();
  ok(true, 'крайние случаи (внутри планеты, взгляд наружу, у светила) не падают');

  // Поверхность плитками: главное свойство — плитка привязана к телу,
  // поэтому при движении камеры не пересчитывается ничего.
  const { localDir, groundRadius, worldPoint } = await import('../js/game/surface.js');
  const { buildGear } = await import('../js/models/ships.js');
  const moon = world.bodies.find((b) => b.kind === 'moon');
  const dirL = normalize(v3(0.3, 0.7, 0.6));
  const gr = groundRadius(moon, dirL);
  const sideL = normalize(v3(dirL.x + 0.02, dirL.y, dirL.z - 0.02));
  const ahead = worldPoint(moon, sideL, gr, v3());
  const put = (alt) => {
    const e = worldPoint(moon, dirL, gr + alt, v3());
    placeShip(ship, e, null);
    lookAt(e, ahead);
  };
  game.gearMesh = buildGear();
  game.state.view = 'chase';
  ship.gear = { t: 1, out: true };

  {
    // Корни: шесть граней куба — это и есть «вся поверхность тела».
    // Пока они не готовы, тело рисуется обычной сферой.
    put(4000);
    let frames = 0;
    while (!scene.tiles.rootsReady && frames++ < 200) scene.render(game);
    ok(scene.tiles.rootsReady && frames < 200,
      `шесть корневых плиток собраны за ${frames} кадров и держатся в кэше`);
    ok(scene.tileBody === moon, 'дальше тело рисуется плитками, а не сферой');

    const bakes0 = state.bakes, mips0 = state.mipmaps, built0 = scene.tiles.built;
    put(0.05);
    // Ждём, пока набор ДОСТРОИТСЯ, а не «триста кадров и хватит».
    // Фиксированное число кадров и было причиной плавающей проверки
    // ниже: сборка ещё шла, а зависание уже засчитывало её плитки себе.
    // Заодно это мера того, за сколько кадров поверхность выходит на
    // детализацию с холодного кэша, — и её полезно держать под глазом.
    let load = 0;
    while (load++ < 900) {
      scene.render(game);
      if (scene.tiles.stats.pending === 0 && load > 3) break;
    }
    ok(load < 900,
      `с холодного кэша поверхность выходит на детализацию за ${load} кадров ` +
      `(${(load / 60).toFixed(1)} с при 60 к/с), собрано ${scene.tiles.built - built0} плиток`);
    const st = scene.tiles.stats;
    ok(st.drawn > 8 && scene.tris > 5000,
      `кадр у поверхности: плиток нарисовано ${st.drawn}, треугольников ` +
      `${scene.tris}, в кэше ${st.tiles}`);
    const dBake = state.bakes - bakes0, dBuilt = st.built - built0;
    ok(dBake === dBuilt && state.mipmaps > mips0,
      `каждая плитка запекается ровно один раз: ${dBake} проходов на ` +
      `${dBuilt} собранных плиток, мипы строятся`);

    // Мелкая деталь на плитке: шейдер должен получить угловой размер
    // текселя. Забыть этот uniform — значит либо не увидеть у земли
    // ничего мельче текселя, либо посчитать рельеф дважды; и то и
    // другое видно только глазами, поэтому проверяется здесь.
    {
      let deepest = 0, shallow = 99;
      for (const t of scene.tiles.draw) {
        deepest = Math.max(deepest, t.level);
        shallow = Math.min(shallow, t.level);
      }
      // Ноль приходит с плиток без рельефа и с остальной сцены, поэтому
      // минимум берём среди положительных.
      const lo = tileTexelAngle(deepest), hi = tileTexelAngle(shallow);
      const seen = state.uni.uBakeFw;
      ok(seen >= hi * 0.999 && state.uniMin.uBakeFw === 0 && deepest > shallow,
        `шейдеру передан тексель каждой плитки: от ${(lo * moon.radius * 1000).toFixed(1)} м ` +
        `(уровень ${deepest}) до ${(seen * moon.radius * 1000 / 1000).toFixed(1)} км`);
    }

    // Множитель следа пикселя обязан доходить до шейдера на каждом
    // кадре и не выходить из [1, FW_MAX]: нуль обнулил бы след (на него
    // делится появление деталей), а значение ниже единицы означало бы,
    // что регулятор просит деталь МЕЛЬЧЕ пикселя — работу, которой не
    // видно.
    // Значения берём с запасным нулём: если uniform не передан вовсе,
    // проверка обязана сказать это внятно, а не упасть на toFixed.
    const fwLo = state.uniMin.uFwScale ?? 0, fwHi = state.uni.uFwScale ?? 0;
    ok(fwLo >= 1 && fwHi <= FW_MAX,
      `шейдер получает множитель следа: от ×${fwLo.toFixed(2)} до ×${fwHi.toFixed(2)}`);
    // Мок расширения таймера не отдаёт — это штатный путь, и на нём
    // регулятор ведётся по длительности кадра. Кадры в проверке идут
    // подряд и быстро, значит деталь должна остаться полной.
    ok(!scene.gpuTimer.available && scene.gpuTimer.ms === 0 && scene.fwScale === 1,
      'без таймера карты кадр считается по длительности, деталь остаётся полной');

    // Ни одной дырки: всё, что выбрано к отрисовке, готово.
    let holes = 0;
    for (const t of scene.tiles.draw) {
      const e = scene.tiles.get(`${t.face}/${t.level}/${t.tx}/${t.ty}`);
      if (!e || !e.mesh) holes++;
    }
    ok(holes === 0, `в списке отрисовки нет незаготовленных плиток (${holes})`);

    // Зависание: ничего не строится. Это то, чего принципиально не могли
    // заплатки — они центрированы на камере и пересобирались от любого
    // дрожания высоты.
    {
      const before = scene.tiles.built;
      for (let i = 0; i < 120; i++) {
        put(0.05 * (1 + 0.03 * Math.sin(i * 1.7)));
        scene.render(game);
      }
      ok(scene.tiles.built === before,
        `120 кадров зависания: новых плиток собрано ${scene.tiles.built - before}`);
    }

    // Спуск, подъём и повторный спуск: второй раз всё берётся из кэша.
    {
      const dive = () => {
        for (let i = 0; i < 60; i++) {
          put(20 * Math.pow(0.05 / 20, i / 59));
          scene.render(game);
        }
      };
      const climb = () => {
        for (let i = 0; i < 60; i++) {
          put(0.05 * Math.pow(20 / 0.05, i / 59));
          scene.render(game);
        }
      };
      // Первый спуск — с ожиданием: на каждой высоте даём очереди
      // опустеть, иначе сравнивать не с чем (за 60 кадров набор у
      // поверхности всё равно не успевает собраться).
      const first0 = scene.tiles.built;
      for (let i = 0; i < 30; i++) {
        put(20 * Math.pow(0.05 / 20, i / 29));
        for (let k = 0; k < 60; k++) {
          scene.render(game);
          if (!scene.tiles.stats.pending) break;
        }
      }
      const first = scene.tiles.built - first0;
      climb();
      const before = scene.tiles.built;
      dive();
      const again = scene.tiles.built - before;
      // Единицы плиток тут — не пересборка, а следствие того, что допуск
      // на геометрию подстраивается под число плиток в кадре: на втором
      // проходе он чуть другой, и у самой границы набор отличается на
      // пару плиток. Пересборка кэша выглядела бы как десятки.
      ok(again < 10 && again < first * 0.2,
        `повторный спуск по тому же месту почти ничего не строит заново: ` +
        `${again} плиток против ${first} на первом проходе`);
    }

    // Камни у поверхности: то, по чему глаз меряет высоту. Поле должно
    // появляться у земли, исчезать с высоты и не пересобираться на
    // каждом кадре — иначе оно стоило бы дороже всего остального.
    {
      put(0.02);
      for (let i = 0; i < 40; i++) scene.render(game);
      const near = scene.rocks.count;
      const nearMesh = !!scene.rocks.mesh;
      const drawn = scene.rockDraws;
      const builds0 = scene.rocks.builds;
      for (let i = 0; i < 60; i++) scene.render(game);
      const idle = scene.rocks.builds - builds0;
      put(3);
      for (let i = 0; i < 5; i++) scene.render(game);
      ok(nearMesh && near > 40 && idle === 0 && !scene.rocks.mesh && drawn === 1,
        `камни у грунта: ${near} штук в поле, нарисованы (${drawn} вызов), стоя на месте ` +
        `не пересобираются (${idle} сборок за 60 кадров), с трёх километров поля нет`);
    }

    // ТО, ЧТО БЫЛО СЛОМАНО: игра, ЗАПУЩЕННАЯ у самой земли.
    //
    // При спуске с орбиты поверхность доходит до полной детализации, а
    // при перезагрузке страницы в двухстах метрах над грунтом — нет:
    // плитки замирали на грубом уровне, треугольники переставали
    // расти. Разница между двумя случаями только одна — с холодного
    // кэша у земли набор строится весь разом, и регулятор допуска
    // успевает уйти в потолок раньше, чем набор достроится.
    //
    // Проверяем не «допуск такой-то», а исход: с какого уровня
    // детализации кадр в одной и той же точке.
    {
      const deepestOf = (sc) => {
        let d = 0;
        for (const t of sc.tiles.draw) d = Math.max(d, t.level);
        return d;
      };
      put(0.2);
      let warm = 0;
      while (warm++ < 900) {
        scene.render(game);
        if (scene.tiles.stats.pending === 0 && warm > 3) break;
      }
      const warmLevel = deepestOf(scene);
      const warmTris = scene.tris;

      const camC = new Camera();
      camC.resize(1600, 900);
      const cold = new GlScene(canvas, camC, new Starfield(950, 0x51ee7));
      const e = worldPoint(moon, dirL, gr + 0.2, v3());
      camC.pos.x = e.x; camC.pos.y = e.y; camC.pos.z = e.z;
      camC.basis.right = { ...cam.basis.right };
      camC.basis.up = { ...cam.basis.up };
      camC.basis.fwd = { ...cam.basis.fwd };
      const savedCam = game.camera;
      game.camera = camC;
      let cf = 0;
      while (cf++ < 1500) {
        cold.render(game);
        if (cold.tiles.stats.pending === 0 && cf > 30) break;
      }
      const coldLevel = deepestOf(cold);
      const coldTris = cold.tris;
      game.camera = savedCam;

      ok(coldLevel >= warmLevel - 1 && coldTris > warmTris * 0.5,
        `запуск у самой земли доходит до той же детализации, что и спуск с орбиты: ` +
        `уровень ${coldLevel} против ${warmLevel}, треугольников ${coldTris} против ${warmTris} ` +
        `(допуск ×${cold.tiles.tolScale.toFixed(1)} против ×${scene.tiles.tolScale.toFixed(1)})`);
    }

    // Сборка в рабочих потоках. Настоящий Worker в node недоступен, но
    // его код — обычная функция (js/gl/tileworker.js: runJob), и её
    // можно подсунуть заглушке. Тогда через пул проходит ровно тот же
    // путь, что и в браузере: задание -> буферы -> перенос -> загрузка
    // в GL. Без этой проверки весь путь существовал бы только на словах.
    {
      const { runJob } = await import('../js/gl/tileworker.js');
      const pending = [];
      let jobs = 0;
      class FakeWorker {
        constructor() { this.onmessage = null; this.onerror = null; }
        postMessage(msg) {
          jobs++;
          // Как настоящий: ответ приходит не сразу, а позже.
          pending.push(() => { if (this.onmessage) this.onmessage({ data: runJob(msg) }); });
        }
        terminate() {}
      }
      globalThis.Worker = FakeWorker;

      const cam2 = new Camera();
      cam2.resize(1600, 900);
      const scene2 = new GlScene(canvas, cam2, new Starfield(950, 0x51ee7));
      const cores = (globalThis.navigator && navigator.hardwareConcurrency) || 4;
      const wantWorkers = Math.max(1, Math.min(3, cores - 1));
      ok(scene2.tiles.pool.ok && scene2.tiles.pool.workers.length === wantWorkers,
        `пул поднялся: потоков ${scene2.tiles.pool.workers.length} при ${cores} ядрах ` +
        `(на одно меньше, но не больше трёх)`);

      // Кадр + доставка ответов: столько раз, сколько нужно до сходимости.
      const step = () => {
        scene2.render(game);
        const q = pending.splice(0, pending.length);
        for (const f of q) f();
      };
      const savedCam = game.camera;
      const pos = worldPoint(moon, dirL, gr + 0.05, v3());
      placeShip(ship, pos, null);
      lookAt(pos, ahead);
      cam2.pos.x = pos.x; cam2.pos.y = pos.y; cam2.pos.z = pos.z;
      cam2.basis.right = { ...cam.basis.right };
      cam2.basis.up = { ...cam.basis.up };
      cam2.basis.fwd = { ...cam.basis.fwd };

      let frames = 0;
      while (frames++ < 900) {
        step();
        if (scene2.tiles.stats.pending === 0 && frames > 5) break;
      }
      game.camera = savedCam;

      // Разница в единицы плиток — это задания, ответ на которые ещё в
      // пути на момент замера: главный поток геометрию не считает вовсе.
      ok(jobs > 100 && scene2.tiles.built > jobs - 8 && scene2.tiles.built <= jobs,
        `геометрия посчитана потоками: заданий ${jobs}, собранных плиток ` +
        `${scene2.tiles.built} (в кадре не посчитано ни одной)`);
      ok(frames < 900 && scene2.tiles.draw.length > 8,
        `через пул поверхность сходится за ${frames} кадров, в кадре ` +
        `${scene2.tiles.draw.length} плиток`);

      let holes = 0;
      for (const t of scene2.tiles.draw) {
        const e = scene2.tiles.get(`${t.face}/${t.level}/${t.tx}/${t.ty}`);
        if (!e || !e.mesh) holes++;
      }
      ok(holes === 0, `в наборе из потоков нет незаготовленных плиток (${holes})`);

      // Геометрия из потока обязана совпасть с посчитанной в кадре до
      // бита: иначе рельеф зависел бы от того, где его считали.
      const { tileBuilder } = await import('../js/gl/tilegeo.js');
      const spec = { kind: moon.kind, name: moon.name, id: moon.id };
      const t = { face: 2, level: 9, tx: 271, ty: 300 };
      const b = tileBuilder({ ...spec }, t);
      while (!b.step(1e9)) { /* целиком */ }
      const direct = b.result;
      const viaWorker = runJob({ id: 1, key: 'k', spec, t });
      const same = new Float32Array(viaWorker.geo.positions);
      let diff = 0;
      for (let i = 0; i < direct.positions.length; i++) {
        if (direct.positions[i] !== same[i]) diff++;
      }
      ok(diff === 0 && viaWorker.geo.faces === direct.faces,
        `поток и кадр дают одну и ту же геометрию: ${direct.positions.length / 3} вершин, ` +
        `${direct.faces} граней, расхождений ${diff}`);

      scene2.tiles.pool.dispose();
      delete globalThis.Worker;
    }

    // Тень корабля: силуэт считается на CPU (js/game/shadow.js), а
    // сцена обязана его залить в буфер и нарисовать. Проверяем всю
    // цепочку: обстановка у поверхности -> силуэт -> вершины в буфере.
    {
      const { landingContext } = await import('../js/game/landing.js');
      put(0.12);
      game.zone = landingContext(world, ship);
      // Солнце над головой: тень ложится прямо под корабль.
      const up = normalize(v3(
        ship.pos.x - moon.pos.x, ship.pos.y - moon.pos.y, ship.pos.z - moon.pos.z));
      const overhead = v3(
        moon.pos.x + up.x * 1e6, moon.pos.y + up.y * 1e6, moon.pos.z + up.z * 1e6);
      const saveStar = world.star.pos;
      world.star.pos = overhead;
      scene.render(game);
      const lit = scene.shadowMesh.count;
      world.star.pos = saveStar;

      // Солнце за горизонтом и большая высота — тени нет вовсе.
      const { shipShadow, SHADOW_MAX_ALT } = await import('../js/game/shadow.js');
      const below = v3(
        moon.pos.x - up.x * 1e6, moon.pos.y - up.y * 1e6, moon.pos.z - up.z * 1e6);
      const night = shipShadow(game.zone, ship, game.shipMesh, below, {});
      put(SHADOW_MAX_ALT * 2);
      const highZone = landingContext(world, ship);
      const high = shipShadow(highZone, ship, game.shipMesh, overhead, {});
      game.zone = null;
      ok(lit >= 3 && night === 0 && high === 0,
        `тень корабля: ${lit} вершин силуэта при солнце над головой, ` +
        `ночью ${night}, с ${SHADOW_MAX_ALT * 2} км — ${high}`);
    }

    // Сходимость подгрузки с холодного кэша: сколько кадров проходит,
    // пока под кораблём не окажется плитка с текселем мельче 20 м.
    // Пока её нет, рисуется грубый предок, и вся мелкая деталь висит на
    // шейдере — картинка правильная, но рельеф под кораблём плоский.
    {
      scene.tiles.clear();
      put(0.25);
      let frames = 0, best = 0;
      while (frames++ < 900) {
        scene.render(game);
        for (const t of scene.tiles.draw) best = Math.max(best, t.level);
        if (tileTexelAngle(best) * moon.radius < 0.02) break;
      }
      const texelM = tileTexelAngle(best) * moon.radius * 1000;
      ok(frames < 900,
        `с 250 м подробная плитка (тексель ${texelM.toFixed(1)} м, уровень ${best}) ` +
        `подгружается за ${frames} кадров`);
    }

    // Висение над вращающимся телом: грунт уезжает под кораблём со
    // скоростью вращения (у луны это сотня-полторы метров в секунду), и
    // плитки подгружаются НЕПРЕРЫВНО. Меряем, насколько набор отстаёт
    // от идеального: уровень плитки под кораблём против того, который
    // выбрался бы, будь всё уже собрано.
    {
      const { selectTiles: sel, tileTexelAngle: tta, tileCellAngle: tca, TILE_MAX_LEVEL: TML } =
        await import('../js/gl/quadtree.js');
      const { TILE_TEXEL_TOL: TTT } = await import('../js/gl/tiles.js');
      const { terrainOf: terrOf } = await import('../js/gl/terrain.js');
      const tt = terrOf(moon);
      const alt = 0.687;
      const speed = 0.146;                 // км/с — вращение поверхности
      let worstLag = 0, sumLag = 0, n = 0;
      for (let f = 0; f < 240; f++) {
        const a = (f / 60) * speed / moon.radius;   // угол сноса за кадр
        const d = normalize(v3(dirL.x + a * 0.7, dirL.y, dirL.z - a * 0.7));
        const e = worldPoint(moon, d, groundRadius(moon, d) + alt, v3());
        placeShip(ship, e, null);
        lookAt(e, worldPoint(moon, normalize(v3(d.x + 0.02, d.y, d.z - 0.02)), groundRadius(moon, d), v3()));
        scene.render(game);
        if (f < 60) continue;              // первую секунду не считаем
        // идеальный набор при полностью собранном кэше
        const camDir = localDir(moon, scene.camera.pos, v3());
        const ideal = sel({
          radius: moon.radius, camDir, camAlt: alt, focal: scene.camera.focal,
          tol: 5 * scene.tiles.tolScale, texelTol: TTT, maxLevel: TML, relief: tt.ampUp,
          errorOf: (lv) => tt.meshError(tt.detailForCell(tca(lv))) + tca(lv) ** 2 / 8,
          texelOf: (lv) => tta(lv), ready: () => true, want: () => {},
        }, []);
        const deepest = (list) => { let m = 0; for (const q of list) m = Math.max(m, q.level); return m; };
        const lag = deepest(ideal) - deepest(scene.tiles.draw);
        worstLag = Math.max(worstLag, lag);
        sumLag += lag; n++;
      }
      ok(worstLag <= 1,
        `висение над вращающимся телом: набор отстаёт от идеального на ` +
        `${(sumLag / n).toFixed(1)} уровня в среднем, худший случай ${worstLag}`);
    }

    // Кэш не растёт бесконечно: облёт тела вытесняет далёкие плитки.
    {
      const { TILE_BUDGET } = await import('../js/gl/tiles.js');
      for (let k = 0; k < 40; k++) {
        const a = k * 0.157;
        const d = normalize(v3(Math.cos(a) * 0.6, 0.5 + 0.3 * Math.sin(a * 0.7), Math.sin(a) * 0.6));
        const r = groundRadius(moon, d);
        const e = worldPoint(moon, d, r + 2, v3());
        placeShip(ship, e, null);
        lookAt(e, moon.pos);
        for (let i = 0; i < 12; i++) scene.render(game);
      }
      const st2 = scene.tiles.stats;
      ok(st2.tiles <= TILE_BUDGET + 8,
        `после облёта тела в кэше ${st2.tiles} плиток (предел ${TILE_BUDGET}), ` +
        `вытеснено ${st2.evicted}, освобождено текстур ${state.texturesFreed}`);
    }

    // Уход от тела освобождает кэш целиком.
    placeShip(ship, v3(world.star.pos.x, world.star.pos.y + world.star.radius * 3, world.star.pos.z), null);
    lookAt(ship.pos, world.star.pos);
    scene.render(game);
    ok(scene.tileBody === null && scene.tiles.tiles.size === 0,
      'при уходе от тела кэш плиток освобождается');
    game.state.view = 'cockpit';
  }

  // Прежний путь — заплатки под кораблём с процедурной деталью на
  // пиксель — остаётся по `?surface=clipmap`: он и запасной, и эталон
  // для сравнения картинки.
  {
    globalThis.location = { search: '?surface=clipmap' };
    const scene2 = new GlScene(canvas, cam, new Starfield(950, 0x51ee7));
    ok(scene2.ok && !scene2.tilesOn, 'сцена с заплатками (?surface=clipmap) собирается');

    put(0.05);
    const before = state.stencils;
    let levels = 0;
    for (let i = 0; i < 40; i++) {
      scene2.render(game);
      levels = Math.max(levels, scene2.patch.levels);
    }
    ok(levels >= 4 && state.stencils > before,
      `заплатки: ${levels} уровней, трафарет выставляется ` +
      `(${state.stencils - before} вызовов)`);

    // Регрессия, из-за которой рельеф «менялся на глазах»: число уровней
    // округлялось вверх, и на границе округления набор пересобирался
    // каждый кадр. Высоты ищем именно на границах.
    const edges = [];
    for (let k = 0; k < 2000 && edges.length < 4; k++) {
      const alt = 0.05 * Math.pow(20 / 0.05, k / 1999);
      const a = patchPlan(moon, alt * 0.98, 6), b = patchPlan(moon, alt * 1.02, 6);
      if (a && b && a.levels !== b.levels) edges.push(alt);
    }
    let worstN = 0;
    for (const alt of edges.concat([0.06, 0.5, 4])) {
      for (let i = 0; i < 20; i++) { put(alt * (1 + 0.03 * Math.sin(i * 1.7))); scene2.render(game); }
      const b0 = scene2.patch.rebuilds;
      for (let i = 0; i < 12; i++) { put(alt * (1 + 0.03 * Math.sin(i * 1.7))); scene2.render(game); }
      worstN = Math.max(worstN, scene2.patch.rebuilds - b0);
    }
    ok(worstN === 0 && edges.length > 0,
      `заплатки: зависание на ${edges.length + 3} высотах не пересобирает набор`);
    globalThis.location = undefined;
  }

  ok(state.nan === 0,
    `ни в одном uniform или буфере нет NaN (проверено ${state.buffers} буферов)` +
    (state.nan ? ' — ' + state.nanWhere.slice(0, 5).join(', ') : ''));
}

console.log('\n' + (fails === 0 ? 'GL: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : fails + ' ПРОВЕРОК УПАЛО'));
process.exit(fails ? 1 : 0);
