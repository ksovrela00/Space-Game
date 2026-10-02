// Модели кораблей. Все размеры в километрах (длина корпуса ~65 м).
//
// Корпус игрока приходит готовой моделью (js/models/hull.data.js,
// собирается из CC0-пака: npm run ship). Процедурный клин, с которого
// всё начиналось, остался рядом — buildWedge: по нему видно, каких
// обводов ждёт остальной код, и он же запасной вариант, если данных
// корпуса нет.

import { v3 } from '../core/vec3.js';
import { loft, box, prismZ, makeMesh, mergeMeshes, transformMesh } from './geometry.js';
import { detailHull, BRIDGE } from './hulldetail.js';
import { buildLegs, tripodShares, sizeLeg } from './gear.js';
import {
  HULL_NAME, HULL_LENGTH, HULL_VERTS, HULL_FACES, HULL_EXHAUSTS, HULL_GEAR,
} from './hull.data.js';

const HULL_TOP = [198, 206, 220];
const HULL_SIDE = [150, 158, 172];
const HULL_BOT = [104, 112, 126];
const CANOPY = [46, 104, 150];
const NOZZLE = [70, 74, 84];
const FIN = [176, 96, 72];

const boundOf = (mesh) => {
  let m = 0;
  for (const v of mesh.verts) m = Math.max(m, Math.hypot(v.x, v.y, v.z));
  mesh.bound = m;
  return mesh;
};

// Данные корпуса лежат в целых миллиметрах — так файл втрое короче.
const MM = 1e-6;
const pt = (p) => v3(p[0] * MM, p[1] * MM, p[2] * MM);

/**
 * Корпус игрока из готовой модели.
 *
 * Формат распаковывается здесь, а не хранится готовым: массив чисел
 * парсится мгновенно, а вот тысяча объектов {x,y,z} в исходнике весила
 * бы втрое больше и читалась бы глазами ничуть не лучше.
 */
export function buildCobra() {
  const verts = [];
  for (let i = 0; i < HULL_VERTS.length; i += 3) {
    verts.push(v3(HULL_VERTS[i] * MM, HULL_VERTS[i + 1] * MM, HULL_VERTS[i + 2] * MM));
  }
  const defs = [];
  for (let i = 0; i < HULL_FACES.length;) {
    const n = HULL_FACES[i++];
    const v = HULL_FACES.slice(i, i + n); i += n;
    const c = HULL_FACES.slice(i, i + 3); i += 3;
    defs.push({ v, c });
  }
  const mesh = makeMesh(verts, defs);
  mesh.exhausts = HULL_EXHAUSTS.map(pt);
  mesh.length = HULL_LENGTH;
  mesh.name = HULL_NAME;
  mesh.rcs = rcsPorts(verts, HULL_HALF);
  // Объём (из него масса) и глаз пилота — то, что у каждого корпуса своё
  // и что игра берёт у текущего корпуса (js/game/hull.js).
  mesh.volumeM3 = HULL_VOLUME_M3;
  mesh.eye = v3(BRIDGE.eye.x / 1000, BRIDGE.eye.y / 1000, BRIDGE.eye.z / 1000);
  // Деталь человеческого размера: швы, мостик, окна, сопла, огни
  // (js/models/hulldetail.js). После маневровых: те ищутся по голому
  // корпусу, и накладкам в их поиске делать нечего.
  detailHull(mesh);
  return boundOf(mesh);
}

/**
 * Габарит корпуса по его вершинам, км: крайние точки (lo, hi), полуразмеры
 * по модулю от начала осей (half — то, что выпирает дальше всего, им
 * меряют щель порта и момент инерции) и размеры (size — для карточки).
 * Одна функция на все корпуса: константы «Челленджера» ниже считаются
 * так же.
 */
