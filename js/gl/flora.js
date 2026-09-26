// Растительность на грунте: деревья, кусты, трава.
//
// Зачем. У камней (js/gl/rocks.js) была ровно одна задача — дать глазу
// предмет известного размера, чтобы читалась высота. Они её решают, но
// только с двадцати-тридцати метров: камень в два метра дальше сотни
// превращается в крапину. Выше этого у атмосферного мира снова нет
// ничего, и «двести метров» от «двух километров» отличить нечем.
//
// Дерево в пятнадцать метров видно за километр с лишним. Оно закрывает
// именно тот разрыв, в котором происходит вся посадка: подход, заход,
// касание. Плюс лес — это сразу и ветер масштаба, и разница между
// равниной, склоном и гребнем, которую одним цветом грунта не показать.
//
// ЯРУСЫ. Растения разного размера видно с разной высоты, и держать их в
// одном поле бессмысленно: трава в полметра на высоте в километр — это
// сотни тысяч невидимых треугольников. Поэтому ярусов три, у каждого
// своя высота, свой шаг решётки и свой предел по высоте камеры:
// деревья строятся до полутора километров, кусты до двухсот метров,
// трава до семидесяти.
//
// РАССТАНОВКА, как у камней, ДЕТЕРМИНИРОВАННАЯ и привязана к телу:
// решётка живёт в координатах грани куба, всё случайное берётся из
// хеша номера ячейки. Лес не плывёт при движении, не мигает при
// пересборке и стоит на одном месте между запусками.
//
// ГДЕ РАСТЁТ. Не везде, и это главное отличие от камней. Камень лежит
// где угодно, растению нужна почва: не в воде, не на пляже, не выше
// снеговой линии и не на голой скале горного гребня. Всё это уже есть
// в рельефе — нормированная высота и высота горного слоя
// (js/gl/terrain.js), — и лес читает их напрямую, а не заводит свою
// карту биомов, которая с рельефом обязательно разошлась бы.
//
// Модели — CC0-пак Kenney Nature Kit, перегнанный tools/nature.mjs.
// Цвет ему задаёт МИР, а не пак: см. tintOf.

import { faceDir } from './quadtree.js';
import { cubeLookup } from './bake.js';
import { terrainOf, plateAt, fbm } from './terrain.js';
import { buildIndexedMesh } from './mesh.js';
import { NATURE_PARTS } from '../models/nature.parts.js';
import { Q } from '../core/quality.js';

