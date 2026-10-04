// Точка входа: сборка мира, игровой цикл с фиксированным шагом физики,
// обработка глобальных клавиш и отрисовка кадра.

import { v3, copy, normalize, dot, clamp } from './core/vec3.js';
import { makeBasis, dirToWorld, lookAlong } from './core/basis.js';
import { input } from './core/input.js';
import { sound } from './core/sound.js';
import { Renderer } from './render/renderer.js';
import { Camera } from './render/camera.js';
import { Starfield } from './render/starfield.js';
import { drawBody } from './render/planetview.js';
import { GlScene } from './gl/scene.js';
import { stageLift, legBoxes } from './models/gear.js';
import { hullOf, podOf, ROOMS_TYPE } from './models/hulls.js';
import { HULL } from './game/hull.js';
import { stationMesh } from './models/stations.js';
import { makeSystem, updateWorld, nearestBody } from './game/world.js';
import { homeSystem, systemById, systemDistance } from './game/galaxy.js';
import {
  makeWarp, updateWarp, startWarp, stopWarp, canWarp, placeAtStar, finishWarp,
} from './game/warp.js';
import { makeShip, updateShip, readControls, clearControls, placeShip, SHIP } from './game/ship.js';
import {
  makeNav, refreshNav, pickTarget, aimedTarget, currentTarget, navInfo, targetById,
  targetLabel,
} from './game/nav.js';
import {
  makeQuantum, updateQuantum, startCalibration, stopQuantum, abortQuantum,
  canJump, suggestHop, QUANTUM,
} from './game/quantum.js';
import {
  checkStation, startDockingComputer, stopDockingComputer,
  updateDockingComputer, DOCK_RANGE,
} from './game/docking.js';
import { isLandable, localDir, groundRadius, worldPoint } from './game/surface.js';
import { cityCrash, cityPadUnder, applyCities } from './game/city.js';
import { captureBody, carryShip, gravityField, gravityAt } from './game/gravity.js';
import { entryState, airDensity, ENTRY } from './game/entry.js';
import { makeDust, updateDust } from './game/dust.js';
import { makeChase, updateChase, placeChase, rotAround } from './game/chase.js';
import { makeFlow, updateFlow } from './game/flow.js';
import { makeYoke, updateYoke, EYE } from './models/cockpit.js';
import { makeDisplays, updateDisplays } from './ui/displays.js';
import {
  Q, DEVICE, toggleFullscreen, fullscreenAvailable, isFullscreen as isFull,
} from './core/quality.js';
import {
  makeTouch, touchLayout, touchUpdate, touchApply, touchDraw, touchDrag,
  fullscreenButton, drawFullscreenButton,
} from './ui/touch.js';
import {
  toggleGear, updateGear, gearLabel, landingContext,
  startLanding, stopLanding, updateLandingComputer, checkTouchdown, bounceOff, settle,
  updateLandedPose, takeoff, landingReadout, landedInfo, LAND,
} from './game/landing.js';
import { makeState, say, updateMessages, ST } from './game/state.js';
import { makeAudio, updateAudio, playAudio, audioCue, audioReset, audioLine } from './game/audio.js';
import { drawHud, makeDockAssist, fmtDist } from './ui/hud.js';
import { PEER } from './ui/theme.js';
import { SCANNER_STEPS } from './game/loadout.js';
import { devMode, soloMode } from './core/mode.js';
import { useShipType, useShipEquipment } from './game/specs.js';
import {
  showCrash, showHelp, hideOverlay, bootHtml, BOOT_START, BOOT_FULL,
} from './ui/screens.js';
import { showDocked, stationKeys, makeStation, syncFromServer } from './ui/station.js';
import {
  makeWalker, standUp, sitDown, seatNow, updateWalker, nearSeat, walkerEye, walkerLook, outsideWorld,
  standAt, deckWorld,
  crateSolids, stepDoors, WALK,
} from './game/walker.js';
import { drawWalkHud } from './ui/walkhud.js';
import {
  makeAirlocks, makeAir, updateAirlocks, toggleHatch, closeAll, resetAirlocks, hatchNear, tunnelAt, pastSkin,
  onStair, airSolids, lockStatus, roomAir, openHatches, setHatches, hatchById, AIR,
} from './game/airlock.js';
import { panelNear, startRide, stepRide, cancelRide } from './game/lift.js';
import { routeTo, deckOf } from './game/route.js';
import { makeDeckMap, openDeckMap, deckMapKeys, deckMapClick, deckMapHover, drawDeckMap, roomName, DECKMAP_CLOSE } from './ui/deckmap.js';
import {
  vesselPoint, vesselDir, worldToVessel, nearVessels, bodyLocal, bodyLocalDir, bodyWorld, bodyWorldDir,
  personPlace,
} from './game/vessels.js';
import {
  makeGroundFrame, groundToWorld, groundDirToWorld, worldToGround, groundY, waterUnder,
  shipToGround, shipPointToGround, groundPointToShip, boxToGround, RECENTER, hullUnderside, undersideBoxes,
} from './game/outside.js';
import {
  burnThrust, burnQuantum, burnWarp, warpSettled, applyServerFuel, resetFuelBook,
  fuelLevel, fuelReserve,
} from './game/fuel.js';
import { makeMap, drawMap, mapInput, resetMap } from './ui/map.js';
import { makeMenu, menuInput, drawMenu } from './ui/menu.js';
import { makePlayer, updatePlayer, savePlayer, loadPlayer, applyServer } from './game/player.js';
import {
  session, start as sessionStart, queueSave, flushOnExit,
  dock as serverDock, refresh as serverRefresh, repair as serverRepair, isOnline,
  rescue as serverRescue, command as serverCommand, flush as flushSave,
} from './net/session.js';
import { net, connect as netConnect, shoot, reportHit, reportImpact, askHatch }
  from './net/socket.js';
import { impact as apiImpact, system as apiSystem } from './net/api.js';
import { linkState } from './net/quality.js';
import {
  makePeers, ingestPeers, peerPoses, dropPeer, makePeople, ingestPeople, peoplePoses, dropPerson,
} from './game/peers.js';
import {
  makeGuns, updateGuns, fireGuns, addForeignBolt, aimDir, shieldFlash, hasShieldFlash,
} from './game/weapons.js';
import { makeClock, clockFromServer, clockTarget, clockStep } from './game/clock.js';
import { shipAnchor, anchorOk, anchorPose } from './game/anchor.js';
import { makeDebug, tickDebug, drawDebug } from './ui/debug.js';
import { drawPilots } from './ui/pilots.js';
import { gpuKind } from './gl/context.js';
import { terrainOf } from './gl/terrain.js';
import { growth } from './gl/flora.js';
import { L, initLang, setLang, getLang } from './core/lang.js';

const STEP = 1 / 60;
// v2 — после того, как в систему добавили три планеты. Сохранение хранит
// цель, порт и точку стоянки ИДЕНТИФИКАТОРАМИ тел, а те раздаются по
// порядку создания: новое тело в середине списка сдвигает все номера за
// собой. Старое сохранение открылось бы без ошибки и посадило бы корабль
// не туда — например, «на грунт» внутри газового гиганта. Ключ сменён,
// чтобы такой сейв просто не нашёлся; цена — один перезапуск от порта.
const SAVE_KEY = 'solar_trader_save_v2';

// Высоты для телепорта к цели (клавиша K) — от «вся планета в кадре» до
// «прямо над грунтом». Инструмент для проверки картинки: пройти весь
// диапазон подлёта за несколько нажатий, не тратя минуты на перелёт.
const TELEPORT_ALTS = [2000, 400, 100, 20, 3, 0.3, 0.05];

const screenCanvas = document.getElementById('screen');
const hudCanvas = document.getElementById('hud');
// Текущая система. Из её семени строится и небо: и звёзды, и полоса
// галактического диска, и туманности (js/render/starfield.js,
// js/gl/nebula.js). Всё это меняется вместе с системой при варп-прыжке —
// см. enterSystem.
let sys = homeSystem();
let starfield = new Starfield(Q.stars, sys.seed);

// Камера одна на всех: по ней считает и 3D-сцена, и прицельные рамки HUD.
const camera = new Camera();
const hud = new Renderer(hudCanvas, { transparent: true, camera });

// Сцена рисуется в WebGL2; Canvas-2D-рендер остаётся как запасной путь.
// Один canvas умеет держать только один тип контекста, поэтому выбор
// делается до создания любого из них.
const wantGl = (new URLSearchParams(location.search).get('renderer') || 'gl') !== '2d';
let scene = null;
let renderer = null;
if (wantGl) {
  scene = new GlScene(screenCanvas, camera, starfield);
  if (!scene.ok) {
    console.warn(L('WebGL2 недоступен (') + scene.error + L('), рисуем на Canvas 2D'));
    scene = null;
  }
}
if (!scene) renderer = new Renderer(screenCanvas, { camera });

let world = makeSystem(sys);
const ship = resetFuelBook(makeShip());
// Номер корабля на сервере (без сервера — null) и система, где он стоит.
// away — корабль в ДРУГОЙ системе: пилот улетел пассажиром, а свой
// корабль остался там, где стоял (keep — где именно).
ship.id = null;
ship.sysId = 0;
ship.away = false;
ship.keep = null;
ship.hatchesWant = null;
// Свой корпус — текущий (js/game/hull.js): по умолчанию «Челленджер»,
// а на чём пилот летит на самом деле, скажет сервер (syncHull).
let shipMesh = HULL.mesh;
let gearMesh = HULL.gear;
// Кабина есть только в объёмном рендере: на запасном пути Canvas-2D
// рисовать её нечем, и приборы там остаются по углам экрана, а стойки
// фонаря — штрихами поверх кадра (js/ui/hud.js). Поэтому game.cockpit
// значит ровно «в кадре есть настоящая кабина».
//
// Пост у каждого типа свой (js/models/hulls.js, podOf): доска под
// фонарём у «Челленджера», кресло командира со стойками экранов у
// «Прометея». Экраны кабины — холсты с софтом мониторов
// (js/ui/displays.js): их картинка уходит текстурой на мониторы поста,
// поэтому и они — у поста своего типа и только там, где кабина есть.
const screensOf = new Map();
function cockpitOf(code) {
  if (!scene) return null;
  const model = podOf(code);
  if (!model) return null;
  let screens = screensOf.get(code);
  if (!screens) {
    screens = makeDisplays(model, { density: Q.cabinDensity, atlasW: Q.cabinAtlas, rateK: Q.cabinRate });
    screensOf.set(code, screens);
  }
  return { model, screens };
}
const ownPod = cockpitOf(HULL.code);
const cockpitModel = ownPod ? ownPod.model : null;
const cockpitScreens = ownPod ? ownPod.screens : null;

const game = {
  world, ship, shipMesh, stationMesh, gearMesh,
  cockpit: cockpitModel,   // модель кабины: геометрия, ручка и РУД, экраны
  displays: cockpitScreens, // холсты экранов кабины (js/ui/displays.js)
  renderer: hud,
  renderStats: { polys: 0, items: 0, backend: scene ? 'WebGL' : 'Canvas 2D' },
  nav: makeNav(world),
  map: makeMap(),        // состояние карты системы: масштаб, центр, выбор
  menu: makeMenu(),      // меню пилота (I): корабль, груз, задания, финансы
  player: makePlayer(),  // кроны, трюм и задания — дела пилота, не корабля
  quantum: makeQuantum(),
  sys,                   // описание текущей системы из галактики
  warp: makeWarp(),      // межсистемный прыжок
  warpTarget: null,      // система, отмеченная целью на карте галактики
  state: makeState(),
  audio: makeAudio(),
  sound,                 // нужен отладочному оверлею: сэмплы или синтез
  info: null,
  nearest: null,
  dockAssist: null,
  aimed: null,           // цель под прицелом: её выберет Tab
  zone: null,            // обстановка у поверхности (высота, нормаль, грунт)
  entry: null,           // вход в атмосферу: нагрев, цвет и ось факела
  entryBuf: { dir: v3(), color: [0, 0, 0] },   // чтобы не сорить объектами
  dust: makeDust(),      // пыль из-под движков у самой земли
  flow: makeFlow(),      // пылинки за бортом: ими видно скорость и форсаж
  yoke: makeYoke(),      // положение ручки и РУДа в кабине (вид от 1-го лица)
  touch: makeTouch(),    // сенсорные органы: джойстик, тяга, кнопки
  capture: null,         // тело, в чьём гравитационном захвате корабль
  showPilots: false,     // показан ли список пилотов в сети (P)
  camOrbit: { yaw: 0, pitch: 0 },   // осмотр камерой из-за спины (ПКМ)
  // Камера из-за спины со своей инерцией: она догоняет корабль, а не
  // сидит на нём намертво (js/game/chase.js).
  chase: makeChase(),
  camera,                // та же камера, что у рендера: нужна приборам и проверкам
  landInfo: null,        // показания посадочного дисплея
  statusLine: null,
  scanBlips: [],
  scannerRange: 120,
  stats: { docks: 0, crashes: 0, flownKm: 0, landings: 0 },
  crashReason: '',
  lastStation: null,
  port: null,             // свойства порта с сервера: сбор, услуги, ставка ремонта
  peers: [],              // чужие корабли в этой системе (сокет)
  guns: makeGuns(),       // стволы, болты и перезарядка (js/game/weapons.js)
  targetHull: null,       // корпус цели: приходит от сервера при попадании
  hurt: 0,                // сколько ещё мигать после попадания В НАС, с
  landHold: 0,           // сколько уже держат клавишу взлёта на грунте
  teleAlt: 2,            // номер текущей высоты телепорта (клавиша K)
  restartArmed: 0,       // сколько ещё ждём подтверждения рестарта, с
  rescueArmed: 0,        // сколько ещё ждём подтверждения буксира, с
  station: makeStation(), // экран порта: раздел, прайс, верфь (js/ui/station.js)
  // Что уже сказано о баке: предупреждаем на КАЖДОМ пороге один раз, а
  // не каждый кадр, пока топлива мало.
  fuelSaid: 'ok',
  // Пилот на ногах (js/game/walker.js) и помещения корабля, по которым он
  // ходит (js/models/interior.js). Помещения грузятся лениво, после
  // первого кадра: это мегабайт деталей, и ждать его на старте незачем.
  walk: makeWalker(),
  interior: null,
  // План палубы (M на ногах) и путь по кораблю: куда идти, следующая
  // точка в кадре (js/ui/deckmap.js, js/game/route.js).
  deckMap: makeDeckMap(),
  walkGoal: null,
  walkGoalOf: null,
  walkRoute: null,
  walkEye: null,          // глаз идущего в осях корабля, м (null — сидит)
  walkRoomT: 0,           // сколько ещё показывать название помещения, с
  walkIntro: 0,           // сколько ещё показывать подсказку по клавишам, с
  walkHatch: null,        // люк под рукой (js/game/airlock.js) — для подсказки и E
  walkHatchShip: null,    // ...и чей это люк: свой корабль или чужой
  // ПИЛОТ И КОРАБЛЬ — РАЗНЫЕ ВЕЩИ. Корабль (ship) стоит, где оставили;
  // пилот ходит, где хочет: по своей палубе, по чужой, по грунту.
  // frame — корабль, в осях которого сейчас глаз и помещения: тот, на
  // борту которого пилот (свой или чужой), а за бортом и в кресле — свой.
  frame: null,
  // Люди, кроме нас самих (js/game/peers.js, peoplePoses): где стоят и
  // как идут. Рисует их сцена (js/gl/pilot.js), двери открывает ход.
  people: [],
  // Кораблей у пилота может быть несколько (Players::command): какие и где.
  fleet: [],
};

const dbg = makeDebug();
let booted = false;
const _sun = v3();
const _camDir = v3();
const _camRight = v3();
const _camUp = v3();
const _wLook = { fwd: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] };
const _tmp = v3();
// Куда уехало несущее тело за шаг мира: замер до и после updateWorld.
const _carried = v3();

// --- смена звёздной системы --------------------------------------------------

/**
 * Забрать у сервера города системы.
 *
 * Хозяин мира — сервер: где стоит город и как он зовётся, решает он, а
 * не клиент (js/game/city.js, applyCities). Клиент при этом собирает
 * систему сам и СРАЗУ — ответа он не ждёт: офлайн игра обязана работать
 * целиком, а генератор один и тот же, так что чаще всего ответ ничего
 * не меняет.
 *
 * Прицел сбрасывается только если набор городов ДЕЙСТВИТЕЛЬНО другой:
 * иначе ответ, пришедший через секунду после входа, сбивал бы уже
 * выбранную цель.
 */
function syncCities(target, forWorld) {
  if (netMode !== 'online') return;
  const was = forWorld.cities.map((c) => c.id).join(',');
  apiSystem(target.id).then((r) => {
    if (world !== forWorld || !r || !Array.isArray(r.cities)) return;
    applyCities(world, r.cities);
    if (world.cities.map((c) => c.id).join(',') !== was) game.nav = makeNav(world);
  }).catch(() => { /* сети нет — остаётся то, что клиент собрал сам */ });
}

/**
 * Перейти в другую систему: старую выгрузить целиком, новую собрать.
 *
 * Это самая опасная операция во всей игре, и опасна она не сборкой, а
 * ССЫЛКАМИ. Тела старого мира разложены по десятку мест: цель навигации,
 * захват, ближайшее тело, зона у поверхности, подсказка стыковки, отметки
 * сканера, слежение карты, порт, где стоит корабль. Любая уцелевшая
 * ссылка означает и утечку памяти (старая система не соберётся сборщиком
 * целиком), и настоящий баг: прибор показывал бы высоту над планетой,
 * которой в этой системе нет.
 *
 * Поэтому порядок такой: сперва оборвать ВСЁ, потом отпустить GPU, и
 * только потом собирать. Обратный порядок (собрать, потом выгрузить)
 * держал бы в памяти две системы разом — ровно то, чего просили не
 * делать, и то, что в сетевой игре недопустимо тем более.
 */
function enterSystem(target) {
  const old = world;

  // 1. Оборвать ссылки на тела старого мира.
  stopQuantum(game.quantum);
  stopLanding(ship);
  stopDockingComputer(ship);
  ship.dockedAt = null;
  ship.landedAt = null;
  ship.landedPose = null;
  game.capture = null;
  game.nearest = null;
  game.zone = null;
  game.entry = null;
  game.aimed = null;
  game.dockAssist = null;
  game.landInfo = null;
  game.lastStation = null;
  game.info = null;
  game.statusLine = null;
  game.scanBlips.length = 0;
  game.map.follow = null;
  game.map.hover = null;
  game.map.sel = null;
  game.map.items.length = 0;

  // 2. Отпустить видеопамять. Меши планет висят на телах старого мира, но
  //    буферы живут в драйвере, и сборщик мусора до них не дотянется.
  if (scene) scene.forgetSystem(old);

  // Чужие корабли и люди — той системы, что уходит: их номера тел в новой
  // значат другие тела. Остаётся только тот, на борту которого едем.
  const ride = game.walk.on && !game.walk.out && game.walk.vessel && !game.walk.vessel.own
    ? game.walk.vessel.id : null;
  for (const id of [...peerStore.by.keys()]) if (id !== ride) peerStore.by.delete(id);
  peopleStore.by.clear();
  game.people.length = 0;

  // 3. Собрать новую.
  sys = target;
  world = makeSystem(target);
  game.world = world;
  game.sys = target;
  game.nav = makeNav(world);
  starfield = new Starfield(Q.stars, target.seed);
  if (scene) scene.setStarfield(starfield);
  resetMap(game.map, world);
  // Мир собран заново и его часы стоят на нуле. Если общее время известно,
  // ставим его немедленно: иначе первый кадр после прыжка покажет орбиты
  // на момент рождения вселенной.
  if (worldAim !== null) updateWorld(world, worldAim);
  syncCities(target, world);
  return world;
}

// --- переходы состояний ------------------------------------------------------

/**
 * Встать в порт.
 *
 * @param {boolean} restoring — восстановление из сохранения, а не
 *   настоящая стыковка. Отличать обязательно: за настоящую сервер берёт
 *   сбор, и повторять его при каждой загрузке игры нельзя.
 */
function dockAt(station, restoring = false) {
  game.entry = null;
  ship.dockedAt = station;
  game.lastStation = station;
  stopDockingComputer(ship);
  stopLanding(ship);
  stopQuantum(game.quantum);
  ship.lift = 0;
  ship.gear.out = false;
  ship.speed = 0;
  ship.throttle = 0;
  // БЕСПЛАТНЫЙ РЕМОНТ остался только в автономной игре. С сервером у
  // корпуса появилась цена (station.repair), и чинить его даром за сам
  // факт стыковки значило бы обесценить и удары, и деньги разом. С баком
  // то же самое: с сервером заправка стоит денег (station.refuel), без
  // него порт заправляет даром — торговать там не с кем.
  if (!isOnline()) {
    ship.hull = SHIP.maxHull;
    ship.fuel = SHIP.fuelCap;
  }
  game.fuelSaid = 'ok';
  game.state.mode = ST.DOCKED;
  audioCue(game.audio, 'dock');
  audioReset(game.audio, ship);
  input.releaseAll();
  showDocked(game);
  save();

  if (!restoring && isOnline()) {
    // Сбор за место берёт сервер, и он же считает стыковки. Ответ придёт
    // фоном: ждать его, держа игрока в порту перед пустым экраном, незачем.
    serverDock(sys.id, station.id).then((r) => {
      if (!r) return;
      game.port = r.station;
      // Состояние целиком: деньги после сбора, а если стыковка оказалась
      // в новой системе — и бак после варпа, который сервер списал тут же.
      syncFromServer(game);
      if (r.fee > 0) {
        say(game.state, L('СТЫКОВОЧНЫЙ СБОР · ') + r.fee + L(' кр'), '#ffcc66', 3);
      }
      showDocked(game);
    });
  }
}

/** Ремонт в порту: кнопка на экране стыковки. */
game.repair = async () => {
  if (!isOnline()) return;
  try {
    const r = await serverRepair();
    ship.hull = r.hull;
    applyServer(game.player, session.player);
    say(game.state, L('РЕМОНТ КОРПУСА · −') + r.cost + L(' кр'), '#78e08f', 3);
  } catch (e) {
    say(game.state, L('РЕМОНТ: ') + e.message, '#ff7a66', 4);
  }
  showDocked(game);
};

game.launch = () => {
  const st = ship.dockedAt || game.lastStation;
  hideOverlay();
  game.state.mode = ST.FLIGHT;
  if (st) {
    const b = makeBasis();
    // Смотрим наружу от станции, крен согласован с портом.
    b.fwd = { ...st.basis.fwd };
    b.right = { ...st.basis.right };
    b.up = { ...st.basis.up };
    placeShip(ship, v3(
      st.pos.x + st.basis.fwd.x * (st.shape.D + 1.5),
      st.pos.y + st.basis.fwd.y * (st.shape.D + 1.5),
      st.pos.z + st.basis.fwd.z * (st.shape.D + 1.5)), b);
  }
  ship.dockedAt = null;
  audioReset(game.audio, ship);
  audioCue(game.audio, 'launch');
  say(game.state, L('ВЫЛЕТ РАЗРЕШЁН. УДАЧНОГО ПОЛЁТА.'), '#78e08f');
  input.releaseAll();
};

// --- посадка на поверхность ---------------------------------------------------

/**
 * Сесть там, где висишь, — без захода и касания. Не игровое действие:
 * им сцены снимков (tools/screen.mjs) и прогон (tools/smoke.mjs) ставят
 * корабль на грунт сразу, чтобы снимать стоянку, а не посадку.
 */
game.landHere = () => {
  const z = landingContext(world, ship);
  if (!z || game.state.mode !== ST.FLIGHT) return false;
  ship.gear.out = true;
  ship.gear.t = 1;
  landAt(z);
  game.zone = landingContext(world, ship);
  return true;
};

function landAt(zone, belly = false) {
  settle(ship, zone);
  audioCue(game.audio, belly ? 'belly' : 'land');
  audioReset(game.audio, ship);
  game.stats.landings++;
  stopQuantum(game.quantum);
  game.state.mode = ST.LANDED;
  // Касание — ещё не стоянка: корабль стоит на стойках с работающими
  // движками, и что делать дальше, решает пилот. Экрана поверх игры тут
  // больше нет: всё нужное говорит сам кадр (см. drawLandedPrompt).
  ship.secured = false;
  game.landHold = 0;
  input.releaseAll();
  save();
}

/** Зафиксировать корабль на грунте: замки стоек, движки в ноль. */
game.secure = () => {
  if (!ship.landedAt || ship.secured) return;
  ship.secured = true;
  ship.throttle = 0;
  ship.lift = 0;
  ship.control.lift = 0;
  audioCue(game.audio, 'gear', { out: false });
  audioReset(game.audio, ship);
  say(game.state, L('КОРАБЛЬ ЗАФИКСИРОВАН. ДВИГАТЕЛИ ОТКЛЮЧЕНЫ.'), '#78e08f');
  save();
};

game.takeoff = () => {
  hideOverlay();
  game.landHold = 0;
  if (!takeoff(ship)) { game.state.mode = ST.FLIGHT; return; }
  game.state.mode = ST.FLIGHT;
  audioReset(game.audio, ship);
  audioCue(game.audio, 'takeoff');
  say(game.state, L('ОТРЫВ. ШАССИ ВЫПУЩЕНО — УБРАТЬ КЛАВИШЕЙ G.'), '#78e08f');
  input.releaseAll();
};

