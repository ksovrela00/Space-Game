// Шлюзы: давление, люки и выдвижные трапы.
//
// Люков на корпусе четыре (js/models/interior.js, HATCHES): два у носа по
// бортам — из носового шлюза, два на внешних стенках гондол — из
// бортового. У шлюза одна внутренняя дверь (DOORS, lock) и два люка
// наружу; открыть люк можно где угодно — на грунте, в полёте, в пустоте:
// шлюз — это не «выход на стоянке», а камера между двумя средами.
//
// ПОРЯДОК, а не анимация. Открыть люк — это три шага, и ни один не
// начинается, пока не кончился предыдущий:
//
//   1. давление в шлюзе сравнялось с забортным (в пустоте — стравлено до
//      нуля, в воздухе планеты — до её давления на этой высоте): перепад
//      не выбивает панель;
//   2. панель люка отходит наружу и уезжает вдоль борта;
//   3. выдвигается трап.
//
// Закрыть — тот же путь назад: трап, люк и наддув до давления корабля.
//
// ДВЕРЬ В КОРАБЛЬ ШЛЮЗ НЕ ЗАПИРАЕТ. Пилот всегда в скафандре: давление в
// корабле ему не помеха, и запертая дверь только держала бы его в шлюзе,
// пока открыт люк.
//
// ДАВЛЕНИЕ — ПО ПОМЕЩЕНИЯМ. У каждого своё; открытые проёмы и двери
// связывают их в отсеки, и воздух перетекает туда, где его меньше. Люк
// открыт — шлюз под забортным давлением; открылась дверь из шлюза —
// уходит воздух всего, что за ней связано проёмами, а за закрытой дверью
// он остаётся. Отсек, закрытый от забортного (люк задраен или дверь
// закрылась), корабль наддувает сам: шлюз — своим насосом, остальное —
// жизнеобеспечение.
//
// ТРАП. Корабль на шасси стоит высоко: порог носового люка — в 4.8 м над
// грунтом, бортового — в 5.7. Трап — жёсткий марш со ступенями по 20 см
// и уклоном 40° (как у трапов самолётов: круче лестницы в доме, положе
// стремянки); на ровной площадке его нижний конец ложится на грунт ровно
// там, где кончается последний подъём. На неровной — трап доворачивается
// на петле у порога, пока пята не встанет на землю (в пределах ±15°).
// Корабль висит выше — трап висит в воздухе; сойти с него можно, если до
// земли не больше двух метров: дальше прыжок, а не шаг.
//
// Всё здесь — в осях корабля и метрах, без единого обращения к миру:
// забортное давление, грунт и запреты приходят снаружи (env), из
// js/main.js. Поэтому шлюз проверяется в Node целиком.

export const AIR = {
  rate: 0.5,           // бар/с — насос шлюза: стравливание и наддув (полная атмосфера — две секунды)
  supply: 0.05,        // бар/с — жизнеобеспечение: наддув остальных помещений (из пустоты — двадцать секунд)
  flow: 119,           // м³/с на м² проёма и бар перепада — истечение воздуха (см. breathe)
  hatchTime: 1.6,      // с — ход панели люка: отход наружу и сдвиг вдоль борта
  stairTime: 2.6,      // с — трап: выезд из-под пола и поворот вниз
  rise: 0.2,           // м — подъём ступени трапа
  slope: 40,           // ° — уклон трапа на ровной площадке
  half: 0.7,           // м — полуширина марша
  rail: 1.0,           // м — поручень над ступенью
  swing: 0.26,         // рад — насколько трап доворачивается к грунту (±15°)
  drop: 2.0,           // м — с какой высоты с конца трапа можно сойти
  near: 1.6,           // м — дотянуться до пульта люка
  slide: 0.22,         // м — панель отходит от борта перед сдвигом
  cabin: 1.0,          // бар — давление в корабле
};

const smooth = (t) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };

/**
 * Трап люка по высоте порога над грунтом на ровной площадке (м): число
 * подъёмов, подъём, проступь и пята — точка, где последний подъём
 * встречает землю (в осях трапа: x — наружу от обшивки, y — вверх от
 * порога).
 */
