// Софт мониторов кабины.
//
// Каждый экран рисуется на СВОЁМ холсте (js/ui/displays.js), и холст
// уходит текстурой на стекло монитора в кабине (js/gl/cabin.js). Отсюда
// два правила, которых у угловых панелей нет вовсе.
//
// ПЕРВОЕ: верстка — в своих пикселях, от левого верхнего угла, на
// номинальном размере (монитор 510×330, табло 800×80 или 600×80).
// Холст бывает и крупнее, и мельче — по плотности профиля устройства, —
// и масштаб ставится одним преобразованием перед отрисовкой.
//
// ВТОРОЕ: кегль — от того, каким монитор выходит В КАДРЕ. Монитор в
// четверть метра на расстоянии метра занимает на экране 1600×900 около
// 180 пикселей в ширину, то есть номинальный пиксель ужимается втрое.
// Надпись в 12 пикселей становится четырьмя — сыпью, а не текстом.
// Поэтому главное на каждом мониторе — 40–60 пикселей (13–20 в кадре),
// подписи — 22–26 (7–9), и на экране немного крупных вещей, а не
// много мелких. Подписи кнопок по краям — 16: их не читают, по ним
// узнают страницу, как по раскладке клавиш.
//
// Вид — как у многофункционального индикатора в самолёте: по верхней
// кромке меню из пяти страниц против пяти кнопок рамки, текущая
// страница подсвечена; по нижней — подписи своих кнопок страницы.

import { clamp } from '../core/vec3.js';
import { CY, CY_DIM, AMBER, GREEN, RED, INK, PEER } from './theme.js';
import { SHIP } from '../game/ship.js';
import { fmtDist, fmtSpeed, fmtTime } from './hud.js';
import { targetLabel, targetKind, currentTarget } from '../game/nav.js';
import { gearLabel } from '../game/landing.js';
import { fuelCap, fuelReserve, fuelLevel } from '../game/fuel.js';
import { L } from '../core/lang.js';

const TAU = Math.PI * 2;
const FONT = 'Consolas, "Courier New", monospace';
const f = (px, bold = true) => `${bold ? 'bold ' : ''}${px}px ${FONT}`;
const BG = '#03080d';
const DIM = 'rgba(159,217,255,0.42)';
const GRID = 'rgba(79,179,224,0.07)';

/** Номинальные размеры: монитор и табло. */
export const NOMINAL = {
  mfd: [510, 330],
  comms: [800, 80],
  annL: [600, 80],
  annR: [600, 80],
};

/** Сколько раз в секунду экран перерисовывается (на телефоне — вдвое реже). */
export const SCREEN_RATE = {
  scope: 30, flight: 30, target: 15, map: 6, systems: 4, comms: 10, annL: 8, annR: 8,
};

// Страницы в меню по верхней кромке — в порядке мониторов на доске.
const PAGES = [
  ['systems', 'СИСТ'], ['flight', 'ПОЛЁТ'], ['scope', 'ЛОК'], ['target', 'ЦЕЛЬ'], ['map', 'КАРТА'],
];

/**
 * Корпус страницы: фон, сетка, меню страниц сверху и подписи кнопок
 * снизу. Возвращает рабочее поле между ними.
 */
function chrome(ctx, W, H, page, keys) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  // Сетка подложки: по ней видно и границы экрана, и его наклон.
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 30; x < W; x += 30) { ctx.moveTo(x + 0.5, 30); ctx.lineTo(x + 0.5, H - 30); }
  for (let y = 60; y < H - 30; y += 30) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
  ctx.stroke();

  // Меню страниц — против пяти верхних кнопок рамки.
  ctx.font = f(16);
  ctx.textAlign = 'center';
  for (let i = 0; i < 5; i++) {
    const x = (i + 0.5) * W / 5;
    const on = PAGES[i][0] === page;
    if (on) {
      ctx.fillStyle = CY;
      ctx.fillRect(x - 44, 3, 88, 22);
      ctx.fillStyle = BG;
    } else {
      ctx.fillStyle = DIM;
    }
    ctx.fillText(L(PAGES[i][1]), x, 20);
    // Метка кнопки у самой кромки.
    ctx.fillStyle = on ? CY : 'rgba(79,179,224,0.35)';
    ctx.fillRect(x - 1, 0, 2, 3);
  }
  // Подписи своих кнопок — снизу.
  ctx.fillStyle = DIM;
  for (let i = 0; i < 5; i++) {
    const x = (i + 0.5) * W / 5;
    if (keys && keys[i]) ctx.fillText(keys[i], x, H - 9);
    ctx.fillStyle = 'rgba(79,179,224,0.35)';
    ctx.fillRect(x - 1, H - 3, 2, 3);
    ctx.fillStyle = DIM;
  }
  ctx.strokeStyle = 'rgba(79,179,224,0.22)';
  ctx.beginPath();
  ctx.moveTo(0, 30.5); ctx.lineTo(W, 30.5);
  ctx.moveTo(0, H - 29.5); ctx.lineTo(W, H - 29.5);
  ctx.stroke();
  return { x: 14, y: 34, w: W - 28, h: H - 68 };
}