game.respawn = () => {
  hideOverlay();
  ship.hull = SHIP.maxHull;
  // Страховка возвращает корабль с резервом в баке, не больше: так же
  // поступает сервер (Combat::respawn), иначе разбиться было бы дешевле,
  // чем заправиться.
  ship.fuel = Math.max(ship.fuel, fuelReserve());
  const st = game.lastStation || (world.home && world.home.station);
  if (st) dockAt(st);
  else { game.state.mode = ST.FLIGHT; }
};

// Сколько секунд ждём второго нажатия. Рестарт необратим и стирает
// сохранение, поэтому одной клавишей он не делается: первое нажатие
// только предупреждает.
const RESTART_CONFIRM = 3;

/**
 * Начать заново: то же состояние, что у первого запуска — корабль в
 * порту родной станции, корпус цел, счётчики обнулены, часы мира на
 * нуле. Сохранение переписывается сразу, иначе старое вернулось бы при
 * следующей загрузке страницы.
 *
 * Корабль именно ПЕРЕСОБИРАЕТСЯ по полям, а не создаётся заново: на него
 * держат ссылки и сцена, и приборы, и звук.
 */
game.restart = () => {
  seatPilot();
  stopDockingComputer(ship);
  stopLanding(ship);
  ship.landedAt = null;
  ship.landedPose = null;
  ship.dockedAt = null;
  ship.landing = null;
  ship.hull = SHIP.maxHull;
  ship.gear.out = false;
  ship.gear.t = 0;
  ship.lift = 0;
  ship.stun = 0;
  ship.zeroHold = 0;
  ship.boost = 1;
  ship.boosting = false;
  ship.fuel = SHIP.fuelCap;
  resetFuelBook(ship);
  placeShip(ship, v3(), makeBasis());
  // Корабль — снова здесь и свой: новая игра начинается в его кресле.
  ship.away = false;
  ship.keep = null;
  ship.sysId = homeSystem().id;

  // Начать заново — значит и вернуться домой: в чужой системе нет ни
  // родного порта, ни того, с чего игра начинается.
  stopWarp(game.warp);
  game.warpTarget = null;
  if (sys.seed !== homeSystem().seed) enterSystem(homeSystem());
  world.time = 0;
  updateWorld(world, 0);
  stopQuantum(game.quantum);
  game.stats = { docks: 0, crashes: 0, flownKm: 0, landings: 0 };
  game.player = makePlayer();
  game.menu.open = false;
  game.zone = null;
  game.capture = null;
  game.landInfo = null;
  game.dockAssist = null;
  game.statusLine = null;
  game.crashReason = '';
  game.camOrbit.yaw = 0;
  game.camOrbit.pitch = 0;
  game.restartArmed = 0;
  game.state.messages.length = 0;

  const home = world.home.station;
  const away = world.stations.find((x) => x !== home);
  if (away) selectTarget(away);
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* приватный режим */ }
  dockAt(home);                 // ставит режим, экран порта и пишет сейв
  say(game.state, L('НОВАЯ ИГРА'), '#78e08f', 3);
};

// Куда возвращаться, закрывая карту или справку.
const restMode = () => (ship.dockedAt ? ST.DOCKED : (ship.landedAt ? ST.LANDED : ST.FLIGHT));

game.closeOverlay = () => {
  hideOverlay();
  game.state.mode = restMode();
  if (ship.dockedAt) showDocked(game);
  // Справку закрыли на ногах — мышь обратно взгляду (нажатие закрытия и
  // есть действие игрока, которого требует браузер).
  if (game.walk.on && !Q.touchUi) input.lock(screenCanvas);
};

// --- пилот на ногах -------------------------------------------------------------
//
// Встав с кресла, пилот отпускает ручки: корабль летит, как летел, —
// держит тягу и курс, гасители гасят, автоматика (докинг, посадка, привод)
// работает дальше. Клавиши W/A/S/D и мышь уходят ногам и голове
// (js/game/walker.js), а в кресло садятся там же, откуда встали, — у
// кресла, клавишей E.
//
// ПАЛУБА — НЕ ОБЯЗАТЕЛЬНО СВОЯ. Пилот ходит по тому кораблю, на борту
// которого стоит (game.walk.vessel): по своему или по чужому, зайдя к
// соседу по трапу. Корабль здесь — «место» (js/game/vessels.js): точка,
// базис, шасси и шлюзы. Свой корабль тоже место — ownVessel, обёртка
// над ship: у чужого те же поля приходят из сокета (js/game/peers.js).

/**
 * Свой корабль как место. Поля — геттеры, а не копии: ship.pos и
 * ship.basis переставляются целиком (placeShip), и копия отстала бы.
 */
const ownVessel = {
  own: true,
  get id() { return ship.id; },
  get pos() { return ship.pos; },
  get basis() { return ship.basis; },
  get gear() { return ship.gear; },
  get air() { return ownAir(); },
  get name() { return session.name || ''; },
  get by() { return myId(); },
  get mode() { return game.state.mode === ST.DOCKED ? 'docked' : game.state.mode === ST.LANDED ? 'landed' : 'flight'; },
};
game.ownVessel = ownVessel;
game.frame = ownVessel;

/** Кто я в сети: номер игрока (или null без сервера). */
function myId() {
  if (net.you && typeof net.you.id === 'number') return net.you.id;
  const p = session.player && session.player.player;
  return p && typeof p.id === 'number' ? p.id : null;
}

/** Корабль, на борту которого стоит пилот, — или свой, если он в кресле. */
const aboardVessel = () => (game.walk.on && !game.walk.out && game.walk.vessel) || ownVessel;

// Помещения, где пилот: своего корабля или чужого, на палубе которого он
// стоит. Записать — положить свои (так делают проверки).
Object.defineProperty(game, 'interior', {
  configurable: true,
  enumerable: true,
  get() { return vesselInterior(aboardVessel()); },
  set(I) { if (I) interiors.set(I.code || HULL.code, I); else interiors.delete(HULL.code); },
});

/** Все корабли этой системы, по которым можно ходить: свой (если он здесь) и чужие. */
const _here = [];
function vesselsHere() {
  _here.length = 0;
  if (!ship.away) _here.push(ownVessel);
  for (const V of game.peers) if (V.air) _here.push(V);
  return _here;
}

/** Тело, у которого стоит корабль: у своего — обстановка у поверхности, у чужого — из снимка. */
function vesselBody(V) {
  if (V.own) return game.zone && game.zone.body ? game.zone.body : (ship.landedAt || null);
  if (V.body === null || V.body === undefined) return null;
  return world.bodies.find((b) => b.id === V.body) || null;
}

// --- помещения по типам корпуса ------------------------------------------------
//
// У каждого типа свои (js/models/interior.js: план «Челленджера» там же,
// «Прометея» — js/models/interior.prom.js), и собираются они лениво:
// свои — когда пилот впервые встаёт, чужие — когда к соседу этого типа
// подходят. game.interior — помещения того корабля, на палубе которого
// пилот (свой или чужой); шлюзы своего корабля — ownAir().
const interiors = new Map();
const interiorJobs = new Map();
const interiorOf = (code) => interiors.get(code) || null;
/** Помещения корабля V: своего — по своему корпусу, чужого — по его типу. */
const vesselInterior = (V) => interiorOf(V.own ? HULL.code : (V.type || ROOMS_TYPE));
/** Шлюзы своего корабля. */
function ownAir() {
  const I = interiorOf(HULL.code);
  return I ? I.air : null;
}
/** Высота центра корпуса типа code над грунтом на шасси, км. */
function gearClearOf(code) {
  const H = hullOf(code);
  return H ? H.gear.legLengths[0] - H.gear.hardpoints[0].y : SHIP.gearClear;
}

/** Собрать помещения типа code (один раз; модули грузятся лениво). */
function loadInteriorOf(code) {
  if (interiors.has(code)) return Promise.resolve(interiors.get(code));
  // Помещения рисует проход кабины; на запасном пути Canvas 2D его нет
  // (проверки подставляют модель кабины руками — тогда есть).
  const H = hullOf(code);
  if ((!scene && !game.cockpit) || !H || !H.rooms) return Promise.resolve(null);
  if (!interiorJobs.has(code)) {
    interiorJobs.set(code, import('./models/interior.js').then(async (m) => {
      const plan = code === 'prometheus'
        ? (await import('./models/interior.prom.js')).prometheusPlan(H.mesh) : m.CHALLENGER;
      const I = m.buildInterior(H.mesh, plan);
      interiors.set(code, I);
      return I;
    }).catch((e) => {
      console.warn('помещения корабля не собрались', e);
      interiorJobs.delete(code);
      return null;
    }));
  }
  return interiorJobs.get(code);
}

/** Шлюзы чужого корабля: заводятся, как только есть помещения его типа. */
function vesselAir(V) {
  if (V.own || V.air) return V.air;
  const code = V.type || ROOMS_TYPE;
  const I = interiorOf(code);
  if (!I) { loadInteriorOf(code); return null; }
  V.air = makeAir(I, gearClearOf(code));
  setHatches(V.air, V.hatches, true);
  return V.air;
}

/** Собрать свои помещения и завести свои шлюзы. */
function loadInterior() {
  const code = HULL.code;
  const have = interiorOf(code);
  if (have && have.air) return Promise.resolve(have);
  if ((!scene && !game.cockpit) || !HULL.rooms) return Promise.resolve(null);
  return loadInteriorOf(code).then((I) => {
    if (!I || code !== HULL.code || I.air) return I;
    // Шлюзы: давление, люки и трапы — по высоте корабля на шасси.
    makeAirlocks(I, SHIP.gearClear);
    // Люки, с которыми корабль оставили (сохранение), — сразу открыты.
    if (ship.hatchesWant) { setHatches(I.air, ship.hatchesWant, true); ship.hatchesWant = null; }
    syncCargo(true);
    restoreMe();
    return I;
  });
}
game.loadInterior = loadInterior;
// Шлюзы своего корабля — сцене (вырез обшивки, створки и трапы снаружи).
game.ownAir = ownAir;

/**
 * Свой корпус — тот, что сейчас в HULL (js/game/hull.js). Зовётся, когда
 * сервер сказал, на чём летит пилот (serverToSave): после пересадки на
 * корабль другого типа в кадре его корпус и стойки, а пост пилота с
 * экранами — только там, где он есть. Помещения «Челленджера» остаются:
 * по ним ходят соседи того же типа.
 */
function syncHull() {
  if (shipMesh === HULL.mesh) return false;
  shipMesh = HULL.mesh;
  gearMesh = HULL.gear;
  game.shipMesh = shipMesh;
  game.gearMesh = gearMesh;
  ship.mesh = shipMesh;
  const pod = cockpitOf(HULL.code);
  game.cockpit = pod ? pod.model : null;
  game.displays = pod ? pod.screens : null;
  // Стоял на палубе своего корабля, а корпус сменился (пересадка) — в
  // кресло нового: палубы у него может не быть вовсе.
  if (game.walk.on && aboardVessel().own) seatPilot();
  // Помещения нового корпуса — заранее: мостик «Прометея» с пультами
  // виден уже из кресла.
  if (HULL.rooms) setTimeout(() => { loadInterior(); }, 0);
  return true;
}
game.syncHull = syncHull;
// Мир за бортом в осях G — замерам (tools/, отладка): во что упёрся пешеход.
game.outsideFrame = (G = game.walk.out, pos = game.walk.pos) => (G && game.interior ? outsideFrame(G, pos) : null);

/** Груз в трюме: ящик на тонну (рисует кабина, твёрдыми их видит ход). */
function syncCargo(force = false) {
  const I = game.interior;
  if (!I) return;
  let tons = 0;
  for (const c of game.player.cargo || []) tons += c.tons || 0;
  const n = Math.min(I.slots.length, Math.max(0, Math.ceil(tons / I.crate.tons - 1e-9)));
  // В чужом трюме — чужой груз: каков он, сокет не говорит, и ящиков
  // своего трюма там быть не может. Ящики — только на своей палубе.
  const own = aboardVessel().own;
  if (!force && n === I.cargo && own === I.cargoOwn) return;
  I.cargo = own ? n : 0;
  I.cargoOwn = own;
  game.walk.crates = own ? crateSolids(I, n * I.crate.tons) : [];
}

/** Встать с кресла: в полёте, на грунте и в порту. */
game.rise = () => {
  const st = game.state;
  if (game.walk.on) return false;
  if (!HULL.rooms) {
    say(st, L('ВСТАТЬ НЕКУДА: ПОМЕЩЕНИЙ НА ЭТОМ КОРАБЛЕ ЕЩЁ НЕТ'), '#ffcc66', 3);
    return false;
  }
  if (!scene && !game.cockpit) {
    say(st, L('ВСТАТЬ НЕКУДА: БЕЗ WEBGL2 ПОМЕЩЕНИЙ НЕТ'), '#ff7a66', 3);
    return false;
  }
  if (!game.interior || !ownAir()) {
    say(st, L('ПОМЕЩЕНИЯ КОРАБЛЯ ЕЩЁ ГОТОВЯТСЯ…'), '#ffcc66', 2);
    loadInterior();
    return false;
  }
  if (st.mode !== ST.FLIGHT && st.mode !== ST.LANDED && st.mode !== ST.DOCKED) return false;
  game.walk.prevView = st.view;
  st.view = 'cockpit';
  // Голова, повёрнутая в кресле, остаётся повёрнутой и на ногах.
  standUp(game.walk, game.interior, { yaw: game.camOrbit.yaw, pitch: 0 });
  boardVessel(ownVessel);
  game.camOrbit.yaw = 0;
  game.camOrbit.pitch = 0;
  game.menu.open = false;
  if (st.mode === ST.DOCKED) hideOverlay();
  input.releaseAll();
  // Мышь — сразу: нажатие Y и есть то действие игрока, без которого
  // браузер её не отдаёт.
  if (!Q.touchUi) input.lock(screenCanvas);
  game.walkRoomT = 0;
  game.walkIntro = 8;
  syncCargo(true);
  say(st, st.mode === ST.FLIGHT
    ? L('ПИЛОТ ВСТАЛ · КОРАБЛЬ ДЕРЖИТ КУРС И ТЯГУ')
    : L('ПИЛОТ ВСТАЛ С КРЕСЛА'), '#9fd9ff', 3);
  save();
  return true;
};

/**
 * Взойти на борт корабля (свой или чужой): ноги и взгляд уже в его осях,
 * здесь — чьи шлюзы под ногами, чей груз в трюме, кто ещё на палубе.
 */
function boardVessel(V) {
  const w = game.walk;
  w.vessel = V;
  w.air = V.own ? null : vesselAir(V);
  w.out = null;
  game.frame = V;
  syncCargo(true);
}

/**
 * Сесть: только у кресла и стоя на палубе — и только в своём корабле.
 *
 * Чужой корабль везёт, но не слушается: в его кресле сидит (или
 * сядет) его хозяин. Свой, но другой (кораблей бывает несколько), —
 * сесть в кресло значит принять им командование: это решает сервер
 * (Players::command), и после ответа игра ведёт уже его.
 */
game.sit = () => {
  const w = game.walk;
  if (!w.on || w.phase !== 'walk' || !game.interior || !nearSeat(w, game.interior)) return false;
  const V = aboardVessel();
  if (!V.own) {
    if (V.by !== null && V.by === myId()) { takeCommand(V); return true; }
    say(game.state, L('КРЕСЛО ПИЛОТА — ЗА ХОЗЯИНОМ: ') + (V.name || L('ПИЛОТ')), '#ffcc66', 3);
    return true;
  }
  sitDown(w);
  return true;
};

/** Принять командование другим своим кораблём: сесть в его кресло. */
const takeCommand = (V) => commandShip(V.id);

/**
 * Принять командование своим кораблём по номеру: из его кресла или из
 * соседнего корабля в том же доке (экран порта, «ПЕРЕСЕСТЬ»). Решает
 * сервер (Players::command); после ответа игра ведёт уже его — с его
 * корпусом, стойками и лётной моделью (serverToSave → syncHull).
 */
async function commandShip(id) {
  if (!isOnline()) { say(game.state, L('НЕТ СВЯЗИ С СЕРВЕРОМ'), '#ff7a66', 3); return false; }
  say(game.state, L('ПРИНИМАЮ КОМАНДОВАНИЕ…'), '#9fd9ff', 2);
  try {
    // Где стоял прежний корабль — в базу до пересадки: дальше его место
    // пишет уже не эта игра (он засыпает там, где стоит).
    save(true);
    const state = await serverCommand(id);
    seatPilot();
    applyState(serverToSave(state));
    applyServer(game.player, state);
    syncFromServer(game, state);
    save();
    say(game.state, L('КОМАНДОВАНИЕ ПРИНЯТО: ') + (SHIP.typeName || ''), '#78e08f', 3);
    if (game.state.mode === ST.DOCKED && ship.dockedAt) showDocked(game);
    return true;
  } catch (e) {
    say(game.state, L('КОМАНДОВАНИЕ: ') + e.message, '#ff7a66', 4);
    return false;
  }
}
game.switchShip = commandShip;

/** Сел: мышь — обратно курсором, вид — тот, что был, порт — экраном. */
function seated() {
  const st = game.state;
  // Пилот в кресле — и шлюзы задраиваются сами: улететь с открытым люком
  // и трапом до земли значит оставить трап на площадке.
  if (ownAir() && ownAir().hatches.some((x) => x.want || x.open > 0)) {
    closeAll(ownAir());
    say(st, L('ЛЮКИ ЗАКРЫВАЮТСЯ'), '#ffcc66', 2);
  }
  input.unlock();
  input.releaseAll();
  st.view = game.walk.prevView || 'cockpit';
  game.walkEye = null;
  game.frame = ownVessel;
  // Сел — путь снят и план закрыт.
  game.walkGoal = null;
  game.walkRoute = null;
  game.deckMap.open = false;
  if (st.mode === ST.DOCKED && ship.dockedAt) showDocked(game);
  say(st, L('ПИЛОТ В КРЕСЛЕ'), '#78e08f', 2);
  save();
}

/** В кресло сразу, без шага: крушение, страховка, новая игра. */
function seatPilot() {
  // Шлюзы — сразу закрыты и под давлением: крушение, страховка, рестарт.
  if (ownAir()) resetAirlocks(ownAir());
  // Ехал в лифте — поездка брошена, двери отперты.
  cancelRide(game.walk, game.interior);
  game.frame = ownVessel;
  game.walk.vessel = null;
  game.walk.air = null;
  if (!game.walk.on) return;
  seatNow(game.walk);
  input.unlock();
  game.state.view = game.walk.prevView || game.state.view;
  game.walkEye = null;
}

/** Клавиши пилота на ногах: сесть, справка, захват мыши. */
function walkKeys() {
  const st = game.state;
  const w = game.walk;
  if (w.phase !== 'walk') return;
  // План палубы: пока открыт, ноги стоят, клавиши и мышь — его.
  const DM = game.deckMap;
  if (DM.open) {
    const I0 = game.interior;
    if (!I0 || w.out) { DM.open = false; return; }
    let act = deckMapKeys(DM, I0, input);
    // Мышь: подсветка под курсором и щелчок — помещение (путь туда),
    // палуба в списке (её план) или «закрыть».
    deckMapHover(DM, input.mouse.x, input.mouse.y);
    if (input.mouse.clicked) {
      const id = deckMapClick(DM, input.mouse.x, input.mouse.y);
      if (id === DECKMAP_CLOSE) act = 'close';
      else if (id) { DM.sel = id; act = 'route'; }
    }
    if (act === 'route') setWalkGoal(DM.sel);
    if (act) {
      DM.open = false;
      if (!Q.touchUi) input.lock(screenCanvas);
    }
    return;
  }
  if (input.pressed('KeyM') && game.interior && !w.out && !w.ride) {
    openDeckMap(DM, game.interior, w.room, game.walkGoal);
    input.unlock();
    input.releaseAll();
    return;
  }
  // Люк под рукой — E открывает и закрывает (у пульта в шлюзе, в проёме,
  // на трапе и под люком снаружи).
  const lift = !w.out && game.interior ? panelNear(w, game.interior) : null;
  if (lift) {
    // У пульта лифта: колесо и ↑↓ — палуба, E — ехать (js/game/lift.js).
    const n = lift.lift.stops.length;
    if (game.liftPick === null || game.liftPick === undefined || game.liftPickOf !== lift.stop) {
      game.liftPick = lift.to; game.liftPickOf = lift.stop;
    }
    // Путь проложен через лифт — палуба пути уже выбрана (один раз: колесом
    // её можно сменить).
    const R = game.walkRoute;
    if (R && R.next.kind === 'lift' && game.liftPickRoute !== R.next.stop + ':' + lift.stop) {
      game.liftPick = R.next.stop; game.liftPickRoute = R.next.stop + ':' + lift.stop;
    }
    const wheel = input.takeWheel();
    let step = (wheel > 0 ? 1 : wheel < 0 ? -1 : 0) + (input.pressed('ArrowDown') ? 1 : 0) - (input.pressed('ArrowUp') ? 1 : 0);
    while (step) {
      const d = Math.sign(step);
      game.liftPick = (game.liftPick + d + n) % n;
      if (game.liftPick === lift.stop) game.liftPick = (game.liftPick + d + n) % n;
      step -= d;
    }
  } else {
    game.liftPick = null;
  }
  if (lift && input.pressed('KeyE')) {
    lift.to = game.liftPick;
    const r = startRide(w, game.interior, lift);
    audioCue(game.audio, 'lift', { dur: r.T + 0.45, up: r.off[1] > 0 });
    say(st, L('ЛИФТ: ') + L(lift.lift.stops[lift.to].deck), '#9fd9ff', 2);
  } else if (game.walkHatch && input.pressed('KeyE')) {
    useHatch(game.walkHatch, game.walkHatchShip || ownVessel);
  } else if (input.pressed('KeyE', 'KeyY')) {
    if (!game.sit() && input.pressed('KeyY')) {
      say(st, L('КРЕСЛО ПИЛОТА — В РУБКЕ: ПОДОЙДИТЕ К НЕМУ'), '#ffcc66', 2.5);
    }
  }
  if (input.pressed('KeyH')) {
    st.mode = ST.HELP;
    input.unlock();
    showHelp(game);
    return;
  }
  // Список пилотов — и на ногах: кто где, на чьём борту.
  if (input.pressed('KeyP')) game.showPilots = !game.showPilots;
  // Мышь — щелчком по кадру: браузер отдаёт её только по действию игрока
  // (после Esc её приходится брать заново).
  if (input.mouse.clicked && !input.locked && !Q.touchUi) input.lock(screenCanvas);
}

const _look = { x: 0, y: 0 };
const _walkDrag = { x: 0, y: 0 };
const _walkTouch = { x: 0, y: 0 };
const _eyeM = [0, 0, 0];

/**
 * Кто ещё стоит на этой палубе — точки ног в осях корабля: перед ними
 * открываются двери (js/game/walker.js, w.others).
 */
function othersAboard(V, out) {
  out.length = 0;
  if (!V || V.id === null || V.id === undefined) return out;
  for (const p of game.people) if (p.st !== 'out' && p.ship === V.id) out.push(p.p);
  return out;
}

/** Шаг пилота: ноги, голова, двери, комната. По времени кадра. */
function walkFrame(dt) {
  const w = game.walk, I = game.interior, st = game.state;
  if (!I) return;
  const V = aboardVessel();
  othersAboard(V, w.others || (w.others = []));
  // Под справкой, меню и картой ноги стоят: ввод сейчас не их.
  if (st.mode === ST.HELP || st.mode === ST.MAP || game.menu.open || game.deckMap.open) {
    game.walkEye = w.out ? null : walkerEye(w, I, _eyeM);
    return;
  }
  syncCargo();
  // Реакторы машинного горят по работе движков: на стоянке — дежурно. У
  // чужого корабля — по тому, как работают его подъёмные (снимок сокета).
  I.reactor = !V.own ? clamp(0.08 + (V.lift || 0), 0, 1) : st.mode === ST.FLIGHT
    ? clamp(Math.abs(ship.throttle) + (ship.boosting ? 0.5 : 0) + Math.abs(ship.control.lift || 0) * 0.3, 0, 1)
    : 0.08;
  input.takeLook(_look);
  input.takeDrag(_walkDrag);
  let lx = _look.x, ly = _look.y;
  // Без захвата мыши (его не дали или отпустили Esc) голову по-прежнему
  // можно повернуть правой кнопкой.
  if (input.mouse.right) { lx += _walkDrag.x; ly += _walkDrag.y; }
  if (Q.touchUi) {
    touchDrag(game.touch, _walkTouch);
    lx += _walkTouch.x * 1.6; ly += _walkTouch.y * 1.6;
  }
  const pad = input.pad;
  // Стрелки ←/→ поворачивают голову: ходить можно и вовсе без мыши.
  const turn = input.axis(['ArrowLeft'], ['ArrowRight']) * 2.0 * dt;
  const ctl = {
    fwd: clamp(input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) - pad.pitch, -1, 1),
    side: clamp(input.axis(['KeyA'], ['KeyD']) + pad.yaw, -1, 1),
    run: input.isDown('ShiftLeft', 'ShiftRight'),
    jump: input.pressed('Space'),
    lookX: lx * WALK.look + turn,
    lookY: -ly * WALK.look,
  };
  const ev = updateWalker(w, I, ctl, dt, w.out ? outsideFrame() : null);
  for (let i = 0; i < ev.opened.length; i++) audioCue(game.audio, 'door', { dur: WALK.doorTime });
  // Лифт в пути: двери закрылись — кабина пошла; приехали — пилот уже в
  // кабине той палубы (js/game/lift.js).
  if (w.ride) {
    const rv = stepRide(w, I, dt);
    if (rv === 'arrive') { ev.room = true; game.liftPick = null; game.liftPickRoute = null; }
  }
  updateRoute();
  if (ev.step) {
    audioCue(game.audio, 'step', { run: ev.step.run, land: ev.step.land, surface: stepSurface(), air: feetAir() });
  }
  crossThreshold();
  if (ev.room) game.walkRoomT = 2.6;
  game.walkRoomT = Math.max(0, game.walkRoomT - dt);
  game.walkIntro = Math.max(0, game.walkIntro - dt);
  if (ev.seated) seated();
  game.walkEye = w.on && !w.out ? walkerEye(w, I, _eyeM) : null;
  findHatch();
}

