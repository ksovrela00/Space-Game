// Headless-проверка игровой логики: мир, полёт, квантовый привод, стыковка.
import { v3, normalize, dot, cross, len, clamp } from '../js/core/vec3.js';
import { makeBasis, rotateBasis, toLocal } from '../js/core/basis.js';
import { shipAnchor, anchorOk, anchorPose } from '../js/game/anchor.js';
import { pilotRows, pilotsShown } from '../js/ui/pilots.js';
import { makeSystem, updateWorld, nearestBody, bodyPosAt, bodyBasis } from '../js/game/world.js';
import { ROMAN } from '../js/core/rng.js';
import {
  makeGalaxy, systemDistance, warpSeconds, SYSTEM_COUNT, MIN_APART,
  HOME_SEED, HAB_HOME, WARP_MIN, WARP_MAX, systemById,
} from '../js/game/galaxy.js';
import {
  makeWarp, updateWarp, startWarp, canWarp, warpAxis, warpPower,
  handoverAt, placeAtStar, finishWarp, WARP,
} from '../js/game/warp.js';
import { HOME_LAYOUT } from '../js/game/world.js';
import { makeShip, updateShip, placeShip, clearControls, SHIP, applyShipSpec } from '../js/game/ship.js';
import {
  makeNav, refreshNav, currentTarget, targetById, pickTarget, aimedTarget, aimTargets, AIM_CONE,
  targetKind,
} from '../js/game/nav.js';
import {
  makeQuantum, updateQuantum, startCalibration, stopQuantum, abortQuantum, canJump,
  corridorBlock, exitPoint, exitVelocity, jumpTime, suggestHop, QUANTUM,
} from '../js/game/quantum.js';
import { checkStation, startDockingComputer, updateDockingComputer, dockingQuality } from '../js/game/docking.js';
import { alignBasis, horizontal } from '../js/game/pilot.js';
import {
  isLandable, groundRadius, altitudeOf, surfaceNormal, slopeAt, findSite,
  worldPoint, surfaceVelocity, localDir, dirToWorldBody, waterAt, hasSea,
} from '../js/game/surface.js';
import {
  toggleGear, updateGear, gearReady, landingContext, bounceOff, LAND,
  startLanding, updateLandingComputer, checkTouchdown, settle, updateLandedPose,
  takeoff, landingReadout,
} from '../js/game/landing.js';
import { captureBody, carryShip, gravityField, groundDrift, CAPTURE_G } from '../js/game/gravity.js';
import { ENTRY, airDensity, entryHeat, heatColor, entryState } from '../js/game/entry.js';
import { feetGround, feetClearance } from '../js/game/landing.js';
import { GEAR_FEET } from '../js/models/ships.js';
import { scatterRocks, buildRockGeometry, ROCKS } from '../js/gl/rocks.js';
import { CITY, CITY_KINDS, cityPlan, cityBlocked, nearestPad, partBox } from '../js/models/city.js';
import {
  makeCity, cityCrash, cityPadUnder, canHostCity, citySite, cityRecord, applyCities,
  cityWorld, cityDrop,
} from '../js/game/city.js';
import {
  buildCityGeometry, cityTris, nearSet, NEAR_TRIS,
  SHADOW_RGB, SHADOW_LIFT, SHADOW_MAX, sunCasts,
  SHADE_MAX, shadeBoxes, shadeHit,
} from '../js/gl/citymesh.js';
import { plateAt } from '../js/gl/terrain.js';
import { makeDust, updateDust, DUST } from '../js/game/dust.js';
import {
  WASH, SHIP_MASS, engineLoad, liftThrust, groundQ, windOf, bendAngle, BEND,
  washState, washAt, airDensity as washAir,
} from '../js/game/downwash.js';
import {
  CHASE, CHASE_UNDER, eyeHeight, chaseRates, makeChase, updateChase, placeChase,
} from '../js/game/chase.js';
import { HULL_VOLUME_M3, HULL_CLEAR as HULL_FLOOR } from '../js/models/ships.js';
import { cityLocal } from '../js/game/city.js';
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
import { resetMap,
  makeMap, mapObjects, objectCard, focusOn, fitScale, pickAt, fmtMass,
  markerOnBody, glyphRadius,
} from '../js/ui/map.js';
import { makeAudio, updateAudio, playAudio, audioCue, audioReset, AUDIO } from '../js/game/audio.js';
import { Sound } from '../js/core/sound.js';
import { ST as AST } from '../js/game/state.js';

import { buildCobra, buildGear, HULL_HALF } from '../js/models/ships.js';
import { LAMP, lampBeams, lampCone } from '../js/game/lamps.js';
import { stationMesh as buildStationMesh, stationShape, SLOT, STATION_KINDS } from '../js/models/stations.js';
import { Camera } from '../js/render/camera.js';
import { velocityMarker, projectDir } from '../js/ui/hud.js';
import { buildCockpit, makeYoke, updateYoke, YOKE, SCREENS, CMAT } from '../js/models/cockpit.js';
import { TIP_ARM } from '../js/game/ship.js';
import { layoutAtlas, makeDisplays } from '../js/ui/displays.js';
import { NOMINAL } from '../js/ui/panels.js';
import { cabinArrays, sunVisibility } from '../js/gl/cabin.js';
import { hullFrameAt } from '../js/gl/hull.js';
import { BRIDGE } from '../js/models/hulldetail.js';
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
const stationMesh = buildStationMesh('coriolis');
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


// --- 2c. Станции: форма, столкновение, створ --------------------------------
//
// Станция — единственная модель, у которой форма это ИГРА, а не вид: в
// неё влетают. Поэтому проверяется не «строится ли меш», а совпадение
// трёх вещей: нарисованного корпуса, тела столкновения и коридора, по
// которому в порт заходят.
console.log('\n== станции ==');
{
  ok(STATION_KINDS.length === 2 && STATION_KINDS.includes('coriolis')
    && STATION_KINDS.includes('orbis'),
    'типов станций два: ' + STATION_KINDS.join(', '));

  for (const kind of STATION_KINDS) {
    const mesh = buildStationMesh(kind);
    const sh = stationShape(kind);
    let far = 0;
    for (const v of mesh.verts) far = Math.max(far, Math.hypot(v.x, v.y, v.z));
    ok(mesh.faces.length > 500 && Number.isFinite(far),
      `${kind}: ${mesh.verts.length} вершин, ${mesh.faces.length} граней`);

    // Габарит — это радиус станции как цели: по нему считают зазор до
    // края, точку выхода из прыжка и отметку в приборах. Модель, которая
    // из него торчит, означала бы, что выход из прыжка приходится внутрь
    // станции.
    ok(far <= sh.bound * 1.02,
      `${kind}: модель не торчит из габарита — ${far.toFixed(2)} км при ${sh.bound.toFixed(2)}`);

    // Огни порта светятся сами: половину витка станция повёрнута к
    // солнцу спиной, и в эти полвитка створ виден только по ним.
    const glow = mesh.faces.filter((f) => f.emissive).length;
    ok(glow > 20, `${kind}: светящихся граней ${glow}`);

    // Створ ВНУТРИ корпуса, а не где-то рядом с ним.
    ok(sh.D > 0 && sh.D < sh.bound,
      `${kind}: плоскость створа ${sh.D.toFixed(2)} км внутри габарита ${sh.bound.toFixed(2)}`);

    // Рядом со щелью — корпус, перед створом — пусто. Без первого
    // «промахнулся в створ» не значило бы ничего: корабль уходил бы
    // сквозь обшивку.
    ok(sh.inside(SLOT.hw * 3, 0, sh.D - 0.02),
      `${kind}: мимо щели на том же уровне — корпус`);
    ok(!sh.inside(0, 0, sh.D + 0.05),
      `${kind}: перед створом пусто`);
  }

  // Кубооктаэдр: шесть квадратов, восемь треугольников, двенадцать
  // вершин. Проверяем по САМОЙ форме, а не по числу граней меша (в нём
  // ещё детали): все двенадцать вершин лежат на границе тела.
  const cor = stationShape('coriolis');
  const s = cor.D;
  let onEdge = 0, outside = 0;
  for (const zero of [0, 1, 2]) {
    for (const a of [-s, s]) {
      for (const b of [-s, s]) {
        const p = [0, 0, 0];
        const rest = [0, 1, 2].filter((i) => i !== zero);
        p[rest[0]] = a; p[rest[1]] = b;
        if (cor.inside(p[0] * 0.99, p[1] * 0.99, p[2] * 0.99)) onEdge++;
        if (!cor.inside(p[0] * 1.02, p[1] * 1.02, p[2] * 1.02)) outside++;
      }
    }
  }
  ok(onEdge === 12 && outside === 12,
    `«Кориолис»: все 12 вершин на границе тела (внутри ${onEdge}, снаружи ${outside})`);
  // Углы срезаны: точка за срезом снаружи, хотя по осям она внутри.
  ok(!cor.inside(s * 0.8, s * 0.8, s * 0.8) && cor.inside(s * 0.6, s * 0.6, s * 0.6),
    '«Кориолис»: углы куба срезаны треугольными гранями');

  // «Орбис»: кольцо — тело, а не картинка. Мимо ступицы, но в кольцо —
  // столкновение; между ступицей и кольцом — пусто.
  const orb = stationShape('orbis');
  // Обе точки — ПО ДИАГОНАЛИ: по осям от ступицы к кольцу идут спицы, и
  // там тело в любом случае. Проверка на оси проходила бы и с
  // выброшенным кольцом — то есть не проверяла бы ничего.
  const d45 = Math.SQRT1_2;
  ok(orb.inside(1.0 * d45, 1.0 * d45, -0.02) && !orb.inside(0.42 * d45, 0.42 * d45, -0.02),
    '«Орбис»: кольцо сплошное, а между ним и ступицей пусто');
  ok(orb.inside(0.6, 0, -0.02), '«Орбис»: спица — тоже тело, а не картинка');
  ok(orb.inside(0, 0, -0.8) && !orb.inside(0.4, 0, -0.8),
    '«Орбис»: мачта позади ступицы — тело, вокруг неё пусто');

  // Тип станции — от ИМЕНИ, и он обязан быть одинаковым в каждом полёте:
  // по форме порта узнают систему.
  const w1 = makeSystem(0x1a7e);
  const w2 = makeSystem(0x1a7e);
  const same = w1.stations.every((st, i) => st.type === w2.stations[i].type);
  ok(same && w1.stations.every((st) => STATION_KINDS.includes(st.type)),
    'тип станции повторяется от запуска к запуску: '
    + w1.stations.map((st) => st.type).join(', '));

  // И оба типа в галактике ВСТРЕЧАЮТСЯ: одинаковые порты во всех
  // системах — это ровно то, ради чего типов два.
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    for (const st of makeSystem(1000 + i * 7919).stations) seen.add(st.type);
  }
  ok(seen.size === 2, 'в галактике встречаются оба типа: ' + [...seen].join(', '));
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
// Время тут не украшение: подход с обратной стороны — это обход станции
// кругом, и «состыковались за ноль секунд» означает, что стыковкой
// засчитали положение ПОЗАДИ станции, на её же оси.
ok(t3.status === 'docked' && t3.t > 30,
  `подход с обратной стороны (из-за планеты), 60 км -> ${t3.status} за ${t3.t ? t3.t.toFixed(0) : '?'} с`);

const t4 = dockTest(400, (st) => ({ ...st.basis.fwd }));
ok(t4.status === 'refused', `с 400 км докинг-компьютер отказывает: ${t4.reason || t4.status}`);

// Заход в створ у ОБОИХ типов станций.
//
// Форма у них разная, и глубина створа разная: у «Кориолиса» плоскость
// порта в 700 метрах от центра, у «Орбиса» — в 300. Вся стыковка считает
// от неё, поэтому проверяется каждый тип отдельно: в створ — стыковка,
// мимо створа на той же глубине — столкновение.
{
  const findStation = (kind) => {
    for (let i = 0; i < 40; i++) {
      const st = makeSystem(1000 + i * 7919).stations.find((x) => x.type === kind);
      if (st) return st;
    }
    return null;
  };
  for (const kind of STATION_KINDS) {
    const st = findStation(kind);
    const sh = makeShip();
    const enter = (dx, dy) => {
      const b = st.basis, D = st.shape.D;
      placeShip(sh, v3(
        st.pos.x + b.fwd.x * (D - 0.05) + b.right.x * dx + b.up.x * dy,
        st.pos.y + b.fwd.y * (D - 0.05) + b.right.y * dx + b.up.y * dy,
        st.pos.z + b.fwd.z * (D - 0.05) + b.right.z * dx + b.up.z * dy), makeBasis());
      lookAlong(sh.basis, v3(-b.fwd.x, -b.fwd.y, -b.fwd.z), b.up);
      sh.vel.x = st.vel.x; sh.vel.y = st.vel.y; sh.vel.z = st.vel.z;
      sh.speed = 0;
      return checkStation(sh, st);
    };
    ok(st !== null && enter(0, 0) === 'docked',
      `${kind}: по оси в створ — стыковка`);
    ok(enter(SLOT.hw * 2.5, 0) === 'crash',
      `${kind}: мимо створа в обшивку — столкновение`);
    ok(enter(0, SLOT.hh * 4) === 'crash',
      `${kind}: выше створа — тоже обшивка`);
  }
}

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
  ok(isLandable(moon) && isLandable(w.home) && !isLandable(w.star) &&
     !isLandable(w.planets.find((p) => p.kind === 'gas')),
    'сесть можно на луну и на мир с атмосферой, но не на светило и не на гиганта');

  // Вода — не грунт. Море — это рельеф ниже уровня моря, ровная сфера:
  // ровнее любой суши, и поиск площадки без запрета выбирал бы именно его.
  {
    const home = w.home;
    let wetDir = null, dryDir = null;
    for (let i = 0; i < 400 && !(wetDir && dryDir); i++) {
      const a = i * 2.399963, u = -0.6 + 1.2 * (i / 399), s = Math.sqrt(1 - u * u);
      const d = normalize(v3(s * Math.cos(a), u, s * Math.sin(a)));
      if (waterAt(home, d)) { if (!wetDir) wetDir = d; } else if (!dryDir) dryDir = d;
    }
    const icy = w.bodies.find((b) => b.kind === 'ice');
    ok(wetDir && dryDir && hasSea(home) && !hasSea(icy) && !hasSea(moon)
      && Math.abs(groundRadius(home, wetDir) - home.radius) < 1e-9,
      'у океанического мира море — ровная сфера на уровне моря; у ледяного «море» замёрзло, по нему ходят');
    // Возле берега: ищем точку суши рядом с водой и площадку от воды.
    let coast = null;
    for (let i = 0; i < 4000 && !coast; i++) {
      const a = i * 2.399963, u = -0.6 + 1.2 * (i / 3999), s = Math.sqrt(1 - u * u);
      const d = normalize(v3(s * Math.cos(a), u, s * Math.sin(a)));
      if (!waterAt(home, d)) continue;
      const site = findSite(home, d, 3);
      if (!site.water) coast = { d, site };
    }
    ok(coast && !waterAt(home, coast.site.dir) && coast.site.slope <= 0.35,
      'из воды у берега поиск уводит площадку на сушу' +
      (coast ? ': уклон ' + (coast.site.slope * 57.3).toFixed(1) + '°' : ''));
  }

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
  if (opts.dir) {
    placeShip(sh, v3(body.pos.x + opts.dir.x * r0, body.pos.y + opts.dir.y * r0,
      body.pos.z + opts.dir.z * r0), makeBasis());
    lookAlong(sh.basis, normalize(v3(
      body.pos.x - sh.pos.x, body.pos.y - sh.pos.y, body.pos.z - sh.pos.z)));
  }
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
      if (sh.landing.abort) return { status: 'abort', t, reason: sh.landing.abort, sh, w, body };
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
  // Мир с атмосферой: тот же компьютер, та же посадка. Нагрева на
  // спуске нет — скорость снижения далеко ниже порога (ENTRY.vFloor).
  // Над сушей: направление берётся в осях тела, где вода и суша известны.
  const wHome = makeSystem(0x1a7e);
  let dryHome = null;
  for (let i = 0; i < 600 && !dryHome; i++) {
    const a = i * 2.399963, u = -0.6 + 1.2 * (i / 599), s = Math.sqrt(1 - u * u);
    const d = normalize(v3(s * Math.cos(a), u, s * Math.sin(a)));
    const site = findSite(wHome.home, d, 2.5);
    if (!site.water && site.slope < 0.15 && slopeAt(wHome.home, d) < 0.15) dryHome = dirToWorldBody(wHome.home, d, v3());
  }
  const r4 = landTest((w) => w.home, QUANTUM.exitAlt, { dir: dryHome });
  ok(r4.status === 'landed' && r4.r.slopeOk && r4.r.landOk,
    `на мир с атмосферой (${r4.body ? r4.body.name : '?'}) компьютер садится: ${r4.status} за ${r4.t ? r4.t.toFixed(0) : '?'} с`,
    r4.phases ? r4.phases.join(' -> ') : r4.reason || '');
  const r5 = landTest((w) => w.planets.find((p) => p.kind === 'desert'), QUANTUM.exitAlt);
  ok(r5.status === 'landed', `пустынная планета: ${r5.status} за ${r5.t ? r5.t.toFixed(0) : '?'} с`);
  // Над открытым морем садиться некуда: компьютер отдаёт ручки пилоту, а
  // не ведёт корабль в воду.
  {
    const w0 = makeSystem(0x1a7e);
    let deep = null;
    for (let i = 0; i < 600 && !deep; i++) {
      const a = i * 2.399963, u = -0.6 + 1.2 * (i / 599), s = Math.sqrt(1 - u * u);
      const d = normalize(v3(s * Math.cos(a), u, s * Math.sin(a)));
      if (findSite(w0.home, d, 50).water) deep = d;
    }
    const r6 = deep ? landTest((w) => w.home, QUANTUM.exitAlt, { dir: dirToWorldBody(w0.home, deep, v3()) }) : { status: 'нет моря' };
    ok(r6.status === 'abort',
      `над открытым морем компьютер садиться отказывается: ${r6.reason || r6.status}`);
  }
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

// Касание планеты с атмосферой — такое же, как у луны: мягкое на шасси —
// посадка. Раньше оно было ударом всегда, каким бы мягким ни было, и
// корабль гиб на первой попытке. А вот вода — крушение при любом
// касании: на плаву корабль не держится.
{
  const w = makeSystem(0x1a7e);
  const planet = w.planets.find((p) => p.kind === 'desert');
  const touchAt = (body, dir) => {
    const sh = makeShip();
    const up = normalize(v3(dir.x, dir.y, dir.z));
    placeShip(sh, worldPoint(body, up, groundRadius(body, up) + SHIP.gearClear - 0.0003, v3()), makeBasis());
    // Брюхом к грунту: верх корабля — по местной вертикали.
    const wu = dirToWorldBody(body, up, v3());
    const side = Math.abs(wu.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
    const fwd = normalize(v3(side.y * wu.z - side.z * wu.y, side.z * wu.x - side.x * wu.z, side.x * wu.y - side.y * wu.x));
    lookAlong(sh.basis, fwd, wu);
    sh.gear.out = true; sh.gear.t = 1;
    const zone = landingContext(w, sh);
    return { zone, touch: zone ? checkTouchdown(sh, zone) : null };
  };
  let flat = null;
  for (let i = 0; i < 400 && !flat; i++) {
    const a = i * 2.399963, u = -0.6 + 1.2 * (i / 399), s = Math.sqrt(1 - u * u);
    const d = normalize(v3(s * Math.cos(a), u, s * Math.sin(a)));
    if (slopeAt(planet, d) < 0.05) flat = d;
  }
  const dry = touchAt(planet, flat);
  ok(dry.zone && dry.zone.body === planet && dry.touch && dry.touch.result === 'landed',
    `у планеты с атмосферой мягкое касание на шасси — посадка: ${dry.touch ? dry.touch.result : 'касание не определено'}`);
  let wet = null;
  for (let i = 0; i < 400 && !wet; i++) {
    const a = i * 2.399963, u = -0.6 + 1.2 * (i / 399), s = Math.sqrt(1 - u * u);
    const d = normalize(v3(s * Math.cos(a), u, s * Math.sin(a)));
    if (waterAt(w.home, d)) wet = d;
  }
  const sea = touchAt(w.home, wet);
  ok(sea.zone && sea.zone.water && sea.touch && sea.touch.result === 'crash' && landingReadout(makeShip(), sea.zone).landOk === false,
    `касание воды — крушение, и прибор «суша» горит красным заранее: ${sea.touch ? sea.touch.reason : '—'}`);
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
//
// Тень — картой глубины от солнца (js/gl/shipshadow.js). Здесь её счёт
// повторён на процессоре: корпус растеризуется в карту той же стороны,
// что у сцены, а точки грунта и обшивки спрашивают её так же, как
// шейдер (сдвиг по нормали, запас по глубине). Ответ сверяется с
// эталоном — лучом от точки к солнцу, пересечённым со всеми гранями
// корпуса. Совпало — значит, тень лежит там, где её отбрасывает корпус,
// и только там: на грунте, а не над ним.
console.log('\n== тень ==');
{
  const S = await import('../js/gl/shipshadow.js');
  const { buildCobra: build, GEAR_CLEAR: gc } = await import('../js/models/ships.js');
  const hull = build();
  const N = S.SHIP_SHADOW.size;
  const h = S.hullRadius(hull) + S.SHIP_SHADOW.pad;
  const center = v3(0, 0, 0);
  // Треугольники корпуса (оси корабля = мировые, корабль в начале).
  const T = [];
  for (const f of hull.faces) {
    for (let k = 2; k < f.v.length; k++) T.push([hull.verts[f.v[0]], hull.verts[f.v[k - 1]], hull.verts[f.v[k]]]);
  }
  // Эталон: луч от точки к солнцу задевает корпус (Мёллер — Трумбор).
  const blocked = (p, d) => {
    for (const [a, b, c] of T) {
      const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
      const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
      const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-18) continue;
      const tx = p.x - a.x, ty = p.y - a.y, tz = p.z - a.z;
      const u = (tx * px + ty * py + tz * pz) / det;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const vv = (d.x * qx + d.y * qy + d.z * qz) / det;
      if (vv < 0 || u + vv > 1) continue;
      if ((e2x * qx + e2y * qy + e2z * qz) / det > 1e-6) return true;
    }
    return false;
  };
  const sunAt = (elev, az) => normalize(v3(Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az)));
  for (const [elev, az, name] of [[1.2, 0.7, 'высоко'], [0.45, 2.3, 'вечером']]) {
    const sun = sunAt(elev, az);
    const F = S.shadowFrame(center, sun, h);
    // Карта: глубина ближайшей к солнцу грани в каждой точке.
    const depth = new Float32Array(N * N).fill(1);
    const sc = (p) => S.shadowCoord(F, p, [0, 0, 0]);
    for (const tri of T) {
      const [A, B, C] = tri.map(sc);
      const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]) * N));
      const x1 = Math.min(N - 1, Math.ceil(Math.max(A[0], B[0], C[0]) * N));
      const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]) * N));
      const y1 = Math.min(N - 1, Math.ceil(Math.max(A[1], B[1], C[1]) * N));
      const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
      if (Math.abs(den) < 1e-18) continue;
      for (let j = y0; j <= y1; j++) {
        const y = (j + 0.5) / N;
        for (let i = x0; i <= x1; i++) {
          const x = (i + 0.5) / N;
          const w0 = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / den;
          const w1 = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / den;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
          if (z < depth[j * N + i]) depth[j * N + i] = z;
        }
      }
    }
    // Выборка — как в шейдере (без сглаживания: одна точка карты).
    const texKm = 2 * h / N;
    const lit = (p, n) => {
      const q = v3(p.x + n.x * texKm * S.SHIP_SHADOW.offset, p.y + n.y * texKm * S.SHIP_SHADOW.offset,
        p.z + n.z * texKm * S.SHIP_SHADOW.offset);
      const s = sc(q);
      if (s[0] <= 0 || s[1] <= 0 || s[0] >= 1 || s[1] >= 1 || s[2] <= 0) return true;
      const r = Math.min(s[2], 1) - S.SHIP_SHADOW.bias / N;
      return r <= depth[Math.floor(s[1] * N) * N + Math.floor(s[0] * N)];
    };
    // Грунт под кораблём на шасси: ровная площадка, сетка точек на сто
    // метров вокруг — в том числе там, куда тень вытянута низким солнцем.
    const up = v3(0, 1, 0);
    const shift = v3(-sun.x / sun.y * gc, 0, -sun.z / sun.y * gc);
    let agree = 0, total = 0, shadowed = 0, leak = 0, phantom = 0;
    for (let a = -40; a <= 40; a++) {
      for (let b = -40; b <= 40; b++) {
        const p = v3(shift.x + a * 0.0013, -gc, shift.z + b * 0.0013);
        const truth = blocked(p, sun), got = !lit(p, up);
        total++;
        if (truth === got) agree++;
        else if (truth) leak++; else phantom++;
        if (truth) shadowed++;
      }
    }
    // Обшивка, повёрнутая к солнцу: сама себя она затенять не должна
    // (рябь), а там, где её закрывает другая часть корпуса, — должна.
    let acne = 0, faces = 0;
    for (const f of hull.faces) {
      if (!f.n || f.n.x * sun.x + f.n.y * sun.y + f.n.z * sun.z < 0.3) continue;
      const c = v3(0, 0, 0);
      for (const i of f.v) { c.x += hull.verts[i].x; c.y += hull.verts[i].y; c.z += hull.verts[i].z; }
      c.x /= f.v.length; c.y /= f.v.length; c.z /= f.v.length;
      const p = v3(c.x + f.n.x * 1e-6, c.y + f.n.y * 1e-6, c.z + f.n.z * 1e-6);
      faces++;
      if (!lit(c, f.n) && !blocked(p, sun)) acne++;
    }
    ok(shadowed > 150 && agree / total > 0.985 && acne / faces < 0.03,
      `тень на грунте (солнце ${name}, ${(elev * 180 / Math.PI).toFixed(0)}°): карта ${N}² совпала с лучами к солнцу ` +
      `в ${(agree / total * 100).toFixed(1)}% точек (${shadowed} в тени; расхождения по краю — ${leak} светлых, ` +
      `${phantom} лишних); обшивка к солнцу сама себя не затеняет — рябь на ${acne} гранях из ${faces}`);
  }

  // Матрица шейдера — из осей КАМЕРЫ в карту — даёт то же, что прямой
  // счёт из мира: иначе тень уехала бы при повороте головы.
  {
    const F = S.shadowFrame(v3(1200.5, -300.25, 77.125), sunAt(0.6, 1.1), 0.05);
    const cam = { pos: v3(1200.51, -300.24, 77.13), basis: makeBasis() };
    lookAlong(cam.basis, normalize(v3(0.3, -0.5, 0.8)), normalize(v3(0.1, 1, 0.2)));
    const M = S.shadowMatrix(F, cam);
    let worst = 0;
    for (let i = 0; i < 50; i++) {
      const P = v3(F.c.x + Math.sin(i) * 0.03, F.c.y + Math.cos(i * 1.7) * 0.02, F.c.z + Math.sin(i * 2.3) * 0.03);
      const d = v3(P.x - cam.pos.x, P.y - cam.pos.y, P.z - cam.pos.z);
      const b = cam.basis;
      const pc = [dot(d, b.right), dot(d, b.up), dot(d, b.fwd)];
      const want = S.shadowCoord(F, P);
      for (let r = 0; r < 3; r++) {
        const got = M[r] * pc[0] + M[4 + r] * pc[1] + M[8 + r] * pc[2] + M[12 + r];
        worst = Math.max(worst, Math.abs(got - want[r]));
      }
    }
    ok(worst < 1e-6, `матрица тени из осей камеры совпадает с прямым счётом (ошибка ${worst.toExponential(1)} доли карты)`);
  }
}

