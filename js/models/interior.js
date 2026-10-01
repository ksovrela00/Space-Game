// Помещения корабля: куда пилот уходит, встав с кресла.
//
// ЧТО ЭТО. Корпус «Challenger» — 65 метров длины, размер «Боинга», и до
// сих пор внутри у него была одна рубка под фонарём. Замер корпуса
// (лучами во все шесть сторон из каждой точки) показал, что места там на
// три палубы: под рубкой — девять с половиной метров до днища, под носом
// — трюм в четырнадцать метров. Здесь эти палубы и собраны:
//
//   ярус рубки (пол 0.2 м)   — рубка, переборка с дверью, верх трапа;
//   средняя палуба (−4.94)   — кают-компания с камбузом, коридор, каюта,
//                              кладовая, санузел, медотсек, машинное;
//   нижняя палуба (−9.0)     — грузовой трюм под носом.
//
// Каждая комната — коробка в осях корабля (метры, нос +z, верх +y).
// Коробки проверены по самому корпусу (tools/test.mjs, «помещения»):
// вместе со стенами они целиком внутри обшивки, снаружи ничего не
// торчит. Корпус изнутри внутри коробок не рисуется (js/gl/hull.js,
// вырез): у модели пака под обшивкой лежат внутренние грани деталей, и
// без выреза они резали бы комнаты пополам.
//
// ИЗ ЧЕГО. Стены, пол, потолок, двери, колонны, ящики, пульты и капсулы —
// CC0-пак Quaternius «Modular Sci-Fi», мебель — CC0-пак Kenney
// «Furniture Kit» (tools/interior.mjs). Кодом собраны только трапы и
// переборка рубки: трап — это стальные ступени по уклону, а переборка
// повторяет сечение фонаря, которого в паке нет и быть не может.
//
// МАСШТАБ. Пак рисован в своих метрах: стена 4.43, проём двери 2.62.
// Взят коэффициент 0.75: проём выходит 1.97 м (человек в 1.8 м проходит,
// не пригибаясь), потолок — 3.32 м, плитка — полтора метра. Мебель Kenney
// — в своих единицах (столешница камбуза 0.45, проём двери 1.01), то есть
// около двух метров на единицу.
//
// КАК СТАВИТСЯ СТЕНА. У деталей пака лицо смотрит в +z и лежит на 0.21 м
// за линией сетки, а обратной стороны нет вовсе: пак рассчитан на
// отсечение задних граней, и стены соседних комнат в нём стоят на одной
// линии лицами врозь, перекрещиваясь. Кабина рисует грани с обеих
// сторон, и там перекрестье вылезло бы чужой стеной поверх своей. Поэтому
// здесь лицо стены ставится РОВНО на границу комнаты, а между соседними
// комнатами — зазор gap: в нём умещается тоннель рамы двери (0.59 м
// вглубь), и детали двух комнат не прорастают друг в друга.
//
// Всё здесь в осях МОДЕЛИ корабля (метры). В оси кабины (от глаза
// пилота, js/models/cockpit.js) сетки переводятся только на выходе.

import { INTERIOR_PARTS as PARTS, INTERIOR_ROLES as ROLES } from './interior.parts.js';
import { EYE, CMAT } from './cockpit.js';

const K = 0.75;               // масштаб пака Quaternius
const F = 2.0;                // масштаб мебели Kenney: метров на единицу пака
const FACE = 0.21;            // лицо стены пака за линией сетки, м пака

export const INT = {
  K, F,
  wallW: 4 * K,               // 3.0 м — ширина стены
  wallH: 4.43 * K,            // 3.32 м — высота стены и комнаты
  tile: 2 * K,                // 1.5 м — плитка пола и потолка
  gap: 0.6,                   // м — перегородка между комнатами (тоннель двери 0.59)
  // Палубы: пол яруса рубки — палуба рубки (js/models/hulldetail.js).
  deck: { bridge: 0.2, mid: -4.94, low: -9.0 },
  // Переборка рубки: задний край палубы рубки (там корпус переходит из
  // стекла в наклонную плиту за креслом).
  bulkZ: -14.35,
  bulkT: 0.2,
  // Проём двери пака: полуширина 0.756 и верх 2.62 м пака (у краёв; в
  // середине он выше — 2.90).
  doorHalf: 0.756 * K,        // 0.567 м
  doorTop: 2.62 * K,          // 1.965 м
  // Трап: подъём ступени и проступь — как у корабельного трапа, круче
  // жилой лестницы (там 0.17 и 0.29): место на корабле дорого.
  rise: 0.19,
  tread: 0.27,
  stairHalf: 0.75,            // полуширина марша
};

const CEIL_MID = INT.deck.mid + INT.wallH;    // −1.6175
const CEIL_LOW = INT.deck.low + INT.wallH;    // −5.6775

// --- палитра -------------------------------------------------------------------
//
// Роли граней (tools/interior.mjs) -> цвет и материал кабины. Сталь пака
// — в тон обшивке рубки (js/models/cockpit.js, C.frame/panel), янтарь —
// тот же, что на рукоятках поста. Дерево Kenney становится графитовым
// композитом, розовая ткань — сине-серой обивкой: мебель на корабле
// крашена кораблём, а не мебельным магазином.
const PALETTE = {
  main: [[90, 95, 103], CMAT.paint],
  light: [[116, 121, 129], CMAT.paint],
  dark: [[50, 53, 58], CMAT.trim],
  accent: [[196, 120, 42], CMAT.paint],
  accentDark: [[122, 74, 30], CMAT.paint],
  black: [[22, 23, 26], CMAT.trim],
  glass: [[46, 68, 82], CMAT.trim],
  pipes: [[128, 132, 138], CMAT.metal],
  wood: [[74, 78, 86], CMAT.paint],
  woodDark: [[56, 59, 66], CMAT.paint],
  fabric: [[150, 154, 160], CMAT.rubber],
  fabricRed: [[70, 86, 110], CMAT.rubber],
  fabricDark: [[52, 62, 78], CMAT.rubber],
  fabricBlue: [[64, 92, 132], CMAT.rubber],
  metal: [[150, 156, 162], CMAT.metal],
  metalMid: [[104, 110, 116], CMAT.metal],
  metalDark: [[62, 66, 72], CMAT.metal],
  white: [[192, 196, 200], CMAT.paint],
  lamp: [[255, 238, 204], CMAT.lamp],
  plant: [[72, 128, 84], CMAT.paint],
};
const ROLE_PAL = ROLES.map((r) => PALETTE[r] || PALETTE.main);

// Свои цвета — для того, что собрано кодом (трап, переборка).
const C = {
  steel: [96, 101, 108],
  stair: [70, 74, 80],
  frame: [84, 90, 98],
  accent: [196, 120, 42],
  hazard: [214, 168, 40],
  lamp: [255, 238, 204],
  dark: [36, 38, 42],
  post: [150, 156, 162],
};

// --- сетка ---------------------------------------------------------------------
//
// Треугольники сразу в плоские массивы: помещений на десятки тысяч
// граней, и объект на грань (как у поста пилота) стоил бы мегабайты.
// Нормаль — плоская, на грань: пак рисован плоским затенением.
export class MeshBuf {
  constructor() {
    this.pos = [];       // x, y, z — оси модели, м
    this.nrm = [];
    this.col = [];       // r, g, b (0..255), свечение (0..1)
    this.mat = [];
    this.tris = 0;
  }

