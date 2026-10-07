// Маршрут по галактике: через какие системы лететь, если прямого прыжка нет.
// (Не путать с js/game/route.js — тот ведёт пилота по палубам корабля.)
//
// Варп стоит топлива по световым годам (SHIP.warpFuel), а резерв бака он не
// трогает (js/game/warp.js, canWarp). Значит, у прыжка есть предел — то, на
// что хватает полного бака сверх резерва: на заводском баке 21.6 св. года
// (README, «Приводы»). Дальше напрямую не долететь, и к дальней системе идут
// через соседей, заправляясь в каждом порту. Эти пары и есть дороги карты
// галактики.
//
// Маршрут — кратчайший по сумме световых лет (это и есть топливо), а среди
// равных — с меньшим числом прыжков. Систем семь: перебор Дейкстрой без
// кучи — микросекунды.
//
// Без мира и без рендера: проверяется в Node (tools/test.mjs).

import { galaxy, systemDistance, warpSeconds } from './galaxy.js';
import { SHIP } from './ship.js';
import { fuelCap, fuelReserve, warpRange } from './fuel.js';

/** Предел одного прыжка на ПОЛНОМ баке сверх резерва, св. лет. */
export const hopLimit = () =>
  (SHIP.warpFuel > 0 ? Math.max(0, fuelCap() - fuelReserve()) / SHIP.warpFuel : 0);

/** Дальность прыжка с тем, что в баке сейчас, св. лет. */
export const rangeNow = (ship) => warpRange(ship);

/**
 * Кратчайший путь от from до to прыжками не длиннее maxHop.
 *
 * @returns {{ path: [system], ly: number, hops: number, secs: number } | null}
 *          null — не добраться (или from === to)
 */
export function planRoute(from, to, maxHop, systems = galaxy().systems) {
  if (!from || !to || from.seed === to.seed) return null;
  const n = systems.length;
  const idx = new Map(systems.map((s, i) => [s.seed, i]));
  const a = idx.get(from.seed), b = idx.get(to.seed);
  if (a === undefined || b === undefined) return null;
  const dist = new Array(n).fill(Infinity), hops = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  dist[a] = 0; hops[a] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (done[i] || dist[i] === Infinity) continue;
      if (u < 0 || dist[i] < dist[u] - 1e-9 || (Math.abs(dist[i] - dist[u]) <= 1e-9 && hops[i] < hops[u])) u = i;
    }
    if (u < 0 || u === b) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u) continue;
      const d = systemDistance(systems[u], systems[v]);
      if (d > maxHop + 1e-9) continue;
      const nd = dist[u] + d, nh = hops[u] + 1;
      if (nd < dist[v] - 1e-9 || (Math.abs(nd - dist[v]) <= 1e-9 && nh < hops[v])) {
        dist[v] = nd; hops[v] = nh; prev[v] = u;
      }
    }
  }
  if (dist[b] === Infinity) return null;
  const path = [];
  for (let v = b; v >= 0; v = prev[v]) path.unshift(systems[v]);
  let secs = 0;
  for (let i = 1; i < path.length; i++) secs += warpSeconds(path[i - 1], path[i]);
  return { path, ly: dist[b], hops: path.length - 1, secs };
}

/**
 * Дороги галактики: все пары систем, между которыми прыжок на полном баке
 * возможен. Каждая пара — один раз.
 */
export function roads(maxHop, systems = galaxy().systems, out = []) {
  out.length = 0;
  for (let i = 0; i < systems.length; i++) {
    for (let j = i + 1; j < systems.length; j++) {
      const d = systemDistance(systems[i], systems[j]);
      if (d <= maxHop + 1e-9) out.push({ a: systems[i], b: systems[j], ly: d });
    }
  }
  return out;
}

/**
 * Следующий прыжок по маршруту из системы here: система, за которой в
 * маршруте идёт следующая, или null — here не на маршруте или это его
 * конец. Маршрут — список номеров систем (id), как его хранит игра.
 */
export function nextHop(route, here, systems = galaxy().systems) {
  if (!route || !here) return null;
  const i = route.indexOf(here.id);
  if (i < 0 || i >= route.length - 1) return null;
  return systems.find((s) => s.id === route[i + 1]) || null;
}
