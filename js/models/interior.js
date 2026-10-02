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
//   нижняя палуба (−9.0)     — грузовой трюм под носом, носовой шлюз,
//                              нижний коридор под средней палубой;
//   палуба гондол (−8.05)    — бортовой шлюз поперёк корабля, от гондолы
//                              до гондолы.
//
// ШЛЮЗЫ. Снаружи на корпусе четыре утопленные панели в рост человека и
// выше: у носа по бортам и на внешних стенках гондол. Это и есть люки
// (HATCHES): их края сняты с самой модели, и проверка сверяет их с ней.
// За носовыми — носовой шлюз (из трюма), за бортовыми — бортовой (из
// нижнего коридора, на пять ступеней выше: пол гондол выше днища). Как
// шлюз открывается и где выдвигается трап — js/game/airlock.js.
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
//
// ПЛАН. Корабль — это план (makePlan): комнаты, трапы, двери, люки, окна,
// проёмы, мебель, коробки выреза и кресло. Сборщик (buildInterior) один на
// все типы: стены, полы, двери, трапы, люки и твёрдое он кладёт по плану,
// а что у корабля своё (переборка рубки «Челленджера», лифт «Прометея»),
// — делают крючки плана (special, furnish). План «Челленджера» — здесь же
// (CHALLENGER), «Прометея» — js/models/interior.prom.js.

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
  deck: { bridge: 0.2, mid: -4.94, low: -9.0, lock: -8.05 },
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
// Бортовой шлюз — в гондолах, а гондола изнутри ниже стены пака: от пола
// на высоте люка до потолка 2.4 м (стены пака ужаты по высоте на 0.72).
const CEIL_LOCK = -5.65;

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

/**
 * Сетка, которая ничего не копит: проход сборки «без геометрии». Им
 * собирается всё, кроме нужной комнаты, — твёрдое, лампы и двери
 * считаются как обычно, а грани не кладутся никуда (ленивые планы,
 * buildInterior).
 */
class DryBuf extends MeshBuf {
  poly() {}
  part() {}
  box() {}
  beam() {}
}
const DRY = new DryBuf();

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
  // Трюм — до носового шлюза; шире средней палубы на тридцать сантиметров
  // с борта (обшивка носа — на 4.96): иначе ящики крайнего ряда закрыли
  // бы дверь в нижний коридор.
  { id: 'hold', name: 'ГРУЗОВОЙ ТРЮМ', lo: [-4.5, INT.deck.low, 1.4], hi: [4.5, CEIL_LOW, 12.6] },
  // Шлюзы и дорога к ним.
  { id: 'lockN', name: 'НОСОВОЙ ШЛЮЗ', kind: 'lock', lo: [-4.2, INT.deck.low, 13.2], hi: [4.2, CEIL_LOW, 17.3] },
  { id: 'keel', name: 'НИЖНИЙ КОРИДОР', lo: [1.4, INT.deck.low, -10.3], hi: [4.0, CEIL_LOW, 0.8] },
  { id: 'lockS', name: 'БОРТОВОЙ ШЛЮЗ', kind: 'lock', lo: [-14.0, INT.deck.lock, -14.4], hi: [14.0, CEIL_LOCK, -10.9] },
];
const R = Object.fromEntries(ROOMS.map((r) => [r.id, r]));

// Трапы: верх (z, y), куда идут (−1 — к корме, +1 — к носу) и низ.
export const STAIRS = [
  // Из-за переборки рубки вниз к корме, в кают-компанию.
  { id: 'A', x: 0, zTop: -16.1, yTop: INT.deck.bridge, yBot: INT.deck.mid, dir: -1, room: 'shaftA', to: 'hall' },
  // Из носа коридора вниз к носу, в трюм.
  { id: 'B', x: 0, zTop: -4.0, yTop: INT.deck.mid, yBot: INT.deck.low, dir: 1, room: 'shaftB', to: 'hold' },
  // Из нижнего коридора к бортовому шлюзу: палуба гондол выше нижней
  // палубы на пять ступеней (0.95 м).
  { id: 'C', x: 2.6, zTop: -10.3, yTop: INT.deck.lock, yBot: INT.deck.low, dir: 1, room: 'keel', to: 'keel' },
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
  // Двери шлюзов — обычные: шлюз их не запирает (пилот в скафандре,
  // js/game/airlock.js). Дверь бортового шлюза — на верхней ступени трапа
  // (y) и собрана кодом (code): стена пака выше гондолы на метр, и сквозь
  // потолок она вылезла бы в медотсек.
  { id: 'lockN', a: 'hold', b: 'lockN', c: 0 },
  { id: 'keel', a: 'hold', b: 'keel', c: 2.6 },
  { id: 'lockS', a: 'keel', b: 'lockS', c: 2.6, y: INT.deck.lock, code: true },
];

// Люки — утопленные панели обшивки (оси корабля, м): skin — обшивка у
// люка, inset — сама панель, z и y — её края. Сняты с модели
// (js/models/hull.data.js) и сверены с ней проверкой. Проём в стене
// шлюза — по ним же; trap — куда выдвигается трап: наружу по борту.
export const HATCHES = [
  { id: 'nL', lock: 'lockN', side: -1, skin: 4.959, inset: 4.816, z: [13.788, 16.852], y: [-8.837, -5.037], rgb: [98, 96, 94] },
  { id: 'nR', lock: 'lockN', side: 1, skin: 4.959, inset: 4.816, z: [13.788, 16.852], y: [-8.837, -5.037], rgb: [98, 96, 94] },
  { id: 'sL', lock: 'lockS', side: -1, skin: 14.605, inset: 14.462, z: [-14.206, -11.142], y: [-7.971, -6.108], rgb: [59, 57, 55] },
  { id: 'sR', lock: 'lockS', side: 1, skin: 14.605, inset: 14.462, z: [-14.206, -11.142], y: [-7.971, -6.108], rgb: [59, 57, 55] },
];

// Окна: проём в боковой стене комнаты, откос до обшивки и стекло у её
// края. Стоят там, где от стены до обшивки рукой подать и за обшивкой
// открыто: на бортах трюма (46 см), у каюты и медотсека и у переднего
// торца кают-компании (1.66 м). Остальные стены смотрят в крылья и
// гондолы: по бортам кают-компании за обшивкой ещё шесть метров корпуса.
// side — борт (−1 левый, x−; +1 правый, x+), c — середина по длине (z),
// y — низ от пола комнаты, w × h — проём, м. Глубину откоса меряет сборка
// по самому корпусу (fitWindows); окно, за которым не открыто, не ставится.
// Места выбраны и по мебели: правый борт кают-компании весь занят
// камбузом с навесными шкафами, в каюте у борта койка и шкафчики (окно —
// над койкой), в медотсеке — между капсулами.
export const WINDOWS = [
  { id: 'cabin', room: 'cabin', side: -1, c: -12.6, y: 1.78, w: 1.2, h: 0.55 },
  { id: 'medbay', room: 'medbay', side: 1, c: -8.75, y: 1.0, w: 0.8, h: 0.75 },
  { id: 'hall', room: 'hall', side: -1, c: -16.2, y: 0.95, w: 1.0, h: 0.85 },
  // В трюме — под потолком: вдоль бортов ящики в два яруса, до 2.26 м.
  { id: 'holdL', room: 'hold', side: -1, c: 9.5, y: 2.35, w: 2.2, h: 0.55 },
  { id: 'holdR', room: 'hold', side: 1, c: 9.5, y: 2.35, w: 2.2, h: 0.55 },
];

// Дальше этого откос не тянут, м: окно в толще корпуса глубже — бойница.
const WIN_DEPTH = 2.5;

/**
 * Примерить окна к корпусу: у каждого угла проёма — до обшивки по
 * нормали стены (последняя грань корпуса в пределах WIN_DEPTH), и дальше,
 * до восьми метров, корпуса быть не должно: окно в крыло не нужно.
 * @returns окна с глубиной откоса у углов: [u0v0, u1v0, u1v1, u0v1], м
 */
