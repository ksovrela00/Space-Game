// Состояние клавиатуры + edge-детект нажатий за один кадр.

/**
 * Прокручиваемая панель под курсором (или под фокусом клавиатуры).
 *
 * ТО, ЧТО БЫЛО СЛОМАНО: игра гасила колесо и клавиши прокрутки на всей
 * странице — «страница одна и целиком занята игрой, прокручивать
 * нечего». Верно это было ровно до того, как экраны выросли: справка
 * (H) — три экрана текста, и домотать её было нечем ни колесом, ни
 * PageDown. Панель при этом честно прокручивалась (overflow-y: auto) —
 * браузеру просто не давали этого сделать.
 *
 * Правило теперь такое: колесо принадлежит тому, что под курсором. Над
 * ДЛИННОЙ панелью его отдаём браузеру целиком — игра не берёт его даже
 * в свой счётчик, иначе карта под экраном заодно меняла бы масштаб.
 * Над сценой и над короткой панелью (прокручивать нечего) всё как
 * было: колесо игре, прокрутка страницы отменена.
 */
const scrollPanel = (el) => {
  const p = el && el.closest ? el.closest('.panel') : null;
  return p && p.scrollHeight > p.clientHeight + 1 ? p : null;
};

const BLOCK = new Set([
  'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Backquote', 'Slash',
]);

class Input {
  constructor() {
    this.down = new Set();
    this.pressedThisFrame = new Set();
    this.enabled = true;
    // Мышь: правая кнопка — осмотр из-за спины (копим сдвиг курсора,
    // камера разбирает его раз в кадр), левая и колесо — карта системы
    // (выбор объекта, перетаскивание, масштаб). В полёте левая кнопка и
    // колесо не делают ничего, поэтому и перехватывать их незачем.
    this.mouse = {
      right: false, dx: 0, dy: 0,
      left: false, x: 0, y: 0, pdx: 0, pdy: 0, wheel: 0, clicked: false,
    };
    // Аналоговые оси с сенсорных органов (js/ui/touch.js). Клавиша даёт
    // только -1, 0 и +1, а джойстик — всё между ними, и терять это
    // нельзя: на телефоне иначе нечем вести корабль плавно.
    this.pad = { pitch: 0, yaw: 0, roll: 0, thr: 0, lift: 0, on: false };
    // Клавиши, «нажатые» сенсорными кнопками. Держим их в том же
    // наборе, что и настоящие: тогда всё управление игрой — выбор цели,
    // прыжок, шасси, вид — работает от касаний БЕЗ единой правки в
    // игровой логике.
    this.virtual = new Set();
    // Какие из них ДЕРЖАТ прямо сейчас: без этого «нажато в этом кадре»
    // срабатывало бы каждый кадр удержания, и одно касание кнопки
    // шасси выпускало бы и убирало их без остановки.
    this.held = new Set();
  }

  /** Сенсорная кнопка нажата и отпущена в этом кадре. */
  tap(code) {
    this.down.add(code);
    this.pressedThisFrame.add(code);
    this.virtual.add(code);
  }

  /** Сенсорная кнопка на удержании. */
  hold(code, on) {
    if (on) {
      if (!this.held.has(code)) this.pressedThisFrame.add(code);
      this.held.add(code);
      this.down.add(code);
      this.virtual.add(code);
    } else if (this.held.has(code)) {
      // Отпускаем ТОЛЬКО то, что держали сами. Без этой оговорки
      // сенсорный слой каждый кадр гасил бы настоящие клавиши: он
      // проходит по всем своим кнопкам и «отпускает» ненажатые, а
      // Space, Q/E и R/F есть и на клавиатуре — форсаж, крен и
      // подъёмные движки переставали работать с неё вовсе.
      this.held.delete(code);
      this.down.delete(code);
      this.virtual.delete(code);
    }
  }

