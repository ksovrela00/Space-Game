// Деталь человеческого размера на корпусе.
//
// ЗАЧЕМ. Корпус — модель пака Quaternius: восемьсот граней, и 61%
// площади приходится на сотню граней крупнее пяти метров, каждая залита
// одним цветом. Ровная плоскость в семь метров выглядит ровно так же,
// как в семь сантиметров: на ней нет ничего, размер чего знает глаз. У
// настоящего самолёта масштаб читается по окнам, люкам, швам и огням —
// здесь всё это и добавляется. И ещё одно: посреди корпуса стоит фонарь
// одноместного истребителя, девять метров стекла одним куском. Глаз
// читает его как «кабину одного пилота» и сам уменьшает весь корабль —
// поэтому фонарь становится остеклением мостика, с переплётом в рост
// человека.
//
// Что здесь, а что в шейдере (js/gl/hull.js):
//
//   * здесь — РАЗМЕТКА: какая грань обшивка, какая стекло, где ряды
//     окон по бортам, где сопла подъёмных движков на днище и где огни.
//     Это свойство корпуса, и считается оно один раз при сборке;
//   * в шейдере — УЗОР: швы панелей, переплёт, решётка сопел. Узор мельче
//     граней, и делать его геометрией значило бы умножить модель в
//     десятки раз.
//
// Окна и сопла — отдельные тонкие накладки поверх граней, а не
// перекраска: у них свой контур, и он не обязан совпадать с гранью.
// Лежат они ОТДЕЛЬНОЙ сеткой (mesh.decal), а не в самом корпусе: всё,
// что меряет корпус, — габариты, просвет до грунта, тень, ударная
// волна, — меряет его голым. Сопло на днище выступает на три сантиметра,
// и в общих вершинах оно сдвинуло бы «низ корпуса» — ровно это и
// поймала проверка просветов.

import { v3 } from '../core/vec3.js';

/** Материал грани — число в атрибуте aMat (см. js/gl/hull.js). */
export const MAT = {
  plain: 0,       // без узора (всё, что не корабль)
  plate: 1,       // обшивка: швы панелей
  glass: 2,       // остекление мостика
  vent: 3,        // сопло подъёмного движка: решётка и жар
  window: 4,      // иллюминатор
  // Смотровое стекло без переплёта: окна мостика «Прометея», по 6.7 м.
  // Сетка «окон в рост человека» хороша на фонаре снаружи, а из кресла в
  // трёх метрах от стекла она — решётка клетки. Изнутри — сквозное.
  clear: 5,
};

/**
 * Рубка — место пилота под фонарём. Вид от первого лица смотрит ОТСЮДА,
 * а не из точки перед носом: иначе своего корабля из кабины не видно
 * вовсе. Числа сняты с самого корпуса (сечения фонаря по z):
 *
 *   * фонарь — клин от y = −1.72 м по низу боковин до 2.2–3.0 м по
 *     верху, лоб у него крутой — от −1.2 м на z = −4.5 до 2.1 на −6.5;
 *   * глаз — в метре под стеклом, в полутора метрах за лобовым стеклом
 *     на своей высоте. Отсюда виден нос: кончик (z = +32.5, y = −4.4) —
 *     на 8° ниже оси, а до козырька доски (−17°) нос лежит почти
 *     целиком. Высота глаза — не ровно метр: на этой высоте идёт
 *     горизонтальная стойка боковых стёкол (их сетка — метр), и она
 *     легла бы в кадре ровно на линию горизонта;
 *   * палуба — на 1.1 м ниже глаза (рост сидящего человека);
 *   * лобовое стекло перед пилотом — ЦЕЛЬНОЕ, без переплёта, и задано
 *     оно УГЛАМИ ОТ ГЛАЗА, как у настоящего фонаря (его строят от точки
 *     глаза пилота): ±45° вбок и до +29° вверх. Переплёт «окнами в рост
 *     человека» (1.3 × 1.0 м, js/gl/hull.js) хорош снаружи, с шестидесяти
 *     метров, а изнутри стойка в 14 см с полутора метров — это пять
 *     градусов, и одна из них шла ровно по оси, поперёк прицела. Сетка
 *     остаётся — за рамой лобового стекла.
 */
