// Корабль внутри станции: тоннель, зал, площадки.
//
// СИСТЕМА ОТСЧЁТА. Станция вращается вокруг оси порта (оборот за минуту с
// небольшим), и зал вращается вместе с ней: в трёхстах метрах от оси пол
// идёт два десятка метров в секунду. Лететь в таком зале в мировых осях
// нельзя — площадка уезжала бы из-под корабля, а стены наезжали бы сами.
// Поэтому корабль, прошедший щель, ПЕРЕНОСИТСЯ вместе со станцией целиком —
// местом, осями и скоростью, — как у тела в захвате (js/game/gravity.js),
// только жёстко: внутри станции всё неподвижно относительно неё. Скорость
// корабля в зале — его скорость ОТНОСИТЕЛЬНО зала.
//
// На входе скорость и вращение переводятся в оси зала (вращение станции
// вычитается), на выходе — обратно: корабль, вылетевший из щели, сохраняет
// и ход, и вращение вместе с портом, а дальше его гасят гасители. Так оно и
// есть у настоящего тела, сошедшего с вращающейся платформы.
//
// ТЯЖЕСТЬ — 1 g вниз по станции (STATION_G): искусственная, как и палубная
// у кораблей. Держит её тот же компенсатор высоты, что у тела: с нейтральной
// ручкой корабль в зале висит, а садятся — подъёмными (F), на шасси.
//
// ЧТО ТВЁРДО. Всё, что не пустота: корпус станции вокруг зала и тоннеля
// (shape.inside — у формы станции зал и тоннель вынуты) и корпус терминала.
// Корпус корабля проверяется точками по его габариту: углы, середины рёбер
// и граней. Пол — отдельно, по пятам шасси: на него садятся.
//
// Модуль чистый: ни рендера, ни сети, только станция, корабль и числа — и
// проверяется в Node целиком (tools/test.mjs).

import { v3 } from '../core/vec3.js';
import { makeBasis, toLocal, toWorld, lookAlong } from '../core/basis.js';
import { STATION_G, PAD_H, padAt, padByNo, inHall } from './stationplan.js';
import { HULL } from './hull.js';
import { SHIP } from './ship.js';
import { COMBAT } from './weapons.js';
import { L } from '../core/lang.js';

export const BERTH = {
  g: STATION_G / 1000,     // км/с² — тяжесть зала
  // Допуски касания — те же, что у посадки на тело (js/game/landing.js,
  // LAND): площадка — та же посадка, только пол ровный и неподвижный.
  vspeed: 0.030,           // км/с
  hspeed: 0.025,           // км/с
  tilt: 0.94,              // косинус наклона к полу
  restitution: 0.3,
  friction: 0.55,
  settle: 0.004,           // км/с — ниже этого удар — уже не удар, а касание
  tumble: 9,
  pad: PAD_H / 1000,       // км — плита площадки над полом (5 см)
};

const _o = v3(), _l = v3(), _w = v3(), _n = v3();

/** Снимок места и осей станции — до шага мира (для переноса). */
export function frameOf(st, out = { pos: v3(), basis: makeBasis() }) {
  out.pos.x = st.pos.x; out.pos.y = st.pos.y; out.pos.z = st.pos.z;
  for (const k of ['right', 'up', 'fwd']) {
    out.basis[k].x = st.basis[k].x; out.basis[k].y = st.basis[k].y; out.basis[k].z = st.basis[k].z;
  }
  return out;
}

/** Направление из старых осей станции в новые: те же числа в осях, новые оси. */
function reorient(v, from, to) {
  const x = v.x * from.right.x + v.y * from.right.y + v.z * from.right.z;
  const y = v.x * from.up.x + v.y * from.up.y + v.z * from.up.z;
  const z = v.x * from.fwd.x + v.y * from.fwd.y + v.z * from.fwd.z;
  v.x = to.right.x * x + to.up.x * y + to.fwd.x * z;
  v.y = to.right.y * x + to.up.y * y + to.fwd.y * z;
  v.z = to.right.z * x + to.up.z * y + to.fwd.z * z;
}

