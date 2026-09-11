// Headless-проверка игровой логики: мир, полёт, автопилот, стыковка.
import { v3, normalize, dot, len } from '../js/core/vec3.js';
import { makeBasis, rotateBasis } from '../js/core/basis.js';
import { makeSystem, updateWorld, nearestBody } from '../js/game/world.js';
import { makeShip, updateShip, placeShip, clearControls, SHIP } from '../js/game/ship.js';
import { makeCruise, updateCruise } from '../js/game/cruise.js';
import { makeNav, startAutopilot, updateAutopilot, currentTarget } from '../js/game/nav.js';
import { checkStation, startDockingComputer, updateDockingComputer, dockingQuality } from '../js/game/docking.js';
import { alignBasis, horizontal } from '../js/game/pilot.js';
import {
  isLandable, groundRadius, altitudeOf, surfaceNormal, slopeAt, findSite,
  worldPoint, surfaceVelocity,
} from '../js/game/surface.js';
import {
  toggleGear, updateGear, gearReady, landingContext, syncVtol, manualHover,
  startLanding, updateLandingComputer, checkTouchdown, settle, updateLandedPose,
  takeoff, landingReadout,
} from '../js/game/landing.js';
import { STATION_D } from '../js/models/station.js';
import { buildCobra } from '../js/models/ships.js';
import { buildStation } from '../js/models/station.js';
import { Camera } from '../js/render/camera.js';
import { Renderer } from '../js/render/renderer.js';
import { drawBody, sunGeometry } from '../js/render/planetview.js';
import { copy } from '../js/core/vec3.js';
import { lookAlong } from '../js/core/basis.js';
import { box, prismZ, loft } from '../js/models/geometry.js';

const STEP = 1 / 60;
let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + msg + (extra ? '  [' + extra + ']' : ''));
};

// --- 1. Мир -----------------------------------------------------------------
console.log('\n== мир ==');
const world = makeSystem(0x1a7e);
updateWorld(world, 1);
ok(world.planets.length === 6, 'планет: ' + world.planets.length);
ok(world.stations.length === 3, 'станций: ' + world.stations.length);
for (const p of world.planets) {
  const v = len(p.vel);
  ok(v < SHIP.maxSpeed * 0.35, `${p.name}: орбитальная скорость ${v.toFixed(3)} км/с < ${(SHIP.maxSpeed * 0.35).toFixed(2)}`);
}
for (const s of world.stations) {
  const v = len(s.vel);
  ok(v < SHIP.maxSpeed * 0.3, `${s.name}: скорость ${v.toFixed(3)} км/с`);
  const f = s.basis.fwd, r = s.basis.right, u = s.basis.up;
  ok(Math.abs(dot(f, r)) < 1e-9 && Math.abs(dot(f, u)) < 1e-9 && Math.abs(len(f) - 1) < 1e-9,
    `${s.name}: базис ортонормирован`);
}
{
  let worst = 0;
  for (let i = 0; i < 4000; i++) {
    updateWorld(world, 0.5);
    for (const s2 of world.stations) {
      const { right: r2, up: u2, fwd: f2 } = s2.basis;
      worst = Math.max(worst,
        Math.abs(dot(r2, f2)), Math.abs(dot(r2, u2)), Math.abs(dot(u2, f2)),
        Math.abs(len(r2) - 1), Math.abs(len(u2) - 1), Math.abs(len(f2) - 1));
    }
  }
  ok(worst < 1e-9, `базис станций ортонормирован на всём обороте (макс. ошибка ${worst.toExponential(1)})`);
}

const gas = world.planets.find((p) => p.kind === 'gas');
ok(gas.moons.length === 2 && !!gas.rings, 'газовый гигант: кольца и 2 луны');
ok(world.planets.every((p) => p.features.length > 0), 'у всех планет есть поверхностные пятна');

// --- 2. Модели --------------------------------------------------------------
console.log('\n== модели ==');
const cobra = buildCobra();
const stationMesh = buildStation();
ok(cobra.faces.length > 10, `корабль: ${cobra.verts.length} вершин, ${cobra.faces.length} граней`);
ok(stationMesh.faces.length > 20, `станция: ${stationMesh.verts.length} вершин, ${stationMesh.faces.length} граней`);
// Нормали должны смотреть наружу от центра ДЕТАЛИ; у составной модели
// (корпус + фонарь + сопла + киль) центр каждой детали свой, поэтому
// проверяем примитивы, из которых она собрана.
const outwardCheck = (mesh, center = { x: 0, y: 0, z: 0 }) => {
  let good = 0;
  for (const f of mesh.faces) {
    const k = f.v.length;
    let gx = 0, gy = 0, gz = 0;
    for (const i of f.v) { gx += mesh.verts[i].x; gy += mesh.verts[i].y; gz += mesh.verts[i].z; }
    if ((gx / k - center.x) * f.n.x + (gy / k - center.y) * f.n.y + (gz / k - center.z) * f.n.z >= 0) good++;
  }
  return good + '/' + mesh.faces.length;
};
const bx = box(1, 2, 3, [1, 2, 3]);
const pz = prismZ(8, 1, 0.5, [1, 2, 3], [4, 5, 6], Math.PI / 8);
const lf = loft(
  [{ x: 0, z: 1 }, { x: 1, z: -1 }, { x: -1, z: -1 }],
  [0.2, 0.4, 0.4], [-0.1, -0.3, -0.3], [1, 1, 1], [2, 2, 2], [3, 3, 3]);
ok(outwardCheck(bx) === '6/6', 'box: нормали наружу ' + outwardCheck(bx));
ok(outwardCheck(pz) === '10/10', 'prismZ: нормали наружу ' + outwardCheck(pz));
ok(outwardCheck(lf) === '5/5', 'loft: нормали наружу ' + outwardCheck(lf));
ok(stationMesh.faces.some((f) => f.emissive), 'у станции есть светящиеся огни порта');

