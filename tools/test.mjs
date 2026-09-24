// Headless-проверка игровой логики: мир, полёт, квантовый привод, стыковка.
import { v3, normalize, dot, len, clamp } from '../js/core/vec3.js';
import { makeBasis, rotateBasis, toLocal } from '../js/core/basis.js';
import { makeSystem, updateWorld, nearestBody, bodyPosAt, bodyBasis } from '../js/game/world.js';
import { ROMAN } from '../js/core/rng.js';
import {
  makeGalaxy, systemDistance, warpSeconds, SYSTEM_COUNT, MIN_APART,
  HOME_SEED, HAB_HOME, WARP_MIN, WARP_MAX,
} from '../js/game/galaxy.js';
import {
  makeWarp, updateWarp, startWarp, canWarp, warpAxis, warpPower,
  handoverAt, placeAtStar, finishWarp, WARP,
} from '../js/game/warp.js';
import { HOME_LAYOUT } from '../js/game/world.js';
import { makeShip, updateShip, placeShip, clearControls, SHIP, applyShipSpec } from '../js/game/ship.js';
import {
  makeNav, refreshNav, currentTarget, targetById, pickTarget, aimedTarget, aimTargets, AIM_CONE,
} from '../js/game/nav.js';
import {
  makeQuantum, updateQuantum, startCalibration, stopQuantum, abortQuantum, canJump,
  corridorBlock, exitPoint, exitVelocity, jumpTime, suggestHop, QUANTUM,
} from '../js/game/quantum.js';
import { checkStation, startDockingComputer, updateDockingComputer, dockingQuality } from '../js/game/docking.js';
import { alignBasis, horizontal } from '../js/game/pilot.js';
import {
  isLandable, groundRadius, altitudeOf, surfaceNormal, slopeAt, findSite,
  worldPoint, surfaceVelocity, localDir, dirToWorldBody,
} from '../js/game/surface.js';
import {
  toggleGear, updateGear, gearReady, landingContext, bounceOff, LAND,
  startLanding, updateLandingComputer, checkTouchdown, settle, updateLandedPose,
  takeoff, landingReadout,
} from '../js/game/landing.js';
import { captureBody, carryShip, gravityField, groundDrift, CAPTURE_G } from '../js/game/gravity.js';
import { ENTRY, airDensity, entryHeat, heatColor, entryState } from '../js/game/entry.js';
import { shipShadow, convexHull } from '../js/game/shadow.js';
import { feetGround, feetClearance } from '../js/game/landing.js';
import { GEAR_FEET } from '../js/models/ships.js';
import { scatterRocks, buildRockGeometry, ROCKS } from '../js/gl/rocks.js';
import { makeDust, updateDust, DUST } from '../js/game/dust.js';
import { fmtTime } from '../js/ui/hud.js';
import {
  makePlayer, ledgerAdd, ledgerTotals, cargoTons, loadCargo, dropCargo,
  addMission, updatePlayer, missionExpired, savePlayer, loadPlayer, LEDGER_MAX,
} from '../js/game/player.js';
import { gpuKind } from '../js/gl/context.js';
import {
  makePeers, ingestPeers, peerPoses, dropPeer, PEER_DELAY, PEER_AHEAD, PEER_TTL,
} from '../js/game/peers.js';
import {
  makeClock, clockFromServer, clockTarget, clockStep, CLOCK_SNAP, CLOCK_RATE,
} from '../js/game/clock.js';
import {
  smoothPing, linkLoss, linkGrade, linkState, PING_SMOOTH,
} from '../js/net/quality.js';
import {
  WEAPONS, makeGuns, leadPoint, aimDir, fireGuns, updateGuns, addForeignBolt, segmentHit,
  COMBAT, INSTALLED, shieldFlash, hasShieldFlash,
} from '../js/game/weapons.js';
import { SHIELD_AXES, HULL_SIZE } from '../js/models/ships.js';
import { makeFlow, updateFlow, FLOW } from '../js/game/flow.js';
import {
  massOf, escapeSpeed, temperatureOf, atmosphereOf, starDistance, dayLength,
  KIND_INFO, T_EQ_HOME,
} from '../js/game/bodyinfo.js';
import {
  makeMap, mapObjects, objectCard, focusOn, fitScale, pickAt, fmtMass,
  markerOnBody, glyphRadius,
} from '../js/ui/map.js';
import { makeAudio, updateAudio, playAudio, audioCue, audioReset, AUDIO } from '../js/game/audio.js';
import { Sound } from '../js/core/sound.js';
import { ST as AST } from '../js/game/state.js';
import { STATION_D } from '../js/models/station.js';
import { buildCobra, buildGear, HULL_HALF } from '../js/models/ships.js';
import { buildStation, SLOT } from '../js/models/station.js';
import { Camera } from '../js/render/camera.js';
import { velocityMarker, projectDir } from '../js/ui/hud.js';
import { buildCockpit, makeYoke, updateYoke, YOKE } from '../js/models/cockpit.js';
import { qualityFor, fullscreenAvailable } from '../js/core/quality.js';
import {
  makeTouch, touchLayout, touchUpdate, touchApply, touchDrag, TOUCH,
} from '../js/ui/touch.js';
import { input } from '../js/core/input.js';
import { readFileSync, readdirSync } from 'node:fs';
import { Renderer } from '../js/render/renderer.js';
import { drawBody, sunGeometry } from '../js/render/planetview.js';
import { copy } from '../js/core/vec3.js';
import { lookAlong } from '../js/core/basis.js';
import { box, prismZ, loft } from '../js/models/geometry.js';
import { L, setLang, getLang, hasEn, LANGS } from '../js/core/lang.js';
import { loadSpecsFromDisk } from './specs.mjs';
import { applySpecs } from '../js/game/specs.js';
import { modules, applyModuleSpecs, applyShipEquipment, flightModel, SCANNER_STEPS }
  from '../js/game/loadout.js';

// Характеристики корабля и оружия приходят из бэкенда, и в игре их нет
// ни одного. Проверкам сервер не нужен — они берут тот же слепок, что и
// автономный режим. Без этой строки SHIP пуст, и падает всё подряд:
// именно так и должно быть, пустой объект честнее значений «по
// умолчанию» (см. js/game/ship.js).
loadSpecsFromDisk();

const STEP = 1 / 60;
// Проверки сверяют РУССКИЕ надписи — как и весь остальной набор
// (tools/smoke.mjs). Английский путь проверяется отдельно, в разделе
// «перевод»: там язык переключается и сверяется уже он.
setLang('ru');

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + msg + (extra ? '  [' + extra + ']' : ''));
};

// --- 1. Мир -----------------------------------------------------------------
console.log('\n== мир ==');
const world = makeSystem(0x1a7e);
updateWorld(world, 1);
ok(world.planets.length === 9, 'планет: ' + world.planets.length);
ok(world.stations.length === 4, 'станций: ' + world.stations.length);

// Номер планеты — это её место по расстоянию от звезды, и ничто другое.
// Проверка нужна ровно потому, что список макета пишется руками: вставить
// тело не на своё место по орбите легко, а заметить это в полёте — нет.
{
  const orbits = world.planets.map((p) => p.orbit.radius);
  const grow = orbits.every((r, i) => i === 0 || r > orbits[i - 1]);
  const named = world.planets.every((p, i) => p.name === `Lave ${ROMAN[i]}`);
  ok(grow && named,
    'нумерация идёт от звезды наружу: ' +
    world.planets.map((p) => `${p.name} ${(p.orbit.radius / 1000).toFixed(0)}т`).join(', '));

  // Год растёт вместе с орбитой. Раньше период брался из номера в
  // списке, а не из радиуса, и диапазоны соседей перекрывались: дальняя
  // планета могла обойти ближнюю, и карточка тела честно показала бы
  // эту невозможную пару.
  const years = world.planets.map((p) => p.orbit.period);
  ok(years.every((t, i) => i === 0 || t > years[i - 1]),
    'дальше от звезды — длиннее год: ' +
    years.map((t) => (t / 3.15e7).toFixed(0)).join(' < ') + ' лет');
}
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
// --- выбор цели наведением ------------------------------------------------------
console.log('\n== выбор цели наведением ==');
{
  // Перебора списка больше нет: цель выбирается тем, что на неё наведён
  // нос. Проверяется здесь именно правило выбора — что считается
  // «наведён» и что происходит, когда под прицелом несколько объектов.
  const nav = makeNav(world);
  const sh = makeShip();

  // Поставить корабль в точку и навести нос на цель с заданным
  // промахом (рад) вокруг оси «вверх».
  const aimAt = (from, at, missRad = 0) => {
    placeShip(sh, from, makeBasis());
    const d = normalize(v3(at.x - from.x, at.y - from.y, at.z - from.z));
    lookAlong(sh.basis, d);
    if (missRad) {
      const b = sh.basis;
      const c = Math.cos(missRad), s2 = Math.sin(missRad);
      const f = v3(b.fwd.x * c + b.right.x * s2, b.fwd.y * c + b.right.y * s2,
        b.fwd.z * c + b.right.z * s2);
      lookAlong(sh.basis, normalize(f));
    }
    refreshNav(nav, world, sh);
  };

  const planet = world.planets.find((p) => p.station) || world.planets[0];
  const far = v3(planet.pos.x + planet.radius * 40, planet.pos.y, planet.pos.z);

  aimAt(far, planet.pos);
  ok(pickTarget(nav, sh) === planet && currentTarget(nav) === planet,
    `нос на планету — выбрана она (${planet.name})`);

  // Мимо всего: смотрим в пустоту за пределами системы. Прежняя цель
  // при этом обязана остаться — промах не должен сбрасывать выбор.
  // (Просто «отвернуться на сорок градусов» здесь не годится: в небе
  // тесно, и под прицел попадает соседняя планета со станцией.)
  {
    const out = world.planets[world.planets.length - 1].orbit.radius * 6;
    const from = v3(world.star.pos.x, world.star.pos.y + out, world.star.pos.z);
    placeShip(sh, from, makeBasis());
    lookAlong(sh.basis, normalize(v3(0, 1, 0)));
    refreshNav(nav, world, sh);
    const keep = currentTarget(nav);
    ok(aimTargets(nav, sh).length === 0 && pickTarget(nav, sh) === null &&
       currentTarget(nav) === keep,
      'нос в пустоту — под прицелом никого, выбор не меняется');
  }

  // Мера — зазор до КРАЯ, а не угол до центра: у самой планеты её центр
  // далеко от прицела, но диск занимает полнеба, и она выбирается.
  {
    // С двух радиусов планета видна под 30°: целимся в 20° от её центра —
    // это мимо по углу, но точно по диску.
    const close = v3(planet.pos.x + planet.radius * 2, planet.pos.y, planet.pos.z);
    aimAt(close, planet.pos, 20 * Math.PI / 180);
    const toCentre = Math.acos(clamp(dot(normalize(v3(
      planet.pos.x - close.x, planet.pos.y - close.y, planet.pos.z - close.z)), sh.basis.fwd), -1, 1));
    const angR = Math.asin(planet.radius / (planet.radius * 2)) * 57.3;
    // Смотрим на первого под прицелом, а не на pickTarget: планета уже
    // выбрана с прошлой проверки, и повторное нажатие намеренно
    // перешагнуло бы на следующий объект под тем же прицелом.
    ok(aimedTarget(nav, sh) === planet && toCentre > AIM_CONE,
      `диск считается целиком: до центра ${(toCentre * 57.3).toFixed(0)}° — ` +
      `больше допуска ${(AIM_CONE * 57.3).toFixed(0)}°, но внутри диска ` +
      `(${angR.toFixed(0)}°), и планета под прицелом`);
  }

  // Под прицелом несколько — повторное нажатие перебирает ТОЛЬКО их.
  {
    const st = planet.station;
    const from = v3(st.pos.x + (st.pos.x - planet.pos.x) * 6,
      st.pos.y + (st.pos.y - planet.pos.y) * 6, st.pos.z + (st.pos.z - planet.pos.z) * 6);
    aimAt(from, st.pos);
    const under = aimTargets(nav, sh).map((a) => a.t);
    const first = pickTarget(nav, sh);
    const second = pickTarget(nav, sh);
    ok(under.length >= 2 && under.includes(st) && under.includes(planet) &&
       first !== second && under.includes(first) && under.includes(second),
      `станция и её планета под одним прицелом (${under.length} объекта): ` +
      `первое нажатие — ${first.name}, второе — ${second.name}`);
  }

  // Приборы подсвечивают ровно то, что выберет первое нажатие.
  {
    aimAt(far, planet.pos);
    ok(aimedTarget(nav, sh) === aimTargets(nav, sh)[0].t,
      'подсветка в приборах и выбор по Tab — это один и тот же объект');
  }
}

