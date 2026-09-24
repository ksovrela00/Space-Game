// Сборка геометрии наземного города.
//
// Город — это сто тысяч граней, и собираются они ПОРЦИЯМИ, как поле
// камней (js/gl/rocks.js): целиком это добрая десятая доля секунды, то
// есть заметный рывок ровно в тот момент, когда город появляется в
// кадре. Порциями рывка нет вовсе — до готовности город просто ещё не
// нарисован, а с высоты подлёта его и так не видно.
//
// Геометрия — В КИЛОМЕТРАХ и в осях города, а не в долях радиуса тела,
// как у камней и плиток. Разница принципиальная: в единичном радиусе
// метровая деталь — это 4·10⁻⁷, и float32 у единицы такой шаг уже почти
// не различает. Камням это сходит с рук (камень — бесформенная глыба), а
// у здания с окнами так поехали бы все грани разом. Поэтому город
// рисуется как обычный предмет — со своим положением и своим базисом,
// ровно как станция.
//
// Собирается ОДИН РАЗ на город и потом только рисуется: планировка
// неподвижна относительно грунта, а вращение тела уносит с собой базис.

import { CITY_PARTS } from '../models/city.parts.js';
import { buildIndexedMesh } from './mesh.js';

/** Сколько треугольников выйдет: нужно, чтобы сразу завести буферы. */
export function cityTris(plan) {
  let tris = 0;
  for (const it of plan.parts) {
    const p = CITY_PARTS[it.p];
    if (!p) continue;
    for (let i = 0; i < p.faces.length;) {
      const n = p.faces[i];
      tris += Math.max(0, n - 2);
      i += n + 2;
    }
  }
  return tris + plan.plates.length * 2 + plan.lamps.length * 12;
}

// Куб огня: восемь вершин и двенадцать треугольников. Огонь на мачте
// виден со всех сторон, поэтому именно куб, а не плашка: плашка с
// земли выглядит линией, а с обратной стороны исчезает вовсе.
const CUBE = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const CUBE_TRIS = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
  [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
];

/**
 * Порционный сборщик города.
 *
 * @param plan планировка (js/models/city.js, cityPlan)
 * @returns объект с step(count) и result
 */