// --- 5g. Задний ход ----------------------------------------------------------
// --- форсаж ---------------------------------------------------------------------
console.log('\n== фары ==');
{
  // Фары — это геометрия: где лампа и куда смотрит. Картинку проверить
  // нечем (её считает шейдер), а геометрию — можно целиком, и именно в
  // ней живёт весь смысл: одна лампа по курсу, вторая под углом вниз.
  const sh = makeShip();
  placeShip(sh, v3(0, 0, 0), makeBasis());

  ok(sh.lights === false && lampBeams(sh).length === 0,
    'по умолчанию фары выключены и лучей нет');

  sh.lights = true;
  const beams = lampBeams(sh);
  ok(beams.length === 2, 'ламп две: прямая и нижняя');

  // Обе стоят в НОСУ: луч не должен упираться в собственный корпус.
  const f = sh.basis.fwd;
  for (const b of beams) {
    const along = b.pos.x * f.x + b.pos.y * f.y + b.pos.z * f.z;
    ok(Math.abs(along - HULL_HALF.z) < 1e-9 && Math.hypot(b.pos.x, b.pos.y) < 1e-9,
      `лампа в носу: ${(along * 1000).toFixed(0)} м вперёд от центра`);
  }

  // Прямая смотрит ровно по носу.
  const a0 = beams[0].dir.x * f.x + beams[0].dir.y * f.y + beams[0].dir.z * f.z;
  ok(Math.abs(a0 - 1) < 1e-12, 'прямая лампа светит точно по курсу');

  // Нижняя — под tiltDeg вниз ОТ НОСА, и это проверяется углом, а не
  // тем, что «z отрицательный»: наклон живёт в осях корабля.
  const d = beams[1].dir;
  const cosF = d.x * f.x + d.y * f.y + d.z * f.z;
  const u = sh.basis.up;
  const cosU = d.x * u.x + d.y * u.y + d.z * u.z;
  const tilt = Math.atan2(-cosU, cosF) * 180 / Math.PI;
  ok(Math.abs(tilt - LAMP.tiltDeg) < 1e-9 && Math.abs(Math.hypot(cosF, cosU) - 1) < 1e-12,
    `нижняя лампа наклонена вниз на ${tilt.toFixed(1)}°`);

  // Нижняя ШИРЕ прямой: дальний свет узкий, ближний широкий.
  ok(beams[1].cosOut < beams[0].cosOut,
    `нижняя шире: ${LAMP.wideDeg}° против ${LAMP.coneDeg}°`);

  // Крен и тангаж лампы уносят с собой: это фара, а не подвес.
  const sh2 = makeShip();
  placeShip(sh2, v3(0, 0, 0), makeBasis());
  sh2.lights = true;
  rotateBasis(sh2.basis, 0, 0, Math.PI);          // перевернулись через крен
  const flipped = lampBeams(sh2);
  const up2 = sh2.basis.up;
  const cosU2 = flipped[1].dir.x * up2.x + flipped[1].dir.y * up2.y + flipped[1].dir.z * up2.z;
  ok(cosU2 < 0 && flipped[1].dir.y > 0,
    'перевернулись — ближний свет ушёл в небо, как и положено фаре');

  // Общий конус обеих фар. По нему отбираются постройки, кладущие тень
  // (js/gl/citymesh.js, shadeBoxes), и он обязан НАКРЫВАТЬ оба луча
  // целиком: потерянная кромка — это пропавшая тень, а лишний запас
  // стоит всего лишь места в uniform-ах.
  {
    const cone = lampCone(beams);
    let worst = 0;
    for (const b of beams) {
      const half = Math.acos(b.cosOut);
      // Пара поперечных осей к лучу — по ним обходим его кромку.
      const h = Math.abs(b.dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      const ux = b.dir.y * h.z - b.dir.z * h.y;
      const uy = b.dir.z * h.x - b.dir.x * h.z;
      const uz = b.dir.x * h.y - b.dir.y * h.x;
      const ul = Math.hypot(ux, uy, uz);
      const u = { x: ux / ul, y: uy / ul, z: uz / ul };
      const v = {
        x: b.dir.y * u.z - b.dir.z * u.y,
        y: b.dir.z * u.x - b.dir.x * u.z,
        z: b.dir.x * u.y - b.dir.y * u.x };
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const cs = Math.cos(half), sn = Math.sin(half);
        const rx = b.dir.x * cs + (u.x * Math.cos(a) + v.x * Math.sin(a)) * sn;
        const ry = b.dir.y * cs + (u.y * Math.cos(a) + v.y * Math.sin(a)) * sn;
        const rz = b.dir.z * cs + (u.z * Math.cos(a) + v.z * Math.sin(a)) * sn;
        worst = Math.min(worst, (rx * cone.x + ry * cone.y + rz * cone.z) - cone.cos);
      }
    }
    ok(worst > -1e-12,
      `общий конус фар накрывает оба луча: ${(Math.acos(cone.cos) * 180 / Math.PI).toFixed(0)}° `
      + `вокруг середины, запас по кромке ${worst.toExponential(0)}`);
  }

  // Выключили — лучей снова нет.
  sh.lights = false;
  ok(lampBeams(sh).length === 0, 'выключенные фары не светят');
}

