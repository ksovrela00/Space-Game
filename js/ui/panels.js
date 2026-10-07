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
import { fmtDist, fmtSpeed, fmtTime, warpInfo } from './hud.js';
import { targetLabel, targetKind, currentTarget } from '../game/nav.js';
import { hullName } from '../game/npc.js';
import { gearLabel } from '../game/landing.js';
import { fuelCap, fuelReserve, fuelLevel } from '../game/fuel.js';
import { L } from '../core/lang.js';
import { lockStatus } from '../game/airlock.js';
import { bodyLocal } from '../game/vessels.js';
import { roverFrame, bearingOf, roverTilt, latLon, roverHomeInfo } from '../game/rovernav.js';
import { RV } from '../models/rover.js';

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
  rann: [800, 80],
};

/** Сколько раз в секунду экран перерисовывается (на телефоне — вдвое реже). */
export const SCREEN_RATE = {
  scope: 30, flight: 30, target: 15, map: 6, systems: 4, comms: 10, annL: 8, annR: 8,
  rnav: 6, rdrive: 30, rsys: 4, rann: 8,
};

// Страницы в меню по верхней кромке — в порядке мониторов на доске.
const PAGES = [
  ['systems', 'СИСТ'], ['flight', 'ПОЛЁТ'], ['scope', 'ЛОК'], ['target', 'ЦЕЛЬ'], ['map', 'КАРТА'],
];

/**
 * Корпус страницы: фон, сетка, меню страниц сверху и подписи кнопок
 * снизу. Возвращает рабочее поле между ними. pages — свой набор страниц
 * (у вездехода их три); по умолчанию — корабельные.
 */
