// Smoke-тест кода отрисовки: подменяем canvas/DOM и прогоняем реальные
// кадры main.js во всех режимах. Ловит падения в рендере, HUD и экранах,
// которые иначе видны только в браузере.

const calls = {};
let texts = null;        // включается на время проверки вёрстки
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
        // Надписи запоминаем с координатами: по ним проверяется вёрстка
        // приборов (см. проверку панели подхода).
        if (prop === 'fillText' && texts) texts.push({ s: String(a[0]), x: a[1], y: a[2] });
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
  hud: el('hud'),
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
// События мыши идут через ОКНО: канвасы для них либо сквозные, либо
// перекрыты оверлеями (см. Input.attachMouse). Мок про CSS ничего не
// знает, поэтому слушать здесь надо ровно то же окно, что и в игре —
// иначе проверка зелёная, а в браузере не работает: так и вышло, когда
// события вешались на канвас приборов.
const mouse = (type, opts = {}) => {
  for (const fn of winListeners[type] || []) {
    fn({ button: 2, movementX: 0, movementY: 0, preventDefault() {}, ...opts });
  }
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
const { lookAlong } = await import('../js/core/basis.js');
const { exitPoint } = await import('../js/game/quantum.js');

// Навести нос на точку выхода привода. В игре это делает игрок ручкой;
// здесь достаточно поставить базис — проверяется не пилотирование, а
// сам привод.
const aimAt = (target) => {
  const p = exitPoint(target, game.ship.pos);
  const dx = p.x - game.ship.pos.x, dy = p.y - game.ship.pos.y, dz = p.z - game.ship.pos.z;
  const L = Math.hypot(dx, dy, dz) || 1;
  lookAlong(game.ship.basis, { x: dx / L, y: dy / L, z: dz / L }, game.ship.basis.up);
};

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

await step('задний ход по длинному Ctrl', () => {
  key('KeyX'); frames(5);                 // с нуля
  holdDown('ControlLeft'); frames(120); release('ControlLeft'); frames(10);
  if (!(game.ship.throttle < -0.3)) {
    throw new Error('тяга не ушла назад: ' + game.ship.throttle.toFixed(2));
  }
  // Скорость — вектор, ship.speed её модуль; ход назад читается
  // проекцией на нос.
  const f = game.ship.basis.fwd, v = game.ship.vel;
  if (!(v.x * f.x + v.y * f.y + v.z * f.z < 0)) {
    throw new Error('корабль не поехал назад');
  }
  const back = game.ship.speed;
  key('KeyX'); frames(120);
  if (!(back < 0.3)) throw new Error('задний ход слишком быстрый: ' + back);
  if (Math.abs(game.ship.speed) > 1e-6) throw new Error('X не останавливает на заднем ходу');
});

await step('подъёмные движки (R/F) и полная тяга (Z)', () => {
  key('KeyX'); frames(20);
  holdDown('KeyR'); frames(40);
  const up = game.ship.lift;
  release('KeyR');
  holdDown('KeyF'); frames(60);
  const down = game.ship.lift;
  release('KeyF'); frames(30);
  // lift — это ТЯГА подъёмных движков (км/с²), а не скорость.
  if (!(up > 0)) throw new Error('R не даёт тяги вверх: ' + up);
  if (!(down < 0)) throw new Error('F не даёт тяги вниз: ' + down);
  key('KeyZ'); frames(2);
  if (game.ship.throttle !== 1) throw new Error('Z не даёт полную тягу: ' + game.ship.throttle);
  key('KeyX'); frames(2);
  if (game.ship.throttle !== 0) throw new Error('X не сбрасывает тягу: ' + game.ship.throttle);
});

await step('осмотр камерой правой кнопкой из-за спины', () => {
  const view0 = game.state.view;
  if (game.state.view !== 'chase') { key('KeyV'); frames(2); }
  const fwd0 = { ...game.camera.basis.fwd };
  mouse('mousedown');
  mouse('mousemove', { movementX: 160, movementY: 40 });
  frames(1);
  if (!(game.camOrbit.yaw > 0.3)) throw new Error('ПКМ не поворачивает: ' + game.camOrbit.yaw);
  const turned = Math.acos(Math.max(-1, Math.min(1,
    fwd0.x * game.camera.basis.fwd.x + fwd0.y * game.camera.basis.fwd.y +
    fwd0.z * game.camera.basis.fwd.z)));
  if (!(turned > 0.3)) throw new Error('камера не развернулась: ' + turned.toFixed(2));
  // Мышь без зажатой кнопки камеру не трогает.
  mouse('mouseup');
  const yawAfter = game.camOrbit.yaw;
  mouse('mousemove', { movementX: 300 });
  frames(1);
  if (game.camOrbit.yaw > yawAfter) throw new Error('камера крутится без кнопки');
  // Отпустили — сама возвращается за спину.
  frames(120);
  if (Math.abs(game.camOrbit.yaw) > 0.02 || Math.abs(game.camOrbit.pitch) > 0.02) {
    throw new Error('камера не вернулась: ' + game.camOrbit.yaw.toFixed(3));
  }
  if (game.state.view !== view0) { key('KeyV'); frames(2); }
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

await step('переключение цели (Tab) и форсаж (Space)', () => {
  const t0 = game.nav.index;
  key('Tab'); frames(2);
  if (game.nav.index === t0) throw new Error('цель не сменилась');
  // Форсаж на удержании: заряд тратится, потом восстанавливается.
  // Тягу при этом НЕ даём: рядом станция, и разгон вдвое от неё — это
  // проверка не форсажа, а прочности корпуса.
  game.ship.throttle = 0;
  holdDown('Space'); frames(120);
  const spent = game.ship.boost;
  if (!(spent < 0.9)) throw new Error('заряд форсажа не тратится: ' + spent.toFixed(2));
  if (!game.ship.boosting) throw new Error('форсаж не включился');
  release('Space'); frames(120);
  if (!(game.ship.boost > spent)) throw new Error('заряд не восстанавливается');
  if (game.ship.boosting) throw new Error('форсаж не выключился');
});

await step('квантовый привод (B) доводит до цели', () => {
  // Цель выставляем напрямую: нажатия обрабатываются только внутри кадра,
  // и цикл «жать Tab до нужного имени» без прогона кадров зависал.
  game.nav.index = game.nav.list.findIndex((x) => x.name === 'Lave V');
  const target = game.nav.list[game.nav.index];
  const d0 = Math.hypot(
    target.pos.x - game.ship.pos.x,
    target.pos.y - game.ship.pos.y,
    target.pos.z - game.ship.pos.z);

  // Перелёт целиком, как его делает игрок: прямой коридор от станции
  // перекрыт своей же планетой, привод подставляет обходную точку, и
  // прыжков получается несколько.
  let arrived = false;
  for (let hop = 0; hop < 5 && !arrived; hop++) {
    const back = game.nav.list.indexOf(target);
    if (back >= 0) game.nav.index = back;
    aimAt(target);
    key('KeyB'); frames(4);
    if (game.quantum.phase === 'idle') {
      const detour = game.nav.list[game.nav.index];
      if (detour === target) throw new Error('маршрут не найден: ' + (game.quantum.reason || '—'));
      aimAt(detour);
      key('KeyB'); frames(4);
      if (game.quantum.phase === 'idle') throw new Error('обход тоже отказал');
    }
    const leg = game.quantum.target;
    for (let i = 0; i < 400 && game.quantum.phase === 'calib'; i++) { aimAt(leg); frames(1); }
    if (game.quantum.phase !== 'jump') throw new Error('прыжок не начался');
    for (let i = 0; i < 60 * 150 && game.quantum.phase === 'jump'; i++) frames(1);
    if (game.quantum.phase !== 'idle') throw new Error('прыжок не закончился');
    if (leg === target) arrived = true;
  }
  if (!arrived) throw new Error('не дошли за пять прыжков');
  const d1 = Math.hypot(
    target.pos.x - game.ship.pos.x,
    target.pos.y - game.ship.pos.y,
    target.pos.z - game.ship.pos.z);
  if (!(d1 < d0 * 0.1)) {
    throw new Error(`не долетели: ${(d0 / 1e3).toFixed(0)} -> ${(d1 / 1e3).toFixed(0)} тыс. км`);
  }
  if (!(game.ship.speed < 0.001)) throw new Error('скорость на выходе ' + game.ship.speed);
});

await step('карта системы (M)', () => {
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

await step('панель подхода: всё в одном месте и вокруг прицела', () => {
  const moon = game.world.bodies.find((b) => b.kind === 'moon');
  game.nav.index = game.nav.list.indexOf(moon);
  // Телепорт на малую высоту: там панель показывает и посадочные условия.
  game.teleAlt = 4;                       // 3 км (см. TELEPORT_ALTS)
  key('KeyK'); frames(3);
  if (!game.capture) throw new Error('нет гравитационного захвата у поверхности луны');

  texts = [];
  frames(1);
  const seen = texts;
  texts = null;

  const has = (re) => seen.some((t) => re.test(t.s));
  for (const re of [/ЗАХВАТ/, /ТЯЖЕСТЬ/, /ВЫСОТА/, /СКОРОСТЬ/, /ВЕРТ/, /БОК/, /ДО ЦЕЛИ/]) {
    if (!has(re)) throw new Error('панель не показывает ' + re);
  }

  // Ничего не продублировано: то, что переехало в центр, из углов ушло.
  // Две копии одного числа хуже одной — глаз всё равно мечется.
  const count = (re) => seen.filter((t) => re.test(t.s)).length;
  for (const [re, name] of [[/^СКОРОСТЬ$/, 'скорость'], [/^ШАССИ/, 'шасси']]) {
    if (count(re) !== 1) throw new Error(`${name}: ${count(re)} надписей вместо одной`);
  }
  if (count(/^ДИСТ/) !== 0) throw new Error('дистанция осталась и в углу');

  // Отметка грунта: кольцо под кораблём и высота рядом с нитью. Это
  // главный признак масштаба у поверхности, и рисуется он только когда
  // земля близко.
  {
    game.teleAlt = 6;                     // 0.05 км
    key('KeyK'); frames(3);
    // Из кабины точка под кораблём остаётся за спиной у камеры — это
    // верно и так и должно быть; смотрим из-за корпуса.
    if (game.state.view !== 'chase') { key('KeyV'); frames(2); }
    // Пунктир (setLineDash) в приборах больше никто не рисует, поэтому по
    // нему отметку видно однозначно; кольцо считаем по отрезкам.
    const l0 = calls.lineTo || 0, d0 = calls.setLineDash || 0;
    frames(1);
    const ring = (calls.lineTo || 0) - l0;
    const dash = (calls.setLineDash || 0) - d0;
    if (dash < 2) throw new Error('нити отметки нет: пунктир не рисовался');
    if (ring < 16) throw new Error('кольцо отметки не нарисовано: ' + ring + ' отрезков');

    game.teleAlt = 0;                     // 2000 км — далеко, отметки быть не должно
    key('KeyK'); frames(3);
    const l1 = calls.lineTo || 0, d1 = calls.setLineDash || 0;
    frames(1);
    if ((calls.setLineDash || 0) - d1 > 0) throw new Error('отметка рисуется и с орбиты');
    if ((calls.lineTo || 0) - l1 > ring - 16) throw new Error('кольцо рисуется и с орбиты');
  }

  // Вёрстка: всё внутри рамки вокруг прицела, а сама середина свободна —
  // иначе приборы закрывали бы то, на что целятся.
  const w = window.innerWidth, h = window.innerHeight;
  const cx = w / 2, cy = h / 2;
  const BW = Math.min(Math.max(w * 0.10, 120), 220);
  const BH = Math.min(Math.max(h * 0.13, 92), 160);
  // Приборы занимают рамку вокруг прицела плюс шкалу тяжести справа от
  // неё; середина рамки обязана остаться пустой.
  const inFrame = (t) => Math.abs(t.x - cx) <= BW && Math.abs(t.y - cy) <= BH;
  const inGauge = (t) => t.x > cx + BW && t.x < cx + BW + 130 &&
    Math.abs(t.y - cy) <= BH + 60;
  const mine = seen.filter((t) => Math.abs(t.x - cx) <= BW + 160 &&
    Math.abs(t.y - cy) <= BH + 70);
  if (mine.length < 12) throw new Error('в панели всего ' + mine.length + ' надписей');
  for (const t of mine) {
    if (!inFrame(t) && !inGauge(t)) {
      throw new Error(`надпись «${t.s}» вылезла из приборов: ${(t.x - cx).toFixed(0)}, ${(t.y - cy).toFixed(0)}`);
    }
    if (Math.abs(t.x - cx) < 40 && Math.abs(t.y - cy) < 30) {
      throw new Error(`надпись «${t.s}» лезет на прицел`);
    }
  }
});

await step('удар о грунт: отскок, урон и потеря управления', () => {
  const moon = game.world.bodies.find((b) => b.kind === 'moon');
  game.nav.index = game.nav.list.indexOf(moon);
  game.teleAlt = 6;                       // 0.05 км над грунтом
  key('KeyK'); frames(3);
  const ship = game.ship;
  ship.gear.out = true; ship.gear.t = 1;
  ship.hull = 100;
  // Разгоняем вдоль грунта и подталкиваем вниз: приход с ходу.
  const up = { x: ship.pos.x - moon.pos.x, y: ship.pos.y - moon.pos.y, z: ship.pos.z - moon.pos.z };
  const l = Math.hypot(up.x, up.y, up.z);
  up.x /= l; up.y /= l; up.z /= l;
  const f = ship.basis.fwd;
  const v = 0.12;
  ship.vel.x = f.x * v - up.x * 0.01;
  ship.vel.y = f.y * v - up.y * 0.01;
  ship.vel.z = f.z * v - up.z * 0.01;
  ship.throttle = 1;

  let stunSeen = false, hull0 = ship.hull;
  for (let i = 0; i < 600 && game.state.mode === 'flight'; i++) {
    frames(1);
    if (game.ship.stun > 0) stunSeen = true;
    if (game.ship.hull < hull0) break;
  }
  if (game.state.mode === 'crashed') {
    // Тоже допустимый исход, но корпус должен был кончиться, а не
    // «разрушиться от касания».
    if (!/корпус/i.test(game.crashReason || '')) {
      throw new Error('разрушение не от корпуса: ' + game.crashReason);
    }
  } else {
    if (!(game.ship.hull < hull0)) throw new Error('удар не снял ни процента корпуса');
    if (!stunSeen) throw new Error('после удара не было потери управления');
    if (game.ship.hull <= 0) throw new Error('корпус ушёл в минус без крушения');
  }
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
  // Высота — та, на которой выбрасывает квантовый привод: это и есть
  // единственный способ оказаться у луны, а с половины радиуса спуск
  // на своих 1.2 км/с занимал бы десять минут модельного времени.
  const R = moon.radius + 250;
  game.ship.pos.x = moon.pos.x + d.x / l * R;
  game.ship.pos.y = moon.pos.y + d.y / l * R;
  game.ship.pos.z = moon.pos.z + d.z / l * R;
  // Скорость гасим ВЕКТОРОМ: прошлые шаги оставили её на корабле, и с
  // ней компьютер начинал спуск уже разогнанным.
  game.ship.vel.x = 0; game.ship.vel.y = 0; game.ship.vel.z = 0;
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
  for (let i = 0; i < 500 && game.state.mode === 'flight'; i++) frames(60);
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
  // Отрыв — это импульс по местной вертикали, а не «ход движков».
  {
    const b = game.ship.landedAt || game.zone && game.zone.body;
    const p = game.ship.pos, c = b ? b.pos : { x: 0, y: 0, z: 0 };
    const ux = p.x - c.x, uy = p.y - c.y, uz = p.z - c.z;
    const l = Math.hypot(ux, uy, uz) || 1;
    const v = game.ship.vel;
    if (!((v.x * ux + v.y * uy + v.z * uz) / l > 0.001)) {
      throw new Error('после отрыва корабль не идёт вверх');
    }
  }
  frames(60 * 5);
});

await step('рестарт с начала по Shift+N (с подтверждением)', () => {
  // Наигрываем состояние, которое рестарт обязан снести.
  game.stats.docks = 7;
  game.stats.landings = 3;
  game.ship.hull = 42;
  game.world.time = 12345;
  frames(2);

  // Одного нажатия мало: сначала предупреждение.
  holdDown('ShiftLeft');
  key('KeyN');
  frames(2);
  release('ShiftLeft');
  if (game.state.mode === 'docked' && game.ship.hull === 100) {
    throw new Error('рестарт случился с одного нажатия');
  }
  if (!game.state.messages.some((m) => /ЕЩЁ РАЗ/.test(m.text))) {
    throw new Error('нет предупреждения о рестарте');
  }

  // Второе нажатие в окне подтверждения — рестарт.
  holdDown('ShiftLeft');
  key('KeyN');
  frames(2);
  release('ShiftLeft');
  frames(3);

  if (game.state.mode !== 'docked') throw new Error('после рестарта режим ' + game.state.mode);
  if (game.ship.dockedAt !== game.world.home.station) {
    throw new Error('рестарт не в порту родной станции');
  }
  if (game.ship.hull !== 100) throw new Error('корпус не восстановлен: ' + game.ship.hull);
  if (game.stats.docks !== 0 || game.stats.landings !== 0) {
    throw new Error('счётчики не обнулены: ' + JSON.stringify(game.stats));
  }
  if (game.world.time > 1) throw new Error('часы мира не обнулены: ' + game.world.time);
  const saved = JSON.parse(store['solar_trader_save_v1'] || 'null');
  if (!saved || saved.hull !== 100 || (saved.stats && saved.stats.docks !== 0)) {
    throw new Error('сохранение не переписано: ' + JSON.stringify(saved && saved.stats));
  }

  // Окно подтверждения закрывается само.
  holdDown('ShiftLeft');
  key('KeyN');
  frames(2);
  release('ShiftLeft');
  frames(60 * 5);                       // ждём дольше окна
  const before = game.world.time;
  holdDown('ShiftLeft');
  key('KeyN');
  frames(2);
  release('ShiftLeft');
  if (game.world.time < before) throw new Error('рестарт сработал после истечения окна');
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
