// Исходники шейдеров. Держим их строками в модуле: у проекта нет сборки,
// и отдельными файлами их пришлось бы догружать по сети.

import { DETAIL_GLSL, BAKE_DETAIL_GLSL } from './detail.js';

// Глубина пишется логарифмически (см. mat4.js): иначе на диапазоне от
// метров до миллионов километров начинается z-fighting.
const LOG_DEPTH_FRAG = `
  gl_FragDepth = log2(vFragDepth) * uLogFC * 0.5;
`;

// --- Меши: корабли, станции, планеты ---------------------------------------
// Плоское затенение у кораблей и гладкое у планет — это одна и та же
// программа, разница только в том, что лежит в нормалях вершин.

export const MESH_VS = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec4 aColor;          // rgb + флаг «сам светится» в альфе
in vec2 aUv;             // только у заплаток: координата в их текстуре

uniform mat4 uProj;
uniform mat4 uModelView;
uniform mat3 uNormalMat;

out vec3 vNormal;
out vec3 vViewPos;
out vec4 vColor;
out float vFragDepth;
out vec3 vLocal;         // позиция в локальных осях тела — для мелкого рельефа
out vec2 vUv;

void main() {
  vec4 vp = uModelView * vec4(aPos, 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  vViewPos = vp.xyz;
  vNormal = uNormalMat * aNormal;
  vColor = aColor;
  vLocal = aPos;
  vUv = aUv;
}`;

// Фрагментный шейдер мешей собирается в двух вариантах: с процедурной
// деталью на пиксель и без неё. Второй — страховка: если деталь не
// соберётся на каком-то драйвере, сцена останется рабочей (js/gl/scene.js).
const meshFs = (detail) => `#version 300 es
precision highp float;
// Целые во фрагментном шейдере по умолчанию mediump, а это всего 16 бит:
// хеши процедурного рельефа (js/gl/detail.js) без highp развалились бы.
precision highp int;

in vec3 vNormal;
in vec3 vViewPos;
in vec4 vColor;
in float vFragDepth;
in vec3 vLocal;
in vec2 vUv;

uniform vec3 uSunDir;    // направление НА солнце в координатах камеры
uniform mat3 uNormalMat;
uniform float uAmbient;
uniform float uLogFC;
// Запечённая поверхность: нормаль в локальных осях (RGB) и тон (A).
// uSurfMode = 0 — текстуры нет (корабли, станции, светило).
uniform sampler2D uSurfTex;
uniform float uSurfMode;
${detail ? DETAIL_GLSL : ''}

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  vec3 n = normalize(vNormal);
  vec3 albedo = vColor.rgb;

  // Готовая поверхность из текстуры: нормаль берётся целиком из неё,
  // поэтому освещение не зависит от того, какой уровень сетки под
  // текстурой — переключения LOD в картинке не видны вовсе.
  if (uSurfMode > 0.5) {
    vec4 s = texture(uSurfTex, vUv);
    vec3 nl = s.xyz * 2.0 - 1.0;
    if (dot(nl, nl) > 0.01) n = normalize(uNormalMat * nl);
    albedo *= 1.0 + (s.w * 2.0 - 1.0);
  }
${detail ? `
  // Мелкий рельеф: то, что не влезло ни в сетку, ни в запечённую
  // текстуру, считается здесь и наклоняет нормаль. Деталь зависит от
  // следа пикселя на поверхности, поэтому одинаково работает и с
  // орбиты, и у самой земли.
  //
  // На плитке это добавка снизу к текстуре: у самой земли тексель
  // растягивается на десятки пикселей, и без добавки грунт выходит
  // гладким — сколько бы уровней ни подгрузилось. Считается она только
  // там, где тексель ещё крупнее пикселя: дальше вес нулевой, и весь
  // блок пропускается.
  if (uDetail > 0.5) {
    vec3 dirL = normalize(vLocal);
    // След пикселя на поверхности в радианах. Нулевым он быть не должен:
    // на него делится плавное появление деталей.
    float fw = max(max(length(dFdx(dirL)), length(dFdy(dirL))), 1e-9);
    if (uBakeFw <= 0.0 || fw < 2.0 * uBakeFw) {
      vec3 helper = abs(dirL.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 U = normalize(cross(helper, dirL));
      vec3 V = cross(dirL, U);
      float dh; vec2 dg; float dcr;
      dDetail(dirL, U, V, fw, dh, dg, dcr);
      // Вода должна оставаться гладкой: рябь на океане в километры высотой
      // выглядит нелепо. Признак воды — синева цвета вершины; считать для
      // этого ещё и крупные октавы шума было бы вдвое дороже.
      float wet = clamp((vColor.b - max(vColor.r, vColor.g)) * 4.0, 0.0, 1.0);
      float dry = 1.0 - 0.85 * wet;
      dg *= dry; dh *= dry; dcr *= dry;
      // Наклон ограничиваем: на стенке кратера градиент может выйти за
      // 90°, и нормаль вывернулась бы наизнанку.
      vec3 pert = U * dg.x + V * dg.y;
      float pl = length(pert);
      if (pl > 1.6) pert *= 1.6 / pl;
      n = normalize(n - uNormalMat * pert);
      // Возвышенности светлее, впадины темнее — так мелкий рельеф читается
      // не только в скользящем свете. Кратерам вес больше: их валы должны
      // быть заметны.
      albedo *= 1.0 + clamp((dh + dcr) / max(uAmp, 1e-6), -0.3, 0.3);
    }
  }
` : ''}
  // Двустороннее освещение: нормаль всегда разворачиваем к камере. Так
  // корректно светятся «двусторонние» грани (тоннель порта станции), и
  // не нужно следить за порядком обхода вершин при сборке мешей.
  if (dot(n, normalize(vViewPos)) > 0.0) n = -n;

  float lam = max(dot(n, uSunDir), 0.0);
  float shade = mix(uAmbient + (1.0 - uAmbient) * lam, 1.0, vColor.a);
  outColor = vec4(albedo * shade, 1.0);
}`;

export const MESH_FS = meshFs(false);
export const MESH_FS_DETAIL = meshFs(true);

// --- Запекание поверхности в текстуру ---------------------------------------
// Тот же процедурный рельеф, но считается один раз на тексель и пишется
// в текстуру: нормаль в локальных осях тела (RGB) и тон (A).
// Дальше рисование — просто выборка, без всякой математики.

export const BAKE_VS = `#version 300 es
in vec2 aQuad;
out vec2 vSt;
void main() {
  gl_Position = vec4(aQuad, 0.0, 1.0);
  vSt = aQuad;                     // [-1, 1] по обеим осям
}`;

export const BAKE_FS = `#version 300 es
precision highp float;
precision highp int;