/**
 * Перенести корабль вместе со станцией за шаг мира: место, оси и скорость
 * — из её прежних осей (frame) в нынешние. Жёстко: в зале всё стоит
 * относительно станции, и корабль, висящий над площадкой, висит над ней.
 */
export function carryInStation(ship, st, frame) {
  toLocal(frame.basis, frame.pos, ship.pos, _l);
  // Корабль за обводом станции (перенесли телепортом, буксиром) — не в
  // зале, и нести его нечего: на тысячах километров поворот станции
  // смахнул бы его с места, куда его поставили. Зал отпустит его сам
  // (stepInStation, far).
  if (Math.hypot(_l.x, _l.y, _l.z) > st.shape.bound) return;
  toWorld(st.basis, st.pos, _l, ship.pos);
  reorient(ship.basis.right, frame.basis, st.basis);
  reorient(ship.basis.up, frame.basis, st.basis);
  reorient(ship.basis.fwd, frame.basis, st.basis);
  reorient(ship.vel, frame.basis, st.basis);
}

/** Точка мира -> оси станции, МЕТРЫ (как планировка). */
export function stationM(st, P, out = [0, 0, 0]) {
  const b = st.basis;
  const dx = (P.x - st.pos.x) * 1000, dy = (P.y - st.pos.y) * 1000, dz = (P.z - st.pos.z) * 1000;
  out[0] = dx * b.right.x + dy * b.right.y + dz * b.right.z;
  out[1] = dx * b.up.x + dy * b.up.y + dz * b.up.z;
  out[2] = dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z;
  return out;
}

/** Оси станции, метры -> мир. */
export function stationWorld(st, p, out = v3()) {
  const b = st.basis;
  out.x = st.pos.x + (b.right.x * p[0] + b.up.x * p[1] + b.fwd.x * p[2]) / 1000;
  out.y = st.pos.y + (b.right.y * p[0] + b.up.y * p[1] + b.fwd.y * p[2]) / 1000;
  out.z = st.pos.z + (b.right.z * p[0] + b.up.z * p[1] + b.fwd.z * p[2]) / 1000;
  return out;
}

/** Внутри ли станции точка мира: в зале или в тоннеле (пустота формы). */
export function insideAt(st, P) {
  toLocal(st.basis, st.pos, P, _o);
  return st.shape.hollow(_o.x, _o.y, _o.z);
}

/**
 * Угловая скорость станции в осях корабля — так её видят его маневровые
 * (pitch, yaw, roll; знаки — js/core/basis.js, rotateBasis). Станция
 * вращается вокруг своей оси порта.
 */
function spinInShip(ship, st, out) {
  const w = st.spinRate || 0, f = st.basis.fwd, b = ship.basis;
  out.pitch = -w * (f.x * b.right.x + f.y * b.right.y + f.z * b.right.z);
  out.yaw = w * (f.x * b.up.x + f.y * b.up.y + f.z * b.up.z);
  out.roll = -w * (f.x * b.fwd.x + f.y * b.fwd.y + f.z * b.fwd.z);
  return out;
}
const _spin = { pitch: 0, yaw: 0, roll: 0 };

/** Скорость точки станции P (мир) от вращения: Ω × r, км/с. */
function spinVel(st, P, out) {
  const w = st.spinRate || 0, f = st.basis.fwd;
  const rx = P.x - st.pos.x, ry = P.y - st.pos.y, rz = P.z - st.pos.z;
  out.x = w * (f.y * rz - f.z * ry);
  out.y = w * (f.z * rx - f.x * rz);
  out.z = w * (f.x * ry - f.y * rx);
  return out;
}

/**
 * Корабль прошёл щель: дальше он в осях станции. Скорость — относительно
 * зала (за вычетом хода станции и вращения в этой точке), вращение — тоже:
 * совпадавший по крену с портом корабль в зале не крутится вовсе.
 */