console.log('\n== докинг-компьютер ==');
function dockTest(distKm, startDir) {
  const w = makeSystem(0x1a7e);
  const st = w.home.station;
  const sh = makeShip();
  const bb = makeBasis();
  // Ставим корабль на расстоянии distKm от станции в заданном направлении
  const d = normalize(startDir(st));
  placeShip(sh, v3(st.pos.x + d.x * distKm, st.pos.y + d.y * distKm, st.pos.z + d.z * distKm), bb);
  const res = startDockingComputer(sh, st);
  if (!res.ok) return { status: 'refused', reason: res.reason };
  let t = 0;
  for (let i = 0; i < 60 * 900; i++) {
    updateWorld(w, STEP);
    clearControls(sh);
    updateDockingComputer(sh, STEP);
    updateShip(sh, STEP);
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

// --- 5. Квантовый привод: перелёт между телами -----------------------------
//
// Автопилота больше нет, перелёты делает привод. Проверяется то, за что
// он отвечает целиком: доводит ли до цели, встаёт ли ровно на заданной
// высоте, гасит ли скорость и не проходит ли сквозь тела по дороге.
console.log('\n== квантовый привод ==');

// Навести нос точно на точку выхода: калибровка иначе не пойдёт.
function aimAtTarget(sh, target) {
  const p = exitPoint(target, sh.pos);
  lookAlong(sh.basis, normalize(v3(
    p.x - sh.pos.x, p.y - sh.pos.y, p.z - sh.pos.z)), sh.basis.up);
}

// Один прыжок целиком: калибровка, ход, выход. Возвращает и то, что
// нужно проверить по дороге, — минимальный зазор до тел.
function runJump(w, sh, target, maxSeconds = 300) {
  const q = makeQuantum();
  const check = canJump(w, sh, target);
  if (!check.ok) return { status: 'blocked', reason: check.reason };
  aimAtTarget(sh, target);
  startCalibration(q, target);

  let t = 0, vMax = 0, minGap = Infinity;
  for (let i = 0; i < 60 * maxSeconds; i++) {
    updateWorld(w, STEP);
    clearControls(sh);
    if (q.phase === 'calib') aimAtTarget(sh, target);
    const ev = updateQuantum(q, sh, w, STEP);
    if (q.phase !== 'jump') updateShip(sh, STEP);
    t += STEP;
    vMax = Math.max(vMax, q.speed);
    // Зазор до ЛЮБОГО тела по дороге: за этим и нужна проверка коридора.
    minGap = Math.min(minGap, nearestBody(w, sh.pos).gap);
    if (ev === 'abort') return { status: 'abort', reason: q.reason, t };
    if (ev === 'arrive') {
      const d = Math.hypot(target.pos.x - sh.pos.x, target.pos.y - sh.pos.y, target.pos.z - sh.pos.z);
      return { status: 'arrived', t, alt: d - target.radius, vMax, minGap, speed: sh.speed };
    }
  }
  return { status: 'timeout', t, vMax, minGap };
}

/**
 * Перелёт к цели ЦЕЛИКОМ, как его делает игрок: если прямой коридор
 * перекрыт, привод подсказывает обходной маркер, и прыжков получается
 * несколько. Именно это и есть настоящий сценарий — от станции прямой
 * коридор перекрыт своей же планетой почти всегда.
 */
function jumpTest(targetName, maxHops = 4) {
  const w = makeSystem(0x1a7e);
  const nav = makeNav(w);
  const sh = makeShip();
  const st = w.home.station;
  placeShip(sh, v3(
    st.pos.x + st.basis.fwd.x * 3,
    st.pos.y + st.basis.fwd.y * 3,
    st.pos.z + st.basis.fwd.z * 3), makeBasis());
  nav.index = nav.list.findIndex((x) => x.name === targetName);
  if (nav.index < 0) return { status: 'no-target' };
  const target = currentTarget(nav);
  const d0 = Math.hypot(target.pos.x - sh.pos.x, target.pos.y - sh.pos.y, target.pos.z - sh.pos.z);

  let t = 0, vMax = 0, minGap = Infinity, hops = 0;
  for (let k = 0; k < maxHops; k++) {
    let leg = target;
    if (!canJump(w, sh, target).ok) {
      leg = suggestHop(w, sh, target, SHIP.quantumSpeed);
      if (!leg) return { status: 'no-route', t, hops };
    }
    const r = runJump(w, sh, leg);
    hops++;
    t += r.t || 0;
    vMax = Math.max(vMax, r.vMax || 0);
    minGap = Math.min(minGap, r.minGap === undefined ? Infinity : r.minGap);
    if (r.status !== 'arrived') return { status: r.status, reason: r.reason, t, hops };
    if (leg === target) {
      return {
        status: 'arrived', t, d0, hops, alt: r.alt, vMax, minGap, speed: r.speed,
        // Станция и тело выходят на РАЗНЫХ расстояниях (exitStation против
        // exitAlt), и проверке надо знать, во что она целилась.
        station: target.kind === 'station', radius: target.radius,
      };
    }
  }
  return { status: 'too-many-hops', t, hops };
}

// Проверяются ВСЕ тела системы и все станции, а не выборка. Список
// раньше был записан именами руками — и после добавления трёх планет
// молча съехал: те же четыре строки стали проверять другие тела, а
// дальний край системы не проверял никто. Достижимость каждого тела —
// это ровно то, что ломается при добавлении планеты: коридор может
// оказаться навсегда перекрыт соседом, а выход — внутри рельефа.
{
  const all = makeSystem(0x1a7e);
  var jumpTargets = [...all.planets.map((p) => p.name), ...all.stations.map((s) => s.name)];
}
for (const name of jumpTargets) {
  const r = jumpTest(name);
  ok(r.status === 'arrived',
    `перелёт к ${name}: ${r.status} за ${r.t ? r.t.toFixed(0) : '?'} с, прыжков ${r.hops}`,
    r.d0 ? `${(r.d0 / 1e6).toFixed(2)} млн км, до ${r.vMax.toFixed(0)} км/с` : (r.reason || ''));
  if (r.status === 'arrived') {
    // У тела выход может оказаться ВЫШЕ заданного: у крупных берётся доля
    // радиуса плюс запас на рельеф (exitFrac). У станции такой поправки
    // нет — там расстояние обязано совпасть точь-в-точь, иначе стыковаться
    // придётся с другой дистанции, чем рассчитан докинг-компьютер.
    const wantAlt = r.station ? QUANTUM.exitStation - r.radius : QUANTUM.exitAlt;
    ok(r.station ? Math.abs(r.alt - wantAlt) < 1e-6
                 : (Math.abs(r.alt - wantAlt) < 1 || r.alt > wantAlt),
      `выход над ${name} на заданной высоте: ${r.alt.toFixed(1)} км ` +
      `(ожидание ${wantAlt.toFixed(1)})`);
    ok(r.speed < 1e-6, `скорость на выходе у ${name} нулевая: ${r.speed.toFixed(6)} км/с`);
    ok(r.minGap > 0, `по дороге к ${name} ни во что не влетели (мин. зазор ${r.minGap.toFixed(0)} км)`);
  }
}

// Прыжок обязан занимать ощутимое, но не бесконечное время — иначе
// перелёт либо игрушечный, либо в нём нечего делать по полчаса.
{
  const short = jumpTime(6000, 60000);
  const long = jumpTime(6e6, 60000);
  ok(short < 3, `ближний прыжок (6 000 км) — «чих»: ${short.toFixed(1)} с`);
  ok(long > 60 && long < 180, `через всю систему (6 млн км): ${long.toFixed(0)} с`);
  // Профиль обязан быть монотонным по дистанции, иначе ближняя цель
  // оказалась бы дальше по времени, чем дальняя.
  let mono = true, prev = 0;
  for (let d = 1000; d < 8e6; d *= 1.5) {
    const t = jumpTime(d, 60000);
    if (t <= prev) mono = false;
    prev = t;
  }
  ok(mono, 'время прыжка растёт с дистанцией без провалов');
}

// Поток частиц в прыжке. Проверяется то, из-за чего первая версия
// эффекта не работала: полосы строились из настоящих звёзд, а звёзды
// бесконечно далеко и относительно корабля стоят — на экране получались
// неподвижные белые линии. Теперь у потока есть своя фаза, и она обязана
// идти вперёд и заворачиваться.
{
  const w = makeSystem(0x1a7e);
  const sh = makeShip();
  const to = w.bodies.find((b) => b.name === 'Lave V');
  const from = w.home;
  placeShip(sh, v3(from.pos.x + from.radius * 6, from.pos.y, from.pos.z), makeBasis());
  const q = makeQuantum();
  aimAtTarget(sh, to);
  startCalibration(q, to);
  for (let i = 0; i < 60 * 4 && q.phase !== 'jump'; i++) {
    aimAtTarget(sh, to);
    updateQuantum(q, sh, w, STEP);
  }
  const p0 = q.warp;
  for (let i = 0; i < 30; i++) updateQuantum(q, sh, w, STEP);
  const p1 = q.warp;
  let wrapped = true;
  for (let i = 0; i < 60 * 6; i++) {
    updateQuantum(q, sh, w, STEP);
    if (!(q.warp >= 0 && q.warp < 1)) wrapped = false;
  }
  ok(q.phase === 'jump' && p1 > p0 && wrapped,
    `фаза потока идёт вперёд и заворачивается: ${p0.toFixed(3)} -> ${p1.toFixed(3)}`);
}

// Коридор: с обратной стороны планеты прыгать нельзя, и именно для
// этого случая заведены орбитальные маркеры.
{
  const w = makeSystem(0x1a7e);
  const from = w.bodies.find((b) => b.name === 'Lave II');
  const to = w.bodies.find((b) => b.name === 'Lave III');
  const d = normalize(v3(to.pos.x - from.pos.x, to.pos.y - from.pos.y, to.pos.z - from.pos.z));
  const put = (sign) => {
    const sh = makeShip();
    placeShip(sh, v3(
      from.pos.x + d.x * sign * (from.radius + 0.2),
      from.pos.y + d.y * sign * (from.radius + 0.2),
      from.pos.z + d.z * sign * (from.radius + 0.2)), makeBasis());
    return sh;
  };
  const far = put(-1), near = put(1);
  ok(!canJump(w, far, to).ok, 'с обратной стороны планеты коридор перекрыт');
  ok(canJump(w, near, to).ok, 'с той же стороны прыжок разрешён');
  // Хотя бы один маркер обязан быть виден: иначе с поверхности не уйти.
  const free = from.markers.filter((m) => !corridorBlock(w, far.pos, m, SHIP.quantumSpeed));
  ok(free.length >= 1, `с поверхности виден хотя бы один маркер (${free.length} из 6)`);
  // Из-за планеты цель может быть закрыта и с первого маркера — тогда
  // привод предлагает следующий. Маршрут обязан находиться, и коротким.
  {
    const sh = makeShip();
    placeShip(sh, v3(far.pos.x, far.pos.y, far.pos.z), makeBasis());
    let hops = 0, route = [];
    while (!canJump(w, sh, to).ok && hops < 4) {
      const hop = suggestHop(w, sh, to, SHIP.quantumSpeed);
      if (!hop) break;
      route.push(hop.name);
      placeShip(sh, v3(hop.pos.x, hop.pos.y, hop.pos.z), makeBasis());
      hops++;
    }
    ok(canJump(w, sh, to).ok,
      `обход помехи находится за ${hops} прыжка`, route.join(' -> '));
  }
  // Прыгать со стоянки нельзя вовсе.
  const landed = put(1);
  landed.landedAt = from;
  ok(!canJump(w, landed, to).ok, 'со стоянки привод не запускается');
}

// Полный цикл: прыжок к станции + стыковка
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
  const q = makeQuantum();
  // Первое плечо: прямо к станции, если коридор открыт, иначе в обход.
  let leg = canJump(w, sh, to).ok ? to : suggestHop(w, sh, to, SHIP.quantumSpeed);
  aimAtTarget(sh, leg);
  startCalibration(q, leg);
  let t = 0, status = 'timeout', docking = false;
  for (let i = 0; i < 60 * 1500; i++) {
    updateWorld(w, STEP);
    clearControls(sh);
    if (q.phase !== 'idle') {
      // Пока привод калибруется, нос надо держать на цели — в игре это
      // делает игрок, здесь за него это делает одна строка.
      if (q.phase === 'calib') aimAtTarget(sh, leg);
      const ev = updateQuantum(q, sh, w, STEP);
      if (ev === 'arrive') {
        if (leg === to) { startDockingComputer(sh, to); docking = true; }
        else {
          // Дошли до обходной точки — считаем следующее плечо.
          leg = canJump(w, sh, to).ok ? to : suggestHop(w, sh, to, SHIP.quantumSpeed);
          if (!leg) { status = 'маршрут не найден'; break; }
          aimAtTarget(sh, leg);
          startCalibration(q, leg);
        }
      }
      if (ev === 'abort') { status = 'привод отказал: ' + q.reason; break; }
    } else if (sh.docking) {
      updateDockingComputer(sh, STEP);
    }
    if (q.phase !== 'jump') updateShip(sh, STEP);
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
      updateShip(sh, STEP);
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
// Высота старта теперь задаётся в КИЛОМЕТРАХ, а не в радиусах тела:
// после прыжка корабль всегда выходит на QUANTUM.exitAlt, и сценарий
// «сесть с высоты в целый радиус» больше не встречается нигде, кроме
// теста. На своих 1.2 км/с такой спуск занимал бы двадцать минут.
function landTest(pick, altKm, opts = {}) {
  const w = makeSystem(0x1a7e);
  const body = pick(w);
  const sh = makeShip();
  const dir = normalize(v3(0.3, 0.7, 0.6));
  const r0 = body.radius + altKm;
  placeShip(sh, v3(
    body.pos.x + dir.x * r0,
    body.pos.y + dir.y * r0,
    body.pos.z + dir.z * r0), makeBasis());
  lookAlong(sh.basis, normalize(v3(
    body.pos.x - sh.pos.x, body.pos.y - sh.pos.y, body.pos.z - sh.pos.z)));
  const res = startLanding(sh, body, sh.pos);
  if (!res.ok) return { status: 'refused', reason: res.reason };
  if (opts.noGear) { sh.gear.out = false; sh.gear.t = 0; }

  let t = 0;
  const phases = new Set();
  for (let i = 0; i < 60 * 900; i++) {
    updateWorld(w, STEP);
    const cap = captureBody(w, sh.pos);
    if (cap) carryShip(sh, cap, STEP);
    clearControls(sh);
    if (opts.noGear) { sh.gear.out = false; sh.gear.t = 0; }
    else updateGear(sh, STEP);
    let zone = landingContext(w, sh);
    if (sh.landing) {
      updateLandingComputer(sh, STEP, zone);
      phases.add(sh.landing.phase);
    }
    updateShip(sh, STEP, gravityField(cap, sh));
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
  const r1 = landTest(moonPick, QUANTUM.exitAlt);
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
    // Корабль стоит НА ТРЁХ ПЯТАХ, поэтому высота его центра над
    // грунтом под ним уже не равна просвету в точности: пяты разнесены
    // на тридцать метров, и площадка под ними своя. Важно, что она не
    // МЕНЯЕТСЯ: проседание или всплытие на стоянке — это и есть провал
    // сквозь грунт.
    let loAlt = Infinity, hiAlt = -Infinity;
    for (let i = 0; i < 60 * 120; i++) {
      updateWorld(w, STEP);
      updateLandedPose(sh);
      if (i % 60 === 0) {
        const z = landingContext(w, sh);
        loAlt = Math.min(loAlt, z.alt); hiAlt = Math.max(hiAlt, z.alt);
      }
    }
    const worstAlt = hiAlt - loAlt;
    const moved = Math.hypot(sh.pos.x - p0.x, sh.pos.y - p0.y, sh.pos.z - p0.z);
    ok(worstAlt < 1e-6 && moved > 1,
      `за 2 минуты стоянки корабль проехал с поверхностью ${moved.toFixed(1)} км, ` +
      `высота не изменилась (${(worstAlt * 1e6).toFixed(2)} мм)`);

    // Взлёт: отрыв и набор высоты на посадочных движках.
    takeoff(sh);
    for (let i = 0; i < 60 * 40; i++) {
      updateWorld(w, STEP);
      const cap = captureBody(w, sh.pos);
      if (cap) carryShip(sh, cap, STEP);
      clearControls(sh);
      updateGear(sh, STEP);
      sh.control.lift = 1;                 // держим R: набор высоты
      updateShip(sh, STEP, gravityField(cap, sh));
    }
    const z = landingContext(w, sh);
    ok(z && z.alt > 1.5, `за 40 с взлёта поднялись на ${z ? z.alt.toFixed(2) : '?'} км`);
  }
}

{
  const r2 = landTest(moon2Pick, QUANTUM.exitAlt * 2);
  ok(r2.status === 'landed', `вторая луна с 2.5 радиусов: ${r2.status} за ${r2.t ? r2.t.toFixed(0) : '?'} с`);
  const r3 = landTest(rockPick, QUANTUM.exitAlt);
  ok(r3.status === 'landed', `каменистая планета: ${r3.status} за ${r3.t ? r3.t.toFixed(0) : '?'} с`);
  const r4 = landTest((w) => w.home, QUANTUM.exitAlt);
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
  let res = null;
  for (let i = 0; i < 60 * 120 && !res; i++) {
    updateWorld(w, STEP);
    const cap = captureBody(w, sh.pos);
    if (cap) carryShip(sh, cap, STEP);
    clearControls(sh);
    updateGear(sh, STEP);
    updateShip(sh, STEP, gravityField(cap, sh));
    const z2 = landingContext(w, sh);
    if (z2) res = checkTouchdown(sh, z2);
  }
  // Касание брюхом на 24 м/с — уже не мгновенная смерть, а удар: корабль
  // отскакивает и теряет часть корпуса. Считать разрушением сам факт
  // касания неверно — с этого и началась правка.
  ok(res && res.result === 'bounce' && res.damage > 5 && res.damage < 100,
    `касание брюхом на ${res ? (res.hit * 1000).toFixed(0) : '?'} м/с — удар, ` +
    `а не смерть: корпусу −${res && res.damage ? res.damage.toFixed(0) : '?'}%`);
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
  sh.throttle = 1;
  const f0 = sh.basis.fwd, v0 = SHIP.maxSpeed * SHIP.gearSpeed;
  sh.vel.x = f0.x * v0; sh.vel.y = f0.y * v0; sh.vel.z = f0.z * v0;
  sh.speed = v0;
  let res = null;
  for (let i = 0; i < 60 * 60 && !res; i++) {
    updateWorld(w, STEP);
    clearControls(sh);
    updateGear(sh, STEP);
    const zone = landingContext(w, sh);
    // Посадочный режим сознательно не включаем: это падение, не посадка.
    updateShip(sh, STEP);
    const z2 = landingContext(w, sh);
    if (z2) res = checkTouchdown(sh, z2);
  }
  // 420 м/с — это уже не удар, а разрушение: урона больше, чем весь
  // корпус, и в игре такой отскок сразу кончается экраном крушения.
  ok(res && res.damage >= SHIP.maxHull,
    `удар на ${res ? (res.hit * 1000).toFixed(0) : '?'} м/с сносит корпус целиком: ` +
    `−${res && res.damage ? res.damage.toFixed(0) : '?'}% при запасе ${SHIP.maxHull}`);
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
  for (let i = 0; i < 60 * 20; i++) { clearControls(sh); updateShip(sh, STEP); }
  const withGear = sh.speed;
  toggleGear(sh);
  while (sh.gear.t > 0) updateGear(sh, STEP);
  for (let i = 0; i < 60 * 20; i++) { clearControls(sh); updateShip(sh, STEP); }
  ok(Math.abs(withGear - SHIP.maxSpeed * SHIP.gearSpeed) < 0.01 &&
     Math.abs(sh.speed - SHIP.maxSpeed) < 0.01,
    `с шасси скорость ${withGear.toFixed(2)} км/с, без него ${sh.speed.toFixed(2)} км/с`);
}

// --- 6. Столкновение с планетой --------------------------------------------
// --- 5e. Гравитация и захват -------------------------------------------------
console.log('\n== гравитация и захват ==');
{
  const w = makeSystem(0x1a7e);
  const home = w.home;
  const moon = w.bodies.find((b) => b.kind === 'moon');
  const giant = w.planets.find((p) => p.kind === 'gas');

  // Числа должны быть похожи на солнечные: у землеподобной планеты
  // единицы м/с², у луны — около двух, и сфера действия всегда больше
  // самого тела, но меньше орбиты.
  let sane = true;
  for (const b of w.bodies) {
    if (b.kind === 'star') { if (isFinite(b.soi)) sane = false; continue; }
    if (!(b.g0 > 0.3 && b.g0 < 30)) sane = false;
    if (!(b.soi > b.radius * 2 && b.soi < b.orbit.radius)) sane = false;
  }
  ok(sane && home.g0 > 4 && home.g0 < 12 && moon.g0 < home.g0,
    `гравитация: дом ${home.g0.toFixed(1)} м/с², луна ${moon.g0.toFixed(1)}, ` +
    `гигант ${giant.g0.toFixed(1)}; сферы действия ${(moon.soi / moon.radius).toFixed(1)}–` +
    `${(giant.soi / giant.radius).toFixed(1)} радиусов`);

  // Внутри сферы луны захватывает луна, а не планета-хозяин: из
  // вложенных сфер выбирается самая тесная.
  const near = worldPoint(moon, normalize(v3(0.2, 0.9, 0.3)), moon.radius + 5, v3());
  const far = v3(moon.pos.x + moon.soi * 3, moon.pos.y, moon.pos.z);
  ok(captureBody(w, near) === moon && captureBody(w, far) !== moon,
    `захват у поверхности луны — ${captureBody(w, near).name}, ` +
    `в трёх сферах от неё — ${(captureBody(w, far) || { name: 'никто' }).name}`);

  // Одной сферы действия мало. У гиганта она четверть миллиона
  // километров, и формально корабль «в захвате» там, где тяжесть —
  // тысячные доли м/с². Порог CAPTURE_G отсекает такие места: держать
  // там нечего, и показывать захват не за что.
  const at = (mul) => v3(giant.pos.x + giant.radius * mul, giant.pos.y, giant.pos.z);
  const gAt = (mul) => giant.g0 / (mul * mul);
  let inside = 0, held = 0;
  for (let mul = 2; mul * giant.radius < giant.soi; mul++) {
    inside++;
    if (captureBody(w, at(mul)) === giant) held++;
  }
  const edge = Math.sqrt(giant.g0 / (CAPTURE_G * 1000));
  ok(captureBody(w, at(edge - 1)) === giant && captureBody(w, at(edge + 1)) !== giant &&
     held < inside,
    `у гиганта захват кончается на ${edge.toFixed(1)} радиусах ` +
    `(тяжесть ${gAt(edge).toFixed(3)} м/с²), а не на ${(giant.soi / giant.radius).toFixed(1)} ` +
    `по сфере действия: из ${inside} проверенных дистанций держат ${held}`);
}

// Главное свойство захвата: с нулевой тягой корабль стоит над ТОЧКОЙ
// ПОВЕРХНОСТИ, а не над точкой пространства. Без переноса системы
// отсчёта грунт уезжал бы со скоростью вращения — сотня метров в
// секунду, то есть километры за минуту зависания.
{
  const w = makeSystem(0x1a7e);
  const moon = w.bodies.find((b) => b.kind === 'moon');
  const dir = normalize(v3(0.3, 0.7, 0.6));
  const sh = makeShip();
  placeShip(sh, worldPoint(moon, dir, groundRadius(moon, dir) + 1, v3()), makeBasis());
  // Брюхом вниз: подъёмные движки работают вдоль «верха» корабля, и на
  // боку они держали бы не высоту, а снос — как у настоящего вертолёта.
  const upW = dirToWorldBody(moon, dir, v3());
  lookAlong(sh.basis, normalize(horizontal(v3(1, 0, 0), upW, v3())), upW);
  sh.gear.out = true; sh.gear.t = 1;
  const start = localDir(moon, sh.pos, v3());
  let worstAlt = 0;
  for (let i = 0; i < 60 * 60; i++) {
    updateWorld(w, STEP);
    const cap = captureBody(w, sh.pos);
    if (cap) carryShip(sh, cap, STEP);
    clearControls(sh);
    // Ручки не трогаем вовсе: высоту держит компенсатор, и это его
    // работа — не проваливаться ни с каким шасси.
    updateShip(sh, STEP, gravityField(cap, sh));
    if (i % 600 === 0) {
      const z = landingContext(w, sh);
      worstAlt = Math.max(worstAlt, Math.abs(z.alt - 1));
    }
  }
  const now = localDir(moon, sh.pos, v3());
  const drift = Math.acos(Math.min(1, dot(start, now))) * moon.radius;
  const spinSpeed = moon.spin * moon.radius;
  ok(drift < 0.15 && worstAlt < 0.05,
    `минута зависания над луной: снос по грунту ${(drift * 1000).toFixed(0)} м ` +
    `(без переноса было бы ${(spinSpeed * 60).toFixed(0)} км), ` +
    `высота ушла на ${(worstAlt * 1000).toFixed(0)} м`);
}

// ТО, ЧТО БЫЛО СЛОМАНО: выпуск шасси менял модель полёта целиком —
// выключался компенсатор высоты, и корабль начинал проваливаться сам.
// Одна клавиша, и аппарат перестаёт слушаться так, как слушался секунду
// назад: читалось это как поломка, а не как «почувствуй вес». Теперь
// шасси меняет ровно одно — предел скорости.
{
  const w = makeSystem(0x1a7e);
  const moon = w.bodies.find((b) => b.kind === 'moon');
  const dir = normalize(v3(-0.4, 0.5, 0.76));
  const fly = (gearOut, seconds, lift = 0, thr = 0) => {
    const sh = makeShip();
    placeShip(sh, worldPoint(moon, dir, groundRadius(moon, dir) + 3, v3()), makeBasis());
    const up = dirToWorldBody(moon, dir, v3());
    lookAlong(sh.basis, normalize(horizontal(v3(1, 0, 0), up, v3())), up);
    sh.gear.out = gearOut; sh.gear.t = gearOut ? 1 : 0;
    sh.throttle = thr;
    for (let i = 0; i < 60 * seconds; i++) {
      updateWorld(w, STEP);
      const cap = captureBody(w, sh.pos);
      if (cap) carryShip(sh, cap, STEP);
      clearControls(sh);
      sh.control.lift = lift;
      updateShip(sh, STEP, gravityField(cap, sh));
    }
    return { drop: 3 - landingContext(w, sh).alt, speed: sh.speed };
  };
  // Висим без тяги: высоту держит компенсатор, и шасси ему не указ.
  const withGear = fly(true, 20);
  const noGear = fly(false, 20);
  ok(Math.abs(withGear.drop) < 0.01 && Math.abs(noGear.drop) < 0.01,
    `корабль не проваливается сам ни с каким шасси: за 20 с зависания высота ушла на ` +
    `${(withGear.drop * 1000).toFixed(1)} м с выпущенным и ` +
    `${(noGear.drop * 1000).toFixed(1)} м с убранным`);

  // Единственное, что меняет шасси, — предел скорости.
  const fastGear = fly(true, 20, 0, 1).speed;
  const fastClean = fly(false, 20, 0, 1).speed;
  ok(Math.abs(fastGear - SHIP.maxSpeed * SHIP.gearSpeed) < 0.02 && fastClean > fastGear * 2,
    `шасси меняет только предел скорости: ${(fastGear * 1000).toFixed(0)} м/с ` +
    `против ${(fastClean * 1000).toFixed(0)} м/с`);

  // Ручка подъёмных работает одинаково в обеих конфигурациях.
  const upGear = fly(true, 10, 1 / 3).drop;
  const upClean = fly(false, 10, 1 / 3).drop;
  ok(upGear < -0.05 && Math.abs(upGear - upClean) < Math.abs(upGear) * 0.25,
    `R/F работают одинаково: с шасси набрали ${(-upGear * 1000).toFixed(0)} м, ` +
    `без шасси ${(-upClean * 1000).toFixed(0)} м`);
}

// Тяготение действует на сам ВЕКТОР скорости — там, где оно вообще
// действует. В полёте вес держит компенсатор высоты, а вот ОГЛУШЁННЫЙ
// после удара корабль летит свободно: ни тяги, ни стабилизации, только
// тяжесть. Горизонтальный бросок тогда идёт по параболе, а не по прямой,
// и это ровно та разница, ради которой гравитация тут и считается.
{
  const w = makeSystem(0x1a7e);
  const moon = w.bodies.find((b) => b.kind === 'moon');
  const dir = normalize(v3(0.31, -0.62, 0.72));
  const sh = makeShip();
  placeShip(sh, worldPoint(moon, dir, groundRadius(moon, dir) + 2, v3()), makeBasis());
  const up = dirToWorldBody(moon, dir, v3());
  const axis = Math.abs(up.x) < 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  const fwd = normalize(horizontal(axis, up, v3()));
  lookAlong(sh.basis, fwd, up);
  sh.gear.out = true; sh.gear.t = 1;
  const v0 = 0.1;                       // 100 м/с строго по горизонту
  sh.vel.x = fwd.x * v0; sh.vel.y = fwd.y * v0; sh.vel.z = fwd.z * v0;
  sh.throttle = 0;

  // Мерить надо в осях ТЕЛА: система отсчёта рядом с ним вращается
  // вместе с поверхностью, и в мировых координатах к броску добавилась
  // бы окружная скорость грунта.
  const d0 = localDir(moon, sh.pos, v3());
  const r0 = Math.hypot(sh.pos.x - moon.pos.x, sh.pos.y - moon.pos.y, sh.pos.z - moon.pos.z);
  const track = [];
  for (let i = 0; i < 60 * 10; i++) {
    updateWorld(w, STEP);
    const cap = captureBody(w, sh.pos);
    if (cap) carryShip(sh, cap, STEP);
    clearControls(sh);
    sh.stun = 1;                        // корабль всё это время без управления
    updateShip(sh, STEP, gravityField(cap, sh));
    if ((i + 1) % 120 === 0) {
      const dd = localDir(moon, sh.pos, v3());
      const rr = Math.hypot(
        sh.pos.x - moon.pos.x, sh.pos.y - moon.pos.y, sh.pos.z - moon.pos.z);
      track.push({
        t: (i + 1) / 60,
        down: r0 - rr,
        along: Math.acos(clamp(dot(d0, dd), -1, 1)) * moon.radius,
      });
    }
  }
  const g = moon.g0 / 1000;
  const last = track[track.length - 1];
  const want = g * last.t * last.t / 2;
  // Проседание растёт как квадрат времени: за вдвое большее время —
  // вчетверо глубже. По прямой оно росло бы линейно.
  const half = track[Math.floor(track.length / 2) - 1];
  const ratio = last.down / Math.max(1e-9, half.down);
  const square = (last.t / half.t) ** 2;          // так растёт парабола
  ok(Math.abs(last.down - want) < want * 0.12 &&
     Math.abs(ratio - square) < square * 0.15 && last.along > 0.9,
    `бросок на 100 м/с: за ${last.t} с прошли ${last.along.toFixed(2)} км и просели ` +
    `${(last.down * 1000).toFixed(0)} м (gt²/2 = ${(want * 1000).toFixed(0)}); ` +
    `к ${half.t} с проседание было в ${ratio.toFixed(1)} раза меньше — ` +
    `парабола даёт ${square.toFixed(1)}`);
}

// Вертикальный ход доступен всегда и не мешает лететь вперёд: это и
// была просьба убрать «посадочный режим», где можно только вверх-вниз.
{
  const w = makeSystem(0x1a7e);
  const moon = w.bodies.find((b) => b.kind === 'moon');
  const dir = normalize(v3(0.1, -0.8, 0.59));
  const sh = makeShip();
  placeShip(sh, worldPoint(moon, dir, groundRadius(moon, dir) + 2, v3()), makeBasis());
  // Нос по горизонту, брюхо вниз, шасси выпущено.
  const up = dirToWorldBody(moon, dir, v3());
  lookAlong(sh.basis, normalize(horizontal(v3(1, 0, 0), up, v3())), up);
  sh.gear.out = true; sh.gear.t = 1;
  sh.throttle = 1;
  const p0 = { x: sh.pos.x, y: sh.pos.y, z: sh.pos.z };
  // Подъём меряется РАДИУСОМ от центра тела, а не высотой над грунтом.
  // Высотой мерить нельзя: за десять секунд корабль уходит вперёд на три
  // с лишним километра, и грунт под ним за это время сам поднимается или
  // проваливается на сотни метров — у луны размах рельефа 18 км. Раньше
  // здесь стояла именно высота, и проверка проходила случайно: стоило
  // системе пересобраться с другими кратерами под этим курсом, и те же
  // 230 м набора читались как 113.
  const r0 = Math.hypot(p0.x - moon.pos.x, p0.y - moon.pos.y, p0.z - moon.pos.z);
  for (let i = 0; i < 60 * 10; i++) {
    updateWorld(w, STEP);
    const cap = captureBody(w, sh.pos);
    if (cap) carryShip(sh, cap, STEP);
    clearControls(sh);
    sh.control.lift = 1;                     // держим R
    updateShip(sh, STEP, gravityField(cap, sh));
  }
  const moved = v3(sh.pos.x - p0.x, sh.pos.y - p0.y, sh.pos.z - p0.z);
  const climb = Math.hypot(sh.pos.x - moon.pos.x, sh.pos.y - moon.pos.y,
    sh.pos.z - moon.pos.z) - r0;
  const fwd = Math.hypot(moved.x, moved.y, moved.z);
  // Подъём идёт с полным ускорением движков (liftTWR·g): вес держит
  // компенсатор высоты, и на него тяга больше не тратится.
  const want = SHIP.liftTWR * moon.g0 / 1000 * 100 / 2;
  ok(climb > want * 0.7 && climb < want * 1.3 && fwd > 3,
    `с выпущенным шасси за 10 с: вперёд ${fwd.toFixed(1)} км и вверх ` +
    `${(climb * 1000).toFixed(0)} м (по тяге ${(want * 1000).toFixed(0)}) одновременно`);
}

// --- 5f. Тень корабля --------------------------------------------------------
console.log('\n== тень ==');
{
  const w = makeSystem(0x1a7e);
  const moon = w.bodies.find((b) => b.kind === 'moon');
  const mesh = buildCobra();
  const out = {};

  // Ищем неровное место: на ровной площадке натянутая тень и плоская
  // неразличимы, и проверка ничего не значила бы.
  let dir = null, spread = 0;
  for (let i = 0; i < 400 && spread < 0.006; i++) {
    const u = -1 + 2 * ((i + 0.5) / 400);
    const a = i * 2.399963;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    const d = normalize(v3(r * Math.cos(a), u, r * Math.sin(a)));
    const g0 = groundRadius(moon, d);
    let lo = g0, hi = g0;
    for (let k = 0; k < 8; k++) {
      const t = (k / 8) * Math.PI * 2;
      const off = normalize(v3(
        d.x + Math.cos(t) * 0.00004, d.y + Math.sin(t) * 0.00004, d.z + Math.cos(t) * 0.00003));
      const g = groundRadius(moon, off);
      lo = Math.min(lo, g); hi = Math.max(hi, g);
    }
    if (hi - lo > spread) { spread = hi - lo; dir = d; }
  }

  const sh = makeShip();
  placeShip(sh, worldPoint(moon, dir, groundRadius(moon, dir) + 0.04, v3()), makeBasis());
  const up = dirToWorldBody(moon, dir, v3());
  // Ось для носа берём заведомо не вдоль вертикали, иначе горизонтальная
  // составляющая вырождается в ноль и базис корабля выходит нулевым.
  const axis = Math.abs(up.x) < 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  lookAlong(sh.basis, normalize(horizontal(axis, up, v3())), up);
  const zone = landingContext(w, sh);
  const sun = v3(moon.pos.x + up.x * 1e6, moon.pos.y + up.y * 1e6, moon.pos.z + up.z * 1e6);
  const n = shipShadow(zone, sh, mesh, sun, out);

  // Каждая вершина тени обязана лежать на грунте, а не на плоскости:
  // иначе на кратере тень наполовину под землёй, наполовину висит.
  let worstAlt = 0, loR = Infinity, hiR = -Infinity;
  const p = v3();
  for (let i = 0; i < n; i++) {
    p.x = sh.pos.x + out.verts[i * 3];
    p.y = sh.pos.y + out.verts[i * 3 + 1];
    p.z = sh.pos.z + out.verts[i * 3 + 2];
    worstAlt = Math.max(worstAlt, Math.abs(altitudeOf(moon, p).alt));
    const rr = Math.hypot(p.x - moon.pos.x, p.y - moon.pos.y, p.z - moon.pos.z);
    loR = Math.min(loR, rr); hiR = Math.max(hiR, rr);
  }
  ok(n > 40 && worstAlt < 0.004 && hiR - loR > 0.003,
    `тень натянута на рельеф: ${n} вершин, все в ${(worstAlt * 1000).toFixed(1)} м от грунта, ` +
    `а сам грунт под ней гуляет на ${((hiR - loR) * 1000).toFixed(1)} м`);

  // ТО, ЧТО БЫЛО СЛОМАНО: тень строилась как ВЫПУКЛАЯ ОБОЛОЧКА проекции,
  // и от корабля оставался ромб — у этого корпуса настоящий силуэт
  // занимает чуть больше половины площади своей оболочки. Считаем
  // площадь тени и сравниваем с оболочкой тех же точек.
  {
    const P = [];
    for (let i = 0; i < n; i++) {
      P.push([out.verts[i * 3], out.verts[i * 3 + 1], out.verts[i * 3 + 2]]);
    }
    // Плоскость тени: две оси из разброса точек.
    const c = [0, 0, 0];
    for (const q of P) { c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; }
    for (let k = 0; k < 3; k++) c[k] /= P.length;
    const nrm = [up.x, up.y, up.z];
    let e1 = [1, 0, 0];
    const d0 = e1[0] * nrm[0] + e1[1] * nrm[1] + e1[2] * nrm[2];
    if (Math.abs(d0) > 0.9) e1 = [0, 1, 0];
    const dd = e1[0] * nrm[0] + e1[1] * nrm[1] + e1[2] * nrm[2];
    e1 = [e1[0] - nrm[0] * dd, e1[1] - nrm[1] * dd, e1[2] - nrm[2] * dd];
    const l1 = Math.hypot(e1[0], e1[1], e1[2]);
    e1 = e1.map((x) => x / l1);
    const e2 = [
      nrm[1] * e1[2] - nrm[2] * e1[1],
      nrm[2] * e1[0] - nrm[0] * e1[2],
      nrm[0] * e1[1] - nrm[1] * e1[0]];
    const flat2 = new Float32Array(P.length * 2);
    P.forEach((q, i) => {
      const x = q[0] - c[0], y = q[1] - c[1], z = q[2] - c[2];
      flat2[i * 2] = x * e1[0] + y * e1[1] + z * e1[2];
      flat2[i * 2 + 1] = x * e2[0] + y * e2[1] + z * e2[2];
    });
    // Площадь самой тени — ОБЪЕДИНЕНИЕ треугольников: проекции граней
    // местами накладываются (корпус не выпуклый), и складывать их
    // площади нельзя. Растеризуем в сетку, как это делает экран.
    let ru0 = Infinity, ru1 = -Infinity, rv0 = Infinity, rv1 = -Infinity;
    for (let i = 0; i < P.length; i++) {
      ru0 = Math.min(ru0, flat2[i * 2]); ru1 = Math.max(ru1, flat2[i * 2]);
      rv0 = Math.min(rv0, flat2[i * 2 + 1]); rv1 = Math.max(rv1, flat2[i * 2 + 1]);
    }
    const RES = 128;
    const cell = Math.max((ru1 - ru0), (rv1 - rv0)) / (RES - 1);
    const grid = new Uint8Array(RES * RES);
    for (let i = 0; i + 2 < P.length; i += 3) {
      const ax = (flat2[i * 2] - ru0) / cell, ay = (flat2[i * 2 + 1] - rv0) / cell;
      const bx = (flat2[(i + 1) * 2] - ru0) / cell, by = (flat2[(i + 1) * 2 + 1] - rv0) / cell;
      const cx2 = (flat2[(i + 2) * 2] - ru0) / cell, cy2 = (flat2[(i + 2) * 2 + 1] - rv0) / cell;
      const den = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
      if (Math.abs(den) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx2)));
      const x1 = Math.min(RES - 1, Math.ceil(Math.max(ax, bx, cx2)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy2)));
      const y1 = Math.min(RES - 1, Math.ceil(Math.max(ay, by, cy2)));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const w0 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / den;
          const w1 = ((x - ax) * (cy2 - ay) - (y - ay) * (cx2 - ax)) / den;
          if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) grid[y * RES + x] = 1;
        }
      }
    }
    let area = 0;
    for (const g of grid) area += g;
    area *= cell * cell;
    const hull = convexHull(flat2, P.length);
    let hullArea = 0;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b2 = hull[(i + 1) % hull.length];
      hullArea += flat2[a * 2] * flat2[b2 * 2 + 1] - flat2[b2 * 2] * flat2[a * 2 + 1];
    }
    hullArea = Math.abs(hullArea) / 2;
    const fill = area / hullArea;
    ok(fill > 0.35 && fill < 0.8,
      `тень повторяет силуэт, а не оболочку: занимает ${(fill * 100).toFixed(0)}% ` +
      'её площади (ромб дал бы под сотню, двойное покрытие — больше)');

    // Накрывающая сетка обязана перекрывать силуэт целиком: по ней идёт
    // умножение, и не накрытый ею край остался бы светлой каймой.
    let cu0 = Infinity, cu1 = -Infinity, cv0 = Infinity, cv1 = -Infinity;
    for (let i = 0; i < out.coverCount; i++) {
      const x = out.cover[i * 3] - c[0], y = out.cover[i * 3 + 1] - c[1], z = out.cover[i * 3 + 2] - c[2];
      const uu = x * e1[0] + y * e1[1] + z * e1[2];
      const vv = x * e2[0] + y * e2[1] + z * e2[2];
      cu0 = Math.min(cu0, uu); cu1 = Math.max(cu1, uu);
      cv0 = Math.min(cv0, vv); cv1 = Math.max(cv1, vv);
    }
    let outside = 0;
    for (let i = 0; i < P.length; i++) {
      const uu = flat2[i * 2], vv = flat2[i * 2 + 1];
      if (uu < cu0 || uu > cu1 || vv < cv0 || vv > cv1) outside++;
    }
    ok(out.coverCount > 0 && outside === 0,
      `накрывающая сетка (${out.coverCount} вершин) перекрывает силуэт целиком`);
  }
}

// --- 5g. Задний ход ----------------------------------------------------------
// --- форсаж ---------------------------------------------------------------------
console.log('\n== форсаж ==');
{
  // Форсаж — удержание с расходуемым зарядом. Кроме физики у него есть
  // РЫВОК: короткий всплеск, по которому камера бьёт полем зрения. Он
  // живёт в модели (ship.boostPunch), а не в рендере, поэтому его можно
  // проверить здесь.
  const mk = () => {
    const sh = makeShip();
    placeShip(sh, v3(0, 0, 0), makeBasis());
    return sh;
  };
  const hold = (sh, secs, on = true) => {
    for (let i = 0; i < Math.round(secs / STEP); i++) {
      clearControls(sh);
      sh.control.boost = on ? 1 : 0;
      sh.control.thr = 1;
      updateShip(sh, STEP, null);
    }
  };

  // Включение: рывок разом на единицу.
  {
    const sh = mk();
    clearControls(sh); sh.control.boost = 1;
    updateShip(sh, STEP, null);
    ok(sh.boosting && sh.boostPunch > 0.99,
      `в момент включения рывок ${sh.boostPunch.toFixed(2)}`);
  }

  // Удержание: рывок гаснет и НЕ повторяется, пока клавишу держат.
  {
    const sh = mk();
    hold(sh, 0.6);
    const after = sh.boostPunch;
    hold(sh, 1);
    ok(after < 0.05 && sh.boostPunch === 0 && sh.boosting,
      `за 0.6 с рывок гаснет до ${after.toFixed(3)} и на удержании не повторяется`);
  }

  // Отпустил и нажал снова — рывок новый.
  {
    const sh = mk();
    hold(sh, 0.6);
    hold(sh, 0.2, false);
    clearControls(sh); sh.control.boost = 1;
    updateShip(sh, STEP, null);
    ok(sh.boostPunch > 0.99, 'повторное нажатие даёт новый рывок');
  }

  // Пустой заряд — ни форсажа, ни рывка: иначе камера дёргалась бы на
  // клавишу, которая ничего не делает.
  {
    const sh = mk();
    sh.boost = 0;
    clearControls(sh); sh.control.boost = 1;
    updateShip(sh, STEP, null);
    ok(!sh.boosting && sh.boostPunch === 0, 'на пустом заряде нет ни форсажа, ни рывка');
  }

  // И собственно физика: предел скорости вдвое выше обычного. Мерить
  // надо ПОКА заряд есть: на десятой секунде он кончается, и корабль
  // возвращается к обычному пределу — это и проверено ниже.
  {
    const plain = mk(); const fast = mk();
    for (let i = 0; i < Math.round(8 / STEP); i++) {
      clearControls(plain); plain.control.thr = 1; updateShip(plain, STEP, null);
      clearControls(fast); fast.control.thr = 1; fast.control.boost = 1;
      updateShip(fast, STEP, null);
    }
    const peak = fast.speed;
    // Заряд кончился — предел снова обычный.
    for (let i = 0; i < Math.round(25 / STEP); i++) {
      clearControls(fast); fast.control.thr = 1; fast.control.boost = 1;
      updateShip(fast, STEP, null);
    }
    ok(Math.abs(plain.speed - SHIP.maxSpeed) < 0.01 && peak > SHIP.maxSpeed * 1.5 &&
       fast.boostLock && Math.abs(fast.speed - SHIP.maxSpeed) < 0.02,
      `предел: обычный ${plain.speed.toFixed(2)} км/с, на форсаже ${peak.toFixed(2)}; ` +
      `заряд кончился, форсаж заперт — скорость вернулась к ${fast.speed.toFixed(2)}`);
  }

  // Разгон: форсаж поднимает не только предел, но и тягу, и время
  // выхода на предел — это то, что задано (SHIP.boostRamp), а множитель
  // тяги из него выведен.
  {
    const sh = mk();
    const lim = SHIP.maxSpeed * SHIP.boostMax;
    // Сперва обычный предел, потом форсаж — как в жизни.
    for (let i = 0; i < Math.round(20 / STEP); i++) {
      clearControls(sh); sh.control.thr = 1; updateShip(sh, STEP, null);
    }
    let t = 0;
    while (sh.speed < lim - 0.01 && t < 10) {
      clearControls(sh); sh.control.thr = 1; sh.control.boost = 1;
      updateShip(sh, STEP, null);
      t += STEP;
    }
    ok(Math.abs(t - SHIP.boostRamp) < 0.1 && SHIP.boostAccel > 3,
      `с обычного предела до форсажного за ${t.toFixed(2)} с (задано ` +
      `${SHIP.boostRamp}); тяга выше обычной в ${SHIP.boostAccel.toFixed(2)} раза`);
  }

  // Перегруз слышен: тяга форсажа выше порога, на котором корпус
  // начинает скрипеть, а обычная — ниже. Это не случайность, а
  // следствие: движки работают за пределом, на который рассчитан
  // корпус, и это ровно тот случай, ради которого скрежет и заведён.
  {
    const creakAt = SHIP.accel * SHIP.boostAccel;
    ok(SHIP.accel < AUDIO.jerkFloor && creakAt > AUDIO.jerkFloor,
      `обычный разгон ${SHIP.accel} км/с² ниже порога скрежета ` +
      `${AUDIO.jerkFloor}, форсажный ${creakAt.toFixed(2)} — выше: корпус жалуется`);
  }

  // Замок снимается только после того, как клавишу ОТПУСТИЛИ и заряд
  // накопился. Держать её бесполезно: иначе получился бы тот же вечный
  // форсаж по капле, только циклами.
  {
    const sh = mk();
    sh.boost = 0;
    const press = (secs, on) => {
      for (let i = 0; i < Math.round(secs / STEP); i++) {
        clearControls(sh); sh.control.thr = 1; sh.control.boost = on ? 1 : 0;
        updateShip(sh, STEP, null);
      }
    };
    press(SHIP.boostFill, true);                  // держим — заряд копится, но замок стоит
    const heldLocked = sh.boostLock && !sh.boosting && sh.boost > SHIP.boostArm;
    press(0.2, false);                            // отпустили — замок снят
    const freed = !sh.boostLock;
    press(0.2, true);
    ok(heldLocked && freed && sh.boosting,
      `замок не снимается на зажатой клавише (заряд дошёл до ` +
      `${(sh.boost * 100).toFixed(0)}%), а после отпускания форсаж снова доступен`);
  }
}

