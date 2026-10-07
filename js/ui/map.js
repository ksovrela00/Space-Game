// Карта системы и галактики — трёхмерная.
//
// ЧТО БЫЛО. Карта была планом на плоскости орбит: кружки, подписи и
// крестик корабля поверх тёмной заливки. Высоту она теряла целиком
// (маркеры над полюсами ложились на диск тела), подписи налезали одна на
// другую, а галактика назначала цель варпа уже тем, что её открыли, и
// давала выбрать систему, до которой бак не достаёт. На телефоне она не
// управлялась вовсе: касания карте не доходили, и закрыть её было нечем.
//
// ЧТО ТЕПЕРЬ. Карта — модель на столе, которую вертят руками:
//
//   * сцену рисует видеокарта той же программой, что и полёт: настоящие
//     планеты с рельефом и морями, освещённые своим солнцем, корона
//     звезды, кольца, небо этой системы (js/gl/scene.js, renderMap). Тело,
//     которое мельче нескольких пикселей, рисуется не меньше их — иначе
//     на обзоре системы его не было бы вовсе, — но остаётся шаром под
//     своим светом, а не кружком;
//   * поверх — слой приборов: орбиты с затухающим следом за телом (видно,
//     куда оно идёт), сетка плоскости с подписанными кругами (это и есть
//     масштаб), «ножки» высоты над плоскостью, значки, подписи без
//     наложений и карточка выбранного с кнопками действий;
//   * камера облетает выбранное (js/game/mapcam.js): тянуть левой —
//     вращать, правой — сдвигать, колесо — масштаб, двойной щелчок —
//     подлететь. Пальцами: тянуть, щипок, касание и двойное касание;
//   * галактика — тоже трёхмерная: системы светятся своим классом, между
//     ними дороги (прыжки, на которые хватает полного бака), круг дальности
//     с тем, что в баке сейчас, и маршрут через соседей, если напрямую не
//     долететь (js/game/warproute.js). Варп и квантовый прыжок запускаются
//     прямо отсюда.
//
// Всё, что карточка пишет о теле, взято из модели мира (js/game/bodyinfo.js):
// подписи, не подтверждённой числом из мира, в ней нет.
//
// Стиль — приборов (README, «Облик: ни одной рамки»): колонки очерчены
// одной вертикальной чертой, группы — волосяными разделителями, клавиша —
// прямо у действия. Размер растёт с экраном (Q.hudScale).

import { Camera } from '../render/camera.js';
import { Q } from '../core/quality.js';
import { L } from '../core/lang.js';
import { CY, CY_DIM, AMBER, GREEN, RED, INK, PEER, NPC_COLOR } from './theme.js';
import { fmtDist, fmtTime } from './hud.js';
import { CITY_KINDS } from '../models/city.js';
import {
  KIND_INFO, kindLabel, massOf, escapeSpeed, dayLength, atmosphereOf,
  temperatureOf, toCelsius, EARTH_MASS, starDistance,
} from '../game/bodyinfo.js';
import { DENSITY } from '../game/gravity.js';
import { isLandable, isSolid, hasSea } from '../game/surface.js';
import { LIMITS } from '../game/docking.js';
import { canJump } from '../game/quantum.js';
import { currentTarget } from '../game/nav.js';
import { say } from '../game/state.js';
import { galaxy, systemDistance, warpSeconds, SPREAD } from '../game/galaxy.js';
import { fleetMarks } from '../game/fleet.js';
import { warpRange, warpTons, fuelReserve } from '../game/fuel.js';
import { canWarp } from '../game/warp.js';
import { planRoute, roads, hopLimit } from '../game/warproute.js';
import {
  MAPCAM, makeMapCam, snapMapCam, stepMapCam, poseCamera, turnMapCam, zoomMapCam,
  panMapCam, followObj, distFor,
} from '../game/mapcam.js';

const PALE = '#9fd9ff';
const MONO = 'Consolas, "DejaVu Sans Mono", monospace';
const TAU = Math.PI * 2;

// Масштаб: единица — вся система в кадре. Отдалить можно чуть дальше
// обзора (видно край системы с запасом), приблизить — до самого тела:
// ближний предел ставит то, за чем едет вид (minDist).
const ZOOM_MIN = 0.35;

// Наименьший видимый размер тела, пикселей (на Q.hudScale): меньше —
// шар превращается в точку, и уже не видно, освещён ли он.
const MIN_PX = { star: 9, gas: 6, moon: 3.2, planet: 4.6 };

// Касание: сдвиг меньше этого — касание, больше — жест.
const TAP_PX = 9;
// Двойной щелчок или касание — за это время, секунд.
const DOUBLE = 0.42;

export function makeMap() {
  const map = {
    // Открыта ли карта. Это слой поверх игры, а не режим: под ним корабль
    // летит дальше (js/main.js, «карта и справка»).
    open: false,
    // Карта одна, а видов у неё два: система и галактика. Это тот же
    // вопрос «куда лететь», только на другом масштабе.
    view: 'system',        // system | galaxy
    sel: null,             // выбранный объект системы (о нём карточка)
    hover: null,
    gsel: null,            // выбранная система (вид галактики)
    ghover: null,
    route: null,           // маршрут до выбранной системы (warproute)
    cam: makeMapCam(),     // облёт системы
    gcam: makeMapCam(),    // облёт галактики
    camera: new Camera(),  // проекция этого кадра (обоих видов)
    zoom: 1,               // во сколько раз ближе обзора всей системы (по цели вида)
    scale: 0,              // пикселей на километр у фокуса (по цели вида)
    items: [],             // что нарисовано в этом кадре — по нему ищут попадание
    vis: new Map(),        // тело -> его значок этого кадра (для орбит и подписей)
    // Что рисует видеокарта (js/gl/scene.js, renderMap).
    gl: { mode: 'system', bodies: [], rings: [], glows: [] },
    glDrawn: false,        // нарисовала ли сцена этот кадр (без WebGL2 — нет)
    // Свободная часть кадра между колонками: по ней считается «вся
    // система в кадре».
    vx: 0, vy: 0, vw: 1, vh: 1, W: 0, H: 0,
    ui: { k: 1, list: null, card: null, narrow: false },
    buttons: [],           // кнопки этого кадра: по ним ловится щелчок
    lrows: [],             // строки списка объектов
    rows: [],              // строки «МОИ КОРАБЛИ»
    listOpen: false,       // список на узком экране — по кнопке
    scroll: 0,             // прокрутка списка, пикселей
    mx: -1, my: -1,        // курсор
    press: null,           // нажатие мыши: где, на чём, сколько протащили
    last: { obj: null, t: -9 },   // прошлый щелчок — для двойного
    tg: null,              // жест пальцами
    t: 0,                  // часы карты, секунд
    cursor: 'default',     // курсор над тем, что под ним
    // Свои корабли (js/game/fleet.js): значки на плане, список «МОИ
    // КОРАБЛИ» и строки списка, по которым ловится щелчок.
    fleet: new Map(),
    marks: [],
    shipIdx: -1,
    peers: [],             // чужие корабли этого кадра: значки
  };
  // Слежение — у камеры; снаружи оно читается и сбрасывается как свойство
  // карты (js/main.js при смене системы).
  Object.defineProperty(map, 'follow', {
    get() { return this.view === 'galaxy' ? this.gcam.follow : this.cam.follow; },
    set(v) { if (this.view === 'galaxy') this.gcam.follow = v; else this.cam.follow = v; },
    enumerable: true,
  });
  return map;
}

/** Свои корабли на этот кадр: значки и строки списка (js/game/fleet.js). */
export function fleetOf(game) {
  const ship = game.ship, map = game.map;
  const own = {
    id: ship.id === undefined ? null : ship.id, pos: ship.pos, away: !!ship.away,
    dockedAt: ship.dockedAt || null, landedAt: ship.landedAt || null, near: game.capture || null,
  };
  return fleetMarks(game.fleet, game.world, game.sys ? game.sys.id : null, own, map.fleet, map.marks);
}

// --- геометрия ---------------------------------------------------------------

const outerOrbit = (world) => world.planets[world.planets.length - 1].orbit.radius;

/** Фокусное расстояние кадра, пикселей (по высоте всего кадра). */
const focalOf = (map) => ((map.H || map.vh) / 2) / Math.tan(MAPCAM.fov / 2);

/** Дистанция «вся система в кадре», км. */
export function fitDist(map, world) {
  return distFor(outerOrbit(world) * 1.06, 0.46, map.H || map.vh, map.vw, MAPCAM.fov);
}

/** Масштаб «вся система в кадре», пикселей на километр у фокуса. */
export const fitScale = (map, world) => focalOf(map) / fitDist(map, world);

/** Дистанция «вся галактика в кадре», св. лет. */
const galaxyDist = (map) => distFor(galaxySpan(), 0.44, map.H || map.vh, map.vw, MAPCAM.fov);

/** Полупоперечник галактики от её середины, св. лет. */
function galaxySpan() {
  const c = galaxyCenter();
  let r = 1;
  for (const s of galaxy().systems) r = Math.max(r, Math.hypot(s.pos.x - c.x, s.pos.y - c.y, s.pos.z - c.z));
  return r * 1.12;
}

/**
 * Насколько крупный «свой мир» у объекта — по нему считается приближение
 * при переходе к нему. Планету показываем вместе с её лунами и станцией,
 * станцию — вместе с её орбитой: иначе выбранное оказывается либо точкой,
 * либо во весь экран.
 */
function spanOf(obj, world) {
  if (!obj) return outerOrbit(world);
  // Свой корабль — вместе с тем, у чего он стоит: в порту — станция с её
  // орбитой, на грунте и у тела — само тело, чтобы значок встал на диск.
  if (obj.isFleet) {
    if (obj.host && obj.host.isStation) return obj.host.orbit.radius * 1.5;
    if (obj.host) return obj.host.radius * 2.5;
    return 3000;
  }
  if (obj.isMarker) return obj.dist * 1.6;
  if (obj.isStation) return obj.orbit.radius * 1.5;
  // Город стоит НА теле: показываем его вместе с телом, иначе карта прыгнула
  // бы в масштаб двух километров, где нет ничего, кроме самого города.
  if (obj.isCity) return obj.body.radius * 3;
  if (obj.kind === 'star') return outerOrbit(world) * 1.06;
  let span = obj.radius * 8;
  for (const m of obj.moons || []) span = Math.max(span, m.orbit.radius * 1.4);
  if (obj.station) span = Math.max(span, obj.station.orbit.radius * 2.5);
  return span;
}

/** Ближе этого к фокусу камера не подходит: внутрь тела смотреть нечего. */
function minDist(obj) {
  if (obj && obj.isBody && obj.radius) return obj.radius * 2.4;
  if (obj && obj.isCity && obj.body) return obj.body.radius * 1.6;
  return 60;
}

/** Показать объект целиком и поехать за ним. */
export function focusOn(map, world, obj) {
  if (!obj) return;
  const mc = map.cam;
  mc.lo = minDist(obj);
  mc.hi = fitDist(map, world) / ZOOM_MIN;
  followObj(mc, obj, distFor(spanOf(obj, world), 0.35, map.H || map.vh, map.vw, MAPCAM.fov));
  syncZoom(map, world);
}

/** Масштаб по цели вида: «×N» и пикселей на километр у фокуса. */
function syncZoom(map, world) {
  if (map.view === 'galaxy') {
    map.zoom = galaxyDist(map) / map.gcam.g.dist;
    map.scale = focalOf(map) / map.gcam.g.dist;
    return;
  }
  map.zoom = fitDist(map, world) / map.cam.g.dist;
  map.scale = focalOf(map) / map.cam.g.dist;
}

/**
 * Вид на всю систему: фокус на звезде, обзорный наклон. Звезда стоит на
 * месте, и вид за ней не «едет» — это точка, а не слежение.
 *
 * Обзор зависит от размера кадра, а он известен только на отрисовке:
 * при открытии карты его могли ещё не посчитать. Поэтому просьба
 * запоминается (fit) и исполняется ещё раз в первом же кадре.
 */
export function resetMap(map, world, snap = true) {
  const mc = map.cam;
  mc.g.yaw = -0.35;
  mc.g.pitch = MAPCAM.pitch;
  if (world && world.star) {
    mc.lo = minDist(world.star);
    mc.hi = fitDist(map, world) / ZOOM_MIN;
    followObj(mc, null);
    mc.g.fx = world.star.pos.x; mc.g.fy = world.star.pos.y; mc.g.fz = world.star.pos.z;
    mc.g.dist = fitDist(map, world);
  }
  if (snap) snapMapCam(mc);
  mc.fit = snap ? 'snap' : 'ease';
  map.route = null;
  if (world) syncZoom(map, world);
}

/** Вид на всю галактику вокруг системы, где корабль. */
function resetGalaxy(map, cur, snap = false) {
  const mc = map.gcam;
  mc.lo = 1.5;
  mc.hi = galaxyDist(map) * 3;
  mc.g.yaw = -0.35;
  mc.g.pitch = 0.62;
  // Фокус — середина галактики, а не наша система: вся ценность вида в
  // том, что семь систем видно разом.
  const c = galaxyCenter();
  followObj(mc, null);
  mc.g.fx = c.x; mc.g.fy = c.y; mc.g.fz = c.z;
  mc.g.dist = galaxyDist(map);
  if (snap) snapMapCam(mc);
  void cur;
}

/** Середина галактики — по рамке систем, а не по среднему: среднее тянет к кучке. */
function galaxyCenter() {
  const s = galaxy().systems;
  const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const x of s) {
    for (const a of ['x', 'y', 'z']) { lo[a] = Math.min(lo[a], x.pos[a]); hi[a] = Math.max(hi[a], x.pos[a]); }
  }
  return { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };
}