console.log('\n== гасители инерции ==');
{
  // Выключенные гасители — это не «режим полёта», а снятие ровно тех
  // трёх подпорок, которыми модель держится: подбора заноса, задания
  // скорости тягой и компенсатора веса. Поэтому проверяется каждая из
  // трёх по отдельности, и рядом — что с гасителями всё по-прежнему.
  const mk = (damp) => {
    const sh = makeShip();
    placeShip(sh, v3(0, 0, 0), makeBasis());
    sh.damp = damp;
    return sh;
  };
  const run = (sh, secs, field = null, each = null) => {
    for (let i = 0; i < Math.round(secs / STEP); i++) {
      clearControls(sh);
      if (each) each(sh);
      updateShip(sh, STEP, field);
    }
    return sh;
  };

  ok(mk(true).damp === true, 'по умолчанию гасители включены');

  // 1. Ход не гаснет сам. Это и есть «лететь по инерции».
  {
    const off = mk(false);
    off.vel.z = 1; off.speed = 1;
    run(off, 5);
    const on = mk(true);
    on.vel.z = 1; on.speed = 1;
    run(on, 5);
    ok(Math.abs(off.speed - 1) < 1e-9 && on.speed < 0.01,
      `без гасителей ход держится (${off.speed.toFixed(3)} км/с), с ними гаснет `
      + `(${on.speed.toFixed(3)})`);
  }

  // 2. Нос отворачивается от вектора скорости, и скорость остаётся
  //    прежней — ради этого режим и нужен: идти боком, целясь назад.
  {
    const off = mk(false);
    off.vel.z = 1; off.speed = 1;
    // Разворот на 90° рысканием, ход при этом не трогаем.
    run(off, 6, null, (sh) => { sh.control.yaw = 1; });
    const drift = off.vel.z / Math.hypot(off.vel.x, off.vel.y, off.vel.z);
    const nose = off.basis.fwd.z;
    ok(Math.abs(off.speed - 1) < 1e-9 && drift > 0.999 && nose < 0.6,
      `нос ушёл от вектора скорости (нос ${nose.toFixed(2)} по оси, скорость `
      + `${drift.toFixed(3)}), а сама скорость не изменилась`);

    // С гасителями тот же разворот ведёт скорость за носом.
    const on = mk(true);
    on.vel.z = 1; on.speed = 1;
    run(on, 6, null, (sh) => { sh.control.yaw = 1; });
    const follow = on.vel.z / Math.max(1e-9, Math.hypot(on.vel.x, on.vel.y, on.vel.z));
    ok(follow < 0.9, `с гасителями скорость идёт за носом (${follow.toFixed(2)})`);
  }

  // 3. В тяготении корабль ПАДАЕТ — то, чего в обычном режиме не бывает
  //    вовсе: там вес держит компенсатор высоты.
  {
    const g = 0.0024;                       // 2.4 м/с², как у луны покрупнее
    const field = { up: v3(0, 1, 0), g };
    const off = run(mk(false), 10, field);
    const vFall = -off.vel.y, drop = -off.pos.y;
    ok(Math.abs(vFall - g * 10) < 1e-6 && Math.abs(drop - g * 100 / 2) < 0.01,
      `свободное падение: за 10 с ${(vFall * 1000).toFixed(1)} м/с `
      + `(gt = ${(g * 10 * 1000).toFixed(1)}), просело ${(drop * 1000).toFixed(0)} м `
      + `(gt²/2 = ${(g * 50 * 1000).toFixed(0)})`);

    const on = run(mk(true), 10, field);
    ok(Math.abs(on.pos.y) < 1e-6,
      `с гасителями высота стоит: ${(on.pos.y * 1000).toFixed(1)} м за те же 10 с`);
  }

  // 4. Тяга даёт УСКОРЕНИЕ и упирается в предел двигателя...
  {
    const off = mk(false);
    off.throttle = 1;
    run(off, 12);
    ok(Math.abs(off.speed - SHIP.maxSpeed) < 1e-6,
      `тяга разгоняет до предела двигателя: ${off.speed.toFixed(3)} км/с`);

    // ...но НЕ тормозит сверх него: набранное форсажем или тяготением
    // корабль несёт сам. Иначе это был бы тот же гаситель, только
    // односторонний.
    const fast = mk(false);
    fast.vel.z = SHIP.maxSpeed * 2.5; fast.speed = fast.vel.z;
    const was = fast.speed;
    run(fast, 3, null, () => { /* тяга остаётся полной */ });
    fast.throttle = 1;
    run(fast, 3);
    ok(Math.abs(fast.speed - was) < 1e-9,
      `сверх предела не тормозит: было ${was.toFixed(2)}, стало ${fast.speed.toFixed(2)}`);
  }

  // 5. Автоматика гасители ВКЛЮЧАЕТ. Докинг-компьютер и посадочный
  //    задают вектор скорости напрямую и держаться на нём могут только
  //    пока занос подбирают маневровые.
  {
    const sh = mk(false);
    sh.docking = { station: null, phase: 'gate' };
    updateShip(sh, STEP, null);
    ok(sh.damp === true, 'докинг-компьютер включает гасители сам');

    const sh2 = mk(false);
    sh2.landing = { phase: 'descend' };
    updateShip(sh2, STEP, null);
    ok(sh2.damp === true, 'посадочный — тоже');
  }

  // 6. Постановка корабля в точку (вылет, рестарт) возвращает гасители:
  //    и то и другое — начало полёта, а не его продолжение.
  {
    const sh = mk(false);
    placeShip(sh, v3(1, 2, 3), makeBasis());
    ok(sh.damp === true, 'вылет и рестарт возвращают гасители');
  }
}

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

  // Шаг: поверхность и воздух доходят до синтеза как есть; бегом громче
  // шага, приземление громче бега и ниже (heavy).
  {
    const a = makeAudio(31);
    const got = [];
    const fake = { ok: true, engine() {}, drive() {}, thrust() {}, ambient() {}, step: (...x) => got.push(x) };
    audioCue(a, 'step', { surface: 'grass', air: 0.4 });
    audioCue(a, 'step', { surface: 'metal', run: true });
    audioCue(a, 'step', { surface: 'ground', land: 5 });
    playAudio(a, fake);
    ok(got.length === 3 && got[0][0] === 'grass' && got[0][2] === 0.4 && got[1][2] === 1
      && got[0][1] < got[1][1] && got[1][1] < got[2][1] && got[2][3] === 1 && got[0][3] === 0,
      `шаги в синтез: ${got.map((x) => `${x[0]} ${x[1].toFixed(2)}`).join(', ')} — бег громче шага, приземление громче бега`);
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
      if (name === 'freq' && typeof x === 'number') (calls.freqs || (calls.freqs = [])).push(x);
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

    // Шаги: у каждой поверхности свои слои; в пустоте верха срезаны
    // (звук идёт только через скафандр), но шаг не пропадает.
    {
      const five = (d) => [1, 2, 3, 4, 5].map((i) => fakeBuf(d + i * 0.01));
      s.buf.stepHard = five(0.1); s.buf.stepPlate = five(0.55); s.buf.stepGrass = five(0.7);
      s.buf.stepSnow = five(0.37); s.buf.stepGravel = fakeBuf(0.704);
      calls.bad.length = 0;
      const layers = {}, tops = {};
      for (const surface of ['metal', 'ground', 'grass', 'snow']) {
        for (const air of [1, 0]) {
          s.live = 0;
          const n0 = calls.node.bufsrc || 0;
          calls.freqs = [];
          s.step(surface, 0.5, air, 0);
          if (air === 1) layers[surface] = (calls.node.bufsrc || 0) - n0;
          tops[surface + air] = Math.max(...calls.freqs);
        }
      }
      const picks = new Set();
      for (let i = 0; i < 12; i++) { picks.add(s._any('stepHard')); }
      let repeat = 0, last = null;
      for (let i = 0; i < 40; i++) { const b = s._any('stepGrass'); if (b === last) repeat++; last = b; }
      ok(layers.metal === 2 && layers.ground === 2 && layers.grass === 2 && layers.snow === 1 && calls.bad.length === 0
        && ['metal', 'ground', 'grass', 'snow'].every((x) => tops[x + '0'] <= 400 && tops[x + '1'] > 1000)
        && picks.size > 2 && repeat === 0,
        `шаги на записях: палуба — ${layers.metal} слоя (подошва и плита), грунт — ${layers.ground} (подошва и хруст ` +
        `гравия), трава — ${layers.grass}, снег — ${layers.snow}; в пустоте фильтр срезает всё выше ` +
        `${Math.round(tops.metal0)} Гц (при воздухе — до ${Math.round(tops.metal1)}); один дубль дважды подряд — ни разу`);
    }
    s.sampled = false;
    calls.bad.length = 0;
    s.live = 0;
    for (const surface of ['metal', 'ground', 'grass', 'snow']) s.step(surface, 0.5, 0.6, 0.3);
    ok(calls.bad.length === 0 && s.live > 0, `шаги синтезом (без файлов) собираются без ошибок: голосов ${s.live}`);
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
  // Города — тоже объекты карты: к ним летят и на них садятся, и не
  // показать их значило бы, что город есть только в прицеле.
  const cityCount = world.cities.length;
  ok(plain.length === 1 + world.planets.length + world.stations.length
       + moonCount + cityCount &&
     withMarks.length === plain.length + 6 &&
     cityCount > 0 && plain.filter((o) => o.isCity).length === cityCount,
    `в списке карты ${plain.length} объектов (городов ${cityCount}), ` +
    `с маркерами выбранного тела — ${withMarks.length}`);

  {
    // Город на карте виден не всегда, и это правильно: пока планета сама
    // размером в точку, город был бы её утолщением. Зато выбрать его
    // можно всегда — и тогда карта показывает его ВМЕСТЕ с телом, а не
    // прыгает в масштаб двух километров, где нет ничего, кроме него.
    const city = world.cities[0];
    const m = makeMap();
    m.vw = 800; m.vh = 600; m.vx = 0; m.vy = 0;
    resetMap(m, world);
    // Масштаб карта считает при отрисовке: «вся система в кадре» на
    // множитель приближения.
    const scaleOf = () => fitScale(m, world) * m.zoom;
    const wide = city.body.radius * scaleOf();
    focusOn(m, world, city);
    const near = city.body.radius * scaleOf();
    ok(wide < 5 && near > 20 && near < Math.min(m.vw, m.vh) &&
       glyphRadius(city, m) === 4,
      `город на карте: на общем виде диск планеты ${wide.toFixed(1)} px (город скрыт), ` +
      `после выбора — ${near.toFixed(0)} px, значок 4 px`);
  }

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
// Корабль в шестьдесят семь метров и 1682 тонны вертелся как истребитель:
// 49° в секунду по тангажу и 92° по крену, с выходом на предел за 0.7 с
// и без всякой задержки между рукой и поворотом. Теперь:
//
//   * предел вращения — из РАЗМЕРА: оконечности корпуса не должны
//     испытывать больше SHIP.tipAccel (полграмма) центростремительного
//     ускорения, ω = √(a/r);
//   * момент маневровых один на все оси, разгон — из момента инерции;
//   * маневровые выходят на тягу с задержкой (SHIP.rcsLag), и регулятор
//     угловой скорости настроен на неё: без перелёта и без раскачки.
console.log('\n== масса в развороте ==');
{
  const S = 1 / 60;
  const DEG = 57.2957795;
  const spin = (axis, rate, dt = S, hold = 12) => {
    const sh = makeShip();
    sh.control[axis] = 1;
    let t = 0, t95 = 0, t10 = 0, ang = 0, t180 = 0, peak = 0, at01 = null;
    for (let i = 0; i < Math.round(hold / dt); i++) {
      updateShip(sh, dt);
      t += dt;
      const w = Math.abs(sh.rot[axis]);
      ang += w * dt;
      peak = Math.max(peak, w);
      if (at01 === null && t >= 0.1 - 1e-9) at01 = w;
      if (!t10 && w >= rate * 0.1) t10 = t;
      if (!t95 && w >= rate * 0.95) t95 = t;
      if (!t180 && ang >= Math.PI) t180 = t;
    }
    const w0 = Math.abs(sh.rot[axis]);
    sh.control[axis] = 0;
    let stop = 0, drift = 0;
    for (let i = 0; i < Math.round(8 / dt); i++) {
      updateShip(sh, dt);
      stop += dt;
      drift += Math.abs(sh.rot[axis]) * dt;
      if (Math.abs(sh.rot[axis]) < rate * 0.05) break;
    }
    return { t95, t10, t180, peak, at01, stop, drift, w0, sh };
  };

  const p = spin('pitch', SHIP.pitchRate);
  const y = spin('yaw', SHIP.yawRate);
  const r = spin('roll', SHIP.rollRate);

  // Предел — из размера: на концах корпуса ровно tipAccel.
  {
    const tip = (w, arm) => w * w * arm * 1000;          // м/с²
    const ap = tip(SHIP.pitchRate, TIP_ARM.pitch), ay = tip(SHIP.yawRate, TIP_ARM.yaw);
    const ar = tip(SHIP.rollRate, TIP_ARM.roll);
    ok([ap, ay, ar].every((v) => Math.abs(v - SHIP.tipAccel) < 1e-9) && SHIP.rollRate < 0.5,
      `предел вращения из размера корпуса: тангаж ${(SHIP.pitchRate * DEG).toFixed(1)}°/с, ` +
      `рыскание ${(SHIP.yawRate * DEG).toFixed(1)}°/с, крен ${(SHIP.rollRate * DEG).toFixed(1)}°/с — ` +
      `на носу, корме и концах крыльев по ${SHIP.tipAccel} м/с² (было 9 g на концах крыльев в крене)`);
  }

  // Момент один на все оси: он же и есть «маневровые такой-то силы».
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

  // ЗАДЕРЖКА: нажал — корабль трогается не сразу. Через десятую долю
  // секунды крен набрал доли процента предела, заметным (10%) он
  // становится через полсекунды.
  ok(r.at01 < SHIP.rollRate * 0.03 && r.t10 > 0.3 && r.t10 < 0.9,
    `задержка между рукой и поворотом: через 0.1 с крен ${(r.at01 / SHIP.rollRate * 100).toFixed(1)}% ` +
    `предела, 10% — через ${r.t10.toFixed(2)} с (маневровые выходят на тягу за ${SHIP.rcsLag} с)`);

  // Без перелёта: скорость подходит к заданной и не проскакивает её.
  ok(Math.max(p.peak / SHIP.pitchRate, y.peak / SHIP.yawRate, r.peak / SHIP.rollRate) < 1.01,
    `без перелёта: наибольшая угловая скорость — ${(r.peak / SHIP.rollRate * 100).toFixed(1)}% ` +
    'предела по крену');

  // ИНЕРЦИЯ: отпустил ручку — корабль ещё доворачивает, пока маневровые
  // гасят вращение, и останов стоит почти столько же, сколько разгон.
  ok(Math.abs(r.stop - r.t95) < 0.35 && Math.abs(p.stop - p.t95) < 0.35 && r.drift * DEG > 10,
    `инерция: после отпущенной ручки крен гаснет ${r.stop.toFixed(2)} с (разгон ${r.t95.toFixed(2)} с), ` +
    `доворачивая ещё ${(r.drift * DEG).toFixed(0)}°`);

  // Калибровочная таблица: по ней видно поведение целиком.
  ok(r.t180 > 6 && r.t180 < 14 && p.t180 > 6 && y.t180 > p.t180,
    `разворот на 180°: тангаж ${p.t180.toFixed(1)} с, рыскание ${y.t180.toFixed(1)} с, ` +
    `крен ${r.t180.toFixed(1)} с`);

  // От частоты кадров не зависит: на 12 и 240 Гц за ту же секунду — то же.
  {
    const at = (dt) => { const q = spin('roll', SHIP.rollRate, dt, 1.5); return q.w0; };
    const slow = at(1 / 12), fast = at(1 / 240);
    ok(Math.abs(slow - fast) / fast < 0.03,
      `разгон не зависит от частоты кадров: ${(slow * DEG).toFixed(2)}°/с при 12 Гц против ` +
      `${(fast * DEG).toFixed(2)}°/с при 240 Гц за 1.5 с`);
  }

  // Маневровые видно и слышно ровно тогда, когда приложен момент: на
  // раскрутке и на остановке. Ровное вращение в пустоте не стоит ничего.
  {
    const sh = makeShip();
    sh.control.roll = 1;
    let onSpin = 0, onHold = 0;
    for (let i = 0; i < 600; i++) {
      updateShip(sh, S);
      if (i >= 10 && i < 40) onSpin += sh.rcs.roll !== 0 ? 1 : 0;
      else if (i >= 420) onHold += sh.rcs.roll !== 0 ? 1 : 0;
    }
    sh.control.roll = 0;
    let onStop = 0, sign = 0;
    for (let i = 0; i < 90; i++) {
      updateShip(sh, S);
      if (sh.rcs.roll !== 0) { onStop++; sign = sh.rcs.roll; }
    }
    ok(onSpin === 30 && onHold === 0 && onStop > 30 && sign === -1,
      `сопла работают на раскрутке (${onSpin} кадров из 30) и на остановке (${onStop}, ` +
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
    // Поле в поле: от середины (как рисует сцена) — те же камни, только
    // числа малы, и float32 их не огрубляет (js/gl/rocks.js).
    {
      const c = rocks[0].dir;
      const loc = buildRockGeometry(moon, rocks.slice(0, 40), null, null, c);
      let worst = 0, big = 0;
      for (let i = 0; i < geo.faces * 9; i++) {   // заполнено столько: тени без солнца нет
        worst = Math.max(worst, Math.abs(loc.positions[i] + loc.origin[i % 3] - geo.positions[i]));
        big = Math.max(big, Math.abs(loc.positions[i]));
      }
      ok(worst <= 1.2e-7 && big < 1e-3 && geo.origin.every((v) => v === 0),
        `камни от середины поля — те же камни (расхождение ${(worst * moon.radius * 1e6).toFixed(0)} мм — ` +
        `шаг float32 прежних чисел), а вершины в ${(big * moon.radius * 1000).toFixed(0)} м от начала, не в радиусе тела`);
    }
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

// --- 16b. Струя движков у грунта ----------------------------------------------
//
// Деревья гнёт и пыль поднимает одна и та же струя (js/game/downwash.js).
// Проверяется, что она следует из законов турбулентных струй и из самого
// корабля, а не из подобранных чисел: масса — из объёма корпуса, тяга на
// зависании — ровно вес, две формулы струи стыкуются без скачка.
console.log('\n== струя движков у грунта ==');
{
  const w = makeSystem(0x1a7e);
  const lave = w.planets.find((b) => b.kind === 'ocean');
  const bboxM3 = HULL_SIZE.x * HULL_SIZE.y * HULL_SIZE.z * 1e9;
  ok(HULL_VOLUME_M3 > bboxM3 * 0.05 && HULL_VOLUME_M3 < bboxM3 * 0.6 &&
     Math.abs(SHIP_MASS - HULL_VOLUME_M3 * WASH.density) < 1e-6,
    `масса из объёма корпуса: ${HULL_VOLUME_M3.toFixed(0)} м³ ` +
    `(${(HULL_VOLUME_M3 / bboxM3 * 100).toFixed(0)}% габаритного ящика) × ${WASH.density} кг/м³ ` +
    `= ${(SHIP_MASS / 1000).toFixed(0)} т`);

  // На зависании подъёмные держат ровно вес — это и есть их доля хода.
  const hover = 1 / SHIP.liftTWR;
  const T = liftThrust(lave, hover);
  ok(Math.abs(T - SHIP_MASS * lave.g0) < 1e-6 * T,
    `на зависании тяга подъёмных — ровно вес: ${(T / 1e6).toFixed(1)} МН ` +
    `при ${lave.g0.toFixed(2)} м/с²`);

  // Две формулы струи — свободная и настильная — сходятся там, где
  // расширившаяся струя ложится на грунт; дальше напор падает как 1/r².
  const h = 51;
  const rJoin = h * WASH.wallK / WASH.jetK;
  const qAxis = groundQ(T, h, 0), qJoin = groundQ(T, h, rJoin * 1.0001);
  const q100 = groundQ(T, h, 100), q200 = groundQ(T, h, 200);
  ok(Math.abs(qJoin - qAxis) < qAxis * 1e-3 && Math.abs(q100 / q200 - 4) < 1e-9,
    `свободная и настильная струи стыкуются на ${rJoin.toFixed(1)} м без скачка, ` +
    `дальше напор ~1/r²: с ${h} м ветер ${windOf(q100, 1.225).toFixed(0)} м/с на 100 м ` +
    `и ${windOf(q200, 1.225).toFixed(0)} м/с на 200 м`);

  // Растение: наклон растёт с напором, но не за предел; дерево держит
  // ветер лучше травы.
  const at = (u, hm) => bendAngle(0.5 * 1.225 * u * u, hm) * 180 / Math.PI;
  const tree20 = at(20, 15), grass20 = at(20, 0.5), tree60 = at(60, 15), tree5 = at(5, 15);
  ok(tree5 < tree20 && tree20 < tree60 && tree60 <= BEND.tree.cap + 1e-9 &&
     grass20 > tree20 * 3 && tree20 > 6 && tree20 < BEND.tree.ref + 1e-9,
    `отклик растения: дерево ${tree5.toFixed(1)}° при 5 м/с, ${tree20.toFixed(1)}° при 20, ` +
    `${tree60.toFixed(1)}° при 60 (предел ${BEND.tree.cap}°); трава при 20 м/с — ${grass20.toFixed(0)}°`);

  // Состояние струи в кадре: висящий корабль бьёт в грунт под собой, и
  // напор в точке — тот же, что даёт формула.
  const dir = normalize(v3(0.3, 0.5, 0.81));
  const sh = makeShip();
  const pos = worldPoint(lave, dir, groundRadius(lave, dir) + h / 1000, v3());
  const up = normalize(v3(pos.x - lave.pos.x, pos.y - lave.pos.y, pos.z - lave.pos.z));
  const bs = makeBasis();
  lookAlong(bs, normalize(cross(up, v3(0, 0, 1), v3())), up);
  placeShip(sh, pos, bs);
  const g = { ship: sh, world: w, zone: landingContext(w, sh) };
  const ws = washState(g);
  // Точка в сотне метров от удара по касательной.
  const tan = normalize(cross(ws.up, v3(1, 0, 0), v3()));
  const pt = v3(ws.hit.x + tan.x * 0.1, ws.hit.y + tan.y * 0.1, ws.hit.z + tan.z * 0.1);
  const pdir = v3();
  const qa = washAt(ws, pt, pdir);
  const along = (pdir.x * tan.x + pdir.y * tan.y + pdir.z * tan.z);
  ok(ws.on && Math.abs(ws.h - h) < 0.5 && Math.abs(qa - groundQ(ws.T, ws.h, 100)) < qa * 0.01 &&
     along > 0.99 && washAir(lave) > 1,
    `висящий корабль бьёт в грунт под собой: струя ${ws.h.toFixed(1)} м, напор в 100 м ` +
    `${qa.toFixed(0)} Па и дует ОТ точки удара`);

  // Сели на шасси и заглушили — струи нет, а ветки успокаиваются.
  sh.gear.out = true;
  const still = washState(g);
  ok(engineLoad(sh).lift === 0 && still.T === 0 && washAt(still, pt) === 0,
    'на шасси с заглушёнными движками струи нет');
}

// --- 16c. Пыль в воздухе ------------------------------------------------------
//
// На теле с воздухом пыль не баллистическая: её несёт настильная струя,
// и кольцо набирается там, где ветер у грунта падает ниже порога срыва.
console.log('\n== пыль в воздухе ==');
{
  const w = makeSystem(0x1a7e);
  const lave = w.planets.find((b) => b.kind === 'ocean');
  const run = (alt, secs) => {
    // Суша, а не море: ищется точка, где грунт выше уровня воды.
    let dir = null;
    for (let i = 0; i < 4000 && !dir; i++) {
      const u = -0.5 + (i / 3999), a = i * 2.399963, s2 = Math.sqrt(1 - u * u);
      const d = v3(s2 * Math.cos(a), u, s2 * Math.sin(a));
      if (groundRadius(lave, d) - lave.radius > 0.05) dir = d;
    }
    const sh = makeShip();
    const pos = worldPoint(lave, dir, groundRadius(lave, dir) + alt, v3());
    const up = normalize(v3(pos.x - lave.pos.x, pos.y - lave.pos.y, pos.z - lave.pos.z));
    const bs = makeBasis();
    lookAlong(bs, normalize(cross(up, v3(0, 0, 1), v3())), up);
    placeShip(sh, pos, bs);
    const g = { ship: sh, world: w, zone: landingContext(w, sh) };
    const d = makeDust();
    for (let i = 0; i < Math.round(secs / STEP); i++) updateDust(d, g, STEP);
    const ws = washState(g);
    const r = d.list.map((q) => {
      const ex = q.x - ws.hit.x, ey = q.y - ws.hit.y, ez = q.z - ws.hit.z;
      const e = ex * ws.up.x + ey * ws.up.y + ez * ws.up.z;
      return Math.hypot(ex - ws.up.x * e, ey - ws.up.y * e, ez - ws.up.z * e) * 1000;
    }).sort((a, b) => a - b);
    return { d, ws, r };
  };
  const a = run(0.051, 4);
  const S = Math.sqrt(a.ws.T / washAir(lave));
  const ringM = WASH.wallK * S / DUST.airThreshold;
  const med = a.r[Math.floor(a.r.length / 2)] || 0;
  ok(a.d.air && a.d.list.length > 40 && Math.abs(a.d.ring * 1000 - ringM) < 1 &&
     med > ringM * 0.55 && a.r[a.r.length - 1] < ringM * 1.6,
    `с 51 м струя метёт грунт кольцом: срыв до ${ringM.toFixed(0)} м (там ветер падает ` +
    `до ${DUST.airThreshold} м/с), половина пыли дальше ${med.toFixed(0)} м, ` +
    `${a.d.list.length} облаков`);

  // Высоко — струя доходит до грунта слабее порога, и пыли нет.
  const hMax = WASH.jetK * S / DUST.airThreshold / 1000;
  const b = run(hMax * 1.15, 2);
  ok(b.d.list.length === 0,
    `выше ${(hMax * 1000).toFixed(0)} м ветер на оси у грунта слабее порога — пыли нет ` +
    '(высота выводится из тяги, а не задана)');
}

// --- 16d. Камера из-за спины ------------------------------------------------------
//
// Великана снимают снизу, тяжёлое не дёргается (js/game/chase.js).
// Проверяется, где камера стоит в полёте и у земли, что её не пускает в
// грунт и в дома и сколько она запаздывает.
console.log('\n== камера из-за спины ==');
{
  const w = makeSystem(0x1a7e);
  const lave = w.planets.find((b) => b.kind === 'ocean');
  const cam = new Camera();
  cam.resize(1600, 900);
  const dir = normalize(v3(0.3, 0.5, 0.81));
  const sh = makeShip();
  const g = {
    ship: sh, world: w, zone: null, state: { mode: 'flight' },
    camOrbit: { yaw: 0, pitch: 0 }, quantum: null, warp: null,
  };
  const put = (alt) => {
    const pos = worldPoint(lave, dir, groundRadius(lave, dir) + alt, v3());
    const up = normalize(v3(pos.x - lave.pos.x, pos.y - lave.pos.y, pos.z - lave.pos.z));
    const bs = makeBasis();
    lookAlong(bs, normalize(cross(up, v3(0, 0, 1), v3())), up);
    placeShip(sh, pos, bs);
    sh.vel.x = sh.vel.y = sh.vel.z = 0;
    g.zone = landingContext(w, sh);
  };
  const c = makeChase();
  const settle = (secs) => {
    for (let i = 0; i < Math.round(secs / STEP); i++) {
      updateChase(c, g, STEP);
      placeChase(c, g, cam);
    }
  };
  const rel = () => {
    const b = sh.basis;
    const dx = cam.pos.x - sh.pos.x, dy = cam.pos.y - sh.pos.y, dz = cam.pos.z - sh.pos.z;
    return {
      back: -(dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z) * 1000,
      up: (dx * b.up.x + dy * b.up.y + dz * b.up.z) * 1000,
    };
  };

  // Высоко — прежний вынос: над крышей и позади.
  put(2);
  settle(2);
  const hi = rel();
  ok(Math.abs(hi.back - CHASE.back * 1000) < 0.5 && Math.abs(hi.up - CHASE.up * 1000) < 0.5 && !c.below,
    `в полёте камера над крышей: ${hi.back.toFixed(1)} м позади, ${hi.up.toFixed(1)} м выше центра`);

  // Два порога: спускаясь, под брюхо она уходит ниже lowIn; поднимаясь —
  // возвращается выше lowOut. На одной и той же высоте между ними она там,
  // откуда пришла, — и никогда не стоит вровень с корпусом.
  const mid = (CHASE.lowIn + CHASE.lowOut) / 2;
  put(mid); settle(0.2);
  const downMid = c.below;
  put(CHASE.lowIn * 0.8); settle(0.2);
  const downLow = c.below;
  put(mid); settle(3);
  const upMid = c.below, upMidRel = rel();
  put(CHASE.lowOut * 1.2); settle(0.2);
  ok(!downMid && downLow && upMid && !c.below && upMidRel.up < CHASE_UNDER * 1000 + 0.5,
    `под брюхо — ниже ${CHASE.lowIn * 1000} м, наверх — выше ${CHASE.lowOut * 1000} м; ` +
    `на ${(mid * 1000).toFixed(0)} м камера там, откуда пришла, и не на уровне корпуса ` +
    `(${upMidRel.up.toFixed(1)} м от центра)`);

  // У земли — под брюхом: ниже днища корпуса, а корабль нависает над ней.
  put(0.051); settle(3);
  const lo = rel();
  ok(c.below && c.low === 1 && Math.abs(lo.up - CHASE_UNDER * 1000) < 0.5 &&
     lo.up < -HULL_FLOOR * 1000 && Math.abs(lo.back - CHASE.back * CHASE.lowK * 1000) < 0.5,
    `с 51 м камера под брюхом: ${(-lo.up).toFixed(1)} м ниже центра (днище — ` +
    `${(HULL_FLOOR * 1000).toFixed(1)} м), ${lo.back.toFixed(0)} м позади`);

  // Перелёт под корпус — движение крана, а не прыжок.
  {
    const c2 = makeChase();
    put(0.5);
    for (let i = 0; i < 30; i++) updateChase(c2, g, STEP);
    put(0.051);
    let steps = 0;
    while (c2.low < 1 && steps < 1000) { updateChase(c2, g, STEP); steps++; }
    ok(Math.abs(steps * STEP - CHASE.swing) < 0.05,
      `под корпус камера перелетает за ${(steps * STEP).toFixed(2)} с (${CHASE.swing} с), а не за кадр`);
  }

  // Пол: на шасси камера стоит на высоте, ниже которой ближняя плоскость
  // срезала бы землю у нижнего края кадра.
  put(0.0136);
  settle(2);
  const eye = eyeHeight(cam);
  const camAlt = Math.hypot(cam.pos.x - lave.pos.x, cam.pos.y - lave.pos.y, cam.pos.z - lave.pos.z)
    - groundRadius(lave, localDir(lave, cam.pos, v3()));
  // Земля на нижнем краю кадра — на глубине eye / tan(fov/2).
  const depth = eye / Math.tan(cam.fov / 2);
  ok(c.lift > 0 && camAlt >= eye - 1e-6 && camAlt < eye + 0.002 && depth >= cam.near * 1.4,
    `у самой земли камера на ${(camAlt * 1000).toFixed(1)} м: ниже ближняя плоскость ` +
    `(${cam.near * 1000} м) срезала бы грунт у края кадра — там он на ${(depth * 1000).toFixed(1)} м`);

  // Вес: камера догоняет нос за то же время, за какое корабль
  // раскручивается по тангажу, — но не дольше 0.8 с: тяжёлый корабль
  // раскручивается 1.3 с, и камера с таким отставанием теряла бы его в
  // ровном развороте к краю кадра.
  const r = chaseRates();
  const ramp = Math.min(SHIP.pitchRate / SHIP.pitchAccel, 0.8);
  {
    const c3 = makeChase();
    put(2);
    updateChase(c3, g, STEP);
    // Ступенька: нос резко уводится на 20°, меряем, за сколько камера
    // пройдёт 63% пути.
    const b = sh.basis;
    const f0 = v3(b.fwd.x, b.fwd.y, b.fwd.z);
    const ax = b.up;
    const ang = 20 * Math.PI / 180;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const f1 = v3(
      f0.x * cs + (ax.y * f0.z - ax.z * f0.y) * sn,
      f0.y * cs + (ax.z * f0.x - ax.x * f0.z) * sn,
      f0.z * cs + (ax.x * f0.y - ax.y * f0.x) * sn);
    lookAlong(b, f1, ax);
    let t = 0;
    const angle = () => Math.acos(Math.min(1, dot(c3.fwd, f1)));
    while (angle() > ang * Math.exp(-1) && t < 3) { updateChase(c3, g, STEP); t += STEP; }
    ok(Math.abs(1 / r.turn - ramp) < 1e-9 && Math.abs(r.roll * 2 - r.turn) < 1e-9 &&
       Math.abs(t - ramp) < 0.03,
      `камера догоняет нос за ${t.toFixed(2)} с — столько же, сколько корабль раскручивается по ` +
      `тангажу (${(SHIP.pitchRate / SHIP.pitchAccel).toFixed(2)} с), но не дольше 0.8 с; крен вдвое медленнее`);
  }

  // Дрожь — от двигателей: заглушённый корабль на шасси неподвижен,
  // висящий у земли — дрожит, и не больше полуградуса.
  {
    const c4 = makeChase();
    put(0.02);
    sh.gear.out = true; sh.throttle = 0; sh.control.lift = 0;
    for (let i = 0; i < 120; i++) updateChase(c4, g, STEP);
    const calm = c4.shake;
    sh.gear.out = false;
    for (let i = 0; i < 120; i++) updateChase(c4, g, STEP);
    const hum = c4.shake;
    ok(calm < 1e-3 && hum > 0.25 && CHASE.shake * hum < 0.5 * Math.PI / 180,
      `дрожь от движков: на шасси ${calm.toFixed(3)}, в зависании у земли ${hum.toFixed(2)} ` +
      `(${(CHASE.shake * hum * 180 / Math.PI).toFixed(2)}°)`);
  }

  // Дома: камера у площадки не оказывается внутри постройки ни при
  // каком развороте корабля.
  {
    const city = w.cities[0];
    const cb = city.body;
    const g2 = { ...g, zone: null };
    let blocked = 0, pulled = 0;
    const c5 = makeChase();
    for (const pad of city.plan.pads.slice(0, 3)) {
      for (let k = 0; k < 12; k++) {
        const pos = cityWorld(city, pad.x, 0.02, pad.z);
        const up = normalize(v3(pos.x - cb.pos.x, pos.y - cb.pos.y, pos.z - cb.pos.z));
        const a2 = k / 12 * Math.PI * 2;
        const bf = city.basis.fwd, br = city.basis.right;
        const fw = normalize(v3(bf.x * Math.cos(a2) + br.x * Math.sin(a2),
          bf.y * Math.cos(a2) + br.y * Math.sin(a2), bf.z * Math.cos(a2) + br.z * Math.sin(a2)));
        const bs = makeBasis();
        lookAlong(bs, fw, up);
        placeShip(sh, pos, bs);
        g2.zone = landingContext(w, sh);
        c5.ready = false;
        updateChase(c5, g2, STEP);
        placeChase(c5, g2, cam);
        if (c5.pulled > 0) pulled++;
        const lp = cityLocal(city, cam.pos, v3());
        if (cityBlocked(city.plan, lp.x, lp.y, lp.z, 0)) blocked++;
      }
    }
    ok(blocked === 0,
      `у площадок камера ни разу не в доме (36 разворотов; подтянута к кораблю ${pulled} раз)`);

    // А вот нарочно: корабль кормой к постройке, ровно на выносе камеры
    // от её середины. Без подтягивания камера стояла бы внутри.
    const back = CHASE.back * CHASE.lowK;
    let tried = 0, inside = 0, saved = 0;
    for (const bx of city.plan.boxes) {
      if (tried >= 6) break;
      if (bx.h < 0.012) continue;                 // ниже камеры у земли — не мешает
      const cdir = normalize(v3(bx.x, 0, bx.z));   // от центра города к постройке
      const sx = bx.x - cdir.x * back, sz = bx.z - cdir.z * back;
      if (cityBlocked(city.plan, sx, 0.02, sz, 0.035)) continue;   // сам корабль в доме
      const pos = cityWorld(city, sx, 0.02, sz);
      const up = normalize(v3(pos.x - cb.pos.x, pos.y - cb.pos.y, pos.z - cb.pos.z));
      const bf = city.basis.fwd, br = city.basis.right;
      // Нос — от постройки: камера за кормой смотрит на неё.
      const fw = normalize(v3(-(br.x * cdir.x + bf.x * cdir.z),
        -(br.y * cdir.x + bf.y * cdir.z), -(br.z * cdir.x + bf.z * cdir.z)));
      const bs = makeBasis();
      lookAlong(bs, fw, up);
      placeShip(sh, pos, bs);
      g2.zone = landingContext(w, sh);
      c5.ready = false;
      updateChase(c5, g2, STEP);
      placeChase(c5, g2, cam);
      tried++;
      if (c5.pulled > 0) inside++;
      const lp = cityLocal(city, cam.pos, v3());
      if (!cityBlocked(city.plan, lp.x, lp.y, lp.z, 0)) saved++;
    }
    ok(tried >= 3 && inside === tried && saved === tried,
      `кормой к постройке камера упирается в неё ${inside} раз из ${tried} и каждый раз ` +
      'подтягивается к кораблю, наружу');
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
  const DEG = 57.2957795;
  const FOV = 68 / DEG;
  const W = 1600, H = 900;
  const focal = (H / 2) / Math.tan(FOV / 2);
  // Кадр кокпита: глаз в нуле, взгляд по +z. Экранные координаты.
  const px = (p) => ({ x: W / 2 + focal * p.x / p.z, y: H / 2 - focal * p.y / p.z });

  // Треугольники сетки — для лучей из глаза.
  const trisOf = (mesh, filter = () => true) => {
    const out = [];
    for (const f of mesh.faces) {
      if (!filter(f)) continue;
      for (let t = 1; t + 1 < f.v.length; t++) {
        out.push([mesh.verts[f.v[0]], mesh.verts[f.v[t]], mesh.verts[f.v[t + 1]], f]);
      }
    }
    return out;
  };
  // Луч из глаза: ближайшее пересечение (Мёллер — Трумбор).
  const hit = (tris, d) => {
    let best = Infinity, face = null;
    for (const [a, b, c, f] of tris) {
      const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
      const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
      const px_ = d.y * e2z - d.z * e2y, py_ = d.z * e2x - d.x * e2z, pz_ = d.x * e2y - d.y * e2x;
      const det = e1x * px_ + e1y * py_ + e1z * pz_;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tx = -a.x, ty = -a.y, tz = -a.z;
      const u = (tx * px_ + ty * py_ + tz * pz_) * inv;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
      if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 1e-6 && t < best) { best = t; face = f; }
    }
    return { t: best, face };
  };
  const shell = trisOf(cp.shell);
  const glass = trisOf(cp.glass);
  const fib = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963;
      out.push({ x: r * Math.cos(a), y, z: r * Math.sin(a) });
    }
    return out;
  };

  // Габарит поста — человеческий: он в метрах, и ошибка в тысячу раз
  // (километры игры) видна сразу. Палуба рубки сюда не входит.
  {
    const w = cp.bound.hi.x - cp.bound.lo.x, h = cp.bound.hi.y - cp.bound.lo.y;
    ok(w > 1.8 && w < 2.6 && h > 1.0 && h < 2.1,
      `пост пилота человеческого размера: ${w.toFixed(2)} × ${h.toFixed(2)} м`);
  }

  // Корпус в осях кабины. Стекло фонаря — окно (сквозь стёкла, мимо
  // переплёта, виден мир), всё прочее — стены.
  const hullTris = trisOf(cp.hull);
  const E = cp.eye;
  const model = (q) => ({ x: q.x + E.x, y: q.y + E.y, z: q.z + E.z });
  const firstHit = (d) => {
    const a = hit(shell, d), b = hit(hullTris, d);
    if (a.t <= b.t) return { t: a.t, pod: true, face: a.face };
    return { t: b.t, pod: false, face: b.face };
  };
  const pane = (h, d) => {
    if (h.pod || !h.face || !h.face.glass) return false;
    const q = model({ x: d.x * h.t, y: d.y * h.t, z: d.z * h.t });
    return !hullFrameAt(q, h.face.n);
  };

  // ЧЕСТНОЕ МЕСТО. Глаз — в рубке, под фонарём, а пост целиком внутри
  // корпуса: ни одна его вершина не торчит сквозь обшивку. Раньше глаз
  // стоял в девяти метрах над носом, снаружи корпуса, и своего корабля
  // из кабины не было видно вовсе.
  {
    let out = 0;
    for (const v of cp.shell.verts) {
      const L = Math.hypot(v.x, v.y, v.z);
      if (L < 1e-6) continue;
      const hh = hit(hullTris, { x: v.x / L, y: v.y / L, z: v.z / L });
      if (hh.t < L - 0.002) out++;
    }
    ok(out === 0, `пост пилота целиком под фонарём: из ${cp.shell.verts.length} вершин ` +
      `сквозь обшивку торчит ${out}; глаз — в (${E.x}, ${E.y}, ${E.z}) м от центра корабля`);
  }

  // Нутро корпуса не видно: всякий луч из глаза упирается либо в пост и
  // палубу, либо в стекло фонаря, либо в стену рубки ВЫШЕ палубы. Корпус
  // пуст изнутри, и без палубы, опустив взгляд, пилот видел бы изнанку
  // днища.
  {
    const dirs = fib(1200);
    let leak = 0, viaGlass = 0;
    for (const d of dirs) {
      const h = firstHit(d);
      if (!isFinite(h.t)) { leak++; continue; }
      if (!h.pod && !h.face.glass && d.y * h.t < cp.size.floorY - 0.01) leak++;
      if (!h.pod && h.face.glass) viaGlass++;
    }
    ok(leak === 0, `нутра корпуса из рубки не видно: ${leak} из ${dirs.length} лучей; ` +
      `на стекло фонаря приходится ${(viaGlass / dirs.length * 100).toFixed(0)}% всех направлений`);
  }

  // ОБЗОР: доля кадра, которая смотрит наружу сквозь стекло — мимо поста
  // и переплёта.
  {
    let glassPx = 0, n = 0;
    for (let j = 0; j < 30; j++) {
      for (let i = 0; i < 48; i++) {
        const sx = (i + 0.5) / 48 * W, sy = (j + 0.5) / 30 * H;
        const d = normalize(v3((sx - W / 2) / focal, -(sy - H / 2) / focal, 1));
        if (pane(firstHit(d), d)) glassPx++;
        n++;
      }
    }
    ok(glassPx / n > 0.5, `обзор: сквозь стекло рубки — ${(glassPx / n * 100).toFixed(0)}% кадра`);
  }

  // Прицел чист: в конусе 14° вокруг оси — только стекло, без переплёта.
  // Лобовое стекло потому и задано углами от глаза (BRIDGE): сетка
  // «окнами в рост человека» клала стойку ровно по оси.
  {
    let blocked = 0, rays = 0;
    for (let k = 0; k < 300; k++) {
      const r = Math.sqrt(k / 300) * Math.tan(14 / DEG), a = k * 2.399963;
      const d = normalize(v3(r * Math.cos(a), r * Math.sin(a), 1));
      rays++;
      if (!pane(firstHit(d), d)) blocked++;
    }
    ok(blocked === 0, `прицел чист: в конусе 14° вокруг оси из ${rays} лучей в пост или переплёт не упёрся ни один`);
  }

  // НОС ВИДЕН. Лучи чуть ниже оси проходят стекло — и упираются в свой
  // корпус снаружи: это и есть нос, который пилот обязан видеть.
  {
    let nose = 0, n = 0;
    for (let el = -9; el >= -15; el -= 1) {
      for (let az = -3; az <= 3; az += 1.5) {
        const d = v3(Math.sin(az / DEG) * Math.cos(el / DEG), Math.sin(el / DEG), Math.cos(az / DEG) * Math.cos(el / DEG));
        n++;
        const h = firstHit(d);
        if (!pane(h, d)) continue;
        // Дальше стекла: следующее пересечение с корпусом.
        const o = { x: d.x * (h.t + 0.01), y: d.y * (h.t + 0.01), z: d.z * (h.t + 0.01) };
        let best = Infinity, face = null;
        for (const [a, b, c, f] of hullTris) {
          const sh = (P) => ({ x: P.x - o.x, y: P.y - o.y, z: P.z - o.z });
          const r = hit([[sh(a), sh(b), sh(c), f]], d);
          if (r.t < best) { best = r.t; face = f; }
        }
        if (face && !face.glass) nose++;
      }
    }
    ok(nose / n > 0.8, `нос виден над козырьком: ${nose} из ${n} лучей от −9° до −15° ` +
      `проходят стекло и упираются в свой корпус`);
  }

  // Рама лобового стекла в кадре — по бокам и сверху: кадр обрамлён, как
  // из настоящего фонаря, а не висит в пустоте.
  {
    const frameAt = (sx, sy) => {
      const d = normalize(v3((sx - W / 2) / focal, -(sy - H / 2) / focal, 1));
      const h = firstHit(d);
      return !h.pod && h.face && h.face.glass && !pane(h, d);
    };
    let left = 0, right = 0, top = 0;
    for (let k = 0; k < 16; k++) {
      const y = 140 + k * 28;
      let l = false, r = false;
      for (let x = 0; x < W * 0.2 && !(l && r); x += 6) {
        if (!l && frameAt(x, y)) l = true;
        if (!r && frameAt(W - x, y)) r = true;
      }
      if (l) left++;
      if (r) right++;
      let t = false;
      for (let y2 = 0; y2 < H * 0.16 && !t; y2 += 5) if (frameAt(300 + k * 60, y2)) t = true;
      if (t) top++;
    }
    ok(left >= 12 && right >= 12 && top >= 12,
      `рама лобового стекла в кадре: стойки слева ${left}/16 и справа ${right}/16, верх ${top}/16`);
  }

  // МОНИТОРЫ. Пять на доске и три табло на козырьке; все — целиком в
  // кадре, ничем не заслонены, и мониторы — в ОДИН РЯД И ОДНОГО РАЗМЕРА.
  // Последнее — то, что сломала первая, дуговая доска: крайний монитор
  // выходил вдвое выше среднего и уходил за кромку кадра.
  {
    const scr = cp.screens;
    ok(Object.keys(scr).length === SCREENS.length &&
       SCREENS.every((s) => scr[s.id] && scr[s.id].w > 0 && scr[s.id].h > 0),
      `экранов в кабине ${Object.keys(scr).length}: ` + SCREENS.map((s) => s.id).join(', '));
    const corner = (s, sx, sy) => ({
      x: s.pos.x + s.right.x * sx * s.w / 2 + s.up.x * sy * s.h / 2,
      y: s.pos.y + s.right.y * sx * s.w / 2 + s.up.y * sy * s.h / 2,
      z: s.pos.z + s.right.z * sx * s.w / 2 + s.up.z * sy * s.h / 2,
    });
    // Углы экрана — настоящие (у гнутого табло плоская хорда лежит за
    // ним), чуть внутрь: самый край закрывает рамка, как у любого монитора.
    const inset = (s, k) => s.corners.map((q) => ({
      x: s.pos.x + (q.x - s.pos.x) * k, y: s.pos.y + (q.y - s.pos.y) * k, z: s.pos.z + (q.z - s.pos.z) * k,
    }));
    const bad = [], hidden = [], mirror = [];
    const box = {};
    for (const s of Object.values(scr)) {
      const pts = inset(s, 0.96);
      const P = pts.map(px);
      if (P.some((p) => p.x < 0 || p.x > W || p.y < 0 || p.y > H)) bad.push(s.id);
      // Заслонён ли: луч в угол экрана упирается во что-то ближе самого
      // экрана (экран — тоже грань оболочки, её пропускаем).
      for (const q of pts.concat([s.pos])) {
        const L = Math.hypot(q.x, q.y, q.z);
        const d = { x: q.x / L, y: q.y / L, z: q.z / L };
        const hh = hit(shell.filter((t) => t[3].screen !== s.id), d);
        if (hh.t < L - 0.004) { hidden.push(s.id); break; }
      }
      const c = px(s.pos), r = px(corner(s, 0.8, 0)), u = px(corner(s, 0, 0.8));
      if (!(r.x > c.x + 1) || !(u.y < c.y - 1)) mirror.push(s.id);
      // Длины верхней и нижней кромки: у плоскости, наклонённой к кадру,
      // боковые кромки сходятся, и рамка крайних трапеций шире — меряется
      // сам экран.
      const E = s.corners.map(px);
      box[s.id] = { y0: Math.min(...E.map((p) => p.y)), y1: Math.max(...E.map((p) => p.y)),
        w: Math.hypot(E[1].x - E[0].x, E[1].y - E[0].y), wb: Math.hypot(E[2].x - E[3].x, E[2].y - E[3].y) };
    }
    ok(bad.length === 0 && hidden.length === 0,
      'все экраны целиком в кадре и ничем не заслонены' +
      (bad.length ? `; за кадром: ${bad.join(', ')}` : '') + (hidden.length ? `; заслонены: ${hidden.join(', ')}` : ''));
    ok(mirror.length === 0, 'ни один экран не зеркальный и не перевёрнутый' +
      (mirror.length ? ': ' + mirror.join(', ') : ''));
    const mf = SCREENS.filter((s) => s.kind === 'mfd').map((s) => box[s.id]);
    const top = mf.map((b) => b.y0), bot = mf.map((b) => b.y1), wid = mf.map((b) => b.w);
    const spread = (a) => Math.max(...a) - Math.min(...a);
    ok(spread(top) < 3 && spread(bot) < 3 && spread(wid) / Math.min(...wid) < 0.03 &&
       spread(mf.map((b) => b.wb)) / Math.min(...mf.map((b) => b.wb)) < 0.03,
      `мониторы в один ряд и одного размера: верх ${Math.min(...top).toFixed(0)}–${Math.max(...top).toFixed(0)}, ` +
      `низ ${Math.min(...bot).toFixed(0)}–${Math.max(...bot).toFixed(0)}, ширина ${Math.min(...wid).toFixed(0)}–` +
      `${Math.max(...wid).toFixed(0)} пикселей на кадре ${W}×${H}`);
    // Табло — на кромке козырька, выше мониторов.
    const stripLow = Math.max(...SCREENS.filter((s) => s.kind === 'strip').map((s) => box[s.id].y1));
    ok(stripLow <= Math.min(...top) + 2, `табло над мониторами: низ табло ${stripLow.toFixed(0)}, верх мониторов ${Math.min(...top).toFixed(0)}`);
  }

  // Атлас экранов: всё помещается, ничего не наезжает, высота — степень
  // двойки, и у каждого экрана пропорции его холста — пропорции
  // номинала софта (иначе картинку растянет).
  {
    const d = makeDisplays(cp, { density: 2000, atlasW: 2048, canvas: () => null });
    let overlap = 0;
    for (const a of d.list) {
      for (const b of d.list) {
        if (a === b) continue;
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap++;
      }
    }
    const inside = d.list.every((x) => x.x >= 0 && x.y >= 0 && x.x + x.w <= d.w && x.y + x.h <= d.h);
    const pow2 = (d.h & (d.h - 1)) === 0;
    const aspect = d.list.map((x) => {
      const [nw, nh] = NOMINAL[x.id] || NOMINAL.mfd;
      return Math.abs((x.w / x.h) / (nw / nh) - 1);
    });
    ok(overlap === 0 && inside && pow2 && Math.max(...aspect) < 0.03,
      `атлас экранов ${d.w}×${d.h}: ${d.list.length} холстов без наложений; ` +
      `пропорции холстов сходятся с номиналом софта (худшее ${(Math.max(...aspect) * 100).toFixed(1)}%)`);
    const dm = makeDisplays(cp, { density: 1200, atlasW: 1024, canvas: () => null });
    ok(dm.w === 1024 && dm.h <= 1024, `на телефоне атлас ${dm.w}×${dm.h}`);

    // Координаты экранов в буфере: у каждого экрана — внутри своего места
    // в атласе.
    const arr = cabinArrays(cp.shell, (id) => (d.byId[id] ? d.byId[id].uv : null));
    const STRIDE = 15;
    let off = 0, screensSeen = 0;
    for (let i = 0; i < arr.length; i += STRIDE) {
      if (Math.round(arr[i + 10]) !== CMAT.screen) continue;
      screensSeen++;
      const u = arr[i + 11], v = arr[i + 12];
      const ok1 = d.list.some((x) => u >= x.uv[0] - 1e-6 && u <= x.uv[0] + x.uv[2] + 1e-6 &&
        v >= x.uv[1] - 1e-6 && v <= x.uv[1] + x.uv[3] + 1e-6);
      if (!ok1) off++;
    }
    ok(screensSeen > 0 && off === 0, `экранные вершины (${screensSeen}) смотрят в свои места атласа`);
  }

  // Свет снаружи: планета между кораблём и звездой гасит солнце, в
  // стороне — нет, на краю диска — частично (полутень).
  {
    const star = { pos: { x: 0, y: 0, z: 0 }, radius: 700000 };
    const pl = { pos: { x: 1e8, y: 0, z: 0 }, radius: 6000 };
    const world = { star, bodies: [star, pl] };
    const behind = sunVisibility(world, { x: 1e8 + 20000, y: 0, z: 0 });
    const aside = sunVisibility(world, { x: 1e8 + 20000, y: 30000, z: 0 });
    // Край тени: угловой радиус планеты с 20 000 км — 17.5°, звезды — 0.4°.
    const ab = Math.asin(6000 / 20000);
    const edge = sunVisibility(world, { x: 1e8 + 20000 * Math.cos(ab), y: 20000 * Math.sin(ab), z: 0 });
    ok(behind === 0 && aside === 1 && edge > 0.05 && edge < 0.95,
      `затмение: за планетой солнца ${behind}, в стороне ${aside}, на краю тени ${edge.toFixed(2)}`);
  }

  // Лампы кабины — внутри неё: свет, поставленный снаружи обшивки,
  // светил бы сквозь стену.
  {
    const inside = (p) => p.x >= cp.bound.lo.x && p.x <= cp.bound.hi.x && p.y >= cp.bound.lo.y &&
      p.y <= cp.bound.hi.y && p.z >= cp.bound.lo.z && p.z <= cp.bound.hi.z;
    ok(cp.lights.length >= 5 && cp.lights.every((l) => inside(l.pos) && l.range > 0),
      `ламп в кабине ${cp.lights.length}, все внутри`);
  }

  // Ручка ходит за РУЧКАМИ, а не за угловой скоростью корабля: она в
  // руках у пилота и стоять должна там, куда её отклонили. РУД — за
  // заданной тягой.
  {
    const y = makeYoke();
    const c = { pitch: 1, yaw: 0, roll: -1 };
    for (let i = 0; i < 120; i++) updateYoke(y, c, STEP, 0.5);
    ok(Math.abs(y.pitch - YOKE.pitch) < 1e-3 && Math.abs(y.roll + YOKE.roll) < 1e-3 &&
       Math.abs(y.throttle - YOKE.throttle * 0.5) < 1e-3,
      `ручка доходит до упора: тангаж ${(y.pitch * DEG).toFixed(0)}°, крен ${(y.roll * DEG).toFixed(0)}°; ` +
      `РУД на половине тяги — ${(y.throttle * DEG).toFixed(0)}°`);

    for (let i = 0; i < 120; i++) updateYoke(y, { pitch: 0, yaw: 0, roll: 0 }, STEP, 0);
    ok(Math.abs(y.pitch) < 1e-3 && Math.abs(y.roll) < 1e-3 && Math.abs(y.throttle) < 1e-3,
      'отпущенные ручки возвращают ручку и РУД в нейтраль');

    const run = (dt) => {
      const z = makeYoke();
      for (let i = 0; i < Math.round(1 / dt); i++) updateYoke(z, { pitch: 1 }, dt);
      return z.pitch;
    };
    const slow = run(1 / 12), fast = run(1 / 240);
    ok(Math.abs(slow - fast) < YOKE.pitch * 0.05,
      `ход ручки почти не зависит от частоты кадров: ${(slow * DEG).toFixed(1)}° ` +
      `при 12 Гц против ${(fast * DEG).toFixed(1)}° при 240 Гц`);
    ok(cp.stick.mesh.faces.length > 0 && cp.throttle.mesh.faces.length > 0,
      `ручка (${cp.stick.mesh.faces.length} граней) и РУД (${cp.throttle.mesh.faces.length}) собраны`);
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
    // нажмёт обе. Сравниваются только те, что бывают на экране вместе:
    // набор пилота на ногах (b.walk) стоит на месте полётного и с ним
    // никогда не показывается.
    let worst = Infinity, pair = '';
    for (let i = 0; i < L.buttons.length; i++) {
      for (let j = i + 1; j < L.buttons.length; j++) {
        const a = L.buttons[i], b = L.buttons[j];
        if (!!a.walk !== !!b.walk) continue;
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
    // Потоков два — плиток и дальнего леса (js/gl/forestworker.js), и
    // освежать надо всё, что читает хотя бы один из них.
    const need = [...new Set([...closure('js/gl/tileworker.js'), ...closure('js/gl/forestworker.js')])].sort();
    const got = a.asked.map(([u]) => u).sort();
    ok(got.join() === need.join() && a.asked.every(([, c]) => c === 'reload') && !!a.fresh,
      `файлы потоков сборки берутся мимо кеша (cache: reload), все ${need.length}: ` +
      need.map((f) => f.slice(3)).join(', '));
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

// --- корабль едет вместе с телом на ШАГ МИРА, а не на шаг кадра --------------
//
// ЭТО БЫЛО СЛОМАНО, и ломалось молча. Мир двигался шагом clockStep, а
// корабль переносился шагом кадра — то есть каждый кадр отставал от
// грунта на разницу. Гонит эту разницу не орбита (тела здесь ползут по
// ней сантиметры в секунду), а ВРАЩЕНИЕ: на экваторе грунт идёт под
// две с половиной сотни метров в секунду, и четверти хода, которую
// отыгрывают часы, хватает на метр за кадр. Со стороны это ровное
// дёрганье земли на любой поверхности.
//
// После спящей вкладки то же самое случается разом: часы подводятся
// рывком на десятки секунд, тело проворачивается на километры, а
// корабль остаётся где был.
//
// Проверяется инвариант, а не числа: над какой точкой грунта корабль
// висел, над той и висит. Рядом стоит та же сцена с кадровым шагом —
// она показывает, какой ценой эта ошибка обходилась.
{
  console.log('\n== перенос корабля вместе с телом ==');

  const dt = 1 / 60;
  const seconds = 10;
  const frames = Math.round(seconds / dt);

  // Тело выбираем самое быстрое по вращению: ошибка пропорциональна
  // окружной скорости, и на медленном теле её можно было бы не заметить.
  const pick = (w) => w.planets.reduce((a, b) => (b.spin * b.radius > a.spin * a.radius ? b : a));

  // Корабль висит в трёх километрах над грунтом — там, где перенос
  // компенсирует вращение целиком (SPIN_FULL = 8 км).
  const hover = (body) => {
    const dir = normalize(v3(0.3, 0.5, 0.81));
    const r = groundRadius(body, dir) + 3;
    const ship = makeShip();
    placeShip(ship, v3(
      body.pos.x + dir.x * r, body.pos.y + dir.y * r, body.pos.z + dir.z * r), makeBasis());
    return ship;
  };

  // Один шаг «как в игре»: замерить, куда уехало тело, и перенести
  // корабль на carryDt. Правильно — carryDt === dtWorld.
  const stepWorld = (w, ship, dtWorld, carryDt) => {
    const cap = captureBody(w, ship.pos);
    const wasX = cap.pos.x, wasY = cap.pos.y, wasZ = cap.pos.z;
    updateWorld(w, dtWorld);
    const moved = carryDt === dtWorld
      ? v3(cap.pos.x - wasX, cap.pos.y - wasY, cap.pos.z - wasZ) : null;
    carryShip(ship, cap, carryDt, moved);
  };

  // Насколько корабль сошёл с той точки грунта, над которой висел.
  const runDrift = (dtWorld, carryDt, n) => {
    const w = makeSystem(HOME_SEED);
    const body = pick(w);
    const ship = hover(body);
    const was = localDir(body, ship.pos, v3());
    const altWas = altitudeOf(body, ship.pos).alt;
    for (let i = 0; i < n; i++) stepWorld(w, ship, dtWorld, carryDt);
    const now = localDir(body, ship.pos, v3());
    return {
      body,
      km: Math.hypot(now.x - was.x, now.y - was.y, now.z - was.z) * body.radius,
      alt: Math.abs(altitudeOf(body, ship.pos).alt - altWas),
    };
  };

  // 1. Часы подтягиваются ходом: шаг мира на четверть длиннее кадра.
  {
    const good = runDrift(dt * (1 + CLOCK_RATE), dt * (1 + CLOCK_RATE), frames);
    const surf = good.body.spin * good.body.radius;
    ok(good.km < 0.002 && good.alt < 0.002,
      `${seconds} с ускоренного хода над ${good.body.name} (грунт идёт `
      + `${(surf * 1000).toFixed(0)} м/с): корабль сошёл с точки на `
      + `${(good.km * 1000).toFixed(2)} м`);

    // А так было. Разница — это и есть дёрганье земли.
    const bad = runDrift(dt * (1 + CLOCK_RATE), dt, frames);
    ok(bad.km > 0.5,
      `кадровым шагом за те же ${seconds} с уносит на ${(bad.km * 1000).toFixed(0)} м `
      + `(${(bad.km * 1000 / seconds).toFixed(0)} м/с мимо грунта) — потому шаг и мировой`);
  }

  // 2. Спящая вкладка: часы подводятся рывком (CLOCK_SNAP = 20 с).
  {
    const jump = 60;
    const good = runDrift(jump, jump, 1);
    ok(good.km < 0.01,
      `рывок в ${jump} с: корабль остался над той же точкой `
      + `(${(good.km * 1000).toFixed(1)} м)`);

    const bad = runDrift(jump, dt, 1);
    ok(bad.km > 5,
      `а кадровым шагом тот же рывок оставляет корабль в ${bad.km.toFixed(1)} км `
      + 'от места — ровно то, что видно после возврата во вкладку');
  }

  // 3. И сама сцепка в главном цикле — по исходнику.
  //
  // Проверки выше держат договор carryShip, но не то, ЧТО ему передают.
  // Разница между dt и шагом мира не видна ни в одном числе на экране и
  // не ловится дымовым прогоном: офлайн сервера нет, часы не подводятся,
  // и оба шага совпадают. Один символ в вызове — и ошибка возвращается
  // молча, ровно в том виде, в каком её нашли.
  {
    const src = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    // Имя переменной берётся из самого исходника: важно не как её зовут,
    // а что мир и корабль двигают ОДНИМ И ТЕМ ЖЕ числом.
    const named = /const\s+([A-Za-z_$][\w$]*)\s*=\s*clockStep\(/.exec(src);
    const step = named && named[1];
    const movesWorld = step && new RegExp('updateWorld\\(world,\\s*' + step + '\\)').test(src);
    const movesShip = step
      && new RegExp('carryShip\\(ship,\\s*game\\.capture,\\s*' + step + '\\b').test(src);
    ok(movesWorld && movesShip,
      `в главном цикле мир и корабль двигают одним шагом «${step}»: `
      + `мир ${movesWorld ? 'да' : 'НЕТ'}, корабль ${movesShip ? 'да' : 'НЕТ'}`);
  }
}

// --- место в полёте живёт в осях тела ----------------------------------------
//
// ЭТО БЫЛО СЛОМАНО, и ломалось насмерть. Мир при входе в игру ставится
// на серверное «сейчас» (js/game/clock.js: время общее и идёт без
// игрока), а корабль — туда, где его записали. Между записью и входом
// проходит сколько угодно: минута до обновления страницы, неделя до
// следующего вечера. Всё это время планета вертится, и у Lave IV грунт
// на экваторе идёт 269 м/с.
//
// Отсюда обе жалобы: у самой земли корабль при входе оказывался внутри
// рельефа и погибал, а с двух десятков километров город обнаруживался на
// другой стороне планеты.
//
// Лечится это не подгонкой, а сменой системы отсчёта: место хранится в
// осях тела, как давно хранится стоянка на грунте. Проверяется тем же
// инвариантом, что и перенос: над какой точкой грунта корабль висел, над
// той и появляется — сколько бы времени ни прошло.
{
  console.log('\n== место в полёте живёт в осях тела ==');

  const T0 = 4000;
  const at = (t) => { const w = makeSystem(HOME_SEED); updateWorld(w, t); return w; };
  const w0 = at(T0);
  const city0 = w0.cities[0];

  // Корабль висит над серединой города носом вниз.
  const hover = (w, alt) => {
    const c = w.cities[0];
    const u = c.basis.up;
    const s = makeShip();
    const b = makeBasis();
    lookAlong(b, normalize(v3(-u.x, -u.y, -u.z)));
    placeShip(s, v3(c.pos.x + u.x * alt, c.pos.y + u.y * alt, c.pos.z + u.z * alt), b);
    return s;
  };
  const groundOf = (body, pos) => localDir(body, pos, v3());
  // Отвес в МИРОВЫХ осях: с ним сравнивается нос корабля, а он тоже
  // мировой. Через местные оси такое сравнение врало бы — они за час
  // уезжают вместе с телом.
  const upAt = (body, pos) => normalize(
    v3(pos.x - body.pos.x, pos.y - body.pos.y, pos.z - body.pos.z));
  const apart = (a, b, body) => Math.acos(clamp(dot(a, b), -1, 1)) * body.radius;

  for (const alt of [1, 20]) {
    const ship0 = hover(w0, alt);
    const body0 = captureBody(w0, ship0.pos);
    const rec = shipAnchor(body0, ship0);
    const wasDir = groundOf(body0, ship0.pos);
    const wasAlt = altitudeOf(body0, ship0.pos).alt;
    // Куда смотрит нос относительно грунта — это тоже надо вернуть:
    // иначе после входа горизонт оказывается где угодно.
    const wasNose = dot(upAt(body0, ship0.pos), ship0.basis.fwd);

    // Час без игрока.
    const w1 = at(T0 + 3600);
    const body1 = w1.bodies.find((b) => b.id === rec.id);
    const pose = anchorPose(body1, rec);
    const ship1 = makeShip();
    placeShip(ship1, pose.pos, pose.basis);

    const drift = apart(wasDir, groundOf(body1, ship1.pos), body1);
    const dAlt = Math.abs(altitudeOf(body1, ship1.pos).alt - wasAlt);
    const nose = Math.abs(dot(upAt(body1, ship1.pos), ship1.basis.fwd) - wasNose);
    // А так было: те же мировые координаты через час.
    const old = apart(wasDir, groundOf(body1, ship0.pos), body1);
    const oldAlt = altitudeOf(body1, ship0.pos).alt;

    ok(drift < 0.002 && dAlt < 0.002 && nose < 1e-6,
      `с ${alt} км над городом через час корабль над той же точкой грунта `
      + `(${(drift * 1000).toFixed(1)} м, высота ${(dAlt * 1000).toFixed(1)} м) — `
      + `а по мировым координатам он был бы за ${old.toFixed(0)} км `
      + `на высоте ${oldAlt.toFixed(1)} вместо ${wasAlt.toFixed(1)} км`);

    // И город при входе там же, где был: ради этого всё и делается.
    const city1 = w1.cities[0];
    const toCity = Math.hypot(city1.pos.x - ship1.pos.x,
      city1.pos.y - ship1.pos.y, city1.pos.z - ship1.pos.z);
    const oldToCity = Math.hypot(city1.pos.x - ship0.pos.x,
      city1.pos.y - ship0.pos.y, city1.pos.z - ship0.pos.z);
    ok(Math.abs(toCity - alt) < 0.01 && oldToCity > alt + 100,
      `город остался под кораблём: ${toCity.toFixed(2)} км вместо `
      + `${oldToCity.toFixed(0)} км по-старому`);
  }

  // Запись приходит из чужих рук — из localStorage или от сервера.
  // Кривая не должна ставить корабль никуда: NaN в координатах это
  // чёрный экран, и разбираться в нём пришлось бы уже в браузере.
  {
    const body = w0.bodies.find((b) => b.id === city0.body.id);
    const good = { pos: v3(1, 2, 3), fwd: v3(0, 0, 1), up: v3(0, 1, 0) };
    const bad = [
      null,
      { pos: v3(1, 2, 3) },                                   // нет осей
      { pos: v3(NaN, 0, 0), fwd: v3(0, 0, 1), up: v3(0, 1, 0) },
      { pos: v3(1, 2, 3), fwd: v3(0, 0, 2), up: v3(0, 1, 0) }, // ось не единичная
    ];
    ok(anchorOk(good) && bad.every((r) => !anchorOk(r) && anchorPose(body, r) === null),
      `кривая запись места корабль никуда не ставит: ${bad.length} видов брака`);
  }

  // Порядок в загрузке: место у тела разбирается ПЕРЕД мировыми
  // координатами. Наоборот — и весь этот раздел ничего не значит:
  // корабль встанет по мировым, а якорь никто не спросит.
  {
    const src = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    const byAnchor = src.indexOf('anchorOk(rec.anchor)');
    const byPos = src.indexOf('placeShip(ship, rec.pos');
    ok(byAnchor > 0 && byPos > byAnchor && src.includes('shipAnchor(game.capture'),
      'при входе место у тела спрашивают раньше мировых координат');
  }
}

// --- кто ещё в игре и где ---------------------------------------------------
//
// Сканер отвечает только на вопрос «кто рядом», а мир — семь систем.
// Состав сети приходит с хаба списком {id, name, sys}, а строки для
// панели собирает pilotRows — его и проверяем: порядок, имя системы
// и отметку «здесь». Пиксели панели — глазами.
{
  console.log('\n== список пилотов ==');

  const roster = [
    { id: 7, name: 'ЗАХАР', sys: 3 },
    { id: 1, name: 'Я', sys: 0 },
    { id: 4, name: 'АННА', sys: 0 },
    { id: 9, name: 'ГОСТЬ', sys: null },
    { id: 12, name: 'ЧУЖОЙ', sys: 999 },
  ];
  const rows = pilotRows(roster, 1, 0);

  ok(rows[0].you && rows[0].name === 'Я',
    'себя показываем первым: от этой строки читают остальные');
  ok(rows[1].name === 'АННА' && rows[1].here,
    'сосед по системе выше дальних: ' + rows.map((x) => x.name).join(', '));
  ok(rows.filter((x) => x.here).length === 2 && !rows.find((x) => x.id === 7).here,
    '«здесь» стоит только у своей системы');

  // Имя системы — из галактики, а не номером: «в системе 3» ничего
  // не говорит тому, кто решает, лететь ли туда.
  ok(rows.find((x) => x.id === 7).where === systemById(3).name
    && rows.find((x) => x.id === 1).where === systemById(0).name,
    'система названа именем: '
    + rows.find((x) => x.id === 7).where);

  // Между системами системы нет вовсе — это не ошибка, а прыжок.
  ok(rows.find((x) => x.id === 9).where === 'В ПРЫЖКЕ',
    'пилот без системы показан как ушедший в прыжок');

  // А вот система, которой в галактике нет, — это уже расхождение
  // каталогов игры и сервера, и молчать об этом нельзя.
  ok(rows.find((x) => x.id === 12).where === '#999',
    'незнакомая система показана номером, а не спрятана');

  ok(pilotRows(null).length === 0 && pilotRows([{ id: 5 }])[0].name === '#5',
    'пустой и кривый список панель не роняют');

  // Панель есть только в сети и только по клавише: без сервера показывать
  // в ней нечего, и пустая рамка читается как поломка.
  ok(!pilotsShown({ showPilots: false, link: { mode: 'live' } })
    && pilotsShown({ showPilots: true, link: { mode: 'live' } })
    && pilotsShown({ showPilots: true, link: { mode: 'down' } }),
    'панель слушается клавиши, а не связи: без связи она скажет об этом');

  // Всё, что панель пишет, переведено. Без этой строки новая надпись
  // молча осталась бы русской на английском экране: список пилотов
  // дымовой прогон не открывает — без сервера его нет.
  {
    const need = ['ПИЛОТЫ В СЕТИ', '  В СЕТИ ', 'никого', 'В ПРЫЖКЕ', 'СВЯЗИ НЕТ',
      'кто ещё в игре и в какой он системе'];
    const noEn = need.filter((t) => !hasEn(t));
    ok(noEn.length === 0,
      'надписи списка переведены' + (noEn.length ? ': нет у ' + noEn.join(', ') : ''));
  }
}

// --- справка знает все клавиши ----------------------------------------------
//
// Справку правят реже, чем управление, и она молча отстаёт: фары (O) и
// гасители инерции (T) прожили в игре не один месяц, а на странице
// управления их не было вовсе — про них знал только README. Игрок при
// этом не виноват: единственное место, где он ищет клавиши, — эта
// страница.
//
// Поэтому список здесь не переписан от руки, а СВЕРЯЕТСЯ С КОДОМ: что
// игра читает через pressed/isDown/axis, то и обязано стоять в таблице
// справки. Новая клавиша без строки в справке роняет проверку.
{
  console.log('\n== справка про клавиши ==');

  const root = new URL('../', import.meta.url);
  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      if (e.isDirectory()) walk(dir + e.name + '/');
      else if (e.name.endsWith('.js')) files.push(dir + e.name);
    }
  })('js/');

  // Номер раздела меню склеивается ('Digit' + i), и в исходнике видно
  // только приставку. Сами 1–4 проверяются отдельной строкой ниже.
  const COMPUTED = new Set(['Digit', 'Numpad']);
  // Цифровая клавиатура — дубликат основной клавиши, и отдельной строки
  // в справке ей не нужно: «Numpad0» игроку не говорит ничего, а место
  // в таблице занимает.
  const SAME = { Numpad0: 'Digit0', NumpadEnter: 'Enter', NumpadAdd: 'Equal', NumpadSubtract: 'Minus' };

  const used = new Map();                 // код -> файл, где он читается
  for (const f of files) {
    const src = readFileSync(new URL(f, root), 'utf8');
    for (const call of src.matchAll(/\b(?:pressed|isDown|axis)\(([^)]*)\)/g)) {
      for (const lit of call[1].matchAll(/'([^']+)'/g)) {
        const code = SAME[lit[1]] || lit[1];
        if (!COMPUTED.has(code) && !used.has(code)) used.set(code, f);
      }
    }
  }
  ok(used.size > 30 && used.has('KeyO') && used.has('KeyT'),
    `клавиши игры собраны из исходников: ${used.size} шт.`);

  // Как клавиша без буквы выглядит в таблице. Кода, которого тут нет,
  // быть не должно: новая клавиша обязана попасть и сюда тоже, иначе
  // проверка тихо пропустила бы её.
  const NAMED = {
    Tab: ['Tab'], Space: ['Space'], Enter: ['Enter'], Escape: ['Esc'],
    Backquote: ['~'], Minus: ['-'], Equal: ['='],
    ArrowUp: ['&uarr;'], ArrowDown: ['&darr;'],
    ArrowLeft: ['&larr;'], ArrowRight: ['&rarr;'],
    ShiftLeft: ['Shift'], ShiftRight: ['Shift'],
    ControlLeft: ['Ctrl'], ControlRight: ['Ctrl'],
  };

  const src = readFileSync(new URL('js/ui/screens.js', root), 'utf8');
  const help = src.slice(src.indexOf('export function showHelp'), src.indexOf('// Названия типов тел'));
  const table = help.slice(help.indexOf('<table'), help.indexOf('</table>'));
  ok(table.length > 0 && help.includes("L('УПРАВЛЕНИЕ')"),
    'таблица клавиш найдена в справке');

  // Буквы и цифры берём ТОЛЬКО из первой ячейки строки — из столбца
  // клавиш. Считай мы и описания, любое упоминание буквы в тексте
  // («I или Esc — закрыть») сходило бы за строку таблицы, и выкинутую
  // клавишу проверка бы не заметила.
  const keysOf = (text) => {
    const out = new Set();
    for (const row of text.matchAll(/<tr><td>([\s\S]*?)<\/td>/g)) {
      const cell = row[1].replace(/\$\{L\('/g, '').replace(/'\)\}/g, '');
      for (const m of cell.matchAll(/(?<![A-Za-z])([A-Z])(?![A-Za-z])/g)) out.add('Key' + m[1]);
      for (const m of cell.matchAll(/(?<![0-9])([0-9])(?![0-9])/g)) out.add('Digit' + m[1]);
    }
    return out;
  };
  const keys = keysOf(table);

  const missing = [], unknown = [];
  for (const [code, where] of used) {
    if (/^(Key[A-Z]|Digit[0-9])$/.test(code)) {
      if (!keys.has(code)) missing.push(`${code} (${where})`);
    } else if (!NAMED[code]) {
      unknown.push(`${code} (${where})`);
    } else if (!NAMED[code].some((t) => table.includes(t))) {
      missing.push(`${code} (${where})`);
    }
  }
  ok(unknown.length === 0,
    'каждой клавише известно, как она выглядит в справке'
    + (unknown.length ? ': нечем показать ' + unknown.join(', ') : ''));
  ok(missing.length === 0,
    `все ${used.size} клавиш игры стоят в таблице справки`
    + (missing.length ? ': нет ' + missing.join(', ') : ''));

  ok(table.includes('1–4'),
    'разделы меню (1–4) названы в справке: в коде их номер склеивается, и из него клавиш не видно');

  // Проверка кусается: убери из таблицы строку про фары — и она это
  // скажет. Без этой строки предыдущая сверка молча проходила бы на
  // любой таблице, где буква нашлась хоть где-нибудь.
  // Файлы в дереве с CRLF, поэтому конец строки здесь — \r?\n.
  const cut = table.replace(/ *<tr><td>O<\/td>[\s\S]*?<\/tr>\r?\n/, '');
  ok(cut.length < table.length && !keysOf(cut).has('KeyO'),
    'выкинутая строка справки видна проверке (пробуем на фарах)');

  // Всё, что таблица пишет, переведено. Справку на английском никто не
  // открывает в дымовом прогоне, и русская строка дожила бы до игрока.
  {
    const noEn = [...table.matchAll(/L\('([^']+)'\)/g)].map((m) => m[1]).filter((t) => !hasEn(t));
    ok(noEn.length === 0,
      'вся таблица клавиш переведена' + (noEn.length ? ': нет у ' + noEn.join(' | ') : ''));
  }
}

// --- длинный экран прокручивается -------------------------------------------
//
// Справка выросла до трёх экранов текста, а прокрутить её было нечем:
// игра гасила колесо и клавиши прокрутки на всей странице разом. Панель
// при этом честно умела прокручиваться — ей просто не давали. Ошибка
// незаметная: панель выглядит целой, а продолжения у неё как будто нет.
//
// Проверяем сам разбор события, а не картинку: окно подставляем своё и
// смотрим, что игра делает с колесом над сценой и над длинной панелью.
{
  console.log('\n== прокрутка длинных экранов ==');

  const on = {};
  const fakeWin = { addEventListener: (t, f) => { (on[t] = on[t] || []).push(f); } };
  input.attachMouse(fakeWin);
  input.attach(fakeWin);

  // Цель события: холст сцены или что-то внутри панели. Настоящий DOM
  // отвечает на closest(), этого хватает и здесь.
  const overScene = { closest: () => null };
  const overPanel = (tall) => ({
    closest: (sel) => (sel === '.panel'
      ? { scrollHeight: tall ? 900 : 300, clientHeight: 300 } : null),
  });

  const wheel = (target, dy = 120) => {
    let stopped = false;
    const e = { deltaY: dy, cancelable: true, target, preventDefault: () => { stopped = true; } };
    for (const f of on.wheel) f(e);
    return stopped;
  };
  const key = (code, target) => {
    let stopped = false;
    for (const f of on.keydown) f({ code, target, preventDefault: () => { stopped = true; } });
    return stopped;
  };

  input.takeWheel();
  const tookScene = wheel(overScene);
  ok(tookScene && input.takeWheel() === 120,
    'над сценой колесо забирает игра: им меняют масштаб карты');

  const tookPanel = wheel(overPanel(true));
  ok(!tookPanel && input.takeWheel() === 0,
    'над длинным экраном колесо отдано браузеру — и в счётчик игры не попало');

  // Короткая панель (экран порта) прокручивать нечего, и отдавать ей
  // колесо незачем: под ней карта, и это единственное, чем оно занято.
  ok(wheel(overPanel(false)),
    'короткий экран колесо не забирает');

  ok(key('ArrowDown', overScene) && !key('ArrowDown', overPanel(true)),
    'стрелка в длинном экране прокручивает его, а не глохнет');
  input.releaseAll();

  // Пальцем на телефоне — то же самое, но решает это CSS: у страницы
  // сенсорное поведение выключено целиком (touch-action: none), иначе
  // ломается джойстик, и панели нужно исключение.
  {
    const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
    const panel = css.slice(css.indexOf('.panel {'), css.indexOf('.btn {'));
    ok(/touch-action:\s*pan-y/.test(panel) && /overflow-y:\s*auto/.test(panel),
      'панель разрешено тянуть пальцем: у страницы прокрутка выключена целиком');
  }

  // И справка обязана открываться с начала: панель одна на все экраны,
  // её прокрутка от прошлого открытия сама не сбрасывается.
  {
    const src = readFileSync(new URL('../js/ui/screens.js', import.meta.url), 'utf8');
    ok(/p\.scrollTop = 0/.test(src) && /p\.tabIndex = -1/.test(src),
      'экран открывается с начала и может брать фокус для клавиш прокрутки');
  }
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

  let poseNow = { sys: 0, ship: { id: 12, x: 1, y: 2, z: 3, v: 0.4, mode: 'flight',
    fwd: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } } };
  connect(() => poseNow);
  await wait(30);
  ok(sent.length === 1 && sent[0].t === 'hello',
    'первым делом представляемся: ' + (sent[0] ? sent[0].t : '—'));

  live.say({ t: 'welcome', you: { id: 1, name: 'Я' }, tick: 0.2, wt: 500, peers: [] });
  ok(net.state === 'live' && net.tick === 0.2 && net.wt === 500,
    'приветствие принято: шаг сервера и время мира взяты из него');

  // Первый же удар таймера шлёт и положение, и замер задержки.
  await wait(SEND_EVERY + 60);
  const pos = sent.find((m) => m.t === 'pos');
  ok(pos && pos.fx === 0 && pos.fz === 1 && pos.uy === 1 && pos.sid === 12,
    'положение уходит вместе с осанкой и номером корабля');

  // Пилот — отдельно от корабля. Пассажир чужого корабля, оставивший
  // свой в другой системе, не ведёт никакого корабля: в снимке только он.
  {
    const { poseMessage } = await import('../js/net/socket.js');
    const me = { st: 'walk', s: 40, x: 1.5, y: -2.3, z: 10, yaw: 0.5, pitch: 0, v: 1.9, air: 0 };
    const rider = poseMessage({ sys: 3, ship: null, me });
    const host = poseMessage({ sys: 0, me: { st: 'seat', s: 12, x: 0, y: 0, z: 0 }, ship: {
      id: 12, x: 1e5, y: 2, z: 3, v: 0, mode: 'landed', fwd: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 },
      gear: true, hatches: ['nL'], lift: 0.3,
      local: { b: 3, pos: { x: 0.0123456789, y: 4200.006, z: -1 }, fwd: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } },
    } });
    ok(rider.x === undefined && rider.sid === undefined && rider.me.s === 40 && rider.sys === 3
      && host.b === 3 && host.ly === 4200.006 && host.lx === 0.012346 && host.g === 1
      && host.h[0] === 'nL' && host.me.st === 'seat',
      'пассажир шлёт только себя; хозяин — и корабль, у тела ещё и в осях тела (до мм): b ' + host.b
      + ', ly ' + host.ly);
  }
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

  // 13. Фары — такое же снаряжение: своих чисел в игре нет, а пришедшие
  //     доезжают и переводятся в то, чем считает шейдер.
  {
    const lampMod = doc.modules.find((m) => m.code === 'lamp');
    const src = readFileSync('js/game/lamps.js', 'utf8')
      .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), '')
      .replace(new RegExp('^\\s*//.*$', 'gm'), '');
    const baked = Object.keys(lampMod.spec)
      .filter((k) => new RegExp('(?<![.\\w])' + k + '\\s*:\\s*-?\\d').test(src));
    ok(baked.length === 0,
      'числа фар не вписаны в игру' + (baked.length ? ': ' + baked.join(', ') : ''));
    ok(LAMP.range === lampMod.spec.range && LAMP.power === lampMod.spec.power,
      `дальность фар ${LAMP.range} км — число из бэкенда`);
    ok(Math.abs(LAMP.tilt - (lampMod.spec.tiltDeg * Math.PI) / 180) < 1e-12
      && Math.abs(LAMP.cosOut - Math.cos((lampMod.spec.coneDeg * Math.PI) / 180)) < 1e-12,
      `углы фар переведены: наклон ${lampMod.spec.tiltDeg}°, конус ${lampMod.spec.coneDeg}°`);
  }

  // 11. Пустой набор — это отказ, а не «полетим на умолчаниях».
  let refused = false;
  try { applySpecs({ shipTypes: [] }); } catch (e) { refused = true; }
  ok(refused, 'без характеристик игра не собирается');
  applySpecs(doc);
}