export function enterStation(ship, st) {
  spinVel(st, ship.pos, _w);
  ship.vel.x -= st.vel.x + _w.x; ship.vel.y -= st.vel.y + _w.y; ship.vel.z -= st.vel.z + _w.z;
  spinInShip(ship, st, _spin);
  ship.rot.pitch -= _spin.pitch; ship.rot.yaw -= _spin.yaw; ship.rot.roll -= _spin.roll;
  ship.berth = { st, pad: null };
}

/** Корабль вышел из щели: ход и вращение станции — обратно в его собственные. */
export function leaveStation(ship) {
  const B = ship.berth;
  if (!B) return;
  const st = B.st;
  spinVel(st, ship.pos, _w);
  ship.vel.x += st.vel.x + _w.x; ship.vel.y += st.vel.y + _w.y; ship.vel.z += st.vel.z + _w.z;
  spinInShip(ship, st, _spin);
  ship.rot.pitch += _spin.pitch; ship.rot.yaw += _spin.yaw; ship.rot.roll += _spin.roll;
  ship.berth = null;
}

/** Тяжесть зала для модели полёта (js/game/ship.js, updateShip). */
const _field = { up: v3(), g: BERTH.g };
export function stationField(st) {
  _field.up.x = st.basis.up.x; _field.up.y = st.basis.up.y; _field.up.z = st.basis.up.z;
  return _field;
}

// --- что твёрдо -----------------------------------------------------------------------

/** Пол под точкой (м, оси станции): кровля терминала над ним, иначе пол зала. */
export function floorAt(L, x, z) {
  const T = L.terminal;
  if (x > T.lo[0] && x < T.hi[0] && z > T.lo[2] && z < T.hi[2]) return T.hi[1];
  return L.floor + (padAt(L, x, z) ? BERTH.pad * 1000 : 0);
}

/** Твёрдо ли в точке (м, оси станции): корпус станции или корпус терминала. */
export function solidAt(st, p) {
  const T = st.layout.terminal;
  if (p[0] > T.lo[0] && p[0] < T.hi[0] && p[1] > T.lo[1] - 1 && p[1] < T.hi[1] && p[2] > T.lo[2] && p[2] < T.hi[2]) return 'terminal';
  return st.shape.inside(p[0] / 1000, p[1] / 1000, p[2] / 1000) ? 'hull' : null;
}

/**
 * Куда выталкивать точку из твёрдого (м, оси станции): нормаль наружу из
 * стены и глубина. Стены зала и тоннеля — плоскости коробок, терминал —
 * ближайшая грань его коробки.
 */
function pushOut(st, p, kind, out) {
  const L = st.layout;
  let best = Infinity;
  const face = (nx, ny, nz, d) => {
    if (d >= 0 && d < best) { best = d; out.n[0] = nx; out.n[1] = ny; out.n[2] = nz; }
  };
  if (kind === 'terminal') {
    const T = L.terminal;
    face(-1, 0, 0, p[0] - T.lo[0]); face(1, 0, 0, T.hi[0] - p[0]);
    face(0, 1, 0, T.hi[1] - p[1]);
    face(0, 0, -1, p[2] - T.lo[2]); face(0, 0, 1, T.hi[2] - p[2]);
  } else {
    const h = L.hall, t = L.tunnel;
    if (p[2] > h.hi[2]) {
      // У тоннеля: стены тоннеля и, за рамой, плоскость створа наружу.
      face(1, 0, 0, -t.hw - p[0]); face(-1, 0, 0, p[0] - t.hw);
      face(0, 1, 0, -t.hh - p[1]); face(0, -1, 0, p[1] - t.hh);
      face(0, 0, -1, p[2] - h.hi[2]);
      face(0, 0, 1, L.face - p[2]);
    } else {
      face(1, 0, 0, h.lo[0] - p[0]); face(-1, 0, 0, p[0] - h.hi[0]);
      face(0, 1, 0, h.lo[1] - p[1]); face(0, -1, 0, p[1] - h.hi[1]);
      face(0, 0, 1, h.lo[2] - p[2]); face(0, 0, -1, p[2] - h.hi[2]);
    }
  }
  out.depth = isFinite(best) ? best : 0;
  return out;
}

