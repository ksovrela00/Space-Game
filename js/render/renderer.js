// Конвейер отрисовки: все объекты кладут в общую очередь «draw-итемы»
// с ключом глубины, очередь сортируется дальние->ближние и выполняется
// (алгоритм художника). Так планеты, полигональные модели и эффекты
// корректно перекрывают друг друга без z-буфера.

import { v3, dot } from '../core/vec3.js';
import { Camera } from './camera.js';
import { clipNear } from './clip.js';

// Доля рассеянного света. Ниже ~0.2 станция на ночной стороне планеты
// становится почти неразличимой, а стыковаться там всё равно приходится.
const AMBIENT = 0.24;

export class Renderer {
  /**
   * @param opts.transparent слой рисуется поверх другого (HUD): кадр
   *        очищается в прозрачность, а не заливается чёрным
   * @param opts.camera      общая камера (HUD и 3D-сцена должны смотреть
   *        одними глазами, иначе прицельные рамки разъедутся с картинкой)
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.transparent = !!opts.transparent;
    this.ctx = canvas.getContext('2d', { alpha: this.transparent });
    this.camera = opts.camera || new Camera();
    this.items = [];
    this.dpr = 1;
    this.polys = 0;
    // Переиспользуемые буферы, чтобы не аллоцировать на каждой грани.
    this._cam = [];
    this._sun = v3(0, 0, 1);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.resize(w, h);
  }

  begin() {
    this.items.length = 0;
    this.polys = 0;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.transparent) {
      ctx.clearRect(0, 0, this.camera.w, this.camera.h);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.camera.w, this.camera.h);
    }
    ctx.restore();
  }

  // Универсальный способ попасть в сортировку глубины.
  push(depth, draw) { this.items.push({ depth, draw }); }

  end() {
    this.items.sort((a, b) => b.depth - a.depth);
    const ctx = this.ctx;
    for (let i = 0; i < this.items.length; i++) this.items[i].draw(ctx);
  }

  /**
   * Отрисовать полигональную модель.
   * @param mesh   {verts, faces} из models/geometry.js
   * @param pos    позиция в мире
   * @param basis  ориентация (right/up/fwd)
   * @param scale  масштаб модели
   * @param sunDir мировое направление НА солнце (единичный вектор)
   * @param opts   {outline, emissive, alpha, depthBias}
   */
  drawMesh(mesh, pos, basis, scale, sunDir, opts = {}) {
    const cam = this.camera;
    const cb = cam.basis;

    // Композитная матрица: локальные координаты модели -> координаты камеры.
    // Столбцы = оси модели, повёрнутые в базис камеры и умноженные на масштаб.
    const ax = basis.right, ay = basis.up, az = basis.fwd;
    const m00 = dot(ax, cb.right) * scale, m01 = dot(ay, cb.right) * scale, m02 = dot(az, cb.right) * scale;
    const m10 = dot(ax, cb.up) * scale, m11 = dot(ay, cb.up) * scale, m12 = dot(az, cb.up) * scale;
    const m20 = dot(ax, cb.fwd) * scale, m21 = dot(ay, cb.fwd) * scale, m22 = dot(az, cb.fwd) * scale;

    const dx = pos.x - cam.pos.x, dy = pos.y - cam.pos.y, dz = pos.z - cam.pos.z;
    const ox = dx * cb.right.x + dy * cb.right.y + dz * cb.right.z;
    const oy = dx * cb.up.x + dy * cb.up.y + dz * cb.up.z;
    const oz = dx * cb.fwd.x + dy * cb.fwd.y + dz * cb.fwd.z;

    // Направление на солнце в локальных координатах модели — тогда
    // освещённость грани считается без трансформации нормалей.
    const sl = {
      x: dot(sunDir, ax),
      y: dot(sunDir, ay),
      z: dot(sunDir, az),
    };

    const verts = mesh.verts;
    const n = verts.length;
    const cv = this._cam;
    while (cv.length < n) cv.push({ x: 0, y: 0, z: 0 });
    for (let i = 0; i < n; i++) {
      const v = verts[i], c = cv[i];
      c.x = m00 * v.x + m01 * v.y + m02 * v.z + ox;
      c.y = m10 * v.x + m11 * v.y + m12 * v.z + oy;
      c.z = m20 * v.x + m21 * v.y + m22 * v.z + oz;
    }

    const near = cam.near;
    const bias = opts.depthBias || 0;
    const emissive = opts.emissive === true;
    const outline = opts.outline !== false;
    const alpha = opts.alpha === undefined ? 1 : opts.alpha;
    const faces = mesh.faces;

    for (let f = 0; f < faces.length; f++) {
      const face = faces[f];
      const idx = face.v;
      const k = idx.length;

      // Центроид в координатах камеры + отсев нелицевых граней.
      let gx = 0, gy = 0, gz = 0;
      for (let i = 0; i < k; i++) {
        const c = cv[idx[i]];
        gx += c.x; gy += c.y; gz += c.z;
      }
      gx /= k; gy /= k; gz /= k;

      const nl = face.n;
      const nx = m00 * nl.x + m01 * nl.y + m02 * nl.z;
      const ny = m10 * nl.x + m11 * nl.y + m12 * nl.z;
      const nz = m20 * nl.x + m21 * nl.y + m22 * nl.z;
      const facing = nx * gx + ny * gy + nz * gz;
      if (!face.twoSided && facing > 0) continue;

      // Собираем полигон и клипуем по ближней плоскости.
      const poly = new Array(k);
      let maxZ = -Infinity;
      for (let i = 0; i < k; i++) {
        const c = cv[idx[i]];
        poly[i] = c;
        if (c.z > maxZ) maxZ = c.z;
      }
      if (maxZ <= near) continue;
      const clipped = clipNear(poly, near);
      if (!clipped) continue;

      // Экранные координаты + отсев вырожденных/крошечных граней.
      const pts = new Array(clipped.length);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < clipped.length; i++) {
        const c = clipped[i];
        const kk = cam.focal / c.z;
        const sx = cam.cx + c.x * kk;
        const sy = cam.cy - c.y * kk;
        pts[i] = { x: sx, y: sy };
        if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
      }
      if (maxX < -8 || minX > cam.w + 8 || maxY < -8 || minY > cam.h + 8) continue;
      if (maxX - minX < 0.35 && maxY - minY < 0.35) continue;

      let shade = 1;
      if (!emissive && !face.emissive) {
        const lam = nl.x * sl.x + nl.y * sl.y + nl.z * sl.z;
        // Грань могла быть развёрнута к камере «с изнанки» (twoSided) —
        // тогда берём освещённость по модулю, иначе она была бы чёрной.
        const l = face.twoSided ? Math.abs(lam) : Math.max(0, lam);
        shade = AMBIENT + (1 - AMBIENT) * l;
      }

      const col = face.c;
      const r = Math.min(255, col[0] * shade) | 0;
      const g = Math.min(255, col[1] * shade) | 0;
      const b = Math.min(255, col[2] * shade) | 0;
      const fill = alpha < 1
        ? `rgba(${r},${g},${b},${alpha})`
        : `rgb(${r},${g},${b})`;
      const stroke = outline
        ? `rgb(${(r * 0.45) | 0},${(g * 0.45) | 0},${(b * 0.45) | 0})`
        : null;

      this.polys++;
      this.push(gz + bias, (ctx) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });
    }
  }

  // Светящееся пятно (солнце, выхлоп двигателя, огни станции).
  drawGlow(worldPos, radiusPx, color, depthOverride = null) {
    const cam = this.camera;
    const c = cam.toCamera(worldPos);
    if (c.z <= cam.near) return;
    const p = cam.project(c);
    const r = Math.max(1, radiusPx);
    if (p.x < -r || p.x > cam.w + r || p.y < -r || p.y > cam.h + r) return;
    this.push(depthOverride === null ? c.z : depthOverride, (ctx) => {
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grd.addColorStop(0, color);
      grd.addColorStop(0.45, color.replace('rgb(', 'rgba(').replace(')', ',0.45)'));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