console.log('\n== наземный город ==');
{
  const w = makeSystem(HOME_SEED);
  ok(w.cities.length === 1, `в родной системе один город: ${w.cities.length}`);
  const c = w.cities[0];
  const b = c.body;
  ok(c.isCity && canHostCity(b) && b.kind === 'rock',
    `${c.name} стоит на ${b.name} (${b.kind}, без атмосферы)`);

  // --- Площадка в рельефе.
  //
  // Главное свойство города: грунт под ним РОВНЫЙ, и ровный он в той же
  // функции, по которой считаются посадка и столкновение. Проверяется
  // уклоном, а не высотой: на шаре «одинаковая высота» и «ровно» — это
  // одно и то же, а уклон ещё и ловит рябь мелких масштабов.
  const u = v3(), vv = v3();
  {
    const helper = Math.abs(c.dir.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
    normalize(cross(helper, c.dir), u);
    normalize(cross(c.dir, u), vv);
  }
  const at = (du, dv) => normalize(v3(
    c.dir.x + u.x * du + vv.x * dv,
    c.dir.y + u.y * du + vv.y * dv,
    c.dir.z + u.z * du + vv.z * dv));
  // Плита теперь у каждого города своя, и пробовать её надо по её же
  // размеру: проба на километре ничего не сказала бы о городе на
  // тридцать. Радиус берётся с запасом на излом края — внутрь заведомо
  // ровной части.
  const flatR = c.plan.radius * 0.7;
  {
    let worst = 0, worstKm = 0;
    for (let i = 0; i < 40; i++) {
      const a = (i / 20) * Math.PI;
      const km = (0.1 + 0.9 * ((i % 5) / 4)) * flatR;
      const s = slopeAt(b, at(Math.cos(a) * km / b.radius, Math.sin(a) * km / b.radius));
      if (s > worst) { worst = s; worstKm = km; }
    }
    ok(worst * 57.3 < 0.05,
      `грунт города ровный на ${flatR.toFixed(1)} км: худший уклон `
      + `${(worst * 57.3).toFixed(3)}° в ${worstKm.toFixed(1)} км от середины`);

    // И площадка КОНЧАЕТСЯ: за переходом рельеф тот же, каким был. Иначе
    // выравнивание расползлось бы по всему телу.
    const far = at(0, (c.plan.plate * 1.4 + CITY.rim + 3) / b.radius);
    const withPlate = groundRadius(b, far);
    b.plate = null;                     // рельеф читает площадку на лету
    const bare = groundRadius(b, far);
    const bareCenter = groundRadius(b, c.dir);
    b.plate = c.plate;
    ok(Math.abs(withPlate - bare) < 1e-9,
      `за краем перехода рельеф нетронут: ${(Math.abs(withPlate - bare) * 1e6).toFixed(3)} мм разницы`);
    ok(Math.abs(bareCenter - c.groundR) > 1e-4,
      `а под городом — срезан: ${((c.groundR - bareCenter) * 1000).toFixed(0)} м правки`);
  }

  // Край плиты ИЗЛОМАН. Идеально круглое пятно ровного грунта в
  // семьдесят километров видно с орбиты как штамп — в природе таких не
  // бывает. Меряется дальностью края по направлениям: у круга она одна
  // и та же, у изломанного края гуляет.
  {
    let lo = Infinity, hi = 0;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      // Идём наружу, пока рельеф не перестанет быть плоским.
      let r = 0;
      for (let km = c.plan.plate * 0.5; km < c.plan.plate * 2.5; km += 0.05) {
        const d = at(Math.cos(a) * km / b.radius, Math.sin(a) * km / b.radius);
        if (plateAt(c.plate, d.x, d.y, d.z) <= 0) break;
        r = km;
      }
      lo = Math.min(lo, r); hi = Math.max(hi, r);
    }
    ok(hi - lo > c.plan.plate * 0.12,
      `край плиты неровный: от ${lo.toFixed(1)} до ${hi.toFixed(1)} км `
      + `(${(((hi - lo) / hi) * 100).toFixed(0)}% разброса)`);
  }

  // Город стоит НА грунте, а не над ним и не в нём: его начало отсчёта —
  // ровно та высота, которую вернёт рельеф под ним.
  ok(Math.abs(groundRadius(b, c.dir) - c.groundR) < 1e-9,
    `начало города на грунте: ${(Math.abs(groundRadius(b, c.dir) - c.groundR) * 1e6).toFixed(3)} мм`);

  // --- Площадки свободны, постройки твёрдые.
  {
    let occupied = 0;
    for (const p of c.plan.pads) {
      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
          if (cityBlocked(c.plan, p.x + (i * p.r) / 3, 0.01, p.z + (j * p.r) / 3, HULL_HALF.x)) {
            occupied++;
          }
        }
      }
    }
    const n = c.plan.pads.length;
    ok(n >= CITY.padsMin && n <= CITY.padsMax && occupied === 0,
      `посадочных площадок ${n}, и на них ничего не стоит`);

    // Столкновение: в середине каждой коробки — есть, над крышей — нет.
    let hit = 0, above = 0;
    for (const box of c.plan.boxes) {
      if (cityBlocked(c.plan, box.x, box.h * 0.5, box.z)) hit++;
      if (cityBlocked(c.plan, box.x, box.h + 0.05, box.z)) above++;
    }
    ok(hit === c.plan.boxes.length && above === 0,
      `во все ${c.plan.boxes.length} построек врезаешься, над крышами — пусто`);
  }

  // То же через мир: корабль в башне разбивается, над площадкой — нет.
  {
    // Через cityWorld, а не своим умножением на базис: у города есть
    // кривизна, и «сам перемножу базис» здесь означало бы проверять
    // плоский город, которого нет.
    const toWorldCity = (x, y, z) => cityWorld(c, x, y, z, v3());
    const tall = c.plan.boxes.reduce((a, x) => (x.h > a.h ? x : a), c.plan.boxes[0]);
    const inTower = { pos: toWorldCity(tall.x, tall.h * 0.5, tall.z) };
    const overPad = { pos: toWorldCity(c.plan.pads[0].x, 0.05, c.plan.pads[0].z) };
    ok(cityCrash(w, inTower) === c && !cityCrash(w, overPad),
      `в башню ${(tall.h * 1000).toFixed(0)} м врезаешься, над площадкой — свободно`);
    // И на площадке корабль ЗНАЕТ, что он в городе: по этому отличают
    // посадку в порту от посадки в чистом поле.
    const at2 = cityPadUnder(w, overPad.pos);
    ok(at2 && at2.city === c && at2.pad.n >= 1,
      `над площадкой ${at2 ? at2.pad.n : '—'} корабль числится в городе`);
  }

  // --- Кривизна. ЭТО БЫЛО СЛОМАНО, и сломалось ровно тогда, когда города
  // стали большими: город рисуется жёстким телом на касательной
  // плоскости, а плита выровнена по постоянному радиусу, то есть
  // загибается вниз. На четырёх километрах это меньше метра, и никто не
  // замечал; на восемнадцати окраина висит в шестидесяти метрах над
  // грунтом, на тридцати пяти — в двухстах тридцати.
  {
    const edge = c.plan.boxes.reduce(
      (a, b) => (Math.hypot(b.x, b.z) > Math.hypot(a.x, a.z) ? b : a), c.plan.boxes[0]);
    const far = Math.hypot(edge.x, edge.z);
    const base = cityWorld(c, edge.x, 0, edge.z, v3());
    const alt = altitudeOf(b, base).alt;
    // Насколько это было бы без поправки — тем же числом, каким её считают.
    const slack = -cityDrop(c, edge.x, edge.z);
    ok(Math.abs(alt) < 0.002 && slack > 0.02,
      `дальняя постройка в ${far.toFixed(1)} км от середины стоит НА грунте `
      + `(${(alt * 1000).toFixed(1)} м), хотя плоским городом висела бы в `
      + `${(slack * 1000).toFixed(0)} м`);

    // И врезаешься в неё там же, где она нарисована.
    const mid = { pos: cityWorld(c, edge.x, edge.h * 0.5, edge.z, v3()) };
    const over = { pos: cityWorld(c, edge.x, edge.h + 0.06, edge.z, v3()) };
    ok(cityCrash(w, mid) === c && !cityCrash(w, over),
      'в дальнюю постройку врезаешься, над её крышей — пусто');
  }

  // --- Геометрия. Тут ловится то, чего не видно ни в планировке, ни на
  // экране: город собирается из чисел пака, и любая ошибка в их разборе
  // даёт либо пустой меш, либо кашу из NaN.
  {
    const geo = buildCityGeometry(c.plan);
    ok(geo.faces === cityTris(c.plan) && geo.faces > 20000,
      `геометрия города: ${geo.faces} треугольников — ровно столько, сколько обещано`);

    let nan = 0, far = 0, high = 0;
    for (let i = 0; i < geo.positions.length; i += 3) {
      const x = geo.positions[i], y = geo.positions[i + 1], z = geo.positions[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) nan++;
      far = Math.max(far, Math.hypot(x, z));
      high = Math.max(high, y);
    }
    ok(nan === 0, `в вершинах города нет NaN (${geo.positions.length / 3} штук)`);
    // Габарит — это радиус цели: по нему город берут в прицел и по нему
    // считают, «дальше пикселя или нет». Модель, торчащая из него,
    // означала бы башню, в которую целиться нечем.
    ok(far <= c.radius + 1e-6, `застройка не торчит из габарита: ${far.toFixed(2)} км при ${c.radius.toFixed(2)}`);
    ok(Math.abs(high - c.plan.tallest) < 0.03,
      `самое высокое здание ${(high * 1000).toFixed(0)} м — столько же, сколько обещает план`);

    // ЭТО БЫЛО СЛОМАНО: цвет граней лежит в палитре детали, а генератор
    // палитру не выводил вовсе. Меш при этом собирался «успешно» — из
    // undefined, — и город уходил в кадр чёрным пятном с NaN в цвете.
    // Проверка требует и цвета, и свечения: окна и огни на безатмосферном
    // теле — единственное, чем город виден ночью.
    let lit = 0, bad = 0;
    for (let i = 0; i < geo.colors.length; i += 4) {
      const a = geo.colors[i + 3];
      if (!Number.isFinite(geo.colors[i]) || !Number.isFinite(a)) bad++;
      if (a > 0.3) lit++;
    }
    ok(bad === 0 && lit > 1000,
      `цвет взят из палитры: светящихся вершин ${lit}, битых ${bad}`);
  }

  // --- Два уровня подробности. Без них город в семьдесят километров —
  // это шесть миллионов треугольников, то есть его просто нет.
  {
    const farGeo = cityTris(c.plan, null);
    const nearGeo = cityTris(c.plan, { x: 0, z: 0 });
    const full = nearSet(c.plan, { x: 0, z: 0 }).size;
    // Бюджет ближнего круга держится в самом плотном месте города — в
    // середине, где стоят башни. Если он не держится там, он не держится
    // нигде.
    ok(nearGeo > farGeo * 1.2 && full > 20 && nearGeo - farGeo < NEAR_TRIS * 1.05,
      `вблизи ${full} построек настоящими моделями: ${(nearGeo / 1000).toFixed(0)}к `
      + `треугольников против ${(farGeo / 1000).toFixed(0)}к издали`);

    // Коробка встаёт РОВНО на место постройки: иначе на подлёте город
    // перескакивал бы, когда модель сменяется коробкой.
    const g = buildCityGeometry(c.plan, null);
    let far2 = 0, high2 = 0;
    for (let i = 0; i < g.positions.length; i += 3) {
      far2 = Math.max(far2, Math.hypot(g.positions[i], g.positions[i + 2]));
      high2 = Math.max(high2, g.positions[i + 1]);
    }
    // Коробка ровно той же высоты, что постройка. Выше неё в городе
    // только огонь на крыше — он и даёт остаток.
    ok(far2 <= c.radius + 1e-6 && high2 >= c.plan.tallest - 1e-6
      && high2 - c.plan.tallest < 0.02,
      `коробки стоят в габарите города и той же высоты: ${far2.toFixed(2)} км, `
      + `${(high2 * 1000).toFixed(0)} м при ${(c.plan.tallest * 1000).toFixed(0)}`);

    // ЭТО БЫЛО СЛОМАНО: стены коробок обходились в обратном порядке, и
    // нормаль смотрела ВНУТРЬ. Ошибка не даёт ни NaN, ни лишних граней —
    // город просто выходит чёрным при полном солнце, и видно это только
    // на снимке. Проверяется тем же, чем считается столкновение: шаг
    // наружу по нормали обязан выйти из постройки, шаг внутрь — остаться
    // в ней.
    let wrong = 0, tested = 0, litWall = 0;
    const EPS = 0.003;                 // 3 м — меньше любого проезда
    for (let t = 0; t + 8 < g.positions.length; t += 9) {
      const px = [g.positions[t], g.positions[t + 3], g.positions[t + 6]];
      const py = [g.positions[t + 1], g.positions[t + 4], g.positions[t + 7]];
      const pz = [g.positions[t + 2], g.positions[t + 5], g.positions[t + 8]];
      const ny = g.normals[t + 1];
      if (Math.abs(ny) > 0.3) continue;                        // крыши и плашки
      const cy = (py[0] + py[1] + py[2]) / 3;
      if (cy < 0.09) continue;                                 // ниже — пути и сараи
      const side = Math.max(
        Math.hypot(px[1] - px[0], pz[1] - pz[0]),
        Math.hypot(px[2] - px[0], pz[2] - pz[0]));
      if (side < 0.02) continue;                               // огни на крышах
      const cx = (px[0] + px[1] + px[2]) / 3, cz = (pz[0] + pz[1] + pz[2]) / 3;
      const nx = g.normals[t], nz = g.normals[t + 2];
      tested++;
      const out = cityBlocked(c.plan, cx + nx * EPS, cy, cz + nz * EPS);
      const inn = cityBlocked(c.plan, cx - nx * EPS, cy, cz - nz * EPS);
      if (out || !inn) wrong++;
      if (g.colors[(t / 3) * 4 + 3] > 0.2) litWall++;
    }
    ok(tested > 200 && wrong === 0,
      `стены коробок смотрят наружу: проверено ${tested} граней, внутрь смотрит ${wrong}`);

    // И светятся: ночью дальняя половина города — это окна коробок.
    //
    // Считаются ИМЕННО СТЕНЫ, отобранные тем же ситом. Первая редакция
    // считала все светящиеся вершины подряд — и не заметила, что у
    // башен окна не зажглись вовсе: в счёт попадали фонари вдоль улиц,
    // которых тысячи. Проверка проходила, а город ночью стоял тёмным.
    ok(litWall > tested * 0.15,
      `окна коробок горят: ${litWall} светящихся граней стен из ${tested}`);
  }

  // --- Тени построек.
  //
  // Тень — не украшение: на безатмосферном теле солнце единственный
  // источник, и без теней город читается наклейкой на грунте. Рисуется
  // она тёмным многоугольником на земле, тем же приёмом, что у камней.
  //
  // Проверяется то, что ломается молча и чего не видно в числах: СТОРОНА
  // (тень против солнца, а не по нему) и ВЫСОТА (тень на грунте, а не
  // под ним и не над крышами).
  {
    const shadowOf = (geo) => {
      const pts = [];
      for (let i = 0; i < geo.colors.length; i += 4) {
        if (Math.abs(geo.colors[i] - SHADOW_RGB[0]) > 1e-6) continue;
        if (Math.abs(geo.colors[i + 2] - SHADOW_RGB[2]) > 1e-6) continue;
        pts.push([geo.positions[(i / 4) * 3], geo.positions[(i / 4) * 3 + 1],
          geo.positions[(i / 4) * 3 + 2]]);
      }
      return pts;
    };
    const unit = (x, y, z) => {
      const l = Math.hypot(x, y, z);
      return { x: x / l, y: y / l, z: z / l };
    };
    // Солнце сбоку и невысоко: тени длинные и хорошо заметны.
    const sun = unit(0.8, 0.5, 0);

    const lit = buildCityGeometry(c.plan, null, c.groundR, sun);
    const dark = buildCityGeometry(c.plan, null, c.groundR, null);
    const pts = shadowOf(lit);
    ok(lit.faces - dark.faces === c.plan.boxes.length * 6 && pts.length > 100,
      `тени построек: ${lit.faces - dark.faces} треугольников на `
      + `${c.plan.boxes.length} построек — ровно по шесть`);

    // СТОРОНА. Середина теней обязана уехать ОТ солнца: тень по солнцу —
    // классическая ошибка со знаком, и на картинке она читается как
    // «свет откуда-то не оттуда», а не как поломка.
    {
      let sx = 0, sz = 0;
      for (const p of pts) { sx += p[0]; sz += p[2]; }
      sx /= pts.length; sz /= pts.length;
      let bx = 0, bz = 0;
      for (const box of c.plan.boxes) { bx += box.x; bz += box.z; }
      bx /= c.plan.boxes.length; bz /= c.plan.boxes.length;
      const hl = Math.hypot(sun.x, sun.z);
      const ax = -sun.x / hl, az = -sun.z / hl;
      const along = (sx - bx) * ax + (sz - bz) * az;
      const across = Math.abs((sx - bx) * -az + (sz - bz) * ax);
      ok(along > 0.02 && across < along * 0.5,
        `тени лежат от солнца: середина смещена на ${(along * 1000).toFixed(0)} м по лучу `
        + `и ${(across * 1000).toFixed(0)} м поперёк`);
    }

    // ВЫСОТА. Тень лежит на грунте — с той же поправкой на кривизну, с
    // какой стоят дома, и приподнята ровно настолько, чтобы не спорить с
    // улицами.
    {
      let worst = 0;
      for (const p of pts) {
        const want = cityDrop(c, p[0], p[2]) + SHADOW_LIFT;
        worst = Math.max(worst, Math.abs(p[1] - want));
      }
      // Допуск миллиметровый: вершины лежат во float32, и точнее их не
      // хранят. Ошибка, которую ловим, — это метры и десятки метров.
      ok(worst < 1e-6,
        `тени лежат на грунте: худшее отклонение ${(worst * 1e6).toFixed(3)} мм`);
    }

    // Длина тени растёт, когда солнце опускается, и обрезана у горизонта:
    // иначе тень уходит за плиту на нетронутый рельеф и повисает над ним.
    {
      // Меряется вынос теней ВДОЛЬ ЛУЧА от середины застройки, а не
      // дальность от центра города: дальше всех и так окраина, и по ней
      // о длине тени не скажешь ничего.
      let bx = 0, bz = 0;
      for (const box of c.plan.boxes) { bx += box.x; bz += box.z; }
      bx /= c.plan.boxes.length; bz /= c.plan.boxes.length;
      const reach = (s) => {
        const hl = Math.hypot(s.x, s.z);
        const ax = -s.x / hl, az = -s.z / hl;
        let sum = 0, n = 0;
        for (const p of shadowOf(buildCityGeometry(c.plan, null, c.groundR, s))) {
          sum += (p[0] - bx) * ax + (p[2] - bz) * az; n++;
        }
        return sum / n;
      };
      const lowReach = reach(unit(0.97, 0.22, 0));
      const highReach = reach(unit(0.3, 0.95, 0));
      ok(lowReach > highReach * 1.5 && lowReach < c.plan.tallest * SHADOW_MAX,
        `низкое солнце даёт тени длиннее: вынос ${(lowReach * 1000).toFixed(0)} м против `
        + `${(highReach * 1000).toFixed(0)} м — и обрезан пределом `
        + `${(c.plan.tallest * SHADOW_MAX * 1000).toFixed(0)} м`);
    }

    // Ночью теней нет вовсе, и это не упущение: солнца под горизонтом
    // нет, а тёмный многоугольник на чёрном грунте не виден.
    {
      const night = unit(0.6, -0.8, 0);
      ok(!sunCasts(night) && cityTris(c.plan, null, night) === cityTris(c.plan, null, null),
        'под горизонтом солнце теней не отбрасывает');
    }
  }

  // --- Тени от фар.
  //
  // ДРУГАЯ ЗАДАЧА, чем тень от солнца, а не та же с другим вектором.
  // Солнце бесконечно далеко: его тень — перенос силуэта, она запечена в
  // меш. Фара стоит внутри сцены и едет с кораблём: её тень расходится
  // веером, меняется каждый кадр, а от здания ВЫШЕ лампы уходит в
  // бесконечность. Поэтому она считается на пиксель, а в шейдер уезжает
  // два десятка коробок — те, что реально могут перекрыть луч.
  //
  // Проверяется ГЛАВНОЕ: тень падает ровно от того, обо что разбиваются.
  // Эталон — марш по лучу с вопросом cityBlocked, то есть та самая
  // функция столкновений; сойтись с ней геометрия обязана, и ошибка в
  // знаке, повороте или высоте коробки разносит совпадение в клочья.
  {
    const A = new Float32Array(SHADE_MAX * 4);
    const B = new Float32Array(SHADE_MAX * 4);
    // Луч вниз-вперёд и широкий — общий конус обеих фар у снижающегося
    // корабля (js/game/lamps.js, lampCone).
    const cone = { x: 0.43, y: -0.87, z: 0.24, cos: Math.cos(50 * Math.PI / 180) };
    // Лампа над самым плотным местом и ВЫШЕ крыш: ниже крыш ближняя
    // башня кладёт тень на всё пятно разом, и проверка на такой сцене
    // ничего не проверяет — там всё тёмное и без арифметики.
    const lamp = { x: 0, y: 0.6, z: 0 };
    const n = shadeBoxes(c.plan, lamp, cone, LAMP.range, c.groundR, A, B);
    ok(n > 0 && n <= SHADE_MAX, `под фарой отобрано ${n} построек из ${c.plan.boxes.length}`);

    // Числа коробок — ТЕ ЖЕ, по которым считаются столкновения, а не
    // их копия «для картинки». Иначе тень и стена разъедутся.
    {
      let same = 0;
      for (let i = 0; i < n; i++) {
        for (const b of c.plan.boxes) {
          // Сравнение через float32: в uniform-ы числа уезжают одинарной
          // точностью, и «то же самое» здесь значит именно это.
          const f = Math.fround;
          if (f(b.x) === A[i * 4] && f(b.z) === A[i * 4 + 1] && f(b.hw) === A[i * 4 + 2]
            && f(b.hd) === A[i * 4 + 3] && f(b.h) === B[i * 4 + 1]
            && f(b.c) === B[i * 4 + 2] && f(b.s) === B[i * 4 + 3]) { same++; break; }
        }
      }
      ok(same === n, `коробки теней — те же, что у столкновений: ${same} из ${n}`);
    }

    // Эталон: шагаем от точки к лампе и спрашиваем столкновения.
    const march = (p) => {
      const dx = lamp.x - p.x, dy = lamp.y - p.y, dz = lamp.z - p.z;
      const steps = Math.ceil(Math.hypot(dx, dy, dz) / 0.002);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = p.x + dx * t, y = p.y + dy * t, z = p.z + dz * t;
        if (cityBlocked(c.plan, x, y - cityDrop(c, x, z), z)) return true;
      }
      return false;
    };
    // Точки берутся и на грунте, и на высоте стен: тень от фары обязана
    // ложиться и на соседний дом — этого запечённая тень не умеет вовсе.
    const lit = [];
    for (let ix = -20; ix <= 20; ix++) {
      for (let iz = -20; iz <= 20; iz++) {
        for (const h of [0, 0.05]) {
          const x = lamp.x + ix * 0.025, z = lamp.z + iz * 0.025;
          if (cityBlocked(c.plan, x, h + 0.001, z)) continue;   // внутри дома
          const p = { x, y: cityDrop(c, x, z) + h, z };
          // Только освещённое: вне конуса шейдер о тени и не спросит.
          const ex = p.x - lamp.x, ey = p.y - lamp.y, ez = p.z - lamp.z;
          const el = Math.hypot(ex, ey, ez);
          if ((ex * cone.x + ey * cone.y + ez * cone.z) / el < cone.cos) continue;
          lit.push(p);
        }
      }
    }
    let mine = 0, ref = 0, both = 0;
    for (const p of lit) {
      const a = shadeHit(A, B, n, p, lamp);
      const b = march(p);
      if (a) mine++;
      if (b) ref++;
      if (a && b) both++;
    }
    ok(ref > lit.length * 0.2 && both > ref * 0.95 && mine - both < ref * 0.02,
      `тень от фары сходится со столкновениями: ${both} из ${ref} затенённых точек `
      + `(${lit.length} в пятне), ложных ${mine - both}`);

    // СТОРОНА. Лампа с другой стороны — и тень уезжает на другую
    // сторону: ошибка знака даёт тень, идущую к лампе, а на картинке
    // это читается как «свет откуда-то не оттуда», а не как поломка.
    {
      const back = { x: lamp.x - 1.2, y: lamp.y, z: lamp.z - 0.6 };
      const cone2 = { x: -cone.x, y: cone.y, z: -cone.z, cos: cone.cos };
      const A2 = new Float32Array(SHADE_MAX * 4), B2 = new Float32Array(SHADE_MAX * 4);
      const n2 = shadeBoxes(c.plan, back, cone2, LAMP.range, c.groundR, A2, B2);
      let moved = 0, same = 0;
      for (const p of lit) {
        const a = shadeHit(A, B, n, p, lamp);
        const b = shadeHit(A2, B2, n2, p, back);
        if (a !== b) moved++; else if (a) same++;
      }
      ok(moved > same, `лампу перенесли — тень ушла: ${moved} точек сменили свет, `
        + `${same} остались в тени обеих ламп`);
    }

    // Постройка не затеняет САМА СЕБЯ. Без этого каждое здание было бы
    // чёрным целиком: луч от точки на стене выходит изнутри коробки, и
    // плиты честно сообщают о пересечении. Проверяется на ОДНОЙ коробке
    // — чтобы в ответе не было чужих теней.
    {
      const a1 = A.subarray(0, 4), b1 = B.subarray(0, 4);
      const hw = a1[2], hd = a1[3], cs = b1[2], sn = b1[3];
      let dark = 0, tested = 0;
      for (const [ox, oz] of [[hw, 0], [-hw, 0], [0, hd], [0, -hd], [0, 0]]) {
        for (const k of [1 / 3, 2 / 3, 1]) {
          // Поворот тот же, что в cityBlocked, только обратный: из осей
          // коробки в оси города.
          const x = a1[0] + ox * cs + oz * sn;
          const z = a1[1] - ox * sn + oz * cs;
          tested++;
          if (shadeHit(a1, b1, 1, { x, y: b1[0] + b1[1] * k, z }, lamp)) dark++;
        }
      }
      ok(tested === 15 && dark === 0,
        `постройка не затеняет сама себя: ${tested} точек на её стенах и крыше, `
        + `в собственной тени ${dark}`);
    }

    // Фары выключены или город далеко — коробок ноль, и весь блок в
    // шейдере пропускается одним сравнением.
    {
      const far = { x: 0, y: 200, z: 0 };
      ok(shadeBoxes(c.plan, far, cone, LAMP.range, c.groundR, A, B) === 0,
        'с высоты, куда луч не достаёт, теней не строим вовсе');
    }
  }

  // --- Детерминизм. Мир лежит слепком в базе и в сохранениях пилотов, и
  // город обязан оказываться на том же месте в каждом запуске.
  {
    const w2 = makeSystem(HOME_SEED);
    const c2 = w2.cities[0];
    const d = Math.hypot(c.dir.x - c2.dir.x, c.dir.y - c2.dir.y, c.dir.z - c2.dir.z);
    ok(c2.name === c.name && d < 1e-12 && c2.plan.parts.length === c.plan.parts.length,
      `город тот же в новом запуске: ${c2.name}, ${c2.plan.parts.length} деталей`);
  }

  // --- Город из записи сервера.
  //
  // Хозяин мира — сервер, но геометрию он не присылает: в базе лежит
  // семя и место, а пять тысяч построек собираются из них на клиенте.
  // Значит, город из записи обязан выйти ПОБАЙТОВО ТЕМ ЖЕ — иначе у
  // сервера и у клиента разные города под одним именем, и любая
  // проверка «где ты сел» разъедется.
  {
    const rec = cityRecord(c);
    const w3 = makeSystem(HOME_SEED);
    const n = applyCities(w3, [rec]);
    const c3 = w3.cities[0];
    const dd = Math.hypot(c3.dir.x - c.dir.x, c3.dir.y - c.dir.y, c3.dir.z - c.dir.z);
    // Край плиты тоже: гармоники излома идут из того же потока, что и
    // имя, и пропустить имя значило бы получить другой край площадки.
    const edge = Math.abs(c3.plate.k1c - c.plate.k1c) + Math.abs(c3.plate.k2s - c.plate.k2s)
      + Math.abs(c3.plate.d0 - c.plate.d0);
    ok(n === 1 && c3.name === c.name && c3.id === c.id
      && c3.plan.parts.length === c.plan.parts.length
      && Math.abs(c3.radius - c.radius) < 1e-9 && dd < 1e-12 && edge < 1e-15,
      `город из записи сервера — тот же самый (${c3.plan.parts.length} деталей, `
      + `край сходится до ${edge.toExponential(0)})`);

    // И сервер вправе переставить город: клиент не спорит, а старое тело
    // обязано его потерять — иначе город останется в мире дважды.
    const other = w3.planets.find((p) => canHostCity(p) && p !== c3.body);
    applyCities(w3, [{ ...rec, bodyLocalId: other.id, localId: 'c' + other.id, name: 'Проба' }]);
    ok(w3.cities.length === 1 && w3.cities[0].body === other
      && w3.cities[0].name === 'Проба' && !c3.body.city,
      `сервер переставил город на ${other.name}, старое тело его потеряло`);
  }

  // --- Цель. Ради этого город и попадает в список навигации.
  {
    const ship = makeShip();
    placeShip(ship, v3(c.pos.x + 20, c.pos.y, c.pos.z), makeBasis());
    const nav = makeNav(w);
    refreshNav(nav, w, ship);
    ok(nav.list.includes(c) && targetKind(c) === 'ГОРОД',
      `город в списке целей и подписан как «${targetKind(c)}»`);
    ok(targetById(w, c.id) === c,
      'город находится по идентификатору — иначе он терялся бы при загрузке');
  }

  // --- Прыжок. Точка выхода считается ОТ ТЕЛА и над городом: сам город
  // лежит на грунте, и «подступ с той стороны, откуда идём» приходился бы
  // внутрь планеты.
  {
    const from = v3(b.pos.x + b.radius * 40, b.pos.y, b.pos.z);
    const p = exitPoint(c, from);
    const alt = Math.hypot(p.x - b.pos.x, p.y - b.pos.y, p.z - b.pos.z) - b.radius;
    const up = normalize(v3(c.pos.x - b.pos.x, c.pos.y - b.pos.y, c.pos.z - b.pos.z));
    const dirExit = normalize(v3(p.x - b.pos.x, p.y - b.pos.y, p.z - b.pos.z));
    ok(alt > 1 && dot(up, dirExit) > 0.9999,
      `выход из прыжка — над городом, в ${alt.toFixed(0)} км над поверхностью`);
  }

  // --- Камни. На расчищенной площадке их быть не должно: валун посреди
  // улицы означал бы, что город никто не строил.
  {
    const onPlate = scatterRocks(b, c.dir, 0.15).length;
    const away = scatterRocks(b, normalize(v3(-c.dir.x, -c.dir.y, -c.dir.z)), 0.15).length;
    ok(onPlate === 0 && away > 0,
      `на площадке камней нет, в стороне от неё — ${away}`);
  }
}

