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
export function siteSpan(body, dir, plateKm) {
  const t = terrainOf(body);
  const span = plateKm / body.radius;
  tangents(dir, _u, _v);
  let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  // Два кольца проб, а не одно: город бывает в семьдесят километров, и
  // по одному кольцу по краю кратер посреди плиты остался бы незамечен.
  for (let i = 0; i < 17; i++) {
    let du = 0, dv = 0;
    if (i > 0) {
      const ring = i <= 8 ? 0.55 : 1;
      const a = (((i - 1) % 8) / 8) * Math.PI * 2;
      du = Math.cos(a) * span * ring;
      dv = Math.sin(a) * span * ring;
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
export function citySite(body, seed, plateKm) {
  const rng = makeRng(seed);
  let best = null;
  for (let i = 0; i < 10; i++) {
    const lat = rng.range(-0.9, 0.9);          // синус широты
    const lon = rng.range(0, Math.PI * 2);
    const c = Math.sqrt(Math.max(0, 1 - lat * lat));
    const d = v3(Math.cos(lon) * c, lat, Math.sin(lon) * c);
    const s = siteSpan(body, d, plateKm);
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
export function makeCity(body, id = null, rec = null) {
  const seed = citySeed(body.name + '#' + body.id + '/city');
  const rng = makeRng(seed ^ 0x5bf03635);
  // Имя вытягивается из потока ВСЕГДА, даже когда берётся из записи
  // сервера: следом за ним из того же потока идут гармоники излома
  // плиты, и пропустить имя значило бы получить у сервера и у клиента
  // разный край площадки. Расхождение это не увидеть ни в одном числе —
  // только глазами и только на краю.
  const grown = makeName(rng) + ' City';
  const name = rec ? rec.name : grown;

  // Планировка считается ПЕРВОЙ: от неё зависит размер плиты, а от
  // размера плиты — то, насколько ровное место под неё искать. Город в
  // семьдесят километров и город в четыре ищут себе разные места.
  //
  // Предел размера ставит тело: плита — это срезанный грунт, и плита на
  // пол-луны означала бы срезанную луну. Три с половиной сотых радиуса
  // — это два градуса дуги: с орбиты такое пятно ещё читается как
  // площадка, а не как форма самого тела.
  const plan = cityPlan(
    rec ? rec.seed >>> 0 : (seed ^ 0x9e3779b9) >>> 0,
    Math.min(CITY.rMax, body.radius * 0.035));
  // Место: из записи сервера, если она есть. Хозяин мира — сервер, и
  // спорить с ним клиенту не о чем; сам же рельеф считается одинаково у
  // обоих, поэтому запись содержит только направление и высоту, а не
  // всю площадку.
  const site = rec
    ? { dir: v3(rec.dir.x, rec.dir.y, rec.dir.z), span: 0, mean: rec.groundH }
    : citySite(body, seed, plan.plate);

  // Угловые радиусы плиты и перехода — в косинусах? Нет: в КВАДРАТАХ
  // ХОРДЫ. Рельеф считается миллионы раз за кадр, и арккосинус в этом
  // месте стоил бы дороже самого рельефа, а квадрат расстояния между
  // концами двух единичных векторов монотонен по углу и даётся тремя
  // умножениями.
  const th0 = plan.plate / body.radius;
  const th1 = (plan.plate + CITY.rim) / body.radius;
  // Край плиты ИЗЛОМАН. Идеальный круг ровного грунта в семьдесят
  // километров виден с орбиты как штамп: в природе таких не бывает, и
  // город на нём выглядит поставленным на блюдце. Излом — три гармоники
  // по углу вокруг местной вертикали; считается он тремя умножениями и
  // повторён слово в слово в шейдере (js/gl/detail.js, dPlate).
  const amp = [
    rng.range(0.30, 0.50) * CITY.wobble,
    rng.range(0.25, 0.45) * CITY.wobble,
    rng.range(0.15, 0.35) * CITY.wobble,
  ];
  const ph = [rng.range(0, Math.PI * 2), rng.range(0, Math.PI * 2), rng.range(0, Math.PI * 2)];
  const sum = amp[0] + amp[1] + amp[2];
  tangents(site.dir, _u, _v);
  body.plate = {
    x: site.dir.x, y: site.dir.y, z: site.dir.z,
    d0: 2 - 2 * Math.cos(th0),
    d1: 2 - 2 * Math.cos(th1),
    // Самый дальний край излома: по нему идёт быстрая отсечка, и без
    // неё пришлось бы считать гармоники для каждой точки планеты.
    dMax: (2 - 2 * Math.cos(th1)) * (1 + sum) * (1 + sum),
    h: site.mean,
    ax: _u.x, ay: _u.y, az: _u.z,
    bx: _v.x, by: _v.y, bz: _v.z,
    k1c: amp[0] * Math.cos(ph[0]), k1s: amp[0] * Math.sin(ph[0]),
    k2c: amp[1] * Math.cos(ph[1]), k2s: amp[1] * Math.sin(ph[1]),
    k3c: amp[2] * Math.cos(ph[2]), k3s: amp[2] * Math.sin(ph[2]),
    // Бетон кладётся не на всю плиту: серый круг в семьдесят
    // километров — это уже не город, а котлован. Тонируется ядро, а к
    // краю остаётся только выровненный грунт.
    t0: (2 - 2 * Math.cos(th0)) * 0.10,
    t1: (2 - 2 * Math.cos(th0)) * 0.55,
  };

  const city = {
    id: id === null ? 'c' + (nextCityId++) : id,
    kind: 'city',
    isCity: true,
    name,
    body,
    parent: body,
    dir: site.dir,
    plan,
    // Схема расселения: её показывает карточка цели, и по ней сразу
    // видно, что города разные.
    layout: plan.kind,
    plate: body.plate,
    // Габарит: по нему город берут в прицел и по нему считают, что он
    // уже «под носом». Радиус застройки, а не плиты: плита — это грунт.
    radius: plan.radius,
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

/**
 * Запись города для сервера: всё, из чего он собирается заново.
 *
 * Планировка НЕ ВЫГРУЖАЕТСЯ. Пять тысяч построек — это мегабайты на
 * город, и они ни о чём не говорят: из семени те же пять тысяч
 * собираются за миллисекунду и побайтово одинаково. В базе лежит то,
 * чего из семени не вывести, — какое тело выбрано, как город назван и
 * где именно на теле стоит.
 */
export function cityRecord(city) {
  return {
    localId: city.id,
    bodyLocalId: city.body.id,
    name: city.name,
    seed: city.plan.seed,
    layout: city.plan.kind,
    radiusKm: city.radius,
    pads: city.plan.pads.length,
    dir: { x: city.dir.x, y: city.dir.y, z: city.dir.z },
    groundH: city.plate.h,
  };
}

/**
 * Заменить города системы на присланные сервером.
 *
 * Зовётся при входе в систему, когда игра в сети. Сервер — хозяин мира:
 * если он говорит, что город стоит на другом теле или зовётся иначе,
 * прав он, а не клиент. Офлайн список пуст, и остаётся то, что клиент
 * собрал сам, — одинаково у всех, потому что генератор один.
 *
 * @returns сколько городов встало
 */
export function applyCities(world, rows) {
  if (!Array.isArray(rows)) return 0;
  const byId = new Map();
  for (const p of world.planets) {
    byId.set(p.id, p);
    for (const m of p.moons) byId.set(m.id, m);
  }
  for (const b of byId.values()) b.city = null;
  world.cities.length = 0;
  for (const r of rows) {
    const body = byId.get(r.bodyLocalId);
    if (!body || !canHostCity(body)) continue;
    body.city = makeCity(body, r.localId, r);
    world.cities.push(body.city);
  }
  return world.cities.length;
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

/**
 * Насколько грунт уходит вниз от касательной плоскости города, км.
 *
 * ГОРОД — ЖЁСТКОЕ ТЕЛО, А ПЛИТА — КУСОК СФЕРЫ, и на больших городах это
 * расходится по-настоящему. Оси города — касательная плоскость в его
 * середине; плита же выровнена по ПОСТОЯННОМУ РАДИУСУ, то есть загибается
 * вниз. На четырёх километрах разница была меньше метра, и её никто не
 * замечал; на восемнадцати это шестьдесят четыре метра, на тридцати пяти —
 * двести тридцать. Дома на окраине висели бы в воздухе, а корабль садился
 * бы сквозь их фундаменты.
 *
 * Возвращается ОТРИЦАТЕЛЬНОЕ число: грунт ниже плоскости. Им опускается
 * геометрия при сборке (js/gl/citymesh.js) и им же поправляется высота в
 * cityLocal — тогда вся остальная арифметика города, от столкновений до
 * площадок, остаётся плоской и не знает про кривизну вовсе.
 */
export function cityDrop(city, x, z) {
  const r = city.groundR;
  const d2 = x * x + z * z;
  if (d2 <= 0) return 0;
  return Math.sqrt(Math.max(0, r * r - d2)) - r;
}

const _local = v3();

/** Точка мира в осях города (километры, y — высота НАД ГРУНТОМ). */
export function cityLocal(city, pos, out = _local) {
  toLocal(city.basis, city.pos, pos, out);
  out.y -= cityDrop(city, out.x, out.z);
  return out;
}

/** Обратное к cityLocal: точка осей города в мире. */
export function cityWorld(city, x, y, z, out = v3()) {
  const b = city.basis;
  const h = y + cityDrop(city, x, z);
  out.x = city.pos.x + b.right.x * x + b.up.x * h + b.fwd.x * z;
  out.y = city.pos.y + b.right.y * x + b.up.y * h + b.fwd.y * z;
  out.z = city.pos.z + b.right.z * x + b.up.z * h + b.fwd.z * z;
  return out;
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
