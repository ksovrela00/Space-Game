// Пыль из-под движков у самой земли.
//
// Зачем. На кадрах «Аполлонов» по одной поднятой пыли видно, что до
// грунта осталось метров пять: она вылетает из-под сопел плоскими
// веерами и уходит далеко, потому что воздуха нет и тормозить её нечем.
// Это и есть недостающий признак близости — движение в кадре там, где
// неподвижный грунт ничего о расстоянии не говорит.
//
// Физики ровно столько, чтобы поведение следовало из мира:
//
//   * пыль поднимается только когда работают движки И грунт близко;
//     сила — от тяги и от того, насколько близко;
//   * частица летит баллистически в местной тяжести тела, поэтому на
//     луне она уходит далеко и полого, а на тяжёлой планете падает
//     рядом. Никакого «времени жизни в секундах» для этого не нужно:
//     частица живёт, пока не вернулась на грунт;
//   * живёт всё это в осях ТЕЛА, а не мира. Внутри захвата корабль
//     переносится вместе с поверхностью (js/game/gravity.js), и пыль,
//     записанная в мировых координатах, за секунду отстала бы на
//     сотни метров — ровно на то, с какой скоростью крутится планета.
//
// Рендер отсюда только читает: ему нужны положение частицы в осях тела
// и её возраст.

import { v3 } from '../core/vec3.js';
import { makeBasis, toLocal } from '../core/basis.js';
import { bodyBasis } from './world.js';
import { isSolid } from './surface.js';
import { makeRng } from '../core/rng.js';
import { Q } from '../core/quality.js';
import { terrainOf } from '../gl/terrain.js';
import { engineLoad, washState, makeWash, airDensity, WASH } from './downwash.js';

// Случайность у пыли своя и СЕЯНАЯ, как у всего остального в этом мире:
// одинаковый заход даёт одинаковый веер. Без этого поведение эффекта
// нельзя ни проверить, ни повторить — а проверять тут есть что, начиная
// с того, на какую высоту пыль поднимается в разной тяжести.
const rng = makeRng(0x0d05);

export const DUST = {
  // Выше этой высоты пыль не поднимается: струя расходится и грунта уже
  // не трогает. Сорок метров — это примерно то, с чего её видно на
  // посадочных кадрах.
  maxAlt: 0.04,        // км
  // Частиц много и они мелкие: пыль — это взвесь, а не десяток комьев.
  // Крупные редкие пятна читались как снежки, и никакая яркость этого
  // не чинит — чинит количество.
  max: Q.dust,         // частиц одновременно
  rate: 220,           // частиц в секунду на полной тяге у самой земли
  speed: 0.055,        // км/с — скорость выброса на полной тяге
  // Вверх уходит малая доля: струя бьёт в грунт и расходится вдоль
  // него. Отсюда и знакомый по посадочным кадрам плоский веер, а не
  // фонтан — и по нему же видно тяжесть тела: чем она меньше, тем выше
  // и дальше уходит пыль.
  rise: 0.09,
  spread: 0.35,        // разброс скорости между частицами
  // Пыль оседает: за это время частица гаснет, даже если ещё летит.
  fade: 2.5,           // с
  // Доля тяги маршевых, которая достаётся грунту. Их струя идёт вдоль
  // корпуса, а не вниз, поэтому землю она метёт позади корабля и слабее,
  // чем подъёмные.
  mainShare: 0.55,
  // Насколько позади корабля бьёт струя маршевых, км (примерно длина
  // корпуса).
  mainBack: 0.07,

  // --- В ВОЗДУХЕ всё иначе ------------------------------------------------
  //
  // Там пыль не летит сама: мелкая взвесь идёт вместе с воздухом (время
  // её отклика — сотые доли секунды), а воздух у грунта гонит настильная
  // струя (js/game/downwash.js). Поэтому пыль в воздухе — это ветер,
  // который стало видно, и всё её поведение берётся из него:
  //
  //   * срывается она там, где ветер у грунта сильнее порога, — внутри
  //     круга, чей радиус считается из тяги: wallK·√(T/ρ)/порог;
  //   * уносится наружу и тормозит как 1/r, а на краю круга ветер уже
  //     не держит её — и она ВИСИТ. Отсюда кольцо: оно не нарисовано,
  //     а набирается из пыли, которой дальше лететь не на чем;
  //   * поднимается она в слое настильной струи, чья толщина — десятая
  //     часть расстояния от точки удара.
  //
  // Порог срыва — для сухого грунта: песок и пыль трогаются при ветре в
  // пять-десять метров в секунду у земли, дёрн держит дольше.
  airThreshold: 10,    // м/с
  airRate: 34,         // частиц в секунду, пока грунт метёт
  airFade: 5.5,        // с — взвесь висит дольше, чем летит баллистика
  airLag: 0.35,        // с — за столько частица догоняет ветер
  airSettle: 0.0004,   // км/с — оседание
  airSize: 0.004,      // км — облачко при срыве
  airGrow: 0.0035,     // км/с — растёт, пока его раздувает ветер
};