export function stairDesign(drop) {
  const n = Math.max(2, Math.round(drop / AIR.rise));
  const r = drop / n;
  const t = r / Math.tan(AIR.slope * Math.PI / 180);
  const foot = [(n - 1) * t, -n * r];
  return { n, r, t, foot, len: Math.hypot(foot[0], foot[1]), alpha: Math.atan2(-foot[1], foot[0]) };
}

/**
 * Состояние шлюзов своего корабля — на помещения (interior.air).
 * @param gearClear высота центра корабля над грунтом на шасси, км (SHIP.gearClear)
 */
export function makeAirlocks(I, gearClear) {
  I.air = makeAir(I, gearClear);
  return I.air;
}

/**
 * Состояние шлюзов ОДНОГО корабля: люки, трапы, давление по помещениям.
 *
 * Помещения у всех кораблей одного типа одинаковые (js/models/interior.js),
 * а люки и воздух у каждого свои: у соседа на грунте трап выдвинут, у
 * своего — убран. Поэтому планировка одна (I), а это — на каждый корабль.
 */
export function makeAir(I, gearClear) {
  const ground = -gearClear * 1000;
  const hatches = I.hatches.map((h) => ({
    h,
    id: h.id,
    lock: h.lock,
    zc: (h.z[0] + h.z[1]) / 2,
    area: (h.z[1] - h.z[0]) * (h.y[1] - h.y[0]),   // м² — проём люка
    open: 0,             // панель люка: 0 — закрыта, 1 — отъехала
    stair: 0,            // трап: 0 — убран, 1 — выдвинут
    want: false,         // просили открыть
    design: stairDesign(h.y[0] - ground),
    swing: 0,            // рад — доворот трапа к грунту (+ — конец выше)
    footGap: 0,          // м — от пяты до грунта (Infinity — грунта нет)
    exitOk: false,       // можно ли сойти на трап (снаружи есть, на что встать)
    solids: null,        // твёрдое трапа в осях корабля (кэш)
    solidsKey: '',
  }));
  // Воздух — по помещениям: объём (коробка комнаты) и давление.
  const rooms = {};
  for (const r of I.rooms) {
    rooms[r.id] = {
      id: r.id, lock: r.kind === 'lock',
      V: (r.hi[0] - r.lo[0]) * (r.hi[1] - r.lo[1]) * (r.hi[2] - r.lo[2]),
      p: AIR.cabin,      // бар
      leak: false,       // отсек открыт забортному (люк или стравливание)
      root: null,        // отсек — для разметки (breathe)
    };
  }
  // Проходы: проёмы без дверей (открыты всегда) и двери (насколько открыты).
  const links = (I.airways || []).map((o) => ({ a: rooms[o.a], b: rooms[o.b], area: o.area, door: null, open: 1, was: 1 }));
  for (const d of I.doors) {
    links.push({ a: rooms[d.rooms[0]], b: rooms[d.rooms[1]], area: 2 * d.half * d.height, door: d, open: 0, was: 0 });
  }
  const locks = {};
  for (const r of I.rooms) {
    if (r.kind !== 'lock') continue;
    locks[r.id] = {
      id: r.id,
      room: rooms[r.id],
      p: AIR.cabin,      // бар — давление в шлюзе (то же, что у его помещения)
      vent: false,       // насос стравливает шлюз до забортного
      hatches: hatches.filter((x) => x.lock === r.id),
      state: 'sealed',   // sealed | cycle | open | close
    };
  }
  return { hatches, locks, rooms, links, pOut: 0, block: null };
}

/** Какие люки просят открытыми: имена (в сохранение и в снимок сокета). */
export function openHatches(air, out = []) {
  out.length = 0;
  if (air) for (const hx of air.hatches) if (hx.want) out.push(hx.id);
  return out;
}

/**
 * Поставить просьбы люков по списку имён — так чужой корабль открывает
 * люки, как ему велит тот, кто его ведёт (снимок сокета).
 *
 * @param snap true — сразу в конечное положение, без цикла: корабль
 *   впервые в кадре или игра только что загрузилась. Смотреть, как люк,
 *   открытый полчаса назад, открывается заново, незачем.
 */