  /** Многоугольник веером. Нормаль — по Ньюэллу: годится и для неплоского. */
  poly(P, rgb, mat, em = 0) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    nx /= l; ny /= l; nz /= l;
    for (let k = 1; k + 1 < P.length; k++) {
      for (const p of [P[0], P[k], P[k + 1]]) {
        this.pos.push(p[0], p[1], p[2]);
        this.nrm.push(nx, ny, nz);
        this.col.push(rgb[0], rgb[1], rgb[2], em);
        this.mat.push(mat);
      }
      this.tris++;
    }
  }

  /** Коробка по двум углам (оси корабля). */
  box(lo, hi, rgb, mat, em = 0) {
    const [x0, y0, z0] = lo, [x1, y1, z1] = hi;
    const q = (a, b, c, d) => this.poly([a, b, c, d], rgb, mat, em);
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  }

  /** Брус квадратного сечения w от точки a к b. */
  beam(a, b, w, rgb, mat) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const t = d.map((c) => c / l);
    const h = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [h[1] * t[2] - h[2] * t[1], h[2] * t[0] - h[0] * t[2], h[0] * t[1] - h[1] * t[0]];
    const ul = Math.hypot(u[0], u[1], u[2]);
    u = u.map((c) => c / ul * w / 2);
    const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    const ring = (p) => [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([su, sv]) =>
      [p[0] + u[0] * su + v[0] * sv, p[1] + u[1] * su + v[1] * sv, p[2] + u[2] * su + v[2] * sv]);
    const A = ring(a), B = ring(b);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.poly([A[i], A[j], B[j], B[i]], rgb, mat);
    }
  }

  /**
   * Деталь пака: точка детали p (м пака) -> o + ux·p.x + uy·p.y + uz·p.z.
   * ux, uy, uz — оси детали в осях корабля, уже со своими масштабами.
   */
  part(name, o, ux, uy, uz) {
    const P = PARTS[name];
    if (!P) throw new Error('нет детали ' + name);
    const V = P.verts;
    const xf = (i) => {
      const x = V[i * 3] / 1000, y = V[i * 3 + 1] / 1000, z = V[i * 3 + 2] / 1000;
      return [o[0] + ux[0] * x + uy[0] * y + uz[0] * z,
        o[1] + ux[1] * x + uy[1] * y + uz[1] * z,
        o[2] + ux[2] * x + uy[2] * y + uz[2] * z];
    };
    const Fc = P.faces;
    for (let i = 0; i < Fc.length;) {
      const n = Fc[i++];
      const pts = [];
      for (let k = 0; k < n; k++) pts.push(xf(Fc[i + k]));
      i += n;
      const [rgb, mat] = ROLE_PAL[Fc[i++]];
      this.poly(pts, rgb, mat, mat === CMAT.lamp ? 1 : 0);
    }
  }
}

/** Габарит детали, м пака: [lo, hi]. */
const bounds = (name) => {
  const P = PARTS[name];
  return [P.lo.map((v) => v / 1000), P.hi.map((v) => v / 1000)];
};

// --- планировка -------------------------------------------------------------------
//
// Комнаты: [lo, hi] — свободное место внутри (лица стен — на этих
// границах), оси корабля, метры. Высота у обычной комнаты — ровно стена
// пака; у шахт трапов — сколько надо.
export const ROOMS = [
  { id: 'bridge', name: 'РУБКА', kind: 'bridge',
    lo: [-3.8, INT.deck.bridge, INT.bulkZ], hi: [3.8, 3.0, -4.4] },
  // Верх трапа: площадка за переборкой и шахта вниз, до потолка
  // кают-компании (там её продолжает проём в потолке).
  { id: 'shaftA', name: 'ТРАП', kind: 'shaft',
    lo: [-0.8, CEIL_MID, -22.0], hi: [0.8, 2.45, INT.bulkZ - INT.bulkT] },
  { id: 'hall', name: 'КАЮТ-КОМПАНИЯ', lo: [-4.2, INT.deck.mid, -24.4], hi: [4.2, CEIL_MID, -15.0] },
  { id: 'corridor', name: 'КОРИДОР', lo: [-0.9, INT.deck.mid, -15.0], hi: [0.9, CEIL_MID, -4.0] },
  { id: 'cabin', name: 'КАЮТА', lo: [-4.2, INT.deck.mid, -14.4], hi: [-1.5, CEIL_MID, -8.6] },
  { id: 'storage', name: 'КЛАДОВАЯ', lo: [-4.2, INT.deck.mid, -8.0], hi: [-1.5, CEIL_MID, -4.0] },
  { id: 'washroom', name: 'САНУЗЕЛ', lo: [1.5, INT.deck.mid, -14.4], hi: [4.2, CEIL_MID, -11.4] },
  { id: 'medbay', name: 'МЕДОТСЕК', lo: [1.5, INT.deck.mid, -10.8], hi: [4.2, CEIL_MID, -4.0] },
  { id: 'engine', name: 'МАШИННОЕ ОТДЕЛЕНИЕ', lo: [-4.2, INT.deck.mid, -28.4], hi: [4.2, CEIL_MID, -25.0] },
  { id: 'shaftB', name: 'ТРАП', kind: 'shaft', lo: [-0.8, INT.deck.low, -4.0], hi: [0.8, -2.75, 1.4] },
  { id: 'hold', name: 'ГРУЗОВОЙ ТРЮМ', lo: [-4.2, INT.deck.low, 1.4], hi: [4.2, CEIL_LOW, 15.4] },
];
const R = Object.fromEntries(ROOMS.map((r) => [r.id, r]));

// Трапы: верх (z, y), куда идут (−1 — к корме, +1 — к носу) и низ.
export const STAIRS = [
  // Из-за переборки рубки вниз к корме, в кают-компанию.
  { id: 'A', x: 0, zTop: -16.1, yTop: INT.deck.bridge, yBot: INT.deck.mid, dir: -1, room: 'shaftA', to: 'hall' },
  // Из носа коридора вниз к носу, в трюм.
  { id: 'B', x: 0, zTop: -4.0, yTop: INT.deck.mid, yBot: INT.deck.low, dir: 1, room: 'shaftB', to: 'hold' },
];
for (const s of STAIRS) {
  s.n = Math.round((s.yTop - s.yBot) / INT.rise);
  s.r = (s.yTop - s.yBot) / s.n;
  // Ступеней n − 1: последний подъём — это уже пол нижней палубы.
  s.zBot = s.zTop + s.dir * (s.n - 1) * INT.tread;
}

// Двери: между комнатами a (сторона с рамой-тоннелем) и b, на стене a,
// обращённой к b. c — середина по стене.
export const DOORS = [
  { id: 'cabin', a: 'corridor', b: 'cabin', c: -11.5 },
  { id: 'storage', a: 'corridor', b: 'storage', c: -5.5 },
  { id: 'washroom', a: 'corridor', b: 'washroom', c: -12.9 },
  { id: 'medbay', a: 'corridor', b: 'medbay', c: -8.5 },
  { id: 'engine', a: 'hall', b: 'engine', c: 0 },
];

// Проёмы без дверей: прямоугольник в плоскости общей грани двух
// комнат (u — координата вдоль грани, y — высота).
export const OPENINGS = [
  { a: 'corridor', b: 'hall', u: [-0.9, 0.9] },
  { a: 'corridor', b: 'shaftB', u: [-0.8, 0.8], y: [INT.deck.mid, -2.75] },
  { a: 'shaftB', b: 'hold', u: [-0.8, 0.8], y: [INT.deck.low, CEIL_LOW] },
  // Проём в потолке кают-компании, куда уходит трап A. Задний край — там,
  // где спускающийся уже не задевает головой кромку: тело — коробка в
  // полметра, и, когда её задний край доходит до кромки, ступень под
  // передним краем должна быть ниже потолка на рост. Это ступень № 20 —
  // кромка не ближе −21.83 м; взято −22.0.
  { a: 'hall', b: 'shaftA', ceil: true, x: [-0.8, 0.8], z: [-22.0, STAIRS[0].zTop] },
];

