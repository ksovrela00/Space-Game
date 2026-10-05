// Холст приборов: прозрачный слой поверх WebGL-сцены.
//
// Раньше это был тот же класс, что рисовал сцену на Canvas 2D (запасной
// рендер, js/render/renderer.js), — приборам из него нужны были только
// холст, камера и очистка кадра. Запасной рендер вырезан (README,
// «Рендер»), и слою приборов оставлено ровно то, чем он пользуется.

import { Q } from '../core/quality.js';

export class HudLayer {
  /**
   * @param canvas холст приборов (#hud)
   * @param camera общая со сценой камера: прицельные рамки обязаны смотреть
   *        теми же глазами, что и картинка, иначе разъедутся с ней
   */
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.camera = camera;
    this.dpr = 1;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, Q.maxDpr);
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

  /** Новый кадр: слой — в прозрачность, сцена под ним видна. */
  begin() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.camera.w, this.camera.h);
    ctx.restore();
  }
}
