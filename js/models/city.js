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
// ГОРОДА ОБЯЗАНЫ БЫТЬ НЕПОХОЖИМИ. Первая редакция раскладывала здания
// по одному и тому же генплану: круглый город, прямоугольная сетка,
// порт всегда на востоке. Два таких города рядом — это один город,
// показанный дважды, и никакой «процедурности» в нём нет. Поэтому
// здесь от семени зависит ВСЁ: размер, схема расселения, рисунок улиц
// внутри каждого района, сторона порта, изломанный контур застройки.
// Общего у двух городов остаётся ровно столько, сколько общего у двух
// настоящих: площадки размечены одинаково, потому что по ним садятся.
//
// ГОРОД — ЭТО РАЙОНЫ, А НЕ СЕТКА. Сплошная застройка радиусом 35 км
// означала бы миллион зданий и ни одного кадра в секунду. И это было бы
// ещё и неправдой: большой город в жизни — не монолит, а ядро с
// пригородами и пустырями между ними. Поэтому город раскладывается
// районами: у центра они наезжают друг на друга и дают сплошную
// застройку, к окраине расходятся. Отсюда же берётся изломанный
// контур — он не нарисован гармониками поверх круга, а получается сам,
// как объединение районов.
//
// БЮДЖЕТ ЖЁСТКИЙ (CITY.maxParts и соседи). Районы заполняются от центра
// наружу, и когда бюджет кончился, окраина просто не застраивается.
// Так у самого большого города страдает то, чего почти не видно, а не
// то, на что смотрят.
//
// РАЗВОРОТЫ ЛЮБЫЕ, А КОРОБКИ ТОЧНЫЕ. Улицы больше не параллельны осям
// города, значит и дома стоят под любым углом. Коробка столкновения
// поэтому хранит свой разворот (OBB), а проверка точки переводит её в
// оси коробки — это две умножения и по-прежнему ТОЧНО. Обводить
// повёрнутый дом прямой коробкой было нельзя: корабль бился бы о
// воздух по углам, а «нарисованное = настоящее» — главное правило
// города.
//
// ОСИ ГОРОДА: x — «восток», z — «север», y — вверх (местная вертикаль).
// Всё в километрах и в этих осях; на шар город ставит js/game/city.js.
// Разворот rot задан так же, как его понимает сборщик геометрии
// (js/gl/citymesh.js): местный +x смотрит по направлению (cos θ, sin θ)
// при rot = −θ. Для этого есть rotFor(), руками угол не выводить.
//
// ГРУНТ ПОД ГОРОДОМ ВЫРОВНЕН — это часть рельефа, а не подставка под
// модель: js/gl/terrain.js вписывает в поверхность ровную плиту. Её
// радиус берётся из плана (plan.plate), потому что город больше не
// одного размера.

import { makeRng } from '../core/rng.js';
import { CITY_PARTS } from './city.parts.js';

export const CITY = {
  // --- размер застройки, км (радиус)
  // Город в 70 км поперёк — это предел, за которым он перестаёт быть
  // городом: дальше пилот всё равно видит только то, что под носом.
  rMin: 1.9,
  rMax: 35,
  // --- кварталы
  cell: 0.27,        // км — базовый шаг застройки (улица входит в шаг)
  gap: 0.014,        // км — зазор между постройками: это ширина проезда,
  //                    а не запас на глазок
  // --- космопорт
  pad: 0.09,         // км — полуразмер посадочной площадки (180 м)
  padGap: 0.30,      // км — между центрами соседних площадок
  padsMin: 2,
  padsMax: 6,
  portClear: 1.25,   // км — радиус вокруг порта, куда не лезут кварталы
  // --- плита выровненного грунта
  margin: 0.9,       // км — ровный грунт за последним домом
  rim: 1.10,         // км — ширина перехода от плиты к рельефу
  wobble: 0.17,      // доля радиуса — насколько край плиты непрямой
  // --- монорельс
  railY: 0.052,      // км — высота пути
  railSeg: 0.08,     // км — длина секции пути
  // --- ночь
  lampStep: 0.135,   // км — шаг фонарей в центре (к окраине растёт)
  // --- бюджет геометрии
  maxParts: 9000,
  maxLamps: 5200,
  maxPlates: 4200,
  // --- поиск
  index: 0.36,       // км — ячейка пространственного указателя
};

/** Схемы расселения: подписи для карточки цели и для отладки. */
export const CITY_KINDS = {
  grid: 'решётка',
  ring: 'кольцевой',
  spine: 'линейный',
  spread: 'россыпь',
};

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

// Разворот, при котором местный +x детали смотрит по направлению
// (cos θ, sin θ). Знак — из соглашения сборщика геометрии.
const rotFor = (theta) => -theta;

const TOWERS = ['towerA', 'towerB', 'towerC'];
const BLOCKS = ['blockA', 'blockB', 'blockC', 'blockD'];
const LOWS = ['lowA', 'lowB', 'lowC', 'lowD', 'lowE', 'lowWide'];
const SHEDS = ['lowWide', 'hangar', 'lowA', 'lowC'];

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