export const BRIDGE = {
  eye: { x: 0, y: 1.3, z: -7.3 },   // м, оси модели
  deck: 0.2,                        // м — высота палубы
  // Лобовое стекло: углы от глаза. Верх рамы — у верхней кромки кадра
  // (кадр ±34°), стойки — у боковых (±50°): кадр обрамлён, прицел чист.
  screenAz: 45,                     // градусов в каждую сторону
  screenEl: 29,                     // градусов вверх
  screenFrame: 2.4,                 // градусов — ширина рамы
};

export const DETAIL = {
  // Окна: палуба в три метра, окно метр на семьдесят сантиметров,
  // через два с половиной метра. Размеры — пассажирского судна: именно
  // их глаз и знает.
  deck: 3.0,
  winW: 1.0,
  winH: 0.7,
  winStep: 2.4,
  winSill: 1.1,          // от пола палубы до низа окна
  winMargin: 0.7,        // от края грани
  winLit: 0.72,          // доля освещённых окон
  // Свет в окне — постоянный, а не отражённый: днём окно выходит темнее
  // обшивки (внутри светлее не бывает, чем снаружи под солнцем), ночью —
  // светится. Так и в жизни: освещённые окна видно в сумерках, а не в
  // полдень.
  winGlow: [0.36, 0.28, 0.17],
  winDark: [0.06, 0.075, 0.095],
  // Накладка отодвинута от грани, чтобы не спорить с ней в буфере
  // глубины: логарифмическая глубина на сотне метров различает доли
  // миллиметра, три сантиметра — с большим запасом.
  lift: 0.03,
  // Сопла подъёмных движков: на самых крупных гранях днища, по паре с
  // каждого борта. Размер — доля грани, но не больше шести метров.
  ventFaces: 4,
  ventMaxM: 6,
  ventShare: 0.62,
  // Грань, из которой наружу на этом расстоянии попадаешь в другую
  // грань, спрятана (под крылом, между блоками): окна на ней никто не
  // увидит, а сопла дули бы в собственный корпус.
  hideRay: 4,
};

// --- геометрия граней ----------------------------------------------------------

const M = 1000;   // метров в километре: модель в километрах, разметка в метрах

function faceInfo(mesh, f) {
  const P = f.v.map((i) => mesh.verts[i]);
  let cx = 0, cy = 0, cz = 0;
  for (const p of P) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= P.length; cy /= P.length; cz /= P.length;
  let ax = 0, ay = 0, az = 0;
  for (let k = 1; k + 1 < P.length; k++) {
    const ux = P[k].x - P[0].x, uy = P[k].y - P[0].y, uz = P[k].z - P[0].z;
    const wx = P[k + 1].x - P[0].x, wy = P[k + 1].y - P[0].y, wz = P[k + 1].z - P[0].z;
    ax += uy * wz - uz * wy; ay += uz * wx - ux * wz; az += ux * wy - uy * wx;
  }
  const area = Math.hypot(ax, ay, az) / 2 * M * M;       // м²
  return { P, c: v3(cx, cy, cz), area };
}

// Луч против треугольника (Мёллер — Трумбор): расстояние или Infinity.
function rayTri(o, d, a, b, c) {
  const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
  const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
  const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-18) return Infinity;
  const inv = 1 / det;
  const tx = o.x - a.x, ty = o.y - a.y, tz = o.z - a.z;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return Infinity;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const w = (d.x * qx + d.y * qy + d.z * qz) * inv;
  if (w < 0 || u + w > 1) return Infinity;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0 ? t : Infinity;
}

/** Первое попадание луча в корпус, км (кроме грани skip). */
function hitHull(mesh, o, d, skip) {
  let best = Infinity;
  for (const f of mesh.faces) {
    if (f === skip) continue;
    const v = f.v;
    for (let k = 1; k + 1 < v.length; k++) {
      const t = rayTri(o, d, mesh.verts[v[0]], mesh.verts[v[k]], mesh.verts[v[k + 1]]);
      if (t < best) best = t;
    }
  }
  return best;
}

/**
 * Наружу ли смотрит нормаль грани и не спрятана ли грань. Пак не обещает
 * порядка обхода, поэтому проверяются обе стороны: наружная — та, из
 * которой луч уходит в пустоту.
 *
 * @returns знак наружной стороны (+1/−1) или 0 — грань закрыта с обеих
 */
function outward(mesh, f, at) {
  const lim = DETAIL.hideRay / M;
  const n = f.n;
  const o = v3(at.x + n.x * 1e-6, at.y + n.y * 1e-6, at.z + n.z * 1e-6);
  if (hitHull(mesh, o, n, f) > lim) return 1;
  const m = v3(-n.x, -n.y, -n.z);
  const o2 = v3(at.x - n.x * 1e-6, at.y - n.y * 1e-6, at.z - n.z * 1e-6);
  if (hitHull(mesh, o2, m, f) > lim) return -1;
  return 0;
}