  attach(target = window) {
    target.addEventListener('keydown', (e) => {
      // Пробел и стрелки отменяем, чтобы страница не ёрзала под игрой.
      // Но если в фокусе длинный экран — ими его и прокручивают.
      if (BLOCK.has(e.code) && !scrollPanel(e.target)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressedThisFrame.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    // Потеря фокуса не должна оставлять «залипшую» тягу или крен.
    target.addEventListener('blur', () => this.down.clear());
  }

  /**
   * Правая кнопка — осмотр камерой. Меню по правому щелчку отключается:
   * иначе оно выскакивает поверх игры при первом же движении.
   *
   * Слушаем ОКНО, а не канвас. Канвас приборов сквозной по событиям
   * (`#hud { pointer-events: none }`), канвас сцены под ним, а сверху
   * ещё DOM-оверлеи экранов — на любом из слоёв нажатие можно потерять,
   * и потерянным оно и было. У окна такой проблемы нет по определению.
   */
  attachMouse(win = window) {
    win.addEventListener('contextmenu', (e) => { if (e.preventDefault) e.preventDefault(); });
    win.addEventListener('mousedown', (e) => {
      if (e.button === 2) { this.mouse.right = true; if (e.preventDefault) e.preventDefault(); }
      if (e.button === 0) { this.mouse.left = true; this.mouse.clicked = true; }
      this.setPos(e);
    });
    win.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.mouse.right = false;
      if (e.button === 0) this.mouse.left = false;
    });
    win.addEventListener('mousemove', (e) => {
      this.setPos(e);
      // Тянуть карту можно только левой, вертеть камеру — только правой.
      if (this.mouse.left) {
        this.mouse.pdx += e.movementX || 0;
        this.mouse.pdy += e.movementY || 0;
      }
      if (!this.mouse.right) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    // Колесо копится до конца кадра: за кадр приходит несколько щелчков,
    // и разбирать их по одному значит дёргать масштаб рывками.
    win.addEventListener('wheel', (e) => {
      // Длинный экран поверх игры прокручивают колесом — см. scrollPanel.
      if (scrollPanel(e.target)) return;
      this.mouse.wheel += e.deltaY || 0;
      // Под сценой прокручивать нечего: страница занята игрой целиком.
      if (e.preventDefault && e.cancelable) e.preventDefault();
    }, { passive: false });
    // Потеря фокуса не должна оставлять кнопку «зажатой».
    win.addEventListener('blur', () => { this.mouse.right = false; this.mouse.left = false; });
  }

  setPos(e) {
    if (typeof e.clientX === 'number') { this.mouse.x = e.clientX; this.mouse.y = e.clientY; }
  }

  /** Забрать накопленный поворот колеса и обнулить его. */
  takeWheel() {
    const v = this.mouse.wheel;
    this.mouse.wheel = 0;
    return v;
  }

  /** Забрать сдвиг при перетаскивании левой кнопкой и обнулить его. */
  takePan(out = { x: 0, y: 0 }) {
    out.x = this.mouse.pdx; out.y = this.mouse.pdy;
    this.mouse.pdx = 0; this.mouse.pdy = 0;
    return out;
  }

  /** Забрать накопленный сдвиг мыши и обнулить его. */
  takeDrag(out = { x: 0, y: 0 }) {
    out.x = this.mouse.dx; out.y = this.mouse.dy;
    this.mouse.dx = 0; this.mouse.dy = 0;
    return out;
  }

  isDown(...codes) {
    if (!this.enabled) return false;
    return codes.some((c) => this.down.has(c));
  }

  // Нажатия читаем всегда: ими управляются меню, даже когда полёт заблокирован.
  pressed(...codes) {
    return codes.some((c) => this.pressedThisFrame.has(c));
  }

  // Ось из двух наборов клавиш: -1 / 0 / +1
  axis(negCodes, posCodes) {
    return (this.isDown(...posCodes) ? 1 : 0) - (this.isDown(...negCodes) ? 1 : 0);
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.mouse.clicked = false;
    // Короткое нажатие сенсорной кнопки живёт ровно кадр: удержание
    // ставится заново каждый кадр (js/ui/touch.js).
    for (const code of this.virtual) this.down.delete(code);
    this.virtual.clear();
  }
  releaseAll() {
    this.down.clear(); this.pressedThisFrame.clear();
    this.virtual.clear(); this.held.clear();
    const p = this.pad;
    p.pitch = 0; p.yaw = 0; p.roll = 0; p.thr = 0; p.lift = 0;
  }
}

export const input = new Input();