// --- Пространственный указатель -------------------------------------------
//
// Коробок у большого города пять тысяч, и перебирать их все приходится
// дважды: при застройке (свободно ли место) и потом каждый кадр (не
// врезался ли корабль). Перебор списка давал бы двадцать пять миллионов
// сравнений на один город — это минуты на генерацию галактики. Ячейки
// делают и то, и другое поиском по месту.

const cellKey = (ix, iz) => ix * 8388608 + iz;

function indexPut(idx, i, box) {
  const c = idx.cell;
  const x0 = Math.floor((box.x - box.ax) / c), x1 = Math.floor((box.x + box.ax) / c);
  const z0 = Math.floor((box.z - box.az) / c), z1 = Math.floor((box.z + box.az) / c);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const k = cellKey(ix, iz);
      const a = idx.map.get(k);
      if (a) a.push(i);
      else idx.map.set(k, [i]);
    }
  }
}

/**
 * Обойти коробки, чьи ячейки задевает квадрат (x±r, z±r).
 * Одна коробка может попасться дважды — вызывающий обязан это терпеть.
 */
function indexScan(idx, x, z, r, fn) {
  const c = idx.cell;
  const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
  const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const a = idx.map.get(cellKey(ix, iz));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) if (fn(a[i])) return true;
    }
  }
  return false;
}

/**
 * Коробка постройки: центр, полуразмеры в СВОИХ осях и разворот.
 *
 * ax/az — описанный прямоугольник в осях города. Он нужен только для
 * поиска и для проверки «свободно ли место»: там осторожность дешевле
 * точности, а лишние полметра зазора между домами никто не заметит.
 */
function makeBox(x, z, hw, hd, h, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return {
    x, z, hw, hd, h, c, s,
    ax: Math.abs(hw * c) + Math.abs(hd * s),
    az: Math.abs(hw * s) + Math.abs(hd * c),
  };
}

/**
 * Свободно ли место под коробку (с зазором CITY.gap).
 *
 * Кроме уже стоящих построек проверяются ЗАПРЕТНЫЕ ПЯТНА — перрон и
 * створ захода. У них нет коробок столкновения (на перрон садятся, а не
 * врезаются в него), поэтому обычная проверка их не видела, и квартал
 * спокойно вырастал прямо на посадочной площадке. Ловится это только
 * тестом: с воздуха дом на площадке выглядит как дом у площадки.
 */
function free(out, box) {
  const r = Math.max(box.ax, box.az) + CITY.gap;
  for (const k of out.keep) {
    if (Math.abs(box.x - k.x) < box.ax + k.ax && Math.abs(box.z - k.z) < box.az + k.az) {
      return false;
    }
  }
  return !indexScan(out.index, box.x, box.z, r, (i) => {
    const b = out.boxes[i];
    return Math.abs(box.x - b.x) < box.ax + b.ax + CITY.gap
      && Math.abs(box.z - b.z) < box.az + b.az + CITY.gap;
  });
}

/** Запретное пятно: прямоугольник в местных осях, описанный по городу. */
function keepOut(out, cx, cz, rot, hw, hd) {
  const c = Math.abs(Math.cos(rot)), si = Math.abs(Math.sin(rot));
  out.keep.push({
    x: cx, z: cz,
    ax: hw * c + hd * si,
    az: hw * si + hd * c,
  });
}

function addBox(out, box) {
  out.boxes.push(box);
  indexPut(out.index, out.boxes.length - 1, box);
  if (box.h > out.tallest) out.tallest = box.h;
}

/**
 * Поставить здание: деталь плюс коробка столкновения.
 *
 * @returns габариты, если место нашлось, иначе null
 */
function building(out, key, x, z, height, rot, dim = 1, top = null) {
  if (out.parts.length >= CITY.maxParts) return null;
  const b = partBox(key, height);
  const box = makeBox(x, z, b.hw, b.hd, b.h, rot);
  if (!free(out, box)) return null;
  out.parts.push({ p: key, x, z, y: 0, s: b.size, rot, dim, b: out.boxes.length });
  addBox(out, box);
  // Огонь на крыше. Он и в жизни там стоит по той же причине, по которой
  // нужен здесь: показать, где кончается здание, тому, кто летит.
  if (top && out.lamps.length < CITY.maxLamps) {
    out.lamps.push({ x, z, y: b.h + 0.004, r: 0.005, c: top });
  }
  return b;
}

/** Плашка на грунте: перрон, улица, разметка, огонь. */
function plate(out, x, z, hw, hd, c, glow = 0, lift = 0, rot = 0) {
  if (out.plates.length >= CITY.maxPlates) return;
  out.plates.push({ x, z, hw, hd, c, glow, y: lift, rot });
}

