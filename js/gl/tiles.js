// Плитки поверхности: сборка, запекание, кэш.
//
// Одна плитка — кусок сферы, привязанный к телу (см. js/gl/quadtree.js).
// Собирается она один раз: сетка на CPU порциями в фоне, затем нормали
// и цвета в буферы, затем один проход запекания в свою текстуру. Дальше
// плитка только рисуется и живёт в кэше, пока не понадобится место.
//
// Поэтому при движении корабля не пересчитывается ничего: подгружаются
// новые уровни, вытесняются далёкие. Корневые шесть плиток (грани куба)
// строятся сразу и не вытесняются — это «поверхность планеты целиком».

import { terrainOf } from './terrain.js';
import { computeNormals } from './icosphere.js';
import { buildIndexedMesh } from './mesh.js';
import { bakeUniforms } from './detail.js';
import { createBakeTexture, CUBE_FACES } from './bake.js';
import {
  TILE_GRID, TILE_TEX, TILE_MAX_LEVEL, faceDir, tileBounds, tileKey,
  tileCellAngle, tileTexelAngle, selectTiles,
} from './quadtree.js';

export const TILE_BUDGET = 440;      // сколько плиток держим в памяти (~200 КБ каждая)
const BUILD_CHUNK = 512;             // вершин за один заход
const TILE_TOL = 5;                  // допустимая ошибка геометрии, пикселей
// Допуск на тексель: он держит соседние плитки в пределах двух уровней
// друг от друга (см. selectTiles). В отличие от допуска на геометрию,
// под заполненность кэша НЕ подстраивается — иначе на стыке разных
// уровней снова поедут нормали.
//
// Величина не с потолка: шейдер добавляет к текстуре ровно столько
// масштабов, сколько влезает в его бюджет (D_FIT в js/gl/detail.js), и
// при 40 пикселях на тексель этого хватает, чтобы дотянуть деталь до
// пары пикселей на любой нарисованной плитке. Замер на настоявшемся
// кадре: расхождение нормали на стыке уровней ≤1.1° против 33° без
// этого условия, ценой роста числа плиток примерно в полтора раза.
export const TILE_TEXEL_TOL = 40;    // пикселей на тексель
const KEEP_FRAMES = 180;             // сколько кадров плитка живёт без надобности
const TARGET_DRAW = 220;             // сколько плиток в кадре считаем нормой

/**
 * Порционный сборщик геометрии плитки. Меш живёт в единичном радиусе, в
 * локальных осях тела, поэтому рисуется той же матрицей, что и сфера.
 */
