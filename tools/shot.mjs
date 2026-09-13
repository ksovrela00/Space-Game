// ASCII-«скриншот»: перехватываем вызовы canvas, растеризуем пути
// (правило nonzero, как в браузере) и печатаем кадр символами.
// Нужен, чтобы увидеть композицию кадра, не открывая браузер.

const W = 1600, H = 900;
const COLS = 108, ROWS = 40;
const RAMP = ' .`:-=+*#%@';

let grid = new Float32Array(COLS * ROWS);

// Цвет -> {l: яркость, a: альфа}
const parse = (style) => {
  if (typeof style !== 'string') return { l: 0.5, a: 1 };
  let m = /^rgba?\(([^)]+)\)/.exec(style);
  if (m) {
    const p = m[1].split(',').map(Number);
    return {
      l: (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255,
      a: p.length > 3 ? p[3] : 1,
    };
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(style);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    const v = parseInt(h, 16);
    return {
      l: (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255,
      a: 1,
    };
  }
  return { l: 0.6, a: 1 };
};

const lum = (style) => {
  if (style && style.__grad) return style.avg;
  if (typeof style !== 'string') return 0.5;
  let m = /^rgba?\(([^)]+)\)/.exec(style);
  if (m) {
    const p = m[1].split(',').map(Number);
    const a = p.length > 3 ? p[3] : 1;
    return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255 * a;
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(style);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    const v = parseInt(h, 16);
    return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  }
  return 0.6;
};

// --- путь ---
let sub = [];          // текущий подпуть
let path = [];         // список подпутей
const clipStack = [];
let clip = null;

const startSub = (x, y) => { sub = [[x, y]]; path.push(sub); };
const addPt = (x, y) => { if (!sub.length) startSub(x, y); else sub.push([x, y]); };

const flatArc = (cx, cy, rx, ry, rot, a0, a1, ccw) => {
  let span = a1 - a0;
  if (ccw) { while (span > 0) span -= Math.PI * 2; }
  else { while (span < 0) span += Math.PI * 2; }
  const steps = Math.max(6, Math.min(90, Math.ceil(Math.abs(span) / 0.12)));
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let i = 0; i <= steps; i++) {
    const a = a0 + span * (i / steps);
    const px = Math.cos(a) * rx, py = Math.sin(a) * ry;
    addPt(cx + px * cr - py * sr, cy + px * sr + py * cr);
  }
};

// Число оборотов пути вокруг точки (nonzero winding).
const windingAt = (polys, x, y) => {
  let w = 0;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i];
      const [x2, y2] = p[(i + 1) % p.length];
      if (y1 <= y) {
        if (y2 > y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) > 0) w++;
      } else if (y2 <= y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) < 0) w--;
    }
  }
  return w;
};

const bbox = (polys) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};

let TRACE = !!process.env.TRACEFILL;
// value может быть числом или функцией (x, y) -> {l, a}
const paint = (polys, value, alpha = 1) => {
  if (!polys.length) return;
  const fn = typeof value === 'function' ? value : null;
  let painted = 0;
  const [bx0, by0, bx1, by1] = bbox(polys);
  const cw = W / COLS, ch = H / ROWS;
  const c0 = Math.max(0, Math.floor(bx0 / cw)), c1 = Math.min(COLS - 1, Math.ceil(bx1 / cw));
  const r0 = Math.max(0, Math.floor(by0 / ch)), r1 = Math.min(ROWS - 1, Math.ceil(by1 / ch));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const x = (c + 0.5) * cw, y = (r + 0.5) * ch;
      if (windingAt(polys, x, y) === 0) continue;
      if (clip && windingAt(clip, x, y) === 0) continue;
      const i = r * COLS + c;
      let v = value, a = alpha;
      if (fn) { const s2 = fn(x, y); v = s2.l; a = alpha * s2.a; }
      grid[i] = a >= 1 ? v : grid[i] * (1 - a) + v * a;
      painted++;
    }
  }
  if (TRACE && painted > COLS * ROWS * 0.3) {
    const st2 = new Error().stack.split(String.fromCharCode(10))[3].trim();
    console.log('[fill] cells=' + painted + ' value=' + value.toFixed(2) +
      ' alpha=' + alpha + ' style=' + String(state.fillStyle) + ' at ' + st2);
  }
};