// --- Города не похожи друг на друга -----------------------------------------
//
// Это главное требование ко всему разделу, и проверяется оно не на одном
// городе, а на выборке: один город не бывает однообразным.
{
  const N = 60;
  const plans = [];
  const t0 = Date.now();
  for (let i = 0; i < N; i++) plans.push(cityPlan((i * 2654435761) >>> 0));
  const ms = Date.now() - t0;

  // Размер. Город обязан быть и на четыре километра, и на семьдесят:
  // одинаковый размер — это такое же однообразие, как одинаковый план.
  const km = plans.map((p) => p.radius * 2).sort((a, x) => a - x);
  const small = km.filter((v) => v < 10).length;
  const big = km.filter((v) => v > 25).length;
  ok(small >= 5 && big >= 5 && km[km.length - 1] > 40 && km[0] < 8,
    `размеры от ${km[0].toFixed(1)} до ${km[km.length - 1].toFixed(1)} км: `
    + `мелких ${small}, крупных ${big}`);

  // Схема расселения: встречаются все четыре, и ни одна не съедает
  // больше половины. Схема, которая не выпадает, — это мёртвый код.
  const byKind = {};
  for (const p of plans) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  const kinds = Object.keys(CITY_KINDS);
  ok(kinds.every((k) => byKind[k] >= 3) && Math.max(...Object.values(byKind)) < N * 0.55,
    'все схемы расселения встречаются: '
    + kinds.map((k) => `${CITY_KINDS[k]} ${byKind[k] || 0}`).join(', '));

  // Ни одной пары близнецов: совпадение размера И числа построек И числа
  // площадок означало бы, что семя ни на что не влияет.
  const sig = new Set(plans.map((p) => `${p.radius.toFixed(2)}/${p.boxes.length}/${p.pads.length}`));
  ok(sig.size === N, `все ${N} городов разные: ${sig.size} различных наборов`);

  // Контур застройки НЕ КРУГЛЫЙ. Меряется дальностью застройки по
  // шестнадцати направлениям: у круга она всюду одна.
  let round = 0, flattest = 1;
  for (const p of plans) {
    const reach = new Array(16).fill(0);
    for (const bx of p.boxes) {
      const a = Math.atan2(bx.z, bx.x);
      const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 16) % 16;
      reach[k] = Math.max(reach[k], Math.hypot(bx.x, bx.z));
    }
    const hi = Math.max(...reach), lo = Math.min(...reach);
    flattest = Math.min(flattest, (hi - lo) / hi);
    if (hi - lo < hi * 0.12) round++;
  }
  ok(round === 0,
    `ни один город не вышел круглым: самый ровный край гуляет на `
    + `${(flattest * 100).toFixed(0)}% радиуса (${round} круглых из ${N})`);

  // Бюджет. Город, который не укладывается, — это не «чуть медленнее»,
  // а вылет по памяти: геометрия заводится одним куском.
  let maxParts = 0, maxTris = 0, maxLamps = 0;
  for (const p of plans) {
    maxParts = Math.max(maxParts, p.parts.length);
    maxLamps = Math.max(maxLamps, p.lamps.length);
    maxTris = Math.max(maxTris, cityTris(p, null));
  }
  ok(maxParts <= CITY.maxParts && maxLamps <= CITY.maxLamps && maxTris < 400000,
    `бюджет выдержан: деталей ${maxParts}, огней ${maxLamps}, `
    + `треугольников издали ${(maxTris / 1000).toFixed(0)}к`);
  ok(ms < 4000, `${N} планировок за ${ms} мс`);

  // Постройки НЕ ПЕРЕСЕКАЮТСЯ — по настоящим коробкам, с разворотом.
  // Дома стоят под любым углом, и проверять их прямоугольниками по осям
  // значило бы не проверять вовсе: у повёрнутого дома описанный
  // прямоугольник вдвое больше него самого.
  const overlap = (p, q) => {
    // Разделяющая ось: четыре направления — стороны двух коробок.
    const axes = [[p.c, -p.s], [p.s, p.c], [q.c, -q.s], [q.s, q.c]];
    const dx = q.x - p.x, dz = q.z - p.z;
    for (const [ax, az] of axes) {
      const proj = (bx) => Math.abs(bx.hw * (bx.c * ax - bx.s * az))
        + Math.abs(bx.hd * (bx.s * ax + bx.c * az));
      if (Math.abs(dx * ax + dz * az) >= proj(p) + proj(q) - 1e-9) return false;
    }
    return true;
  };
  let pairs = 0, worst = 0, where = '';
  for (const p of plans) {
    for (let i = 0; i < p.boxes.length; i++) {
      const a = p.boxes[i];
      for (let j = i + 1; j < p.boxes.length; j++) {
        const bx = p.boxes[j];
        if (Math.hypot(a.x - bx.x, a.z - bx.z) > a.ax + a.az + bx.ax + bx.az) continue;
        if (!overlap(a, bx)) continue;
        pairs++;
        const d = Math.min(a.hw + bx.hw - Math.abs(a.x - bx.x), a.hd + bx.hd - Math.abs(a.z - bx.z));
        if (d > worst) { worst = d; where = `семя ${p.seed}`; }
      }
    }
  }
  ok(pairs === 0,
    `ни одна постройка не стоит в другой (${pairs} пар${pairs ? `, до ${(worst * 1000).toFixed(0)} м, ${where}` : ''})`);

  // И ни одна не стоит на посадочной площадке: сесть было бы некуда, а
  // с воздуха дом на площадке от дома у площадки не отличить.
  let onPad = 0;
  for (const p of plans) {
    for (const pd of p.pads) {
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          if (cityBlocked(p, pd.x + (i * pd.r) / 2, 0.01, pd.z + (j * pd.r) / 2)) onPad++;
        }
      }
    }
  }
  ok(onPad === 0, `площадки свободны во всех ${N} городах (${onPad} занятых точек)`);
}

