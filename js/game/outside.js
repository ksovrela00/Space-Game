// Пилот за бортом: система отсчёта на грунте.
//
// Внутри корабля пилот ходит в осях КОРАБЛЯ (js/game/walker.js): пол —
// это палуба, куда бы ни смотрел корпус, а держит его компенсатор, ровно
// одним g. Снаружи так нельзя по трём причинам:
//
//   * корабль на стоянке может стоять с креном до 20° (допуск посадки), и
//     «вниз по кораблю» на грунте было бы вниз по склону;
//   * корабль может висеть и сноситься — а грунт под ногами нет;
//   * тяжесть снаружи — тела, а не компенсатора: на ледяной луне 0.8 м/с²,
//     и прыжок там втрое выше, чем на палубе.
//
// Поэтому, сойдя с порога люка, пилот переходит в оси ГРУНТА: начало — у
// ног, «вверх» — от центра тела, «вперёд» — нос корабля, положенный в
// горизонталь (тогда трап идёт вдоль оси, и его ступени остаются
// коробками). Оси вращаются вместе с телом (как и всё на нём), то есть
// для пилота грунт неподвижен.
//
// Кривизна тела на этих расстояниях — сантиметры: за километр поверхность
// уходит вниз на 0.1–0.3 м, и высота грунта считается по РАДИУСУ в той же
// точке, а не по оси «вверх», так что под ногами она верна точно. Дальше
// километра система отсчёта переносится к пилоту.

import { bodyFrame, waterAt } from './surface.js';

const _B = { right: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: 0 } };
const frameOf = (body) => {
  const f = bodyFrame(body);
  _B.right.x = f.right.x; _B.right.y = f.right.y; _B.right.z = f.right.z;
  _B.up.x = f.up.x; _B.up.y = f.up.y; _B.up.z = f.up.z;
  _B.fwd.x = f.fwd.x; _B.fwd.y = f.fwd.y; _B.fwd.z = f.fwd.z;
  return _B;
};
// Мир -> оси тела и обратно (поворот базиса тела).
const toLocal = (B, x, y, z, out) => {
  out[0] = B.right.x * x + B.right.y * y + B.right.z * z;
  out[1] = B.up.x * x + B.up.y * y + B.up.z * z;
  out[2] = B.fwd.x * x + B.fwd.y * y + B.fwd.z * z;
  return out;
};
const toWorldDir = (B, l, out) => {
  out.x = B.right.x * l[0] + B.up.x * l[1] + B.fwd.x * l[2];
  out.y = B.right.y * l[0] + B.up.y * l[1] + B.fwd.y * l[2];
  out.z = B.right.z * l[0] + B.up.z * l[1] + B.fwd.z * l[2];
  return out;
};
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; a[0] /= l; a[1] /= l; a[2] /= l; return a; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Дальше этого от начала оси переносятся к пилоту, м. */
export const RECENTER = 1000;

/**
 * Оси грунта у точки feet (мир, км) с «вперёд» по направлению fwd (мир).
 * @returns { body, o: начало в осях тела (км), r, u, f: оси в осях тела }
 */
export function makeGroundFrame(body, feet, fwd) {
  const B = frameOf(body);
  const o = toLocal(B, feet.x - body.pos.x, feet.y - body.pos.y, feet.z - body.pos.z, [0, 0, 0]);
  const u = norm(o.slice());
  const fl = toLocal(B, fwd.x, fwd.y, fwd.z, [0, 0, 0]);
  const k = fl[0] * u[0] + fl[1] * u[1] + fl[2] * u[2];
  let f = [fl[0] - u[0] * k, fl[1] - u[1] * k, fl[2] - u[2] * k];
  if (Math.hypot(f[0], f[1], f[2]) < 1e-6) f = cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  norm(f);
  const r = cross(u, f);
  return { body, o, r, u, f };
}

const _l = [0, 0, 0];

/** Точка в осях грунта (м) -> мир (км). */
export function groundToWorld(G, p, out = { x: 0, y: 0, z: 0 }) {
  const B = frameOf(G.body);
  for (let i = 0; i < 3; i++) _l[i] = G.o[i] + (G.r[i] * p[0] + G.u[i] * p[1] + G.f[i] * p[2]) / 1000;
  toWorldDir(B, _l, out);
  out.x += G.body.pos.x; out.y += G.body.pos.y; out.z += G.body.pos.z;
  return out;
}

