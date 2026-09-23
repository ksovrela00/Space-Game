// Smoke-тест кода отрисовки: подменяем canvas/DOM и прогоняем реальные
// кадры main.js во всех режимах. Ловит падения в рендере, HUD и экранах,
// которые иначе видны только в браузере.

const calls = {};
let texts = null;        // включается на время проверки вёрстки
let rects = null;        // то же для полосок: у них нет текста
// Выравнивание и шрифт на момент вызова. Без них координата fillText
// бессмысленна: при textAlign='right' это ПРАВЫЙ край строки, и проверка
// вёрстки считала бы, что надпись уехала вправо на свою длину.
const style = { align: 'left', font: '13px' };
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
    // Ширина текста считается по кеглю и длине строки, а не отдаётся
    // постоянной. Постоянная (было 42) молча отключает ВСЯКИЙ перенос и
    // всякую подгонку по ширине: код их вызывает, а проверка их не
    // видит. Моноширинный Consolas — ровно тот случай, когда такую
    // оценку можно дать честно: 0.55 em на знак.
    if (prop === 'measureText') {
      return (t) => ({ width: String(t).length * (parseFloat(style.font) || 13) * 0.55 });
    }
    if (prop === 'setTransform') return () => count('setTransform');
    if (typeof prop === 'string' && /^(save|restore|beginPath|closePath|fill|stroke|clip|translate|rotate|scale|transform|setTransform|resetTransform|moveTo|lineTo|arc|ellipse|rect|fillRect|strokeRect|clearRect|fillText|strokeText|drawImage|setLineDash|quadraticCurveTo|bezierCurveTo)$/.test(prop)) {
      return (...a) => {
        for (const v of a) {
          if (typeof v === 'number' && !Number.isFinite(v)) {
            throw new Error(`${prop}(${a.join(',')}): нечисловой аргумент`);
          }
        }
        // Надписи запоминаем с координатами: по ним проверяется вёрстка
        // приборов (см. проверку панели подхода).
        if (prop === 'fillText' && texts) {
          texts.push({ s: String(a[0]), x: a[1], y: a[2], align: style.align, font: style.font });
        }
        // Прямоугольники — тем же способом и по той же причине: полоски
        // корпуса и щита никакого текста не рисуют, и проверить их можно
        // только по координатам.
        if (prop === 'fillRect' && rects) {
          rects.push({ x: a[0], y: a[1], w: a[2], h: a[3], fill: style.fill });
        }
        count(prop);
      };
    }
    return undefined;
  },
  set(_t, prop, v) {
    if (prop === 'textAlign') style.align = String(v);
    else if (prop === 'font') style.font = String(v);
    return true;
  },
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
    toggle(c, on) { if (on === undefined ? this._s.has(c) : !on) this._s.delete(c); else this._s.add(c); },
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
// touch=1 — принудительно мобильный профиль: касаний в Node нет, а
// сенсорные органы проверять надо (js/core/quality.js).
// offline=1 — этот набор проверяет ИГРУ, а не сеть: сервер здесь не
// поднят, и игра обязана работать без него ровно как раньше. Сетевой
// запуск (вход, состояние с сервера, сохранение по сети) проверяется
// отдельно — tools/net.mjs, где для этого подменяется fetch.
globalThis.location = {
  search: '?renderer=2d&touch=1&offline=1',
  origin: 'http://localhost',
  pathname: '/space_game/index.html',
  replace(url) { this.replaced = url; },
  replaced: null,
};
// Язык проверок — русский: в них сверяются НАДПИСИ, и держать их в двух
// видах значило бы писать каждую проверку дважды. Английский путь
// проверяется отдельным шагом, который язык переключает сам.
const store = { solar_lang: 'ru' };
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
// Сейв ищется по началу ключа, а не по полному имени. Версия в ключе
// меняется всякий раз, когда старое сохранение перестаёт быть
// осмысленным (последний раз — когда в систему добавили планеты и
// сдвинулись id тел), и три проверки ниже каждый раз падали не по делу.
// Отсутствие сейва так же видно: ключ не найдётся и разбор упадёт.
const savedJson = () => store[Object.keys(store).find((k) => k.startsWith('solar_trader_save_')) || ''];
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
/**
 * Касание: браузер шлёт список ИЗМЕНИВШИХСЯ точек, а не всех активных,
 * поэтому мок устроен так же — иначе проверка проверяла бы не то, что
 * приходит игре на самом деле.
 */
const touch = (type, points) => {
  const ev = {
    type,
    changedTouches: points.map((p) => ({ identifier: p.id, clientX: p.x, clientY: p.y })),
    cancelable: true,
    preventDefault() {},
  };
  for (const fn of winListeners[type] || []) fn(ev);
};

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

// Характеристики корабля — до игры: main.js собирает корабль прямо при
// разборе своего модуля, а числа для этого приходят из бэкенда. В
// браузере тем же занят js/boot.js, здесь — слепок с диска.
const { loadSpecsFromDisk } = await import('./specs.mjs');
loadSpecsFromDisk();

const mod = await import('../js/main.js');
const game = globalThis.window.GAME;   // main.js пишет в window, а не в globalThis
const { lookAlong } = await import('../js/core/basis.js');
const { exitPoint } = await import('../js/game/quantum.js');
const { SHIP } = await import('../js/game/ship.js');
const { fmtCrowns } = await import('../js/ui/menu.js');
const { addMission } = await import('../js/game/player.js');
const { net } = await import('../js/net/socket.js');
const { setLang } = await import('../js/core/lang.js');

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