/** Значение и единица из «0.42 км/с»: число крупно, единица мельче. */
function splitUnit(s) {
  const i = s.indexOf(' ');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

// --- ПОЛЁТ -------------------------------------------------------------------------

/**
 * Скорость — круглой шкалой, а не числом: по стрелке видно, сколько до
 * предела и где начинается форсаж, не читая цифр. Справа — столбики
 * тяги, заряда форсажа и топлива; снизу — высота и вертикальная
 * скорость, когда корабль в чьём-то тяготении.
 */
function flightScreen(ctx, W, H, game) {
  const ship = game.ship;
  chrome(ctx, W, H, 'flight', [L('ГАС'), '', L('ШАС'), '', L('ФАРЫ')]);

  const cx = 150, cy = 178, r = 112;
  const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
  const vmax = (SHIP.maxSpeed || 1) * (SHIP.boostMax || 1);
  const cruise = (SHIP.maxSpeed || 1) / vmax;
  const at = (k) => a0 + span * clamp(k, 0, 1);

  // Шкала: крейсерская часть — голубая, форсажная — янтарная.
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(79,179,224,0.25)';
  ctx.beginPath(); ctx.arc(cx, cy, r, at(0), at(cruise)); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,204,102,0.35)';
  ctx.beginPath(); ctx.arc(cx, cy, r, at(cruise), at(1)); ctx.stroke();
  // Деления.
  ctx.strokeStyle = DIM;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const a = at(i / 10), c = Math.cos(a), s = Math.sin(a);
    const r0 = i % 5 === 0 ? r - 22 : r - 14;
    ctx.moveTo(cx + c * r0, cy + s * r0); ctx.lineTo(cx + c * (r - 6), cy + s * (r - 6));
  }
  ctx.stroke();
  // Показание — толстой дугой по шкале.
  const k = clamp(ship.speed / vmax, 0, 1);
  const over = ship.speed > (SHIP.maxSpeed || Infinity) * 1.001;
  ctx.lineWidth = 14;
  ctx.strokeStyle = over || ship.boosting ? AMBER : CY;
  ctx.beginPath(); ctx.arc(cx, cy, r - 12, at(0), at(k)); ctx.stroke();
  // Стрелка.
  const a = at(k);
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a) * (r - 40), cy + Math.sin(a) * (r - 40));
  ctx.lineTo(cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2));
  ctx.stroke();

  const [num, unit] = splitUnit(fmtSpeed(ship.speed));
  ctx.textAlign = 'center';
  ctx.fillStyle = CY;
  ctx.font = f(20);
  ctx.fillText(ship.throttle < -0.001 ? L('ХОД НАЗАД') : L('СКОРОСТЬ'), cx, cy - 38);
  ctx.fillStyle = INK;
  ctx.font = f(58);
  ctx.fillText(num, cx, cy + 18);
  ctx.fillStyle = DIM;
  ctx.font = f(22);
  ctx.fillText(unit, cx, cy + 48);

  // Столбики: тяга (с реверсом вниз от нуля), заряд форсажа и бак.
  const bar = (x, label, frac, color, note, zero = 0) => {
    const top = 62, bot = 262, hgt = bot - top;
    ctx.strokeStyle = 'rgba(79,179,224,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, top + 0.5, 44, hgt);
    const y0 = bot - hgt * zero;
    const y1 = y0 - hgt * (1 - zero) * clamp(frac, -1, 1) * (frac < 0 ? zero / (1 - zero) : 1);
    ctx.fillStyle = color;
    ctx.fillRect(x + 4, Math.min(y0, y1), 37, Math.abs(y1 - y0));
    if (zero > 0) {
      ctx.fillStyle = INK;
      ctx.fillRect(x - 4, y0 - 1, 52, 2);
    }
    ctx.fillStyle = CY;
    ctx.font = f(20);
    ctx.textAlign = 'center';
    ctx.fillText(label, x + 22, bot + 26);
    ctx.fillStyle = INK;
    ctx.font = f(22);
    ctx.fillText(note, x + 22, top - 8);
  };
  const back = ship.throttle < -0.001;
  bar(300, L('ТЯГА'), ship.throttle, back ? AMBER : CY,
    Math.round(Math.abs(ship.throttle) * 100) + '%', 0.2);
  bar(372, L('ФОРС'), ship.boost, ship.boosting ? AMBER : (ship.boostLock ? RED : CY),
    Math.round(ship.boost * 100) + '%');
  // Бак — тоннами, как и в приборах от третьего лица: прыжки стоят тонн.
  // Черта на столбике — резерв: ниже неё привод и варп не включатся.
  const fuel = fuelLevel(ship);
  const cap = fuelCap() || 1;
  bar(444, L('ТОПЛ'), ship.fuel / cap, fuel === 'ok' ? CY : (fuel === 'low' ? AMBER : RED),
    ship.fuel.toFixed(1));
  ctx.fillStyle = RED;
  ctx.fillRect(440, 262 - 200 * clamp(fuelReserve() / cap, 0, 1) - 1, 52, 2);

  // Высота — когда под нами чьё-то тяготение.
  const b = game.capture;
  if (b) {
    const z = game.zone;
    const alt = z ? z.alt : Math.hypot(ship.pos.x - b.pos.x, ship.pos.y - b.pos.y,
      ship.pos.z - b.pos.z) - b.radius;
    ctx.textAlign = 'left';
    ctx.font = f(20);
    ctx.fillStyle = CY;
    ctx.fillText(L('ВЫС'), 18, 290);
    ctx.fillStyle = INK;
    ctx.font = f(24);
    ctx.fillText(fmtDist(Math.max(0, alt)), 64, 290);
    const li = game.landInfo;
    if (li && li.vspeed !== undefined) {
      ctx.fillStyle = li.vspeedOk ? GREEN : RED;
      ctx.fillText((li.vspeed * 1000).toFixed(0) + L(' м/с'), 200, 290);
    }
  } else if (!ship.damp) {
    ctx.textAlign = 'left';
    ctx.font = f(22);
    ctx.fillStyle = AMBER;
    ctx.fillText(L('ГАСИТЕЛИ ВЫКЛ'), 18, 290);
  }
}

