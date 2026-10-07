// Станция изнутри: зал за щелью порта, посадочные площадки, терминал и
// помещения в нём.
//
// ЗАЧЕМ. Раньше щель порта вела в никуда: корабль, прошедший раму,
// считался пристыкованным, пропадал в центре станции, и поверх кадра
// открывалось меню. Теперь за щелью — тоннель, а за ним зал: в нём своя
// тяжесть в 1 g, площадки, на которые садятся на шасси, и терминал, куда
// с площадки идут пешком.
//
// ОДНА ПЛАНИРОВКА НА ВСЕХ. Отсюда её берут модель станции
// (js/models/stations.js — зал, площадки, корпус терминала), полёт в зале
// (js/game/berth.js), помещения для ходьбы (js/models/interior.station.js)
// и сервер: выгрузка каталога (tools/export.mjs) кладёт площадки и
// помещения в базу (station_pad, station_room), и номер площадки у
// корабля значит одно и то же у всех. Поэтому модуль чистый — ни мира, ни
// рендера, — и детерминированный: та же станция собирается в ту же
// планировку у клиента, у сервера и в проверках.
//
// ОСИ — станции, МЕТРЫ: x вправо, y вверх, z — ось порта (щель на +z).
// Тяжесть в зале — вниз по станции (−y): станция вращается вокруг оси
// порта, и зал с площадками вращается вместе с ней, а корабль внутри
// переносится вместе с залом (js/game/berth.js), как у тела в захвате.
//
// ПОЧЕМУ ТЕРМИНАЛ ПОСРЕДИНЕ. Площадки стоят двумя рядами по бокам от
// него, как гейты аэропорта: от трапа до двери терминала — шестнадцать
// метров перрона и меньше длины корабля, а не полкилометра через зал.
// Внутри — сквозной конкорс вдоль оси, из него — залы ожидания у каждой
// площадки и помещения станции: управление порта, ангарная служба,
// медпункт, бар и магазины. Магазины пока пустые: в базе они уже есть
// (station_room.shop) — торговать в них будут потом.

import { mulberry32 } from '../core/rng.js';

/** Тяжесть в зале станции, м/с² — привычные 1 g. */
export const STATION_G = 9.81;

// Зал — коробка за щелью (м, оси станции), тоннель — от неё до створа.
// Размеры выбраны так, чтобы зал целиком лежал внутри корпуса с запасом
// на стены в сотню с лишним метров: у «Кориолиса» угол зала
// (400, 150, 520) даёт |x|+|y|+|z| = 1070 при пределе грани 1400, у
// «Орбиса» угол (360, 140) — в 386 м от оси при ступице в 560 (проверка в
// tools/test.mjs). Высота — 300 м: «Прометей» в 66 м заходит в зал на
// середине высоты и садится, не задевая потолка ни башней, ни гондолами.
const HALLS = {
  coriolis: {
    hall: { lo: [-400, -150, -520], hi: [400, 150, 320] },
    // Тоннель чуть шире щели (176 × 96): корабль, прошедший раму с
    // дрейфом, не цепляет стены сразу за ней.
    tunnel: { hw: 96, hh: 56 },
    perSide: [4, 5],
  },
  orbis: {
    hall: { lo: [-360, -140, -380], hi: [360, 140, 180] },
    tunnel: { hw: 96, hh: 56 },
    perSide: [3, 4],
  },
};

// Площадки. Малая — под «Челленджер» (65 × 67 м) с запасом по восемь
// метров с каждой стороны; большая — под «Прометей» (195 × 80 м): длинной
// стороной поперёк ряда, чтобы крейсер садился носом к терминалу или
// кормой, а не перегораживал соседей.
export const PAD = {
  S: { w: 84, d: 84 },        // w — вдоль ряда (z), d — поперёк (x)
  L: { w: 120, d: 230 },
  apron: 16,                  // м — перрон между стеной терминала и краем площадки
  gap: 18,                    // м — между площадками в ряду
};

// Терминал: полуширина, высота корпуса, конкорс и помещения.
export const TERM = {
  hw: 26,                     // м — полуширина корпуса (наружная грань)
  height: 14,                 // м — до кровли
  wall: 0.6,                  // м — стена (столько же, сколько перегородка помещений)
  cw: 5,                      // м — полуширина конкорса
  ceilC: 6,                   // м — потолок конкорса
  ceilG: 5,                   // м — потолок зала ожидания
  ceilR: 4.5,                 // м — потолок помещений
  gateLen: 18,                // м — длина зала ожидания вдоль ряда
  end: 12,                    // м — от крайней площадки до торца терминала
};

