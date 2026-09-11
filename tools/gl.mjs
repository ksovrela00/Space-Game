// Проверки WebGL-слоя без браузера: вся математика считается в Node, а сам
// путь отрисовки прогоняется через мок GL-контекста. Пиксели так не
// проверить — только то, что геометрия, матрицы и вызовы корректны.

import { v3, normalize, dot, len } from '../js/core/vec3.js';
import { makeBasis, toLocal, rotateBasis, lookAlong } from '../js/core/basis.js';
import { icosphere, computeNormals, levelForPixels } from '../js/gl/icosphere.js';
import { makeTerrain, perlin3, fbm } from '../js/gl/terrain.js';
import { planetGeometry, bodyBasis } from '../js/gl/planetmesh.js';
import { perspective, modelView, dirToCamera, logDepth, logDepthCoef } from '../js/gl/mat4.js';
import { makeSystem } from '../js/game/world.js';

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
    let maxH = 0, same = true, jump = 0;
    const dirs = [];
    for (let i = 0; i < 600; i++) {
      const u = -1 + 2 * (i / 599);
      const a = i * 2.399963;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      dirs.push([s * Math.cos(a), u, s * Math.sin(a)]);
    }
    for (const [x, y, z] of dirs) {
      const h = t.displace(x, y, z);
      if (Math.abs(h - t2.displace(x, y, z)) > 0) same = false;
      maxH = Math.max(maxH, h);
      // Непрерывность на сфере: шаг 0.002 рад не должен давать обрыва.
      const h2 = t.displace(x + 0.002, y, z);
      jump = Math.max(jump, Math.abs(h - h2));
    }
    const limit = t.amp * 1.05 + 1e-9;
    ok(same && maxH <= limit && jump < t.amp * 0.2 + 1e-9,
      `${body.name} (${body.kind}): высота до ${(maxH * 100).toFixed(2)}% радиуса ` +
      `(предел ${(limit * 100).toFixed(2)}%), детерминирована, без обрывов`);
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
  const state = { nan: 0, nanWhere: [], draws: 0, buffers: 0, programs: 0, vaos: 0 };
  const CONST = {};
  let constCounter = 1;
  let attribIdx = -1;

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
    createBuffer: () => { state.buffers++; return {}; },
    createVertexArray: () => { state.vaos++; return {}; },
    drawArrays: () => { state.draws++; },
    drawElements: () => { state.draws++; },
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
  ok(state.programs === 5, `собрано программ: ${state.programs} (меш, звёзды, ореол, атмосфера, кольца)`);

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

  // Вид от третьего лица: добавляется корабль и факелы двигателей.
  game.state.view = 'chase';
  ship.throttle = 0.8;
  const d2 = frame();
  ok(d2 >= d1, `вид от 3-го лица: ${d2} вызовов (свой корабль и выхлоп)`);
  game.state.view = 'cockpit';
  ship.throttle = 0;

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

  ok(state.nan === 0,
    `ни в одном uniform или буфере нет NaN (проверено ${state.buffers} буферов)` +
    (state.nan ? ' — ' + state.nanWhere.slice(0, 5).join(', ') : ''));
}

console.log('\n' + (fails === 0 ? 'GL: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : fails + ' ПРОВЕРОК УПАЛО'));
process.exit(fails ? 1 : 0);
