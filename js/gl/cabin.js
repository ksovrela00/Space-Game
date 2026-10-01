// Кабина на видеокарте: свой шейдер, свои тени, экраны-текстуры и стекло.
//
// ПОЧЕМУ НЕ ОБЩИЙ ШЕЙДЕР СЕТОК. Общий (MESH_FS) рассчитан на то, что
// видно с сотни метров: плоский цвет на грань, солнце без теней, общий
// рассеянный свет. Кабина — в метре от глаза, и с такого расстояния всё
// это выдаёт себя сразу. Прежняя кабина так и выглядела: ровная серая
// заливка, освещённая одинаково днём и ночью (подсветка 0.55 на всё), —
// «гроб с окном». Здесь каждое из этих упрощений заменено тем, что есть
// в настоящей кабине:
//
//   * КРАСКА — фотография (CC0, Poly Haven, tools/cabin.mjs): царапины и
//     потёртости меняют и тон, и нормаль, и блеск — блик ложится именно
//     по стёртым местам;
//   * СОЛНЦЕ — с ТЕНЯМИ: карта глубины кабины из точки солнца. Стекла в
//     ней нет, поэтому свет проходит ровно в проёмы фонаря, а стойки и
//     дуги кладут на доску полосы тени, которые ползут по ней, когда
//     корабль поворачивается. Солнце за кормой в кабину не светит вовсе
//     — его закрывает переборка;
//   * ЗАТМЕНИЕ — в тени планеты солнца нет и в кабине (считается на
//     процессоре, диском по диску); в атмосфере у горизонта солнце
//     краснеет — путь сквозь воздух длиннее;
//   * ЛАМПЫ — подсветка доски из-под козырька, плафон над головой и свет
//     в ногах. Ночью кабину освещают они, а не «рассеянный свет космоса»;
//   * ЭКРАНЫ СВЕТЯТ на всё перед собой: цвет берётся из мипмапа самого
//     экрана, то есть светит ровно то, что на нём сейчас нарисовано;
//   * НЕБО И ПЛАНЕТА — в атмосфере днём кабину заливает небо сверху, над
//     освещённой планетой — отражённый ею свет снизу.
//
// Кабина рисуется в МЕТРАХ и в осях корабля с началом в глазу
// (js/models/cockpit.js): ближняя плоскость в четыре сантиметра, и
// никакой логарифмической глубины — буфер глубины перед проходом
// очищается, кабина закрывает собой всё.

import { buildProgram } from './program.js';
import { perspective, modelView } from './mat4.js';
import { CMAT, EYE } from '../models/cockpit.js';
import { MAT as HULL_MAT } from '../models/hulldetail.js';
import { HULL_FRAME_GLSL } from './hull.js';
import { ENTRY } from '../game/entry.js';
import { lockLight } from '../game/airlock.js';

/**
 * Сколько ламп кабина освещает разом. Пост пилота — шесть своих
 * (подсветка мониторов и свет в ногах), в помещениях корабля их два
 * десятка, и выбираются ближайшие из видимых комнат (CabinView.lampsFor).
 */
export const CAB_LAMPS = 12;

/** Фотография краски: файл, размер снятого куска, пикселей на выходе. */
export const CABIN_TEX = { file: 'assets/texture/cabin.png', sizeM: 2.5, px: 512 };

export const CABIN = {
  near: 0.04,          // м
  far: 250,            // м — весь корпус корабля
  // Что видит солнце. Поперёк луча — круг в 4.5 м вокруг поста: доска,
  // пульты и палуба у кресла (карта в 2048 текселей — 4.4 мм на
  // тексель). ВДОЛЬ луча — на 90 м в сторону солнца: тень на доску
  // отбрасывает не только переплёт фонаря над головой, но и весь корпус —
  // корма, крылья, днище, — и всё это должно попасть в карту.
  lightC: [0, -0.5, -1.2],
  lightR: 4.5,
  lightBack: 90,       // м — до солнца
  lightFront: 4.5,     // м — от солнца
  depthBias: 0.004,    // м
  // Рассеянный свет кабины: дежурная подсветка, отражённая от стен и
  // потолка. Без него графитовая доска в тени — чёрная плита: альбедо
  // её краски около 0.25, и одних ламп на неё не хватает.
  amb: [0.30, 0.31, 0.34],
  // Экраны: яркость свечения и сила света на доску.
  screenK: 1.0,
  spillK: 2.6,
  ledK: 1.0,
  // Солнечный свет в кабине. Не единица: доска графитовая, и солнце в
  // полную силу выжигало бы её до белого в кадре без тональной кривой.
  sun: [1.0, 0.97, 0.92],
  // Воздух съедает синий сильнее красного (рэлеевское рассеяние, λ⁻⁴):
  // оптическая толщина на единицу воздушной массы, по каналам.
  airTau: [0.035, 0.075, 0.16],
  // Альбедо планеты — доля солнца, которую она отражает на корабль.
  albedo: 0.3,
};

// --- шейдеры ---------------------------------------------------------------------

const CABIN_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aColor;
layout(location = 3) in float aMat;
layout(location = 4) in vec2 aUv;
layout(location = 5) in vec2 aUv2;
uniform mat4 uProj;
uniform mat4 uView;       // кабина -> камера
uniform mat4 uModel;      // деталь -> кабина (ручка, РУД); у оболочки — единица
out vec3 vPos;
out vec3 vN;
out vec4 vColor;
out float vMat;
out vec2 vUv;
out vec2 vUv2;
out float vFragDepth;
void main() {
  vec4 p = uModel * vec4(aPos, 1.0);
  vPos = p.xyz;
  vN = mat3(uModel) * aNormal;
  vColor = aColor;
  vMat = aMat;
  vUv = aUv;
  vUv2 = aUv2;
  gl_Position = uProj * (uView * p);
  // Глубина — логарифмическая, как у корпуса в этом же проходе
  // (js/gl/scene.js, drawHullInside): иначе пост и обшивка не делили бы
  // один буфер глубины. Расстояние — в километрах, как у сцены.
  vFragDepth = 1.0 + gl_Position.w * 0.001;
}`;

// Глубина из точки солнца. Проекция — ортогональная (солнце далеко), и
// считается без матрицы: три скалярных произведения на оси света.
const DEPTH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 3) in float aMat;
uniform mat4 uModel;
uniform vec3 uLR;
uniform vec3 uLU;
uniform vec3 uLF;
uniform vec4 uLC;
uniform vec2 uLZ;          // середина и полуширина по глубине, м
out vec3 vPos;
out vec3 vN;
out float vMat;
void main() {
  vec3 p = (uModel * vec4(aPos, 1.0)).xyz;
  vPos = p;
  vN = aNormal;
  vMat = aMat;
  vec3 d = p - uLC.xyz;
  gl_Position = vec4(dot(d, uLR) / uLC.w, dot(d, uLU) / uLC.w, (dot(d, uLF) - uLZ.x) / uLZ.y, 1.0);
}`;

