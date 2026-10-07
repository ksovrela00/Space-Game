// Исходники шейдеров. Держим их строками в модуле: у проекта нет сборки,
// и отдельными файлами их пришлось бы догружать по сети.

import { DETAIL_GLSL, BAKE_DETAIL_GLSL } from './detail.js';
import { GRAIN_GLSL } from './ground.js';
import { WASH_GLSL } from './wash.js';
import { HULL_GLSL } from './hull.js';
import { MAT } from '../models/hulldetail.js';
import { SHADE_GLSL } from './citymesh.js';
import { SKY_GLSL } from './nebula.js';
import { SHIP_SHADOW_GLSL } from './shipshadow.js';
import { WATER_GLSL } from './water.js';
import { STATION_GLSL, STMAT_BASE } from './stationtex.js';

// Глубина пишется логарифмически (см. mat4.js): иначе на диапазоне от
// метров до миллионов километров начинается z-fighting.
const LOG_DEPTH_FRAG = `
  gl_FragDepth = log2(vFragDepth) * uLogFC * 0.5;
`;

// --- Воздух вдоль луча ------------------------------------------------------
//
// Один и тот же интеграл считается в ДВУХ шейдерах — в грунте (MESH_FS)
// и в оболочке неба (ATMO_FS), — и это не дублирование, а
// единственный способ обойтись без буфера глубины.
//
// ЧТО БЫЛО СЛОМАНО. Дымку считала одна оболочка на весь кадр, поверх
// уже нарисованной земли и без проверки глубины. Такой оболочке
// неоткуда узнать, далеко ли под лучом земля, и она угадывала её
// СФЕРОЙ — той, что под камерой. У мира с горами эта сфера у горизонта
// оказывается выше настоящей земли на километры: луч, честно уходящий
// над равниной в космос, обрывался о несуществующий грунт за сотню
// километров и набирал впятеро меньше воздуха, чем сосед на полградуса
// выше. По всему горизонту шла тёмная полоса с резкой кромкой, сквозь
// которую просвечивал космос.
//
// Никакой сферой это не чинится, и это было проверено числами: любая
// сфера даёт полосу шириной от полуградуса до пяти — либо она выше
// земли (полоса), либо ниже (дальний грунт тонет в молоке). Разница
// между «землёй под камерой» и «самой низкой землёй тела» на этом мире
// — десятки километров, и внутри этой вилки сфера ничего не знает.
//
// ЧТО ТЕПЕРЬ. Каждый пиксель считает воздух до ТОЙ ТОЧКИ, КОТОРУЮ ОН
// САМ ПОКАЗЫВАЕТ:
//
//   * грунт знает расстояние до себя точно — это его собственный
//     фрагмент, и никаких догадок о рельефе не нужно вовсе;
//   * небу догадываться не о чем: там земли нет, и луч идёт до верха
//     атмосферы. Пиксели неба отделяются от пикселей земли проверкой
//     глубины, а не сферой.
//
// Снаружи атмосферы всё остаётся как было: там в кадре вся полусфера
// сразу, луч обрывается о среднюю сферу тела, и это лучшее, что можно
// сказать про рельеф с такого расстояния.
export const AIR_GLSL = `
// uAir.w = 0 — воздуха нет, и весь блок пропускается одним сравнением.
uniform vec3 uAirCenter;   // центр тела в осях камеры, км
uniform vec4 uAir;         // (средний радиус, верх атмосферы, шкала высоты, толщина)
uniform vec3 uAirColor;
uniform float uAirGlow;    // во сколько раз свечение «быстрее» гашения
// Шагов интегрирования. Плотность падает в 150 раз на отрезке, и у
// горизонта почти весь вклад собран у нижней точки луча — на восьми
// шагах эта точка проскакивает между отсчётами, и по кромке идёт
// ступенчатая рябь. Шестнадцать её убирают, а стоят они по нынешним
// меркам кадра пустяк: одна экспонента на шаг.
const int AIR_STEPS = 16;

vec4 airAlong(vec3 d, float t0, float t1, vec3 sunDir) {
  if (uAir.w <= 0.0) return vec4(0.0);
  float b = dot(d, uAirCenter);
  // Дальше верха атмосферы воздуха нет, и очень далёкая точка обрезается
  // по выходу из неё: у луны расстояние в миллионы километров, и
  // шестнадцать отсчётов легли бы мимо всего воздуха разом.
  //
  // Только ДАЛЬШЕ верха — и это не экономия. Луч до грунта короче
  // атмосферы всегда, и трогать его нельзя: на грунте эта же обрезка
  // один раз уже превратила весь кадр в ровную синеву.
  if (t1 > uAir.y) {
    float disc = b * b - (dot(uAirCenter, uAirCenter) - uAir.y * uAir.y);
    if (disc <= 0.0) return vec4(0.0);
    t1 = min(t1, b + sqrt(disc));
  }
  if (t1 <= t0) return vec4(0.0);
  float dt = (t1 - t0) / float(AIR_STEPS);
  float sum = 0.0;
  for (int i = 0; i < AIR_STEPS; i++) {
    float alt = length(d * (t0 + (float(i) + 0.5) * dt) - uAirCenter) - uAir.x;
    sum += exp(-max(alt, 0.0) / uAir.z);
  }
  // Столб в долях вертикального: вертикальный от поверхности равен
  // одной шкале высоты.
  float tau = uAir.w * sum * dt / uAir.z;

  // ГАШЕНИЕ и СВЕЧЕНИЕ — разные числа, и это главное во всём куске.
  //
  // Небо голубое не потому, что воздух непрозрачный, а потому, что он
  // САМ СВЕТИТСЯ рассеянным солнечным светом. Настоящий воздух почти
  // прозрачен: вертикально он съедает пятую часть света — ночью сквозь
  // него видны звёзды, с орбиты видно грунт. Если связать яркость с
  // непрозрачностью одним числом, придётся выбирать между молочной
  // планетой с орбиты и чёрным небом с земли; ровно это и вышло, когда
  // толщину подняли ради неба у грунта.
  float occl = 1.0 - exp(-tau);
  float glow = 1.0 - exp(-tau * uAirGlow);

  // Освещённость берём в САМОЙ ПЛОТНОЙ точке отрезка — ближайшей к
  // центру тела. Там же собран почти весь воздух, поэтому его цвет и
  // решает, а на терминаторе граница выходит мягкой сама.
  vec3 up = normalize(d * clamp(b, t0, t1) - uAirCenter);
  float lit = smoothstep(-0.35, 0.25, dot(up, sunDir));
  // Ночью воздух не светится вовсе — и правильно: ночное небо чёрное, и
  // звёзды сквозь него видны. Остаётся только гашение.
  return vec4(uAirColor * glow * lit, occl);
}
`;