const lamp = (out, x, z, y, r, c) => {
  if (out.lamps.length < CITY.maxLamps) out.lamps.push({ x, z, y, r, c });
};

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
function pad(out, x, z, n, rot) {
  const R = CITY.pad;
  out.pads.push({ x, z, r: R, n });
  plate(out, x, z, R, R, PAD, 0, 0.00002, rot);
  // Рамка по краю.
  const w = 0.006;
  for (const s of [-1, 1]) {
    const e = local(x, z, rot, s * (R - w), 0);
    plate(out, e.x, e.z, w, R, PAINT, 0.7, 0.00004, rot);
    const f = local(x, z, rot, 0, s * (R - w));
    plate(out, f.x, f.z, R - w * 2, w, PAINT, 0.7, 0.00004, rot);
  }
  // Крест в середине: по нему целятся, когда площадка уже под брюхом.
  plate(out, x, z, R * 0.42, w * 0.8, PAINT, 0.55, 0.00004, rot);
  plate(out, x, z, w * 0.8, R * 0.42, PAINT, 0.55, 0.00004, rot);
  // Огни по углам: зелёные со стороны захода, красные с обратной.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const g = local(x, z, rot, sx * R * 0.92, sz * R * 0.92);
      plate(out, g.x, g.z, 0.011, 0.011, sx > 0 ? LIGHT_G : LIGHT_R, 1, 0.00006, rot);
    }
  }
}

/**
 * Огонь на мачте. Мачта нужна не для красоты: одиночный огонь на грунте
 * теряется среди зданий, а поднятый на полсотни метров виден с воздуха
 * поверх крыш — с той стороны, с которой к городу и подходят.
 */
function beacon(out, x, z, h, c) {
  if (building(out, 'mast', x, z, h, 0, 0.9)) lamp(out, x, z, h, 0.007, c);
}

/**
 * Точка местных осей (lx, lz) в осях города. Соглашение — см. заголовок.
 *
 * Возвращает НОВЫЙ объект, а не общий на всех. Планировка считается
 * один раз на город, и сэкономленные здесь аллокации не стоят того
 * класса ошибок, который даёт общий буфер: достаточно позвать local()
 * второй раз до того, как прочитана первая точка, и отрезок дороги
 * схлопнется в ноль.
 */
function local(cx, cz, rot, lx, lz) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}

/**
 * Полоса по грунту от точки до точки: улица между районами, дорога к
 * порту. Плашка одна, повёрнутая, а не цепочка квадратов — повороты у
 * плашек как раз ради дорог и заведены.
 */
function road(out, x0, z0, x1, z1, w, c = ROAD) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  plate(out, (x0 + x1) / 2, (z0 + z1) / 2, len / 2, w, c, 0, 0.00001,
    rotFor(Math.atan2(dz, dx)));
}

// --- Размер и схема --------------------------------------------------------

/**
 * Радиус застройки.
 *
 * Распределение намеренно смещено к малым: городов-миллионников и в
 * жизни единицы, а если каждый второй будет в 70 км, то 70 км
 * перестанут удивлять. Четыре ступени вместо гладкой кривой — чтобы
 * «посёлок», «город», «большой» и «громадина» читались как разные
 * вещи, а не как один размер с шумом.
 */
function pickRadius(rng, limitKm) {
  const u = rng.next();
  let lo, hi;
  if (u < 0.46) { lo = CITY.rMin; hi = 4.5; }          // посёлок: 4…9 км поперёк
  else if (u < 0.78) { lo = 4.5; hi = 10; }            // город: 9…20 км
  else if (u < 0.94) { lo = 10; hi = 20; }             // большой: 20…40 км
  else { lo = 20; hi = CITY.rMax; }                    // громадина: 40…70 км
  return clamp(rng.range(lo, hi), CITY.rMin, Math.max(CITY.rMin, limitKm));
}

/**
 * Схема расселения. Большому городу кольца и россыпь идут чаще:
 * тридцатикилометровая «решётка» — это не город, а разлинованная
 * равнина, таких не бывает.
 */
function pickKind(rng, R) {
  const big = clamp((R - 3) / 14, 0, 1);
  const w = [
    ['grid', 0.45 - big * 0.35],
    ['ring', 0.20 + big * 0.10],
    ['spine', 0.25 - big * 0.05],
    ['spread', 0.10 + big * 0.30],
  ];
  let t = 0;
  for (const p of w) t += p[1];
  let u = rng.next() * t;
  for (const p of w) { if ((u -= p[1]) <= 0) return p[0]; }
  return 'grid';
}

/**
 * Районы: где они стоят и какие они.
 *
 * Общее для всех схем: чем дальше от середины, тем район мельче и
 * реже — так получается ядро с пригородами. Различаются схемы тем,
 * КУДА кладутся точки: решётка жмёт их к середине, кольцевой сажает на
 * кольца, линейный растягивает вдоль оси, россыпь разбрасывает с
 * пустырями.
 */
