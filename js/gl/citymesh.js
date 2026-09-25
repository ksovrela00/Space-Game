// Сборка геометрии наземного города.
//
// Геометрия — В КИЛОМЕТРАХ и в осях города, а не в долях радиуса тела,
// как у камней и плиток. Разница принципиальная: в единичном радиусе
// метровая деталь — это 4·10⁻⁷, и float32 у единицы такой шаг уже почти
// не различает. Камням это сходит с рук (камень — бесформенная глыба), а
// у здания с окнами так поехали бы все грани разом. Поэтому город
// рисуется как обычный предмет — со своим положением и своим базисом,
// ровно как станция.
//
// ДВА УРОВНЯ ПОДРОБНОСТИ, И БЕЗ НИХ ИГРЫ НЕТ. Башня из пака стоит две с
// половиной тысячи треугольников; город в семьдесят километров — это
// четыре тысячи построек, то есть шесть миллионов треугольников и сто
// мегабайт в драйвере. Поэтому вблизи корабля (NEAR_R) стоят настоящие
// модели, а всё остальное — коробки по габаритам той же постройки, с её
// же цветом и полосами окон: десять-пятьдесят треугольников вместо двух
// тысяч. На километре разницы уже не видно, а считается она в сорок раз
// дешевле.
//
// Почему коробка, а не упрощённая модель: упрощать меш — это отдельная
// наука с сохранением силуэта, а здание и так коробка. Полосы окон
// сохраняют главное, ради чего город виден ночью, — свет.
//
// ПЕРЕСБОРКА ПО ДВИЖЕНИЮ. Набор «вблизи» зависит от того, где корабль,
// поэтому меш пересобирается, когда тот отошёл дальше MOVE_KM от места
// последней сборки. Гистерезис нужен буквально: без него корабль,
// висящий на границе клетки, пересобирал бы город каждый кадр. Пока
// новый меш собирается, рисуется старый — иначе город моргал бы на
// каждом километре пути.
//
// Издалека набор «вблизи» пуст, и пересобирать нечего: подлёт с орбиты
// не стоит ничего.

import { CITY_PARTS } from '../models/city.parts.js';
import { buildIndexedMesh } from './mesh.js';

/**
 * Докуда вокруг корабля вообще смотрим на настоящие модели, км.
 *
 * Десять километров — это не «столько влезет», а столько, чтобы смену
 * коробки на модель не было видно. На двух с небольшим она случалась
 * прямо на глазах: дом впереди менял форму, пока к нему подлетаешь.
 * Влезает же в бюджет заметно меньше — и решает, кому он достанется,
 * УГЛОВОЙ РАЗМЕР (см. nearSet).
 */
export const NEAR_R = 10;
/**
 * Сколько треугольников разрешено потратить на настоящие модели.
 *
 * Бюджет в ТРЕУГОЛЬНИКАХ, а не в постройках, и это важно: башня стоит
 * две с половиной тысячи, сарай — сотню. По числу построек тот же
 * «ближайшие двести» в центре давал шестьсот тысяч треугольников, а на
 * окраине — двадцать тысяч, то есть бюджета не было вовсе.
 */
export const NEAR_TRIS = 400000;
/** Насколько корабль должен сместиться на ходу, чтобы пересобирать, км. */
export const MOVE_KM = 0.7;

/**
 * Насколько допустимо разъехаться якорю у ВСТАВШЕГО корабля, км.
 *
 * Отдельный, меньший порог — потому что одного большого мало, и это
 * была настоящая ошибка. Корабль, пролетевший на метр меньше порога и
 * остановившийся, оставался с якорем за два километра НАВСЕГДА: порог
 * больше не пересекался, пересборки не случалось, и дома в трёхстах
 * метрах так и стояли коробками. Теперь, когда корабль встал,
 * подробности догоняют его точно.
 */
export const IDLE_KM = 0.15;

/** Медленнее этого за кадр корабль считается стоящим, км. */
const STILL_KM = 0.02;

