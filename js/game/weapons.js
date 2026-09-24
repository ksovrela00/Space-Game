// Оружие: стволы, наведение, болты и попадания.
//
// Модуль чистый: ни рендера, ни сети, ни сокета. На входе корабль, цель и
// время, на выходе — болты и попадания. Иначе это нечем проверить: бой
// разбирается по кадрам, а глазами в браузере видно только «вроде попал».
//
// Четыре решения, на которых всё держится.
//
// **Болт летит, а не попадает мгновенно.** Скорость конечная (3 км/с при
// дальности 2.5 км — почти секунда полёта), и поэтому по движущейся цели
// нужно УПРЕЖДЕНИЕ. Мгновенное попадание («луч дошёл — значит попал»)
// убило бы и упреждение, и уклонение разом, а вместе с ними весь бой.
//
// **Болт уносит с собой скорость корабля.** Его скорость в каталоге —
// ДУЛЬНАЯ, то есть относительно стрелка, а мировая складывается со
// скоростью корабля. Пока скорость была мировой, болт на полном ходу
// отползал от носа на 3 − 1.2 = 1.8 км/с, а на форсаже (предел растёт
// втрое, до 3.6 км/с) — оставался позади: очередь висела в воздухе, и
// попасть можно было только тормозя. Отсюда же и упреждение считается в
// осях СТРЕЛКА: идя с целью борт о борт, упреждать нечего, хотя в
// мировых осях оба мчатся.
//
// **Кардан наводит сам, но в пределах конуса.** Карданное оружие
// доворачивает ствол к упреждённой точке, пока та не дальше cone от оси
// корабля; за конусом ствол упирается в предел и бьёт по краю. Поэтому
// целиться всё равно надо — кардан прощает промах в пятнадцать градусов,
// а не отменяет прицеливание.
//
// **Попадание считает СТРЕЛЯВШИЙ.** У него на экране и болт, и цель в
// одном времени; у жертвы болт чужой и приходит с задержкой. Сервер
// проверяет, что попадание вообще возможно (дальность, темп, оружие на
// борту), и только он меняет корпус — клиент о своём уроне узнаёт от
// него (server/src/Combat.php).

import { v3, set, dot, normalize } from '../core/vec3.js';
import { toWorld, toLocal, dirToWorld } from '../core/basis.js';
import { SHIELD_AXES } from '../models/ships.js';
import { SHIP } from './ship.js';

const DEG = Math.PI / 180;

/**
 * Каталог оружия. ПУСТ ДО ЗАГРУЗКИ.
 *
 * Видов три — лазер, ракеты, турель, — и каждый бывает неподвижным или
 * на кардане. Сделан пока один: лазер на кардане. Остальные заведены в
 * бэкенде с самого начала, а не «когда дойдут руки», чтобы карточка
 * корабля и сервер знали о гнёздах сразу — пустое гнездо это тоже
 * сведение.
 *
 * Сами числа лежат в server/data/specs.php и приезжают оттуда (см.
 * js/game/specs.js). Здесь их нет намеренно: урон пушки — ровно то, во
 * что клиенту верить нельзя, и сервер считает попадания по СВОИМ
 * числам (server/src/Combat.php). Пока числа стояли в этом файле, они
 * были у сервера слепком, снятым с клиента.
 */
export const WEAPONS = {};

/** Что стоит на корабле игрока сейчас. Тоже из бэкенда. */
export const INSTALLED = [];

/**
 * Общие числа боя: сколько живёт вспышка, сколько видно щит и какого он
 * цвета. Объект заполняется вместе с оружием.
 */
export const COMBAT = {};

/**
 * Принять оружие от бэкенда.
 *
 * Конус доворота приходит в ГРАДУСАХ и здесь же переводится в радианы:
 * градусы — то, что подкручивает человек, радианы — то, чем считает
 * тригонометрия. Держать в бэкенде 0.2618 значило бы предлагать правщику
 * вводить радианы руками.
 */
