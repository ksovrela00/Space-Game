// Звёздная система: светило, планеты на круговых орбитах, луны и станции.
// Всё генерируется из seed, поэтому система одинакова между запусками.
//
// Два сознательных отступления от реальных масштабов:
//   * орбиты сжаты до 0.3–4 млн км — иначе перелёт занимал бы часы даже
//     на круизном ускорителе;
//   * орбитальные периоды огромны (годы), поэтому тела идут по орбитам
//     медленно — единицы метров в секунду.
//
// Рядом с телом корабль всё равно переносится вместе с ним (см.
// js/game/gravity.js): и орбитальное движение, и суточное вращение у
// поверхности скомпенсированы, иначе «зависнуть над точкой» нельзя было
// бы в принципе.

import { v3, normalize, cross } from '../core/vec3.js';
import { makeRng, makeName, ROMAN } from '../core/rng.js';
import { setGravity } from './gravity.js';
import { HOME_SEED, HOME_CLASS, HAB_HOME, systemBySeed } from './galaxy.js';
import { pressureOf } from './bodyinfo.js';
import { STATION_KINDS, stationShape } from '../models/stations.js';
import { L } from '../core/lang.js';

const TAU = Math.PI * 2;

// Коэффициент в T = K·r^1.5, секунд на км^1.5. Подобран по родной
// планете: на её орбите (620 000 км) он даёт те же ~4.4·10⁹ с, что были
// у неё до перехода на Кеплера, — то есть привычная система не поехала.
// Масштаб намеренно раздут примерно в двести раз против настоящего:
// планета, обгоняющая корабль, сделала бы стыковку невозможной
// (см. «Статус» в README).
const KEPLER = 9;

// Плоскость орбиты с небольшим наклоном к эклиптике (XZ).
const orbitPlane = (rng) => {
  const inc = rng.range(-0.06, 0.06);
  const node = rng.range(0, TAU);
  const A = normalize(v3(Math.cos(node), 0, Math.sin(node)));
  const up = normalize(v3(Math.sin(inc) * Math.sin(node), Math.cos(inc), -Math.sin(inc) * Math.cos(node)));
  const B = normalize(cross(up, A));
  return { A, B, up };
};

const spinFrame = (rng) => {
  const tilt = rng.range(0.02, 0.5);
  const dir = rng.range(0, TAU);
  const pole = normalize(v3(Math.sin(tilt) * Math.cos(dir), Math.cos(tilt), Math.sin(tilt) * Math.sin(dir)));
  let ref = normalize(cross(pole, v3(0, 0, 1)));
  if (!isFinite(ref.x) || Math.hypot(ref.x, ref.y, ref.z) < 0.1) ref = normalize(cross(pole, v3(1, 0, 0)));
  const side = normalize(cross(pole, ref));
  return { pole, eqRef: ref, eqSide: side };
};

const jitter = (rng, c, amt) => [
  Math.max(0, Math.min(255, c[0] + rng.range(-amt, amt))),
  Math.max(0, Math.min(255, c[1] + rng.range(-amt, amt))),
  Math.max(0, Math.min(255, c[2] + rng.range(-amt, amt))),
];

// --- Процедурная поверхность: набор «пятен» (lat, lon, size, color) ---------

const spots = (rng, n, latRange, sizeRange, color, colorJit = 22) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      lat: rng.range(-latRange, latRange),
      lon: rng.range(0, TAU),
      size: rng.range(sizeRange[0], sizeRange[1]),
      color: jitter(rng, color, colorJit),
    });
  }
  return out;
};

const caps = (rng, size, color) => ([
  { lat: 1.45, lon: 0, size, color },
  { lat: -1.45, lon: Math.PI, size: size * 0.85, color },
]);

