// Адресация плиток поверхности: квадродерево на кубе, натянутом на сферу.
//
// Зачем плитки, а не заплатки под кораблём. Заплатка центрируется на
// камере, поэтому при движении её приходится пересобирать — и новая
// геометрия появляется прямо на глазах. Плитка привязана к ТЕЛУ: её
// координаты не зависят от того, где корабль. Значит, плитка считается
// один раз, кладётся в кэш и дальше только рисуется. При подлёте
// подгружаются новые уровни, при отлёте старые вытесняются — ничего не
// пересчитывается заново.
//
// Шесть корневых плиток (грани куба) — это и есть «заранее
// сгенерированная поверхность планеты»: они строятся сразу и не
// вытесняются никогда.
//
// Параметр грани s идёт от -1 до 1, направление считается как
// normalize(F + U·tan(s_u·π/4) + V·tan(s_v·π/4)). Тангенс здесь не
// украшение: без него ячейки у краёв грани вдвое меньше, чем в центре,
// и детализация по поверхности выходит неровной.

import { CUBE_FACES } from './bake.js';

export const TILE_GRID = 48;        // ячеек по стороне плитки
export const TILE_TEX = 96;         // сторона запечённой текстуры (2 текселя на ячейку)
export const TILE_MAX_LEVEL = 16;
const QUARTER = Math.PI / 4;

/** Направление по грани и параметрам s ∈ [-1,1]. */
export function faceDir(face, su, sv, out = { x: 0, y: 0, z: 0 }) {
  const f = CUBE_FACES[face];
  const tu = Math.tan(su * QUARTER), tv = Math.tan(sv * QUARTER);
  const x = f.F[0] + f.U[0] * tu + f.V[0] * tv;
  const y = f.F[1] + f.U[1] * tu + f.V[1] * tv;
  const z = f.F[2] + f.U[2] * tu + f.V[2] * tv;
  const l = Math.hypot(x, y, z) || 1;
  out.x = x / l; out.y = y / l; out.z = z / l;
  return out;
}

/** Границы плитки в параметрах грани. */
export function tileBounds(level, tx, ty) {
  const n = 1 << level;
  const step = 2 / n;
  return { u0: -1 + tx * step, u1: -1 + (tx + 1) * step, v0: -1 + ty * step, v1: -1 + (ty + 1) * step };
}

export const tileKey = (face, level, tx, ty) => `${face}/${level}/${tx}/${ty}`;

/** Центр плитки (направление) и её угловой радиус. */
export function tileCenter(face, level, tx, ty, out = { x: 0, y: 0, z: 0 }) {
  const b = tileBounds(level, tx, ty);
  return faceDir(face, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2, out);
}

const _c1 = { x: 0, y: 0, z: 0 };
const _c2 = { x: 0, y: 0, z: 0 };

/**
 * Угловой радиус плитки: половина диагонали. Считается через углы
 * параметризации, поэтому не зависит от места на грани.
 */
export function tileRadius(level) {
  const half = QUARTER * (2 / (1 << level)) / 2;   // половина стороны в радианах
  // Диагональ сферического квадрата чуть меньше, чем half·sqrt(2)·2,
  // но для отсечения нужна оценка сверху.
  return half * 1.45;
}

/** Угловой размер ячейки сетки внутри плитки. */
export const tileCellAngle = (level) =>
  (Math.PI / 2) / (1 << level) / TILE_GRID;

/** Угловой размер текселя запечённой текстуры плитки. */
export const tileTexelAngle = (level) =>
  (Math.PI / 2) / (1 << level) / TILE_TEX;

/** Четыре потомка плитки. */
export function tileChildren(face, level, tx, ty, out = []) {
  out.length = 0;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      out.push({ face, level: level + 1, tx: tx * 2 + dx, ty: ty * 2 + dy });
    }
  }
  return out;
}

