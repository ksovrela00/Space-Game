// Процедурная поверхность тел: высота и цвет как функция направления из
// центра. Функция трёхмерная, поэтому на сфере нет ни швов, ни вырождения
// на полюсах — в отличие от любой развёртки в карту.
//
// Считается в ЛОКАЛЬНОМ базисе тела (y — ось вращения), поэтому меш
// генерируется один раз, а суточное вращение делает уже матрица объекта.
//
// Рельеф складывается из двух слоёв:
//   * сумма октав градиентного шума — крупные поднятия и хребты;
//   * поле кратеров — то, что делает безатмосферное тело узнаваемым.
//     Без кратеров мелкий шум на пределе разрешения меша читается как
//     «каша»: частота выше, чем сетка способна показать.
//
// Уровень детализации — ЯВНЫЙ параметр (см. detailForCell): для грубой
// сетки считаются только те октавы и те масштабы кратеров, которые она
// в состоянии представить. Всё, что мельче, не просто бесполезно — оно
// даёт алиасинг, то есть ту же «кашу».

const TAU = Math.PI * 2;
const F = (t) => t * t * t * (t * (t * 6 - 15) + 10);   // сглаживание Перлина
const clamp01 = (t) => (t <= 0 ? 0 : (t >= 1 ? 1 : t));
const smooth01 = (t) => (t <= 0 ? 0 : (t >= 1 ? 1 : t * t * (3 - 2 * t)));

const GRADS = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

const hashInt = (seed, i, j, k) => {
  let h = (seed ^ Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

const gdot = (seed, i, j, k, dx, dy, dz) => {
  const g = GRADS[hashInt(seed, i, j, k) % 12];
  return g[0] * dx + g[1] * dy + g[2] * dz;
};

// Классический градиентный шум Перлина, значения примерно в [-1, 1].
export function perlin3(seed, x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = F(fx), v = F(fy), w = F(fz);

  const n000 = gdot(seed, ix, iy, iz, fx, fy, fz);
  const n100 = gdot(seed, ix + 1, iy, iz, fx - 1, fy, fz);
  const n010 = gdot(seed, ix, iy + 1, iz, fx, fy - 1, fz);
  const n110 = gdot(seed, ix + 1, iy + 1, iz, fx - 1, fy - 1, fz);
  const n001 = gdot(seed, ix, iy, iz + 1, fx, fy, fz - 1);
  const n101 = gdot(seed, ix + 1, iy, iz + 1, fx - 1, fy, fz - 1);
  const n011 = gdot(seed, ix, iy + 1, iz + 1, fx, fy - 1, fz - 1);
  const n111 = gdot(seed, ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1);

  const x00 = n000 + u * (n100 - n000);
  const x10 = n010 + u * (n110 - n010);
  const x01 = n001 + u * (n101 - n001);
  const x11 = n011 + u * (n111 - n011);
  const y0 = x00 + v * (x10 - x00);
  const y1 = x01 + v * (x11 - x01);
  return (y0 + w * (y1 - y0)) * 1.1;
}

export const LAC = 2.1;      // множитель частоты между октавами
export const GAIN = 0.5;     // множитель амплитуды; GAIN*LAC ≈ 1 — крутизна
                             // склонов почти одинакова на всех масштабах.
                             // При GAIN*LAC заметно больше единицы мелкий
                             // рельеф становится круче крупного, и склоны
                             // вырождаются в рябь.

/**
 * Сумма октав. Нормировка — по БЕСКОНЕЧНОЙ сумме амплитуд, а не по сумме
 * посчитанных: иначе добавление октавы при смене LOD меняло бы высоту
 * всего рельефа, и горы «дышали» бы на подлёте.
 */
export function fbm(seed, x, y, z, octaves = 6, freq = 1, gain = GAIN, lacunarity = LAC) {
  let sum = 0, amp = 1, f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * perlin3(seed + o * 1013, x * f, y * f, z * f);
    amp *= gain;
    f *= lacunarity;
  }
  return sum * (1 - gain);
}

// Хребты: излом в нуле даёт горные цепи вместо плавных холмов.
export function ridged(seed, x, y, z, octaves = 6, freq = 1) {
  let sum = 0, amp = 1, f = freq;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(perlin3(seed + o * 7919, x * f, y * f, z * f));
    sum += amp * (n * n - 0.5);
    amp *= GAIN;
    f *= LAC;
  }
  return sum * (1 - GAIN) * 1.6;
}