// Полосы газового гиганта — ряды пятен по широте.
const bands = (rng, colors) => {
  const out = [];
  const rows = rng.int(5, 8);
  for (let r = 0; r < rows; r++) {
    const lat = -1.2 + (r + rng.range(0.2, 0.8)) * (2.4 / rows);
    const color = jitter(rng, colors[r % colors.length], 14);
    const size = rng.range(0.14, 0.26);
    const count = Math.max(10, Math.round(26 * Math.cos(lat) + 6));
    for (let i = 0; i < count; i++) {
      out.push({
        lat: lat + rng.range(-0.04, 0.04),
        lon: (i / count) * TAU + rng.range(-0.05, 0.05),
        size,
        color,
      });
    }
  }
  return out;
};

const PALETTE = {
  lava: { base: [96, 62, 54], spot: [214, 92, 40], atmo: null },
  rock: { base: [128, 116, 104], spot: [92, 82, 74], atmo: null },
  desert: { base: [186, 150, 104], spot: [150, 112, 74], atmo: [214, 178, 130] },
  ocean: { base: [46, 88, 156], spot: [78, 132, 84], atmo: [120, 180, 255] },
  ice: { base: [186, 208, 224], spot: [226, 240, 250], atmo: [180, 220, 255] },
  gas: { base: [176, 148, 112], spot: [140, 112, 84], atmo: [214, 190, 150] },
  moon: { base: [138, 138, 142], spot: [104, 104, 110], atmo: null },
};

const makeSurface = (rng, kind) => {
  const p = PALETTE[kind] || PALETTE.rock;
  let features = [];
  switch (kind) {
    case 'ocean':
      features = spots(rng, rng.int(7, 11), 1.15, [0.20, 0.42], p.spot, 26)
        .concat(caps(rng, 0.34, [236, 244, 252]))
        .concat(spots(rng, 10, 1.1, [0.10, 0.20], [250, 250, 255], 4));
      break;
    case 'gas':
      features = bands(rng, [[196, 168, 128], [150, 120, 92], [212, 190, 150], [128, 100, 78]]);
      features.push({ lat: rng.range(-0.5, 0.5), lon: rng.range(0, TAU), size: 0.20, color: [206, 108, 74] });
      break;
    case 'ice':
      features = spots(rng, rng.int(12, 18), 1.3, [0.12, 0.30], p.spot, 12)
        .concat(caps(rng, 0.42, [246, 252, 255]));
      break;
    case 'lava':
      features = spots(rng, rng.int(14, 20), 1.2, [0.10, 0.26], p.spot, 30);
      break;
    default:
      features = spots(rng, rng.int(12, 20), 1.25, [0.12, 0.34], p.spot, 20);
      if (kind === 'desert') features = features.concat(caps(rng, 0.20, [230, 235, 240]));
  }
  return { color: jitter(rng, p.base, 10), atmo: p.atmo, features };
};

// --- Тела --------------------------------------------------------------------

let nextId = 1;

const makeBody = (rng, opts) => {
  const surf = makeSurface(rng, opts.kind);
  const frame = spinFrame(rng);
  return {
    id: nextId++,
    kind: opts.kind,
    name: opts.name,
    radius: opts.radius,
    color: surf.color,
    atmo: surf.atmo,
    // Давление у поверхности, бар. Стоит рядом с atmo не для красоты:
    // по нему считается плотность воздуха, а значит и нагрев при входе
    // (js/game/entry.js). Тонкая пустынная атмосфера обязана и жечь
    // слабее плотной океанической.
    press: pressureOf(opts.kind),
    features: surf.features,
    pole: frame.pole,
    eqRef: frame.eqRef,
    eqSide: frame.eqSide,
    spin: TAU / opts.spinPeriod,
    spinPhase: rng.range(0, TAU),
    rings: opts.rings || null,
    orbit: opts.orbit || null,
    parent: opts.parent || null,
    station: null,
    moons: [],
    pos: v3(),
    vel: v3(),
    isBody: true,
  };
};

