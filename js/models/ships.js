// Модели кораблей. Все размеры в километрах (длина корпуса ~65 м).
//
// Корпус игрока приходит готовой моделью (js/models/hull.data.js,
// собирается из CC0-пака: npm run ship). Процедурный клин, с которого
// всё начиналось, остался рядом — buildWedge: по нему видно, каких
// обводов ждёт остальной код, и он же запасной вариант, если данных
// корпуса нет.

import { v3 } from '../core/vec3.js';
import { loft, box, prismZ, makeMesh, mergeMeshes, transformMesh } from './geometry.js';
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
  return boundOf(mesh);
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

const GEAR_METAL = [150, 154, 162];
const GEAR_PAD = [96, 100, 108];

/**
 * Стойка шасси: единичная, от точки крепления (y = 0) вниз к пяте
 * (y = -1). Рисуется по одной на каждую точку крепления с масштабом по
 * степени выпуска — стойка выдвигается телескопически.
 *
 * Три стойки: передняя и две основные. Точки крепления и длина живут
 * здесь же, рядом с обводами корпуса.
 */
export function buildGear() {
  const strut = box(0.13, 0.5, 0.13, GEAR_METAL, v3(0, -0.5, 0));
  const pad = box(0.34, 0.07, 0.30, GEAR_PAD, v3(0, -0.98, 0));
  const mesh = mergeMeshes([strut, pad]);

  // Точки крепления идут вместе с корпусом: конвертер ставит их по
  // самому низкому месту днища, иначе стойка растёт из воздуха или из
  // середины обшивки.
  mesh.hardpoints = HULL_GEAR.map(pt);
  // Длина у КАЖДОЙ стойки своя — такая, чтобы все пяты оказались на
  // одной высоте (ровно GEAR_CLEAR под центром масс). С общей длиной
  // пяты висели на разной высоте, и корабль на ровной площадке стоял бы
  // на двух стойках из трёх, а третья уходила бы в грунт.
  mesh.legLengths = mesh.hardpoints.map((h) => Math.max(0.001, GEAR_CLEAR + h.y));
  mesh.legLength = Math.max(...mesh.legLengths);
  return boundOf(mesh);
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
