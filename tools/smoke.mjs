// Smoke-тест кода отрисовки: подменяем canvas/DOM и прогоняем реальные
// кадры main.js во всех режимах. Ловит падения в рендере, HUD и экранах,
// которые иначе видны только в браузере.

const calls = {};
const count = (name) => { calls[name] = (calls[name] || 0) + 1; };

const gradient = { addColorStop() { count('addColorStop'); } };

const ctx = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
      return (...a) => {
        for (const v of a) if (!Number.isFinite(v)) throw new Error(`${String(prop)}: не число (${a.join(',')})`);
        count(String(prop));
        return gradient;
      };
    }
    if (prop === 'measureText') return () => ({ width: 42 });
    if (prop === 'setTransform') return () => count('setTransform');
    if (typeof prop === 'string' && /^(save|restore|beginPath|closePath|fill|stroke|clip|translate|rotate|scale|moveTo|lineTo|arc|ellipse|rect|fillRect|strokeRect|clearRect|fillText|strokeText|drawImage|setLineDash|quadraticCurveTo|bezierCurveTo)$/.test(prop)) {
      return (...a) => {
        for (const v of a) {
          if (typeof v === 'number' && !Number.isFinite(v)) {
            throw new Error(`${prop}(${a.join(',')}): нечисловой аргумент`);
          }
        }
        count(prop);
      };
    }
    return undefined;
  },
  set() { return true; },
});

const el = (id) => ({
  id,
  innerHTML: '',
  textContent: '',
  className: '',
  style: {},
  classList: {
    _s: new Set(),
    add(c) { this._s.add(c); },
    remove(c) { this._s.delete(c); },
    contains(c) { return this._s.has(c); },
  },
  listeners: {},
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
  appendChild() {},
  getContext: () => ctx,
  width: 0, height: 0,
});

const nodes = {
  screen: el('screen'),
  overlay: el('overlay'),
  panel: el('panel'),
  boot: el('boot'),
  bootBtn: el('bootBtn'),
};

globalThis.document = {
  getElementById: (id) => nodes[id] || el(id),
  createElement: (tag) => el(tag),
};

const winListeners = {};
globalThis.window = {
  innerWidth: 1600,
  innerHeight: 900,
  devicePixelRatio: 1,
  addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); },
  removeEventListener() {},
};
// Явно просим Canvas-2D-рендер: WebGL здесь не подменить, его путь
// проверяется отдельно в tools/gl.mjs через мок GL-контекста.
globalThis.location = { search: '?renderer=2d' };
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
globalThis.performance = { now: () => nowMs };
let nowMs = 0;

const key = (code, shift = false) => {
  const ev = { code, repeat: false, preventDefault() {}, shiftKey: shift };
  for (const fn of winListeners.keydown || []) fn(ev);
  // отпускаем сразу — нам нужны только «нажатия»
  for (const fn of winListeners.keyup || []) fn({ code });
};
const holdDown = (code) => {
  for (const fn of winListeners.keydown || []) fn({ code, repeat: false, preventDefault() {} });
};
const release = (code) => {
  for (const fn of winListeners.keyup || []) fn({ code });
};

const frames = (n, dtMs = 16.7) => {
  for (let i = 0; i < n; i++) {
    nowMs += dtMs;
    const cb = rafCb;
    rafCb = null;
    if (!cb) throw new Error('кадр не запросил следующий requestAnimationFrame');
    cb(nowMs);
  }
};

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + msg);
};

const step = async (label, fn) => {
  try { await fn(); ok(true, label); }
  catch (e) { ok(false, label + ' -> ' + e.message); if (process.env.V) console.log(e.stack); }
};

console.log('\n== smoke: отрисовка и режимы ==');

const mod = await import('../js/main.js');
const game = globalThis.window.GAME;   // main.js пишет в window, а не в globalThis

await step('модуль загрузился, игра в порту', () => {
  if (!game) throw new Error('window.GAME не выставлен');
  if (game.state.mode !== 'docked') throw new Error('ожидался режим docked, а не ' + game.state.mode);
});

await step('кадры до нажатия ВЗЛЁТ рисуются', () => frames(3));

await step('нажатие ВЗЛЁТ -> полёт', () => {
  for (const fn of nodes.bootBtn.listeners.click || []) fn();
  if (game.state.mode !== 'flight') throw new Error('режим ' + game.state.mode);
  frames(5);
});

