// Конструктор корпуса из простых тел: сечения, планформы, проёмы.
//
// Зачем свой, а не js/models/geometry.js. Там лепят выпуклые болванки
// (клин, призма, ящик), а корпусу большого корабля нужны вещи, которых
// у болванок нет: тело из нескольких сечений с уступами (борт с
// желобом, крыло с террасами), проём в грани (ворота ангара, ниша
// тормозных сопел) и ответ на вопрос «эта точка внутри корпуса?» — по
// нему считается объём (масса), центр масс и то, легло ли окно на
// обшивку, а позже и то, где в корпусе помещения.
//
// Всё в МЕТРАХ: корпус рисуется и проверяется в метрах, в километры его
// переводит тот, кто собирает (js/models/prometheus.js).
//
// Вершины у граней не общие. Затенение плоское (js/gl/mesh.js), и
// общие вершины нужны были бы только сглаживанию, которого нет.

import { v3 } from '../core/vec3.js';
import { MAT } from './hulldetail.js';

// --- мелкая геометрия ----------------------------------------------------------

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Нормаль многоугольника по Ньюэллу: устойчива и к почти вырожденным. */
function newell(P) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z);
  return l > 1e-12 ? [x / l, y / l, z / l] : null;
}

/** Площадь со знаком контура на плоскости (a, b): > 0 — против часовой. */
export function area2(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Точка внутри многоугольника (правило чётности). */
export function inPoly(p, u, v) {
  let hit = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a[1] > v) !== (b[1] > v) && u < (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

/**
 * Половина контура — в целый. half идёт от точки на оси (x = 0) по
 * правой стороне (x > 0) до второй точки на оси; левая сторона — её
 * зеркало. Корабль симметричен, и рисовать обе половины руками значило
 * бы однажды их разрознить.
 */
export function mirror(half) {
  const mid = half.slice(1, -1);
  return [half[0], ...mid, half[half.length - 1], ...mid.slice().reverse().map(([a, b]) => [-a, b])];
}

/**
 * Выпуклый контур, ужатый внутрь на d: каждая вершина уходит по
 * биссектрисе так, что все рёбра сдвигаются ровно на d.
 */
export function inset(p, d) {
  const s = area2(p) > 0 ? 1 : -1;
  const n = p.length;
  const nrm = [];
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1;
    nrm.push([-ey / l * s, ex / l * s]);          // внутрь
  }
  return p.map((q, i) => {
    const n1 = nrm[(i - 1 + n) % n], n2 = nrm[i];
    const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    return [q[0] + (n1[0] + n2[0]) * d / k, q[1] + (n1[1] + n2[1]) * d / k];
  });
}

/** Прямоугольник со срезанными углами (восьмиугольник), против часовой. */
export function rectCh(a0, a1, b0, b1, ch) {
  const c = Math.min(ch, (a1 - a0) / 2 - 1e-3, (b1 - b0) / 2 - 1e-3);
  if (c <= 0) return [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
  return [[a0 + c, b0], [a1 - c, b0], [a1, b0 + c], [a1, b1 - c], [a1 - c, b1], [a0 + c, b1], [a0, b1 - c], [a0, b0 + c]];
}

/** Разбиение простого многоугольника на треугольники (отрезание ушей). */
function earClip(p) {
  const idx = p.map((_, i) => i);
  if (area2(p) < 0) idx.reverse();
  const out = [];
  const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = p[ia], b = p[ib], c = p[ic];
      if (cross2(a, b, c) <= 1e-12) continue;
      let inside = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const q = p[j];
        if (cross2(a, b, q) >= 0 && cross2(b, c, q) >= 0 && cross2(c, a, q) >= 0) { inside = true; break; }
      }
      if (inside) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx.slice());
  return out;
}

const isConvex = (p) => {
  let sgn = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
    const k = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(k) < 1e-9) continue;
    if (sgn === 0) sgn = Math.sign(k);
    else if (Math.sign(k) !== sgn) return false;
  }
  return true;
};

