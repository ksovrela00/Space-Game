// Карта системы: план на плоскости XZ с масштабом, выбором объектов и
// справкой о выбранном.
//
// Карта была статичной картинкой: шесть орбит, подписи и крестик
// корабля. Смотреть на неё было можно, пользоваться — нет: ни
// приблизиться к планете с лунами, ни ткнуть в станцию, ни узнать, куда
// вообще летишь. Теперь это рабочий инструмент — масштаб от всей
// системы до окрестностей одной станции, выбор объекта мышью или
// стрелками, назначение цели (Tab) и карточка с физикой выбранного.
//
// Проекция ЛИНЕЙНАЯ, а не логарифмическая, как раньше. Логарифм был
// нужен, чтобы внутренние орбиты не слипались в точку, но с ним
// невозможен сам смысл масштаба: вблизи планеты её луны и станция
// остаются в одном пикселе при любом приближении. Здесь орбиты
// отличаются всего в десять раз (0.34–3.6 млн км), и линейная карта
// читается и без ухищрений.
//
// Всё, что панель пишет о теле, взято из модели мира (js/game/bodyinfo.js):
// масса из плотности и радиуса, тяжесть из массы, сутки из периода
// вращения, воздух — из того же давления, по которому считается нагрев
// при входе. Подписи, не подтверждённой числом из мира, в карточке нет.

import { fmtDist, fmtTime } from './hud.js';
import { CITY } from '../models/city.js';
import {
  KIND_INFO, kindLabel, massOf, escapeSpeed, dayLength, atmosphereOf,
  temperatureOf, toCelsius, EARTH_MASS, starDistance,
} from '../game/bodyinfo.js';
import { DENSITY } from '../game/gravity.js';
import { isLandable, isSolid } from '../game/surface.js';
import { LIMITS } from '../game/docking.js';
import { canJump } from '../game/quantum.js';
import { currentTarget } from '../game/nav.js';
import { say } from '../game/state.js';
import { galaxy, systemDistance, warpSeconds, SPREAD } from '../game/galaxy.js';
import { L } from '../core/lang.js';

const CY = '#4fb3e0';
const CY_DIM = 'rgba(79,179,224,0.35)';
const PALE = '#9fd9ff';
const AMBER = '#ffcc66';
const GREEN = '#78e08f';

// Пределы масштаба. Единица — вся система в кадре, потолок подобран по
// самой тесной паре, которую вообще нужно различать: станция и её
// планета расходятся на пару тысяч километров.
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 900;

// Поля карты: сверху заголовок, снизу подсказки, справа карточка.
const PAD_TOP = 46;
const PAD_BOT = 40;

export function makeMap() {
  return {
    // Карта одна, а видов у неё два: система и галактика. Отдельным
    // экраном галактику делать не стали — это тот же вопрос «куда
    // лететь», только на другом масштабе, и переключаться между ними
    // одной клавишей быстрее, чем открывать второе окно.
    view: 'system',        // system | galaxy
    gsel: null,            // выбранная система (в виде галактики)
    zoom: 1,
    cx: 0, cz: 0,          // центр вида в мировых километрах (плоскость XZ)
    sel: null,             // выбранный объект (о нём карточка)
    follow: null,          // за кем едет вид; ручное перетаскивание его сбрасывает
    items: [],             // что нарисовано в прошлом кадре — по нему ищут попадание
    scale: 0,              // пикселей на километр в этом кадре
    vx: 0, vy: 0, vw: 1, vh: 1,
    mx: -1, my: -1,        // курсор
    hover: null,
    dragged: false,
  };
}

// --- геометрия ---------------------------------------------------------------

const outerOrbit = (world) => world.planets[world.planets.length - 1].orbit.radius;

/** Масштаб «вся система в кадре», пикселей на километр. */
export const fitScale = (map, world) => Math.min(map.vw, map.vh) * 0.44 / outerOrbit(world);

const projX = (map, wx) => map.vx + map.vw / 2 + (wx - map.cx) * map.scale;
const projY = (map, wz) => map.vy + map.vh / 2 + (wz - map.cz) * map.scale;

const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

/**
 * Насколько крупный «свой мир» у объекта — по нему считается приближение
 * при переходе к нему стрелками. Планету показываем вместе с её лунами и
 * станцией, станцию — вместе с её орбитой: иначе выбранное оказывается
 * либо точкой, либо во весь экран.
 */
