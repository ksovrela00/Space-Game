// Подробные заплатки поверхности под кораблём.
//
// Даже икосфера уровня 6 — это треугольники по 20–30 км: с высоты
// километра поверхность под кораблём превращается в одну плоскую грань.
// Поэтому вблизи рисуется набор вложенных заплаток, центрированных на
// точке прямо под камерой: каждая следующая вдвое мельче предыдущей и
// занимает её середину (это «геометрический клипмап»).
//
//   уровень 0:  |###############|   грубая, во всю видимую площадку
//   уровень 1:      |#######|       вдвое мельче, в середине нулевой
//   уровень 2:        |###|         и так далее
//
// Середина каждой заплатки вырезана ровно по границе следующей, поэтому
// заплатки не перекрываются — только стыкуются. На стыке разрешения
// разные (T-образные вершины), и щели закрываются «юбками»: полосками
// геометрии, уходящими вниз по краям.
//
// Внешний край самой грубой заплатки всегда лежит ЗА горизонтом
// (покрытие 1.35 от углового радиуса горизонта), поэтому переход
// «заплатка — сфера» не виден: он под линией горизонта.
//
// Сфера под заплатками рисуется с трафаретом (см. js/gl/scene.js): её
// грубые грани могут отклоняться от подробной поверхности на километры
// и иначе торчали бы сквозь землю.

import { terrainOf } from './terrain.js';
import { edgeAngle, computeNormals } from './icosphere.js';
import { buildIndexedMesh } from './mesh.js';
import { localDir, altitudeOf } from '../game/surface.js';

export const PATCH = {
  res: 32,           // ячеек по стороне (кратно 4: по границе выреза)
  hole: 0.5,         // доля стороны, отданная следующему уровню
  maxLevels: 6,
  cover: 1.35,       // во сколько раз заплатка шире горизонта
  maxHalf: 0.5,      // рад — предел половины углового размера
  minAltKm: 0.001,
  // Самая мелкая ячейка: четверть высоты, но не мельче 20 метров.
  // Мельче нет смысла — всё, что меньше, показывает шейдер
  // (js/gl/detail.js), а пересобирать набор ради двухметровых деталей
  // пришлось бы несколько раз в секунду, и новая геометрия появлялась
  // бы прямо на глазах.
  cellOfAlt: 0.25,
  minCellKm: 0.02,
};

const smooth01 = (t) => (t <= 0 ? 0 : (t >= 1 ? 1 : t * t * (3 - 2 * t)));

/**
 * Нужны ли заплатки и какие. Возвращает null, если сфера и так не хуже.
 * @param alt высота над поверхностью, км
 * @param sphereLevel текущий уровень икосферы тела
 */
export function patchPlan(body, alt, sphereLevel) {
  const terrain = terrainOf(body);
  if (terrain.isFlat) return null;
  const R = body.radius;
  const a = Math.max(PATCH.minAltKm, alt);
  // Угловой радиус горизонта с высоты a.
  const theta = Math.acos(Math.max(-1, Math.min(1, R / (R + a))));
  const half = Math.min(PATCH.maxHalf, PATCH.cover * theta);
  const cell0 = 2 * half / PATCH.res;
  const sphereCell = edgeAngle(sphereLevel);
  if (cell0 > sphereCell * 0.8) return null;

  const target = Math.max(PATCH.cellOfAlt * a, PATCH.minCellKm) / R;
  let levels = 1 + Math.ceil(Math.log2(Math.max(1, cell0 / target)));
  levels = Math.max(1, Math.min(PATCH.maxLevels, levels));
  return {
    half, levels, res: PATCH.res, hole: PATCH.hole, sphereLevel, sphereCell,
    band: a,          // высота, по которой построен план (см. SurfacePatch)
  };
}