// Точки корпуса для проверки: углы габарита, середины рёбер и граней (26).
const PROBES = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) PROBES.push([x, y, z]);

const _pp = [0, 0, 0], _pw = v3(), _push = { n: [0, 0, 0], depth: 0 };

/**
 * Касается ли корпус твёрдого: самая глубокая точка, нормаль наружу (в
 * осях станции) и глубина, м. Или null.
 */
export function hullContact(ship, st) {
  const lo = HULL.lo, hi = HULL.hi, b = ship.basis;
  let worst = null;
  for (const [sx, sy, sz] of PROBES) {
    const x = sx < 0 ? lo.x : sx > 0 ? hi.x : (lo.x + hi.x) / 2;
    const y = sy < 0 ? lo.y : sy > 0 ? hi.y : (lo.y + hi.y) / 2;
    const z = sz < 0 ? lo.z : sz > 0 ? hi.z : (lo.z + hi.z) / 2;
    _pw.x = ship.pos.x + b.right.x * x + b.up.x * y + b.fwd.x * z;
    _pw.y = ship.pos.y + b.right.y * x + b.up.y * y + b.fwd.y * z;
    _pw.z = ship.pos.z + b.right.z * x + b.up.z * y + b.fwd.z * z;
    stationM(st, _pw, _pp);
    const kind = solidAt(st, _pp);
    if (!kind) continue;
    pushOut(st, _pp, kind, _push);
    if (!worst || _push.depth > worst.depth) {
      worst = { depth: _push.depth, n: _push.n.slice(), at: _pp.slice(), kind };
    }
  }
  return worst;
}

// --- пол: касание и стоянка -----------------------------------------------------------

const _f = [0, 0, 0];

/**
 * Пяты шасси над полом, м: самая низкая из трёх (минус — уже в полу) и
 * точка под серединой корабля.
 */
export function feetOverFloor(ship, st) {
  const L = st.layout;
  let low = Infinity;
  for (const f of HULL.feet) {
    _pw.x = ship.pos.x + ship.basis.right.x * f.x + ship.basis.up.x * f.y + ship.basis.fwd.x * f.z;
    _pw.y = ship.pos.y + ship.basis.right.y * f.x + ship.basis.up.y * f.y + ship.basis.fwd.y * f.z;
    _pw.z = ship.pos.z + ship.basis.right.z * f.x + ship.basis.up.z * f.y + ship.basis.fwd.z * f.z;
    stationM(st, _pw, _f);
    low = Math.min(low, _f[1] - floorAt(L, _f[0], _f[2]));
  }
  return low;
}

/** Обстановка в зале: высота над полом, скорости, наклон, площадка под кораблём. */
export function hallZone(ship, st, out = {}) {
  const L = st.layout;
  stationM(st, ship.pos, _pp);
  const u = st.basis.up;
  out.local = out.local || [0, 0, 0];
  out.local[0] = _pp[0]; out.local[1] = _pp[1]; out.local[2] = _pp[2];
  out.inHall = inHall(L, _pp);
  out.floor = floorAt(L, _pp[0], _pp[2]);
  // Высота центра над полом минус просвет на шасси — как у тела: «высота»
  // приборов — до пят, когда шасси выпущено.
  out.alt = (_pp[1] - out.floor) / 1000;
  out.vUp = ship.vel.x * u.x + ship.vel.y * u.y + ship.vel.z * u.z;
  const hx = ship.vel.x - u.x * out.vUp, hy = ship.vel.y - u.y * out.vUp, hz = ship.vel.z - u.z * out.vUp;
  out.hSpeed = Math.hypot(hx, hy, hz);
  out.tilt = ship.basis.up.x * u.x + ship.basis.up.y * u.y + ship.basis.up.z * u.z;
  out.pad = padAt(L, _pp[0], _pp[2]);
  return out;
}