export function setHatches(air, names, snap = false) {
  if (!air) return;
  const list = Array.isArray(names) ? names : [];
  for (const hx of air.hatches) {
    hx.want = list.includes(hx.id);
    if (!snap) continue;
    hx.open = hx.want ? 1 : 0;
    hx.stair = hx.want ? 1 : 0;
    hx.solids = null; hx.solidsKey = '';
  }
  if (!snap) return;
  for (const L of Object.values(air.locks)) {
    const open = L.hatches.some((x) => x.want);
    L.state = open ? 'open' : 'sealed';
    L.room.p = open ? air.pOut : AIR.cabin;
    L.p = L.room.p;
  }
}

/** Воздух в помещении: давление и открыт ли его отсек забортному. */
export const roomAir = (air, id) => (air && air.rooms[id]) || null;

/** Люк по имени. */
export const hatchById = (air, id) => air.hatches.find((x) => x.id === id) || null;

/**
 * Попросить люк открыться или закрыться.
 * @returns null — принято, иначе строка: почему нельзя
 */
export function toggleHatch(air, hx, opts = {}) {
  if (!hx.want) {
    if (air.block) return air.block;
    hx.want = true;
    return null;
  }
  // Закрыть — нельзя, пока на трапе или в проёме человек: трап уехал бы
  // из-под ног, а панель прошла бы сквозь него.
  if (opts.occupied) return 'occupied';
  hx.want = false;
  return null;
}

/** Закрыть всё (пилот сел в кресло, прыжок, крушение). */
export function closeAll(air) {
  for (const hx of air.hatches) hx.want = false;
}

/** Сразу всё закрыто и под давлением — новый корабль, страховка, рестарт. */
export function resetAirlocks(air) {
  if (!air) return;
  for (const hx of air.hatches) {
    hx.want = false; hx.open = 0; hx.stair = 0; hx.swing = 0; hx.solids = null; hx.solidsKey = '';
  }
  for (const L of Object.values(air.locks)) {
    L.p = AIR.cabin;
    L.state = 'sealed';
    L.vent = false;
  }
  for (const r of Object.values(air.rooms)) { r.p = AIR.cabin; r.leak = false; }
  for (const k of air.links) k.was = k.door ? 0 : 1;
}

/**
 * Шаг шлюзов.
 *
 * @param env {
 *   pOut — бар за бортом (0 — пустота),
 *   block — строка: почему люки сейчас открывать нельзя (прыжок, напор), или null,
 *   ground(x, z) — высота грунта под точкой в осях корабля, м, или null —
 *                  грунта рядом нет (пустота, порт),
 *   occupied(hx) — стоит ли человек в проёме или на трапе этого люка,
 * }
 * @returns события: [{ kind: 'hatch'|'stair'|'cycle'|'sealed'|'forced', id, dir }]
 *   и { kind: 'rush', id — дверь, dp — бар }: открылась дверь между
 *   помещениями с разным давлением, воздух пошёл
 */