/**
 * Люк под рукой: на палубе — того корабля, где стоишь; за бортом —
 * ближайшего, к которому подошёл (свой ли, чужой ли).
 */
function findHatch() {
  const w = game.walk, I = game.interior;
  game.walkHatch = null;
  game.walkHatchShip = null;
  if (!w.on || w.phase !== 'walk' || !I) return;
  if (!w.out) {
    const V = aboardVessel();
    const air = V.own ? ownAir() : V.air;
    if (air) { game.walkHatch = hatchNear(air, air.I, w.pos, false); game.walkHatchShip = V; }
    return;
  }
  groundToWorld(w.out, w.pos, _feetW);
  for (const V of nearVessels(vesselsHere(), _feetW, OUT_NEAR, _nearV)) {
    const air = V.own ? ownAir() : V.air;
    if (!air) continue;
    shipToGround(w.out, V, _outT);
    const hx = hatchNear(air, air.I, groundPointToShip(_outT, w.pos, _wsp), true);
    if (hx) { game.walkHatch = hx; game.walkHatchShip = V; return; }
  }
}

// --- шлюзы и пилот за бортом -------------------------------------------------
//
// Шлюзы живут каждый кадр, сидит пилот или ходит: люки закрываются и после
// того, как он сел (js/game/airlock.js). Отсюда им приходит то, чего сам
// шлюз не знает: давление за бортом, грунт под трапом и запреты.
//
// У ЧУЖОГО корабля люки просит открытыми тот, кто его ведёт (поле h
// снимка), — а цикл, панель и трап у каждого зрителя идут свои, по тем
// же правилам: шлюз проверен в Node, и разойтись нечему.

/** Нарисованный грунт (по нему стоят ноги) или настоящий, если сцены нет. */
const groundOf = (body, dir) => (scene ? scene.drawnGround(body, dir) : groundRadius(body, dir));

/** Давление у точки мира, бар: воздух тел на этой высоте, в пустоте — ноль. */
function pressureAt(P) {
  let p = 0;
  for (const b of world.bodies) {
    if (!b.atmo) continue;
    const alt = Math.hypot(P.x - b.pos.x, P.y - b.pos.y, P.z - b.pos.z) - b.radius;
    if (alt < b.radius * ENTRY.top) p = Math.max(p, airDensity(b, Math.max(0, alt)));
  }
  return p;
}

/** Давление за бортом своего корабля, бар: в порту — ноль. */
function outsidePressure() {
  if (game.state.mode === ST.DOCKED) return 0;
  return pressureAt(ship.pos);
}

// Выше этой скорости относительно воздуха панель люка сорвало бы потоком,
// км/с: сотня метров в секунду — это триста шестьдесят километров в час.
const HATCH_AIRSPEED = 0.1;

/** Почему люки сейчас открывать нельзя (или null). */
function hatchBlock(pOut) {
  if (game.warp.phase === 'tunnel' || game.warp.phase === 'align') return L('ЛЮКИ ЗАБЛОКИРОВАНЫ: ВАРП');
  const q = game.quantum.phase;
  if (q === 'jump' || q === 'brake' || q === 'calib') return L('ЛЮКИ ЗАБЛОКИРОВАНЫ: КВАНТОВЫЙ ПРЫЖОК');
  if (pOut > 0.01 && game.state.mode === ST.FLIGHT) {
    const v = game.zone ? Math.hypot(game.zone.relVel.x, game.zone.relVel.y, game.zone.relVel.z) : ship.speed;
    if (v > HATCH_AIRSPEED) return L('ЛЮКИ ЗАБЛОКИРОВАНЫ: НАПОР ВОЗДУХА');
  }
  return null;
}

const _gp = v3(), _gd = v3();

/**
 * Грунт под точкой (x, z) осей корабля — его высота в тех же осях, м, или
 * null: тела рядом нет, или до грунта больше трёхсот метров (трапу до
 * него не достать, а считать рельеф незачем).
 *
 * «Под» — по оси корабля, а не по отвесу: где линия вниз по кораблю через
 * эту точку встречает грунт. На склоне корабль стоит с креном до 20°, и
 * отвес из точки над пятой трапа за пять метров до земли уходит вбок на
 * полтора. Здесь мерили по отвесу — и трап «стоял» пятой на земле, а на
 * деле висел над склоном на два десятка сантиметров: первая ступень с
 * грунта выходила выше шага. Шагов несколько: высота над грунтом по
 * отвесу, делённая на косинус крена, — и снова, пока не сойдётся.
 */
function groundUnder(V, x, z) {
  const body = vesselBody(V);
  if (!body) return null;
  if (V.own) {
    const zone = game.zone;
    if (!zone || zone.alt > 0.3 || game.state.mode === ST.DOCKED) return null;
  } else {
    // Высота — над РЕЛЬЕФОМ, а не над уровнем моря: суша бывает на
    // километры выше, и трап соседа, стоящего на плато, иначе «не видел»
    // бы грунта под собой.
    if (V.mode === 'docked') return null;
    const dirV = localDir(body, V.pos, _gd);
    if (Math.hypot(V.pos.x - body.pos.x, V.pos.y - body.pos.y, V.pos.z - body.pos.z) - groundOf(body, dirV) > 0.3) return null;
  }
  const b = V.basis;
  let y = -8;
  for (let i = 0; i < 5; i++) {
    _gp.x = V.pos.x + (b.right.x * x + b.up.x * y + b.fwd.x * z) / 1000;
    _gp.y = V.pos.y + (b.right.y * x + b.up.y * y + b.fwd.y * z) / 1000;
    _gp.z = V.pos.z + (b.right.z * x + b.up.z * y + b.fwd.z * z) / 1000;
    const rx = _gp.x - body.pos.x, ry = _gp.y - body.pos.y, rz = _gp.z - body.pos.z;
    const R = Math.hypot(rx, ry, rz);
    const alt = (R - groundOf(body, localDir(body, _gp, _gd))) * 1000;
    const c = (b.up.x * rx + b.up.y * ry + b.up.z * rz) / R;
    const dy = alt / Math.max(0.5, c);
    y -= dy;
    if (Math.abs(dy) < 0.002) break;
  }
  return y;
}
const groundShip = (x, z) => groundUnder(ownVessel, x, z);

/**
 * Стоит ли кто-нибудь в проёме или на трапе этого люка корабля V: сам
 * пилот или другие люди (их видно по сокету). Закрывать его нельзя —
 * трап уехал бы из-под ног, а панель прошла бы сквозь человека.
 */
const _occP = [0, 0, 0];
function hatchOccupied(hx, V = ownVessel, onlyMe = false) {
  const w = game.walk;
  const air = V.own ? ownAir() : V.air;
  if (!air) return false;
  const I = air.I;
  const inHatch = (p) => tunnelAt(air, I, p) === hx || onStair(hx, p)
    || (Math.abs(Math.abs(p[0]) - hx.h.skin) < 0.8 && Math.abs(p[2] - hx.zc) < 2 && p[1] < hx.h.y[1] + 0.5 && p[1] > hx.h.y[0] - 6);
  if (w.on) {
    if (w.out) {
      shipToGround(w.out, V, _outT);
      if (inHatch(groundPointToShip(_outT, w.pos, _occP))) return true;
    } else if (aboardVessel() === V && tunnelAt(air, I, w.pos) === hx) return true;
  }
  if (onlyMe) return false;
  for (const p of game.people) {
    if (p.st !== 'out' && p.ship === V.id) { if (tunnelAt(air, I, p.p) === hx) return true; continue; }
    if (p.st === 'out' && p.here && inHatch(worldToVessel(V, p.place.pos, _occP))) return true;
  }
  return false;
}

const _airEnv = { pOut: 0, block: null, ground: groundShip, occupied: (hx) => hatchOccupied(hx, ownVessel) };
const _airEnvV = { pOut: 0, block: null, ground: null, occupied: null };

/** Шаг шлюзов — каждый кадр: своего корабля и чужих рядом. */
function airFrame(dt) {
  const I = interiorOf(HULL.code);
  const st = game.state;
  if (!ship.away && I && I.air) {
    _airEnv.pOut = outsidePressure();
    _airEnv.block = hatchBlock(_airEnv.pOut);
    const ev = updateAirlocks(I.air, _airEnv, dt);
    airSounds(ev, I.air, ownVessel);
    for (const e of ev) {
      if (e.kind === 'forced' && game.walk.on) say(st, _airEnv.block + L(' · ЛЮКИ ЗАКРЫВАЮТСЯ'), '#ffcc66', 3);
    }
  }
  for (const V of game.peers) {
    if (!vesselAir(V)) continue;
    // Далеко — считать цикл незачем: люки сразу как велено.
    if (Math.hypot(V.pos.x - camera.pos.x, V.pos.y - camera.pos.y, V.pos.z - camera.pos.z) > 3) {
      setHatches(V.air, V.hatches, true);
      continue;
    }
    setHatches(V.air, V.hatches);
    // Сам пилот в проёме чужого люка — у себя он его не закроет под
    // ногами: хозяин мог не успеть увидеть его там.
    for (const hx of V.air.hatches) if (!hx.want && hx.open > 0 && hatchOccupied(hx, V, true)) hx.want = true;
    _airEnvV.pOut = V.mode === 'docked' ? 0 : pressureAt(V.pos);
    _airEnvV.ground = V._ground || (V._ground = (x, z) => groundUnder(V, x, z));
    _airEnvV.occupied = V._occ || (V._occ = (hx) => hatchOccupied(hx, V, true));
    airSounds(updateAirlocks(V.air, _airEnvV, dt), V.air, V);
  }
}

/** Звуки шлюза — того корабля, где пилот, или рядом с которым он стоит. */
function airSounds(ev, air, V) {
  if (!ev.length) return;
  const near = aboardVessel() === V
    || Math.hypot(V.pos.x - camera.pos.x, V.pos.y - camera.pos.y, V.pos.z - camera.pos.z) < 0.08;
  if (!near) return;
  for (const e of ev) {
    if (e.kind === 'hatch') audioCue(game.audio, 'door', { dur: AIR.hatchTime });
    else if (e.kind === 'stair') audioCue(game.audio, 'door', { dur: AIR.stairTime });
    else if (e.kind === 'cycle') {
      const L0 = air.locks[e.id];
      const dp = Math.abs((e.dir === 'in' ? AIR.cabin : air.pOut) - L0.p);
      if (dp > 0.02) audioCue(game.audio, 'air', { gain: 0.15 + 0.3 * Math.min(1, dp), dur: dp / AIR.rate + 0.3 });
    } else if (e.kind === 'rush' && aboardVessel() === V) {
      // Дверь открылась между разными давлениями — воздух рванул.
      const k = Math.min(1, e.dp);
      audioCue(game.audio, 'air', { gain: 0.2 + 0.4 * k, dur: 1 + 3 * k });
    }
  }
}

/**
 * E у люка: открыть или закрыть.
 *
 * Свой — сразу. Чужой — просьбой (js/net/socket.js, askHatch): решит тот,
 * кто его ведёт (у него напор воздуха и прыжок), а спящий корабль — сервер.
 */
function useHatch(hx, V = ownVessel) {
  const st = game.state, air = ownAir();
  if (!V.own) {
    if (!isOnline() || !askHatch(V.id, hx.id, !hx.want)) {
      say(st, L('НЕТ СВЯЗИ: ЛЮК ЧУЖОГО КОРАБЛЯ НЕ ОТКРЫТЬ'), '#ff7a66', 3);
      return;
    }
    say(st, (hx.want ? L('ПРОСЬБА ЗАКРЫТЬ ЛЮК') : L('ПРОСЬБА ОТКРЫТЬ ЛЮК')) + ' · ' + (V.name || L('ПИЛОТ')),
      '#9fd9ff', 2.5);
    return;
  }
  if (!air) return;
  const res = toggleHatch(air, hx, { occupied: hatchOccupied(hx, ownVessel) });
  if (res === 'occupied') { say(st, L('ЛЮК НЕ ЗАКРЫТЬ: ОТОЙДИТЕ ОТ ПРОЁМА'), '#ffcc66', 2.5); return; }
  if (res) { say(st, res, '#ff7a66', 3); return; }
  if (hx.want) {
    say(st, air.pOut < 0.01 ? L('ШЛЮЗ: СТРАВЛИВАНИЕ · ЗА БОРТОМ ПУСТОТА') : L('ШЛЮЗ: ДАВЛЕНИЕ ПО ЗАБОРТНОМУ'),
      '#9fd9ff', 3);
  } else {
    say(st, L('ЛЮК ЗАКРЫВАЕТСЯ'), '#9fd9ff', 2);
  }
  save();
}

/**
 * Просьба о люке НАШЕГО корабля от другого игрока (сокет, hatchreq):
 * открываем по своим правилам — те же запреты, что и для себя.
 */
function hatchRequest(ev) {
  const air = ownAir();
  if (!air || ship.away || ev.ship !== ship.id) return;
  const hx = hatchById(air, String(ev.id));
  if (!hx || hx.want === !!ev.open) return;
  const res = toggleHatch(air, hx, { occupied: hatchOccupied(hx, ownVessel) });
  if (res === null) {
    say(game.state, (ev.open ? L('ЛЮК ОТКРЫВАЕТ: ') : L('ЛЮК ЗАКРЫВАЕТ: ')) + (ev.name || L('ПИЛОТ')), '#9fd9ff', 3);
    save();
  }
}

// --- за бортом: оси грунта (js/game/outside.js) --------------------------------

// Корабли дальше этого от ног за бортом не трогаются: на их трап и
// стойки не наступить, а перекладывать их твёрдое в оси грунта незачем.
const OUT_NEAR = 0.15;          // км

const _outT = { R: new Float64Array(9), t: [0, 0, 0] };
const _shipBoxes = [], _outSolids = [], _airBuf = [], _nearV = [];
// Твёрдое тоннелей люков — по планировке (у каждого типа своя).
const _tunnels = new Map();
function tunnelsOf(I) {
  let t = _tunnels.get(I);
  if (!t) {
    const ids = new Set(I.hatches.map((h) => h.id));
    t = I.solids.filter((s) => (s.sill && ids.has(s.sill)) || s.hatchWall);
    _tunnels.set(I, t);
  }
  return t;
}
const _feetW = v3();
const _wsp2 = [0, 0, 0];

/** Ноги пилота за бортом — в осях корабля V, м. */
const _wsp = [0, 0, 0];
function walkerShipPos(V = ownVessel) {
  const w = game.walk;
  if (!w.out) return w.pos;
  shipToGround(w.out, V, _outT);
  return groundPointToShip(_outT, w.pos, _wsp);
}

/**
 * Стойки шасси — коробками (оси корабля, м): мимо них ходят, а не сквозь.
 * Ствол и пята отдельно (js/models/gear.js): пята широкая и низкая, на
 * неё можно встать.
 */
function gearBoxes(V, G, out) {
  const g = V.gear;
  if (!g || g.t < 0.5) return;
  G.hardpoints.forEach((hp, i) => {
    const len = (G.legLengths[i] + (g.drop ? g.drop[i] : 0)) * g.t * 1000;
    legBoxes(G.legs[i], hp, len, out, i);
  });
}

// Карта днища — у каждого корпуса своя (js/game/outside.js).
const _unders = new Map();
const underOf = (mesh) => {
  let u = _unders.get(mesh);
  if (!u) { u = hullUnderside(mesh); _unders.set(mesh, u); }
  return u;
};

// Оси грунта, для которых собран мир за бортом: обычно пилота, а на пороге —
// те, в которые он только собирается шагнуть (crossThreshold).
let _outG = null;
const groundOut = (x, z) => groundY(_outG, x, z, groundOf);
const waterOut = (x, z) => waterUnder(_outG, x, z);

/**
 * Мир за бортом на этот кадр: твёрдое КАЖДОГО корабля рядом в осях
 * грунта (порог, трап, стойки, днище), грунт, вода, тяжесть. Кораблей два
 * рядом — и упираешься в стойки обоих.
 */
function outsideFrame(G = game.walk.out, pos = game.walk.pos) {
  _outG = G;
  groundToWorld(G, pos, _feetW);
  let n = 0;
  for (const V of nearVessels(vesselsHere(), _feetW, OUT_NEAR, _nearV)) {
    const air = V.own ? ownAir() : V.air;
    const T = V._T || (V._T = { R: new Float64Array(9), t: [0, 0, 0] });
    shipToGround(G, V, T);
    _shipBoxes.length = 0;
    // Корпус своего типа (js/models/hulls.js): его стойки и днище, а
    // пороги, тоннели и трапы — по его же планировке (air.I).
    const H = V.own ? HULL : hullOf(V.type || ROOMS_TYPE);
    if (air) {
      for (const s of tunnelsOf(air.I)) _shipBoxes.push(s);
      for (const s of airSolids(air, _airBuf)) _shipBoxes.push(s);
    }
    gearBoxes(V, H.gear, _shipBoxes);
    // Днище — коробками вокруг пилота: на лёгком теле прыгают выше, чем
    // висит корпус.
    undersideBoxes(underOf(H.mesh), groundPointToShip(T, pos, _wsp2), 2.5, _shipBoxes);
    // Коробка корабля в осях грунта — повёрнутая (ob), а не охватывающая:
    // на склоне охватывающая раздувается и запирает проём (js/game/walker.js).
    for (const s of _shipBoxes) {
      const o = _outSolids[n] || (_outSolids[n] = { lo: null, hi: null, ob: { R: null, t: null, lo: null, hi: null } });
      boxToGround(T, s, o);
      o.ob.R = T.R; o.ob.t = T.t; o.ob.lo = s.lo; o.ob.hi = s.hi;
      o.src = s;
      n++;
    }
  }
  _outSolids.length = n;
  return outsideWorld(_outSolids, groundOut, waterOut, gravityAt(G.body, _feetW) * 1000);
}

/** Направление в осях корабля -> оси грунта (поворот _outT). */
function shipDirToGround(d, out) {
  const R = _outT.R;
  out[0] = R[0] * d[0] + R[1] * d[1] + R[2] * d[2];
  out[1] = R[3] * d[0] + R[4] * d[1] + R[5] * d[2];
  out[2] = R[6] * d[0] + R[7] * d[1] + R[8] * d[2];
  return out;
}
function groundDirToShip(d, out) {
  const R = _outT.R;
  out[0] = R[0] * d[0] + R[3] * d[1] + R[6] * d[2];
  out[1] = R[1] * d[0] + R[4] * d[1] + R[7] * d[2];
  out[2] = R[2] * d[0] + R[5] * d[1] + R[8] * d[2];
  return out;
}

/** Взгляд и скорость — в новые оси (поворотом), чтобы шаг через порог не дёргал голову. */
function reframe(w, rot) {
  walkerLook(w, _wLook);
  const f = rot(_wLook.fwd, [0, 0, 0]);
  w.yaw = Math.atan2(f[0], f[2]);
  w.pitch = Math.asin(Math.max(-1, Math.min(1, f[1])));
  w.vel = rot(w.vel, [0, 0, 0]);
}

// Начало новых осей грунта — ноги пилота на пороге.
const _q0 = [0, 0, 0];
// Дальше этого за обшивкой порог пропускают как есть, м: проём кончился.
const SILL_OUT = 0.45;

/**
 * Порог люка: шаг за обшивку — в оси грунта, шаг с трапа в тоннель — в
 * оси корабля. Переносится всё: ноги, скорость, взгляд.
 *
 * На склоне оси корабля и грунта расходятся до 20°, и в новых осях ноги
 * не там, где были: наклонённый порог у ступни выше на десяток
 * сантиметров, а притолока бортового люка — над самой головой. Поэтому
 * шагают туда, где можно встать (standAt): ноги — на опору, тело — во
 * весь рост или пригнувшись. Нельзя — шаг остаётся в прежних осях до
 * следующего кадра.
 *
 * С трапа входят в ЛЮБОЙ корабль рядом — в тот, в чей тоннель шагнули.
 */
function crossThreshold() {
  const w = game.walk, I = game.interior;
  if (!w.on || w.phase !== 'walk' || !I || !I.air) return;
  if (!w.out) {
    const V = aboardVessel();
    const air = V.own ? I.air : V.air;
    const hx = pastSkin(air, w.pos);
    const body = vesselBody(V);
    if (!hx || !hx.exitOk || !body) return;
    vesselPoint(V, w.pos, _feetW);
    const G = makeGroundFrame(body, _feetW, V.basis.fwd);
    const at = standAt(outsideFrame(G, _q0), _q0, w.height);
    if (!at && hx.h.side * w.pos[0] < hx.h.skin + SILL_OUT) return;
    shipToGround(G, V, _outT);
    reframe(w, shipDirToGround);
    w.pos = at ? at.pos : worldToGround(G, _feetW);
    if (at) w.height = at.height;
    w.out = G;
    w.room = null;
    w.vessel = null;
    w.air = null;
    game.frame = ownVessel;
    game.walkRoomT = 3;
    save();
    return;
  }
  groundToWorld(w.out, w.pos, _feetW);
  for (const V of nearVessels(vesselsHere(), _feetW, OUT_NEAR, _nearV)) {
    const air = V.own ? I.air : V.air;
    if (!air) continue;
    shipToGround(w.out, V, _outT);
    const p = groundPointToShip(_outT, w.pos, [0, 0, 0]);
    if (!tunnelAt(air, I, p)) continue;
    const at = standAt(deckWorld(w, I, air), p, w.height);
    if (!at) continue;
    reframe(w, groundDirToShip);
    w.pos = at.pos;
    w.height = at.height;
    boardVessel(V);
    w.room = I.roomAt(p);
    game.walkRoomT = 2.6;
    if (!V.own) say(game.state, L('НА БОРТУ: КОРАБЛЬ ') + (V.name || L('ПИЛОТА')), '#9fd9ff', 3);
    save();
    return;
  }
  // Далеко от начала осей — перенести их к пилоту: кривизна тела.
  if (Math.hypot(w.pos[0], w.pos[2]) > RECENTER) {
    groundToWorld(w.out, w.pos, _feetW);
    const fw = groundDirToWorld(w.out, [0, 0, 1]);
    const G = makeGroundFrame(w.out.body, _feetW, fw);
    w.pos = worldToGround(G, _feetW);
    w.out = G;
  }
}

/** Проложить путь к помещению id (план палубы, js/ui/deckmap.js). */
function setWalkGoal(id) {
  const I = game.interior, r = I && I.roomById[id];
  if (!r) return;
  game.walkGoal = id;
  game.walkGoalOf = I;
  game.liftPickRoute = null;
  updateRoute();
  const R = game.walkRoute;
  say(game.state, R && R.here && R.dist < 1.5 ? L('ВЫ НА МЕСТЕ: ') + roomName(r)
    : L('ПУТЬ: ') + roomName(r) + ' · ' + L(deckOf(r)) + (R ? ' · ' + Math.round(R.dist) + L(' м') : ''), '#78e08f', 3);
}

/**
 * Путь к цели — каждый кадр: с того места, где пилот сейчас (он мог
 * свернуть). Дошёл — путь снят. Сменились помещения (пересел, вышел за
 * борт) — тоже.
 */
function updateRoute() {
  const w = game.walk, I = game.interior;
  if (!game.walkGoal) { game.walkRoute = null; return; }
  if (!I || I !== game.walkGoalOf) { game.walkGoal = null; game.walkRoute = null; return; }
  if (w.out || !w.room) { game.walkRoute = null; return; }
  if (w.ride) return;
  const R = routeTo(I, w.room, w.pos, game.walkGoal);
  game.walkRoute = R;
  if (R && R.here && Math.hypot(w.pos[0] - R.end[0], w.pos[2] - R.end[2]) < 1.5) {
    say(game.state, L('ВЫ НА МЕСТЕ: ') + roomName(I.roomById[game.walkGoal]), '#78e08f', 3);
    game.walkGoal = null;
    game.walkRoute = null;
  }
}

// Проложить путь — и снимкам и проверкам (tools/screen.mjs).
game.setWalkGoal = (id) => setWalkGoal(id);

/** Подсказка пути: куда и сколько. */
function routeHint() {
  const R = game.walkRoute, I = game.interior;
  if (!R || !I || !game.walkGoal) return null;
  const goal = roomName(I.roomById[game.walkGoal]);
  const next = R.next.kind === 'lift' ? L('ЛИФТ НА ') + L(R.next.lift.stops[R.next.stop].deck)
    : R.next.kind === 'goal' ? goal : roomName(I.roomById[R.next.to]);
  return [L('ПУТЬ: ') + goal + ' · ' + Math.round(R.dist) + L(' м') + (R.here ? '' : L(' · ДАЛЬШЕ: ') + next), '#78e08f'];
}