// --- Кратеры -----------------------------------------------------------------
// Центры кратеров — узлы трёхмерной решётки с шагом c, попавшие в тонкую
// оболочку вокруг единичной сферы. Решётка трёхмерная сознательно: любая
// двумерная сетка на сфере (кубическая развёртка, сетка по широте) даёт
// швы на стыках, а здесь распределение изотропно и бесшовно по построению.
//
// Плотность выходит ~1 кратер на c² стерадиан, то есть шаг решётки задаёт
// и размер кратеров, и их количество.

export const CRATER_C0 = 0.44;        // шаг самого крупного масштаба, рад
export const CRATER_STEP = 0.4;       // во сколько раз мельче следующий
// Масштабов шестнадцать, а не десять и не двенадцать. Каждый следующий
// обрыв лестницы читается как «залитый» грунт на своей высоте:
// десятый оставлял без кратеров всё мельче 14 метров, двенадцатый —
// мельче ~4. С орбиты этого не видно, а с двадцати метров под кораблём
// оказывалась гладкая наклонная плоскость, и высота переставала
// читаться вовсе: рельефа своего размера у корабля перед глазами не
// было. Шестнадцатый доводит лестницу до метровых воронок — до того
// масштаба, на котором стоит сам корабль.
//
// Дорого это только для самых подробных плиток и для игровой логики:
// detailForCell отсекает лишние масштабы для всего остального, а
// шейдеру (js/gl/detail.js) считать больше не приходится вовсе — он
// берёт фиксированное окно масштабов вокруг размера пикселя.
export const CRATER_MAX_SCALES = 16;
export const CRATER_SEED = 4441;      // сдвиг seed для кратерного слоя
// Глубина кратера: min(DMAX, DK·sqrt(DREF/rc))·rc — см. craterDepth.
// Показатель ровно 1/2 не случайно: в шейдере это один inversesqrt
// вместо pow, а считается он на каждый пиксель.
export const CRATER_DMAX = 0.35;
export const CRATER_DK = 0.13;
export const CRATER_DREF = 0.02;
export const CRATER_BOWL = 0.85;      // докуда идёт чаша, в радиусах кратера
export const CRATER_RIM_AT = 0.92;    // где стоит вал
export const CRATER_RIM_W = 0.33;     // полуширина вала (вал кончается на REACH)
export const CRATER_RIM = 0.30;       // высота вала в долях глубины
// Радиус кратера в долях шага решётки: rc = (RMIN + RSPAN·u^1.5)·c, где
// u — равномерное [0,1). Показатель больше единицы намеренный: он даёт
// много мелких кратеров и редкие крупные, как в жизни. Узкий диапазон
// (было 0.18–0.30) давал на каждом масштабе кратеры почти одного
// размера, и поверхность выглядела пузырчатой плёнкой.
export const CRATER_RMIN = 0.05;
export const CRATER_RSPAN = 0.35;
// Сохранность кратера: свежие глубокие и старые почти заплывшие в одной
// пропорции. Без этого все кратеры выглядят отштампованными.
export const CRATER_FRESH_MIN = 0.30;
export const CRATER_REACH = 1.25;     // докуда тянется выброс, в радиусах

/**
 * Глубина кратера в долях радиуса тела. Зависимость от размера
 * сознательно нелинейная: у мелких кратеров глубина доходит до 0.4
 * диаметра, у крупных бассейнов — считанные проценты. Линейная связь
 * давала бассейны глубиной в 3% радиуса, то есть вдвое глубже любого
 * реального (у Луны самый глубокий бассейн — 0.75% радиуса).
 */
export const craterDepth = (rc) =>
  Math.min(CRATER_DMAX, CRATER_DK * Math.sqrt(CRATER_DREF / rc)) * rc;