// --- ЛОКАТОР -----------------------------------------------------------------------

/**
 * Локатор в перспективе, как в «Элите»: диск — плоскость корабля, метка
 * стоит на нём своей проекцией, а вверх или вниз от неё идёт ножка —
 * высота над плоскостью. По одному взгляду видно и направление, и
 * «выше-ниже», чего плоский круг не умеет.
 */
function scopeScreen(ctx, W, H, game) {
  chrome(ctx, W, H, 'scope', [L('ДАЛЬН'), '', '', '', L('ЦЕЛЬ')]);
  const cx = 255, cy = 190, rx = 212, ry = 86;
  const range = game.scannerRange || 1;

  ctx.fillStyle = 'rgba(79,179,224,0.07)';
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(79,179,224,0.5)';
  ctx.lineWidth = 2;
  for (const k of [1, 2 / 3, 1 / 3]) {
    ctx.beginPath(); ctx.ellipse(cx, cy, rx * k, ry * k, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(79,179,224,0.28)';
  }
  // Конус обзора: сорок пять градусов на каждую сторону от носа.
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.707, cy - ry * 0.707); ctx.lineTo(cx, cy);
  ctx.lineTo(cx + rx * 0.707, cy - ry * 0.707);
  ctx.moveTo(cx - rx, cy); ctx.lineTo(cx + rx, cy);
  ctx.stroke();

  // Развёртка — по времени игрока, от частоты кадров не зависит.
  const t = ((game.now || Date.now() / 1000) % 4) / 4;
  const sa = t * TAU;
  const grad = ctx.createLinearGradient(cx, cy, cx + Math.sin(sa) * rx, cy - Math.cos(sa) * ry);
  grad.addColorStop(0, 'rgba(79,179,224,0.5)');
  grad.addColorStop(1, 'rgba(79,179,224,0)');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(sa) * rx, cy - Math.cos(sa) * ry); ctx.stroke();

  // Свой корабль — треугольник в центре, носом вперёд (вверх по диску).
  ctx.fillStyle = GREEN;
  ctx.beginPath(); ctx.moveTo(cx, cy - 9); ctx.lineTo(cx + 7, cy + 6); ctx.lineTo(cx - 7, cy + 6); ctx.fill();

  const ship = game.ship;
  const b = ship.basis, sp = ship.pos;
  const target = game.nav ? currentTarget(game.nav) : null;
  // Сначала метки позади (ниже по диску), потом впереди: ближние к глазу
  // должны лежать сверху.
  const blips = [];
  for (const o of game.scanBlips || []) {
    const dx = o.pos.x - sp.x, dy = o.pos.y - sp.y, dz = o.pos.z - sp.z;
    if (Math.hypot(dx, dy, dz) > range) continue;
    blips.push({
      o,
      lx: (dx * b.right.x + dy * b.right.y + dz * b.right.z) / range,
      ly: (dx * b.up.x + dy * b.up.y + dz * b.up.z) / range,
      lz: (dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z) / range,
    });
  }
  blips.sort((p, q) => q.lz - p.lz);
  for (const p of blips) {
    const px = cx + p.lx * rx, py = cy - p.lz * ry;
    const hy = py - p.ly * ry * 1.5;
    ctx.strokeStyle = p.o.color;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, hy); ctx.stroke();
    ctx.fillStyle = p.o.color;
    if (p.o.peer) {
      ctx.beginPath(); ctx.moveTo(px, hy - 8); ctx.lineTo(px + 8, hy + 6); ctx.lineTo(px - 8, hy + 6); ctx.fill();
    } else {
      ctx.fillRect(px - 6, hy - 6, 12, 12);
    }
    // Основание ножки — точка на диске: без неё высота не читается.
    ctx.fillRect(px - 3, py - 1.5, 6, 3);
    if (target && p.o.pos === target.pos) {
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, hy, 13, 0, TAU); ctx.stroke();
    }
  }

  ctx.textAlign = 'left';
  ctx.font = f(22);
  ctx.fillStyle = CY;
  ctx.fillText(L('ДАЛЬН'), 16, 60);
  ctx.fillStyle = INK;
  ctx.font = f(26);
  ctx.fillText(fmtDist(range), 16, 88);
  const peers = game.peers ? game.peers.length : 0;
  if (peers > 0) {
    ctx.textAlign = 'right';
    ctx.font = f(22);
    ctx.fillStyle = PEER;
    ctx.fillText(L('ПИЛОТОВ РЯДОМ ') + peers, W - 16, 60);
  }
}