/**
 * Треугольников за кадр при сборке.
 *
 * Порция большая: город целиком это полмиллиона треугольников, и по
 * четыре тысячи он собирался бы две секунды — те самые «иногда
 * прогрузка занимает время». Двенадцать тысяч укладывают сборку в
 * полсекунды, а кадр от них не проседает: работа тут на сотни
 * микросекунд, а не на миллисекунды.
 */
export const CHUNK = 12000;
/** Выше этого над плитой подробности уже не видно, км. */
export const FAR_ALT = 20;

// Кэш: сколько треугольников в детали и какого она цвета.
const _tris = new Map();
const _look = new Map();

function partTris(key) {
  let n = _tris.get(key);
  if (n === undefined) {
    const p = CITY_PARTS[key];
    n = 0;
    if (p) for (let i = 0; i < p.faces.length;) { n += Math.max(0, p.faces[i] - 2); i += p.faces[i] + 2; }
    _tris.set(key, n);
  }
  return n;
}

/**
 * Цвет коробки-заменителя: стена, крыша, стекло и есть ли оно вообще.
 *
 * Считается ПО ПЛОЩАДИ ГРАНЕЙ, а не по их числу. Разница не
 * академическая: у готовых моделей крыша — это одна большая плита и
 * десяток мелких надстроек, и счёт по штукам отдаёт их светлым
 * фонарям и трубам голос наравне с самой крышей. Крыша тогда выходит
 * светлее, чем есть, коробки сравниваются по яркости с бетоном плиты —
 * и сверху город пропадает в собственной площадке.
 *
 * Крыша берётся из самих верхних граней, а не «стена, умноженная на
 * три четверти»: сверху город виден именно ею.
 */
function lookOf(key) {
  let v = _look.get(key);
  if (v) return v;
  const p = CITY_PARTS[key];
  v = { r: 0.5, g: 0.5, b: 0.5, tr: 0.5, tg: 0.5, tb: 0.5, gr: 0.6, gg: 0.7, gb: 0.9, glass: 0 };
  if (p) {
    let wr = 0, wg = 0, wb = 0, wn = 0;
    let tr = 0, tg = 0, tb = 0, tn = 0;
    let gr = 0, gg = 0, gb = 0, gn = 0;
    for (let i = 0; i < p.faces.length;) {
      const cnt = p.faces[i++];
      const first = i;
      i += cnt;
      const pi = p.faces[i++] * 4;
      const r = p.pal[pi] / 255, g = p.pal[pi + 1] / 255, b = p.pal[pi + 2] / 255;
      if (p.pal[pi + 3] / 255 > 0.3) { gr += r; gg += g; gb += b; gn++; continue; }
      // Площадь и направление грани разом: сумма векторных произведений
      // по вееру треугольников — это удвоенная площадь со знаком, а её
      // направление и есть нормаль.
      let ax = 0, ay = 0, az = 0;
      const i0 = p.faces[first] * 3;
      for (let t = 1; t + 1 < cnt; t++) {
        const i1 = p.faces[first + t] * 3, i2 = p.faces[first + t + 1] * 3;
        const ux = p.verts[i1] - p.verts[i0], uy = p.verts[i1 + 1] - p.verts[i0 + 1];
        const uz = p.verts[i1 + 2] - p.verts[i0 + 2];
        const vx = p.verts[i2] - p.verts[i0], vy = p.verts[i2 + 1] - p.verts[i0 + 1];
        const vz = p.verts[i2 + 2] - p.verts[i0 + 2];
        ax += uy * vz - uz * vy; ay += uz * vx - ux * vz; az += ux * vy - uy * vx;
      }
      const area = Math.hypot(ax, ay, az);
      if (area <= 0) continue;
      wr += r * area; wg += g * area; wb += b * area; wn += area;
      if (ay / area > 0.7) { tr += r * area; tg += g * area; tb += b * area; tn += area; }
    }
    if (wn) { v.r = wr / wn; v.g = wg / wn; v.b = wb / wn; }
    if (gn) { v.gr = gr / gn; v.gg = gg / gn; v.gb = gb / gn; }
    // Крыш может не оказаться вовсе (мачта, ферма) — тогда стена.
    if (tn) { v.tr = tr / tn; v.tg = tg / tn; v.tb = tb / tn; } else { v.tr = v.r; v.tg = v.g; v.tb = v.b; }
    // Остеклена ли постройка — по НАЛИЧИЮ стеклянных граней, а не по их
    // доле. Долей это не ловится: у башни окон 28 граней из 2584, то
    // есть один процент, — но по площади это целые стены, и порог «хотя
    // бы десятая» гасил ночью все башни разом. Пак помечает стеклом
    // только настоящие окна, так что ноль против не-ноля — сигнал
    // точный.
    v.glass = gn;
  }
  _look.set(key, v);
  return v;
}