/** Направление в осях грунта -> мир. */
export function groundDirToWorld(G, d, out = { x: 0, y: 0, z: 0 }) {
  const B = frameOf(G.body);
  for (let i = 0; i < 3; i++) _l[i] = G.r[i] * d[0] + G.u[i] * d[1] + G.f[i] * d[2];
  return toWorldDir(B, _l, out);
}

/** Мир (км) -> оси грунта (м). */
export function worldToGround(G, P, out = [0, 0, 0]) {
  const B = frameOf(G.body);
  toLocal(B, P.x - G.body.pos.x, P.y - G.body.pos.y, P.z - G.body.pos.z, _l);
  const qx = _l[0] - G.o[0], qy = _l[1] - G.o[1], qz = _l[2] - G.o[2];
  out[0] = (qx * G.r[0] + qy * G.r[1] + qz * G.r[2]) * 1000;
  out[1] = (qx * G.u[0] + qy * G.u[1] + qz * G.u[2]) * 1000;
  out[2] = (qx * G.f[0] + qy * G.f[1] + qz * G.f[2]) * 1000;
  return out;
}

/** Направление мира -> оси грунта. */
export function worldDirToGround(G, d, out = [0, 0, 0]) {
  const B = frameOf(G.body);
  toLocal(B, d.x, d.y, d.z, _l);
  out[0] = _l[0] * G.r[0] + _l[1] * G.r[1] + _l[2] * G.r[2];
  out[1] = _l[0] * G.u[0] + _l[1] * G.u[1] + _l[2] * G.u[2];
  out[2] = _l[0] * G.f[0] + _l[1] * G.f[1] + _l[2] * G.f[2];
  return out;
}

const _d = { x: 0, y: 0, z: 0 };

/** Направление из центра тела на точку (x, 0, z) осей грунта и её радиус, км. */
function radial(G, x, z) {
  for (let i = 0; i < 3; i++) _l[i] = G.o[i] + (G.r[i] * x + G.f[i] * z) / 1000;
  const len = Math.hypot(_l[0], _l[1], _l[2]);
  _d.x = _l[0] / len; _d.y = _l[1] / len; _d.z = _l[2] / len;
  return len;
}

/**
 * Высота грунта под точкой (x, z) осей грунта, м.
 * @param radiusOf (body, dirLocal) -> радиус грунта, км: нарисованный
 *        (js/gl/scene.js, drawnGround) — ноги стоят на той земле, что в кадре
 */
export function groundY(G, x, z, radiusOf) {
  const len = radial(G, x, z);
  return (radiusOf(G.body, _d) - len) * 1000;
}

/** Вода ли под точкой (x, z) осей грунта. */
export function waterUnder(G, x, z) {
  radial(G, x, z);
  return waterAt(G.body, _d);
}

/**
 * Перенос в оси грунта корабля: поворот R (3×3, строки) и сдвиг t (м),
 * чтобы точка корабля p (м) легла в оси грунта как R·p + t.
 */
export function shipToGround(G, ship, out = { R: new Float64Array(9), t: [0, 0, 0] }) {
  const b = ship.basis;
  const ax = [b.right, b.up, b.fwd];
  const tmp = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    worldDirToGround(G, ax[c], tmp);
    out.R[c] = tmp[0]; out.R[3 + c] = tmp[1]; out.R[6 + c] = tmp[2];
  }
  worldToGround(G, ship.pos, out.t);
  return out;
}

/** Точка корабля (м) -> оси грунта (м). */
export function shipPointToGround(T, p, out = [0, 0, 0]) {
  const R = T.R;
  out[0] = R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + T.t[0];
  out[1] = R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + T.t[1];
  out[2] = R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + T.t[2];
  return out;
}

/** Точка осей грунта (м) -> оси корабля (м): поворот обратный, то есть транспонированный. */
export function groundPointToShip(T, g, out = [0, 0, 0]) {
  const R = T.R;
  const x = g[0] - T.t[0], y = g[1] - T.t[1], z = g[2] - T.t[2];
  out[0] = R[0] * x + R[3] * y + R[6] * z;
  out[1] = R[1] * x + R[4] * y + R[7] * z;
  out[2] = R[2] * x + R[5] * y + R[8] * z;
  return out;
}

