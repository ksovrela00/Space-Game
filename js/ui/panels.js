// Софт на экранах кабины.
//
// Зачем отдельный модуль, а не те же угловые панели. От третьего лица
// приборы — это надписи поверх кадра: у них нет ни рамки, ни фона,
// потому что фон там — сам космос. В кабине они лежат НА МОНИТОРЕ, и
// тогда надписей мало: монитор — это корпус, заголовок, сетка подложки,
// рамка и вёрстка под свой размер. Положить на экран угловую панель —
// это наклеить бумажку на приборную доску, что и было в первом заходе.
//
// Рисуется всё в СВОИХ пикселях, от левого верхнего угла экрана: куда
// этот прямоугольник ляжет в кадре, решает js/ui/hud.js (onPanel), а
// размер бухты приходит из геометрии кабины (js/models/cockpit.js).
// Поэтому здесь можно верстать как на обычном экране — и не думать ни о
// перспективе, ни о повороте головы.

import { clamp } from '../core/vec3.js';
import { CY, CY_DIM, AMBER, GREEN, RED, INK } from './theme.js';
import { SHIP } from '../game/ship.js';
import { fmtDist, fmtSpeed, fmtTime } from './hud.js';
import { targetLabel } from '../game/nav.js';
import { gearLabel } from '../game/landing.js';

const TAU = Math.PI * 2;
const MONO = 'Consolas, monospace';

/**
 * Корпус монитора: подложка, сетка, заголовок, рамка и уголки.
 *
 * Сетка — не украшение: на ровной заливке глаз не видит ни границ
 * экрана, ни его наклона, и монитор читается как пятно краски. По сетке
 * же сразу видно и то, и другое, потому что она едет вместе с
 * перспективой.
 *
 * @returns {{x, y, w, h}} рабочее поле под заголовком
 */