// --- 2b. Силуэт шара в перспективе -----------------------------------------
// Проверяем аналитический эллипс перебором: проецируем настоящую линию
// силуэта шара и смотрим, ложится ли она на эллипс, а видимая поверхность —
// внутрь него. Именно здесь раньше был баг: рисовался круг постоянного
// радиуса, и планета «дышала» при развороте корабля.
console.log('== силуэт шара ==');
{
  const cam = new Camera();
  cam.resize(1600, 900);
  // Камера в начале координат с единичным базисом: мир == координаты камеры.

  const check = (label, cx, cy, cz, R) => {
    const c = v3(cx, cy, cz);
    const sil = cam.silhouette(c, R);
    if (!sil.ok) { ok(false, `${label}: силуэт не посчитался (covers=${sil.covers})`); return; }

    const d = Math.hypot(cx, cy, cz);
    const u = normalize(v3(cx, cy, cz));
    // Плоскость касания: на R²/d ближе центра, радиус R·cosα
    const k = Math.sqrt(1 - (R / d) * (R / d));
    const ringC = v3(cx - u.x * R * R / d, cy - u.y * R * R / d, cz - u.z * R * R / d);
    const e1 = normalize(Math.abs(u.y) < 0.9
      ? v3(u.z * 0 - 0 * u.y, 0 * u.x - u.z * 1, u.y * 1 - 0 * u.x)   // u × (0,1,0)
      : v3(0 * u.z - 1 * u.y, 1 * u.x - 0 * u.z, 0));
    const e2 = normalize(v3(
      u.y * e1.z - u.z * e1.y,
      u.z * e1.x - u.x * e1.z,
      u.x * e1.y - u.y * e1.x));

    const cosA = Math.cos(-sil.angle), sinA = Math.sin(-sil.angle);
    const onEllipse = (p) => {
      const dx = p.x - sil.x, dy = p.y - sil.y;
      const qx = dx * cosA - dy * sinA;
      const qy = dx * sinA + dy * cosA;
      return (qx / sil.a) ** 2 + (qy / sil.b) ** 2;
    };

    let worstRing = 0;
    for (let i = 0; i < 360; i++) {
      const t = (i / 360) * Math.PI * 2;
      const rr = R * k;
      const wp = v3(
        ringC.x + (e1.x * Math.cos(t) + e2.x * Math.sin(t)) * rr,
        ringC.y + (e1.y * Math.cos(t) + e2.y * Math.sin(t)) * rr,
        ringC.z + (e1.z * Math.cos(t) + e2.z * Math.sin(t)) * rr);
      const cc = cam.toCamera(wp);
      if (cc.z <= cam.near) continue;
      worstRing = Math.max(worstRing, Math.abs(onEllipse(cam.project(cc)) - 1));
    }

    // Видимая поверхность должна лежать внутри силуэта.
    let worstInside = 0;
    for (let i = 0; i < 2000; i++) {
      const zz = -1 + 2 * (i % 40) / 39;
      const ph = (i * 0.618) % 1 * Math.PI * 2;
      const sr = Math.sqrt(Math.max(0, 1 - zz * zz));
      const n = v3(sr * Math.cos(ph), zz, sr * Math.sin(ph));
      const wp = v3(cx + n.x * R, cy + n.y * R, cz + n.z * R);
      // видима, если нормаль смотрит в сторону камеры
      if (-(wp.x * n.x + wp.y * n.y + wp.z * n.z) <= 0) continue;
      const cc = cam.toCamera(wp);
      if (cc.z <= cam.near) continue;
      worstInside = Math.max(worstInside, onEllipse(cam.project(cc)));
    }

    ok(worstRing < 2e-3 && worstInside < 1.005,
      `${label}: линия силуэта на эллипсе (ошибка ${worstRing.toExponential(1)}), ` +
      `поверхность внутри (макс ${worstInside.toFixed(3)}); полуоси ` +
      `${sil.a.toFixed(0)}x${sil.b.toFixed(0)} px`);
  };

  // На оси силуэт обязан быть кругом
  {
    const sil = cam.silhouette(v3(0, 0, 20000), 4200);
    const expect = cam.focal * 4200 / Math.sqrt(20000 * 20000 - 4200 * 4200);
    ok(Math.abs(sil.a - sil.b) < 1e-9 && Math.abs(sil.a - expect) < 1e-9,
      `на оси взгляда — круг радиусом ${sil.a.toFixed(1)} px`);
    ok(Math.abs(sil.x - cam.cx) < 1e-9 && Math.abs(sil.y - cam.cy) < 1e-9,
      'на оси взгляда центр силуэта совпадает с центром экрана');
  }

  // Тело за камерой рисоваться не должно. sinθ одинаков для θ и 180° − θ,
  // поэтому без проверки знака cosθ планета «висела» в центре экрана,
  // уменьшаясь по мере отлёта.
  {
    const back = cam.silhouette(v3(0, 0, -20000), 4200);
    ok(!back.ok && !back.covers, 'планета точно за спиной не рисуется');
    const backOff = cam.silhouette(v3(6000, -2000, -19000), 4200);
    ok(!backOff.ok && !backOff.covers, 'планета позади и сбоку не рисуется');
    const side = cam.silhouette(v3(20000, 0, 300), 4200);
    ok(!side.ok && !side.covers, 'планета ровно сбоку (θ ≈ 90°) не рисуется');
    const front = cam.silhouette(v3(0, 0, 20000), 4200);
    ok(front.ok, 'планета перед носом рисуется');
    // Вплотную к поверхности, но на оси, силуэт ещё считается — это
    // корректный огромный круг, который сам заполняет кадр.
    const hug = cam.silhouette(v3(0, 0, 4300), 4200);
    ok(hug.ok && hug.a > 900, `вплотную на оси — круг ${hug.a.toFixed(0)} px`);
    // А вот если вплотную и с наклоном, θ + α > 90°: силуэт пересекает
    // плоскость экрана, и тогда заливаем кадр цветом поверхности.
    const hugTilt = cam.silhouette(v3(4300 * Math.sin(0.35), 0, 4300 * Math.cos(0.35)), 4200);
    ok(!hugTilt.ok && hugTilt.covers,
      'вплотную и с наклоном — силуэт вырожден, экран заливается');
    const hugAside = cam.silhouette(v3(4300, 0, 400), 4200);
    ok(!hugAside.ok && !hugAside.covers,
      'та же планета вплотную, но сбоку от оси — экран не заливается');
  }

  check('планета по центру', 0, 0, 20000, 4200);
  check('планета сбоку 20°', 7000, 0, 19000, 4200);
  check('планета сбоку 40°', 16000, 2000, 19000, 4200);
  check('крупная планета вплотную', 3000, 1500, 9000, 4200);
  check('газовый гигант сбоку', 20000, -9000, 26000, 8200);
  check('луна далеко', 900, 300, 60000, 800);

  // Вне центра силуэт обязан быть КРУПНЕЕ наивного круга — это и есть
  // причина прежнего «дыхания» планеты.
  {
    const c = v3(16000, 2000, 19000);
    const sil = cam.silhouette(c, 4200);
    const naive = cam.screenRadius(Math.hypot(c.x, c.y, c.z), 4200);
    ok(sil.b > naive * 1.05 && sil.a > sil.b,
      `вне оси силуэт больше наивного круга: ${naive.toFixed(0)} px -> ` +
      `${sil.b.toFixed(0)}x${sil.a.toFixed(0)} px (растяжение ${(sil.a / sil.b).toFixed(2)}x)`);
  }
}