// --- ЦЕЛЬ --------------------------------------------------------------------------

/** Шар направления: центр — по носу, кольцо — 90°, за кольцом — позади. */
function directionBall(ctx, cx, cy, r, ship, dirWorld) {
  const b = ship.basis;
  const x = dirWorld.x * b.right.x + dirWorld.y * b.right.y + dirWorld.z * b.right.z;
  const y = dirWorld.x * b.up.x + dirWorld.y * b.up.y + dirWorld.z * b.up.z;
  const z = dirWorld.x * b.fwd.x + dirWorld.y * b.fwd.y + dirWorld.z * b.fwd.z;
  ctx.strokeStyle = 'rgba(79,179,224,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(79,179,224,0.25)';
  ctx.beginPath(); ctx.arc(cx, cy, r / 2, 0, TAU); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
  ctx.stroke();
  const flat = Math.hypot(x, y) || 1e-6;
  const k = Math.acos(clamp(z, -1, 1)) / Math.PI;
  const px = cx + (x / flat) * r * k * 2, py = cy - (y / flat) * r * k * 2;
  ctx.fillStyle = z > 0 ? AMBER : RED;
  ctx.beginPath();
  ctx.arc(cx + clamp(px - cx, -r, r), cy + clamp(py - cy, -r, r), 9, 0, TAU);
  ctx.fill();
}

