// Галактика: несколько звёздных систем и расстояния между ними.
//
// Здесь НЕТ ни планет, ни тел — только «где какая звезда и какая она».
// Система целиком собирается отдельно (js/game/world.js) и ровно в тот
// момент, когда корабль в неё прилетает: держать в памяти всю галактику
// нельзя, одна система — это сотни мешей и плиток поверхности.
//
// Поэтому модуль намеренно лёгкий и НИЧЕГО не импортирует из world.js.
// Зависимость идёт в одну сторону: world.js спрашивает у галактики
// описание системы, галактика про тела не знает вовсе.

import { makeRng, makeName } from '../core/rng.js';

const TAU = Math.PI * 2;

/** Семя родной системы. С неё начинается игра. */
export const HOME_SEED = 0x1a7e;

/**
 * Классы звёзд. Светимость здесь — не украшение: по ней считается
 * радиус обитаемой зоны, а по нему расставляются планеты и меряются
 * температуры (js/game/bodyinfo.js). Поэтому у красного карлика система
 * съёжена в несколько сот тысяч километров, а у белой — растянута на
 * десяток миллионов, и это видно и на карте, и по времени перелётов.
 *
 * Величины взяты от настоящих классов, но сжаты: у настоящего M-карлика
 * светимость 0.01 солнечной, и обитаемая зона попала бы корабельным
 * приборам в ноль.
 */
export const STAR_CLASSES = [
  { id: 'M', ru: 'красный карлик', temp: 3200, lum: 0.15, radius: 30000, color: [255, 168, 112], weight: 3 },
  { id: 'K', ru: 'оранжевый карлик', temp: 4400, lum: 0.40, radius: 46000, color: [255, 202, 150], weight: 3 },
  { id: 'G', ru: 'жёлтый карлик', temp: 5600, lum: 1.00, radius: 62000, color: [255, 226, 168], weight: 3 },
  { id: 'F', ru: 'бело-жёлтая', temp: 6800, lum: 2.20, radius: 76000, color: [255, 246, 224], weight: 2 },
  { id: 'A', ru: 'белая', temp: 9000, lum: 5.00, radius: 92000, color: [214, 228, 255], weight: 1 },
];

/** Родная звезда остаётся жёлтым карликом: с ней откалибровано всё. */
export const HOME_CLASS = STAR_CLASSES[2];

// Орбита, на которой равновесная температура равна 255 K. У родной
// системы это орбита океанической планеты — то самое число, по которому
// откалиброваны все температуры в игре. Отсюда и масштаб остальных
// систем: зона двигается как корень из светимости, потому что поток
// падает как квадрат расстояния.
export const HAB_HOME = 620000;
export const habitableOf = (cls) => HAB_HOME * Math.sqrt(cls.lum);

// Галактика намеренно маленькая и плотная. Смысл прыжка — смена
// обстановки, а не картография: два десятка систем превратили бы карту
// в список, по которому надо листать, и ни одну из них игрок не узнал бы
// в лицо. Семь — это столько, сколько помнишь по именам.
export const SYSTEM_COUNT = 7;
export const SPREAD = 26;        // световых лет от центра
export const MIN_APART = 5;      // не ближе этого друг к другу

// Прыжок длится десятки секунд, и это не физика, а укрытие: под тоннелем
// старая система выгружается, а новая собирается (см. js/game/warp.js).
// Поэтому время считается от расстояния, но зажато в узкий диапазон —
// короче не успеть, длиннее скучно.
export const WARP_BASE = 16;     // с
export const WARP_PER_LY = 0.6;
export const WARP_MIN = 20;
export const WARP_MAX = 34;

/** Сколько секунд идёт прыжок между двумя системами. */
export function warpSeconds(a, b) {
  const d = systemDistance(a, b);
  return Math.max(WARP_MIN, Math.min(WARP_MAX, WARP_BASE + WARP_PER_LY * d));
}

/** Расстояние между системами, световых лет. */
export function systemDistance(a, b) {
  return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
}

/**
 * Направление от одной системы к другой — единичный вектор в тех же
 * осях, что и мир. По нему корабль и центрируется перед прыжком:
 * галактические координаты кладутся прямо на мировые, без поворота,
 * иначе «туда» на карте и «туда» в кабине означали бы разное.
 */
export function systemDir(from, to, out = { x: 0, y: 0, z: 0 }) {
  const dx = to.pos.x - from.pos.x, dy = to.pos.y - from.pos.y, dz = to.pos.z - from.pos.z;
  const L = Math.hypot(dx, dy, dz) || 1;
  out.x = dx / L; out.y = dy / L; out.z = dz / L;
  return out;
}

const pickClass = (rng) => {
  const total = STAR_CLASSES.reduce((s, c) => s + c.weight, 0);
  let t = rng.range(0, total);
  for (const c of STAR_CLASSES) { t -= c.weight; if (t <= 0) return c; }
  return STAR_CLASSES[2];
};