const gearReady = (ship) => ship.gear.out && ship.gear.t > 0.995;

/**
 * Касание пола зала.
 * @returns null | {result: 'landed'} | {result: 'bounce', damage, impact, reason}
 *   | {result: 'crash', reason}
 */
export function touchFloor(ship, st, z) {
  const gear = gearReady(ship);
  const clear = gear ? feetOverFloor(ship, st) : z.alt * 1000 - SHIP.hullClear * 1000;
  if (clear > 0) return null;
  const poseOk = z.tilt >= BERTH.tilt;
  if (gear && poseOk && -z.vUp <= BERTH.vspeed && z.hSpeed <= BERTH.hspeed) return { result: 'landed' };
  const norm = Math.max(0, -z.vUp);
  const hit = Math.hypot(norm, z.hSpeed * (COMBAT.scrapeK || 0.6));
  const soft = gear ? (COMBAT.hitSoft || 0.03) : (COMBAT.bareSoft || 0.001);
  const kill = COMBAT.hitKill || 0.09;
  const t = Math.max(0, (hit - soft) / (kill - soft));
  let damage = 100 * t * t * (gear ? 1 : (COMBAT.bareMul || 4));
  if (!gear) damage = Math.max(damage, COMBAT.belly || 5);
  if (!poseOk) damage = Math.max(damage, COMBAT.poseFloor || 4) * (COMBAT.poseMul || 1.6);
  if (hit < BERTH.settle) {
    if (!gear && poseOk) return { result: 'landed', damage: COMBAT.belly || 5, impact: { norm, slide: z.hSpeed, gear, pose: poseOk } };
    if (!poseOk) return { result: 'crash', reason: L('Корабль лёг на пол зала с перекосом — опрокидывание.') };
  }
  return { result: 'bounce', damage, hit, impact: { norm, slide: z.hSpeed, gear, pose: poseOk },
    n: [0, 1, 0], reason: (gear ? L('Жёсткое касание пола зала: ') : L('Удар корпусом о пол зала: '))
      + (hit * 1000).toFixed(0) + L(' м/с.') };
}

/**
 * Удар о твёрдое в зале (стены, потолок, терминал, рама щели): та же
 * мерка, что у удара о грунт брюхом, — шасси в стену не упираются.
 * Нормаль — в осях станции.
 */
export function hitWall(ship, st, c) {
  _n.x = st.basis.right.x * c.n[0] + st.basis.up.x * c.n[1] + st.basis.fwd.x * c.n[2];
  _n.y = st.basis.right.y * c.n[0] + st.basis.up.y * c.n[1] + st.basis.fwd.y * c.n[2];
  _n.z = st.basis.right.z * c.n[0] + st.basis.up.z * c.n[1] + st.basis.fwd.z * c.n[2];
  const vn = ship.vel.x * _n.x + ship.vel.y * _n.y + ship.vel.z * _n.z;
  const norm = Math.max(0, -vn);
  const tx = ship.vel.x - _n.x * vn, ty = ship.vel.y - _n.y * vn, tz = ship.vel.z - _n.z * vn;
  const slide = Math.hypot(tx, ty, tz);
  const hit = Math.hypot(norm, slide * (COMBAT.scrapeK || 0.6));
  const soft = COMBAT.bareSoft || 0.001, kill = COMBAT.hitKill || 0.09;
  const t = Math.max(0, (hit - soft) / (kill - soft));
  const damage = hit < BERTH.settle ? 0 : Math.max(COMBAT.belly || 5, 100 * t * t * (COMBAT.bareMul || 4));
  return { result: hit >= kill ? 'crash' : 'bounce', damage, hit, n: _n,
    impact: { norm, slide, gear: false, pose: false } };
}

