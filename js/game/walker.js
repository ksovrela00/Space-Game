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
  // Пригнуться. Бортовой люк — 1.86 м при росте 1.8: в корабле, стоящем
  // ровно, проходят не нагибаясь. А на склоне корабль стоит с креном до
  // 20°, человек же за бортом стоит по отвесу, и проём для него наклонён:
  // над порогом остаётся 1.86·cos 20° без полуширины тела на наклоне —
  // около 1.6 м. Люди в такой двери пригибаются; пилот — тоже, сам, когда
  // упёрся головой, а ногам дорога есть.
  duck: 1.4,           // м — рост пригнувшись: ниже не пролезть
  unduck: 1.2,         // м/с — как быстро выпрямляется, когда над головой есть место
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
    height: WALK.height, // м — рост сейчас: пригнувшись под притолокой — меньше
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
    props: [],           // вездеход в трюме: кузов и трап в осях носителя (js/game/hangar.js)
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
    // Толщина — у самой двери: переборка рубки тоньше перегородки.
    const thick = d.thick || (d.id === 'bridge' ? INT.bulkT : INT.gap);
    const lo = [0, d.pos[1], 0], hi = [0, d.pos[1] + d.height, 0];
    const t = d.ax === 0 ? 2 : 0;
    lo[d.ax] = d.pos[d.ax] - thick / 2 - 0.02; hi[d.ax] = d.pos[d.ax] + thick / 2 + 0.02;
    lo[t] = d.pos[t] - INT.doorHalf; hi[t] = d.pos[t] + INT.doorHalf;
    out.push({ lo, hi, door: d.id });
  }
  return out;
}

function makeWorld(w, interior, air = w.air || interior.air, buf = w._air || (w._air = [])) {
  if (!w.grid || w.gridOf !== interior) {
    w.grid = solidGrid(interior.solids);
    w.gridOf = interior;
  }
  // Люки и трапы (js/game/airlock.js): закрытая панель — стена, трап —
  // ступени и поручни. Люки — того корабля, где стоит пилот.
  return { grid: w.grid, extra: doorSolids(interior).concat(w.crates, w.props || [],
    air ? airSolids(air, buf) : restingBays(interior)) };
}

/**
 * Плиты грузовых платформ в поднятом положении — пол трюма, пока у
 * корабля нет состояния шлюзов (оно заводится после помещений, а у чужого
 * корабля — когда к нему подходят). В полу трюма проём под платформу, и
 * без этого он был бы ямой: так провалился маршрутный робот.
 */
function restingBays(interior) {
  if (!interior.bays || !interior.bays.length) return [];
  if (!interior._bayRest) {
    interior._bayRest = [];
    for (const b of interior.bays) {
      interior._bayRest.push({ lo: [b.x[0], b.deck - b.plate, b.z[0]], hi: [b.x[1], b.deck, b.z[1]], bay: b.id, plate: true });
      if (b.panelBox) interior._bayRest.push({ lo: b.panelBox.lo, hi: b.panelBox.hi, bay: b.id, panel: true });
    }
  }
  return interior._bayRest;
}

const _deckAir = [];

/** Мир палубы корабля с люками air — проверить, где на ней встать, ещё не ступив. */
export function deckWorld(w, interior, air) {
  return makeWorld(w, interior, air, _deckAir);
}

// --- повёрнутые коробки ------------------------------------------------------
//
// За бортом твёрдое корабля лежит в осях ГРУНТА, а построено оно в осях
// КОРАБЛЯ: трап, порог и притолока люка, стойки, днище. Корабль на склоне
// стоит с креном до 20°, и коробка, охватившая повёрнутую, — уже не она.
// Притолока бортового люка длиной 0.6 м при крене в 6° опускается на 6 см
// (а над головой там всего 6 см: проём 1.86 м при росте 1.8), стенки проёма
// высотой 2.6 м при тангаже 15° въезжают в проход на 0.7 м. Пилот застревал
// на пороге, выходя, и упирался в пустоту, входя: на ровном месте этого не
// видно, а на склоне в полтора градуса бортовой люк не выпускал вовсе.
//
// Поэтому у такого твёрдого есть ob — сама коробка (lo, hi в своих осях) и
// то, как она лежит в осях шага: p' = R·p + t (R — строки 3×3, поворот).
// Охватывающие lo, hi остаются: по ним дальнее отсеивается, а то, что
// рядом с телом, считается точно.

