// Пешком по станции: перрон, площадки и помещения терминала.
//
// Сошёл с трапа на пол зала — и дальше ходишь, как по грунту за бортом
// (js/game/outside.js, js/game/walker.js): тот же шаг, тот же прыжок, та
// же проверка коробками. Отличий три:
//
//   * ОПОРА — не тело, а сама станция: её оси вращаются вокруг оси порта,
//     пол плоский (у грунта — по радиусу), площадки — плиты в 5 см;
//   * ТЯЖЕСТЬ — 1 g зала, а не тела, у которого висит станция;
//   * ТВЁРДОЕ — не только корабли рядом, но и стены терминала с дверями,
//     перегородки помещений и мебель в них.
//
// ОСИ ШАГА — оси станции и её МЕТРЫ, без сдвига: ноги пилота на станции —
// прямо точка планировки (js/game/stationplan.js). По ней же ищется
// помещение под ногами, путь к цели (js/game/route.js) и место пилота,
// которое пишет сервер (в километрах осей станции, как и на грунте).
//
// ПЛАН — того же вида, что планировка корабля (js/models/interior.js):
// помещения с коробками, двери с точкой на полу, проёмы. Поэтому путь и
// план палубы (M) на станции — те же, что на корабле: два «яруса» —
// ТЕРМИНАЛ (помещения) и ПЕРРОН (площадки вокруг терминала).
//
// Модуль чистый — без мира и рендера: проверяется в Node (tools/test.mjs).

import { TERM, PAD, walkFloorAt, padAt, STATION_G } from './stationplan.js';
import { solidGrid } from './walker.js';

export { STATION_G };

/** Воздух в зале, бар: щель порта держит силовое поле, как в любом порту. */
export const HALL_AIR = 1.0;

/**
 * Двери. В помещение из конкорса — обычная, на перрон — широкая (с
 * багажом и тележкой обслуживания), с торцов конкорса — главный вход.
 * Проёмы без створок: двери терминала стоят открытыми, как в аэропорту.
 */
export const DOOR = {
  room: { half: 1.0, height: 2.5 },
  gate: { half: 1.6, height: 2.8 },
  main: { half: 3.0, height: 4.0 },
};

const W = TERM.wall;

// --- геометрия дверей -----------------------------------------------------------------

const sideOf = (r) => (r.lo[0] + r.hi[0] > 0 ? 1 : -1);

/** Дверь планировки -> точка на полу, ось стены, размер (м, оси станции). */
function doorOf(L, d, byId) {
  const F = L.floor, T = L.terminal;
  if (d.main) {
    const front = d.b === 'apronF';
    return { pos: [d.c, F, front ? T.hi[2] - W / 2 : T.lo[2] + W / 2], ax: 2, ...DOOR.main };
  }
  const s = sideOf(byId[d.a]);
  if (d.gate) return { pos: [s * (TERM.hw - W / 2), F, d.c], ax: 0, ...DOOR.gate };
  return { pos: [s * (TERM.cw + W / 2), F, d.c], ax: 0, ...DOOR.room };
}

// --- стены с проёмами ----------------------------------------------------------------

/**
 * Стена вдоль оси run (2 — вдоль z, 0 — вдоль x) от a0 до a1, толщиной
 * [f0, f1] по другой оси, высотой [y0, y1] — коробками, с проёмами holes
 * ({ c, half, height }): над проёмом — перемычка.
 */
function wall(out, run, f0, f1, a0, a1, y0, y1, holes, tag) {
  const other = run === 2 ? 0 : 2;
  const push = (s0, s1, yy0, yy1) => {
    if (s1 - s0 < 1e-6 || yy1 - yy0 < 1e-6) return;
    const lo = [0, yy0, 0], hi = [0, yy1, 0];
    lo[run] = s0; hi[run] = s1; lo[other] = f0; hi[other] = f1;
    out.push({ lo, hi, wall: tag });
  };
  const hs = (holes || []).filter((h) => h.c + h.half > a0 && h.c - h.half < a1).sort((p, q) => p.c - q.c);
  let a = a0;
  for (const h of hs) {
    push(a, h.c - h.half, y0, y1);
    push(Math.max(a0, h.c - h.half), Math.min(a1, h.c + h.half), y0 + h.height, y1);
    a = h.c + h.half;
  }
  push(a, a1, y0, y1);
}

// --- мебель ------------------------------------------------------------------------------