// Английский язык целиком: приборы, меню, карта и справка. Проверка
// смотрит не только на то, что нужные слова появились, но и на то, что
// РУССКИХ не осталось, — наполовину переведённый экран выглядит хуже
// нетронутого.
await step('английский язык: приборы, меню, карта, справка', () => {
  const CYR = /[А-Яа-яЁё]/;
  if (game.state.mode !== 'flight') { key('Space'); frames(4); }
  // Сообщения на экране написаны на прежнем языке — они и должны такими
  // остаться: переписывать сказанное задним числом незачем. Для проверки
  // их просто убираем.
  game.state.messages.length = 0;
  if (game.state.view !== 'chase') { key('KeyV'); frames(2); }

  const shown = (n = 3) => {
    texts = [];
    frames(n);
    const list = texts.map((t) => t.s);
    texts = null;
    return list;
  };

  setLang('en');
  const hud = shown();
  if (!hud.some((s) => s.indexOf('THRUST') >= 0)) throw new Error('в приборах нет THRUST');
  if (!hud.some((s) => s.indexOf('HULL') >= 0)) throw new Error('в приборах нет HULL');
  const ruHud = hud.filter((s) => CYR.test(s));
  if (ruHud.length) throw new Error('в приборах осталось русское: ' + ruHud.slice(0, 3).join(' | '));

  // Меню пилота.
  key('KeyI');
  const menu = shown();
  if (!menu.some((s) => s.indexOf('PILOT MENU') >= 0)) throw new Error('меню не переведено');
  if (!menu.some((s) => s.indexOf('CARGO') >= 0)) throw new Error('разделы меню не переведены');
  const ruMenu = menu.filter((s) => CYR.test(s));
  if (ruMenu.length) throw new Error('в меню осталось русское: ' + ruMenu.slice(0, 3).join(' | '));
  key('KeyI');
  frames(2);

  // Карта системы: там же и карточка объекта, собранная из каталога.
  key('KeyM');
  const map = shown();
  if (!map.some((s) => s.indexOf('SYSTEM MAP') >= 0)) throw new Error('карта не переведена');
  const ruMap = map.filter((s) => CYR.test(s));
  if (ruMap.length) throw new Error('на карте осталось русское: ' + ruMap.slice(0, 3).join(' | '));
  key('KeyM');
  frames(2);

  // Справка — это HTML поверх игры, и её текст надо смотреть в разметке.
  key('KeyH');
  frames(3);
  const help = nodes.panel.innerHTML;
  key('KeyH');
  frames(3);
  if (help.indexOf('CONTROLS') < 0) throw new Error('справка не переведена');
  if (CYR.test(help.replace(/&[a-z]+;/g, ''))) {
    throw new Error('в справке осталось русское: '
      + (help.match(/[^<>]*[А-Яа-яЁё][^<>]*/) || [''])[0].slice(0, 60));
  }

  setLang('ru');
  frames(2);
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

await step('сенсорное управление: джойстик, тяга, кнопки', async () => {
  // Весь путь целиком: событие браузера -> разбор касаний -> управление
  // кораблём. Раскладку берём ту же, что считает игра, — иначе проверка
  // проверяла бы сама себя.
  const { touchLayout } = await import('../js/ui/touch.js');
  const L = touchLayout(window.innerWidth, window.innerHeight,
    { left: 0, right: 0, top: 0, bottom: 0 });
  const ship = game.ship;

  // Джойстик: палец кладём в центр поля и ведём вниз — нос идёт вверх.
  touch('touchstart', [{ id: 1, x: L.stick.x, y: L.stick.y }]);
  touch('touchmove', [{ id: 1, x: L.stick.x, y: L.stick.y + L.stick.r }]);
  frames(3);
  if (!(ship.control.pitch > 0.8)) {
    throw new Error('джойстик не ведёт нос: тангаж ' + ship.control.pitch.toFixed(2));
  }
  touch('touchend', [{ id: 1, x: L.stick.x, y: L.stick.y + L.stick.r }]);
  frames(3);
  if (ship.control.pitch !== 0) {
    throw new Error('отпущенный джойстик не вернулся: ' + ship.control.pitch.toFixed(2));
  }

  // Ползунок тяги: абсолютное положение.
  const top = L.thr.y - L.thr.h / 2;
  touch('touchstart', [{ id: 2, x: L.thr.x, y: top + L.thr.h * 0.5 }]);
  frames(2);
  if (Math.abs(ship.throttle - 0.5) > 0.03) {
    throw new Error('ползунок не задал тягу: ' + ship.throttle.toFixed(2));
  }
  touch('touchend', [{ id: 2, x: L.thr.x, y: top + L.thr.h * 0.5 }]);
  ship.throttle = 0;
  frames(2);

  // Кнопка: шасси выпускается тем же действием, что и по клавише G.
  const gear = L.buttons.find((b) => b.id === 'gear');
  const out0 = game.ship.gear.out;
  touch('touchstart', [{ id: 3, x: gear.x, y: gear.y }]);
  frames(2);
  touch('touchend', [{ id: 3, x: gear.x, y: gear.y }]);
  frames(2);
  if (game.ship.gear.out === out0) throw new Error('кнопка шасси не сработала');
  // Возвращаем как было БЕЗ ожидания хода механизма: три секунды
  // модельного времени здесь ничего не проверяют, а следующим шагам
  // сдвигают мир.
  game.ship.gear.out = out0;
  game.ship.gear.t = out0 ? 1 : 0;

  // Палец по свободному месту — осмотр камерой, а не промах по кнопке.
  const yaw0 = game.camOrbit.yaw;
  touch('touchstart', [{ id: 5, x: window.innerWidth / 2, y: window.innerHeight / 2 }]);
  for (let i = 1; i <= 6; i++) {
    touch('touchmove', [{ id: 5, x: window.innerWidth / 2 + i * 30, y: window.innerHeight / 2 }]);
    frames(1);
  }
  if (!(game.camOrbit.yaw > yaw0 + 0.2)) {
    throw new Error('палец по свободному месту не вертит камеру: ' + game.camOrbit.yaw.toFixed(2));
  }
  touch('touchend', [{ id: 5, x: window.innerWidth / 2, y: window.innerHeight / 2 }]);
  frames(45);
  if (Math.abs(game.camOrbit.yaw) > 0.05) {
    throw new Error('камера не вернулась после касания: ' + game.camOrbit.yaw.toFixed(2));
  }
});

await step('кабина: приборы на доске, осмотр головой, штурвал за ручками', async () => {
  // Кабина есть только в объёмном рендере, а smoke идёт на Canvas-2D
  // (WebGL здесь не подменить). Поэтому модель подставляем руками: нам
  // важна не её отрисовка — её проверяет tools/gl.mjs, — а то, что HUD
  // умеет класть приборы на экраны и не падает на этом.
  const { buildCockpit } = await import('../js/models/cockpit.js');
  const saved = game.cockpit;
  game.cockpit = buildCockpit();
  if (game.state.view !== 'cockpit') { key('KeyV'); frames(2); }
  if (game.state.view !== 'cockpit') throw new Error('вид не переключился в кокпит');
  frames(3);

  // Осмотр головой: в кабине предел меньше, чем от третьего лица, —
  // шея не поворачивается на 180°.
  mouse('mousedown');
  for (let i = 0; i < 4; i++) { mouse('mousemove', { movementX: 360 }); frames(1); }
  const yaw = game.camOrbit.yaw;
  if (!(yaw > 1.5 && yaw <= 1.93)) {
    throw new Error('поворот головы в кабине вне допуска: ' + yaw.toFixed(2));
  }
  mouse('mouseup');
  frames(45);
  if (Math.abs(game.camOrbit.yaw) > 0.05) {
    throw new Error('голова не вернулась прямо: ' + game.camOrbit.yaw.toFixed(2));
  }

  // Штурвал ходит за ручками: держим крен и смотрим, что он отклонился.
  holdDown('KeyE'); frames(20);
  const rolled = game.yoke.roll;
  release('KeyE'); frames(30);
  if (!(Math.abs(rolled) > 0.3)) {
    throw new Error('штурвал не пошёл за ручкой: ' + rolled.toFixed(2));
  }
  if (Math.abs(game.yoke.roll) > 0.05) {
    throw new Error('штурвал не вернулся в нейтраль: ' + game.yoke.roll.toFixed(2));
  }

  game.cockpit = saved;
  frames(2);
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

await step('камера из-за спины догоняет корабль, а не сидит на нём', () => {
  if (game.state.view !== 'chase') { key('KeyV'); frames(2); }
  game.ship.throttle = 0;
  frames(30);
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1,
    a.x * b.x + a.y * b.y + a.z * b.z)));
  // В покое камера стоит ровно за кораблём.
  if (ang(game.camera.basis.up, game.ship.basis.up) > 0.02) {
    throw new Error('камера не села на место в покое');
  }
  // На крене «верх» камеры обязан отставать от корпуса: именно по этому
  // отставанию корабль и читается как тяжёлый.
  holdDown('KeyQ');
  frames(30);
  const lag = ang(game.camera.basis.up, game.ship.basis.up);
  release('KeyQ');
  if (!(lag > 0.08)) throw new Error('камера не отстаёт на крене: ' + lag.toFixed(3));
  if (!(lag < 1.2)) throw new Error('камера отстала слишком сильно: ' + lag.toFixed(3));
  // Перестали крутить — догнала.
  frames(120);
  const settled = ang(game.camera.basis.up, game.ship.basis.up);
  if (!(settled < 0.02)) throw new Error('камера не догнала: ' + settled.toFixed(3));
  key('KeyV'); frames(2);
});

await step('выбор цели наведением (Tab) и форсаж (Space)', () => {
  // Цель выбирается тем, что на неё наведён нос. Наводимся на планету
  // явно: «нажать Tab и посмотреть, что изменилось» теперь ничего не
  // проверяет — могло и не быть под прицелом никого.
  const planet = game.world.home;
  const p = planet.pos, sp = game.ship.pos;
  const d = Math.hypot(p.x - sp.x, p.y - sp.y, p.z - sp.z) || 1;
  const fwd = { x: (p.x - sp.x) / d, y: (p.y - sp.y) / d, z: (p.z - sp.z) / d };
  lookAlong(game.ship.basis, fwd);
  frames(2);
  key('Tab'); frames(2);
  const picked = game.nav.list[game.nav.index];
  if (picked !== planet) {
    throw new Error('наведение не выбрало планету: ' + (picked && picked.name));
  }

  // Форсаж на удержании: заряд тратится, потом восстанавливается.
  // Тягу при этом НЕ даём: рядом станция, и разгон вдвое от неё — это
  // проверка не форсажа, а прочности корпуса.
  game.ship.throttle = 0;
  const fov0 = game.camera.fov;
  holdDown('Space'); frames(6);
  // Рывок по полю зрения: он короткий, поэтому смотрим сразу.
  const fovPunch = game.camera.fov;
  if (!(fovPunch > fov0 + 0.01)) {
    throw new Error('поле зрения не раздвинулось на форсаже: ' +
      (fov0 * 57.3).toFixed(1) + '° -> ' + (fovPunch * 57.3).toFixed(1) + '°');
  }
  frames(120);
  const spent = game.ship.boost;
  if (!(spent < 0.9)) throw new Error('заряд форсажа не тратится: ' + spent.toFixed(2));
  if (!game.ship.boosting) throw new Error('форсаж не включился');
  release('Space'); frames(120);
  if (!(game.ship.boost > spent)) throw new Error('заряд не восстанавливается');
  if (game.ship.boosting) throw new Error('форсаж не выключился');
  // Стоя на месте, поле зрения обязано вернуться: удар — событие, а не
  // постоянное состояние.
  if (Math.abs(game.camera.fov - fov0) > 0.005) {
    throw new Error('поле зрения не вернулось: ' + (game.camera.fov * 57.3).toFixed(1) + '°');
  }
});

await step('поток за бортом: еле виден обычным ходом, полосы на форсаже', () => {
  // Пылинки за бортом (js/game/flow.js) — то, чем в пустоте видно
  // скорость. Здесь проверяется проводка: скорость корабля доходит до
  // потока каждый кадр, и яркость с длиной черты следуют за ней.
  //
  // Скорость ставим вектором, а не разгоном: разгон на своих 0.45 км/с²
  // занял бы шесть секунд модельного времени, и весь остальной smoke
  // поехал бы вслед за ним (мир-то идёт).
  const ship = game.ship;
  const len = (f) => Math.hypot(f.streak.x, f.streak.y, f.streak.z);
  const put = (v) => {
    ship.vel.x = ship.basis.fwd.x * v;
    ship.vel.y = ship.basis.fwd.y * v;
    ship.vel.z = ship.basis.fwd.z * v;
    frames(2);
  };
  const SH = SHIP.maxSpeed;                  // предел обычного хода, км/с

  put(SH);
  const calmPow = game.flow.power, calmLen = len(game.flow);
  if (!(calmPow > 0 && calmPow <= 0.12)) {
    throw new Error('обычным ходом поток должен быть еле заметен, а он ' + calmPow.toFixed(2));
  }
  if (!(calmLen > 0.05)) throw new Error('черты нет вовсе: ' + (calmLen * 1000).toFixed(0) + ' м');

  put(SH * SHIP.boostMax);
  const burnPow = game.flow.power, burnLen = len(game.flow);
  if (!(burnPow > calmPow * 6)) {
    throw new Error('на форсажном ходу поток не разгорелся: ' +
      calmPow.toFixed(2) + ' -> ' + burnPow.toFixed(2));
  }
  if (!(burnLen > calmLen * 2.5)) {
    throw new Error('черта не вытянулась: ' + (calmLen * 1000).toFixed(0) + ' м -> ' +
      (burnLen * 1000).toFixed(0) + ' м');
  }

  // Встали — поток обязан погаснуть вместе с ходом: он следует за
  // скоростью, а не за нажатой клавишей.
  put(0);
  if (game.flow.power !== 0) {
    throw new Error('на месте поток не погас: ' + game.flow.power.toFixed(3));
  }
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
    // Смотрим из-за спины: снос камеры есть только там.
    if (game.state.view !== 'chase') { key('KeyV'); frames(1); }
    // ТО, ЧТО БЫЛО СЛОМАНО: на торможении привода камера уезжала вперёд.
    // Снос камеры — модель преследователя с инерцией, и он про ТЯГУ; в
    // прыжке ускорение доходит до двенадцати тысяч км/с², снос упирался
    // в предел и держал камеру вплотную к кораблю весь выход.
    // Меряем на ТОРМОЖЕНИИ — там ускорение и доходило до предела.
    // Остаток пути меньше тормозного (150 тыс. км) означает, что привод
    // уже гасит ход.
    let camFar = 0, camNear = 1e9;
    for (let i = 0; i < 60 * 150 && game.quantum.phase === 'jump'; i++) {
      frames(1);
      if (game.quantum.dist > 150000) continue;
      const p = game.camera.pos, sp = game.ship.pos;
      const d = Math.hypot(p.x - sp.x, p.y - sp.y, p.z - sp.z);
      camFar = Math.max(camFar, d); camNear = Math.min(camNear, d);
    }
    if (camNear < 0.09 || camFar > 0.13) {
      throw new Error('камера гуляет в прыжке: от ' + (camNear * 1000).toFixed(0) +
        ' до ' + (camFar * 1000).toFixed(0) + ' м вместо ~108');
    }
    key('KeyV'); frames(1);                 // обратно в кокпит
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


await step('карта системы (M): масштаб, выбор, назначение цели', () => {
  key('KeyM'); frames(5);
  if (game.state.mode !== 'map') throw new Error('режим ' + game.state.mode);
  const map = game.map;
  // Курсор: в полёте он спрятан (мешал бы прицелу), на карте им выбирают
  // объекты — и без него карта неуправляема.
  if (!nodes.screen.classList.contains('map')) throw new Error('курсор не показан на карте');
  // Карта открывается на том, куда летишь, и во весь обзор.
  if (map.sel !== game.nav.list[game.nav.index]) throw new Error('выбрана не текущая цель');
  if (Math.abs(map.zoom - 1) > 1e-6) throw new Error('масштаб при открытии ' + map.zoom);

  // Колесо приближает, W и S — тоже. Это и было главной претензией к
  // старой карте: она не приближалась вовсе.
  mouse('mousemove', { clientX: 400, clientY: 400 });
  mouse('wheel', { deltaY: -600 });
  frames(2);
  const zWheel = map.zoom;
  if (!(zWheel > 1.5)) throw new Error('колесо не приближает: ×' + zWheel.toFixed(2));
  key('KeyW'); frames(2);
  if (!(map.zoom > zWheel)) throw new Error('W не приближает');
  // Нажатия разбираются раз в кадр: два в одном кадре — это одно.
  key('KeyS'); frames(2); key('KeyS'); frames(2);
  if (!(map.zoom < zWheel)) throw new Error('S не отдаляет');

  // Щелчок по нарисованному объекту выбирает его. Координаты берём из
  // того же списка, по которому карта ищет попадание, — так проверяется
  // связка «нарисовано там же, где ловится».
  key('KeyX'); frames(3);                       // сброс вида: снова вся система
  const spot = map.items.find((it) => it.obj === game.world.home);
  if (!spot) throw new Error('родной планеты нет на карте');
  mouse('mousemove', { clientX: spot.sx, clientY: spot.sy });
  mouse('mousedown', { button: 0, clientX: spot.sx, clientY: spot.sy });
  frames(2);
  mouse('mouseup', { button: 0 });
  if (map.sel !== game.world.home) {
    throw new Error('щелчок не выбрал планету: ' + (map.sel && map.sel.name));
  }

  // Карточка выбранного: название и физика, а не одна подпись.
  texts = [];
  frames(1);
  const seen = texts;
  texts = null;
  const has = (re) => seen.some((t) => re.test(t.s));
  for (const re of [/^Lave II$/, /МАССА/, /ТЯЖЕСТЬ/, /ТЕМПЕРАТУРА/, /АТМОСФЕРА/, /СОСТАВ/, /КОРИДОР/]) {
    if (!has(re)) throw new Error('в карточке нет ' + re);
  }
  if (!has(/N₂/)) throw new Error('состав атмосферы не расписан');

  // Tab назначает выбранное целью — ради этого карту и открывают.
  key('Tab'); frames(2);
  if (game.nav.list[game.nav.index] !== game.world.home) {
    throw new Error('Tab не назначил цель на карте');
  }

  // Стрелки идут по объектам системы и подвозят вид к выбранному:
  // станция на обзорном масштабе сидит внутри планеты, и иначе до неё
  // не добраться.
  const before = map.sel;
  key('ArrowRight'); frames(3);
  if (map.sel === before) throw new Error('стрелка не переключила объект');
  if (map.follow !== map.sel) throw new Error('вид не поехал за выбранным');
  if (!(map.zoom > 5)) throw new Error('переход не приблизил: ×' + map.zoom.toFixed(1));
  if (map.sel.isStation) {
    const gap = map.sel.orbit.radius * map.scale;
    if (!(gap > 30)) throw new Error('станция не отделилась от планеты: ' + gap.toFixed(1) + ' px');
  }

  key('KeyX'); frames(2);
  if (Math.abs(map.zoom - 1) > 1e-6 || map.follow) throw new Error('X не сбросил вид');

  key('KeyM'); frames(5);
  if (game.state.mode !== 'flight') throw new Error('режим ' + game.state.mode);
  if (nodes.screen.classList.contains('map')) throw new Error('курсор остался после карты');
});

// Меню пилота. Три свойства, которые нельзя проверить глазами за один
// заход и очень легко сломать: раздел рисуется тот, что выбран; полёт на
// это время глохнет, а МИР — НЕТ; клавиша I в порту не открывает ничего.
await step('меню пилота (I): разделы, живой мир, мёртвое управление', () => {
  try {
  if (game.state.mode !== 'flight') { key('Space'); frames(4); }
  // В пустое место и НА ТЯГЕ: просто присвоить скорость мало —
  // стабилизатор гасит всё, что не задано ручкой, и корабль встаёт за
  // полсекунды (первый заход этой проверки на том и сломался).
  game.ship.pos.x = 0; game.ship.pos.y = 2.2e6; game.ship.pos.z = 0;
  game.ship.throttle = 0.5;
  frames(90);
  if (!(game.ship.speed > 0.2)) throw new Error('корабль не разогнался: ' + game.ship.speed);

  const seen = () => {
    texts = [];
    frames(1);
    const list = texts.map((t) => t.s);
    texts = null;
    return list;
  };
  const has = (list, s) => list.some((t) => t.indexOf(s) >= 0);
  const need = (list, ...parts) => {
    for (const s of parts) if (!has(list, s)) throw new Error('нет строки «' + s + '»');
  };

  key('KeyI'); frames(1);
  if (!game.menu.open) throw new Error('меню не открылось в полёте');
  // ВЁРСТКА. Ни одна надпись не вылезает за рамку и не наезжает на
  // соседнюю. Проверяется счётом, а не глазами: кегль и ширина колонок
  // зависят от размера окна, и разъезжается это молча — на телефоне
  // раньше, чем на мониторе.
  const layout = (title) => {
    texts = [];
    frames(1);
    const list = texts; texts = null;
    // Меню рисуется последним, и первая его надпись — заголовок. Всё, что
    // до него, принадлежит приборам под меню.
    const from = list.findIndex((t) => t.s === 'МЕНЮ ПИЛОТА');
    if (from < 0) throw new Error(title + ': заголовка меню нет в кадре');
    const r = game.menu.rect, fs = game.menu.fs;
    // Consolas: ширина знака 0.55 em — ровно та же оценка, что у
    // measureText в этом моке. Брать здесь «с запасом» нельзя: перенос
    // строки меряет текст по measureText, и запас в проверке объявлял бы
    // виновным честно перенесённый абзац.
    const span = (t) => {
      const w = t.s.length * (parseFloat(t.font) || fs) * 0.55;
      const x0 = t.align === 'right' ? t.x - w : t.align === 'center' ? t.x - w / 2 : t.x;
      return { x0, x1: x0 + w, y: t.y, s: t.s };
    };
    const boxes = list.slice(from).map(span);
    for (const b of boxes) {
      if (b.x0 < r.x - 1 || b.x1 > r.x + r.w + 1 || b.y < r.y || b.y > r.y + r.h + 1) {
        throw new Error(title + ': «' + b.s + '» вылезла за рамку меню');
      }
    }
    for (let a = 0; a < boxes.length; a++) {
      for (let c = a + 1; c < boxes.length; c++) {
        const p = boxes[a], q = boxes[c];
        if (Math.abs(p.y - q.y) > fs * 0.6) continue;      // разные строки
        if (p.x0 < q.x1 - 1 && q.x0 < p.x1 - 1) {
          throw new Error(title + ': «' + p.s + '» наезжает на «' + q.s + '»');
        }
      }
    }
    return boxes.length;
  };
  layout('КОРАБЛЬ');

  // 1. КОРАБЛЬ: имя из модели, габариты из модели, щиты и бак.
  const shipTab = seen();
  need(shipTab, 'МЕНЮ ПИЛОТА', 'CHALLENGER', 'ГАБАРИТЫ', 'ДЛИНА', '65.0 м',
    // «ГНЕЗДО СВОБОДНО» — на месте невыставленного оружия. Проверка та
    // же, что и раньше: пустых строк в карточке не бывает, отсутствие
    // модуля написано словами.
    'УСТАНОВЛЕННЫЕ МОДУЛИ', 'КВАНТОВЫЙ ПРИВОД', 'ГНЕЗДО СВОБОДНО', 'ЩИТЫ', 'ТОПЛИВО',
    'КОРАБЛЬ В ПОЛЁТЕ');
  if (has(shipTab, 'ЗАНЯТО') || has(shipTab, 'НАЧАЛЬНЫЙ КАПИТАЛ')) {
    throw new Error('на вкладке корабля видно чужой раздел');
  }

  // 2. ГРУЗ: тоннаж и чем занято.
  key('Digit2'); frames(1);
  const cargoTab = seen();
  need(cargoTab, 'ЗАНЯТО 13.0 / 20.0 Т', 'СВОБОДНО', 'ВОДА', 'ЗЕРНО', 'ЖЕЛЕЗНАЯ РУДА', '6.0 т');
  layout('ГРУЗ');

  // 3. ЗАДАНИЯ: срок и награда.
  key('Digit3'); frames(1);
  const questTab = seen();
  need(questTab, 'ДОСТАВКА · LAVE VI', 'ОСТАЛОСЬ', fmtCrowns(1200), 'РАЗВЕДКА · BEON');
  layout('ЗАДАНИЯ');

  // 4. ФИНАНСЫ: баланс и лента.
  key('Digit4'); frames(1);
  const moneyTab = seen();
  need(moneyTab, fmtCrowns(game.player.balance), 'НАЧАЛЬНЫЙ КАПИТАЛ',
    fmtCrowns(3400, true), 'ПРИШЛО', 'УШЛО');
  layout('ФИНАНСЫ');

  // Мир под меню ЖИВЁТ: корабль летит дальше, часы пилота идут.
  const p0 = { x: game.ship.pos.x, y: game.ship.pos.y, z: game.ship.pos.z };
  const t0 = game.player.time, w0 = game.world.time;
  frames(60);
  const moved = Math.hypot(game.ship.pos.x - p0.x, game.ship.pos.y - p0.y, game.ship.pos.z - p0.z);
  if (!(moved > 0.1)) throw new Error('корабль замер под меню: ' + moved.toFixed(3) + ' км');
  if (!(game.world.time > w0) || !(game.player.time > t0)) throw new Error('время остановилось');

  // ...а вот управление — нет: ни разворота, ни тяги, ни выбора цели.
  const f0 = { ...game.ship.basis.fwd };
  const thr0 = game.ship.throttle;
  holdDown('KeyD'); holdDown('ShiftLeft');
  frames(40);
  release('KeyD'); release('ShiftLeft');
  key('KeyZ'); frames(2);
  const dot = f0.x * game.ship.basis.fwd.x + f0.y * game.ship.basis.fwd.y + f0.z * game.ship.basis.fwd.z;
  if (dot < 0.99999) throw new Error('корабль развернулся при открытом меню: dot ' + dot.toFixed(5));
  if (Math.abs(game.ship.throttle - thr0) > 1e-9) {
    throw new Error('тяга изменилась при открытом меню: ' + thr0 + ' -> ' + game.ship.throttle);
  }
  // Зато D сделал своё дело как клавиша МЕНЮ: с четвёртого раздела
  // пролистнул на первый, по кругу. Ровно это и значит «ввод забрало
  // меню»: клавиша жива, но работает не на корабль.
  if (game.menu.tab !== 0) throw new Error('D не пролистал разделы: ' + game.menu.tab);

  // Мышь: щелчок по закладке переключает раздел. Курсор в меню видно
  // (класс на #screen), и закладки обязаны на него отвечать.
  key('Digit1'); frames(1);
  const t3 = game.menu.tabRects[2];
  mouse('mousedown', { button: 0, clientX: t3.x + t3.w / 2, clientY: t3.y + t3.h / 2 });
  frames(1);
  mouse('mouseup', { button: 0 });
  if (game.menu.tab !== 2) throw new Error('щелчок по закладке не сработал: ' + game.menu.tab);

  // Длинное описание обязано переноситься по словам. Без этой строки
  // перенос не проверяется вовсе: у демо-заданий описания короткие и
  // помещаются даже на телефоне — проверка вёрстки была бы зелёной и с
  // напрочь выключенным переносом.
  const longOne = addMission(game.player, {
    title: 'ПОДРЯД · ДАЛЬНИЙ',
    desc: 'Забрать партию охлаждённого биоматериала с орбитальной станции '
      + 'газового гиганта и довезти её до внутренней планеты, не выходя за '
      + 'срок и не превышая допустимую температуру в трюме.',
    reward: 4100,
    time: 30 * 60,
  });

  // ТЕЛЕФОН. Кегль и колонки считаются от размера окна, и разъезжается
  // вёрстка первым делом на узком экране — там, где её труднее всего
  // заметить. Проверяем все четыре раздела на 390x844.
  const W0 = window.innerWidth, H0 = window.innerHeight;
  window.innerWidth = 390; window.innerHeight = 844;
  for (const fn of winListeners.resize || []) fn();
  frames(2);
  for (let tab = 1; tab <= 4; tab++) {
    key('Digit' + tab); frames(1);
    layout('ТЕЛЕФОН, РАЗДЕЛ ' + tab);
  }
  window.innerWidth = W0; window.innerHeight = H0;
  for (const fn of winListeners.resize || []) fn();
  frames(2);
  game.player.missions = game.player.missions.filter((mm) => mm !== longOne);

  key('KeyI'); frames(2);
  if (game.menu.open) throw new Error('меню не закрылось');

  // Закрытое меню возвращает управление — иначе проверка выше проходила
  // бы и на намертво отключённых клавишах.
  holdDown('KeyD'); frames(30); release('KeyD');
  const back = f0.x * game.ship.basis.fwd.x + f0.y * game.ship.basis.fwd.y + f0.z * game.ship.basis.fwd.z;
  if (back > 0.999) throw new Error('после закрытия меню корабль не слушается: dot ' + back.toFixed(5));
  } finally {
    // Что бы ни упало выше, следующие проверки должны начинать с
    // закрытого меню и живого управления.
    game.menu.open = false;
    game.ship.vel.x = 0; game.ship.vel.y = 0; game.ship.vel.z = 0;
    game.ship.speed = 0; game.ship.throttle = 0;
    frames(2);
  }
});

// Чужие корабли. Проверка тупая, но именно она ловит класс ошибок
// «нарисовали то, чего не рисовали никогда»: пока список пилотов пуст,
// весь этот код не выполняется, и опечатка в нём живёт до первой встречи
// в космосе (так и случилось: в подписи стояла переменная, которой в
// этом файле нет).
await step('чужие пилоты: число, отметка и метка с расстоянием', () => {
  if (game.state.mode !== 'flight') { key('Space'); frames(4); }

  // Кладём пилотов ТУДА, КУДА ИХ КЛАДЁТ СОКЕТ, и, как он, поднимаем
  // номер снимка: игра принимает только новый список, а тот, что
  // подсунут в обход счётчика, для неё означает «корабль стоит».
  const push = () => {
    const p = game.ship.pos, f = game.ship.basis.fwd, u = game.ship.basis.up;
    net.peers = [
      // Один прямо по курсу, в двух километрах: на нём проверяется метка.
      {
        id: 2, name: 'БЕТА', v: 0.4, mode: 'flight',
        x: p.x + f.x * 2, y: p.y + f.y * 2, z: p.z + f.z * 2,
        fx: f.x, fy: f.y, fz: f.z, ux: u.x, uy: u.y, uz: u.z,
      },
      // Второй за спиной: он в счёте есть, а метки у него быть не должно.
      {
        id: 3, name: 'ГАММА', v: 0, mode: 'docked',
        x: p.x - f.x * 90, y: p.y - f.y * 90, z: p.z - f.z * 90,
        fx: f.x, fy: f.y, fz: f.z, ux: u.x, uy: u.y, uz: u.z,
      },
    ];
    net.rev++;
  };

  // Сканер есть в обоих видах, но рисуют его РАЗНЫЕ модули: от третьего
  // лица — угловая панель (js/ui/hud.js), в кабине — экран локатора
  // (js/ui/panels.js). Проверяем оба: опечатка живёт ровно в том, куда
  // не заглянули.
  const seenIn = (view) => {
    if (game.state.view !== view) { key('KeyV'); frames(2); }
    push();
    texts = [];
    frames(2);
    const seen = texts.map((t) => t.s);
    texts = null;
    return seen;
  };

  const chase = seenIn('chase');
  if (!chase.some((t) => t.indexOf('ПИЛОТОВ РЯДОМ 2') >= 0)) {
    throw new Error('от третьего лица числа пилотов нет');
  }
  // Метка с именем и расстоянием — то, без чего чужой корабль в космосе
  // просто не находится глазами.
  const mark = chase.find((t) => t.indexOf('БЕТА') >= 0);
  if (!mark) throw new Error('в кадре нет метки чужого пилота');
  if (!/\d/.test(mark) || (mark.indexOf(' км') < 0 && mark.indexOf(' м') < 0)) {
    throw new Error('в метке пилота нет расстояния: ' + mark);
  }
  if (chase.some((t) => t.indexOf('ГАММА') >= 0)) {
    throw new Error('метка нарисована у пилота за спиной');
  }

  const cockpit = seenIn('cockpit');
  if (!cockpit.some((t) => t.indexOf('ПИЛОТОВ РЯДОМ 2') >= 0)) {
    throw new Error('в кабине числа пилотов нет');
  }

  net.peers = [];
  net.rev++;
  frames(2);
});

// Связь в углу. Прибор нужен именно тогда, когда всё плохо, — а значит,
// проверять его надо во всех состояниях, включая те, до которых в игре
// руками не дойдёшь: оборванный сокет и потери пакетов.
await step('связь: пинг и качество в углу — всегда', () => {
  if (game.state.mode !== 'flight') { key('Space'); frames(4); }

  const seen = (view) => {
    if (game.state.view !== view) { key('KeyV'); frames(2); }
    texts = [];
    frames(2);
    const list = texts.map((t) => t.s);
    texts = null;
    return list;
  };

  // Живая связь: полоски и пинг.
  const live = () => {
    const t = performance.now() / 1000;
    net.state = 'live';
    net.ping = 42;
    net.tick = 0.2;
    net.beats = [];
    for (let i = 0; i < 20; i++) net.beats.push(t - 4 + i * 0.2);
  };

  live();
  const chase = seen('chase');
  if (!chase.some((s) => s.indexOf('42 мс') >= 0)) {
    throw new Error('от третьего лица пинга в углу нет');
  }
  live();
  const cockpit = seen('cockpit');
  if (!cockpit.some((s) => s.indexOf('42 мс') >= 0)) {
    throw new Error('в кабине пинга в углу нет');
  }

  // Потери: их показывают только когда они есть — постоянный «0%» глаз
  // перестаёт читать через минуту.
  if (chase.some((s) => s.indexOf('ПОТЕРИ') >= 0)) {
    throw new Error('на чистой связи показаны потери');
  }
  const t = performance.now() / 1000;
  net.beats = [];
  for (let i = 0; i < 10; i++) net.beats.push(t - 4 + i * 0.4);   // половина
  const lossy = seen('chase');
  if (!lossy.some((s) => s.indexOf('ПОТЕРИ') >= 0)) {
    throw new Error('потери снимков в углу не показаны');
  }

  // Оборвалось: прибор обязан сказать об этом словами, а не молча
  // погасить полоски. Ради этого он и висит постоянно.
  net.state = 'down';
  net.ping = null;
  net.beats = [];
  const down = seen('chase');
  if (!down.some((s) => s.indexOf('ОБОРВАНА') >= 0)) {
    throw new Error('об оборванной связи в углу не сказано');
  }
  if (down.some((s) => s.indexOf('42 мс') >= 0)) {
    throw new Error('после обрыва показан старый пинг');
  }

  net.state = 'off';
  net.rev++;
  frames(2);
});

// Бой: выбор чужого корабля целью и огонь левой кнопкой. Проверяется
// связка, которой нет ни в одном другом наборе: список целей, ввод,
// кардан и болты собираются вместе только здесь.
await step('цель по Tab и огонь левой кнопкой', () => {
  if (game.state.mode !== 'flight') { key('Space'); frames(4); }
  if (game.state.view !== 'chase') { key('KeyV'); frames(2); }

  // Чужой корабль — в километре прямо по курсу.
  const put = (side = 0, d = 1) => {
    const p = game.ship.pos, f = game.ship.basis.fwd, r = game.ship.basis.right;
    const u = game.ship.basis.up;
    net.peers = [{
      id: 42, name: 'МИШЕНЬ', v: 0, mode: 'flight',
      x: p.x + f.x * d + r.x * side, y: p.y + f.y * d + r.y * side,
      z: p.z + f.z * d + r.z * side,
      fx: f.x, fy: f.y, fz: f.z, ux: u.x, uy: u.y, uz: u.z,
      hull: 100, hmax: 100, sh: 40, smax: 40,
    }];
    net.rev++;
  };
  put();
  frames(2);

  // Tab берёт пилота целью — той же клавишей, что и станции.
  key('Tab');
  frames(2);
  const target = game.nav.list[game.nav.index];
  if (!target || !target.isPeer) {
    throw new Error('Tab не выбрал чужой корабль: ' + (target ? target.name : '—'));
  }

  // Левая кнопка — огонь. Удержание: очередь задаёт перезарядка.
  game.guns.bolts.length = 0;
  mouse('mousedown', { button: 0 });
  frames(3);
  if (!game.guns.bolts.length) throw new Error('левая кнопка не стреляет');
  const one = game.guns.bolts.length;
  frames(3);
  if (game.guns.bolts.length > one + 1) {
    throw new Error('очередь идёт чаще перезарядки: ' + game.guns.bolts.length);
  }
  mouse('mouseup', { button: 0 });

  // Кардан ведёт ствол к цели, а не по носу: ставим её сбоку и смотрим,
  // куда уходит болт.
  put(0.12);                                  // ~7° в сторону
  frames(2);
  game.guns.bolts.length = 0;
  mouse('mousedown', { button: 0 });
  // Ждём перезарядку целиком: на трёх выстрелах в секунду это два десятка
  // кадров, и без них проверка ловила бы не кардан, а пустую пушку.
  frames(30);
  mouse('mouseup', { button: 0 });
  const b = game.guns.bolts[0];
  if (!b) throw new Error('по цели сбоку не выстрелили');
  const f = game.ship.basis.fwd;
  const along = b.dx * f.x + b.dy * f.y + b.dz * f.z;
  if (!(along < 0.9999)) throw new Error('кардан не довернул: болт ушёл строго по носу');
  if (!(along > 0.9)) throw new Error('кардан развернуло слишком сильно: ' + along.toFixed(4));

  // Болт долетает и гаснет о корпус, а щит на миг проявляется. Цель
  // ставим близко намеренно: на километре полёт занимает треть секунды,
  // и эти лишние кадры сдвигают весь дальнейший сценарий — на этом
  // падали посадочные шаги.
  put(0, 0.25);
  frames(2);
  game.guns.bolts.length = 0;
  game.guns.shields.length = 0;
  const hits0 = game.guns.hits;
  mouse('mousedown', { button: 0 });
  frames(10);
  mouse('mouseup', { button: 0 });
  if (game.guns.hits <= hits0) throw new Error('болт не долетел до цели в 250 метрах');
  if (!game.guns.shields.length) throw new Error('щит цели не проявился от попадания');
  if (!game.guns.blasts.length) throw new Error('вспышки в точке попадания нет');

  // Корпус и щит соседа — полосками над его квадратом. Ни одной буквы
  // они не рисуют, поэтому ищем их по координатам: две узкие плашки над
  // меткой, одна под другой.
  put();
  net.peers[0].hull = 60;
  net.peers[0].sh = 20;
  net.rev++;
  texts = [];
  rects = [];
  frames(2);
  const label = texts.find((t) => t.s.indexOf('МИШЕНЬ') >= 0);
  // Ширину требуем близкой к полоске: отметки сканера — тоже мелкие
  // прямоугольники, и без этого они проходили бы за полоски корпуса.
  const bars = rects.filter((r) => r.w >= 20 && r.w <= 34 && r.h > 0 && r.h <= 6
    && label && Math.abs(r.x + r.w / 2 - label.x) < 60 && r.y < label.y);
  texts = null;
  rects = null;
  if (!label) throw new Error('метки пилота нет вовсе');
  // Две полоски и две подложки под ними.
  if (bars.length < 4) {
    throw new Error('над меткой нет полосок корпуса и щита: ' + bars.length);
  }

  net.peers = [];
  net.rev++;
  game.guns.bolts.length = 0;
  frames(2);
});

// Прыжок к чужому кораблю: пилот — такая же точка назначения, как
// станция. И такая же ненадёжная: он может уйти из системы посреди
// калибровки, и привод обязан это заметить.
await step('квантовый прыжок к пилоту и срыв, когда тот пропал', () => {
  if (game.state.mode !== 'flight') { key('Space'); frames(4); }

  // Ставим пилота далеко — прыжок имеет смысл только на дистанции.
  const p = game.ship.pos, f = game.ship.basis.fwd, u = game.ship.basis.up;
  const put = () => {
    net.peers = [{
      id: 77, name: 'ДАЛЬНИЙ', v: 0, mode: 'flight',
      x: p.x + f.x * 4000, y: p.y + f.y * 4000, z: p.z + f.z * 4000,
      fx: f.x, fy: f.y, fz: f.z, ux: u.x, uy: u.y, uz: u.z,
      hull: 100, hmax: 100, sh: 40, smax: 40,
    }];
    net.rev++;
  };
  put();
  frames(2);

  key('Tab'); frames(2);
  const t = game.nav.list[game.nav.index];
  if (!t || !t.isPeer) throw new Error('пилот не выбран целью: ' + (t ? t.name : '—'));

  // Выход считается за двадцать километров от него — не в упор.
  const ex = exitPoint(t, game.ship.pos);
  const gap = Math.hypot(ex.x - t.pos.x, ex.y - t.pos.y, ex.z - t.pos.z);
  if (Math.abs(gap - 20) > 0.01) throw new Error('выход не в 20 км, а в ' + gap.toFixed(1));

  aimAt(t);
  key('KeyB'); frames(4);
  if (game.quantum.phase === 'idle') {
    throw new Error('привод не взял пилота целью: ' + (game.quantum.reason || '—'));
  }
  if (!game.quantum.target || !game.quantum.target.isPeer) {
    throw new Error('привод целится не в пилота');
  }

  // Пилот вышел из игры — прыжок обязан сорваться, а не идти к призраку.
  // Сообщение об уходе приходит отдельно от снимка (так делает сокет), и
  // именно по нему пилот пропадает сразу: пустого снимка мало, его можно
  // и не дождаться при потере пакета.
  net.peers = [];
  net.left = 77;
  net.rev++;
  frames(3);
  if (game.quantum.phase !== 'idle') {
    throw new Error('цель пропала, а привод продолжает: ' + game.quantum.phase);
  }

  frames(2);
});

await step('справка (H)', () => {
  key('KeyH'); frames(3);
  if (game.state.mode !== 'help') throw new Error('режим ' + game.state.mode);
  key('KeyH'); frames(3);
  if (game.state.mode !== 'flight') throw new Error('режим ' + game.state.mode);
});

await step('отладочный оверлей (~) показывает состояние связи', () => {
  key('Backquote');
  texts = [];
  frames(5);
  const seen = texts.map((t) => t.s);
  texts = null;
  key('Backquote'); frames(2);

  // Строка о связи обязана быть ВСЕГДА, а не только когда что-то не так:
  // «сокет не запущен» и «сокет запущен, но рядом никого» выглядят в игре
  // одинаково — пусто, — и различить их больше нечем.
  const line = seen.find((t) => t.indexOf('сокет:') >= 0);
  if (!line) throw new Error('в отладке нет строки о связи');
  if (line.indexOf('сервер:') < 0) throw new Error('в строке связи нет состояния сервера: ' + line);
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

await step('в порту меню пилота не открывается', () => {
  if (game.state.mode !== 'docked') throw new Error('режим ' + game.state.mode);
  key('KeyI'); frames(2);
  if (game.menu.open) throw new Error('меню открылось на станции');
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

await step('стоянка на грунте: кнопка вместо экрана, взлёт удержанием', () => {
  frames(60 * 2);
  if (game.state.mode !== 'landed') throw new Error('режим ' + game.state.mode);
  // ТО, ЧТО БЫЛО СЛОМАНО: посадка выбрасывала игрока в экран поверх
  // игры — ровно в тот момент, ради которого всё и затевалось.
  if (!nodes.overlay.classList.contains('hidden')) {
    throw new Error('на посадке показан экран поверх игры');
  }
  if (game.ship.secured) throw new Error('корабль зафиксирован сам, без пилота');

  // Кадр на грунте рисует приборы и кнопку.
  texts = [];
  frames(1);
  const seen = texts;
  texts = null;
  if (!seen.some((t) => /ГОТОВ К ПОСАДКЕ/.test(t.s))) {
    throw new Error('кнопки «готов к посадке» нет в кадре');
  }
  // И то, что раньше показывал экран посадки: где сел и какая площадка.
  if (!seen.some((t) => /ПЛОЩАДКА/.test(t.s) && /ПОСАДОК/.test(t.s))) {
    throw new Error('координат стоянки нет в кадре');
  }

  // Короткое нажатие — фиксация: движки в ноль, взлёта нет.
  game.ship.throttle = 0.4;
  key('Space'); frames(3);
  if (!game.ship.secured) throw new Error('короткое нажатие не зафиксировало корабль');
  if (game.state.mode !== 'landed') throw new Error('короткое нажатие подняло корабль');
  if (game.ship.throttle !== 0) throw new Error('движки не заглушены: ' + game.ship.throttle);

  // Стоянка обязана попасть в сейв: в локальных осях тела, иначе через
  // сутки эти координаты указывали бы в пустоту.
  const saved = JSON.parse(savedJson());
  if (!saved.landed || !saved.landed.pose || !saved.landed.id) {
    throw new Error('стоянка не сохранена: ' + JSON.stringify(saved.landed));
  }
  if (!saved.landed.secured) throw new Error('фиксация не сохранена');
  if (!saved.gear) throw new Error('состояние шасси не сохранено');

  // Полсекунды удержания — ещё не взлёт, но полоса пошла.
  holdDown('Space');
  frames(30);
  if (game.state.mode !== 'landed') throw new Error('взлетел за полсекунды удержания');
  if (!(game.landHold > 0.3)) throw new Error('удержание не копится: ' + game.landHold);
  texts = [];
  frames(1);
  const hold = texts;
  texts = null;
  if (!hold.some((t) => /ДЕРЖАТЬ ЕЩЁ/.test(t.s))) {
    throw new Error('в кадре не видно, сколько ещё держать');
  }
  // Отпустили — отсчёт сбросился.
  release('Space'); frames(3);
  if (game.landHold !== 0) throw new Error('отсчёт не сбросился: ' + game.landHold);
  if (game.state.mode !== 'landed') throw new Error('режим ' + game.state.mode);

  // ТО, ЧТО БЫЛО СЛОМАНО: на грунте правая кнопка мыши не вертела
  // камеру — осмотр был разрешён только в полёте. Стоянка теперь такое
  // же состояние в кадре, и смотреть по сторонам на ней можно.
  {
    if (game.state.view !== 'chase') { key('KeyV'); frames(2); }
    const yaw0 = game.camOrbit.yaw;
    mouse('mousedown');
    mouse('mousemove', { movementX: 150, movementY: 20 });
    frames(2);
    const turned = game.camOrbit.yaw - yaw0;
    mouse('mouseup');
    if (!(turned > 0.2)) throw new Error('на стоянке камера не вертится: ' + turned.toFixed(3));
    frames(90);
    if (Math.abs(game.camOrbit.yaw) > 0.02) throw new Error('камера не вернулась на место');
  }

  // Полное удержание — отрыв. Держим ровно до смены режима: после него
  // Space уже означает форсаж, и лишние секунды удержания тут ни к чему.
  holdDown('Space');
  for (let i = 0; i < 60 * 5 && game.state.mode === 'landed'; i++) frames(1);
  release('Space');
  // Даём движкам отработать отрыв: они идут около секунды (LAND.liftoff).
  frames(40);
  if (game.state.mode !== 'flight') throw new Error('после удержания режим ' + game.state.mode);
  if (game.ship.secured) throw new Error('фиксация не снята на взлёте');
  // Отрыв — это работа движков: они какое-то время идут сами.
  {
    const b = game.ship.landedAt || (game.zone && game.zone.body);
    const p = game.ship.pos, c = b ? b.pos : { x: 0, y: 0, z: 0 };
    const ux = p.x - c.x, uy = p.y - c.y, uz = p.z - c.z;
    const l = Math.hypot(ux, uy, uz) || 1;
    const v = game.ship.vel;
    const vUp = (v.x * ux + v.y * uy + v.z * uz) / l;
    if (!(vUp > 0.001)) {
      throw new Error('после отрыва корабль не идёт вверх: ' + (vUp * 1000).toFixed(2) +
        ' м/с, отработка движков ' + game.ship.liftHold.toFixed(2) + ' с, ' +
        'подъёмные ' + (game.ship.lift * 1000).toFixed(2) + ' м/с²');
    }
  }
  frames(60 * 5);
});


// Отметка центровки обязана показывать НАСТОЯЩЕЕ направление.
//
// ЖАЛОБА: «пару раз прыгнул, а теперь при наведении опять ничего не
// происходит». Причина: projectDir для направления за спиной возвращает
// зеркальную точку, и цель позади давала кольцо ровно в середине кадра.
// Игрок наводился на него и держал сколько угодно — привод честно видел
// промах в 174°, а отметка показывала «точно в цель».
await step('отметка варпа не врёт, когда цель за спиной', () => {
  if (game.state.mode === 'docked') { key('Space'); frames(4); }
  game.ship.pos.x = 0; game.ship.pos.y = 2.4e6; game.ship.pos.z = 0;
  game.ship.vel.x = 0; game.ship.vel.y = 0; game.ship.vel.z = 0;
  game.ship.speed = 0; game.ship.throttle = 0;
  // Вид из кабины: там камера смотрит ровно туда же, куда нос, и
  // середина кадра ЕСТЬ направление носа. От третьего лица камера
  // догоняет корабль с запаздыванием, и проверка мерила бы её отставание,
  // а не отметку.
  if (game.state.view !== 'cockpit') { key('KeyV'); frames(2); }

  key('KeyM'); frames(2);
  if (game.map.view !== 'galaxy') { key('KeyG'); frames(2); }
  key('KeyM'); frames(2);
  key('KeyJ'); frames(2);
  if (game.warp.phase !== 'align') throw new Error('центровка не началась');

  const name = game.warpTarget.name.toUpperCase();
  const d = game.warp.dir;
  const cx = game.camera.w / 2, cy = game.camera.h / 2;
  const reach = Math.min(game.camera.w, game.camera.h) * 0.25;

  const markAt = () => {
    texts = [];
    frames(1);
    const seen = texts;
    texts = null;
    const hit = seen.find((t) => t.s === name);
    if (!hit) throw new Error('отметки варпа нет в кадре');
    const one = seen.filter((t) => t.s === name).length;
    if (one !== 1) throw new Error('отметок варпа в кадре ' + one + ', должна быть одна');
    return hit;
  };

  // Носом ТОЧНО НА цель: отметка у середины, промах нулевой.
  lookAlong(game.ship.basis, { x: d.x, y: d.y, z: d.z }, game.ship.basis.up);
  frames(30);
  const on = markAt();
  if (Math.hypot(on.x - cx, on.y - cy) > reach) {
    throw new Error('носом на цель, а отметка ушла от середины');
  }
  if (!game.warp.aligned) throw new Error('носом на цель, а привод видит промах');

  // Носом ТОЧНО ОТ цели: отметка обязана уйти от середины, а не сесть в неё.
  lookAlong(game.ship.basis, { x: -d.x, y: -d.y, z: -d.z }, game.ship.basis.up);
  frames(30);
  const off = markAt();
  const away = Math.hypot(off.x - cx, off.y - cy);
  if (away <= reach) {
    throw new Error('цель за спиной, а отметка стоит у середины: ' + away.toFixed(0) + ' px');
  }
  if (game.warp.aligned) throw new Error('цель за спиной, а привод считает это попаданием');

  key('KeyJ'); frames(2);          // выключаем привод, дальше он не нужен
  // Вид карты возвращаем к системе: шаги ниже открывают галактику сами.
  key('KeyM'); frames(1); key('KeyG'); frames(1); key('KeyM'); frames(1);
});

// Варп-прыжок целиком, как его делает игрок: цель на карте галактики,
// центровка по отметке, тоннель, выход у чужой звезды.
//
// Эта проверка стоит всех остальных вместе взятых для варпа: только здесь
// enterSystem работает по-настоящему — со сменой мира под ногами у всего
// остального кода. Логические проверки видят привод, но не видят, что
// будет с навигацией, картой и приборами, когда тел старой системы не
// станет прямо посреди кадра.
await step('варп-прыжок (J) в другую систему целиком', () => {
  if (game.state.mode === 'docked') { key('Space'); frames(4); }
  if (game.state.mode !== 'flight') throw new Error('не в полёте: ' + game.state.mode);

  // Уходим в пустоту и глушим тягу. Центровка идёт ПАРАЛЛЕЛЬНО полёту (как
  // и калибровка квантового привода), то есть корабль всё это время летит
  // туда, куда развёрнут нос. Шаги выше оставляют его у грунта луны, и
  // разворот на чужую звезду там означает разворот в землю: проверка
  // честно разбивалась, и это была её собственная обстановка, а не
  // поломка привода.
  game.ship.pos.x = 0; game.ship.pos.y = 2.4e6; game.ship.pos.z = 0;
  game.ship.vel.x = 0; game.ship.vel.y = 0; game.ship.vel.z = 0;
  game.ship.speed = 0;
  game.ship.throttle = 0;
  frames(2);

  const fromName = game.sys.name;
  const oldWorld = game.world;
  const oldBodies = game.world.bodies.concat(game.world.stations);

  // Цель — на карте галактики: M, G, Tab. Другого места назначить её нет.
  key('KeyM'); frames(2);
  if (game.state.mode !== 'map') throw new Error('карта не открылась');
  key('KeyG'); frames(2);
  if (game.map.view !== 'galaxy') throw new Error('карта галактики не открылась');
  // ЖАЛОБА БЫЛА РОВНО ОБ ЭТОМ: «выбрал систему, нажал J, ничего не
  // происходит». Цель ставилась только по Tab, и на карте была
  // подсвеченная система при пустой цели. Теперь выделение на карте
  // галактики ВСЕГДА означает цель варпа — в том числе то, которое
  // появилось само при открытии вида.
  if (!game.warpTarget) throw new Error('открытие галактики не назначило цель');
  if (game.warpTarget.seed !== game.map.gsel.seed) throw new Error('цель и выбор разошлись');
  key('ArrowRight'); frames(2);
  if (game.warpTarget.seed !== game.map.gsel.seed) throw new Error('стрелка не перенесла цель');
  const toName = game.warpTarget.name;
  key('KeyM'); frames(2);

  key('KeyJ'); frames(2);
  if (game.warp.phase !== 'align') throw new Error('центровка не началась: ' + game.warp.phase);

  // Совмещаем нос с осью прыжка — то же, что игрок делает ручкой.
  const d = game.warp.dir;
  lookAlong(game.ship.basis, { x: d.x, y: d.y, z: d.z }, game.ship.basis.up);
  for (let i = 0; i < 600 && game.warp.phase === 'align'; i++) {
    lookAlong(game.ship.basis, { x: d.x, y: d.y, z: d.z }, game.ship.basis.up);
    frames(1);
  }
  if (game.warp.phase !== 'tunnel') throw new Error('тоннель не открылся');

  // Рывок: первую секунду корабль по-настоящему уходит по оси.
  const p0 = { ...game.ship.pos };
  frames(60);
  const moved = Math.hypot(game.ship.pos.x - p0.x, game.ship.pos.y - p0.y, game.ship.pos.z - p0.z);
  if (!(moved > 1e5)) throw new Error('рывка не было: прошли ' + moved.toFixed(0) + ' км');

  // Тоннель до конца. Прыжок 20–34 секунды, берём с запасом.
  for (let i = 0; i < 60 * 45 && game.warp.phase === 'tunnel'; i++) frames(1);
  if (game.warp.phase !== 'idle') throw new Error('прыжок не кончился');

  if (game.sys.name === fromName) throw new Error('система не сменилась');
  if (game.sys.name !== toName) throw new Error('прилетели не туда: ' + game.sys.name);
  if (game.world === oldWorld) throw new Error('мир тот же самый объект');

  // Ни одной ссылки на тела старой системы: это и утечка памяти, и
  // настоящий баг — приборы показывали бы высоту над планетой, которой
  // в этой системе нет.
  const stale = new Set(oldBodies);
  const held = [];
  if (stale.has(game.capture)) held.push('захват');
  // Порт держит через parent всю цепочку старого мира — самая дорогая
  // из возможных утечек и при этом самая незаметная: переустанавливается
  // он только при следующей стыковке.
  if (stale.has(game.lastStation)) held.push('последний порт');
  if (stale.has(game.aimed)) held.push('цель под прицелом');
  if (game.zone && stale.has(game.zone.body)) held.push('зона у поверхности');
  if (game.nearest && stale.has(game.nearest.body)) held.push('ближайшее тело');
  if (stale.has(game.ship.landedAt)) held.push('стоянка');
  if (game.nav.list.some((x) => stale.has(x) || stale.has(x.body))) held.push('список целей');
  if (stale.has(game.map.follow)) held.push('слежение карты');
  if (stale.has(game.map.sel)) held.push('выбор на карте');
  if (game.map.items.some((it) => stale.has(it.obj))) held.push('значки карты');
  if (game.world.bodies.some((b) => stale.has(b))) held.push('тела мира');
  if (held.length) throw new Error('остались ссылки на старую систему: ' + held.join(', '));

  // Выход — у звезды: четыре её радиуса, носом на неё.
  const star = game.world.star;
  const dist = Math.hypot(game.ship.pos.x - star.pos.x, game.ship.pos.y - star.pos.y,
    game.ship.pos.z - star.pos.z);
  const k = dist / star.radius;
  if (k < 3.5 || k > 4.5) throw new Error('вышли не у звезды: ' + k.toFixed(1) + ' радиусов');
  if (game.ship.speed > 1e-9) throw new Error('скорость на выходе не ноль');

  // И игра после этого живёт: кадры идут, приборы считаются, сейв пишется.
  frames(120);
  if (game.state.mode !== 'flight') throw new Error('режим после прыжка: ' + game.state.mode);
  const saved = JSON.parse(savedJson() || 'null');
  if (!saved || saved.system !== game.sys.id) throw new Error('система не попала в сейв');

  // Вид карты возвращаем к системе: игрок нажал бы G ещё раз, а шаги
  // ниже работают с планом системы.
  key('KeyM'); frames(1); key('KeyG'); frames(1); key('KeyM'); frames(1);
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
  const saved = JSON.parse(savedJson() || 'null');
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
  if (!savedJson()) throw new Error('сейв не записан');
  JSON.parse(savedJson());
});

console.log('\nвызовов ctx:', Object.entries(calls)
  .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(' '));
console.log(fails === 0 ? 'SMOKE OK' : fails + ' SMOKE FAIL');
process.exit(fails ? 1 : 0);