/** Подсказка у пульта лифта: куда поедем и как выбрать. */
function liftHint() {
  const w = game.walk, I = game.interior;
  if (!I || w.out) return null;
  if (w.ride) {
    const L0 = w.ride.lift, to = L0.stops[w.ride.to];
    return [L('ЛИФТ ИДЁТ: ') + L(to.deck) + ' · ' + L(to.what), '#9fd9ff'];
  }
  const at = panelNear(w, I);
  if (!at) return null;
  const pick = game.liftPick === null || game.liftPick === undefined ? at.to : game.liftPick;
  const to = at.lift.stops[pick];
  return [(Q.touchUi ? '' : L('E — ЛИФТ: ')) + L(to.deck) + ' · ' + L(to.what) + (Q.touchUi ? '' : L(' · КОЛЕСО ИЛИ ↑↓ — ПАЛУБА')), '#78e08f'];
}

/** Подсказки внизу кадра пилоту на ногах. */
function walkHints() {
  const w = game.walk;
  const fl = fuelLevel(ship);
  const V = aboardVessel();
  const seat = game.interior && nearSeat(w, game.interior);
  return {
    seat: !seat ? null : !V.own
      ? (V.by !== null && V.by === myId()
        ? (Q.touchUi ? L('«СЕСТЬ» — ПРИНЯТЬ КОМАНДОВАНИЕ') : L('E — СЕСТЬ И ПРИНЯТЬ КОМАНДОВАНИЕ'))
        : L('КРЕСЛО ПИЛОТА — ЗА ХОЗЯИНОМ: ') + (V.name || L('ПИЛОТ')))
      : (Q.touchUi ? L('СЕСТЬ — КНОПКА «СЕСТЬ»') : L('E — СЕСТЬ В КРЕСЛО ПИЛОТА')),
    // На чьём борту: свой корабль — не пишем, чужой — чей.
    aboard: !w.out && !V.own ? L('НА БОРТУ: КОРАБЛЬ ') + (V.name || L('ПИЛОТА')) : null,
    mouse: !Q.touchUi && !input.locked && w.phase === 'walk'
      ? L('ЩЁЛКНИТЕ ПО КАДРУ — ВЗГЛЯД МЫШЬЮ · ESC — ОТПУСТИТЬ МЫШЬ') : null,
    intro: game.walkIntro > 0
      ? (Q.touchUi ? L('ДЖОЙСТИК — ИДТИ · ПАЛЕЦ ПО ЭКРАНУ — СМОТРЕТЬ')
        : L('WASD — ИДТИ · SHIFT — БЕГ · ПРОБЕЛ — ПРЫЖОК')) : null,
    fuel: fl === 'dry' ? L('ТОПЛИВО КОНЧИЛОСЬ') : fl === 'reserve' ? L('ТОПЛИВО НА РЕЗЕРВЕ') : null,
    touch: Q.touchUi,
    hatch: hatchHint(),
    lift: liftHint(),
    route: routeHint(),
    plan: !w.out && !Q.touchUi && game.interior && game.interior.rooms.length > 20 && !game.walkRoute
      ? L('M — ПЛАН ПАЛУБЫ И ПУТЬ') : null,
    lock: lockHint(),
    press: pressHint(),
    out: outHint(),
  };
}

/** Подсказка у люка: что сделает E. */
function hatchHint() {
  const hx = game.walkHatch, V = game.walkHatchShip || ownVessel;
  const air = V.own ? ownAir() : V.air;
  if (!hx || !air) return null;
  const key = Q.touchUi ? L('«ЛЮК»') : 'E';
  if (!V.own) {
    // Люк чужого корабля: попросить того, кто его ведёт (или сервер).
    return [key + (hx.want ? L(' — ПОПРОСИТЬ ЗАКРЫТЬ ЛЮК') : L(' — ПОПРОСИТЬ ОТКРЫТЬ ЛЮК'))
      + ' · ' + (V.name || L('ПИЛОТ')), hx.want ? AIR_AMBER : AIR_GREEN];
  }
  if (hx.want) {
    if (hx.stair >= 1 && !hx.exitOk && !game.walk.out) {
      return [key + L(' — ЗАКРЫТЬ ЛЮК · ЗА БОРТОМ НЕ НА ЧТО ВСТАТЬ'), AIR_AMBER];
    }
    return [key + L(' — ЗАКРЫТЬ ЛЮК'), AIR_AMBER];
  }
  if (air.block) return [air.block, AIR_RED];
  return [key + L(' — ОТКРЫТЬ ЛЮК'), AIR_GREEN];
}
const AIR_AMBER = '#ffcc66', AIR_RED = '#ff7a66', AIR_GREEN = '#78e08f';

/** Строка о шлюзе, когда пилот в нём: давление и что происходит. */
function lockHint() {
  const w = game.walk, I = game.interior, air = airHere();
  if (!I || !air || w.out || !w.room || w.room.kind !== 'lock') return null;
  const s = lockStatus(air, w.room.id);
  const bar = s.p.toFixed(2) + L(' БАР');
  if (s.state === 'sealed') return [L('ШЛЮЗ ЗАДРАЕН · ') + bar, AIR_GREEN];
  if (s.state === 'cycle') return [(s.p > s.out ? L('СТРАВЛИВАНИЕ · ') : L('НАДДУВ · ')) + bar, AIR_AMBER];
  return [(s.out < 0.01 ? L('ЛЮК ОТКРЫТ · ЗА БОРТОМ ПУСТОТА') : L('ЛЮК ОТКРЫТ · ЗА БОРТОМ ') + bar), AIR_RED];
}

/**
 * Давление в помещении, где пилот, — если оно не корабельное: уходит за
 * борт (отсек связан с открытым люком) или корабль его набирает. Пилоту
 * в скафандре это не помеха — это видно, и только.
 */
function pressHint() {
  const w = game.walk, I = game.interior, air = airHere();
  if (!I || !air || w.out || !w.room || w.room.kind === 'lock') return null;
  const r = roomAir(air, w.room.id);
  if (!r || Math.abs(r.p - AIR.cabin) < 0.02) return null;
  const bar = r.p.toFixed(2) + L(' БАР');
  if (r.leak) return [L('РАЗГЕРМЕТИЗАЦИЯ · ') + bar, AIR_RED];
  return [(r.p < AIR.cabin ? L('НАДДУВ · ') : L('СТРАВЛИВАНИЕ · ')) + bar, AIR_AMBER];
}

// Трава под ногой — там, где грунт покрашен зеленью и растут стебли:
// густота растительности (js/gl/flora.js, growth) — то же число, по
// которому их и сажают. Ниже трети — проплешины, грунт.
const STEP_GRASS = 0.3;
const _stepDir = v3();

/**
 * На чём шаг (звук): палуба корабля (и трап, и порог люка — всё его
 * твёрдое), снег ледяного мира, трава или голый грунт.
 */
function stepSurface() {
  const w = game.walk;
  if (!w.out || w.floor !== 'ground') return 'metal';
  const body = w.out.body;
  if (body.kind === 'ice') return 'snow';
  groundToWorld(w.out, w.pos, _feetW);
  localDir(body, _feetW, _stepDir);
  return growth(body, terrainOf(body), _stepDir.x, _stepDir.y, _stepDir.z) > STEP_GRASS ? 'grass' : 'ground';
}

/** Шлюзы корабля, на палубе которого пилот. */
function airHere() {
  const V = aboardVessel();
  return V.own ? ownAir() : V.air;
}

/** Воздух у ног, бар: в помещении — его давление (js/game/airlock.js), за бортом — тела. */
function feetAir() {
  const w = game.walk, air = airHere();
  if (!w.out) {
    const r = air && w.room ? roomAir(air, w.room.id) : null;
    return r ? r.p : 1;
  }
  const G = w.out;
  groundToWorld(G, w.pos, _feetW);
  return airDensity(G.body, Math.max(0, Math.hypot(_feetW.x - G.body.pos.x, _feetW.y - G.body.pos.y,
    _feetW.z - G.body.pos.z) - G.body.radius));
}

/** За бортом: где, тяжесть, воздух и до корабля. */
function outHint() {
  const w = game.walk;
  if (!w.out) return null;
  const G = w.out;
  groundToWorld(G, w.pos, _feetW);
  const g = gravityAt(G.body, _feetW) * 1000;
  const p = feetAir();
  // До своего корабля — если он в этой системе: пассажир чужого корабля
  // мог оставить свой за световые годы отсюда.
  const d = ship.away ? 0 : Math.hypot(_feetW.x - ship.pos.x, _feetW.y - ship.pos.y, _feetW.z - ship.pos.z) * 1000;
  return {
    name: L('ЗА БОРТОМ') + ' · ' + G.body.name,
    info: L('ТЯЖЕСТЬ ') + g.toFixed(1) + L(' М/С²') + ' · ' + (p > 0.005 ? L('ВОЗДУХ ') + p.toFixed(2) + L(' БАР') : L('ВАКУУМ')),
    ship: d > 25 ? L('ДО КОРАБЛЯ ') + Math.round(d) + L(' М') : null,
  };
}

function crash(reason) {
  seatPilot();
  game.entry = null;
  game.crashReason = reason;
  game.stats.crashes++;
  // Корабля больше нет, и знать об этом должен сервер: корпус в базе
  // пишет только он. Вред себе, а не другому, — поэтому доклад так и
  // называется и ничем не проверяется.
  tellImpact(null, true);
  ship.hull = 0;
  ship.speed = 0;
  ship.throttle = 0;
  ship.lift = 0;
  ship.landedAt = null;
  stopDockingComputer(ship);
  stopLanding(ship);
  game.state.mode = ST.CRASHED;
  audioCue(game.audio, 'crash');
  audioReset(game.audio, ship);
  input.releaseAll();
  showCrash(game);
}

// --- телепорт к цели (инструмент проверки) -----------------------------------

const _tpDir = v3();
const _tpPos = v3();
const _tpAim = v3();

/**
 * Поставить корабль к выбранной цели на заданную высоту.
 *
 * Точка выбирается на освещённой стороне под углом к солнцу около 45°:
 * в скользящем свете рельеф читается лучше всего, а в подсолнечной
 * точке теней нет вовсе. Высота считается над РЕЛЬЕФОМ, а не над сферой,
 * поэтому «50 м» — это действительно 50 метров над грунтом.
 */
function teleportToTarget() {
  const st = game.state;
  const t = currentTarget(game.nav);
  if (!t) { say(st, L('ЦЕЛЬ НЕ ВЫБРАНА'), '#ff7a66'); return; }

  stopDockingComputer(ship);
  stopLanding(ship);
  ship.lift = 0;
  ship.landedAt = null;
  ship.landedPose = null;
  stopQuantum(game.quantum);

  if (t.isStation) {
    const b = makeBasis();
    b.fwd = { x: -t.basis.fwd.x, y: -t.basis.fwd.y, z: -t.basis.fwd.z };
    b.right = { ...t.basis.right };
    b.up = normalize(v3(
      b.fwd.y * b.right.z - b.fwd.z * b.right.y,
      b.fwd.z * b.right.x - b.fwd.x * b.right.z,
      b.fwd.x * b.right.y - b.fwd.y * b.right.x));
    placeShip(ship, v3(
      t.pos.x + t.basis.fwd.x * 6,
      t.pos.y + t.basis.fwd.y * 6,
      t.pos.z + t.basis.fwd.z * 6), b);
    audioReset(game.audio, ship);
    say(st, L('ТЕЛЕПОРТ: ') + t.name + L(', 6 км до порта'), '#78e08f');
    return;
  }

  const alt = TELEPORT_ALTS[game.teleAlt];

  // Направление на солнце и перпендикуляр к нему — точка ставится между
  // ними, то есть ближе к терминатору, но на свету.
  normalize(v3(
    world.star.pos.x - t.pos.x,
    world.star.pos.y - t.pos.y,
    world.star.pos.z - t.pos.z), _tpDir);
  let perp = normalize(v3(-_tpDir.z, 0, _tpDir.x));
  if (!isFinite(perp.x) || Math.hypot(perp.x, perp.y, perp.z) < 0.5) {
    perp = normalize(v3(0, 1, 0));
  }
  const k = Math.SQRT1_2;
  normalize(v3(
    _tpDir.x * k + perp.x * k,
    _tpDir.y * k + perp.y * k,
    _tpDir.z * k + perp.z * k), _tpDir);

  // Мировое направление -> локальное: высота считается по рельефу.
  const dirLocal = localDir(t, v3(
    t.pos.x + _tpDir.x * t.radius,
    t.pos.y + _tpDir.y * t.radius,
    t.pos.z + _tpDir.z * t.radius));
  const r = groundRadius(t, dirLocal) + alt;
  worldPoint(t, dirLocal, r, _tpPos);

  // С высоты смотрим в центр тела, у самой земли — вперёд и вниз, чтобы
  // в кадр попали и грунт под собой, и горизонт.
  if (alt > 3) {
    _tpAim.x = t.pos.x; _tpAim.y = t.pos.y; _tpAim.z = t.pos.z;
  } else {
    const side = normalize(v3(
      -_tpDir.z, _tpDir.y * 0.0001, _tpDir.x));
    const ahead = localDir(t, v3(
      _tpPos.x + side.x * alt * 6,
      _tpPos.y + side.y * alt * 6,
      _tpPos.z + side.z * alt * 6));
    worldPoint(t, ahead, groundRadius(t, ahead), _tpAim);
  }

  const b = makeBasis();
  lookAlong(b, normalize(v3(
    _tpAim.x - _tpPos.x, _tpAim.y - _tpPos.y, _tpAim.z - _tpPos.z)), _tpDir);
  placeShip(ship, _tpPos, b);
  audioReset(game.audio, ship);
  say(st, L('ТЕЛЕПОРТ: ') + t.name + L(', высота ') + fmtDist(alt), '#78e08f');
}

/**
 * Выбрать цель объектом, а не номером: список целей пересобирается на
 * ходу. Маркер тела, рядом с которым корабль не находится, в список не
 * попадает — тогда встаём на само тело.
 */
game.selectTarget = (t) => selectTarget(t);

function selectTarget(t) {
  if (!t) return;
  refreshNav(game.nav, world, ship, game.peers);
  let i = game.nav.list.indexOf(t);
  if (i < 0 && t.isMarker) i = game.nav.list.indexOf(t.body);
  if (i >= 0) game.nav.index = i;
}

// --- сохранение --------------------------------------------------------------
//
// В сохранении ДВА места, и это главное, что здесь надо помнить:
//
//   ship — где корабль, которым пилот командует: система, порт, стоянка,
//          якорь, точка, люки. Корабль стоит там, где его оставили, —
//          даже если сам пилот ушёл пешком или улетел пассажиром;
//   me   — где сам пилот: в кресле своего корабля, на палубе (своего
//          или чужого), на грунте.
//
// При входе в игру пилот оказывается там, где был, а не за штурвалом.

/** Где корабль, которым пилот командует: то, что пишет сервер в `ship`. */
function shipRecord() {
  if (ship.away && ship.keep) return ship.keep;
  return {
    id: ship.id,
    system: ship.away ? ship.sysId : sys.id,
    pos: ship.pos,
    basis: ship.basis,
    docked: ship.dockedAt ? ship.dockedAt.id : null,
    // Стоянка на поверхности хранится в локальных осях тела: мировые
    // координаты через сутки указывали бы в пустоту.
    landed: ship.landedAt
      ? { id: ship.landedAt.id, pose: ship.landedPose, secured: ship.secured }
      : null,
    // ...и место в ПОЛЁТЕ — по той же причине и в тех же осях
    // (js/game/anchor.js). Мир при входе ставится на серверное «сейчас»,
    // а корабль — туда, где он был записан: за час между этими двумя
    // моментами грунт Lave IV уезжает на восемьсот километров.
    anchor: game.state.mode === ST.FLIGHT ? shipAnchor(game.capture, ship) : null,
    gear: ship.gear.out,
    // Открытые люки: корабль, который хозяин оставил с открытым трапом,
    // так и стоит — и в него можно зайти.
    hatches: ship.hatchesWant ? ship.hatchesWant.slice()
      : openHatches(ownAir()),
  };
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** Куда смотрит идущий — по горизонту палубы или грунта: [x, 0, z]. */
function walkFace(w, out = [0, 0, 1]) {
  out[0] = Math.sin(w.yaw); out[1] = 0; out[2] = Math.cos(w.yaw);
  return out;
}

/** Где сам пилот: то, что пишет сервер в `me`. */
function meRecord() {
  const w = game.walk, I = game.interior;
  // Пилота ещё не поставили (помещения грузятся): где он, знает запись,
  // с которой игра поднялась. Иначе первое же сохранение после входа
  // усадило бы в кресло того, кто вышел из игры на грунте.
  if (game.pendingMe) return game.pendingMe;
  if (!w.on) return { aboard: ship.id, own: true, seated: true };
  if (w.out) {
    const G = w.out;
    groundToWorld(G, w.pos, _feetW);
    const o = bodyLocal(G.body, _feetW);
    const f = bodyLocalDir(G.body, groundDirToWorld(G, walkFace(w)));
    return {
      system: sys.id,
      out: {
        body: G.body.id,
        o: { x: r6(o.x), y: r6(o.y), z: r6(o.z) },
        f: { x: r6(f.x), y: r6(f.y), z: r6(f.z) },
        pitch: r3(w.pitch),
      },
    };
  }
  const V = aboardVessel();
  // Встаёт или садится — точка за креслом: там он и окажется при входе.
  const p = w.phase === 'walk' ? w.pos : (I ? I.seat.stand : w.pos);
  return {
    aboard: V.id, own: !!V.own, seated: false,
    walk: { pos: [r3(p[0]), r3(p[1]), r3(p[2])], yaw: r3(w.yaw), pitch: r3(w.pitch) },
  };
}

/**
 * Что именно сохраняется. Вынесено из save() отдельно, потому что этот
 * же снимок уходит на сервер: два разных набора полей у местного и
 * сетевого сохранения означали бы, что после переезда игрок теряет
 * половину состояния.
 */
function savePayload() {
  return {
    // Система, где САМ ПИЛОТ. Всё остальное в сейве (цель, порт, точка
    // стоянки) хранится идентификаторами тел, а те имеют смысл только
    // внутри своей системы.
    system: sys.id,
    ship: shipRecord(),
    me: meRecord(),
    // Цель варпа — часть плана полёта, как и обычная цель: выбрал
    // систему, отложил игру, вернулся.
    warpTo: game.warpTarget ? game.warpTarget.id : null,
    hull: ship.hull,
    shield: ship.shield,
    // Бак — для автономной игры: сервер это поле не читает вовсе, топливо
    // у него своё (server/src/Players.php, save), как и корпус.
    fuel: ship.fuel,
    // Цель хранится идентификатором, а не номером в списке: список
    // теперь меняется на ходу (у ближнего тела появляются маркеры), и
    // номер после загрузки указывал бы в произвольное место.
    // Пилот целью НЕ сохраняется: его id — это номер игрока, а в сейве
    // тем же полем хранится номер тела. Записав одно вместо другого, при
    // следующем входе получим цель «планета номер семь».
    target: savedTargetId(),
    view: game.walk.on ? (game.walk.prevView || 'cockpit') : game.state.view,
    last: game.lastStation ? game.lastStation.id : null,
    audio: { on: game.audio.on, vol: game.audio.vol },
    stats: game.stats,
    // Дела пилота переживают и смену системы, и смену корпуса.
    player: savePlayer(game.player),
    time: world.time,
  };
}

/**
 * Сохранить: в браузер сразу, на сервер — фоном.
 * @param now не ждать очереди (js/net/session.js): пересадка в другой корабль
 */
function save(now = false) {
  const data = savePayload();
  // Местное сохранение остаётся ВСЕГДА, даже когда есть сервер: это кэш,
  // с которого игра поднимется, если сети не окажется в следующий раз.
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) { /* приватный режим — просто не сохраняем */ }
  // Свой корабль в другой системе — его место серверу не пишем: где он
  // стоит, сервер знает лучше нас (мы его давно не видели).
  const out = ship.away ? Object.assign({}, data, { ship: null }) : data;
  // А на сервер оно уходит фоном и не чаще, чем нужно (js/net/session.js).
  if (now) { session.dirty = out; flushSave(); } else queueSave(out);
}

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { s = null; }
  if (!s) return false;
  return applyState(s);
}

/** Место корабля в сохранении старого вида (полями верхнего уровня). */
function legacyShip(s) {
  return {
    id: undefined, system: s.system === undefined ? 0 : s.system, pos: s.pos, basis: s.basis,
    docked: s.docked, landed: s.landed, anchor: s.anchor, gear: s.gear, hatches: [],
  };
}

/**
 * Разложить сохранение по игре.
 *
 * Вынесено из load() потому, что источников сохранения стало два —
 * localStorage и сервер, — а раскладывать его обязан ОДИН код. Иначе
 * «загрузился из браузера» и «загрузился с сервера» неизбежно начнут
 * отличаться мелочами вроде потерянной цели или вида камеры, и ловить
 * это придётся руками в браузере.
 */
function applyState(s) {
  if (!s) return false;
  const me = s.me || null;
  const rec = s.ship || legacyShip(s);
  // Система — ДО всего остального: пока она не та, любой идентификатор
  // из сейва указывает в чужой список тел. И это система ПИЛОТА: его
  // корабль мог остаться в другой.
  const personSys = me && typeof me.system === 'number' ? me.system
    : (typeof s.system === 'number' ? s.system : (typeof rec.system === 'number' ? rec.system : 0));
  const saved = systemById(personSys);
  if (saved && saved.seed !== sys.seed) enterSystem(saved);
  game.warpTarget = s.warpTo === null || s.warpTo === undefined ? null : systemById(s.warpTo);
  // Время мира СТАВИТСЯ, а не прибавляется: система могла быть собрана
  // чуть выше (enterSystem), и её часы уже стоят на общем времени —
  // прибавка дала бы удвоенное время и орбиты, где их никто не увидит.
  world.time = 0;
  updateWorld(world, s.time || 0);
  game.stats = Object.assign({ landings: 0 }, s.stats || game.stats);
  if (s.player) loadPlayer(game.player, s.player);
  selectTarget(targetById(world, s.target));
  game.state.view = s.view || 'cockpit';
  // Ноль — это ЧИСЛО, а не «нет значения». Здесь стояло `s.hull || max`, и
  // разбитый корабль (корпус ровно 0) приезжал с сервера целёхоньким: на
  // экране сотня, на сервере ноль, и первое же попадание убивало «полный»
  // корпус. Щит строкой ниже всегда читался правильно — тем обиднее.
  ship.hull = typeof s.hull === 'number' ? s.hull : SHIP.maxHull;
  ship.shield = typeof s.shield === 'number' ? s.shield : SHIP.maxShield;
  game.lastStation = world.stations.find((x) => x.id === s.last) || null;
  if (s.audio) {
    game.audio.on = s.audio.on !== false;
    game.audio.vol = typeof s.audio.vol === 'number' ? s.audio.vol : game.audio.vol;
  }
  if (typeof s.fuel === 'number') ship.fuel = clamp(s.fuel, 0, SHIP.fuelCap);
  // Состояние пришло — долги по варпу сервер уже учёл в нём (или их не
  // было вовсе): считать их поверх значило бы списать прыжок дважды.
  if (!ship.work) resetFuelBook(ship);
  ship.warpDebt = 0;
  game.fuelSaid = fuelLevel(ship);

  if (typeof rec.id === 'number') ship.id = rec.id;
  ship.sysId = typeof rec.system === 'number' ? rec.system : sys.id;
  ship.away = ship.sysId !== sys.id;
  ship.keep = ship.away ? rec : null;
  // Пилот — после того, как встанут на места корабли: ставить его не на
  // что, пока не известно, где его палуба. Помещения грузятся лениво, и
  // ставит его restoreMe, когда они готовы.
  game.pendingMe = me;
  game.pendingAboard = s.aboard || null;
  seatPilot();
  let res;
  if (ship.away) {
    // Свой корабль — в другой системе: пилот здесь пассажиром или на
    // грунте. Вести нечего, режим — нейтральный полёт.
    game.state.mode = ST.FLIGHT;
    res = 'away';
  } else {
    res = placeOwnShip(rec);
  }
  if (game.interior) restoreMe();
  else if (me && (me.out || me.seated === false)) loadInterior();
  return res;
}

/**
 * Поставить свой корабль туда, где он записан: в порт, на грунт, в
 * полёт у тела или в мировую точку.
 */
function placeOwnShip(rec) {
  ship.gear.out = !!rec.gear;
  ship.gear.t = rec.gear ? 1 : 0;
  ship.hatchesWant = Array.isArray(rec.hatches) ? rec.hatches.slice() : [];
  if (ownAir()) {
    setHatches(ownAir(), ship.hatchesWant, true);
    ship.hatchesWant = null;
  }
  const findStation = (id) => world.stations.find((x) => x.id === id) || null;
  if (rec.landed && rec.landed.pose) {
    const body = world.bodies.find((b) => b.id === rec.landed.id);
    if (body) {
      ship.landedAt = body;
      ship.landedPose = rec.landed.pose;
      ship.secured = !!rec.landed.secured;
      ship.gear.out = true;
      ship.gear.t = 1;
      updateLandedPose(ship);
      game.state.mode = ST.LANDED;
      game.zone = landingContext(world, ship);
      return 'landed';
    }
  }

  const dockedStation = findStation(rec.docked);
  if (dockedStation) {
    ship.dockedAt = dockedStation;
    game.lastStation = dockedStation;
    game.state.mode = ST.DOCKED;
    return 'docked';
  }
  // Место у тела — ПЕРЕД мировыми координатами: пока пилота не было,
  // планета и повернулась, и уехала по орбите, и мировая точка теперь
  // указывает либо в пустоту, либо внутрь горы (js/game/anchor.js).
  if (anchorOk(rec.anchor)) {
    const host = world.bodies.find((b) => b.id === rec.anchor.id);
    const pose = anchorPose(host, rec.anchor);
    if (pose) {
      placeShip(ship, pose.pos, pose.basis);
      game.state.mode = ST.FLIGHT;
      return 'flight';
    }
  }
  if (rec.pos) {
    // Базис может не прийти вовсе: у нового пилота на сервере он пуст, а
    // место уже есть. Ставим корабль как есть — с нынешним разворотом,
    // иначе игра решит, что сохранения нет, и начнёт с порта.
    placeShip(ship, rec.pos, rec.basis || ship.basis);
    game.state.mode = ST.FLIGHT;
    return 'flight';
  }
  return false;
}

