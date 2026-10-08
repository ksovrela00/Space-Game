// Пешком по станции: перрон, площадки, лифтовые холлы, лифт и галерея.
//
// Сошёл с трапа на пол зала — и дальше ходишь, как по грунту за бортом
// (js/game/outside.js, js/game/walker.js): тот же шаг, тот же прыжок, та
// же проверка коробками. Отличий три:
//
//   * ОПОРА — не тело, а сама станция: её оси вращаются вокруг оси порта,
//     пол плоский (у грунта — по радиусу), площадки — плиты в 5 см, пол
//     галереи — плита на кровле терминала;
//   * ТЯЖЕСТЬ — 1 g зала, а не тела, у которого висит станция;
//   * ТВЁРДОЕ — не только корабли рядом, но и стены терминала, холлов,
//     кабин и галереи, перегородки помещений и мебель в них.
//
// СЕКЦИИ. Станция пешком — маленькие секции: у каждой площадки — свой
// лифтовой холл с кабиной, службы и лавки — в галерее на кровле
// терминала, и между ними — лифт (js/game/lift.js, тот же, что на
// «Прометее»). Раньше терминал был одним зданием вдоль зала с конкорсом
// во всю длину, и от площадки до бара шли две минуты. Секция помещения —
// room.section: холл с кабиной — 'gateN', галерея с помещениями и своей
// кабиной — 'concourse'; у перрона и площадок секции нет — это зал. Рисуют
// изнутри только видимые секции (js/main.js, stationSections).
//
// ОСИ ШАГА — оси станции и её МЕТРЫ, без сдвига: ноги пилота на станции —
// прямо точка планировки (js/game/stationplan.js). По ней же ищется
// помещение под ногами, путь к цели (js/game/route.js) и место пилота,
// которое пишет сервер (в километрах осей станции, как и на грунте).
//
// ПЛАН — того же вида, что планировка корабля (js/models/interior.js):
// помещения с коробками, двери с точкой на полу, проёмы и лифт с
// остановками. Поэтому путь, план палубы (M) и пульт лифта на станции — те
// же, что на корабле: два «яруса» — ПЕРРОН (площадки, холлы) и ГАЛЕРЕЯ.
//
// Модуль чистый — без мира и рендера: проверяется в Node (tools/test.mjs).

import { TERM, PAD, CAB, GAL, LOBBY, walkFloorAt, padAt, STATION_G } from './stationplan.js';
import { solidGrid, WALK } from './walker.js';

export { STATION_G };

/** Воздух в зале, бар: щель порта держит силовое поле, как в любом порту. */
export const HALL_AIR = 1.0;

/**
 * Двери. В помещение из галереи — обычная, на перрон — широкая (с
 * багажом и тележкой обслуживания), у кабины лифта — створки. Проёмы без
 * створок стоят открытыми, как в аэропорту; створки — только у лифта:
 * пока кабина едет, они закрыты, и подмены остановки не видно.
 */
export const DOOR = {
  room: { half: 1.0, height: 2.5 },
  gate: { half: 1.6, height: 2.8 },
  lift: { half: 0.8, height: 2.2 },
};

/**
 * Лифт станции. Едет не по вертикали, как на корабле, а и через зал — от
 * холла у дальней площадки до галереи посередине, — поэтому время в пути
 * не по высоте шахты, а по расстоянию: четыре секунды и ещё по секунде на
 * каждые пятьдесят метров, но не дольше десяти. Дольше идти не должно —
 * ради этого лифт и сделан.
 */
export const RIDE = { base: 4, per: 50, max: 10 };
export const rideSeconds = (off) => Math.min(RIDE.max, RIDE.base + Math.hypot(off[0], off[1], off[2]) / RIDE.per);

const W = TERM.wall;

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
    lo[run] = s0; hi[run] = s1; lo[other] = Math.min(f0, f1); hi[other] = Math.max(f0, f1);
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
 * Вход в помещение: дверь, ось её стены (ax), куда от неё внутрь (dir: +1
 * или −1 по ax), плоскость стены (e), ось вдоль стены (u) и её середина
 * (uc), глубина помещения (depth) и полуширина вдоль стены (half). От
 * входа расставляется мебель — так она стоит одинаково у помещения с
 * дверью с любой стороны.
 */
