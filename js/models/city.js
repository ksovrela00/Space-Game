// Наземный город: планировка, посадочные площадки и то, во что
// врезается корабль.
//
// ПОЧЕМУ ГОРОД СОБИРАЕТСЯ ЗДЕСЬ, А НЕ СКАЧИВАЕТСЯ ЦЕЛИКОМ. Готовых
// «городов» в CC0-паках нет, а если бы и были — город обязан знать про
// себя три вещи, которых нет ни в одной модели: где посадочные
// площадки (туда садится корабль), какой у него габарит (по нему город
// берут в прицел) и во что здесь можно врезаться. Поэтому планировка
// строится кодом и проверяется тестами, а из паков берутся ЗДАНИЯ —
// ровно то, чего своими руками не налепишь (js/models/city.parts.js).
//
// ПЛАНИРОВКА ДЕТЕРМИНИРОВАННАЯ и считается от семени города: между
// запусками, у клиента и на скриншотах город обязан быть одним и тем
// же. Свой поток случайных чисел, а не общий генератор мира: лишнее
// число, взятое у мира, сдвинуло бы все планеты в галактике (эту цену
// уже платили за тип станции, см. js/game/world.js).
//
// ОСИ ГОРОДА: x — «восток», z — «север», y — вверх (местная вертикаль).
// Космопорт вынесен на восток, жилой центр — в нуле. Всё в километрах и
// в этих осях; на шар город ставит js/game/city.js.
//
// ГРУНТ ПОД ГОРОДОМ ВЫРОВНЕН — это часть рельефа, а не подставка под
// модель: js/gl/terrain.js вписывает в поверхность ровную площадку. Без
// неё половина зданий висела бы в воздухе, а вторая половина сидела бы
// в грунте по крышу, и сесть было бы негде.

import { mulberry32 } from '../core/rng.js';
import { CITY_PARTS } from './city.parts.js';

export const CITY = {
  // --- застройка
  cell: 0.27,        // км — шаг кварталов (улица входит в шаг)
  core: 0.46,        // км — радиус башенного центра
  mid: 0.98,         // км — докуда идут обычные кварталы
  edge: 1.62,        // км — докуда доходит низкая застройка
  // --- космопорт
  port: 1.22,        // км — ось площадок по x
  pad: 0.09,         // км — полуразмер посадочной площадки (180 м)
  padGap: 0.30,      // км — между центрами соседних площадок
  pads: 3,
  // --- габариты
  bound: 2.1,        // км — радиус всего города: по нему его берут в цель
  // Выровненная площадка в грунте. Она заметно шире застройки: город на
  // краю плиты стоял бы на перегибе, а перегиб — это уже уклон.
  plate: 2.45,       // км — радиус ровного грунта
  rim: 1.10,         // км — ширина перехода от плиты к рельефу
  // --- монорельс
  railZ: 0.48,       // км — по какой улице идёт линия
  railY: 0.052,      // км — высота пути
  railSeg: 0.08,     // км — длина секции пути
  // --- ночь
  lampStep: 0.135,   // км — шаг уличных фонарей
};

const TAU = Math.PI * 2;

const TOWERS = ['towerA', 'towerB', 'towerC'];
const BLOCKS = ['blockA', 'blockB', 'blockC', 'blockD'];
const LOWS = ['lowA', 'lowB', 'lowC', 'lowD', 'lowE', 'lowWide'];

// Цвета того, что рисуется не моделью, а плашкой на грунте.
const APRON = [126, 130, 138];     // бетон перрона
const PAD = [58, 62, 70];          // сама площадка — темнее перрона
const PAINT = [226, 170, 62];      // разметка
const ROAD = [74, 78, 86];
const LIGHT_G = [90, 255, 130];
const LIGHT_W = [230, 240, 255];
const LIGHT_R = [255, 90, 80];

