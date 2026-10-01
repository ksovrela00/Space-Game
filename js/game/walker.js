// Пилот на ногах: ходьба по палубам корабля (js/models/interior.js).
//
// Всё здесь — в осях КОРАБЛЯ и в метрах: пол палубы — это пол, куда бы
// ни смотрел корпус. Корабль может лететь, крутиться, стоять в порту или
// на склоне — пилот ходит по своей палубе одинаково.
//
// ТЯЖЕСТЬ. На палубе — ровно 1 g «вниз по кораблю». Честная тяжесть здесь
// невозможна по самой лётной модели: маршевые разгоняют корабль на
// десятки g (SHIP.accel), а развороты и посадка дали бы ещё столько же
// поперёк — пилот размазался бы по переборке на первом же манёвре. Тот же
// компенсатор, без которого не выжил бы и пилот в кресле, держит палубу
// инерциальной: ход корабля внутри не чувствуется, а пол притягивает с
// земной силой.
//
// ЧЕЛОВЕК. Рост 1.80, глаза на 1.66 (у мужчины такого роста — 93% роста).
// Шаг 2.0 м/с — быстрая ходьба; бег — 4.6 м/с, трусца, а не спринт: по
// коридору в 1.8 м шириной быстрее не бегают. Прыжок с места — 0.45 м:
// столько и прыгает нетренированный человек (скорость отрыва
// √(2·g·h) ≈ 3 м/с). Ступень трапа 0.19, и нога поднимается на неё сама —
// как и на любой порог до 0.42 м.
//
// ТЕЛО — коробка 0.5 × 1.8 × 0.5 м, а не капсула: стены, ступени и
// мебель здесь — коробки по осям корабля, и столкновение коробки с
// коробкой считается точно и дёшево. Ходьба разложена по осям: упёрся в
// стену по x — скользишь вдоль неё по z, как в любой игре от первого лица.

// Модель помещений сюда не импортируется: в ней мегабайт деталей пака, и
// грузится она лениво (js/main.js, loadInterior). Всё нужное — числа
// планировки (interior.INT) и roomAt — приезжает вместе с ней.
//
// ЗА БОРТОМ (w.out) — то же тело, те же шаг и прыжок, но в осях грунта
// (js/game/outside.js) и с другим миром: опора — сам грунт (W.ground —
// высота под точкой), тяжесть — тела (W.g), а вода — стена (W.water):
// по ней не ходят. Твёрдое — то, что торчит из корабля: трап, порог,
// стойки шасси, переложенные в оси грунта. Этот мир собирает js/main.js.

import { airSolids } from './airlock.js';

export const WALK = {
  half: 0.25,          // м — полуширина тела в плане
  height: 1.8,         // м — рост
  eye: 1.66,           // м — глаза от пола
  speed: 2.0,          // м/с — шаг
  run: 4.6,            // м/с — бег (Shift)
  accel: 14,           // м/с² — разгон и остановка на полу
  air: 2.5,            // м/с² — в прыжке управлять почти нечем
  g: 9.81,             // м/с² — палуба
  jump: 0.45,          // м — прыжок с места
  step: 0.42,          // м — порог, на который нога поднимается сама
  snap: 0.45,          // м — по ступеням вниз без отрыва от пола
  sub: 1 / 120,        // с — шаг интегрирования
  look: 0.0022,        // рад на точку мыши
  pitchMax: 1.45,      // рад — вверх и вниз почти до отвеса
  rise: 0.9,           // с — встать с кресла
  sit: 0.7,            // с — сесть
  doorNear: 2.2,       // м — дверь открывается, когда до неё ближе
  doorTime: 0.45,      // с — ход створки
  doorPass: 0.75,      // доля хода, с которой в проём уже проходят
  bob: 0.022,          // м — размах головы на шаге (центр масс ходит на 4–5 см)
  stride: 0.75,        // м — длина шага
  // Бегом шаг длиннее, а не чаще: человек на 4.6 м/с делает около трёх
  // шагов в секунду, а не шесть — с шагом в 0.75 м звук шёл бы дробью.
  strideRun: 1.4,      // м — длина шага бегом
  // Приземление слышно отдельным шагом, если пришли на ноги быстрее
  // этого: спрыгнуть со ступени — не удар, а соскочить с трапа — удар.
  landStep: 1.5,       // м/с
};

