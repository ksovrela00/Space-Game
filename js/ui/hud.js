// Приборная панель: прицел, тяга, корпус, круиз, сканер, компас цели,
// маркер цели и помощник стыковки.

import { v3, dot, clamp, normalize } from '../core/vec3.js';
import { cruiseLabel } from '../game/cruise.js';
import { SHIP } from '../game/ship.js';
import { LIMITS, dockingQuality } from '../game/docking.js';
import { gearLabel } from '../game/landing.js';
import { SLOT, STATION_D } from '../models/station.js';
import { targetLabel } from '../game/nav.js';
import { gravityAt } from '../game/gravity.js';
import { altitudeOf, worldPoint } from '../game/surface.js';

const CY = '#4fb3e0';
const CY_DIM = 'rgba(79,179,224,0.35)';
const AMBER = '#ffcc66';
const GREEN = '#78e08f';
const RED = '#ff7a66';
const TAU = Math.PI * 2;

const _sil = {};
// Кольцо отметки грунта: радиус и высота, выше которой её не рисуем.
const MARK_R = 0.030;      // км
const MARK_MAX = 1.5;      // км
const _mk = { x: 0, y: 0, z: 0 };
const _mkc = { x: 0, y: 0, z: 0 };
const _mkAlt = { dir: { x: 0, y: 0, z: 0 } };
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

  // Приборы подхода включаются в гравитационном захвате и берут на себя
  // скорость, высоту, дистанцию и посадочные условия. Угловые панели
  // при этом ужимаются до того, чего в центре нет: тяга, круиз, корпус,
  // имя цели с компасом. Дублировать одно и то же в двух местах хуже,
  // чем не показывать вовсе: глаз всё равно мечется между ними.
  const approach = !!(game.capture && state.mode === 'flight');

  // --- левая колонка: тяга, круиз, корпус ---
  const lh = approach ? 68 : 112;
  const px = 18, py = h - lh - 20;
  panel(ctx, px, py, 132, lh);
  ctx.font = '10px Consolas, monospace';
  ctx.textAlign = 'left';
  const back = ship.throttle < -0.001;
  ctx.fillStyle = back ? AMBER : CY;
  ctx.fillText(back ? 'ТЯГА НАЗАД' : 'ТЯГА', px + 10, py + 18);
  bar(ctx, px + 10, py + 24, 112, 8, Math.abs(ship.throttle), back ? AMBER : CY);
  if (!approach) {
    ctx.fillStyle = CY;
    ctx.fillText('СКОРОСТЬ', px + 10, py + 52);
    ctx.font = '15px Consolas, monospace';
    ctx.fillStyle = '#d8f2ff';
    ctx.fillText(fmtSpeed(ship.speed * cruise.level), px + 10, py + 70);
    ctx.font = '10px Consolas, monospace';
  }
  const cruiseY = approach ? py + 48 : py + 88;
  ctx.fillStyle = cruise.massLocked ? RED : (cruise.level > 1 ? AMBER : CY_DIM);
  ctx.fillText(
    cruise.massLocked
      ? 'MASS LOCK · ' + cruiseLabel(cruise.level)
      : 'КРУИЗ ' + cruiseLabel(cruise.level),
    px + 10, cruiseY);
  ctx.fillStyle = CY_DIM;
  ctx.fillText('КОРПУС', px + 10, cruiseY + 14);
  bar(ctx, px + 58, cruiseY + 7, 64, 7, ship.hull / SHIP.maxHull,
    ship.hull > 40 ? GREEN : RED);

  // Шасси: строкой над панелью. У поверхности его состояние стоит в
  // приборах подхода отдельной клеткой, и здесь оно уже лишнее.
  if ((ship.gear.t > 0.005 || ship.gear.out) && !(approach && game.landInfo)) {
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = ship.gear.out && ship.gear.t >= 0.995 ? GREEN : AMBER;
    ctx.fillText(gearLabel(ship), px, py - 8);
  }

  // --- правая колонка: цель ---
  const th = approach ? 68 : 112;
  const tx = w - 250, ty = h - th - 20;
  panel(ctx, tx, ty, 232, th);
  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = CY_DIM;
  ctx.fillText('ЦЕЛЬ', tx + 10, ty + 18);
  ctx.font = '13px Consolas, monospace';
  ctx.fillStyle = AMBER;
  ctx.fillText(targetLabel(target).slice(0, 24), tx + 10, ty + 36);

  if (game.info) {
    ctx.font = '11px Consolas, monospace';
    if (!approach) {
      ctx.fillStyle = '#9fd9ff';
      ctx.fillText('ДИСТ  ' + fmtDist(game.info.gap), tx + 10, ty + 56);
      ctx.fillText('ETA   ' + fmtTime(game.info.eta), tx + 10, ty + 72);
    }
    const stateY = approach ? ty + 58 : ty + 90;
    if (ship.autopilot) {
      ctx.fillStyle = GREEN;
      ctx.fillText('АВТОПИЛОТ', tx + 10, stateY);
    } else if (ship.docking) {
      ctx.fillStyle = GREEN;
      ctx.fillText('ДОКИНГ', tx + 10, stateY);
    }
    drawCompass(ctx, tx + 178, ty + th / 2, approach ? 24 : 34, ship, game.info.dir);
  }

  drawScanner(ctx, w / 2, h - 60, game);

  // --- приборы подхода, помощник стыковки ---
  if (approach) {
    drawGroundMark(ctx, cam, game);
    drawApproachPanel(ctx, w / 2, h / 2, w, h, game);
  }
  if (game.dockAssist) drawDockAssist(ctx, w / 2, 96, game.dockAssist);

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