/**
 * Поставить пилота туда, где он был: в кресло, на палубу своего или
 * чужого корабля, на грунт. Зовётся, когда готовы помещения.
 */
function restoreMe() {
  const me = game.pendingMe, I = game.interior;
  if (!me || !I) return;
  game.pendingMe = null;
  const w = game.walk;
  if (me.out && me.out.o && typeof me.out.body === 'number') {
    const body = world.bodies.find((b) => b.id === me.out.body);
    if (!body) return;
    const P = bodyWorld(body, me.out.o);
    const F = bodyWorldDir(body, me.out.f || { x: 0, y: 0, z: 1 });
    standUp(w, I);
    w.phase = 'walk';
    w.out = makeGroundFrame(body, P, F);
    w.vessel = null;
    w.air = null;
    w.room = null;
    w.pos = [0, 0, 0];
    w.yaw = 0;
    w.pitch = clamp(me.out.pitch || 0, -1.2, 1.2);
    game.frame = ownVessel;
  } else if (me.seated === false && me.walk && Array.isArray(me.walk.pos)) {
    const own = me.own || me.aboard === ship.id;
    const V = own ? (ship.away ? null : ownVessel) : pinVessel(me.aboard);
    if (!V) return;
    standUp(w, I);
    w.phase = 'walk';
    w.pos = me.walk.pos.slice(0, 3);
    w.yaw = me.walk.yaw || 0;
    w.pitch = clamp(me.walk.pitch || 0, -1.2, 1.2);
    boardVessel(V);
    w.room = I.roomAt(w.pos) || w.room;
  } else {
    return;                     // в кресле — так и стоит после seatPilot
  }
  // На ногах — взгляд от первого лица, а не из-за корабля.
  w.prevView = game.state.view || 'cockpit';
  game.state.view = 'cockpit';
  game.walkIntro = 0;
  syncCargo(true);
  if (game.state.mode === ST.DOCKED) hideOverlay();
}

/**
 * Чужой корабль, на борту которого пилот вышел из игры: пока сокет не
 * прислал его снимка, ставим по тому, что знает сервер (state.aboard), —
 * без водителя, на его стоянке. Хозяина нет в игре — сервер такого
 * пассажира уже вернул к себе (Players::state), и сюда он не попадает.
 */
function pinVessel(id) {
  const a = game.pendingAboard;
  if (a && a.id === id) aboardPin = vesselEntry(a);
  if (!aboardPin || aboardPin.id !== id) return null;
  const tNow = performance.now() / 1000;
  ingestPeers(peerStore, [aboardPin], tNow);
  game.peers = peerPoses(peerStore, tNow, game.peers, world);
  const V = game.peers.find((p) => p.id === id) || null;
  if (V) vesselAir(V);
  return V;
}

/** Запись корабля, как её шлёт хаб (dorm), — из того, что отдал сервер. */
function vesselEntry(a) {
  const e = {
    id: a.id, by: a.ownerId, name: a.ownerName || '', dorm: 1, sys: a.systemId,
    mode: a.landedBody !== null && a.landedBody !== undefined ? 'landed' : 'flight',
    g: a.gearOut || a.landedBody !== null ? 1 : 0, h: a.hatches || [],
  };
  const lp = a.landedPose, ap = a.anchorPose;
  if (a.landedBody !== null && a.landedBody !== undefined && lp && lp.dir && lp.fwd && lp.up) {
    Object.assign(e, { b: a.landedBody, lx: lp.dir.x * lp.radius, ly: lp.dir.y * lp.radius, lz: lp.dir.z * lp.radius,
      lfx: lp.fwd.x, lfy: lp.fwd.y, lfz: lp.fwd.z, lux: lp.up.x, luy: lp.up.y, luz: lp.up.z });
  } else if (a.anchorBody !== null && a.anchorBody !== undefined && ap && ap.pos) {
    Object.assign(e, { b: a.anchorBody, lx: ap.pos.x, ly: ap.pos.y, lz: ap.pos.z,
      lfx: ap.fwd.x, lfy: ap.fwd.y, lfz: ap.fwd.z, lux: ap.up.x, luy: ap.up.y, luz: ap.up.z });
  } else if (a.pos) {
    const bs = a.basis || {};
    Object.assign(e, { x: a.pos.x, y: a.pos.y, z: a.pos.z,
      fx: bs.fwd ? bs.fwd.x : 0, fy: bs.fwd ? bs.fwd.y : 0, fz: bs.fwd ? bs.fwd.z : 1,
      ux: bs.up ? bs.up.x : 0, uy: bs.up ? bs.up.y : 1, uz: bs.up ? bs.up.z : 0 });
  }
  return e;
}

/**
 * Состояние с сервера — в тот же вид, что и местное сохранение.
 *
 * Перекладывание в одном месте: дальше его разбирает applyState, тот же
 * код, что и для localStorage.
 */
function serverToSave(st) {
  const pos = st.position || {};
  const sh = st.ship || {};
  // На чём летит этот пилот, знает сервер. Пока корпус один, вызов ничего
  // не меняет; когда их станет несколько, корабль соберётся по тому, что
  // записано в базе, а не по первому из списка.
  if (sh.type && sh.type.code) useShipType(sh.type.code);
  syncHull();
  // ...и на чём именно: числа двигателя, щита и трюма принадлежат
  // модулям, а какие из них стоят в гнёздах, знает база (ship_equipment).
  // До этого момента корабль собран по заводской комплектации каталога.
  if (sh.equipment) useShipEquipment(sh.equipment);
  game.fleet = Array.isArray(st.fleet) ? st.fleet : [];
  const me = st.me || null;
  const shipSys = pos.systemId === null || pos.systemId === undefined ? 0 : pos.systemId;
  return {
    system: me && typeof me.systemId === 'number' ? me.systemId : shipSys,
    warpTo: pos.warpTo === undefined ? null : pos.warpTo,
    hull: sh.hull,
    shield: sh.shield,
    fuel: sh.fuelT,
    target: pos.targetBody === undefined ? null : pos.targetBody,
    view: pos.view,
    last: pos.lastStation === undefined ? null : pos.lastStation,
    ship: {
      id: typeof sh.id === 'number' ? sh.id : undefined,
      system: shipSys,
      pos: pos.pos,
      basis: pos.basis,
      docked: pos.dockedBody === undefined ? null : pos.dockedBody,
      landed: pos.landedBody
        ? { id: pos.landedBody, pose: pos.landedPose, secured: pos.landedSecured }
        : null,
      anchor: pos.anchorBody && pos.anchorPose
        ? Object.assign({ id: pos.anchorBody }, pos.anchorPose) : null,
      gear: !!(pos.gearOut === undefined ? sh.gearOut : pos.gearOut),
      hatches: Array.isArray(pos.hatches) ? pos.hatches : [],
    },
    me: me ? {
      system: me.systemId, aboard: me.aboard, own: me.aboard === sh.id,
      seated: me.seated !== false, walk: me.walk || null, out: me.out || null,
    } : null,
    aboard: st.aboard || null,
    stats: st.player ? st.player.stats : null,
    // ВРЕМЯ МИРА, а не налёт пилота. Здесь стоял playTimeS, и это была
    // ровно та ошибка, из-за которой у двоих в одном месте станция была
    // в разных: у каждого свой налёт — значит, своя фаза орбит.
    time: st.world && typeof st.world.time === 'number' ? st.world.time : 0,
    // Звук — настройка браузера, а не игрока: он остаётся местным.
    audio: null,
  };
}

/**
 * Пилот едет пассажиром, и корабль ушёл в другую систему (варп хозяина):
 * игра переходит туда же. Свой корабль остаётся, где стоял: его место
 * запоминается (ship.keep) и возвращается, когда пилот вернётся туда.
 */
function rideTo(target) {
  if (!ship.away) ship.keep = shipRecord();
  enterSystem(target);
  ship.away = ship.sysId !== sys.id;
  if (!ship.away && ship.keep) {
    placeOwnShip(ship.keep);
    ship.keep = null;
  } else {
    game.state.mode = ST.FLIGHT;
  }
  say(game.state, L('СИСТЕМА ') + target.name.toUpperCase(), '#9fd9ff', 3);
  save();
}

/** Пассажиром — за своим кораблём: он в другой системе, значит, и мы. */
function followVessel() {
  const w = game.walk;
  if (!w.on || w.out || !w.vessel || w.vessel.own) { game.rideWarp = false; return; }
  const r = peerStore.by.get(w.vessel.id);
  // Хозяин ушёл в варп — сказать: за бортом в тоннеле не видно ничего,
  // а через полминуты будет другая система.
  const warp = !!r && r.out.mode === 'warp';
  if (warp && !game.rideWarp) say(game.state, L('ВАРП · КОРАБЛЬ УХОДИТ В ПРЫЖОК'), '#9fd9ff', 4);
  game.rideWarp = warp;
  const vs = r ? r.out.sys : (aboardPin ? aboardPin.sys : null);
  if (typeof vs !== 'number' || vs === sys.id) return;
  const target = systemById(vs);
  if (target) rideTo(target);
}

/** Длина шага при скорости v (js/game/walker.js) — ноги чужих по ней. */
const strideAt = (v) => {
  const k = clamp((v - WALK.speed) / (WALK.run - WALK.speed), 0, 1);
  return WALK.stride + (WALK.strideRun - WALK.stride) * k;
};

/** Где в мире стоят люди: ноги и оси (js/game/vessels.js, personPlace). */
function placePeople() {
  for (const p of game.people) {
    if (!p.place) p.place = { pos: v3(), basis: makeBasis() };
    let V = null, body = null;
    if (p.st !== 'out') V = p.ship === ship.id && !ship.away ? ownVessel : game.peers.find((x) => x.id === p.ship) || null;
    else body = world.bodies.find((b) => b.id === p.body) || null;
    p.vessel = V;
    p.here = personPlace(p, V, body, p.place);
  }
}

/** Пилот на ногах — его снимок для хаба (сокет, поле me). */
function meNet() {
  const w = game.walk, I = game.interior;
  if (game.pendingMe) return null;
  if (!w.on) {
    if (ship.id === null || ship.away) return null;
    const e = I && I.code === HULL.code ? I.seat.eye : (HULL.canopy ? [EYE.x, EYE.y, EYE.z] : [HULL.eye.x * 1000, HULL.eye.y * 1000, HULL.eye.z * 1000]);
    return { st: 'seat', s: ship.id, x: r3(e[0]), y: r3(e[1]), z: r3(e[2]), yaw: 0, pitch: 0, v: 0, air: 0 };
  }
  const v = r3(Math.hypot(w.vel[0], w.vel[2]));
  if (w.out) {
    const G = w.out;
    groundToWorld(G, w.pos, _feetW);
    const o = bodyLocal(G.body, _feetW);
    const f = bodyLocalDir(G.body, groundDirToWorld(G, walkFace(w)));
    return { st: 'out', b: G.body.id, lx: r6(o.x), ly: r6(o.y), lz: r6(o.z),
      lfx: r3(f.x), lfy: r3(f.y), lfz: r3(f.z), yaw: 0, pitch: r3(w.pitch), v, air: w.ground ? 0 : 1 };
  }
  const V = aboardVessel();
  if (V.id === null || V.id === undefined) return null;
  return { st: 'walk', s: V.id, x: r3(w.pos[0]), y: r3(w.pos[1]), z: r3(w.pos[2]),
    yaw: r3(w.yaw), pitch: r3(w.pitch), v, air: w.ground ? 0 : 1 };
}

/** Свой корабль у тела — в его осях (для соседей, js/game/peers.js). */
function shipLocal() {
  const body = ship.landedAt || game.capture;
  if (!body) return null;
  return { b: body.id, pos: bodyLocal(body, ship.pos), fwd: bodyLocalDir(body, ship.basis.fwd),
    up: bodyLocalDir(body, ship.basis.up) };
}

/**
 * Название карты в человеческий вид.
 *
 * Браузер отдаёт его строкой вроде «ANGLE (Intel, Intel(R) UHD Graphics
 * 630 Direct3D11 vs_5_0 ps_5_0, D3D11)» — в сообщении посреди полёта от
 * неё нужен только сам чип.
 */