/** Скорость отрыва для прыжка WALK.jump. */
export const jumpSpeed = () => Math.sqrt(2 * WALK.g * WALK.jump);

export function makeWalker() {
  return {
    on: false,           // на ногах ли пилот (или сидит в кресле)
    phase: 'seated',     // seated | rise | walk | sit
    t: 0,                // время в фазе, с
    pos: [0, 0, 0],      // ноги: середина низа тела, оси корабля, м
    vel: [0, 0, 0],
    yaw: 0,              // рад — 0 смотрит в нос, + — вправо
    pitch: 0,            // рад — + вверх
    ground: true,
    lag: 0,              // м — на сколько глаз отстаёт от шага на ступень
    bobPhase: 0,
    floor: 'deck',       // на чём стоит: deck — твёрдое корабля, ground — грунт (звук шагов)
    landed: 0,           // м/с — с какой скоростью пришёл на ноги в этом кадре
    room: null,          // комната под ногами (js/models/interior.js)
    out: null,           // за бортом: оси грунта (js/game/outside.js), иначе null
    // Шлюзы того корабля, на борту которого пилот (js/game/airlock.js,
    // makeAir): помещения у кораблей одного типа одни, а люки у каждого
    // свои. null — свой корабль (interior.air).
    air: null,
    // Другие люди на этой же палубе — точки ног в осях корабля: двери
    // открываются и перед ними (js/game/people.js).
    others: [],
    from: null,          // откуда встали: взгляд головы в кресле
    grid: null,          // твёрдое, разложенное по клеткам
    crates: [],          // ящики груза в трюме (твёрдые, меняются с грузом)
  };
}

// --- твёрдое -------------------------------------------------------------------

const CELL = 2;          // м — клетка разбивки твёрдого в плане

/** Разложить твёрдое по клеткам плана: запрос смотрит только свои. */
export function solidGrid(solids) {
  const grid = new Map();
  for (const s of solids) {
    const i0 = Math.floor(s.lo[0] / CELL), i1 = Math.floor(s.hi[0] / CELL);
    const k0 = Math.floor(s.lo[2] / CELL), k1 = Math.floor(s.hi[2] / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let k = k0; k <= k1; k++) {
        const key = i * 4096 + k;
        let list = grid.get(key);
        if (!list) grid.set(key, list = []);
        list.push(s);
      }
    }
  }
  return grid;
}

/** Ящики груза — по числу тонн в трюме, по местам crateSlots(). */
export function crateSolids(interior, tons) {
  const n = Math.min(interior.slots.length, Math.max(0, Math.ceil((tons || 0) / interior.crate.tons - 1e-9)));
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = interior.slots[i];
    out.push({ lo: [s.x - s.half, s.y, s.z - s.half], hi: [s.x + s.half, s.y + s.h, s.z + s.half], crate: i });
  }
  return out;
}

/** Створки, которые ещё не отъехали: проём занят. */
function doorSolids(interior) {
  const out = [];
  for (const d of interior.doors) {
    if (d.open >= WALK.doorPass) continue;
    const INT = interior.INT;
    const thick = d.id === 'bridge' ? INT.bulkT : INT.gap;
    const lo = [0, d.pos[1], 0], hi = [0, d.pos[1] + d.height, 0];
    const t = d.ax === 0 ? 2 : 0;
    lo[d.ax] = d.pos[d.ax] - thick / 2 - 0.02; hi[d.ax] = d.pos[d.ax] + thick / 2 + 0.02;
    lo[t] = d.pos[t] - INT.doorHalf; hi[t] = d.pos[t] + INT.doorHalf;
    out.push({ lo, hi, door: d.id });
  }
  return out;
}

function makeWorld(w, interior) {
  if (!w.grid || w.gridOf !== interior) {
    w.grid = solidGrid(interior.solids);
    w.gridOf = interior;
  }
  // Люки и трапы (js/game/airlock.js): закрытая панель — стена, трап —
  // ступени и поручни. Люки — того корабля, где стоит пилот.
  return { grid: w.grid, extra: doorSolids(interior).concat(w.crates, airSolids(w.air || interior.air, w._air || (w._air = []))) };
}

const overlap = (s, lo, hi) => s.lo[0] < hi[0] && s.hi[0] > lo[0] && s.lo[1] < hi[1]
  && s.hi[1] > lo[1] && s.lo[2] < hi[2] && s.hi[2] > lo[2];

