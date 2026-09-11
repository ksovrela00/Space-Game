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