const state = { fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1 };

// Для градиента отдаём функцию-сэмплер, для обычного цвета — яркость
// с учётом альфы (альфа применяется как множитель прозрачности).
const styleValue = () => {
  const st = state.fillStyle;
  if (st && st.__grad) return (x, y) => st.sample(x, y);
  const c = parse(st);
  return c.a >= 1 ? c.l : ((x, y) => c);
};

const ctx = {
  get fillStyle() { return state.fillStyle; },
  set fillStyle(v) { state.fillStyle = v; },
  get strokeStyle() { return state.strokeStyle; },
  set strokeStyle(v) { state.strokeStyle = v; },
  get globalAlpha() { return state.globalAlpha; },
  set globalAlpha(v) { state.globalAlpha = v; },
  lineWidth: 1, font: '', textAlign: '', textBaseline: '',
  save() { clipStack.push(clip); },
  restore() { clip = clipStack.length ? clipStack.pop() : null; },
  setTransform() {},
  beginPath() { path = []; sub = []; },
  closePath() {},
  moveTo(x, y) { startSub(x, y); },
  lineTo(x, y) { addPt(x, y); },
  arc(cx, cy, r, a0, a1, ccw) { flatArc(cx, cy, r, r, 0, a0, a1, !!ccw); },
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw) { flatArc(cx, cy, rx, ry, rot, a0, a1, !!ccw); },
  rect(x, y, w, h) { path.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]); sub = []; },
  fill() { paint(path, styleValue(), state.globalAlpha); },
  stroke() { /* обводки в ASCII не нужны */ },
  clip() { clip = path.map((p) => p.slice()); },
  fillRect(x, y, w, h) {
    paint([[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]], styleValue(), state.globalAlpha);
  },
  strokeRect() {},
  // HUD рисуется вторым слоем, но в ASCII-скриншоте слой один: очистку
  // прозрачностью игнорируем, иначе приборы стёрли бы сцену.
  clearRect() {},
  fillText() {},
  translate() {}, rotate() {}, scale() {},
  measureText: () => ({ width: 40 }),
  createRadialGradient: (x0, y0, r0, x1, y1, r1) => makeGrad(x0, y0, r0, x1, y1, r1),
  createLinearGradient: (x0, y0, x1, y1) => makeGrad(x0, y0, 0, x1, y1, Math.hypot(x1 - x0, y1 - y0)),
  setLineDash() {},
};

// Радиальный градиент: интерполируем стопы по расстоянию до внешнего
// центра. Плоская заливка средним цветом «затирала» планету, поэтому
// важна именно интерполяция вместе с альфой.
function makeGrad(x0, y0, r0, x1, y1, r1) {
  const stops = [];
  return {
    __grad: true,
    addColorStop(p, c) { stops.push([p, parse(c)]); },
    sample(x, y) {
      if (!stops.length) return { l: 0.3, a: 1 };
      if (x1 === undefined) return stops[stops.length - 1][1];
      const d = Math.hypot(x - x1, y - y1);
      const span = (r1 - r0) || 1;
      let t = (d - r0) / span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      let prev = stops[0];
      for (const st of stops) {
        if (st[0] >= t) {
          const w = st[0] === prev[0] ? 0 : (t - prev[0]) / (st[0] - prev[0]);
          return {
            l: prev[1].l + (st[1].l - prev[1].l) * w,
            a: prev[1].a + (st[1].a - prev[1].a) * w,
          };
        }
        prev = st;
      }
      return prev[1];
    },
    get avg() {
      if (!stops.length) return 0.3;
      return stops.reduce((s, st) => s + st[1].l * st[1].a, 0) / stops.length;
    },
  };
}