const _obC = new Float64Array(24);

/**
 * Какие высоты занимает повёрнутая коробка над прямоугольником плана
 * [x0, x1] × [z0, z1]: out = [низ, верх] — или null, если его она не
 * накрывает.
 *
 * Коробка и бесконечный по высоте столб над прямоугольником — оба
 * выпуклые, значит, и их пересечение, а его высоты — отрезок от нижней
 * вершины до верхней. Вершина — это три плоскости сразу: три грани коробки
 * (её угол внутри столба), две грани и стенка столба (ребро коробки сквозь
 * стенку) или грань и две стенки (ребро столба сквозь грань). Других
 * сочетаний нет — стенки столба попарно параллельны, — и перебираются все
 * три вида.
 */
export function obSpan(ob, x0, x1, z0, z1, out = [0, 0]) {
  const R = ob.R, t = ob.t, lo = ob.lo, hi = ob.hi, C = _obC;
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < 8; i++) {
    const a = i & 1 ? hi[0] : lo[0], b = i & 2 ? hi[1] : lo[1], c = i & 4 ? hi[2] : lo[2];
    const x = R[0] * a + R[1] * b + R[2] * c + t[0];
    const y = R[3] * a + R[4] * b + R[5] * c + t[1];
    const z = R[6] * a + R[7] * b + R[8] * c + t[2];
    C[i * 3] = x; C[i * 3 + 1] = y; C[i * 3 + 2] = z;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) {
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
  }
  // Рёбра коробки — пары углов, различающихся одним битом.
  for (let i = 0; i < 8; i++) {
    for (let bit = 1; bit < 8; bit <<= 1) {
      if (i & bit) continue;
      const j = i | bit;
      const ax = C[i * 3], ay = C[i * 3 + 1], az = C[i * 3 + 2];
      const dx = C[j * 3] - ax, dy = C[j * 3 + 1] - ay, dz = C[j * 3 + 2] - az;
      for (let k = 0; k < 2; k++) {
        if (dx !== 0) {
          const u = ((k ? x1 : x0) - ax) / dx;
          if (u >= 0 && u <= 1) {
            const z = az + dz * u;
            if (z >= z0 && z <= z1) {
              const y = ay + dy * u;
              if (y < ymin) ymin = y;
              if (y > ymax) ymax = y;
            }
          }
        }
        if (dz !== 0) {
          const u = ((k ? z1 : z0) - az) / dz;
          if (u >= 0 && u <= 1) {
            const x = ax + dx * u;
            if (x >= x0 && x <= x1) {
              const y = ay + dy * u;
              if (y < ymin) ymin = y;
              if (y > ymax) ymax = y;
            }
          }
        }
      }
    }
  }
  // Рёбра столба — вертикали по углам плана, сквозь коробку. В её осях
  // вертикаль (X, s, Z) — точка p0 и ход d = Rᵀ·(0, 1, 0), а высота точки на
  // ней — сам параметр s.
  const ex = R[3], ey = R[4], ez = R[5];
  for (let k = 0; k < 4; k++) {
    const qx = (k & 1 ? x1 : x0) - t[0], qy = -t[1], qz = (k & 2 ? z1 : z0) - t[2];
    const p = [R[0] * qx + R[3] * qy + R[6] * qz, R[1] * qx + R[4] * qy + R[7] * qz,
      R[2] * qx + R[5] * qy + R[8] * qz];
    const d = [ex, ey, ez];
    let s0 = -Infinity, s1 = Infinity;
    for (let a = 0; a < 3 && s0 <= s1; a++) {
      if (Math.abs(d[a]) < 1e-12) {
        if (p[a] < lo[a] || p[a] > hi[a]) s0 = Infinity;
        continue;
      }
      let u0 = (lo[a] - p[a]) / d[a], u1 = (hi[a] - p[a]) / d[a];
      if (u0 > u1) { const q = u0; u0 = u1; u1 = q; }
      if (u0 > s0) s0 = u0;
      if (u1 < s1) s1 = u1;
    }
    if (s0 <= s1) {
      if (s0 < ymin) ymin = s0;
      if (s1 > ymax) ymax = s1;
    }
  }
  if (!(ymin <= ymax)) return null;
  out[0] = ymin; out[1] = ymax;
  return out;
}

const _span = [0, 0];

