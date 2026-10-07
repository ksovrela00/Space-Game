// Точка входа: сборка мира, игровой цикл с фиксированным шагом физики,
// обработка глобальных клавиш и отрисовка кадра.

import { v3, copy, normalize, dot, clamp } from './core/vec3.js';
import { makeBasis, dirToWorld, lookAlong, toWorld, toLocal } from './core/basis.js';
import { input } from './core/input.js';
import { sound } from './core/sound.js';
import { Camera } from './render/camera.js';
import { Starfield } from './render/starfield.js';
import { HudLayer } from './ui/layer.js';
import { GlScene } from './gl/scene.js';
import { legBoxes } from './models/gear.js';
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
  makeNav, refreshNav, pickTarget, aimedTarget, currentTarget, navInfo, targetById, clearNavTarget,
  targetLabel,
} from './game/nav.js';
import {
  makeQuantum, updateQuantum, startCalibration, stopQuantum, abortQuantum,
  canJump, suggestHop, QUANTUM,
} from './game/quantum.js';
import {
  checkStation, startDockingComputer, stopDockingComputer, startLaunchComputer,
  updateDockingComputer, DOCK_RANGE,
} from './game/docking.js';
import {
  frameOf as stationFrame, carryInStation, enterStation, leaveStation, stationField, insideAt,
  hallZone, settleInHall, placeDocked, padPose, stepInStation,
  takeoffFromHall, stationWorld as stationWorldM,
} from './game/berth.js';
import { padByNo, padSizeFor, padAt } from './game/stationplan.js';
import { isLandable, localDir, groundRadius, worldPoint, waterAt } from './game/surface.js';
import { cityCrash, cityPadUnder, applyCities } from './game/city.js';
import { captureBody, carryShip, gravityField, gravityAt } from './game/gravity.js';
import { entryState, airDensity, ENTRY } from './game/entry.js';
import { makeDust, updateDust } from './game/dust.js';
import { makeChase, updateChase, placeChase, rotAround } from './game/chase.js';
import { makeRover, stepRover, placeRover, stepHangar, frameFrom } from './game/rover.js';
import {
  hangarBay, bayCenter, overBay, hangarFloor, bayDown, hangarToWorld, worldToHangar, hangarTransform,
  hangarSolids, onBayEdge, bayFoot, wheelsOnBay, bayOutside,
} from './game/hangar.js';
import { RV } from './models/rover.js';
import { makeDriveCam, stepDriveCam, driveCamLocal, DRIVECAM } from './game/drivecam.js';
import { makeFlow, updateFlow } from './game/flow.js';
import { makeYoke, updateYoke, EYE } from './models/cockpit.js';
import { updateDriveYoke } from './models/cockpit.rover.js';
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
import { PEER, NPC_COLOR } from './ui/theme.js';
import { setNpcRange, hullName } from './game/npc.js';
import { SCANNER_STEPS } from './game/loadout.js';
import { useShipType, useShipEquipment } from './game/specs.js';
import {
  showCrash, showHelp, hideOverlay, bootHtml, BOOT_START, BOOT_FULL,
} from './ui/screens.js';
import { showDocked, makeStation, syncFromServer, forgetPort } from './ui/station.js';
import { nextZoom, zoomFov, lookScale } from './game/zoom.js';
import { makeStick, moveStick, centerStick, stickControls, STICK } from './game/mousefly.js';
import {
  makeWalker, standUp, sitDown, seatNow, updateWalker, nearSeat, walkerEye, walkerLook, outsideWorld,
  standAt, deckWorld, enterAt,
  crateSolids, stepDoors, WALK,
} from './game/walker.js';
import { drawWalkHud } from './ui/walkhud.js';
import {
  makeAirlocks, makeAir, updateAirlocks, toggleHatch, closeAll, resetAirlocks, hatchNear, tunnelAt, pastSkin,
  onStair, airSolids, lockStatus, roomAir, openHatches, setHatches, hatchById, AIR,
  BAY, toggleBay, bayById, bayPanelNear, underBay, pastBay, ontoBay, bayCarry, bayTop,
} from './game/airlock.js';
import { panelNear, startRide, stepRide, cancelRide } from './game/lift.js';
import { routeTo, deckOf } from './game/route.js';
import { makeDeckMap, openDeckMap, deckMapKeys, deckMapClick, deckMapHover, drawDeckMap, roomName, DECKMAP_CLOSE } from './ui/deckmap.js';
import {
  vesselPoint, vesselDir, worldToVessel, nearVessels, bodyLocal, bodyLocalDir, bodyWorld, bodyWorldDir,
  personPlace, vesselDist,
} from './game/vessels.js';
import {
  makeGroundFrame, makeVesselFrame, groundToWorld, groundDirToWorld, worldToGround, worldDirToGround, groundY, waterUnder,
  shipToGround, shipPointToGround, groundPointToShip, boxToGround, RECENTER, hullUnderside, undersideBoxes,
} from './game/outside.js';
import {
  burnThrust, burnQuantum, burnWarp, warpSettled, applyServerFuel, resetFuelBook,
  fuelLevel, fuelReserve,
} from './game/fuel.js';
import { makeMap, drawMap, mapInput, resetMap, mapFrame, mapTouch } from './ui/map.js';
import { nextHop } from './game/warproute.js';
import { makeMenu, terminalFrame, terminalKeys } from './ui/terminal.js';
import {
  selectTarget as pickInSystem, targetSystem, clearTarget, dropWarpTarget as dropWarp,
} from './game/target.js';
import { makePlayer, updatePlayer, savePlayer, loadPlayer, applyServer } from './game/player.js';
import {
  session, start as sessionStart, queueSave, flushOnExit, linkError,
  dock as serverDock, refresh as serverRefresh, repair as serverRepair, isOnline,
  rescue as serverRescue, command as serverCommand, flushNow as flushSaveNow, retryLink,
  undock as serverUndock, movePilot as serverMove, requestPad as serverRequestPad,
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
  quantumFx, wreckFx,
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
const hud = new HudLayer(hudCanvas, camera);

// Сцена рисуется только в WebGL2. Запасного рендера на Canvas 2D больше
// нет: им никто не пользовался, а держать его значило чинить вторую
// картинку на каждую правку первой (README, «Рендер»). Без WebGL2 игра
// идёт, но сцены нет: об этом говорит стартовый экран. Так же она идёт и
// в проверках под Node — там WebGL2 нет вовсе, а логика и приборы те же.
let scene = new GlScene(screenCanvas, camera, starfield);
const glError = scene.ok ? null : scene.error;
if (!scene.ok) {
  console.warn(L('WebGL2 недоступен: ') + glError);
  scene = null;
}

let world = makeSystem(sys);
const ship = resetFuelBook(makeShip());
// Номер корабля на сервере (пока сервер его не назвал — null) и система, где он стоит.
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
  camera,                // глаз кадра: по нему проверки меряют швы переходов
  renderStats: { polys: 0, items: 0, backend: scene ? 'WebGL' : L('нет WebGL2') },
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
  help: false,           // открыта справка (H) — слой, а не режим
  zoom: 1,               // приближение по нажатию колеса: 1, 2, 4, 8 (js/game/zoom.js)
  // Управление мышью (Ctrl+Пробел, js/game/mousefly.js): виртуальная ручка.
  stick: makeStick(),
  spaceCombo: false,     // пробел этого нажатия ушёл на Ctrl+Пробел — не форсаж
  ctrlCombo: false,      // и Ctrl тоже — не убавляет тягу, пока его не отпустят
  ctrlThrottle: null,    // тяга до нажатия Ctrl: Ctrl ради сочетания её не трогает
  // Действия с местом, которые оборвала связь: их повторяет возврат связи
  // (holdForLink). dock — порт, где игра стоит, а сервер этого не знает.
  due: { dock: null, undock: false, place: false },
  aimed: null,           // цель под прицелом: её выберет Tab
  zone: null,            // обстановка у поверхности (высота, нормаль, грунт)
  entry: null,           // вход в атмосферу: нагрев, цвет и ось факела
  entryBuf: { dir: v3(), color: [0, 0, 0] },   // чтобы не сорить объектами
  dust: makeDust(),      // пыль из-под движков у самой земли
  flow: makeFlow(),      // пылинки за бортом: ими видно скорость и форсаж
  yoke: makeYoke(),      // положение ручки и РУДа в кабине (вид от 1-го лица)
  touch: makeTouch(),    // сенсорные органы: джойстик, тяга, кнопки
  capture: null,         // тело, в чьём гравитационном захвате корабль
  // Вездеход: к трюму какого корабля приписан, стоит ли в нём и пришло ли
  // это от сервера только что (fresh — применит шаг вездехода).
  roverLink: { carrier: null, stowed: false, fresh: false },
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
  // Площадка, которую порт выделил кораблю: станция и номер (берётся у
  // сервера, когда корабль входит в щель или включает докинг-компьютер).
  padAssign: null,
  // Обстановка в зале станции для приборов (js/game/berth.js, hallZone).
  hallInfo: null,
};

const dbg = makeDebug();
let booted = false;
const _camDir = v3();
const _camRight = v3();
const _camUp = v3();
const _wLook = { fwd: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] };
// Куда уехало несущее тело за шаг мира: замер до и после updateWorld.
const _carried = v3();

// --- смена звёздной системы --------------------------------------------------

/**
 * Забрать у сервера города системы.
 *
 * Хозяин мира — сервер: где стоит город и как он зовётся, решает он, а
 * не клиент (js/game/city.js, applyCities). Клиент при этом собирает
 * систему сам и СРАЗУ — ответа он не ждёт: генератор один и тот же, так
 * что чаще всего ответ ничего не меняет.
 *
 * Прицел сбрасывается только если набор городов ДЕЙСТВИТЕЛЬНО другой:
 * иначе ответ, пришедший через секунду после входа, сбивал бы уже
 * выбранную цель.
 */
function syncCities(target, forWorld) {
  if (!isOnline()) return;
  const was = forWorld.cities.map((c) => c.id).join(',');
  apiSystem(target.id).then((r) => {
    if (world !== forWorld || !r || !Array.isArray(r.cities)) return;
    applyCities(world, r.cities);
    if (world.cities.map((c) => c.id).join(',') !== was) game.nav = makeNav(world);
  }).catch(() => { /* не ответил — остаётся то, что клиент собрал сам */ });
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
  ship.dockPose = null;
  ship.berth = null;
  game.padAssign = null;
  game.hallInfo = null;
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
  game.map.cam.follow = null;
  game.map.hover = null;
  game.map.sel = null;
  game.map.items.length = 0;
  // Всё, что карта держит от прошлого кадра, — тела старой системы.
  game.map.vis.clear();
  game.map.gl.bodies.length = 0;
  game.map.gl.rings.length = 0;
  game.map.cfor = null;
  game.map.last.obj = null;
  game.map.press = null;

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
  closeLayers();
  game.entry = null;
  ship.dockedAt = station;
  game.lastStation = station;
  stopDockingComputer(ship);
  stopLanding(ship);
  stopQuantum(game.quantum);
  // Стоит на полу зала — там, где сел (settleInHall), или, если ставят
  // сразу (вход в игру, проверки), — на своей площадке.
  if (!ship.dockPose) {
    const n = game.padAssign && game.padAssign.st === station ? game.padAssign.n : firstPad(station);
    ship.dockPose = padPose(station.layout, n);
    ship.berth = { st: station, pad: n };
  }
  if (!ship.berth || ship.berth.st !== station) ship.berth = { st: station, pad: null };
  ship.gear.out = true;
  ship.gear.t = 1;
  placeDocked(ship, station, ship.dockPose);
  ship.lift = 0;
  ship.speed = 0;
  ship.throttle = 0;
  // Ремонт и бак в порту — за деньги и только у сервера (station.repair,
  // station.refuel): даром за сам факт стыковки они не даются.
  game.fuelSaid = 'ok';
  game.state.mode = ST.DOCKED;
  audioCue(game.audio, 'dock');
  audioReset(game.audio, ship);
  input.releaseAll();
  save();

  // Сбор за место берёт сервер, и он же считает стыковки. Ответ придёт
  // фоном: ждать его, держа игрока в порту перед пустым экраном, незачем.
  if (!restoring) dockOnServer(station);
}

/** Первая площадка станции под этот корабль — если порт ещё не назвал свою. */
function firstPad(st) {
  const want = padSizeFor(HULL.size.z * 1000, HULL.size.x * 1000);
  const p = st.layout.pads.find((q) => want === 'S' || q.size === 'L');
  return p ? p.n : 1;
}

/**
 * Попросить у порта площадку: корабль вошёл в щель или включил
 * докинг-компьютер. Решает сервер — он знает, где стоят другие (Stations::
 * request). Без связи — первая подходящая по размеру: садиться всё равно
 * куда-то надо.
 */
function askPad(st) {
  if (game.padAssign && game.padAssign.st === st) return;
  const size = padSizeFor(HULL.size.z * 1000, HULL.size.x * 1000);
  game.padAssign = { st, n: firstPad(st), local: true };
  inOrder(async () => {
    const r = await serverRequestPad(sys.id, st.id, size);
    if (!game.padAssign || game.padAssign.st !== st) return;
    if (r.ok && r.data && typeof r.data.pad === 'number') {
      game.padAssign = { st, n: r.data.pad };
      if (ship.docking && ship.docking.station === st) ship.docking.pad = r.data.pad;
      say(game.state, L('ПОРТ: ВАМ ПЛОЩАДКА ') + r.data.pad, '#78e08f', 4);
    } else if (r.refused) {
      say(game.state, L('ПОРТ: ') + r.refused, '#ffcc66', 4);
    }
  });
  if (ship.docking && ship.docking.station === st && !ship.docking.pad) ship.docking.pad = game.padAssign.n;
}

// --- место на сервере: стыковка, вылет, переходы пилота -------------------------
//
// Место корабля в порту и место пилота (на чьём борту, в кресле ли, на
// грунте ли) меняет только СЕРВЕР, и только действием в момент перехода.
// Раньше они ехали в фоновом сохранении — а оно опаздывает: собранное до
// пересадки, оно приходило после неё и ставило пилота обратно на борт
// прежнего корабля. Новый улетал без него, а порт потом отказывал «не на
// борту», рынок и заправка — «не в порту».
//
// Действия идут СТРОГО ПО ОЧЕРЕДИ (inOrder): запросы HTTP параллельны,
// порядок прихода не обещан, и вылет, обогнавший стыковку, оставил бы
// корабль в доке у сервера, пока у игрока он летит.
let placeChain = Promise.resolve();
function inOrder(fn) {
  const p = placeChain.then(fn);
  placeChain = p.catch(() => {});
  return p;
}

/**
 * Встать в порт на сервере. Отказ — сказать словами и выйти из дока:
 * порт, которого нет у сервера, — это рынок и заправка, отвечающие на
 * каждое нажатие «не в порту». Обрыв — повторить с возвратом связи.
 */
function dockOnServer(station) {
  return inOrder(async () => {
    game.due.dock = null;
    if (ship.dockedAt !== station) return;          // уже улетел
    const r = await serverDock(sys.id, station.id, ship.berth ? ship.berth.pad : null, ship.dockPose);
    if (r.lost) { game.due.dock = station; return; }
    if (ship.dockedAt !== station) return;
    if (r.refused) {
      say(game.state, L('ПОРТ ОТКАЗАЛ: ') + r.refused, '#ff7a66', 5);
      game.launch();
      return;
    }
    game.port = r.data.station;
    // Состояние целиком: деньги после сбора, а если стыковка оказалась
    // в новой системе — и бак после варпа, который сервер списал тут же.
    syncFromServer(game);
    if (r.data.fee > 0) {
      say(game.state, L('СТЫКОВОЧНЫЙ СБОР · ') + r.data.fee + L(' кр'), '#ffcc66', 3);
    }
  });
}

/** Выйти из порта на сервере (повторный вызов безвреден). */
function undockOnServer() {
  return inOrder(async () => {
    game.due.undock = false;
    if (ship.dockedAt) return;                      // уже снова в порту
    const r = await serverUndock();
    if (r.lost) game.due.undock = true;
    else if (r.refused) say(game.state, L('ВЫЛЕТ: ') + r.refused, '#ff7a66', 4);
  });
}

/**
 * Переход пилота — на сервер, сразу: встал, сел, сошёл на грунт, поднялся
 * на борт. Место — каким оно стало в этот миг (meRecord). Не принят —
 * сервер говорит, где пилот на самом деле, и игра забирает его состояние.
 */
function placePilot() {
  const rec = meRecord();
  return inOrder(async () => {
    game.due.place = false;
    const r = await serverMove(rec);
    if (r.lost) { game.due.place = true; return; }
    if (r.refused) { say(game.state, L('ПЕРЕХОД: ') + r.refused, '#ff7a66', 4); return; }
    if (r.data.moved) return;
    say(game.state, L('ПЕРЕХОД НЕ ПРИНЯТ: ') + (r.data.why || r.data.denied), '#ff7a66', 4);
    // Место корабля — свежее, а не восьмисекундной давности: из него
    // сервер и поставит пилота.
    await save(true);
    await game.respawn();
  });
}

/** Связь вернулась: довести то, что она оборвала. */
function finishDue() {
  if (game.due.dock && ship.dockedAt === game.due.dock) dockOnServer(game.due.dock);
  if (game.due.undock && !ship.dockedAt) undockOnServer();
  if (game.due.place) placePilot();
}

