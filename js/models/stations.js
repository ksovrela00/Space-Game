// Станции: «Кориолис» и «Орбис».
//
// Два типа, и тип у станции свой — он выбирается при постройке мира по
// семени системы (js/game/world.js). Прилёт в новую систему должен быть
// событием, а одинаковые порты во всей галактике — это ровно то, от чего
// небо становится обоями.
//
// ФОРМА — ИГРОВАЯ ГЕОМЕТРИЯ, А НЕ УКРАШЕНИЕ. В корпусе живут три вещи,
// от которых зависит игра: щель порта на оси вращения (крен приходится
// согласовывать с вращением станции), плоскость створа, от которой
// считается заход, и проверка столкновения. Поэтому корпус строится
// здесь кодом и проверяется тестами, а не берётся готовой моделью:
// скачанная модель не знает ни про щель, ни про то, что нарисованное
// обязано совпадать с тем, во что врезается корабль.
//
// А детали — тарелки, генераторы, баки, фермы, турели — взяты готовыми
// из CC0-пака Kenney (js/models/station.parts.js, собирается
// tools/station.mjs). Своими руками такое лепить незачем: именно мелочь
// отличает станцию от серой фигурки, и её в паке сотня.
//
// Размеры — канон Elite: «Кориолис» два километра поперёк. Прежняя
// станция была вдвое меньше и висела в кадре восьмигранной таблеткой.

import { v3 } from '../core/vec3.js';
import { makeMesh, mergeMeshes, orientOutward } from './geometry.js';
import { PARTS } from './station.parts.js';

// --- общее ------------------------------------------------------------------

/**
 * Щель порта, полуразмеры в км (176 x 60 м).
 *
 * Одна на все типы станций: в неё проходит корабль, и «у этого порта
 * щель поуже» означало бы, что в одном порту стыковаться можно, а в
 * другом нельзя. Проверка на то, что корпус в неё пролезает, — в
 * tools/test.mjs.
 */
export const SLOT = { hw: 0.088, hh: 0.030 };

export const STATION_KINDS = ['coriolis', 'orbis'];

// Цвета обшивки.
//
// Светлые намеренно. Тёмная станция на чёрном небе читается как дырка в
// кадре: света в космосе ровно один — солнце, — и всё, что отвернулось
// от него, уходит в ambient. Настоящие станции по той же причине белые:
// это терморегуляция, а не вкус художника. Оттенок голубоватый, чтобы
// станция не спорила с тёплым корпусом корабля.
const HULL = [134, 144, 160];
const HULL_LIT = [166, 176, 192];
const HULL_DARK = [88, 96, 112];
const PANEL = [150, 160, 176];
const PANEL_ALT = [108, 118, 134];
const TRIM = [214, 140, 58];
const FRAME = [176, 186, 202];
const TUNNEL = [26, 30, 38];
const BAY = [214, 178, 108];       // нутро ангара — тёплый свет
const APRON = [120, 128, 146];     // утопленная площадка створа
const WINDOW = [150, 200, 235];
const LIGHT_G = [90, 255, 130];
const LIGHT_R = [255, 90, 80];
const RADIATOR = [222, 228, 236];   // радиатор светлый: он и должен быть светлым
const SOLAR = [38, 52, 96];
const SOLAR_EDGE = [120, 130, 150];

const MM = 1e-3;   // деталь хранится в тысячных своего размера

/**
 * Поставить деталь из пака.
 *
 * Деталь приходит в своих осях: Y — вверх, низ на нуле, наибольший
 * размер 1000. Здесь она разворачивается на месте установки: `up` —
 * куда смотрит её верх, `fwd` — куда её «перёд». Так одна и та же ферма
 * идёт и на мачту вдоль оси, и в обвязку порта поперёк.
 *
 * @param size размер в километрах, который получит наибольшая сторона
 * @param dim  затемнение: пак светлый, а станция тёмная, и белая деталь
 *             на её фоне выглядит наклейкой
 */
