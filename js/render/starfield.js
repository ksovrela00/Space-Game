// Звёздный фон: точки на единичной сфере и полоса галактического диска
// из семени системы. Здесь только данные: рисует их WebGL-сцена
// (js/gl/scene.js, buildStars), звёзды бесконечно далеко.

import { makeRng } from '../core/rng.js';

const norm3 = (x, y, z) => {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
};

const cross3 = (a, b) => norm3(
  a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/**
 * Галактический диск этой системы — ВСЁ из seed.
 *
 * Отсюда берётся и сгущение звёзд, и светящаяся полоса на фоне
 * (js/gl/nebula.js). Числа обязаны быть общими: иначе полоса ляжет мимо
 * своих же звёзд, и это первое, что бросится в глаза.
 *
 * Ничего узнаваемого здесь нет намеренно — у следующей звёздной системы
 * будет свой seed и своё небо: другой наклон полосы, другая сторона, где
 * ядро, другая ширина диска.
 *
 * Единственное ограничение — наклон к плоскости системы от 18° до 81°.
 * Совпади полоса с плоскостью орбит, глаз прочтёт её как кольцо ЭТОЙ
 * системы, а не как галактику вокруг; встань она точно поперёк — она
 * разделит небо ровно пополам, и это будет выглядеть нарисованным.
 */
export function galaxyFor(seed) {
  const rng = makeRng((seed ^ 0x9a17) >>> 0);
  const tilt = rng.range(0.15, 0.95);            // косинус угла к оси системы
  const th = rng.range(0, Math.PI * 2);
  const s = Math.sqrt(1 - tilt * tilt);
  const pole = norm3(s * Math.cos(th), tilt, s * Math.sin(th));
  const helper = Math.abs(pole.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const e1 = cross3(helper, pole);
  const e2 = cross3(pole, e1);
  // Направление на ядро — где-то в самой плоскости диска: там полоса
  // ярче и шире всего.
  const a = rng.range(0, Math.PI * 2);
  const core = norm3(
    e1.x * Math.cos(a) + e2.x * Math.sin(a),
    e1.y * Math.cos(a) + e2.y * Math.sin(a),
    e1.z * Math.cos(a) + e2.z * Math.sin(a));
  return {
    pole, e1, e2, core,
    sigma: rng.range(0.11, 0.19),   // полуширина диска в косинусе широты
    share: rng.range(0.36, 0.52),   // какая доля звёзд лежит в полосе
  };
}

export class Starfield {
  constructor(count = 900, seed = 12345) {
    const rng = makeRng(seed);
    this.dirs = new Float64Array(count * 3);
    this.mag = new Float32Array(count);
    this.tint = new Uint8Array(count);
    // Небо и звёзды — из одного seed, иначе они разойдутся.
    this.galaxy = galaxyFor(seed);
    const { e1, e2, pole, sigma, share } = this.galaxy;
    for (let i = 0; i < count; i++) {
      // Часть звёзд ложится в плоскость диска, остальные — равномерно по
      // сфере. Равномерная россыпь сама по себе выглядит мёртвой:
      // сгущение в полосу и есть то, из-за чего небо читается как вид
      // изнутри галактики, а не как купол планетария.
      //
      // Широта в полосе — сумма трёх равномерных: её дисперсия ровно 1,
      // поэтому умножение на sigma даёт колокол нужной ширины без
      // логарифмов и тригонометрии.
      const u = rng.next() < share
        ? Math.max(-1, Math.min(1, sigma *
          (rng.range(-1, 1) + rng.range(-1, 1) + rng.range(-1, 1))))
        : rng.range(-1, 1);
      const th = rng.range(0, Math.PI * 2);
      const s = Math.sqrt(1 - u * u);
      const c = Math.cos(th), sn = Math.sin(th);
      // Широта отсчитывается от полюса диска, поэтому направление
      // собирается в его осях, а не в мировых.
      this.dirs[i * 3] = s * (e1.x * c + e2.x * sn) + pole.x * u;
      this.dirs[i * 3 + 1] = s * (e1.y * c + e2.y * sn) + pole.y * u;
      this.dirs[i * 3 + 2] = s * (e1.z * c + e2.z * sn) + pole.z * u;
      // Больше тусклых звёзд, чем ярких
      this.mag[i] = Math.pow(rng.next(), 2.2);
      this.tint[i] = rng.int(0, 5);
    }
    this.count = count;
  }
}
