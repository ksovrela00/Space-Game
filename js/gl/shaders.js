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

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  float r = length(vUv);
  if (r > 1.0) discard;
  // Мягкое спадание к краю: ядро ярче, ореол уходит в ноль.
  float a = pow(1.0 - r, 2.5) * uIntensity;
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