export function makeDust() {
  return { list: [], body: null, spawn: 0, air: false, ring: 0 };
}

const _frame = makeBasis();
const _p = v3();
const _back = v3();
const _aft = v3();
const _load = { lift: 0, main: 0 };
const _wash = makeWash();
// Четвёртая ячейка — высота над морем (js/gl/terrain.js, sample).
const _rgb = [0, 0, 0, 0];

/**
 * Пересчитать пыль.
 *
 * @param dust состояние (makeDust)
 * @param game нужны ship, zone (обстановка у поверхности) и world
 * @param dt   шаг по времени игрока
 */
export function updateDust(dust, game, dt) {
  const ship = game.ship;
  const zone = game.zone;
  const body = zone && zone.body;
  const list = dust.list;

  // Сменилось тело — прежняя пыль к нему отношения не имеет.
  if (body !== dust.body) { list.length = 0; dust.body = body || null; }
  if (!body || !isSolid(body)) { list.length = 0; return dust; }

  // У тела с воздухом своя пыль: её несёт ветер, а не баллистика.
  dust.air = airDensity(body) > 0;
  if (dust.air) return updateAirDust(dust, game, dt);

  const frame = bodyBasis(body, _frame);
  const g = (body.g0 || 1) / 1000;             // км/с²

  // Летим дальше: тяжесть тела и оседание.
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    // Тяжесть направлена к центру тела; на масштабе десятков метров
    // местная вертикаль — это просто направление от центра.
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    p.vx -= (p.x / r) * g * dt;
    p.vy -= (p.y / r) * g * dt;
    p.vz -= (p.z / r) * g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.age += dt;
    // Умирает, когда осела на грунт (вернулась на свой уровень) или
    // погасла от времени.
    if (p.age > DUST.fade || r < p.r0) { list.splice(i, 1); continue; }
    p.fade = 1 - p.age / DUST.fade;
  }

  // Поднимается только от работающих движков и только у самой земли.
  const alt = zone.alt;
  if (!(alt >= 0) || alt > DUST.maxAlt || ship.stun > 0 || ship.dockedAt) return dust;

  // Сколько работают ДВИГАТЕЛИ, а не сколько отклонена ручка.
  //
  // Это не одно и то же, и разницу видно сразу: корабль висит над
  // грунтом без единого нажатия — а держат его подъёмные движки, потому
  // что с убранным шасси компенсатор высоты в точности гасит вес
  // (js/game/ship.js). Значит, вниз они дуют всегда, и пыль под ними
  // стоять обязана. Доля этой тяги выводится из модели: полный ход даёт
  // втрое больше веса, стало быть на зависание уходит треть.
  const load = engineLoad(ship, _load);
  const lift = load.lift;
  const main = load.main * DUST.mainShare;
  const power = Math.min(1, lift + main);
  const near = 1 - alt / DUST.maxAlt;
  const rate = DUST.rate * power * near * near;
  if (rate <= 0) { dust.spawn = 0; return dust; }
  // Какая доля пыли поднята маршевыми: она летит не из-под днища, а
  // из-за кормы, куда достаёт их струя.
  const backShare = power > 0 ? main / (lift + main) : 0;

  // Точка под кораблём в осях тела — оттуда и летит.
  toLocal(frame, body.pos, ship.pos, _p);
  const len = Math.hypot(_p.x, _p.y, _p.z) || 1;
  const gx = _p.x / len, gy = _p.y / len, gz = _p.z / len;      // местная вертикаль
  const ground = len - alt;

  // Касательные оси: по ним расходится веер.
  const helper = Math.abs(gy) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let tx = helper.y * gz - helper.z * gy;
  let ty = helper.z * gx - helper.x * gz;
  let tz = helper.x * gy - helper.y * gx;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  const bx = gy * tz - gz * ty, by = gz * tx - gx * tz, bz = gx * ty - gy * tx;

  // Куда смотрит корма в осях тела: туда бьёт струя маршевых. Точку
  // берём в километре за кормой и переводим в те же оси, что и всё
  // остальное, — направление из разности и получится.
  _aft.x = ship.pos.x - ship.basis.fwd.x;
  _aft.y = ship.pos.y - ship.basis.fwd.y;
  _aft.z = ship.pos.z - ship.basis.fwd.z;
  toLocal(frame, body.pos, _aft, _back);
  // Оставляем от неё только касательную часть: вниз струя не смотрит.
  let ax = _back.x - _p.x, ay = _back.y - _p.y, az = _back.z - _p.z;
  const adot = ax * gx + ay * gy + az * gz;
  ax -= gx * adot; ay -= gy * adot; az -= gz * adot;
  const al = Math.hypot(ax, ay, az) || 1;
  ax /= al; ay /= al; az /= al;

  dust.spawn += rate * dt;
  while (dust.spawn >= 1 && list.length < DUST.max) {
    dust.spawn -= 1;
    const fromMain = rng.range(0, 1) < backShare;
    const a = rng.range(0, Math.PI * 2);
    const v = DUST.speed * power * (1 - DUST.spread + rng.range(0, 1) * DUST.spread * 2);
    const ca = Math.cos(a), sa = Math.sin(a);
    // Старт — на грунте, чуть в стороне от оси: струя бьёт не в точку.
    // Пыль от маршевых — позади корабля, и летит она туда же, куда бьёт
    // струя, а не веером во все стороны.
    const off = 0.004 + rng.range(0, 0.006);
    const back = fromMain ? DUST.mainBack : 0;
    const dx = (tx * ca + bx * sa), dy = (ty * ca + by * sa), dz = (tz * ca + bz * sa);
    const wx = fromMain ? ax * 0.75 + dx * 0.25 : dx;
    const wy = fromMain ? ay * 0.75 + dy * 0.25 : dy;
    const wz = fromMain ? az * 0.75 + dz * 0.25 : dz;
    list.push({
      x: gx * ground + dx * off + ax * back,
      y: gy * ground + dy * off + ay * back,
      z: gz * ground + dz * off + az * back,
      vx: wx * v + gx * v * DUST.rise,
      vy: wy * v + gy * v * DUST.rise,
      vz: wz * v + gz * v * DUST.rise,
      r0: ground,
      age: 0,
      fade: 1,
      size: 0.6 + rng.range(0, 0.8),
    });
  }
  if (list.length >= DUST.max) dust.spawn = 0;
  return dust;
}