/** Сменить вид: система или галактика. */
function switchView(game, view) {
  const map = game.map;
  if (map.view === view) return;
  map.view = view;
  map.items.length = 0;      // попадания курсора считаются от нового вида
  map.scroll = 0;
  if (view === 'galaxy' && !map.gcam.inited) {
    resetGalaxy(map, game.sys, true);
    map.gcam.inited = true;
  }
  if (view === 'galaxy' && !map.gsel && game.warpTarget) map.gsel = destOf(game) || game.warpTarget;
}

// --- список объектов ---------------------------------------------------------

const markerHost = (sel) => {
  if (!sel) return null;
  if (sel.isMarker) return sel.body;
  if (sel.isStation) return sel.parent;
  if (sel.isCity) return sel.body;
  return sel.isBody ? sel : null;
};

/**
 * Всё, что может быть выбрано, в порядке обхода системы.
 * Маркеры попадают сюда только у выбранного тела: их шесть на каждое
 * тело, и в общем списке они хоронят всё остальное.
 */
export function mapObjects(world, sel, out = []) {
  out.length = 0;
  out.push(world.star);
  for (const p of world.planets) {
    out.push(p);
    if (p.station) out.push(p.station);
    if (p.city) out.push(p.city);
    for (const m of p.moons) {
      out.push(m);
      if (m.city) out.push(m.city);
    }
  }
  const host = markerHost(sel);
  if (host && host.markers) for (const m of host.markers) out.push(m);
  return out;
}

/** Строки списка: объект и глубина в дереве (звезда — планета — её спутники). */
function treeRows(world, out = []) {
  out.length = 0;
  out.push({ obj: world.star, depth: 0 });
  for (const p of world.planets) {
    out.push({ obj: p, depth: 0 });
    if (p.station) out.push({ obj: p.station, depth: 1 });
    if (p.city) out.push({ obj: p.city, depth: 1 });
    for (const m of p.moons) {
      out.push({ obj: m, depth: 1 });
      if (m.city) out.push({ obj: m.city, depth: 2 });
    }
  }
  return out;
}

/** Системы галактики по удалённости от текущей — по ним ходят стрелки. */
export function galaxyList(cur) {
  const all = galaxy().systems.slice();
  all.sort((a, b) => systemDistance(cur, a) - systemDistance(cur, b));
  return all;
}

/**
 * Что под курсором. Ищем среди нарисованного — по экрану, а не по миру.
 *
 * Маркер уступает телу, даже если лежит к курсору ближе: это точка в
 * пустоте ВОКРУГ того же тела, и когда они рядом, целятся в тело.
 * Обратное неверно — попасть в маркер мимо тела ничто не мешает. У
 * крупного диска попадание — весь диск, а не только его середина.
 */
export function pickAt(map, x, y, reach = 13) {
  let best = null, bestD = Infinity;
  let mark = null, markD = Infinity;
  for (const it of map.items) {
    if (it.passive) continue;
    const dx = it.sx - x, dy = it.sy - y;
    const d = Math.hypot(dx, dy);
    const r = Math.max(reach, (it.r || 0) + 4);
    if (d > r) continue;
    // Из двух перекрытых — ближнее к курсору, а при равенстве ближнее к глазу.
    const score = d - Math.min(d, it.r || 0) * 0.5 + (it.z ? 1e-9 * it.z : 0);
    if (it.obj.isMarker) { if (score < markD) { markD = score; mark = it.obj; } }
    else if (score < bestD) { bestD = score; best = it.obj; }
  }
  return best || mark;
}

// --- кадр ----------------------------------------------------------------------

/**
 * Вёрстка: колонки, верхняя полоса, подсказки. На широком экране список
 * слева, карточка справа; на узком (телефон) список — по кнопке, а
 * карточка — снизу, как шторка.
 */
function layout(map, W, H) {
  const k = Q.hudScale;
  const U = map.ui;
  const pad = Math.round(16 * k);
  const narrow = W < 940 * k || H < 520;
  const top = Math.round(60 * k);
  const bot = Math.round(30 * k);
  U.k = k; U.pad = pad; U.narrow = narrow; U.top = top; U.bot = bot;
  map.W = W; map.H = H;
  if (!narrow) {
    const lw = Math.round(Math.min(250 * k, W * 0.24));
    const cw = Math.round(Math.min(340 * k, W * 0.3));
    U.list = { x: pad, y: top, w: lw, h: H - top - bot - pad };
    U.card = { x: W - pad - cw, y: top, w: cw, h: H - top - bot - pad };
    map.vx = U.list.x + lw + pad;
    map.vw = Math.max(80, U.card.x - pad - map.vx);
    map.vy = top;
    map.vh = Math.max(80, H - top - bot);
  } else {
    const lw = Math.round(Math.min(W - pad * 2, 300 * k));
    // Под кнопкой «☰», а не на ней: кнопкой список и закрывают.
    const ly = top + Math.round(38 * k);
    U.list = map.listOpen ? { x: pad, y: ly, w: lw, h: Math.round(Math.min(H * 0.55, H - ly - 10 * k)) } : null;
    const ch = Math.round(Math.min(H * 0.4, 280 * k));
    U.card = { x: pad, y: H - bot - ch, w: W - pad * 2, h: ch - Math.round(6 * k) };
    map.vx = 0; map.vw = W;
    map.vy = top;
    map.vh = Math.max(80, U.card.y - top);
  }
}

const _c = { x: 0, y: 0, z: 0 }, _s = { x: 0, y: 0 };

/**
 * Кадр карты: камера догоняет цель, всё, что видно, — на экран. Зовётся
 * ДО отрисовки сцены (js/main.js): видеокарте нужен тот же список тел и
 * та же камера, что и слою приборов, иначе значки разъедутся с шарами.
 */
export function mapFrame(game, W, H, dt) {
  const map = game.map;
  map.t += Math.max(0, dt);
  layout(map, W, H);
  const cam = map.camera;
  cam.fov = MAPCAM.fov;
  cam.near = 1e-9;
  cam.resize(W, H);
  fleetOf(game);
  if (map.view === 'galaxy') galaxyFrame(game, map, dt);
  else systemFrame(game, map, dt);
}

/** Радиус значка тела: не меньше MIN_PX, а крупнее — каким его видно. */
function bodyMin(b, k) {
  const m = b.kind === 'star' ? MIN_PX.star : b.kind === 'gas' ? MIN_PX.gas
    : b.kind === 'moon' ? MIN_PX.moon : MIN_PX.planet;
  return m * k;
}

function systemFrame(game, map, dt) {
  const world = game.world, ship = game.ship, cam = map.camera, k = map.ui.k;
  if (!map.sel) map.sel = currentTarget(game.nav);
  const mc = map.cam;
  mc.hi = fitDist(map, world) / ZOOM_MIN;
  mc.lo = minDist(mc.follow);
  if (mc.fit) {
    // Обзор, о котором просили до того, как стал известен кадр.
    mc.g.dist = fitDist(map, world);
    if (mc.fit === 'snap') snapMapCam(mc);
    mc.fit = null;
  }
  stepMapCam(mc, dt);
  poseCamera(mc, cam);
  syncZoom(map, world);

  const items = map.items, vis = map.vis, gl = map.gl;
  items.length = 0; vis.clear();
  gl.mode = 'system'; gl.bodies.length = 0; gl.rings.length = 0; gl.glows.length = 0;
  const sel = map.sel, hov = map.hover, tgt = currentTarget(game.nav);
  const special = (o) => o === sel || o === hov || o === tgt || o === mc.follow;
  const W = map.W, H = map.H;
  const onScreen = (x, y, m) => x > -m && x < W + m && y > -m && y < H + m;

  const put = (b, parent) => {
    cam.toCamera(b.pos, _c);
    if (_c.z <= 0) return null;
    cam.project(_c, _s);
    const depth = Math.hypot(_c.x, _c.y, _c.z);
    const tr = cam.screenRadius(depth, b.radius);
    const r = Math.max(tr, bodyMin(b, k));
    const it = { obj: b, sx: _s.x, sy: _s.y, z: _c.z, r, tr };
    if (parent) {
      const pv = vis.get(parent);
      if (pv) {
        const off = Math.hypot(it.sx - pv.sx, it.sy - pv.sy);
        // Спутник, который ещё не отошёл от своей планеты на несколько
        // пикселей, — не объект, а утолщение точки. За диском планеты —
        // закрыт ею.
        if (off < pv.r + r + 3 * k && !special(b)) return null;
        if (off < pv.r && it.z > pv.z) return null;
      }
    }
    vis.set(b, it);
    if (onScreen(it.sx, it.sy, r + 40)) items.push(it);
    // Шар для видеокарты — того радиуса, каким его видно на значке.
    gl.bodies.push({ body: b, r: tr > 1e-9 ? b.radius * (r / tr) : b.radius });
    if (b.rings) gl.rings.push({ body: b, r: tr > 1e-9 ? b.radius * (r / tr) : b.radius });
    return it;
  };

  const star = put(world.star, null);
  if (star) {
    const c = world.star.color;
    gl.glows.push({ pos: world.star.pos, px: star.r * 5.5, color: [c[0] / 255, c[1] / 255, c[2] / 255], k: 0.6 });
  }
  for (const p of world.planets) put(p, world.star);
  for (const p of world.planets) for (const m of p.moons) put(m, p);

  // Станции, города, маркеры — значки при своём теле.
  const near = (o, parent, gap) => {
    cam.toCamera(o.pos, _c);
    if (_c.z <= 0) return null;
    cam.project(_c, _s);
    const it = { obj: o, sx: _s.x, sy: _s.y, z: _c.z, r: 5 * k };
    const pv = parent ? vis.get(parent) : null;
    if (parent && !pv && !special(o)) return null;
    if (pv) {
      const off = Math.hypot(it.sx - pv.sx, it.sy - pv.sy);
      if (off < pv.r + gap && !special(o)) return null;
      if (off < pv.r && it.z > pv.z) return null;
    }
    if (onScreen(it.sx, it.sy, 30)) items.push(it);
    vis.set(o, it);
    return it;
  };
  for (const st of world.stations) near(st, st.parent, 7 * k);
  for (const c of world.cities) {
    const pv = vis.get(c.body);
    // Город — на грунте: виден, когда диск тела крупнее значка и город на
    // обращённой к глазу стороне.
    if (!pv || (pv.tr < 16 * k && !special(c))) continue;
    const toEye = (cam.pos.x - c.pos.x) * (c.pos.x - c.body.pos.x) + (cam.pos.y - c.pos.y) * (c.pos.y - c.body.pos.y)
      + (cam.pos.z - c.pos.z) * (c.pos.z - c.body.pos.z);
    if (toEye <= 0) continue;
    cam.toCamera(c.pos, _c);
    if (_c.z <= 0) continue;
    cam.project(_c, _s);
    const it = { obj: c, sx: _s.x, sy: _s.y, z: _c.z, r: 5 * k };
    if (onScreen(it.sx, it.sy, 30)) items.push(it);
    vis.set(c, it);
  }
  const host = markerHost(sel);
  if (host && host.markers) for (const m of host.markers) near(m, host, 5 * k);

  // Свои корабли: тот, которым командуешь, — у самого корабля; остальные,
  // что стоят у одного места, — лесенкой, а не друг на друга.
  const stack = new Map();
  for (const m of map.marks) {
    if (!m.here) continue;
    cam.toCamera(m.pos, _c);
    if (_c.z <= 0) continue;
    cam.project(_c, _s);
    if (m.active) {
      if (!ship.away) items.push({ obj: m, sx: _s.x, sy: _s.y, z: _c.z, r: 7 * k, own: true });
      continue;
    }
    const key = m.host ? m.host.id : Math.round(_s.x) + ':' + Math.round(_s.y);
    const n = stack.get(key) || 0;
    stack.set(key, n + 1);
    items.push({ obj: m, sx: _s.x + 11 * k, sy: _s.y - (10 + n * 14) * k, z: _c.z, r: 6 * k, fleet: true });
  }

  // Чужие корабли этой системы: пилоты — с именами, NPC — точками. На
  // них не целятся с карты (их цель — в полёте, по прицелу).
  map.peers.length = 0;
  for (const V of game.peers || []) {
    if (!V || !V.pos || V.carried || V.hidden) continue;
    cam.toCamera(V.pos, _c);
    if (_c.z <= 0) continue;
    cam.project(_c, _s);
    if (!onScreen(_s.x, _s.y, 10)) continue;
    map.peers.push({ V, sx: _s.x, sy: _s.y, npc: !!V.npc, dorm: !!V.dorm });
  }
}

function galaxyFrame(game, map, dt) {
  const cam = map.camera, k = map.ui.k, cur = game.sys;
  const mc = map.gcam;
  if (!mc.inited) { resetGalaxy(map, cur, true); mc.inited = true; }
  mc.lo = 1.5;
  mc.hi = galaxyDist(map) * 3;
  stepMapCam(mc, dt);
  poseCamera(mc, cam);
  syncZoom(map, null);
  const items = map.items, gl = map.gl;
  items.length = 0;
  gl.mode = 'galaxy'; gl.bodies.length = 0; gl.rings.length = 0; gl.glows.length = 0;
  for (const s of galaxy().systems) {
    cam.toCamera(s.pos, _c);
    if (_c.z <= 0) continue;
    cam.project(_c, _s);
    // Размер — от светимости: белая звезда крупнее карлика, и класс видно
    // раньше, чем прочитано имя.
    const r = (3 + Math.min(4, Math.sqrt(s.cls.lum) * 2.2)) * k;
    const it = { obj: s, sx: _s.x, sy: _s.y, z: _c.z, r };
    items.push(it);
    const c = s.cls.color;
    const on = s === map.gsel || s === map.ghover;
    gl.glows.push({ pos: s.pos, px: r * (on ? 6 : 4.6), color: [c[0] / 255, c[1] / 255, c[2] / 255], k: on ? 1 : 0.8 });
  }
  map.route = map.gsel && cur && map.gsel.seed !== cur.seed ? planRoute(cur, map.gsel, hopLimit()) : null;
}