function spanOf(obj, world) {
  if (!obj) return outerOrbit(world);
  if (obj.isMarker) return obj.dist * 1.6;
  if (obj.isStation) return obj.orbit.radius * 1.5;
  // Город стоит НА теле, и сам по себе он точка. Показываем его вместе с
  // телом: иначе карта прыгнула бы в масштаб двух километров, где нет
  // ничего, кроме самого города.
  if (obj.isCity) return obj.body.radius * 3;
  if (obj.kind === 'star') return outerOrbit(world) * 2.2;
  let span = obj.radius * 8;
  for (const m of obj.moons || []) span = Math.max(span, m.orbit.radius * 1.4);
  if (obj.station) span = Math.max(span, obj.station.orbit.radius * 2.5);
  return span;
}

/** Показать объект целиком и поехать за ним. */
export function focusOn(map, world, obj) {
  if (!obj) return;
  map.follow = obj;
  map.cx = obj.pos.x; map.cz = obj.pos.z;
  const span = spanOf(obj, world);
  const want = Math.min(map.vw, map.vh) * 0.35 / span;   // пикселей на километр
  map.zoom = clampZoom(want / fitScale(map, world));
}

export function resetMap(map, world) {
  map.zoom = 1;
  map.follow = null;
  map.cx = 0; map.cz = 0;
  if (world && world.star) { map.cx = world.star.pos.x; map.cz = world.star.pos.z; }
}

/**
 * Изменить масштаб, оставив на месте точку под курсором.
 * Когда вид едет за объектом, курсор не учитывается: иначе масштаб и
 * слежение спорили бы за центр и картинка дёргалась.
 */