function part(key, { at = v3(), size = 0.1, up = v3(0, 1, 0), fwd = v3(0, 0, 1), dim = 1 }) {
  const p = PARTS[key];
  if (!p) throw new Error(`нет детали ${key}: пересоберите npm run station`);

  // Правая тройка из up и fwd: fwd поджимаем, чтобы был перпендикулярен.
  const ul = Math.hypot(up.x, up.y, up.z) || 1;
  const uy = { x: up.x / ul, y: up.y / ul, z: up.z / ul };
  const d = fwd.x * uy.x + fwd.y * uy.y + fwd.z * uy.z;
  let fz = { x: fwd.x - uy.x * d, y: fwd.y - uy.y * d, z: fwd.z - uy.z * d };
  const fl = Math.hypot(fz.x, fz.y, fz.z);
  if (fl < 1e-6) {
    // fwd совпал с up — берём любое поперечное направление.
    fz = Math.abs(uy.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const dd = fz.x * uy.x + fz.y * uy.y + fz.z * uy.z;
    fz = { x: fz.x - uy.x * dd, y: fz.y - uy.y * dd, z: fz.z - uy.z * dd };
  }
  const f2 = Math.hypot(fz.x, fz.y, fz.z);
  fz.x /= f2; fz.y /= f2; fz.z /= f2;
  const rx = {
    x: uy.y * fz.z - uy.z * fz.y,
    y: uy.z * fz.x - uy.x * fz.z,
    z: uy.x * fz.y - uy.y * fz.x,
  };

  const k = size * MM;
  const verts = [];
  for (let i = 0; i < p.verts.length; i += 3) {
    const x = p.verts[i] * k, y = p.verts[i + 1] * k, z = p.verts[i + 2] * k;
    verts.push(v3(
      at.x + rx.x * x + uy.x * y + fz.x * z,
      at.y + rx.y * x + uy.y * y + fz.y * z,
      at.z + rx.z * x + uy.z * y + fz.z * z));
  }
  const defs = [];
  for (let i = 0; i < p.faces.length;) {
    const n = p.faces[i++];
    const v = p.faces.slice(i, i + n); i += n;
    const c = p.faces.slice(i, i + 3); i += 3;
    defs.push({ v, c: dim === 1 ? c : c.map((x) => Math.round(x * dim)) });
  }
  return makeMesh(verts, defs);
}

/** Плоская плашка: панель обшивки, окно, огонь. */
function patch(o, ax, ay, c, { glow = 0 } = {}) {
  const v = [
    v3(o.x - ax.x - ay.x, o.y - ax.y - ay.y, o.z - ax.z - ay.z),
    v3(o.x + ax.x - ay.x, o.y + ax.y - ay.y, o.z + ax.z - ay.z),
    v3(o.x + ax.x + ay.x, o.y + ax.y + ay.y, o.z + ax.z + ay.z),
    v3(o.x - ax.x + ay.x, o.y - ax.y + ay.y, o.z - ax.z + ay.z),
  ];
  return makeMesh(v, [{ v: [0, 1, 2, 3], c, twoSided: true, emissive: glow }]);
}

const mul = (v, k) => v3(v.x * k, v.y * k, v.z * k);
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);

/**
 * Рама створа и тоннель порта.
 *
 * Общая часть обоих типов: снаружи — многоугольник грани, внутри —
 * прямоугольная щель, между ними рама. Дальше щель уходит вглубь
 * тоннелем, и дно тоннеля СВЕТИТСЯ: ангар изнутри освещён, и в чёрном
 * небе именно это пятно света показывает, где порт.
 */
