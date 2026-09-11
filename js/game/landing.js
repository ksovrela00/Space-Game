// Посадка на безатмосферное тело: шасси, посадочный режим, посадочный
// компьютер и стоянка на поверхности.
//
// Главная особенность — модель полёта. В обычном режиме корабль летит
// туда, куда смотрит нос (аркадная схема, как в Elite), и сесть брюхом
// вниз в ней нельзя: чтобы опускаться, пришлось бы смотреть в землю.
// Поэтому у самой поверхности включается ПОСАДОЧНЫЙ РЕЖИМ: перемещение
// задаётся вектором посадочных движков (ship.vtol), а нос и «верх»
// корабля от направления движения больше не зависят.
//
// Гравитации в модели нет: нулевая команда движков означает зависание.
// Это честнее, чем изображать притяжение, которого нигде больше в
// расчётах полёта не существует.

import { v3, normalize, dot, clamp, approach } from '../core/vec3.js';
import { SHIP } from './ship.js';
import { alignBasis, aimAt, levelRoll, horizontal } from './pilot.js';
import { LEVELS } from './cruise.js';
import {
  isLandable, isSolid, altitudeOf, surfaceNormal, worldPoint, surfaceVelocity,
  dirToWorldBody, groundRadius, findSite, bodyFrame, latLon,
} from './surface.js';

export const LAND = {
  vspeed: 0.030,    // км/с — предельная вертикальная скорость касания (30 м/с)
  hspeed: 0.025,    // км/с — предельная боковая скорость (25 м/с)
  tilt: 0.94,       // косинус угла между «верхом» корабля и нормалью площадки
  slope: 0.35,      // рад — предельный уклон площадки (20°)
  vtolAlt: 6,       // км — ниже этой высоты работает посадочный режим
  range: 3,         // в радиусах тела: дальше посадочный компьютер не берётся
  hold: 2.5,        // км — высота, на которую компьютер выводит перед спуском
};

// Рабочие векторы модуля: в шаге физики их трогают каждый кадр, поэтому
// они заведены один раз.
const _h = v3();
const _want = v3();
const _target = v3();
const _up = v3();
const _nLocal = v3();
const _nWorld = v3();
const _fwd = v3();
const _surf = v3();
const _alt = { dir: v3() };

const fmtKm = (km) => (Math.abs(km) < 1 ? (km * 1000).toFixed(0) + ' м' : km.toFixed(1) + ' км');

// --- Шасси -------------------------------------------------------------------

export function toggleGear(ship) {
  ship.gear.out = !ship.gear.out;
  return ship.gear.out;
}

export function updateGear(ship, dt) {
  const g = ship.gear;
  const target = g.out ? 1 : 0;
  const step = dt / SHIP.gearTime;
  g.t = target > g.t ? Math.min(target, g.t + step) : Math.max(target, g.t - step);
  return g.t;
}

export const gearReady = (ship) => ship.gear.out && ship.gear.t > 0.995;

export const gearLabel = (ship) => {
  const g = ship.gear;
  if (g.out && g.t >= 0.995) return 'ШАССИ ВЫПУЩЕНО';
  if (g.out) return 'ВЫПУСК ШАССИ…';
  if (g.t > 0.005) return 'УБОРКА ШАССИ…';
  return 'ШАССИ УБРАНО';
};

// --- Обстановка у поверхности ------------------------------------------------

export function nearestSurfaceBody(world, pos) {
  let best = null, bestGap = Infinity;
  for (const b of world.bodies) {
    if (!isSolid(b)) continue;
    const gap = Math.hypot(pos.x - b.pos.x, pos.y - b.pos.y, pos.z - b.pos.z) - b.radius;
    if (gap < bestGap) { bestGap = gap; best = b; }
  }
  return best ? { body: best, gap: bestGap } : null;
}

const _zone = {
  dir: v3(), upWorld: v3(), nLocal: v3(), normalWorld: v3(),
  surfVel: v3(), relVel: v3(),
};

/**
 * Всё, что нужно знать о поверхности под кораблём: высота, местная
 * вертикаль, нормаль площадки, её уклон и скорость грунта. Возвращает
 * null, если рядом нет тела с твёрдой поверхностью.
 *
 * Считается для ЛЮБОГО тела с рельефом, не только для пригодного к
 * посадке: по этой высоте проверяется столкновение. Проверять её сферой
 * нельзя — корабль либо влетал бы в нарисованные горы без последствий,
 * либо разбивался, летя по дну кратера.
 */