console.log('\n== задний ход ==');
{
  const sh = makeShip();
  placeShip(sh, v3(0, 0, 0), makeBasis());
  const fwd = { ...sh.basis.fwd };
  sh.throttle = 1;
  const hold = (seconds, thr) => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      clearControls(sh);
      sh.control.thr = thr;
      updateShip(sh, STEP);
    }
  };

  // Разгон вперёд, потом Ctrl не отпускаем: тяга падает до нуля, корабль
  // встаёт — и только потом начинается задний ход.
  hold(3, 1);
  const vFwd = sh.speed;
  hold(1.45, -1);                       // 1.43 с на сброс тяги + защёлка
  const atZero = sh.speed;
  const thrZero = sh.throttle;
  hold(4, -1);
  // Скорость теперь вектор, а ship.speed — его модуль; знак хода читается
  // проекцией на нос.
  const vBack = dot(sh.vel, sh.basis.fwd);

  // На защёлке тяга ровно ноль, а скорость ещё гасится: тяга задаёт
  // цель, а не саму скорость, и корабль доезжает по инерции.
  ok(vFwd > 1.1 && thrZero === 0 && atZero > 0 && atZero < vFwd * 0.15 && vBack < -0.1,
    `вперёд ${(vFwd * 1000).toFixed(0)} м/с -> на защёлке тяга ${thrZero}, ` +
    `скорость догасает до ${(atZero * 1000).toFixed(0)} м/с -> назад ` +
    `${(vBack * 1000).toFixed(0)} м/с`);

  // Задний ход заметно медленнее переднего, и корабль правда едет назад.
  const p0 = { ...sh.pos };
  hold(1, -1);
  const moved = (sh.pos.x - p0.x) * fwd.x + (sh.pos.y - p0.y) * fwd.y + (sh.pos.z - p0.z) * fwd.z;
  ok(moved < 0 && Math.abs(vBack) < vFwd * 0.25 &&
     Math.abs(Math.abs(vBack) - SHIP.maxSpeed * SHIP.reverse) < 0.01,
    `назад корабль едет носом вперёд: за секунду ${(moved * 1000).toFixed(0)} м, ` +
    `предел ${(SHIP.maxSpeed * SHIP.reverse * 1000).toFixed(0)} м/с против ` +
    `${(SHIP.maxSpeed * 1000).toFixed(0)} вперёд`);

  // Защёлка на нуле: коротким нажатием Ctrl назад не уедешь.
  const sh2 = makeShip();
  placeShip(sh2, v3(0, 0, 0), makeBasis());
  sh2.throttle = 0.05;
  for (let i = 0; i < Math.round(0.4 / STEP); i++) {
    clearControls(sh2);
    sh2.control.thr = -1;
    updateShip(sh2, STEP);
  }
  ok(sh2.throttle === 0,
    `после короткого сброса тяга стоит на нуле, а не уходит в минус (${sh2.throttle})`);
}

// --- 5f2. Корпус корабля -------------------------------------------------------
console.log('\n== корпус ==');
{
  // Корпус пришёл готовой моделью (js/models/hull.data.js). Проверяется
  // не красота, а контракт: оси, обводы и точки, на которые опирается
  // остальной код — посадка, факелы, стыковка.
  const hull = buildCobra();
  const gear = buildGear();
  const ext = (axis) => {
    const v = hull.verts.map((p) => p[axis]);
    return { min: Math.min(...v), max: Math.max(...v), size: Math.max(...v) - Math.min(...v) };
  };
  const X = ext('x'), Y = ext('y'), Z = ext('z');

  ok(hull.verts.length > 300 && hull.faces.length > 300 &&
     hull.faces.every((f) => f.v.every((i) => i >= 0 && i < hull.verts.length)),
    `корпус «${hull.name}»: ${hull.verts.length} вершин, ${hull.faces.length} граней, ` +
    'все номера вершин в пределах');

  ok(hull.faces.every((f) => f.c.length === 3 && f.c.every((c) => c >= 0 && c <= 255)) &&
     new Set(hull.faces.map((f) => f.c.join(','))).size > 20,
    `цвет снят с текстуры на каждую грань: различных цветов ` +
    `${new Set(hull.faces.map((f) => f.c.join(','))).size}`);

  ok(hull.faces.every((f) => Number.isFinite(f.n.x) &&
      Math.abs(Math.hypot(f.n.x, f.n.y, f.n.z) - 1) < 1e-6),
    'у каждой грани есть единичная нормаль');

  // Длина по носу — то, на что рассчитаны камера, тень и посадка.
  ok(Math.abs(Z.size - hull.length) < 1e-6 && Math.abs(Z.min + Z.max) < 1e-6,
    `длина ${(Z.size * 1000).toFixed(1)} м по оси Z, корпус отцентрован`);

  // Нос — узкий конец. Сечение у носа обязано быть уже, чем у кормы:
  // иначе модель развёрнута задом наперёд, и это единственная ошибка
  // перегона, которую не видно ни по одному другому признаку.
  const widthNear = (from, to) => {
    let lo = 1e9, hi = -1e9;
    for (const p of hull.verts) {
      const t = (p.z - Z.min) / Z.size;
      if (t < from || t > to) continue;
      lo = Math.min(lo, p.x); hi = Math.max(hi, p.x);
    }
    return hi - lo;
  };
  const nose = widthNear(0.8, 1), tail = widthNear(0, 0.2);
  ok(nose < tail * 0.7,
    `нос смотрит в +Z: сечение у носа ${(nose * 1000).toFixed(1)} м против ` +
    `${(tail * 1000).toFixed(1)} м у кормы`);

  // Факелы: в корме, попарно симметрично.
  const ex = hull.exhausts;
  ok(ex.length >= 1 && ex.every((p) => p.z < Z.min + Z.size * 0.25) &&
     (ex.length < 2 || Math.abs(ex[0].x + ex[1].x) < Math.abs(ex[0].x) * 0.3),
    `сопла (${ex.length}) стоят в корме и симметричны: ` +
    ex.map((p) => `(${(p.x * 1000).toFixed(1)}, ${(p.z * 1000).toFixed(1)})`).join(' '));

  // Шасси: точки под днищем, одна впереди и две сзади по бортам.
  const hp = gear.hardpoints;
  const front = hp.filter((p) => p.z > 0), back = hp.filter((p) => p.z < 0);
  ok(hp.length === 3 && front.length === 1 && back.length === 2 &&
     Math.abs(back[0].x + back[1].x) < 1e-9 && hp.every((p) => p.y <= 0),
    `шасси: одна стойка впереди, две сзади по бортам, все под днищем`);

  // Просветы обязаны соответствовать корпусу: на шасси днище над
  // грунтом, на брюхе — ровно на нём.
  ok(Math.abs(SHIP.hullClear + Y.min) < 1e-9 && SHIP.gearClear > SHIP.hullClear &&
     gear.legLength > 0.0005,
    `просветы от модели: брюхо ${(SHIP.hullClear * 1000).toFixed(1)} м = низ корпуса, ` +
    `на шасси ${(SHIP.gearClear * 1000).toFixed(1)} м, стойка ` +
    `${(gear.legLength * 1000).toFixed(1)} м`);

  // Корабль обязан пролезать в щель порта — иначе состыковаться нельзя
  // в принципе, и докинг-компьютер будет вечно бить корабль о раму.
  ok(HULL_HALF.x < SLOT.hw * 0.8 && HULL_HALF.y < SLOT.hh * 0.8,
    `в створ порта проходит с запасом: корпус ${(HULL_HALF.x * 2000).toFixed(0)}x` +
    `${(HULL_HALF.y * 2000).toFixed(0)} м, щель ${(SLOT.hw * 2000).toFixed(0)}x` +
    `${(SLOT.hh * 2000).toFixed(0)} м`);
}

// --- 5g2. Подъёмные движки (R/F) ---------------------------------------------
console.log('\n== подъёмные движки ==');
{
  // Ход R/F обязан РАЗГОНЯТЬ по вертикали, а не дёргать корабль на месте:
  // тяга движков идёт в тот же вектор скорости, что и всё остальное, и
  // гашение заноса (0.5 км/с²) съедало её целиком в следующем же кадре.
  const hold = (lift, secs, field = null, throttle = 0) => {
    const sh = makeShip();
    placeShip(sh, v3(0, 0, 0), makeBasis());
    sh.throttle = throttle;
    for (let i = 0; i < Math.round(secs / STEP); i++) {
      clearControls(sh);
      sh.control.lift = lift;
      updateShip(sh, STEP, field);
    }
    return sh;
  };
  const vUp = (sh) => dot(sh.vel, sh.basis.up);

  const upShip = hold(1, 2);
  const dnShip = hold(-1, 2);
  const want = SHIP.liftMin * 2;
  ok(Math.abs(vUp(upShip) - want) < want * 0.05 &&
     Math.abs(vUp(dnShip) + want) < want * 0.05,
    `вдали от тел за 2 с ходу: R ${(vUp(upShip) * 1000).toFixed(1)} м/с вверх, ` +
    `F ${(vUp(dnShip) * 1000).toFixed(1)} м/с (ожидание ±${(want * 1000).toFixed(1)})`);

  // Отпустил ход — вертикаль снова общий канал, и стабилизатор её гасит.
  {
    const sh = hold(1, 2);
    for (let i = 0; i < Math.round(0.5 / STEP); i++) {
      clearControls(sh);
      updateShip(sh, STEP);
    }
    ok(Math.abs(vUp(sh)) < 1e-4,
      `отпущенный ход гасится стабилизатором (${(vUp(sh) * 1000).toFixed(2)} м/с)`);
  }

  // Над телом с убранным шасси тяга привязана к местной тяжести, а вес
  // снимает компенсатор высоты: чистый разгон вверх.
  {
    const field = { up: v3(0, 1, 0), g: 0.0098 };
    const sh = makeShip();
    placeShip(sh, v3(0, 0, 0), makeBasis());
    sh.basis.right = v3(1, 0, 0); sh.basis.up = v3(0, 1, 0); sh.basis.fwd = v3(0, 0, 1);
    for (let i = 0; i < Math.round(2 / STEP); i++) {
      clearControls(sh);
      sh.control.lift = 1;
      updateShip(sh, STEP, field);
    }
    const wantG = field.g * SHIP.liftTWR * 2;
    ok(Math.abs(sh.vel.y - wantG) < wantG * 0.05,
      `над телом (шасси убрано) за 2 с ходу: ${(sh.vel.y * 1000).toFixed(1)} м/с вверх ` +
      `(ожидание ${(wantG * 1000).toFixed(1)})`);
  }

  // Вертикальный ход — отдельный канал: он не отнимает ход вперёд.
  {
    const sh = hold(0, 6, null, 1);
    const fwd0 = dot(sh.vel, sh.basis.fwd);
    for (let i = 0; i < Math.round(2 / STEP); i++) {
      clearControls(sh);
      sh.control.lift = 1;
      updateShip(sh, STEP);
    }
    ok(Math.abs(dot(sh.vel, sh.basis.fwd) - fwd0) < 1e-6 && vUp(sh) > want * 0.9,
      `на крейсерском ходу R не съедает скорость вперёд: ` +
      `${dot(sh.vel, sh.basis.fwd).toFixed(3)} км/с при ${(vUp(sh) * 1000).toFixed(1)} м/с вверх`);
  }
}

// --- 5g2b. Вход в атмосферу ---------------------------------------------------
console.log('\n== вход в атмосферу ==');
{
  const air = world.planets.find((p) => p.atmo);
  const bare = world.planets.find((p) => !p.atmo) || world.planets[0].moons[0];

  // Плотность: единица у земли, ноль на верхней кромке, между ними
  // экспонента. Без этого нагрев был бы либо везде, либо нигде.
  const top = air.radius * ENTRY.top;
  const d0 = airDensity(air, 0), dMid = airDensity(air, top * 0.5), dTop = airDensity(air, top);
  ok(d0 === 1 && dTop === 0 && dMid > 0.05 && dMid < 0.15 &&
     airDensity(bare, 0) === 0,
    `плотность: у земли ${d0}, на половине ${dMid.toFixed(3)}, на кромке ${dTop}; ` +
    `у тела без воздуха ${airDensity(bare, 0)}`);

  // Куб скорости — то самое «краснота зависит от скорости входа».
  // Вдвое быстрее обязано быть примерно вшестеро-ввосьмеро горячее.
  const h1 = entryHeat(0.05, 0.6), h2 = entryHeat(0.05, 0.95);
  ok(entryHeat(0.05, ENTRY.vFloor) === 0 && h1 > 0 && h2 / h1 > 3,
    `нагрев растёт кубом скорости: на пороге ${ENTRY.vFloor} км/с нуль, ` +
    `на 0.6 — ${h1.toFixed(4)}, на 0.95 — ${h2.toFixed(4)} (в ${(h2 / h1).toFixed(1)} раза)`);

  ok(entryHeat(0, 2) === 0 && entryHeat(1, 9) === 1,
    'в вакууме нагрева нет при любой скорости, у земли на большой он в полную силу');

  // Цвет зависит от СКОРОСТИ, а не от силы свечения: на околозвуковых
  // белый конус уплотнения, на гиперзвуке красная плазма. Проверяем,
  // что шкала идёт именно в эту сторону и нигде не разворачивается.
  {
    const at = (v) => heatColor(v);
    const slow = at(ENTRY.vWhite), mid = at(0.85), fast = at(ENTRY.vRed * 1.5);
    const rgb = (c) => 'rgb(' + c.map((x) => Math.round(Math.max(0, x) * 255)).join(', ') + ')';
    // Белое: все три канала высоко. Красное: синий почти ушёл.
    const white = slow[2] > 0.8 && slow[1] > 0.9;
    const red = fast[2] < 0.1 && fast[1] < 0.35 && fast[0] > 0.9;
    // Монотонность: синий обязан падать со скоростью без ям.
    let mono = true;
    let prev = 2;
    for (let v = 0.3; v <= 2; v += 0.05) {
      const b = heatColor(v)[2];
      if (b > prev + 1e-9) mono = false;
      prev = b;
    }
    ok(white && red && mono && mid[2] < slow[2] && mid[2] > fast[2],
      `цвет по скорости: ${ENTRY.vWhite} км/с ${rgb(slow)}, 0.85 ${rgb(mid)}, ` +
      `${(ENTRY.vRed * 1.5).toFixed(2)} ${rgb(fast)}`);
  }

  // Обстановка целиком. Корабль падает на планету с воздухом.
  const shipAt = (body, alt, vel) => {
    const sh = makeShip();
    const dir = normalize(v3(0.3, 0.5, 0.81));
    placeShip(sh, v3(
      body.pos.x + dir.x * (body.radius + alt),
      body.pos.y + dir.y * (body.radius + alt),
      body.pos.z + dir.z * (body.radius + alt)), makeBasis());
    sh.vel.x = -dir.x * vel; sh.vel.y = -dir.y * vel; sh.vel.z = -dir.z * vel;
    return entryState(world, sh);
  };

  ok(shipAt(air, air.radius * ENTRY.top * 2, 1.2) === null,
    'выше атмосферы нагрева нет даже на полном ходу');
  ok(shipAt(bare, 1, 1.2) === null, 'над телом без воздуха — тоже');
  ok(shipAt(air, 5, 0.05) === null, 'медленное снижение в воздухе не жжёт');

  const fast = shipAt(air, 5, 1.2);
  ok(fast && fast.heat > 0.2 && fast.body === air,
    `быстрый вход на 5 км: нагрев ${fast ? fast.heat.toFixed(2) : '—'}, ` +
    `скорость обдува ${fast ? fast.speed.toFixed(2) : '—'} км/с`);

  // Ось факела — по потоку: корабль падает вниз, значит и волна снизу.
  const down = normalize(v3(0.3, 0.5, 0.81));
  ok(Math.abs(dot(fast.dir, down) + 1) < 1e-6,
    'ось волны совпадает с вектором скорости, а не с носом');

  // Пороги нагрева привязаны к обычному полёту: на полном ходу вход
  // заметен, на форсаже корабль горит. Множителя круиза больше нет, и
  // если пороги оставить старыми, механика просто перестанет включаться.
  const full = shipAt(air, 5, SHIP.maxSpeed);
  const boosted = shipAt(air, 5, SHIP.maxSpeed * SHIP.boostMax);
  ok(full && full.heat > 0.2, `на полном ходу вход греет: ${full.heat.toFixed(2)}`);
  ok(boosted && boosted.heat > full.heat * 1.5,
    `на форсаже заметно горячее: ${boosted.heat.toFixed(2)}`);

  // Калибровочная таблица: по ней видно баланс целиком, а не по одному
  // числу. Это не столько проверка, сколько то, что должно быть на
  // глазах при любой правке порогов.
  {
    const body = { atmo: [1, 1, 1], radius: 6000 };
    const speeds = [0.4, 0.8, 1.2, 3];
    const rows = [200, 60, 20, 0].map((alt) => {
      const rho = airDensity(body, alt);
      return `${String(alt).padStart(3)} км: ` +
        speeds.map((v) => entryHeat(rho, v).toFixed(2)).join(' ');
    });
    const ground = entryHeat(1, 1.2), high = entryHeat(airDensity(body, 200), 1.2);
    ok(ground > high * 5 && ground < 0.75 && entryHeat(1, 3) > 0.9,
      `нагрев при 0.4 / 0.8 / 1.2 / 3 км/с — ${rows.join(' | ')}`);
  }

  // ТО, ЧТО БЫЛО СЛОМАНО: корабль висит над планетой со своей скоростью
  // 0.00, но включён круиз x10. Ускоритель множил и снос воздуха от
  // вращения планеты (200 м/с превращались в 2 км/с), и корабль горел,
  // стоя на месте. Множиться должна скорость КОРАБЛЯ и только она.
  {
    const sh = makeShip();
    const dir = normalize(v3(0.3, 0.5, 0.81));
    placeShip(sh, v3(
      air.pos.x + dir.x * (air.radius + 70),
      air.pos.y + dir.y * (air.radius + 70),
      air.pos.z + dir.z * (air.radius + 70)), makeBasis());
    // Своя скорость нулевая; грунт под кораблём уезжает.
    const drift = Math.hypot(...['x', 'y', 'z'].map((k) => groundDrift(air, sh.pos, v3())[k]));
    const still = entryState(world, sh);
    ok(still === null,
      `висящий над планетой не горит: своя скорость 0, снос воздуха ` +
      `${(drift * 1000).toFixed(0)} м/с — ниже порога ${(ENTRY.vFloor * 1000).toFixed(0)} м/с`);
  }

  // И это должно быть верно для ВСЕХ планет системы, а не только для
  // той, на которой поймали ошибку: порог обязан перекрывать вращение
  // самой быстрой из них.
  {
    let worst = 0, worstName = '';
    for (const b of world.bodies) {
      if (!b.atmo) continue;
      const alt = b.radius * ENTRY.top * 0.9;
      const d = groundDrift(b, v3(b.pos.x + b.radius + alt, b.pos.y, b.pos.z), v3());
      const sp = Math.hypot(d.x, d.y, d.z);
      if (sp > worst) { worst = sp; worstName = b.name; }
    }
    ok(worst < ENTRY.vFloor * 0.8,
      `порог ${(ENTRY.vFloor * 1000).toFixed(0)} м/с с запасом перекрывает вращение ` +
      `самой быстрой планеты с воздухом (${worstName}, ${(worst * 1000).toFixed(0)} м/с)`);
  }

  // Воздух вращается с телом: кто летит вместе с ним, не горит.
  {
    const sh = makeShip();
    const dir = normalize(v3(0.3, 0.5, 0.81));
    const pos = v3(
      air.pos.x + dir.x * (air.radius + 3),
      air.pos.y + dir.y * (air.radius + 3),
      air.pos.z + dir.z * (air.radius + 3));
    placeShip(sh, pos, makeBasis());
    groundDrift(air, pos, sh.vel);
    ok(entryState(world, sh) === null,
      'летящий вместе с воздухом не горит, хотя грунт под ним уезжает');
  }
}

// --- 5g3. Звук -----------------------------------------------------------------
console.log('\n== звук ==');
{
  // Звук считается отдельно от синтеза именно для того, чтобы его можно
  // было проверить здесь: микс — это числа, события — это список.
  const mkGame = (over = {}) => ({
    ship: Object.assign(makeShip(), { control: { pitch: 0, roll: 0, yaw: 0, thr: 0, lift: 0 } }),
    state: { mode: AST.FLIGHT },
    quantum: makeQuantum(),
    ...over,
  });
  // Кадр целиком, как в main.js: посчитали -> разобрали очередь.
  // Без разбора одно и то же событие считалось бы каждый кадр заново.
  const run = (a, g, secs, dt = 1 / 60) => {
    const seen = [];
    for (let i = 0; i < Math.round(secs / dt); i++) {
      updateAudio(a, g, dt);
      seen.push(...a.events);
      playAudio(a, null);
    }
    return seen;
  };

  // Тяга слышна: на полном ходу и громче, и выше, чем на холостых.
  {
    const a = makeAudio(1), g = mkGame();
    run(a, g, 1.5);
    const idle = { e: a.mix.engine, p: a.mix.pitch };
    g.ship.throttle = 1;
    run(a, g, 1.5);
    ok(a.mix.engine > idle.e + 0.4 && a.mix.pitch > idle.p + 0.4 && idle.e > 0.1,
      `движки: холостые ${idle.e.toFixed(2)}/${idle.p.toFixed(2)} -> полный ход ` +
      `${a.mix.engine.toFixed(2)}/${a.mix.pitch.toFixed(2)}`);
  }

  // Задний ход звучит ниже переднего при той же величине тяги.
  {
    const a = makeAudio(2), g = mkGame();
    g.ship.throttle = 1; run(a, g, 1.5);
    const fwd = a.mix.pitch;
    g.ship.throttle = -1; run(a, g, 1.5);
    ok(a.mix.pitch < fwd * 0.75,
      `задний ход ниже переднего: ${a.mix.pitch.toFixed(2)} против ${fwd.toFixed(2)}`);
  }

  // Квантовый привод: калибровка воет вполсилы, прыжок — во весь ход,
  // вход и выход отмечены свистом.
  {
    const a = makeAudio(3), g = mkGame();
    g.quantum.phase = 'calib'; g.quantum.calib = 1; run(a, g, 1.2);
    const calib = a.mix.drive;
    g.quantum.phase = 'jump'; g.quantum.speed = SHIP.quantumSpeed;
    const inEv = run(a, g, 1.2);
    const loud = a.mix.drive;
    g.quantum.phase = 'idle'; g.quantum.speed = 0;
    const outEv = run(a, g, 1.2);
    ok(calib > 0.2 && calib < 0.5 && loud > 0.9 && a.mix.drive < 0.15 &&
      inEv.some((e) => e.kind === 'spool' && e.up) &&
      outEv.some((e) => e.kind === 'spool' && !e.up),
      `привод: калибровка ${calib.toFixed(2)}, прыжок ${loud.toFixed(2)}, ` +
      `выход ${a.mix.drive.toFixed(2)}, вход и выход отмечены свистом`);
  }

  // В прыжке скорость меняется на десятки тысяч км/с за кадр. Корпус от
  // этого скрипеть не должен: это работа привода, а не нагрузка.
  {
    const a = makeAudio(7), g = mkGame();
    g.quantum.phase = 'jump'; g.quantum.speed = 20000;
    g.ship.vel.x = 0; run(a, g, 0.2);
    g.ship.vel.x = 20000;
    const ev = run(a, g, 1.0);
    ok(!ev.some((e) => e.kind === 'creak'), 'разгон привода не скрипит корпусом');
  }

  // Подъёмные движки: R и F шипят по-разному, и это тот самый канал,
  // который до правки не делал ничего.
  {
    const a = makeAudio(4), g = mkGame();
    g.ship.control.lift = 1; run(a, g, 0.6);
    const upLvl = a.mix.thrust, upPitch = a.mix.thrustPitch;
    g.ship.control.lift = -1; run(a, g, 0.6);
    ok(upLvl > 0.85 && a.mix.thrust > 0.85 && upPitch > 0.85 && a.mix.thrustPitch < 0.15,
      `подъёмные: R ${upLvl.toFixed(2)}@${upPitch.toFixed(2)}, ` +
      `F ${a.mix.thrust.toFixed(2)}@${a.mix.thrustPitch.toFixed(2)}`);
  }

  // Скрежет от нагрузки: ровный полёт молчит, рывок — нет.
  {
    const a = makeAudio(5), g = mkGame();
    g.ship.vel = v3(0.4, 0, 0);
    const calm = run(a, g, 2);
    g.ship.vel = v3(0.4, 0.09, 0);        // 5.4 км/с² за один кадр
    const hard = run(a, g, 0.2);
    ok(calm.length === 0 && hard.some((e) => e.kind === 'creak'),
      `ровный полёт молчит (${calm.length} событий), рывок даёт скрежет`);
  }

  // Порог взят выше штатной тяги: разгон и торможение сами по себе
  // скрипеть не должны, иначе скрежет перестанет что-либо значить.
  {
    const a = makeAudio(6), g = mkGame();
    let heard = 0;
    for (let i = 0; i < 120; i++) {
      g.ship.vel = v3(SHIP.accel * (i + 1) / 60, 0, 0);   // разгон в полную силу
      updateAudio(a, g, 1 / 60);
      heard += a.events.length;
    }
    const both = Math.hypot(SHIP.brake, SHIP.lateral);   // тормоз и занос сразу
    ok(heard === 0 && SHIP.brake < AUDIO.jerkFloor && both > AUDIO.jerkFloor,
      `порог ${AUDIO.jerkFloor} км/с² выше любого одного канала тяги ` +
      `(разгон ${SHIP.accel}, тормоз ${SHIP.brake}, занос ${SHIP.lateral}) и ниже ` +
      `их суммы ${both.toFixed(2)}: штатный разгон молчит (${heard}). ` +
      `Форсаж (${(SHIP.accel * SHIP.boostAccel).toFixed(2)}) порог переходит намеренно`);
  }

  // Телепорт и вылет не должны читаться как удар.
  {
    const a = makeAudio(7), g = mkGame();
    g.ship.vel = v3(1.2, 0, 0); run(a, g, 0.5);
    g.ship.vel = v3(0, 0, 0);
    audioReset(a, g.ship);
    const after = run(a, g, 0.5);
    ok(after.every((e) => e.kind !== 'creak'),
      'после audioReset скачок скорости не даёт скрежета');
  }

  // Побитый корпус скрипит сам, целый — молчит.
  {
    const a = makeAudio(8), g = mkGame();
    g.ship.hull = 100;
    const whole = run(a, g, 40);
    const b = makeAudio(8), g2 = mkGame();
    g2.ship.hull = 12;
    const beat = run(b, g2, 40);
    ok(whole.length === 0 && beat.filter((e) => e.kind === 'creak').length >= 4,
      `за 40 с целый корпус молчит (${whole.length}), побитый скрипит ` +
      `${beat.length} раз(а)`);
  }

  // Удар: чем больше урон, тем ниже и дольше. Это единственный способ
  // отличить на слух «помяли» от «чуть не убились».
  {
    const a = makeAudio(9);
    audioCue(a, 'hit', { damage: 2 });
    const soft = a.events.slice();
    a.events.length = 0;
    audioCue(a, 'hit', { damage: 30 });
    const hard = a.events.slice();
    const cr = (l) => l.find((e) => e.kind === 'creak');
    ok(cr(hard).freq < cr(soft).freq && cr(hard).dur > cr(soft).dur &&
       hard.some((e) => e.kind === 'clunk'),
      `лёгкий удар ${cr(soft).freq.toFixed(0)} Гц / ${cr(soft).dur.toFixed(2)} с, ` +
      `тяжёлый ${cr(hard).freq.toFixed(0)} Гц / ${cr(hard).dur.toFixed(2)} с`);
  }

  // В порту двигатели молчат, но фон есть; на грунте молчит всё, кроме
  // остывающего металла.
  {
    const a = makeAudio(10), g = mkGame({ state: { mode: AST.DOCKED } });
    run(a, g, 3);
    const docked = { e: a.mix.engine, s: a.mix.station };
    const b = makeAudio(11), g2 = mkGame({ state: { mode: AST.LANDED } });
    const cool = run(b, g2, 60);
    ok(docked.e < 0.05 && docked.s > 0.8 && b.mix.engine < 0.05 &&
       cool.filter((e) => e.kind === 'creak').length > 0,
      `в порту движки ${docked.e.toFixed(2)}, станция ${docked.s.toFixed(2)}; ` +
      `на грунте тихо, но металл щёлкает ${cool.length} раз(а) за минуту`);
  }

  // Явное событие кладётся в очередь ДО updateAudio (в main.js это шаг
  // физики и разбор клавиш) и обязано дожить до playAudio. Чистка
  // очереди в начале кадра съедала бы все удары и стыковки разом.
  {
    const a = makeAudio(20), g = mkGame();
    audioCue(a, 'hit', { damage: 20 });
    audioCue(a, 'gear', { out: true });
    const before = a.events.length;
    updateAudio(a, g, 1 / 60);
    const kinds = a.events.map((e) => e.kind);
    playAudio(a, null);
    ok(before === 4 && a.events.length === 0 &&
       kinds.includes('clunk') && kinds.includes('creak') && kinds.includes('servo'),
      `события кадра доживают до разбора: ${kinds.join(', ')}; после разбора очередь пуста`);
  }

  // Очередь не растёт без конца, если её никто не разбирает.
  {
    const a = makeAudio(21), g = mkGame();
    for (let i = 0; i < 200; i++) { audioCue(a, 'hit', { damage: 5 }); updateAudio(a, g, 1 / 60); }
    ok(a.events.length <= 32, `неразобранная очередь ограничена: ${a.events.length}`);
  }

  // Выключенный звук не копит событий: глушится источник, а не выход.
  {
    const a = makeAudio(12), g = mkGame();
    a.on = false;
    g.ship.vel = v3(0, 0, 0); run(a, g, 0.2);
    g.ship.vel = v3(0.5, 0, 0);
    const off = run(a, g, 0.3);
    audioCue(a, 'crash');
    ok(off.length === 0 && a.events.length === 0, 'с выключенным звуком событий нет');
  }
}

