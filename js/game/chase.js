// Камера из-за спины.
//
// Жила в main.js, пока умела одно: висеть позади корабля с запаздыванием.
// Теперь у неё есть решения, которые стоит проверять без браузера, — где
// она стоит у грунта, куда её не пускает земля и дома, насколько она
// тяжела, — поэтому она своим модулем.
//
// ЗАЧЕМ ВСЁ ЭТО. Размер корабля в кадре о его настоящем размере не
// говорит ничего: камера держится примерно в одной его длине, и игрушка
// в шестьдесят пять сантиметров, снятая с семидесяти, дала бы тот же
// кадр. Масштаб глаз берёт из трёх вещей — из предметов известного
// размера рядом, из того, КАК снята вещь, и из того, как она движется.
// Здесь последние две:
//
//   * великана снимают СНИЗУ. Камера, висящая над крышей корпуса,
//     смотрит на корабль как на модель на столе: целиком, сверху, с
//     запасом по краям. У грунта она уходит под брюхо — корабль нависает
//     над лесом и не влезает в кадр, а под ним видно землю, его тень и
//     пыль (см. «Под брюхом»);
//   * тяжёлое не дёргается. Камера догоняет нос за то же время, за
//     какое сам корабль раскручивается (см. «Вес»), и мелко дрожит от
//     работы двигателей.

import { v3, copy, normalize, clamp } from '../core/vec3.js';
import { makeBasis, lookAlong } from '../core/basis.js';
import { SHIP } from './ship.js';
import { HULL_CLEAR } from '../models/ships.js';
import { isSolid, localDir, groundRadius } from './surface.js';
import { engineLoad } from './downwash.js';
import { cityLocal } from './city.js';
import { cityBlocked } from '../models/city.js';

export const CHASE = {
  // Вынос в полёте: ближе, чем кажется нужным.
  //
  // Раньше камера стояла в 200 метрах позади и в 55 над кораблём — три
  // его длины. На орбите это незаметно, а у поверхности рушит чувство
  // масштаба: прибор показывает 32 метра высоты, а глаз видит землю с
  // точки, которая втрое выше, и читает «пара сотен». Теперь вынос
  // сравним с размером корабля, и высота на приборе совпадает с тем, что
  // видно.
  back: 0.105,          // км
  up: 0.026,            // км
  // Снос от ускорения: разгоняясь, корабль уходит от камеры вперёд.
  // Коэффициент подобран по форсажу — на полной тяге отставание выходит
  // около полутора корпусов, дальше упирается в предел.
  sway: 0.012,          // км на км/с²
  swayMax: 0.05,        // км
  // У земли камеру подтягивает к корпусу: чем ближе точка съёмки к
  // кораблю, тем вернее глаз читает высоту по его размеру.
  low: 0.4,             // км — ниже этого начинается подтягивание
  lowK: 0.62,           // во сколько раз ближе она встаёт у грунта

  // --- Под брюхом --------------------------------------------------------
  //
  // Ниже lowIn камера уходит под корпус, выше lowOut возвращается
  // наверх. Порога ДВА, и это не прихоть: с одним камера, зависшая на
  // нём, стояла бы ровно на уровне корпуса — а оттуда корабль
  // закрывает собой весь вид вперёд. С двумя она либо над ним, либо под
  // ним, и уровень корпуса проходит только на переходе.
  //
  // Верхний порог — тот же, с которого начинается подтягивание (low):
  // выше корабль летит, а не висит над землёй, и снимать его снизу
  // незачем.
  lowIn: 0.24,          // км
  lowOut: 0.4,          // км
  // Зазор между брюхом и камерой. Не ноль: взгляд вперёд идёт по
  // горизонту, и с камерой вровень с днищем прицел ложился бы на обшивку.
  underGap: 0.002,      // км
  // Перелёт под корпус и обратно — движение крана, а не прыжок.
  swing: 1.6,           // с
  // Запас над ближней плоскостью (см. eyeHeight).
  eyeK: 1.5,

  // --- Дрожь -------------------------------------------------------------
  //
  // Мелкая, низкая и только от ДВИГАТЕЛЕЙ: у земли их больше слышно, а
  // струя, отражённая грунтом, бьёт по корпусу. Амплитуда — угловая, на
  // полном ходу у самой земли полградуса; на зависании (треть хода) это
  // два пикселя дрожания на экране: заметно, но не мешает целиться.
  shake: 0.008,         // рад
  shakeNear: 0.15,      // км — ниже этого грунт добавляет дрожи
};

