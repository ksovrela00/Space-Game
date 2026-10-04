// Камни на грунте: предметы известного размера у самой поверхности.
//
// Зачем они. Высоту глаз меряет тремя вещами — размером знакомых
// предметов, плотностью текстуры и скоростью параллакса. У процедурного
// рельефа на метровом масштабе нет ничего: шероховатость на десяти
// метрах — двенадцать сантиметров, на трёх — один. Поэтому с двадцати
// метров грунт выглядел ровно так же, как с километра, и прибор,
// показывающий «20 м», спорил с глазами.
//
// Камень размером с корабельную стойку эту дыру закрывает разом: он даёт
// и силуэт, и параллакс, и масштаб, с которым можно сравнить свою высоту.
// Ни шейдерная деталь (она только наклоняет нормаль, силуэта у неё нет),
// ни более мелкая сетка рельефа этого не дают.
//
// Расстановка ДЕТЕРМИНИРОВАННАЯ и привязана к телу, а не к камере:
// решётка живёт в тех же координатах грани куба, что и плитки
// поверхности, а всё случайное берётся из хеша номера ячейки. Поэтому
// камни не плывут при движении, не мигают при пересборке и лежат на
// одном и том же месте между запусками.

import { faceDir } from './quadtree.js';
import { cubeLookup } from './bake.js';
import { terrainOf, plateAt } from './terrain.js';
import { buildIndexedMesh } from './mesh.js';
import { GROUND } from './ground.js';
import { ROCK_SHAPES } from '../models/rocks.parts.js';
import { Q } from '../core/quality.js';

export const ROCKS = {
  // Выше этой высоты камни не строятся: со двухсот метров камень в метр
  // занимает доли пикселя, а поле пришлось бы растить на сотни метров.
  maxAlt: 0.3,         // км
  // Радиус поля вокруг точки под камерой. Он же задаёт, когда поле
  // пересобирается: ушли от центра на треть радиуса — собираем заново.
  radiusOf: (alt) => Math.min(0.18, Math.max(0.08, alt * 6)),
  // Шаг решётки ПОСТОЯННЫЙ: плотность россыпи — свойство грунта, а не
  // того, с какой высоты на него смотрят. Растягивать шаг вместе с полем
  // (чтобы не упереться в предел) оказалось худшим решением: на ста
  // восьмидесяти метрах поля выходил один камень на сорок метров, и в
  // кадре их оставалось два-три — то есть их не было видно вовсе.
  cellOf: () => 0.012,
  chance: 0.55,        // доля ячеек с камнем
  // Размер камня — его полуразмер: камень получается вдвое шире и
  // примерно вдвое ниже этого числа. Мельче полуметра ставить бессмысленно:
  // с высоты в пару десятков метров такой камень не виден, а считать его
  // приходится наравне с остальными.
  sizeMin: 0.0007,     // км — 70 см
  sizeMax: 0.0030,     // км — 3 м
  max: Q.rocks,        // предел на поле: дальше растёт только цена
  // Камней за один кадр. Каждый — это выборка рельефа, самая дорогая
  // функция в игре; собранное целиком поле стоило бы десять миллисекунд,
  // то есть заметный рывок при каждом переезде.
  chunk: 40,
  // Тень камня. Без неё камень на ровном грунте читается как пятно
  // краски: с высоты его видно сверху, а сверху конус — это
  // многоугольник. Тень — единственное, что делает его предметом.
  shadowMin: 0.15,     // синус высоты солнца, ниже которого тени нет
  shadowMax: 3.5,      // предел длины тени в размерах камня
  shadowDark: 0.16,    // во сколько раз тень темнее грунта
  shadowLift: 0.00004, // км — подъём над грунтом, чтобы не спорить с ним
};

// Хеш номера ячейки -> четыре независимых числа 0..1.
const hash4 = (a, b, c) => {
  let h = (Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2246822519)) | 0;
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    out[i] = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  return out;
};

/**
 * Где лежат камни вокруг точки dir.
 *
 * Считается без единого обращения к GL — это чистая геометрия, и её
 * можно проверить в node.
 *
 * @param body тело
 * @param dir  единичное направление на точку под камерой (локальные оси)
 * @param radius радиус поля, км
 * @returns массив {dir, size, spin, shape} — направление на камень,
 *          его размер в километрах, поворот и номер формы
 */