// --- Тени построек ---------------------------------------------------------
//
// Тень рисуется ТЁМНЫМ МНОГОУГОЛЬНИКОМ НА ГРУНТЕ, тем же мешем, что и
// сам город, — тот же приём, которым отбрасывают тень камни
// (js/gl/rocks.js). Карты теней здесь не нужны: грунт под городом
// РОВНЫЙ по построению, а значит тень коробки на нём — это её же
// проекция, считается точно и стоит шесть треугольников.
//
// Многоугольники соседних домов накладываются друг на друга, и это
// ничему не мешает: они непрозрачные, а не умножающие. Ради умножения
// пришлось бы заводить трафаретный проход, как у тени корабля, где
// предмет один и перекрытий нет.
//
// Цвет — доля от бетона плиты, и он не подобран, а ограничен смыслом:
// тень освещена только тем же рассеянным светом, которым освещена
// ночная сторона. Крутить его — SHADOW_DARK.
//
// Ночью теней нет вовсе, и это не упущение: солнца под горизонтом нет,
// а тёмный многоугольник на чёрном грунте всё равно не виден.

/** Во сколько раз тень темнее бетона плиты. */
export const SHADOW_DARK = 0.22;
/** Ниже этой высоты солнца тени не строим: они растягиваются в бесконечность. */
export const SHADOW_MIN = 0.12;
/** Предел длины тени в высотах постройки. */
export const SHADOW_MAX = 8;
/** Подъём тени над грунтом, км: выше улиц и разметки, ниже всего прочего. */
export const SHADOW_LIFT = 0.0001;
/** Насколько солнце должно уйти, чтобы пересобирать тени (косинус). */
export const SUN_STEP = 0.9995;

// Бетон плиты (js/gl/terrain.js, PLATE_RGB) — на нём тень и лежит.
export const SHADOW_RGB = [0.42 * SHADOW_DARK, 0.435 * SHADOW_DARK, 0.455 * SHADOW_DARK];

/** Ложатся ли вообще тени при таком солнце (в осях города). */
export const sunCasts = (sun) => !!sun && sun.y > SHADOW_MIN
  && Math.hypot(sun.x, sun.z) > 1e-4;

/** Сколько полос у коробки: одна на полсотни метров, но не больше шести. */
const bandsOf = (h) => Math.max(1, Math.min(6, Math.round(h / 0.05)));
const proxyTris = (h) => bandsOf(h) * 8 + 2;

/**
 * Какие детали показать целиком.
 *
 * Очередь — ПО УГЛОВОМУ РАЗМЕРУ (высота, делённая на расстояние), а не
 * по расстоянию. Это и есть «насколько крупно оно на экране», а
 * бюджетом распоряжаться надо именно так: башня в четыреста метров за
 * восемь километров занимает три градуса, и коробка вместо неё видна
 * сразу; сарай в сорок метров за восемь километров — это четыре
 * пикселя, и подробности в нём не разглядеть никак. Простое «сначала
 * ближние» тратило бюджет на сараи под брюхом и оставляло коробками
 * башни впереди — ровно то, что бросается в глаза при подлёте.
 *
 * Сарай же под брюхом углового размера не теряет: на полусотне метров
 * он крупнее любой башни на горизонте, и очередь это учитывает сама.
 *
 * @param near {x, y, z} в осях города или null — тогда целиком ничего
 * @returns Set индексов в plan.parts
 */