/** Грань комнаты, к которой примыкает соседняя: ось, знак, координата. */
function sharedFace(a, b) {
  for (let ax = 0; ax < 3; ax++) {
    for (const [sa, va, vb] of [[1, a.hi[ax], b.lo[ax]], [-1, a.lo[ax], b.hi[ax]]]) {
      const d = (vb - va) * sa;
      if (d >= -1e-6 && d <= INT.gap + 1e-6) {
        let ok = true;
        for (let o = 0; o < 3; o++) {
          if (o === ax) continue;
          if (Math.min(a.hi[o], b.hi[o]) - Math.max(a.lo[o], b.lo[o]) < 0.3) ok = false;
        }
        if (ok) return { ax, s: sa, at: va, gap: d };
      }
    }
  }
  return null;
}

// --- грани комнаты ------------------------------------------------------------------
//
// Грань — прямоугольник в своей плоскости: у стен u — вдоль (по x или z),
// v — высота; у пола и потолка u — x, v — z. Дыры — проёмы и двери.

function roomFaces(room) {
  const [x0, y0, z0] = room.lo, [x1, y1, z1] = room.hi;
  const wall = (side, ax, at, n, u, uAx) => ({ side, ax, at, n, u, uAx, v: [y0, y1], holes: [], doors: [] });
  return [
    wall('x-', 0, x0, [1, 0, 0], [z0, z1], 2),
    wall('x+', 0, x1, [-1, 0, 0], [z0, z1], 2),
    wall('z-', 2, z0, [0, 0, 1], [x0, x1], 0),
    wall('z+', 2, z1, [0, 0, -1], [x0, x1], 0),
    { side: 'y-', ax: 1, at: y0, n: [0, 1, 0], u: [x0, x1], v: [z0, z1], holes: [] },
    { side: 'y+', ax: 1, at: y1, n: [0, -1, 0], u: [x0, x1], v: [z0, z1], holes: [] },
  ];
}

const faceOf = (faces, ax, s) => faces.find((f) => f.ax === ax && f.side.endsWith(s > 0 ? '+' : '-'));

/** Грани всех комнат; проёмы и двери разложены по ним. */
function layoutFaces() {
  const Fs = {};
  for (const r of ROOMS) Fs[r.id] = roomFaces(r);
  for (const o of OPENINGS) {
    const a = R[o.a], b = R[o.b];
    if (o.ceil) {
      faceOf(Fs[o.a], 1, 1).holes.push({ u: o.x, v: o.z, to: o.b });
      faceOf(Fs[o.b], 1, -1).holes.push({ u: o.x, v: o.z, to: o.a });
      continue;
    }
    const sf = sharedFace(a, b);
    if (!sf) throw new Error('проём ' + o.a + '–' + o.b + ': комнаты не соседи');
    const yr = o.y || [Math.max(a.lo[1], b.lo[1]), Math.min(a.hi[1], b.hi[1])];
    faceOf(Fs[o.a], sf.ax, sf.s).holes.push({ u: o.u, v: yr, to: o.b });
    faceOf(Fs[o.b], sf.ax, -sf.s).holes.push({ u: o.u, v: yr, to: o.a });
  }
  for (const d of DOORS) {
    const a = R[d.a], b = R[d.b];
    const sf = sharedFace(a, b);
    if (!sf) throw new Error('дверь ' + d.id + ': комнаты не соседи');
    if (Math.abs(sf.gap - INT.gap) > 1e-6) throw new Error('дверь ' + d.id + ': перегородка не ' + INT.gap + ' м');
    const fa = faceOf(Fs[d.a], sf.ax, sf.s), fb = faceOf(Fs[d.b], sf.ax, -sf.s);
    const y = a.lo[1];
    const hole = { u: [d.c - INT.doorHalf, d.c + INT.doorHalf], v: [y, y + INT.doorTop], door: d.id };
    fa.holes.push({ ...hole, to: d.b }); fb.holes.push({ ...hole, to: d.a });
    fa.doors.push({ id: d.id, c: d.c, side: 'A' });
    fb.doors.push({ id: d.id, c: d.c, side: 'B' });
    d.ax = sf.ax; d.s = sf.s; d.at = sf.at; d.y = y;
    // Середина проёма в перегородке — по ней работает автоматика двери.
    d.pos = [0, y, 0];
    d.pos[sf.ax] = sf.at + sf.s * INT.gap / 2;
    d.pos[sf.ax === 0 ? 2 : 0] = d.c;
  }
  return Fs;
}

// --- прямоугольники -------------------------------------------------------------

/** Прямоугольник минус дыры: набор прямоугольников без них. */
export function subtract(rect, holes) {
  let out = [rect];
  for (const h of holes) {
    const next = [];
    for (const r of out) {
      const iu0 = Math.max(r.u[0], h.u[0]), iu1 = Math.min(r.u[1], h.u[1]);
      const iv0 = Math.max(r.v[0], h.v[0]), iv1 = Math.min(r.v[1], h.v[1]);
      if (iu1 - iu0 <= 1e-6 || iv1 - iv0 <= 1e-6) { next.push(r); continue; }
      if (iu0 - r.u[0] > 1e-6) next.push({ u: [r.u[0], iu0], v: r.v });
      if (r.u[1] - iu1 > 1e-6) next.push({ u: [iu1, r.u[1]], v: r.v });
      if (iv0 - r.v[0] > 1e-6) next.push({ u: [iu0, iu1], v: [r.v[0], iv0] });
      if (r.v[1] - iv1 > 1e-6) next.push({ u: [iu0, iu1], v: [iv1, r.v[1]] });
    }
    out = next;
  }
  return out;
}

// --- раскладка деталей ---------------------------------------------------------------

/** Точка на стене: u вдоль, высота y, отступ d от лица в комнату. */
function wallPoint(f, u, y, d = 0) {
  const p = [0, y, 0];
  p[f.ax] = f.at + f.n[f.ax] * d;
  p[f.uAx] = u;
  return p;
}

/** Ось касательной стены (y × n): лицо детали (+z) смотрит по n. */
const tangentOf = (n) => [n[2], 0, -n[0]];

// Детерминированный «случай»: одна и та же стена всегда одного рисунка.
const hash = (a, b) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
// Рисунок стены: гладкая — через одну, иначе от рельефа рябит в глазах
// (и он же стоит вчетверо больше граней: 600–1000 против 150).
const WALLS = ['wall1', 'wallPlain', 'wall3', 'wallPlain', 'wall4', 'wall5', 'wallPlain', 'wall2', 'wallPlain'];

/** Деталь стены: середина u, низ y0, ширина w и высота h (м); лицо — на грани. */
function wallPiece(buf, f, name, u, y0, w, h) {
  const t = tangentOf(f.n);
  const sx = w / 4, sy = h / 4.43;
  const o = wallPoint(f, u, y0, FACE * K);
  buf.part(name, o, t.map((c) => c * sx), [0, sy, 0], f.n.map((c) => c * K));
}

/**
 * Застелить отрезок стены [u0, u1] деталями во всю высоту [y0, y1].
 * Где деталь ужата больше чем на 40%, ставится гладкая стена: мелкий
 * рельеф, сжатый вдвое, читается браком.
 */
function fillWall(buf, f, u0, u1, y0, y1, seed) {
  const len = u1 - u0;
  if (len < 0.05) return;
  const rows = Math.max(1, Math.round((y1 - y0) / INT.wallH));
  const h = (y1 - y0) / rows;
  const n = Math.max(1, Math.round(len / INT.wallW));
  const w = len / n;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < n; i++) {
      const pick = w < INT.wallW * 0.6 || h < INT.wallH * 0.6 ? 'wallPlain'
        : WALLS[Math.floor(hash(seed + i * 7.1, f.at + r * 3.3) * WALLS.length)];
      wallPiece(buf, f, pick, u0 + w * (i + 0.5), y0 + h * r, w, h);
    }
  }
}