await step('станция в кадре, полигоны рисуются', () => {
  // После вылета корабль смотрит от станции (как и должно быть), поэтому
  // для проверки разворачиваем нос на неё.
  const st = game.ship.dockedAt || game.lastStation;
  const b = game.ship.basis;
  b.fwd = { x: -st.basis.fwd.x, y: -st.basis.fwd.y, z: -st.basis.fwd.z };
  b.right = { ...st.basis.right };
  b.up = {
    x: b.fwd.y * b.right.z - b.fwd.z * b.right.y,
    y: b.fwd.z * b.right.x - b.fwd.x * b.right.z,
    z: b.fwd.x * b.right.y - b.fwd.y * b.right.x,
  };
  frames(10);
  if (!(game.renderStats.polys > 0)) throw new Error('нарисовано 0 полигонов рядом со станцией');
  if (!(calls.fill > 100)) throw new Error('слишком мало заливок: ' + calls.fill);
});

await step('ручное управление: тяга, рыскание, крен, тангаж', () => {
  holdDown('ShiftLeft'); frames(30); release('ShiftLeft');
  holdDown('KeyD'); frames(20); release('KeyD');     // рыскание
  holdDown('KeyE'); frames(20); release('KeyE');     // крен
  holdDown('KeyW'); frames(20); release('KeyW');     // тангаж
  frames(20);
  if (!(game.ship.throttle > 0.1)) throw new Error('тяга не выросла: ' + game.ship.throttle);
  if (!(game.ship.speed > 0)) throw new Error('скорость нулевая');
});

await step('вид от 3-го лица (V) рисует свой корабль', () => {
  const before = calls.fill;
  key('KeyV');
  frames(10);
  if (game.state.view !== 'chase') throw new Error('вид ' + game.state.view);
  if (!(calls.fill > before)) throw new Error('в chase-виде ничего не нарисовано');
  key('KeyV');
  frames(5);
});

await step('переключение цели (Tab) и круиза (T)', () => {
  const t0 = game.nav.index;
  key('Tab'); frames(2);
  if (game.nav.index === t0) throw new Error('цель не сменилась');
  key('KeyT'); key('KeyT'); frames(2);
  if (game.cruise.index < 0) throw new Error('индекс круиза ' + game.cruise.index);
});

await step('автопилот (J) ведёт к цели', () => {
  // Цель выставляем напрямую: нажатия обрабатываются только внутри кадра,
  // и цикл «жать Tab до нужного имени» без прогона кадров зависал.
  game.nav.index = game.nav.list.findIndex((x) => x.name === 'Lave V');
  const target = game.nav.list[game.nav.index];
  const d0 = Math.hypot(
    target.pos.x - game.ship.pos.x,
    target.pos.y - game.ship.pos.y,
    target.pos.z - game.ship.pos.z);
  key('KeyJ');
  frames(30);
  if (!game.ship.autopilot) throw new Error('автопилот не включился');
  frames(60 * 40, 16.7);
  const d1 = Math.hypot(
    target.pos.x - game.ship.pos.x,
    target.pos.y - game.ship.pos.y,
    target.pos.z - game.ship.pos.z);
  if (!(d1 < d0 * 0.5)) {
    throw new Error(`дистанция почти не изменилась: ${(d0 / 1e3).toFixed(0)} -> ${(d1 / 1e3).toFixed(0)} тыс. км`);
  }
});

await step('карта системы (M)', () => {
  if (game.ship.autopilot) key('KeyJ');
  key('KeyM'); frames(5);
  if (game.state.mode !== 'map') throw new Error('режим ' + game.state.mode);
  key('KeyM'); frames(5);
  if (game.state.mode !== 'flight') throw new Error('режим ' + game.state.mode);
});

await step('справка (H)', () => {
  key('KeyH'); frames(3);
  if (game.state.mode !== 'help') throw new Error('режим ' + game.state.mode);
  key('KeyH'); frames(3);
  if (game.state.mode !== 'flight') throw new Error('режим ' + game.state.mode);
});

await step('отладочный оверлей (~)', () => {
  key('Backquote'); frames(5);
  key('Backquote'); frames(2);
});

