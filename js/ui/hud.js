// Приборная панель: прицел, тяга, корпус, форсаж, сканер, компас цели,
// маркер цели, помощник стыковки и квантовый привод.

import { v3, dot, clamp, normalize } from '../core/vec3.js';
import { SHIP } from '../game/ship.js';
import { QUANTUM } from '../game/quantum.js';
import { warpDistance, offWarpAxis, warpAxis } from '../game/warp.js';
import { LIMITS, dockingQuality } from '../game/docking.js';
import { gearLabel, landedInfo, LAND } from '../game/landing.js';
import { SLOT } from '../models/stations.js';
import { targetLabel, targetKind } from '../game/nav.js';
import { gravityAt } from '../game/gravity.js';
import { altitudeOf, worldPoint } from '../game/surface.js';
import { dirToWorld } from '../core/basis.js';
import { CY, CY_DIM, AMBER, GREEN, RED, PEER, INK } from './theme.js';
import { Q } from '../core/quality.js';
import { L, numLocale } from '../core/lang.js';
import {
  engineScreen, targetScreen, scopeScreen, commsScreen, systemsScreen,
} from './panels.js';

// Палитра и софт экранов кабины живут отдельно: их делят два вида —
// угловые панели от третьего лица (здесь) и мониторы приборной доски
// (js/ui/panels.js).
const TAU = Math.PI * 2;

// Размеры угловых панелей в СВОИХ пикселях: на экран они попадают через
// ctx.scale(Q.hudScale). Вынесены наверх, потому что их знают двое —
// сама панель и тот, кто прижимает её к углу кадра (drawHud).
// Ширина левой колонки и правой карточки в СВОИХ пикселях: на экран они
// попадают через ctx.scale(Q.hudScale). Высота колонки не задана — она
// считается по тому, что в ней сейчас есть, и растёт вверх от нижнего
// края кадра.
const COL_W = 210;
const CARD_W = 268, CARD_H = 132;

/**
 * Кегль прибора в пикселях ЭКРАНА.
 *
 * Приборы растут вместе с экраном (Q.hudScale): на мониторе в 2556 точек
 * подпись в девять пикселей — это сыпь, а не прибор. Помощник нужен
 * потому, что размер написан в двадцати местах, и «поправить кегль»
 * означало бы двадцать правок и одну забытую.
 *
 * Внутри угловых панелей его звать НЕ НАДО: они рисуются в своих
 * пикселях под ctx.scale (см. corner в drawHud), и масштаб там уже
 * учтён — второй раз он дал бы квадрат.
 */
const fnt = (size, weight = '') => (weight ? weight + ' ' : '')
  + (size * Q.hudScale).toFixed(1) + 'px Consolas, monospace';

/** Длина в пикселях экрана: отступы и радиусы растут вместе с кеглем. */
const sc = (n) => n * Q.hudScale;

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
const _pp = { x: 0, y: 0 };
const _ga = { x: 0, y: 0 };
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
  if (km < 1) return (km * 1000).toFixed(0) + L(' м');
  if (km < 1000) return km.toFixed(1) + L(' км');
  if (km < 1e6) return Math.round(km).toLocaleString(numLocale()) + L(' км');
  return (km / 1e6).toFixed(2) + L(' млн км');
};

export const fmtTime = (s) => {
  if (!isFinite(s)) return '—';
  if (s < 90) return Math.ceil(s) + L(' с');
  // Секунды округляются ДО деления на минуты, иначе на 29 мин 59.6 с
  // выходит «29 мин 60 с»: минуты берутся от неокруглённого времени, а
  // остаток округляется до полной минуты. Поймано на сроке задания.
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  if (m < 60) return m + L(' мин ') + (total - m * 60) + L(' с');
  return Math.floor(m / 60) + L(' ч ') + (m % 60) + L(' мин');
};

