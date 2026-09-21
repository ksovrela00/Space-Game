// Посадка на безатмосферное тело: шасси, посадочный компьютер и стоянка
// на поверхности.
//
// Отдельного «посадочного режима» здесь нет. Корабль всегда летит одним
// и тем же способом: тяга — вдоль носа, R/F — вверх и вниз подъёмными
// движками. Поэтому с выпущенным шасси можно и снижаться брюхом вниз, и
// продолжать лететь вперёд, и то и другое одновременно.
//
// Гравитация настоящая (js/game/gravity.js): с выпущенным шасси
// компенсатор высоты выключается, и корабль проседает тем быстрее, чем
// тяжелее тело. Держать высоту приходится движками — в этом и состоит
// посадка.
//
// Скорости здесь считаются ОТНОСИТЕЛЬНО ГРУНТА, но грунт у поверхности
// уже неподвижен: перенос системы отсчёта компенсирует и орбитальное
// движение тела, и его вращение (см. gravity.js).

import { v3, normalize, dot, clamp } from '../core/vec3.js';
import { SHIP } from './ship.js';
import { alignBasis, aimAt, levelRoll, horizontal } from './pilot.js';
import {
  isLandable, isSolid, altitudeOf, surfaceNormal, worldPoint,
  dirToWorldBody, groundRadius, findSite, bodyFrame, latLon,
} from './surface.js';
import { groundDrift, gravityAt } from './gravity.js';