function layoutDistricts(rng, kind, R) {
  // Сколько районов и какого размера — арифметика, а не вкусовщина.
  //
  // Первым делом размер: район обязан остаться соразмерен человеку
  // (километр-три), сколько бы город ни занимал, — иначе «район»
  // перестаёт что-либо значить. И только потом СКОЛЬКО ИХ ВЛЕЗЕТ:
  // 0.75·(R/dr)² — это площадь города, делённая на площадь района, с
  // поправкой на то, что круги не тайлят плоскость.
  //
  // Обратный порядок (сначала число, потом размер из доли покрытия) уже
  // пробовался и провалился: у города в девять километров выходило пять
  // районов по три, которые физически не помещались рядом, и вставал
  // ОДИН — то есть город снова был кругом.
  // Доля от радиуса маленькая нарочно: район — это район, а не «половина
  // города». При R·0.45 у городка в шесть километров выходил ОДИН район
  // радиусом почти во весь город, и никакая схема расселения на нём уже
  // не читалась — ни кольца, ни ось, ни россыпь.
  const nominal = clamp(R * 0.30, 0.75, 2.6);
  const want = clamp(Math.round(0.75 * (R / nominal) * (R / nominal)), 1, 34);
  const axis = rng.range(0, TAU);
  const rot0 = rng.range(0, TAU);
  // Внешний контур: районы не выходят за изломанную границу, а не за
  // круг. Без этого у большого города районы ложились ровно по диску, и
  // сверху он читался штампованным кругом — сколько бы схем расселения
  // мы ни придумали.
  const bound = edgeWave(rng, 0.70);
  const narrow = rng.range(0.22, 0.46);        // сжатие линейного города
  const rings = 1 + Math.floor(clamp(R / 6, 0, 3));
  const ds = [];

  // Плотность упаковки: 1 — районы касаются, меньше — наезжают и дают
  // сплошную застройку, больше — между ними пустыри.
  //
  // И размер района делится на неё же. Без этого «россыпь» сама себя
  // убивала: районы прежнего размера разъезжались на расстояние больше
  // радиуса города, и вставал РОВНО ОДИН — то есть самая рассыпчатая
  // схема давала самый монолитный город. Теперь число районов у всех
  // схем одно, а различаются они тем, наезжают районы друг на друга
  // (сплошной город) или стоят порознь (пустыри между посёлками).
  const pack = kind === 'grid' ? 0.70 : (kind === 'spread' ? 1.10 : 0.87);
  const base = nominal / pack;

  for (let i = 0; i < want * 12 && ds.length < want; i++) {
    const first = ds.length === 0;
    let rr, ang;
    if (first) { rr = 0; ang = 0; } else if (kind === 'ring') {
      const k = 1 + Math.floor(rng.next() * rings);
      ang = rng.range(0, TAU);
      // Кольца тоже изломаны. Ровные концентрические кольца — это
      // единственная схема, которая ухитрялась выйти круглой даже при
      // изломанной внешней границе: радиус кольца один на все
      // направления, и внешнее кольцо само рисовало окружность.
      rr = bound(ang) * (R * k) / (rings + 0.35) * rng.range(0.92, 1.08);
    } else if (kind === 'spine') {
      const t = rng.range(-1, 1);
      const off = rng.range(-1, 1) * narrow;
      rr = 0; ang = 0;
      const px = Math.cos(axis) * t * R - Math.sin(axis) * off * R;
      const pz = Math.sin(axis) * t * R + Math.cos(axis) * off * R;
      rr = Math.hypot(px, pz);
      ang = Math.atan2(pz, px);
    } else {
      // Корень — чтобы точки ложились равномерно по площади, а не
      // сбивались в середину.
      rr = R * Math.pow(rng.next(), kind === 'grid' ? 0.75 : 0.55);
      ang = rng.range(0, TAU);
    }
    if (rr > R * bound(ang)) continue;

    const near = clamp(1 - rr / R, 0, 1);
    // К середине районы крупнее: так ядро выходит сплошным, а окраина
    // рассыпается на посёлки — и это и есть силуэт города сверху.
    const dr = clamp(base * rng.range(0.85, 1.15) * (0.85 + near * 0.3), 0.55, 3.2);
    const x = Math.cos(ang) * rr, z = Math.sin(ang) * rr;
    let ok = true;
    for (const d of ds) {
      if (Math.hypot(d.x - x, d.z - z) < (d.r + dr) * pack) { ok = false; break; }
    }
    if (!ok) continue;

    // Рисунок улиц внутри района. У «решётки» он общий на весь город —
    // это и делает её решёткой; у остальных свой у каждого района, и
    // именно от этого два города перестают быть похожими.
    const rot = kind === 'grid' ? rot0 : rng.range(0, TAU);
    let pat = 'grid';
    if (kind === 'ring' && !first) pat = rng.chance(0.6) ? 'rings' : 'grid';
    else if (rng.chance(near > 0.6 ? 0.12 : 0.34)) pat = 'rows';
    else if (rng.chance(0.18)) pat = 'rings';

    // Район ВЫТЯНУТ. Круглый район сверху читается диском, и десяток
    // дисков читается десятком дисков — сколько на них ни наводи волну
    // по краю. Настоящие кварталы вытянуты вдоль своих улиц, и вытянуть
    // их здесь стоит одного числа.
    // Вытягивание не должно съедать площадь: dr — это СРЕДНИЙ радиус,
    // большая полуось растёт, малая убывает, и застроенная площадь
    // остаётся той, которую считала раскладка.
    const aspect = rng.range(0.45, 1);
    ds.push({
      x, z, r: dr / Math.sqrt(aspect), aspect, rot, pat, near, kind: '',
    });
  }

  // Тип застройки — ПО МЕСТУ В ОЧЕРЕДИ, а не по расстоянию.
  //
  // По расстоянию («ближе такой-то доли радиуса — значит центр») у
  // города в тридцать километров центром оказывалась треть города:
  // пятнадцать километров сплошных небоскрёбов, чего не бывает нигде.
  // Ядро — это один-три района, сколько бы город ни занимал; остальное
  // кварталы, дальше склады.
  const byNear = ds.slice().sort((a, b) => b.near - a.near);
  const coreN = clamp(Math.round(ds.length * 0.1), 1, 3);
  const blocksN = Math.max(1, Math.round(ds.length * 0.45));
  byNear.forEach((d, i) => {
    if (i < coreN) { d.kind = 'core'; if (d.pat === 'rows') d.pat = 'grid'; return; }
    if (d.pat === 'rows') { d.kind = 'rows'; return; }
    d.kind = i < coreN + blocksN ? 'blocks' : 'rows';
  });
  return ds;
}