// --- DOM-заглушки ---
const el = (id) => ({
  id, innerHTML: '', textContent: '', className: '', style: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  listeners: {},
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
  appendChild() {}, getContext: () => ctx, width: 0, height: 0,
});
const nodes = { screen: el('screen'), overlay: el('overlay'), panel: el('panel'), boot: el('boot'), bootBtn: el('bootBtn') };
globalThis.document = { getElementById: (i) => nodes[i] || el(i), createElement: (t) => el(t) };
const winL = {};
globalThis.window = {
  innerWidth: W, innerHeight: H, devicePixelRatio: 1,
  addEventListener(t, fn) { (winL[t] ||= []).push(fn); }, removeEventListener() {},
};
// Явно просим Canvas-2D-рендер: WebGL здесь не подменить, его путь
// проверяется отдельно в tools/gl.mjs через мок GL-контекста.
globalThis.location = { search: '?renderer=2d' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
let rafCb = null, nowMs = 0;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
globalThis.performance = { now: () => nowMs };

const frames = (n) => {
  for (let i = 0; i < n; i++) { nowMs += 16.7; const cb = rafCb; rafCb = null; cb(nowMs); }
};

await import('../js/main.js');
const game = globalThis.window.GAME;
for (const fn of nodes.bootBtn.listeners.click || []) fn();
frames(3);

const show = (title) => {
  grid = new Float32Array(COLS * ROWS);
  frames(1);
  console.log('[инфо] режим=' + game.state.mode + ' вид=' + game.state.view +
    ' полигонов=' + game.renderer.polys + ' итемов=' + game.renderer.items.length);
  const lines = [];
  for (let r = 0; r < ROWS; r++) {
    let s = '';
    for (let c = 0; c < COLS; c++) {
      const v = grid[r * COLS + c];
      s += RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(Math.pow(v, 0.7) * (RAMP.length - 1))))];
    }
    lines.push('|' + s + '|');
  }
  console.log('\n=== ' + title + ' ===');
  console.log('+' + '-'.repeat(COLS) + '+');
  console.log(lines.join('\n'));
  console.log('+' + '-'.repeat(COLS) + '+');
};

const lookAt = (target, distMul, radiusRef) => {
  const p = target.pos;
  const R = radiusRef === undefined ? target.radius : radiusRef;
  // Ставим корабль на линии солнце->тело со сдвигом, чтобы была видна фаза
  const d = R * distMul;
  game.ship.pos.x = p.x + d * 0.75;
  game.ship.pos.y = p.y + d * 0.30;
  game.ship.pos.z = p.z + d * 0.59;
  const f = { x: p.x - game.ship.pos.x, y: p.y - game.ship.pos.y, z: p.z - game.ship.pos.z };
  const l = Math.hypot(f.x, f.y, f.z);
  game.ship.basis.fwd = { x: f.x / l, y: f.y / l, z: f.z / l };
  const rl = Math.hypot(-f.z, 0, f.x) || 1;
  game.ship.basis.right = { x: -f.z / rl, y: 0, z: f.x / rl };
  const b = game.ship.basis;
  b.up = {
    x: b.fwd.y * b.right.z - b.fwd.z * b.right.y,
    y: b.fwd.z * b.right.x - b.fwd.x * b.right.z,
    z: b.fwd.x * b.right.y - b.fwd.y * b.right.x,
  };
};

const st = game.world.home.station;
lookAt(st, 8, 0.5);
show('станция «Кориолис» с 4 км, порт в кадре');

lookAt(st, 2.2, 0.5);
show('створ порта вблизи (~1.1 км)');

game.state.view = 'chase';
lookAt(game.world.home, 3);
show('вид от 3-го лица: свой корабль над планетой-океаном');
game.state.view = 'cockpit';

lookAt(game.world.home, 2.4);
show('планета-океан: терминатор, континенты, атмосфера');

