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
import { v3 } from '../core/vec3.js';
import { Q } from '../core/quality.js';
import { L } from '../core/lang.js';
import { fmtSpeed } from './hud.js';

const fnt = (size, weight = '') => (weight ? weight + ' ' : '')
  + (size * Q.hudScale).toFixed(1) + 'px Consolas, monospace';
const sc = (n) => n * Q.hudScale;

/** Подписи ярусов — по полу помещения. */
function deckName(room) {
  if (!room) return '';
  // У «Прометея» палубы по номерам (js/models/interior.prom.js).
  if (room.deck) return L(room.deck);
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

  // Путь по кораблю: метка следующей точки (js/game/route.js).
  drawRoute(ctx, r, game);

  // Где ты: название помещения и ярус — при входе, потом гаснет. За
  // бортом — тело под ногами, его тяжесть и воздух.
  const room = walk && walk.room;
  const t = game.walkRoomT || 0;
  const out = hint.out;
  // Когда название погасло — остаётся строкой поменьше: на корабле в
  // полторы сотни помещений «где я» нужно всегда, а не только на пороге.
  if (room && !out && t <= 0 && game.interior && game.interior.rooms.length > 20) {
    ctx.textAlign = 'center';
    ctx.font = fnt(12);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    const line = deckName(room) + ' · ' + L(room.name) + (room.num ? ' ' + room.num : '');
    ctx.strokeText(line, cx, sc(40));
    ctx.fillStyle = 'rgba(216,242,255,0.75)';
    ctx.fillText(line, cx, sc(40));
  }
  if ((room || out) && t > 0) {
    ctx.globalAlpha = Math.min(1, t);
    ctx.textAlign = 'center';
    ctx.font = fnt(18, 'bold');
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    const name = out ? out.name : L(room.name) + (room.num ? ' ' + room.num : '');
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
  if (hint.route) tips.push(hint.route);
  if (hint.lift) tips.push(hint.lift);
  if (hint.plan) tips.push([hint.plan, CY]);
  if (hint.hatch) tips.push(hint.hatch);
  if (hint.bay) tips.push(hint.bay);
  if (hint.kiosk) tips.push(hint.kiosk);
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
  // Пульт лифта станции: список остановок справа от прицела — их до
  // одиннадцати, и одной строкой подсказки их не показать.
  if (hint.liftList) {
    ctx.textAlign = 'left';
    ctx.font = fnt(14);
    const lx = cx + sc(120);
    let ly = h * 0.5 - hint.liftList.length * sc(10);
    ctx.strokeText(L('ЛИФТ'), lx, ly - sc(26));
    ctx.fillStyle = CY;
    ctx.fillText(L('ЛИФТ'), lx, ly - sc(26));
    for (const [s, c] of hint.liftList) {
      ctx.strokeText(s, lx, ly);
      ctx.fillStyle = c;
      ctx.fillText(s, lx, ly);
      ly += sc(20);
    }
  }
  ctx.restore();
}

const _rw = v3(), _rc = v3(), _rs = { x: 0, y: 0 };

/**
 * Метка пути (js/game/route.js): следующая точка — дверь, проём трапа,
 * пульт лифта или сама цель — ромбом в кадре, с подписью и расстоянием до
 * цели. За краем кадра или за спиной — стрелкой у края в её сторону.
 */
function drawRoute(ctx, r, game) {
  // План и оси — того, по чему идёт пилот (js/main.js, walkPlan): палуба
  // корабля или пол станции.
  const I = game.routePlan || game.interior, V = game.routeFrame || game.frame;
  const R = game.walkRoute;
  if (!R || !I || !V || !V.basis || !game.walk || (game.deckMap && game.deckMap.open)) return;
  const p = R.next.point, b = V.basis;
  const y = p[1] + 1.3;               // на уровне глаз
  _rw.x = V.pos.x + (b.right.x * p[0] + b.up.x * y + b.fwd.x * p[2]) / 1000;
  _rw.y = V.pos.y + (b.right.y * p[0] + b.up.y * y + b.fwd.y * p[2]) / 1000;
  _rw.z = V.pos.z + (b.right.z * p[0] + b.up.z * y + b.fwd.z * p[2]) / 1000;
  const cam = r.camera;
  cam.toCamera(_rw, _rc);
  const w = cam.w, h = cam.h, m = sc(40);
  let sx = 0, sy = 0, on = false;
  if (_rc.z > cam.near) {
    cam.project(_rc, _rs);
    sx = _rs.x; sy = _rs.y;
    on = sx > m && sx < w - m && sy > m && sy < h - m;
  }
  const next = R.next;
  const label = next.kind === 'lift' ? L('ЛИФТ: ') + L(next.lift.stops[next.stop].deck)
    : next.kind === 'goal' ? L(I.roomById[next.to].name)
      : L(I.roomById[next.to].name) + (I.roomById[next.to].num ? ' ' + I.roomById[next.to].num : '');
  const dist = Math.round(R.dist) + L(' м');
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.fillStyle = GREEN;
  if (on) {
    const s = sc(9);
    ctx.beginPath();
    ctx.moveTo(sx, sy - s); ctx.lineTo(sx + s, sy); ctx.lineTo(sx, sy + s); ctx.lineTo(sx - s, sy);
    ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.font = fnt(13, 'bold');
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeText(label, sx, sy - s - sc(6));
    ctx.fillText(label, sx, sy - s - sc(6));
    ctx.font = fnt(11);
    ctx.strokeText(dist, sx, sy + s + sc(14));
    ctx.fillText(dist, sx, sy + s + sc(14));
  } else {
    // За кадром: направление на точку в плоскости экрана; за спиной — вниз.
    let dx = _rc.x, dy = -_rc.y;
    if (_rc.z <= cam.near && Math.hypot(dx, dy) < 1e-9) dy = 1;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const cx = w / 2, cy = h / 2;
    const k = Math.min((w / 2 - m) / Math.max(1e-6, Math.abs(dx)), (h / 2 - m) / Math.max(1e-6, Math.abs(dy)));
    const ax = cx + dx * k, ay = cy + dy * k;
    const s = sc(13);
    ctx.beginPath();
    ctx.moveTo(ax + dx * s, ay + dy * s);
    ctx.lineTo(ax - dy * s * 0.6 - dx * s * 0.4, ay + dx * s * 0.6 - dy * s * 0.4);
    ctx.lineTo(ax + dy * s * 0.6 - dx * s * 0.4, ay - dx * s * 0.6 - dy * s * 0.4);
    ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.font = fnt(12, 'bold');
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    const tx = ax - dx * sc(34), ty = ay - dy * sc(26);
    ctx.strokeText(label, tx, ty);
    ctx.fillText(label, tx, ty);
  }
  ctx.restore();
}