in vec2 vSt;

// Запекаемый кусок: оси грани куба и диапазон её параметров, который
// занимает плитка. Отображение то же, что в js/gl/quadtree.js — иначе
// текстура не совпала бы с геометрией.
uniform vec3 uFaceF;
uniform vec3 uFaceU;
uniform vec3 uFaceV;
uniform vec4 uRange;             // u0, u1, v0, v1
uniform float uTexel;            // угловой размер текселя, рад
${BAKE_DETAIL_GLSL}

const float Q = 0.78539816;      // π/4

out vec4 outColor;

// Высота поверхности над сферой в долях радиуса. Ниже уровня моря
// поверхность ровная, поэтому clamp применяется к КАЖДОМУ отсчёту: так
// наклон в воде выходит нулевым сам, без отдельной проверки.
float bakeLand(vec3 p, int octTo) {
  float raw = dNoiseSum(p, octTo, uTexel);       // окно с нулевой октавы
  float sea = 1.0 - uSpan;
  return clamp((raw - sea) / uSpan, 0.0, 1.0) * uAmp;
}

void main() {
  vec2 t = vSt * 0.5 + 0.5;
  float su = mix(uRange.x, uRange.y, t.x);
  float sv = mix(uRange.z, uRange.w, t.y);
  vec3 dir = normalize(uFaceF + uFaceU * tan(su * Q) + uFaceV * tan(sv * Q));

  if (uDetail < 0.5) {           // тело без рельефа — ровная сфера
    outColor = vec4(dir * 0.5 + 0.5, 0.5);
    return;
  }

  vec3 helper = abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 U = normalize(cross(helper, dir));
  vec3 V = cross(dir, U);

  int octTo, csTo;
  dLimits(uTexel, octTo, csTo);

  // Кратеры: высота и наклон за один проход, с маской «морей».
  float cr = 0.0;
  vec2 gc = vec2(0.0);
  float dens = dMare(dir);
  dCraters(dir, U, V, csTo, uTexel, dens, cr, gc);

  // Наклон шума — конечными разностями шагом в тексель: это же и
  // сглаживание на пределе разрешения текстуры.
  float eps = max(1.5 * uTexel, 1e-7);
  float h0 = bakeLand(dir, octTo);
  float hu = bakeLand(normalize(dir + U * eps), octTo);
  float hv = bakeLand(normalize(dir + V * eps), octTo);
  vec2 g = vec2(hu - h0, hv - h0) / eps + gc;

  // Наклон ограничиваем: на стенке кратера градиент может выйти за 90°,
  // и нормаль вывернулась бы наизнанку.
  vec3 pert = U * g.x + V * g.y;
  float pl = length(pert);
  if (pl > 1.6) pert *= 1.6 / pl;
  vec3 n = normalize(dir - pert);

  // Тон: валы кратеров светлее, дно темнее. Крупный рельеф в тон не
  // идёт — его уже несёт цвет вершин сетки.
  float tint = clamp(cr / max(uAmp * 0.5, 1e-6), -0.3, 0.3);
  outColor = vec4(n * 0.5 + 0.5, tint * 0.5 + 0.5);
}`;

// --- Тень корабля -----------------------------------------------------------
// Один тёмный многоугольник на грунте (js/game/shadow.js). Рисуется
// умножением: под тенью от поверхности остаётся только та часть света,
// которая и так шла не от солнца. Поэтому шейдер и не считает ничего
// сам — освещение уже посчитано в поверхности.

export const SHADOW_VS = `#version 300 es
in vec3 aPos;

