// Точка входа: сборка мира, игровой цикл с фиксированным шагом физики,
// обработка глобальных клавиш и отрисовка кадра.

import { v3, normalize, dot, clamp } from './core/vec3.js';
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
import { makeShip, updateShip, readControls, clearControls, placeShip, SHIP } from './game/ship.js';
import {
  makeNav, refreshNav, pickTarget, aimedTarget, currentTarget, navInfo, targetById,
} from './game/nav.js';
import {
  makeQuantum, updateQuantum, startCalibration, stopQuantum, canJump, suggestHop, QUANTUM,
} from './game/quantum.js';
import {
  checkStation, startDockingComputer, stopDockingComputer,
  updateDockingComputer, DOCK_RANGE,
} from './game/docking.js';
import { isLandable, localDir, groundRadius, worldPoint } from './game/surface.js';
import { captureBody, carryShip, gravityField } from './game/gravity.js';
import { entryState } from './game/entry.js';
import {
  toggleGear, updateGear, gearLabel, landingContext,
  startLanding, stopLanding, updateLandingComputer, checkTouchdown, bounceOff, settle,
  updateLandedPose, takeoff, landingReadout, landedInfo, LAND,
} from './game/landing.js';
import { makeState, say, updateMessages, ST } from './game/state.js';
import { makeAudio, updateAudio, playAudio, audioCue, audioReset, audioLine } from './game/audio.js';
import { drawHud, makeDockAssist, fmtDist } from './ui/hud.js';
import {
  showDocked, showCrash, showHelp, showLanded, hideOverlay,
} from './ui/screens.js';
import { makeMap, drawMap, mapInput, resetMap } from './ui/map.js';
import { makeDebug, tickDebug, drawDebug } from './ui/debug.js';

const STEP = 1 / 60;
const SAVE_KEY = 'solar_trader_save_v1';
const SCANNER_STEPS = [5, 25, 120, 600, 3000, 20000];

// Высоты для телепорта к цели (клавиша K) — от «вся планета в кадре» до
// «прямо над грунтом». Инструмент для проверки картинки: пройти весь
// диапазон подлёта за несколько нажатий, не тратя минуты на перелёт.
const TELEPORT_ALTS = [2000, 400, 100, 20, 3, 0.3, 0.05];

const screenCanvas = document.getElementById('screen');
const hudCanvas = document.getElementById('hud');
const starfield = new Starfield(950, 0x51ee7);

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

const world = makeSystem(0x1a7e);
const ship = makeShip();
const shipMesh = buildCobra();
const stationMesh = buildStation();
const gearMesh = buildGear();

const game = {
  world, ship, shipMesh, stationMesh, gearMesh,
  renderer: hud,
  renderStats: { polys: 0, items: 0, backend: scene ? 'WebGL' : 'Canvas 2D' },
  nav: makeNav(world),
  map: makeMap(),        // состояние карты системы: масштаб, центр, выбор
  quantum: makeQuantum(),
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
  capture: null,         // тело, в чьём гравитационном захвате корабль
  camOrbit: { yaw: 0, pitch: 0 },   // осмотр камерой из-за спины (ПКМ)
  camera,                // та же камера, что у рендера: нужна приборам и проверкам
  landInfo: null,        // показания посадочного дисплея
  statusLine: null,
  scanBlips: [],
  scannerRange: 120,
  stats: { docks: 0, crashes: 0, flownKm: 0, landings: 0 },
  crashReason: '',
  lastStation: null,
  teleAlt: 2,            // номер текущей высоты телепорта (клавиша K)
  restartArmed: 0,       // сколько ещё ждём подтверждения рестарта, с
};

const dbg = makeDebug();
let booted = false;
const _sun = v3();
const _camDir = v3();
const _camRight = v3();
const _tmp = v3();

// --- переходы состояний ------------------------------------------------------

function dockAt(station) {
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
  ship.hull = SHIP.maxHull;
  game.state.mode = ST.DOCKED;
  audioCue(game.audio, 'dock');
  audioReset(game.audio, ship);
  input.releaseAll();
  showDocked(game);
  save();
}

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
  input.releaseAll();
  showLanded(game);
  save();
}