export function extentOf(verts) {
  const lo = v3(Infinity, Infinity, Infinity), hi = v3(-Infinity, -Infinity, -Infinity);
  for (const v of verts) {
    lo.x = Math.min(lo.x, v.x); lo.y = Math.min(lo.y, v.y); lo.z = Math.min(lo.z, v.z);
    hi.x = Math.max(hi.x, v.x); hi.y = Math.max(hi.y, v.y); hi.z = Math.max(hi.z, v.z);
  }
  return {
    lo, hi,
    half: v3(Math.max(-lo.x, hi.x), Math.max(-lo.y, hi.y), Math.max(-lo.z, hi.z)),
    size: v3(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z),
  };
}

/** Процедурный клин в духе Cobra Mk III — исходный корпус игрока. */
export function buildWedge() {
  const L = 0.0325, W = 0.026, H = 0.010;

  // Планформа: нос, изломы кромки крыла, срез кормы (в плоскости XZ).
  const pfn = [
    { x: 0.00, z: 1.00 },
    { x: 0.26, z: 0.34 },
    { x: 1.00, z: -0.58 },
    { x: 0.66, z: -1.00 },
    { x: -0.66, z: -1.00 },
    { x: -1.00, z: -0.58 },
    { x: -0.26, z: 0.34 },
  ];
  const topn = [0.10, 0.52, 0.14, 0.34, 0.34, 0.14, 0.52];
  const botn = [-0.07, -0.34, -0.09, -0.24, -0.24, -0.09, -0.34];

  const pf = pfn.map((p) => ({ x: p.x * W, z: p.z * L }));
  const top = topn.map((y) => y * H);
  const bot = botn.map((y) => y * H);

  const hull = loft(pf, top, bot, HULL_TOP, HULL_BOT, HULL_SIDE);

  const canopy = box(W * 0.17, H * 0.34, L * 0.20, CANOPY, v3(0, H * 0.62, L * 0.16));

  const nozzle = (x) => transformMesh(
    prismZ(6, W * 0.085, L * 0.10, NOZZLE, [40, 42, 50]),
    { offset: v3(x, H * 0.1, -L * 1.02) });

  const fin = box(W * 0.02, H * 0.7, L * 0.14, FIN, v3(0, H * 0.95, -L * 0.78));

  const mesh = mergeMeshes([hull, canopy, nozzle(-W * 0.24), nozzle(W * 0.24), fin]);

  // Точки выхлопа — для факелов двигателей.
  mesh.exhausts = [v3(-W * 0.24, H * 0.1, -L * 1.12), v3(W * 0.24, H * 0.1, -L * 1.12)];
  mesh.length = L * 2;
  return boundOf(mesh);
}

/**
 * Средняя плотность корабля, кг/м³ — то единственное число массы, которое
 * не выводится ни из чего. Взята плотность авиалайнера на взлётном весе:
 * у «Боинга-747» четыреста тонн на две с половиной тысячи кубометров
 * фюзеляжа и крыла — около ста пятидесяти. Корпус «Челленджера» —
 * 11 200 м³, значит в нём тысяча семьсот тонн. Живёт здесь, рядом с
 * объёмом: по массе считается и струя движков (js/game/downwash.js), и
 * стойки шасси.
 */
export const HULL_DENSITY = 150;

/**
 * Шасси: три стойки — передняя и две основные (js/models/gear.js).
 *
 * Точки крепления идут вместе с корпусом: конвертер ставит их по самому
 * низкому месту днища, иначе стойка растёт из воздуха или из середины
 * обшивки. Длина у КАЖДОЙ стойки своя — такая, чтобы все пяты оказались
 * на одной высоте (ровно GEAR_CLEAR под центром масс). С общей длиной
 * пяты висели на разной высоте, и корабль на ровной площадке стоял бы на
 * двух стойках из трёх, а третья уходила бы в грунт.
 *
 * Толщина стоек и размер пят — от веса, который каждая несёт (статика
 * треноги, js/models/gear.js).
 */