// --- топливо: расход, прыжки, сверка с сервером ------------------------------
//
// Расход выводится из физики, а не подобран: тонны = масса · Δv / струя.
// Здесь проверяется, что модель полёта честно считает Δv каждой группы
// сопел, что прыжки не лезут в резерв, что галактика на заводском баке
// связна и что игра сводит свой счёт с серверным, не прыгая назад.
{
  console.log('\n== топливо ==');
  const F = await import('../js/game/fuel.js');
  const { SHIP_MASS } = await import('../js/game/downwash.js');
  const { canJump: canJ, jumpFuel } = await import('../js/game/quantum.js');
  const { canWarp: canW } = await import('../js/game/warp.js');
  const docF = JSON.parse(readFileSync('server/data/specs.json', 'utf8'));
  const catalog = JSON.parse(readFileSync('server/data/catalog.json', 'utf8'));

  // Масса — одна на обе стороны: сервер берёт её из выгрузки меша.
  const catMass = catalog.shipTypes.find((t) => t.code === 'challenger').massT;
  ok(Math.abs(catMass - SHIP_MASS / 1000) < 0.06,
    'масса корпуса в каталоге сервера — та же, что у игры: ' + catMass + ' т');

  ok(SHIP.fuelCap === SHIP.fuelMax && SHIP.fuelReserve > 0 && SHIP.fuelReserve < SHIP.fuelCap / 4,
    'бак ' + SHIP.fuelCap + ' т, резерв ' + SHIP.fuelReserve + ' т');
  ok(Math.abs(F.thrustTons(1, 0, 0) - SHIP_MASS / 1000 / SHIP.exhaust) < 1e-12
    && Math.abs(F.thrustTons(0, 1, 0) - SHIP_MASS / 1000 / SHIP.liftExhaust) < 1e-12
    && Math.abs(F.thrustTons(0, 0, 1) - SHIP_MASS / 1000 / SHIP.rcsExhaust) < 1e-12,
    'тонны на км/с = масса / струя, по каждой группе сопел своей струёй');

  // Модель полёта считает Δv честно. Разгон с места до предела — ровно
  // предел: гасители не добавляют маршевым лишнего.
  const fly = (setup, secs, field = null) => {
    const s = F.resetFuelBook(makeShip());
    setup(s);
    for (let i = 0; i < secs * 60; i++) { updateShip(s, STEP, field); F.burnThrust(s); }
    return s;
  };
  let s = fly((x) => { x.throttle = 1; }, 5);
  ok(Math.abs(s.work.main - SHIP.maxSpeed) < 1e-6 && s.work.lift === 0,
    'разгон до предела: маршевые набрали ' + s.work.main.toFixed(4) + ' км/с при пределе '
    + SHIP.maxSpeed);
  ok(Math.abs((SHIP.fuelCap - s.fuel) - F.thrustTons(s.work.main, s.work.lift, s.work.rcs)) < 1e-9
    && Math.abs(s.burned - (SHIP.fuelCap - s.fuel)) < 1e-9,
    'списано ровно по формуле: ' + (SHIP.fuelCap - s.fuel).toFixed(4) + ' т');

  // Зависание: вес держат подъёмные, и это их работа — g за секунду.
  const g = 0.0065;
  s = fly(() => {}, 10, { up: { x: 0, y: 1, z: 0 }, g });
  ok(Math.abs(s.work.lift - g * 10) < 1e-9 && s.speed < 1e-9,
    'зависание 10 с при 6.5 м/с²: подъёмные набрали ' + (s.work.lift * 1000).toFixed(1)
    + ' м/с, корабль висит');
  // Снижение ручкой F: движки тянут МЕНЬШЕ веса, а не больше.
  s = fly((x) => { x.control.lift = -0.1; }, 0);
  const down = F.resetFuelBook(makeShip());
  down.gear.out = false;
  for (let i = 0; i < 60; i++) {
    down.control.lift = -0.1;
    updateShip(down, STEP, { up: { x: 0, y: 1, z: 0 }, g });
    F.burnThrust(down);
  }
  ok(down.work.lift < g * 1 && down.work.lift > 0,
    'на снижении подъёмные работают меньше, чем на зависании: '
    + (down.work.lift * 1000).toFixed(2) + ' против ' + (g * 1000).toFixed(1) + ' м/с за секунду');

  // Разворот на ходу стоит заноса: маневровые гасят снос.
  s = F.resetFuelBook(makeShip());
  s.throttle = 1;
  for (let i = 0; i < 600; i++) { updateShip(s, STEP); F.burnThrust(s); }
  const rcs0 = s.work.rcs;
  for (let i = 0; i < 300; i++) { s.control.yaw = 1; updateShip(s, STEP); F.burnThrust(s); }
  ok(s.work.rcs - rcs0 > 0.3,
    'разворот на полном ходу: маневровые погасили ' + (s.work.rcs - rcs0).toFixed(2) + ' км/с заноса');

  // Пустой бак: сопла молчат все — ни тяги, ни гасителей, ни вращения.
  s = makeShip();
  s.fuel = 0;
  s.throttle = 1;
  s.control.boost = 1;
  s.rot.yaw = 0.1;
  for (let i = 0; i < 60; i++) { s.control.yaw = -1; s.control.boost = 1; updateShip(s, STEP); }
  ok(s.speed < 1e-9 && !s.boosting && Math.abs(s.rot.yaw - 0.1) < 1e-12,
    'с пустым баком нет ни тяги, ни форсажа, и вращение не гасится');
  s = makeShip();
  s.fuel = 0;
  for (let i = 0; i < 60; i++) updateShip(s, STEP, { up: { x: 0, y: 1, z: 0 }, g });
  ok(Math.abs(s.vel.y + g) < 1e-6 && s.damp,
    'в поле тяжести сухой корабль падает с g, а выбор гасителей пилота не тронут');

  // Состояние бака для приборов.
  const probe = { fuel: SHIP.fuelCap };
  const lv = (f) => { probe.fuel = f; return F.fuelLevel(probe); };
  ok(lv(SHIP.fuelCap) === 'ok' && lv(SHIP.fuelCap * 0.2) === 'low'
    && lv(SHIP.fuelReserve) === 'reserve' && lv(0) === 'dry',
    'пороги бака: полный, меньше четверти, резерв, пусто');

  // Квантовый прыжок не лезет в резерв; расход — по пути до точки выхода.
  const wq = makeSystem(systemById(0));
  updateWorld(wq, 0);
  const qs = makeShip();
  const st0 = wq.stations[0];
  placeShip(qs, v3(st0.pos.x + 3000, st0.pos.y + 3000, st0.pos.z), makeBasis());
  const target = wq.planets.find((p) => canJ(wq, { ...qs, fuel: undefined }, p).ok
    && jumpFuel(qs, p) > 0.3);
  if (target) {
    const need = jumpFuel(qs, target);
    qs.fuel = SHIP.fuelReserve + need + 0.01;
    const yes = canJ(wq, qs, target);
    qs.fuel = SHIP.fuelReserve + need - 0.01;
    const no = canJ(wq, qs, target);
    ok(yes.ok && !no.ok && no.fuel && /ТОПЛИВ/.test(no.reason),
      'к ' + target.name + ' прыжок стоит ' + need.toFixed(2) + ' т: с запасом — можно, в резерв — нельзя («'
      + no.reason + '»)');
    ok(canJ(wq, { pos: qs.pos, basis: qs.basis }, target).ok,
      'корабль без бака (проверки до характеристик) топливом не ограничен');
  } else {
    ok(false, 'не нашлось цели для проверки топлива прыжка');
  }

  // Варп: на заводском баке галактика СВЯЗНА (самое длинное нужное ребро
  // помещается), но не вся напрямую — у карты есть дороги.
  const gal = makeGalaxy(HOME_SEED).systems;
  const inTree = new Set([gal[0]]);
  let longest = 0;
  while (inTree.size < gal.length) {
    let best = null;
    for (const a of inTree) {
      for (const b of gal) {
        if (inTree.has(b)) continue;
        const d = systemDistance(a, b);
        if (!best || d < best[0]) best = [d, b];
      }
    }
    inTree.add(best[1]);
    longest = Math.max(longest, best[0]);
  }
  const full = { fuel: SHIP.fuelCap };
  ok(F.warpRange(full) >= longest,
    'полный бак: варп до ' + F.warpRange(full).toFixed(1) + ' св. г., а для связной галактики нужно '
    + longest.toFixed(1));
  const far = gal.slice().sort((a, b) => systemDistance(gal[0], b) - systemDistance(gal[0], a))[0];
  const near = gal.slice(1).sort((a, b) => systemDistance(gal[0], a) - systemDistance(gal[0], b))[0];
  const ws = makeShip();
  ws.fuel = SHIP.fuelCap;
  ok(canW(ws, gal[0], near).ok && !canW(ws, gal[0], far).ok && canW(ws, gal[0], far).fuel,
    'на заводском баке ' + near.name + ' (' + systemDistance(gal[0], near).toFixed(1) + ' св. г.) — можно, '
    + far.name + ' (' + systemDistance(gal[0], far).toFixed(1) + ') — только с пересадкой');

  // Экономичный привод и дополнительный бак — это и есть «купить лучше»:
  // модуль в гнезде меняет и предел, и объём.
  const withMods = (codes) => {
    const mods = docF.modules.filter((m) => m.installed);
    for (const c of codes) {
      const m = docF.modules.find((x) => x.code === c);
      const i = mods.findIndex((x) => x.slot === m.slot);
      if (i >= 0) mods.splice(i, 1);
      mods.push(m);
    }
    applyShipEquipment(mods);
    applyShipSpec(flightModel(docF.shipTypes[0].spec));
  };
  withMods(['tank_x', 'warp_x']);
  const capX = SHIP.fuelCap;
  ws.fuel = SHIP.fuelCap;
  const farOk = canW(ws, gal[0], far).ok;
  applyModuleSpecs(docF.modules);
  applyShipSpec(flightModel(docF.shipTypes[0].spec));
  ok(capX === SHIP.fuelMax + 8 && farOk && SHIP.fuelCap === SHIP.fuelMax,
    'с доп. баком и экономичным варпом бак ' + capX + ' т и ' + far.name + ' — напрямую; сняли — снова '
    + SHIP.fuelCap + ' т');

  // Сверка с сервером: его бак — после снимка n; то, что игра потратила
  // после, вычитается, а долг по варпу — тоже, пока его не подтвердили.
  const r = F.resetFuelBook(makeShip());
  r.fuel = 9;
  r.burned = 2.0;
  F.applyServerFuel(r, 8.5, 1.9);
  ok(Math.abs(r.fuel - 8.4) < 1e-9, 'ответ сервера за вычетом расхода после снимка: 8.5 − 0.1 = '
    + r.fuel.toFixed(2));
  F.burnWarp(r, 4, true);
  const debt = r.warpDebt;
  F.applyServerFuel(r, 8.4, 2.0);
  ok(Math.abs(debt - 2) < 1e-9 && Math.abs(r.fuel - 6.4) < 1e-9,
    'неподтверждённый варп (2 т) вычитается из ответа сервера: ' + r.fuel.toFixed(2));
  F.warpSettled(r, 2);
  F.applyServerFuel(r, 6.4, 2.0);
  ok(r.warpDebt === 0 && Math.abs(r.fuel - 6.4) < 1e-9,
    'сохранение подтвердило варп — долг погашен, число сервера принято как есть');
  F.applyServerFuel(r, 50, null);
  ok(r.fuel === SHIP.fuelCap, 'больше бака сервер не нальёт даже в ответе: ' + r.fuel);

  // На телефоне клавиатуры нет, и буксир (U) — кнопка. Она есть, только
  // когда прыжков уже нет: в остальное время касание в её месте — это
  // осмотр камерой, а не вызов за шестьсот крон.
  const T = await import('../js/ui/touch.js');
  const lay = T.touchLayout(390, 844);
  const tow = lay.buttons.find((b) => b.id === 'tow');
  const tap = (offer) => {
    const t = T.makeTouch();
    t.tow = offer;
    T.touchUpdate(t, [{ id: 1, x: tow.x, y: tow.y }], lay);
    return t;
  };
  const hidden = tap(false), shown = tap(true);
  ok(tow && tow.code === 'KeyU' && !hidden.taps.has('tow') && hidden.look.id === 1
    && shown.taps.has('tow'),
    'кнопка буксира жмёт U только на резерве, а без него её место — осмотр камерой');
  ok(tow.x - tow.r >= 0 && tow.y - tow.r >= 0 && lay.buttons.every((b) => b === tow
    || Math.hypot(b.x - tow.x, b.y - tow.y) >= b.r + tow.r),
    'кнопка буксира на экране и ни на что не налезает');
}

// --- экран станции ---------------------------------------------------------------
//
// Разметку проверяем без браузера: экран — строка HTML из состояния, и
// всё, что в ней считается (сколько можно купить, во что обойдётся
// замена), видно по самим кнопкам.
{
  console.log('\n== экран станции ==');
  const S = await import('../js/ui/station.js');
  const { session: sess } = await import('../js/net/session.js');
  const F = await import('../js/game/fuel.js');
  const docF = JSON.parse(readFileSync('server/data/specs.json', 'utf8'));
  const wq = makeSystem(systemById(0));
  updateWorld(wq, 0);
  const port = wq.stations[0];
  const ship = F.resetFuelBook(makeShip());
  ship.dockedAt = port;
  ship.fuel = 5;
  const game = {
    ship, sys: systemById(0), stats: { docks: 3 },
    state: { mode: 'docked', messages: [] },
    player: { balance: 1000, cargo: [{ code: 'water', name: 'ВОДА', tons: 4, avgPrice: 20 }] },
    port: { tech: 5, fee: 90, repairRate: 15,
      services: { market: true, board: true, repair: true, outfit: true } },
    station: S.makeStation(),
  };
  game.station.at = port;
  const was = sess.mode;
  sess.mode = 'online';
  try {
    game.station.tab = 'market';
    game.station.market = {
      fuelPrice: 80,
      goods: [
        { code: 'water', name: 'ВОДА', category: 'сырьё', legal: true, price: 30, stock: 100 },
        { code: 'medicine', name: 'МЕДИКАМЕНТЫ', category: 'техника', legal: true, price: 700, stock: 5 },
        { code: 'stims', name: 'СТИМУЛЯТОРЫ', category: 'запрещённое', legal: false, price: 1450, stock: 0 },
      ],
    };
    const html = S.stationHtml(game);
    const maxOf = (code) => {
      const m = html.match(new RegExp('data-code="' + code + '"[^>]*data-tons="([0-9.]+)"[^>]*>МАКС'));
      return m ? +m[1] : null;
    };
    const free = SHIP.hold - 4;
    ok(maxOf('water') === Math.min(free, Math.floor(1000 / 30 * 10) / 10),
      'МАКС воды — сколько влезет в трюм: ' + maxOf('water') + ' т из свободных ' + free);
    ok(maxOf('medicine') === 1.4, 'МАКС медикаментов — на сколько хватит денег: ' + maxOf('medicine') + ' т');
    ok(/class="illegal"/.test(html) && /запрещено/.test(html), 'запрещённый товар помечен');
    ok(/data-act="sell"[^>]*data-code="water"[^>]*data-tons="4"/.test(html)
      && /\+40 кр/.test(html),
      'своя вода продаётся целиком, и видно, в плюс ли рейс: +40 кр');
    ok(/1 ПОРТ/.test(html) && /2 РЫНОК/.test(html) && /3 ВЕРФЬ/.test(html) && /4 ЗАПРАВКА/.test(html),
      'четыре раздела с номерами клавиш');

    game.station.tab = 'fuel';
    const fuelHtml = S.stationHtml(game);
    const room = SHIP.fuelCap - 5;
    ok(fuelHtml.includes('ДО ПОЛНОГО · ' + (Math.round(room * 10) / 10).toLocaleString('ru-RU') + ' т · '
      + Math.ceil(room * 80).toLocaleString('ru-RU') + ' кр'),
      'заправка до полного: ' + room + ' т по 80 кр');
    ok(/class="mark"/.test(fuelHtml), 'на шкале бака отмечен резерв');

    // Верфь: заводской двигатель можно только заменить, лучший модуль
    // столицы на верфи уровня 4 не продаётся, замена показывает зачёт.
    const mod = (code) => docF.modules.find((m) => m.code === code);
    game.station.tab = 'outfit';
    game.station.outfit = {
      open: true, resale: 0.6,
      slots: [
        { slot: 'engine', cap: 1, required: true,
          installed: [{ code: 'engine', name: mod('engine').name, price: 12000, resale: 7200, spec: mod('engine').spec }],
          offers: [{ code: 'engine_x', name: mod('engine_x').name, price: 31000, tech: 4, spec: mod('engine_x').spec,
            sold: true, credit: 7200, net: 23800 }] },
        { slot: 'drive', cap: 1, required: false,
          installed: [{ code: 'quantum', name: mod('quantum').name, price: 26000, resale: 15600, spec: mod('quantum').spec }],
          offers: [{ code: 'quantum_x', name: mod('quantum_x').name, price: 58000, tech: 5, spec: mod('quantum_x').spec,
            sold: false, credit: 15600, net: 42400 }] },
        { slot: 'tank', cap: 1, required: false, installed: [],
          offers: [{ code: 'tank_x', name: mod('tank_x').name, price: 14000, tech: 4, spec: mod('tank_x').spec,
            sold: true, credit: 0, net: 14000 }] },
      ],
    };
    const fit = S.stationHtml(game);
    ok(/только замена/.test(fit) && !/data-act="unfit"[^>]*data-code="engine"/.test(fit),
      'маршевый двигатель продать нельзя — только заменить');
    ok(/ПОСТАВИТЬ · 23[\s ]800 кр/.test(fit) && /с зачётом 7[\s ]200 кр/.test(fit),
      'замена двигателя: 23 800 кр с зачётом заводского');
    ok(/уровень 5/.test(fit) && !/data-code="quantum_x"/.test(fit),
      'привод второго поколения здесь не продают — сказано, где');
    ok(/ГНЕЗДО СВОБОДНО/.test(fit) && /data-act="fit"[^>]*data-code="tank_x"[^>]*disabled|disabled[^>]*data-act="fit"[^>]*data-code="tank_x"/.test(fit),
      'в пустое гнездо бака можно поставить, но на тысячу крон — не хватит, и кнопка заперта');
    ok(/data-act="unfit"[^>]*data-code="quantum"/.test(fit), 'квантовый привод продаётся');
    ok(/струя 20[\s ]000 км\/с/.test(fit) && /струя 14[\s ]500 км\/с/.test(fit),
      'двигатели сравниваются по струе: видно, что форсированный прожорливее');

    // Без сервера — честно, а не пустые таблицы.
    sess.mode = 'offline';
    game.station.tab = 'market';
    ok(/НЕТ СВЯЗИ С СЕРВЕРОМ/.test(S.stationHtml(game)), 'без сервера рынок говорит, что его нет');

    // Клавиши 1–4 переключают разделы.
    const keys = { pressed: (...c) => c.includes('Digit3') };
    game.state.mode = 'hold';                    // перерисовка без DOM не нужна
    ok(S.stationKeys(game, keys) && game.station.tab === 'outfit', 'клавиша 3 — верфь');
  } finally {
    sess.mode = was;
  }
}

