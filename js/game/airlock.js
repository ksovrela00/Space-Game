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
// ГРУЗОВАЯ ПЛАТФОРМА — тоже здесь, хотя она не шлюз и не люк: это пол
// трюма, который едет к грунту (js/models/interior.js, BAYS). Живёт она
// рядом с люками ради того, что у них общее: её просят открытой тем же
// списком имён (сохранение, снимок сокета, просьба к хозяину чужого
// корабля), её закрывают те же запреты (прыжок, напор воздуха) и та же
// посадка пилота в кресло, а открытая она — такая же дыра в корпусе для
// воздуха. Ход, грунт и заслоны у неё свои — раздел «платформа» ниже.
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

// Грузовая платформа (раздел «платформа» ниже).
export const BAY = {
  speed: 0.55,         // м/с — ход: от пола до грунта восемь секунд
  accel: 0.6,          // м/с² — разгон и торможение: платформа с грузом не дёргается
  extra: 0.6,          // м — ход сверх «до грунта на ровной стоянке»: на склоне грунт под ней ниже
  seal: 0.03,          // м — с какого хода между плитой и полом щель: трюм открыт забортному
  guard: 0.6,          // м — заслон: выше шага (WALK.step, 0.42), перешагнуть нельзя
  near: 1.3,           // м — дотянуться до пульта
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
  // Платформы: ход до грунта на ровной стоянке (верх плиты над ним — на
  // её толщину) и предел — немного сверх, на ямку под ней на склоне.
  const bays = (I.bays || []).map((b) => ({
    b,
    id: b.id,
    room: b.room,
    reach: b.deck - b.plate - ground,
    stroke: b.deck - b.plate - ground + BAY.extra,
    area: (b.x[1] - b.x[0]) * (b.z[1] - b.z[0]),   // м² — проём в полу
    want: false,         // просили опустить
    travel: 0,           // м — насколько опущена (0 — вровень с полом)
    target: 0,           // м — куда идёт сейчас
    vel: 0,              // м/с — скорость хода (модуль)
    dir: 0,              // −1 — вверх, +1 — вниз, 0 — стоит
    dy: 0,               // м — сколько прошла за последний шаг (вниз — плюс)
    open: 0,             // щель между плитой и полом: 0 — трюм закрыт, 1 — открыт
    floor: false,        // легла на грунт (а не повисла на всём ходу)
    gap: Infinity,       // м — от верха плиты до грунта у её краёв
    exitOk: false,       // можно ли сойти с неё на грунт
    snap: false,         // в конечное положение сразу (setHatches)
    solids: null,
    solidsKey: '',
  }));
  // I — планировка, по которой собраны эти шлюзы: у корабля другого типа
  // она своя (js/models/interior.prom.js), и проёмы люков, тоннели и
  // комнаты берутся отсюда, а не из помещений, где стоит пилот.
  return { I, hatches, bays, locks, rooms, links, pOut: 0, block: null, bayBlock: null };
}