export function buildGear() {
  const hp = HULL_GEAR.map((p) => p.map((v) => v / 1000));      // м
  const mass = HULL_VOLUME_M3 * HULL_DENSITY;
  const share = tripodShares(hp.map((p) => [p[0], p[2]]));
  return buildLegs(hp.map((p, i) => {
    const s = sizeLeg(mass * share[i]);
    const d = 2 * Math.sqrt(s.padArea / Math.PI);
    return {
      at: p,
      len: Math.max(1, GEAR_CLEAR * 1000 + p[1]),
      r: s.r,
      pad: { kind: 'disc', w: d, l: d, h: d * 0.08 },
      twin: 0,
      // Подкос — к корме у носовой стойки, к оси у главных.
      brace: p[2] > 0 ? [0, -2.2] : [-Math.sign(p[0]) * 1.8, 0.4],
    };
  }));
}

/**
 * Просветы под кораблём, км: на шасси и на брюхе. Живут здесь, рядом с
 * обводами, потому что это свойство КОРПУСА, а не физики; физика берёт
 * их через SHIP.gearClear и SHIP.hullClear.
 *
 * HULL_CLEAR — это ровно низ корпуса: лёг на брюхо, значит обшивка на
 * грунте. GEAR_CLEAR выше на длину стойки.
 */
export const HULL_CLEAR = hullFloor();
export const GEAR_CLEAR = HULL_CLEAR + 0.004;

/** Насколько низко корпус свисает под центром масс. */
function hullFloor() {
  let low = 0;
  for (let i = 1; i < HULL_VERTS.length; i += 3) low = Math.min(low, HULL_VERTS[i]);
  return -low * MM;
}

/**
 * Объём корпуса, м³ — по теореме о дивергенции: сумма объёмов
 * тетраэдров «начало координат — треугольник грани».
 *
 * Нужен ради одной величины, которой в лётной модели нет, — массы
 * (js/game/downwash.js). Лётная модель задаёт ускорения, а не силы, и
 * пока корабль ни с чем не взаимодействовал, этого хватало. Струя
 * движков у грунта — первое место, где нужна настоящая сила: ветер,
 * которым гнёт деревья, зависит от тяги в ньютонах, а тяга на
 * зависании — это вес.
 *
 * Модель замкнута не до конца (полсотни рёбер из 1753 висят на одной
 * грани — стыки деталей пака), поэтому объём верен с точностью до
 * этих щелей; проверка держит его в разумных долях габарита.
 */
export const HULL_VOLUME_M3 = (() => {
  const v = (k) => [HULL_VERTS[k * 3] / 1000, HULL_VERTS[k * 3 + 1] / 1000, HULL_VERTS[k * 3 + 2] / 1000];
  let vol = 0;
  for (let i = 0; i < HULL_FACES.length;) {
    const n = HULL_FACES[i++];
    const a = v(HULL_FACES[i]);
    for (let k = 1; k + 1 < n; k++) {
      const b = v(HULL_FACES[i + k]), c = v(HULL_FACES[i + k + 1]);
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    i += n + 3;
  }
  return Math.abs(vol);
})();

/**
 * Полуразмеры корпуса поперёк курса, км. Ими проверяется, лезет ли
 * корабль в щель порта (js/game/docking.js): раньше там стояло число
 * «полуразмер корабля 6 м», не связанное ни с какой моделью, — у клина
 * полуразмах был 26 метров, и рама прощала то, что прощать не должна.
 */
export const HULL_HALF = (() => {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < HULL_VERTS.length; i += 3) {
    x = Math.max(x, Math.abs(HULL_VERTS[i]));
    y = Math.max(y, Math.abs(HULL_VERTS[i + 1]));
    z = Math.max(z, Math.abs(HULL_VERTS[i + 2]));
  }
  // Длина (z) нужна не порту, а вращению: по трём полуразмерам считается
  // момент инерции корпуса, а из него — насколько тяжело корабль
  // раскручивается вокруг каждой оси (js/game/ship.js).
  return { x: x * MM, y: y * MM, z: z * MM };
})();