export function updateAirlocks(air, env, dt) {
  const ev = [];
  air.pOut = Math.max(0, env.pOut || 0);
  air.block = env.block || null;
  // Запрет на ходу (прыжок, напор воздуха): открытое закрывается само.
  if (air.block) {
    for (const hx of air.hatches) {
      if (hx.want && !(env.occupied && env.occupied(hx))) { hx.want = false; ev.push({ kind: 'forced', id: hx.id }); }
    }
  }
  for (const L of Object.values(air.locks)) {
    const wantOut = L.hatches.some((x) => x.want);
    const anyOpen = L.hatches.some((x) => x.open > 0 || x.stair > 0);
    const p = L.room.p;
    L.vent = false;
    if (wantOut) {
      // 1. Давление — к забортному: насос стравливает шлюз, а с ним и всё,
      // что за открытой дверью (тогда дольше).
      const dp = air.pOut - p;
      if (Math.abs(dp) > 0.005 && !anyOpen) {
        if (L.state !== 'cycle') ev.push({ kind: 'cycle', id: L.id, dir: dp < 0 ? 'out' : 'in' });
        L.state = 'cycle';
        L.vent = true;
        continue;
      }
      // Люк открыт — в шлюзе забортный воздух (ведёт breathe).
      L.state = 'open';
    } else if (!anyOpen) {
      // Всё закрыто — наддув до давления корабля (насос шлюза, breathe).
      if (Math.abs(AIR.cabin - p) > 0.005) {
        if (L.state !== 'cycle') ev.push({ kind: 'cycle', id: L.id, dir: 'in' });
        L.state = 'cycle';
        continue;
      }
      if (L.state !== 'sealed') ev.push({ kind: 'sealed', id: L.id });
      L.state = 'sealed';
      continue;
    } else {
      L.state = 'close';
    }
    // 2–3. Люки и трапы этого шлюза.
    for (const hx of L.hatches) {
      if (hx.want && wantOut && L.state === 'open') {
        if (hx.open < 1) {
          if (hx.open === 0) ev.push({ kind: 'hatch', id: hx.id, dir: 'open' });
          hx.open = Math.min(1, hx.open + dt / AIR.hatchTime);
        } else if (hx.stair < 1) {
          if (hx.stair === 0) ev.push({ kind: 'stair', id: hx.id, dir: 'out' });
          hx.stair = Math.min(1, hx.stair + dt / AIR.stairTime);
        }
      } else if (hx.stair > 0) {
        if (hx.stair === 1) ev.push({ kind: 'stair', id: hx.id, dir: 'in' });
        hx.stair = Math.max(0, hx.stair - dt / AIR.stairTime * 1.3);
      } else if (hx.open > 0) {
        if (hx.open === 1) ev.push({ kind: 'hatch', id: hx.id, dir: 'close' });
        hx.open = Math.max(0, hx.open - dt / AIR.hatchTime);
      }
    }
  }
  breathe(air, dt, ev);
  for (const L of Object.values(air.locks)) L.p = L.room.p;
  for (const hx of air.hatches) settleStair(hx, env, dt);
  return ev;
}

// --- воздух по помещениям -------------------------------------------------------

const _leak = new Set();
const rootOf = (r) => { while (r.root !== r) r = r.root = r.root.root; return r; };

/**
 * Воздух за кадр: перетекает через открытые проходы, уходит за борт через
 * открытые люки, насос шлюза стравливает его при цикле, а в отсеках,
 * закрытых от забортного, корабль его набирает.
 *
 * Сколько уходит через проём. В пустоту воздух истекает со скоростью
 * звука в самом проёме (критическое истечение), и объём в секунду —
 * Cd·A·c·(2/(γ+1))^((γ+1)/(2(γ−1))) = 0.6 · A · 343 · 0.579 ≈ 119·A м³/с:
 * Cd 0.6 — острая кромка, c — звук в воздухе при 20 °C, γ = 1.4. Здесь он
 * линеен по перепаду — для истечения в пустоту это то же самое, а малые
 * перепады так выравниваются чуть быстрее, чем на деле.
 *
 * Пару помещений шаг решает точно: перепад между ними тает как
 * exp(−q·dt·(1/Va + 1/Vb)) при любом dt, и воздух не берётся ниоткуда.
 */