function fitWindows(P, hullM) {
  const T = [];
  for (const f of hullM.faces) {
    for (let k = 1; k + 1 < f.v.length; k++) {
      const a = hullM.verts[f.v[0]], b = hullM.verts[f.v[k]], c = hullM.verts[f.v[k + 1]];
      T.push([a.x, a.y, a.z, b.x - a.x, b.y - a.y, b.z - a.z, c.x - a.x, c.y - a.y, c.z - a.z]);
    }
  }
  // Пересечения луча (o, вдоль оси ax со знаком s) с корпусом — расстояния.
  const hits = (o, s, ax = 0) => {
    const out = [];
    const d = [0, 0, 0];
    d[ax] = s;
    for (const t of T) {
      const e1 = [t[3], t[4], t[5]], e2 = [t[6], t[7], t[8]];
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-12) continue;
      const sv = [o[0] - t[0], o[1] - t[1], o[2] - t[2]];
      const u = (sv[0] * p[0] + sv[1] * p[1] + sv[2] * p[2]) / det;
      if (u < 0 || u > 1) continue;
      const q = [sv[1] * e1[2] - sv[2] * e1[1], sv[2] * e1[0] - sv[0] * e1[2], sv[0] * e1[1] - sv[1] * e1[0]];
      const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
      if (tt > 1e-4 && tt < 8) out.push(tt);
    }
    return out;
  };
  const out = [];
  for (const w of P.windows) {
    const r = P.R[w.room];
    // Стена окна: боковая (ax 0, u — по z) или торцевая (ax 2, u — по x).
    const ax = w.ax || 0, uAx = ax === 0 ? 2 : 0;
    const at = w.side < 0 ? r.lo[ax] : r.hi[ax];
    const u0 = w.c - w.w / 2, u1 = w.c + w.w / 2, v0 = r.lo[1] + w.y, v1 = v0 + w.h;
    const depth = [];
    for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) {
      // Угол — чуть внутри проёма: ребро корпуса ровно по углу не в счёт.
      const o = [0, v + (v === v0 ? 0.03 : -0.03), 0];
      o[ax] = at;
      o[uAx] = u + (u === u0 ? 0.03 : -0.03);
      const h = hits(o, w.side, ax);
      const skin = Math.max(-1, ...h.filter((t) => t <= WIN_DEPTH));
      if (skin < 0 || h.some((t) => t > skin + 0.08)) { depth.length = 0; break; }
      depth.push(skin);
    }
    if (depth.length === 4) out.push({ ...w, ax, at, u0, u1, v0, v1, depth });
  }
  return out;
}

// Дверь, собранная кодом: проём пака (1.13 × 1.97 м) в стальной панели,
// косяки по четверть метра.
const CODE_DOOR = { jamb: 0.25 };

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

/** Трапы: число подъёмов, подъём и нижний край марша — по ярусам. */
export function deriveStairs(stairs) {
  for (const s of stairs) {
    if (s.n) continue;
    s.n = Math.round((s.yTop - s.yBot) / INT.rise);
    s.r = (s.yTop - s.yBot) / s.n;
    // Ступеней n − 1: последний подъём — это уже пол нижней палубы.
    s.zBot = s.zTop + s.dir * (s.n - 1) * INT.tread;
  }
  return stairs;
}

/**
 * План корабля: планировка и всё, что из неё выводится.
 *
 * def: code — тип корпуса; rooms, stairs, doors, hatches, windows,
 * openings — как у «Челленджера» ниже; links — пары комнат, связанных
 * не проёмом и не дверью из списка (дверь переборки рубки); крючки:
 * special(ctx, faces, hullM) — своё (переборки, площадки трапов),
 * extraDoors(ctx) — двери, собранные не по DOORS, skipFace(room, f) —
 * грань комнаты, которую делает не она, roomAtExtra(p) — места не-коробки,
 * furnish(ctx) — мебель и лампы; carve, sunBox, seat, origin — как в
 * выходе buildInterior; slots() и crate — груз.
 */
export function makePlan(def) {
  const P = { links: [], windows: [], openings: [], hatches: [], lifts: [], ...def };
  P.R = Object.fromEntries(P.rooms.map((r) => [r.id, r]));
  deriveStairs(P.stairs);
  // Проходы для воздуха без дверей (js/game/airlock.js): проёмы — с
  // площадью сечения, м². Двери считает сам шлюз.
  P.airways = P.openings.map((o) => {
    if (o.ceil) return { a: o.a, b: o.b, area: (o.x[1] - o.x[0]) * (o.z[1] - o.z[0]) };
    const A = P.R[o.a], B = P.R[o.b];
    const y = o.y || [Math.max(A.lo[1], B.lo[1]), Math.min(A.hi[1], B.hi[1])];
    return { a: o.a, b: o.b, area: (o.u[1] - o.u[0]) * (y[1] - y[0]) };
  });
  // Соседство комнат: через проёмы и двери.
  const adj = {};
  for (const r of P.rooms) adj[r.id] = new Set();
  const link = (a, b) => { adj[a].add(b); adj[b].add(a); };
  for (const o of P.openings) link(o.a, o.b);
  for (const d of P.doors) link(d.a, d.b);
  for (const [a, b] of P.links) link(a, b);
  P.adj = adj;
  P.openLinks = new Set(P.openings.map((o) => o.a + '|' + o.b));
  P.doorById = Object.fromEntries(P.doors.map((d) => [d.id, d]));
  P.seen = new Map();
  return P;
}

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
  // Крупность отделки — у комнаты (tile, plain): большим залам «Прометея»
  // хватает плитки покрупнее и гладких стен почаще (см. ROOM_FINISH).
  const fin = { tile: room.tile || INT.tile, plain: room.plain || 0 };
  const wall = (side, ax, at, n, u, uAx) => ({ side, ax, at, n, u, uAx, v: [y0, y1], holes: [], doors: [], ...fin });
  return [
    wall('x-', 0, x0, [1, 0, 0], [z0, z1], 2),
    wall('x+', 0, x1, [-1, 0, 0], [z0, z1], 2),
    wall('z-', 2, z0, [0, 0, 1], [x0, x1], 0),
    wall('z+', 2, z1, [0, 0, -1], [x0, x1], 0),
    { side: 'y-', ax: 1, at: y0, n: [0, 1, 0], u: [x0, x1], v: [z0, z1], holes: [], ...fin },
    { side: 'y+', ax: 1, at: y1, n: [0, -1, 0], u: [x0, x1], v: [z0, z1], holes: [], ...fin },
  ];
}

const faceOf = (faces, ax, s) => faces.find((f) => f.ax === ax && f.side.endsWith(s > 0 ? '+' : '-'));

