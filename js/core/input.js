// Состояние клавиатуры + edge-детект нажатий за один кадр.

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
  }

  attach(target = window) {
    target.addEventListener('keydown', (e) => {
      if (BLOCK.has(e.code)) e.preventDefault();
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
      this.mouse.wheel += e.deltaY || 0;
      // Страница здесь одна и целиком занята игрой, прокручивать нечего.
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

  endFrame() { this.pressedThisFrame.clear(); this.mouse.clicked = false; }
  releaseAll() { this.down.clear(); this.pressedThisFrame.clear(); }
}

export const input = new Input();