export function nearSet(plan, near) {
  const out = new Set();
  const r2 = NEAR_R * NEAR_R;
  const hit = [];
  for (let i = 0; i < plan.parts.length; i++) {
    const it = plan.parts[i];
    // Деталь без коробки (путь монорельса) заменять нечем, и она дёшева:
    // такие показываются целиком всегда, хоть с орбиты.
    if (it.b === undefined || it.b < 0 || !plan.boxes[it.b]) { out.add(i); continue; }
    if (!near) continue;
    const box = plan.boxes[it.b];
    const dx = it.x - near.x, dz = it.z - near.z;
    // Высота камеры считается над СЕРЕДИНОЙ здания: над крышей стоящей
    // рядом башни расстояние до неё не сто метров, а её полвысоты.
    const dy = (near.y || 0) - box.h * 0.5;
    const d2 = dx * dx + dz * dz + dy * dy;
    if (d2 > r2) continue;
    hit.push([box.h * box.h / Math.max(d2, 1e-6), i]);
  }
  hit.sort((a, b) => b[0] - a[0]);
  let tris = 0;
  for (const [, i] of hit) {
    const t = partTris(plan.parts[i].p);
    if (tris + t > NEAR_TRIS) break;
    tris += t;
    out.add(i);
  }
  return out;
}

/** Сколько треугольников выйдет: нужно, чтобы сразу завести буферы. */
export function cityTris(plan, near = null, sun = null) {
  const full = nearSet(plan, near);
  let tris = 0;
  for (let i = 0; i < plan.parts.length; i++) {
    const it = plan.parts[i];
    if (full.has(i)) tris += partTris(it.p);
    else tris += proxyTris(plan.boxes[it.b].h);
  }
  tris += plan.plates.length * 2 + plan.lamps.length * 12;
  // Тень: крышка плюс две боковые грани развёртки. Ровно шесть на
  // постройку — у прямоугольника при переносе силуэтных рёбер всегда два.
  if (sunCasts(sun)) tris += plan.boxes.length * 6;
  return tris;
}

// Куб огня: восемь вершин и двенадцать треугольников. Огонь на мачте
// виден со всех сторон, поэтому именно куб, а не плашка: плашка с
// земли выглядит линией, а с обратной стороны исчезает вовсе.
const CUBE = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const CUBE_TRIS = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
  [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
];

/**
 * Порционный сборщик города.
 *
 * @param plan планировка (js/models/city.js, cityPlan)
 * @param near {x, z} — где корабль, в осях города, или null
 */