/**
 * Габариты корпуса, км: ширина (x), высота (y), длина (z).
 *
 * Считаются по КРАЙНИМ вершинам в обе стороны, а не удвоением HULL_HALF.
 * На «Challenger» разницы нет до миллиметра (67.1 x 19.3 x 65.0 м) —
 * модель симметрична относительно нуля. Но это свойство ЭТОГО корпуса, а
 * не правило: HULL_HALF берёт координату по модулю, то есть расстояние
 * от центра модели до самого дальнего конца, и у корпуса со смещённым
 * центром масс удвоение дало бы габарит по длинной стороне с обоих
 * концов. Порту такой запас нужен (в щель лезет самая выпирающая
 * точка), а карточке корабля — нет.
 */
export const HULL_SIZE = (() => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < HULL_VERTS.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], HULL_VERTS[i + a]);
      hi[a] = Math.max(hi[a], HULL_VERTS[i + a]);
    }
  }
  return { x: (hi[0] - lo[0]) * MM, y: (hi[1] - lo[1]) * MM, z: (hi[2] - lo[2]) * MM };
})();

/**
 * Сопла маневровых: где видно струю, когда корабль раскручивают или
 * останавливают.
 *
 * Пара на каждую ось, на противоположных концах корпуса — момент создаёт
 * именно пара, одиночное сопло сдвигало бы корабль, а не поворачивало.
 * Струя выходит В ТУ СТОРОНУ, куда толкать не надо: чтобы поднять нос,
 * газ идёт из-под носа и поверх хвоста; при обратном моменте работает
 * другая пара, поэтому точки хранятся на оба знака.
 *
 * Ищутся они ПО САМОЙ МОДЕЛИ — крайняя вершина корпуса в нужном
 * направлении. Через габаритный ящик это делать нельзя: корпус его не
 * заполняет, и «сверху на конце крыла» оказывалось в пустоте в стороне
 * от корабля — огоньки висели сами по себе. Направление берётся в долях
 * габарита, чтобы длинная ось не перевешивала короткую.
 */
// Направления поиска: главная ось с весом, вторая — с единицей. Вес
// нужен, чтобы «сверху на конце крыла» не превращалось в «на верхушке
// киля»: сама по себе высота у этого корпуса самая короткая ось, и в
// долях габарита она перевешивала бы всё остальное.
const RCS_DIRS = {
  // Нос вверх (знак +1): снизу у носа и сверху у хвоста.
  pitch: [{ x: 0, y: -1, z: 2 }, { x: 0, y: 1, z: -2 }],
  // Нос вправо: слева у носа и справа у хвоста.
  yaw: [{ x: -1.5, y: 0, z: 2 }, { x: 1.5, y: 0, z: -2 }],
  // Правое крыло вниз: сверху на правом крыле и снизу на левом.
  roll: [{ x: 2, y: 1, z: 0 }, { x: -2, y: -1, z: 0 }],
};

// Какие оси зеркалятся при обратном моменте: у тангажа меняется верх-низ,
// у рыскания лево-право, у крена и то и другое.
const RCS_MIRROR = { pitch: { x: 1, y: -1 }, yaw: { x: -1, y: 1 }, roll: { x: -1, y: -1 } };

/**
 * Точки сопел на конкретном корпусе: rcs[ось][0] — при моменте +1,
 * rcs[ось][1] — при −1.
 */
export function rcsPorts(verts, half) {
  const pick = (d) => {
    let best = verts[0], bestD = -Infinity;
    for (const v of verts) {
      const s = (v.x / half.x) * d.x + (v.y / half.y) * d.y + (v.z / half.z) * d.z;
      if (s > bestD) { bestD = s; best = v; }
    }
    return v3(best.x, best.y, best.z);
  };
  const out = {};
  for (const axis of ['pitch', 'yaw', 'roll']) {
    const m = RCS_MIRROR[axis];
    out[axis] = [
      RCS_DIRS[axis].map((d) => pick(d)),
      RCS_DIRS[axis].map((d) => pick({ x: d.x * m.x, y: d.y * m.y, z: d.z })),
    ];
  }
  return out;
}

/**
 * Пяты шасси в осях корпуса: то, чем корабль касается грунта.
 *
 * Все три на одной высоте — ровно GEAR_CLEAR под центром масс, — поэтому
 * по ним можно и ставить корабль на склон, и проверять касание: какая
 * пята первой дошла до земли, та и коснулась (js/game/landing.js).
 */