// --- 2c. Отрисовка планеты вне оси взгляда ----------------------------------
// Регрессия на «дыхание» планеты: диск обязан совпадать с аналитическим
// силуэтом, а пятна поверхности (они проецируются точка за точкой) —
// лежать внутри него при любом положении планеты на экране.
console.log('== планета в кадре ==');
{
  // Пишущий ctx: запоминаем вызовы вместе с глубиной save/restore.
  const log = [];
  let depth = 0;
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'save') return () => { depth++; };
      if (prop === 'restore') return () => { depth--; };
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => ({ addColorStop() {} });
      }
      if (prop === 'measureText') return () => ({ width: 10 });
      if (typeof prop === 'string') return (...args) => log.push({ op: prop, args, depth });
      return undefined;
    },
    set() { return true; },
  });
  const canvas = { getContext: () => ctx, style: {}, width: 0, height: 0 };
  globalThis.window = globalThis.window || {};
  globalThis.window.innerWidth = 1600;
  globalThis.window.innerHeight = 900;
  globalThis.window.devicePixelRatio = 1;

  const r = new Renderer(canvas);
  r.resize();
  const w2 = makeSystem(0x1a7e);
  const planet = w2.home;

  const runFrame = (camPos, lookAt) => {
    log.length = 0; depth = 0;
    copy(r.camera.pos, camPos);
    const f = normalize(v3(lookAt.x - camPos.x, lookAt.y - camPos.y, lookAt.z - camPos.z));
    lookAlong(r.camera.basis, f);
    r.begin();
    drawBody(r, planet, w2.star.pos);
    r.end();
    return r.camera.silhouette(r.camera.toCamera(planet.pos), planet.radius, {});
  };

  // Точка обзора: 2.5 радиуса от планеты; цель взгляда смещаем, чтобы
  // планета уезжала от центра экрана.
  const base = v3(
    planet.pos.x + planet.radius * 2.5,
    planet.pos.y + planet.radius * 0.6,
    planet.pos.z + planet.radius * 1.2);

  for (const off of [0, 0.35, 0.8, 1.3]) {
    // Смотрим «мимо» планеты: сдвигаем точку взгляда в сторону.
    const aim = v3(
      planet.pos.x + planet.radius * off * 2,
      planet.pos.y,
      planet.pos.z - planet.radius * off * 2);
    const sil = runFrame(base, aim);
    if (!sil.ok) { ok(false, `смещение ${off}: силуэт не посчитался`); continue; }

    // Клип-эллипс — первый ellipse на глубине 1, сразу перед clip().
    const ci = log.findIndex((e, i) => e.op === 'ellipse' &&
      log.slice(i + 1, i + 3).some((n) => n.op === 'clip'));
    if (ci < 0) { ok(false, `смещение ${off}: клип-эллипс не найден`); continue; }
    const [qx, qy, qa, qb, qang] = log[ci].args;
    const sameAsAnalytic =
      Math.abs(qx - sil.x) < 1e-6 && Math.abs(qy - sil.y) < 1e-6 &&
      Math.abs(qa - sil.a) < 1e-6 && Math.abs(qb - sil.b) < 1e-6 &&
      Math.abs(qang - sil.angle) < 1e-9;

    // Пятна поверхности: ellipse на той же глубине после клипа.
    const spots = log.slice(ci + 1).filter((e) => e.op === 'ellipse' && e.depth === log[ci].depth);
    const cosA = Math.cos(-sil.angle), sinA = Math.sin(-sil.angle);
    let worst = 0;
    for (const sp of spots) {
      const dx = sp.args[0] - sil.x, dy = sp.args[1] - sil.y;
      const ux = dx * cosA - dy * sinA, uy = dx * sinA + dy * cosA;
      worst = Math.max(worst, (ux / sil.a) ** 2 + (uy / sil.b) ** 2);
    }
    ok(sameAsAnalytic && spots.length > 0 && worst <= 1.02,
      `смещение ${off}: диск = силуэт (${sil.a.toFixed(0)}x${sil.b.toFixed(0)} px), ` +
      `пятен ${spots.length}, самое дальнее на ${Math.sqrt(worst).toFixed(3)} радиуса`);
  }

  // Регрессия на «планета видна и спереди, и сзади»: отлетаем от планеты
  // носом наружу — в очередь отрисовки не должно попасть ничего.
  {
    let visibleBehind = 0;
    for (const mul of [1.3, 2, 5, 20, 200]) {
      const camPos = v3(
        planet.pos.x + planet.radius * mul,
        planet.pos.y,
        planet.pos.z);
      // Смотрим строго ОТ планеты
      const aim = v3(
        planet.pos.x + planet.radius * mul * 2,
        planet.pos.y,
        planet.pos.z);
      log.length = 0; depth = 0;
      copy(r.camera.pos, camPos);
      lookAlong(r.camera.basis, normalize(v3(aim.x - camPos.x, aim.y - camPos.y, aim.z - camPos.z)));
      r.begin();
      drawBody(r, planet, w2.star.pos);
      if (r.items.length > 0) visibleBehind++;
      r.end();
    }
    ok(visibleBehind === 0,
      `при отлёте от планеты она не рисуется (кадров с артефактом: ${visibleBehind})`);

    // И наоборот: развернувшись на неё, планета обязана быть в кадре.
    const camPos = v3(planet.pos.x + planet.radius * 3, planet.pos.y, planet.pos.z);
    copy(r.camera.pos, camPos);
    lookAlong(r.camera.basis, normalize(v3(
      planet.pos.x - camPos.x, planet.pos.y - camPos.y, planet.pos.z - camPos.z)));
    r.begin();
    drawBody(r, planet, w2.star.pos);
    const seen = r.items.length;
    r.end();
    ok(seen > 0, 'развернувшись на планету, она снова в кадре');
  }

  // Освещение не должно зависеть от ориентации корабля: разворот меняет
  // только угол, под которым виден терминатор, но не долю освещённого
  // диска. Раньше фаза считалась через ось взгляда, и тень «ездила» за
  // кораблём, как будто солнце крутится вместе с ним.
  {
    const cam = r.camera;
    const camPos = v3(
      planet.pos.x + planet.radius * 3.0,
      planet.pos.y + planet.radius * 0.8,
      planet.pos.z + planet.radius * 1.5);
    copy(cam.pos, camPos);
    const toPlanet = normalize(v3(
      planet.pos.x - camPos.x, planet.pos.y - camPos.y, planet.pos.z - camPos.z));

    const phases = [], angles = [];
    const rolls = [0, 0.5, 1.2, 2.4, 4.0];
    for (const roll of rolls) {
      lookAlong(cam.basis, v3(toPlanet.x, toPlanet.y, toPlanet.z));
      rotateBasis(cam.basis, 0, 0, roll);
      const g = sunGeometry(planet, w2.star.pos, cam,
        cam.pos.x - planet.pos.x, cam.pos.y - planet.pos.y, cam.pos.z - planet.pos.z);
      phases.push(g.cosPhase);
      angles.push(g.sunAng);
    }
    const dPhase = Math.max(...phases) - Math.min(...phases);
    ok(dPhase < 1e-12,
      `крен не меняет фазу освещения (фаза ${phases[0].toFixed(4)}, разброс ${dPhase.toExponential(1)})`);

    // При этом экранный угол терминатора обязан поворачиваться ровно на
    // крен — в противоположную сторону: при крене вправо картинка на
    // экране поворачивается влево.
    let worstAng = 0;
    for (let i = 1; i < rolls.length; i++) {
      const expected = angles[0] - rolls[i];
      let diff = (angles[i] - expected) % (Math.PI * 2);
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      worstAng = Math.max(worstAng, Math.abs(diff));
    }
    ok(worstAng < 1e-9,
      `терминатор поворачивается ровно на крен (ошибка ${worstAng.toExponential(1)})`);

    // Отворот носа в сторону тоже не должен менять фазу.
    const offPhases = [];
    for (const yaw of [0, 0.2, 0.5, 0.9]) {
      lookAlong(cam.basis, v3(toPlanet.x, toPlanet.y, toPlanet.z));
      rotateBasis(cam.basis, 0.1, yaw, 0);
      const g = sunGeometry(planet, w2.star.pos, cam,
        cam.pos.x - planet.pos.x, cam.pos.y - planet.pos.y, cam.pos.z - planet.pos.z);
      offPhases.push(g.cosPhase);
    }
    const dOff = Math.max(...offPhases) - Math.min(...offPhases);
    ok(dOff < 1e-12, `отворот носа не меняет фазу (разброс ${dOff.toExponential(1)})`);

    // А смена ПОЗИЦИИ корабля фазу менять обязана: облетаем планету и
    // смотрим, что фаза проходит от почти полной до почти новой.
    const around = [];
    const L = normalize(v3(
      w2.star.pos.x - planet.pos.x,
      w2.star.pos.y - planet.pos.y,
      w2.star.pos.z - planet.pos.z));
    let perp = normalize(v3(-L.z, 0, L.x));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const dir = normalize(v3(
        L.x * Math.cos(a) + perp.x * Math.sin(a),
        L.y * Math.cos(a) + perp.y * Math.sin(a),
        L.z * Math.cos(a) + perp.z * Math.sin(a)));
      const pos = v3(
        planet.pos.x + dir.x * planet.radius * 3,
        planet.pos.y + dir.y * planet.radius * 3,
        planet.pos.z + dir.z * planet.radius * 3);
      copy(cam.pos, pos);
      lookAlong(cam.basis, normalize(v3(
        planet.pos.x - pos.x, planet.pos.y - pos.y, planet.pos.z - pos.z)));
      const g = sunGeometry(planet, w2.star.pos, cam,
        pos.x - planet.pos.x, pos.y - planet.pos.y, pos.z - planet.pos.z);
      around.push(g.cosPhase);
    }
    ok(Math.max(...around) > 0.99 && Math.min(...around) < -0.99,
      `облёт планеты даёт все фазы: от ${Math.max(...around).toFixed(2)} до ${Math.min(...around).toFixed(2)}`);
  }

  // Главная проверка: нарисованная область экрана должна совпадать с
  // трассировкой лучей. Именно здесь ловятся два симптома вблизи планеты —
  // «планета пропала» и «экран залит, будто мы внутри».
  {
    const COLS = 64, ROWS = 36;
    const cam = r.camera;

    // Что реально попало на экран по записанным вызовам ctx.
    const drawnRegion = () => {
      // Заливка всего кадра
      for (const e of log) {
        if (e.op === 'fillRect' && e.depth === 0 &&
            e.args[2] >= cam.w && e.args[3] >= cam.h) return () => true;
      }
      // Клип-эллипс (нормальный случай)
      const ci = log.findIndex((e, i) => e.op === 'ellipse' &&
        log.slice(i + 1, i + 3).some((n) => n.op === 'clip'));
      if (ci >= 0) {
        const [qx, qy, qa, qb, qang] = log[ci].args;
        const ca = Math.cos(-qang), sa = Math.sin(-qang);
        return (x, y) => {
          const dx = x - qx, dy = y - qy;
          const ux = dx * ca - dy * sa, uy = dx * sa + dy * ca;
          return (ux / qa) ** 2 + (uy / qb) ** 2 <= 1;
        };
      }
      // Полигон силуэта (вырожденный случай)
      const mi = log.findIndex((e) => e.op === 'moveTo');
      if (mi >= 0) {
        const poly = [{ x: log[mi].args[0], y: log[mi].args[1] }];
        for (let i = mi + 1; i < log.length && log[i].op === 'lineTo'; i++) {
          poly.push({ x: log[i].args[0], y: log[i].args[1] });
        }
        if (poly.length >= 3) {
          return (x, y) => {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              const a = poly[i], b = poly[j];
              if ((a.y > y) !== (b.y > y) &&
                  x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
            }
            return inside;
          };
        }
      }
      return () => false;
    };

    // Истина: пересечение луча через пиксель со сферой.
    const truth = (c, R) => (x, y) => {
      const dx = (x - cam.cx) / cam.focal;
      const dy = -(y - cam.cy) / cam.focal;
      const l = Math.hypot(dx, dy, 1);
      const ox = dx / l, oy = dy / l, oz = 1 / l;
      const b = ox * c.x + oy * c.y + oz * c.z;       // проекция центра на луч
      const disc = b * b - (c.x * c.x + c.y * c.y + c.z * c.z) + R * R;
      return disc >= 0 && b + Math.sqrt(disc) > 0;
    };

    const compare = (label, camPos, aim) => {
      log.length = 0; depth = 0;
      copy(cam.pos, camPos);
      lookAlong(cam.basis, normalize(v3(aim.x - camPos.x, aim.y - camPos.y, aim.z - camPos.z)));
      r.begin();
      drawBody(r, planet, w2.star.pos);
      r.end();

      const c = cam.toCamera(planet.pos);
      const hit = truth(c, planet.radius);
      const drawn = drawnRegion();
      let expected = 0, got = 0, diff = 0;
      for (let iy = 0; iy < ROWS; iy++) {
        for (let ix = 0; ix < COLS; ix++) {
          const x = (ix + 0.5) * cam.w / COLS;
          const y = (iy + 0.5) * cam.h / ROWS;
          const h = hit(x, y), g = drawn(x, y);
          if (h) expected++;
          if (g) got++;
          if (h !== g) diff++;
        }
      }
      const total = COLS * ROWS;
      ok(diff / total < 0.04,
        `${label}: планета занимает ${(expected / total * 100).toFixed(0)}% кадра, ` +
        `нарисовано ${(got / total * 100).toFixed(0)}%, расхождение ` +
        `${(diff / total * 100).toFixed(1)}%`);
    };

    const R = planet.radius;
    // Подлёт по оси: от далёкого диска до самой поверхности.
    for (const mul of [4, 2, 1.5, 1.2, 1.05, 1.01]) {
      const camPos = v3(planet.pos.x + R * mul, planet.pos.y, planet.pos.z);
      compare(`подлёт x${mul}`, camPos, planet.pos);
    }
    // Разворот вблизи планеты: критичная зона theta + alpha ~ 90 градусов.
    for (const mul of [1.15, 1.5, 2.5]) {
      for (const deg of [0, 20, 40, 55, 70, 90, 120, 170]) {
        const camPos = v3(planet.pos.x + R * mul, planet.pos.y, planet.pos.z);
        const a = deg * Math.PI / 180;
        // Смотрим в сторону, повёрнутую на deg от направления на планету.
        const aim = v3(
          camPos.x - Math.cos(a) * R * 10,
          camPos.y,
          camPos.z + Math.sin(a) * R * 10);
        compare(`x${mul}, поворот ${deg}°`, camPos, aim);
      }
    }
  }

  // Крен корабля не должен менять размер планеты.
  const sizes = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const cam = r.camera;
    copy(cam.pos, base);
    const f = normalize(v3(
      planet.pos.x - base.x + planet.radius * 1.2,
      planet.pos.y - base.y,
      planet.pos.z - base.z));
    lookAlong(cam.basis, f);
    rotateBasis(cam.basis, 0, 0, ang);      // крен вокруг оси взгляда
    const sil = cam.silhouette(cam.toCamera(planet.pos), planet.radius, {});
    sizes.push(sil.a * sil.b);
  }
  const spread = (Math.max(...sizes) - Math.min(...sizes)) / Math.max(...sizes);
  ok(spread < 1e-9, `крен не меняет размер планеты (разброс ${spread.toExponential(1)})`);
}