/** Грани всех комнат плана; проёмы и двери разложены по ним. */
function layoutFaces(P, wins = []) {
  const Fs = {};
  const R = P.R;
  for (const r of P.rooms) Fs[r.id] = roomFaces(r);
  for (const o of P.openings) {
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
  for (const d of P.doors) {
    const a = R[d.a], b = R[d.b];
    const sf = sharedFace(a, b);
    if (!sf) throw new Error('дверь ' + d.id + ': комнаты не соседи');
    if (Math.abs(sf.gap - INT.gap) > 1e-6) throw new Error('дверь ' + d.id + ': перегородка не ' + INT.gap + ' м');
    const fa = faceOf(Fs[d.a], sf.ax, sf.s), fb = faceOf(Fs[d.b], sf.ax, -sf.s);
    // Порог — на полу комнаты A; у двери бортового шлюза — на верхней
    // ступени трапа (DOORS, y).
    const y = d.y !== undefined ? d.y : a.lo[1];
    const hole = { u: [d.c - INT.doorHalf, d.c + INT.doorHalf], v: [y, y + INT.doorTop], door: d.id };
    fa.holes.push({ ...hole, to: d.b }); fb.holes.push({ ...hole, to: d.a });
    fa.doors.push({ id: d.id, c: d.c, side: 'A', code: !!d.code, y });
    fb.doors.push({ id: d.id, c: d.c, side: 'B', code: !!d.code, y });
    d.ax = sf.ax; d.s = sf.s; d.at = sf.at; d.y = y;
    // Середина проёма в перегородке — по ней работает автоматика двери.
    d.pos = [0, y, 0];
    d.pos[sf.ax] = sf.at + sf.s * INT.gap / 2;
    d.pos[sf.ax === 0 ? 2 : 0] = d.c;
  }
  // Люки: проём в боковой стене шлюза — по краям панели обшивки, но не
  // выше потолка (у носового люка панель выше шлюза: над проёмом снаружи
  // ставится перемычка, buildHatch).
  for (const h of P.hatches) {
    const r = R[h.lock];
    faceOf(Fs[h.lock], 0, h.side).holes.push({
      u: [h.z[0], h.z[1]], v: [Math.max(r.lo[1], h.y[0]), Math.min(r.hi[1], h.y[1])], hatch: h.id, to: 'out',
    });
  }
  // Окна: проём в боковой стене (откос и рама — buildWindow).
  for (const w of wins) {
    faceOf(Fs[w.room], w.ax || 0, w.side).holes.push({ u: [w.u0, w.u1], v: [w.v0, w.v1], window: w.id, win: w, to: 'out' });
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
      // Доля гладких сверх рисунка (f.plain): у длинной стены рельефная
      // деталь через одну — это тысячи граней на метр без пользы.
      const plain = f.plain && hash(seed + i * 3.7, f.at + r * 1.9) < f.plain;
      const pick = plain || w < INT.wallW * 0.6 || h < INT.wallH * 0.6 ? 'wallPlain'
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

/** Брусок вдоль стены: u, v — по стене, d — от лица в комнату (м). */
function wallBox(buf, f, u0, u1, v0, v1, d0, d1, rgb, mat, em = 0) {
  const a = wallPoint(f, u0, v0, d0), b = wallPoint(f, u1, v1, d1);
  buf.box([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])], rgb, mat, em);
}

/**
 * Дверь, собранная кодом (DOORS, code): проём пака в стальной панели,
 * янтарная рама, над ней — табличка с лампой. Со стороны A — ещё и
 * тоннель сквозь перегородку (у двери пака его даёт сама деталь
 * doorWallA): щёки, потолок и порог с кромкой «осторожно».
 */
function codeDoor(buf, f, d, u0, u1, y0, y1, frame = null) {
  const dh = INT.doorHalf, top = d.y + INT.doorTop;
  panel(buf, f, u0, d.c - dh, y0, y1);
  panel(buf, f, d.c + dh, u1, y0, y1);
  if (top < y1 - 0.01) panel(buf, f, d.c - dh, d.c + dh, top, y1);
  if (d.y > y0 + 0.01) panel(buf, f, d.c - dh, d.c + dh, y0, d.y);
  const fw = 0.1;
  wallBox(buf, f, d.c - dh - fw, d.c - dh, d.y, top, -0.02, 0.04, C.accent, CMAT.paint);
  wallBox(buf, f, d.c + dh, d.c + dh + fw, d.y, top, -0.02, 0.04, C.accent, CMAT.paint);
  wallBox(buf, f, d.c - dh - fw, d.c + dh + fw, top, top + fw, -0.02, 0.04, C.accent, CMAT.paint);
  if (top + 0.42 < y1) {
    wallBox(buf, f, d.c - 0.3, d.c + 0.3, top + 0.2, top + 0.32, 0.005, 0.02, C.dark, CMAT.trim);
    wallBox(buf, f, d.c - 0.16, d.c + 0.16, top + 0.35, top + 0.39, 0.005, 0.03, C.lamp, CMAT.lamp, 1);
  }
  if (d.side !== 'A') return;
  const g = -INT.gap;
  const P = (u, v, w) => wallPoint(f, u, v, w);
  // Тоннель в толщине перегородки — и в комнату, и в раму двери (frame).
  for (const b of frame ? [buf, frame] : [buf]) {
    b.poly([P(d.c - dh, d.y, 0), P(d.c - dh, d.y, g), P(d.c - dh, top, g), P(d.c - dh, top, 0)], C.steel, CMAT.paint);
    b.poly([P(d.c + dh, d.y, 0), P(d.c + dh, top, 0), P(d.c + dh, top, g), P(d.c + dh, d.y, g)], C.steel, CMAT.paint);
    b.poly([P(d.c - dh, top, 0), P(d.c - dh, top, g), P(d.c + dh, top, g), P(d.c + dh, top, 0)], C.steel, CMAT.paint);
    b.poly([P(d.c - dh, d.y + 0.004, 0), P(d.c + dh, d.y + 0.004, 0), P(d.c + dh, d.y + 0.004, g),
      P(d.c - dh, d.y + 0.004, g)], C.hazard, CMAT.hazard);
  }
}

/**
 * Рама двери — отдельной сеткой (interior.doorFrames).
 *
 * Рама с тоннелем стоит на стене комнаты a, а со стороны b в стене только
 * проём. Комната за закрытой дверью не рисуется (visibleNow), и из b рама
 * пропадала вместе с комнатой a: вокруг створки светилась щель в толщину
 * перегородки, сверху торчал её короб. Открылась дверь — комната a снова
 * видна, а с ней и рама. Теперь рама есть и сама по себе: её рисуют, когда
 * видна комната b, а комната a — нет (js/gl/cabin.js).
 */
function frameOf(ctx, id) {
  // Ленивый проход (ctx.target — комната или 'frame:<дверь>'): рама
  // настоящая только у той, ради которой он идёт.
  if (ctx.target !== '*') {
    const d = ctx.P.doorById[id];
    if (ctx.target !== 'frame:' + id && !(d && d.a === ctx.target)) return DRY;
  }
  return ctx.frames[id] || (ctx.frames[id] = new MeshBuf());
}

/**
 * Силуэт створки пака: полуширина |x| на каждой высоте, единицы модели.
 * Строки — через сантиметр: на скосе 45° это сантиметр же.
 */
function leafSilhouette(mesh) {
  const P = mesh.pos;
  let H = 0;
  for (let i = 1; i < P.length; i += 3) H = Math.max(H, P[i]);
  const n = Math.ceil(H / 0.01), rows = [];
  for (let k = 0; k <= n; k++) {
    const y = Math.min(H - 1e-4, Math.max(1e-4, k * H / n));
    let s = 0;
    for (let i = 0; i + 8 < P.length; i += 9) {
      for (let e = 0; e < 3; e++) {
        const a = i + e * 3, b = i + ((e + 1) % 3) * 3;
        const ya = P[a + 1], yb = P[b + 1];
        if ((ya - y) * (yb - y) > 0 || ya === yb) continue;
        s = Math.max(s, Math.abs(P[a] + (P[b] - P[a]) * (y - ya) / (yb - ya)));
      }
    }
    rows.push([k * H / n, s]);
  }
  return { H, rows };
}

/**
 * Вставка вокруг створки в прямоугольном проёме (кодовая дверь, дверь
 * рубки).
 *
 * Створка — пака, а проём под неё собран кодом и прямоугольный, а у
 * створки верх уже низа (0.762 против 0.837 модели) и углы скошены под
 * 45°. В верхних углах проёма оставались треугольные щели (у двери
 * бортового шлюза — 19 × 17 см) и щель в полсантиметра вдоль боков.
 * Пока дверь закрыта, комнату за ней не рисуют (visibleNow), и сквозь
 * щели светилась пустота. Вставка стоит в плоскости створки и закрывает
 * ровно то, чего та не закрывает, — по её же силуэту. Вплотную к створке
 * она заходит под неё с запасом: внутри створки её не видно, а открылась
 * дверь — остаётся скошенной притолокой проёма.
 */
function leafFiller(buf, d, sil, dh, top) {
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  const e = dh / len(d.ux), hTop = top / len(d.uy);
  const zMid = -0.4175;                 // середина толщины створки (модель), она же середина перегородки
  const P = (x, y) => [0, 1, 2].map((k) => d.origin[k] + d.ux[k] * x + d.uy[k] * y + d.uz[k] * zMid);
  const R = sil.rows;
  // Полуширина у каждой строки — меньшая из соседних: на уступе силуэта
  // полоса не оставляет клина.
  const a = R.map((r, k) => Math.min(r[1], R[Math.max(0, k - 1)][1], R[Math.min(R.length - 1, k + 1)][1]) - 0.005);
  for (const sx of [-1, 1]) {
    for (let k = 0; k + 1 < R.length; k++) {
      if (a[k] >= e && a[k + 1] >= e) continue;
      const a0 = Math.min(a[k], e), a1 = Math.min(a[k + 1], e);
      buf.poly([P(sx * a0, R[k][0]), P(sx * e, R[k][0]), P(sx * e, R[k + 1][0]), P(sx * a1, R[k + 1][0])], C.steel, CMAT.paint);
    }
  }
  // Над верхом створки — до верха проёма.
  if (hTop > sil.H - 0.003) {
    buf.poly([P(-e, sil.H - 0.003), P(e, sil.H - 0.003), P(e, hTop + 0.003), P(-e, hTop + 0.003)], C.steel, CMAT.paint);
  }
}

/**
 * Окно: откос от лица стены до обшивки (у каждого угла — своя глубина:
 * обшивка у окна наклонная) и янтарная рама по проёму, как у дверей.
 * Обшивку в проёме вырезает коробка (interior.windowCarve), стекло —
 * отдельной сеткой (interior.windows, рисует проход стекла кабины).
 */
function buildWindow(buf, f, h) {
  const [u0, u1] = h.u, [v0, v1] = h.v, D = h.win.depth;
  const P = (u, v, d) => wallPoint(f, u, v, d);
  const e = (k) => -(D[k] + 0.05);       // на пять сантиметров за обшивку
  buf.poly([P(u0, v0, 0.01), P(u1, v0, 0.01), P(u1, v0, e(1)), P(u0, v0, e(0))], C.steel, CMAT.paint);
  buf.poly([P(u0, v1, 0.01), P(u0, v1, e(3)), P(u1, v1, e(2)), P(u1, v1, 0.01)], C.steel, CMAT.paint);
  buf.poly([P(u0, v0, 0.01), P(u0, v0, e(0)), P(u0, v1, e(3)), P(u0, v1, 0.01)], C.steel, CMAT.paint);
  buf.poly([P(u1, v0, 0.01), P(u1, v1, 0.01), P(u1, v1, e(2)), P(u1, v0, e(1))], C.steel, CMAT.paint);
  const fw = 0.07;
  wallBox(buf, f, u0 - fw, u0, v0 - fw, v1 + fw, -0.02, 0.04, C.accent, CMAT.paint);
  wallBox(buf, f, u1, u1 + fw, v0 - fw, v1 + fw, -0.02, 0.04, C.accent, CMAT.paint);
  wallBox(buf, f, u0, u1, v0 - fw, v0, -0.02, 0.04, C.accent, CMAT.paint);
  wallBox(buf, f, u0, u1, v1, v1 + fw, -0.02, 0.04, C.accent, CMAT.paint);
}

/** Колонна пака стоймя: середина в (x, z), низ y0, высота h. */
function column(ctx, buf, name, x, y0, z, h, solid = false) {
  const key = Math.round(x * 100) + ':' + Math.round(z * 100) + ':' + Math.round(y0 * 10);
  if (ctx.columns.has(key)) return;
  ctx.columns.add(key);
  buf.part(name, [x, y0, z], [K, 0, 0], [0, h / 4.46, 0], [0, 0, K]);
  if (solid) ctx.solids.push({ lo: [x - 0.22, y0, z - 0.22], hi: [x + 0.22, y0 + h, z + 0.22], column: true });
}

/**
 * Заглушка открытого торца детали пака — там, где деталь кончается не у
 * соседней детали и не у колонны: у кодовой двери, у низкого проёма.
 *
 * Деталь пака полая: верхний короб стены выступает в комнату на треть
 * метра, а торец у него открыт (пак закрывает его колонной). Без колонны в
 * торец было видно зазор перегородки и то, что за ним: у двери бортового
 * шлюза над дверью по бокам светились дыры. Заглушка — сечение самой
 * детали у торца: на каждой высоте — насколько она выступает в комнату.
 * Где деталь не выступает, заглушки нет.
 * @param from, to — где в buf.pos лежит эта стена (без заглушек)
 * @param side −1 — деталь левее торца ue, +1 — правее
 */
function capEnd(buf, f, from, to, ue, side, y0, y1) {
  const P = buf.pos, ax = f.ax, uAx = f.uAx, nn = f.n[ax];
  const us = ue + side * 0.003;
  const step = 0.01, rows = Math.ceil((y1 - y0) / step);
  const dep = new Float64Array(rows + 1);
  for (let i = from; i + 8 < to; i += 9) {
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const a = i + e * 3, b = i + ((e + 1) % 3) * 3;
      const ua = P[a + uAx], ub = P[b + uAx];
      if ((ua - us) * (ub - us) > 0 || ua === ub) continue;
      const t = (us - ua) / (ub - ua);
      pts.push([((P[a + ax] + (P[b + ax] - P[a + ax]) * t) - f.at) * nn, P[a + 1] + (P[b + 1] - P[a + 1]) * t]);
    }
    if (pts.length < 2) continue;
    const [p, q] = pts;
    const va = Math.min(p[1], q[1]), vb = Math.max(p[1], q[1]);
    for (let k = Math.max(0, Math.ceil((va - y0) / step)); k <= Math.min(rows, Math.floor((vb - y0) / step)); k++) {
      const v = y0 + k * step;
      const d = vb - va < 1e-9 ? Math.max(p[0], q[0]) : p[0] + (q[0] - p[0]) * (v - p[1]) / (q[1] - p[1]);
      if (d > dep[k]) dep[k] = d;
    }
  }
  const pt = (d, v) => wallPoint(f, us, v, d);
  for (let k = 0; k < rows; k++) {
    if (dep[k] < 0.01 && dep[k + 1] < 0.01) continue;
    const va = y0 + k * step, vb = Math.min(y1, va + step);
    buf.poly([pt(0, va), pt(dep[k], va), pt(dep[k + 1], vb), pt(0, vb)], C.steel, CMAT.paint);
  }
}