export function cityBuilder(plan, near = null, groundR = 0, sun = null) {
  const full = nearSet(plan, near);
  const casts = sunCasts(sun);
  const tris = cityTris(plan, near, sun);
  const total = tris * 3;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 4);
  const indices = new Uint32Array(total);
  let o = 0;

  // Единый список работы: детали, потом плашки, потом огни. Порция
  // отсчитывается по нему, а не по деталям — иначе одна башня в две с
  // половиной тысячи граней съедала бы весь кадр.
  const jobs = [];
  for (let i = 0; i < plan.parts.length; i++) {
    jobs.push({ kind: full.has(i) ? 'part' : 'proxy', it: plan.parts[i] });
  }
  // Тени идут ПЕРВЫМИ. Они лежат на грунте, их накрывают и дома, и
  // улицы, и порядок здесь — это порядок в буфере глубины при равных
  // высотах.
  if (casts) for (const box of plan.boxes) jobs.push({ kind: 'shade', it: box });
  for (const it of plan.plates) jobs.push({ kind: 'plate', it });
  for (const it of plan.lamps) jobs.push({ kind: 'lamp', it });
  let at = 0;
  let result = null;

  // Город — жёсткое тело, а плита под ним кусок сферы: в осях города
  // грунт уходит вниз от касательной плоскости (js/game/city.js,
  // cityDrop). На четырёх километрах это меньше метра, на тридцати пяти
  // — двести тридцать, и без поправки окраина висела бы в воздухе.
  // Правится здесь, при сборке: тогда остальной город — и планировка, и
  // столкновения — остаётся плоским и про кривизну не знает.
  const r2 = groundR * groundR;
  const drop = groundR > 0
    ? (x, z) => Math.sqrt(Math.max(0, r2 - x * x - z * z)) - groundR
    : () => 0;

  const put = (x, y, z, nx, ny, nz, r, g, b, em) => {
    positions[o * 3] = x; positions[o * 3 + 1] = y + drop(x, z); positions[o * 3 + 2] = z;
    normals[o * 3] = nx; normals[o * 3 + 1] = ny; normals[o * 3 + 2] = nz;
    colors[o * 4] = r; colors[o * 4 + 1] = g; colors[o * 4 + 2] = b;
    colors[o * 4 + 3] = em;
    indices[o] = o;
    o++;
  };

  // Треугольник с нормалью из порядка вершин: затенение плоское, как у
  // всех рукотворных предметов в игре.
  const tri = (a, b, c, r, g, bl, em) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    put(a[0], a[1], a[2], nx, ny, nz, r, g, bl, em);
    put(b[0], b[1], b[2], nx, ny, nz, r, g, bl, em);
    put(c[0], c[1], c[2], nx, ny, nz, r, g, bl, em);
  };

  const MM = 1e-3;     // деталь хранится в тысячных своего размера

  const onePart = (it) => {
    const p = CITY_PARTS[it.p];
    if (!p) return;
    const k = it.s * MM;
    const cs = Math.cos(it.rot || 0), sn = Math.sin(it.rot || 0);
    const dim = it.dim === undefined ? 1 : it.dim;
    // Вершины детали, развёрнутые и поставленные на место. Разворот —
    // вокруг местной вертикали: дома не заваливаются.
    const n = p.verts.length / 3;
    const vx = new Float64Array(n), vy = new Float64Array(n), vz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = p.verts[i * 3] * k, y = p.verts[i * 3 + 1] * k, z = p.verts[i * 3 + 2] * k;
      vx[i] = it.x + x * cs + z * sn;
      vy[i] = (it.y || 0) + y;
      vz[i] = it.z - x * sn + z * cs;
    }
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    for (let i = 0; i < p.faces.length;) {
      const cnt = p.faces[i++];
      const first = i;
      i += cnt;
      const pi = p.faces[i++] * 4;
      const r = (p.pal[pi] / 255) * dim;
      const g = (p.pal[pi + 1] / 255) * dim;
      const bl = (p.pal[pi + 2] / 255) * dim;
      const em = p.pal[pi + 3] / 255;
      for (let t = 1; t + 1 < cnt; t++) {
        const i0 = p.faces[first], i1 = p.faces[first + t], i2 = p.faces[first + t + 1];
        a[0] = vx[i0]; a[1] = vy[i0]; a[2] = vz[i0];
        b[0] = vx[i1]; b[1] = vy[i1]; b[2] = vz[i1];
        c[0] = vx[i2]; c[1] = vy[i2]; c[2] = vz[i2];
        tri(a, b, c, r, g, bl, em);
      }
    }
  };

  /**
   * Коробка вместо модели: габариты той же постройки, её цвет и полосы
   * окон. Полосы светятся — ночью на безатмосферном теле город виден
   * только ими, и потерять свет на дальней половине города значило бы
   * потерять саму половину.
   */
  const oneProxy = (it) => {
    const box = plan.boxes[it.b];
    if (!box) return;
    const look = lookOf(it.p);
    const dim = it.dim === undefined ? 1 : it.dim;
    const bands = bandsOf(box.h);
    const glass = look.glass > 0 && bands > 1;
    // Коробка растёт ОТ ГРУНТА, а не от собственной высоты детали: в
    // коробке столкновения h — это высота над грунтом (по ней считает
    // cityBlocked), и сложив её с подъёмом детали, вагон монорельса
    // выходил вдвое выше собственной коробки и висел в воздухе.
    // «Нарисованное = настоящее» здесь буквально: коробка и есть то, во
    // что врезается корабль.
    const y0 = 0;
    // Углы в осях коробки, развёрнутые её же разворотом.
    const cor = (sx, sz) => {
      const lx = sx * box.hw, lz = sz * box.hd;
      return [box.x + lx * box.c + lz * box.s, box.z - lx * box.s + lz * box.c];
    };
    const p00 = cor(-1, -1), p10 = cor(1, -1), p11 = cor(1, 1), p01 = cor(-1, 1);
    const ring = [p00, p10, p11, p01];
    for (let k = 0; k < bands; k++) {
      const ya = (box.h * k) / bands;
      const yb = (box.h * (k + 1)) / bands;
      const win = glass && k % 2 === 1;
      const r = (win ? look.gr : look.r) * dim;
      const g = (win ? look.gg : look.g) * dim;
      const b = (win ? look.gb : look.b) * dim;
      // Светится полоса слабее настоящего окна (0.85), и намеренно: у
      // модели окна — десятая доля поверхности, а полоса тут половина
      // стены. Возьми столько же — и дальняя половина города ночью
      // окажется ярче ближней, где стоят настоящие модели, а днём
      // кварталы выцветут в белое.
      const em = win ? 0.35 : 0;
      // Порядок вершин — ПО часовой при взгляде снаружи: нормаль
      // считается из него же, и при обратном обходе она смотрит внутрь
      // коробки. Освещение тогда берёт её с изнанки, и город выходит
      // чёрным при полном солнце — ровно это и показал первый снимок.
      for (let e = 0; e < 4; e++) {
        const a = ring[e], c = ring[(e + 1) % 4];
        tri([a[0], ya, a[1]], [c[0], yb, c[1]], [c[0], ya, c[1]], r, g, b, em);
        tri([a[0], ya, a[1]], [a[0], yb, a[1]], [c[0], yb, c[1]], r, g, b, em);
      }
    }
    // Крыша — своим цветом: сверху город виден именно ею.
    const yt = box.h;
    const rr = look.tr * dim, rg = look.tg * dim, rb = look.tb * dim;
    tri([p00[0], yt, p00[1]], [p11[0], yt, p11[1]], [p10[0], yt, p10[1]], rr, rg, rb, 0);
    tri([p00[0], yt, p00[1]], [p01[0], yt, p01[1]], [p11[0], yt, p11[1]], rr, rg, rb, 0);
  };

  /**
   * Тень постройки на грунте: проекция её коробки вдоль луча солнца.
   *
   * Основание не рисуется — на нём стоит сам дом, и видно его всё равно
   * не будет. Остаётся крышка, снесённая на длину тени, и два боковых
   * прямоугольника развёртки: у выпуклого четырёхугольника при переносе
   * силуэтных рёбер ровно два, и найти их — это один знак скалярного
   * произведения.
   */
  const oneShade = (box) => {
    // Куда снесёт тень вершины на высоте h: горизонталь «от солнца»,
    // делённая на высоту солнца над горизонтом.
    let len = box.h / sun.y;
    const flat = Math.hypot(sun.x, sun.z);
    // У самого горизонта тень уходит в бесконечность — обрезаем, как у
    // камней: иначе она вылезет за плиту на нетронутый рельеф и повиснет
    // над ним или утонет.
    len = Math.min(len, (box.h * SHADOW_MAX) / Math.max(flat, 1e-6));
    const dx = -sun.x * len, dz = -sun.z * len;
    const y = SHADOW_LIFT;
    const r = SHADOW_RGB[0], g = SHADOW_RGB[1], b = SHADOW_RGB[2];
    // Углы основания в осях города.
    const cor = (sx, sz) => {
      const lx = sx * box.hw, lz = sz * box.hd;
      return [box.x + lx * box.c + lz * box.s, box.z - lx * box.s + lz * box.c];
    };
    const ring = [cor(-1, -1), cor(1, -1), cor(1, 1), cor(-1, 1)];
    // Крышка, снесённая целиком.
    const t = ring.map((p) => [p[0] + dx, p[1] + dz]);
    tri([t[0][0], y, t[0][1]], [t[2][0], y, t[2][1]], [t[1][0], y, t[1][1]], r, g, b, 0);
    tri([t[0][0], y, t[0][1]], [t[3][0], y, t[3][1]], [t[2][0], y, t[2][1]], r, g, b, 0);
    // Боковины: ребро силуэтное, если его внешняя нормаль смотрит туда же,
    // куда уехала тень.
    for (let e = 0; e < 4; e++) {
      const a = ring[e], cc = ring[(e + 1) % 4];
      // Внешняя нормаль ребра выпуклого обхода: повернуть ребро на
      // прямой угол. Знак берём по середине — от центра коробки наружу.
      const ex = cc[0] - a[0], ez = cc[1] - a[1];
      let nx = ez, nz = -ex;
      const mx = (a[0] + cc[0]) / 2 - box.x, mz = (a[1] + cc[1]) / 2 - box.z;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      if (nx * dx + nz * dz <= 0) continue;
      tri([a[0], y, a[1]], [cc[0] + dx, y, cc[1] + dz], [cc[0], y, cc[1]], r, g, b, 0);
      tri([a[0], y, a[1]], [a[0] + dx, y, a[1] + dz], [cc[0] + dx, y, cc[1] + dz], r, g, b, 0);
    }
  };

  const onePlate = (it) => {
    const r = it.c[0] / 255, g = it.c[1] / 255, b = it.c[2] / 255;
    const em = it.glow || 0;
    const y = it.y || 0;
    const cs = Math.cos(it.rot || 0), sn = Math.sin(it.rot || 0);
    const at = (sx, sz) => {
      const lx = sx * it.hw, lz = sz * it.hd;
      return [it.x + lx * cs + lz * sn, y, it.z - lx * sn + lz * cs];
    };
    // Порядок вершин — против часовой при взгляде сверху: нормаль вверх.
    tri(at(-1, -1), at(-1, 1), at(1, 1), r, g, b, em);
    tri(at(-1, -1), at(1, 1), at(1, -1), r, g, b, em);
  };

  const oneLamp = (it) => {
    const r = it.c[0] / 255, g = it.c[1] / 255, b = it.c[2] / 255;
    const s = it.r;
    const v = CUBE.map((p) => [it.x + p[0] * s, it.y + p[1] * s, it.z + p[2] * s]);
    for (const t of CUBE_TRIS) tri(v[t[0]], v[t[1]], v[t[2]], r, g, b, 1);
  };

  return {
    total: jobs.length,
    tris,
    near,
    get done() { return at >= jobs.length; },
    /**
     * Порция считается В ТРЕУГОЛЬНИКАХ, а не в предметах.
     *
     * Предметы здесь разной цены: башня — две с половиной тысячи граней,
     * фонарь — двенадцать. Считая штуками, приходится равняться на
     * башню, и тогда шестьсот фонарей растягиваются на сотню кадров;
     * равняясь на фонарь, одна башня съедает кадр целиком. Один предмет
     * за раз берётся всегда — иначе сборка встала бы на первой же башне,
     * которая больше бюджета.
     */
    step(budget = 4000) {
      const from = o;
      while (at < jobs.length) {
        const j = jobs[at++];
        if (j.kind === 'part') onePart(j.it);
        else if (j.kind === 'proxy') oneProxy(j.it);
        else if (j.kind === 'shade') oneShade(j.it);
        else if (j.kind === 'plate') onePlate(j.it);
        else oneLamp(j.it);
        if ((o - from) / 3 >= budget) break;
      }
      if (at < jobs.length) return false;
      result = { positions, normals, colors, indices, faces: o / 3, count: jobs.length };
      return true;
    },
    get result() { return result; },
  };
}

