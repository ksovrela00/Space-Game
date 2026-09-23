// Сенсорное управление: джойстик, ручка тяги и кнопки.
//
// Расчёт на телефон в горизонте — iPhone 14 Pro даёт 852 × 393 точки
// CSS, и это диктует всю раскладку:
//
//   * органы стоят ПО КРАЯМ, под большими пальцами, и не лезут в
//     середину: там прицел, а на 393 точках высоты середина — это всё,
//     что есть;
//   * джойстик ведёт НОС (тангаж и рыскание), а не крен: на сенсоре
//     важно, чтобы палец двигал то, что видно, — куда тянешь, туда и
//     смотрит корабль. Крен вынесен на пару кнопок: им пользуются
//     реже, и он требует не плавности, а удержания;
//   * тяга — вертикальный ползунок с АБСОЛЮТНЫМ положением. Пальцем
//     нельзя «подержать Shift»: палец либо на экране, либо нет.
//     Поэтому ползунок задаёт саму тягу, а не её изменение;
//   * вырезы экрана обходятся через safe-area: у 14 Pro в горизонте
//     остров занимает 59 точек с одной стороны, и кнопка под ним
//     просто не нажимается.
//
// Кнопки не делают ничего своего: они НАЖИМАЮТ ТЕ ЖЕ КЛАВИШИ
// (js/core/input.js, tap/hold). Поэтому выбор цели, прыжок, шасси и
// смена вида работают от касаний без единой правки в игровой логике —
// и остаются ровно теми же действиями, что с клавиатуры.

import { clamp } from '../core/vec3.js';
import { input } from '../core/input.js';
import { CY, CY_DIM, AMBER, GREEN } from './theme.js';
import { L } from '../core/lang.js';

const TAU = Math.PI * 2;

export const TOUCH = {
  stickR: 62,          // радиус поля джойстика
  knobR: 26,
  dead: 0.12,          // мёртвая зона: палец никогда не стоит ровно в центре
  btnR: 25,            // радиус круглой кнопки
  thrW: 34, thrH: 150, // ползунок тяги
  pad: 18,             // отступ от края экрана
};

/**
 * Раскладка органов под размер экрана и вырезы.
 *
 * Чистая функция: по ней же её и проверяют — ничего не должно вылезать
 * за экран и залезать под вырез.
 */
export function touchLayout(w, h, insets = { left: 0, right: 0, bottom: 0, top: 0 }) {
  const padL = insets.left || 0, R = insets.right || 0, B = insets.bottom || 0;
  const pad = TOUCH.pad;
  const stick = {
    x: padL + pad + TOUCH.stickR,
    y: h - B - pad - TOUCH.stickR,
    r: TOUCH.stickR,
  };
  const thr = {
    x: w - R - pad - TOUCH.thrW / 2,
    y: h - B - pad - TOUCH.thrH / 2,
    w: TOUCH.thrW, h: TOUCH.thrH,
  };
  // Кнопки: два ряда слева от ползунка тяги, в досягаемости большого
  // пальца правой руки.
  const bx = thr.x - TOUCH.thrW / 2 - pad - TOUCH.btnR;
  const by = h - B - pad - TOUCH.btnR;
  const step = TOUCH.btnR * 2 + 12;
  const btn = (x, y, id, label, code, hold = false) =>
    ({ x, y, r: TOUCH.btnR, id, label, code, hold });
  const buttons = [
    btn(bx, by, 'boost', 'ФОРС', 'Space', true),
    btn(bx - step, by, 'rollL', '↺', 'KeyQ', true),
    btn(bx - step * 2, by, 'rollR', '↻', 'KeyE', true),
    btn(bx, by - step, 'gear', 'ШАС', 'KeyG'),
    btn(bx - step, by - step, 'target', 'ЦЕЛЬ', 'Tab'),
    btn(bx - step * 2, by - step, 'jump', 'ПРЫЖ', 'KeyB'),
    // Верхний ряд — то, что нажимают редко: вид, карта, посадка.
    btn(w - R - pad - TOUCH.btnR, insets.top + pad + TOUCH.btnR, 'view', 'ВИД', 'KeyV'),
    btn(w - R - pad - TOUCH.btnR - step, insets.top + pad + TOUCH.btnR, 'map', 'КАРТА', 'KeyM'),
    btn(w - R - pad - TOUCH.btnR - step * 2, insets.top + pad + TOUCH.btnR, 'land', 'ПОСАД', 'KeyL'),
  ];
  // Подъёмные движки: пара кнопок над джойстиком — ими держат высоту
  // на посадке, и нужны они именно вместе с ним, левой рукой.
  const liftX = stick.x + TOUCH.stickR + pad + TOUCH.btnR;
  buttons.push(btn(liftX, by, 'liftDn', '▼', 'KeyF', true));
  buttons.push(btn(liftX, by - step, 'liftUp', '▲', 'KeyR', true));
  return { stick, thr, buttons, w, h };
}