const makeStation = (rng, planet, name) => {
  const alt = planet.radius * rng.range(0.45, 0.75);
  const plane = orbitPlane(rng);
  // Тип порта — от ИМЕНИ станции, а не из общего генератора мира.
  //
  // Взять число у rng было бы проще, но это сдвинуло бы весь дальнейший
  // поток: планеты, луны и орбиты во ВСЕЙ галактике переехали бы на
  // новые места, а мир уже лежит слепком в базе и в сохранениях пилотов.
  // Имя же и так детерминировано и уникально, и по нему тип получается
  // тот же самый у клиента, у сервера и в каждом полёте.
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const type = STATION_KINDS[(h >>> 0) % STATION_KINDS.length];
  const shape = stationShape(type);
  return {
    id: nextId++,
    kind: 'station',
    type,
    shape,
    name,
    parent: planet,
    // Габарит модели целиком: по нему считают зазор до края и точку
    // выхода из прыжка. У «Орбиса» он больше — кольцо шире ступицы.
    radius: shape.bound,
    orbit: {
      radius: planet.radius + alt,
      period: rng.range(1.5e7, 2.5e7),
      phase: rng.range(0, TAU),
      A: plane.A,
      B: plane.B,
      up: plane.up,
    },
    spinRate: TAU / rng.range(70, 96),   // оборот за ~80 секунд
    spinPhase: rng.range(0, TAU),
    pos: v3(),
    vel: v3(),
    // Базис: fwd — ось порта (наружу от планеты), right/up вращаются
    basis: { right: v3(1, 0, 0), up: v3(0, 1, 0), fwd: v3(0, 0, 1) },
    isStation: true,
  };
};

// Орбитальные маркеры: точки в пустоте, к которым можно прыгнуть.
//
// Нужны они ровно за тем, чтобы обходить помеху: прямой коридор к цели
// может упираться в планету, над которой висишь, и тогда прыгают
// сначала к маркеру с открытой стороны. Шесть штук по осям — при таком
// раскладе из любой точки поверхности хотя бы один виден над
// горизонтом; четырёх в одной плоскости для этого не хватает.
//
// Точки ДЕТЕРМИНИРОВАННЫЕ, а не случайные: по ним запоминают маршрут, и
// прыгать между сессиями они должны в одни и те же места.
const MARKER_R = 3;      // в радиусах тела

function makeMarkers(b) {
  const A = b.orbit ? b.orbit.A : v3(1, 0, 0);
  const B = b.orbit ? b.orbit.B : v3(0, 0, 1);
  const up = b.orbit ? normalize(cross(A, B)) : v3(0, 1, 0);
  const out = [];
  let n = 1;
  for (const a of [A, B, up]) {
    for (const s of [1, -1]) {
      out.push({
        id: 'm' + b.id + '-' + n,
        kind: 'marker',
        name: b.name + L(' · ОМ-') + n,
        isMarker: true,
        body: b,
        radius: 0,
        off: v3(a.x * s, a.y * s, a.z * s),
        dist: b.radius * MARKER_R,
        pos: v3(),
        // Маркер жёстко привязан к телу, поэтому и скорость у него та же.
        // Ссылка общая намеренно: пересчитывать её отдельно нечего.
        vel: b.vel,
      });
      n++;
    }
  }
  return out;
}

/**
 * Положение тела на ЛЮБОЙ момент времени, а не только на текущий.
 *
 * Нужно проверке коридора: прыжок длится до полутора минут, и тела за
 * это время уезжают. Орбиты аналитические, поэтому будущее положение
 * считается точно и даром — интегрировать вперёд ничего не надо.
 */
export function bodyPosAt(b, t, out = v3()) {
  out.x = 0; out.y = 0; out.z = 0;
  for (let node = b; node; node = node.parent) {
    const o = node.orbit;
    if (!o) continue;                // корень (светило) стоит в начале координат
    const a = o.phase + (t / o.period) * TAU;
    const ca = Math.cos(a) * o.radius, sa = Math.sin(a) * o.radius;
    out.x += o.A.x * ca + o.B.x * sa;
    out.y += o.A.y * ca + o.B.y * sa;
    out.z += o.A.z * ca + o.B.z * sa;
  }
  return out;
}

