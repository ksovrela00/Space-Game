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
import { buildCobra, buildGear } from './models/ships.js';
import { buildStation, STATION_D } from './models/station.js';
import { makeSystem, updateWorld, nearestBody } from './game/world.js';
import { homeSystem, systemById } from './game/galaxy.js';
import {
  makeWarp, updateWarp, startWarp, stopWarp, canWarp, placeAtStar, finishWarp,
} from './game/warp.js';
import { makeShip, updateShip, readControls, clearControls, placeShip, SHIP } from './game/ship.js';
import {
  makeNav, refreshNav, pickTarget, aimedTarget, currentTarget, navInfo, targetById,
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
import { captureBody, carryShip, gravityField } from './game/gravity.js';
import { entryState } from './game/entry.js';
import { makeDust, updateDust } from './game/dust.js';
import { makeFlow, updateFlow } from './game/flow.js';
import { makeYoke, updateYoke, buildCockpit } from './models/cockpit.js';
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
import {
  showDocked, showCrash, showHelp, hideOverlay,
} from './ui/screens.js';
import { makeMap, drawMap, mapInput, resetMap } from './ui/map.js';
import { makeMenu, menuInput, drawMenu } from './ui/menu.js';
import { makePlayer, updatePlayer, savePlayer, loadPlayer, applyServer } from './game/player.js';
import {
  session, start as sessionStart, queueSave, flushOnExit,
  dock as serverDock, refresh as serverRefresh, repair as serverRepair, isOnline,
} from './net/session.js';
import { net, connect as netConnect } from './net/socket.js';
import { makePeers, ingestPeers, peerPoses, dropPeer } from './game/peers.js';
import { makeClock, clockFromServer, clockTarget, clockStep } from './game/clock.js';
import { makeDebug, tickDebug, drawDebug } from './ui/debug.js';

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
    console.warn('WebGL2 недоступен (' + scene.error + '), рисуем на Canvas 2D');
    scene = null;
  }
}
if (!scene) renderer = new Renderer(screenCanvas, { camera });

let world = makeSystem(sys);
const ship = makeShip();
const shipMesh = buildCobra();
const stationMesh = buildStation();
const gearMesh = buildGear();
// Кабина есть только в объёмном рендере: на запасном пути Canvas-2D
// рисовать её нечем, и приборы там остаются по углам экрана, а стойки
// фонаря — штрихами поверх кадра (js/ui/hud.js). Поэтому game.cockpit
// значит ровно «в кадре есть настоящая кабина».
const cockpitModel = scene ? buildCockpit() : null;

const game = {
  world, ship, shipMesh, stationMesh, gearMesh,
  cockpit: cockpitModel,   // модель кабины: геометрия, штурвал, места приборов
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
  yoke: makeYoke(),      // положение штурвала в кабине (вид от 1-го лица)
  touch: makeTouch(),    // сенсорные органы: джойстик, тяга, кнопки
  capture: null,         // тело, в чьём гравитационном захвате корабль
  camOrbit: { yaw: 0, pitch: 0 },   // осмотр камерой из-за спины (ПКМ)
  // Камера из-за спины со своей инерцией: она догоняет корабль, а не
  // сидит на нём намертво (см. updateChase).
  chase: {
    fwd: v3(0, 0, 1), up: v3(0, 1, 0),
    acc: v3(), prevVel: v3(), sway: v3(),
    near: 1, ready: false, wasRailed: false,
  },
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
  landHold: 0,           // сколько уже держат клавишу взлёта на грунте
  teleAlt: 2,            // номер текущей высоты телепорта (клавиша K)
  restartArmed: 0,       // сколько ещё ждём подтверждения рестарта, с
};

const dbg = makeDebug();
let booted = false;
const _sun = v3();
const _camDir = v3();
const _camRight = v3();
const _tmp = v3();

// --- смена звёздной системы --------------------------------------------------

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
  // факт стыковки значило бы обесценить и удары, и деньги разом.
  if (!isOnline()) ship.hull = SHIP.maxHull;
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
      applyServer(game.player, session.player);
      if (r.fee > 0) {
        say(game.state, 'СТЫКОВОЧНЫЙ СБОР · ' + r.fee + ' кр', '#ffcc66', 3);
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
    say(game.state, 'РЕМОНТ КОРПУСА · −' + r.cost + ' кр', '#78e08f', 3);
  } catch (e) {
    say(game.state, 'РЕМОНТ: ' + e.message, '#ff7a66', 4);
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
      st.pos.x + st.basis.fwd.x * (STATION_D + 1.5),
      st.pos.y + st.basis.fwd.y * (STATION_D + 1.5),
      st.pos.z + st.basis.fwd.z * (STATION_D + 1.5)), b);
  }
  ship.dockedAt = null;
  audioReset(game.audio, ship);
  audioCue(game.audio, 'launch');
  say(game.state, 'ВЫЛЕТ РАЗРЕШЁН. УДАЧНОГО ПОЛЁТА.', '#78e08f');
  input.releaseAll();
};

// --- посадка на поверхность ---------------------------------------------------

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
  say(game.state, 'КОРАБЛЬ ЗАФИКСИРОВАН. ДВИГАТЕЛИ ОТКЛЮЧЕНЫ.', '#78e08f');
  save();
};