/**
 * Мебель помещения — коробками (м, оси станции): по ним и рисуют
 * (js/models/stationhall.js), и упираются. kind — что это (для вида),
 * walk — не мешает шагу (ковёр, табло над головой).
 *
 * Проход от двери конкорса к двери перрона (у залов ожидания) и от двери
 * к стойке — свободен: мебель стоит по сторонам от оси двери.
 */
export function roomProps(L, r) {
  const F = L.floor, out = [];
  if (r.open || r.kind === 'concourse' || r.kind === 'pad' || r.kind === 'block') return out;
  const s = sideOf(r);
  const xi = s > 0 ? r.lo[0] : r.hi[0];              // у конкорса
  const xo = s > 0 ? r.hi[0] : r.lo[0];              // у наружной стены
  const zc = (r.lo[2] + r.hi[2]) / 2, zl = r.hi[2] - r.lo[2];
  const box = (kind, x0, x1, y0, y1, z0, z1) => out.push({ kind,
    lo: [Math.min(x0, x1), F + y0, Math.min(z0, z1)], hi: [Math.max(x0, x1), F + y1, Math.max(z0, z1)] });
  const X = (d) => xi + s * d;                        // d метров от стены конкорса внутрь
  if (r.kind === 'gate') {
    // Ряды кресел поперёк зала — по обе стороны прохода к перрону.
    for (const dz of [-6.2, -3.4, 3.4, 6.2]) {
      if (Math.abs(dz) + 0.4 > zl / 2 - 0.8) continue;
      box('seats', X(3), X(16), 0, 0.46, zc + dz - 0.32, zc + dz + 0.32);
    }
    // Стойка посадки у двери перрона.
    box('desk', xo - s * 3.2, xo - s * 2.4, 0, 1.05, zc + 3.6, zc + 6.2);
  } else if (r.kind === 'bar') {
    // Стойка вдоль наружной стены, табуреты перед ней, столики у прохода.
    box('counter', xo - s * 3.4, xo - s * 2.6, 0, 1.1, r.lo[2] + 3, r.hi[2] - 3);
    for (let z = r.lo[2] + 4; z < r.hi[2] - 3.5; z += 1.6) box('stool', xo - s * 4.4, xo - s * 4.0, 0, 0.75, z - 0.2, z + 0.2);
    for (const dz of [-7, -3.5, 3.5, 7]) {
      if (Math.abs(dz) + 1 > zl / 2 - 1) continue;
      box('table', X(5.2), X(6.2), 0, 0.75, zc + dz - 0.5, zc + dz + 0.5);
      box('table', X(10.2), X(11.2), 0, 0.75, zc + dz - 0.5, zc + dz + 0.5);
    }
  } else if (r.kind === 'office' || r.kind === 'hangar') {
    // Стойка поперёк помещения: посетитель — у конкорса, служба — за ней.
    box('counter', X(9.5), X(10.3), 0, 1.05, r.lo[2] + 2.5, zc - 1.8);
    box('counter', X(9.5), X(10.3), 0, 1.05, zc + 1.8, r.hi[2] - 2.5);
    if (r.kind === 'hangar') {
      // Пульт ангарной службы — у входа: корабль из хранилища — на площадку.
      out.push({ kind: 'kiosk', lo: [Math.min(X(2), X(2.6)), F, zc + 2.6], hi: [Math.max(X(2), X(2.6)), F + 1.35, zc + 3.4] });
    }
    for (const dz of [-4.5, 4.5]) box('desk', X(13), X(15), 0, 0.75, zc + dz - 0.8, zc + dz + 0.8);
  } else if (r.kind === 'med') {
    box('counter', X(4), X(4.8), 0, 1.05, zc + 2, r.hi[2] - 2);
    for (const dz of [-zl / 2 + 2.5, -zl / 2 + 5.5]) box('bed', xo - s * 3.2, xo - s * 1.2, 0, 0.62, zc + dz - 0.5, zc + dz + 0.5);
  } else if (r.kind === 'shop') {
    // Стеллажи вдоль торцовых стен, витрина посередине, касса у входа.
    box('shelf', X(2), xo - s * 1.5, 0, 2.1, r.lo[2] + 0.2, r.lo[2] + 0.8);
    box('shelf', X(2), xo - s * 1.5, 0, 2.1, r.hi[2] - 0.8, r.hi[2] - 0.2);
    box('shelf', xo - s * 0.8, xo - s * 0.2, 0, 2.1, r.lo[2] + 2, r.hi[2] - 2);
    box('table', X(8), X(12), 0, 0.9, zc - 2.6, zc - 1.4);
    box('table', X(8), X(12), 0, 0.9, zc + 1.4, zc + 2.6);
    box('counter', X(2.5), X(3.3), 0, 1.0, zc + 2.2, zc + 4.6);
  }
  return out;
}

