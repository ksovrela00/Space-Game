// Кабина: то, что видно с места пилота.
//
// Почему она СОБРАНА ЗДЕСЬ, а не взята готовой моделью. Готовая была —
// и не подошла по существу: любая отдельная кабина сделана как
// самостоятельный корабль, со своим носом, своей крышей и своим
// СТЕКЛОМ. Стекло у автора прозрачное, а у нас прозрачности нет вовсе
// (js/gl/mesh.js: плоское затенение, цвет на грань), и кабина выходила
// наглухо заваренной коробкой. Вырезать в ней проём нечем: у модели нет
// разделения на раму и стекло, есть большие плиты, и вырез съедал раму
// вместе с ними — оставалась чёрная столешница.
//
// Собранная кабина этой беды не знает: проём у неё не вырезан, а задан
// — рамы там просто нет. Заодно все размеры берутся от НАШЕГО корабля и
// от поля зрения игры, а не подгоняются к чужой модели.
//
// Устройство:
//
//   * РАМА ФОНАРЯ — две стойки, верхняя балка с перемычкой и нижний
//     обвод. Она обрамляет обзор, не залезая в него: стойки стоят
//     дальше 36° вбок, а по горизонтали видно ±50°, то есть в кадре они
//     по краям;
//   * ПРИБОРНАЯ ДОСКА — наклонная панель под обводом, на ней три бухты:
//     левый экран, круглый радар по центру, правый экран. Цифры на них
//     рисует HUD (js/ui/hud.js), а места под них берутся ОТСЮДА же, из
//     той же геометрии, — поэтому показания всегда лежат на экране, а
//     не рядом с ним;
//   * ВЕРХНИЕ ЭКРАНЫ на стойках — два наклонённых к пилоту табло;
//   * ШТУРВАЛ — колонка с двумя рогами, поставленная так, чтобы её было
//     видно: поле зрения игры 68°, вниз от центра видно 34°, а руки на
//     настоящем штурвале лежат ниже — в кадре их бы просто не было;
//   * ОБОЛОЧКА — пол, борта, задняя переборка и потолок за фонарём:
//     кабина должна быть закрытой, когда пилот вертит головой.
//
// Все экраны — СВЕТЯЩИЕСЯ грани (флаг emissive): на ночной стороне и в
// тени планеты кабина иначе превращается в чёрный прямоугольник, а
// приборы на ней — в текст, висящий в пустоте.
//
// Начало координат — глаз пилота, оси — оси корабля. Там же стоит
// камера в кокпите, поэтому кабина рисуется без единого вычитания:
// только поворот (js/gl/scene.js, drawCockpit).

import { v3 } from '../core/vec3.js';
import { makeMesh, mergeMeshes } from './geometry.js';

const M = 0.001;                  // метры -> километры игры

// Палитра. Корпус — в тон обшивке корабля (js/models/ships.js), экраны
// — приборная синева HUD, кнопки — три цвета, по которым в кабине и
// различают ряды.
const FRAME = [78, 88, 100];
const FRAME_LIT = [116, 128, 142];
const FRAME_DARK = [52, 60, 70];
const DASH = [60, 68, 78];
const DASH_LIP = [96, 106, 118];
const SCREEN = [30, 76, 124];
const SCREEN_RIM = [78, 88, 100];
const RADAR = [24, 64, 108];
const BTN_BLUE = [60, 130, 180];
const BTN_AMBER = [180, 130, 60];
const BTN_RED = [170, 70, 60];
const YOKE_ARM = [98, 108, 120];
const YOKE_GRIP = [46, 52, 60];
// Накладки и лампы. В кабине, собранной из одного серого, глазу не за
// что зацепиться: ребро между двумя одинаковыми плоскостями не видно
// вовсе. Накладка другого тона держит форму даже в плоском затенении.
const ACCENT = [122, 54, 46];
const LAMP_RED = [190, 78, 64];
const LAMP_CYAN = [70, 150, 200];

