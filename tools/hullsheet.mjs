// Лист чертежа корпуса: виды сбоку, сверху, спереди, сзади, снизу и
// два ракурса в перспективе — PNG, без браузера.
//
//   node tools/hullsheet.mjs                     «Прометей» → hullsheet.png
//   node tools/hullsheet.mjs --png=путь.png
//   node tools/hullsheet.mjs --views=persp       только ракурсы (крупно)
//
// Зачем. Снимок игры (tools/screen.mjs) идёт через SwiftShader и стоит
// минуты, а корпус из простых тел правится десятками мелких шагов: что
// уступ не провалился, окна легли на борт и стойки стоят под гондолами,
// видно на ортогональных видах сразу. Рядом в том же масштабе —
// «Челленджер»: «втрое больше» проверяется глазом, а не на слово.
//
// Затенение плоское, как в игре: свет — с одной стороны, рассеянный —
// снизу, свечение окон и ангара — как есть. Швов обшивки здесь нет: их
// рисует шейдер (js/gl/hull.js).

import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { buildPrometheus, buildPrometheusGear } from '../js/models/prometheus.js';
import { buildCobra, buildGear } from '../js/models/ships.js';
import { stageLift } from '../js/models/gear.js';

const arg = (name, def = null) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit === undefined ? def : hit.slice(name.length + 3);
};

// --- PNG ------------------------------------------------------------------------
function png(w, h, rgb) {
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(rows, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const crcT = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// --- растр ----------------------------------------------------------------------

/** Холст со своим z-буфером; рисуем в нём с запасом в SS раз. */
class Canvas {
  constructor(w, h, bg = [24, 26, 30]) {
    this.w = w; this.h = h;
    this.rgb = new Float32Array(w * h * 3);
    this.z = new Float32Array(w * h).fill(Infinity);
    for (let i = 0; i < w * h; i++) { this.rgb[i * 3] = bg[0]; this.rgb[i * 3 + 1] = bg[1]; this.rgb[i * 3 + 2] = bg[2]; }
  }
  tri(A, B, C, col) {
    const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(this.w - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(this.h - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
    if (Math.abs(den) < 1e-12) return;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / den;
        const w1 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
        const i = y * this.w + x;
        if (z >= this.z[i]) continue;
        this.z[i] = z;
        this.rgb[i * 3] = col[0]; this.rgb[i * 3 + 1] = col[1]; this.rgb[i * 3 + 2] = col[2];
      }
    }
  }
  // Линия (для рамок и отметок).
  line(x0, y0, x1, y1, col) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
    for (let k = 0; k <= n; k++) {
      const x = Math.round(x0 + (x1 - x0) * k / n), y = Math.round(y0 + (y1 - y0) * k / n);
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const i = y * this.w + x;
      this.rgb[i * 3] = col[0]; this.rgb[i * 3 + 1] = col[1]; this.rgb[i * 3 + 2] = col[2];
    }
  }
}

const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const LIGHT = norm([-0.45, 0.75, 0.48]);

/**
 * Нарисовать сетки (в МЕТРАХ). proj(p) → [x, y, глубина] на холсте;
 * view — направление взгляда (для разворота нормали к камере).
 */
function draw(cv, parts, proj, viewDir) {
  for (const part of parts) {
    for (const f of part.faces) {
      const P = f.v.map((i) => part.verts[i]);
      const n = [f.n.x, f.n.y, f.n.z];
      const vd = typeof viewDir === 'function' ? viewDir(P[0]) : viewDir;
      // Свет двусторонний, как в игре: нормаль — к камере.
      const toCam = -(n[0] * vd[0] + n[1] * vd[1] + n[2] * vd[2]);
      const nn = toCam < 0 ? n.map((x) => -x) : n;
      const lam = Math.max(0, nn[0] * LIGHT[0] + nn[1] * LIGHT[1] + nn[2] * LIGHT[2]);
      const sky = 0.5 + 0.5 * nn[1];
      // Снизу — слабый отсвет (грунта или планеты), иначе днище на
      // листе чёрное и деталей на нём не разобрать.
      const lit = 0.22 + 0.12 * sky + 0.78 * lam + 0.22 * Math.max(0, -nn[1]);
      const em = f.emissive || 0;
      const k = lit * (1 - em) + em * 1.25;
      const col = f.c.map((c) => Math.min(255, c * k));
      const Q = P.map((p) => proj([p.x, p.y, p.z]));
      if (Q.some((q) => !q)) continue;
      for (let t = 1; t + 1 < Q.length; t++) cv.tri(Q[0], Q[t], Q[t + 1], col);
    }
  }
}

/** Км → м, сдвиг (для стоек, приставленных к корпусу). */
const meters = (mesh, off = [0, 0, 0], scale = 1) => ({
  faces: mesh.faces,
  verts: mesh.verts.map((v) => ({ x: v.x * 1000 * scale + off[0], y: v.y * 1000 * scale + off[1], z: v.z * 1000 * scale + off[2] })),
});

// Ортогональный вид: оси экрана — какие оси модели, с каким знаком.
function ortho(cv, parts, rect, axes, pxPerM, center) {
  const [ax, sx, ay, sy, az, sz] = axes;
  const proj = (p) => [
    rect[0] + rect[2] / 2 + (p[ax] - center[ax]) * sx * pxPerM,
    rect[1] + rect[3] / 2 - (p[ay] - center[ay]) * sy * pxPerM,
    -p[az] * sz,
  ];
  const vd = [0, 0, 0];
  vd[az] = -sz;
  draw(cv, parts, proj, vd);
}

// Перспектива: камера в eye, смотрит в target.
function persp(cv, parts, rect, eye, target, fovDeg) {
  const f = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const r = norm([f[2], 0, -f[0]]);         // вправо (y вверх)
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const foc = (rect[3] / 2) / Math.tan(fovDeg * Math.PI / 360);
  const proj = (p) => {
    const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    if (z < 0.5) return null;
    const x = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
    const y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    return [rect[0] + rect[2] / 2 - x / z * foc, rect[1] + rect[3] / 2 - y / z * foc, z];
  };
  draw(cv, parts, proj, (p) => norm([p.x - eye[0], p.y - eye[1], p.z - eye[2]]));
}

// Уменьшение в SS раз — сглаживание.
function downsample(cv, ss) {
  const w = Math.floor(cv.w / ss), h = Math.floor(cv.h / ss);
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) s += cv.rgb[((y * ss + j) * cv.w + x * ss + i) * 3 + c];
        out[(y * w + x) * 3 + c] = Math.round(s / (ss * ss));
      }
    }
  }
  return { w, h, out };
}

