// Создание и обслуживание контекста WebGL2.

export function createContext(canvas) {
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: true,
      stencil: false,
      antialias: true,
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
 * @returns true, если размер поменялся
 */
export function resizeCanvas(gl, canvas, maxDpr = 2) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
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
