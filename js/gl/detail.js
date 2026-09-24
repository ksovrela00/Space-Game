// Мелкий рельеф — в фрагментном шейдере.
//
// Зачем. Сетка может показать только то, что крупнее её ячейки: у
// икосферы уровня 6 это 20–30 км, у заплаток под кораблём — метры.
// Между «с орбиты» и «у поверхности» сорок крат разницы в масштабе, и
// геометрией этот разрыв не закрыть: на 1000 км кратеры в 5 км — это
// миллионы треугольников, а подгружать их на подлёте — значит рисовать
// рельеф на глазах у пилота (и именно это и происходило).
//
// Поэтому геометрия отвечает только за КРУПНУЮ форму, а всё, что мельче
// её ячейки, шейдер считает на каждый пиксель и наклоняет по нему
// нормаль. Стоимость не зависит от расстояния, детализация — тоже:
// сколько масштабов имеет смысл посчитать, определяется размером следа
// пикселя на поверхности (производные dFdx/dFdy дают его прямо в
// радианах).
//
// Главное свойство схемы: шейдер добавляет ровно те октавы и масштабы
// кратеров, которые НЕ вошли в сетку (их число приходит в uniform-ах
// uOctFrom/uCsFrom). Сумма «геометрия + шейдер» одна и та же на любом
// уровне LOD, поэтому переключение уровней и появление заплаток не
// меняют картинку — и «мыла» при этом нет ни на одной дистанции.
//
// Функции здесь — построчный перенос js/gl/terrain.js: те же хеши, тот
// же профиль кратера, те же константы (они подставляются в текст
// шейдера из JS, чтобы не разъехались). Совпадение важно: по этому же
// рельефу считаются посадка и столкновения.

import {
  GAIN, LAC, CRATER_C0, CRATER_STEP, CRATER_MAX_SCALES, CRATER_SEED,
  CRATER_RIM, CRATER_RMIN, CRATER_RSPAN, CRATER_REACH, CRATER_FRESH_MIN,
  CRATER_DMAX, CRATER_DK, CRATER_DREF,
  CRATER_BOWL, CRATER_RIM_AT, CRATER_RIM_W,
  CRATER_MARE_FROM, CRATER_MARE_TO,
} from './terrain.js';

// Бюджет на пиксель. Каждый масштаб кратеров — это 27 ячеек решётки,
// поэтому их число ограничено; при нехватке производительности крутить
// надо в первую очередь DETAIL_MAX_CS.
// Бюджет на пиксель связан с допуском на тексель (TILE_TEXEL_TOL): окна
// должно хватать, чтобы дотянуть деталь от текселя САМОЙ ГРУБОЙ
// разрешённой плитки до пикселя. Не хватит — деталь обрывается выше
// пикселя, и в момент, когда плитка сменится на подробную, недостающие
// кратеры появятся разом. Это и видно как «прогрузку» на подлёте.
export const DETAIL_MAX_CS = 5;
export const DETAIL_MAX_OCT = 6;
// Мельче этого не считаем ни в шейдере, ни при запекании: координата
// решётки — это направление (по модулю 1) делённое на масштаб, а во
// float32 у единицы шаг 6e-8. При масштабе 5e-6 на ячейку приходится
// ещё около восьмидесяти различимых положений — этого хватает; ниже
// решётка начинает «ступеньками» проступать в нормали.
export const DETAIL_MIN_SCALE = 5e-6;
// След пикселя меньше половины детали — деталь показываем целиком;
// меньше 2.5 — не показываем вовсе. Между ними плавное появление.
export const DETAIL_FADE_LO = 2.5;
export const DETAIL_FADE_HI = 5.0;

