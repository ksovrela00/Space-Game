// Вездеход на грунте: колёса, подвеска, руль, газ и тормоз.
//
// ГДЕ СЧИТАЕТСЯ. В осях тела, на котором он стоит, — как стоянка корабля и
// место пилота на грунте. Тело вращается, и мировая точка через минуту
// показывала бы в пустоту (README, «Место в полёте хранится в осях тела»).
// Положение — lp (км, оси тела), оси машины — lb (right, up, fwd в осях
// тела). В мир их переводит игра (js/main.js) — каждый кадр.
//
// ГРУНТ. Под каждым из шести колёс — своя высота грунта (env.ground). Через
// шесть точек касания проводится плоскость (наименьшие квадраты): её наклон
// — наклон кузова, её высота под началом осей — где кузов должен стоять, а
// то, насколько грунт под колесом выше или ниже плоскости, — ход этого
// колеса на подвеске. Кузов догоняет плоскость пружиной (spring), а если
// грунт ушёл вниз дальше хода подвески — машина в воздухе и падает с
// тяготением тела. Это не физика твёрдого тела, а то, что от неё видно:
// кузов качается на кочках, колёса ходят каждое своё, с горба машина
// подлетает.
//
// ХОД. Скорость вдоль кузова — одно число (v, м/с): газ разгоняет её до
// хода, тормоз и задний ход гасят и разворачивают, без газа она тает от
// сопротивления качению. Поперёк — снос (vs), его гасит сцепление шин.
// Руль поворачивает переднюю и заднюю оси в разные стороны, и кузов
// вращается вокруг середины: ω = v·tg δ / плечо, где плечо — от середины до
// поворотных осей. На склоне тяжесть тянет машину под гору; стоящую — держит
// тормоз, пока склон не круче slopeMax.
//
// ЧИСЛА — из бэкенда (server/data/specs.php, тип rover): здесь их нет ни
// одного, их приносит spec. Размеры колёс и кузова — у модели
// (js/models/rover.js), как у корабля размеры корпуса.
//
// Без мира и без рендера: проверяется в Node (tools/test.mjs).

import { RV } from '../models/rover.js';

const DEG = Math.PI / 180;

// Колёса: оси машины, м. Порядок — как у buildRoverGear: по длине спереди
// назад, на каждом месте левое и правое.
export const WHEELS = [];
for (let i = 0; i < RV.wheel.z.length; i++) {
  for (const s of [-1, 1]) WHEELS.push({ x: s * RV.wheel.x, z: RV.wheel.z[i], steer: RV.wheel.steer[i] });
}
// Середина колёс по длине: колёса стоят не симметрично (дверь между средним
// и задним), и плоскость касания считается от их середины.
const ZMID = WHEELS.reduce((s, w) => s + w.z, 0) / WHEELS.length;
// Плечо поворота: от середины до поворотных осей.
const ARM = (RV.wheel.z[0] - RV.wheel.z[RV.wheel.z.length - 1]) / 2;
// Кузов для столкновений — три круга вдоль: машина длинная и узкая, и один
// круг либо проходил бы сквозь стойку носом, либо не пускал между стоек.
export const HULL_CIRCLES = [{ z: 2.2, r: 1.7 }, { z: 0, r: 1.75 }, { z: -2.2, r: 1.7 }];