export function chrome(ctx, w, h, title, tone = CY) {
  const head = Math.max(16, Math.round(h * 0.13));
  ctx.fillStyle = 'rgba(5,17,28,0.94)';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(79,179,224,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 16; x < w; x += 16) { ctx.moveTo(x, head); ctx.lineTo(x, h); }
  for (let y = head + 16; y < h; y += 16) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();

  ctx.fillStyle = 'rgba(28,86,130,0.62)';
  ctx.fillRect(0, 0, w, head);
  ctx.fillStyle = tone;
  ctx.font = `${Math.round(head * 0.62)}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText(title, 8, head * 0.74);
  // Метки в правом углу заголовка: строка состояния любого прибора.
  ctx.fillStyle = 'rgba(207,233,255,0.5)';
  for (let i = 0; i < 3; i++) ctx.fillRect(w - 10 - i * 7, head * 0.35, 4, 4);

  ctx.strokeStyle = CY_DIM;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  return { x: 8, y: head + 8, w: w - 16, h: h - head - 16 };
}

/** Шкала с делениями: у прибора она обязана быть, у надписи — нет. */
export function gauge(ctx, x, y, w, h, frac, color, label) {
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1.5, y + 1.5, Math.max(0, (w - 3) * clamp(frac, 0, 1)), h - 3);
  // Деления: четверти шкалы.
  ctx.strokeStyle = 'rgba(5,17,28,0.8)';
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const tx = Math.round(x + (w * i) / 4) + 0.5;
    ctx.moveTo(tx, y + 1); ctx.lineTo(tx, y + h - 1);
  }
  ctx.stroke();
  if (label) {
    ctx.fillStyle = CY_DIM;
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y - 4);
  }
}

const row = (ctx, x, y, label, value, color) => {
  ctx.textAlign = 'left';
  ctx.fillStyle = CY_DIM;
  ctx.fillText(label, x, y);
  ctx.fillStyle = color || INK;
  ctx.textAlign = 'right';
  ctx.fillText(value, x + 0, y);
};

/** Левый экран: двигатели. Скорость крупно, под ней шкалы. */
export function engineScreen(ctx, w, h, game) {
  const ship = game.ship;
  const back = ship.throttle < -0.001;
  const f = chrome(ctx, w, h, 'ДВИГАТЕЛЬ');

  ctx.font = `12px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = CY_DIM;
  ctx.fillText('СКОРОСТЬ', f.x, f.y + 12);
  // Главное число на экране — крупное: его читают, не приглядываясь.
  ctx.font = `${Math.round(f.h * 0.26)}px ${MONO}`;
  ctx.fillStyle = INK;
  ctx.fillText(fmtSpeed(ship.speed), f.x, f.y + 12 + f.h * 0.26);

  const gy = f.y + f.h * 0.45;
  const gh = Math.max(8, Math.round(f.h * 0.09));
  ctx.font = `10px ${MONO}`;
  gauge(ctx, f.x, gy, f.w, gh, Math.abs(ship.throttle), back ? AMBER : CY,
    back ? 'ТЯГА НАЗАД' : 'ТЯГА');
  gauge(ctx, f.x, gy + gh + 22, f.w, gh, ship.boost,
    ship.boosting ? AMBER : (ship.boostLock ? RED : CY), 'ФОРСАЖ');
  gauge(ctx, f.x, gy + (gh + 22) * 2, f.w, gh, ship.hull / SHIP.maxHull,
    ship.hull > 40 ? GREEN : RED, 'КОРПУС');

  // Шасси — строкой внизу, там же, где о нём говорит любая приборка.
  ctx.font = `11px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = ship.gear.out && ship.gear.t >= 0.995 ? GREEN
    : (ship.gear.t > 0.005 ? AMBER : CY_DIM);
  ctx.fillText(gearLabel(ship), f.x, f.y + f.h - 2);
}

/** Правый экран: цель. Имя, дистанция, время, компас. */
export function targetScreen(ctx, w, h, game, target) {
  const ship = game.ship;
  const q = game.quantum;
  const f = chrome(ctx, w, h, 'ЦЕЛЬ');
  const cr = Math.min(f.h, f.w * 0.34) * 0.46;
  const cx = f.x + f.w - cr - 6, cy = f.y + f.h / 2;

  ctx.font = `${Math.round(f.h * 0.2)}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = AMBER;
  ctx.fillText(targetLabel(target).slice(0, 18), f.x, f.y + f.h * 0.2);

  ctx.font = `12px ${MONO}`;
  const lx = f.x, vx = f.x + f.w - cr * 2 - 16;
  let ly = f.y + f.h * 0.46;
  const put = (label, value, color) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = CY_DIM;
    ctx.fillText(label, lx, ly);
    ctx.textAlign = 'right';
    ctx.fillStyle = color || INK;
    ctx.fillText(value, vx, ly);
    ly += 17;
  };
  if (game.info) {
    put('ДИСТ', fmtDist(game.info.gap));
    put('ETA', fmtTime(game.info.eta));
  }
  if (q && q.phase === 'calib') {
    put('ПРИВОД', q.aligned ? 'КАЛИБРОВКА' : 'НАВЕДИСЬ', q.aligned ? GREEN : AMBER);
  } else if (ship.docking) {
    put('ДОКИНГ', 'ВЕДЁТ', GREEN);
  }

  // Компас: куда смотреть, чтобы цель была по носу.
  if (game.info) compass(ctx, cx, cy, cr, ship, game.info.dir);
}

/** Компас цели: кольцо и метка направления в осях корабля. */
function compass(ctx, cx, cy, r, ship, dirWorld) {
  const b = ship.basis;
  const x = dirWorld.x * b.right.x + dirWorld.y * b.right.y + dirWorld.z * b.right.z;
  const y = dirWorld.x * b.up.x + dirWorld.y * b.up.y + dirWorld.z * b.up.z;
  const z = dirWorld.x * b.fwd.x + dirWorld.y * b.fwd.y + dirWorld.z * b.fwd.z;
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
  ctx.stroke();
  const flat = Math.hypot(x, y) || 1e-6;
  const k = Math.acos(clamp(z, -1, 1)) / Math.PI;      // 0 — по носу, 1 — за спиной
  const px = cx + (x / flat) * r * k * 2;
  const py = cy - (y / flat) * r * k * 2;
  ctx.fillStyle = z > 0 ? AMBER : RED;
  ctx.beginPath();
  ctx.arc(clamp(px, cx - r, cx + r), clamp(py, cy - r, cy + r), 3.5, 0, TAU);
  ctx.fill();
}

/**
 * Центральный экран: обзорный локатор.
 *
 * Круглый, а не эллипс поперёк доски: это отдельный прибор в своём
 * корпусе, и круг на нём — это горизонт вокруг корабля. Высота цели
 * показана чёрточкой вверх или вниз от метки, как на сканере в углу
 * экрана от третьего лица.
 */