export const FLORA = {
  /**
   * Ярусы. `alt` — докуда ярус строится (км), `cell` — шаг решётки (км),
   * `chance` — доля занятых ячеек при полной плотности, `hMin`/`hMax` —
   * высота растения (км), `share` — доля общего бюджета.
   *
   * Шаг решётки ПОСТОЯННЫЙ, как у камней: плотность леса — свойство
   * места, а не высоты, с которой на него смотрят. Растягивать шаг
   * вместе с полем значит получить на подходе три дерева в кадре.
   */
  layers: [
    {
      kind: 'tree',
      maxAlt: 1.6,
      // Тридцать восемь метров между деревьями — это редколесье, и это
      // ПОТОЛОК, а не выбор вкуса. Настоящий лес стоит вдесятеро гуще, и
      // при таком шаге поле радиусом в полкилометра упирается в бюджет
      // ещё до того, как дойдёт до края. Дальше выбор простой: либо
      // густо и близко, либо редко и далеко. Взято близко: лес нужен
      // там, где садятся.
      cell: 0.038,
      chance: 0.55,
      hMin: 0.007,
      hMax: 0.019,
      share: 0.50,
      radiusOf: (alt) => Math.min(2.2, Math.max(0.42, alt * 3.0)),
    },
    {
      kind: 'bush',
      maxAlt: 0.22,
      cell: 0.016,
      chance: 0.45,
      hMin: 0.0012,
      hMax: 0.0030,
      share: 0.24,
      radiusOf: (alt) => Math.min(0.22, Math.max(0.07, alt * 3.5)),
    },
    {
      kind: 'blade',
      maxAlt: 0.07,
      cell: 0.0045,
      chance: 0.60,
      hMin: 0.00035,
      hMax: 0.00080,
      share: 0.26,
      radiusOf: (alt) => Math.min(0.065, Math.max(0.03, alt * 3.5)),
    },
  ],
  // Растений в поле целиком. Дальше растёт только цена: лес из тысячи
  // деревьев стоит полтораста тысяч треугольников, и это уже половина
  // города.
  max: Q.flora,
  // Растений за один кадр. У каждого — выборка рельефа (самая дорогая
  // функция в игре) и копия модели, поэтому порциями.
  chunk: 24,
  // Средняя густота там, где вообще растёт: по ней считается шаг
  // прореживания. Число измеренное (tools/gl.mjs, раздел
  // «растительность»), а не подобранное.
  dens: 0.46,
  // Где растёт: границы ПО ЦВЕТУ ГРУНТА (terrain.soil). У
  // океанического мира песок пляжа лежит на 0.22, зелень тянется до
  // 0.55, дальше начинается камень.
  lo: 0.255,
  hi: 0.60,
  // Кромки, на которых лес редеет до нуля. Резкая граница леса читается
  // как обрезанный газон и выдаёт правило, по которому он поставлен.
  edge: 0.05,
  // Частоты пятен леса на единичной сфере: рощи и поляны. Две, потому
  // что одна даёт равномерную «сыпь»: крупная решает, где вообще лес, а
  // мелкая рвёт его на опушки.
  patchFreq: 260,
  patchFine: 1600,
  patchThr: -0.06,
  patchSoft: 0.26,
  // Тень растения. Без неё дерево стоит в воздухе: с высоты его видно
  // сверху, а сверху крона — это пятно краски.
  shadowMin: 0.12,    // синус высоты солнца, ниже которого тени нет
  shadowMax: 1.5,     // предел длины тени в ПОПЕРЕЧНИКАХ КРОНЫ (см. shadow)
  shadowDark: 0.30,   // во сколько раз тень темнее грунта
  shadowLift: 0.00003, // км — подъём над грунтом, чтобы не спорить с ним
};

// Хеш номера ячейки -> четыре независимых числа 0..1. Тот же, что у
// камней: одна решётка, одни правила.
const hash4 = (a, b, c) => {
  let h = (Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2246822519)) | 0;
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    out[i] = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  return out;
};

const clamp01 = (t) => (t <= 0 ? 0 : (t >= 1 ? 1 : t));
const smooth01 = (t) => (t <= 0 ? 0 : (t >= 1 ? 1 : t * t * (3 - 2 * t)));

/**
 * Шаг прореживания решётки для поля такого радиуса: 1, 2, 4, 8.
 *
 * Считается от того, сколько растений влезает в бюджет: площадь поля
 * растёт как квадрат радиуса, значит и шаг обязан расти как радиус.
 * Степень двойки берётся ближайшая снизу — лучше чуть гуще бюджета,
 * чем реже.
 */
export function strideFor(L, radius) {
  // Сколько растений выйдет при таком шаге: ячейки поля, занятые по
  // chance и прореженные густотой (FLORA.dens — средняя по суше,
  // измерена, а не выдумана). Считать по одному chance нельзя: тогда
  // трава под ногами прореживается вдвое там, где бюджета хватало с
  // запасом, и у корабля вместо луга остаются проплешины.
  const cells = Math.PI * (radius / L.cell) * (radius / L.cell);
  const cap = Math.max(1, FLORA.max * L.share);
  let k = 1;
  // Допуск в четверть: лишнее срежет обход кольцами, и срежет с
  // ДАЛЬНЕГО края — там, где это и незаметно. А вот шаг вдвое крупнее
  // виден сразу: лес редеет вчетверо.
  while (k < 8 && cells / (k * k) * L.chance * FLORA.dens > cap * 1.25) k *= 2;
  return k;
}

