// Точка входа: сборка мира, игровой цикл с фиксированным шагом физики,
// обработка глобальных клавиш и отрисовка кадра.

import { v3, normalize, dot, clamp } from './core/vec3.js';
import { makeBasis, dirToWorld } from './core/basis.js';
import { input } from './core/input.js';
import { Renderer } from './render/renderer.js';
import { Camera } from './render/camera.js';
import { Starfield } from './render/starfield.js';
import { drawBody } from './render/planetview.js';
import { GlScene } from './gl/scene.js';
import { buildCobra } from './models/ships.js';
import { buildStation, STATION_D } from './models/station.js';
import { makeSystem, updateWorld, nearestBody } from './game/world.js';
import { makeShip, updateShip, readControls, clearControls, placeShip, SHIP } from './game/ship.js';
import { makeCruise, updateCruise, stepCruise, resetCruise, LEVELS } from './game/cruise.js';
import { makeNav, cycleTarget, currentTarget, navInfo, startAutopilot, stopAutopilot, updateAutopilot } from './game/nav.js';
import {
  checkStation, startDockingComputer, stopDockingComputer,
  updateDockingComputer, DOCK_RANGE,
} from './game/docking.js';
import { makeState, say, updateMessages, ST } from './game/state.js';
import { drawHud, makeDockAssist, fmtDist } from './ui/hud.js';
import { showDocked, showCrash, showHelp, hideOverlay, drawMap } from './ui/screens.js';
import { makeDebug, tickDebug, drawDebug } from './ui/debug.js';

const STEP = 1 / 60;
const SAVE_KEY = 'solar_trader_save_v1';
const SCANNER_STEPS = [5, 25, 120, 600, 3000, 20000];

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

const game = {
  world, ship, shipMesh, stationMesh,
  renderer: hud,
  renderStats: { polys: 0, items: 0, backend: scene ? 'WebGL' : 'Canvas 2D' },
  nav: makeNav(world),
  cruise: makeCruise(),
  state: makeState(),
  info: null,
  nearest: null,
  dockAssist: null,
  statusLine: null,
  scanBlips: [],
  scannerRange: 120,
  stats: { docks: 0, crashes: 0, flownKm: 0 },
  crashReason: '',
  lastStation: null,
};

const dbg = makeDebug();
let booted = false;
const _sun = v3();
const _tmp = v3();

// --- переходы состояний ------------------------------------------------------

function dockAt(station) {
  ship.dockedAt = station;
  game.lastStation = station;
  stopAutopilot(ship);
  stopDockingComputer(ship);
  resetCruise(game.cruise);
  ship.speed = 0;
  ship.throttle = 0;
  ship.hull = SHIP.maxHull;
  game.state.mode = ST.DOCKED;
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
  say(game.state, 'ВЫЛЕТ РАЗРЕШЁН. УДАЧНОГО ПОЛЁТА.', '#78e08f');
  input.releaseAll();
};

game.respawn = () => {
  hideOverlay();
  ship.hull = SHIP.maxHull;
  const st = game.lastStation || (world.home && world.home.station);
  if (st) dockAt(st);
  else { game.state.mode = ST.FLIGHT; }
};

game.closeOverlay = () => {
  hideOverlay();
  game.state.mode = ship.dockedAt ? ST.DOCKED : ST.FLIGHT;
  if (ship.dockedAt) showDocked(game);
};

function crash(reason) {
  game.crashReason = reason;
  game.stats.crashes++;
  ship.hull = 0;
  ship.speed = 0;
  ship.throttle = 0;
  stopAutopilot(ship);
  stopDockingComputer(ship);
  game.state.mode = ST.CRASHED;
  input.releaseAll();
  showCrash(game);
}