// --- Застройка района ------------------------------------------------------

/**
 * Изломанный край района: тот же приём, что у контура города в целом,
 * только внутри. Круглый район виден кругом даже среди других круглых.
 */
function edgeWave(rng, scale = 1) {
  const a1 = rng.range(0.06, 0.20) * scale, p1 = rng.range(0, TAU);
  const a2 = rng.range(0.04, 0.16) * scale, p2 = rng.range(0, TAU);
  const a3 = rng.range(0.02, 0.10) * scale, p3 = rng.range(0, TAU);
  return (ang) => 1 + a1 * Math.cos(ang + p1) + a2 * Math.cos(2 * ang + p2)
    + a3 * Math.cos(3 * ang + p3);
}

/**
 * Высоты квартала.
 *
 * Распределение у кварталов НЕЛИНЕЙНОЕ (u²), и это главное здесь.
 * Равномерное давало город, где каждый второй дом выше полутораста
 * метров, — такого силуэта не бывает даже в Гонконге. В жизни высоты
 * распределены как деньги: много низких, мало высоких, и именно из-за
 * этого немногие башни читаются как башни.
 */
function heightsFor(kind, ctx, rng) {
  if (kind === 'core') return () => ctx.tall * (0.45 + 0.55 * Math.pow(rng.next(), 0.7));
  if (kind === 'blocks') {
    const hi = 0.10 + ctx.tall * 0.30;
    return () => 0.040 + hi * rng.next() * rng.next();
  }
  return () => rng.range(0.025, 0.070);
}

function keyFor(kind, rng) {
  if (kind === 'core') return rng.pick(TOWERS);
  if (kind === 'blocks') return rng.chance(0.78) ? rng.pick(BLOCKS) : rng.pick(LOWS);
  return rng.pick(LOWS);
}

