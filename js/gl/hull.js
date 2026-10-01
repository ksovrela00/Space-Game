// Узор обшивки корабля: швы панелей, переплёт мостика, решётка сопел.
//
// Разметка — какая грань что — делается при сборке корпуса
// (js/models/hulldetail.js) и приезжает атрибутом aMat. Здесь узор
// мельче граней: делать его геометрией значило бы умножить модель в
// десятки раз.
//
// ПОЧЕМУ ПРОЦЕДУРНО, а не фотографией, как грунт. Готовой CC0-обшивки
// корабля не нашлось: у ambientCG «научно-фантастические» панели — это
// восьмиугольная плитка (то самое «кафель», от которого уходили на
// грунте), у Poly Haven стальные листы 34×50 см — с семидесяти метров
// это три пикселя, то есть та же плитка. А у настоящей обшивки панели
// большие и неравные, и лежат они вдоль корпуса.
//
// КООРДИНАТА — в метрах модели, по преобладающей оси нормали грани:
// у соседних граней с одной осью координаты общие, и шов переходит
// через ребро не ломаясь, как у настоящей обшивки. Длинная сторона
// панелей — вдоль корабля (ось z): так идут стрингеры.
//
// СГЛАЖИВАНИЕ честное: шов в пять сантиметров с семидесяти метров уже
// тоньше пикселя, и точечная выборка давала бы мерцающую сетку. Доля
// пикселя, закрытая швом, считается как пересечение отрезков — вдали
// шов плавно растворяется в едва заметное потемнение, а не рябит.

import { MAT, BRIDGE } from '../models/hulldetail.js';

export const HULL = {
  row: 2.2,          // м — высота ряда панелей
  cell: 3.6,         // м — длина ячейки ряда; внутри она делится на 1–3 панели
  seam: 0.05,        // м — ширина шва
  seamDark: 0.55,    // во сколько раз шов темнее панели
  tone: 0.08,        // разброс тона между панелями
  hatch: 0.05,       // доля панелей-люков
  hatchInset: 0.3,   // м — рамка люка от края панели
  // Переплёт мостика: стекло метр тридцать на метр — окно в рост
  // человека. Ровно этим фонарь истребителя и превращается в мостик.
  paneU: 1.3,
  paneV: 1.0,
  mullion: 0.14,     // м — ширина стойки переплёта
  // Свет изнутри мостика — постоянный, как у окон (см. hulldetail.js).
  bridgeGlow: [0.30, 0.24, 0.15],
  // Решётка сопла подъёмного движка.
  slat: 0.42,        // м — шаг ламелей
  // Жар в сопле: на полном ходу подъёмных — раскалённое нутро, на
  // зависании (треть хода) — тусклое тление.
  ventHot: [1.0, 0.42, 0.14],
};

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const v3s = (a) => `vec3(${a.map(f).join(', ')})`;

/**
 * Переплёт мостика: доля стойки в точке p (м, оси модели) с нормалью nl.
 * Нужен в двух местах — в обшивке и в карте теней кабины (солнце на
 * доску падает сквозь этот же переплёт), — поэтому отдельной функцией.
 */
export const HULL_FRAME_GLSL = `
const float H_PANE_U = ${f(HULL.paneU)};
const float H_PANE_V = ${f(HULL.paneV)};
const float H_MULL = ${f(HULL.mullion)};
const vec3 H_EYE = vec3(${f(BRIDGE.eye.x)}, ${f(BRIDGE.eye.y)}, ${f(BRIDGE.eye.z)});
const float H_WS_AZ = ${f(BRIDGE.screenAz * Math.PI / 180)};
const float H_WS_EL = ${f(BRIDGE.screenEl * Math.PI / 180)};
const float H_WS_FRAME = ${f(BRIDGE.screenFrame * Math.PI / 180)};

// Доля пикселя шириной e, закрытая линией ширины w, до которой d.
float hCover(float d, float e, float w) {
  float lo = max(d - e * 0.5, -w * 0.5);
  float hi = min(d + e * 0.5, w * 0.5);
  return clamp((hi - lo) / max(e, 1e-5), 0.0, 1.0);
}

// Расстояние до ближайшего шва сетки с шагом s.
float hGrid(float x, float s) {
  float t = x / s;
  return abs(t - floor(t + 0.5)) * s;
}

// Координата на грани, м: по преобладающей оси нормали.
vec2 hullUv(vec3 p, vec3 nl) {
  vec3 a = abs(nl);
  if (a.y >= a.x && a.y >= a.z) return vec2(p.z, p.x);    // крыша и днище
  if (a.x >= a.z) return vec2(p.z, p.y);                  // борта
  return vec2(p.x, p.y);                                  // нос и корма
}

// Переплёт: сетка стёкол в рост человека, а перед пилотом — цельное
// лобовое стекло в раме, заданное углами от его глаза (см. BRIDGE в
// js/models/hulldetail.js).
float hullFrame(vec3 p, vec2 uv, vec2 fw) {
  vec3 d = p - H_EYE;
  if (d.z > 0.0) {
    float az = abs(atan(d.x, d.z));
    float el = atan(d.y, length(d.xz));
    float m = min(H_WS_AZ - az, H_WS_EL - el);
    if (m > 0.0) return hCover(m, max(fw.x, fw.y) / max(length(d), 0.05), H_WS_FRAME * 2.0);
  }
  float du = hGrid(uv.x, H_PANE_U), dv = hGrid(uv.y, H_PANE_V);
  return max(hCover(du, fw.x, H_MULL), hCover(dv, fw.y, H_MULL));
}
`;