// --- выбор и цели ------------------------------------------------------------

/** Конечная система маршрута, если он есть, иначе цель варпа. */
function destOf(game) {
  const r = game.warpRoute;
  if (r && r.length) return galaxy().systems.find((s) => s.id === r[r.length - 1]) || null;
  return game.warpTarget || null;
}

/**
 * Навести карту на свой корабль. Здесь, в этой системе, — выбрать его и
 * подъехать, как к любому объекту. В другой — открыть галактику на его
 * системе: дальше туда и лететь.
 */
export function showShip(game, m) {
  const map = game.map;
  if (!m) return;
  if (m.here) {
    if (map.view !== 'system') switchView(game, 'system');
    map.sel = m;
    focusOn(map, game.world, m);
    return;
  }
  const s = m.sysId === null ? null : galaxy().systems.find((x) => x.id === m.sysId);
  if (!s) { say(game.state, L('ГДЕ ЭТОТ КОРАБЛЬ, НЕИЗВЕСТНО'), AMBER); return; }
  switchView(game, 'galaxy');
  map.gsel = s;
}

/** Вид галактики — к системе: она в середине, соседи вокруг. */
function showSystem(map, s) {
  followObj(map.gcam, s, distFor(9, 0.35, map.H || map.vh, map.vw, MAPCAM.fov));
}

/**
 * Взять систему в цель. Цель в игре одна (js/main.js): система заменяет
 * планету, станцию или пилота, и наоборот. Если напрямую не долететь —
 * цель первый прыжок маршрута, а маршрут запоминается: прибыв, игра сама
 * поставит следующий (js/main.js, прибытие).
 *
 * Чего больше нет: цель НЕ назначается выбором на карте. Раньше выбранная
 * система сразу становилась целью варпа, и снять её было нечем — J улетал
 * туда, куда случайно щёлкнули. Теперь выбор только показывает систему и
 * маршрут, а целью её делает Tab, Enter или кнопка в карточке.
 */
function aimSystem(game, s) {
  const map = game.map, cur = game.sys;
  map.gsel = s;
  if (!s || !cur || s.seed === cur.seed) return false;
  const route = planRoute(cur, s, hopLimit());
  map.route = route;
  if (!route) {
    say(game.state, L('ДО ') + s.name.toUpperCase() + L(' НЕ ДОБРАТЬСЯ: ДАЛЬШЕ ПРЕДЕЛА ПРЫЖКА'), RED);
    return false;
  }
  const hop = route.path[1];
  const same = game.warpTarget && game.warpTarget.seed === hop.seed && destOf(game) === s;
  game.targetSystem(hop, route.hops > 1 ? route.path.map((x) => x.id) : null);
  if (same) return false;
  if (route.hops > 1) {
    say(game.state, L('МАРШРУТ ДО ') + s.name.toUpperCase() + ': ' + route.hops + L(' ПРЫЖКА · ПЕРВЫЙ — ')
      + hop.name.toUpperCase() + ' · ' + systemDistance(cur, hop).toFixed(1) + L(' СВ. ЛЕТ'), GREEN, 4);
  } else {
    say(game.state, L('ЦЕЛЬ ВАРПА: ') + s.name.toUpperCase() + ' · ' +
      systemDistance(cur, s).toFixed(1) + L(' СВ. ЛЕТ · ') +
      Math.round(warpSeconds(cur, s)) + L(' С'), GREEN);
  }
  return true;
}

/** Выбрать объект системы (с подлётом, если просили). */
function pickObj(game, obj, fly) {
  const map = game.map;
  map.sel = obj;
  if (fly) focusOn(map, game.world, obj);
}

/**
 * Tab на карте: выбранное — в цель, а если оно уже цель — снять её.
 * Свой корабль — то, у чего он стоит.
 */
function targetSel(game) {
  const map = game.map;
  const t = map.sel && map.sel.isFleet ? map.sel.host : map.sel;
  if (!t) {
    say(game.state, map.sel ? L('КОРАБЛЬ В ПУСТОТЕ: ЦЕЛИ РЯДОМ НЕТ') : L('ОБЪЕКТ НЕ ВЫБРАН'), AMBER);
    return false;
  }
  if (currentTarget(game.nav) === t) { game.clearTarget(); return false; }
  game.selectTarget(t);
  say(game.state, L('ЦЕЛЬ: ') + t.name);
  return true;
}

/** То же для системы на карте галактики. */
function targetSystemSel(game) {
  const map = game.map, t = map.gsel;
  if (!t) { say(game.state, L('СИСТЕМА НЕ ВЫБРАНА'), AMBER); return; }
  if (game.sys && t.seed === game.sys.seed) { say(game.state, L('ВЫ УЖЕ В ЭТОЙ СИСТЕМЕ'), AMBER); return; }
  if (destOf(game) === t) { game.clearTarget(); return; }
  aimSystem(game, t);
}

/** F — следующий свой корабль. Возвращает, было ли нажатие. */
function fleetKey(game, input) {
  if (!input.pressed('KeyF')) return false;
  const marks = fleetOf(game);
  if (!marks.length) return true;
  const map = game.map;
  map.shipIdx = (map.shipIdx + 1) % marks.length;
  showShip(game, marks[map.shipIdx]);
  return true;
}

// --- ввод ----------------------------------------------------------------------

const inside = (x, y, r) => !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** Над колонкой или кнопкой ли точка: там мышь — интерфейсу, а не сцене. */
function uiAt(map, x, y) {
  const U = map.ui;
  if (map.buttons.some((b) => inside(x, y, b))) return true;
  if (inside(x, y, U.list)) return true;
  if (inside(x, y, U.card) && (map.view === 'galaxy' ? map.gsel : map.sel)) return true;
  return y < U.top * 0.75;
}

/** Кнопка под точкой (рабочая) или null. */
const buttonAt = (map, x, y) => map.buttons.find((b) => b.on && inside(x, y, b)) || null;
/** Строка списка «МОИ КОРАБЛИ» под точкой — или null. */
const rowAt = (map, x, y) => map.rows.find((r) => inside(x, y, r)) || null;
/** Строка списка объектов под точкой — или null. */
const lrowAt = (map, x, y) => map.lrows.find((r) => inside(x, y, r)) || null;

/**
 * Щелчок или касание в точку: кнопка, строка списка или объект в сцене.
 * Возвращает действие для игры (js/main.js) или null.
 */
function tapAt(game, x, y) {
  const map = game.map;
  const b = buttonAt(map, x, y);
  if (b) return pressButton(game, b.id);
  const row = rowAt(map, x, y);
  if (row) { showShip(game, row.mark); return null; }
  const lr = lrowAt(map, x, y);
  if (lr) {
    if (map.view === 'galaxy') map.gsel = lr.obj;
    else pickObj(game, lr.obj, true);
    if (map.ui.narrow) map.listOpen = false;
    return null;
  }
  if (uiAt(map, x, y)) return null;
  const hit = pickAt(map, x, y, 14 * map.ui.k);
  if (!hit) return null;
  const twice = map.last.obj === hit && map.t - map.last.t < DOUBLE;
  map.last.obj = hit; map.last.t = map.t;
  if (map.view === 'galaxy') {
    map.gsel = hit;
    if (twice) showSystem(map, hit);
  } else {
    pickObj(game, hit, twice);
  }
  return null;
}

/** Действие кнопки. */
function pressButton(game, id) {
  const map = game.map;
  switch (id) {
    case 'close': return 'close';
    case 'system': switchView(game, 'system'); return null;
    case 'galaxy': switchView(game, 'galaxy'); return null;
    case 'zin': zoomMapCam(viewCam(map), MAPCAM.step); return null;
    case 'zout': zoomMapCam(viewCam(map), 1 / MAPCAM.step); return null;
    case 'reset': resetView(game); return null;
    case 'list': map.listOpen = !map.listOpen; return null;
    case 'target': targetSel(game); return null;
    case 'jump': return jumpSel(game);
    case 'show': showSel(game); return null;
    case 'aim': targetSystemSel(game); return null;
    case 'warp': return warpSel(game);
    default: return null;
  }
}

const viewCam = (map) => (map.view === 'galaxy' ? map.gcam : map.cam);

function resetView(game) {
  const map = game.map;
  if (map.view === 'galaxy') resetGalaxy(map, game.sys, false);
  else resetMap(map, game.world, false);
}

function showSel(game) {
  const map = game.map;
  if (map.view === 'galaxy') { if (map.gsel) showSystem(map, map.gsel); }
  else if (map.sel) focusOn(map, game.world, map.sel);
}

/** Прыжок к выбранному: целью — и в путь (карта закрывается). */
function jumpSel(game) {
  const map = game.map;
  const t = map.sel && map.sel.isFleet ? map.sel.host : map.sel;
  if (t && currentTarget(game.nav) !== t) game.selectTarget(t);
  return 'jump';
}

/** Варп: цель — выбранная система (или первый прыжок к ней), и в путь. */
function warpSel(game) {
  const map = game.map;
  if (map.view === 'galaxy' && map.gsel && game.sys && map.gsel.seed !== game.sys.seed
      && destOf(game) !== map.gsel) aimSystem(game, map.gsel);
  return 'jump';
}

const _pan = { x: 0, y: 0 }, _drag = { x: 0, y: 0 };

/**
 * Разбор ввода карты. Вызывается каждый кадр из main.js вместо полётного
 * управления. Возвращает действие для игры: 'close' — закрыть карту,
 * 'jump' — прыжок к цели (варп к системе, квантовый — к остальному); иначе null.
 */
export function mapInput(game, input) {
  const map = game.map;
  map.mx = input.mouse.x;
  map.my = input.mouse.y;
  const galaxyView = map.view === 'galaxy';
  const mc = viewCam(map);
  let act = null;

  if (input.pressed('KeyG')) switchView(game, galaxyView ? 'system' : 'galaxy');
  if (map.view !== (galaxyView ? 'galaxy' : 'system')) return null;
  if (fleetKey(game, input)) return null;

  // --- мышь
  input.takePan(_pan);
  input.takeDrag(_drag);
  const wheel = input.takeWheel();
  if (input.mouse.clicked) {
    const ui = uiAt(map, map.mx, map.my);
    map.press = { x: map.mx, y: map.my, ui, moved: 0 };
    // Интерфейс жмётся сразу, по нажатию: кнопке ждать отпускания незачем.
    if (ui) act = tapAt(game, map.mx, map.my) || act;
  }
  // Удержания под слоем гасятся (input.enabled), поэтому Shift — прямо из
  // набора зажатых клавиш.
  const shift = !!input.down && (input.down.has('ShiftLeft') || input.down.has('ShiftRight'));
  if (map.press && !map.press.ui && (_pan.x || _pan.y)) {
    map.press.moved += Math.hypot(_pan.x, _pan.y);
    if (map.press.moved > 4) {
      if (shift) panMapCam(mc, _pan.x, _pan.y, 1 / Math.max(1e-12, map.scale));
      else turnMapCam(mc, _pan.x, _pan.y);
    }
  }
  // Правой — сдвиг по плоскости карты.
  if (input.mouse.right && (_drag.x || _drag.y)) panMapCam(mc, _drag.x, _drag.y, 1 / Math.max(1e-12, map.scale));
  if (map.press && !input.mouse.left) {
    // Отпустили, не протащив, — щелчок по сцене: выбор (двойной — подлёт).
    if (!map.press.ui && map.press.moved <= 4) act = tapAt(game, map.press.x, map.press.y) || act;
    map.press = null;
  }
  if (wheel) {
    // Над колонкой колесо листает её, над сценой — масштаб.
    if (inside(map.mx, map.my, map.ui.list)) map.scroll = Math.max(0, map.scroll + wheel * 0.6);
    else if (inside(map.mx, map.my, map.ui.card) && (galaxyView ? map.gsel : map.sel)) {
      map.cscroll = Math.max(0, (map.cscroll || 0) + wheel * 0.6);
    } else zoomMapCam(mc, Math.exp(-wheel * MAPCAM.wheel));
  }

  // --- клавиши
  // W/A/S/D — двигать карту по её плоскости, пока зажаты: от себя, к себе,
  // влево, вправо (как тянуть правой кнопкой). Переключать ими объекты
  // было ошибкой — рука ждёт от них движения, а карта прыгала к соседнему
  // телу. Скорость — от дистанции: на любом масштабе за секунду проходит
  // примерно ширину кадра.
  const held = (c) => !!input.down && input.down.has(c);
  const mx = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0);
  const my = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0);
  if (mx || my) {
    const dt = Math.min(0.1, game.frameDt || 1 / 60);
    const px = (map.W || 1600) * 0.6 * dt;
    panMapCam(mc, -mx * px, my * px, 1 / Math.max(1e-12, map.scale));
  }
  // Масштаб — стрелками вверх и вниз (и колесом). Плюс и минус сюда не
  // годятся: ими везде меняется громкость.
  if (input.pressed('ArrowUp')) zoomMapCam(mc, MAPCAM.step);
  if (input.pressed('ArrowDown')) zoomMapCam(mc, 1 / MAPCAM.step);
  // Q и E — поворот вокруг фокуса на 15°.
  const quarter = (15 * Math.PI / 180) / MAPCAM.turn;
  if (input.pressed('KeyQ')) turnMapCam(mc, -quarter, 0);
  if (input.pressed('KeyE')) turnMapCam(mc, quarter, 0);
  if (input.pressed('KeyX', 'Digit0', 'Numpad0')) resetView(game);
  if (input.pressed('Space')) showSel(game);

  // По объектам (и по системам) — только стрелками.
  const dir = (input.pressed('ArrowRight') ? 1 : 0) - (input.pressed('ArrowLeft') ? 1 : 0);
  if (galaxyView) {
    if (dir) {
      const list = galaxyList(game.sys);
      let i = map.gsel ? list.findIndex((s) => s.seed === map.gsel.seed) : 0;
      i = i < 0 ? 0 : (i + dir + list.length) % list.length;
      // Вид не едет: галактика маленькая, и её ценность в том, что видно
      // всё сразу — и куда, и через кого. Подлететь — пробелом или дважды.
      // Выбор — не цель: маршрут видно сразу, целью систему делает Tab.
      map.gsel = list[i];
    }
    if (input.pressed('Tab', 'Enter', 'NumpadEnter')) targetSystemSel(game);
    if (input.pressed('KeyJ', 'KeyB')) act = warpSel(game);
  } else {
    if (dir) {
      const all = mapObjects(game.world, map.sel);
      let i = all.indexOf(map.sel);
      i = i < 0 ? 0 : (i + dir + all.length) % all.length;
      pickObj(game, all[i], true);
    }
    if (input.pressed('Tab', 'Enter', 'NumpadEnter')) targetSel(game);
    // J и B — одна клавиша: прыжок к выбранному (или к цели, если на карте
    // ничего не выбрано).
    if (input.pressed('KeyJ', 'KeyB')) act = jumpSel(game);
  }
  // Backspace — снять цель, как в полёте.
  if (input.pressed('Backspace')) game.clearTarget();

  // Курсор: над кнопкой — рука, при вращении — «тащу», над объектом —
  // указатель, иначе обычная стрелка.
  map.hover = null; map.ghover = null;
  const overUi = uiAt(map, map.mx, map.my);
  const overBtn = buttonAt(map, map.mx, map.my) || rowAt(map, map.mx, map.my) || lrowAt(map, map.mx, map.my);
  let hit = null;
  if (!overUi && !map.press) hit = pickAt(map, map.mx, map.my, 14 * map.ui.k);
  if (galaxyView) map.ghover = hit; else map.hover = hit;
  map.cursor = map.press && !map.press.ui && map.press.moved > 4 ? 'grabbing'
    : overBtn || hit ? 'pointer' : overUi ? 'default' : 'grab';
  syncZoom(map, game.world);
  return act;
}