// --- сохранение --------------------------------------------------------------

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      pos: ship.pos,
      basis: ship.basis,
      hull: ship.hull,
      target: game.nav.index,
      view: game.state.view,
      docked: ship.dockedAt ? ship.dockedAt.id : null,
      last: game.lastStation ? game.lastStation.id : null,
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
  game.stats = s.stats || game.stats;
  game.nav.index = s.target || 0;
  game.state.view = s.view || 'cockpit';
  ship.hull = s.hull || SHIP.maxHull;
  game.lastStation = findStation(s.last);
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

  if (input.pressed('KeyH')) {
    if (st.mode === ST.HELP) game.closeOverlay();
    else if (st.mode === ST.FLIGHT || st.mode === ST.MAP) { st.mode = ST.HELP; showHelp(game); }
    return;
  }

  if (input.pressed('KeyM')) {
    if (st.mode === ST.MAP) st.mode = ship.dockedAt ? ST.DOCKED : ST.FLIGHT;
    else if (st.mode === ST.FLIGHT) st.mode = ST.MAP;
    if (st.mode === ST.DOCKED) showDocked(game);
    return;
  }

  if (st.mode === ST.DOCKED) {
    if (input.pressed('Space', 'Enter')) game.launch();
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

  if (input.pressed('Tab')) {
    const dir = input.isDown('ShiftLeft', 'ShiftRight') ? -1 : 1;
    const t = cycleTarget(game.nav, dir);
    say(st, 'ЦЕЛЬ: ' + (t ? t.name : '—'));
    if (ship.autopilot) { stopAutopilot(ship); say(st, 'АВТОПИЛОТ ОТКЛЮЧЁН'); }
  }

  if (input.pressed('KeyT')) {
    stepCruise(game.cruise, 1);
    if (game.cruise.massLocked) say(st, 'MASS LOCK — КРУИЗ НЕДОСТУПЕН', '#ff7a66');
  }
  if (input.pressed('KeyY')) stepCruise(game.cruise, -1);

  if (input.pressed('KeyJ')) {
    if (ship.autopilot) { stopAutopilot(ship); say(st, 'АВТОПИЛОТ ОТКЛЮЧЁН'); }
    else {
      const t = currentTarget(game.nav);
      startAutopilot(ship, t);
      stopDockingComputer(ship);
      say(st, 'АВТОПИЛОТ: КУРС НА ' + (t ? t.name : '—'), '#78e08f');
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

  // Любое ручное вмешательство отключает автоматику.
  if (ship.autopilot || ship.docking) {
    if (input.isDown('KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight') ||
      input.pressed('KeyX', 'KeyF')) {
      if (ship.autopilot) stopAutopilot(ship);
      if (ship.docking) stopDockingComputer(ship);
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

  if (st.mode === ST.DOCKED) {
    // Корабль стоит в порту и едет вместе со станцией.
    const s = ship.dockedAt;
    if (s) { ship.pos.x = s.pos.x; ship.pos.y = s.pos.y; ship.pos.z = s.pos.z; }
    return;
  }
  if (st.mode !== ST.FLIGHT) return;

  clearControls(ship);
  game.statusLine = null;

  if (ship.docking) {
    // Стыковка считает скорости «как есть»: круизный ускоритель обязан
    // быть выключен, иначе подход к створу идёт в десять раз быстрее
    // расчётного и корабль проскакивает порт.
    game.cruise.index = 0;
    game.statusLine = updateDockingComputer(ship, dt);
  } else if (ship.autopilot) {
    const wantIdx = updateAutopilot(ship, world, dt);
    if (wantIdx !== null) game.cruise.index = wantIdx;
    if (ship.autopilot.arrived) {
      const t = ship.autopilot.target;
      stopAutopilot(ship);
      say(st, 'ПРИБЫЛИ: ' + t.name, '#78e08f');
      if (t.isStation) {
        const res = startDockingComputer(ship, t);
        if (res.ok) say(st, 'ДОКИНГ-КОМПЬЮТЕР ВКЛЮЧЁН', '#78e08f');
      }
    }
  } else {
    readControls(ship);
  }

  const level = updateCruise(game.cruise, world, ship, dt);
  updateShip(ship, dt, dt * level);
  game.stats.flownKm += ship.speed * level * dt;

  // Столкновения с телами.
  game.nearest = nearestBody(world, ship.pos);
  if (game.nearest.gap <= 0) {
    crash('Столкновение с ' + game.nearest.body.name + '.');
    return;
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
  const target = currentTarget(game.nav);
  game.info = navInfo(ship, target, game.cruise.level);

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

  if (game.cruise.massLocked && game.cruise.index > 0) {
    say(game.state, 'MASS LOCK: ' + game.cruise.lockedBy.name, '#ff7a66', 1.2);
  }
}

// --- отрисовка ---------------------------------------------------------------

function setupCamera() {
  const cam = camera;
  cam.basis.right = { ...ship.basis.right };
  cam.basis.up = { ...ship.basis.up };
  cam.basis.fwd = { ...ship.basis.fwd };
  if (game.state.view === 'chase') {
    const b = ship.basis;
    cam.pos.x = ship.pos.x - b.fwd.x * 0.20 + b.up.x * 0.055;
    cam.pos.y = ship.pos.y - b.fwd.y * 0.20 + b.up.y * 0.055;
    cam.pos.z = ship.pos.z - b.fwd.z * 0.20 + b.up.z * 0.055;
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

  if (game.state.view === 'chase' && game.state.mode === ST.FLIGHT) {
    normalize(v3(sunPos.x - ship.pos.x, sunPos.y - ship.pos.y, sunPos.z - ship.pos.z), _sun);
    renderer.drawMesh(shipMesh, ship.pos, ship.basis, 1, _sun, {});
    if (ship.throttle > 0.03) {
      for (const e of shipMesh.exhausts) {
        dirToWorld(ship.basis, e, _tmp);
        _tmp.x += ship.pos.x; _tmp.y += ship.pos.y; _tmp.z += ship.pos.z;
        renderer.drawGlow(_tmp, 6 + 22 * ship.throttle, 'rgb(255,150,60)');
      }
    }
  }

  renderer.end();
}

function render() {
  setupCamera();

  if (scene) scene.render(game);
  else render2d();

  const st = game.renderStats;
  st.polys = scene ? scene.tris : renderer.polys;
  st.items = scene ? scene.draws : renderer.items.length;
  st.gpu = scene ? scene.name : null;

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
  game.nav.index = game.nav.list.indexOf(st);
}

function resizeAll() {
  hud.resize();
  if (renderer) renderer.resize();
  if (scene) scene.resize();
}

function boot() {
  input.attach(window);
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
    if (away) game.nav.index = game.nav.list.indexOf(away);
  }

  const bootEl = document.getElementById('boot');
  const startBtn = document.getElementById('bootBtn');
  const start = () => {
    booted = true;
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
window.LEVELS = LEVELS;
window.dot = dot;
window.clamp = clamp;
