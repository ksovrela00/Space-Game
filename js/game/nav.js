// Навигация: список целей, выбор цели наведением, дистанции и ETA.
//
// Автопилота здесь больше нет: перелёты делает квантовый привод
// (js/game/quantum.js), и «долететь самому на маршевых» больше не
// сценарий, а способ потратить час.
//
// Цель выбирается НАВЕДЕНИЕМ: что под прицелом, то и берут (pickTarget).
// Перебора списка по Tab больше нет — в системе два десятка целей, и
// щёлкать через полсистемы до нужной было худшим способом выбрать то,
// что и так видно на экране.
//
// Список всё равно нужен: по нему приборы рисуют метки всех целей, и по
// нему же идёт поиск того, на что наведён нос. Собирается он заново
// каждый кадр, потому что орбитальные маркеры показываются только у
// того тела, рядом с которым корабль сейчас находится.

import { v3, normalize, dot, clamp } from '../core/vec3.js';
import { nearestBody } from './world.js';

export function makeNav(world) {
  const nav = { list: [], index: 0 };
  refreshNav(nav, world, null);
  const home = world.home && world.home.station ? nav.list.indexOf(world.home.station) : 0;
  nav.index = Math.max(0, home);
  return nav;
}

/**
 * Пересобрать список целей.
 * @param ship нужен, чтобы понять, чьи маркеры показывать (null — ничьи)
 */
export function refreshNav(nav, world, ship) {
  const prev = nav.list[nav.index] || null;
  const local = ship ? nearestBody(world, ship.pos).body : null;
  nav.list.length = 0;
  for (const b of world.bodies) {
    nav.list.push(b);
    if (b === local && b.markers) for (const m of b.markers) nav.list.push(m);
    if (b.station) nav.list.push(b.station);
  }
  let i = nav.list.indexOf(prev);
  // Цель могла выпасть из списка: улетели от планеты, и её маркеры
  // скрылись. Тогда держимся за само тело, а не сбрасываем выбор.
  if (i < 0 && prev && prev.isMarker) i = nav.list.indexOf(prev.body);
  if (i < 0) i = Math.min(nav.index, nav.list.length - 1);
  nav.index = Math.max(0, i);
  return nav.list;
}

export const currentTarget = (nav) => nav.list[nav.index] || null;

// Допуск наведения: на столько нос может не дотянуть до объекта, чтобы
// тот всё равно считался выбранным. Двенадцать градусов — это заметно
// больше дрожания руки и заметно меньше расстояния между соседними
// целями в небе.
export const AIM_CONE = 12 * Math.PI / 180;

const _aim = [];

/**
 * Что сейчас под прицелом, по порядку: ближайшее к линии носа — первым.
 *
 * Мерой служит не угол до ЦЕНТРА объекта, а зазор до его КРАЯ
 * (угол минус угловой радиус). Разница принципиальная: планета во
 * полнеба выбирается, пока прицел стоит на ней хоть где-нибудь, а не
 * только когда наведён точно в центр. У станций и орбитальных маркеров
 * радиус мал или нулевой, и для них мера вырождается в обычный угол.
 *
 * @param cone допуск, рад
 */
export function aimTargets(nav, ship, cone = AIM_CONE, out = _aim) {
  out.length = 0;
  const f = ship.basis.fwd;
  for (const t of nav.list) {
    const dx = t.pos.x - ship.pos.x;
    const dy = t.pos.y - ship.pos.y;
    const dz = t.pos.z - ship.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) continue;
    const ang = Math.acos(clamp((dx * f.x + dy * f.y + dz * f.z) / dist, -1, 1));
    // Угловой радиус: под каким углом видно сам объект. Именно арксинус,
    // а не арктангенс: у шара край — это точка КАСАНИЯ луча зрения, и
    // вблизи разница велика (на двух радиусах 30° против 26.6°). С
    // арктангенсом прицел, стоящий на видимом краю планеты, её бы не
    // выбирал.
    const r = t.radius || 0;
    const angR = r >= dist ? Math.PI / 2 : Math.asin(r / dist);
    const gap = ang - angR;
    if (gap > cone) continue;
    out.push({ t, gap, ang, dist });
  }
  // Ближе к прицелу — раньше; при равном зазоре раньше тот, кто ближе.
  out.sort((a, b) => a.gap - b.gap || a.dist - b.dist);
  return out;
}

/** Первое, что под прицелом, — его же подсвечивают приборы. */
export function aimedTarget(nav, ship, cone = AIM_CONE) {
  const l = aimTargets(nav, ship, cone);
  return l.length ? l[0].t : null;
}

/**
 * Выбрать то, на что наведён нос.
 *
 * Под прицелом нередко оказывается несколько объектов сразу: планета и
 * её станция, тело и его орбитальные маркеры. Повторное нажатие
 * перебирает ИХ — но только их, а не весь список системы: тем перебор и
 * был плох, что до нужной цели приходилось щёлкать через полсистемы.
 *
 * @returns выбранная цель или null, если нос не наведён ни на что
 */
export function pickTarget(nav, ship, cone = AIM_CONE) {
  const list = aimTargets(nav, ship, cone);
  if (!list.length) return null;
  const cur = currentTarget(nav);
  let pick = list[0].t;
  if (pick === cur && list.length > 1) pick = list[1].t;
  const i = nav.list.indexOf(pick);
  if (i >= 0) nav.index = i;
  return pick;
}

/** Найти цель по идентификатору — для восстановления из сохранения. */
export function targetById(world, id) {
  if (id === null || id === undefined) return null;
  for (const b of world.bodies) if (b.id === id) return b;
  for (const s of world.stations) if (s.id === id) return s;
  for (const m of world.markers) if (m.id === id) return m;
  return null;
}

export function targetLabel(t) {
  if (!t) return '—';
  if (t.isStation) return t.name;
  if (t.isMarker) return t.name;
  if (t.kind === 'star') return t.name + ' (звезда)';
  if (t.kind === 'moon') return t.name + ' (луна)';
  return t.name;
}

// Дистанция до поверхности/габарита цели и оценка времени подлёта.
export function navInfo(ship, target) {
  if (!target) return null;
  const dx = target.pos.x - ship.pos.x;
  const dy = target.pos.y - ship.pos.y;
  const dz = target.pos.z - ship.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  const gap = Math.max(0, dist - target.radius);
  const dir = normalize(v3(dx, dy, dz));
  // Сближение считается по ВЕКТОРУ скорости: с инерцией корабль может
  // лететь не туда, куда смотрит нос, и проекция на нос врала бы.
  const closing = ship.vel.x * dir.x + ship.vel.y * dir.y + ship.vel.z * dir.z;
  const eta = closing > 0.001 ? gap / closing : Infinity;
  return { dist, gap, dir, closing, eta, offAxis: Math.acos(clamp(dot(dir, ship.basis.fwd), -1, 1)) };
}