function portFace(outer, z, depth) {
  const n = outer.length;
  const out = [];

  // Восемь точек по внешнему контуру грани: рама тогда собирается
  // четырёхугольниками один к одному со следующим контуром.
  const out8 = [];
  for (let i = 0; i < 8; i++) out8.push(outer[Math.round(i * n / 8) % n]);

  // Утопленная ПЛОЩАДКА вокруг щели.
  //
  // Сама щель — 176 на 60 метров на грани в полтора километра, то есть
  // канонический почтовый ящик: глазами её не найти. Поэтому вокруг —
  // площадка в полкилометра, утопленная на тридцать метров, с огнями по
  // краям. Ищут её, а щель уже в середине площадки.
  const AW = 0.26, AH = 0.14, SINK = 0.03;
  const rect = (hw, hh) => [
    { x: hw, y: hh }, { x: 0, y: hh }, { x: -hw, y: hh }, { x: -hw, y: 0 },
    { x: -hw, y: -hh }, { x: 0, y: -hh }, { x: hw, y: -hh }, { x: hw, y: 0 },
  ];
  const apron = rect(AW, AH);
  const kx = 0.18;
  const inner = [
    { x: SLOT.hw, y: SLOT.hh }, { x: SLOT.hw * kx, y: SLOT.hh },
    { x: -SLOT.hw * kx, y: SLOT.hh }, { x: -SLOT.hw, y: SLOT.hh },
    { x: -SLOT.hw, y: -SLOT.hh }, { x: -SLOT.hw * kx, y: -SLOT.hh },
    { x: SLOT.hw * kx, y: -SLOT.hh }, { x: SLOT.hw, y: -SLOT.hh },
  ];

  // Рама: внешний контур -> край площадки.
  const fv = [];
  for (const p of out8) fv.push(v3(p.x, p.y, z));
  for (const p of apron) fv.push(v3(p.x, p.y, z));
  const ff = [];
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    ff.push({ v: [i, j, 8 + j, 8 + i], c: i % 2 ? FRAME : PANEL });
  }
  out.push(orientOutward(makeMesh(fv, ff), v3(0, 0, z - 1)));

  // Стенки и дно площадки: дно СВЕТИТСЯ вполсилы. Порт обязан быть виден
  // и тогда, когда станция повёрнута к солнцу спиной, — а это половина
  // витка, и именно в эту половину заходить страшнее всего.
  const av = [];
  for (const p of apron) av.push(v3(p.x, p.y, z));
  for (const p of apron) av.push(v3(p.x * 0.92, p.y * 0.86, z - SINK));
  for (const p of inner) av.push(v3(p.x, p.y, z - SINK));
  const af = [];
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    af.push({ v: [i, j, 8 + j, 8 + i], c: PANEL_ALT, twoSided: true });
    af.push({ v: [8 + i, 8 + j, 16 + j, 16 + i], c: APRON, twoSided: true, emissive: 0.38 });
  }
  out.push(makeMesh(av, af));

  // Тоннель: щель уходит внутрь и слегка сужается, дно ангара светится.
  const tv = [];
  for (const p of inner) tv.push(v3(p.x, p.y, z - SINK));
  for (const p of inner) tv.push(v3(p.x * 0.92, p.y * 0.92, z - SINK - depth));
  const tf = [];
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    tf.push({ v: [i, j, 8 + j, 8 + i], c: TUNNEL, twoSided: true });
  }
  tf.push({ v: [8, 9, 10, 11, 12, 13, 14, 15], c: BAY, twoSided: true, emissive: 0.6 });
  out.push(makeMesh(tv, tf));

  // Огни по краям площадки: сверху зелёные, снизу красные. По ним видно
  // не только ГДЕ порт, но и КАКОЙ крен нужен: станция вращается, и пара
  // рядов поворачивается вместе с ней.
  for (const sgn of [-1, 1]) {
    for (let i = -4; i <= 4; i++) {
      const o = v3(i * AW * 0.2, sgn * (AH - 0.014), z - SINK + 0.004);
      out.push(patch(o, v3(0.022, 0, 0), v3(0, 0.009, 0),
        sgn > 0 ? LIGHT_G : LIGHT_R, { glow: 1 }));
    }
  }

  // Светящаяся рамка вокруг площадки и четыре стрелки внутрь.
  //
  // Это разметка аэродрома, и нужна она по той же причине: найти створ
  // глазами на грани в полтора километра невозможно, а подходить надо
  // именно к нему. Светится сама — в тени планеты обычная краска не
  // видна вовсе.
  const RW = AW * 1.7, RH = AH * 1.9;
  for (const sgn of [-1, 1]) {
    out.push(patch(v3(0, sgn * RH, z + 0.004), v3(RW, 0, 0), v3(0, 0.008, 0),
      TRIM, { glow: 0.55 }));
    out.push(patch(v3(sgn * RW, 0, z + 0.004), v3(0.008, 0, 0), v3(0, RH, 0),
      TRIM, { glow: 0.55 }));
  }
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const c = Math.cos(a), sn = Math.sin(a);
    for (let k = 1; k <= 3; k++) {
      const t = 1 + k * 0.42;
      out.push(patch(
        v3(c * RW * t * 0.62, sn * RH * t * 0.62, z + 0.004),
        v3(c * 0.028 - sn * 0.02, sn * 0.028 + c * 0.02, 0),
        v3(-sn * 0.012 - c * 0.006, c * 0.012 - sn * 0.006, 0),
        TRIM, { glow: 0.5 - k * 0.1 }));
    }
  }
  return out;
}

/** Ряд окон вдоль отрезка: обитаемое нутро, видное снаружи. */
function windows(from, to, n, ax, ay, glow = 0.85) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out.push(patch(v3(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
      from.z + (to.z - from.z) * t), ax, ay, WINDOW, { glow }));
  }
  return out;
}

/**
 * Коробка по трём полуосям.
 *
 * Объём, а не накладка: плоское затенение не показывает никаких линий
 * внутри одной плоскости, и «панель» другого оттенка на той же грани
 * читается как пятно краски. Выступ в полсотни метров — читается как
 * надстройка.
 */
function boxMesh(o, ax, ay, az, c, cTop = c, glow = 0) {
  const p = (sx, sy, sz) => v3(
    o.x + ax.x * sx + ay.x * sy + az.x * sz,
    o.y + ax.y * sx + ay.y * sy + az.y * sz,
    o.z + ax.z * sx + ay.z * sy + az.z * sz);
  const v = [
    p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1),
    p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1),
  ];
  return orientOutward(makeMesh(v, [
    { v: [0, 1, 2, 3], c, emissive: glow }, { v: [4, 5, 6, 7], c: cTop, emissive: glow },
    { v: [0, 1, 5, 4], c, emissive: glow }, { v: [3, 2, 6, 7], c, emissive: glow },
    { v: [0, 3, 7, 4], c, emissive: glow }, { v: [1, 2, 6, 5], c, emissive: glow },
  ]), o);
}

/** Надстройка на грани: стоит на поверхности и выступает наружу на h. */
function block(o, n, u, w, hu, hw, h, cTop, cSide) {
  const c = v3(o.x + n.x * h / 2, o.y + n.y * h / 2, o.z + n.z * h / 2);
  return boxMesh(c, mul(u, hu), mul(w, hw), mul(n, h / 2), cSide, cTop);
}