/** Стена комнаты целиком: детали, двери, проёмы. */
function buildWall(ctx, buf, room, f) {
  const y0 = f.v[0], y1 = f.v[1];
  const from = buf.pos.length;
  // Где детали пака кончаются открытым торцом: [u, сторона детали].
  const ends = [];
  const cuts = [];
  for (const d of f.doors) {
    const hw = d.code ? INT.doorHalf + CODE_DOOR.jamb : INT.wallW / 2;
    cuts.push({ u0: d.c - hw, u1: d.c + hw, door: d });
  }
  for (const h of f.holes) if (!h.door) cuts.push({ u0: h.u[0], u1: h.u[1], hole: h });
  cuts.sort((a, b) => a.u0 - b.u0);
  let u = f.u[0];
  const seed = room.lo[0] * 3 + room.lo[2] * 7 + f.ax;
  for (const c of cuts) {
    if (c.u0 > u + 1e-6) fillWall(buf, f, u, c.u0, y0, y1, seed + u);
    if (c.door && c.door.code) {
      codeDoor(buf, f, c.door, c.u0, c.u1, y0, y1, c.door.side === 'A' ? frameOf(ctx, c.door.id) : null);
      ends.push([c.u0, -1], [c.u1, 1]);
    } else if (c.door) {
      const d = c.door;
      wallPiece(buf, f, d.side === 'A' ? 'doorWallA' : 'doorWallB', d.c, y0, INT.wallW, INT.wallH);
      if (d.side === 'A') wallPiece(frameOf(ctx, d.id), f, 'doorWallA', d.c, y0, INT.wallW, INT.wallH);
      if (y1 - y0 > INT.wallH + 0.02) panel(buf, f, c.u0, c.u1, y0 + INT.wallH, y1);
    } else {
      const h = c.hole;
      // Проём не во всю высоту — перемычка над ним и стенка под ним.
      if (h.v[1] < y1 - 0.02) panel(buf, f, h.u[0], h.u[1], h.v[1], y1);
      if (h.v[0] > y0 + 0.02) panel(buf, f, h.u[0], h.u[1], y0, h.v[0]);
      if (h.win) buildWindow(buf, f, h);
      // Кромки проёма — колонны: торец детали пака открыт, а колонна его
      // закрывает (так пак и задуман). У проёмов к трапу их нет: там
      // кромку продолжает стена шахты, а колонна встала бы на ступень.
      // У окна колонн нет: окно в рост на мостике «Прометея» — не проход, и
      // колонны по его краям встали бы столбами между стёклами.
      const toShaft = ctx.P.R[h.to] && ctx.P.R[h.to].kind === 'shaft';
      if (room.kind !== 'shaft' && !toShaft && !h.win && h.v[1] - h.v[0] > 2) {
        for (const ue of [h.u[0], h.u[1]]) {
          const p = wallPoint(f, ue, y0, 0);
          column(ctx, buf, 'columnSlim', p[0], y0, p[2], y1 - y0, true);
        }
      } else {
        ends.push([h.u[0], -1], [h.u[1], 1]);
      }
    }
    u = Math.max(u, c.u1);
  }
  if (f.u[1] > u + 1e-6) fillWall(buf, f, u, f.u[1], y0, y1, seed + u);
  // Торцы — по готовой стене: сечение её деталей, без заглушек.
  const to = buf.pos.length;
  for (const [ue, side] of ends) {
    if (ue <= f.u[0] + 0.01 || ue >= f.u[1] - 0.01) continue;     // угол комнаты: торец закрыт соседней стеной
    capEnd(buf, f, from, to, ue, side, y0, y1);
  }
}