/** Модели по ярусам — считается один раз. */
const BY_KIND = (() => {
  const out = {};
  for (const [name, part] of Object.entries(NATURE_PARTS)) {
    (out[part.kind] || (out[part.kind] = [])).push({ name, part });
  }
  return out;
})();

/**
 * Растёт ли здесь вообще что-нибудь и насколько густо: 0..1.
 *
 * Считается по рельефу, а не по своей карте: у тела уже есть и высота
 * над уровнем моря, и горный слой, и площадка города. Своя карта биомов
 * рано или поздно разошлась бы с ними — лес полез бы в воду или на
 * бетон перрона.
 */
export function growth(body, terrain, x, y, z) {
  // Город расчищен: деревья на перроне означали бы, что город построили
  // в лесу и не стали его рубить.
  if (body.plate && plateAt(body.plate, x, y, z) > 0) return 0;

  // Место на цветовой рампе, а не высота над уровнем моря: расти надо
  // там, где земля ЗЕЛЁНАЯ. Горный склон бывает лесной по высоте и уже
  // каменный по цвету — деревья на нём стояли бы на голой скале. Заодно
  // сюда входит полярная шапка: на морском льду рампа за 0.96, и лес
  // туда не лезет без единой отдельной проверки.
  const t = terrain.soil(x, y, z);
  if (t <= FLORA.lo || t >= FLORA.hi) return 0;
  // Кромки: у воды и у камня лес редеет, а не обрывается.
  const w = Math.min(smooth01((t - FLORA.lo) / FLORA.edge),
    smooth01((FLORA.hi - t) / FLORA.edge));

  // Рощи и поляны.
  const s = terrain.seed + 4242;
  const p = fbm(s, x * FLORA.patchFreq, y * FLORA.patchFreq, z * FLORA.patchFreq, 3, 1)
    + fbm(s + 71, x * FLORA.patchFine, y * FLORA.patchFine, z * FLORA.patchFine, 2, 1) * 0.45;
  return w * smooth01((p - FLORA.patchThr) / FLORA.patchSoft);
}

/**
 * Где стоят растения вокруг точки dir.
 *
 * Чистая геометрия, без единого обращения к GL: проверяется в node.
 *
 * @param body тело
 * @param dir  направление на точку под камерой (локальные оси)
 * @param alt  высота камеры над поверхностью, км
 * @returns массив {dir, kind, model, height, spin, tilt}
 */