export const fmtSpeed = (kms) => {
  if (kms < 10) return kms.toFixed(2) + L(' км/с');
  if (kms < 1000) return kms.toFixed(0) + L(' км/с');
  return (kms / 1000).toFixed(1) + L(' тыс. км/с');
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

/**
 * Шкала ОТРЕЗКАМИ, а не сплошной заливкой.
 *
 * Сплошная полоса — это индикатор загрузки из браузера: чтобы понять по
 * ней «сколько осталось», глаз должен измерить длину. Десять отрезков
 * считаются мгновенно и боковым зрением, потому что их можно
 * пересчитать, а не измерить. Ровно поэтому так сделаны приборы в
 * кабинах: топливо, заряд, ресурс.
 */
const segments = (ctx, x, y, w, h, frac, color, n = 10) => {
  const gap = Math.max(1, w * 0.012);
  const sw = (w - gap * (n - 1)) / n;
  const lit = clamp(frac, 0, 1) * n;
  for (let i = 0; i < n; i++) {
    const sx = x + i * (sw + gap);
    const part = clamp(lit - i, 0, 1);
    ctx.fillStyle = 'rgba(79,179,224,0.16)';
    ctx.fillRect(sx, y, sw, h);
    if (part > 0) {
      ctx.fillStyle = color;
      ctx.fillRect(sx, y, sw * part, h);
    }
  }
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

  // Связь показывается ДО всех проверок режима: в варпе и в прыжке
  // приборов нет, а сеть там ломается ровно так же.
  drawLink(ctx, game);

  // В варпе приборов нет по той же причине, что и в квантовом прыжке, и
  // ещё по одной: системы, к которой они относились бы, в этот момент
  // просто не существует.
  if (game.warp && game.warp.phase === 'tunnel') {
    drawWarpPanel(ctx, w, h, game.warp, state);
    ctx.restore();
    return;
  }

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
  drawWarpAim(ctx, cam, game);
  // После удара корабль какое-то время летит сам по себе — об этом надо
  // сказать, иначе непонятно, почему он не слушается.
  if (ship.stun > 0) {
    ctx.textAlign = 'center';
    ctx.font = fnt(15, 'bold');
    ctx.fillStyle = RED;
    ctx.fillText(L('БЕЗ УПРАВЛЕНИЯ'), w / 2, h / 2 + sc(56));
  }
  // Все цели видны сразу — выбирать их наведением можно, только если
  // видно, куда наводиться. Выбранная рисуется поверх остальных своей
  // рамкой.
  drawTargetList(ctx, cam, game, target);
  drawPeerMarks(ctx, cam, game);
  drawGunAim(ctx, cam, game);
  drawAimedLabel(ctx, cam, game, target);
  if (target) drawTargetMarker(ctx, cam, target);

  // Приборы подхода включаются в гравитационном захвате и берут на себя
  // скорость, высоту, дистанцию и посадочные условия. Угловые панели
  // при этом ужимаются до того, чего в центре нет: тяга, форсаж, корпус,
  // имя цели с компасом. Дублировать одно и то же в двух местах хуже,
  // чем не показывать вовсе: глаз всё равно мечется между ними.
  // Приборы подхода — это ДОБАВКА к углам, а не замена им. Раньше углы
  // на подходе ужимались, а их содержимое переезжало в центр: ход
  // оказывался то слева внизу, то посреди экрана, и глазу негде было
  // закрепиться. Теперь панели стоят на месте всегда.
  const approach = !!(game.capture && state.mode === 'flight');

  // Приборы: от третьего лица — по углам экрана, в кабине — НА ДОСКЕ.
  // Рисует их один и тот же код: разница только в преобразовании
  // холста, которое ставит onPanel.
  const slots = state.view === 'cockpit' && game.cockpit ? game.cockpit.slots : null;
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
    // Угловые панели рисуются в своих пикселях и ПРИЖИМАЮТСЯ к углам
    // через преобразование холста. Масштаб берётся из профиля
    // устройства: на телефоне в горизонте всего 393 точки высоты, и
    // панель в 112 пикселей занимала бы треть кадра (js/core/quality.js).
    const k = Q.hudScale;
    const corner = (x, y, draw) => {
      ctx.save();
      ctx.translate(x, y);
      if (k !== 1) ctx.scale(k, k);
      draw();
      ctx.restore();
    };
    // Колонка растёт ВВЕРХ от нижнего края, поэтому ей даётся точка низа,
    // а не верха: её высота зависит от того, что в ней сейчас есть.
    corner(22, h - 22, () => drawShipColumn(ctx, 0, 0, game, approach));
    corner(w - 22 - CARD_W * k, h - CARD_H * k - 22,
      () => drawTargetCard(ctx, 0, 0, game, target, q));
    corner(w / 2, h - 78 * k, () => drawScanner(ctx, 0, 0, game));
  }

  // На грунте — кнопка вместо экрана поверх игры.
  if (state.mode === 'landed') drawLandedPrompt(ctx, cam, game);

  // --- приборы подхода, помощник стыковки ---
  //
  // ПОД ПРИЦЕЛОМ ВСЕГДА ОДИН ПРИБОР. Стыковка и подход к грунту — разные
  // дела, и вместе они не случаются: если станция в шести километрах,
  // пилот ведёт корабль в створ, а не выбирает площадку. Показывать оба
  // значит заставлять выбирать глазами, на какой смотреть.
  //
  // Помощник стыковки стоял в самом верху кадра, у края. Створ при этом
  // в середине — то есть смотреть приходилось попеременно то туда, то
  // сюда. Теперь он там же, где остальные приборы подхода.
  //
  // Приборы подхода переехали в ЛЕВУЮ КОЛОНКУ (drawShipColumn): высота,
  // вертикальная скорость и тяжесть — это про нас, а не про прицел, и
  // место посреди кадра им ни к чему. Тем более что в виде от третьего
  // лица низ середины занимает сам корабль, и полоса ложилась прямо на
  // корпус.
  //
  // В центре остаётся только то, что читается ВМЕСТЕ С ПРИЦЕЛОМ: отметка
  // грунта под кораблём и створ порта. Створ — НАД прицелом, по той же
  // причине: под ним корпус.
  if (approach) drawGroundMark(ctx, cam, game);
  if (game.dockAssist) drawDockAssist(ctx, w / 2, h / 2 - sc(150), game.dockAssist);

  // --- сообщения ---
  // В кабине они уже стоят на верхнем левом табло (drawCommsBlock):
  // одно и то же в двух местах хуже, чем в одном.
  if (!slots) {
    ctx.font = fnt(13);
    ctx.textAlign = 'left';
    let my = sc(30) + 18;
    for (const m of state.messages) {
      ctx.globalAlpha = clamp(m.t, 0, 1);
      // Подложка: сообщения стоят на небе и на подсвеченном крае планеты,
      // и без неё светлая строка на светлом фоне пропадает целиком.
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(m.text, 20, my);
      ctx.fillStyle = m.color || AMBER;
      ctx.fillText(m.text, 20, my);
      my += sc(18);
      ctx.globalAlpha = 1;
    }

    if (game.statusLine) {
      ctx.textAlign = 'center';
      ctx.font = fnt(13);
      ctx.fillStyle = GREEN;
      ctx.fillText(game.statusLine, w / 2, h - sc(148));
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
/**
 * Приборы варп-прыжка: отдельная панель на всё окно.
 *
 * Здесь нет ни дистанции, ни цели под прицелом, и это не упущение.
 * Координат во время прыжка не существует: половину тоннеля старой
 * системы уже нет в памяти, а новая ещё собирается. Единственное, что в
 * этот момент правда, — сколько осталось лететь и куда.
 */
function drawWarpPanel(ctx, w, h, warp, state) {
  const cx = w / 2, cy = h / 2;
  const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.10,
    cx, cy, Math.max(w, h) * 0.66);
  g.addColorStop(0, 'rgba(6,4,26,0)');
  g.addColorStop(1, 'rgba(6,4,26,0.72)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = 'center';
  ctx.font = '11px Consolas, monospace';
  ctx.fillStyle = '#c9a8ff';
  ctx.fillText(L('ВАРП · ') + (warp.from ? warp.from.name.toUpperCase() : '—') +
    ' → ' + (warp.to ? warp.to.name.toUpperCase() : '—'), cx, 40);

  const left = Math.max(0, warp.total - warp.t);
  ctx.font = '30px Consolas, monospace';
  ctx.fillStyle = '#e8dcff';
  ctx.fillText(left.toFixed(1) + L(' С'), cx, h - 96);

  ctx.font = '12px Consolas, monospace';
  ctx.fillStyle = AMBER;
  ctx.fillText(warpDistance(warp).toFixed(1) + L(' СВЕТОВЫХ ЛЕТ'), cx, h - 72);

  const bw = clamp(w * 0.25, 160, 380);
  bar(ctx, cx - bw / 2, h - 60, bw, 5,
    warp.total > 0 ? warp.t / warp.total : 0, '#a98cff');

  // Смена системы — единственное событие внутри тоннеля, и о нём стоит
  // сказать прямо: иначе полминуты выглядят как зависание.
  ctx.font = '11px Consolas, monospace';
  ctx.fillStyle = warp.handed ? GREEN : 'rgba(201,168,255,0.75)';
  ctx.fillText(warp.handed ? L('СИСТЕМА ЗАГРУЖЕНА') : L('ВЫГРУЗКА СИСТЕМЫ'), cx, h - 40);

  // Сообщения в тоннеле нужны: ими говорится о смене системы.
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
 * Центровка варпа: куда повернуть нос. Без этой отметки прыжок
 * невозможен вообще — направление на другую систему ничем в кадре не
 * обозначено, там просто звёзды.
 */
/**
 * Отметка цели варпа: куда доворачивать нос.
 *
 * Рисуется С МОМЕНТА ВЫБОРА системы на карте галактики, а не с нажатия
 * J. Раньше выбранная система нигде на экране не значилась, и порядок
 * был такой: выбрал на карте, вышел, нажал J, и только тогда появлялось,
 * куда наводиться. То есть J приходилось нажимать вслепую. Теперь метка
 * стоит сразу, а J — это уже «поехали», как и у квантового привода.
 */
function drawWarpAim(ctx, cam, game) {
  const warp = game.warp;
  const aligning = !!(warp && warp.phase === 'align' && warp.dir);
  const to = aligning ? warp.to : game.warpTarget;
  if (!to || (warp && warp.phase === 'tunnel')) return;
  // До нажатия оси прыжка ещё нет — считаем её от системы к системе тем
  // же вызовом, которым её посчитает сам привод.
  const dir = aligning ? warp.dir : warpAxis(game.sys, to, _warpDir);
  const p = projectDir(cam, dir.x, dir.y, dir.z, _warpPt);
  const cx = cam.w / 2, cy = cam.h / 2;
  const pad = 34;
  let x = clamp(p.x, pad, cam.w - pad);
  let y = clamp(p.y, pad, cam.h - pad);

  // ТО, ЧТО БЫЛО СЛОМАНО: projectDir для направления ЗА СПИНОЙ возвращает
  // зеркальную точку — она оказывается спереди. Цель позади давала кольцо
  // ровно в середине кадра, игрок наводился на него и держал сколько
  // угодно: привод честно видел промах в 174°, а отметка показывала
  // «точно в цель». Разворачиваем точку обратно и отодвигаем к краю: в
  // кадре по-прежнему ОДНА отметка, и она всегда показывает, куда
  // доворачивать.
  if (p.back) {
    let dx = cx - p.x, dy = cy - p.y;
    let len2d = Math.hypot(dx, dy);
    // Цель РОВНО за спиной: зеркальная точка приходится в самую середину,
    // и направления доворота из неё не вывести — оно любое. Тогда отметка
    // ставится вверх: «разворачивайся», а куда именно, неважно.
    if (len2d < 1e-3) { dx = 0; dy = -1; len2d = 1; }
    const edge = Math.min(cam.w, cam.h) * 0.40;
    x = cx + (dx / len2d) * edge;
    y = cy + (dy / len2d) * edge;
  }
  // До запуска привода метка приглушена: она пока говорит «вот куда
  // лететь», а не «держи нос». Зелёная — только когда привод уже считает
  // калибровку и нос в допуске.
  const col = !aligning ? '#8f7fd0' : (warp.aligned ? GREEN : '#c9a8ff');
  const R = sc(13);

  ctx.save();
  ctx.strokeStyle = col;
  ctx.lineWidth = aligning ? 2 : 1.5;
  // Кольцо с лучами: непохоже ни на прицел, ни на рамку цели — в кадре и
  // так две отметки, и третья обязана читаться с первого взгляда.
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * R * 1.25, y + Math.sin(a) * R * 1.25);
    ctx.lineTo(x + Math.cos(a) * R * 1.8, y + Math.sin(a) * R * 1.8);
    ctx.stroke();
  }
  ctx.font = fnt(13, 'bold');
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  const name = to.name.toUpperCase();
  ctx.strokeText(name, x, y - R - sc(10));
  ctx.fillStyle = col;
  ctx.fillText(name, x, y - R - sc(10));
  ctx.restore();

  // До запуска — только название и подсказка клавишей: цифра промаха
  // здесь ещё ничего не значит, наводиться пока не требуется.
  if (!aligning) {
    ctx.textAlign = 'center';
    ctx.font = fnt(13);
    ctx.fillStyle = '#c9a8ff';
    ctx.fillText(L('ЦЕЛЬ ВАРПА · J — ПРЫЖОК'), cam.w / 2, cam.h - sc(118));
    return;
  }

  ctx.textAlign = 'center';
  ctx.font = fnt(13);
  ctx.fillStyle = col;
  // Промах числом: отметка говорит КУДА, число — СКОЛЬКО ещё. Без него
  // «почти навёлся» и «ровно наоборот» выглядят на экране одинаково.
  const miss = offWarpAxis(game.ship, warp.from, warp.to) * 57.2958;
  ctx.fillText(warp.aligned
    ? L('ВАРП: РАСКРУТКА')
    : L('ВАРП: СОВМЕСТИ НОС С ОТМЕТКОЙ · МИМО ') + miss.toFixed(0) + '°',
    cam.w / 2, cam.h - 118);
  const bw = clamp(cam.w * 0.2, sc(140), sc(300));
  bar(ctx, cam.w / 2 - bw / 2, cam.h - sc(112), bw, sc(7), warp.calib, col);
}

const _warpPt = { x: 0, y: 0 };
const _warpDir = { x: 0, y: 0, z: 0 };

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
  ctx.fillText(L('КВАНТОВЫЙ ПРЫЖОК · ') + (q.target ? q.target.name : '—'), cx, 40);

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
  ctx.fillText(L('B — СОРВАТЬ ПРЫЖОК'), cx, h - 40);

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
    const ln = Math.hypot(_pw.x, _pw.y, _pw.z) || 1;
    return projectDir(cam, _pw.x / ln, _pw.y / ln, _pw.z / ln, out);
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

/** Левый блок: тяга, скорость, форсаж, корпус, щит, шасси. */
/**
 * ЛЕВАЯ КОЛОНКА: всё о своём корабле и о том, где он находится.
 *
 * Собрана снизу вверх и растёт вверх, в пустой левый край кадра. Так
 * сделано по двум причинам.
 *
 * Первая: в виде от третьего лица низ середины экрана занимает САМ
 * КОРАБЛЬ. Приборы, поставленные туда, ложатся прямо на корпус — ровно
 * это и случилось с полосой подхода, когда она стояла под прицелом.
 * Свободны углы и левый край, а не центр.
 *
 * Вторая: высота, вертикальная скорость и тяжесть — это НЕ про цель и не
 * про прицеливание, это про нас: где мы и что с нами. Им место рядом с
 * ходом и корпусом, а не в отдельном приборе посреди кадра, между
 * которым и панелью тяги глаз обязан прыгать.
 *
 * Рамок больше нет. Прибор очерчен вертикальной чертой слева и
 * волосяными разделителями — коробка вокруг каждой группы съедала место
 * и добавляла шума, не добавляя сведений.
 */
function drawShipColumn(ctx, px, py, game, approach) {
  const ship = game.ship;
  const rows = [];

  // Сверху — обстановка, если корабль в чьём-то тяготении. Прибор растёт
  // по мере снижения: за две тысячи километров вертикальная скорость
  // относительно грунта не значит ничего, а место занимает.
  if (approach) {
    const b = game.capture;
    const zone = game.zone;
    const li = game.landInfo;
    const gapKm = Math.hypot(
      ship.pos.x - b.pos.x, ship.pos.y - b.pos.y, ship.pos.z - b.pos.z) - b.radius;
    const alt = zone ? zone.alt : gapKm;
    rows.push({ kind: 'big', label: L('ВЫСОТА'), value: fmtDist(Math.max(0, alt)) });

    if (alt < 50) {
      let vUp = null, hSp = null;
      if (li) { vUp = li.vspeed; hSp = li.hspeed; } else if (zone) {
        vUp = dot(zone.relVel, zone.upWorld);
        const hx = zone.relVel.x - zone.upWorld.x * vUp;
        const hy = zone.relVel.y - zone.upWorld.y * vUp;
        const hz = zone.relVel.z - zone.upWorld.z * vUp;
        hSp = Math.hypot(hx, hy, hz);
      }
      const ms = (v) => (v === null ? '—' : (v * 1000).toFixed(0) + L(' м/с'));
      rows.push({ kind: 'pair',
        a: [L('ВЕРТ'), ms(vUp), li ? (li.vspeedOk ? GREEN : RED) : INK],
        b: [L('БОК'), ms(hSp), li ? (li.hspeedOk ? GREEN : RED) : INK] });
    }

    // Полоса растёт как R/d, а не как само ускорение: по ускорению она бы
    // почти весь подлёт стояла в нуле и прыгала только у поверхности.
    const gHere = gravityAt(b, ship.pos) * 1000;
    const frac = Math.sqrt(clamp(gHere / Math.max(b.g0, 1e-6), 0, 1));
    rows.push({ kind: 'gauge', label: L('ТЯЖЕСТЬ'), frac,
      color: frac > 0.75 ? AMBER : CY, note: gHere.toFixed(2) + L(' м/с²') });

    if (li) {
      rows.push({ kind: 'chips', chips: [
        [L('ШАССИ'), li.gearOk],
        [L('НАКЛОН'), li.tiltOk],
        [L('УКЛОН'), li.slopeOk],
      ] });
    }
    rows.push({ kind: 'rule', label: b.name.toUpperCase().slice(0, 18) });
  }

  // Ход — самое крупное в приборах: на него смотрят в манёвре, не
  // отрывая глаз от кадра.
  rows.push({ kind: 'big', label: ship.throttle < -0.001 ? L('ХОД НАЗАД') : L('ХОД'),
    value: fmtSpeed(ship.speed) });
  const back = ship.throttle < -0.001;
  rows.push({ kind: 'gauge', label: L('ТЯГА'), frac: Math.abs(ship.throttle),
    color: back ? AMBER : CY,
    note: Math.round(Math.abs(ship.throttle) * 100) + '%' });
  rows.push({ kind: 'gauge', label: L('ФОРСАЖ'), frac: ship.boost,
    color: ship.boosting ? AMBER : (ship.boostLock ? RED : CY) });
  rows.push({ kind: 'gauge', label: L('КОРПУС'), frac: ship.hull / SHIP.maxHull,
    color: ship.hull > 40 ? GREEN : RED });
  if (SHIP.maxShield > 0) {
    rows.push({ kind: 'gauge', label: L('ЩИТ'), frac: ship.shield / SHIP.maxShield, color: CY });
  }
  // Снятые гасители — состояние, о котором нельзя не сказать: корабль
  // ведёт себя принципиально иначе, а по самой картинке в пустоте этого
  // не видно, пока не попробуешь затормозить.
  if (!ship.damp) {
    rows.push({ kind: 'note', text: L('ГАСИТЕЛИ ВЫКЛ'), color: AMBER });
  }
  if (ship.lights) rows.push({ kind: 'note', text: L('ФАРЫ'), color: '#ffe9a8' });
  if (ship.gear.t > 0.005 || ship.gear.out) {
    rows.push({ kind: 'note', text: gearLabel(ship),
      color: ship.gear.out && ship.gear.t >= 0.995 ? GREEN : AMBER });
  }

  // Высота колонки считается заранее: она растёт вверх от нижнего края,
  // и без этого строки уехали бы за кадр при каждом новом ряде.
  const H = { big: 46, pair: 34, gauge: 22, chips: 30, rule: 18, note: 20 };
  let total = 0;
  for (const r of rows) total += H[r.kind];

  let y = py - total;
  const W = COL_W;
  // Черта слева — вместо рамки. Один штрих вместо четырёх, и он же
  // связывает группы в один прибор.
  ctx.fillStyle = 'rgba(79,179,224,0.30)';
  ctx.fillRect(px, y + 4, 2, total - 4);

  for (const r of rows) {
    const x = px + 12;
    if (r.kind === 'big') {
      ctx.textAlign = 'left';
      ctx.font = '11px Consolas, monospace';
      ctx.fillStyle = CY;
      ctx.fillText(r.label, x, y + 12);
      ctx.font = '28px Consolas, monospace';
      ctx.fillStyle = INK;
      ctx.fillText(r.value, x, y + 40);
    } else if (r.kind === 'pair') {
      for (const [i, cell] of [r.a, r.b].entries()) {
        const cx = x + i * (W / 2 - 6);
        ctx.textAlign = 'left';
        ctx.font = '10px Consolas, monospace';
        ctx.fillStyle = CY;
        ctx.fillText(cell[0], cx, y + 11);
        ctx.font = '16px Consolas, monospace';
        ctx.fillStyle = cell[2];
        ctx.fillText(cell[1], cx, y + 29);
      }
    } else if (r.kind === 'gauge') {
      ctx.textAlign = 'left';
      ctx.font = '10px Consolas, monospace';
      ctx.fillStyle = CY;
      ctx.fillText(r.label, x, y + 14);
      // Место под примечание отмеряется ПО САМОМУ ТЕКСТУ, а не на глаз:
      // «0.35 м/с²» вдвое длиннее «6%», и постоянный отступ означал бы,
      // что одно из двух налезет на шкалу.
      let note = 0;
      if (r.note) {
        ctx.textAlign = 'right';
        ctx.fillStyle = CY;
        ctx.fillText(r.note, px + W, y + 14);
        note = ctx.measureText(r.note).width + 10;
      }
      segments(ctx, x + 62, y + 6, W - 74 - note, 9, r.frac, r.color);
    } else if (r.kind === 'chips') {
      const step = (W - 12) / r.chips.length;
      for (const [i, [label, ok]] of r.chips.entries()) {
        ctx.textAlign = 'center';
        ctx.font = '11px Consolas, monospace';
        ctx.fillStyle = ok ? GREEN : RED;
        ctx.fillText((ok ? '+ ' : '− ') + label, x + step * (i + 0.5) - 6, y + 18);
      }
    } else if (r.kind === 'rule') {
      // Разделитель с подписью: он же говорит, в чьём тяготении корабль.
      ctx.strokeStyle = 'rgba(79,179,224,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 9);
      ctx.lineTo(px + W, y + 9);
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.font = '10px Consolas, monospace';
      ctx.fillStyle = 'rgba(2,10,18,0.95)';
      const tw = r.label.length * 6.2 + 8;
      ctx.fillRect(x + 4, y + 2, tw, 12);
      ctx.fillStyle = AMBER;
      ctx.fillText(r.label, x + 8, y + 12);
    } else if (r.kind === 'note') {
      ctx.textAlign = 'left';
      ctx.font = '11px Consolas, monospace';
      ctx.fillStyle = r.color;
      ctx.fillText(r.text, x, y + 13);
    }
    y += H[r.kind];
  }
}

/**
 * ПРАВАЯ КАРТОЧКА: всё о цели.
 *
 * Тоже без рамки — скобка в углу и черта под заголовком. Вид цели стоит
 * первым: имя «Lave VIb» само по себе не говорит, во что целишься — в
 * планету, в порт или в чужой корабль, — а от этого зависит всё
 * дальнейшее.
 */
function drawTargetCard(ctx, px, py, game, target, q) {
  const ship = game.ship;
  const W = CARD_W;
  ctx.textAlign = 'left';

  ctx.font = '11px Consolas, monospace';
  ctx.fillStyle = CY;
  const kind = targetKind(target);
  ctx.fillText(kind ? L('ЦЕЛЬ') + ' · ' + L(kind) : L('ЦЕЛЬ'), px + 12, py + 14);

  ctx.font = '22px Consolas, monospace';
  ctx.fillStyle = target ? AMBER : CY_DIM;
  const name = target ? (target.name || targetLabel(target)) : '—';
  ctx.fillText(String(name).slice(0, 18), px + 12, py + 42);

  // Скобка в правом верхнем углу карточки: прибор очерчен, но не заперт
  // в коробку.
  ctx.strokeStyle = 'rgba(79,179,224,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px + W - 26, py);
  ctx.lineTo(px + W, py);
  ctx.lineTo(px + W, py + 26);
  ctx.moveTo(px, py + 52);
  ctx.lineTo(px + W, py + 52);
  ctx.stroke();

  if (game.info) {
    ctx.font = '18px Consolas, monospace';
    ctx.fillStyle = INK;
    ctx.fillText(fmtDist(game.info.gap), px + 12, py + 76);
    if (isFinite(game.info.eta) && game.info.eta > 0) {
      ctx.font = '12px Consolas, monospace';
      ctx.fillStyle = '#9fd9ff';
      ctx.fillText(L('лёту ') + fmtTime(game.info.eta), px + 12, py + 94);
    }
    drawCompass(ctx, px + W - 44, py + 84, 34, ship, game.info.dir);
  }

  ctx.font = '12px Consolas, monospace';
  const stateY = py + 118;
  if (q && q.phase === 'calib') {
    // Калибровка: полоса и прямая подсказка, чего привод ждёт. Без неё
    // «почему не стартует» — самый частый вопрос к приводу.
    ctx.fillStyle = q.aligned ? GREEN : AMBER;
    ctx.fillText(q.aligned ? L('КАЛИБРОВКА') : L('НАВЕДИСЬ НА ЦЕЛЬ'), px + 12, stateY);
    segments(ctx, px + 12, stateY + 6, W - 24, 7, q.calib, q.aligned ? GREEN : AMBER);
  } else if (ship.docking) {
    ctx.fillStyle = GREEN;
    ctx.fillText(L('ДОКИНГ'), px + 12, stateY);
  } else if (game.warpTarget) {
    // Цель варпа главнее: именно её возьмёт J, и об этом надо сказать
    // прямо. Молчание означало бы «нажал J — улетел не туда».
    ctx.fillStyle = '#c9a8ff';
    ctx.fillText(L('J — ВАРП В ') + game.warpTarget.name.toUpperCase().slice(0, 12), px + 12, stateY);
  } else if (target) {
    ctx.fillStyle = CY_DIM;
    ctx.fillText(L('J — ПРЫЖОК К ЦЕЛИ'), px + 12, stateY);
  }
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
    const hemi = info.lat >= 0 ? L('с.ш.') : L('ю.ш.');
    ctx.fillText(
      `${info.body.name.toUpperCase()} · ${Math.abs(info.lat).toFixed(2)}° ${hemi}, ` +
      info.lon.toFixed(2) + L('° · ПЛОЩАДКА ') + fmtDist(info.height)
        + L(' · ПОСАДОК ') + (game.stats ? game.stats.landings || 0 : 0),
      mid, y - 8);
  }

  if (t > 0) {
    ctx.font = 'bold 15px Consolas, monospace';
    ctx.fillStyle = AMBER;
    ctx.fillText(t >= 1 ? L('ОТРЫВ') : L('ВЗЛЁТ'), mid, y + 22);
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = '#d8f2ff';
    ctx.fillText(t >= 1 ? L('ДЕРЖИТЕСЬ') :
      L('ДЕРЖАТЬ ЕЩЁ ') + ((1 - t) * LAND.holdOff).toFixed(1) + L(' с'), mid, y + 40);
  } else if (ship.secured) {
    ctx.font = 'bold 14px Consolas, monospace';
    ctx.fillStyle = GREEN;
    ctx.fillText(L('НА ГРУНТЕ · ДВИГАТЕЛИ ОТКЛЮЧЕНЫ'), mid, y + 22);
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = 'rgba(159,217,230,0.8)';
    ctx.fillText(L('УДЕРЖАТЬ ПРОБЕЛ ') + LAND.holdOff + L(' с — ВЗЛЁТ'), mid, y + 40);
  } else {
    ctx.font = 'bold 15px Consolas, monospace';
    ctx.fillStyle = CY;
    ctx.fillText(L('ГОТОВ К ПОСАДКЕ'), mid, y + 22);
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = 'rgba(159,217,230,0.8)';
    ctx.fillText(L('ПРОБЕЛ — ЗАФИКСИРОВАТЬ · УДЕРЖАТЬ — ВЗЛЁТ'), mid, y + 40);
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
    if (t.isPeer) continue;                  // у пилотов своя метка, с именем
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
 * Связь: качество и пинг — в левом верхнем углу, ВСЕГДА.
 *
 * Это единственный прибор, который не про корабль, и поэтому он висит
 * поверх всего, а не на доске в кабине: сеть ломается и в варпе, и в
 * прыжке, и на стоянке, а узнавать об этом по тому, что чужие корабли
 * перестали шевелиться, — худший из способов.
 *
 * Показано ровно то, по чему принимается решение: полоски — качество
 * (задержка и потери вместе), число — задержка. Потери выводятся только
 * когда они есть: постоянный «0%» глаз перестаёт читать через минуту.
 */
function drawLink(ctx, game) {
  const l = game.link;
  if (!l) return;
  const k = Q.hudScale;
  const x = 18, y = 22;
  const live = l.mode === 'live';

  // Цвет у полосок и у надписи один: разойдись они — и прибор пришлось бы
  // читать дважды.
  const color = !live ? (l.api === 'offline' || l.mode === 'connecting' ? AMBER
    : l.mode === 'down' ? RED : CY_DIM)
    : l.grade >= 3 ? GREEN : l.grade === 2 ? AMBER : RED;

  let text;
  if (live) {
    text = (l.ping === null ? L('— мс') : Math.round(l.ping) + L(' мс'))
      + (l.loss > 0.05 ? L('  ПОТЕРИ ') + Math.round(l.loss * 100) + '%' : '');
  } else {
    text = l.api === 'offline' ? L('АВТОНОМНО')
      : l.mode === 'connecting' ? L('СОЕДИНЕНИЕ')
        : l.mode === 'down' ? L('СВЯЗЬ ОБОРВАНА')
          : L('БЕЗ СЕТИ');
  }

  ctx.save();
  ctx.translate(x, y);
  if (k !== 1) ctx.scale(k, k);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '11px Consolas, monospace';

  // Четыре полоски растущей высоты: сколько горит — такое и качество.
  // Столбик, а не число «качества», потому что числу нужна шкала, а
  // столбику — нет.
  const bw = 3, gap = 2, base = 10;
  for (let i = 0; i < 4; i++) {
    const h = 3 + i * 2;
    const bx = i * (bw + gap);
    ctx.fillStyle = i < l.grade ? color : 'rgba(255,255,255,0.14)';
    ctx.fillRect(bx, base - h, bw, h);
  }

  const tx = 4 * (bw + gap) + 6;
  // Подложка: строка стоит на звёздах и на подсвеченном крае планеты.
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, tx, base);
  ctx.fillStyle = color;
  ctx.fillText(text, tx, base);
  ctx.restore();
}

/**
 * Прицел оружия: куда сейчас смотрит ствол.
 *
 * У карданного оружия ствол смотрит НЕ ТУДА, КУДА НОС: он доворачивает к
 * упреждённой точке — туда, где цель окажется, когда болт долетит. Без
 * этой отметки промах необъясним: прицел на цели, а болты идут мимо, и
 * причина (упреждение) нигде не показана.
 *
 * Отметка зелёная, пока кардан дотягивается, и жёлтая, когда он упёрся в
 * предел: во втором случае доворачивать надо самому.
 */
function drawGunAim(ctx, cam, game) {
  const g = game.guns;
  if (!g || !game.gunTarget) return;
  const a = g.aim;
  if (!a || !(Math.abs(a.x) + Math.abs(a.y) + Math.abs(a.z) > 0)) return;
  const p = projectDir(cam, a.x, a.y, a.z, _ga);
  if (p.back) return;

  const color = g.locked ? GREEN : AMBER;
  const r = 9;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  const cross = () => {
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x - r * 0.4, p.y);
    ctx.moveTo(p.x + r * 0.4, p.y); ctx.lineTo(p.x + r, p.y);
    ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y - r * 0.4);
    ctx.moveTo(p.x, p.y + r * 0.4); ctx.lineTo(p.x, p.y + r);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.35, 0, TAU);
    ctx.stroke();
  };
  cross();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  cross();
  ctx.restore();
}