/** Новое состояние вездехода (оси тела: lp — км, lb — единичные). */
export function makeRover() {
  return {
    mode: 'ground',        // ground — по грунту тела; hangar — в трюме носителя (оси корабля)
    body: null,            // тело, в осях которого считается
    hg: { x: 0, y: 0, z: 0, yaw: 0 },   // место в трюме носителя (м, его оси) — в режиме hangar
    lp: { x: 0, y: 0, z: 0 },
    lb: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, fwd: { x: 0, y: 0, z: 1 } },
    v: 0,                  // м/с — вдоль кузова (минус — назад)
    vs: 0,                 // м/с — снос вправо
    vy: 0,                 // м/с — вдоль «вверх» кузова (минус — падает)
    steer: 0,              // рад — поворот передних колёс (плюс — вправо)
    air: false,            // в воздухе (грунт ушёл дальше хода подвески)
    slip: false,           // склон круче, чем держат шины
    bump: 0,               // м/с — удар о препятствие в этом шаге
    landed: 0,             // м/с — с какой скоростью встал на колёса
    // Органы управления этого шага и что из них вышло — приборам и рычагу
    // в кабине (js/ui/panels.js, js/models/cockpit.rover.js).
    pedal: 0,              // −1..1 — газ (плюс — вперёд)
    brake: 0,              // 0..1 — тормоз
    hold: false,           // стоит на тормозе стоянки (склон держат шины)
    slope: 0,              // рад — наклон кузова от отвеса
    // Колёса: поворот, вращение и ход подвески (м, плюс — вниз) — их
    // рисует сцена (js/gl/scene.js, drawWheelsOf; там drop — в км).
    wheels: WHEELS.map(() => ({ steer: 0, spin: 0, drop: 0, touch: true })),
  };
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });

/** Точка машины (м, оси машины) -> оси тела (км). */
export function roverPoint(rv, x, y, z, out = { x: 0, y: 0, z: 0 }) {
  const b = rv.lb;
  out.x = rv.lp.x + (b.right.x * x + b.up.x * y + b.fwd.x * z) / 1000;
  out.y = rv.lp.y + (b.right.y * x + b.up.y * y + b.fwd.y * z) / 1000;
  out.z = rv.lp.z + (b.right.z * x + b.up.z * y + b.fwd.z * z) / 1000;
  return out;
}