/** Всё твёрдое, что пересекает коробку [lo, hi]. */
function query(W, lo, hi, out = []) {
  out.length = 0;
  const seen = new Set();
  const i0 = Math.floor(lo[0] / CELL), i1 = Math.floor(hi[0] / CELL);
  const k0 = Math.floor(lo[2] / CELL), k1 = Math.floor(hi[2] / CELL);
  for (let i = i0; i <= i1; i++) {
    for (let k = k0; k <= k1; k++) {
      const list = W.grid.get(i * 4096 + k);
      if (!list) continue;
      for (const s of list) {
        if (seen.has(s) || !overlap(s, lo, hi)) continue;
        seen.add(s);
        out.push(s);
      }
    }
  }
  for (const s of W.extra) if (overlap(s, lo, hi)) out.push(s);
  return out;
}

const _lo = [0, 0, 0], _hi = [0, 0, 0], _hits = [];

/** Тело в точке p: коробка от ног вверх. Нижний миллиметр не считается — это пол. */
function body(p, lo = _lo, hi = _hi) {
  lo[0] = p[0] - WALK.half; lo[1] = p[1] + 0.001; lo[2] = p[2] - WALK.half;
  hi[0] = p[0] + WALK.half; hi[1] = p[1] + WALK.height; hi[2] = p[2] + WALK.half;
}

/** Упирается ли тело в точке p во что-нибудь. */
export function blocked(W, p) {
  body(p);
  if (query(W, _lo, _hi, _hits).length > 0) return true;
  // Грунт — твёрдое под ногами: ниже его тело не опускается.
  if (W.ground) {
    const gy = W.ground(p[0], p[2]);
    if (gy > p[1] + 0.002) return true;
  }
  return false;
}

/** Опора под телом: верх самого высокого твёрдого в полосе [y − depth, y + up]. */
function support(W, p, depth, up = 0.001) {
  _lo[0] = p[0] - WALK.half; _lo[1] = p[1] - depth; _lo[2] = p[2] - WALK.half;
  _hi[0] = p[0] + WALK.half; _hi[1] = p[1] + up; _hi[2] = p[2] + WALK.half;
  let top = -Infinity;
  for (const s of query(W, _lo, _hi, _hits)) if (s.hi[1] <= p[1] + up + 1e-6) top = Math.max(top, s.hi[1]);
  if (W.ground) {
    const gy = W.ground(p[0], p[2]);
    if (gy <= p[1] + up + 1e-6 && gy >= p[1] - depth) top = Math.max(top, gy);
  }
  return top;
}

// --- кресло -------------------------------------------------------------------

/**
 * Встать с кресла. Взгляд — тот, каким пилот смотрел, сидя (голова на
 * шее, game.camOrbit): вставая, не отворачиваются.
 */
export function standUp(w, interior, look = { yaw: 0, pitch: 0 }) {
  w.on = true;
  w.phase = 'rise';
  w.t = 0;
  w.pos = interior.seat.stand.slice();
  w.vel = [0, 0, 0];
  w.yaw = look.yaw || 0;
  w.pitch = Math.max(-0.6, Math.min(0.6, -(look.pitch || 0)));
  w.from = { yaw: w.yaw, pitch: w.pitch };
  w.ground = true;
  w.lag = 0;
  w.out = null;
  w.room = interior.rooms.find((r) => r.id === 'bridge');
  return w;
}

/** Можно ли сесть: стоит за креслом, на ногах, не в прыжке. */
export function nearSeat(w, interior) {
  if (!w.on || w.phase !== 'walk' || !w.ground) return false;
  const z = interior.seat.zone;
  const p = w.pos;
  return p[0] >= z.lo[0] && p[0] <= z.hi[0] && p[1] >= z.lo[1] && p[1] <= z.hi[1]
    && p[2] >= z.lo[2] && p[2] <= z.hi[2];
}

/** Сесть: тело едет к креслу, взгляд — вперёд. */
export function sitDown(w) {
  w.phase = 'sit';
  w.t = 0;
  w.from = { yaw: w.yaw, pitch: w.pitch, pos: w.pos.slice() };
  w.vel = [0, 0, 0];
  return w;
}

/** Вернуть в кресло сразу (крушение, смерть, перезапуск). */
export function seatNow(w) {
  w.on = false;
  w.out = null;
  w.phase = 'seated';
  w.t = 0;
  w.vel = [0, 0, 0];
  w.lag = 0;
  return w;
}