/** Высоты твёрдого над планом [lo, hi]: у повёрнутого — точно, у ровного — его собственные. */
function spanOf(s, lo, hi) {
  if (!s.ob) { _span[0] = s.lo[1]; _span[1] = s.hi[1]; return _span; }
  return obSpan(s.ob, lo[0], hi[0], lo[2], hi[2], _span);
}

function overlap(s, lo, hi) {
  if (!(s.lo[0] < hi[0] && s.hi[0] > lo[0] && s.lo[1] < hi[1]
    && s.hi[1] > lo[1] && s.lo[2] < hi[2] && s.hi[2] > lo[2])) return false;
  if (!s.ob) return true;
  const sp = spanOf(s, lo, hi);
  return sp !== null && sp[0] < hi[1] && sp[1] > lo[1];
}

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

/** Тело ростом h в точке p: коробка от ног вверх. Нижний миллиметр не считается — это пол. */
function body(p, h = WALK.height, lo = _lo, hi = _hi) {
  lo[0] = p[0] - WALK.half; lo[1] = p[1] + 0.001; lo[2] = p[2] - WALK.half;
  hi[0] = p[0] + WALK.half; hi[1] = p[1] + h; hi[2] = p[2] + WALK.half;
}

/** Упирается ли тело ростом h в точке p во что-нибудь. */
export function blocked(W, p, h = WALK.height) {
  body(p, h);
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
  for (const s of query(W, _lo, _hi, _hits)) {
    const y = spanOf(s, _lo, _hi)[1];
    if (y <= p[1] + up + 1e-6) top = Math.max(top, y);
  }
  if (W.ground) {
    const gy = W.ground(p[0], p[2]);
    if (gy <= p[1] + up + 1e-6 && gy >= p[1] - depth) top = Math.max(top, gy);
  }
  return top;
}

/**
 * Сколько места над ногами в точке p, м: низ самого низкого твёрдого, в
 * которое упирается тело ростом h. Стена от пола или грунт выше ступни —
 * ноль: под ними не пролезть.
 */
function headroom(W, p, h) {
  if (W.ground && W.ground(p[0], p[2]) > p[1] + 0.002) return 0;
  body(p, h);
  let low = Infinity;
  for (const s of query(W, _lo, _hi, _hits)) low = Math.min(low, spanOf(s, _lo, _hi)[0]);
  return low - p[1];
}

/** Какой рост помещается в точке p: весь (до h), пригнувшись — или 0, если никак. */
function fitHeight(W, p, h) {
  if (!blocked(W, p, h)) return h;
  const room = headroom(W, p, h) - 0.002;
  return room >= WALK.duck && room < h && !blocked(W, p, room) ? room : 0;
}

/**
 * Где оказаться на пороге в точке p этого мира: встать (standAt) — а в
 * прыжке, когда встать не на что, остаться в воздухе там же, если тело
 * там помещается. Раньше на пороге требовалась опора, и в открытый люк
 * нельзя было впрыгнуть: снаружи за проёмом — стена, а в оси корабля не
 * пускали без опоры — пешеход висел у проёма, как перед стеклом.
 * @returns {{ pos: number[], height: number, air?: true } | null}
 */
export function enterAt(W, p, h, airborne) {
  // Тело — коробка в осях своего мира, и в новых осях она повёрнута на
  // наклон корабля: у косяка двери вездехода при 1.3° её верх заходил в
  // косяк на 3–4 см, и снаружи свободно — а внутри «не встать». Поэтому
  // если ровно здесь нельзя, — ближайшее место в NUDGE вокруг: ноги
  // подправятся на сантиметры, а глаз их догонит (w.lag, lagX, lagZ).
  for (const [dx, dz] of NUDGES) {
    const q = [p[0] + dx, p[1], p[2] + dz];
    const at = standAt(W, q, h);
    if (at) return at;
    if (!airborne) continue;
    const f = fitHeight(W, q, h);
    if (f > 0) return { pos: q, height: f, air: true };
  }
  return null;
}
// Подправки ног на пороге: сначала никакой, дальше по кольцам до 8 см.
const NUDGE = 0.08;
const NUDGES = [[0, 0]];
for (let r = 0.01; r <= NUDGE + 1e-9; r += 0.01) {
  for (let k = 0; k < 8; k++) NUDGES.push([r * Math.cos(k * Math.PI / 4), r * Math.sin(k * Math.PI / 4)]);
}

