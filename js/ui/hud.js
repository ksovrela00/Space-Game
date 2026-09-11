// Приборная панель: прицел, тяга, корпус, круиз, сканер, компас цели,
// маркер цели и помощник стыковки.

import { v3, dot, clamp, normalize } from '../core/vec3.js';
import { cruiseLabel } from '../game/cruise.js';
import { SHIP } from '../game/ship.js';
import { LIMITS, dockingQuality } from '../game/docking.js';
import { gearLabel } from '../game/landing.js';
import { SLOT, STATION_D } from '../models/station.js';
import { targetLabel } from '../game/nav.js';

const CY = '#4fb3e0';
const CY_DIM = 'rgba(79,179,224,0.35)';
const AMBER = '#ffcc66';
const GREEN = '#78e08f';
const RED = '#ff7a66';
const TAU = Math.PI * 2;

const _sil = {};
const _pt = { x: 0, y: 0 };

export const fmtDist = (km) => {
  if (!isFinite(km)) return '—';
  if (km < 1) return (km * 1000).toFixed(0) + ' м';
  if (km < 1000) return km.toFixed(1) + ' км';
  if (km < 1e6) return Math.round(km).toLocaleString('ru-RU') + ' км';
  return (km / 1e6).toFixed(2) + ' млн км';
};

export const fmtTime = (s) => {
  if (!isFinite(s)) return '—';
  if (s < 90) return Math.ceil(s) + ' с';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' мин ' + Math.round(s - m * 60) + ' с';
  return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин';
};

export const fmtSpeed = (kms) => {
  if (kms < 10) return kms.toFixed(2) + ' км/с';
  if (kms < 1000) return kms.toFixed(0) + ' км/с';
  return (kms / 1000).toFixed(1) + ' тыс. км/с';
};

const panel = (ctx, x, y, w, h) => {
  ctx.fillStyle = 'rgba(2,10,18,0.55)';
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
};

const bar = (ctx, x, y, w, h, frac, color, label) => {
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * clamp(frac, 0, 1)), h - 2);
  if (label) {
    ctx.fillStyle = CY;
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y - 4);
  }
};