/**
 * Отскок от твёрдого: нормальная часть скорости отражается с потерей,
 * касательную ест трение, корабль выталкивается из стены на глубину
 * касания и на время теряет управление (ship.stun), как после удара о
 * грунт.
 * @param n нормаль наружу из стены, мир; depth — глубина, м
 */
export function bounceInHall(ship, n, depth) {
  const vn = ship.vel.x * n.x + ship.vel.y * n.y + ship.vel.z * n.z;
  const tx = ship.vel.x - n.x * vn, ty = ship.vel.y - n.y * vn, tz = ship.vel.z - n.z * vn;
  const out = vn < 0 ? -vn * BERTH.restitution : 0;
  const keep = 1 - BERTH.friction;
  ship.vel.x = tx * keep + n.x * (vn < 0 ? out : vn);
  ship.vel.y = ty * keep + n.y * (vn < 0 ? out : vn);
  ship.vel.z = tz * keep + n.z * (vn < 0 ? out : vn);
  ship.speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
  const d = (depth + 0.3) / 1000;
  ship.pos.x += n.x * d; ship.pos.y += n.y * d; ship.pos.z += n.z * d;
  const hard = Math.min(1, Math.abs(vn) / (COMBAT.hitKill || 0.09));
  if (Math.abs(vn) > BERTH.settle) {
    ship.stun = (SHIP.stunMin || 0.35) + ((SHIP.stunMax || 1.4) - (SHIP.stunMin || 0.35)) * hard;
    ship.lift = 0;
    ship.throttle = 0;
  }
  ship.landing = null;
}

/**
 * Встать на пол зала: ровно по станции (пол ровный), курс — какой был, центр
 * — на просвете шасси над полом под ним. Поза — в осях станции: дальше
 * корабль стоит вместе с вращающимся залом.
 */
export function settleInHall(ship, st) {
  const L = st.layout;
  const up = st.basis.up;
  // Курс — проекция носа на пол станции.
  const k = ship.basis.fwd.x * up.x + ship.basis.fwd.y * up.y + ship.basis.fwd.z * up.z;
  _w.x = ship.basis.fwd.x - up.x * k; _w.y = ship.basis.fwd.y - up.y * k; _w.z = ship.basis.fwd.z - up.z * k;
  if (Math.hypot(_w.x, _w.y, _w.z) < 1e-6) { _w.x = st.basis.fwd.x; _w.y = st.basis.fwd.y; _w.z = st.basis.fwd.z; }
  lookAlong(ship.basis, _w, up);
  stationM(st, ship.pos, _pp);
  const gear = gearReady(ship);
  const clear = (gear ? SHIP.gearClear : SHIP.hullClear) * 1000;
  _pp[1] = floorAt(L, _pp[0], _pp[2]) + clear;
  stationWorld(st, _pp, ship.pos);
  ship.gear.drop = gear ? [0, 0, 0] : null;
  const pad = padAt(L, _pp[0], _pp[2]);
  ship.berth = { st, pad: pad ? pad.n : null };
  ship.dockPose = {
    pos: { x: _pp[0] / 1000, y: _pp[1] / 1000, z: _pp[2] / 1000 },
    fwd: toLocal(st.basis, { x: 0, y: 0, z: 0 }, ship.basis.fwd, v3()),
    up: { x: 0, y: 1, z: 0 },
  };
  ship.vel.x = ship.vel.y = ship.vel.z = 0;
  ship.speed = 0;
  ship.throttle = 0;
  ship.lift = 0;
  ship.landing = null;
  ship.rot.pitch = ship.rot.yaw = ship.rot.roll = 0;
  if (ship.torq) ship.torq.pitch = ship.torq.yaw = ship.torq.roll = 0;
  return ship.dockPose;
}

/**
 * Стоящий в зале корабль — в мир по позе в осях станции (км). Своей скорости
 * у него нет: зал его везёт.
 */
