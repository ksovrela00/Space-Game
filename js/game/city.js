// Наземный город на теле: где он стоит, как он держится за грунт и во
// что там врезается корабль.
//
// Планировка и модели — в js/models/city.js, здесь только привязка к
// миру. Разделение то же, что у станции: форма отдельно, место отдельно.
//
// ГОРОД ЖИВЁТ НА ВЫРОВНЕННОМ ГРУНТЕ. Площадку в рельеф вписывает сам
// рельеф (js/gl/terrain.js, plate): ровная плита радиусом CITY.plate с
// плавным переходом по краю. Это не подставка под модель, а настоящая
// поверхность — по ней считаются и высота под кораблём, и посадка, и
// плитки, которые рисует видеокарта. Иначе город пришлось бы либо
// подвешивать над рельефом, либо топить в нём, и посадочная площадка
// оказалась бы на склоне кратерного вала.
//
// ВСЁ ДЕТЕРМИНИРОВАНО И БЕЗ УЧАСТИЯ ГЕНЕРАТОРА МИРА. Своё семя берётся
// из имени тела: взять число у мирового ГПСЧ значило бы сдвинуть все
// планеты галактики, а мир уже лежит слепком в базе и в сохранениях
// пилотов (ту же цену однажды заплатили за тип станции).
//
// Про кольцевую зависимость: этот модуль спрашивает у surface.js базис
// тела, а surface.js спрашивает его у world.js, который тянет нас. Круг
// безопасен — ни одна из сторон не зовёт чужие функции во время
// загрузки модуля, — но добавлять в него вызовы «сверху вниз» нельзя.

import { v3, normalize, dot, cross } from '../core/vec3.js';
import { makeRng, makeName } from '../core/rng.js';
import { makeBasis, toLocal } from '../core/basis.js';
import { terrainOf } from '../gl/terrain.js';
import { CITY, cityPlan, cityBlocked, nearestPad } from '../models/city.js';
import { bodyFrame } from './surface.js';

/** Семя из строки: тот же FNV, что у типа станции. */
export function citySeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Годится ли тело под город. Пока только безатмосферные: город под
 * куполом — это одно, город под дождём — совсем другое, и второго у нас
 * нет ни в моделях, ни в посадке (сесть на тело с атмосферой нельзя).
 */
export const canHostCity = (b) => !!b && !!b.isBody && !b.atmo
  && b.kind !== 'star' && b.kind !== 'gas';

const _u = v3(), _v = v3(), _probe = v3();

// Две касательные оси в точке dir — те же, что в surface.js. Свои,
// потому что там они не вынесены наружу, а тащить сюда весь модуль ради
// пяти строк незачем.
function tangents(d, u, v) {
  const helper = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  u.x = helper.y * d.z - helper.z * d.y;
  u.y = helper.z * d.x - helper.x * d.z;
  u.z = helper.x * d.y - helper.y * d.x;
  normalize(u, u);
  cross(d, u, v);
  return normalize(v, v);
}

/**
 * Насколько рвано место: размах высот по площадке будущего города.
 *
 * Именно размах, а не уклон в точке: плита срезает всё, что внутри, и
 * важно не то, наклонён ли центр, а сколько грунта придётся срезать и
 * насыпать по краям. Заодно возвращается средняя высота — по ней плиту
 * и кладут, чтобы выемка и насыпь были примерно равны.
 */
export function siteSpan(body, dir) {
  const t = terrainOf(body);
  const span = CITY.plate / body.radius;
  tangents(dir, _u, _v);
  let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  for (let i = 0; i < 9; i++) {
    let du = 0, dv = 0;
    if (i > 0) {
      const a = ((i - 1) / 8) * Math.PI * 2;
      du = Math.cos(a) * span;
      dv = Math.sin(a) * span;
    }
    _probe.x = dir.x + _u.x * du + _v.x * dv;
    _probe.y = dir.y + _u.y * du + _v.y * dv;
    _probe.z = dir.z + _u.z * du + _v.z * dv;
    normalize(_probe, _probe);
    const h = t.displace(_probe.x, _probe.y, _probe.z);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
    sum += h; n++;
  }
  return { span: hi - lo, mean: sum / n };
}

/**
 * Где на теле встанет город.
 *
 * Место выбирается не «куда упало»: из десятка детерминированных
 * кандидатов берётся тот, где рельеф спокойнее всего. Плита всё равно
 * срежет неровности, но плита в стенке кратера выглядит как карьер, а
 * не как город, и с воздуха к ней не подойти.
 *
 * Широты у полюсов исключены намеренно: там сходятся меридианы, и любая
 * прямоугольная планировка на них выглядит перекошенной.
 */
export function citySite(body, seed) {
  const rng = makeRng(seed);
  let best = null;
  for (let i = 0; i < 10; i++) {
    const lat = rng.range(-0.9, 0.9);          // синус широты
    const lon = rng.range(0, Math.PI * 2);
    const c = Math.sqrt(Math.max(0, 1 - lat * lat));
    const d = v3(Math.cos(lon) * c, lat, Math.sin(lon) * c);
    const s = siteSpan(body, d);
    if (!best || s.span < best.span) best = { dir: d, span: s.span, mean: s.mean };
  }
  return best;
}

let nextCityId = 1;

/**
 * Построить город на теле и вписать под него площадку в рельеф.
 *
 * Плита ставится ДО первого обращения к высоте за пределами этой
 * функции, но ПОСЛЕ того, как высота места измерена: иначе плита мерила
 * бы саму себя.
 */