game.takeoff = () => {
  hideOverlay();
  game.landHold = 0;
  if (!takeoff(ship)) { game.state.mode = ST.FLIGHT; return; }
  game.state.mode = ST.FLIGHT;
  audioReset(game.audio, ship);
  audioCue(game.audio, 'takeoff');
  say(game.state, 'ОТРЫВ. ШАССИ ВЫПУЩЕНО — УБРАТЬ КЛАВИШЕЙ G.', '#78e08f');
  input.releaseAll();
};

game.respawn = () => {
  hideOverlay();
  ship.hull = SHIP.maxHull;
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
  placeShip(ship, v3(), makeBasis());

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
  say(game.state, 'НОВАЯ ИГРА', '#78e08f', 3);
};

// Куда возвращаться, закрывая карту или справку.
const restMode = () => (ship.dockedAt ? ST.DOCKED : (ship.landedAt ? ST.LANDED : ST.FLIGHT));

game.closeOverlay = () => {
  hideOverlay();
  game.state.mode = restMode();
  if (ship.dockedAt) showDocked(game);
};

function crash(reason) {
  game.entry = null;
  game.crashReason = reason;
  game.stats.crashes++;
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
  if (!t) { say(st, 'ЦЕЛЬ НЕ ВЫБРАНА', '#ff7a66'); return; }

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
    say(st, 'ТЕЛЕПОРТ: ' + t.name + ', 6 км до порта', '#78e08f');
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
  say(st, 'ТЕЛЕПОРТ: ' + t.name + ', высота ' + fmtDist(alt), '#78e08f');
}

/**
 * Выбрать цель объектом, а не номером: список целей пересобирается на
 * ходу. Маркер тела, рядом с которым корабль не находится, в список не
 * попадает — тогда встаём на само тело.
 */
game.selectTarget = (t) => selectTarget(t);

function selectTarget(t) {
  if (!t) return;
  refreshNav(game.nav, world, ship);
  let i = game.nav.list.indexOf(t);
  if (i < 0 && t.isMarker) i = game.nav.list.indexOf(t.body);
  if (i >= 0) game.nav.index = i;
}

// --- сохранение --------------------------------------------------------------

/**
 * Что именно сохраняется. Вынесено из save() отдельно, потому что этот
 * же снимок уходит на сервер: два разных набора полей у местного и
 * сетевого сохранения означали бы, что после переезда игрок теряет
 * половину состояния.
 */
function savePayload() {
  return {
    // Система — первым делом: всё остальное в сейве (цель, порт, точка
    // стоянки) хранится идентификаторами тел, а те имеют смысл только
    // внутри своей системы.
    system: sys.id,
    // Цель варпа — часть плана полёта, как и обычная цель: выбрал
    // систему, отложил игру, вернулся.
    warpTo: game.warpTarget ? game.warpTarget.id : null,
    pos: ship.pos,
    basis: ship.basis,
    hull: ship.hull,
    // Цель хранится идентификатором, а не номером в списке: список
    // теперь меняется на ходу (у ближнего тела появляются маркеры), и
    // номер после загрузки указывал бы в произвольное место.
    target: currentTarget(game.nav) ? currentTarget(game.nav).id : null,
    view: game.state.view,
    docked: ship.dockedAt ? ship.dockedAt.id : null,
    last: game.lastStation ? game.lastStation.id : null,
    // Стоянка на поверхности хранится в локальных осях тела: мировые
    // координаты через сутки указывали бы в пустоту.
    landed: ship.landedAt
      ? { id: ship.landedAt.id, pose: ship.landedPose, secured: ship.secured }
      : null,
    gear: ship.gear.out,
    audio: { on: game.audio.on, vol: game.audio.vol },
    stats: game.stats,
    // Дела пилота переживают и смену системы, и смену корпуса.
    player: savePlayer(game.player),
    time: world.time,
  };
}

