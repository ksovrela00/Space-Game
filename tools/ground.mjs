// Перегон фотограмметрии грунта в две маленькие текстуры движка.
//
// Запуск: npm run ground        node tools/ground.mjs --list
//
// Зачем это вообще нужно. Процедурный рельеф (js/gl/terrain.js) считается
// от направления, а направление в шейдере — float32: у единицы шаг 6e-8,
// то есть на планете в четыре тысячи километров соседние различимые точки
// стоят в четверти метра. Отсюда предел DETAIL_MIN_SCALE = 5e-6 рад — на
// Lave II это 21 метр: НИЖЕ ДВУХ ДЕСЯТКОВ МЕТРОВ У ГРУНТА НЕТ НИЧЕГО.
// С орбиты это неважно, а с восьмидесяти метров под кораблём лежит
// гладкая крашеная плоскость —
// и никакими октавами шума это не лечится, предел не в их числе.
//
// Фотография этот предел обходит: она повторяется. Её координата
// считается не от центра планеты, а от угла плитки (js/gl/ground.js), и
// точности хватает на сантиметры.
//
// Берётся ДВА масштаба — они и в исходниках разные, это не подгонка:
//
//   * rocks_ground_05  — три метра снятого грунта: гравий, трещины,
//     камешки. Даёт зерно под ногами;
//   * rocky_terrain_02 — девяносто метров с дрона: валуны, проплешины,
//     кусты. Даёт пятна цвета на посадочной площадке.
//
// Что из них берётся и что ВЫБРАСЫВАЕТСЯ:
//
//   * зерно (grain.png) — нормаль и тон. Цвет выброшен: у трёхметрового
//     куска он почти серый (разброс по каналам 0.07/0.02/0.10), а
//     землистый оттенок принадлежит Земле, и на ледяном мире он не
//     нужен;
//   * пятна (tint.png) — только ЦВЕТ, поделённый на собственный средний.
//     Яркость аэрофото выброшена вместе с чужим солнцем: в ней тени от
//     валунов, снятые под своим углом, а в игре солнце ходит само.
//
// То же правило, что у растительности (CREDITS.md): геометрия и узор —
// авторские, цвет задаёт мир, на котором это лежит.
//
// Физический размер снятого куска берётся НЕ НА ГЛАЗ: Poly Haven отдаёт
// его в своём API (поле dimensions, миллиметры), и сверка с константами
// движка обязательна — разъедутся, и зерно на грунте станет размером с
// дом, а заметить это можно будет только глазами.

import { mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { decodePng } from './ship.mjs';
import { GROUND } from '../js/gl/ground.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Исходники весят двенадцать мегабайт и КЭШИРУЮТСЯ во временной папке,
// а не в репозитории: в него ложатся только две картинки по паре сотен
// килобайт. Освободить место: node tools/ground.mjs --clean
const TMP = join(tmpdir(), 'space-game-ground');
const API = 'https://api.polyhaven.com';
const SIZE = '1k';               // 4k здесь незачем: на выходе 256 пикселей

const SRC = {
  grain: {
    slug: 'rocks_ground_05',
    author: 'Rob Tuytel',
    maps: ['Diffuse', 'nor_gl', 'Displacement'],
  },
  tint: {
    slug: 'rocky_terrain_02',
    author: 'Amal Kumar',
    maps: ['Diffuse'],
  },
};

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
const page = (slug) => `https://polyhaven.com/a/${slug}`;

// --- запись PNG (8 бит, RGB, фильтр 0) --------------------------------------
// Читать PNG умеет tools/ship.mjs, писать до сих пор не приходилось
// никому. Тридцать строк против зависимости — выбор очевидный.
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(tag, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(tag, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** @param px байты RGB, w*h*3 */
function encodePng(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;                 // 8 бит, RGB
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;              // фильтр «как есть»
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- скачивание --------------------------------------------------------------
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function grab(slug, map) {
  const files = await fetchJson(`${API}/files/${slug}`);
  const f = files[map] && files[map][SIZE] && files[map][SIZE].png;
  if (!f) throw new Error(`${slug}: нет карты ${map} в PNG (${SIZE})`);
  const name = f.url.split('/').pop();
  const path = join(TMP, name);
  if (!(await exists(path))) {
    process.stdout.write(`  качаю ${name} (${(f.size / 1048576).toFixed(1)} МБ)\n`);
    const buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
    await mkdir(TMP, { recursive: true });
    await writeFile(path, buf);
  }
  return decodePng(await readFile(path));
}

// --- работа с картинками -----------------------------------------------------

/** Канал картинки как Float64Array в 0..1. */
function channel(img, c) {
  const n = img.w * img.h;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = img.px[i * img.bpp + Math.min(c, img.bpp - 1)] / 255;
  return out;
}

// sRGB и линейный свет. Усреднять цвет надо в линейном — иначе
// уменьшение в четыре раза само по себе темнит картинку.
const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** Уменьшение в целое число раз усреднением квадрата. */
function shrink(src, w, out, lin = false) {
  const k = w / out;
  if (!Number.isInteger(k)) throw new Error(`${w} не делится на ${out}`);
  const dst = new Float64Array(out * out);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      let s = 0;
      for (let j = 0; j < k; j++) {
        for (let i = 0; i < k; i++) {
          const v = src[(y * k + j) * w + x * k + i];
          s += lin ? toLin(v) : v;
        }
      }
      s /= k * k;
      dst[y * out + x] = lin ? toSrgb(s) : s;
    }
  }
  return dst;
}

/**
 * Низкие частоты картинки: среднее по клеткам, размазанное обратно
 * билинейно и ПО КРУГУ (плитка бесшовная, и её низ должен сходиться с
 * верхом — иначе вычет сам нарисует шов).
 */
function lowPass(a, n, cells) {
  const k = n / cells;
  if (!Number.isInteger(k)) throw new Error(`${n} не делится на ${cells}`);
  const c = new Float64Array(cells * cells);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      c[((y / k) | 0) * cells + ((x / k) | 0)] += a[y * n + x] / (k * k);
    }
  }
  const out = new Float64Array(n * n);
  const wrap = (i) => (i % cells + cells) % cells;
  for (let y = 0; y < n; y++) {
    const fy = y / k - 0.5, iy = Math.floor(fy), ty = fy - iy;
    for (let x = 0; x < n; x++) {
      const fx = x / k - 0.5, ix = Math.floor(fx), tx = fx - ix;
      const x0 = wrap(ix), x1 = wrap(ix + 1), y0 = wrap(iy), y1 = wrap(iy + 1);
      const top = c[y0 * cells + x0] * (1 - tx) + c[y0 * cells + x1] * tx;
      const bot = c[y1 * cells + x0] * (1 - tx) + c[y1 * cells + x1] * tx;
      out[y * n + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const std = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

/**
 * Шов на склейке против обычной разницы соседей. Число больше единицы
 * значит, что стык картинки с самой собой заметнее, чем её собственная
 * зернистость, — то есть плитка НЕ бесшовная, и узор пойдёт решёткой.
 */
function seam(chans, n) {
  const d2 = (ia, ib) => chans.reduce((s, c) => s + (c[ia] - c[ib]) ** 2, 0);
  let sx = 0, sy = 0, inx = 0, iny = 0;
  for (let i = 0; i < n; i++) {
    sx += d2(i * n, i * n + n - 1);
    sy += d2(i, (n - 1) * n + i);
    inx += d2(i * n, i * n + 1);
    iny += d2(i, n + i);
  }
  return Math.sqrt((sx + sy) / (inx + iny));
}

// --- сборка ------------------------------------------------------------------

/**
 * Зерно: нормаль (R, G) и тон (B).
 *
 * Знак зелёного канала НЕ УГАДЫВАЕТСЯ. У нормали и высоты один
 * источник, и они обязаны сходиться: n.xy ~ -grad(h). Знак берётся из
 * сравнения с картой высот, и совпадение печатается числом. Ошибись
 * здесь — и камешки вывернутся ямками, а понять это можно было бы
 * только глазами и только при косом солнце.
 */
async function buildGrain(cfg, out) {
  const diff = await grab(cfg.slug, 'Diffuse');
  const nor = await grab(cfg.slug, 'nor_gl');
  const disp = await grab(cfg.slug, 'Displacement');
  const w = diff.w;
  if (nor.w !== w || disp.w !== w) throw new Error('карты разного размера');

  // Нормаль: усредняем как ВЕКТОРЫ и нормируем — так уменьшение честно
  // сглаживает наклон, а не смешивает байты.
  const nx = shrink(channel(nor, 0), w, out).map((v) => v * 2 - 1);
  const ny = shrink(channel(nor, 1), w, out).map((v) => v * 2 - 1);

  // Сверка знака с высотой. У склона нормаль наклонена ВНИЗ по уклону:
  // n.xy ~ -grad(h). Значит согласие проверяется корреляцией -grad(h) с
  // тем, что лежит в каналах, и она обязана быть положительной по обеим
  // осям.
  const h = shrink(channel(disp, 0), w, out);
  const corr = (comp, dy) => {
    let s = 0, a = 0, b = 0;
    for (let y = 1; y < out - 1; y++) {
      for (let x = 1; x < out - 1; x++) {
        const i = y * out + x;
        const g = dy ? (h[i + out] - h[i - out]) / 2 : (h[i + 1] - h[i - 1]) / 2;
        s += -g * comp[i]; a += g * g; b += comp[i] * comp[i];
      }
    }
    return s / Math.sqrt(a * b);
  };
  const tilt = [mean(nx), mean(ny)];
  const cx = corr(nx, false);
  // Ось v текстуры при выборке идёт СВЕРХУ ВНИЗ (строка 0 лежит при
  // t = 0), а зелёный канал в соглашении OpenGL смотрит вверх по
  // картинке — то есть против неё.
  const flipY = corr(ny, true) < 0;
  if (flipY) for (let i = 0; i < ny.length; i++) ny[i] = -ny[i];
  const cy = corr(ny, true);
  if (cx < 0.2 || cy < 0.2) {
    throw new Error(`нормаль не сходится с высотой (${cx.toFixed(2)}, ${cy.toFixed(2)}): ` +
      'камешки выйдут ямками');
  }

  // Тон: яркость цвета, поделённая на собственную среднюю. Делится в том
  // же виде, в каком движок множит цвета (он не разгибает гамму нигде),
  // поэтому и здесь без линеаризации.
  const r = shrink(channel(diff, 0), w, out, true);
  const g = shrink(channel(diff, 1), w, out, true);
  const b = shrink(channel(diff, 2), w, out, true);
  const lum = r.map((v, i) => 0.299 * v + 0.587 * g[i] + 0.114 * b[i]);
  const lm = mean(lum);
  const tone = lum.map((v) => v / lm);

  // ОТРЕЗАНИЕ НИЗКИХ ЧАСТОТ — главное, что делает эта функция.
  //
  // Фотография укладывается через три метра, и вместе с ней
  // повторяются её крупные пятна: с восьмидесяти метров грунт вышел
  // ровной косой решёткой на всю землю. Меряется это верхними
  // мип-уровнями (вдали выборка уходит именно туда): в среднем по
  // клетке 37 см у тона оставалось 62% всего размаха — то есть почти
  // весь рисунок был КРУПНЫМ.
  //
  // Поэтому у каждого канала вычитается его собственная размытая копия.
  // Остаётся крошка мельче 37 см: у неё нет узнаваемой формы, повтор на
  // ней не читается, а вдали она честно усредняется в ничто.
  //
  // Заодно это убирает и общий уклон куска (постоянная составляющая —
  // тоже низкая частота): фотограф стоял на склоне, и без вычета всякая
  // поверхность в игре получила бы наклон в одну сторону.
  const cells = GROUND.grain.low;
  const was = [std(nx), std(ny), std(tone)];
  for (const a of [nx, ny]) {
    const low = lowPass(a, out, cells);
    for (let i = 0; i < a.length; i++) a[i] -= low[i];
  }
  {
    const low = lowPass(tone, out, cells);
    for (let i = 0; i < tone.length; i++) tone[i] += 1 - low[i];
  }

  const px = Buffer.alloc(out * out * 3);
  for (let i = 0; i < out * out; i++) {
    px[i * 3] = byte(clamp01(nx[i] * 0.5 + 0.5));
    px[i * 3 + 1] = byte(clamp01(ny[i] * 0.5 + 0.5));
    px[i * 3 + 2] = byte(clamp01(tone[i] * 0.5));      // 1.0 -> 128
  }
  const slope = Math.sqrt(mean(nx.map((v, i) => v * v + ny[i] * ny[i])));
  return {
    px,
    report: [
      `нормаль: зелёный канал ${flipY ? 'перевёрнут' : 'как есть'},` +
      ` согласие с высотой ${cx.toFixed(2)} вдоль u и ${cy.toFixed(2)} вдоль v,` +
      ` свой уклон куска ${(Math.hypot(...tilt) * 100).toFixed(1)}%`,
      `крупнее ${(cfg.sizeM / cells * 100).toFixed(0)} см вырезано: наклон` +
      ` ${(Math.atan(slope) * 180 / Math.PI).toFixed(1)}° вместо` +
      ` ${(Math.atan(Math.hypot(was[0], was[1])) * 180 / Math.PI).toFixed(1)}°,` +
      ` разброс тона ${std(tone).toFixed(2)} вместо ${was[2].toFixed(2)}`,
      `шов: ${seam([nx, ny, tone], out).toFixed(2)} от обычной разницы соседей`,
    ],
  };
}

/**
 * Пятна: ТОЛЬКО ЦВЕТ. Каждый тексель делится на собственную яркость,
 * потом всё поле — на свой средний цвет.
 *
 * Первое выбрасывает яркость: в аэрофото она наполовину состоит из
 * теней валунов, снятых при своём солнце, а в игре солнце ходит само, и
 * приклеенная тень поехала бы вместе с ним. Второе выбрасывает общий
 * оттенок: он земной (оливковый, 80/79/29), а красить мир должен сам
 * мир.
 *
 * Делить надо в том виде, в каком движок множит цвета (гамму он нигде
 * не разгибает). В линейном свете то же деление даёт хвост до двадцати
 * крат: там среднее задирают несколько ярких камней, и половина
 * картинки уезжает в клип.
 */
async function buildTint(cfg, out) {
  const diff = await grab(cfg.slug, 'Diffuse');
  const ch = [0, 1, 2].map((c) => shrink(channel(diff, c), diff.w, out, true));
  const lum = ch[0].map((v, i) => 0.299 * v + 0.587 * ch[1][i] + 0.114 * ch[2][i]);
  const rel = ch.map((a) => a.map((v, i) => v / Math.max(lum[i], 1e-6)));
  const m = rel.map(mean);
  rel.forEach((a, c) => { for (let i = 0; i < a.length; i++) a[i] /= m[c]; });

  let clip = 0;
  const px = Buffer.alloc(out * out * 3);
  for (let i = 0; i < out * out; i++) {
    for (let c = 0; c < 3; c++) {
      if (rel[c][i] > 2) clip++;
      px[i * 3 + c] = byte(clamp01(rel[c][i] * 0.5));
    }
  }
  const mc = [0, 1, 2].map((c) => mean(ch[c]) * 255);
  return {
    px,
    report: [
      `средний цвет исходника ${mc.map((v) => v.toFixed(0)).join('/')} и вся яркость выброшены,` +
      ` остался разброс цвета ${rel.map((a) => std(a).toFixed(2)).join('/')}`,
      `в клип ушло ${(clip / (out * out * 3) * 100).toFixed(2)}% отсчётов`,
      `шов: ${seam(rel, out).toFixed(2)} от обычной разницы соседей`,
    ],
  };
}

// --- запуск ------------------------------------------------------------------

if (process.argv.includes('--clean')) {
  await rm(TMP, { recursive: true, force: true });
  console.log(`удалено: ${TMP}`);
} else if (process.argv.includes('--list')) {
  for (const [key, cfg] of Object.entries(SRC)) {
    const info = await fetchJson(`${API}/info/${cfg.slug}`);
    console.log(`${key.padEnd(6)} ${cfg.slug.padEnd(18)} ${info.dimensions[0] / 1000} м` +
      `  ${cfg.author}  CC0  ${page(cfg.slug)}`);
  }
} else {
  const lines = [];
  for (const [key, cfg] of Object.entries(SRC)) {
    const want = GROUND[key];
    if (!want) throw new Error(`в js/gl/ground.js нет слоя ${key}`);
    console.log(`${key}: ${cfg.slug}`);
    const info = await fetchJson(`${API}/info/${cfg.slug}`);
    const sizeKm = info.dimensions[0] / 1e6;
    if (info.dimensions[0] !== info.dimensions[1]) {
      throw new Error(`${cfg.slug}: кусок не квадратный (${info.dimensions})`);
    }
    if (Math.abs(sizeKm - want.sizeKm) > 1e-9) {
      throw new Error(`${cfg.slug}: снятый кусок ${sizeKm * 1000} м, ` +
        `а в js/gl/ground.js записано ${want.sizeKm * 1000} м`);
    }
    // Сколько пикселей на выходе — в js/gl/ground.js, рядом с размером
    // снятого куска: движок и перегон обязаны знать это одинаково.
    //
    // У пятен их вдвое меньше, чем у зерна, и это не экономия. Тексель
    // 256-й картинки на девяносто метров — это треть метра, то есть
    // отдельные камни и кусты аэрофото. В кадре они легли сыпью
    // фиолетовых точек и повторялись видимой решёткой: пятнам нужен
    // масштаб десятков метров, а мельче — не подробность, а мусор.
    const out = want.px;
    cfg.sizeM = sizeKm * 1000;
    const built = key === 'grain'
      ? await buildGrain(cfg, out)
      : await buildTint(cfg, out);
    const png = encodePng(out, out, built.px);
    const path = join(ROOT, want.file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, png);
    for (const r of built.report) console.log(`  ${r}`);
    console.log(`  ${want.file}: ${out}×${out}, ${(png.length / 1024).toFixed(0)} КБ,` +
      ` кусок ${sizeKm * 1000} м`);
    lines.push(`${key}: ${(png.length / 1024).toFixed(0)} КБ`);
  }
  console.log(`готово — ${lines.join(', ')}`);
}
