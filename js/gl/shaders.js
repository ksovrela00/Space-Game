// Исходники шейдеров. Держим их строками в модуле: у проекта нет сборки,
// и отдельными файлами их пришлось бы догружать по сети.

import { DETAIL_GLSL, BAKE_DETAIL_GLSL } from './detail.js';
import { SKY_GLSL } from './nebula.js';

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
// Фары корабля: две лампы, всё в координатах КАМЕРЫ. uLampN = 0 —
// выключены, и весь блок пропускается одним сравнением.
uniform int uLampN;
uniform vec3 uLampPos[2];
uniform vec3 uLampDir[2];
uniform vec2 uLampCos[2];   // косинусы внутренней и внешней кромки пятна
uniform float uLampRange;   // км — дальше луч не достаёт
uniform float uLampPower;
uniform float uLogFC;
// Запечённая поверхность: нормаль в локальных осях (RGB) и тон (A).
// uSurfMode = 0 — текстуры нет (корабли, станции, светило).
uniform sampler2D uSurfTex;
uniform float uSurfMode;
${detail ? `
// Во сколько раз расширен след пикселя: ручка цены кадра, её ведёт
// регулятор в js/gl/detail.js. Единица — полная резкость.
uniform float uFwScale;
// За каким углом к солнцу мелкий рельеф считать незачем.
//
// Наклон нормали ограничен (см. ниже, pert при |pert| > 1.6), то есть
// не больше atan(1.6) = 58°. Значит за 148° от солнца ни один склон
// света уже не поймает, и от рельефа остаётся только подкраска
// впадин и валов — на поверхности, освещённой одним рассеянным светом
// (uAmbient = 0.14), это доли процента яркости кадра. Считать ради них
// двадцать вызовов шума на пиксель не стоит: над ночной стороной это
// весь экран.
const float NIGHT_SKIP = -0.85;
${DETAIL_GLSL}` : ''}

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
    // на него делится плавное появление деталей. Множитель не меньше
    // единицы — иначе не выставленный uniform (нуль) обнулил бы след.
    float fw = max(max(length(dFdx(dirL)), length(dFdy(dirL))), 1e-9)
             * max(uFwScale, 1.0);
    if ((uBakeFw <= 0.0 || fw < 2.0 * uBakeFw) && dot(n, uSunDir) > NIGHT_SKIP) {
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
      // Площадка города срезана до ровного: мелкого рельефа на ней нет
      // ни в геометрии, ни здесь. Иначе бетон перрона выглядел бы
      // каменистым — и это была бы единственная разница между тем, что
      // видно, и тем, на что садится корабль.
      dry *= 1.0 - dPlate(dirL);
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
  float lit = uAmbient + (1.0 - uAmbient) * lam;

  // Фары. Свет точечный и направленный: от лампы до точки считается
  // настоящее расстояние, дальше — конус и падение с дальностью.
  //
  // Падение НЕ обратный квадрат. По честному закону пятно на десяти
  // километрах слабее, чем на ста метрах, в десять тысяч раз — то есть
  // его нет вовсе. У фары есть заявленная дальность, и гаснуть луч
  // должен к ней, а не на первой сотне метров: это прожектор с отражателем,
  // а не голая лампочка.
  for (int i = 0; i < 2; i++) {
    if (i >= uLampN) break;
    vec3 d = vViewPos - uLampPos[i];
    float dist = length(d);
    if (dist > uLampRange) continue;
    vec3 L = d / dist;
    float c = dot(L, uLampDir[i]);
    if (c <= uLampCos[i].y) continue;
    float cone = smoothstep(uLampCos[i].y, uLampCos[i].x, c);
    float fall = 1.0 - dist / uLampRange;
    lit += uLampPower * cone * fall * fall * max(dot(n, -L), 0.0);
  }
  // Потолок: два луча, сошедшиеся в упор на светлой обшивке, иначе
  // выжигают кадр в белое.
  lit = min(lit, 1.45);

  float shade = mix(lit, 1.0, vColor.a);
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

  // Площадка города: там поверхность ровная, и в текстуру обязана
  // попасть ровной. Правится и наклон, и подкраска валов — иначе на
  // перроне остались бы тени от срезанных кратеров.
  float pw = dPlate(dir);
  if (pw > 0.0) { g *= 1.0 - pw; cr *= 1.0 - pw; }

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

// --- Небо: полоса диска и туманности ----------------------------------------
//
// Считается один раз в кубическую карту (js/gl/nebula.js объясняет,
// почему именно так), а в кадре остаётся одна выборка на пиксель.

export const SKY_BAKE_VS = `#version 300 es
in vec2 aQuad;
out vec2 vSt;
void main() {
  gl_Position = vec4(aQuad, 0.0, 1.0);
  vSt = aQuad;                     // [-1, 1] по обеим осям
}`;

export const SKY_BAKE_FS = `#version 300 es
precision highp float;

in vec2 vSt;

// Оси запекаемой грани куба (js/gl/bake.js, CUBE_FACES). Порядок тот же,
// в каком грань выбирает оборудование при выборке по направлению, —
// иначе небо окажется сшитым наизнанку.
uniform vec3 uFaceF;
uniform vec3 uFaceU;
uniform vec3 uFaceV;
${SKY_GLSL}

out vec4 outColor;

void main() {
  outColor = vec4(skyColor(normalize(uFaceF + uFaceU * vSt.x + uFaceV * vSt.y)), 1.0);
}`;

export const SKY_VS = `#version 300 es
in vec2 aQuad;

uniform mat3 uView;      // мир -> камера, только поворот (как у звёзд)
uniform vec2 uScale;     // tan(fov/2) с учётом формата кадра

out vec3 vRay;

void main() {
  gl_Position = vec4(aQuad, 0.0, 1.0);
  // Луч через пиксель. До нормировки он ЛИНЕЕН по экранным
  // координатам, поэтому интерполяция по треугольнику даёт ровно то же,
  // что полный расчёт на каждый пиксель, — но бесплатно.
  //
  // Умножение вектора СЛЕВА на матрицу — это умножение на
  // транспонированную, то есть поворот из камеры обратно в мир. Матрица
  // ортонормирована, обращать её больше нечем и незачем.
  vRay = vec3(aQuad * uScale, 1.0) * uView;
}`;

export const SKY_FS = `#version 300 es
precision highp float;

in vec3 vRay;
uniform samplerCube uSky;

out vec4 outColor;

void main() {
  vec3 c = texture(uSky, normalize(vRay)).rgb;
  // Небо тёмное и очень плавное, а текстура восьмибитная: без подмеса
  // шума в полградуса яркости по нему пошли бы ступеньки кольцами —
  // на градиентах у самой границы видимого это первое, что заметно.
  float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  outColor = vec4(c + (d - 0.5) / 255.0, 1.0);
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

// --- Варп-тоннель ------------------------------------------------------------
//
// Тот же приём, что и у квантового тоннеля (волокна текут от точки схода,
// координата вдоль потока — логарифм радиуса), но с тремя добавками,
// каждая из которых делает своё дело.
//
// 1. ЗАКРУТКА. Угол сдвигается на log(r): прямая трубка превращается в
//    воронку. У квантового тоннеля этого нет намеренно — там ход короткий
//    и прямой, а здесь лететь полминуты, и прямые волокна успевают
//    надоесть.
//
// 2. ПРИЗМА. Красный, зелёный и синий снимаются с РАЗНЫМ сдвигом по
//    потоку, и сдвиг растёт к краю кадра. Это то самое расслоение света,
//    из-за которого края тоннеля отливают спектром, а середина остаётся
//    чистой. Дешевле некуда: три выборки вместо одной.
//
// 3. ПЕРЕХОД ЦВЕТА. Тоннель окрашен не «в фиолетовый», а в цвет звезды,
//    ОТКУДА летим, и к концу перекрашивается в цвет звезды, КУДА летим.
//    Прилетая к красному карлику, последние секунды летишь в оранжевом, а
//    выходя — видишь ровно тот же оранжевый уже снаружи. Это единственная
//    часть эффекта, которая что-то сообщает, а не украшает.
//
// ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Первая версия добавляла к этому радугу по углу
// и закрутку в 0.85 — полный оборот на каждый e-кратный радиус. Вместе они
// давали не тоннель, а цветной смерч: кадр рябил всеми цветами сразу, а
// стены закручивались быстрее, чем убегали назад. Радуга убрана целиком,
// закрутка уменьшена в двенадцать раз. Цвет в кадре ровно один — звёздный,
// и разница между каналами остаётся только от расслоения (пункт 2).

export const WARPTUN_VS = `#version 300 es
in vec2 aQuad;
out vec2 vUv;
void main() {
  gl_Position = vec4(aQuad, 0.0, 1.0);
  vUv = aQuad;
}`;

export const WARPTUN_FS = `#version 300 es
precision highp float;

in vec2 vUv;

uniform vec2 uCenter;
uniform float uAspect;
uniform float uTime;     // секунды от начала прыжка, МОНОТОННО
uniform float uPower;    // 0..1 — насколько раскрыт тоннель
uniform vec3 uFrom;      // цвет звезды, откуда летим
uniform vec3 uTo;        // цвет звезды, куда
uniform float uMix;      // 0..1 — доля пройденного пути

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

// Шум, ЗАМКНУТЫЙ по кругу: решётка по x берётся по модулю периода.
//
// Без этого на луче ±π через весь кадр идёт шов. Целых гармоник для
// замыкания НЕ ДОСТАТОЧНО, хотя кажется, что достаточно: угол там
// разрывается ровно на оборот, координата шума — ровно на целое число
// ячеек, и выборка попадает в ДРУГУЮ ячейку решётки с другим хешем.
// Замер JS-двойником: разрыв доходил до 0.60 при размахе шума в единицу.
// Замыкание индекса по модулю делает обе стороны разрыва одной и той же
// ячейкой, и шов пропадает точно, а не на глаз.
float vnoiseW(vec2 p, float period) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, period);
  float x1 = mod(i.x + 1.0, period);
  float a = hash21(vec2(x0, i.y)), b = hash21(vec2(x1, i.y));
  float c = hash21(vec2(x0, i.y + 1.0)), d = hash21(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Волокно: две октавы поперёк потока. Порог срезает низ — без него это
// ровный шум, а нужны жгуты с темнотой между ними. Угол приходит В
// ОБОРОТАХ (turn = угол / 2π), число волокон задаётся целыми гармониками,
// и по ним же замыкается решётка шума.
float fibre(float turn, float flow, float h1, float h2) {
  float n = vnoiseW(vec2(turn * h1, flow), h1) * 0.66
          + vnoiseW(vec2(turn * h2 + 7.0, flow * 2.1 + 11.0), h2) * 0.34;
  return pow(max(0.0, n - 0.40) / 0.60, 2.0);
}

void main() {
  vec2 p = (vUv - uCenter) * vec2(uAspect, 1.0);
  float r = max(length(p), 1.0e-4);
  float ang = atan(p.y, p.x);
  float lr = log(r);

  // Сколько волокон по кругу. Только целые: см. fibre().
  const float H1 = 30.0, H1B = 69.0;     // ближний слой и его вторая октава
  const float H2 = 13.0, H2B = 30.0;     // дальний

  // Закрутка едва заметная. В первой версии стояло 0.85 — полный оборот
  // на каждый e-кратный радиус, — и тоннель читался не как коридор, а как
  // воронка смерча: стены закручивались быстрее, чем убегали назад.
  // Угол в оборотах: разрыв на луче ±π становится ровно единицей, и
  // целые гармоники его не видят.
  float turn = (ang + lr * 0.07) / 6.2831853;

  // Расслоение по каналам: у краёв кадра каналы снимаются с чуть разным
  // сдвигом вдоль потока, и жгут отливает по кромке. Величина маленькая
  // намеренно — это подцветка края, а не радуга.
  float disp = 0.03 + 0.10 * smoothstep(0.15, 1.2, r);

  float f1 = lr * 2.4 - uTime * 2.2;
  vec3 near = vec3(fibre(turn, f1 + disp, H1, H1B),
                   fibre(turn, f1, H1, H1B),
                   fibre(turn, f1 - disp, H1, H1B));

  // Второй слой медленнее и крупнее: без него поток плоский, с ним
  // появляется глубина — дальние стены отстают от ближних.
  float f2 = lr * 1.25 - uTime * 1.0;
  vec3 far = vec3(fibre(turn, f2 + disp * 1.4, H2, H2B),
                  fibre(turn, f2, H2, H2B),
                  fibre(turn, f2 - disp * 1.4, H2, H2B));

  // Кольца ударной волны бегут наружу: по ним читается скорость, у
  // волокон её не видно — они самоподобны вдоль потока.
  float ring = pow(max(0.0, sin(lr * 4.0 - uTime * 2.6)), 20.0);

  float core = exp(-r * r * 9.0);
  float env = smoothstep(0.02, 0.42, r) * (1.0 - smoothstep(1.05, 2.4, r));

  // Цвет ОДИН на весь кадр — свет той звезды, к которой летим. Радуги по
  // углу здесь была ошибка: тоннель рябил всеми цветами сразу и смотреть
  // на него дольше секунды было нельзя. Разница между каналами осталась
  // только та, что даёт расслоение выше, и её ровно столько, чтобы
  // кромка жгута не была серой.
  vec3 tint = mix(uFrom, uTo, smoothstep(0.12, 0.88, uMix));

  vec3 v = (near * 1.05 + far * 0.55) * env + ring * 0.22 * env;
  v = v * uPower + core * (0.45 * uPower);
  float i = clamp(max(max(v.r, v.g), v.b), 0.0, 1.0);
  outColor = vec4(tint * v, i);
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

out vec3 vViewPos;
out float vFragDepth;

void main() {
  vec4 vp = uModelView * vec4(aPos, 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  // Дальше нужен только ЛУЧ через этот пиксель: оболочка здесь не
  // поверхность, а объём, внутри которого считается воздух.
  vViewPos = vp.xyz;
}`;

// Атмосфера — это ВОЗДУХ ВДОЛЬ ЛУЧА, а не светящаяся плёнка на шаре.
//
// Что было сломано. Оболочка рисовалась свечением по кромке: яркость
// бралась от угла между нормалью сферы и взглядом. У такой плёнки есть
// КРАЙ — ровно там, где кончается меш, — и на подлёте он читался как
// прямая граница поперёк кадра: по одну сторону чёрный космос, по
// другую сразу дневное небо. Никакого перехода не было, потому что
// переходить было нечему: плотность воздуха в картинке не участвовала
// вовсе.
//
// Теперь шейдер берёт отрезок луча внутри атмосферы и складывает вдоль
// него плотность по той же барометрической формуле, по которой считается
// нагрев обшивки (js/game/entry.js, airDensity). Отсюда всё нужное
// получается само:
//
//   * у самого верха воздуха почти нет, и небо там чёрное, как в
//     космосе, — граница исчезает, потому что её нет в природе;
//   * к горизонту луч идёт вдоль слоёв и набирает в полтора десятка раз
//     больше воздуха, чем вверх, — отсюда яркая дуга у кромки;
//   * при снижении столб растёт по экспоненте, и небо наливается
//     плавно;
//   * луч, упирающийся в грунт, обрывается на нём: за поверхностью
//     воздуха не видно.
export const ATMO_FS = `#version 300 es
precision highp float;

in vec3 vViewPos;
in float vFragDepth;

uniform vec3 uSunDir;    // направление НА солнце в осях камеры
uniform vec3 uColor;
uniform float uLogFC;
uniform vec3 uCenter;    // центр тела в осях камеры, км
uniform float uGround;   // СРЕДНИЙ радиус тела, км — от него считается плотность
uniform float uFloor;    // радиус грунта ПОД КАМЕРОЙ, км — на нём обрывается луч
uniform float uTop;      // радиус верха атмосферы, км
uniform float uScaleH;   // шкала высоты, км
uniform float uThick;    // оптическая толщина столба вертикально вверх
uniform float uGlow;     // во сколько раз свечение «быстрее» гашения

// Шагов интегрирования. Плотность падает в 150 раз на отрезке, и у
// горизонта почти весь вклад собран у нижней точки луча — на восьми
// шагах эта точка проскакивает между отсчётами, и по кромке идёт
// ступенчатая рябь. Шестнадцать её убирают, а стоят они по нынешним
// меркам кадра пустяк: одна экспонента на шаг.
const int STEPS = 16;
// На сколько сфера грунта опускается ниже камеры, когда та оказалась
// под ней. Запас не косметический: координаты здесь float32, и у
// величин порядка 1.8·10⁷ км² (квадрат радиуса) точность около двух
// км². Зажим ВПРИТЫК иногда давал бы отрицательный корень, луч уходил
// бы сквозь планету, и кадр заливало бы молоком — через раз.
//
// Запас АБСОЛЮТНЫЙ, два метра, а не доля радиуса. Доля выходит боком:
// 10⁻⁵ от 4200 км — это 42 м, то есть больше самой высоты полёта у
// земли. Такой зажим опускал землю под ногами ниже, чем она есть, и
// близкий грунт снова тонул в дымке.
const float ATMO_EPS = 0.002;

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  vec3 d = normalize(vViewPos);
  float b = dot(d, uCenter);
  float cc = dot(uCenter, uCenter);

  // Отрезок внутри верхней сферы. Начало не раньше камеры: внутри
  // атмосферы ближний корень отрицательный, и луч начинается от глаза.
  float disc = b * b - (cc - uTop * uTop);
  if (disc <= 0.0) discard;
  float sq = sqrt(disc);
  float t0 = max(b - sq, 0.0);
  float t1 = b + sq;

  // Грунт обрывает луч — и обрывает его по ЗЕМЛЕ ПОД КАМЕРОЙ, а не по
  // средней сфере тела.
  //
  // Разница не мелочь. Рельеф отходит от средней сферы на километры в
  // обе стороны. Стоя на возвышенности всего в сотню метров над средней
  // сферой, луч вбок уходит до неё за ТРИДЦАТЬ километров плотного
  // воздуха — и близкая земля прямо перед носом оказывается за дымкой в
  // треть яркости. Это и видно как туман на десяти метрах высоты. По
  // грунту под камерой тот же луч обрывается там, где земля и есть.
  //
  // Сфера дополнительно опускается до камеры, если та оказалась ниже:
  // дно океана на Lave II лежит на 12 км ниже средней сферы, и без
  // этого луч вниз не находил грунта вовсе (оба корня отрицательные) и
  // складывал воздух через всю планету — кадр заливало молоком, хотя до
  // земли метры. Замер там: столб в надир 58 против 0.01.
  float ground = min(uFloor, sqrt(cc) - ATMO_EPS);
  // Сравнение НЕ строгое: у самой поверхности корень равен нулю, и при
  // строгом сравнении та же беда возвращается ровно на посадке.
  float discG = b * b - (cc - ground * ground);
  if (discG > 0.0) {
    float tg = b - sqrt(discG);
    if (tg >= 0.0) t1 = min(t1, tg);
  }
  if (t1 <= t0) discard;

  float dt = (t1 - t0) / float(STEPS);
  float sum = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float alt = length(d * (t0 + (float(i) + 0.5) * dt) - uCenter) - uGround;
    sum += exp(-max(alt, 0.0) / uScaleH);
  }
  // Столб в долях вертикального: вертикальный от поверхности равен
  // одной шкале высоты.
  float tau = uThick * sum * dt / uScaleH;

  // ГАШЕНИЕ и СВЕЧЕНИЕ — разные числа, и это главное во всём шейдере.
  //
  // Небо голубое не потому, что воздух непрозрачный, а потому, что он
  // САМ СВЕТИТСЯ рассеянным солнечным светом. Настоящий воздух почти
  // прозрачен: вертикально он съедает пятую часть света — ночью сквозь
  // него видны звёзды, с орбиты видно грунт. Если связать яркость с
  // непрозрачностью одним числом, придётся выбирать между молочной
  // планетой с орбиты и чёрным небом с земли; ровно это и вышло, когда
  // толщину подняли ради неба у грунта.
  float occl = 1.0 - exp(-tau);
  float glow = 1.0 - exp(-tau * uGlow);

  // Освещённость берём в САМОЙ ПЛОТНОЙ точке отрезка — ближайшей к
  // центру тела. Там же собран почти весь воздух, поэтому его цвет и
  // решает, а на терминаторе граница выходит мягкой сама.
  vec3 up = normalize(d * clamp(b, t0, t1) - uCenter);
  float lit = smoothstep(-0.35, 0.25, dot(up, uSunDir));
  // Ночью воздух не светится вовсе — и правильно: ночное небо чёрное, и
  // звёзды сквозь него видны. Остаётся только гашение.
  outColor = vec4(uColor * glow * lit, occl);
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

// Оболочка ударной волны строится ПО КОРПУСУ (js/gl/mesh.js,
// buildShockMesh), а не телом вращения вокруг вектора скорости. Здесь
// она доводится под текущий поток: отходит от лобовых поверхностей и
// вытягивается в след за кормой.
export const PLUME_VS = `#version 300 es
in vec3 aPos;            // оболочка вокруг корпуса, оси корабля
in vec3 aNormal;

uniform mat4 uProj;
uniform mat4 uModelView;
uniform mat3 uNormalMat;
uniform vec3 uFlow;      // куда летим, в осях КОРАБЛЯ (единичный)
uniform float uStand;    // добавка отхода на лобовых поверхностях, км
uniform float uTail;     // насколько вытягивается след, км
uniform float uSpan;     // половина длины корпуса, км

out float vW;
out float vTail;
out float vAng;
out vec3 vNormal;
out vec3 vViewPos;
out float vFragDepth;

void main() {
  // Наветренность: единица там, где поверхность смотрит в поток, ноль в
  // аэродинамической тени тела. От неё зависит и отход волны, и яркость
  // — при развороте раскаляется тот борт, который подставлен потоку, и
  // это видно без единого дополнительного правила.
  float w = max(0.0, dot(aNormal, uFlow));
  vec3 p = aPos + aNormal * (uStand * w);
  // След: корма вытягивается назад по потоку. Квадрат — чтобы тянулась
  // именно корма, а не весь корпус разом.
  float back = max(0.0, -dot(aPos, uFlow)) / max(uSpan, 1e-6);
  float s = min(back * back, 1.0);
  p -= uFlow * (uTail * s);

  vec4 vp = uModelView * vec4(p, 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  vViewPos = vp.xyz;
  vNormal = uNormalMat * aNormal;
  vW = w;
  vTail = s;
  vAng = atan(aPos.y, aPos.x);
}`;

export const PLUME_FS = `#version 300 es
precision mediump float;

in float vW;             // наветренность 0..1
in float vTail;          // 0 у корпуса, 1 в конце следа
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
  // Кромка: в профиль оболочка ярче, в лоб — прозрачнее. Именно это
  // делает её оболочкой, а не заливкой поверх корабля.
  float rim = pow(1.0 - abs(dot(n, v)), 1.4);

  // Раскалено там, где поток упирается в тело; в тени корпуса остаётся
  // зарево, а в следе всё гаснет.
  float along = mix(0.22, 1.0, vW) * exp(-vTail * 2.4);

  // Дрожание: поток срывается лоскутами, и ровное свечение сразу
  // читается как стекло, а не как пламя.
  float flick = 0.78 + 0.22 * sin(vAng * 5.0 + vTail * 14.0 - uTime * 11.0)
                     * sin(vAng * 2.0 - uTime * 7.0);

  // Вблизи камеры оболочка гасится. Это не украшение: в виде из
  // кокпита камера оказывается ВНУТРИ волны, и без затухания её
  // изнанка залила бы весь экран ровным светом. Так остаётся то, что и
  // должно быть видно из кабины, — зарево впереди.
  float near = smoothstep(uNear, uNear * 2.6, length(vViewPos));

  float a = rim * along * flick * near * uHeat;
  // В хвосте цвет уходит в красноту: газ остывает, отставая от корабля.
  vec3 col = mix(uColor, vec3(0.85, 0.16, 0.05), clamp(vTail * 1.4, 0.0, 1.0));
  outColor = vec4(col * a, a);
}`;

// --- Щит --------------------------------------------------------------------
// Оболочки не видно, пока по ней не попали. Это и есть весь её вид:
// постоянное свечение вокруг корабля превратило бы бой в дискотеку, а
// разглядеть в нём что-либо стало бы нельзя.

export const SHIELD_VS = `#version 300 es
in vec3 aPos;            // единичная сфера

uniform mat4 uProj;
uniform mat4 uModelView; // оси КОРАБЛЯ, без масштаба
uniform mat3 uNormalMat;
uniform vec3 uScale;     // полуоси оболочки, км

out vec3 vN;             // нормаль в осях КАМЕРЫ
out vec3 vUnit;          // тот же aPos: по нему ищется точка удара
out vec3 vViewPos;
out float vFragDepth;

void main() {
  vec4 vp = uModelView * vec4(aPos * uScale, 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  vViewPos = vp.xyz;
  // Нормаль ЭЛЛИПСОИДА — это не его радиус: у сплюснутой оболочки они
  // расходятся тем сильнее, чем сильнее сплюснута. Делением на полуоси
  // получается именно нормаль, и кромка ложится по форме, а не по шару.
  vN = uNormalMat * (aPos / uScale);
  vUnit = aPos;
}`;

export const SHIELD_FS = `#version 300 es
precision mediump float;

in vec3 vN;
in vec3 vUnit;
in vec3 vViewPos;
in float vFragDepth;

uniform vec3 uHitDir;    // направление на точку удара, оси КОРАБЛЯ
uniform vec3 uColor;
uniform float uFade;     // 1 в момент попадания, 0 когда погасла
uniform float uLogFC;

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  vec3 n = normalize(vN);
  vec3 v = normalize(-vViewPos);

  // Кромка: в профиль оболочка видна, в лоб почти прозрачна. Без этого
  // получается не оболочка, а заливка поверх корабля.
  float rim = pow(1.0 - abs(dot(n, v)), 2.2);

  // Пятно в точке удара: туда пришёл луч, и оболочка там раскалена.
  // Считается по ПАРАМЕТРУ сферы, а не по нормали: на сплюснутой
  // оболочке нормаль уводит пятно с места удара тем сильнее, чем
  // площе борт. Степень большая намеренно — пятно должно быть пятном,
  // а не половиной оболочки.
  float spot = pow(max(0.0, dot(normalize(vUnit), uHitDir)), 22.0);

  // Слабая ровная подсветка — чтобы сфера читалась целиком, а не одной
  // только кромкой: иначе в момент попадания видно кольцо непонятно чего.
  float a = (0.05 + rim * 0.30 + spot * 1.6) * uFade;
  vec3 col = mix(uColor, vec3(1.0), clamp(spot * 0.8, 0.0, 1.0));
  outColor = vec4(col * a, a);
}`;

// --- Болты ------------------------------------------------------------------
// Короткий раскалённый шнур: белое ядро, цветная кромка. Геометрию
// (четырёхугольник, развёрнутый к камере) считает процессор — болтов
// десятки, а не тысячи, и шейдеру проще получить готовые точки.

export const BOLT_VS = `#version 300 es
in vec3 aPos;            // относительно КАМЕРЫ, мировые оси
in vec2 aUv;             // x: поперёк (-1..1), y: вдоль (0 хвост, 1 голова)
in vec3 aColor;

uniform mat4 uProj;
uniform mat4 uModelView;

out vec2 vUv;
out vec3 vColor;
out float vFragDepth;

void main() {
  vec4 vp = uModelView * vec4(aPos, 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  vUv = aUv;
  vColor = aColor;
}`;

export const BOLT_FS = `#version 300 es
precision mediump float;

in vec2 vUv;
in vec3 vColor;
in float vFragDepth;

uniform float uLogFC;

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  // Поперёк — мягкий спад к краям, вдоль — голова ярче хвоста. Ровная
  // по всей длине палка читается как нарисованная линия, а не как
  // летящий сгусток.
  float across = max(0.0, 1.0 - abs(vUv.x));
  float head = mix(0.25, 1.0, clamp(vUv.y, 0.0, 1.0));
  float a = pow(across, 1.6) * head;
  // Ядро выбелено: раскалённое светится белым, а цвет виден по кромке.
  vec3 col = mix(vColor, vec3(1.0), pow(across, 4.0) * 0.85);
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