function save() {
  const data = savePayload();
  // Местное сохранение остаётся ВСЕГДА, даже когда есть сервер: это кэш,
  // с которого игра поднимется, если сети не окажется в следующий раз.
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) { /* приватный режим — просто не сохраняем */ }
  // А на сервер оно уходит фоном и не чаще, чем нужно (js/net/session.js).
  queueSave(data);
}

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { s = null; }
  if (!s) return false;
  return applyState(s);
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
  // Система восстанавливается ДО всего остального: пока она не та, любой
  // идентификатор из сейва указывает в чужой список тел.
  const saved = systemById(s.system === undefined ? 0 : s.system);
  if (saved && saved.seed !== sys.seed) enterSystem(saved);
  game.warpTarget = s.warpTo === null || s.warpTo === undefined ? null : systemById(s.warpTo);
  const findStation = (id) => world.stations.find((x) => x.id === id) || null;
  // Время мира СТАВИТСЯ, а не прибавляется: система могла быть собрана
  // чуть выше (enterSystem), и её часы уже стоят на общем времени —
  // прибавка дала бы удвоенное время и орбиты, где их никто не увидит.
  world.time = 0;
  updateWorld(world, s.time || 0);
  game.stats = Object.assign({ landings: 0 }, s.stats || game.stats);
  if (s.player) loadPlayer(game.player, s.player);
  selectTarget(targetById(world, s.target));
  game.state.view = s.view || 'cockpit';
  ship.hull = s.hull || SHIP.maxHull;
  game.lastStation = findStation(s.last);
  ship.gear.out = !!s.gear;
  ship.gear.t = s.gear ? 1 : 0;
  if (s.audio) {
    game.audio.on = s.audio.on !== false;
    game.audio.vol = typeof s.audio.vol === 'number' ? s.audio.vol : game.audio.vol;
  }
  if (typeof s.fuel === 'number') ship.fuel = s.fuel;

  if (s.landed && s.landed.pose) {
    const body = world.bodies.find((b) => b.id === s.landed.id);
    if (body) {
      ship.landedAt = body;
      ship.landedPose = s.landed.pose;
      ship.secured = !!s.landed.secured;
      ship.gear.out = true;
      ship.gear.t = 1;
      updateLandedPose(ship);
      game.state.mode = ST.LANDED;
      return 'landed';
    }
  }

  const dockedStation = findStation(s.docked);
  if (dockedStation) {
    ship.dockedAt = dockedStation;
    game.lastStation = dockedStation;
    game.state.mode = ST.DOCKED;
    return 'docked';
  }
  if (s.pos) {
    // Базис может не прийти вовсе: у нового пилота на сервере он пуст, а
    // место уже есть. Ставим корабль как есть — с нынешним разворотом,
    // иначе игра решит, что сохранения нет, и начнёт с порта.
    placeShip(ship, s.pos, s.basis || ship.basis);
    game.state.mode = ST.FLIGHT;
    return 'flight';
  }
  return false;
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
  return {
    system: pos.systemId === null || pos.systemId === undefined ? 0 : pos.systemId,
    warpTo: pos.warpTo === undefined ? null : pos.warpTo,
    pos: pos.pos,
    basis: pos.basis,
    hull: sh.hull,
    fuel: sh.fuelT,
    target: pos.targetBody === undefined ? null : pos.targetBody,
    view: pos.view,
    docked: pos.dockedBody === undefined ? null : pos.dockedBody,
    last: pos.lastStation === undefined ? null : pos.lastStation,
    landed: pos.landedBody
      ? { id: pos.landedBody, pose: pos.landedPose, secured: pos.landedSecured }
      : null,
    gear: !!sh.gearOut,
    stats: st.player ? st.player.stats : null,
    // ВРЕМЯ МИРА, а не налёт пилота. Здесь стоял playTimeS, и это была
    // ровно та ошибка, из-за которой у двоих в одном месте станция была
    // в разных: у каждого свой налёт — значит, своя фаза орбит.
    time: st.world && typeof st.world.time === 'number' ? st.world.time : 0,
    // Звук — настройка браузера, а не игрока: он остаётся местным.
    audio: null,
  };
}

// --- глобальные клавиши ------------------------------------------------------

