// Перегон готовой модели космонавта (glTF со скелетом) в формат движка.
//
// Запуск: npm run spacesuit              пересобрать js/models/spacesuit.data.js
//         node tools/spacesuit.mjs --png=путь.png   ещё и снимок поз (проверка глазом)
//         node tools/spacesuit.mjs --clean          удалить скачанную модель
//
// Пилот, которого видят другие игроки, — человек в скафандре со шлемом:
// модель Quaternius (CC0) из пака «Ultimate Modular Men», со скелетом и
// анимациями ходьбы, бега и стойки. Конвертер делает с ней ровно то же,
// что tools/ship.mjs с корпусом, — один раз заранее берёт всё, что нужно
// движку, и кладёт числами в модуль:
//
//   * ГЕОМЕТРИЯ — сварена в индексированную сетку. Грани у модели и так
//     плоские (вершин вдвое больше треугольников — четырёхугольники со
//     своими нормалями), и нормаль грани шейдер берёт из производных
//     положения (uFlatN, js/gl/shaders.js). Вершины от этого вчетверо
//     реже, а модуль весит не 600 КБ, а около двухсот;
//   * ЦВЕТ — на вершину, из материала (пять цветов, текстур нет), из
//     линейного glTF в sRGB движка;
//   * КОСТИ — 62 сустава сведены к 21: пальцы перчаток идут за запястьем.
//     Пальцы шевелятся только в стойке, а униформы на 62 матрицы не во
//     всякую видеокарту влезают (256 векторов — нижняя граница WebGL2);
//   * АНИМАЦИИ — запечены матрицами костей по 30 кадров в секунду:
//     стойка, шаг и бег. Сидя (в кресле пилота) и в прыжке позы нет
//     среди анимаций модели, и они собираются здесь же из стойки —
//     поворотом бедра и голени вокруг коленей и тазобедренных суставов;
//   * ПОХОДКА — скорость, на которую рассчитаны шаг и бег, МЕРЯЕТСЯ: по
//     ступне, пока она на грунте (её ход назад и есть ход тела вперёд).
//     По ней ноги чужого пилота идут ровно по пройденному пути, а не
//     скользят по грунту.

import { mkdir, access, rm, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'js', 'models', 'spacesuit.data.js');
const TMP = join(tmpdir(), 'space-game-suit');

export const SRC = {
  // Одиночный файл с Poly Pizza — та же модель, что в паке Quaternius
  // «Ultimate Modular Men» (CC0). Пак целиком на OpenGameArt весит
  // десятки мегабайт ради одного человека.
  url: 'https://static.poly.pizza/0076345b-bbea-42d5-931c-4a5ad2050b18.glb',
  page: 'https://poly.pizza/m/3hC2i0CTuO',
  pack: 'https://quaternius.com/packs/ultimatemodularmen.html',
  author: 'Quaternius',
  license: 'CC0',
  file: 'spacesuit.glb',
};

// Кости движка — и чьи веса они собирают. Пальцы — за запястьем.
const BONES = ['Body', 'Hips', 'Abdomen', 'Torso', 'Chest', 'Neck', 'Head',
  'Shoulder.L', 'UpperArm.L', 'LowerArm.L', 'Wrist.L',
  'Shoulder.R', 'UpperArm.R', 'LowerArm.R', 'Wrist.R',
  'UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.R'];

/** В какую кость движка идёт вес сустава исходника. */
function boneFor(name) {
  if (BONES.includes(name)) return BONES.indexOf(name);
  const m = /^(Index|Middle|Ring|Pinky|Thumb)\d\.(L|R)$/.exec(name);
  if (m) return BONES.indexOf('Wrist.' + m[2]);
  return BONES.indexOf('Body');
}

const CLIPS = { idle: 'CharacterArmature|Idle', walk: 'CharacterArmature|Walk', run: 'CharacterArmature|Run' };
const FPS = 30;

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