// --- план ------------------------------------------------------------------------------

/**
 * План станции для шага, пути и плана палубы: помещения терминала, перрон,
 * площадки (помещениями: «ПЛОЩАДКА 3» — и под ногами, и целью пути), двери
 * с точкой на полу и всё твёрдое. Один на станцию — собирается при первом
 * шаге по ней.
 */
export function stationPlan(L) {
  if (L._plan) return L._plan;
  const F = L.floor, T = L.terminal;
  const rooms = [];
  // Имя для приборов — с номером отдельно (roomName в js/ui/deckmap.js):
  // перевод один на все залы ожидания.
  for (const r of L.rooms) {
    rooms.push({ ...r, deck: r.kind === 'apron' ? 'ПЕРРОН' : 'ТЕРМИНАЛ',
      ...(r.kind === 'gate' ? { name: 'ВЫХОД НА ПЛОЩАДКУ', num: r.pad } : {}) });
  }
  for (const p of L.pads) {
    // Цель пути к площадке — у её края напротив двери зала ожидания: в
    // середине стоит корабль.
    const xe = p.side * (TERM.hw + PAD.apron + 5);
    rooms.push({ id: 'pad' + p.n, kind: 'pad', name: 'ПЛОЩАДКА', num: p.n, pad: p.n, open: true, deck: 'ПЕРРОН',
      lo: [p.lo[0], F, p.lo[2]], hi: [p.hi[0], F + 30, p.hi[2]], goal: [xe, F, p.c[2]] });
  }
  // Сам терминал на плане перрона — чтобы было видно, где он; путь «в
  // терминал» ведёт в конкорс.
  rooms.push({ id: 'terminal', kind: 'block', name: 'ТЕРМИНАЛ', deck: 'ПЕРРОН', lo: T.lo.slice(), hi: T.hi.slice(), alias: 'concourse' });
  const roomById = Object.fromEntries(rooms.map((r) => [r.id, r]));

  const doors = L.doors.map((d) => ({ id: d.id, rooms: [d.a, d.b], gate: d.gate || null, main: !!d.main,
    ...doorOf(L, d, roomById) }));
  // С перрона на площадку — не дверь, а край плиты: точка пути у края.
  for (const p of L.pads) {
    doors.push({ id: 'edge' + p.n, rooms: [p.side > 0 ? 'apronR' : 'apronL', 'pad' + p.n], edge: true,
      pos: [p.side * (TERM.hw + PAD.apron), F, p.c[2]], ax: 0, half: 0, height: 0 });
  }

  const solids = [];
  const holes = (pred) => doors.filter(pred).map((d) => ({ c: d.pos[d.ax === 0 ? 2 : 0], half: d.half, height: d.height }));
  // Наружные стены терминала — с дверями на перрон и главными входами.
  for (const s of [1, -1]) {
    const x0 = s > 0 ? TERM.hw - W : -TERM.hw, x1 = x0 + W;
    wall(solids, 2, x0, x1, T.lo[2], T.hi[2], F, T.hi[1], holes((d) => d.gate && Math.sign(d.pos[0]) === s), 'term');
  }
  wall(solids, 0, T.hi[2] - W, T.hi[2], -TERM.hw, TERM.hw, F, T.hi[1], holes((d) => d.main && Math.abs(d.pos[2] - (T.hi[2] - W / 2)) < 1), 'term');
  wall(solids, 0, T.lo[2], T.lo[2] + W, -TERM.hw, TERM.hw, F, T.hi[1], holes((d) => d.main && Math.abs(d.pos[2] - (T.lo[2] + W / 2)) < 1), 'term');
  // Стены конкорса — с дверями помещений.
  for (const s of [1, -1]) {
    const x0 = s > 0 ? TERM.cw : -TERM.cw - W, x1 = x0 + W;
    wall(solids, 2, x0, x1, T.lo[2] + W, T.hi[2] - W, F, F + TERM.ceilC,
      holes((d) => !d.gate && !d.main && !d.edge && Math.abs(Math.abs(d.pos[0]) - (TERM.cw + W / 2)) < 0.01 && Math.sign(d.pos[0]) === s), 'concourse');
  }
  // Торцы помещений.
  for (const r of rooms) {
    if (r.open || r.kind === 'concourse' || r.kind === 'block') continue;
    const top = r.hi[1];
    wall(solids, 0, r.lo[2] - W, r.lo[2], r.lo[0], r.hi[0], F, top, null, 'room');
    wall(solids, 0, r.hi[2], r.hi[2] + W, r.lo[0], r.hi[0], F, top, null, 'room');
  }
  // Стены зала: перрон кончается у них.
  const h = L.hall, hy = F + 30;
  solids.push({ lo: [h.hi[0], F, h.lo[2] - 2], hi: [h.hi[0] + 2, hy, h.hi[2] + 2], wall: 'hall' });
  solids.push({ lo: [h.lo[0] - 2, F, h.lo[2] - 2], hi: [h.lo[0], hy, h.hi[2] + 2], wall: 'hall' });
  solids.push({ lo: [h.lo[0] - 2, F, h.hi[2]], hi: [h.hi[0] + 2, hy, h.hi[2] + 2], wall: 'hall' });
  solids.push({ lo: [h.lo[0] - 2, F, h.lo[2] - 2], hi: [h.hi[0] + 2, hy, h.lo[2]], wall: 'hall' });
  // Мебель.
  const props = [];
  for (const r of rooms) for (const b of roomProps(L, r)) { b.room = r.id; props.push(b); solids.push(b); }

  const plan = {
    code: 'station:' + L.kind + ':' + L.name,
    station: true,
    layout: L,
    rooms, roomById, doors, openings: L.openings.slice(), props, solids,
    grid: solidGrid(solids),
    roomAt: (p) => roomAtPlan(plan, p),
  };
  L._plan = plan;
  return plan;
}