function handleKeys(dt) {
  if (!booted) return;
  const st = game.state;

  if (input.pressed('Backquote')) dbg.on = !dbg.on;

  // Звук. Клавиши намеренно вне разбора режимов ниже: выключать гул
  // надо и на карте, и в порту, а не только в полёте.
  if (input.pressed('KeyN')) {
    if (input.isDown('ShiftLeft', 'ShiftRight')) {
      // Начать заново — только с подтверждения: сохранение стирается.
      if (game.restartArmed > 0) game.restart();
      else {
        game.restartArmed = RESTART_CONFIRM;
        say(st, 'SHIFT+N ЕЩЁ РАЗ — НАЧАТЬ ЗАНОВО', '#ff7a66', RESTART_CONFIRM);
      }
    } else {
      game.audio.on = !game.audio.on;
      sound.setMuted(!game.audio.on);
      say(st, game.audio.on ? 'ЗВУК ВКЛЮЧЁН' : 'ЗВУК ВЫКЛЮЧЕН');
      save();
    }
  }
  if (input.pressed('Minus', 'Equal', 'NumpadSubtract', 'NumpadAdd')) {
    const up = input.pressed('Equal', 'NumpadAdd');
    game.audio.vol = clamp(game.audio.vol + (up ? 0.1 : -0.1), 0, 1);
    sound.setVolume(game.audio.vol);
    say(st, 'ГРОМКОСТЬ ' + Math.round(game.audio.vol * 100) + '%');
    save();
  }

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

  if (st.mode === ST.DOCKED) {
    if (input.pressed('Space', 'Enter')) game.launch();
    return;
  }
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
    if (!t) { say(st, 'НАВЕДИ НОС НА ЦЕЛЬ', '#ffcc66'); return; }
    say(st, 'ЦЕЛЬ: ' + t.name);
    // Смена цели на калибровке — это выбор другого маршрута, а не отказ
    // от прыжка: привод просто начинает считать заново.
    const q = game.quantum;
    if (q.phase === 'calib') startCalibration(q, t);
    else if (q.phase === 'jump') {
      abortQuantum(q, ship);
      say(st, 'ПРЫЖОК СОРВАН — ГАШЕНИЕ ХОДА', '#ff7a66');
    }
  }

  // B — квантовый привод: включить калибровку, а на ходу — сорвать прыжок.
  if (input.pressed('KeyB')) {
    const q = game.quantum;
    if (q.phase === 'jump') {
      abortQuantum(q, ship);
      say(st, 'ПРЫЖОК СОРВАН — ГАШЕНИЕ ХОДА', '#ff7a66');
    } else if (q.phase === 'calib') { stopQuantum(q); say(st, 'ПРИВОД ОТКЛЮЧЁН'); }
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
            say(st, 'ОБХОД ЧЕРЕЗ ' + hop.name + ' — B ЕЩЁ РАЗ', '#ffcc66', 4);
          }
        }
      } else {
        stopDockingComputer(ship);
        stopLanding(ship);
        startCalibration(q, t);
        say(st, 'ПРИВОД: КАЛИБРОВКА НА ' + t.name, '#78e08f');
      }
    }
  }

  // J — варп-привод: центровка на другую систему, повторное нажатие
  // отменяет. В тоннеле кнопка не делает ничего: оборвать прыжок между
  // системами нельзя в принципе — обрывать некуда, старой системы уже
  // нет в памяти, а до новой ещё не долетели.
  if (input.pressed('KeyJ')) {
    const w = game.warp;
    if (w.phase === 'tunnel') {
      say(st, 'ВАРП НЕ ПРЕРЫВАЕТСЯ', '#ffcc66');
    } else if (w.phase === 'align') {
      stopWarp(w);
      say(st, 'ВАРП ОТКЛЮЧЁН');
    } else {
      const to = game.warpTarget;
      const res = canWarp(ship, sys, to);
      if (!res.ok) say(st, res.reason, '#ff7a66');
      else {
        stopQuantum(game.quantum);
        stopDockingComputer(ship);
        stopLanding(ship);
        startWarp(w, sys, to);
        say(st, 'ВАРП: ЦЕНТРОВКА НА ' + to.name.toUpperCase(), '#9fd9ff', 4);
      }
    }
  }

  // K — телепорт к цели, Shift+K — сменить высоту и телепортироваться.
  if (input.pressed('KeyK')) {
    if (input.isDown('ShiftLeft', 'ShiftRight')) {
      game.teleAlt = (game.teleAlt + 1) % TELEPORT_ALTS.length;
    }
    teleportToTarget();
  }

  if (input.pressed('KeyG')) {
    const out = toggleGear(ship);
    audioCue(game.audio, 'gear', { out });
    say(st, out ? 'ШАССИ: ВЫПУСК' : 'ШАССИ: УБОРКА',
      out ? '#78e08f' : null);
  }

  if (input.pressed('KeyL')) {
    if (ship.landing) { stopLanding(ship); say(st, 'ПОСАДОЧНЫЙ КОМПЬЮТЕР ОТКЛЮЧЁН'); }
    else {
      // Цель — либо выбранное навигатором тело, либо то, над которым летим.
      const t = currentTarget(game.nav);
      const body = isLandable(t) ? t : (game.zone ? game.zone.body : null);
      if (!body) say(st, 'РЯДОМ НЕТ ТЕЛА, НА КОТОРОЕ МОЖНО СЕСТЬ', '#ff7a66');
      else {
        const res = startLanding(ship, body, ship.pos);
        if (!res.ok) say(st, res.reason, '#ff7a66');
        else say(st, 'ПОСАДОЧНЫЙ КОМПЬЮТЕР: ' + body.name, '#78e08f');
      }
    }
  }

  if (input.pressed('KeyC')) {
    if (ship.docking) { stopDockingComputer(ship); say(st, 'ДОКИНГ-КОМПЬЮТЕР ОТКЛЮЧЁН'); }
    else {
      const t = currentTarget(game.nav);
      const station = t && t.isStation ? t : nearestStation();
      if (!station) say(st, 'СТАНЦИЙ ПОБЛИЗОСТИ НЕТ', '#ff7a66');
      else {
        const res = startDockingComputer(ship, station);
        if (!res.ok) say(st, res.reason, '#ff7a66');
        else say(st, 'ДОКИНГ-КОМПЬЮТЕР: ' + station.name, '#78e08f');
      }
    }
  }

  // Любое ручное вмешательство отключает автоматику. Привода это не
  // касается: на калибровке ручка как раз и нужна, чтобы навестись, а в
  // прыжке она всё равно ничего не делает.
  if (ship.docking || ship.landing) {
    if (input.isDown('KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight') ||
      input.isDown('KeyR', 'KeyF', 'Space') || input.pressed('KeyX', 'KeyZ')) {
      if (ship.docking) stopDockingComputer(ship);
      if (ship.landing) stopLanding(ship);
      say(st, 'РУЧНОЕ УПРАВЛЕНИЕ');
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
  updateWorld(world, clockStep(world.time, worldAim, dt));
  // Часы пилота идут в любом режиме: срок задания не останавливается
  // оттого, что корабль стоит в порту.
  updatePlayer(game.player, dt);

  // Гравитационный захват: внутри сферы действия тела корабль
  // переносится вместе с ним (см. js/game/gravity.js). Без этого
  // «зависнуть над точкой» нельзя — поверхность уезжает из-под корабля.
  game.capture = captureBody(world, ship.pos);
  if (game.capture && st.mode === ST.FLIGHT) carryShip(ship, game.capture, dt);

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
      enterSystem(w.to);
      placeAtStar(w, ship, world.star);
      game.nearest = nearestBody(world, ship.pos);
      say(st, 'СИСТЕМА ' + w.to.name.toUpperCase(), '#9fd9ff', 3);
    } else if (ev === 'arrive') {
      finishWarp(w, ship);
      game.warpTarget = null;
      audioReset(game.audio, ship);
      say(st, 'ПРИБЫТИЕ: ' + sys.name.toUpperCase(), '#78e08f', 4);
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
    game.entry = null;
    game.zone = null;
    if (ev === 'arrive') {
      say(st, 'ВЫХОД ИЗ ПРЫЖКА', '#78e08f');
      audioReset(game.audio, ship);
    } else if (ev === 'stopped') {
      say(st, 'ХОД ПОГАШЕН', '#78e08f');
      audioReset(game.audio, ship);
    }
    return;
  }

  // Обстановка у поверхности считается до управления: от неё зависит и
  // посадочный режим, и команды посадочного компьютера.
  let zone = landingContext(world, ship);

  if (ship.landing) {
    game.statusLine = updateLandingComputer(ship, dt, zone);
  } else if (ship.docking) {
    game.statusLine = updateDockingComputer(ship, dt);
  } else {
    readControls(ship);
  }

  // Центровка варпа идёт параллельно полёту, как и калибровка квантового:
  // корабль слушается ручек, привод копит готовность, пока нос в допуске.
  if (w.phase === 'align') {
    const ev = updateWarp(w, ship, dt);
    if (ev === 'abort') say(st, w.reason || 'ВАРП ОТМЕНЁН', '#ff7a66');
    else if (ev === 'engage') say(st, 'ВАРП', '#9fd9ff', 1.5);
  } else {
    updateWarp(w, ship, dt);                // только затухание вспышки
  }

  // Калибровка идёт параллельно обычному полёту: корабль слушается,
  // привод копит готовность. Событие 'engage' поймает следующий кадр.
  if (q.phase === 'calib') {
    const ev = updateQuantum(q, ship, world, dt);
    if (ev === 'abort') say(st, q.reason || 'ПРЫЖОК ОТМЕНЁН', '#ff7a66');
    else if (ev === 'engage') say(st, 'ПРЫЖОК', '#78e08f', 1.2);
  } else {
    updateQuantum(q, ship, world, dt);      // только затухание вспышки
  }

  updateShip(ship, dt, gravityField(game.capture, ship));
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
    crash('Столкновение с ' + game.nearest.body.name + '.');
    return;
  }

  if (zone) {
    const touch = checkTouchdown(ship, zone);
    if (touch && touch.result === 'landed') {
      if (touch.damage) {
        ship.hull = Math.max(1, ship.hull - touch.damage);
        say(st, 'ПОСАДКА БЕЗ ШАССИ · −' + Math.round(touch.damage) + '% КОРПУСА', '#ffcc66', 2);
      } else {
        say(st, 'ПОСАДКА ВЫПОЛНЕНА: ' + zone.body.name, '#78e08f');
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
      game.stats.hits = (game.stats.hits || 0) + 1;
      if (ship.hull <= 0) {
        ship.hull = 0;
        crash(touch.reason + ' Корпус разрушен.');
        return;
      }
      say(st, `УДАР · −${Math.round(touch.damage)}% КОРПУСА`,
        touch.damage > 15 ? '#ff7a66' : '#ffcc66', 1.6);
      if (hadComputer) say(st, 'ПОСАДОЧНЫЙ КОМПЬЮТЕР ОТКЛЮЧЁН', '#ffcc66', 1.6);
    }
  }

  // Станции: стыковка либо удар о корпус.
  for (const s of world.stations) {
    const d = Math.hypot(s.pos.x - ship.pos.x, s.pos.y - ship.pos.y, s.pos.z - ship.pos.z);
    if (d > s.radius * 2.2) continue;
    const res = checkStation(ship, s);
    if (res === 'docked') {
      game.stats.docks++;
      say(st, 'СТЫКОВКА ВЫПОЛНЕНА', '#78e08f');
      dockAt(s);
      return;
    }
    if (res === 'crash') {
      crash('Удар о конструкции станции ' + s.name + '.');
      return;
    }
  }
}