/** Застроить один район и провести в нём улицы. */
function fillDistrict(out, rng, d, ctx) {
  const wave = edgeWave(rng);
  const height = heightsFor(d.kind, ctx, rng);
  const beacons = d.kind === 'core';
  // Шаг квартала. У ядра он мельче (дома стоят плотно), у складов —
  // вытянутый: ряды длинных строений вдоль проезда.
  const step = d.kind === 'core'
    ? Math.max(CITY.cell, ctx.tall * 0.62) * rng.range(0.85, 1.0)
    : CITY.cell * rng.range(1.0, 1.35);
  const stepZ = d.pat === 'rows' ? step * rng.range(1.5, 2.4) : step;
  const dens = d.kind === 'core' ? 0.96 : (d.kind === 'blocks' ? 0.86 : 0.62);
  // Эллипс, а не круг: полуось поперёк улиц короче (d.aspect), и на
  // неё же наведена волна края.
  const rz = d.r * d.aspect;
  const inside = (lx, lz) => {
    const q = (lx / d.r) * (lx / d.r) + (lz / rz) * (lz / rz);
    const w = wave(Math.atan2(lz, lx));
    return q <= w * w;
  };

  if (d.pat === 'rings') {
    // Кольцевой район: дома стоят по дугам вокруг площади, развёрнутые
    // вдоль дуги. Сетка здесь смотрелась бы вставкой из другого города.
    const rings = Math.max(1, Math.round(d.r / step));
    for (let k = 1; k <= rings; k++) {
      const rr = (d.r * k) / (rings + 0.3);
      const n = Math.max(4, Math.round((TAU * rr) / step));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + k * 0.37;
        if (!rng.chance(dens)) continue;
        const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
        if (!inside(lx, lz)) continue;
        const p = local(d.x, d.z, d.rot, lx, lz);
        const h = height();
        building(out, keyFor(d.kind, rng), p.x, p.z, h,
          rotFor(Math.atan2(p.z - d.z, p.x - d.x) + Math.PI / 2),
          1, beacons && h > ctx.tall * 0.8 ? LIGHT_R : null);
      }
      // Кольцевая улица: дуга из хорд.
      const segs = Math.max(8, Math.round(rr * 8));
      const rw = rr + step * 0.5;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
        const p0 = local(d.x, d.z, d.rot, Math.cos(a0) * rw, Math.sin(a0) * rw);
        const x0 = p0.x, z0 = p0.z;
        const p1 = local(d.x, d.z, d.rot, Math.cos(a1) * rw, Math.sin(a1) * rw);
        road(out, x0, z0, p1.x, p1.z, 0.013);
        if (ctx.lampEvery(rr)) lamp(out, x0, z0, 0.014, 0.0035, LIGHT_W);
      }
    }
    return;
  }

  const n = Math.ceil(d.r / step) + 1;
  const nz = Math.ceil(rz / stepZ) + 1;
  for (let j = -nz; j <= nz; j++) {
    for (let i = -n; i <= n; i++) {
      const lx = i * step, lz = j * stepZ;
      if (!inside(lx, lz)) continue;
      if (!rng.chance(dens)) continue;
      const p = local(d.x, d.z, d.rot,
        lx + rng.range(-0.02, 0.02), lz + rng.range(-0.02, 0.02));
      const h = height();
      const key = d.pat === 'rows' ? rng.pick(SHEDS) : keyFor(d.kind, rng);
      building(out, key, p.x, p.z, h,
        d.rot + Math.floor(rng.next() * 4) * (Math.PI / 2),
        1, beacons && h > ctx.tall * 0.8 ? LIGHT_R : null);
    }
  }

  // Улицы района: полосы между рядами. Это плашки, а не геометрия —
  // улица есть цвет, и стоит она две грани.
  for (let i = -n; i <= n; i++) {
    const c = i * step + step * 0.5;
    if (Math.abs(c) > d.r) continue;

    // Улица кончается там же, где застройка: на краю эллипса.
    const halfX = d.r * Math.sqrt(Math.max(0, 1 - (c / rz) * (c / rz)));
    const halfZ = rz * Math.sqrt(Math.max(0, 1 - (c / d.r) * (c / d.r)));
    const half = halfX;
    const a0 = local(d.x, d.z, d.rot, -half, c);
    const ax = a0.x, az = a0.z;
    const a1 = local(d.x, d.z, d.rot, half, c);
    road(out, ax, az, a1.x, a1.z, 0.016);
    const b0 = local(d.x, d.z, d.rot, c, -halfZ);
    const bx = b0.x, bz = b0.z;
    const b1 = local(d.x, d.z, d.rot, c, halfZ);
    road(out, bx, bz, b1.x, b1.z, 0.016);
    // Фонари. Ночь на теле без атмосферы абсолютно чёрная — ни неба, ни
    // рассеянного света, — и город без фонарей с воздуха просто
    // отсутствует. В центре они частые, на окраине редкие: бюджет огней
    // тратится там, где на них смотрят.
    const st = ctx.lampStep(d);
    for (let t = -half; t <= half; t += st) {
      const q = local(d.x, d.z, d.rot, t, c);
      lamp(out, q.x, q.z, 0.014, 0.0035, LIGHT_W);
      const w = local(d.x, d.z, d.rot, c, t);
      lamp(out, w.x, w.z, 0.014, 0.0035, LIGHT_W);
    }
  }
}

// --- Космопорт -------------------------------------------------------------