// Камера висит ПОД брюхом на столько, км (отрицательно — вниз от центра).
export const CHASE_UNDER = -(HULL_CLEAR + CHASE.underGap);

/**
 * Самая низкая высота камеры над грунтом, км.
 *
 * Выводится из ближней плоскости сцены (4 м, js/gl/scene.js): нижний
 * край кадра смотрит вниз под углом fov/2, и земля в нём оказывается на
 * глубине h / tan(fov/2). Будь камера ниже near·tan(fov/2), ближняя
 * плоскость срезала бы землю у нижнего края кадра — в нём зияла бы
 * дыра до самого неба. Запас eyeK держит этот край подальше.
 *
 * Отсюда и «примерно на высоте глаз» — четыре метра, а не полтора:
 * ближе ближней плоскости камера не видит ничего.
 */
export const eyeHeight = (cam) => cam.near * CHASE.eyeK * Math.tan(cam.fov / 2);

// --- Вес ---------------------------------------------------------------------
//
// Камера догоняет нос за то же время, за какое корабль выходит на свою
// угловую скорость по тангажу (SHIP.pitchRate / SHIP.pitchAccel — 1.3 с
// у этого корпуса), но не дольше CHASE_LAG_MAX. Прежде она догоняла за 0.14 с — быстрее, чем корабль
// успевал раскрутиться, и разворот выглядел так, будто мир вертится
// вокруг неподвижной модели. Так снимают истребитель; тяжёлый корабль
// успевает повернуться ВНУТРИ кадра.
//
// Крен догоняется вдвое медленнее: у него и угловая скорость самая
// большая, и именно на нём запаздывание читается как вес.
//
// Числа корабля приходят с бэкенда; пока их нет, берётся прежняя пара —
// камера нужна и на стартовом экране.
//
// Но не дольше CHASE_LAG_MAX: камера, отстающая на время разгона тяжёлого
// корабля (1.3 с), в ровном развороте отставала бы на три десятка
// градусов — корабль уезжал бы к краю кадра. Вес читается и при
// отставании в пятнадцать-двадцать.
const CHASE_LAG_MAX = 0.8;       // с

export function chaseRates() {
  const ramp = SHIP.pitchAccel > 0 && SHIP.pitchRate > 0
    ? Math.min(SHIP.pitchRate / SHIP.pitchAccel, CHASE_LAG_MAX) : 0;
  const turn = ramp > 0 ? 1 / ramp : 7;
  return { turn, roll: turn / 2 };
}

export function makeChase() {
  return {
    fwd: v3(0, 0, 1), up: v3(0, 1, 0),
    acc: v3(), prevVel: v3(), sway: v3(),
    near: 1, ready: false, wasRailed: false,
    below: false,         // решено ли уйти под корпус (два порога)
    low: 0,               // ход перелёта под корпус, 0..1
    t: 0,                 // своё время — для дрожи
    shake: 0,             // сила дрожи, 0..1
    lift: 0,              // насколько камеру подняли над землёй, км
    pulled: 0,            // насколько её подтянули из-за домов, доля
  };
}

const _acc = v3();
const _load = { lift: 0, main: 0 };

/**
 * Инерция камеры. Считается по времени игрока, а не по шагам физики: это
 * свойство съёмки, а не корабля.
 *
 * @param settled корабль стоит (на грунте, в порту): камера садится на
 *        место мгновенно — запаздывание про полёт, а не про то, как
 *        открылся экран
 */