/**
 * Габариты детали, поставленной на заданную ВЫСОТУ.
 *
 * Деталь в паке приведена так, что её наибольшая сторона равна 1000
 * (tools/city.mjs), и размер на месте установки задаётся именно по
 * наибольшей стороне. Но по месту удобнее другое: «башня в триста
 * метров». Поэтому здесь пересчёт — от высоты к размеру детали, а
 * заодно и след на земле, по которому потом считается столкновение.
 */
export function partBox(key, height) {
  const p = CITY_PARTS[key];
  if (!p) throw new Error(`нет детали ${key}: пересоберите npm run city`);
  const s = height / (p.size[1] / 1000);
  return {
    size: s,
    hw: (p.size[0] / 1000) * s * 0.5,
    hd: (p.size[2] / 1000) * s * 0.5,
    h: height,
  };
}

/**
 * Свободно ли место под коробку.
 *
 * Зазор — не запас на глазок, а ширина проезда: между двумя стенами в
 * городе должно быть куда сесть, и уж точно не должно быть щели в
 * полметра, которую видно только вплотную.
 */
const GAP = 0.014;     // км

function free(out, box) {
  for (const b of out.boxes) {
    if (Math.abs(box.x - b.x) < box.hw + b.hw + GAP
      && Math.abs(box.z - b.z) < box.hd + b.hd + GAP) return false;
  }
  return true;
}

/**
 * Поставить здание: деталь плюс коробка столкновения.
 *
 * Развороты — только кратные прямому углу, и это не лень. Во-первых,
 * дома стоят вдоль улиц. Во-вторых, коробка столкновения при таком
 * развороте остаётся ТОЧНОЙ (стороны просто меняются местами), и то,
 * во что врезается корабль, совпадает с нарисованным без всякого
 * запаса. Наклонённый дом пришлось бы обводить коробкой с походом, и
 * корабль бился бы о воздух.
 */
function building(out, key, x, z, height, quarter, dim = 1, top = null) {
  const b = partBox(key, height);
  const swap = quarter & 1;
  const box = {
    x, z, h: b.h,
    hw: swap ? b.hd : b.hw,
    hd: swap ? b.hw : b.hd,
  };
  if (!free(out, box)) return null;
  out.parts.push({ p: key, x, z, y: 0, s: b.size, rot: quarter * (Math.PI / 2), dim });
  out.boxes.push(box);
  // Огонь на крыше. Он и в жизни там стоит по той же причине, по которой
  // нужен здесь: показать, где кончается здание, тому, кто летит.
  if (top) out.lamps.push({ x, z, y: b.h + 0.004, r: 0.005, c: top });
  return b;
}

/** Плашка на грунте: перрон, разметка, огонь. */
const plate = (out, x, z, hw, hd, c, glow = 0, lift = 0) =>
  out.plates.push({ x, z, hw, hd, c, glow, y: lift });

/**
 * Посадочная площадка: квадрат, рамка и огни.
 *
 * Площадка НЕ ПОДНЯТА над грунтом. Так и задумано: корабль садится на
 * ту высоту, которую считает игровая логика (ровная плита), и поднятый
 * помост означал бы, что нарисованное и настоящее расходятся на его
 * толщину — корабль висел бы над бетоном или тонул в нём.
 *
 * Рамка и огни СВЕТЯТСЯ сами. Свет на безатмосферном теле ровно один —
 * солнце, и половину суток площадка лежит в тени, где обычная краска не
 * видна вовсе.
 */
function pad(out, x, z, n) {
  const R = CITY.pad;
  out.pads.push({ x, z, r: R, n });
  plate(out, x, z, R, R, PAD, 0, 0.00002);
  // Рамка по краю.
  const w = 0.006;
  for (const s of [-1, 1]) {
    plate(out, x + s * (R - w), z, w, R, PAINT, 0.7, 0.00004);
    plate(out, x, z + s * (R - w), R - w * 2, w, PAINT, 0.7, 0.00004);
  }
  // Крест в середине: по нему целятся, когда площадка уже под брюхом.
  plate(out, x, z, R * 0.42, w * 0.8, PAINT, 0.55, 0.00004);
  plate(out, x, z, w * 0.8, R * 0.42, PAINT, 0.55, 0.00004);
  // Огни по углам: зелёные со стороны захода, красные с обратной.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      plate(out, x + sx * R * 0.92, z + sz * R * 0.92, 0.011, 0.011,
        sx > 0 ? LIGHT_G : LIGHT_R, 1, 0.00006);
    }
  }
}