// --- днище корабля --------------------------------------------------------------
//
// Под стоящим кораблём ходят: днище в четырёх метрах над грунтом, а у
// гондол — в пяти. Но на лёгком теле прыгают высоко (на ледяной луне —
// почти на шесть метров), и без днища голова уходила бы в корпус снизу.
// Твёрдое днище — карта самой низкой точки обшивки над каждой клеткой
// в полметра (оси корабля): у пилота ищутся клетки вокруг него, и из них
// получаются коробки от днища вверх. Считается один раз на корпус.

const UNDER = { cell: 0.5, half: 36 };

/** Карта днища: самая низкая точка обшивки над клеткой (м, оси корабля). */
export function hullUnderside(hull) {
  const c = UNDER.cell, n = Math.round(UNDER.half * 2 / c);
  const minY = new Float32Array(n * n).fill(Infinity);
  const V = hull.verts.map((v) => [v.x * 1000, v.y * 1000, v.z * 1000]);
  for (const f of hull.faces) {
    for (let k = 1; k + 1 < f.v.length; k++) {
      const a = V[f.v[0]], b = V[f.v[k]], d = V[f.v[k + 1]];
      const area = (b[0] - a[0]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[0] - a[0]);
      if (Math.abs(area) < 1e-9) continue;          // стенка стоймя: сверху её не видно
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], d[0]) + UNDER.half) / c));
      const i1 = Math.min(n - 1, Math.floor((Math.max(a[0], b[0], d[0]) + UNDER.half) / c));
      const k0 = Math.max(0, Math.floor((Math.min(a[2], b[2], d[2]) + UNDER.half) / c));
      const k1 = Math.min(n - 1, Math.floor((Math.max(a[2], b[2], d[2]) + UNDER.half) / c));
      for (let i = i0; i <= i1; i++) {
        const x = -UNDER.half + (i + 0.5) * c;
        for (let j = k0; j <= k1; j++) {
          const z = -UNDER.half + (j + 0.5) * c;
          const w1 = ((b[0] - x) * (d[2] - z) - (b[2] - z) * (d[0] - x)) / area;
          const w2 = ((d[0] - x) * (a[2] - z) - (d[2] - z) * (a[0] - x)) / area;
          const w3 = 1 - w1 - w2;
          if (w1 < 0 || w2 < 0 || w3 < 0) continue;
          const y = w1 * a[1] + w2 * b[1] + w3 * d[1];
          const at = i * n + j;
          if (y < minY[at]) minY[at] = y;
        }
      }
    }
  }
  return { n, minY };
}

/**
 * Коробки днища вокруг точки p (оси корабля, м) в радиусе r — только
 * там, где обшивка ВЫШЕ ног: у люка днище ниже порога, и коробка там
 * перекрыла бы выход из тоннеля.
 */
export function undersideBoxes(map, p, r, out) {
  const c = UNDER.cell, n = map.n;
  const i0 = Math.max(0, Math.floor((p[0] - r + UNDER.half) / c)), i1 = Math.min(n - 1, Math.floor((p[0] + r + UNDER.half) / c));
  const k0 = Math.max(0, Math.floor((p[2] - r + UNDER.half) / c)), k1 = Math.min(n - 1, Math.floor((p[2] + r + UNDER.half) / c));
  for (let i = i0; i <= i1; i++) {
    for (let k = k0; k <= k1; k++) {
      const y = map.minY[i * n + k];
      if (!(y < Infinity) || y < p[1] + 0.5) continue;
      const x = -UNDER.half + i * c, z = -UNDER.half + k * c;
      out.push({ lo: [x, y, z], hi: [x + c, y + 3, z + c], hull: true });
    }
  }
  return out;
}

/** Коробка корабля -> коробка осей грунта (по восьми углам). */
export function boxToGround(T, s, out) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const c = [0, 0, 0], q = [0, 0, 0];
  for (let i = 0; i < 8; i++) {
    c[0] = i & 1 ? s.hi[0] : s.lo[0]; c[1] = i & 2 ? s.hi[1] : s.lo[1]; c[2] = i & 4 ? s.hi[2] : s.lo[2];
    shipPointToGround(T, c, q);
    for (let a = 0; a < 3; a++) { if (q[a] < lo[a]) lo[a] = q[a]; if (q[a] > hi[a]) hi[a] = q[a]; }
  }
  if (out) { out.lo = lo; out.hi = hi; return out; }
  return { lo, hi };
}