async function download() {
  const file = join(TMP, SRC.file);
  if (await exists(file)) return readFile(file);
  await mkdir(TMP, { recursive: true });
  let last = null;
  // Площадки с CC0 иногда минуту отвечают 502: пробуем несколько раз.
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(SRC.url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      await writeFile(file, buf);
      return buf;
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
    }
  }
  throw new Error('модель не скачалась: ' + (last && last.message));
}

// --- glTF ----------------------------------------------------------------------

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('не GLB');
  let json = null, bin = null, o = 12;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    o += 8 + len;
  }
  return { json, bin };
}

const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessor(g, i) {
  const a = g.json.accessors[i];
  const n = COMP[a.type];
  const out = new Float64Array(a.count * n);
  const bv = g.json.bufferViews[a.bufferView];
  const size = { 5126: 4, 5123: 2, 5125: 4, 5121: 1, 5122: 2, 5120: 1 }[a.componentType];
  const stride = bv.byteStride || size * n;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  for (let k = 0; k < a.count; k++) {
    for (let c = 0; c < n; c++) {
      const at = base + k * stride + c * size;
      let v;
      switch (a.componentType) {
        case 5126: v = g.bin.readFloatLE(at); break;
        case 5123: v = g.bin.readUInt16LE(at); break;
        case 5125: v = g.bin.readUInt32LE(at); break;
        case 5121: v = g.bin[at]; break;
        case 5122: v = g.bin.readInt16LE(at); break;
        default: v = g.bin.readInt8(at);
      }
      if (a.normalized) v /= a.componentType === 5121 ? 255 : a.componentType === 5123 ? 65535 : 1;
      out[k * n + c] = v;
    }
  }
  return out;
}

// Матрицы 4×4 по столбцам, как в glTF.
function mul(a, b) {
  const r = new Float64Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      r[i * 4 + j] = s;
    }
  }
  return r;
}

function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  return Float64Array.from([
    (1 - 2 * (y * y + z * z)) * s[0], (2 * (x * y + z * w)) * s[0], (2 * (x * z - y * w)) * s[0], 0,
    (2 * (x * y - z * w)) * s[1], (1 - 2 * (x * x + z * z)) * s[1], (2 * (y * z + x * w)) * s[1], 0,
    (2 * (x * z + y * w)) * s[2], (2 * (y * z - x * w)) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1]);
}

/** Обратная к аффинной (поворот·масштаб + сдвиг). */
function inv(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const r = new Float64Array(16);
  r[0] = A / det; r[1] = -(b * i - c * h) / det; r[2] = (b * f - c * e) / det;
  r[4] = B / det; r[5] = (a * i - c * g) / det; r[6] = -(a * f - c * d) / det;
  r[8] = C / det; r[9] = -(a * h - b * g) / det; r[10] = (a * e - b * d) / det;
  const tx = m[12], ty = m[13], tz = m[14];
  r[12] = -(r[0] * tx + r[4] * ty + r[8] * tz);
  r[13] = -(r[1] * tx + r[5] * ty + r[9] * tz);
  r[14] = -(r[2] * tx + r[6] * ty + r[10] * tz);
  r[15] = 1;
  return r;
}

const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

/** Поворот вокруг мировой оси X на угол a через точку c. */
function rotX(a, c) {
  const co = Math.cos(a), si = Math.sin(a);
  const R = Float64Array.from([1, 0, 0, 0, 0, co, si, 0, 0, -si, co, 0, 0, 0, 0, 1]);
  return mul(mul(trs(c), R), trs([-c[0], -c[1], -c[2]]));
}