function chrome(ctx, W, H, page, keys, pages = PAGES) {
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
  const np = pages.length;
  for (let i = 0; i < np; i++) {
    const x = (i + 0.5) * W / np;
    const on = pages[i][0] === page;
    if (on) {
      ctx.fillStyle = CY;
      ctx.fillRect(x - 44, 3, 88, 22);
      ctx.fillStyle = BG;
    } else {
      ctx.fillStyle = DIM;
    }
    ctx.fillText(L(pages[i][1]), x, 20);
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
  // Диск — по ширине холста: на широком локаторе (660 × 330 у «Прометея»)
  // эллипс шире, высота та же. При 510 — прежние 255 и 212.
  const cx = W / 2, cy = 190, rx = W / 2 - 43, ry = 86;
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

  // Цель — чужая система: та же карточка, в световых годах.
  const sysT = target ? null : warpInfo(game);
  if (sysT) {
    ctx.textAlign = 'left';
    ctx.font = f(20);
    ctx.fillStyle = CY;
    ctx.fillText(L('СИСТЕМА'), 16, 60);
    ctx.font = f(38);
    ctx.fillStyle = '#c9a8ff';
    ctx.fillText(String(sysT.name).slice(0, 15), 16, 100);
    ctx.font = f(56);
    ctx.fillStyle = INK;
    ctx.fillText(sysT.ly.toFixed(1) + L(' св. г.'), 16, 168);
    ctx.font = f(24);
    ctx.fillStyle = CY;
    ctx.fillText(sysT.dest ? (L('маршрут до ') + sysT.dest.name).slice(0, 22) : L('варп ~') + Math.round(sysT.secs) + L(' с'), 16, 206);
    directionBall(ctx, 424, 168, 64, ship, sysT.dir);
    ctx.font = f(22);
    ctx.fillStyle = '#c9a8ff';
    ctx.fillText(L('J — ВАРП В ') + sysT.name.toUpperCase().slice(0, 12), 16, 270);
    return;
  }

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
  // У NPC рядом с видом — корпус (js/game/npc.js).
  const hull = target.npc ? ' · ' + hullName(target.type).toUpperCase() : '';
  ctx.fillText(kind ? L(kind) + hull : L('ЦЕЛЬ'), 16, 60);
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

/**
 * Контуры силуэта — в путь. БЕЗ closePath: fill() закрывает каждый
 * подпуть сам, а closePath в длинном пути Chrome дорожает с каждым
 * многоугольником, и весь путь выходит квадратичным. У «Прометея» их
 * три с половиной тысячи, и одна перерисовка экрана стоила 60–70 мс —
 * четыре раза в секунду: кадр терял по три такта, и в кабине было
 * пятьдесят кадров вместо шестидесяти. Без closePath путь строится за
 * десятую миллисекунды.
 */
function tracePolys(ctx, polys, cx, cy, S) {
  for (const p of polys) {
    ctx.moveTo(cx + p[0][0] * S, cy + p[0][1] * S);
    for (let i = 1; i < p.length; i++) ctx.lineTo(cx + p[i][0] * S, cy + p[i][1] * S);
  }
}

/**
 * Силуэт — готовой картинкой: один раз на корпус и цвет (цвет меняется
 * только на порогах корпуса). Экран перерисовывается четыре раза в
 * секунду, и заливать тысячи граней каждый раз незачем. Нет холста
 * (проверки в Node) — null, и силуэт рисуется путём.
 */
const _sil = { mesh: null, color: '', img: null };
function hullSilhouette(polys, mesh, color, S) {
  if (_sil.mesh === mesh && _sil.color === color && _sil.img) return _sil.img;
  const side = Math.ceil(S) + 4;
  let c = null;
  if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(side, side);
  else if (typeof document !== 'undefined' && document.createElement) c = document.createElement('canvas');
  const g = c && c.getContext ? c.getContext('2d') : null;
  if (!g) return null;
  c.width = side; c.height = side;
  g.fillStyle = color;
  g.globalAlpha = 0.55;
  g.beginPath();
  tracePolys(g, polys, side / 2, side / 2, S);
  g.fill();
  _sil.mesh = mesh; _sil.color = color; _sil.img = c;
  return c;
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
    const img = hullSilhouette(polys, game.shipMesh, hullC, S);
    if (img) {
      ctx.drawImage(img, cx - img.width / 2, cy - img.height / 2);
    } else {
      ctx.fillStyle = hullC;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      tracePolys(ctx, polys, cx, cy, S);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
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

// --- ВЕЗДЕХОД -------------------------------------------------------------------------
//
// Три монитора и табло поста водителя (js/models/cockpit.rover.js). Тот
// же вид, что у мониторов кораблей, — меню страниц сверху, подписи кнопок
// снизу, крупное главное, — но страниц три, и они про машину на грунте:
// куда ехать, как едет, что с ней. Числа хода — у типа (SHIP: driveSpeed,
// steerMax, slopeMax — server/data/specs.php), состояние — game.rover
// (js/game/rover.js), курс и куда до корабля — js/game/rovernav.js.

const ROVER_PAGES = [['rnav', 'НАВ'], ['rdrive', 'ХОД'], ['rsys', 'СИСТ']];
const DEG = 180 / Math.PI;

/**
 * Куда ехать: свой корабль-носитель (roverHomeInfo) и прочие корабли рядом
 * — в осях тела, км. Без игры (проверки) — пусто.
 */
function roverMarks(game) {
  const rv = game.rover, body = rv && rv.body;
  if (!body) return { home: null, list: [] };
  const home = roverHomeInfo(game);
  const list = [];
  for (const V of game.peers || []) {
    if (!V || !V.pos || (home && V === home.vessel)) continue;
    list.push({ l: bodyLocal(body, V.pos), npc: !!V.npc });
  }
  return { home, list };
}

/**
 * НАВИГАЦИЯ. Слева — карта вокруг машины курсом вверх: роза с делениями,
 * масштаб сам подбирается так, чтобы корабль-носитель был на карте; за
 * краем он — ромбом на ободе, по направлению. Справа — курс, до корабля
 * и куда к нему повернуть, широта и долгота.
 */
function roverNavScreen(ctx, W, H, game) {
  chrome(ctx, W, H, 'rnav', ['', '', '', '', L('M — КАРТА')], ROVER_PAGES);
  const rv = game.rover;
  if (!rv || !rv.body) return;
  const F = roverFrame(rv.lp);
  const head = bearingOf(F, rv.lb.fwd);
  const marks = roverMarks(game);
  const cx = 146, cy = 180, R = 112;
  const homeD = marks.home ? marks.home.dist : null, homeB = marks.home ? marks.home.bearing : 0;
  // Масштаб — круглый: 100 м, 200, 500, 1 км…, чтобы корабль был внутри.
  const want = Math.max(0.1, (homeD || 0) * 1.15);
  let span = 0.1;
  for (const s of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]) { span = s; if (s >= want) break; }
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
  ctx.fillStyle = 'rgba(79,179,224,0.05)';
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.strokeStyle = 'rgba(79,179,224,0.18)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, R / 2, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  // Точка карты: курс вверх — направление поворачивается на −курс.
  const at = (l) => {
    const d = { x: l.x - rv.lp.x, y: l.y - rv.lp.y, z: l.z - rv.lp.z };
    const dist = Math.hypot(d.x, d.y, d.z);
    const a = (bearingOf(F, d) - head) / DEG;
    const r = Math.min(dist / span, 1.2) * R;
    return { x: cx + Math.sin(a) * r, y: cy - Math.cos(a) * r, out: dist > span };
  };
  for (const m of marks.list) {
    const p = at(m.l);
    if (p.out) continue;
    ctx.fillStyle = m.npc ? 'rgba(227,214,160,0.85)' : PEER;
    ctx.fillRect(p.x - 5, p.y - 5, 10, 10);
  }
  ctx.restore();
  // Роза: обод, деления через 10°, буквы сторон света.
  ctx.strokeStyle = 'rgba(79,179,224,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
  ctx.beginPath();
  for (let g = 0; g < 360; g += 10) {
    const a = (g - head) / DEG, c = Math.sin(a), s = -Math.cos(a);
    const r0 = g % 30 === 0 ? R - 13 : R - 7;
    ctx.moveTo(cx + c * r0, cy + s * r0); ctx.lineTo(cx + c * R, cy + s * R);
  }
  ctx.stroke();
  ctx.font = f(22);
  ctx.textAlign = 'center';
  for (const [g, s] of [[0, 'С'], [90, 'В'], [180, 'Ю'], [270, 'З']]) {
    const a = (g - head) / DEG;
    ctx.fillStyle = g === 0 ? AMBER : CY;
    ctx.fillText(L(s), cx + Math.sin(a) * (R - 30), cy - Math.cos(a) * (R - 30) + 8);
  }
  // Корабль-носитель: на карте — квадрат с ободком; за краем — ромб на ободе.
  if (marks.home) {
    const p = at(marks.home.l);
    ctx.fillStyle = GREEN;
    if (p.out) {
      const a = (homeB - head) / DEG, x = cx + Math.sin(a) * R, y = cy - Math.cos(a) * R;
      ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 11); ctx.lineTo(x - 9, y); ctx.closePath(); ctx.fill();
    } else {
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x - 9, p.y - 9, 18, 18);
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
    }
  }
  // Сама машина — треугольник носом вверх.
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.moveTo(cx, cy - 13); ctx.lineTo(cx + 8, cy + 9); ctx.lineTo(cx - 8, cy + 9); ctx.closePath(); ctx.fill();
  ctx.fillStyle = DIM;
  ctx.font = f(18);
  ctx.textAlign = 'left';
  ctx.fillText(fmtDist(span), cx + R - 30, cy + R - 2);

  // Справа: курс, корабль, координаты.
  const x0 = 284;
  ctx.textAlign = 'left';
  ctx.font = f(20);
  ctx.fillStyle = CY;
  ctx.fillText(L('КУРС'), x0, 62);
  ctx.font = f(48);
  ctx.fillStyle = INK;
  ctx.fillText(String(Math.round(head) % 360).padStart(3, '0') + '°', x0, 108);
  ctx.font = f(20);
  ctx.fillStyle = CY;
  ctx.fillText(L('КОРАБЛЬ'), x0, 150);
  if (homeD !== null) {
    ctx.font = f(34);
    ctx.fillStyle = GREEN;
    ctx.fillText(fmtDist(homeD), x0, 188);
    // Куда повернуть: влево или вправо и на сколько.
    const turn = marks.home.turn;
    ctx.font = f(24);
    ctx.fillStyle = Math.abs(turn) < 10 ? GREEN : AMBER;
    ctx.fillText(Math.abs(turn) < 3 ? L('ПРЯМО') : (turn < 0 ? '◄ ' : '') + Math.round(Math.abs(turn)) + '°' + (turn > 0 ? ' ►' : ''),
      x0, 220);
  } else {
    ctx.font = f(24);
    ctx.fillStyle = DIM;
    ctx.fillText(L('НЕТ СВЯЗИ'), x0, 188);
  }
  const { lat, lon } = latLon(rv.lp);
  ctx.font = f(20);
  ctx.fillStyle = DIM;
  ctx.fillText(Math.abs(lat).toFixed(2) + '° ' + (lat >= 0 ? L('с.ш.') : L('ю.ш.')), x0, 262);
  ctx.fillText(Math.abs(lon).toFixed(2) + '° ' + (lon >= 0 ? L('в.д.') : L('з.д.')), x0, 288);
}

/**
 * ХОД. Слева — скорость дугой в км/ч и ход словом (вперёд, задний, накат,
 * стоянка), под ней — руль: куда повёрнуты колёса. Справа — наклон машиной сзади и сбоку и шесть колёс сверху: как
 * поджата подвеска и какие в воздухе.
 */
function roverDriveScreen(ctx, W, H, game) {
  chrome(ctx, W, H, 'rdrive', ['', '', '', '', L('ФАРЫ')], ROVER_PAGES);
  const rv = game.rover;
  if (!rv) return;
  const vmax = SHIP.driveSpeed || 1, vrev = SHIP.reverseSpeed || 0;
  const cx = 140, cy = 170, r = 100;
  const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
  // Шкала: назад — короткий янтарный участок слева от нуля, вперёд — голубой.
  const zero = vrev / (vmax + vrev);
  const at = (v) => a0 + span * clamp(zero + v / (vmax + vrev), 0, 1);
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,204,102,0.35)';
  ctx.beginPath(); ctx.arc(cx, cy, r, at(-vrev), at(0)); ctx.stroke();
  ctx.strokeStyle = 'rgba(79,179,224,0.25)';
  ctx.beginPath(); ctx.arc(cx, cy, r, at(0), at(vmax)); ctx.stroke();
  // Деления — через 10 км/ч.
  ctx.strokeStyle = DIM;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k <= vmax * 3.6 + 1e-6; k += 10) {
    const a = at(k / 3.6), c = Math.cos(a), s = Math.sin(a);
    const r0 = k % 20 === 0 ? r - 20 : r - 12;
    ctx.moveTo(cx + c * r0, cy + s * r0); ctx.lineTo(cx + c * (r - 5), cy + s * (r - 5));
  }
  ctx.stroke();
  const v = rv.v || 0;
  ctx.lineWidth = 13;
  ctx.strokeStyle = v < 0 ? AMBER : CY;
  ctx.beginPath();
  if (v >= 0) ctx.arc(cx, cy, r - 11, at(0), at(v)); else ctx.arc(cx, cy, r - 11, at(v), at(0));
  ctx.stroke();
  const a = at(v);
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a) * (r - 36), cy + Math.sin(a) * (r - 36));
  ctx.lineTo(cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2));
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = f(56);
  ctx.fillText(String(Math.round(Math.abs(v) * 3.6)), cx, cy + 14);
  ctx.fillStyle = DIM;
  ctx.font = f(20);
  ctx.fillText(L('км/ч'), cx, cy + 42);
  // Ход — словом над числом: стоит на тормозе, едет вперёд, назад или
  // катится без газа.
  const parked = rv.hold || (rv.brake > 0 && Math.abs(v) < 0.3);
  const gear = parked ? 'СТОЯНКА' : rv.pedal < 0 || v < -0.3 ? 'ЗАДНИЙ' : rv.pedal > 0 || v > 0.3 ? 'ВПЕРЁД' : 'НАКАТ';
  ctx.font = f(24);
  ctx.fillStyle = gear === 'ВПЕРЁД' ? GREEN : gear === 'НАКАТ' ? DIM : AMBER;
  ctx.fillText(L(gear), cx, cy - 40);
  // Руль: шкала от упора до упора, метка — где колёса; на ходу упор
  // ближе (steerFade) — это видно по светлой части шкалы.
  const sMax = (SHIP.steerMax || 30) / DEG;
  const fade = 1 - (1 - (SHIP.steerFade ?? 1)) * Math.min(1, Math.abs(v) / Math.max(1, vmax));
  const bx = cx, by = 284, bw = 110;
  ctx.fillStyle = 'rgba(79,179,224,0.18)';
  ctx.fillRect(bx - bw, by - 5, bw * 2, 10);
  ctx.fillStyle = 'rgba(79,179,224,0.40)';
  ctx.fillRect(bx - bw * fade, by - 5, bw * fade * 2, 10);
  ctx.fillStyle = INK;
  ctx.fillRect(bx - 1, by - 10, 2, 20);
  const sx = bx + clamp((rv.steer || 0) / sMax, -1, 1) * bw;
  ctx.fillStyle = AMBER;
  ctx.beginPath(); ctx.moveTo(sx, by - 6); ctx.lineTo(sx + 8, by - 16); ctx.lineTo(sx - 8, by - 16); ctx.closePath(); ctx.fill();
  ctx.fillRect(sx - 2, by - 6, 4, 12);

  // Наклон: машина сзади (крен) и сбоку (тангаж) на линии горизонта.
  const t = roverTilt(rv);
  const lim = SHIP.slopeMax || 34;
  const tc = (deg) => (Math.abs(deg) > lim ? RED : Math.abs(deg) > lim * 0.7 ? AMBER : GREEN);
  const tiltIcon = (x, y, deg, side) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(79,179,224,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-46, 0); ctx.lineTo(46, 0); ctx.stroke();
    ctx.rotate(side ? -deg / DEG : deg / DEG);
    ctx.fillStyle = tc(deg);
    if (side) {
      // Сбоку: кузов, лоб скошен, три колеса.
      ctx.beginPath(); ctx.moveTo(-34, -6); ctx.lineTo(-34, -30); ctx.lineTo(14, -30); ctx.lineTo(34, -14); ctx.lineTo(34, -6); ctx.closePath(); ctx.fill();
      for (const wx of [-24, 2, 25]) { ctx.beginPath(); ctx.arc(wx, -5, 6, 0, TAU); ctx.fill(); }
    } else {
      // Сзади: кузов с фасками и два колеса.
      ctx.beginPath(); ctx.moveTo(-20, -6); ctx.lineTo(-20, -24); ctx.lineTo(-14, -32); ctx.lineTo(14, -32); ctx.lineTo(20, -24); ctx.lineTo(20, -6); ctx.closePath(); ctx.fill();
      ctx.fillRect(-29, -14, 7, 14); ctx.fillRect(22, -14, 7, 14);
    }
    ctx.restore();
  };
  tiltIcon(320, 104, t.roll, false);
  tiltIcon(432, 104, t.pitch, true);
  ctx.font = f(20);
  ctx.textAlign = 'center';
  ctx.fillStyle = CY;
  ctx.fillText(L('КРЕН'), 320, 136);
  ctx.fillText(L('ТАНГАЖ'), 432, 136);
  ctx.font = f(24);
  ctx.fillStyle = tc(t.roll);
  ctx.fillText(Math.round(t.roll) + '°', 320, 64);
  ctx.fillStyle = tc(t.pitch);
  ctx.fillText(Math.round(t.pitch) + '°', 432, 64);

  // Колёса сверху: прямоугольник — колесо, поворот — как у колеса, цвет —
  // ход подвески (в воздухе — серый), полоска рядом — насколько поджато.
  const wx0 = 376, wy0 = 222, kx = 34, kz = 15;
  const travel = SHIP.travel || 0.2;
  ctx.strokeStyle = 'rgba(79,179,224,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(wx0 - 26, wy0 - 52, 52, 104);
  const WS = rv.wheels || [];
  for (let i = 0; i < WS.length; i++) {
    const w = WS[i], side = i % 2 ? 1 : -1, z = RV.wheel.z[Math.floor(i / 2)] ?? 0;
    const x = wx0 + side * kx, y = wy0 - z * kz;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(w.steer || 0);
    ctx.fillStyle = !w.touch ? 'rgba(159,217,255,0.25)' : Math.abs(w.drop) > travel * 0.85 ? AMBER : GREEN;
    ctx.fillRect(-6, -13, 12, 26);
    ctx.restore();
    const k = clamp(-(w.drop || 0) / travel, -1, 1);
    ctx.fillStyle = 'rgba(216,242,255,0.7)';
    ctx.fillRect(x + side * 13 - 3, y - k * 12 - 1, 6, 2);
  }
  ctx.textAlign = 'left';
  ctx.font = f(20);
  ctx.fillStyle = rv.air ? AMBER : rv.slip ? RED : DIM;
  ctx.fillText(rv.air ? L('В ВОЗДУХЕ') : rv.slip ? L('СКОЛЬЗИТ') : L('КОЛЁСА'), 250, 290);
}