function buildPort(out, rng, R, port) {
  const { x, z, rot, pads, ang } = port;
  const padSpan = ((pads - 1) * CITY.padGap) / 2;
  // Перрон: общий бетон под площадками. По нему город и опознаётся
  // сверху — ровное светлое пятно среди тёмного грунта.
  plate(out, x, z, padSpan + CITY.pad * 1.6, CITY.pad * 2.1, APRON, 0.06, 0, rot);
  for (let i = 0; i < pads; i++) {
    const p = local(x, z, rot, -padSpan + i * CITY.padGap, 0);
    pad(out, p.x, p.z, i + 1, rot);
  }

  // Перрон и створ захода — запретные пятна: на них не встанет ни
  // квартал, ни собственное хозяйство порта.
  keepOut(out, x, z, rot, (padSpan + CITY.pad * 1.6) * 1.12, CITY.pad * 2.4);
  {
    const a = local(x, z, rot, 0, CITY.pad * 2.2 + 0.28);
    keepOut(out, a.x, a.z, rot, 0.26, 0.30);
  }

  // Ангары и склады — между площадками и городом: разгрузили и повезли,
  // а не через полгорода. «Внутрь» здесь — местный −z.
  for (let i = 0; i < 2; i++) {
    const p = local(x, z, rot, -0.30 + i * 0.60, -0.34);
    building(out, 'hangar', p.x, p.z, 0.075, rot);
  }
  {
    const p = local(x, z, rot, 0, -0.50);
    building(out, 'hangarRound', p.x, p.z, 0.065, rot);
  }

  // Хозяйство порта: энергоблок, баки, тарелки связи, стоянка.
  const yard = [
    ['generator', 0.055, -padSpan - 0.30, -0.10],
    ['tank', 0.048, -padSpan - 0.26, 0.14],
    ['tanks', 0.036, -padSpan - 0.40, 0.14],
    ['dish', 0.062, padSpan + 0.32, -0.26],
    ['truss', 0.050, padSpan + 0.30, 0.12],
    ['freighter', 0.062, padSpan + 0.46, -0.02],
    ['rover', 0.022, -0.16, -0.30],
  ];
  for (const [key, h, lx, lz] of yard) {
    const p = local(x, z, rot, lx, lz);
    building(out, key, p.x, p.z, h, rot + Math.floor(rng.next() * 4) * (Math.PI / 2));
  }

  // Огни: по углам перрона и цепочкой вдоль захода — наружу от города.
  for (const s of [-1, 1]) {
    for (const d of [-1, 1]) {
      const p = local(x, z, rot, s * (padSpan + CITY.pad * 1.5), d * CITY.pad * 1.9);
      beacon(out, p.x, p.z, 0.055, LIGHT_W);
    }
  }
  for (let i = 1; i <= 6; i++) {
    const p = local(x, z, rot, 0, CITY.pad * 2.2 + i * 0.075);
    plate(out, p.x, p.z, 0.012, 0.004, LIGHT_W, 1, 0.00004, rot);
  }
  return { x, z, ang };
}

// --- План целиком ----------------------------------------------------------

/**
 * Планировка города целиком.
 *
 * @param seed целое: из него берётся всё
 * @param limitKm предел радиуса застройки — его ставит тело (плита не
 *   может занять пол-луны, js/game/city.js)
 */
export function cityPlan(seed, limitKm = CITY.rMax) {
  const rng = makeRng(seed >>> 0);
  const out = {
    seed: seed >>> 0,
    kind: '',
    radius: 0,
    plate: 0,
    tallest: 0,
    parts: [], plates: [], lamps: [], boxes: [], pads: [], districts: [],
    keep: [],
    index: { cell: CITY.index, map: new Map() },
  };

  const R = pickRadius(rng, limitKm);
  const kind = pickKind(rng, R);
  out.kind = kind;
  // Башни выше в больших городах: силуэт — это первое, по чему город
  // отличают от посёлка, и триста метров в посёлке на четыре километра
  // смотрелись бы насмешкой.
  const tall = 0.17 + 0.31 * clamp((R - CITY.rMin) / 18, 0, 1);
  const ctx = {
    R,
    tall,
    lampStep: (d) => CITY.lampStep * (1 + 6 * (1 - d.near)),
    lampEvery: (rr) => rr > 0.2,
  };

  const districts = layoutDistricts(rng, kind, R);
  out.districts = districts;

  // Порт ставится ПЕРВЫМ, до застройки: кварталы обойдут его сами
  // (проверкой места), а вот он их обойти уже не смог бы — площадку
  // некуда двигать, когда вокруг стоят дома.
  const pads = clamp(CITY.padsMin + Math.round(R / 9), CITY.padsMin, CITY.padsMax);
  // Полоса отчуждения вокруг порта соразмерна городу: постоянные 1.25 км
  // в посёлке отодвигали космодром дальше собственной околицы.
  const clear = clamp(0.5 + R * 0.06, 0.5, CITY.portClear);
  let portAng = rng.range(0, TAU);
  let portDist = R * rng.range(0.55, 0.92) + 0.5;
  // Порт выносится за ближайший район: перрон в сплошной застройке — это
  // снесённый квартал, а не космодром.
  for (const d of districts) {
    const dd = Math.hypot(d.x - Math.cos(portAng) * portDist, d.z - Math.sin(portAng) * portDist);
    if (dd < d.r + clear) portDist += d.r + clear - dd;
  }
  const port = {
    x: Math.cos(portAng) * portDist,
    z: Math.sin(portAng) * portDist,
    ang: portAng,
    rot: rotFor(portAng + Math.PI / 2),
    pads,
  };
  buildPort(out, rng, R, port);
  out.port = { x: port.x, z: port.z };

  // Монорельс от порта к ядру. Только там, где ему есть что соединять:
  // в посёлке на четыре километра эстакада длиннее самого посёлка.
  if (R > 3.2) {
    railway(out, port.x, port.z, districts[0].x, districts[0].z);
  }

  // Оборона по периметру: город на границе освоенного — не музей.
  const turrets = clamp(3 + Math.round(R / 7), 3, 8);
  for (let i = 0; i < turrets; i++) {
    const a = (TAU * i) / turrets + rng.range(0, 0.4);
    const rr = R * rng.range(0.92, 1.04) + 0.25;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (building(out, 'turret', x, z, 0.030, rotFor(a))) {
      lamp(out, x, z, 0.034, 0.004, LIGHT_R);
    }
  }

  // Дороги между районами: каждый район соединяется с ближайшим уже
  // соединённым. Это даёт связное дерево дорог и ни одного района,
  // брошенного посреди пустыря без подъезда.
  const linked = [0];
  for (let i = 1; i < districts.length; i++) {
    const d = districts[i];
    let best = 0, bd = Infinity;
    for (const j of linked) {
      const q = Math.hypot(districts[j].x - d.x, districts[j].z - d.z);
      if (q < bd) { bd = q; best = j; }
    }
    road(out, d.x, d.z, districts[best].x, districts[best].z, 0.022);
    linked.push(i);
  }
  // И подъезд к порту от ближайшего района.
  {
    let best = districts[0], bd = Infinity;
    for (const d of districts) {
      const q = Math.hypot(d.x - port.x, d.z - port.z);
      if (q < bd) { bd = q; best = d; }
    }
    road(out, port.x, port.z, best.x, best.z, 0.024);
  }

  // Застройка идёт ОТ СЕРЕДИНЫ НАРУЖУ: бюджет кончится на окраине, а
  // не в центре, на который смотрят.
  const order = districts.slice().sort((a, b) => b.near - a.near);
  for (const d of order) fillDistrict(out, rng, d, ctx);

  // Габарит: по нему город берут в прицел, и он обязан накрывать всё
  // поставленное — в том числе турель, которая стоит за околицей.
  // Считается по УГЛУ коробки (hypot(hw, hd)), а не по её описанному
  // прямоугольнику: у квадрата описанный полуразмер равен стороне, а
  // угол дальше неё в 1.41 раза — и геометрия вылезала за габарит,
  // которым город берут в прицел. Плашки и огни считаются тоже: улица
  // уходит за последний дом, и обрезать её габаритом нельзя.
  let far = 0;
  for (const b of out.boxes) far = Math.max(far, Math.hypot(b.x, b.z) + Math.hypot(b.hw, b.hd));
  for (const p of out.pads) far = Math.max(far, Math.hypot(p.x, p.z) + p.r * Math.SQRT2);
  for (const p of out.plates) far = Math.max(far, Math.hypot(p.x, p.z) + Math.hypot(p.hw, p.hd));
  for (const l of out.lamps) far = Math.max(far, Math.hypot(l.x, l.z) + l.r);
  out.radius = Math.max(far, CITY.rMin);
  out.plate = out.radius + CITY.margin;
  out.bound = out.radius;
  return out;
}