function shortGpu(name) {
  const m = String(name).match(/\(([^,()]+),\s*([^,()]+)/);
  const s = (m ? m[2] : String(name)).replace(/direct3d.*$/i, '').replace(/\(r\)|\(tm\)/gi, '');
  return s.trim().slice(0, 40).toUpperCase();
}

/** Что из выбранного вообще можно записать в сейв. */
function savedTargetId() {
  const t = currentTarget(game.nav);
  return t && !t.isPeer && typeof t.id === 'number' ? t.id : null;
}

// --- бой ---------------------------------------------------------------------

const _fired = [];
const _ships = [];

/**
 * Кто в этой системе может остановить болт.
 *
 * Свой корабль в списке ОБЯЗАТЕЛЬНО: чужие болты должны гаснуть о нашу
 * обшивку, а не пролетать сквозь неё. Урон от них при этом всё равно
 * считает сервер — здесь только картинка.
 */
function combatShips() {
  _ships.length = 0;
  _ships.push({ id: net.you ? net.you.id : 0, pos: ship.pos, own: true });
  for (const p of game.peers) _ships.push(p);
  return _ships;
}

/**
 * Кого ведёт кардан.
 *
 * Сначала выбранная цель, потом то, на что наведён нос: в бою цель
 * теряется чаще, чем успеваешь нажать Tab, и требовать выбора ради
 * каждого выстрела значит требовать лишнего.
 */
function gunTarget() {
  const cur = currentTarget(game.nav);
  if (cur && cur.isPeer) return cur;
  if (game.aimed && game.aimed.isPeer) return game.aimed;
  return null;
}

function fireNow() {
  const fired = fireGuns(game.guns, ship, gunTarget(), HULL.guns, _fired);
  if (!fired.length) return;
  const b = fired[0];
  // Чужие увидят выстрел только если мы о нём скажем: сервер пересылает
  // его как картинку, урон идёт отдельным путём (reportHit).
  //
  // Уходит направление СТВОЛА, а не путь болта: путь складывается ещё и
  // с нашим ходом, а его сосед подставит сам — нашу скорость он и так
  // знает по снимкам. Пошли мы путь, ход учёлся бы дважды.
  if (isOnline()) {
    const a = game.guns.aim;
    shoot(game.guns.spec.code, { x: b.x, y: b.y, z: b.z }, { x: a.x, y: a.y, z: a.z });
  }
}

/**
 * Доложить серверу об ударе о грунт.
 *
 * Уходит ИЗМЕРЕНИЕ — скорость касания, шасси, поза, — а не урон и тем
 * более не корпус: во сколько это обошлось, считает сервер. Местный
 * расчёт остаётся ПРЕДСКАЗАНИЕМ, чтобы полоса корпуса дрогнула в тот же
 * кадр, а ответ его поправляет.
 *
 * Дорога первая — сокет, рядом с боем: соединение уже открыто, и гибель
 * надо тут же показать соседям. Если сокета нет (играем с одним API),
 * тот же расчёт делает обычный запрос. Считает в обоих случаях один и
 * тот же Combat::impact.
 */
function tellImpact(m, fatal = false) {
  if (!isOnline()) return;
  const msg = {
    norm: (m && m.norm) || 0, slide: (m && m.slide) || 0,
    gear: !!(m && m.gear), pose: !!(m && m.pose), fatal,
  };
  if (reportImpact(msg)) return;          // ушло в сокет, ответ придёт событием
  apiImpact(msg).then((r) => {
    if (r && typeof r.hull === 'number') ship.hull = r.hull;
    if (r && r.dead) killedInAction(L('ГРУНТ'));
  }).catch(() => { /* сеть моргнула: корпус поправится следующим состоянием */ });
}

/**
 * Корабль, на борту которого мы ехали, погиб (сервер увёл его в порт с
 * пассажирами) или ушёл из мира вместе с хозяином (сервер вернул нас в
 * кресло своего, Hub::strand). Где мы теперь, — спрашиваем у него.
 */
async function rideLost(text = L('КОРАБЛЬ, НА КОТОРОМ ВЫ ЕХАЛИ, УНИЧТОЖЕН'), color = '#ff7a66') {
  say(game.state, text, color, 5);
  const st = await serverRefresh();
  if (!st) return;
  applyState(serverToSave(st));
  applyServer(game.player, st);
  save();
}

/** Что пришло по сокету из боя. */
function applyNetEvent(ev) {
  if (ev.t === 'shot') {
    // Скорость стрелка — из своего списка пилотов: болт обязан унести её
    // с собой, иначе очередь соседа тянется за его кормой.
    const from = game.peers.find((p) => p.id === ev.by) || null;
    addForeignBolt(game.guns, ev, from ? from.vel : null);
    return;
  }
  if (ev.t === 'hurt') {
    // Корпус и щит берём СЕРВЕРНЫЕ, а не вычитаем свои: считать урон
    // дважды — верный способ получить два разных корпуса у двух людей.
    if (typeof ev.hull === 'number') ship.hull = ev.hull;
    if (typeof ev.shield === 'number') ship.shield = ev.shield;
    game.hurt = 0.4;
    game.sinceHit = 0;
    // Щит не виден вовсе — кроме этого мига. Вспышка у обшивки и есть
    // весь его вид: постоянное свечение вокруг корабля превратило бы бой
    // в дискотеку.
    if (ev.absorbed > 0 && !hasShieldFlash(game.guns, 0, true)) {
      // Стрелявший далеко, и его болт мог разойтись с нашим кадром.
      // Тогда бьём оболочку со стороны стрелка — это ближе к правде, чем
      // не показать её вовсе.
      const from = game.peers.find((p) => p.id === ev.by) || null;
      const at = from ? from.pos : { x: ship.pos.x, y: ship.pos.y, z: ship.pos.z + 1 };
      shieldFlash(game.guns, 0, true, at, ship.pos, ship.basis);
    }
    audioCue(game.audio, 'hit', { damage: Math.min(1, (ev.dmg || 1) / 12) });
    say(game.state, ev.absorbed > 0
      ? L('ЩИТ ДЕРЖИТ · ') + Math.round(ship.shield)
      : L('ПОПАДАНИЕ · КОРПУС ') + Math.round(ship.hull) + '%', '#ff7a66', 2);
    if (ev.dead) killedInAction(ev.name || L('ПИЛОТ'));
    return;
  }
  if (ev.t === 'hitok') {
    game.targetHull = {
      id: ev.id, hull: ev.hull, max: ev.max,
      shield: ev.shield, smax: ev.smax, at: performance.now() / 1000,
    };
    // Щит цели тоже виден только вспышкой — на её борту.
    const t = game.peers.find((p) => p.id === ev.id);
    if (t && ev.absorbed > 0 && !hasShieldFlash(game.guns, ev.id, false)) {
      shieldFlash(game.guns, ev.id, false, ship.pos, t.pos, t.basis);
    }
    if (ev.dead) say(game.state, L('ЦЕЛЬ УНИЧТОЖЕНА'), '#78e08f', 4);
    return;
  }
  if (ev.t === 'impact') {
    // Корпус берём СЕРВЕРНЫЙ: свой был предсказанием, а счёт ведёт он.
    if (typeof ev.hull === 'number') ship.hull = ev.hull;
    if (ev.dead) killedInAction(L('ГРУНТ'));
    return;
  }
  if (ev.t === 'hatchreq') {
    hatchRequest(ev);
    return;
  }
  if (ev.t === 'boom') {
    // Корабль, на борту которого мы едем, уничтожен: страховка увела его в
    // порт вместе с пассажирами (Combat::respawnShip) — забираем место.
    const w = game.walk;
    if (w.on && !w.out && w.vessel && !w.vessel.own && ev.id === w.vessel.id) {
      rideLost();
      return;
    }
    say(game.state, L('ГДЕ-ТО РЯДОМ УНИЧТОЖЕН КОРАБЛЬ'), '#ffcc66', 3);
    return;
  }
  if (ev.t === 'home') {
    // Хозяин корабля, на палубе которого мы стояли, ушёл из игры и не
    // вернулся за Hub::GRACE: корабля больше нет в мире, и сервер уже
    // посадил нас в кресло своего. Палубу под ногами держал aboardPin —
    // отпускаем, иначе чужой корабль постоял бы ещё PEER_TTL.
    aboardPin = null;
    dropPeer(peerStore, ev.ship);
    rideLost(L('ХОЗЯИН КОРАБЛЯ ВЫШЕЛ ИЗ ИГРЫ · ВЫ НА СВОЁМ КОРАБЛЕ'), '#ffcc66');
    return;
  }
  if (ev.t === 'fuel') {
    // Бак по счёту сервера — он главнее своего: свой был предсказанием по
    // тем же формулам (js/game/fuel.js), а в базе бак пишет только сервер.
    applyServerFuel(ship, ev.fuel, ev.burnedAt);
  }
}

/**
 * Аварийный буксир: корабль с пустым баком — в порт.
 *
 * С сервером буксир — его решение (Fuel::rescue): он переставляет пилота
 * в порт, берёт тариф и доливает бак до резерва, а игра забирает
 * состояние, как после гибели. Без сервера тот же выход из тупика —
 * даром: платить некому.
 */
game.rescue = async () => {
  game.rescueArmed = 0;
  if (ship.dockedAt) return;
  const st = game.lastStation || (world.home && world.home.station);
  if (!isOnline()) {
    if (!st) return;
    stopQuantum(game.quantum);
    ship.fuel = Math.max(ship.fuel, fuelReserve());
    ship.landedAt = null;
    say(game.state, L('БУКСИР ДОТЯНУЛ ДО ПОРТА'), '#ffcc66', 5);
    dockAt(st, true);
    return;
  }
  try {
    const r = await serverRescue();
    const state = session.player;
    if (!state) throw new Error(L('нет связи с сервером'));
    stopQuantum(game.quantum);
    stopWarp(game.warp);
    applyState(serverToSave(state));
    syncFromServer(game, state);
    save();
    if (game.state.mode === ST.DOCKED) showDocked(game);
    say(game.state, L('БУКСИР ДОТЯНУЛ ДО ПОРТА · −') + r.fee + L(' кр'), '#ffcc66', 6);
  } catch (e) {
    say(game.state, L('БУКСИР: ') + e.message, '#ff7a66', 4);
  }
};

/**
 * U — вызвать буксир. Вызов необратим и стоит денег, поэтому с
 * подтверждения: первое нажатие только говорит, во что он обойдётся.
 */
function rescueKey() {
  if (!input.pressed('KeyU') || ship.dockedAt) return;
  if (game.warp.phase === 'tunnel') return;
  if (game.rescueArmed > 0) { game.rescue(); return; }
  game.rescueArmed = RESTART_CONFIRM;
  say(game.state, isOnline()
    ? L('U ЕЩЁ РАЗ — АВАРИЙНЫЙ БУКСИР ДО ПОРТА · ДО 600 КР')
    : L('U ЕЩЁ РАЗ — АВАРИЙНЫЙ БУКСИР ДО ПОРТА'), '#ffcc66', RESTART_CONFIRM);
}

/**
 * Сказать о баке, когда он переходит порог: мало, резерв, пусто.
 * Один раз на порог — и снова, только если его заправили и он опустился
 * опять.
 */
function fuelWatch() {
  const lvl = fuelLevel(ship);
  const rank = { ok: 0, low: 1, reserve: 2, dry: 3 };
  if (rank[lvl] < rank[game.fuelSaid]) { game.fuelSaid = lvl; return; }
  if (lvl === game.fuelSaid) return;
  game.fuelSaid = lvl;
  if (lvl === 'low') say(game.state, L('ТОПЛИВО НА ИСХОДЕ · МЕНЬШЕ ЧЕТВЕРТИ БАКА'), '#ffcc66', 4);
  else if (lvl === 'reserve') {
    say(game.state, L('ТОПЛИВО: РЕЗЕРВ · ПРЫЖКОВ НЕТ, ДО ПОРТА НА ДВИГАТЕЛЯХ'), '#ff7a66', 6);
  } else if (lvl === 'dry') {
    say(game.state, L('ТОПЛИВО КОНЧИЛОСЬ · ДВИГАТЕЛИ ОСТАНОВЛЕНЫ · U — БУКСИР'), '#ff7a66', 8);
  }
}

/**
 * Нас сбили.
 *
 * Экрана гибели здесь нет намеренно: сервер уже вернул корабль в порт
 * целым (Combat::respawn), и состояние надо просто забрать. Местный
 * «начать заново» здесь не годится вовсе — он завёл бы нового пилота с
 * демо-деньгами и затёр бы им серверного.
 */
async function killedInAction(by) {
  // Корабль погиб — пилот возвращается в кресло: восстанавливают его там.
  seatPilot();
  game.guns.bolts.length = 0;
  audioCue(game.audio, 'crash');
  say(game.state, L('КОРАБЛЬ УНИЧТОЖЕН · ') + by, '#ff7a66', 6);
  const st = await serverRefresh();
  if (!st) { crash(L('Корабль уничтожен в бою.')); return; }
  applyState(serverToSave(st));
  applyServer(game.player, st);
  save();
  if (game.state.mode === ST.DOCKED) showDocked(game);
  say(game.state, L('КОРАБЛЬ ВОССТАНОВЛЕН В ПОРТУ'), '#ffcc66', 6);
}

// --- глобальные клавиши ------------------------------------------------------

function handleKeys(dt) {
  if (!booted) return;
  const st = game.state;

  if (input.pressed('Backquote')) dbg.on = !dbg.on;

  // Список пилотов — вне разбора режимов и без захвата управления: его
  // смотрят на ходу, решая, куда лететь, а не вместо полёта.
  if (input.pressed('KeyP')) game.showPilots = !game.showPilots;

  // Звук. Клавиши намеренно вне разбора режимов ниже: выключать гул
  // надо и на карте, и в порту, а не только в полёте.
  if (input.pressed('KeyN')) {
    if (input.isDown('ShiftLeft', 'ShiftRight')) {
      // Начать заново — только с подтверждения: сохранение стирается.
      if (game.restartArmed > 0) game.restart();
      else {
        game.restartArmed = RESTART_CONFIRM;
        say(st, L('SHIFT+N ЕЩЁ РАЗ — НАЧАТЬ ЗАНОВО'), '#ff7a66', RESTART_CONFIRM);
      }
    } else {
      game.audio.on = !game.audio.on;
      sound.setMuted(!game.audio.on);
      say(st, game.audio.on ? L('ЗВУК ВКЛЮЧЁН') : L('ЗВУК ВЫКЛЮЧЕН'));
      save();
    }
  }
  if (input.pressed('Minus', 'Equal', 'NumpadSubtract', 'NumpadAdd')) {
    const up = input.pressed('Equal', 'NumpadAdd');
    game.audio.vol = clamp(game.audio.vol + (up ? 0.1 : -0.1), 0, 1);
    sound.setVolume(game.audio.vol);
    say(st, L('ГРОМКОСТЬ ') + Math.round(game.audio.vol * 100) + '%');
    save();
  }

  // На ногах ручки корабля остались в рубке: разбирается только своё —
  // сесть, справка, мышь. Ходьбу читает walkFrame. Это раньше тоннеля:
  // по кораблю ходят и в варпе.
  if (game.walk.on && st.mode !== ST.HELP) { walkKeys(); return; }

  // В тоннеле не работает ничего, кроме звука: карта чужой системы —
  // это карта того, чего сейчас нет (половину прыжка мир вообще не
  // собран), а справка и смена вида просто вернули бы игрока в кадр,
  // которого не рисуется.
  if (game.warp.phase === 'tunnel') {
    // Привод уходит в прыжок сам, когда корабль доцентровался, — и может
    // сделать это при открытом меню. Оставить его открытым нельзя:
    // клавиши в тоннеле не разбираются вовсе, и закрыть меню было бы
    // нечем до самого прибытия.
    game.menu.open = false;
    return;
  }

  // Меню пилота забирает ввод целиком: полётные клавиши на это время
  // не разбираются, иначе выбор раздела уводил бы корабль с курса.
  if (game.menu.open) { menuInput(game.menu, input); return; }
  if (input.pressed('KeyI')) {
    // Только в полёте. В порту и на грунте своё меню появится отдельно.
    if (st.mode === ST.FLIGHT) game.menu.open = true;
    return;
  }

  if (input.pressed('KeyH')) {
    if (st.mode === ST.HELP) game.closeOverlay();
    else if (st.mode === ST.FLIGHT || st.mode === ST.MAP || st.mode === ST.LANDED) {
      st.mode = ST.HELP;
      showHelp(game);
    }
    return;
  }

  if (input.pressed('KeyM')) {
    if (st.mode === ST.MAP) st.mode = restMode();
    else if (st.mode === ST.FLIGHT || st.mode === ST.LANDED) {
      st.mode = ST.MAP;
      // Карта открывается на том, куда летишь: выбранной оказывается
      // текущая цель, а вид охватывает всю систему. Искать себя на
      // плане каждый раз заново — работа, которой быть не должно.
      resetMap(game.map, world);
      game.map.sel = currentTarget(game.nav);
    }
    if (st.mode === ST.DOCKED) showDocked(game);
    else hideOverlay();
    return;
  }

  // Карта — единственный режим, где работают мышь и колесо, поэтому её
  // ввод разбирается целиком в js/ui/map.js, а не здесь.
  if (st.mode === ST.MAP) { mapInput(game, input); return; }

  // Y — встать с кресла: в полёте, на грунте и в порту.
  if (input.pressed('KeyY') && (st.mode === ST.FLIGHT || st.mode === ST.LANDED || st.mode === ST.DOCKED)) {
    game.rise();
    return;
  }

  if (st.mode === ST.DOCKED) {
    // 1–4 — разделы экрана станции (js/ui/station.js).
    if (stationKeys(game, input)) return;
    if (input.pressed('Space', 'Enter')) game.launch();
    return;
  }
  // Буксир вызывают и с грунта: пустой бак на луне — тот же тупик.
  if (st.mode === ST.FLIGHT || st.mode === ST.LANDED) rescueKey();
  if (st.mode === ST.LANDED) {
    // Одна клавиша на два действия, и разводятся они временем:
    // коротко нажал — зафиксировал корабль, подержал три секунды —
    // оторвался. Взлёт случайным нажатием не делается.
    const held = input.isDown('Space', 'Enter');
    // Нажатие считаем и по факту удержания, и по событию: очень короткое
    // нажатие успевает начаться и кончиться внутри одного кадра, и по
    // одному isDown его не видно вовсе.
    const tapped = input.pressed('Space', 'Enter');
    if (held) {
      game.landHold += dt;
      if (game.landHold >= LAND.holdOff) game.takeoff();
    } else {
      if ((game.landHold > 0 || tapped) && game.landHold < LAND.holdOff) game.secure();
      game.landHold = 0;
    }
    return;
  }
  if (st.mode === ST.CRASHED) {
    if (input.pressed('Space', 'Enter')) game.respawn();
    return;
  }
  if (st.mode !== ST.FLIGHT) return;

  if (input.pressed('KeyV')) {
    st.view = st.view === 'cockpit' ? 'chase' : 'cockpit';
  }

  // Tab выбирает то, на что НАВЕДЁН НОС. Перебора списка больше нет: в
  // системе два десятка целей, и щёлкать через полсистемы до нужной —
  // худший способ выбрать то, что и так видно на экране.
  if (input.pressed('Tab')) {
    const t = pickTarget(game.nav, ship);
    if (!t) { say(st, L('НАВЕДИ НОС НА ЦЕЛЬ'), '#ffcc66'); return; }
    say(st, L('ЦЕЛЬ: ') + targetLabel(t));
    // Смена цели на калибровке — это выбор другого маршрута, а не отказ
    // от прыжка: привод просто начинает считать заново.
    const q = game.quantum;
    if (q.phase === 'calib') startCalibration(q, t);
    else if (q.phase === 'jump') {
      abortQuantum(q, ship);
      say(st, L('ПРЫЖОК СОРВАН — ГАШЕНИЕ ХОДА'), '#ff7a66');
    }
  }

  // Левая кнопка мыши — огонь. Карданное оружие само доворачивает ствол
  // к выбранному пилоту; цели нет — бьёт по оси корабля. Удержание, а не
  // нажатие: очередь задаёт перезарядка, а не скорость пальца.
  if (input.mouse.left && st.mode === ST.FLIGHT) fireNow();

  // B — квантовый привод. Клавиша осталась прежней, но теперь это
  // синоним: тем же занимается J (см. ниже), и разучиваться не надо.
  if (input.pressed('KeyB')) quantumKey();

  /**
   * Квантовый привод: включить калибровку, а на ходу — сорвать прыжок.
   */
  function quantumKey() {
    const q = game.quantum;
    if (q.phase === 'jump') {
      abortQuantum(q, ship);
      say(st, L('ПРЫЖОК СОРВАН — ГАШЕНИЕ ХОДА'), '#ff7a66');
    } else if (q.phase === 'calib') { stopQuantum(q); say(st, L('ПРИВОД ОТКЛЮЧЁН')); }
    else {
      const t = currentTarget(game.nav);
      // Коридор проверяется и здесь, до калибровки: держать прицел три
      // секунды, чтобы узнать «перекрыто», — издевательство.
      const res = canJump(world, ship, t);
      if (!res.ok) {
        say(st, res.reason, '#ff7a66');
        // Помеху обходят через орбитальный маркер. Какой именно из шести
        // открыт, глазом не определить, поэтому привод сам выбирает ход
        // и сам ставит его целью: игроку остаётся нажать B ещё раз.
        if (res.block) {
          const hop = suggestHop(world, ship, t);
          if (hop) {
            selectTarget(hop);
            say(st, L('ОБХОД ЧЕРЕЗ ') + hop.name + L(' — B ЕЩЁ РАЗ'), '#ffcc66', 4);
          }
        }
      } else {
        stopDockingComputer(ship);
        stopLanding(ship);
        startCalibration(q, t);
        say(st, L('ПРИВОД: КАЛИБРОВКА НА ') + t.name, '#78e08f');
      }
    }
  }

  // J — ПРЫЖОК. Одна клавиша на оба привода.
  //
  // Раньше их было две: B — квантовый, внутри системы, J — варп, между
  // системами. Для игрока это различие техническое: он хочет «лететь к
  // тому, что выбрал», а каким приводом — дело корабля. Теперь J смотрит,
  // что выбрано, и берёт нужный привод; выбранная на карте галактики
  // система при этом стоит отметкой на экране с самого выбора
  // (drawWarpAim), а не появляется после первого нажатия.
  //
  // Порядок ветвей значим: J всегда отменяет ТО, ЧТО УЖЕ ИДЁТ, и только
  // на холодную решает, куда лететь. Иначе «отменить» пришлось бы искать
  // на другой клавише, и это была бы та же развилка, только хуже.
  if (input.pressed('KeyJ')) {
    const w = game.warp;
    const q = game.quantum;
    if (w.phase === 'tunnel') {
      // Оборвать прыжок между системами нельзя в принципе: обрывать
      // некуда, старой системы уже нет в памяти, а до новой не долетели.
      say(st, L('ВАРП НЕ ПРЕРЫВАЕТСЯ'), '#ffcc66');
    } else if (w.phase === 'align') {
      stopWarp(w);
      say(st, L('ВАРП ОТКЛЮЧЁН'));
    } else if (q.phase !== 'idle') {
      quantumKey();                       // идёт квантовый — им же и отменяем
    } else if (game.warpTarget) {
      const to = game.warpTarget;
      const res = canWarp(ship, sys, to);
      if (!res.ok) say(st, res.reason, '#ff7a66');
      else {
        stopQuantum(q);
        stopDockingComputer(ship);
        stopLanding(ship);
        startWarp(w, sys, to);
        say(st, L('ВАРП: ЦЕНТРОВКА НА ') + to.name.toUpperCase(), '#9fd9ff', 4);
      }
    } else {
      quantumKey();
    }
  }

  // K — телепорт к цели, Shift+K — сменить высоту и телепортироваться.
  if (input.pressed('KeyK')) {
    if (input.isDown('ShiftLeft', 'ShiftRight')) {
      game.teleAlt = (game.teleAlt + 1) % TELEPORT_ALTS.length;
    }
    teleportToTarget();
  }

  // O — фары (огни). Две лампы в носу: прямая и наклонённая вниз.
  if (input.pressed('KeyO')) {
    ship.lights = !ship.lights;
    say(st, ship.lights ? L('ФАРЫ ВКЛЮЧЕНЫ') : L('ФАРЫ ВЫКЛЮЧЕНЫ'),
      ship.lights ? '#ffe9a8' : null);
  }

  // T — гасители инерции. Выключил, и корабль летит по инерции: тяга
  // разгоняет, но ничего не держит, а в тяготении начинается падение.
  if (input.pressed('KeyT')) {
    ship.damp = !ship.damp;
    audioCue(game.audio, 'gear', { out: !ship.damp });
    say(st, ship.damp ? L('ГАСИТЕЛИ ИНЕРЦИИ ВКЛЮЧЕНЫ')
      : L('ГАСИТЕЛИ ИНЕРЦИИ ВЫКЛЮЧЕНЫ — ПОЛЁТ ПО ИНЕРЦИИ'),
      ship.damp ? '#78e08f' : '#ffb454');
  }

  if (input.pressed('KeyG')) {
    const out = toggleGear(ship);
    audioCue(game.audio, 'gear', { out });
    say(st, out ? L('ШАССИ: ВЫПУСК') : L('ШАССИ: УБОРКА'),
      out ? '#78e08f' : null);
  }

  if (input.pressed('KeyL')) {
    if (ship.landing) { stopLanding(ship); say(st, L('ПОСАДОЧНЫЙ КОМПЬЮТЕР ОТКЛЮЧЁН')); }
    else {
      // Цель — либо выбранное навигатором тело, либо то, над которым летим.
      // Город значит то же, что его тело: садятся не «в город», а на
      // грунт под собой, и вывести корабль ИМЕННО НАД городом — работа
      // квантового привода, а не посадочного компьютера (тот снижается
      // отвесно, потому что поверхность за время спуска уезжает).
      const t = currentTarget(game.nav);
      const aim = t && t.isCity ? t.body : t;
      const body = isLandable(aim) ? aim : (game.zone ? game.zone.body : null);
      if (!body) say(st, L('РЯДОМ НЕТ ТЕЛА, НА КОТОРОЕ МОЖНО СЕСТЬ'), '#ff7a66');
      else {
        const res = startLanding(ship, body, ship.pos);
        if (!res.ok) say(st, res.reason, '#ff7a66');
        else say(st, L('ПОСАДОЧНЫЙ КОМПЬЮТЕР: ') + body.name, '#78e08f');
      }
    }
  }

  if (input.pressed('KeyC')) {
    if (ship.docking) { stopDockingComputer(ship); say(st, L('ДОКИНГ-КОМПЬЮТЕР ОТКЛЮЧЁН')); }
    else {
      const t = currentTarget(game.nav);
      const station = t && t.isStation ? t : nearestStation();
      if (!station) say(st, L('СТАНЦИЙ ПОБЛИЗОСТИ НЕТ'), '#ff7a66');
      else {
        const res = startDockingComputer(ship, station);
        if (!res.ok) say(st, res.reason, '#ff7a66');
        else say(st, L('ДОКИНГ-КОМПЬЮТЕР: ') + station.name, '#78e08f');
      }
    }
  }

  // Любое ручное вмешательство отключает автоматику. Привода это не
  // касается: на калибровке ручка как раз и нужна, чтобы навестись, а в
  // прыжке она всё равно ничего не делает.
  if (ship.docking || ship.landing) {
    if (input.isDown('KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight') ||
      input.isDown('KeyR', 'KeyF', 'Space') || input.pressed('KeyX', 'KeyZ', 'KeyT')) {
      if (ship.docking) stopDockingComputer(ship);
      if (ship.landing) stopLanding(ship);
      say(st, L('РУЧНОЕ УПРАВЛЕНИЕ'));
    }
  }
}

function nearestStation() {
  let best = null, bd = Infinity;
  for (const s of world.stations) {
    const d = Math.hypot(s.pos.x - ship.pos.x, s.pos.y - ship.pos.y, s.pos.z - ship.pos.z);
    if (d < bd) { bd = d; best = s; }
  }
  return bd < DOCK_RANGE * 4 ? best : null;
}

// --- шаг физики --------------------------------------------------------------

function step(dt) {
  const st = game.state;
  // Время мира подводится к серверному прямо в ходе, а не рывком: рывок
  // на стыковке увёл бы станцию из-под носа (js/game/clock.js).
  //
  // ШАГ МИРА НЕ РАВЕН ШАГУ КАДРА, и это главное, что здесь надо помнить.
  // Часы подводятся ходом (до четверти быстрее или медленнее), а после
  // спящей вкладки — рывком на десятки секунд. Всё, что должно ехать
  // ВМЕСТЕ С ТЕЛАМИ, обязано ехать на этот шаг, а не на кадровый.
  const dtWorld = clockStep(world.time, worldAim, dt);
  // Куда уедет несущее тело — замеряем, а не считаем по скорости: на
  // рывке в минуту скорость на время даёт хорду вместо дуги, а замер
  // верен при любом шаге и не стоит ничего. Тело берём прошлого кадра:
  // захват пересчитывается ниже, уже по новым положениям.
  const carrier = game.capture;
  if (carrier) {
    _carried.x = carrier.pos.x; _carried.y = carrier.pos.y; _carried.z = carrier.pos.z;
  }
  updateWorld(world, dtWorld);
  if (carrier) {
    _carried.x = carrier.pos.x - _carried.x;
    _carried.y = carrier.pos.y - _carried.y;
    _carried.z = carrier.pos.z - _carried.z;
  }
  // Часы пилота идут в любом режиме: срок задания не останавливается
  // оттого, что корабль стоит в порту.
  updatePlayer(game.player, dt);

  // Свой корабль в другой системе (пилот улетел пассажиром): вести,
  // сажать и стыковать здесь нечего — мир идёт, корабль стоит там.
  if (ship.away) {
    game.zone = null;
    game.capture = null;
    game.entry = null;
    return;
  }
  ship.sysId = sys.id;

  // Болты летят и ищут цель. Попадание находит СТРЕЛЯВШИЙ — у него на
  // экране и болт, и цель в одном времени, — но урон применяет сервер
  // (server/src/Combat.php), и корпус мы узнаём от него.
  const hits = updateGuns(game.guns, dt, combatShips());
  for (const h of hits) {
    if (isOnline()) reportHit(h.id, game.guns.spec.code);
  }
  // Щит показывается СРАЗУ по удару, не дожидаясь ответа сервера: ответ
  // идёт полпинга, а оболочка должна вспыхнуть там же, где болт погас.
  // Числа корпуса и щита потом всё равно придут серверные.
  for (const h of game.guns.impacts) {
    const charged = h.own
      ? ship.shield > 0
      : (game.peers.find((p) => p.id === h.id) || { shield: 0 }).shield > 0;
    if (!charged) continue;
    const hit = h.own ? ship : game.peers.find((p) => p.id === h.id);
    if (hit) shieldFlash(game.guns, h.id, h.own, h, hit.pos, hit.basis);
  }
  if (game.hurt > 0) game.hurt = Math.max(0, game.hurt - dt);

  // Щит отрастает сам — и здесь он отрастает ТОЛЬКО ДЛЯ ВИДА, по тем же
  // числам, по которым его считает сервер (js/game/ship.js -> каталог).
  // Настоящее значение приходит с каждым попаданием, и оно главнее.
  if (ship.shield < SHIP.maxShield) {
    game.sinceHit = (game.sinceHit || 0) + dt;
    if (game.sinceHit > SHIP.shieldDelay) {
      ship.shield = Math.min(SHIP.maxShield, ship.shield + SHIP.shieldRegen * dt);
    }
  }

  // Гравитационный захват: внутри сферы действия тела корабль
  // переносится вместе с ним (см. js/game/gravity.js). Без этого
  // «зависнуть над точкой» нельзя — поверхность уезжает из-под корабля.
  const wasCarrier = carrier;
  game.capture = captureBody(world, ship.pos);
  if (game.capture && st.mode === ST.FLIGHT) {
    // Замеренное смещение годится, только если тело то же самое: сменился
    // захват — считаем по скорости, шаг там всё равно кадровый.
    carryShip(ship, game.capture, dtWorld,
      game.capture === wasCarrier ? _carried : null);
  }

  if (st.mode === ST.DOCKED) {
    // Корабль стоит в порту и едет вместе со станцией.
    const s = ship.dockedAt;
    if (s) { ship.pos.x = s.pos.x; ship.pos.y = s.pos.y; ship.pos.z = s.pos.z; }
    return;
  }
  if (st.mode === ST.LANDED) {
    // Стоим на грунте и вращаемся вместе с телом. Обстановку у
    // поверхности всё равно считаем: по ней рисуется тень корабля, а
    // стоянку видно за экраном посадки.
    updateLandedPose(ship);
    game.zone = landingContext(world, ship);
    return;
  }
  if (st.mode !== ST.FLIGHT) return;

  clearControls(ship);
  game.statusLine = null;
  updateGear(ship, dt);

  // --- варп: в тоннеле не происходит вообще ничего. Ни столкновений, ни
  // тяготения, ни атмосферы — и не потому, что «так проще»: половину
  // тоннеля старой системы уже нет в памяти, а новая ещё собирается, и
  // считать касание не обо что.
  const w = game.warp;
  if (w.phase === 'tunnel') {
    const ev = updateWarp(w, ship, dt);
    game.entry = null;
    game.zone = null;
    game.capture = null;
    if (ev === 'handover') {
      // Вот ради этого момента тоннель и длится полминуты.
      //
      // Корабль ставится к звезде СРАЗУ, а не в конце: с этой секунды он
      // физически уже в новой системе, и его координаты снова что-то
      // значат. Оставь перестановку на выход — и всё, что успеет
      // сохраниться или посчитаться за оставшиеся пятнадцать секунд,
      // будет посчитано для точки, которой нет ни в одной системе.
      // Варп платит топливом по расстоянию между звёздами — так же, как
      // спишет сервер, когда сохранение скажет ему о новой системе
      // (Fuel::arrive). До тех пор это долг: в баке сервера прыжка ещё нет.
      burnWarp(ship, systemDistance(w.from, w.to), isOnline());
      fuelWatch();
      enterSystem(w.to);
      placeAtStar(w, ship, world.star);
      game.nearest = nearestBody(world, ship.pos);
      say(st, L('СИСТЕМА ') + w.to.name.toUpperCase(), '#9fd9ff', 3);
    } else if (ev === 'arrive') {
      finishWarp(w, ship);
      game.warpTarget = null;
      audioReset(game.audio, ship);
      say(st, L('ПРИБЫТИЕ: ') + sys.name.toUpperCase(), '#78e08f', 4);
      save();
    }
    return;
  }

  // --- квантовый прыжок: корабль ведёт привод, и больше в этом шаге не
  // происходит ничего. Ни столкновений, ни атмосферы, ни посадки —
  // коридор проверен заранее, а лететь на 60 000 км/с мимо проверок
  // касания всё равно нельзя: за кадр корабль проходит тысячу километров.
  const q = game.quantum;
  if (q.phase === 'jump' || q.phase === 'brake') {
    const ev = updateQuantum(q, ship, world, dt);
    game.stats.flownKm += ship.speed * dt;
    // Квантовый ход — по пройденному пути, как его меряет и сервер (по
    // снимкам положения, Hub::meter).
    burnQuantum(ship, ship.speed * dt);
    fuelWatch();
    game.entry = null;
    game.zone = null;
    if (ev === 'arrive') {
      say(st, L('ВЫХОД ИЗ ПРЫЖКА'), '#78e08f');
      audioReset(game.audio, ship);
    } else if (ev === 'stopped') {
      say(st, L('ХОД ПОГАШЕН'), '#78e08f');
      audioReset(game.audio, ship);
    }
    return;
  }

  // Обстановка у поверхности считается до управления: от неё зависит и
  // посадочный режим, и команды посадочного компьютера.
  let zone = landingContext(world, ship);

  if (ship.landing) {
    game.statusLine = updateLandingComputer(ship, dt, zone);
    // Под кораблём открытое море: компьютер садиться отказался, и ручки
    // снова у пилота (js/game/landing.js).
    if (ship.landing && ship.landing.abort) {
      say(st, ship.landing.abort, '#ffcc66', 4);
      stopLanding(ship);
    }
  } else if (ship.docking) {
    game.statusLine = updateDockingComputer(ship, dt);
  } else if (!game.walk.on) {
    // Пилот на ногах ручек не держит: органы управления в нуле
    // (clearControls выше), корабль держит тягу и курс сам.
    readControls(ship);
  }

  // Центровка варпа идёт параллельно полёту, как и калибровка квантового:
  // корабль слушается ручек, привод копит готовность, пока нос в допуске.
  if (w.phase === 'align') {
    const ev = updateWarp(w, ship, dt);
    if (ev === 'abort') say(st, w.reason || L('ВАРП ОТМЕНЁН'), '#ff7a66');
    else if (ev === 'engage') say(st, L('ВАРП'), '#9fd9ff', 1.5);
  } else {
    updateWarp(w, ship, dt);                // только затухание вспышки
  }

  // Калибровка идёт параллельно обычному полёту: корабль слушается,
  // привод копит готовность. Событие 'engage' поймает следующий кадр.
  if (q.phase === 'calib') {
    const ev = updateQuantum(q, ship, world, dt);
    if (ev === 'abort') say(st, q.reason || L('ПРЫЖОК ОТМЕНЁН'), '#ff7a66');
    else if (ev === 'engage') say(st, L('ПРЫЖОК'), '#78e08f', 1.2);
  } else {
    updateQuantum(q, ship, world, dt);      // только затухание вспышки
  }

  updateShip(ship, dt, gravityField(game.capture, ship));
  // Топливо — по работе сопел этого шага (ship.dv, js/game/fuel.js).
  burnThrust(ship);
  fuelWatch();
  game.stats.flownKm += ship.speed * dt;

  // Вход в атмосферу: считается по скорости ОТНОСИТЕЛЬНО воздуха.
  game.entry = entryState(world, ship, game.entryBuf);

  // Касание поверхности: посадка или удар.
  zone = landingContext(world, ship);
  game.zone = zone;

  // Столкновения с гладкими телами (светило, газовый гигант) считаются
  // по сфере. У всех остальных есть рельеф, и там работает проверка
  // касания: сферой её не заменить — корабль либо влетал бы в
  // нарисованные горы без последствий, либо разбивался, летя по дну
  // кратера.
  game.nearest = nearestBody(world, ship.pos);
  if (game.nearest.gap <= 0 && (!zone || zone.body !== game.nearest.body)) {
    crash(L('Столкновение с ') + game.nearest.body.name + '.');
    return;
  }

  // Постройки города — такая же преграда, как грунт. Иначе город был бы
  // голограммой: сквозь башню в двести метров корабль проходил бы
  // насквозь, и ни одна из них ничего не значила бы.
  const hitCity = cityCrash(world, ship);
  if (hitCity) { crash(L('Столкновение с постройкой: ') + hitCity.name + '.'); return; }

  if (zone) {
    const touch = checkTouchdown(ship, zone);
    if (touch && touch.result === 'landed') {
      if (touch.damage) {
        ship.hull = Math.max(1, ship.hull - touch.damage);
        tellImpact(touch.impact);
        say(st, L('ПОСАДКА БЕЗ ШАССИ · −') + Math.round(touch.damage) + L('% КОРПУСА'), '#ffcc66', 2);
      } else {
        // Сел на площадку города — об этом говорят отдельно: пилот
        // целился именно в неё, и «посадка выполнена: Lave IV» на
        // размеченном бетоне читалось бы как промах.
        const at = cityPadUnder(world, ship.pos);
        say(st, at
          ? L('ПОСАДКА ВЫПОЛНЕНА: ') + at.city.name + L(', ПЛОЩАДКА ') + at.pad.n
          : L('ПОСАДКА ВЫПОЛНЕНА: ') + zone.body.name, '#78e08f');
      }
      landAt(zone, !!touch.damage);
      return;
    }
    if (touch && touch.result === 'crash') { crash(touch.reason); return; }
    if (touch && touch.result === 'bounce') {
      // Удар, но не смерть: корабль отскакивает, теряет часть корпуса и
      // на время лишается управления. Разрушение теперь наступает не от
      // самого факта касания, а когда корпуса больше нет.
      const hadComputer = !!ship.landing;
      bounceOff(ship, zone);
      audioCue(game.audio, 'hit', { damage: touch.damage });
      ship.hull -= touch.damage;
      tellImpact(touch.impact);
      game.stats.hits = (game.stats.hits || 0) + 1;
      if (ship.hull <= 0) {
        ship.hull = 0;
        crash(touch.reason + L(' Корпус разрушен.'));
        return;
      }
      say(st, L('УДАР · −') + Math.round(touch.damage) + L('% КОРПУСА'),
        touch.damage > 15 ? '#ff7a66' : '#ffcc66', 1.6);
      if (hadComputer) say(st, L('ПОСАДОЧНЫЙ КОМПЬЮТЕР ОТКЛЮЧЁН'), '#ffcc66', 1.6);
    }
  }

  // Станции: стыковка либо удар о корпус.
  for (const s of world.stations) {
    const d = Math.hypot(s.pos.x - ship.pos.x, s.pos.y - ship.pos.y, s.pos.z - ship.pos.z);
    if (d > s.radius * 2.2) continue;
    const res = checkStation(ship, s);
    if (res === 'docked') {
      game.stats.docks++;
      say(st, L('СТЫКОВКА ВЫПОЛНЕНА'), '#78e08f');
      dockAt(s);
      return;
    }
    if (res === 'crash') {
      crash(L('Удар о конструкции станции ') + s.name + '.');
      return;
    }
  }
}

// --- подготовка данных для HUD ----------------------------------------------

function prepareHud() {
  // Список целей пересобирается каждый кадр: маркеры показываются только
  // у того тела, рядом с которым корабль сейчас находится, а чужие
  // корабли появляются и исчезают сами.
  refreshNav(game.nav, world, ship, game.peers);
  const target = currentTarget(game.nav);
  game.info = navInfo(ship, target);
  // На что наведён нос прямо сейчас: приборы подсвечивают это, и то же
  // самое выберет Tab.
  game.aimed = aimedTarget(game.nav, ship);

  // Куда смотрит ствол — считаем КАЖДЫЙ кадр, а не при выстреле: прицел
  // должен показывать упреждение до того, как нажали огонь, иначе по нему
  // нечего проверять.
  game.gunTarget = gunTarget();
  aimDir(game.guns, ship, game.gunTarget, game.guns.aim);

  // Блипы сканера: станции, планеты, луны.
  game.scanBlips.length = 0;
  let nearestDist = Infinity;
  for (const b of world.bodies) {
    if (b.kind === 'star') continue;
    const d = Math.hypot(b.pos.x - ship.pos.x, b.pos.y - ship.pos.y, b.pos.z - ship.pos.z) - b.radius;
    if (d < nearestDist) nearestDist = d;
    game.scanBlips.push({ pos: b.pos, color: b === target ? '#ffcc66' : 'rgba(120,190,240,0.8)' });
  }
  for (const s of world.stations) {
    const d = Math.hypot(s.pos.x - ship.pos.x, s.pos.y - ship.pos.y, s.pos.z - ship.pos.z);
    if (d < nearestDist) nearestDist = d;
    game.scanBlips.push({ pos: s.pos, color: s === target ? '#ffcc66' : '#78e08f' });
  }
  // Наземные города. Своим цветом: на сканере они стоят вплотную к своей
  // планете (город на ней и стоит), и без отдельного цвета отметка
  // читалась бы как утолщение планетной.
  for (const c of world.cities) {
    game.scanBlips.push({ pos: c.pos, color: c === target ? '#ffcc66' : '#e0a83e' });
  }
  // Чужие корабли на сканере. Дальность из-за них НЕ растягиваем: пилот
  // в другом конце системы не должен уводить масштаб кольца, на котором
  // игрок читает подход к станции. Берём СГЛАЖЕННОЕ положение, то же
  // самое, по которому корабль рисуется в кадре: иначе отметка на
  // сканере и квадрат в кадре разъедутся на четверть секунды.
  for (const p of game.peers) {
    game.scanBlips.push({ pos: p.pos, color: PEER, peer: true });
  }
  game.scannerRange = SCANNER_STEPS.find((r) => r > nearestDist * 1.25) || SCANNER_STEPS[SCANNER_STEPS.length - 1];

  // Помощник стыковки — когда станция рядом.
  game.dockAssist = null;
  const st = ship.docking ? ship.docking.station : nearestStation();
  if (st) {
    const d = Math.hypot(st.pos.x - ship.pos.x, st.pos.y - ship.pos.y, st.pos.z - ship.pos.z);
    // Порог был 30 км — за ним помощник висел пустой рамкой с красными
    // «ОСЬ/КРЕН» посреди экрана добрую минуту полёта, и читался как
    // поломка. Шесть километров — это уже подход, а не «станция где-то
    // в той стороне»: с них створ порта виден глазом.
    if (d < 6) game.dockAssist = makeDockAssist(ship, st);
  }

  // Посадочный дисплей — когда близка поверхность, на которую можно сесть.
  game.landInfo = game.zone && isLandable(game.zone.body) &&
    game.zone.alt < LAND.landAlt * 4
    ? landingReadout(ship, game.zone)
    : null;

}

// --- отрисовка ---------------------------------------------------------------

// Осмотр камерой: правая кнопка зажата — крутим взгляд вокруг корабля,
// отпущена — камера сама возвращается за спину.
const LOOK = 0.0042;        // рад на пиксель
const _drag = { x: 0, y: 0 };
const _touchLook = { x: 0, y: 0 };
function updateCamOrbit(dt) {
  // На ногах головой ведёт walkFrame: сдвиг мыши и пальца его.
  if (game.walk.on) return;
  const o = game.camOrbit;
  input.takeDrag(_drag);
  // Осматриваться можно и стоя на грунте: посадка больше не экран
  // поверх игры, а такое же состояние в кадре, как полёт.
  const canLook = game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED;
  // Палец по свободному месту экрана крутит камеру так же, как правая
  // кнопка мыши: отдельного жеста для этого заводить незачем.
  if (Q.touchUi && canLook) {
    touchDrag(game.touch, _touchLook);
    _drag.x += _touchLook.x; _drag.y += _touchLook.y;
  }
  const look = (input.mouse.right || (Q.touchUi && game.touch.look.id !== null)) && canLook;
  // В кабине голова поворачивается на шее, а не облетает корабль:
  // назад — только через плечо (110°), вниз — до приборной доски.
  // Отсюда и разные пределы, а не одно «крутить как угодно».
  const cockpit = game.state.view === 'cockpit';
  const yawMax = cockpit ? 1.92 : Math.PI;
  const pitchMax = cockpit ? 0.95 : 1.2;
  if (look) {
    o.yaw = clamp(o.yaw + _drag.x * LOOK, -yawMax, yawMax);
    o.pitch = clamp(o.pitch + _drag.y * LOOK, -pitchMax, pitchMax);
  } else {
    const k = Math.min(1, dt * 6);
    o.yaw += (0 - o.yaw) * k;
    o.pitch += (0 - o.pitch) * k;
  }
}

// Поле зрения: удар в момент разгона и широкий угол на ходу — и у
// квантового привода, и у форсажа.
//
// Это то, что физически продаёт скорость. Полосы звёзд без него
// выглядят обоями: глаз читает разгон именно по тому, как раздвигается
// картинка по краям. Удар короткий (punch гаснет за полсекунды), а
// широкий угол держится, пока разогнаны.
//
// У форсажа тот же приём в меньшем масштабе: он даёт вдвое к скорости, а
// не в пятьдесят тысяч раз, и +12° против +24° у привода.
const FOV_BASE = 68 * Math.PI / 180;
const FOV_JUMP = 92 * Math.PI / 180;
const FOV_BOOST = 80 * Math.PI / 180;
// Варп шире квантового прыжка: там за стенами тоннеля ещё видна система и
// слишком широкий угол ломал бы её перспективу, а здесь за стенами нет
// ничего — ни одного объекта, чью форму можно было бы исказить.
const FOV_WARP = 104 * Math.PI / 180;
let fovNow = FOV_BASE;

function updateFov(dt) {
  const q = game.quantum;
  const frac = q.phase === 'jump'
    ? Math.min(1, q.speed / (ship.quantumSpeed || 60000)) : 0;
  const jump = FOV_BASE + (FOV_JUMP - FOV_BASE) * Math.min(1, 0.55 * frac + 0.5 * q.punch);

  // Широкий угол держится по НАБРАННОЙ скорости сверх обычного предела,
  // а не по факту нажатия: иначе картинка раздвигалась бы раньше, чем
  // корабль поехал, и рывок читался бы как дефект, а не как разгон.
  const over = clamp(
    (ship.speed - SHIP.maxSpeed) / (SHIP.maxSpeed * (SHIP.boostMax - 1)), 0, 1);
  const boost = FOV_BASE + (FOV_BOOST - FOV_BASE) *
    Math.min(1, 0.8 * over + 0.6 * ship.boostPunch);

  // Варп: рывок на входе и на выходе. Поле зрения раздвигается сильнее,
  // чем в квантовом прыжке, и держится всю дорогу — в тоннеле смотреть
  // всё равно не на что, зато стены разлетаются заметно шире.
  const w = game.warp;
  const wf = w.phase === 'tunnel' ? Math.min(1, 0.55 + 0.45 * w.power) : 0;
  const warp = FOV_BASE + (FOV_WARP - FOV_BASE) * Math.min(1, wf + 0.55 * w.punch);

  // Не сумма, а что сильнее: в прыжке форсаж всё равно недоступен, и
  // складывать их значит получить угол, которого не задумывал никто.
  const want = Math.max(jump, boost, warp);
  // Вверх поле зрения идёт резче, чем возвращается: рывок — событие, а
  // возврат — послевкусие.
  fovNow += (want - fovNow) * Math.min(1, dt * (want > fovNow ? 10 : 5));
  if (Math.abs(fovNow - camera.fov) > 1e-5) camera.setFov(fovNow);
}

// Нарисованный грунт для камеры (см. placeChase).
const drawnGround = (body, dir) => scene.drawnGround(body, dir);

function setupCamera() {
  const cam = camera;
  cam.basis.right = { ...ship.basis.right };
  cam.basis.up = { ...ship.basis.up };
  cam.basis.fwd = { ...ship.basis.fwd };
  if (game.walk.on && game.walk.out && game.interior) {
    // За бортом: глаз и взгляд — в осях грунта (js/game/outside.js).
    const w = game.walk, G = w.out;
    const e = walkerEye(w, game.interior, _eyeM);
    groundToWorld(G, e, cam.pos);
    walkerLook(w, _wLook);
    groundDirToWorld(G, _wLook.fwd, _camDir);
    groundDirToWorld(G, _wLook.up, _camUp);
    lookAlong(cam.basis, _camDir, _camUp);
    return;
  }
  if (game.walk.on && game.walkEye) {
    // Глаз идущего: точка в осях корабля, взгляд — его голова. Корабль —
    // тот, по палубе которого он идёт: свой или чужой.
    const V = aboardVessel();
    const b = V.basis, e = game.walkEye;
    cam.pos.x = V.pos.x + (b.right.x * e[0] + b.up.x * e[1] + b.fwd.x * e[2]) / 1000;
    cam.pos.y = V.pos.y + (b.right.y * e[0] + b.up.y * e[1] + b.fwd.y * e[2]) / 1000;
    cam.pos.z = V.pos.z + (b.right.z * e[0] + b.up.z * e[1] + b.fwd.z * e[2]) / 1000;
    cam.basis.right = { ...b.right };
    cam.basis.up = { ...b.up };
    cam.basis.fwd = { ...b.fwd };
    walkerLook(game.walk, _wLook);
    const f = _wLook.fwd, u = _wLook.up;
    _camDir.x = b.right.x * f[0] + b.up.x * f[1] + b.fwd.x * f[2];
    _camDir.y = b.right.y * f[0] + b.up.y * f[1] + b.fwd.y * f[2];
    _camDir.z = b.right.z * f[0] + b.up.z * f[1] + b.fwd.z * f[2];
    _camUp.x = b.right.x * u[0] + b.up.x * u[1] + b.fwd.x * u[2];
    _camUp.y = b.right.y * u[0] + b.up.y * u[1] + b.fwd.y * u[2];
    _camUp.z = b.right.z * u[0] + b.up.z * u[1] + b.fwd.z * u[2];
    lookAlong(cam.basis, _camDir, _camUp);
    return;
  }
  if (game.state.view === 'chase') {
    // Где стоит камера и куда смотрит — js/game/chase.js. Грунт ей
    // отдаётся ТАКИМ, КАК ОН НАРИСОВАН: сетка у земли бывает выше
    // настоящего рельефа, и камера, поставленная по настоящему,
    // оказалась бы под картинкой.
    placeChase(game.chase, game, cam, scene ? drawnGround : null);
  } else {
    // Кокпит: глаз пилота — в РУБКЕ, под фонарём корабля
    // (js/models/hulldetail.js, BRIDGE). Раньше он стоял в двенадцати
    // метрах перед центром и в шести над ним — в девяти метрах над носом,
    // снаружи корпуса, — и своего носа из кабины не было видно. В этой же
    // точке начало координат кабины (js/models/cockpit.js).
    const b = ship.basis;
    // Глаз — у поста текущего корпуса: в кокпите «Челленджера» или в
    // кресле командира на мостике «Прометея» (js/models/hulls.js, podOf).
    // Без поста (Canvas 2D) — глаз корпуса (js/game/hull.js).
    const pe = game.cockpit ? game.cockpit.eye : (HULL.canopy ? EYE : null);
    const ex = pe ? pe.x / 1000 : HULL.eye.x;
    const ey = pe ? pe.y / 1000 : HULL.eye.y;
    const ez = pe ? pe.z / 1000 : HULL.eye.z;
    cam.pos.x = ship.pos.x + b.right.x * ex + b.up.x * ey + b.fwd.x * ez;
    cam.pos.y = ship.pos.y + b.right.y * ex + b.up.y * ey + b.fwd.y * ez;
    cam.pos.z = ship.pos.z + b.right.z * ex + b.up.z * ey + b.fwd.z * ez;
    // Голова на шее: взгляд отворачивается от носа, а САМ ГЛАЗ остаётся
    // на месте. Поэтому кабина вокруг не съезжает, а поворачивается —
    // ровно то, ради чего она и нарисована геометрией.
    const o = game.camOrbit;
    if (o.yaw || o.pitch) {
      rotAround(b.fwd, b.up, o.yaw, _camDir);
      rotAround(_camDir, rotAround(b.right, b.up, o.yaw, _camRight), o.pitch, _camDir);
      lookAlong(cam.basis, _camDir, b.up);
    }
  }
}

// Canvas-2D-путь: используется, когда WebGL2 недоступен или запрошен
// `?renderer=2d`. Планеты здесь рисуются аналитически (js/render/planetview.js).
function render2d() {
  renderer.begin();
  starfield.draw(renderer);

  const sunPos = world.star.pos;
  for (const b of world.bodies) drawBody(renderer, b, sunPos);

  for (const s of world.stations) {
    const d = Math.hypot(s.pos.x - camera.pos.x, s.pos.y - camera.pos.y, s.pos.z - camera.pos.z);
    if (d > 4000) continue;   // дальше станция всё равно меньше пикселя
    normalize(v3(sunPos.x - s.pos.x, sunPos.y - s.pos.y, sunPos.z - s.pos.z), _sun);
    renderer.drawMesh(stationMesh(s.type), s.pos, s.basis, 1, _sun, { outline: d < 30 });
  }

  if (game.state.view === 'chase' && game.state.mode !== ST.DOCKED) {
    normalize(v3(sunPos.x - ship.pos.x, sunPos.y - ship.pos.y, sunPos.z - ship.pos.z), _sun);
    renderer.drawMesh(shipMesh, ship.pos, ship.basis, 1, _sun, {});
    // Стойки шасси — каждая от своей точки крепления.
    if (ship.gear.t > 0.01) {
      const b = ship.basis;
      gearMesh.hardpoints.forEach((hp, i) => {
        const drop = ship.gear.drop ? ship.gear.drop[i] : 0;
        for (const part of gearMesh.legs[i].parts) {
          const y = hp.y + stageLift(gearMesh.legs[i], gearMesh.legLengths[i], drop, ship.gear.t, part.k);
          _tmp.x = ship.pos.x + b.right.x * hp.x + b.up.x * y + b.fwd.x * hp.z;
          _tmp.y = ship.pos.y + b.right.y * hp.x + b.up.y * y + b.fwd.y * hp.z;
          _tmp.z = ship.pos.z + b.right.z * hp.x + b.up.z * y + b.fwd.z * hp.z;
          renderer.drawMesh(part.mesh, _tmp, b, 1, _sun, {});
        }
      });
    }
    if (ship.throttle > 0.03) {
      for (const e of shipMesh.exhausts) {
        dirToWorld(ship.basis, e, _tmp);
        _tmp.x += ship.pos.x; _tmp.y += ship.pos.y; _tmp.z += ship.pos.z;
        renderer.drawGlow(_tmp, 6 + 22 * ship.throttle, 'rgb(255,150,60)');
      }
    }
  }

  // Плазма входа: на запасном пути без шейдеров — ореолы по потоку.
  // Форму ударной волны так не показать, но «горим» видно, и видно с
  // любого вида: из кокпита зарево впереди как раз и есть главное.
  const en = game.entry;
  if (en) {
    const hullLen = shipMesh.length || 0.065;
    const c = en.color.map((v) => Math.round(Math.min(1, v) * 255));
    for (const [ahead, k] of [[0.75, 1], [0.1, 0.7], [-0.9, 0.45]]) {
      _tmp.x = ship.pos.x + en.dir.x * hullLen * ahead;
      _tmp.y = ship.pos.y + en.dir.y * hullLen * ahead;
      _tmp.z = ship.pos.z + en.dir.z * hullLen * ahead;
      renderer.drawGlow(_tmp, (14 + 70 * en.heat) * k, `rgb(${c[0]},${c[1]},${c[2]})`);
    }
  }

  renderer.end();
}

// Курсор виден на карте и в меню пилота (см. css/style.css) — там, где
// мышью выбирают. Переключаем по изменению, а не каждый кадр: трогать DOM
// в кадре незачем. Вид курсора разный: на карте это прицел (наводятся на
// тело), в меню — обычная стрелка (жмут на закладку).
let cursorClass = '';

function render() {
  setupCamera();

  // План палубы — мышью, как меню: стрелка (js/ui/deckmap.js).
  const wantCursor = game.menu.open || game.deckMap.open ? 'menu' : game.state.mode === ST.MAP ? 'map' : '';
  if (wantCursor !== cursorClass) {
    screenCanvas.classList.remove('map', 'menu');
    if (wantCursor) screenCanvas.classList.add(wantCursor);
    cursorClass = wantCursor;
  }

  if (scene) scene.render(game);
  else render2d();

  const st = game.renderStats;
  st.polys = scene ? scene.tris : renderer.polys;
  st.items = scene ? scene.draws : renderer.items.length;
  st.gpu = scene ? scene.name : null;
  // Цена кадра: его длительность, чистое время карты (если драйвер
  // отдаёт таймер) и множитель детализации, выбранный по ним
  // регулятором (js/gl/detail.js).
  st.frameMs = scene ? scene.frameMs : 0;
  st.gpuMs = scene && scene.gpuTimer && scene.gpuTimer.available ? scene.gpuTimer.ms : 0;
  st.fw = scene ? scene.fwScale : 1;
  st.pending = scene ? scene.pending || 0 : 0;
  st.detail = scene ? !!scene.detailOn : false;
  st.patches = scene && scene.patch ? scene.patch.levels : 0;
  st.patchBuilds = scene && scene.patch ? scene.patch.rebuilds : 0;
  // Состояние кэша плиток: по нему в отладке видно и загрузку рельефа,
  // и то, в потоках ли она считается.
  st.tiles = scene && scene.tiles && scene.tiles.body ? scene.tiles.stats : null;
  // Камни и пыль — по ним видно, работает ли то, чем меряется высота.
  st.rocks = scene && scene.rocks
    ? { count: scene.rocks.count, builds: scene.rocks.builds, drawn: scene.rockDraws || 0 }
    : null;
  // Растительность — по тем же причинам, что и город: «деревьев не
  // видно» бывает и «поле не собрано», и «собрано, но не нарисовано», и
  // «нарисовано, да не выросло здесь ничего». По картинке они
  // неразличимы (js/gl/flora.js).
  st.flora = scene && scene.flora
    ? {
      count: scene.flora.count,
      builds: scene.flora.builds,
      drawn: scene.floraDraws || 0,
      faces: scene.flora.mesh ? (scene.flora.mesh.faces || 0) : 0,
      // Ячейка грунта, на которую уложено поле, и та, которой грунт
      // рисуется сейчас: разошлись — значит растения под землёй.
      cell: scene.flora.cell,
      want: scene.floraCell || 0,
      // Гнёт ли их сейчас струя движков (js/gl/wash.js): «деревья не
      // шевелятся» — это и «струи нет», и «струя не того тела».
      wash: scene.washOn ? 1 : 0,
    }
    : null;
  // Дальний лес (js/gl/forest.js): сколько кусков нужно, сколько готово и
  // в работе, сколько силуэтов нарисовано и до какого расстояния.
  st.forest = scene && scene.forest
    ? {
      want: scene.forest.want.length,
      ready: scene.forest.chunks.size,
      busy: scene.forest.inFlight.size,
      drawn: scene.forestDraws || 0,
      trees: scene.forestTrees || 0,
      km: +(scene.forest.rGround || 0).toFixed(1),
    }
    : null;
  // Кабина (js/gl/cabin.js): собралась ли, сколько вызовов, сколько
  // экранов перерисовано и залито в атлас, есть ли тень и солнце в ней.
  st.cabin = scene
    ? {
      error: scene.cabinError || null,
      draws: scene.cabinDraws || 0,
      screens: game.displays ? game.displays.draws : 0,
      uploads: scene.cabin ? scene.cabin.uploads : 0,
      shadow: scene.cabin ? scene.cabin.shadowPasses : 0,
      sun: scene.cabin ? +scene.cabin.sunVis.toFixed(2) : 0,
      paint: !!(scene.cabin && scene.cabin.paintReady),
    }
    : null;
  st.dust = game.dust ? game.dust.list.length : 0;
  // Наземный город: собран ли он и рисуется ли. Собирается он порциями и
  // сто тысяч граней, поэтому «города не видно» имеет две разные причины
  // — ещё не собран или уже не рисуется, — и различить их иначе нечем.
  st.city = scene && scene.city && (scene.city.mesh || scene.city.job)
    ? {
      built: scene.city.mesh ? (scene.city.mesh.faces || 0) : 0,
      drawn: scene.cityDraws || 0,
      km: scene.cityNear || 0,
    }
    : null;

  // Приборы — отдельным прозрачным слоем, одинаково для обоих рендеров.
  hud.begin();
  if (game.state.mode === ST.MAP) drawMap(hud, game);
  else if (game.walk.on && game.state.mode !== ST.HELP) {
    drawWalkHud(hud, game, walkHints());
    if (game.deckMap.open && game.interior) drawDeckMap(hud.ctx, hud.camera.w, hud.camera.h, game, game.interior);
  }
  else if (game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED) drawHud(hud, game);
  // Кто ещё в игре и где — поверх приборов и карты, но не в порту и не в
  // справке: там свои экраны целиком.
  if (game.state.mode === ST.MAP || game.state.mode === ST.FLIGHT
      || game.state.mode === ST.LANDED) {
    drawPilots(hud, game);
  }
  // Меню рисуется ПОВЕРХ приборов, а не вместо них: кадр под ним живой.
  if (game.menu.open) drawMenu(hud, game);
  // Сенсорные органы поверх приборов, но только в полёте и на грунте:
  // в меню и на карте они мешают, а делать нечего.
  if (Q.touchUi && !game.menu.open
      && (game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED
        || (game.walk.on && game.state.mode === ST.DOCKED))) {
    touchDraw(hud.ctx, game.touch, touchArea, game);
  }
  if (game.fsButton) drawFullscreenButton(hud.ctx, game.fsButton, isFull());
  drawDebug(hud, game, dbg);
}

// --- цикл --------------------------------------------------------------------

// Режим связи с прошлого кадра: по смене показываем сообщение.
let netMode = 'none';
// Снимки чужих кораблей и номер последнего принятого: сглаживание считает
// временем снимка время его прихода, и принять один список дважды значит
// сказать, что корабль полтика простоял (js/game/peers.js).
const peerStore = makePeers();
const peopleStore = makePeople();
let peerRev = -1;
// Последний снимок корабля, на борту которого едем: если снимки пропали
// (связь, сервер), корабль остаётся под ногами там, где был, — а не
// исчезает, роняя пассажира в пустоту.
let aboardPin = null;
// Часы мира. Пока сервера нет, цель null и время идёт как шло — в
// одиночной игре подводить его не по чему и незачем.
const worldClock = makeClock();
let worldAim = null;
let last = performance.now();
let acc = 0;
let saveTimer = 0;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;      // после переключения таба не «телепортируемся»
  tickDebug(dbg, dt);

  // Касания разбираются ДО управления: джойстик и кнопки должны попасть
  // в тот же кадр, что и клавиши, иначе палец отстаёт от клавиатуры на
  // кадр (на 60 Гц это заметно на посадке).
  // Управление кораблём глохнет, пока открыто меню: нажатия (pressed)
  // читаются всегда — ими меню и живёт, — а вот удержания (isDown) и
  // сенсорные оси гасятся этим флагом.
  input.enabled = !game.menu.open;
  if (Q.touchUi && !game.menu.open) {
    // Буксир предлагается на резерве и с пустым баком — там, где прыжков
    // уже нет (js/ui/touch.js, кнопка 'tow').
    const fl = fuelLevel(ship);
    game.touch.tow = !ship.dockedAt && (fl === 'reserve' || fl === 'dry');
    // На ногах — свой набор: идти, бежать, прыгать, сесть у кресла.
    game.touch.walk = game.walk.on;
    game.touch.seat = !!(game.interior && nearSeat(game.walk, game.interior));
    game.touch.stand = !!game.interior && !game.walk.on;
    game.touch.hatch = !!game.walkHatch;
    touchUpdate(game.touch, [...touchPoints.values()], touchArea);
    touchApply(game.touch, ship);
  }

  handleKeys(dt);
  if (game.walk.on) walkFrame(dt);
  else if (game.interior) {
    // В кресле — а по палубе ходят пассажиры: двери перед ними те же.
    othersAboard(ownVessel, game.walk.others || (game.walk.others = []));
    if (game.walk.others.length) stepDoors(game.walk, game.interior, dt);
  }
  // Корабль кадра — в чьих помещениях глаз — и его тело: свет снаружи
  // для кабины (js/gl/cabin.js). У чужого корабля тело из снимка, у своего
  // — обстановка у поверхности.
  game.frame = aboardVessel();
  game.frameBody = game.frame.own ? undefined : vesselBody(game.frame);
  airFrame(dt);

  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 6) {
    step(STEP);
    acc -= STEP;
    steps++;
  }
  if (acc > STEP) acc = 0;

  // Чужие корабли: снимок принимаем только НОВЫЙ, а положение считаем
  // каждый кадр — между снимками картинка идёт сама. Делается это вне
  // prepareHud намеренно: тот работает только в полёте, а чужие корабли
  // никуда не деваются и когда мы пристыкованы.
  {
    const tNow = now / 1000;
    // Корабль, на борту которого едем: его не выбрасывает ни уход его
    // хозяина в прыжок, ни пропавшие снимки.
    const w = game.walk;
    const ride = w.on && !w.out && w.vessel && !w.vessel.own ? w.vessel.id : null;
    for (const L of net.left) {
      if (L.ship !== null && L.ship !== ride) dropPeer(peerStore, L.ship);
      if (L.id !== null) dropPerson(peopleStore, L.id);
    }
    net.left.length = 0;
    if (net.rev !== peerRev) {
      peerRev = net.rev;
      // Свой корабль, которым командуем, приходит и без водителя (пока
      // игра его не повела), — он не чужой, и рисовать его дважды нельзя.
      ingestPeers(peerStore, ship.id === null ? net.peers : net.peers.filter((p) => p.id !== ship.id), tNow);
      ingestPeople(peopleStore, net.people, tNow);
      if (ride !== null) {
        const e = net.peers.find((p) => p.id === ride);
        if (e) aboardPin = e;
      }
      clockFromServer(worldClock, net.wt, tNow);
    }
    if (ride !== null && !peerStore.by.has(ride) && aboardPin && aboardPin.id === ride) {
      ingestPeers(peerStore, [aboardPin], tNow);
    }
    game.peers = peerPoses(peerStore, tNow, game.peers, world);
    for (const V of game.peers) {
      vesselAir(V);
      // Шасси чужого корабля выходит с той же скоростью, что у своего;
      // корабль без водителя стоит на стойках сразу.
      if (V.dorm || V._seen === undefined) V.gear.t = V.gear.out ? 1 : 0;
      else updateGear(V, dt);
      V._seen = true;
    }
    followVessel();
    // Хозяин корабля, на палубе которого стоим, вышел из игры: у всех
    // корабль пропал, а у нас стоит, где был (aboardPin), пока сервер
    // ждёт хозяина (Hub::GRACE). Сказать один раз — иначе полминуты
    // неподвижного корабля без единого слова выглядят как зависание.
    const host = ride !== null && w.vessel ? w.vessel.by : null;
    const hostGone = host !== null && net.state === 'live' && !net.roster.some((r) => r.id === host);
    if (hostGone && !game.hostGone) say(game.state, L('ХОЗЯИН КОРАБЛЯ ВЫШЕЛ ИЗ ИГРЫ · ЖДЁМ ЕГО'), '#ffcc66', 6);
    game.hostGone = hostGone;
    // Корабль, на котором едем, мог исчезнуть из мира (его тела здесь
    // нет, а за ним ещё не перешли) — палуба остаётся та же запись.
    if (ride !== null && w.vessel && !game.peers.includes(w.vessel)) {
      const again = game.peers.find((p) => p.id === ride);
      if (again) boardVessel(again);
    }
    game.people = peoplePoses(peopleStore, tNow, game.people, strideAt);
    placePeople();

    // Цель-пилот могла уйти из системы или закрыть игру. Привод обязан
    // это заметить: иначе прыжок идёт к призраку — к последнему месту,
    // где его видели, и выход происходит в пустоту.
    const qt = game.quantum.target;
    if (qt && qt.isPeer && !game.peers.includes(qt)) {
      if (game.quantum.phase === 'jump') abortQuantum(game.quantum, ship);
      else stopQuantum(game.quantum);
      say(game.state, L('ЦЕЛЬ ПРОПАЛА С ЛОКАТОРА · ПРЫЖОК СОРВАН'), '#ff7a66', 5);
    }
    worldAim = clockTarget(worldClock, tNow);
    // Качество связи считается здесь же, а не в приборах: приборов два
    // (угловые панели и экраны кабины), и считать одно и то же дважды
    // значит рано или поздно показать в них разное.
    game.link = linkState(net, tNow, session.mode);
    game.now = tNow;
    // События боя разбираем здесь же: выстрелы чужих, наш урон и доклады
    // сервера о наших попаданиях.
    if (net.events.length) {
      for (const ev of net.events) applyNetEvent(ev);
      net.events.length = 0;
    }
  }

  // Связь пропала или вернулась — игрок обязан это увидеть, а не
  // догадываться по тому, что счёт перестал меняться.
  if (session.mode !== netMode) {
    if (netMode === 'online' && session.mode === 'offline') {
      say(game.state, L('СВЯЗЬ С СЕРВЕРОМ ПОТЕРЯНА · АВТОНОМНО'), '#ffcc66', 5);
    } else if (netMode === 'offline' && session.mode === 'online') {
      say(game.state, L('СВЯЗЬ ВОССТАНОВЛЕНА'), '#78e08f', 3);
    } else if (session.mode === 'none' && netMode !== 'none') {
      // Связи нет — города остаются те, что собрал клиент. Спорить не с
      // кем, а мир без них был бы беднее того, в котором игрок только
      // что летал.
      say(game.state, L('ВХОД ПРОСРОЧЕН · СОХРАНЕНИЕ ТОЛЬКО МЕСТНОЕ'), '#ff7a66', 6);
    }
    const wasMode = netMode;
    netMode = session.mode;
    // Связь появилась уже после входа в систему (обычный случай:
    // система собирается раньше, чем проходит вход) — спрашиваем города
    // сейчас.
    if (netMode === 'online' && wasMode !== 'online') syncCities(sys, world);
  }

  updateMessages(game.state, dt);
  if (game.restartArmed > 0) game.restartArmed = Math.max(0, game.restartArmed - dt);
  if (game.rescueArmed > 0) game.rescueArmed = Math.max(0, game.rescueArmed - dt);
  updateCamOrbit(dt);
  // Пыль идёт по времени игрока, как и звук: это картинка, а не физика
  // корабля, и от шага интегрирования зависеть не должна.
  updateDust(game.dust, game, dt);
  // Поток за бортом — тоже картинка, и по той же причине идёт по
  // времени игрока: фаза копится в js/game/flow.js, рендер её читает.
  updateFlow(game.flow, game, dt);
  // Ручка и РУД ходят за органами управления по времени игрока: это
  // рука пилота, а не состояние корабля, и от шага физики зависеть не
  // должна.
  updateYoke(game.yoke, ship.control, dt, ship.throttle);
  // Камера садится на место мгновенно, когда корабль не летит: на
  // стоянке и в порту запаздывание было бы про то, как открылся экран.
  updateChase(game.chase, game, dt, game.state.mode !== ST.FLIGHT);
  updateFov(dt);
  // Звук идёт по времени игрока, а не по шагам физики: круизный
  // ускоритель множит перемещение, но не частоту кадров, и гул движков
  // от него меняться не должен.
  updateAudio(game.audio, game, dt);
  playAudio(game.audio, sound);
  if ((game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED) && !ship.away) prepareHud();
  // Софт мониторов — после приборов (он читает то же, что они), и только
  // когда кабина в кадре: рисовать восемь холстов для вида снаружи незачем.
  if (game.displays && game.state.view === 'cockpit' && !game.walk.out && aboardVessel().own && !ship.away
      && (game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED || game.walk.on)) {
    updateDisplays(game.displays, game, now / 1000);
  }

  render();
  input.endFrame();

  saveTimer += dt;
  // В тоннеле не сохраняемся вовсе. Между системами у корабля нет
  // осмысленного места: до смены он в старой системе на миллионе
  // километров от всего, после — уже у чужой звезды. Перезагрузка посреди
  // прыжка должна возвращать туда, откуда прыгали, а это последний сейв
  // ДО него.
  if (saveTimer > 5 && game.warp.phase !== 'tunnel') { saveTimer = 0; save(); }

  requestAnimationFrame(frame);
}