/** Пол или потолок: плитка по прямоугольнику минус дыры. */
function buildFlat(buf, f) {
  const ceil = f.side === 'y+';
  const kinds = ceil
    ? ['roofPlain', 'roof', 'roofPlain', 'roofPlain', 'roofSmallVents', 'roofPlain', 'roofDetails', 'roofPlain', 'roof', 'roofPlain']
    : ['floorPlain', 'floor', 'floorPlain', 'floorPlain', 'floor2', 'floorPlain', 'floor', 'floorPlain'];
  const tile = f.tile || INT.tile;
  for (const r of subtract({ u: f.u, v: f.v }, f.holes)) {
    const w = r.u[1] - r.u[0], d = r.v[1] - r.v[0];
    if (w < 0.05 || d < 0.05) continue;
    const nx = Math.max(1, Math.round(w / tile)), nz = Math.max(1, Math.round(d / tile));
    const sx = w / nx / 2, sz = d / nz / 2;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = r.u[0] + (i + 0.5) * w / nx, z = r.v[0] + (j + 0.5) * d / nz;
        const plain = f.plain && hash(x * 2.9, z * 1.3) < f.plain;
        const name = plain ? (ceil ? 'roofPlain' : 'floorPlain') : kinds[Math.floor(hash(x * 1.7, z * 2.3) * kinds.length)];
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
    room: room.id, kind: opts.kind || 'ceiling',
  });
}

/**
 * Люк изнутри: тоннель от проёма в стене шлюза до панели обшивки (щёки,
 * потолок, порог с кромкой «осторожно»), рама по проёму и пульт люка на
 * передней стене шлюза. Над проёмом носового люка — перемычка снаружи:
 * панель обшивки выше потолка шлюза на шестьдесят сантиметров.
 *
 * Твёрдое тоннеля — здесь же; створка и трап — подвижные, их твёрдое
 * считает js/game/airlock.js.
 */
