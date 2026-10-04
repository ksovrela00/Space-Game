// Вода на планетах: волны, прибой, свет в толще и блик солнца.
//
// Своей сетки у моря нет и не будет. Море — это грунт, срезанный по
// радиусу тела (js/gl/terrain.js, sample): ровная сфера на уровне моря.
// Всё, чем вода отличается от суши, считается в шейдере поверхности
// (js/gl/shaders.js, MESH_FS) поверх той же сетки:
//
//   урез        — по ВЫСОТЕ НАД МОРЕМ в каждом пикселе, а не по цвету
//                 вершин. Высота по сетке приходит в альфе цвета вершины
//                 (у грунта водного мира она свободна: светиться грунту
//                 нечем), к ней добавляются мелкие октавы, которые и так
//                 считает деталь. Это та же функция, по которой игра
//                 решает «вода или суша» (js/game/surface.js, waterAt), —
//                 берег на экране там же, где о него разбиваются.
//   толща       — свет гаснет в воде по закону Бугера: красный за метры,
//                 синий за десятки метров. Отсюда бирюза отмели над
//                 песком и синь глубины — без единой подобранной краски
//                 на «мелко» и «глубоко».
//   поверхность — восемь волн разной длины, по дисперсии глубокой воды
//                 (ω² = g·k, g — тяжесть этого тела). Нормаль — по ним,
//                 отражение неба — по Френелю, блик солнца — по
//                 распределению наклонов. Волна мельче пикселя не
//                 рисуется, а уходит в шероховатость: вдали море не
//                 рябит, а честно размазывает блик в солнечную дорожку.
//   прибой      — гребни идут по линиям равной глубины к берегу, у кромки
//                 пена, урез накатывает на пляж и откатывается, за ним
//                 остаётся мокрый песок.
//
// ОДНО МОРЕ НА ВСЕХ. Волны привязаны к телу (оси тела, семя тела), а
// время — общее мировое (world.time, его ведёт сервер, js/game/clock.js).
// Два пилота над одной бухтой видят один и тот же гребень в одном и том же
// месте. Хранить для этого не нужно ничего: всё выводится из семени и
// часов.
//
// ТОЧНОСТЬ. Фаза волны — это k·(точка на теле) − ω·t, и оба слагаемых
// огромны: точка в тысячах километров от центра, часы — в днях. Во
// float32 от метровой волны осталась бы каша. Поэтому фаза делится:
// крупное (где камера на теле, который час) считается здесь, в double,
// раз на кадр и по модулю 2π, а в шейдер уходит только смещение
// фрагмента от КАМЕРЫ — там, где волны вообще видны, это метры и сотни
// метров, и float32 их держит до долей миллиметра.

import { makeRng } from '../core/rng.js';
import { surfaceG } from '../game/gravity.js';

const TAU = Math.PI * 2;