function breathe(air, dt, ev) {
  const R = air.rooms;
  // Отсеки: помещения, связанные открытыми проходами.
  for (const id in R) R[id].root = R[id];
  for (const k of air.links) {
    k.open = k.door ? k.door.open : 1;
    if (k.open > 0.01) {
      const a = rootOf(k.a), b = rootOf(k.b);
      if (a !== b) a.root = b;
    }
    // Дверь открылась между разными давлениями — воздух пошёл (звук).
    if (k.door && k.open > 0.01 && k.was <= 0.01 && Math.abs(k.a.p - k.b.p) > 0.1) {
      ev.push({ kind: 'rush', id: k.door.id, dp: Math.abs(k.a.p - k.b.p) });
    }
    k.was = k.open;
  }
  // Какие отсеки открыты забортному: люк открыт или насос шлюза стравливает.
  _leak.clear();
  for (const hx of air.hatches) if (hx.open > 0) _leak.add(rootOf(R[hx.lock]));
  for (const L of Object.values(air.locks)) if (L.vent) _leak.add(rootOf(L.room));
  for (const id in R) R[id].leak = _leak.has(rootOf(R[id]));
  // Перетекание.
  for (const k of air.links) {
    if (k.open <= 0.01) continue;
    const a = k.a, b = k.b;
    const pe = (a.p * a.V + b.p * b.V) / (a.V + b.V);
    const f = Math.exp(-AIR.flow * k.area * k.open * dt * (1 / a.V + 1 / b.V));
    a.p = pe + (a.p - pe) * f;
    b.p = pe + (b.p - pe) * f;
  }
  // За борт — через открытые люки: снаружи воздуха сколько угодно.
  for (const hx of air.hatches) {
    if (hx.open <= 0) continue;
    const r = R[hx.lock];
    r.p = air.pOut + (r.p - air.pOut) * Math.exp(-AIR.flow * hx.area * hx.open * dt / r.V);
  }
  // Насос шлюза стравливает его до забортного.
  for (const L of Object.values(air.locks)) {
    if (!L.vent) continue;
    const dp = air.pOut - L.room.p;
    L.room.p += Math.sign(dp) * Math.min(Math.abs(dp), AIR.rate * dt);
  }
  // Наддув — где отсек закрыт от забортного: шлюз — насосом, остальное —
  // жизнеобеспечением, медленнее.
  for (const id in R) {
    const r = R[id];
    if (r.leak) continue;
    const dp = AIR.cabin - r.p;
    if (dp === 0) continue;
    r.p += Math.sign(dp) * Math.min(Math.abs(dp), (r.lock ? AIR.rate : AIR.supply) * dt);
  }
}

// --- трап: где он и что в нём твёрдое ------------------------------------------

/** Петля трапа (порог у обшивки) в осях корабля. */
export function hinge(hx, out = [0, 0, 0]) {
  out[0] = hx.h.side * hx.h.skin; out[1] = hx.h.y[0]; out[2] = hx.zc;
  return out;
}

/**
 * Точка трапа (оси трапа: x — наружу, y — вверх от порога, z — вдоль
 * борта) -> оси корабля при выдвижении s (0..1) и довороте swing.
 *
 * Выдвижение — в два приёма: первая половина хода — трап, лежащий
 * горизонтально, выезжает из-под пола шлюза (там он и хранится), вторая
 * — опускается на петле до своего уклона.
 */
export function stairPoint(hx, s, p, out = [0, 0, 0]) {
  const P = stairPose(hx, s, _pose);
  out[0] = P.o[0] + P.ex[0] * p[0] + P.ey[0] * p[1] + P.ez[0] * p[2];
  out[1] = P.o[1] + P.ex[1] * p[0] + P.ey[1] * p[1] + P.ez[1] * p[2];
  out[2] = P.o[2] + P.ex[2] * p[0] + P.ey[2] * p[1] + P.ez[2] * p[2];
  return out;
}
const _pose = { o: [0, 0, 0], ex: [0, 0, 0], ey: [0, 0, 0], ez: [0, 0, 0] };

/**
 * Положение трапа как твёрдого тела: начало (петля, оси корабля, м) и
 * его оси. Левый трап — правый, повёрнутый на пол-оборота вокруг
 * вертикали (не зеркало: зеркало вывернуло бы грани наизнанку).
 */
export function stairPose(hx, s, out = { o: [0, 0, 0], ex: [0, 0, 0], ey: [0, 0, 0], ez: [0, 0, 0] }) {
  const d = hx.design;
  let rot, dx = 0, dy = 0;
  if (s < 0.5) {
    const k = smooth(s / 0.5);
    rot = d.alpha;
    dx = -(1 - k) * (d.len + 0.3);
    dy = -(1 - k) * 0.25;
  } else {
    const k = smooth((s - 0.5) / 0.5);
    rot = d.alpha + (hx.swing - d.alpha) * k;
  }
  const c = Math.cos(rot), sn = Math.sin(rot), sd = hx.h.side;
  out.o[0] = sd * (hx.h.skin + dx); out.o[1] = hx.h.y[0] + dy; out.o[2] = hx.zc;
  out.ex[0] = sd * c; out.ex[1] = sn; out.ex[2] = 0;
  out.ey[0] = -sd * sn; out.ey[1] = c; out.ey[2] = 0;
  out.ez[0] = 0; out.ez[1] = 0; out.ez[2] = sd;
  return out;
}