// --- Регулятор детализации ---------------------------------------------------
//
// Деталь на пиксель — самая дорогая работа в кадре, и стоит она не по
// числу треугольников, а по числу закрашенных пикселей: у поверхности,
// занявшей экран, полный бюджет считается на каждый. Замер на RTX 3050:
// 26 кадров в секунду в двухстах километрах над луной при 480 тысячах
// треугольников и 110 вызовах — то есть кадр уходил целиком в
// заполнение, а не в геометрию.
//
// Резать при этом сам бюджет (uMaxCs, uMaxOct) НЕЛЬЗЯ: частичная сумма
// — это не менее подробная поверхность, а смещённая, и на стыке плиток
// разных уровней нормаль уезжает на десятки градусов (подробнее в
// dDetail ниже). Единственная ручка, которая меняет только резкость, —
// РАСШИРЕНИЕ СЛЕДА ПИКСЕЛЯ: шейдер считает ровно то же, что считал бы
// на экране меньшего разрешения. Поверхность выходит та же, только
// сглаженная, поэтому ни шва, ни скачка нормали не появляется.
//
// Отсюда и форма регулятора — та же, что у допуска плиток: нагрузка
// сглаживается, множитель ходит медленно, и у него есть мёртвая зона.
// Быстро вверх и медленно вниз: провал кадров надо лечить за секунду, а
// возвращать резкость лучше незаметно, иначе на пороге картинка
// «дышит».
export const FW_MAX = 8;             // предел расширения следа
export const FW_UP = 1.03;           // ~1.2 с от края до края
export const FW_DOWN = 0.99;         // ~3.5 с обратно
export const FW_SMOOTH = 0.08;
// Целевое время кадра. Два значения, потому что сигналы разные: таймер
// карты (js/gl/gputime.js) даёт чистую работу GPU, и её надо держать
// заметно ниже кадра, чтобы осталось на всё остальное. Длительность
// кадра, наоборот, синхронизацией прижата к 16.7 мс — по ней трогать
// деталь можно только когда кадр УЖЕ не успевает, иначе регулятор
// срежет деталь на машине, которая ровно держит шестьдесят.
export const FW_TARGET_GPU = 13;
export const FW_TARGET_CPU = 20;

export const makeDetailLoad = () => ({ scale: 1, load: 1 });

/**
 * Подвинуть множитель следа пикселя по времени кадра.
 * @param reg     состояние из makeDetailLoad
 * @param frameMs время кадра, мс (0 или мусор — не двигаем ничего)
 * @param target  сколько миллисекунд считаем нормой
 * @returns новый множитель
 */
export function updateDetailLoad(reg, frameMs, target = FW_TARGET_GPU) {
  // Замер может не состояться: таймер не готов, окно свернули, кадр
  // вышел бесконечным. Такое значение НЕ должно двигать деталь вовсе.
  if (!Number.isFinite(frameMs) || frameMs <= 0 || !(target > 0)) return reg.scale;
  // Выброс ограничен сверху: после паузы (переключились в другое окно)
  // кадр приходит длиной в секунды, и без ограничения сглаженная
  // нагрузка потом десятки кадров сползала бы обратно — всё это время
  // деталь держалась бы на самом грубом пределе.
  reg.load += (Math.min(frameMs / target, 4) - reg.load) * FW_SMOOTH;
  if (reg.load > 1.05) reg.scale = Math.min(FW_MAX, reg.scale * FW_UP);
  else if (reg.load < 0.9) reg.scale = Math.max(1, reg.scale * FW_DOWN);
  return reg.scale;
}

const f = (x) => {
  const s = String(x);
  return s.includes('.') || s.includes('e') ? s : s + '.0';
};

/**
 * Окно детализации шейдера: с какой октавы и с какого масштаба кратеров
 * он продолжает сетку и докуда доходит при данном следе пикселя.
 *
 * Та же функция terrain.detailForCell, что выбирает детализацию сетки:
 * «докуда» — это её ответ для ячейки размером в пиксель. Поэтому
 * геометрия и шейдер стыкуются ровно, без нахлёста и без провала.
 * GLSL в DETAIL_GLSL повторяет эту арифметику.
 *
 * @param terrain  поверхность тела (js/gl/terrain.js)
 * @param meshCell угловой размер ячейки сетки, рад
 * @param fw       угловой след пикселя, рад
 */
