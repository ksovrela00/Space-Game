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
//   * подсказка — что сейчас можно сделать: сесть в кресло, взять мышь,
//     открыть люк;
//   * в шлюзе — давление и что он делает (задраен, стравливает, открыт);
//   * за бортом — где пилот, какая тут тяжесть и воздух, далеко ли корабль.

import { CY, AMBER, GREEN, RED, INK, PEER } from './theme.js';
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
  if (room.id === 'lockS') return L('ПАЛУБА ГОНДОЛ');
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
// Над головой — имя: без него в скафандрах все одинаковые. Только рядом
// и только тем, кто там же, где ты (на грунте — тем, кто на грунте; на
// палубе — тем, кто на этой палубе): имя сквозь три переборки — подсказка
// о том, чего не видно, а не подпись к тому, что видно.
const NAME_NEAR = 0.04;           // км
const _head = { x: 0, y: 0, z: 0 }, _hp = { x: 0, y: 0 };
function drawNames(ctx, cam, game) {
  const list = game.people;
  if (!list || !list.length || !cam.toCamera) return;
  const w = game.walk;
  const here = w && w.on && !w.out && w.vessel ? w.vessel.id : null;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = fnt(12, 'bold');
  ctx.lineWidth = 3;
  for (const p of list) {
    if (!p.here || !p.place) continue;
    const same = p.st === 'out' ? !!(w && w.out) : p.ship === here;
    if (!same) continue;
    const u = p.place.basis.up, f = p.place.pos;
    _head.x = f.x + u.x * 0.0021; _head.y = f.y + u.y * 0.0021; _head.z = f.z + u.z * 0.0021;
    const d = Math.hypot(_head.x - cam.pos.x, _head.y - cam.pos.y, _head.z - cam.pos.z);
    if (d > NAME_NEAR) continue;
    const c = cam.toCamera(_head);
    if (c.z <= cam.near) continue;
    const s = cam.project(c, _hp);
    const name = (p.name || L('ПИЛОТ')) + (d > 0.008 ? '  ' + Math.round(d * 1000) + L(' м') : '');
    ctx.globalAlpha = Math.min(1, (NAME_NEAR - d) / 0.01);
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(name, s.x, s.y);
    ctx.fillStyle = PEER;
    ctx.fillText(name, s.x, s.y);
  }
  ctx.restore();
}

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

  // Где ты: название помещения и ярус — при входе, потом гаснет. За
  // бортом — тело под ногами, его тяжесть и воздух.
  const room = walk && walk.room;
  const t = game.walkRoomT || 0;
  const out = hint.out;
  if ((room || out) && t > 0) {
    ctx.globalAlpha = Math.min(1, t);
    ctx.textAlign = 'center';
    ctx.font = fnt(18, 'bold');
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    const name = out ? out.name : L(room.name);
    ctx.strokeText(name, cx, sc(64));
    ctx.fillStyle = INK;
    ctx.fillText(name, cx, sc(64));
    ctx.font = fnt(12);
    const deck = out ? out.info : deckName(room);
    ctx.strokeText(deck, cx, sc(84));
    ctx.fillStyle = CY;
    ctx.fillText(deck, cx, sc(84));
    ctx.globalAlpha = 1;
  }

  drawNames(ctx, r.camera, game);

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
  // Корпус и топливо — только когда о них стоит знать. Шлюз и дорога до
  // корабля — тут же, под строкой о корабле.
  const warn = [];
  if (hint.lock) warn.push(hint.lock);
  if (hint.press) warn.push(hint.press);
  if (hint.aboard) warn.push([hint.aboard, '#9fd9ff']);
  if (out) warn.push([out.info, CY]);
  if (out && out.ship) warn.push([out.ship, CY]);
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
  if (hint.hatch) tips.push(hint.hatch);
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