export function tileBuilder(body, t) {
  const terrain = terrainOf(body);
  const detail = terrain.detailForCell(tileCellAngle(t.level));
  const b = tileBounds(t.level, t.tx, t.ty);
  const g = TILE_GRID, n = g + 1;
  const gridVerts = n * n;
  const ring = 4 * g;                              // юбка по краю

  const positions = new Float32Array((gridVerts + ring) * 3);
  const normals = new Float32Array((gridVerts + ring) * 3);
  const colors = new Float32Array((gridVerts + ring) * 4);
  const uv = new Float32Array((gridVerts + ring) * 2);
  // Вершин меньше 65536, поэтому индексы короткие: на плитку это 13 КБ
  // вместо 26, а плиток в кэше сотни.
  const indices = new Uint16Array((g * g + ring) * 6);

  // Юбка уходит вниз на то, что этот уровень не в состоянии показать:
  // на стыке с более грубым соседом иначе видна щель.
  const cell = tileCellAngle(t.level);
  const drop = terrain.detailGap(detail) * 1.5 + cell * cell / 8 * 3 + 1e-7;

  const rgb = [0, 0, 0];
  const dir = { x: 0, y: 0, z: 0 };
  let i = 0;
  let result = null;

  return {
    total: gridVerts,
    step(count = BUILD_CHUNK) {
      const end = Math.min(gridVerts, i + count);
      for (; i < end; i++) {
        const ix = i % n, iy = (i - ix) / n;
        const su = b.u0 + (b.u1 - b.u0) * (ix / g);
        const sv = b.v0 + (b.v1 - b.v0) * (iy / g);
        faceDir(t.face, su, sv, dir);
        const h = 1 + terrain.sample(dir.x, dir.y, dir.z, detail, rgb);
        positions[i * 3] = dir.x * h;
        positions[i * 3 + 1] = dir.y * h;
        positions[i * 3 + 2] = dir.z * h;
        colors[i * 4] = rgb[0];
        colors[i * 4 + 1] = rgb[1];
        colors[i * 4 + 2] = rgb[2];
        colors[i * 4 + 3] = 0;
        uv[i * 2] = ix / g;
        uv[i * 2 + 1] = iy / g;
      }
      if (i < gridVerts) return false;

      let o = 0;
      for (let y = 0; y < g; y++) {
        for (let x = 0; x < g; x++) {
          const a = y * n + x, b2 = a + 1, c = a + n, d = c + 1;
          indices[o++] = a; indices[o++] = b2; indices[o++] = d;
          indices[o++] = a; indices[o++] = d; indices[o++] = c;
        }
      }
      computeNormals(positions, indices.subarray(0, o), normals);

      // Юбка по периметру: те же вершины, опущенные вниз.
      const path = [];
      for (let x = 0; x < g; x++) path.push(x);
      for (let y = 0; y < g; y++) path.push(y * n + g);
      for (let x = g; x > 0; x--) path.push(g * n + x);
      for (let y = g; y > 0; y--) path.push(y * n);
      const first = gridVerts;
      for (let k = 0; k < path.length; k++) {
        const src = path[k], s = first + k;
        const r = Math.hypot(
          positions[src * 3], positions[src * 3 + 1], positions[src * 3 + 2]);
        const k2 = (r - drop) / (r || 1);
        for (let c2 = 0; c2 < 3; c2++) {
          positions[s * 3 + c2] = positions[src * 3 + c2] * k2;
          normals[s * 3 + c2] = normals[src * 3 + c2];
        }
        for (let c2 = 0; c2 < 4; c2++) colors[s * 4 + c2] = colors[src * 4 + c2];
        uv[s * 2] = uv[src * 2];
        uv[s * 2 + 1] = uv[src * 2 + 1];
      }
      for (let k = 0; k < path.length; k++) {
        const a = path[k], b2 = path[(k + 1) % path.length];
        const sa = first + k, sb = first + (k + 1) % path.length;
        indices[o++] = a; indices[o++] = b2; indices[o++] = sb;
        indices[o++] = a; indices[o++] = sb; indices[o++] = sa;
      }

      result = {
        positions, normals, colors, uv,
        indices: indices.subarray(0, o),
        faces: o / 3,
        level: t.level,
      };
      return true;
    },
    get result() { return result; },
  };
}

/**
 * Набор плиток одного тела: выбор, сборка по бюджету, кэш с вытеснением.
 */
export class TileSet {
  constructor(gl, locs, baker, bakeProg, quad) {
    this.gl = gl;
    this.locs = locs;
    this.baker = baker;
    this.prog = bakeProg;
    this.quad = quad;
    this.body = null;
    this.tiles = new Map();
    this.wanted = [];
    this.building = null;
    this.frame = 0;
    this.draw = [];
    this.built = 0;
    this.tolScale = 1;
    this.evicted = 0;
    this.tris = 0;
  }

  clear() {
    for (const t of this.tiles.values()) this.release(t);
    this.tiles.clear();
    this.wanted.length = 0;
    this.building = null;
    this.draw.length = 0;
    this.body = null;
  }

  release(t) {
    if (t.mesh) t.mesh.dispose();
    if (t.tex) this.baker.dispose(t.tex);
    t.mesh = null;
    t.tex = null;
  }

