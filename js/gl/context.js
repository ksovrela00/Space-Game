// Создание и обслуживание контекста WebGL2.
import { Q } from '../core/quality.js';

const search = () => (typeof location !== 'undefined' ? location.search : '');

/**
 * Масштаб буфера кадра: `?scale=0.7` рисует сцену в 0.7 от разрешения
 * окна и растягивает её обратно средствами браузера.
 *
 * Зачем такая ручка. Дорогая работа в кадре — процедурная поверхность,
 * и стоит она по числу закрашенных пикселей: в окне 2549 × 1308 их
 * 3.3 миллиона, при 0.7 остаётся 1.6 — ровно вдвое меньше работы.
 * Приборы этим НЕ портятся: они рисуются на своём холсте в полном
 * разрешении (см. index.html), поэтому надписи остаются резкими, а
 * мягче становится только сама сцена.
 *
 * Нижняя граница — не вкус: ниже 0.35 пропадают камни и стойки шасси,
 * то есть предметы, по которым глаз меряет высоту.
 */
export function renderScale(str = search()) {
  const v = parseFloat(new URLSearchParams(str || '').get('scale'));
  if (!Number.isFinite(v)) return 1;
  return Math.max(0.35, Math.min(1, v));
}

/**
 * Сглаживание краёв: `?aa=0` выключает. На процедурной поверхности оно
 * почти ничего не даёт — нормаль там и так считается на пиксель, — а
 * буфер на слабой карте занимает вчетверо больше памяти и полосы.
 * Заметно сглаживание на кромке планеты, корпусе и стойках шасси,
 * поэтому по умолчанию оно включено.
 */
export function wantAa(str = search()) {
  return new URLSearchParams(str || '').get('aa') !== '0';
}

export function createContext(canvas, aa = wantAa()) {
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: true,
      // Трафарет нужен заплаткам поверхности: там, где нарисована
      // подробная земля, грубая сфера рисоваться не должна (её грани
      // отклоняются от подробной поверхности на километры).
      stencil: true,
      antialias: aa,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
  } catch (e) {
    gl = null;
  }
  return gl;
}

/**
 * Что это за видеокарта на самом деле.
 *
 * Контекст создаётся с powerPreference: 'high-performance', но это
 * ПРОСЬБА, а не приказ: выбирает всё равно система. На машине с двумя
 * картами браузер спокойно уходит на встроенную, и игра идёт вдвое
 * медленнее без единой ошибки в консоли — «просто тормозит». Разобрать
 * это по одному названию карты нельзя никак иначе, поэтому названия
 * разбираются здесь, а игра говорит о находке вслух.
 *
 * @returns 'discrete' | 'integrated' | 'software' | 'unknown'
 */
export function gpuKind(name) {
  const s = String(name || '').toLowerCase();
  if (!s || s === 'неизвестно') return 'unknown';
  // Программный рендер: карты нет вовсе, кадры считает процессор.
  if (/swiftshader|llvmpipe|softpipe|basic render|microsoft basic|software/.test(s)) {
    return 'software';
  }
  // Apple — встроенная, но быстрая: предупреждать не о чем.
  if (/apple (m|gpu)/.test(s)) return 'discrete';
  if (/geforce|rtx|gtx|quadro|radeon (rx|pro)|arc a\d|nvidia/.test(s)) return 'discrete';
  if (/intel|uhd|hd graphics|iris|vega|radeon\(tm\) graphics|radeon graphics/.test(s)) {
    return 'integrated';
  }
  return 'unknown';
}

// Название видеокарты — полезно, когда fps окажется неожиданным.
export function rendererName(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    return String(gl.getParameter(gl.RENDERER));
  } catch (e) {
    return 'неизвестно';
  }
}

/**
 * Подгонка размера буфера под окно.
 * @param scale масштаб буфера (см. renderScale)
 * @returns true, если размер поменялся
 */
export function resizeCanvas(gl, canvas, maxDpr = Q.maxDpr, scale = 1) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * scale;
  const w = Math.max(1, Math.round(window.innerWidth * dpr));
  const h = Math.max(1, Math.round(window.innerHeight * dpr));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  gl.viewport(0, 0, w, h);
  return true;
}

// Контекст может быть потерян (сон, смена GPU) — без обработчика окно
// просто останется чёрным.
export function watchContextLoss(canvas, onLost, onRestored) {
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (onLost) onLost();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (onRestored) onRestored();
  });
}
