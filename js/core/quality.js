// Устройство и бюджеты качества.
//
// Зачем. Игра рисует процедурную поверхность, а это работа на КАЖДЫЙ
// ПИКСЕЛЬ: плитки пекутся в текстуры, у мешей считается мелкий рельеф,
// поверх идут пыль, камни и кабина. На настольной машине это норма, а
// на телефоне — прямой путь к десяти кадрам в секунду, причём не из-за
// числа треугольников, а из-за числа пикселей и числа плиток.
//
// Отсюда два бюджета, а не один «уровень графики»:
//
//   * ПЛОТНОСТЬ ПИКСЕЛЕЙ. У iPhone 14 Pro экран 852 × 393 точки CSS при
//     devicePixelRatio = 3, то есть честный кадр — 2556 × 1179 ≈ 3.0
//     мегапикселя. Это больше, чем Full HD, на шестидюймовом экране.
//     Ограничение до двух даёт 1704 × 786 ≈ 1.3 Мп — вчетверо меньше
//     работы, а разницы на таком экране глаз не видит;
//   * ЧИСЛО ОБЪЕКТОВ: плиток поверхности в памяти и в кадре, потоков
//     сборки, камней, пылинок. Всё это упирается не в пиксели, а в
//     процессор и в память, которой на телефоне втрое меньше.
//
// Профиль выбирается ОДИН РАЗ при загрузке и дальше только читается:
// переключать качество на ходу — это пересборка всех плиток посреди
// полёта, что само по себе даёт провал кадров.

const has = (fn) => { try { return fn(); } catch (e) { return false; } };

// Свой, а не из core/vec3: этот модуль читают ДО игры (профиль выбирается
// при загрузке), и тянуть ради одной строки векторную математику незачем.
const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/**
 * Что за устройство. Признаки берутся не из строки браузера (её
 * подделывают и она врёт), а из того, что можно спросить: есть ли
 * касания, какой указатель, какого размера экран.
 */
export function detectDevice(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return { touch: false, coarse: false, small: false, mobile: false, dpr: 1, w: 1280, h: 720 };
  const nav = win.navigator || {};
  const touch = has(() => 'ontouchstart' in win || (nav.maxTouchPoints || 0) > 0);
  // Грубый указатель — это палец: мышь и трекпад дают fine. Признак
  // надёжнее числа касаний: у ноутбуков с сенсорным экраном касания
  // есть, а играют на них мышью.
  const coarse = has(() => !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches));
  const w = win.innerWidth || 1280, h = win.innerHeight || 720;
  const small = Math.min(w, h) <= 500 || Math.max(w, h) <= 950;
  const dpr = win.devicePixelRatio || 1;
  return { touch, coarse, small, mobile: touch && coarse, dpr, w, h };
}

/**
 * Бюджеты под устройство.
 *
 * Числа настольного профиля — те же, что были в коде до появления
 * профилей: он ничего не меняет. Мобильный урезает ровно то, что
 * стоит дорого, и не трогает то, что дёшево (звёзды считаются один
 * раз, а рисуются одним вызовом).
 */