const smooth = (t) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Глаз пилота в осях корабля, м (и сидя, и в переходе, и на ногах). */
export function walkerEye(w, interior, out = [0, 0, 0]) {
  const seat = interior.seat.eye;
  const standEye = (p) => [p[0], p[1] + WALK.eye - w.lag + Math.sin(w.bobPhase) * WALK.bob * bobK(w), p[2]];
  if (w.phase === 'rise' || w.phase === 'sit') {
    const k = w.phase === 'rise' ? smooth(w.t / WALK.rise) : 1 - smooth(w.t / WALK.sit);
    const s = standEye(w.phase === 'rise' ? w.pos : w.from.pos);
    for (let i = 0; i < 3; i++) out[i] = seat[i] + (s[i] - seat[i]) * k;
    return out;
  }
  if (w.phase === 'seated') { out[0] = seat[0]; out[1] = seat[1]; out[2] = seat[2]; return out; }
  const e = standEye(w.pos);
  out[0] = e[0]; out[1] = e[1]; out[2] = e[2];
  return out;
}

/** Насколько качается голова: только на полу и по скорости шага. */
function bobK(w) {
  if (!w.ground) return 0;
  return Math.min(1, Math.hypot(w.vel[0], w.vel[2]) / WALK.speed);
}

/** Куда смотрит пилот: вперёд, вправо и вверх в осях корабля. */
export function walkerLook(w, out = { fwd: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] }) {
  const cy = Math.cos(w.yaw), sy = Math.sin(w.yaw), cp = Math.cos(w.pitch), sp = Math.sin(w.pitch);
  out.fwd[0] = sy * cp; out.fwd[1] = sp; out.fwd[2] = cy * cp;
  out.right[0] = cy; out.right[1] = 0; out.right[2] = -sy;
  // up = right × fwd... в правой тройке (x вправо, y вверх, z вперёд):
  // up = fwd × right.
  out.up[0] = -sy * sp; out.up[1] = cp; out.up[2] = -cy * sp;
  return out;
}

// --- шаг ----------------------------------------------------------------------

/**
 * Шаг пилота.
 *
 * @param ctl { fwd, side: −1..1, run, jump (нажат в этом кадре), lookX, lookY (рад) }
 * @returns события кадра: { opened: [id двери], seated: true, room: сменилась,
 *   step: { run, land } — нога встала (звук шагов; land — скорость приземления, м/с) }
 */
export function updateWalker(w, interior, ctl, dt, outside = null) {
  const ev = { opened: [], seated: false, room: false };
  if (!w.on) return ev;
  updateDoors(w, interior, dt, ev);
  if (w.out && !outside) return ev;
  if (w.phase === 'rise') {
    w.t += dt;
    if (w.t >= WALK.rise) { w.phase = 'walk'; w.t = 0; }
    return ev;
  }
  if (w.phase === 'sit') {
    w.t += dt;
    const k = smooth(w.t / WALK.sit);
    w.yaw = wrapPi(w.from.yaw) * (1 - k);
    w.pitch = w.from.pitch * (1 - k);
    if (w.t >= WALK.sit) { seatNow(w); ev.seated = true; }
    return ev;
  }

  // Взгляд — сразу, по кадру: мышь не должна ждать шага физики.
  w.yaw = wrapPi(w.yaw + (ctl.lookX || 0));
  w.pitch = Math.max(-WALK.pitchMax, Math.min(WALK.pitchMax, w.pitch + (ctl.lookY || 0)));

  const W = w.out ? outside : makeWorld(w, interior);
  let left = Math.min(dt, 0.1);
  let jump = !!ctl.jump;
  while (left > 1e-6) {
    const h = Math.min(WALK.sub, left);
    left -= h;
    stepBody(w, W, ctl, h, jump);
    jump = false;
  }
  // Глаз догоняет тело после ступени: на трапе голова не прыгает
  // ступенями, а едет — как у человека, у которого гнутся колени.
  w.lag *= Math.exp(-dt * 14);
  if (Math.abs(w.lag) < 1e-4) w.lag = 0;
  const v = Math.hypot(w.vel[0], w.vel[2]);
  // Шаг — половина периода качания головы: нога встаёт, голова в низшей
  // точке. Отсюда и звук шагов (ev.step): он идёт ровно в такт с тем,
  // что видно, а не своим таймером.
  const runK = Math.max(0, Math.min(1, (v - WALK.speed) / (WALK.run - WALK.speed)));
  const stride = WALK.stride + (WALK.strideRun - WALK.stride) * runK;
  const was = Math.floor(w.bobPhase / Math.PI);
  if (w.ground && v > 0.2) w.bobPhase += (v * dt / stride) * Math.PI;
  if (Math.floor(w.bobPhase / Math.PI) !== was) ev.step = { run: runK > 0.5, land: 0 };
  // На чём стоит: грунт (за бортом, ноги на нём) или твёрдое корабля —
  // палуба, трап, порог люка.
  if (w.ground) {
    const gy = W.ground ? W.ground(w.pos[0], w.pos[2]) : -Infinity;
    w.floor = Math.abs(w.pos[1] - gy) < 0.003 ? 'ground' : 'deck';
  }
  if (w.landed > WALK.landStep) ev.step = { run: false, land: w.landed };
  w.landed = 0;

  if (w.out) {
    if (w.room) { w.room = null; ev.room = true; }
    return ev;
  }
  const r = interior.roomAt(w.pos) || w.room;
  if (r !== w.room) { w.room = r; ev.room = true; }
  return ev;
}