export function landingContext(world, ship, out = _zone) {
  const near = nearestSurfaceBody(world, ship.pos);
  if (!near) return null;
  const b = near.body;
  // Грубая отсечка по сфере: считать рельеф для далёкого тела незачем.
  if (near.gap > b.radius * LAND.range) return null;

  altitudeOf(b, ship.pos, out);
  out.body = b;
  dirToWorldBody(b, out.dir, out.upWorld);
  // Шаг нормали — порядка размера корабля: мельче он всё равно не
  // «чувствует», а шум в нормали мешал бы выравниванию.
  surfaceNormal(b, out.dir, out.nLocal, 0.06);
  dirToWorldBody(b, out.nLocal, out.normalWorld);
  out.slope = Math.acos(clamp(dot(out.nLocal, out.dir), -1, 1));
  // Скорость грунта и скорость корабля ОТНОСИТЕЛЬНО грунта: все
  // посадочные условия проверяются по второй.
  surfaceVelocity(b, ship.pos, out.surfVel);
  out.relVel.x = ship.vel.x - out.surfVel.x;
  out.relVel.y = ship.vel.y - out.surfVel.y;
  out.relVel.z = ship.vel.z - out.surfVel.z;
  return out;
}

/** Показания посадочного дисплея. */
export function landingReadout(ship, zone) {
  const vUp = dot(zone.relVel, zone.upWorld);
  horizontal(zone.relVel, zone.upWorld, _h);
  const hSpeed = Math.hypot(_h.x, _h.y, _h.z);
  const tilt = dot(ship.basis.up, zone.normalWorld);
  return {
    body: zone.body,
    alt: zone.alt,
    vspeed: vUp,
    hspeed: hSpeed,
    tilt,
    slope: zone.slope,
    gear: ship.gear.t,
    gearOk: gearReady(ship),
    vspeedOk: -vUp <= LAND.vspeed,
    hspeedOk: hSpeed <= LAND.hspeed,
    tiltOk: tilt >= LAND.tilt,
    slopeOk: zone.slope <= LAND.slope,
  };
}

// --- Посадочный режим --------------------------------------------------------

/**
 * Включить или выключить посадочный режим. Условие одно: выпущенное
 * шасси у самой поверхности. Тем же порогом пользуется посадочный
 * компьютер, поэтому он и режим движения всегда согласованы.
 */
export function syncVtol(ship, zone) {
  const want = !!zone && isLandable(zone.body) &&
    ship.gear.t > 0.02 && zone.alt < LAND.vtolAlt && !ship.landedAt;
  if (want && !ship.vtol) {
    // Входим в режим с текущей скоростью — иначе корабль дёрнулся бы.
    ship.vtol = v3(ship.vel.x, ship.vel.y, ship.vel.z);
  } else if (!want && ship.vtol) {
    // Выходим: остаётся то, что летит вдоль носа.
    ship.speed = Math.max(0, dot(ship.vtol, ship.basis.fwd));
    ship.throttle = clamp(ship.speed / (SHIP.maxSpeed * SHIP.gearSpeed), 0, 1);
    ship.vtol = null;
  }
  return !!ship.vtol;
}

/** Плавно подвести вектор посадочных движков к заданному. */
function driveVtol(ship, want, dt, sharp = SHIP.vtolSharp) {
  const v = ship.vtol;
  v.x = approach(v.x, want.x, sharp, dt);
  v.y = approach(v.y, want.y, sharp, dt);
  v.z = approach(v.z, want.z, sharp, dt);
  return v;
}

/**
 * Ручное управление в посадочном режиме: тяга — горизонтальный ход по
 * направлению носа, Shift/Ctrl — вверх и вниз. Всё это ОТНОСИТЕЛЬНО
 * грунта, поэтому при нулевых командах корабль висит над одной и той же
 * точкой поверхности, а не над одной и той же точкой пространства.
 */
export function manualHover(ship, zone, dt) {
  const up = zone.upWorld;
  normalize(horizontal(ship.basis.fwd, up, _h), _h);
  const fwdSp = SHIP.hoverSpeed * ship.throttle;
  const vertSp = SHIP.vtolRate * ship.control.lift;
  _want.x = zone.surfVel.x + _h.x * fwdSp + up.x * vertSp;
  _want.y = zone.surfVel.y + _h.y * fwdSp + up.y * vertSp;
  _want.z = zone.surfVel.z + _h.z * fwdSp + up.z * vertSp;
  driveVtol(ship, _want, dt);
}

