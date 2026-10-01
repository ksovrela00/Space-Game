// Приборы пилота на ногах.
//
// Встав с кресла, пилот остаётся без мониторов: они на доске, а он —
// в кают-компании или в трюме. Угловые панели полёта тут были бы враньём
// (рукой до ручки не дотянуться, а цифры на экране висят), поэтому кадр
// почти чистый — как в любой игре от первого лица:
//
//   * точка в середине — куда смотришь (без неё в упор к стене взгляд
//     теряется);
//   * где ты — название помещения, на пару секунд при входе в него;
//   * что с кораблём — одна строка в углу: летит, стоит в порту, сел,
//     прыгает. Корабль на ходу остался без пилота, и об этом должно быть
//     видно отовсюду;
//   * связь — те же сообщения, что на табло козырька;
//   * подсказка — что сейчас можно сделать: сесть в кресло, взять мышь.

import { CY, AMBER, GREEN, RED, INK } from './theme.js';
import { Q } from '../core/quality.js';
import { L } from '../core/lang.js';
import { fmtSpeed } from './hud.js';

const fnt = (size, weight = '') => (weight ? weight + ' ' : '')
  + (size * Q.hudScale).toFixed(1) + 'px Consolas, monospace';
const sc = (n) => n * Q.hudScale;

/** Подписи ярусов — по полу помещения. */
function deckName(room) {
  if (!room) return '';
  if (room.id === 'bridge') return L('ЯРУС РУБКИ');
  if (room.lo[1] < -7) return L('НИЖНЯЯ ПАЛУБА');
  if (room.lo[1] < -3) return L('СРЕДНЯЯ ПАЛУБА');
  return L('ЯРУС РУБКИ');
}

/** Что сейчас с кораблём: одна строка и её цвет. */
export function shipStatus(game) {
  const ship = game.ship, st = game.state;
  if (game.warp && game.warp.phase === 'tunnel') return [L('КОРАБЛЬ: ВАРП-ПРЫЖОК'), CY];
  if (game.quantum && game.quantum.phase === 'jump') return [L('КОРАБЛЬ: КВАНТОВЫЙ ПРЫЖОК'), CY];
  if (st.mode === 'docked' && ship.dockedAt) return [L('КОРАБЛЬ В ПОРТУ: ') + ship.dockedAt.name, GREEN];
  if (st.mode === 'landed') {
    const b = ship.landedAt;
    return [L('КОРАБЛЬ НА ГРУНТЕ') + (b && b.name ? ': ' + b.name : ''), GREEN];
  }
  if (ship.docking) return [L('КОРАБЛЬ ВЕДЁТ ДОКИНГ-КОМПЬЮТЕР'), AMBER];
  if (ship.landing) return [L('КОРАБЛЬ ВЕДЁТ ПОСАДОЧНЫЙ КОМПЬЮТЕР'), AMBER];
  return [L('КОРАБЛЬ БЕЗ ПИЛОТА · ') + fmtSpeed(ship.speed || 0), ship.speed > 0.05 ? AMBER : CY];
}

/**
 * @param r     слой приборов (js/render/hud.js): ctx и камера
 * @param game  состояние игры; game.walk — пилот (js/game/walker.js)
 * @param hint  подсказки: { seat, mouse, intro } — что показать внизу
 */
export function drawWalkHud(r, game, hint = {}) {
  const ctx = r.ctx;
  const w = r.camera.w, h = r.camera.h;
  const walk = game.walk;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // Точка взгляда: тёмная подложка и светлая точка — видна и на белой
  // переборке, и в тёмном трюме.
  const cx = w / 2, cy = h / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.arc(cx, cy, sc(3.2), 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(216,242,255,0.9)';
  ctx.beginPath(); ctx.arc(cx, cy, sc(1.8), 0, Math.PI * 2); ctx.fill();

  // Где ты: название помещения и ярус — при входе, потом гаснет.
  const room = walk && walk.room;
  const t = game.walkRoomT || 0;
  if (room && t > 0) {
    ctx.globalAlpha = Math.min(1, t);
    ctx.textAlign = 'center';
    ctx.font = fnt(18, 'bold');
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    const name = L(room.name);
    ctx.strokeText(name, cx, sc(64));
    ctx.fillStyle = INK;
    ctx.fillText(name, cx, sc(64));
    ctx.font = fnt(12);
    const deck = deckName(room);
    ctx.strokeText(deck, cx, sc(84));
    ctx.fillStyle = CY;
    ctx.fillText(deck, cx, sc(84));
    ctx.globalAlpha = 1;
  }

  // Что с кораблём — правый верхний угол.
  const [line, color] = shipStatus(game);
  ctx.textAlign = 'right';
  ctx.font = fnt(13);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  const rx = w - sc(22), ry = sc(30) + 18;
  ctx.strokeText(line, rx, ry);
  ctx.fillStyle = color;
  ctx.fillText(line, rx, ry);
  // Корпус и топливо — только когда о них стоит знать.
  const warn = [];
  if (game.ship.hull < 35) warn.push([L('КОРПУС ') + Math.round(game.ship.hull) + '%', RED]);
  if (hint.fuel) warn.push([hint.fuel, RED]);
  let wy = ry + sc(18);
  for (const [s, c] of warn) {
    ctx.strokeText(s, rx, wy);
    ctx.fillStyle = c;
    ctx.fillText(s, rx, wy);
    wy += sc(18);
  }

  // Связь: сообщения — те же, что на табло козырька.
  ctx.textAlign = 'left';
  ctx.font = fnt(13);
  let my = sc(30) + 18;
  for (const m of game.state.messages) {
    ctx.globalAlpha = Math.max(0, Math.min(1, m.t));
    ctx.strokeText(m.text, 20, my);
    ctx.fillStyle = m.color || AMBER;
    ctx.fillText(m.text, 20, my);
    my += sc(18);
  }
  ctx.globalAlpha = 1;

  // Подсказки внизу: что можно сделать прямо сейчас.
  const tips = [];
  if (hint.seat) tips.push([hint.seat, GREEN]);
  if (hint.mouse) tips.push([hint.mouse, AMBER]);
  if (hint.intro) tips.push([hint.intro, CY]);
  ctx.textAlign = 'center';
  ctx.font = fnt(14);
  let ty = h - sc(hint.touch ? 190 : 60);
  for (const [s, c] of tips) {
    ctx.strokeText(s, cx, ty);
    ctx.fillStyle = c;
    ctx.fillText(s, cx, ty);
    ty -= sc(22);
  }
  ctx.restore();
}