// --- подготовка данных для HUD ----------------------------------------------

function prepareHud() {
  // Список целей пересобирается каждый кадр: маркеры показываются только
  // у того тела, рядом с которым корабль сейчас находится.
  refreshNav(game.nav, world, ship);
  const target = currentTarget(game.nav);
  game.info = navInfo(ship, target);
  // На что наведён нос прямо сейчас: приборы подсвечивают это, и то же
  // самое выберет Tab.
  game.aimed = aimedTarget(game.nav, ship);

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
    if (d < 30) game.dockAssist = makeDockAssist(ship, st);
  }

  // Посадочный дисплей — когда близка поверхность, на которую можно сесть.
  game.landInfo = game.zone && isLandable(game.zone.body) &&
    game.zone.alt < LAND.landAlt * 4
    ? landingReadout(ship, game.zone)
    : null;

}

// --- отрисовка ---------------------------------------------------------------

// Поворот вектора вокруг оси (формула Родрига).
function rotAround(v, axis, ang, out) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const d = axis.x * v.x + axis.y * v.y + axis.z * v.z;
  out.x = v.x * c + (axis.y * v.z - axis.z * v.y) * s + axis.x * d * (1 - c);
  out.y = v.y * c + (axis.z * v.x - axis.x * v.z) * s + axis.y * d * (1 - c);
  out.z = v.z * c + (axis.x * v.y - axis.y * v.x) * s + axis.z * d * (1 - c);
  return out;
}