export function scatterRocks(body, dir, radius, out = []) {
  out.length = 0;
  const R = body.radius;
  const terrain = terrainOf(body);
  const sea = !!terrain.kindCfg.liquid;
  // Грань куба и координаты на ней. Параметр грани идёт от -1 до 1 через
  // тангенс (см. quadtree.js), поэтому линейные координаты выборки
  // переводим в него арктангенсом — иначе у краёв грани шаг решётки
  // отличался бы вдвое.
  const look = cubeLookup(dir.x, dir.y, dir.z);
  const QUARTER = Math.PI / 4;
  const fu = Math.atan(look.s) / QUARTER, fv = Math.atan(look.t) / QUARTER;
  // Шаг решётки в параметрах грани.
  const step = (ROCKS.cellOf(radius) / R) / QUARTER;
  const half = Math.ceil((radius / R) / QUARTER / step);
  const ci = Math.round(fu / step), cj = Math.round(fv / step);
  const cosLim = Math.cos(radius / R);

  for (let j = -half; j <= half && out.length < ROCKS.max; j++) {
    for (let i = -half; i <= half && out.length < ROCKS.max; i++) {
      const gi = ci + i, gj = cj + j;
      const h = hash4(gi, gj, look.face * 7919 + (body.id | 0) * 104729);
      if (h[0] > ROCKS.chance) continue;
      // Смещение внутри ячейки: иначе камни стоят рядами.
      const u = (gi + (h[1] - 0.5) * 0.9) * step;
      const v = (gj + (h[2] - 0.5) * 0.9) * step;
      if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;    // соседняя грань
      const d = faceDir(look.face, u, v, { x: 0, y: 0, z: 0 });
      if (d.x * dir.x + d.y * dir.y + d.z * dir.z < cosLim) continue;   // за краем поля
      // Площадка города расчищена: валуны на перроне и в улицах означали
      // бы, что город никто не строил, а просто положил поверх камней.
      if (body.plate && plateAt(body.plate, d.x, d.y, d.z) > 0) continue;
      // На море камней нет: валун, лежащий на воде, — это плавучий валун.
      if (sea && terrain.displace(d.x, d.y, d.z) <= 0) continue;
      // Размер: мелких много, крупных мало — так и выглядит настоящая
      // россыпь (распределение размеров у них степенное и крутое).
      const t = h[3] ** 3;
      out.push({
        dir: d,
        size: ROCKS.sizeMin + (ROCKS.sizeMax - ROCKS.sizeMin) * t,
        spin: h[1] * Math.PI * 2,
        // Форма, сплющивание и тон — из второго хеша той же ячейки: шесть
        // сканов, повёрнутых и чуть сжатых по-своему, на глаз не
        // повторяются. Детерминированно — у всех игроков тот же камень.
        ...rockLook(gi, gj, look.face),
      });
    }
  }
  return out;
}

// Формы камня — фотосканы валунов Poly Haven (CC0), упрощённые до 320
// треугольников (tools/rocks.mjs): низ на нуле, полуширина — единица,
// гладкие нормали и UV по граням куба. Раньше здесь стояли процедурные
// восьмигранники — и с двадцати метров россыпь читалась серыми
// пирамидами: у пирамиды нет силуэта камня, и мерой высоты она не
// служит. Скан — служит: скол, округлый бок, уступ.
export const SHAPES = ROCK_SHAPES;

// Вершин тени на камень: восьмиугольник веером.
const SHADOW_VERTS = 8 * 3;

// Сколько сидит в грунте: доля высоты. Достаточно, чтобы камень не
// выглядел положенным сверху (и закрыть открытый низ скана — валун
// снимали лежащим), и мало, чтобы не съесть его.
const SINK = 0.15;

/** Форма, сплющивание и тон камня в ячейке — детерминированно. */
function rockLook(gi, gj, face) {
  const h = hash4(gi * 7 + 3, gj * 13 + 5, face * 31 + 977);
  return {
    shape: Math.min(SHAPES.length - 1, Math.floor(h[0] * SHAPES.length)),
    squash: [0.85 + h[1] * 0.3, 0.8 + h[2] * 0.35, 0.85 + h[3] * 0.3],
    tone: 0.62 + ((h[1] * 7.31) % 1) * 0.2,
    uvAt: [h[2] * 13.7 % 1, h[3] * 7.9 % 1],
  };
}