const lin2srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Мир суставов в момент t клипа (null — покой, без анимации). */
function pose(g, clip, t) {
  const nodes = g.json.nodes.map((n) => ({ t: n.translation, r: n.rotation, s: n.scale, m: n.matrix }));
  if (clip) {
    for (const ch of clip.channels) {
      const path = ch.target.path;
      if (path === 'weights') continue;
      const sm = clip.samplers[ch.sampler];
      const ins = accessor(g, sm.input), outs = accessor(g, sm.output);
      const n = path === 'rotation' ? 4 : 3;
      let k = 0;
      while (k + 1 < ins.length && ins[k + 1] <= t) k++;
      let v = Array.from(outs.subarray(k * n, k * n + n));
      if (k + 1 < ins.length && t > ins[k]) {
        const u = (t - ins[k]) / (ins[k + 1] - ins[k]);
        const v2 = Array.from(outs.subarray((k + 1) * n, (k + 1) * n + n));
        if (n === 4) {
          const sg = v.reduce((s, x, i) => s + x * v2[i], 0) < 0 ? -1 : 1;
          v = v.map((x, i) => x * (1 - u) + sg * v2[i] * u);
          const l = Math.hypot(...v);
          v = v.map((x) => x / l);
        } else v = v.map((x, i) => x * (1 - u) + v2[i] * u);
      }
      const key = path === 'translation' ? 't' : path === 'rotation' ? 'r' : 's';
      nodes[ch.target.node][key] = v;
    }
  }
  const local = nodes.map((n) => (n.m ? Float64Array.from(n.m) : trs(n.t, n.r, n.s)));
  const world = [];
  const W = (i) => world[i] || (world[i] = g.parent[i] < 0 ? local[i] : mul(W(g.parent[i]), local[i]));
  return nodes.map((_, i) => W(i));
}

// --- сборка ----------------------------------------------------------------------