const f = (x) => {
  const s = String(x);
  return s.includes('.') || s.includes('e') ? s : s + '.0';
};
const v3 = (a) => `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;

export const WATER = {
  // Волн на поверхности. Восемь хватает, чтобы узор не читался
  // повторяющимся, и дёшево: на пиксель восемь косинусов.
  waves: 8,
  // Длины волн, м: от зыби до ряби. Шаг ~1.7 — соседние не сливаются
  // в одну и не оставляют дыры в спектре.
  lengths: [52, 31, 19, 11, 6.5, 3.8, 2.2, 1.3],
  // Наклон волны (амплитуда × k). Средний квадрат наклона всего моря —
  // половина суммы квадратов, здесь 0.013: это слабый ветер, метра три в
  // секунду (Кокс и Манк, 1954: 0.003 + 0.005 на каждый м/с ветра).
  // Зыбь положе ряби: длинная волна с крутизной ряби легла бы на море
  // ровными полосами — гофром, а не волнением.
  slopes: [0.045, 0.05, 0.055, 0.055, 0.05, 0.045, 0.04, 0.035],
  // Разброс направлений вокруг ветра: волны одного ветра идут веером, а
  // не строем. Узкий веер (0.55) клал зыбь в одну сторону, и море с
  // трёхсот метров читалось гофрированным листом.
  spread: 1.1,
  // Волна уходит в шероховатость, когда пиксель покрывает эту долю её
  // длины: от lo она начинает гаснуть, к hi её нет.
  fadeLo: 0.12,
  fadeHi: 0.3,
  // Собственная шероховатость ровной воды (квадрат наклона): даже штиль
  // не зеркало.
  rough0: 0.0006,
  // Поглощение в воде, 1/м, по каналам R, G, B. Близко к настоящей
  // морской воде (красный ~0.35, зелёный ~0.06, синий ~0.02): под
  // метром воды песок уже бирюзовый, под тридцатью дна не видно.
  absorb: [0.40, 0.06, 0.024],
  // Свет, рассеянный самой толщей, — цвет глубокой воды под солнцем.
  deep: [0.012, 0.062, 0.11],
  // Пена: почти белая, чуть в синеву.
  foam: [0.88, 0.92, 0.95],
  // Прибой. Гребни — линии равной глубины, шаг между ними по глубине,
  // м: на пляже с уклоном в 3% это тридцать метров по горизонтали.
  surfStep: 1.0,
  surfZone: 1.6,      // м — глубже прибоя нет, это уже открытая вода
  surfPeriod: 9,      // с между гребнями
  // Накат: на сколько метров по высоте урез поднимается на пляж. На
  // уклоне в 3% это десять метров по горизонтали.
  swash: 0.3,
  // Мокрый песок: насколько темнее сухого. Мокрый песок темнее вдвое и
  // больше — вода заполняет поры, и свет меньше рассеивается назад.
  wetDark: 0.45,
  // Глубже этого (км) деталь грунта на пикселе не считается вовсе: урез
  // ею уже не сдвинуть, а дна под такой толщей не видно. Над открытым
  // морем это снимает двадцать вызовов шума с каждого пикселя.
  skipDeep: 0.15,
  // Небо в отражении: столб воздуха вдоль луча в единицах вертикального.
  // 1.56 — это свечение неба в зените 79% (см. «Небо планеты», замер
  // «с грунта небо яркое: свечение 79%»): 1 − e^(−1.56) = 0.79. У
  // горизонта столб толще в 1/sin раз, и небо светлее — как и у луча.
  skyTau: 1.56,
};

// Шероховатость, когда ВСЕ волны мельче пикселя: их наклоны целиком.
const ROUGH_ALL = WATER.slopes.reduce((s, x) => s + 0.5 * x * x, 0);

/**
 * Волны тела: направления в осях тела, волновые числа, частоты, фазы.
 * Детерминированно из имени и номера тела — у всех игроков одно и то же.
 */
export function waveSet(body) {
  if (body._waves) return body._waves;
  const rng = makeRng((hashName(body.name + '#' + body.id) ^ 0x3a7e5) >>> 0);
  // Ветер — одно направление на всё тело, волны веером вокруг него. Это
  // направление в пространстве осей тела: на сфере его проекция на
  // касательную плоскость и задаёт, куда в этом месте бегут волны.
  const wind = unit([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]);
  const g = Math.max(0.5, surfaceG(body));     // м/с²
  const dirs = [], k = [], omega = [], phase = [];
  for (let i = 0; i < WATER.waves; i++) {
    const d = unit([
      wind[0] + rng.range(-1, 1) * WATER.spread,
      wind[1] + rng.range(-1, 1) * WATER.spread,
      wind[2] + rng.range(-1, 1) * WATER.spread,
    ]);
    const ki = TAU / WATER.lengths[i];
    dirs.push(d);
    k.push(ki);
    // Дисперсия глубокой воды: длинная волна бежит быстрее короткой.
    omega.push(Math.sqrt(g * ki));
    phase.push(rng.range(0, TAU));
  }
  body._waves = { dirs, k, omega, phase, slope: WATER.slopes.slice(), g };
  return body._waves;
}

/**
 * Uniform'ы воды на кадр: направления волн в осях камеры и их фазы в
 * точке камеры на текущий момент мира.
 *
 * @param waves    waveSet(body)
 * @param camBasis базис камеры (right/up/fwd)
 * @param camPos   положение камеры, км (мир)
 * @param bodyBasis базис тела, bodyPos — центр тела, км (мир)
 * @param time     мировое время, с — общее для всех (сервер)
 * @param out      { dir: Float32Array(3N), wave: Float32Array(4N), shore }
 */
export function waterFrame(waves, camBasis, camPos, bodyBasis, bodyPos, time, out) {
  const cr = camBasis.right, cu = camBasis.up, cf = camBasis.fwd;
  const bx = bodyBasis.right, by = bodyBasis.up, bz = bodyBasis.fwd;
  // Камера в осях тела, метры. Считается в double: это тысячи километров.
  const dx = camPos.x - bodyPos.x, dy = camPos.y - bodyPos.y, dz = camPos.z - bodyPos.z;
  const cx = (dx * bx.x + dy * bx.y + dz * bx.z) * 1000;
  const cy = (dx * by.x + dy * by.y + dz * by.z) * 1000;
  const cz = (dx * bz.x + dy * bz.y + dz * bz.z) * 1000;
  for (let i = 0; i < waves.k.length; i++) {
    const d = waves.dirs[i];
    // Направление волны в мире, потом в осях камеры.
    const wx = d[0] * bx.x + d[1] * by.x + d[2] * bz.x;
    const wy = d[0] * bx.y + d[1] * by.y + d[2] * bz.y;
    const wz = d[0] * bx.z + d[1] * by.z + d[2] * bz.z;
    out.dir[i * 3] = wx * cr.x + wy * cr.y + wz * cr.z;
    out.dir[i * 3 + 1] = wx * cu.x + wy * cu.y + wz * cu.z;
    out.dir[i * 3 + 2] = wx * cf.x + wy * cf.y + wz * cf.z;
    out.wave[i * 4] = waves.k[i];
    out.wave[i * 4 + 1] = waves.slope[i];
    out.wave[i * 4 + 2] = wavePhase(waves, i, cx, cy, cz, time);
    out.wave[i * 4 + 3] = 0;
  }
  out.shore = mod2pi(TAU * time / WATER.surfPeriod);
  return out;
}

/** Фаза волны i в точке (м, оси тела) в момент time — по модулю 2π. */
export function wavePhase(waves, i, x, y, z, time) {
  const d = waves.dirs[i];
  return mod2pi(waves.k[i] * (d[0] * x + d[1] * y + d[2] * z) - waves.omega[i] * time + waves.phase[i]);
}

export const makeWaterFrame = (n = WATER.waves) => ({
  dir: new Float32Array(n * 3), wave: new Float32Array(n * 4), shore: 0,
});

const mod2pi = (a) => ((a % TAU) + TAU) % TAU;

function unit(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function hashName(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- шейдер ----------------------------------------------------------------------
//
// Кусок фрагментного шейдера поверхности (MESH_FS). uWater = 0 — тело
// без жидкого моря (или вовсе не грунт), и весь блок пропускается одним
// сравнением. Суша выше наката — тоже: см. MESH_FS.
export const WATER_GLSL = `
uniform float uWater;
uniform float uSeaR;                  // радиус тела, км: деталь в долях радиуса -> км
uniform vec3 uSeaSky;                 // цвет воздуха тела — небо в отражении
uniform vec3 uWaveDir[${WATER.waves}];      // направление волны в осях камеры
uniform vec4 uWave[${WATER.waves}];         // k (рад/м), наклон, фаза у камеры (рад), —
uniform float uShoreT;                // фаза прибоя (рад)