/**
 * Порционный сборщик поля: геометрия в локальных осях тела и в ЕДИНИЧНОМ
 * радиусе — ровно как у плиток поверхности, — и, как у них, от середины
 * поля (origin), а не от центра тела: иначе float32 в шейдере даёт
 * камню полметра ошибки, и у ног пилота он дрожит (js/gl/tilegeo.js).
 *
 * @param center направление на середину поля (оси тела); без него —
 *        от центра тела, как раньше (так считают проверки)
 *
 * Порциями, потому что на каждый камень приходится выборка рельефа:
 * поле целиком — это десяток миллисекунд, а кадр длится шестнадцать.
 */
export function rockBuilder(body, rocks, sun = null, detail = null, center = null) {
  const terrain = terrainOf(body);
  const R = body.radius;
  let origin = [0, 0, 0];
  if (center) {
    const h0 = 1 + terrain.displace(center.x, center.y, center.z, detail);
    origin = [center.x * h0, center.y * h0, center.z * h0];
  }
  const [ox, oy, oz] = origin;
  const n = rocks.length;
  // Вершин и индексов у форм разное число: считаем по камням поля.
  let total = 0, totalIdx = 0;
  for (const r of rocks) {
    const s = SHAPES[r.shape] || SHAPES[0];
    total += s.pos.length / 3 + SHADOW_VERTS;
    totalIdx += s.idx.length + SHADOW_VERTS;
  }
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 4);
  // Координата фактуры камня (GROUND.rock): в кусках снятой поверхности.
  const uv = new Float32Array(total * 2);
  const indices = new Uint32Array(totalIdx);
  const rgb = [0, 0, 0];
  let o = 0;
  let oi = 0;
  let at = 0;
  let result = null;

  // Тень камня: вытянутый в сторону от солнца многоугольник на грунте.
  // Считается тем же способом, что и тень корабля, только грубее —
  // камню хватает восьмиугольника.
  const SHADOW_SIDES = 8;
  const shadow = (r, d, h, tx, ty, tz, bx, by, bz, sz, tall, rgb) => {
    if (!sun) return;
    // Высота солнца над горизонтом в этой точке.
    const e = sun.x * d.x + sun.y * d.y + sun.z * d.z;
    if (e < ROCKS.shadowMin) return;
    // Куда ложится тень: горизонтальная часть направления ОТ солнца.
    let ax = -(sun.x - d.x * e), ay = -(sun.y - d.y * e), az = -(sun.z - d.z * e);
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    // Длина тени = высота камня / тангенс высоты солнца.
    const len = Math.min(tall * Math.sqrt(Math.max(0, 1 - e * e)) / e, sz * ROCKS.shadowMax);
    // В касательных осях камня: куда именно вытягивать.
    const au = ax * tx + ay * ty + az * tz;
    const av = ax * bx + ay * by + az * bz;
    const lift = h + ROCKS.shadowLift / R;
    const cu = au * len * 0.5, cv = av * len * 0.5;     // центр тени смещён

    const dark = [rgb[0] * ROCKS.shadowDark, rgb[1] * ROCKS.shadowDark,
      rgb[2] * ROCKS.shadowDark];
    const put = (u, v) => {
      positions[o * 3] = d.x * lift + tx * u + bx * v - ox;
      positions[o * 3 + 1] = d.y * lift + ty * u + by * v - oy;
      positions[o * 3 + 2] = d.z * lift + tz * u + bz * v - oz;
      normals[o * 3] = d.x; normals[o * 3 + 1] = d.y; normals[o * 3 + 2] = d.z;
      colors[o * 4] = dark[0]; colors[o * 4 + 1] = dark[1]; colors[o * 4 + 2] = dark[2];
      // Не светится: альфа у сетки — доля свечения, а не непрозрачность
      // (см. MESH_FS). Тень освещена тем же солнцем, что и грунт вокруг,
      // иначе на закате она оставалась бы светлее самой земли.
      colors[o * 4 + 3] = 0;
      indices[oi++] = o;
      o++;
    };
    // Эллипс: поперёк — ширина камня, вдоль — она же плюс длина тени.
    const half = len * 0.5 + sz * 0.8;
    for (let k = 0; k < SHADOW_SIDES; k++) {
      const a0 = (k / SHADOW_SIDES) * Math.PI * 2;
      const a1 = ((k + 1) / SHADOW_SIDES) * Math.PI * 2;
      const p0u = cu + (Math.cos(a0) * half) * au - (Math.sin(a0) * sz * 0.85) * av;
      const p0v = cv + (Math.cos(a0) * half) * av + (Math.sin(a0) * sz * 0.85) * au;
      const p1u = cu + (Math.cos(a1) * half) * au - (Math.sin(a1) * sz * 0.85) * av;
      const p1v = cv + (Math.cos(a1) * half) * av + (Math.sin(a1) * sz * 0.85) * au;
      put(cu, cv); put(p0u, p0v); put(p1u, p1v);
    }
  };

  const one = (r) => {
    const d = r.dir;
    // Высота грунта под камнем — с ТОЙ ЖЕ детализацией, с какой грунт
    // РИСУЕТСЯ. Полная высота не годится: сетка передаёт рельеф с
    // ошибкой «уклон × ячейка», и на горном склоне (уклон в треть) это
    // метры — камень, положенный на полную высоту, повисает в воздухе.
    // На безатмосферных телах разницы нет вовсе: там уклон три десятых
    // процента, и ошибка — полсантиметра.
    const h = 1 + terrain.displace(d.x, d.y, d.z, detail);
    terrain.color(d.x, d.y, d.z, rgb, detail);
    // Камень темнее грунта: это скол породы, а не пыль, которой засыпано
    // всё вокруг. Разброс по камням — чтобы россыпь не выглядела набором
    // одинаковых пятен; внутри камня цвет ведёт фактура (GROUND.rock).
    const k = r.tone || 0.7;

    // Касательные оси в точке камня.
    const helper = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    let tx = helper.y * d.z - helper.z * d.y;
    let ty = helper.z * d.x - helper.x * d.z;
    let tz = helper.x * d.y - helper.y * d.x;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const bx = d.y * tz - d.z * ty;
    const by = d.z * tx - d.x * tz;
    const bz = d.x * ty - d.y * tx;
    const cs = Math.cos(r.spin), sn = Math.sin(r.spin);
    const sz = r.size / R;                     // размер в единичном радиусе

    const shape = SHAPES[r.shape] || SHAPES[0];
    const [qx, qy, qz] = r.squash || [1, 1, 1];
    const sink = SINK * shape.height;
    // Фактура: координата формы (в полуширинах) -> метры -> куски
    // снятой поверхности; у каждого камня своё начало, иначе одинаковые
    // формы несли бы один и тот же рисунок.
    const uk = r.size / GROUND.rock.sizeKm;
    const [u0, v0] = r.uvAt || [0, 0];
    const top = (shape.height - sink) * qy;
    const base = o;
    const P = shape.pos, N = shape.nrm, U = shape.uv;
    for (let i = 0; i < P.length / 3; i++) {
      const lx = P[i * 3] * qx, ly = (P[i * 3 + 1] - sink) * qy, lz = P[i * 3 + 2] * qz;
      const px = (lx * cs - lz * sn) * sz;
      const pz = (lx * sn + lz * cs) * sz;
      const py = ly * sz;
      positions[o * 3] = d.x * (h + py) + tx * px + bx * pz - ox;
      positions[o * 3 + 1] = d.y * (h + py) + ty * px + by * pz - oy;
      positions[o * 3 + 2] = d.z * (h + py) + tz * px + bz * pz - oz;
      // Нормаль при сжатии по осям — обратным масштабом, иначе свет
      // ложился бы по несжатой форме.
      const mx = N[i * 3] / qx, my = N[i * 3 + 1] / qy, mz = N[i * 3 + 2] / qz;
      const nxl = mx * cs - mz * sn, nzl = mx * sn + mz * cs;
      let nx = d.x * my + tx * nxl + bx * nzl;
      let ny = d.y * my + ty * nxl + by * nzl;
      let nz = d.z * my + tz * nxl + bz * nzl;
      const nl = Math.hypot(nx, ny, nz) || 1;
      normals[o * 3] = nx / nl; normals[o * 3 + 1] = ny / nl; normals[o * 3 + 2] = nz / nl;
      // У самого грунта камень темнее: туда не достаёт рассеянный свет
      // неба — его закрывает земля вокруг.
      const foot = 0.6 + 0.4 * Math.min(1, Math.max(0, ly / Math.max(top * 0.35, 1e-6)));
      colors[o * 4] = rgb[0] * k * foot;
      colors[o * 4 + 1] = rgb[1] * k * foot;
      colors[o * 4 + 2] = rgb[2] * (k + 0.03) * foot;
      // Альфа — доля СВЕЧЕНИЯ (MESH_FS), а не непрозрачность: камень не
      // светится сам и знает, где солнце.
      colors[o * 4 + 3] = 0;
      uv[o * 2] = U[i * 2] * uk + u0;
      uv[o * 2 + 1] = U[i * 2 + 1] * uk + v0;
      o++;
    }
    for (const j of shape.idx) indices[oi++] = base + j;
    shadow(r, d, h, tx, ty, tz, bx, by, bz, sz, top * sz, rgb);
  };

  return {
    total: n,
    get done() { return at >= n; },
    step(count = ROCKS.chunk) {
      const end = Math.min(n, at + count);
      for (; at < end; at++) one(rocks[at]);
      if (at < n) return false;
      result = { positions, normals, colors, uv, indices, faces: oi / 3, verts: o, count: n, origin };
      return true;
    },
    get result() { return result; },
  };
}