// --- лист -----------------------------------------------------------------------

// Стойки — ступенями от точек крепления, выпущенными (t = 1): так их
// рисует и игра (js/gl/scene.js, drawGearOf).
const legsOf = (G, t = 1) => {
  const out = [];
  G.hardpoints.forEach((hp, i) => {
    for (const part of G.legs[i].parts) {
      const lift = stageLift(G.legs[i], G.legLengths[i], 0, t, part.k);
      out.push(meters(part.mesh, [hp.x * 1000, (hp.y + lift) * 1000, hp.z * 1000]));
    }
  });
  return out;
};
const hull = buildPrometheus();
const gear = buildPrometheusGear(hull);
const P = [meters(hull), meters(hull.decal), ...legsOf(gear)];
const cob = buildCobra();
const cgear = buildGear();
const cparts = [meters(cob), meters(cob.decal), ...legsOf(cgear)];

const SS = 2;
const views = arg('views', 'all');
const out = arg('png', 'hullsheet.png');

// Габарит в метрах.
const ext = (parts) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (const v of p.verts) {
    const q = [v.x, v.y, v.z];
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
  }
  return { lo, hi, c: lo.map((l, k) => (l + hi[k]) / 2), s: hi.map((h, k) => h - lo[k]) };
};
const E = ext(P), EC = ext(cparts);
const ground = hull.prom.ground;

