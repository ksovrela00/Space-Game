// Планировки городов сверху, буквами.
//
// Зачем инструмент, если есть снимки экрана. Снимок стоит полминуты и
// показывает ОДИН город с одной точки; вопрос же здесь другой —
// «похожи ли города друг на друга», и отвечать на него надо десятком
// планировок рядом. Буквами это секунда на все десять, и видно ровно
// то, что нужно: контур, схему улиц, где порт, где пусто.
//
//   node tools/cityplan.mjs                 десять городов подряд
//   node tools/cityplan.mjs 7 42 1234       именно эти семена
//   node tools/cityplan.mjs --count=4 --wide
//
// Буквы: # башня, o квартал, . низкая застройка, = улица, П площадка,
// T турель, ~ монорельс.

import { cityPlan, CITY, CITY_KINDS } from '../js/models/city.js';
import { CITY_PARTS } from '../js/models/city.parts.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((s) => s.startsWith(`--${name}=`));
  return a ? Number(a.slice(name.length + 3)) : def;
};
const seeds = args.filter((s) => !s.startsWith('--')).map(Number);
const count = opt('count', seeds.length || 10);
const wide = args.includes('--wide');
const W = wide ? 118 : 78;
const H = Math.round(W * 0.42);

const tris = (plan) => {
  let n = 0;
  for (const it of plan.parts) {
    const p = CITY_PARTS[it.p];
    if (!p) continue;
    for (let i = 0; i < p.faces.length;) { n += Math.max(0, p.faces[i] - 2); i += p.faces[i] + 2; }
  }
  return n + plan.plates.length * 2 + plan.lamps.length * 12;
};

// Приоритет букв: что важнее, то и побеждает в клетке. Площадка важнее
// башни — её ищут глазами, а башен много.
const RANK = { ' ': 0, '=': 1, '~': 2, '.': 3, o: 4, '#': 5, T: 6, 'П': 7 };

function draw(plan) {
  const R = plan.plate;
  const g = [];
  for (let i = 0; i < H; i++) g.push(new Array(W).fill(' '));
  const put = (x, z, ch) => {
    const cx = Math.round(((x + R) / (2 * R)) * (W - 1));
    const cz = Math.round(((z + R) / (2 * R)) * (H - 1));
    if (cx < 0 || cx >= W || cz < 0 || cz >= H) return;
    if (RANK[ch] > RANK[g[cz][cx]]) g[cz][cx] = ch;
  };
  // Улицы рисуются отрезками: плашка повёрнута, и её концы важнее середины.
  for (const p of plan.plates) {
    const c = Math.cos(p.rot || 0), s = Math.sin(p.rot || 0);
    const n = Math.max(2, Math.round((p.hw * 2 * W) / (2 * R)) + 1);
    for (let i = 0; i <= n; i++) {
      const t = -p.hw + (2 * p.hw * i) / n;
      put(p.x + t * c, p.z - t * s, '=');
    }
  }
  for (const it of plan.parts) {
    if (it.p === 'railTrack' || it.p === 'railSupport' || it.p === 'railCar') put(it.x, it.z, '~');
    else if (it.p === 'turret') put(it.x, it.z, 'T');
  }
  // Пороги — ДОЛЯ от самого высокого в этом городе, а не метры: в
  // посёлке башня 170 м, в громадине 480, и по общему порогу посёлок
  // выходил бы сплошь низким.
  const hi = plan.tallest * 0.5, mid = plan.tallest * 0.22;
  for (const b of plan.boxes) {
    if (b.h > hi) put(b.x, b.z, '#');
    else if (b.h > mid) put(b.x, b.z, 'o');
    else put(b.x, b.z, '.');
  }
  for (const p of plan.pads) {
    put(p.x, p.z, 'П');
    put(p.x + p.r, p.z, 'П');
    put(p.x - p.r, p.z, 'П');
  }
  return g.map((row) => '|' + row.join('') + '|').join('\n');
}

const line = '+' + '-'.repeat(W) + '+';
const rows = [];
for (let i = 0; i < count; i++) {
  const seed = seeds.length ? seeds[i] : ((i + 1) * 0x9e3779b9) >>> 0;
  const t0 = Date.now();
  const plan = cityPlan(seed);
  const ms = Date.now() - t0;
  const t = tris(plan);
  rows.push([seed, CITY_KINDS[plan.kind], (plan.radius * 2).toFixed(1), plan.districts.length,
    plan.parts.length, plan.pads.length, plan.lamps.length, (t / 1000).toFixed(0) + 'k',
    (plan.tallest * 1000).toFixed(0), ms + ' мс']);
  console.log(`\n=== семя ${seed}: ${CITY_KINDS[plan.kind]}, ${(plan.radius * 2).toFixed(1)} км `
    + `поперёк, районов ${plan.districts.length}, построек ${plan.boxes.length}, `
    + `площадок ${plan.pads.length}, ${(t / 1000).toFixed(0)}к треугольников ===`);
  console.log(line);
  console.log(draw(plan));
  console.log(line);
}

const head = ['семя', 'схема', 'км', 'районов', 'деталей', 'площадок', 'огней', 'граней', 'выше, м', 'время'];
const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
const fmt = (r) => r.map((v, i) => String(v).padStart(w[i])).join('  ');
console.log('\n' + fmt(head));
console.log(w.map((n) => '-'.repeat(n)).join('  '));
for (const r of rows) console.log(fmt(r));
console.log(`\nбюджет: деталей ${CITY.maxParts}, огней ${CITY.maxLamps}, плашек ${CITY.maxPlates}`);
