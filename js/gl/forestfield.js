// Дальний лес на видеокарте: куски, их сборка в потоках и буферы.
//
// Сама расстановка — в js/gl/forest.js (там же, почему и зачем). Здесь:
// какие куски нужны вокруг камеры, заказ их потоку, загрузка готовых в
// буферы и выгрузка тех, что остались далеко позади. Рисует их сцена
// (js/gl/scene.js, drawForest): uniform-ы кадра у неё.

import { TilePool } from './tilepool.js';
import { Q } from '../core/quality.js';
import { terrainOf } from './terrain.js';
import {
  forestChunk, chunksAround, chunkKey, proxyGeometry, farRadius, FAR, INST,
} from './forest.js';

const WORKER_URL = new URL('./forestworker.js', import.meta.url);

// Список нужных кусков пересчитывается, когда камера ушла на четверть
// куска: чаще — впустую, реже — край леса заметно отстаёт.
const REPLAN = 0.25;
// Запас по краю: кусок уходит из памяти, когда он дальше круга на
// полтора своих размера. Без запаса на границе куски грузились бы и
// выгружались туда-обратно при каждом повороте.
const KEEP = 1.5;

export class ForestField {
  constructor(gl, prog) {
    this.gl = gl;
    this.prog = prog;
    const geo = proxyGeometry();
    this.nBase = geo.length / 4;
    this.baseBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.baseBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geo, gl.STATIC_DRAW);
    this.locs = {
      aP: prog.attrib('aP'), aTree: prog.attrib('aTree'),
      aLook: prog.attrib('aLook'), aMisc: prog.attrib('aMisc'),
    };
    this.chunks = new Map();       // ключ -> кусок с буферами
    this.inFlight = new Map();     // ключ -> номер задания
    this.want = [];
    this.body = null;
    this.gen = 0;
    this.jobId = 0;
    this.plannedAt = null;
    this.rGround = 0;
    this.rFar = 0;
    this.built = 0;
    // Потоки — если они есть. В проверках под node их нет, и куски
    // собираются прямо в кадре, по одному.
    this.pool = typeof Worker !== 'undefined'
      ? new TilePool(Q.forestWorkers || 1, WORKER_URL) : null;
  }

  /**
   * @param body  тело под камерой (null — леса нет)
   * @param dir   точка под камерой, оси тела
   * @param alt   высота камеры над грунтом, км
   * @param focal фокус камеры, пиксели
   */
  update(body, dir, alt, focal) {
    const t = body && terrainOf(body);
    if (!body || !dir || !(alt >= 0) || !t || t.isFlat || !t.hasFlora) { this.clear(); return; }
    if (body !== this.body) { this.clear(); this.body = body; }

    // Дальность — по оптике, с потолком профиля устройства; по грунту —
    // с поправкой на высоту и не дальше горизонта (с запасом на рельеф:
    // гора за горизонтом видна).
    this.rFar = Math.min(Q.forestKm || 12, farRadius(focal));
    const horizon = Math.sqrt(2 * body.radius * Math.max(alt, 0.002)) + 4;
    this.rGround = Math.min(horizon, Math.sqrt(Math.max(0, this.rFar * this.rFar - alt * alt)));

    const moved = !this.plannedAt || Math.acos(Math.max(-1, Math.min(1,
      dir.x * this.plannedAt.x + dir.y * this.plannedAt.y + dir.z * this.plannedAt.z)))
      * body.radius > FAR.chunk * 0.038 * REPLAN;
    const wasR = this.want.rGround || 0;
    let replanned = false;
    if (moved || Math.abs(this.rGround - wasR) > Math.max(0.3, wasR * 0.1)) {
      this.want = this.rGround > 0 ? chunksAround(body, dir, this.rGround, this.want) : [];
      this.want.rGround = this.rGround;
      this.plannedAt = { x: dir.x, y: dir.y, z: dir.z };
      this.evict(body, dir);
      replanned = true;
    }

    this.collect();
    this.order(body, replanned);
  }

  /**
   * Заказать недостающие куски: ближние первыми.
   *
   * Заказ уходит в очередь пула, и потоки разбирают её сами, не
   * дожидаясь кадров. При пересчёте списка очередь сбрасывается и
   * ставится заново по новым расстояниям: камера ушла — ближним стало
   * другое.
   */
  order(body, replanned = false) {
    const spec = {
      kind: body.kind, name: body.name, id: body.id,
      radius: body.radius, plate: body.plate || null,
    };
    if (this.pool && !this.pool.ok) return;
    if (this.pool && replanned) {
      for (const job of this.pool.queue) this.inFlight.delete(job.key);
      this.pool.queue.length = 0;
    }
    for (const w of this.want) {
      const key = chunkKey(w.face, w.bi, w.bj);
      if (this.chunks.has(key) || this.inFlight.has(key)) continue;
      if (this.pool) {
        const id = this.jobId++;
        this.inFlight.set(key, id);
        this.pool.enqueue({ id, gen: this.gen, key, spec, face: w.face, bi: w.bi, bj: w.bj });
      } else {
        // Без потоков — один кусок за кадр: это полтора десятка
        // миллисекунд, больше в кадр не лезет.
        this.install(key, forestChunk(body, w.face, w.bi, w.bj));
        return;
      }
    }
  }

  /** Готовое из потоков — в буферы. */
  collect() {
    if (!this.pool) return;
    for (const job of this.pool.takeFailed()) this.inFlight.delete(job.key);
    for (const out of this.pool.take()) {
      if (out.gen !== this.gen) continue;              // ответ про покинутое тело
      this.inFlight.delete(out.key);
      this.install(out.key, out.chunk);
    }
  }

  install(key, ch) {
    const gl = this.gl;
    const L = this.locs;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.baseBuf);
    if (L.aP >= 0) {
      gl.enableVertexAttribArray(L.aP);
      gl.vertexAttribPointer(L.aP, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(L.aP, 0);
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, ch.inst, gl.STATIC_DRAW);
    const stride = INST * 4;
    for (const [loc, off] of [[L.aTree, 0], [L.aLook, 16], [L.aMisc, 32]]) {
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    // Касательные оси куска — в осях тела: по ним силуэт встаёт вертикально.
    const o = ch.origin;
    const l = Math.hypot(o.x, o.y, o.z) || 1;
    const up = { x: o.x / l, y: o.y / l, z: o.z / l };
    const hp = Math.abs(up.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    let tx = hp.y * up.z - hp.z * up.y, ty = hp.z * up.x - hp.x * up.z, tz = hp.x * up.y - hp.y * up.x;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const T = { x: tx, y: ty, z: tz };
    const B = { x: up.y * tz - up.z * ty, y: up.z * tx - up.x * tz, z: up.x * ty - up.y * tx };
    this.chunks.set(key, {
      key, face: ch.face, bi: ch.bi, bj: ch.bj, origin: o, up, T, B,
      n: ch.n, n1: ch.n1, n2: ch.n2, vao, buf,
    });
    this.built++;
  }

  /** Выгрузить куски, оставшиеся далеко за краем круга. */
  evict(body, dir) {
    const lim = this.rGround + FAR.chunk * 0.038 * KEEP;
    for (const [key, c] of this.chunks) {
      const l = Math.hypot(c.origin.x, c.origin.y, c.origin.z) || 1;
      const ang = Math.acos(Math.max(-1, Math.min(1,
        (c.origin.x * dir.x + c.origin.y * dir.y + c.origin.z * dir.z) / l)));
      if (ang * body.radius > lim) this.drop(key, c);
    }
  }

  drop(key, c) {
    const gl = this.gl;
    gl.deleteVertexArray(c.vao);
    gl.deleteBuffer(c.buf);
    this.chunks.delete(key);
  }

  clear() {
    for (const [key, c] of this.chunks) this.drop(key, c);
    this.inFlight.clear();
    if (this.pool) this.pool.queue.length = 0;
    this.want = [];
    this.plannedAt = null;
    this.body = null;
    this.gen++;
    this.rGround = 0;
  }

  /** Сколько деревьев лежит в готовых кусках — для отладки. */
  get trees() {
    let n = 0;
    for (const c of this.chunks.values()) n += c.n;
    return n;
  }
}