/** Какие люки просят открытыми: имена (в сохранение и в снимок сокета). */
export function openHatches(air, out = []) {
  out.length = 0;
  if (!air) return out;
  for (const hx of air.hatches) if (hx.want) out.push(hx.id);
  // Платформа едет в том же списке: имя её — такое же «открыто».
  for (const bx of air.bays || []) if (bx.want) out.push(bx.id);
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
    hx.stair = hx.want && hx.h.stair !== false ? 1 : 0;
    hx.solids = null; hx.solidsKey = '';
  }
  for (const bx of air.bays || []) {
    bx.want = list.includes(bx.id);
    // Сразу — тоже до грунта, а где он, знает только шаг (env.ground).
    if (snap) { bx.snap = true; bx.vel = 0; bx.dir = 0; }
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
  for (const bx of air.bays || []) bx.want = false;
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
  for (const bx of air.bays || []) {
    bx.want = false; bx.travel = 0; bx.target = 0; bx.vel = 0; bx.dir = 0; bx.dy = 0;
    bx.open = 0; bx.floor = false; bx.exitOk = false; bx.snap = false; bx.solids = null; bx.solidsKey = '';
  }
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
  air.bayBlock = env.bayBlock || air.block;
  // Запрет на ходу (прыжок, напор воздуха): открытое закрывается само.
  if (air.block) {
    for (const hx of air.hatches) {
      if (hx.want && !(env.occupied && env.occupied(hx))) { hx.want = false; ev.push({ kind: 'forced', id: hx.id }); }
    }
  }
  // Платформа поднимается и с человеком на ней: она его везёт, а не
  // уходит из-под ног.
  if (air.bayBlock) {
    for (const bx of air.bays || []) if (bx.want) { bx.want = false; ev.push({ kind: 'forced', id: bx.id }); }
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
        } else if (hx.stair < 1 && hx.h.stair !== false) {
          // Люк без трапа (stair: false — шлюзы среднего корпуса
          // «Прометея», порог в двадцати метрах над грунтом): панель
          // отъезжает, а трапа нет, и проём перекрыт, как в пустоте.
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
  for (const bx of air.bays || []) stepBay(bx, env, dt, ev);
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
  for (const bx of air.bays || []) if (bx.open > 0) _leak.add(rootOf(R[bx.room]));
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
  // И через щель вокруг опущенной платформы: насоса у трюма нет, он не
  // шлюз, и воздух уходит сразу — с ним и всего, что связано с трюмом
  // проёмами без дверей.
  for (const bx of air.bays || []) {
    if (bx.open <= 0) continue;
    const r = R[bx.room];
    r.p = air.pOut + (r.p - air.pOut) * Math.exp(-AIR.flow * bx.area * bx.open * dt / r.V);
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
 * Грунт под пятой трапа, м (оси корабля): самая низкая из точек под пятой и
 * там, откуда на трап ступают, — в шаге наружу, посередине и у поручней.
 *
 * Не одна точка под серединой пяты: на склоне поперёк трапа и под горку от
 * него грунт у края ниже, и трап, поставленный серединой на землю, на склоне
 * в 18° вышел с первой ступенью в 0.55 м над грунтом — выше шага (WALK.step,
 * 0.42), и на него было не подняться. Пята, упёртая в самую низкую точку,
 * высоким краем чуть уходит в грунт, — как настоящий трап на мягкой земле.
 */
const FOOT_OUT = 0.35, FOOT_SIDE = AIR.half - 0.25;
function footGround(hx, ground, f) {
  let g = Infinity;
  for (let i = 0; i < 6; i++) {
    const y = ground(f[0] + hx.h.side * (i < 3 ? 0 : FOOT_OUT), f[2] + FOOT_SIDE * ((i % 3) - 1));
    if (y === null || y === undefined) return null;
    if (y < g) g = y;
  }
  return g;
}

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
      const gy = footGround(hx, ground, _f);
      if (gy === null) { target = 0; break; }
      const drop = hx.h.y[0] - gy;
      const s = Math.max(-1, Math.min(1, drop / hx.design.len));
      target = Math.max(-AIR.swing, Math.min(AIR.swing, hx.design.alpha - Math.asin(s)));
    }
  }
  // Доворот — плавно: трап опускается на петле, а не прыгает.
  const k = Math.min(1, dt * 3);
  hx.swing += (target - hx.swing) * (hx.stair < 1 ? 1 : k);
  footAt(hx, hx.swing, _f);
  const gy = ground ? footGround(hx, ground, _f) : null;
  hx.footGap = gy === null ? Infinity : _f[1] - gy;
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
  for (const bx of air.bays || []) for (const s of baySolids(bx)) out.push(s);
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
    // Сходят только на трап: по бокам от него проём перекрыт заслоном. Он
    // невидим и стоит лишь там, где поручней ещё нет, — от тоннеля до
    // обшивки (поручни ступеней начинаются от самой петли), — и только чуть
    // выше шага: перешагнуть его нельзя, а большего от него не нужно. Раньше
    // он был во весь проём и на 35 см за обшивку, и на склоне (тангаж до
    // 20°) стенка в четыре метра наклонялась к проходу на полметра: пилот
    // упирался в пустоту у верха трапа и в носовом люке, где над головой
    // три метра.
    const gx0 = sd * (h.skin - 0.12), gx1 = sd * (h.skin + 0.05);
    const glo = Math.min(gx0, gx1), ghi = Math.max(gx0, gx1), gy = y0 + GUARD;
    out.push({ lo: [glo, y0 - 0.3, h.z[0]], hi: [ghi, gy, hx.zc - AIR.half], hatch: hx.id });
    out.push({ lo: [glo, y0 - 0.3, hx.zc + AIR.half], hi: [ghi, gy, h.z[1]], hatch: hx.id });
    const key = hx.swing.toFixed(4) + ':' + (hx.footGap > AIR.drop ? 1 : 0);
    if (hx.solidsKey !== key || !hx.solids) { hx.solids = stairSolids(hx); hx.solidsKey = key; }
    for (const s of hx.solids) out.push(s);
  }
  return out;
}