// --- Посадочный компьютер ----------------------------------------------------

export function startLanding(ship, body, pos) {
  if (!isLandable(body)) {
    return { ok: false, reason: 'СЕСТЬ МОЖНО ТОЛЬКО НА ТЕЛО БЕЗ АТМОСФЕРЫ' };
  }
  const d = Math.hypot(pos.x - body.pos.x, pos.y - body.pos.y, pos.z - body.pos.z);
  if (d - body.radius > body.radius * LAND.range) {
    return { ok: false, reason: 'ТЕЛО СЛИШКОМ ДАЛЕКО — СНАЧАЛА АВТОПИЛОТ (J)' };
  }
  // Площадка выбирается не сейчас, а на малой высоте: пока корабль
  // снижается, поверхность успевает уехать из-под него на десятки
  // километров, и выбранная заранее точка теряет смысл.
  ship.landing = {
    body,
    site: null,
    siteR: 0,
    slope: 0,
    searchSpan: 0,
    tries: 0,
    phase: 'подход',
    wantCruise: null,
  };
  ship.autopilot = null;
  ship.docking = null;
  ship.gear.out = true;            // компьютер выпускает шасси сам
  return { ok: true };
}

export function stopLanding(ship) { ship.landing = null; }

/**
 * Ведёт корабль на площадку. Пишет в ship.control / ship.throttle /
 * ship.vtol и выбирает уровень круиза (ship.landing.wantCruise).
 * @returns строка статуса для HUD
 */