// Оси тела: из координат сечения (a, b) и положения t вдоль оси — в x, y, z.
const AXES = {
  z: { put: (a, b, t) => [a, b, t], n: (na, nb) => [na, nb, 0], t: [0, 0, 1] },
  y: { put: (a, b, t) => [a, t, b], n: (na, nb) => [na, 0, nb], t: [0, 1, 0] },
  x: { put: (a, b, t) => [t, b, a], n: (na, nb) => [0, nb, na], t: [1, 0, 0] },
};

// Детерминированный разброс: один и тот же корпус при каждой сборке.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- конструктор ---------------------------------------------------------------

export class Kit {
  constructor(seed = 1) {
    this.verts = [];
    this.faces = [];
    // Тела для вопроса «внутри ли точка»: сечения вдоль оси.
    this.solids = [];
    // Пустоты — ниши за проёмами (ворота ангара, колодцы шасси, окна):
    // точка в нише не внутри корпуса, хотя тело вокруг неё сплошное.
    this.voids = [];
    // Накладки (окна, решётки) — отдельной сеткой, как у «Челленджера»
    // (js/models/hulldetail.js): всё, что меряет корпус, меряет его голым.
    this.decal = { verts: [], faces: [] };
    this.rnd = rng(seed);
    // Грани тел (не навесных деталей): по ним проверка сверяет, что
    // нормаль смотрит наружу.
    this.solidFaces = new Set();
  }

  /** Цвет с разбросом тона: панели обшивки не бывают одного цвета. */
  tone(c, k = 0.06) {
    const f = 1 + (this.rnd() - 0.5) * 2 * k;
    return c.map((x) => Math.max(0, Math.min(255, Math.round(x * f))));
  }

