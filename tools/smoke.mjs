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

// Текущее преобразование холста.
//
// Приборы в углах рисуются в СВОИХ пикселях, а на экран попадают через
// translate+scale (js/ui/hud.js). Пока мок этого не знал, записанные
// координаты надписей были панельными, и проверка вёрстки не могла
// сказать, вылезла панель за кадр или нет, — а после того как приборы
// стали расти вместе с экраном, это ровно тот вопрос, который надо
// задавать.
//
// Матрица неполная: только translate, scale и rotate — больше холст
// приборов ничего и не делает.
let tm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const tmStack = [];
const mul = (m, n) => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
});
/** Точка холста -> точка экрана. */
const onScreen = (x, y) => ({ x: tm.a * x + tm.c * y + tm.e, y: tm.b * x + tm.d * y + tm.f });
/** Во сколько раз преобразование растягивает длины. */
const tmScale = () => Math.hypot(tm.a, tm.b);

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
    if (prop === 'setTransform') {
      return (...a) => {
        tm = a.length >= 6
          ? { a: a[0], b: a[1], c: a[2], d: a[3], e: a[4], f: a[5] }
          : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        count('setTransform');
      };
    }
    if (prop === 'resetTransform') {
      return () => { tm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; count('resetTransform'); };
    }
    if (prop === 'translate') {
      return (x, y) => { tm = mul(tm, { a: 1, b: 0, c: 0, d: 1, e: x, f: y }); count('translate'); };
    }
    if (prop === 'scale') {
      return (x, y) => { tm = mul(tm, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 }); count('scale'); };
    }
    if (prop === 'rotate') {
      return (r) => {
        const cs = Math.cos(r), sn = Math.sin(r);
        tm = mul(tm, { a: cs, b: sn, c: -sn, d: cs, e: 0, f: 0 });
        count('rotate');
      };
    }
    if (prop === 'save') {
      return () => { tmStack.push({ ...tm }); count('save'); };
    }
    if (prop === 'restore') {
      return () => { if (tmStack.length) tm = tmStack.pop(); count('restore'); };
    }
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
          // Координаты ЭКРАННЫЕ: иначе по ним нельзя спросить, поместился
          // ли прибор в кадр. Кегль — тоже экранный, по той же причине.
          const p = onScreen(a[1], a[2]);
          texts.push({ s: String(a[0]), x: p.x, y: p.y, align: style.align,
            font: style.font, size: (parseFloat(style.font) || 13) * tmScale() });
        }
        // Прямоугольники — тем же способом и по той же причине: полоски
        // корпуса и щита никакого текста не рисуют, и проверить их можно
        // только по координатам.
        if (prop === 'fillRect' && rects) {
          const p = onScreen(a[0], a[1]);
          const k = tmScale();
          rects.push({ x: p.x, y: p.y, w: a[2] * k, h: a[3] * k, fill: style.fill });
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
  // Фокус и прокрутка: настоящий узел умеет и то и другое, а экраны
  // этим пользуются — длинную справку прокручивают клавишами, и панель
  // берёт фокус при открытии (js/ui/screens.js).
  tabIndex: 0, scrollTop: 0, scrollHeight: 0, clientHeight: 0,
  focus() {},
  closest: () => null,
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
/**
 * Касание. У события ОБЯЗАТЕЛЬНА цель: игра берёт только те касания, что
 * легли на холст, а по разметке (стартовый экран, порт, карта) их обязан
 * обрабатывать браузер — иначе кнопки на телефоне не нажимаются вовсе.
 *
 * Возвращает, погасила ли игра событие: по этому и видно, своё оно или
 * чужое.
 */
const touch = (type, points, target = nodes.hud) => {
  let stopped = false;
  const ev = {
    type,
    target,
    changedTouches: points.map((p) => ({ identifier: p.id, clientX: p.x, clientY: p.y })),
    cancelable: true,
    preventDefault() { stopped = true; },
  };
  for (const fn of winListeners[type] || []) fn(ev);
  return stopped;
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
const { Q } = await import('../js/core/quality.js');
const { chaseRates } = await import('../js/game/chase.js');
const F = await import('../js/game/fuel.js');
const { systemDistance } = await import('../js/game/galaxy.js');

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
  // Язык возвращается ЧЕРЕЗ finally. Без этого падение внутри шага
  // оставляло игру английской, и следующие тринадцать шагов падали на
  // сверке русских надписей — по одной забытой строке в словаре набор
  // выдавал четырнадцать ошибок, из которых тринадцать были ложью.
  try {
    langStep();
  } finally {
    setLang('ru');
    frames(2);
  }
});

function langStep() {
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

}

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