export const makeTouch = () => ({
  on: false,                    // было ли хоть одно касание: до него органы не рисуем
  stick: { id: null, dx: 0, dy: 0 },
  thr: { id: null, frac: 0 },
  look: { id: null, x: 0, y: 0, dx: 0, dy: 0 },
  press: new Map(),             // id касания -> id кнопки
  taps: new Set(),              // кнопки, нажатые в этом кадре
  layout: null,
});

const hitCircle = (p, c) => Math.hypot(p.x - c.x, p.y - c.y) <= c.r * 1.25;
const hitRect = (p, r) =>
  Math.abs(p.x - r.x) <= r.w * 1.6 && Math.abs(p.y - r.y) <= r.h / 2 + 24;

/**
 * Разобрать касания за кадр.
 *
 * @param t      состояние (makeTouch)
 * @param points активные касания [{id, x, y}] в точках CSS
 * @param layout раскладка (touchLayout)
 */
export function touchUpdate(t, points, layout) {
  t.layout = layout;
  if (points.length) t.on = true;
  const live = new Set(points.map((p) => p.id));

  // Отпущенное — отпускаем.
  if (t.stick.id !== null && !live.has(t.stick.id)) { t.stick.id = null; t.stick.dx = 0; t.stick.dy = 0; }
  if (t.thr.id !== null && !live.has(t.thr.id)) t.thr.id = null;
  if (t.look.id !== null && !live.has(t.look.id)) t.look.id = null;
  for (const id of [...t.press.keys()]) if (!live.has(id)) t.press.delete(id);

  for (const p of points) {
    // Уже занятое касание продолжает своё дело — палец не должен
    // «перескакивать» на соседний орган, когда его ведут.
    if (t.stick.id === p.id) {
      const dx = (p.x - layout.stick.x) / layout.stick.r;
      const dy = (p.y - layout.stick.y) / layout.stick.r;
      const len = Math.hypot(dx, dy) || 1;
      const k = len > 1 ? 1 / len : 1;
      t.stick.dx = dx * k; t.stick.dy = dy * k;
      continue;
    }
    if (t.thr.id === p.id) {
      const top = layout.thr.y - layout.thr.h / 2;
      t.thr.frac = clamp(1 - (p.y - top) / layout.thr.h, 0, 1);
      continue;
    }
    if (t.look.id === p.id) {
      t.look.dx += p.x - t.look.x; t.look.dy += p.y - t.look.y;
      t.look.x = p.x; t.look.y = p.y;
      continue;
    }
    if (t.press.has(p.id)) continue;

    // Новое касание: чей это орган.
    if (hitCircle(p, layout.stick)) { t.stick.id = p.id; continue; }
    if (hitRect(p, layout.thr)) {
      t.thr.id = p.id;
      const top = layout.thr.y - layout.thr.h / 2;
      t.thr.frac = clamp(1 - (p.y - top) / layout.thr.h, 0, 1);
      continue;
    }
    let hit = null;
    for (const b of layout.buttons) if (hitCircle(p, b)) { hit = b; break; }
    if (hit) {
      t.press.set(p.id, hit.id);
      // Короткое нажатие засчитывается в момент КАСАНИЯ, а не отпускания:
      // на сенсоре отклик по отпусканию читается как задержка.
      if (!hit.hold) t.taps.add(hit.id);
      continue;
    }
    // Ни во что не попали — значит ведут камеру.
    if (t.look.id === null) { t.look.id = p.id; t.look.x = p.x; t.look.y = p.y; }
  }
  return t;
}

/**
 * Переложить состояние касаний в управление.
 *
 * Оси идут в input.pad, кнопки — В ТЕ ЖЕ КЛАВИШИ, что и с клавиатуры.
 * Вызывается каждый кадр: удержание кнопки живёт ровно один кадр и
 * ставится заново (js/core/input.js, endFrame).
 */
export function touchApply(t, ship) {
  const pad = input.pad;
  const dead = TOUCH.dead;
  const axis = (v) => (Math.abs(v) < dead ? 0 : (v - Math.sign(v) * dead) / (1 - dead));
  pad.on = t.on;
  // Вверх по экрану — нос вверх. На экране y растёт вниз, а «нос вверх»
  // в управлении это отрицательный тангаж (клавиша W), поэтому знак
  // берётся как есть.
  pad.pitch = axis(t.stick.dy);
  pad.yaw = axis(t.stick.dx);
  pad.roll = 0;
  pad.lift = 0;
  // Ползунок задаёт саму тягу, а не её приращение: пальцем «подержать»
  // клавишу нельзя.
  if (t.thr.id !== null && ship) ship.throttle = t.thr.frac;
  pad.thr = 0;

  if (!t.layout) return t;
  const held = new Set([...t.press.values()]);
  for (const b of t.layout.buttons) {
    if (b.hold) input.hold(b.code, held.has(b.id));
    else if (t.taps.has(b.id)) input.tap(b.code);
  }
  t.taps.clear();
  return t;
}

