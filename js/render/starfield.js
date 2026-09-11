// Звёздный фон: точки на единичной сфере, повёрнутые в базис камеры.
// Рисуется до всей геометрии и не участвует в сортировке по глубине —
// звёзды бесконечно далеко.

import { makeRng } from '../core/rng.js';

export class Starfield {
  constructor(count = 900, seed = 12345) {
    const rng = makeRng(seed);
    this.dirs = new Float64Array(count * 3);
    this.mag = new Float32Array(count);
    this.tint = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      // Равномерное распределение по сфере
      const u = rng.range(-1, 1);
      const th = rng.range(0, Math.PI * 2);
      const s = Math.sqrt(1 - u * u);
      this.dirs[i * 3] = s * Math.cos(th);
      this.dirs[i * 3 + 1] = u;
      this.dirs[i * 3 + 2] = s * Math.sin(th);
      // Больше тусклых звёзд, чем ярких
      this.mag[i] = Math.pow(rng.next(), 2.2);
      this.tint[i] = rng.int(0, 5);
    }
    this.count = count;
    this.colors = ['#ffffff', '#dfe9ff', '#fff2d8', '#ffd9c0', '#cfe0ff', '#f0f0ff'];
  }

  draw(renderer) {
    const cam = renderer.camera;
    const ctx = renderer.ctx;
    const b = cam.basis;
    const rx = b.right, uy = b.up, fz = b.fwd;
    const focal = cam.focal, cx = cam.cx, cy = cam.cy, w = cam.w, h = cam.h;
    const d = this.dirs;

    ctx.save();
    for (let i = 0; i < this.count; i++) {
      const x = d[i * 3], y = d[i * 3 + 1], z = d[i * 3 + 2];
      const cz = x * fz.x + y * fz.y + z * fz.z;
      if (cz <= 0.05) continue;
      const ccx = x * rx.x + y * rx.y + z * rx.z;
      const ccy = x * uy.x + y * uy.y + z * uy.z;
      const k = focal / cz;
      const sx = cx + ccx * k;
      if (sx < 0 || sx > w) continue;
      const sy = cy - ccy * k;
      if (sy < 0 || sy > h) continue;

      const m = this.mag[i];
      const a = 0.25 + m * 0.75;
      ctx.globalAlpha = a;
      ctx.fillStyle = this.colors[this.tint[i]];
      const size = m > 0.82 ? 2 : 1;
      ctx.fillRect(sx | 0, sy | 0, size, size);
    }
    ctx.restore();
  }
}