export function drawHud(r, game) {
  const ctx = r.ctx;
  const cam = r.camera;
  const { ship, nav, cruise, state } = game;
  const w = cam.w, h = cam.h;
  const target = nav.list[nav.index];

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  if (state.view === 'cockpit') drawCockpitFrame(ctx, w, h);
  drawReticle(ctx, cam);
  if (target) drawTargetMarker(ctx, cam, target);

  // --- левая колонка: тяга и скорость ---
  const px = 18, py = h - 132;
  panel(ctx, px, py, 132, 112);
  ctx.font = '10px Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = CY;
  ctx.fillText('ТЯГА', px + 10, py + 18);
  bar(ctx, px + 10, py + 24, 112, 8, ship.throttle, CY);
  ctx.fillStyle = CY;
  ctx.fillText('СКОРОСТЬ', px + 10, py + 52);
  ctx.font = '15px Consolas, monospace';
  ctx.fillStyle = '#d8f2ff';
  ctx.fillText(fmtSpeed(ship.speed * cruise.level), px + 10, py + 70);
  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = cruise.massLocked ? RED : (cruise.level > 1 ? AMBER : CY_DIM);
  ctx.fillText(
    cruise.massLocked
      ? 'MASS LOCK · ' + cruiseLabel(cruise.level)
      : 'КРУИЗ ' + cruiseLabel(cruise.level),
    px + 10, py + 88);
  ctx.fillStyle = CY_DIM;
  ctx.fillText('КОРПУС', px + 10, py + 102);
  bar(ctx, px + 58, py + 95, 64, 7, ship.hull / SHIP.maxHull,
    ship.hull > 40 ? GREEN : RED);

  // Шасси: строкой над панелью, чтобы состояние было видно всегда.
  if (ship.gear.t > 0.005 || ship.gear.out) {
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = ship.gear.out && ship.gear.t >= 0.995 ? GREEN : AMBER;
    ctx.fillText(gearLabel(ship) + (ship.vtol ? '  ·  ПОСАДОЧНЫЙ РЕЖИМ' : ''), px, py - 8);
  }

  // --- правая колонка: цель ---
  const tx = w - 250, ty = h - 132;
  panel(ctx, tx, ty, 232, 112);
  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = CY_DIM;
  ctx.fillText('ЦЕЛЬ', tx + 10, ty + 18);
  ctx.font = '13px Consolas, monospace';
  ctx.fillStyle = AMBER;
  ctx.fillText(targetLabel(target).slice(0, 24), tx + 10, ty + 36);

  if (game.info) {
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = '#9fd9ff';
    ctx.fillText('ДИСТ  ' + fmtDist(game.info.gap), tx + 10, ty + 56);
    ctx.fillText('ETA   ' + fmtTime(game.info.eta), tx + 10, ty + 72);
    if (ship.autopilot) {
      ctx.fillStyle = GREEN;
      ctx.fillText('АВТОПИЛОТ', tx + 10, ty + 90);
    } else if (ship.docking) {
      ctx.fillStyle = GREEN;
      ctx.fillText('ДОКИНГ', tx + 10, ty + 90);
    }
    drawCompass(ctx, tx + 178, ty + 60, 34, ship, game.info.dir);
  }

  drawScanner(ctx, w / 2, h - 60, game);

  // --- помощник стыковки и посадочный дисплей ---
  if (game.dockAssist) drawDockAssist(ctx, w / 2, 96, game.dockAssist);
  else if (game.landInfo) drawLandPanel(ctx, w - 152, 24, game.landInfo, ship);

  // --- сообщения ---
  ctx.font = '12px Consolas, monospace';
  ctx.textAlign = 'left';
  let my = 26;
  for (const m of state.messages) {
    ctx.globalAlpha = clamp(m.t, 0, 1);
    ctx.fillStyle = m.color || AMBER;
    ctx.fillText(m.text, 20, my);
    my += 16;
    ctx.globalAlpha = 1;
  }

  if (game.statusLine) {
    ctx.textAlign = 'center';
    ctx.font = '12px Consolas, monospace';
    ctx.fillStyle = GREEN;
    ctx.fillText(game.statusLine, w / 2, h - 148);
  }

  ctx.restore();
}

function drawCockpitFrame(ctx, w, h) {
  // Стойки фонаря кабины: рамка, чтобы вид читался как «изнутри».
  ctx.strokeStyle = 'rgba(120,190,230,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.86); ctx.lineTo(w * 0.22, h * 0.72);
  ctx.lineTo(w * 0.78, h * 0.72); ctx.lineTo(w, h * 0.86);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, h * 0.06); ctx.lineTo(w * 0.3, h * 0.15);
  ctx.moveTo(w, h * 0.06); ctx.lineTo(w * 0.7, h * 0.15);
  ctx.stroke();
  const g = ctx.createLinearGradient(0, h * 0.72, 0, h);
  g.addColorStop(0, 'rgba(6,16,26,0)');
  g.addColorStop(1, 'rgba(6,16,26,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
}

function drawReticle(ctx, cam) {
  const x = cam.cx, y = cam.cy;
  ctx.strokeStyle = 'rgba(120,220,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 22, y); ctx.lineTo(x - 8, y);
  ctx.moveTo(x + 8, y); ctx.lineTo(x + 22, y);
  ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 8);
  ctx.moveTo(x, y + 8); ctx.lineTo(x, y + 22);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, TAU);
  ctx.stroke();
}