/**
 * Середина створки люка (оси корабля, м): треть хода она отходит от
 * борта, остальное — уезжает вдоль него к корме, за край проёма.
 */
export function hatchPanelAt(hx, out = [0, 0, 0]) {
  const h = hx.h, o = hx.open;
  const k1 = smooth(Math.min(1, o / 0.35)), k2 = smooth((o - 0.35) / 0.65);
  out[0] = h.side * (h.inset - 0.05 + AIR.slide * k1);
  out[1] = (h.y[0] + h.y[1]) / 2;
  out[2] = (h.z[0] + h.z[1]) / 2 - (h.z[1] - h.z[0] + 0.15) * k2;
  return out;
}

/**
 * Где обшивку не рисовать, пока люк не закрыт: сама панель люка
 * (утопленная грань корпуса, метры модели). Вместо неё — створка
 * (hatchPanelAt), а за ней — проём в шлюз.
 */
export function hatchCut(hx, out = { lo: [0, 0, 0], hi: [0, 0, 0] }) {
  const h = hx.h, a = h.side * (h.inset - 0.04), b = h.side * (h.inset + 0.04);
  out.lo[0] = Math.min(a, b); out.hi[0] = Math.max(a, b);
  out.lo[1] = h.y[0] - 0.001; out.hi[1] = h.y[1] + 0.001;
  out.lo[2] = h.z[0] - 0.001; out.hi[2] = h.z[1] + 0.001;
  return out;
}

/** Пята трапа (оси корабля) при полном выдвижении и данном довороте. */
function footAt(hx, swing, out) {
  const keep = hx.swing;
  hx.swing = swing;
  stairPoint(hx, 1, [hx.design.foot[0], hx.design.foot[1], 0], out);
  hx.swing = keep;
  return out;
}

const _f = [0, 0, 0];

/**
 * Доворот трапа к грунту и высота пяты над ним. Считается, пока трап
 * опускается и стоит: корабль на стоянке неподвижен, а над грунтом может
 * и сесть, и подняться.
 */
function settleStair(hx, env, dt) {
  if (hx.stair < 0.5) { hx.footGap = Infinity; hx.exitOk = false; return; }
  const ground = env.ground;
  let target = 0;
  if (ground) {
    // Две итерации: от доворота зависит, над какой точкой пята.
    for (let i = 0; i < 2; i++) {
      footAt(hx, target, _f);
      const gy = ground(_f[0], _f[2]);
      if (gy === null || gy === undefined) { target = 0; break; }
      const drop = hx.h.y[0] - gy;
      const s = Math.max(-1, Math.min(1, drop / hx.design.len));
      target = Math.max(-AIR.swing, Math.min(AIR.swing, hx.design.alpha - Math.asin(s)));
    }
  }
  // Доворот — плавно: трап опускается на петле, а не прыгает.
  const k = Math.min(1, dt * 3);
  hx.swing += (target - hx.swing) * (hx.stair < 1 ? 1 : k);
  footAt(hx, hx.swing, _f);
  const gy = ground ? ground(_f[0], _f[2]) : null;
  hx.footGap = gy === null || gy === undefined ? Infinity : _f[1] - gy;
  hx.exitOk = hx.stair >= 1 && isFinite(hx.footGap);
}

/**
 * Твёрдое люков и трапов в осях корабля: панель закрытого люка (или
 * заслон, если сойти некуда), ступени, поручни и заслон у пяты, когда до
 * земли далеко. Ступени — ровные коробки: на довороте ±15° их наклон
 * меньше, чем ступня чувствует.
 */