export function scatterFlora(body, dir, alt, out = []) {
  out.length = 0;
  const terrain = terrainOf(body);
  if (terrain.isFlat) return out;
  const R = body.radius;
  const look = cubeLookup(dir.x, dir.y, dir.z);
  const QUARTER = Math.PI / 4;
  const fu = Math.atan(look.s) / QUARTER, fv = Math.atan(look.t) / QUARTER;

  for (let li = 0; li < FLORA.layers.length; li++) {
    const L = FLORA.layers[li];
    if (alt > L.maxAlt) continue;
    const models = BY_KIND[L.kind];
    if (!models || !models.length) continue;
    const radius = L.radiusOf(alt);
    const cap = out.length + Math.round(FLORA.max * L.share);
    // ШАГ ПРОРЕЖИВАНИЯ. Поле растёт вместе с высотой, а бюджет не
    // растёт: без прореживания лес упирается в счёт и кончается в
    // полукилометре от корабля — то есть едет за ним островом. С
    // высоты берётся каждое второе, четвёртое, восьмое дерево, и поле
    // дотягивается до пары километров тем же числом.
    //
    // Шаг — СТЕПЕНЬ ДВОЙКИ, и это единственное, что делает приём
    // честным: тогда редкая решётка есть ПОДМНОЖЕСТВО густой, номер
    // ячейки у дерева не меняется, а вместе с ним не меняются ни хеш,
    // ни порода, ни высота, ни место. На снижении деревья не
    // переставляются и не подменяются — их просто становится больше, и
    // появляются они далеко, где занимают пиксель.
    const stride = strideFor(L, radius);
    const step = (L.cell * stride / R) / QUARTER;
    const half = Math.ceil((radius / R) / QUARTER / step);
    // Центр тоже кратен шагу — иначе подмножество «съезжало» бы на
    // полклетки при каждой смене шага, и все деревья менялись разом.
    const ci = Math.round(fu / step) * stride, cj = Math.round(fv / step) * stride;
    const cosLim = Math.cos(radius / R);

    // Ячейки обходятся КОЛЬЦАМИ от центра наружу, а не строками.
    //
    // Разница видна сразу, как только поле упирается в бюджет: при
    // обходе строками лес обрывается там, где кончился счёт, то есть
    // полукругом с одного края — прямо перед носом пусто, а за спиной
    // густо. Кольцами лишними оказываются САМЫЕ ДАЛЬНИЕ деревья, и
    // редеет поле по краю, где это и должно быть.
    for (let ring = 0; ring <= half && out.length < cap; ring++) {
      const side = ring === 0 ? 1 : 8 * ring;
      for (let n2 = 0; n2 < side && out.length < cap; n2++) {
        let i = 0, j = 0;
        if (ring > 0) {
          const per = 2 * ring;                     // ячеек на сторону
          const s = Math.floor(n2 / per), k = n2 % per;
          if (s === 0) { i = -ring + k; j = -ring; }
          else if (s === 1) { i = ring; j = -ring + k; }
          else if (s === 2) { i = ring - k; j = ring; }
          else { i = -ring; j = ring - k; }
        }
        const gi = ci + i * stride, gj = cj + j * stride;
        // Номер яруса в хеше: иначе куст вырастал бы ровно под деревом.
        const h = hash4(gi, gj, look.face * 7919 + (body.id | 0) * 104729 + li * 31337);
        if (h[0] > L.chance) continue;
        // Шаг ячейки в параметрах грани — БАЗОВЫЙ: номер ячейки
        // считается по густой решётке, иначе подмножество не совпало бы
        // по месту.
        const base = step / stride;
        const u = (gi + (h[1] - 0.5) * 0.92) * base;
        const v = (gj + (h[2] - 0.5) * 0.92) * base;
        if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;      // соседняя грань
        const d = faceDir(look.face, u, v, { x: 0, y: 0, z: 0 });
        if (d.x * dir.x + d.y * dir.y + d.z * dir.z < cosLim) continue;
        // К краю поля лес редеет. Без этого он обрывается ровной
        // окружностью — с воздуха это видно сразу и выдаёт, что лес
        // стоит вокруг корабля, а не на планете.
        const far = Math.acos(Math.max(-1, Math.min(1,
          d.x * dir.x + d.y * dir.y + d.z * dir.z))) * R / radius;
        const fade = far < 0.62 ? 1 : smooth01((1 - far) / 0.38);
        const g = growth(body, terrain, d.x, d.y, d.z) * fade;
        // Густота решает не «сколько», а «какие ячейки»: сравнение с
        // тем же хешем, что выбирал ячейку, даёт плавное редение леса к
        // опушке без отдельного прохода.
        if (g <= 0 || h[0] > L.chance * g) continue;
        const pick = models[Math.floor(h[3] * models.length) % models.length];
        out.push({
          dir: d,
          kind: L.kind,
          model: pick.part,
          // Разброс высоты внутри яруса: одинаковые деревья читаются
          // как расставленные, а не выросшие.
          height: L.hMin + (L.hMax - L.hMin) * (0.25 + 0.75 * h[3]),
          spin: h[1] * Math.PI * 2,
          // Наклон: дерево не столб. Полтора градуса хватает, чтобы
          // ряд не выглядел частоколом.
          tilt: (h[2] - 0.5) * 0.05,
        });
      }
    }
  }
  return out;
}

