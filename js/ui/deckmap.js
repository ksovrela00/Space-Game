// План палубы: где пилот, что вокруг и куда идти (клавиша M на ногах).
//
// Помещения палубы — сверху, нос вверх: коробки комнат (js/models/
// interior.js), двери, лифт, трапы, шлюзы и люки. Пилот — стрелкой по
// взгляду. Справа — палубы корабля сверху вниз: где пилот (●), где цель
// (◆), какую смотрим. Выбрать помещение — ↑↓ или щелчком; Enter или
// щелчок — проложить путь (js/game/route.js): дальше в кадре метка
// следующей точки — дверь, трап или пульт лифта.
//
// По умолчанию выбрано кресло пилота (у «Прометея» — кресло командира на
// мостике): M и Enter — и путь к креслу проложен из любого места корабля.

import { CY, CY_DIM, AMBER, GREEN, INK } from './theme.js';
import { Q } from '../core/quality.js';
import { L } from '../core/lang.js';
import { decksOf, deckOf, routeTo } from '../game/route.js';

const fnt = (size, weight = '') => (weight ? weight + ' ' : '') + (size * Q.hudScale).toFixed(1) + 'px Consolas, monospace';
const sc = (n) => n * Q.hudScale;

export function makeDeckMap() {
  return { open: false, deck: 0, sel: null, rects: [] };
}

/** Имя помещения для приборов: перевод и номер (каюты палубы 8). */
export const roomName = (r) => (r ? L(r.name) + (r.num ? ' ' + r.num : '') : '');

/** Открыть план: палуба — где пилот, выбрана — цель пути или кресло. */
export function openDeckMap(M, I, room, goal) {
  const decks = decksOf(I);
  const seatRoom = (I.seat && I.seat.room) || 'bridge';
  M.sel = goal || seatRoom;
  const at = room ? decks.findIndex((d) => d.rooms.includes(room)) : -1;
  M.deck = at >= 0 ? at : 0;
  // Цель на другой палубе — план открывается на палубе пилота, но выбор
  // остаётся за целью: Enter ведёт туда же.
  M.open = true;
}

/**
 * Клавиши плана. @returns 'route' — проложить путь к M.sel, 'close' —
 * закрыть, null — ничего.
 */
export function deckMapKeys(M, I, input) {
  const decks = decksOf(I);
  if (input.pressed('KeyM', 'Escape')) return 'close';
  if (input.pressed('Enter', 'NumpadEnter', 'KeyE')) return 'route';
  const dd = (input.pressed('ArrowLeft', 'KeyA') ? -1 : 0) + (input.pressed('ArrowRight', 'KeyD') ? 1 : 0);
  if (dd) {
    M.deck = Math.max(0, Math.min(decks.length - 1, M.deck + dd));
    const list = decks[M.deck].rooms;
    if (!list.some((r) => r.id === M.sel)) M.sel = list[0].id;
  }
  const dr = (input.pressed('ArrowDown', 'KeyS') ? 1 : 0) - (input.pressed('ArrowUp', 'KeyW') ? 1 : 0);
  if (dr) {
    const list = decks[M.deck].rooms;
    const i = list.findIndex((r) => r.id === M.sel);
    M.sel = list[(Math.max(0, i) + dr + list.length) % list.length].id;
  }
  const wheel = input.takeWheel();
  if (wheel) {
    const list = decks[M.deck].rooms;
    const i = list.findIndex((r) => r.id === M.sel);
    M.sel = list[(Math.max(0, i) + Math.sign(wheel) + list.length) % list.length].id;
  }
  return null;
}

/** Щелчок по плану: помещение под курсором (или палуба в списке справа). */
export function deckMapClick(M, x, y) {
  for (const r of M.rects) {
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) {
      if (r.deck !== undefined) { M.deck = r.deck; return null; }
      return r.id;
    }
  }
  return null;
}

/**
 * Нарисовать план. game.walk — пилот (оси корабля, м), game.walkRoute —
 * проложенный путь (js/game/route.js).
 */