// Вход в атмосферу: корабль падает на планету с воздухом, и вокруг него
// разгорается ударная волна. На запасном пути (Canvas 2D) шейдера нет, и
// рисуются ореолы по потоку — по ним и видно, что нагрев дошёл до
// отрисовки и стоит там, где надо: впереди корабля, а не вокруг него.
{
  const air = game.world.planets.find((p) => p.atmo && p.kind !== 'gas') || game.world.home;
  const { entryState } = await import('../js/game/entry.js');
  const dir = { x: 0.3, y: 0.5, z: 0.81 };
  const dl = Math.hypot(dir.x, dir.y, dir.z);
  dir.x /= dl; dir.y /= dl; dir.z /= dl;
  const alt = air.radius * 0.004;                 // глубоко в воздухе
  game.ship.pos.x = air.pos.x + dir.x * (air.radius + alt);
  game.ship.pos.y = air.pos.y + dir.y * (air.radius + alt);
  game.ship.pos.z = air.pos.z + dir.z * (air.radius + alt);
  // Падаем почти отвесно на полном ходу.
  game.ship.vel.x = -dir.x * 1.2; game.ship.vel.y = -dir.y * 1.2; game.ship.vel.z = -dir.z * 1.2;
  game.ship.basis.fwd = { x: -dir.x, y: -dir.y, z: -dir.z };
  const rl = Math.hypot(-game.ship.basis.fwd.z, 0, game.ship.basis.fwd.x) || 1;
  game.ship.basis.right = { x: -game.ship.basis.fwd.z / rl, y: 0, z: game.ship.basis.fwd.x / rl };
  const b = game.ship.basis;
  b.up = {
    x: b.fwd.y * b.right.z - b.fwd.z * b.right.y,
    y: b.fwd.z * b.right.x - b.fwd.x * b.right.z,
    z: b.fwd.x * b.right.y - b.fwd.y * b.right.x,
  };
  game.entry = entryState(game.world, game.ship, 1);
  game.state.view = 'chase';
  show('вход в атмосферу: плазма впереди корабля, нагрев ' +
    (game.entry ? game.entry.heat.toFixed(2) : '—'));
  game.state.view = 'cockpit';
  game.entry = null;
  game.ship.vel.x = game.ship.vel.y = game.ship.vel.z = 0;
}

const gasP = game.world.planets.find((p) => p.kind === 'gas');
lookAt(gasP, 3.2);
show('газовый гигант с кольцами и полосами');

lookAt(game.world.star, 6);
show('звезда с короной');

const ice = game.world.planets.find((p) => p.kind === 'ice');
lookAt(ice, 5);
show('ледяная планета с полярными шапками');

// --- проверка фаз: камеру ставим относительно направления на солнце ---
const lookPhase = (target, distMul, mode) => {
  const p = target.pos;
  const s = game.world.star.pos;
  // единичный вектор планета -> солнце
  let lx = s.x - p.x, ly = s.y - p.y, lz = s.z - p.z;
  const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  // перпендикуляр к нему
  let px = -lz, py = 0, pz = lx;
  const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
  let dx, dy, dz;
  if (mode === 'full') { dx = lx; dy = ly; dz = lz; }
  else if (mode === 'new') { dx = -lx; dy = -ly; dz = -lz; }
  else { dx = px; dy = py; dz = pz; }          // half
  const d = target.radius * distMul;
  game.ship.pos.x = p.x + dx * d;
  game.ship.pos.y = p.y + dy * d;
  game.ship.pos.z = p.z + dz * d;
  const f = { x: p.x - game.ship.pos.x, y: p.y - game.ship.pos.y, z: p.z - game.ship.pos.z };
  const l = Math.hypot(f.x, f.y, f.z);
  const b = game.ship.basis;
  b.fwd = { x: f.x / l, y: f.y / l, z: f.z / l };
  const rl = Math.hypot(-f.z, 0, f.x) || 1;
  b.right = { x: -f.z / rl, y: 0, z: f.x / rl };
  b.up = {
    x: b.fwd.y * b.right.z - b.fwd.z * b.right.y,
    y: b.fwd.z * b.right.x - b.fwd.x * b.right.z,
    z: b.fwd.x * b.right.y - b.fwd.y * b.right.x,
  };
};