// --- запуск ------------------------------------------------------------------

// Быстрый тест стыковки: ?dev=1 ставит корабль в 20 км от порта станции,
// носом к створу.
function devSpawn() {
  const st = world.home.station;
  const b = makeBasis();
  b.fwd = { x: -st.basis.fwd.x, y: -st.basis.fwd.y, z: -st.basis.fwd.z };
  b.right = { ...st.basis.right };
  b.up = normalize(v3(
    b.fwd.y * b.right.z - b.fwd.z * b.right.y,
    b.fwd.z * b.right.x - b.fwd.x * b.right.z,
    b.fwd.x * b.right.y - b.fwd.y * b.right.x));
  placeShip(ship, v3(
    st.pos.x + st.basis.fwd.x * 20,
    st.pos.y + st.basis.fwd.y * 20,
    st.pos.z + st.basis.fwd.z * 20), b);
  ship.dockedAt = null;
  game.lastStation = st;
  game.state.mode = ST.FLIGHT;
  selectTarget(st);
}

// Активные касания: их держит браузер, но не отдаёт списком — только
// событиями. Собираем сами, в точках CSS, и разбираем раз в кадр
// (js/ui/touch.js): касание — это состояние, а не событие.
const touchPoints = new Map();
let touchArea = null;

/**
 * Вырезы экрана. У iPhone в горизонте остров съедает полосу с одной
 * стороны, а снизу идёт полоса жеста «домой»: органы под ними просто не
 * нажимаются. Размеры отдаёт сам браузер через env(safe-area-inset-*),
 * поэтому читаем их с невидимой распорки в разметке, а не угадываем.
 */