/**
 * Профиль кратера по t = (угловое расстояние / радиус кратера):
 * плоское дно (-1), вал около t = 0.95, ноль за t = 1.7.
 * Функция сглажена на обоих концах — иначе на границе кратера
 * получился бы излом, видимый как ступенька в освещении.
 */
export function craterProfile(t) {
  if (t >= CRATER_REACH) return 0;
  const bowl = smooth01(t / CRATER_BOWL) - 1;
  // Вал — компактный полиномиальный горб вместо гауссианы: он вдвое
  // дешевле в шейдере (там нет ни одного exp) и обрывается ровно на
  // нуле, а не «почти».
  const u = (t - CRATER_RIM_AT) / CRATER_RIM_W;
  const bump = u > -1 && u < 1 ? 1 - u * u : 0;
  return bowl + CRATER_RIM * bump * bump;
}

/**
 * Производная профиля по t. Нужна шейдеру: он наклоняет нормаль по
 * градиенту мелкого рельефа, а считать градиент конечными разностями по
 * всему кратерному полю — это втрое больше работы на каждый пиксель.
 */
export function craterProfileD(t) {
  if (t >= CRATER_REACH) return 0;
  const s = t / CRATER_BOWL;
  const bowl = s > 0 && s < 1 ? 6 * s * (1 - s) / CRATER_BOWL : 0;
  const u = (t - CRATER_RIM_AT) / CRATER_RIM_W;
  const rim = u > -1 && u < 1
    ? -4 * CRATER_RIM * u * (1 - u * u) / CRATER_RIM_W
    : 0;
  return bowl + rim;
}

// Один масштаб кратеров. Проверяются 27 соседних ячеек решётки: дальше
// кратер дотянуться не может, потому что его радиус не превышает 0.3 шага.
// Предел влияния кратера от центра его ячейки: собственный радиус
// (не больше RMIN+RSPAN шага) на REACH плюс полудиагональ ячейки и
// сдвиг при нормировке на сферу. Дальше профиль равен РОВНО нулю
// (у вала компактный носитель), поэтому отсев точный, а не примерный.
const CRATER_CULL = CRATER_REACH * (CRATER_RMIN + CRATER_RSPAN) + 1.37;

export function craterLayer(seed, scale, x, y, z) {
  const inv = 1 / scale;
  const i0 = Math.floor(x * inv), j0 = Math.floor(y * inv), k0 = Math.floor(z * inv);
  const lo = (1 - scale) * (1 - scale), hi = (1 + scale) * (1 + scale);
  const cull2 = (CRATER_CULL * scale) * (CRATER_CULL * scale);
  let h = 0;
  for (let di = -1; di <= 1; di++) {
    const i = i0 + di;
    for (let dj = -1; dj <= 1; dj++) {
      const j = j0 + dj;
      for (let dk = -1; dk <= 1; dk++) {
        const k = k0 + dk;
        // Два дешёвых отсева: ячейка далеко от сферы или далеко от точки.
        const ax = (i + 0.5) * scale, ay = (j + 0.5) * scale, az = (k + 0.5) * scale;
        const al2 = ax * ax + ay * ay + az * az;
        if (al2 < lo || al2 > hi) continue;
        const ex = ax - x, ey = ay - y, ez = az - z;
        if (ex * ex + ey * ey + ez * ez > cull2) continue;

        const hh = hashInt(seed, i, j, k);
        const qx = (i + (hh & 1023) / 1024) * scale;
        const qy = (j + ((hh >>> 10) & 1023) / 1024) * scale;
        const qz = (k + ((hh >>> 20) & 1023) / 1024) * scale;
        const ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
        if (Math.abs(ql - 1) > 0.5 * scale) continue;   // центр не на сфере

        // Угловое расстояние через хорду: acos здесь был бы вдвое дороже,
        // а на углах меньше 0.15 рад разница неразличима.
        const nx = qx / ql - x, ny = qy / ql - y, nz = qz / ql - z;
        const chord = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const ang = chord * (1 + chord * chord / 24);

        const h2 = hashInt(seed ^ 0x9e37, i, j, k);
        const u = (h2 & 255) / 256;
        const rc = (CRATER_RMIN + CRATER_RSPAN * u * Math.sqrt(u)) * scale;
        const t = ang / rc;
        if (t >= CRATER_REACH) continue;
        // Сохранность: старые кратеры и мельче, и без вала.
        const fu = ((h2 >>> 8) & 255) / 256;
        const fresh = CRATER_FRESH_MIN + (1 - CRATER_FRESH_MIN) * fu * fu;
        h += craterDepth(rc) * fresh * craterProfile(t);
      }
    }
  }
  return h;
}