export function applyWeaponSpecs(list, combat) {
  for (const key of Object.keys(WEAPONS)) delete WEAPONS[key];
  INSTALLED.length = 0;
  for (const w of list || []) {
    WEAPONS[w.code] = Object.assign({}, w, { cone: (w.coneDeg || 0) * DEG });
    if (w.ready) INSTALLED.push(w.code);
  }
  Object.assign(COMBAT, combat || {});
  return WEAPONS;
}

/**
 * Радиус корабля для попаданий, км.
 *
 * У чужого берётся его собственный (он приезжает вместе с ним: корпуса
 * будут разные), у своего — из лётной модели. Число это гейплейное, а не
 * рисовальное: по нему болт гаснет об обшивку, и по нему же сервер
 * проверяет, что попадание вообще было возможно.
 */
const hitRadius = (t) => (typeof t.radius === 'number' ? t.radius : SHIP.hitRadius);

/** Приехало ли оружие. */
export const weaponsReady = () => INSTALLED.length > 0;

export function makeGuns(code = INSTALLED[0]) {
  const spec = WEAPONS[code] || WEAPONS.laser_g;
  return {
    spec,
    bolts: [],
    // Вспышки попаданий: короткие, зато сразу видно, что попал. Живут
    // здесь же, а не в рендере, потому что рождаются от столкновения —
    // того самого расчёта, который считает бой.
    blasts: [],
    // Оболочки щита: видны только в момент удара (см. shieldFlash).
    shields: [],
    // ВСЕ попадания этого шага, включая чужие болты по нам: по ним
    // зажигается оболочка щита. Отдельно от hits, потому что докладывать
    // серверу надо только свои попадания по чужим.
    impacts: [],
    cool: 0,          // до следующего выстрела, с
    port: 0,          // из какого ствола бьём — стволы работают по очереди
    locked: false,    // кардан дотянулся до упреждённой точки
    aim: v3(),        // куда смотрит ствол прямо сейчас
    shots: 0,
    hits: 0,
  };
}

/**
 * Точка наводки: куда СМОТРЕТЬ стволу, чтобы болт и цель встретились.
 *
 * Решается |P + V·t − S| = c·t — уравнение встречи. Итерацией в три шага:
 * прямое решение квадратного уравнения дало бы то же самое, но развалилось
 * бы при скорости цели около скорости болта, а итерация просто перестаёт
 * сходиться и даёт разумный промах.
 *
 * Скорость цели берётся ОТНОСИТЕЛЬНО стрелка (fromVel), потому что болт
 * уносит с собой скорость корабля: в осях стрелка он летит ровно speed, а
 * цель идёт на разницу скоростей. Поэтому и точка возвращается такая, что
 * направление на неё от `from` — это направление ствола; «где цель будет в
 * мире» — другая точка, и целиться в неё было бы промахом на собственный
 * ход.
 *
 * @param fromVel скорость стрелка; без неё (null) счёт идёт по мировым
 *        скоростям — так ведёт себя неподвижная турель.
 */
export function leadPoint(from, target, speed, out = v3(), fromVel = null) {
  const tv = target.vel || { x: 0, y: 0, z: 0 };
  const sv = fromVel || { x: 0, y: 0, z: 0 };
  const vx = tv.x - sv.x, vy = tv.y - sv.y, vz = tv.z - sv.z;
  let t = 0;
  for (let i = 0; i < 3; i++) {
    const px = target.pos.x + vx * t - from.x;
    const py = target.pos.y + vy * t - from.y;
    const pz = target.pos.z + vz * t - from.z;
    const d = Math.hypot(px, py, pz);
    t = speed > 1e-6 ? d / speed : 0;
  }
  return set(out,
    target.pos.x + vx * t,
    target.pos.y + vy * t,
    target.pos.z + vz * t);
}

const _lead = v3();
const _dir = v3();