uniform mat4 uProj;
uniform mat4 uModelView;

out float vFragDepth;

void main() {
  vec4 vp = uModelView * vec4(aPos, 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
}`;

export const SHADOW_FS = `#version 300 es
precision highp float;

in float vFragDepth;
uniform float uLogFC;
uniform float uDark;     // во сколько раз гасим свет под тенью

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  outColor = vec4(vec3(uDark), 1.0);
}`;

// --- Звёздный фон -----------------------------------------------------------

export const STARS_VS = `#version 300 es
in vec3 aDir;
in vec4 aColor;          // rgb + яркость в альфе

uniform mat3 uView;      // мир -> камера, только поворот
uniform mat4 uProj;
uniform float uPointScale;

out vec4 vColor;

void main() {
  vec3 c = uView * aDir;
  // Звёзды бесконечно далеко; кладём их просто очень далеко, буфер
  // глубины для них всё равно выключен.
  gl_Position = uProj * vec4(c * 1.0e8, 1.0);
  gl_PointSize = (aColor.a > 0.82 ? 2.0 : 1.0) * uPointScale;
  vColor = aColor;
}`;

export const STARS_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() {
  outColor = vec4(vColor.rgb, 1.0) * (0.25 + vColor.a * 0.75);
}`;

// --- Поток частиц в прыжке ---------------------------------------------------
//
// Первая версия растягивала в полосы сам звёздный фон. Выглядело это
// ровно так, как и должно было: полосы СТОЯЛИ на месте. Звёзды
// бесконечно далеко, у них есть только направление, и двигаться
// относительно корабля они не могут ни при какой скорости — растянуть
// их можно, а заставить лететь мимо нельзя.
//
// Поэтому здесь не звёзды, а отдельный поток частиц вокруг оси
// движения. У каждой своя азимутальная сторона (phi), своё удаление от
// оси (rp) и своя фаза (seed). Частица летит НА камеру: продольная
// координата убывает от uZ0 к нулю, и угол от оси растёт как
// atan(rp/z) — то есть именно так, как растёт он у предмета, мимо
// которого пролетаешь. Отсюда и вся картинка: у точки схода частицы
// почти стоят, к краю кадра разгоняются и вытягиваются в длинные
// полосы. Дошла до нуля — родилась заново у точки схода.