/** Город целиком, одним заходом. Этим пользуются проверки. */
export function buildCityGeometry(plan, near = null, groundR = 0, sun = null) {
  const b = cityBuilder(plan, near, groundR, sun);
  while (!b.step(1e9)) { /* один заход */ }
  return b.result;
}

/**
 * Город в памяти видеокарты: собирается, когда до него уже есть дело, и
 * освобождается, когда корабль ушёл из системы.
 */
export class CityField {
  constructor(gl, locs) {
    this.gl = gl;
    this.locs = locs;
    this.mesh = null;
    this.city = null;
    this.job = null;
    this.builds = 0;
    // Где стоял корабль, когда собирался нынешний меш (оси города), и
    // был ли он вообще близко.
    this.anchor = null;
    // Где он был в прошлом кадре: по этому видно, встал он или летит.
    this.last = null;
    // Куда светило солнце, когда собирались тени (оси города).
    this.sun = null;
  }

  /**
   * Нужно ли пересобирать под новое положение корабля.
   *
   * Возвращает {near} — что собирать, — или null, если пересобирать не
   * надо. Обёртка нужна ровно затем, чтобы отличить «не пересобирать» от
   * «пересобрать одними коробками»: у второго набор «вблизи» тоже пуст,
   * и голым null эти два случая слипались — город так и оставался
   * подробным на высоте в шестьдесят километров.
   *
   * @param at {x, y, z} корабль в осях города или null
   */
  wants(at, sun) {
    // Вдалеке или высоко подробностей не разобрать, и набор «вблизи»
    // пуст: значит и пересобирать нечего, сколько бы корабль ни летел.
    const near = at && at.y < FAR_ALT
      && Math.hypot(at.x, at.z) < (this.city ? this.city.radius : 0) + NEAR_R
      ? { x: at.x, y: at.y, z: at.z } : null;
    if (!this.mesh) return { near, sun };
    // Солнце ушло — тени пересчитываются. Порог грубый нарочно: за час
    // игрового времени солнце проходит два десятка градусов, и
    // пересборка ради пары угловых минут была бы работой впустую.
    const s0 = this.sun;
    const moved = !s0 !== !sun
      || (s0 && sun && s0.x * sun.x + s0.y * sun.y + s0.z * sun.z < SUN_STEP);
    if (moved) return { near: this.anchor, sun };
    const a = this.anchor;
    if (!a !== !near) return { near, sun };
    if (!near) return null;
    // Высота входит в смещение наравне с ходом по земле: на снижении с
    // десяти километров до полусотни метров набор «вблизи» меняется
    // целиком, а по земле корабль при этом может не сдвинуться вовсе.
    const off = Math.hypot(a.x - near.x, (a.y || 0) - (near.y || 0), a.z - near.z);
    if (off > MOVE_KM) return { near, sun };
    const l = this.last;
    const still = l
      && Math.hypot(l.x - near.x, (l.y || 0) - (near.y || 0), l.z - near.z) < STILL_KM;
    return still && off > IDLE_KM ? { near, sun } : null;
  }