const int SEA_WAVES = ${WATER.waves};
const vec3 SEA_ABSORB = ${v3(WATER.absorb)};
const vec3 SEA_DEEP = ${v3(WATER.deep)};
const vec3 SEA_FOAM = ${v3(WATER.foam)};
const float SEA_ROUGH0 = ${f(WATER.rough0)};
const float SEA_FADE_LO = ${f(WATER.fadeLo)};
const float SEA_FADE_HI = ${f(WATER.fadeHi)};
const float SURF_K = ${f(TAU / WATER.surfStep)};
const float SURF_ZONE = ${f(WATER.surfZone)};
const float SEA_SWASH = ${f(WATER.swash / 1000)};
const float SEA_WET_DARK = ${f(WATER.wetDark)};
const float SEA_SKIP_DEEP = ${f(WATER.skipDeep)};
const float SEA_SKY_TAU = ${f(WATER.skyTau)};
const float SEA_ROUGH_ALL = ${f(ROUGH_ALL)};

// Наклон моря от волн в осях камеры (касательный к up), шероховатость
// от волн мельче пикселя и фазы двух длинных волн — ими рвётся прибой.
// pm — точка от камеры, м; fwM — след пикселя на воде, м.
vec3 seaSlope(vec3 pm, vec3 up, float fwM, out float rough2, out vec2 longPh) {
  vec3 g = vec3(0.0);
  rough2 = 0.0;
  longPh = vec2(uWave[0].x * dot(uWaveDir[0], pm) + uWave[0].z,
                uWave[1].x * dot(uWaveDir[1], pm) + uWave[1].z);
  // Даже самая длинная волна мельче пикселя (вдали, с орбиты) — рисовать
  // нечего: все наклоны уходят в шероховатость разом, без восьми косинусов.
  if (fwM * uWave[0].x > 6.2831853 * SEA_FADE_HI) {
    rough2 = SEA_ROUGH_ALL;
    return g;
  }
  for (int i = 0; i < SEA_WAVES; i++) {
    vec4 w = uWave[i];
    float ph = w.x * dot(uWaveDir[i], pm) + w.z;
    // Мельче пикселя волна не рисуется, а уходит в шероховатость: иначе
    // вдали море кипит рябью, которой глаз там видеть не может.
    float vis = 1.0 - smoothstep(SEA_FADE_LO, SEA_FADE_HI, fwM * w.x / 6.2831853);
    g += uWaveDir[i] * (w.y * vis * cos(ph));
    rough2 += 0.5 * w.y * w.y * (1.0 - vis);
  }
  return g - up * dot(g, up);
}

