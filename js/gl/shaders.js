// Исходники шейдеров. Держим их строками в модуле: у проекта нет сборки,
// и отдельными файлами их пришлось бы догружать по сети.

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

uniform mat4 uProj;
uniform mat4 uModelView;
uniform mat3 uNormalMat;

out vec3 vNormal;
out vec3 vViewPos;
out vec4 vColor;
out float vFragDepth;

void main() {
  vec4 vp = uModelView * vec4(aPos, 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  vViewPos = vp.xyz;
  vNormal = uNormalMat * aNormal;
  vColor = aColor;
}`;

export const MESH_FS = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vViewPos;
in vec4 vColor;
in float vFragDepth;

uniform vec3 uSunDir;    // направление НА солнце в координатах камеры
uniform float uAmbient;
uniform float uLogFC;

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  vec3 n = normalize(vNormal);
  // Двустороннее освещение: нормаль всегда разворачиваем к камере. Так
  // корректно светятся «двусторонние» грани (тоннель порта станции), и
  // не нужно следить за порядком обхода вершин при сборке мешей.
  if (dot(n, normalize(vViewPos)) > 0.0) n = -n;

  float lam = max(dot(n, uSunDir), 0.0);
  float shade = mix(uAmbient + (1.0 - uAmbient) * lam, 1.0, vColor.a);
  outColor = vec4(vColor.rgb * shade, 1.0);
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