/** Ровная панель кодом — перемычки над проёмами. */
function panel(buf, f, u0, u1, v0, v1, rgb = C.steel) {
  const a = wallPoint(f, u0, v0, 0.01), b = wallPoint(f, u1, v0, 0.01);
  const c = wallPoint(f, u1, v1, 0.01), d = wallPoint(f, u0, v1, 0.01);
  buf.poly([a, b, c, d], rgb, CMAT.paint);
}

/** Колонна пака стоймя: середина в (x, z), низ y0, высота h. */
function column(ctx, buf, name, x, y0, z, h, solid = false) {
  const key = Math.round(x * 100) + ':' + Math.round(z * 100) + ':' + Math.round(y0 * 10);
  if (ctx.columns.has(key)) return;
  ctx.columns.add(key);
  buf.part(name, [x, y0, z], [K, 0, 0], [0, h / 4.46, 0], [0, 0, K]);
  if (solid) ctx.solids.push({ lo: [x - 0.22, y0, z - 0.22], hi: [x + 0.22, y0 + h, z + 0.22], column: true });
}

/** Стена комнаты целиком: детали, двери, проёмы. */
function buildWall(ctx, buf, room, f) {
  const y0 = f.v[0], y1 = f.v[1];
  const cuts = [];
  for (const d of f.doors) cuts.push({ u0: d.c - INT.wallW / 2, u1: d.c + INT.wallW / 2, door: d });
  for (const h of f.holes) if (!h.door) cuts.push({ u0: h.u[0], u1: h.u[1], hole: h });
  cuts.sort((a, b) => a.u0 - b.u0);
  let u = f.u[0];
  const seed = room.lo[0] * 3 + room.lo[2] * 7 + f.ax;
  for (const c of cuts) {
    if (c.u0 > u + 1e-6) fillWall(buf, f, u, c.u0, y0, y1, seed + u);
    if (c.door) {
      const d = c.door;
      wallPiece(buf, f, d.side === 'A' ? 'doorWallA' : 'doorWallB', d.c, y0, INT.wallW, INT.wallH);
      if (y1 - y0 > INT.wallH + 0.02) panel(buf, f, c.u0, c.u1, y0 + INT.wallH, y1);
    } else {
      const h = c.hole;
      // Проём не во всю высоту — перемычка над ним и стенка под ним.
      if (h.v[1] < y1 - 0.02) panel(buf, f, h.u[0], h.u[1], h.v[1], y1);
      if (h.v[0] > y0 + 0.02) panel(buf, f, h.u[0], h.u[1], y0, h.v[0]);
      // Кромки проёма — колонны: торец детали пака открыт, а колонна его
      // закрывает (так пак и задуман). У проёмов к трапу их нет: там
      // кромку продолжает стена шахты, а колонна встала бы на ступень.
      const toShaft = R[h.to] && R[h.to].kind === 'shaft';
      if (room.kind !== 'shaft' && !toShaft && h.v[1] - h.v[0] > 2) {
        for (const ue of [h.u[0], h.u[1]]) {
          const p = wallPoint(f, ue, y0, 0);
          column(ctx, buf, 'columnSlim', p[0], y0, p[2], y1 - y0, true);
        }
      }
    }
    u = Math.max(u, c.u1);
  }
  if (f.u[1] > u + 1e-6) fillWall(buf, f, u, f.u[1], y0, y1, seed + u);
}

/** Пол или потолок: плитка по прямоугольнику минус дыры. */
function buildFlat(buf, f) {
  const ceil = f.side === 'y+';
  const kinds = ceil
    ? ['roofPlain', 'roof', 'roofPlain', 'roofPlain', 'roofSmallVents', 'roofPlain', 'roofDetails', 'roofPlain', 'roof', 'roofPlain']
    : ['floorPlain', 'floor', 'floorPlain', 'floorPlain', 'floor2', 'floorPlain', 'floor', 'floorPlain'];
  for (const r of subtract({ u: f.u, v: f.v }, f.holes)) {
    const w = r.u[1] - r.u[0], d = r.v[1] - r.v[0];
    if (w < 0.05 || d < 0.05) continue;
    const nx = Math.max(1, Math.round(w / INT.tile)), nz = Math.max(1, Math.round(d / INT.tile));
    const sx = w / nx / 2, sz = d / nz / 2;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = r.u[0] + (i + 0.5) * w / nx, z = r.v[0] + (j + 0.5) * d / nz;
        const name = kinds[Math.floor(hash(x * 1.7, z * 2.3) * kinds.length)];
        const top = bounds(name)[1][1];
        // Потолок — та же плитка, перевёрнутая узором вниз (поворот на
        // пол-оборота вокруг x, а не зеркало).
        if (ceil) buf.part(name, [x, f.at + top * K, z], [sx, 0, 0], [0, -K, 0], [0, 0, -sz]);
        else buf.part(name, [x, f.at - top * K, z], [sx, 0, 0], [0, K, 0], [0, 0, sz]);
      }
    }
  }
}

// --- переборка рубки --------------------------------------------------------------
//
// Сечение фонаря у заднего края палубы: на каждой высоте — ближайшая к
// оси стенка корпуса с каждой стороны. По этому контуру и вырезается
// переборка: прямоугольная стена вылезла бы сквозь стекло наружу.

function canopyProfile(hullM, z0) {
  const rows = [];
  for (let y = INT.deck.bridge; y < 4; y += 0.1) {
    const hw = canopyHalf(hullM, z0, y);
    if (!isFinite(hw) || hw < 0.05) break;
    rows.push({ y, l: -hw, r: hw });
  }
  return rows;
}

function buildBulkhead(buf, prof) {
  const z = INT.bulkZ, zb = INT.bulkZ - INT.bulkT;
  const dh = INT.doorHalf, top = INT.deck.bridge + INT.doorTop;
  // Лицо в рубку и лицо на площадку — полосами по высоте, в обход проёма.
  for (let i = 0; i + 1 < prof.length; i++) {
    const a = prof[i], b = prof[i + 1];
    const spans = a.y >= top - 1e-6 ? [[a.l, b.l, a.r, b.r]]
      : [[a.l, b.l, -dh, -dh], [dh, dh, a.r, b.r]];
    for (const [l0, l1, r0, r1] of spans) {
      buf.poly([[l0, a.y, z], [r0, a.y, z], [r1, b.y, z], [l1, b.y, z]], C.steel, CMAT.paint);
      buf.poly([[l0, a.y, zb], [l1, b.y, zb], [r1, b.y, zb], [r0, a.y, zb]], C.steel, CMAT.paint);
    }
  }
  // Последняя полоса под самым верхом фонаря — треугольником в точку.
  const last = prof[prof.length - 1];
  if (last) {
    const yt = last.y + 0.06;
    buf.poly([[last.l, last.y, z], [last.r, last.y, z], [0, yt, z]], C.steel, CMAT.paint);
    buf.poly([[last.l, last.y, zb], [0, yt, zb], [last.r, last.y, zb]], C.steel, CMAT.paint);
  }
  // Рама двери: янтарь по проёму, как у рам пака.
  const fw = 0.1;
  buf.box([-dh - fw, INT.deck.bridge, zb - 0.02], [-dh, top, z + 0.03], C.accent, CMAT.paint);
  buf.box([dh, INT.deck.bridge, zb - 0.02], [dh + fw, top, z + 0.03], C.accent, CMAT.paint);
  buf.box([-dh - fw, top, zb - 0.02], [dh + fw, top + fw, z + 0.03], C.accent, CMAT.paint);
  // Табличка и лампа над дверью.
  buf.box([-0.35, top + 0.22, z + 0.005], [0.35, top + 0.36, z + 0.02], C.dark, CMAT.trim);
  buf.box([-0.18, top + 0.42, z + 0.005], [0.18, top + 0.47, z + 0.03], C.lamp, CMAT.lamp, 1);
}