/**
 * Цвет роли на этом теле.
 *
 * Растение красит МИР, а не пак: листва чужой планеты не обязана быть
 * земной зеленью, а мультяшная бирюза Kenney на оливковом грунте
 * выглядела бы игрушкой. Отсчёт идёт от цвета САМОГО ГРУНТА в этой
 * точке — тогда лес и поле оказываются одной палитры на любом теле, и
 * ни одного цвета не приходится задавать руками для каждого мира.
 *
 * @param role номер роли (NATURE_ROLES: кора, листва, трава, цветок)
 * @param ground цвет грунта под растением
 * @param raw авторский цвет грани (для цветов он и идёт в дело)
 */
export function tintOf(role, ground, raw, out) {
  const [gr, gg, gb] = ground;
  if (role === 3) {                       // цветок — как задумал автор
    out[0] = raw[0] / 255; out[1] = raw[1] / 255; out[2] = raw[2] / 255;
    return out;
  }
  if (role === 0) {                       // кора: тёмное дерево
    out[0] = gr * 0.55 + 0.06;
    out[1] = gg * 0.40 + 0.04;
    out[2] = gb * 0.34 + 0.02;
    return out;
  }
  // Листва темнее и зеленее грунта, трава — светлее и ближе к нему.
  const k = role === 1 ? 0.62 : 0.86;
  const up = role === 1 ? 0.30 : 0.16;
  out[0] = clamp01(gr * k * 0.72);
  out[1] = clamp01(gg * k + up * 0.22);
  out[2] = clamp01(gb * k * 0.62);
  return out;
}

/** Вершин и граней в поле: нужно заранее, буферы выделяются разом. */
function countFaces(plants) {
  let f = 0;
  for (const p of plants) {
    // faces: длина, индексы, номер цвета — идём по длинам.
    const src = p.model.faces;
    for (let i = 0; i < src.length;) {
      const n = src[i];
      f += n - 2;                          // веер треугольников
      i += n + 2;
    }
    f += SHADOW_SIDES;                     // тень
  }
  return f;
}

const SHADOW_SIDES = 7;

/**
 * Порционный сборщик поля: геометрия в КИЛОМЕТРАХ от центра поля, в
 * осях тела.
 *
 * Не в долях радиуса, как у плиток и камней, и это пришлось выяснить
 * снимком. Шаг float32 у единицы — 1.2·10⁻⁷, а на теле в четыре тысячи
 * километров это ПОЛМЕТРА. Куст в два метра получает на всю высоту
 * четыре различимых положения, трава в полметра — ОДНО: она просто
 * схлопывается, и в кадре остаются висящие обломки. У камня (метр-три,
 * бесформенная глыба) это сходит с рук, у растения с тонким стволом —
 * нет.
 *
 * Поэтому всё поле считается относительно своего центра, как город
 * (js/gl/citymesh.js): координаты в пределах километра, точность
 * float32 там — сотые доли миллиметра. Центр поля возвращается в
 * result.origin (км, оси тела), и сцена ставит по нему матрицу.
 */
