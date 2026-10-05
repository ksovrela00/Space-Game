// Свои корабли на карте: где стоит каждый и как назвать это место.
//
// Кораблей у пилота может быть несколько: купил второй на верфи, пересел,
// оставил первый на грунте и ушёл пешком. Где они, знает сервер (player.
// state, fleet — server/src/Players.php), и карта (js/ui/map.js) по этим
// записям ставит значки и собирает список «МОИ КОРАБЛИ».
//
// Точка у записи — та же, что в базе: в порту — станция, на грунте и у
// тела — точка в ОСЯХ ТЕЛА, в пустоте — мировая. Оси тела переводятся в
// мир здесь, каждый кадр: тело вращается, и стоящий на грунте корабль
// едет вместе с ним — мировая точка из базы устарела бы за минуту.
//
// Свой корабль, которым пилот командует, — особый случай: его место
// живое (ship.pos), а запись сервера о нём отстаёт на сохранение. Поэтому
// у него и точка, и подпись — от самого корабля.
//
// Модуль ничего не рисует и не знает про карту — проверяется в Node.

import { v3, set } from '../core/vec3.js';
import { bodyWorld } from './vessels.js';
import { L } from '../core/lang.js';

const _l = { x: 0, y: 0, z: 0 };

/** Тело или станция системы по номеру — или null. */
function hostOf(world, id) {
  if (!world || id === null || id === undefined) return null;
  return world.bodies.find((b) => b.id === id) || world.stations.find((s) => s.id === id) || null;
}

/**
 * Где это: «В ПОРТУ Rior Station», «НА ГРУНТЕ Lave II», «У Lave II»,
 * «В ПУСТОТЕ». Название берётся из мира, а в чужой системе — у сервера
 * (bodyName): её состава игра не знает, пока туда не прилетит.
 */
export function placeText(where, hostName) {
  const name = hostName || '';
  if (where === 'docked') return L('В ПОРТУ ') + name;
  if (where === 'landed') return L('НА ГРУНТЕ ') + name;
  if (name) return L('У ') + name;
  return L('В ПУСТОТЕ');
}

/**
 * Значки своих кораблей: по записи на каждый корабль флота.
 *
 * Объект на корабль — один и тот же от кадра к кадру (cache): карта едет
 * за выбранным (map.follow), а это ссылка, и новый объект каждый кадр её
 * обрывал бы.
 *
 * @param fleet  записи сервера (game.fleet); пусто — пока не пришли
 * @param world  текущая система
 * @param sysId  её номер
 * @param own    свой корабль: { id, pos, away, dockedAt, landedAt, near,
 *               name, typeName } — его место живое
 * @returns [{ isFleet, id, name, typeName, active, here, pos, where,
 *            host, place, sysId, systemName }]
 */
export function fleetMarks(fleet, world, sysId, own, cache = new Map(), out = []) {
  out.length = 0;
  const list = Array.isArray(fleet) ? fleet.slice() : [];
  // Пока записи не пришли, флота нет, но свой корабль есть всегда — и в
  // списке он тоже должен быть с первого кадра.
  if (own && !list.some((f) => f.active || (own.id !== null && f.id === own.id))) {
    list.unshift({ id: own.id, active: true, name: own.name || '', typeName: own.typeName || '',
      systemId: sysId, where: 'flight', body: null });
  }
  for (const f of list) {
    // Вездеход в трюме — внутри своего корабля: значок у него один, носителя
    // (место у них общее, server/src/Players.php, carryAlong). Командуешь им —
    // значок живой, как у любого своего.
    if (f.stowed && !f.active && !(own && own.id !== null && f.id === own.id)) continue;
    const key = f.id === null || f.id === undefined ? 'own' : f.id;
    let m = cache.get(key);
    if (!m) {
      m = { isFleet: true, id: f.id, pos: v3(), name: '', typeName: '', active: false, here: false,
        where: 'flight', host: null, place: '', sysId: null, systemName: '' };
      cache.set(key, m);
    }
    m.active = !!f.active || (own && own.id !== null && f.id === own.id);
    m.typeName = f.typeName || (m.active && own ? own.typeName : '') || '';
    m.name = f.name || m.typeName || L('КОРАБЛЬ');
    m.sysId = typeof f.systemId === 'number' ? f.systemId : null;
    m.systemName = f.systemName || '';
    m.here = false;
    m.host = null;
    m.where = f.where || 'flight';

    if (m.active && own && !own.away) {
      // Живой: где корабль сейчас, а не где его записал сервер.
      m.here = true;
      m.sysId = sysId;
      set(m.pos, own.pos.x, own.pos.y, own.pos.z);
      m.host = own.dockedAt || own.landedAt || own.near || null;
      m.where = own.dockedAt ? 'docked' : (own.landedAt ? 'landed' : 'flight');
      m.place = placeText(m.where, m.host ? m.host.name : '');
    } else if (m.sysId === sysId && world) {
      const host = hostOf(world, f.body);
      m.host = host;
      if (m.where === 'docked' && host) {
        m.here = true;
        set(m.pos, host.pos.x, host.pos.y, host.pos.z);
      } else if (f.point && host && host.isBody) {
        _l.x = f.point.x; _l.y = f.point.y; _l.z = f.point.z;
        bodyWorld(host, _l, m.pos);
        m.here = true;
      } else if (f.pos) {
        set(m.pos, f.pos.x, f.pos.y, f.pos.z);
        m.here = true;
      }
      m.place = placeText(m.where, host ? host.name : f.bodyName);
    } else {
      m.place = placeText(m.where, f.bodyName);
    }
    if (!m.here && m.systemName) m.place += ' · ' + m.systemName.toUpperCase();
    out.push(m);
  }
  // Выбывшие из флота (продан) — из кэша вон.
  for (const k of cache.keys()) if (!list.some((f) => (f.id ?? 'own') === k)) cache.delete(k);
  return out;
}