export function updateChase(c, game, dt, settled = false) {
  const ship = game.ship;
  const b = ship.basis;

  // На рельсах квантового привода сноса нет вовсе.
  //
  // Снос — это модель камеры-преследователя с инерцией, и она про ТЯГУ
  // корабля. В прыжке скорость задаётся профилем, и на торможении
  // ускорение доходит до двенадцати тысяч км/с²: снос упирался в свой
  // предел и держал камеру вплотную к кораблю все пять секунд выхода —
  // со стороны это и выглядело как «камера уехала вперёд».
  // «На рельсах» считается и один кадр ПОСЛЕ выхода: на самом выходе
  // скорость падает с тысяч км/с до нуля за кадр, и разность скоростей
  // даёт ускорение, которого не бывает. Именно этот единственный кадр и
  // швырял камеру вперёд на пол-корпуса.
  const onRails = !!((game.quantum && game.quantum.phase !== 'idle') ||
    (game.warp && game.warp.phase === 'tunnel'));
  const railed = onRails || c.wasRailed;
  c.wasRailed = onRails;
  if (railed) {
    copy(c.prevVel, ship.vel);
    c.acc.x = c.acc.y = c.acc.z = 0;
    c.sway.x = c.sway.y = c.sway.z = 0;
  }

  // Ускорение корабля — по изменению его скорости. Отдельного «сколько
  // дали тяги» тут не нужно: камере важно то, что произошло, а не то,
  // что просили, и удар о грунт она обязана показать так же, как разгон.
  if (!railed && dt > 1e-5) {
    _acc.x = (ship.vel.x - c.prevVel.x) / dt;
    _acc.y = (ship.vel.y - c.prevVel.y) / dt;
    _acc.z = (ship.vel.z - c.prevVel.z) / dt;
  }
  if (!railed) {
    copy(c.prevVel, ship.vel);
    const ka = Math.min(1, dt * 6);
    c.acc.x += (_acc.x - c.acc.x) * ka;
    c.acc.y += (_acc.y - c.acc.y) * ka;
    c.acc.z += (_acc.z - c.acc.z) * ka;
  }

  // Высота: у грунта камера ближе.
  const zone = game.zone;
  const ground = !!(zone && zone.body && isSolid(zone.body) && zone.alt >= 0);
  const alt = ground ? zone.alt : Infinity;
  const want = alt >= CHASE.low ? 1
    : CHASE.lowK + (1 - CHASE.lowK) * clamp(alt / CHASE.low, 0, 1);
  c.near += (want - c.near) * Math.min(1, dt * 3);

  // Под брюхо или наверх — по двум порогам.
  if (c.below && alt > CHASE.lowOut) c.below = false;
  else if (!c.below && alt < CHASE.lowIn) c.below = true;
  const target = c.below ? 1 : 0;

  if (!c.ready || settled || dt <= 0) {
    copy(c.fwd, b.fwd);
    copy(c.up, b.up);
    c.acc.x = c.acc.y = c.acc.z = 0;
    c.low = target;
    c.ready = true;
  } else {
    const r = chaseRates();
    const kf = 1 - Math.exp(-r.turn * dt);
    const ku = 1 - Math.exp(-r.roll * dt);
    c.fwd.x += (b.fwd.x - c.fwd.x) * kf;
    c.fwd.y += (b.fwd.y - c.fwd.y) * kf;
    c.fwd.z += (b.fwd.z - c.fwd.z) * kf;
    c.up.x += (b.up.x - c.up.x) * ku;
    c.up.y += (b.up.y - c.up.y) * ku;
    c.up.z += (b.up.z - c.up.z) * ku;
    normalize(c.fwd, c.fwd);
    normalize(c.up, c.up);
    const step = dt / CHASE.swing;
    c.low = target > c.low ? Math.min(target, c.low + step) : Math.max(target, c.low - step);
  }

  // Дрожь — от работы двигателей, сильнее у самой земли.
  c.t += dt;
  const load = engineLoad(ship, _load, ground);
  const work = Math.min(1, load.lift + load.main);
  const nearK = ground ? clamp(1 - alt / CHASE.shakeNear, 0, 1) : 0;
  const shake = railed ? 0 : work * (0.35 + 0.65 * nearK);
  c.shake += (shake - c.shake) * Math.min(1, dt * 4);

  // Снос камеры: она отстаёт от того, что разгоняется.
  if (railed) return c;
  const am = Math.hypot(c.acc.x, c.acc.y, c.acc.z);
  const k = am > 1e-9 ? -Math.min(CHASE.sway * am, CHASE.swayMax) / am : 0;
  c.sway.x = c.acc.x * k;
  c.sway.y = c.acc.y * k;
  c.sway.z = c.acc.z * k;
  return c;
}