// --- помещения корабля и пилот на ногах -----------------------------------
//
// js/models/interior.js и js/game/walker.js. Проверяется не картинка (её
// снимает tools/screen.mjs), а то, без чего ходить нельзя или нечестно:
// комнаты внутри корпуса, корпус в них вырезан, по кораблю проходится
// весь маршрут — от кресла до трюма и обратно, — двери открываются сами,
// ступени берутся ногой, голова не цепляет кромки проёмов, человек
// прыгает на свои сорок пять сантиметров.
{
  console.log('\n== помещения корабля ==');
  const { buildCobra } = await import('../js/models/ships.js');
  const I = await import('../js/models/interior.js');
  const Wk = await import('../js/game/walker.js');
  const { INTERIOR_PARTS } = await import('../js/models/interior.parts.js');
  const { EYE } = await import('../js/models/cockpit.js');
  const hull = buildCobra();
  const t0 = performance.now();
  const In = I.buildInterior(hull);
  const buildMs = performance.now() - t0;
  let tris = 0;
  for (const m of Object.values(In.meshes)) tris += m.tris;
  ok(tris > 50000 && tris < 260000 && buildMs < 2000,
    `собрано ${In.rooms.length} помещений: ${Math.round(tris / 1000)} тыс. треугольников за ${buildMs.toFixed(0)} мс`);

  // --- внутри корпуса. Точка внутри замкнутой обшивки видит её во все
  // шесть сторон. Проверяются грани коробки комнаты, раздутые на толщину
  // стен (0.45 м) и плитки (0.15 м): снаружи не должно торчать ничего.
  const MM = 1000;
  const T = [];
  for (const f of hull.faces) {
    for (let k = 1; k + 1 < f.v.length; k++) {
      T.push([f.v[0], f.v[k], f.v[k + 1]].map((i) => [hull.verts[i].x * MM, hull.verts[i].y * MM, hull.verts[i].z * MM]));
    }
  }
  const hits = (o, d) => {
    for (const [a, b, c] of T) {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-12) continue;
      const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
      const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
      if (u < 0 || u > 1) continue;
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
      const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
      if (v < 0 || u + v > 1) continue;
      if ((e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det > 0) return true;
    }
    return false;
  };
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const inside = (x, y, z) => DIRS.every((d) => hits([x + 0.0013, y + 0.0017, z + 0.0011], d));
  const outRooms = [];
  for (const r of In.rooms) {
    if (r.kind === 'bridge') continue;
    const L = [r.lo[0] - 0.45, r.lo[1] - 0.15, r.lo[2] - 0.45], H = [r.hi[0] + 0.45, r.hi[1] + 0.15, r.hi[2] + 0.45];
    const span = (a, b) => { const n = Math.max(1, Math.ceil((b - a) / 0.7)); return Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n); };
    let bad = 0;
    for (const x of span(L[0], H[0])) {
      for (const y of span(L[1], H[1])) {
        for (const z of span(L[2], H[2])) {
          if (x !== L[0] && x !== H[0] && y !== L[1] && y !== H[1] && z !== L[2] && z !== H[2]) continue;
          if (!inside(x, y, z)) bad++;
        }
      }
    }
    if (bad) outRooms.push(r.id + ' (' + bad + ')');
  }
  ok(outRooms.length === 0, 'все помещения со стенами и плиткой — внутри обшивки' +
    (outRooms.length ? ': торчат ' + outRooms.join(', ') : ''));

  // --- вырез корпуса: где комната, там обшивки изнутри нет, а фонарь
  // рубки остаётся целым.
  const inBox = (p, b, m = 0) => p[0] > b.lo[0] - m && p[0] < b.hi[0] + m && p[1] > b.lo[1] - m
    && p[1] < b.hi[1] + m && p[2] > b.lo[2] - m && p[2] < b.hi[2] + m;
  // Стекло фонаря не вырезается вовсе (правило шейдера), поэтому его в
  // комнатах быть не должно, а остальная обшивка в них — вся в вырезе.
  let uncut = 0, glassIn = 0;
  const { MAT } = await import('../js/models/hulldetail.js');
  const { MESH_FS } = await import('../js/gl/shaders.js');
  for (const f of hull.faces) {
    const P = f.v.map((i) => [hull.verts[i].x * MM, hull.verts[i].y * MM, hull.verts[i].z * MM]);
    const c = [0, 1, 2].map((a) => P.reduce((s, p) => s + p[a], 0) / P.length);
    for (const r of In.rooms) {
      if (r.kind === 'bridge' || !inBox(c, r)) continue;
      if (f.mat === MAT.glass) glassIn++;
      else if (!In.carve.some((b) => inBox(c, b))) uncut++;
    }
  }
  ok(In.carve.length <= 6 && uncut === 0 && glassIn === 0
    && new RegExp('floor\\(vMat \\+ 0\\.5\\) != ' + MAT.glass + '\\.0').test(MESH_FS),
    `корпус вырезан во всех помещениях (${In.carve.length} коробок), стекла фонаря в них нет, и шейдер его не режет`);

  // --- детали: всё, что лежит в паке, стоит в планировке.
  const src = (await import('node:fs')).readFileSync(new URL('../js/models/interior.js', import.meta.url), 'utf8');
  const unused = Object.keys(INTERIOR_PARTS).filter((n) => !new RegExp("'" + n + "'").test(src));
  ok(unused.length === 0, 'в паке помещений нет лишних деталей' + (unused.length ? ': ' + unused.join(', ') : ''));

  // --- трапы: ступень корабельная, а голова спускающегося проходит под
  // кромкой потолочного проёма.
  for (const s of In.stairs) {
    ok(s.r >= 0.17 && s.r <= 0.2 && Math.abs(Math.atan2(s.r, I.INT.tread) * 180 / Math.PI - 35) < 3,
      `трап ${s.id}: ${s.n} подъёмов по ${(s.r * 100).toFixed(1)} см, уклон ${(Math.atan2(s.r, I.INT.tread) * 180 / Math.PI).toFixed(0)}°`);
  }

  // --- свет: у каждой комнаты свой, и каждая лампа — в своей комнате.
  const lit = new Set(In.lamps.map((l) => l.room));
  const dark = In.rooms.filter((r) => r.kind !== 'bridge' && !lit.has(r.id)).map((r) => r.id);
  const strays = In.lamps.filter((l) => !inBox(l.pos, In.roomById[l.room], 0.01));
  ok(dark.length === 0 && strays.length === 0,
    `${In.lamps.length} ламп, ни одной комнаты без света и ни одной лампы вне своей комнаты`);
  ok(inBox([0, 0.5, -10], In.sunBox) && !inBox([0, -4.5, -18], In.sunBox) && !inBox([0, 1, -15.5], In.sunBox),
    'солнце и небо — только под стеклом рубки, в закрытых помещениях их нет');

  // --- видимость: за закрытой дверью комнаты не рисуются.
  for (const d of In.doors) d.open = 0;
  const seen = (id) => In.visibleNow(id).slice().sort().join(',');
  ok(seen('bridge') === 'bridge', 'сидя в рубке при закрытой двери видна одна рубка');
  ok(In.visibleNow('corridor').includes('hold') && !In.visibleNow('corridor').includes('cabin'),
    'из коридора виден трюм (трап — проём), а каюта за закрытой дверью — нет');
  In.doors.find((d) => d.id === 'cabin').open = 0.5;
  ok(In.visibleNow('corridor').includes('cabin'), 'дверь каюты открылась — каюта видна');
  for (const d of In.doors) d.open = 0;

  // --- груз: ящик на тонну, вдоль бортов, проход свободен.
  const slots = In.slots;
  let overlapPairs = 0, outHold = 0, inAisle = 0;
  const holdBox = In.roomById.hold;
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i];
    if (a.x - a.half < holdBox.lo[0] || a.x + a.half > holdBox.hi[0] || a.z - a.half < holdBox.lo[2]
      || a.z + a.half > holdBox.hi[2] || a.y + a.h > holdBox.hi[1]) outHold++;
    if (Math.abs(a.x) - a.half < 1.2) inAisle++;
    for (let j = i + 1; j < slots.length; j++) {
      const b = slots[j];
      if (Math.abs(a.x - b.x) < a.half + b.half - 1e-6 && Math.abs(a.z - b.z) < a.half + b.half - 1e-6
        && Math.abs(a.y - b.y) < Math.min(a.h, b.h) - 1e-6) overlapPairs++;
    }
  }
  ok(slots.length >= 36 && overlapPairs === 0 && outHold === 0 && inAisle === 0,
    `${slots.length} мест под ящики (трюм расширенный — 36 т): в трюме, без наложений, проход в 2.4 м свободен`);
  const crates = Wk.crateSolids(In, 13.2);
  ok(crates.length === 14, '13.2 т груза — 14 ящиков');

  // --- пилот: встал за креслом, ничего не задевая.
  const w = Wk.makeWalker();
  Wk.standUp(w, In);
  const W0 = { grid: Wk.solidGrid(In.solids), extra: [] };
  ok(!Wk.blocked(W0, w.pos) && Wk.nearSeat({ ...w, phase: 'walk' }, In),
    'встав, пилот стоит за креслом свободно — и сесть отсюда можно');
  const eye0 = Wk.walkerEye(w, In);
  ok(Math.abs(eye0[1] - EYE.y) < 1e-9 && Math.abs(eye0[2] - EYE.z) < 1e-9, 'в начале подъёма глаз — там же, где у сидящего пилота');
  for (let i = 0; i < 60; i++) Wk.updateWalker(w, In, {}, 1 / 60);
  const eye1 = Wk.walkerEye(w, In);
  ok(w.phase === 'walk' && Math.abs(eye1[1] - (I.INT.deck.bridge + Wk.WALK.eye)) < 0.01,
    `за ${Wk.WALK.rise} с встал: глаз на ${(eye1[1] - I.INT.deck.bridge).toFixed(2)} м над палубой`);

  // --- шаг, бег и прыжок — человеческие.
  {
    const p = Wk.makeWalker();
    Wk.standUp(p, In); p.phase = 'walk'; p.pos = [0, I.INT.deck.mid, -11.0]; p.room = In.roomById.corridor;
    for (let i = 0; i < 60; i++) Wk.updateWalker(p, In, { fwd: 1 }, 1 / 60);
    const walkV = Math.hypot(p.vel[0], p.vel[2]);
    for (let i = 0; i < 60; i++) Wk.updateWalker(p, In, { fwd: -1, run: true }, 1 / 60);
    const runV = Math.hypot(p.vel[0], p.vel[2]);
    for (let i = 0; i < 60; i++) Wk.updateWalker(p, In, {}, 1 / 60);
    const y0 = p.pos[1];
    let peak = y0;
    Wk.updateWalker(p, In, { jump: true }, 1 / 60);
    for (let i = 0; i < 90; i++) { Wk.updateWalker(p, In, {}, 1 / 60); peak = Math.max(peak, p.pos[1]); }
    ok(Math.abs(walkV - Wk.WALK.speed) < 0.01 && Math.abs(runV - Wk.WALK.run) < 0.01,
      `шаг ${walkV.toFixed(2)} м/с, бег ${runV.toFixed(2)} м/с`);
    ok(Math.abs(peak - y0 - Wk.WALK.jump) < 0.02 && p.ground && Math.abs(p.pos[1] - y0) < 1e-6,
      `прыжок с места — ${((peak - y0) * 100).toFixed(0)} см, и пилот вернулся на палубу`);
  }

  // --- весь корабль ногами: маршрут от кресла по всем помещениям и
  // обратно. Робот смотрит на точку и идёт вперёд; застрять — значит
  // упереться в стену, ступень выше порога или кромку проёма головой.
  {
    const p = Wk.makeWalker();
    Wk.standUp(p, In);
    for (let i = 0; i < 60; i++) Wk.updateWalker(p, In, {}, 1 / 60);
    const route = [
      ['bridge', 0, -13.6], ['shaftA', 0, -15.5], ['hall', 0, -23.6], ['hall', -2.0, -20.5],
      ['hall', 0, -15.5], ['corridor', 0, -11.5], ['cabin', -3.0, -11.5], ['corridor', 0, -11.5],
      ['medbay', 2.5, -8.5], ['corridor', 0, -8.5], ['storage', -2.5, -5.5], ['corridor', 0, -5.5],
      ['corridor', 0, -12.9], ['washroom', 2.4, -12.9], ['corridor', 0, -12.9], ['corridor', 0, -4.5], ['hold', 0, 2.5],
      ['hold', 0, 12.0], ['hold', 0, 2.0],
      // Нижний коридор, трап вверх к бортовому шлюзу, шлюз от гондолы до
      // гондолы, обратно — и носовой шлюз от борта до борта.
      ['hold', 2.6, 2.0], ['keel', 2.6, 0.0], ['keel', 2.6, -8.8], ['lockS', 2.6, -11.6],
      ['lockS', 12.8, -12.6], ['lockS', -12.8, -12.6], ['lockS', 2.6, -11.6], ['keel', 2.6, -9.6],
      ['keel', 2.6, 0.0], ['hold', 2.6, 2.2], ['hold', 0, 11.6], ['lockN', 0, 14.2], ['lockN', 3.4, 15.3],
      ['lockN', -3.4, 15.3], ['lockN', 0, 14.2], ['hold', 0, 11.0], ['hold', 0, 2.0],
      ['corridor', 0, -4.6], ['corridor', 0, -14.0],
      ['hall', -1.6, -21.0], ['hall', 0, -24.0], ['engine', 0, -26.0], ['hall', 0, -23.8],
      ['shaftA', 0, -15.4], ['bridge', 0, -12.0], ['bridge', 0, -8.6],
    ];
    const opened = new Set();
    let fail = null, time = 0, headBump = false;
    for (const [room, tx, tz] of route) {
      let t = 0, stuck = 0;
      let last = p.pos.slice();
      while (t < 25) {
        const dx = tx - p.pos[0], dz = tz - p.pos[2];
        if (Math.hypot(dx, dz) < 0.25) break;
        const want = Math.atan2(dx, dz);
        const turn = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw));
        const vy = p.vel[1];
        const ev = Wk.updateWalker(p, In, { fwd: 1, lookX: Math.max(-0.2, Math.min(0.2, turn)) }, 1 / 60);
        for (const id of ev.opened) opened.add(id);
        // Удар головой — это вертикальная скорость вверх, обнулённая не
        // землёй; на ходу без прыжков её быть не должно вовсе.
        if (vy > 0.5 && p.vel[1] === 0) headBump = true;
        t += 1 / 60;
        stuck = Math.hypot(p.pos[0] - last[0], p.pos[2] - last[2]) < 0.002 ? stuck + 1 : 0;
        last = p.pos.slice();
        if (stuck > 60) break;
      }
      time += t;
      const at = p.room && p.room.id;
      if (Math.hypot(tx - p.pos[0], tz - p.pos[2]) >= 0.3 || at !== room) {
        fail = `${room} (${tx}, ${tz}): стоит в ${at} на ${p.pos.map((v) => v.toFixed(2)).join(', ')}`;
        break;
      }
    }
    ok(!fail, 'весь корабль ногами — рубка, трап, кают-компания, коридор, каюта, медотсек, кладовая, ' +
      'санузел, трюм, нижний коридор, оба шлюза, машинное и обратно к креслу' +
      (fail ? ': застрял — ' + fail : ` за ${time.toFixed(0)} с ходьбы`));
    ok(opened.size === In.doors.length, `по дороге открылись все двери: ${[...opened].join(', ')}`);
    ok(!headBump, 'ни на трапах, ни в дверях голова ничего не задела');
    ok(Wk.nearSeat(p, In), 'вернувшись, пилот стоит у кресла');
    // Сесть.
    Wk.sitDown(p);
    let seated = false;
    for (let i = 0; i < 60 && !seated; i++) seated = Wk.updateWalker(p, In, {}, 1 / 60).seated;
    const e = Wk.walkerEye(p, In);
    ok(seated && !p.on && Math.abs(e[1] - EYE.y) < 1e-9 && Math.abs(e[2] - EYE.z) < 1e-9,
      `сел за ${Wk.WALK.sit} с: глаз снова на месте пилота`);
  }

  // --- двери: открываются, когда подходишь, закрываются, когда уходишь,
  // и закрытая не пускает.
  {
    const p = Wk.makeWalker();
    Wk.standUp(p, In); p.phase = 'walk';
    const d = In.doors.find((x) => x.id === 'cabin');
    d.open = 0;
    p.pos = [0, I.INT.deck.mid, -6.0]; p.room = In.roomById.corridor;
    for (let i = 0; i < 30; i++) Wk.updateWalker(p, In, {}, 1 / 60);
    const shut = d.open;
    p.pos = [0, I.INT.deck.mid, -11.5];
    for (let i = 0; i < 40; i++) Wk.updateWalker(p, In, {}, 1 / 60);
    const near = d.open;
    ok(shut === 0 && near === 1, `дверь каюты: вдали закрыта, в двух шагах открыта за ${Wk.WALK.doorTime} с`);
    // Закрытая не пускает: держим её закрытой и идём в неё.
    const W = { grid: Wk.solidGrid(In.solids), extra: [] };
    const doorBox = { lo: [-1.55, I.INT.deck.mid, -12.1], hi: [-0.85, I.INT.deck.mid + 2, -10.9] };
    W.extra.push(doorBox);
    ok(Wk.blocked(W, [-1.2, I.INT.deck.mid, -11.5]) && !Wk.blocked({ grid: W.grid, extra: [] }, [-1.2, I.INT.deck.mid, -11.5]),
      'в проёме двери тело упирается в створку, а открытый проём свободен');
    for (const x of In.doors) x.open = 0;
  }

  // --- шлюзы (js/game/airlock.js) --------------------------------------
  console.log('\n== шлюзы и трапы ==');
  const A = await import('../js/game/airlock.js');
  const O = await import('../js/game/outside.js');
  // Люки — те самые утопленные панели обшивки: у каждого в корпусе есть
  // грань по оси x на его глубине и с его краями (до двух миллиметров).
  {
    let found = 0;
    for (const h of In.hatches) {
      const hit = hull.faces.some((f) => {
        const P = f.v.map((i) => [hull.verts[i].x * MM, hull.verts[i].y * MM, hull.verts[i].z * MM]);
        const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]), zs = P.map((p) => p[2]);
        const near = (a, b) => Math.abs(a - b) < 0.002;
        return xs.every((x) => near(x, h.side * h.inset)) && near(Math.min(...ys), h.y[0]) && near(Math.max(...ys), h.y[1])
          && near(Math.min(...zs), h.z[0]) && near(Math.max(...zs), h.z[1]);
      });
      if (hit) found++;
    }
    ok(found === 4, `четыре люка — четыре утопленные панели корпуса (нашлось ${found}): у носа 3.1 × 3.8 м, у гондол 3.1 × 1.9 м`);
  }
  const gear = SHIP.gearClear * 1000;
  const air = A.makeAirlocks(In, SHIP.gearClear);
  const flatEnv = { pOut: 0, block: null, ground: () => -gear, occupied: () => false };
  const run = (env, sec) => {
    const evs = [];
    for (let i = 0; i < Math.round(sec * 60); i++) for (const e of A.updateAirlocks(air, env, 1 / 60)) evs.push({ ...e, t: i / 60 });
    return evs;
  };
  // Трап — ступени по двадцать сантиметров, уклон сорок градусов, и на
  // ровной площадке его пята ложится ровно на грунт.
  for (const hx of air.hatches.filter((x) => x.h.side > 0)) {
    const d = hx.design;
    const slope = Math.atan2(d.r, d.t) * 180 / Math.PI;
    const foot = A.stairPoint({ ...hx, swing: 0 }, 1, [d.foot[0], d.foot[1], 0]);
    ok(d.r > 0.19 && d.r < 0.21 && Math.abs(slope - 40) < 0.5 && Math.abs(foot[1] + gear) < 0.005,
      `трап ${hx.lock === 'lockN' ? 'носового' : 'бортового'} люка: ${d.n} подъёмов по ${(d.r * 100).toFixed(1)} см, ` +
      `${slope.toFixed(0)}°, пята на грунте стоянки (порог на ${(hx.h.y[0] + gear).toFixed(2)} м)`);
  }
  // Цикл: давление, люк, трап — по порядку и ни шагом раньше.
  {
    const hx = A.hatchById(air, 'sR'), L0 = air.locks.lockS;
    A.toggleHatch(air, hx);
    const env = { ...flatEnv, pOut: 0.35 };
    let order = [], pAtOpen = null;
    for (let i = 0; i < 60 * 10; i++) {
      for (const e of A.updateAirlocks(air, env, 1 / 60)) {
        order.push(e.kind);
        if (e.kind === 'hatch') pAtOpen = L0.p;
      }
    }
    ok(order.join(' ') === 'cycle hatch stair' && Math.abs(pAtOpen - 0.35) < 0.006 && hx.open === 1 && hx.stair === 1
      && In.doors.every((d) => !('locked' in d)),
      `открыть: давление стравлено до забортного (${pAtOpen && pAtOpen.toFixed(2)} бар), ` +
      `потом люк, потом трап: ${order.join(' → ')}; двери шлюз не запирает`);
    ok(hx.exitOk && Math.abs(hx.footGap) < 0.01, `трап на грунте: пята в ${(hx.footGap * 100).toFixed(1)} см от земли, сойти можно`);
    A.toggleHatch(air, hx);
    order = [];
    let sealedAt = null;
    for (let i = 0; i < 60 * 10; i++) {
      for (const e of A.updateAirlocks(air, env, 1 / 60)) {
        order.push(e.kind);
        if (e.kind === 'sealed') sealedAt = i / 60;
      }
    }
    ok(order.join(' ') === 'stair hatch cycle sealed' && L0.p === A.AIR.cabin && sealedAt !== null,
      `закрыть: трап, люк, наддув до давления корабля (задраен через ${sealedAt && sealedAt.toFixed(1)} с): ${order.join(' → ')}`);
  }
  // Запреты: в прыжке люк не открыть, а открытый закрывается сам.
  {
    const hx = A.hatchById(air, 'nL');
    A.toggleHatch(air, hx);
    run(flatEnv, 6);
    const was = hx.open;
    const blockEnv = { ...flatEnv, block: 'ЛЮКИ ЗАБЛОКИРОВАНЫ: КВАНТОВЫЙ ПРЫЖОК' };
    const ev = run(blockEnv, 0.1);
    const other = A.hatchById(air, 'sL');
    const refuse = A.toggleHatch(air, other);
    run(blockEnv, 8);
    ok(was === 1 && ev.some((e) => e.kind === 'forced') && refuse === blockEnv.block && hx.open === 0 && hx.stair === 0
      && !other.want && other.open === 0,
      'в прыжке люк не открывается («' + refuse + '»), а открытый закрывается сам');
    run(flatEnv, 6);
  }
  // Сойти можно, только если есть куда: в пустоте проём перекрыт, над
  // высоким грунтом у пяты трапа заслон.
  {
    const hx = A.hatchById(air, 'nR');
    A.toggleHatch(air, hx);
    run({ ...flatEnv, ground: () => null }, 8);
    const plug = A.airSolids(air).filter((s) => s.hatch === 'nR');
    const vacuum = !hx.exitOk && plug.length === 1 && Math.abs(plug[0].hi[2] - plug[0].lo[2] - (hx.h.z[1] - hx.h.z[0])) < 1e-9;
    run({ ...flatEnv, ground: () => -gear - 12 }, 3);
    const gate = A.airSolids(air).some((s) => s.stair === 'nR' && s.tag === 'gate');
    run(flatEnv, 3);
    const noGate = !A.airSolids(air).some((s) => s.stair === 'nR' && s.tag === 'gate');
    ok(vacuum && gate && noGate && hx.exitOk,
      'в пустоте проём перекрыт целиком; корабль висит высоко — у пяты трапа заслон; сел — заслона нет');
    // Трап доворачивается к грунту: площадка на метр выше — трап положе.
    run({ ...flatEnv, ground: () => -gear + 1 }, 3);
    ok(hx.swing > 0.05 && Math.abs(hx.footGap) < 0.02,
      `грунт выше на метр — трап довернулся на ${(hx.swing * 57.3).toFixed(1)}°, пята на земле`);
    run(flatEnv, 3);
  }
  // По трапу ногами — вниз до земли и обратно; голова ничего не задевает.
  {
    const tunnel = In.solids.filter((s) => (s.sill && /^[ns][LR]$/.test(s.sill)) || s.hatchWall);
    for (const id of ['nR', 'sL']) {
      const hx = A.hatchById(air, id);
      if (!hx.want) A.toggleHatch(air, hx);
      run(flatEnv, 8);
      const Wo = Wk.outsideWorld(tunnel.concat(A.airSolids(air)), () => -gear, null, 9.81);
      const p = Wk.makeWalker();
      Wk.standUp(p, In); p.phase = 'walk'; p.out = { test: true };
      const s = hx.h.side;
      p.pos = [s * (hx.h.skin - 0.3), hx.h.y[0], hx.zc];
      p.yaw = s * Math.PI / 2;
      let bump = false, t = 0;
      const far = Math.abs(A.stairPoint(hx, 1, [hx.design.foot[0] + 1.5, 0, 0])[0]);
      const floors = [];
      while (t < 12 && Math.abs(p.pos[0]) < far) {
        const vy = p.vel[1];
        Wk.updateWalker(p, In, { fwd: 1 }, 1 / 60, Wo);
        if (vy > 0.5 && p.vel[1] === 0) bump = true;
        if (p.ground && floors[floors.length - 1] !== p.floor) floors.push(p.floor);
        t += 1 / 60;
      }
      const down = Math.abs(p.pos[1] + gear) < 0.01 && floors.join(' ') === 'deck ground';
      p.yaw += Math.PI;
      let t2 = 0;
      while (t2 < 12 && Math.abs(p.pos[0]) > hx.h.skin - 0.2) { Wk.updateWalker(p, In, { fwd: 1 }, 1 / 60, Wo); t2 += 1 / 60; }
      const up = Math.abs(p.pos[1] - hx.h.y[0]) < 0.01;
      ok(down && up && !bump, `по трапу ${id === 'nR' ? 'носового' : 'бортового'} люка: вниз за ${t.toFixed(1)} с, ` +
        `наверх за ${t2.toFixed(1)} с, головой не задели ничего`);
    }
    A.resetAirlocks(air);
  }
  // Давление — по помещениям. Люк открыт в пустоту, дверь шлюза закрыта —
  // в трюме воздух остаётся. Дверь открылась — уходит всё, что связано с
  // шлюзом проёмами (трюм, трап, коридор, кают-компания, шахта трапа), а
  // за закрытыми дверями (рубка, каюта, медотсек, машинное…) остаётся.
  {
    const R = air.rooms, cab = A.AIR.cabin;
    const hx = A.hatchById(air, 'nR');
    const door = (id) => In.doors.find((x) => x.id === id);
    for (const x of In.doors) x.open = 0;
    A.toggleHatch(air, hx);
    run(flatEnv, 8);
    const behind = R.lockN.p < 0.001 && R.lockN.leak && R.hold.p === cab && !R.hold.leak;
    door('lockN').open = 1;
    const ev = run(flatEnv, 0.1);
    const rush = ev.find((e) => e.kind === 'rush' && e.id === 'lockN');
    let t01 = null;
    for (let i = 0; i < 60 * 30; i++) { run(flatEnv, 1 / 60); if (t01 === null && R.hold.p < 0.1) t01 = i / 60; }
    const gone = ['hold', 'shaftB', 'corridor', 'hall', 'shaftA'];
    const kept = ['bridge', 'cabin', 'storage', 'washroom', 'medbay', 'engine', 'keel', 'lockS'];
    let vol = 0, mass = 0;
    for (const r of Object.values(R)) { vol += r.V; mass += r.p * r.V; }
    ok(behind && rush && Math.abs(rush.dp - cab) < 1e-9 && gone.every((id) => R[id].p < 0.01 && R[id].leak)
      && kept.every((id) => R[id].p === cab && !R[id].leak) && t01 !== null,
      `люк открыт в пустоту: за закрытой дверью шлюза воздух остался; дверь открылась — трюм ниже 0.1 бар ` +
      `через ${t01 && t01.toFixed(1)} с, с ним ${gone.length - 1} помещения за проёмами; ` +
      `за закрытыми дверями (${kept.length}) — 1 бар`);
    // Дверь каюты открылась в пустой коридор — каюта пустеет за секунду.
    door('cabin').open = 1;
    let tc = null;
    for (let i = 0; i < 60 * 5; i++) { run(flatEnv, 1 / 60); if (tc === null && R.cabin.p < 0.1) tc = i / 60; }
    door('cabin').open = 0;
    // Дверь шлюза закрылась — отсек за ней закрыт от забортного, и корабль
    // набирает в нём воздух, хотя люк ещё открыт: 0.05 бар/с (соседи по
    // отсеку, где воздуха осталось чуть больше, немного помогают).
    door('lockN').open = 0;
    const p0 = R.hold.p;
    let tf = null;
    for (let i = 0; i < 60 * 30; i++) { run(flatEnv, 1 / 60); if (tf === null && R.hold.p === cab) tf = (i + 1) / 60; }
    ok(tc !== null && tc < 2 && tf !== null && tf <= (cab - p0) / A.AIR.supply + 0.05
      && tf > 0.9 * (cab - p0) / A.AIR.supply && R.cabin.p === cab
      && R.lockN.p < 0.001 && hx.open === 1,
      `каюта через открытую дверь — ниже 0.1 бар за ${tc && tc.toFixed(1)} с; дверь шлюза закрылась — ` +
      `жизнеобеспечение вернуло 1 бар за ${tf && tf.toFixed(1)} с, а в шлюзе с открытым люком пусто`);
    // Воздух не берётся ниоткуда: пока всё связано, его ровно столько, сколько было.
    for (const r of Object.values(R)) r.p = r.id === 'hold' ? 0.4 : 0.9;
    let m0 = 0;
    for (const r of Object.values(R)) m0 += r.p * r.V;
    for (const x of In.doors) x.open = 1;
    A.toggleHatch(air, hx);
    const keepSupply = A.AIR.supply, keepRate = A.AIR.rate;
    A.AIR.supply = 0; A.AIR.rate = 0;
    hx.open = 0; hx.stair = 0;
    run(flatEnv, 30);   // корабль — цепочка помещений через узкие проходы: секунды
    let m1 = 0, spread = 0;
    for (const r of Object.values(R)) { m1 += r.p * r.V; spread = Math.max(spread, Math.abs(r.p - m0 / vol)); }
    A.AIR.supply = keepSupply; A.AIR.rate = keepRate;
    ok(Math.abs(m1 - m0) < 1e-9 * m0 && spread < 1e-3,
      `двери нараспашку, люки закрыты, наддува нет: давление выровнялось до ${(m0 / vol).toFixed(3)} бар ` +
      `(разброс ${spread.toExponential(1)}), воздуха столько же — ${m1.toFixed(1)} бар·м³ из ${m0.toFixed(1)}`);
    for (const x of In.doors) x.open = 0;
    A.resetAirlocks(air);
  }
  // Люк открыт, а по кораблю ходят как обычно: дверь шлюза перед пилотом
  // открывается (он в скафандре), воздух трюма уходит, пока она открыта.
  {
    const hx = A.hatchById(air, 'nR'), R = air.rooms;
    A.toggleHatch(air, hx);
    run(flatEnv, 8);
    const p = Wk.makeWalker();
    Wk.standUp(p, In); p.phase = 'walk'; p.pos = [0, I.INT.deck.low, 14.2]; p.room = In.roomById.lockN; p.yaw = Math.PI;
    let low = 1, opened = false;
    const go = (tx, tz) => {
      for (let t = 0; t < 15 && Math.hypot(tx - p.pos[0], tz - p.pos[2]) >= 0.25; t += 1 / 60) {
        const want = Math.atan2(tx - p.pos[0], tz - p.pos[2]);
        const turn = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw));
        const ev = Wk.updateWalker(p, In, { fwd: 1, lookX: Math.max(-0.2, Math.min(0.2, turn)) }, 1 / 60);
        if (ev.opened.includes('lockN')) opened = true;
        A.updateAirlocks(air, flatEnv, 1 / 60);
        low = Math.min(low, R.hold.p);
      }
      return p.room && p.room.id;
    };
    const path = [go(0, 11.0), go(0, 4.0), go(0, 11.6), go(0, 14.2), go(3.4, 15.3)];
    ok(path.join(' ') === 'hold hold hold lockN lockN' && opened && hx.open === 1 && air.locks.lockN.state === 'open' && low < 0.9,
      `люк открыт, а ходить ничто не мешает: шлюз → трюм → обратно к люку (${path.join(' → ')}); ` +
      `пока дверь была открыта, в трюме упало до ${low.toFixed(2)} бар`);
    for (const x of In.doors) x.open = 0;
    A.resetAirlocks(air);
  }
  // За бортом — оси грунта: туда и обратно без потерь, «вверх» — от
  // центра тела, грунт — по радиусу, вода — стена.
  {
    const w0 = makeSystem(0x1a7e);
    const body = w0.home;
    let dry = null, coast = null;
    for (let i = 0; i < 6000 && !(dry && coast); i++) {
      const u = -0.5 + (i / 5999), a = i * 2.399963, s = Math.sqrt(1 - u * u);
      const d = normalize(v3(s * Math.cos(a), u, s * Math.sin(a)));
      if (!waterAt(body, d) && !dry && slopeAt(body, d) < 0.05) dry = d;
      if (waterAt(body, d) && !coast) {
        // Берег рядом: шагаем от воды, пока не выйдем на сушу.
        const t = normalize(v3(-d.z, 0, d.x));
        for (let k = 1; k < 5000; k++) {
          const q = normalize(v3(d.x + t.x * k * 0.002 / body.radius, d.y, d.z + t.z * k * 0.002 / body.radius));
          if (!waterAt(body, q)) { coast = { wet: d, dry: q, t }; break; }
        }
      }
    }
    const feet = worldPoint(body, dry, groundRadius(body, dry), v3());
    const G = O.makeGroundFrame(body, feet, v3(0, 0, 1));
    const P = O.groundToWorld(G, [12.5, 3.2, -40]);
    const back = O.worldToGround(G, P);
    const upW = O.groundDirToWorld(G, [0, 1, 0]);
    const rad = normalize(v3(feet.x - body.pos.x, feet.y - body.pos.y, feet.z - body.pos.z));
    const gy0 = O.groundY(G, 0, 0, groundRadius);
    ok(Math.hypot(back[0] - 12.5, back[1] - 3.2, back[2] + 40) < 1e-4 && dot(upW, rad) > 1 - 1e-9 && Math.abs(gy0) < 1e-6,
      'оси грунта: точка туда и обратно — до десятой мм, «вверх» — от центра тела, грунт под ногами на нуле');
    // Вода: берег — стена.
    if (coast) {
      const fe = worldPoint(body, coast.dry, groundRadius(body, coast.dry), v3());
      const Gc = O.makeGroundFrame(body, fe, dirToWorldBody(body, coast.t, v3()));
      const wc = Wk.makeWalker();
      Wk.standUp(wc, In); wc.phase = 'walk'; wc.out = Gc; wc.pos = [0, 0.05, 0];
      const Wc = Wk.outsideWorld([], (x, z) => O.groundY(Gc, x, z, groundRadius), (x, z) => O.waterUnder(Gc, x, z), 9.81);
      // Лицом к воде: она позади по направлению t (шли от воды к суше).
      wc.yaw = Math.PI;
      for (let i = 0; i < 60 * 8; i++) Wk.updateWalker(wc, In, { fwd: 1 }, 1 / 60, Wc);
      const atEdge = !O.waterUnder(Gc, wc.pos[0], wc.pos[2]);
      ok(atEdge && Math.hypot(wc.pos[0], wc.pos[2]) < 3,
        `у моря пилот останавливается на берегу: в воду не заходит (${Math.hypot(wc.pos[0], wc.pos[2]).toFixed(1)} м от начала)`);
    }
    // По рельефу — без остановок. Грунт был стенкой с допуском в 2 мм:
    // на подъёме ноги уходили под него на полтора миллиметра, опора их
    // не видела, следующий шаг в склон упирался и обнулял скорость — на
    // ровном подъёме в 15° пилот шёл полметра в секунду вместо двух и
    // «вяз». Теперь нога идёт по рельефу. Проверка: восемь направлений
    // на настоящем грунте, шагом и бегом, — скорость полная, ноги на
    // грунте, а не под ним и не над ним.
    {
      const gr = (x, z) => O.groundY(G, x, z, groundRadius);
      const Wg = Wk.outsideWorld([], gr, (x, z) => O.waterUnder(G, x, z), body.g0);
      let worst = Infinity, worstAt = '', stalls = 0, under = 0, air = 0, frames = 0, climb = 0;
      for (const run of [false, true]) {
        for (let k = 0; k < 8; k++) {
          const wg = Wk.makeWalker();
          Wk.standUp(wg, In); wg.phase = 'walk'; wg.out = G;
          wg.pos = [0, gr(0, 0), 0]; wg.yaw = k * Math.PI / 4;
          const want = run ? Wk.WALK.run : Wk.WALK.speed;
          let dist = 0;
          for (let i = 0; i < 60 * 12; i++) {
            const p0 = wg.pos.slice();
            Wk.updateWalker(wg, In, { fwd: 1, run }, 1 / 60, Wg);
            if (i < 30) continue;          // разгон
            const d = Math.hypot(wg.pos[0] - p0[0], wg.pos[2] - p0[2]);
            dist += d; frames++;
            climb = Math.max(climb, Math.abs(wg.pos[1] - p0[1]) / Math.max(d, 1e-9));
            if (d < want / 60 * 0.5) stalls++;
            const gap = wg.pos[1] - gr(wg.pos[0], wg.pos[2]);
            if (gap < -1e-6) under++;
            if (!wg.ground) air++;
          }
          const v = dist / (12 - 0.5);
          if (v / want < worst) { worst = v / want; worstAt = `${run ? 'бег' : 'шаг'} ${k * 45}°`; }
        }
      }
      ok(worst > 0.99 && stalls === 0 && under === 0 && air === 0,
        `по рельефу ${body.name} в восьми направлениях шагом и бегом: худшая скорость — ${(worst * 100).toFixed(1)}% ` +
        `(${worstAt}), остановок ${stalls}, ноги под грунтом ${under} раз, в воздухе ${air} кадров из ${frames}; ` +
        `самый крутой участок пути — ${(Math.atan(climb) * 180 / Math.PI).toFixed(0)}°`);
    }
    // Шаги (звук): нога встаёт раз в полпериода качания головы — шагом
    // через 0.75 м, бегом через 1.4 (бегут шире, а не чаще). Пол —
    // грунт, а на палубе — палуба; прыжок кончается слышным приземлением.
    {
      const count = (W, out, run, secs) => {
        const p = Wk.makeWalker();
        Wk.standUp(p, In); p.phase = 'walk'; p.out = out;
        p.pos = out ? [0, W.ground(0, 0), 0] : [0, I.INT.deck.low, 3.0];
        p.yaw = out ? 0.7 : 0;
        if (!out) p.room = In.roomById.hold;
        for (let i = 0; i < 60; i++) Wk.updateWalker(p, In, { fwd: 1, run }, 1 / 60, W);   // разгон
        let n = 0;
        const floors = new Set();
        for (let i = 0; i < Math.round(secs * 60); i++) {
          const ev = Wk.updateWalker(p, In, { fwd: out || i % 120 < 60 ? 1 : -1, run }, 1 / 60, W);
          if (ev.step) n++;
          floors.add(p.floor);
        }
        return { rate: n / secs, floors: [...floors].join('/') };
      };
      const Wg = Wk.outsideWorld([], (x, z) => O.groundY(G, x, z, groundRadius), null, body.g0);
      const walkOut = count(Wg, G, false, 6), runOut = count(Wg, G, true, 6);
      const deck = count(null, null, false, 2);
      // Прыжок на палубе: приходят на ноги со скоростью отрыва.
      const pj = Wk.makeWalker();
      Wk.standUp(pj, In); pj.phase = 'walk'; pj.pos = [0, I.INT.deck.low, 6.0]; pj.room = In.roomById.hold;
      Wk.updateWalker(pj, In, {}, 1 / 60);
      Wk.updateWalker(pj, In, { jump: true }, 1 / 60);
      let land = 0;
      for (let i = 0; i < 90 && !land; i++) { const ev = Wk.updateWalker(pj, In, {}, 1 / 60); if (ev.step && ev.step.land) land = ev.step.land; }
      const wantWalk = Wk.WALK.speed / Wk.WALK.stride, wantRun = Wk.WALK.run / Wk.WALK.strideRun;
      ok(Math.abs(walkOut.rate - wantWalk) < 0.25 && Math.abs(runOut.rate - wantRun) < 0.25 && walkOut.floors === 'ground'
        && deck.floors === 'deck' && Math.abs(land - Wk.jumpSpeed()) < 0.2,
        `шаги: по грунту ${walkOut.rate.toFixed(2)} в секунду шагом и ${runOut.rate.toFixed(2)} бегом ` +
        `(${wantWalk.toFixed(2)} и ${wantRun.toFixed(2)} по длине шага), пол — ${walkOut.floors}; в трюме — ${deck.floors}; ` +
        `прыжок кончается приземлением на ${land.toFixed(2)} м/с`);
    }
    // Днище — твёрдое над пилотом под кораблём, но не у порога люка.
    const t0u = performance.now();
    const map = O.hullUnderside(hull);
    const msU = performance.now() - t0u;
    const under = O.undersideBoxes(map, [0, -gear, 0], 1, []);
    const atHatch = O.undersideBoxes(map, [4.9, -8.84, 15.3], 1, []);
    ok(under.length > 0 && under.every((b) => b.lo[1] > -9.8 && b.lo[1] < -5) && atHatch.length === 0 && msU < 500,
      `днище корабля над пилотом твёрдое (низ — ${Math.min(...under.map((b) => b.lo[1])).toFixed(2)} м), а у порога люка ` +
      `коробок нет; карта днища — за ${msU.toFixed(0)} мс`);
    // Прыжок за бортом — по тяжести тела: толчок ногами тот же.
    const icy = w0.bodies.find((b) => b.kind === 'ice' && b.g0 < 1);
    const g = icy ? icy.g0 : 1.0;
    const wj = Wk.makeWalker();
    Wk.standUp(wj, In); wj.phase = 'walk'; wj.out = { test: true }; wj.pos = [0, 0, 0];
    const Wj = Wk.outsideWorld([], () => 0, null, g);
    let peak = 0;
    Wk.updateWalker(wj, In, { jump: true }, 1 / 60, Wj);
    for (let i = 0; i < 60 * 12; i++) { Wk.updateWalker(wj, In, {}, 1 / 60, Wj); peak = Math.max(peak, wj.pos[1]); }
    const want = Wk.jumpSpeed() ** 2 / (2 * g);
    ok(Math.abs(peak - want) / want < 0.03 && wj.ground,
      `на ${icy ? icy.name : 'лёгком теле'} (${g.toFixed(2)} м/с²) прыгают на ${peak.toFixed(2)} м, а не на ${Wk.WALK.jump} — толчок тот же`);
    // obSpan — какие высоты занимает повёрнутая коробка над прямоугольником
    // плана — против точного ответа: всех вершин пересечения коробки со
    // столбом над прямоугольником (тройки из десяти плоскостей).
    {
      let seed = 7;
      const rnd = (a, b) => { seed = (seed * 16807) % 2147483647; return a + (b - a) * (seed / 2147483647); };
      const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      let worst = 0, wrong = 0, met = 0;
      for (let it = 0; it < 3000; it++) {
        const f = [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)]; let l = Math.hypot(...f); f.forEach((v, i) => { f[i] = v / l; });
        let u = [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)]; const k = u[0] * f[0] + u[1] * f[1] + u[2] * f[2];
        u = u.map((v, i) => v - k * f[i]); l = Math.hypot(...u); u = u.map((v) => v / l);
        const r = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]];
        const R = [r[0], u[0], f[0], r[1], u[1], f[1], r[2], u[2], f[2]];
        const t = [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)];
        const lo = [rnd(-1, 0), rnd(-1, 0), rnd(-1, 0)];
        const hi = [lo[0] + rnd(0.02, 1.5), lo[1] + rnd(0.02, 1.5), lo[2] + rnd(0.02, 1.5)];
        const x0 = rnd(-1.5, 1), x1 = x0 + rnd(0.1, 0.8), z0 = rnd(-1.5, 1), z1 = z0 + rnd(0.1, 0.8);
        const P = [];
        for (let a = 0; a < 3; a++) {
          const ax = [R[a], R[3 + a], R[6 + a]], o = ax[0] * t[0] + ax[1] * t[1] + ax[2] * t[2];
          P.push([ax, hi[a] + o], [ax.map((v) => -v), -(lo[a] + o)]);
        }
        P.push([[1, 0, 0], x1], [[-1, 0, 0], -x0], [[0, 0, 1], z1], [[0, 0, -1], -z0]);
        let ymin = Infinity, ymax = -Infinity;
        for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) for (let m = j + 1; m < 10; m++) {
          const M = [P[i][0], P[j][0], P[m][0]], b = [P[i][1], P[j][1], P[m][1]], D = det3(M);
          if (Math.abs(D) < 1e-12) continue;
          const x = [0, 1, 2].map((c) => det3(M.map((row, ri) => row.map((v, ci) => (ci === c ? b[ri] : v)))) / D);
          if (P.every(([n, c]) => n[0] * x[0] + n[1] * x[1] + n[2] * x[2] <= c + 1e-9)) {
            ymin = Math.min(ymin, x[1]); ymax = Math.max(ymax, x[1]);
          }
        }
        const got = Wk.obSpan({ R, t, lo, hi }, x0, x1, z0, z1);
        if (ymin === Infinity) { if (got) wrong++; continue; }
        met++;
        if (!got) { wrong++; continue; }
        worst = Math.max(worst, Math.abs(got[0] - ymin), Math.abs(got[1] - ymax));
      }
      ok(wrong === 0 && worst < 1e-9 && met > 500,
        `повёрнутая коробка над следом ног — точно: ${met} пересечений из 3000, расхождение ${worst.toExponential(1)} м, ошибок «есть/нет» ${wrong}`);
    }
    // Проём на склоне. Корабль стоит с креном или тангажом до 20°, а
    // человек за бортом — по отвесу: проём бортового люка (1.86 м при росте
    // 1.8) для него наклонён. Твёрдое корабля ложится в оси грунта
    // повёрнутыми коробками (ob, js/game/walker.js): охватывающие на крене
    // раздуваются и запирают проём — тело на пороге сидело в них с первого
    // кадра. Здесь — то же твёрдое, что собирает игра (порог, щёки, притолока,
    // трап), повёрнутое на 15° четырьмя способами.
    {
      const av = A.makeAir(In, SHIP.gearClear);
      const hx = av.hatches.find((x) => x.id === 'sR');
      Object.assign(hx, { open: 1, stair: 1, want: true, exitOk: true, swing: 0, footGap: 0 });
      // Трап доворачивается к грунту (до ±15°): на крене он и в осях грунта
      // остаётся около своих 40°, а не 25 и не 55.
      const solidsAt = (swing) => {
        hx.swing = swing;
        return In.solids.filter((s) => s.sill === 'sR' || s.hatchWall === 'sR')
          .concat(A.airSolids(av, []).filter((s) => s.hatch === 'sR' || s.stair === 'sR'));
      };
      let solids = solidsAt(0);
      const hg = A.hinge(hx);
      const turn = (axis, deg) => {
        const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
        const R = axis === 'крен' ? [c, -s, 0, s, c, 0, 0, 0, 1] : [1, 0, 0, 0, c, -s, 0, s, c];
        const t = [0, 1, 2].map((i) => -(R[i * 3] * hg[0] + R[i * 3 + 1] * hg[1] + R[i * 3 + 2] * hg[2]));
        return { R: new Float64Array(R), t };
      };
      const worldOf = (T, exact) => Wk.outsideWorld(solids.map((s) => {
        const o = O.boxToGround(T, s);
        if (exact) o.ob = { R: T.R, t: T.t, lo: s.lo, hi: s.hi };
        return o;
      }), () => -6, null, 9.81);
      const toShip = (T, g) => O.groundPointToShip(T, g);
      const toGround = (T, p) => O.shipPointToGround(T, p);
      // Идёт по оси трапа — как игрок, который его видит: на точку.
      const aim = (wk, p) => { wk.yaw = Math.atan2(p[0] - wk.pos[0], p[2] - wk.pos[2]); };
      const rows = [];
      let oldStuck = 0, allGood = true;
      for (const [axis, deg] of [['крен', 15], ['крен', -15], ['тангаж', 15], ['тангаж', -15]]) {
        const T = turn(axis, deg);
        solids = solidsAt(axis === 'крен' ? -deg * Math.PI / 180 : 0);
        const Wold = worldOf(T, false), Wnew = worldOf(T, true);
        if (Wk.blocked(Wold, [0, 0, 0])) oldStuck++;
        const at = Wk.standAt(Wnew, [0, 0, 0]);
        // С трапа (пятая ступень, метр с лишним за бортом) — в тоннель.
        const d = hx.design;
        const p0 = toGround(T, A.stairPoint(hx, 1, [4.5 * d.t, -5 * d.r, 0]));
        const st = Wk.standAt(Wnew, p0);
        const wk = Wk.makeWalker();
        Wk.standUp(wk, In); wk.phase = 'walk'; wk.out = { test: true };
        let inside = false, minH = Wk.WALK.height, outside = false;
        if (st) {
          wk.pos = st.pos; wk.height = st.height;
          for (let i = 0; i < 60 * 6 && !inside; i++) {
            aim(wk, toGround(T, [hx.h.side * (hx.h.skin - 0.5), hx.h.y[0], hx.zc]));
            Wk.updateWalker(wk, In, { fwd: 1 }, 1 / 60, Wnew);
            minH = Math.min(minH, wk.height);
            inside = hx.h.side * toShip(T, wk.pos)[0] < hx.h.skin - 0.1;
          }
          // И обратно наружу — на ту же ступень.
          for (let i = 0; i < 60 * 6 && !outside; i++) {
            aim(wk, toGround(T, A.stairPoint(hx, 1, [6 * d.t, -6 * d.r, 0])));
            Wk.updateWalker(wk, In, { fwd: 1 }, 1 / 60, Wnew);
            minH = Math.min(minH, wk.height);
            outside = hx.h.side * toShip(T, wk.pos)[0] > hx.h.skin + 1.0;
          }
        }
        const good = !!at && !!st && inside && outside && minH >= Wk.WALK.duck;
        allGood = allGood && good;
        rows.push(`${axis} ${deg}°: ${good ? 'да' : 'НЕТ (' + (!at ? 'на пороге не встать' : !st ? 'на ступени не встать' : !inside ? 'в тоннель не дошли' : !outside ? 'наружу не вышли' : 'присел ниже предела') + ')'}` + (minH < Wk.WALK.height - 0.01 ? ' пригнувшись до ' + minH.toFixed(2) + ' м' : ''));
      }
      ok(allGood && oldStuck >= 3,
        `бортовой люк на склоне: встать на пороге, с трапа в тоннель и обратно — ${rows.join(', ')}; ` +
        `охватывающими коробками тело на пороге упиралось в ${oldStuck} случаях из 4`);
    }
  }
}