// --- Меши: корабли, станции, планеты ---------------------------------------
// Плоское затенение у кораблей и гладкое у планет — это одна и та же
// программа, разница только в том, что лежит в нормалях вершин.

export const MESH_VS = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec4 aColor;          // rgb + флаг «сам светится» в альфе
in vec2 aUv;             // у плиток: координата в их запечённой текстуре
in vec2 aGrain;          // у грунта: координата фотографии (js/gl/ground.js)
// У корпуса корабля: материал грани (js/gl/hull.js). У всех остальных
// сеток атрибута нет, и видеокарта подставляет ноль — «обычная грань».
in float aMat;

uniform mat4 uProj;
uniform mat4 uModelView;
uniform mat3 uNormalMat;
// Начало отсчёта вершин в осях модели. У плиток грунта и камней вершины
// лежат от середины плитки (поля), а не от центра тела: так их положение
// точно во float32 (js/gl/tilegeo.js). Мелкому рельефу нужна позиция от
// центра тела — её и собирает vLocal. У остальных сеток — нуль.
uniform vec3 uLocalShift;
// Струя движков: гнёт растения (js/gl/wash.js). Включена только на
// поле растительности, у остальных uWashOn = 0.
${WASH_GLSL}

out vec3 vNormal;
out vec3 vViewPos;
out vec4 vColor;
out float vFragDepth;
out vec3 vLocal;         // позиция в локальных осях тела — для мелкого рельефа
out vec2 vUv;
out vec2 vGrain;
out float vMat;
out vec3 vNormalL;       // нормаль в осях модели — обшивке корабля