export const WARP_VS = `#version 300 es
in vec3 aParam;          // phi — сторона, rp — удаление от оси, seed — фаза
in float aT;             // 0 — голова частицы, 1 — конец хвоста

uniform mat3 uView;      // мир -> камера, только поворот
uniform mat4 uProj;
uniform vec3 uAxis;      // ось движения (мировая)
uniform vec3 uE1;        // и два перпендикуляра к ней
uniform vec3 uE2;
uniform float uPhase;    // общая фаза потока, растёт со временем
uniform float uTail;     // насколько хвост отстаёт по фазе
uniform float uZ0;       // с какой глубины частица начинает путь

out float vFade;

void main() {
  float t = fract(uPhase + aParam.z);
  // Хвост — та же частица, но чуть раньше по времени.
  float z = uZ0 * (1.0 - (t - aT * uTail));
  vec3 dirW = uAxis * z + (uE1 * cos(aParam.x) + uE2 * sin(aParam.x)) * aParam.y;
  vec3 c = uView * normalize(dirW);
  gl_Position = uProj * vec4(c * 1.0e8, 1.0);
  // Гаснет при рождении и у самого края: иначе видно, как частицы
  // возникают из ничего и обрываются на границе кадра.
  vFade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.70, 1.0, t))
        * (1.0 - aT * 0.85);
}`;

export const WARP_FS = `#version 300 es
precision mediump float;
in float vFade;
uniform float uPower;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  float a = vFade * uPower;
  outColor = vec4(uColor * a, a);
}`;

// --- Пылинки за бортом ------------------------------------------------------
//
// Тем же способом, что и поток прыжка, обычную скорость показать
// нельзя, и причина поучительная: тот поток нарисован как ПРОЕКЦИЯ —
// частицы там не имеют ни расстояния, ни положения, только направление,
// и живут в узком конусе вокруг курса. В прыжке этого хватает (смотреть
// всё равно можно только вперёд), а в обычном полёте сразу видно два
// изъяна: отвернул камеру — поток пропал, потому что сбоку его просто
// нет; подлетел к планете — поток оказался ЗА ней, потому что
// бесконечно далёкому нечем закрыть собой близкое.
//
// Поэтому здесь пылинки настоящие: у каждой есть место в пространстве и
// глубина. Стоят они в узлах бесконечной решётки с шагом uBox, а
// решётка сдвигается на пройденный кораблём путь (uOfs). Ближайший
// образ узла берётся через fract(...) - 0.5 — так пылинка, ушедшая за
// корму, тут же появляется впереди, и никакого списка частиц вести не
// нужно.
//
// Черта — это смаз: за время экспозиции пылинка сместилась относительно
// корабля на uStreak, и вторая вершина линии стоит там, где она была.
// Отсюда всё поведение: стоит корабль — смаза нет вовсе, идёт на
// форсаже втрое быстрее — черта втрое длиннее.

export const MOTE_VS = `#version 300 es
in vec3 aCell;           // место пылинки внутри ячейки, [0..1)
in float aT;             // 0 — сама пылинка, 1 — где она была экспозицию назад

uniform mat4 uProj;
uniform mat3 uView;      // мир -> камера, только поворот
uniform vec3 uShipRel;   // корабль относительно камеры, км
uniform vec3 uOfs;       // пройденный путь в долях ячейки, [0..1)
uniform float uBox;      // шаг решётки, км
uniform vec3 uStreak;    // смаз за экспозицию, км

out float vFade;
out float vFragDepth;

void main() {
  vec3 cell = fract(aCell - uOfs + 0.5) - 0.5;
  vec3 r = cell * uBox + uStreak * aT;
  vec4 vp = vec4(uView * (r + uShipRel), 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  // Гаснет к краю ячейки: без этого видно, как пылинка перескакивает
  // с одной стороны решётки на другую.
  vFade = (1.0 - smoothstep(uBox * 0.33, uBox * 0.5, length(r)))
        * (1.0 - aT * 0.75);
}`;

export const MOTE_FS = `#version 300 es
precision mediump float;

in float vFade;
in float vFragDepth;

uniform float uLogFC;
uniform vec3 uColor;
uniform float uPower;

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  float a = vFade * uPower;
  outColor = vec4(uColor * a, a);
}`;

// --- Квантовый тоннель ------------------------------------------------------
//
// Полноэкранный аддитивный проход вокруг точки схода. Волокна текут ОТ
// неё к краям: координата вдоль потока — логарифм радиуса, поэтому
// скорость разбегания растёт к краю сама собой, как в перспективе.
//
// Угловая координата берётся кратной 2π (K = 24/2π), иначе на луче
// a = ±π был бы виден шов.

export const TUNNEL_VS = `#version 300 es
in vec2 aQuad;
out vec2 vUv;
void main() {
  gl_Position = vec4(aQuad, 0.0, 1.0);
  vUv = aQuad;
}`;