/**
 * Жесты пальцами (телефон): касание — то же, что щелчок; одним пальцем
 * тянуть — вращать; двумя — щипок (масштаб) и сдвиг. Касания приходят
 * списком точек этого кадра ({ id, x, y }, js/main.js).
 */
export function mapTouch(game, pts) {
  const map = game.map;
  const mc = viewCam(map);
  let act = null;
  const g = map.tg;
  if (!pts.length) {
    if (g && g.mode === 'tap' && !g.ui) act = tapAt(game, g.x0, g.y0);
    map.tg = null;
    return act;
  }
  if (!g || g.n !== pts.length) {
    // Новый жест (или сменилось число пальцев): от этой точки и считаем.
    // Палец, оставшийся после щипка, — продолжение жеста, а не касание:
    // отпустив его, ничего не выбирают.
    const ui = pts.length === 1 && !g && uiAt(map, pts[0].x, pts[0].y);
    map.tg = {
      n: pts.length, mode: pts.length > 1 ? 'pinch' : (g ? 'turn' : 'tap'), ui,
      x0: pts[0].x, y0: pts[0].y, last: pts.map((p) => ({ x: p.x, y: p.y })),
    };
    // Кнопки и строки — сразу, как мышью.
    if (ui) {
      act = tapAt(game, pts[0].x, pts[0].y);
      map.tg.mode = 'ui';
    }
    return act;
  }
  if (g.mode === 'ui') {
    // Палец лёг на список или карточку и тянется — прокрутка.
    const dy = pts[0].y - g.last[0].y;
    if (inside(pts[0].x, pts[0].y, map.ui.list)) map.scroll = Math.max(0, map.scroll - dy);
    else if (inside(pts[0].x, pts[0].y, map.ui.card)) map.cscroll = Math.max(0, (map.cscroll || 0) - dy);
    g.last[0].x = pts[0].x; g.last[0].y = pts[0].y;
    return null;
  }
  if (pts.length === 1) {
    const p = pts[0];
    if (g.mode === 'tap' && Math.hypot(p.x - g.x0, p.y - g.y0) > TAP_PX) g.mode = 'turn';
    if (g.mode === 'turn') turnMapCam(mc, p.x - g.last[0].x, p.y - g.last[0].y);
    g.last[0].x = p.x; g.last[0].y = p.y;
    return null;
  }
  const a = pts[0], b = pts[1], la = g.last[0], lb = g.last[1];
  const d0 = Math.hypot(la.x - lb.x, la.y - lb.y), d1 = Math.hypot(a.x - b.x, a.y - b.y);
  if (d0 > 1 && d1 > 1) zoomMapCam(mc, d1 / d0);
  const cx = (a.x + b.x) / 2 - (la.x + lb.x) / 2, cy = (a.y + b.y) / 2 - (la.y + lb.y) / 2;
  if (cx || cy) panMapCam(mc, cx, cy, 1 / Math.max(1e-12, map.scale));
  g.last[0].x = a.x; g.last[0].y = a.y; g.last[1].x = b.x; g.last[1].y = b.y;
  syncZoom(map, game.world);
  return null;
}

// --- форматирование ----------------------------------------------------------

const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const sup = (n) => String(n).split('').map((c) => SUP[+c] || c).join('');

// Масса Луны, кг — мелкие тела в земных массах читаются как ноль.
const MOON_MASS = 7.35e22;

export function fmtMass(kg) {
  const e = Math.floor(Math.log10(kg));
  const m = kg / 10 ** e;
  const earth = kg / EARTH_MASS;
  const rel = earth >= 0.01
    ? earth.toFixed(earth < 1 ? 2 : 1) + L(' Земли')
    : (kg / MOON_MASS).toFixed(2) + L(' Луны');
  return m.toFixed(2) + '·10' + sup(e) + L(' кг · ') + rel;
}

const plural = (n, one, few, many) => {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
};

export function fmtYears(sec) {
  const years = sec / (365.25 * 24 * 3600);
  if (years < 1) return fmtTime(sec);
  return years.toFixed(years < 10 ? 1 : 0) + ' ' + plural(Math.round(years), L('год'), L('года'), L('лет'));
}

const fmtTemp = (k) => {
  const c = toCelsius(k);
  if (k > 1000) return Math.round(k) + L(' К (') + Math.round(c) + ' °C)';
  return (c > 0 ? '+' : '') + c.toFixed(0) + ' °C';
};

/** «Круглый» шаг сетки: 1, 2 или 5 на степень десяти, не больше x. */
function niceStep(x) {
  const e = Math.floor(Math.log10(Math.max(1e-12, x)));
  const b = 10 ** e, m = x / b;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * b;
}

// --- карточка объекта --------------------------------------------------------

function landingNote(b) {
  if (b.kind === 'star') return L('исключена');
  if (!isSolid(b)) return L('поверхности нет');
  if (!isLandable(b)) return L('исключена');
  if (hasSea(b)) return L('возможна: на сушу, шасси и R/F');
  return L('возможна: шасси и R/F');
}

/**
 * Строки справки о выбранном объекте.
 * Ни одно число здесь не написано от руки: всё считается из мира.
 *
 * @returns {{title, kind, desc, rows, jumpOk}}
 */
export function objectCard(game, obj) {
  const world = game.world, ship = game.ship;
  const rows = [];
  const info = KIND_INFO[obj.kind] || null;
  const card = { title: obj.name, kind: kindLabel(obj), desc: '', rows };

  const range = () => {
    const d = Math.hypot(obj.pos.x - ship.pos.x, obj.pos.y - ship.pos.y, obj.pos.z - ship.pos.z);
    rows.push([L('ДО КОРАБЛЯ'), fmtDist(Math.max(0, d - (obj.radius || 0)))]);
  };

  if (obj.isFleet) {
    // Свой корабль: где он и что с ним. Коридора и физики тут нет — это
    // не тело, а место, куда возвращаются.
    card.kind = L('ВАШ КОРАБЛЬ') + (obj.typeName ? ' · ' + obj.typeName.toUpperCase() : '');
    card.desc = obj.active
      ? L('Вы им командуете. Он здесь — там, где зелёная стрелка.')
      : L('Стоит без пилота там, где его оставили. Сесть в него — подняться на борт и в кресло.');
    rows.push([L('МЕСТО'), obj.place]);
    if (!obj.active) {
      const d = Math.hypot(obj.pos.x - ship.pos.x, obj.pos.y - ship.pos.y, obj.pos.z - ship.pos.z);
      rows.push([L('ДО НЕГО'), fmtDist(d)]);
    }
    if (obj.host) rows.push([L('ЦЕЛЬЮ'), obj.host.name + L(' — TAB')]);
    card.jumpOk = false;
    return card;
  }

  if (obj.isMarker) {
    card.desc = L('Точка в пустоте, к которой можно прыгнуть. Нужна, когда ') +
      L('прямой коридор до цели перекрыт телом, над которым висишь: сначала ') +
      L('прыжок сюда, потом к цели.');
    rows.push([L('ТЕЛО'), obj.body.name]);
    rows.push([L('УДАЛЕНИЕ'), fmtDist(obj.dist) +
      ' (' + (obj.dist / obj.body.radius).toFixed(0) + L(' радиуса)')]);
    range();
  } else if (obj.isCity) {
    card.desc = L('Наземный город на выровненной плите. Садиться можно на ') +
      L('его площадки — они ровные и обозначены, в отличие от дикого грунта.');
    rows.push([L('ТЕЛО'), obj.body.name]);
    // Схема расселения и число площадок — у каждого города свои: города
    // генерируются, а не ставятся по одному образцу.
    rows.push([L('ПЛАНИРОВКА'), L(CITY_KINDS[obj.layout] || '')]);
    rows.push([L('ПЛОЩАДКИ'), String(obj.plan.pads.length)]);
    rows.push([L('РАЗМЕР'), fmtDist(obj.radius * 2)]);
    range();
  } else if (obj.isStation) {
    const p = obj.parent;
    card.desc = L('Орбитальный порт: единственное место, где восстанавливают ') +
      L('корпус. Створ смотрит от планеты, станция вращается — крен на входе ') +
      L('согласуют с ним.');
    rows.push([L('ПЛАНЕТА'), p ? p.name : '—']);
    rows.push([L('ВЫСОТА ОРБИТЫ'), p ? fmtDist(obj.orbit.radius - p.radius) : '—']);
    rows.push([L('ОБОРОТ ВОКРУГ'), fmtTime(obj.orbit.period)]);
    rows.push([L('ВРАЩЕНИЕ'), L('оборот за ') + fmtTime(2 * Math.PI / obj.spinRate)]);
    rows.push([L('СТЫКОВКА'), L('скорость до ') + LIMITS.speed.toFixed(2) + L(' км/с')]);
    range();
  } else {
    // Тело: звезда, планета или луна.
    card.desc = info ? L(info.desc) : '';
    rows.push([L('РАДИУС'), fmtDist(obj.radius)]);
    rows.push([L('МАССА'), fmtMass(massOf(obj))]);
    rows.push([L('ПЛОТНОСТЬ'), ((DENSITY[obj.kind] || DENSITY.rock) / 1000).toFixed(2) + L(' г/см³')]);
    rows.push([L('ТЯЖЕСТЬ'), obj.g0.toFixed(2) + L(' м/с² (') + (obj.g0 / 9.81).toFixed(2) + ' g)']);
    rows.push([L('ВТОРАЯ КОСМ.'), escapeSpeed(obj).toFixed(2) + L(' км/с')]);
    rows.push([L('ТЕМПЕРАТУРА'), fmtTemp(temperatureOf(world, obj))]);
    if (obj.spin) rows.push([L('СУТКИ'), fmtTime(dayLength(obj))]);
    if (obj.orbit) {
      rows.push([L('ОРБИТА'), fmtDist(obj.orbit.radius) +
        L(' вокруг ') + (obj.parent ? obj.parent.name : L('светила'))]);
      rows.push([L('ГОД'), fmtYears(obj.orbit.period)]);
    }
    if (obj.kind !== 'star') {
      rows.push([L('ОТ СВЕТИЛА'), fmtDist(starDistance(obj))]);
      rows.push([L('ЗАХВАТ'), fmtDist(obj.soi) +
        ' (' + (obj.soi / obj.radius).toFixed(0) + L(' радиусов)')]);
    }

    const air = atmosphereOf(obj);
    if (air) {
      rows.push([L('АТМОСФЕРА'), air.press.toFixed(2) + L(' бар, до ') + fmtDist(air.top)]);
      if (air.mix) rows.push([L('СОСТАВ'), air.mix.map(([g, s]) => L(g) + ' ' + s + '%').join(' · ')]);
    } else {
      rows.push([L('АТМОСФЕРА'), L('нет')]);
    }

    rows.push([L('ПОСАДКА'), landingNote(obj)]);
    if (obj.rings) rows.push([L('КОЛЬЦА'), L('есть')]);
    if (obj.station) rows.push([L('СТАНЦИЯ'), obj.station.name]);
    if (obj.city) rows.push([L('ГОРОД'), obj.city.name]);
    if (obj.moons && obj.moons.length) {
      rows.push([L('ЛУНЫ'), obj.moons.length + ': ' + obj.moons.map((m) => m.name).join(', ')]);
    }
    if (obj.kind !== 'star') range();
  }

  // Коридор прыжка: ради этого цель на карте и выбирают. Считается тем
  // же кодом, что и сам прыжок, поэтому «свободен» здесь означает, что
  // B сработает, а не «наверное, получится».
  const jump = canJump(world, ship, obj);
  rows.push([L('КОРИДОР'), jump.ok ? L('свободен — B') : jump.reason.toLowerCase()]);
  card.jumpOk = jump.ok;
  return card;
}