// --- Макет системы -----------------------------------------------------------

// Пояса задаются В ДОЛЯХ обитаемой зоны, а не в километрах: у красного
// карлика вся система помещается в 300 тыс. км, у белой растянута на
// десяток миллионов, и абсолютные границы означали бы у одной звезды
// «всё расплавлено», у другой — «всё обледенело».
const BELTS = [
  { upTo: 0.55, kinds: ['lava', 'lava', 'rock'] },
  { upTo: 0.85, kinds: ['rock', 'desert', 'lava'] },
  { upTo: 1.45, kinds: ['ocean', 'desert', 'rock'] },
  { upTo: 3.00, kinds: ['ice', 'gas', 'rock', 'desert'] },
  { upTo: Infinity, kinds: ['gas', 'ice', 'ice', 'rock'] },
];

const RADII = {
  lava: [1200, 2600], rock: [1600, 3200], desert: [2400, 4200],
  ocean: [3400, 5200], ice: [1500, 3600], gas: [4800, 11000],
};

const beltOf = (ratio) => BELTS.find((b) => ratio < b.upTo);

// Дальше этого планет не бывает ни в одной системе. Предел не из
// астрономии, а из времени полёта: квантовый привод идёт 60 000 км/с, и
// 5 млн км — это полторы минуты в один конец. У родной системы край
// стоит на 4.4 млн (80 секунд), и это уже ощутимо долго.
const ORBIT_MAX = 5000000;

// Больше четырёх портов в системе не бывает: дальше они перестают
// различаться, а выбор «куда лететь» и есть смысл их существования.
const STATION_MAX = 4;

/**
 * Макет незнакомой системы: сколько планет, каких и на каких орбитах.
 *
 * Орбиты строятся УМНОЖЕНИЕМ на 1.35–1.9, а не случайными числами в
 * диапазоне: у настоящих систем каждая следующая планета дальше
 * предыдущей примерно во столько же раз (правило Тициуса-Боде), а
 * случайные орбиты дают то две планеты вплотную, то пустоту в полсистемы.
 * Вид планеты выбирается по поясу — то есть по тому, сколько ей достаётся
 * света, — поэтому лёд у самой звезды не заводится.
 */
