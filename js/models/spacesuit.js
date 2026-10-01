// Пилот в скафандре: сетка и позы из js/models/spacesuit.data.js.
//
// Данные — числа, снятые конвертером (tools/spacesuit.mjs) с готовой
// модели Quaternius (CC0): сваренная сетка, веса по 21 кости и матрицы
// костей по кадрам для стойки, шага и бега, плюс две собранные позы —
// сидя в кресле и в прыжке. Здесь — раскодировать их и ответить на один
// вопрос: какие матрицы у костей у ЭТОГО человека СЕЙЧАС.
//
// Поза выбирается не по «что прислали», а по тому, как человек движется:
//
//   сидит в кресле             — поза «сидя»;
//   в воздухе (прыжок, спуск)  — «в прыжке»;
//   идёт                       — шаг, а быстрее — бег, с переходом между ними;
//   стоит                      — стойка (дыхание по своим часам).
//
// Ноги идут ПО ПРОЙДЕННОМУ ПУТИ: фаза шага копится по скорости и длине
// цикла, которую конвертер измерил по ступне на грунте (SUIT_GAIT). Так
// ступня, стоящая на земле, на земле и стоит — не скользит вперёд и не
// буксует, с какой бы скоростью человек ни шёл.
//
// Модуль чистый, без GL: проверяется в Node (tools/test.mjs).

/** Раскодировать base64 в типизированный массив. */
function unb64(s, Type) {
  const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Type(u8.buffer, 0, u8.byteLength / Type.BYTES_PER_ELEMENT);
}

let _suit = null;
let _job = null;

/** Загрузить модель (один раз; модуль данных тяжёлый и грузится лениво). */
export function loadSuit() {
  if (_suit) return Promise.resolve(_suit);
  if (!_job) _job = import('./spacesuit.data.js').then((d) => (_suit = decodeSuit(d)));
  return _job;
}

/** Уже загруженная модель — или null. */
export const suitReady = () => _suit;

