// Приборная панель: прицел, тяга, корпус, форсаж, сканер, компас цели,
// маркер цели, помощник стыковки и квантовый привод.

import { v3, dot, clamp, normalize } from '../core/vec3.js';
import { SHIP } from '../game/ship.js';
import { QUANTUM } from '../game/quantum.js';
import { LIMITS, dockingQuality } from '../game/docking.js';
import { gearLabel, landedInfo, LAND } from '../game/landing.js';
import { SLOT, STATION_D } from '../models/station.js';
import { targetLabel } from '../game/nav.js';
import { gravityAt } from '../game/gravity.js';
import { altitudeOf, worldPoint } from '../game/surface.js';
import { dirToWorld } from '../core/basis.js';
import { CY, CY_DIM, AMBER, GREEN, RED } from './theme.js';
import {
  engineScreen, targetScreen, scopeScreen, commsScreen, systemsScreen,
} from './panels.js';

// Палитра и софт экранов кабины живут отдельно: их делят два вида —
// угловые панели от третьего лица (здесь) и мониторы приборной доски
// (js/ui/panels.js).
const TAU = Math.PI * 2;

const _sil = {};
// Кольцо отметки грунта: радиус и высота, выше которой её не рисуем.
const MARK_R = 0.030;      // км
const MARK_MAX = 1.5;      // км
const _mk = { x: 0, y: 0, z: 0 };
const _mkc = { x: 0, y: 0, z: 0 };
const _mkAlt = { dir: { x: 0, y: 0, z: 0 } };
// Ниже этой скорости указатель вектора не показываем: на месте он
// прыгал бы от шума в последних знаках.
const VMARK_MIN = 0.002;      // км/с
const _vm = { x: 0, y: 0 };
const _pt = { x: 0, y: 0 };
// Точки под приборы на доске кабины: та же экономия, что и везде —
// вектор на кадр это мусор в куче шестьдесят раз в секунду.
const _pw = { x: 0, y: 0, z: 0 };
const _p0 = { x: 0, y: 0 };
const _p1 = { x: 0, y: 0 };
const _p2 = { x: 0, y: 0 };
// Размер блока в пикселях. На экране кабины он растягивается на всю
// бухту (её размер приходит из js/models/cockpit.js), поэтому важны
// только ПРОПОРЦИИ: бухты под них и сделаны.

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
  const { ship, nav, state } = game;
  const q = game.quantum;
  const w = cam.w, h = cam.h;
  const target = nav.list[nav.index];

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // В прыжке приборов нет: смотреть на них некогда и не на что. Остаётся
  // то, что в прыжке вообще что-то значит, — остаток и скорость.
  if (q && q.phase === 'jump') {
    drawJumpPanel(ctx, w, h, q, state);
    drawFlash(ctx, w, h, q);
    ctx.restore();
    return;
  }

  // Стойки фонаря штрихами нужны только там, где кабины нет в кадре, —
  // на запасном пути Canvas-2D. С настоящей кабиной они бы двоились.
  if (state.view === 'cockpit' && !game.cockpit) drawCockpitFrame(ctx, w, h);
  drawReticle(ctx, cam, ship);
  drawVelocityMarker(ctx, cam, ship);
  // После удара корабль какое-то время летит сам по себе — об этом надо
  // сказать, иначе непонятно, почему он не слушается.
  if (ship.stun > 0) {
    ctx.textAlign = 'center';
    ctx.font = '13px Consolas, monospace';
    ctx.fillStyle = RED;
    ctx.fillText('БЕЗ УПРАВЛЕНИЯ', w / 2, h / 2 + 56);
  }
  // Все цели видны сразу — выбирать их наведением можно, только если
  // видно, куда наводиться. Выбранная рисуется поверх остальных своей
  // рамкой.
  drawTargetList(ctx, cam, game, target);
  drawAimedLabel(ctx, cam, game, target);
  if (target) drawTargetMarker(ctx, cam, target);

  // Приборы подхода включаются в гравитационном захвате и берут на себя
  // скорость, высоту, дистанцию и посадочные условия. Угловые панели
  // при этом ужимаются до того, чего в центре нет: тяга, форсаж, корпус,
  // имя цели с компасом. Дублировать одно и то же в двух местах хуже,
  // чем не показывать вовсе: глаз всё равно мечется между ними.
  const approach = !!(game.capture && state.mode === 'flight');

  // Приборы: от третьего лица — по углам экрана, в кабине — НА ДОСКЕ.
  // Рисует их один и тот же код: разница только в преобразовании
  // холста, которое ставит onPanel.
  const slots = state.view === 'cockpit' && game.cockpit ? game.cockpit.slots : null;
  const lh = approach ? 68 : 112;
  const th = approach ? 68 : 112;
  if (slots) {
    // В кабине приборы — это СОФТ В МОНИТОРАХ (js/ui/panels.js), а не
    // те же угловые панели, положенные на доску: у монитора есть корпус,
    // заголовок, сетка подложки и своя вёрстка. Размер блока в пикселях
    // выбран по пропорции бухты — растянется он на неё целиком.
    onPanel(ctx, cam, ship, slots.left, 260, 222,
      () => engineScreen(ctx, 260, 222, game));
    onPanel(ctx, cam, ship, slots.right, 340, 170,
      () => targetScreen(ctx, 340, 170, game, target));
    onPanel(ctx, cam, ship, slots.mid, 260, 260,
      () => scopeScreen(ctx, 260, 260, game));
    onPanel(ctx, cam, ship, slots.upLeft, 280, 175,
      () => commsScreen(ctx, 280, 175, game));
    onPanel(ctx, cam, ship, slots.upRight, 280, 175,
      () => systemsScreen(ctx, 280, 175, game));
  } else {
    drawThrustBlock(ctx, 18, h - lh - 20, game, approach);
    drawTargetBlock(ctx, w - 250, h - th - 20, game, approach, target, q);
    drawScanner(ctx, w / 2, h - 60, game);
  }

  // На грунте — кнопка вместо экрана поверх игры.
  if (state.mode === 'landed') drawLandedPrompt(ctx, cam, game);

  // --- приборы подхода, помощник стыковки ---
  if (approach) {
    drawGroundMark(ctx, cam, game);
    drawApproachPanel(ctx, w / 2, h / 2, w, h, game);
  }
  if (game.dockAssist) drawDockAssist(ctx, w / 2, 96, game.dockAssist);

  // --- сообщения ---
  // В кабине они уже стоят на верхнем левом табло (drawCommsBlock):
  // одно и то же в двух местах хуже, чем в одном.
  if (!slots) {
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
  }

  // Вспышка выхода рисуется и здесь: к этому моменту привод уже
  // выключен, и панель прыжка не работает.
  if (q) drawFlash(ctx, w, h, q);

  ctx.restore();
}