await step('докинг-компьютер доводит до стыковки', () => {
  const st = game.world.home.station;
  // Ставим корабль в 15 км от порта и целимся в станцию
  game.nav.index = game.nav.list.indexOf(st);
  game.ship.pos.x = st.pos.x + st.basis.fwd.x * 15;
  game.ship.pos.y = st.pos.y + st.basis.fwd.y * 15;
  game.ship.pos.z = st.pos.z + st.basis.fwd.z * 15;
  game.ship.speed = 0; game.ship.throttle = 0;
  key('KeyC');
  frames(60 * 130, 16.7);
  if (game.state.mode !== 'docked') throw new Error('режим ' + game.state.mode + ', фаза ' + (game.ship.docking && game.ship.docking.phase) + ', причина: ' + game.crashReason);
});

await step('вылет со станции по Space', () => {
  key('Space'); frames(10);
  if (game.state.mode !== 'flight') throw new Error('режим ' + game.state.mode);
});

await step('столкновение с планетой -> экран крушения', () => {
  const p = game.world.home;
  game.ship.pos.x = p.pos.x + p.radius * 0.999;   // внутрь поверхности
  game.ship.pos.y = p.pos.y;
  game.ship.pos.z = p.pos.z;
  frames(20);
  if (game.state.mode !== 'crashed') throw new Error('режим ' + game.state.mode);
  key('Space'); frames(10);
  if (game.state.mode !== 'docked') throw new Error('после рестарта режим ' + game.state.mode);
});

await step('пролёт у планеты крупным планом (терминатор, кольца)', () => {
  key('Space'); frames(5);
  const gasP = game.world.planets.find((x) => x.kind === 'gas');
  for (const d of [1.02, 1.2, 2, 6, 40]) {
    game.ship.pos.x = gasP.pos.x + gasP.radius * d;
    game.ship.pos.y = gasP.pos.y;
    game.ship.pos.z = gasP.pos.z;
    frames(4);
  }
  // и внутрь звезды — не должно падать
  game.ship.pos.x = game.world.star.pos.x;
  game.ship.pos.y = game.world.star.pos.y;
  game.ship.pos.z = game.world.star.pos.z;
  frames(3);
});

await step('телепорт к цели (K) и смена высоты (Shift+K)', () => {
  if (game.state.mode === 'crashed') { key('Space'); frames(5); }
  if (game.state.mode === 'docked') { key('Space'); frames(5); }
  const moon = game.world.bodies.find((b) => b.kind === 'moon');
  game.nav.index = game.nav.list.indexOf(moon);
  const alts = [];
  for (let i = 0; i < 8; i++) {
    // Shift здесь именно УДЕРЖИВАЕТСЯ через кадр: игра смотрит на клавишу
    // по коду, а нажатия разбираются внутри кадра, а не в момент события.
    holdDown('ShiftLeft');
    key('KeyK');                    // Shift+K: следующая высота и прыжок
    frames(1);
    release('ShiftLeft');
    frames(2);
    if (game.state.mode !== 'flight') {
      throw new Error('режим после телепорта ' + game.state.mode + ': ' + game.crashReason);
    }
    if (!game.zone || game.zone.body !== moon) {
      // На больших высотах зоны нет — считаем высоту по сфере.
      const d = Math.hypot(
        game.ship.pos.x - moon.pos.x, game.ship.pos.y - moon.pos.y, game.ship.pos.z - moon.pos.z);
      alts.push(d - moon.radius);
    } else {
      alts.push(game.zone.alt);
    }
  }
  // Каждый прыжок должен ставить корабль на свою высоту, и все они разные.
  if (process.env.TP) console.log('   высоты:', alts.map((a) => a.toFixed(2)).join(', '));
  if (new Set(alts.map((a) => a.toFixed(3))).size < 5) {
    throw new Error('высоты телепорта не меняются: ' + alts.map((a) => a.toFixed(2)).join(', '));
  }
  if (alts.some((a) => a < 0)) throw new Error('телепорт под поверхность: ' + alts.join(', '));
  // Скорость гасится в момент прыжка; за следующие кадры она успевает
  // чуть подрасти от удерживаемого Shift (это же и клавиша тяги).
  if (game.ship.speed > 0.05) throw new Error('после телепорта осталась скорость ' + game.ship.speed);

  // K без Shift — тот же прыжок на той же высоте.
  const before = { ...game.ship.pos };
  key('KeyK'); frames(3);
  const moved = Math.hypot(
    game.ship.pos.x - before.x, game.ship.pos.y - before.y, game.ship.pos.z - before.z);
  if (moved > 1) throw new Error('K без Shift сменил высоту (сдвиг ' + moved.toFixed(1) + ' км)');

  // И к станции — туда телепорт ставит у створа порта.
  const st = game.world.home.station;
  game.nav.index = game.nav.list.indexOf(st);
  key('KeyK'); frames(3);
  const d = Math.hypot(
    game.ship.pos.x - st.pos.x, game.ship.pos.y - st.pos.y, game.ship.pos.z - st.pos.z);
  if (!(d > 3 && d < 12)) throw new Error('телепорт к станции: дистанция ' + d.toFixed(1) + ' км');
});