// --- трап -------------------------------------------------------------------------

function buildStair(buf, solids, s) {
  const xh = INT.stairHalf, t = INT.tread;
  const z = (i) => s.zTop + s.dir * i * t;
  for (let i = 1; i < s.n; i++) {
    const y = s.yTop - i * s.r;
    const za = z(i - 1), zb = z(i);
    const lo = [s.x - xh, y - 0.05, Math.min(za, zb)], hi = [s.x + xh, y, Math.max(za, zb)];
    buf.box(lo, hi, C.stair, CMAT.tread);
    // Кромка ступени — жёлто-чёрная: на трапе вниз её видно издалека.
    // Кромка — со стороны спуска, куда идёт нога.
    const ze = zb, zi = zb - s.dir * 0.05;
    buf.poly([[s.x - xh, y + 0.002, Math.min(ze, zi)], [s.x + xh, y + 0.002, Math.min(ze, zi)],
      [s.x + xh, y + 0.002, Math.max(ze, zi)], [s.x - xh, y + 0.002, Math.max(ze, zi)]], C.hazard, CMAT.hazard);
    solids.push({ lo, hi, stair: s.id });
  }
  // Линия кромок: высота по z.
  const edgeY = (zz) => s.yTop - ((zz - s.zTop) * s.dir / t) * s.r;
  for (const sx of [-1, 1]) {
    // Тетива: стальной швеллер по уклону вдоль марша.
    const xs = s.x + sx * (xh + 0.03);
    buf.beam([xs, edgeY(s.zTop) - 0.12, s.zTop], [xs, s.yBot + 0.02, s.zBot + s.dir * 0.2], 0.06, C.frame, CMAT.paint);
    // Поручень на стойках, девяносто сантиметров над кромками.
    const xr = s.x + sx * (xh - 0.04);
    buf.beam([xr, edgeY(s.zTop) + 0.9, s.zTop], [xr, edgeY(s.zBot) + 0.9, s.zBot], 0.045, C.accent, CMAT.paint);
    for (let i = 0; i < s.n - 1; i += 4) {
      const zz = z(i) + s.dir * t * 0.5;
      buf.beam([xr, edgeY(zz), zz], [xr, edgeY(zz) + 0.9, zz], 0.03, C.post, CMAT.metal);
    }
  }
}

// --- комнаты: наполнение -----------------------------------------------------------

/**
 * Предмет на полу: середина (x, z), низ y, поворот лица (рад; 0 — в +z,
 * π/2 — в +x), масштаб (число или по осям детали).
 */
function prop(ctx, buf, name, x, y, z, yaw = 0, s = K, opts = {}) {
  const sv = Array.isArray(s) ? s : [s, s, s];
  const c = Math.cos(yaw), si = Math.sin(yaw);
  const ux = [c * sv[0], 0, -si * sv[0]], uz = [si * sv[2], 0, c * sv[2]];
  buf.part(name, [x, y, z], ux, [0, sv[1], 0], uz);
  if (opts.solid === false) return;
  const [lo, hi] = bounds(name);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const px of [lo[0], hi[0]]) {
    for (const pz of [lo[2], hi[2]]) {
      const wx = x + ux[0] * px + uz[0] * pz, wz = z + ux[2] * px + uz[2] * pz;
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
    }
  }
  ctx.solids.push({ lo: [x0, y + lo[1] * sv[1], z0], hi: [x1, y + hi[1] * sv[1], z1], prop: name });
}

/** Лампа на потолке: светящаяся панель и источник света кабины. */
function lamp(ctx, buf, room, x, z, opts = {}) {
  const y = room.hi[1];
  const w = opts.w || 0.9, d = opts.d || 0.22;
  const [ax, az] = opts.alongX ? [w, d] : [d, w];
  buf.box([x - ax / 2, y - 0.05, z - az / 2], [x + ax / 2, y - 0.02, z + az / 2], C.lamp, CMAT.lamp, 1);
  ctx.lamps.push({
    pos: [x, y - 0.15, z], dir: [0, -1, 0], cos: Math.cos(80 * Math.PI / 180),
    color: opts.color || [0.95, 0.9, 0.8], range: opts.range || 3.4,
    room: room.id, kind: 'ceiling',
  });
}