function entryOf(r, d) {
  const ax = d.ax, u = ax === 0 ? 2 : 0;
  const dir = Math.abs(d.pos[ax] - r.lo[ax]) < Math.abs(d.pos[ax] - r.hi[ax]) ? 1 : -1;
  return { ax, u, dir, e: dir > 0 ? r.lo[ax] : r.hi[ax], uc: d.pos[u],
    depth: r.hi[ax] - r.lo[ax], half: (r.hi[u] - r.lo[u]) / 2, umid: (r.lo[u] + r.hi[u]) / 2 };
}

/**
 * Мебель помещения — коробками (м, оси станции): по ним и рисуют
 * (js/models/stationhall.js), и упираются. kind — что это (для вида),
 * face — куда смотрит лицо (экран пульта).
 *
 * Координаты — от входа: d — метры вглубь от стены с дверью, u — вдоль
 * неё от середины помещения. Проход от двери вглубь (у холла — от двери
 * перрона к двери кабины) свободен: мебель стоит по сторонам от него.
 */
export function roomProps(L, r, doorsHere) {
  const out = [];
  if (r.open || r.kind === 'pad' || r.kind === 'block' || r.kind === 'lift') return out;
  const F = r.lo[1];
  if (r.kind === 'concourse') {
    // Скамьи у окон — лицом к площадкам; по обе стороны от середины, мимо
    // дверей помещений у торцов.
    const zm = (r.lo[2] + r.hi[2]) / 2;
    for (const s of [-1, 1]) {
      const x = s > 0 ? r.hi[0] - 2.2 : r.lo[0] + 1.6;
      for (const z0 of [zm - 9, zm + 4]) out.push({ kind: 'seats', lo: [x, F, z0], hi: [x + 0.6, F + 0.46, z0 + 5] });
    }
    return out;
  }
  const entry = doorsHere.find((d) => d.gate) || doorsHere.find((d) => !d.lift) || doorsHere[0];
  if (!entry) return out;
  const E = entryOf(r, entry);
  const box = (kind, d0, d1, u0, u1, y0, y1, extra = null) => {
    const lo = [0, F + y0, 0], hi = [0, F + y1, 0];
    const a = E.e + E.dir * d0, b = E.e + E.dir * d1;
    lo[E.ax] = Math.min(a, b); hi[E.ax] = Math.max(a, b);
    lo[E.u] = E.umid + Math.min(u0, u1); hi[E.u] = E.umid + Math.max(u0, u1);
    out.push({ kind, lo, hi, ...(extra || {}) });
  };
  const D = E.depth, H = E.half;
  if (r.kind === 'gate') {
    // Ряды кресел — в передней половине холла; задняя — проход от двери
    // перрона к кабине лифта в заднем торце.
    box('seats', 2.4, D - 1.8, 2.0, 2.64, 0, 0.46);
    box('seats', 2.4, D - 1.8, 4.2, 4.84, 0, 0.46);
    // Стойка посадки — у двери перрона, сбоку.
    box('desk', 0.6, 1.4, 2.4, 4.6, 0, 1.05);
  } else if (r.kind === 'bar') {
    // Стойка вдоль дальней стены, табуреты перед ней, столики у входа.
    box('counter', D - 2.0, D - 1.2, -H + 1.5, H - 1.5, 0, 1.1);
    for (let u = -H + 2; u < H - 1.9; u += 1.6) box('stool', D - 3.0, D - 2.6, u - 0.2, u + 0.2, 0, 0.75);
    for (const u of [-H / 2, H / 2]) {
      if (Math.abs(u) < 2.2) continue;
      box('table', 2.6, 3.6, u - 0.5, u + 0.5, 0, 0.75);
    }
  } else if (r.kind === 'office' || r.kind === 'hangar') {
    // Стойка вдоль помещения: посетитель — у входа, служба — за ней.
    box('counter', 4.5, 5.3, -H + 1, -1.4, 0, 1.05);
    box('counter', 4.5, 5.3, 1.4, H - 1, 0, 1.05);
    for (const s of [-1, 1]) box('desk', 6.8, 7.6, s * H / 2 - 0.8, s * H / 2 + 0.8, 0, 0.75);
    if (r.kind === 'hangar') {
      // Пульт ангарной службы — у входа, сбоку, экраном внутрь: корабль из
      // хранилища — на площадку (js/main.js, openKiosk).
      const face = [0, 0, 0];
      face[E.ax] = E.dir;
      box('kiosk', 0.6, 1.2, 1.9, 2.7, 0, 1.35, { face });
    }
  } else if (r.kind === 'med') {
    box('counter', 1.2, 2.0, 1.6, H - 1, 0, 1.05);
    for (const u of [-H + 1, -H + 3]) box('bed', D - 2.4, D - 0.4, u, u + 1, 0, 0.62);
  } else if (r.kind === 'shop') {
    // Стеллажи вдоль боковых стен и дальней, витрины посередине, касса у входа.
    box('shelf', 1.5, D - 1.2, -H + 0.2, -H + 0.8, 0, 2.1);
    box('shelf', 1.5, D - 1.2, H - 0.8, H - 0.2, 0, 2.1);
    box('shelf', D - 0.8, D - 0.2, -H + 1.6, H - 1.6, 0, 2.1);
    for (const s of [-1, 1]) box('table', 3.6, 4.8, s * 1.4, s * 2.6, 0, 0.9);
    box('counter', 1.0, 1.8, 1.8, Math.min(3.6, H - 1), 0, 1.0);
  }
  return out;
}

