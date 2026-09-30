// Экраны кабины: холсты, на которых софт мониторов рисует картинку, и
// раскладка этих холстов по одному атласу на видеокарте.
//
// ЗАЧЕМ ХОЛСТЫ, а не рисование поверх кадра. Раньше приборы кабины
// рисовались на общем слое HUD и приклеивались к доске преобразованием
// холста. Выглядело это наклейкой: у надписи не было стекла, рамка
// кабины её не закрывала, солнце на неё не падало, свет от неё не
// ложился на доску. Теперь каждый экран — текстура на настоящем
// мониторе (js/gl/cabin.js): его закрывает ручка управления, на его
// стекле блик, и сам он подсвечивает всё перед собой.
//
// РАЗМЕР холста — от физического размера экрана и плотности профиля
// (js/core/quality.js): на компьютере 2000 точек на метр, то есть
// монитор в 25.5 см — 510 пикселей. Это вдвое-втрое больше, чем он
// занимает в кадре: картинка пишется с запасом и ужимается мипмапами,
// поэтому тонкие линии не рябят, а текст не рассыпается.
//
// ТЕМП — свой у каждого экрана (js/ui/panels.js, SCREEN_RATE): локатору
// с развёрткой нужно тридцать кадров в секунду, карте хватает шести.
// Перерисовать и загрузить все восемь холстов каждый кадр — это
// мегабайты в видеопамять шестьдесят раз в секунду ради картинки,
// которая почти не меняется.

import { drawScreen, SCREEN_RATE } from './panels.js';

const PAD = 4;                     // пикселей между холстами в атласе

const nextPow2 = (v) => 2 ** Math.ceil(Math.log2(Math.max(1, v)));

/**
 * Разложить экраны по атласу полками: сначала высокие, в ряд, пока
 * помещаются. Возвращает место каждого и размер атласа (степень двойки
 * по высоте: так мипмапы делятся ровно).
 */
export function layoutAtlas(sizes, atlasW) {
  const order = sizes.map((s, i) => ({ ...s, i })).sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0, y = 0, shelf = 0;
  const out = new Array(sizes.length);
  for (const s of order) {
    if (s.w > atlasW) throw new Error(`экран ${s.id} шире атласа (${s.w} > ${atlasW})`);
    if (x + s.w > atlasW) { x = 0; y += shelf + PAD; shelf = 0; }
    out[s.i] = { id: s.id, x, y, w: s.w, h: s.h };
    x += s.w + PAD;
    shelf = Math.max(shelf, s.h);
  }
  return { items: out, w: atlasW, h: nextPow2(y + shelf) };
}

const defaultCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return null;
};

/**
 * Холсты под все экраны кабины.
 *
 * @param cockpit модель кабины (js/models/cockpit.js): экраны с размерами в метрах
 * @param opts    { density: точек на метр, atlasW, rateK: множитель темпа, canvas: (w, h) => холст }
 */
export function makeDisplays(cockpit, opts = {}) {
  const density = opts.density || 2000;
  const atlasW = opts.atlasW || 2048;
  const make = opts.canvas || defaultCanvas;
  const screens = Object.values(cockpit.screens);
  const sizes = screens.map((s) => ({
    id: s.id, w: Math.round(s.w * density), h: Math.round(s.h * density),
  }));
  const atlas = layoutAtlas(sizes, atlasW);
  const list = atlas.items.map((it) => {
    const canvas = make(it.w, it.h);
    const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    return {
      ...it,
      canvas, ctx,
      rate: (SCREEN_RATE[it.id] || 10) * (opts.rateK || 1),
      next: 0,
      dirty: false,
      // Место в атласе в долях — его ждёт шейдер кабины.
      uv: [it.x / atlas.w, it.y / atlas.h, it.w / atlas.w, it.h / atlas.h],
    };
  });
  return { list, byId: Object.fromEntries(list.map((d) => [d.id, d])), w: atlas.w, h: atlas.h, density, draws: 0 };
}

/**
 * Перерисовать те экраны, чей срок подошёл. Время — секунды игрока;
 * экраны помечаются «грязными», и сцена загрузит в атлас только их.
 */
export function updateDisplays(d, game, now) {
  if (!d) return 0;
  let n = 0;
  for (const s of d.list) {
    if (!s.ctx || now < s.next) continue;
    // Срок — от ПЛАНА, а не от «сейчас»: иначе при 45 кадрах в секунду
    // тридцатигерцовый экран рисовался бы через кадр, то есть на 22 Гц.
    // Отстали (первый кадр, пауза) — план начинается заново от «сейчас».
    s.next += 1 / s.rate;
    if (s.next < now) s.next = now + 1 / s.rate;
    if (drawScreen(s.id, s.ctx, s.w, s.h, game)) { s.dirty = true; n++; }
  }
  d.draws += n;
  return n;
}