function furnish(ctx) {
  const M = ctx.meshes;
  const y = INT.deck.mid;
  // --- кают-компания: камбуз по правому борту, стол и диван — по левому.
  const H = R.hall;
  let b = M.hall;
  const galley = ['cabinet', 'sink', 'cabinet', 'stove', 'cabinet', 'cabinet'];
  galley.forEach((name, i) => {
    const z = -16.0 - i * 0.9;
    prop(ctx, b, name, H.hi[0] - 0.55, y, z, -Math.PI / 2, F);
    prop(ctx, b, 'cabinetUpper', H.hi[0] - 0.32, y + 1.45, z, -Math.PI / 2, F, { solid: false });
  });
  prop(ctx, b, 'fridge', H.hi[0] - 0.52, y, -21.75, -Math.PI / 2, F);
  prop(ctx, b, 'coffee', H.hi[0] - 0.55, y + 0.9, -16.0, -Math.PI / 2, F, { solid: false });
  prop(ctx, b, 'microwave', H.hi[0] - 0.55, y + 0.9, -17.8, -Math.PI / 2, F, { solid: false });
  // Стол на шестерых — экипаж «Челленджера» с запасом на пассажиров.
  prop(ctx, b, 'table', -2.5, y, -18.8, Math.PI / 2, [F, F * 1.15, F]);
  for (const dz of [-0.55, 0.55]) {
    prop(ctx, b, 'chair', -3.25, y, -18.8 + dz, Math.PI / 2, F);
    prop(ctx, b, 'chair', -1.75, y, -18.8 + dz, -Math.PI / 2, F);
  }
  prop(ctx, b, 'sofa', -3.7, y, -22.6, Math.PI / 2, F);
  prop(ctx, b, 'coffeeTable', -2.65, y, -22.6, Math.PI / 2, F);
  prop(ctx, b, 'rug', -2.7, y + 0.004, -22.6, Math.PI / 2, F, { solid: false });
  prop(ctx, b, 'tv', -2.7, y + 1.2, H.lo[2] + 0.14, 0, F, { solid: false });
  prop(ctx, b, 'plant', -3.85, y, -15.45, 0, F);
  prop(ctx, b, 'trash', 3.85, y, -23.95, 0, F);
  lamp(ctx, b, H, -2.5, -18.8, { alongX: true });
  lamp(ctx, b, H, 2.6, -18.8);
  lamp(ctx, b, H, -2.5, -22.8, { alongX: true });
  lamp(ctx, b, H, 2.6, -23.2);

  // --- коридор: свет под потолком.
  b = M.corridor;
  for (const z of [-5.8, -9.5, -13.2]) lamp(ctx, b, R.corridor, 0, z, { alongX: true, w: 0.7, range: 3.0 });

  // --- каюта: двухъярусная койка вдоль борта, шкафчики, стол.
  const Cb = R.cabin;
  b = M.cabin;
  prop(ctx, b, 'bunk', Cb.lo[0] + 0.66, y, -12.6, 0, F);
  prop(ctx, b, 'locker', Cb.lo[0] + 0.36, y, -10.4, Math.PI / 2, F);
  prop(ctx, b, 'locker', Cb.lo[0] + 0.36, y, -9.6, Math.PI / 2, F);
  prop(ctx, b, 'desk', -2.85, y, Cb.hi[2] - 0.5, Math.PI, F);
  prop(ctx, b, 'screen', -2.85, y + 0.77, Cb.hi[2] - 0.33, Math.PI, F, { solid: false });
  prop(ctx, b, 'deskChair', -2.85, y, Cb.hi[2] - 1.15, 0, F);
  prop(ctx, b, 'sideTable', -2.4, y, Cb.lo[2] + 0.32, 0, F);
  prop(ctx, b, 'rug', -2.9, y + 0.004, -11.5, 0, [F * 0.8, F, F * 0.8], { solid: false });
  lamp(ctx, b, Cb, -2.85, -11.5, { range: 3.0 });

  // --- кладовая: стеллажи и ящики пака.
  const St = R.storage;
  b = M.storage;
  prop(ctx, b, 'shelfTall', St.lo[0] + 0.42, y, -6.0, Math.PI / 2, K);
  prop(ctx, b, 'shelf', -2.85, y, St.lo[2] + 0.42, 0, K);
  prop(ctx, b, 'crate', -3.55, y, St.hi[2] - 0.55, 0.3, K);
  prop(ctx, b, 'crate', -2.85, y, St.hi[2] - 0.5, -0.2, K);
  prop(ctx, b, 'crate', -3.55, y + 0.605, St.hi[2] - 0.55, 0.1, K);
  prop(ctx, b, 'vesselTall', -2.0, y, St.lo[2] + 0.45, 0, K);
  prop(ctx, b, 'vessel', -1.85, y, St.lo[2] + 0.8, 0, K);
  lamp(ctx, b, St, -2.85, -6.0, { range: 3.0 });

  // --- санузел.
  const W = R.washroom;
  b = M.washroom;
  prop(ctx, b, 'shower', W.hi[0] - 0.68, y, W.lo[2] + 0.68, -Math.PI / 2, F);
  prop(ctx, b, 'toilet', W.hi[0] - 0.6, y, -12.55, -Math.PI / 2, F);
  prop(ctx, b, 'washSink', 2.6, y, W.hi[2] - 0.4, Math.PI, F);
  prop(ctx, b, 'mirror', 2.6, y + 1.2, W.hi[2] - 0.2, Math.PI, F, { solid: false });
  prop(ctx, b, 'washer', 3.6, y, W.hi[2] - 0.5, Math.PI, F);
  lamp(ctx, b, W, 2.85, -12.9, { range: 2.8 });

  // --- медотсек: капсулы восстановления, пульт, стеллаж.
  const Md = R.medbay;
  b = M.medbay;
  prop(ctx, b, 'capsule', Md.hi[0] - 0.7, y, -9.6, -Math.PI / 2, K * 1.25);
  prop(ctx, b, 'capsule', Md.hi[0] - 0.7, y, -7.9, -Math.PI / 2, K * 1.25);
  prop(ctx, b, 'computer', Md.hi[0] - 0.55, y, -5.4, -Math.PI / 2, K);
  prop(ctx, b, 'shelf', 2.85, y, Md.hi[2] - 0.42, Math.PI, K);
  prop(ctx, b, 'vessel', 2.0, y, -10.3, 0, K);
  lamp(ctx, b, Md, 2.85, -8.6, { range: 3.0, color: [0.82, 0.9, 0.95] });
  lamp(ctx, b, Md, 2.85, -5.4, { range: 2.8, color: [0.82, 0.9, 0.95] });

  // --- машинное: два реактора по бортам, пульты у кормовой переборки.
  // Свет реактора — свой: им светит сама машина, и ярче она тогда, когда
  // работают движки (js/gl/cabin.js, kind 'reactor').
  const E = R.engine;
  b = M.engine;
  for (const sx of [-1, 1]) {
    prop(ctx, b, 'pod', sx * 2.7, y, -26.7, 0, K * 0.85);
    prop(ctx, b, 'computerSmall', sx * 0.95, y, E.lo[2] + 0.35, 0, K);
    ctx.lamps.push({
      pos: [sx * 2.7, y + 1.4, -26.7], dir: [0, -1, 0], cos: -2,
      color: [0.25, 0.6, 0.95], range: 2.2, room: 'engine', kind: 'reactor',
    });
  }
  lamp(ctx, b, E, 0, -26.7, { alongX: true, range: 3.2 });

  // --- трюм: пульт у кормовой переборки и свет вдоль прохода.
  const Hd = R.hold;
  b = M.hold;
  prop(ctx, b, 'computerSmall', 2.2, INT.deck.low, Hd.lo[2] + 0.35, 0, K);
  for (const z of [3.6, 7.6, 11.6]) lamp(ctx, b, Hd, 0, z, { w: 1.4, range: 4.2 });

  // --- шахты трапов.
  lamp(ctx, M.shaftA, R.shaftA, 0, -15.3, { alongX: true, w: 0.6, range: 3.2 });
  lamp(ctx, M.shaftA, R.shaftA, 0, -19.6, { alongX: true, w: 0.6, range: 3.6 });
  lamp(ctx, M.shaftB, R.shaftB, 0, -1.2, { alongX: true, w: 0.6, range: 4.0 });
}

// --- груз ----------------------------------------------------------------------
//
// Ящик пака, увеличенный до 1.13 м: тонна груза плотностью 0.7 т/м³ —
// это кубометр с небольшим. Сколько тонн в трюме, столько ящиков.
export const CRATE = { name: 'crate', scale: 1.4, tons: 1 };

/** Места под ящики: ряды вдоль бортов, в два яруса; проход посередине. */
export function crateSlots() {
  const Hd = R.hold;
  const s = 0.8 * CRATE.scale;           // ребро ящика, м
  const h = 0.806 * CRATE.scale;         // высота ящика, м
  const out = [];
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; ; i++) {
      const z = Hd.hi[2] - 0.2 - s / 2 - i * (s + 0.06);
      if (z - s / 2 < Hd.lo[2] + 2.6) break;
      for (const sx of [-1, 1]) {
        out.push({ x: sx * (Hd.hi[0] - 0.16 - s / 2), y: INT.deck.low + layer * (h + 0.005), z,
          yaw: hash(i + layer * 13, sx) * 0.12 - 0.06, half: s / 2, h });
      }
    }
  }
  return out;
}

// --- рубка: где можно ходить ---------------------------------------------------------
//
// Рубка — не коробка, а фонарь-клин. По каждой полосе вдоль корабля
// считается, сколько места остаётся на высоте от пола до макушки (и на
// полметра прыжка выше): стекло к верху сходится, и голова упёрлась бы в
// него раньше, чем ноги в борт.

function bridgeSolids(hullM, solids) {
  const yd = INT.deck.bridge;
  const bands = [[yd, yd + 0.8], [yd + 0.8, yd + 1.5], [yd + 1.5, yd + 2.1], [yd + 2.1, yd + 2.7]];
  const zFront = -5.6, zBack = INT.bulkZ;
  const step = 0.25;
  for (let z0 = zBack; z0 < zFront - 1e-6; z0 += step) {
    const z1 = Math.min(zFront, z0 + step);
    for (const [b0, b1] of bands) {
      let hw = Infinity;
      for (const zz of [z0 + 0.02, (z0 + z1) / 2, z1 - 0.02]) {
        const top = canopyTop(hullM, zz);
        for (const yy of [b0 + 0.02, (b0 + b1) / 2, b1 - 0.02]) {
          // Выше верха фонаря места нет вовсе, что бы ни нашлось сбоку.
          hw = Math.min(hw, yy > top - 0.03 ? 0 : canopyHalf(hullM, zz, yy));
        }
      }
      if (!isFinite(hw) || hw < 0) hw = 0;
      solids.push({ lo: [hw, b0, z0], hi: [hw + 3, b1, z1], bridge: true });
      solids.push({ lo: [-hw - 3, b0, z0], hi: [-hw, b1, z1], bridge: true });
    }
  }
  // Пол рубки, нос перед доской и пост пилота: доска, пульты, кресло.
  solids.push({ lo: [-4, yd - 0.5, zBack], hi: [4, yd, zFront + 1] });
  solids.push({ lo: [-4, yd - 0.5, zFront], hi: [4, yd + 3, zFront + 3] });
  solids.push({ lo: [-1.05, yd, -7.78], hi: [1.05, yd + 1.3, zFront], post: true });
}

