// Струя движков в вершинном шейдере растений.
//
// Физика — в js/game/downwash.js, здесь только её перенос на видеокарту:
// те же две струи и тот же отклик растения. Считать наклон на процессоре
// значило бы пересобирать поле в тысячу деревьев каждый кадр; на
// видеокарте это одна функция на вершину.
//
// Как устроен изгиб. У каждой вершины растения есть две величины
// (aBend): доля высоты от комля (0 у земли, 1 на макушке), высота
// самого растения и его фаза. Этого хватает, чтобы найти комель — он
// ровно под вершиной, на её доле высоты, — и повернуть вершину вокруг
// него. Угол растёт к макушке линейно, поэтому смещение растёт как
// квадрат высоты: так гнётся консольная балка под ветром, а не ломаная
// палка.
//
// Всё в осях МОДЕЛИ поля (км от его центра, оси тела): там же лежат и
// вершины, и никаких матриц на вершину не нужно.

import { WASH, BEND } from '../game/downwash.js';

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const DEG = Math.PI / 180;

export const WASH_GLSL = `
in vec3 aBend;             // (доля высоты, высота растения в км, фаза 0..1)
uniform float uWashOn;
uniform vec3 uWashP;       // точка удара подъёмной струи
uniform vec3 uWashUp;      // местная вертикаль
uniform vec2 uWashQ;       // (напор на оси, Па; напор × r² настильной струи, Па·км²)
uniform vec3 uMainP;       // сопла маршевых
uniform vec3 uMainDir;     // куда бьёт их струя
uniform float uMainQ;      // напор × x² на оси маршевой струи, Па·км²
uniform float uWashTime;   // с

const float W_SPREAD = ${f(WASH.spread)};
const float W_QREF = ${f(BEND.qRef)};
const float W_GRASS_H = ${f(BEND.grass.h)};
const float W_TREE_H = ${f(BEND.tree.h)};
const float W_GRASS_REF = ${f(BEND.grass.ref * DEG)};
const float W_TREE_REF = ${f(BEND.tree.ref * DEG)};
const float W_GRASS_CAP = ${f(BEND.grass.cap * DEG)};
const float W_TREE_CAP = ${f(BEND.tree.cap * DEG)};
const float W_GRASS_HZ = ${f(BEND.grass.hz)};
const float W_TREE_HZ = ${f(BEND.tree.hz)};

// Напор в точке грунта и куда он толкает (js/game/downwash.js, washAt).
vec3 washPush(vec3 base) {
  vec3 up = uWashUp;
  vec3 push = vec3(0.0);
  if (uWashQ.x > 0.0) {
    vec3 e = base - uWashP;
    vec3 h = e - up * dot(e, up);
    float r = max(length(h), 1e-6);
    push += h / r * min(uWashQ.x, uWashQ.y / (r * r));
  }
  if (uMainQ > 0.0) {
    vec3 m = base - uMainP;
    float x = dot(m, uMainDir);
    if (x > 0.002) {
      vec3 perp = m - uMainDir * x;
      float bw = W_SPREAD * x;
      float q = uMainQ / (x * x) * exp(-1.3863 * dot(perp, perp) / (bw * bw));
      vec3 d = uMainDir - up * dot(uMainDir, up);
      float dl = length(d);
      if (dl > 1e-3) push += d / dl * q;
    }
  }
  return push;
}

// Изгиб вершины p (и её нормали) под струёй.
vec3 washBend(vec3 p, inout vec3 nrm) {
  float hv = aBend.x * aBend.y;             // высота вершины над комлем, км
  vec3 base = p - uWashUp * hv;
  vec3 push = washPush(base);
  float q = length(push);
  // Напор меньше паскаля — ветер слабее полутора метров в секунду:
  // лист и тот не шелохнётся.
  if (q < 1.0) return p;
  vec3 dir = push / q;
  float hm = aBend.y * 1000.0;
  float k = clamp(log(hm / W_GRASS_H) / log(W_TREE_H / W_GRASS_H), 0.0, 1.0);
  float ref = mix(W_GRASS_REF, W_TREE_REF, k);
  float cap = mix(W_GRASS_CAP, W_TREE_CAP, k);
  float th = cap * (1.0 - exp(-ref * q / W_QREF / cap));
  // Порывы. Струя турбулентна (пульсации в настильной струе — четверть
  // средней скорости), и растение отвечает на них на своей частоте:
  // трава треплется, дерево раскачивается медленно. Фаза у каждого
  // растения своя — иначе лес качался бы строем.
  float hz = mix(W_GRASS_HZ, W_TREE_HZ, k);
  float ph = aBend.z * 6.2832;
  float t = uWashTime * 6.2832 * hz;
  float gust = 0.8 + 0.2 * sin(t + ph) + 0.1 * sin(t * 2.7 + ph * 1.3);
  float b = th * gust * aBend.x;
  float c = cos(b), s = sin(b);
  vec3 axis = normalize(cross(uWashUp, dir));
  nrm = nrm * c + cross(axis, nrm) * s + axis * dot(axis, nrm) * (1.0 - c);
  return p + (dir * s - uWashUp * (1.0 - c)) * hv;
}
`;

/**
 * Uniform-ы струи для поля растений.
 *
 * @param w  состояние струи (js/game/downwash.js, washState), оси тела
 * @param origin центр поля растений, км в осях тела
 * @param time секунды — для порывов
 */
export function washUniforms(gl, prog, w, origin, time) {
  const on = !!(w && w.on);
  gl.uniform1f(prog.loc('uWashOn'), on ? 1 : 0);
  if (!on) return;
  const o = origin;
  gl.uniform3f(prog.loc('uWashP'), w.hit.x - o.x, w.hit.y - o.y, w.hit.z - o.z);
  gl.uniform3f(prog.loc('uWashUp'), w.up.x, w.up.y, w.up.z);
  const lift = w.T > 0 && w.h < Infinity;
  // Напор на оси под кораблём и коэффициент настильной струи; расстояния
  // в шейдере в километрах, отсюда 1e-6 при переводе из метров в квадрате.
  gl.uniform2f(prog.loc('uWashQ'),
    lift ? 0.5 * w.T * (WASH.jetK / w.h) ** 2 : 0,
    lift ? 0.5 * w.T * WASH.wallK * WASH.wallK * 1e-6 : 0);
  gl.uniform3f(prog.loc('uMainP'), w.nozzle.x - o.x, w.nozzle.y - o.y, w.nozzle.z - o.z);
  gl.uniform3f(prog.loc('uMainDir'), w.aft.x, w.aft.y, w.aft.z);
  gl.uniform1f(prog.loc('uMainQ'), 0.5 * w.Tm * WASH.jetK * WASH.jetK * 1e-6);
  gl.uniform1f(prog.loc('uWashTime'), time % 3600);
}