  get(key) { return this.tiles.get(key); }

  /**
   * Выбрать и достроить плитки для тела. Возвращает список готовых
   * плиток для отрисовки.
   * @param camDir локальное направление на камеру (единичное)
   * @param camAlt высота камеры над сферой, км
   */
  update(body, camDir, camAlt, focal, msBudget = 4) {
    if (!body) { if (this.body) this.clear(); return this.draw; }
    if (this.body !== body) { this.clear(); this.body = body; }
    const terrain = terrainOf(body);
    this.frame++;
    this.wanted.length = 0;

    const ctx = {
      radius: body.radius,
      camDir,
      camAlt,
      focal,
      // Допуск подстраивается под заполненность кэша: когда плиток
      // больше, чем можно держать, требования снижаются сами. Иначе
      // набор не влезает, плитки вытесняются и тут же строятся снова —
      // кэш молотит вхолостую, а картинка дёргается.
      tol: TILE_TOL * this.tolScale * Math.max(1, (this.tiles.size / TILE_BUDGET) ** 2),
      texelTol: TILE_TEXEL_TOL,
      maxLevel: TILE_MAX_LEVEL,
      relief: terrain.ampUp,
      errorOf: (level) => terrain.meshError(terrain.detailForCell(tileCellAngle(level)))
        + tileCellAngle(level) * tileCellAngle(level) / 8,
      texelOf: (level) => tileTexelAngle(level),
      ready: (t) => {
        const e = this.tiles.get(tileKey(t.face, t.level, t.tx, t.ty));
        return !!(e && e.mesh);
      },
      want: (t, err) => {
        this.wanted.push({ t, err });
        // Заказанную плитку вытеснять нельзя: её как раз строят.
        const e = this.tiles.get(tileKey(t.face, t.level, t.tx, t.ty));
        if (e) e.used = this.frame;
      },
    };

    selectTiles(ctx, this.draw);

    // Допуск подстраивается под число плиток в кадре. У процедурного
    // рельефа деталь есть на любом масштабе, поэтому фиксированный
    // допуск в пикселях у поверхности требует дробления почти без дна:
    // выходит миллион треугольников и сотни вызовов там, где глазу
    // хватает сотни плиток.
    if (this.draw.length > TARGET_DRAW) {
      this.tolScale = Math.min(80, this.tolScale * 1.12);
    } else if (this.draw.length < TARGET_DRAW * 0.65) {
      this.tolScale = Math.max(1, this.tolScale * 0.97);
    }

    this.tris = 0;
    for (const t of this.draw) {
      const e = this.tiles.get(tileKey(t.face, t.level, t.tx, t.ty));
      if (e) { e.used = this.frame; this.tris += e.mesh.faces || 0; }
      // Предки нарисованной плитки — её запасной вариант на случай
      // вытеснения потомков; их тоже держим.
      let lv = t.level, x = t.tx, y = t.ty;
      while (lv > 0) {
        lv--; x >>= 1; y >>= 1;
        const p2 = this.tiles.get(tileKey(t.face, lv, x, y));
        if (p2) p2.used = this.frame;
      }
    }

    this.pump(body, msBudget);
    this.evict();
    return this.draw;
  }

  // Сборка: самая нужная плитка (наибольшая ошибка) — первой.
  pump(body, msBudget) {
    const t0 = performance.now();
    while (performance.now() - t0 < msBudget) {
      if (!this.building) {
        if (!this.wanted.length) return;
        let best = 0;
        for (let i = 1; i < this.wanted.length; i++) {
          if (this.wanted[i].err > this.wanted[best].err) best = i;
        }
        const t = this.wanted[best].t;
        this.wanted.splice(best, 1);
        const key = tileKey(t.face, t.level, t.tx, t.ty);
        if (this.tiles.has(key)) continue;
        this.tiles.set(key, { ...t, key, mesh: null, tex: null, used: this.frame });
        this.building = { key, t, builder: tileBuilder(body, t) };
      }
      if (this.building.builder.step(BUILD_CHUNK)) {
        this.finish(body, this.building);
        this.building = null;
      }
    }
  }