// Корпус в карте теней: стёкла фонаря пропускают свет, переплёт — нет.
// Узор переплёта тот же, что у обшивки (js/gl/hull.js), — иначе полосы
// тени на доске не совпали бы со стойками, которые видно над головой.
const DEPTH_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vN;
in float vMat;
uniform float uHullPass;
uniform vec3 uEyeM;
${HULL_FRAME_GLSL}
void main() {
  if (uHullPass > 0.5 && int(vMat + 0.5) == ${HULL_MAT.glass}) {
    vec3 p = vPos + uEyeM;
    if (hullFrame(p, hullUv(p, vN), vec2(0.02)) < 0.5) discard;
  }
}`;

// Лампы кабины названы uCabLamp*, а не как фары корабля в общем шейдере
// (uLamp*): фары стоят в носу снаружи и кабину не освещают, и проверка
// (tools/gl.mjs) следит, чтобы их имён в этом шейдере не было вовсе.
export const CABIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;

in vec3 vPos;
in vec3 vN;
in vec4 vColor;
in float vMat;
in vec2 vUv;
in vec2 vUv2;
in float vFragDepth;
uniform float uLogFC;

uniform vec3 uEye;
uniform vec3 uSunL;              // на солнце, оси кабины
uniform vec3 uSunC;              // цвет солнца с затмением и воздухом
uniform float uShadowOn;
uniform sampler2DShadow uShadow;
uniform vec3 uLR;
uniform vec3 uLU;
uniform vec3 uLF;
uniform vec4 uLC;
uniform vec2 uLZ;
uniform float uDepthBias;
uniform float uTexel;
uniform sampler2D uPaint;        // краска: нормаль (RG), тон (B), блеск (A)
uniform float uPaintK;           // 1 / размер снятого куска, 1/м
uniform sampler2D uScreens;      // атлас экранов
uniform float uScreenK;
uniform vec3 uAmb;
uniform vec3 uSkyDir;
uniform vec3 uSkyC;
uniform vec3 uPlanetDir;
uniform vec3 uPlanetC;
// Лампы кабины (свои имена: у общего шейдера так зовутся фары корабля).
uniform int uCabLampN;
uniform vec4 uCabLampP[${CAB_LAMPS}];      // место, дальность
uniform vec4 uCabLampD[${CAB_LAMPS}];      // направление, косинус кромки (< -1.5 — без конуса)
uniform vec3 uCabLampC[${CAB_LAMPS}];
// Комната лампы: светит она только внутри неё. Теней от ламп нет, и без
// этого свет кают-компании проходил бы сквозь переборку в коридор.
uniform vec3 uCabLampLo[${CAB_LAMPS}];
uniform vec3 uCabLampHi[${CAB_LAMPS}];
// Где свет снаружи: рубка под стеклом. В закрытых помещениях корабля нет
// ни солнца, ни неба, ни отсвета планеты — карта теней покрывает только
// рубку, и за её краем солнце светило бы сквозь любую переборку.
uniform vec3 uSunLo;
uniform vec3 uSunHi;
uniform int uSpillN;
uniform vec3 uSpillPos[8];
uniform vec3 uSpillNrm[8];
uniform vec4 uSpillUv[8];        // центр экрана в атласе, площадь (м²), уровень мипа
uniform float uSpillK;
uniform float uLedK;

out vec4 outColor;

// Тень: четыре выборки со сравнением (каждая сама сглажена
// билинейно). Точка отодвигается по нормали на полтора текселя —
// иначе поверхность затеняет сама себя рябью.
float shadowAt(vec3 p, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec3 d = p + n * (uTexel * uLC.w * 3.0) - uLC.xyz;
  vec3 s = vec3(dot(d, uLR) / uLC.w, dot(d, uLU) / uLC.w, (dot(d, uLF) - uLZ.x) / uLZ.y) * 0.5 + 0.5;
  if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
  float r = s.z - uDepthBias;
  float t = uTexel * 0.75;
  return 0.25 * (texture(uShadow, vec3(s.xy + vec2(-t, -t), r))
               + texture(uShadow, vec3(s.xy + vec2( t, -t), r))
               + texture(uShadow, vec3(s.xy + vec2(-t,  t), r))
               + texture(uShadow, vec3(s.xy + vec2( t,  t), r)));
}

void main() {
  gl_FragDepth = log2(vFragDepth) * uLogFC * 0.5;
  int m = int(vMat + 0.5);
  vec3 V = normalize(uEye - vPos);
  float outside = all(greaterThanEqual(vPos, uSunLo)) && all(lessThanEqual(vPos, uSunHi)) ? 1.0 : 0.0;

  // Светится само — ни света, ни тени.
  if (m == ${CMAT.lamp}) { outColor = vec4(vColor.rgb * mix(0.55, 1.0, vColor.a), 1.0); return; }
  if (m == ${CMAT.led}) { outColor = vec4(vColor.rgb * vColor.a * uLedK, 1.0); return; }

  vec3 n0 = normalize(vN);
  if (dot(n0, V) < 0.0) n0 = -n0;
  vec3 n = n0;

  if (m == ${CMAT.screen}) {
    vec3 tex = texture(uScreens, vUv).rgb;
    // Подсветка матрицы к краям слабеет, а чёрный у неё не чёрный.
    vec2 e = min(vUv2, 1.0 - vUv2);
    float vig = smoothstep(0.0, 0.05, min(e.x, e.y * 1.5));
    vec3 emit = tex * uScreenK * (0.8 + 0.2 * vig) + vec3(0.007, 0.011, 0.017);
    // Покровное стекло: блик солнца, отражение кабины и неба, и солнце
    // на самом экране, которое съедает контраст, — как у настоящего.
    float c = max(dot(n, V), 0.0);
    float F = 0.035 + 0.965 * pow(1.0 - c, 5.0);
    vec3 R = reflect(-V, n);
    float sh = dot(n, uSunL) > 0.0 ? shadowAt(vPos, n) * outside : 0.0;
    vec3 glare = uSunC * sh * pow(max(dot(R, uSunL), 0.0), 700.0) * 5.0;
    vec3 env = uAmb * 0.6 + uSkyC * outside * (0.5 + 0.5 * dot(R, uSkyDir)) * 0.5;
    vec3 wash = uSunC * sh * max(dot(n, uSunL), 0.0) * 0.045;
    outColor = vec4(emit + (env + glare) * F + wash, 1.0);
    return;
  }

  vec3 albedo = vColor.rgb;
  float ks = 0.04, pw = 12.0, bump = 0.0, toneK = 0.0;
  if (m == ${CMAT.paint}) { bump = 0.55; toneK = 0.9; }
  else if (m == ${CMAT.trim}) { bump = 0.3; toneK = 0.55; }
  else if (m == ${CMAT.metal}) { bump = 0.3; toneK = 0.35; }
  else if (m == ${CMAT.rubber}) { bump = 0.8; toneK = 0.45; }
  else if (m == ${CMAT.tread}) { bump = 0.4; toneK = 0.6; }
  else if (m == ${CMAT.hazard}) { bump = 0.3; toneK = 0.6; }
  else if (m == ${CMAT.grille}) { bump = 0.2; toneK = 0.3; }

  // Фотография краски: координата — метры кабины по преобладающей оси
  // нормали, как у обшивки корабля (js/gl/hull.js). Кусок в 2.5 м — это
  // вся кабина разом, повтора в ней нет.
  vec3 an = abs(n0);
  vec2 uv; vec3 T; vec3 B;
  if (an.x >= an.y && an.x >= an.z) { uv = vPos.zy; T = vec3(0.0, 0.0, 1.0); B = vec3(0.0, 1.0, 0.0); }
  else if (an.y >= an.z) { uv = vPos.xz; T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, 1.0); }
  else { uv = vPos.xy; T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 1.0, 0.0); }
  // Разным материалам — разные места снимка: иначе одна и та же
  // царапина шла бы по доске и по рукоятке.
  vec4 tx = texture(uPaint, uv * uPaintK + vec2(0.37, 0.61) * vMat);
  vec2 g = tx.xy * 2.0 - 1.0;
  n = normalize(n0 + (T * g.x + B * g.y) * bump);
  albedo *= mix(1.0, tx.z * 2.0, toneK);
  float gloss = tx.w;

  if (m == ${CMAT.paint}) { ks = 0.04 + 0.30 * gloss; pw = 10.0 + 80.0 * gloss; }
  else if (m == ${CMAT.trim}) { ks = 0.05 + 0.08 * gloss; pw = 24.0; }
  else if (m == ${CMAT.metal}) { ks = 0.55; pw = 40.0 + 60.0 * gloss; albedo *= 0.55; }
  else if (m == ${CMAT.rubber}) { ks = 0.025; pw = 8.0; }
  else if (m == ${CMAT.tread}) {
    // Рифление: ромбы по полу, выпуклые, с бликом на гранях.
    vec2 q = fract(vPos.xz * vec2(18.0, 18.0) + vec2(vPos.z * 18.0, 0.0)) - 0.5;
    float dd = abs(q.x) + abs(q.y);
    float bumpD = smoothstep(0.34, 0.26, dd);
    n = normalize(n + (T * q.x + B * q.y) * bumpD * 1.2);
    ks = 0.08 + 0.25 * bumpD; pw = 30.0;
  } else if (m == ${CMAT.hazard}) {
    float sp = dot(vPos, vec3(1.0, 1.0, 0.5)) * 14.0;
    float w = fwidth(sp);
    float s = smoothstep(0.5 - w, 0.5 + w, abs(fract(sp) - 0.5) * 2.0);
    albedo = mix(vec3(0.05, 0.05, 0.055), albedo, s);
    ks = 0.10; pw = 20.0;
  } else if (m == ${CMAT.grille}) {
    float sl = vPos.y * 70.0;
    float w = fwidth(sl);
    albedo *= mix(0.15, 1.0, smoothstep(0.45 - w, 0.45 + w, fract(sl)));
  }

  vec3 diff = uAmb;
  vec3 spec = vec3(0.0);
  // Небо сверху и планета снизу — сквозь стекло, широким светом.
  diff += uSkyC * outside * (0.55 + 0.45 * dot(n, uSkyDir));
  diff += uPlanetC * outside * max(dot(n, uPlanetDir), 0.0);

  // Солнце — с тенью от переплёта.
  float ndl = dot(n, uSunL);
  if (outside > 0.5 && ndl > 0.0 && dot(uSunC, vec3(1.0)) > 0.001) {
    float sh = shadowAt(vPos, n0);
    if (sh > 0.0) {
      diff += uSunC * ndl * sh;
      vec3 H = normalize(uSunL + V);
      spec += uSunC * sh * ks * pow(max(dot(n, H), 0.0), pw) * (pw + 8.0) / 24.0 * ndl;
    }
  }

  // Лампы кабины.
  for (int i = 0; i < ${CAB_LAMPS}; i++) {
    if (i >= uCabLampN) break;
    if (any(lessThan(vPos, uCabLampLo[i])) || any(greaterThan(vPos, uCabLampHi[i]))) continue;
    vec3 d = uCabLampP[i].xyz - vPos;
    float r = max(length(d), 1e-4);
    vec3 l = d / r;
    float cone = uCabLampD[i].w < -1.5 ? 1.0
      : smoothstep(uCabLampD[i].w, uCabLampD[i].w + 0.25, dot(-l, uCabLampD[i].xyz));
    float fall = 1.0 / (1.0 + (r * r) / (uCabLampP[i].w * uCabLampP[i].w));
    float nl = max(dot(n, l), 0.0);
    diff += uCabLampC[i] * nl * cone * fall;
    spec += uCabLampC[i] * cone * fall * ks * pow(max(dot(n, normalize(l + V)), 0.0), pw) * nl;
  }

  // Свет экранов. Экран — светящийся прямоугольник: освещённость от него
  // как от площадки, A·cosθ₁·cosθ₂/(r² + A). Добавка A в знаменателе —
  // чтобы у самой рамки не было особенности, где закон 1/r² для
  // протяжённого источника уже неверен.
  for (int i = 0; i < 8; i++) {
    if (i >= uSpillN) break;
    vec3 d = uSpillPos[i] - vPos;
    float r2 = max(dot(d, d), 1e-6);
    vec3 l = d * inversesqrt(r2);
    float e = max(dot(uSpillNrm[i], -l), 0.0);
    float nl = max(dot(n, l), 0.0);
    if (e * nl <= 0.0) continue;
    vec3 c = textureLod(uScreens, uSpillUv[i].xy, uSpillUv[i].w).rgb;
    diff += c * uSpillK * e * nl * uSpillUv[i].z / (r2 + uSpillUv[i].z);
  }

  vec3 rgb = albedo * diff + spec;
  // Подсвеченные кнопки: подпись светится сама (доля — в альфе цвета).
  rgb = mix(rgb, vColor.rgb * 0.85, vColor.a);
  outColor = vec4(rgb, 1.0);
}`;