function build(g) {
  const J = g.json;
  g.parent = new Array(J.nodes.length).fill(-1);
  J.nodes.forEach((n, i) => (n.children || []).forEach((c) => { g.parent[c] = i; }));
  const byName = new Map(J.nodes.map((n, i) => [n.name, i]));
  const node = (name) => {
    if (!byName.has(name)) throw new Error('в модели нет сустава ' + name);
    return byName.get(name);
  };
  const rest = pose(g, null, 0);

  // Сетка: вершины в покое (через исходные суставы и их обратные матрицы
  // привязки), цвет материала, веса — по костям движка.
  const palette = [];
  const colorOf = (mi) => {
    const pbr = (J.materials[mi] || {}).pbrMetallicRoughness || {};
    const c = (pbr.baseColorFactor || [1, 1, 1, 1]).slice(0, 3).map((x) => Math.round(lin2srgb(x) * 255));
    let k = palette.findIndex((p) => p[0] === c[0] && p[1] === c[1] && p[2] === c[2]);
    if (k < 0) { k = palette.length; palette.push(c); }
    return k;
  };
  const weld = new Map();
  const verts = [];
  const index = [];
  J.nodes.forEach((n) => {
    if (n.mesh === undefined || n.skin === undefined) return;
    const sk = J.skins[n.skin];
    const ibm = accessor(g, sk.inverseBindMatrices);
    const jm = sk.joints.map((j, k) => mul(rest[j], ibm.subarray(k * 16, k * 16 + 16)));
    const jb = sk.joints.map((j) => boneFor(J.nodes[j].name));
    for (const p of J.meshes[n.mesh].primitives) {
      const pos = accessor(g, p.attributes.POSITION);
      const js = accessor(g, p.attributes.JOINTS_0);
      const ws = accessor(g, p.attributes.WEIGHTS_0);
      const col = colorOf(p.material);
      const map = [];
      for (let v = 0; v < pos.length / 3; v++) {
        const src = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
        const P = [0, 0, 0];
        const acc = new Map();
        for (let k = 0; k < 4; k++) {
          const w = ws[v * 4 + k];
          if (!(w > 0)) continue;
          const j = js[v * 4 + k];
          const q = apply(jm[j], src);
          P[0] += w * q[0]; P[1] += w * q[1]; P[2] += w * q[2];
          acc.set(jb[j], (acc.get(jb[j]) || 0) + w);
        }
        // Не больше четырёх костей, сумма — ровно 255 в байтах.
        const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const sum = top.reduce((s, x) => s + x[1], 0) || 1;
        const wq = top.map((x) => Math.round(x[1] / sum * 255));
        wq[0] += 255 - wq.reduce((s, x) => s + x, 0);
        while (top.length < 4) { top.push([0, 0]); wq.push(0); }
        const mm = P.map((x) => Math.round(x * 1000));
        const key = mm.join(',') + '|' + col + '|' + top.map((x) => x[0]).join(',') + '|' + wq.join(',');
        let id = weld.get(key);
        if (id === undefined) {
          id = verts.length;
          weld.set(key, id);
          verts.push({ mm, col, j: top.map((x) => x[0]), w: wq });
        }
        map.push(id);
      }
      const idx = accessor(g, p.indices);
      for (let k = 0; k < idx.length; k += 3) {
        const a = map[idx[k]], b = map[idx[k + 1]], c = map[idx[k + 2]];
        if (a === b || b === c || a === c) continue;     // сваренный в точку
        index.push(a, b, c);
      }
    }
  });
  if (verts.length > 65535) throw new Error('вершин больше, чем держат 16 бит: ' + verts.length);

  // Кости: покой и обратная к нему — от неё отсчитываются анимации.
  const boneNode = BONES.map(node);
  const restInv = boneNode.map((i) => inv(rest[i]));
  const skinOf = (world) => boneNode.map((i, b) => mul(world[i], restInv[b]));

  // Клипы — кадрами по FPS.
  const clip = (name) => {
    const c = J.animations.find((a) => a.name === name);
    if (!c) throw new Error('нет анимации ' + name);
    let dur = 0;
    for (const s of c.samplers) { const ins = accessor(g, s.input); dur = Math.max(dur, ins[ins.length - 1]); }
    const n = Math.max(1, Math.round(dur * FPS));
    const frames = [];
    const worlds = [];
    for (let f = 0; f < n; f++) {
      const w = pose(g, c, (f / n) * dur);
      worlds.push(w);
      frames.push(skinOf(w));
    }
    return { dur, n, frames, worlds };
  };
  const clips = {};
  for (const [k, name] of Object.entries(CLIPS)) clips[k] = clip(name);

  // Позы, которых в анимациях нет: собираются из стойки поворотами в
  // мировых осях вокруг суставов. Ступни у этого скелета — не дети
  // голеней (их водила обратная кинематика), поэтому они переставляются
  // тем же поворотом, что получила голень.
  const synth = (thigh, shin, arm = 0, fore = 0) => {
    const w = pose(g, J.animations.find((a) => a.name === CLIPS.idle), 0);
    const desc = (root) => {
      const out = [root];
      for (let i = 0; i < out.length; i++) J.nodes[out[i]].children?.forEach((c) => out.push(c));
      return out;
    };
    const turn = (bone, angle, extra = []) => {
      const i = node(bone);
      const c = [w[i][12], w[i][13], w[i][14]];
      const R = rotX(angle, c);
      for (const d of desc(i).concat(extra)) w[d] = mul(R, w[d]);
    };
    for (const s of ['L', 'R']) {
      const foot = node('Foot.' + s);
      turn('UpperLeg.' + s, thigh, [foot]);
      turn('LowerLeg.' + s, shin, [foot]);
      if (arm) turn('UpperArm.' + s, arm);
      if (fore) turn('LowerArm.' + s, fore);
    }
    return w;
  };
  // Сидя: бедро вперёд горизонтально, голень отвесно, руки на коленях.
  // В прыжке: колени подобраны.
  const sitW = synth(-Math.PI / 2, Math.PI / 2, -0.55, -0.5);
  const jumpW = synth(-0.55, 0.95, -0.25, -0.35);
  clips.sit = { dur: 1, n: 1, frames: [skinOf(sitW)], worlds: [sitW] };
  clips.jump = { dur: 1, n: 1, frames: [skinOf(jumpW)], worlds: [jumpW] };

  // Походка: скорость, на которую рассчитан клип, — по ступне на грунте.
  const gait = (c) => {
    const L = node('Foot.L');
    const ys = c.worlds.map((w) => w[L][13]);
    const zs = c.worlds.map((w) => w[L][14]);
    const floor = Math.min(...ys);
    let sum = 0, cnt = 0;
    for (let f = 0; f < c.n; f++) {
      const g1 = (f + 1) % c.n;
      if (ys[f] > floor + 0.02 || ys[g1] > floor + 0.02) continue;
      const dz = zs[g1] - zs[f];
      if (dz > 0) continue;                     // ступня на грунте идёт назад
      sum += -dz / (c.dur / c.n);
      cnt++;
    }
    const speed = cnt ? sum / cnt : 0;
    return { speed: +speed.toFixed(3), cycle: +(speed * c.dur).toFixed(3) };
  };
  const head = (w) => {
    const h = w[node('Head')];
    return [+h[12].toFixed(3), +h[13].toFixed(3), +h[14].toFixed(3)];
  };

  return {
    verts, index, palette, clips,
    gait: { walk: gait(clips.walk), run: gait(clips.run) },
    head: { stand: head(rest), sit: head(sitW) },
    restInv,
  };
}