export function airSolids(air, out = []) {
  out.length = 0;
  if (!air) return out;
  for (const hx of air.hatches) {
    const h = hx.h, sd = h.side;
    const x0 = sd * (h.skin - 0.12), x1 = sd * (h.skin + 0.35);
    const xlo = Math.min(x0, x1), xhi = Math.max(x0, x1);
    const y0 = h.y[0], y1 = h.y[1] + 0.4;
    if (!hx.exitOk) {
      // Люк закрыт, трап не выдвинут, или снаружи не на что встать —
      // проём перекрыт целиком.
      out.push({ lo: [xlo, y0 - 0.3, h.z[0]], hi: [xhi, y1, h.z[1]], hatch: hx.id });
      continue;
    }
    // Сходят только на трап: по бокам от него проём перекрыт.
    out.push({ lo: [xlo, y0 - 0.3, h.z[0]], hi: [xhi, y1, hx.zc - AIR.half], hatch: hx.id });
    out.push({ lo: [xlo, y0 - 0.3, hx.zc + AIR.half], hi: [xhi, y1, h.z[1]], hatch: hx.id });
    const key = hx.swing.toFixed(4) + ':' + (hx.footGap > AIR.drop ? 1 : 0);
    if (hx.solidsKey !== key || !hx.solids) { hx.solids = stairSolids(hx); hx.solidsKey = key; }
    for (const s of hx.solids) out.push(s);
  }
  return out;
}

function stairSolids(hx) {
  const d = hx.design, out = [];
  const a = [0, 0, 0], b = [0, 0, 0];
  const box = (p0, p1, tag) => {
    stairPoint(hx, 1, p0, a); stairPoint(hx, 1, p1, b);
    out.push({ lo: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
      hi: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])], stair: hx.id, tag });
  };
  // Площадка у порога — продолжение порога тоннеля наружу.
  box([-0.05, -0.3, -AIR.half], [0.02, 0, AIR.half], 'top');
  for (let i = 1; i < d.n; i++) {
    const y = -i * d.r;
    // Ступень — ровная по верху: берём её середину на трапе.
    stairPoint(hx, 1, [(i - 0.5) * d.t, y, 0], a);
    const top = a[1];
    stairPoint(hx, 1, [(i - 1) * d.t - 0.02, y, 0], a);
    stairPoint(hx, 1, [i * d.t + 0.03, y, 0], b);
    const xl = Math.min(a[0], b[0]), xh = Math.max(a[0], b[0]);
    out.push({ lo: [xl, top - 0.06, hx.zc - AIR.half], hi: [xh, top, hx.zc + AIR.half], stair: hx.id, tag: 'tread' });
    // Поручни — стенкой во всю ступень: с трапа сходят только вниз.
    for (const sz of [-1, 1]) {
      const z0 = hx.zc + sz * AIR.half, z1 = z0 + sz * 0.08;
      out.push({ lo: [xl, top, Math.min(z0, z1)], hi: [xh, top + AIR.rail, Math.max(z0, z1)], stair: hx.id, tag: 'rail' });
    }
  }
  // До земли далеко — у пяты заслон: дальше прыжок, а не шаг.
  if (hx.footGap > AIR.drop) {
    const x = (d.n - 1) * d.t;
    stairPoint(hx, 1, [x, -(d.n - 1) * d.r, 0], a);
    stairPoint(hx, 1, [x + 0.12, -(d.n - 1) * d.r, 0], b);
    out.push({ lo: [Math.min(a[0], b[0]), a[1], hx.zc - AIR.half], hi: [Math.max(a[0], b[0]), a[1] + AIR.rail, hx.zc + AIR.half],
      stair: hx.id, tag: 'gate' });
  }
  return out;
}

// --- где стоит человек ------------------------------------------------------------

/** Люк, в тоннеле которого точка (оси корабля), или null. */
export function tunnelAt(air, I, p) {
  if (!air) return null;
  for (const hx of air.hatches) {
    const h = hx.h, r = I.roomById[h.lock];
    const wall = Math.abs(h.side > 0 ? r.hi[0] : r.lo[0]);
    const ax = Math.abs(p[0]);
    if (Math.sign(p[0]) === h.side && ax >= wall - 0.05 && ax <= h.skin
      && p[2] >= h.z[0] && p[2] <= h.z[1] && p[1] >= h.y[0] - 0.3 && p[1] <= h.y[1]) return hx;
  }
  return null;
}