// --- 3. Ортонормальность базиса при длительном вращении ----------------------
console.log('\n== вращение ==');
const b = makeBasis();
for (let i = 0; i < 100000; i++) rotateBasis(b, 0.013, -0.007, 0.021);
const err = Math.max(
  Math.abs(len(b.fwd) - 1), Math.abs(len(b.right) - 1), Math.abs(len(b.up) - 1),
  Math.abs(dot(b.fwd, b.right)), Math.abs(dot(b.fwd, b.up)), Math.abs(dot(b.right, b.up)));
ok(err < 1e-9, `после 100000 поворотов ошибка ортонормальности ${err.toExponential(2)}`);

// --- 4. Стыковка докинг-компьютером ----------------------------------------
console.log('\n== докинг-компьютер ==');
function dockTest(distKm, startDir) {
  const w = makeSystem(0x1a7e);
  const st = w.home.station;
  const sh = makeShip();
  const bb = makeBasis();
  // Ставим корабль на расстоянии distKm от станции в заданном направлении
  const d = normalize(startDir(st));
  placeShip(sh, v3(st.pos.x + d.x * distKm, st.pos.y + d.y * distKm, st.pos.z + d.z * distKm), bb);
  const cr = makeCruise();
  const res = startDockingComputer(sh, st);
  if (!res.ok) return { status: 'refused', reason: res.reason };
  let t = 0;
  for (let i = 0; i < 60 * 900; i++) {
    updateWorld(w, STEP);
    clearControls(sh);
    updateDockingComputer(sh, STEP);
    const lvl = updateCruise(cr, w, sh, STEP);
    updateShip(sh, STEP, STEP * lvl);
    t += STEP;
    const nb = nearestBody(w, sh.pos);
    if (nb.gap <= 0) return { status: 'crash-planet', t };
    const r = checkStation(sh, st);
    if (r === 'docked') return { status: 'docked', t, q: dockingQuality(sh, st) };
    if (r === 'crash') return { status: 'crash-station', t, q: dockingQuality(sh, st) };
  }
  return { status: 'timeout', t };
}