// Точка внутри многоугольника на плоскости (u, v) и расстояние до края.
function inside2(poly, u, v) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > v) !== (b[1] > v) && u < (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function edgeDist2(poly, u, v) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const l2 = ex * ex + ey * ey || 1e-12;
    const t = Math.max(0, Math.min(1, ((u - a[0]) * ex + (v - a[1]) * ey) / l2));
    best = Math.min(best, Math.hypot(u - a[0] - ex * t, v - a[1] - ey * t));
  }
  return best;
}
const rectFits = (poly, u0, v0, u1, v1, margin) =>
  [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].every(([u, v]) =>
    inside2(poly, u, v) && edgeDist2(poly, u, v) >= margin);

// Детерминированный разброс: одинаковый корпус — одинаковые окна.
const hash = (a, b) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Прямоугольник-накладка: четыре угла в плоскости грани, чуть снаружи.
 *
 * Легла ли она на обшивку, ПРОВЕРЯЕТСЯ, а не предполагается: луч от её
 * середины внутрь обязан упереться в корпус ровно через зазор. У пака
 * бывают четырёхугольники, чьи вершины не лежат в одной плоскости, и
 * окно, поставленное по плоскости такой грани, висело бы рядом с ней —
 * одно такое и нашлось, на скосе у носа.
 *
 * @returns легла ли (не легла — не добавлена)
 */
function addQuad(mesh, decal, corners, n, sign, c, emissive, mat) {
  const k = DETAIL.lift / M * sign;
  const pts = corners.map((p) => v3(p.x + n.x * k, p.y + n.y * k, p.z + n.z * k));
  const mid = v3((pts[0].x + pts[2].x) / 2, (pts[0].y + pts[2].y) / 2, (pts[0].z + pts[2].z) / 2);
  const hit = hitHull(mesh, mid, v3(-n.x * sign, -n.y * sign, -n.z * sign), null) * M;
  if (!(Math.abs(hit - DETAIL.lift) < 0.01)) return false;
  const base = decal.verts.length;
  for (const q of pts) decal.verts.push(q);
  const idx = [base, base + 1, base + 2, base + 3];
  decal.faces.push({
    v: idx, c, n: v3(n.x * sign, n.y * sign, n.z * sign),
    twoSided: false, emissive, mat,
  });
  return true;
}

// --- разметка ---------------------------------------------------------------------

/**
 * Фонарь кабины — тёмные грани на спине корпуса над серединой. Ищутся
 * ПО САМОЙ МОДЕЛИ (цвет и место), а не списком номеров: сменится корпус
 * — сменится и найденное.
 */
function isCanopy(info, f) {
  const lum = 0.3 * f.c[0] + 0.59 * f.c[1] + 0.11 * f.c[2];
  const c = info.c;
  // Все вершины — выше пояса корпуса: тёмная стенка перед кабиной
  // (одиннадцать метров от днища до крыши) тоже попадает сюда по цвету и
  // месту, но стеклом не бывает — она уходит к самому днищу.
  const low = Math.min(...info.P.map((q) => q.y)) * M;
  return lum < 75 && Math.abs(c.x) * M < 5.5 && c.z * M > -17 && c.z * M < -4.5 && c.y * M > -3 && low > -3;
}

/**
 * Разметить корпус: материалы, окна, сопла, огни. Меняет mesh на месте и
 * его же возвращает.
 */