/**
 * СИСТЕМЫ. Слева — машина сверху цветом корпуса, справа — корпус, дверь и
 * воздух кабины (шлюз — вся машина: js/models/interior.rover.js), фары и
 * тормоз стоянки.
 */
function roverSysScreen(ctx, W, H, game) {
  const ship = game.ship;
  chrome(ctx, W, H, 'rsys', [L('ДВЕРЬ'), '', '', '', L('ЖУРНАЛ')], ROVER_PAGES);
  const hullK = clamp(ship.hull / (SHIP.maxHull || 100), 0, 1);
  const hullC = hullK > 0.6 ? GREEN : (hullK > 0.3 ? AMBER : RED);
  const polys = hullOutline(game.shipMesh);
  if (polys) {
    const img = hullSilhouette(polys, game.shipMesh, hullC, 200);
    if (img) ctx.drawImage(img, 110 - img.width / 2, 168 - img.height / 2);
  }
  const rv = game.rover;
  const air = game.ownAir ? game.ownAir() : null;
  const ls = air ? lockStatus(air, 'rlock') : null;
  let y = 70;
  const row = (label, value, color) => {
    ctx.textAlign = 'left';
    ctx.font = f(20);
    ctx.fillStyle = CY;
    ctx.fillText(label, 230, y);
    ctx.textAlign = 'right';
    ctx.font = f(24);
    ctx.fillStyle = color;
    ctx.fillText(value, W - 16, y);
    y += 37;
  };
  row(L('КОРПУС'), Math.round(hullK * 100) + '%', hullC);
  if (ls) {
    const door = ls.open ? L('ОТКРЫТА') : ls.state === 'cycle' || ls.state === 'close' ? L('ЦИКЛ') : L('ЗАДРАЕНА');
    row(L('ДВЕРЬ'), door, ls.open ? RED : ls.state === 'sealed' ? GREEN : AMBER);
    const p = ls.p;
    row(L('КАБИНА'), p.toFixed(2) + L(' бар'), p > 0.9 ? GREEN : p > 0.4 ? AMBER : RED);
    row(L('ЗАБОРТ'), (ls.out || 0).toFixed(2) + L(' бар'), INK);
  } else {
    row(L('ДВЕРЬ'), '—', DIM);
  }
  row(L('ФАРЫ'), ship.lights ? L('ВКЛ') : L('ВЫКЛ'), ship.lights ? '#ffe9a8' : DIM);
  row(L('ТОРМОЗ'), rv && rv.hold ? L('СТОЯНКА') : rv && rv.brake > 0 ? L('ВКЛ') : L('ВЫКЛ'), rv && (rv.hold || rv.brake > 0) ? AMBER : DIM);
}

