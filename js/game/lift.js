// Лифт: кабины одной шахты на разных палубах (у «Прометея» — в стволе
// башни, от мостика на палубе 1 до кормы на палубе 11, сорок метров).
//
// КАК ОН УСТРОЕН. Комнат-кабин столько, сколько остановок, и они
// одинаковы до вершины (js/models/interior.prom.js). Поездка — двери
// кабины закрываются, проходит время пути по разгону и скорости кабины,
// и пилот оказывается в кабине другой палубы на том же месте. Пока двери
// закрыты, видна только кабина (за закрытой дверью комнат не рисуют,
// js/models/interior.js, visibleNow), и подмены не видно.
//
// Почему не подвижный пол. Шахта глухая, смотреть в ней не на что, а
// кабина, которая едет, — это ещё одна система осей под ногами, сорок
// метров по вертикали со своим ускорением, и всё твёрдое на палубах
// пришлось бы спрашивать в двух осях. Поездка с закрытыми дверями
// выглядит и звучит так же.
//
// Двери остановок на время поездки заперты (door.lock): у отправления —
// чтобы закрылись и не открылись, пока пилот стоит рядом, у прибытия — до
// самого прибытия.
//
// НА СТАНЦИИ — тот же лифт (js/game/stationwalk.js): кабины у холлов
// площадок и в галерее, план — план станции, пешеход — на её полу (w.out
// с осями станции). Едет он и через зал, поэтому время в пути у него своё,
// по расстоянию (lift.time), а не по высоте шахты.

/** Дотянуться до пульта, м. */
export const LIFT = { near: 1.5 };

/** Лифт и остановка, в кабине которой комната roomId (или null). */
export function liftOf(I, roomId) {
  for (const L of (I && I.lifts) || []) {
    const i = L.stops.findIndex((s) => s.room === roomId);
    if (i >= 0) return { lift: L, stop: i };
  }
  return null;
}

/**
 * Время в пути, с: разгон до скорости кабины, ход и торможение —
 * трапеция скорости (у короткой поездки — треугольник).
 */
export function rideTime(L, dy) {
  const d = Math.abs(dy), v = L.speed, a = L.accel;
  if (d <= v * v / a) return 2 * Math.sqrt(d / a);
  return 2 * v / a + (d - v * v / a) / v;
}

/** Куда ехать из остановки from: следующая палуба (у двух остановок — другая). */
export const nextStop = (L, from) => (from + 1) % L.stops.length;

/**
 * Можно ли нажать пульт: пилот в кабине, на ногах, рукой до пульта.
 * @returns { lift, stop, to } или null
 */
export function panelNear(w, I) {
  if (!w.on || w.phase !== 'walk' || (w.out && !w.out.stn) || w.ride || !w.room) return null;
  const at = liftOf(I, w.room.id);
  if (!at) return null;
  // Ехать — только целиком в кабине: стоявшего в проёме закрывающиеся
  // створки зажали бы, а поездка перенесла бы его в стену другой кабины.
  const cab = I.roomById[at.lift.stops[at.stop].room];
  const m = 0.25;
  if (cab && (w.pos[0] < cab.lo[0] + m || w.pos[0] > cab.hi[0] - m || w.pos[2] < cab.lo[2] + m || w.pos[2] > cab.hi[2] - m)) return null;
  const p = at.lift.stops[at.stop].panel;
  const d = Math.hypot(w.pos[0] - p[0], w.pos[2] - p[2]);
  if (d > LIFT.near || Math.abs(w.pos[1] + 1.2 - p[1]) > 1.0) return null;
  return { ...at, to: nextStop(at.lift, at.stop) };
}

const doorOf = (I, id) => I.doors.find((d) => d.id === id) || null;

/** Поехать: двери остановок заперты, ждём, пока закроется своя. */
export function startRide(w, I, at) {
  const L = at.lift;
  const A = I.roomById[L.stops[at.stop].room], B = I.roomById[L.stops[at.to].room];
  const off = [B.lo[0] - A.lo[0], B.lo[1] - A.lo[1], B.lo[2] - A.lo[2]];
  for (const s of L.stops) {
    const d = doorOf(I, s.door);
    if (d) d.lock = true;
  }
  const T = L.time ? L.time(off) : rideTime(L, off[1]);
  w.ride = { lift: L, from: at.stop, to: at.to, off, t: 0, T, phase: 'close' };
  return w.ride;
}

/**
 * Шаг поездки.
 * @returns 'start' — двери закрылись, кабина тронулась; 'arrive' —
 *   приехали (пилот уже в кабине той палубы); null — ничего
 */
export function stepRide(w, I, dt) {
  const r = w.ride;
  if (!r) return null;
  if (r.phase === 'close') {
    const d = doorOf(I, r.lift.stops[r.from].door);
    if (d && d.open > 0) return null;
    r.phase = 'move';
    return 'start';
  }
  r.t += dt;
  if (r.t < r.T) return null;
  for (let k = 0; k < 3; k++) w.pos[k] += r.off[k];
  w.room = I.roomById[r.lift.stops[r.to].room];
  w.lag = 0;
  for (const s of r.lift.stops) {
    const d = doorOf(I, s.door);
    if (d) d.lock = false;
  }
  w.ride = null;
  return 'arrive';
}

/** Сколько ехать (0..1) — для приборов. */
export const rideFrac = (r) => (r && r.phase === 'move' ? Math.min(1, r.t / r.T) : 0);

/** Бросить поездку (сел, крушение, смена корабля): двери отперты. */
export function cancelRide(w, I) {
  if (!w.ride) return;
  for (const s of w.ride.lift.stops) {
    const d = I && doorOf(I, s.door);
    if (d) d.lock = false;
  }
  w.ride = null;
}