function stepBody(w, W, ctl, dt, jump) {
  const p = w.pos, v = w.vel;
  // Куда хочет идти: от взгляда в плане палубы.
  const cy = Math.cos(w.yaw), sy = Math.sin(w.yaw);
  let fx = (ctl.fwd || 0) * sy + (ctl.side || 0) * cy;
  let fz = (ctl.fwd || 0) * cy - (ctl.side || 0) * sy;
  const fl = Math.hypot(fx, fz);
  if (fl > 1) { fx /= fl; fz /= fl; }
  const top = ctl.run ? WALK.run : WALK.speed;
  const wx = fx * top, wz = fz * top;
  const a = (w.ground ? WALK.accel : WALK.air) * dt;
  const dx = wx - v[0], dz = wz - v[2];
  const dl = Math.hypot(dx, dz);
  if (dl <= a) { v[0] = wx; v[2] = wz; } else { v[0] += dx / dl * a; v[2] += dz / dl * a; }

  // Толчок ногами один и тот же, а высота прыжка — по тяжести: на
  // ледяной луне человек прыгает на два метра.
  if (jump && w.ground) { v[1] = jumpSpeed(); w.ground = false; w.jumped = true; }
  v[1] -= (W.g || WALK.g) * dt;

  const wasGround = w.ground;
  // Грунт за бортом — ПОВЕРХНОСТЬ, по которой идут, а не стенка, в
  // которую упираются. Раньше он был стенкой с допуском в 2 мм: на
  // подъёме шаг уводил ноги под грунт на полтора миллиметра, падение за
  // подшаг добавляло ещё полмиллиметра, опора их уже не видела (она
  // ищет пол не выше ступни), пилот на подшаг «повисал» — и следующий шаг
  // в склон упирался, а упор обнулял скорость. На ровном подъёме в 15°
  // это случалось каждые два кадра: скорость не набиралась выше
  // полуметра в секунду, и казалось, что пилот в чём-то вязнет.
  // Теперь нога идёт по рельефу: где грунт выше ступни (не выше
  // ступени), ступня встаёт на него; выше ступени — это уступ, стена.
  const G = W.ground || null;
  if (G) {
    // Сменилась подробность нарисованного грунта (подгрузились плитки) —
    // ноги могли оказаться чуть ниже него: встать на него.
    const gy = G(p[0], p[2]);
    if (gy > p[1] && gy - p[1] <= WALK.step) p[1] = gy;
  }
  // По плану — по осям, с подъёмом на порог.
  for (const ax of [0, 2]) {
    const d = v[ax] * dt;
    if (d === 0) continue;
    const q = [p[0], p[1], p[2]];
    q[ax] += d;
    // Вода — берег: в неё не заходят (но из неё, если уж попал, — выходят).
    if (W.water && W.water(q[0], q[2]) && !W.water(p[0], p[2])) { v[ax] = 0; continue; }
    if (G) {
      const gy = G(q[0], q[2]);
      if (gy > q[1]) {
        if (gy - q[1] > WALK.step) { v[ax] = 0; continue; }   // уступ выше ступени
        q[1] = gy;
      }
    }
    if (!blocked(W, q)) { p[0] = q[0]; p[1] = q[1]; p[2] = q[2]; continue; }
    // Порог: тело поднимается ровно на высоту того, во что упёрлось, а не
    // на весь допуск сразу, — иначе под низким потолком (трап уходит в
    // проём) голова цепляла бы кромку там, где ноге хватает и ступени.
    if (wasGround) {
      const s = support(W, [q[0], q[1] + WALK.step, q[2]], WALK.step + 0.01);
      if (s > q[1] + 1e-4 && s <= q[1] + WALK.step) {
        const up = [q[0], s, q[2]];
        if (!blocked(W, up)) {
          w.lag += up[1] - p[1];
          p[0] = up[0]; p[1] = up[1]; p[2] = up[2];
          continue;
        }
      }
    }
    v[ax] = 0;
  }

  // По высоте. Грунт — пол без допуска: ниже него ноги не уходят, и
  // стоящий на нём стоит, а не повисает на подшаг.
  const y1 = p[1] + v[1] * dt;
  const q = [p[0], y1, p[2]];
  const gy = G ? G(p[0], p[2]) : -Infinity;
  if (y1 >= gy && !blocked(W, q)) {
    p[1] = y1;
    w.ground = false;
  } else if (v[1] < 0) {
    if (!wasGround) w.landed = Math.max(w.landed || 0, -v[1]);
    const s = support(W, [p[0], p[1], p[2]], p[1] - y1 + 0.01);
    if (s > -Infinity) p[1] = s;
    v[1] = 0;
    w.ground = true;
    w.jumped = false;
  } else {
    // Головой в потолок: остановиться под ним.
    body(q);
    let low = Infinity;
    for (const s of query(W, _lo, _hi, _hits)) low = Math.min(low, s.lo[1]);
    if (isFinite(low)) p[1] = Math.min(p[1], low - WALK.height - 0.002);
    v[1] = 0;
  }

  // Вниз по ступеням — не отрываясь: шаг с ними совпадает, и без этого
  // пилот на каждой ступени на миг повисал бы в воздухе.
  if (!w.ground && wasGround && !w.jumped && v[1] <= 0) {
    const s = support(W, p, WALK.snap);
    if (s > -Infinity && p[1] - s <= WALK.snap) {
      w.lag += s - p[1];
      p[1] = s;
      v[1] = 0;
      w.ground = true;
    }
  }
}

