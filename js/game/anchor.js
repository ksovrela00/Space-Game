// Где корабль стоял ОТНОСИТЕЛЬНО ТЕЛА.
//
// Мировые координаты корабля верны ровно до тех пор, пока никто не
// двигает под ним планету. А её двигают: время мира задаёт сервер
// (js/game/clock.js, server/src/Clock.php), и при входе в игру мир
// ставится на СЕЙЧАС, а корабль — туда, где он был в момент записи.
// Между этими двумя моментами проходит сколько угодно: минута до
// обновления страницы или неделя до следующего вечера.
//
// Стоит это дорого, и вот сколько. У Lave IV сутки 16.9 часа, грунт на
// экваторе идёт 269 м/с: за минуту он уезжает на 14 км, за час на 842, а
// за сутки на пять тысяч. Отсюда обе беды, которые видно в игре: у самой
// поверхности корабль при входе оказывается внутри рельефа и гибнет, а с
// двух десятков километров город обнаруживается на другой стороне
// планеты.
//
// Поэтому место в полёте хранится ТАК ЖЕ, как стоянка на грунте
// (ship.landedPose): в осях тела. Тогда время между выходом и входом не
// значит ничего — корабль возвращается туда, откуда ушёл.
//
// Оси берутся ВРАЩАЮЩИЕСЯ, вместе с суточным ходом, хотя в полёте
// вращение переносится целиком только у самой земли (js/game/gravity.js,
// spinCarry). Это решение, а не недосмотр: вход в игру — не продолжение
// полёта, а возвращение туда, где встал. Над той же точкой грунта, а не
// над той же точкой пустоты; садился пилот над городом — над городом и
// появится.
//
// Запись приходит из чужих рук — из localStorage или от сервера, —
// поэтому проверяется вся: числа конечные, оси не выродившиеся. Кривая
// запись здесь означала бы корабль в NaN, то есть чёрный экран.

import { v3 } from '../core/vec3.js';
import { makeBasis, toLocal, toWorld, dirToWorld, lookAlong } from '../core/basis.js';
import { bodyBasis } from './world.js';

const _b = makeBasis();
const _zero = v3();
const _fwd = v3();
const _up = v3();

const finite = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
  && Number.isFinite(p.z);
const unitish = (p) => finite(p) && Math.abs(Math.hypot(p.x, p.y, p.z) - 1) < 1e-3;

/**
 * Снять место и разворот корабля в осях тела.
 *
 * @param body тело захвата (js/game/gravity.js, captureBody) или null
 * @returns {id, pos, fwd, up} или null, если тела рядом нет
 */
export function shipAnchor(body, ship) {
  if (!body || !ship || !finite(ship.pos)) return null;
  bodyBasis(body, _b);
  return {
    id: body.id,
    pos: toLocal(_b, body.pos, ship.pos, v3()),
    fwd: toLocal(_b, _zero, ship.basis.fwd, v3()),
    up: toLocal(_b, _zero, ship.basis.up, v3()),
  };
}

/** Годится ли запись на то, чтобы по ней ставить корабль. */
export const anchorOk = (rec) => !!rec && finite(rec.pos)
  && unitish(rec.fwd) && unitish(rec.up);

/**
 * Обратно: где этот якорь сейчас в мире.
 *
 * @returns {pos, basis} или null, если запись негодная
 */
export function anchorPose(body, rec, out = null) {
  if (!body || !anchorOk(rec)) return null;
  const o = out || { pos: v3(), basis: makeBasis() };
  bodyBasis(body, _b);
  toWorld(_b, body.pos, rec.pos, o.pos);
  dirToWorld(_b, rec.fwd, _fwd);
  dirToWorld(_b, rec.up, _up);
  lookAlong(o.basis, _fwd, _up);
  return o;
}