const home = game.world.home;
lookPhase(home, 3, 'full'); show('ФАЗА: солнце за спиной — диск освещён целиком');
lookPhase(home, 3, 'half'); show('ФАЗА: солнце сбоку — освещена половина');
lookPhase(home, 3, 'new');  show('ФАЗА: солнце за планетой — почти чёрный диск');

lookPhase(st, 7, 'full'); show('станция, солнце за спиной: барабан и створ порта');
game.state.view = 'chase';
lookPhase(home, 2.6, 'half'); show('вид от 3-го лица: корабль на фоне планеты');
game.state.view = 'cockpit';

// --- планета вне оси взгляда: проверка силуэта-эллипса ---
const lookOffAxis = (target, distMul, off) => {
  const p = target.pos;
  const s = game.world.star.pos;
  let lx = s.x - p.x, ly = s.y - p.y, lz = s.z - p.z;
  const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  let px = -lz, py = 0, pz = lx;
  const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
  const d = target.radius * distMul;
  // камера сбоку от линии на солнце, чтобы была видна фаза
  game.ship.pos.x = p.x + (lx * 0.6 + px * 0.8) * d;
  game.ship.pos.y = p.y + (ly * 0.6 + py * 0.8) * d;
  game.ship.pos.z = p.z + (lz * 0.6 + pz * 0.8) * d;
  // смотрим МИМО планеты: цель взгляда смещена на off радиусов
  const aim = {
    x: p.x + px * target.radius * off,
    y: p.y + target.radius * off * 0.3,
    z: p.z + pz * target.radius * off,
  };
  const f = { x: aim.x - game.ship.pos.x, y: aim.y - game.ship.pos.y, z: aim.z - game.ship.pos.z };
  const l = Math.hypot(f.x, f.y, f.z);
  const b = game.ship.basis;
  b.fwd = { x: f.x / l, y: f.y / l, z: f.z / l };
  const rl = Math.hypot(-f.z, 0, f.x) || 1;
  b.right = { x: -f.z / rl, y: 0, z: f.x / rl };
  b.up = {
    x: b.fwd.y * b.right.z - b.fwd.z * b.right.y,
    y: b.fwd.z * b.right.x - b.fwd.x * b.right.z,
    z: b.fwd.x * b.right.y - b.fwd.y * b.right.x,
  };
};

lookOffAxis(home, 2.6, 0);   show('планета в центре кадра');
lookOffAxis(home, 2.6, 2.2); show('планета у края кадра: силуэт растянут по радиусу');

// --- вплотную к планете и с поворотом: вырожденный силуэт ---
{
  const R = home.radius;
  const camPos = { x: home.pos.x + R * 1.15, y: home.pos.y, z: home.pos.z };
  const a = 40 * Math.PI / 180;
  const aim = {
    x: camPos.x - Math.cos(a) * R * 10,
    y: camPos.y,
    z: camPos.z + Math.sin(a) * R * 10,
  };
  game.ship.pos.x = camPos.x; game.ship.pos.y = camPos.y; game.ship.pos.z = camPos.z;
  const f = { x: aim.x - camPos.x, y: aim.y - camPos.y, z: aim.z - camPos.z };
  const l = Math.hypot(f.x, f.y, f.z);
  const b = game.ship.basis;
  b.fwd = { x: f.x / l, y: f.y / l, z: f.z / l };
  const rl = Math.hypot(-f.z, 0, f.x) || 1;
  b.right = { x: -f.z / rl, y: 0, z: f.x / rl };
  b.up = {
    x: b.fwd.y * b.right.z - b.fwd.z * b.right.y,
    y: b.fwd.z * b.right.x - b.fwd.x * b.right.z,
    z: b.fwd.x * b.right.y - b.fwd.y * b.right.x,
  };
  show('вплотную к планете, поворот 40°: видна часть кадра, не весь экран');
}