await step('касание по панели остаётся браузеру', async () => {
  // Тот самый случай, из-за которого на телефоне нельзя было взлететь:
  // слушатель висел на окне и гасил preventDefault'ом всё подряд, включая
  // касания по стартовому экрану. Отменённое касание не порождает клика —
  // кнопка «ВЗЛЁТ» не нажималась, панель оставалась, а звук просыпался от
  // самого касания, и выходило, что корабль слышно, а играть нельзя.
  const ship = game.ship;
  const panel = nodes.boot || { id: 'boot' };

  // По холсту — наше: игра его гасит и ведёт.
  const mine = touch('touchstart', [{ id: 11, x: 120, y: 500 }], nodes.hud);
  touch('touchend', [{ id: 11, x: 120, y: 500 }], nodes.hud);
  if (!mine) throw new Error('касание по холсту игра не взяла');

  // По панели — чужое: не гасим, значит браузер сделает из него нажатие.
  const theirs = touch('touchstart', [{ id: 12, x: 400, y: 200 }], panel);
  frames(2);
  const moved = Math.abs(ship.control.pitch) + Math.abs(ship.control.yaw);
  touch('touchend', [{ id: 12, x: 400, y: 200 }], panel);
  frames(2);
  if (theirs) throw new Error('касание по панели погашено — кнопка не нажмётся');
  if (moved > 1e-9) throw new Error('касание по панели повело корабль: ' + moved);
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

await step('кабина: софт мониторов, осмотр головой, ручка и РУД за органами управления', async () => {
  // Кабина есть только в объёмном рендере, а smoke идёт на Canvas-2D
  // (WebGL здесь не подменить). Поэтому модель и холсты экранов
  // подставляем руками: сама кабина и загрузка экранов в атлас — забота
  // tools/gl.mjs, а здесь — то, что софт мониторов рисует на своих
  // холстах настоящие показания и не падает на этом.
  const { buildCockpit, YOKE } = await import('../js/models/cockpit.js');
  const { makeDisplays } = await import('../js/ui/displays.js');
  const { fmtSpeed } = await import('../js/ui/hud.js');
  const saved = game.cockpit, savedD = game.displays;
  // Корабль после шага — ровно там же и так же: проверка РУДа даёт полный
  // газ, и без этого следующие шаги (подход, посадка) начинали бы на ходу.
  const sh = game.ship;
  const keep = {
    pos: { ...sh.pos }, vel: { ...sh.vel }, speed: sh.speed, throttle: sh.throttle,
    basis: { right: { ...sh.basis.right }, up: { ...sh.basis.up }, fwd: { ...sh.basis.fwd } },
  };
  try {
    game.cockpit = buildCockpit();
    game.displays = makeDisplays(game.cockpit, { canvas: () => document.createElement('canvas') });
    if (game.state.view !== 'cockpit') { key('KeyV'); frames(2); }
    if (game.state.view !== 'cockpit') throw new Error('вид не переключился в кокпит');

    // Мониторы: за десяток кадров каждый экран перерисован хотя бы раз
    // (самый редкий — четыре раза в секунду), и на них — показания.
    texts = [];
    const draws0 = game.displays.draws;
    frames(20);
    const seen = texts.map((t) => t.s);
    texts = null;
    const drawn = game.displays.draws - draws0;
    if (drawn < game.displays.list.length) {
      throw new Error(`экраны кабины не перерисованы: ${drawn} за 20 кадров`);
    }
    const speed = fmtSpeed(game.ship.speed).split(' ')[0];
    const need = [speed, 'ДАЛЬН', 'КОРПУС', 'ШАССИ', 'ПОЛЁТ', 'КАРТА'];
    const miss = need.filter((w) => !seen.some((t) => t.indexOf(w) >= 0));
    if (miss.length) throw new Error('на мониторах нет: ' + miss.join(', '));
    // Угловых панелей в кабине нет — их место заняли мониторы.
    texts = [];
    frames(1);
    const hud = texts.filter((t) => t.s.indexOf('ФОРСАЖ') >= 0 && t.size > 9);
    texts = null;
    if (hud.length > 0 && game.displays.list.every((d) => d.next > 1e12)) {
      throw new Error('в кабине остались угловые панели');
    }

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

    // Ручка ходит за органами управления: держим крен и смотрим, что она
    // отклонилась почти до упора.
    holdDown('KeyE'); frames(20);
    const rolled = game.yoke.roll;
    release('KeyE'); frames(30);
    if (!(Math.abs(rolled) > YOKE.roll * 0.7)) {
      throw new Error('ручка не пошла за креном: ' + rolled.toFixed(2));
    }
    if (Math.abs(game.yoke.roll) > 0.05) {
      throw new Error('ручка не вернулась в нейтраль: ' + game.yoke.roll.toFixed(2));
    }
    // РУД — за заданной тягой: здесь проверяется только проводка (ход
    // РУДа — в tools/test.mjs). Один кадр на половине тяги: полный газ
    // клавишей разгонял корабль, и следующие шаги начинали не с того.
    const thr0 = game.yoke.throttle;
    sh.throttle = 0.5;
    frames(1);
    const thr1 = game.yoke.throttle;
    sh.throttle = keep.throttle;
    if (!(thr1 > thr0 + 1e-3)) {
      throw new Error(`РУД не идёт за тягой: ${thr0.toFixed(3)} -> ${thr1.toFixed(3)}`);
    }
  } finally {
    // Возвращаем как было, даже если проверка упала: иначе все
    // следующие шаги шли бы «в кабине» без угловых панелей.
    game.cockpit = saved;
    game.displays = savedD;
    Object.assign(sh.pos, keep.pos); Object.assign(sh.vel, keep.vel);
    sh.speed = keep.speed; sh.throttle = keep.throttle;
    Object.assign(sh.basis.right, keep.basis.right); Object.assign(sh.basis.up, keep.basis.up);
    Object.assign(sh.basis.fwd, keep.basis.fwd);
    frames(2);
  }
});

await step('пилот на ногах: Y — встать, ходьба, голова, двери, E — сесть; ручки корабля отпущены', async () => {
  // Помещения рисует проход кабины, а smoke идёт на Canvas-2D: модель
  // кабины подставляется руками, как в шаге про кабину. Сами помещения
  // собирает игра — лениво, тем же вызовом, что и в браузере.
  const { buildCockpit } = await import('../js/models/cockpit.js');
  const { input } = await import('../js/core/input.js');
  const { WALK } = await import('../js/game/walker.js');
  const saved = game.cockpit;
  const sh = game.ship;
  const keep = {
    pos: { ...sh.pos }, vel: { ...sh.vel }, speed: sh.speed, throttle: sh.throttle,
    basis: { right: { ...sh.basis.right }, up: { ...sh.basis.up }, fwd: { ...sh.basis.fwd } },
  };
  try {
    game.cockpit = buildCockpit();
    if (game.state.mode !== 'flight') throw new Error('режим ' + game.state.mode);
    await game.loadInterior();
    if (!game.interior) throw new Error('помещения корабля не собрались');
    const view0 = game.state.view;
    // Тяга — ноль: брошенный на ходу корабль у станции за прогулку в
    // него и врежется (это проверено — и пилот тогда возвращается в
    // кресло, как при любом крушении).
    sh.throttle = 0;
    frames(2);
    const fwd0 = { ...sh.basis.fwd };

    key('KeyY'); frames(2);
    if (!game.walk.on) throw new Error('Y не поднял пилота');
    if (game.state.view !== 'cockpit') throw new Error('на ногах вид не от первого лица');
    frames(Math.ceil(WALK.rise * 60) + 2);
    if (game.walk.phase !== 'walk') throw new Error('пилот не встал: ' + game.walk.phase);

    // Приборы на ногах: подсказка клавиш (на сенсорном профиле — своя),
    // состояние брошенного корабля и название помещения.
    texts = []; frames(2);
    let seen = texts.map((t) => t.s); texts = null;
    for (const want of ['ДЖОЙСТИК — ИДТИ', 'КОРАБЛЬ БЕЗ ПИЛОТА']) {
      if (!seen.some((s) => s.indexOf(want) >= 0)) throw new Error('в приборах на ногах нет «' + want + '»');
    }
    if (seen.some((s) => s === 'ТЯГА' || s === 'КОРПУС')) throw new Error('на ногах остались полётные панели');

    // Клавиши ходьбы — ногам: S уводит назад, а нос корабля стоит.
    const z0 = game.walk.pos[2];
    holdDown('KeyS'); frames(30); release('KeyS'); frames(10);
    if (!(game.walk.pos[2] < z0 - 0.6)) {
      throw new Error('S не повёл пилота назад: ' + z0.toFixed(2) + ' -> ' + game.walk.pos[2].toFixed(2));
    }
    const d = fwd0.x * sh.basis.fwd.x + fwd0.y * sh.basis.fwd.y + fwd0.z * sh.basis.fwd.z;
    // Shift на ногах — бег, а не прибавка тяги.
    holdDown('ShiftLeft'); holdDown('KeyS'); frames(30); release('KeyS'); release('ShiftLeft'); frames(10);
    if (d < 0.99999 || sh.control.pitch !== 0 || sh.throttle !== 0) {
      throw new Error('клавиши ходьбы дошли до ручек корабля: тяга ' + sh.throttle);
    }
    // Бегом отошли назад ещё — вернёмся вперёд.
    holdDown('KeyW'); frames(45); release('KeyW'); frames(10);
    // Голова: мышь в захвате вертит взгляд без кнопки, стрелки — без мыши.
    const yaw0 = game.walk.yaw;
    input.locked = true;
    for (const fn of winListeners.mousemove || []) fn({ movementX: 100, movementY: 0 });
    frames(1);
    input.locked = false;
    if (Math.abs(game.walk.yaw - yaw0 - 100 * WALK.look) > 1e-6) {
      throw new Error('мышь в захвате не повернула голову: ' + (game.walk.yaw - yaw0).toFixed(3));
    }
    holdDown('ArrowLeft'); frames(20); release('ArrowLeft'); frames(1);
    if (!(game.walk.yaw < yaw0 + 100 * WALK.look - 0.4)) throw new Error('стрелка не повернула голову');

    // Пробел — прыжок, а не форсаж.
    const y0 = game.walk.pos[1];
    key('Space'); frames(10);
    if (!(game.walk.pos[1] > y0 + 0.2) || sh.boosting) throw new Error('пробел на ногах — не прыжок');
    frames(40);

    // К двери рубки: развернуться к корме и идти. Дверь открывается сама.
    game.walk.yaw = Math.PI;
    const door = game.interior.doors.find((x) => x.id === 'bridge');
    holdDown('KeyW'); frames(150); release('KeyW'); frames(5);
    if (!(door.open > 0.9) || !(game.walk.pos[2] < -14.0)) {
      throw new Error(`к двери рубки не дошли: z ${game.walk.pos[2].toFixed(2)}, дверь ${door.open.toFixed(2)}`);
    }
    // Обратно к креслу — до упора в его спинку.
    game.walk.yaw = 0;
    holdDown('KeyW'); frames(240); release('KeyW'); frames(30);
    if (door.open !== 0) throw new Error('дверь рубки не закрылась за спиной');
    texts = []; frames(2);
    seen = texts.map((t) => t.s); texts = null;
    if (!seen.some((s) => s.indexOf('СЕСТЬ') >= 0)) throw new Error('у кресла нет подсказки «сесть»');

    key('KeyE'); frames(Math.ceil(WALK.sit * 60) + 3);
    if (game.walk.on) throw new Error('E у кресла не посадил пилота');
    if (game.state.view !== view0) throw new Error('вид не вернулся: ' + game.state.view);
    // Сидя ручки снова у пилота.
    holdDown('KeyW'); frames(10); release('KeyW');
    if (!(sh.control.pitch !== 0 || game.yoke.pitch !== 0)) throw new Error('сев, пилот не взял ручку');
    frames(20);
  } finally {
    if (game.walk.on) { key('KeyE'); frames(50); }
    game.cockpit = saved;
    Object.assign(sh.pos, keep.pos); Object.assign(sh.vel, keep.vel);
    sh.speed = keep.speed; sh.throttle = keep.throttle;
    Object.assign(sh.basis.right, keep.basis.right); Object.assign(sh.basis.up, keep.basis.up);
    Object.assign(sh.basis.fwd, keep.basis.fwd);
  }
});

// Шлюз — сквозь всю игру: посадка на мир с атмосферой (раньше это было
// крушение), пилот встаёт, идёт в носовой шлюз, E — цикл, люк, трап;
// по трапу на грунт, в оси грунта; обратно в тоннель — в оси корабля;
// E — люк закрыт, шлюз под давлением, дверь в трюм отперта.
await step('шлюз: сели на мир с атмосферой, E — люк и трап, за бортом по грунту и обратно, люк задраен', async () => {
  const { buildCockpit } = await import('../js/models/cockpit.js');
  const { AIR } = await import('../js/game/airlock.js');
  const S = await import('../js/game/surface.js');
  const saved = game.cockpit;
  const sh = game.ship;
  const keep = {
    pos: { ...sh.pos }, vel: { ...sh.vel }, speed: sh.speed, throttle: sh.throttle,
    basis: { right: { ...sh.basis.right }, up: { ...sh.basis.up }, fwd: { ...sh.basis.fwd } },
    gear: { ...sh.gear },
  };
  try {
    game.cockpit = buildCockpit();
    await game.loadInterior();
    if (game.state.mode !== 'flight') throw new Error('режим ' + game.state.mode);
    // Сухое ровное место океанического мира — оно же проверка, что на мир
    // с атмосферой садятся.
    const b = game.world.planets.find((p) => p.kind === 'ocean');
    let d = null;
    for (let i = 0; i < 3000 && !d; i++) {
      const u = -0.5 + (i / 2999), a = i * 2.399963, s = Math.sqrt(1 - u * u);
      const q = { x: s * Math.cos(a), y: u, z: s * Math.sin(a) };
      if (!S.waterAt(b, q) && S.slopeAt(b, q) < 0.05 && S.groundRadius(b, q) - b.radius > 0.05) d = q;
    }
    if (!d) throw new Error('на океаническом мире не нашлось ровной суши');
    S.worldPoint(b, d, S.groundRadius(b, d) + 0.02, sh.pos);
    const up = { x: sh.pos.x - b.pos.x, y: sh.pos.y - b.pos.y, z: sh.pos.z - b.pos.z };
    const ul = Math.hypot(up.x, up.y, up.z);
    up.x /= ul; up.y /= ul; up.z /= ul;
    const hz = Math.abs(up.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const f = { x: hz.y * up.z - hz.z * up.y, y: hz.z * up.x - hz.x * up.z, z: hz.x * up.y - hz.y * up.x };
    const fl = Math.hypot(f.x, f.y, f.z);
    lookAlong(sh.basis, { x: f.x / fl, y: f.y / fl, z: f.z / fl }, up);
    sh.vel.x = sh.vel.y = sh.vel.z = 0; sh.speed = 0; sh.throttle = 0;
    frames(2);
    if (!game.landHere() || game.state.mode !== 'landed') throw new Error('не сели: ' + game.state.mode);
    frames(2);
    if (game.state.mode !== 'landed') throw new Error('корабль на грунте мира с атмосферой не устоял: ' + game.state.mode);

    key('KeyY'); frames(60);
    const w = game.walk, I = game.interior, air = I.air;
    if (!w.on || w.phase !== 'walk') throw new Error('не встали');
    // В носовой шлюз, лицом к правому люку.
    w.pos = [3.3, -9.0, 15.3]; w.room = I.roomById.lockN; w.yaw = Math.PI / 2; w.pitch = 0;
    frames(3);
    texts = []; frames(2);
    let seen = texts.map((t) => t.s); texts = null;
    if (!seen.some((s) => s.indexOf('ОТКРЫТЬ ЛЮК') >= 0)) throw new Error('у люка нет подсказки «открыть люк»');
    const hx = air.hatches.find((x) => x.id === 'nR');
    const door = I.doors.find((x) => x.id === 'lockN');
    // Шаги: какие поверхности прозвучали по дороге (звук считается без
    // звуковой карты — события очереди js/game/audio.js).
    const steps = [];
    const push0 = game.audio.events.push;
    game.audio.events.push = function (...e) {
      for (const x of e) if (x.kind === 'step') steps.push(x.surface + (x.heavy > 0 ? '!' : ''));
      return push0.apply(this, e);
    };
    key('KeyE');
    const cycle = Math.abs(1 - air.pOut) / AIR.rate + AIR.hatchTime + AIR.stairTime;
    frames(Math.ceil(cycle * 60) + 30);
    if (!(hx.open === 1 && hx.stair === 1 && hx.exitOk)) {
      throw new Error(`люк не открылся за ${cycle.toFixed(1)} с: панель ${hx.open}, трап ${hx.stair}`);
    }
    if (!(Math.abs(air.locks.lockN.p - air.pOut) < 0.01 && air.pOut > 0.5)) {
      throw new Error('давление в шлюзе не забортное: ' + air.locks.lockN.p.toFixed(2) + ' при ' + air.pOut.toFixed(2));
    }
    // Люк открыт, а в корабль — свободно: дверь в трюм открывается перед
    // пилотом, и трюм, пока она открыта, связан с забортным.
    w.pos = [0, -9.0, 14.2]; w.yaw = Math.PI; w.pitch = 0;
    let leaked = false;
    holdDown('KeyW');
    for (let i = 0; i < 90; i++) { frames(1); leaked = leaked || air.rooms.hold.leak; }
    release('KeyW'); frames(10);
    if (!w.room || w.room.id !== 'hold' || !leaked || door.open === 0 && w.pos[2] > 12) {
      throw new Error('из открытого шлюза в трюм не пройти: ' + (w.room && w.room.id) + ', трюм открыт забортному ' + leaked);
    }
    w.yaw = 0;
    holdDown('KeyW'); frames(90); release('KeyW'); frames(10);
    if (!w.room || w.room.id !== 'lockN') throw new Error('из трюма в открытый шлюз не вернуться: ' + (w.room && w.room.id));
    w.pos = [3.3, -9.0, 15.3]; w.room = I.roomById.lockN; w.yaw = Math.PI / 2; w.pitch = 0;
    frames(3);
    // Наружу и по трапу вниз.
    holdDown('KeyW'); frames(60 * 6); release('KeyW'); frames(10);
    if (!w.out) throw new Error('за порог не вышли: ' + w.pos.map((v) => v.toFixed(2)).join(','));
    const away = Math.hypot(w.pos[0], w.pos[2]);
    if (!(away > 6) || !w.ground) throw new Error('по трапу на грунт не сошли: ' + away.toFixed(1) + ' м от порога');
    texts = []; frames(2);
    seen = texts.map((t) => t.s); texts = null;
    if (!seen.some((s) => s.indexOf('ТЯЖЕСТЬ') >= 0 && s.indexOf('БАР') >= 0)) {
      throw new Error('за бортом нет строки о тяжести и воздухе');
    }
    // Прыжок за бортом — по тяжести планеты, не палубы.
    const y0 = w.pos[1];
    let peak = y0;
    key('Space');
    for (let i = 0; i < 90; i++) { frames(1); peak = Math.max(peak, w.pos[1]); }
    const g = 9.81 * 0.45 / Math.max(0.01, peak - y0);
    if (!(peak - y0 > 0.5)) throw new Error('прыжок за бортом — как на палубе: ' + (peak - y0).toFixed(2) + ' м');
    game.audio.events.push = push0;
    const heard = new Set(steps);
    if (!heard.has('metal') || !(heard.has('ground') || heard.has('grass')) || !steps.some((s) => s.endsWith('!'))) {
      throw new Error('шаги не те: ' + [...heard].join(', '));
    }
    // Обратно: развернуться и вверх по трапу — в тоннель.
    w.yaw += Math.PI;
    holdDown('KeyW');
    for (let i = 0; i < 60 * 10 && w.out; i++) frames(1);
    // Дальше от проёма: пока стоишь в нём, люк не закрыть.
    frames(25); release('KeyW'); frames(5);
    if (w.out || !w.room || w.room.id !== 'lockN') {
      throw new Error('с трапа в шлюз не вернулись: ' + (w.out ? 'за бортом' : w.room && w.room.id));
    }
    // E — задраить: трап, люк, наддув, дверь отперта.
    frames(2);
    key('KeyE');
    frames(Math.ceil((AIR.stairTime / 1.3 + AIR.hatchTime + (1 - air.pOut) / AIR.rate) * 60) + 40);
    if (!(hx.stair === 0 && hx.open === 0 && air.locks.lockN.state === 'sealed')) {
      throw new Error(`шлюз не задраился: трап ${hx.stair}, люк ${hx.open}, ${air.locks.lockN.state}; ` +
        `пилот ${w.pos.map((v) => v.toFixed(2)).join(',')}, люк под рукой ${game.walkHatch && game.walkHatch.id}, ` +
        `сказано: ${game.state.messages.map((m) => m.text).join(' | ')}`);
    }
    if (g > 9) throw new Error('тяжесть за бортом — палубная');
  } finally {
    if (game.walk.on) {
      game.walk.out = null;
      game.walk.pos = game.interior.seat.stand.slice(); game.walk.room = game.interior.roomById.bridge;
      frames(2); key('KeyE'); frames(50);
    }
    if (game.interior && game.interior.air) {
      for (const x of game.interior.air.hatches) { x.want = false; x.open = 0; x.stair = 0; }
      for (const L of Object.values(game.interior.air.locks)) { L.p = 1; L.state = 'sealed'; L.vent = false; }
      for (const r of Object.values(game.interior.air.rooms)) { r.p = 1; r.leak = false; }
    }
    game.cockpit = saved;
    game.state.mode = 'flight';
    sh.landedAt = null; sh.landedPose = null;
    Object.assign(sh.pos, keep.pos); Object.assign(sh.vel, keep.vel);
    sh.speed = keep.speed; sh.throttle = keep.throttle;
    Object.assign(sh.basis.right, keep.basis.right); Object.assign(sh.basis.up, keep.basis.up);
    Object.assign(sh.basis.fwd, keep.basis.fwd);
    Object.assign(sh.gear, keep.gear);
    frames(2);
  }
});

// Шлюз на склоне. Корабль садится на три стойки и стоит на склоне с креном
// и тангажом до 20°, а человек за бортом стоит по отвесу: проём для него
// наклонён. Раньше твёрдое корабля ложилось в оси грунта охватывающими
// коробками, а они на крене раздуваются: бортовой люк не выпускал уже на
// полутора градусах, носовой — с семи, обратно с трапа упирались в пустоту
// у самого входа, а пята трапа висела над склоном выше шага. Из 96 проходов
// (пять склонов до 18°, шесть курсов, четыре люка) туда и обратно удавалось
// 29. Здесь — самый крутой из них, двумя курсами: крен и тангаж.
await step('шлюз на склоне: крен и тангаж до 18°, все четыре трапа — на грунт и обратно в шлюз', async () => {
  const { buildCockpit } = await import('../js/models/cockpit.js');
  const A = await import('../js/game/airlock.js');
  const S = await import('../js/game/surface.js');
  const { WALK } = await import('../js/game/walker.js');
  const { vesselPoint } = await import('../js/game/vessels.js');
  const { worldToGround } = await import('../js/game/outside.js');
  const saved = game.cockpit;
  const sh = game.ship;
  const keep = {
    pos: { ...sh.pos }, vel: { ...sh.vel }, speed: sh.speed, throttle: sh.throttle,
    basis: { right: { ...sh.basis.right }, up: { ...sh.basis.up }, fwd: { ...sh.basis.fwd } },
    gear: { ...sh.gear },
  };
  const w = game.walk;
  try {
    game.cockpit = buildCockpit();
    await game.loadInterior();
    const I = game.interior, air = I.air;
    const b = game.world.planets.find((p) => p.kind === 'ocean');
    // Суша с уклоном 16–19° (посадка допускает до 20°).
    let q = null;
    for (let i = 0; i < 20000 && !q; i++) {
      const u = -0.8 + 1.6 * (i / 19999), a = i * 2.399963, s = Math.sqrt(1 - u * u);
      const d = { x: s * Math.cos(a), y: u, z: s * Math.sin(a) };
      const sl = S.slopeAt(b, d);
      if (!S.waterAt(b, d) && sl > 0.28 && sl < 0.34 && S.groundRadius(b, d) - b.radius > 0.05) q = d;
    }
    if (!q) throw new Error('на океаническом мире не нашлось склона в 16–19°');
    const dot = (u, v) => u.x * v.x + u.y * v.y + u.z * v.z;
    const land = (heading) => {
      game.state.mode = 'flight';
      sh.landedAt = null; sh.landedPose = null;
      S.worldPoint(b, q, S.groundRadius(b, q) + 0.02, sh.pos);
      const up = { x: sh.pos.x - b.pos.x, y: sh.pos.y - b.pos.y, z: sh.pos.z - b.pos.z };
      const ul = Math.hypot(up.x, up.y, up.z); up.x /= ul; up.y /= ul; up.z /= ul;
      const hz = Math.abs(up.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      const f0 = { x: hz.y * up.z - hz.z * up.y, y: hz.z * up.x - hz.x * up.z, z: hz.x * up.y - hz.y * up.x };
      const fl = Math.hypot(f0.x, f0.y, f0.z); f0.x /= fl; f0.y /= fl; f0.z /= fl;
      const r = { x: f0.y * up.z - f0.z * up.y, y: f0.z * up.x - f0.x * up.z, z: f0.x * up.y - f0.y * up.x };
      const c = Math.cos(heading), s = Math.sin(heading);
      lookAlong(sh.basis, { x: f0.x * c + r.x * s, y: f0.y * c + r.y * s, z: f0.z * c + r.z * s }, up);
      sh.vel.x = sh.vel.y = sh.vel.z = 0; sh.speed = 0; sh.throttle = 0;
      frames(2);
      if (!game.landHere() || game.state.mode !== 'landed') throw new Error('на склон не сели: ' + game.state.mode);
      frames(2);
      const P = { x: sh.pos.x - b.pos.x, y: sh.pos.y - b.pos.y, z: sh.pos.z - b.pos.z };
      const pl = Math.hypot(P.x, P.y, P.z);
      return { roll: Math.asin(dot(sh.basis.right, P) / pl) * 180 / Math.PI, pitch: Math.asin(dot(sh.basis.fwd, P) / pl) * 180 / Math.PI };
    };
    // В шлюз, лицом к люку.
    const putIn = (hx) => {
      const h = hx.h, r = I.roomById[h.lock], wall = h.side > 0 ? r.hi[0] : r.lo[0];
      w.out = null; w.air = null; w.vessel = game.ownVessel;
      w.pos = [wall - h.side * 0.9, r.lo[1] + 0.01, hx.zc]; w.vel = [0, 0, 0];
      w.room = r; w.yaw = h.side * Math.PI / 2; w.pitch = 0;
      frames(3);
    };
    // Обратно — по оси трапа, как идёт игрок, который его видит: на склоне
    // трап в осях грунта идёт вкось, низ сдвинут вбок на полметра.
    const steerUp = (hx) => {
      const V = game.ownVessel;
      const toG = (p) => worldToGround(w.out, vesselPoint(V, p));
      const H = toG(A.stairPoint(hx, 1, [0, 0, 0]));
      const F = toG(A.stairPoint(hx, 1, [hx.design.foot[0], hx.design.foot[1], 0]));
      const ax = H[0] - F[0], az = H[2] - F[2], L = Math.hypot(ax, az);
      const along = ((w.pos[0] - F[0]) * ax + (w.pos[2] - F[2]) * az) / L;
      const side = Math.abs((w.pos[0] - F[0]) * az - (w.pos[2] - F[2]) * ax) / L;
      // Далеко сбоку — сначала выйти на ось перед пятой, потом вверх.
      const k = side > 0.3 && along < 0.5 ? -1.5 : Math.max(0, Math.min(L, along)) + 1;
      w.yaw = Math.atan2(F[0] + ax / L * k - w.pos[0], F[2] + az / L * k - w.pos[2]);
    };
    const tilts = [], bad = [];
    if (!w.on) { key('KeyY'); frames(60); }
    for (const heading of [0, Math.PI / 2]) {
      const t = land(heading);
      tilts.push(`крен ${t.roll.toFixed(0)}°, тангаж ${t.pitch.toFixed(0)}°`);
      if (Math.hypot(t.roll, t.pitch) < 12) throw new Error('корабль на склоне стоит почти ровно: ' + tilts.join('; '));
      if (!w.on) { key('KeyY'); frames(60); }
      for (const hx of air.hatches) {
        for (const x of air.hatches) x.want = false;
        hx.want = true;
        putIn(hx);
        frames(Math.ceil((2 / A.AIR.rate + A.AIR.hatchTime + A.AIR.stairTime) * 60) + 40);
        if (!(hx.open === 1 && hx.stair === 1 && hx.exitOk)) { bad.push(hx.id + ': люк не открылся'); continue; }
        putIn(hx);
        holdDown('KeyW');
        for (let i = 0; i < 60 * 8 && !(w.out && w.ground && Math.hypot(w.pos[0], w.pos[2]) > 6.5); i++) frames(1);
        release('KeyW'); frames(5);
        if (!w.out || !(Math.hypot(w.pos[0], w.pos[2]) > 6)) {
          bad.push(`${hx.id} (${tilts[tilts.length - 1]}): наружу не сошли — ` + (w.out ? 'встали за бортом в ' : 'остались на палубе в ')
            + w.pos.map((v) => v.toFixed(2)).join(', '));
          continue;
        }
        holdDown('KeyW');
        for (let i = 0; i < 60 * 12 && w.out; i++) { steerUp(hx); frames(1); }
        frames(60);
        release('KeyW'); frames(5);
        if (w.out || !w.room || w.room.id !== hx.h.lock) {
          bad.push(`${hx.id} (${tilts[tilts.length - 1]}): с трапа в шлюз не вернулись — ` + (w.out ? 'за бортом в ' : 'на палубе в ')
            + w.pos.map((v) => v.toFixed(2)).join(', '));
        } else if ((w.height || WALK.height) < WALK.height) {
          bad.push(`${hx.id}: в шлюзе так и не выпрямились, рост ${w.height.toFixed(2)} м`);
        }
      }
      for (const x of air.hatches) x.want = false;
      putIn(air.hatches[0]);
      frames(60 * 6);
    }
    if (bad.length) throw new Error(bad.length + ' из 8: ' + bad.join('; '));
  } finally {
    if (game.walk.on) {
      game.walk.out = null;
      game.walk.pos = game.interior.seat.stand.slice(); game.walk.room = game.interior.roomById.bridge;
      frames(2); key('KeyE'); frames(50);
    }
    if (game.interior && game.interior.air) {
      for (const x of game.interior.air.hatches) { x.want = false; x.open = 0; x.stair = 0; }
      for (const L of Object.values(game.interior.air.locks)) { L.p = 1; L.state = 'sealed'; L.vent = false; }
      for (const r of Object.values(game.interior.air.rooms)) { r.p = 1; r.leak = false; }
    }
    game.cockpit = saved;
    game.state.mode = 'flight';
    sh.landedAt = null; sh.landedPose = null;
    Object.assign(sh.pos, keep.pos); Object.assign(sh.vel, keep.vel);
    sh.speed = keep.speed; sh.throttle = keep.throttle;
    Object.assign(sh.basis.right, keep.basis.right); Object.assign(sh.basis.up, keep.basis.up);
    Object.assign(sh.basis.fwd, keep.basis.fwd);
    Object.assign(sh.gear, keep.gear);
    frames(2);
  }
});

// Пилот — не корабль. Рядом садится сосед (корабль без хозяина в игре,
// спящий — как его шлёт хаб), люк у него открыт: пилот сходит со своего
// трапа, поднимается по чужому, ходит по чужой палубе, в чужое кресло не
// садится, — а когда сосед уходит в другую систему, игра идёт за ним, и
// свой корабль остаётся стоять, где стоял.
await step('к соседу на борт: по его трапу, чужое кресло, вместе в другую систему и обратно', async () => {
  const { buildCockpit } = await import('../js/models/cockpit.js');
  const A = await import('../js/game/airlock.js');
  const Vs = await import('../js/game/vessels.js');
  const O = await import('../js/game/outside.js');
  const S = await import('../js/game/surface.js');
  const saved = game.cockpit;
  const sh = game.ship;
  const keep = {
    pos: { ...sh.pos }, vel: { ...sh.vel },
    basis: { right: { ...sh.basis.right }, up: { ...sh.basis.up }, fwd: { ...sh.basis.fwd } },
    gear: { ...sh.gear },
  };
  const sys0 = game.sys.id;
  try {
    game.cockpit = buildCockpit();
    await game.loadInterior();
    if (game.state.mode !== 'flight') { key('Space'); frames(4); }
    // Ровная суша океанического мира — как в шаге про шлюз.
    const b = game.world.planets.find((p) => p.kind === 'ocean');
    let d = null;
    for (let i = 0; i < 3000 && !d; i++) {
      const u = -0.5 + (i / 2999), a = i * 2.399963, s = Math.sqrt(1 - u * u);
      const q = { x: s * Math.cos(a), y: u, z: s * Math.sin(a) };
      if (!S.waterAt(b, q) && S.slopeAt(b, q) < 0.03 && S.groundRadius(b, q) - b.radius > 0.05) d = q;
    }
    if (!d) throw new Error('на океаническом мире не нашлось ровной суши');
    S.worldPoint(b, d, S.groundRadius(b, d) + 0.02, sh.pos);
    const up = { x: sh.pos.x - b.pos.x, y: sh.pos.y - b.pos.y, z: sh.pos.z - b.pos.z };
    const ul = Math.hypot(up.x, up.y, up.z);
    up.x /= ul; up.y /= ul; up.z /= ul;
    const hz = Math.abs(up.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const f = { x: hz.y * up.z - hz.z * up.y, y: hz.z * up.x - hz.x * up.z, z: hz.x * up.y - hz.y * up.x };
    const fl = Math.hypot(f.x, f.y, f.z);
    lookAlong(sh.basis, { x: f.x / fl, y: f.y / fl, z: f.z / fl }, up);
    sh.vel.x = sh.vel.y = sh.vel.z = 0; sh.speed = 0; sh.throttle = 0;
    frames(2);
    if (!game.landHere() || game.state.mode !== 'landed') throw new Error('не сели: ' + game.state.mode);
    frames(2);
    const P = sh.landedPose;

    // Сосед — в семидесяти метрах справа, носом туда же; его левый
    // носовой люк смотрит на нас и открыт, трап выдвинут.
    const R = P.radius;
    const lx = P.dir.x * R + P.right.x * 0.07, ly = P.dir.y * R + P.right.y * 0.07, lz = P.dir.z * R + P.right.z * 0.07;
    const l = Math.hypot(lx, ly, lz), dn = { x: lx / l, y: ly / l, z: lz / l };
    const r2 = S.groundRadius(b, dn) + (R - S.groundRadius(b, P.dir));
    const entry = (extra = {}) => Object.assign({ id: 900, by: 77, name: 'СОСЕД', dorm: 1, sys: sys0, mode: 'landed',
      g: 1, h: ['nL'], b: b.id, lx: dn.x * r2, ly: dn.y * r2, lz: dn.z * r2,
      lfx: P.fwd.x, lfy: P.fwd.y, lfz: P.fwd.z, lux: P.up.x, luy: P.up.y, luz: P.up.z }, extra);
    let pin = entry();
    // Хаб шлёт спящий корабль каждым тиком: так его и держим.
    const tickNet = () => { net.peers = pin ? [pin] : []; net.people = []; net.rev++; };
    tickNet(); frames(3);
    let V = game.peers.find((p) => p.id === 900);
    if (!V || !V.air || V.own) throw new Error('спящий сосед не принят: ' + game.peers.length);
    let hx = A.hatchById(V.air, 'nL');
    if (!(hx.open === 1 && hx.stair === 1)) throw new Error('люк соседа не открыт: ' + hx.open + '/' + hx.stair);
    const own = game.interior.air;
    if (A.hatchById(own, 'nL').want) throw new Error('люк соседа открыл и наш');

    // Встать и выйти за борт — сразу к пяте чужого трапа. Пока вставали,
    // снимков не было дольше PEER_TTL: запись соседа заведена заново.
    key('KeyY');
    for (let i = 0; i < 60; i++) { if (i % 12 === 0) tickNet(); frames(1); }
    const w = game.walk;
    if (!w.on) throw new Error('не встали');
    tickNet(); frames(1);
    V = game.peers.find((p) => p.id === 900);
    hx = A.hatchById(V.air, 'nL');
    const foot = A.stairPoint(hx, 1, [hx.design.foot[0] + 1.2, hx.design.foot[1], 0]);
    const Pw = Vs.vesselPoint(V, foot);
    w.out = O.makeGroundFrame(b, Pw, V.basis.fwd);
    w.pos = [0, 0, 0];
    w.vessel = null; w.air = null; w.room = null;
    // Лицом к соседу: по оси x его корабля к борту (люк слева — это +x).
    const toShip = Vs.vesselDir(V, [1, 0, 0]);
    const g = O.worldDirToGround(w.out, toShip);
    w.yaw = Math.atan2(g[0], g[2]); w.pitch = 0;
    frames(3);
    if (!w.out) throw new Error('пилот не за бортом');
    // Вверх по чужому трапу — в чужой шлюз.
    holdDown('KeyW');
    const trace = [];
    for (let i = 0; i < 60 * 12 && w.out; i++) {
      if (i % 12 === 0) tickNet();
      if (i % 30 === 0 && w.out) trace.push(Vs.worldToVessel(V, O.groundToWorld(w.out, w.pos)).map((v) => v.toFixed(1)).join('/'));
      frames(1);
    }
    globalThis.__trace = trace;
    frames(20); release('KeyW');
    for (let i = 0; i < 10; i++) { tickNet(); frames(1); }
    if (w.out || !w.vessel || w.vessel.id !== 900 || w.vessel.own || w.air !== V.air || game.frame !== V) {
      const at = w.out ? Vs.worldToVessel(V, O.groundToWorld(w.out, w.pos)) : w.pos;
      throw new Error('по трапу соседа на его борт не поднялись: ' + (w.out ? 'за бортом' : 'борт ' + (w.vessel && w.vessel.id))
        + ', ноги в осях соседа ' + at.map((v) => v.toFixed(2)).join(', ') + '; пята трапа ' + foot.map((v) => v.toFixed(2)).join(', ')
        + '; люк ' + hx.open + '/' + hx.stair + ' выход ' + hx.exitOk + ' до грунта ' + (hx.footGap || 0).toFixed(2)
        + '; путь ' + (globalThis.__trace || []).join(' '));
    }
    texts = []; frames(2);
    let seen = texts.map((t) => t.s); texts = null;
    if (!seen.some((s) => s.indexOf('НА БОРТУ: КОРАБЛЬ СОСЕД') >= 0)) throw new Error('нет строки «на борту: корабль соседа»');
    // Люк — чужой: открыть его можно только просьбой, а сети в прогоне нет.
    if (!game.walkHatch || game.walkHatchShip !== V) throw new Error('люк под рукой — не соседа');
    key('KeyE'); frames(2);
    if (!game.state.messages.some((m) => m.text.indexOf('ЛЮК ЧУЖОГО КОРАБЛЯ') >= 0)) {
      throw new Error('чужой люк без связи — без отказа: ' + game.state.messages.map((m) => m.text).join(' | '));
    }
    // Чужое кресло: не садятся.
    w.pos = game.interior.seat.stand.slice(); w.room = game.interior.roomById.bridge; w.vel = [0, 0, 0];
    tickNet(); frames(3);
    key('KeyE'); frames(10);
    if (!w.on || !game.state.messages.some((m) => m.text.indexOf('ЗА ХОЗЯИНОМ') >= 0)) {
      throw new Error('в чужое кресло сели — или не сказали почему');
    }
    // Сосед ушёл варпом в систему 2: игра — за ним; свой корабль остался.
    pin = entry({ sys: 2, mode: 'flight', b: undefined, lx: undefined, ly: undefined, lz: undefined,
      x: 1.2e6, y: 0, z: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0 });
    for (let i = 0; i < 6; i++) { tickNet(); frames(1); }
    if (game.sys.id !== 2 || !sh.away || !w.on || !w.vessel || w.vessel.id !== 900) {
      throw new Error(`за кораблём в систему 2 не ушли: система ${game.sys.id}, свой ${sh.away ? 'остался' : 'с нами'}`);
    }
    const there = JSON.parse(savedJson());
    if (there.system !== 2 || there.me.aboard !== 900 || !there.ship || there.ship.system !== sys0
      || !there.ship.landed || there.ship.landed.id !== b.id) {
      throw new Error('сохранение пассажира не то: ' + JSON.stringify({ s: there.system, me: there.me, ship: there.ship && there.ship.system }));
    }
    // Вернулись — свой корабль снова на своей стоянке.
    pin = entry();
    for (let i = 0; i < 6; i++) { tickNet(); frames(1); }
    if (game.sys.id !== sys0 || sh.away || game.state.mode !== 'landed' || !sh.landedAt || sh.landedAt.id !== b.id) {
      throw new Error(`обратно не вернулись: система ${game.sys.id}, режим ${game.state.mode}`);
    }
  } finally {
    net.peers = []; net.people = []; net.rev++;
    frames(2);
    if (game.walk.on) {
      game.walk.out = null; game.walk.vessel = null; game.walk.air = null;
      game.walk.pos = game.interior.seat.stand.slice(); game.walk.room = game.interior.roomById.bridge;
      frames(2); key('KeyE'); frames(50);
    }
    if (game.sys.id !== sys0) throw new Error('прогон остался в чужой системе');
    game.cockpit = saved;
    game.state.mode = 'flight';
    sh.landedAt = null; sh.landedPose = null;
    Object.assign(sh.pos, keep.pos); Object.assign(sh.vel, keep.vel);
    Object.assign(sh.basis.right, keep.basis.right); Object.assign(sh.basis.up, keep.basis.up);
    Object.assign(sh.basis.fwd, keep.basis.fwd);
    Object.assign(sh.gear, keep.gear);
    frames(2);
  }
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
  // Сколько ждать, выводится из самой камеры: она догоняет крен с
  // постоянной времени 1/roll (js/game/chase.js, «Вес»), и за пять таких
  // постоянных от любой разницы остаётся меньше процента. Прежние
  // полсекунды были посчитаны под камеру вдвое легче.
  const rest = Math.ceil(5 / chaseRates().roll * 60);
  frames(rest);
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1,
    a.x * b.x + a.y * b.y + a.z * b.z)));
  // В покое камера стоит ровно за кораблём.
  if (ang(game.camera.basis.up, game.ship.basis.up) > 0.02) {
    throw new Error('камера не села на место в покое');
  }
  // На крене «верх» камеры обязан отставать от корпуса: именно по этому
  // отставанию корабль и читается как тяжёлый.
  // Держим крен столько, сколько корабль на него раскручивается (с
  // задержкой маневровых): тяжёлый корабль за полсекунды только трогается.
  const spinUp = SHIP.rollRate / SHIP.rollAccel + SHIP.rcsLag;
  holdDown('KeyQ');
  frames(Math.ceil(spinUp * 60));
  const lag = ang(game.camera.basis.up, game.ship.basis.up);
  release('KeyQ');
  if (!(lag > 0.08)) throw new Error('камера не отстаёт на крене: ' + lag.toFixed(3));
  if (!(lag < 1.2)) throw new Error('камера отстала слишком сильно: ' + lag.toFixed(3));
  // Перестали крутить — догнала: корабль гасит вращение, камера его
  // догоняет, и на то и другое — те же пять постоянных.
  frames(rest + Math.ceil((spinUp + 2 * SHIP.rcsBand) * 60));
  const settled = ang(game.camera.basis.up, game.ship.basis.up);
  if (!(settled < 0.02)) throw new Error('камера не догнала: ' + settled.toFixed(3));
  key('KeyV'); frames(2);
});

await step('выбор цели наведением (Tab) и форсаж (Space)', () => {
  // Цель выбирается тем, что на неё наведён нос. Наводимся на планету
  // явно: «нажать Tab и посмотреть, что изменилось» теперь ничего не
  // проверяет — могло и не быть под прицелом никого.
  //
  // Планету выбираем ту, что дальше всех по углу от любой станции.
  //
  // Станция теперь два километра поперёк, и с пары километров она
  // накрывает прицел целиком; рукотворное под прицелом выигрывает у
  // планеты намеренно (js/game/nav.js) — целятся в порт, а не в тело за
  // ним. Ткнуть в планету «рядом со станцией» и ждать планету значит
  // проверять совпадение, а не правило.
  const dirTo = (b) => {
    const sp = game.ship.pos;
    const d = Math.hypot(b.pos.x - sp.x, b.pos.y - sp.y, b.pos.z - sp.z) || 1;
    return { x: (b.pos.x - sp.x) / d, y: (b.pos.y - sp.y) / d, z: (b.pos.z - sp.z) / d };
  };
  let planet = game.world.home, apart = -1;
  for (const b of game.world.planets) {
    const d = dirTo(b);
    let worst = 1;
    for (const st of game.world.stations) {
      const s2 = dirTo(st);
      worst = Math.min(worst, 1 - (d.x * s2.x + d.y * s2.y + d.z * s2.z));
    }
    if (worst > apart) { apart = worst; planet = b; }
  }
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

// Фары (O): две лампы в носу. Картинку считает шейдер, и её здесь не
// проверить, а вот связку «клавиша — состояние корабля — надпись в
// приборах» проверить можно и нужно: именно она рвётся молча.
await step('фары: O включает свет и говорит об этом', () => {
  if (game.state.mode !== 'flight') { key('Space'); frames(4); }
  const was = game.ship.lights;
  if (was) { key('KeyO'); frames(2); }

  key('KeyO'); frames(2);
  if (!game.ship.lights) throw new Error('O не включил фары');
  texts = [];
  frames(2);
  const on = texts.map((t) => t.s);
  texts = null;
  if (!on.some((t) => t.indexOf('ФАРЫ') >= 0)) {
    throw new Error('в приборах не сказано, что фары включены');
  }

  key('KeyO'); frames(2);
  if (game.ship.lights) throw new Error('O не выключил фары');
  texts = [];
  frames(2);
  const off = texts.map((t) => t.s);
  texts = null;
  if (off.some((t) => t === 'ФАРЫ')) {
    throw new Error('выключенные фары всё ещё в приборах');
  }
  if (was) { key('KeyO'); frames(2); }
});

// Гасители инерции (T): выключенные, они меняют полёт целиком, и
// сказать об этом обязаны приборы. Проверяется вся связка разом —
// клавиша, модель, надпись.
await step('гасители инерции: T, полёт по инерции и надпись в приборах', () => {
  if (game.state.mode !== 'flight') { key('Space'); frames(4); }
  // Вид и место возвращаем в конце: шаг не должен менять сцену под
  // соседями. На этом он один раз уже сломал проверку отметки грунта —
  // та рисуется только от третьего лица.
  const view0 = game.state.view;
  const at0 = { x: game.ship.pos.x, y: game.ship.pos.y, z: game.ship.pos.z };
  if (view0 !== 'chase') { key('KeyV'); frames(2); }

  // В пустое место и на ход: у поверхности снятые гасители означают
  // падение, а проверяем мы здесь не его.
  game.ship.pos.x = 0; game.ship.pos.y = 2.4e6; game.ship.pos.z = 0;
  game.ship.throttle = 1;
  frames(150);
  const cruise = game.ship.speed;
  if (!(cruise > 0.3)) throw new Error('корабль не разогнался: ' + cruise.toFixed(3));

  key('KeyT'); frames(2);
  if (game.ship.damp !== false) throw new Error('T не выключил гасители');

  texts = [];
  frames(2);
  const list = texts.map((t) => t.s);
  texts = null;
  if (!list.some((t) => t.indexOf('ГАСИТЕЛИ') >= 0)) {
    throw new Error('в приборах не сказано, что гасители сняты');
  }

  // Тяга в ноль — и корабль НЕ тормозит. Это и есть весь режим.
  //
  // Отсчёт берётся ИМЕННО ЗДЕСЬ, а не до нажатия: на полной тяге корабль
  // ещё разгонялся, и сравнение с более ранним значением ловило бы этот
  // разгон, а не работу гасителей.
  game.ship.throttle = 0;
  frames(2);
  const drift = game.ship.speed;
  frames(120);
  if (Math.abs(game.ship.speed - drift) > 1e-6) {
    throw new Error('без гасителей ход изменился сам: '
      + drift.toFixed(3) + ' -> ' + game.ship.speed.toFixed(3));
  }

  // Обратно: с гасителями тот же нулевой ход корабль останавливает.
  key('KeyT'); frames(2);
  if (game.ship.damp !== true) throw new Error('T не включил гасители обратно');
  frames(180);
  if (!(game.ship.speed < drift * 0.5)) {
    throw new Error('с гасителями корабль не тормозит: ' + game.ship.speed.toFixed(3));
  }

  game.ship.vel.x = game.ship.vel.y = game.ship.vel.z = 0;
  game.ship.speed = 0; game.ship.throttle = 0;
  game.ship.pos.x = at0.x; game.ship.pos.y = at0.y; game.ship.pos.z = at0.z;
  if (game.state.view !== view0) { key('KeyV'); frames(2); }
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
  // Бак полный: проверяется привод, а не то, сколько топлива оставили
  // шаги выше.
  game.ship.fuel = SHIP.fuelCap;
  const fuel0 = game.ship.fuel;
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
  // Ход стоит топлива — не меньше, чем по прямой от старта до цели.
  const burnt = fuel0 - game.ship.fuel;
  const least = F.quantumTons((d0 - d1) * 0.95);
  if (!(burnt >= least)) {
    throw new Error('квантовый ход почти не стоил топлива: ' + burnt.toFixed(3) + ' т при минимуме '
      + least.toFixed(3));
  }
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
  // Полторы секунды: тяжёлый корабль трогается с задержкой, и за
  // полсекунды рыскание успевает довернуть его на полградуса.
  holdDown('KeyD'); frames(90); release('KeyD');
  const back = f0.x * game.ship.basis.fwd.x + f0.y * game.ship.basis.fwd.y + f0.z * game.ship.basis.fwd.z;
  if (back > 0.999) throw new Error('после закрытия меню корабль не слушается: dot ' + back.toFixed(5));
  } finally {
    // Что бы ни упало выше, следующие проверки должны начинать с
    // закрытого меню и живого управления.
    game.menu.open = false;
    game.ship.vel.x = 0; game.ship.vel.y = 0; game.ship.vel.z = 0;
    game.ship.speed = 0; game.ship.throttle = 0;
    // Корабль по инерции ещё доворачивал бы секунды две.
    game.ship.rot.pitch = game.ship.rot.yaw = game.ship.rot.roll = 0;
    if (game.ship.torq) game.ship.torq.pitch = game.ship.torq.yaw = game.ship.torq.roll = 0;
    frames(2);
  }
});

// Чужие корабли. Проверка тупая, но именно она ловит класс ошибок
// «нарисовали то, чего не рисовали никогда»: пока список пилотов пуст,
// весь этот код не выполняется, и опечатка в нём живёт до первой встречи
// в космосе (так и случилось: в подписи стояла переменная, которой в
// этом файле нет).
await step('чужие пилоты: число, отметка и метка с расстоянием', async () => {
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

  // В кабине — экран локатора на доске (js/ui/panels.js), а на
  // запасном пути без кабины — та же угловая панель. Проверяем оба.
  const cockpit2d = seenIn('cockpit');
  if (!cockpit2d.some((t) => t.indexOf('ПИЛОТОВ РЯДОМ 2') >= 0)) {
    throw new Error('в кабине без мониторов числа пилотов нет');
  }
  {
    const { buildCockpit } = await import('../js/models/cockpit.js');
    const { makeDisplays } = await import('../js/ui/displays.js');
    const saved = game.cockpit, savedD = game.displays;
    game.cockpit = buildCockpit();
    game.displays = makeDisplays(game.cockpit, { canvas: () => document.createElement('canvas') });
    try {
      push();
      texts = [];
      frames(4);
      const seen = texts.map((t) => t.s);
      texts = null;
      if (!seen.some((t) => t.indexOf('ПИЛОТОВ РЯДОМ 2') >= 0)) {
        throw new Error('на локаторе в кабине числа пилотов нет');
      }
    } finally {
      game.cockpit = saved;
      game.displays = savedD;
    }
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
  // Направление СТВОЛА — это скорость болта за вычетом хода корабля: болт
  // уносит наш ход с собой, и по мировому его пути кардан уже не
  // проверить, там намешан ещё и снос.
  const v = game.ship.vel;
  const mx = b.vx - v.x, my = b.vy - v.y, mz = b.vz - v.z;
  const ml = Math.hypot(mx, my, mz) || 1;
  const along = (mx * f.x + my * f.y + mz * f.z) / ml;
  if (!(along < 0.9999)) throw new Error('кардан не довернул: болт ушёл строго по носу');
  if (!(along > 0.9)) throw new Error('кардан развернуло слишком сильно: ' + along.toFixed(4));

  // Ход корабля болт уносит с собой: на полном ходу очередь обязана
  // уходить от носа всё с той же дульной скоростью. Пока скорость болта
  // была мировой, он отползал на 3 − 1.2 = 1.8 км/с, а на форсаже (предел
  // втрое выше) оставался за кормой — очередь висела в воздухе.
  //
  // Ход даём на два кадра, а пушку разряжаем руками вместо ожидания
  // перезарядки: за её четверть секунды корабль улетел бы на полкилометра
  // и сдвинул весь дальнейший сценарий. Два кадра лётная модель погасить
  // не успевает, и мерить есть что.
  const top = SHIP.maxSpeed;
  // Где стояли, туда и вернём. Даже сорок метров пролёта сдвигают цель
  // относительно нас, а она приходит снимками: в следующем снимке она
  // «прыгнет», и по прыжку ей припишется скорость, которой у неё нет.
  const was = { x: game.ship.pos.x, y: game.ship.pos.y, z: game.ship.pos.z };
  game.ship.vel.x = f.x * top; game.ship.vel.y = f.y * top; game.ship.vel.z = f.z * top;
  game.ship.speed = top;
  game.guns.cool = 0;
  game.guns.bolts.length = 0;
  mouse('mousedown', { button: 0 });
  frames(2);
  mouse('mouseup', { button: 0 });
  const fb = game.guns.bolts[0];
  if (!fb) throw new Error('на полном ходу не выстрелили вовсе');
  const rel = Math.hypot(
    fb.vx - game.ship.vel.x, fb.vy - game.ship.vel.y, fb.vz - game.ship.vel.z);
  // Допуск щедрый: за два кадра ход чуть меняют и тяга, и тяготение.
  // Ловим не третий знак, а провал почти вдвое — те самые 1.8 км/с.
  if (Math.abs(rel - game.guns.spec.speed) > 0.1) {
    throw new Error('на ходу ' + top + ' км/с болт уходит от корабля со скоростью '
      + rel.toFixed(2) + ' вместо ' + game.guns.spec.speed);
  }
  game.ship.vel.x = game.ship.vel.y = game.ship.vel.z = 0;
  game.ship.speed = 0;
  game.ship.pos.x = was.x; game.ship.pos.y = was.y; game.ship.pos.z = was.z;
  game.guns.bolts.length = 0;
  game.guns.cool = 0;                         // и пушку — готовой, как была

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
  // Уходит пилот 7 и уводит свой корабль 77 (Hub, leave).
  net.left.push({ id: 7, ship: 77 });
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

await step('топливо: расход в полёте, шкала в приборах, резерв, пустой бак, буксир', () => {
  if (game.state.mode !== 'flight') { key('Space'); frames(4); }
  // Уходим в пустоту: тяготение тела добавило бы работу подъёмным, а
  // здесь проверяется, что списано ровно то, что сделали сопла.
  game.ship.pos.x = 0; game.ship.pos.y = 2.4e6; game.ship.pos.z = 0;
  game.ship.vel.x = 0; game.ship.vel.y = 0; game.ship.vel.z = 0;
  game.ship.speed = 0; game.ship.throttle = 0;
  game.ship.fuel = SHIP.fuelCap;
  frames(2);
  const f0 = game.ship.fuel, w0 = { ...game.ship.work };
  holdDown('ShiftLeft'); frames(60); release('ShiftLeft'); frames(30);
  const dw = { main: game.ship.work.main - w0.main, lift: game.ship.work.lift - w0.lift,
    rcs: game.ship.work.rcs - w0.rcs };
  if (!(dw.main > 0.1)) throw new Error('маршевые не набрали скорости: ' + dw.main);
  const want = F.thrustTons(dw.main, dw.lift, dw.rcs);
  if (Math.abs((f0 - game.ship.fuel) - want) > 1e-9) {
    throw new Error('списано ' + (f0 - game.ship.fuel) + ' т вместо ' + want);
  }

  // Шкала в приборах от третьего лица — тоннами.
  const view = game.state.view;
  if (view !== 'chase') { key('KeyV'); frames(1); }
  texts = []; frames(2);
  let shown = texts.map((t) => t.s); texts = null;
  if (!shown.includes('ТОПЛИВО')) throw new Error('в приборах нет шкалы топлива');
  if (!shown.includes(game.ship.fuel.toFixed(1) + ' т')) throw new Error('у шкалы нет тонн');

  // Резерв: о нём говорят один раз, прыжок не начинается, и приборы
  // называют выход — буксир.
  game.state.messages.length = 0;
  game.ship.fuel = SHIP.fuelReserve * 0.9;
  frames(3);
  if (!game.state.messages.some((m) => /РЕЗЕРВ/.test(m.text))) throw new Error('о резерве не сказано');
  const said = game.state.messages.length;
  frames(10);
  if (game.state.messages.length !== said) throw new Error('о резерве твердят каждый кадр');
  texts = []; frames(2);
  shown = texts.map((t) => t.s); texts = null;
  if (!shown.includes('U — АВАРИЙНЫЙ БУКСИР')) throw new Error('приборы не называют буксир');
  game.nav.index = game.nav.list.findIndex((x) => x.name === 'Lave V');
  aimAt(game.nav.list[game.nav.index]);
  key('KeyB'); frames(3);
  if (game.quantum.phase !== 'idle') throw new Error('прыжок начался из резерва');
  if (!game.state.messages.some((m) => /МАЛО ТОПЛИВА/.test(m.text))) {
    throw new Error('отказ прыжка не объяснён');
  }

  // Пусто: сопла молчат — тяга ручкой ничего не меняет.
  game.ship.fuel = 0;
  const v0 = game.ship.speed;
  holdDown('ShiftLeft'); frames(30); release('ShiftLeft');
  if (Math.abs(game.ship.speed - v0) > 1e-9) throw new Error('без топлива корабль разгоняется');
  if (!game.state.messages.some((m) => /КОНЧИЛОСЬ/.test(m.text))) throw new Error('о пустом баке не сказано');

  // Буксир: U — предупреждение, U ещё раз — в порт. Без сервера даром.
  key('KeyU'); frames(2);
  if (game.state.mode !== 'flight') throw new Error('буксир пришёл с первого нажатия');
  key('KeyU'); frames(5);
  if (game.state.mode !== 'docked') throw new Error('буксир не дотянул: режим ' + game.state.mode);
  if (game.ship.fuel !== SHIP.fuelCap) throw new Error('в автономном порту бак не залит: ' + game.ship.fuel);
  key('Space'); frames(5);
  if (game.state.mode !== 'flight') throw new Error('после буксира не вылетели');
  if (view !== game.state.view) { key('KeyV'); frames(1); }
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

await step('экран станции: разделы, клавиши 1–4, автономная заправка, английский', () => {
  if (game.state.mode !== 'docked') throw new Error('режим ' + game.state.mode);
  const html = () => nodes.panel.innerHTML;
  for (const want of ['СТЫКОВКА', '1 ПОРТ', '2 РЫНОК', '3 ВЕРФЬ', '4 ЗАПРАВКА', 'ВЫЛЕТ']) {
    if (html().indexOf(want) < 0) throw new Error('на экране порта нет «' + want + '»');
  }
  if (!nodes.panel.classList.contains('station')) throw new Error('панель без разметки станции');
  if (game.ship.fuel !== SHIP.fuelCap) throw new Error('в автономном порту бак не залит');
  key('Digit2'); frames(1);
  if (!/НЕТ СВЯЗИ С СЕРВЕРОМ/.test(html())) throw new Error('рынок без сервера не сказал, что его нет');
  key('Digit3'); frames(1);
  if (!/Модули ставит верфь/.test(html())) throw new Error('верфь без сервера не объяснилась');
  key('Digit4'); frames(1);
  if (!/class="fuelbar/.test(html()) || !/заправляет даром/.test(html())) {
    throw new Error('раздел заправки не нарисован');
  }
  // Английский: во всех четырёх разделах ни одной русской буквы.
  const CYR = /[А-Яа-яЁё]/;
  try {
    setLang('en');
    for (let i = 1; i <= 4; i++) {
      key('Digit' + i); frames(1);
      const text = html().replace(/<[^>]+>/g, ' ');
      if (CYR.test(text)) {
        throw new Error('в разделе ' + i + ' осталось русское: ' + (text.match(/[^ ]*[А-Яа-яЁё][^ ]*/) || [''])[0]);
      }
    }
  } finally {
    setLang('ru');
  }
  key('Digit1'); frames(1);
  if (!/Планета/.test(html())) throw new Error('раздел порта не вернулся');
  // Справка поверх порта — в своей рамке, а не в широкой станционной.
  key('KeyH'); frames(2);
  key('KeyH'); frames(2);
});

await step('в порту: Y — пройтись по кораблю (экран порта прячется), E у кресла — экран обратно', async () => {
  const { buildCockpit } = await import('../js/models/cockpit.js');
  const saved = game.cockpit;
  try {
    game.cockpit = buildCockpit();
    await game.loadInterior();
    if (game.state.mode !== 'docked') throw new Error('режим ' + game.state.mode);
    if (nodes.panel.innerHTML.indexOf('ПРОЙТИСЬ ПО КОРАБЛЮ') < 0) {
      // Кнопка появляется, когда кабина есть: перерисуем экран с ней.
      key('Digit1'); frames(1);
      if (nodes.panel.innerHTML.indexOf('ПРОЙТИСЬ ПО КОРАБЛЮ') < 0) throw new Error('на экране порта нет кнопки «пройтись»');
    }
    key('KeyY'); frames(70);
    if (!game.walk.on || game.walk.phase !== 'walk') throw new Error('в порту Y не поднял пилота');
    if (!nodes.overlay.classList.contains('hidden')) throw new Error('экран порта остался поверх идущего');
    // Пробел в порту на ногах — прыжок, а не вылет.
    key('Space'); frames(40);
    if (game.state.mode !== 'docked') throw new Error('пробел на ногах увёл корабль из порта');
    key('KeyE'); frames(50);
    if (game.walk.on) throw new Error('E у кресла не посадил пилота');
    if (nodes.overlay.classList.contains('hidden') || nodes.panel.innerHTML.indexOf('СТЫКОВКА') < 0) {
      throw new Error('сев, пилот не увидел экран порта');
    }
  } finally {
    game.cockpit = saved;
    key('Digit1'); frames(1);
  }
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

await step('приборы подхода: в левой колонке, центр свободен', () => {
  const moon = game.world.bodies.find((b) => b.kind === 'moon');
  game.nav.index = game.nav.list.indexOf(moon);
  // Телепорт на малую высоту: там панель показывает и посадочные условия.
  game.teleAlt = 4;                       // 3 км (см. TELEPORT_ALTS)
  key('KeyK'); frames(3);
  if (!game.capture) throw new Error('нет гравитационного захвата у поверхности луны');
  if (game.state.view !== 'chase') { key('KeyV'); frames(2); }
  // Сенсорные кнопки убираем: у них свои подписи («ТЯГА», «ЦЕЛЬ»), и
  // проверка на дубли считала бы их за приборы. Речь здесь про приборы.
  const wasTouch = Q.touchUi;
  Q.touchUi = false;
  frames(2);

  texts = [];
  frames(1);
  const seen = texts;
  texts = null;

  const has = (re) => seen.some((t) => re.test(t.s));
  for (const re of [/ВЫСОТА/, /ВЕРТ/, /БОК/, /ТЯЖЕСТЬ/, /ШАССИ/, /НАКЛОН/, /УКЛОН/]) {
    if (!has(re)) throw new Error('приборы не показывают ' + re);
  }

  // НИЧЕГО НЕ ДУБЛИРУЕТСЯ. Раньше на подходе ход и дистанция переезжали
  // из углов в центр, а углы ужимались: одно и то же число оказывалось
  // то слева внизу, то посреди экрана, и глазу негде было закрепиться.
  // Теперь углы стоят на месте всегда, а центр показывает только то,
  // чего в них нет.
  const count = (re) => seen.filter((t) => re.test(t.s)).length;
  for (const [re, name] of [[/^ТЯГА$/, 'тяга'], [/^ЦЕЛЬ · /, 'заголовок цели'],
    [/^ВЫСОТА$/, 'высота'], [/^ХОД$/, 'ход']]) {
    if (count(re) !== 1) throw new Error(`${name}: ${count(re)} надписей вместо одной`);
  }

  const W = window.innerWidth, H = window.innerHeight;
  const cx = W / 2, cy = H / 2;

  // ВСЁ О КОРАБЛЕ — В ЛЕВОЙ КОЛОНКЕ. Высота, скорости у грунта и тяжесть
  // — это про нас, а не про прицел, и раньше они стояли отдельным
  // прибором посреди кадра. В виде от третьего лица низ середины занимает
  // САМ КОРАБЛЬ, и приборы ложились прямо на корпус.
  const mine = [/^ВЫСОТА$/, /^ВЕРТ$/, /^БОК$/, /^ТЯЖЕСТЬ$/, /^ХОД$/, /^ТЯГА$/, /^КОРПУС$/];
  for (const re of mine) {
    const t = seen.find((x) => re.test(x.s));
    if (!t) continue;
    if (t.x > W * 0.3) {
      throw new Error(`«${t.s}» вне левой колонки: x = ${t.x.toFixed(0)}, окно ${W}x${H}, порог ${(W * 0.3).toFixed(0)}`);
    }
  }

  // Середина кадра СВОБОДНА — и вокруг прицела, и под ним, где корабль.
  // Исключение одно: строка площадки и кнопка взлёта на грунте, но здесь
  // корабль в полёте.
  for (const t of seen) {
    if (Math.abs(t.x - cx) < W * 0.22 && Math.abs(t.y - cy) < H * 0.45) {
      throw new Error(`надпись «${t.s}» посреди кадра: ${(t.x - cx).toFixed(0)}, ${(t.y - cy).toFixed(0)}`);
    }
  }

  // Отметка грунта: кольцо под кораблём и высота рядом с нитью. Это
  // главный признак масштаба у поверхности, и рисуется он только когда
  // земля близко.
  {
    game.teleAlt = 6;                     // 0.05 км
    key('KeyK'); frames(3);
    const l0 = calls.lineTo || 0, d0 = calls.setLineDash || 0;
    frames(1);
    const ring = (calls.lineTo || 0) - l0;
    const dash = (calls.setLineDash || 0) - d0;
    if (dash < 2) throw new Error('нити отметки нет: пунктир не рисовался');
    if (ring < 16) throw new Error('кольцо отметки не нарисовано: ' + ring + ' отрезков');

    game.teleAlt = 0;                     // 2000 км — далеко
    key('KeyK'); frames(3);
    const l1 = calls.lineTo || 0, d1 = calls.setLineDash || 0;
    frames(1);
    if ((calls.setLineDash || 0) - d1 > 0) throw new Error('отметка рисуется и с орбиты');
    if ((calls.lineTo || 0) - l1 > ring - 16) throw new Error('кольцо рисуется и с орбиты');

    // И приборы с орбиты ужимаются сами: вертикальная скорость
    // относительно грунта за две тысячи километров не значит ничего, а
    // место занимает и внимание отнимает.
    texts = [];
    frames(1);
    const far = texts.map((t) => t.s);
    texts = null;
    if (!far.some((t) => /ВЫСОТА/.test(t))) throw new Error('с орбиты пропала и высота');
    if (far.some((t) => /^ВЕРТ$/.test(t))) {
      throw new Error('с орбиты всё ещё показана вертикальная скорость');
    }
  }
  Q.touchUi = wasTouch;
  frames(2);
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
  // Место корабля — отдельно от места пилота (сохранение: ship и me).
  const saved = JSON.parse(savedJson()).ship;
  if (!saved || !saved.landed || !saved.landed.pose || !saved.landed.id) {
    throw new Error('стоянка не сохранена: ' + JSON.stringify(saved && saved.landed));
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
// Одна клавиша на оба прыжка. Раньше их было две — B внутри системы и J
// между системами, — и различие это техническое: игрок хочет «лететь к
// выбранному», а каким приводом, дело корабля. Заодно проверяется то,
// на что была жалоба: выбранная на карте система обязана СТОЯТЬ НА
// ЭКРАНЕ до нажатия, а не появляться после него.
await step('J — одна клавиша прыжка: привод выбирается сам', () => {
  if (game.state.mode === 'docked') { key('Space'); frames(4); }
  if (game.state.view !== 'chase') { key('KeyV'); frames(2); }
  // В пустоту: у грунта коридор перекрыт телом, и привод откажет по делу.
  game.ship.pos.x = 0; game.ship.pos.y = 2.4e6; game.ship.pos.z = 0;
  game.ship.vel.x = 0; game.ship.vel.y = 0; game.ship.vel.z = 0;
  game.ship.speed = 0; game.ship.throttle = 0;
  game.warpTarget = null;
  frames(2);

  const shown = (n = 2) => {
    texts = [];
    frames(n);
    const list = texts.map((t) => t.s);
    texts = null;
    return list;
  };

  // 1. Цель в своей системе — J берёт квантовый привод.
  const star = game.world.bodies.find((b) => b.kind === 'star');
  game.nav.index = game.nav.list.indexOf(star);
  frames(2);
  key('KeyJ'); frames(2);
  if (game.quantum.phase !== 'calib') {
    throw new Error('J не включил квантовый привод: ' + game.quantum.phase);
  }
  // Повторное нажатие отменяет — тем же пальцем, что и включило.
  key('KeyJ'); frames(2);
  if (game.quantum.phase !== 'idle') {
    throw new Error('J не отменил квантовый привод: ' + game.quantum.phase);
  }

  // 2. Цель в другой системе — та же клавиша берёт варп.
  key('KeyM'); frames(2);
  key('KeyG'); frames(2);
  key('ArrowRight'); frames(2);
  const toName = game.warpTarget && game.warpTarget.name;
  if (!toName) throw new Error('на карте галактики не выбралась система');
  // Карту оставляем в том виде, в каком взяли: следующий шаг открывает её
  // заново и ждёт вид системы. Проверка, меняющая обстановку за собой, —
  // это проверка, которая ломает соседнюю, а виноватой выглядит игра.
  key('KeyG'); frames(2);
  key('KeyM'); frames(3);

  // ГЛАВНОЕ: метка стоит ДО нажатия. Пока её не было, J приходилось
  // жать вслепую — и только потом появлялось, куда наводиться.
  //
  // Сообщения гасим намеренно: выбор на карте сам печатает «ЦЕЛЬ ВАРПА:
  // …» строкой в углу, и на ней проверка зеленела, даже когда метки не
  // было вовсе (проверено сломом). Ищем ровно ту подпись, которую рисует
  // сама метка, и имя системы рядом с кольцом.
  game.state.messages.length = 0;
  const before = shown();
  if (!before.some((t) => t === 'ЦЕЛЬ ВАРПА · J — ПРЫЖОК')) {
    throw new Error('метки цели варпа на экране нет: ' + before.join(' | '));
  }
  const nameAt = before.filter((t) => t === toName.toUpperCase()).length;
  if (nameAt < 1) {
    throw new Error('у метки не написано, куда она ведёт: ' + before.join(' | '));
  }
  if (game.warp.phase !== 'idle') throw new Error('привод запустился сам собой');

  key('KeyJ'); frames(2);
  if (game.warp.phase !== 'align') throw new Error('J не включил варп: ' + game.warp.phase);
  // И отменяется тем же.
  key('KeyJ'); frames(2);
  if (game.warp.phase !== 'idle') throw new Error('J не отменил варп: ' + game.warp.phase);
  // Цель варпа за собой НЕ убираем: следующий шаг открывает карту заново
  // и ждёт, что выбор на ней уже есть. Обнулить её здесь значило бы
  // подчистить не за собой, а за игрой.
  frames(2);
});

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

  game.ship.fuel = SHIP.fuelCap;
  const fromName = game.sys.name;
  const fromSys = game.sys;
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
  // Прыжок стоит топлива по расстоянию между звёздами — и почти только
  // его: на центровке двигатели почти не работали.
  const warpCost = F.warpTons(systemDistance(fromSys, game.sys));
  const warpBurnt = SHIP.fuelCap - game.ship.fuel;
  if (!(warpBurnt >= warpCost - 1e-9 && warpBurnt < warpCost + 0.3)) {
    throw new Error('варп стоил ' + warpBurnt.toFixed(2) + ' т, а по расстоянию — ' + warpCost.toFixed(2));
  }
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

// Крупные приборы обязаны помещаться в кадр.
//
// Приборы растут вместе с экраном, и это ровно тот случай, когда легко
// сделать хуже: на 2556 точках панели стали в полтора раза больше, и
// если бы они лезли за край или друг на друга, жалоба «непонятный
// интерфейс» сменилась бы на «обрезанный». Мок холста следит за
// преобразованием (см. onScreen), поэтому угловые панели здесь видно в
// экранных координатах, а не в своих.
await step('крупные приборы помещаются в кадр', () => {
  const wasW = window.innerWidth, wasH = window.innerHeight, wasK = Q.hudScale;
  // Сенсорные кнопки в этой проверке ни при чём: речь про большой
  // монитор с мышью, где их не рисуют вовсе. У них своя раскладка и свои
  // размеры (js/ui/touch.js), и мерить их заодно значит мерить не то.
  const wasTouch = Q.touchUi;
  const resize = (w, h) => {
    window.innerWidth = w; window.innerHeight = h;
    for (const fn of winListeners.resize || []) fn();
    frames(3);
  };
  try {
    if (game.state.mode !== 'flight') { key('Space'); frames(4); }
    if (game.state.view !== 'chase') { key('KeyV'); frames(2); }
    game.state.messages.length = 0;
    Q.touchUi = false;
    resize(2556, 1305);
    Q.hudScale = 1.45;                    // столько даёт этот экран
    frames(3);

    texts = [];
    frames(1);
    const seen = texts;
    texts = null;

    const W = window.innerWidth, H = window.innerHeight;
    for (const t of seen) {
      if (t.x < -4 || t.x > W + 4 || t.y < 0 || t.y > H + 4) {
        throw new Error(`надпись «${t.s}» вне кадра: ${t.x.toFixed(0)}, ${t.y.toFixed(0)}`);
      }
      // Левые надписи ещё и не должны выходить за правый край длиной.
      if (t.align === 'left' && t.x + t.s.length * t.size * 0.55 > W + 4) {
        throw new Error(`надпись «${t.s}» не влезла по ширине`);
      }
    }

    // Приборы ВЫРОСЛИ: на этом экране самая мелкая подпись обязана быть
    // крупнее прежних девяти пикселей, иначе вся затея впустую.
    const sizes = seen.map((t) => t.size).filter((v) => v > 0);
    const min = Math.min(...sizes);
    if (!(min >= 13)) {
      const worst = seen.filter((t) => t.size === min).map((t) => t.s).slice(0, 3);
      throw new Error(`на большом экране осталась мелочь ${min.toFixed(1)} px: ` + worst.join(' | '));
    }

    // Левая панель и сканер не наезжают друг на друга: сканер стоит по
    // центру низа, панель прижата к левому краю.
    const left = seen.filter((t) => t.x < W * 0.33 && t.y > H * 0.75);
    const mid = seen.filter((t) => Math.abs(t.x - W / 2) < W * 0.1 && t.y > H * 0.75);
    if (!left.length) throw new Error('левой панели в углу нет');
    if (!mid.length) throw new Error('сканера внизу нет');
    const rightmost = Math.max(...left.map((t) => t.x + t.s.length * t.size * 0.55));
    const leftmost = Math.min(...mid.map((t) => t.x - t.s.length * t.size * 0.3));
    if (rightmost > leftmost) {
      throw new Error(`панель тяги наехала на сканер: ${rightmost.toFixed(0)} > ${leftmost.toFixed(0)}`);
    }
  } finally {
    Q.hudScale = wasK;
    Q.touchUi = wasTouch;
    resize(wasW, wasH);
  }
});


await step('город: цель по Tab и посадка на площадку', () => {
  // Шаг идёт последним, и в каком состоянии его застанут предыдущие,
  // заранее не известно: возвращаем корабль в полёт сами.
  if (game.state.mode === 'crashed') { key('Space'); frames(10); }
  if (game.state.mode === 'docked') { key('Space'); frames(90); }
  const city = game.world.cities[0];
  if (!city) throw new Error('в родной системе нет города');
  const pad = city.plan.pads[1];
  const u = city.basis.up, r = city.basis.right, f = city.basis.fwd;
  // Точка над второй площадкой. Высоту берём небольшую: спуск с орбиты
  // проверяет соседний шаг (луна), а здесь проверяется город.
  const at = {
    x: city.pos.x + r.x * pad.x + f.x * pad.z,
    y: city.pos.y + r.y * pad.x + f.y * pad.z,
    z: city.pos.z + r.z * pad.x + f.z * pad.z,
  };
  const alt = 2;
  game.ship.pos.x = at.x + u.x * alt;
  game.ship.pos.y = at.y + u.y * alt;
  game.ship.pos.z = at.z + u.z * alt;
  game.ship.vel.x = 0; game.ship.vel.y = 0; game.ship.vel.z = 0;
  game.ship.speed = 0;
  game.ship.throttle = 0;
  // Нос вниз, на город.
  const b = game.ship.basis;
  b.fwd = { x: -u.x, y: -u.y, z: -u.z };
  b.right = { x: r.x, y: r.y, z: r.z };
  b.up = {
    x: b.fwd.y * b.right.z - b.fwd.z * b.right.y,
    y: b.fwd.z * b.right.x - b.fwd.x * b.right.z,
    z: b.fwd.x * b.right.y - b.fwd.y * b.right.x,
  };
  frames(4);

  // Город выбирается тем же Tab, что и всё остальное. Под прицелом
  // сейчас и планета, и город: планета сортируется первой (её край
  // накрывает прицел со всех сторон), поэтому до города доходят вторым
  // нажатием — ровно так эта механика и задумана.
  let picked = null;
  for (let i = 0; i < 4 && picked !== city; i++) {
    key('Tab');
    frames(2);
    picked = game.nav.list[game.nav.index];
  }
  if (picked !== city) {
    throw new Error('город не выбирается прицелом: ' + (picked && picked.name));
  }

  // Посадочный компьютер по городу означает «на его тело»: садятся не в
  // город, а на грунт под собой, и вывести корабль НАД городом — работа
  // квантового привода.
  key('KeyL');
  frames(30);
  if (!game.ship.landing) throw new Error('посадочный компьютер не включился в городе');
  if (game.ship.landing.body !== city.body) {
    throw new Error('компьютер взял не то тело: ' + game.ship.landing.body.name);
  }
  for (let i = 0; i < 400 && game.state.mode === 'flight'; i++) frames(60);
  if (game.state.mode !== 'landed') {
    throw new Error('режим ' + game.state.mode + ', причина: ' + game.crashReason);
  }
  // Сел именно на площадку, а не рядом с городом. Переводим место
  // посадки в оси города теми же векторами, которыми город поставлен.
  {
    const p = game.ship.pos;
    const dx = p.x - city.pos.x, dy = p.y - city.pos.y, dz = p.z - city.pos.z;
    const lx = dx * city.basis.right.x + dy * city.basis.right.y + dz * city.basis.right.z;
    const lz = dx * city.basis.fwd.x + dy * city.basis.fwd.y + dz * city.basis.fwd.z;
    const off = Math.hypot(lx - pad.x, lz - pad.z);
    if (off > pad.r) {
      throw new Error('сел мимо площадки: ' + (off * 1000).toFixed(0) + ' м от середины');
    }
  }
  // И об этом сказано в кадре: «посадка выполнена: <город>, площадка N».
  texts = [];
  frames(1);
  const seen = texts;
  texts = null;
  if (!seen.some((t) => new RegExp(city.name).test(t.s))) {
    throw new Error('в кадре не сказано, что сели в городе');
  }

  // Постройки твёрдые: взлетаем и въезжаем в ближайшую башню. Это и есть
  // разница между городом и картинкой города.
  key('KeyG'); frames(30);                       // шасси убрать
  const tall = city.plan.boxes.reduce((a, x) => (x.h > a.h ? x : a), city.plan.boxes[0]);
  game.ship.landedAt = null;
  game.ship.secured = false;
  game.state.mode = 'flight';
  game.ship.pos.x = city.pos.x + r.x * tall.x + u.x * tall.h * 0.5 + f.x * tall.z;
  game.ship.pos.y = city.pos.y + r.y * tall.x + u.y * tall.h * 0.5 + f.y * tall.z;
  game.ship.pos.z = city.pos.z + r.z * tall.x + u.z * tall.h * 0.5 + f.z * tall.z;
  game.ship.vel.x = 0; game.ship.vel.y = 0; game.ship.vel.z = 0;
  frames(4);
  if (game.state.mode !== 'crashed') {
    throw new Error('в башне корабль цел: режим ' + game.state.mode);
  }
  if (!/постройк/i.test(game.crashReason || '')) {
    throw new Error('причина крушения не про постройку: ' + game.crashReason);
  }
  key('Space'); frames(10);          // вернуться в игру
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