export const LAND = {
  vspeed: 0.030,    // км/с — предельная вертикальная скорость касания (30 м/с)
  hspeed: 0.025,    // км/с — предельная боковая скорость (25 м/с)
  tilt: 0.94,       // косинус угла между «верхом» корабля и нормалью площадки
  slope: 0.35,      // рад — предельный уклон площадки (20°)
  landAlt: 6,       // км — ниже этой высоты компьютер переходит к спуску
  range: 3,         // в радиусах тела: дальше посадочный компьютер не берётся
  hold: 2.5,        // км — высота, на которую компьютер выводит перед спуском
  // --- Удар о грунт.
  // Урон растёт как КВАДРАТ скорости: это энергия, и так оно и есть на
  // самом деле. Ниже hitSoft удар безвреден — на то и амортизаторы; на
  // hitKill корпус кончается за один раз. Между ними вся шкала, и
  // полоса корпуса наконец что-то значит.
  // Шкала урона начинается ровно там, где кончается допуск на касание:
  // сел в допуске — цел, чуть быстрее — первые проценты, и дальше по
  // квадрату. Иначе на границе была бы ступенька в десяток процентов.
  hitSoft: 0.030,   // км/с — совпадает с vspeed
  hitKill: 0.090,   // км/с — 90 м/с разносят корабль целиком
  bareSoft: 0.001,  // км/с — без шасси прощается только касание
  bareMul: 4,       // во столько раз больнее брюхом, чем на шасси
  scrapeK: 0.6,     // с каким весом в удар идёт боковая скорость
  restitution: 0.3, // упругость отскока
  friction: 0.55,   // сколько касательной скорости съедает грунт
  settle: 0.004,    // км/с — ниже этого корабль считается остановившимся
  belly: 5,         // % корпуса за посадку на брюхо, без шасси — и он же
                    // нижняя граница урона для любого касания без шасси
  tumble: 9,        // рад/с на км/с касательной — сила кувырка от удара
  closeSpeed: 0.09, // км/с — предел скорости, с которой доводится снос
  // Снос доводится тягой вдоль носа, а разворот идёт с конечной угловой
  // скоростью: радиус разворота v/ω. Чтобы не кружить вокруг площадки,
  // скорость подхода держим такой, чтобы этот радиус был вчетверо
  // меньше оставшегося сноса — отсюда и коэффициент (ω ≈ 0.55 рад/с).
  closeGain: 0.12,  // км/с на километр сноса
  descent: 0.05,    // км/с — быстрее компьютер не снижается
  brakeMargin: 0.6, // какую долю предельной скорости торможения берём
  liftoff: 0.03,    // км/с — импульс отрыва при взлёте
  // Обратная связь по вертикальной скорости, 1/с: ошибка в 5 м/с даёт
  // поправку около 6 м/с² — больше веса на любом теле, где можно сесть.
  liftGain: 1.2,
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
  // посадочные условия проверяются по второй. Грунт здесь — тот, что
  // остался после переноса системы отсчёта: у поверхности он стоит.
  groundDrift(b, ship.pos, out.surfVel);
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

// --- Посадочный компьютер ----------------------------------------------------

export function startLanding(ship, body, pos) {
  if (!isLandable(body)) {
    return { ok: false, reason: 'СЕСТЬ МОЖНО ТОЛЬКО НА ТЕЛО БЕЗ АТМОСФЕРЫ' };
  }
  const d = Math.hypot(pos.x - body.pos.x, pos.y - body.pos.y, pos.z - body.pos.z);
  if (d - body.radius > body.radius * LAND.range) {
    return { ok: false, reason: 'ТЕЛО СЛИШКОМ ДАЛЕКО — СНАЧАЛА ПРЫЖОК (B)' };
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
  };
  ship.autopilot = null;
  ship.docking = null;
  ship.gear.out = true;            // компьютер выпускает шасси сам
  return { ok: true };
}

export function stopLanding(ship) { ship.landing = null; }

/**
 * С какой скоростью можно идти вниз на высоте h, чтобы успеть
 * остановиться подъёмными движками: √(2·a·h) с запасом.
 *
 * a — то, что остаётся от их тяги после веса. Это и есть главное
 * ограничение спуска при настоящем тяготении.
 */
function brakeLimit(body, pos, alt, gearOut = true) {
  const g = gravityAt(body, pos);
  // Тормозить можно двумя разными способами, и это две разные цифры.
  //
  // С ВЫПУЩЕННЫМ шасси корабль в посадочной конфигурации: маршевые
  // движки работают только по горизонту, вертикаль держат подъёмные, а
  // их тяга привязана к местной тяжести. На лёгкой луне она мала, и
  // снижаться приходится медленно — это и есть посадка.
  //
  // С УБРАННЫМ шасси работает компенсатор высоты, а маршевые движки
  // тянут в любую сторону: запас торможения SHIP.brake, вдвое с лишним
  // больше, и от тела он не зависит.
  //
  // Поэтому спуск считается в два колена: до высоты выпуска шасси
  // тормозим маршевыми, а к ней приходим уже на той скорости, которую
  // потянут подъёмные. На стыке обе формулы дают одно и то же, и
  // ступеньки нет. Раньше здесь всегда считались подъёмные, и спуск с
  // 500 км на слабой луне занимал шестнадцать минут; если же считать
  // всегда маршевыми, корабль приходит к шасси на километре в секунду и
  // уходит под грунт.
  const aLift = Math.max(1e-6, Math.max(SHIP.liftMin, g * SHIP.liftTWR) - g);
  const vLift = (h) => Math.sqrt(2 * aLift * Math.max(0, h)) * LAND.brakeMargin + 0.002;
  if (gearOut) return vLift(alt);
  const hGear = LAND.landAlt * 1.5;          // высота выпуска шасси
  return Math.sqrt(2 * SHIP.brake * Math.max(0, alt - hGear)) * LAND.brakeMargin + vLift(hGear);
}

/**
 * Ведёт корабль на площадку. Пишет в ship.control / ship.throttle.
 * @param zone обстановка у поверхности (landingContext) — из неё берётся
 *             фактическая вертикальная скорость относительно грунта
 * @returns строка статуса для HUD
 */
export function updateLandingComputer(ship, dt, zone = null) {
  const L = ship.landing;
  if (!L) return null;
  const b = L.body;
  const alt = altitudeOf(b, ship.pos, _alt);

  // Высоко — идём обычным полётом ВЕРТИКАЛЬНО ВНИЗ, к точке прямо под
  // собой. Целиться в конкретную площадку здесь нельзя: пока корабль
  // снижается, она уезжает, и задача превращается в погоню за целью,
  // которая не медленнее преследователя.
  if (alt.alt > LAND.landAlt && !L.site) {
    L.phase = 'подход';
    worldPoint(b, alt.dir, alt.groundR + LAND.hold, _target);
    const dist = Math.hypot(
      _target.x - ship.pos.x, _target.y - ship.pos.y, _target.z - ship.pos.z);
    const off = aimAt(ship, _target);
    levelRoll(ship);

    // Шасси на подходе убрано: с ним скорость втрое ниже, а спуск с
    // орбиты и так самая долгая часть. Выпускается перед самым спуском.
    ship.gear.out = alt.alt < LAND.landAlt * 1.5;
    const gearOut = ship.gear.t > 0.02;
    const vMax = SHIP.maxSpeed * (gearOut ? SHIP.gearSpeed : 1);

    // Экспоненциальный подход: чем ближе, тем медленнее.
    //
    // Главное ограничение спуска при настоящем тяготении: на высоте h
    // скорость не должна превышать √(2·a·h) — иначе тормозить будет уже
    // негде. Чем именно тормозим, зависит от шасси (см. brakeLimit).
    let vEff = Math.min(dist / 8, vMax, brakeLimit(b, ship.pos, alt.alt, gearOut));
    if (off > 0.35) vEff = Math.min(vEff, vMax * 0.3);
    ship.throttle = clamp(vEff / vMax, 0, 1);
    return `ПОСАДКА: ПОДХОД, высота ${fmtKm(alt.alt)}, до площадки ${fmtKm(dist)}`;
  }

  // --- Спуск: брюхом вниз, тягой доводим снос, движками — высоту.
  dirToWorldBody(b, alt.dir, _up);                 // местная вертикаль

  // Площадка выбирается здесь, под собой, с оглядкой на уклон: садиться
  // строго в точку под кораблём нельзя — можно попасть на склон
  // кратерного вала и опрокинуться. Радиус поиска небольшой: до площадки
  // придётся ползти на малой тяге.
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
  // соседних точках заметно расходятся. Нос — на площадку, пока до неё
  // есть куда лететь: горизонтальный ход даёт та же тяга, что и в
  // обычном полёте, а она работает только вдоль носа.
  surfaceNormal(b, alt.dir, _nLocal, 0.06);
  dirToWorldBody(b, _nLocal, _nWorld);
  if (lateral > 0.02) {
    _want.x = sx; _want.y = sy; _want.z = sz;
    normalize(horizontal(_want, _nWorld, _fwd), _fwd);
  } else {
    normalize(horizontal(ship.basis.fwd, _nWorld, _fwd), _fwd);
  }
  const attErr = alignBasis(ship, _fwd, _nWorld, 1.5);

  // Горизонталь — тягой. Скорость подхода падает вместе со сносом, а
  // тяга даётся только когда нос уже развёрнут: иначе корабль уходит
  // боком от площадки.
  const vMaxH = SHIP.maxSpeed * SHIP.gearSpeed;
  const wantH = attErr < 0.3 ? Math.min(lateral * LAND.closeGain, LAND.closeSpeed) : 0;
  ship.throttle = clamp(wantH / vMaxH, 0, 1);

  // Спускаемся, только выйдя точно на ось площадки и выровнявшись.
  // Допуск по сносу жёсткий: на склоне корабль «догоняет» поднимающийся
  // грунт, и спуск встаёт.
  const ready = lateral < 0.05 && attErr < 0.08;
  // Быстрее компьютер не снижается: с настоящим тяготением разгон вниз
  // ничем не ограничен, и гасить его потом пришлось бы дольше, чем
  // длился сам спуск.
  let rate = clamp(alt.alt * 0.22, 0.004,
    Math.min(LAND.descent, brakeLimit(b, ship.pos, alt.alt)));
  if (alt.alt < 0.20) rate = Math.min(rate, 0.010);      // подтормаживание
  if (alt.alt < 0.05) rate = Math.min(rate, 0.005);      // касание
  // Не готовы — держим высоту и доводим снос. Возвращаться на высоту
  // ожидания нельзя: получается цикл «спуск — подъём — спуск».
  let vert = 0;
  if (ready) vert = -rate;
  else if (alt.alt < 0.08) vert = 0.004;                 // чуть отойти от грунта

  // Вертикаль — подъёмными движками, а они дают ТЯГУ. Основная её часть
  // уходит на удержание веса (потому и считается наперёд по местному g),
  // остаток — обратная связь по вертикальной скорости.
  const vUp = zone ? dot(zone.relVel, _up) : 0;
  const g = gravityAt(b, ship.pos);
  const full = Math.max(SHIP.liftMin, g * SHIP.liftTWR);
  ship.control.lift = clamp((g + (vert - vUp) * LAND.liftGain) / full, -1, 1);

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

  // Скорости — относительно грунта: он сам может двигаться.
  const vUp = dot(zone.relVel, zone.upWorld);
  horizontal(zone.relVel, zone.upWorld, _h);
  const hSpeed = Math.hypot(_h.x, _h.y, _h.z);
  const tilt = dot(ship.basis.up, zone.normalWorld);
  const gear = gearReady(ship);
  const poseOk = tilt >= LAND.tilt && zone.slope <= LAND.slope;

  // Штатное касание: шасси, брюхом вниз, в допусках по скорости.
  if (gear && poseOk && -vUp <= LAND.vspeed && hSpeed <= LAND.hspeed) {
    return { result: 'landed' };
  }

  // Всё остальное — удар. Его сила считается по энергии: нормальная
  // составляющая целиком, касательная с меньшим весом (по грунту
  // корабль скорее чиркает, чем бьётся).
  const norm = Math.max(0, -vUp);
  const hit = Math.hypot(norm, hSpeed * LAND.scrapeK);
  const soft = gear ? LAND.hitSoft : LAND.bareSoft;
  const t = Math.max(0, (hit - soft) / (LAND.hitKill - soft));
  let damage = 100 * t * t * (gear ? 1 : LAND.bareMul);
  // Без шасси удар не бывает бесплатным: корпус не для того, чтобы им
  // касались грунта. Заодно шкала остаётся монотонной — иначе мягкое
  // касание брюхом стоило бы дороже быстрого.
  if (!gear) damage = Math.max(damage, LAND.belly);
  // Неудачная поза бьёт по корпусу сильнее: удар приходится не в
  // амортизаторы, а в край корпуса.
  if (!poseOk) damage = Math.max(damage, 4) * 1.6;

  // Остановился в плохой позе — это уже не удар, а опрокидывание: ждать
  // нечего, корабль так и останется лежать.
  if (hit < LAND.settle) {
    // Лёг на брюхо, но аккуратно: корабль на грунте, корпус помят.
    // Разрушать за это нельзя — с этого и началась правка: касание на
    // метре в секунду не должно стоить корабля.
    if (!gear && poseOk) {
      return { result: 'landed', damage: LAND.belly, reason: 'Посадка без шасси.' };
    }
    if (!gear) {
      return { result: 'crash', reason: 'Касание поверхности без шасси, с перекосом.' };
    }
    if (tilt < LAND.tilt) {
      return { result: 'crash', reason: 'Корабль не выровнен по площадке — опрокидывание.' };
    }
    return {
      result: 'crash',
      reason: `Уклон площадки ${(zone.slope * 57.3).toFixed(0)}° — шасси не держит.`,
    };
  }

  return {
    result: 'bounce',
    damage,
    hit,
    reason: gear
      ? `Жёсткое касание: ${(hit * 1000).toFixed(0)} м/с.`
      : `Удар корпусом: ${(hit * 1000).toFixed(0)} м/с.`,
  };
}

/**
 * Отскок от грунта.
 *
 * Нормальная составляющая скорости отражается с потерей энергии,
 * касательную ест трение, а от касательной же корабль получает кувырок —
 * иначе удар выглядит как аккуратный прыжок мячика. На это время
 * управление отключается (ship.stun), и корабль летит свободно: без
 * паузы стабилизация гасит отскок за десятую долю секунды.
 */
export function bounceOff(ship, zone) {
  const n = zone.normalWorld;
  // Скорость относительно грунта: отражать надо именно её.
  const rel = _want;
  rel.x = zone.relVel.x; rel.y = zone.relVel.y; rel.z = zone.relVel.z;
  const vn = dot(rel, n);
  const tx = rel.x - n.x * vn, ty = rel.y - n.y * vn, tz = rel.z - n.z * vn;
  const tang = Math.hypot(tx, ty, tz);

  const out = vn < 0 ? -vn * LAND.restitution : 0;
  const keep = 1 - LAND.friction;
  ship.vel.x = zone.surfVel.x + tx * keep + n.x * out;
  ship.vel.y = zone.surfVel.y + ty * keep + n.y * out;
  ship.vel.z = zone.surfVel.z + tz * keep + n.z * out;
  ship.speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);

  // Кувырок: нос заваливается в ту сторону, куда корабль скользил.
  const kick = Math.min(1.6, tang * LAND.tumble);
  ship.rot.pitch += kick * clamp(dot(_h, ship.basis.fwd) / Math.max(tang, 1e-6), -1, 1);
  ship.rot.roll += kick * 0.6 * clamp(dot(_h, ship.basis.right) / Math.max(tang, 1e-6), -1, 1);

  // Вытолкнуть из грунта: иначе на следующем кадре снова «касание», и
  // удары считаются каждый кадр подряд.
  worldPoint(zone.body, zone.dir, zone.groundR + SHIP.gearClear * 1.05, ship.pos);

  const hard = Math.min(1, Math.abs(vn) / LAND.hitKill);
  ship.stun = SHIP.stunMin + (SHIP.stunMax - SHIP.stunMin) * hard;
  ship.lift = 0;
  ship.throttle = 0;
  ship.landing = null;              // компьютер после удара не продолжает
  return ship.stun;
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
  // Высота стоянки: на выпущенном шасси — по стойкам, на брюхе — по
  // корпусу. Иначе корабль без шасси висел бы над грунтом.
  const clear = Math.max(SHIP.hullClear, SHIP.gearClear * ship.gear.t);
  ship.landedPose = {
    dir: v3(zone.dir.x, zone.dir.y, zone.dir.z),
    radius: zone.groundR + clear,
    right: loc(ship.basis.right),
    up: loc(ship.basis.up),
    fwd: loc(ship.basis.fwd),
  };
  ship.landing = null;
  ship.speed = 0;
  ship.throttle = 0;
  ship.lift = 0;
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
  // Своей скорости у стоящего корабля нет: площадку под ним держит
  // перенос системы отсчёта (js/game/gravity.js).
  ship.vel.x = ship.vel.y = ship.vel.z = 0;
  ship.speed = 0;
}

/** Взлёт с поверхности: отрыв вертикально вверх на подъёмных движках. */
export function takeoff(ship) {
  const b = ship.landedAt;
  const p = ship.landedPose;
  if (!b || !p) return false;
  ship.landedAt = null;
  ship.landedPose = null;
  ship.gear.out = true;            // шасси убирает пилот, когда сочтёт нужным
  ship.throttle = 0;
  ship.speed = 0;
  ship.rot.pitch = ship.rot.yaw = ship.rot.roll = 0;
  // Отрыв: короткий импульс вверх по местной вертикали. Дальше корабль
  // подчиняется тяготению, и держать высоту приходится движками (R) —
  // шасси-то выпущено.
  dirToWorldBody(b, p.dir, _up);
  ship.vel.x = _up.x * LAND.liftoff;
  ship.vel.y = _up.y * LAND.liftoff;
  ship.vel.z = _up.z * LAND.liftoff;
  ship.speed = LAND.liftoff;
  ship.lift = 0;
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