/**
 * Радиаторная панель: пластина РЕБРОМ к обшивке.
 *
 * Ребром — потому что тепло девать больше некуда, кроме как излучать в
 * обе стороны, и на настоящих станциях это самая заметная деталь после
 * батарей. Плашкой на обшивке она бы не читалась вовсе.
 */
function panelFin(o, n, u, w, len, h, c) {
  const mid = v3(o.x + n.x * h / 2, o.y + n.y * h / 2, o.z + n.z * h / 2);
  return boxMesh(mid, mul(u, len / 2), mul(w, 0.005), mul(n, h / 2), c, c);
}

/** Балка между двумя точками. */
function beam(a, b, r, c) {
  const d = v3(b.x - a.x, b.y - a.y, b.z - a.z);
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  const az = mul(d, 0.5);
  const t = Math.abs(d.y / l) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  let ux = v3(t.y * d.z - t.z * d.y, t.z * d.x - t.x * d.z, t.x * d.y - t.y * d.x);
  const ul = Math.hypot(ux.x, ux.y, ux.z) || 1;
  ux = mul(ux, r / ul);
  let wy = v3(
    d.y * ux.z - d.z * ux.y, d.z * ux.x - d.x * ux.z, d.x * ux.y - d.y * ux.x);
  const wl = Math.hypot(wy.x, wy.y, wy.z) || 1;
  wy = mul(wy, r / wl);
  return boxMesh(v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), ux, wy, az, c, c);
}

/** Маяк: светящийся кубик. Кубик, а не плашка, — виден с любой стороны. */
function beacon(o, r, c) {
  return boxMesh(o, v3(r, 0, 0), v3(0, r, 0), v3(0, 0, r), c, c, 1);
}

// --- Кориолис ---------------------------------------------------------------
//
// Кубооктаэдр: шесть квадратных граней по осям и восемь треугольных по
// углам, двенадцать вершин. Это и есть канонический «Кориолис», а не
// восьмигранный барабан, каким станция была раньше.
//
// Столкновение у такой формы описывается двумя неравенствами и потому
// ТОЧНОЕ, без запаса «на глаз»: квадраты — это max(|x|,|y|,|z|) <= s,
// треугольники — |x|+|y|+|z| <= 2s. Нарисованное и то, во что врезается
// корабль, совпадают по построению.

const COR_S = 0.7;                 // грань квадрата на этом расстоянии от центра
// Габарит — по САМОЙ ДАЛЬНЕЙ точке модели, а не по вершинам корпуса:
// тарелки и фермы торчат наружу, а по габариту считают зазор до края и
// точку выхода из прыжка. Возьми мы 0.99 (вершины кубооктаэдра) — выход
// приходился бы точно в антенну. Проверяется в tools/test.mjs.
const COR_BOUND = COR_S * Math.SQRT2 + 0.07;

const corInside = (x, y, z) => {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  return ax <= COR_S && ay <= COR_S && az <= COR_S && ax + ay + az <= 2 * COR_S;
};

/** Вершины кубооктаэдра: все перестановки (±s, ±s, 0). */
function cuboctaVerts(s) {
  const pts = [];
  const key = (p) => p.map((v) => v.toFixed(4)).join(',');
  const seen = new Map();
  for (const zero of [0, 1, 2]) {
    for (const a of [-s, s]) {
      for (const b of [-s, s]) {
        const p = [0, 0, 0];
        const rest = [0, 1, 2].filter((i) => i !== zero);
        p[rest[0]] = a; p[rest[1]] = b;
        const k = key(p);
        if (!seen.has(k)) { seen.set(k, pts.length); pts.push(p); }
      }
    }
  }
  return { pts, index: (p) => seen.get(key(p)) };
}

