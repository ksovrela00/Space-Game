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
      // Размер: мелких много, крупных мало — так и выглядит настоящая
      // россыпь (распределение размеров у них степенное и крутое).
      const t = h[3] ** 3;
      out.push({
        dir: d,
        size: ROCKS.sizeMin + (ROCKS.sizeMax - ROCKS.sizeMin) * t,
        spin: h[1] * Math.PI * 2,
        shape: (gi + gj * 3) & 3,
      });
    }
  }
  return out;
}

// Четыре формы камня: неправильные восьмигранники. Строятся один раз и
// потом только масштабируются — своя сетка на каждый камень стоила бы
// дорого, а разглядеть разницу всё равно нельзя.
const SHAPES = (() => {
  const base = [
    [0, 1, 0], [0, -1, 0],
    [1, 0.15, 0], [-1, 0.15, 0], [0, 0.15, 1], [0, 0.15, -1],
    [0.7, 0.45, 0.7], [-0.7, 0.45, -0.7],
  ];
  const faces = [
    [0, 2, 6], [0, 6, 4], [0, 4, 3], [0, 3, 7], [0, 7, 5], [0, 5, 2],
    [1, 6, 2], [1, 4, 6], [1, 3, 4], [1, 7, 3], [1, 5, 7], [1, 2, 5],
  ];
  const out = [];
  for (let s = 0; s < 4; s++) {
    const verts = base.map((p, i) => {
      const h = hash4(s * 131 + i, 17, 3);
      // Камень слегка приплюснут — лежит, а не воткнут, — но именно
      // слегка: блин высотой в треть своей ширины с двадцати метров
      // читается как пятно на грунте, а не как предмет.
      return [
        p[0] * (0.7 + h[0] * 0.6),
        p[1] * (0.75 + h[1] * 0.45),
        p[2] * (0.7 + h[2] * 0.6),
      ];
    });
    out.push({ verts, faces });
  }
  return out;
})();

// Вершин на камень: сам камень и его тень (восьмиугольник веером).
const vertsPerRock = SHAPES[0].faces.length * 3 + 8 * 3;

/**
 * Порционный сборщик поля: геометрия в локальных осях тела и в ЕДИНИЧНОМ
 * радиусе — ровно как у плиток поверхности, поэтому рисуется той же
 * матрицей.
 *
 * Порциями, потому что на каждый камень приходится выборка рельефа:
 * поле целиком — это десяток миллисекунд, а кадр длится шестнадцать.
 */