/**
 * Карточка системы в галактике: звезда, расстояние, прыжок и маршрут.
 * Состав чужой системы не показывается, и это не забывчивость: система
 * собирается только по прибытии (js/main.js, enterSystem).
 */
export function systemCard(game, s, route = null) {
  const cur = game.sys, ship = game.ship;
  const rows = [];
  const card = {
    title: s.name, kind: L(s.cls.ru).toUpperCase() + L(' · КЛАСС ') + s.cls.id,
    desc: '', rows, here: !!cur && s.seed === cur.seed, warpOk: false, reason: '',
  };
  rows.push([L('ТЕМПЕРАТУРА'), Math.round(s.cls.temp) + ' K']);
  rows.push([L('СВЕТИМОСТЬ'), s.cls.lum.toFixed(2) + L(' солнечной')]);
  rows.push([L('ОБИТАЕМАЯ ЗОНА'), Math.round(s.hab / 1000) + L(' тыс. км от звезды')]);
  if (card.here) {
    card.desc = L('Вы здесь. Карта этой системы — на клавише G.');
    rows.push([L('ДАЛЬНОСТЬ ВАРПА'), warpRange(ship).toFixed(1) + L(' св. лет с тем, что в баке')]);
    return card;
  }
  const d = systemDistance(cur, s);
  const lim = hopLimit();
  rows.push([L('РАССТОЯНИЕ'), d.toFixed(1) + L(' св. лет')]);
  if (d <= lim + 1e-9) {
    rows.push([L('ПРЯМОЙ ПРЫЖОК'), warpTons(d).toFixed(1) + L(' т · ') + Math.round(warpSeconds(cur, s)) + L(' с')]);
  } else {
    rows.push([L('ПРЯМОЙ ПРЫЖОК'), L('нет: дальше предела ') + lim.toFixed(1) + L(' св. лет')]);
  }
  const r = route || planRoute(cur, s, lim);
  if (r && r.hops > 1) {
    rows.push([L('МАРШРУТ'), r.path.map((x) => x.name).join(' › ')]);
    rows.push([L('ВСЕГО'), r.hops + L(' прыжка · ') + r.ly.toFixed(1) + L(' св. лет · ') +
      warpTons(r.ly).toFixed(1) + L(' т · ') + fmtTime(r.secs)]);
  } else if (!r) {
    rows.push([L('МАРШРУТ'), L('нет: ни одна дорога не доходит')]);
  }
  // Первый прыжок — тот, что делается сейчас: на него и смотрим бак.
  const hop = r ? r.path[1] : s;
  const need = warpTons(systemDistance(cur, hop));
  const spare = Math.max(0, (typeof ship.fuel === 'number' ? ship.fuel : 0) - fuelReserve());
  rows.push([L('ТОПЛИВО'), need.toFixed(1) + L(' т на прыжок · сверх резерва ') + spare.toFixed(1) + L(' т')]);
  const res = canWarp(ship, cur, hop);
  card.warpOk = !!res.ok;
  card.reason = res.ok ? '' : res.reason;
  card.desc = r && r.hops > 1
    ? L('Напрямую не долететь: бака не хватит. Маршрут через ') + r.path.slice(1, -1).map((x) => x.name).join(', ') +
      L(' — в каждом порту заправка, следующий прыжок станет целью сам.')
    : L('Что там внутри, известно только по прибытии: система собирается под тоннелем прыжка.');
  return card;
}

// --- отрисовка -----------------------------------------------------------------

const font = (px, bold = false) => (bold ? 'bold ' : '') + Math.max(9, Math.round(px)) + 'px ' + MONO;
const rgb = (c, a = 1) => 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')';
const fin = (...v) => v.every((x) => Number.isFinite(x));

/** Надпись с тёмным контуром: на карте под ней может быть что угодно. */
function label(ctx, s, x, y, color, px, align = 'left', bold = false) {
  ctx.font = font(px, bold);
  ctx.textAlign = align;
  ctx.lineWidth = Math.max(2, px * 0.28);
  ctx.strokeStyle = 'rgba(0,3,8,0.85)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

/** Обрезать строку под ширину, с многоточием. */
function clip(ctx, s, width) {
  s = String(s);
  if (ctx.measureText(s).width <= width) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > width) s = s.slice(0, -1);
  return s + '…';
}

function wrap(ctx, text, width) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const probe = line ? line + ' ' + word : word;
    if (line && ctx.measureText(probe).width > width) { lines.push(line); line = word; }
    else line = probe;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Кнопка: подпись и клавиша в «колпачке» справа. Запоминается на кадр
 * (map.buttons): по ней ловится щелчок. Неактивная — тусклая и не жмётся.
 */
function button(ctx, map, id, x, y, w, h, text, key = '', opts = {}) {
  const k = map.ui.k;
  const on = opts.on !== false;
  const b = { id, x, y, w, h, on };
  // Кнопка, уехавшая с прокруткой за край своей колонки, не жмётся: её
  // не видно, а место, где она «была бы», занято чужим.
  const cl = opts.clip;
  if (!cl || (y >= cl.y && y + h <= cl.y + cl.h)) map.buttons.push(b);
  const hover = on && inside(map.mx, map.my, b);
  const tone = opts.tone || CY;
  ctx.fillStyle = !on ? 'rgba(79,179,224,0.04)'
    : opts.primary ? (hover ? 'rgba(255,204,102,0.30)' : 'rgba(255,204,102,0.16)')
      : (hover ? 'rgba(79,179,224,0.26)' : 'rgba(79,179,224,0.11)');
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = !on ? 'rgba(79,179,224,0.18)' : opts.primary ? 'rgba(255,204,102,0.75)' : (hover ? tone : 'rgba(79,179,224,0.45)');
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const fs = opts.fs || 12 * k;
  ctx.font = font(fs, !!opts.primary);
  ctx.textAlign = opts.center ? 'center' : 'left';
  ctx.fillStyle = !on ? 'rgba(159,217,255,0.38)' : opts.primary ? AMBER : INK;
  const ty = y + h / 2 + fs * 0.36;
  if (opts.center) ctx.fillText(text, x + w / 2, ty);
  else ctx.fillText(clip(ctx, text, w - 16 * k - (key ? ctx.measureText(key).width + 14 * k : 0)), x + 9 * k, ty);
  if (key) {
    ctx.font = font(10.5 * k);
    const kw = ctx.measureText(key).width + 10 * k;
    const kx = x + w - kw - 6 * k, kh = Math.min(h - 8 * k, 16 * k), ky = y + (h - kh) / 2;
    ctx.strokeStyle = on ? 'rgba(159,217,255,0.55)' : 'rgba(159,217,255,0.2)';
    ctx.strokeRect(kx + 0.5, ky + 0.5, kw - 1, kh - 1);
    ctx.fillStyle = on ? PALE : 'rgba(159,217,255,0.35)';
    ctx.textAlign = 'center';
    ctx.fillText(key, kx + kw / 2, ky + kh / 2 + 10.5 * k * 0.36);
  }
  return b;
}

/** Подложка колонки: тёмное стекло и одна вертикальная черта. */
function column(ctx, r, k, accent = CY_DIM) {
  ctx.fillStyle = 'rgba(2,9,17,0.78)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = accent;
  ctx.fillRect(r.x, r.y, Math.max(1, Math.round(2 * k)), r.h);
}

/** Заголовок раздела с волосяной чертой под ним. */
function head(ctx, x, y, w, s, k, color = CY) {
  ctx.font = font(11 * k, true);
  ctx.textAlign = 'left';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.fillStyle = 'rgba(79,179,224,0.22)';
  ctx.fillRect(x, y + 5 * k, w, 1);
}

/** Уголки рамки выбора вокруг значка радиусом r. */
function brackets(ctx, x, y, r, color, k) {
  const a = r + 5 * k, l = Math.max(4, Math.min(10, r * 0.6)) * k;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, 1.4 * k);
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(x + sx * a, y + sy * (a - l));
    ctx.lineTo(x + sx * a, y + sy * a);
    ctx.lineTo(x + sx * (a - l), y + sy * a);
  }
  ctx.stroke();
}

/**
 * Карта целиком — слой приборов поверх сцены (сцену к этому кадру уже
 * нарисовала видеокарта, js/gl/scene.js, renderMap).
 */
export function drawMap(r, game) {
  const ctx = r.ctx;
  const W = r.camera.w, H = r.camera.h;
  const map = game.map;
  if (map.W !== W || map.H !== H || !map.camera.focal) mapFrame(game, W, H, 0);
  map.buttons.length = 0;
  map.lrows.length = 0;
  map.rows.length = 0;
  ctx.save();
  if (!map.glDrawn) {
    // Без видеокарты (WebGL2 нет или проверки под Node) — своя подложка и
    // тела кружками: карта остаётся рабочей и без сцены.
    ctx.fillStyle = '#01050b';
    ctx.fillRect(0, 0, W, H);
  }
  if (map.view === 'galaxy') drawGalaxyScene(ctx, map, game);
  else drawSystemScene(ctx, map, game);
  drawUi(ctx, map, game);
  ctx.restore();
}

// --- сцена системы ---------------------------------------------------------------

const _p = { x: 0, y: 0, z: 0 }, _q = { x: 0, y: 0 };

/** Точка мира -> экран; null — за глазом. */
function proj(cam, x, y, z, out) {
  _p.x = x; _p.y = y; _p.z = z;
  cam.toCamera(_p, _c);
  if (_c.z <= 1e-9) return null;
  cam.project(_c, out);
  out.z = _c.z;
  return fin(out.x, out.y) ? out : null;
}

/**
 * Сетка плоскости карты под фокусом: круги «круглых» радиусов с подписями
 * — это и есть масштаб — и лучи через тридцать градусов. Бледнеет к краю.
 */
function drawGrid(ctx, map, k, unitText) {
  const cam = map.camera, mc = map.view === 'galaxy' ? map.gcam : map.cam;
  const cx = mc.fx, cy = mc.fy, cz = mc.fz;
  const step = niceStep(mc.dist * 0.22);
  const n = 8;
  const pts = [];
  const seg = 72;
  ctx.lineWidth = 1;
  for (let i = 1; i <= n; i++) {
    const R = step * i;
    const a = 0.16 * (1 - (i - 1) / n) + 0.03;
    ctx.strokeStyle = 'rgba(79,179,224,' + a.toFixed(3) + ')';
    ctx.beginPath();
    let started = false;
    for (let j = 0; j <= seg; j++) {
      const t = (j / seg) * TAU;
      const q = proj(cam, cx + Math.cos(t) * R, cy, cz + Math.sin(t) * R, _q);
      if (!q) { started = false; continue; }
      if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    // Подпись — на ближней к глазу стороне круга.
    if (i === 2 || i === 5) {
      const ex = cam.pos.x - cx, ez = cam.pos.z - cz;
      const el = Math.hypot(ex, ez) || 1;
      const q = proj(cam, cx + ex / el * R, cy, cz + ez / el * R, _q);
      if (q) pts.push({ x: q.x, y: q.y, s: unitText(R) });
    }
  }
  ctx.strokeStyle = 'rgba(79,179,224,0.06)';
  ctx.beginPath();
  for (let j = 0; j < 12; j++) {
    const t = (j / 12) * TAU;
    const a = proj(cam, cx + Math.cos(t) * step * 0.5, cy, cz + Math.sin(t) * step * 0.5, { x: 0, y: 0 });
    const b = proj(cam, cx + Math.cos(t) * step * n, cy, cz + Math.sin(t) * step * n, { x: 0, y: 0 });
    if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
  }
  ctx.stroke();
  for (const p of pts) label(ctx, p.s, p.x, p.y + 12 * k, 'rgba(159,217,255,0.5)', 10 * k, 'center');
}

/**
 * Орбита: окружность в своей плоскости вокруг хозяина. Яркая у самого
 * тела и гаснет назад по ходу — видно, куда оно идёт. Куски за дисками
 * крупных тел не рисуются: орбита луны уходит ЗА свою планету.
 */
function drawOrbit(ctx, map, center, b, color, alpha, occluders) {
  const cam = map.camera, o = b.orbit;
  if (!o || !center) return;
  // Радиус на экране — по глубине хозяина.
  cam.toCamera(center.pos, _c);
  const depth = Math.max(1e-9, Math.hypot(_c.x, _c.y, _c.z));
  const rpx = o.radius * cam.focal / depth;
  if (rpx < 6) return;
  // Орбита во много кадров шириной — это почти прямая через тело: вблизи
  // она не говорит ничего и только режет кадр пополам. Тише.
  if (rpx > (map.W || 1600) * 3) alpha *= 0.4;
  const N = Math.max(64, Math.min(360, Math.round(rpx / 2.5)));
  const a0 = o.phase + ((map.worldTime || 0) / o.period) * TAU;
  const c = center.pos;
  const xs = new Float64Array(N + 1), ys = new Float64Array(N + 1), zs = new Float64Array(N + 1);
  const ok = new Uint8Array(N + 1);
  for (let j = 0; j <= N; j++) {
    const t = a0 - (j / N) * TAU;
    const ca = Math.cos(t) * o.radius, sa = Math.sin(t) * o.radius;
    const q = proj(cam, c.x + o.A.x * ca + o.B.x * sa, c.y + o.A.y * ca + o.B.y * sa,
      c.z + o.A.z * ca + o.B.z * sa, _q);
    if (q) { xs[j] = q.x; ys[j] = q.y; zs[j] = q.z; ok[j] = 1; }
  }
  const BATCH = 6;
  ctx.lineWidth = 1.2;
  for (let j0 = 0; j0 < N; j0 += BATCH) {
    const f = 1 - j0 / N;
    const a = alpha * (0.25 + 0.75 * f * f);
    ctx.strokeStyle = rgb(color, a.toFixed(3));
    ctx.beginPath();
    let open = false;
    for (let j = j0; j < Math.min(N, j0 + BATCH); j++) {
      if (!ok[j] || !ok[j + 1]) { open = false; continue; }
      const mx = (xs[j] + xs[j + 1]) / 2, my = (ys[j] + ys[j + 1]) / 2, mz = (zs[j] + zs[j + 1]) / 2;
      let hidden = false;
      for (const v of occluders) {
        if (mz > v.z && Math.hypot(mx - v.sx, my - v.sy) < v.r) { hidden = true; break; }
      }
      if (hidden) { open = false; continue; }
      if (!open) { ctx.moveTo(xs[j], ys[j]); open = true; }
      ctx.lineTo(xs[j + 1], ys[j + 1]);
    }
    ctx.stroke();
  }
}

const BLUE = [79, 179, 224], GREENC = [120, 224, 143], AMBERC = [255, 204, 102];

/** Значок станции, города, маркера, своего корабля. */
function glyph(ctx, it, k, color) {
  const x = it.sx, y = it.sy, o = it.obj;
  ctx.lineWidth = Math.max(1, 1.3 * k);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (o.isMarker) {
    const a = 4 * k;
    ctx.beginPath();
    ctx.moveTo(x, y - a); ctx.lineTo(x + a, y); ctx.lineTo(x, y + a); ctx.lineTo(x - a, y); ctx.closePath();
    ctx.stroke();
  } else if (o.isStation) {
    // Порт — квадрат с точкой: место, где стыкуются.
    const a = 4 * k;
    ctx.strokeRect(x - a, y - a, a * 2, a * 2);
    ctx.fillRect(x - 1, y - 1, 2, 2);
  } else if (o.isCity) {
    const a = 4.5 * k;
    ctx.beginPath();
    ctx.moveTo(x, y - a); ctx.lineTo(x + a, y + a * 0.7); ctx.lineTo(x - a, y + a * 0.7); ctx.closePath();
    ctx.stroke();
  }
}

/** Свой корабль: стрелка по ходу (или по носу, если стоит). */
function shipGlyph(ctx, x, y, color, k, ang = -Math.PI / 2) {
  const s = 7 * k;
  const pt = (a, r) => [x + Math.cos(ang + a) * r, y + Math.sin(ang + a) * r];
  ctx.beginPath();
  const p0 = pt(0, s), p1 = pt(2.45, s * 0.85), p2 = pt(Math.PI, s * 0.25), p3 = pt(-2.45, s * 0.85);
  ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]);
  ctx.closePath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Подписи без наложений: важное раньше, налезающее — не пишется. */