export function makeCity(body, id = null) {
  const seed = citySeed(body.name + '#' + body.id + '/city');
  const site = citySite(body, seed);
  const rng = makeRng(seed ^ 0x5bf03635);
  const name = makeName(rng) + ' City';

  // Угловые радиусы плиты и перехода — в косинусах? Нет: в КВАДРАТАХ
  // ХОРДЫ. Рельеф считается миллионы раз за кадр, и арккосинус в этом
  // месте стоил бы дороже самого рельефа, а квадрат расстояния между
  // концами двух единичных векторов монотонен по углу и даётся тремя
  // умножениями.
  const th0 = CITY.plate / body.radius;
  const th1 = (CITY.plate + CITY.rim) / body.radius;
  body.plate = {
    x: site.dir.x, y: site.dir.y, z: site.dir.z,
    d0: 2 - 2 * Math.cos(th0),
    d1: 2 - 2 * Math.cos(th1),
    h: site.mean,
  };

  const city = {
    id: id === null ? 'c' + (nextCityId++) : id,
    kind: 'city',
    isCity: true,
    name,
    body,
    parent: body,
    dir: site.dir,
    plan: cityPlan(seed ^ 0x9e3779b9),
    plate: body.plate,
    // Габарит: по нему город берут в прицел и по нему считают, что он
    // уже «под носом». Радиус застройки, а не плиты: плита — это грунт.
    radius: CITY.bound,
    // Радиус поверхности на плите, км от центра тела. Он постоянен —
    // плита ровная, в этом весь её смысл.
    groundR: body.radius * (1 + site.mean),
    pos: v3(),
    // Скорость общая с телом: город никуда от него не денется.
    vel: body.vel,
    basis: makeBasis(),
  };
  updateCity(city);
  return city;
}

const _frame = makeBasis();

/**
 * Поставить город на место: положение и оси в мире.
 *
 * Зовётся каждый кадр (js/game/world.js): тело крутится, и город
 * крутится вместе с ним — в отличие от орбитальных маркеров, которые
 * нарочно стоят на месте.
 */
export function updateCity(city) {
  const f = bodyFrame(city.body, _frame);
  const d = city.dir;
  const up = city.basis.up;
  // Местная вертикаль: направление из центра тела, развёрнутое в мир.
  up.x = f.right.x * d.x + f.up.x * d.y + f.fwd.x * d.z;
  up.y = f.right.y * d.x + f.up.y * d.y + f.fwd.y * d.z;
  up.z = f.right.z * d.x + f.up.z * d.y + f.fwd.z * d.z;
  normalize(up, up);
  city.pos.x = city.body.pos.x + up.x * city.groundR;
  city.pos.y = city.body.pos.y + up.y * city.groundR;
  city.pos.z = city.body.pos.z + up.z * city.groundR;
  // «Север» города — проекция оси вращения тела на местную горизонталь.
  // Привязка к чему-то настоящему нужна, чтобы улицы не разворачивались
  // сами по себе при каждой пересборке мира.
  const k = dot(f.up, up);
  const fwd = city.basis.fwd;
  fwd.x = f.up.x - up.x * k;
  fwd.y = f.up.y - up.y * k;
  fwd.z = f.up.z - up.z * k;
  if (Math.hypot(fwd.x, fwd.y, fwd.z) < 1e-6) {
    // Город на полюсе: ось вращения совпала с вертикалью. Берём любое
    // поперечное направление — улицы всё равно надо куда-то положить.
    fwd.x = f.right.x; fwd.y = f.right.y; fwd.z = f.right.z;
  }
  normalize(fwd, fwd);
  cross(up, fwd, city.basis.right);
  return city;
}

const _local = v3();

/** Точка мира в осях города (километры, y — высота над плитой). */
export function cityLocal(city, pos, out = _local) {
  return toLocal(city.basis, city.pos, pos, out);
}

/**
 * Врезался ли корабль в постройку.
 *
 * Проверяется ЦЕНТР корпуса с запасом в его половину: коробки зданий
 * точные (js/models/city.js), и брать корабль точкой значило бы, что он
 * въезжает в стену наполовину и только потом взрывается.
 *
 * @returns город, в постройку которого врезались, или null
 */
export function cityCrash(world, ship, pad = 0.033) {
  const cities = world.cities;
  if (!cities || !cities.length) return null;
  for (const c of cities) {
    const dx = ship.pos.x - c.pos.x, dy = ship.pos.y - c.pos.y, dz = ship.pos.z - c.pos.z;
    // Грубая отсечка: город целиком помещается в шар радиусом bound.
    if (dx * dx + dy * dy + dz * dz > (c.radius + 1) * (c.radius + 1)) continue;
    cityLocal(c, ship.pos, _local);
    if (cityBlocked(c.plan, _local.x, _local.y, _local.z, pad)) return c;
  }
  return null;
}

/**
 * На какой площадке (и в каком городе) стоит корабль.
 *
 * Нужно после касания: «сел в городе» и «сел в чистом поле» — это
 * разные события, и пилот вправе знать, которое из них случилось.
 */
export function cityPadUnder(world, pos) {
  const cities = world.cities;
  if (!cities || !cities.length) return null;
  for (const c of cities) {
    cityLocal(c, pos, _local);
    const near = nearestPad(c.plan, _local.x, _local.z);
    if (near && near.dist <= near.pad.r) return { city: c, pad: near.pad };
  }
  return null;
}

/** В черте города ли точка (по габариту застройки). */
export function inCity(city, pos) {
  cityLocal(city, pos, _local);
  return Math.hypot(_local.x, _local.z) <= city.radius;
}