export function detailHull(mesh) {
  // Огни — по крайним точкам САМОГО корпуса, до накладок.
  mesh.navLights = navLights(mesh);
  const infos = new Map();
  for (const f of mesh.faces) infos.set(f, faceInfo(mesh, f));
  for (const f of mesh.faces) f.mat = isCanopy(infos.get(f), f) ? MAT.glass : MAT.plate;

  const base = mesh.faces;
  const decal = { verts: [], faces: [] };
  mesh.decal = decal;
  let windows = 0, lit = 0;

  // Окна — на бортах: грани, смотрящие вбок, достаточно крупные, чтобы в
  // них встала хотя бы одна палуба.
  for (const f of base) {
    if (f.mat !== MAT.plate || Math.abs(f.n.x) < 0.95) continue;
    const info = infos.get(f);
    if (info.area < 12) continue;
    const sign = outward(mesh, f, info.c);
    if (!sign) continue;
    // Плоскость борта: u — вдоль корабля (z), v — вверх (y), в метрах.
    const poly = info.P.map((p) => [p.z * M, p.y * M]);
    const us = poly.map((q) => q[0]), vs = poly.map((q) => q[1]);
    const u0 = Math.min(...us), u1 = Math.max(...us);
    const v0 = Math.min(...vs), v1 = Math.max(...vs);
    // x угла — по плоскости самой грани: борт бывает наклонён на
    // десяток градусов, и накладка с общим x висела бы над ним.
    const n = f.n, c0 = info.c;
    const xAt = (y, z) => c0.x - (n.y * (y - c0.y) + n.z * (z - c0.z)) / n.x;
    const x = c0.x;
    for (let deck = 0; ; deck++) {
      const floor = v0 + DETAIL.winMargin * 0.5 + deck * DETAIL.deck;
      const wv0 = floor + DETAIL.winSill - DETAIL.winH * 0.5;
      const wv1 = wv0 + DETAIL.winH;
      if (wv1 > v1 - DETAIL.winMargin * 0.5) break;
      // Окна расставлены от середины грани: ряд выходит симметричным и
      // не упирается в один из краёв.
      const mid = (u0 + u1) / 2;
      const half = Math.floor((u1 - u0) / 2 / DETAIL.winStep);
      for (let k = -half; k <= half; k++) {
        const uc = mid + k * DETAIL.winStep;
        const wu0 = uc - DETAIL.winW / 2, wu1 = uc + DETAIL.winW / 2;
        if (!rectFits(poly, wu0, wv0, wu1, wv1, DETAIL.winMargin)) continue;
        const on = hash(uc + x * 7, wv0) < DETAIL.winLit;
        const col = (on ? DETAIL.winGlow : DETAIL.winDark).map((c) => Math.round(c * 255));
        const corners = [[wu0, wv0], [wu1, wv0], [wu1, wv1], [wu0, wv1]]
          .map(([u, vv]) => v3(xAt(vv / M, u / M), vv / M, u / M));
        if (!addQuad(mesh, decal, corners, f.n, sign, col, on ? 1 : 0, MAT.window)) continue;
        windows++;
        if (on) lit++;
      }
    }
  }

  // Сопла подъёмных — на самых крупных гранях днища, из которых струя
  // уходит в пустоту, а не в собственное крыло.
  // Порядок обхода у пака не гарантирован, поэтому нормаль берётся по
  // модулю, а «низ» решает луч вниз (faceDown).
  const belly = base
    .filter((f) => f.mat === MAT.plate && Math.abs(f.n.y) > 0.95)
    .map((f) => ({ f, info: infos.get(f) }))
    .filter(({ f, info }) => info.area > 20 && faceDown(mesh, f, info))
    .sort((a, b) => b.info.area - a.info.area)
    .slice(0, DETAIL.ventFaces);
  const vents = [];
  for (const { f, info } of belly) {
    const poly = info.P.map((p) => [p.x * M, p.z * M]);
    const us = poly.map((q) => q[0]), vs = poly.map((q) => q[1]);
    const cu = (Math.min(...us) + Math.max(...us)) / 2, cv = (Math.min(...vs) + Math.max(...vs)) / 2;
    let hu = Math.min(DETAIL.ventMaxM, (Math.max(...us) - Math.min(...us)) * DETAIL.ventShare) / 2;
    let hv = Math.min(DETAIL.ventMaxM, (Math.max(...vs) - Math.min(...vs)) * DETAIL.ventShare) / 2;
    // Не шире грани: ужимаем, пока углы не лягут внутрь.
    for (let i = 0; i < 12 && !rectFits(poly, cu - hu, cv - hv, cu + hu, cv + hv, 0.3); i++) {
      hu *= 0.85; hv *= 0.85;
    }
    if (hu < 0.6 || hv < 0.6) continue;
    const y = info.c.y;
    const n = f.n, c0 = info.c;
    const yAt = (x, z) => c0.y - (n.x * (x - c0.x) + n.z * (z - c0.z)) / n.y;
    const corners = [[cu - hu, cv - hv], [cu + hu, cv - hv], [cu + hu, cv + hv], [cu - hu, cv + hv]]
      .map(([u, vv]) => v3(u / M, yAt(u / M, vv / M), vv / M));
    const down = f.n.y < 0 ? 1 : -1;       // накладка — на наружную (нижнюю) сторону
    if (!addQuad(mesh, decal, corners, f.n, down, [40, 38, 36], 0, MAT.vent)) continue;
    vents.push({ x: cu / M, y, z: cv / M, w: hu * 2, l: hv * 2 });
  }

  mesh.detail = { windows, lit, vents, glass: mesh.faces.filter((f) => f.mat === MAT.glass).length };
  return mesh;
}