// --- двери кабин ------------------------------------------------------------------------

/**
 * Створки кабин лифта: открываются, когда к ним подходят (как двери
 * корабля, js/game/walker.js), и закрываются, когда отходят или когда
 * кабина едет (door.lock, js/game/lift.js). pos — ноги пилота (м, оси
 * станции) или null — его нет на станции.
 * @returns открывшиеся в этом шаге двери (для звука)
 */
export function stepLiftDoors(plan, pos, dt) {
  const opened = [];
  for (const d of plan.liftDoors) {
    const near = !!pos && !d.lock && Math.hypot(pos[0] - d.pos[0], pos[2] - d.pos[2]) < WALK.doorNear
      && Math.abs(pos[1] - d.pos[1]) < 1.5;
    const k = dt / WALK.doorTime;
    if (near && d.open === 0) opened.push(d);
    d.open = near ? Math.min(1, d.open + k) : Math.max(0, d.open - k);
  }
  return opened;
}

/**
 * Закрытые створки — твёрдое в проёме (пока не открылись настолько, чтобы
 * пройти, WALK.doorPass): добавляется к миру шага каждым кадром.
 */
export function liftDoorSolids(plan, out) {
  for (const d of plan.liftDoors) {
    if (d.open >= WALK.doorPass) continue;
    const lo = [0, d.pos[1], 0], hi = [0, d.pos[1] + d.height, 0];
    const u = d.ax === 0 ? 2 : 0;
    lo[d.ax] = d.pos[d.ax] - W / 2; hi[d.ax] = d.pos[d.ax] + W / 2;
    lo[u] = d.pos[u] - d.half; hi[u] = d.pos[u] + d.half;
    out.push({ lo, hi, door: d.id });
  }
  return out;
}

// --- план ------------------------------------------------------------------------------

/**
 * План станции для шага, пути и плана палубы: помещения (холлы, кабины,
 * галерея, перрон, площадки — «ПЛОЩАДКА 3» и под ногами, и целью пути),
 * двери с точкой на полу, лифт с остановками и всё твёрдое. Один на
 * станцию — собирается при первом шаге по ней.
 */