/**
 * Где встать в точке p этого мира: ноги — на самое высокое твёрдое под ними
 * (не выше ступени и не ниже, чем сходят без прыжка) или на грунт, а тело
 * помещается — во весь рост h или пригнувшись. Иначе null.
 *
 * Нужно на пороге люка: в новых осях ноги должны стоять, а не сидеть
 * внутри наклонённого порога, — иначе тело с первого же кадра упирается
 * во всё сразу и не может сделать ни шагу.
 * @returns {{ pos: number[], height: number } | null}
 */
export function standAt(W, p, h = WALK.height) {
  const s = support(W, [p[0], p[1] + WALK.step, p[2]], WALK.step + WALK.snap);
  if (!(s > -Infinity)) return null;
  const q = [p[0], s, p[2]];
  const f = fitHeight(W, q, h);
  return f > 0 ? { pos: q, height: f } : null;
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
  w.height = WALK.height;
  w.lag = 0; w.lagX = 0; w.lagZ = 0; w.lagV = 0; w.lagVX = 0; w.lagVZ = 0; w.eyeH = WALK.height;
  w.out = null;
  w.room = interior.roomById[interior.seat.room || 'bridge'] || interior.rooms.find((r) => r.id === 'bridge');
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
  w.lag = 0; w.lagX = 0; w.lagZ = 0; w.lagV = 0; w.lagVX = 0; w.lagVZ = 0; w.eyeH = WALK.height;
  return w;
}