/**
 * Приборы подхода — одно место, куда пилот смотрит у планеты.
 *
 * Раньше то же самое лежало по четырём углам экрана: скорость слева
 * внизу, дистанция справа внизу, посадочные условия справа сверху, а
 * гравитации не было видно нигде. У поверхности это не работает: между
 * взглядами в разные углы корабль успевает уйти на десятки метров.
 *
 * Поэтому здесь всё вместе и вокруг прицела — как на авиационном ИЛС:
 * колонки по краям рамки, середина свободна, чтобы не загораживать вид.
 * Появляется панель ровно тогда, когда корабль попадает в
 * гравитационный захват тела (js/game/gravity.js), и сама по себе
 * служит признаком захвата.
 */
function drawApproachPanel(ctx, cx, cy, w, h, game) {
  const { ship, cruise } = game;
  const b = game.capture;
  const zone = game.zone;
  const L = game.landInfo;

  const BW = clamp(w * 0.10, 120, 220);
  const BH = clamp(h * 0.13, 92, 160);
  const left = cx - BW + 12, right = cx + BW - 12;

  ctx.save();
  // Рамка углами, а не сплошным прямоугольником: инструмент очерчен, но
  // вид сквозь него не заперт в коробку.
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  const C = 16;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = cx + sx * BW, y = cy + sy * BH;
    ctx.beginPath();
    ctx.moveTo(x - sx * C, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y - sy * C);
    ctx.stroke();
  }

  // Показание: маленькая подпись и крупное значение под ней. Координаты
  // абсолютные, без translate — так вёрстку видно и в коде, и в
  // проверке (tools/smoke.mjs сверяет, что всё легло в рамку).
  const stat = (x, y, align, label, value, color, size = 15) => {
    ctx.textAlign = align;
    ctx.font = '9px Consolas, monospace';
    ctx.fillStyle = CY_DIM;
    ctx.fillText(label, x, y);
    ctx.font = size + 'px Consolas, monospace';
    ctx.fillStyle = color || '#d8f2ff';
    ctx.fillText(value, x, y + 18);
  };
  const rowY = [cy - BH + 22, cy - BH + 68, cy - BH + 114];

  // Высота: над РЕЛЬЕФОМ, пока он посчитан, иначе над сферой тела.
  const gap = Math.hypot(
    ship.pos.x - b.pos.x, ship.pos.y - b.pos.y, ship.pos.z - b.pos.z) - b.radius;
  const alt = zone ? zone.alt : gap;

  // Вертикальная и боковая скорость относительно грунта: у поверхности
  // это главные числа, по ним же проверяется касание.
  let vUp = null, hSp = null;
  if (L) { vUp = L.vspeed; hSp = L.hspeed; } else if (zone) {
    vUp = dot(zone.relVel, zone.upWorld);
    const hx = zone.relVel.x - zone.upWorld.x * vUp;
    const hy = zone.relVel.y - zone.upWorld.y * vUp;
    const hz = zone.relVel.z - zone.upWorld.z * vUp;
    hSp = Math.hypot(hx, hy, hz);
  }
  const ms = (v) => (v === null ? '—' : (v * 1000).toFixed(0) + ' м/с');

  stat(left, rowY[0], 'left', 'СКОРОСТЬ', fmtSpeed(ship.speed * cruise.level), '#d8f2ff', 16);
  stat(right, rowY[0], 'right', 'ВЫСОТА', fmtDist(Math.max(0, alt)), '#d8f2ff', 16);
  stat(left, rowY[1], 'left', 'ВЕРТ', ms(vUp), L ? (L.vspeedOk ? GREEN : RED) : null, 13);
  stat(right, rowY[1], 'right', 'ДО ЦЕЛИ',
    game.info ? fmtDist(game.info.gap) : '—', AMBER, 13);
  stat(left, rowY[2], 'left', 'БОК', ms(hSp), L ? (L.hspeedOk ? GREEN : RED) : null, 13);
  stat(right, rowY[2], 'right', 'ETA', game.info ? fmtTime(game.info.eta) : '—', '#9fd9ff', 13);

  // Гравитация — вертикальной шкалой справа от рамки: она про
  // «насколько глубоко мы в колодце», и столбик, растущий снизу вверх,
  // читается как раз так. Внизу — сколько её здесь и сколько у грунта,
  // чтобы было с чем сравнивать.
  //
  // Полоса растёт как R/d, а не как само ускорение: по ускорению она бы
  // почти весь подлёт стояла в нуле и прыгала только у поверхности.
  const gHere = gravityAt(b, ship.pos) * 1000;          // м/с²
  const frac = Math.sqrt(clamp(gHere / Math.max(b.g0, 1e-6), 0, 1));
  const gx = cx + BW + 60;
  const gy0 = cy - BH + 14, gy1 = cy + BH - 14;
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(gx - 6, gy0, 12, gy1 - gy0);
  const fill = (gy1 - gy0 - 2) * clamp(frac, 0, 1);
  ctx.fillStyle = frac > 0.75 ? AMBER : CY;
  ctx.fillRect(gx - 5, gy1 - 1 - fill, 10, fill);

  ctx.textAlign = 'center';
  ctx.font = '9px Consolas, monospace';
  ctx.fillStyle = CY_DIM;
  ctx.fillText('ТЯЖЕСТЬ', gx, gy0 - 8);
  ctx.fillStyle = AMBER;
  ctx.fillText('ЗАХВАТ · ' + b.name.toUpperCase().slice(0, 14), gx, gy1 + 16);
  ctx.font = '12px Consolas, monospace';
  ctx.fillStyle = '#d8f2ff';
  ctx.fillText(gHere.toFixed(2) + ' м/с²', gx, gy1 + 32);
  ctx.font = '9px Consolas, monospace';
  ctx.fillStyle = CY_DIM;
  ctx.fillText('у грунта ' + b.g0.toFixed(1), gx, gy1 + 45);

  // Посадочные условия — теми же цветами, что и скорости выше: зелёное
  // значит «в допуске касания».
  if (L) {
    const chips = [
      ['ШАССИ', L.gearOk ? 'ГОТОВО' : 'УБРАНО', L.gearOk],
      ['НАКЛОН', (Math.acos(clamp(L.tilt, -1, 1)) * 57.3).toFixed(0) + '°', L.tiltOk],
      ['УКЛОН', (L.slope * 57.3).toFixed(0) + '°', L.slopeOk],
    ];
    const step = (right - left) / chips.length;
    ctx.font = '9px Consolas, monospace';
    for (let i = 0; i < chips.length; i++) {
      const [label, value, ok] = chips[i];
      const x = left + step * (i + 0.5);
      ctx.textAlign = 'center';
      ctx.fillStyle = CY_DIM;
      ctx.fillText(label, x, cy + BH - 18);
      ctx.fillStyle = ok ? GREEN : RED;
      ctx.font = '11px Consolas, monospace';
      ctx.fillText(value, x, cy + BH - 5);
      ctx.font = '9px Consolas, monospace';
    }
  }
  ctx.restore();
}