// Стекло фонаря: почти прозрачное, но ВИДНОЕ. По чему глаз узнаёт стекло:
// по отражению (у кромок оно растёт — закон Френеля), по доске,
// отражённой снизу, и по пыли, которая загорается, когда смотришь в
// сторону солнца.
const GLASS_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vN;
in vec4 vColor;
in float vMat;
in vec2 vUv;
in vec2 vUv2;
in float vFragDepth;
uniform float uLogFC;
uniform vec3 uEye;
uniform vec3 uSunL;
uniform vec3 uSunC;
uniform vec3 uAmb;
uniform sampler2D uScreens;
uniform vec3 uEyeM;
out vec4 outColor;
${HULL_FRAME_GLSL}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  gl_FragDepth = log2(vFragDepth) * uLogFC * 0.5;
  // Стекло — это фонарь корабля, и его переплёт уже нарисован обшивкой:
  // на стойках стекла нет.
  vec3 pm = vPos + uEyeM;
  vec2 hu = hullUv(pm, vN);
  vec2 fw = vec2(length(vec2(dFdx(hu.x), dFdy(hu.x))), length(vec2(dFdx(hu.y), dFdy(hu.y))));
  if (hullFrame(pm, hu, max(fw, vec2(1e-4))) > 0.5) discard;
  vec3 n = normalize(vN);
  vec3 V = normalize(vPos - uEye);            // от глаза сквозь стекло
  if (dot(n, V) > 0.0) n = -n;                // n — к пилоту
  float c = clamp(-dot(n, V), 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - c, 5.0);
  vec3 R = reflect(V, n);
  // Отражается кабина: вниз — доска со светящимися экранами, вверх —
  // тёмный потолок. Средний цвет экранов — верхний мип атласа.
  vec3 glow = textureLod(uScreens, vec2(0.5), 20.0).rgb * 3.0;
  float down = clamp(-R.y * 1.6 + 0.15, 0.0, 1.0);
  vec3 refl = uAmb * 0.4 + glow * down;
  // Пыль и мелкие царапины: видны, только когда солнце светит сквозь
  // них к глазу (рассеяние вперёд).
  vec2 q = vec2(dot(vPos, vec3(1.0, 0.0, 0.35)), dot(vPos, vec3(0.0, 1.0, 0.25)));
  float dust = noise(q * 42.0) * noise(q * 6.0 + 3.1);
  dust = smoothstep(0.18, 0.75, dust);
  float lit = max(dot(-n, uSunL), 0.0);
  float fwd = 0.06 + 2.2 * pow(max(dot(V, uSunL), 0.0), 12.0);
  vec3 scatter = uSunC * dust * fwd * lit * 0.28;
  vec3 col = refl * F + scatter;
  float a = clamp(0.025 + F * 0.45 + dust * fwd * lit * 0.12, 0.0, 0.5);
  outColor = vec4(col, a);
}`;

// --- сетки -------------------------------------------------------------------------

const STRIDE = 15;          // pos3 nrm3 col4 mat1 uv2 uv2

/**
 * Сетка кабины в буфер: грани веером в треугольники, нормали — плоские
 * или сглаженные по общим вершинам (у гнутой доски), у экранов —
 * координата в атласе и своя, от 0 до 1.
 */
export function cabinArrays(mesh, atlasUv) {
  let tris = 0;
  for (const f of mesh.faces) tris += Math.max(0, f.v.length - 2);
  const out = new Float32Array(tris * 3 * STRIDE);
  // Сглаженные нормали: сумма нормалей граней при вершине.
  const acc = new Float64Array(mesh.verts.length * 3);
  for (const f of mesh.faces) {
    if (!f.smooth) continue;
    for (const i of f.v) {
      acc[i * 3] += f.n.x; acc[i * 3 + 1] += f.n.y; acc[i * 3 + 2] += f.n.z;
    }
  }
  let o = 0;
  const put = (f, k) => {
    const vi = f.v[k];
    const v = mesh.verts[vi];
    let nx = f.n.x, ny = f.n.y, nz = f.n.z;
    if (f.smooth) {
      const ax = acc[vi * 3], ay = acc[vi * 3 + 1], az = acc[vi * 3 + 2];
      const l = Math.hypot(ax, ay, az);
      // Сглаживаем только согласные нормали: сумма, вывернутая против
      // своей грани, значит излом, и там остаётся нормаль грани.
      if (l > 1e-9 && (ax * nx + ay * ny + az * nz) / l > 0.5) { nx = ax / l; ny = ay / l; nz = az / l; }
    }
    let u = 0, w = 0, u2 = -1, w2 = -1;
    if (f.uv) {
      u2 = f.uv[k][0]; w2 = f.uv[k][1];
      const r = atlasUv && atlasUv(f.screen);
      if (r) { u = r[0] + u2 * r[2]; w = r[1] + w2 * r[3]; }
    }
    out.set([v.x, v.y, v.z, nx, ny, nz, f.c[0] / 255, f.c[1] / 255, f.c[2] / 255,
      Math.max(0, Math.min(1, f.emissive || 0)), f.mat || 0, u, w, u2, w2], o);
    o += STRIDE;
  };
  for (const f of mesh.faces) {
    for (let t = 1; t + 1 < f.v.length; t++) { put(f, 0); put(f, t); put(f, t + 1); }
  }
  return out;
}

function upload(gl, data) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const B = 4 * STRIDE;
  const at = (loc, size, off) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, B, off * 4);
  };
  at(0, 3, 0); at(1, 3, 3); at(2, 4, 6); at(3, 1, 10); at(4, 2, 11); at(5, 2, 13);
  gl.bindVertexArray(null);
  return { vao, buf, count: data.length / STRIDE };
}

// --- помещения корабля -------------------------------------------------------------
//
// Помещений — полторы сотни тысяч треугольников (js/models/interior.js), и
// в формате поста пилота (15 чисел с плавающей точкой на вершину) это
// было бы 27 МБ видеопамяти. Помещениям экранные координаты не нужны, а
// нормаль, цвет и материал помещаются в байты: 24 байта на вершину, а не
// 60. Уголки экрана (aUv, aUv2) у этих сеток не заданы вовсе — шейдер
// берёт их у выключенного атрибута, и нужны они только экранам.

const STRIDE_I = 24;        // pos 3×f32 · нормаль 3×i8 · цвет 4×u8 · материал u8

/**
 * Сетка помещения (MeshBuf: оси корабля, м) в буфер, с началом в точке o
 * (глаз пилота — начало координат кабины; у деталей — их собственный ноль).
 */
export function interiorArrays(buf, o = { x: 0, y: 0, z: 0 }) {
  const n = buf.pos.length / 3;
  const ab = new ArrayBuffer(n * STRIDE_I);
  const f = new Float32Array(ab), i8 = new Int8Array(ab), u8 = new Uint8Array(ab);
  for (let v = 0; v < n; v++) {
    const fo = v * 6, b = v * STRIDE_I;
    f[fo] = buf.pos[v * 3] - o.x; f[fo + 1] = buf.pos[v * 3 + 1] - o.y; f[fo + 2] = buf.pos[v * 3 + 2] - o.z;
    i8[b + 12] = Math.round(buf.nrm[v * 3] * 127);
    i8[b + 13] = Math.round(buf.nrm[v * 3 + 1] * 127);
    i8[b + 14] = Math.round(buf.nrm[v * 3 + 2] * 127);
    u8[b + 16] = buf.col[v * 4]; u8[b + 17] = buf.col[v * 4 + 1]; u8[b + 18] = buf.col[v * 4 + 2];
    u8[b + 19] = Math.round(Math.max(0, Math.min(1, buf.col[v * 4 + 3])) * 255);
    u8[b + 20] = buf.mat[v];
  }
  return { ab, count: n };
}

/**
 * Сетка помещения, упакованная один раз и навсегда.
 *
 * Сборка кладёт вершины в обычные массивы чисел — по восемь байт на
 * число, и у помещений это около сорока мегабайт. После упаковки они не
 * нужны: остаётся буфер в 24 байта на вершину (он же переживает потерю
 * контекста — сцена пересобирает кабину из него), а исходные массивы
 * отпускаются. Заодно считается габарит сетки (оси кабины): по нему
 * комната отсекается из кадра — по самой сетке, а не по коробке комнаты:
 * у рубки в коробке сидит глаз, а сетка — одна переборка за спиной.
 */
function packed(m, o = { x: 0, y: 0, z: 0 }) {
  if (m.packed) return m.packed;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = m.pos[i + a];
      if (v < lo[a]) lo[a] = v;
      if (v > hi[a]) hi[a] = v;
    }
  }
  const pk = interiorArrays(m, o);
  pk.lo = [lo[0] - o.x, lo[1] - o.y, lo[2] - o.z];
  pk.hi = [hi[0] - o.x, hi[1] - o.y, hi[2] - o.z];
  m.packed = pk;
  m.pos = null; m.nrm = null; m.col = null; m.mat = null;
  return pk;
}

function uploadInterior(gl, data) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data.ab, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE_I, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.BYTE, true, STRIDE_I, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, STRIDE_I, 16);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, false, STRIDE_I, 20);
  gl.disableVertexAttribArray(4);
  gl.disableVertexAttribArray(5);
  gl.bindVertexArray(null);
  return { vao, buf, count: data.count };
}

/**
 * Видна ли коробка [lo, hi] (оси кабины) в кадре: восемь углов в
 * отсечённых координатах, и коробка отброшена, только если все они за
 * одной плоскостью пирамиды. Грубо, но без единой ошибки в сторону
 * «спрятать видимое».
 */
function boxInView(pv, lo, hi) {
  let out = 0;
  const masks = [0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? hi[0] : lo[0], y = i & 2 ? hi[1] : lo[1], z = i & 4 ? hi[2] : lo[2];
    const cx = pv[0] * x + pv[4] * y + pv[8] * z + pv[12];
    const cy = pv[1] * x + pv[5] * y + pv[9] * z + pv[13];
    const cw = pv[3] * x + pv[7] * y + pv[11] * z + pv[15];
    if (cx < -cw) masks[0]++;
    if (cx > cw) masks[1]++;
    if (cy < -cw) masks[2]++;
    if (cy > cw) masks[3]++;
    if (cw < 0) masks[4]++;
    out++;
  }
  return !masks.some((m) => m === out);
}

const mul4 = (a, b, o) => {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
};

// --- свет снаружи --------------------------------------------------------------------

/**
 * Сколько солнца доходит до корабля, 0..1: тела между кораблём и
 * звездой закрывают её диск. Перекрытие дисков считается по угловым
 * радиусам: полутень — пока край планеты идёт по диску звезды.
 */
export function sunVisibility(world, pos) {
  const star = world.star;
  const sx = star.pos.x - pos.x, sy = star.pos.y - pos.y, sz = star.pos.z - pos.z;
  const sd = Math.hypot(sx, sy, sz) || 1;
  const as = Math.asin(Math.min(1, (star.radius || 0) / sd));
  let vis = 1;
  for (const b of world.bodies) {
    if (b === star || !b.radius) continue;
    const bx = b.pos.x - pos.x, by = b.pos.y - pos.y, bz = b.pos.z - pos.z;
    const bd = Math.hypot(bx, by, bz);
    if (bd >= sd || bd <= 0) continue;
    const ab = Math.asin(Math.min(1, b.radius / bd));
    const th = Math.acos(Math.max(-1, Math.min(1, (bx * sx + by * sy + bz * sz) / (bd * sd))));
    if (th >= ab + as) continue;
    const t = (th - (ab - as)) / Math.max(2 * as, 1e-9);
    const k = Math.max(0, Math.min(1, t));
    vis = Math.min(vis, k * k * (3 - 2 * k));
    if (vis <= 0) return 0;
  }
  return vis;
}

// --- проход ------------------------------------------------------------------------

const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const ZERO3 = { x: 0, y: 0, z: 0 };
// Глубина карты теней: от lightBack метров до солнца до lightFront за центром.
const LZ_MID = (CABIN.lightFront - CABIN.lightBack) / 2;
const LZ_HALF = (CABIN.lightFront + CABIN.lightBack) / 2;

/** Деталь -> кабина: поворот вокруг осей x, z, y и перенос в ось качания. */
function partMatrix(p, ax, az, ay, out) {
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cz = Math.cos(az), sz = Math.sin(az);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  // R = Rz · Rx · Ry: сперва поворот рукоятки вокруг своей оси, потом
  // наклон вперёд-назад и вбок.
  const ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const rx = [1, 0, 0, 0, cx, sx, 0, -sx, cx];
  const rz = [cz, sz, 0, -sz, cz, 0, 0, 0, 1];
  const mul3 = (a, b) => {
    const r = new Array(9);
    for (let c = 0; c < 3; c++) {
      for (let rr = 0; rr < 3; rr++) {
        r[c * 3 + rr] = a[rr] * b[c * 3] + a[3 + rr] * b[c * 3 + 1] + a[6 + rr] * b[c * 3 + 2];
      }
    }
    return r;
  };
  const m = mul3(rz, mul3(rx, ry));
  out[0] = m[0]; out[1] = m[1]; out[2] = m[2]; out[3] = 0;
  out[4] = m[3]; out[5] = m[4]; out[6] = m[5]; out[7] = 0;
  out[8] = m[6]; out[9] = m[7]; out[10] = m[8]; out[11] = 0;
  out[12] = p.x; out[13] = p.y; out[14] = p.z; out[15] = 1;
  return out;
}

const NEUTRAL = new Uint8Array([128, 128, 128, 128]);

export class CabinView {
  /**
   * @param q профиль устройства: { shadow: сторона карты теней (0 — без теней) }
   */
  constructor(gl, q = {}) {
    this.gl = gl;
    this.pCabin = buildProgram(gl, 'cabin', CABIN_VS, CABIN_FS);
    this.pDepth = buildProgram(gl, 'cabin-shadow', DEPTH_VS, DEPTH_FS);
    this.pGlass = buildProgram(gl, 'cabin-glass', CABIN_VS, GLASS_FS);
    this.shadowSize = q.shadow === undefined ? 1024 : q.shadow;
    this.aniso = gl.getExtension && gl.getExtension('EXT_texture_filter_anisotropic');
    this.paint = this.makePaint(q.load);
    this.model = null;
    this.parts = null;
    this.atlas = null;
    this.atlasOf = null;
    this.shadow = null;
    this.proj = new Float32Array(16);
    this.view = new Float32Array(16);
    this.nrm = new Float32Array(9);
    this.mStick = new Float32Array(16);
    this.mThrottle = new Float32Array(16);
    this.mPart = new Float32Array(16);
    this.pv = new Float32Array(16);
    // Глаз в осях кабины: сидя — ноль, на ногах — там, где голова пилота.
    this.eye = [0, 0, 0];
    this.lightC = CABIN.lightC.slice();
    this.inter = null;
    this.interOf = null;
    this.interDraws = 0;
    this.interTris = 0;
    this.draws = 0;
    this.uploads = 0;
    this.shadowPasses = 0;
    this.sunVis = 1;
  }

  /** Фотография краски: сразу нейтральный тексель, картинка — когда догрузится. */
  makePaint(load) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, NEUTRAL);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const done = (img) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      // Альфа здесь — блеск, а не прозрачность: браузер не должен ни
      // умножать на неё цвет, ни переводить цвета по профилю.
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.paintReady = true;
    };
    const ld = load || ((src, on) => {
      if (typeof Image === 'undefined') return;
      const img = new Image();
      img.onload = () => on(img);
      const v = typeof window !== 'undefined' && window.__srcStamp;
      img.src = v ? `${src}?v=${v}` : src;
    });
    ld(CABIN_TEX.file, done);
    return tex;
  }

  /** Атлас экранов под раскладку холстов (js/ui/displays.js). */
  makeAtlas(displays) {
    const gl = this.gl;
    if (this.atlas) gl.deleteTexture(this.atlas);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, displays.w, displays.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Мониторы видны под углом — без анизотропной выборки текст на
    // крайних расплывается по вертикали.
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.atlas = tex;
    this.atlasOf = displays;
    for (const d of displays.list) d.dirty = true;
  }

  /** Карта теней: текстура глубины со сравнением — сглаживает сама выборка. */
  makeShadow() {
    const gl = this.gl;
    const S = this.shadowSize;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, S, S, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.shadow = ok ? { tex, fbo } : null;
    if (!ok) this.shadowSize = 0;
  }

  /** Сетки кабины — один раз на модель (и на раскладку атласа: в ней уголки экранов). */
  build(cockpit, displays) {
    const gl = this.gl;
    if (this.parts) {
      for (const p of Object.values(this.parts)) {
        if (p) { gl.deleteBuffer(p.buf); gl.deleteVertexArray(p.vao); }
      }
    }
    const uvOf = (id) => (displays && displays.byId[id] ? displays.byId[id].uv : null);
    this.parts = {
      shell: upload(gl, cabinArrays(cockpit.shell, uvOf)),
      stick: upload(gl, cabinArrays(cockpit.stick.mesh, uvOf)),
      throttle: upload(gl, cabinArrays(cockpit.throttle.mesh, uvOf)),
      glass: upload(gl, cabinArrays(cockpit.glass, uvOf)),
      // Корпус — только в карту теней: в кадре его рисует сцена.
      hull: cockpit.hull ? upload(gl, cabinArrays(cockpit.hull, null)) : null,
    };
    this.model = cockpit;
    this.builtFor = displays;
  }

  /**
   * Сетки помещений — один раз на модель: по буферу на комнату (рисуются
   * только видимые), створка двери и ящик груза — по одному на всех.
   */
  buildInterior(interior) {
    const gl = this.gl;
    this.disposeInterior();
    const rooms = {};
    for (const r of interior.rooms) {
      const m = interior.meshes[r.id];
      if (!m || !m.tris) continue;
      const pk = packed(m, EYE);
      rooms[r.id] = { part: uploadInterior(gl, pk), lo: pk.lo, hi: pk.hi };
    }
    this.inter = {
      rooms,
      door: uploadInterior(gl, packed(interior.doorMesh)),
      crate: uploadInterior(gl, packed(interior.crateMesh)),
    };
    this.interOf = interior;
  }

  disposeInterior() {
    if (!this.inter) return;
    const gl = this.gl;
    const parts = [...Object.values(this.inter.rooms).map((r) => r.part), this.inter.door, this.inter.crate];
    for (const p of parts) { gl.deleteBuffer(p.buf); gl.deleteVertexArray(p.vao); }
    this.inter = null;
    this.interOf = null;
  }

  /** Залить в атлас перерисованные экраны. */
  uploadScreens(displays) {
    const gl = this.gl;
    let n = 0;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    for (const d of displays.list) {
      if (!d.dirty || !d.canvas) continue;
      d.dirty = false;
      try {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, d.x, d.y, gl.RGBA, gl.UNSIGNED_BYTE, d.canvas);
        n++;
      } catch (e) { /* холст недоступен (тесты) — экран останется прежним */ }
    }
    if (n) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.uploads += n;
    return n;
  }

  /**
   * Свет снаружи в осях кабины: солнце (с затмением и воздухом), небо и
   * отражённый планетой свет.
   */
  outside(game, sunPos, out) {
    const ship = game.ship, b = ship.basis, p = ship.pos;
    const toCab = (x, y, z, o) => {
      const l = Math.hypot(x, y, z) || 1;
      o[0] = (x * b.right.x + y * b.right.y + z * b.right.z) / l;
      o[1] = (x * b.up.x + y * b.up.y + z * b.up.z) / l;
      o[2] = (x * b.fwd.x + y * b.fwd.y + z * b.fwd.z) / l;
      return o;
    };
    const sx = sunPos.x - p.x, sy = sunPos.y - p.y, sz = sunPos.z - p.z;
    toCab(sx, sy, sz, out.sunL);
    let vis = game.world ? sunVisibility(game.world, p) : 1;
    const sun = [CABIN.sun[0], CABIN.sun[1], CABIN.sun[2]];
    out.sky.fill(0); out.planet.fill(0);
    out.skyDir[0] = 0; out.skyDir[1] = 1; out.skyDir[2] = 0;
    out.planetDir[0] = 0; out.planetDir[1] = -1; out.planetDir[2] = 0;

    // Ближайшее тело: от него небо, отражённый свет и краснеющее солнце.
    const body = game.zone && game.zone.body ? game.zone.body : game.capture;
    if (body && body.radius) {
      const ux = p.x - body.pos.x, uy = p.y - body.pos.y, uz = p.z - body.pos.z;
      const d = Math.hypot(ux, uy, uz) || 1;
      toCab(ux, uy, uz, out.skyDir);
      out.planetDir[0] = -out.skyDir[0]; out.planetDir[1] = -out.skyDir[1]; out.planetDir[2] = -out.skyDir[2];
      const sl = Math.hypot(sx, sy, sz) || 1;
      const elev = (ux * sx + uy * sy + uz * sz) / (d * sl);      // синус высоты солнца
      const alt = d - body.radius;
      const top = body.radius * ENTRY.top;
      if (body.atmo && alt < top) {
        const dens = Math.max(0, 1 - alt / top);
        // Воздушная масса: у горизонта путь сквозь воздух в десятки раз
        // длиннее, чем в зените.
        const mass = 1 / Math.max(0.03, elev + 0.05);
        for (let c = 0; c < 3; c++) sun[c] *= Math.exp(-CABIN.airTau[c] * mass * dens * 4);
        // Небо: днём — своим цветом, в сумерки гаснет. Под фонарём, где
        // стекло занимает чуть ли не полнеба, это главный свет кабины:
        // стойки на фоне дневного неба — тёмные, но не чёрные.
        const t = Math.max(0, Math.min(1, (elev + 0.05) / 0.3));
        const day = t * t * (3 - 2 * t) * dens;
        for (let c = 0; c < 3; c++) out.sky[c] = (body.atmo[c] / 255) * 0.85 * day;
      }
      // Отражённый свет: освещённая доля видимого диска на его угловой
      // размер (sin²α) и альбедо.
      const sa = Math.min(1, body.radius / d);
      const bsx = sunPos.x - body.pos.x, bsy = sunPos.y - body.pos.y, bsz = sunPos.z - body.pos.z;
      const phase = 0.5 + 0.5 * (ux * bsx + uy * bsy + uz * bsz) / (d * (Math.hypot(bsx, bsy, bsz) || 1));
      const col = body.color || [128, 128, 128];
      for (let c = 0; c < 3; c++) out.planet[c] = (col[c] / 255) * CABIN.albedo * sa * sa * phase;
    }
    this.sunVis = vis;
    for (let c = 0; c < 3; c++) out.sunC[c] = sun[c] * vis;
    return out;
  }

  /**
   * Нарисовать кабину.
   *
   * @param game     состояние игры: корабль, ручка, экраны, мир
   * @param cam      камера кокпита (глаз — в начале координат кабины)
   * @param sunPos   где звезда (мир)
   * @param size     [ширина, высота] кадра
   */
  prepare(game, sunPos, size) {
    const gl = this.gl;
    const cp = game.cockpit;
    const displays = game.displays || null;
    if (!cp) return 0;
    if (displays && this.atlasOf !== displays) this.makeAtlas(displays);
    if (this.model !== cp || this.builtFor !== displays) this.build(cp, displays);
    if (!this.atlas) {
      // Экранов нет (профиль без холстов): атлас в один тексель, чтобы
      // выборки в шейдере были определены.
      this.atlas = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([4, 8, 12, 255]));
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    if (displays) this.uploadScreens(displays);
    if (game.interior && this.interOf !== game.interior) this.buildInterior(game.interior);
    this.draws = 0;

    // Где глаз. Сидя — в начале координат кабины; на ногах — в голове
    // пилота (js/game/walker.js). Карта теней покрывает круг в 4.5 м и
    // стоит там, где на неё смотрят: сидя — над постом, на ногах — у
    // головы (дальше рубки солнца всё равно нет).
    const we = game.walkEye;
    if (we) { this.eye[0] = we[0] - EYE.x; this.eye[1] = we[1] - EYE.y; this.eye[2] = we[2] - EYE.z; }
    else { this.eye[0] = 0; this.eye[1] = 0; this.eye[2] = 0; }
    if (we) {
      this.lightC[0] = this.eye[0]; this.lightC[1] = this.eye[1] - 0.9; this.lightC[2] = this.eye[2];
    } else {
      this.lightC[0] = CABIN.lightC[0]; this.lightC[1] = CABIN.lightC[1]; this.lightC[2] = CABIN.lightC[2];
    }

    const L = this.light || (this.light = {
      sunL: new Float32Array(3), sunC: new Float32Array(3), sky: new Float32Array(3),
      skyDir: new Float32Array(3), planet: new Float32Array(3), planetDir: new Float32Array(3),
    });
    this.outside(game, sunPos, L);

    // Детали: ручка за ручками, РУД за тягой.
    const y = game.yoke || { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
    partMatrix(cp.stick.pivot, -y.pitch, -y.roll, y.yaw, this.mStick);
    partMatrix(cp.throttle.pivot, y.throttle || 0, 0, 0, this.mThrottle);
    const parts = [
      [this.parts.shell, IDENT], [this.parts.stick, this.mStick], [this.parts.throttle, this.mThrottle],
    ];

    // --- тени -------------------------------------------------------------
    const sunOn = L.sunC[0] + L.sunC[1] + L.sunC[2] > 0.003;
    let shadowOn = 0;
    const lb = this.lightBasis || (this.lightBasis = {
      r: new Float32Array(3), u: new Float32Array(3), f: new Float32Array(3),
    });
    if (sunOn && this.shadowSize > 0) {
      if (!this.shadow) this.makeShadow();
      if (this.shadow) {
        const F = [-L.sunL[0], -L.sunL[1], -L.sunL[2]];
        const h = Math.abs(F[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const R = [h[1] * F[2] - h[2] * F[1], h[2] * F[0] - h[0] * F[2], h[0] * F[1] - h[1] * F[0]];
        const rl = Math.hypot(R[0], R[1], R[2]) || 1;
        R[0] /= rl; R[1] /= rl; R[2] /= rl;
        const U = [F[1] * R[2] - F[2] * R[1], F[2] * R[0] - F[0] * R[2], F[0] * R[1] - F[1] * R[0]];
        lb.r.set(R); lb.u.set(U); lb.f.set(F);
        const pd = this.pDepth;
        pd.use();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fbo);
        gl.viewport(0, 0, this.shadowSize, this.shadowSize);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.clearDepth(1);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.uniform3fv(pd.loc('uLR'), lb.r);
        gl.uniform3fv(pd.loc('uLU'), lb.u);
        gl.uniform3fv(pd.loc('uLF'), lb.f);
        gl.uniform4f(pd.loc('uLC'), this.lightC[0], this.lightC[1], this.lightC[2], CABIN.lightR);
        gl.uniform2f(pd.loc('uLZ'), LZ_MID, LZ_HALF);
        gl.uniform3f(pd.loc('uEyeM'), EYE.x, EYE.y, EYE.z);
        gl.uniform1f(pd.loc('uHullPass'), 0);
        for (const [m, M] of parts) {
          gl.uniformMatrix4fv(pd.loc('uModel'), false, M);
          gl.bindVertexArray(m.vao);
          gl.drawArrays(gl.TRIANGLES, 0, m.count);
          this.draws++;
        }
        if (this.parts.hull) {
          gl.uniform1f(pd.loc('uHullPass'), 1);
          gl.uniformMatrix4fv(pd.loc('uModel'), false, IDENT);
          gl.bindVertexArray(this.parts.hull.vao);
          gl.drawArrays(gl.TRIANGLES, 0, this.parts.hull.count);
          this.draws++;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, size[0], size[1]);
        shadowOn = 1;
        this.shadowPasses++;
      }
    }

    this.shadowOn = shadowOn;
    this.partList = parts;
    return this.draws;
  }

  /**
   * Пост пилота и стекло фонаря — после корпуса изнутри, в том же буфере
   * глубины (логарифмической, коэффициент — logFC сцены для рубки).
   */
  drawPod(game, cam, size, logFC) {
    const gl = this.gl;
    const cp = game.cockpit;
    const displays = game.displays || null;
    if (!cp || !this.parts) return 0;
    const L = this.light, lb = this.lightBasis;
    const parts = this.partList;
    const shadowOn = this.shadowOn;
    const before = this.draws;
    // --- кабина -------------------------------------------------------------
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    perspective(cam.fov, size[0] / Math.max(1, size[1]), CABIN.near, CABIN.far, this.proj);
    // Кабина -> камера: поворот головы относительно корпуса и сдвиг на
    // глаз. Сдвиг считается в метрах: начало кабины смещено от глаза на
    // -eye в осях корабля, а эти оси в мире — базис корпуса.
    const b = game.ship.basis, e = this.eye;
    const off = this._off || (this._off = { x: 0, y: 0, z: 0 });
    off.x = -(b.right.x * e[0] + b.up.x * e[1] + b.fwd.x * e[2]);
    off.y = -(b.right.y * e[0] + b.up.y * e[1] + b.fwd.y * e[2]);
    off.z = -(b.right.z * e[0] + b.up.z * e[1] + b.fwd.z * e[2]);
    modelView(cam.basis, ZERO3, b, off, 1, this.view, this.nrm);
    mul4(this.proj, this.view, this.pv);

    const pc = this.pCabin;
    pc.use();
    this.game = game;
    this.bindCommon(pc, L, lb, shadowOn, displays);
    gl.uniform1f(pc.loc('uLogFC'), logFC);
    for (const [m, M] of parts) {
      gl.uniformMatrix4fv(pc.loc('uModel'), false, M);
      gl.bindVertexArray(m.vao);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
      this.draws++;
    }
    this.drawInterior(game, pc);

    // --- стекло -------------------------------------------------------------
    const pg = this.pGlass;
    pg.use();
    gl.uniformMatrix4fv(pg.loc('uProj'), false, this.proj);
    gl.uniformMatrix4fv(pg.loc('uView'), false, this.view);
    gl.uniformMatrix4fv(pg.loc('uModel'), false, IDENT);
    gl.uniform1f(pg.loc('uLogFC'), logFC);
    gl.uniform3f(pg.loc('uEye'), this.eye[0], this.eye[1], this.eye[2]);
    gl.uniform3fv(pg.loc('uSunL'), L.sunL);
    gl.uniform3fv(pg.loc('uSunC'), L.sunC);
    gl.uniform3f(pg.loc('uAmb'), CABIN.amb[0], CABIN.amb[1], CABIN.amb[2]);
    gl.uniform3f(pg.loc('uEyeM'), EYE.x, EYE.y, EYE.z);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(pg.loc('uScreens'), 5);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(this.parts.glass.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.parts.glass.count);
    this.draws++;

    // Состояние — как было: остальным проходам сцены чужие текстуры на
    // старших блоках ни к чему, а карта теней со сравнением в обычной
    // выборке — неопределённое поведение.
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    for (const u of [4, 5, 6]) {
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
    return this.draws - before;
  }

  /**
   * Помещения: видимые комнаты, двери в них и груз в трюме.
   *
   * Какие комнаты видимы, решает сама планировка (interior.visibleNow):
   * та, где глаз, и всё, куда из неё ведут проёмы и открытые двери, — в два
   * шага; дальше стены непрозрачны. Из видимых рисуются те, что в кадре.
   */
  drawInterior(game, pc) {
    const I = game.interior, R = this.inter;
    this.interDraws = 0;
    this.interTris = 0;
    if (!I || !R) return;
    const gl = this.gl;
    // Уголков экрана у этих сеток нет: атрибуты выключены и берутся
    // постоянными. Ставим их явно — их значение общее для всей программы.
    gl.vertexAttrib2f(4, 0, 0);
    gl.vertexAttrib2f(5, -1, -1);
    const vis = this.visible(game);
    const M = this.mPart;
    gl.uniformMatrix4fv(pc.loc('uModel'), false, IDENT);
    for (const id of vis) {
      const r = R.rooms[id];
      if (!r || !boxInView(this.pv, r.lo, r.hi)) continue;
      gl.bindVertexArray(r.part.vao);
      gl.drawArrays(gl.TRIANGLES, 0, r.part.count);
      this.draws++; this.interDraws++; this.interTris += r.part.count / 3;
    }
    // Двери: створка едет вдоль стены на свою ширину.
    for (const d of I.doors) {
      if (!d.rooms.some((id) => vis.includes(id))) continue;
      const sl = d.slide * d.open;
      const ox = d.origin[0] + d.tangent[0] * sl - EYE.x;
      const oy = d.origin[1] + d.tangent[1] * sl - EYE.y;
      const oz = d.origin[2] + d.tangent[2] * sl - EYE.z;
      M[0] = d.ux[0]; M[1] = d.ux[1]; M[2] = d.ux[2]; M[3] = 0;
      M[4] = d.uy[0]; M[5] = d.uy[1]; M[6] = d.uy[2]; M[7] = 0;
      M[8] = d.uz[0]; M[9] = d.uz[1]; M[10] = d.uz[2]; M[11] = 0;
      M[12] = ox; M[13] = oy; M[14] = oz; M[15] = 1;
      const lo = [ox - 1.5, oy - 0.1, oz - 1.5], hi = [ox + 1.5, oy + 2.2, oz + 1.5];
      if (!boxInView(this.pv, lo, hi)) continue;
      gl.uniformMatrix4fv(pc.loc('uModel'), false, M);
      gl.bindVertexArray(R.door.vao);
      gl.drawArrays(gl.TRIANGLES, 0, R.door.count);
      this.draws++; this.interDraws++; this.interTris += R.door.count / 3;
    }
    // Груз: ящик на каждую тонну в трюме (interior.cargo — сколько).
    if (vis.includes('hold')) {
      const k = I.crate.scale;
      const n = Math.min(I.slots.length, I.cargo || 0);
      for (let i = 0; i < n; i++) {
        const c = I.slots[i];
        const cy = Math.cos(c.yaw) * k, sy = Math.sin(c.yaw) * k;
        const ox = c.x - EYE.x, oy = c.y - EYE.y, oz = c.z - EYE.z;
        const lo = [ox - c.half, oy, oz - c.half], hi = [ox + c.half, oy + c.h, oz + c.half];
        if (!boxInView(this.pv, lo, hi)) continue;
        M[0] = cy; M[1] = 0; M[2] = -sy; M[3] = 0;
        M[4] = 0; M[5] = k; M[6] = 0; M[7] = 0;
        M[8] = sy; M[9] = 0; M[10] = cy; M[11] = 0;
        M[12] = ox; M[13] = oy; M[14] = oz; M[15] = 1;
        gl.uniformMatrix4fv(pc.loc('uModel'), false, M);
        gl.bindVertexArray(R.crate.vao);
        gl.drawArrays(gl.TRIANGLES, 0, R.crate.count);
        this.draws++; this.interDraws++; this.interTris += R.crate.count / 3;
      }
    }
    gl.uniformMatrix4fv(pc.loc('uModel'), false, IDENT);
  }

  /** Видимые комнаты: где глаз, и куда из неё видно. */
  visible(game) {
    if (this._visOverride) return this._visOverride;
    const I = game.interior;
    if (!I) return [];
    const w = game.walk;
    const here = w && w.on && w.room ? w.room.id : 'bridge';
    return I.visibleNow(here);
  }

  /**
   * Лампы на этот кадр: пост пилота и потолки видимых комнат, ближайшие
   * к глазу. Свет каждой — в коробке своей комнаты (оси кабины).
   */
  lampsFor(game) {
    const out = this._lamps || (this._lamps = []);
    out.length = 0;
    const I = game.interior;
    const vis = I ? this.visible(game) : ['bridge'];
    const e = this.eye;
    if (!this._bridgeBox || this._bridgeOf !== I) {
      const E = [EYE.x, EYE.y, EYE.z];
      this._bridgeBox = I
        ? { lo: I.sunBox.lo.map((v, i) => v - E[i]), hi: I.sunBox.hi.map((v, i) => v - E[i]) }
        : { lo: [-1e4, -1e4, -1e4], hi: [1e4, 1e4, 1e4] };
      this._bridgeOf = I;
    }
    const big = this._bridgeBox;
    if (vis.includes('bridge')) {
      for (const l of this.model.lights || []) {
        out.push({ pos: [l.pos.x, l.pos.y, l.pos.z], dir: [l.dir.x, l.dir.y, l.dir.z], cos: l.cos,
          color: l.color, range: l.range, lo: big.lo, hi: big.hi, d: 0 });
      }
    }
    if (I) {
      const glow = 0.35 + 0.65 * Math.max(0, Math.min(1, I.reactor || 0));
      const now = (game && game.now) || 0;
      for (const l of I.lamps) {
        if (!vis.includes(l.room)) continue;
        const room = I.roomById[l.room];
        const pos = [l.pos[0] - EYE.x, l.pos[1] - EYE.y, l.pos[2] - EYE.z];
        const k = l.kind === 'reactor' ? glow : 1;
        // Свет шлюза — по его циклу (js/game/airlock.js): дежурный, жёлтый
        // мигающий на стравливании и наддуве, красный при открытом люке.
        const lc = l.kind === 'lock' && I.air ? lockLight(I.air, l.room, now, this._lc || (this._lc = [0, 0, 0])) : l.color;
        out.push({
          pos, dir: l.dir, cos: l.cos, range: l.range,
          color: [lc[0] * k, lc[1] * k, lc[2] * k],
          lo: [room.lo[0] - EYE.x - 0.15, room.lo[1] - EYE.y - 0.15, room.lo[2] - EYE.z - 0.15],
          hi: [room.hi[0] - EYE.x + 0.15, room.hi[1] - EYE.y + 0.15, room.hi[2] - EYE.z + 0.15],
          d: Math.hypot(pos[0] - e[0], pos[1] - e[1], pos[2] - e[2]) / l.range,
        });
      }
    }
    // Пост пилота — первым (d = 0), остальные — по удалённости в долях
    // своей дальности.
    out.sort((a, b) => a.d - b.d);
    if (out.length > CAB_LAMPS) out.length = CAB_LAMPS;
    return out;
  }

  /**
   * Шлюзы снаружи — сквозь открытый люк: от третьего лица и с трапа или с
   * грунта. Глубина — общая со сценой и в тех же единицах (логарифм от
   * километров, logFC сцены): обшивка вокруг проёма закрывает комнату
   * честно, без своего буфера и без очистки. Солнца в шлюзе нет — его
   * коробка только рубка, — светят лампы шлюза.
   *
   * @returns сколько вызовов отрисовки ушло
   */
  drawLocksOutside(game, cam, size, sunPos, logFC) {
    const I = game.interior, air = I && I.air;
    if (!air || !game.ship) return 0;
    const vis = [];
    for (const hx of air.hatches) if (hx.open > 0.01 && !vis.includes(hx.lock)) vis.push(hx.lock);
    if (!vis.length) return 0;
    const gl = this.gl;
    if (this.interOf !== I) this.buildInterior(I);
    if (!this.atlas) {
      this.atlas = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([4, 8, 12, 255]));
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    const L = this.light || (this.light = {
      sunL: new Float32Array(3), sunC: new Float32Array(3), sky: new Float32Array(3),
      skyDir: new Float32Array(3), planet: new Float32Array(3), planetDir: new Float32Array(3),
    });
    this.outside(game, sunPos, L);
    const lb = this.lightBasis || (this.lightBasis = {
      r: new Float32Array([1, 0, 0]), u: new Float32Array([0, 1, 0]), f: new Float32Array([0, 0, 1]),
    });
    // Глаз — сама камера, в осях кабины (метры от глаза пилота).
    const ship = game.ship, b = ship.basis;
    const dx = (cam.pos.x - ship.pos.x) * 1000, dy = (cam.pos.y - ship.pos.y) * 1000, dz = (cam.pos.z - ship.pos.z) * 1000;
    const e = this.eye;
    e[0] = dx * b.right.x + dy * b.right.y + dz * b.right.z - EYE.x;
    e[1] = dx * b.up.x + dy * b.up.y + dz * b.up.z - EYE.y;
    e[2] = dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z - EYE.z;
    const before = this.draws;
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    perspective(cam.fov, size[0] / Math.max(1, size[1]), CABIN.near, CABIN.far, this.proj);
    const off = this._off || (this._off = { x: 0, y: 0, z: 0 });
    off.x = -(b.right.x * e[0] + b.up.x * e[1] + b.fwd.x * e[2]);
    off.y = -(b.right.y * e[0] + b.up.y * e[1] + b.fwd.y * e[2]);
    off.z = -(b.right.z * e[0] + b.up.z * e[1] + b.fwd.z * e[2]);
    modelView(cam.basis, ZERO3, b, off, 1, this.view, this.nrm);
    mul4(this.proj, this.view, this.pv);
    const pc = this.pCabin;
    pc.use();
    this.game = game;
    this._visOverride = vis;
    this.bindCommon(pc, L, lb, 0, null);
    gl.uniform1f(pc.loc('uLogFC'), logFC);
    this.drawInterior(game, pc);
    this._visOverride = null;
    gl.bindVertexArray(null);
    for (const u of [4, 5, 6]) {
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
    return this.draws - before;
  }

  /** Uniform-ы основного прохода кабины. */
  bindCommon(pc, L, lb, shadowOn, displays) {
    const gl = this.gl;
    const cp = this.model;
    gl.uniformMatrix4fv(pc.loc('uProj'), false, this.proj);
    gl.uniformMatrix4fv(pc.loc('uView'), false, this.view);
    gl.uniform3f(pc.loc('uEye'), this.eye[0], this.eye[1], this.eye[2]);
    gl.uniform3fv(pc.loc('uSunL'), L.sunL);
    gl.uniform3fv(pc.loc('uSunC'), L.sunC);
    gl.uniform3f(pc.loc('uAmb'), CABIN.amb[0], CABIN.amb[1], CABIN.amb[2]);
    gl.uniform3fv(pc.loc('uSkyDir'), L.skyDir);
    gl.uniform3fv(pc.loc('uSkyC'), L.sky);
    gl.uniform3fv(pc.loc('uPlanetDir'), L.planetDir);
    gl.uniform3fv(pc.loc('uPlanetC'), L.planet);
    gl.uniform1f(pc.loc('uScreenK'), CABIN.screenK);
    gl.uniform1f(pc.loc('uSpillK'), CABIN.spillK);
    gl.uniform1f(pc.loc('uLedK'), CABIN.ledK);
    gl.uniform1f(pc.loc('uPaintK'), 1 / CABIN_TEX.sizeM);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.paint);
    gl.uniform1i(pc.loc('uPaint'), 4);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(pc.loc('uScreens'), 5);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, shadowOn && this.shadow ? this.shadow.tex : null);
    gl.uniform1i(pc.loc('uShadow'), 6);
    gl.uniform1f(pc.loc('uShadowOn'), shadowOn);
    gl.uniform3fv(pc.loc('uLR'), lb.r);
    gl.uniform3fv(pc.loc('uLU'), lb.u);
    gl.uniform3fv(pc.loc('uLF'), lb.f);
    gl.uniform4f(pc.loc('uLC'), this.lightC[0], this.lightC[1], this.lightC[2], CABIN.lightR);
    gl.uniform2f(pc.loc('uLZ'), LZ_MID, LZ_HALF);
    gl.uniform1f(pc.loc('uDepthBias'), CABIN.depthBias / (2 * LZ_HALF));
    gl.uniform1f(pc.loc('uTexel'), this.shadowSize > 0 ? 1 / this.shadowSize : 0);

    // Лампы — поста пилота и видимых помещений (lampsFor).
    const lamps = this.lampsFor(this.game || { interior: null });
    const n = lamps.length;
    gl.uniform1i(pc.loc('uCabLampN'), n);
    for (let i = 0; i < n; i++) {
      const l = lamps[i];
      gl.uniform4f(pc.loc(`uCabLampP[${i}]`), l.pos[0], l.pos[1], l.pos[2], l.range);
      gl.uniform4f(pc.loc(`uCabLampD[${i}]`), l.dir[0], l.dir[1], l.dir[2], l.cos);
      gl.uniform3f(pc.loc(`uCabLampC[${i}]`), l.color[0], l.color[1], l.color[2]);
      gl.uniform3f(pc.loc(`uCabLampLo[${i}]`), l.lo[0], l.lo[1], l.lo[2]);
      gl.uniform3f(pc.loc(`uCabLampHi[${i}]`), l.hi[0], l.hi[1], l.hi[2]);
    }
    // Свет снаружи — только под стеклом рубки (коробка в осях кабины).
    const sb = this._bridgeBox || null;
    if (sb && this.game && this.game.interior) {
      gl.uniform3f(pc.loc('uSunLo'), sb.lo[0], sb.lo[1], sb.lo[2]);
      gl.uniform3f(pc.loc('uSunHi'), sb.hi[0], sb.hi[1], sb.hi[2]);
    } else {
      gl.uniform3f(pc.loc('uSunLo'), -1e4, -1e4, -1e4);
      gl.uniform3f(pc.loc('uSunHi'), 1e4, 1e4, 1e4);
    }

    // Свет экранов: центр, нормаль, место в атласе и площадь.
    let k = 0;
    if (displays) {
      for (const s of Object.values(cp.screens)) {
        const d = displays.byId[s.id];
        if (!d || k >= 8) continue;
        gl.uniform3f(pc.loc(`uSpillPos[${k}]`), s.pos.x, s.pos.y, s.pos.z);
        gl.uniform3f(pc.loc(`uSpillNrm[${k}]`), s.normal.x, s.normal.y, s.normal.z);
        // Уровень мипа, на котором экран — один-два текселя: это и есть
        // его средний цвет.
        const lod = Math.max(0, Math.floor(Math.log2(Math.min(d.w, d.h) || 1)));
        gl.uniform4f(pc.loc(`uSpillUv[${k}]`), d.uv[0] + d.uv[2] / 2, d.uv[1] + d.uv[3] / 2, s.w * s.h, lod);
        k++;
      }
    }
    gl.uniform1i(pc.loc('uSpillN'), k);
  }

  dispose() {
    const gl = this.gl;
    this.disposeInterior();
    if (this.parts) {
      for (const p of Object.values(this.parts)) if (p) { gl.deleteBuffer(p.buf); gl.deleteVertexArray(p.vao); }
    }
    if (this.atlas) gl.deleteTexture(this.atlas);
    if (this.paint) gl.deleteTexture(this.paint);
    if (this.shadow) { gl.deleteTexture(this.shadow.tex); gl.deleteFramebuffer(this.shadow.fbo); }
    this.parts = null; this.atlas = null; this.shadow = null;
  }
}