export function qualityFor(dev) {
  if (!dev.mobile) {
    return {
      name: 'настольный',
      maxDpr: 2,
      tileBudget: 440,      // плиток в памяти
      targetDraw: 220,      // плиток в кадре — норма для регулятора допуска
      texelTol: 40,         // пикселей на тексель запечённой текстуры
      workers: 3,
      rocks: 520,
      // Растений в поле (js/gl/flora.js). Вдвое больше камней, хотя
      // каждое и вдесятеро дороже по граням: дерево видно за километр, и
      // упирается поле не в треугольники (их тут вчетверо меньше, чем у
      // города), а в РАДИУС. Меньше тысячи — и лес кончается в
      // полукилометре от корабля, то есть едет за ним островом.
      flora: 1100,
      dust: 150,
      motes: 400,
      stars: 950,
      sky: 512,             // сторона грани кубической карты неба
      detail: true,         // процедурный рельеф на пиксель
      touchUi: dev.touch,   // сенсорные органы — по наличию касаний
      // Приборы РАСТУТ вместе с экраном. Раньше здесь стояла единица, и
      // на широком мониторе (2556 точек) подписи в 9–10 пикселей
      // превращались в нечитаемую сыпь: панель, занимавшая четверть
      // кадра на 1280, занимала на нём десятую часть. Отсчёт идёт от
      // 1600×900 — размера, на котором приборы и рисовались.
      //
      // Берётся МЕНЬШЕЕ из двух отношений: на широком и низком экране
      // расти по ширине нельзя, панели полезли бы одна на другую по
      // высоте. Верхний предел — чтобы приборы не съели кадр на 4K.
      hudScale: clamp(Math.min(dev.w / 1600, dev.h / 900), 1, 2),
    };
  }
  // Мобильный. Масштаб приборов считается от высоты экрана: на 393
  // точках панель в 112 пикселей занимает почти треть кадра.
  const hudScale = Math.max(0.62, Math.min(1, Math.min(dev.w, dev.h) / 620));
  return {
    name: 'мобильный',
    maxDpr: 2,
    tileBudget: 200,
    targetDraw: 110,
    texelTol: 64,
    workers: 2,
    rocks: 220,
    flora: 330,
    dust: 80,
    motes: 220,
    stars: 600,
    sky: 256,
    detail: false,
    touchUi: true,
    hudScale,
  };
}

/**
 * Ручное переключение профиля: `?touch=1` включает сенсорные органы и
 * мобильные бюджеты на любой машине, `?touch=0` выключает их на
 * телефоне.
 *
 * Нужно не для красоты: сенсорное управление иначе нечем ни отладить,
 * ни проверить — на настольной машине касаний нет, а на телефоне нет
 * ни консоли, ни тестов.
 */
function forcedProfile(dev, search) {
  const q = new URLSearchParams(search || '');
  const f = q.get('touch');
  const base = f === '1' ? qualityFor({ ...dev, mobile: true, touch: true, coarse: true })
    : (f === '0' ? qualityFor({ ...dev, mobile: false, touch: false, coarse: false })
      : qualityFor(dev));
  // Размер приборов — ручкой: `?hud=1.4`. Насколько они крупны на ЧУЖОМ
  // экране, из кода не видно никак, а подбирать его перезапуском сборки
  // значит не подбирать вовсе.
  const hud = parseFloat(q.get('hud'));
  if (Number.isFinite(hud)) base.hudScale = clamp(hud, 0.5, 3);
  return base;
}

export const DEVICE = detectDevice();
export const Q = forcedProfile(DEVICE,
  typeof location !== 'undefined' ? location.search : '');

/**
 * Полноэкранный режим. На iPhone его нет вовсе: Safari разрешает
 * requestFullscreen только видео, поэтому кнопку там показывать нельзя
 * — она бы просто не работала. Для «как полный экран» на телефоне есть
 * другой путь: «На экран Домой», и об этом сказано в index.html.
 */
export const fullscreenAvailable = (doc = typeof document !== 'undefined' ? document : null) => {
  if (!doc || !doc.documentElement) return false;
  return !!(doc.documentElement.requestFullscreen || doc.documentElement.webkitRequestFullscreen);
};

export const isFullscreen = (doc = typeof document !== 'undefined' ? document : null) =>
  !!(doc && (doc.fullscreenElement || doc.webkitFullscreenElement));

/** Переключить полный экран. Вызывать только из обработчика нажатия. */
export function toggleFullscreen(doc = typeof document !== 'undefined' ? document : null) {
  if (!fullscreenAvailable(doc)) return false;
  try {
    if (isFullscreen(doc)) {
      (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
    } else {
      const el = doc.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    }
    return true;
  } catch (e) {
    return false;
  }
}