/**
 * Отметка грунта под кораблём: кольцо на поверхности, вертикальная нить
 * до корабля и высота цифрой.
 *
 * Это ответ на «прибор показывает 32 метра, а кажется, что двести».
 * Высоту глаз оценивает не по числу, а по знакомому размеру рядом с
 * землёй; на пустой поверхности без деревьев и домов такого размера
 * нет. Кольцо и есть этот размер: оно ровно 30 метров в радиусе, лежит
 * на грунте и проецируется честной перспективой — по нему сразу видно и
 * высоту, и куда именно опустится корабль.
 */
function drawGroundMark(ctx, cam, game) {
  const z = game.zone;
  if (!z || z.alt > MARK_MAX || z.alt < 0) return;
  const ship = game.ship;
  const up = z.upWorld;

  // Центр отметки — точка под кораблём: вниз по местной вертикали на
  // высоту, которую показывает прибор.
  const gx = ship.pos.x - up.x * z.alt;
  const gy = ship.pos.y - up.y * z.alt;
  const gz = ship.pos.z - up.z * z.alt;

  // Оси кольца в плоскости грунта: нос корабля, спроецированный на неё.
  const f = ship.basis.fwd;
  const d = f.x * up.x + f.y * up.y + f.z * up.z;
  let ax = f.x - up.x * d, ay = f.y - up.y * d, az = f.z - up.z * d;
  const al = Math.hypot(ax, ay, az);
  if (al < 1e-6) return;
  ax /= al; ay /= al; az /= al;
  const bx = up.y * az - up.z * ay, by = up.z * ax - up.x * az, bz = up.x * ay - up.y * ax;

  // Кольцо кладётся НА РЕЛЬЕФ: высота грунта берётся под каждой его
  // точкой. Плоским кольцом высота не читается — оно одинаково лежит и
  // на ровном месте, и поперёк кратера, а именно перепад под ним и даёт
  // глазу чувство высоты.
  const N = 16;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const c = Math.cos(a) * MARK_R, s = Math.sin(a) * MARK_R;
    _mk.x = gx + ax * c + bx * s;
    _mk.y = gy + ay * c + by * s;
    _mk.z = gz + az * c + bz * s;
    const g = altitudeOf(z.body, _mk, _mkAlt);
    worldPoint(z.body, g.dir, g.groundR, _mk);
    cam.toCamera(_mk, _mkc);
    if (_mkc.z <= cam.near) return;            // кольцо частично за спиной
    pts.push(cam.project(_mkc, { x: 0, y: 0 }));
  }

  const close = z.alt < 0.05;
  ctx.save();
  ctx.strokeStyle = close ? GREEN : 'rgba(79,179,224,0.75)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
    else ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  // Нить от кольца до корабля — она и показывает высоту как отрезок.
  _mk.x = gx; _mk.y = gy; _mk.z = gz;
  cam.toCamera(_mk, _mkc);
  if (_mkc.z > cam.near) {
    const gp = cam.project(_mkc, { x: 0, y: 0 });
    cam.toCamera(ship.pos, _mkc);
    if (_mkc.z > cam.near) {
      const sp = cam.project(_mkc, { x: 0, y: 0 });
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = close ? GREEN : CY_DIM;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gp.x, gp.y);
      ctx.lineTo(sp.x, sp.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '11px Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = close ? GREEN : '#9fd9ff';
      ctx.fillText(fmtDist(Math.max(0, z.alt)), (gp.x + sp.x) / 2 + 8, (gp.y + sp.y) / 2);
    }
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

// Подготовка данных для помощника стыковки (вызывается из main).
export function makeDockAssist(ship, station) {
  const q = dockingQuality(ship, station);
  const tr = station.basis.right;
  let err = Math.atan2(dot(tr, ship.basis.up), dot(tr, ship.basis.right));
  if (Math.abs(err) > Math.PI / 2) err -= Math.sign(err) * Math.PI;
  return { q, rollAngle: err, rollOk: q.roll > LIMITS.roll };
}