const smooth = (t) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Глаз пилота в осях корабля, м (и сидя, и в переходе, и на ногах). */
export function walkerEye(w, interior, out = [0, 0, 0]) {
  const seat = interior.seat.eye;
  // Пригнулся — глаз ниже ровно настолько же (duckEye ниже).
  // Голова — по глазному росту (eyeH): он пригибается заранее и плавно, и
  // ниже тела не прижат: тело — коробка в полметра, и пригибается оно,
  // когда притолоки коснулся её передний край, а глаз — посередине, ещё
  // в 25 см перед ней. Пока глаз дойдёт до притолоки, он уже внизу.
  const duckEye = WALK.height - (w.eyeH || w.height || WALK.height);
  const standEye = (p) => [p[0] - (w.lagX || 0), p[1] + WALK.eye - duckEye - w.lag + Math.sin(w.bobPhase) * WALK.bob * (w.bobA ?? bobK(w)), p[2] - (w.lagZ || 0)];
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

// Глаз за телом — пружиной без перерегулирования (критическое затухание):
// трогается плавно и не перелетает. Было по экспоненте, и треть пути
// голова проходила в первом же кадре — 4–5 см рывка после каждой ступени
// (tools/smoke.mjs, «швы переходов»).
const EYE_W = 14;
const EYE_KEYS = [['lag', 'lagV'], ['lagX', 'lagVX'], ['lagZ', 'lagVZ']];
function eyeSpring(w, dt) {
  const e = Math.exp(-EYE_W * dt);
  for (const [x, v] of EYE_KEYS) {
    const x0 = w[x] || 0, v0 = w[v] || 0;
    if (!x0 && !v0) continue;
    // Точное решение x'' = −k²x − 2kx' на шаг dt: устойчиво при любом dt.
    const c = v0 + EYE_W * x0;
    w[x] = (x0 + c * dt) * e;
    w[v] = (v0 - EYE_W * c * dt) * e;
    if (Math.abs(w[x]) < 1e-4 && Math.abs(w[v]) < 1e-3) { w[x] = 0; w[v] = 0; }
  }
}

// Голова пригибается заранее: впереди по ходу (на DUCK_AHEAD секунд пути)
// притолока ниже роста — глаз опускается к ней плавно, со скоростью
// DUCK_RATE; пригнулось тело — глаз за ним с той же скоростью. Тело
// пригибается сразу (иначе голова прошла бы сквозь притолоку), и глаз с
// ним проваливался на 21 см за кадр.
const DUCK_AHEAD = 0.35, DUCK_RATE = 1.6;
function duckAhead(w, W, dt) {
  const h = w.height || WALK.height;
  let want = h;
  if (Math.hypot(w.vel[0], w.vel[2]) > 0.1) {
    // Там, где придётся стоять: на ступени трапа голова выше, чем у ног
    // сейчас, и пригибаться надо ей, а не тому, кто остался внизу. По
    // шагам — до первой стены: за ней (кузов за дверью) стоять нельзя, и
    // одна дальняя точка не видела притолоки перед ней.
    for (const k of [0.2, 0.45, 0.7, 1]) {
      const t = DUCK_AHEAD * k;
      const at = standAt(W, [w.pos[0] + w.vel[0] * t, w.pos[1], w.pos[2] + w.vel[2] * t], WALK.height);
      if (!at) break;
      if (at.height < want) want = at.height;
    }
  }
  const eh = w.eyeH || h;
  w.eyeH = want < eh ? Math.max(want, eh - DUCK_RATE * dt) : Math.min(want, eh + WALK.unduck * dt);
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
  const p0 = [w.pos[0], w.pos[1], w.pos[2]];
  let left = Math.min(dt, 0.1);
  let jump = !!ctl.jump;
  while (left > 1e-6) {
    const h = Math.min(WALK.sub, left);
    left -= h;
    stepBody(w, W, ctl, h, jump);
    jump = false;
  }
  // Оси, в которых записано последнее свободное место: грунт, чужой борт
  // (помещения у кораблей одного типа одни, а оси — у каждого свои) или свой.
  unstick(w, W, ctl, dt, p0, w.out || w.vessel || interior, ev);
  // Глаз догоняет тело после ступени: на трапе голова не прыгает
  // ступенями, а едет — как у человека, у которого гнутся колени. И вбок —
  // после подправки ног на пороге (enterAt).
  eyeSpring(w, dt);
  duckAhead(w, W, dt);
  // Качание головы нарастает и стихает, а не щёлкает: на кадр «в воздухе»
  // (край ступени, порог, камень) оно пропадало целиком, и глаз дёргался на
  // весь размах шага.
  const bk = bobK(w);
  w.bobA = (w.bobA ?? bk) + (bk - (w.bobA ?? bk)) * (1 - Math.exp(-dt * 8));
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

// Насколько вбок тело ищет проход, когда упёрлось плечом в кромку, м.
// Полметра тела в двери в 0.9 м — по 0.2 м зазора с боков: с 0.25 в дверь
// доскальзывают, идя на полметра в стороне от её оси. Было 0.15, и снаружи
// проём делали шире двери, чтобы до неё дотянуться, — а внутри косяки
// стоят где стоят, и пешеход застревал на пороге между двумя мирами.
const SLIP = 0.25;

/**
 * Сдвиг вбок, с которым шаг q (из p по оси ax) проходит: ближайший из
 * 3, 6 … SLIP см в обе стороны. Сам сдвиг — не больше шага step за раз и
 * только там, где тело встаёт и сбоку. Нет такого — null.
 */
function slipAside(W, p, q, ax, H, step) {
  const ox = ax === 0 ? 2 : 0;
  for (let k = 1; k * 0.03 <= SLIP + 1e-9; k++) {
    for (const s of [1, -1]) {
      const r = [q[0], q[1], q[2]];
      r[ox] += s * k * 0.03;
      if (!(fitHeight(W, r, H) > 0)) continue;
      const t = [p[0], p[1], p[2]];
      t[ox] += s * Math.min(k * 0.03, step);
      if (fitHeight(W, t, H) > 0) return t;
    }
  }
  return null;
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
  // За бортом в пустоте (w.float) тяжести нет: палубная — только в корабле.
  v[1] -= (w.float ? 0 : (W.g || WALK.g)) * dt;

  const wasGround = w.ground;
  // Рост: пригнулся под притолокой — выпрямляется, как только над головой
  // есть место, и не рывком.
  let H = w.height || WALK.height;
  if (H < WALK.height) {
    const want = Math.min(WALK.height, H + WALK.unduck * dt);
    if (!blocked(W, p, want)) H = want;
    else H = Math.max(H, Math.min(want, headroom(W, p, want) - 0.002));
  }
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
    // Ноги ниже грунта ПОД НИМИ ЖЕ — встать на него, на любую высоту.
    // Грунт — поле высот: под ним ни пещер, ни палуб, стоять там нельзя
    // никогда. Раньше подъём был не выше ступени (42 см), и пешеход,
    // оказавшийся под грунтом глубже (грунт сменил подробность, место
    // записано по другому грунту), так под ним и оставался: грунт вокруг —
    // уступ, а уступ — стена. Уступ — это грунт ВПЕРЕДИ, по ходу (ниже).
    const gy = G(p[0], p[2]);
    if (gy > p[1]) { w.lag += gy - p[1]; p[1] = gy; }
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
    // Упёрся только головой — пригнуться (fitHeight), как в низкую дверь.
    let f = fitHeight(W, q, H);
    if (f > 0) { H = f; p[0] = q[0]; p[1] = q[1]; p[2] = q[2]; continue; }
    // Порог: тело поднимается ровно на высоту того, во что упёрлось, а не
    // на весь допуск сразу, — иначе под низким потолком (трап уходит в
    // проём) голова цепляла бы кромку там, где ноге хватает и ступени.
    // И в прыжке — тоже: долетел до кромки, не дотянув ногами, — подтянулся,
    // как человек, что схватился руками. Невидимых заслонов нет (так решил
    // автор игры), и с опускающейся плиты на палубу запрыгивают, а прыжок
    // ногами не достаёт до кромки и в полуметре — 0.43 м против 0.47.
    if (wasGround || !w.ground) {
      const s = support(W, [q[0], q[1] + WALK.step, q[2]], WALK.step + 0.01);
      if (s > q[1] + 1e-4 && s <= q[1] + WALK.step) {
        const up = [q[0], s, q[2]];
        f = fitHeight(W, up, H);
        if (f > 0) {
          H = f;
          w.lag += up[1] - p[1];
          p[0] = up[0]; p[1] = up[1]; p[2] = up[2];
          continue;
        }
      }
    }
    // Задел кромку проёма боком — соскользнуть с неё в проём, как человек
    // в дверь. Тело — коробка в полметра, а дверь вездехода — 0.9 м: стоило
    // идти в четверти метра от оси, и плечо цепляло щёку проёма на пять
    // сантиметров, а шаг вперёд гасился весь — пилот стоял у двери и не мог
    // войти. Если на сдвиге вбок не больше SLIP впереди свободно — тело
    // смещается в ту сторону со скоростью шага (не рывком), пока проход не
    // откроется. Стена шире SLIP так не обходится: упёрся — стоит.
    const side = slipAside(W, p, q, ax, H, Math.abs(d));
    if (side) { p[0] = side[0]; p[2] = side[2]; continue; }
    v[ax] = 0;
  }

  // По высоте. Грунт — пол без допуска: ниже него ноги не уходят, и
  // стоящий на нём стоит, а не повисает на подшаг.
  const y1 = p[1] + v[1] * dt;
  const q = [p[0], y1, p[2]];
  const gy = G ? G(p[0], p[2]) : -Infinity;
  if (y1 >= gy && !blocked(W, q, H)) {
    p[1] = y1;
    w.ground = false;
  } else if (v[1] < 0) {
    if (!wasGround) w.landed = Math.max(w.landed || 0, -v[1]);
    // Пришёл на ноги — глаз по инерции ещё проседает и выпрямляется (колени
    // гнутся), а не встаёт за кадр как вкопанный.
    if (!wasGround) w.lagV = (w.lagV || 0) + Math.min(5, -v[1]);
    const s = support(W, [p[0], p[1], p[2]], p[1] - y1 + 0.01);
    if (s > -Infinity) p[1] = s;
    v[1] = 0;
    w.ground = true;
    w.jumped = false;
  } else {
    // Головой в потолок: остановиться под ним.
    body(q, H);
    let low = Infinity;
    for (const s of query(W, _lo, _hi, _hits)) low = Math.min(low, spanOf(s, _lo, _hi)[0]);
    if (isFinite(low)) p[1] = Math.min(p[1], low - H - 0.002);
    v[1] = 0;
  }
  w.height = H;

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

// --- застрял ------------------------------------------------------------------
//
// Тело может оказаться внутри твёрдого не своим шагом: плита опустилась на
// стоящего под ней, грунт сменил подробность, место записано по другому
// миру. Шаг такое не разрешает — из твёрдого любой шаг тоже упирается, и
// пешеход стоит вмурованным, пока его не вынут руками из базы. Так было у
// автора игры: плита трюма легла на грунт поверх него.
//
// Застрял — значит одно из двух, и не на миг, а дольше STUCK_T:
//   - тело в твёрдом: не помещается ни во весь рост, ни пригнувшись;
//   - его ведут, а он ни на сантиметр, и шагнуть на 10 см некуда ни в одну
//     из восьми сторон. Упереться в стену — не застрять: от стены есть
//     куда отойти, и это не проверяется вовсе, пока шаг идёт.
// Тогда — на ближайшее место, где встать (standAt): вверх, на то, во что
// вмяло, или вбок, по кольцам до RESCUE_R. Рядом негде — туда, где недавно
// свободно стоял (w.safe, в тех же осях). Переносом, а не шагом: шагом
// отсюда не выйти, на то и застрял.
const STUCK_T = { inside: 0.6, boxed: 1.0 };   // с
const RESCUE_R = 4;                            // м — вбок не дальше
const RESCUE_UP = 2.5;                         // м — вверх не дальше
const BOX_STEP = 0.1;                          // м — «шагнуть некуда»
// Куда искать: вверх и по кольцам вбок, ближние — первыми.
const RESCUE = [];
for (let dy = 0.05; dy <= RESCUE_UP + 1e-9; dy += 0.05) RESCUE.push([0, dy, 0]);
for (let r = 0.25; r <= RESCUE_R + 1e-9; r += 0.25) {
  for (let k = 0; k < 16; k++) RESCUE.push([r * Math.cos(k * Math.PI / 8), 0, r * Math.sin(k * Math.PI / 8)]);
}
RESCUE.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));