export function updateLandingComputer(ship, dt, cruiseLevel = 1) {
  const L = ship.landing;
  if (!L) return null;
  const b = L.body;
  L.wantCruise = null;
  const alt = altitudeOf(b, ship.pos, _alt);

  // Пока посадочный режим не включился (высоко), идём обычным полётом
  // ВЕРТИКАЛЬНО ВНИЗ — к точке прямо под собой. Целиться в конкретную
  // площадку здесь нельзя: поверхность движется, и задача превращается в
  // погоню за целью, которая не медленнее преследователя.
  // Порог перехода тот же, что у syncVtol, поэтому фаза и способ
  // движения никогда не расходятся.
  if (!ship.vtol) {
    L.phase = 'подход';
    worldPoint(b, alt.dir, alt.groundR + LAND.hold, _target);
    const dist = Math.hypot(
      _target.x - ship.pos.x, _target.y - ship.pos.y, _target.z - ship.pos.z);
    const off = aimAt(ship, _target);
    levelRoll(ship);

    // Шасси на подходе убрано: с ним скорость втрое ниже, а спуск с
    // орбиты и так самая долгая часть. Выпускается ниже (см. ниже).
    ship.gear.out = alt.alt < LAND.vtolAlt * 2;
    const vMax = SHIP.maxSpeed * (ship.gear.t > 0.02 ? SHIP.gearSpeed : 1);

    // Экспоненциальный подход, как у автопилота: чем ближе, тем медленнее.
    let vEff = clamp(dist / 8, 0.01, 60000);
    if (off > 0.35) vEff = Math.min(vEff, vMax);
    let idx = LEVELS.length - 1;
    for (let i = 0; i < LEVELS.length; i++) {
      if (vMax * LEVELS[i] >= vEff) { idx = i; break; }
    }
    L.wantCruise = idx;
    // Тягу считаем по уровню круиза, который РЕАЛЬНО действует: рядом с
    // телом mass lock урезает его до x10, и тяга, рассчитанная на x1000,
    // давала спуск в шесть раз медленнее возможного.
    ship.throttle = clamp(vEff / (vMax * Math.min(cruiseLevel, LEVELS[idx])), 0, 1);
    return `ПОСАДКА: ПОДХОД, высота ${fmtKm(alt.alt)}, до площадки ${fmtKm(dist)}`;
  }

  // --- Спуск на посадочных движках.
  L.wantCruise = 0;
  dirToWorldBody(b, alt.dir, _up);                 // местная вертикаль

  // Площадка выбирается здесь, под собой, с оглядкой на уклон: садиться
  // строго в точку под кораблём нельзя — можно попасть на склон
  // кратерного вала и опрокинуться. Радиус поиска небольшой: до площадки
  // придётся ползти на посадочных движках, а это 90 м/с.
  // Если под нами всё круто, поиск повторяется с вдвое большим радиусом,
  // но не бесконечно: иначе корабль бегал бы по всей луне.
  if (!L.site || (L.slope > LAND.slope && L.tries < 4)) {
    if (L.site) L.tries++;
    L.searchSpan = L.site ? L.searchSpan * 2 : Math.max(0.6, b.radius * 0.0006);
    const site = findSite(b, alt.dir, L.searchSpan);
    L.site = v3(site.dir.x, site.dir.y, site.dir.z);
    L.siteR = groundRadius(b, site.dir);
    L.slope = site.slope;
    L.moved = site.moved;
  }

  // Боковое смещение от площадки в мировых осях.
  worldPoint(b, L.site, L.siteR, _target);
  let sx = _target.x - ship.pos.x, sy = _target.y - ship.pos.y, sz = _target.z - ship.pos.z;
  const along = sx * _up.x + sy * _up.y + sz * _up.z;
  sx -= _up.x * along; sy -= _up.y * along; sz -= _up.z * along;
  const lateral = Math.hypot(sx, sy, sz);

  // Брюхо — по нормали грунта ПОД КОРАБЛЁМ (не под площадкой): именно
  // по ней проверяется касание, и на неровной поверхности нормали в
  // соседних точках заметно расходятся.
  surfaceNormal(b, alt.dir, _nLocal, 0.06);
  dirToWorldBody(b, _nLocal, _nWorld);
  normalize(horizontal(ship.basis.fwd, _nWorld, _fwd), _fwd);
  const attErr = alignBasis(ship, _fwd, _nWorld, 1.5);

  // Спускаемся, только выйдя точно на ось площадки и выровнявшись.
  // Допуск по сносу здесь жёсткий: на скорости бокового хода по склону
  // корабль «догоняет» поднимающийся грунт, и спуск встаёт.
  const ready = lateral < 0.05 && attErr < 0.08;
  let rate = clamp(alt.alt * 0.22, 0.004, 0.45);
  if (alt.alt < 0.20) rate = Math.min(rate, 0.010);      // подтормаживание
  if (alt.alt < 0.05) rate = Math.min(rate, 0.005);      // касание
  // Не готовы — висим на месте и доводим снос. Возвращаться на высоту
  // ожидания нельзя: получается цикл «спуск — подъём — спуск».
  let vert = 0;
  if (ready) vert = -rate;
  else if (alt.alt < 0.08) vert = 0.004;                 // чуть отойти от грунта

  // Команда — поверх скорости грунта: садимся на движущуюся поверхность.
  const sv = surfaceVelocity(b, ship.pos, _surf);
  _want.x = sv.x + clamp(sx * 0.25, -SHIP.hoverSpeed, SHIP.hoverSpeed) + _up.x * vert;
  _want.y = sv.y + clamp(sy * 0.25, -SHIP.hoverSpeed, SHIP.hoverSpeed) + _up.y * vert;
  _want.z = sv.z + clamp(sz * 0.25, -SHIP.hoverSpeed, SHIP.hoverSpeed) + _up.z * vert;
  driveVtol(ship, _want, dt, 3.0);

  L.phase = ready ? 'спуск' : 'выравнивание';
  return ready
    ? `ПОСАДКА: СПУСК, высота ${fmtKm(alt.alt)}, вертикальная ${(-vert * 1000).toFixed(0)} м/с`
    : `ПОСАДКА: ВЫРАВНИВАНИЕ, снос ${fmtKm(lateral)}, рассогласование ${(attErr * 57.3).toFixed(0)}°`;
}

// --- Касание ------------------------------------------------------------------

/**
 * Проверка контакта с поверхностью.
 * @returns null | {result: 'landed'} | {result: 'crash', reason}
 */