export const GEAR_FEET = HULL_GEAR.map((p) => v3(p[0] * MM, -GEAR_CLEAR, p[2] * MM));

/**
 * Дула: откуда вылетают болты.
 *
 * Берутся от габарита корпуса, а не отдельными числами в модели: у
 * процедурных корпусов (клин, шаттл) своих точек нет вовсе, а промах в
 * метр-другой у дула не виден никому. Разнесены по бортам и вынесены
 * вперёд — выстрел должен уходить ИЗ корабля, а не из его середины.
 */
/**
 * Полуоси оболочки щита, км.
 *
 * Шар вокруг клиновидного корпуса выглядит именно шаром — чужой формой,
 * надетой на корабль. Поэтому оболочка повторяет габарит: она шире, чем
 * выше, и вытянута по длине. Но не буквально: у этого корпуса высота
 * втрое меньше размаха, и точная копия габарита читалась бы блином, а не
 * щитом, — поэтому оси подтянуты к среднему на четверть.
 *
 * Размер же подбирается ПО САМИМ ВЕРШИНАМ, а не по габаритному ящику, и
 * это не придирка: эллипсоид, который просто больше ящика, его углов не
 * накрывает. У корпуса со скошенными крыльями законцовки лежат как раз в
 * углах — и торчали наружу, хотя по габаритам «всё влезало».
 */
export function shieldAxesOf(verts, size) {
  const half = [size.x / 2, size.y / 2, size.z / 2];
  const avg = (half[0] + half[1] + half[2]) / 3;
  const k = 0.75;                       // насколько держимся габарита
  const shape = half.map((h) => avg + (h - avg) * k);

  // Во сколько раз раздуть эту форму, чтобы внутрь попала самая
  // выступающая вершина. Для эллипсоида «внутри» — это сумма квадратов
  // долей по осям меньше единицы; корень из наибольшей суммы и есть
  // искомый множитель.
  let worst = 1;
  for (const v of verts) {
    worst = Math.max(worst, Math.hypot(v.x / shape[0], v.y / shape[1], v.z / shape[2]));
  }
  // Небольшой зазор сверх этого: оболочка должна ОХВАТЫВАТЬ корпус, а не
  // лежать на нём — иначе она читается как обшивка, а не как щит.
  return shape.map((v) => v * worst * 1.08);
}
export const SHIELD_AXES = shieldAxesOf(
  Array.from({ length: HULL_VERTS.length / 3 }, (_, i) => v3(HULL_VERTS[i * 3] * MM, HULL_VERTS[i * 3 + 1] * MM, HULL_VERTS[i * 3 + 2] * MM)),
  HULL_SIZE);

export const gunPortsOf = (size) => [
  v3(-size.x * 0.30, -size.y * 0.10, size.z * 0.30),
  v3(size.x * 0.30, -size.y * 0.10, size.z * 0.30),
];
export const GUN_PORTS = gunPortsOf(HULL_SIZE);

// Небольшой транспорт — понадобится для NPC и как «чужой» силуэт.
export function buildShuttle() {
  const L = 0.022, W = 0.014, H = 0.011;
  const pf = [
    { x: 0, z: 1.0 }, { x: 0.7, z: 0.2 }, { x: 0.7, z: -1.0 },
    { x: -0.7, z: -1.0 }, { x: -0.7, z: 0.2 },
  ].map((p) => ({ x: p.x * W, z: p.z * L }));
  const top = [0.2, 0.8, 0.7, 0.7, 0.8].map((y) => y * H);
  const bot = [-0.15, -0.5, -0.45, -0.45, -0.5].map((y) => y * H);
  const mesh = loft(pf, top, bot, [190, 180, 150], [110, 104, 88], [150, 142, 120]);
  mesh.exhausts = [v3(0, H * 0.1, -L * 1.1)];
  mesh.length = L * 2;
  return boundOf(mesh);
}