/** Шагнуть на BOX_STEP некуда ни в одну из восьми сторон (ни прямо, ни на ступень). */
function boxedIn(W, p, H) {
  for (let k = 0; k < 8; k++) {
    const q = [p[0] + BOX_STEP * Math.cos(k * Math.PI / 4), p[1], p[2] + BOX_STEP * Math.sin(k * Math.PI / 4)];
    if (fitHeight(W, q, H) > 0 || standAt(W, q, H)) return false;
  }
  return true;
}

/** Ближайшее место, где встать, рядом с p; рядом нет — у последнего свободного. Или null. */
function rescueSpot(w, W, frame) {
  const p = w.pos, G = W.ground || null;
  for (const [dx, dy, dz] of RESCUE) {
    const x = p[0] + dx, z = p[2] + dz;
    // Вбок за бортом — на грунт той точки: он под ногами бывает и ниже, и выше ступени.
    const y = dy === 0 && G ? G(x, z) : p[1] + dy;
    const at = standAt(W, [x, y, z]);
    // То же место, что и сейчас, — не выход (зажат — стоять тут он и так может).
    if (at && Math.hypot(at.pos[0] - p[0], at.pos[1] - p[1], at.pos[2] - p[2]) > 0.05) return at;
  }
  const s = w.safe;
  if (s && s.at === frame) {
    const at = standAt(W, s.p);
    if (at && Math.hypot(at.pos[0] - p[0], at.pos[1] - p[1], at.pos[2] - p[2]) > 0.05) return at;
  }
  return null;
}