/**
 * Куда смотрит ствол: к упреждённой точке, но не дальше конуса кардана.
 *
 * За пределом конуса направление ПРИЖИМАЕТСЯ к краю, а не сбрасывается на
 * ось: ствол упирается в ограничитель, а не бросает цель. Признак locked
 * говорит, дотянулся он или нет, — по нему прицел в приборах меняет вид.
 */
export function aimDir(guns, ship, target, out = v3()) {
  const spec = guns.spec;
  const f = ship.basis.fwd;
  if (!target || spec.mount !== 'gimbal') {
    guns.locked = !!target && !!spec;
    return set(out, f.x, f.y, f.z);
  }
  leadPoint(ship.pos, target, spec.speed, _lead, ship.vel);
  set(_dir, _lead.x - ship.pos.x, _lead.y - ship.pos.y, _lead.z - ship.pos.z);
  const d = Math.hypot(_dir.x, _dir.y, _dir.z);
  if (!(d > 1e-9)) { guns.locked = false; return set(out, f.x, f.y, f.z); }
  _dir.x /= d; _dir.y /= d; _dir.z /= d;

  const cos = Math.max(-1, Math.min(1, dot(_dir, f)));
  const ang = Math.acos(cos);
  if (ang <= spec.cone) {
    guns.locked = true;
    return set(out, _dir.x, _dir.y, _dir.z);
  }
  guns.locked = false;
  // Поворот на угол конуса в той же плоскости: ось, край и цель лежат в
  // одной плоскости, поэтому хватает двух векторов.
  const k = Math.cos(spec.cone), s = Math.sin(spec.cone);
  let px = _dir.x - f.x * cos, py = _dir.y - f.y * cos, pz = _dir.z - f.z * cos;
  const pl = Math.hypot(px, py, pz);
  if (!(pl > 1e-9)) return set(out, f.x, f.y, f.z);
  px /= pl; py /= pl; pz /= pl;
  return set(out, f.x * k + px * s, f.y * k + py * s, f.z * k + pz * s);
}

/**
 * Выстрел, если пушка остыла.
 *
 * @returns массив новых болтов (пустой, если не выстрелили) — их же надо
 *          отправить в сеть, чтобы чужие видели огонь.
 */
export function fireGuns(guns, ship, target, ports, out = []) {
  out.length = 0;
  if (guns.cool > 0) return out;
  const spec = guns.spec;
  aimDir(guns, ship, target, guns.aim);

  // Стволы бьют по очереди: залпом из всех сразу темп удваивается, а
  // выглядит это как одна широкая вспышка.
  const port = ports.length ? ports[guns.port % ports.length] : null;
  guns.port++;
  const from = port ? toWorld(ship.basis, ship.pos, port, v3()) : v3(ship.pos.x, ship.pos.y, ship.pos.z);

  out.push(makeBolt(from, guns.aim, spec, true, 0, ship.vel));
  guns.bolts.push(out[0]);
  guns.cool = 1 / spec.rate;
  guns.shots++;
  return out;
}

/**
 * Болт: короткий отрезок, летящий по прямой.
 *
 * Хранит МИРОВУЮ скорость вектором (vx,vy,vz) = дуло + ход корабля, и
 * отдельно `dx,dy,dz` — куда он идёт на самом деле. Это не то же, что
 * направление ствола: на ходу след болта уводит вперёд по движению, и
 * рисовать его надо по пути, а не по прицелу, иначе очередь ляжет мимо
 * собственного следа.
 *
 * Жизнь меряется СЕКУНДАМИ, а не остатком километров: дальность в
 * каталоге — это «на сколько бьёт от стрелка», и на ходу пройденный в
 * мире путь больше неё в полтора раза, хотя от корабля болт ушёл ровно на
 * свои 2.5 км. Считая километры мировые, оружие теряло бы дальность
 * тем больше, чем быстрее летишь.
 *
 * @param dir   направление ствола, единичное
 * @param carry скорость стрелка (может не быть — тогда болт как из
 *              неподвижной турели)
 */