export function stationPlan(L) {
  if (L._plan) return L._plan;
  const F = L.floor, T = L.terminal, G = L.gallery;
  const rooms = [];
  // Имя для приборов — с номером отдельно (roomName в js/ui/deckmap.js):
  // перевод один на все холлы.
  for (const r of L.rooms) {
    const up = r.lo[1] > F + 1;
    rooms.push({ ...r, deck: up ? 'ГАЛЕРЕЯ' : 'ПЕРРОН',
      section: r.section || (r.kind === 'gate' ? r.id : up ? 'concourse' : null),
      ...(r.kind === 'gate' ? { name: 'ВЫХОД НА ПЛОЩАДКУ', num: r.pad } : {}) });
  }
  for (const p of L.pads) {
    // Цель пути к площадке — у её края напротив двери холла: в середине
    // стоит корабль.
    const xe = p.side * (TERM.hw + PAD.apron + 5);
    rooms.push({ id: 'pad' + p.n, kind: 'pad', name: 'ПЛОЩАДКА', num: p.n, pad: p.n, open: true, deck: 'ПЕРРОН',
      section: null, lo: [p.lo[0], F, p.lo[2]], hi: [p.hi[0], F + 30, p.hi[2]], goal: [xe, F, p.c[2]] });
  }
  // Сам терминал на плане перрона — чтобы было видно, где он; путь «в
  // терминал» ведёт в галерею.
  rooms.push({ id: 'terminal', kind: 'block', name: 'ТЕРМИНАЛ', deck: 'ПЕРРОН', section: null,
    lo: T.lo.slice(), hi: T.hi.slice(), alias: 'concourse' });
  const roomById = Object.fromEntries(rooms.map((r) => [r.id, r]));

  const doors = L.doors.map((d) => ({ id: d.id, rooms: [d.a, d.b], gate: d.gate || null, lift: !!d.lift,
    pos: d.pos.slice(), ax: d.ax, ...(d.gate ? DOOR.gate : d.lift ? DOOR.lift : DOOR.room),
    ...(d.lift ? { open: 0, lock: false } : {}) }));
  // С перрона на площадку — не дверь, а край плиты: точка пути у края.
  for (const p of L.pads) {
    doors.push({ id: 'edge' + p.n, rooms: [p.side > 0 ? 'apronR' : 'apronL', 'pad' + p.n], edge: true,
      pos: [p.side * (TERM.hw + PAD.apron), F, p.c[2]], ax: 0, half: 0, height: 0 });
  }
  const doorById = Object.fromEntries(doors.map((d) => [d.id, d]));
  const doorsOf = (id) => doors.filter((d) => !d.edge && d.rooms.includes(id));
  const hole = (d) => ({ c: d.pos[d.ax === 0 ? 2 : 0], half: d.half, height: d.height });

  const solids = [];
  // Наружные стены терминала — с дверями на перрон; торцы глухие.
  for (const s of [1, -1]) {
    const x0 = s > 0 ? TERM.hw - W : -TERM.hw;
    wall(solids, 2, x0, x0 + W, T.lo[2], T.hi[2], F, T.hi[1], doors.filter((d) => d.gate && Math.sign(d.pos[0]) === s).map(hole), 'term');
  }
  wall(solids, 0, T.hi[2] - W, T.hi[2], -TERM.hw, TERM.hw, F, T.hi[1], null, 'term');
  wall(solids, 0, T.lo[2], T.lo[2] + W, -TERM.hw, TERM.hw, F, T.hi[1], null, 'term');
  // Холлы: внутренняя стена, торцы (в заднем — дверь кабины); кабина — за ним.
  for (const r of rooms) {
    if (r.kind !== 'gate') continue;
    const s = r.lo[0] + r.hi[0] > 0 ? 1 : -1;
    const xi = s > 0 ? r.lo[0] : r.hi[0], xo = s > 0 ? r.hi[0] : r.lo[0];
    const liftDoor = doorsOf(r.id).find((d) => d.lift);
    wall(solids, 2, xi - s * W, xi, r.lo[2] - W, r.hi[2] + W, F, r.hi[1], null, 'room');
    wall(solids, 0, r.lo[2] - W, r.lo[2], Math.min(xi, xo), Math.max(xi, xo), F, r.hi[1], liftDoor ? [hole(liftDoor)] : null, 'room');
    wall(solids, 0, r.hi[2], r.hi[2] + W, Math.min(xi, xo), Math.max(xi, xo), F, r.hi[1], null, 'room');
  }
  // Кабины лифта: три глухие стены (четвёртая — с дверью: у холла это его
  // внутренняя стена, в галерее — своя).
  for (const r of rooms) {
    if (r.kind !== 'lift') continue;
    const d = doorsOf(r.id).find((q) => q.lift);
    const ax = d.ax, u = ax === 0 ? 2 : 0;
    const doorAtHi = Math.abs(d.pos[ax] - r.hi[ax]) < Math.abs(d.pos[ax] - r.lo[ax]);
    const top = r.hi[1];
    // Стена напротив двери.
    const back = doorAtHi ? [r.lo[ax] - W, r.lo[ax]] : [r.hi[ax], r.hi[ax] + W];
    wall(solids, u, back[0], back[1], r.lo[u] - W, r.hi[u] + W, r.lo[1], top, null, 'cab');
    // Боковые.
    wall(solids, ax, r.lo[u] - W, r.lo[u], r.lo[ax] - W, r.hi[ax] + W, r.lo[1], top, null, 'cab');
    wall(solids, ax, r.hi[u], r.hi[u] + W, r.lo[ax] - W, r.hi[ax] + W, r.lo[1], top, null, 'cab');
  }
  // Галерея: плита пола на кровле, наружные стены, перегородки у торцов
  // с дверями помещений и стены между помещениями.
  if (G) {
    const GF = G.floor;
    solids.push({ lo: [G.lo[0], T.hi[1] - 0.5, G.lo[2]], hi: [G.hi[0], GF, G.hi[2]], wall: 'slab' });
    const top = G.hi[1];
    wall(solids, 2, G.hi[0] - W, G.hi[0], G.lo[2], G.hi[2], GF, top, null, 'gallery');
    wall(solids, 2, G.lo[0], G.lo[0] + W, G.lo[2], G.hi[2], GF, top, null, 'gallery');
    wall(solids, 0, G.hi[2] - W, G.hi[2], G.lo[0], G.hi[0], GF, top, null, 'gallery');
    wall(solids, 0, G.lo[2], G.lo[2] + W, G.lo[0], G.hi[0], GF, top, null, 'gallery');
    const plaza = roomById.concourse;
    for (const s of [1, -1]) {
      const z0 = s > 0 ? plaza.hi[2] : plaza.lo[2] - W;
      // В перегородке — двери помещений и (в задней) дверь кабины лифта.
      const here = doors.filter((d) => !d.gate && !d.edge && d.rooms.includes('concourse')
        && Math.abs(d.pos[2] - (z0 + W / 2)) < 0.01);
      wall(solids, 0, z0, z0 + W, G.lo[0] + W, G.hi[0] - W, GF, top, here.map(hole), 'gallery');
    }
    // Между помещениями ряда — по правой грани каждого, кроме крайнего;
    // место кабины в заднем ряду — стенами во всю его глубину с обеих сторон.
    for (const r of rooms) {
      if (r.deck !== 'ГАЛЕРЕЯ' || r.kind === 'concourse' || r.kind === 'lift') continue;
      if (r.hi[0] > G.hi[0] - W - 0.01) continue;
      wall(solids, 2, r.hi[0], r.hi[0] + W, r.lo[2], r.hi[2], GF, top, null, 'room');
    }
    const cab = roomById.liftc;
    if (cab) {
      const z0 = G.lo[2] + W, z1 = plaza.lo[2] - W;
      wall(solids, 2, cab.lo[0] - W, cab.lo[0], z0, z1, GF, top, null, 'cab');
      wall(solids, 2, cab.hi[0], cab.hi[0] + W, z0, z1, GF, top, null, 'cab');
    }
  }
  // Стены зала: перрон кончается у них.
  const h = L.hall, hy = F + 30;
  solids.push({ lo: [h.hi[0], F, h.lo[2] - 2], hi: [h.hi[0] + 2, hy, h.hi[2] + 2], wall: 'hall' });
  solids.push({ lo: [h.lo[0] - 2, F, h.lo[2] - 2], hi: [h.lo[0], hy, h.hi[2] + 2], wall: 'hall' });
  solids.push({ lo: [h.lo[0] - 2, F, h.hi[2]], hi: [h.hi[0] + 2, hy, h.hi[2] + 2], wall: 'hall' });
  solids.push({ lo: [h.lo[0] - 2, F, h.lo[2] - 2], hi: [h.hi[0] + 2, hy, h.lo[2]], wall: 'hall' });
  // Мебель.
  const props = [];
  for (const r of rooms) for (const b of roomProps(L, r, doorsOf(r.id))) { b.room = r.id; props.push(b); solids.push(b); }

  // Лифт: остановка — кабина, её дверь и пульт у двери внутри. Первая —
  // галерея, дальше площадки по номерам: так они и стоят в списке пульта.
  const stopOf = (r) => {
    const d = doorsOf(r.id).find((q) => q.lift);
    const ax = d.ax, u = ax === 0 ? 2 : 0;
    const inward = Math.abs(d.pos[ax] - r.hi[ax]) < Math.abs(d.pos[ax] - r.lo[ax]) ? -1 : 1;
    const panel = [0, r.lo[1] + 1.2, 0];
    panel[ax] = (inward > 0 ? r.lo[ax] : r.hi[ax]) + inward * 0.05;
    panel[u] = d.pos[u] + d.half + 0.25;
    return r.section === 'concourse'
      ? { room: r.id, door: d.id, panel, deck: 'ГАЛЕРЕЯ', what: 'КОНКОРС' }
      : { room: r.id, door: d.id, panel, deck: 'ПЕРРОН', what: 'ПЛОЩАДКА', num: r.pad, pad: r.pad };
  };
  const cabs = rooms.filter((r) => r.kind === 'lift').sort((a, b) => (a.pad || 0) - (b.pad || 0));
  const lifts = cabs.length ? [{ id: 'station', station: true, stops: cabs.map(stopOf), time: rideSeconds }] : [];

  const plan = {
    code: 'station:' + L.kind + ':' + L.name,
    station: true,
    layout: L,
    rooms, roomById, doors, doorById, openings: L.openings.slice(), props, solids, lifts,
    liftDoors: doors.filter((d) => d.lift),
    grid: solidGrid(solids),
    roomAt: (p) => roomAtPlan(plan, p),
  };
  L._plan = plan;
  return plan;
}