/**
 * Выбор плиток для отрисовки.
 *
 * Плитка дробится по двум условиям сразу:
 *
 *  - геометрическая ошибка (то, что сетка этого уровня не может
 *    показать) в пикселях больше допуска;
 *  - тексель её текстуры крупнее texelTol пикселей.
 *
 * Второе условие — не про резкость текстуры, а про СОСЕДЕЙ. Без него
 * уровень выбирается только по крупному рельефу, и рядом спокойно
 * оказываются плитки, отличающиеся на три уровня: у одной деталь
 * сглажена по текселю в километр, у другой — в семьдесят метров. У
 * шероховатой поверхности это не «резче/мягче», а РАЗНЫЙ наклон: замер
 * давал расхождение нормали до тридцати градусов, и на скользящем свете
 * стык читался прямой границей света и тени поперёк грунта. С этим
 * условием соседи отличаются не больше чем на два уровня.
 *
 * Дробление происходит ТОЛЬКО если все четыре потомка уже готовы: иначе
 * рисуется сама плитка. Поэтому в кадре никогда не бывает дырок, а
 * подгрузка выглядит как постепенное уточнение.
 *
 * @param ctx {radius, camPos, camDir(локальное направление на камеру),
 *             camAlt, focal, tol, texelTol, maxLevel, errorOf(level),
 *             texelOf(level), ready(t), want(t, need)}
 * @returns массив {face, level, tx, ty} — что рисовать
 */
export function selectTiles(ctx, out = []) {
  out.length = 0;
  const stack = [];
  for (let f = 0; f < 6; f++) stack.push({ face: f, level: 0, tx: 0, ty: 0 });

  // Угловой радиус горизонта с запасом на рельеф: за ним поверхность
  // не видна, и считать её незачем.
  const R = ctx.radius;
  const alt = Math.max(0.001, ctx.camAlt);
  const relief = ctx.relief || 0;
  const horizon = Math.acos(Math.max(-1, Math.min(1, R / (R + alt))))
    + Math.acos(Math.max(-1, Math.min(1, 1 / (1 + relief)))) + 0.02;

  let guard = 0;
  while (stack.length && guard++ < 20000) {
    const t = stack.pop();
    const c = tileCenter(t.face, t.level, t.tx, t.ty, _c1);
    const rad = tileRadius(t.level);

    // За горизонтом — пропускаем целиком.
    const ang = Math.acos(Math.max(-1, Math.min(1,
      c.x * ctx.camDir.x + c.y * ctx.camDir.y + c.z * ctx.camDir.z)));
    if (t.level > 0 && ang - rad > horizon) continue;

    // Расстояние от камеры до плитки (по её центру, с учётом радиуса).
    const dist = Math.max(1e-6, chordDist(c, ctx.camDir, R, alt) - rad * R);
    const k = R * ctx.focal / dist;
    // Насколько плитка не дотягивает: 1 — ровно по допуску, больше —
    // надо дробить. Обе меры в одной шкале, поэтому их можно сравнивать
    // и по ним же выстраивать очередь сборки.
    const err = Math.max(
      ctx.errorOf(t.level) * k / ctx.tol,
      ctx.texelOf ? ctx.texelOf(t.level) * k / ctx.texelTol : 0);

    const deep = t.level >= ctx.maxLevel;
    if (err <= 1 || deep) {
      if (ctx.ready(t)) out.push(t);
      else pushReady(ctx, t, out, err);
      continue;
    }

    // Хотим дробить: заказываем потомков и дробим, только когда они все
    // готовы. Иначе рисуем то, что есть.
    const kids = tileChildren(t.face, t.level, t.tx, t.ty, []);
    let allReady = true;
    for (const k of kids) if (!ctx.ready(k)) { allReady = false; ctx.want(k, err); }
    if (allReady) {
      for (const k of kids) stack.push(k);
    } else if (ctx.ready(t)) {
      out.push(t);
    } else {
      pushReady(ctx, t, out, err);
    }
  }
  return out;
}

// Ближайший готовый предок (корни резидентны, поэтому он всегда есть).
function pushReady(ctx, t, out, err) {
  ctx.want(t, err);
  let level = t.level, tx = t.tx, ty = t.ty;
  while (level > 0) {
    level--; tx >>= 1; ty >>= 1;
    const p = { face: t.face, level, tx, ty };
    if (ctx.ready(p)) {
      // Тот же предок мог уже попасть в список от соседней плитки.
      const key = tileKey(p.face, p.level, p.tx, p.ty);
      if (!out.some((q) => tileKey(q.face, q.level, q.tx, q.ty) === key)) out.push(p);
      return;
    }
  }
}

// Расстояние от камеры до точки поверхности в направлении c.
function chordDist(c, camDir, R, alt) {
  const d = R + alt;
  // Камера в camDir·(R+alt), точка в c·R.
  const dot = c.x * camDir.x + c.y * camDir.y + c.z * camDir.z;
  const s = R * R + d * d - 2 * R * d * dot;
  return Math.sqrt(Math.max(0, s));
}
