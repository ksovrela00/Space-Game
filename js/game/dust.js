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
import { SHIP } from './ship.js';
import { makeRng } from '../core/rng.js';

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
  max: 150,            // частиц одновременно
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
};

export function makeDust() {
  return { list: [], body: null, spawn: 0 };
}

const _frame = makeBasis();
const _p = v3();
const _back = v3();
const _aft = v3();

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
  const c = ship.control || {};
  const hover = ship.gear && ship.gear.out ? 0 : 1 / SHIP.liftTWR;
  const lift = Math.min(1, hover + Math.abs(c.lift || 0));
  const main = Math.abs(ship.throttle || 0) * DUST.mainShare;
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