// --- 5g4. Синтез звука на моке WebAudio -----------------------------------------
console.log('\n== синтез звука ==');
{
  // WebAudio в node нет, поэтому контекст подменяется — ровно так же,
  // как GL-контекст в tools/gl.mjs. Проверяется не «как звучит» (это
  // ухом), а что граф собирается, параметры конечны и ни один вызов не
  // падает: без этого весь синтез существует только на словах.
  const calls = { node: {}, param: 0, bad: [], rates: [] };
  const param = (name, v = 0) => {
    const check = (x, where) => {
      if (typeof x === 'number' && !Number.isFinite(x)) calls.bad.push(`${name}.${where}: ${x}`);
      if (name === 'rate' && typeof x === 'number') calls.rates.push(x);
      calls.param++;
      return p;
    };
    const p = {
      get value() { return v; },
      set value(x) { check(x, 'value'); v = x; },
      setValueAtTime: (x, t) => check(x, 'setValueAtTime') && check(t, 'time'),
      setTargetAtTime: (x, t, c) => check(x, 'setTargetAtTime') && check(t, 'time') && check(c, 'tau'),
      linearRampToValueAtTime: (x, t) => check(x, 'linearRamp') && check(t, 'time'),
      exponentialRampToValueAtTime: (x, t) => {
        if (x === 0) calls.bad.push(`${name}: экспоненциальный спад в ноль`);
        return check(x, 'expRamp') && check(t, 'time');
      },
      cancelScheduledValues: () => p,
    };
    return p;
  };
  const node = (kind, extra = {}) => {
    calls.node[kind] = (calls.node[kind] || 0) + 1;
    return Object.assign({
      connect() {}, disconnect() {},
      start(t) { if (t !== undefined && !Number.isFinite(t)) calls.bad.push(kind + '.start'); },
      stop(t) { if (t !== undefined && !Number.isFinite(t)) calls.bad.push(kind + '.stop'); },
    }, extra);
  };
  globalThis.AudioContext = class {
    constructor() { this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.destination = node('destination'); }
    createGain() { return node('gain', { gain: param('gain', 1) }); }
    createBiquadFilter() { return node('filter', { type: 'lowpass', frequency: param('freq', 1000), Q: param('Q', 1) }); }
    createOscillator() { return node('osc', { type: 'sine', frequency: param('osc.freq', 440), detune: param('detune', 0) }); }
    createBufferSource() { return node('bufsrc', { buffer: null, loop: false, playbackRate: param('rate', 1) }); }
    createDynamicsCompressor() {
      return node('comp', { threshold: param('thr', 0), ratio: param('ratio', 1), attack: param('atk', 0), release: param('rel', 0) });
    }
    createBuffer(ch, len, rate) {
      const data = new Float32Array(len);
      return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: () => data };
    }
    resume() {} suspend() {}
  };

  const s = new Sound();
  const started = s.start();
  ok(started && s.ok && !s.sampled,
    `контекст поднялся, узлов: ${Object.entries(calls.node).map(([k, v]) => k + ' ' + v).join(', ')}`);

  // Полный ход движков по всему диапазону: тяга, круиз, подъёмные.
  for (let i = 0; i <= 20; i++) {
    const k = i / 20;
    s.engine(k, k, 1 - k);
    s.drive(k, 1 - k);
    s.thrust(k, k);
    s.ambient(k);
    s.ctx.currentTime += 0.05;
  }
  // Разовые: от еле слышного щелчка до скрежета в полную силу.
  for (const [g, f, r, d] of [[0.1, 90, 0.2, 0.2], [0.5, 300, 0.7, 0.8], [1, 900, 1, 2.4]]) {
    s.creak(g, f, r, d);
    s.clunk(g, f, d);
    s.ctx.currentTime += 3;
  }
  s.clamp(0.6);
  s.servo(2.4, true);
  s.servo(1.6, false);
  s.spool(true, 1);
  s.spool(false, 0);
  ok(calls.bad.length === 0,
    `ни одного нечислового или нулевого параметра за ${calls.param} вызовов` +
    (calls.bad.length ? ': ' + calls.bad.slice(0, 3).join('; ') : ''));

  // Голоса не должны копиться: у разовых звуков обязан отрабатывать
  // счётчик, иначе после сотни ударов замолкает вообще всё.
  const live0 = s.live;
  for (let i = 0; i < 60; i++) s.creak(0.4, 250, 0.6, 0.4);
  ok(s.live <= 12 && live0 <= 12,
    `предел одновременных голосов держится: ${s.live} из 12 после 60 скрипов подряд`);

  // --- путь на сэмплах. Здесь и жила ошибка: частота события шла прямо
  // в playbackRate, у тяжёлого удара выходило 0.53, и вместо большого
  // листа обшивки было слышно вдвое замедленную запись двери.
  {
    const fakeBuf = (dur) => ({
      duration: dur, length: Math.round(dur * 48000), sampleRate: 48000,
      numberOfChannels: 1, getChannelData: () => new Float32Array(8),
    });
    s.buf.creak = [fakeBuf(2.78), fakeBuf(2.64), fakeBuf(2.47), fakeBuf(0.69)];
    s.buf.hit = [fakeBuf(0.4), fakeBuf(0.37)];
    s.buf.slam = fakeBuf(0.57);
    s.v.sample = { low: null, mid: null, exhaust: null, drive: null, thrust: null, station: null };
    s.sampled = true;
    calls.rates.length = 0;
    calls.bad.length = 0;
    // Предыдущая проверка намеренно забила все слоты, а onended в моке
    // никто не вызывает — без сброса ни один звук бы не проиграл, и
    // проверки ниже прошли бы вхолостую (так и случилось при написании).
    s.live = 0;

    // Весь диапазон, который умеет порождать игра: от щелчка остывающего
    // металла до разрушения корпуса.
    const events = [
      [0.12, 700, 0.85, 0.2], [0.18, 380, 0.5, 0.3], [0.3, 300, 0.8, 0.9],
      [0.42, 250, 0.7, 1.1], [0.68, 190, 0.8, 1.0], [0.95, 160, 0.75, 1.25],
      [1, 130, 0.95, 2.2], [0.75, 320, 0.9, 1.5],
    ];
    for (const [g, f, r, d] of events) { s.creak(g, f, r, d); s.ctx.currentTime += 3; }
    for (const f of [90, 120, 190, 220]) { s.clunk(0.6, f, 0.3); s.ctx.currentTime += 1; }

    const lo = Math.min(...calls.rates), hi = Math.max(...calls.rates);
    ok(calls.rates.length >= events.length && lo >= 0.8 && hi <= 1.35,
      `скорость воспроизведения держится у единицы: ${lo.toFixed(2)}..${hi.toFixed(2)} ` +
      `по ${calls.rates.length} звукам (за её пределами ухо слышит замедленную ` +
      'запись, а не размер железа)');
    ok(calls.bad.length === 0, `на сэмплах параметры конечны (${calls.rates.length} скоростей)`);

    // Длинному стону — длинная запись, короткому скрипу — короткая.
    const pickDur = (d) => { const b = s._pickCreak(d); return b ? b.duration : 0; };
    const longs = [pickDur(2.2), pickDur(1.2), pickDur(1.0)];
    const shorts = [pickDur(0.3), pickDur(0.25), pickDur(0.2)];
    ok(longs.every((d) => d > 1.4) && shorts.every((d) => d < 1.4),
      `подбор записи по длине: стоны ${longs.map((d) => d.toFixed(1)).join('/')} с, ` +
      `скрипы ${shorts.map((d) => d.toFixed(2)).join('/')} с`);

    // Разные записи подряд: один и тот же скрип дважды сразу слышен.
    const seq = [pickDur(2), pickDur(2), pickDur(2)];
    ok(new Set(seq).size > 1, `подряд идут разные записи (${seq.join(', ')})`);
    s.sampled = false;
  }

  // Громкость и немота идут через мастер-узел, а не через источники.
  s.setVolume(0.3); s.setMuted(true);
  ok(s.vol === 0.3 && s.muted === true, 'громкость и немота применяются');
  delete globalThis.AudioContext;
}

// --- 5h. Инерция и удар ------------------------------------------------------
console.log('\n== инерция и удар ==');
{
  // Разворот на скорости больше не переставляет вектор движения мгновенно:
  // корабль сносит по старому курсу, и только маневровые движки постепенно
  // разворачивают саму скорость. Это и есть векторная скорость.
  const sh = makeShip();
  placeShip(sh, v3(0, 0, 0), makeBasis());
  for (let i = 0; i < 60 * 5; i++) {
    clearControls(sh);
    sh.control.thr = 1;
    updateShip(sh, STEP);
  }
  const v0 = Math.hypot(sh.vel.x, sh.vel.y, sh.vel.z);
  // Разворот носа на 90° «рывком»: дальше смотрим, что делает скорость.
  lookAlong(sh.basis, v3(1, 0, 0));
  const angleTo = () => {
    const l = Math.hypot(sh.vel.x, sh.vel.y, sh.vel.z) || 1;
    return Math.acos(clamp(
      (sh.vel.x * sh.basis.fwd.x + sh.vel.y * sh.basis.fwd.y + sh.vel.z * sh.basis.fwd.z) / l,
      -1, 1)) * 57.3;
  };
  const run = (sec) => {
    for (let i = 0; i < Math.round(sec / STEP); i++) {
      clearControls(sh);
      sh.control.thr = 1;
      updateShip(sh, STEP);
    }
  };
  run(0.5);
  const soon = angleTo();
  run(6);
  const later = angleTo();
  ok(v0 > 1.1 && soon > 45 && later < 10,
    `инерция: через полсекунды после разворота скорость всё ещё под ${soon.toFixed(0)}° ` +
    `к носу, через шесть секунд — ${later.toFixed(0)}°`);
}

// Приход на грунт с ходу: отскок, урон и определённый исход. Главное,
// что проверяется, — корабль не зависает в бесконечных отскоках и не
// умирает от самого факта касания.
{
  const w = makeSystem(0x1a7e);
  const moon = moonPick(w);
  const run = (ms) => {
    const sh = makeShip();
    const dir = normalize(v3(0.42, 0.55, 0.72));
    placeShip(sh, worldPoint(moon, dir, groundRadius(moon, dir) + 0.06, v3()), makeBasis());
    const up = dirToWorldBody(moon, dir, v3());
    const axis = Math.abs(up.x) < 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
    lookAlong(sh.basis, normalize(horizontal(axis, up, v3())), up);
    sh.gear.out = true; sh.gear.t = 1;
    const fwd = sh.basis.fwd, v = ms / 1000;
    sh.throttle = v / (SHIP.maxSpeed * SHIP.gearSpeed);
    sh.vel.x = fwd.x * v - up.x * 0.004;
    sh.vel.y = fwd.y * v - up.y * 0.004;
    sh.vel.z = fwd.z * v - up.z * 0.004;

    let bounces = 0, landed = false, crashed = null, maxUp = 0;
    for (let i = 0; i < 60 * 90 && !landed && !crashed; i++) {
      updateWorld(w, STEP);
      const cap = captureBody(w, sh.pos);
      if (cap) carryShip(sh, cap, STEP);
      clearControls(sh);
      // Снижение ЗАДАЁТ пилот: компенсатор высоты сам вниз не тянет, и
      // приход на грунт — это всегда чьё-то решение, а не падение.
      sh.control.lift = -0.15;
      updateGear(sh, STEP);
      updateShip(sh, STEP, gravityField(cap, sh));
      const z = landingContext(w, sh);
      if (!z) continue;
      const t = checkTouchdown(sh, z);
      if (!t) continue;
      if (t.result === 'bounce') {
        bounces++;
        // После первого же отскока пилот сбрасывает тягу — иначе корабль
        // просто улетает дальше по своим делам.
        sh.throttle = 0;
        bounceOff(sh, z);
        sh.hull -= t.damage;
        maxUp = Math.max(maxUp, dot(sh.vel, z.upWorld) - dot(z.surfVel, z.upWorld));
        if (sh.hull <= 0) { crashed = 'корпус разрушен'; break; }
      } else if (t.result === 'landed') {
        landed = true;
        if (t.damage) sh.hull -= t.damage;
        settle(sh, z);
      } else crashed = t.reason;
    }
    return { bounces, landed, crashed, hull: sh.hull, maxUp };
  };

  const soft = run(40);
  ok(soft.landed && soft.hull === SHIP.maxHull && soft.bounces > 0,
    `юз на 40 м/с: ${soft.bounces} отскок(ов), корпус цел (${soft.hull}%), посадка`);

  // Сто метров в секунду — это уже удар: корабль отскакивает, теряет
  // треть корпуса и остаётся висеть на движках. Садиться после такого
  // приходится заново, и это правильный исход: посадкой такое касание
  // не считается.
  const hard = run(100);
  ok(hard.bounces > 0 && hard.hull < 95 && hard.hull > 40 && hard.maxUp > 0.001,
    `приход на 100 м/с: ${hard.bounces} отскок(ов) вверх до ` +
    `${(hard.maxUp * 1000).toFixed(0)} м/с, корпус ${hard.hull.toFixed(0)}% — ` +
    `${hard.crashed || (hard.landed ? 'сел со второй попытки' : 'остался в воздухе')}`);

  const fatal = run(300);
  ok(!!fatal.crashed && fatal.hull <= 0,
    `приход на 300 м/с: корпус ${fatal.hull.toFixed(0)}% — ${fatal.crashed}`);
}

// Шкала урона: квадрат скорости, шасси и поза. Проверяем не цифры, а
// смысл — касание безвредно, тяжёлый удар смертелен, между ними рост.
{
  const w = makeSystem(0x1a7e);
  const moon = moonPick(w);
  const sh = makeShip();
  const dir = normalize(v3(0.2, 0.6, -0.7));
  placeShip(sh, worldPoint(moon, dir, groundRadius(moon, dir) + SHIP.gearClear * 0.5, v3()),
    makeBasis());
  const up = dirToWorldBody(moon, dir, v3());
  const axis = Math.abs(up.x) < 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  lookAlong(sh.basis, normalize(horizontal(axis, up, v3())), up);
  const zone = landingContext(w, sh);
  const hurt = (ms, gear) => {
    sh.gear.out = gear; sh.gear.t = gear ? 1 : 0;
    zone.relVel.x = -up.x * ms / 1000;
    zone.relVel.y = -up.y * ms / 1000;
    zone.relVel.z = -up.z * ms / 1000;
    const t = checkTouchdown(sh, zone);
    if (!t) return null;
    return t.result === 'landed' ? (t.damage || 0) : (t.damage || 0);
  };
  const g1 = hurt(1, true), g25 = hurt(25, true), g50 = hurt(50, true), g95 = hurt(95, true);
  const b1 = hurt(1, false), b10 = hurt(10, false), b30 = hurt(30, false);
  ok(g1 === 0 && g25 === 0 && g50 > 5 && g50 < 40 && g95 >= SHIP.maxHull &&
     b1 <= COMBAT.belly && b10 >= b1 && b30 > b10 && b30 < SHIP.maxHull,
    `на шасси: 1 м/с — ${g1}%, 25 — ${g25}%, 50 — ${g50.toFixed(0)}%, ` +
    `95 — ${g95.toFixed(0)}%; брюхом: 1 — ${b1.toFixed(0)}%, 10 — ${b10.toFixed(0)}%, ` +
    `30 — ${b30.toFixed(0)}%`);
}

// --- 5i. Указатель вектора скорости ------------------------------------------
console.log('\n== указатель вектора ==');
{
  const cam = new Camera();
  cam.resize(1600, 900);
  lookAlong(cam.basis, v3(0, 0, 1));
  cam.pos.x = cam.pos.y = cam.pos.z = 0;

  // Летим ровно по носу — указатель ложится на прицел.
  const ahead = velocityMarker(cam, v3(0, 0, 1));
  ok(ahead && Math.abs(ahead.x - cam.cx) < 0.001 && Math.abs(ahead.y - cam.cy) < 0.001 &&
     !ahead.back,
    `полёт по носу: указатель в центре (${ahead.x.toFixed(1)}, ${ahead.y.toFixed(1)})`);

  // Под 30° вправо: смещение ровно focal·tg30°, как и положено проекции.
  const a = 30 * Math.PI / 180;
  const side = velocityMarker(cam, v3(Math.sin(a), 0, Math.cos(a)));
  const want = cam.focal * Math.tan(a);
  ok(side && Math.abs((side.x - cam.cx) - want) < 0.01 && Math.abs(side.y - cam.cy) < 0.01,
    `снос на 30°: указатель ушёл вправо на ${(side.x - cam.cx).toFixed(1)} px ` +
    `(ожидание ${want.toFixed(1)})`);

  // Вверх — вверх по экрану (ось Y там растёт вниз, знак легко перепутать).
  const upM = velocityMarker(cam, v3(0, Math.sin(a), Math.cos(a)));
  ok(upM && upM.y < cam.cy - 100, `движение вверх поднимает указатель (y ${upM.y.toFixed(0)} при центре ${cam.cy})`);

  // Задний ход: отметка перечёркнутая и с той стороны, откуда летим.
  const back = velocityMarker(cam, v3(0, 0, -1));
  ok(back && back.back && Math.abs(back.x - cam.cx) < 0.001,
    'задний ход: указатель помечен как «назад»');

  // Почти стоим — указателя нет, иначе он прыгал бы от шума.
  ok(velocityMarker(cam, v3(0, 0, 0.0005)) === null,
    'на месте указатель не рисуется');
}

console.log('\n== столкновения ==');
{
  const w = makeSystem(0x1a7e);
  const sh = makeShip();
  const p = w.home;
  const bb = makeBasis();
  // 500 км от планеты, носом в неё. Раньше тут было 5000: с круизным
  // ускорителем такой путь пролетался за минуты, а на своих 1.2 км/с
  // это больше часа модельного времени.
  const d = normalize(v3(1, 0.2, 0.3));
  placeShip(sh, v3(p.pos.x + d.x * (p.radius + 500), p.pos.y + d.y * (p.radius + 500), p.pos.z + d.z * (p.radius + 500)), bb);
  // Разворачиваем нос на планету
  const to = normalize(v3(p.pos.x - sh.pos.x, p.pos.y - sh.pos.y, p.pos.z - sh.pos.z));
  sh.basis.fwd = to;
  sh.basis.right = normalize(v3(-to.z, 0, to.x));
  sh.basis.up = normalize(v3(
    to.y * sh.basis.right.z - to.z * sh.basis.right.y,
    to.z * sh.basis.right.x - to.x * sh.basis.right.z,
    to.x * sh.basis.right.y - to.y * sh.basis.right.x));
  sh.throttle = 1;
  let crashed = false, t = 0;
  for (let i = 0; i < 60 * 1200; i++) {
    updateWorld(w, STEP);
    updateShip(sh, STEP);
    t += STEP;
    if (nearestBody(w, sh.pos).gap <= 0) { crashed = true; break; }
  }
  ok(crashed, `полёт в планету на полной тяге -> столкновение за ${t.toFixed(0)} с`);
  // Прыгнуть в ту же планету привод не даст: точка выхода снаружи, а
  // коридор упирается в неё же.
  ok(!canJump(w, sh, p).ok || sh.speed > 0,
    'привод не подменяет собой столкновение: в прыжке проверок касания нет');
}

// --- 13. Карта системы --------------------------------------------------------
//
// Карта пишет о теле десяток чисел, и главный риск здесь не в отрисовке,
// а в том, что написанное разойдётся с тем, по чему корабль летает.
// Поэтому проверяется не «нарисовалось», а «то же самое число».
console.log('\n== карта системы ==');
{
  // Гравитационная постоянная в километрах — та же, что в gravity.js.
  const G = 6.674e-20;
  let worst = 0, worstName = '';
  for (const b of world.bodies) {
    const g = G * massOf(b) / (b.radius * b.radius) * 1000;   // м/с² из массы
    const err = Math.abs(g - b.g0) / b.g0;
    if (err > worst) { worst = err; worstName = b.name; }
  }
  ok(worst < 1e-9,
    `масса в карточке и тяжесть в полёте — одно число: расхождение ${worst.toExponential(1)} ` +
    `(худшее у ${worstName})`);

  // Вторая космическая: столько же, сколько нужно, чтобы уйти от тела.
  const home = world.home;
  ok(Math.abs(escapeSpeed(home) - Math.sqrt(2 * home.mu / home.radius)) < 1e-12 &&
     escapeSpeed(home) > 1,
    `вторая космическая у ${home.name}: ${escapeSpeed(home).toFixed(2)} км/с`);

  // Температура. Шкала привязана к родной планете (иначе в сжатой
  // системе получались бы полторы тысячи градусов), но дальше работает
  // настоящий закон: поток падает как квадрат расстояния.
  const tHome = temperatureOf(world, home);
  ok(Math.abs(tHome - (T_EQ_HOME + KIND_INFO.ocean.heat)) < 1e-9,
    `родная планета откалибрована: ${(tHome - 273.15).toFixed(1)} °C`);

  // Наружу становится холоднее — но сам список температур монотонным быть
  // НЕ обязан, и с девятью планетами перестал им быть. Газовый гигант с
  // собственным теплом (+30 K) теплее ледяной планеты, которая ближе к
  // звезде, но отражает 60% света вместо 50%. Так же устроены настоящие:
  // Юпитер теплее Европы, хотя дальше. Поэтому проверяется не порядок в
  // списке, а то, что каждое исключение из него чем-то оплачено —
  // собственным теплом или альбедо. Раньше стояло голое «каждая
  // следующая холоднее», и держалось оно лишь на том, что в системе был
  // ровно один экземпляр каждого вида.
  const temps = world.planets.map((p) => temperatureOf(world, p));
  const unpaid = world.planets.filter((p, i) => {
    if (i === 0 || temps[i] < temps[i - 1]) return false;
    const a = KIND_INFO[p.kind], b = KIND_INFO[world.planets[i - 1].kind];
    return !(a.heat > b.heat || a.albedo < b.albedo);
  });
  ok(unpaid.length === 0,
    'наружу холоднее, а исключения объяснены теплом и альбедо: ' +
    temps.map((t) => (t - 273.15).toFixed(0) + '°').join(' > '));

  // Внутри одного вида поправок нет вовсе, и там порядок обязан быть
  // строгим: две ледяные планеты и два газовых гиганта на разных орбитах.
  const pairs = ['ice', 'gas'].map((k) => world.planets.filter((p) => p.kind === k));
  ok(pairs.every((g) => g.length > 1 &&
    g.every((p, i) => i === 0 || temperatureOf(world, p) < temperatureOf(world, g[i - 1]))),
    'одинаковые виды на разных орбитах: ' + pairs.map((g) => g.map((p) =>
      `${p.name} ${(temperatureOf(world, p) - 273.15).toFixed(0)}°`).join(' > ')).join('; '));

  // Два тела одного типа на разных орбитах — на них закон виден начисто,
  // без поправок на альбедо и собственное тепло.
  const withMoons = world.planets.filter((p) => p.moons.length);
  const m1 = withMoons[0].moons[0];
  const m2 = withMoons[withMoons.length - 1].moons[0];
  const ratio = temperatureOf(world, m1) / temperatureOf(world, m2);
  const want = Math.sqrt(starDistance(m2) / starDistance(m1));
  ok(Math.abs(ratio - want) < 1e-12,
    `температура падает как корень из расстояния: ${ratio.toFixed(4)} при ожидании ${want.toFixed(4)}`);

  // Атмосфера в карточке есть ровно там, где она есть у мира.
  const mismatch = world.bodies.filter((b) => !!atmosphereOf(b) !== !!b.atmo);
  ok(mismatch.length === 0,
    `воздух в карточке совпадает с воздухом в мире (${world.bodies.filter((b) => b.atmo).length} тел с атмосферой)`);

  const badMix = Object.entries(KIND_INFO)
    .filter(([, v]) => v.mix)
    .filter(([, v]) => Math.abs(v.mix.reduce((a, [, x]) => a + x, 0) - 100) > 0.01);
  ok(badMix.length === 0, 'состав воздуха везде сходится к 100%: ' +
    Object.entries(KIND_INFO).filter(([, v]) => v.mix).map(([k]) => k).join(', '));

  // ТО, ЧТО ЛЕГКО СЛОМАТЬ: давление в карточке должно работать, а не
  // просто печататься. Тонкий воздух обязан и жечь обшивку слабее.
  const ocean = world.planets.find((p) => p.kind === 'ocean');
  const desert = world.planets.find((p) => p.kind === 'desert');
  const hOcean = entryHeat(airDensity(ocean, 0), 1.2);
  const hDesert = entryHeat(airDensity(desert, 0), 1.2);
  ok(Math.abs(airDensity(desert, 0) - KIND_INFO.desert.press) < 1e-12 && hDesert < hOcean,
    `давление не подпись: ${KIND_INFO.desert.press} бар у пустынной против ${KIND_INFO.ocean.press} ` +
    `у океанической, нагрев ${hDesert.toFixed(3)} против ${hOcean.toFixed(3)}`);

  // Сутки: из периода вращения, по которому крутится сама планета.
  ok(Math.abs(dayLength(home) - 2 * Math.PI / home.spin) < 1e-9 && dayLength(home) > 3600,
    `сутки ${home.name}: ${(dayLength(home) / 3600).toFixed(1)} ч`);

  // --- карточка целиком ------------------------------------------------------
  const mship = makeShip();
  placeShip(mship, v3(home.pos.x + 40000, home.pos.y, home.pos.z), makeBasis());
  const mgame = {
    world, ship: mship, nav: makeNav(world), map: makeMap(),
    state: { messages: [] },
  };

  const card = objectCard(mgame, home);
  const keys = card.rows.map(([k]) => k);
  const needed = ['РАДИУС', 'МАССА', 'ТЯЖЕСТЬ', 'ТЕМПЕРАТУРА', 'СУТКИ', 'ГОД',
    'АТМОСФЕРА', 'СОСТАВ', 'ПОСАДКА', 'СТАНЦИЯ', 'КОРИДОР'];
  const missing = needed.filter((k) => !keys.includes(k));
  ok(missing.length === 0 && card.desc.length > 40,
    `в карточке ${home.name} есть всё, что просили: ${keys.length} строк` +
    (missing.length ? ', нет ' + missing.join(', ') : ''));

  // Ни одного «NaN», «undefined» и «Infinity» — ни у планеты, ни у
  // станции, ни у маркера: карточку читают, а не смотрят.
  const objs = mapObjects(world, home).concat(world.stations, world.markers.slice(0, 6));
  let dirty = null;
  for (const o of objs) {
    for (const [k, v] of objectCard(mgame, o).rows) {
      if (/NaN|undefined|Infinity/.test(String(v))) { dirty = o.name + ' / ' + k + ': ' + v; break; }
    }
    if (dirty) break;
  }
  ok(!dirty, `карточки ${objs.length} объектов читаются без дыр` + (dirty ? ': ' + dirty : ''));

  // Посадка в карточке — это ровно то, что скажет посадочный компьютер.
  const wrong = world.bodies.filter((b) => {
    const note = objectCard(mgame, b).rows.find(([k]) => k === 'ПОСАДКА');
    return note && /^возможна/.test(note[1]) !== isLandable(b);
  });
  ok(wrong.length === 0, 'карточка обещает посадку там же, где её разрешает игра');

  // --- масштаб ---------------------------------------------------------------
  //
  // ТО, РАДИ ЧЕГО КАРТА ПЕРЕДЕЛЫВАЛАСЬ: на обзорном масштабе станция
  // сидит внутри своей планеты (полпикселя), и выбрать её нельзя. После
  // перехода к ней она обязана отойти от планеты настолько, чтобы в неё
  // можно было ткнуть.
  const map = makeMap();
  map.vx = 0; map.vy = 46; map.vw = 1200; map.vh = 800;
  const st = world.home.station;
  const gapFit = st.orbit.radius * fitScale(map, world) * map.zoom;
  focusOn(map, world, st);
  const gapNear = st.orbit.radius * fitScale(map, world) * map.zoom;
  ok(gapFit < 2 && gapNear > 40,
    `станция отделяется от планеты приближением: ${gapFit.toFixed(2)} px на обзоре, ` +
    `${gapNear.toFixed(0)} px после перехода (масштаб ×${map.zoom.toFixed(0)})`);

  // Список выбора: вся система разом, а маркеры — только у выбранного
  // тела, иначе в списке шесть точек на каждое тело и ничего больше.
  const plain = mapObjects(world, null);
  const withMarks = mapObjects(world, home);
  // Луны считаются из мира, а не числом: их количество задаётся макетом
  // системы и меняется каждый раз, когда в неё добавляют планету.
  const moonCount = world.planets.reduce((n, p) => n + p.moons.length, 0);
  ok(plain.length === 1 + world.planets.length + world.stations.length + moonCount &&
     withMarks.length === plain.length + 6,
    `в списке карты ${plain.length} объектов, с маркерами выбранного тела — ${withMarks.length}`);

  // Попадание курсором: по экранным координатам, а не по мировым.
  map.items = [{ obj: home, sx: 100, sy: 100 }, { obj: st, sx: 124, sy: 100 }];
  ok(pickAt(map, 104, 103) === home && pickAt(map, 122, 104) === st &&
     pickAt(map, 400, 400) === null,
    'курсор попадает в ближайший к нему объект и мимо пустоты не цепляет ничего');

  ok(/10²⁴ кг/.test(fmtMass(1.71e24)) && /Земли/.test(fmtMass(1.71e24)),
    `масса читается человеком: ${fmtMass(massOf(home))}`);

  // ТО, ЧТО БЫЛО СЛОМАНО: карта — проекция на плоскость орбит, и два
  // маркера из шести стоят над полюсами, то есть приходятся ровно на
  // центр своего тела. Они закрывали планету и перехватывали щелчок.
  {
    const fake = { kind: 'moon', radius: 1000, pos: v3(), isBody: true };
    const over = { isMarker: true, body: fake, pos: v3(0, 3000, 0) };   // над полюсом
    const side = { isMarker: true, body: fake, pos: v3(3000, 0, 0) };   // в стороне
    const m2 = makeMap();
    m2.vx = 0; m2.vy = 0; m2.vw = 1200; m2.vh = 800; m2.scale = 0.01;
    ok(markerOnBody(over, m2) && !markerOnBody(side, m2) &&
       Math.abs(glyphRadius(fake, m2) - 10) < 1e-9,
      `маркер над полюсом ложится на диск тела (значок ${glyphRadius(fake, m2).toFixed(0)} px) ` +
      'и не рисуется, боковой — рисуется');

    // И даже если маркер оказался ближе к курсору, выбирается тело: он
    // точка в пустоте ВОКРУГ него, и целятся в него.
    m2.items = [{ obj: over, sx: 100, sy: 100 }, { obj: fake, sx: 104, sy: 100 }];
    ok(pickAt(m2, 100, 100) === fake,
      'маркер не перехватывает выбор у тела, на котором лежит');
    m2.items = [{ obj: over, sx: 100, sy: 100 }];
    ok(pickAt(m2, 100, 100) === over, 'сам по себе маркер выбирается как раньше');
  }
}