/** Забрать накопленный сдвиг пальца для осмотра камерой. */
export function touchDrag(t, out = { x: 0, y: 0 }) {
  out.x = t.look.dx; out.y = t.look.dy;
  t.look.dx = 0; t.look.dy = 0;
  return out;
}

// --- отрисовка ---------------------------------------------------------------

const ring = (ctx, x, y, r, color, width = 1.5) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
};

/**
 * Нарисовать органы.
 *
 * Полупрозрачные и тонкие намеренно: на 393 точках высоты каждый лишний
 * пиксель отнимается у кадра, ради которого игра и запущена.
 */
export function touchDraw(ctx, t, layout, game) {
  if (!layout) return;
  const ship = game.ship;
  ctx.save();
  ctx.globalAlpha = t.on ? 0.85 : 0.5;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Джойстик: поле, мёртвая зона и головка.
  const s = layout.stick;
  ring(ctx, s.x, s.y, s.r, CY_DIM);
  ring(ctx, s.x, s.y, s.r * TOUCH.dead, CY_DIM, 1);
  const kx = s.x + t.stick.dx * (s.r - TOUCH.knobR);
  const ky = s.y + t.stick.dy * (s.r - TOUCH.knobR);
  ctx.fillStyle = t.stick.id !== null ? 'rgba(79,179,224,0.35)' : 'rgba(79,179,224,0.16)';
  ctx.beginPath(); ctx.arc(kx, ky, TOUCH.knobR, 0, TAU); ctx.fill();
  ring(ctx, kx, ky, TOUCH.knobR, CY);

  // Ползунок тяги: заливка снизу — это и есть тяга.
  const r = layout.thr;
  const top = r.y - r.h / 2;
  const frac = clamp(ship ? ship.throttle : 0, 0, 1);
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(r.x - r.w / 2, top, r.w, r.h);
  ctx.fillStyle = 'rgba(79,179,224,0.3)';
  ctx.fillRect(r.x - r.w / 2 + 2, top + r.h * (1 - frac) + 2, r.w - 4, r.h * frac - 4);
  ctx.fillStyle = CY;
  ctx.font = '10px Consolas, monospace';
  ctx.fillText(L('ТЯГА'), r.x, top - 10);

  // Кнопки.
  ctx.font = '10px Consolas, monospace';
  const held = new Set([...t.press.values()]);
  for (const b of layout.buttons) {
    const on = held.has(b.id);
    const lit = on || (b.id === 'gear' && ship && ship.gear.out)
      || (b.id === 'boost' && ship && ship.boosting);
    ctx.fillStyle = lit ? 'rgba(255,204,102,0.28)' : 'rgba(6,20,34,0.5)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ring(ctx, b.x, b.y, b.r, lit ? AMBER : CY_DIM);
    ctx.fillStyle = lit ? AMBER : CY;
    // Раскладка считается один раз, а язык можно сменить на ходу —
    // поэтому подпись переводится ЗДЕСЬ, при отрисовке.
    ctx.fillText(L(b.label), b.x, b.y + 0.5);
  }

  ctx.restore();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

/** Кнопка полного экрана в углу: рисуется только там, где он возможен. */
export function fullscreenButton(w, insets = { right: 0, top: 0 }) {
  const r = 18;
  return { x: w - (insets.right || 0) - 14 - r, y: (insets.top || 0) + 14 + r, r };
}

export function drawFullscreenButton(ctx, box, active) {
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = active ? GREEN : CY_DIM;
  ctx.lineWidth = 1.5;
  const { x, y } = box;
  const a = 7;
  ctx.beginPath();
  // Четыре уголка — знак «во весь экран».
  ctx.moveTo(x - a, y - a + 5); ctx.lineTo(x - a, y - a); ctx.lineTo(x - a + 5, y - a);
  ctx.moveTo(x + a, y - a + 5); ctx.lineTo(x + a, y - a); ctx.lineTo(x + a - 5, y - a);
  ctx.moveTo(x - a, y + a - 5); ctx.lineTo(x - a, y + a); ctx.lineTo(x - a + 5, y + a);
  ctx.moveTo(x + a, y + a - 5); ctx.lineTo(x + a, y + a); ctx.lineTo(x + a - 5, y + a);
  ctx.stroke();
  ctx.restore();
}