export function detailWindow(terrain, meshCell, fw) {
  const from = terrain.detailForCell(meshCell);
  const to = terrain.detailForCell(Math.max(fw, DETAIL_MIN_SCALE / DETAIL_FADE_LO));
  return {
    octFrom: from.oct,
    csFrom: from.cs,
    octTo: Math.max(from.oct, Math.min(to.oct, from.oct + DETAIL_MAX_OCT)),
    csTo: Math.max(from.cs, Math.min(to.cs, from.cs + DETAIL_MAX_CS)),
  };
}

/**
 * Uniform-ы для ЗАПЕКАНИЯ: окно начинается с нулевой октавы (в текстуру
 * пишется вся поверхность, а не добавка к сетке), масштабов — сколько
 * есть. Это считается один раз на тексель.
 */
export function bakeUniforms(terrain) {
  const p = terrain.shaderParams();
  return {
    on: p.flat ? 0 : 1,
    seed: p.seed,
    amp: p.amp,
    span: p.span,
    freq: p.freq,
    ridge: p.ridge,
    craterW: p.craterW,
    octFrom: 0,
    csFrom: 0,
    maxCs: BAKE_MAX_CS,
    maxOct: BAKE_MAX_OCT,
    // Сверху окно не обрезано: в текстуру пишется вся поверхность.
    bakeFw: 0,
    // Площадка города: в запечённой текстуре она обязана быть такой же
    // ровной, как в геометрии. Иначе на срезанном грунте остаются тени
    // кратеров, которых там уже нет, — а это единственное, что видно с
    // воздуха, потому что сорокаметровая яма с километра не читается
    // ничем, кроме своей тени.
    plate: p.plate || null,
  };
}

/**
 * Uniform-ы мелкого рельефа для тела и конкретной сетки.
 * @param budget доля бюджета на масштабы (1 — полный; меньше — для
 *        сетки, которая почти целиком закрыта чем-то другим)
 */
export function detailUniforms(terrain, meshCell, budget = 1) {
  const p = terrain.shaderParams();
  if (p.flat) return { on: 0 };
  const d = terrain.detailForCell(meshCell);
  return {
    on: 1,
    maxCs: Math.max(1, Math.round(DETAIL_MAX_CS * budget)),
    maxOct: Math.max(1, Math.round(DETAIL_MAX_OCT * budget)),
    seed: p.seed,
    amp: p.amp,
    span: p.span,
    freq: p.freq,
    ridge: p.ridge,
    craterW: p.craterW,
    octFrom: d.oct,
    csFrom: d.cs,
    bakeFw: 0,
    plate: p.plate || null,
  };
}

/**
 * Uniform-ы для плитки с запечённой текстурой.
 *
 * Текстура содержит рельеф крупнее своего текселя — шейдер продолжает
 * её вниз, с того масштаба, где её собственный вес начинает падать
 * (он обнуляется на 5·тексель, поэтому окно открывается как для сетки
 * с ячейкой в два текселя). Дальше вниз всё решает след пикселя:
 * далеко от камеры тексель мельче пикселя, вес нулевой, и вся эта
 * арифметика пропускается целиком.
 *
 * @param texel угловой размер текселя плитки, рад
 */
export function tileDetailUniforms(terrain, texel, budget = 1) {
  const u = detailUniforms(terrain, texel * 2, budget);
  if (!u.on) return u;
  u.bakeFw = texel;
  return u;
}

// --- GLSL --------------------------------------------------------------------

/**
 * Текст GLSL. Границы циклов — константы времени компиляции, поэтому
 * функция собирается дважды: с малыми границами для рисования на пиксель
 * (запасной путь) и с большими для запекания, где та же математика
 * считается один раз на тексель и может себе позволить все масштабы.
 */