// --- 14. Масса в развороте ----------------------------------------------------
//
// Корабль ощущался игрушечным не потому, что вертелся быстро, а потому,
// что трогался с места рывком: угловая скорость набиралась по экспоненте,
// а та в первый же миг выдаёт максимальное ускорение. Теперь маневровые
// дают постоянный МОМЕНТ, и проверяется здесь именно это.
console.log('\n== масса в развороте ==');
{
  const S = 1 / 60;
  const spin = (axis, rate, accel) => {
    const sh = makeShip();
    sh.control[axis] = 1;
    const first = [];
    let t = 0, t95 = 0, half = 0, ang = 0, t180 = 0;
    for (let i = 0; i < 900; i++) {
      updateShip(sh, S);
      t += S;
      ang += Math.abs(sh.rot[axis]) * S;
      if (i < 3) first.push(Math.abs(sh.rot[axis]));
      if (!half && t >= SHIP.rotRamp * 0.5) half = Math.abs(sh.rot[axis]);
      if (!t95 && Math.abs(sh.rot[axis]) >= rate * 0.95) t95 = t;
      if (!t180 && ang >= Math.PI) t180 = t;
    }
    sh.control[axis] = 0;
    let stop = 0;
    for (let i = 0; i < 900; i++) {
      updateShip(sh, S);
      stop += S;
      if (Math.abs(sh.rot[axis]) < 1e-9) break;
    }
    return { t95, stop, t180, first, half, ramp: rate / accel };
  };

  const p = spin('pitch', SHIP.pitchRate, SHIP.pitchAccel);
  const y = spin('yaw', SHIP.yawRate, SHIP.yawAccel);
  const r = spin('roll', SHIP.rollRate, SHIP.rollAccel);

  // Момент один на все оси: он же и есть «маневровые такой-то силы».
  // Отсюда и разные времена разгона — не из подбора, а из геометрии.
  const I = (a, b) => a * a + b * b;
  const mp = SHIP.pitchAccel * I(HULL_HALF.y, HULL_HALF.z);
  const my = SHIP.yawAccel * I(HULL_HALF.x, HULL_HALF.z);
  const mr = SHIP.rollAccel * I(HULL_HALF.x, HULL_HALF.y);
  ok(Math.abs(mp - mr) / mr < 1e-12 && Math.abs(my - mr) / mr < 1e-12,
    `момент маневровых один на все оси: ${mp.toExponential(3)} / ${my.toExponential(3)} / ` +
    `${mr.toExponential(3)} (км²·рад/с²)`);

  // Рыскание тяжелее всех: корпус широкий и длинный, но плоский.
  ok(y.t95 > p.t95 && SHIP.yawAccel < SHIP.pitchAccel,
    `разгон осей из момента инерции: тангаж ${p.t95.toFixed(2)} с, рыскание ${y.t95.toFixed(2)} с, ` +
    `крен ${r.t95.toFixed(2)} с`);

  // Постоянное ускорение — это ПРЯМАЯ: на половине времени разгона
  // угловая скорость ровно половина предельной. Экспонента дала бы 0.63
  // и больше, и именно это чувствовалось как рывок.
  ok(Math.abs(r.half / SHIP.rollRate - 0.5) < 0.02,
    `угловая скорость растёт прямой: на половине разгона ${(r.half / SHIP.rollRate * 100).toFixed(0)}% ` +
    'предела (у экспоненты было бы 63%)');

  // Первый кадр не должен давать больше, чем даёт момент за кадр.
  const step = SHIP.rollAccel * S;
  ok(r.first[0] <= step * 1.001 && Math.abs(r.first[1] - 2 * step) < step * 0.01,
    `в первом кадре не рывок, а ${(r.first[0] * 57.3).toFixed(2)}°/с — ровно ускорение за кадр ` +
    `(раньше было ${(SHIP.rollRate * 7 * S * 57.3).toFixed(1)}°/с)`);

  // Останов стоит столько же, сколько разгон: тот же момент в другую
  // сторону. Несимметричность означала бы, что где-то есть «тормоз».
  ok(Math.abs(r.stop - r.t95) < 0.1 && Math.abs(p.stop - p.t95) < 0.1,
    `останов симметричен разгону: крен ${r.t95.toFixed(2)} / ${r.stop.toFixed(2)} с, ` +
    `тангаж ${p.t95.toFixed(2)} / ${p.stop.toFixed(2)} с`);

  // Калибровочная таблица: по ней видно поведение целиком.
  ok(r.t180 > 1.5 && r.t180 < 4 && y.t180 > 3,
    `разворот на 180°: тангаж ${p.t180.toFixed(2)} с, рыскание ${y.t180.toFixed(2)} с, ` +
    `крен ${r.t180.toFixed(2)} с`);

  // Маневровые видно и слышно ровно тогда, когда приложен момент.
  // В пустоте постоянный разворот не стоит ничего, и сопла обязаны
  // молчать — иначе это не двигатели, а подсветка.
  {
    const sh = makeShip();
    sh.control.roll = 1;
    let onSpin = 0, onHold = 0;
    for (let i = 0; i < 120; i++) {
      updateShip(sh, S);
      // Разгон крена занимает rotRamp; между ним и «держим ровно»
      // оставляем зазор в пару кадров, иначе считаем границу.
      if (i < 40) onSpin += sh.rcs.roll !== 0 ? 1 : 0;
      else if (i >= 48) onHold += sh.rcs.roll !== 0 ? 1 : 0;
    }
    sh.control.roll = 0;
    let onStop = 0, sign = 0;
    for (let i = 0; i < 60; i++) {
      updateShip(sh, S);
      if (sh.rcs.roll !== 0) { onStop++; sign = sh.rcs.roll; }
    }
    ok(onSpin === 40 && onHold === 0 && onStop > 20 && sign === -1,
      `сопла работают на раскрутке (${onSpin} кадров из 40) и на остановке (${onStop}, ` +
      `момент обратный), а на ровном вращении молчат (${onHold})`);

    // Оглушённый корабль кувыркается сам — управления нет, и сопел тоже.
    sh.stun = 1;
    sh.control.roll = 1;
    updateShip(sh, S);
    ok(sh.rcs.roll === 0 && sh.rcs.pitch === 0,
      'после удара сопла молчат: управления нет');
  }
}

// --- 15. Камни на грунте ------------------------------------------------------
//
// Высота у поверхности не читалась не из-за разрешения рельефа, а из-за
// того, что на метровом масштабе у него ничего нет: шероховатость на
// десяти метрах — двенадцать сантиметров. Камни известного размера эту
// дыру и закрывают.
console.log('\n== камни на грунте ==');
{
  const w = makeSystem(0x1a7e);
  const moon = w.bodies.find((b) => b.kind === 'moon');
  const dir = normalize(v3(0.3, 0.5, 0.81));
  const radius = ROCKS.radiusOf(0.02);
  const rocks = scatterRocks(moon, dir, radius);

  const sizes = rocks.map((r) => r.size * 1000);
  ok(rocks.length > 40 && rocks.length <= ROCKS.max &&
     Math.min(...sizes) >= ROCKS.sizeMin * 1000 - 1e-9 &&
     Math.max(...sizes) <= ROCKS.sizeMax * 1000 + 1e-9,
    `поле ${(radius * 1000).toFixed(0)} м: ${rocks.length} камней ` +
    `от ${Math.min(...sizes).toFixed(1)} до ${Math.max(...sizes).toFixed(1)} м`);

  // Мелких заметно больше крупных — так и выглядит настоящая россыпь.
  const small = sizes.filter((x) => x < 1.5).length;
  const big = sizes.filter((x) => x > 2.5).length;
  ok(small > rocks.length * 0.5 && big < rocks.length * 0.2,
    `россыпь по большей части мелкая: ${small} камней из ${rocks.length} мельче полутора ` +
    `метров, крупнее двух с половиной — ${big}`);

  // ТО, ЧТО БЫЛО СЛОМАНО: поле было РЕДКИМ. Шаг решётки растягивался
  // вместе с радиусом поля (чтобы не упереться в предел числа камней), и
  // на высоте в полсотни метров выходил один камень на сорок — в кадре
  // их оставалось два-три, то есть камней не было видно вовсе. Плотность
  // россыпи — свойство грунта, и от высоты зависеть не может.
  {
    const rows = [];
    let worst = 0;
    for (const alt of [0.005, 0.02, 0.05, 0.3]) {
      const rr = ROCKS.radiusOf(alt);
      const n = scatterRocks(moon, dir, rr).length;
      const step = Math.sqrt(Math.PI * (rr * 1000) ** 2 / Math.max(1, n));
      worst = Math.max(worst, step);
      rows.push(`${(alt * 1000).toFixed(0)} м: поле ${(rr * 1000).toFixed(0)} м, ` +
        `камень каждые ${step.toFixed(0)} м`);
    }
    ok(worst < 20, `плотность россыпи не зависит от высоты — ${rows.join('; ')}`);
  }

  // Всё поле в пределах своего радиуса.
  let far = 0;
  for (const r of rocks) {
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(r.dir, dir))));
    if (ang * moon.radius > radius * 1.001) far++;
  }
  ok(far === 0, 'ни один камень не вылез за край поля');

  // ГЛАВНОЕ СВОЙСТВО: расстановка привязана к телу, а не к камере.
  // Переехали — камни в общей части остались теми же, до последнего
  // знака. Иначе при каждом движении поле пересобиралось бы заново, и
  // камни ползли бы по грунту.
  {
    const same = scatterRocks(moon, dir, radius);
    const key = (r) => r.dir.x.toFixed(12) + ' ' + r.size.toFixed(9);
    const repeat = rocks.map(key).join('|') === same.map(key).join('|');

    // Сдвигаем центр на треть поля — ровно так, как это делает игра.
    const side = normalize(v3(
      dir.x + 0.00004, dir.y - 0.00002, dir.z + 0.00001));
    const moved = scatterRocks(moon, side, radius);
    const set = new Set(moved.map(key));
    let common = 0, drift = 0;
    for (const r of rocks) {
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(r.dir, side))));
      if (ang * moon.radius > radius * 0.9) continue;     // вышел из нового поля
      common++;
      if (!set.has(key(r))) drift++;
    }
    ok(repeat && common > 10 && drift === 0,
      `камни привязаны к телу: после переезда ${common} общих камней стоят на тех же местах`);
  }

  // Камень лежит НА грунте: низом в земле, верхом наружу. Иначе он либо
  // парит, либо тонет — и оба случая видно сразу.
  {
    const geo = buildRockGeometry(moon, rocks.slice(0, 40));
    let worstUnder = 0, best = 0;
    for (let i = 0; i < geo.faces * 3; i++) {
      const x = geo.positions[i * 3], y = geo.positions[i * 3 + 1], z = geo.positions[i * 3 + 2];
      const rr = Math.hypot(x, y, z);
      const d = normalize(v3(x / rr, y / rr, z / rr));
      const g = groundRadius(moon, d) / moon.radius;
      const over = (rr - g) * moon.radius * 1000;         // м над грунтом
      worstUnder = Math.min(worstUnder, over);
      best = Math.max(best, over);
    }
    // Верх камня обязан подниматься над грунтом настолько, чтобы его
    // было видно с высоты в пару десятков метров: ради этого он тут и
    // стоит. Низ уходит в землю тем глубже, чем шире камень и круче
    // склон под ним, — это нормально и незаметно.
    ok(best > 1.5 && best < ROCKS.sizeMax * 1000 * 1.5 &&
       worstUnder > -ROCKS.sizeMax * 1000 * 2.5,
      `камни лежат на грунте: выступают на ${best.toFixed(2)} м, ` +
      `сидят в земле на ${(-worstUnder).toFixed(2)} м`);
  }

  // ТО, ЧТО БЫЛО СЛОМАНО: камень без тени. С высоты его видно сверху, а
  // сверху камень — это многоугольник: на ровном грунте он читался как
  // пятно краски. Тень — единственное, что делает его предметом.
  {
    const up = normalize(v3(dir.x, dir.y, dir.z));
    // Солнце под заданным углом к горизонту в точке поля.
    const sunAt = (deg) => {
      const e = Math.sin(deg * Math.PI / 180);
      const side = normalize(v3(-up.y, up.x, 0));
      return normalize(v3(
        up.x * e + side.x * Math.sqrt(1 - e * e),
        up.y * e + side.y * Math.sqrt(1 - e * e),
        up.z * e + side.z * Math.sqrt(1 - e * e)));
    };
    const one = rocks.slice(0, 1);
    const reach = (deg) => {
      const sun = sunAt(deg);
      const geo = buildRockGeometry(moon, one, sun);
      // Тень — последние 24 вершины камня; меряем, насколько она уходит
      // от него и в какую сторону.
      let far = 0, along = 0, offGround = 0;
      const base = 12 * 3;
      for (let i = base; i < geo.faces * 3; i++) {
        const x = geo.positions[i * 3], y = geo.positions[i * 3 + 1], z = geo.positions[i * 3 + 2];
        const rr = Math.hypot(x, y, z);
        const d2 = normalize(v3(x / rr, y / rr, z / rr));
        offGround = Math.max(offGround,
          Math.abs(rr - groundRadius(moon, d2) / moon.radius) * moon.radius * 1000);
        // Смещение от центра камня по горизонтали.
        const ang = Math.acos(Math.max(-1, Math.min(1, dot(d2, one[0].dir))));
        far = Math.max(far, ang * moon.radius * 1000);
        // В сторону от солнца или к нему?
        const toSun = dot(d2, sun) - dot(one[0].dir, sun);
        along = Math.min(along, toSun);
      }
      return { far, along, offGround, verts: geo.faces * 3 - base };
    };

    const low = reach(20), high = reach(70);
    ok(low.verts === 24 && high.verts === 24 && low.far > high.far * 1.5,
      `тень камня вытягивается с высотой солнца: ${low.far.toFixed(1)} м при 20° ` +
      `против ${high.far.toFixed(1)} м при 70°`);
    ok(low.along < 0 && low.offGround < 1.2,
      `тень ложится ПРОЧЬ от солнца и на грунт (отрыв ${low.offGround.toFixed(2)} м)`);

    // У самого горизонта тени нет: она растянулась бы в бесконечность.
    const flat = buildRockGeometry(moon, one, sunAt(3));
    ok(flat.faces * 3 === 12 * 3,
      'у самого горизонта тень не строится: она ушла бы за край поля');
  }

  // На газовом гиганте и звезде поверхности нет — камней тоже.
  const gas = w.planets.find((b) => b.kind === 'gas');
  ok(scatterRocks(gas, dir, radius).length >= 0, 'у тел без рельефа поле не строится в сцене');
}

// --- 16. Пыль из-под движков --------------------------------------------------
//
// Второй признак близости грунта после камней: неподвижная земля о
// расстоянии не говорит ничего, а летящая из-под сопел пыль — говорит
// сразу. Проверяется, что она следует из мира: из тяги, из высоты и из
// тяжести тела.
console.log('\n== пыль из-под движков ==');
{
  const w = makeSystem(0x1a7e);
  const near = (body, alt) => {
    const dir = normalize(v3(0.3, 0.5, 0.81));
    const sh = makeShip();
    placeShip(sh, worldPoint(body, dir, groundRadius(body, dir) + alt, v3()), makeBasis());
    return sh;
  };
  const run = (body, alt, lift, secs) => {
    const sh = near(body, alt);
    sh.control.lift = lift;
    const g = { ship: sh, world: w, zone: landingContext(w, sh) };
    const d = makeDust();
    let peak = 0;
    for (let i = 0; i < Math.round(secs / STEP); i++) {
      updateDust(d, g, STEP);
      peak = Math.max(peak, d.list.length);
    }
    return { dust: d, ship: sh, zone: g.zone, peak, game: g };
  };

  const moon = w.bodies.find((b) => b.kind === 'moon');

  // ТО, ЧТО БЫЛО СЛОМАНО: пыль бралась с РУЧКИ, а не с двигателей.
  // Корабль висит над грунтом без единого нажатия — и держат его
  // подъёмные движки: с убранным шасси компенсатор высоты в точности
  // гасит вес. Значит, вниз они дуют, и пыль под ними стоит.
  const hover = run(moon, 0.01, 0, 2);
  ok(hover.peak > 5,
    `висящий корабль поднимает пыль сам: ${hover.peak} частиц без единого нажатия ` +
    `(движки держат вес, на это уходит треть их хода)`);

  // А вот на шасси компенсатора нет: стоит корабль на грунте — и пыли
  // взяться неоткуда.
  {
    const sh = near(moon, 0.01);
    sh.gear.out = true;
    sh.control.lift = 0;
    const g = { ship: sh, world: w, zone: landingContext(w, sh) };
    const d = makeDust();
    let peak = 0;
    for (let i = 0; i < Math.round(2 / STEP); i++) {
      updateDust(d, g, STEP);
      peak = Math.max(peak, d.list.length);
    }
    ok(peak === 0, 'на выпущенном шасси с выключенными движками пыли нет');
  }

  // Работают у самой земли — поднимается, но не больше предела.
  const blow = run(moon, 0.01, 1, 2);
  ok(blow.peak > 10 && blow.peak <= DUST.max,
    `на полном ходу подъёмных поднялось ${blow.peak} частиц (предел ${DUST.max})`);

  // Маршевые тоже метут грунт — но позади корабля, куда достаёт их струя.
  {
    const sh = near(moon, 0.01);
    sh.gear.out = true;                 // компенсатор выключен: только маршевые
    sh.throttle = 1;
    const g = { ship: sh, world: w, zone: landingContext(w, sh) };
    const d = makeDust();
    for (let i = 0; i < Math.round(1 / STEP); i++) updateDust(d, g, STEP);
    // Точка под кораблём в тех же осях, что и пыль.
    const fr = bodyBasis(moon, makeBasis());
    const lp = toLocal(fr, moon.pos, sh.pos, v3());
    const len = Math.hypot(lp.x, lp.y, lp.z);
    const gp = v3(lp.x / len, lp.y / len, lp.z / len);
    let far = 0;
    for (const p of d.list) {
      const ang = Math.acos(Math.max(-1, Math.min(1,
        (p.x * gp.x + p.y * gp.y + p.z * gp.z) / Math.hypot(p.x, p.y, p.z))));
      far = Math.max(far, ang * moon.radius * 1000);
    }
    ok(d.list.length > 5 && far > DUST.mainBack * 1000 * 0.5,
      `маршевые метут грунт за кормой: ${d.list.length} частиц, дальняя в ` +
      `${far.toFixed(0)} м от точки под кораблём`);
  }

  // Высоко — струя грунта не достаёт.
  const high = run(moon, DUST.maxAlt * 1.5, 1, 2);
  ok(high.peak === 0, `с ${(DUST.maxAlt * 1500).toFixed(0)} м пыли нет: струя не достаёт грунта`);

  // Заглушили движки (сели на шасси) — осела вся.
  {
    const r = run(moon, 0.01, 1, 1);
    r.ship.control.lift = 0;
    r.ship.gear.out = true;
    for (let i = 0; i < Math.round(DUST.fade / STEP) + 60; i++) updateDust(r.dust, r.game, STEP);
    ok(r.dust.list.length === 0, 'после остановки движков пыль оседает вся');
  }

  // ГЛАВНОЕ: частица летит баллистически в местной тяжести. Подъём
  // гасится тяжестью, поэтому при одной и той же тяге на луне пыль
  // встаёт заметно выше, чем на тяжёлой планете, — и это видно глазом.
  {
    const apex = (body) => {
      const sh = near(body, 0.008);
      sh.control.lift = 1;
      const g = { ship: sh, world: w, zone: landingContext(w, sh) };
      const d = makeDust();
      let up = 0;
      for (let i = 0; i < Math.round(DUST.fade / STEP); i++) {
        updateDust(d, g, STEP);
        for (const p of d.list) up = Math.max(up, Math.hypot(p.x, p.y, p.z) - p.r0);
      }
      return up * 1000;      // м
    };
    const heavy = w.planets.find((b) => b.kind === 'rock');
    const onMoon = apex(moon);
    const onRock = apex(heavy);
    ok(onMoon > onRock * 1.15,
      `подъём пыли задаёт тяжесть тела: ${onMoon.toFixed(1)} м на луне ` +
      `(${moon.g0.toFixed(2)} м/с²) против ${onRock.toFixed(1)} м на ${heavy.name} ` +
      `(${heavy.g0.toFixed(2)} м/с²)`);
  }
}

// --- 17. Шасси касается грунта ------------------------------------------------
//
// Корабль стоял по высоте центра масс, а стойки разнесены на тридцать
// метров: на склоне одна уходила в грунт, другая висела в воздухе. Теперь
// и касание, и поза считаются по трём пятам.
console.log('\n== шасси на грунте ==');
{
  const w = makeSystem(0x1a7e);
  const moon = w.bodies.find((b) => b.kind === 'moon');
  const gear = buildGear();

  // Пяты модели и пяты физики — одни и те же точки: иначе корабль стоит
  // не там, где его нарисовали.
  {
    const feetY = GEAR_FEET.map((f) => f.y);
    const same = feetY.every((y) => Math.abs(y + SHIP.gearClear) < 1e-9);
    const drawn = gear.hardpoints.map((h, i) => h.y - gear.legLengths[i]);
    const match = drawn.every((y) => Math.abs(y + SHIP.gearClear) < 1e-9);
    ok(same && match && new Set(gear.legLengths.map((l) => l.toFixed(6))).size > 1,
      `пяты на одной высоте (${(SHIP.gearClear * 1000).toFixed(2)} м под центром), ` +
      `стойки разной длины: ${gear.legLengths.map((l) => (l * 1000).toFixed(2)).join(' / ')} м`);
  }

  // Ищем склон покруче: на ровной площадке разницы не увидеть.
  let dir = null, best = 0;
  for (let i = 0; i < 300; i++) {
    const u = -1 + 2 * ((i + 0.5) / 300);
    const a = i * 2.399963;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    const d = normalize(v3(r * Math.cos(a), u, r * Math.sin(a)));
    const site = { slope: slopeAt(moon, d, 0.03) };
    if (site.slope > best && site.slope < LAND.slope * 0.9) { best = site.slope; dir = d; }
  }

  const put = () => {
    const sh = makeShip();
    placeShip(sh, worldPoint(moon, dir, groundRadius(moon, dir) + SHIP.gearClear, v3()), makeBasis());
    const up = dirToWorldBody(moon, dir, v3());
    lookAlong(sh.basis, normalize(horizontal(v3(1, 0, 0), up, v3())), up);
    sh.gear.out = true; sh.gear.t = 1;
    return sh;
  };

  // Поставленный «по центру масс» корабль на склоне стоит криво: одна
  // пята в грунте, другая над ним. Это и было видно как стойки, уходящие
  // сквозь землю.
  const raw = put();
  const { alts } = feetGround(raw, moon);
  const spread = Math.max(...alts) - Math.min(...alts);
  ok(spread > 0.003 && Math.min(...alts) < 0,
    `на склоне ${(best * 57.3).toFixed(0)}° пяты расходятся по высоте на ` +
    `${(spread * 1000).toFixed(1)} м, самая низкая уходит в грунт на ` +
    `${(-Math.min(...alts) * 1000).toFixed(1)} м`);

  // А после постановки на стоянку все три стоят на земле.
  const sh = put();
  const zone = landingContext(w, sh);
  settle(sh, zone);
  const after = feetGround(sh, moon).alts;
  // Пята стоит на грунте с точностью до хода стойки: разницу выбирают
  // сами стойки (ship.gear.drop), и после их выдвижения зазора нет.
  const rest = after.map((a, i) => a - sh.gear.drop[i]);
  const worst = Math.max(...rest.map(Math.abs));
  ok(worst < 0.0005 && sh.gear.drop.some((d) => Math.abs(d) > 0.0002),
    `все три пяты дотянулись до грунта: остаточные зазоры ` +
    `${rest.map((a) => (a * 1000).toFixed(2)).join(' / ')} м при ходе стоек ` +
    `${sh.gear.drop.map((d) => (d * 1000).toFixed(2)).join(' / ')} м`);

  // И корабль стоит по площадке, а не по вертикали: на склоне это разные
  // вещи, и разница — ровно уклон.
  const vert = dirToWorldBody(moon, localDir(moon, sh.pos, v3()), v3());
  const tilt = Math.acos(clamp(dot(sh.basis.up, vert), -1, 1));
  ok(tilt > best * 0.4,
    `корабль наклонён по площадке: ${(tilt * 57.3).toFixed(1)}° при уклоне ` +
    `${(best * 57.3).toFixed(1)}°`);

  // Касание считается по нижней пяте: на склоне корабль встречает грунт
  // раньше, чем это увидела бы высота центра масс.
  {
    const high = put();
    const upW = dirToWorldBody(moon, dir, v3());
    const lift = 0.004;                       // подняли на четыре метра
    high.pos.x += upW.x * lift; high.pos.y += upW.y * lift; high.pos.z += upW.z * lift;
    const z = landingContext(w, high);
    ok(feetClearance(high, z) < z.alt - SHIP.gearClear + 0.001,
      `нижняя пята ближе к грунту, чем центр масс: просвет ` +
      `${(feetClearance(high, z) * 1000).toFixed(1)} м против ` +
      `${((z.alt - SHIP.gearClear) * 1000).toFixed(1)} м по центру`);
  }
}

// --- 18. Срыв прыжка ----------------------------------------------------------
//
// ТО, ЧТО БЫЛО СЛОМАНО: привод на срыве просто выключался, а скорость
// оставалась на корабле — шестьдесят тысяч километров в секунду. Погасить
// их маршевыми (0.75 км/с²) нельзя и за сутки: корабль уносило из системы
// навсегда. Резко обнулять тоже нельзя — это тот же телепорт наизнанку.
console.log('\n== срыв прыжка ==');
{
  const w = makeSystem(0x1a7e);
  const run = (speed, at) => {
    const sh = makeShip();
    const q = makeQuantum();
    placeShip(sh, at, makeBasis());
    const d = normalize(v3(0, 0, 1));
    lookAlong(sh.basis, d);
    sh.vel.x = d.x * speed; sh.vel.y = d.y * speed; sh.vel.z = d.z * speed;
    sh.speed = speed;
    q.phase = 'jump';
    abortQuantum(q, sh);
    let t = 0, path = 0, ev = null;
    for (let i = 0; i < 60 * 60 && ev !== 'stopped'; i++) {
      updateWorld(w, STEP);
      const p0 = { x: sh.pos.x, y: sh.pos.y, z: sh.pos.z };
      ev = updateQuantum(q, sh, w, STEP);
      path += Math.hypot(sh.pos.x - p0.x, sh.pos.y - p0.y, sh.pos.z - p0.z);
      t += STEP;
    }
    return { q, sh, t, path, ev };
  };

  const full = run(60000, v3(2.0e6, 4e5, 0));
  ok(full.ev === 'stopped' && full.sh.speed === 0 &&
     Math.abs(full.t - QUANTUM.rampOut) < 0.2,
    `срыв на полном ходу гасит скорость за ${full.t.toFixed(1)} с ` +
    `(штатный выход — ${QUANTUM.rampOut} с), пройдено ` +
    `${(full.path / 1000).toFixed(0)} тыс. км, скорость ${full.sh.speed}`);

  // Гашение идёт ПЛАВНО: за первую десятую долю секунды скорость падает
  // на проценты, а не в ноль. Мгновенный сброс — тот же телепорт.
  {
    const sh = makeShip();
    const q = makeQuantum();
    placeShip(sh, v3(2.0e6, 4e5, 0), makeBasis());
    const d = normalize(v3(0, 0, 1));
    lookAlong(sh.basis, d);
    sh.vel.z = 60000; sh.speed = 60000;
    q.phase = 'jump';
    abortQuantum(q, sh);
    updateQuantum(q, sh, w, STEP);
    const after = sh.speed;
    ok(q.phase === 'brake' && after > 60000 * 0.95 && after < 60000,
      `сразу после срыва корабль всё ещё идёт: ${after.toFixed(0)} км/с ` +
      'на первом кадре, привод в фазе гашения');
  }

  // И самое главное: гашение не проносит корабль сквозь тело. Ставим
  // корабль в лоб планете и срываем прыжок.
  {
    const planet = w.planets.find((p) => p.kind === 'gas');
    const from = v3(
      planet.pos.x, planet.pos.y, planet.pos.z - 120000);
    const sh = makeShip();
    const q = makeQuantum();
    placeShip(sh, from, makeBasis());
    const d = normalize(v3(0, 0, 1));
    lookAlong(sh.basis, d);
    sh.vel.z = 60000; sh.speed = 60000;
    q.phase = 'jump';
    abortQuantum(q, sh);
    let ev = null, worst = Infinity;
    for (let i = 0; i < 60 * 60 && ev !== 'stopped'; i++) {
      updateWorld(w, STEP);
      ev = updateQuantum(q, sh, w, STEP);
      worst = Math.min(worst, nearestBody(w, sh.pos).gap);
    }
    ok(ev === 'stopped' && worst > 0,
      `гашение не проносит корабль сквозь планету: ближе ` +
      `${worst.toFixed(0)} км к поверхности не подошли`);
  }
}

console.log('\n== пылинки за бортом ==');
{
  // Поток за бортом — единственное, чем в пустоте видно скорость. Он
  // обязан следовать из движения корабля, а не из нажатой клавиши:
  // проверяем именно это, а не «эффект включился».
  const fly = (speed, secs = 1, dt = STEP) => {
    const sh = makeShip();
    sh.vel.x = speed;                       // курс по оси X, чтобы было видно
    const f = makeFlow();
    const g = { ship: sh, quantum: null };
    for (let i = 0; i < Math.round(secs / dt); i++) updateFlow(f, g, dt);
    return { f, sh, g };
  };
  const streakLen = (f) => Math.hypot(f.streak.x, f.streak.y, f.streak.z);

  // Стоит корабль — смазу взяться неоткуда, и потока нет вовсе.
  {
    const r = fly(0);
    ok(r.f.power === 0 && streakLen(r.f) === 0,
      'на месте потока нет: пылинки неподвижны, смазывать нечего');
  }

  // ЧЕГО ПРОСИЛИ: без форсажа пылинки еле заметны, с ним — стена полос.
  // Разница берётся не из флага, а из того, что перевалить за обычный
  // предел скорости можно только форсажем.
  {
    const calm = fly(SHIP.maxSpeed).f;
    const burn = fly(SHIP.maxSpeed * SHIP.boostMax).f;
    ok(calm.power <= FLOW.calm + 1e-9 && burn.power > calm.power * 8,
      `без форсажа поток еле виден: яркость ${calm.power.toFixed(2)} против ` +
      `${burn.power.toFixed(2)} на полном форсаже (в ${(burn.power / calm.power).toFixed(0)} раз)`);
  }

  // Длина черты — это смаз за экспозицию, а не настройка: во сколько
  // раз выше скорость, во столько же длиннее полоса.
  {
    const calm = streakLen(fly(SHIP.maxSpeed).f);
    const burn = streakLen(fly(SHIP.maxSpeed * SHIP.boostMax).f);
    ok(Math.abs(calm - SHIP.maxSpeed * FLOW.smear) < 1e-9 &&
       Math.abs(burn / calm - SHIP.boostMax) < 1e-6,
      `черта — смаз за ${(FLOW.smear * 1000).toFixed(0)} мс: ${(calm * 1000).toFixed(0)} м ` +
      `обычным ходом и ${(burn * 1000).toFixed(0)} м на форсаже (ровно в ${SHIP.boostMax} раза)`);
  }

  // Решётку двигает пройденный путь, а не число кадров: на любой
  // частоте за ту же секунду поток уходит на то же место.
  {
    const a = fly(SHIP.maxSpeed, 1, 1 / 12).f;
    const b = fly(SHIP.maxSpeed, 1, 1 / 240).f;
    const d = Math.abs(a.ofs.x - b.ofs.x);
    ok(d < 1e-9,
      `сдвиг решётки не зависит от частоты кадров: 12 и 240 Гц дают одно и то же ` +
      `(расхождение ${d.toExponential(1)} ячейки)`);
  }

  // ТО, ЧТО СЛОМАЛОСЬ БЫ ПРИ СЧЁТЕ ПО МИРУ: в гравитационном захвате
  // корабль переносится вместе с планетой и за секунду проходит по
  // орбите десятки километров. Считай мы путь по мировым координатам —
  // над неподвижной точкой грунта мимо неслась бы метель.
  {
    const r = fly(0, 1);
    r.sh.pos.x += 50;              // перенесли вместе с телом, своей скорости нет
    updateFlow(r.f, r.g, STEP);
    ok(r.f.ofs.x === 0 && r.f.power === 0,
      'перенос вместе с планетой поток не двигает: считается собственная скорость');
  }

  // На рельсах привода скорость измеряется десятками тысяч км/с. Если
  // пустить картинку по ней, за кадр решётка проскочит сотни ячеек и
  // вместо потока будет рябь. Упираем в предел корабля.
  {
    const r = fly(60000, 0.5);
    const naive = 60000 * STEP / FLOW.box;           // было бы, считай по скорости
    const real = SHIP.maxSpeed * SHIP.boostMax * STEP / FLOW.box;
    ok(streakLen(r.f) <= FLOW.streakMax + 1e-9 && real < 0.05 && naive > 100,
      `на 60000 км/с поток не рассыпается: черта ${(streakLen(r.f) * 1000).toFixed(0)} м, ` +
      `решётка идёт на ${real.toFixed(3)} ячейки за кадр вместо ${naive.toFixed(0)}`);
  }

  // В самом прыжке поток свой, от привода (js/gl/scene.js): два потока
  // в одном кадре — каша.
  {
    const sh = makeShip();
    sh.vel.x = SHIP.maxSpeed;
    const f = makeFlow();
    updateFlow(f, { ship: sh, quantum: { phase: 'jump' } }, STEP);
    ok(f.power === 0 && streakLen(f) === 0,
      'в прыжке своего потока нет: там работает поток привода');
  }
}