/** Поворот вектора вокруг оси (формула Родрига). */
export function rotAround(v, axis, ang, out) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const d = axis.x * v.x + axis.y * v.y + axis.z * v.z;
  out.x = v.x * c + (axis.y * v.z - axis.z * v.y) * s + axis.x * d * (1 - c);
  out.y = v.y * c + (axis.z * v.x - axis.x * v.z) * s + axis.y * d * (1 - c);
  out.z = v.z * c + (axis.x * v.y - axis.y * v.x) * s + axis.z * d * (1 - c);
  return out;
}

// Плавный ход перелёта: кран трогается и останавливается мягко.
const ease = (t) => t * t * (3 - 2 * t);

// Дрожь: три некратные частоты от трёх до девяти герц — гул, а не
// вибрация одной струны.
const buzz = (t, ph) => (Math.sin(t * 19.5 + ph) + 0.6 * Math.sin(t * 33.3 + ph * 1.7)
  + 0.35 * Math.sin(t * 55.9 + ph * 2.3)) / 1.95;

const _basis = makeBasis();
const _dir = v3();
const _right = v3();
const _ld = v3();
const _mid = v3();
const _loc = v3();
const _tmp = v3();

/**
 * Поставить камеру за кораблём.
 *
 * @param ground необязательная (body, dirLocal) => радиус грунта,
 *        КАК ОН НАРИСОВАН. Сетка передаёт рельеф с ошибкой «уклон ×
 *        ячейка», и нарисованная земля бывает выше настоящей: камера,
 *        поставленная по настоящей, оказалась бы под картинкой. Берётся
 *        большая из двух.
 */
export function placeChase(c, game, cam, ground = null) {
  const ship = game.ship;
  // Своя ориентация камеры: она догоняет корабль, а не повторяет его.
  lookAlong(_basis, c.fwd, c.up);
  const b = _basis;
  const o = game.camOrbit || { yaw: 0, pitch: 0 };
  // Направление взгляда = нос корабля, повёрнутый на осмотр.
  rotAround(b.fwd, b.up, o.yaw, _dir);
  rotAround(_dir, rotAround(b.right, b.up, o.yaw, _right), o.pitch, _dir);

  // Вынос: наверху — над крышей, у земли — под брюхом.
  const s = ease(c.low);
  const back = CHASE.back * c.near * (1 - s) + CHASE.back * CHASE.lowK * s;
  const up = CHASE.up * c.near * (1 - s) + CHASE_UNDER * s;
  const p = cam.pos;
  p.x = ship.pos.x - _dir.x * back + b.up.x * up + c.sway.x;
  p.y = ship.pos.y - _dir.y * back + b.up.y * up + c.sway.y;
  p.z = ship.pos.z - _dir.z * back + b.up.z * up + c.sway.z;

  // Дрожь: и взгляд, и точка съёмки.
  const a = CHASE.shake * c.shake;
  if (a > 1e-6) {
    const jy = a * buzz(c.t, 0.0), jp = a * buzz(c.t, 2.1);
    rotAround(_dir, b.up, jy, _tmp);
    rotAround(_tmp, _right, jp, _dir);
    const jd = back * a * 0.5;
    p.x += b.up.x * jd * buzz(c.t, 4.2);
    p.y += b.up.y * jd * buzz(c.t, 4.2);
    p.z += b.up.z * jd * buzz(c.t, 4.2);
  }

  c.lift = 0;
  c.pulled = 0;
  const zone = game.zone;
  if (zone && zone.body && isSolid(zone.body)) {
    keepAboveGround(c, ship, zone.body, cam, ground);
    keepOutOfCity(c, ship, game.world, p);
  }
  lookAlong(cam.basis, _dir, b.up);
  return cam;
}