const t1 = dockTest(20, (st) => ({ ...st.basis.fwd }));
ok(t1.status === 'docked', `подход по оси, 20 км -> ${t1.status} за ${t1.t ? t1.t.toFixed(0) : '?'} с`);

const t2 = dockTest(40, (st) => ({ x: st.basis.right.x, y: st.basis.right.y, z: st.basis.right.z }));
ok(t2.status === 'docked', `подход сбоку, 40 км -> ${t2.status} за ${t2.t ? t2.t.toFixed(0) : '?'} с`);

const t3 = dockTest(60, (st) => ({ x: -st.basis.fwd.x, y: -st.basis.fwd.y, z: -st.basis.fwd.z }));
ok(t3.status === 'docked', `подход с обратной стороны (из-за планеты), 60 км -> ${t3.status} за ${t3.t ? t3.t.toFixed(0) : '?'} с`);

const t4 = dockTest(400, (st) => ({ ...st.basis.fwd }));
ok(t4.status === 'refused', `с 400 км докинг-компьютер отказывает: ${t4.reason || t4.status}`);

// --- 5. Автопилот: перелёт между планетами ---------------------------------
console.log('\n== автопилот ==');
function autopilotTest(targetName, maxSeconds = 600) {
  const w = makeSystem(0x1a7e);
  const nav = makeNav(w);
  const sh = makeShip();
  const st = w.home.station;
  const bb = makeBasis();
  placeShip(sh, v3(
    st.pos.x + st.basis.fwd.x * 3,
    st.pos.y + st.basis.fwd.y * 3,
    st.pos.z + st.basis.fwd.z * 3), bb);
  nav.index = nav.list.findIndex((x) => x.name === targetName);
  if (nav.index < 0) return { status: 'no-target' };
  const target = currentTarget(nav);
  const cr = makeCruise();
  startAutopilot(sh, target);
  const d0 = Math.hypot(target.pos.x - sh.pos.x, target.pos.y - sh.pos.y, target.pos.z - sh.pos.z);
  let t = 0, maxLevel = 1;
  for (let i = 0; i < 60 * maxSeconds; i++) {
    updateWorld(w, STEP);
    clearControls(sh);
    const idx = updateAutopilot(sh, w, STEP);
    if (idx !== null) cr.index = idx;
    const lvl = updateCruise(cr, w, sh, STEP);
    maxLevel = Math.max(maxLevel, lvl);
    updateShip(sh, STEP, STEP * lvl);
    t += STEP;
    const nb = nearestBody(w, sh.pos);
    if (nb.gap <= 0) return { status: 'crash', t, into: nb.body.name };
    if (sh.autopilot && sh.autopilot.arrived) {
      const d = Math.hypot(target.pos.x - sh.pos.x, target.pos.y - sh.pos.y, target.pos.z - sh.pos.z);
      return { status: 'arrived', t, d0, d, maxLevel };
    }
  }
  const d = Math.hypot(target.pos.x - sh.pos.x, target.pos.y - sh.pos.y, target.pos.z - sh.pos.z);
  return { status: 'timeout', t, d0, d, maxLevel };
}