function safeInsets() {
  const el = document.getElementById('safe');
  if (!el || typeof getComputedStyle !== 'function') return { left: 0, right: 0, top: 0, bottom: 0 };
  const cs = getComputedStyle(el);
  const px = (v) => Math.max(0, Math.round(parseFloat(v) || 0));
  return {
    left: px(cs.paddingLeft), right: px(cs.paddingRight),
    top: px(cs.paddingTop), bottom: px(cs.paddingBottom),
  };
}

function relayoutTouch() {
  const w = window.innerWidth, h = window.innerHeight;
  touchArea = touchLayout(w, h, safeInsets());
  game.fsButton = fullscreenAvailable() ? fullscreenButton(w, safeInsets()) : null;
}

/**
 * Касания: только те, что по ХОЛСТУ.
 *
 * Стартовый экран, порт, карта, помощь и кнопки в них — это обычная
 * разметка поверх холста, и касание по ней принадлежит браузеру, а не
 * игре. Он обязан превратить его в нажатие кнопки.
 *
 * Раньше слушатель висел на окне и гасил preventDefault'ом ВСЁ подряд.
 * На телефоне это означало, что «ВЗЛЁТ» не нажимается вовсе: отменённое
 * касание не порождает клика, обработчик кнопки не зовётся, и панель
 * остаётся висеть. Со звуком выходило особенно обидно — он просыпается
 * от любого касания, поэтому корабль было слышно, а играть нельзя.
 *
 * Правило поэтому такое: касание, начавшееся на холсте, ведём до конца
 * (палец может уехать куда угодно — важно, где он лёг); касание,
 * начавшееся на разметке, не трогаем вовсе.
 */
function attachTouch(target = window) {
  const onCanvas = (el) => el === hudCanvas || el === screenCanvas;
  const take = (e) => {
    const start = e.type === 'touchstart';
    let mine = false;
    for (const t of e.changedTouches || []) {
      if (start) {
        // Новый палец берём, только если он лёг на холст.
        if (!onCanvas(e.target)) continue;
        touchPoints.set(t.identifier, { id: t.identifier, x: t.clientX, y: t.clientY });
        mine = true;
        continue;
      }
      if (!touchPoints.has(t.identifier)) continue;   // не наш палец
      mine = true;
      if (e.type === 'touchend' || e.type === 'touchcancel') {
        touchPoints.delete(t.identifier);
      } else {
        touchPoints.set(t.identifier, { id: t.identifier, x: t.clientX, y: t.clientY });
      }
    }
    // Прокрутка, зум двумя пальцами и «потяни, чтобы обновить» на
    // странице, которая целиком занята игрой, — только помеха. Но гасим
    // их лишь для СВОИХ касаний: чужие нужны браузеру, чтобы нажать
    // кнопку.
    if (mine && e.cancelable) e.preventDefault();
  };
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    target.addEventListener(type, take, { passive: false });
  }
}

function resizeAll() {
  hud.resize();
  relayoutTouch();
  if (renderer) renderer.resize();
  if (scene) scene.resize();
}

async function boot() {
  // Язык — первым делом: он нужен уже стартовому экрану, а дальше его
  // спрашивают приборы на каждом кадре.
  initLang();
  input.attach(window);
  input.attachMouse(window);
  attachTouch(window);
  // Полный экран включается только из обработчика нажатия — так требует
  // браузер. Поэтому кнопка слушает настоящий клик, а не разбирается в
  // кадре вместе с остальным вводом.
  window.addEventListener('click', (e) => {
    const b = game.fsButton;
    if (!b) return;
    if (Math.hypot(e.clientX - b.x, e.clientY - b.y) <= b.r + 6) toggleFullscreen();
  });

  // Файлы качаем сразу — сеть жеста не требует. А вот звуковой контекст
  // до жеста создавать нельзя: браузер поднимет его в состоянии
  // suspended, и игра проиграет весь полёт в тишину. Поэтому контекст
  // ждёт первого щелчка или нажатия клавиши, какими бы они ни были.
  sound.prefetch();
  const wake = () => { if (sound.start()) sound.adopt(); };
  window.addEventListener('keydown', wake);
  window.addEventListener('mousedown', wake);
  window.addEventListener('touchstart', wake);
  resizeAll();
  window.addEventListener('resize', resizeAll);
  // При закрытии вкладки fetch браузер обрывает, поэтому последнее
  // сохранение уходит маячком (sendBeacon) — см. js/net/api.js.
  window.addEventListener('beforeunload', () => {
    save();
    flushOnExit(savePayload());
  });

  ship.mesh = shipMesh;

  const dev = devMode();
  // Автономный режим: игра без сервера, на одном localStorage. Нужен и
  // для разработки, и как честный ответ на «сервер не поднят». Правило
  // лежит в js/core/mode.js — по нему же загрузчик решает, идти ли за
  // характеристиками на сервер, и разойтись им нельзя.
  const solo = soloMode();

  // Вход спрашивается ДО всего: состояние с сервера главнее местного, и
  // применять сначала кэш, а потом поверх серверное — значит на секунду
  // показать игроку чужое положение корабля.
  let restored = false;
  // Ответ на сохранение несёт то, сколько сервер списал за варп: этим
  // гасится долг, который игра записала себе у звезды (js/game/fuel.js).
  session.onSaved = (r) => { if (r && r.warpFuel > 0) warpSettled(ship, r.warpFuel); };
  if (!solo) {
    const mode = await sessionStart();
    if (mode === 'none') {
      // Входа нет — играть нечем: без него сервер не отдаст ни корабля,
      // ни денег. Уходим на страницу входа, не запуская игру.
      location.replace('login.html');
      return;
    }
    if (mode === 'online') {
      clockFromServer(worldClock, session.player.world ? session.player.world.time : null,
        performance.now() / 1000);
      worldAim = clockTarget(worldClock, performance.now() / 1000);
      restored = applyState(serverToSave(session.player));
      applyServer(game.player, session.player);
      // Местный кэш сразу приводим к серверному состоянию: если в
      // следующий раз сети не будет, игра поднимется отсюда.
      save();
      // Сокет поднимаем только при живом сервере: без входа он всё равно
      // не пустит, а стучаться в закрытый порт незачем.
      netConnect(() => ({
        // Система, где САМ пилот.
        sys: sys.id,
        // Корабль, который игра ведёт: свой и только если он здесь. Пассажир
        // чужого корабля, оставивший свой в другой системе, не ведёт ничего.
        ship: ship.away || ship.id === null ? null : {
          id: ship.id,
          x: ship.pos.x, y: ship.pos.y, z: ship.pos.z,
          v: ship.speed,
          // Осанка корабля, а не только след: без неё чужой корабль нечем
          // развернуть, и на месте он смотрел бы в никуда.
          fwd: ship.basis.fwd, up: ship.basis.up,
          // Работа сопел — измерение, из которого топливо считает сервер, и
          // то, сколько игра уже списала сама: по нему сверяется ответ.
          work: ship.work, burned: ship.burned,
          mode: game.state.mode === ST.DOCKED ? 'docked'
            : game.state.mode === ST.LANDED ? 'landed'
              : game.warp.phase === 'tunnel' ? 'warp' : 'flight',
          gear: ship.gear.out || ship.gear.t > 0.5,
          hatches: ship.hatchesWant || openHatches(ownAir()),
          lift: Math.abs(ship.lift || 0),
          local: shipLocal(),
        },
        // Сам пилот: в кресле, на палубе, на грунте (js/game/peers.js).
        me: meNet(),
      }));
    } else {
      // Вход есть, а связи нет. Играем с местного кэша и продолжаем
      // попытки — накопленное уйдёт, как только сервер ответит.
      restored = load();
      say(game.state, L('СЕРВЕР НЕ ОТВЕЧАЕТ · АВТОНОМНЫЙ РЕЖИМ'), '#ffcc66', 6);
    }
  } else if (!dev) {
    restored = load();
  }
  if (dev) devSpawn();
  else if (!restored) {
    const home = world.home.station;
    ship.dockedAt = home;
    game.lastStation = home;
    game.state.mode = ST.DOCKED;
    // Целью по умолчанию ставим другую станцию: цель «там, откуда вылетел»
    // бесполезна, а так первый же J даёт осмысленный перелёт.
    const away = world.stations.find((s) => s !== home);
    if (away) selectTarget(away);
  }

  // Какая видеокарта на самом деле досталась. Просить высокую
  // производительность мы просим (js/gl/context.js), но решает система, и
  // на машине с двумя картами браузер спокойно уходит на встроенную.
  // Молча это выглядит как «игра тормозит», поэтому говорим вслух.
  if (scene && scene.name) {
    const kind = gpuKind(scene.name);
    if (kind === 'software') {
      say(game.state, L('ВИДЕОКАРТА НЕ ЗАДЕЙСТВОВАНА · ПРОГРАММНЫЙ РЕНДЕР'), '#ff7a66', 12);
    } else if (kind === 'integrated') {
      say(game.state, L('ИГРА ИДЁТ НА ВСТРОЕННОЙ ГРАФИКЕ · ') + shortGpu(scene.name),
        '#ffcc66', 10);
    }
  }

  sound.setMuted(!game.audio.on);
  sound.setVolume(game.audio.vol);

  const bootEl = document.getElementById('boot');
  const startBtn = document.getElementById('bootBtn');

  // Стартовый экран собирается здесь, а не лежит в index.html: его надо
  // переводить, а язык игрок выбирает прямо тут. Перевыбор пересобирает
  // экран на месте — уходить и возвращаться ради этого не надо.
  const paintBoot = () => {
    const body = document.getElementById('bootBody');
    if (body) body.innerHTML = bootHtml();
    startBtn.textContent = BOOT_START();
    const fs = document.getElementById('fsBtn');
    if (fs) fs.textContent = BOOT_FULL();
    for (const [code, id] of [['en', 'langEn'], ['ru', 'langRu']]) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      btn.classList.toggle('on', getLang() === code);
    }
    const tip = document.getElementById('touchHint');
    if (tip && Q.touchUi) tip.style.display = '';
  };
  for (const [code, id] of [['en', 'langEn'], ['ru', 'langRu']]) {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', () => { setLang(code); paintBoot(); });
  }
  paintBoot();
  // Полный экран — со стартового экрана: там есть настоящее нажатие,
  // которого требует браузер, и это единственный момент, когда игрок
  // заведомо смотрит на кнопку. На iPhone режима нет вовсе, поэтому
  // кнопки там нет, а вместо неё — подсказка про «На экран Домой».
  const fsBtn = document.getElementById('fsBtn');
  if (fsBtn && fullscreenAvailable()) {
    fsBtn.style.display = '';
    fsBtn.addEventListener('click', () => toggleFullscreen());
  }
  const start = () => {
    booted = true;
    wake();
    bootEl.classList.add('hidden');
    // Стоял в порту в кресле — вылет. На ногах — игрок сам решит, когда.
    if (game.state.mode === ST.DOCKED && !game.walk.on) game.launch();
    else hideOverlay();
    say(game.state, L('СИСТЕМА ') + world.name.toUpperCase() +
      L(' — ЦЕЛЬ: ') + (currentTarget(game.nav) ? currentTarget(game.nav).name : '—'));
  };
  startBtn.addEventListener('click', start);

  // Дальность старта показываем в отладке, а сцену рисуем сразу.
  requestAnimationFrame(frame);
  // Помещения корабля — после первых кадров, фоном: их встают смотреть
  // не на первой секунде, а мегабайт деталей на старте телефона лишний.
  setTimeout(() => { loadInterior(); }, 800);
}

boot();

// Полезно для отладки из консоли браузера.
window.GAME = game;
// Сцена — отдельно: без неё не снять ни одного опыта над картинкой
// (tools/screen.mjs): чтобы сравнить кадр с тенями и без, надо дотянуться
// до того, кто их ставит. null на запасном пути Canvas 2D.
window.SCENE = scene;
// Состояние сокета — туда же и затем же: сеть в снимке не поднимают,
// а приборы связи и список пилотов без неё пусты. С этим объектом
// состав сети подставляется руками (tools/screen.mjs, сцена pilots).
window.NET = net;
window.fmtDist = fmtDist;
window.dot = dot;
window.clamp = clamp;