/**
 * Чужие пилоты в кадре: квадрат и расстояние до него.
 *
 * Метка рисуется НЕЗАВИСИМО от того, виден ли сам корабль: корпус в
 * 67 метров перестаёт быть различим уже за сотню километров, а знать,
 * что рядом кто-то есть, нужно куда раньше. Без метки чужой корабль в
 * космосе просто не находится глазами — проверено: пилоты стояли в
 * восьмистах метрах друг от друга и не видели друг друга вовсе.
 *
 * Квадрат — как у станций, оранжевый — как отметки на сканере: это одна
 * и та же вещь, показанная в двух приборах, и цвет тут связка.
 */
function drawPeerMarks(ctx, cam, game) {
  const peers = game.peers;
  if (!peers || !peers.length) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.font = '11px Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const p of peers) {
    const c = cam.toCamera(p.pos);
    if (c.z <= cam.near) continue;             // за спиной
    const s = cam.project(c, _pp);
    if (s.x < 8 || s.x > cam.w - 8 || s.y < 8 || s.y > cam.h - 8) continue;
    const r = 6;
    const box = () => {
      ctx.beginPath();
      ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
      ctx.stroke();
    };
    // Подложка, как у остальных значков: метка тонкая и стоит на фоне
    // звёзд и подсвеченного края планеты.
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 3.5;
    box();
    ctx.strokeStyle = PEER;
    ctx.lineWidth = 1.4;
    box();

    // Корпус цели показываем, пока свежо: это ответ сервера на наше
    // попадание, и держать его вечно значит врать после того, как пилот
    // починился.
    const th = game.targetHull;
    const hull = th && th.id === p.id && (game.now || 0) - th.at < 6
      ? '  ' + Math.round((th.hull / (th.max || 100)) * 100) + '%' : '';
    const label = (p.name || L('ПИЛОТ')) + '  ' + fmtDist(dist3(cam.pos, p.pos)) + hull;

    // Корпус и щит — полосками НАД квадратом. Числами их пришлось бы
    // читать, а в бою читать некогда: нужен один взгляд, чтобы понять,
    // добивать или уходить.
    if (p.hullMax > 0) {
      const bw = 30, bh = 3, by = s.y - r - 10;
      const bar = (y, frac, color) => {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(s.x - bw / 2 - 1, y - 1, bw + 2, bh + 2);
        ctx.fillStyle = color;
        ctx.fillRect(s.x - bw / 2, y, bw * Math.max(0, Math.min(1, frac)), bh);
      };
      const hf = p.hull / p.hullMax;
      bar(by, hf, hf > 0.6 ? GREEN : hf > 0.25 ? AMBER : RED);
      // Щит рисуем, только если он есть: пустая полоска у пилота без
      // щита читалась бы как «щит на нуле», а это разные вещи.
      if (p.shieldMax > 0) bar(by - bh - 2, p.shield / p.shieldMax, CY);
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(label, s.x + r + 6, s.y);
    ctx.fillStyle = PEER;
    ctx.fillText(label, s.x + r + 6, s.y);
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
  // На грунте не показываем вовсе: там под прицелом стоит кнопка взлёта
  // и строка площадки, и подсказка ложилась прямо на них — три надписи в
  // одном месте. Да и целиться, стоя на ногах, не в кого: нос смотрит в
  // то самое тело, на котором корабль и стоит.
  if (game.state.mode === 'landed') return;
  ctx.save();
  ctx.font = fnt(13);
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
  // Прямо под прицелом, ВЫШЕ полосы подхода: это подсказка о том, куда
  // сейчас смотрит нос, и читается она вместе с прицелом, а не вместе с
  // приборами.
  line(targetLabel(t) + '   ' + fmtDist(dist3(cam.pos, t.pos)), cam.cy + sc(54), '#ffffff');
  line(L('TAB — ВЫБРАТЬ ЦЕЛЬ'), cam.cy + sc(72), AMBER);
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
  // Чужие пилоты в системе: их отметки на кольце оранжевые, но по одной
  // точке не понять, сколько их и есть ли они вообще, — поэтому число.
  const peers = game.peers ? game.peers.length : 0;
  if (peers > 0) {
    ctx.fillStyle = '#ff9f6b';
    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(L('ПИЛОТОВ РЯДОМ ') + peers, cx + rw, cy - rh - 6);
  }
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, rh, 0, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - rw, cy); ctx.lineTo(cx + rw, cy);
  ctx.moveTo(cx, cy - rh); ctx.lineTo(cx, cy + rh);
  ctx.stroke();
  ctx.font = '12px Consolas, monospace';
  ctx.fillStyle = CY;
  ctx.textAlign = 'center';
  ctx.fillText(L('СКАНЕР ') + fmtDist(range), cx, cy + rh + 18);

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
  const w = sc(200), h = w * (SLOT.hh / SLOT.hw);
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
  ctx.arc(px, py, sc(4), 0, TAU);
  ctx.fill();

  ctx.font = fnt(13);
  ctx.textAlign = 'center';
  ctx.fillStyle = CY;
  ctx.fillText(L('СТВОР ПОРТА  ') + fmtDist(Math.max(0, a.q.gap)), 0, -h / 2 - sc(10));

  ctx.textAlign = 'left';
  const rows = [
    [L('ОСЬ'), a.q.align > LIMITS.align],
    [L('КРЕН'), a.rollOk],
    [L('СКОР'), a.q.speed < LIMITS.speed],
  ];
  let ry = h / 2 + sc(20);
  ctx.font = fnt(13, 'bold');
  for (const [label, ok] of rows) {
    ctx.fillStyle = ok ? GREEN : RED;
    ctx.fillText((ok ? '+ ' : '- ') + label, -w / 2, ry);
    ry += sc(17);
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