for (const name of ['Lave III', 'Lave V', 'Lave VI', 'Lave I']) {
  const r = autopilotTest(name);
  ok(r.status === 'arrived',
    `перелёт к ${name}: ${r.status} за ${r.t ? r.t.toFixed(0) : '?'} с`,
    r.d0 ? `${(r.d0 / 1e6).toFixed(2)} млн км -> ${r.d ? r.d.toFixed(0) : '?'} км, круиз до x${r.maxLevel}` : '');
}

// Полный цикл: автопилот к станции + стыковка
console.log('\n== полный цикл: станция -> станция ==');
{
  const w = makeSystem(0x1a7e);
  const nav = makeNav(w);
  const sh = makeShip();
  const from = w.home.station;
  placeShip(sh, v3(
    from.pos.x + from.basis.fwd.x * 3,
    from.pos.y + from.basis.fwd.y * 3,
    from.pos.z + from.basis.fwd.z * 3), makeBasis());
  const to = w.stations.find((s) => s !== from);
  nav.index = nav.list.indexOf(to);
  const cr = makeCruise();
  startAutopilot(sh, to);
  let t = 0, status = 'timeout', docking = false;
  for (let i = 0; i < 60 * 1500; i++) {
    updateWorld(w, STEP);
    clearControls(sh);
    if (sh.docking) {
      updateDockingComputer(sh, STEP);
    } else if (sh.autopilot) {
      const idx = updateAutopilot(sh, w, STEP);
      if (idx !== null) cr.index = idx;
      if (sh.autopilot.arrived) {
        sh.autopilot = null;
        startDockingComputer(sh, to);
        docking = true;
      }
    }
    const lvl = updateCruise(cr, w, sh, STEP);
    updateShip(sh, STEP, STEP * lvl);
    t += STEP;
    const nb = nearestBody(w, sh.pos);
    if (nb.gap <= 0) { status = 'crash into ' + nb.body.name; break; }
    const r = checkStation(sh, to);
    if (r === 'docked') { status = 'docked'; break; }
    if (r === 'crash') { status = 'crash-station'; break; }
  }
  ok(status === 'docked', `${from.name} -> ${to.name}: ${status} за ${t.toFixed(0)} с (докинг включался: ${docking})`);
}

// --- 5b. Ориентация по площадке ---------------------------------------------
// Посадка требует выйти на ПОЛНУЮ ориентацию (брюхом вниз), а не только
// навести нос. Короткая формула через сумму векторных произведений здесь
// имеет неподвижную точку около поворота на 180°, и регулятор честно
// сходился к ошибке в 76° — отсюда и были «опрокидывания».
console.log('\n== выход на заданную ориентацию ==');
{
  const cases = [
    ['малый угол', 0.2, -0.1, 0.15],
    ['средний', 0.6, -1.1, 0.9],
    ['почти вверх ногами', 2.9, 0.2, 0.1],
    ['вверх ногами', Math.PI - 0.02, 0, 0],
  ];
  for (const [label, p, y, r] of cases) {
    const sh = makeShip();
    rotateBasis(sh.basis, p, y, r);
    const up = normalize(v3(0.2, 0.9, 0.3));
    const fwd = normalize(horizontal(v3(1, 0, 0), up, v3()));
    let err = 1;
    for (let i = 0; i < 60 * 20; i++) {
      clearControls(sh);
      err = alignBasis(sh, fwd, up, 1.5);
      updateShip(sh, STEP, STEP);
    }
    const tilt = dot(sh.basis.up, up);
    const nose = dot(sh.basis.fwd, fwd);
    ok(tilt > 0.9999 && nose > 0.999,
      `${label}: за 20 с вышли на ориентацию (верх ${tilt.toFixed(5)}, нос ${nose.toFixed(4)})`);
  }
}

// --- 5c. Поверхность и посадка ----------------------------------------------
console.log('\n== поверхность ==');
{
  const w = makeSystem(0x1a7e);
  // Скорость поверхности должна быть по силам посадочным движкам —
  // иначе сесть физически невозможно (и раньше так и было: периоды
  // суток в минутах давали десятки км/с).
  for (const b of w.bodies) {
    if (b.kind === 'star') continue;
    const v = b.spin * b.radius;
    ok(v < 0.5, `${b.name}: скорость поверхности ${(v * 1000).toFixed(0)} м/с, ` +
      `сутки ${(Math.PI * 2 / b.spin / 3600).toFixed(1)} ч`);
  }

  const moon = w.bodies.find((b) => b.kind === 'moon');
  ok(isLandable(moon) && !isLandable(w.home) && !isLandable(w.star) &&
     !isLandable(w.planets.find((p) => p.kind === 'gas')),
    'сесть можно на луну, но не на мир с атмосферой, не на светило и не на гиганта');

  // Высота считается по рельефу, а не по сфере: над горой она меньше.
  const dirA = normalize(v3(0.3, 0.7, 0.6));
  const rA = groundRadius(moon, dirA);
  const p = worldPoint(moon, dirA, rA + 2, v3());
  const info = altitudeOf(moon, p, {});
  ok(Math.abs(info.alt - 2) < 1e-6 && Math.abs(rA - moon.radius) > 0.01,
    `высота над рельефом: 2 км над точкой с рельефом ` +
    `${(rA - moon.radius).toFixed(2)} км -> ${info.alt.toFixed(6)} км`);

  // Нормаль и уклон: нормаль единичная, уклон совпадает с углом до радиуса.
  const n = surfaceNormal(moon, dirA, v3(), 0.06);
  ok(Math.abs(len(n) - 1) < 1e-9 && dot(n, dirA) > 0,
    `нормаль площадки единичная и наружу, уклон ${(slopeAt(moon, dirA) * 57.3).toFixed(1)}°`);

  // Поиск площадки обязан находить место ровнее, чем «куда смотрели».
  let better = 0, total = 0;
  for (let i = 0; i < 30; i++) {
    const a = i * 2.399963;
    const u = -1 + 2 * (i / 29);
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    const d = normalize(v3(s * Math.cos(a), u, s * Math.sin(a)));
    const was = slopeAt(moon, d);
    const site = findSite(moon, d, 1.2);
    total++;
    if (site.slope <= was + 1e-9) better++;
  }
  ok(better === total, `поиск площадки не ухудшает уклон (${better}/${total} точек)`);

  // Скорость грунта: складывается из орбитальной и вращения.
  const sv = surfaceVelocity(moon, p, v3());
  ok(len(sv) > moon.spin * moon.radius * 0.5,
    `скорость грунта ${(len(sv) * 1000).toFixed(0)} м/с (вращение ` +
    `${(moon.spin * moon.radius * 1000).toFixed(0)} м/с + орбита)`);
}