function buildCoriolis() {
  const s = COR_S;
  const { pts, index } = cuboctaVerts(s);
  const verts = pts.map((p) => v3(p[0], p[1], p[2]));
  const faces = [];

  // Шесть квадратов. Передний (+Z) пропускаем: вместо него рама с щелью.
  for (const axis of [0, 1, 2]) {
    for (const sign of [-1, 1]) {
      if (axis === 2 && sign === 1) continue;
      const rest = [0, 1, 2].filter((i) => i !== axis);
      const quad = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([u, w]) => {
        const p = [0, 0, 0];
        p[axis] = sign * s; p[rest[0]] = u * s; p[rest[1]] = w * s;
        return index(p);
      });
      // Тон через грань: на вращающейся станции это единственное, по
      // чему видно, что она вращается.
      faces.push({
        v: quad,
        c: axis === 2 ? HULL_DARK : (sign > 0 ? HULL : HULL_LIT),
      });
    }
  }

  // Восемь треугольников по углам. Оттенок через один: на вращающейся
  // станции это единственное, по чему видно само вращение.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        faces.push({
          v: [
            index([sx * s, sy * s, 0]),
            index([0, sy * s, sz * s]),
            index([sx * s, 0, sz * s]),
          ],
          c: (sx * sy * sz > 0) ? HULL_LIT : PANEL_ALT,
        });
      }
    }
  }

  const hull = orientOutward(makeMesh(verts, faces), v3());
  const parts = [hull];

  // --- передняя грань: ромб с половиной диагонали s ---------------------
  const outer = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const c = Math.cos(a), sn = Math.sin(a);
    const k = s / (Math.abs(c) + Math.abs(sn));   // ромб |x|+|y| = s
    outer.push({ x: c * k, y: sn * k });
  }
  parts.push(...portFace(outer, s, s * 0.8));

  // Прожекторы по углам ромба: створ подсвечен снаружи, иначе в тени
  // планеты порт не найти вовсе.
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const c = Math.cos(a), sn = Math.sin(a);
    const at = v3(c * s * 0.5, sn * s * 0.5, s);
    parts.push(block(at, v3(0, 0, 1), v3(c, sn, 0), v3(-sn, c, 0),
      0.05, 0.05, 0.09, PANEL, HULL_DARK));
    parts.push(patch(v3(c * s * 0.5, sn * s * 0.5, s + 0.095),
      v3(0.04, 0, 0), v3(0, 0.04, 0), [255, 244, 210], { glow: 0.9 }));
  }

  // --- боковые квадраты: надстройки, окна, радиаторы ---------------------
  for (const axis of [0, 1]) {
    for (const sign of [-1, 1]) {
      const n = v3(axis === 0 ? sign : 0, axis === 1 ? sign : 0, 0);
      const u = axis === 0 ? v3(0, 1, 0) : v3(1, 0, 0);   // поперёк грани
      const w = v3(0, 0, 1);                              // вдоль оси станции

      // Надстройка: настоящая коробка, а не накладка. Плоское затенение
      // не показывает панельных линий на одной плоскости — нужен объём.
      parts.push(block(mul(n, s), n, u, w, 0.30, 0.15, 0.09, PANEL, HULL_DARK));
      parts.push(block(add(mul(n, s), mul(w, -0.36)), n, u, w,
        0.15, 0.10, 0.16, HULL_LIT, HULL_DARK));
      // Ещё пара мелких коробок и тарелка: пустая грань в полтора
      // километра выдаёт модель сильнее всего.
      parts.push(block(add(mul(n, s), mul(u, -0.3)), n, u, w, 0.1, 0.08, 0.06,
        HULL_LIT, HULL_DARK));
      parts.push(part('dish', {
        at: add(mul(n, s), add(mul(u, 0.26), mul(w, -0.2))), size: 0.13,
        up: n, fwd: w, dim: 0.85,
      }));
      parts.push(part('machine', {
        at: add(mul(n, s), add(mul(u, -0.16), mul(w, 0.3))), size: 0.11,
        up: n, fwd: w, dim: 0.85,
      }));

      // Жилые ряды: окна в два этажа по обе стороны надстройки.
      for (const r of [-1, 1]) {
        parts.push(...windows(
          add(add(mul(n, s + 0.004), mul(u, -0.42)), mul(w, r * 0.26)),
          add(add(mul(n, s + 0.004), mul(u, 0.42)), mul(w, r * 0.26)),
          11, mul(u, 0.016), mul(w, 0.010)));
      }
      // Тёплая накладка ближе к порту — по ней видно, где перёд.
      //
      // Ширина считается от края грани: квадратные грани кубооктаэдра —
      // РОМБЫ (вершины на серединах рёбер куба), и накладка постоянной
      // ширины у края торчит в пустоту отогнутым лоскутом. Правило
      // простое: |u| + |w| <= s.
      parts.push(patch(add(mul(n, s + 0.004), mul(w, 0.54)),
        mul(u, (s - 0.54) * 0.8), mul(w, 0.026), TRIM));

      // Радиаторы: три панели ребром к обшивке. Тепло станции девать
      // некуда, кроме как излучать, и на настоящих станциях это самая
      // заметная деталь после солнечных батарей.
      for (let i = -1; i <= 1; i++) {
        const along = 0.06 + i * 0.16;
        const edge = (s - Math.abs(along)) * 0.62;     // не вылезая за ромб
        const o = add(add(mul(n, s), mul(w, along)), mul(u, edge));
        parts.push(panelFin(o, n, u, w, (s - Math.abs(along)) * 0.5, 0.055, RADIATOR));
      }
    }
  }

  // --- верх и низ: тарелки, баки, фермы ---------------------------------
  const topKit = [
    ['dish', 0.17, 0.0, 0.18], ['tank', 0.13, -0.34, -0.2],
    ['machine', 0.12, 0.3, -0.25], ['tanks', 0.13, -0.26, 0.3],
  ];
  for (const sign of [-1, 1]) {
    const n = v3(0, sign, 0);
    parts.push(block(mul(n, s), n, v3(1, 0, 0), v3(0, 0, 1), 0.26, 0.2, 0.05, PANEL, HULL));
    for (const [key, size, ox, oz] of topKit) {
      parts.push(part(key, {
        at: v3(ox, sign * (s + 0.05), oz), size,
        up: n, fwd: v3(0, 0, 1), dim: 0.92,
      }));
    }
    for (let i = -1; i <= 1; i += 2) {
      parts.push(panelFin(v3(i * 0.3, sign * s, -0.28), n, v3(0, 0, 1), v3(1, 0, 0),
        0.16, 0.05, RADIATOR));
    }
  }

  // --- угловые грани: фермы по рёбрам и мелочь в середине ---------------
  const kit = [
    ['generator', 0.15], ['tank', 0.13], ['truss', 0.15], ['dish', 0.15],
    ['tanks', 0.13], ['machine', 0.13], ['trussDiag', 0.15], ['turret', 0.10],
  ];
  let ci = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const n = v3(sx / Math.sqrt(3), sy / Math.sqrt(3), sz / Math.sqrt(3));
        const at = v3(sx * s * 2 / 3, sy * s * 2 / 3, sz * s * 2 / 3);
        const [key, size] = kit[ci++ % kit.length];
        parts.push(part(key, { at, size, up: n, fwd: v3(0, 0, sz), dim: 0.92 }));

        // Обвязка по рёбрам треугольника: тонкие балки вдоль сторон.
        const tri = [
          v3(sx * s, sy * s, 0), v3(0, sy * s, sz * s), v3(sx * s, 0, sz * s),
        ];
        for (let e = 0; e < 3; e++) {
          const a = tri[e], b = tri[(e + 1) % 3];
          parts.push(beam(
            v3(a.x * 0.97 + n.x * 0.01, a.y * 0.97 + n.y * 0.01, a.z * 0.97 + n.z * 0.01),
            v3(b.x * 0.97 + n.x * 0.01, b.y * 0.97 + n.y * 0.01, b.z * 0.97 + n.z * 0.01),
            0.018, FRAME));
        }
      }
    }
  }

  // --- маяки на двенадцати вершинах -------------------------------------
  // По ним станция видна издалека и по ним же читается вращение.
  for (const p of pts) {
    const n = v3(p[0], p[1], p[2]);
    const l = Math.hypot(n.x, n.y, n.z) || 1;
    const o = v3(n.x / l * (l + 0.012), n.y / l * (l + 0.012), n.z / l * (l + 0.012));
    const c = p[2] > 0 ? LIGHT_G : (p[2] < 0 ? LIGHT_R : [255, 230, 160]);
    parts.push(beacon(o, 0.022, c));
  }

  const mesh = mergeMeshes(parts);
  mesh.bound = COR_BOUND;
  mesh.kind = 'coriolis';
  return mesh;
}