export function scopeScreen(ctx, w, h, game) {
  // Заголовок прибора говорит и о чужих кораблях: в кабине угловых
  // панелей нет, и другого места для этого числа тоже нет.
  const peers = game.peers ? game.peers.length : 0;
  const f = chrome(ctx, w, h, peers > 0 ? 'ЛОКАТОР · ПИЛОТОВ РЯДОМ ' + peers : 'ЛОКАТОР');
  const cx = w / 2, cy = f.y + f.h / 2;
  const r = Math.min(f.w, f.h) / 2 - 4;
  const range = game.scannerRange;

  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  for (const k of [1, 0.66, 0.33]) {
    ctx.beginPath(); ctx.arc(cx, cy, r * k, 0, TAU); ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
  ctx.stroke();

  // Развёртка: она и делает локатор работающим прибором, а не картинкой.
  // Идёт по времени игрока — от частоты кадров не зависит.
  const t = (Date.now() % 4000) / 4000;
  const a = t * TAU;
  const grad = ctx.createLinearGradient(cx, cy, cx + Math.sin(a) * r, cy - Math.cos(a) * r);
  grad.addColorStop(0, 'rgba(79,179,224,0.35)');
  grad.addColorStop(1, 'rgba(79,179,224,0)');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
  ctx.stroke();
  ctx.lineWidth = 1;

  const b = game.ship.basis, sp = game.ship.pos;
  for (const o of game.scanBlips) {
    const dx = o.pos.x - sp.x, dy = o.pos.y - sp.y, dz = o.pos.z - sp.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > range) continue;
    const lx = (dx * b.right.x + dy * b.right.y + dz * b.right.z) / range;
    const ly = (dx * b.up.x + dy * b.up.y + dz * b.up.z) / range;
    const lz = (dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z) / range;
    const px = cx + lx * r, py = cy - lz * r;
    const hy = py - ly * r * 0.5;
    ctx.strokeStyle = o.color;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, hy); ctx.stroke();
    ctx.fillStyle = o.color;
    ctx.fillRect(px - 2, hy - 2, 4, 4);
  }

  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = CY_DIM;
  ctx.fillText('ДАЛЬНОСТЬ ' + fmtDist(range), cx, f.y + f.h - 1);
}

/** Верхнее левое табло: лента сообщений. */
export function commsScreen(ctx, w, h, game) {
  const f = chrome(ctx, w, h, 'СВЯЗЬ');
  ctx.font = `12px ${MONO}`;
  ctx.textAlign = 'left';
  let y = f.y + 12;
  const list = game.state.messages.slice(-5);
  for (const m of list) {
    ctx.globalAlpha = clamp(m.t, 0, 1);
    ctx.fillStyle = CY_DIM;
    ctx.fillText('>', f.x, y);
    ctx.fillStyle = m.color || AMBER;
    ctx.fillText(m.text.slice(0, 26), f.x + 14, y);
    ctx.globalAlpha = 1;
    y += 16;
  }
  if (game.statusLine) {
    ctx.fillStyle = GREEN;
    ctx.fillText(game.statusLine.slice(0, 28), f.x, Math.min(y, f.y + f.h - 2));
  }
  if (!list.length && !game.statusLine) {
    ctx.fillStyle = CY_DIM;
    ctx.fillText('канал чист', f.x, y);
  }
}

/** Верхнее правое табло: приводы и механизмы. */
export function systemsScreen(ctx, w, h, game) {
  const ship = game.ship;
  const q = game.quantum;
  const f = chrome(ctx, w, h, 'СИСТЕМЫ');
  ctx.font = `12px ${MONO}`;
  let y = f.y + 12;
  const put = (label, value, color) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = CY_DIM;
    ctx.fillText(label, f.x, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    ctx.fillText(value, f.x + f.w, y);
    y += 17;
  };
  const phase = q ? q.phase : 'idle';
  const drive = phase === 'idle' ? 'ГОТОВ'
    : (phase === 'calib' ? 'КАЛИБРОВКА' : (phase === 'brake' ? 'ГАШЕНИЕ' : 'ПРЫЖОК'));
  put('ПРИВОД', drive, phase === 'idle' ? GREEN : AMBER);
  put('ШАССИ', ship.gear.out ? (ship.gear.t >= 0.995 ? 'ВЫПУЩЕНО' : 'ВЫХОД') : 'УБРАНО',
    ship.gear.out && ship.gear.t >= 0.995 ? GREEN : (ship.gear.t > 0.005 ? AMBER : CY_DIM));
  if (ship.landing) {
    put('ПОСАДКА', String(ship.landing.phase || '').toUpperCase().slice(0, 11), AMBER);
  } else {
    put('РЕЖИМ', game.capture ? 'ЗАХВАТ' : 'СВОБОДНЫЙ', CY);
  }
  put('КОРПУС', Math.round(ship.hull) + '%', ship.hull > 40 ? GREEN : RED);
}