// --- 5d. Посадочный компьютер -----------------------------------------------
console.log('\n== посадка ==');
function landTest(pick, startMul, opts = {}) {
  const w = makeSystem(0x1a7e);
  const body = pick(w);
  const sh = makeShip();
  const dir = normalize(v3(0.3, 0.7, 0.6));
  placeShip(sh, v3(
    body.pos.x + dir.x * body.radius * startMul,
    body.pos.y + dir.y * body.radius * startMul,
    body.pos.z + dir.z * body.radius * startMul), makeBasis());
  lookAlong(sh.basis, normalize(v3(
    body.pos.x - sh.pos.x, body.pos.y - sh.pos.y, body.pos.z - sh.pos.z)));
  const cr = makeCruise();
  const res = startLanding(sh, body, sh.pos);
  if (!res.ok) return { status: 'refused', reason: res.reason };
  if (opts.noGear) { sh.gear.out = false; sh.gear.t = 0; }

  let t = 0;
  const phases = new Set();
  for (let i = 0; i < 60 * 900; i++) {
    updateWorld(w, STEP);
    clearControls(sh);
    if (opts.noGear) { sh.gear.out = false; sh.gear.t = 0; }
    else updateGear(sh, STEP);
    let zone = landingContext(w, sh);
    syncVtol(sh, zone);
    if (sh.landing) {
      updateLandingComputer(sh, STEP, cr.level);
      phases.add(sh.landing.phase);
      if (sh.landing.wantCruise !== null) cr.index = sh.landing.wantCruise;
    }
    const lvl = updateCruise(cr, w, sh, STEP);
    updateShip(sh, STEP, STEP * lvl);
    t += STEP;
    const nb = nearestBody(w, sh.pos);
    if (nb.gap <= 0 && !isLandable(nb.body)) return { status: 'crash-body', t };
    zone = landingContext(w, sh);
    if (!zone) continue;
    const touch = checkTouchdown(sh, zone);
    if (touch && touch.result === 'landed') {
      const r = landingReadout(sh, zone);
      settle(sh, zone);
      return { status: 'landed', t, w, sh, body, r, phases: [...phases] };
    }
    if (touch && touch.result === 'crash') return { status: 'crash', t, reason: touch.reason };
  }
  return { status: 'timeout', t };
}

const moonPick = (w) => w.bodies.find((b) => b.kind === 'moon');
const moon2Pick = (w) => w.bodies.filter((b) => b.kind === 'moon')[1];
const rockPick = (w) => w.planets.find((p) => p.kind === 'rock');

{
  const r1 = landTest(moonPick, 2.0);
  ok(r1.status === 'landed',
    `луна с высоты в радиус: ${r1.status} за ${r1.t ? r1.t.toFixed(0) : '?'} с`,
    r1.phases ? r1.phases.join(' -> ') : r1.reason || '');
  if (r1.status === 'landed') {
    ok(Math.abs(r1.r.alt - SHIP.gearClear) < 0.003 && r1.r.vspeedOk && r1.r.hspeedOk &&
       r1.r.tiltOk && r1.r.slopeOk,
      `касание в допусках: высота ${(r1.r.alt * 1000).toFixed(1)} м, вертикальная ` +
      `${(r1.r.vspeed * 1000).toFixed(1)} м/с, боковая ${(r1.r.hspeed * 1000).toFixed(1)} м/с, ` +
      `наклон ${(Math.acos(Math.min(1, r1.r.tilt)) * 57.3).toFixed(1)}°`);

    // Стоянка: корабль едет вместе с вращающейся поверхностью и не
    // проваливается в неё.
    const { w, sh, body } = r1;
    const p0 = { ...sh.pos };
    let worstAlt = 0;
    for (let i = 0; i < 60 * 120; i++) {
      updateWorld(w, STEP);
      updateLandedPose(sh);
      if (i % 60 === 0) {
        const z = landingContext(w, sh);
        worstAlt = Math.max(worstAlt, Math.abs(z.alt - SHIP.gearClear));
      }
    }
    const moved = Math.hypot(sh.pos.x - p0.x, sh.pos.y - p0.y, sh.pos.z - p0.z);
    ok(worstAlt < 1e-6 && moved > 1,
      `за 2 минуты стоянки корабль проехал с поверхностью ${moved.toFixed(1)} км, ` +
      `высота не изменилась (${(worstAlt * 1e6).toFixed(2)} мм)`);

    // Взлёт: отрыв и набор высоты на посадочных движках.
    takeoff(sh);
    for (let i = 0; i < 60 * 40; i++) {
      updateWorld(w, STEP);
      clearControls(sh);
      updateGear(sh, STEP);
      const z = landingContext(w, sh);
      syncVtol(sh, z);
      if (z && sh.vtol) { sh.control.lift = 1; manualHover(sh, z, STEP); }
      updateShip(sh, STEP, STEP);
    }
    const z = landingContext(w, sh);
    ok(z && z.alt > 1.5, `за 40 с взлёта поднялись на ${z ? z.alt.toFixed(2) : '?'} км`);
  }
}

{
  const r2 = landTest(moon2Pick, 3.5);
  ok(r2.status === 'landed', `вторая луна с 2.5 радиусов: ${r2.status} за ${r2.t ? r2.t.toFixed(0) : '?'} с`);
  const r3 = landTest(rockPick, 1.6);
  ok(r3.status === 'landed', `каменистая планета: ${r3.status} за ${r3.t ? r3.t.toFixed(0) : '?'} с`);
  const r4 = landTest((w) => w.home, 1.5);
  ok(r4.status === 'refused', `на мир с атмосферой компьютер не берётся: ${r4.reason || r4.status}`);
}