/**
 * Помещение под ногами (м, оси станции): кабина, холл, галерея,
 * площадка, перрон. Внутри коробки терминала — самое тесное из
 * содержащих точку (кабина в галерее стоит посреди площади). В толще
 * стены или в проёме двери — null (идущий остаётся там, где был).
 */
function roomAtPlan(plan, p) {
  const L = plan.layout, T = L.terminal;
  const inT = p[0] > T.lo[0] && p[0] < T.hi[0] && p[2] > T.lo[2] && p[2] < T.hi[2];
  if (inT) {
    let best = null, vol = Infinity;
    for (const r of plan.rooms) {
      if (r.open || r.kind === 'block') continue;
      if (p[0] >= r.lo[0] && p[0] <= r.hi[0] && p[2] >= r.lo[2] && p[2] <= r.hi[2]
        && p[1] > r.lo[1] - 0.5 && p[1] < r.hi[1]) {
        const v = (r.hi[0] - r.lo[0]) * (r.hi[2] - r.lo[2]);
        if (v < vol) { vol = v; best = r; }
      }
    }
    return best;
  }
  const pad = padAt(L, p[0], p[2]);
  if (pad) return plan.roomById['pad' + pad.n];
  for (const r of plan.rooms) {
    if (r.kind !== 'apron') continue;
    if (p[0] >= r.lo[0] && p[0] <= r.hi[0] && p[2] >= r.lo[2] && p[2] <= r.hi[2]) return r;
  }
  return null;
}