  finish(body, job) {
    const geo = job.builder.result;
    const entry = this.tiles.get(job.key);
    if (!entry) return;
    const mesh = buildIndexedMesh(this.gl, this.locs, geo);
    mesh.faces = geo.faces;
    entry.mesh = mesh;
    entry.tex = createBakeTexture(this.gl, TILE_TEX);
    this.bake(body, job.t, entry.tex);
    this.built++;
  }

  /** Один проход запекания поверхности плитки в её текстуру. */
  bake(body, t, tex) {
    const gl = this.gl;
    const prog = this.prog;
    const u = bakeUniforms(terrainOf(body));
    const f = CUBE_FACES[t.face];
    const b = tileBounds(t.level, t.tx, t.ty);
    this.baker.pass(tex, () => {
      prog.use();
      gl.uniform3f(prog.loc('uFaceF'), f.F[0], f.F[1], f.F[2]);
      gl.uniform3f(prog.loc('uFaceU'), f.U[0], f.U[1], f.U[2]);
      gl.uniform3f(prog.loc('uFaceV'), f.V[0], f.V[1], f.V[2]);
      gl.uniform4f(prog.loc('uRange'), b.u0, b.u1, b.v0, b.v1);
      gl.uniform1f(prog.loc('uTexel'), tileTexelAngle(t.level));
      gl.uniform1f(prog.loc('uDetail'), u.on);
      gl.uniform1i(prog.loc('uSeed'), u.seed | 0);
      gl.uniform1f(prog.loc('uAmp'), u.amp);
      gl.uniform1f(prog.loc('uSpan'), u.span);
      gl.uniform1f(prog.loc('uFreq'), u.freq);
      gl.uniform1f(prog.loc('uRidge'), u.ridge);
      gl.uniform1f(prog.loc('uCraterW'), u.craterW);
      gl.uniform1i(prog.loc('uOctFrom'), u.octFrom);
      gl.uniform1i(prog.loc('uCsFrom'), u.csFrom);
      // Сверху окно не обрезано: в текстуру пишется вся поверхность.
      gl.uniform1f(prog.loc('uBakeFw'), u.bakeFw);
      gl.uniform1i(prog.loc('uMaxCs'), u.maxCs);
      gl.uniform1i(prog.loc('uMaxOct'), u.maxOct);
      this.quad.draw();
    });
    this.baker.finish(tex);
  }

  // Вытеснение: корни и всё, что нужно было в последние секунды, не
  // трогаем. Бюджет мягкий — лучше немного превысить память, чем
  // выбросить плитку, которая понадобится через кадр.
  evict() {
    if (this.tiles.size <= TILE_BUDGET) return;
    const list = [];
    for (const t of this.tiles.values()) {
      if (t.level === 0 || !t.mesh) continue;
      if (this.frame - t.used < KEEP_FRAMES) continue;
      list.push(t);
    }
    list.sort((a, b) => a.used - b.used);
    let over = this.tiles.size - TILE_BUDGET;
    for (const t of list) {
      if (over-- <= 0) break;
      this.release(t);
      this.tiles.delete(t.key);
      this.evicted++;
    }
  }

  /**
   * Готовы ли шесть корневых плиток. Пока нет — тело рисуется обычной
   * сферой: подгрузка не должна оставлять дырок в кадре.
   */
  get rootsReady() {
    for (let f = 0; f < 6; f++) {
      const e = this.tiles.get(tileKey(f, 0, 0, 0));
      if (!e || !e.mesh) return false;
    }
    return true;
  }

  get stats() {
    return {
      tiles: this.tiles.size,
      drawn: this.draw.length,
      built: this.built,
      evicted: this.evicted,
      pending: this.wanted.length + (this.building ? 1 : 0),
    };
  }
}