// --- Размеры кабины ---------------------------------------------------------
//
// Заданы в метрах и от поля зрения, а не от модели: по горизонтали
// видно ±50°, по вертикали ±34°. Отсюда всё и следует — проём должен
// покрывать центр кадра, рама стоять по его краям, доска начинаться
// сразу под проёмом, а верхние экраны висеть там, куда взгляд попадает
// поворотом головы, а не расфокусировкой.
const CP = {
  // Проём фонаря: нижняя кромка, верхняя, полуширина и удаление.
  sillY: -0.30, sillZ: 0.92,       // низ проёма — он же верх доски
  topY: 0.54, topZ: 0.86,          // верх проёма чуть ближе: фонарь заваливается
  halfW: 0.68,                     // полуширина проёма
  beam: 0.09,                      // толщина рамы
  // Доска: от обвода вниз и назад, к пилоту.
  dashY: -0.58, dashZ: 0.60,
  dashHalfW: 0.82,
  // Бухты приборов на доске: смещение от центра и размеры (в осях доски).
  // Бухты приборов. Размеры разные и заданы ПО ФОРМЕ САМИХ ПРИБОРОВ
  // (js/ui/hud.js): левый блок почти квадратный, правый — широкий, в
  // нём имя цели. Если бухту сделать «красивой», а не по блоку,
  // показания вылезут за экран или будут болтаться в его углу.
  bayOffset: 0.46, bayRise: 0.125,
  bayLW: 0.34, bayLH: 0.29,        // левый экран: тяга, скорость, форсаж, корпус
  bayRW: 0.46, bayRH: 0.23,        // правый: цель, дистанция, компас
  radarR: 0.142,
  // Верхние экраны: угол вбок, угол вверх, удаление и размер.
  topScreenAz: 31 * Math.PI / 180,
  topScreenEl: 22 * Math.PI / 180,
  topScreenD: 0.95,
  topScreenW: 0.32, topScreenH: 0.2,
  // Штурвал.
  yokeZ: 0.72, yokeBaseY: -0.66, yokeTopY: -0.34, yokeHalf: 0.19,
  // Оболочка кабины.
  sideX: 0.84, floorY: -1.05, roofY: 0.76, backZ: -0.68,
};

const add = (a, b, k = 1) => v3(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const norm = (a) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
};
const cross = (a, b) => v3(
  a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/** Плоская панель: центр, две оси в её плоскости, размеры. */
function quad(c, right, up, w, h, color, emissive = false) {
  const hw = w / 2, hh = h / 2;
  const verts = [
    add(add(c, right, -hw), up, -hh), add(add(c, right, hw), up, -hh),
    add(add(c, right, hw), up, hh), add(add(c, right, -hw), up, hh),
  ];
  return makeMesh(verts, [{ v: [0, 1, 2, 3], c: color, emissive, twoSided: true }]);
}

/**
 * Брус между двумя точками: сечение w × h, ориентированное по up.
 * Из таких собрана вся рама — стойки, балки, обвод.
 */
function slab(p0, p1, up, w, h, color, capColor = null) {
  const dir = norm(sub(p1, p0));
  const right = norm(cross(up, dir));
  const u = norm(cross(dir, right));
  const hw = w / 2, hh = h / 2;
  const corner = (p, sx, sy) => add(add(p, right, sx * hw), u, sy * hh);
  const verts = [
    corner(p0, -1, -1), corner(p0, 1, -1), corner(p0, 1, 1), corner(p0, -1, 1),
    corner(p1, -1, -1), corner(p1, 1, -1), corner(p1, 1, 1), corner(p1, -1, 1),
  ];
  const cap = capColor || color;
  return makeMesh(verts, [
    { v: [0, 1, 2, 3], c: cap }, { v: [4, 5, 6, 7], c: cap },
    { v: [0, 1, 5, 4], c: color }, { v: [2, 3, 7, 6], c: color },
    { v: [1, 2, 6, 5], c: color }, { v: [3, 0, 4, 7], c: color },
  ]);
}

/** Круглая бухта радара: подсвеченное поле и обод вокруг него. */
function dial(c, right, up, r, rimColor, faceColor, sides = 24) {
  const verts = [v3(c.x, c.y, c.z)];
  const inner = [], outer = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    verts.push(add(add(c, right, Math.cos(a) * r), up, Math.sin(a) * r));
    inner.push(verts.length - 1);
  }
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    verts.push(add(add(c, right, Math.cos(a) * r * 1.14), up, Math.sin(a) * r * 1.14));
    outer.push(verts.length - 1);
  }
  const defs = [];
  for (let i = 0; i < sides; i++) {
    defs.push({ v: [0, inner[i], inner[(i + 1) % sides]], c: faceColor, emissive: true });
    // Обод не светится: по нему видно, что радар вставлен в доску, а не
    // нарисован на ней.
    defs.push({
      v: [inner[i], outer[i], outer[(i + 1) % sides], inner[(i + 1) % sides]],
      c: rimColor, twoSided: true,
    });
  }
  return makeMesh(verts, defs);
}