export function floraBuilder(body, plants, sun = null, center = null, detail = null) {
  const terrain = terrainOf(body);
  const R = body.radius;
  // Центр поля: точка на грунте, от которой считается вся геометрия.
  const c = center || (plants.length ? plants[0].dir : { x: 1, y: 0, z: 0 });
  const ch = 1 + terrain.displace(c.x, c.y, c.z, detail);
  const ox = c.x * ch, oy = c.y * ch, oz = c.z * ch;
  const n = plants.length;
  const total = countFaces(plants) * 3;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 4);
  const indices = new Uint32Array(total);
  const ground = [0, 0, 0];
  const col = [0, 0, 0];
  let o = 0;
  let at = 0;
  let result = null;

  const put = (px, py, pz, nx, ny, nz, cr, cg, cb) => {
    positions[o * 3] = (px - ox) * R;
    positions[o * 3 + 1] = (py - oy) * R;
    positions[o * 3 + 2] = (pz - oz) * R;
    normals[o * 3] = nx; normals[o * 3 + 1] = ny; normals[o * 3 + 2] = nz;
    colors[o * 4] = cr; colors[o * 4 + 1] = cg; colors[o * 4 + 2] = cb;
    colors[o * 4 + 3] = 1;
    indices[o] = o;
    o++;
  };

  /**
   * Тень растения — пятно на грунте под кроной, чуть сдвинутое от солнца.
   *
   * Родня тени камня (js/gl/rocks.js), но с одним важным отличием, и
   * оно стоило снимка. У камня тень честно вытянута по высоте солнца:
   * камень в метр даёт на закате полосу в четыре, и полоса эта ложится
   * на грунт, потому что четыре метра грунта — это плоскость.
   *
   * У дерева высота пятнадцать метров, и та же арифметика даёт полосу в
   * шестьдесят. А шестьдесят метров склона — уже не плоскость: тень,
   * нарисованная одним плоским многоугольником на высоте своего
   * дерева, на склоне отрывается от земли и висит в воздухе бурой
   * плитой. На первом же снимке их было полсотни.
   *
   * Чинить это честно — значит сажать каждую вершину тени на свою
   * высоту грунта, то есть восемь лишних выборок рельефа на растение
   * (втрое дороже всей сборки). Вместо этого тень ограничена размером
   * кроны: пятно в полтора её поперечника от ствола прилегает к склону
   * с точностью до метра, а глазу нужно ровно одно — чтобы дерево
   * стояло на земле, а не парило над ней.
   */
  const shadow = (d, h, tx, ty, tz, bx, by, bz, tall, wide) => {
    if (!sun) return;
    const e = sun.x * d.x + sun.y * d.y + sun.z * d.z;
    if (e < FLORA.shadowMin) return;
    let ax = -(sun.x - d.x * e), ay = -(sun.y - d.y * e), az = -(sun.z - d.z * e);
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    const len = Math.min(tall * Math.sqrt(Math.max(0, 1 - e * e)) / e,
      wide * FLORA.shadowMax);
    const au = ax * tx + ay * ty + az * tz;
    const av = ax * bx + ay * by + az * bz;
    const lift = h + FLORA.shadowLift / R;
    const cu = au * len * 0.5, cv = av * len * 0.5;
    const dark = [ground[0] * FLORA.shadowDark, ground[1] * FLORA.shadowDark,
      ground[2] * FLORA.shadowDark];
    const half = len * 0.5 + wide;
    const at2 = (u, v) => put(
      d.x * lift + tx * u + bx * v,
      d.y * lift + ty * u + by * v,
      d.z * lift + tz * u + bz * v,
      d.x, d.y, d.z, dark[0], dark[1], dark[2]);
    for (let k = 0; k < SHADOW_SIDES; k++) {
      const a0 = (k / SHADOW_SIDES) * Math.PI * 2;
      const a1 = ((k + 1) / SHADOW_SIDES) * Math.PI * 2;
      const p0u = cu + Math.cos(a0) * half * au - Math.sin(a0) * wide * av;
      const p0v = cv + Math.cos(a0) * half * av + Math.sin(a0) * wide * au;
      const p1u = cu + Math.cos(a1) * half * au - Math.sin(a1) * wide * av;
      const p1v = cv + Math.cos(a1) * half * av + Math.sin(a1) * wide * au;
      at2(cu, cv); at2(p0u, p0v); at2(p1u, p1v);
    }
  };

  const one = (pl) => {
    const d = pl.dir;
    // Высота грунта под растением — с ТОЙ ЖЕ детализацией, с какой
    // грунт РИСУЕТСЯ (см. js/gl/rocks.js, там то же и по той же
    // причине): дерево обязано стоять на земле, а не парить над ней.
    const h = 1 + terrain.displace(d.x, d.y, d.z, detail);
    terrain.color(d.x, d.y, d.z, ground, detail);

    // Касательные оси в точке растения.
    const helper = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    let tx = helper.y * d.z - helper.z * d.y;
    let ty = helper.z * d.x - helper.x * d.z;
    let tz = helper.x * d.y - helper.y * d.x;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const bx = d.y * tz - d.z * ty;
    const by = d.z * tx - d.x * tz;
    const bz = d.x * ty - d.y * tx;

    const cs = Math.cos(pl.spin), sn = Math.sin(pl.spin);
    const part = pl.model;
    // Модель хранится в тысячных ВЫСОТЫ: множитель переводит её сразу в
    // единичный радиус тела.
    const sz = (pl.height / 1000) / R;
    const verts = part.verts;
    const pal = part.pal;
    // Наклон: ось растения чуть уводится от местной вертикали.
    const lean = pl.tilt;

    const place = (vi, out3) => {
      const vx = verts[vi * 3] * sz, vy = verts[vi * 3 + 1] * sz, vz = verts[vi * 3 + 2] * sz;
      const px = vx * cs - vz * sn;
      const pz = vx * sn + vz * cs;
      // Утоплено на сотую высоты: иначе на склоне видно, что модель
      // приложена к земле плоским дном.
      const py = vy - sz * 10;
      const lu = px + lean * py, lv = pz - lean * py;
      out3[0] = d.x * (h + py) + tx * lu + bx * lv;
      out3[1] = d.y * (h + py) + ty * lu + by * lv;
      out3[2] = d.z * (h + py) + tz * lu + bz * lv;
      return out3;
    };

    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    const src = part.faces;
    for (let i = 0; i < src.length;) {
      const cnt = src[i];
      const ci = src[i + cnt + 1];
      const role = pal[ci * 4 + 3];
      tintOf(role, ground, [pal[ci * 4], pal[ci * 4 + 1], pal[ci * 4 + 2]], col);
      place(src[i + 1], a);
      for (let k = 2; k <= cnt - 1; k++) {
        place(src[i + k], b);
        place(src[i + k + 1], c);
        // Плоское затенение: нормаль на грань, как у всех моделей здесь.
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        // Грань чуть светлее или темнее соседней: у кроны нет двух
        // одинаковых пятен, и без этого дерево выходит литым.
        const jit = 0.88 + ((nx * 11.3 + nz * 6.1) % 1 + 1) % 1 * 0.24;
        const cr = col[0] * jit, cg = col[1] * jit, cb = col[2] * jit;
        put(a[0], a[1], a[2], nx, ny, nz, cr, cg, cb);
        put(b[0], b[1], b[2], nx, ny, nz, cr, cg, cb);
        put(c[0], c[1], c[2], nx, ny, nz, cr, cg, cb);
      }
      i += cnt + 2;
    }

    // Тень: по высоте растения и ширине его кроны.
    shadow(d, h, tx, ty, tz, bx, by, bz, sz * 1000, sz * part.size[0] * 0.5);
  };

  return {
    total: n,
    get done() { return at >= n; },
    step(count = FLORA.chunk) {
      const end = Math.min(n, at + count);
      for (; at < end; at++) one(plants[at]);
      if (at < n) return false;
      result = { positions, normals, colors, indices, faces: o / 3, count: n,
        origin: { x: ox * R, y: oy * R, z: oz * R } };
      return true;
    },
    get result() { return result; },
  };
}