function targetScreen(ctx, W, H, game) {
  const ship = game.ship;
  const q = game.quantum;
  const target = game.nav ? currentTarget(game.nav) : null;
  chrome(ctx, W, H, 'target', [L('ПРЕД'), '', L('ПРЫЖОК'), '', L('СЛЕД')]);

  if (!target) {
    ctx.textAlign = 'center';
    ctx.font = f(40);
    ctx.fillStyle = DIM;
    ctx.fillText(L('НЕТ ЦЕЛИ'), W / 2, 160);
    ctx.font = f(22);
    ctx.fillText(L('TAB — ВЫБРАТЬ'), W / 2, 200);
    return;
  }
  const kind = targetKind(target);
  ctx.textAlign = 'left';
  ctx.font = f(20);
  ctx.fillStyle = CY;
  ctx.fillText(kind ? L(kind) : L('ЦЕЛЬ'), 16, 60);
  ctx.font = f(38);
  ctx.fillStyle = AMBER;
  ctx.fillText(String(target.name || targetLabel(target)).slice(0, 15), 16, 100);

  const info = game.info;
  if (info) {
    ctx.font = f(56);
    ctx.fillStyle = INK;
    ctx.fillText(fmtDist(info.gap), 16, 168);
    ctx.font = f(24);
    ctx.fillStyle = CY;
    if (isFinite(info.eta) && info.eta > 0) {
      ctx.fillText(L('ЛЁТУ ') + fmtTime(info.eta), 16, 206);
    }
    ctx.fillStyle = DIM;
    ctx.font = f(20);
    ctx.fillText(L('СБЛИЖ ') + fmtSpeed(Math.max(0, info.closing)), 16, 236);
    directionBall(ctx, 424, 168, 64, ship, info.dir);
  }

  // Строка состояния: что сейчас сделает J.
  ctx.font = f(22);
  if (q && q.phase === 'calib') {
    ctx.fillStyle = q.aligned ? GREEN : AMBER;
    ctx.fillText(q.aligned ? L('КАЛИБРОВКА') : L('НАВЕДИСЬ НА ЦЕЛЬ'), 16, 270);
    ctx.strokeStyle = 'rgba(79,179,224,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(250.5, 254.5, 240, 18);
    ctx.fillRect(254, 258, 233 * clamp(q.calib, 0, 1), 11);
  } else if (ship.docking) {
    ctx.fillStyle = GREEN;
    ctx.fillText(L('ДОКИНГ'), 16, 270);
  } else if (game.warpTarget) {
    ctx.fillStyle = '#c9a8ff';
    ctx.fillText(L('J — ВАРП В ') + game.warpTarget.name.toUpperCase().slice(0, 12), 16, 270);
  } else {
    ctx.fillStyle = DIM;
    ctx.fillText(L('J — ПРЫЖОК К ЦЕЛИ'), 16, 270);
  }
}

// --- КАРТА -------------------------------------------------------------------------

const rgb = (c) => 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';

/**
 * План системы сверху, как большая карта (js/ui/map.js): та же
 * плоскость XZ и та же ориентация, чтобы, переключившись на карту (M),
 * не искать глазами, где что.
 *
 * Масштаб выбирается сам. В свободном полёте — вся система: куда лететь
 * и насколько далеко. В тяготении планеты — сама планета, её луны и
 * порт вокруг корабля: вся система в такой момент сжимается в точку, и
 * смотреть на неё незачем.
 */