// Насколько «моря» подавляют кратеры данного масштаба.
//
// Крупные кратеры в залитых лавой низинах стёрты — они древнее заливки.
// Мелкие же выбиты уже ПОСЛЕ неё, и их там примерно столько же, сколько
// на материках: настоящее море вблизи — не гладкая плита, а тот же
// изрытый реголит. Поэтому маска работает целиком только на крупных
// масштабах и сходит на нет к мелким. Без этого посадочный компьютер,
// который ищет ровную площадку, всегда сажал корабль ровно туда, где
// поверхность выглядит залитой бетоном.
export const CRATER_MARE_FROM = 6;    // докуда маска действует целиком
export const CRATER_MARE_TO = 9;     // где она перестаёт действовать вовсе

export const mareWeight = (s, dens) => {
  const k = smooth01((s - CRATER_MARE_FROM) / (CRATER_MARE_TO - CRATER_MARE_FROM));
  return dens + (1 - dens) * k;
};

export function craterField(seed, x, y, z, scales, dens = 1) {
  let h = 0, c = CRATER_C0;
  for (let s = 0; s < scales; s++) {
    const w = mareWeight(s, dens);
    if (w > 0.002) h += w * craterLayer(seed + s * 7717, c, x, y, z);
    c *= CRATER_STEP;
  }
  return h;
}

// Предельный вклад масштабов кратеров, начиная с s-го (в долях радиуса).
// Оценка сверху: как будто в одной точке сложились самые глубокие кратеры
// всех масштабов сразу.
const craterBound = (fromScale, sign) => {
  let sum = 0, c = CRATER_C0 * CRATER_STEP ** fromScale;
  for (let s = fromScale; s < CRATER_MAX_SCALES; s++) {
    sum += craterDepth((CRATER_RMIN + CRATER_RSPAN) * c);
    c *= CRATER_STEP;
  }
  return sum * (sign > 0 ? CRATER_RIM : 1);
};

const strHash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

// amp — доля радиуса. Реальные тела куда глаже (у Земли Эверест это 0.14%
// радиуса), но тогда рельеф не видно ни на кромке, ни в тенях, поэтому он
// намеренно преувеличен.
//
// sea — уровень моря в шкале шума [-1, 1]. Высота нормируется так, что на
// уровне моря она равна нулю, а на максимуме шума — ровно amp: без
// нормировки у «сухих» тел (sea сильно ниже нуля) уровень моря сам
// прибавлялся к высоте, и рельеф получался в разы выше задуманного.
//
// craters — вес кратерного слоя; caps — полярные шапки (у безатмосферных
// тел их нет).
const KIND = {
  ocean: { amp: 0.010, sea: 0.02, water: true, ridge: false, freq: 1.9, craters: 0, caps: true },
  desert: { amp: 0.013, sea: -0.6, water: false, ridge: false, freq: 2.3, craters: 0.25, caps: true },
  rock: { amp: 0.015, sea: -0.5, water: false, ridge: true, freq: 2.1, craters: 0.7, caps: false },
  moon: { amp: 0.011, sea: -0.45, water: false, ridge: false, freq: 1.7, craters: 1, caps: false },
  ice: { amp: 0.010, sea: 0.06, water: true, ridge: false, freq: 1.8, craters: 0.3, caps: true },
  lava: { amp: 0.017, sea: -0.4, water: false, ridge: true, freq: 2.5, craters: 0.35, caps: false },
  gas: { amp: 0, sea: -1, water: false, ridge: false, freq: 1, craters: 0, caps: false },
  star: { amp: 0, sea: -1, water: false, ridge: false, freq: 1, craters: 0, caps: false },
};