/** Радиус грунта под направлением: большая из настоящей и нарисованной. */
function groundAt(body, dir, ground) {
  const r = groundRadius(body, dir);
  return ground ? Math.max(r, ground(body, dir) || 0) : r;
}

/**
 * Земля не пускает камеру вниз.
 *
 * Проверяется ДВЕ точки: под самой камерой — не ниже eyeHeight — и
 * середина пути до корабля. Вторая про холм между ними: камера над
 * низиной смотрела бы на корабль сквозь склон. Поднимается только сама
 * камера, поэтому недостача в середине удваивается — середина
 * поднимается вдвое меньше.
 */
function keepAboveGround(c, ship, body, cam, ground) {
  const p = cam.pos;
  const eye = eyeHeight(cam);
  localDir(body, p, _ld);
  const dist = Math.hypot(p.x - body.pos.x, p.y - body.pos.y, p.z - body.pos.z);
  let lift = groundAt(body, _ld, ground) + eye - dist;

  _mid.x = (p.x + ship.pos.x) / 2;
  _mid.y = (p.y + ship.pos.y) / 2;
  _mid.z = (p.z + ship.pos.z) / 2;
  localDir(body, _mid, _ld);
  const dm = Math.hypot(_mid.x - body.pos.x, _mid.y - body.pos.y, _mid.z - body.pos.z);
  lift = Math.max(lift, 2 * (groundAt(body, _ld, ground) + eye * 0.5 - dm));

  if (!(lift > 0)) return;
  const ux = (p.x - body.pos.x) / dist, uy = (p.y - body.pos.y) / dist, uz = (p.z - body.pos.z) / dist;
  p.x += ux * lift; p.y += uy * lift; p.z += uz * lift;
  c.lift = lift;
}

/**
 * Дома не пускают камеру внутрь: она подтягивается к кораблю по прямой,
 * пока не выйдет из коробки. Корабль сам в дом не залезет — это
 * столкновение (js/game/city.js, cityCrash), — значит, у него точка
 * всегда свободна, и поиск кончается.
 */
function keepOutOfCity(c, ship, world, p) {
  const cities = world && world.cities;
  if (!cities || !cities.length) return;
  const pad = 0.002;
  for (const city of cities) {
    const dx = p.x - city.pos.x, dy = p.y - city.pos.y, dz = p.z - city.pos.z;
    if (dx * dx + dy * dy + dz * dz > (city.radius + 1) * (city.radius + 1)) continue;
    cityLocal(city, p, _loc);
    if (!cityBlocked(city.plan, _loc.x, _loc.y, _loc.z, pad)) continue;
    const sx = p.x, sy = p.y, sz = p.z;
    for (let k = 1; k <= 16; k++) {
      const t = 1 - k / 16;
      p.x = ship.pos.x + (sx - ship.pos.x) * t;
      p.y = ship.pos.y + (sy - ship.pos.y) * t;
      p.z = ship.pos.z + (sz - ship.pos.z) * t;
      cityLocal(city, p, _loc);
      if (!cityBlocked(city.plan, _loc.x, _loc.y, _loc.z, pad)) { c.pulled = k / 16; break; }
    }
    return;
  }
}