function mapScreen(ctx, W, H, game) {
  const world = game.world;
  const ship = game.ship;
  const target = game.nav ? currentTarget(game.nav) : null;
  const local = game.capture && world && world.planets.includes(game.capture) ? game.capture
    : (game.capture || null);
  chrome(ctx, W, H, 'map', [local ? L('ПЛАН') : L('СИСТ'), '', '', '', L('M — КАРТА')]);
  if (!world || !world.planets.length) return;

  const vx = 0, vy = 31, vw = W, vh = H - 61;
  let cxw, czw, fit;
  if (local) {
    cxw = local.pos.x; czw = local.pos.z;
    const d = Math.hypot(ship.pos.x - local.pos.x, ship.pos.z - local.pos.z);
    let span = Math.max(local.radius * 3, d * 1.3);
    if (local.station) span = Math.max(span, local.station.orbit.radius * 1.15);
    for (const m of local.moons || []) span = Math.max(span, Math.min(m.orbit.radius * 1.1, d * 3));
    fit = span;
  } else {
    cxw = world.star.pos.x; czw = world.star.pos.z;
    fit = world.planets[world.planets.length - 1].orbit.radius * 1.06;
  }
  const scale = (Math.min(vw, vh) / 2 - 8) / fit;
  const X = (x) => vx + vw / 2 + (x - cxw) * scale;
  const Y = (z) => vy + vh / 2 + (z - czw) * scale;

  ctx.save();
  ctx.beginPath(); ctx.rect(vx, vy, vw, vh); ctx.clip();
  const orbit = (host, radius, color) => {
    const rr = radius * scale;
    if (rr < 3 || rr > 4000) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(host.pos.x), Y(host.pos.z), rr, 0, TAU); ctx.stroke();
  };
  const body = (o, min) => {
    const rr = Math.max(min, o.radius * scale);
    ctx.fillStyle = rgb(o.color || [180, 200, 220]);
    ctx.beginPath(); ctx.arc(X(o.pos.x), Y(o.pos.z), rr, 0, TAU); ctx.fill();
    return rr;
  };
  if (local) {
    for (const m of local.moons || []) orbit(local, m.orbit.radius, 'rgba(79,179,224,0.3)');
    if (local.station) orbit(local, local.station.orbit.radius, 'rgba(120,224,143,0.35)');
    body(local, 6);
    for (const m of local.moons || []) body(m, 4);
    if (local.station) {
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 2;
      ctx.strokeRect(X(local.station.pos.x) - 5, Y(local.station.pos.z) - 5, 10, 10);
    }
  } else {
    for (const p of world.planets) orbit(world.star, p.orbit.radius, 'rgba(79,179,224,0.28)');
    body(world.star, 7);
    for (const p of world.planets) body(p, 4);
  }

  // Цель: кольцо и пунктир от корабля — видно, куда лететь и насколько далеко.
  const sx = X(ship.pos.x), sy = Y(ship.pos.z);
  if (target) {
    const tx = X(target.pos.x), ty = Y(target.pos.z);
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255,204,102,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(tx, ty, 13, 0, TAU); ctx.stroke();
  }
  // Корабль — зелёный треугольник носом по курсу (проекция носа на план).
  const fx = ship.basis.fwd.x, fz = ship.basis.fwd.z;
  const fl = Math.hypot(fx, fz) || 1;
  const ux = fx / fl, uz = fz / fl;
  ctx.fillStyle = GREEN;
  ctx.beginPath();
  ctx.moveTo(sx + ux * 13, sy + uz * 13);
  ctx.lineTo(sx - ux * 8 - uz * 8, sy - uz * 8 + ux * 8);
  ctx.lineTo(sx - ux * 8 + uz * 8, sy - uz * 8 - ux * 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.font = f(22);
  ctx.fillStyle = local ? AMBER : CY;
  ctx.fillText(String(local ? local.name : (world.name || world.star.name)).toUpperCase().slice(0, 18), 14, 58);
  // Масштаб — отрезком круглой длины, как на большой карте.
  const km = 120 / scale;
  const e = Math.floor(Math.log10(km));
  const m = km / 10 ** e;
  const nice = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * 10 ** e;
  const px = nice * scale;
  ctx.strokeStyle = DIM;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, 280); ctx.lineTo(14 + px, 280);
  ctx.moveTo(14, 274); ctx.lineTo(14, 286);
  ctx.moveTo(14 + px, 274); ctx.lineTo(14 + px, 286);
  ctx.stroke();
  ctx.fillStyle = DIM;
  ctx.font = f(18);
  ctx.fillText(fmtDist(nice), 22 + px, 287);
}

// --- СИСТЕМЫ -------------------------------------------------------------------------