/** Ремонт в порту: кнопка на экране стыковки. */
game.repair = async () => {
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

/**
 * Вылет: отрыв от пола зала. Корабль остаётся в зале — дальше пилот
 * выводит его сквозь тоннель сам, или докинг-компьютер (auto). Раньше
 * вылет ставил корабль в полутора километрах перед щелью: зала не было.
 */
game.launch = (auto = false) => {
  const st = ship.dockedAt;
  if (!st) return;
  hideOverlay();
  game.menu.open = false;
  game.state.mode = ST.FLIGHT;
  ship.dockedAt = null;
  // out — корабль в зале на выход: C ведёт его наружу, а не на площадку.
  ship.berth = { st, pad: ship.berth ? ship.berth.pad : null, out: true };
  takeoffFromHall(ship);
  undockOnServer();
  audioReset(game.audio, ship);
  audioCue(game.audio, 'takeoff');
  if (auto) {
    startLaunchComputer(ship, st);
    say(game.state, L('ДОКИНГ-КОМПЬЮТЕР: ВЫЛЕТ'), '#78e08f');
  } else {
    say(game.state, L('ОТРЫВ ОТ ПЛОЩАДКИ · ВЫЛЕТ — ПО ТОННЕЛЮ · C — ДОКИНГ-КОМПЬЮТЕР'), '#78e08f', 4);
  }
  input.releaseAll();
  // Вылет — клавишей: это и есть действие, которого ждёт браузер, чтобы
  // отдать мышь ручке.
  grabStickMouse();
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

/**
 * Встать в порт сразу, без захода. Не игровое действие: им прогон
 * (tools/smoke.mjs) проверяет, что делает игра с ответом сервера на
 * стыковку, не гоняя докинг-компьютер две минуты.
 */
game.dockHere = (station) => dockAt(station);

/**
 * Из порта — сразу за створ, без зала и тоннеля. Не игровое действие (в
 * игре вылет — отрыв от площадки, game.launch): им снимки и прогон
 * (tools/screen.mjs, tools/smoke.mjs) выводят корабль в пустоту перед
 * щелью, не гоняя его минуту по залу.
 */
game.launchOut = () => {
  const st = ship.dockedAt || (ship.berth && ship.berth.st) || game.lastStation;
  const wasDocked = !!ship.dockedAt;
  hideOverlay();
  game.menu.open = false;
  game.state.mode = ST.FLIGHT;
  if (st) {
    const b = makeBasis();
    b.fwd = { ...st.basis.fwd };
    b.right = { ...st.basis.right };
    b.up = { ...st.basis.up };
    placeShip(ship, v3(
      st.pos.x + st.basis.fwd.x * (st.shape.D + 1.5),
      st.pos.y + st.basis.fwd.y * (st.shape.D + 1.5),
      st.pos.z + st.basis.fwd.z * (st.shape.D + 1.5)), b);
  }
  ship.dockedAt = null;
  ship.dockPose = null;
  ship.berth = null;
  // За створом шасси убраны — как после вылета по тоннелю.
  ship.gear.out = false;
  ship.gear.t = 0;
  ship.gear.drop = null;
  game.padAssign = null;
  if (wasDocked) undockOnServer();
  audioReset(game.audio, ship);
  input.releaseAll();
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

/**
 * «Продолжить» после крушения. Корабль уже вернула в порт страховка
 * сервера (Combat::respawn): забираем его состояние, а не чиним
 * корабль сами.
 */
game.respawn = async () => {
  hideOverlay();
  const st = await serverRefresh();
  if (!st) { game.resync = true; return; }
  applyState(serverToSave(st));
  applyServer(game.player, st);
  if (game.state.mode === ST.DOCKED) showDocked(game);
};

// Сколько секунд ждём второго нажатия у необратимых клавиш (буксир).
const CONFIRM_S = 3;

// --- карта и справка: слои поверх живого мира -------------------------------
//
// Карта (M) и справка (H) — СЛОИ, а не режимы игры. Режимами они были, и
// пока карта или справка открыты, ход не считался вовсе: корабль вставал
// посреди полёта, хотя мир, соседи и NPC ехали дальше, а у грунта тело
// уезжало из-под стоянки. В сети остановить мир нельзя, поэтому под ними
// идёт всё как шло: корабль летит, автоматика работает, порт везёт с
// собой. Ручки на это время отпущены — как и под меню пилота (I).

/** Открыт ли слой, под которым ручки корабля отпущены. */
const layerOpen = () => game.menu.open || game.map.open || game.help;

// --- управление мышью (Ctrl+Пробел) -------------------------------------------
//
// Мышь ведёт виртуальную ручку (js/game/mousefly.js): её отклонение —
// скорость поворота носа, как в Star Citizen. Мышь при этом захвачена
// окном (pointer lock) и за его край не уходит; Esc её отпускает, щелчок
// по кадру возвращает — как при ходьбе. Где курсор нужен — карта, меню,
// справка, порт, — мышь свободна, а ручка в нуле.

const STICK_KEY = 'solar_mouse_flight';
const _stickMove = { x: 0, y: 0 };
const _stickOut = { pitch: 0, yaw: 0 };
try { game.stick.on = localStorage.getItem(STICK_KEY) === '1'; } catch (e) { /* без хранилища — клавишами */ }

/** Нужна ли сейчас мышь ручке: пилот в кресле, в полёте или на грунте, без слоёв. */
const stickWanted = () => game.stick.on && !Q.touchUi && !game.walk.on && !layerOpen()
  && !game.deckMap.open && (game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED);

/**
 * Захватить мышь, если ручке она нужна. Только по действию игрока —
 * клавише или щелчку: без него браузер мышь не отдаёт.
 */
function grabStickMouse() {
  if (stickWanted() && !input.locked) input.lock(screenCanvas);
}

function toggleMouseFlight() {
  const s = game.stick;
  s.on = !s.on;
  centerStick(s);
  try { localStorage.setItem(STICK_KEY, s.on ? '1' : '0'); } catch (e) { /* только на этот раз */ }
  if (s.on) grabStickMouse();
  else if (!game.walk.on) input.unlock();
  say(game.state, s.on ? L('УПРАВЛЕНИЕ МЫШЬЮ · CTRL+ПРОБЕЛ — КЛАВИШИ')
    : L('УПРАВЛЕНИЕ КЛАВИШАМИ · CTRL+ПРОБЕЛ — МЫШЬ'), '#9fd9ff', 3);
}

/**
 * Кадр ручки: захват мыши, ход ручки. Ручка в нуле всякий раз, когда
 * мышь ей не принадлежит: иначе корабль продолжал бы разворот, начатый
 * до того, как открыли карту или нажали Esc.
 */
function mouseFlightFrame() {
  const s = game.stick;
  if (!stickWanted()) {
    // Мышь отпускаем, только если держала её ручка: на ногах она у головы.
    if (s.on && input.locked && !game.walk.on) input.unlock();
    centerStick(s);
    s.locked = false;
    return;
  }
  if (!input.locked) {
    centerStick(s);
    s.locked = false;
    if (input.mouse.clicked) grabStickMouse();
    return;
  }
  s.locked = true;
  // Правая кнопка — осмотр: движение мыши уходит камере (updateCamOrbit).
  if (input.mouse.right) return;
  input.takeLook(_stickMove);
  moveStick(s, _stickMove.x, _stickMove.y);
}

/** Открыть карту: на том, куда летишь, — вид на всю систему. */
game.openMap = () => {
  game.help = false;
  game.map.open = true;
  // Карта открывается на том, куда летишь: выбранной оказывается
  // текущая цель, а вид охватывает всю систему. Искать себя на
  // плане каждый раз заново — работа, которой быть не должно.
  resetMap(game.map, world);
  game.map.sel = currentTarget(game.nav);
  hideOverlay();
};

function closeMap() {
  game.map.open = false;
  if (game.state.mode === ST.DOCKED) showDocked(game);
  // Закрыли клавишей — это и есть действие, которого ждёт браузер.
  grabStickMouse();
}

function openHelp() {
  game.map.open = false;
  game.help = true;
  input.unlock();
  showHelp(game);
}

game.closeOverlay = () => {
  game.help = false;
  hideOverlay();
  if (game.state.mode === ST.DOCKED) showDocked(game);
  // Справку закрыли на ногах — мышь обратно взгляду (нажатие закрытия и
  // есть действие игрока, которого требует браузер). В кресле — ручке.
  if (game.walk.on && !Q.touchUi) input.lock(screenCanvas);
  else grabStickMouse();
};

/** Закрыть карту и справку без экрана порта: крушение, стыковка, тоннель. */
function closeLayers() {
  game.map.open = false;
  game.help = false;
  // И терминал: открытый в полёте, он оставался поверх экрана крушения и
  // забирал клавиши — «Продолжить» было не нажать с клавиатуры.
  game.menu.open = false;
}

/** В кресле своего корабля, стоящего в порту: терминалу — разделы порта. */
const portSeat = () => game.state.mode === ST.DOCKED && !!ship.dockedAt && !game.walk.on;

/**
 * Бортовой терминал (I). Ручки отпущены, мышь — курсором: в терминале жмут
 * кнопки. В порту, в кресле — с разделами порта (рынок, оснащение, верфь);
 * сам он больше не открывается при стыковке: корабль стоит на площадке, и
 * пилот волен встать и пойти в терминал станции.
 */
game.openTerminal = () => {
  if (portSeat()) showDocked(game);
  game.menu.open = true;
  game.deckMap.open = false;
  input.unlock();
  input.releaseAll();
};

/** Закрыть терминал: мышь — обратно взгляду на ногах или ручке в кресле. */
game.closeTerminal = () => {
  game.menu.open = false;
  // Закрыли клавишей или кнопкой — это и есть действие игрока, без
  // которого браузер мышь не отдаёт.
  if (game.walk.on && !Q.touchUi) input.lock(screenCanvas);
  else grabStickMouse();
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

/** Кто я в сети: номер игрока (или null, пока сервер его не назвал). */
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
        ? (await import('./models/interior.prom.js')).prometheusPlan(H.mesh)
        : code === 'rover' ? (await import('./models/interior.rover.js')).ROVER_PLAN : m.CHALLENGER;
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
  placePilot();
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
    // Где стоял прежний корабль — в базу до пересадки, и ДОЖДАТЬСЯ ответа:
    // дальше его место пишет уже не эта игра (он засыпает там, где стоит),
    // а сохранение, обогнанное пересадкой, сервер за него не примет.
    await save(true);
    // И после переходов пилота, ещё идущих к серверу: командуют с борта.
    const state = await inOrder(() => serverCommand(id));
    seatPilot();
    applyState(serverToSave(state));
    applyServer(game.player, state);
    syncFromServer(game, state);
    save();
    say(game.state, L('КОМАНДОВАНИЕ ПРИНЯТО: ') + (SHIP.typeName || ''), '#78e08f', 3);
    // Ответы порта — про прежний корабль: его модули, его трюм, его кресло.
    forgetPort(game);
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
  const air0 = ownAir();
  const hatchOpen = !!air0 && air0.hatches.some((x) => x.want || x.open > 0);
  // И платформа: улететь с опущенной — значит тащить её по грунту.
  const bayDown = !!air0 && (air0.bays || []).some((x) => x.want || x.travel > 0);
  if (hatchOpen || bayDown) {
    closeAll(air0);
    if (hatchOpen) say(st, L('ЛЮКИ ЗАКРЫВАЮТСЯ'), '#ffcc66', 2);
    if (bayDown) say(st, L('ПЛАТФОРМА ПОДНИМАЕТСЯ'), '#ffcc66', 2);
  }
  input.unlock();
  input.releaseAll();
  st.view = game.walk.prevView || 'cockpit';
  game.walkEye = null;
  // Под управлением мышью мышь из кресла — сразу ручке.
  grabStickMouse();
  game.frame = ownVessel;
  // Сел — путь снят и план закрыт.
  game.walkGoal = null;
  game.walkRoute = null;
  game.deckMap.open = false;
  if (st.mode === ST.DOCKED && ship.dockedAt) showDocked(game);
  say(st, L('ПИЛОТ В КРЕСЛЕ'), '#78e08f', 2);
  placePilot();
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
  // Терминал — и на ногах: трюм, подряды, деньги смотрят где угодно.
  if (input.pressed('KeyI')) {
    game.openTerminal();
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
  } else if (game.walkBay && input.pressed('KeyE')) {
    useBay(game.walkBay.bx, aboardVessel());
  } else if (game.walkHatch && input.pressed('KeyE')) {
    useHatch(game.walkHatch, game.walkHatchShip || ownVessel);
  } else if (input.pressed('KeyE', 'KeyY')) {
    if (!game.sit() && input.pressed('KeyY')) {
      say(st, L('КРЕСЛО ПИЛОТА — В РУБКЕ: ПОДОЙДИТЕ К НЕМУ'), '#ffcc66', 2.5);
    }
  }
  if (input.pressed('KeyH')) {
    openHelp();
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
  if (game.help || game.map.open || game.menu.open || game.deckMap.open) {
    game.walkEye = w.out ? null : walkerEye(w, I, _eyeM);
    return;
  }
  if (w.upFrom) { w.upT += dt / UP_BLEND; if (w.upT >= 1) w.upFrom = null; }
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
    // Под приближением голова медленнее во столько же раз (js/game/zoom.js).
    lookX: (lx * WALK.look + turn) * lookScale(game.zoom),
    lookY: -ly * WALK.look * lookScale(game.zoom),
  };
  // В трюме с вездеходом — его кузов и трап твёрдые (js/game/hangar.js).
  w.props = w.out ? _noProps : hangarProps(aboardVessel());
  // В пустоте за бортом тяжести нет: палубная — только в корабле. Шагнул в
  // открытый люк без трапа — плывёт, куда толкнулся, и подруливает.
  {
    const airV = !w.out ? (V.own ? ownAir() : V.air) : null;
    w.float = !!airV && !vesselBody(V) && outsideHull(airV, w.pos);
  }
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
  game.walkBay = null;
  if (!w.on || w.phase !== 'walk' || !I) return;
  if (!w.out) {
    const V = aboardVessel();
    const air = V.own ? ownAir() : V.air;
    if (air) {
      game.walkHatch = hatchNear(air, air.I, w.pos, false); game.walkHatchShip = V;
      // Пульт платформы — только на палубе: с грунта на неё сперва ступают.
      if (!w.ride) game.walkBay = bayPanelNear(air, w.pos);
    }
    // Дверь вездехода, что стоит в трюме, — снаружи, как люк соседа с грунта.
    if (!game.walkHatch) {
      const near = hangarHatchNear(w, V);
      if (near) { game.walkHatch = near.hx; game.walkHatchShip = near.R; }
    }
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

const _noProps = [];

/**
 * Грунт, по которому стоят ноги, колёса, трап и плита: устойчивый —
 * не зависит от того, сколько плиток уже пришло (js/gl/scene.js,
 * settledGround); без сцены — настоящий.
 */
const groundOf = (body, dir) => (scene ? scene.settledGround(body, dir) : groundRadius(body, dir));

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

/**
 * Почему платформу сейчас не опустить (или null). Те же запреты, что у
 * люков, и ещё порт: в доке под кораблём не грунт, а конструкция станции.
 */
function bayBlock(pOut) {
  if (ship.dockedAt) return L('В ПОРТУ ПЛАТФОРМУ НЕ ОПУСТИТЬ');
  if (game.warp.phase === 'tunnel' || game.warp.phase === 'align') return L('ПЛАТФОРМА ЗАБЛОКИРОВАНА: ВАРП');
  const q = game.quantum.phase;
  if (q === 'jump' || q === 'brake' || q === 'calib') return L('ПЛАТФОРМА ЗАБЛОКИРОВАНА: КВАНТОВЫЙ ПРЫЖОК');
  if (pOut > 0.01 && game.state.mode === ST.FLIGHT) {
    const v = game.zone ? Math.hypot(game.zone.relVel.x, game.zone.relVel.y, game.zone.relVel.z) : ship.speed;
    if (v > HATCH_AIRSPEED) return L('ПЛАТФОРМА ЗАБЛОКИРОВАНА: НАПОР ВОЗДУХА');
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
 * Вне ли корпуса точка p (оси корабля, м; air — его шлюзы): не в помещении,
 * не в тоннеле люка и не над плитой платформы. Невидимых стенок нет (так
 * решил автор игры), и за борт попадают — шагнув в открытый люк без трапа,
 * спрыгнув с висящей плиты. Там корабль уже не держит: у тела — падение на
 * грунт (crossThreshold), в пустоте — без тяжести (w.float).
 */
function outsideHull(air, p) {
  const J = air.I;
  if (J.roomAt(p) || tunnelAt(air, J, p)) return false;
  for (const bx of air.bays || []) if (overBay(bx, p[0], p[2], -0.5) && p[1] > bayTop(bx) - 1) return false;
  return true;
}

/** Ниже ли точка p (оси корабля V, м) грунта под ней: грунта рядом нет — нет. */
function belowGround(V, p) {
  const gy = groundUnder(V, p[0], p[2]);
  return gy !== null && p[1] < gy + 0.05;
}

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

/**
 * Стоит ли кто-нибудь под плитой платформы корабля V — сам пилот за
 * бортом или другие люди на грунте: опускать её им на голову нельзя.
 */
const _belowP = [0, 0, 0];
function bayBelow(bx, V = ownVessel) {
  const w = game.walk;
  if (w.on && w.out && underBay(bx, walkerShipPos(V))) return true;
  for (const p of game.people) {
    if (p.st === 'out' && p.here && underBay(bx, worldToVessel(V, p.place.pos, _belowP))) return true;
  }
  return false;
}

/**
 * Машина на краю платформы корабля V (js/game/hangar.js, onBayEdge) — тогда
 * плита никуда не идёт. Машины — в его трюме (место в трюме) и рядом на
 * грунте (место в мире — в его оси): свой вездеход и соседские.
 */
const _loadR = [], _loadHg = { x: 0, y: 0, z: 0, yaw: 0 };
function bayLoad(bx, V) {
  if (walkerOnBayEdge(bx, V)) return 'person';
  for (const R of hangarRovers(V, _loadR)) {
    const hg = R.own ? rover.hg : R.hg;
    if (hg && onBayEdge(bx, hg)) return 'car';
  }
  // На грунте — любая машина над плитой: на краю, под ней или на ней, не
  // перейдя в оси носителя, — плита на неё легла бы или поддела.
  const edgeAt = (P, fwd) => vesselDist(V, P) < 0.04 && bayFoot(bx, worldToHangar(V, P, fwd, _loadHg)) > 0;
  if (HULL.ground && !ship.away && rover.mode === 'ground' && V !== ownVessel && edgeAt(ship.pos, ship.basis.fwd)) return 'car';
  for (const R of game.peers) {
    if (R === V || R.carried || !R.pos) continue;
    const H = hullOf(R.type || ROOMS_TYPE);
    if (H && H.gear && H.gear.wheels && edgeAt(R.pos, R.basis.fwd)) return 'car';
  }
  return null;
}

/**
 * Стоит ли пилот на кромке плиты корабля V: ноги на её высоте, подошва (в
 * полметра) и над плитой, и за краем. Стоящего на ней целиком плита везёт,
 * а с кромки — нет: одной ногой он на палубе или на грунте.
 */
const _edgeP = [0, 0, 0];
function walkerOnBayEdge(bx, V) {
  const w = game.walk;
  if (!w.on || w.phase !== 'walk') return false;
  let p;
  if (w.out) p = walkerShipPos(V);
  else if (aboardVessel() === V) { _edgeP[0] = w.pos[0]; _edgeP[1] = w.pos[1]; _edgeP[2] = w.pos[2]; p = _edgeP; }
  else return false;
  const b = bx.b, h = WALK.half, k = WALK.half - 0.05;
  const over = p[0] > b.x[0] - h && p[0] < b.x[1] + h && p[2] > b.z[0] - h && p[2] < b.z[1] + h;
  const inside = p[0] > b.x[0] + k && p[0] < b.x[1] - k && p[2] > b.z[0] + k && p[2] < b.z[1] - k;
  return over && !inside && Math.abs(p[1] - bayTop(bx)) < 0.12;
}

const _airEnv = { pOut: 0, block: null, bayBlock: null, ground: groundShip,
  occupied: (hx) => hatchOccupied(hx, ownVessel), below: (bx) => bayBelow(bx, ownVessel),
  load: (bx) => bayLoad(bx, ownVessel) };
const _airEnvV = { pOut: 0, block: null, bayBlock: null, ground: null, occupied: null, below: null, load: null };

const groundZero = () => 0;

/** Воздух в трюме носителя c, бар: помещение с платформой (у опущенной — забортный). */
function holdPressure(c) {
  const bx = hangarBay(c.air);
  const r = bx ? roomAir(c.air, bx.room) : null;
  return r ? r.p : 0;
}

/** Шаг шлюзов — каждый кадр: своего корабля и чужих рядом. */
function airFrame(dt) {
  const I = interiorOf(HULL.code);
  const st = game.state;
  if (!ship.away && I && I.air) {
    // Вездеход в трюме: за дверью — воздух трюма, а под трапом — пол, на
    // котором машина стоит (начало её осей).
    const inHold = HULL.ground && rover.mode === 'hangar' ? carrierOf(game.roverLink.carrier) : null;
    _airEnv.ground = inHold ? groundZero : groundShip;
    _airEnv.pOut = inHold ? holdPressure(inHold) : outsidePressure();
    _airEnv.block = hatchBlock(_airEnv.pOut);
    _airEnv.bayBlock = bayBlock(_airEnv.pOut);
    const ev = updateAirlocks(I.air, _airEnv, dt);
    airSounds(ev, I.air, ownVessel);
    for (const e of ev) {
      if (e.kind !== 'forced' || !game.walk.on) continue;
      if (bayById(I.air, e.id)) say(st, _airEnv.bayBlock + L(' · ПЛАТФОРМА ПОДНИМАЕТСЯ'), '#ffcc66', 3);
      else say(st, _airEnv.block + L(' · ЛЮКИ ЗАКРЫВАЮТСЯ'), '#ffcc66', 3);
    }
    baySay(ev, I.air);
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
    const inHold = V.carried ? carrierOf(V.carrier) : null;
    _airEnvV.pOut = inHold ? holdPressure(inHold) : V.mode === 'docked' ? 0 : pressureAt(V.pos);
    _airEnvV.ground = inHold ? groundZero : V._ground || (V._ground = (x, z) => groundUnder(V, x, z));
    _airEnvV.occupied = V._occ || (V._occ = (hx) => hatchOccupied(hx, V, true));
    // Платформу соседа ведёт его игра; здесь она идёт за его просьбой по
    // тем же правилам: до грунта, не на голову, в порту — никуда.
    _airEnvV.below = V._below || (V._below = (bx) => bayBelow(bx, V));
    _airEnvV.load = V._load || (V._load = (bx) => bayLoad(bx, V));
    _airEnvV.bayBlock = V.mode === 'docked' ? L('В ПОРТУ ПЛАТФОРМУ НЕ ОПУСТИТЬ') : null;
    const evV = updateAirlocks(V.air, _airEnvV, dt);
    airSounds(evV, V.air, V);
    // Пилот на борту соседа (свой спящий корабль, чью плиту он и зовёт) —
    // слышит, что она встала, как у себя.
    if (game.walk.on && !game.walk.out && game.walk.vessel === V) baySay(evV, V.air);
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
    } else if (e.kind === 'bay') {
      // Платформа тронулась: привод на весь ход и стук на остановке — тот
      // же звук, что у лифта «Прометея».
      const bx = bayById(air, e.id);
      if (bx) {
        const d = Math.abs(bx.target - bx.travel);
        audioCue(game.audio, 'lift', { dur: d / BAY.speed + BAY.speed / BAY.accel, up: e.dir === 'up' });
      }
    }
  }
}

/**
 * Что сказать о платформе своего корабля: где остановилась. Говорим
 * только тому, кто рядом, — сидящему в рубке это знать незачем.
 */
function baySay(ev, air) {
  const st = game.state;
  if (!game.walk.on) return;
  for (const e of ev) {
    if (e.kind !== 'bayStop') continue;
    const bx = bayById(air, e.id);
    if (!bx) continue;
    if (e.at === 'top') say(st, L('ПЛАТФОРМА ПОДНЯТА'), '#78e08f', 2.5);
    else if (e.at === 'ground') say(st, L('ПЛАТФОРМА НА ГРУНТЕ'), '#78e08f', 2.5);
    else if (e.at === 'held') say(st, L('ПОД ПЛАТФОРМОЙ ЧЕЛОВЕК · СПУСК ЖДЁТ'), '#ffcc66', 3);
    else if (e.at === 'load') {
      say(st, e.who === 'person' ? L('НА КРАЮ ПЛАТФОРМЫ ЧЕЛОВЕК · ХОД ЖДЁТ') : L('МАШИНА НА КРАЮ ПЛАТФОРМЫ · ХОД ЖДЁТ'), '#ffcc66', 3);
    }
    else if (isFinite(bx.gap)) say(st, L('ПЛАТФОРМА ВЫПУЩЕНА · ДО ГРУНТА ') + bx.gap.toFixed(1) + L(' М'), '#ffcc66', 3);
    else say(st, L('ПЛАТФОРМА ВЫПУЩЕНА · ПОД НЕЙ ПУСТО'), '#ffcc66', 3);
  }
}

/** Стоящего на платформе везёт она сама (js/game/airlock.js, bayCarry). */
function carryBay() {
  const w = game.walk;
  if (!w.on || w.out || w.phase !== 'walk') return;
  const V = aboardVessel();
  w.pos[1] -= bayCarry(V.own ? ownAir() : V.air, w.pos);
}

/**
 * E у люка: открыть или закрыть.
 *
 * Свой — сразу. Чужой — просьбой (js/net/socket.js, askHatch): решит тот,
 * кто его ведёт (у него напор воздуха и прыжок), а спящий корабль — сервер.
 */
function useHatch(hx, V = ownVessel) {
  const st = game.state, air = ownAir();
  // У NPC люков не открывают: внутрь пускать некому, а сервер такие
  // просьбы и не слушает.
  if (V.npc) {
    say(st, L('ЛЮК ЗАПЕРТ · ') + (V.name || ''), '#ffcc66', 2.5);
    return;
  }
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
 * E у пульта платформы: вниз или наверх. Пульт на самой плите — тот, на
 * котором едут; на переборке трюма — тот, которым её зовут с палубы.
 *
 * Своя — сразу. Чужая — просьбой, тем же путём, что люк (askHatch): имя
 * платформы ездит в том же списке открытых.
 */
function useBay(bx, V = ownVessel) {
  const st = game.state;
  if (V.npc) {
    say(st, L('ПЛАТФОРМА ЗАПЕРТА · ') + (V.name || ''), '#ffcc66', 2.5);
    return;
  }
  if (!V.own) {
    if (!isOnline() || !askHatch(V.id, bx.id, !bx.want)) {
      say(st, L('НЕТ СВЯЗИ: ПЛАТФОРМУ ЧУЖОГО КОРАБЛЯ НЕ ВЫЗВАТЬ'), '#ff7a66', 3);
      return;
    }
    say(st, (bx.want ? L('ПРОСЬБА ПОДНЯТЬ ПЛАТФОРМУ') : L('ПРОСЬБА ОПУСТИТЬ ПЛАТФОРМУ')) + ' · ' + (V.name || L('ПИЛОТ')),
      '#9fd9ff', 2.5);
    return;
  }
  const air = ownAir();
  if (!air) return;
  const res = toggleBay(air, bx);
  if (res) { say(st, res, '#ff7a66', 3); return; }
  say(st, bx.want ? L('ПЛАТФОРМА: СПУСК') : L('ПЛАТФОРМА: ПОДЪЁМ'), '#9fd9ff', 2.5);
  save();
}

/**
 * Просьба о люке НАШЕГО корабля от другого игрока (сокет, hatchreq):
 * открываем по своим правилам — те же запреты, что и для себя.
 */
function hatchRequest(ev) {
  const air = ownAir();
  if (!air || ship.away || ev.ship !== ship.id) return;
  // Платформа просится тем же сообщением, что и люк.
  const bx = bayById(air, String(ev.id));
  if (bx) {
    if (bx.want === !!ev.open || toggleBay(air, bx) !== null) return;
    say(game.state, (ev.open ? L('ПЛАТФОРМУ ОПУСКАЕТ: ') : L('ПЛАТФОРМУ ПОДНИМАЕТ: ')) + (ev.name || L('ПИЛОТ')), '#9fd9ff', 3);
    save();
    return;
  }
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
  // У вездехода вместо стоек колёса (js/models/rover.js, buildRoverGear):
  // точка крепления — середина колеса, длина — радиус. Коробка колеса по
  // шине: в него упираются, на него не встают. Стоек у таких «шасси» нет, и
  // разбор стоек ронял кадр у первого же вездехода рядом с пешеходом.
  if (G.wheels) {
    const hw = RV.wheel.w / 2 + 0.02;
    for (const hp of G.hardpoints) {
      const x = hp.x * 1000, y = hp.y * 1000, z = hp.z * 1000, r = G.legLengths[0] * 1000;
      out.push({ lo: [x - hw, y - r, z - r], hi: [x + hw, y + r, z + r], wheel: true });
    }
    return;
  }
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
    if (H.gear && H.gear.wheels) {
      // Вездеход — коробками кузова с проёмом двери и колёсами, как в трюме
      // (ROVER_BOXES). По карте днища (клетки в полметра) клетка у края
      // днища — 0.8 м над грунтом — накрывала его трап, и подняться к двери
      // с грунта было нельзя: голова упиралась в «днище» над ступенями.
      for (const s of ROVER_BOXES) _shipBoxes.push(s);
    } else {
      gearBoxes(V, H.gear, _shipBoxes);
      // Днище — коробками вокруг пилота: на лёгком теле прыгают выше, чем
      // висит корпус.
      undersideBoxes(underOf(H.mesh), groundPointToShip(T, pos, _wsp2), 2.5, _shipBoxes);
    }
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

// --- верх взгляда на пороге -------------------------------------------------------
//
// На палубе пешеход стоит по «вверх» корабля, на грунте — по «вверх» тела,
// а корабль на склоне наклонён до 20°. Ноги на пороге переносятся точно, а
// верх — мгновенно, и глаз в 1.7 м над ногами пролетал за кадр 45 см, а
// горизонт поворачивался на 15° (замер — tools/smoke.mjs, «швы переходов»,
// шлюз на склоне): шаг в шлюз ощущался, как будто куда-то перенесли. Теперь
// верх взгляда доворачивается от прежнего к новому за UP_BLEND — как
// человек, шагнувший с косогора на ровный пол, выпрямляется, а не
// переставляется. Ноги и куда смотрит глаз — точные; меняется только наклон
// головы и с ним — где глаз над ногами.
const UP_BLEND = 0.4;
const _tu = [0, 0, 0], _tv = [0, 0, 0], _to = [0, 0, 0], _eyeT = [0, 0, 0];

/** Верх взгляда в осях кадра: от прежних осей (w.upFrom) к нынешним [0, 1, 0]. */
function tiltUp(w, out) {
  if (!w.upFrom) { out[0] = 0; out[1] = 1; out[2] = 0; return out; }
  const t = Math.min(1, w.upT), k = t * t * (3 - 2 * t), a = w.upFrom;
  out[0] = a[0] * (1 - k); out[1] = a[1] * (1 - k) + k; out[2] = a[2] * (1 - k);
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= l; out[1] /= l; out[2] /= l;
  return out;
}

/** Повернуть v поворотом, что переводит [0, 1, 0] в u (Родриг). */
function rotFromUp(u, v, out) {
  const s = Math.hypot(u[0], u[2]), c = u[1];
  if (s < 1e-9) { out[0] = v[0]; out[1] = v[1]; out[2] = v[2]; return out; }
  const kx = u[2] / s, kz = -u[0] / s;           // ось: [0, 1, 0] × u
  const d = kx * v[0] + kz * v[2];
  const cx = -kz * v[1], cy = kz * v[0] - kx * v[2], cz = kx * v[1];   // k × v
  out[0] = v[0] * c + cx * s + kx * d * (1 - c);
  out[1] = v[1] * c + cy * s;
  out[2] = v[2] * c + cz * s + kz * d * (1 - c);
  return out;
}

/** Глаз e и верх взгляда look.up — с недовёрнутым наклоном головы (вокруг ног). */
function tiltView(w, e, look) {
  if (!w.upFrom) return;
  const u = tiltUp(w, _tv);
  for (let i = 0; i < 3; i++) _to[i] = e[i] - w.pos[i];
  rotFromUp(u, _to, _to);
  for (let i = 0; i < 3; i++) e[i] = w.pos[i] + _to[i];
  rotFromUp(u, look.up, look.up);
}

/**
 * Ноги поставлены на пороге не ровно туда, куда пришли (на опору, в
 * сторону от косяка, enterAt) — глаз остаётся, где был, и догоняет их, как
 * на ступени: иначе он прыгал на высоту порога и на подправку вбок.
 */
function settleAt(w, at, p) {
  w.lag += at.pos[1] - p[1];
  w.lagX = (w.lagX || 0) + at.pos[0] - p[0];
  w.lagZ = (w.lagZ || 0) + at.pos[2] - p[2];
}

/** Взгляд и скорость — в новые оси (поворотом), чтобы шаг через порог не дёргал голову. */
function reframe(w, rot) {
  // Верх, каким его видит глаз сейчас (с недовёрнутым прошлым), — в новые
  // оси: от него голова и довернётся.
  w.upFrom = rot(tiltUp(w, _tu), [0, 0, 0]);
  w.upT = 0;
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
  if (!w.on || w.phase !== 'walk' || !I) return;
  if (!w.out) {
    const V = aboardVessel();
    const air = V.own ? I.air : V.air;
    if (!air) return;
    const hx0 = pastSkin(air, w.pos);
    const hx = hx0 && hx0.exitOk ? hx0 : null;
    // Вездеход в трюме: с его порога сходят не на грунт, а в трюм носителя.
    // Носителя ещё не видно (снимок не пришёл, помещения грузятся) — с
    // порога не сходят вовсе: «наружу» здесь — внутрь корпуса над грунтом,
    // и пилот падал сквозь трюм.
    // Плита носителя у грунта — машина по сути на грунте, и из двери выходят
    // наружу, как с любого трапа: в осях корабля грунта нет вовсе, и трап,
    // доставший за край плиты, ставил ногу в пустоту — пилот падал под землю.
    // На саму плиту с трапа переводит обычный шаг с грунта (ontoBay).
    const H = hangarOf(V);
    const down = H && bayDown(hangarBay(H.air));
    if ((H && !down) || (!H && inHangar(V))) {
      if (H && hx) stepAcross(w, V, H.V, H.air);
      return;
    }
    // С опущенной платформы сходят с любого края, как с трапа — с его конца.
    const bx = hx ? null : pastBay(air, w.pos);
    // В трюме — в дверь вездехода, что в нём стоит.
    if (!hx && !bx && stepIntoHangarRover(w, V)) return;
    const body = vesselBody(V);
    // Падает ниже грунта под кораблём — в осях корабля грунта нет вовсе, и
    // падение было бы без конца: так пилот и оказался на −60 м под полом
    // трюма (плита ушла из-под ног, а он стоял на её кромке). Дальше — в осях
    // грунта: грунт его и поймает, на любую высоту (js/game/walker.js).
    // И падающий за бортом — с любой высоты, а не у самого грунта: люк без
    // трапа на висящем корабле, край висящей плиты.
    const fall = !hx && !bx && body && !w.ground && w.vel[1] < 0 && (belowGround(V, w.pos) || outsideHull(air, w.pos));
    if ((!hx && !bx && !fall) || !body) return;
    vesselPoint(V, w.pos, _feetW);
    // На трап — в его осях, то есть корабля: в проёме ничего не поворачивается
    // (тело на пороге в тех же осях, что и в шлюзе). В оси тела — у пяты,
    // на открытом месте (retrap). С плиты и при падении — сразу в оси тела.
    const G = hx && hx.stair >= 1 ? makeVesselFrame(body, _feetW, V) : makeGroundFrame(body, _feetW, V.basis.fwd);
    // В прыжке встать не на что — переходят в воздухе, как есть (enterAt).
    const at = enterAt(outsideFrame(G, _q0), _q0, w.height, !w.ground);
    if (!at && hx && hx.h.side * w.pos[0] < hx.h.skin + SILL_OUT) return;
    shipToGround(G, V, _outT);
    reframe(w, shipDirToGround);
    w.pos = at ? at.pos : worldToGround(G, _feetW);
    // Ноги в новых осях поставлены на опору — глаз остаётся, где был, и
    // догоняет их, как на ступени (w.lag): иначе он прыгал на высоту порога.
    if (at) { w.height = at.height; settleAt(w, at, _q0); }
    w.out = G;
    w.room = null;
    w.vessel = null;
    w.air = null;
    game.frame = ownVessel;
    game.walkRoomT = 3;
    placePilot();
    save();
    return;
  }
  if (!I.air) return;
  // Встал на трап — в его оси (корабля); сошёл с него — в оси тела. Тело
  // поворачивается на наклон корабля здесь, у пяты трапа, где над головой
  // небо, а не в проёме двери, где ему тесно (js/game/outside.js,
  // makeVesselFrame).
  const trap = trapUnder(w);
  if (trap !== (w.out.trap || null) && retrap(w, trap)) return;
  groundToWorld(w.out, w.pos, _feetW);
  for (const V of nearVessels(vesselsHere(), _feetW, OUT_NEAR, _nearV)) {
    const air = V.own ? I.air : V.air;
    if (!air) continue;
    // Планировка — ТОГО корабля, в чей тоннель шагаем (air.I), а не того,
    // с чьей палубы пилот сошёл. Снаружи I — это всегда свой корабль, и у
    // соседа другого типа комнат с такими именами нет вовсе: tunnelAt
    // искал его люк в НАШИХ помещениях (roomById[h.lock] — undefined) и
    // ронял кадр целиком. Хватало встать на грунт рядом с «Прометеем» —
    // хоть соседа, хоть NPC: шлюзы заводятся всем, кто рядом.
    const J = air.I;
    shipToGround(w.out, V, _outT);
    const p = groundPointToShip(_outT, w.pos, [0, 0, 0]);
    // На опущенную платформу ступили с грунта — пилот снова в осях корабля:
    // она часть корабля, и везёт его наверх уже его палуба.
    const bx = ontoBay(air, p);
    if (bx) {
      const at = enterAt(deckWorld(w, J, air), p, w.height, !w.ground);
      if (!at) continue;
      reframe(w, groundDirToShip);
      settleAt(w, at, p);
      w.pos = at.pos;
      w.height = at.height;
      boardVessel(V);
      w.room = J.roomById[bx.room] || J.roomAt(p);
      game.walkRoomT = 2.6;
      if (!V.own) say(game.state, L('НА БОРТУ: КОРАБЛЬ ') + (V.name || L('ПИЛОТА')), '#9fd9ff', 3);
      placePilot();
      save();
      return;
    }
    if (!tunnelAt(air, J, p)) continue;
    const at = enterAt(deckWorld(w, J, air), p, w.height, !w.ground);
    if (!at) continue;
    reframe(w, groundDirToShip);
    settleAt(w, at, p);
    w.pos = at.pos;
    w.height = at.height;
    boardVessel(V);
    w.room = J.roomAt(p);
    game.walkRoomT = 2.6;
    if (!V.own) say(game.state, L('НА БОРТУ: КОРАБЛЬ ') + (V.name || L('ПИЛОТА')), '#9fd9ff', 3);
    placePilot();
    save();
    return;
  }
  // Далеко от начала осей — перенести их к пилоту: кривизна тела.
  if (!w.out.trap && Math.hypot(w.pos[0], w.pos[2]) > RECENTER) {
    groundToWorld(w.out, w.pos, _feetW);
    const fw = groundDirToWorld(w.out, [0, 0, 1]);
    const G = makeGroundFrame(w.out.body, _feetW, fw);
    w.pos = worldToGround(G, _feetW);
    w.out = G;
  }
}

// Трап, на ступенях которого пешеход (его корабль) — или null. Уже стоит на
// трапе — держится за него с запасом TRAP_KEEP: у края не перескакивать из
// осей в оси туда-обратно.
const TRAP_KEEP = 0.4;
const _trapP = [0, 0, 0], _trapT = { R: new Float64Array(9), t: [0, 0, 0] };
function trapUnder(w) {
  groundToWorld(w.out, w.pos, _feetW);
  const cur = w.out.trap || null;
  for (const V of nearVessels(vesselsHere(), _feetW, OUT_NEAR, _nearV)) {
    const air = V.own ? ownAir() : V.air;
    if (!air) continue;
    shipToGround(w.out, V, _trapT);
    groundPointToShip(_trapT, w.pos, _trapP);
    const m = V === cur ? TRAP_KEEP : 0;
    for (const hx of air.hatches) if (onStair(hx, _trapP, m)) return V;
  }
  return null;
}

const _rg0 = { G: null }, _rg1 = { G: null }, _rgw = v3();
/** Направление в одних осях грунта -> в другие (переход на трап и с него). */
function groundDirAcross(d, out) {
  groundDirToWorld(_rg0.G, d, _rgw);
  return worldDirToGround(_rg1.G, _rgw, out);
}

/**
 * Перейти в оси трапа корабля V (или, V = null, в оси тела) — там же, где
 * ноги: точно, а взгляд доворачивается (reframe). Не помещается — остаться.
 */
function retrap(w, V) {
  const G0 = w.out;
  groundToWorld(G0, w.pos, _feetW);
  const G = V ? makeVesselFrame(G0.body, _feetW, V) : makeGroundFrame(G0.body, _feetW, groundDirToWorld(G0, [0, 0, 1]));
  const at = enterAt(outsideFrame(G, _q0), _q0, w.height, !w.ground);
  if (!at) { outsideFrame(G0, w.pos); return false; }
  _rg0.G = G0; _rg1.G = G;
  reframe(w, groundDirAcross);
  w.pos = at.pos;
  w.height = at.height;
  settleAt(w, at, _q0);
  w.out = G;
  return true;
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
    bay: bayHint(),
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
/** Подсказка у пульта платформы: что сделает E. */
function bayHint() {
  const at = game.walkBay;
  if (!at) return null;
  const bx = at.bx, V = aboardVessel();
  const key = Q.touchUi ? L('«ЛЮК»') : 'E';
  const air = V.own ? ownAir() : V.air;
  if (!V.own) {
    return [key + (bx.want ? L(' — ПОПРОСИТЬ ПОДНЯТЬ ПЛАТФОРМУ') : L(' — ПОПРОСИТЬ ОПУСТИТЬ ПЛАТФОРМУ'))
      + ' · ' + (V.name || L('ПИЛОТ')), bx.want ? AIR_AMBER : AIR_GREEN];
  }
  if (bx.want) return [key + (at.kind === 'call' ? L(' — ВЫЗВАТЬ ПЛАТФОРМУ НАВЕРХ') : L(' — ПЛАТФОРМА НАВЕРХ')), AIR_AMBER];
  if (air && air.bayBlock) return [air.bayBlock, AIR_RED];
  return [key + (at.kind === 'call' ? L(' — ОТПРАВИТЬ ПЛАТФОРМУ ВНИЗ') : L(' — ПЛАТФОРМА ВНИЗ')), AIR_GREEN];
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
  closeLayers();
  game.zoom = 1;
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
  ship.berth = null;
  ship.dockPose = null;
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

// --- цель ----------------------------------------------------------------------
//
// Цель ОДНА: тело, станция, город, метка, пилот, NPC — или чужая система
// (js/game/target.js). J (и B — та же клавиша) прыгает к тому, что в
// цели: к системе — варпом, к остальному — квантовым приводом. Backspace
// цель снимает. Карта (js/ui/map.js) зовёт эти же три действия.

game.selectTarget = (t) => selectTarget(t);
function selectTarget(t) { return pickInSystem(game, t); }

/** Цель — чужая система: hop — ближайший прыжок, route — весь путь или null. */
game.targetSystem = (hop, route = null) => targetSystem(game, hop, route);

/** Снять цель — любую. Начатый прыжок не обрывается: это делает J. */
game.clearTarget = () => {
  const had = clearTarget(game);
  say(game.state, had ? L('ЦЕЛЬ СНЯТА') : L('ЦЕЛЬ НЕ ВЫБРАНА'), had ? '#9fd9ff' : '#ffcc66');
};

function dropWarpTarget() { dropWarp(game); }

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
    // Где на полу зала: площадка и поза в осях станции (js/game/berth.js).
    // Пишет её сервер действием стыковки (Stations::dock), а здесь — для
    // того, кто раскладывает сохранение (applyState).
    berth: ship.dockedAt && ship.dockPose ? { pad: ship.berth ? ship.berth.pad : null, pose: ship.dockPose } : null,
    // Стоянка на поверхности хранится в локальных осях тела: мировые
    // координаты через сутки указывали бы в пустоту.
    landed: ship.landedAt
      ? { id: ship.landedAt.id, pose: ship.landedPose, secured: ship.secured }
      : null,
    // ...и место в ПОЛЁТЕ — по той же причине и в тех же осях
    // (js/game/anchor.js). Мир при входе ставится на серверное «сейчас»,
    // а корабль — туда, где он был записан: за час между этими двумя
    // моментами грунт Lave IV уезжает на восемьсот километров.
    // В зале станции — в её осях: станция вращается, и место в осях
    // планеты при входе оказалось бы в стене зала.
    anchor: game.state.mode === ST.FLIGHT
      ? (ship.berth ? stationAnchor(ship.berth.st) : shipAnchor(game.capture, ship)) : null,
    gear: ship.gear.out,
    // Открытые люки: корабль, который хозяин оставил с открытым трапом,
    // так и стоит — и в него можно зайти.
    hatches: ship.hatchesWant ? ship.hatchesWant.slice()
      : openHatches(ownAir()),
    // Вездеход, приписанный к трюму: стоит ли он в нём (место тогда пишет
    // сервер — место носителя, Players::stowSave).
    stowed: HULL.ground && game.rover && game.roverLink.carrier !== null ? game.rover.mode === 'hangar' : undefined,
  };
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** Место в зале станции — в её осях (км), как якорь у тела (js/game/anchor.js). */
function stationAnchor(st) {
  const z = { x: 0, y: 0, z: 0 };
  return {
    id: st.id,
    pos: toLocal(st.basis, st.pos, ship.pos, v3()),
    fwd: toLocal(st.basis, z, ship.basis.fwd, v3()),
    up: toLocal(st.basis, z, ship.basis.up, v3()),
  };
}

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
 * Сохранить — на сервер, фоном. Местной копии нет: правда одна, и она
 * на сервере; без него игра не идёт вовсе (js/boot.js).
 *
 * Место пилота и порт сохранение НЕ меняет — только позу там, где пилот
 * уже есть (см. «место на сервере» выше): оно опаздывает.
 * @param now не ждать очереди и дождаться ответа (пересадка в другой корабль)
 */
function save(now = false) {
  const data = savePayload();
  // Свой корабль в другой системе — его место серверу не пишем: где он
  // стоит, сервер знает лучше нас (мы его давно не видели).
  const out = ship.away ? Object.assign({}, data, { ship: null }) : data;
  // Уходит фоном и не чаще, чем нужно (js/net/session.js).
  if (now) { session.dirty = out; return flushSaveNow(); }
  queueSave(out);
  return null;
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
 * Источник один — состояние сервера (serverToSave): при входе, после
 * гибели, буксира, пересадки. Раскладывает его этот один код.
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
  // Цель одна: система, если записана она (в старых сейвах бывали обе, и
  // J тогда вёл к системе), иначе — то, что было в цели в системе.
  if (game.warpTarget) clearNavTarget(game.nav);
  else selectTarget(targetById(world, s.target));
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
    // Где на полу зала: поза из базы, а без неё — на площадку, которую
    // назвал сервер, или на первую подходящую.
    const pose = rec.berth && rec.berth.pose && rec.berth.pose.pos ? rec.berth.pose : null;
    const n = rec.berth && typeof rec.berth.pad === 'number' ? rec.berth.pad : firstPad(dockedStation);
    ship.dockPose = pose || padPose(dockedStation.layout, n);
    ship.berth = { st: dockedStation, pad: rec.berth && rec.berth.pad !== undefined ? rec.berth.pad : n };
    ship.gear.out = true;
    ship.gear.t = 1;
    placeDocked(ship, dockedStation, ship.dockPose);
    game.state.mode = ST.DOCKED;
    return 'docked';
  }
  // Место в зале станции — в её осях: стены зала стоят относительно
  // станции, а не планеты.
  if (rec.anchor && anchorOk(rec.anchor)) {
    const host = findStation(rec.anchor.id);
    if (host) {
      const P = v3(), f = v3(), u = v3();
      toWorld(host.basis, host.pos, rec.anchor.pos, P);
      dirToWorld(host.basis, rec.anchor.fwd, f);
      dirToWorld(host.basis, rec.anchor.up, u);
      const b = makeBasis();
      lookAlong(b, f, u);
      placeShip(ship, P, b);
      if (insideAt(host, ship.pos)) ship.berth = { st: host, pad: null };
      game.state.mode = ST.FLIGHT;
      return 'flight';
    }
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
  // Вездеход: к трюму какого корабля приписан и стоит ли в нём сейчас
  // (js/game/hangar.js). Применяет это шаг вездехода (groundStep, fresh).
  game.roverLink = { carrier: typeof sh.carrier === 'number' ? sh.carrier : null, stowed: !!sh.stowed, fresh: true };
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
      berth: pos.berth || null,
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
  // Гнёзд у крейсера пять: болты идут из всех башен по очереди, и темп —
  // впятеро (server/data/specs.php, gunMounts).
  const fired = fireGuns(game.guns, ship, gunTarget(), HULL.guns, _fired, SHIP.gunMounts || 1);
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
    if (ev.dead) {
      say(game.state, L('ЦЕЛЬ УНИЧТОЖЕНА'), '#78e08f', 4);
      // Следом придёт boom о том же корабле — второй строкой о нём
      // говорить незачем.
      game.lastKill = ev.id;
    }
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
  if (ev.t === 'scan') {
    // NPC подлетел на километр и разглядывает нас (server/src/Npc.php,
    // inspect): сказать об этом — половина того, ради чего он подлетел.
    say(game.state, L('ВАС СКАНИРУЕТ · ') + (ev.name || 'NPC'), '#e3d6a0', 4);
    return;
  }
  if (ev.t === 'boom') {
    // Видели корабль — видим и гибель: огонь по его габариту.
    const V = game.peers.find((p) => p.id === ev.id);
    if (V) wreckFx(game.guns, V.pos, V.radius);
    if (ev.npc) {
      // NPC погиб — его больше нет нигде (server/src/Traffic.php), и
      // ждать, пока он истечёт по PEER_TTL, незачем.
      dropPeer(peerStore, ev.id);
      if (ev.id !== game.lastKill) {
        say(game.state, L('КОРАБЛЬ УНИЧТОЖЕН · ') + (V ? V.name : ''), '#ffcc66', 3);
      }
      return;
    }
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
 * Буксир — решение сервера (Fuel::rescue): он переставляет пилота в
 * порт, берёт тариф и доливает бак до резерва, а игра забирает
 * состояние, как после гибели.
 */
game.rescue = async () => {
  game.rescueArmed = 0;
  if (ship.dockedAt) return;
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
  game.rescueArmed = CONFIRM_S;
  say(game.state, L('U ЕЩЁ РАЗ — АВАРИЙНЫЙ БУКСИР ДО ПОРТА · ДО 600 КР'), '#ffcc66', CONFIRM_S);
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
  // Связь пропала — игра встанет и дождётся её (linkHeld), а состояние
  // заберёт, как только сервер ответит.
  if (!st) { game.resync = true; return; }
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
  // Сочетание Ctrl+Пробел держит пробел и Ctrl, пока их не отпустят.
  if (!input.isDown('Space')) game.spaceCombo = false;
  if (!input.isDown('ControlLeft', 'ControlRight')) game.ctrlCombo = false;
  // Тяга в миг нажатия Ctrl — до того, как он успел её убавить.
  if (input.pressed('ControlLeft', 'ControlRight')) game.ctrlThrottle = ship.throttle;
  else if (!input.isDown('ControlLeft', 'ControlRight')) game.ctrlThrottle = null;

  if (input.pressed('Backquote')) dbg.on = !dbg.on;

  // Нажатие колеса — приближение ×2 → ×4 → ×8 → обычный вид: в полёте,
  // на грунте и пешком. В меню, на карте, в справке и на плане палубы
  // колесо своё, и вид под ними не трогается.
  if (input.pressed('MouseMiddle') && !layerOpen() && !game.deckMap.open
      && (game.walk.on || st.mode === ST.FLIGHT || st.mode === ST.LANDED)) {
    game.zoom = nextZoom(game.zoom);
    say(st, game.zoom > 1 ? L('ПРИБЛИЖЕНИЕ ×') + game.zoom : L('ОБЫЧНЫЙ ВИД'), '#9fd9ff', 1.5);
  }

  // Список пилотов — вне разбора режимов и без захвата управления: его
  // смотрят на ходу, решая, куда лететь, а не вместо полёта.
  if (input.pressed('KeyP')) game.showPilots = !game.showPilots;

  // Звук. Клавиши намеренно вне разбора режимов ниже: выключать гул
  // надо и на карте, и в порту, а не только в полёте.
  if (input.pressed('KeyN')) {
    game.audio.on = !game.audio.on;
    sound.setMuted(!game.audio.on);
    say(st, game.audio.on ? L('ЗВУК ВКЛЮЧЁН') : L('ЗВУК ВЫКЛЮЧЕН'));
    save();
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
  // Бортовой терминал вне порта забирает клавиши целиком — и в кресле, и
  // на ногах: разделы листают Q/E, а не ходят и не крутят корабль.
  if (game.menu.open) {
    const act = terminalKeys(game, input, portSeat());
    if (act === 'close') game.closeTerminal();
    else if (act === 'map' && !game.walk.on) { game.closeTerminal(); game.openMap(); }
    else if (act === 'stand') game.rise();
    else if (act === 'launch') game.launch(true);
    return;
  }
  if (game.walk.on && !game.help) { walkKeys(); return; }

  // В тоннеле не работает ничего, кроме звука: карта чужой системы —
  // это карта того, чего сейчас нет (половину прыжка мир вообще не
  // собран), а справка и смена вида просто вернули бы игрока в кадр,
  // которого не рисуется.
  if (game.warp.phase === 'tunnel') {
    // Привод уходит в прыжок сам, когда корабль доцентровался, — и может
    // сделать это при открытом меню. Оставить его открытым нельзя:
    // клавиши в тоннеле не разбираются вовсе, и закрыть меню было бы
    // нечем до самого прибытия. Карта и справка — так же.
    game.menu.open = false;
    if (game.help) hideOverlay();
    closeLayers();
    return;
  }

  // Ctrl+Пробел — управление мышью ⇄ клавишами. Пробел этого нажатия —
  // не форсаж и не взлёт, пока его не отпустят, а Ctrl, зажатый ради
  // сочетания, тягу не трогает: она возвращается к той, что была до него.
  if (input.pressed('Space') && input.isDown('ControlLeft', 'ControlRight') && !layerOpen()
      && (st.mode === ST.FLIGHT || st.mode === ST.LANDED)) {
    game.spaceCombo = true;
    game.ctrlCombo = true;
    if (game.ctrlThrottle !== null) ship.throttle = game.ctrlThrottle;
    toggleMouseFlight();
    return;
  }

  // Справка: закрыть её — и только. Ручки отпущены, корабль летит.
  if (game.help) {
    if (input.pressed('KeyH')) game.closeOverlay();
    return;
  }
  // Карта — единственный слой, где работают мышь и колесо, поэтому её
  // ввод разбирается целиком в js/ui/map.js, а не здесь.
  if (game.map.open) {
    if (input.pressed('KeyM', 'Escape')) closeMap();
    else if (input.pressed('KeyH')) openHelp();
    else {
      // Действие с карты (кнопка, клавиша, касание) исполняется тем же
      // кодом, что B и J в полёте: проверки и отказы у них одни.
      const act = mapInput(game, input) || game.map.touchAct;
      game.map.touchAct = null;
      if (act === 'close') closeMap();
      else if (act === 'jump') {
        closeMap();
        if (st.mode === ST.FLIGHT) jumpKey();
        else say(st, L('ПРЫЖКИ — ТОЛЬКО В ПОЛЁТЕ'), '#ffcc66');
      }
    }
    return;
  }
  // Терминал — в полёте, на грунте и в порту (там — с разделами порта).
  if (input.pressed('KeyI') && (st.mode === ST.FLIGHT || st.mode === ST.LANDED || st.mode === ST.DOCKED)) {
    game.openTerminal();
    return;
  }

  // Справка и карта — и в порту: терминал под ними прячется сам и
  // возвращается, когда их закроют (terminalFrame).
  if (input.pressed('KeyH')) {
    if (st.mode === ST.FLIGHT || st.mode === ST.LANDED || st.mode === ST.DOCKED) openHelp();
    return;
  }

  if (input.pressed('KeyM')) {
    if (st.mode === ST.FLIGHT || st.mode === ST.LANDED || st.mode === ST.DOCKED) game.openMap();
    return;
  }

  // Y — встать с кресла: в полёте, на грунте и в порту.
  if (input.pressed('KeyY') && (st.mode === ST.FLIGHT || st.mode === ST.LANDED || st.mode === ST.DOCKED)) {
    game.rise();
    return;
  }

  if (st.mode === ST.DOCKED) {
    // Корабль стоит на площадке в зале. Отрыв — как с грунта: подержать
    // пробел три секунды (случайным нажатием не взлетают); C — вылет
    // докинг-компьютером до самого створа.
    if (input.pressed('KeyV')) st.view = st.view === 'cockpit' ? 'chase' : 'cockpit';
    if (input.pressed('KeyO')) toggleLights(st);
    if (input.pressed('KeyC')) { game.launch(true); return; }
    const held = input.isDown('Space') && !game.spaceCombo;
    if (held) {
      game.landHold += dt;
      if (game.landHold >= LAND.holdOff) { game.landHold = 0; game.launch(); }
    } else {
      game.landHold = 0;
    }
    return;
  }
  // Буксир вызывают и с грунта: пустой бак на луне — тот же тупик.
  if (st.mode === ST.FLIGHT || st.mode === ST.LANDED) rescueKey();
  if (st.mode === ST.LANDED) {
    // Одна клавиша на два действия, и разводятся они временем:
    // коротко нажал — зафиксировал корабль, подержал три секунды —
    // оторвался. Взлёт случайным нажатием не делается.
    // Пробел, ушедший на Ctrl+Пробел, — не фиксация и не взлёт.
    const held = input.isDown('Space', 'Enter') && !game.spaceCombo;
    // Нажатие считаем и по факту удержания, и по событию: очень короткое
    // нажатие успевает начаться и кончиться внутри одного кадра, и по
    // одному isDown его не видно вовсе.
    const tapped = input.pressed('Space', 'Enter') && !game.spaceCombo;
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
    if (!t) { say(st, L('НАВЕДИ НОС НА ЦЕЛЬ · BACKSPACE — СНЯТЬ ЦЕЛЬ'), '#ffcc66'); return; }
    // Взяли цель в системе — система больше не цель (pickTarget уже
    // переставил номер в списке, остаётся снять варп).
    dropWarpTarget();
    game.lastTarget = t;
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

  // Backspace — снять цель: любую, и систему тоже.
  if (input.pressed('Backspace')) game.clearTarget();

  // Вездеход: из полётных клавиш у него только фары. Приводов, стыковки,
  // посадки, шасси, гасителей и оружия на колёсах нет — и клавиши, которые
  // молча ничего бы не делали, здесь просто не разбираются.
  if (SHIP.ground) {
    if (input.pressed('KeyO')) toggleLights(st);
    return;
  }

  // Левая кнопка мыши — огонь. Карданное оружие само доворачивает ствол
  // к выбранному пилоту; цели нет — бьёт по оси корабля. Удержание, а не
  // нажатие: очередь задаёт перезарядка, а не скорость пальца.
  if (input.mouse.left && st.mode === ST.FLIGHT) fireNow();

  // B — то же, что J: прыжок к цели. Раньше B был квантовым приводом, а J
  // — варпом, и при выбранной системе две клавиши вели в разные места.
  if (input.pressed('KeyB')) jumpKey();

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
      if (!t) { say(st, L('ЦЕЛЬ НЕ ВЫБРАНА · TAB — ВЗЯТЬ ТО, НА ЧТО НАВЕДЁН НОС'), '#ffcc66'); return; }
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
            say(st, L('ОБХОД ЧЕРЕЗ ') + hop.name + L(' — J ЕЩЁ РАЗ'), '#ffcc66', 4);
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

  // J — ПРЫЖОК. Одна клавиша на оба привода (и B — она же).
  //
  // Для игрока различие приводов техническое: он хочет «лететь к тому, что
  // выбрал», а каким приводом — дело корабля. J смотрит, что в цели: чужая
  // система — варп, остальное — квантовый привод. Система в цели стоит
  // отметкой на экране с самого выбора (drawWarpAim).
  //
  // Порядок ветвей значим: J всегда отменяет ТО, ЧТО УЖЕ ИДЁТ, и только
  // на холодную решает, куда лететь. Иначе «отменить» пришлось бы искать
  // на другой клавише, и это была бы та же развилка, только хуже.
  if (input.pressed('KeyJ')) jumpKey();

  function jumpKey() {
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
  if (input.pressed('KeyO')) toggleLights(st);

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
    else if (ship.berth && ship.berth.out) {
      // Оторвался от площадки сам — компьютер доводит до створа.
      startLaunchComputer(ship, ship.berth.st);
      say(st, L('ДОКИНГ-КОМПЬЮТЕР: ВЫЛЕТ'), '#78e08f');
    } else {
      const t = currentTarget(game.nav);
      // В зале — та станция, в которой корабль: к площадке.
      const station = ship.berth ? ship.berth.st : (t && t.isStation ? t : nearestStation());
      if (!station) say(st, L('СТАНЦИЙ ПОБЛИЗОСТИ НЕТ'), '#ff7a66');
      else {
        askPad(station);
        const pad = game.padAssign && game.padAssign.st === station ? game.padAssign.n : null;
        const res = startDockingComputer(ship, station, pad);
        if (!res.ok) say(st, res.reason, '#ff7a66');
        else say(st, L('ДОКИНГ-КОМПЬЮТЕР: ') + station.name + (pad ? L(' · ПЛОЩАДКА ') + pad : ''), '#78e08f');
      }
    }
  }

  // Любое ручное вмешательство отключает автоматику. Привода это не
  // касается: на калибровке ручка как раз и нужна, чтобы навестись, а в
  // прыжке она всё равно ничего не делает.
  if (ship.docking || ship.landing) {
    // Под управлением мышью нос ведёт ручка, а W/S/A/D молчат: вмешательство
    // — это ручка за мёртвой зоной, а не нажатая буква.
    const nose = game.stick.on
      ? game.stick.locked && Math.hypot(game.stick.x, game.stick.y) > STICK.dead
      : input.isDown('KeyW', 'KeyS', 'KeyA', 'KeyD');
    if (nose || input.isDown('KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight') ||
      input.isDown('KeyR', 'KeyF', 'Space') || input.pressed('KeyX', 'KeyZ', 'KeyT')) {
      if (ship.docking) stopDockingComputer(ship);
      if (ship.landing) stopLanding(ship);
      say(st, L('РУЧНОЕ УПРАВЛЕНИЕ'));
    }
  }
}

/** Фары: включить или выключить — у корабля и у вездехода. */
function toggleLights(st) {
  ship.lights = !ship.lights;
  say(st, ship.lights ? L('ФАРЫ ВКЛЮЧЕНЫ') : L('ФАРЫ ВЫКЛЮЧЕНЫ'), ship.lights ? '#ffe9a8' : null);
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

// --- вездеход: наземный корабль (js/game/rover.js) ----------------------------------
//
// Командует пилот вездеходом — игра ведёт его, а не корабль: тот же ship,
// но вместо лётной модели колёса (SHIP.ground приходит из каталога, тип
// rover). Его место — в осях тела, на котором он стоит (rover.lp, lb), а в
// мир оно переводится каждый шаг: тело вращается, и машина едет вместе с
// его грунтом. Всё, что у кораблей про полёт, — приводы, стыковка, посадка,
// шасси, гасители, буксир и топливо, — у вездехода выключено.

const rover = makeRover();
game.rover = rover;
const driveCam = makeDriveCam();
game.driveCam = driveCam;
const _rd = v3(), _roverPosts = [];
const _roverIdle = { throttle: 0, steer: 0, brake: 1 };
const _roverEnv = {
  g: 0,
  ground: (p) => {
    const g = roverGround(rover.body, p), t = plateUnder(p);
    return t !== null && (g === null || t > g) ? t : g;
  },
  water: (p) => {
    const l = Math.hypot(p.x, p.y, p.z);
    _rd.x = p.x / l; _rd.y = p.y / l; _rd.z = p.z / l;
    return waterAt(rover.body, _rd);
  },
  obstacles: _roverPosts,
};

// Плита своего носителя — поверхность и для колёс на грунте: колесо над ней
// стоит на её верху, если она ему по силам — не выше его больше чем на
// ROVER_STEP (выше — край, о который колесо упирается). Плита ложится на
// грунт самой высокой точкой, и на склоне её край висит над грунтом (в
// проверке — на 0.66 м): на такой бортик машина забирается на подвеске, с качком.
// Раньше колёса шли сквозь плиту, а машину переводили на её верх разом, на
// 60 см за кадр: ни бордюра, ни въезда — подскок. Носитель и плита — на шаг
// (groundStep), в осях тела.
const ROVER_STEP = 0.8;
let _plateCL = null, _plateBx = null;
const _pq = { x: 0, y: 0, z: 0 };
/** Радиус верха плиты под колесом p (км, оси тела) — или null: не над плитой, не по силам. */
function plateUnder(p) {
  const CL = _plateCL, bx = _plateBx;
  if (!CL || !bx) return null;
  const b = CL.basis;
  const dx = (p.x - CL.pos.x) * 1000, dy = (p.y - CL.pos.y) * 1000, dz = (p.z - CL.pos.z) * 1000;
  const x = dx * b.right.x + dy * b.right.y + dz * b.right.z;
  const y = dx * b.up.x + dy * b.up.y + dz * b.up.z;
  const z = dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z;
  if (!overBay(bx, x, z)) return null;
  const dh = bayTop(bx) - y;
  if (dh > ROVER_STEP) return null;
  _pq.x = p.x + b.up.x * dh / 1000; _pq.y = p.y + b.up.y * dh / 1000; _pq.z = p.z + b.up.z * dh / 1000;
  return Math.hypot(_pq.x, _pq.y, _pq.z);
}

/** Грунт под точкой p (оси тела, км) — нарисованный, как под ногами пешехода. */
function roverGround(body, p) {
  const l = Math.hypot(p.x, p.y, p.z);
  if (!body || !(l > 0)) return null;
  _rd.x = p.x / l; _rd.y = p.y / l; _rd.z = p.z / l;
  return groundOf(body, _rd);
}

/**
 * Стойки кораблей рядом — столбы для вездехода (оси тела, км): между ними
 * ездят, а не сквозь. Брюхо корабля выше крыши вездехода (у «Челленджера» —
 * четыре метра над грунтом), под ним проезжают.
 */
const _postW = v3();
function roverPosts(body, out) {
  out.length = 0;
  for (const V of game.peers) {
    if (!V || !V.pos || !V.gear || V.gear.t < 0.5) continue;
    if (Math.hypot(V.pos.x - ship.pos.x, V.pos.y - ship.pos.y, V.pos.z - ship.pos.z) > 0.3) continue;
    const H = hullOf(V.type || ROOMS_TYPE);
    const G = H && H.gear;
    if (!G || G.wheels || !G.legs || !G.legs.length) continue;
    G.hardpoints.forEach((hp, i) => {
      const leg = G.legs[i];
      vesselPoint(V, [hp.x * 1000, (hp.y - G.legLengths[i]) * 1000, hp.z * 1000], _postW);
      out.push({ p: bodyLocal(body, _postW), r: Math.max(leg.width, leg.pad.w) / 2 });
    });
  }
  return out;
}

/** Шаг вездехода: колёса по грунту тела, в чьём он захвате. */
function groundStep(dt) {
  const st = game.state;
  // Вездеход всегда «в ходу»: стоянки и посадки, как у корабля, у него нет.
  // И отметки стоянки тоже: из трюма он приходит с местом носителя
  // (стоянкой корабля), и она так и уходила в сохранение — при входе
  // вездеход вставал на стоянку «Челленджера», в середину его корпуса, в
  // тринадцати метрах над грунтом, и падал оттуда.
  if (st.mode === ST.LANDED) st.mode = ST.FLIGHT;
  if (ship.landedAt) { ship.landedAt = null; ship.landedPose = null; ship.secured = false; }
  if (st.mode !== ST.FLIGHT) return;
  game.statusLine = null;
  clearControls(ship);
  const body = captureBody(world, ship.pos);
  game.capture = body;
  game.entry = null;
  if (!body) { game.zone = null; return; }
  // Сервер сказал, где вездеход (вход, пересадка, страховка): в трюме или
  // на грунте. Место в трюме — заново, по памяти или посередине плиты.
  const link = game.roverLink;
  if (link.fresh) {
    link.fresh = false;
    rover.mode = link.stowed && link.carrier !== null ? 'hangar' : 'ground';
    rover.hgInit = false;
    rover.body = null;
    rover.v = 0;
  }
  // Ведёт только пилот в кресле: встал — машина на тормозе.
  const ctl = input.enabled && !game.walk.on && !layerOpen() ? {
    throttle: input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
    steer: input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
    brake: input.isDown('Space') ? 1 : 0,
  } : _roverIdle;
  if (rover.mode === 'hangar') {
    hangarStep(ctl, dt, body);
    game.zone = landingContext(world, ship);
    return;
  }
  if (rover.body !== body) {
    // Встал на это тело: место — оттуда, где он сейчас, на грунт под ним.
    placeRover(rover, body, bodyLocal(body, ship.pos), bodyLocalDir(body, ship.basis.fwd), (p) => roverGround(body, p));
  }
  _roverEnv.g = gravityAt(body, ship.pos) * 1000;
  roverPosts(body, _roverPosts);
  // Плита носителя — поверхность для колёс (plateUnder), пока она не в трюме.
  {
    const c = link.carrier !== null ? carrierOf(link.carrier) : null, bx = c && hangarBay(c.air);
    _plateBx = bx && bx.travel > 0.02 ? bx : null;
    _plateCL = _plateBx ? carrierLocal(c, body) : null;
  }
  stepRover(rover, ctl, SHIP, _roverEnv, dt);
  _plateCL = null; _plateBx = null;
  roverToWorld();
  // Заехал на плиту своего корабля, опущенную до грунта, — дальше едет по
  // ней, в осях корабля: поднимут плиту — поднимется и он.
  if (link.carrier !== null) enterHangar();
  game.zone = landingContext(world, ship);
}

// --- ангар: вездеход в трюме своего корабля (js/game/hangar.js) -------------------
//
// В трюме вездеход едет по полу носителя и упирается в его стены (stepHangar).
// Носитель — свой корабль, которым командуем, или сосед (свой спящий
// корабль, когда командуем вездеходом). Вездеходы в чужих трюмах — соседи с
// отметкой носителя (cr, server/src/Hub.php): их ставит на плиту carryPeers.

// Где вездеход стоит в трюме — по кораблям (номер -> место). Сервер знает
// только «в трюме», а не где на плите: место помнит игра, пока идёт.
const hangarSpots = new Map();

/** Носитель по номеру — свой корабль (им командуем) или сосед — и его шлюзы; не видно — null. */
function carrierOf(id) {
  if (id === null || id === undefined) return null;
  if (id === ship.id && !ship.away) {
    const air = ownAir();
    return air ? { V: ownVessel, air } : null;
  }
  for (const V of game.peers) {
    if (V.id === id && (V.carrier === null || V.carrier === undefined)) return V.air ? { V, air: V.air } : null;
  }
  return null;
}

/** Носитель корабля V, если V сейчас в его трюме (свой вездеход или сосед), — или null. */
function hangarOf(V) {
  if (V.own) return HULL.ground && rover.mode === 'hangar' ? carrierOf(game.roverLink.carrier) : null;
  return V.carried ? carrierOf(V.carrier) : null;
}

/** Стоит ли корабль V в трюме (по счёту сервера или игры), видно ли его носителя или нет. */
function inHangar(V) {
  if (V.own) return HULL.ground && rover.mode === 'hangar';
  return V.carrier !== null && V.carrier !== undefined;
}

/** Вездеходы в трюме корабля V: свой (если он там) и соседи с отметкой V. */
function hangarRovers(V, out = []) {
  out.length = 0;
  if (!V.own && HULL.ground && rover.mode === 'hangar' && game.roverLink.carrier === V.id) out.push(ownVessel);
  // Свой — только как свой: после пересадки его прежняя запись соседа
  // (спящий в трюме) живёт ещё до PEER_TTL, и трап собирался по ней.
  for (const R of game.peers) if (R.carried && R.carrier === V.id && R.id !== ship.id) out.push(R);
  return out;
}

/** Место вездехода V в трюме: свой — его, сосед — по памяти или посередине плиты. */
function spotOf(V, bx) {
  if (V.own) return rover.hg;
  let hg = hangarSpots.get(V.id);
  if (!hg) {
    const c = bayCenter(bx);
    hg = { x: c.x, y: bx.b.deck, z: c.z, yaw: 0 };
    hangarSpots.set(V.id, hg);
  }
  return hg;
}

/**
 * Вездеходы в трюмах — на места: в осях носителя, на его плите или палубе.
 * Носителя не видно (не прислан, другой системы) — не видно и вездехода:
 * место у него — место носителя, а не его собственное.
 */
function carryPeers() {
  const list = game.peers;
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const V = list[i];
    // Своя прежняя запись — не сосед: свой корабль ведёт игра.
    if (V.id === ship.id && V.carrier !== null && V.carrier !== undefined) continue;
    if (V.carrier !== null && V.carrier !== undefined) {
      const c = carrierOf(V.carrier), bx = c && hangarBay(c.air);
      V.carried = !!bx;
      if (!bx) continue;
      const hg = spotOf(V, bx);
      hg.y = hangarFloor(bx, hg.x, hg.z);
      hangarToWorld(c.V, hg, V);
      V.hg = hg;
    }
    list[n++] = V;
  }
  list.length = n;
}

const _seen = [];
/**
 * Что рисует кабина в трюмах (js/gl/cabin.js, drawHangar): каждый вездеход
 * в трюме — шлюзы носителя (по ним кабина узнаёт свой трюм), комната, место
 * и колёса.
 */
function hangarSeen() {
  let n = 0;
  const put = (V, c, hg, wheels) => {
    const bx = hangarBay(c.air);
    if (!bx) return;
    const it = _seen[n] || (_seen[n] = {});
    it.V = V; it.air = c.air; it.room = bx.room; it.hg = hg; it.wheels = wheels;
    // Шлюзы самого вездехода: открыта дверь — створка, трап и проём в шлюз.
    it.rAir = V.own ? ownAir() : V.air;
    n++;
  };
  for (const V of game.peers) {
    if (!V.carried) continue;
    const c = carrierOf(V.carrier);
    if (c) put(V, c, V.hg, null);
  }
  if (HULL.ground && rover.mode === 'hangar') {
    const c = carrierOf(game.roverLink.carrier);
    if (c) put(ownVessel, c, rover.hg, rover.wheels);
  }
  _seen.length = n;
  game.hangarSeen = _seen;
}

/**
 * Глаз в вездеходе, что стоит в трюме: носитель, его шлюзы и комната трюма
 * — сцене (js/gl/scene.js, drawHoldAround). Иначе null.
 */
game.hangarAround = () => {
  if (game.state.view !== 'cockpit') return null;
  const w = game.walk;
  const V = w.on ? (w.out ? null : aboardVessel()) : ownVessel;
  const c = V ? hangarOf(V) : null;
  const bx = c && hangarBay(c.air);
  return bx ? { V: c.V, air: c.air, room: bx.room } : null;
};

// Пол под машиной: над плитой — её верх, иначе палуба. За край опущенной
// плиты машина в трюме не выезжает: колесо, сошедшее с плиты у грунта,
// переводит её на грунт (hangarStep), пока середина ещё над плитой.
const _hgEnv = { bx: null, floor: (x, z) => hangarFloor(_hgEnv.bx, x, z), solids: null };
const _hgTry = { x: 0, y: 0, z: 0, yaw: 0 };

// --- дерево систем отсчёта: машина и её носитель — в осях тела ----------------------
//
// Стоящий корабль, его плита и машина в трюме неподвижны относительно
// тела, и пересчёт между ними идёт в его осях — без мира и без времени.
// Через мир было нельзя: шаг вездехода идёт после того, как мир сдвинулся,
// а место носителя — с прошлого кадра, и за кадр планета уезжает по орбите
// на метры. Машина прыгала на этот путь: при заезде на плиту — на 2.3 м,
// при съезде — на 13 (замер — tools/smoke.mjs, «швы переходов»). Мир —
// только чтобы нарисовать: вся машина переводится в него разом, по телу
// этого мгновения (roverToWorld).

const _cl = { pos: { x: 0, y: 0, z: 0 }, basis: { right: null, up: null, fwd: null } };
/**
 * Место носителя c в осях тела body — { pos (км), basis } — или null, если
 * он стоит не на этом теле. Свой — по стоянке, сосед — по снимку (его
 * место приходит в осях тела, js/game/peers.js, local).
 */
function carrierLocal(c, body) {
  if (!c || !body) return null;
  if (c.V.own) {
    const p = ship.landedPose;
    if (ship.landedAt !== body || !p) return null;
    _cl.pos.x = p.dir.x * p.radius; _cl.pos.y = p.dir.y * p.radius; _cl.pos.z = p.dir.z * p.radius;
    _cl.basis.right = p.right; _cl.basis.up = p.up; _cl.basis.fwd = p.fwd;
    return _cl;
  }
  return c.V.local && c.V.body === body.id ? c.V.local : null;
}

const _rl = { pos: null, basis: null };
/** Машина в трюме -> её место в осях тела (rover.lp, rover.lb), а из него — в мир. */
function roverFromHangar(CL, body) {
  if (!rover.lp || typeof rover.lp.x !== 'number') rover.lp = { x: 0, y: 0, z: 0 };
  _rl.pos = rover.lp; _rl.basis = rover.lb;
  hangarToWorld(CL, rover.hg, _rl);
  rover.body = body;
  roverToWorld();
}

/** Шаг вездехода в трюме носителя: по его полу, до его стен; съехал с плиты у грунта — на грунт. */
function hangarStep(ctl, dt, body) {
  const c = carrierOf(game.roverLink.carrier), bx = c && hangarBay(c.air);
  if (!bx) {
    // Носителя ещё не видно: хаб его не прислал или его помещения (по ним
    // знаем плиту) ещё не собраны. Стоит, где поставил сервер, — в осях
    // тела, а не мира. Мировую точку он держал, а планета уезжала по
    // орбите: после входа вездеход «падал с неба» с высоты корабля и уходил
    // под грунт. Пока ждёт, его не видно (ship.hidden, кадр): место от
    // сервера — середина корпуса носителя, а носителя в кадре может не быть.
    if (rover.body !== body) {
      rover.body = body;
      rover.lp = bodyLocal(body, ship.pos);
      frameFrom(bodyLocalDir(body, ship.basis.up), bodyLocalDir(body, ship.basis.fwd), rover.lb);
    }
    rover.v = 0; rover.vs = 0; rover.vy = 0;
    roverToWorld();
    return;
  }
  const hg = rover.hg;
  if (!rover.hgInit) {
    const s = hangarSpots.get(ship.id);
    if (s) Object.assign(hg, s); else { const m = bayCenter(bx); hg.x = m.x; hg.z = m.z; hg.yaw = 0; }
    // Сразу на пол, где поставили: падать в трюме машина умеет (въехал в
    // открытый колодец), и без этого падала бы с середины корабля.
    hg.y = hangarFloor(bx, hg.x, hg.z);
    rover.vy = 0;
    rover.hgInit = true;
  }
  _hgEnv.bx = bx;
  _hgEnv.solids = hangarSolids(c.air.I, c.air);
  _hgEnv.g = gravityAt(body, ship.pos) * 1000;
  stepHangar(rover, ctl, SHIP, _hgEnv, dt);
  const keep = hangarSpots.get(ship.id) || {};
  hangarSpots.set(ship.id, Object.assign(keep, hg));
  // Место в осях тела — от места носителя в них же (carrierLocal): по нему
  // и приборы (курс, наклон), и съезд на грунт. Носитель не на этом теле —
  // по миру, как раньше.
  const CL = carrierLocal(c, body);
  if (CL) roverFromHangar(CL, body);
  else {
    hangarToWorld(c.V, hg, ship);
    rover.body = body;
    rover.lp = bodyLocal(body, ship.pos);
    frameFrom(bodyLocalDir(body, ship.basis.up), bodyLocalDir(body, ship.basis.fwd), rover.lb);
  }
  const b = ship.basis;
  ship.vel.x = b.fwd.x * rover.v / 1000; ship.vel.y = b.fwd.y * rover.v / 1000; ship.vel.z = b.fwd.z * rover.v / 1000;
  ship.speed = Math.abs(rover.v) / 1000;
  ship.wheels = rover.wheels;
  // Колесо сошло с плиты ниже днища — дальше по грунту, в осях тела, с того
  // же места и наклона: на грунт машину не ставят разом, её колёса сходят с
  // края сами (plateUnder), как с бордюра; плита висит над грунтом — машина
  // падает (stepRover). Раньше её ставили на грунт под серединой — на 60 см
  // за кадр, а с висящей плиты не пускали вовсе — невидимой стенкой.
  if ((bayDown(bx) || bayOutside(bx)) && !wheelsOnBay(bx, hg)) {
    rover.mode = 'ground';
    rover.vy = 0;
    rover.air = false;
    save();
  }
}

/** Въезд на плиту носителя, опущенную до грунта: машина над плитой — дальше в его осях. */
function enterHangar() {
  const c = carrierOf(game.roverLink.carrier), bx = c && hangarBay(c.air);
  if (!bx || !bayDown(bx)) return;
  // В осях тела: машина (rover.lp) и носитель (carrierLocal) — без мира.
  const CL = carrierLocal(c, rover.body);
  if (!CL) return;
  const hg = worldToHangar(CL, rover.lp, rover.lb.fwd, _hgTry);
  // Все колёса уже на плите и машина на её верху (колёса въехали сами,
  // plateUnder): дальше — в осях носителя, без рывка ни вбок, ни вверх.
  if (!wheelsOnBay(bx, hg, 0.05) || bayFoot(bx, hg) !== 2 || Math.abs(hg.y - bayTop(bx)) > 0.15) return;
  // И кузов успокоился на плите: в трюме он стоит ровно по носителю, а на
  // грунте — по подвеске, и после бортика ещё качается. Переключиться на
  // качке — довернуть кабину за кадр (так было: 2.6°, глаз на 11 см).
  const u = rover.lb.up, cu = CL.basis.up;
  if (u.x * cu.x + u.y * cu.y + u.z * cu.z < Math.cos(0.3 * Math.PI / 180)) return;
  rover.mode = 'hangar';
  rover.hgInit = true;
  rover.hg.x = hg.x; rover.hg.z = hg.z; rover.hg.yaw = hg.yaw; rover.hg.y = bayTop(bx);
  save();
}

// Твёрдое вездехода в трюме — для пешехода в осях носителя: кузов (с
// проёмом двери на левом борту: в неё входят), колёса и его трап. Коробки
// — повёрнутые (ob): машина в трюме стоит, как поставили.
//
// Проём в коробках — ровно по двери, как и изнутри: где снаружи в проёме
// можно стоять, там можно и в шлюзе. Он был шире двери на четверть метра с
// каждой стороны — чтобы пешеход, идущий в стороне от оси, до двери
// дотягивался, — и пешеход вставал в проёме там, где изнутри косяк: в оси
// шлюза его не пускали, снаружи держала стена кузова — «невидимая стена».
// Теперь к двери доскальзывают по её же косяку (js/game/walker.js, SLIP).
const RD = RV.door;
const RZ0 = RD.z[0], RZ1 = RD.z[1];
const ROVER_BOXES = [
  { lo: [-0.95, 0.3, -3.36], hi: [1.27, RV.roofBar, 3.46] },
  { lo: [-1.27, 0.3, -3.36], hi: [-0.95, RV.roofBar, RZ0] },
  { lo: [-1.27, 0.3, RZ1], hi: [-0.95, RV.roofBar, 3.46] },
  { lo: [-1.27, RD.y[1], RZ0], hi: [-0.95, RV.roofBar, RZ1] },
];
for (const z of RV.wheel.z) {
  for (const s of [-1, 1]) {
    ROVER_BOXES.push({ lo: [s < 0 ? -1.86 : 1.27, 0, z - 0.62], hi: [s < 0 ? -1.27 : 1.86, 1.3, z + 0.62] });
  }
}
const _props = [], _propsT = [], _hr = [], _rAir = [];
/** Твёрдое вездеходов в трюме корабля V — в его осях (пешеходу на его палубе). */
function hangarProps(V, out = _props) {
  let n = 0;
  for (const R of hangarRovers(V, _hr)) {
    const air = R.own ? ownAir() : R.air;
    const hg = R.own ? rover.hg : R.hg;
    if (!hg) continue;
    const T = _propsT[n] || (_propsT[n] = { R: new Float64Array(9), t: [0, 0, 0] });
    hangarTransform(hg, T);
    const boxes = air ? ROVER_BOXES.concat(airSolids(air, _rAir)) : ROVER_BOXES;
    for (const s of boxes) {
      const o = out[n] || (out[n] = { lo: null, hi: null, ob: { R: null, t: null, lo: null, hi: null } });
      boxToGround(T, s, o);
      o.ob.R = T.R; o.ob.t = T.t; o.ob.lo = s.lo; o.ob.hi = s.hi;
      o.src = s;
      n++;
    }
  }
  out.length = n;
  return out;
}

const _xFrom = { V: null }, _xTo = { V: null }, _xw = v3();
/** Направление в осях одного корабля -> в оси другого (переход между ними пешком). */
function vesselDirAcross(d, out) {
  vesselDir(_xFrom.V, d, _xw);
  const b = _xTo.V.basis;
  out[0] = _xw.x * b.right.x + _xw.y * b.right.y + _xw.z * b.right.z;
  out[1] = _xw.x * b.up.x + _xw.y * b.up.y + _xw.z * b.up.z;
  out[2] = _xw.x * b.fwd.x + _xw.y * b.fwd.y + _xw.z * b.fwd.z;
  return out;
}

/**
 * Шаг пешком с борта A на борт B, минуя грунт: из трюма в дверь вездехода,
 * что стоит в нём, и с его порога — в трюм. Встать можно — переходим, нет —
 * шаг остаётся на прежнем борту до следующего кадра (как на пороге люка).
 */
function stepAcross(w, A, B, airB) {
  const J = airB.I;
  vesselPoint(A, w.pos, _feetW);
  const p = worldToVessel(B, _feetW, [0, 0, 0]);
  // Твёрдое того борта, на который шагаем: в трюме — с вездеходом в нём.
  const keep = w.props;
  w.props = B.own || !hangarOf(B) ? hangarProps(B, []) : [];
  const at = enterAt(deckWorld(w, J, airB), p, w.height, !w.ground);
  if (!at) { w.props = keep; return false; }
  _xFrom.V = A; _xTo.V = B;
  reframe(w, vesselDirAcross);
  settleAt(w, at, p);
  w.pos = at.pos;
  w.height = at.height;
  boardVessel(B);
  w.room = J.roomAt(at.pos) || null;
  game.walkRoomT = 2.6;
  placePilot();
  save();
  return true;
}

const _pR = [0, 0, 0];
/** Из трюма — в дверь вездехода, что в нём стоит: шагнул в проём его люка. */
function stepIntoHangarRover(w, V) {
  for (const R of hangarRovers(V, [])) {
    const air = R.own ? ownAir() : R.air;
    if (!air) continue;
    vesselPoint(V, w.pos, _feetW);
    if (!tunnelAt(air, air.I, worldToVessel(R, _feetW, _pR))) continue;
    if (stepAcross(w, V, R, air)) return true;
  }
  return false;
}

/** Дверь вездехода в трюме корабля V — рядом с пешеходом на его палубе (E её открывает). */
function hangarHatchNear(w, V) {
  for (const R of hangarRovers(V, _hr)) {
    const air = R.own ? ownAir() : R.air;
    if (!air) continue;
    vesselPoint(V, w.pos, _feetW);
    const hx = hatchNear(air, air.I, worldToVessel(R, _feetW, _pR), true);
    if (hx) return { hx, R };
  }
  return null;
}

/**
 * Свой корабль-носитель — приборам вездехода (js/game/rovernav.js): где он
 * и как зовётся. Не видно — null.
 */
game.roverHome = () => {
  const c = carrierOf(game.roverLink.carrier);
  if (!c || c.V.own) return null;
  return { pos: c.V.pos, name: hullName(c.V.type || ROOMS_TYPE), vessel: c.V };
};

/** Место вездехода в мир: точка, оси, скорость — для всего, что их читает. */
function roverToWorld() {
  const body = rover.body;
  if (!body) return;
  bodyWorld(body, rover.lp, ship.pos);
  bodyWorldDir(body, rover.lb.right, ship.basis.right);
  bodyWorldDir(body, rover.lb.up, ship.basis.up);
  bodyWorldDir(body, rover.lb.fwd, ship.basis.fwd);
  // Скорость — своя, по грунту (км/с): приборы кораблей меряют в км/с.
  const b = ship.basis;
  ship.vel.x = (b.fwd.x * rover.v + b.right.x * rover.vs + b.up.x * rover.vy) / 1000;
  ship.vel.y = (b.fwd.y * rover.v + b.right.y * rover.vs + b.up.y * rover.vy) / 1000;
  ship.vel.z = (b.fwd.z * rover.v + b.right.z * rover.vs + b.up.z * rover.vy) / 1000;
  ship.speed = Math.abs(rover.v) / 1000;
  // Колёса — сцене (js/gl/scene.js, drawWheelsOf).
  ship.wheels = rover.wheels;
}
game.roverToWorld = roverToWorld;

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
  // Станция, в зале которой корабль, — её оси до шага мира: корабль внутри
  // переносится вместе с ней жёстко (js/game/berth.js, carryInStation).
  const inSt = ship.berth ? ship.berth.st : null;
  if (inSt) stationFrame(inSt, _stFrame);
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

  // Вездеход — наземный корабль: вместо лётной модели колёса, и ни захвата,
  // ни приводов, ни посадки у него нет (groundStep).
  if (SHIP.ground) { groundStep(dt); return; }

  // Гравитационный захват: внутри сферы действия тела корабль
  // переносится вместе с ним (см. js/game/gravity.js). Без этого
  // «зависнуть над точкой» нельзя — поверхность уезжает из-под корабля.
  const wasCarrier = carrier;
  game.capture = captureBody(world, ship.pos);
  if (inSt && st.mode === ST.FLIGHT) {
    // В зале — вместе со станцией, а не с телом: зал вращается.
    carryInStation(ship, inSt, _stFrame);
  } else if (game.capture && st.mode === ST.FLIGHT) {
    // Замеренное смещение годится, только если тело то же самое: сменился
    // захват — считаем по скорости, шаг там всё равно кадровый.
    carryShip(ship, game.capture, dtWorld,
      game.capture === wasCarrier ? _carried : null);
  }

  if (st.mode === ST.DOCKED) {
    // Корабль стоит на полу зала и едет вместе со станцией: поза — в её
    // осях (js/game/berth.js, placeDocked).
    const s = ship.dockedAt;
    if (s && ship.dockPose) placeDocked(ship, s, ship.dockPose);
    else if (s) { ship.pos.x = s.pos.x; ship.pos.y = s.pos.y; ship.pos.z = s.pos.z; }
    game.hallInfo = s ? hallZone(ship, s, _hallZ) : null;
    game.zone = null;
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
      // Маршрут через соседей (js/game/warproute.js): прибыли в его
      // середину — следующий прыжок становится целью сам. Заправка — за
      // пилотом: в порту этой системы.
      const next = nextHop(game.warpRoute, sys);
      if (next) game.targetSystem(next, game.warpRoute);
      else { game.warpTarget = null; game.warpRoute = null; }
      audioReset(game.audio, ship);
      say(st, L('ПРИБЫТИЕ: ') + sys.name.toUpperCase(), '#78e08f', 4);
      if (next) say(st, L('МАРШРУТ: ДАЛЬШЕ — ') + next.name.toUpperCase() + L(' · J, КОГДА ХВАТИТ ТОПЛИВА'), '#ffcc66', 6);
      save();
    }
    return;
  }

  // --- в зале станции: свой полёт — тяжесть зала, стены, пол и площадки.
  if (ship.berth) { hallStep(dt); return; }
  game.hallInfo = null;

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
    readControls(ship, game.stick.on);
    // Пробел, ушедший на Ctrl+Пробел, — не форсаж, а Ctrl — не убавка тяги.
    if (game.spaceCombo) ship.control.boost = 0;
    if (game.ctrlCombo) ship.control.thr = Math.max(0, ship.control.thr);
    // Управление мышью: нос ведёт ручка (js/game/mousefly.js), W/S/A/D
    // при этом носа не трогают (readControls); крен, тяга и всё
    // остальное — клавишами, как прежде. Под слоями и без захваченной
    // мыши ручка в нуле (mouseFlightFrame).
    if (game.stick.on && game.stick.locked && input.enabled) {
      const k = stickControls(game.stick, _stickOut);
      ship.control.pitch = clamp(ship.control.pitch + k.pitch, -1, 1);
      ship.control.yaw = clamp(ship.control.yaw + k.yaw, -1, 1);
    }
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

  // Станции: вход в щель либо удар о корпус.
  for (const s of world.stations) {
    const d = Math.hypot(s.pos.x - ship.pos.x, s.pos.y - ship.pos.y, s.pos.z - ship.pos.z);
    if (d > s.radius * 2.2) continue;
    const res = checkStation(ship, s);
    if (res === 'enter') {
      // Прошёл раму — дальше в зале станции: в её осях, с её тяжестью.
      enterStation(ship, s);
      askPad(s);
      say(st, L('ВХОД В ПОРТ · ') + s.name.toUpperCase(), '#78e08f', 3);
      return;
    }
    if (res === 'crash') {
      crash(L('Удар о конструкции станции ') + s.name + '.');
      return;
    }
  }
}

/** Станция, в зале или тоннеле которой стоит корабль V, — или null. */
function hallOf(V) {
  if (V.own) return ship.berth ? ship.berth.st : (ship.dockedAt || null);
  for (const st of world.stations) {
    if (Math.hypot(st.pos.x - V.pos.x, st.pos.y - V.pos.y, st.pos.z - V.pos.z) < st.radius && insideAt(st, V.pos)) return st;
  }
  return null;
}

const _stFrame = stationFrame({ pos: v3(), basis: makeBasis() });
const _hallZ = {};

/**
 * Шаг корабля в зале станции (js/game/berth.js): тяжесть 1 g вниз по
 * станции, касание пола — посадка или удар, стены и терминал — удар.
 * Вышел за створ — снова в мировых осях.
 */
function hallStep(dt) {
  const s = game.state;
  const stn = ship.berth.st;
  game.zone = null;
  game.entry = null;
  game.nearest = null;
  if (ship.docking) {
    game.statusLine = updateDockingComputer(ship, dt);
  } else if (!game.walk.on) {
    readControls(ship, game.stick.on);
    if (game.spaceCombo) ship.control.boost = 0;
    if (game.ctrlCombo) ship.control.thr = Math.max(0, ship.control.thr);
    if (game.stick.on && game.stick.locked && input.enabled) {
      const k = stickControls(game.stick, _stickOut);
      ship.control.pitch = clamp(ship.control.pitch + k.pitch, -1, 1);
      ship.control.yaw = clamp(ship.control.yaw + k.yaw, -1, 1);
    }
  }
  updateShip(ship, dt, stationField(stn));
  burnThrust(ship);
  fuelWatch();
  game.stats.flownKm += ship.speed * dt;

  const ev = stepInStation(ship, stn, _hallZ);
  game.hallInfo = _hallZ;
  if (!ev) return;
  // Вышел за створ — снова снаружи, в мировых осях. Перенесённый далеко
  // (телепорт) уносит не вращение станции, а только её ход: ω × r на
  // тысячах километров — это не скорость, а бессмыслица.
  if (ev.left) {
    if (ev.far) {
      ship.vel.x += stn.vel.x; ship.vel.y += stn.vel.y; ship.vel.z += stn.vel.z;
      ship.berth = null;
      // Перенос отменяет и отрыв, и автоматику зала: они были про зал.
      ship.liftHold = 0;
      stopDockingComputer(ship);
    } else {
      leaveStation(ship);
    }
    if (ship.docking && ship.docking.out) {
      stopDockingComputer(ship);
      say(s, L('ВЫЛЕТ ВЫПОЛНЕН. УДАЧНОГО ПОЛЁТА.'), '#78e08f', 3);
    }
    game.padAssign = null;
    game.hallInfo = null;
    return;
  }
  const wallWhy = L('Удар о конструкции станции ') + stn.name + '.';
  if (ev.crash) { crash(ev.reason === 'wall' ? wallWhy : ev.reason); return; }
  if (ev.landed) {
    if (ev.damage) {
      ship.hull = Math.max(1, ship.hull - ev.damage);
      tellImpact(ev.impact);
    }
    settleInHall(ship, stn);
    game.stats.docks++;
    const n = ship.berth.pad;
    say(s, n ? L('СТЫКОВКА ВЫПОЛНЕНА · ПЛОЩАДКА ') + n + L(' · I — ТЕРМИНАЛ ПОРТА')
      : L('СТЫКОВКА ВЫПОЛНЕНА · ВНЕ ПЛОЩАДКИ · I — ТЕРМИНАЛ ПОРТА'), '#78e08f', 5);
    dockAt(stn);
    return;
  }
  // Удар: корпус, доклад серверу (урон считает он), звук и строка.
  ship.hull -= ev.damage;
  tellImpact(ev.impact);
  audioCue(game.audio, 'hit', { damage: ev.damage / 100 });
  const why = ev.wall ? wallWhy : ev.reason;
  if (ship.hull <= 0) { ship.hull = 0; crash(why + L(' Корпус разрушен.')); return; }
  say(s, L('УДАР · −') + Math.round(ev.damage) + L('% КОРПУСА'), ev.damage > 15 ? '#ff7a66' : '#ffcc66', 1.6);
}

// --- подготовка данных для HUD ----------------------------------------------

function prepareHud() {
  // Список целей пересобирается каждый кадр: маркеры показываются только
  // у того тела, рядом с которым корабль сейчас находится, а чужие
  // корабли появляются и исчезают сами.
  refreshNav(game.nav, world, ship, game.peers);
  const target = currentTarget(game.nav);
  // Цель пропала сама — пилот ушёл, NPC исчез: сказать. Молча гаснущая
  // рамка читается как сбой прибора.
  if (game.lastTarget && !target && !game.warpTarget) {
    say(game.state, L('ЦЕЛЬ ПОТЕРЯНА: ') + targetLabel(game.lastTarget), '#ffcc66', 3);
  }
  game.lastTarget = target;
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
    game.scanBlips.push({ pos: p.pos, color: p.npc ? NPC_COLOR : PEER, peer: true });
  }
  game.scannerRange = SCANNER_STEPS.find((r) => r > nearestDist * 1.25) || SCANNER_STEPS[SCANNER_STEPS.length - 1];

  // Помощник стыковки — когда станция рядом, а корабль ещё снаружи: в
  // зале створ позади, и ведут уже к площадке.
  game.dockAssist = null;
  const st = ship.docking ? ship.docking.station : nearestStation();
  if (st && !ship.berth && game.state.mode === ST.FLIGHT) {
    const d = Math.hypot(st.pos.x - ship.pos.x, st.pos.y - ship.pos.y, st.pos.z - ship.pos.z);
    // Порог был 30 км — за ним помощник висел пустой рамкой с красными
    // «ОСЬ/КРЕН» посреди экрана добрую минуту полёта, и читался как
    // поломка. Шесть километров — это уже подход, а не «станция где-то
    // в той стороне»: с них створ порта виден глазом.
    if (d < 6) game.dockAssist = makeDockAssist(ship, st);
  }
  // Площадка, выделенная портом, — метка в кадре, пока корабль в полёте:
  // стоящему на ней она ни к чему.
  game.padMark = null;
  const pa = game.padAssign;
  if (pa && game.state.mode === ST.FLIGHT && (ship.berth ? ship.berth.st === pa.st : true)) {
    const p = padByNo(pa.st.layout, pa.n);
    if (p) {
      const pos = stationWorldM(pa.st, [p.c[0], p.c[1] + 2, p.c[2]]);
      const dist = Math.hypot(pos.x - ship.pos.x, pos.y - ship.pos.y, pos.z - ship.pos.z);
      if (dist < 8) game.padMark = { pos, n: p.n, dist };
    }
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
const _roverLook = { x: 0, y: 0 };
function updateCamOrbit(dt) {
  // На ногах головой ведёт walkFrame: сдвиг мыши и пальца его.
  if (game.walk.on) return;
  const o = game.camOrbit;
  // Вездеход: мышь водит камеру без кнопки, как в обычных играх с
  // машинами, — снаружи облёт вокруг машины (js/game/drivecam.js), из
  // кабины — голова на шее. Мышь берётся щелчком по кадру.
  if (SHIP.ground && !ship.away) {
    input.takeLook(_roverLook);
    input.takeDrag(_drag);
    let lx = _roverLook.x, ly = _roverLook.y;
    if (input.mouse.right) { lx += _drag.x; ly += _drag.y; }
    if (Q.touchUi) {
      touchDrag(game.touch, _touchLook);
      lx += _touchLook.x * 1.6; ly += _touchLook.y * 1.6;
    }
    if (input.mouse.clicked && !input.locked && !Q.touchUi && !layerOpen()) input.lock(screenCanvas);
    const k = lookScale(game.zoom);
    if (game.state.view === 'chase') {
      stepDriveCam(driveCam, { x: lx, y: ly }, rover.v, dt, k);
    } else {
      // Знаки — как у осмотра в кабине корабля (ниже: + сдвиг): мышь
      // вправо — взгляд вправо, вниз — вниз. С минусом у наклона он был
      // перевёрнут.
      o.yaw = clamp(o.yaw + lx * LOOK * 0.55 * k, -1.92, 1.92);
      o.pitch = clamp(o.pitch + ly * LOOK * 0.55 * k, -0.95, 0.95);
    }
    return;
  }
  input.takeDrag(_drag);
  // Под управлением мышью она захвачена, и сдвиг приходит не как
  // перетаскивание, а как взгляд: с правой кнопкой он — камере.
  if (game.stick.on && input.locked && input.mouse.right) {
    input.takeLook(_stickMove);
    _drag.x += _stickMove.x; _drag.y += _stickMove.y;
  }
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
    const k = LOOK * lookScale(game.zoom);
    o.yaw = clamp(o.yaw + _drag.x * k, -yawMax, yawMax);
    o.pitch = clamp(o.pitch + _drag.y * k, -pitchMax, pitchMax);
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
  const want = zoomFov(Math.max(jump, boost, warp), game.zoom);
  // Вверх поле зрения идёт резче, чем возвращается: рывок — событие, а
  // возврат — послевкусие.
  fovNow += (want - fovNow) * Math.min(1, dt * (want > fovNow ? 10 : 5));
  if (Math.abs(fovNow - camera.fov) > 1e-5) camera.setFov(fovNow);
}

// Нарисованный грунт для камеры (см. placeChase).
const drawnGround = (body, dir) => scene.drawnGround(body, dir);

/**
 * Камера вездехода от третьего лица: облёт вокруг машины (driveCam), не
 * ниже грунта под собой — иначе на склоне за машиной она уходила бы в гору.
 */
const _dcl = { eye: [0, 0, 0], at: [0, 0, 0] }, _dce = v3(), _dca = v3(), _dcu = v3();
function placeDriveCam(cam) {
  const c = driveCamLocal(driveCam, _dcl);
  vesselPoint(ownVessel, c.eye, _dce);
  vesselPoint(ownVessel, c.at, _dca);
  const body = rover.body;
  if (body) {
    // Вверх — от центра тела: машина на склоне кренится, а горизонт нет.
    const l = bodyLocal(body, _dce);
    const ll = Math.hypot(l.x, l.y, l.z);
    _rd.x = l.x / ll; _rd.y = l.y / ll; _rd.z = l.z / ll;
    // Камера — над НАРИСОВАННЫМ грунтом, как placeChase: глазу важна картинка.
    const floor = (scene ? drawnGround(body, _rd) : groundRadius(body, _rd)) + DRIVECAM.over / 1000;
    if (ll < floor) {
      const k = floor / ll;
      bodyWorld(body, { x: l.x * k, y: l.y * k, z: l.z * k }, _dce);
    }
    bodyWorldDir(body, _rd, _dcu);
  } else {
    _dcu.x = ship.basis.up.x; _dcu.y = ship.basis.up.y; _dcu.z = ship.basis.up.z;
  }
  cam.pos.x = _dce.x; cam.pos.y = _dce.y; cam.pos.z = _dce.z;
  const d = v3(_dca.x - _dce.x, _dca.y - _dce.y, _dca.z - _dce.z);
  normalize(d, d);
  lookAlong(cam.basis, d, _dcu);
}

function setupCamera() {
  const cam = camera;
  cam.basis.right = { ...ship.basis.right };
  cam.basis.up = { ...ship.basis.up };
  cam.basis.fwd = { ...ship.basis.fwd };
  if (game.walk.on && game.walk.out && game.interior) {
    // За бортом: глаз и взгляд — в осях грунта (js/game/outside.js).
    const w = game.walk, G = w.out;
    const e = walkerEye(w, game.interior, _eyeT);
    walkerLook(w, _wLook);
    tiltView(w, e, _wLook);
    groundToWorld(G, e, cam.pos);
    groundDirToWorld(G, _wLook.fwd, _camDir);
    groundDirToWorld(G, _wLook.up, _camUp);
    lookAlong(cam.basis, _camDir, _camUp);
    return;
  }
  if (game.walk.on && game.walkEye) {
    // Глаз идущего: точка в осях корабля, взгляд — его голова. Корабль —
    // тот, по палубе которого он идёт: свой или чужой.
    const V = aboardVessel();
    walkerLook(game.walk, _wLook);
    const e = _eyeT;
    e[0] = game.walkEye[0]; e[1] = game.walkEye[1]; e[2] = game.walkEye[2];
    tiltView(game.walk, e, _wLook);
    const b = V.basis;
    cam.pos.x = V.pos.x + (b.right.x * e[0] + b.up.x * e[1] + b.fwd.x * e[2]) / 1000;
    cam.pos.y = V.pos.y + (b.right.y * e[0] + b.up.y * e[1] + b.fwd.y * e[2]) / 1000;
    cam.pos.z = V.pos.z + (b.right.z * e[0] + b.up.z * e[1] + b.fwd.z * e[2]) / 1000;
    cam.basis.right = { ...b.right };
    cam.basis.up = { ...b.up };
    cam.basis.fwd = { ...b.fwd };
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
  if (game.state.view === 'chase' && SHIP.ground && !ship.away) {
    placeDriveCam(cam);
  } else if (game.state.view === 'chase') {
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

// Курсор виден на карте и в меню пилота (см. css/style.css) — там, где
// мышью выбирают. Переключаем по изменению, а не каждый кадр: трогать DOM
// в кадре незачем. Вид курсора разный: на карте это прицел (наводятся на
// тело), в меню — обычная стрелка (жмут на закладку).
let cursorClass = '';

function render() {
  setupCamera();

  // Бортовой терминал: на экране ли он и в каком виде. Решается здесь, по
  // состоянию, а не вызовами «показать/спрятать» по всей игре: он есть,
  // пока открыт (I); под картой, справкой, крушением и в тоннеле его нет.
  {
    const st = game.state;
    // Разделы порта — в кресле корабля, стоящего в порту; на экране
    // терминал только открытый (I): корабль стоит на площадке, и пилот
    // волен смотреть в окно, встать и выйти в зал.
    const want = booted && !game.map.open && !game.help && st.mode !== ST.CRASHED
      && game.warp.phase !== 'tunnel' && game.menu.open;
    terminalFrame(game, want, portSeat());
  }

  // План палубы — мышью, как меню: стрелка (js/ui/deckmap.js).
  const wantCursor = game.menu.open || game.deckMap.open ? 'menu' : game.map.open ? 'map' : '';
  if (wantCursor !== cursorClass) {
    screenCanvas.classList.remove('map', 'menu');
    if (wantCursor) screenCanvas.classList.add(wantCursor);
    cursorClass = wantCursor;
  }

  // Под картой мир не рисуется: его не видно, а стоил бы он кадр полёта.
  // Сцену карты рисует та же видеокарта (js/gl/scene.js, renderMap) по
  // камере и списку тел карты — их считает mapFrame до отрисовки.
  if (game.map.open) {
    mapFrame(game, hud.camera.w, hud.camera.h, game.frameDt || 0);
    game.map.glDrawn = !!(scene && scene.renderMap(game, game.map));
  } else if (scene) scene.render(game);
  // Курсор на карте — по тому, что под ним: кнопка, тело, «тащу».
  const mapCursor = game.map.open ? game.map.cursor : '';
  if (screenCanvas && screenCanvas.style && screenCanvas.style.cursor !== mapCursor) screenCanvas.style.cursor = mapCursor;

  const st = game.renderStats;
  st.polys = scene ? scene.tris : 0;
  st.items = scene ? scene.draws : 0;
  st.culled = scene ? scene.culled : 0;
  st.cullOn = !!(scene && scene.cull);
  st.gpu = scene ? scene.name : null;
  // Цена кадра: его длительность, чистое время карты (если драйвер
  // отдаёт таймер) и множитель детализации, выбранный по ним
  // регулятором (js/gl/detail.js).
  st.frameMs = scene ? scene.frameMs : 0;
  st.gpuMs = scene && scene.gpuTimer && scene.gpuTimer.available ? scene.gpuTimer.ms : 0;
  st.fw = scene ? scene.fwScale : 1;
  // Мира за бортом в кадре нет: пилот в глухой комнате (js/gl/scene.js).
  st.inside = !!scene && scene.outside === false;
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
  if (game.map.open) drawMap(hud, game);
  else if (game.help) { /* справка — экраном поверх, приборы под ней не нужны */ }
  else if (game.walk.on) {
    // План палубы — вместо приборов ходьбы, а не поверх: их подсказки и
    // строки просвечивали сквозь подложку плана и мешали его читать.
    if (game.deckMap.open && game.interior) drawDeckMap(hud.ctx, hud.camera.w, hud.camera.h, game, game.interior);
    else drawWalkHud(hud, game, walkHints());
  }
  else if (game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED || game.state.mode === ST.DOCKED) drawHud(hud, game);
  // Кто ещё в игре и где — поверх приборов, но не в порту и не в справке:
  // там свои экраны целиком. И не на карте: там пилоты видны в самой
  // системе, а панель легла бы на список объектов.
  if (!game.map.open && !game.help && (game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED
    || game.state.mode === ST.DOCKED)) {
    drawPilots(hud, game);
  }
  // Меню рисуется ПОВЕРХ приборов, а не вместо них: кадр под ним живой.
  // Сенсорные органы поверх приборов, но только в полёте и на грунте:
  // в меню и на карте они мешают, а делать нечего.
  if (Q.touchUi && !layerOpen()
      && (game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED || game.state.mode === ST.DOCKED)) {
    touchDraw(hud.ctx, game.touch, touchArea, game);
  }
  if (game.fsButton) drawFullscreenButton(hud.ctx, game.fsButton, isFull());
  drawDebug(hud, game, dbg);
}

// --- цикл --------------------------------------------------------------------

// --- связь с сервером ----------------------------------------------------------
//
// Без сервера игра не идёт: ни автономного режима, ни игры «как-нибудь»
// без него. Пропала связь посреди полёта — игра СТОИТ под надписью и ждёт;
// вернулась — едет дальше с того же места.
//
// Сервер — это и API, и хаб (сокет). API либо отвечает, либо нет: вызов,
// упавший по сети, сразу переводит сессию в 'lost' (js/net/session.js).
// Хаб же может моргнуть — переподключение занимает секунды
// (js/net/socket.js), — и его обрыв короче LINK_GRACE игру не
// останавливает. До первой связи с хабом игра не начинается вовсе.
const LINK_GRACE = 5;
let hubDownSince = null;
let hubEver = false;
let wasHeld = null;

/**
 * Почему игра стоит: null — связь есть; 'login' — вход истёк; 'api' —
 * API не отвечает; 'hub' — хаб пропал; 'connect' — хаба ещё не было;
 * 'replaced' — тот же пилот вошёл в другом окне.
 */
function linkHeld(t) {
  if (session.mode === 'none') return 'login';
  if (session.mode !== 'online') return 'api';
  if (net.state === 'live') { hubDownSince = null; hubEver = true; return null; }
  if (net.errorCode === 'replaced') return 'replaced';
  if (hubDownSince === null) hubDownSince = t;
  if (!hubEver) return 'connect';
  return t - hubDownSince > LINK_GRACE ? 'hub' : null;
}

const LINK_TEXT = {
  api: ['НЕТ СВЯЗИ С СЕРВЕРОМ', 'Игра стоит и ждёт сервер. Пробуем снова каждые три секунды — ответит, и полёт продолжится с того же места.'],
  hub: ['НЕТ СВЯЗИ С СЕРВЕРОМ', 'Не отвечает сокет-сервер (npm run ws). Игра стоит, пока он не вернётся.'],
  connect: ['ПОДКЛЮЧЕНИЕ К СЕРВЕРУ…', 'Связь с сокет-сервером ещё не установлена. Не поднят — npm run ws.'],
  replaced: ['ИГРА ОТКРЫТА В ДРУГОМ ОКНЕ', 'Один пилот — одно окно. Здесь игра остановлена: закройте лишнее окно и обновите эту страницу.'],
};

/** Показать или убрать надпись «нет связи» (разметка — index.html, #link). */
function showLink(why) {
  const el = document.getElementById('link');
  if (!el) return;
  if (!why) { el.classList.add('hidden'); return; }
  const [title, body] = LINK_TEXT[why] || LINK_TEXT.api;
  const t = document.getElementById('linkTitle');
  const b = document.getElementById('linkBody');
  if (t) t.textContent = L(title);
  if (b) b.textContent = L(body) + (why === 'api' && session.error ? ' (' + session.error + ')' : '');
  el.classList.remove('hidden');
}

/**
 * Кадр без связи: игра стоит, картинка — последняя. true — кадр съеден.
 * Вернулась связь — время, накопленное за паузу, выбрасывается, а то, что
 * успело случиться на сервере (нас сбили, пока связи не было), забирается.
 */
function holdForLink(t) {
  retryLink();
  const why = linkHeld(t);
  if (why === 'login') {
    location.replace('login.html');
    return true;
  }
  if (why !== wasHeld) showLink(why);
  if (why) {
    if (!wasHeld) input.releaseAll();
    wasHeld = why;
    input.endFrame();
    render();
    return true;
  }
  if (wasHeld) {
    wasHeld = null;
    acc = 0;
    if (game.resync) {
      game.resync = false;
      game.respawn();
    } else {
      finishDue();
      if (game.state.mode === ST.DOCKED) showDocked(game);
    }
  }
  return false;
}

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
  // Камера карты догоняет цель по времени кадра (js/game/mapcam.js).
  game.frameDt = dt;
  tickDebug(dbg, dt);

  // Нет связи с сервером — игра стоит, пока она не вернётся (linkHeld).
  if (holdForLink(now / 1000)) {
    requestAnimationFrame(frame);
    return;
  }

  // Касания разбираются ДО управления: джойстик и кнопки должны попасть
  // в тот же кадр, что и клавиши, иначе палец отстаёт от клавиатуры на
  // кадр (на 60 Гц это заметно на посадке).
  // Управление кораблём глохнет, пока открыто меню, карта или справка:
  // нажатия (pressed) читаются всегда — ими слои и живут, — а вот
  // удержания (isDown) и сенсорные оси гасятся этим флагом. Корабль под
  // слоем летит, как летел.
  input.enabled = !layerOpen();
  if (Q.touchUi && !layerOpen()) {
    // Буксир предлагается на резерве и с пустым баком — там, где прыжков
    // уже нет (js/ui/touch.js, кнопка 'tow').
    const fl = fuelLevel(ship);
    game.touch.tow = !ship.dockedAt && (fl === 'reserve' || fl === 'dry');
    // На ногах — свой набор: идти, бежать, прыгать, сесть у кресла.
    game.touch.walk = game.walk.on;
    game.touch.seat = !!(game.interior && nearSeat(game.walk, game.interior));
    game.touch.stand = !!game.interior && !game.walk.on;
    game.touch.hatch = !!(game.walkHatch || game.walkBay);
    touchUpdate(game.touch, [...touchPoints.values()], touchArea);
    touchApply(game.touch, ship);
  }

  // Карта на телефоне — пальцами: касания идут ей, а не органам полёта
  // (их под слоем нет). Действие разбирается вместе с клавишами.
  if (Q.touchUi && game.map.open) {
    game.map.touchAct = mapTouch(game, [...touchPoints.values()]) || game.map.touchAct;
  }
  handleKeys(dt);
  mouseFlightFrame();
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
  // Корабль кадра в зале станции — свет кабины от зала, а не от солнца
  // (js/gl/cabin.js, outside).
  game.hall = hallOf(game.frame);
  airFrame(dt);
  carryBay();

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
      if (L.ship !== null && L.ship !== ride) {
        // Ушёл прыжком (NPC) — вспышка там, где его видели в последний раз.
        const V = L.q ? game.peers.find((p) => p.id === L.ship) : null;
        if (V) quantumFx(game.guns, V.pos, V.basis.fwd, false);
        dropPeer(peerStore, L.ship);
      }
      if (L.id !== null) dropPerson(peopleStore, L.id);
    }
    net.left.length = 0;
    if (net.rev !== peerRev) {
      peerRev = net.rev;
      // Свой корабль, которым командуем, приходит и без водителя (пока
      // игра его не повела), — он не чужой, и рисовать его дважды нельзя.
      ingestPeers(peerStore, ship.id === null ? net.peers : net.peers.filter((p) => p.id !== ship.id), tNow);
      ingestPeople(peopleStore, net.people, tNow);
      setNpcRange(net.npc);
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
    // NPC, только что вышедшие из прыжка (js/game/peers.js, arrivals), —
    // вспышка выхода там, где они показались.
    if (peerStore.arrivals.length) {
      for (const id of peerStore.arrivals) {
        const V = game.peers.find((p) => p.id === id);
        if (V) quantumFx(game.guns, V.pos, V.basis.fwd, true);
      }
      peerStore.arrivals.length = 0;
    }
    for (const V of game.peers) {
      vesselAir(V);
      // Шасси чужого корабля выходит с той же скоростью, что у своего;
      // корабль без водителя стоит на стойках сразу.
      if (V.dorm || V._seen === undefined) V.gear.t = V.gear.out ? 1 : 0;
      else updateGear(V, dt);
      V._seen = true;
    }
    // Вездеходы в трюмах — в осях своих носителей (js/game/hangar.js).
    carryPeers();
    // И свой — по носителю ЭТОГО кадра. Шаг вездехода ставил его по
    // носителю прошлого, а тело вращается: стоящий на нём корабль за кадр
    // уезжает в мире на метры, и трап для пешехода (по месту в трюме)
    // расходился с машиной на два с лишним метра — пилот упирался в колесо.
    // Носителя не видно — и вездехода не видно (hangarStep): иначе он
    // висел бы над грунтом в середине ещё не пришедшего корабля.
    ship.hidden = false;
    if (HULL.ground && rover.mode === 'hangar') {
      const c = carrierOf(game.roverLink.carrier), bx = c && hangarBay(c.air);
      if (bx && rover.hgInit) {
        const CL = carrierLocal(c, rover.body);
        if (CL) roverFromHangar(CL, rover.body); else hangarToWorld(c.V, rover.hg, ship);
      }
      ship.hidden = !bx;
    }
    hangarSeen();
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


  updateMessages(game.state, dt);
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
  // У вездехода вместо ручки руль, вместо РУДа рычаг хода — за колёсами и газом.
  if (SHIP.ground) updateDriveYoke(game.yoke, rover, dt);
  // Камера садится на место мгновенно, когда корабль не летит: на
  // стоянке и в порту запаздывание было бы про то, как открылся экран.
  updateChase(game.chase, game, dt, game.state.mode !== ST.FLIGHT);
  updateFov(dt);
  // Звук идёт по времени игрока, а не по шагам физики: круизный
  // ускоритель множит перемещение, но не частоту кадров, и гул движков
  // от него меняться не должен.
  updateAudio(game.audio, game, dt);
  playAudio(game.audio, sound);
  if ((game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED || game.state.mode === ST.DOCKED) && !ship.away) prepareHud();
  // Софт мониторов — после приборов (он читает то же, что они), и только
  // когда кабина в кадре: рисовать восемь холстов для вида снаружи незачем.
  if (game.displays && game.state.view === 'cockpit' && !game.walk.out && aboardVessel().own && !ship.away
      && (game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED || game.state.mode === ST.DOCKED || game.walk.on)) {
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

  // Вход и состояние — у сервера, и только у него. Загрузчик (js/boot.js)
  // их уже дождался; проверки зовут игру напрямую, и тогда спрашиваем
  // здесь. Без входа — на страницу входа, без связи — обратно на
  // загрузчик: он ждёт сервер, а игра без сервера не идёт.
  let restored = false;
  // Ответ на сохранение несёт то, сколько сервер списал за варп: этим
  // гасится долг, который игра записала себе у звезды (js/game/fuel.js).
  session.onSaved = (r) => { if (r && r.warpFuel > 0) warpSettled(ship, r.warpFuel); };
  if (session.mode !== 'online') {
    const mode = await sessionStart();
    if (mode !== 'online') {
      location.replace(mode === 'none' ? 'login.html' : 'index.html');
      return;
    }
  }
  clockFromServer(worldClock, session.player.world ? session.player.world.time : null,
    performance.now() / 1000);
  worldAim = clockTarget(worldClock, performance.now() / 1000);
  restored = applyState(serverToSave(session.player));
  applyServer(game.player, session.player);
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
  // Города системы — с сервера: он хозяин мира (syncCities).
  syncCities(sys, world);
  if (!restored) {
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
    if (body) body.innerHTML = bootHtml(glError);
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
    // Стоял в порту — так и стоит на площадке: вылет — решение пилота
    // (пробел, C), а не кнопки «старт».
    hideOverlay();
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