/**
 * Помещение под ногами (м, оси станции): площадка, помещение терминала,
 * перрон. В толще стены или в проёме двери — null (идущий остаётся там,
 * где был).
 */
function roomAtPlan(plan, p) {
  const L = plan.layout, T = L.terminal;
  const inT = p[0] > T.lo[0] && p[0] < T.hi[0] && p[2] > T.lo[2] && p[2] < T.hi[2];
  if (inT) {
    for (const r of plan.rooms) {
      if (r.open || r.kind === 'block') continue;
      if (p[0] >= r.lo[0] && p[0] <= r.hi[0] && p[2] >= r.lo[2] && p[2] <= r.hi[2]
        && p[1] > r.lo[1] - 0.5 && p[1] < r.hi[1]) return r;
    }
    return null;
  }
  const pad = padAt(L, p[0], p[2]);
  if (pad) return plan.roomById['pad' + pad.n];
  for (const r of plan.rooms) {
    if (r.kind !== 'apron') continue;
    if (p[0] >= r.lo[0] && p[0] <= r.hi[0] && p[2] >= r.lo[2] && p[2] <= r.hi[2]) return r;
  }
  return null;
}

// --- оси шага ---------------------------------------------------------------------------

/**
 * Оси шага на станции st: её оси и её метры, начало — центр станции. Тот
 * же вид, что у осей грунта (js/game/outside.js, makeGroundFrame): body —
 * опора (станция), o — начало в её осях (км), r, u, f — оси шага в её осях;
 * stn — оси шага и есть оси станции (на трапе у корабля они его).
 */
export function stationFrame(st) {
  return { body: st, o: [0, 0, 0], r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1], stn: true };
}

/** Пол под точкой (x, z) осей станции для шага, м. */
export const stationFloor = (st) => (x, z) => walkFloorAt(st.layout, x, z);

/**
 * Мир шага на станции: стены и мебель — сеткой плана (оси шага — оси
 * станции, переносить их не нужно), корабли рядом — extra (их твёрдое в
 * осях шага собирает игра), пол, тяжесть зала и помещение под ногами.
 */
export function stationWorld(plan, st, extra) {
  return { grid: plan.grid, extra, ground: stationFloor(st), water: null, g: STATION_G, roomAt: plan.roomAt };
}

/** Имя помещения станции для приборов — по-русски; переводит игра (L). */
export const stationRoomName = (r) => (r ? r.name : '');