// Высота невидимого заслона по бокам от трапа на пороге, м: выше шага
// (WALK.step, 0.42), чтобы на него не наступить.
const GUARD = 0.6;

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

// --- платформа -----------------------------------------------------------------------
//
// Большая часть пола трюма — лифт до грунта (js/models/interior.js, BAYS):
// в трюм заезжают наземной машиной, и он становится ангаром.
//
// КУДА ОНА ИДЁТ. На стоянке — до грунта: плита ложится на самую высокую
// точку грунта под собой (на ровной площадке это 4.4 м хода, верх плиты —
// на её толщину над землёй). В полёте, в воздухе над грунтом — на весь
// ход, BAY.extra сверх «до грунта на ровной стоянке»: дальше тросам
// некуда. Опускается корабль на опущенную платформу — грунт поднимает её,
// и она укорачивается сама: предел хода считается каждый шаг.
//
// ЧТО ЗА ЕЁ КРАЕМ. Пока плита в колодце, вбок не сойти — стенки колодца
// твёрдые. Ниже днища по краю плиты стоит заслон, пока сойти некуда: она
// едет, висит выше AIR.drop над грунтом (то же правило, что у пяты трапа)
// или ещё не легла. Вокруг проёма в полу трюма — свой заслон, пока
// платформы в нём нет: шаг с палубы в колодец был бы падением на пять
// метров. Звать её наверх с палубы — пультом на переборке трюма.
//
// КТО НА НЕЙ — ЕДЕТ. Стоящего на плите везёт игра (js/main.js, carryBay):
// плита — твёрдое мира ходьбы, и без переноса она проходила бы сквозь
// ноги вверх, а вниз уходила бы из-под них. Сколько прошла за шаг — dy.
//
// ВНИЗ — НЕ НА ГОЛОВУ. Человек под плитой (на грунте под опущенной
// платформой) останавливает спуск, пока не отойдёт (env.below).

const _bayG = [];

/**
 * Насколько платформа может опуститься, м: до самой высокой точки грунта
 * под плитой, но не дальше хода. Грунта под ней нет (пустота, порт) — на
 * весь ход.
 */
function bayLimit(bx, ground) {
  if (!ground) return bx.stroke;
  const b = bx.b;
  let top = -Infinity;
  for (let i = 0; i <= 4; i++) {
    for (let k = 0; k <= 6; k++) {
      const y = ground(b.x[0] + (b.x[1] - b.x[0]) * i / 4, b.z[0] + (b.z[1] - b.z[0]) * k / 6);
      if (y === null || y === undefined) return bx.stroke;
      if (y > top) top = y;
    }
  }
  return Math.max(0, Math.min(bx.stroke, b.deck - b.plate - top));
}

/** Грунт у краёв плиты — там, куда с неё сходят (оси корабля, м), или null. */
function bayEdgeGround(bx, ground) {
  if (!ground) return null;
  const b = bx.b, o = 0.35;
  _bayG.length = 0;
  for (let i = 0; i <= 4; i++) {
    const x = b.x[0] + (b.x[1] - b.x[0]) * i / 4;
    _bayG.push([x, b.z[0] - o], [x, b.z[1] + o]);
  }
  for (let k = 1; k < 6; k++) {
    const z = b.z[0] + (b.z[1] - b.z[0]) * k / 6;
    _bayG.push([b.x[0] - o, z], [b.x[1] + o, z]);
  }
  let low = Infinity;
  for (const [x, z] of _bayG) {
    const y = ground(x, z);
    if (y === null || y === undefined) return null;
    if (y < low) low = y;
  }
  return low;
}

/** Верх плиты сейчас (оси корабля, м). */
export const bayTop = (bx) => bx.b.deck - bx.travel;

/** Платформа по имени. */
export const bayById = (air, id) => (air && air.bays ? air.bays.find((x) => x.id === id) : null) || null;

/**
 * Попросить платформу вниз или наверх.
 * @returns null — принято, иначе строка: почему нельзя
 */
export function toggleBay(air, bx) {
  if (!bx.want) {
    if (air.bayBlock) return air.bayBlock;
    bx.want = true;
    return null;
  }
  bx.want = false;
  return null;
}