/** Ряды кнопок: мелкие светящиеся квадратики на панели. */
function buttons(c, right, up, cols, rows, step, size, colors) {
  const parts = [];
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const p = add(add(c, right, (i - (cols - 1) / 2) * step),
        up, (r - (rows - 1) / 2) * step);
      parts.push(quad(p, right, up, size, size,
        colors[(i + r * 3) % colors.length], true));
    }
  }
  return mergeMeshes(parts);
}

/**
 * Собрать кабину.
 *
 * @returns {{shell, yoke, pivot, slots, bound}}
 */
export function buildCockpit() {
  const parts = [];
  const X = v3(1, 0, 0), Y = v3(0, 1, 0), Z = v3(0, 0, 1);

  // --- проём и рама ---------------------------------------------------------
  const sillL = v3(-CP.halfW, CP.sillY, CP.sillZ);
  const sillR = v3(CP.halfW, CP.sillY, CP.sillZ);
  const topL = v3(-CP.halfW * 0.96, CP.topY, CP.topZ);
  const topR = v3(CP.halfW * 0.96, CP.topY, CP.topZ);

  // Стойки собраны СЛОЯМИ: широкое тёмное основание, узкая светлая
  // накладка поверх и красная полоса по краю. Один брус в плоском
  // затенении читается как плоская серая полоса — именно так и вышло в
  // первом заходе; слои дают кромки, по которым видно объём.
  for (const [a, b, sign] of [[sillL, topL, -1], [sillR, topR, 1]]) {
    parts.push(slab(a, b, Y, CP.beam * 1.6, CP.beam * 1.15, FRAME_DARK, FRAME));
    const inA = add(a, X, -sign * 0.035), inB = add(b, X, -sign * 0.035);
    parts.push(slab(inA, inB, Y, CP.beam * 0.75, CP.beam * 1.45, FRAME, FRAME_LIT));
    parts.push(slab(add(inA, X, -sign * 0.03), add(inB, X, -sign * 0.03), Y,
      0.022, CP.beam * 1.5, ACCENT));
    // Лампы на стойке: три огонька, как в любой кабине.
    for (let i = 0; i < 3; i++) {
      const t = 0.3 + i * 0.18;
      const p = v3(a.x + (b.x - a.x) * t - sign * 0.055,
        a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t + 0.03);
      parts.push(quad(p, Z, Y, 0.022, 0.022, i === 1 ? LAMP_CYAN : LAMP_RED, true));
    }
  }
  // Верхняя балка и нижний обвод.
  parts.push(slab(topL, topR, Y, CP.beam * 0.8, CP.beam, FRAME, FRAME_LIT));
  parts.push(slab(sillL, sillR, Y, CP.beam * 1.1, CP.beam * 0.8, DASH_LIP, FRAME_LIT));
  // Центральный блок над проёмом: короб с накладкой и лампами. Раньше
  // тут стояли два бруса «домиком» — в кадре они читались чёрной
  // летучей мышью, висящей посреди неба.
  const capC = v3(0, CP.topY - 0.045, CP.topZ + 0.01);
  parts.push(slab(add(capC, X, -0.19), add(capC, X, 0.19), Z, 0.1, 0.075, FRAME, FRAME_LIT));
  parts.push(slab(add(capC, X, -0.13), add(capC, X, 0.13), Z, 0.03, 0.09, ACCENT));
  for (const sx of [-0.08, 0, 0.08]) {
    parts.push(quad(add(add(capC, X, sx), Y, -0.052), X, Z, 0.02, 0.02,
      sx === 0 ? LAMP_CYAN : LAMP_RED, true));
  }

  // --- приборная доска ------------------------------------------------------
  // Плоскость доски: от нижнего обвода вниз и назад. Её оси — те же, по
  // которым потом встают приборы.
  const sillMid = v3(0, CP.sillY, CP.sillZ);
  const dashMid = v3(0, CP.dashY, CP.dashZ);
  const dashUp = norm(sub(sillMid, dashMid));          // «вверх» по доске
  const dashN = norm(cross(X, dashUp));                // нормаль доски
  const dashC = v3(0, (CP.sillY + CP.dashY) / 2, (CP.sillZ + CP.dashZ) / 2);
  const dashH = Math.hypot(CP.sillY - CP.dashY, CP.sillZ - CP.dashZ);
  parts.push(quad(dashC, X, dashUp, CP.dashHalfW * 2, dashH, DASH));
  // Крылья козырька: доска уходит к бортам и чуть выше.
  parts.push(slab(sillL, v3(-CP.dashHalfW, CP.dashY + 0.16, CP.dashZ + 0.06),
    Y, CP.beam, CP.beam, FRAME_DARK));
  parts.push(slab(sillR, v3(CP.dashHalfW, CP.dashY + 0.16, CP.dashZ + 0.06),
    Y, CP.beam, CP.beam, FRAME_DARK));

  // Бухты приборов: два экрана и радар. Они приподняты над доской на
  // сантиметр — иначе тонут в ней и по краям видны швы.
  const lift = (p, k = 0.012) => add(p, dashN, k);
  // Бухты стоят не по середине доски, а в её ВЕРХНЕЙ части: вниз от
  // центра кадра видно 34°, и приборы, положенные по середине, лежали
  // бы у самой нижней кромки. Так они попадают на 24° — туда, куда
  // взгляд опускается, не теряя из виду курс.
  const bayRow = add(dashC, dashUp, CP.bayRise);
  const bayL = add(bayRow, X, -CP.bayOffset);
  const bayR = add(bayRow, X, CP.bayOffset);
  parts.push(quad(lift(bayL), X, dashUp, CP.bayLW + 0.03, CP.bayLH + 0.03, SCREEN_RIM));
  parts.push(quad(lift(bayL, 0.016), X, dashUp, CP.bayLW, CP.bayLH, SCREEN, true));
  parts.push(quad(lift(bayR), X, dashUp, CP.bayRW + 0.03, CP.bayRH + 0.03, SCREEN_RIM));
  parts.push(quad(lift(bayR, 0.016), X, dashUp, CP.bayRW, CP.bayRH, SCREEN, true));
  parts.push(dial(lift(bayRow, 0.016), X, dashUp, CP.radarR, SCREEN_RIM, RADAR));

  // Ряды кнопок между бухтами — мелочь, из-за которой доска перестаёт
  // быть плитой.
  parts.push(buttons(lift(add(add(bayRow, X, -0.225), dashUp, -0.02), 0.016),
    X, dashUp, 4, 3, 0.034, 0.018, [BTN_BLUE, BTN_AMBER, BTN_RED]));
  parts.push(buttons(lift(add(add(bayRow, X, 0.225), dashUp, -0.02), 0.016),
    X, dashUp, 4, 3, 0.034, 0.018, [BTN_AMBER, BTN_BLUE, BTN_RED]));

  // --- верхние экраны на стойках --------------------------------------------
  const topScreen = (sign) => {
    const az = sign * CP.topScreenAz, el = CP.topScreenEl, d = CP.topScreenD;
    const c = v3(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d,
      Math.cos(az) * Math.cos(el) * d);
    // Экран развёрнут К ПИЛОТУ: его нормаль смотрит в начало координат.
    const n = norm(v3(-c.x, -c.y, -c.z));
    // ТО, ЧТО БЫЛО СЛОМАНО: ось «вправо» бралась от НОРМАЛИ, то есть от
    // направления НА пилота, — и оказывалась зеркальной. Текст на
    // табло читался задом наперёд. Брать её надо от направления
    // ВЗГЛЯДА (на экран), ровно как строится базис камеры
    // (js/core/basis.js, lookAlong: right = cross(up, fwd)).
    const view = norm(c);
    const right = norm(cross(Y, view));
    return { c, right, up: cross(view, right), n };
  };
  const screens = {};
  for (const [key, sign] of [['upLeft', -1], ['upRight', 1]]) {
    const s = topScreen(sign);
    // Кронштейн от стойки к экрану — чтобы табло не висело в воздухе.
    const root = v3(sign * CP.halfW * 0.92, CP.topY - 0.12, CP.topZ - 0.02);
    parts.push(slab(root, add(s.c, s.n, 0.04), Y, 0.05, 0.05, FRAME_DARK));
    parts.push(quad(add(s.c, s.n, 0.008), s.right, s.up,
      CP.topScreenW + 0.035, CP.topScreenH + 0.035, SCREEN_RIM));
    parts.push(quad(s.c, s.right, s.up, CP.topScreenW, CP.topScreenH, SCREEN, true));
    screens[key] = s;
  }

  // --- оболочка кабины ------------------------------------------------------
  // Пол, борта, задняя переборка и потолок за фонарём. Нужны не для
  // красоты: без них, повернув голову, пилот видит открытый космос — и
  // кабина перестаёт быть кабиной.
  const fl = CP.floorY, rf = CP.roofY, sx = CP.sideX, bz = CP.backZ, fz = CP.sillZ + 0.05;
  parts.push(quad(v3(0, fl, (bz + fz) / 2), X, Z, sx * 2, fz - bz, FRAME_DARK));
  parts.push(quad(v3(0, rf, (bz + CP.topZ) / 2), X, Z, sx * 2, CP.topZ - bz, FRAME_DARK));
  // Борта — не одна плита, а набор: тёмная обшивка, светлый пояс по
  // линии глаз, рёбра через каждые тридцать сантиметров и пара ламп.
  // Гладкая плита в плоском затенении даёт ровную серую заливку на треть
  // кадра — именно она и вышла в первом заходе.
  for (const sign of [-1, 1]) {
    const wx = sign * sx;
    parts.push(quad(v3(wx, (fl + rf) / 2, (bz + fz) / 2), Z, Y, fz - bz, rf - fl, FRAME_DARK));
    // Пояс на уровне глаз: по нему читается и высота, и длина кабины.
    parts.push(slab(v3(wx - sign * 0.02, 0.06, fz - 0.05), v3(wx - sign * 0.02, 0.06, bz + 0.08),
      X, 0.12, 0.05, FRAME, FRAME_LIT));
    parts.push(slab(v3(wx - sign * 0.03, 0.0, fz - 0.05), v3(wx - sign * 0.03, 0.0, bz + 0.08),
      X, 0.03, 0.022, ACCENT));
    // Рёбра: короткие стойки от пояса к полу и к потолку.
    for (let i = 0; i < 4; i++) {
      const z = fz - 0.16 - i * 0.34;
      if (z < bz + 0.1) break;
      parts.push(slab(v3(wx - sign * 0.02, rf - 0.04, z), v3(wx - sign * 0.02, fl + 0.06, z),
        Z, 0.05, 0.05, FRAME));
    }
    parts.push(quad(v3(wx - sign * 0.06, 0.26, fz - 0.22), Z, Y, 0.06, 0.02, LAMP_CYAN, true));
    parts.push(quad(v3(wx - sign * 0.06, -0.12, fz - 0.5), Z, Y, 0.06, 0.02, LAMP_RED, true));
  }
  parts.push(quad(v3(0, (fl + rf) / 2, bz), X, Y, sx * 2, rf - fl, FRAME_DARK));
  // Боковые пульты вдоль бортов — то, что видно, если опустить взгляд вбок.
  for (const sign of [-1, 1]) {
    const a = v3(sign * (sx - 0.14), CP.dashY + 0.1, CP.dashZ - 0.05);
    const b = v3(sign * (sx - 0.14), CP.dashY - 0.02, bz + 0.5);
    parts.push(slab(a, b, Y, 0.26, 0.1, DASH, DASH_LIP));
    parts.push(buttons(v3(sign * (sx - 0.14), CP.dashY + 0.13, (a.z + b.z) / 2),
      Z, X, 5, 2, 0.05, 0.022, [BTN_AMBER, BTN_BLUE, BTN_RED]));
  }

  const shell = mergeMeshes(parts);

  // --- штурвал --------------------------------------------------------------
  // Колонка с двумя рогами. Она качается на своём основании, поэтому
  // вершины отсчитаны ОТ него: поворот тогда сводится к повороту базиса
  // (js/gl/scene.js, drawCockpit).
  const pivot = v3(0, CP.yokeBaseY, CP.yokeZ);
  const rel = (x, y, z) => v3(x - pivot.x, y - pivot.y, z - pivot.z);
  const yokeParts = [];
  yokeParts.push(slab(rel(0, CP.yokeBaseY, CP.yokeZ), rel(0, CP.yokeTopY - 0.06, CP.yokeZ),
    Z, 0.07, 0.07, YOKE_ARM, FRAME_DARK));
  yokeParts.push(slab(rel(-CP.yokeHalf, CP.yokeTopY - 0.06, CP.yokeZ),
    rel(CP.yokeHalf, CP.yokeTopY - 0.06, CP.yokeZ), Z, 0.05, 0.05, YOKE_ARM));
  for (const sign of [-1, 1]) {
    yokeParts.push(slab(rel(sign * CP.yokeHalf, CP.yokeTopY - 0.06, CP.yokeZ),
      rel(sign * CP.yokeHalf, CP.yokeTopY + 0.04, CP.yokeZ - 0.04), X,
      0.055, 0.055, YOKE_GRIP, YOKE_ARM));
  }
  const yoke = mergeMeshes(yokeParts);

  // --- места под приборы ----------------------------------------------------
  // Берутся из ТОЙ ЖЕ геометрии, что и экраны: показания не могут
  // разъехаться с бухтами, в которых они лежат.
  // Слот несёт и РАЗМЕР экрана: приборы рисуются в своих пикселях, а
  // сколько их укладывается в бухту, знает только она сама.
  const slotOf = (c, right, up, w, h) => ({
    pos: v3(c.x, c.y, c.z), right: v3(right.x, right.y, right.z),
    up: v3(up.x, up.y, up.z), normal: norm(cross(right, up)), w, h,
  });
  const slots = {
    left: slotOf(lift(bayL, 0.02), X, dashUp, CP.bayLW, CP.bayLH),
    mid: slotOf(lift(bayRow, 0.02), X, dashUp, CP.radarR * 1.9, CP.radarR * 1.9),
    right: slotOf(lift(bayR, 0.02), X, dashUp, CP.bayRW, CP.bayRH),
    upLeft: slotOf(add(screens.upLeft.c, screens.upLeft.n, 0.004),
      screens.upLeft.right, screens.upLeft.up, CP.topScreenW, CP.topScreenH),
    upRight: slotOf(add(screens.upRight.c, screens.upRight.n, 0.004),
      screens.upRight.right, screens.upRight.up, CP.topScreenW, CP.topScreenH),
  };
  // Нормаль слота обязана смотреть на пилота: по ней HUD проверяет, не
  // повернулся ли экран изнанкой к камере.
  for (const s of Object.values(slots)) {
    if (s.normal.x * s.pos.x + s.normal.y * s.pos.y + s.normal.z * s.pos.z > 0) {
      s.normal.x = -s.normal.x; s.normal.y = -s.normal.y; s.normal.z = -s.normal.z;
    }
  }

  // Всё собрано в метрах — переводим в километры игры одним махом.
  const toKm = (mesh) => {
    for (const v of mesh.verts) { v.x *= M; v.y *= M; v.z *= M; }
    return mesh;
  };
  toKm(shell); toKm(yoke);
  for (const s of Object.values(slots)) {
    s.pos.x *= M; s.pos.y *= M; s.pos.z *= M;
    s.w *= M; s.h *= M;
  }
  pivot.x *= M; pivot.y *= M; pivot.z *= M;

  const lo = v3(Infinity, Infinity, Infinity), hi = v3(-Infinity, -Infinity, -Infinity);
  for (const v of shell.verts) {
    lo.x = Math.min(lo.x, v.x); hi.x = Math.max(hi.x, v.x);
    lo.y = Math.min(lo.y, v.y); hi.y = Math.max(hi.y, v.y);
    lo.z = Math.min(lo.z, v.z); hi.z = Math.max(hi.z, v.z);
  }

  return { shell, yoke, pivot, slots, bound: { lo, hi }, size: CP };
}