/**
 * Огонь на мачте. Мачта нужна не для красоты: одиночный огонь на грунте
 * теряется среди зданий, а поднятый на полсотни метров виден с воздуха
 * поверх крыш — с той стороны, с которой к городу и подходят.
 */
function beacon(out, x, z, h, c) {
  const b = partBox('mast', h);
  out.parts.push({ p: 'mast', x, z, y: 0, s: b.size, rot: 0, dim: 0.9 });
  out.lamps.push({ x, z, y: h, r: 0.007, c });
  out.boxes.push({ x, z, hw: b.hw, hd: b.hd, h });
}

/**
 * Планировка города целиком.
 *
 * @param seed целое: из него берётся всё случайное
 * @returns {parts, plates, lamps, boxes, pads, bound}
 */
export function cityPlan(seed) {
  const rnd = mulberry32(seed >>> 0);
  const range = (lo, hi) => lo + rnd() * (hi - lo);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const out = { parts: [], plates: [], lamps: [], boxes: [], pads: [], bound: CITY.bound };

  // --- Космопорт ------------------------------------------------------------
  // Перрон: общий бетон под площадками. По нему город и опознаётся
  // сверху — ровное светлое пятно среди тёмного грунта.
  const padSpan = ((CITY.pads - 1) * CITY.padGap) / 2;
  plate(out, CITY.port, 0, CITY.pad * 2.1, padSpan + CITY.pad * 1.6, APRON, 0.06);
  for (let i = 0; i < CITY.pads; i++) {
    pad(out, CITY.port, -padSpan + i * CITY.padGap, i + 1);
  }

  // Ангары и склады — за площадками, между ними и городом: разгрузили и
  // повезли, а не через полгорода.
  const hx = CITY.port - 0.34;
  for (let i = 0; i < 2; i++) {
    const z = -0.30 + i * 0.60;
    const b = partBox('hangar', 0.075);
    out.parts.push({ p: 'hangar', x: hx, z, y: 0, s: b.size, rot: Math.PI / 2 });
    out.boxes.push({ x: hx, z, hw: b.hd, hd: b.hw, h: b.h });
  }
  {
    const b = partBox('hangarRound', 0.065);
    out.parts.push({ p: 'hangarRound', x: hx - 0.16, z: 0, y: 0, s: b.size, rot: 0 });
    out.boxes.push({ x: hx - 0.16, z: 0, hw: b.hw, hd: b.hd, h: b.h });
  }

  // Хозяйство порта: энергоблок, баки, тарелки связи. Ставится россыпью
  // с северной стороны — там, где город к порту не подходит.
  const yard = [
    ['generator', 0.055, CITY.port - 0.10, padSpan + 0.30],
    ['tank', 0.048, CITY.port + 0.14, padSpan + 0.26],
    ['tanks', 0.036, CITY.port + 0.14, padSpan + 0.40],
    ['dish', 0.062, CITY.port - 0.26, -padSpan - 0.32],
    ['truss', 0.050, CITY.port + 0.12, -padSpan - 0.30],
    ['freighter', 0.062, CITY.port - 0.02, -padSpan - 0.46],
    ['rover', 0.022, CITY.port - 0.30, 0.16],
  ];
  for (const [key, h, x, z] of yard) {
    const b = partBox(key, h);
    const q = Math.floor(rnd() * 4);
    const swap = q & 1;
    out.parts.push({ p: key, x, z, y: 0, s: b.size, rot: q * (Math.PI / 2) });
    out.boxes.push({ x, z, h: b.h, hw: swap ? b.hd : b.hw, hd: swap ? b.hw : b.hd });
  }

  // Огни: по углам перрона и цепочкой вдоль захода с востока.
  for (const sz of [-1, 1]) {
    beacon(out, CITY.port + CITY.pad * 1.8, sz * (padSpan + CITY.pad * 1.5), 0.055, LIGHT_W);
    beacon(out, CITY.port - CITY.pad * 2.0, sz * (padSpan + CITY.pad * 1.5), 0.055, LIGHT_W);
  }
  for (let i = 1; i <= 6; i++) {
    plate(out, CITY.port + CITY.pad * 2.2 + i * 0.075, 0, 0.012, 0.004, LIGHT_W, 1, 0.00004);
  }

  // --- Монорельс ------------------------------------------------------------
  // Линия от порта через весь город. Она даёт то, чего не даёт ни одно
  // здание: длинную прямую, по которой видно масштаб, и повод смотреть
  // на город сбоку, а не только сверху.
  const railFrom = -CITY.edge + 0.1, railTo = CITY.port;
  // Секция пути задаётся ДЛИНОЙ, а не высотой: у неё наибольшая сторона
  // как раз длина, и секции обязаны стыковаться встык.
  const segSize = CITY.railSeg / (CITY_PARTS.railTrack.size[2] / 1000);
  for (let x = railFrom; x <= railTo; x += CITY.railSeg) {
    out.parts.push({
      p: 'railTrack', x, z: CITY.railZ, y: CITY.railY, s: segSize, rot: Math.PI / 2,
    });
  }
  for (let x = railFrom; x <= railTo; x += CITY.cell) {
    const b = partBox('railSupport', CITY.railY);
    out.parts.push({ p: 'railSupport', x, z: CITY.railZ, y: 0, s: b.size, rot: 0 });
    out.boxes.push({ x, z: CITY.railZ, hw: b.hw, hd: b.hd, h: b.h });
  }
  {
    // Один вагон стоит на линии: без него это эстакада, а не дорога.
    const b = partBox('railCar', 0.018);
    const x = -0.35;
    out.parts.push({
      p: 'railCar', x, z: CITY.railZ, y: CITY.railY + 0.004, s: b.size, rot: Math.PI / 2,
    });
    out.boxes.push({ x, z: CITY.railZ, hw: b.h, hd: b.hw, h: CITY.railY + b.h });
  }

  // --- Оборона --------------------------------------------------------------
  // Турели по периметру. Город на границе освоенного — не музей.
  for (let i = 0; i < 4; i++) {
    const a = TAU * (i / 4) + Math.PI / 4;
    const x = Math.cos(a) * (CITY.edge + 0.18), z = Math.sin(a) * (CITY.edge + 0.18);
    const b = partBox('turret', 0.030);
    out.parts.push({ p: 'turret', x, z, y: 0, s: b.size, rot: a });
    out.boxes.push({ x, z, hw: Math.max(b.hw, b.hd), hd: Math.max(b.hw, b.hd), h: b.h });
    out.lamps.push({ x, z, y: 0.034, r: 0.004, c: LIGHT_R });
  }

  // --- Кварталы и улицы -----------------------------------------------------
  //
  // Город застраивается ПОСЛЕДНИМ, когда порт, монорельс и оборона уже
  // стоят. Порядок здесь — это правило: дом не ставится там, где уже
  // что-то есть. Иначе квартал вырастает сквозь ангар, а корабль
  // врезается в воздух между ними — и проверить «ничего не пересекается»
  // становится нечем.
  const n = Math.ceil(CITY.edge / CITY.cell);
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const cx = i * CITY.cell, cz = j * CITY.cell;
      const r = Math.hypot(cx, cz);
      if (r > CITY.edge) continue;
      // Космопорт: восточный сектор оставлен под площадки целиком.
      if (cx > CITY.port - CITY.cell * 1.5 && Math.abs(cz) < 0.75) continue;
      // Улица монорельса: под опорами дома не ставят.
      if (Math.abs(cz - CITY.railZ) < CITY.cell * 0.6) continue;
      // Площадь в середине: город без пустого места читается как сплошной
      // массив, а по площади глаз находит центр.
      if (r < CITY.cell * 0.7) continue;

      // Плотность падает к окраине, иначе город обрывается стеной.
      const fill = r < CITY.core ? 1 : (r < CITY.mid ? 0.92 : 0.66);
      if (rnd() > fill) continue;

      const x = cx + range(-0.02, 0.02);
      const z = cz + range(-0.02, 0.02);
      const q = Math.floor(rnd() * 4);
      if (r < CITY.core) {
        // Центр: башни, и чем ближе к середине, тем выше. Так у города
        // появляется силуэт — то, по чему его узнают с воздуха.
        const tall = 0.42 - (r / CITY.core) * 0.14;
        building(out, pick(TOWERS), x, z, range(tall * 0.78, tall), q, 1, LIGHT_R);
      } else if (r < CITY.mid) {
        building(out, pick(BLOCKS), x, z, range(0.09, 0.215), q);
      } else {
        building(out, pick(LOWS), x, z, range(0.03, 0.075), q);
      }
    }
  }

  // --- Улицы ----------------------------------------------------------------
  // Полосы между рядами кварталов. Это плашки на грунте, а не геометрия:
  // улица — это цвет, и стоит она две грани.
  for (let i = -n; i <= n; i++) {
    const c = i * CITY.cell + CITY.cell * 0.5;
    if (Math.abs(c) > CITY.mid + CITY.cell) continue;
    const half = Math.sqrt(Math.max(0, CITY.edge * CITY.edge - c * c));
    plate(out, 0, c, half, 0.016, ROAD, 0, 0.00001);
    plate(out, c, 0, 0.016, half, ROAD, 0, 0.00001);
    // Фонари. Ночь на теле без атмосферы абсолютно чёрная — ни неба, ни
    // рассеянного света, — и город без фонарей с воздуха просто
    // отсутствует. Дальше их и видно раньше всего: цепочки огней
    // складываются в сетку улиц задолго до того, как различимы дома.
    for (let t = -half; t <= half; t += CITY.lampStep) {
      out.lamps.push({ x: t, z: c, y: 0.014, r: 0.0035, c: LIGHT_W });
      out.lamps.push({ x: c, z: t, y: 0.014, r: 0.0035, c: LIGHT_W });
    }
  }


  return out;
}

