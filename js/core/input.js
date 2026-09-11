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
    // Мышь нужна только для осмотра из-за спины: правая кнопка зажата —
    // копим сдвиг курсора, камера его разбирает раз в кадр.
    this.mouse = { right: false, dx: 0, dy: 0 };
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
    });
    win.addEventListener('mouseup', (e) => { if (e.button === 2) this.mouse.right = false; });
    win.addEventListener('mousemove', (e) => {
      if (!this.mouse.right) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    // Потеря фокуса не должна оставлять кнопку «зажатой».
    win.addEventListener('blur', () => { this.mouse.right = false; });
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

  endFrame() { this.pressedThisFrame.clear(); }
  releaseAll() { this.down.clear(); this.pressedThisFrame.clear(); }
}

export const input = new Input();