export function drawDeckMap(ctx, w, h, game, I) {
  const M = game.deckMap;
  const decks = decksOf(I);
  const D = decks[Math.max(0, Math.min(decks.length - 1, M.deck))];
  const walk = game.walk;
  const here = walk && walk.room;
  const goal = game.walkGoal;
  M.rects.length = 0;
  ctx.save();
  ctx.fillStyle = 'rgba(4,10,16,0.86)';
  ctx.fillRect(0, 0, w, h);

  // Поле плана и список палуб.
  const listW = sc(230);
  const pad = sc(24);
  const ax0 = pad, ay0 = sc(70), aw = w - listW - pad * 3, ah = h - sc(150);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of D.rooms) {
    x0 = Math.min(x0, r.lo[0]); x1 = Math.max(x1, r.hi[0]);
    z0 = Math.min(z0, r.lo[2]); z1 = Math.max(z1, r.hi[2]);
  }
  // Нос — вверх: z идёт по вертикали, x — по горизонтали.
  const k = Math.min(aw / Math.max(1, x1 - x0), ah / Math.max(1, z1 - z0));
  const ox = ax0 + (aw - (x1 - x0) * k) / 2, oy = ay0 + (ah - (z1 - z0) * k) / 2;
  const sx = (x) => ox + (x - x0) * k;
  const sy = (z) => oy + (z1 - z) * k;

  // Заголовок.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = fnt(20, 'bold');
  ctx.fillStyle = INK;
  ctx.fillText(L('ПЛАН: ') + L(D.deck), pad, sc(38));
  ctx.font = fnt(12);
  ctx.fillStyle = CY;
  ctx.fillText(L('НОС — ВВЕРХУ'), pad, sc(56));

  // Помещения.
  const routeRooms = new Set(game.walkRoute ? game.walkRoute.steps.map((e) => e.to) : []);
  for (const r of D.rooms) {
    const a = sx(r.lo[0]), b = sx(r.hi[0]), c = sy(r.hi[2]), d = sy(r.lo[2]);
    const sel = r.id === M.sel, isGoal = r.id === goal, isHere = here && r.id === here.id;
    let fill = 'rgba(40,70,92,0.55)';
    if (r.kind === 'lift') fill = 'rgba(40,120,110,0.75)';
    else if (r.kind === 'lock') fill = 'rgba(120,96,40,0.6)';
    else if (r.kind === 'shaft') fill = 'rgba(70,80,96,0.75)';
    if (routeRooms.has(r.id)) fill = 'rgba(60,120,70,0.55)';
    if (isHere) fill = 'rgba(79,179,224,0.45)';
    ctx.fillStyle = fill;
    ctx.fillRect(a, c, b - a, d - c);
    ctx.lineWidth = sel || isGoal ? 2 : 1;
    ctx.strokeStyle = sel ? AMBER : isGoal ? GREEN : CY_DIM;
    ctx.strokeRect(a, c, b - a, d - c);
    M.rects.push({ id: r.id, x0: a, x1: b, y0: c, y1: d });
    // Ступени трапа — штрихами поперёк марша.
    if (r.kind === 'shaft') {
      ctx.strokeStyle = 'rgba(216,242,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let z = r.lo[2]; z < r.hi[2]; z += 0.8) { ctx.moveTo(a + 1, sy(z)); ctx.lineTo(b - 1, sy(z)); }
      ctx.stroke();
    }
    // Подпись — если влезает.
    const name = r.kind === 'lift' ? L('ЛИФТ') : roomName(r);
    const fs = Math.min(13, Math.max(8, (d - c) * 0.32 / Q.hudScale));
    ctx.font = fnt(fs, sel ? 'bold' : '');
    const tw = ctx.measureText(name).width;
    if (tw < b - a - 4 && d - c > fs * Q.hudScale + 2) {
      ctx.textAlign = 'center';
      ctx.fillStyle = sel ? AMBER : INK;
      ctx.fillText(name, (a + b) / 2, (c + d) / 2 + fs * Q.hudScale * 0.35);
    } else if (d - c > b - a && b - a > fs * Q.hudScale + 2 && tw < d - c - 4) {
      // Узкий длинный (коридор) — подпись вдоль.
      ctx.save();
      ctx.translate((a + b) / 2 + fs * Q.hudScale * 0.35, (c + d) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = sel ? AMBER : 'rgba(216,242,255,0.75)';
      ctx.fillText(name, 0, 0);
      ctx.restore();
    }
  }
  // Двери и люки.
  const onDeck = (y) => Math.abs(y - D.floor) < 2.2;
  ctx.fillStyle = AMBER;
  for (const dr of I.doors) {
    if (!dr.pos || !onDeck(dr.pos[1])) continue;
    const s = sc(3);
    ctx.fillRect(sx(dr.pos[0]) - s, sy(dr.pos[2]) - s, s * 2, s * 2);
  }
  for (const hx of I.hatches || []) {
    if (!onDeck(hx.y[0])) continue;
    const x = sx(hx.side * hx.skin), y = sy((hx.z[0] + hx.z[1]) / 2);
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.moveTo(x, y - sc(6)); ctx.lineTo(x + hx.side * sc(9), y); ctx.lineTo(x, y + sc(6));
    ctx.closePath();
    ctx.fill();
  }

  // Путь по этой палубе.
  const R = game.walkRoute;
  if (R && here) {
    const pts = [];
    if (D.rooms.includes(here)) pts.push(walk.pos);
    for (const e of R.steps) {
      if (e.lift) continue;
      const p = e.door ? e.door.pos : null;
      if (p && onDeck(p[1])) pts.push(p);
    }
    if (goal && D.rooms.some((r) => r.id === goal)) pts.push(R.end);
    if (pts.length > 1) {
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = sc(2);
      ctx.setLineDash([sc(6), sc(4)]);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[2])) : ctx.moveTo(sx(p[0]), sy(p[2]))));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Пилот — стрелкой по взгляду (yaw 0 — к носу, то есть вверх по плану).
  if (here && D.rooms.includes(here) && !walk.out) {
    const px = sx(walk.pos[0]), py = sy(walk.pos[2]);
    const fx = Math.sin(walk.yaw), fz = Math.cos(walk.yaw);
    const s = sc(11);
    ctx.fillStyle = INK;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + fx * s, py - fz * s);
    ctx.lineTo(px - fx * s * 0.6 + fz * s * 0.55, py + fz * s * 0.6 + fx * s * 0.55);
    ctx.lineTo(px - fx * s * 0.6 - fz * s * 0.55, py + fz * s * 0.6 - fx * s * 0.55);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }

  // Палубы справа.
  const lx = w - listW - pad, ly0 = sc(70);
  const row = Math.min(sc(26), (h - sc(170)) / decks.length);
  ctx.font = fnt(13);
  ctx.textAlign = 'left';
  const goalDeck = goal && I.roomById[goal] ? deckOf(I.roomById[goal]) : null;
  decks.forEach((d, i) => {
    const y = ly0 + i * row;
    const cur = i === M.deck;
    ctx.fillStyle = cur ? 'rgba(79,179,224,0.25)' : 'rgba(79,179,224,0.06)';
    ctx.fillRect(lx, y, listW, row - 3);
    M.rects.push({ deck: i, x0: lx, x1: lx + listW, y0: y, y1: y + row - 3 });
    ctx.fillStyle = cur ? INK : CY;
    const mine = here && d.rooms.includes(here);
    ctx.fillText((mine ? '● ' : '  ') + L(d.deck) + (goalDeck && goalDeck === d.deck ? '  ◆' : ''), lx + sc(8), y + row * 0.65);
  });

  // Выбор и подсказки.
  const selRoom = I.roomById[M.sel];
  ctx.textAlign = 'left';
  ctx.font = fnt(15, 'bold');
  ctx.fillStyle = AMBER;
  const seatRoom = (I.seat && I.seat.room) || 'bridge';
  const selName = selRoom ? roomName(selRoom) + (M.sel === seatRoom ? L(' · КРЕСЛО ПИЛОТА') : '') + ' · ' + L(deckOf(selRoom)) : '';
  ctx.fillText(selName, pad, h - sc(58));
  if (R && goal) {
    ctx.font = fnt(13);
    ctx.fillStyle = GREEN;
    ctx.fillText(L('ПУТЬ: ') + roomName(I.roomById[goal]) + ' · ' + Math.round(R.dist) + L(' м'), pad, h - sc(38));
  }
  ctx.font = fnt(12);
  ctx.fillStyle = CY;
  ctx.fillText(Q.touchUi ? L('НАЖМИТЕ НА ПОМЕЩЕНИЕ — ПРОЛОЖИТЬ ПУТЬ · НА ПАЛУБУ СПРАВА — ЕЁ ПЛАН')
    : L('←→ ПАЛУБА · ↑↓ ПОМЕЩЕНИЕ · ENTER ИЛИ ЩЕЛЧОК — ПРОЛОЖИТЬ ПУТЬ · M — ЗАКРЫТЬ'), pad, h - sc(16));
  ctx.restore();
}

/** Путь по готовому маршруту для плана, если он не проложен заранее. */
export const routeFor = (I, walk, goal) => (goal && walk && walk.room ? routeTo(I, walk.room, walk.pos, goal) : null);
