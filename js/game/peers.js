// Чужие корабли: из редких снимков — в движение, на которое можно смотреть.
//
// Сокет присылает положение чужих пилотов пять раз в секунду (Hub::TICK),
// а кадров рисуется шестьдесят. Показывать последнее присланное нельзя:
// корабль поедет пятью скачками в секунду, и на сближении это читается не
// как полёт, а как подвисание сети.
//
// Поэтому снимки копятся, а картинка ОТСТАЁТ от них на PEER_DELAY и идёт
// по двум соседним снимкам. Плата честная: чужой корабль всегда там, где
// он был четверть секунды назад, а не где он сейчас. Для стрельбы так
// нельзя, для «вижу, кто летит рядом» — незаметно, а рывки заметны сразу.
//
// Модуль не знает ни про сокет, ни про рендер: на входе список от
// сервера, на выходе — положение и ориентация на любой момент времени.
// Поэтому он проверяется в Node целиком (tools/test.mjs), без сети и
// без браузера.

import { v3, set, cross, normalize } from '../core/vec3.js';
import { makeBasis, orthonormalize } from '../core/basis.js';

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
      id, name: '', mode: 'flight', v: 0,
      pos: v3(), vel: v3(), basis: makeBasis(),
      // Чужой корабль — такая же цель, как станция: его выбирают носом
      // по Tab и по нему же считают дистанцию (js/game/nav.js). Радиус —
      // половина корпуса: прицел, стоящий на корабле, обязан его брать.
      isPeer: true, radius: 0.035,
      // Корпус и щит соседа: их считает сервер и шлёт в каждом снимке,
      // а рисуются они полосками у его метки (js/ui/hud.js).
      hull: 0, hullMax: 0, shield: 0, shieldMax: 0,
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
    const x = num(p && p.x), y = num(p && p.y), z = num(p && p.z);
    if (id === null || x === null || y === null || z === null) continue;

    let r = store.by.get(id);
    if (!r) { r = record(id); store.by.set(id, r); }
    if (typeof p.name === 'string' && p.name) r.name = p.name;
    if (typeof p.mode === 'string' && p.mode) r.mode = p.mode;
    // Корпус и щит — не в снимок движения, а прямо в ответ: между двумя
    // снимками они не «интерполируются», они просто такие, какие есть.
    if (Number.isFinite(p.hull)) r.out.hull = p.hull;
    if (Number.isFinite(p.hmax)) r.out.hullMax = p.hmax;
    if (Number.isFinite(p.sh)) r.out.shield = p.sh;
    if (Number.isFinite(p.smax)) r.out.shieldMax = p.smax;
    r.seen = now;
    r.samples.push({
      t: now, x, y, z,
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

/** Убрать пилота сразу — по сообщению об уходе, не дожидаясь PEER_TTL. */
export function dropPeer(store, id) {
  store.by.delete(id);
}

const _r = v3();

/** Положение и ориентация всех видимых пилотов на момент now. */
export function peerPoses(store, now, out = []) {
  out.length = 0;
  const t = now - PEER_DELAY;
  for (const r of store.by.values()) {
    if (now - r.seen > PEER_TTL || !r.samples.length) continue;
    poseAt(r, t);
    out.push(r.out);
  }
  return out;
}

function poseAt(r, t) {
  const s = r.samples;
  const o = r.out;
  o.name = r.name;
  o.mode = r.mode;

  const last = s[s.length - 1];
  if (s.length === 1 || t <= s[0].t) {
    // Пилот только появился: истории нет, и честнее поставить его туда,
    // где он есть, чем не показать вовсе.
    const a = t <= s[0].t ? s[0] : last;
    set(o.pos, a.x, a.y, a.z);
    set(o.vel, 0, 0, 0);
    o.v = a.v;
    setBasis(o.basis, a.fwd, a.up);
    return;
  }

  if (t >= last.t) {
    // Снимок опоздал — идём дальше по последней известной скорости.
    const prev = s[s.length - 2];
    const dt = last.t - prev.t;
    const ahead = Math.min(t - last.t, PEER_AHEAD);
    const k = dt > 1e-3 ? ahead / dt : 0;
    set(o.pos,
      last.x + (last.x - prev.x) * k,
      last.y + (last.y - prev.y) * k,
      last.z + (last.z - prev.z) * k);
    setVel(o.vel, prev, last);
    o.v = last.v;
    setBasis(o.basis, last.fwd, last.up);
    return;
  }

  let i = s.length - 1;
  while (i > 0 && s[i - 1].t > t) i--;
  const a = s[i - 1], b = s[i];
  const span = b.t - a.t;
  const k = span > 1e-6 ? (t - a.t) / span : 0;
  set(o.pos, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
  setVel(o.vel, a, b);
  o.v = a.v + (b.v - a.v) * k;
  // Оси тянем покомпонентно и ортонормализуем: поворот между снимками
  // мал, и разница с честным поворотом по дуге меньше, чем толщина
  // корпуса на экране.
  setBasis(o.basis,
    lerp3(a.fwd, b.fwd, k, _tmpF),
    lerp3(a.up, b.up, k, _tmpU));
}

const _tmpF = v3();
const _tmpU = v3();

/** Скорость между двумя снимками, км/с. */
function setVel(out, a, b) {
  const dt = b.t - a.t;
  if (!(dt > 1e-6)) return set(out, 0, 0, 0);
  return set(out, (b.x - a.x) / dt, (b.y - a.y) / dt, (b.z - a.z) / dt);
}

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