export function makeBolt(from, dir, spec, mine, by, carry = null) {
  const cx = carry ? carry.x : 0, cy = carry ? carry.y : 0, cz = carry ? carry.z : 0;
  const vx = dir.x * spec.speed + cx;
  const vy = dir.y * spec.speed + cy;
  const vz = dir.z * spec.speed + cz;
  const v = Math.hypot(vx, vy, vz);
  // Скорость ровно ноль означала бы, что корабль летит точно навстречу
  // собственному выстрелу с дульной скоростью. Такого в игре нет, но
  // делить на ноль всё равно нельзя — след тогда рисуется по стволу.
  const k = v > 1e-9 ? 1 / v : 0;
  return {
    x: from.x, y: from.y, z: from.z,
    px: from.x, py: from.y, pz: from.z,
    vx, vy, vz,
    dx: k ? vx * k : dir.x, dy: k ? vy * k : dir.y, dz: k ? vz * k : dir.z,
    life: spec.speed > 1e-9 ? spec.range / spec.speed : 0,
    len: spec.boltLen,
    damage: spec.damage,
    color: spec.color,
    mine: !!mine,
    by: by || 0,
  };
}

/**
 * Шаг боя: болты летят, попадания ищутся.
 *
 * Попадания ищутся ОТРЕЗКОМ, а не точкой: на 3 км/с болт за кадр
 * проходит полсотни метров — больше собственной длины и больше корабля.
 * Проверка «попал ли центр болта в шар» пропускала бы цель через раз, и
 * промах выглядел бы как «прошло насквозь».
 *
 * Останавливаются о корпус ВСЕ болты, включая чужие: чужой болт урона
 * нам не наносит (это решает сервер), но пролетать сквозь корабль он не
 * должен — именно это и выглядит как «стреляют мимо, а попадают».
 * Докладываются же только СВОИ попадания и только по чужим кораблям.
 *
 * @param ships корабли: [{id, pos, own}] — свой помечен own
 * @returns список попаданий [{id, damage, x,y,z}]
 */
export function updateGuns(guns, dt, ships, hits = []) {
  hits.length = 0;
  if (guns.cool > 0) guns.cool = Math.max(0, guns.cool - dt);
  // Старые вспышки гасим ДО новых: иначе вспышка, зажжённая в этом же
  // шаге, состарилась бы на целый кадр, ещё не показавшись.
  updateBlasts(guns, dt);
  guns.impacts.length = 0;

  const live = [];
  for (const b of guns.bolts) {
    b.px = b.x; b.py = b.y; b.pz = b.z;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    b.life -= dt;

    let gone = false;
    if (ships && ships.length) {
      for (const t of ships) {
        if (!t || !t.pos) continue;
        // В свой же корабль болт не попадает: он из него вылетел.
        if (b.mine ? t.own : b.by === t.id) continue;
        if (!segmentHit(b, t.pos, hitRadius(t))) continue;
        if (b.mine && !t.own) {
          hits.push({ id: t.id, damage: b.damage, x: b.x, y: b.y, z: b.z });
          guns.hits++;
        }
        guns.impacts.push({
          id: t.id, own: !!t.own, mine: !!b.mine,
          x: b.x, y: b.y, z: b.z, cx: t.pos.x, cy: t.pos.y, cz: t.pos.z,
        });
        blast(guns, b.x, b.y, b.z, b.color);
        gone = true;
        break;
      }
    }
    if (!gone && b.life > 0) live.push(b);
  }
  guns.bolts = live;
  return hits;
}

/**
 * Вспышка попадания.
 *
 * @param color цвет: у щита он свой (shieldColor) — по нему сразу
 *        видно, приняла ли оболочка удар на себя.
 */
export function blast(guns, x, y, z, color, size = 1) {
  const b = { x, y, z, age: 0, life: COMBAT.blastLife, color: color || [1, 0.5, 0.2], size };
  guns.blasts.push(b);
  // Вспышек больше десятка одновременно не бывает даже в свалке; если
  // вдруг случилось — старые всё равно уже погасли.
  if (guns.blasts.length > 32) guns.blasts.shift();
  return b;
}