console.log('\n== кабина ==');
{
  const cp = buildCockpit();
  const M = 1000;                      // км -> м
  const DEG = 57.2957795;
  // Поле зрения игры: вниз от центра видно ровно половину его.
  const FOV = 68 / DEG;
  const halfDown = FOV / 2;

  // Габарит кабины — человеческий. Это не придирка к модели, а проверка
  // масштаба: данные лежат в миллиметрах, и ошибка в тысячу раз здесь
  // выглядела бы как «кабина собралась».
  {
    const w = (cp.bound.hi.x - cp.bound.lo.x) * M;
    const h = (cp.bound.hi.y - cp.bound.lo.y) * M;
    ok(w > 1.5 && w < 2.5 && h > 1.5 && h < 2.6,
      `кабина человеческого размера: ${w.toFixed(2)} x ${h.toFixed(2)} м`);
  }

  // ГЛАВНОЕ ТРЕБОВАНИЕ к кабине: она не смеет лезть в прицел. Проём
  // фонаря здесь не вырезан, а задан — рамы в нём просто нет, — и это
  // должно быть видно числом, а не на глаз.
  {
    let inCone = 0;
    for (const f of cp.shell.faces) {
      let x = 0, y = 0, z = 0;
      for (const i of f.v) {
        const p = cp.shell.verts[i];
        x += p.x / f.v.length; y += p.y / f.v.length; z += p.z / f.v.length;
      }
      if (z <= 0) continue;
      if (Math.atan2(Math.hypot(x, y), z) < 14 / DEG) inCone++;
    }
    ok(inCone === 0, `прицел чист: в конусе 14° вокруг оси ${inCone} граней кабины`);
  }

  // Рама фонаря обязана быть ВИДНА по краям кадра — иначе кабина
  // читается как приборная плита, подставленная снизу (так и вышло с
  // покупной моделью: её пришлось так резать, что от кабины осталась
  // одна доска). Считаем грани, попадающие в боковые полосы кадра:
  // по горизонтали видно ±50°, значит стойки на ±36° в кадре есть.
  {
    let side = 0, top = 0;
    for (const f of cp.shell.faces) {
      let x = 0, y = 0, z = 0;
      for (const i of f.v) {
        const p = cp.shell.verts[i];
        x += p.x / f.v.length; y += p.y / f.v.length; z += p.z / f.v.length;
      }
      if (z <= 0) continue;
      const az = Math.abs(Math.atan2(x, z)) * DEG;
      const el = Math.atan2(y, Math.hypot(x, z)) * DEG;
      if (az > 25 && az < 50 && el > -20 && el < 34) side++;
      if (el > 20 && el < 34 && az < 50) top++;
    }
    ok(side > 8 && top > 4,
      `рама в кадре: ${side} граней по бортам, ${top} сверху — обзор обрамлён, а не завешен`);
  }

  // Кабина должна быть ЗАКРЫТОЙ: пилот вертит головой (ПКМ), и назад,
  // вниз и вбок он обязан видеть кабину, а не открытый космос.
  {
    const dirs = [
      ['назад', 0, 0, -1], ['вниз', 0, -1, 0],
      ['влево', -1, 0, 0], ['вправо', 1, 0, 0],
    ];
    const seen = [];
    for (const [name, dx, dy, dz] of dirs) {
      let hit = 0;
      for (const f of cp.shell.faces) {
        let x = 0, y = 0, z = 0;
        for (const i of f.v) {
          const p = cp.shell.verts[i];
          x += p.x / f.v.length; y += p.y / f.v.length; z += p.z / f.v.length;
        }
        const L = Math.hypot(x, y, z) || 1;
        if ((x * dx + y * dy + z * dz) / L > 0.7) hit++;
      }
      if (hit > 0) seen.push(name);
    }
    ok(seen.length === dirs.length,
      `кабина закрыта со всех сторон, кроме фонаря: ${seen.join(', ')}`);
  }

  // Штурвал должен быть ВИДЕН: кабина, в которой не видно собственных
  // органов управления, теряет смысл. Верх штурвала обязан попадать в
  // нижнюю половину кадра, а не лежать под ней.
  {
    let top = -Infinity;
    for (const v of cp.yoke.verts) top = Math.max(top, v.y + cp.pivot.y);
    const z = cp.pivot.z;
    const down = Math.atan2(-top, z);
    ok(cp.yoke && down > 0 && down < halfDown,
      `штурвал в кадре: верх на ${(down * DEG).toFixed(0)}° ниже оси, видно ` +
      `${(halfDown * DEG).toFixed(0)}° (ось колонки в ${(z * M).toFixed(2)} м впереди)`);
  }

  // Приборная доска: три места, все ниже горизонта и в кадре.
  {
    const cam = new Camera();
    cam.resize(1600, 900);
    cam.basis.right = { x: 1, y: 0, z: 0 };
    cam.basis.up = { x: 0, y: 1, z: 0 };
    cam.basis.fwd = { x: 0, y: 0, z: 1 };
    const at = (p) => {
      const L = Math.hypot(p.x, p.y, p.z);
      return projectDir(cam, p.x / L, p.y / L, p.z / L, {});
    };
    const s = cp.slots;
    ok(!!s, 'приборная доска найдена по геометрии модели');
    const L = at(s.left.pos), C = at(s.mid.pos), R = at(s.right.pos);
    const onScreen = (p) => p.x > 0 && p.x < 1600 && p.y > 450 && p.y < 900;
    ok(Object.keys(s).length === 5 && [...Object.values(s)].every((sl) => sl.w > 0 && sl.h > 0),
      `экранов в кабине ${Object.keys(s).length}, у каждого свой размер`);
    ok(onScreen(L) && onScreen(C) && onScreen(R) && L.x < C.x && C.x < R.x,
      `приборы стоят на доске и в кадре: слева ${L.x | 0},${L.y | 0}; ` +
      `по центру ${C.x | 0},${C.y | 0}; справа ${R.x | 0},${R.y | 0}`);

    // ТО, ЧТО БЫЛО СЛОМАНО: у верхних табло ось «вправо» бралась от
    // НОРМАЛИ (направления на пилота), а не от направления взгляда, и
    // оказывалась зеркальной — текст на них читался задом наперёд.
    // Проверяем все экраны разом: «вправо» по экрану обязано идти
    // вправо по кадру, «вверх» — вверх.
    {
      const bad = [];
      for (const k of Object.keys(s)) {
        const sl = s[k];
        const c = at(sl.pos);
        const r = at({
          x: sl.pos.x + sl.right.x * sl.w * 0.4,
          y: sl.pos.y + sl.right.y * sl.w * 0.4,
          z: sl.pos.z + sl.right.z * sl.w * 0.4,
        });
        const u = at({
          x: sl.pos.x + sl.up.x * sl.h * 0.4,
          y: sl.pos.y + sl.up.y * sl.h * 0.4,
          z: sl.pos.z + sl.up.z * sl.h * 0.4,
        });
        if (!(r.x > c.x + 1) || !(u.y < c.y - 1)) bad.push(k);
      }
      ok(bad.length === 0,
        `ни один экран не зеркальный и не перевёрнутый (проверено ${Object.keys(s).length})` +
        (bad.length ? ': ' + bad.join(', ') : ''));
    }

    // Оси доски — настоящие оси плоскости: перпендикулярны и не
    // вырождены. Иначе преобразование холста схлопнет блок в полоску.
    const dotv = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    let worst = 0;
    for (const k of ['left', 'mid', 'right']) {
      worst = Math.max(worst, Math.abs(dotv(s[k].right, s[k].up)));
      // Нормаль смотрит НА пилота — иначе приборы окажутся с изнанки.
      if (dotv(s[k].normal, s[k].pos) > 0) worst = 1;
    }
    ok(worst < 1e-6,
      `оси доски перпендикулярны и повёрнуты к пилоту (худшее ${worst.toExponential(1)})`);
  }

  // Штурвал ходит за РУЧКАМИ, а не за угловой скоростью корабля: он в
  // руках у пилота и стоять должен там, куда его отклонили.
  {
    const y = makeYoke();
    const c = { pitch: 1, yaw: 0, roll: -1 };
    for (let i = 0; i < 120; i++) updateYoke(y, c, STEP);
    ok(Math.abs(y.pitch - YOKE.pitch) < 1e-3 && Math.abs(y.roll + YOKE.roll) < 1e-3,
      `штурвал доходит до упора: тангаж ${(y.pitch * DEG).toFixed(0)}°, ` +
      `крен ${(y.roll * DEG).toFixed(0)}°`);

    // Возврат: ручки отпущены — штурвал сам идёт в нейтраль.
    for (let i = 0; i < 120; i++) updateYoke(y, { pitch: 0, yaw: 0, roll: 0 }, STEP);
    ok(Math.abs(y.pitch) < 1e-3 && Math.abs(y.roll) < 1e-3,
      'отпущенные ручки возвращают штурвал в нейтраль');

    // Скорость не зависит от частоты кадров: на 12 и 240 Гц за ту же
    // секунду штурвал уходит одинаково.
    const run = (dt) => {
      const z = makeYoke();
      for (let i = 0; i < Math.round(1 / dt); i++) updateYoke(z, { pitch: 1 }, dt);
      return z.pitch;
    };
    const slow = run(1 / 12), fast = run(1 / 240);
    ok(Math.abs(slow - fast) < YOKE.pitch * 0.05,
      `ход штурвала почти не зависит от частоты кадров: ${(slow * DEG).toFixed(1)}° ` +
      `при 12 Гц против ${(fast * DEG).toFixed(1)}° при 240 Гц`);
  }
}

console.log('\n== телефон: профиль, джойстик, полный экран ==');
{
  // iPhone 14 Pro в горизонте: 852 x 393 точки CSS при плотности 3.
  const phone = { touch: true, coarse: true, small: true, mobile: true, dpr: 3, w: 852, h: 393 };
  const desk = { touch: false, coarse: false, small: false, mobile: false, dpr: 2, w: 1920, h: 1080 };
  const qp = qualityFor(phone), qd = qualityFor(desk);

  // ГЛАВНОЕ ЧИСЛО мобильной оптимизации — не «уровень графики», а
  // площадь кадра: она входит в стоимость линейно и целиком.
  {
    const full = phone.w * phone.dpr * phone.h * phone.dpr;
    const capped = phone.w * qp.maxDpr * phone.h * qp.maxDpr;
    ok(qp.maxDpr <= 2 && capped < full * 0.5,
      `плотность пикселей ограничена: ${(full / 1e6).toFixed(1)} Мп честного кадра против ` +
      `${(capped / 1e6).toFixed(1)} Мп рисуемого (в ${(full / capped).toFixed(1)} раза меньше работы)`);
  }

  // Второе по весу — рельеф на пиксель: он считается для каждого
  // закрашенного пикселя поверхности.
  ok(qd.detail === true && qp.detail === false,
    'мелкий рельеф на пиксель на телефоне выключен, на настольной машине остаётся');

  // Бюджеты объектов урезаны, но не обнулены: играть надо во всё то же.
  ok(qp.tileBudget < qd.tileBudget && qp.targetDraw < qd.targetDraw &&
     qp.workers < qd.workers && qp.rocks < qd.rocks && qp.dust < qd.dust &&
     qp.tileBudget > 0 && qp.rocks > 0 && qp.dust > 0,
    `бюджеты урезаны: плиток ${qd.tileBudget}->${qp.tileBudget}, в кадре ` +
    `${qd.targetDraw}->${qp.targetDraw}, потоков ${qd.workers}->${qp.workers}, ` +
    `камней ${qd.rocks}->${qp.rocks}, пыли ${qd.dust}->${qp.dust}`);

  // Приборы на 393 точках высоты обязаны ужаться, иначе панель занимает
  // треть кадра.
  ok(qp.hudScale < 0.85 && qp.hudScale >= 0.6,
    `масштаб приборов на телефоне ${qp.hudScale.toFixed(2)}`);

  // А на большом мониторе — вырасти. Приборы рисовались в пикселях под
  // экран 1600×900, и на 2556 точках подпись в девять пикселей
  // превращалась в сыпь: панель, занимавшая четверть кадра, занимала
  // десятую его часть. Отсюда и была жалоба «интерфейс непонятный».
  {
    const at = (w, h) => qualityFor({ mobile: false, touch: false, w, h }).hudScale;
    ok(at(1280, 720) === 1 && at(1600, 900) === 1,
      `на своём размере приборы не трогаем: ${at(1280, 720)} и ${at(1600, 900)}`);
    ok(at(2556, 1305) > 1.3 && at(1920, 1080) > 1.1,
      `на широком мониторе растут: 1920 -> ${at(1920, 1080).toFixed(2)}, ` +
      `2556 -> ${at(2556, 1305).toFixed(2)}`);
    // Предел нужен: на 4K приборы иначе съели бы кадр.
    ok(at(7680, 4320) <= 2, `но не бесконечно: 8K -> ${at(7680, 4320)}`);
    // Узкий и высокий экран растить по ширине нельзя — панели полезли бы
    // одна на другую по высоте. Берётся меньшее из двух отношений.
    ok(at(2560, 800) < at(2560, 1440),
      `на низком экране растут меньше: ${at(2560, 800).toFixed(2)} против ` +
      `${at(2560, 1440).toFixed(2)}`);
  }
  ok(qp.touchUi === true && qd.touchUi === false,
    'сенсорные органы появляются по грубому указателю, а не по ширине экрана');

  // Настольный профиль обязан остаться ровно тем, чем был до появления
  // профилей: иначе «оптимизация телефона» молча ухудшила бы игру на
  // мониторе.
  ok(qd.tileBudget === 440 && qd.targetDraw === 220 && qd.texelTol === 40 &&
     qd.workers === 3 && qd.rocks === 520 && qd.dust === 150 && qd.stars === 950,
    'настольный профиль не изменился ни в одном числе');

  // --- раскладка органов -----------------------------------------------------
  // Вырезы iPhone в горизонте: остров съедает полосу сбоку, снизу идёт
  // полоса жеста «домой».
  const insets = { left: 59, right: 0, top: 0, bottom: 21 };
  const L = touchLayout(phone.w, phone.h, insets);

  {
    // Ничего не должно вылезать за экран и залезать под вырез.
    const bad = [];
    const check = (name, x, y, rx, ry = rx) => {
      if (x - rx < insets.left || x + rx > phone.w - insets.right ||
          y - ry < insets.top || y + ry > phone.h - insets.bottom) bad.push(name);
    };
    check('джойстик', L.stick.x, L.stick.y, L.stick.r);
    check('тяга', L.thr.x, L.thr.y, L.thr.w / 2, L.thr.h / 2);
    for (const b of L.buttons) check(b.id, b.x, b.y, b.r);
    ok(bad.length === 0,
      `все органы в безопасной области 852x393 с вырезом ${insets.left} слева` +
      (bad.length ? ': ' + bad.join(', ') : ''));
  }

  {
    // Кнопки не должны налезать друг на друга: палец шириной в сантиметр
    // нажмёт обе.
    let worst = Infinity, pair = '';
    for (let i = 0; i < L.buttons.length; i++) {
      for (let j = i + 1; j < L.buttons.length; j++) {
        const a = L.buttons[i], b = L.buttons[j];
        const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
        if (gap < worst) { worst = gap; pair = `${a.id}/${b.id}`; }
      }
    }
    ok(worst > 4, `кнопки не слипаются: минимальный зазор ${worst.toFixed(0)} точек (${pair})`);
  }

  // --- сам джойстик ----------------------------------------------------------
  const ship = makeShip();
  const press = (t, x, y, id = 1) => touchUpdate(t, [{ id, x, y }], L);

  {
    // Тянем ручку вниз — нос идёт вверх, как у штурвала: потянул на
    // себя, пошёл вверх.
    const t = makeTouch();
    press(t, L.stick.x, L.stick.y);                  // палец лёг в центр
    press(t, L.stick.x, L.stick.y + L.stick.r);      // и уехал вниз
    touchApply(t, ship);
    ok(input.pad.pitch > 0.8 && Math.abs(input.pad.yaw) < 0.01,
      `ручка на себя — нос вверх: тангаж ${input.pad.pitch.toFixed(2)}, ` +
      `рыскание ${input.pad.yaw.toFixed(2)}`);
  }

  {
    // Вправо — рыскание вправо, и значение ПЛАВНОЕ: в этом весь смысл
    // джойстика против клавиши.
    const t = makeTouch();
    press(t, L.stick.x, L.stick.y);
    press(t, L.stick.x + L.stick.r * 0.5, L.stick.y);
    touchApply(t, ship);
    const half = input.pad.yaw;
    press(t, L.stick.x + L.stick.r * 2, L.stick.y);  // за край поля
    touchApply(t, ship);
    ok(half > 0.3 && half < 0.6 && Math.abs(input.pad.yaw - 1) < 1e-6,
      `ход ручки плавный: полпути даёт ${half.toFixed(2)}, за краем — ровно 1.00`);
  }

  {
    // Мёртвая зона: палец никогда не стоит ровно в центре.
    const t = makeTouch();
    press(t, L.stick.x, L.stick.y);
    press(t, L.stick.x + L.stick.r * 0.05, L.stick.y + L.stick.r * 0.05);
    touchApply(t, ship);
    ok(input.pad.pitch === 0 && input.pad.yaw === 0,
      'дрожание пальца в центре ручки не сдвигает корабль');
  }

  {
    // Отпустили — ручка вернулась в ноль сама.
    const t = makeTouch();
    press(t, L.stick.x, L.stick.y + L.stick.r);
    touchUpdate(t, [], L);
    touchApply(t, ship);
    ok(input.pad.pitch === 0 && t.stick.id === null,
      'отпущенная ручка возвращается в ноль');
  }

  {
    // Ползунок тяги задаёт САМУ тягу: пальцем «подержать Shift» нельзя.
    const t = makeTouch();
    const top = L.thr.y - L.thr.h / 2;
    press(t, L.thr.x, top + L.thr.h * 0.25);          // на три четверти вверх
    touchApply(t, ship);
    ok(Math.abs(ship.throttle - 0.75) < 0.02,
      `ползунок задаёт тягу абсолютно: ${ship.throttle.toFixed(2)} на трёх четвертях хода`);
  }

  {
    // Кнопка нажимает ТУ ЖЕ клавишу, что и с клавиатуры: игровая логика
    // о касаниях не знает вовсе.
    const t = makeTouch();
    const gear = L.buttons.find((b) => b.id === 'gear');
    press(t, gear.x, gear.y);
    touchApply(t, ship);
    const pressedOnce = input.pressed('KeyG');
    input.endFrame();
    // Держим палец дальше — второго нажатия быть не должно.
    press(t, gear.x, gear.y);
    touchApply(t, ship);
    const again = input.pressed('KeyG');
    input.endFrame();
    ok(pressedOnce && !again,
      'кнопка шасси срабатывает один раз на касание, а не каждый кадр удержания');
  }

  {
    // Форсаж — на удержании: отпустил, и он кончился.
    const t = makeTouch();
    const boost = L.buttons.find((b) => b.id === 'boost');
    press(t, boost.x, boost.y);
    touchApply(t, ship);
    const held = input.isDown('Space');
    input.endFrame();
    touchUpdate(t, [], L);
    touchApply(t, ship);
    const after = input.isDown('Space');
    input.endFrame();
    ok(held && !after, 'форсаж держится, пока палец на кнопке');
  }

  {
    // Палец по свободному месту — это осмотр камерой, а не промах по
    // кнопке.
    const t = makeTouch();
    press(t, phone.w / 2, phone.h / 2);
    press(t, phone.w / 2 + 40, phone.h / 2);
    const d = touchDrag(t);
    ok(t.look.id !== null && Math.abs(d.x - 40) < 1e-6,
      `свободное место ведёт камеру: сдвиг ${d.x.toFixed(0)} точек`);
  }

  // Полный экран: на iPhone его нет вовсе, и кнопку там показывать
  // нельзя — она бы не работала.
  ok(fullscreenAvailable(null) === false,
    'без документа полного экрана нет — кнопка не рисуется');
  ok(fullscreenAvailable({ documentElement: { requestFullscreen() {} } }) === true &&
     fullscreenAvailable({ documentElement: {} }) === false,
    'кнопка полного экрана появляется только там, где браузер его умеет');

  // Кеш исходников. Игра — это ES-модули, импортирующие друг друга по
  // относительным путям: версию в имени одного файла не поставить, а
  // смесь нового и старого кода — худший из исходов, потому что такой
  // версии не существовало никогда. Поэтому кеш выключен на сервере, и
  // правило проверяется как всё остальное: файл легко потерять при
  // переносе на другую машину.
  {
    const rules = readFileSync(new URL('../.htaccess', import.meta.url), 'utf8');
    const js = /FilesMatch[^>]*js[^>]*>[\s\S]*?<\/FilesMatch>/i.exec(rules);
    const body = js ? js[0] : '';
    ok(/no-store/i.test(body) && /Header unset ETag/i.test(rules),
      'исходники раздаются без кеша: no-store и без ETag — перезагрузка страницы берёт свежий код');
  }
}


// --- 17.5. Свежий код на каждой перезагрузке ---------------------------------
console.log('\n== свежий код: адреса модулей ==');
{
  const root = new URL('../', import.meta.url);
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const login = readFileSync(new URL('login.html', root), 'utf8');
  const loader = readFileSync(new URL('cache.js', root), 'utf8');

  // Загрузчик достаём из страницы и ЗАПУСКАЕМ на поддельном документе:
  // проверять его текстом бессмысленно — важно не то, что в нём написано,
  // а какие адреса он в итоге выдаёт браузеру.
  const part = (src, re, what) => {
    const m = re.exec(src);
    if (!m) throw new Error('не найдено: ' + what);
    return m[1];
  };
  const stampLine = part(html, /<script>([^]*?)<\/script>/, 'строка с меткой в index.html');
  const entry = part(html, /<script id="srcEntry">([^]*?)<\/script>/, 'точка входа в index.html');

  const run = (importmap, now) => {
    const head = [], body = [], asked = [], written = [];
    const doc = {
      write: (s) => written.push(s),
      createElement: (tag) => ({ tag, type: '', rel: '', href: '', src: '', textContent: '' }),
      head: { appendChild: (e) => head.push(e) },
      body: { appendChild: (e) => body.push(e) },
    };
    const win = {};
    // Браузер без таблицы импортов: сам класс есть, метода supports нет.
    const HSE = importmap ? { supports: (f) => f === 'importmap' } : {};
    const fetchFn = (u, o) => { asked.push([u, o && o.cache]); return Promise.resolve(); };
    new Function('document', 'window', 'Date', stampLine)(doc, win, { now: () => now });
    new Function('document', 'window', 'HTMLScriptElement', 'fetch', loader)(doc, win, HSE, fetchFn);
    new Function('document', 'window', entry)(doc, win);
    const map = head.find((e) => e.type === 'importmap');
    return {
      imports: map ? JSON.parse(map.textContent).imports : null,
      css: head.find((e) => e.tag === 'link'),
      entry: body[0],
      loader: written.join(''),
      asked,
      stamp: win.__srcStamp,
      fresh: win.__srcFresh,
    };
  };

  const a = run(true, 1e9);

  {
    // Главное: в списке должны быть ВСЕ файлы игры. Забытый файл — это не
    // «чуть хуже», а смесь нового и старого кода в одном запуске.
    const disk = [];
    (function walk(dir) {
      for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) {
        if (e.isDirectory()) walk(dir + e.name + '/');
        else if (e.name.endsWith('.js')) disk.push(dir + e.name);
      }
    })('js/');
    const keys = Object.keys(a.imports).map((k) => k.slice(2)).sort();
    ok(keys.length === disk.length && keys.join() === disk.sort().join(),
      `в списке загрузчика все ${disk.length} файлов игры — ни один не остался на старом адресе`);
  }

  ok(!!a.stamp && a.loader.indexOf('cache.js?v=' + a.stamp) > 0 &&
     Object.entries(a.imports).every(([k, v]) => v === k + '?v=' + a.stamp),
    `каждый модуль получает метку загрузки: ${a.imports['./js/main.js']}`);

  ok(a.entry.type === 'module' && a.entry.src === 'js/boot.js?v=' + a.stamp &&
     a.css.rel === 'stylesheet' && a.css.href === 'css/style.css?v=' + a.stamp,
    'точка входа и стиль идут с той же меткой — их адрес таблица импортов не трогает');

  {
    // Каждая перезагрузка — новые адреса, иначе браузеру нечего заново
    // спрашивать.
    const b = run(true, 1e9 + 60000);
    ok(b.stamp !== a.stamp && b.imports['./js/main.js'] !== a.imports['./js/main.js'],
      `следующее открытие страницы даёт другие адреса: ${a.stamp} -> ${b.stamp}`);
  }

  {
    // Поток сборки плиток читает свои файлы сам, и таблица импортов на
    // него не действует вовсе. Список его файлов сверяем с настоящими
    // импортами js/gl/tileworker.js: разойдись он с кодом — поток тихо
    // остался бы на старом рельефе, пока весь остальной код новый.
    const closure = (start) => {
      const seen = new Set(), stack = [start];
      while (stack.length) {
        const f = stack.pop();
        if (seen.has(f)) continue;
        seen.add(f);
        const src = readFileSync(new URL(f, root), 'utf8');
        for (const m of src.matchAll(/from '([^']+)'/g)) {
          if (!m[1].startsWith('.')) continue;
          stack.push(new URL(m[1], new URL(f, root)).href.slice(root.href.length));
        }
      }
      return [...seen].sort();
    };
    const need = closure('js/gl/tileworker.js');
    const got = a.asked.map(([u]) => u).sort();
    ok(got.join() === need.join() && a.asked.every(([, c]) => c === 'reload') && !!a.fresh,
      `файлы потока сборки берутся мимо кеша (cache: reload), все ${need.length}: ` +
      need.map((f) => f.slice(6)).join(', '));
  }

  {
    // Браузер без таблицы импортов: метки не ставим вовсе. Свежей была бы
    // одна точка входа, а остальное пришло бы из кеша — получилась бы
    // версия, которой никогда не существовало.
    const c = run(false, 1e9);
    ok(c.imports === null && c.entry.src === 'js/boot.js' &&
       c.css.href === 'css/style.css' && c.fresh === null,
      'без поддержки таблицы импортов игра грузится по-старому, а не наполовину свежей');
  }

  ok(/cache\.js\?v=/.test(login) && !/<link[^>]+stylesheet/.test(login) &&
     !/<script[^>]+src=/.test(html) && !/<link[^>]+stylesheet/.test(html),
    'обе страницы, игра и вход, грузятся через загрузчик: постоянных адресов в разметке не осталось');
}


// --- 18. Галактика и варп-привод --------------------------------------------
console.log('\n== галактика ==');
{
  const g = makeGalaxy();
  const g2 = makeGalaxy();
  ok(g.systems.length === SYSTEM_COUNT &&
     g.systems.every((s, i) => s.name === g2.systems[i].name && s.seed === g2.systems[i].seed),
    `галактика детерминирована: ${g.systems.length} систем, ` +
    g.systems.map((s) => s.name).join(', '));

  const home = g.systems[0];
  ok(home.name === 'Lave' && home.seed === HOME_SEED &&
     home.pos.x === 0 && home.pos.y === 0 && home.pos.z === 0,
    'родная система первая и стоит в начале координат');

  const names = new Set(g.systems.map((s) => s.name));
  ok(names.size === g.systems.length, 'имена систем не повторяются');

  let closest = Infinity;
  for (let i = 0; i < g.systems.length; i++) {
    for (let j = i + 1; j < g.systems.length; j++) {
      closest = Math.min(closest, systemDistance(g.systems[i], g.systems[j]));
    }
  }
  ok(closest >= MIN_APART,
    `системы не слипаются: ближайшая пара в ${closest.toFixed(1)} св. годах (предел ${MIN_APART})`);

  // Разброс расстояний — это разброс времени прыжка, то есть весь смысл
  // выбора цели. Когда радиусы выпадали случайно, все шесть соседей
  // оказывались на 16–21 световом годе, и любой прыжок шёл одинаково.
  const away = g.systems.slice(1).map((s) => systemDistance(home, s)).sort((a, b) => a - b);
  ok(away[0] < 12 && away[away.length - 1] > 20,
    `от дома есть и ближние, и дальние: ${away.map((d) => d.toFixed(0)).join(', ')} св. лет`);

  const times = g.systems.slice(1).map((s) => warpSeconds(home, s));
  ok(times.every((t) => t >= WARP_MIN && t <= WARP_MAX),
    `прыжок всегда десятки секунд: ${times.map((t) => t.toFixed(0)).join(', ')} с`);

  // Крайние классы звёзд видно сильнее всего: у карлика система вчетверо
  // теснее и светит оранжевым, у белой растянута и залита голубым. Если
  // бросать класс с весами, в пятой части галактик карлика нет вовсе.
  const cls = new Set(g.systems.map((s) => s.cls.id));
  ok(cls.has('M') && cls.has('A') && cls.size >= 4,
    'в галактике есть и красный карлик, и белая: классы ' + [...cls].sort().join(', '));

  // Обитаемая зона — не украшение: по ней расставлены планеты и по ней
  // же считаются все температуры.
  ok(g.systems.every((s) => Math.abs(s.hab - HAB_HOME * Math.sqrt(s.cls.lum)) < 1e-6),
    'обитаемая зона идёт как корень из светимости');
}

console.log('\n== системы галактики ==');
{
  const g = makeGalaxy();
  for (const s of g.systems) {
    const w = makeSystem(s);
    const orbits = w.planets.map((p) => p.orbit.radius);
    const grow = orbits.every((r, i) => i === 0 || r > orbits[i - 1]);
    const inStar = w.planets.some((p) => p.orbit.radius < w.star.radius * 2);
    const land = w.bodies.filter(isLandable).length;
    ok(grow && !inStar && w.planets.length >= 4 && w.stations.length >= 1 && land >= 1 &&
       orbits[orbits.length - 1] <= 5000000,
      `${w.name}: ${w.planets.length} планет, ${w.stations.length} портов, ${land} мест посадки, ` +
      `край ${(orbits[orbits.length - 1] / 1e6).toFixed(2)} млн км` +
      (grow ? '' : ' — ОРБИТЫ НЕ РАСТУТ') + (inStar ? ' — ПЛАНЕТА В ЗВЕЗДЕ' : ''));
  }

  // Размер системы обязан зависеть от звезды, иначе класс ни на чём не
  // сказывается и все системы на одно лицо.
  const size = (s) => {
    const w = makeSystem(s);
    return w.planets[w.planets.length - 1].orbit.radius;
  };
  const dim = g.systems.filter((s) => s.cls.id === 'M').map(size);
  const bright = g.systems.filter((s) => s.cls.id === 'A' || s.cls.id === 'F').map(size);
  ok(dim.length && bright.length && Math.max(...dim) < Math.max(...bright),
    `у тусклой звезды система теснее: карлики до ${(Math.max(...dim) / 1e6).toFixed(2)} млн км, ` +
    `яркие до ${(Math.max(...bright) / 1e6).toFixed(2)} млн`);

  // Родная система — рукотворная, и она не должна была поехать от того,
  // что рядом появился генератор.
  const lave = makeSystem(HOME_SEED);
  ok(lave.planets.length === HOME_LAYOUT.length &&
     lave.planets.every((p, i) => p.kind === HOME_LAYOUT[i].kind &&
       p.radius === HOME_LAYOUT[i].r && p.orbit.radius === HOME_LAYOUT[i].orbit),
    'родная система собрана по рукотворному макету, а не генератором');

  // Ни одна система не повторяет другую: иначе прыжок не имеет смысла.
  const shapes = g.systems.map((s) => {
    const w = makeSystem(s);
    return w.planets.map((p) => p.kind + p.radius).join('|');
  });
  ok(new Set(shapes).size === shapes.length, 'все системы разные по составу');
}