export function planLayout(rng, hab, starR = 62000) {
  const n = rng.int(4, 9);
  const out = [];

  // Внутренняя граница — не только доля обитаемой зоны: у красного
  // карлика зона лежит в 240 тыс. км, и доля от неё завела бы первую
  // планету ВНУТРЬ самой звезды. Поэтому берётся пять её радиусов как
  // жёсткий пол.
  const inner = Math.max(hab * rng.range(0.30, 0.58), starR * 5);
  // Внешняя граница — не «сколько получится», а потолок. Множитель
  // 1.35–1.9 за девять планет даёт сорок с лишним крат: первая версия
  // выносила край системы на 35 млн км, и квантовый прыжок туда занимал
  // десять минут. Поэтому край зажат, а шаг считается уже ОТ него.
  // Край системы задаётся ТРЕМЯ ограничителями сразу, и берётся самый
  // тесный: общий потолок по времени полёта, привязка к обитаемой зоне
  // (у тусклой звезды система обязана быть тесной, иначе класс звезды ни
  // на чём не сказывается) и собственно геометрический ряд.
  const outer = Math.min(
    ORBIT_MAX * rng.range(0.5, 1),
    hab * rng.range(4, 11),
    inner * Math.pow(rng.range(1.45, 1.85), n - 1));
  const step = n > 1 ? Math.pow(outer / inner, 1 / (n - 1)) : 1;

  let orbit = inner;
  let ocean = false;
  let prev = '';
  const seen = {};
  for (let i = 0; i < n; i++) {
    const belt = beltOf(orbit / hab);
    // Из пояса тянутся ДВА варианта, берётся тот, которого в системе
    // пока меньше. Одиночный бросок давал системы из девяти каменистых
    // планет подряд: в поясе всего три-четыре варианта, и случайный
    // выбор охотно повторяется. Сравнение по счётчику разводит виды, но
    // не запрещает повтор совсем — в поясе может и не быть выбора.
    const c1 = rng.pick(belt.kinds), c2 = rng.pick(belt.kinds);
    let kind = (seen[c2] || 0) < (seen[c1] || 0) ? c2 : c1;
    if (kind === prev && c1 !== c2) kind = (kind === c1 ? c2 : c1);
    // Океаническая планета в системе одна: две читаются как ошибка
    // генератора, а не как богатая система.
    if (kind === 'ocean' && ocean) kind = 'desert';
    if (kind === 'ocean') ocean = true;
    prev = kind;
    seen[kind] = (seen[kind] || 0) + 1;
    const [lo, hi] = RADII[kind];
    out.push({
      kind,
      r: Math.round(rng.range(lo, hi) / 100) * 100,
      orbit: Math.round(orbit / 1000) * 1000,
      station: false,
      rings: kind === 'gas' && rng.chance(0.4),
      moons: kind === 'gas' ? rng.int(1, 4) : (rng.chance(0.35) ? 1 : 0),
    });
    orbit = Math.min(ORBIT_MAX, orbit * step * rng.range(0.94, 1.06));
  }

  // Порт в системе обязан быть хотя бы один: без него некуда сесть,
  // негде начать заново и незачем сюда лететь. Берётся планета, ближе
  // всех стоящая к обитаемой зоне, — и она же становится опорной.
  let best = 0;
  for (let i = 1; i < out.length; i++) {
    if (out[i].kind === 'gas') continue;
    if (Math.abs(out[i].orbit - hab) < Math.abs(out[best].orbit - hab)) best = i;
  }
  out[best].station = true;
  out[best].home = true;
  let ports = 1;
  for (const row of out) {
    if (ports >= STATION_MAX) break;
    if (!row.station && row.kind !== 'lava' && rng.chance(0.28)) { row.station = true; ports++; }
  }

  // Садиться можно только на безвоздушное. Система, где не на что сесть,
  // формально жива, но делать в ней нечего — поэтому если ни одного
  // такого тела не вышло, ближайшему газовому гиганту добавляется луна.
  const landable = out.some((r) => r.kind === 'lava' || r.kind === 'rock' || r.moons > 0);
  if (!landable) out[out.length - 1].moons = 1;
  return out;
}

// --- Система -----------------------------------------------------------------