/**
 * Цвет вспышки, когда удар принял щит: холодный, чтобы отличать сразу.
 * Как и всё остальное, приезжает из бэкенда (COMBAT.shieldColor).
 */
export const shieldColor = () => COMBAT.shieldColor;

const _hit = v3();

/**
 * Показать щит: оболочка на миг проявляется вокруг корабля.
 *
 * Хранится не точка, а НАПРАВЛЕНИЕ на неё, и притом в осях КОРАБЛЯ:
 * корабль летит и вертится, а пятно обязано остаться там, куда пришёл
 * луч, — на том же борту.
 *
 * Направление делится на полуоси оболочки: она вытянута по корпусу, и
 * без этого деления пятно на сплюснутом борту уезжало бы от места удара.
 */
export function shieldFlash(guns, id, own, point, center, basis) {
  toLocal(basis, center, point, _hit);
  const x = _hit.x / SHIELD_AXES[0];
  const y = _hit.y / SHIELD_AXES[1];
  const z = _hit.z / SHIELD_AXES[2];
  const l = Math.hypot(x, y, z) || 1;
  guns.shields.push({
    id, own, age: 0, life: COMBAT.shieldLife,
    dx: x / l, dy: y / l, dz: z / l,
  });
  if (guns.shields.length > 16) guns.shields.shift();
  return guns.shields[guns.shields.length - 1];
}

/** Есть ли уже свежая оболочка на этом корабле — чтобы не двоить. */
export function hasShieldFlash(guns, id, own) {
  for (const f of guns.shields) {
    if (f.own === own && f.id === id && f.age < 0.15) return true;
  }
  return false;
}

function updateBlasts(guns, dt) {
  if (guns.blasts.length) {
    const live = [];
    for (const b of guns.blasts) {
      b.age += dt;
      if (b.age < b.life) live.push(b);
    }
    guns.blasts = live;
  }
  if (guns.shields.length) {
    const live = [];
    for (const f of guns.shields) {
      f.age += dt;
      if (f.age < f.life) live.push(f);
    }
    guns.shields = live;
  }
}

/** Прошёл ли отрезок [prev, now] ближе радиуса к точке. */
export function segmentHit(bolt, point, radius) {
  const ax = bolt.px, ay = bolt.py, az = bolt.pz;
  const bx = bolt.x - ax, by = bolt.y - ay, bz = bolt.z - az;
  const l2 = bx * bx + by * by + bz * bz;
  const px = point.x - ax, py = point.y - ay, pz = point.z - az;
  let t = l2 > 1e-12 ? (px * bx + py * by + pz * bz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

/**
 * Чужой выстрел — только картинка: попадания по нам считает сервер.
 *
 * Ход стрелка (`carry`) берётся ИЗ СВОЕГО списка пилотов, а не из
 * сообщения. Скорость соседа у нас уже есть — она считается по его же
 * снимкам (js/game/peers.js) и по ней ведётся упреждение, — и просить её
 * у клиента значит принимать лишнее: чужому болту, вылетающему с чужой
 * же придуманной скоростью, верить нечему. Нет соседа в списке (только
 * появился) — болт летит одной дульной скоростью, как раньше.
 */
export function addForeignBolt(guns, msg, carry = null) {
  const spec = WEAPONS[msg.w] || guns.spec;
  const dir = normalize(v3(msg.dx, msg.dy, msg.dz));
  if (!Number.isFinite(dir.x + dir.y + dir.z)) return null;
  const from = v3(msg.x, msg.y, msg.z);
  if (!Number.isFinite(from.x + from.y + from.z)) return null;
  const b = makeBolt(from, dir, spec, false, msg.by | 0, carry);
  guns.bolts.push(b);
  return b;
}

/** Стволы корабля в мировых координатах — для вспышек у дула. */
export function muzzleWorld(ship, port, out = v3()) {
  return toWorld(ship.basis, ship.pos, port, out);
}

export { dirToWorld };