export const TUNNEL_FS = `#version 300 es
precision highp float;

in vec2 vUv;

uniform vec2 uCenter;    // точка схода в NDC
uniform float uAspect;
uniform float uTime;
uniform float uPower;    // 0..1
uniform vec3 uColor;

out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 p = (vUv - uCenter) * vec2(uAspect, 1.0);
  float r = max(length(p), 1.0e-4);
  float ang = atan(p.y, p.x);
  float K = 24.0 / 6.2831853;           // кратно 2π: без шва на ±π

  float flow = log(r) * 2.4 - uTime * 2.6;
  float n = vnoise(vec2(ang * K, flow)) * 0.65
          + vnoise(vec2(ang * K * 2.7, flow * 2.1 + 11.0)) * 0.35;
  n = pow(max(0.0, n - 0.30) / 0.70, 2.0);

  // Оболочка: в самой точке схода дыра (туда смотришь), к краю кадра
  // всё сходит на нет — иначе углы экрана заливает ровным светом.
  float env = smoothstep(0.02, 0.45, r) * (1.0 - smoothstep(0.9, 2.0, r));
  // Ядро: яркая точка там, куда летим.
  float core = exp(-r * r * 22.0);

  float v = (n * env * 1.5 + core * 0.55) * uPower;
  outColor = vec4(uColor * v, v);
}`;

// --- Аддитивный ореол (солнце, факелы двигателей) ---------------------------

export const GLOW_VS = `#version 300 es
in vec2 aQuad;           // [-1..1]^2

uniform mat4 uProj;
uniform vec3 uCenterView;
uniform float uRadiusPx;
uniform vec2 uViewport;

out vec2 vUv;
out float vFragDepth;

void main() {
  vec4 clip = uProj * vec4(uCenterView, 1.0);
  // Радиус задан в пикселях: переводим в clip-пространство.
  clip.xy += aQuad * uRadiusPx / (uViewport * 0.5) * clip.w;
  gl_Position = clip;
  vFragDepth = 1.0 + clip.w;
  vUv = aQuad;
}`;

export const GLOW_FS = `#version 300 es
precision mediump float;

in vec2 vUv;
in float vFragDepth;

uniform vec3 uColor;
uniform float uLogFC;
uniform float uIntensity;
// Насколько резко пятно спадает к краю. Ореолу звезды нужен мягкий
// хвост (2.5 и больше), а комку пыли — очерченный край: это предмет, а
// не свечение, и размытым он читается как грязь на стекле.
uniform float uFalloff;

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  float r = length(vUv);
  if (r > 1.0) discard;
  float a = pow(1.0 - r, uFalloff) * uIntensity;
  outColor = vec4(uColor * a, a);
}`;

// --- Атмосфера --------------------------------------------------------------
// Оболочка чуть больше планеты. Яркость — по касательности взгляда к
// поверхности (ореол на кромке) и по освещённости (дымка днём).

export const ATMO_VS = `#version 300 es
in vec3 aPos;

uniform mat4 uProj;
uniform mat4 uModelView;
uniform mat3 uNormalMat;

out vec3 vNormal;
out vec3 vViewPos;
out float vFragDepth;

void main() {
  vec4 vp = uModelView * vec4(aPos, 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  vViewPos = vp.xyz;
  vNormal = uNormalMat * aPos;     // сфера: нормаль совпадает с позицией
}`;

export const ATMO_FS = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vViewPos;
in float vFragDepth;

uniform vec3 uSunDir;
uniform vec3 uColor;
uniform float uLogFC;
uniform float uDensity;

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vViewPos);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);
  float lit = max(dot(n, uSunDir), 0.0);
  // Ночная сторона тоже слегка светится по кромке — иначе планета против
  // солнца выглядит вырезанной из фона.
  float a = rim * uDensity * (0.15 + 0.85 * lit);
  outColor = vec4(uColor * a, a);
}`;

// --- Плазма входа в атмосферу ------------------------------------------------
//
// Оболочка ударной волны: поверхность вращения вокруг вектора СКОРОСТИ
// (не носа — горит набегающий поток, и ему всё равно, как повёрнут
// корабль). Меш единичный, размер задают uRad и uLen: так одна и та же
// геометрия годится и для лёгкого свечения на входе, и для факела во
// весь экран.
//
// Рисуется аддитивно и по кромке (френель): яркими выходят края
// силуэта, а середина остаётся прозрачной — иначе оболочка закрыла бы
// собой корабль, ради которого всё и затевалось.

export const PLUME_VS = `#version 300 es
in vec3 aPos;            // xy — профиль сечения, z — вдоль оси, [-1..0]
in float aT;             // 0 у лобовой точки, 1 в хвосте следа