// --- двери --------------------------------------------------------------------

/**
 * Двери открываются сами, когда к ним подходят, и закрываются, когда
 * отходят: как на любом корабле, где руки бывают заняты. Подходит не
 * только сам пилот — и любой, кто ходит по той же палубе (w.others).
 */
const nearDoor = (d, p) => {
  const t = d.ax === 0 ? 2 : 0;
  return Math.hypot(p[d.ax] - d.pos[d.ax], p[t] - d.pos[t]) < WALK.doorNear && Math.abs(p[1] - d.pos[1]) < 1.2;
};

function updateDoors(w, interior, dt, ev) {
  const others = w.others || [];
  for (const d of interior.doors) {
    let near = w.on && w.phase !== 'seated' && !w.out && nearDoor(d, w.pos);
    for (let i = 0; !near && i < others.length; i++) near = nearDoor(d, others[i]);
    const want = near ? 1 : 0;
    if (want && !d.want) ev.opened.push(d.id);
    d.want = want;
    const k = dt / WALK.doorTime;
    d.open = want ? Math.min(1, d.open + k) : Math.max(0, d.open - k);
  }
}

/**
 * Двери, когда сам пилот сидит: по палубе могут ходить другие (пассажиры),
 * и двери перед ними открываются так же.
 */
export function stepDoors(w, interior, dt) {
  const ev = { opened: [] };
  updateDoors(w, interior, dt, ev);
  return ev.opened;
}

/** Ничего не держит двери открытыми: все закрыты (пилот в кресле). */
export function closeDoors(interior) {
  for (const d of interior.doors) { d.open = 0; d.want = 0; }
}

/** Мир за бортом для шага (updateWalker, outside): твёрдое, грунт, вода, тяжесть. */
export function outsideWorld(solids, ground, water, g) {
  return { grid: EMPTY, extra: solids, ground, water, g };
}
const EMPTY = new Map();