const byId = (id) => STAR_CLASSES.find((c) => c.id === id);

/**
 * Классы звёзд раздаются КОЛОДОЙ, а не броском на каждую систему.
 *
 * Бросок с весами при шести соседях в пятой части случаев не даёт ни
 * одного красного карлика и в половине — ни одной белой; так и вышло с
 * первого раза: шесть систем, четыре из них жёлтые. А именно крайние
 * классы и видно — у карлика вся система помещается в два миллиона
 * километров и светит оранжевым, у белой растянута вчетверо и залита
 * голубым. Колода гарантирует, что оба типа в галактике есть.
 */
function classDeck(rng, n) {
  const order = ['M', 'A', 'K', 'F', 'G', 'M', 'K', 'G', 'F', 'A'];
  const deck = [];
  for (let i = 0; i < n; i++) deck.push(byId(order[i % order.length]));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return deck;
}

/**
 * Галактика целиком: список систем с местами, именами и звёздами.
 * Детерминирована от семени — одна и та же при каждом запуске.
 *
 * Родная система стоит в начале координат, и это не лень: расстояния до
 * остальных читаются прямо как «сколько лететь от дома», а карта не
 * ползёт при переходе — смещается только отметка «вы здесь».
 */
export function makeGalaxy(seed = 0x9c31) {
  const rng = makeRng(seed);
  const systems = [{
    id: 0,
    seed: HOME_SEED,
    name: 'Lave',
    home: true,
    cls: HOME_CLASS,
    hab: HAB_HOME,
    pos: { x: 0, y: 0, z: 0 },
  }];

  const used = new Set(['Lave']);
  const deck = classDeck(rng, SYSTEM_COUNT - 1);
  for (let i = 1; i < SYSTEM_COUNT; i++) {
    // Расстояния РАСПРЕДЕЛЕНЫ по лестнице, а не выпадают случайно.
    // Случайные радиусы (даже с корнем, чтобы не сбивались в центр) дали
    // шесть соседей на 16–21 световом годе: все прыжки выходили одной
    // длины, и выбор цели переставал что-либо менять. С лестницей есть и
    // ближний сосед в двадцать секунд, и дальний в полминуты.
    const want = SPREAD * (0.22 + 0.78 * ((i - 1) / (SYSTEM_COUNT - 2)));
    // Диск, а не шар: галактика плоская, и по вертикали разброс вчетверо
    // меньше. Без этого системы разбегаются вверх-вниз, и направление на
    // цель перестаёт читаться как «куда-то вбок».
    let pos = null;
    for (let t = 0; t < 300 && !pos; t++) {
      const a = rng.range(0, TAU);
      const r = want * rng.range(0.88, 1.12);
      const p = { x: Math.cos(a) * r, y: rng.range(-1, 1) * SPREAD * 0.18, z: Math.sin(a) * r };
      if (!systems.some((s) => systemDistance(s, { pos: p }) < MIN_APART)) pos = p;
    }
    if (!pos) continue;

    let name = makeName(rng);
    let tries = 0;
    while (used.has(name) && tries++ < 50) name = makeName(rng);
    if (used.has(name)) continue;
    used.add(name);

    const cls = deck[i - 1];
    systems.push({
      id: systems.length,
      seed: ((seed * 0x9e37 + systems.length * 0x85eb) >>> 0) ^ (systems.length * 0x27d4eb2d),
      name,
      home: false,
      cls,
      hab: habitableOf(cls),
      pos,
    });
  }
  return { seed, systems };
}

// Галактика одна на всю игру и не зависит ни от чего, поэтому считается
// один раз. Пересобирать её на каждый прыжок значило бы получать те же
// самые числа заново.
let cached = null;
export const galaxy = () => (cached || (cached = makeGalaxy()));

export const systemById = (id) => galaxy().systems.find((s) => s.id === id) || null;
export const homeSystem = () => galaxy().systems[0];

/**
 * Описание системы по семени. Незнакомое семя — не ошибка: так система
 * собирается и в проверках, и в будущем на сервере, где список систем
 * придёт извне. Класс звезды тогда выводится из самого семени.
 */
export function systemBySeed(seed) {
  const known = galaxy().systems.find((s) => s.seed === seed);
  if (known) return known;
  const rng = makeRng(seed ^ 0x5bf03635);
  const cls = pickClass(rng);
  return {
    id: -1,
    seed,
    name: makeName(rng),
    home: seed === HOME_SEED,
    cls: seed === HOME_SEED ? HOME_CLASS : cls,
    hab: seed === HOME_SEED ? HAB_HOME : habitableOf(cls),
    pos: { x: 0, y: 0, z: 0 },
  };
}