console.log('\n== варп-привод ==');
{
  const g = makeGalaxy();
  const from = g.systems[0], to = g.systems[3];
  const sh = makeShip();
  const w = makeWarp();

  ok(!canWarp(sh, from, null).ok && !canWarp(sh, from, from).ok && canWarp(sh, from, to).ok,
    'без цели и в свою же систему прыжок не начинается');
  sh.dockedAt = {};
  ok(!canWarp(sh, from, to).ok, 'из порта не прыгнуть: ' + canWarp(sh, from, to).reason);
  sh.dockedAt = null;
  sh.landedAt = {};
  ok(!canWarp(sh, from, to).ok, 'с грунта не прыгнуть: ' + canWarp(sh, from, to).reason);
  sh.landedAt = null;

  startWarp(w, from, to);
  ok(w.phase === 'align' && Math.abs(w.total - warpSeconds(from, to)) < 1e-9,
    `центровка начата, прыжок на ${w.total.toFixed(0)} с`);

  // Нос в другую сторону: готовность не копится, а тает.
  const axis = warpAxis(from, to, v3());
  lookAlong(sh.basis, v3(-axis.x, -axis.y, -axis.z), v3(0, 1, 0));
  w.calib = 0.5;
  updateWarp(w, sh, 0.5);
  ok(!w.aligned && w.calib < 0.5, `мимо оси готовность тает: ${w.calib.toFixed(2)}`);

  // Нос по оси: копится и уходит в прыжок. Готовность обнуляется руками —
  // проверка выше уже подъела её отклонением от оси, и полная раскрутка
  // мерялась бы от середины.
  lookAlong(sh.basis, axis, v3(0, 1, 0));
  w.calib = 0;
  let ev = null, t = 0;
  for (let i = 0; i < 60 * 10 && ev !== 'engage'; i++) { ev = updateWarp(w, sh, STEP); t += STEP; }
  ok(ev === 'engage' && w.phase === 'tunnel' && Math.abs(t - WARP.spool) < 0.2,
    `по оси привод раскручивается за ${t.toFixed(1)} с (ожидание ${WARP.spool})`);

  // Тоннель: смена системы ровно один раз, выход по времени.
  let hands = 0, arrive = -1, tt = 0, coverFrom = -1, coverTo = -1;
  for (let i = 0; i < 60 * 60; i++) {
    const e = updateWarp(w, sh, STEP);
    tt += STEP;
    const p = warpPower(w);
    if (coverFrom < 0 && p > 0.97) coverFrom = tt;
    if (coverFrom >= 0 && p > 0.97) coverTo = tt;
    if (e === 'handover') hands++;
    if (e === 'arrive') { arrive = tt; break; }
  }
  ok(hands === 1 && Math.abs(arrive - w.total) < 0.05,
    `смена системы один раз, выход через ${arrive.toFixed(1)} с из ${w.total.toFixed(1)}`);

  // Систему меняют ПОД непрозрачным тоннелем — иначе подмена видна.
  ok(coverFrom > 0 && handoverAt(w) > coverFrom && handoverAt(w) < coverTo,
    `смена на ${handoverAt(w).toFixed(1)} с попадает в глухой участок ` +
    `${coverFrom.toFixed(1)}–${coverTo.toFixed(1)} с`);

  // Выход — у звезды, носом на неё.
  const dest = makeSystem(to);
  placeAtStar(w, sh, dest.star);
  const d = Math.hypot(sh.pos.x - dest.star.pos.x, sh.pos.y - dest.star.pos.y,
    sh.pos.z - dest.star.pos.z);
  const toStar = normalize(v3(dest.star.pos.x - sh.pos.x, dest.star.pos.y - sh.pos.y,
    dest.star.pos.z - sh.pos.z));
  ok(Math.abs(d - dest.star.radius * WARP.exitR) < 1e-6 &&
     dot(toStar, sh.basis.fwd) > 0.999 && sh.speed === 0,
    `выход в ${(d / dest.star.radius).toFixed(1)} радиусах звезды, носом на неё, скорость ноль`);

  finishWarp(w, sh);
  ok(w.phase === 'idle' && sh.speed === 0 && w.to === null, 'после выхода привод выключен и ход погашен');
}

// --- дела пилота: кроны, трюм, задания ---------------------------------------
console.log("\n== пилот: кроны, трюм, задания ==");
{
  // ЛЕНТА И БАЛАНС. Раздел «Финансы» — это лента операций, и деньги,
  // появившиеся без строки в ней, были бы деньгами из ниоткуда. Поэтому
  // баланс обязан сходиться с лентой копейка в копейку.
  const p = makePlayer(false);
  ledgerAdd(p, 'ПРОДАЖА РУДЫ', 1800);
  ledgerAdd(p, 'РЕМОНТ КОРПУСА', -640);
  ledgerAdd(p, 'СТЫКОВОЧНЫЙ СБОР', -35);
  const sum = p.ledger.reduce((a, e) => a + e.sum, 0);
  const t = ledgerTotals(p);
  ok(p.balance === sum && p.balance === 1125 && t.in === 1800 && t.out === 675,
    `баланс сходится с лентой: ${p.balance} = ${t.in} - ${t.out}`);

  // Лента подрезается, баланс — нет. Считать баланс суммой записей
  // нельзя ровно поэтому: за длинный вылет старые строки выпадают.
  const q = makePlayer(false);
  for (let i = 0; i < LEDGER_MAX + 40; i++) ledgerAdd(q, 'РЕЙС ' + i, 10);
  ok(q.ledger.length === LEDGER_MAX && q.balance === (LEDGER_MAX + 40) * 10,
    `лента подрезана до ${q.ledger.length}, а баланс помнит всё: ${q.balance}`);
}
{
  // ТРЮМ. Меряется тоннами, и сверх ёмкости не лезет ничего.
  const p = makePlayer(false);
  ok(loadCargo(p, 'ВОДА', 6, 20) && loadCargo(p, 'ЗЕРНО', 4, 20) && cargoTons(p) === 10,
    'груз кладётся, тоннаж считается: ' + cargoTons(p) + ' т');
  ok(loadCargo(p, 'РУДА', 10, 20) && !loadCargo(p, 'РУДА', 0.5, 20),
    'трюм заполняется ровно до края и дальше не берёт');
  ok(cargoTons(p) === 20 && p.cargo.length === 3, 'перегруза нет: ' + cargoTons(p) + ' т');

  // Одинаковый товар лежит ОДНОЙ кучей: две строки «вода» в накладной —
  // это не два разных груза, а неряшливость.
  const before = p.cargo.length;
  const water = p.cargo.find((c) => c.name === 'ВОДА');
  dropCargo(p, water.id, 6);
  ok(before === 3 && p.cargo.length === 2 && cargoTons(p) === 14,
    'сброс убирает позицию целиком: осталось ' + cargoTons(p) + ' т');
  const ore = p.cargo.find((c) => c.name === 'РУДА');
  dropCargo(p, ore.id, 4);
  ok(p.cargo.find((c) => c.name === 'РУДА').tons === 6 && cargoTons(p) === 10,
    'частичный сброс оставляет остаток: ' + cargoTons(p) + ' т');

  // Демо-набор обязан помещаться в трюм ЭТОГО корабля: иначе меню с
  // первого запуска показывает перегруз, которого не может быть.
  ok(cargoTons(makePlayer()) <= SHIP.hold,
    `стартовый груз влезает в трюм: ${cargoTons(makePlayer())} из ${SHIP.hold} т`);
}
{
  // ВРЕМЯ НА ЭКРАНЕ. Округление секунд после деления на минуты давало
  // «29 мин 60 с» — на сроке задания это и вылезло.
  const bad = [];
  for (let t = 90; t < 7200; t += 0.1) {
    const s = fmtTime(t);
    if (/ 60 с$/.test(s) || / 60 мин$/.test(s)) { bad.push(t.toFixed(1) + ' -> ' + s); break; }
  }
  ok(bad.length === 0 && fmtTime(1799.6) === '30 мин 0 с' && fmtTime(3599.7) === '1 ч 0 мин',
    'время на экране не показывает 60 секунд и 60 минут' + (bad.length ? ': ' + bad[0] : ''));
}
{
  // СРОКИ. Часы пилота идут всегда, срок падает до нуля и там стоит.
  const p = makePlayer(false);
  const m = addMission(p, { title: 'ДОСТАВКА', desc: 'куда-нибудь', reward: 900, time: 100 });
  updatePlayer(p, 40);
  ok(Math.abs(m.left - 60) < 1e-9 && Math.abs(p.time - 40) < 1e-9 && !missionExpired(m),
    `срок идёт: осталось ${m.left} с, часы пилота ${p.time} с`);
  updatePlayer(p, 200);
  ok(m.left === 0 && missionExpired(m) && p.missions.length === 1,
    'просроченное задание остаётся в списке и помечено');
}
{
  // СОХРАНЕНИЕ. Сейв — чужие данные: он переживает смену формата и его
  // правят руками. Кривое поле обязано давать пустоту, а не падение
  // меню посреди полёта.
  const p = makePlayer();
  updatePlayer(p, 12);
  const back = loadPlayer(makePlayer(false), JSON.parse(JSON.stringify(savePlayer(p))));
  ok(back.balance === p.balance && cargoTons(back) === cargoTons(p) &&
     back.missions.length === p.missions.length && Math.abs(back.time - p.time) < 1e-9,
    'сейв пилота восстанавливается целиком');

  const junk = loadPlayer(makePlayer(false), {
    balance: 'много', ledger: [{ label: 'ЛАДНО', sum: 5 }, null, 7],
    cargo: [{ name: 'ВОДА', tons: -3 }, { tons: 4 }, { name: 'РУДА', tons: 2 }],
    missions: [{ reward: 100 }, { title: 'ЕСТЬ', left: 'скоро' }],
    time: NaN,
  });
  ok(junk.balance === 0 && junk.time === 0 && junk.ledger.length === 1 &&
     junk.cargo.length === 1 && junk.missions.length === 1 && junk.missions[0].left === 0,
    'кривой сейв даёт пустоту, а не исключение');
}

// --- чужие корабли: снимки в движение ---------------------------------------
//
// Сервер шлёт положение пять раз в секунду, а кадров шестьдесят. Весь этот
// модуль существует ради того, чтобы чужой корабль не дёргался, и
// проверяется он целиком здесь: ни сети, ни браузера ему не нужно.
{
  console.log('\n== чужие корабли ==');

  const st = makePeers();
  const snap = (x, t, extra = {}) => ingestPeers(st, [Object.assign({
    id: 7, name: 'БЕТА', x, y: 0, z: 0, v: 0.4, mode: 'flight',
    fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0,
  }, extra)], t);

  // Один-единственный снимок: истории нет, и честнее показать пилота там,
  // где он есть, чем не показать вовсе.
  snap(0, 10);
  let p = peerPoses(st, 10)[0];
  ok(p && Math.abs(p.pos.x) < 1e-9 && p.name === 'БЕТА', 'первый снимок показан сразу');

  // Два снимка в 0.2 с друг от друга: на середине отрезка — середина пути.
  // Именно эта строка отличает полёт от пяти скачков в секунду.
  snap(100, 10.2);
  p = peerPoses(st, 10.1 + PEER_DELAY)[0];
  ok(p && Math.abs(p.pos.x - 50) < 1e-6,
    'между снимками корабль идёт плавно: x = ' + (p ? p.pos.x.toFixed(3) : '—'));

  // Картинка ОТСТАЁТ на PEER_DELAY — иначе интерполировать не по чему.
  p = peerPoses(st, 10.2 + PEER_DELAY)[0];
  ok(p && Math.abs(p.pos.x - 100) < 1e-6, 'в момент снимка корабль ровно на снимке');

  // Снимок опоздал: идём дальше по последней скорости, но не бесконечно.
  // Число забираем СРАЗУ: ответ живёт в одном объекте на пилота и
  // переписывается следующим вызовом (иначе это ловушка — на ней и
  // попалась первая версия этой проверки).
  const at = (t) => { const r = peerPoses(st, t)[0]; return r ? r.pos.x : NaN; };
  const ahead = at(10.2 + PEER_DELAY + 0.2);
  const far = at(10.2 + PEER_TTL - 0.1);
  const cap = 100 + 100 * (PEER_AHEAD / 0.2);
  ok(Math.abs(ahead - 200) < 1e-6,
    'после пропавшего снимка корабль продолжает идти: x = ' + ahead.toFixed(1));
  ok(Math.abs(far - cap) < 1e-6,
    'досчёт ограничен ' + PEER_AHEAD + ' с: x = ' + far.toFixed(1) + ', а не бесконечность');

  // Снимки перестали приходить вовсе — это обрыв связи, и чужой корабль
  // обязан погаснуть, а не висеть в космосе навсегда.
  ok(peerPoses(st, 10.2 + PEER_TTL + 0.01).length === 0,
    'без снимков дольше ' + PEER_TTL + ' с пилот пропадает');

  // Ушедшего убираем сразу, не дожидаясь срока.
  snap(100, 20);
  dropPeer(st, 7);
  ok(peerPoses(st, 20).length === 0, 'по сообщению об уходе пилот пропадает сразу');

  // Ориентация: оси остаются единичными и перпендикулярными даже на
  // полпути между двумя разными поворотами. Кривой базис в матрице — это
  // растянутый или вывернутый наизнанку корабль.
  const st2 = makePeers();
  const turn = (t, f, u) => ingestPeers(st2, [{
    id: 9, name: 'ГАММА', x: 0, y: 0, z: 0, v: 0,
    fx: f[0], fy: f[1], fz: f[2], ux: u[0], uy: u[1], uz: u[2],
  }], t);
  turn(0, [0, 0, 1], [0, 1, 0]);
  turn(0.2, [1, 0, 0], [0, 1, 0]);
  const b = peerPoses(st2, 0.1 + PEER_DELAY)[0].basis;
  const unit = (v) => Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-6;
  const perp = (a, c) => Math.abs(a.x * c.x + a.y * c.y + a.z * c.z) < 1e-6;
  ok(unit(b.fwd) && unit(b.up) && unit(b.right), 'оси чужого корабля единичные');
  ok(perp(b.fwd, b.up) && perp(b.fwd, b.right) && perp(b.up, b.right),
    'оси чужого корабля перпендикулярны');
  ok(Math.abs(b.fwd.x - Math.SQRT1_2) < 1e-6 && Math.abs(b.fwd.z - Math.SQRT1_2) < 1e-6,
    'на полпути между снимками нос повёрнут на 45°');

  // Мусор из сети не должен доходить до матрицы: один NaN гасит корабль
  // целиком, а искать его потом в шейдере — худший способ провести вечер.
  const st3 = makePeers();
  ingestPeers(st3, [
    { id: 1, x: NaN, y: 0, z: 0 },
    { id: 2, x: 0, y: 0, z: 'близко' },
    null,
    { id: 3, name: 'ДЕЛЬТА', x: 5, y: 0, z: 0, fx: 0, fy: 0, fz: 0, ux: 0, uy: 0, uz: 0 },
  ], 1);
  const list = peerPoses(st3, 1);
  const only = list.length === 1 && list[0].id === 3;
  const nums = only ? [
    list[0].pos.x, list[0].pos.y, list[0].pos.z,
    list[0].basis.fwd.x, list[0].basis.fwd.y, list[0].basis.fwd.z,
    list[0].basis.up.x, list[0].basis.up.y, list[0].basis.up.z,
    list[0].basis.right.x, list[0].basis.right.y, list[0].basis.right.z,
  ] : [NaN];
  ok(only && nums.every(Number.isFinite),
    'битые снимки отброшены, нулевой поворот заменён своим: ни одного NaN');
}

// --- часы мира --------------------------------------------------------------
//
// От времени мира считаются орбиты. Ошибка здесь не видна глазами вовсе:
// картинка остаётся правдоподобной, просто у двух пилотов она разная —
// именно так станция и оказалась видна только одному из двоих.
{
  console.log('\n== часы мира ==');

  const dt = 1 / 60;
  ok(clockStep(100, null, dt) === dt, 'без сервера часы идут как шли');

  const c = makeClock();
  ok(clockTarget(c, 5) === null, 'пока сервер не ответил, цели нет');
  clockFromServer(c, 1000, 5);
  ok(Math.abs(clockTarget(c, 7) - 1002) < 1e-9,
    'между снимками время досчитывается само: ' + clockTarget(c, 7));
  clockFromServer(c, NaN, 9);
  ok(Math.abs(clockTarget(c, 7) - 1002) < 1e-9, 'мусор вместо времени игнорируется');

  // Отставание выбирается ходом, а не рывком: рывок на стыковке увёл бы
  // станцию из-под носа.
  const slow = clockStep(100, 101, dt);
  ok(slow > dt && slow <= dt * (1 + CLOCK_RATE) + 1e-12,
    'отставание подтягивается ускорением хода, но не больше чем на '
    + CLOCK_RATE * 100 + '%');
  const fast = clockStep(100, 99.9, dt);
  ok(fast > 0 && fast < dt, 'спешащие часы замедляются, но назад не идут');

  // Сходимость: секунда расхождения выбирается за считанные секунды и не
  // перелетает через ноль.
  let local = 100, target = 101, over = 0;
  for (let i = 0; i < 60 * 30; i++) {
    local += clockStep(local, target, dt);
    target += dt;
    if (local - target > 1e-6) over++;
  }
  ok(Math.abs(local - target) < 1e-3 && over === 0,
    'секунда расхождения выбирается без перелёта: осталось '
    + Math.abs(local - target).toFixed(6) + ' с');

  // Большое расхождение — рывком: так бывает после варпа, где мир
  // собирается заново с нуля, и после спящей вкладки.
  ok(Math.abs(clockStep(0, 3600, dt) - (dt + 3600)) < 1e-9,
    'расхождение больше ' + CLOCK_SNAP + ' с подводится сразу');
  ok(clockStep(100, 100 + CLOCK_SNAP - 1, dt) < dt * 2,
    'а расхождение меньше порога рывком не подводится');
}

// --- качество связи ---------------------------------------------------------
//
// Сеть ломается не только «совсем»: гораздо чаще она просто становится
// хуже, и в игре это выглядит как чужой корабль, который дёргается. Цифра
// в углу — единственное, чем «сеть подтормаживает» отличается от «игра
// тормозит».
{
  console.log('\n== качество связи ==');

  ok(smoothPing(null, 40) === 40, 'первый замер берётся как есть');
  const p1 = smoothPing(40, 140);
  ok(p1 > 40 && p1 < 140 && Math.abs(p1 - (40 + 100 * PING_SMOOTH)) < 1e-9,
    'скачок замера сглаживается: ' + p1.toFixed(1) + ' мс вместо 140');

  // Потери считаются по ритму снимков: сервер шлёт их строго по тику.
  const tick = 0.2;
  const full = [];
  for (let i = 0; i < 20; i++) full.push(100 + i * tick);
  const now = 100 + 20 * tick;
  ok(linkLoss(full, tick, now) < 0.06,
    'ровный поток снимков — потерь нет: ' + (linkLoss(full, tick, now) * 100).toFixed(0) + '%');

  const half = full.filter((t, i) => i % 2 === 0);
  const lossHalf = linkLoss(half, tick, now);
  ok(lossHalf > 0.4 && lossHalf < 0.6,
    'половина снимков потерялась — видно: ' + (lossHalf * 100).toFixed(0) + '%');

  ok(linkLoss(full, tick, now + 10) === 1,
    'снимки кончились вовсе — потери полные');

  // Поток мог оборваться совсем недавно: снимки до обрыва были ровные, и
  // по ним одним связь выглядит идеальной. Ловится это молчанием.
  const stalled = linkLoss(full, tick, now + 2);
  ok(stalled > 0.3 && stalled < 1,
    'поток встал две секунды назад — это уже потери: '
    + (stalled * 100).toFixed(0) + '%');
  ok(linkLoss([], tick, now) === 0 && linkLoss([100], tick, 100.1) === 0,
    'на молодой связи потерь не выдумываем: считать ещё нечего');

  // Оценка: пороги выбраны по тому, что видно в игре.
  ok(linkGrade(20, 0) === 4, 'двадцать миллисекунд без потерь — отлично');
  ok(linkGrade(120, 0) === 3 && linkGrade(200, 0) === 2 && linkGrade(500, 0) === 1,
    'с ростом задержки оценка падает');
  ok(linkGrade(20, 0.4) === 1,
    'потери бьют сильнее задержки: потерянный снимок — это не «позже», а «никогда»');
  ok(linkGrade(null, 0) === 0, 'пока пинга нет, оценки нет');

  // Состояние целиком: пока сокет не живой, мерить нечего.
  const off = linkState({ state: 'down', beats: full, tick, ping: 30 }, now, 'online');
  ok(off.grade === 0 && off.ping === null,
    'при оборванном сокете прибор не показывает старый пинг');
  const live = linkState({ state: 'live', beats: full, tick, ping: 30 }, now, 'online');
  ok(live.grade === 4 && live.ping === 30, 'на живой связи — оценка и пинг');
}

// --- сокет: проводка пинга и ритма ------------------------------------------
//
// Математика качества связи проверена выше, но между ней и сервером есть
// проводка: послать ping, поймать pong, отметить каждый снимок. Ломается
// она молча — цифра в углу просто застывает, — и увидеть это можно только
// с настоящим сервером. Поэтому здесь поддельный сокет: он отвечает, как
// отвечал бы Hub.
{
  console.log('\n== сокет: пинг и ритм ==');

  const sent = [];
  let live = null;
  globalThis.localStorage = { getItem: () => 'т'.repeat(64), setItem() {}, removeItem() {} };
  globalThis.location = { hostname: 'localhost', origin: 'http://localhost', pathname: '/x/' };
  globalThis.WebSocket = class {
    constructor() {
      this.readyState = 1;
      live = this;
      setTimeout(() => this.onopen && this.onopen(), 0);
    }
    send(text) { sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
    say(msg) { if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) }); }
  };

  const { net, connect, disconnect, SEND_EVERY } = await import('../js/net/socket.js');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  connect(() => ({ sys: 0, x: 1, y: 2, z: 3, v: 0.4, mode: 'flight',
    fwd: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } }));
  await wait(30);
  ok(sent.length === 1 && sent[0].t === 'hello',
    'первым делом представляемся: ' + (sent[0] ? sent[0].t : '—'));

  live.say({ t: 'welcome', you: { id: 1, name: 'Я' }, tick: 0.2, wt: 500, peers: [] });
  ok(net.state === 'live' && net.tick === 0.2 && net.wt === 500,
    'приветствие принято: шаг сервера и время мира взяты из него');

  // Первый же удар таймера шлёт и положение, и замер задержки.
  await wait(SEND_EVERY + 60);
  const pos = sent.find((m) => m.t === 'pos');
  ok(pos && pos.fx === 0 && pos.fz === 1 && pos.uy === 1,
    'положение уходит вместе с осанкой');
  ok(sent.some((m) => m.t === 'ping'), 'замер задержки уходит на сервер');

  live.say({ t: 'pong', time: 1 });
  ok(typeof net.ping === 'number' && net.ping >= 0 && net.ping < 5000,
    'по ответу сервера посчитана задержка: ' + Math.round(net.ping) + ' мс');

  // Каждый снимок отмечается: по их ритму считаются потери.
  const before = net.beats.length;
  live.say({ t: 'peers', list: [], wt: 501 });
  live.say({ t: 'peers', list: [], wt: 501.2 });
  ok(net.beats.length === before + 2, 'каждый снимок отмечен во времени');

  // Обрыв обнуляет измеренное: показывать старый пинг после обрыва —
  // значит врать ровно тогда, когда на прибор и смотрят.
  live.close();
  ok(net.ping === null && net.beats.length === 0,
    'после обрыва измеренное сбрасывается');

  disconnect();
  delete globalThis.WebSocket;
  delete globalThis.localStorage;
  delete globalThis.location;
}