/** Монорельс: путь на опорах и один вагон на нём. */
function railway(out, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.2) return;
  const ang = Math.atan2(dz, dx);
  const rot = rotFor(ang);
  const ux = dx / len, uz = dz / len;
  // Секция пути задаётся ДЛИНОЙ, а не высотой: у неё наибольшая сторона
  // как раз длина, и секции обязаны стыковаться встык.
  const segSize = CITY.railSeg / (CITY_PARTS.railTrack.size[2] / 1000);
  for (let t = 0; t <= len; t += CITY.railSeg) {
    if (out.parts.length >= CITY.maxParts) return;
    out.parts.push({
      p: 'railTrack', x: x0 + ux * t, z: z0 + uz * t, y: CITY.railY,
      s: segSize, rot: rot + Math.PI / 2, dim: 1, b: -1,
    });
  }
  for (let t = 0; t <= len; t += CITY.cell) {
    building(out, 'railSupport', x0 + ux * t, z0 + uz * t, CITY.railY, rot);
  }
  {
    // Один вагон стоит на линии: без него это эстакада, а не дорога.
    const b = partBox('railCar', 0.018);
    const t = len * 0.35;
    const x = x0 + ux * t, z = z0 + uz * t;
    const r = rot + Math.PI / 2;
    const box = makeBox(x, z, b.hw, b.hd, CITY.railY + b.h, r);
    if (free(out, box) && out.parts.length < CITY.maxParts) {
      out.parts.push({
        p: 'railCar', x, z, y: CITY.railY + 0.004, s: b.size, rot: r, dim: 1,
        b: out.boxes.length,
      });
      addBox(out, box);
    }
  }
}

/**
 * Врезался ли корабль в постройку.
 *
 * Координаты — в осях города, километры. Коробки ТОЧНЫЕ: точка
 * переводится в оси коробки её же разворотом, и запас `pad` — это
 * половина корпуса, а не поправка на кривизну проверки.
 *
 * Площадки проверять не нужно: на них ничего не стоит по построению —
 * это проверяется тестом, а не обещанием.
 */
export function cityBlocked(plan, x, y, z, pad = 0) {
  if (y > plan.tallest + pad) return false;
  return indexScan(plan.index, x, z, pad, (i) => {
    const b = plan.boxes[i];
    if (y > b.h + pad) return false;
    const dx = x - b.x, dz = z - b.z;
    const lx = dx * b.c - dz * b.s;
    if (Math.abs(lx) > b.hw + pad) return false;
    const lz = dx * b.s + dz * b.c;
    return Math.abs(lz) <= b.hd + pad;
  });
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