game.takeoff = () => {
  hideOverlay();
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

  world.time = 0;
  updateWorld(world, 0);
  stopQuantum(game.quantum);
  game.stats = { docks: 0, crashes: 0, flownKm: 0, landings: 0 };
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
  else if (ship.landedAt) showLanded(game);
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

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
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
      landed: ship.landedAt ? { id: ship.landedAt.id, pose: ship.landedPose } : null,
      gear: ship.gear.out,
      audio: { on: game.audio.on, vol: game.audio.vol },
      stats: game.stats,
      time: world.time,
    }));
  } catch (e) { /* приватный режим — просто не сохраняем */ }
}

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { s = null; }
  if (!s) return false;
  const findStation = (id) => world.stations.find((x) => x.id === id) || null;
  updateWorld(world, s.time || 0);
  game.stats = Object.assign({ landings: 0 }, s.stats || game.stats);
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

  if (s.landed && s.landed.pose) {
    const body = world.bodies.find((b) => b.id === s.landed.id);
    if (body) {
      ship.landedAt = body;
      ship.landedPose = s.landed.pose;
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
  if (s.pos && s.basis) {
    placeShip(ship, s.pos, s.basis);
    game.state.mode = ST.FLIGHT;
    return 'flight';
  }
  return false;
}

// --- глобальные клавиши ------------------------------------------------------

function handleKeys() {
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
    else if (st.mode === ST.LANDED) showLanded(game);
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
    if (input.pressed('Space', 'Enter')) game.takeoff();
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
    else if (q.phase === 'jump') { stopQuantum(q); say(st, 'ПРЫЖОК СОРВАН', '#ff7a66'); }
  }

  // B — квантовый привод: включить калибровку, а на ходу — сорвать прыжок.
  if (input.pressed('KeyB')) {
    const q = game.quantum;
    if (q.phase === 'jump') { stopQuantum(q); say(st, 'ПРЫЖОК СОРВАН', '#ff7a66'); }
    else if (q.phase === 'calib') { stopQuantum(q); say(st, 'ПРИВОД ОТКЛЮЧЁН'); }
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
  updateWorld(world, dt);

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

  // --- квантовый прыжок: корабль ведёт привод, и больше в этом шаге не
  // происходит ничего. Ни столкновений, ни атмосферы, ни посадки —
  // коридор проверен заранее, а лететь на 60 000 км/с мимо проверок
  // касания всё равно нельзя: за кадр корабль проходит тысячу километров.
  const q = game.quantum;
  if (q.phase === 'jump') {
    const ev = updateQuantum(q, ship, world, dt);
    game.stats.flownKm += ship.speed * dt;
    game.entry = null;
    game.zone = null;
    if (ev === 'arrive') {
      say(st, 'ВЫХОД ИЗ ПРЫЖКА', '#78e08f');
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
function updateCamOrbit(dt) {
  const o = game.camOrbit;
  input.takeDrag(_drag);
  const look = input.mouse.right && game.state.view === 'chase' &&
    game.state.mode === ST.FLIGHT;
  if (look) {
    o.yaw = clamp(o.yaw + _drag.x * LOOK, -Math.PI, Math.PI);
    o.pitch = clamp(o.pitch + _drag.y * LOOK, -1.2, 1.2);
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

  // Не сумма, а что сильнее: в прыжке форсаж всё равно недоступен, и
  // складывать их значит получить угол, которого не задумывал никто.
  const want = Math.max(jump, boost);
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

function setupCamera() {
  const cam = camera;
  cam.basis.right = { ...ship.basis.right };
  cam.basis.up = { ...ship.basis.up };
  cam.basis.fwd = { ...ship.basis.fwd };
  if (game.state.view === 'chase') {
    const b = ship.basis;
    const o = game.camOrbit;
    // Направление взгляда = нос корабля, повёрнутый на осмотр.
    rotAround(b.fwd, b.up, o.yaw, _camDir);
    rotAround(_camDir, rotAround(b.right, b.up, o.yaw, _camRight), o.pitch, _camDir);
    lookAlong(cam.basis, _camDir, b.up);
    cam.pos.x = ship.pos.x - _camDir.x * CHASE_BACK + b.up.x * CHASE_UP;
    cam.pos.y = ship.pos.y - _camDir.y * CHASE_BACK + b.up.y * CHASE_UP;
    cam.pos.z = ship.pos.z - _camDir.z * CHASE_BACK + b.up.z * CHASE_UP;
  } else {
    // Кокпит: чуть впереди центра масс, на уровне фонаря.
    const b = ship.basis;
    cam.pos.x = ship.pos.x + b.fwd.x * 0.012 + b.up.x * 0.006;
    cam.pos.y = ship.pos.y + b.fwd.y * 0.012 + b.up.y * 0.006;
    cam.pos.z = ship.pos.z + b.fwd.z * 0.012 + b.up.z * 0.006;
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
      for (const hp of gearMesh.hardpoints) {
        _tmp.x = ship.pos.x + b.right.x * hp.x + b.up.x * hp.y + b.fwd.x * hp.z;
        _tmp.y = ship.pos.y + b.right.y * hp.x + b.up.y * hp.y + b.fwd.y * hp.z;
        _tmp.z = ship.pos.z + b.right.z * hp.x + b.up.z * hp.y + b.fwd.z * hp.z;
        renderer.drawMesh(gearMesh, _tmp, b, gearMesh.legLength * ship.gear.t, _sun, {});
      }
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

// Курсор виден только на карте (см. css/style.css). Переключаем по
// изменению, а не каждый кадр: трогать DOM в кадре незачем.
let cursorShown = false;

function render() {
  setupCamera();

  const wantCursor = game.state.mode === ST.MAP;
  if (wantCursor !== cursorShown) {
    cursorShown = wantCursor;
    screenCanvas.classList.toggle('map', wantCursor);
  }

  if (scene) scene.render(game);
  else render2d();

  const st = game.renderStats;
  st.polys = scene ? scene.tris : renderer.polys;
  st.items = scene ? scene.draws : renderer.items.length;
  st.gpu = scene ? scene.name : null;
  st.pending = scene ? scene.pending || 0 : 0;
  st.detail = scene ? !!scene.detailOn : false;
  st.patches = scene && scene.patch ? scene.patch.levels : 0;
  st.patchBuilds = scene && scene.patch ? scene.patch.rebuilds : 0;
  // Состояние кэша плиток: по нему в отладке видно и загрузку рельефа,
  // и то, в потоках ли она считается.
  st.tiles = scene && scene.tiles && scene.tiles.body ? scene.tiles.stats : null;

  // Приборы — отдельным прозрачным слоем, одинаково для обоих рендеров.
  hud.begin();
  if (game.state.mode === ST.MAP) drawMap(hud, game);
  else if (game.state.mode === ST.FLIGHT) drawHud(hud, game);
  drawDebug(hud, game, dbg);
}

// --- цикл --------------------------------------------------------------------

let last = performance.now();
let acc = 0;
let saveTimer = 0;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;      // после переключения таба не «телепортируемся»
  tickDebug(dbg, dt);

  handleKeys();

  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 6) {
    step(STEP);
    acc -= STEP;
    steps++;
  }
  if (acc > STEP) acc = 0;

  updateMessages(game.state, dt);
  if (game.restartArmed > 0) game.restartArmed = Math.max(0, game.restartArmed - dt);
  updateCamOrbit(dt);
  updateFov(dt);
  // Звук идёт по времени игрока, а не по шагам физики: круизный
  // ускоритель множит перемещение, но не частоту кадров, и гул движков
  // от него меняться не должен.
  updateAudio(game.audio, game, dt);
  playAudio(game.audio, sound);
  if (game.state.mode === ST.FLIGHT) prepareHud();

  render();
  input.endFrame();

  saveTimer += dt;
  if (saveTimer > 5) { saveTimer = 0; save(); }

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

function resizeAll() {
  hud.resize();
  if (renderer) renderer.resize();
  if (scene) scene.resize();
}

function boot() {
  input.attach(window);
  input.attachMouse(window);

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
  window.addEventListener('beforeunload', save);

  ship.mesh = shipMesh;

  const dev = new URLSearchParams(location.search).get('dev') === '1';
  const restored = dev ? false : load();
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