// --- Орбис ------------------------------------------------------------------
//
// Ступица с портом, обитаемое кольцо вокруг неё и мачта назад с
// реактором на конце. Кольцо вращается вместе со станцией — в нём и
// живут; порт остаётся на оси, поэтому заход тот же самый.

const ORB = {
  rh: 0.34,      // радиус ступицы
  dh: 0.30,      // полудлина ступицы (плоскость створа)
  R: 1.0,        // радиус кольца — 2 км поперёк
  tube: 0.10,    // полутолщина кольца
  zRing: -0.02,  // кольцо чуть позади створа
  mast: 1.25,    // докуда уходит мачта назад
  mastR: 0.07,
};
// Сюда же, как и у «Кориолиса», входит всё торчащее: конец мачты с
// реактором уходит дальше кольца.
const ORB_BOUND = Math.max(ORB.R + ORB.tube, ORB.mast + 0.22);

const orbInside = (x, y, z) => {
  const rho = Math.hypot(x, y);
  if (rho <= ORB.rh && Math.abs(z) <= ORB.dh) return true;            // ступица
  if (Math.abs(z - ORB.zRing) <= ORB.tube
    && Math.abs(rho - ORB.R) <= ORB.tube) return true;                // кольцо
  if (rho <= ORB.mastR && z <= -ORB.dh && z >= -ORB.mast) return true; // мачта
  // Спицы: четыре коробки от ступицы к кольцу по осям X и Y.
  if (Math.abs(z - ORB.zRing) <= 0.05 && rho >= ORB.rh && rho <= ORB.R
    && (Math.abs(x) <= 0.05 || Math.abs(y) <= 0.05)) return true;
  return false;
};