void main() {
  vec3 pos = aPos;
  vec3 nrm = aNormal;
  if (uWashOn > 0.5 && aBend.y > 0.0) pos = washBend(pos, nrm);
  vec4 vp = uModelView * vec4(pos, 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  vViewPos = vp.xyz;
  vNormal = uNormalMat * nrm;
  vColor = aColor;
  vLocal = pos + uLocalShift;
  vUv = aUv;
  vGrain = aGrain;
  vMat = aMat;
  vNormalL = nrm;
}`;

// --- Дальний лес (js/gl/forest.js) -----------------------------------------------
//
// Дерево вдали — силуэт по профилю своей породы, один экземпляр на
// дерево, один вызов на кусок леса. Фрагментный шейдер — общий у сеток
// (MESH_FS): освещение, фары и дымка воздуха те же, что у всего
// остального, и дальний лес не выпадает из кадра ни цветом, ни туманом.
export const FOREST_VS = `#version 300 es
in vec4 aP;       // угол вершины, кольцо (0..3), угол середины грани, пояс (0..2)
in vec4 aTree;    // место от начала куска (км) и рост (км)
in vec4 aLook;    // цвет полога и номер породы
in vec4 aMisc;    // ранг, класс подрешётки, разворот, запас

uniform mat4 uProj;
uniform mat4 uModelView;
uniform mat3 uNormalMat;
uniform vec3 uUp;         // местная вертикаль куска, оси тела
uniform vec3 uT;          // касательные оси куска
uniform vec3 uB;
uniform vec4 uProf[8];    // профили пород: низ кроны, радиус там, самое широкое место, радиус там
uniform float uTrunk;     // радиус ствола, доля роста
uniform vec4 uNear;       // середина поля растений от начала куска и его радиус, км
uniform float uNearOn;    // поле растений на этой грани есть
uniform vec3 uCamL;       // камера от начала куска, км
uniform vec4 uLod;        // (первое прореживание, второе, ширина перехода, дальность), км

out vec3 vNormal;
out vec3 vViewPos;
out vec4 vColor;
out float vFragDepth;
out vec3 vLocal;
out vec2 vUv;
out vec2 vGrain;
out float vMat;
out vec3 vNormalL;

float fSmooth(float t) { t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }

void main() {
  vec3 base = aTree.xyz;
  float H = aTree.w;

  // Кто рисует это дерево: поле у корабля или дальний лес. Поле берёт его,
  // если ранг не больше редения к своему краю (js/gl/flora.js,
  // scatterFlora), — значит здесь ровно обратное условие.
  float keep = 1.0;
  if (uNearOn > 0.5) {
    float f = length(base - uNear.xyz) / uNear.w;
    float fade = f < 0.62 ? 1.0 : fSmooth((1.0 - f) / 0.38);
    if (aMisc.x <= fade) keep = 0.0;
  }

  // Прореживание вдали: редкие подрешётки остаются и шире, остальные
  // тают. Площадь крон сохраняется, число силуэтов — нет.
  float d = length(base - uCamL);
  float b = uLod.z;
  float s1 = smoothstep(uLod.x * (1.0 - b), uLod.x * (1.0 + b), d);
  float s2 = smoothstep(uLod.y * (1.0 - b), uLod.y * (1.0 + b), d);
  float cls = aMisc.y;
  float stay = cls > 1.5 ? 1.0 : (cls > 0.5 ? 1.0 - s2 : 1.0 - s1);
  float wide = 1.0 + (cls > 0.5 ? s1 : 0.0) + (cls > 1.5 ? 2.0 * s2 : 0.0);
  float edge = 1.0 - smoothstep(uLod.w * 0.85, uLod.w, d);
  float k = keep * stay * edge;

  vUv = vec2(0.0);
  vGrain = vec2(0.0);
  vMat = 0.0;
  if (k < 0.002) {
    // За пределами отсечения: треугольник выбрасывается целиком.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vNormal = vec3(0.0, 0.0, 1.0); vViewPos = vec3(0.0, 0.0, -1.0);
    vColor = vec4(0.0); vFragDepth = 1.0; vLocal = vec3(0.0); vNormalL = vec3(0.0, 1.0, 0.0);
    return;
  }

  vec4 pr = uProf[int(aLook.w + 0.5)];
  float ry[4] = float[4](0.0, pr.x, pr.z, 1.0);
  float rr[4] = float[4](uTrunk, pr.y, pr.w, 0.0);
  int ring = int(aP.y + 0.5);
  int band = int(aP.w + 0.5);
  float hh = H * k;
  float ww = H * k * wide;

  float a = aP.x + aMisc.z;
  vec3 side = uT * cos(a) + uB * sin(a);
  vec3 p = base + uUp * (ry[ring] * hh) + side * (rr[ring] * ww);

  // Нормаль — на грань пояса целиком (плоское затенение, как у полных
  // моделей): по середине грани и наклону пояса.
  float am = aP.z + aMisc.z;
  vec3 mid = uT * cos(am) + uB * sin(am);
  float dy = (ry[band + 1] - ry[band]) * hh;
  float dr = (rr[band + 1] - rr[band]) * ww;
  vec3 nl = mid * dy - uUp * dr;
  nl = dot(nl, nl) > 1e-18 ? normalize(nl) : mid;

  // Нижний пояс — ствол: кора темнее и рыжее полога.
  vec3 c = band == 0 ? aLook.rgb * vec3(0.9, 0.55, 0.45) : aLook.rgb;
  vColor = vec4(c, 0.0);

  vec4 vp = uModelView * vec4(p, 1.0);
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  vViewPos = vp.xyz;
  vNormal = uNormalMat * nl;
  vNormalL = nl;
  vLocal = p;
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
in vec2 vGrain;

uniform vec3 uSunDir;    // направление НА солнце в координатах камеры
uniform mat3 uNormalMat;
uniform float uAmbient;
// Нормаль грани — по производным положения, а не из вершин: у сваренной
// сетки (пилот в скафандре, js/gl/spacesuit.js) своих нормалей нет. У
// остальных сеток — ноль, и всё как было.
uniform float uFlatN;
// Фары корабля: две лампы, всё в координатах КАМЕРЫ. uLampN = 0 —
// выключены, и весь блок пропускается одним сравнением.
uniform int uLampN;
uniform vec3 uLampPos[2];
uniform vec3 uLampDir[2];
uniform vec2 uLampCos[2];   // косинусы внутренней и внешней кромки пятна
uniform float uLampRange;   // км — дальше луч не достаёт
uniform float uLampPower;
uniform float uLogFC;
// Тени построек от фар: коробки города и его оси (js/gl/citymesh.js).
// uShadeN = 0 — города рядом нет, и весь блок пропускается одним сравнением.
${SHADE_GLSL}
// Тень своего корабля от солнца — картой глубины (js/gl/shipshadow.js).
// uShipShadowOn = 0 — карты нет, и выборок нет.
${SHIP_SHADOW_GLSL}
// Запечённая поверхность: нормаль в локальных осях (RGB) и тон (A).
// uSurfMode = 0 — текстуры нет (корабли, станции, светило).
uniform sampler2D uSurfTex;
uniform float uSurfMode;
${GRAIN_GLSL}
// Обшивка корабля: швы, переплёт мостика, сопла (js/gl/hull.js).
${HULL_GLSL}
// Фактуры станции: фотограмметрия полов, стен и мебели (js/gl/stationtex.js).
${STATION_GLSL}
${AIR_GLSL}
// Море водного мира (js/gl/water.js): урез, толща, волны, прибой.
${WATER_GLSL}
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

// Зал станции (js/gl/scene.js, setHall): внутри коробки зала и тоннеля
// солнца нет — их закрывает корпус станции, — а светят потолочные ряды:
// сверху и рассеянно. Коробки — в осях станции (км), фрагмент переводится
// в них одним поворотом. uHallOn = 0 — станции рядом нет, блок пропускается.
uniform float uHallOn;
uniform vec3 uHallO;            // центр станции в осях камеры, км
uniform mat3 uHallM;            // столбцы — оси станции в осях камеры
uniform vec3 uHallLo;
uniform vec3 uHallHi;
uniform vec3 uTunLo;
uniform vec3 uTunHi;
uniform vec3 uHallUp;           // верх станции в осях камеры
uniform vec4 uHallLight;        // рассеянный, сверху, снизу (от пола), сбоку (от стен)

float hallAt(vec3 vp) {
  if (uHallOn < 0.5) return 0.0;
  vec3 p = (vp - uHallO) * uHallM;
  bool a = all(greaterThan(p, uHallLo)) && all(lessThan(p, uHallHi));
  bool b = all(greaterThan(p, uTunLo)) && all(lessThan(p, uTunHi));
  return (a || b) ? 1.0 : 0.0;
}

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  // Свой корпус: там, где стоят помещения, обшивки изнутри нет, а где
  // открыт люк — нет его панели. Коробки выреза ставятся только своему
  // кораблю (uCarveN, js/gl/scene.js). Стекло фонаря не вырезается
  // никогда: нижний край лобового стекла спускается к носу ниже палубы
  // рубки, к самому коридору, и вырез средней палубы задевал его.
  if (uCarveN > 0 && vMat > 0.5 && vMat < ${STMAT_BASE - 0.5} && floor(vMat + 0.5) != ${MAT.glass}.0
    && hullCarved(vLocal * 1000.0)) discard;
  vec3 n = uFlatN > 0.5 ? normalize(cross(dFdx(vViewPos), dFdy(vViewPos))) : normalize(vNormal);
  vec3 albedo = vColor.rgb;
  // Собственный свет узора — окна мостика, жар сопел. Постоянный: его
  // не освещают, он светит сам.
  vec3 emit = vec3(0.0);

  // Море (js/gl/water.js). У грунта водного мира в альфе цвета вершины —
  // высота над морем по сетке, км (светиться грунту нечем, флаг там
  // свободен). Ширина уреза и след пикселя на воде — здесь, вне ветвлений:
  // производные внутри них не определены.
  float seaH = vColor.a;
  float seaAA = max(fwidth(vColor.a), 2e-6);
  float seaFw = max(length(dFdx(vViewPos)), length(dFdy(vViewPos))) * 1000.0;

  // Камень (js/gl/rocks.js): фактура снятой поверхности валуна —
  // рельеф и тон (GROUND.rock), по UV граней куба. Касательные оси — по
  // производным положения и UV в самом пикселе (кокасательный базис,
  // Шюлер): хранить их в вершинах незачем, а у сетки в триста
  // треугольников мелкого рельефа нет — его и возвращает фактура.
  if (uSurfMode > 1.5) {
    vec4 s = texture(uSurfTex, vUv);
    vec3 dp1 = dFdx(vViewPos), dp2 = dFdy(vViewPos);
    vec2 du1 = dFdx(vUv), du2 = dFdy(vUv);
    vec3 a1 = cross(dp2, n), a2 = cross(n, dp1);
    vec3 T = a1 * du1.x + a2 * du2.x;
    vec3 B = a1 * du1.y + a2 * du2.y;
    float tb = max(dot(T, T), dot(B, B));
    // У тени камня (тот же меш) UV нет — производные нулевые, рельеф не
    // трогается.
    if (tb > 0.0) n = normalize(n + (T * (s.x * 2.0 - 1.0) + B * (s.y * 2.0 - 1.0)) * inversesqrt(tb));
    albedo *= s.z * 2.0;
  } else if (uSurfMode > 0.5) {
  // Готовая поверхность из текстуры: нормаль берётся целиком из неё,
  // поэтому освещение не зависит от того, какой уровень сетки под
  // текстурой — переключения LOD в картинке не видны вовсе.
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
    // Над глубоким морем деталь не считается вовсе: урез ею не сдвинуть,
    // дна под такой толщей не видно, а пикселей моря — пол-экрана.
    if ((uBakeFw <= 0.0 || fw < 2.0 * uBakeFw) && dot(n, uSunDir) > NIGHT_SKIP
        && !(uWater > 0.5 && vColor.a < -SEA_SKIP_DEEP)) {
      vec3 helper = abs(dirL.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 U = normalize(cross(helper, dirL));
      vec3 V = cross(dirL, U);
      float dh; vec2 dg; float dcr;
      dDetail(dirL, U, V, fw, dh, dg, dcr);
      // Урез водного мира — по высоте над морем: сетка плюс мелкие октавы,
      // которые деталь только что посчитала. Это та же функция, по которой
      // игра решает «вода или суша» (js/game/surface.js, waterAt). Вода
      // гладкая: рельеф дна под ней — дело толщи, а не нормали. У тел без
      // жидкого моря признак прежний — синева цвета вершины (замёрзшее
      // море ледяного мира).
      if (uWater > 0.5) seaH += dh * uSeaR;
      float wet = uWater > 0.5
        ? 1.0 - smoothstep(-seaAA, seaAA, seaH)
        : clamp((vColor.b - max(vColor.r, vColor.g)) * 4.0, 0.0, 1.0);
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
  // Море: где урез, куда наклонена вода, где пена и мокрый песок.
  float water = 0.0;
  float foam = 0.0;
  float seaRough = 0.0;
  float seaDepth = 0.0;
  vec3 seaN = n;
  vec3 seaUp = n;
  // Суша выше наката за воду не платит ничем: ни волн, ни пены, ни
  // мокрого песка. Иначе восемь косинусов шли бы на каждый пиксель
  // грунта водного мира — в том числе под обшивкой стоящего на пляже
  // корабля, которую грунт потом закрывает (логарифмическая глубина
  // ранний тест глубины выключает).
  if (uWater > 0.5 && seaH < SEA_SWASH * 1.4 + seaAA) {
    seaUp = normalize(uNormalMat * normalize(vLocal));
    vec2 longPh;
    seaN = normalize(seaUp - seaSlope(vViewPos * 1000.0, seaUp, seaFw, seaRough, longPh));
    // Накат: урез поднимается на пляж и откатывается раз в период
    // прибоя. Вдоль берега он рвётся — где волна приходит раньше, где
    // позже: фаза сдвинута двумя длинными волнами.
    float brk = 1.3 * sin(longPh.x * 0.37 + longPh.y * 0.23);
    float swash = SEA_SWASH * (0.5 + 0.5 * sin(uShoreT + brk));
    float h = seaH - swash;
    water = 1.0 - smoothstep(-seaAA, seaAA, h);
    seaDepth = max(-h, 0.0) * 1000.0;
    // Мокрый песок: всё, до чего накат достаёт, темнее сухого.
    albedo *= 1.0 - SEA_WET_DARK * (1.0 - smoothstep(SEA_SWASH * 0.8, SEA_SWASH * 1.4, seaH));
    // Гребни прибоя — линии равной глубины; с фазой прибоя они идут к
    // берегу. Мельче пикселя — не рисуются: вдали полосы дали бы муар.
    float crest = sin(seaDepth * SURF_K + uShoreT + brk);
    float bands = 1.0 - smoothstep(0.8, 2.5, seaAA * 1000.0 * SURF_K);
    float zone = 1.0 - smoothstep(0.0, SURF_ZONE, seaDepth);
    // Пена рвётся: гребень белеет кусками, а не сплошной линией вдоль
    // всего берега — иначе прибой читается изолиниями карты.
    float rip = 0.5 + 0.5 * sin(longPh.x * 2.7 + longPh.y * 1.9 + uShoreT * 0.5);
    foam = smoothstep(0.35, 1.0, crest) * zone * zone * bands * smoothstep(0.25, 0.8, rip);
    // Кромка наката — тонкая пена у самого уреза. Издали её нет: линия
    // уже пикселя обвела бы весь берег белым.
    float edge = (1.0 - smoothstep(0.0, 0.15, seaDepth)) * water
               * (1.0 - smoothstep(2.0, 20.0, seaFw));
    foam = max(foam, 0.8 * edge) * water;
  }

  // Фотография грунта — САМАЯ МЕЛКАЯ ступень, поэтому последней: всё,
  // что крупнее, уже посчитано выше (js/gl/ground.js).
  if (uGrainOn > 0.5) {
    vec3 dirG = normalize(vLocal);
    // Вода остаётся гладкой. Признак — урез водного мира, у остальных
    // тел — синева цвета вершины. Гравий на море выглядел бы нелепо.
    float gw = 1.0 - (uWater > 0.5 ? water
      : clamp((vColor.b - max(vColor.r, vColor.g)) * 4.0, 0.0, 1.0));
${detail ? '    gw *= 1.0 - dPlate(dirG);       // бетон площадки не гравий' : ''}
    if (gw > 0.01) groundPhoto(dirG, vGrain, uNormalMat, gw, n, albedo);
  }

  // Обшивка корабля. У всего, что не корабль, материала нет (vMat = 0),
  // и блок пропускается одним сравнением.
  // Станция: материалы от STMAT_BASE — фотографией в метрах её осей.
  if (vMat > ${STMAT_BASE - 0.5}) stationDetail(vLocal * 1000.0, vNormalL,
    uHallOn > 0.5 ? uHallLo.y * 1000.0 + 3.0 : -1e9, albedo);
  else if (vMat > 0.5) hullDetail(vViewPos, n, albedo, emit);
  // Над водой свет ложится по волнам, а не по грунту дна.
  if (water > 0.0) n = normalize(mix(n, seaN, water));
  // Свой корпус ИЗНУТРИ (вид из рубки): изнанка обшивки у фонаря — это
  // стены рубки. Снаружи она тёмный борт в тени, а изнутри — крашеная
  // стена, освещённая тем, что попало под стекло.
  bool inner = uHullInside > 0.5 && vMat > 0.5 && vMat < ${STMAT_BASE - 0.5} && dot(n, vViewPos) > 0.0;
  if (inner) albedo = vec3(0.30, 0.32, 0.35);

  // Двустороннее освещение: нормаль всегда разворачиваем к камере. Так
  // корректно светятся «двусторонние» грани (тоннель порта станции), и
  // не нужно следить за порядком обхода вершин при сборке мешей.
  if (dot(n, normalize(vViewPos)) > 0.0) n = -n;

  // В зале станции солнца нет (hallAt): корпус станции вокруг.
  float hall = hallAt(vViewPos);
  float lam = max(dot(n, uSunDir), 0.0) * (1.0 - hall);
  // Свой корабль заслоняет солнце: гаснет прямой свет, рассеянный
  // остаётся. Нормаль здесь уже развёрнута к камере, и раз lam > 0 —
  // к солнцу тоже: по ней точку и отодвигают от поверхности.
  float sunVis = 1.0;
  if (uShipShadowOn > 0.5 && lam > 0.0) {
    sunVis = shipShadowAt(vViewPos, n);
    lam *= sunVis;
  }
  float lit = uAmbient + (1.0 - uAmbient) * lam;
  // Свет зала: ряды под потолком — сверху, отражённый от светлого пола —
  // снизу, и рассеянный от стен.
  if (hall > 0.5) {
    float up = dot(n, uHallUp);
    lit = uHallLight.x + uHallLight.y * max(up, 0.0) + uHallLight.z * max(-up, 0.0)
        + uHallLight.w * (1.0 - abs(up));
  }
  if (inner) lit = max(lit, 0.36);

  // Фары. Свет точечный и направленный: от лампы до точки считается
  // настоящее расстояние, дальше — конус и падение с дальностью.
  //
  // Падение НЕ обратный квадрат. По честному закону пятно на десяти
  // километрах слабее, чем на ста метрах, в десять тысяч раз — то есть
  // его нет вовсе. У фары есть заявленная дальность, и гаснуть луч
  // должен к ней, а не на первой сотне метров: это прожектор с отражателем,
  // а не голая лампочка.
  // Тень считается ОДИН РАЗ на фрагмент: обе фары стоят в носу, в
  // одной точке, и тень у них общая. Но это ПРОВЕРЯЕТСЯ, а не
  // предполагается: лампа, которую когда-нибудь переставят на
  // крыло, получит свою.
  vec3 shadeFrom = vec3(1e30);
  bool shaded = false;
  for (int i = 0; i < 2; i++) {
    if (i >= uLampN) break;
    vec3 d = vViewPos - uLampPos[i];
    float dist = length(d);
    if (dist > uLampRange) continue;
    vec3 L = d / dist;
    float c = dot(L, uLampDir[i]);
    if (c <= uLampCos[i].y) continue;
    // Постройки между лампой и точкой — после конуса: за его
    // кромкой света нет и без всякой тени, а проверка не даровая.
    if (uShadeN > 0) {
      if (distance(uLampPos[i], shadeFrom) > 1e-6) {
        shadeFrom = uLampPos[i];
        shaded = shadeHit(vViewPos, shadeFrom);
      }
      if (shaded) continue;
    }
    float cone = smoothstep(uLampCos[i].y, uLampCos[i].x, c);
    float fall = 1.0 - dist / uLampRange;
    lit += uLampPower * cone * fall * fall * max(dot(n, -L), 0.0);
  }
  // Потолок: два луча, сошедшиеся в упор на светлой обшивке, иначе
  // выжигают кадр в белое.
  lit = min(lit, 1.45);

  // Альфа цвета вершины — «светится сам», кроме грунта водного мира:
  // у него там высота над морем.
  float shade = mix(lit, 1.0, uWater > 0.5 ? 0.0 : vColor.a);
  vec3 rgb = albedo * shade + emit;
  // Море поверх дна: толща, отражение неба, блик солнца — и пена.
  if (water > 0.0) {
    vec3 sea = seaColor(albedo, seaN, seaUp, -normalize(vViewPos), seaDepth, lit, sunVis, seaRough);
    rgb = mix(rgb, sea, water);
  }
  if (foam > 0.0) rgb = mix(rgb, SEA_FOAM * lit, foam);

  // Дымка: воздух между камерой и ЭТОЙ точкой. Расстояние здесь
  // известно точно — это сам фрагмент, — поэтому ни сфер грунта, ни
  // догадок о рельефе не нужно вовсе (см. «Воздух вдоль луча»).
  // Включает её сцена и только для поверхности тела, в чью атмосферу
  // вошла камера: у всего остального uAir.w = 0, и блок пропускается
  // одним сравнением.
  vec4 air = airAlong(normalize(vViewPos), 0.0, length(vViewPos), uSunDir);
  outColor = vec4(rgb * (1.0 - air.a) + air.rgb, 1.0);
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
float bakeLand(vec3 p, int octTo, int moctTo) {
  float raw = dNoiseSum(p, octTo, uTexel);       // окно с нулевой октавы
  float sea = 1.0 - uSpan;
  float h = clamp((raw - sea) / uSpan, 0.0, 1.0) * uAmp;
  // Горы кладутся поверх и только на сушу. Доля суши считается по
  // абсолютной высоте — здесь она известна, потому что окно начинается
  // с нулевой октавы (js/gl/detail.js, dMount).
  float land = clamp((raw - sea) / D_MOUNT_RISE, 0.0, 1.0);
  return h + dMount(p, moctTo, uTexel, land * land * (3.0 - 2.0 * land));
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

  int octTo, csTo, moctTo;
  dLimits(uTexel, octTo, csTo, moctTo);

  // Кратеры: высота и наклон за один проход, с маской «морей».
  float cr = 0.0;
  vec2 gc = vec2(0.0);
  float dens = dMare(dir);
  dCraters(dir, U, V, csTo, uTexel, dens, cr, gc);

  // Наклон шума — конечными разностями шагом в тексель: это же и
  // сглаживание на пределе разрешения текстуры.
  float eps = max(1.5 * uTexel, 1e-7);
  float h0 = bakeLand(dir, octTo, moctTo);
  float hu = bakeLand(normalize(dir + U * eps), octTo, moctTo);
  float hv = bakeLand(normalize(dir + V * eps), octTo, moctTo);
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
uniform float uLogFC;
uniform float uFloor;    // радиус, на котором обрывается луч; 0 — не обрывать
${AIR_GLSL}
// На сколько сфера грунта опускается ниже камеры, когда та оказалась
// под ней. Запас не косметический: координаты здесь float32, и у
// величин порядка 1.8e7 км² (квадрат радиуса) точность около двух
// км². Зажим ВПРИТЫК иногда давал бы отрицательный корень, луч уходил
// бы сквозь планету, и кадр заливало бы молоком — через раз.
//
// Запас АБСОЛЮТНЫЙ, два метра, а не доля радиуса. Доля выходит боком:
// 1e-5 от 4200 км — это 42 м, то есть больше самой высоты полёта у
// земли.
const float ATMO_EPS = 0.002;

out vec4 outColor;

void main() {
${LOG_DEPTH_FRAG}
  vec3 d = normalize(vViewPos);
  float b = dot(d, uAirCenter);
  float cc = dot(uAirCenter, uAirCenter);

  // Отрезок внутри верхней сферы. Начало не раньше камеры: внутри
  // атмосферы ближний корень отрицательный, и луч начинается от глаза.
  float disc = b * b - (cc - uAir.y * uAir.y);
  if (disc <= 0.0) discard;
  float sq = sqrt(disc);
  float t0 = max(b - sq, 0.0);
  float t1 = b + sq;

  // Грунт обрывает луч ТОЛЬКО СНАРУЖИ (uFloor > 0): оттуда в кадре вся
  // полусфера сразу, и средняя сфера тела — лучшее, что можно сказать
  // про рельеф с такого расстояния.
  //
  // Изнутри обрывать нечем и НЕ НУЖНО. Эта оболочка рисует небо, то
  // есть ровно те пиксели, где земли нет: отделяет их проверка глубины,
  // которую включает сцена, а дымку на самой земле считает грунт своим
  // шейдером и по своему точному расстоянию (см. «Воздух вдоль луча»).
  // Пока здесь стояла сфера грунта, она у горизонта оказывалась выше
  // настоящей земли, и по всему горизонту шла тёмная полоса.
  if (uFloor > 0.0) {
    float ground = min(uFloor, sqrt(cc) - ATMO_EPS);
    // Сравнение НЕ строгое: у самой поверхности корень равен нулю, и
    // при строгом сравнении кадр заливает молоком ровно на посадке.
    float discG = b * b - (cc - ground * ground);
    if (discG > 0.0) {
      float tg = b - sqrt(discG);
      if (tg >= 0.0) t1 = min(t1, tg);
    }
  }
  if (t1 <= t0) discard;

  outColor = airAlong(d, t0, t1, uSunDir);
}`;

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
