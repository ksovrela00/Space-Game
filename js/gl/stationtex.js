// Фактуры станции: фотограмметрия CC0 на полах, стенах и мебели зала и
// терминала.
//
// ЗАЧЕМ. Помещения корабля собраны из стилизованного пака (плоские цвета,
// низкая детализация) — на корабле так и задумано. А на станции пилот
// ходит пешком по бетону ангара, терраццо конкорса, паркету бара: ровная
// заливка там читалась мультфильмом. Здесь — снятые фотографии настоящих
// материалов (Poly Haven, CC0): по ним видно и шов плитки, и зерно бетона,
// и рисунок паркета.
//
// КАК. Грань сетки зала несёт номер материала (aMat, js/models/stationhall.js)
// от STMAT_BASE и выше; шейдер сеток (js/gl/shaders.js, stationDetail)
// берёт слой массива текстур по номеру и кладёт его по трём осям станции
// (у полов — по x и z, у стен — по своей плоскости), в метрах, с размером
// снятого куска из API Poly Haven. Цвет вершины — оттенок: фотография
// хранится поделённой на свою среднюю яркость, и средняя яркость грани
// остаётся той, что задана палитрой, а фотография даёт рисунок и свой цвет
// (дерево — коричневое, терраццо — с крошкой).
//
// Крупные пятна из фотографий вычтены (tools/stationtex.mjs): кусок в два
// метра укладывается по полу зала в восемьсот, и пятно, повторённое
// четыреста раз, читалось бы решёткой.
//
// Собирает файл tools/stationtex.mjs (npm run stationtex); он же сверяет
// размеры кусков с API.

/** Номер первого материала станции в aMat: ниже — материалы обшивки корабля. */
export const STMAT_BASE = 20;

/**
 * Слои массива: ключ, фотография на Poly Haven, размер снятого куска (м)
 * и сколько своего цвета у фотографии оставить (sat): у бетона, резины,
 * штукатурки и металла цвет — от палитры, а от фотографии только рисунок
 * (ржавчина рифлёного листа иначе красила бы пульты в зелень); у дерева,
 * паркета, кожи и терраццо цвет — сам материал. Порядок — номер слоя;
 * менять его — значит пересобрать файл.
 */
export const STATION_LAYERS = [
  { key: 'concrete', slug: 'hangar_concrete_floor', sizeM: 2.0, sat: 0 },   // пол зала и перрона
  { key: 'terrazzo', slug: 'terrazzo_tiles', sizeM: 2.0, sat: 0.3 },          // пол конкорса
  { key: 'tiles', slug: 'interior_tiles', sizeM: 1.9, sat: 0.6 },             // полы служб и лавок
  { key: 'rubber', slug: 'rubber_tiles', sizeM: 2.0, sat: 0 },              // пол залов ожидания
  { key: 'parquet', slug: 'herringbone_parquet', sizeM: 3.4, sat: 0.9 },      // пол бара
  { key: 'wood', slug: 'wooden_panels', sizeM: 2.1, sat: 0.35 },               // стены бара, стойки
  { key: 'panels', slug: 'concrete_panels', sizeM: 8.0, sat: 0 },           // стены зала и корпус терминала
  { key: 'wall', slug: 'plastered_wall_02', sizeM: 2.23, sat: 0 },          // стены и потолки помещений
  { key: 'leather', slug: 'fabric_leather_01', sizeM: 0.4, sat: 0.7 },        // кресла, табуреты
  { key: 'tread', slug: 'metal_plate', sizeM: 0.5, sat: 0 },                // рифлёный металл: кромки, ступени, пульты
];

/** Номер материала (aMat) по ключу: STMAT.concrete и т. д. */
export const STMAT = Object.fromEntries(STATION_LAYERS.map((l, i) => [l.key, STMAT_BASE + i]));

/** Файл массива: слои сверху вниз, каждый px × px, RGB. */
export const STATION_TEX = { file: 'assets/texture/station.png', px: 512, unit: 8 };

/**
 * Кусок шейдера сеток: материал станции по номеру aMat. p — точка в осях
 * станции (м), nl — нормаль там же; albedo умножается на фотографию.
 */
export const STATION_GLSL = `
uniform mediump sampler2DArray uStationTex;
uniform float uStationK[${STATION_LAYERS.length}];   // 1 / размер куска, 1/м

// floorM — пол зала (м, оси станции), или −1e9, если станции рядом нет.
void stationDetail(vec3 p, vec3 nl, float floorM, inout vec3 albedo) {
  int layer = int(vMat - ${STMAT_BASE}.0 + 0.5);
  if (layer < 0 || layer >= ${STATION_LAYERS.length}) return;
  float k = uStationK[layer];
  vec3 a = abs(nl);
  // Плоскость по преобладающей оси нормали: у пола — x и z, у стены — её
  // собственная. Стены и полы зала все по осям станции, и шов фотографии
  // не ломается на рёбрах.
  vec2 uv = a.y > max(a.x, a.z) ? p.xz : (a.x > a.z ? p.zy : p.xy);
  vec3 ph = texture(uStationTex, vec3(uv * k, float(layer))).rgb * 2.0;
  albedo *= ph;
  // Низ стены темнее: свет потолка до угла у пола доходит хуже (то, что
  // в настоящем помещении делает рассеяние между стеной и полом). Без
  // этого стена стоит на полу, как картонка, приставленная к нему.
  if (a.y < 0.5) albedo *= mix(0.7, 1.0, smoothstep(0.0, 0.9, p.y - floorM));
}
`;

// --- загрузка ---------------------------------------------------------------------------

/**
 * Массив фактур на блоке STATION_TEX.unit. Возвращается сразу —
 * нейтральным (серый 128 во всех слоях: фотография «единица», грань как
 * есть), а картинка встаёт, когда придёт. Вне браузера (проверки в node)
 * так нейтральным и остаётся.
 */
export function loadStationTex(gl, load = defaultLoad) {
  const n = STATION_LAYERS.length;
  const tex = gl.createTexture();
  const out = { tex, ready: false, failed: false };
  gl.activeTexture(gl.TEXTURE0 + STATION_TEX.unit);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, 1, 1, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4 * n).fill(128));
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.activeTexture(gl.TEXTURE0);
  load(STATION_TEX.file, (img) => {
    gl.activeTexture(gl.TEXTURE0 + STATION_TEX.unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // Картинка — слои один под другим: высота слоя — px, слоёв — n.
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, STATION_TEX.px, STATION_TEX.px, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    // Пол под ногами виден под скользящим углом: без анизотропии плитка в
    // пяти метрах уже мылится в серое.
    const an = gl.getExtension && gl.getExtension('EXT_texture_filter_anisotropic');
    if (an) {
      const max = gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
      gl.texParameterf(gl.TEXTURE_2D_ARRAY, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
    gl.activeTexture(gl.TEXTURE0);
    out.ready = true;
  }, () => { out.failed = true; });
  return out;
}

/** Обратные размеры кусков для шейдера (uStationK), 1/м. */
export const stationK = () => new Float32Array(STATION_LAYERS.map((l) => 1 / l.sizeM));

/** Обычная загрузка картинки — с меткой сборки, как у фотографии грунта. */
function defaultLoad(src, on, fail) {
  if (typeof Image === 'undefined') { fail(); return; }
  const img = new Image();
  img.onload = () => on(img);
  img.onerror = fail;
  const v = typeof window !== 'undefined' && window.__srcStamp;
  img.src = v ? `${src}?v=${v}` : src;
}