// Цветовые рампы по нормированной высоте: 0 — уровень моря, 1 — пик.
const RAMP = {
  ocean: [
    [0.00, [18, 42, 92]], [0.12, [30, 70, 140]], [0.20, [52, 104, 170]],
    [0.22, [196, 184, 140]], [0.30, [78, 120, 70]], [0.55, [96, 110, 62]],
    [0.75, [120, 112, 96]], [0.86, [150, 148, 146]], [0.93, [236, 242, 248]],
    [1.00, [252, 254, 255]],
  ],
  desert: [
    [0.00, [142, 96, 58]], [0.35, [186, 142, 88]], [0.62, [208, 172, 120]],
    [0.85, [150, 116, 84]], [1.00, [206, 198, 188]],
  ],
  rock: [
    [0.00, [74, 68, 62]], [0.30, [108, 100, 92]], [0.60, [136, 126, 116]],
    [0.85, [158, 150, 142]], [1.00, [198, 196, 194]],
  ],
  // У луны низины — тёмные базальтовые «моря», возвышенности светлые.
  moon: [
    [0.00, [52, 52, 56]], [0.22, [74, 74, 78]], [0.40, [116, 116, 120]],
    [0.70, [148, 148, 152]], [1.00, [192, 192, 196]],
  ],
  ice: [
    [0.00, [128, 168, 202]], [0.20, [176, 208, 232]], [0.55, [214, 234, 246]],
    [1.00, [248, 252, 255]],
  ],
  lava: [
    [0.00, [232, 96, 32]], [0.10, [128, 54, 30]], [0.35, [72, 48, 44]],
    [0.70, [58, 42, 40]], [1.00, [96, 88, 86]],
  ],
  gas: [
    [0.00, [126, 98, 74]], [0.25, [176, 148, 112]], [0.50, [212, 190, 150]],
    [0.75, [150, 120, 92]], [1.00, [226, 208, 176]],
  ],
};

const rampAt = (ramp, t, out) => {
  let a = ramp[0], b = ramp[ramp.length - 1];
  for (let i = 1; i < ramp.length; i++) {
    if (ramp[i][0] >= t) { a = ramp[i - 1]; b = ramp[i]; break; }
  }
  const span = (b[0] - a[0]) || 1;
  const k = clamp01((t - a[0]) / span);
  out[0] = (a[1][0] + (b[1][0] - a[1][0]) * k) / 255;
  out[1] = (a[1][1] + (b[1][1] - a[1][1]) * k) / 255;
  out[2] = (a[1][2] + (b[1][2] - a[1][2]) * k) / 255;
  return out;
};

/**
 * Поверхность конкретного тела.
 *
 * detail — объект из detailForCell(): сколько октав шума и сколько
 * масштабов кратеров считать. По умолчанию берётся полная детализация:
 * её использует игровая логика (высота поверхности под кораблём), а
 * сетки рендера просят ровно столько, сколько способны показать.
 */
export const terrainOf = (body) => body._terrain || (body._terrain = makeTerrain(body));