// Рамка вокруг цели или стрелка к ней у края экрана.
function drawTargetMarker(ctx, cam, target) {
  const c = cam.toCamera(target.pos);
  const onScreen = c.z > cam.near;
  if (onScreen) {
    // Рамку строим по тому же силуэту, по которому рисуется само тело,
    // иначе вне центра экрана она не совпадает с планетой.
    const sil = cam.silhouette(c, target.radius, _sil);
    const p = sil.ok ? sil : cam.project(c, _pt);
    if (p.x > 4 && p.x < cam.w - 4 && p.y > 4 && p.y < cam.h - 4) {
      const s = sil.ok
        ? clamp(Math.max(sil.a, sil.b) * 1.2, 10, 320)
        : 10;
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Уголки рамки
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const cx = p.x + sx * s, cy = p.y + sy * s;
        ctx.moveTo(cx, cy - sy * s * 0.3); ctx.lineTo(cx, cy);
        ctx.lineTo(cx - sx * s * 0.3, cy);
      }
      ctx.stroke();
      return;
    }
  }
  // За кадром: стрелка от центра к краю
  const dir = normalize(v3(c.x, c.y, 0));
  const ang = Math.atan2(-dir.y, dir.x) + (onScreen ? 0 : 0);
  const rr = Math.min(cam.w, cam.h) * 0.36;
  const ax = cam.cx + Math.cos(ang) * rr;
  const ay = cam.cy + Math.sin(ang) * rr;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(ang);
  ctx.fillStyle = c.z > 0 ? AMBER : 'rgba(255,204,102,0.5)';
  ctx.beginPath();
  ctx.moveTo(10, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Компас в духе Elite: точка — направление на цель в системе координат корабля.
function drawCompass(ctx, x, y, r, ship, dirWorld) {
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
  ctx.stroke();
  const b = ship.basis;
  const ax = dot(dirWorld, b.right);
  const ay = dot(dirWorld, b.up);
  const az = dot(dirWorld, b.fwd);
  const px = x + ax * r * 0.92;
  const py = y - ay * r * 0.92;
  ctx.beginPath();
  ctx.arc(px, py, 3.4, 0, TAU);
  if (az >= 0) { ctx.fillStyle = GREEN; ctx.fill(); }
  else { ctx.strokeStyle = RED; ctx.stroke(); }
}

// Сканер: эллипс с «палочками» высоты, как в Elite.
function drawScanner(ctx, cx, cy, game) {
  const rw = 150, rh = 42;
  const range = game.scannerRange;
  ctx.save();
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, rh, 0, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - rw, cy); ctx.lineTo(cx + rw, cy);
  ctx.moveTo(cx, cy - rh); ctx.lineTo(cx, cy + rh);
  ctx.stroke();
  ctx.font = '9px Consolas, monospace';
  ctx.fillStyle = CY_DIM;
  ctx.textAlign = 'center';
  ctx.fillText('СКАНЕР ' + fmtDist(range), cx, cy + rh + 13);

  const b = game.ship.basis;
  const sp = game.ship.pos;
  for (const o of game.scanBlips) {
    const rel = v3(o.pos.x - sp.x, o.pos.y - sp.y, o.pos.z - sp.z);
    const d = Math.hypot(rel.x, rel.y, rel.z);
    if (d > range) continue;
    const lx = dot(rel, b.right) / range;
    const ly = dot(rel, b.up) / range;
    const lz = dot(rel, b.fwd) / range;
    const px = cx + lx * rw;
    const py = cy - lz * rh;
    const hy = py - ly * rh * 0.75;
    ctx.strokeStyle = o.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py); ctx.lineTo(px, hy);
    ctx.stroke();
    ctx.fillStyle = o.color;
    ctx.fillRect(px - 2, hy - 2, 4, 4);
  }
  ctx.restore();
}