/** Оси из «вперёд» и «вверх»: вверх — как есть, вперёд — поперёк него. */
export function frameFrom(up, fwd, out) {
  const u = norm(up);
  let f = add(fwd, u, -dot(fwd, u));
  if (len(f) < 1e-9) f = Math.abs(u.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  f = norm(f);
  // right = up × fwd — так у кораблей (js/core/basis.js): x вправо, y вверх, z вперёд.
  const r = norm(cross(u, f));
  out.right = r; out.up = u; out.fwd = f;
  return out;
}

/**
 * Плоскость касания: высота h = a + bx·x + bz·(z − ZMID) по шести колёсам,
 * наименьшими квадратами. Колёса стоят на сетке (три места по длине, две
 * стороны), и уравнения раздельные: середина, наклон вбок и вдоль.
 */
export function fitPlane(h) {
  let sum = 0, sx = 0, sxx = 0, sz = 0, szz = 0;
  for (let i = 0; i < WHEELS.length; i++) {
    const w = WHEELS[i], dz = w.z - ZMID;
    sum += h[i]; sx += h[i] * w.x; sxx += w.x * w.x; sz += h[i] * dz; szz += dz * dz;
  }
  return { a: sum / WHEELS.length, bx: sx / sxx, bz: sz / szz };
}

const _h = new Array(WHEELS.length).fill(0);
const _p = { x: 0, y: 0, z: 0 };

/**
 * Шаг вездехода по грунту.
 *
 * @param rv    состояние (makeRover)
 * @param ctl   { throttle: −1..1 (газ вперёд — плюс), steer: −1..1 (вправо — плюс), brake: 0..1 }
 * @param spec  числа типа (SHIP: driveSpeed, reverseSpeed, driveAccel, driveBrake, roll,
 *              steerMax, steerRate, steerFade, grip, slopeMax, travel, spring)
 * @param env   { g: м/с², ground(p) -> радиус грунта (км) по направлению точки p
 *              (оси тела) или null, water(p) -> вода ли там, obstacles: [{ p, r }] —
 *              столбы (км, оси тела) }
 * @param dt    с
 */
export function stepRover(rv, ctl, spec, env, dt) {
  rv.bump = 0;
  rv.landed = 0;
  const g = env.g || 0;
  const b = rv.lb;
  const vmax = spec.driveSpeed || 0;

  steerTo(rv, ctl, spec, dt);

  // --- грунт под колёсами и плоскость касания.
  const radial = norm(rv.lp);
  let water = false;
  for (let i = 0; i < WHEELS.length; i++) {
    const w = WHEELS[i];
    roverPoint(rv, w.x, 0, w.z, _p);
    const gr = env.ground ? env.ground(_p) : null;
    // Грунта нет (пустота, тело не то) — колесо «на плоскости».
    if (gr === null || gr === undefined) { _h[i] = 0; continue; }
    // Грунт над плоскостью машины — по её «вверх», м: перепад по радиусу,
    // делённый на косинус наклона (грунт под колесом считаем ровным).
    const pl = len(_p);
    _h[i] = (gr - pl) * 1000 / Math.max(0.5, dot(norm(_p), b.up));
    if (env.water && env.water(_p)) water = true;
  }
  const P = fitPlane(_h);
  const travel = spec.travel || 0.2;

  // --- вверх и вниз: в воздухе — падение, на грунте — пружина подвески.
  if (P.a < -travel) {
    // Грунт ушёл дальше хода подвески: колёса висят, машина падает.
    rv.air = true;
    rv.vy -= g * dt;
    rv.lp = add(rv.lp, radial, rv.vy * dt / 1000);
  } else {
    if (rv.air || rv.vy < -0.5) rv.landed = Math.max(0, -rv.vy);
    rv.air = false;
    rv.vy = 0;
    const k = 1 - Math.exp(-(spec.spring || 8) * dt);
    rv.lp = add(rv.lp, b.up, P.a * k / 1000);
  }

  // --- наклон кузова — по плоскости (в воздухе — как был).
  if (!rv.air) {
    const upT = norm(add(add(b.up, b.right, -P.bx), b.fwd, -P.bz));
    const k = 1 - Math.exp(-(spec.spring || 8) * dt);
    frameFrom(add(b.up, add(upT, b.up, -1), k), b.fwd, rv.lb);
  }

  // --- ход вдоль (speedTo) и тяжесть на склоне.
  const th = clamp(ctl.throttle || 0, -1, 1);
  const brk = clamp(ctl.brake || 0, 0, 1);
  // Тяжесть на склоне: составляющая «вниз» вдоль кузова и поперёк.
  const down = { x: -radial.x, y: -radial.y, z: -radial.z };
  const slope = Math.acos(clamp(dot(b.up, radial), -1, 1));
  rv.slip = !rv.air && slope > (spec.slopeMax || 90) * DEG;
  let gf = rv.air ? 0 : g * dot(down, b.fwd);
  let gs = rv.air ? 0 : g * dot(down, b.right);
  // Стоит без газа на склоне, который шины держат, — тормоз держит его.
  const hold = !rv.slip && th === 0 && Math.abs(rv.v) < 0.3;
  if (hold) { gf = 0; gs = 0; }
  rv.pedal = th; rv.brake = brk; rv.hold = hold && !rv.air; rv.slope = slope;
  // Скользит — газ уже ничего не решает; в воздухе — тоже.
  let v = !rv.air && !rv.slip ? speedTo(rv.v, th, brk, spec, dt) : rv.v;
  v += gf * dt;
  if (hold && Math.abs(v) < 0.05) v = 0;
  rv.v = clamp(v, -vmax * 1.5, vmax * 1.5);
  // Снос: его гасит сцепление (на льду склона — нет).
  rv.vs += gs * dt;
  if (!rv.air && !rv.slip) rv.vs *= Math.exp(-(spec.grip || 0) * dt);

  // --- поворот кузова вокруг «вверх».
  if (!rv.air && Math.abs(rv.steer) > 1e-6) {
    const w = rv.v * Math.tan(rv.steer) / ARM;
    const c = Math.cos(w * dt), s = Math.sin(w * dt);
    const f = rv.lb.fwd, r = rv.lb.right;
    frameFrom(rv.lb.up, { x: f.x * c + r.x * s, y: f.y * c + r.y * s, z: f.z * c + r.z * s }, rv.lb);
  }

  // --- сдвиг: вдоль кузова и вбок, в его плоскости.
  const move = add(add({ x: 0, y: 0, z: 0 }, rv.lb.fwd, rv.v * dt), rv.lb.right, rv.vs * dt);
  const was = { ...rv.lp };
  rv.lp = add(rv.lp, move, 1 / 1000);

  // --- вода — берег: в море не въезжают (как и не заходят пешком).
  if (env.water) {
    let wet = false;
    for (const w of WHEELS) {
      if (w.z * Math.sign(rv.v || 1) <= 0) continue;     // смотрим колёса, что идут первыми
      if (env.water(roverPoint(rv, w.x, 0, w.z, _p))) { wet = true; break; }
    }
    if (wet && !water) { rv.lp = was; rv.bump = Math.abs(rv.v); rv.v = 0; rv.vs = 0; }
  }

  // --- столбы (стойки кораблей): кузов — три круга, столб — круг.
  for (const ob of env.obstacles || []) {
    for (const c of HULL_CIRCLES) {
      const C = roverPoint(rv, 0, 0, c.z, _p);
      let d = { x: C.x - ob.p.x, y: C.y - ob.p.y, z: C.z - ob.p.z };
      d = add(d, rv.lb.up, -dot(d, rv.lb.up));
      const dl = len(d) * 1000, need = c.r + ob.r * 1000;
      if (dl >= need || dl < 1e-6) continue;
      const n = norm(d);
      rv.lp = add(rv.lp, n, (need - dl) / 1000);
      // Скорость в столб — гасится, вдоль него — остаётся.
      const vel = add(add({ x: 0, y: 0, z: 0 }, rv.lb.fwd, rv.v), rv.lb.right, rv.vs);
      const into = dot(vel, n);
      if (into < 0) {
        rv.bump = Math.max(rv.bump, -into);
        const vel2 = add(vel, n, -into);
        rv.v = dot(vel2, rv.lb.fwd);
        rv.vs = dot(vel2, rv.lb.right);
      }
    }
  }

  // --- колёса: поворот, вращение, ход подвески.
  for (let i = 0; i < WHEELS.length; i++) {
    const w = WHEELS[i], st = rv.wheels[i];
    st.steer = rv.steer * w.steer;
    st.spin += (rv.v / RV.wheel.r) * dt;
    if (st.spin > Math.PI * 2) st.spin -= Math.PI * 2;
    if (st.spin < 0) st.spin += Math.PI * 2;
    if (rv.air) { st.drop = travel; st.touch = false; continue; }
    // Грунт под колесом выше плоскости — колесо поджато (вверх, минус).
    const e = _h[i] - (P.a + P.bx * w.x + P.bz * (w.z - ZMID));
    st.drop = clamp(-e, -travel, travel);
    st.touch = true;
  }
  return rv;
}

/**
 * Поставить вездеход на грунт в точке p (оси тела, км) носом по fwd: на
 * высоту грунта под ней, вверх — от центра тела.
 */
export function placeRover(rv, body, p, fwd, ground) {
  rv.body = body;
  const up = norm(p);
  const gr = ground ? ground(p) : null;
  const r = gr === null || gr === undefined ? len(p) : gr;
  rv.lp = { x: up.x * r, y: up.y * r, z: up.z * r };
  frameFrom(up, fwd, rv.lb);
  rv.v = 0; rv.vs = 0; rv.vy = 0; rv.steer = 0; rv.air = false;
  for (const w of rv.wheels) { w.steer = 0; w.drop = 0; w.touch = true; }
  return rv;
}

/** Руль: на ходу тупее (steerFade), к цели — с конечной скоростью (steerRate). */
function steerTo(rv, ctl, spec, dt) {
  const vmax = spec.driveSpeed || 0;
  const fade = 1 - (1 - (spec.steerFade ?? 1)) * Math.min(1, Math.abs(rv.v) / Math.max(1, vmax));
  const want = clamp(ctl.steer || 0, -1, 1) * (spec.steerMax || 0) * DEG * fade;
  const rate = (spec.steerRate || 0) * DEG * dt;
  rv.steer += clamp(want - rv.steer, -rate, rate);
}

/**
 * Ход вдоль: газ, тормоз, задний ход, качение. Скорость идёт к цели и не
 * дальше неё (toward): тормоз не разворачивает машину назад, газ не
 * перебирает хода. Тяжести здесь нет — склон добавляет вызывающий.
 */
function speedTo(v, th, brk, spec, dt) {
  const vmax = spec.driveSpeed || 0, vrev = spec.reverseSpeed || 0;
  const acc = spec.driveAccel || 0, brake = spec.driveBrake || 0, roll = spec.roll || 0;
  if (brk > 0) return toward(v, 0, brake * brk * dt);
  if (th > 0) {
    return v < -0.3 ? toward(v, 0, brake * dt)
      : v < vmax * th ? Math.min(vmax * th, v + acc * th * dt) : toward(v, vmax * th, roll * dt);
  }
  if (th < 0) {
    return v > 0.3 ? toward(v, 0, brake * dt)
      : v > -vrev * -th ? Math.max(-vrev * -th, v + acc * th * dt) : toward(v, -vrev * -th, roll * dt);
  }
  return toward(v, 0, roll * dt);
}

// --- в трюме ------------------------------------------------------------------
//
// В трюме своего корабля вездеход — такая же машина, как на грунте: его
// ведут, он едет и упирается в стены. Только оси — корабля, а не тела:
// корабль стоит на грунте, и его палуба — ровный пол в его же осях. Место —
// rv.hg (м, оси носителя): x, z по полу, y — высота пола под машиной,
// yaw — куда смотрит нос (от оси z корабля к x). Пол — палуба трюма или плита
// платформы (env.floor): плита едет вниз — едет и машина. Стены, ящики и
// края колодца — коробки (env.solids): кузов (три круга, HULL_CIRCLES)
// отталкивается от них, и скорость в стену гаснет.

/**
 * Шаг вездехода в трюме носителя.
 *
 * @param rv   состояние (makeRover), место — rv.hg
 * @param ctl  как у stepRover
 * @param spec как у stepRover
 * @param env  { floor(x, z) -> y пола (м, оси носителя), solids: [{ lo, hi }] —
 *             коробки в тех же осях }
 * @param dt   с
 */
export function stepHangar(rv, ctl, spec, env, dt) {
  rv.bump = 0; rv.landed = 0; rv.air = false; rv.slip = false; rv.slope = 0;
  rv.vs = 0;
  steerTo(rv, ctl, spec, dt);
  const th = clamp(ctl.throttle || 0, -1, 1);
  const brk = clamp(ctl.brake || 0, 0, 1);
  rv.v = speedTo(rv.v, th, brk, spec, dt);
  if (th === 0 && Math.abs(rv.v) < 0.05) rv.v = 0;
  rv.pedal = th; rv.brake = brk; rv.hold = th === 0 && Math.abs(rv.v) < 0.3;
  const H = rv.hg;
  const x0 = H.x, z0 = H.z;
  if (Math.abs(rv.steer) > 1e-6) H.yaw += rv.v * Math.tan(rv.steer) / ARM * dt;
  H.x += Math.sin(H.yaw) * rv.v * dt;
  H.z += Math.cos(H.yaw) * rv.v * dt;
  hangarPush(rv, env.solids || []);
  // Пол впереди выше, чем колесо берёт (край палубы над плитой в колодце), —
  // это стена, а не новый пол: машина упирается, а не взлетает на палубу.
  if (env.floor(H.x, H.z) > H.y + HANGAR_STEP) {
    H.x = x0; H.z = z0;
    rv.bump = Math.max(rv.bump, Math.abs(rv.v));
    rv.v = 0;
  }
  // Пол ушёл вниз больше, чем на ход плиты за шаг (въехал в открытый
  // колодец), — машина падает с тяжестью тела, а не переставляется на дно
  // за кадр. Невидимого края у проёма нет (так решил автор игры).
  const fl = env.floor(H.x, H.z);
  if (fl < H.y - 0.05 || rv.vy > 0) {
    rv.vy -= (env.g || 9.81) * dt;
    H.y += rv.vy * dt;
    if (H.y <= fl) { rv.landed = Math.max(0, -rv.vy); H.y = fl; rv.vy = 0; } else rv.air = true;
  } else {
    H.y = fl;
    rv.vy = 0;
  }
  for (let i = 0; i < WHEELS.length; i++) {
    const w = WHEELS[i], st = rv.wheels[i];
    st.steer = rv.steer * w.steer;
    st.spin = (st.spin + (rv.v / RV.wheel.r) * dt + Math.PI * 2) % (Math.PI * 2);
    st.drop = 0;
    st.touch = true;
  }
  return rv;
}

// Кузов в трюме — прямоугольник по самой машине с колёсами (полуширина и
// полудлина, м), а не круги: круги кузова (HULL_CIRCLES — между стойками
// шасси на грунте) торчат за нос и корму на 0.9 м, и в трюме машина
// вставала в 0.9 м от стены, а «целиком на плите» (onBayEdge) было бы
// окном в ±0.5 м на плите в 8.8 м.
export const HULL_BOX = { w: RV.wheel.x + RV.wheel.w / 2, l: Math.max(-RV.body.z0, RV.body.z1) };

// Дальше этого за проход толкалка не двигает, м. Упереться в стену — это
// сантиметры за шаг; больше — значит, коробка оказалась внутри кузова сама
// (появилась, машину поставили), и выталкивать её разом — бросок на метр
// за кадр. Так и было: заслон колодца, появившийся под свешенным кузовом,
// выбрасывал машину на 0.9–1.75 м (tools/smoke.mjs, «швы переходов»).
const PUSH_MAX = 0.2;

// Выше этого пол впереди для колеса в трюме — стена, м (колесо — 0.55 м).
const HANGAR_STEP = 0.45;

/**
 * Кузов — из коробок трюма: прямоугольник кузова выталкивается из коробок,
 * которые он задевает по высоте (от тридцати сантиметров над полом до
 * крыши), по оси наименьшего перекрытия, а скорость в стену гаснет —
 * машина упирается.
 */
export function hangarPush(rv, solids) {
  const H = rv.hg, W = HULL_BOX.w, L = HULL_BOX.l;
  const y0 = H.y + 0.3, y1 = H.y + RV.roofBar;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const sy = Math.sin(H.yaw), cy = Math.cos(H.yaw);
    // Оси кузова в плане: вперёд (sy, cy), вправо (cy, −sy).
    for (const s of solids) {
      if (s.hi[1] <= y0 || s.lo[1] >= y1) continue;
      const bx = (s.lo[0] + s.hi[0]) / 2, bz = (s.lo[2] + s.hi[2]) / 2;
      const hx = (s.hi[0] - s.lo[0]) / 2, hz = (s.hi[2] - s.lo[2]) / 2;
      const dx = bx - H.x, dz = bz - H.z;
      // Разделяющие оси: две коробки и две кузова. Перекрытие по каждой —
      // сумма проекций минус расстояние между серединами.
      let best = Infinity, nx = 0, nz = 0;
      for (const [ax, az] of [[1, 0], [0, 1], [cy, -sy], [sy, cy]]) {
        const rr = W * Math.abs(cy * ax - sy * az) + L * Math.abs(sy * ax + cy * az);
        const rb = hx * Math.abs(ax) + hz * Math.abs(az);
        const d = dx * ax + dz * az;
        const over = rr + rb - Math.abs(d);
        if (over <= 0) { best = 0; break; }
        if (over < best) { best = over; const sg = d > 0 ? -1 : 1; nx = ax * sg; nz = az * sg; }
      }
      if (!(best > 1e-9)) continue;
      const step = Math.min(best, PUSH_MAX);
      H.x += nx * step; H.z += nz * step;
      // Едет в стену — встаёт; задел вскользь — теряет ход по косинусу.
      // Боком машина не ездит, и «скользить вдоль стены» ей нечем.
      const k = sy * nx + cy * nz;
      if (k * rv.v < 0) {
        rv.bump = Math.max(rv.bump, Math.abs(k * rv.v));
        rv.v *= Math.abs(k) > 0.5 ? 0 : 1 - Math.abs(k);
      }
      moved = true;
    }
    if (!moved) break;
  }
}

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

/** К цели, но не дальше шага step и не за неё. */
function toward(v, target, step) {
  const d = target - v;
  return Math.abs(d) <= step ? target : v + Math.sign(d) * step;
}