// Родная система собрана руками и такой остаётся: с неё начинается игра,
// и в ней должно быть ровно то, чему она учит, — обжитая планета со
// станцией, безвоздушная цель для первой посадки, гигант с лунами.
// Генератор такого не гарантирует, а начинать в системе из четырёх
// газовых гигантов нельзя. Остальные системы собираются генератором:
// одинаковых девяти планет у каждой звезды быть не может.
//
// Планеты идут по возрастанию орбиты, и номер (ROMAN) берётся отсюда
// же — как у настоящих обозначений, счёт от звезды. Поэтому вставлять
// новое тело можно только на его место по расстоянию: приписать его в
// конец списка было бы проще, но тогда Lave IX оказалась бы между II и
// III, и номер перестал бы что-либо значить. То же правило соблюдает и
// генератор: он строит орбиты только по возрастанию.
//
// Три внешних мира добавлены НЕ в начало сознательно: всё, что ближе
// родной планеты, сдвинуло бы её номер, а на «Lave II» завязаны и
// память игрока, и замеры в README.
export const HOME_LAYOUT = [
  { kind: 'lava', r: 1900, orbit: 340000, station: false },
  { kind: 'ocean', r: 4200, orbit: 620000, station: true, home: true },
  { kind: 'desert', r: 3400, orbit: 1020000, station: true },
  { kind: 'rock', r: 2600, orbit: 1580000, station: false },
  // Малый ледяной мир в самом широком пустом месте внутренней части
  // системы: между каменистой планетой и первым гигантом лежало
  // 840 тыс. км без единого тела.
  { kind: 'ice', r: 1700, orbit: 1950000, station: false },
  { kind: 'gas', r: 8200, orbit: 2420000, station: true, rings: true, moons: 2 },
  // Пара газовых гигантов рядом, как Юпитер с Сатурном: орбиты
  // расходятся на 530 000 км, и когда планеты сходятся, каждая видна с
  // другой диском вдвое-втрое крупнее полной Луны. Расходятся они до
  // 5.4 млн км, так что это не постоянная картина, а событие. Колец у
  // второго нет намеренно: два одинаково окольцованных гиганта
  // читались бы как один и тот же объект. Три луны здесь — главная
  // прибавка к игре: садиться можно только на безвоздушное, а таких
  // тел в системе было пять.
  { kind: 'gas', r: 5600, orbit: 2950000, station: false, moons: 3 },
  { kind: 'ice', r: 3000, orbit: 3600000, station: false, moons: 1 },
  // Край системы: голый камень со станцией. Прыжок туда от дома — 80
  // секунд против 20–60 до всего остального, то есть дольше заявленных
  // «полминуты-минуты». Это осознанно: дальний порт нужен как
  // настоящий рейс, ради которого стоит собираться, — иначе все четыре
  // станции равноудалены и выбор между ними ничего не значит.
  { kind: 'rock', r: 2400, orbit: 4400000, station: true, moons: 1 },
];

/**
 * Собрать систему целиком.
 *
 * Принимает либо семя, либо готовое описание из галактики. Семя
 * оставлено рабочим не ради совместимости: так система собирается там,
 * где галактики нет вовсе — в проверках и, в будущем, на сервере, где
 * список систем придёт извне.
 */