// --- запись ----------------------------------------------------------------------

const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

/** Матрица кости 3×4 в шестнадцать бит: поворот ×16384, сдвиг в мм. */
function packClip(c) {
  const out = new Int16Array(c.n * BONES.length * 12);
  let o = 0;
  for (const f of c.frames) {
    for (const m of f) {
      for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) out[o++] = Math.round(m[k] * 16384);
      for (const k of [12, 13, 14]) out[o++] = Math.round(m[k] * 1000);
    }
  }
  return { dur: +c.dur.toFixed(4), n: c.n, m: b64(out) };
}

function write(r) {
  const n = r.verts.length;
  const pos = new Int16Array(n * 3), col = new Uint8Array(n), jo = new Uint8Array(n * 4), we = new Uint8Array(n * 4);
  r.verts.forEach((v, i) => {
    pos.set(v.mm, i * 3); col[i] = v.col; jo.set(v.j, i * 4); we.set(v.w, i * 4);
  });
  const idx = Uint16Array.from(r.index);
  const clips = {};
  for (const [k, c] of Object.entries(r.clips)) clips[k] = packClip(c);
  const height = Math.max(...r.verts.map((v) => v.mm[1])) / 1000;
  const src = `// СГЕНЕРИРОВАНО tools/spacesuit.mjs — руками не править.
//
// Пилот в скафандре — модель ${SRC.author} (${SRC.license}):
// ${SRC.page}
// (пак «Ultimate Modular Men»: ${SRC.pack})
//
// Сетка сварена (нормали граней — по производным в шейдере), координаты —
// целые миллиметры, оси игры: вверх +Y, лицом +Z, ступни на нуле. Кости —
// ${BONES.length}, по четыре на вершину; анимации — матрицы костей 3×4 по
// ${FPS} кадров в секунду (поворот ×16384, сдвиг в мм). Пересобрать:
// npm run spacesuit

export const SUIT_BONES = ${JSON.stringify(BONES)};
export const SUIT_HEIGHT = ${height};
export const SUIT_PALETTE = ${JSON.stringify(r.palette)};
// Скорость, на которую рассчитаны шаг и бег (м/с), и путь за цикл (м):
// мерено по ступне на грунте (tools/spacesuit.mjs, gait).
export const SUIT_GAIT = ${JSON.stringify(r.gait)};
// Голова в осях модели: стоя и сидя (по ней сидящего ставят в кресло).
export const SUIT_HEAD = ${JSON.stringify(r.head)};
export const SUIT_MESH = {
  verts: ${n}, tris: ${idx.length / 3},
  pos: '${b64(pos)}',
  col: '${b64(col)}',
  joints: '${b64(jo)}',
  weights: '${b64(we)}',
  index: '${b64(idx)}',
};
export const SUIT_CLIPS = ${JSON.stringify(clips, null, 1).replace(/\n\s*/g, ' ')};
`;
  return src;
}

// --- снимок поз (проверка глазом) ---------------------------------------------------

