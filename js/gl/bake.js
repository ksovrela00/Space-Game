// Запекание процедурной поверхности в текстуры.
//
// Раньше рельеф мельче ячейки сетки считался в фрагментном шейдере — на
// каждый пиксель каждого кадра, то есть два миллиона раз по шестьдесят
// раз в секунду. Теперь та же математика считается ОДИН раз на тексель
// при подготовке куска поверхности, а рисование сводится к выборке из
// текстуры. Работы становится в сотни раз меньше, и картинка перестаёт
// зависеть от того, откуда на неё смотрят: деталь запечена, а не
// подбирается под след пикселя.
//
// Запекается два числа на тексель:
//   * нормаль поверхности в ЛОКАЛЬНЫХ осях тела (RGB, со сдвигом в
//     [0,1]) — по ней считается освещение;
//   * тон (A) — насколько тут светлее или темнее среднего: валы
//     кратеров светлые, дно тёмное.
//
// Мип-уровни обязательны: без них на скользящем угле, где тексель
// меньше пикселя, нормали дают рябь. Мипы усредняют их правильно —
// это честное сглаживание вместо прежнего «затухания деталей».

/** Пустая RGBA8-текстура под запекание, с мипами и зажатыми краями. */
export function createBakeTexture(gl, size) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { tex, size, target: gl.TEXTURE_2D };
}

/** Заглушка 1x1: чтобы сэмплер всегда смотрел в готовую текстуру. */
export function createBlankTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([128, 128, 255, 128]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { tex, size: 1, target: gl.TEXTURE_2D };
}

/**
 * Оси граней кубической карты в том же порядке, в каком их выбирает
 * оборудование при выборке по направлению (OpenGL ES 3.0, таблица 3.21).
 *
 * dir = normalize(F + U·s + V·t), где s, t идут по текселям от -1 до 1.
 * Таблицу проверяет тест: для случайных направлений он определяет грань
 * и координаты так же, как драйвер, и сверяет восстановленное
 * направление. Перепутанный знак здесь дал бы «сшитую наизнанку»
 * планету, и заметить это можно было бы только глазами.
 */
export const CUBE_FACES = [
  { name: '+X', F: [1, 0, 0], U: [0, 0, -1], V: [0, -1, 0] },
  { name: '-X', F: [-1, 0, 0], U: [0, 0, 1], V: [0, -1, 0] },
  { name: '+Y', F: [0, 1, 0], U: [1, 0, 0], V: [0, 0, 1] },
  { name: '-Y', F: [0, -1, 0], U: [1, 0, 0], V: [0, 0, -1] },
  { name: '+Z', F: [0, 0, 1], U: [1, 0, 0], V: [0, -1, 0] },
  { name: '-Z', F: [0, 0, -1], U: [-1, 0, 0], V: [0, -1, 0] },
];

/**
 * Как оборудование выбирает грань и координаты по направлению.
 * Нужно только проверкам — в шейдере это делает сама выборка.
 * @returns {face, s, t} — s и t в [-1, 1]
 */
export function cubeLookup(x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) {
    return x > 0
      ? { face: 0, s: -z / ax, t: -y / ax }
      : { face: 1, s: z / ax, t: -y / ax };
  }
  if (ay >= az) {
    return y > 0
      ? { face: 2, s: x / ay, t: z / ay }
      : { face: 3, s: x / ay, t: -z / ay };
  }
  return z > 0
    ? { face: 4, s: x / az, t: -y / az }
    : { face: 5, s: -x / az, t: -y / az };
}

/**
 * Проход запекания: рисует квадрат во всю текстуру выбранной программой.
 * Состояние возвращается к рисованию в экран самим вызывающим (см.
 * GlScene.render — там кадр начинается с полной установки состояния).
 */
export class Baker {
  constructor(gl) {
    this.gl = gl;
    this.fbo = gl.createFramebuffer();
    this.ok = true;
  }

  /**
   * @param tex  объект из createBakeTexture
   * @param draw что нарисовать (уже с выставленными uniform-ами)
   */
  pass(tex, draw) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      this.ok = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return false;
    }
    gl.viewport(0, 0, tex.size, tex.size);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    draw();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  finish(tex) {
    const gl = this.gl;
    gl.bindTexture(tex.target, tex.tex);
    gl.generateMipmap(tex.target);
    gl.bindTexture(tex.target, null);
  }

  dispose(tex) {
    if (tex && tex.tex) this.gl.deleteTexture(tex.tex);
  }
}
