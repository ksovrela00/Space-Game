// Чужие корабли и люди: из редких снимков — в движение, на которое можно смотреть.
//
// Сокет присылает положение чужих кораблей пять раз в секунду (Hub::TICK),
// а кадров рисуется шестьдесят. Показывать последнее присланное нельзя:
// корабль поедет пятью скачками в секунду, и на сближении это читается не
// как полёт, а как подвисание сети.
//
// Поэтому снимки копятся, а картинка ОТСТАЁТ от них на PEER_DELAY и идёт
// по двум соседним снимкам. Плата честная: чужой корабль всегда там, где
// он был четверть секунды назад, а не где он сейчас. Для стрельбы так
// нельзя, для «вижу, кто летит рядом» — незаметно, а рывки заметны сразу.
//
// ОСИ ТЕЛА. У тела корабль приходит не мировой точкой, а точкой в осях
// тела (поля b, lx..): четверть секунды опоздания в мировых осях — это
// шестьдесят метров вращения грунта на экваторе. Стоящий корабль соседа
// стоял бы в шестидесяти метрах от своей стоянки, и зайти к нему по
// трапу было бы нельзя: трап висел бы над чужим рельефом. В осях тела
// опоздание касается только собственного хода корабля, а стоящий стоит.
//
// ЛЮДИ — отдельный список (makePeople): где каждый стоит — в осях
// корабля, на борту которого он (метры), или в осях тела, на грунте
// которого (километры). Мировую точку из этого собирает тот, кто знает,
// где сейчас корабль и тело (js/main.js).
//
// Модуль не знает ни про сокет, ни про рендер: на входе список от
// сервера, на выходе — положение и ориентация на любой момент времени.
// Поэтому он проверяется в Node целиком (tools/test.mjs), без сети и
// без браузера.

import { v3, set, cross, normalize } from '../core/vec3.js';
import { SHIP } from './ship.js';
import { typeSpec } from './specs.js';
import { makeBasis, orthonormalize, toWorld, dirToWorld } from '../core/basis.js';
import { bodyBasis } from './world.js';

/** На сколько картинка отстаёт от снимков, с. Чуть больше тика сервера. */
export const PEER_DELAY = 0.25;

/**
 * Сколько готовы досчитать вперёд, когда снимок опоздал, с.
 *
 * Без этого любая потерянная посылка останавливает чужой корабль на
 * месте, а следующая — дёргает его вперёд. С досчётом он продолжает идти
 * как шёл. Долго досчитывать нельзя: корабль уедет туда, где его нет, и
 * вернётся рывком — тем самым, от которого мы уходили.
 */
export const PEER_AHEAD = 0.4;

/**
 * Сколько держим пилота, от которого ничего не приходит, с.
 *
 * Это же и ответ на обрыв связи: снимки перестали идти — чужие корабли
 * гаснут через PEER_TTL, а не висят в космосе навсегда.
 */
export const PEER_TTL = 0.8;

/** Сколько снимков держим на пилота. Больше двух — чтобы пережить потерю. */
const KEEP = 6;

const FWD = { x: 0, y: 0, z: 1 };
const UP = { x: 0, y: 1, z: 0 };

export const makePeers = () => ({ by: new Map() });

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Направление из трёх чисел.
 *
 * Мусор и нули не пропускаем: единственный NaN, дошедший до матрицы,
 * гасит корабль целиком, и искать его потом в шейдере — худший способ
 * провести вечер. Сервер эти числа только пересылает и не проверяет.
 */
function dir(x, y, z, dflt) {
  const a = num(x), b = num(y), c = num(z);
  if (a === null || b === null || c === null) return { x: dflt.x, y: dflt.y, z: dflt.z };
  const l = Math.hypot(a, b, c);
  if (!(l > 1e-6)) return { x: dflt.x, y: dflt.y, z: dflt.z };
  return { x: a / l, y: b / l, z: c / l };
}