/** Поле целиком, одним заходом. Этим пользуются проверки. */
export function buildFloraGeometry(body, plants, sun = null, center = null, detail = null) {
  const b = floraBuilder(body, plants, sun, center, detail);
  while (!b.step(1e9)) { /* один заход */ }
  return b.result;
}

/**
 * Поле растительности вокруг камеры: следит за телом и высотой,
 * пересобирается только когда камера ушла с прежнего места.
 *
 * Устроено как поле камней и по той же причине: пока новая сборка идёт,
 * рисуется прежнее поле, поэтому переезд не мигает голой землёй.
 */
export class FloraField {
  constructor(gl, locs) {
    this.gl = gl;
    this.locs = locs;
    this.mesh = null;
    this.body = null;
    this.center = null;
    // Начало координат поля в осях тела, км: по нему сцена ставит
    // матрицу (см. floraBuilder — геометрия считается от него).
    this.origin = { x: 0, y: 0, z: 0 };
    this.cell = 0;          // ячейка грунта, на которую уложено поле
    this.alt = 0;
    this.count = 0;
    this.builds = 0;
    this.job = null;
  }

  /**
   * @param body тело под кораблём (null — поля нет)
   * @param dir  направление на точку под камерой, локальные оси тела
   * @param alt  высота камеры над поверхностью, км
   * @returns меш поля или null
   */
  /**
   * @param cell угловой размер ячейки сетки, которой рисуется грунт
   */
  update(body, dir, alt, sun = null, cell = 0) {
    const top = FLORA.layers[0].maxAlt;
    if (!body || !dir || !(alt >= 0) || alt > top || terrainOf(body).isFlat
        || !terrainOf(body).hasFlora) {
      this.clear();
      return null;
    }
    // Порог переезда считается по САМОМУ КРУПНОМУ ярусу: он же и самый
    // широкий. Мелкие ярусы при этом пересобираются чаще, чем надо им
    // самим, но они и дешевле — а два независимых поля означали бы два
    // меша и два вызова отрисовки на каждый кадр.
    const radius = FLORA.layers[0].radiusOf(alt);
    if (!this.job) {
      const moved = !this.center || this.body !== body
        // Сменилась подробность нарисованного грунта — поле надо
        // переложить: оно стоит на ней, а не на «полной» высоте.
        || (cell > 0 && Math.abs(cell - this.cell) > this.cell * 0.2)
        || Math.acos(Math.max(-1, Math.min(1,
          dir.x * this.center.x + dir.y * this.center.y + dir.z * this.center.z)))
          * body.radius > radius * 0.3
        // Смена яруса — тоже повод: на спуске под сто метров в поле
        // должна появиться трава, которой там не было.
        || this.crossedLayer(alt);
      if (moved) {
        this.job = {
          body,
          center: { x: dir.x, y: dir.y, z: dir.z },
          alt,
          cell,
          builder: floraBuilder(body, scatterFlora(body, dir, alt), sun, dir,
            cell > 0 ? terrainOf(body).detailForCell(cell) : null),
        };
      }
    }

    if (this.job && this.job.builder.step(FLORA.chunk)) {
      const geo = this.job.builder.result;
      this.release();
      this.mesh = geo.faces > 0 ? buildIndexedMesh(this.gl, this.locs, geo) : null;
      if (this.mesh) this.mesh.faces = geo.faces;
      this.origin = geo.origin;
      this.cell = this.job.cell;
      this.body = this.job.body;
      this.center = this.job.center;
      this.alt = this.job.alt;
      this.count = geo.count;
      this.builds++;
      this.job = null;
    }
    return this.mesh;
  }

  /** Сменился ли набор ярусов или заметно ли изменился их размах. */
  crossedLayer(alt) {
    for (const L of FLORA.layers) {
      if ((alt > L.maxAlt) !== (this.alt > L.maxAlt)) return true;
    }
    const a = FLORA.layers[0].radiusOf(alt);
    const b = FLORA.layers[0].radiusOf(this.alt);
    return Math.abs(a - b) > b * 0.4;
  }

  release() {
    if (this.mesh && this.mesh.dispose) this.mesh.dispose();
    this.mesh = null;
  }

  clear() {
    this.release();
    this.body = null;
    this.center = null;
    this.count = 0;
    this.job = null;
  }
}