  /**
   * Грань по точкам [x, y, z] (выпуклый многоугольник). out — куда она
   * смотрит наружу: обход разворачивается под него. Неплоский
   * четырёхугольник режется на два треугольника — веером он лёг бы
   * криво.
   */
  face(pts, c, mat = MAT.plate, out = null, opt = {}) {
    const P = [];
    for (const p of pts) {
      const q = P[P.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 1e-6) P.push(p);
    }
    while (P.length > 1 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1], P[0][2] - P[P.length - 1][2]) < 1e-6) P.pop();
    if (P.length < 3) return;
    let n = newell(P);
    if (!n) return;
    if (P.length > 3) {
      // Плоскость — по первым точкам; уход дальше сантиметра — режем.
      let off = 0;
      for (const p of P) off = Math.max(off, Math.abs(dot3(sub3(p, P[0]), n)));
      if (off > 0.01) {
        for (let k = 1; k + 1 < P.length; k++) this.face([P[0], P[k], P[k + 1]], c, mat, out || n, opt);
        return;
      }
    }
    if (out && dot3(n, out) < 0) { P.reverse(); n = [-n[0], -n[1], -n[2]]; }
    const target = opt.decal ? this.decal : this;
    const base = target.verts.length;
    for (const p of P) target.verts.push(v3(p[0], p[1], p[2]));
    target.faces.push({
      v: P.map((_, i) => base + i), c, n: v3(n[0], n[1], n[2]), mat,
      twoSided: false, emissive: opt.emissive || 0,
    });
  }

  /** Плоский многоугольник, возможно вогнутый: режется на треугольники. */
  cap(put, poly, c, mat, out) {
    if (isConvex(poly)) { this.face(poly.map(([a, b]) => put(a, b)), c, mat, out); return; }
    for (const [i, j, k] of earClip(poly)) this.face([put(...poly[i]), put(...poly[j]), put(...poly[k])], c, mat, out);
  }

  /**
   * Тело из сечений вдоль оси. secs — [{ t, p: [[a, b], ...] }], у всех
   * сечений одно число точек и один обход; два сечения на одном t дают
   * уступ (горизонтальную полку). Сечение может стянуться в отрезок —
   * так выходит клин.
   *
   * opt.c — цвет или функция (номер ребра, номер пролёта, нормаль) → цвет;
   * opt.cap0/cap1 — закрывать ли торцы; opt.solid — считать ли телом.
   */
  loft(axis, secs, opt = {}) {
    const from = this.faces.length;
    const A = AXES[axis];
    const mat = opt.mat === undefined ? MAT.plate : opt.mat;
    const col = typeof opt.c === 'function' ? opt.c : () => this.tone(opt.c || [140, 140, 140], opt.toneK);
    const n = secs[0].p.length;
    for (let k = 0; k + 1 < secs.length; k++) {
      const s0 = secs[k], s1 = secs[k + 1];
      const flat = Math.abs(s1.t - s0.t) < 1e-9;
      const sg = area2(s0.p) >= 0 ? 1 : -1;
      // Полка между двумя сечениями на одном t смотрит туда, куда
      // уступ открыт: ступень наружу — вниз по оси, внутрь — вверх.
      const shelf = flat ? (Math.abs(area2(s1.p)) > Math.abs(area2(s0.p)) ? -1 : 1) : 0;
      for (let i = 0; i < n; i++) {
        if (opt.skip && opt.skip(i, k)) continue;      // грань строят отдельно (с проёмом)
        const j = (i + 1) % n;
        const a0 = s0.p[i], b0 = s0.p[j], a1 = s1.p[i], b1 = s1.p[j];
        let out;
        if (flat) out = A.t.map((x) => x * shelf);
        else {
          const ea = (b0[0] + b1[0] - a0[0] - a1[0]) / 2, eb = (b0[1] + b1[1] - a0[1] - a1[1]) / 2;
          out = A.n(eb * sg, -ea * sg);
        }
        const pts = [A.put(a0[0], a0[1], s0.t), A.put(b0[0], b0[1], s0.t), A.put(b1[0], b1[1], s1.t), A.put(a1[0], a1[1], s1.t)];
        this.face(pts, col(i, k, out), opt.mats ? opt.mats(i, k) : mat, out);
      }
    }
    const capC = opt.capC || opt.c;
    const capCol = () => (typeof capC === 'function' ? capC(-1, -1, null) : this.tone(capC || [140, 140, 140], opt.toneK));
    if (opt.cap0 !== false) {
      const s = secs[0];
      this.cap((a, b) => A.put(a, b, s.t), s.p, capCol(), opt.capMat === undefined ? mat : opt.capMat, A.t.map((x) => -x));
    }
    if (opt.cap1 !== false) {
      const s = secs[secs.length - 1];
      this.cap((a, b) => A.put(a, b, s.t), s.p, capCol(), opt.capMat === undefined ? mat : opt.capMat, A.t);
    }
    if (opt.solid !== false) {
      this.solids.push(solidOf(axis, secs));
      for (let i = from; i < this.faces.length; i++) this.solidFaces.add(this.faces[i]);
    }
    return this;
  }

  /** Призма: контур на плоскости (x, z) от y0 до y1. */
  prism(poly, y0, y1, opt = {}) {
    return this.loft('y', [{ t: y0, p: poly }, { t: y1, p: poly }], opt);
  }

  /** Ящик по осям; ch — фаска верхних рёбер. */
  box(x0, x1, y0, y1, z0, z1, opt = {}) {
    const p = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const ch = opt.ch || 0;
    if (ch > 0) {
      return this.loft('y', [{ t: y0, p }, { t: y1 - ch, p }, { t: y1, p: inset(p, ch) }], opt);
    }
    return this.loft('y', [{ t: y0, p }, { t: y1, p }], opt);
  }

  /** Цилиндр (n-гранный) вдоль оси axis с центром (ca, cb) от t0 до t1. */
  cyl(axis, ca, cb, t0, t1, r, n, opt = {}) {
    const p = [];
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * Math.PI * 2;
      p.push([ca + Math.cos(a) * r, cb + Math.sin(a) * r]);
    }
    const r1 = opt.r1 === undefined ? r : opt.r1;
    const p1 = r1 === r ? p : p.map(([a, b]) => [ca + (a - ca) * r1 / r, cb + (b - cb) * r1 / r]);
    return this.loft(axis, [{ t: t0, p }, { t: t1, p: p1 }], opt);
  }

  /** Шар (низкополигональный) — шаровые башни ПРО. Телом не считается. */
  sphere(cx, cy, cz, r, c, seg = 8, rings = 5) {
    const pt = (i, j) => {
      const th = j / rings * Math.PI, ph = i / seg * Math.PI * 2;
      return [cx + Math.sin(th) * Math.cos(ph) * r, cy + Math.cos(th) * r, cz + Math.sin(th) * Math.sin(ph) * r];
    };
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
        const m = q.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4, s[2] + p[2] / 4], [0, 0, 0]);
        this.face(q, c, MAT.plain, [m[0] - cx, m[1] - cy, m[2] - cz]);
      }
    }
  }

  /**
   * Плоская панель с проёмами. Плоскость задана точкой O и осями U, V
   * (в метрах), N — наружу. outer — выпуклый контур на (u, v), holes —
   * выпуклые проёмы внутри него. Панель режется полосами по v через
   * все вершины контура и проёмов: внутри полосы края прямые, и каждый
   * кусок — выпуклый четырёхугольник.
   */
  panel(fr, outer, holes, c, mat = MAT.plate) {
    const at = (u, v) => [fr.O[0] + fr.U[0] * u + fr.V[0] * v, fr.O[1] + fr.U[1] * u + fr.V[1] * v, fr.O[2] + fr.U[2] * u + fr.V[2] * v];
    const vs = [...new Set([...outer, ...holes.flat()].map((p) => +p[1].toFixed(6)))].sort((a, b) => a - b);
    // Хорда выпуклого контура на высоте v: [левый u, правый u].
    const chord = (poly, v) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if ((a[1] - v) * (b[1] - v) > 1e-12) continue;
        if (Math.abs(a[1] - b[1]) < 1e-12) { lo = Math.min(lo, a[0], b[0]); hi = Math.max(hi, a[0], b[0]); continue; }
        const u = a[0] + (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]);
        lo = Math.min(lo, u); hi = Math.max(hi, u);
      }
      return lo <= hi ? [lo, hi] : null;
    };
    for (let k = 0; k + 1 < vs.length; k++) {
      const va = vs[k], vb = vs[k + 1];
      if (vb - va < 1e-6) continue;
      const vm = (va + vb) / 2;
      const oa = chord(outer, va + 1e-7), ob = chord(outer, vb - 1e-7), om = chord(outer, vm);
      if (!oa || !ob || !om) continue;
      // Проёмы, пересекающие полосу, — слева направо по середине.
      const cut = holes.map((h) => {
        const m = chord(h, vm);
        if (!m) return null;
        return { a: chord(h, va + 1e-7) || m, b: chord(h, vb - 1e-7) || m, m };
      }).filter(Boolean).sort((p, q) => p.m[0] - q.m[0]);
      let la = oa[0], lb = ob[0];
      for (const h of cut) {
        this.face([at(la, va), at(h.a[0], va), at(h.b[0], vb), at(lb, vb)], this.tone(c), mat, fr.N);
        la = h.a[1]; lb = h.b[1];
      }
      this.face([at(la, va), at(oa[1], va), at(ob[1], vb), at(lb, vb)], this.tone(c), mat, fr.N);
    }
  }

  /**
   * Ниша за проёмом: стенки вглубь на depth (против N) и дно. shrink —
   * насколько дно меньше проёма (воронка тормозных сопел).
   */
  tunnel(fr, hole, depth, c, back, opt = {}) {
    const at = (u, v, d) => [
      fr.O[0] + fr.U[0] * u + fr.V[0] * v - fr.N[0] * d,
      fr.O[1] + fr.U[1] * u + fr.V[1] * v - fr.N[1] * d,
      fr.O[2] + fr.U[2] * u + fr.V[2] * v - fr.N[2] * d];
    const cu = hole.reduce((s, p) => s + p[0], 0) / hole.length, cv = hole.reduce((s, p) => s + p[1], 0) / hole.length;
    const k = opt.shrink || 0;
    const deep = hole.map(([u, v]) => [cu + (u - cu) * (1 - k), cv + (v - cv) * (1 - k)]);
    const n = hole.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = hole[i], b = hole[j], a2 = deep[i], b2 = deep[j];
      // Стенка смотрит внутрь ниши — к её оси.
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const toC = [cu - mid[0], cv - mid[1]];
      const out = [fr.U[0] * toC[0] + fr.V[0] * toC[1], fr.U[1] * toC[0] + fr.V[1] * toC[1], fr.U[2] * toC[0] + fr.V[2] * toC[1]];
      this.face([at(a[0], a[1], 0), at(b[0], b[1], 0), at(b2[0], b2[1], depth), at(a2[0], a2[1], depth)], this.tone(c, 0.04), MAT.plain, out);
    }
    this.face(deep.map(([u, v]) => at(u, v, depth)), back, opt.backMat === undefined ? MAT.plain : opt.backMat, fr.N, { emissive: opt.emissive || 0 });
    // Ниша — пустота для вопроса «внутри ли точка». Плоскости здесь всегда
    // по осям, и ниша — тело из двух сечений вдоль нормали.
    const ax = Math.abs(fr.N[0]) > 0.99 ? 'x' : Math.abs(fr.N[1]) > 0.99 ? 'y' : Math.abs(fr.N[2]) > 0.99 ? 'z' : null;
    if (ax) {
      const ti = { x: 0, y: 1, z: 2 }[ax];
      const ab = (p) => (ax === 'z' ? [p[0], p[1]] : ax === 'y' ? [p[0], p[2]] : [p[2], p[1]]);
      const front = hole.map(([u, v]) => at(u, v, 0)), rear = deep.map(([u, v]) => at(u, v, depth));
      const t0 = front[0][ti], t1 = rear[0][ti];
      this.voids.push(solidOf(ax, t0 < t1
        ? [{ t: t0, p: front.map(ab) }, { t: t1, p: rear.map(ab) }]
        : [{ t: t1, p: rear.map(ab) }, { t: t0, p: front.map(ab) }]));
    }
  }

  /** Накладка-прямоугольник на плоскости (окно, решётка): на lift над ней. */
  decalRect(fr, u0, v0, u1, v1, c, mat, emissive = 0, lift = 0.03) {
    const at = (u, v) => [
      fr.O[0] + fr.U[0] * u + fr.V[0] * v + fr.N[0] * lift,
      fr.O[1] + fr.U[1] * u + fr.V[1] * v + fr.N[1] * lift,
      fr.O[2] + fr.U[2] * u + fr.V[2] * v + fr.N[2] * lift];
    this.face([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], c, mat, fr.N, { decal: true, emissive });
  }

  /** Точка внутри какого-нибудь тела корпуса (м). skip — кроме этого тела. */
  inside(x, y, z, pad = 0, skip = null) {
    const box = (s) => !(x < s.lo[0] - pad || y < s.lo[1] - pad || z < s.lo[2] - pad
      || x > s.hi[0] + pad || y > s.hi[1] + pad || z > s.hi[2] + pad);
    let hit = false;
    for (const s of this.solids) {
      if (s === skip || !box(s)) continue;
      if (s.inside(x, y, z)) { hit = true; break; }
    }
    if (!hit) return false;
    for (const s of this.voids) if (box(s) && s.inside(x, y, z)) return false;
    return true;
  }
}