/** Полуширина фонаря на (z, y): ближайшая к оси стенка корпуса. */
export function canopyHalf(hullM, z, y) {
  let best = Infinity;
  for (const [a, b] of hullM.segsAt(z)) {
    if ((a[1] - y) * (b[1] - y) > 0 || Math.abs(a[1] - b[1]) < 0.005) continue;
    const x = a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
    best = Math.min(best, Math.abs(x));
  }
  return best - 0.02;
}

/** Верх фонаря на оси: ближайшая обшивка над палубой рубки. */
function canopyTop(hullM, z) {
  let best = Infinity;
  for (const [a, b] of hullM.segsAt(z)) {
    if (a[0] * b[0] > 0 || Math.abs(a[0] - b[0]) < 1e-6) continue;
    const y = a[1] + (b[1] - a[1]) * (0 - a[0]) / (b[0] - a[0]);
    if (y > INT.deck.bridge + 0.3) best = Math.min(best, y);
  }
  return best;
}

/** Корпус в метрах модели с сечениями по z (кешируются). */
export function hullMeters(hull) {
  const verts = hull.verts.map((v) => ({ x: v.x * 1000, y: v.y * 1000, z: v.z * 1000 }));
  const out = { verts, faces: hull.faces, cache: new Map() };
  out.segsAt = (z0) => {
    const key = Math.round(z0 * 100);
    if (out.cache.has(key)) return out.cache.get(key);
    const segs = [];
    for (const f of hull.faces) {
      const P = f.v.map((i) => verts[i]);
      const cut = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        if ((a.z - z0) * (b.z - z0) < 0) {
          const t = (z0 - a.z) / (b.z - a.z);
          cut.push([a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t]);
        }
      }
      if (cut.length >= 2) segs.push(cut);
    }
    out.cache.set(key, segs);
    return segs;
  };
  return out;
}

// --- твёрдое: стены, пол, потолок ---------------------------------------------------

/** Стены, пол и потолок комнаты — плиты от лица наружу, на полперегородки. */
function roomSolids(room, faces, solids) {
  const th = INT.gap / 2;
  for (const f of faces) {
    // Переборку рубки (передняя стенка шахты A) делает сама рубка.
    if (room.id === 'shaftA' && f.side === 'z+') continue;
    for (const r of subtract({ u: f.u, v: f.v }, f.holes)) {
      const lo = [0, 0, 0], hi = [0, 0, 0];
      if (f.ax === 1) {
        lo[0] = r.u[0]; hi[0] = r.u[1]; lo[2] = r.v[0]; hi[2] = r.v[1];
        if (f.side === 'y+') { lo[1] = f.at; hi[1] = f.at + 0.5; } else { lo[1] = f.at - 0.5; hi[1] = f.at; }
      } else {
        lo[f.uAx] = r.u[0]; hi[f.uAx] = r.u[1]; lo[1] = r.v[0]; hi[1] = r.v[1];
        // От лица наружу — и на десять сантиметров внутрь: цоколь детали
        // пака выступает в комнату.
        if (f.n[f.ax] > 0) { lo[f.ax] = f.at - th; hi[f.ax] = f.at + 0.1; } else { lo[f.ax] = f.at - 0.1; hi[f.ax] = f.at + th; }
      }
      solids.push({ lo, hi, wall: room.id });
    }
  }
}

/** Переборка рубки как твёрдое тело: две половины по бокам двери и перемычка. */
function bulkheadSolids(solids) {
  const z0 = INT.bulkZ - INT.bulkT - 0.05, z1 = INT.bulkZ + 0.05;
  const dh = INT.doorHalf, yd = INT.deck.bridge, top = yd + INT.doorTop;
  solids.push({ lo: [-4, yd - 0.5, z0], hi: [-dh, 4, z1] });
  solids.push({ lo: [dh, yd - 0.5, z0], hi: [4, 4, z1] });
  solids.push({ lo: [-dh, top, z0], hi: [dh, 4, z1] });
  // Площадка трапа за дверью.
  solids.push({ lo: [-0.8, yd - 0.3, STAIRS[0].zTop], hi: [0.8, yd, INT.bulkZ - INT.bulkT] });
}

// --- сборка ----------------------------------------------------------------------

/**
 * Собрать помещения по корпусу.
 *
 * @param hull корпус (js/models/ships.js, в километрах)
 */
