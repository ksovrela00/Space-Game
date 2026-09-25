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
import { buildIndexedMesh } from './mesh.js';
import { tileBuilder, geoFromTransfer, BUILD_CHUNK } from './tilegeo.js';
import { TilePool } from './tilepool.js';
import { bakeUniforms, plateUniforms } from './detail.js';
import { createBakeTexture, CUBE_FACES } from './bake.js';
import {
  TILE_TEX, TILE_MAX_LEVEL, tileBounds, tileKey,
  tileCellAngle, tileTexelAngle, selectTiles,
} from './quadtree.js';
import { Q } from '../core/quality.js';

export { tileBuilder };

// Бюджеты приходят из профиля устройства (js/core/quality.js): на
// телефоне плитка стоит той же памяти, а памяти втрое меньше.
export const TILE_BUDGET = Q.tileBudget;   // плиток в памяти (~200 КБ каждая)
// Сколько готовых плиток забираем у потоков за кадр. Счёт идёт не у нас,
// но загрузка в буферы и запекание — у нас, и вываливать их десятками за
// кадр значит менять одну дёрганность на другую.
const FINISH_PER_FRAME = 6;
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
export const TILE_TEXEL_TOL = Q.texelTol;  // пикселей на тексель
const KEEP_FRAMES = 180;             // сколько кадров плитка живёт без надобности
const TARGET_DRAW = Q.targetDraw;    // сколько плиток в кадре считаем нормой

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
    this.load = 1;                // сглаженная нагрузка для регулятора допуска
    // Что было раздроблено в прошлом кадре: по этому списку выбор
    // держит дробление с запасом и не щёлкает на границе допуска.
    this.splitPrev = new Set();
    this.splitNow = new Set();
    // Почему набор плиток такой (заполняет selectTiles).
    this.diag = { merged: 0, waiting: 0, fallback: 0, visited: 0, collapses: [] };
    this.evicted = 0;
    this.tris = 0;
    // Счёт геометрии уезжает в отдельные потоки; если их нет — считаем
    // в кадре, как раньше (см. js/gl/tilepool.js).
    this.pool = new TilePool();
    this.jobId = 0;
    // Смена тела не должна принимать чужие плитки: у заданий есть номер
    // поколения, и всё, что пришло от прошлого, выбрасывается.
    this.gen = 0;
  }

  clear() {
    this.gen++;
    for (const t of this.tiles.values()) this.release(t);
    this.tiles.clear();
    this.wanted.length = 0;
    this.building = null;
    this.draw.length = 0;
    this.splitPrev.clear();
    this.splitNow.clear();
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
    const tmp = this.splitPrev;
    this.splitPrev = this.splitNow;
    this.splitNow = tmp;
    this.splitNow.clear();

    const ctx = {
      radius: body.radius,
      camDir,
      camAlt,
      focal,
      // Допуск ведёт один регулятор (см. ниже), и заполненность кэша
      // учтена в нём же. Отдельного быстрого множителя здесь больше
      // нет: их было два, оба реагировали на свой сигнал за кадр, и
      // вместе они раскачивали допуск, а вместе с ним и уровень плиток.
      tol: TILE_TOL * this.tolScale,
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
      diag: this.diag,
      wasSplit: (t) => this.splitPrev.has(tileKey(t.face, t.level, t.tx, t.ty)),
      markSplit: (t) => { this.splitNow.add(tileKey(t.face, t.level, t.tx, t.ty)); },
    };

    selectTiles(ctx, this.draw);

    // ТО, ЧТО БЫЛО СЛОМАНО: корни заказываются ВСЕГДА, а не когда их
    // видно.
    //
    // Шесть корневых плиток — это «вся поверхность тела», запасной
    // вариант для всего остального: пока они не готовы, тело рисуется
    // обычной сферой (rootsReady), а pushReady считает их резидентными
    // и ищет среди них готового предка. Но заказывались они только
    // тем же обходом, что и остальные, — а у самой земли пять граней
    // куба из шести лежат за горизонтом, и их потомки отсекаются
    // целиком. Корни не строились никогда, rootsReady не наступал, и
    // игра, ЗАПУЩЕННАЯ в двухстах метрах над грунтом, так и рисовала
    // грубую сферу без текстур: плитки при этом исправно собирались в
    // кэш и ни разу не попадали на экран. При спуске с орбиты всё шло
    // как надо — там шесть граней видно сразу.
    //
    // Стоят они шесть плиток на тело и не вытесняются никогда (evict),
    // так что заказ разовый.
    for (let f = 0; f < 6; f++) {
      const root = { face: f, level: 0, tx: 0, ty: 0 };
      // Наибольший приоритет: без корней не рисуется ничего.
      if (!ctx.ready(root)) ctx.want(root, Infinity);
    }

    // Регулятор допуска. У процедурного рельефа деталь есть на любом
    // масштабе, поэтому фиксированный допуск в пикселях у поверхности
    // требует дробления почти без дна: выходит миллион треугольников
    // там, где глазу хватает сотни плиток. Отсюда и подстройка.
    //
    // Но допуск — это ручка КАЧЕСТВА, а не то, что должно шевелиться
    // каждый кадр: любое его движение переставляет границу дробления, а
    // вместе с ней и уровень у всех плиток, стоящих рядом с границей.
    // Поэтому нагрузка сглаживается, а сам множитель ходит медленно и
    // почти симметрично. Раньше он прыгал на 12% за кадр вверх и полз
    // на 3% вниз — эта асимметрия и раскачивала картинку.
    const pressure = Math.max(this.draw.length / TARGET_DRAW, this.tiles.size / TILE_BUDGET);
    this.load += (pressure - this.load) * 0.05;
    if (this.load > 1.05) this.tolScale = Math.min(80, this.tolScale * 1.02);
    else if (this.load < 0.8) this.tolScale = Math.max(1, this.tolScale * 0.995);

    this.tris = 0;
    for (const t of this.draw) {
      const e = this.tiles.get(tileKey(t.face, t.level, t.tx, t.ty));
      if (e) { e.used = this.frame; this.tris += e.mesh.faces || 0; }
      // Предки нарисованной плитки — её запасной вариант на случай
      // вытеснения потомков; их тоже держим. Вместе с ними держим и
      // СОСЕДЕЙ по каждому узлу: дробление разрешено только когда
      // готовы все четверо, поэтому вытеснение соседа роняет всё
      // поддерево, хотя сам он в кадре и не появлялся.
      let lv = t.level, x = t.tx, y = t.ty;
      while (lv > 0) {
        const bx = (x >> 1) << 1, by = (y >> 1) << 1;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sib = this.tiles.get(tileKey(t.face, lv, bx + dx, by + dy));
            if (sib) sib.used = this.frame;
          }
        }
        lv--; x >>= 1; y >>= 1;
        const p2 = this.tiles.get(tileKey(t.face, lv, x, y));
        if (p2) p2.used = this.frame;
      }
    }

    this.pump(body, msBudget);
    this.evict();
    return this.draw;
  }

  /** Забрать самую нужную плитку из заказа (наибольшая ошибка). */
  takeBest() {
    if (!this.wanted.length) return null;
    let best = 0;
    for (let i = 1; i < this.wanted.length; i++) {
      if (this.wanted[i].err > this.wanted[best].err) best = i;
    }
    const t = this.wanted[best].t;
    this.wanted.splice(best, 1);
    return t;
  }

  // Сборка: самая нужная плитка (наибольшая ошибка) — первой.
  pump(body, msBudget) {
    if (this.pool.ok) { this.pumpWorkers(body); return; }
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

  /**
   * То же самое, но счёт идёт в рабочих потоках. В кадре остаётся
   * только раздать задания и забрать готовое.
   */
  pumpWorkers(body) {
    // Сначала — что уже посчитано. Больше FINISH_PER_FRAME за кадр не
    // берём: загрузка в буферы и запекание всё-таки наши.
    let taken = 0;
    const ready = this.pool.take();
    for (const r of ready) {
      if (r.gen !== this.gen) continue;            // это от прошлого тела
      const entry = this.tiles.get(r.key);
      if (!entry || entry.mesh) continue;
      if (taken >= FINISH_PER_FRAME) { this.pool.done.push(r); continue; }
      this.attach(body, entry, geoFromTransfer(r.geo));
      taken++;
    }
    // Задание, которое поток не осилил: снимаем заглушку, иначе плитка
    // навсегда останется «строящейся» и родитель не раздробится.
    for (const f of this.pool.takeFailed()) {
      const e = this.tiles.get(f.key);
      if (e && !e.mesh) this.tiles.delete(f.key);
    }

    // Площадка города уезжает в поток вместе с телом: рельеф там ровный,
    // и сетка обязана быть ровной с обеих сторон — иначе плитки,
    // собранные в потоке, разошлись бы с тем, по чему считается посадка.
    const spec = {
      kind: body.kind, name: body.name, id: body.id,
      plate: body.plate || null,
    };
    while (this.pool.free && this.wanted.length) {
      const t = this.takeBest();
      if (!t) break;
      const key = tileKey(t.face, t.level, t.tx, t.ty);
      if (this.tiles.has(key)) continue;
      this.tiles.set(key, { ...t, key, mesh: null, tex: null, used: this.frame });
      this.pool.post({ id: this.jobId++, gen: this.gen, key, spec, t });
    }
  }

  finish(body, job) {
    const entry = this.tiles.get(job.key);
    if (!entry) return;
    this.attach(body, entry, job.builder.result);
  }

  /** Готовую геометрию — в буферы GL и в свою текстуру. */
  attach(body, entry, geo) {
    const mesh = buildIndexedMesh(this.gl, this.locs, geo);
    mesh.faces = geo.faces;
    entry.mesh = mesh;
    entry.tex = createBakeTexture(this.gl, TILE_TEX);
    this.bake(body, entry, entry.tex);
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
      plateUniforms(gl, prog, u.plate);
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
      pending: this.wanted.length + (this.building ? 1 : 0) + this.pool.busy,
      workers: this.pool.workers.length,
      waiting: this.diag.waiting,
      fallback: this.diag.fallback,
    };
  }
}