function placeLabels(ctx, list, blocked) {
  list.sort((a, b) => b.prio - a.prio);
  const placed = blocked.slice();
  for (const l of list) {
    ctx.font = font(l.px, l.bold);
    const w = ctx.measureText(l.s).width;
    const subW = l.sub ? (ctx.font = font(l.px * 0.82), ctx.measureText(l.sub).width) : 0;
    const bw = Math.max(w, subW) + 4, bh = l.px * (l.sub ? 2.15 : 1.2);
    const x0 = l.align === 'center' ? l.x - bw / 2 : l.x - 2;
    const rect = { x: x0, y: l.y - l.px, w: bw, h: bh };
    if (!l.force && placed.some((p) => rect.x < p.x + p.w && rect.x + rect.w > p.x && rect.y < p.y + p.h && rect.y + rect.h > p.y)) continue;
    placed.push(rect);
    label(ctx, l.s, l.x, l.y, l.color, l.px, l.align || 'left', l.bold);
    if (l.sub) label(ctx, l.sub, l.x, l.y + l.px * 1.05, l.subColor || 'rgba(159,217,255,0.62)', l.px * 0.82, l.align || 'left');
  }
}

/** Прямоугольники интерфейса — подписи сцены на них не ложатся. */
function uiRects(map) {
  const U = map.ui, out = [];
  if (U.list) out.push(U.list);
  if (U.card && (map.view === 'galaxy' ? map.gsel : map.sel)) out.push(U.card);
  out.push({ x: 0, y: 0, w: map.W, h: U.top * 0.8 });
  out.push({ x: 0, y: map.H - U.bot, w: map.W, h: U.bot });
  return out;
}