/** Шаг платформы: куда идёт, ход с разгоном и торможением, что за краем. */
function stepBay(bx, env, dt, ev) {
  const lim = bayLimit(bx, env.ground);
  bx.floor = !!env.ground && lim < bx.stroke - 1e-3;
  const was = bx.travel;
  // Грунт под плитой выше, чем она опущена (корабль садится на опущенную
  // платформу), — грунт её и поднимает, сразу, а не ходом.
  if (bx.travel > lim) bx.travel = lim;
  const target = bx.want ? lim : 0;
  if (bx.snap) { bx.travel = target; bx.snap = false; bx.vel = 0; bx.dir = 0; }
  // Доехала — ровно в цель. Остановка в десятой доле миллиметра от неё
  // оставляла щель между плитой и полом: трюм числился открытым, и
  // воздух уходил из него без конца.
  if (Math.abs(target - bx.travel) <= 1e-4) bx.travel = target;
  const d = target - bx.travel;
  // Вниз — только если под плитой никого.
  const held = d > 0 && !!env.below && env.below(bx);
  if (Math.abs(d) > 1e-4 && !held) {
    const dir = Math.sign(d);
    if (dir !== bx.dir) {
      if (bx.dir === 0) ev.push({ kind: 'bay', id: bx.id, dir: dir > 0 ? 'down' : 'up' });
      bx.vel = 0;
      bx.dir = dir;
    }
    // Разгон до хода и торможение к цели — по одному ускорению: v = √(2ad)
    // тормозит ровно на a. Не медленнее a·dt — иначе корень у цели уходит в
    // ноль и последний миллиметр тянется без конца. Добавка к корню (было
    // +0.02) тормозила резче a втрое: профиль шёл быстрее своего.
    const vmax = Math.min(BAY.speed, Math.max(Math.sqrt(2 * BAY.accel * Math.abs(d)), BAY.accel * dt));
    bx.vel = Math.min(vmax, bx.vel + BAY.accel * dt);
    bx.travel += dir * Math.min(Math.abs(d), bx.vel * dt);
  } else {
    if (bx.dir !== 0) {
      ev.push({ kind: 'bayStop', id: bx.id, at: held ? 'held' : bx.travel < 0.01 ? 'top' : bx.floor ? 'ground' : 'air' });
      bx.dir = 0;
    }
    bx.vel = 0;
  }
  if (bx.travel < 0) bx.travel = 0;
  bx.dy = bx.travel - was;
  bx.target = target;
  bx.open = Math.min(1, bx.travel / BAY.seal);
  const top = bayTop(bx);
  const gy = bayEdgeGround(bx, env.ground);
  bx.gap = gy === null ? Infinity : top - gy;
  // Сойти — когда стоит внизу, верх плиты ниже днища, а грунт у краёв не
  // дальше, чем сходят с конца трапа.
  bx.exitOk = bx.want && bx.dir === 0 && top < bx.b.belly && bx.gap <= AIR.drop;
}

/**
 * Твёрдое платформы (оси корабля, м): плита и пульт на ней — всегда (плита
 * поднятая и есть пол трюма), заслон вокруг проёма — пока её в нём нет,
 * заслон по краю плиты — пока сойти нельзя. Оба заслона — СНАРУЖИ края:
 * стоящий на плите не оказывается внутри них, когда они появляются.
 */
export function baySolids(bx) {
  const key = bx.travel.toFixed(4) + ':' + (bx.exitOk ? 1 : 0);
  if (bx.solids && bx.solidsKey === key) return bx.solids;
  const b = bx.b, out = [];
  const [x0, x1] = b.x, [z0, z1] = b.z, t = 0.06;
  const top = bayTop(bx);
  out.push({ lo: [x0, top - b.plate, z0], hi: [x1, top, z1], bay: bx.id, plate: true });
  const pb = bx.panelBox || (bx.panelBox = b.panelBox || null);
  if (pb) out.push({ lo: [pb.lo[0], pb.lo[1] - bx.travel, pb.lo[2]], hi: [pb.hi[0], pb.hi[1] - bx.travel, pb.hi[2]], bay: bx.id, panel: true });
  const ring = (y0, y1, tag) => {
    out.push({ lo: [x0 - t, y0, z0 - t], hi: [x0, y1, z1 + t], bay: bx.id, guard: tag });
    out.push({ lo: [x1, y0, z0 - t], hi: [x1 + t, y1, z1 + t], bay: bx.id, guard: tag });
    out.push({ lo: [x0, y0, z0 - t], hi: [x1, y1, z0], bay: bx.id, guard: tag });
    out.push({ lo: [x0, y0, z1], hi: [x1, y1, z1 + t], bay: bx.id, guard: tag });
  };
  if (bx.travel > 0.02) ring(b.deck, b.deck + BAY.guard, 'deck');
  if (bx.travel > 0.02 && !bx.exitOk && top < b.belly) ring(top, top + BAY.guard, 'edge');
  bx.solids = out;
  bx.solidsKey = key;
  return out;
}