// Осмотр камерой: правая кнопка зажата — крутим взгляд вокруг корабля,
// отпущена — камера сама возвращается за спину.
const LOOK = 0.0042;        // рад на пиксель
const _drag = { x: 0, y: 0 };
const _touchLook = { x: 0, y: 0 };
function updateCamOrbit(dt) {
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

// Камера сзади: ближе, чем кажется нужным.
//
// Раньше она стояла в 200 метрах позади и в 55 над кораблём — три его
// длины. На орбите это незаметно, а у поверхности рушит чувство
// масштаба: прибор показывает 32 метра высоты, а глаз видит землю с
// точки, которая втрое выше, и читает «пара сотен». Теперь вынос
// сравним с размером корабля, и высота на приборе совпадает с тем, что
// видно.
const CHASE_BACK = 0.105, CHASE_UP = 0.026;

// Камера НЕ приклеена к корпусу.
//
// Пока она повторяла ориентацию корабля кадр в кадр, на развороте
// вращался мир, а корабль стоял в кадре неподвижно — ровно так выглядит
// модель на подставке, и отсюда шло «игрушечное» ощущение. Теперь
// камера догоняет нос с запаздыванием: корабль успевает повернуться
// ВНУТРИ кадра, и видно, что его ворочают, а не переставляют.
//
// Крен догоняется вдвое медленнее поворота: у него и угловая скорость
// самая большая, и именно на нём запаздывание читается как вес.
const CHASE_TURN = 7.0;        // 1/с — как быстро камера догоняет нос
const CHASE_ROLL = 3.2;        // 1/с — то же для «верха» (крен)
// Снос от ускорения: разгоняясь, корабль уходит от камеры вперёд.
// Коэффициент подобран по форсажу — на полной тяге отставание выходит
// около полутора корпусов, дальше упирается в предел.
const CHASE_SWAY = 0.012;      // км на км/с²
const CHASE_SWAY_MAX = 0.05;   // км
// У самой земли камеру подтягивает к корпусу: чем ближе точка съёмки к
// кораблю, тем вернее глаз читает высоту по его размеру.
const CHASE_LOW = 0.4;         // км — ниже этого начинается подтягивание
const CHASE_LOW_K = 0.62;      // во сколько раз ближе она встаёт у грунта

const _chaseBasis = makeBasis();
const _acc = v3();

/**
 * Инерция камеры из-за спины. Считается по времени игрока, а не по шагам
 * физики: это свойство съёмки, а не корабля.
 */
function updateChase(dt) {
  const c = game.chase;
  const b = ship.basis;
  const settled = game.state.mode !== ST.FLIGHT;

  // На рельсах квантового привода сноса нет вовсе.
  //
  // Снос — это модель камеры-преследователя с инерцией, и она про ТЯГУ
  // корабля. В прыжке скорость задаётся профилем, и на торможении
  // ускорение доходит до двенадцати тысяч км/с²: снос упирался в свой
  // предел и держал камеру вплотную к кораблю все пять секунд выхода —
  // со стороны это и выглядело как «камера уехала вперёд».
  // «На рельсах» считается и один кадр ПОСЛЕ выхода: на самом выходе
  // скорость падает с тысяч км/с до нуля за кадр, и разность скоростей
  // даёт ускорение, которого не бывает. Именно этот единственный кадр и
  // швырял камеру вперёд на пол-корпуса.
  const onRails = !!((game.quantum && game.quantum.phase !== 'idle') ||
    (game.warp && game.warp.phase === 'tunnel'));
  const railed = onRails || c.wasRailed;
  c.wasRailed = onRails;
  if (railed) {
    copy(c.prevVel, ship.vel);
    c.acc.x = c.acc.y = c.acc.z = 0;
    c.sway.x = c.sway.y = c.sway.z = 0;
  }

  // Ускорение корабля — по изменению его скорости. Отдельного «сколько
  // дали тяги» тут не нужно: камере важно то, что произошло, а не то,
  // что просили, и удар о грунт она обязана показать так же, как разгон.
  if (!railed && dt > 1e-5) {
    _acc.x = (ship.vel.x - c.prevVel.x) / dt;
    _acc.y = (ship.vel.y - c.prevVel.y) / dt;
    _acc.z = (ship.vel.z - c.prevVel.z) / dt;
  }
  if (!railed) {
    copy(c.prevVel, ship.vel);
    const ka = Math.min(1, dt * 6);
    c.acc.x += (_acc.x - c.acc.x) * ka;
    c.acc.y += (_acc.y - c.acc.y) * ka;
    c.acc.z += (_acc.z - c.acc.z) * ka;
  }

  // Высота: у грунта камера ближе.
  const alt = game.zone ? game.zone.alt : Infinity;
  const want = alt >= CHASE_LOW ? 1
    : CHASE_LOW_K + (1 - CHASE_LOW_K) * clamp(alt / CHASE_LOW, 0, 1);
  c.near += (want - c.near) * Math.min(1, dt * 3);

  if (!c.ready || settled || dt <= 0) {
    // На стоянке и при перезапуске камера садится на место мгновенно:
    // запаздывание — это про полёт, а не про то, как открылся экран.
    copy(c.fwd, b.fwd);
    copy(c.up, b.up);
    c.acc.x = c.acc.y = c.acc.z = 0;
    c.ready = true;
  } else {
    const kf = 1 - Math.exp(-CHASE_TURN * dt);
    const ku = 1 - Math.exp(-CHASE_ROLL * dt);
    c.fwd.x += (b.fwd.x - c.fwd.x) * kf;
    c.fwd.y += (b.fwd.y - c.fwd.y) * kf;
    c.fwd.z += (b.fwd.z - c.fwd.z) * kf;
    c.up.x += (b.up.x - c.up.x) * ku;
    c.up.y += (b.up.y - c.up.y) * ku;
    c.up.z += (b.up.z - c.up.z) * ku;
    normalize(c.fwd, c.fwd);
    normalize(c.up, c.up);
  }

  // Снос камеры: она отстаёт от того, что разгоняется.
  if (railed) return;
  const am = Math.hypot(c.acc.x, c.acc.y, c.acc.z);
  const k = am > 1e-9 ? -Math.min(CHASE_SWAY * am, CHASE_SWAY_MAX) / am : 0;
  c.sway.x = c.acc.x * k;
  c.sway.y = c.acc.y * k;
  c.sway.z = c.acc.z * k;
}

function setupCamera() {
  const cam = camera;
  cam.basis.right = { ...ship.basis.right };
  cam.basis.up = { ...ship.basis.up };
  cam.basis.fwd = { ...ship.basis.fwd };
  if (game.state.view === 'chase') {
    const c = game.chase;
    // Своя ориентация камеры: она догоняет корабль, а не повторяет его.
    lookAlong(_chaseBasis, c.fwd, c.up);
    const b = _chaseBasis;
    const o = game.camOrbit;
    // Направление взгляда = нос корабля, повёрнутый на осмотр.
    rotAround(b.fwd, b.up, o.yaw, _camDir);
    rotAround(_camDir, rotAround(b.right, b.up, o.yaw, _camRight), o.pitch, _camDir);
    lookAlong(cam.basis, _camDir, b.up);
    const back = CHASE_BACK * c.near, up = CHASE_UP * c.near;
    cam.pos.x = ship.pos.x - _camDir.x * back + b.up.x * up + c.sway.x;
    cam.pos.y = ship.pos.y - _camDir.y * back + b.up.y * up + c.sway.y;
    cam.pos.z = ship.pos.z - _camDir.z * back + b.up.z * up + c.sway.z;
  } else {
    // Кокпит: чуть впереди центра масс, на уровне фонаря. Это и есть
    // глаз пилота — в той же точке стоит начало координат кабины
    // (js/models/cockpit.js), поэтому её рисование сводится к повороту.
    const b = ship.basis;
    cam.pos.x = ship.pos.x + b.fwd.x * 0.012 + b.up.x * 0.006;
    cam.pos.y = ship.pos.y + b.fwd.y * 0.012 + b.up.y * 0.006;
    cam.pos.z = ship.pos.z + b.fwd.z * 0.012 + b.up.z * 0.006;
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
    renderer.drawMesh(stationMesh, s.pos, s.basis, 1, _sun, { outline: d < 30 });
  }

  if (game.state.view === 'chase' && game.state.mode !== ST.DOCKED) {
    normalize(v3(sunPos.x - ship.pos.x, sunPos.y - ship.pos.y, sunPos.z - ship.pos.z), _sun);
    renderer.drawMesh(shipMesh, ship.pos, ship.basis, 1, _sun, {});
    // Стойки шасси — каждая от своей точки крепления.
    if (ship.gear.t > 0.01) {
      const b = ship.basis;
      gearMesh.hardpoints.forEach((hp, i) => {
        _tmp.x = ship.pos.x + b.right.x * hp.x + b.up.x * hp.y + b.fwd.x * hp.z;
        _tmp.y = ship.pos.y + b.right.y * hp.x + b.up.y * hp.y + b.fwd.y * hp.z;
        _tmp.z = ship.pos.z + b.right.z * hp.x + b.up.z * hp.y + b.fwd.z * hp.z;
        const len = gearMesh.legLengths[i] + (ship.gear.drop ? ship.gear.drop[i] : 0);
        renderer.drawMesh(gearMesh, _tmp, b, Math.max(0.001, len) * ship.gear.t, _sun, {});
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
    const L = shipMesh.length || 0.065;
    const c = en.color.map((v) => Math.round(Math.min(1, v) * 255));
    for (const [ahead, k] of [[0.75, 1], [0.1, 0.7], [-0.9, 0.45]]) {
      _tmp.x = ship.pos.x + en.dir.x * L * ahead;
      _tmp.y = ship.pos.y + en.dir.y * L * ahead;
      _tmp.z = ship.pos.z + en.dir.z * L * ahead;
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

  const wantCursor = game.menu.open ? 'menu' : game.state.mode === ST.MAP ? 'map' : '';
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
  st.dust = game.dust ? game.dust.list.length : 0;

  // Приборы — отдельным прозрачным слоем, одинаково для обоих рендеров.
  hud.begin();
  if (game.state.mode === ST.MAP) drawMap(hud, game);
  else if (game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED) drawHud(hud, game);
  // Меню рисуется ПОВЕРХ приборов, а не вместо них: кадр под ним живой.
  if (game.menu.open) drawMenu(hud, game);
  // Сенсорные органы поверх приборов, но только в полёте и на грунте:
  // в меню и на карте они мешают, а делать нечего.
  if (Q.touchUi && !game.menu.open
      && (game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED)) {
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
let peerRev = -1;
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
    touchUpdate(game.touch, [...touchPoints.values()], touchArea);
    touchApply(game.touch, ship);
  }

  handleKeys(dt);

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
    if (net.left !== null) { dropPeer(peerStore, net.left); net.left = null; }
    if (net.rev !== peerRev) {
      peerRev = net.rev;
      ingestPeers(peerStore, net.peers, tNow);
      clockFromServer(worldClock, net.wt, tNow);
    }
    game.peers = peerPoses(peerStore, tNow, game.peers);
    worldAim = clockTarget(worldClock, tNow);
  }

  // Связь пропала или вернулась — игрок обязан это увидеть, а не
  // догадываться по тому, что счёт перестал меняться.
  if (session.mode !== netMode) {
    if (netMode === 'online' && session.mode === 'offline') {
      say(game.state, 'СВЯЗЬ С СЕРВЕРОМ ПОТЕРЯНА · АВТОНОМНО', '#ffcc66', 5);
    } else if (netMode === 'offline' && session.mode === 'online') {
      say(game.state, 'СВЯЗЬ ВОССТАНОВЛЕНА', '#78e08f', 3);
    } else if (session.mode === 'none' && netMode !== 'none') {
      say(game.state, 'ВХОД ПРОСРОЧЕН · СОХРАНЕНИЕ ТОЛЬКО МЕСТНОЕ', '#ff7a66', 6);
    }
    netMode = session.mode;
  }

  updateMessages(game.state, dt);
  if (game.restartArmed > 0) game.restartArmed = Math.max(0, game.restartArmed - dt);
  updateCamOrbit(dt);
  // Пыль идёт по времени игрока, как и звук: это картинка, а не физика
  // корабля, и от шага интегрирования зависеть не должна.
  updateDust(game.dust, game, dt);
  // Поток за бортом — тоже картинка, и по той же причине идёт по
  // времени игрока: фаза копится в js/game/flow.js, рендер её читает.
  updateFlow(game.flow, game, dt);
  // Штурвал ходит за ручками по времени игрока: это рука пилота, а не
  // состояние корабля, и от шага физики зависеть не должна.
  updateYoke(game.yoke, ship.control, dt);
  updateChase(dt);
  updateFov(dt);
  // Звук идёт по времени игрока, а не по шагам физики: круизный
  // ускоритель множит перемещение, но не частоту кадров, и гул движков
  // от него меняться не должен.
  updateAudio(game.audio, game, dt);
  playAudio(game.audio, sound);
  if (game.state.mode === ST.FLIGHT || game.state.mode === ST.LANDED) prepareHud();

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

function attachTouch(target = window) {
  const take = (e) => {
    for (const t of e.changedTouches || []) {
      if (e.type === 'touchend' || e.type === 'touchcancel') touchPoints.delete(t.identifier);
      else touchPoints.set(t.identifier, { id: t.identifier, x: t.clientX, y: t.clientY });
    }
    // Прокрутка, зум двумя пальцами и «потяни, чтобы обновить» на
    // странице, которая целиком занята игрой, — только помеха.
    if (e.cancelable) e.preventDefault();
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

  const q = new URLSearchParams(location.search);
  const dev = q.get('dev') === '1';
  // Автономный режим: игра без сервера, на одном localStorage. Нужен и
  // для разработки, и как честный ответ на «сервер не поднят».
  const solo = q.get('offline') === '1' || dev;

  // Вход спрашивается ДО всего: состояние с сервера главнее местного, и
  // применять сначала кэш, а потом поверх серверное — значит на секунду
  // показать игроку чужое положение корабля.
  let restored = false;
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
        sys: sys.id,
        x: ship.pos.x, y: ship.pos.y, z: ship.pos.z,
        v: ship.speed,
        // Осанка корабля, а не только след: без неё чужой корабль нечем
        // развернуть, и на месте он смотрел бы в никуда.
        fwd: ship.basis.fwd, up: ship.basis.up,
        mode: game.state.mode === ST.DOCKED ? 'docked'
          : game.state.mode === ST.LANDED ? 'landed'
            : game.warp.phase === 'tunnel' ? 'warp' : 'flight',
      }));
    } else {
      // Вход есть, а связи нет. Играем с местного кэша и продолжаем
      // попытки — накопленное уйдёт, как только сервер ответит.
      restored = load();
      say(game.state, 'СЕРВЕР НЕ ОТВЕЧАЕТ · АВТОНОМНЫЙ РЕЖИМ', '#ffcc66', 6);
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

  sound.setMuted(!game.audio.on);
  sound.setVolume(game.audio.vol);

  const bootEl = document.getElementById('boot');
  const startBtn = document.getElementById('bootBtn');
  // Полный экран — со стартового экрана: там есть настоящее нажатие,
  // которого требует браузер, и это единственный момент, когда игрок
  // заведомо смотрит на кнопку. На iPhone режима нет вовсе, поэтому
  // кнопки там нет, а вместо неё — подсказка про «На экран Домой».
  const fsBtn = document.getElementById('fsBtn');
  if (fsBtn && fullscreenAvailable()) {
    fsBtn.style.display = '';
    fsBtn.addEventListener('click', () => toggleFullscreen());
  }
  const hint = document.getElementById('touchHint');
  if (hint && Q.touchUi) hint.style.display = '';
  const start = () => {
    booted = true;
    wake();
    bootEl.classList.add('hidden');
    if (game.state.mode === ST.DOCKED) game.launch();
    else hideOverlay();
    say(game.state, 'СИСТЕМА ' + world.name.toUpperCase() +
      ' — ЦЕЛЬ: ' + (currentTarget(game.nav) ? currentTarget(game.nav).name : '—'));
  };
  startBtn.addEventListener('click', start);

  // Дальность старта показываем в отладке, а сцену рисуем сразу.
  requestAnimationFrame(frame);
}

boot();

// Полезно для отладки из консоли браузера.
window.GAME = game;
window.fmtDist = fmtDist;
window.dot = dot;
window.clamp = clamp;