function png(w, h, rgb) {
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(rows, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const crcT = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function preview(r, file) {
  const shots = [['idle', 0], ['walk', 0.25], ['run', 0.25], ['jump', 0], ['sit', 0]];
  const S = 240, W = S * shots.length * 2, H = S;
  const img = Buffer.alloc(W * H * 3, 34);
  const zb = new Float64Array(W * H).fill(-Infinity);
  shots.forEach(([k, at], si) => {
    const c = r.clips[k];
    const M = c.frames[Math.floor(at * c.n) % c.n];
    const P = r.verts.map((v) => {
      const p = [v.mm[0] / 1000, v.mm[1] / 1000, v.mm[2] / 1000];
      const o = [0, 0, 0];
      for (let i = 0; i < 4; i++) {
        if (!v.w[i]) continue;
        const q = apply(M[v.j[i]], p);
        for (let e = 0; e < 3; e++) o[e] += q[e] * v.w[i] / 255;
      }
      return o;
    });
    for (const view of [0, 1]) {
      const ox = (si * 2 + view) * S;
      const pr = (p) => view === 0
        ? [p[0] / 2.2 * S + S / 2 + ox, S - 10 - p[1] / 2.2 * S, p[2]]
        : [-p[2] / 2.2 * S + S / 2 + ox, S - 10 - p[1] / 2.2 * S, p[0]];
      for (let t = 0; t < r.index.length; t += 3) {
        const a = P[r.index[t]], b = P[r.index[t + 1]], cc = P[r.index[t + 2]];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
        const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const nl = Math.hypot(...nn) || 1;
        const sh = 0.45 + 0.55 * Math.abs((nn[0] * 0.4 + nn[1] * 0.7 + nn[2] * 0.6) / nl / 1.0247);
        const col = r.palette[r.verts[r.index[t]].col];
        const A = pr(a), B = pr(b), C = pr(cc);
        const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
        if (Math.abs(den) < 1e-12) continue;
        const x0 = Math.max(ox, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(ox + S - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
        const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const w0 = ((B[1] - C[1]) * (x + 0.5 - C[0]) + (C[0] - B[0]) * (y + 0.5 - C[1])) / den;
            const w1 = ((C[1] - A[1]) * (x + 0.5 - C[0]) + (A[0] - C[0]) * (y + 0.5 - C[1])) / den;
            const w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
            if (z <= zb[y * W + x]) continue;
            zb[y * W + x] = z;
            img[(y * W + x) * 3] = Math.min(255, col[0] * sh);
            img[(y * W + x) * 3 + 1] = Math.min(255, col[1] * sh);
            img[(y * W + x) * 3 + 2] = Math.min(255, col[2] * sh);
          }
        }
      }
    }
  });
  return writeFile(file, png(W, H, img));
}

// --- запуск ----------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--clean')) {
    await rm(TMP, { recursive: true, force: true });
    console.log('удалено: ' + TMP);
    process.exit(0);
  }
  const g = parseGlb(await download());
  const r = build(g);
  const src = write(r);
  await writeFile(OUT, src);
  console.log(`космонавт: ${r.verts.length} вершин, ${r.index.length / 3} треугольников, ${BONES.length} костей, `
    + `${r.palette.length} цветов, ${(src.length / 1024).toFixed(0)} КБ`);
  console.log(`  клипы: ${Object.entries(r.clips).map(([k, c]) => k + ' ' + c.n + ' кадр.').join(', ')}`);
  console.log(`  походка: шаг ${r.gait.walk.speed} м/с (цикл ${r.gait.walk.cycle} м), бег ${r.gait.run.speed} м/с (цикл ${r.gait.run.cycle} м)`);
  console.log(`  голова: стоя ${r.head.stand.join(', ')}, сидя ${r.head.sit.join(', ')}`);
  const shot = process.argv.find((a) => a.startsWith('--png='));
  if (shot) { await preview(r, shot.slice(6)); console.log('  снимок поз: ' + shot.slice(6)); }
}