function record(id) {
  return {
    id,
    name: '',
    mode: 'flight',
    seen: 0,
    samples: [],
    // Ответ отдаём в одном и том же объекте: пилотов мало, но кадров
    // шестьдесят в секунду, и мусорить ими незачем.
    // vel — скорость вектором, а не числом: по ней считается упреждение
    // при стрельбе (js/game/weapons.js). Из одного лишь модуля скорости
    // упреждение не вывести — нужно знать, КУДА цель идёт.
    out: {
      // id — номер КОРАБЛЯ (в него и попадают), by — игрок, который его
      // ведёт, а у спящего — хозяин.
      id, by: null, name: '', mode: 'flight', v: 0,
      pos: v3(), vel: v3(), basis: makeBasis(),
      // Чужой корабль — такая же цель, как станция: его выбирают носом
      // по Tab и по нему же считают дистанцию (js/game/nav.js). Радиус —
      // половина корпуса: прицел, стоящий на корабле, обязан его брать.
      // Берётся из лётной модели, а не вписан числом: корпус у соседа
      // пока тот же, что у нас, а когда появятся разные — приедет его
      // собственный, вместе с остальными его числами.
      isPeer: true, radius: SHIP.hitRadius,
      // Корпус и щит соседа: их считает сервер и шлёт в каждом снимке,
      // а рисуются они полосками у его метки (js/ui/hud.js).
      hull: 0, hullMax: 0, shield: 0, shieldMax: 0,
      // Без водителя: хозяин в игре, но ведёт не его (пересел, улетел
      // пассажиром), и стоит он, где оставлен, по базе. В прицел не
      // берётся — стрелять по пустому кораблю незачем. Корабля того, кого
      // нет в игре, хаб не шлёт вовсе (server/src/Hub.php).
      dorm: false,
      // Тип корпуса (код ship_type): по нему корабль рисуется своим
      // корпусом и стойками (js/models/hulls.js). Нет в снимке — такой же,
      // как у нас.
      type: null,
      // Шасси (0..1), открытые люки и работа подъёмных — чтобы корабль
      // стоял на стойках, люк был открыт и сопла тлели как у хозяина.
      gear: { out: false, t: 0, drop: null },
      hatches: [],
      lift: 0,
      // Кто сидит в кресле (игрок), у какого тела корабль и в какой
      // системе (пассажиру — чтобы уйти за ним в прыжок, js/main.js).
      pilot: null,
      body: null,
      sys: null,
    },
  };
}

/**
 * Принять снимок от сервера.
 *
 * Вызывать ТОЛЬКО на новый снимок, а не каждый кадр: время снимка здесь —
 * время его прихода, и повторная запись того же списка сделала бы вид,
 * будто корабль стоит.
 */
export function ingestPeers(store, list, now) {
  for (const p of Array.isArray(list) ? list : []) {
    const id = num(p && p.id);
    if (id === null) continue;
    const b = num(p.b);
    const lx = num(p.lx), ly = num(p.ly), lz = num(p.lz);
    const local = b !== null && lx !== null && ly !== null && lz !== null;
    const x = num(p.x), y = num(p.y), z = num(p.z);
    if (!local && (x === null || y === null || z === null)) continue;

    let r = store.by.get(id);
    if (!r) { r = record(id); store.by.set(id, r); }
    if (typeof p.name === 'string' && p.name) r.name = p.name;
    if (typeof p.mode === 'string' && p.mode) r.mode = p.mode;
    const o = r.out;
    // Сменил систему (варп) — координаты теперь другой системы: тянуть к
    // ним прежние снимки — значит провести корабль сквозь полгалактики.
    const sys = num(p.sys);
    if (sys !== null && o.sys !== null && sys !== o.sys) r.samples.length = 0;
    if (sys !== null) o.sys = sys;
    // Корпус и щит — не в снимок движения, а прямо в ответ: между двумя
    // снимками они не «интерполируются», они просто такие, какие есть.
    if (Number.isFinite(p.hull)) o.hull = p.hull;
    if (Number.isFinite(p.hmax)) o.hullMax = p.hmax;
    if (Number.isFinite(p.sh)) o.shield = p.sh;
    if (Number.isFinite(p.smax)) o.shieldMax = p.smax;
    o.by = num(p.by);
    o.dorm = !!p.dorm;
    o.gear.out = !!(num(p.g) > 0.5);
    o.hatches = Array.isArray(p.h) ? p.h.filter((s) => typeof s === 'string') : [];
    o.lift = num(p.k) ?? 0;
    o.type = typeof p.ty === 'string' && p.ty ? p.ty : null;
    // Прицел берёт корабль по половине его корпуса — у «Прометея» она втрое
    // больше, и радиус приезжает с его типом.
    const ts = typeSpec(o.type);
    o.radius = ts && ts.hitRadius > 0 ? ts.hitRadius : SHIP.hitRadius;
    o.pilot = num(p.pilot);
    o.body = local ? b : null;
    r.seen = now;
    r.samples.push(local ? {
      t: now, b, x: lx, y: ly, z: lz,
      v: num(p.v) ?? 0,
      fwd: dir(p.lfx, p.lfy, p.lfz, FWD),
      up: dir(p.lux, p.luy, p.luz, UP),
    } : {
      t: now, b: null, x, y, z,
      v: num(p.v) ?? 0,
      fwd: dir(p.fx, p.fy, p.fz, FWD),
      up: dir(p.ux, p.uy, p.uz, UP),
    });
    if (r.samples.length > KEEP) r.samples.shift();
  }
  for (const [id, r] of store.by) {
    if (now - r.seen > PEER_TTL) store.by.delete(id);
  }
  return store;
}