/**
 * Врезался ли корабль в постройку.
 *
 * Координаты — в осях города, километры. Коробки точные (развороты
 * кратны прямому углу), а запас `pad` — это половина корпуса: корабль
 * не точка, и биться он начинает бортом.
 *
 * Площадки проверять не нужно: на них ничего не стоит по построению —
 * это проверяется тестом, а не обещанием.
 */
export function cityBlocked(plan, x, y, z, pad = 0) {
  if (y > 0.4 + pad) return false;        // выше самой высокой башни
  for (const b of plan.boxes) {
    if (y > b.h + pad) continue;
    if (Math.abs(x - b.x) > b.hw + pad) continue;
    if (Math.abs(z - b.z) > b.hd + pad) continue;
    return true;
  }
  return false;
}

/** Ближайшая посадочная площадка к точке (оси города). */
export function nearestPad(plan, x, z) {
  let best = null, bd = Infinity;
  for (const p of plan.pads) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { pad: best, dist: bd } : null;
}

/** Сколько граней выйдет у города: бюджет проверяется тестом. */
export function cityFaces(plan) {
  let n = 0;
  for (const it of plan.parts) {
    const p = CITY_PARTS[it.p];
    for (let i = 0; i < p.faces.length;) { const k = p.faces[i]; i += k + 2; n++; }
  }
  return n + plan.plates.length + plan.lamps.length;
}
