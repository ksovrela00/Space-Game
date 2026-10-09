// Перегон CC0-фотограмметрии Poly Haven в фактуры станции.
//
// Запуск: npm run stationtex        node tools/stationtex.mjs --list
//
// Что получается: assets/texture/station.png — слои массива текстур
// сверху вниз (js/gl/stationtex.js, STATION_LAYERS), каждый 512 × 512, RGB.
//
// Из каждой фотографии (карта Diffuse, 1k):
//
//   * вычитаются КРУПНЫЕ ПЯТНА — тон делится на свои низкие частоты (как у
//     грунта, tools/ground.mjs): кусок в два метра ложится по полу зала
//     четыреста раз, и пятно с него читалось бы решёткой;
//   * цвет делится на среднюю яркость и кладётся вдвое ниже (средняя —
//     128): шейдер умножает на два, и грань остаётся той яркости, что
//     задала палитра (js/models/stationhall.js), а рисунок и цвет материала —
//     от фотографии.
//
// Размер снятого куска сверяется с API (поле dimensions): разойдётся с
// движком — и плитка ляжет вдвое крупнее или мельче настоящей.

import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { API, fetchJson, grab, channel, shrink, lowPass, mean, byte, seam, encodePng, page } from './polyhaven.mjs';
import { STATION_LAYERS, STATION_TEX } from '../js/gl/stationtex.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(tmpdir(), 'space-game-station');

// На сколько клеток делится кусок при вычете пятен: у крупного рисунка
// (бетонные панели в 8 м — плиты по два) клеток меньше, иначе вычитались
// бы сами плиты.
const LOW = { panels: 4, parquet: 8 };

async function info(slug) {
  const j = await fetchJson(`${API}/info/${slug}`);
  return { name: j.name, authors: Object.keys(j.authors || {}), sizeM: (j.dimensions || [0])[0] / 1000 };
}

async function layer(L) {
  const meta = await info(L.slug);
  if (Math.abs(meta.sizeM - L.sizeM) > 0.02 * L.sizeM) {
    throw new Error(`${L.slug}: кусок ${meta.sizeM} м, а в движке ${L.sizeM} м (js/gl/stationtex.js)`);
  }
  const img = await grab(L.slug, 'Diffuse', TMP, '1k');
  const n = STATION_TEX.px;
  const C = [0, 1, 2].map((c) => shrink(channel(img, c), img.w, n, true));
  const lum = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) lum[i] = 0.2126 * C[0][i] + 0.7152 * C[1][i] + 0.0722 * C[2][i];
  const m = mean(lum);
  const low = lowPass(lum, n, LOW[L.key] || 8);
  const px = Buffer.alloc(n * n * 3);
  const out = [new Float64Array(n * n), new Float64Array(n * n), new Float64Array(n * n)];
  for (let i = 0; i < n * n; i++) {
    const k = 0.5 / Math.max(1e-4, low[i]);
    const sat = L.sat ?? 1;
    for (let c = 0; c < 3; c++) {
      // Насыщенность: к яркости точки, сколько велено (js/gl/stationtex.js, sat).
      out[c][i] = (lum[i] + (C[c][i] - lum[i]) * sat) * k;
      px[i * 3 + c] = byte(out[c][i]);
    }
  }
  const s = seam(out, n);
  return { px, meta, seam: s };
}

async function main() {
  if (process.argv.includes('--list')) {
    for (const L of STATION_LAYERS) console.log(`${L.key.padEnd(9)} ${L.slug} (${L.sizeM} м) ${page(L.slug)}`);
    return;
  }
  const n = STATION_TEX.px;
  const strip = Buffer.alloc(n * n * 3 * STATION_LAYERS.length);
  const credits = [];
  for (let i = 0; i < STATION_LAYERS.length; i++) {
    const L = STATION_LAYERS[i];
    const r = await layer(L);
    r.px.copy(strip, i * n * n * 3);
    credits.push(`[${r.meta.name}](${page(L.slug)})`);
    console.log(`  ${i} ${L.key.padEnd(9)} ${r.meta.name} — ${r.meta.authors.join(', ')}; шов ${r.seam.toFixed(2)}`);
  }
  const file = join(ROOT, STATION_TEX.file);
  await writeFile(file, encodePng(n, n * STATION_LAYERS.length, strip));
  console.log(`готово: ${STATION_TEX.file}, слоёв ${STATION_LAYERS.length}`);
  console.log('источники: ' + credits.join(', '));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