export function buildInterior(hull) {
  const hullM = hullMeters(hull);
  const faces = layoutFaces();
  const ctx = { meshes: {}, lamps: [], solids: [], columns: new Set() };
  for (const r of ROOMS) ctx.meshes[r.id] = new MeshBuf();

  // Рубка: переборка с дверью по сечению фонаря.
  buildBulkhead(ctx.meshes.bridge, canopyProfile(hullM, INT.bulkZ + 0.05));
  bridgeSolids(hullM, ctx.solids);
  bulkheadSolids(ctx.solids);

  for (const r of ROOMS) {
    if (r.kind === 'bridge') continue;
    const buf = ctx.meshes[r.id];
    const rf = faces[r.id];
    for (const f of rf) {
      if (r.id === 'shaftA' && f.side === 'z+') continue;     // это переборка рубки
      if (f.ax === 1) {
        // Пол шахты — ступени (у шахты B пол под трапом кладётся ниже).
        if (r.kind === 'shaft' && f.side === 'y-') continue;
        buildFlat(buf, f);
      } else {
        buildWall(ctx, buf, r, f);
      }
    }
    // Колонны по углам: стык двух стен пака открыт, колонна его прячет.
    if (r.kind !== 'shaft') {
      for (const x of [r.lo[0], r.hi[0]]) {
        for (const z of [r.lo[2], r.hi[2]]) column(ctx, buf, 'column', x, r.lo[1], z, r.hi[1] - r.lo[1]);
      }
    }
    roomSolids(r, rf, ctx.solids);
  }

  // Площадка трапа A и её торец над потолком кают-компании.
  const sA = STAIRS[0];
  const land = ctx.meshes.shaftA;
  buildFlat(land, { side: 'y-', at: INT.deck.bridge, u: [-0.8, 0.8], v: [sA.zTop, INT.bulkZ - INT.bulkT], holes: [] });
  land.poly([[-0.8, CEIL_MID, sA.zTop], [0.8, CEIL_MID, sA.zTop], [0.8, INT.deck.bridge - 0.05, sA.zTop],
    [-0.8, INT.deck.bridge - 0.05, sA.zTop]], C.steel, CMAT.paint);
  // Пол шахты B под трапом.
  buildFlat(ctx.meshes.shaftB, { side: 'y-', at: INT.deck.low, u: [-0.8, 0.8], v: [R.shaftB.lo[2], R.shaftB.hi[2]], holes: [] });
  for (const s of STAIRS) buildStair(ctx.meshes[s.room], ctx.solids, s);

  furnish(ctx);

  // Двери: створка пака в тоннеле рамы, едет вбок вдоль стены.
  const doors = DOORS.map((d) => {
    const f = faces[d.a].find((ff) => ff.doors && ff.doors.some((x) => x.id === d.id));
    const t = tangentOf(f.n);
    return {
      id: d.id, rooms: [d.a, d.b], pos: d.pos, ax: d.ax,
      origin: wallPoint(f, d.c, d.y, FACE * K), tangent: t,
      ux: t.map((c) => c * K), uy: [0, K, 0], uz: f.n.map((c) => c * K),
      slide: 1.674 * K, half: 1.674 * K / 2, height: INT.doorTop, open: 0, want: 0,
    };
  });
  // Порог: в толщине перегородки пола нет ни у одной из двух комнат, и
  // без него пилот проваливался в зазор между ними.
  for (const d of DOORS) {
    const lo = [0, d.y - 0.5, 0], hi = [0, d.y, 0];
    const t = d.ax === 0 ? 2 : 0;
    lo[d.ax] = Math.min(d.at, d.at + d.s * INT.gap) - 0.05; hi[d.ax] = Math.max(d.at, d.at + d.s * INT.gap) + 0.05;
    lo[t] = d.c - INT.doorHalf - 0.05; hi[t] = d.c + INT.doorHalf + 0.05;
    ctx.solids.push({ lo, hi, sill: d.id });
  }
  ctx.solids.push({ lo: [-INT.doorHalf - 0.05, INT.deck.bridge - 0.5, INT.bulkZ - INT.bulkT - 0.05],
    hi: [INT.doorHalf + 0.05, INT.deck.bridge, INT.bulkZ + 0.05], sill: 'bridge' });
  // Дверь рубки: та же створка пака под проём переборки (1.13 × 1.97 м
  // плюс по пять сантиметров на раму), в толщине переборки.
  const bw = 2 * INT.doorHalf + 0.1, bsx = bw / 1.674, bsy = INT.doorTop / 2.79, bsz = 0.4;
  doors.push({
    id: 'bridge', rooms: ['bridge', 'shaftA'], ax: 2,
    pos: [0, INT.deck.bridge, INT.bulkZ - INT.bulkT / 2],
    origin: [0, INT.deck.bridge, INT.bulkZ - INT.bulkT / 2 + 0.4175 * bsz], tangent: [1, 0, 0],
    ux: [bsx, 0, 0], uy: [0, bsy, 0], uz: [0, 0, bsz],
    slide: bw, half: bw / 2, height: INT.doorTop, open: 0, want: 0,
  });

  // Вырез корпуса: всё, где стоят комнаты (кроме рубки), — по ярусам.
  const carve = [
    { lo: [-4.25, INT.deck.mid - 0.05, -28.45], hi: [4.25, CEIL_MID + 0.05, -3.95] },
    { lo: [-4.25, INT.deck.low - 0.05, 1.35], hi: [4.25, CEIL_LOW + 0.05, 15.45] },
    { lo: [-0.85, CEIL_MID - 0.05, -22.05], hi: [0.85, 2.5, INT.bulkZ - INT.bulkT + 0.02] },
    { lo: [-0.85, INT.deck.low - 0.05, -4.0], hi: [0.85, -2.7, 1.45] },
  ];

  // Рубка — единственное место, куда попадает свет снаружи: стекло
  // только здесь. Остальные помещения закрыты, и солнце, небо и отсвет
  // планеты в них не входят — иначе карта теней (а она покрывает лишь
  // рубку) пускала бы солнце сквозь переборки.
  const sunBox = { lo: [-4.5, -0.6, INT.bulkZ - 0.02], hi: [4.5, 5.5, 6] };

  // Створка двери и ящик груза — по одной сетке на всех, в своих осях:
  // их ставит и двигает рисование (js/gl/cabin.js).
  const doorMesh = new MeshBuf();
  doorMesh.part('door', [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const crateMesh = new MeshBuf();
  crateMesh.part(CRATE.name, [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);

  const out = {
    INT, rooms: ROOMS, roomById: R, faces, meshes: ctx.meshes, doors, lamps: ctx.lamps, solids: ctx.solids,
    carve, sunBox, stairs: STAIRS, slots: crateSlots(), crate: CRATE, hullM, doorMesh, crateMesh,
    roomAt,
    // Сколько ящиков в трюме и как горят реакторы — ставит игра.
    cargo: 0,
    reactor: 0,
    // Кресло: глаз сидящего — глаз пилота; встав, он оказывается за
    // креслом, лицом вперёд. Сесть можно, стоя за креслом.
    seat: {
      eye: [EYE.x, EYE.y, EYE.z], stand: [0, INT.deck.bridge, -8.55],
      zone: { lo: [-1.4, -0.5, -10.0], hi: [1.4, 2.6, -7.75] },
    },
  };
  out.visibleNow = (id) => visibleNow(id, doors);
  return out;
}

/** В какой комнате точка (оси корабля, м); в проёме двери — в комнате a. */
export function roomAt(p) {
  for (const r of ROOMS) {
    if (r.kind === 'bridge') continue;
    if (p[0] >= r.lo[0] - 0.05 && p[0] <= r.hi[0] + 0.05 && p[1] >= r.lo[1] - 0.3
      && p[1] <= r.hi[1] + 0.05 && p[2] >= r.lo[2] - 0.05 && p[2] <= r.hi[2] + 0.05) return r;
  }
  if (p[2] >= INT.bulkZ - 0.05 && p[2] <= -4 && p[1] >= INT.deck.bridge - 0.3 && Math.abs(p[0]) < 4) return R.bridge;
  for (const d of DOORS) {
    if (!d.pos) continue;
    if (Math.abs(p[d.ax] - d.pos[d.ax]) <= INT.gap / 2 + 0.05
      && Math.abs(p[d.ax === 0 ? 2 : 0] - d.c) <= INT.doorHalf && p[1] >= d.y - 0.3 && p[1] <= d.y + 2.2) return R[d.a];
  }
  return null;
}

// Соседство комнат: через проёмы и двери.
const ADJ = (() => {
  const adj = {};
  for (const r of ROOMS) adj[r.id] = new Set();
  const link = (a, b) => { adj[a].add(b); adj[b].add(a); };
  for (const o of OPENINGS) link(o.a, o.b);
  for (const d of DOORS) link(d.a, d.b);
  link('bridge', 'shaftA');
  return adj;
})();
const SEEN = new Map();

/**
 * Комнаты, видимые из данной: она сама и всё в два шага через проёмы и
 * двери. Стены непрозрачны, и дальше двух проёмов взгляд не проходит —
 * рисовать остальное значит рисовать за стеной.
 */
export function visibleFrom(id) {
  if (SEEN.has(id)) return SEEN.get(id);
  const out = new Set([id]);
  for (const n of ADJ[id] || []) {
    out.add(n);
    for (const m of ADJ[n]) out.add(m);
  }
  const list = [...out];
  SEEN.set(id, list);
  return list;
}

/**
 * То же, но с дверями как есть: за закрытой дверью комнаты не видно, и
 * рисовать её незачем. Двери открываются, только когда к ним подходят, —
 * так что обычно видна одна-две комнаты из одиннадцати.
 */
export function visibleNow(id, doors) {
  const open = new Set();
  for (const d of doors) if (d.open > 0.01) open.add(d.rooms[0] + '|' + d.rooms[1]);
  const passable = (a, b) => {
    if (OPEN_LINKS.has(a + '|' + b) || OPEN_LINKS.has(b + '|' + a)) return true;
    return open.has(a + '|' + b) || open.has(b + '|' + a);
  };
  const out = new Set([id]);
  for (const n of ADJ[id] || []) {
    if (!passable(id, n)) continue;
    out.add(n);
    for (const m of ADJ[n]) if (passable(n, m)) out.add(m);
  }
  return [...out];
}

const OPEN_LINKS = new Set(OPENINGS.map((o) => o.a + '|' + o.b));

export { R as ROOM_BY_ID, CEIL_MID, CEIL_LOW };