uniform mat4 uProj;
uniform mat4 uModelView;
uniform mat3 uNormalMat;
uniform float uRad;
uniform float uLen;

out float vT;
out float vAng;
out vec3 vNormal;
out vec3 vViewPos;
out float vFragDepth;

void main() {
  vec3 p = vec3(aPos.xy * uRad, aPos.z * uLen);
  vec4 vp = uModelView * vec4(p, 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  vViewPos = vp.xyz;
  // Нормаль поверхности вращения — радиальная; для свечения по кромке
  // этого приближения достаточно.
  vNormal = uNormalMat * normalize(vec3(aPos.xy, 0.18));
  vT = aT;
  vAng = atan(aPos.y, aPos.x);
}`;

export const PLUME_FS = `#version 300 es
precision mediump float;

in float vT;
in float vAng;
in vec3 vNormal;
in vec3 vViewPos;
in float vFragDepth;

uniform vec3 uColor;     // цвет по нагреву (js/game/entry.js)
uniform float uHeat;     // 0..1
uniform float uTime;     // с — только для дрожания
uniform float uNear;     // с какого расстояния оболочка проявляется
uniform float uLogFC;

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vViewPos);
  // Кромка: в профиль оболочка ярче, в лоб — прозрачнее.
  float rim = pow(1.0 - abs(dot(n, v)), 1.6);

  // Вдоль оси: лобовая точка раскалена, след тянется и гаснет.
  float head = exp(-vT * 5.0);
  float tail = exp(-vT * 1.6) * 0.55;
  float along = head + tail;

  // Дрожание: поток срывается лоскутами, и ровное свечение сразу
  // читается как стекло, а не как пламя.
  float flick = 0.78 + 0.22 * sin(vAng * 5.0 + vT * 14.0 - uTime * 11.0)
                     * sin(vAng * 2.0 - uTime * 7.0);

  // Вблизи камеры оболочка гасится. Это не украшение: в виде из
  // кокпита камера оказывается ВНУТРИ волны, и без затухания её
  // изнанка залила бы весь экран ровным светом. Так остаётся то, что и
  // должно быть видно из кабины, — зарево впереди.
  float near = smoothstep(uNear, uNear * 2.6, length(vViewPos));

  float a = rim * along * flick * near * uHeat;
  // В хвосте цвет уходит в красноту: газ остывает, отставая от корабля.
  vec3 col = mix(uColor, vec3(0.85, 0.16, 0.05), clamp(vT * 1.2, 0.0, 1.0));
  outColor = vec4(col * a, a);
}`;

// --- Кольца -----------------------------------------------------------------

export const RING_VS = `#version 300 es
in vec3 aPos;
in float aT;             // 0 у внутренней кромки, 1 у внешней

uniform mat4 uProj;
uniform mat4 uModelView;
uniform mat3 uNormalMat;

out float vT;
out vec3 vNormal;
out vec3 vViewPos;
out float vFragDepth;

void main() {
  vec4 vp = uModelView * vec4(aPos, 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  vViewPos = vp.xyz;
  vNormal = uNormalMat * vec3(0.0, 0.0, 1.0);   // нормаль плоскости колец
  vT = aT;
}`;

export const RING_FS = `#version 300 es
precision highp float;

in float vT;
in vec3 vNormal;
in vec3 vViewPos;
in float vFragDepth;

uniform vec3 uColor;
uniform vec3 uSunDir;
uniform float uLogFC;

out vec4 outColor;

// Щели Кассини «на глазок»: несколько полос прозрачности по радиусу.
float density(float t) {
  float d = 0.55 + 0.45 * sin(t * 34.0);
  d *= smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.92, t);
  d *= 1.0 - 0.7 * smoothstep(0.42, 0.46, t) * smoothstep(0.52, 0.48, t);
  return clamp(d, 0.0, 1.0);
}

void main() {
${LOG_DEPTH_FRAG}
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vViewPos);
  if (dot(n, v) < 0.0) n = -n;
  float lit = 0.25 + 0.75 * max(dot(n, uSunDir), 0.0);
  float a = density(vT) * 0.85;
  outColor = vec4(uColor * lit * a, a);
}`;
