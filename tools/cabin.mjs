// Перегон CC0-фотографии краски в текстуру обшивки кабины.
//
// Запуск: npm run cabin         node tools/cabin.mjs --list | --clean
//
// ЗАЧЕМ. Кабина — единственное место в игре, которое глаз видит в
// метре от себя, и на таком расстоянии ровная заливка выдаёт себя
// сразу: у настоящей краски на приборной доске есть потёртости у кромок,
// царапины, следы рук и полуматовый блеск, который гуляет пятнами. В
// процедурном шуме всего этого нет — есть «шум», и глаз читает его
// именно так. Поэтому берётся снятая фотограмметрия: Poly Haven,
// «Blue Metal Plate» (Rob Tuytel, CC0) — крашеная сталь с царапинами,
// потёртостями и следами абразива, два с половиной метра куском.
//
// Кусок в 2.5 метра — это вся кабина разом: повтора в ней просто нет.
//
// Что берётся и что ВЫБРАСЫВАЕТСЯ — по тому же правилу, что у грунта
// (tools/ground.mjs, CREDITS.md): узор авторский, цвет задаёт игра.
//
//   * R, G — нормаль: царапины и вмятины ловят свет, как настоящие;
//   * B    — тон: яркость фотографии, поделённая на свою среднюю.
//            Синева краски выброшена: кабина крашена в тон корабля;
//   * A    — блеск: единица минус шероховатость. Там, где краска стёрта
//            до металла, он выше, и блик ложится именно по потёртостям.
//
// Физический размер куска берётся из API Poly Haven (поле dimensions) и
// сверяется с движком (js/gl/cabin.js, CABIN_TEX): разъедутся — и
// царапины на доске станут размером с ладонь.

import { mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { decodePng } from './ship.mjs';
import { CABIN_TEX } from '../js/gl/cabin.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Исходники (около десяти мегабайт) кэшируются во временной папке, в
// репозиторий ложится одна картинка.
const TMP = join(tmpdir(), 'space-game-cabin');
const API = 'https://api.polyhaven.com';
const SIZE = '1k';

const SRC = { slug: 'blue_metal_plate', author: 'Rob Tuytel' };

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

// --- запись PNG (8 бит, RGBA) ---------------------------------------------------
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

/** @param px байты RGBA, w*h*4 */
function encodePng(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;                 // 8 бит, RGBA
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- скачивание -------------------------------------------------------------------
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

// --- картинки ---------------------------------------------------------------------
function channel(img, c) {
  const n = img.w * img.h;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = img.px[i * img.bpp + Math.min(c, img.bpp - 1)] / 255;
  return out;
}

const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

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

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const std = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

async function build(out) {
  const diff = await grab(SRC.slug, 'Diffuse');
  const nor = await grab(SRC.slug, 'nor_gl');
  const disp = await grab(SRC.slug, 'Displacement');
  const rough = await grab(SRC.slug, 'Rough');
  const w = diff.w;
  if (nor.w !== w || disp.w !== w || rough.w !== w) throw new Error('карты разного размера');

  const nx = shrink(channel(nor, 0), w, out).map((v) => v * 2 - 1);
  const ny = shrink(channel(nor, 1), w, out).map((v) => v * 2 - 1);

  // Знак зелёного канала — по карте высот, а не на веру (см.
  // tools/ground.mjs): n.xy ~ -grad(h). Ошибка здесь выворачивает
  // вмятины буграми, и видно это только при косом солнце.
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
  const cx = corr(nx, false);
  const flipY = corr(ny, true) < 0;
  if (flipY) for (let i = 0; i < ny.length; i++) ny[i] = -ny[i];
  const cy = corr(ny, true);

  // Тон — яркость, поделённая на свою среднюю, в том виде, в каком
  // движок множит цвета (без линеаризации, как у грунта).
  const r = shrink(channel(diff, 0), w, out, true);
  const g = shrink(channel(diff, 1), w, out, true);
  const b = shrink(channel(diff, 2), w, out, true);
  const lum = r.map((v, i) => 0.299 * v + 0.587 * g[i] + 0.114 * b[i]);
  const lm = mean(lum);
  const tone = lum.map((v) => v / lm);

  const gloss = shrink(channel(rough, 0), w, out).map((v) => 1 - v);

  const px = Buffer.alloc(out * out * 4);
  for (let i = 0; i < out * out; i++) {
    px[i * 4] = byte(clamp01(nx[i] * 0.5 + 0.5));
    px[i * 4 + 1] = byte(clamp01(ny[i] * 0.5 + 0.5));
    px[i * 4 + 2] = byte(clamp01(tone[i] * 0.5));        // 1.0 -> 128
    px[i * 4 + 3] = byte(clamp01(gloss[i]));
  }
  const slope = Math.sqrt(mean(nx.map((v, i) => v * v + ny[i] * ny[i])));
  return {
    px,
    report: [
      `нормаль: зелёный канал ${flipY ? 'перевёрнут' : 'как есть'}, согласие с высотой ` +
      `${cx.toFixed(2)} / ${cy.toFixed(2)}, средний наклон ${(Math.atan(slope) * 180 / Math.PI).toFixed(1)}°`,
      `тон: разброс ${std(tone).toFixed(2)} от средней; блеск ${mean(gloss).toFixed(2)} ± ${std(gloss).toFixed(2)}`,
    ],
    agree: Math.min(cx, cy), cx, cy, flipY,
  };
}

// --- запуск -----------------------------------------------------------------------
if (process.argv.includes('--clean')) {
  await rm(TMP, { recursive: true, force: true });
  console.log(`удалено: ${TMP}`);
} else if (process.argv.includes('--list')) {
  const info = await fetchJson(`${API}/info/${SRC.slug}`);
  console.log(`${SRC.slug}  ${info.dimensions[0] / 1000} м  ${SRC.author}  CC0  https://polyhaven.com/a/${SRC.slug}`);
} else {
  const info = await fetchJson(`${API}/info/${SRC.slug}`);
  const sizeM = info.dimensions[0] / 1000;
  if (info.dimensions[0] !== info.dimensions[1]) {
    throw new Error(`${SRC.slug}: кусок не квадратный (${info.dimensions})`);
  }
  if (Math.abs(sizeM - CABIN_TEX.sizeM) > 1e-9) {
    throw new Error(`${SRC.slug}: снятый кусок ${sizeM} м, а в js/gl/cabin.js записано ${CABIN_TEX.sizeM} м`);
  }
  console.log(`кабина: ${SRC.slug}, кусок ${sizeM} м`);
  const built = await build(CABIN_TEX.px);
  // Порог ниже, чем у грунта (0.2), и это свойство листа, а не
  // послабление: узор на нём неравный по осям — швы и следы абразива
  // идут в одну сторону, и вдоль v согласие 0.14 против 0.80 вдоль u.
  // Знак при этом тот же, что у соглашения OpenGL (зелёный — вверх по
  // картинке, то есть перевёрнут), и проверяется он, а не величина.
  if (built.agree < 0.1 || !built.flipY) {
    throw new Error(`нормаль не сходится с высотой (${built.cx.toFixed(2)} / ${built.cy.toFixed(2)}): ` +
      'царапины выйдут буграми');
  }
  const png = encodePng(CABIN_TEX.px, CABIN_TEX.px, built.px);
  const path = join(ROOT, CABIN_TEX.file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, png);
  for (const line of built.report) console.log(`  ${line}`);
  console.log(`  ${CABIN_TEX.file}: ${CABIN_TEX.px}×${CABIN_TEX.px}, ${(png.length / 1024).toFixed(0)} КБ`);
}
