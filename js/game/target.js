// Цель — одна на всю игру.
//
// В цели может быть тело, станция, город, орбитальная метка, пилот, NPC —
// или чужая система. Раньше целей было две: цель в системе (Tab, прыжок
// на B) и цель варпа (карта галактики, J). Выбранная звезда оставалась
// целью варпа навсегда — снять её было нечем, и J улетал к ней, что бы ни
// было выбрано потом.
//
// Теперь выбор новой цели заменяет прежнюю. Чужая система держится в
// game.warpTarget (с маршрутом game.warpRoute), и тогда цели в системе нет
// (nav.index = -1), — и наоборот. Цели может не быть вовсе. Прыгает к цели
// одна клавиша (J, и B — она же): к системе — варпом, к остальному —
// квантовым приводом (js/main.js, jumpKey).
//
// Поменялась цель — привод, калибровавшийся на прежнюю, останавливается:
// иначе он ушёл бы в прыжок туда, что уже не цель. Начатый прыжок не
// обрывается: его обрывает J.

import { refreshNav, currentTarget, clearNavTarget } from './nav.js';
import { stopQuantum } from './quantum.js';
import { stopWarp } from './warp.js';

/** Что в цели: система или то, что в системе, — или null. */
export const targetOf = (game) => game.warpTarget || currentTarget(game.nav);

/** Система больше не цель: центровка на неё — тоже. */
export function dropWarpTarget(game) {
  if (game.warp && game.warp.phase === 'align') stopWarp(game.warp);
  game.warpTarget = null;
  game.warpRoute = null;
}

/**
 * Взять в цель то, что в системе. Объект, а не номер: список целей
 * пересобирается на ходу. Маркер тела, рядом с которым корабль не
 * находится, в список не попадает — тогда встаём на само тело.
 *
 * @returns взяли ли (объекта может не оказаться в списке)
 */
export function selectTarget(game, t) {
  if (!t) return false;
  refreshNav(game.nav, game.world, game.ship, game.peers);
  let i = game.nav.list.indexOf(t);
  if (i < 0 && t.isMarker) i = game.nav.list.indexOf(t.body);
  if (i < 0) return false;
  const was = currentTarget(game.nav);
  game.nav.index = i;
  dropWarpTarget(game);
  const q = game.quantum;
  if (q && q.phase === 'calib' && was !== game.nav.list[i]) stopQuantum(q);
  game.lastTarget = game.nav.list[i];
  return true;
}

/**
 * Взять в цель чужую систему: hop — ближайший прыжок, route — номера
 * систем всего пути или null. Маршрут считает карта (js/ui/map.js).
 */
export function targetSystem(game, hop, route = null) {
  clearNavTarget(game.nav);
  if (game.quantum && game.quantum.phase === 'calib') stopQuantum(game.quantum);
  if (game.warp && game.warp.phase === 'align' && game.warp.to !== hop) stopWarp(game.warp);
  game.warpTarget = hop;
  game.warpRoute = route;
  game.lastTarget = null;
}

/** Снять цель — любую. Вернёт, была ли она. */
export function clearTarget(game) {
  const had = !!targetOf(game);
  clearNavTarget(game.nav);
  dropWarpTarget(game);
  if (game.quantum && game.quantum.phase === 'calib') stopQuantum(game.quantum);
  game.lastTarget = null;
  return had;
}