export function makeTerrain(body) {
  const cfg = KIND[body.kind] || KIND.rock;
  const seed = (strHash(body.name + '#' + body.id) ^ 0x5a7e) | 0;
  const ramp = RAMP[body.kind] || RAMP.rock;
  const isGas = body.kind === 'gas';
  const craterW = cfg.craters;

  // Сколько октав и масштабов кратеров имеет смысл считать для сетки с
  // угловым размером ячейки cellRad. Порог 2.5 ячейки на период — ниже
  // него деталь не представима и превращается в шум.
  const detailForCell = (cellRad) => {
    const lim = Math.max(1e-9, 2.5 * cellRad);
    let oct = 1 + Math.floor(Math.log(1 / (cfg.freq * lim)) / Math.log(LAC));
    if (!isFinite(oct) || oct < 1) oct = 1;
    if (oct > 26) oct = 26;
    let cs = 0;
    if (craterW > 0) {
      while (cs < CRATER_MAX_SCALES && CRATER_C0 * CRATER_STEP ** cs >= lim) cs++;
    }
    return { oct, cs, cellRad };
  };
  const FULL = detailForCell(1e-7);

  // Сырая высота в [-1, 1] до вычета уровня моря.
  const raw = (x, y, z, oct) => (cfg.ridge
    ? ridged(seed, x, y, z, oct, cfg.freq)
    : fbm(seed, x, y, z, oct, cfg.freq));

  /**
   * Плотность кратеров: 0 в «морях», 1 на «материках».
   *
   * Без этой маски кратеры равномерно покрывают весь шар, и поверхность
   * выглядит пузырчатой плёнкой. У настоящих безатмосферных тел
   * кратерами насыщены древние высокогорья, а залитые лавой низины
   * почти гладкие — именно этот контраст и читается как «луна».
   *
   * Частота низкая (пятна в тысячи километров), поэтому сетка передаёт
   * маску вершинами без потерь, а шейдер считает её один раз на пиксель.
   */
  const mare = (x, y, z) =>
    smooth01((fbm(seed + 991, x * 1.3, y * 1.3, z * 1.3, 3, 1) + 0.25) / 0.5);

  // Газовый гигант: полосы по широте плюс лёгкая турбулентность.
  const gasBand = (x, y, z) => {
    const swirl = fbm(seed + 31, x * 0.6, y * 3.0, z * 0.6, 4, 1.2) * 0.12;
    const lat = y + swirl;
    return Math.sin(lat * 7.5) * 0.5 + fbm(seed + 77, x, y * 2.2, z, 3, 1.6) * 0.25;
  };

  // Высота над уровнем моря нормируется на этот размах: ноль на уровне
  // моря, единица на максимуме шума.
  const span = 1 - cfg.sea;

  const flat = isGas || cfg.amp === 0;

  // Нормированная высота для цветовой рампы по уже посчитанному шуму.
  const normOf = (r) => {
    if (!cfg.water) return clamp01((r - cfg.sea) / span);
    // У водных миров нижние 20% рампы отданы глубинам.
    const d = r - cfg.sea;
    if (d <= 0) return Math.max(0, Math.min(0.2, 0.2 + d * 0.6));
    return Math.max(0.21, Math.min(1, 0.21 + (d / span) * 0.9));
  };

  /**
   * Высота и цвет в одном проходе: шум и кратеры считаются по разу.
   * Отдельные displace() и color() дороже вдвое, а вершин в подробной
   * сетке — десятки тысяч.
   * @returns смещение поверхности в долях радиуса; цвет пишется в rgb.
   */
  const sample = (x, y, z, detail, rgb) => {
    const d = detail || FULL;
    if (isGas) {
      if (rgb) rampAt(ramp, clamp01(gasBand(x, y, z) * 0.5 + 0.5), rgb);
      return 0;
    }
    const r = flat ? 0 : raw(x, y, z, d.oct);
    const dens = !flat && craterW > 0 ? mare(x, y, z) : 0;
    const cr = craterW > 0 && d.cs > 0
      ? craterW * craterField(seed + CRATER_SEED, x, y, z, d.cs, dens)
      : 0;
    // Ниже уровня моря — ровная водная сфера, а не дно.
    const h = flat ? 0 : clamp01((r - cfg.sea) / span) * cfg.amp + cr;

    if (rgb) {
      let t = normOf(r);
      // Полярные шапки: по широте (y — ось вращения) с рваной кромкой.
      // Над океаном это морской лёд, поэтому высота здесь не важна.
      if (cfg.caps) {
        const lat = Math.abs(y);
        const edge = 0.72 + fbm(seed + 501, x * 3, y * 3, z * 3, 3, 2.0) * 0.10;
        if (lat > edge) t = Math.max(t, 0.96);
      }
      rampAt(ramp, t, rgb);
      // Пятнистость, чтобы поверхность не выглядела «пластиковой», плюс
      // подсветка валов и затемнение дна кратеров: без этого кратеры
      // читаются только в скользящем свете.
      let k = 1 + fbm(seed + 909, x * 6, y * 6, z * 6, 3, 2.4) * 0.10;
      if (cr !== 0) k *= 1 + Math.max(-0.30, Math.min(0.30, cr / (cfg.amp * 0.5)));
      // «Моря» темнее высокогорий — это заливший их базальт. Шейдер
      // этого уже не повторяет: маска низкочастотная, и цвет вершин
      // передаёт её без потерь.
      if (craterW > 0) k *= 0.72 + 0.28 * dens;
      rgb[0] = clamp01(rgb[0] * k);
      rgb[1] = clamp01(rgb[1] * k);
      rgb[2] = clamp01(rgb[2] * k);
    }
    return h;
  };

  const displace = flat ? () => 0 : (x, y, z, detail) => sample(x, y, z, detail, null);
  const color = (x, y, z, out, detail) => { sample(x, y, z, detail, out); return out; };

  // Вклад кратеров отдельно — нужен проверкам.
  const craterAt = flat || craterW === 0
    ? () => 0
    : (x, y, z, detail) => craterW *
      craterField(seed + CRATER_SEED, x, y, z, (detail || FULL).cs, mare(x, y, z));

  const heightNorm = (x, y, z, oct) => normOf(flat ? 0 : raw(x, y, z, oct || FULL.oct));

  // Насколько высота при детализации `coarse` может отличаться от полной.
  // Нужно рендеру: по этой границе решается, перекрывают ли подробные
  // заплатки грубую сферу (см. js/gl/patches.js).
  const detailGap = (coarse) => {
    if (flat) return 0;
    const c = coarse || FULL;
    // Сумма амплитуд неучтённых октав: Σ(o >= n) g^o·(1-g)·1.1 = 1.1·g^n.
    const noise = cfg.amp * 1.1 * (cfg.ridge ? 1.6 : 1) * GAIN ** c.oct / span;
    const cr = craterW > 0 && c.cs < CRATER_MAX_SCALES
      ? craterBound(c.cs, -1) * craterW
      : 0;
    return noise + cr;
  };

  /**
   * Реалистичная оценка ошибки сетки с такой детализацией — по ней
   * выбирается уровень плиток (js/gl/tiles.js).
   *
   * От detailGap отличается намеренно: тот даёт ГРАНИЦУ сверху («как
   * будто все неучтённые масштабы сложились в одной точке») и нужен
   * юбкам. Для выбора уровня такая оценка завышена в разы, и дерево
   * дробится куда глубже, чем нужно глазу: здесь считается самая
   * крупная неучтённая деталь, а не сумма всех.
   */
  const meshError = (coarse) => {
    if (flat) return 0;
    const c = coarse || FULL;
    const noise = cfg.amp * 1.1 * (cfg.ridge ? 1.6 : 1) * GAIN ** c.oct / span;
    let cr = 0;
    if (craterW > 0 && c.cs < CRATER_MAX_SCALES) {
      const cScale = CRATER_C0 * CRATER_STEP ** c.cs;
      cr = craterDepth((CRATER_RMIN + CRATER_RSPAN) * cScale) * craterW;
    }
    return noise + cr;
  };

  const ampUp = flat ? 0 : cfg.amp + craterW * craterBound(0, +1);
  const ampDown = flat ? 0 : craterW * craterBound(0, -1);

  /**
   * Числа, по которым фрагментный шейдер считает тот же рельеф, что и
   * CPU (js/gl/detail.js). Шейдер добавляет к сетке ровно те октавы и
   * масштабы кратеров, которые в неё не вошли, поэтому сумма
   * «геометрия + шейдер» не зависит от уровня LOD.
   */
  const shaderParams = () => ({
    seed,
    amp: cfg.amp,
    span,
    freq: cfg.freq,
    ridge: cfg.ridge ? 1 : 0,
    craterW,
    flat,
  });

  return {
    amp: cfg.amp,
    ampUp,                 // максимум смещения наружу (в долях радиуса)
    ampDown,               // максимум смещения внутрь
    detailForCell,
    shaderParams,
    meshError,
    craterDensity: flat || craterW === 0 ? () => 0 : mare,
    FULL,
    sample,
    displace,
    color,
    craterAt,
    heightNorm,
    detailGap,
    isFlat: flat,
    seed,
    kindCfg: cfg,
  };
}