/** Раскодировать данные конвертера. */
export function decodeSuit(d) {
  const M = d.SUIT_MESH;
  const pmm = unb64(M.pos, Int16Array);
  const pos = new Float32Array(pmm.length);
  for (let i = 0; i < pmm.length; i++) pos[i] = pmm[i] / 1000;
  const ci = unb64(M.col, Uint8Array);
  const col = new Float32Array(M.verts * 4);
  for (let i = 0; i < M.verts; i++) {
    const c = d.SUIT_PALETTE[ci[i]] || [200, 200, 200];
    col[i * 4] = c[0] / 255; col[i * 4 + 1] = c[1] / 255; col[i * 4 + 2] = c[2] / 255; col[i * 4 + 3] = 0;
  }
  const clips = {};
  for (const [k, c] of Object.entries(d.SUIT_CLIPS)) {
    const q = unb64(c.m, Int16Array);
    const m = new Float32Array(q.length);
    // 12 чисел на кость: девять поворота (×16384) и три сдвига (мм).
    for (let i = 0; i < q.length; i++) m[i] = (i % 12) < 9 ? q[i] / 16384 : q[i] / 1000;
    clips[k] = { dur: c.dur, n: c.n, m };
  }
  const S = {
    bones: d.SUIT_BONES.length,
    verts: M.verts,
    tris: M.tris,
    pos, col,
    joints: unb64(M.joints, Uint8Array),
    weights: unb64(M.weights, Uint8Array),
    index: unb64(M.index, Uint16Array),
    clips,
    gait: d.SUIT_GAIT,
    head: d.SUIT_HEAD,
    height: d.SUIT_HEIGHT,
    sitLow: 0,
  };
  // Самая низкая точка сидящего (ступни), м: сидящего ставят по глазу
  // кресла, но не ниже пола (seatPlace).
  const bones = suitPose(S, { st: 'seat' }, 0);
  const q = [0, 0, 0];
  let low = Infinity;
  for (let v = 0; v < S.verts; v++) low = Math.min(low, skinVertex(S, bones, v, q)[1]);
  S.sitLow = low;
  return S;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Где шаг переходит в бег, м/с: между шагом пилота (2.0) и бегом (4.6,
// js/game/walker.js) — там, где человек уже не идёт, а трусит.
const RUN_FROM = 2.4, RUN_TO = 3.8;
// Ниже этой скорости человек стоит, и ноги не шевелятся.
const STILL = 0.15, MOVE = 0.7;

/** Насколько это бег, 0..1. */
export const runK = (v) => clamp01((v - RUN_FROM) / (RUN_TO - RUN_FROM));

/**
 * Путь за цикл шага (два шага), м: шаг и бег — каждый свой, по замеру
 * конвертера; между ними — смесь, как и сама поза.
 */
export function suitCycle(S, v) {
  const k = runK(v);
  return S.gait.walk.cycle * (1 - k) + S.gait.run.cycle * k;
}

/** Добавить к out кадр клипа (t — доля цикла 0..1) с весом w. */
function addClip(out, clip, t, w, bones) {
  if (w <= 0) return;
  const f = ((t % 1) + 1) % 1 * clip.n;
  const i0 = Math.floor(f) % clip.n, i1 = (i0 + 1) % clip.n, u = f - Math.floor(f);
  const a = i0 * bones * 12, b = i1 * bones * 12;
  const m = clip.m;
  for (let k = 0; k < bones * 12; k++) out[k] += w * (m[a + k] * (1 - u) + m[b + k] * u);
}

const _acc = new Float32Array(64 * 12);

/**
 * Матрицы костей человека сейчас — для шейдера (mat4 по столбцам).
 *
 * @param person { st, v — скорость шага м/с, air, phase — циклы шага }
 * @param t      часы для стойки (дыхание), с
 * @param out    Float32Array(bones × 16)
 */
export function suitPose(S, person, t, out = new Float32Array(S.bones * 16)) {
  const n = S.bones;
  const acc = _acc.subarray(0, n * 12);
  acc.fill(0);
  const C = S.clips;
  if (person.st === 'seat') addClip(acc, C.sit, 0, 1, n);
  else if (person.air) addClip(acc, C.jump, 0, 1, n);
  else {
    const v = person.v || 0;
    const move = clamp01((v - STILL) / (MOVE - STILL));
    const k = runK(v);
    const ph = person.phase || 0;
    addClip(acc, C.idle, t / C.idle.dur, 1 - move, n);
    addClip(acc, C.walk, ph, move * (1 - k), n);
    addClip(acc, C.run, ph, move * k, n);
  }
  for (let b = 0; b < n; b++) {
    const s = b * 12, o = b * 16;
    out[o] = acc[s]; out[o + 1] = acc[s + 1]; out[o + 2] = acc[s + 2]; out[o + 3] = 0;
    out[o + 4] = acc[s + 3]; out[o + 5] = acc[s + 4]; out[o + 6] = acc[s + 5]; out[o + 7] = 0;
    out[o + 8] = acc[s + 6]; out[o + 9] = acc[s + 7]; out[o + 10] = acc[s + 8]; out[o + 11] = 0;
    out[o + 12] = acc[s + 9]; out[o + 13] = acc[s + 10]; out[o + 14] = acc[s + 11]; out[o + 15] = 1;
  }
  return out;
}

// Глаз — над суставом головы и перед ним, м: сустав сидит у основания
// шлема, а глаз — за забралом.
const EYE_UP = 0.12, EYE_FWD = 0.08;

/**
 * Куда ставить модель сидящего (оси корабля, м): головой — на глаз
 * кресла (js/models/interior.js, seat.eye), но ступнями не ниже пола
 * floor. Кресло знает, где глаз пилота, — а не где у него пятки.
 */
export function seatPlace(S, eye, floor, out = [0, 0, 0]) {
  out[0] = eye[0] - S.head.sit[0];
  out[1] = Math.max(eye[1] - S.head.sit[1] - EYE_UP, floor - S.sitLow);
  out[2] = eye[2] - S.head.sit[2] - EYE_FWD;
  return out;
}

/** Кожа на процессоре: вершина v в позе bones (для проверок). */
export function skinVertex(S, bones, v, out = [0, 0, 0]) {
  const p = S.pos, j = S.joints, w = S.weights;
  out[0] = out[1] = out[2] = 0;
  for (let i = 0; i < 4; i++) {
    const wt = w[v * 4 + i] / 255;
    if (!wt) continue;
    const o = j[v * 4 + i] * 16;
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
    out[0] += wt * (bones[o] * x + bones[o + 4] * y + bones[o + 8] * z + bones[o + 12]);
    out[1] += wt * (bones[o + 1] * x + bones[o + 5] * y + bones[o + 9] * z + bones[o + 13]);
    out[2] += wt * (bones[o + 2] * x + bones[o + 6] * y + bones[o + 10] * z + bones[o + 14]);
  }
  return out;
}