export function cityBuilder(plan) {
  const tris = cityTris(plan);
  const total = tris * 3;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 4);
  const indices = new Uint32Array(total);
  let o = 0;

  // Единый список работы: детали, потом плашки, потом огни. Порция
  // отсчитывается по нему, а не по деталям — иначе одна башня в две с
  // половиной тысячи граней съедала бы весь кадр.
  const jobs = [];
  for (const it of plan.parts) jobs.push({ kind: 'part', it });
  for (const it of plan.plates) jobs.push({ kind: 'plate', it });
  for (const it of plan.lamps) jobs.push({ kind: 'lamp', it });
  let at = 0;
  let result = null;

  const put = (x, y, z, nx, ny, nz, r, g, b, em) => {
    positions[o * 3] = x; positions[o * 3 + 1] = y; positions[o * 3 + 2] = z;
    normals[o * 3] = nx; normals[o * 3 + 1] = ny; normals[o * 3 + 2] = nz;
    colors[o * 4] = r; colors[o * 4 + 1] = g; colors[o * 4 + 2] = b;
    colors[o * 4 + 3] = em;
    indices[o] = o;
    o++;
  };

  // Треугольник с нормалью из порядка вершин: затенение плоское, как у
  // всех рукотворных предметов в игре.
  const tri = (a, b, c, r, g, bl, em) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    put(a[0], a[1], a[2], nx, ny, nz, r, g, bl, em);
    put(b[0], b[1], b[2], nx, ny, nz, r, g, bl, em);
    put(c[0], c[1], c[2], nx, ny, nz, r, g, bl, em);
  };

  const MM = 1e-3;     // деталь хранится в тысячных своего размера

  const onePart = (it) => {
    const p = CITY_PARTS[it.p];
    if (!p) return;
    const k = it.s * MM;
    const cs = Math.cos(it.rot || 0), sn = Math.sin(it.rot || 0);
    const dim = it.dim === undefined ? 1 : it.dim;
    // Вершины детали, развёрнутые и поставленные на место. Разворот —
    // вокруг местной вертикали: дома не заваливаются.
    const n = p.verts.length / 3;
    const vx = new Float64Array(n), vy = new Float64Array(n), vz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = p.verts[i * 3] * k, y = p.verts[i * 3 + 1] * k, z = p.verts[i * 3 + 2] * k;
      vx[i] = it.x + x * cs + z * sn;
      vy[i] = (it.y || 0) + y;
      vz[i] = it.z - x * sn + z * cs;
    }
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    for (let i = 0; i < p.faces.length;) {
      const cnt = p.faces[i++];
      const first = i;
      i += cnt;
      const pi = p.faces[i++] * 4;
      const r = (p.pal[pi] / 255) * dim;
      const g = (p.pal[pi + 1] / 255) * dim;
      const bl = (p.pal[pi + 2] / 255) * dim;
      const em = p.pal[pi + 3] / 255;
      for (let t = 1; t + 1 < cnt; t++) {
        const i0 = p.faces[first], i1 = p.faces[first + t], i2 = p.faces[first + t + 1];
        a[0] = vx[i0]; a[1] = vy[i0]; a[2] = vz[i0];
        b[0] = vx[i1]; b[1] = vy[i1]; b[2] = vz[i1];
        c[0] = vx[i2]; c[1] = vy[i2]; c[2] = vz[i2];
        tri(a, b, c, r, g, bl, em);
      }
    }
  };

  const onePlate = (it) => {
    const r = it.c[0] / 255, g = it.c[1] / 255, b = it.c[2] / 255;
    const em = it.glow || 0;
    const y = it.y || 0;
    const x0 = it.x - it.hw, x1 = it.x + it.hw;
    const z0 = it.z - it.hd, z1 = it.z + it.hd;
    // Порядок вершин — против часовой при взгляде сверху: нормаль вверх.
    tri([x0, y, z0], [x0, y, z1], [x1, y, z1], r, g, b, em);
    tri([x0, y, z0], [x1, y, z1], [x1, y, z0], r, g, b, em);
  };

  const oneLamp = (it) => {
    const r = it.c[0] / 255, g = it.c[1] / 255, b = it.c[2] / 255;
    const s = it.r;
    const v = CUBE.map((p) => [it.x + p[0] * s, it.y + p[1] * s, it.z + p[2] * s]);
    for (const t of CUBE_TRIS) tri(v[t[0]], v[t[1]], v[t[2]], r, g, b, 1);
  };

  return {
    total: jobs.length,
    tris,
    get done() { return at >= jobs.length; },
    /**
     * Порция считается В ТРЕУГОЛЬНИКАХ, а не в предметах.
     *
     * Предметы здесь разной цены: башня — две с половиной тысячи граней,
     * фонарь — двенадцать. Считая штуками, приходится равняться на
     * башню, и тогда шестьсот фонарей растягиваются на сотню кадров;
     * равняясь на фонарь, одна башня съедает кадр целиком. Один предмет
     * за раз берётся всегда — иначе сборка встала бы на первой же башне,
     * которая больше бюджета.
     */
    step(budget = 4000) {
      const from = o;
      while (at < jobs.length) {
        const j = jobs[at++];
        if (j.kind === 'part') onePart(j.it);
        else if (j.kind === 'plate') onePlate(j.it);
        else oneLamp(j.it);
        if ((o - from) / 3 >= budget) break;
      }
      if (at < jobs.length) return false;
      result = { positions, normals, colors, indices, faces: o / 3, count: jobs.length };
      return true;
    },
    get result() { return result; },
  };
}

/** Город целиком, одним заходом. Этим пользуются проверки. */
export function buildCityGeometry(plan) {
  const b = cityBuilder(plan);
  while (!b.step(1e9)) { /* один заход */ }
  return b.result;
}

/**
 * Город в памяти видеокарты: собирается, когда до него уже есть дело, и
 * освобождается, когда корабль ушёл из системы.
 *
 * Пересборки нет: планировка не зависит ни от высоты, ни от положения
 * камеры — в отличие от поля камней, которое живёт вокруг корабля.
 */
export class CityField {
  constructor(gl, locs) {
    this.gl = gl;
    this.locs = locs;
    this.mesh = null;
    this.city = null;
    this.job = null;
    this.builds = 0;
  }

  /**
   * @param city город (js/game/city.js) или null
   * @param chunk треугольников за кадр
   * @returns меш или null, пока не собран
   */
  update(city, chunk = 4000) {
    if (!city) { this.clear(); return null; }
    if (this.city === city && this.mesh) return this.mesh;
    if (!this.job || this.job.city !== city) {
      this.release();
      this.city = null;
      this.job = { city, builder: cityBuilder(city.plan) };
    }
    if (this.job.builder.step(chunk)) {
      const geo = this.job.builder.result;
      this.mesh = geo.faces > 0 ? buildIndexedMesh(this.gl, this.locs, geo) : null;
      if (this.mesh) this.mesh.faces = geo.faces;
      this.city = this.job.city;
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
    this.city = null;
    this.job = null;
  }
}