/** Тело для проверки «внутри ли точка»: сечения, сведённые по t. */
function solidOf(axis, secs) {
  const A = AXES[axis];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of secs) for (const [a, b] of s.p) {
    const q = A.put(a, b, s.t);
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
  }
  return {
    axis, lo, hi,
    // Без выделения памяти: этим вопросом считаются объём и центр масс —
    // сотни тысяч точек на сборку.
    inside(x, y, z) {
      const a = axis === 'x' ? z : x, b = axis === 'y' ? z : y, t = axis === 'x' ? x : axis === 'y' ? y : z;
      for (let k = 0; k + 1 < secs.length; k++) {
        const s0 = secs[k], s1 = secs[k + 1];
        if (s1.t - s0.t < 1e-9 || t < s0.t || t > s1.t) continue;
        const w = (t - s0.t) / (s1.t - s0.t);
        const P0 = s0.p, P1 = s1.p, n = P0.length;
        let hit = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const ia = P0[i][0] + (P1[i][0] - P0[i][0]) * w, ib = P0[i][1] + (P1[i][1] - P0[i][1]) * w;
          const ja = P0[j][0] + (P1[j][0] - P0[j][0]) * w, jb = P0[j][1] + (P1[j][1] - P0[j][1]) * w;
          if ((ib > b) !== (jb > b) && a < (ja - ia) * (b - ib) / (jb - ib) + ia) hit = !hit;
        }
        if (hit) return true;
      }
      return false;
    },
  };
}