/**
 * Где встать на станции, если записанное место ей больше не подходит
 * (станция перестроена, место — в стене или в пустоте): у двери кабины в
 * холле площадки pad, лицом от неё, — или у кабины посреди галереи.
 */
export function standByLift(plan, pad) {
  const r = (pad && plan.roomById['gate' + pad]) || plan.roomById.concourse;
  const d = plan.doors.find((q) => q.lift && q.rooms.includes(r.id));
  if (!d) return { pos: [(r.lo[0] + r.hi[0]) / 2, r.lo[1], (r.lo[2] + r.hi[2]) / 2], yaw: 0 };
  // Наружу из кабины: от её середины к двери (в галерее кабина стоит
  // посреди площади, и стены помещения тут не подсказка).
  const cab = plan.roomById[d.rooms[0]], ax = d.ax;
  const inward = d.pos[ax] > (cab.lo[ax] + cab.hi[ax]) / 2 ? 1 : -1;
  const pos = d.pos.slice();
  pos[ax] += inward * 2.5;
  const f = [0, 0, 0];
  f[ax] = inward;
  return { pos, yaw: Math.atan2(f[0], f[2]) };
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
 * станции, переносить их не нужно), корабли рядом и закрытые створки
 * кабин — extra (собирает игра), пол, тяжесть зала и помещение под ногами.
 */
export function stationWorld(plan, st, extra) {
  return { grid: plan.grid, extra, ground: stationFloor(st), water: null, g: STATION_G, roomAt: plan.roomAt };
}

/** Имя помещения станции для приборов — по-русски; переводит игра (L). */
export const stationRoomName = (r) => (r ? r.name : '');

export { CAB, GAL, LOBBY };