await step('шасси выпускается и убирается по G', () => {
  // Возвращаемся в полёт: предыдущий шаг оставляет корабль внутри звезды.
  if (game.state.mode === 'crashed') { key('Space'); frames(5); }
  if (game.state.mode === 'docked') { key('Space'); frames(5); }
  key('KeyG'); frames(60 * 3);
  if (!(game.ship.gear.t > 0.99)) throw new Error('шасси не выпустилось: ' + game.ship.gear.t);
  key('KeyG'); frames(60 * 3);
  if (game.ship.gear.t !== 0) throw new Error('шасси не убралось: ' + game.ship.gear.t);
});

await step('посадочный компьютер (L) доводит до грунта луны', () => {
  const moon = game.world.bodies.find((b) => b.kind === 'moon');
  game.nav.index = game.nav.list.indexOf(moon);
  const d = { x: 0.3, y: 0.7, z: 0.6 };
  const l = Math.hypot(d.x, d.y, d.z);
  const R = moon.radius * 1.4;
  game.ship.pos.x = moon.pos.x + d.x / l * R;
  game.ship.pos.y = moon.pos.y + d.y / l * R;
  game.ship.pos.z = moon.pos.z + d.z / l * R;
  game.ship.speed = 0;
  game.ship.throttle = 0;
  const b = game.ship.basis;
  b.fwd = { x: -d.x / l, y: -d.y / l, z: -d.z / l };
  b.right = { x: -b.fwd.z, y: 0, z: b.fwd.x };
  const rl = Math.hypot(b.right.x, b.right.y, b.right.z);
  b.right = { x: b.right.x / rl, y: 0, z: b.right.z / rl };
  b.up = {
    x: b.fwd.y * b.right.z - b.fwd.z * b.right.y,
    y: b.fwd.z * b.right.x - b.fwd.x * b.right.z,
    z: b.fwd.x * b.right.y - b.fwd.y * b.right.x,
  };
  key('KeyL');
  frames(30);
  if (!game.ship.landing) throw new Error('посадочный компьютер не включился');
  for (let i = 0; i < 400 && game.state.mode === 'flight'; i++) frames(60);
  if (game.state.mode !== 'landed') {
    throw new Error('режим ' + game.state.mode + ', фаза ' +
      (game.ship.landing && game.ship.landing.phase) + ', причина: ' + game.crashReason);
  }
  if (!(game.stats.landings > 0)) throw new Error('посадка не засчитана');
});

await step('стоянка на поверхности и взлёт по Space', () => {
  frames(60 * 10);
  if (game.state.mode !== 'landed') throw new Error('режим ' + game.state.mode);
  // Стоянка обязана попасть в сейв: в локальных осях тела, иначе через
  // сутки эти координаты указывали бы в пустоту.
  const saved = JSON.parse(store['solar_trader_save_v1']);
  if (!saved.landed || !saved.landed.pose || !saved.landed.id) {
    throw new Error('стоянка не сохранена: ' + JSON.stringify(saved.landed));
  }
  if (!saved.gear) throw new Error('состояние шасси не сохранено');
  key('Space'); frames(30);
  if (game.state.mode !== 'flight') throw new Error('после взлёта режим ' + game.state.mode);
  if (!game.ship.vtol) throw new Error('посадочный режим не включён после отрыва');
  frames(60 * 5);
});

await step('изменение размера окна', () => {
  window.innerWidth = 640; window.innerHeight = 1000;
  for (const fn of winListeners.resize || []) fn();
  frames(5);
  window.innerWidth = 1920; window.innerHeight = 1080;
  for (const fn of winListeners.resize || []) fn();
  frames(5);
});

await step('сохранение в localStorage', () => {
  frames(60 * 6);
  if (!store['solar_trader_save_v1']) throw new Error('сейв не записан');
  JSON.parse(store['solar_trader_save_v1']);
});

console.log('\nвызовов ctx:', Object.entries(calls)
  .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(' '));
console.log(fails === 0 ? 'SMOKE OK' : fails + ' SMOKE FAIL');
process.exit(fails ? 1 : 0);