/** Люк, за обшивку которого вышла точка (на трап), или null. */
export function pastSkin(air, p) {
  if (!air) return null;
  for (const hx of air.hatches) {
    const h = hx.h;
    if (Math.sign(p[0]) === h.side && Math.abs(p[0]) > h.skin && Math.abs(p[0]) < h.skin + 0.6
      && p[2] >= h.z[0] && p[2] <= h.z[1] && p[1] >= h.y[0] - 0.5 && p[1] <= h.y[0] + 1.0) return hx;
  }
  return null;
}

/** На трапе ли точка (оси корабля): над его ступенями, в пределах поручней. */
export function onStair(hx, p) {
  if (hx.stair < 1) return false;
  const d = hx.design, a = [0, 0, 0], b = [0, 0, 0];
  stairPoint(hx, 1, [0, 0, 0], a);
  stairPoint(hx, 1, [d.foot[0] + 0.3, d.foot[1], 0], b);
  const xl = Math.min(a[0], b[0]), xh = Math.max(a[0], b[0]);
  return p[0] >= xl && p[0] <= xh && Math.abs(p[2] - hx.zc) <= AIR.half + 0.1
    && p[1] >= Math.min(a[1], b[1]) - 0.6 && p[1] <= a[1] + 2.2;
}

/**
 * Какой люк под рукой (оси корабля): у пульта в шлюзе, в тоннеле, на
 * трапе или под люком снаружи.
 * @param outside true — человек вне корабля (на трапе или на грунте)
 */
export function hatchNear(air, I, p, outside) {
  if (!air) return null;
  let best = null, bd = Infinity;
  for (const hx of air.hatches) {
    const h = hx.h;
    let d = Infinity;
    if (!outside) {
      const r = I.roomAt(p);
      if (r && r.id === h.lock) {
        d = Math.hypot(p[0] - h.panel[0], p[2] - h.panel[2]);
        if (d > AIR.near) d = Infinity;
        // У самого проёма — тоже: люк перед глазами.
        const dx = Math.abs(p[0]) - (Math.abs(h.side > 0 ? r.hi[0] : r.lo[0]) - 1.2);
        if (Math.sign(p[0]) === h.side && dx >= 0 && p[2] >= h.z[0] && p[2] <= h.z[1]) d = Math.min(d, 1.2 - dx);
      }
      if (tunnelAt(air, I, p) === hx) d = 0;
    } else {
      if (onStair(hx, p)) d = 0;
      // Снизу, у пяты убранного или выдвинутого трапа: на четыре метра.
      const fx = h.side * (h.skin + hx.design.foot[0] * 0.6);
      const dg = Math.hypot(p[0] - fx, p[2] - hx.zc);
      if (dg < 4.5 && p[1] < h.y[0]) d = Math.min(d, dg);
    }
    if (d < bd) { bd = d; best = hx; }
  }
  return best;
}

/** Цвет ламп шлюза: дежурный, жёлтый на цикле (мигает), красный при открытом люке. */
export function lockLight(air, id, t, out = [0, 0, 0]) {
  const L = air && air.locks[id];
  if (!L || L.state === 'sealed') { out[0] = 0.95; out[1] = 0.9; out[2] = 0.8; return out; }
  if (L.state === 'cycle' || L.state === 'close') {
    const k = 0.55 + 0.45 * (Math.sin(t * Math.PI * 2) > 0 ? 1 : 0);
    out[0] = 1.0 * k; out[1] = 0.55 * k; out[2] = 0.12 * k;
    return out;
  }
  out[0] = 0.95; out[1] = 0.35; out[2] = 0.22;
  return out;
}

/** Что сказать о шлюзе приборам: состояние и давление. */
export function lockStatus(air, id) {
  const L = air && air.locks[id];
  if (!L) return null;
  return { state: L.state, p: L.p, out: air.pOut, open: L.hatches.some((x) => x.open > 0) };
}