// Грань днища: снизу из неё луч уходит в пустоту.
function faceDown(mesh, f, info) {
  const d = v3(0, -1, 0);
  const o = v3(info.c.x, info.c.y - 1e-6, info.c.z);
  return hitHull(mesh, o, d, f) > DETAIL.hideRay / M;
}

/**
 * Огни — по правилам авиации (ICAO, Annex 2 и FAR 25.1385–1401), потому
 * что именно их глаз и знает: красный на левой консоли, зелёный на
 * правой, белый на корме — ходовые, горят постоянно; белые вспышки на
 * концах крыльев и красные маяки сверху и снизу — огни предупреждения
 * столкновений, мигают. Корабль с такими огнями читается как большая
 * машина, у которой есть борта и экипаж, а не как модель.
 *
 * Места ищутся по крайним вершинам корпуса, как сопла маневровых
 * (js/models/ships.js, rcsPorts). Правый борт у этого корпуса — +X
 * (там же, по маневровым).
 */
function navLights(mesh) {
  const verts = mesh.verts;
  const best = (score, filter = () => true) => {
    let b = null, s = -Infinity;
    for (const v of verts) {
      if (!filter(v)) continue;
      const k = score(v);
      if (k > s) { s = k; b = v; }
    }
    return b;
  };
  const out = [];
  const push = (p, kind, color, off) => {
    if (!p) return;
    out.push({ pos: v3(p.x + off.x / M, p.y + off.y / M, p.z + off.z / M), kind, color });
  };
  const port = best((v) => -v.x);
  const star = best((v) => v.x);
  const tail = best((v) => -v.z, (v) => Math.abs(v.x) < 0.003);
  const top = best((v) => v.y, (v) => Math.abs(v.x) < 0.004 && Math.abs(v.z) < 0.02);
  const bot = best((v) => -v.y, (v) => Math.abs(v.x) < 0.004 && Math.abs(v.z) < 0.02);
  push(port, 'nav', [1.0, 0.12, 0.08], { x: -0.3, y: 0, z: 0 });
  push(star, 'nav', [0.1, 1.0, 0.35], { x: 0.3, y: 0, z: 0 });
  push(tail, 'nav', [1.0, 0.96, 0.9], { x: 0, y: 0, z: -0.3 });
  push(port, 'strobe', [1.0, 1.0, 1.0], { x: -0.1, y: 0.15, z: -0.8 });
  push(star, 'strobe', [1.0, 1.0, 1.0], { x: 0.1, y: 0.15, z: -0.8 });
  push(top, 'beacon', [1.0, 0.1, 0.05], { x: 0, y: 0.35, z: 0 });
  push(bot, 'beacon', [1.0, 0.1, 0.05], { x: 0, y: -0.35, z: 0 });
  return out;
}

// --- как мигают огни ------------------------------------------------------------
//
// Вспышка на концах крыльев — двойная, раз в секунду с четвертью (у
// лайнеров 40–100 вспышек в минуту, FAR 25.1401); маяк — вращающийся:
// плавный накат раз в секунду. Ходовые горят ровно.
export const BLINK = {
  strobePeriod: 1.25,
  strobeOn: 0.06,
  strobeGap: 0.14,       // вторая вспышка пары
  beaconPeriod: 1.0,
};

/** Яркость огня в момент t, 0..1. */
export function lightLevel(kind, t) {
  if (kind === 'strobe') {
    const p = t % BLINK.strobePeriod;
    return p < BLINK.strobeOn || (p > BLINK.strobeGap && p < BLINK.strobeGap + BLINK.strobeOn) ? 1 : 0;
  }
  if (kind === 'beacon') {
    const p = (t % BLINK.beaconPeriod) / BLINK.beaconPeriod;
    // Вращающийся маяк: луч проходит мимо глаза — короткий накат и спад.
    const x = Math.max(0, Math.cos(p * Math.PI * 2));
    return x * x * x * x;
  }
  return 1;
}