function zoomBy(map, k, ax, ay) {
  const z0 = map.zoom;
  map.zoom = clampZoom(map.zoom * k);
  if (map.zoom === z0 || map.follow) return;
  const s0 = map.scale;
  const s1 = s0 * (map.zoom / z0);
  if (!(s0 > 0) || !(s1 > 0)) return;
  // Мировая точка под курсором должна остаться под курсором.
  const ox = ax - (map.vx + map.vw / 2);
  const oy = ay - (map.vy + map.vh / 2);
  map.cx += ox / s0 - ox / s1;
  map.cz += oy / s0 - oy / s1;
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

/** Насколько объект отстоит от своего хозяина, км (Infinity — сам хозяин). */
function offsetOf(obj) {
  if (!obj) return Infinity;
  if (obj.isMarker) return obj.dist;
  if (obj.isStation) return obj.orbit.radius;
  // Город лежит на поверхности, то есть ровно в радиусе тела от его
  // центра. По этому же числу решается, показывать ли его: пока диск
  // планеты мельче нескольких пикселей, город — утолщение точки.
  if (obj.isCity) return obj.body.radius;
  if (obj.parent && obj.parent.parent) return obj.orbit.radius;   // луна
  return Infinity;
}

// Спутник показывается только тогда, когда он отошёл от своей планеты
// хотя бы на несколько пикселей: иначе это не объект, а утолщение точки.
const visibleAt = (obj, scale) => offsetOf(obj) * scale > 5;

/** Радиус значка на экране, пикселей. */
export function glyphRadius(obj, map) {
  if (!obj || obj.isMarker || obj.isStation || obj.isCity) return 4;
  const min = obj.kind === 'star' ? 5 : (obj.kind === 'moon' ? 2 : 3.2);
  return Math.max(min, Math.min(obj.radius * map.scale, Math.min(map.vw, map.vh) * 0.45));
}

/**
 * Лёг ли маркер на диск своего тела.
 *
 * Карта — проекция на плоскость орбит, и два маркера из шести стоят над
 * полюсами: в этой проекции они приходятся ровно на центр тела. Толку от
 * них там нет — ни различить, ни ткнуть, — зато они закрывают планету
 * собой и своей подписью.
 */
export function markerOnBody(mk, map) {
  const b = mk.body;
  if (!b) return false;
  const dx = (mk.pos.x - b.pos.x) * map.scale;
  const dz = (mk.pos.z - b.pos.z) * map.scale;
  return Math.hypot(dx, dz) < glyphRadius(b, map) + 5;
}

/**
 * Что под курсором. Ищем среди нарисованного — по экрану, а не по миру.
 *
 * Маркер уступает телу, даже если лежит к курсору ближе: это точка в
 * пустоте ВОКРУГ того же тела, и когда они рядом, целятся в тело.
 * Обратное неверно — попасть в маркер мимо тела ничто не мешает.
 */
export function pickAt(map, x, y, reach = 13) {
  let best = null, bestD = reach * reach;
  let mark = null, markD = reach * reach;
  for (const it of map.items) {
    const dx = it.sx - x, dy = it.sy - y;
    const d = dx * dx + dy * dy;
    if (it.obj.isMarker) { if (d <= markD) { markD = d; mark = it.obj; } }
    else if (d <= bestD) { bestD = d; best = it.obj; }
  }
  return best || mark;
}

// --- управление --------------------------------------------------------------

const _pan = { x: 0, y: 0 };

/**
 * Разбор ввода в режиме карты. Вызывается каждый кадр из main.js —
 * колесо, перетаскивание и выбор живут здесь, потому что в полёте
 * ничего из этого не работает.
 */
export function mapInput(game, input) {
  const map = game.map;
  const world = game.world;
  if (!map.sel) map.sel = currentTarget(game.nav);

  map.mx = input.mouse.x;
  map.my = input.mouse.y;

  if (input.pressed('KeyG')) {
    map.view = map.view === 'galaxy' ? 'system' : 'galaxy';
    map.items.length = 0;         // попадания курсора считаются от нового вида
  }
  if (map.view === 'galaxy') { galaxyInput(game, input); return; }

  // Колесо — масштаб вокруг курсора.
  const wheel = input.takeWheel();
  if (wheel) zoomBy(map, Math.exp(-wheel * 0.0015), map.mx, map.my);

  // Клавишами — вокруг центра: курсор в этот момент может быть где угодно.
  // Плюс и минус сюда не годятся: ими везде, в том числе на карте,
  // меняется громкость, и одна клавиша делала бы два дела сразу.
  const ax = map.vx + map.vw / 2, ay = map.vy + map.vh / 2;
  if (input.pressed('KeyW', 'ArrowUp')) zoomBy(map, 1.35, ax, ay);
  if (input.pressed('KeyS', 'ArrowDown')) zoomBy(map, 1 / 1.35, ax, ay);

  // Перетаскивание: вид отвязывается от объекта, за которым ехал.
  input.takePan(_pan);
  if (input.mouse.left && (_pan.x || _pan.y) && map.scale > 0) {
    map.follow = null;
    map.cx -= _pan.x / map.scale;
    map.cz -= _pan.y / map.scale;
    map.dragged = true;
  }
  // Щелчок выбирает то, что под курсором, и НЕ трогает вид: карта не
  // должна прыгать под рукой.
  if (input.mouse.clicked) {
    map.dragged = false;
    const hit = pickAt(map, map.mx, map.my);
    if (hit) map.sel = hit;
  }

  // Стрелками — по списку системы; сюда же попадают станции и луны,
  // невидимые при обзорном масштабе, поэтому вид к ним подъезжает сам.
  const dir = (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) -
              (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  if (dir) {
    const all = mapObjects(world, map.sel);
    let i = all.indexOf(map.sel);
    i = i < 0 ? 0 : (i + dir + all.length) % all.length;
    map.sel = all[i];
    focusOn(map, world, map.sel);
  }

  if (input.pressed('Space')) focusOn(map, world, map.sel);
  if (input.pressed('KeyX', 'Digit0', 'Numpad0')) resetMap(map, world);

  if (input.pressed('Tab', 'Enter', 'NumpadEnter')) {
    const t = map.sel;
    if (!t) say(game.state, L('ОБЪЕКТ НЕ ВЫБРАН'), AMBER);
    else {
      game.selectTarget(t);
      say(game.state, L('ЦЕЛЬ: ') + t.name);
    }
  }
}

// --- карта галактики ---------------------------------------------------------
//
// Второй вид той же карты: тот же вопрос «куда лететь», только систему
// целиком видно точкой. Здесь и назначается цель варп-прыжка — больше
// назначать её негде, в полёте другая система ничем себя не проявляет.

/** Список систем в порядке удалённости от текущей — по нему ходят стрелки. */
export function galaxyList(cur) {
  const all = galaxy().systems.slice();
  all.sort((a, b) => systemDistance(cur, a) - systemDistance(cur, b));
  return all;
}

/**
 * Выбор системы СРАЗУ делает её целью варпа.
 *
 * На карте системы выбор и цель разведены намеренно: там перебирают
 * объекты, чтобы прочитать про них, и назначение целью — отдельное
 * решение. В галактике читать нечего: состав чужой системы неизвестен до
 * прибытия, и единственное, зачем её выбирают, — чтобы туда лететь.
 *
 * ТО, ЧТО БЫЛО СЛОМАНО: цель ставилась только по Tab. Выбрав систему
 * щелчком и нажав J, игрок получал отказ «цель не выбрана» — при том, что
 * система на карте была выбрана и подсвечена. Лишний обряд там, где
 * выбирать больше не из чего.
 */
function aimGalaxy(game, s) {
  const map = game.map;
  map.gsel = s;
  if (!s || s.seed === game.sys.seed) return false;
  if (game.warpTarget && game.warpTarget.seed === s.seed) return false;
  game.warpTarget = s;
  say(game.state, L('ЦЕЛЬ ВАРПА: ') + s.name.toUpperCase() + ' · ' +
    systemDistance(game.sys, s).toFixed(1) + L(' СВ. ЛЕТ · ') +
    Math.round(warpSeconds(game.sys, s)) + L(' С'), GREEN);
  return true;
}

function galaxyInput(game, input) {
  const map = game.map;
  const cur = game.sys;
  const list = galaxyList(cur);
  // Открыли галактику впервые — цель назначается сразу, ближайшим
  // соседом. Иначе на карте есть подсвеченная система, а цели нет, и это
  // расхождение и есть та самая ловушка: игрок видит выбор, жмёт J и
  // получает «цель не выбрана». Выделение на этой карте ВСЕГДА означает
  // цель варпа, без исключений.
  if (!map.gsel) aimGalaxy(game, game.warpTarget || list[1] || list[0]);

  if (input.mouse.clicked) {
    const hit = pickAt(map, map.mx, map.my);
    if (hit) aimGalaxy(game, hit);
  }

  const dir = (input.pressed('ArrowRight', 'KeyD') ? 1 : 0) -
              (input.pressed('ArrowLeft', 'KeyA') ? 1 : 0);
  if (dir) {
    let i = list.findIndex((s) => s.seed === map.gsel.seed);
    i = i < 0 ? 0 : (i + dir + list.length) % list.length;
    aimGalaxy(game, list[i]);
  }

  // Tab оставлен рабочим: он ничего не меняет, но и не наказывает за
  // привычку с карты системы — там он и есть способ назначить цель.
  if (input.pressed('Tab', 'Enter', 'NumpadEnter')) {
    const t = map.gsel;
    if (!t) say(game.state, L('СИСТЕМА НЕ ВЫБРАНА'), AMBER);
    else if (t.seed === cur.seed) say(game.state, L('ВЫ УЖЕ В ЭТОЙ СИСТЕМЕ'), AMBER);
    else if (!aimGalaxy(game, t)) {
      say(game.state, L('ЦЕЛЬ ВАРПА: ') + t.name.toUpperCase() + L(' · J В ПОЛЁТЕ'), GREEN);
    }
  }
}

function drawGalaxy(ctx, map, game, w, h) {
  const cur = game.sys;
  const systems = galaxy().systems;
  if (!map.gsel) map.gsel = game.warpTarget || systems.find((s) => s.seed !== cur.seed) || cur;

  const panelW = Math.max(240, Math.min(360, Math.round(w * 0.26)));
  map.vx = 0; map.vy = PAD_TOP;
  map.vw = Math.max(80, w - panelW - 16);
  map.vh = Math.max(80, h - PAD_TOP - PAD_BOT);

  // Вид всегда целиком: галактика маленькая, и масштабировать её незачем —
  // вся ценность карты в том, что семь систем видно разом.
  const cx = map.vx + map.vw / 2, cy = map.vy + map.vh / 2;
  const sc = Math.min(map.vw, map.vh) * 0.42 / SPREAD;
  const px = (s) => cx + s.pos.x * sc;
  const py = (s) => cy + s.pos.z * sc;

  ctx.save();
  ctx.font = '11px Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = CY;
  ctx.fillText(L('КАРТА ГАЛАКТИКИ'), 18, 28);
  ctx.fillStyle = 'rgba(159,217,230,0.65)';
  ctx.fillText(L('ВЫ В СИСТЕМЕ ') + cur.name.toUpperCase(), 250, 28);

  // Круги дальности от текущей системы: по ним расстояние читается без
  // линейки, а заодно видно, что галактика плоская.
  ctx.strokeStyle = 'rgba(79,179,224,0.16)';
  ctx.lineWidth = 1;
  for (let ly = 5; ly <= SPREAD; ly += 5) {
    ctx.beginPath();
    ctx.arc(px(cur), py(cur), ly * sc, 0, Math.PI * 2);
    ctx.stroke();
  }

  const sel = map.gsel;
  const tgt = game.warpTarget;

  // Линия до выбранной: по ней и читается прыжок.
  if (sel && sel.seed !== cur.seed) {
    ctx.strokeStyle = 'rgba(120,224,143,0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px(cur), py(cur));
    ctx.lineTo(px(sel), py(sel));
    ctx.stroke();
    ctx.setLineDash([]);
    const d = systemDistance(cur, sel);
    ctx.fillStyle = GREEN;
    ctx.textAlign = 'center';
    ctx.fillText(d.toFixed(1) + L(' СВ. ЛЕТ · ') + Math.round(warpSeconds(cur, sel)) + L(' С'),
      (px(cur) + px(sel)) / 2, (py(cur) + py(sel)) / 2 - 6);
  }

  map.items.length = 0;
  for (const s of systems) {
    const x = px(s), y = py(s);
    map.items.push({ obj: s, sx: x, sy: y });

    // Стойка вниз показывает высоту над плоскостью диска: без неё
    // галактика читается плоской, а системы расходятся ещё и по вертикали.
    const stalk = s.pos.y * sc;
    if (Math.abs(stalk) > 1) {
      ctx.strokeStyle = 'rgba(79,179,224,0.25)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - stalk);
      ctx.stroke();
    }

    // Размер точки — от светимости: белая звезда крупнее карлика, и
    // класс системы виден раньше, чем прочитано её имя.
    const r = 3 + Math.min(4, Math.sqrt(s.cls.lum) * 2.2);
    ctx.fillStyle = rgb(s.cls.color);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    if (s.seed === cur.seed) {
      ctx.strokeStyle = PALE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    if (tgt && s.seed === tgt.seed) {
      ctx.strokeStyle = AMBER;
      ctx.beginPath();
      ctx.arc(x, y, r + 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (sel && s.seed === sel.seed) {
      ctx.strokeStyle = GREEN;
      ctx.strokeRect(x - r - 7, y - r - 7, (r + 7) * 2, (r + 7) * 2);
    }

    ctx.fillStyle = s.seed === cur.seed ? PALE : 'rgba(159,217,230,0.8)';
    ctx.textAlign = 'center';
    ctx.fillText(s.name.toUpperCase(), x, y + r + 14);
  }

  drawSystemCard(ctx, game, sel, w - panelW - 6, PAD_TOP - 8, panelW, h - PAD_TOP - PAD_BOT + 18);

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(159,217,230,0.6)';
  ctx.fillText(L('←,→ / ЛКМ — ВЫБРАТЬ СИСТЕМУ (ОНА СРАЗУ СТАНОВИТСЯ ЦЕЛЬЮ ВАРПА)'), 18, h - 26);
  ctx.fillText(L('G — НАЗАД К СИСТЕМЕ · M — ЗАКРЫТЬ · ПРЫЖОК — J В ПОЛЁТЕ'), 18, h - 12);
  ctx.restore();
}

function drawSystemCard(ctx, game, s, x, y, w, h) {
  ctx.fillStyle = 'rgba(2,10,18,0.9)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  if (!s) return;

  const cur = game.sys;
  const pad = 12;
  let ty = y + 22;
  ctx.textAlign = 'left';
  ctx.fillStyle = AMBER;
  ctx.font = 'bold 13px Consolas, monospace';
  ctx.fillText(s.name.toUpperCase(), x + pad, ty);
  ty += 16;
  ctx.font = '11px Consolas, monospace';
  ctx.fillStyle = CY;
  ctx.fillText(L(s.cls.ru).toUpperCase() + L(' · КЛАСС ') + s.cls.id, x + pad, ty);
  ty += 18;

  const d = systemDistance(cur, s);
  const rows = [
    [L('Температура'), Math.round(s.cls.temp) + ' K'],
    [L('Светимость'), s.cls.lum.toFixed(2) + L(' солнечной')],
    [L('Обитаемая зона'), Math.round(s.hab / 1000) + L(' тыс. км')],
    [L('Расстояние'), s.seed === cur.seed ? L('— вы здесь') : d.toFixed(1) + L(' св. лет')],
    [L('Прыжок'), s.seed === cur.seed ? '—' : Math.round(warpSeconds(cur, s)) + L(' секунд')],
  ];
  const keyW = 118;
  for (const [k, v] of rows) {
    ctx.fillStyle = 'rgba(79,179,224,0.75)';
    ctx.fillText(k, x + pad, ty);
    ctx.fillStyle = PALE;
    ctx.fillText(v, x + pad + keyW, ty);
    ty += 14;
  }
  ty += 8;

  // Что внутри системы — НЕ показываем, и это не забывчивость. Система
  // собирается только по прибытии (js/main.js, enterSystem), и в памяти
  // её нет. Обещать состав планет заранее значило бы либо держать все
  // системы разом, либо врать.
  ctx.fillStyle = 'rgba(159,217,230,0.72)';
  const note = s.seed === cur.seed
    ? L('Текущая система. Её карта — на клавише G.')
    : L('Что там внутри, известно только по прибытии: система собирается ') +
      L('под тоннелем прыжка.');
  for (const line of wrap(ctx, note, w - pad * 2)) { ctx.fillText(line, x + pad, ty); ty += 13; }

  if (game.warpTarget && game.warpTarget.seed === s.seed) {
    ty += 8;
    ctx.fillStyle = AMBER;
    ctx.fillText(L('ЦЕЛЬ ВАРПА · J В ПОЛЁТЕ'), x + pad, ty);
  }
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

// --- карточка объекта --------------------------------------------------------

function landingNote(b) {
  if (b.kind === 'star') return L('исключена');
  if (!isSolid(b)) return L('поверхности нет');
  if (!isLandable(b)) return L('нужен аэродинамический спуск');
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
    rows.push([L('ПЛОЩАДКИ'), String(CITY.pads)]);
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
    // Описание лежит в каталоге по-русски (js/game/bodyinfo.js) и
    // переводится здесь, на показе, — как и название типа.
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

// --- отрисовка ---------------------------------------------------------------

const disc = (ctx, x, y, r, fill) => {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

const rgb = (c) => 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';

export function drawMap(r, game) {
  const ctx = r.ctx;
  const w = r.camera.w, h = r.camera.h;
  const map = game.map;
  const world = game.world;

  if (map.view === 'galaxy') {
    ctx.save();
    ctx.fillStyle = 'rgba(0,4,10,0.94)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    drawGalaxy(ctx, map, game, w, h);
    return;
  }

  const panelW = Math.max(240, Math.min(360, Math.round(w * 0.26)));
  map.vx = 0; map.vy = PAD_TOP;
  map.vw = Math.max(80, w - panelW - 16);
  map.vh = Math.max(80, h - PAD_TOP - PAD_BOT);

  if (!map.sel) map.sel = currentTarget(game.nav);
  if (map.follow) { map.cx = map.follow.pos.x; map.cz = map.follow.pos.z; }
  else if (map.cx === 0 && map.cz === 0) { map.cx = world.star.pos.x; map.cz = world.star.pos.z; }
  map.scale = fitScale(map, world) * map.zoom;

  ctx.save();
  ctx.fillStyle = 'rgba(0,4,10,0.92)';
  ctx.fillRect(0, 0, w, h);
  ctx.font = '11px Consolas, monospace';

  ctx.textAlign = 'left';
  ctx.fillStyle = CY;
  ctx.fillText(L('КАРТА СИСТЕМЫ ') + world.name.toUpperCase(), 18, 28);
  ctx.fillStyle = 'rgba(159,217,230,0.65)';
  ctx.fillText(L('МАСШТАБ ×') + (map.zoom < 10 ? map.zoom.toFixed(1) : Math.round(map.zoom)) +
    (map.follow ? L('   ЗА ') + map.follow.name.toUpperCase() : ''), 250, 28);

  drawPlan(ctx, map, game, world);
  drawScaleBar(ctx, map);
  drawPanel(ctx, game, w - panelW - 6, PAD_TOP - 8, panelW, h - PAD_TOP - PAD_BOT + 18);

  // Подсказки в две строки: одной они не помещаются в узкое окно, а
  // обрезанная подсказка хуже, чем её отсутствие.
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(159,217,230,0.6)';
  ctx.fillText(L('КОЛЕСО / W,S — МАСШТАБ · ЛКМ — ВЫБОР · ТЯНУТЬ — СДВИГ'), 18, h - 26);
  ctx.fillText(L('←,→ — ПО ОБЪЕКТАМ · ПРОБЕЛ — К ВЫБРАННОМУ · TAB — НАЗНАЧИТЬ ЦЕЛЬЮ · ') +
    L('X — СБРОС · M — ЗАКРЫТЬ'), 18, h - 12);
  ctx.fillStyle = 'rgba(255,204,102,0.7)';
  ctx.fillText(L('G — КАРТА ГАЛАКТИКИ'), 18, h - 40);
  ctx.restore();
}

function drawPlan(ctx, map, game, world) {
  const ship = game.ship;
  const target = currentTarget(game.nav);
  const items = map.items;
  items.length = 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(map.vx, map.vy, map.vw, map.vh);
  ctx.clip();

  // Орбиты — окружности вокруг хозяина. Рисуем только те, что видно:
  // иначе при сильном приближении в кадре стоит дуга радиусом в экран.
  const ring = (host, radius, color) => {
    const rr = radius * map.scale;
    if (rr < 4 || rr > 12000) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(projX(map, host.pos.x), projY(map, host.pos.z), rr, 0, Math.PI * 2);
    ctx.stroke();
  };

  for (const p of world.planets) {
    ring(world.star, p.orbit.radius, 'rgba(79,179,224,0.20)');
    for (const m of p.moons) ring(p, m.orbit.radius, 'rgba(79,179,224,0.16)');
    if (p.station) ring(p, p.station.orbit.radius, 'rgba(120,224,143,0.18)');
  }

  for (const obj of mapObjects(world, map.sel)) {
    if (!visibleAt(obj, map.scale) && obj !== map.sel) continue;
    // Маркер, легший на диск своего тела, не показываем: выбрать его там
    // всё равно нельзя, а планету он закрывает. Выбранный — исключение:
    // раз его выбрали, он должен быть виден, где бы ни оказался.
    if (obj.isMarker && obj !== map.sel && markerOnBody(obj, map)) continue;
    const sx = projX(map, obj.pos.x), sy = projY(map, obj.pos.z);
    if (sx < map.vx - 40 || sx > map.vx + map.vw + 40) continue;
    if (sy < map.vy - 40 || sy > map.vy + map.vh + 40) continue;
    items.push({ obj, sx, sy });
    drawGlyph(ctx, obj, sx, sy, map, obj === target);
  }

  // Корабль — зелёный крест, и от него пунктир к выбранному: по нему
  // сразу видно, куда собрался лететь и насколько это далеко.
  const shx = projX(map, ship.pos.x), shy = projY(map, ship.pos.z);
  if (map.sel) {
    const sx = projX(map, map.sel.pos.x), sy = projY(map, map.sel.pos.z);
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255,204,102,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(shx, shy); ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 11, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(shx - 6, shy); ctx.lineTo(shx + 6, shy);
  ctx.moveTo(shx, shy - 6); ctx.lineTo(shx, shy + 6);
  ctx.stroke();
  ctx.fillStyle = GREEN;
  ctx.textAlign = 'left';
  ctx.fillText(L('КОРАБЛЬ'), shx + 9, shy + 13);

  // Подсветка того, что под курсором: без неё непонятно, во что попадёшь.
  map.hover = pickAt(map, map.mx, map.my);
  if (map.hover && map.hover !== map.sel) {
    const it = items.find((x) => x.obj === map.hover);
    if (it) {
      ctx.strokeStyle = 'rgba(159,217,230,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(it.sx, it.sy, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawGlyph(ctx, obj, sx, sy, map, isTarget) {
  const sel = obj === map.sel;
  let size = 4;
  ctx.lineWidth = 1;

  if (obj.isMarker) {
    ctx.strokeStyle = sel ? AMBER : CY_DIM;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 4); ctx.lineTo(sx + 4, sy);
    ctx.lineTo(sx, sy + 4); ctx.lineTo(sx - 4, sy);
    ctx.closePath();
    ctx.stroke();
  } else if (obj.isStation) {
    ctx.strokeStyle = sel ? AMBER : GREEN;
    ctx.strokeRect(sx - 3.5, sy - 3.5, 7, 7);
  } else if (obj.isCity) {
    // Город — домик: треугольник на основании. Зелёным, как порт: это
    // тоже место, куда садятся, в отличие от тел и точек в пустоте.
    ctx.strokeStyle = sel ? AMBER : GREEN;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 4.5);
    ctx.lineTo(sx + 4, sy + 3);
    ctx.lineTo(sx - 4, sy + 3);
    ctx.closePath();
    ctx.stroke();
  } else {
    // Тело рисуется своим же цветом — тем, каким его видно из кабины, —
    // и своим же радиусом, пока он крупнее метки.
    const rr = glyphRadius(obj, map);
    disc(ctx, sx, sy, rr, rgb(obj.color));
    if (obj.rings) {
      ctx.strokeStyle = 'rgba(206,186,150,0.6)';
      ctx.beginPath();
      ctx.arc(sx, sy, rr * 1.9, 0, Math.PI * 2);
      ctx.stroke();
    }
    size = rr;
  }

  if (isTarget) {
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, size + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Подпись: у крупного — всегда, у спутников — когда они отошли от
  // планеты настолько, что подпись есть куда деть.
  const off = offsetOf(obj) * map.scale;
  if (off > 22 || sel) {
    ctx.textAlign = 'left';
    ctx.fillStyle = sel ? AMBER
      : (obj.isStation || obj.isCity ? 'rgba(120,224,143,0.85)'
        : 'rgba(159,217,230,0.78)');
    ctx.fillText(obj.name, sx + size + 5, sy + 4);
  }
}

function drawScaleBar(ctx, map) {
  // Отрезок «круглой» длины: берём примерно 160 пикселей и округляем
  // километры вниз до 1/2/5·10^n — читается только такое.
  const km = 160 / map.scale;
  const e = Math.floor(Math.log10(km));
  const base = 10 ** e;
  const m = km / base;
  const nice = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * base;
  const px = nice * map.scale;
  const y = map.vy + map.vh - 12;
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(18, y); ctx.lineTo(18 + px, y);
  ctx.moveTo(18, y - 4); ctx.lineTo(18, y + 4);
  ctx.moveTo(18 + px, y - 4); ctx.lineTo(18 + px, y + 4);
  ctx.stroke();
  ctx.fillStyle = 'rgba(159,217,230,0.7)';
  ctx.textAlign = 'left';
  ctx.fillText(fmtDist(nice), 18, y - 8);
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

function drawPanel(ctx, game, x, y, w, h) {
  const map = game.map;
  const obj = map.sel;
  ctx.fillStyle = 'rgba(2,10,18,0.72)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  const pad = 12;
  let ty = y + 22;
  ctx.textAlign = 'left';

  if (!obj) {
    ctx.fillStyle = 'rgba(159,217,230,0.7)';
    const help = L('Объект не выбран. Ткни в планету, станцию или луну — ') +
      L('здесь будет всё, что о ней известно.');
    for (const line of wrap(ctx, help, w - pad * 2)) { ctx.fillText(line, x + pad, ty); ty += 14; }
    return;
  }

  const card = objectCard(game, obj);

  ctx.fillStyle = AMBER;
  ctx.font = 'bold 13px Consolas, monospace';
  ctx.fillText(card.title, x + pad, ty);
  ty += 16;
  ctx.font = '11px Consolas, monospace';
  ctx.fillStyle = CY;
  ctx.fillText(card.kind.toUpperCase(), x + pad, ty);
  ty += 16;

  if (card.desc) {
    ctx.fillStyle = 'rgba(159,217,230,0.72)';
    for (const line of wrap(ctx, card.desc, w - pad * 2)) {
      ctx.fillText(line, x + pad, ty);
      ty += 13;
    }
    ty += 6;
  }

  const keyW = 104;
  for (const [k, v] of card.rows) {
    if (ty > y + h - 34) break;
    ctx.fillStyle = 'rgba(79,179,224,0.75)';
    ctx.fillText(k, x + pad, ty);
    ctx.fillStyle = PALE;
    const lines = wrap(ctx, v, w - pad * 2 - keyW);
    for (const line of lines) {
      ctx.fillText(line, x + pad + keyW, ty);
      ty += 13;
    }
    if (!lines.length) ty += 13;
  }

  // Что нажать — внизу карточки, а не в общем списке подсказок: это
  // действие относится к выбранному объекту.
  const cur = currentTarget(game.nav);
  const isCur = obj === cur || (obj.isMarker && cur === obj.body);
  ctx.fillStyle = isCur ? GREEN : AMBER;
  ctx.fillText(isCur ? L('● ТЕКУЩАЯ ЦЕЛЬ') : L('TAB — НАЗНАЧИТЬ ЦЕЛЬЮ'), x + pad, y + h - 14);
}