export function rockBuilder(body, rocks, sun = null, detail = null) {
  const terrain = terrainOf(body);
  const R = body.radius;
  const n = rocks.length;
  const total = n * vertsPerRock;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 4);
  const indices = new Uint32Array(total);
  const rgb = [0, 0, 0];
  let o = 0;
  let at = 0;
  let result = null;

  // Тень камня: вытянутый в сторону от солнца многоугольник на грунте.
  // Считается тем же способом, что и тень корабля, только грубее —
  // камню хватает восьмиугольника.
  const SHADOW_SIDES = 8;
  const shadow = (r, d, h, tx, ty, tz, bx, by, bz, sz, rgb) => {
    if (!sun) return;
    // Высота солнца над горизонтом в этой точке.
    const e = sun.x * d.x + sun.y * d.y + sun.z * d.z;
    if (e < ROCKS.shadowMin) return;
    // Куда ложится тень: горизонтальная часть направления ОТ солнца.
    let ax = -(sun.x - d.x * e), ay = -(sun.y - d.y * e), az = -(sun.z - d.z * e);
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    // Длина тени = высота камня / тангенс высоты солнца.
    const tall = sz * (1 - 0.15);
    const len = Math.min(tall * Math.sqrt(Math.max(0, 1 - e * e)) / e, sz * ROCKS.shadowMax);
    // В касательных осях камня: куда именно вытягивать.
    const au = ax * tx + ay * ty + az * tz;
    const av = ax * bx + ay * by + az * bz;
    const lift = h + ROCKS.shadowLift / R;
    const cu = au * len * 0.5, cv = av * len * 0.5;     // центр тени смещён

    const dark = [rgb[0] * ROCKS.shadowDark, rgb[1] * ROCKS.shadowDark,
      rgb[2] * ROCKS.shadowDark];
    const put = (u, v) => {
      positions[o * 3] = d.x * lift + tx * u + bx * v;
      positions[o * 3 + 1] = d.y * lift + ty * u + by * v;
      positions[o * 3 + 2] = d.z * lift + tz * u + bz * v;
      normals[o * 3] = d.x; normals[o * 3 + 1] = d.y; normals[o * 3 + 2] = d.z;
      colors[o * 4] = dark[0]; colors[o * 4 + 1] = dark[1]; colors[o * 4 + 2] = dark[2];
      colors[o * 4 + 3] = 1;
      indices[o] = o;
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
    // всё вокруг. Разброс по камням и по граням — чтобы россыпь не
    // выглядела набором одинаковых серых пятен.
    const k = 0.68 + (r.shape & 1) * 0.12;

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

    const shape = SHAPES[r.shape];
    // Камень сидит в грунте на седьмую часть высоты: достаточно, чтобы
    // он не выглядел положенным сверху, и мало, чтобы не съесть его.
    const sink = 0.15;
    const place = (p) => {
      const px = (p[0] * cs - p[2] * sn) * sz;
      const pz = (p[0] * sn + p[2] * cs) * sz;
      const py = (p[1] - sink) * sz;
      return [
        d.x * (h + py) + tx * px + bx * pz,
        d.y * (h + py) + ty * px + by * pz,
        d.z * (h + py) + tz * px + bz * pz,
      ];
    };
    for (const f of shape.faces) {
      const a = place(shape.verts[f[0]]);
      const b = place(shape.verts[f[1]]);
      const c = place(shape.verts[f[2]]);
      // Плоское затенение: нормаль на грань, как у всех моделей здесь.
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      // Грань чуть светлее или темнее соседней: у скола нет двух
      // одинаковых площадок, и без этого камень выходит литым.
      const jit = 0.86 + ((nx * 13.7 + nz * 7.3) % 1 + 1) % 1 * 0.28;
      const cr = rgb[0] * k * jit, cg = rgb[1] * k * jit, cb = rgb[2] * (k + 0.03) * jit;
      for (const p of [a, b, c]) {
        positions[o * 3] = p[0];
        positions[o * 3 + 1] = p[1];
        positions[o * 3 + 2] = p[2];
        normals[o * 3] = nx; normals[o * 3 + 1] = ny; normals[o * 3 + 2] = nz;
        colors[o * 4] = cr; colors[o * 4 + 1] = cg; colors[o * 4 + 2] = cb;
        colors[o * 4 + 3] = 1;
        indices[o] = o;
        o++;
      }
    }
    shadow(r, d, h, tx, ty, tz, bx, by, bz, sz, rgb);
  };

  return {
    total: n,
    get done() { return at >= n; },
    step(count = ROCKS.chunk) {
      const end = Math.min(n, at + count);
      for (; at < end; at++) one(rocks[at]);
      if (at < n) return false;
      result = { positions, normals, colors, indices, faces: o / 3, count: n };
      return true;
    },
    get result() { return result; },
  };
}

/** Поле целиком, одним заходом. Этим пользуются проверки. */
export function buildRockGeometry(body, rocks, sun = null, detail = null) {
  const b = rockBuilder(body, rocks, sun, detail);
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
            cell > 0 ? terrainOf(body).detailForCell(cell) : null),
        };
      }
    }

    if (this.job && this.job.builder.step(ROCKS.chunk)) {
      const geo = this.job.builder.result;
      this.release();
      this.mesh = geo.faces > 0 ? buildIndexedMesh(this.gl, this.locs, geo) : null;
      if (this.mesh) this.mesh.faces = geo.faces;
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