// Пределы отклонения штурвала. Это не физика, а показания: по ним
// видно, что ручка отдана, и насколько.
export const YOKE = {
  pitch: 0.24,        // рад — колонка от себя / на себя
  roll: 0.62,         // рад — поворот самого штурвала
  yaw: 0.16,          // рад — доворот педалями
  // За столько штурвал доходит до упора. Меньше, чем разгоняется сам
  // корабль (SHIP.rotRamp = 0.7 с): рука быстрее корпуса, иначе
  // управление выглядит запаздывающим.
  ramp: 0.18,         // с
};

export const makeYoke = () => ({ pitch: 0, yaw: 0, roll: 0 });

/**
 * Довести штурвал до положения ручек.
 *
 * Берутся именно РУЧКИ (ship.control), а не угловые скорости корабля:
 * штурвал — это то, что держит пилот, и стоять он должен там, куда его
 * отклонили, даже если корабль ещё не пошёл.
 */
export function updateYoke(yoke, control, dt) {
  const k = Math.min(1, dt / YOKE.ramp);
  const c = control || {};
  yoke.pitch += ((c.pitch || 0) * YOKE.pitch - yoke.pitch) * k;
  yoke.yaw += ((c.yaw || 0) * YOKE.yaw - yoke.yaw) * k;
  yoke.roll += ((c.roll || 0) * YOKE.roll - yoke.roll) * k;
  return yoke;
}