/** Сколько коробок выреза помещений помещается в шейдер. */
export const CARVE_MAX = 6;

export const HULL_GLSL = `
in float vMat;
in vec3 vNormalL;
uniform float uLiftGlow;   // работа подъёмных движков, 0..1
uniform float uSkyK;       // яркость неба, отражённого стеклом (0 — ночь или пустота)
// Корпус изнутри (вид из рубки): стёкла сквозные, остаётся переплёт.
uniform float uHullInside;
// Помещения корабля вырезаны из корпуса изнутри (js/models/interior.js,
// carve): у модели пака под обшивкой лежат внутренние грани деталей, и
// без выреза они резали бы комнаты пополам. Коробки — в метрах модели.
uniform int uCarveN;
uniform vec3 uCarveLo[${CARVE_MAX}];
uniform vec3 uCarveHi[${CARVE_MAX}];
bool hullCarved(vec3 p) {
  for (int i = 0; i < ${CARVE_MAX}; i++) {
    if (i >= uCarveN) break;
    if (all(greaterThan(p, uCarveLo[i])) && all(lessThan(p, uCarveHi[i]))) return true;
  }
  return false;
}

const float H_ROW = ${f(HULL.row)};
const float H_CELL = ${f(HULL.cell)};
const float H_SEAM = ${f(HULL.seam)};
${HULL_FRAME_GLSL}

float hHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Обшивка: сколько шва в пикселе и тон панели.
void hullPlate(vec2 uv, vec2 fw, out float seam, out float tone) {
  float row = floor(uv.y / H_ROW);
  float fy = uv.y - row * H_ROW;
  float dy = min(fy, H_ROW - fy);
  float off = hHash(vec2(row, 7.0)) * H_CELL;             // ряды вразбежку
  float u = uv.x + off;
  float cx = floor(u / H_CELL);
  float fx = u - cx * H_CELL;
  float s = hHash(vec2(row, cx));
  // Ячейка делится на одну, две или три панели.
  float parts = s < 0.35 ? 1.0 : (s < 0.72 ? 2.0 : 3.0);
  float w = H_CELL / parts;
  float k = floor(fx / w);
  float px = fx - k * w;
  float dx = min(px, w - px);
  // Иногда ряд в ячейке делится ещё и пополам по высоте.
  float split = hHash(vec2(cx, row + 31.0));
  float sub = 0.0;
  if (split < 0.22) {
    float dh = abs(fy - H_ROW * 0.5);
    sub = fy > H_ROW * 0.5 ? 1.0 : 0.0;
    dy = min(dy, dh);
  }
  float id = hHash(vec2(cx * 3.0 + k, row * 2.0 + sub));
  seam = max(hCover(dx, fw.x, H_SEAM), hCover(dy, fw.y, H_SEAM));
  // Люк: рамка внутри панели на hatchInset от её краёв.
  if (id < ${f(HULL.hatch)}) {
    float din = abs(min(dx, dy) - ${f(HULL.hatchInset)});
    seam = max(seam, hCover(din, max(fw.x, fw.y), H_SEAM * 0.8));
  }
  // Разброс тона гаснет вдали: там панель мельче пикселя, и её тон —
  // уже не пятно, а шум.
  float far = smoothstep(0.35, 1.1, max(fw.x, fw.y));
  tone = 1.0 + (id - 0.5) * ${f(HULL.tone)} * (1.0 - far);
}

/**
 * Узор обшивки. Меняет цвет и нормаль грани, добавляет своё свечение.
 */
void hullDetail(vec3 viewPos, inout vec3 n, inout vec3 albedo, inout vec3 emit) {
  float mat = floor(vMat + 0.5);
  vec3 p = vLocal * 1000.0;                 // модель в км, узор в метрах
  vec2 uv = hullUv(p, vNormalL);
  vec2 fw = vec2(length(vec2(dFdx(uv.x), dFdy(uv.x))), length(vec2(dFdx(uv.y), dFdy(uv.y))));
  fw = max(fw, vec2(1e-4));

  if (mat == ${f(MAT.plate)}) {
    float seam, tone;
    hullPlate(uv, fw, seam, tone);
    albedo *= tone * mix(1.0, ${f(HULL.seamDark)}, seam);
    return;
  }

  if (mat == ${f(MAT.glass)}) {
    // Переплёт мостика.
    float frame = hullFrame(p, uv, fw);
    // Из рубки стекло СКВОЗНОЕ: пилот смотрит сквозь него на свой нос и
    // на мир, а стекло как таковое (отражение, пыль) кладёт проход
    // кабины поверх (js/gl/cabin.js). Остаётся только переплёт.
    if (uHullInside > 0.5 && frame < 0.5) discard;
    vec2 pane = floor(uv / vec2(${f(HULL.paneU)}, ${f(HULL.paneV)}));
    float lit = hHash(pane + 17.0) < 0.8 ? 1.0 : 0.2;
    // Стекло тёмное и отражает небо — днём, под воздухом. Отражение
    // берётся по вертикали отражённого луча в осях камеры: у почти
    // горизонтальной камеры её «верх» и есть верх мира.
    vec3 r = reflect(normalize(viewPos), n);
    float sky = smoothstep(-0.15, 0.5, r.y) * uSkyK;
    float fres = 0.25 + 0.75 * pow(1.0 - abs(dot(normalize(viewPos), n)), 3.0);
    vec3 glass = vec3(0.035, 0.045, 0.06);
    vec3 refl = vec3(0.42, 0.55, 0.75) * sky * fres * 0.6;
    albedo = mix(glass, vec3(0.2, 0.21, 0.23), frame);
    emit += (refl + ${v3s(HULL.bridgeGlow)} * lit) * (1.0 - frame);
    return;
  }

  if (mat == ${f(MAT.vent)}) {
    // Ламели поперёк корпуса и жар между ними.
    float d = hGrid(uv.x, ${f(HULL.slat)});
    float slat = hCover(d, fw.x, ${f(HULL.slat)} * 0.45);
    float glow = pow(clamp(uLiftGlow, 0.0, 1.0), 0.7);
    albedo = mix(vec3(0.05), vec3(0.16, 0.16, 0.17), slat);
    emit += ${v3s(HULL.ventHot)} * glow * 0.85 * (1.0 - slat);
    return;
  }
}
`;

/**
 * То же, что hullFrame в шейдере, для проверок: стоит ли в точке p (м,
 * оси модели) стойка переплёта (без сглаживания — да или нет).
 */
export function hullFrameAt(p, nl) {
  const a = { x: Math.abs(nl.x), y: Math.abs(nl.y), z: Math.abs(nl.z) };
  const uv = a.y >= a.x && a.y >= a.z ? [p.z, p.x] : (a.x >= a.z ? [p.z, p.y] : [p.x, p.y]);
  const d = { x: p.x - BRIDGE.eye.x, y: p.y - BRIDGE.eye.y, z: p.z - BRIDGE.eye.z };
  if (d.z > 0) {
    const az = Math.abs(Math.atan2(d.x, d.z)) * 180 / Math.PI;
    const el = Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180 / Math.PI;
    const m = Math.min(BRIDGE.screenAz - az, BRIDGE.screenEl - el);
    if (m > 0) return m < BRIDGE.screenFrame;
  }
  const grid = (x, st) => { const t = x / st; return Math.abs(t - Math.floor(t + 0.5)) * st; };
  return grid(uv[0], HULL.paneU) < HULL.mullion / 2 || grid(uv[1], HULL.paneV) < HULL.mullion / 2;
}