export const detailGlsl = ({ maxCs, maxOct }) => `
uniform float uDetail;      // 0 — деталь не считать (корабли, светило, гигант)
uniform int uSeed;
uniform float uAmp;
uniform float uSpan;
uniform float uFreq;
uniform float uRidge;
uniform float uCraterW;
uniform int uOctFrom;       // октавы, уже вошедшие в геометрию
uniform int uCsFrom;        // масштабы кратеров, уже вошедшие в геометрию
uniform int uMaxCs;         // предел на масштабы кратеров (цена кадра)
uniform int uMaxOct;        // предел на октавы шума
// Угловой размер текселя запечённой текстуры, если она под этим
// пикселем есть (0 — нет). Всё, что крупнее, уже лежит в текстуре, и
// добавлять это второй раз нельзя.
uniform float uBakeFw;
// Ровная площадка наземного города: xyz — направление на неё, w —
// квадрат хорды её края (0 — площадки на этом теле нет). Мелкий рельеф
// на ней не считается: он срезан вместе с грунтом, и досчитывать его
// поверх значило бы рисовать камни там, где их уже нет
// (js/gl/terrain.js, plateAt — та же арифметика).
uniform vec4 uPlate;
uniform float uPlateRim;    // квадрат хорды внешнего края перехода

const float D_GAIN = ${f(GAIN)};
const float D_LAC = ${f(LAC)};
const float D_C0 = ${f(CRATER_C0)};
const float D_STEP = ${f(CRATER_STEP)};
const int D_MAX_SCALES = ${CRATER_MAX_SCALES};
const float D_RIM = ${f(CRATER_RIM)};
const float D_RMIN = ${f(CRATER_RMIN)};
const float D_RSPAN = ${f(CRATER_RSPAN)};
const float D_FRESH = ${f(CRATER_FRESH_MIN)};
const float D_REACH = ${f(CRATER_REACH)};
const float D_CULL = ${f(CRATER_REACH * (CRATER_RMIN + CRATER_RSPAN) + 1.37)};
const float D_BOWL = ${f(CRATER_BOWL)};
const float D_RIM_AT = ${f(CRATER_RIM_AT)};
const float D_RIM_W = ${f(CRATER_RIM_W)};
const float D_MIN_SCALE = ${f(DETAIL_MIN_SCALE)};
const float D_FADE_LO = ${f(DETAIL_FADE_LO)};
const float D_FADE_HI = ${f(DETAIL_FADE_HI)};
const int D_MAX_CS = ${maxCs};
const int D_MAX_OCT = ${maxOct};
// Во сколько раз окно детали шире следа пикселя, если выбрать весь
// бюджет: масштабов кратеров maxCs (каждый в 1/STEP раз мельче),
// октав maxOct. Ограничение берётся по тому, что кончается первым.
const float D_FIT = ${f(2 / Math.min(CRATER_STEP ** -maxCs, LAC ** maxOct))};
const int D_CRATER_SEED = ${CRATER_SEED};
const float D_MARE_FROM = ${f(CRATER_MARE_FROM)};
const float D_MARE_TO = ${f(CRATER_MARE_TO)};

// Тот же хеш, что в js/gl/terrain.js: imul в JS и умножение uint здесь
// дают одни и те же 32 бита.
uint dHash(int seed, ivec3 c) {
  uint h = uint(seed) ^ (uint(c.x) * 374761393u)
         ^ (uint(c.y) * 668265263u) ^ (uint(c.z) * 1442695041u);
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}

/** Вес площадки: 1 на плите, 0 за краем перехода. */
float dPlate(vec3 dir) {
  if (uPlate.w <= 0.0) return 0.0;
  vec3 q = dir - uPlate.xyz;
  return 1.0 - smoothstep(uPlate.w, uPlateRim, dot(q, q));
}

float dFade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

// 12 градиентов — рёбра куба, тот же порядок, что в таблице GRADS.
vec3 dGrad(uint h) {
  uint i = h % 12u;
  float a = (i & 1u) == 0u ? 1.0 : -1.0;
  float b = (i & 2u) == 0u ? 1.0 : -1.0;
  if (i < 4u) return vec3(a, b, 0.0);
  if (i < 8u) return vec3(a, 0.0, b);
  return vec3(0.0, a, b);
}

float dPerlin(int seed, vec3 p) {
  vec3 ip = floor(p);
  ivec3 i0 = ivec3(ip);
  vec3 fr = p - ip;
  vec3 u = vec3(dFade(fr.x), dFade(fr.y), dFade(fr.z));

  float n000 = dot(dGrad(dHash(seed, i0 + ivec3(0, 0, 0))), fr - vec3(0.0, 0.0, 0.0));
  float n100 = dot(dGrad(dHash(seed, i0 + ivec3(1, 0, 0))), fr - vec3(1.0, 0.0, 0.0));
  float n010 = dot(dGrad(dHash(seed, i0 + ivec3(0, 1, 0))), fr - vec3(0.0, 1.0, 0.0));
  float n110 = dot(dGrad(dHash(seed, i0 + ivec3(1, 1, 0))), fr - vec3(1.0, 1.0, 0.0));
  float n001 = dot(dGrad(dHash(seed, i0 + ivec3(0, 0, 1))), fr - vec3(0.0, 0.0, 1.0));
  float n101 = dot(dGrad(dHash(seed, i0 + ivec3(1, 0, 1))), fr - vec3(1.0, 0.0, 1.0));
  float n011 = dot(dGrad(dHash(seed, i0 + ivec3(0, 1, 1))), fr - vec3(0.0, 1.0, 1.0));
  float n111 = dot(dGrad(dHash(seed, i0 + ivec3(1, 1, 1))), fr - vec3(1.0, 1.0, 1.0));

  float x00 = mix(n000, n100, u.x);
  float x10 = mix(n010, n110, u.x);
  float x01 = mix(n001, n101, u.x);
  float x11 = mix(n011, n111, u.x);
  float y0 = mix(x00, x10, u.y);
  float y1 = mix(x01, x11, u.y);
  return mix(y0, y1, u.z) * 1.1;
}

// Простая сумма октав от нулевой — для низкочастотных масок.
// Соответствует fbm(seed, p, oct, 1) на CPU.
float dNoiseRaw(int seed, vec3 p, int oct) {
  float sum = 0.0;
  float amp = 1.0;
  float fq = 1.0;
  for (int o = 0; o < 3; o++) {
    if (o >= oct) break;
    sum += amp * dPerlin(seed + o * 1013, p * fq);
    amp *= D_GAIN;
    fq *= D_LAC;
  }
  return sum * (1.0 - D_GAIN);
}

/**
 * Вес масштаба детали.
 *
 * Снизу его обрезает след пикселя: то, что мельче него, дало бы рябь.
 * Сверху — запечённая текстура: она содержит всё крупнее своего
 * текселя, и вес здесь ровно дополняет её собственный (та же
 * smoothstep, взятая наоборот). Поэтому сумма «текстура + шейдер» не
 * зависит от того, плитка какого уровня оказалась под пикселем, и на
 * стыке уровней нет ни шва, ни удвоенного рельефа.
 */
float dWeight(float scale, float fw) {
  float w = smoothstep(D_FADE_LO * fw, D_FADE_HI * fw, scale);
  if (uBakeFw > 0.0) {
    w *= 1.0 - smoothstep(D_FADE_LO * uBakeFw, D_FADE_HI * uBakeFw, scale);
  }
  return w;
}

// Октавы шума мельче тех, что уже в сетке. Появляются плавно: вес
// зависит от того, насколько длина волны больше следа пикселя.
float dNoiseSum(vec3 p, int octTo, float fw) {
  float sum = 0.0;
  float amp = pow(D_GAIN, float(uOctFrom));
  float fq = uFreq * pow(D_LAC, float(uOctFrom));
  for (int o = 0; o < D_MAX_OCT; o++) {
    int oi = uOctFrom + o;
    if (o >= uMaxOct || oi >= octTo) break;
    float w = dWeight(1.0 / fq, fw);
    if (w > 0.001) {
      if (uRidge > 0.5) {
        float n = 1.0 - abs(dPerlin(uSeed + oi * 7919, p * fq));
        sum += w * amp * (n * n - 0.5);
      } else {
        sum += w * amp * dPerlin(uSeed + oi * 1013, p * fq);
      }
    }
    amp *= D_GAIN;
    fq *= D_LAC;
  }
  return sum * (1.0 - D_GAIN) * (uRidge > 0.5 ? 1.6 : 1.0);
}

float dCraterDepth(float rc) {
  return min(${f(CRATER_DMAX)}, ${f(CRATER_DK)} * sqrt(${f(CRATER_DREF)} / rc)) * rc;
}

// Профиль и его производная: чаша со сглаженной кромкой плюс
// полиномиальный вал. Ни одного exp — это важно, считается на пиксель.
float dProfile(float t) {
  if (t >= D_REACH) return 0.0;
  float s = clamp(t / D_BOWL, 0.0, 1.0);
  float bowl = s * s * (3.0 - 2.0 * s) - 1.0;
  float u = (t - D_RIM_AT) / D_RIM_W;
  float bump = max(0.0, 1.0 - u * u);
  return bowl + D_RIM * bump * bump;
}

float dProfileD(float t) {
  if (t >= D_REACH) return 0.0;
  float s = t / D_BOWL;
  float bowl = (s > 0.0 && s < 1.0) ? 6.0 * s * (1.0 - s) / D_BOWL : 0.0;
  float u = (t - D_RIM_AT) / D_RIM_W;
  float rim = abs(u) < 1.0 ? -4.0 * D_RIM * u * (1.0 - u * u) / D_RIM_W : 0.0;
  return bowl + rim;
}

/**
 * Кратеры мельче ячейки сетки: высота и наклон за один проход.
 * Центры — узлы трёхмерной решётки у поверхности сферы, как на CPU,
 * поэтому проверяются 27 соседних ячеек: дальше кратер не дотянется.
 */
void dCraters(vec3 p, vec3 U, vec3 V, int csTo, float fw, float dens, out float h, out vec2 g) {
  h = 0.0;
  g = vec2(0.0);
  float c = D_C0 * pow(D_STEP, float(uCsFrom));
  for (int si = 0; si < D_MAX_CS; si++) {
    int s = uCsFrom + si;
    if (si >= uMaxCs || s >= csTo || s >= D_MAX_SCALES) break;
    // Маска «морей» действует на крупные масштабы целиком, на мелкие —
    // уже нет (см. mareWeight в js/gl/terrain.js).
    float mw = mix(dens, 1.0, smoothstep(D_MARE_FROM, D_MARE_TO, float(s)));
    float w = dWeight(c, fw) * mw;
    if (w > 0.001) {
      int layerSeed = uSeed + D_CRATER_SEED + s * 7717;
      // Отсев ячеек: далеко от сферы или далеко от точки. Профиль вала
      // имеет компактный носитель, поэтому отсев точный — он отбрасывает
      // только те кратеры, вклад которых равен ровно нулю.
      float lo = (1.0 - c) * (1.0 - c), hi = (1.0 + c) * (1.0 + c);
      float cull2 = (D_CULL * c) * (D_CULL * c);
      ivec3 base = ivec3(floor(p / c));
      for (int di = -1; di <= 1; di++) {
        for (int dj = -1; dj <= 1; dj++) {
          for (int dk = -1; dk <= 1; dk++) {
            ivec3 cell = base + ivec3(di, dj, dk);
            vec3 ctr = (vec3(cell) + 0.5) * c;
            float al2 = dot(ctr, ctr);
            if (al2 < lo || al2 > hi) continue;
            vec3 e = ctr - p;
            if (dot(e, e) > cull2) continue;

            uint hh = dHash(layerSeed, cell);
            vec3 jit = vec3(float(hh & 1023u), float((hh >> 10u) & 1023u),
                            float((hh >> 20u) & 1023u)) / 1024.0;
            vec3 q = (vec3(cell) + jit) * c;
            float ql = length(q);
            if (abs(ql - 1.0) > 0.5 * c) continue;

            vec3 nq = q / ql;
            float chord = length(nq - p);
            float ang = chord * (1.0 + chord * chord / 24.0);
            uint h2 = dHash(layerSeed ^ 0x9e37, cell);
            float ru = float(h2 & 255u) / 256.0;
            float rc = (D_RMIN + D_RSPAN * ru * sqrt(ru)) * c;
            float t = ang / rc;
            if (t >= D_REACH) continue;

            float fu = float((h2 >> 8u) & 255u) / 256.0;
            float fresh = D_FRESH + (1.0 - D_FRESH) * fu * fu;
            float dep = dCraterDepth(rc) * fresh * w;
            h += dep * dProfile(t);
            // Наклон: угол растёт при удалении от центра кратера,
            // поэтому градиент направлен от него.
            vec3 T = nq - p * dot(p, nq);
            float tl = length(T);
            if (tl > 1e-9) {
              T /= tl;
              float dh = -dep * dProfileD(t) / rc;
              g += vec2(dot(T, U), dot(T, V)) * dh;
            }
          }
        }
      }
    }
    c *= D_STEP;
  }
  h *= uCraterW;
  g *= uCraterW;
}

/**
 * Плотность кратеров: 0 в «морях», 1 на «материках». Та же маска, что
 * на CPU. Три вызова шума, зато в морях весь кратерный цикл
 * пропускается — это и правдоподобнее, и дешевле.
 */
float dMare(vec3 p) {
  if (uCraterW <= 0.0) return 0.0;
  float m = (dNoiseRaw(uSeed + 991, p * 1.3, 3) + 0.25) / 0.5;
  float d = clamp(m, 0.0, 1.0);
  return d * d * (3.0 - 2.0 * d);
}

// Докуда имеет смысл считать при данном угловом следе (пикселя при
// рисовании, текселя при запекании). Повторяет terrain.detailForCell.
void dLimits(float fw, out int octTo, out int csTo) {
  float lim = max(D_FADE_LO * fw, D_MIN_SCALE);
  octTo = 1 + int(floor(log(1.0 / (uFreq * lim)) / log(D_LAC)));
  csTo = 1 + int(floor(log(lim / D_C0) / log(D_STEP)));
}

/**
 * Рельеф мельче ячейки сетки: высота шума и вклад кратеров (в долях
 * радиуса) по отдельности плюс общий наклон по касательным.
 *
 * Шум и кратеры разделены не для красоты: при запекании окно начинается
 * с нулевой октавы, и по шумовой части восстанавливается абсолютная
 * высота — а по ней видно, где вода.
 */
void dDetail(vec3 p, vec3 U, vec3 V, float fwIn, out float hn, out vec2 g, out float cr) {
  // Окно не может быть шире бюджета. Если тексель плитки настолько
  // крупнее пикселя, что разница в бюджет не влезает, добавлять
  // «сколько успеется» НЕЛЬЗЯ: частичная сумма — это не менее подробная
  // поверхность, а смещённая. На грубой плитке вблизи нормаль уезжала
  // на тридцать градусов, и на стыке с подробным соседом это читалось
  // прямой границей света и тени поперёк грунта.
  //
  // Вместо этого расширяем след пикселя: поверхность выходит та же,
  // только сглаженная, — ровно как более крупный мип. Соседние уровни
  // тогда отличаются резкостью, а не наклоном, и стык не виден.
  float fw = max(fwIn, uBakeFw * D_FIT);
  int octTo, csTo;
  dLimits(fw, octTo, csTo);
  float dens = dMare(p);

  vec2 gc = vec2(0.0);
  cr = 0.0;
  dCraters(p, U, V, csTo, fw, dens, cr, gc);

  float k = uAmp / max(uSpan, 1e-6);
  float n0 = dNoiseSum(p, octTo, fw) * k;
  vec2 gn = vec2(0.0);
  if (octTo > uOctFrom) {
    // Наклон шума — конечными разностями шагом в пиксель: он же
    // сглаживает деталь на пределе разрешения.
    float eps = max(1.5 * fw, 1e-7);
    float nu = dNoiseSum(normalize(p + U * eps), octTo, fw) * k;
    float nv = dNoiseSum(normalize(p + V * eps), octTo, fw) * k;
    gn = vec2(nu - n0, nv - n0) / eps;
  }

  hn = n0;
  g = gn + gc;
}
`;

export const DETAIL_GLSL = detailGlsl({
  maxCs: DETAIL_MAX_CS,
  maxOct: DETAIL_MAX_OCT,
});

// При запекании считаются все масштабы, какие может показать тексель:
// это один раз на тексель, а не на пиксель в кадре.
export const BAKE_MAX_CS = CRATER_MAX_SCALES;
export const BAKE_MAX_OCT = 24;

export const BAKE_DETAIL_GLSL = detailGlsl({
  maxCs: BAKE_MAX_CS,
  maxOct: BAKE_MAX_OCT,
});
