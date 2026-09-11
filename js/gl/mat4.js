// Матрицы для WebGL. Порядок хранения — по столбцам, как ждёт GL.
//
// Соглашение о координатах камеры то же, что и в Canvas-рендере:
// x — вправо, y — вверх, z — ВПЕРЁД (вглубь экрана). Это левая тройка,
// поэтому матрица проекции ниже отличается знаком третьей строки от
// «учебной» GL-овской, которая смотрит вдоль −z.

/**
 * Перспективная проекция для камеры, смотрящей вдоль +z.
 * Даёт ту же картинку, что и project() в js/render/camera.js:
 * ndc.x = X / (Z·tan(fov/2)·aspect), ndc.y = Y / (Z·tan(fov/2)).
 */
export function perspective(fovY, aspect, near, far, out = new Float32Array(16)) {
  const t = Math.tan(fovY / 2);
  out.fill(0);
  out[0] = 1 / (t * aspect);
  out[5] = 1 / t;
  out[10] = (far + near) / (far - near);
  out[11] = 1;
  out[14] = -2 * far * near / (far - near);
  return out;
}

/**
 * Матрица «локальные координаты модели -> координаты камеры».
 *
 * Считается на CPU в double и только потом приводится к float32 — это и
 * есть приём «координаты относительно камеры». Позиции в мире доходят до
 * 4 млн км, а float32 даёт там шаг полкилометра: если складывать мировые
 * координаты уже в шейдере, километровая станция схлопнется и задрожит.
 * Здесь же во float32 попадает только СМЕЩЕНИЕ от камеры, которое для
 * близких объектов мало и точно.
 *
 * @param camBasis ориентация камеры (right/up/fwd)
 * @param camPos   позиция камеры в мире
 * @param objBasis ориентация объекта
 * @param objPos   позиция объекта в мире
 * @param scale    масштаб модели
 * @param out16    mat4 (локальное -> камера)
 * @param out9     mat3 для нормалей (без переноса и масштаба)
 */
export function modelView(camBasis, camPos, objBasis, objPos, scale, out16, out9) {
  const cr = camBasis.right, cu = camBasis.up, cf = camBasis.fwd;
  const ox = objBasis.right, oy = objBasis.up, oz = objBasis.fwd;

  // Столбцы = оси модели, повёрнутые в базис камеры.
  const c0x = ox.x * cr.x + ox.y * cr.y + ox.z * cr.z;
  const c0y = ox.x * cu.x + ox.y * cu.y + ox.z * cu.z;
  const c0z = ox.x * cf.x + ox.y * cf.y + ox.z * cf.z;

  const c1x = oy.x * cr.x + oy.y * cr.y + oy.z * cr.z;
  const c1y = oy.x * cu.x + oy.y * cu.y + oy.z * cu.z;
  const c1z = oy.x * cf.x + oy.y * cf.y + oy.z * cf.z;

  const c2x = oz.x * cr.x + oz.y * cr.y + oz.z * cr.z;
  const c2y = oz.x * cu.x + oz.y * cu.y + oz.z * cu.z;
  const c2z = oz.x * cf.x + oz.y * cf.y + oz.z * cf.z;

  // Перенос: смещение объекта от камеры, повёрнутое в базис камеры.
  const dx = objPos.x - camPos.x;
  const dy = objPos.y - camPos.y;
  const dz = objPos.z - camPos.z;

  out16[0] = c0x * scale; out16[1] = c0y * scale; out16[2] = c0z * scale; out16[3] = 0;
  out16[4] = c1x * scale; out16[5] = c1y * scale; out16[6] = c1z * scale; out16[7] = 0;
  out16[8] = c2x * scale; out16[9] = c2y * scale; out16[10] = c2z * scale; out16[11] = 0;
  out16[12] = dx * cr.x + dy * cr.y + dz * cr.z;
  out16[13] = dx * cu.x + dy * cu.y + dz * cu.z;
  out16[14] = dx * cf.x + dy * cf.y + dz * cf.z;
  out16[15] = 1;

  if (out9) {
    out9[0] = c0x; out9[1] = c0y; out9[2] = c0z;
    out9[3] = c1x; out9[4] = c1y; out9[5] = c1z;
    out9[6] = c2x; out9[7] = c2y; out9[8] = c2z;
  }
  return out16;
}

// Поворот мирового направления в координаты камеры (для направления на солнце).
export function dirToCamera(camBasis, x, y, z, out = new Float32Array(3)) {
  const l = Math.hypot(x, y, z) || 1;
  const nx = x / l, ny = y / l, nz = z / l;
  const cr = camBasis.right, cu = camBasis.up, cf = camBasis.fwd;
  out[0] = nx * cr.x + ny * cr.y + nz * cr.z;
  out[1] = nx * cu.x + ny * cu.y + nz * cu.z;
  out[2] = nx * cf.x + ny * cf.y + nz * cf.z;
  return out;
}

/**
 * Коэффициент логарифмического буфера глубины.
 *
 * Диапазон сцены — от 4 метров до сотен миллионов километров. Обычная
 * перспективная матрица размазывает всю точность у ближней плоскости, и
 * дальше начинается z-fighting. Во фрагментном шейдере глубина пишется
 * как log2(1 + w) · Fcoef · 0.5, что распределяет точность логарифмически.
 */
export const logDepthCoef = (far) => 2 / Math.log2(far + 1);

// Та же формула на CPU — для тестов монотонности и диапазона.
export const logDepth = (w, far) => Math.log2(1 + w) * logDepthCoef(far) * 0.5;