export function checkTouchdown(ship, zone) {
  if (ship.landedAt) return null;
  if (zone.alt > SHIP.gearClear) return null;

  // На планету с атмосферой сесть нельзя — касание её поверхности
  // означает удар, каким бы мягким он ни был.
  if (!isLandable(zone.body)) {
    return { result: 'crash', reason: 'Столкновение с поверхностью ' + zone.body.name + '.' };
  }

  // Скорости — относительно грунта: он сам движется со скоростью до
  // сотен метров в секунду.
  const vUp = dot(zone.relVel, zone.upWorld);
  horizontal(zone.relVel, zone.upWorld, _h);
  const hSpeed = Math.hypot(_h.x, _h.y, _h.z);
  const tilt = dot(ship.basis.up, zone.normalWorld);

  if (!gearReady(ship)) {
    return { result: 'crash', reason: 'Касание поверхности без выпущенного шасси.' };
  }
  if (-vUp > LAND.vspeed) {
    return {
      result: 'crash',
      reason: `Вертикальная скорость при касании ${(-vUp * 1000).toFixed(0)} м/с ` +
        `(предел ${(LAND.vspeed * 1000).toFixed(0)} м/с).`,
    };
  }
  if (hSpeed > LAND.hspeed) {
    return {
      result: 'crash',
      reason: `Боковая скорость при касании ${(hSpeed * 1000).toFixed(0)} м/с ` +
        `(предел ${(LAND.hspeed * 1000).toFixed(0)} м/с).`,
    };
  }
  if (tilt < LAND.tilt) {
    return { result: 'crash', reason: 'Корабль не выровнен по площадке — опрокидывание.' };
  }
  if (zone.slope > LAND.slope) {
    return {
      result: 'crash',
      reason: `Уклон площадки ${(zone.slope * 57.3).toFixed(0)}° — шасси не держит.`,
    };
  }
  return { result: 'landed' };
}

/**
 * Поставить корабль на грунт. Поза запоминается в ЛОКАЛЬНЫХ осях тела,
 * поэтому дальше корабль стоит вместе с вращающейся поверхностью.
 */
export function settle(ship, zone) {
  const b = zone.body;
  const f = bodyFrame(b);
  const loc = (v) => v3(dot(v, f.right), dot(v, f.up), dot(v, f.fwd));
  ship.landedAt = b;
  ship.landedPose = {
    dir: v3(zone.dir.x, zone.dir.y, zone.dir.z),
    radius: zone.groundR + SHIP.gearClear,
    right: loc(ship.basis.right),
    up: loc(ship.basis.up),
    fwd: loc(ship.basis.fwd),
  };
  ship.vtol = null;
  ship.landing = null;
  ship.speed = 0;
  ship.throttle = 0;
  ship.rot.pitch = ship.rot.yaw = ship.rot.roll = 0;
  updateLandedPose(ship);
  return ship.landedPose;
}

/** Держать корабль на месте на вращающейся поверхности. */
export function updateLandedPose(ship) {
  const b = ship.landedAt;
  const p = ship.landedPose;
  if (!b || !p) return;
  worldPoint(b, p.dir, p.radius, ship.pos);
  dirToWorldBody(b, p.right, ship.basis.right);
  dirToWorldBody(b, p.up, ship.basis.up);
  dirToWorldBody(b, p.fwd, ship.basis.fwd);
  // Скорость — это скорость самой площадки: с неё и начнётся взлёт.
  surfaceVelocity(b, ship.pos, ship.vel);
  ship.speed = 0;
}

/** Взлёт с поверхности: отрыв вертикально вверх на посадочных движках. */
export function takeoff(ship) {
  const b = ship.landedAt;
  const p = ship.landedPose;
  if (!b || !p) return false;
  dirToWorldBody(b, p.dir, _up);
  const sv = surfaceVelocity(b, ship.pos, _surf);
  ship.landedAt = null;
  ship.landedPose = null;
  ship.gear.out = true;            // шасси убирает пилот, когда сочтёт нужным
  ship.throttle = 0;
  ship.rot.pitch = ship.rot.yaw = ship.rot.roll = 0;
  ship.vtol = v3(
    sv.x + _up.x * SHIP.vtolRate * 0.5,
    sv.y + _up.y * SHIP.vtolRate * 0.5,
    sv.z + _up.z * SHIP.vtolRate * 0.5);
  return true;
}

/** Координаты стоянки — для экрана после посадки. */
export function landedInfo(ship) {
  const p = ship.landedPose;
  if (!p || !ship.landedAt) return null;
  const { lat, lon } = latLon(p.dir);
  return {
    body: ship.landedAt,
    lat,
    lon,
    height: p.radius - SHIP.gearClear - ship.landedAt.radius,
  };
}