// Касательные оси в точке center (правая тройка: U x V = center).
function tangentFrame(center, u, v) {
  const helper = Math.abs(center.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  u.x = helper.y * center.z - helper.z * center.y;
  u.y = helper.z * center.x - helper.x * center.z;
  u.z = helper.x * center.y - helper.y * center.x;
  let l = Math.hypot(u.x, u.y, u.z) || 1;
  u.x /= l; u.y /= l; u.z /= l;
  v.x = center.y * u.z - center.z * u.y;
  v.y = center.z * u.x - center.x * u.z;
  v.z = center.x * u.y - center.y * u.x;
  l = Math.hypot(v.x, v.y, v.z) || 1;
  v.x /= l; v.y /= l; v.z /= l;
}

/**
 * Порционный сборщик одной заплатки. Геометрия — в единичном радиусе, в
 * локальных осях тела: рисуется той же матрицей, что и сфера.
 *
 * @param center    направление центра (локальные оси тела), единичное
 * @param half      половина углового размера, рад
 * @param holeFrac  доля стороны под вырез (0 — без выреза)
 * @param detail    бюджет детализации заплатки
 * @param parent    бюджет детализации того, что под ней (сфера или
 *                  предыдущий уровень) — к нему высота сводится на кромке
 * @param parentCell размер ячейки родителя, рад (на него считается юбка)
 */
export function patchBuilder(body, center, half, holeFrac, detail, parent, parentCell) {
  const terrain = terrainOf(body);
  const res = PATCH.res;
  const n = res + 1;
  const gridVerts = n * n;

  const hole = holeFrac > 0 ? Math.round(res * holeFrac / 2) : 0;   // ячеек от центра
  const lo = res / 2 - hole, hi = res / 2 + hole;                   // границы выреза
  const holeQuads = hole > 0 ? (hi - lo) * (hi - lo) : 0;
  const gridQuads = res * res - holeQuads;

  const outerRing = 4 * res;
  const holeRing = hole > 0 ? 4 * (hi - lo) : 0;
  const skirtVerts = outerRing + holeRing;
  const skirtQuads = outerRing + holeRing;

  const positions = new Float32Array((gridVerts + skirtVerts) * 3);
  const normals = new Float32Array((gridVerts + skirtVerts) * 3);
  const colors = new Float32Array((gridVerts + skirtVerts) * 4);
  const indices = new Uint32Array((gridQuads + skirtQuads) * 6);

  const U = { x: 0, y: 0, z: 0 }, V = { x: 0, y: 0, z: 0 };
  tangentFrame(center, U, V);

  // Глубина юбки: перекрыть и огранку родителя, и расхождение высот
  // из-за разной детализации. Юбка всегда за горизонтом, так что
  // запас можно брать щедрый.
  const sag = parentCell * parentCell / 8;
  const drop = sag * 3 + terrain.detailGap(parent) * 1.5 + 1e-6;

  const rgb = [0, 0, 0];
  const dir = { x: 0, y: 0, z: 0 };
  let idx = 0;                 // индекс текущей вершины сетки
  let result = null;

  // Направление вершины сетки (гномоническая проекция квадрата на сферу).
  const vertexDir = (i, j, out) => {
    const su = -1 + 2 * i / res, sv = -1 + 2 * j / res;
    const tu = Math.tan(half * su), tv = Math.tan(half * sv);
    let x = center.x + U.x * tu + V.x * tv;
    let y = center.y + U.y * tu + V.y * tv;
    let z = center.z + U.z * tu + V.z * tv;
    const l = Math.hypot(x, y, z) || 1;
    out.x = x / l; out.y = y / l; out.z = z / l;
    return Math.max(Math.abs(su), Math.abs(sv));
  };

  const vertex = (i, j, out) => {
    const edgeT = vertexDir(i, j, out);
    // К кромке высота сводится к родительской: там заплатка стыкуется с
    // тем, что под ней, и ступенька была бы видна.
    const w = 1 - smooth01((edgeT - 0.80) / 0.20);
    let h = terrain.sample(out.x, out.y, out.z, detail, rgb);
    if (w < 0.999) {
      const hp = terrain.sample(out.x, out.y, out.z, parent, null);
      h = hp + (h - hp) * w;
    }
    return h;
  };

  return {
    body, total: gridVerts,
    get result() { return result; },
    step(count = 1 << 30) {
      const end = Math.min(gridVerts, idx + count);
      for (; idx < end; idx++) {
        const i = idx % n, j = (idx - i) / n;
        // Вершины внутри выреза не участвуют ни в одном треугольнике —
        // считать для них рельеф незачем (это четверть сетки).
        if (hole > 0 && i > lo && i < hi && j > lo && j < hi) {
          vertexDir(i, j, dir);
          positions[idx * 3] = dir.x;
          positions[idx * 3 + 1] = dir.y;
          positions[idx * 3 + 2] = dir.z;
          continue;
        }
        const h = vertex(i, j, dir);
        const r = 1 + h;
        positions[idx * 3] = dir.x * r;
        positions[idx * 3 + 1] = dir.y * r;
        positions[idx * 3 + 2] = dir.z * r;
        colors[idx * 4] = rgb[0];
        colors[idx * 4 + 1] = rgb[1];
        colors[idx * 4 + 2] = rgb[2];
        colors[idx * 4 + 3] = 0;
      }
      if (idx < gridVerts) return false;

      // --- Треугольники сетки (вырез посередине пропускаем).
      let o = 0;
      for (let j = 0; j < res; j++) {
        for (let i = 0; i < res; i++) {
          if (hole > 0 && i >= lo && i < hi && j >= lo && j < hi) continue;
          const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
          // Обход против часовой при взгляде снаружи (U x V = center).
          indices[o++] = a; indices[o++] = b; indices[o++] = d;
          indices[o++] = a; indices[o++] = d; indices[o++] = c;
        }
      }
      const gridIdxCount = o;
      computeNormals(positions, indices.subarray(0, gridIdxCount), normals);

      // --- Юбки по внешнему краю и по кромке выреза.
      let vp = gridVerts;
      const ring = (path) => {
        const first = vp;
        for (let k = 0; k < path.length; k++) {
          const src = path[k];
          const s = vp++;
          const r = Math.hypot(
            positions[src * 3], positions[src * 3 + 1], positions[src * 3 + 2]);
          const k2 = (r - drop) / (r || 1);
          positions[s * 3] = positions[src * 3] * k2;
          positions[s * 3 + 1] = positions[src * 3 + 1] * k2;
          positions[s * 3 + 2] = positions[src * 3 + 2] * k2;
          normals[s * 3] = normals[src * 3];
          normals[s * 3 + 1] = normals[src * 3 + 1];
          normals[s * 3 + 2] = normals[src * 3 + 2];
          colors[s * 4] = colors[src * 4];
          colors[s * 4 + 1] = colors[src * 4 + 1];
          colors[s * 4 + 2] = colors[src * 4 + 2];
          colors[s * 4 + 3] = 0;
        }
        for (let k = 0; k < path.length; k++) {
          const a = path[k], b = path[(k + 1) % path.length];
          const sa = first + k, sb = first + (k + 1) % path.length;
          indices[o++] = a; indices[o++] = b; indices[o++] = sb;
          indices[o++] = a; indices[o++] = sb; indices[o++] = sa;
        }
      };

      const outer = [];
      for (let i = 0; i < res; i++) outer.push(0 * n + i);
      for (let j = 0; j < res; j++) outer.push(j * n + res);
      for (let i = res; i > 0; i--) outer.push(res * n + i);
      for (let j = res; j > 0; j--) outer.push(j * n + 0);
      ring(outer);

      if (hole > 0) {
        const inner = [];
        for (let i = lo; i < hi; i++) inner.push(lo * n + i);
        for (let j = lo; j < hi; j++) inner.push(j * n + hi);
        for (let i = hi; i > lo; i--) inner.push(hi * n + i);
        for (let j = hi; j > lo; j--) inner.push(j * n + lo);
        ring(inner);
      }

      result = {
        positions, normals, colors,
        indices: indices.subarray(0, o),
        faces: o / 3,
        half, cell: 2 * half / res, levelsHole: holeFrac,
        center: { x: center.x, y: center.y, z: center.z },
      };
      return true;
    },
  };
}

/**
 * Набор вложенных заплаток для одного тела. Пересобирается целиком и
 * подменяется разом: если обновить только часть уровней, вырезы
 * перестанут совпадать с границами соседних, и в земле появятся щели.
 */
export class SurfacePatch {
  constructor(gl, locs) {
    this.gl = gl;
    this.locs = locs;
    this.body = null;
    this.cur = null;          // {meshes, plan, center} — готовый набор
    this.next = null;         // собираемый набор
    this.altBand = 0;         // «полка» высоты, по которой построен план
    this.rebuilds = 0;
  }

  clear() {
    this.body = null;
    this.cur = null;
    this.next = null;
    this.altBand = 0;
  }

  /** Готовые меши для отрисовки (может быть пусто, пока собирается). */
  get meshes() {
    return this.cur ? this.cur.meshes : null;
  }

  get levels() { return this.cur ? this.cur.meshes.length : 0; }

  /**
   * Раз в кадр: решить, нужны ли заплатки, и достроить их за отведённое
   * время. Возвращает тело, для которого заплатки готовы, или null.
   */
  update(body, camPos, sphereLevel, msBudget = 4) {
    if (!body) { this.clear(); return null; }
    const info = altitudeOf(body, camPos, this._info || (this._info = { dir: { x: 0, y: 0, z: 0 } }));

    // План считается не по самой высоте, а по её «полке» — ближайшей
    // степени двойки с запасом 1.6х на возврат. Иначе число уровней,
    // округляемое вверх, щёлкает туда-обратно от малейшего дрожания
    // высоты, и набор пересобирается каждый кадр: именно так рельеф
    // «менялся на глазах» при зависании над поверхностью.
    const alt = Math.max(PATCH.minAltKm, info.alt);
    if (!this.altBand || alt > this.altBand * 1.6 || alt < this.altBand / 1.6) {
      this.altBand = 2 ** Math.round(Math.log2(alt));
    }
    const plan = patchPlan(body, this.altBand, sphereLevel);
    if (!plan) { this.clear(); return null; }

    if (this.body !== body) { this.cur = null; this.next = null; this.body = body; }

    const center = localDir(body, camPos, this._center || (this._center = { x: 0, y: 0, z: 0 }));
    const innerHalf = plan.half / 2 ** (plan.levels - 1);

    // Пересборка нужна, если сменилась «полка» высоты, сменился уровень
    // сферы (к его детализации сводится кромка самой грубой заплатки)
    // или центр уехал от прежнего слишком далеко.
    if (!this.next) {
      const stale = !this.cur ||
        this.cur.plan.band !== plan.band ||
        this.cur.plan.sphereLevel !== plan.sphereLevel ||
        // Порог сдвига центра — три четверти самой мелкой заплатки.
        // Меньше нельзя: пересборка стоит десятки миллисекунд, а у земли
        // самая мелкая заплатка — это десятки метров. Отставший центр
        // означает лишь, что под кораблём земля чуть грубее.
        angleBetween(this.cur.center, center) > innerHalf * 0.75;
      if (stale) this.startBuild(body, center, plan);
    }

    if (this.next) this.pump(msBudget);
    return this.cur ? body : null;
  }

  startBuild(body, center, plan) {
    const terrain = terrainOf(body);
    const builders = [];
    let parent = terrain.detailForCell(plan.sphereCell);
    let parentCell = plan.sphereCell;
    for (let k = 0; k < plan.levels; k++) {
      const half = plan.half / 2 ** k;
      const cell = 2 * half / plan.res;
      const detail = terrain.detailForCell(cell);
      const holeFrac = k < plan.levels - 1 ? plan.hole : 0;
      builders.push(patchBuilder(body, center, half, holeFrac, detail, parent, parentCell));
      parent = detail;
      parentCell = cell;
    }
    this.next = {
      plan,
      center: { x: center.x, y: center.y, z: center.z },
      builders,
      done: [],
      at: 0,
    };
    this.rebuilds++;
  }

  pump(msBudget) {
    const t0 = performance.now();
    const N = this.next;
    while (N.at < N.builders.length) {
      const b = N.builders[N.at];
      if (b.step(1536)) {
        N.done.push(b.result);
        N.at++;
      }
      if (performance.now() - t0 >= msBudget) return;
    }
    // Готово: заливаем в GPU и подменяем набор целиком.
    const meshes = [];
    for (const geo of N.done) {
      const mesh = buildIndexedMesh(this.gl, this.locs, geo);
      mesh.faces = geo.faces;
      mesh.cellAngle = geo.cell;      // по нему шейдер знает, что досчитать
      meshes.push(mesh);
    }
    if (this.cur) for (const m of this.cur.meshes) m.dispose();
    this.cur = { plan: N.plan, center: N.center, meshes };
    this.next = null;
  }
}

const angleBetween = (a, b) => {
  const d = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.max(-1, Math.min(1, d)));
};