export function makeSystem(spec = HOME_SEED) {
  const sys = (spec && typeof spec === 'object') ? spec : systemBySeed(spec);
  const seed = sys.seed;
  const rng = makeRng(seed);
  nextId = 1;

  const systemName = sys.name;
  const cls = sys.cls || HOME_CLASS;
  const star = makeBody(rng, {
    kind: 'star',
    name: systemName,
    radius: cls.radius,
    spinPeriod: 1e6,
  });
  star.color = cls.color.slice();
  star.features = null;
  star.atmo = null;
  // Температура светила — из класса, а не из таблицы видов: в таблице
  // она одна на все звёзды, а классов пять (js/game/galaxy.js).
  star.temp = cls.temp;
  star.cls = cls;

  // Родная система — рукотворная (HOME_LAYOUT), остальные из генератора.
  // Ветка стоит ДО единственного обращения к rng за макетом: authored-путь
  // не тратит ни одного случайного числа, поэтому родная система осталась
  // ровно той же, что была, вплоть до идентификаторов тел в сохранении.
  const hab = sys.hab || HAB_HOME;
  const layout = sys.home ? HOME_LAYOUT : planLayout(rng, hab);

  const planets = [];
  let home = null;

  layout.forEach((row, i) => {
    const plane = orbitPlane(rng);
    const p = makeBody(rng, {
      kind: row.kind,
      name: `${systemName} ${ROMAN[i]}`,
      radius: row.r,
      // Период суток привязан к радиусу: скорость поверхности выходит
      // 0.1–0.3 км/с, как у настоящих планет. Раньше периоды были в сотни
      // раз короче — вращение красиво читалось с орбиты, но поверхность
      // при этом «ехала» со скоростью в десятки км/с, и сесть на неё было
      // физически невозможно (см. js/game/landing.js).
      spinPeriod: row.r * rng.range(20, 60),
      parent: star,
      orbit: {
        radius: row.orbit,
        // Год — по третьему закону Кеплера от радиуса орбиты (T ∝ r^1.5).
        // Раньше множитель брался из НОМЕРА в списке: `range(1.5e9, 4.0e9)
        // * (1 + i * 0.6)`. Это ломалось двумя способами. Вставь планету
        // в середину — и у всех внешних менялся год, хотя с ними ничего
        // не происходило. И диапазоны соседей перекрывались настолько,
        // что порядок нарушался прямо в готовой системе: Lave II
        // (620 тыс. км) обходила звезду за 153 года, а Lave III
        // (1.02 млн км) — за 147, то есть ближняя планета отставала от
        // дальней. Панель тела честно показывала эту невозможную пару.
        period: KEPLER * Math.pow(row.orbit, 1.5) * rng.range(0.9, 1.1),
        phase: rng.range(0, TAU),
        A: plane.A,
        B: plane.B,
      },
      rings: row.rings ? {
        inner: 1.4, outer: 2.3,
        color: jitter(rng, [206, 186, 150], 10),
      } : null,
    });

    if (row.station) {
      p.station = makeStation(rng, p, `${makeName(rng)} Station`);
      p.station.planetName = p.name;
    }

    for (let m = 0; m < (row.moons || 0); m++) {
      const mplane = orbitPlane(rng);
      const mr = p.radius * rng.range(0.16, 0.30);
      const moon = makeBody(rng, {
        kind: 'moon',
        name: `${p.name}${String.fromCharCode(97 + m)}`,
        radius: mr,
        spinPeriod: mr * rng.range(25, 80),
        parent: p,
        orbit: {
          radius: p.radius * rng.range(3.5, 7),
          period: rng.range(6.0e7, 1.2e8),
          phase: rng.range(0, TAU),
          A: mplane.A,
          B: mplane.B,
        },
      });
      p.moons.push(moon);
    }

    if (row.home) home = p;
    planets.push(p);
  });

  const world = {
    name: systemName,
    seed,
    sys,                   // описание из галактики: место, класс звезды
    // Орбита, на которой равновесная температура равна 255 K. По ней
    // откалиброваны ВСЕ температуры в игре и по ней же расставлены пояса
    // планет. Раньше опорой служила родная планета (world.home), и в чужой
    // системе это значило бы «где-то там обязана быть планета с земным
    // климатом» — а её там может не быть вовсе.
    habitable: hab,
    time: 0,
    star,
    planets,
    home,
    entities: [],          // сюда позже лягут NPC-корабли и снаряды
    bodies: [],            // плоский список тел для рендера и навигации
    stations: [],
    markers: [],           // орбитальные маркеры (цели квантового прыжка)
  };

  world.bodies.push(star);
  for (const p of planets) {
    world.bodies.push(p);
    for (const m of p.moons) world.bodies.push(m);
    if (p.station) world.stations.push(p.station);
  }
  // Маркеры есть у всего, вокруг чего можно застрять, — то есть у всех
  // тел, включая светило: его диаметр 124 000 км, и он перекрывает
  // коридор чаще любой планеты.
  for (const b of world.bodies) {
    b.markers = makeMarkers(b);
    for (const m of b.markers) world.markers.push(m);
  }

  // Гравитация: масса из плотности и радиуса, радиус захвата — из массы
  // и массы хозяина. Порядок важен: сфера действия планеты считается по
  // массе светила, луны — по массе планеты.
  for (const b of world.bodies) setGravity(b);

  updateWorld(world, 0);
  return world;
}

const _prev = v3();
const _P = v3();