// Цвет моря в пикселе: толща над дном, небо в отражении, блик солнца.
// bed — дно (цвет грунта под водой), depthM — толща, м; lit — освещённость
// (как у грунта: рассеянный, солнце, фары), sunVis — солнце не закрыто.
vec3 seaColor(vec3 bed, vec3 nW, vec3 up, vec3 V, float depthM, float lit,
              float sunVis, float rough2) {
  float cv = max(dot(up, V), 0.05);
  float cs = max(dot(up, uSunDir), 0.05);
  // Свет спускается к дну и поднимается к глазу — дважды через толщу.
  vec3 T = exp(-SEA_ABSORB * depthM * (1.0 / cs + 1.0 / cv));
  vec3 under = bed * lit * T + SEA_DEEP * lit * (1.0 - exp(-SEA_ABSORB * depthM * 2.0));

  // Отражение неба по Френелю: под ногами вода прозрачна, к горизонту —
  // зеркало. Луч, ушедший под горизонт (наклон волны), поднимаем к нему:
  // ниже горизонта отражать нечего, кроме той же воды.
  float nv = max(dot(nW, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  // Небо в отражении — столб воздуха вдоль отражённого луча: у горизонта
  // он толще в 1/sin раз и светится ярче. Одна экспонента: честный луч
  // воздуха (airAlong, шестнадцать шагов) на каждый пиксель моря стоил
  // кадров — моря на экране бывает половина, а у пляжа его считают и под
  // обшивкой корабля, которую грунт потом закрывает.
  float ru = max(dot(reflect(-V, nW), up), 0.05);
  vec3 sky = uSeaSky * (1.0 - exp(-SEA_SKY_TAU / ru)) * smoothstep(-0.15, 0.3, dot(up, uSunDir));
  vec3 rgb = mix(under, sky, F);

  // Блик солнца: распределение наклонов (Бекманн) с шероховатостью,
  // в которую ушли невидимые волны. Вблизи — искры на гребнях, вдали —
  // солнечная дорожка.
  float s2 = SEA_ROUGH0 + rough2;
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(nW, H), 1e-3);
  float nh2 = nh * nh;
  float D = exp(-(1.0 - nh2) / (nh2 * 2.0 * s2)) / (6.2831853 * s2 * nh2 * nh2);
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  float day = smoothstep(-0.02, 0.06, dot(up, uSunDir));
  float spec = min(D * Fs * 0.25 / max(nv, 0.1), 12.0) * sunVis * day;
  return rgb + vec3(spec);
}
`;