/** Табло вездехода: тормоз, уклон, дверь, фары, корпус. */
function roverAnn(ctx, W, H, game) {
  const ship = game.ship, rv = game.rover || {};
  const air = game.ownAir ? game.ownAir() : null;
  const ls = air ? lockStatus(air, 'rlock') : null;
  const lim = (SHIP.slopeMax || 34) / DEG;
  const low = ship.hull / (SHIP.maxHull || 100) < 0.4;
  annunciators(ctx, W, H, [
    [L('ТОРМОЗ'), rv.hold || rv.brake > 0 ? AMBER : null, false],
    [L('УКЛОН'), rv.slip ? RED : (rv.slope || 0) > lim * 0.7 ? AMBER : null, !!rv.slip],
    [L('ДВЕРЬ'), !ls ? null : ls.open ? RED : ls.state !== 'sealed' ? AMBER : null, !!ls && ls.state === 'cycle'],
    [L('ФАРЫ'), ship.lights ? '#ffe9a8' : null, false],
    [L('КОРПУС'), low ? RED : null, true],
  ], game.now || 0);
}

const DRAW = {
  flight: flightScreen, scope: scopeScreen, target: targetScreen, map: mapScreen,
  systems: systemsScreen, comms: commsStrip, annL: annLeft, annR: annRight,
  rnav: roverNavScreen, rdrive: roverDriveScreen, rsys: roverSysScreen, rann: roverAnn,
};

/**
 * Нарисовать экран на его холсте. Масштаб от номинала ставится здесь
 * одним преобразованием — сами экраны верстаются в своих пикселях.
 */
export function drawScreen(id, ctx, w, h, game, nom = null) {
  const fn = DRAW[id];
  if (!fn || !game || !game.ship) return false;
  // Номинал — у экрана, если он свой (широкий локатор), иначе по виду.
  const [NW, NH] = nom || NOMINAL[id] || NOMINAL.mfd;
  ctx.save();
  ctx.setTransform(w / NW, 0, 0, h / NH, 0, 0);
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
  fn(ctx, NW, NH, game);
  ctx.restore();
  return true;
}