/** Стоит ли точка ног (оси корабля, м) на плите платформы. */
export function onBay(bx, p, tol = 0.06) {
  const b = bx.b;
  return p[0] >= b.x[0] - 0.05 && p[0] <= b.x[1] + 0.05 && p[2] >= b.z[0] - 0.05 && p[2] <= b.z[1] + 0.05
    && Math.abs(p[1] - bayTop(bx)) <= tol;
}

/**
 * Насколько сдвинуть стоящего на платформе после её шага, м (вниз —
 * плюс): стоял на плите до шага — едет на её ход, иначе ноль. Плита —
 * твёрдое мира ходьбы, и без переноса она проходила бы сквозь ноги вверх,
 * а вниз уходила бы из-под них: тело падало бы следом, на каждом шаге на
 * миг повисая.
 */
export function bayCarry(air, p) {
  for (const bx of (air && air.bays) || []) {
    if (!bx.dy) continue;
    const b = bx.b, was = bayTop(bx) + bx.dy;
    if (p[0] < b.x[0] - 0.05 || p[0] > b.x[1] + 0.05 || p[2] < b.z[0] - 0.05 || p[2] > b.z[1] + 0.05) continue;
    if (Math.abs(p[1] - was) <= 0.08) return bx.dy;
  }
  return 0;
}

/** Под плитой ли точка (оси корабля, м): в её плане и ниже низа плиты. */
export function underBay(bx, p) {
  const b = bx.b;
  return p[0] > b.x[0] - 0.3 && p[0] < b.x[1] + 0.3 && p[2] > b.z[0] - 0.3 && p[2] < b.z[1] + 0.3
    && p[1] < bayTop(bx) - b.plate;
}

/**
 * Пульт платформы под рукой (оси корабля, м): на самой плите — тот, на
 * котором едут, или настенный в трюме — тот, которым зовут.
 * @returns { bx, kind: 'ride' | 'call' } или null
 */
export function bayPanelNear(air, p) {
  for (const bx of (air && air.bays) || []) {
    const b = bx.b;
    if (onBay(bx, p, 0.5) && Math.hypot(p[0] - b.panel[0], p[2] - b.panel[1]) < BAY.near) return { bx, kind: 'ride' };
    if (b.call && Math.abs(p[1] - b.deck) < 0.5 && Math.hypot(p[0] - b.call[0], p[2] - b.call[1]) < BAY.near
      && !onBay(bx, p, 0.5)) return { bx, kind: 'call' };
  }
  return null;
}

/** Насколько точка (оси корабля, м) за краем плиты в плане: плюс — снаружи, минус — внутри. */
const bayOut = (b, p) => Math.max(b.x[0] - p[0], p[0] - b.x[1], b.z[0] - p[2], p[2] - b.z[1]);

/**
 * Платформа, с края которой сходит точка ног (оси корабля, м): сойти с
 * неё можно, а ноги уже за краем плиты, но у самого её верха. Тело в
 * полметра ещё опирается на плиту — переход в оси грунта идёт, пока ноги
 * на ней, а не после падения.
 */
export function pastBay(air, p) {
  for (const bx of (air && air.bays) || []) {
    if (!bx.exitOk) continue;
    const out = bayOut(bx.b, p), top = bayTop(bx);
    if (out > 0.05 && out < 1.0 && p[1] > top - 0.8 && p[1] < top + 0.3) return bx;
  }
  return null;
}

/**
 * Платформа, на которую с грунта ступила точка ног (оси корабля, м): плита
 * снаружи корабля, ноги внутри её плана (с запасом — у края не дёргаться
 * туда-обратно) и на её верху.
 */
export function ontoBay(air, p) {
  for (const bx of (air && air.bays) || []) {
    const top = bayTop(bx);
    if (top >= bx.b.belly) continue;
    if (bayOut(bx.b, p) < -0.1 && Math.abs(p[1] - top) < 0.12) return bx;
  }
  return null;
}

/**
 * Проём в днище под платформой — где обшивку не рисовать, пока она не
 * поднята (метры модели): от пола трюма до низа колодца по её плану.
 */
export function bayCut(bx, out = { lo: [0, 0, 0], hi: [0, 0, 0] }) {
  const b = bx.b;
  out.lo[0] = b.x[0] - 0.01; out.hi[0] = b.x[1] + 0.01;
  out.lo[1] = b.belly - 0.3; out.hi[1] = b.deck - 0.01;
  out.lo[2] = b.z[0] - 0.01; out.hi[2] = b.z[1] + 0.01;
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