function unstick(w, W, ctl, dt, p0, frame, ev) {
  const p = w.pos, H = w.height || WALK.height;
  const inside = !(fitHeight(W, p, H) > 0);
  const moved = Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]);
  const wants = !!(ctl.fwd || ctl.side || ctl.jump);
  const why = inside ? 'inside' : (wants && moved < 0.01 && boxedIn(W, p, H) ? 'boxed' : null);
  if (!why) {
    w.stuckT = 0;
    // Последнее свободное место — на опоре, в тех же осях, что и сейчас.
    if (w.ground) {
      if (!w.safe) w.safe = { p: [0, 0, 0], at: null };
      w.safe.p[0] = p[0]; w.safe.p[1] = p[1]; w.safe.p[2] = p[2]; w.safe.at = frame;
    }
    return;
  }
  w.stuckT = (w.stuckT || 0) + dt;
  if (w.stuckT < STUCK_T[why]) return;
  w.stuckT = 0;
  const at = rescueSpot(w, W, frame);
  if (!at) return;
  ev.unstuck = { why, from: p.slice(), to: at.pos.slice() };
  // Вверх глаз догоняет, как на ступени; вбок — переносом.
  w.lag += at.pos[1] - p[1];
  p[0] = at.pos[0]; p[1] = at.pos[1]; p[2] = at.pos[2];
  w.height = at.height;
  w.vel[0] = 0; w.vel[1] = 0; w.vel[2] = 0;
  w.ground = true; w.jumped = false;
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
    // Запертая (двери остановок лифта в пути, js/game/lift.js) закрыта,
    // кто бы ни стоял рядом.
    const want = near && !d.lock ? 1 : 0;
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