  /**
   * @param city город (js/game/city.js) или null
   * @param at корабль в осях города или null
   * @param chunk треугольников за кадр
   * @returns меш или null, пока не собран ни один
   */
  update(city, at = null, sun = null, chunk = CHUNK) {
    if (!city) { this.clear(); return null; }
    if (this.city !== city) { this.clear(); this.city = city; }
    if (!this.job) {
      const w = this.wants(at, sun);
      // Где корабль был в прошлый раз — запоминаем ПОСЛЕ решения:
      // иначе «встал» никогда бы не сработало, сравнение шло бы с самим
      // собой.
      if (at) {
        if (this.last) { this.last.x = at.x; this.last.y = at.y; this.last.z = at.z; }
        else this.last = { x: at.x, y: at.y, z: at.z };
      } else this.last = null;
      if (!w) return this.mesh;
      this.job = {
        builder: cityBuilder(city.plan, w.near, city.groundR, w.sun),
        near: w.near,
        sun: w.sun ? { x: w.sun.x, y: w.sun.y, z: w.sun.z } : null,
      };
    }
    if (this.job.builder.step(chunk)) {
      const geo = this.job.builder.result;
      const mesh = geo.faces > 0 ? buildIndexedMesh(this.gl, this.locs, geo) : null;
      if (mesh) mesh.faces = geo.faces;
      // Старый меш живёт до последнего: город не должен моргать на
      // каждом километре пути.
      this.release();
      this.mesh = mesh;
      this.anchor = this.job.near;
      this.sun = this.job.sun;
      this.builds++;
      this.job = null;
    }
    return this.mesh;
  }

  release() {
    if (this.mesh && this.mesh.dispose) this.mesh.dispose();
    this.mesh = null;
  }

  clear() {
    this.release();
    this.city = null;
    this.job = null;
    this.anchor = null;
    this.last = null;
    this.sun = null;
  }
}