/** Поле целиком, одним заходом. Этим пользуются проверки. */
export function buildRockGeometry(body, rocks, sun = null, detail = null, center = null) {
  const b = rockBuilder(body, rocks, sun, detail, center);
  while (!b.step(1e9)) { /* один заход */ }
  return b.result;
}

/**
 * Поле камней вокруг камеры: следит за телом и высотой, пересобирается
 * только когда камера ушла с прежнего места.
 */
export class RockField {
  constructor(gl, locs) {
    this.gl = gl;
    this.locs = locs;
    this.mesh = null;          // то, что рисуется сейчас
    this.origin = [0, 0, 0];   // от чего отсчитаны его вершины (доли радиуса)
    this.body = null;
    this.center = null;        // направление, вокруг которого собрано поле
    this.radius = 0;
    this.cell = 0;             // ячейка грунта, на которую уложено поле
    this.count = 0;
    this.builds = 0;
    this.job = null;           // незаконченная сборка
  }

  /**
   * @param body тело под кораблём (null — поля нет)
   * @param dir  направление на точку под камерой, локальные оси тела
   * @param alt  высота камеры над поверхностью, км
   * @returns меш поля или null
   */
  /**
   * @param cell угловой размер ячейки сетки, которой рисуется грунт:
   *        по ней камни ложатся ровно на нарисованную поверхность
   */
  update(body, dir, alt, sun = null, cell = 0) {
    if (!body || !dir || !(alt >= 0) || alt > ROCKS.maxAlt || terrainOf(body).isFlat) {
      this.clear();
      return null;
    }
    const radius = ROCKS.radiusOf(alt);

    // Новую сборку заводим, только когда центр уехал на треть поля или
    // заметно сменился масштаб. Пока она идёт, рисуется прежнее поле —
    // так переезд не мигает пустым грунтом.
    if (!this.job) {
      const moved = !this.center || this.body !== body
        // Сменилась подробность нарисованного грунта — камни надо
        // переложить (см. js/gl/scene.js, surfaceCell).
        || (cell > 0 && Math.abs(cell - this.cell) > this.cell * 0.2)
        || Math.acos(Math.max(-1, Math.min(1,
          dir.x * this.center.x + dir.y * this.center.y + dir.z * this.center.z)))
          * body.radius > radius * 0.33
        || Math.abs(radius - this.radius) > radius * 0.4;
      if (moved) {
        this.job = {
          body,
          center: { x: dir.x, y: dir.y, z: dir.z },
          radius,
          cell,
          builder: rockBuilder(body, scatterRocks(body, dir, radius), sun,
            cell > 0 ? terrainOf(body).detailForCell(cell) : null, dir),
        };
      }
    }

    if (this.job && this.job.builder.step(ROCKS.chunk)) {
      const geo = this.job.builder.result;
      this.release();
      this.mesh = geo.faces > 0 ? buildIndexedMesh(this.gl, this.locs, geo) : null;
      if (this.mesh) this.mesh.faces = geo.faces;
      this.origin = geo.origin;
      this.body = this.job.body;
      this.center = this.job.center;
      this.radius = this.job.radius;
      this.cell = this.job.cell;
      this.count = geo.count;
      this.builds++;
      this.job = null;
    }
    return this.mesh;
  }

  release() {
    if (this.mesh && this.mesh.dispose) this.mesh.dispose();
    this.mesh = null;
  }

  clear() {
    this.release();
    this.body = null;
    this.center = null;
    this.count = 0;
    this.job = null;
  }
}
