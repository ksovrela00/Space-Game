// Дорога по кораблю: из помещения, где пилот, в нужное — через двери,
// проёмы, трапы и лифт (js/models/interior.js, js/game/lift.js).
//
// ЗАЧЕМ. У «Челленджера» помещений полтора десятка, и заблудиться в них
// негде. У «Прометея» — полторы сотни на тринадцати палубах, и из каюты
// на палубе 8 к креслу командира ведёт коридор, холл, лифт на семь палуб
// вверх и ещё холл. Поэтому у пилота есть план палубы (js/ui/deckmap.js)
// и путь: метка следующей точки в кадре — дверь, проём трапа или пульт
// лифта (там же и палуба, на которую ехать).
//
// Путь — кратчайший по числу переходов (поиск в ширину по графу
// помещений). Переход — дверь, проём или поездка на лифте; поездка любой
// длины — один переход: дольше ехать, но не идти.

/** Ярус помещения: у «Прометея» — номер палубы, у «Челленджера» — по полу. */
export function deckOf(room) {
  if (!room) return '';
  if (room.deck) return room.deck;
  if (room.id === 'bridge') return 'ЯРУС РУБКИ';
  if (room.id === 'lockS') return 'ПАЛУБА ГОНДОЛ';
  if (room.lo[1] < -7) return 'НИЖНЯЯ ПАЛУБА';
  if (room.lo[1] < -3) return 'СРЕДНЯЯ ПАЛУБА';
  return 'ЯРУС РУБКИ';
}

/** Ярусы корабля сверху вниз: [{ deck, floor, rooms }]. */
export function decksOf(I) {
  if (I._decks) return I._decks;
  const by = new Map();
  // Шахта трапа на несколько палуб («Прометей», ПАЛУБЫ 11–13) своей
  // палубой не считается: она — на плане каждой, через которую идёт.
  const spans = I.rooms.filter((r) => r.kind === 'shaft' && r.deck && /–/.test(r.deck));
  for (const r of I.rooms) {
    if (spans.includes(r)) continue;
    const d = deckOf(r);
    if (!by.has(d)) by.set(d, { deck: d, floor: r.lo[1], rooms: [] });
    const e = by.get(d);
    e.rooms.push(r);
    // Пол яруса — самый частый: шахта трапа на двух ярусах сразу его не сдвигает.
    if (r.kind !== 'shaft') e.floor = Math.min(e.floor, r.lo[1]);
  }
  for (const r of spans) {
    for (const e of by.values()) if (e.floor >= r.lo[1] - 0.1 && e.floor <= r.hi[1]) e.rooms.push(r);
  }
  const out = [...by.values()].sort((a, b) => b.floor - a.floor);
  for (const e of out) e.rooms.sort((a, b) => (b.hi[2] + b.lo[2]) - (a.hi[2] + a.lo[2]) || a.lo[0] - b.lo[0]);
  I._decks = out;
  return out;
}

/** Граф помещений: рёбра — двери, проёмы и лифт (кешируется на планировке). */
export function graphOf(I) {
  if (I._graph) return I._graph;
  const adj = new Map(I.rooms.map((r) => [r.id, []]));
  const add = (a, b, e) => { if (adj.has(a) && adj.has(b)) adj.get(a).push({ to: b, ...e }); };
  for (const d of I.doors) {
    add(d.rooms[0], d.rooms[1], { door: d });
    add(d.rooms[1], d.rooms[0], { door: d });
  }
  for (const o of I.openings || []) {
    add(o.a, o.b, { open: o });
    add(o.b, o.a, { open: o });
  }
  for (const L of I.lifts || []) {
    for (const a of L.stops) for (const b of L.stops) if (a !== b) add(a.room, b.room, { lift: L, stop: L.stops.indexOf(b) });
  }
  I._graph = adj;
  return adj;
}

/** Переходы из помещения a в b (кратчайший путь) или null. */
export function pathRooms(I, a, b) {
  if (a === b) return [];
  const adj = graphOf(I);
  const prev = new Map([[a, null]]);
  const q = [a];
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c === b) break;
    for (const e of adj.get(c) || []) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, { from: c, e });
      q.push(e.to);
    }
  }
  if (!prev.has(b)) return null;
  const out = [];
  for (let c = b; prev.get(c); c = prev.get(c).from) out.push({ from: prev.get(c).from, ...prev.get(c).e });
  return out.reverse();
}

/** Середина проёма между помещениями A и B (оси корабля, м, на полу). */
function openingPoint(I, o) {
  const A = I.roomById[o.a], B = I.roomById[o.b];
  if (o.ceil) return [(o.x[0] + o.x[1]) / 2, A.hi[1], (o.z[0] + o.z[1]) / 2];
  for (const ax of [0, 2]) {
    for (const [p, q] of [[A.hi[ax], B.lo[ax]], [B.hi[ax], A.lo[ax]]]) {
      if (Math.abs(p - q) > 0.61) continue;
      const pt = [0, o.y ? o.y[0] : Math.max(A.lo[1], B.lo[1]), 0];
      pt[ax] = (p + q) / 2;
      pt[ax === 0 ? 2 : 0] = (o.u[0] + o.u[1]) / 2;
      return pt;
    }
  }
  return [(A.lo[0] + A.hi[0]) / 2, A.lo[1], (A.lo[2] + A.hi[2]) / 2];
}

/** Куда идти по переходу e (оси корабля, м, на полу). */
export function stepPoint(I, e) {
  if (e.door) return [e.door.pos[0], e.door.pos[1], e.door.pos[2]];
  if (e.open) return openingPoint(I, e.open);
  // Лифт: к пульту своей кабины.
  const st = e.lift.stops.find((s) => s.room === e.from);
  return [st.panel[0] - 0.6, st.panel[1] - 1.2, st.panel[2]];
}

/** Точка в помещении, куда ведёт путь: у кресла — к креслу, иначе — середина. */
export function goalPoint(I, roomId) {
  if (I.seat && (I.seat.room || 'bridge') === roomId) return I.seat.stand.slice();
  const r = I.roomById[roomId];
  return [(r.lo[0] + r.hi[0]) / 2, r.lo[1], (r.lo[2] + r.hi[2]) / 2];
}

/**
 * Путь от пилота к цели.
 * @param pos ноги пилота (оси корабля, м); room — его помещение
 * @returns { steps, next: { point, kind, label, stop }, dist, here } или null
 */
export function routeTo(I, room, pos, goal) {
  if (!room || !I.roomById[goal]) return null;
  const steps = pathRooms(I, room.id, goal);
  if (!steps) return null;
  const end = goalPoint(I, goal);
  const pts = steps.filter((e) => !e.lift).map((e) => stepPoint(I, e));
  let dist = 0, prev = pos;
  for (const p of [...pts, end]) { dist += Math.hypot(p[0] - prev[0], p[2] - prev[2], (p[1] - prev[1]) * 1.5); prev = p; }
  const first = steps[0];
  let next;
  if (!first) {
    next = { point: end, kind: 'goal', to: goal };
  } else if (first.lift) {
    next = { point: stepPoint(I, first), kind: 'lift', to: first.to, stop: first.stop, lift: first.lift };
  } else {
    next = { point: stepPoint(I, first), kind: first.door ? 'door' : 'open', to: first.to };
  }
  return { steps, next, dist, here: !first, end };
}