// Силуэт корпуса сверху: грани, спроецированные на план. Считается один
// раз на корпус — он не меняется, — а раскрашивается каждый раз по
// состоянию.
let _outline = null, _outlineOf = null;
function hullOutline(mesh) {
  if (_outlineOf === mesh) return _outline;
  _outlineOf = mesh;
  _outline = null;
  if (!mesh || !mesh.verts || !mesh.faces) return null;
  let lo = Infinity, hi = -Infinity, wx = 0;
  for (const v of mesh.verts) {
    lo = Math.min(lo, v.z); hi = Math.max(hi, v.z); wx = Math.max(wx, Math.abs(v.x));
  }
  const L = Math.max(hi - lo, wx * 2) || 1;
  const polys = [];
  for (const fc of mesh.faces) {
    // Только грани, смотрящие вверх или вниз: боковые в плане — отрезки.
    if (Math.abs(fc.n.y) < 0.2) continue;
    polys.push(fc.v.map((i) => [mesh.verts[i].x / L, -(mesh.verts[i].z - (lo + hi) / 2) / L]));
  }
  _outline = polys;
  return polys;
}

function systemsScreen(ctx, W, H, game) {
  const ship = game.ship;
  const q = game.quantum;
  chrome(ctx, W, H, 'systems', [L('ЩИТ'), '', L('ПРИВОД'), '', L('ЖУРНАЛ')]);

  const hullK = clamp(ship.hull / (SHIP.maxHull || 100), 0, 1);
  const hullC = hullK > 0.6 ? GREEN : (hullK > 0.3 ? AMBER : RED);
  // Схема корабля сверху: цвет — по корпусу, овал вокруг — щит.
  const polys = hullOutline(game.shipMesh);
  const cx = 120, cy = 166, S = 210;
  if (SHIP.maxShield > 0) {
    const sk = clamp(ship.shield / SHIP.maxShield, 0, 1);
    ctx.strokeStyle = `rgba(79,179,224,${(0.15 + 0.6 * sk).toFixed(2)})`;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(cx, cy, 70, 118, 0, 0, TAU); ctx.stroke();
  }
  if (polys) {
    ctx.fillStyle = hullC;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (const p of polys) {
      ctx.moveTo(cx + p[0][0] * S, cy + p[0][1] * S);
      for (let i = 1; i < p.length; i++) ctx.lineTo(cx + p[i][0] * S, cy + p[i][1] * S);
      ctx.closePath();
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  let y = 70;
  const row = (label, value, color) => {
    ctx.textAlign = 'left';
    ctx.font = f(20);
    ctx.fillStyle = CY;
    ctx.fillText(label, 250, y);
    ctx.textAlign = 'right';
    ctx.font = f(24);
    ctx.fillStyle = color;
    ctx.fillText(value, W - 16, y);
    y += 37;
  };
  row(L('КОРПУС'), Math.round(hullK * 100) + '%', hullC);
  if (SHIP.maxShield > 0) {
    row(L('ЩИТ'), Math.round(clamp(ship.shield / SHIP.maxShield, 0, 1) * 100) + '%', CY);
  }
  const fuel = fuelLevel(ship);
  row(L('ТОПЛИВО'), ship.fuel.toFixed(1) + ' / ' + fuelCap().toFixed(0) + L(' т'),
    fuel === 'ok' ? GREEN : (fuel === 'low' ? AMBER : RED));
  const phase = q ? q.phase : 'idle';
  row(L('ПРИВОД'), phase === 'idle' ? L('ГОТОВ')
    : (phase === 'calib' ? L('КАЛИБРОВКА') : (phase === 'brake' ? L('ГАШЕНИЕ') : L('ПРЫЖОК'))),
  phase === 'idle' ? GREEN : AMBER);
  const down = ship.gear.out && ship.gear.t >= 0.995;
  row(L('ШАССИ'), ship.gear.out ? (down ? L('ВЫПУЩЕНО') : L('ВЫХОД')) : (ship.gear.t > 0.005 ? L('УБОРКА') : L('УБРАНО')),
    down ? GREEN : (ship.gear.t > 0.005 ? AMBER : DIM));
  row(L('ГАСИТЕЛИ'), ship.damp ? L('ВКЛ') : L('ВЫКЛ'), ship.damp ? GREEN : AMBER);
  row(L('РЕЖИМ'), ship.landing ? String(ship.landing.phase || '').toUpperCase().slice(0, 10)
    : (game.capture ? L('ЗАХВАТ') : L('СВОБОДНЫЙ')), ship.landing ? AMBER : INK);
}

// --- ТАБЛО НА КОЗЫРЬКЕ -------------------------------------------------------------------

/** Лампы сигнализации: плитка горит своим цветом, погасшая — тёмная. */
function annunciators(ctx, W, H, tiles, t) {
  ctx.fillStyle = '#020508';
  ctx.fillRect(0, 0, W, H);
  const n = tiles.length, gap = 12;
  const tw = (W - gap * (n + 1)) / n;
  ctx.textAlign = 'center';
  ctx.font = f(26);
  for (let i = 0; i < n; i++) {
    const [label, color, blink] = tiles[i];
    const x = gap + i * (tw + gap);
    const on = color && (!blink || Math.floor(t * 2.5) % 2 === 0);
    ctx.fillStyle = on ? color : '#0b1117';
    ctx.fillRect(x, 8, tw, H - 16);
    ctx.strokeStyle = on ? color : 'rgba(79,179,224,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, 9, tw - 2, H - 18);
    ctx.fillStyle = on ? '#08121a' : 'rgba(159,217,255,0.30)';
    ctx.fillText(label, x + tw / 2, H / 2 + 9);
  }
}

function annLeft(ctx, W, H, game) {
  const ship = game.ship;
  const down = ship.gear.out && ship.gear.t >= 0.995;
  const moving = !down && ship.gear.t > 0.005;
  annunciators(ctx, W, H, [
    [L('ШАССИ'), down ? GREEN : (moving ? AMBER : null), moving],
    [L('ГАСИТЕЛИ'), ship.damp ? null : AMBER, false],
    [L('ФОРСАЖ'), ship.boostLock ? RED : (ship.boosting ? AMBER : null), false],
  ], game.now || 0);
}

function annRight(ctx, W, H, game) {
  const ship = game.ship;
  const q = game.quantum;
  const phase = q ? q.phase : 'idle';
  const low = ship.hull / (SHIP.maxHull || 100) < 0.4;
  // Лампа топлива: янтарная — меньше четверти, красная — резерв, мигает —
  // бак пуст и сопла молчат.
  const fuel = fuelLevel(ship);
  annunciators(ctx, W, H, [
    [L('КОРПУС'), low ? RED : null, true],
    [L('ТОПЛИВО'), fuel === 'ok' ? null : (fuel === 'low' ? AMBER : RED), fuel === 'dry'],
    [L('ПРИВОД'), phase === 'idle' ? null : (phase === 'calib' ? AMBER : CY), phase === 'calib'],
    [L('ФАРЫ'), ship.lights ? '#ffe9a8' : null, false],
  ], game.now || 0);
}

/** Табло сообщений: две последние строки ленты связи. */
function commsStrip(ctx, W, H, game) {
  ctx.fillStyle = '#020508';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'left';
  ctx.font = f(28);
  const list = (game.state && game.state.messages || []).slice(-2);
  let y = list.length > 1 ? 34 : 52;
  for (const m of list) {
    ctx.globalAlpha = clamp(m.t, 0.25, 1);
    ctx.fillStyle = CY_DIM;
    ctx.fillText('>', 12, y);
    ctx.fillStyle = m.color || AMBER;
    ctx.fillText(String(m.text).slice(0, 44), 38, y);
    y += 34;
  }
  ctx.globalAlpha = 1;
  if (!list.length) {
    ctx.fillStyle = game.statusLine ? GREEN : DIM;
    ctx.fillText(game.statusLine ? String(game.statusLine).slice(0, 46) : L('канал чист'), 12, 52);
  }
}

const DRAW = {
  flight: flightScreen, scope: scopeScreen, target: targetScreen, map: mapScreen,
  systems: systemsScreen, comms: commsStrip, annL: annLeft, annR: annRight,
};

/**
 * Нарисовать экран на его холсте. Масштаб от номинала ставится здесь
 * одним преобразованием — сами экраны верстаются в своих пикселях.
 */
export function drawScreen(id, ctx, w, h, game) {
  const fn = DRAW[id];
  if (!fn || !game || !game.ship) return false;
  const [NW, NH] = NOMINAL[id] || NOMINAL.mfd;
  ctx.save();
  ctx.setTransform(w / NW, 0, 0, h / NH, 0, 0);
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
  fn(ctx, NW, NH, game);
  ctx.restore();
  return true;
}