// Пересчёт позиций. dt нужен только для оценки скоростей тел
// (станция движется по орбите, и корабль после стыковки летит вместе с ней).
export function updateWorld(world, dt) {
  world.time += dt;
  const t = world.time;

  const place = (b) => {
    if (!b.orbit) return;
    _prev.x = b.pos.x; _prev.y = b.pos.y; _prev.z = b.pos.z;
    const o = b.orbit;
    const a = o.phase + (t / o.period) * TAU;
    const ca = Math.cos(a) * o.radius, sa = Math.sin(a) * o.radius;
    const c = b.parent ? b.parent.pos : { x: 0, y: 0, z: 0 };
    b.pos.x = c.x + o.A.x * ca + o.B.x * sa;
    b.pos.y = c.y + o.A.y * ca + o.B.y * sa;
    b.pos.z = c.z + o.A.z * ca + o.B.z * sa;
    if (dt > 0) {
      b.vel.x = (b.pos.x - _prev.x) / dt;
      b.vel.y = (b.pos.y - _prev.y) / dt;
      b.vel.z = (b.pos.z - _prev.z) / dt;
    }
  };

  for (const p of world.planets) {
    place(p);
    p.spinPhase = (p.spinPhase + p.spin * dt) % TAU;
    for (const m of p.moons) {
      place(m);
      m.spinPhase = (m.spinPhase + m.spin * dt) % TAU;
    }
    if (p.station) {
      const s = p.station;
      place(s);
      s.spinPhase = (s.spinPhase + s.spinRate * dt) % TAU;
      // Ось порта — наружу от планеты; right/up катятся вокруг неё.
      // Оси вращения берём перпендикулярными оси порта: нормаль орбиты
      // (Q) и направление по орбите (P). Оси самой орбитальной плоскости
      // (A, B) для этого не годятся — радиальное направление лежит в ней,
      // и при некоторых фазах right вырождался в ноль и переворачивался.
      const f = s.basis.fwd;
      normalize(v3(s.pos.x - p.pos.x, s.pos.y - p.pos.y, s.pos.z - p.pos.z), f);
      const Q = s.orbit.up;
      const P = normalize(cross(Q, f), _P);
      const cs = Math.cos(s.spinPhase), sn = Math.sin(s.spinPhase);
      normalize(v3(
        P.x * cs + Q.x * sn,
        P.y * cs + Q.y * sn,
        P.z * cs + Q.z * sn), s.basis.right);
      cross(f, s.basis.right, s.basis.up);
    }
  }

  // Маркеры едут вместе со своим телом, но НЕ вращаются с ним: иначе
  // точка, к которой только что прыгнул, уезжала бы за сутки.
  for (const m of world.markers) {
    m.pos.x = m.body.pos.x + m.off.x * m.dist;
    m.pos.y = m.body.pos.y + m.off.y * m.dist;
    m.pos.z = m.body.pos.z + m.off.z * m.dist;
  }
}

/**
 * Локальный базис тела: y (up) — ось вращения, поворот вокруг неё —
 * суточное вращение. Меш поверхности статичен, всё вращение живёт в этой
 * матрице. Этим же базисом игровая логика переводит мировые координаты в
 * «широту-долготу» тела (js/game/surface.js).
 */
export function bodyBasis(body, out) {
  const p = body.pole, a = body.eqRef, s = body.eqSide;
  const c = Math.cos(body.spinPhase), sn = Math.sin(body.spinPhase);
  // right = eqRef, повёрнутый вокруг полюса; up = полюс.
  out.right.x = a.x * c + s.x * sn;
  out.right.y = a.y * c + s.y * sn;
  out.right.z = a.z * c + s.z * sn;
  out.up.x = p.x; out.up.y = p.y; out.up.z = p.z;
  // fwd = right x up (правая тройка, как и у камеры)
  out.fwd.x = out.right.y * p.z - out.right.z * p.y;
  out.fwd.y = out.right.z * p.x - out.right.x * p.z;
  out.fwd.z = out.right.x * p.y - out.right.y * p.x;
  return out;
}

// Ближайшее крупное тело — для mass lock и проверки столкновений.
export function nearestBody(world, pos) {
  let best = null, bestGap = Infinity;
  for (const b of world.bodies) {
    const gap = Math.hypot(pos.x - b.pos.x, pos.y - b.pos.y, pos.z - b.pos.z) - b.radius;
    if (gap < bestGap) { bestGap = gap; best = b; }
  }
  return { body: best, gap: bestGap };
}