/** Убрать корабль сразу — по сообщению об уходе, не дожидаясь PEER_TTL. */
export function dropPeer(store, id) {
  store.by.delete(id);
}

const _r = v3();

/**
 * Положение и ориентация всех видимых кораблей на момент now.
 *
 * @param world мир — по нему точки в осях тела становятся мировыми. Без
 *   него (или без тела в нём) такие корабли не показываются: тело не той
 *   системы — значит, и корабль не здесь.
 */
export function peerPoses(store, now, out = [], world = null) {
  out.length = 0;
  const t = now - PEER_DELAY;
  for (const r of store.by.values()) {
    if (now - r.seen > PEER_TTL || !r.samples.length) continue;
    if (!poseAt(r, t, world)) continue;
    out.push(r.out);
  }
  return out;
}

const _B = makeBasis();
const _lp = v3(), _lf = v3(), _lu = v3(), _lv = v3();

/** Тело по номеру в мире — или null. */
const bodyById = (world, id) => {
  if (!world || id === null) return null;
  const list = world.bodies;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
};

function poseAt(r, t, world) {
  const s = r.samples;
  const o = r.out;
  o.name = r.name;
  o.mode = r.mode;
  const last = s[s.length - 1];
  // Опорный кадр — последнего снимка. Снимки в разных осях (корабль ушёл
  // от тела в пустоту) между собой не смешиваются: берётся последний.
  const frameB = last.b;
  const body = frameB === null ? null : bodyById(world, frameB);
  if (frameB !== null && !body) return false;

  let a = last, b = last, k = 0, ahead = 0;
  if (s.length > 1 && t > s[0].t && s[s.length - 2].b === frameB) {
    if (t >= last.t) {
      // Снимок опоздал — идём дальше по последней известной скорости.
      a = s[s.length - 2];
      b = last;
      const dt = b.t - a.t;
      ahead = Math.min(t - last.t, PEER_AHEAD);
      k = dt > 1e-3 ? 1 + ahead / dt : 1;
    } else {
      let i = s.length - 1;
      while (i > 0 && s[i - 1].t > t) i--;
      a = s[i - 1]; b = s[i];
      if (a.b !== frameB) { a = b; k = 0; } else {
        const span = b.t - a.t;
        k = span > 1e-6 ? (t - a.t) / span : 0;
      }
    }
  } else if (t <= s[0].t) {
    // Корабль только появился: истории нет, и честнее поставить его туда,
    // где он есть, чем не показать вовсе.
    a = b = s[0].b === frameB ? s[0] : last;
  }

  set(_lp, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
  const kk = Math.min(1, k);
  lerp3(a.fwd, b.fwd, kk, _lf);
  lerp3(a.up, b.up, kk, _lu);
  const span = b.t - a.t;
  if (span > 1e-6) set(_lv, (b.x - a.x) / span, (b.y - a.y) / span, (b.z - a.z) / span);
  else set(_lv, 0, 0, 0);
  o.v = a.v + (b.v - a.v) * kk;

  if (body) {
    // Оси тела — на СЕЙЧАС: тело повернулось, и корабль с ним.
    bodyBasis(body, _B);
    toWorld(_B, body.pos, _lp, o.pos);
    dirToWorld(_B, _lv, o.vel);
    dirToWorld(_B, _lf, _tmpF);
    dirToWorld(_B, _lu, _tmpU);
    setBasis(o.basis, _tmpF, _tmpU);
  } else {
    set(o.pos, _lp.x, _lp.y, _lp.z);
    set(o.vel, _lv.x, _lv.y, _lv.z);
    // Оси тянем покомпонентно и ортонормализуем: поворот между снимками
    // мал, и разница с честным поворотом по дуге меньше, чем толщина
    // корпуса на экране.
    setBasis(o.basis, _lf, _lu);
  }
  return true;
}

const _tmpF = v3();
const _tmpU = v3();

const lerp3 = (a, b, k, out) =>
  set(out, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);

/** Тройка осей из «куда смотрит» и «где верх». */
function setBasis(basis, fwd, up) {
  normalize(fwd, basis.fwd);
  // right = cross(up, fwd): система правая, fwd = cross(right, up).
  cross(up, basis.fwd, _r);
  if (!(Math.hypot(_r.x, _r.y, _r.z) > 1e-6)) {
    // Верх совпал с направлением полёта — крен неизвестен, берём любой
    // перпендикуляр: корабль хотя бы смотрит куда надо.
    set(_r, basis.fwd.y, -basis.fwd.x, 0);
    if (!(Math.hypot(_r.x, _r.y, _r.z) > 1e-6)) set(_r, 1, 0, 0);
  }
  normalize(_r, basis.right);
  orthonormalize(basis);
  return basis;
}

// --- люди --------------------------------------------------------------------------

export const makePeople = () => ({ by: new Map() });

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Принять снимок людей (Hub, people). Как и у кораблей — только новый.
 *
 * Где стоит человек — в осях того, на чём он стоит: палубы корабля
 * (st 'seat'|'walk', поле s — номер корабля, x..z — метры) или грунта
 * тела (st 'out', поле b — номер тела, lx..lz — километры, lf* — куда
 * смотрит). Сменил опору (сошёл по трапу) — история сбрасывается:
 * тянуть точку из осей корабля в оси тела бессмысленно.
 */
export function ingestPeople(store, list, now) {
  for (const p of Array.isArray(list) ? list : []) {
    const id = num(p && p.id);
    const st = p && typeof p.st === 'string' ? p.st : null;
    if (id === null || !st) continue;
    const out = st === 'out';
    const where = out ? num(p.b) : num(p.s);
    const x = num(out ? p.lx : p.x), y = num(out ? p.ly : p.y), z = num(out ? p.lz : p.z);
    if (where === null || x === null || y === null || z === null) continue;
    let r = store.by.get(id);
    if (!r) {
      r = { id, seen: 0, samples: [], out: {
        id, name: '', st, ship: null, body: null,
        p: [0, 0, 0], yaw: 0, pitch: 0, face: { x: 0, y: 0, z: 1 },
        v: 0, air: false, phase: 0, t: null,
      } };
      store.by.set(id, r);
    }
    const key = st + ':' + where;
    if (r.key !== key) { r.samples.length = 0; r.key = key; }
    if (typeof p.name === 'string' && p.name) r.out.name = p.name;
    r.seen = now;
    r.samples.push({
      t: now, st, where, x, y, z,
      yaw: num(p.yaw) ?? 0, pitch: num(p.pitch) ?? 0,
      face: out ? dir(p.lfx, p.lfy, p.lfz, FWD) : null,
      v: num(p.v) ?? 0, air: !!p.air,
    });
    if (r.samples.length > KEEP) r.samples.shift();
  }
  for (const [id, r] of store.by) {
    if (now - r.seen > PEER_TTL) store.by.delete(id);
  }
  return store;
}

/** Убрать человека сразу — ушёл из игры. */
export const dropPerson = (store, id) => store.by.delete(id);

/**
 * Где люди на момент now: точка в осях опоры и взгляд, скорость шага и
 * фаза шага — её копим здесь, чтобы ноги шли ровно по пройденному пути.
 *
 * @param stride длина шага при скорости v, м (js/game/walker.js)
 */
export function peoplePoses(store, now, out = [], stride = () => 1) {
  out.length = 0;
  const t = now - PEER_DELAY;
  for (const r of store.by.values()) {
    if (now - r.seen > PEER_TTL || !r.samples.length) continue;
    const s = r.samples, o = r.out;
    let a = s[s.length - 1], b = a, k = 0;
    if (s.length > 1 && t > s[0].t) {
      if (t >= a.t) { a = s[s.length - 1]; b = a; }
      else {
        let i = s.length - 1;
        while (i > 0 && s[i - 1].t > t) i--;
        a = s[i - 1]; b = s[i];
        const span = b.t - a.t;
        k = span > 1e-6 ? (t - a.t) / span : 0;
      }
    } else if (t <= s[0].t) { a = b = s[0]; }
    o.st = b.st;
    o.ship = b.st === 'out' ? null : b.where;
    o.body = b.st === 'out' ? b.where : null;
    o.p[0] = a.x + (b.x - a.x) * k;
    o.p[1] = a.y + (b.y - a.y) * k;
    o.p[2] = a.z + (b.z - a.z) * k;
    o.yaw = a.yaw + wrapPi(b.yaw - a.yaw) * k;
    o.pitch = a.pitch + (b.pitch - a.pitch) * k;
    if (b.face) {
      const f = a.face || b.face;
      set(o.face, f.x + (b.face.x - f.x) * k, f.y + (b.face.y - f.y) * k, f.z + (b.face.z - f.z) * k);
      normalize(o.face, o.face);
    }
    o.v = a.v + (b.v - a.v) * k;
    o.air = b.air;
    // Фаза шага — по времени кадра, а не снимков: ноги идут непрерывно.
    const dt = o.t === null ? 0 : Math.max(0, Math.min(0.1, now - o.t));
    o.t = now;
    if (!o.air && o.v > 0.15) o.phase += o.v * dt / Math.max(0.1, stride(o.v));
    out.push(o);
  }
  return out;
}