/**
 * Пыль в воздухе: её несёт настильная струя (см. DUST, «в воздухе»).
 *
 * Частица держит свою скорость и тянется к скорости ветра в своей
 * точке с отставанием airLag; ветер — радиальный от точки удара струи,
 * убывает как 1/r и живёт в слое толщиной в десятую часть r. Над слоем
 * воздух стоит, и поднятое туда облако только оседает.
 */
function updateAirDust(dust, game, dt) {
  const list = dust.list;
  const w = washState(game, _wash);
  const rho = airDensity(dust.body);
  const S = w.T > 0 ? Math.sqrt(w.T / rho) : 0;       // √(J/ρ), м²/с
  const up = w.up;
  const kLag = Math.min(1, dt / DUST.airLag);

  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.age += dt;
    if (p.age > DUST.airFade) { list.splice(i, 1); continue; }
    p.fade = 1 - p.age / DUST.airFade;
    // Ветер в точке частицы.
    let ax = 0, ay = 0, az = 0;
    if (S > 0 && w.h < Infinity) {
      const ex = p.x - w.hit.x, ey = p.y - w.hit.y, ez = p.z - w.hit.z;
      const e = ex * up.x + ey * up.y + ez * up.z;
      const hx = ex - up.x * e, hy = ey - up.y * e, hz = ez - up.z * e;
      const r = Math.hypot(hx, hy, hz) || 1e-9;            // км
      const u = S * Math.min(WASH.jetK / w.h, WASH.wallK / Math.max(r * 1000, 1)) / 1000;
      // Высота частицы над грунтом, где её подняли, и толщина слоя.
      const z = Math.hypot(p.x, p.y, p.z) - p.r0;
      const layer = 0.1 * r + 0.002;
      const inLayer = Math.exp(-(z / layer) * (z / layer));
      const sp = u * inLayer;
      ax = hx / r * sp + up.x * sp * 0.12;
      ay = hy / r * sp + up.y * sp * 0.12;
      az = hz / r * sp + up.z * sp * 0.12;
    }
    ax -= up.x * DUST.airSettle; ay -= up.y * DUST.airSettle; az -= up.z * DUST.airSettle;
    p.vx += (ax - p.vx) * kLag;
    p.vy += (ay - p.vy) * kLag;
    p.vz += (az - p.vz) * kLag;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    // Облако раздувает тем сильнее, чем быстрее его несёт.
    p.size += (DUST.airGrow * 0.3 + Math.hypot(p.vx, p.vy, p.vz) * 0.05) * dt;
  }

  // Срыв: только там, где ветер у грунта сильнее порога.
  dust.ring = 0;
  if (!w.on || !(S > 0) || !(w.h < Infinity)) { dust.spawn = 0; return dust; }
  const uAxis = WASH.jetK * S / w.h;
  if (uAxis < DUST.airThreshold) { dust.spawn = 0; return dust; }
  const rIn = w.h * WASH.wallK / WASH.jetK;             // м — там струя ложится на грунт
  const rOut = WASH.wallK * S / DUST.airThreshold;      // м — дальше ветер не срывает
  dust.ring = rOut / 1000;
  const terrain = terrainOf(dust.body);
  const R = dust.body.radius;

  // Касательные оси в точке удара.
  const helper = Math.abs(up.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let tx = helper.y * up.z - helper.z * up.y;
  let ty = helper.z * up.x - helper.x * up.z;
  let tz = helper.x * up.y - helper.y * up.x;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  const bx = up.y * tz - up.z * ty, by = up.z * tx - up.x * tz, bz = up.x * ty - up.y * tx;

  dust.spawn += DUST.airRate * dt;
  while (dust.spawn >= 1 && list.length < DUST.max) {
    dust.spawn -= 1;
    // Равномерно по ПЛОЩАДИ круга, где метёт: большая часть пыли
    // срывается у внешнего края — там и площадь, и туда же её сносит.
    const lo = Math.min(rIn, rOut);
    const r = Math.sqrt(lo * lo + rng.range(0, 1) * (rOut * rOut - lo * lo)) / 1000;   // км
    const a = rng.range(0, Math.PI * 2);
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = w.hit.x + (tx * ca + bx * sa) * r;
    const py = w.hit.y + (ty * ca + by * sa) * r;
    const pz = w.hit.z + (tz * ca + bz * sa) * r;
    const pl = Math.hypot(px, py, pz) || 1;
    const dx = px / pl, dy = py / pl, dz = pz / pl;
    const g = 1 + terrain.displace(dx, dy, dz);
    terrain.color(dx, dy, dz, _rgb);
    // Цвет — самого грунта, посветлее: это поднятая пыль, а не тень. Над
    // водой струя поднимает не пыль, а брызги, и они белые. Вода — по
    // высоте над морем, а не по синеве: синим море теперь красит шейдер,
    // а цвет вершин под водой — это дно.
    const wet = _rgb[3] < 0;
    const col = wet ? [0.86, 0.9, 0.94]
      : [_rgb[0] * 0.7 + 0.28, _rgb[1] * 0.7 + 0.26, _rgb[2] * 0.7 + 0.22];
    list.push({
      x: dx * g * R, y: dy * g * R, z: dz * g * R,
      vx: 0, vy: 0, vz: 0,
      r0: g * R,
      age: 0,
      fade: 1,
      size: DUST.airSize * (0.7 + rng.range(0, 0.6)),
      col,
    });
  }
  if (list.length >= DUST.max) dust.spawn = 0;
  return dust;
}