function drawSystemScene(ctx, map, game) {
  const k = map.ui.k, world = game.world, ship = game.ship, cam = map.camera;
  map.worldTime = world.time;
  const sel = map.sel, hov = map.hover, tgt = currentTarget(game.nav);
  const vis = map.vis;

  drawGrid(ctx, map, k, (R) => fmtDist(R));

  // Закрывают орбиты только крупные диски: точка в три пикселя никакую
  // линию не заслонит.
  const occl = [];
  for (const v of vis.values()) if (v.tr > 6 && v.obj.isBody) occl.push(v);

  // Орбиты: планет — вокруг звезды; лун и станций — у своей планеты,
  // когда до неё приблизились настолько, что их есть куда рисовать.
  for (const p of world.planets) {
    const hot = p === sel || p === tgt || p === hov;
    drawOrbit(ctx, map, world.star, p, hot ? AMBERC : BLUE, hot ? 0.75 : 0.42, occl);
    const pv = vis.get(p);
    if (!pv) continue;
    for (const m of p.moons) {
      const h2 = m === sel || m === tgt || m === hov;
      if (vis.get(m) || h2) drawOrbit(ctx, map, p, m, h2 ? AMBERC : BLUE, h2 ? 0.7 : 0.3, occl);
    }
    if (p.station && (vis.get(p.station) || p.station === sel)) {
      const s = p.station, h3 = s === sel || s === tgt || s === hov;
      drawOrbit(ctx, map, p, s, h3 ? AMBERC : GREENC, h3 ? 0.7 : 0.3, occl);
    }
  }

  // Без видеокарты — тела кружками своего цвета (свет — со стороны звезды).
  if (!map.glDrawn) {
    for (const v of vis.values()) {
      if (!v.obj.isBody) continue;
      const c = v.obj.color || [180, 180, 180];
      ctx.fillStyle = v.obj.kind === 'star' ? rgb(c, 1) : rgb(c, 0.9);
      ctx.beginPath();
      ctx.arc(v.sx, v.sy, v.r, 0, TAU);
      ctx.fill();
    }
  }

  // Ножки высоты: от своего корабля, своих кораблей и выбранного до
  // плоскости под фокусом. Без них не видно, над плоскостью ли корабль
  // или в ней.
  const planeY = map.cam.fy;
  const stalk = (pos, sx, sy, color) => {
    const q = proj(cam, pos.x, planeY, pos.z, { x: 0, y: 0 });
    if (!q || Math.hypot(q.x - sx, q.y - sy) < 3 * k) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([2 * k, 3 * k]);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(q.x, q.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.ellipse(q.x, q.y, 3 * k, 1.4 * k, 0, 0, TAU); ctx.stroke();
  };

  const labels = [];

  // Линия к цели: от корабля к тому, куда летишь, с расстоянием.
  if (tgt && tgt.pos && !ship.away) {
    const a = proj(cam, ship.pos.x, ship.pos.y, ship.pos.z, { x: 0, y: 0 });
    const b = proj(cam, tgt.pos.x, tgt.pos.y, tgt.pos.z, { x: 0, y: 0 });
    if (a && b) {
      ctx.strokeStyle = 'rgba(255,204,102,0.55)';
      ctx.lineWidth = Math.max(1, 1.2 * k);
      ctx.setLineDash([5 * k, 5 * k]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      const d = Math.hypot(tgt.pos.x - ship.pos.x, tgt.pos.y - ship.pos.y, tgt.pos.z - ship.pos.z) - (tgt.radius || 0);
      if (Math.hypot(a.x - b.x, a.y - b.y) > 90 * k) {
        labels.push({ s: fmtDist(Math.max(0, d)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 6 * k, color: AMBER, px: 11 * k, prio: 5, align: 'center' });
      }
    }
  }

  for (const it of map.items) {
    const o = it.obj;
    const isSel = o === sel, isHov = o === hov, isTgt = o === tgt;
    if (o.isBody) {
      // Подпись тела: крупное — всегда, спутник — когда отошёл настолько,
      // что подпись есть куда деть (это решает расстановка подписей).
      const prio = isSel ? 100 : isTgt ? 90 : isHov ? 80 : o.kind === 'star' ? 40 : o.kind === 'moon' ? 18 : 30;
      const sub = isSel || isHov ? kindLabel(o) : null;
      labels.push({
        s: o.name, sub, x: it.sx + it.r + 6 * k, y: it.sy + 4 * k, prio,
        color: isSel ? INK : isTgt ? AMBER : o.kind === 'moon' ? 'rgba(159,217,255,0.72)' : 'rgba(216,242,255,0.9)',
        px: (o.kind === 'moon' ? 11 : 12.5) * k, bold: isSel,
      });
      if (isTgt) {
        ctx.strokeStyle = AMBER;
        ctx.lineWidth = Math.max(1, 1.4 * k);
        ctx.beginPath(); ctx.arc(it.sx, it.sy, it.r + 4 * k, 0, TAU); ctx.stroke();
      }
    } else if (o.isFleet) {
      if (it.own) {
        // Свой корабль — зелёная стрелка по ходу, «ВЫ».
        let ang = -Math.PI / 2;
        const v = ship.vel, sp = Math.hypot(v.x, v.y, v.z);
        const dir = sp > 1e-4 ? v : ship.basis.fwd;
        const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
        const q = proj(cam, ship.pos.x + dir.x / dl * map.cam.dist * 0.02, ship.pos.y + dir.y / dl * map.cam.dist * 0.02,
          ship.pos.z + dir.z / dl * map.cam.dist * 0.02, { x: 0, y: 0 });
        if (q && Math.hypot(q.x - it.sx, q.y - it.sy) > 0.5) ang = Math.atan2(q.y - it.sy, q.x - it.sx);
        stalk(ship.pos, it.sx, it.sy, 'rgba(120,224,143,0.5)');
        shipGlyph(ctx, it.sx, it.sy, GREEN, k, ang);
        labels.push({ s: L('ВЫ'), x: it.sx + 10 * k, y: it.sy - 8 * k, color: GREEN, px: 11 * k, prio: 70, bold: true });
      } else {
        const c = isSel ? AMBER : 'rgba(120,224,143,0.9)';
        shipGlyph(ctx, it.sx, it.sy, c, k * 0.8);
        labels.push({ s: o.name, x: it.sx + 8 * k, y: it.sy + 4 * k, color: c, px: 11 * k, prio: isSel ? 95 : 50 });
      }
    } else {
      const port = o.isStation || o.isCity;
      const c = isSel ? AMBER : isTgt ? AMBER : port ? 'rgba(120,224,143,0.95)' : 'rgba(159,217,255,0.75)';
      glyph(ctx, it, k, c);
      labels.push({
        s: o.name, sub: isSel || isHov ? kindLabel(o) : null, x: it.sx + 8 * k, y: it.sy + 4 * k,
        color: c, px: 11 * k, prio: isSel ? 100 : isTgt ? 90 : isHov ? 80 : port ? 26 : 10, bold: isSel,
      });
      if (isTgt) {
        ctx.strokeStyle = AMBER;
        ctx.beginPath(); ctx.arc(it.sx, it.sy, 9 * k, 0, TAU); ctx.stroke();
      }
    }
    if (isSel) {
      if (!o.isFleet || !it.own) stalk(o.pos, it.sx, it.sy, 'rgba(216,242,255,0.4)');
      brackets(ctx, it.sx, it.sy, it.r, INK, k);
    } else if (isHov) {
      ctx.strokeStyle = 'rgba(159,217,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(it.sx, it.sy, it.r + 5 * k, 0, TAU); ctx.stroke();
    }
  }
  // Чужие корабли: пилоты — оранжевым и с именем, NPC — точкой.
  for (const p of map.peers) {
    ctx.fillStyle = p.npc ? NPC_COLOR : PEER;
    ctx.globalAlpha = p.dorm ? 0.5 : 1;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, (p.npc ? 2 : 3) * k, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    if (!p.npc && p.V.name) labels.push({ s: p.V.name, x: p.sx + 6 * k, y: p.sy + 4 * k, color: PEER, px: 10.5 * k, prio: 35 });
  }

  placeLabels(ctx, labels, uiRects(map));
}

// --- сцена галактики -----------------------------------------------------------

function drawGalaxyScene(ctx, map, game) {
  const k = map.ui.k, cam = map.camera, cur = game.sys, ship = game.ship;
  const sel = map.gsel, hov = map.ghover;
  const dest = destOf(game), hop = game.warpTarget;
  const lim = hopLimit(), now = warpRange(ship);

  drawGrid(ctx, map, k, (R) => (R < 10 ? R.toFixed(0) : Math.round(R)) + L(' св. лет'));

  const scr = new Map();
  for (const it of map.items) scr.set(it.obj, it);
  const P = (s) => scr.get(s) || null;

  // Круг дальности: с тем, что в баке сейчас, — по плоскости вокруг
  // системы, где корабль. Внутри — то, куда прыгнуть можно сразу.
  if (cur && now > 0.05) {
    ctx.strokeStyle = 'rgba(120,224,143,0.45)';
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.setLineDash([6 * k, 6 * k]);
    ctx.beginPath();
    let started = false;
    for (let j = 0; j <= 96; j++) {
      const t = (j / 96) * TAU;
      const q = proj(cam, cur.pos.x + Math.cos(t) * now, cur.pos.y, cur.pos.z + Math.sin(t) * now, _q);
      if (!q) { started = false; continue; }
      if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Дороги: все пары, между которыми прыжок на полном баке возможен.
  const rs = roads(lim);
  for (const r of rs) {
    const a = P(r.a), b = P(r.b);
    if (!a || !b) continue;
    const fromHere = cur && (r.a.seed === cur.seed || r.b.seed === cur.seed);
    const reach = fromHere && r.ly <= now + 1e-9;
    ctx.strokeStyle = reach ? 'rgba(120,224,143,0.55)' : fromHere ? 'rgba(79,179,224,0.42)' : 'rgba(79,179,224,0.18)';
    ctx.lineWidth = reach ? Math.max(1, 1.3 * k) : 1;
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
  }

  const labels = [];
  // Маршрут до выбранной — янтарём, с номерами прыжков.
  const route = map.route;
  if (route) {
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = Math.max(2, 2.2 * k);
    ctx.beginPath();
    let started = false;
    for (const s of route.path) {
      const q = P(s);
      if (!q) { started = false; continue; }
      if (!started) { ctx.moveTo(q.sx, q.sy); started = true; } else ctx.lineTo(q.sx, q.sy);
    }
    ctx.stroke();
    for (let i = 1; i < route.path.length; i++) {
      const a = P(route.path[i - 1]), b = P(route.path[i]);
      if (!a || !b) continue;
      // Подпись прыжка — в общую расстановку: налезть на имя системы ей
      // нельзя, и тогда её нет (длина прыжка — и в карточке).
      const d = systemDistance(route.path[i - 1], route.path[i]);
      labels.push({ s: (route.hops > 1 ? i + '. ' : '') + d.toFixed(1) + L(' св. лет'),
        x: (a.sx + b.sx) / 2, y: (a.sy + b.sy) / 2 - 7 * k, color: AMBER, px: 11 * k, prio: 20, align: 'center' });
    }
  }

  // Ножки до плоскости диска: без них галактика читается плоской.
  for (const it of map.items) {
    const s = it.obj;
    const q = proj(cam, s.pos.x, map.gcam.fy, s.pos.z, { x: 0, y: 0 });
    if (!q || Math.hypot(q.x - it.sx, q.y - it.sy) < 3) continue;
    ctx.strokeStyle = 'rgba(79,179,224,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(it.sx, it.sy); ctx.lineTo(q.x, q.y); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(q.x, q.y, 3 * k, 1.3 * k, 0, 0, TAU); ctx.stroke();
  }

  for (const it of map.items) {
    const s = it.obj;
    const here = cur && s.seed === cur.seed;
    if (!map.glDrawn) {
      const c = s.cls.color;
      ctx.fillStyle = rgb(c, 0.25);
      ctx.beginPath(); ctx.arc(it.sx, it.sy, it.r * 2.4, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = rgb(s.cls.color, 1);
    ctx.beginPath(); ctx.arc(it.sx, it.sy, Math.max(2, it.r * 0.55), 0, TAU); ctx.fill();
    if (here) {
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = Math.max(1, 1.5 * k);
      ctx.beginPath(); ctx.arc(it.sx, it.sy, it.r + 6 * k, 0, TAU); ctx.stroke();
    }
    if (hop && s.seed === hop.seed) {
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = Math.max(1, 1.4 * k);
      ctx.beginPath(); ctx.arc(it.sx, it.sy, it.r + 10 * k, 0, TAU); ctx.stroke();
    }
    if (s === sel) brackets(ctx, it.sx, it.sy, it.r + 4 * k, INK, k);
    else if (s === hov) {
      ctx.strokeStyle = 'rgba(159,217,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(it.sx, it.sy, it.r + 7 * k, 0, TAU); ctx.stroke();
    }
    const mine = map.marks.filter((m) => m.sysId === s.id && !m.active).length;
    const sub = here ? L('ВЫ ЗДЕСЬ')
      : (hop && s.seed === hop.seed ? L('ЦЕЛЬ ВАРПА')
        : (dest && s.seed === dest.seed ? L('КОНЕЦ МАРШРУТА') : systemDistance(cur, s).toFixed(1) + L(' св. лет')))
      + (mine ? ' · ' + L('КОРАБЛЕЙ ') + mine : '');
    labels.push({
      s: s.name.toUpperCase(), sub, x: it.sx, y: it.sy + it.r + 16 * k, align: 'center',
      color: s === sel ? INK : here ? GREEN : 'rgba(216,242,255,0.88)',
      subColor: here ? 'rgba(120,224,143,0.8)' : (hop && s.seed === hop.seed) ? AMBER : 'rgba(159,217,255,0.6)',
      px: 12.5 * k, prio: s === sel ? 100 : here ? 90 : 50, bold: s === sel || here,
    });
  }
  placeLabels(ctx, labels, uiRects(map));
}

// --- интерфейс -------------------------------------------------------------------

function drawUi(ctx, map, game) {
  const U = map.ui, k = U.k, W = map.W, H = map.H;
  const galaxyView = map.view === 'galaxy';

  // Верх: что за карта, где мы, переключатель видов и «закрыть».
  ctx.fillStyle = 'rgba(1,6,12,0.55)';
  ctx.fillRect(0, 0, W, U.top - 8 * k);
  ctx.textAlign = 'left';
  ctx.font = font(10.5 * k, true);
  ctx.fillStyle = CY;
  ctx.fillText(galaxyView ? L('КАРТА ГАЛАКТИКИ') : L('КАРТА СИСТЕМЫ'), U.pad, 20 * k);
  ctx.font = font(19 * k, true);
  ctx.fillStyle = INK;
  const title = galaxyView ? L('ГАЛАКТИКА') + ' · ' + (game.sys ? game.sys.name.toUpperCase() : '')
    : (game.world ? game.world.name.toUpperCase() : '');
  ctx.fillText(title, U.pad, 42 * k);

  // Переключатель видов — две вкладки посередине.
  const tw = Math.round(118 * k), th = Math.round(26 * k);
  const tx = Math.round(W / 2 - tw - 3 * k), ty = Math.round(14 * k);
  button(ctx, map, 'system', tx, ty, tw, th, L('СИСТЕМА'), galaxyView ? 'G' : '', { primary: !galaxyView, center: false });
  button(ctx, map, 'galaxy', tx + tw + 6 * k, ty, tw, th, L('ГАЛАКТИКА'), galaxyView ? '' : 'G', { primary: galaxyView });

  // «Закрыть» — справа сверху; на телефоне это единственный выход.
  const cw = Math.round((U.narrow ? 96 : 112) * k);
  button(ctx, map, 'close', W - U.pad - cw, ty, cw, th, L('ЗАКРЫТЬ'), 'M');

  if (galaxyView) {
    drawSystemList(ctx, map, game);
    drawGalaxyCard(ctx, map, game);
  } else {
    drawObjectList(ctx, map, game);
    drawObjectCard(ctx, map, game);
  }

  // Масштаб: кнопки внизу слева от свободной части кадра — ими пользуются
  // и пальцем, и мышью; там же «×N».
  const bs = Math.round(30 * k);
  const by = (U.narrow ? U.card.y : H - U.bot) - bs - 10 * k;
  const bx = (U.narrow ? U.pad : map.vx + 4 * k);
  if (U.narrow) button(ctx, map, 'list', U.pad, U.top + 4 * k, Math.round(118 * k), Math.round(28 * k),
    map.listOpen ? L('▲ СКРЫТЬ') : (galaxyView ? L('☰ СИСТЕМЫ') : L('☰ ОБЪЕКТЫ')));
  if (!(U.narrow && map.listOpen)) {
    button(ctx, map, 'zin', bx, by, bs, bs, '+', '', { center: true, fs: 16 * k });
    button(ctx, map, 'zout', bx + bs + 6 * k, by, bs, bs, '−', '', { center: true, fs: 16 * k });
    button(ctx, map, 'reset', bx + (bs + 6 * k) * 2, by, Math.round(96 * k), bs, galaxyView ? L('ВСЯ') : L('ВСЯ'), 'X');
    ctx.font = font(11 * k);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(159,217,255,0.6)';
    const z = map.zoom;
    ctx.fillText(L('МАСШТАБ ×') + (z < 10 ? z.toFixed(1) : Math.round(z)) +
      (map.follow && map.follow.name ? L('  ·  ЗА ') + String(map.follow.name).toUpperCase() : ''),
      bx + (bs + 6 * k) * 2 + 104 * k, by + bs / 2 + 4 * k);
  }

  // Подсказки — одной строкой внизу: мышь и клавиши на одном языке.
  if (!U.narrow) {
    ctx.font = font(10.5 * k);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(159,217,255,0.55)';
    const hint = galaxyView
      ? L('ЛКМ — ВЫБРАТЬ И ПРОЛОЖИТЬ · ТЯНУТЬ — ВРАЩАТЬ · WASD / ПКМ — СДВИГ · КОЛЕСО — МАСШТАБ · ←→ — ПО СИСТЕМАМ · J — ВАРП')
      : L('ЛКМ — ВЫБОР · ДВАЖДЫ — К ОБЪЕКТУ · ТЯНУТЬ — ВРАЩАТЬ · WASD / ПКМ — СДВИГ · КОЛЕСО — МАСШТАБ · ←→ — ПО ОБЪЕКТАМ · TAB — ЦЕЛЬ');
    ctx.fillText(clip(ctx, hint, W - U.pad * 2), W / 2, H - 11 * k);
  }
}

/** Иконка строки списка: кружок цвета тела, квадрат порта, домик города. */
function rowIcon(ctx, o, x, y, k) {
  if (o.isBody) {
    const c = o.color || [180, 180, 180];
    ctx.fillStyle = rgb(c, 1);
    ctx.beginPath(); ctx.arc(x, y, (o.kind === 'star' ? 4.5 : o.kind === 'moon' ? 2.5 : 3.5) * k, 0, TAU); ctx.fill();
  } else {
    glyph(ctx, { sx: x, sy: y, obj: o }, k * 0.8, 'rgba(120,224,143,0.95)');
  }
}

/** Список слева: дерево системы и мои корабли. Прокручивается колесом. */
function drawObjectList(ctx, map, game) {
  const U = map.ui, r = U.list, k = U.k;
  if (!r) return;
  column(ctx, r, k);
  const world = game.world, tgt = currentTarget(game.nav);
  const lh = Math.round(21 * k), x = r.x + 12 * k, w = r.w - 18 * k;
  const rows = treeRows(world);
  const marks = map.marks;
  const total = 26 * k + rows.length * lh + (marks.length ? 34 * k + Math.min(8, marks.length) * lh : 0);
  map.scroll = Math.max(0, Math.min(map.scroll, Math.max(0, total - r.h + 10 * k)));
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  let y = r.y + 18 * k - map.scroll;
  head(ctx, x, y, w, L('ОБЪЕКТЫ') + ' · ' + (rows.length) , k);
  y += 12 * k;
  for (const { obj, depth } of rows) {
    const row = { x: r.x + 2, y, w: r.w - 4, h: lh, obj };
    const vis = y + lh > r.y && y < r.y + r.h;
    if (vis) {
      map.lrows.push(row);
      const hover = inside(map.mx, map.my, row);
      const isSel = obj === map.sel;
      if (isSel || hover) {
        ctx.fillStyle = isSel ? 'rgba(255,204,102,0.13)' : 'rgba(79,179,224,0.14)';
        ctx.fillRect(row.x, row.y, row.w, row.h);
      }
      const ix = x + depth * 14 * k + 5 * k, cy = y + lh / 2;
      rowIcon(ctx, obj, ix, cy, k);
      ctx.font = font((depth ? 11.5 : 12.5) * k, isSel);
      ctx.textAlign = 'left';
      ctx.fillStyle = isSel ? AMBER : obj === tgt ? AMBER : depth ? 'rgba(159,217,255,0.8)' : INK;
      const nm = obj.name + (obj === tgt ? '  ◆' : '');
      ctx.fillText(clip(ctx, nm, w - (ix - x) - 74 * k), ix + 10 * k, cy + 4 * k);
      ctx.font = font(10 * k);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(159,217,255,0.45)';
      ctx.fillText(clip(ctx, kindLabel(obj), 70 * k), x + w, cy + 4 * k);
    }
    y += lh;
  }
  if (marks.length) {
    y += 22 * k;
    head(ctx, x, y, w, L('МОИ КОРАБЛИ') + ' · F', k, GREEN);
    y += 12 * k;
    for (let i = 0; i < Math.min(8, marks.length); i++) {
      const m = marks[i];
      const row = { x: r.x + 2, y, w: r.w - 4, h: lh, mark: m };
      map.rows.push(row);
      const hover = inside(map.mx, map.my, row);
      if (hover || m === map.sel) {
        ctx.fillStyle = hover ? 'rgba(79,179,224,0.16)' : 'rgba(255,204,102,0.12)';
        ctx.fillRect(row.x, row.y, row.w, row.h);
      }
      shipGlyph(ctx, x + 6 * k, y + lh / 2, m.active ? GREEN : 'rgba(120,224,143,0.8)', k * 0.7);
      ctx.font = font(12 * k);
      ctx.textAlign = 'left';
      ctx.fillStyle = m.active ? GREEN : INK;
      const who = m.name + (m.typeName && m.typeName !== m.name ? ' · ' + m.typeName : '') + (m.active ? ' ●' : '');
      ctx.fillText(clip(ctx, who, w * 0.5), x + 18 * k, y + lh / 2 + 4 * k);
      ctx.font = font(10.5 * k);
      ctx.textAlign = 'right';
      ctx.fillStyle = m.here ? 'rgba(159,217,255,0.7)' : 'rgba(255,204,102,0.8)';
      ctx.fillText(clip(ctx, m.place, w * 0.48), x + w, y + lh / 2 + 4 * k);
      y += lh;
    }
  }
  ctx.restore();
}

/** Карточка выбранного: имя, вид, описание, числа и действия. */
function drawObjectCard(ctx, map, game) {
  const U = map.ui, r = U.card, k = U.k;
  const obj = map.sel;
  if (!obj || !r) return;
  const tgt = currentTarget(game.nav);
  const isCur = obj === tgt || (obj.isMarker && tgt === obj.body);
  column(ctx, r, k, isCur ? AMBER : CY);
  const card = objectCard(game, obj);
  const pad = Math.round(14 * k), x = r.x + pad, w = r.w - pad * 2;
  if (map.cfor !== obj) { map.cfor = obj; map.cscroll = 0; }
  const top0 = r.y + 20 * k;
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  let y = top0 - (map.cscroll || 0);
  ctx.textAlign = 'left';
  ctx.font = font(10.5 * k, true);
  ctx.fillStyle = CY;
  ctx.fillText(clip(ctx, String(card.kind).toUpperCase(), w), x, y);
  y += 22 * k;
  ctx.font = font(18 * k, true);
  ctx.fillStyle = isCur ? AMBER : INK;
  ctx.fillText(clip(ctx, card.title, w), x, y);
  if (isCur) {
    y += 16 * k;
    ctx.font = font(10.5 * k, true);
    ctx.fillStyle = AMBER;
    ctx.fillText(L('◆ ТЕКУЩАЯ ЦЕЛЬ'), x, y);
  }
  y += 14 * k;

  // Действия — под именем: ради них карточку и открывают. Внизу они
  // уезжали бы за край на низком экране.
  const bh = Math.round(28 * k), gap = Math.round(6 * k);
  if (obj.isFleet) {
    if (obj.host) {
      button(ctx, map, 'target', x, y, w, bh, L('ЦЕЛЬЮ: ') + obj.host.name, 'TAB', { primary: true, clip: r });
      y += bh + gap;
    }
    button(ctx, map, 'show', x, y, w, bh, L('ПОКАЗАТЬ'), L('ПРОБЕЛ'), { clip: r });
    y += bh + gap;
  } else {
    const half = Math.floor((w - gap) / 2);
    // Цель снимают той же кнопкой, что назначают: «назначена» без способа
    // отменить — ровно та ловушка, в которую попадала выбранная звезда.
    button(ctx, map, 'target', x, y, w, bh, isCur ? L('СНЯТЬ ЦЕЛЬ') : L('НАЗНАЧИТЬ ЦЕЛЬЮ'), 'TAB',
      { primary: !isCur, clip: r });
    y += bh + gap;
    const flying = game.state && game.state.mode === 'flight';
    button(ctx, map, 'jump', x, y, half, bh, L('ПРЫЖОК'), 'J', { on: !!card.jumpOk && flying, clip: r });
    button(ctx, map, 'show', x + half + gap, y, w - half - gap, bh, L('ПОКАЗАТЬ'), L('ПРОБЕЛ'), { clip: r });
    y += bh + gap;
  }

  if (card.desc) {
    y += 8 * k;
    ctx.font = font(11 * k);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(159,217,255,0.72)';
    for (const line of wrap(ctx, card.desc, w)) { ctx.fillText(line, x, y); y += 14 * k; }
  }
  y += 6 * k;
  ctx.fillStyle = 'rgba(79,179,224,0.22)';
  ctx.fillRect(x, y, w, 1);
  y += 16 * k;

  const keyW = Math.round(Math.min(118 * k, w * 0.42));
  for (const [kk, v] of card.rows) {
    ctx.font = font(10.5 * k);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(79,179,224,0.85)';
    ctx.fillText(kk, x, y);
    ctx.font = font(11.5 * k);
    const corridor = kk === L('КОРИДОР');
    ctx.fillStyle = corridor ? (card.jumpOk ? GREEN : 'rgba(255,170,140,0.95)') : INK;
    const lines = wrap(ctx, v, w - keyW);
    for (const line of lines) { ctx.fillText(line, x + keyW, y); y += 14 * k; }
    if (!lines.length) y += 14 * k;
    y += 3 * k;
  }
  scrollEnd(ctx, map, r, k, y + (map.cscroll || 0) - top0);
  ctx.restore();
}

/**
 * Конец содержимого колонки-карточки: прокрутка не дальше него, а если
 * продолжение есть — бледная полоса внизу говорит, что колесом его видно.
 */
function scrollEnd(ctx, map, r, k, used) {
  const room = r.h - 30 * k;
  const max = Math.max(0, used - room);
  map.cscroll = Math.min(map.cscroll || 0, max);
  if (max > 0 && (map.cscroll || 0) < max - 1) {
    ctx.fillStyle = 'rgba(79,179,224,0.5)';
    ctx.fillRect(r.x + r.w / 2 - 14 * k, r.y + r.h - 6 * k, 28 * k, Math.max(1, 2 * k));
  }
}

/** Список систем: по удалённости, с тем, можно ли прыгнуть. */
function drawSystemList(ctx, map, game) {
  const U = map.ui, r = U.list, k = U.k;
  if (!r) return;
  column(ctx, r, k);
  const cur = game.sys, ship = game.ship;
  const lh = Math.round(23 * k), x = r.x + 12 * k, w = r.w - 18 * k;
  const lim = hopLimit(), now = warpRange(ship);
  const total = 26 * k + galaxy().systems.length * lh + 130 * k + (map.marks.length ? 34 * k + Math.min(8, map.marks.length) * lh : 0);
  map.scroll = Math.max(0, Math.min(map.scroll, Math.max(0, total - r.h + 10 * k)));
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  let y = r.y + 18 * k - map.scroll;
  head(ctx, x, y, w, L('СИСТЕМЫ') + ' · ' + galaxy().systems.length, k);
  y += 12 * k;
  for (const s of galaxyList(cur)) {
    const row = { x: r.x + 2, y, w: r.w - 4, h: lh, obj: s };
    map.lrows.push(row);
    const hover = inside(map.mx, map.my, row);
    const isSel = s === map.gsel;
    if (isSel || hover) {
      ctx.fillStyle = isSel ? 'rgba(255,204,102,0.13)' : 'rgba(79,179,224,0.14)';
      ctx.fillRect(row.x, row.y, row.w, row.h);
    }
    const here = cur && s.seed === cur.seed;
    const d = cur ? systemDistance(cur, s) : 0;
    ctx.fillStyle = rgb(s.cls.color, 1);
    ctx.beginPath(); ctx.arc(x + 5 * k, y + lh / 2, 3.5 * k, 0, TAU); ctx.fill();
    ctx.font = font(12.5 * k, isSel || here);
    ctx.textAlign = 'left';
    ctx.fillStyle = here ? GREEN : isSel ? AMBER : INK;
    ctx.fillText(s.name, x + 16 * k, y + lh / 2 + 4 * k);
    // Справа: здесь / прыжок сейчас / прыжок на полном баке / только маршрутом.
    const st = here ? L('вы здесь')
      : d <= now + 1e-9 ? d.toFixed(1) + L(' св. л · прыжок')
        : d <= lim + 1e-9 ? d.toFixed(1) + L(' св. л · заправка')
          : d.toFixed(1) + L(' св. л · маршрут');
    ctx.font = font(10.5 * k);
    ctx.textAlign = 'right';
    ctx.fillStyle = here ? 'rgba(120,224,143,0.8)' : d <= now + 1e-9 ? 'rgba(120,224,143,0.85)'
      : d <= lim + 1e-9 ? 'rgba(159,217,255,0.6)' : 'rgba(255,204,102,0.75)';
    ctx.fillText(st, x + w, y + lh / 2 + 4 * k);
    y += lh;
  }
  // Пояснение к кругу и дорогам: что значат линии на карте.
  y += 16 * k;
  head(ctx, x, y, w, L('ЛЕГЕНДА'), k);
  y += 18 * k;
  const legend = [
    ['rgba(120,224,143,0.8)', L('прыжок с тем, что в баке: ') + now.toFixed(1) + L(' св. лет')],
    ['rgba(79,179,224,0.6)', L('дорога: прыжок на полном баке (до ') + lim.toFixed(1) + ')'],
    [AMBER, L('маршрут до выбранной')],
  ];
  ctx.font = font(10.5 * k);
  ctx.textAlign = 'left';
  for (const [c, s] of legend) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y - 4 * k, 14 * k, Math.max(1, 2 * k));
    ctx.fillStyle = 'rgba(159,217,255,0.75)';
    for (const line of wrap(ctx, s, w - 22 * k)) { ctx.fillText(line, x + 20 * k, y); y += 13 * k; }
    y += 4 * k;
  }
  if (map.marks.length) {
    y += 12 * k;
    head(ctx, x, y, w, L('МОИ КОРАБЛИ') + ' · F', k, GREEN);
    y += 12 * k;
    for (let i = 0; i < Math.min(8, map.marks.length); i++) {
      const m = map.marks[i];
      const row = { x: r.x + 2, y, w: r.w - 4, h: lh, mark: m };
      map.rows.push(row);
      if (inside(map.mx, map.my, row)) {
        ctx.fillStyle = 'rgba(79,179,224,0.16)';
        ctx.fillRect(row.x, row.y, row.w, row.h);
      }
      shipGlyph(ctx, x + 6 * k, y + lh / 2, m.active ? GREEN : 'rgba(120,224,143,0.8)', k * 0.7);
      ctx.font = font(12 * k);
      ctx.textAlign = 'left';
      ctx.fillStyle = m.active ? GREEN : INK;
      ctx.fillText(clip(ctx, m.name, w * 0.45), x + 18 * k, y + lh / 2 + 4 * k);
      ctx.font = font(10.5 * k);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(159,217,255,0.7)';
      ctx.fillText(clip(ctx, m.systemName || (m.here && cur ? cur.name : ''), w * 0.5), x + w, y + lh / 2 + 4 * k);
      y += lh;
    }
  }
  ctx.restore();
}

/** Карточка системы: звезда, прыжок, маршрут, топливо — и варп отсюда. */
function drawGalaxyCard(ctx, map, game) {
  const U = map.ui, r = U.card, k = U.k;
  const s = map.gsel;
  if (!s || !r) return;
  const card = systemCard(game, s, map.route);
  const dest = destOf(game);
  const aimed = !card.here && dest && dest.seed === s.seed;
  column(ctx, r, k, aimed ? AMBER : CY);
  const pad = Math.round(14 * k), x = r.x + pad, w = r.w - pad * 2;
  if (map.cfor !== s) { map.cfor = s; map.cscroll = 0; }
  const top0 = r.y + 20 * k;
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  let y = top0 - (map.cscroll || 0);
  ctx.textAlign = 'left';
  ctx.font = font(10.5 * k, true);
  ctx.fillStyle = rgb(s.cls.color, 1);
  ctx.fillText(clip(ctx, card.kind, w), x, y);
  y += 22 * k;
  ctx.font = font(18 * k, true);
  ctx.fillStyle = aimed ? AMBER : card.here ? GREEN : INK;
  ctx.fillText(clip(ctx, card.title.toUpperCase(), w), x, y);
  y += 14 * k;
  const bh = Math.round(28 * k), gap = Math.round(6 * k);
  if (!card.here) {
    const half = Math.floor((w - gap) / 2);
    button(ctx, map, 'aim', x, y, w, bh, aimed ? L('СНЯТЬ ЦЕЛЬ') : L('НАЗНАЧИТЬ ЦЕЛЬЮ'), 'TAB',
      { primary: !aimed, on: !!map.route || aimed, clip: r });
    y += bh + gap;
    const flying = game.state && game.state.mode === 'flight';
    button(ctx, map, 'warp', x, y, half, bh, L('ВАРП'), 'J', { on: card.warpOk && flying, clip: r });
    button(ctx, map, 'show', x + half + gap, y, w - half - gap, bh, L('ПОКАЗАТЬ'), L('ПРОБЕЛ'), { clip: r });
    y += bh + gap;
    if (!card.warpOk && card.reason) {
      ctx.font = font(10.5 * k);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,170,140,0.95)';
      for (const line of wrap(ctx, card.reason, w)) { y += 13 * k; ctx.fillText(line, x, y); }
      y += 4 * k;
    }
  }
  if (card.desc) {
    y += 12 * k;
    ctx.font = font(11 * k);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(159,217,255,0.72)';
    for (const line of wrap(ctx, card.desc, w)) { ctx.fillText(line, x, y); y += 14 * k; }
  }
  y += 6 * k;
  ctx.fillStyle = 'rgba(79,179,224,0.22)';
  ctx.fillRect(x, y, w, 1);
  y += 16 * k;
  const keyW = Math.round(Math.min(126 * k, w * 0.44));
  for (const [kk, v] of card.rows) {
    ctx.font = font(10.5 * k);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(79,179,224,0.85)';
    ctx.fillText(kk, x, y);
    ctx.font = font(11.5 * k);
    ctx.fillStyle = INK;
    const lines = wrap(ctx, v, w - keyW);
    for (const line of lines) { ctx.fillText(line, x + keyW, y); y += 14 * k; }
    if (!lines.length) y += 14 * k;
    y += 3 * k;
  }
  scrollEnd(ctx, map, r, k, y + (map.cscroll || 0) - top0);
  ctx.restore();
}