// Помещения станции сверх конкорса и залов ожидания. kind — для игры и
// базы, shop — вид будущей лавки (station_room.shop), name — табличка.
// Порядок — по важности: на маленькой станции остаются первые.
const SERVICES = [
  { kind: 'office', name: 'УПРАВЛЕНИЕ ПОРТА', len: 20 },
  { kind: 'hangar', name: 'АНГАРНАЯ СЛУЖБА', len: 20 },
  { kind: 'bar', name: 'БАР', len: 26 },
  { kind: 'med', name: 'МЕДПУНКТ', len: 16 },
];
// Лавки — пустые помещения с витриной: торговать в них будут позже.
const SHOPS = [
  { shop: 'gear', name: 'СНАРЯЖЕНИЕ' },
  { shop: 'clothes', name: 'ОДЕЖДА' },
  { shop: 'tech', name: 'ЭЛЕКТРОНИКА' },
  { shop: 'food', name: 'ПРОДУКТЫ' },
  { shop: 'pharmacy', name: 'АПТЕКА' },
  { shop: 'souvenir', name: 'СУВЕНИРЫ' },
  { shop: 'tools', name: 'ИНСТРУМЕНТЫ' },
];

/** Семя станции — из имени, как и её тип (js/game/world.js, makeStation). */
export function stationSeed(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Второе перемешивание: тип станции берётся из того же хэша по модулю
  // двух, и без него чётность семени совпадала бы с типом.
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Плоскость створа (м): где корпус станции и где начинается тоннель. */
export const FACE_M = { coriolis: 700, orbis: 420 };
// Рама щели утоплена в площадку на тридцать метров (js/models/stations.js).
const SINK_M = 30;

/**
 * Пустота внутри корпуса — зал и тоннель (м, оси станции). У типа она одна
 * на все станции: от имени зависят площадки и помещения, а не стены зала.
 * По ней корпус станции перестаёт быть твёрдым там, где летают внутри
 * (js/models/stations.js, inside).
 */
export function interiorOf(kind) {
  const H = HALLS[kind] || HALLS.coriolis;
  const face = FACE_M[kind] || FACE_M.coriolis;
  return {
    hall: { lo: H.hall.lo.slice(), hi: H.hall.hi.slice() },
    tunnel: { hw: H.tunnel.hw, hh: H.tunnel.hh, z0: H.hall.hi[2], z1: face - SINK_M },
  };
}

/**
 * Планировка станции.
 *
 * @param kind  'coriolis' | 'orbis'
 * @param name  имя станции: из него семя, а из семени — число площадок,
 *              их размеры и набор помещений
 */
export function stationLayout(kind, name) {
  const H = HALLS[kind] || HALLS.coriolis;
  const rnd = mulberry32(stationSeed(name || kind));
  const { hall, tunnel } = interiorOf(kind);
  const F = hall.lo[1];
  const face = FACE_M[kind] || FACE_M.coriolis;

  // --- площадки: по ряду с каждой стороны ------------------------------------
  const [n0, n1] = H.perSide;
  const per = n0 + Math.floor(rnd() * (n1 - n0 + 1));
  const rows = [];
  for (const side of [1, -1]) {
    // В каждом ряду одна большая площадка; у «Кориолиса» с пятью местами в
    // ряду — две. Место большой — случайное, но не крайнее спереди: под
    // самым тоннелем удобнее садиться малым.
    const nL = kind === 'coriolis' && per >= 5 ? 2 : 1;
    const sizes = Array(per).fill('S');
    let put = 0;
    for (let guard = 0; put < nL && guard < 50; guard++) {
      const i = 1 + Math.floor(rnd() * (per - 1));
      if (sizes[i] === 'L') continue;
      sizes[i] = 'L';
      put++;
    }
    rows.push({ side, sizes });
  }
  // Длина ряда и место вдоль зала: оба ряда — от одной передней кромки,
  // а сама она — так, чтобы самый длинный ряд стоял посередине зала.
  const rowLen = (sizes) => sizes.reduce((s, k) => s + PAD[k].w, 0) + PAD.gap * (sizes.length - 1);
  const longest = Math.max(...rows.map((r) => rowLen(r.sizes)));
  const zMid = (hall.lo[2] + hall.hi[2]) / 2;
  const zFront = zMid + longest / 2;

  const pads = [];
  for (const row of rows) {
    let z = zFront;
    row.sizes.forEach((size, i) => {
      const P = PAD[size];
      const x0 = TERM.hw + PAD.apron, x1 = x0 + P.d;
      const lo = row.side > 0 ? [x0, F, z - P.w] : [-x1, F, z - P.w];
      const hi = row.side > 0 ? [x1, F, z] : [-x0, F, z];
      pads.push({ size, side: row.side, row: i, lo, hi, c: [(lo[0] + hi[0]) / 2, F, (lo[2] + hi[2]) / 2] });
      z -= P.w + PAD.gap;
    });
  }
  // Номера: от тоннеля назад, нечётные — справа, чётные — слева. По номеру
  // сразу видно сторону, а по порядку — как далеко идти.
  pads.sort((a, b) => (b.c[2] - a.c[2]) || (b.side - a.side));
  pads.forEach((p, i) => { p.n = i + 1; });
  const zs = pads.map((p) => [p.lo[2], p.hi[2]]).flat();
  const tz0 = Math.min(...zs) - TERM.end, tz1 = Math.max(...zs) + TERM.end;
  const terminal = { lo: [-TERM.hw, F, tz0], hi: [TERM.hw, F + TERM.height, tz1] };

  // --- помещения -----------------------------------------------------------------
  const w = TERM.wall;
  const xIn = TERM.cw + w, xOut = TERM.hw - w;        // помещения у бортов: от конкорса до стены
  const rooms = [];
  const doors = [];
  const openings = [];
  rooms.push({ id: 'concourse', kind: 'concourse', name: 'КОНКОРС',
    lo: [-TERM.cw, F, tz0 + w], hi: [TERM.cw, F + TERM.ceilC, tz1 - w] });

  // Залы ожидания — у каждой площадки, напротив её середины.
  const taken = { 1: [], [-1]: [] };
  for (const p of pads) {
    const id = 'gate' + p.n;
    const zc = p.c[2];
    const lo = p.side > 0 ? [xIn, F, zc - TERM.gateLen / 2] : [-xOut, F, zc - TERM.gateLen / 2];
    const hi = p.side > 0 ? [xOut, F + TERM.ceilG, zc + TERM.gateLen / 2] : [-xIn, F + TERM.ceilG, zc + TERM.gateLen / 2];
    rooms.push({ id, kind: 'gate', name: 'ВЫХОД НА ПЛОЩАДКУ ' + p.n, pad: p.n, lo, hi });
    p.gate = id;
    taken[p.side].push([lo[2], hi[2]]);
    // Дверь в конкорс и дверь на перрон — напротив середины площадки.
    doors.push({ id: 'g' + p.n + 'c', a: id, b: 'concourse', c: zc });
    doors.push({ id: 'g' + p.n + 'a', a: id, b: p.side > 0 ? 'apronR' : 'apronL', c: zc, gate: p.n });
  }

  // Службы и лавки — в просветах между залами ожидания, ближе к середине
  // терминала: от площадки к ним идти меньше всего.
  const pads1 = pads.length;
  // Сколько помещений сверх конкорса и залов: от 10 до 20 всего —
  // крупной станции больше.
  const total = Math.max(10, Math.min(20, pads1 + 3 + Math.floor(rnd() * 6)));
  const extra = Math.max(3, total - 1 - pads1);
  const want = [];
  for (let i = 0; i < Math.min(SERVICES.length, extra); i++) want.push({ ...SERVICES[i] });
  const shopPool = SHOPS.slice();
  while (want.length < extra && shopPool.length) {
    const s = shopPool.splice(Math.floor(rnd() * shopPool.length), 1)[0];
    want.push({ kind: 'shop', shop: s.shop, name: 'МАГАЗИН · ' + s.name, len: 18 + Math.floor(rnd() * 3) * 2 });
  }
  // Свободные отрезки вдоль каждого борта.
  const free = [];
  for (const side of [1, -1]) {
    const busy = taken[side].slice().sort((a, b) => a[0] - b[0]);
    let z = tz0 + w;
    for (const [a, b] of busy) {
      if (a - w - z > 8) free.push({ side, z0: z, z1: a - w });
      z = b + w;
    }
    if (tz1 - w - z > 8) free.push({ side, z0: z, z1: tz1 - w });
  }
  const zc = (tz0 + tz1) / 2;
  free.sort((a, b) => Math.abs((a.z0 + a.z1) / 2 - zc) - Math.abs((b.z0 + b.z1) / 2 - zc));
  let k = 0;
  for (const f of free) {
    // В отрезке — подряд, от того его конца, что ближе к середине
    // терминала: от площадки до помещений станции идти меньше всего.
    const up = (f.z0 + f.z1) / 2 < zc ? -1 : 1;     // куда растёт ряд: от середины наружу
    let edge = up > 0 ? f.z0 : f.z1;
    while (k < want.length) {
      const r = want[k];
      const len = r.len || 18;
      const lo = up > 0 ? edge : edge - len;
      const hi = up > 0 ? edge + len : edge;
      if (lo < f.z0 - 1e-6 || hi > f.z1 + 1e-6) break;
      edge = up > 0 ? hi + w : lo - w;
      const id = r.kind === 'shop' ? 'shop' + (k + 1) : r.kind;
      const x = f.side > 0 ? [xIn, xOut] : [-xOut, -xIn];
      rooms.push({ id, kind: r.kind, shop: r.shop || null, name: r.name,
        lo: [x[0], F, lo], hi: [x[1], F + TERM.ceilR, hi] });
      doors.push({ id: id + 'c', a: id, b: 'concourse', c: (lo + hi) / 2 });
      k++;
    }
    if (k >= want.length) break;
  }

  // Перрон: зал вокруг терминала — четыре открытых «помещения» без стен
  // (open): справа и слева во всю длину зала, спереди и сзади терминала.
  // Двери гейтов ведут в них, а между собой они связаны проёмами.
  const top = F + (hall.hi[1] - hall.lo[1]) * 0.8;
  rooms.push({ id: 'apronR', kind: 'apron', open: true, name: 'ПЕРРОН',
    lo: [TERM.hw, F, hall.lo[2]], hi: [hall.hi[0], top, hall.hi[2]] });
  rooms.push({ id: 'apronL', kind: 'apron', open: true, name: 'ПЕРРОН',
    lo: [hall.lo[0], F, hall.lo[2]], hi: [-TERM.hw, top, hall.hi[2]] });
  rooms.push({ id: 'apronF', kind: 'apron', open: true, name: 'ПЕРРОН',
    lo: [-TERM.hw, F, tz1], hi: [TERM.hw, top, hall.hi[2]] });
  rooms.push({ id: 'apronB', kind: 'apron', open: true, name: 'ПЕРРОН',
    lo: [-TERM.hw, F, hall.lo[2]], hi: [TERM.hw, top, tz0] });
  openings.push({ a: 'apronF', b: 'apronR', u: [tz1, hall.hi[2]] });
  openings.push({ a: 'apronF', b: 'apronL', u: [tz1, hall.hi[2]] });
  openings.push({ a: 'apronB', b: 'apronR', u: [hall.lo[2], tz0] });
  openings.push({ a: 'apronB', b: 'apronL', u: [hall.lo[2], tz0] });
  // Главные входы — по торцам конкорса.
  doors.push({ id: 'mainF', a: 'concourse', b: 'apronF', c: 0, main: true });
  doors.push({ id: 'mainB', a: 'concourse', b: 'apronB', c: 0, main: true });

  return { kind, name, seed: stationSeed(name || kind), hall, floor: F, tunnel, face, terminal, pads, rooms, doors, openings };
}

/** Плита площадки над полом зала, м: на неё садятся корабли и наступают пешком. */
export const PAD_H = 0.05;

/**
 * Пол зала под точкой (x, z) для шага, м (оси станции): на площадке — её
 * плита. Терминал стоит на том же полу, и внутри него пол тот же.
 */
export function walkFloorAt(L, x, z) {
  return L.floor + (padAt(L, x, z) ? PAD_H : 0);
}

/** Площадка под точкой (м, оси станции) — или null. */
export function padAt(L, x, z, m = 0) {
  for (const p of L.pads) {
    if (x >= p.lo[0] - m && x <= p.hi[0] + m && z >= p.lo[2] - m && z <= p.hi[2] + m) return p;
  }
  return null;
}

/** Площадка по номеру — или null. */
export const padByNo = (L, n) => L.pads.find((p) => p.n === n) || null;

/**
 * Какая площадка нужна кораблю: малая берёт корабль до восьмидесяти метров
 * в длину и ширину, крупнее — только большая.
 * @param len, wid габариты корпуса, м
 */
export function padSizeFor(len, wid) {
  return Math.max(len, wid) <= PAD.S.w - 4 ? 'S' : 'L';
}

/** В зале ли точка (м, оси станции), с запасом m внутрь. */
export function inHall(L, p, m = 0) {
  const h = L.hall;
  return p[0] > h.lo[0] + m && p[0] < h.hi[0] - m && p[1] > h.lo[1] + m && p[1] < h.hi[1] - m
    && p[2] > h.lo[2] + m && p[2] < h.hi[2] - m;
}

/** В тоннеле ли точка (м, оси станции): от зала до рамы щели. */
export function inTunnel(L, p, m = 0) {
  const t = L.tunnel;
  return Math.abs(p[0]) < t.hw - m && Math.abs(p[1]) < t.hh - m && p[2] >= t.z0 - 1 && p[2] <= t.z1 + 1;
}

/** Внутри ли станции вообще (зал или тоннель) — там своя тяжесть и свой перенос. */
export const insideStation = (L, p) => inHall(L, p) || inTunnel(L, p);