/**
 * Вспышка входа и выхода. Рисуется на приборном слое, а не в сцене:
 * это заливка всего кадра, и городить ради неё ещё один проход в GL
 * незачем.
 */
function drawFlash(ctx, w, h, q) {
  if (!(q.flash > 0.002)) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(214,238,255,' + (q.flash * q.flash * 0.8).toFixed(3) + ')';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Приборы в прыжке. Их намеренно почти нет: управления в прыжке нет
 * тоже, а всё, что можно сделать, — дождаться выхода или сорвать его.
 * Поэтому на экране только то, что в эти секунды меняется.
 */
function drawJumpPanel(ctx, w, h, q, state) {
  const cx = w / 2, cy = h / 2;
  // Виньетка: края кадра гаснут в синеву. Тоннель в сцене аддитивный,
  // темнить им нечем, а без затемнения по краям он читается как
  // наложенная картинка, а не как стены вокруг корабля.
  const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.12,
    cx, cy, Math.max(w, h) * 0.62);
  g.addColorStop(0, 'rgba(4,14,30,0)');
  g.addColorStop(1, 'rgba(4,14,30,0.78)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = 'center';

  ctx.font = '11px Consolas, monospace';
  ctx.fillStyle = CY;
  ctx.fillText('КВАНТОВЫЙ ПРЫЖОК · ' + (q.target ? q.target.name : '—'), cx, 40);

  ctx.font = '28px Consolas, monospace';
  ctx.fillStyle = '#d8f2ff';
  ctx.fillText(fmtDist(q.dist), cx, h - 96);

  ctx.font = '14px Consolas, monospace';
  ctx.fillStyle = AMBER;
  ctx.fillText(fmtSpeed(q.speed), cx, h - 72);

  // Полоса скорости: по ней видно, что привод ещё разгоняется или уже
  // тормозит, — само число на десятках тысяч читается плохо.
  const bw = clamp(w * 0.25, 160, 380);
  bar(ctx, cx - bw / 2, h - 60, bw, 5, q.speed / QUANTUM.speed, CY);

  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = CY_DIM;
  ctx.fillText('B — СОРВАТЬ ПРЫЖОК', cx, h - 40);

  // Сообщения в прыжке всё же нужны: ими говорится о срыве.
  ctx.textAlign = 'left';
  ctx.font = '12px Consolas, monospace';
  let my = 26;
  for (const m of state.messages) {
    ctx.globalAlpha = clamp(m.t, 0, 1);
    ctx.fillStyle = m.color || AMBER;
    ctx.fillText(m.text, 20, my);
    my += 16;
    ctx.globalAlpha = 1;
  }
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
  const { ship } = game;
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

  stat(left, rowY[0], 'left', 'СКОРОСТЬ', fmtSpeed(ship.speed), '#d8f2ff', 16);
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

/**
 * Приборы НА ДОСКЕ: блок, нарисованный в своих пикселях, кладётся на
 * плоскость приборной доски кабины.
 *
 * Зачем не просто нарисовать те же панели по углам экрана. В кокпите
 * доска — настоящая геометрия (js/models/cockpit.js), и показания,
 * висящие поверх неё ровным прямоугольником, сразу читаются как
 * наклейка: голова поворачивается, доска уезжает, а цифры стоят.
 * Здесь вместо этого берутся три точки самой доски — её центр и две
 * оси, — проецируются на экран, и по ним строится преобразование
 * холста. Дальше блок рисуется теми же вызовами, что и от третьего
 * лица, но ложится на доску вместе с её наклоном и перспективой.
 *
 * Приближение здесь одно: внутри блока перспектива считается линейной.
 * На куске доски в четверть метра разница меньше пикселя.
 *
 * @returns false, если доска ушла за спину — рисовать нечего.
 */
function onPanel(ctx, cam, ship, slot, bw, bh, draw) {
  if (!slot) return false;
  const b = ship.basis;
  // Блок растягивается на бухту целиком: по ширине — по её ширине, по
  // высоте — по её высоте. Пропорции блоков под бухты и подобраны.
  const sx = slot.w / bw, sy = slot.h / bh;                      // километров доски на пиксель блока
  const put = (kx, ky, out) => {
    // Точка доски в осях корабля -> направление в мире -> экран.
    const p = slot.pos, r = slot.right, u = slot.up;
    const lx = p.x + r.x * kx + u.x * ky;
    const ly = p.y + r.y * kx + u.y * ky;
    const lz = p.z + r.z * kx + u.z * ky;
    dirToWorld(b, { x: lx, y: ly, z: lz }, _pw);
    // projectDir ждёт ЕДИНИЧНОЕ направление: у него внутри есть подпорка
    // z снизу (0.02), рассчитанная на длину 1. Точка доски — это метры,
    // то есть тысячные километра, и без нормировки подпорка съела бы всю
    // перспективу, схлопнув приборы в точку у центра кадра.
    const L = Math.hypot(_pw.x, _pw.y, _pw.z) || 1;
    return projectDir(cam, _pw.x / L, _pw.y / L, _pw.z / L, out);
  };
  const c = put(0, 0, _p0);
  if (c.back) return false;
  const ex = put(sx * bw * 0.5, 0, _p1);
  const ey = put(0, -sy * bh * 0.5, _p2);
  if (ex.back || ey.back) return false;
  const ax = (ex.x - c.x) / (bw * 0.5), ay = (ex.y - c.y) / (bw * 0.5);
  const cx = (ey.x - c.x) / (bh * 0.5), cy = (ey.y - c.y) / (bh * 0.5);
  // Доска почти в профиль: блок вырождается в полоску, читать нечего.
  if (Math.abs(ax * cy - ay * cx) < 0.02) return false;

  ctx.save();
  ctx.transform(ax, ay, cx, cy, c.x - (bw * 0.5) * ax - (bh * 0.5) * cx,
    c.y - (bw * 0.5) * ay - (bh * 0.5) * cy);
  draw();
  ctx.restore();
  return true;
}

/** Левый блок: тяга, скорость, форсаж, корпус, шасси. */
function drawThrustBlock(ctx, px, py, game, approach) {
  const ship = game.ship;
  const lh = approach ? 68 : 112;
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
    ctx.fillText(fmtSpeed(ship.speed), px + 10, py + 70);
    ctx.font = '10px Consolas, monospace';
  }
  // Форсаж: цвет говорит о состоянии — жгут, заперт до перезарядки,
  // накопилось, копится. Смотреть на длину полоски в манёвре некогда.
  const boostY = approach ? py + 48 : py + 88;
  ctx.fillStyle = ship.boosting ? AMBER
    : (ship.boostLock ? RED : (ship.boost > 0.999 ? CY : CY_DIM));
  ctx.fillText('ФОРСАЖ', px + 10, boostY);
  bar(ctx, px + 58, boostY - 7, 64, 7, ship.boost,
    ship.boosting ? AMBER : (ship.boostLock ? RED : CY));
  ctx.fillStyle = CY_DIM;
  ctx.fillText('КОРПУС', px + 10, boostY + 14);
  bar(ctx, px + 58, boostY + 7, 64, 7, ship.hull / SHIP.maxHull,
    ship.hull > 40 ? GREEN : RED);

  // Шасси: строкой над панелью. У поверхности его состояние стоит в
  // приборах подхода отдельной клеткой, и здесь оно уже лишнее.
  if ((ship.gear.t > 0.005 || ship.gear.out) && !(approach && game.landInfo)) {
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = ship.gear.out && ship.gear.t >= 0.995 ? GREEN : AMBER;
    ctx.fillText(gearLabel(ship), px, py - 8);
  }
}

/** Правый блок: цель, дистанция, состояние привода, компас. */
function drawTargetBlock(ctx, tx, ty, game, approach, target, q) {
  const ship = game.ship;
  const th = approach ? 68 : 112;
  panel(ctx, tx, ty, 232, th);
  ctx.font = '10px Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = CY_DIM;
  ctx.fillText('ЦЕЛЬ', tx + 10, ty + 18);
  ctx.font = '13px Consolas, monospace';
  ctx.fillStyle = AMBER;
  ctx.fillText(targetLabel(target).slice(0, 24), tx + 10, ty + 36);

  if (!game.info) return;
  ctx.font = '11px Consolas, monospace';
  if (!approach) {
    ctx.fillStyle = '#9fd9ff';
    ctx.fillText('ДИСТ  ' + fmtDist(game.info.gap), tx + 10, ty + 56);
    ctx.fillText('ETA   ' + fmtTime(game.info.eta), tx + 10, ty + 72);
  }
  const stateY = approach ? ty + 58 : ty + 90;
  if (q && q.phase === 'calib') {
    // Калибровка: полоса и прямая подсказка, чего привод ждёт. Без
    // подсказки «почему не стартует» — самый частый вопрос к нему.
    ctx.fillStyle = q.aligned ? GREEN : AMBER;
    ctx.fillText(q.aligned ? 'КАЛИБРОВКА' : 'НАВЕДИСЬ НА ЦЕЛЬ', tx + 10, stateY);
    bar(ctx, tx + 10, stateY + 4, 120, 6, q.calib, q.aligned ? GREEN : AMBER);
  } else if (ship.docking) {
    ctx.fillStyle = GREEN;
    ctx.fillText('ДОКИНГ', tx + 10, stateY);
  }
  drawCompass(ctx, tx + 178, ty + th / 2, approach ? 24 : 34, ship, game.info.dir);
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

// Прицел стоит там, КУДА СМОТРИТ НОС, а не в середине кадра. Разница
// появляется только в виде из-за спины: камера догоняет корабль с
// запаздыванием, и на развороте нос уходит из центра — по тому, как
// далеко он ушёл, и читается разворот.
/**
 * Кнопка на грунте: зафиксировать корабль или взлететь.
 *
 * Экрана поверх игры на посадке больше нет — он выбрасывал игрока из
 * кадра ровно в тот момент, ради которого всё и затевалось. Вместо него
 * одна кнопка, и два действия разведены ВРЕМЕНЕМ: коротко нажал —
 * зафиксировал стойки и заглушил движки, подержал три секунды —
 * оторвался. Полоса заполнения показывает, сколько ещё держать: без неё
 * удержание — это игра в угадайку.
 */
function drawLandedPrompt(ctx, cam, game) {
  const ship = game.ship;
  const t = clamp((game.landHold || 0) / LAND.holdOff, 0, 1);
  const w = 300, h = 52;
  const x = cam.cx - w / 2, y = cam.h - 172;

  // Корпус кнопки и полоса удержания под ним.
  ctx.save();
  ctx.fillStyle = 'rgba(2,12,20,0.78)';
  ctx.fillRect(x, y, w, h);
  if (t > 0) {
    ctx.fillStyle = 'rgba(255,204,102,0.22)';
    ctx.fillRect(x, y, w * t, h);
  }
  ctx.strokeStyle = t > 0 ? AMBER : (ship.secured ? GREEN : CY);
  ctx.lineWidth = t > 0 ? 2 : 1;
  ctx.strokeRect(x, y, w, h);

  ctx.textAlign = 'center';
  const mid = x + w / 2;

  // Строка над кнопкой — то, что раньше было в экране посадки: где
  // именно сел и какой высоты площадка.
  const info = landedInfo(ship);
  if (info) {
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = 'rgba(159,217,230,0.7)';
    const hemi = info.lat >= 0 ? 'с.ш.' : 'ю.ш.';
    ctx.fillText(
      `${info.body.name.toUpperCase()} · ${Math.abs(info.lat).toFixed(2)}° ${hemi}, ` +
      `${info.lon.toFixed(2)}° · ПЛОЩАДКА ${fmtDist(info.height)} · ` +
      `ПОСАДОК ${game.stats ? game.stats.landings || 0 : 0}`,
      mid, y - 8);
  }

  if (t > 0) {
    ctx.font = 'bold 15px Consolas, monospace';
    ctx.fillStyle = AMBER;
    ctx.fillText(t >= 1 ? 'ОТРЫВ' : 'ВЗЛЁТ', mid, y + 22);
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = '#d8f2ff';
    ctx.fillText(t >= 1 ? 'ДЕРЖИТЕСЬ' :
      'ДЕРЖАТЬ ЕЩЁ ' + ((1 - t) * LAND.holdOff).toFixed(1) + ' с', mid, y + 40);
  } else if (ship.secured) {
    ctx.font = 'bold 14px Consolas, monospace';
    ctx.fillStyle = GREEN;
    ctx.fillText('НА ГРУНТЕ · ДВИГАТЕЛИ ОТКЛЮЧЕНЫ', mid, y + 22);
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = 'rgba(159,217,230,0.8)';
    ctx.fillText('УДЕРЖАТЬ ПРОБЕЛ ' + LAND.holdOff + ' с — ВЗЛЁТ', mid, y + 40);
  } else {
    ctx.font = 'bold 15px Consolas, monospace';
    ctx.fillStyle = CY;
    ctx.fillText('ГОТОВ К ПОСАДКЕ', mid, y + 22);
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = 'rgba(159,217,230,0.8)';
    ctx.fillText('ПРОБЕЛ — ЗАФИКСИРОВАТЬ · УДЕРЖАТЬ — ВЗЛЁТ', mid, y + 40);
  }
  ctx.restore();
}

function drawReticle(ctx, cam, ship) {
  const p = projectDir(cam, ship.basis.fwd.x, ship.basis.fwd.y, ship.basis.fwd.z, _pt);
  // Нос за спиной у камеры (осмотр мышью) — прицела нет.
  if (p.back) return;
  const x = clamp(p.x, 24, cam.w - 24), y = clamp(p.y, 24, cam.h - 24);
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

/**
 * Куда корабль ЛЕТИТ на самом деле — в экранных координатах.
 *
 * Прицел в центре показывает, куда смотрит нос. С векторной скоростью это
 * уже не одно и то же: на развороте корабль несёт по старому курсу, и без
 * второй отметки понять, куда он движется, нельзя. В авиации это называется
 * указателем вектора скорости и висит ровно на той точке горизонта, в
 * которую машина придёт, если ничего не менять.
 *
 * @returns {x, y, back, speed} или null, если скорость слишком мала.
 *          back = скорость направлена НАЗАД от камеры: тогда точка на
 *          экране — это направление «откуда», и рисуется она иначе.
 */
export function velocityMarker(cam, vel, out = { x: 0, y: 0 }) {
  const sp = Math.hypot(vel.x, vel.y, vel.z);
  if (sp < VMARK_MIN) return null;
  projectDir(cam, vel.x / sp, vel.y / sp, vel.z / sp, out);
  out.speed = sp;
  return out;
}

/**
 * Единичное направление — в экранные координаты.
 *
 * Тем же считается и прицел: с камерой из-за спины, которая догоняет
 * корабль с запаздыванием, «куда смотрит нос» перестало совпадать с
 * серединой кадра, и рисовать прицел по центру стало враньём.
 */
export function projectDir(cam, dx, dy, dz, out = { x: 0, y: 0 }) {
  const b = cam.basis;
  const rx = dx * b.right.x + dy * b.right.y + dz * b.right.z;
  const uy = dx * b.up.x + dy * b.up.y + dz * b.up.z;
  const fz = dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z;

  // Направление назад: проецируем противоположное, иначе точка улетает
  // в бесконечность и знак путается.
  const back = fz <= 0;
  const s = back ? -1 : 1;
  const z = Math.max(0.02, s * fz);          // у самого горизонта не делим на ноль
  out.x = cam.cx + (s * rx / z) * cam.focal;
  out.y = cam.cy - (s * uy / z) * cam.focal;
  out.back = back;
  return out;
}

// Отметка вектора скорости: кружок с тремя усами, как на авиационном ИЛС.
// Назад — тот же знак, перечёркнутый: «летим отсюда».
function drawVelocityMarker(ctx, cam, ship) {
  const m = velocityMarker(cam, ship.vel, _vm);
  if (!m) return;
  const pad = 26;
  const x = clamp(m.x, pad, cam.w - pad);
  const y = clamp(m.y, pad, cam.h - pad);
  const edge = x !== m.x || y !== m.y;       // отметка ушла за край экрана

  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = m.back ? RED : (edge ? 'rgba(120,224,143,0.5)' : GREEN);
  const r = 7;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.moveTo(x - r, y); ctx.lineTo(x - r - 7, y);
  ctx.moveTo(x + r, y); ctx.lineTo(x + r + 7, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y - r - 7);
  ctx.stroke();
  if (m.back) {
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5);
    ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Метки всех целей, попавших в кадр.
 *
 * Без них выбор наведением не работает: нос наводить не на что, если
 * цель — точка в пустоте или луна в пиксель размером. Поэтому у каждой
 * рисуется значок, а имя — только у того, на что нос наведён сейчас, и
 * у ближайших к прицелу: подписать всё разом значит закрыть подписями
 * полкадра.
 *
 * Значки разные по смыслу, а не для красоты: у тел кружок (у них есть
 * размер), у станций квадрат, у орбитальных маркеров косой крест —
 * точка в пустоте, за которую не зацепишься.
 *
 * Каждый значок рисуется ДВАЖДЫ: сначала тёмной широкой линией, потом
 * своей. Без подложки метка теряется — она тонкая и того же порядка
 * яркости, что звёзды и подсвеченный край планеты, а искать её глазами
 * приходится именно на этом фоне.
 */
function drawTargetList(ctx, cam, game, target) {
  const nav = game.nav;
  if (!nav || !nav.list) return;
  const aimed = game.aimed || null;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const t of nav.list) {
    if (t === target) continue;              // у выбранной своя рамка
    const c = cam.toCamera(t.pos);
    if (c.z <= cam.near) continue;           // за спиной
    const p = cam.project(c, _pt);
    if (p.x < 8 || p.x > cam.w - 8 || p.y < 8 || p.y > cam.h - 8) continue;
    const hot = t === aimed;
    const r = hot ? 7 : 5.5;

    const shape = () => {
      ctx.beginPath();
      if (t.isStation) ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
      else if (t.isMarker) {
        ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y + r);
        ctx.moveTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r);
      } else ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
    };

    // Подложка.
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = hot ? 4.5 : 3.5;
    shape();
    // Сама метка.
    ctx.strokeStyle = hot ? '#ffffff' : CY;
    ctx.lineWidth = hot ? 2 : 1.4;
    shape();

    if (hot) {
      // Наведённая цель обведена ещё раз: сам значок мелкий, а решение
      // «эту и выберу» принимается по нему.
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, TAU); ctx.stroke();
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, TAU); ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Имя того, на что наведён нос, — в ПОСТОЯННОМ месте под приборами.
 *
 * Подпись у самого значка была бы удобнее, да только значок наведённой
 * цели по определению стоит у прицела, а середина кадра обязана
 * оставаться пустой: приборы не закрывают то, во что целятся. Заодно
 * строка не прыгает по экрану вслед за целью.
 */
function drawAimedLabel(ctx, cam, game, target) {
  const t = game.aimed;
  if (!t || t === target) return;
  const bh = Math.min(Math.max(cam.h * 0.13, 92), 160);
  ctx.save();
  ctx.font = '12px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Та же подложка, что у значков: строка стоит поверх звёздного неба.
  const line = (text, y, color) => {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(text, cam.cx, y);
    ctx.fillStyle = color;
    ctx.fillText(text, cam.cx, y);
  };
  line(targetLabel(t) + '   ' + fmtDist(dist3(cam.pos, t.pos)), cam.cy + bh + 84, '#ffffff');
  line('TAB — ВЫБРАТЬ ЦЕЛЬ', cam.cy + bh + 100, AMBER);
  ctx.restore();
}

const dist3 = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

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