function buildHatch(ctx, buf, h) {
  const r = ctx.P.R[h.lock], s = h.side;
  const xw = s > 0 ? r.hi[0] : r.lo[0];
  const xo = s * (h.inset + 0.02);
  const [z0, z1] = h.z, y0 = h.y[0];
  const yt = Math.min(h.y[1], r.hi[1]);
  const quad = (P, rgb, mat) => buf.poly(s > 0 ? P : P.slice().reverse(), rgb, mat);
  quad([[xw, y0, z0], [xw, y0, z1], [xo, y0, z1], [xo, y0, z0]], C.stair, CMAT.tread);
  const xe = s * (h.inset - 0.14);
  quad([[xe, y0 + 0.003, z0], [xe, y0 + 0.003, z1], [xo, y0 + 0.003, z1], [xo, y0 + 0.003, z0]], C.hazard, CMAT.hazard);
  quad([[xw, y0, z0], [xo, y0, z0], [xo, yt, z0], [xw, yt, z0]], C.steel, CMAT.paint);
  quad([[xw, y0, z1], [xw, yt, z1], [xo, yt, z1], [xo, y0, z1]], C.steel, CMAT.paint);
  quad([[xw, yt, z0], [xo, yt, z0], [xo, yt, z1], [xw, yt, z1]], C.steel, CMAT.paint);
  if (h.y[1] > yt + 0.01) quad([[xo, yt, z0], [xo, h.y[1] + 0.01, z0], [xo, h.y[1] + 0.01, z1], [xo, yt, z1]], C.frame, CMAT.paint);
  // Рама по проёму со стороны шлюза: янтарь, как у дверей.
  const fx0 = xw - s * 0.06, fx1 = xw + s * 0.02;
  const bx = (a, b) => buf.box([Math.min(a[0], b[0]), a[1], a[2]], [Math.max(a[0], b[0]), b[1], b[2]], C.accent, CMAT.paint);
  bx([fx0, y0, z0 - 0.1], [fx1, yt, z0]);
  bx([fx0, y0, z1], [fx1, yt, z1 + 0.1]);
  if (yt < r.hi[1] - 0.05) bx([fx0, yt, z0 - 0.1], [fx1, yt + 0.1, z1 + 0.1]);
  // Пульт люка — на передней стене шлюза, у самого борта.
  const zf = r.hi[2], xp = s * (Math.abs(xw) - 0.75), yp = r.lo[1] + 1.05;
  buf.box([xp - 0.24, yp, zf - 0.07], [xp + 0.24, yp + 0.5, zf], C.dark, CMAT.trim);
  buf.box([xp - 0.19, yp + 0.13, zf - 0.075], [xp + 0.19, yp + 0.42, zf - 0.07], [70, 190, 150], CMAT.paint, 0.8);
  buf.box([xp - 0.26, yp - 0.03, zf - 0.08], [xp + 0.26, yp, zf], C.hazard, CMAT.hazard);
  h.panel = [xp, yp + 0.27, zf - 0.1];
  // Твёрдое тоннеля: порог, щёки, потолок — до самой обшивки.
  const xa = Math.min(xw, s * h.skin), xb = Math.max(xw, s * h.skin);
  ctx.solids.push({ lo: [xa - 0.1, y0 - 0.5, z0], hi: [xb + 0.05, y0, z1], sill: h.id });
  ctx.solids.push({ lo: [xa, y0 - 0.5, z0 - 0.4], hi: [xb + 0.05, yt + 0.5, z0], hatchWall: h.id });
  ctx.solids.push({ lo: [xa, y0 - 0.5, z1], hi: [xb + 0.05, yt + 0.5, z1 + 0.4], hatchWall: h.id });
  ctx.solids.push({ lo: [xa, yt, z0], hi: [xb + 0.05, yt + 0.5, z1], hatchWall: h.id });
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

  // --- трюм: пульт у кормовой переборки и свет вдоль прохода. Пульт —
  // по левому борту: по правому дверь в нижний коридор.
  const Hd = R.hold;
  b = M.hold;
  prop(ctx, b, 'computerSmall', -2.6, INT.deck.low, Hd.lo[2] + 0.35, 0, K);
  for (const z of [3.4, 7.0, 10.6]) lamp(ctx, b, Hd, 0, z, { w: 1.4, range: 4.2 });

  // --- носовой шлюз: шкафчики со скафандрами у передней стены.
  const Ln = R.lockN;
  b = M.lockN;
  for (const x of [-1.2, -0.4, 0.4, 1.2]) prop(ctx, b, 'locker', x, INT.deck.low, Ln.hi[2] - 0.27, Math.PI, F);
  for (const x of [-2.2, 2.2]) lamp(ctx, b, Ln, x, 15.3, { range: 3.6, kind: 'lock' });

  // --- нижний коридор: свет вдоль.
  b = M.keel;
  for (const z of [-1.0, -4.6, -8.2]) lamp(ctx, b, R.keel, 2.7, z, { range: 3.4 });

  // --- бортовой шлюз: баллоны у задней стены, свет вдоль.
  const Ls = R.lockS;
  b = M.lockS;
  for (const sx of [-1, 1]) {
    prop(ctx, b, 'vesselTall', sx * 7.6, INT.deck.lock, Ls.lo[2] + 0.35, 0, K);
    prop(ctx, b, 'vessel', sx * 8.2, INT.deck.lock, Ls.lo[2] + 0.3, 0, K);
  }
  for (const x of [-11.5, -6.0, -0.6, 6.0, 11.5]) lamp(ctx, b, Ls, x, -12.65, { alongX: true, range: 3.6, kind: 'lock' });

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
      // У кормовой переборки — тридцать сантиметров: ящики стоят у бортов,
      // а трап и дверь в нижний коридор выходят в проход между ними.
      if (z - s / 2 < Hd.lo[2] + 0.3) break;
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
function roomSolids(P, room, faces, solids) {
  const th = INT.gap / 2;
  for (const f of faces) {
    // Грань, которую делает не комната (переборку рубки «Челленджера» —
    // сама рубка), — крючок плана.
    if (P.skipFace && P.skipFace(room, f)) continue;
    // Окно — стекло: стена в нём такая же твёрдая.
    for (const r of subtract({ u: f.u, v: f.v }, f.holes.filter((h) => !h.window))) {
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
 * Створка пака под проём, собранный кодом (кодовая дверь, дверь рубки):
 * в середине перегородки, по ширине проёма с рамой.
 * @param mid середина проёма на полу, в середине перегородки (оси корабля)
 * @param t ось стены (вдоль неё створка едет), n — нормаль в комнату a
 */
export function codeLeaf(id, rooms, pos, ax, mid, t, n, extra = {}) {
  const bw = 2 * INT.doorHalf + 0.1, bsx = bw / 1.674, bsy = INT.doorTop / 2.79, bsz = 0.4;
  return {
    id, rooms, pos, ax,
    origin: mid.map((v, i) => v + n[i] * 0.4175 * bsz), tangent: t,
    ux: t.map((c) => c * bsx), uy: [0, bsy, 0], uz: n.map((c) => c * bsz),
    slide: bw, half: bw / 2, height: INT.doorTop, open: 0, want: 0, ...extra,
  };
}

/**
 * Собрать помещения по корпусу.
 *
 * @param hull корпус (js/models/ships.js, в километрах)
 * @param P план (makePlan): по умолчанию — «Челленджер»
 */
export function buildInterior(hull, P = CHALLENGER) {
  const hullM = hullMeters(hull);
  const wins = fitWindows(P, hullM);
  const faces = layoutFaces(P, wins);
  // Ленивый план (P.lazy, «Прометей»: сто с лишним помещений) — первый
  // проход без геометрии: твёрдое, лампы и двери. Сетка комнаты
  // собирается, когда её впервые просят (meshOf), тем же проходом, где
  // настоящая лишь она.
  const ctx = assemble(P, hullM, faces, P.lazy ? null : '*');
  const out = finish(P, hullM, faces, wins, ctx);
  if (!P.lazy) return out;
  out.meshes = {};
  out.doorFrames = {};
  out.meshOf = (id) => {
    if (!out.meshes[id] && P.R[id]) {
      const c = assemble(P, hullM, faces, id);
      out.meshes[id] = c.meshes[id];
      for (const [k, m] of Object.entries(c.frames)) if (!out.doorFrames[k]) out.doorFrames[k] = m;
    }
    return out.meshes[id] || null;
  };
  out.frameOf = (id) => {
    if (!(id in out.doorFrames)) {
      const c = assemble(P, hullM, faces, 'frame:' + id);
      out.doorFrames[id] = c.frames[id] || null;
    }
    return out.doorFrames[id];
  };
  // Отпустить сетку комнаты (кабина отпустила её видеопамять): понадобится
  // — соберётся заново.
  out.dropMesh = (id) => { delete out.meshes[id]; };
  return out;
}

/**
 * Один проход сборки по плану.
 * @param target '*' — все комнаты; id комнаты — только её сетка (и рамы
 *   её дверей); 'frame:<дверь>' — только рама; null — ни одной сетки
 */
function assemble(P, hullM, faces, target) {
  const ctx = { P, target, meshes: {}, frames: {}, lamps: [], solids: [], columns: new Set(), hullM, faces };
  for (const r of P.rooms) ctx.meshes[r.id] = target === '*' || target === r.id ? new MeshBuf() : DRY;

  // Своё у корабля — до комнат: у «Челленджера» переборка рубки по
  // сечению фонаря и твёрдое рубки.
  if (P.special) P.special(ctx, faces, hullM);

  for (const r of P.rooms) {
    if (r.kind === 'bridge') continue;
    const buf = ctx.meshes[r.id];
    const rf = faces[r.id];
    for (const f of rf) {
      if (P.skipFace && P.skipFace(r, f)) continue;
      if (f.ax === 1) {
        // Пол шахты — ступени (пол под трапом кладёт план).
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
    roomSolids(P, r, rf, ctx.solids);
  }

  if (P.landings) P.landings(ctx, faces, hullM);
  for (const s of P.stairs) buildStair(ctx.meshes[s.room], ctx.solids, s);
  for (const h of P.hatches) buildHatch(ctx, ctx.meshes[h.lock], h);

  P.furnish(ctx);

  // Двери: створка пака в тоннеле рамы, едет вбок вдоль стены.
  const doors = P.doors.map((d) => {
    const f = faces[d.a].find((ff) => ff.doors && ff.doors.some((x) => x.id === d.id));
    const t = tangentOf(f.n);
    if (d.code) {
      // Створка пака под проём кодовой двери — как у двери рубки: в
      // середине перегородки, по ширине проёма с рамой.
      return codeLeaf(d.id, [d.a, d.b], d.pos, d.ax, wallPoint(f, d.c, d.y, -INT.gap / 2), t, f.n, { thick: INT.gap });
    }
    return {
      id: d.id, rooms: [d.a, d.b], pos: d.pos, ax: d.ax, thick: INT.gap,
      origin: wallPoint(f, d.c, d.y, FACE * K), tangent: t,
      ux: t.map((c) => c * K), uy: [0, K, 0], uz: f.n.map((c) => c * K),
      slide: 1.674 * K, half: 1.674 * K / 2, height: INT.doorTop, open: 0, want: 0,
    };
  });
  // Порог: в толщине перегородки пола нет ни у одной из двух комнат, и
  // без него пилот проваливался в зазор между ними.
  for (const d of P.doors) {
    const lo = [0, d.y - 0.5, 0], hi = [0, d.y, 0];
    const t = d.ax === 0 ? 2 : 0;
    lo[d.ax] = Math.min(d.at, d.at + d.s * INT.gap) - 0.05; hi[d.ax] = Math.max(d.at, d.at + d.s * INT.gap) + 0.05;
    lo[t] = d.c - INT.doorHalf - 0.05; hi[t] = d.c + INT.doorHalf + 0.05;
    ctx.solids.push({ lo, hi, sill: d.id });
  }
  // Двери не по списку (дверь переборки рубки «Челленджера») — от плана.
  if (P.extraDoors) for (const d of P.extraDoors(ctx)) doors.push(d);
  ctx.doors = doors;

  // Створка двери и ящик груза — по одной сетке на всех, в своих осях:
  // их ставит и двигает рисование (js/gl/cabin.js).
  const doorMesh = new MeshBuf();
  doorMesh.part('door', [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  // Щели вокруг створки в проёмах, собранных кодом: вставка — в комнату a
  // и в раму двери (рисуется ровно одна из двух, js/gl/cabin.js).
  const sil = leafSilhouette(doorMesh);
  for (const d of doors) {
    const def = P.doors.find((x) => x.id === d.id);
    if (!d.filler && !(def && def.code)) continue;
    for (const b of [ctx.meshes[d.rooms[0]], frameOf(ctx, d.id)]) leafFiller(b, d, sil, INT.doorHalf, INT.doorTop);
  }
  ctx.doorMesh = doorMesh;
  return ctx;
}

/** Помещения из первого прохода: двери, твёрдое, лампы, окна и всё прочее. */
function finish(P, hullM, faces, wins, ctx) {
  const doors = ctx.doors, doorMesh = ctx.doorMesh;
  const crateMesh = new MeshBuf();
  crateMesh.part(CRATE.name, [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);

  const R = P.R;
  const out = {
    code: P.code,
    INT: P.INT || INT, rooms: P.rooms, roomById: R, faces, meshes: ctx.meshes, doors, lamps: ctx.lamps, solids: ctx.solids,
    carve: P.carve, sunBox: P.sunBox, stairs: P.stairs, slots: P.slots ? P.slots() : [], crate: P.crate || CRATE,
    hullM, doorMesh, crateMesh, doorFrames: ctx.frames,
    // Окна: стекло у обшивки (оси корабля, м) — его рисует проход стекла
    // кабины; и коробки выреза обшивки в проёмах — только изнутри, как
    // вырез помещений (js/gl/scene.js, setShipCarveAir).
    windows: wins.map((w) => {
      const f = faceOf(faces[w.room], w.ax, w.side);
      const g = (k) => -(w.depth[k] - 0.03);
      return { id: w.id, room: w.room, glass: [wallPoint(f, w.u0, w.v0, g(0)), wallPoint(f, w.u1, w.v0, g(1)),
        wallPoint(f, w.u1, w.v1, g(2)), wallPoint(f, w.u0, w.v1, g(3))] };
    }),
    // Вырез в проёмах: у «Челленджера» — по окну (обшивка у окна цела, и
    // её надо снять), у плана со своим списком — по нему (у «Прометея»
    // окна рубки — настоящие проёмы корпуса, а боковые — один вырез на
    // борт: коробок в шейдере шестнадцать).
    windowCarve: P.windowCarve || wins.map((w) => {
      const xa = w.at, xb = w.at + w.side * (Math.max(...w.depth) + 0.3);
      const lo = [0, w.v0 + 0.005, 0], hi = [0, w.v1 - 0.005, 0];
      const uAx = w.ax === 0 ? 2 : 0;
      lo[w.ax] = Math.min(xa, xb); hi[w.ax] = Math.max(xa, xb);
      lo[uAx] = w.u0 + 0.005; hi[uAx] = w.u1 - 0.005;
      return { room: w.room, lo, hi };
    }),
    // Люки (данные; их ход и трапы ведёт js/game/airlock.js — он же
    // кладёт сюда своё состояние, air).
    hatches: P.hatches, air: null, airways: P.airways,
    // Проёмы без дверей — для дороги по кораблю (js/game/route.js).
    openings: P.openings,
    // Лифты (js/game/lift.js): кабины по палубам и куда они ходят.
    lifts: P.lifts,
    roomAt: (p) => roomAtIn(P, p),
    // Сколько ящиков в трюме и как горят реакторы — ставит игра.
    cargo: 0,
    reactor: 0,
    // Кресло: глаз сидящего — глаз пилота; встав, он оказывается за
    // креслом, лицом вперёд. Сесть можно, стоя за креслом.
    seat: P.seat,
    // Начало осей кабины (js/gl/cabin.js): глаз в кресле, оси корабля, м.
    origin: P.origin || P.seat.eye,
    // Комната с грузом (её ящики рисует кабина).
    holdRoom: P.holdRoom || 'hold',
    // Вырез по комнатам (у ленивых планов): коробка каждой — своя, и
    // в шейдер идут только видимых (js/gl/scene.js, setShipCarveAir).
    roomCarve: P.roomCarve ? roomCarveOf(P) : null,
    lazy: !!P.lazy,
    // Есть ли в рубке пост пилота «Челленджера» (js/models/cockpit.js):
    // без него кабина рисует одни помещения (js/gl/cabin.js, deck).
    pod: !!P.pod,
    // Радиус карты теней солнца в осях кабины, м: у большого мостика —
    // во весь мостик (js/gl/cabin.js, prepare).
    sunR: P.sunR || 0,
  };
  out.visibleNow = (id) => visibleNow(id, doors, P);
  // Сетка комнаты и рама двери (у ленивых планов собираются по
  // требованию — см. buildInterior).
  out.meshOf = (id) => out.meshes[id] || null;
  out.frameOf = (id) => out.doorFrames[id] || null;
  return out;
}

/**
 * Коробки выреза по комнатам: комната и полперегородки вокруг (вырез
 * соседних комнат сходится в проёме двери — внутренние грани корпуса,
 * попавшие в перегородку, не перегородят дверь), по высоте — плитка.
 * Это внутри того, что проверка держит внутри обшивки (стены — 0.45 м).
 */
function roomCarveOf(P) {
  const out = {};
  for (const r of P.rooms) {
    out[r.id] = { lo: [r.lo[0] - 0.35, r.lo[1] - 0.1, r.lo[2] - 0.35], hi: [r.hi[0] + 0.35, r.hi[1] + 0.1, r.hi[2] + 0.35] };
  }
  return out;
}

/** В какой комнате точка (оси корабля, м); в проёме двери — в комнате a. */
function roomAtIn(P, p) {
  for (const r of P.rooms) {
    if (r.kind === 'bridge') continue;
    if (p[0] >= r.lo[0] - 0.05 && p[0] <= r.hi[0] + 0.05 && p[1] >= r.lo[1] - 0.3
      && p[1] <= r.hi[1] + 0.05 && p[2] >= r.lo[2] - 0.05 && p[2] <= r.hi[2] + 0.05) return r;
  }
  if (P.roomAtExtra) {
    const r = P.roomAtExtra(p);
    if (r) return r;
  }
  // Тоннель люка — часть своего шлюза: от стены до обшивки.
  for (const h of P.hatches) {
    const r = P.R[h.lock], ax = Math.abs(p[0]);
    if (Math.sign(p[0]) === h.side && ax >= Math.abs(h.side > 0 ? r.hi[0] : r.lo[0]) - 0.05
      && ax <= h.skin + 0.02 && p[2] >= h.z[0] - 0.05 && p[2] <= h.z[1] + 0.05
      && p[1] >= h.y[0] - 0.3 && p[1] <= h.y[1]) return r;
  }
  for (const d of P.doors) {
    if (!d.pos) continue;
    if (Math.abs(p[d.ax] - d.pos[d.ax]) <= INT.gap / 2 + 0.05
      && Math.abs(p[d.ax === 0 ? 2 : 0] - d.c) <= INT.doorHalf && p[1] >= d.y - 0.3 && p[1] <= d.y + 2.2) return P.R[d.a];
  }
  return null;
}

/** То же для «Челленджера» (проверки зовут его напрямую). */
export function roomAt(p) {
  return roomAtIn(CHALLENGER, p);
}

/**
 * Комнаты, видимые из данной: она сама и всё в два шага через проёмы и
 * двери. Стены непрозрачны, и дальше двух проёмов взгляд не проходит —
 * рисовать остальное значит рисовать за стеной.
 */
export function visibleFrom(id, P = CHALLENGER) {
  if (P.seen.has(id)) return P.seen.get(id);
  const out = new Set([id]);
  for (const n of P.adj[id] || []) {
    out.add(n);
    for (const m of P.adj[n]) out.add(m);
  }
  const list = [...out];
  P.seen.set(id, list);
  return list;
}

/**
 * То же, но с дверями как есть: за закрытой дверью комнаты не видно, и
 * рисовать её незачем. Двери открываются, только когда к ним подходят, —
 * так что обычно видна одна-две комнаты из одиннадцати.
 */
export function visibleNow(id, doors, P = CHALLENGER) {
  const open = new Set();
  for (const d of doors) if (d.open > 0.01) open.add(d.rooms[0] + '|' + d.rooms[1]);
  const passable = (a, b) => {
    if (P.openLinks.has(a + '|' + b) || P.openLinks.has(b + '|' + a)) return true;
    return open.has(a + '|' + b) || open.has(b + '|' + a);
  };
  const out = new Set([id]);
  for (const n of P.adj[id] || []) {
    if (!passable(id, n)) continue;
    out.add(n);
    for (const m of P.adj[n]) if (passable(n, m)) out.add(m);
  }
  return [...out];
}

// --- план «Челленджера» ---------------------------------------------------------
//
// Всё, что у него своё: рубка-фонарь (не коробка), переборка с дверью по
// сечению фонаря, площадка трапа A над кают-компанией, пол шахты B под
// трапом, вырез и кресло.

function challengerSpecial(ctx, faces, hullM) {
  // Рубка: переборка с дверью по сечению фонаря.
  // Переборка — в рубке и ещё раз в раме двери рубки: из шахты трапа при
  // закрытой двери рубку не рисуют, и без этого переборки с её стороны не
  // было вовсе — сквозь неё светились фонарь и небо.
  const prof = canopyProfile(hullM, INT.bulkZ + 0.05);
  buildBulkhead(ctx.meshes.bridge, prof);
  buildBulkhead(frameOf(ctx, 'bridge'), prof);
  bridgeSolids(hullM, ctx.solids);
  bulkheadSolids(ctx.solids);
}

function challengerLandings(ctx) {
  // Площадка трапа A и её торец над потолком кают-компании.
  const sA = STAIRS[0];
  const land = ctx.meshes.shaftA;
  buildFlat(land, { side: 'y-', at: INT.deck.bridge, u: [-0.8, 0.8], v: [sA.zTop, INT.bulkZ - INT.bulkT], holes: [] });
  land.poly([[-0.8, CEIL_MID, sA.zTop], [0.8, CEIL_MID, sA.zTop], [0.8, INT.deck.bridge - 0.05, sA.zTop],
    [-0.8, INT.deck.bridge - 0.05, sA.zTop]], C.steel, CMAT.paint);
  // Пол шахты B под трапом.
  buildFlat(ctx.meshes.shaftB, { side: 'y-', at: INT.deck.low, u: [-0.8, 0.8], v: [R.shaftB.lo[2], R.shaftB.hi[2]], holes: [] });
}

function challengerDoors(ctx) {
  ctx.solids.push({ lo: [-INT.doorHalf - 0.05, INT.deck.bridge - 0.5, INT.bulkZ - INT.bulkT - 0.05],
    hi: [INT.doorHalf + 0.05, INT.deck.bridge, INT.bulkZ + 0.05], sill: 'bridge' });
  // Дверь рубки: та же створка пака под проём переборки (1.13 × 1.97 м
  // плюс по пять сантиметров на раму), в толщине переборки.
  return [codeLeaf('bridge', ['bridge', 'shaftA'], [0, INT.deck.bridge, INT.bulkZ - INT.bulkT / 2], 2,
    [0, INT.deck.bridge, INT.bulkZ - INT.bulkT / 2], [1, 0, 0], [0, 0, 1], { thick: INT.bulkT, filler: true })];
}

export const CHALLENGER = makePlan({
  code: 'challenger',
  rooms: ROOMS, stairs: STAIRS, doors: DOORS, hatches: HATCHES, windows: WINDOWS, openings: OPENINGS,
  // Рубка и шахта трапа связаны дверью переборки — её нет в DOORS.
  links: [['bridge', 'shaftA']],
  // Переборку рубки (передняя стенка шахты A) делает сама рубка.
  skipFace: (room, f) => room.id === 'shaftA' && f.side === 'z+',
  special: challengerSpecial,
  landings: challengerLandings,
  extraDoors: challengerDoors,
  furnish,
  roomAtExtra: (p) => (p[2] >= INT.bulkZ - 0.05 && p[2] <= -4 && p[1] >= INT.deck.bridge - 0.3 && Math.abs(p[0]) < 4
    ? R.bridge : null),
  // Вырез корпуса: всё, где стоят комнаты (кроме рубки), — по ярусам.
  carve: [
    { lo: [-4.25, INT.deck.mid - 0.05, -28.45], hi: [4.25, CEIL_MID + 0.05, -3.95] },
    { lo: [-4.55, INT.deck.low - 0.05, 1.35], hi: [4.55, CEIL_LOW + 0.05, 17.35] },
    { lo: [-0.85, CEIL_MID - 0.05, -22.05], hi: [0.85, 2.5, INT.bulkZ - INT.bulkT + 0.02] },
    { lo: [-0.85, INT.deck.low - 0.05, -4.0], hi: [0.85, -2.7, 1.45] },
    { lo: [1.35, INT.deck.low - 0.05, -10.35], hi: [4.05, CEIL_LOW + 0.05, 0.85] },
    { lo: [-14.05, INT.deck.lock - 0.05, -14.45], hi: [14.05, CEIL_LOCK + 0.05, -10.85] },
  ],
  // Рубка — единственное место, куда попадает свет снаружи: стекло
  // только здесь. Остальные помещения закрыты, и солнце, небо и отсвет
  // планеты в них не входят — иначе карта теней (а она покрывает лишь
  // рубку) пускала бы солнце сквозь переборки.
  sunBox: { lo: [-4.5, -0.6, INT.bulkZ - 0.02], hi: [4.5, 5.5, 6] },
  seat: {
    eye: [EYE.x, EYE.y, EYE.z], stand: [0, INT.deck.bridge, -8.55],
    zone: { lo: [-1.4, -0.5, -10.0], hi: [1.4, 2.6, -7.75] },
    room: 'bridge',
  },
  origin: [EYE.x, EYE.y, EYE.z],
  pod: true,
  slots: crateSlots,
  crate: CRATE,
  holdRoom: 'hold',
});

// Детали и сборщики, из которых другие планы собирают своё.
export {
  R as ROOM_BY_ID, CEIL_MID, CEIL_LOW, CEIL_LOCK,
  K, F, C, prop, lamp, buildFlat, wallBox, column, panel, hash, faceOf, wallPoint, frameOf, bounds as partBounds,
};