// Помощник стыковки: створ порта, положение корабля в нём и крен станции.
function drawDockAssist(ctx, cx, cy, a) {
  const w = 180, h = w * (SLOT.hh / SLOT.hw);
  ctx.save();
  ctx.translate(cx, cy);

  ctx.strokeStyle = a.q.ok ? GREEN : CY;
  ctx.lineWidth = 1;
  ctx.strokeRect(-w / 2, -h / 2, w, h);

  // Наклон створа = крен станции относительно корабля.
  ctx.save();
  ctx.rotate(-a.rollAngle);
  ctx.strokeStyle = a.rollOk ? GREEN : AMBER;
  ctx.beginPath();
  ctx.moveTo(-w * 0.62, 0); ctx.lineTo(-w * 0.5, 0);
  ctx.moveTo(w * 0.5, 0); ctx.lineTo(w * 0.62, 0);
  ctx.stroke();
  ctx.restore();

  // Положение корабля в створе.
  const px = clamp(a.q.local.x / SLOT.hw, -1.4, 1.4) * (w / 2);
  const py = -clamp(a.q.local.y / SLOT.hh, -1.4, 1.4) * (h / 2);
  ctx.fillStyle = a.q.inSlot ? GREEN : RED;
  ctx.beginPath();
  ctx.arc(px, py, 3.5, 0, TAU);
  ctx.fill();

  ctx.font = '10px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = CY_DIM;
  ctx.fillText('СТВОР ПОРТА  ' + fmtDist(Math.max(0, a.q.local.z - STATION_D)), 0, -h / 2 - 8);

  ctx.textAlign = 'left';
  const rows = [
    ['ОСЬ', a.q.align > LIMITS.align],
    ['КРЕН', a.rollOk],
    ['СКОР', a.q.speed < LIMITS.speed],
  ];
  let ry = h / 2 + 16;
  for (const [label, ok] of rows) {
    ctx.fillStyle = ok ? GREEN : RED;
    ctx.fillText((ok ? '+ ' : '- ') + label, -w / 2, ry);
    ry += 13;
  }
  ctx.restore();
}

/**
 * Посадочный дисплей: высота, вертикальная и боковая скорость, наклон
 * корабля и уклон площадки. Зелёное — в пределах допусков касания.
 */
function drawLandPanel(ctx, x, y, L, ship) {
  const w = 134, h = 104;
  ctx.save();
  panel(ctx, x, y, w, h);
  ctx.font = '9px Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = CY_DIM;
  ctx.fillText('ПОСАДКА · ' + L.body.name.toUpperCase().slice(0, 12), x + 8, y + 13);

  const row = (label, value, ok, ry) => {
    ctx.font = '9px Consolas, monospace';
    ctx.fillStyle = CY_DIM;
    ctx.fillText(label, x + 8, ry);
    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = ok === null ? '#d8f2ff' : (ok ? GREEN : RED);
    ctx.fillText(value, x + w - 8, ry);
    ctx.textAlign = 'left';
  };

  const tiltDeg = Math.acos(clamp(L.tilt, -1, 1)) * 57.3;
  row('ВЫСОТА', fmtDist(Math.max(0, L.alt)), null, y + 30);
  row('ВЕРТ', (L.vspeed * 1000).toFixed(0) + ' м/с', L.vspeedOk, y + 44);
  row('БОК', (L.hspeed * 1000).toFixed(0) + ' м/с', L.hspeedOk, y + 58);
  row('НАКЛОН', tiltDeg.toFixed(0) + '°', L.tiltOk, y + 72);
  row('УКЛОН', (L.slope * 57.3).toFixed(0) + '°', L.slopeOk, y + 86);

  ctx.font = '9px Consolas, monospace';
  ctx.fillStyle = L.gearOk ? GREEN : AMBER;
  ctx.fillText(L.gearOk ? 'ШАССИ ГОТОВО' : 'ШАССИ (G)', x + 8, y + 99);
  ctx.restore();
}

// Подготовка данных для помощника стыковки (вызывается из main).
export function makeDockAssist(ship, station) {
  const q = dockingQuality(ship, station);
  const tr = station.basis.right;
  let err = Math.atan2(dot(tr, ship.basis.up), dot(tr, ship.basis.right));
  if (Math.abs(err) > Math.PI / 2) err -= Math.sign(err) * Math.PI;
  return { q, rollAngle: err, rollOk: q.roll > LIMITS.roll };
}