export function placeDocked(ship, st, pose) {
  toWorld(st.basis, st.pos, pose.pos, ship.pos);
  _w.x = pose.fwd.x; _w.y = pose.fwd.y; _w.z = pose.fwd.z;
  const f = v3(), u = v3();
  toWorld(st.basis, { x: 0, y: 0, z: 0 }, _w, f);
  toWorld(st.basis, { x: 0, y: 0, z: 0 }, pose.up || { x: 0, y: 1, z: 0 }, u);
  lookAlong(ship.basis, f, u);
  ship.vel.x = ship.vel.y = ship.vel.z = 0;
  ship.speed = 0;
}

/**
 * Поза на площадке n: середина площадки, нос — от терминала (по станции
 * наружу), просвет шасси. Так ставит корабль ангарная служба: вызванный
 * корабль поднимается на площадку из хранилища (js/main.js, server
 * Shipyard::retrieve).
 */
export function padPose(L, n, gearClearKm = SHIP.gearClear) {
  const p = padByNo(L, n);
  if (!p) return null;
  return {
    pos: { x: p.c[0] / 1000, y: (L.floor + BERTH.pad * 1000) / 1000 + gearClearKm, z: p.c[2] / 1000 },
    fwd: { x: 0, y: 0, z: 1 },
    up: { x: 0, y: 1, z: 0 },
  };
}

const _upw = v3(), _pq = [0, 0, 0];

/**
 * Шаг корабля в зале — после модели полёта (updateShip): вышел ли он за
 * створ, коснулся ли пола (посадка или удар), задел ли стену. Отскоки
 * применяет сам; что сказать пилоту и куда сообщить — решает игра
 * (js/main.js, hallStep), а проверки зовут то же самое (tools/test.mjs).
 *
 * @param z куда положить обстановку в зале (hallZone)
 * @returns null | { left, far? } | { landed, damage, impact } | { crash, reason }
 *   | { bump, damage, impact, reason, wall }
 */
export function stepInStation(ship, st, z) {
  if (!insideAt(st, ship.pos)) {
    stationM(st, ship.pos, _pq);
    if (_pq[2] > st.shape.D * 1000 - 1) return { left: true };
    // Целиком за обводом станции — тоже не в зале: так корабль переносят
    // телепорт (K), буксир и проверки. Иначе пол зала, продолженный под
    // ним на сотни километров, посадил бы его «на площадку».
    if (Math.hypot(_pq[0], _pq[1], _pq[2]) > st.shape.bound * 1000) return { left: true, far: true };
  }
  hallZone(ship, st, z);
  const touch = touchFloor(ship, st, z);
  if (touch) {
    if (touch.result === 'crash') return { crash: true, reason: touch.reason };
    if (touch.result === 'landed') return { landed: true, damage: touch.damage || 0, impact: touch.impact || null };
    _upw.x = st.basis.up.x; _upw.y = st.basis.up.y; _upw.z = st.basis.up.z;
    const depth = gearReady(ship) ? -feetOverFloor(ship, st) : 0;
    bounceInHall(ship, _upw, Math.max(0, depth));
    return { bump: true, damage: touch.damage, impact: touch.impact, reason: touch.reason, wall: false };
  }
  const c = hullContact(ship, st);
  if (c) {
    const h = hitWall(ship, st, c);
    if (h.result === 'crash') return { crash: true, reason: 'wall' };
    bounceInHall(ship, h.n, c.depth);
    if (h.damage > 0) return { bump: true, damage: h.damage, impact: h.impact, reason: 'wall', wall: true };
  }
  return null;
}

/** Отрыв от пола зала: подъёмные на полный ход на секунду, как с грунта. */
export function takeoffFromHall(ship) {
  ship.gear.out = true;
  ship.gear.drop = null;
  ship.throttle = 0;
  ship.speed = 0;
  ship.vel.x = ship.vel.y = ship.vel.z = 0;
  ship.rot.pitch = ship.rot.yaw = ship.rot.roll = 0;
  if (ship.torq) ship.torq.pitch = ship.torq.yaw = ship.torq.roll = 0;
  ship.liftHold = 0.9;
  ship.lift = 0;
  ship.dockPose = null;
}