// --- сенсорный набор пилота на ногах ---------------------------------------
//
// На ногах полётных кнопок нет: на их местах — прыжок, бег и «сесть», а
// ползунок тяги палец не ловит (тягой на ногах не управляют).
{
  console.log('\n== пилот на ногах: телефон ==');
  const lay = touchLayout(852, 393, { left: 59, right: 0, bottom: 21, top: 0 });
  const tapAt = (walk, id, extra = {}) => {
    const t = Object.assign(makeTouch(), { walk }, extra);
    const b = lay.buttons.find((x) => x.id === id);
    touchUpdate(t, [{ id: 1, x: b.x, y: b.y }], lay);
    return t;
  };
  const jump = tapAt(true, 'wJump');
  const boost = tapAt(false, 'boost');
  ok(jump.taps.has('wJump') && jump.press.get(1) === 'wJump',
    'на ногах кнопка под правым большим пальцем — прыжок (Space)');
  ok(boost.press.get(1) === 'boost', 'в кресле на том же месте — форсаж, как и было');
  const sitNo = tapAt(true, 'wSit');
  const sitYes = tapAt(true, 'wSit', { seat: true });
  ok(!sitNo.taps.has('wSit') && sitYes.taps.has('wSit'), 'кнопка «сесть» — только у кресла');
  const hatchNo = tapAt(true, 'wHatch');
  const hatchYes = tapAt(true, 'wHatch', { hatch: true });
  ok(!hatchNo.taps.has('wHatch') && hatchYes.taps.has('wHatch'), 'кнопка «люк» — только когда люк под рукой');
  const standOff = tapAt(false, 'stand');
  const standOn = tapAt(false, 'stand', { stand: true });
  ok(!standOff.taps.has('stand') && standOn.taps.has('stand'), 'кнопка «встать» — когда помещения собраны');
  const t = Object.assign(makeTouch(), { walk: true });
  touchUpdate(t, [{ id: 3, x: lay.thr.x, y: lay.thr.y - lay.thr.h / 2 + 4 }], lay);
  const sh = { throttle: 0.2 };
  touchApply(t, sh);
  ok(t.thr.id === null && sh.throttle === 0.2, 'на ногах ползунок тяги палец не ловит: тяга не меняется');
}

// Пилот и корабль — разные вещи (схема 10): чужие корабли приходят в
// осях тела, люди — в осях того, на чём стоят, у каждого корабля свои
// люки, а фигура пилота идёт ногами по пройденному пути.
{
  console.log('\n== пилот и корабль: чужие корабли и люди ==');
  const P = await import('../js/game/peers.js');
  const Vs = await import('../js/game/vessels.js');
  const A = await import('../js/game/airlock.js');
  const W = await import('../js/game/world.js');
  const G = await import('../js/game/galaxy.js');
  const world = W.makeSystem(G.systemById(0));
  W.updateWorld(world, 3600);
  const body = world.bodies.find((b) => b.name === 'Lave II');

  // Стоящий корабль соседа: в осях тела он стоит, хотя тело за четверть
  // секунды опоздания картинки провернулось. В мировых осях он бы уехал.
  {
    const st = P.makePeers();
    // На экваторе (ось вращения — верх тела): там грунт идёт быстрее всего.
    const l = { x: body.radius + 0.006, y: 0, z: 10 };
    const shot = (t) => P.ingestPeers(st, [{ id: 5, by: 2, name: 'Б', mode: 'landed', sys: 0, b: body.id,
      lx: l.x, ly: l.y, lz: l.z, lfx: 0, lfy: 0, lfz: 1, lux: 0, luy: 1, luz: 0, g: 1, h: ['nL'] }], t);
    shot(10); shot(10.2);
    const was = Vs.bodyWorld(body, l);
    // Мир ушёл вперёд на секунду: тело повернулось.
    W.updateWorld(world, 1);
    const V = P.peerPoses(st, 10.3, [], world)[0];
    const want = Vs.bodyWorld(body, l);
    const off = Math.hypot(V.pos.x - want.x, V.pos.y - want.y, V.pos.z - want.z) * 1000;
    // Как было бы по мировым координатам: точка, снятая на секунду раньше.
    const drift = Math.hypot(was.x - want.x, was.y - want.y, was.z - want.z) * 1000;
    ok(V && off < 0.01 && V.gear.out && V.hatches[0] === 'nL' && V.body === body.id && V.by === 2,
      `стоящий корабль соседа — в осях тела: на месте с точностью ${off.toFixed(3)} м; `
      + `в мировых осях за секунду он уехал бы на ${drift.toFixed(0)} м`);
    // Без тела в мире (корабль в другой системе) — не показывается.
    ok(P.peerPoses(st, 10.3, [], null).length === 0, 'корабль у тела, которого здесь нет, не рисуется');
    // Сменил систему (варп) — прежние снимки не тянутся к новым.
    P.ingestPeers(st, [{ id: 5, sys: 3, x: 1e6, y: 0, z: 0 }], 10.4);
    ok(st.by.get(5).samples.length === 1 && st.by.get(5).out.sys === 3,
      'сменил систему — история снимков сброшена: корабль не летит сквозь полгалактики');
  }

  // Люди: точка в осях опоры, сменил опору — история заново; ноги идут
  // по пройденному пути.
  {
    const st = P.makePeople();
    const shot = (t, z, extra = {}) => P.ingestPeople(st, [Object.assign({ id: 9, name: 'АННА', st: 'walk', s: 5,
      x: 0, y: -9, z, yaw: 0, pitch: 0, v: 2, air: 0 }, extra)], t);
    shot(1, 0); shot(1.2, 0.4);
    const p = P.peoplePoses(st, 1.35, [], () => 1)[0];
    ok(p && p.ship === 5 && p.st === 'walk' && Math.abs(p.p[2] - 0.2) < 1e-9,
      'человек на палубе — между снимками, в осях корабля: z = ' + (p && p.p[2].toFixed(2)));
    const ph0 = p.phase;
    for (let i = 1; i <= 30; i++) P.peoplePoses(st, 1.35 + i / 60, [], () => 1.5);
    const ph1 = P.peoplePoses(st, 1.35 + 31 / 60, [], () => 1.5)[0].phase;
    ok(Math.abs((ph1 - ph0) - 2 * (31 / 60) / 1.5) < 0.02,
      `фаза шага — по пути: ${(ph1 - ph0).toFixed(3)} цикла за полсекунды на 2 м/с при цикле 1.5 м`);
    P.ingestPeople(st, [{ id: 9, st: 'out', b: 3, lx: 1, ly: 2, lz: 3, lfx: 1, lfy: 0, lfz: 0, v: 0 }], 1.4);
    ok(st.by.get(9).samples.length === 1, 'сошёл с трапа на грунт — история сброшена (оси другие)');
  }

  // Где в мире человек: ноги, «вверх» по кораблю или от центра тела.
  {
    const V = { pos: { x: 100, y: 50, z: -20 }, basis: makeBasis() };
    rotateBasis(V.basis, 0.3, 1.1, -0.2);
    const out = { pos: v3(), basis: makeBasis() };
    const okA = Vs.personPlace({ st: 'walk', p: [1.5, -9, 4], yaw: 0.7 }, V, null, out);
    const back = Vs.worldToVessel(V, out.pos);
    const ortho = Math.abs(dot(out.basis.right, out.basis.up)) + Math.abs(dot(out.basis.up, out.basis.fwd))
      + Math.abs(dot(out.basis.fwd, out.basis.right));
    const upOk = dot(out.basis.up, V.basis.up) > 0.9999;
    const okB = Vs.personPlace({ st: 'out', p: [0, body.radius, 0], face: { x: 1, y: 0, z: 0 } }, null, body, out);
    const r = v3(out.pos.x - body.pos.x, out.pos.y - body.pos.y, out.pos.z - body.pos.z);
    ok(okA && okB && Math.hypot(back[0] - 1.5, back[1] + 9, back[2] - 4) < 1e-6 && ortho < 1e-9 && upOk
      && dot(normalize(r), out.basis.up) > 0.99999,
      'человек на палубе стоит по палубе, на грунте — по вертикали тела; оси ортонормальны');
  }

  // У каждого корабля свои люки: открыл у соседа — у себя закрыт.
  {
    const { buildCobra } = await import('../js/models/ships.js');
    const I = await import('../js/models/interior.js');
    const In = I.buildInterior(buildCobra());
    const own = A.makeAirlocks(In, SHIP.gearClear);
    const other = A.makeAir(In, SHIP.gearClear);
    A.setHatches(other, ['sR'], true);
    const hx = A.hatchById(other, 'sR');
    ok(In.air === own && other !== own && hx.open === 1 && hx.stair === 1 && !A.hatchById(own, 'sR').want
      && A.openHatches(other).join() === 'sR' && other.locks.lockS.state === 'open',
      'люки — у каждого корабля свои: у соседа открыт и трап выдвинут, у своего закрыт');
  }

  // Фигура пилота: ноги не скользят. Человек идёт со скоростью v, фаза
  // шага копится по длине цикла, которую конвертер измерил по ступне, —
  // и ступня на грунте стоит на месте, пока тело идёт над ней.
  {
    const SU = await import('../js/models/spacesuit.js');
    const S = await SU.loadSuit();
    const bones = new Float32Array(S.bones * 16);
    // Вершина подошвы левого ботинка: самая низкая из тех, что целиком на Foot.L.
    const footL = 17;
    let foot = -1, low = Infinity;
    for (let v = 0; v < S.verts; v++) {
      if (S.joints[v * 4] === footL && S.weights[v * 4] === 255 && S.pos[v * 3 + 1] < low) { low = S.pos[v * 3 + 1]; foot = v; }
    }
    const slide = (v) => {
      const cyc = SU.suitCycle(S, v);
      const dt = 1 / 120, steps = Math.round(cyc / v / dt);
      let body = 0, phase = 0, prev = null, worst = 0, contact = 0;
      const q = [0, 0, 0];
      for (let i = 0; i < steps; i++) {
        SU.suitPose(S, { st: 'walk', v, phase, air: false }, 0, bones);
        SU.skinVertex(S, bones, foot, q);
        const wz = body + q[2];
        // На грунте — пока подошва на нём (в пределах 6 мм): отрыв пятки
        // и касание — уже не опора.
        if (q[1] < 0.006) {
          if (prev !== null) worst = Math.max(worst, Math.abs(wz - prev) / dt);
          prev = wz;
          contact++;
        } else prev = null;
        body += v * dt;
        phase += v * dt / cyc;
      }
      return { worst, contact: contact / steps, cyc };
    };
    const walk = slide(2.0), run = slide(4.6);
    ok(walk.contact > 0.2 && walk.worst < 0.35 && run.worst < 0.8,
      `ноги не скользят: ступня на грунте едет ${walk.worst.toFixed(2)} м/с при шаге 2 м/с `
      + `и ${run.worst.toFixed(2)} при беге 4.6 (цикл ${walk.cyc.toFixed(2)} и ${run.cyc.toFixed(2)} м; `
      + `без фазы по пути — 2 и 4.6)`);

    // Сидящий — головой на глаз кресла, и не сквозь пол рубки.
    const { buildCobra } = await import('../js/models/ships.js');
    const I = await import('../js/models/interior.js');
    const In = I.buildInterior(buildCobra());
    const at = SU.seatPlace(S, In.seat.eye, In.INT.deck.bridge);
    const head = at[1] + S.head.sit[1] + 0.12;
    const feet = at[1] + S.sitLow;
    ok(feet >= In.INT.deck.bridge - 1e-9 && Math.abs(head - In.seat.eye[1]) < 0.15,
      `сидящий в кресле: глаз на ${(head - In.seat.eye[1]).toFixed(2)} м от глаза кресла, `
      + `ступни на ${(feet - In.INT.deck.bridge).toFixed(2)} м над полом рубки — не сквозь него`);
  }
}

console.log('\n' + (fails === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : fails + ' ПРОВЕРОК УПАЛО'));
process.exit(fails ? 1 : 0);
