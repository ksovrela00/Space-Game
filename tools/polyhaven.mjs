// Общее у перегонов с Poly Haven (CC0): скачивание с кэшем, запись PNG и
// обработка карт — уменьшение, вычет крупных пятен, проверка шва.
//
// Пользуются им tools/ground.mjs (фотография грунта) и tools/rocks.mjs
// (камни). Вынесено, а не скопировано: перегоны обязаны обращаться с
// картами одинаково — тон в том же виде, в каком его множит движок,
// нормаль усреднённой как вектор, — и разойдись два списка правил,
// камень и грунт под ним легли бы разной фактурой.

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { decodePng } from './ship.mjs';

export const API = 'https://api.polyhaven.com';

export const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
export const page = (slug) => `https://polyhaven.com/a/${slug}`;

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
export function encodePng(w, h, px) {
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

export async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}


/**
 * Карта материала в PNG. Исходники кэшируются в папке tmp: они весят
 * мегабайты, а в репозиторий ложится только то, что из них собрано.
 */
export async function grab(slug, map, tmp, size = '1k') {
  const files = await fetchJson(`${API}/files/${slug}`);
  const f = files[map] && files[map][size] && files[map][size].png;
  if (!f) throw new Error(`${slug}: нет карты ${map} в PNG (${size})`);
  return decodePng(await fetchCached(f.url, f.size, tmp));
}

/** Файл по ссылке — из кэша, а нет там — скачать и положить. */
export async function fetchCached(url, size, tmp) {
  const name = url.split('/').pop();
  const path = join(tmp, name);
  if (!(await exists(path))) {
    process.stdout.write(`  качаю ${name} (${(size / 1048576).toFixed(1)} МБ)
`);
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    await mkdir(tmp, { recursive: true });
    await writeFile(path, buf);
  }
  return readFile(path);
}

// --- работа с картинками -----------------------------------------------------

/** Канал картинки как Float64Array в 0..1. */
export function channel(img, c) {
  const n = img.w * img.h;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = img.px[i * img.bpp + Math.min(c, img.bpp - 1)] / 255;
  return out;
}

// sRGB и линейный свет. Усреднять цвет надо в линейном — иначе
// уменьшение в четыре раза само по себе темнит картинку.
export const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** Уменьшение в целое число раз усреднением квадрата. */
export function shrink(src, w, out, lin = false) {
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
export function lowPass(a, n, cells) {
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

export const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
export const std = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

/**
 * Шов на склейке против обычной разницы соседей. Число больше единицы
 * значит, что стык картинки с самой собой заметнее, чем её собственная
 * зернистость, — то есть плитка НЕ бесшовная, и узор пойдёт решёткой.
 */
export function seam(chans, n) {
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