/** Кольцо из N коробчатых сегментов. */
function ringMesh(R, tube, z, n, cOut, cIn) {
  const verts = [];
  const faces = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    verts.push(v3(c * (R - tube), s * (R - tube), z - tube));
    verts.push(v3(c * (R + tube), s * (R + tube), z - tube));
    verts.push(v3(c * (R + tube), s * (R + tube), z + tube));
    verts.push(v3(c * (R - tube), s * (R - tube), z + tube));
  }
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = ((i + 1) % n) * 4;
    const tint = i % 2 ? cOut : cIn;
    faces.push({ v: [a + 1, b + 1, b + 2, a + 2], c: tint });          // наружу
    faces.push({ v: [a + 0, a + 3, b + 3, b + 0], c: HULL_DARK });     // внутрь
    faces.push({ v: [a + 2, b + 2, b + 3, a + 3], c: PANEL });         // к порту
    faces.push({ v: [a + 0, b + 0, b + 1, a + 1], c: PANEL_ALT });     // назад
  }
  return orientOutward(makeMesh(verts, faces), v3(0, 0, z));
}

function buildOrbis() {
  const parts = [];
  const { rh, dh, R, tube, zRing, mast, mastR } = ORB;

  // --- ступица ----------------------------------------------------------
  const n = 16;
  const hv = [];
  for (const zz of [dh, -dh]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      hv.push(v3(Math.cos(a) * rh, Math.sin(a) * rh, zz));
    }
  }
  const hf = [];
  const back = [];
  for (let i = 0; i < n; i++) back.push(n + i);
  hf.push({ v: back, c: HULL_DARK });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    hf.push({ v: [i, j, n + j, n + i], c: i % 2 ? HULL : HULL_LIT });
  }
  parts.push(orientOutward(makeMesh(hv, hf), v3()));

  const outer = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    outer.push({ x: Math.cos(a) * rh, y: Math.sin(a) * rh });
  }
  parts.push(...portFace(outer, dh, dh * 1.2));

  // Прожекторы по углам створа.
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const c = Math.cos(a), sn = Math.sin(a);
    const at = v3(c * rh * 0.82, sn * rh * 0.82, dh);
    parts.push(block(at, v3(0, 0, 1), v3(c, sn, 0), v3(-sn, c, 0),
      0.04, 0.04, 0.07, PANEL, HULL_DARK));
    parts.push(patch(v3(at.x, at.y, dh + 0.075), v3(0.03, 0, 0), v3(0, 0.03, 0),
      [255, 244, 210], { glow: 0.9 }));
  }

  // Пояс надстроек по ступице: иначе цилиндр читается как труба.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 16;
    const c = Math.cos(a), s = Math.sin(a);
    parts.push(block(v3(c * rh, s * rh, -0.1), v3(c, s, 0), v3(-s, c, 0), v3(0, 0, 1),
      0.05, 0.12, 0.035, i % 2 ? PANEL : HULL_LIT, HULL));
  }
  // Ряд окон по ступице: в ней тоже живут, и ночью это видно.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const c = Math.cos(a), sn = Math.sin(a);
    parts.push(patch(v3(c * (rh + 0.004), sn * (rh + 0.004), 0.16),
      v3(-sn * 0.03, c * 0.03, 0), v3(0, 0, 0.012), WINDOW, { glow: 0.8 }));
  }

  // --- кольцо -----------------------------------------------------------
  parts.push(ringMesh(R, tube, zRing, 40, HULL, HULL_LIT));
  for (let i = 0; i < 40; i++) {
    const a = ((i + 0.5) / 40) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const along = v3(-s, c, 0);
    const nOut = v3(c, s, 0);
    // Окна по наружной стороне: в кольце и живут, центробежная тяжесть
    // прижимает к наружной стенке — окна смотрят «вниз», то есть наружу.
    parts.push(patch(v3(c * (R + tube + 0.004), s * (R + tube + 0.004), zRing),
      mul(along, 0.055), v3(0, 0, 0.03), WINDOW, { glow: 0.8 }));
    // Каждый четвёртый сегмент — надстройка с радиатором: кольцо
    // перестаёт быть гладким бубликом.
    if (i % 4 === 0) {
      parts.push(block(v3(c * (R + tube), s * (R + tube), zRing), nOut, along, v3(0, 0, 1),
        0.07, 0.06, 0.045, PANEL, HULL));
      parts.push(panelFin(v3(c * (R - tube), s * (R - tube), zRing),
        mul(nOut, -1), along, v3(0, 0, 1), 0.1, 0.08, RADIATOR));
    }
    if (i % 8 === 4) {
      parts.push(beacon(v3(c * (R + tube + 0.02), s * (R + tube + 0.02), zRing),
        0.016, i % 16 === 4 ? LIGHT_G : LIGHT_R));
    }
  }

  // --- спицы ------------------------------------------------------------
  // Четыре рукава от ступицы к кольцу: по ним ходят лифты, и они же
  // держат кольцо. Ферма по краям, короб посередине.
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const c = Math.cos(a), s = Math.sin(a);
    const u = v3(-s, c, 0);
    const from = v3(c * rh, s * rh, zRing);
    const to = v3(c * R, s * R, zRing);
    const mid = v3((from.x + to.x) / 2, (from.y + to.y) / 2, zRing);
    const len = (R - rh) / 2;
    parts.push(boxMesh(mid, v3(c * len, s * len, 0), mul(u, 0.042), v3(0, 0, 0.042),
      PANEL_ALT, PANEL));
    for (const sgn of [-1, 1]) {
      parts.push(beam(
        v3(from.x + u.x * 0.06 * sgn, from.y + u.y * 0.06 * sgn, zRing + 0.05),
        v3(to.x + u.x * 0.06 * sgn, to.y + u.y * 0.06 * sgn, zRing + 0.05),
        0.012, FRAME));
    }
  }

  // --- мачта, реактор, батареи ------------------------------------------
  const segs = 6;
  const step = (mast - dh) / segs;
  for (let i = 0; i < segs; i++) {
    const z = -dh - (i + 0.5) * step;
    parts.push(part('mast', {
      at: v3(0, 0, z), size: step * 1.5, up: v3(0, 0, -1), fwd: v3(1, 0, 0), dim: 0.9,
    }));
    // Продольные балки: мачта читается фермой, а не палкой.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const c = Math.cos(a) * mastR, s = Math.sin(a) * mastR;
      parts.push(beam(v3(c, s, z + step / 2), v3(c, s, z - step / 2), 0.009, FRAME));
    }
  }
  parts.push(part('generator', {
    at: v3(0, 0, -mast + 0.02), size: 0.2, up: v3(0, 0, -1), fwd: v3(1, 0, 0), dim: 0.9,
  }));
  for (const sign of [-1, 1]) {
    parts.push(part('tank', {
      at: v3(sign * 0.1, 0, -mast + 0.12), size: 0.12,
      up: v3(sign, 0, 0), fwd: v3(0, 0, 1), dim: 0.88,
    }));
  }

  // Солнечные батареи: две пары крыльев на выносах. Они большие
  // намеренно — это второй после кольца силуэт, по которому «Орбис»
  // узнаётся издалека.
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const c = Math.cos(a), s = Math.sin(a);
    const z = -mast * 0.55 - (i % 2) * 0.18;
    const armFrom = v3(c * mastR, s * mastR, z);
    const armTo = v3(c * 0.3, s * 0.3, z);
    parts.push(beam(armFrom, armTo, 0.012, FRAME));
    const at = v3(c * 0.55, s * 0.55, z);
    parts.push(boxMesh(at, v3(c * 0.25, s * 0.25, 0), v3(-s * 0.006, c * 0.006, 0),
      v3(0, 0, 0.17), SOLAR, SOLAR));
    // Рёбра по краям панели — по ним видно, что это плоскость, а не
    // тёмный провал в кадре.
    for (const sz of [-1, 1]) {
      parts.push(beam(
        v3(at.x - c * 0.25, at.y - s * 0.25, at.z + sz * 0.17),
        v3(at.x + c * 0.25, at.y + s * 0.25, at.z + sz * 0.17), 0.008, SOLAR_EDGE));
    }
  }

  // --- оснащение --------------------------------------------------------
  for (let i = 0; i < 2; i++) {
    const a = Math.PI / 2 + i * Math.PI;
    const c = Math.cos(a), s = Math.sin(a);
    parts.push(part('dish', {
      at: v3(c * rh, s * rh, 0.12), size: 0.16, up: v3(c, s, 0), fwd: v3(0, 0, 1), dim: 0.9,
    }));
  }
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI;
    const c = Math.cos(a), s = Math.sin(a);
    parts.push(part('turret', {
      at: v3(c * rh, s * rh, -0.22), size: 0.1, up: v3(c, s, 0), fwd: v3(0, 0, 1), dim: 0.88,
    }));
  }

  const mesh = mergeMeshes(parts);
  mesh.bound = ORB_BOUND;
  mesh.kind = 'orbis';
  return mesh;
}

// --- наружу -----------------------------------------------------------------

/**
 * Числа станции: то, что нужно игре, а не рисованию.
 *
 * `D` — плоскость створа: от неё считается заход и до неё меряется
 * остаток пути. `inside` — столкновение с корпусом. `bound` — габарит,
 * он же радиус станции как цели.
 */
const SHAPES = {
  coriolis: { kind: 'coriolis', D: COR_S, bound: COR_BOUND, slot: SLOT, inside: corInside },
  orbis: { kind: 'orbis', D: ORB.dh, bound: ORB_BOUND, slot: SLOT, inside: orbInside },
};

export function stationShape(kind) {
  return SHAPES[kind] || SHAPES.coriolis;
}

const BUILD = { coriolis: buildCoriolis, orbis: buildOrbis };
const cache = new Map();

/** Меш станции. Строится один раз на тип: типов два, а станций много. */
export function stationMesh(kind) {
  const k = BUILD[kind] ? kind : 'coriolis';
  if (!cache.has(k)) cache.set(k, BUILD[k]());
  return cache.get(k);
}

export { buildCoriolis, buildOrbis };