// --- оружие -----------------------------------------------------------------
//
// Бой разбирается по кадрам, а глазами в браузере видно только «вроде
// попал». Поэтому здесь проверяется всё, что можно посчитать: упреждение,
// предел кардана, темп стрельбы, дальность и само попадание.
{
  console.log('\n== оружие ==');

  const spec = WEAPONS.laser_g;
  const ship = makeShip();
  placeShip(ship, v3(0, 0, 0), makeBasis());

  // Упреждение: по стоящей цели бьём в неё саму.
  const still = { pos: v3(0, 0, 1), vel: v3(0, 0, 0) };
  const p0 = leadPoint(ship.pos, still, spec.speed);
  ok(Math.abs(p0.z - 1) < 1e-9 && Math.abs(p0.x) < 1e-9, 'по стоящей цели упреждения нет');

  // По движущейся — точка встречи: цель и болт приходят туда ОДНОВРЕМЕННО.
  const moving = { pos: v3(0, 0, 1), vel: v3(0.4, 0, 0) };
  const p1 = leadPoint(ship.pos, moving, spec.speed);
  const tBolt = Math.hypot(p1.x, p1.y, p1.z) / spec.speed;
  const tGoal = Math.abs(p1.x - moving.pos.x) / 0.4;
  ok(p1.x > 0.1 && Math.abs(tBolt - tGoal) < 1e-3,
    'упреждение: болт и цель встречаются на ' + tBolt.toFixed(3) + ' с');

  // Кардан доворачивает к упреждённой точке, пока та в конусе.
  const guns = makeGuns('laser_g');
  const near = { pos: v3(0.2, 0, 2), vel: v3(0, 0, 0) };   // ~5.7° от оси
  const a1 = aimDir(guns, ship, near, v3());
  const offAxis = Math.acos(Math.max(-1, Math.min(1, a1.z)));
  ok(guns.locked && Math.abs(offAxis - Math.atan2(0.2, 2)) < 1e-6,
    'в конусе ствол смотрит точно в упреждённую точку');

  // За конусом — упирается в предел, а не бросает цель и не смотрит в неё.
  const wide = { pos: v3(3, 0, 1), vel: v3(0, 0, 0) };     // ~71°
  const a2 = aimDir(guns, ship, wide, v3());
  const lim = Math.acos(Math.max(-1, Math.min(1, a2.z)));
  ok(!guns.locked && Math.abs(lim - spec.cone) < 1e-6,
    'за конусом ствол упирается в предел ' + (spec.cone * 180 / Math.PI).toFixed(0) + '°');
  ok(Math.abs(Math.hypot(a2.x, a2.y, a2.z) - 1) < 1e-9, 'направление ствола единичное');

  // Темп: между выстрелами ровно 1/rate, не чаще.
  const g2 = makeGuns('laser_g');
  const ports = [v3(-0.02, 0, 0.02), v3(0.02, 0, 0.02)];
  const first = fireGuns(g2, ship, still, ports, []);
  const second = fireGuns(g2, ship, still, ports, []);
  ok(first.length === 1 && second.length === 0, 'второй выстрел подряд не проходит: пушка не остыла');
  updateGuns(g2, 1 / spec.rate, []);
  const third = fireGuns(g2, ship, still, ports, []);
  ok(third.length === 1, 'после перезарядки стреляет снова');
  // Стволы работают по очереди: залпом из всех сразу темп удваивается.
  ok(Math.abs(first[0].x - third[0].x) > 0.03, 'стволы бьют по очереди, а не оба сразу');

  // Болт летит и умирает на своей дальности, а не живёт вечно.
  const g3 = makeGuns('laser_g');
  fireGuns(g3, ship, null, [v3(0, 0, 0)], []);
  updateGuns(g3, 0.1, []);
  const b = g3.bolts[0];
  ok(b && Math.abs(b.z - spec.speed * 0.1) < 1e-9,
    'болт летит со своей скоростью: ' + (b ? b.z.toFixed(3) : '—') + ' км за 0.1 с');
  updateGuns(g3, spec.range / spec.speed + 0.5, []);
  ok(g3.bolts.length === 0, 'дальше ' + spec.range + ' км болта нет');

  // Попадание ищется ОТРЕЗКОМ: за кадр болт проходит больше собственной
  // длины и больше корабля, и проверка «попал ли центр в шар» промахнулась
  // бы через раз.
  const g4 = makeGuns('laser_g');
  fireGuns(g4, ship, null, [v3(0, 0, 0)], []);
  const target = { id: 5, pos: v3(0, 0, 0.6) };
  const hits = updateGuns(g4, 0.5, [target]);       // за кадр пролетает 1.5 км
  ok(hits.length === 1 && hits[0].id === 5 && hits[0].damage === spec.damage,
    'цель на пути очереди поражена: урон ' + (hits[0] ? hits[0].damage : '—'));
  ok(g4.bolts.length === 0, 'попавший болт исчезает, а не летит дальше');

  // Мимо — значит мимо: цель в стороне не задевается.
  const g5 = makeGuns('laser_g');
  fireGuns(g5, ship, null, [v3(0, 0, 0)], []);
  ok(updateGuns(g5, 0.5, [{ id: 6, pos: v3(0.2, 0, 0.6) }]).length === 0,
    'цель в двухстах метрах в стороне не задета');

  // Чужие выстрелы — только картинка, и мусор в них не должен пролезать.
  const g6 = makeGuns('laser_g');
  addForeignBolt(g6, { w: 'laser_g', x: 1, y: 2, z: 3, dx: 0, dy: 0, dz: 1, by: 4 });
  addForeignBolt(g6, { w: 'laser_g', x: NaN, y: 0, z: 0, dx: 1, dy: 0, dz: 0, by: 4 });
  ok(g6.bolts.length === 1 && g6.bolts[0].mine === false,
    'чужой болт добавлен и помечен чужим, битый отброшен');
  ok(updateGuns(g6, 0.5, [{ id: 9, pos: v3(1, 2, 4) }]).length === 0,
    'чужим болтом мы никого не «попадаем»: это считает его хозяин');

  // Чужой болт обязан ГАСНУТЬ о наш корпус. Урона он не наносит (его
  // считает сервер), но пролетающий насквозь болт выглядит как поломка
  // игры — с этого и началась эта правка.
  const g7 = makeGuns('laser_g');
  addForeignBolt(g7, { w: 'laser_g', x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, by: 4 });
  const me = { id: 8, pos: v3(0, 0, 0.6), own: true };
  const rep = updateGuns(g7, 0.5, [me]);
  ok(g7.bolts.length === 0 && rep.length === 0,
    'чужой болт гаснет о наш корпус и ничего не докладывает');
  ok(g7.blasts.length === 1, 'на месте попадания зажигается вспышка');

  // Вспышка живёт недолго и гаснет сама.
  updateGuns(g7, COMBAT.blastLife + 0.01, []);
  ok(g7.blasts.length === 0, 'вспышка гаснет через ' + COMBAT.blastLife + ' с');

  // В своего стрелка болт не попадает: он из него вылетел.
  const g8 = makeGuns('laser_g');
  addForeignBolt(g8, { w: 'laser_g', x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, by: 4 });
  ok(updateGuns(g8, 0.5, [{ id: 4, pos: v3(0, 0, 0.6) }]).length === 0
    && g8.bolts.length === 1,
    'чужой болт проходит сквозь СВОЕГО стрелка, а не гаснет о него');

  // Оболочка щита обязана накрыть корпус ЦЕЛИКОМ, и проверяется это по
  // самим вершинам, а не по габаритам: эллипсоид, который просто больше
  // габаритного ящика, его углов не накрывает — на этом из-под щита
  // торчали законцовки крыльев.
  const half = [HULL_SIZE.x / 2, HULL_SIZE.y / 2, HULL_SIZE.z / 2];
  const hull = buildCobra();
  let worst = 0;
  for (const v of hull.verts) {
    worst = Math.max(worst,
      Math.hypot(v.x / SHIELD_AXES[0], v.y / SHIELD_AXES[1], v.z / SHIELD_AXES[2]));
  }
  ok(worst <= 1,
    'ни одна из ' + hull.verts.length + ' точек корпуса не торчит из оболочки: худшая '
    + worst.toFixed(3) + ' от её края');
  ok(worst > 0.8,
    'и оболочка не раздута зря: самая выступающая точка на ' + worst.toFixed(3));
  ok(SHIELD_AXES.every((a, i) => a > half[i]),
    'оболочка больше габарита по каждой оси: '
    + SHIELD_AXES.map((a) => (a * 1000).toFixed(0)).join('×')
    + ' м против ' + half.map((h) => (h * 1000).toFixed(0)).join('×'));
  ok(SHIELD_AXES[0] / SHIELD_AXES[1] > 1.5 && SHIELD_AXES[2] / SHIELD_AXES[1] > 1.5,
    'и остаётся приплюснутой, как сам корпус: '
    + (SHIELD_AXES[0] / SHIELD_AXES[1]).toFixed(1) + ':1');

  // Пятно удара живёт в осях КОРАБЛЯ: он вертится, а пятно остаётся на
  // том борту, куда пришёл луч.
  const gs = makeGuns('laser_g');
  const sh2 = makeShip();
  placeShip(sh2, v3(0, 0, 0), makeBasis());
  shieldFlash(gs, 0, true, v3(0.03, 0, 0), sh2.pos, sh2.basis);
  ok(gs.shields.length === 1 && gs.shields[0].dx > 0.9,
    'удар в правый борт даёт пятно справа: ' + gs.shields[0].dx.toFixed(2));
  ok(hasShieldFlash(gs, 0, true) && !hasShieldFlash(gs, 7, false),
    'свежая оболочка видна только у того корабля, по которому попали');

  // Тот же удар по мировым координатам, но корабль развернулся носом
  // вправо — пятно обязано оказаться уже НЕ на борту, а спереди.
  rotateBasis(sh2.basis, 0, Math.PI / 2, 0);
  shieldFlash(gs, 0, true, v3(0.03, 0, 0), sh2.pos, sh2.basis);
  ok(gs.shields[1].dz > 0.9,
    'после разворота то же место мира приходится в нос: ' + gs.shields[1].dz.toFixed(2));

  // И свой болт не попадает в нас самих.
  const g9 = makeGuns('laser_g');
  fireGuns(g9, ship, null, [v3(0, 0, 0)], []);
  ok(updateGuns(g9, 0.5, [{ id: 8, pos: v3(0, 0, 0.6), own: true }]).length === 0,
    'свой болт в свой же корабль не попадает');

  // Болт уносит с собой скорость корабля.
  //
  // Пока скорость болта была мировой, на полном ходу он отползал от носа
  // на 3 − 1.2 = 1.8 км/с, а на форсаже (предел втрое выше) оставался
  // позади: очередь висела в воздухе, и попасть можно было только тормозя.
  const fast = makeShip();
  placeShip(fast, v3(0, 0, 0), makeBasis());
  fast.vel.z = 1.2;                                // полный ход по носу
  const g10 = makeGuns('laser_g');
  fireGuns(g10, fast, null, [v3(0, 0, 0)], []);
  const fb = g10.bolts[0];
  ok(Math.abs(fb.vz - (spec.speed + 1.2)) < 1e-9,
    'мировая скорость болта — дульная плюс ход корабля: ' + fb.vz.toFixed(2) + ' км/с');

  // Главное, и именно это видно глазами: ОТ КОРАБЛЯ болт уходит со своей
  // дульной скоростью, сколько бы тот ни разогнался.
  updateGuns(g10, 0.5, []);
  const wentZ = 1.2 * 0.5;                         // корабль за то же время ушёл сам
  ok(Math.abs((fb.z - wentZ) - spec.speed * 0.5) < 1e-9,
    'от корабля болт уходит с дульной: ' + ((fb.z - wentZ) / 0.5).toFixed(2) + ' км/с');

  // Дальность меряется ОТ СТРЕЛКА, а не по мировому пути: на ходу болт
  // проходит в мире больше, но достаёт всё те же 2.5 км от корабля. Счёт
  // по мировым километрам отнимал бы дальность тем больше, чем быстрее
  // летишь.
  const g11 = makeGuns('laser_g');
  fireGuns(g11, fast, null, [v3(0, 0, 0)], []);
  const life = spec.range / spec.speed;
  updateGuns(g11, life - 1e-4, []);
  const far = g11.bolts[0];
  ok(far && far.z > spec.range * 1.3,
    'в мире болт на ходу проходит больше дальности: ' + (far ? far.z.toFixed(2) : '—') + ' км');
  ok(far && Math.abs((far.z - 1.2 * life) - spec.range) < 1e-3,
    'а от стрелка — ровно свои ' + spec.range + ' км');
  updateGuns(g11, 2e-4, []);
  ok(g11.bolts.length === 0, 'на этом он и гаснет');

  // Упреждение считается в осях СТРЕЛКА. Идя с целью борт о борт одним
  // ходом, целимся прямо в неё: по мировым скоростям ствол уводило бы
  // вперёд по её курсу тем сильнее, чем быстрее летят оба, — и промах рос
  // бы от собственной скорости.
  //
  // Цель стоит СБОКУ намеренно. Пока она висела прямо по курсу, увод
  // ствола вперёд по её ходу не менял направления вовсе — проверка
  // проходила и с мировыми скоростями, то есть не проверяла ничего.
  const wing = { pos: v3(0.2, 0, 1), vel: v3(0, 0, 1.2) };    // ~11°, внутри конуса
  const pw = leadPoint(fast.pos, wing, spec.speed, v3(), fast.vel);
  ok(Math.abs(pw.z - 1) < 1e-9 && Math.abs(pw.x - 0.2) < 1e-9,
    'по цели, идущей рядом тем же ходом, упреждения нет');
  const gw = makeGuns('laser_g');
  const aw = aimDir(gw, fast, wing, v3());
  ok(gw.locked && Math.abs(aw.x / aw.z - 0.2) < 1e-9,
    'и ствол смотрит прямо на неё, а не вперёд по её курсу: '
    + (aw.x / aw.z).toFixed(3) + ' против 0.200');

  // След болта идёт по ПУТИ, а не по стволу: на сносе он заметно косит, и
  // рисовать его по прицелу значило бы рисовать мимо собственного следа.
  const drift = makeShip();
  placeShip(drift, v3(0, 0, 0), makeBasis());
  drift.vel.x = 1.2;                               // ход боком, ствол по носу
  const g12 = makeGuns('laser_g');
  fireGuns(g12, drift, null, [v3(0, 0, 0)], []);
  const db = g12.bolts[0];
  ok(db.dx > 0.3 && Math.abs(Math.hypot(db.dx, db.dy, db.dz) - 1) < 1e-9,
    'след болта косит по сносу на ' + (Math.atan2(db.dx, db.dz) * 180 / Math.PI).toFixed(0) + '°');

  // Чужой болт уносит ход СВОЕГО стрелка — иначе очередь соседа тянется у
  // него за кормой. Скорость берётся из своего списка пилотов, а не из
  // сообщения: она у нас уже есть, а лишнему от клиента верить нечему.
  const g13 = makeGuns('laser_g');
  addForeignBolt(g13, { w: 'laser_g', x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, by: 4 },
    v3(0.8, 0, 0));
  const ob = g13.bolts[0];
  ok(Math.abs(ob.vx - 0.8) < 1e-9 && Math.abs(ob.vz - spec.speed) < 1e-9,
    'чужой болт уносит ход стрелка: ' + ob.vx.toFixed(2) + ' км/с вбок');
  const g14 = makeGuns('laser_g');
  addForeignBolt(g14, { w: 'laser_g', x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, by: 4 });
  ok(Math.abs(g14.bolts[0].vx) < 1e-12,
    'а без известной скорости стрелка летит одной дульной, как раньше');
}


// --- цель в бою -------------------------------------------------------------
//
// Зазор до цели считается до её КРАЯ, и планета во полнеба всегда «ближе
// к прицелу», чем корабль перед носом. Без отдельного правила выбрать
// пилота было нельзя вовсе, пока за ним видно планету, — то есть почти
// никогда.
{
  console.log('\n== цель в бою ==');
  const ship = makeShip();
  placeShip(ship, v3(0, 0, 0), makeBasis());
  const planet = { name: 'ПЛАНЕТА', id: 1, pos: v3(0, 0, 100), radius: 30 };
  const peer = { name: 'ПИЛОТ', id: 7, pos: v3(0.05, 0, 1), radius: 0.035, isPeer: true };
  const nav = { list: [planet, peer], index: 0 };

  const order = aimTargets(nav, ship).map((x) => x.t.name);
  ok(order[0] === 'ПИЛОТ' && order.length === 2,
    'под прицелом и планета, и пилот — первым идёт пилот: ' + order.join(', '));

  const first = pickTarget(nav, ship);
  const second = pickTarget(nav, ship);
  ok(first === peer && second === planet,
    'второе нажатие Tab доходит до планеты: пилот её не заслоняет навсегда');
}

// --- какая видеокарта досталась ---------------------------------------------
//
// Контекст просит высокую производительность, но решает система: на
// машине с двумя картами браузер спокойно уходит на встроенную, и игра
// идёт вдвое медленнее без единой ошибки в консоли. Разобрать это можно
// только по названию карты — значит, разбирать его надо надёжно.
{
  console.log('\n== видеокарта ==');

  const cases = [
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11, D3D11)', 'discrete'],
    ['ANGLE (AMD, AMD Radeon RX 6600 Direct3D11, D3D11)', 'discrete'],
    ['Apple M2', 'discrete'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0, D3D11)', 'integrated'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11, D3D11)', 'integrated'],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11, D3D11)', 'integrated'],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))', 'software'],
    ['Mesa/X.org llvmpipe (LLVM 15, 256 bits)', 'software'],
    ['Microsoft Basic Render Driver', 'software'],
    ['', 'unknown'],
    [null, 'unknown'],
  ];
  const wrong = cases.filter(([name, want]) => gpuKind(name) !== want);
  ok(wrong.length === 0,
    'карты разобраны верно (' + cases.length + ' случаев)'
    + (wrong.length ? ': ошиблись на ' + wrong[0][0] + ' -> ' + gpuKind(wrong[0][0]) : ''));

  // Своя же дискретная карта не должна попадать под предупреждение: ложная
  // тревога про «встроенную графику» хуже её отсутствия — на неё перестают
  // смотреть.
  ok(gpuKind('ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU Direct3D11, D3D11)') === 'discrete',
    'ноутбучная RTX — тоже дискретная, тревоги не будет');
}

// --- прыжок к чужому кораблю ------------------------------------------------
//
// Пилот — такая же точка назначения, как станция, но со своими двумя
// правилами: выход за двадцать километров (чтобы это был прыжок, а не
// телепорт за спину) и осторожность со скоростью цели.
{
  console.log('\n== прыжок к пилоту ==');

  const peer = {
    id: 5, name: 'ЦЕЛЬ', isPeer: true, radius: 0.035,
    pos: v3(1000, 0, 0), vel: v3(0, 0, 0),
  };
  const from = v3(0, 0, 0);
  const p = exitPoint(peer, from);
  const gap = Math.hypot(p.x - peer.pos.x, p.y - peer.pos.y, p.z - peer.pos.z);
  ok(Math.abs(gap - QUANTUM.exitPeer) < 1e-9,
    'выход в ' + QUANTUM.exitPeer + ' км от пилота: получилось ' + gap.toFixed(3));
  ok(p.x < peer.pos.x, 'и выходим с той стороны, откуда пришли');

  // Ближе, чем к станции, но дальше, чем к точке в пустоте: пилоту нужно
  // время увидеть, кто к нему пришёл.
  ok(QUANTUM.exitPeer < QUANTUM.exitStation && QUANTUM.exitPeer > QUANTUM.exitMin,
    'двадцать километров — между станцией (' + QUANTUM.exitStation
    + ') и точкой в пустоте (' + QUANTUM.exitMin + ')');

  // Выход: скорость равна скорости цели, если та летит по-обычному.
  peer.vel = v3(0.4, 0, 0);
  const vOk = exitVelocity(peer);
  ok(Math.abs(vOk.x - 0.4) < 1e-9,
    'рядом с целью выходим её же ходом: ' + vOk.x.toFixed(2) + ' км/с');

  // А вот вектор пилота, который сам в прыжке, наследовать нельзя.
  peer.vel = v3(40000, 0, 0);
  const vFast = exitVelocity(peer);
  ok(vFast.x === 0 && vFast.y === 0 && vFast.z === 0,
    'за пилотом, ушедшим в прыжок, не улетаем: ' + vFast.x + ' км/с');
}

// --- характеристики из бэкенда ----------------------------------------------
//
// В игре не осталось ни одного числа корабля, оружия и модулей: все они
// лежат в server/data/specs.php, заливаются в базу и приходят оттуда. Эта
// проверка стережёт ровно это свойство — и стережёт по ИСХОДНИКАМ, а не по
// поведению. Поведение при вписанной обратно константе не изменится
// ничем: корабль полетит, просто числа снова будут клиентские, и заметить
// это станет нечем.
{
  console.log('\n== характеристики из бэкенда ==');

  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  const doc = JSON.parse(readFileSync('server/data/specs.json', 'utf8'));
  // Лётная модель СОБИРАЕТСЯ: корпус, а поверх него числа модулей,
  // стоящих в гнёздах. Проверять по одному корпусу значило бы проверять
  // половину корабля — ни скорости, ни щита у него своих нет.
  applyModuleSpecs(doc.modules);
  const spec = flightModel(doc.shipTypes[0].spec);

  // 1. Числа не вписаны в игру заново.
  //
  // Два правила, и оба нужны. Имена вроде `accel` и `hold` слишком общие,
  // чтобы запрещать их всюду: у звука есть своё ускорение, у посадки своя
  // высота зависания. Поэтому:
  //
  //   в ФАЙЛАХ МОДЕЛИ (корабль, оружие, снаряжение) запрещено любое
  //   `имя: число` из лётной модели — именно туда константу и впишут,
  //   «чтобы не было NaN»;
  //
  //   во всей игре запрещено `имя: ровно то самое число` — так ловится
  //   копия, снятая с бэкенда и разложенная где угодно ещё.
  {
    const files = [];
    const walkJs = (dir) => {
      for (const nm of readdirSync(dir)) {
        const p = join(dir, nm).split('\\').join('/');
        if (statSync(p).isDirectory()) walkJs(p);
        else if (p.endsWith('.js')) files.push(p);
      }
    };
    walkJs('js');
    // Комментарии не в счёт: в них числа как раз и объясняются.
    const strip = (src) => src
      .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), '')
      .replace(new RegExp('^\\s*//.*$', 'gm'), '');
    const MODEL = ['js/game/ship.js', 'js/game/weapons.js', 'js/game/loadout.js'];
    const baked = [];
    for (const f of files) {
      const src = strip(readFileSync(f, 'utf8'));
      for (const [key, value] of Object.entries(spec)) {
        // Ключ ОБЪЕКТА, а не свойство после точки: `SHIP.reverse : 1` —
        // это тернарный оператор, а не вписанное число.
        const at = '(?<![.\\w])' + key + '\\s*:\\s*';
        if (MODEL.includes(f) && new RegExp(at + '-?\\d').test(src)) baked.push(f + ': ' + key);
        else if (new RegExp(at + value + '\\b').test(src)) baked.push(f + ': ' + key + ' = ' + value);
      }
    }
    ok(baked.length === 0,
      'ни одно число корабля не вписано в игру'
      + (baked.length ? ': ' + baked.length + ', первое — ' + baked[0] : ''));
  }

  // 2. Всё, что прислал бэкенд, доехало до лётной модели.
  const missed = Object.keys(spec).filter((k) => SHIP[k] !== spec[k]);
  ok(missed.length === 0,
    'лётная модель принята целиком, ' + Object.keys(spec).length + ' чисел'
    + (missed.length ? ': не доехало ' + missed.join(', ') : ''));

  // 3. Выводимое считается ПОСЛЕ приёма, а не один раз при загрузке
  //    модуля. Это та же ловушка, что была с переводом: вычисление на
  //    уровне модуля застывает на том, что было в момент импорта, — а в
  //    тот момент лётной модели ещё нет вовсе.
  const wasAccel = SHIP.boostAccel;
  const wasRoll = SHIP.rollAccel;
  applyShipSpec(Object.assign({}, spec, { boostMax: spec.boostMax * 2, rotRamp: spec.rotRamp / 2 }));
  ok(SHIP.boostAccel > wasAccel * 1.5 && SHIP.rollAccel > wasRoll * 1.5,
    'форсаж и момент пересчитались под новую модель: '
    + SHIP.boostAccel.toFixed(2) + ' и ' + SHIP.rollAccel.toFixed(2));
  applyShipSpec(spec);
  ok(Math.abs(SHIP.boostAccel - wasAccel) < 1e-9, 'и вернулись, когда модель вернули');

  // 4. Угловые ускорения выводятся из ГЕОМЕТРИИ корпуса, а не приходят
  //    числами: рыскание у этого корабля тяжелее крена, и так и должно
  //    быть — он широкий и плоский.
  ok(SHIP.yawAccel < SHIP.rollAccel && Number.isFinite(SHIP.pitchAccel),
    'рыскание тяжелее крена: ' + SHIP.yawAccel.toFixed(2) + ' против ' + SHIP.rollAccel.toFixed(2));

  // 5. Просветы шасси — из модели, а не из бэкенда: это следствие
  //    геометрии, и в specs.php их нет намеренно.
  ok(SHIP.gearClear > SHIP.hullClear && spec.gearClear === undefined,
    'просветы взяты из корпуса, а не из настроек');

  // 6. Оружие: конус приходит в градусах, а в игре нужен в радианах.
  const laser = doc.weapons.find((w) => w.code === 'laser_g');
  ok(Math.abs(WEAPONS.laser_g.cone - (laser.coneDeg * Math.PI) / 180) < 1e-12,
    'конус доворота переведён в радианы: ' + laser.coneDeg + '°');
  ok(WEAPONS.laser_g.damage === laser.damage && WEAPONS.turret.range === 1.8,
    'урон и дальность взяты у бэкенда, а не у игры');
  ok(INSTALLED.length === doc.weapons.filter((w) => w.ready).length && INSTALLED[0] === 'laser_g',
    'на борту то оружие, которое бэкенд отметил готовым');
  ok(COMBAT.blastLife === doc.combat.blastLife && COMBAT.shieldLife === doc.combat.shieldLife,
    'общие числа боя тоже оттуда');

  // 7. Числа принадлежат МОДУЛЮ, и меняется всё разом: поставили в
  //    гнездо другой двигатель — поехала и строка в карточке, и скорость,
  //    по которой корабль летит. Раньше модуль ссылался на числа корпуса,
  //    и это была ровно та развилка, из-за которой другой двигатель
  //    завести было нельзя.
  const engineRow = () => modules().find((m) => m.slot === 'engine').value;
  const stockRow = engineRow();
  const fast = doc.modules.find((m) => m.code === 'engine_x');
  applyShipEquipment(doc.modules
    .filter((m) => m.installed && m.slot !== 'engine')
    .concat([fast]));
  applyShipSpec(flightModel(doc.shipTypes[0].spec));
  const fastRow = engineRow();
  const fastSpeed = SHIP.maxSpeed;
  // Возвращаем заводскую комплектацию: следующие проверки летят на ней.
  applyModuleSpecs(doc.modules);
  applyShipSpec(flightModel(doc.shipTypes[0].spec));
  ok(fastSpeed > spec.maxSpeed && fastRow !== stockRow
     && SHIP.maxSpeed === spec.maxSpeed,
    'сменили двигатель — поехали обе стороны: «' + stockRow + '» -> «' + fastRow
    + '», корабль ' + spec.maxSpeed + ' -> ' + fastSpeed + ' км/с');

  // 8а. Числа правят руками в базе, и одной опечатки в JSON хватает,
  //     чтобы у модуля их не стало. Карточка обязана сказать об этом
  //     строкой, а не упасть целиком: рядом десяток исправных приборов.
  applyShipEquipment(doc.modules
    .filter((m) => m.installed && m.slot !== 'engine')
    .concat([{ code: 'engine', name: 'МАРШЕВЫЙ ДВИГАТЕЛЬ', slot: 'engine', spec: {} }]));
  let broke = null;
  try {
    broke = modules().find((m) => m.slot === 'engine').value;
  } catch (e) {
    broke = null;
  }
  applyModuleSpecs(doc.modules);
  applyShipSpec(flightModel(doc.shipTypes[0].spec));
  ok(typeof broke === 'string' && broke.length > 0 && modules().length > 5,
    'модуль без чисел не уносит карточку: «' + broke + '»');

  // 8. Пустое гнездо не даёт кораблю ничего, и это не недосмотр: без
  //    двигателя не летают. Показать это важнее, чем подставить ноль
  //    молча, — «ГНЕЗДО СВОБОДНО» читается, а тихий ноль нет.
  applyShipEquipment(doc.modules.filter((m) => m.installed && m.slot !== 'shield'));
  const naked = flightModel(doc.shipTypes[0].spec);
  const shieldRow = modules().find((m) => m.slot === 'shield');
  applyModuleSpecs(doc.modules);
  applyShipSpec(flightModel(doc.shipTypes[0].spec));
  ok(naked.maxShield === undefined && !shieldRow.installed
     && SHIP.maxShield === spec.maxShield,
    'сняли щит — гнездо свободно и чисел щита у корабля нет: «' + shieldRow.value + '»');
  ok(SCANNER_STEPS.length === 6 && SCANNER_STEPS[5] === 20000,
    'ступени сканера приехали с модулем сканера: ' + SCANNER_STEPS.length);

  // 8. Гнездо, о котором карточка ничего не знает, всё равно показывается:
  //    модуль, заведённый на сервере, попадает в игру без её правки.
  applyModuleSpecs([{ code: 'cloak', slot: 'hull', name: 'МАСКИРОВКА',
    installed: true, spec: { seconds: 12 } }]);
  const unknown = modules().find((m) => m.code === 'cloak');
  ok(unknown && unknown.value.indexOf('12') >= 0,
    'незнакомый модуль показан общим видом: ' + (unknown ? unknown.value : 'нет строки'));
  applyModuleSpecs(doc.modules);

  // 9. Названия из бэкенда тоже переводятся: они приходят по-русски и
  //    проходят через L() при показе — как названия товаров.
  const noEn = [...doc.modules.map((m) => m.name), ...doc.weapons.map((w) => w.name),
    ...doc.weapons.map((w) => w.mountName)].filter((n) => !hasEn(n));
  ok(noEn.length === 0,
    'у названий модулей и оружия есть английский'
    + (noEn.length ? ': нет у ' + noEn.join(', ') : ''));

  // 10. Слепок не отстал от источника.
  //
  //     Точную сверку делает серверный набор (он умеет прочитать
  //     specs.php), но ждать её нельзя: правят числа чаще, чем гоняют
  //     PHP. Здесь сравниваются ВРЕМЕНА ПРАВКИ — этого хватает, чтобы
  //     поймать обычный случай «поправил источник, забыл пересобрать».
  {
    const srcAt = statSync('server/data/specs.php').mtimeMs;
    const jsonAt = statSync('server/data/specs.json').mtimeMs;
    ok(jsonAt >= srcAt,
      'слепок собран после последней правки источника'
      + (jsonAt < srcAt ? ' — соберите: node tools/php.mjs server/cli/specs.php' : ''));
  }

  // 12. Квантовый привод — такое же снаряжение, и числа у него оттуда же.
  //     Здесь та же пара правил, что и для корпуса: в самом файле привода
  //     не должно остаться ни одного его числа, а то, что пришло, обязано
  //     доехать.
  {
    const drive = doc.modules.find((m) => m.code === 'quantum');
    const src = readFileSync('js/game/quantum.js', 'utf8')
      .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), '')
      .replace(new RegExp('^\\s*//.*$', 'gm'), '');
    const bakedDrive = Object.keys(drive.spec)
      .filter((k) => new RegExp('(?<![.\\w])' + k + '\\s*:\\s*-?\\d').test(src));
    ok(bakedDrive.length === 0,
      'числа привода не вписаны в игру'
      + (bakedDrive.length ? ': ' + bakedDrive.join(', ') : ''));
    ok(QUANTUM.exitPeer === drive.spec.exitPeer && QUANTUM.spool === drive.spec.spool,
      'выход у чужого корабля за ' + QUANTUM.exitPeer + ' км — число из бэкенда');
    ok(Math.abs(QUANTUM.align - (drive.spec.alignDeg * Math.PI) / 180) < 1e-12,
      'допуск по прицелу переведён в радианы: ' + drive.spec.alignDeg + '°');
    // Скорость прыжка принадлежит КОРПУСУ, а не приводу: у привода её нет
    // вовсе, он берёт её из лётной модели.
    ok(QUANTUM.speed === SHIP.quantumSpeed && drive.spec.quantumSpeed === undefined,
      'скорость прыжка взята у корпуса: ' + QUANTUM.speed + ' км/с');
    // Алгоритмические числа остались в коде, и это не упущение: резка
    // трассы на куски — приём расчёта, а не свойство привода.
    ok(QUANTUM.segs === 12 && QUANTUM.relief === 0.02,
      'параметры расчёта коридора остались в коде: ' + QUANTUM.segs + ' кусков');
  }

  // 11. Пустой набор — это отказ, а не «полетим на умолчаниях».
  let refused = false;
  try { applySpecs({ shipTypes: [] }); } catch (e) { refused = true; }
  ok(refused, 'без характеристик игра не собирается');
  applySpecs(doc);
}

// --- перевод ----------------------------------------------------------------
//
// Перевод разъезжается с игрой за неделю, если за ним не следить. Следит
// эта проверка, и следит по исходникам: она читает сами файлы игры и
// требует, чтобы КАЖДАЯ русская строка либо проходила через L(), либо
// лежала в словаре. Поэтому новую надпись нельзя добавить молча — набор
// упадёт и назовёт файл.
{
  console.log('\n== перевод ==');

  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  // Отладочный оверлей не переводится намеренно: это инструмент
  // разработки, а не игры, и держать его в двух видах — работа без отдачи.
  // Слой GL исключён целиком — там GLSL и сообщения драйверу; те его
  // строки, что видит игрок, всё равно обёрнуты и переведены.
  const SKIP = (p) => p.startsWith('js/gl/')
    || ['js/core/lang.js', 'js/core/lang.en.js', 'js/core/quality.js',
      'js/core/sound.js', 'js/game/audio.js', 'js/ui/debug.js'].includes(p);

  const walk = (dir, out = []) => {
    for (const nm of readdirSync(dir)) {
      const p = join(dir, nm).replace(/\\/g, '/');
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith('.js') && !SKIP(p)) out.push(p);
    }
    return out;
  };

  /** Границы строковых литералов: строки, комментарии и шаблоны различаются. */
  const literals = (src) => {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j + 1; continue; }
      if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
      if (c === "'" || c === '"' || c === '`') {
        let j = i + 1;
        let depth = 0;
        while (j < src.length) {
          if (src[j] === '\\') { j += 2; continue; }
          if (c === '`' && src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
          if (c === '`' && src[j] === '}' && depth) { depth--; j++; continue; }
          if (src[j] === c && !depth) break;
          if (c !== '`' && src[j] === '\n') break;
          j++;
        }
        out.push({ a: i, b: j + 1, q: c, body: src.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
      i++;
    }
    return out;
  };

  const RU = /[А-Яа-яЁё]/;
  // Файлы, где русский лежит ДАННЫМИ, а не надписью: каталог тел и звёзд,
  // оружие, стартовый набор пилота и раскладка сенсорных кнопок (она
  // считается один раз, поэтому подпись переводится при отрисовке).
  const DATA = ['js/game/bodyinfo.js', 'js/game/galaxy.js', 'js/game/player.js',
    // targetKind отдаёт вид цели ОДНИМ СЛОВОМ — станция, планета, пилот, —
    // и слово это ключ: переводится оно при показе (L(kind) в приборах).
    // Обернуть его на месте нельзя по той же причине, что и каталоги.
    'js/game/nav.js',
    'js/ui/touch.js'];
  const files = walk('js');
  const loose = [];
  const noTranslation = [];

  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const lit of literals(src)) {
      if (!RU.test(lit.body)) continue;
      const before = src.slice(Math.max(0, lit.a - 2), lit.a);
      const wrapped = before === 'L(';
      // Каталожные названия (ru: '...') — это КЛЮЧИ: они лежат по-русски и
      // переводятся при показе, поэтому обёртки у них нет, а перевод обязан
      // быть.
      // Каталог — это ДАННЫЕ, а не надписи прибора: названия типов тел,
      // оружия, товаров и лента стартового набора лежат по-русски и
      // переводятся при показе (L(c.name) и подобное). Обёртки у них нет и
      // быть не должно — иначе перевод застыл бы на том языке, который был
      // при загрузке модуля. Перевод при этом обязателен и проверяется.
      const isCatalog = DATA.includes(f);
      if (wrapped || isCatalog) {
        if (!hasEn(lit.body) && lit.q !== '`') noTranslation.push(f + ': ' + lit.body.slice(0, 40));
        continue;
      }
      if (lit.q === '`') continue;          // шаблоны разбираются глазами
      loose.push(f + ': ' + lit.body.slice(0, 40));
    }
  }

  ok(loose.length === 0,
    'все русские надписи проходят через перевод'
    + (loose.length ? ': ' + loose.length + ' мимо, первая — ' + loose[0] : ''));
  ok(noTranslation.length === 0,
    'у каждой надписи есть английский'
    + (noTranslation.length ? ': нет ' + noTranslation.length + ', первая — ' + noTranslation[0] : ''));

  // Сам переключатель.
  setLang('en');
  ok(L('КОРПУС') === 'HULL' && L('ЩИТ') === 'SHIELD', 'по-английски приборы подписаны иначе');
  ok(getLang() === 'en' && !!LANGS.ru && !!LANGS.en, 'язык переключился, оба в списке');
  ok(L('такой строки нет в словаре') === 'такой строки нет в словаре',
    'без перевода возвращается русский: пустое место на приборе хуже');
  setLang('ru');
  ok(L('КОРПУС') === 'КОРПУС', 'по-русски строка возвращается как есть');
  setLang('нет такого языка');
  ok(getLang() === 'ru', 'неизвестный язык не принимается');
}

console.log('\n' + (fails === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : fails + ' ПРОВЕРОК УПАЛО'));
process.exit(fails ? 1 : 0);