if (views === 'all') {
  const W = 2400, H = 1720;
  const cv = new Canvas(W * SS, H * SS);
  const ppm = 6.4 * SS;          // точек на метр в ортогональных видах
  // Сбоку (с правого борта, нос вправо) и «Челленджер» рядом.
  ortho(cv, P, [0, 0, 1320 * SS, 470 * SS], [2, 1, 1, 1, 0, -1], ppm, [E.c[0], E.c[1] + 4, E.c[2]]);
  ortho(cv, cparts, [1320 * SS, 0, 520 * SS, 470 * SS], [2, 1, 1, 1, 0, -1], ppm, [EC.c[0], E.c[1] + 4 - (E.lo[1] - EC.lo[1]) + (ground - (-(cgear.legLength + 0) * 1000)) * 0, EC.c[2]]);
  // Спереди и сзади.
  ortho(cv, P, [1840 * SS, 0, 560 * SS, 470 * SS], [0, -1, 1, 1, 2, 1], ppm, [0, E.c[1] + 4, 0]);
  ortho(cv, P, [1840 * SS, 470 * SS, 560 * SS, 470 * SS], [0, 1, 1, 1, 2, -1], ppm, [0, E.c[1] + 4, 0]);
  // Сверху (нос вправо, правый борт вниз) и снизу.
  ortho(cv, P, [0, 470 * SS, 1320 * SS, 600 * SS], [2, 1, 0, -1, 1, 1], ppm, [0, 0, E.c[2]]);
  ortho(cv, P, [0, 1070 * SS, 1320 * SS, 0 * SS + 650 * SS], [2, 1, 0, 1, 1, -1], ppm, [0, 0, E.c[2]]);
  // Ракурсы: спереди-слева сверху (как третий рендер) и сзади-слева.
  persp(cv, P, [1320 * SS, 940 * SS, 1080 * SS, 780 * SS], [-150, 95, 210], [0, 4, 10], 38);
  // Отметка грунта на виде сбоку.
  const gy = (470 * SS) / 2 - (ground - (E.c[1] + 4)) * ppm;
  cv.line(0, gy, 1840 * SS, gy, [90, 70, 50]);
  // Рамки видов.
  for (const [x, y, w, h] of [[0, 0, 1320, 470], [1320, 0, 520, 470], [1840, 0, 560, 470], [1840, 470, 560, 470], [0, 470, 1320, 600], [0, 1070, 1320, 650], [1320, 940, 1080, 780]]) {
    cv.line(x * SS, y * SS, (x + w) * SS, y * SS, [60, 64, 72]);
    cv.line(x * SS, y * SS, x * SS, (y + h) * SS, [60, 64, 72]);
  }
  const d = downsample(cv, SS);
  await writeFile(out, png(d.w, d.h, d.out));
} else if (views === 'gear') {
  // Стойки крупно: носовая «Челленджера» и главная «Прометея».
  const W = 1920, H = 1080;
  const cv = new Canvas(W * SS, H * SS, [18, 19, 22]);
  const hp = cgear.hardpoints[0], hq = gear.hardpoints[2];
  persp(cv, cparts, [0, 0, W / 2 * SS, H * SS], [hp.x * 1000 - 9, hp.y * 1000 - 3.5, hp.z * 1000 + 11], [hp.x * 1000, hp.y * 1000 - 2.6, hp.z * 1000], 40);
  persp(cv, P, [W / 2 * SS, 0, W / 2 * SS, H * SS], [hq.x * 1000 + 22, hq.y * 1000 - 5.5, hq.z * 1000 + 26], [hq.x * 1000, hq.y * 1000 - 3.5, hq.z * 1000], 40);
  const d = downsample(cv, SS);
  await writeFile(out, png(d.w, d.h, d.out));
} else {
  const W = 1920, H = 1080 * 2;
  const cv = new Canvas(W * SS, H * SS, [18, 19, 22]);
  persp(cv, P, [0, 0, W * SS, 1080 * SS], [-165, 85, 215], [0, 2, 5], 34);
  persp(cv, P, [0, 1080 * SS, W * SS, 1080 * SS], [-150, 60, -150], [0, 6, -10], 34);
  const d = downsample(cv, SS);
  await writeFile(out, png(d.w, d.h, d.out));
}

const tris = (m) => m.faces.reduce((s, f) => s + f.v.length - 2, 0);
console.log(`${hull.name}: ${E.s[2].toFixed(1)} × ${E.s[0].toFixed(1)} × ${(E.hi[1] - E.lo[1]).toFixed(1)} м (с шасси до ${(E.lo[1]).toFixed(1)}), `
  + `${tris(hull)} треугольников корпуса, ${tris(hull.decal)} накладок, окон ${hull.detail.windows} (горят ${hull.detail.lit})`);
console.log(`объём ${Math.round(hull.prom.volume)} м³, центр масс — ${hull.prom.shift.y.toFixed(2)} м над килем и ${(hull.prom.shift.z - 97.5).toFixed(2)} м от середины длины`);
const legInfo = (G) => G.legs.map((l, i) => `${(G.legLengths[i] * 1000).toFixed(2)} м, гильза ⌀${(l.r * 2000).toFixed(2)}, пята ${(l.pad.w * 1000).toFixed(1)}×${(l.pad.l * 1000).toFixed(1)}`).join('; ');
console.log('стойки «Прометея»: ' + legInfo(gear));
console.log('стойки «Челленджера»: ' + legInfo(cgear));
console.log(`«Челленджер»: ${EC.s[2].toFixed(1)} × ${EC.s[0].toFixed(1)} × ${EC.s[1].toFixed(1)} м; длиннее в ${(E.s[2] / EC.s[2]).toFixed(2)} раза`);
console.log('лист: ' + out);