// Мягкое касание с убранным шасси: скорости в допуске, но садиться не на
// что. Заодно проверяем, что посадочный режим без шасси не включается.
{
  const w = makeSystem(0x1a7e);
  const moon = moonPick(w);
  const sh = makeShip();
  const dir = normalize(v3(0.2, 0.6, -0.7));
  const gr = groundRadius(moon, dir);
  placeShip(sh, worldPoint(moon, dir, gr + 0.1, v3()), makeBasis());
  lookAlong(sh.basis, normalize(v3(
    moon.pos.x - sh.pos.x, moon.pos.y - sh.pos.y, moon.pos.z - sh.pos.z)));
  sh.throttle = 0.02;
  let res = null, vtolSeen = false;
  for (let i = 0; i < 60 * 120 && !res; i++) {
    updateWorld(w, STEP);
    clearControls(sh);
    updateGear(sh, STEP);
    const zone = landingContext(w, sh);
    if (syncVtol(sh, zone)) vtolSeen = true;
    updateShip(sh, STEP, STEP);
    const z2 = landingContext(w, sh);
    if (z2) res = checkTouchdown(sh, z2);
  }
  ok(res && res.result === 'crash' && /шасси/i.test(res.reason) && !vtolSeen,
    `мягкое касание с убранным шасси — авария: ${res ? res.reason : 'не произошло'}` +
    (vtolSeen ? ' (посадочный режим включился зря)' : ''));
}

// Слишком быстрое касание: падаем на грунт без посадочного режима.
{
  const w = makeSystem(0x1a7e);
  const moon = moonPick(w);
  const sh = makeShip();
  const dir = normalize(v3(0.3, 0.7, 0.6));
  const gr = groundRadius(moon, dir);
  placeShip(sh, worldPoint(moon, dir, gr + 0.4, v3()), makeBasis());
  // Нос в землю, шасси выпущено, полная тяга.
  lookAlong(sh.basis, normalize(v3(
    moon.pos.x - sh.pos.x, moon.pos.y - sh.pos.y, moon.pos.z - sh.pos.z)));
  sh.gear.out = true; sh.gear.t = 1;
  sh.throttle = 1; sh.speed = SHIP.maxSpeed * SHIP.gearSpeed;
  let res = null;
  for (let i = 0; i < 60 * 60 && !res; i++) {
    updateWorld(w, STEP);
    clearControls(sh);
    updateGear(sh, STEP);
    const zone = landingContext(w, sh);
    // Посадочный режим сознательно не включаем: это падение, не посадка.
    updateShip(sh, STEP, STEP);
    const z2 = landingContext(w, sh);
    if (z2) res = checkTouchdown(sh, z2);
  }
  ok(res && res.result === 'crash' && /скорость/i.test(res.reason),
    `удар о поверхность на скорости — авария: ${res ? res.reason : 'не произошло'}`);
}

// Касание планеты с атмосферой — всегда удар, даже идеально мягкое:
// садиться туда нельзя, а рельеф у неё есть, и считается он так же.
{
  const w = makeSystem(0x1a7e);
  const planet = w.planets.find((p) => p.kind === 'desert');
  const sh = makeShip();
  const dir = normalize(v3(0.1, 0.9, 0.4));
  placeShip(sh, worldPoint(planet, dir, groundRadius(planet, dir) + 0.005, v3()), makeBasis());
  sh.gear.out = true; sh.gear.t = 1;
  const zone = landingContext(w, sh);
  const touch = zone ? checkTouchdown(sh, zone) : null;
  ok(zone && zone.body === planet && touch && touch.result === 'crash',
    `у планеты с атмосферой рельеф учитывается, но посадка невозможна: ` +
    `${touch ? touch.reason : 'касание не определено'}`);
}

// Шасси: время выпуска и ограничение скорости.
{
  const sh = makeShip();
  toggleGear(sh);
  let t = 0;
  while (sh.gear.t < 1 && t < 10) { updateGear(sh, STEP); t += STEP; }
  ok(Math.abs(t - SHIP.gearTime) < 0.05 && gearReady(sh),
    `шасси выпускается за ${t.toFixed(2)} с (задано ${SHIP.gearTime})`);
  sh.throttle = 1;
  for (let i = 0; i < 60 * 20; i++) { clearControls(sh); updateShip(sh, STEP, STEP); }
  const withGear = sh.speed;
  toggleGear(sh);
  while (sh.gear.t > 0) updateGear(sh, STEP);
  for (let i = 0; i < 60 * 20; i++) { clearControls(sh); updateShip(sh, STEP, STEP); }
  ok(Math.abs(withGear - SHIP.maxSpeed * SHIP.gearSpeed) < 0.01 &&
     Math.abs(sh.speed - SHIP.maxSpeed) < 0.01,
    `с шасси скорость ${withGear.toFixed(2)} км/с, без него ${sh.speed.toFixed(2)} км/с`);
}

// --- 6. Столкновение с планетой --------------------------------------------
console.log('\n== столкновения ==');
{
  const w = makeSystem(0x1a7e);
  const sh = makeShip();
  const p = w.home;
  const bb = makeBasis();
  // 5000 км от планеты, носом в неё
  const d = normalize(v3(1, 0.2, 0.3));
  placeShip(sh, v3(p.pos.x + d.x * 5000, p.pos.y + d.y * 5000, p.pos.z + d.z * 5000), bb);
  // Разворачиваем нос на планету
  const to = normalize(v3(p.pos.x - sh.pos.x, p.pos.y - sh.pos.y, p.pos.z - sh.pos.z));
  sh.basis.fwd = to;
  sh.basis.right = normalize(v3(-to.z, 0, to.x));
  sh.basis.up = normalize(v3(
    to.y * sh.basis.right.z - to.z * sh.basis.right.y,
    to.z * sh.basis.right.x - to.x * sh.basis.right.z,
    to.x * sh.basis.right.y - to.y * sh.basis.right.x));
  sh.throttle = 1;
  const cr = makeCruise();
  let crashed = false, t = 0, lockedSeen = false;
  for (let i = 0; i < 60 * 4000; i++) {
    updateWorld(w, STEP);
    const lvl = updateCruise(cr, w, sh, STEP);
    if (cr.massLocked) lockedSeen = true;
    updateShip(sh, STEP, STEP * lvl);
    t += STEP;
    if (nearestBody(w, sh.pos).gap <= 0) { crashed = true; break; }
  }
  ok(crashed, `полёт в планету на полной тяге -> столкновение за ${t.toFixed(0)} с`);
  ok(lockedSeen, 'mass lock срабатывал при подлёте к планете');
}

console.log('\n' + (fails === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : fails + ' ПРОВЕРОК УПАЛО'));
process.exit(fails ? 1 : 0);
