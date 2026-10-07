// Стыковка со станцией: проверка условий входа в порт, столкновения
// с корпусом и докинг-компьютер (скриптованный подлёт).

import { v3, normalize, dot, clamp } from '../core/vec3.js';
import { toLocal, toWorld } from '../core/basis.js';
import { SHIP } from './ship.js';
import { aimAt, flyVelocity, levelRoll, rateCmd, alignBasis } from './pilot.js';
import { SLOT } from '../models/stations.js';
import { HULL } from './hull.js';
import { stationM, stationWorld, hallZone, BERTH } from './berth.js';
import { padByNo } from './stationplan.js';
import { L } from '../core/lang.js';

export const LIMITS = {
  speed: 0.28,     // км/с — максимальная относительная скорость входа
  align: 0.86,     // косинус угла между носом и осью порта
  roll: 0.78,      // косинус рассогласования крена: верх корабля — к верху станции
};

// Форма станции у каждой своя (js/models/stations.js): «Кориолис» —
// кубооктаэдр, «Орбис» — ступица с кольцом. Модуль про неё знает ровно
// две вещи: где плоскость створа и что считать попаданием в корпус.
const _lp = v3();
const _rel = v3();

export function stationLocal(ship, station, out = _lp) {
  return toLocal(station.basis, station.pos, ship.pos, out);
}

// Относительная скорость корабля и станции.
export function relSpeed(ship, station) {
  _rel.x = ship.vel.x - station.vel.x;
  _rel.y = ship.vel.y - station.vel.y;
  _rel.z = ship.vel.z - station.vel.z;
  return Math.hypot(_rel.x, _rel.y, _rel.z);
}

// Насколько корабль готов войти в порт (для подсказок HUD).
export function dockingQuality(ship, station) {
  const align = -dot(ship.basis.fwd, station.basis.fwd);   // нос против оси порта
  // Крен — к ВЕРХУ станции, а не «по модулю»: за щелью зал с тяжестью
  // вниз по станции, и вошедший вверх ногами корабль висит над полом
  // брюхом к потолку. Раньше щели было всё равно, как повернут корабль, —
  // за ней ничего не было.
  const roll = dot(ship.basis.up, station.basis.up);
  const speed = relSpeed(ship, station);
  const p = stationLocal(ship, station);
  // Попал ли в щель — тем же правилом, что и стыковка (checkStation):
  // по обводам корпуса, а не по центру масс. Прибор показывает полосу,
  // в которой должен идти центр (fit), — у крейсера она на 10 м ниже оси
  // и высотой всего 30 м.
  const fit = slotFit();
  return {
    align, roll, speed,
    local: { x: p.x, y: p.y, z: p.z },
    fit,
    // Остаток до створа считается ЗДЕСЬ, а не в приборах: глубина у
    // типов станций разная, и приборам незачем знать их форму.
    gap: p.z - station.shape.D,
    inSlot: Math.abs(p.x - fit.x) < fit.mx && Math.abs(p.y - fit.y) < fit.my,
    ok: align > LIMITS.align && roll > LIMITS.roll && speed < LIMITS.speed,
  };
}

/**
 * Проверка положения корабля относительно станции.
 *
 * Прошёл раму щели — 'enter': дальше корабль летит в тоннеле и зале станции
 * (js/game/berth.js), а стыкуется он, только сев на площадку. Раньше
 * пройденная рама и была стыковкой: корабль пропадал в центре станции.
 * Задел ли корпус раму или стены, решают уже точки корпуса внутри
 * (berth.js, hullContact): по центру масс этого не видно.
 *
 * @returns null | 'enter' | 'crash'
 */
export function checkStation(ship, station) {
  const sh = station.shape;
  const p = stationLocal(ship, station);
  // Дальше габарита ни корпуса, ни щели нет. Был здесь слой ±D, и мачта
  // «Орбиса» с реактором (до 1.47 км за станцией) не была твёрдой вовсе.
  if (p.z > sh.D || p.z < -sh.bound) return null;
  // Центр масс прошёл раму и он в пустоте — тоннель или зал.
  if (sh.hollow(p.x, p.y, p.z)) return 'enter';
  // Мимо щели. Столкновение — только если ТОЧКА ВНУТРИ КОРПУСА, а
  // корпус у каждого типа свой: у «Кориолиса» это кубооктаэдр, у
  // «Орбиса» — ступица, кольцо, спицы и мачта. Проверка нарисованного и
  // проверка столкновения — одни и те же числа (js/models/stations.js),
  // иначе корабль бьётся о пустоту и пролетает сквозь балки.
  return sh.inside(p.x, p.y, p.z) ? 'crash' : null;
}

/**
 * Где в щели должен идти центр масс, чтобы корпус прошёл целиком.
 *
 * Сверху и снизу корпус меряется своими крайними точками, а не удвоенной
 * половиной. У «Челленджера» верх и низ равны, и середина полосы — ось
 * щели. У «Прометея» башня на 43 м над центром масс, гондолы на 23 под
 * ним: держать центр на оси щели значит вести башню в пяти метрах от
 * рамы. Середина полосы у него на 10 м ниже оси, с запасом по 15 м.
 *
 * @returns {{x, y, mx, my}} середина полосы и запас до рамы в обе
 *   стороны, км, в осях станции
 */
export function slotFit() {
  return {
    x: -(HULL.hi.x + HULL.lo.x) / 2,
    y: -(HULL.hi.y + HULL.lo.y) / 2,
    mx: SLOT.hw - (HULL.hi.x - HULL.lo.x) / 2,
    my: SLOT.hh - (HULL.hi.y - HULL.lo.y) / 2,
  };
}

// --- Докинг-компьютер --------------------------------------------------------

export const DOCK_RANGE = 120;   // км — дальше компьютер не берётся
const GATE_GAP = 1.2;            // км перед створом порта

/**
 * Полоса наведения носа, 1/с — та же, что у регулятора угловой скорости
 * (js/game/pilot.js, rateCmd).
 *
 * Корабль летит туда, куда смотрит нос: скорость поперёк носа гасят
 * маневровые (SHIP.lateral). Поэтому снос с оси щели убирается только
 * поворотом носа, и петля «снос → нос → снос» — звено второго порядка
 * τ·y'' + y' + g·y = 0, где τ = 1/полоса, g — усиление по сносу. При
 * g = полосе затухание 0.5 у любого корабля. У «Челленджера» полоса
 * 0.5/с: это ровно прежние коэффициенты. У «Прометея» она 0.3/с: прежние
 * 0.5 давали затухание 0.38, а вместе с задержкой маневровых — раскачку.
 * Крейсер уходил от оси на сотню метров и бился о станцию.
 */
const steerBand = () => 1 / (2.5 * (SHIP.rcsBand || 0.4));

/**
 * Тяга — только туда, куда смотрит нос. Нос на 27° от нужного
 * направления, и вся скорость уходит вбок: поперёк носа её тут же гасят
 * маневровые (SHIP.lateral). Поэтому до 4° — полная тяга, к 20° она
 * сходит на нет: сначала довернуть, потом разгоняться. «Челленджер»
 * доворачивает за доли секунды, и разницы не видно. Крейсеру на это
 * нужны секунды, и без этого он на входе в створ уходил вбок на 40 м.
 */
const AIM_FULL = Math.cos(4 / 57.2958);
const AIM_NONE = Math.cos(20 / 57.2958);
function flyAligned(ship, vec, k) {
  flyVelocity(ship, vec, k);
  const sp = Math.hypot(vec.x, vec.y, vec.z);
  if (sp < 1e-7) return;
  const c = (ship.basis.fwd.x * vec.x + ship.basis.fwd.y * vec.y + ship.basis.fwd.z * vec.z) / sp;
  ship.throttle *= clamp((c - AIM_NONE) / (AIM_FULL - AIM_NONE), 0, 1);
}

// Где решается второй заход: пока нос ещё перед створом. Центр масс
// крейсера в 112 м за носом, и за створом поправлять уже поздно: щель
// меряется всем корпусом. Решается до того, как начинается обход станции
// (0.3 км от створа): иначе возврат к точке ожидания сразу станет
// обходом, а обход из-под самой щели ведёт в обшивку. Полоса решения —
// от 0.3 км плюс длина носа и ещё сто метров на поворот.
const decideAt = () => 0.3 + HULL.hi.z + 0.1;

export function startDockingComputer(ship, station, pad = null) {
  const d = Math.hypot(
    station.pos.x - ship.pos.x,
    station.pos.y - ship.pos.y,
    station.pos.z - ship.pos.z);
  if (d > DOCK_RANGE) return { ok: false, reason: L('СТАНЦИЯ СЛИШКОМ ДАЛЕКО — ПРЫЖОК (B)') };
  // Внутри станции — сразу к площадке (или из тоннеля в зал), снаружи —
  // к створу; дальше компьютер ведёт сквозь щель до самой площадки.
  const inside = ship.berth && ship.berth.st === station;
  ship.docking = { station, phase: inside ? 'tunnel' : 'gate', pad };
  ship.autopilot = null;
  return { ok: true };
}

/**
 * Вылет докинг-компьютером: с пола зала — вверх, к тоннелю и наружу.
 * Взлёт с площадки делает игра (js/main.js, liftOff), отсюда — дорога.
 */
export function startLaunchComputer(ship, station) {
  ship.docking = { station, phase: 'climb', out: true };
  ship.autopilot = null;
  return { ok: true };
}

export function stopDockingComputer(ship) { ship.docking = null; }

const _pt = v3();
const _vec = v3();
const stationPoint = (st, x, y, z) => toWorld(st.basis, st.pos, v3(x, y, z), _pt);

const distTo = (ship, p) =>
  Math.hypot(p.x - ship.pos.x, p.y - ship.pos.y, p.z - ship.pos.z);

// Наведение носа, полёт заданным вектором скорости и гашение крена —
// в js/game/pilot.js: тем же приёмом пользуется посадочный компьютер.

/**
 * Крен корабля до верха станции: угол поворота вокруг носа, который
 * приводит его «верх» к её «верху» (рад, со знаком). Не по модулю 180°:
 * за щелью зал с тяжестью вниз по станции (js/game/berth.js).
 */
export function rollToStation(ship, station) {
  const u = ship.basis.up, T = station.basis.up, f = ship.basis.fwd;
  const cx = u.y * T.z - u.z * T.y, cy = u.z * T.x - u.x * T.z, cz = u.x * T.y - u.y * T.x;
  return Math.atan2(cx * f.x + cy * f.y + cz * f.z, dot(u, T));
}

// Согласование крена с вращающейся станцией — верхом к её верху.
const matchRoll = (ship, station, k = 2.0) => {
  const err = rollToStation(ship, station);
  // Вперёд подаём скорость вращения станции, иначе регулятор всё время
  // отстаёт от вращающегося порта.
  const feed = station.spinRate * (dot(station.basis.fwd, ship.basis.fwd) < 0 ? 1 : -1);
  // Ошибка — по кривой торможения (js/game/pilot.js, rateCmd), вращение
  // станции — прямой подачей.
  const w = rateCmd(-err, SHIP.rollRate, SHIP.rollAccel, k) * SHIP.rollRate + feed;
  ship.control.roll = clamp(w / SHIP.rollRate, -1, 1);
  return Math.abs(err);
};

// --- внутри станции -----------------------------------------------------------
//
// В зале компьютер летает, как посадочный над телом: брюхом к полу, нос —
// по горизонтали туда, куда надо, вертикаль — подъёмными. Всё в осях
// станции и в метрах планировки; скорость корабля в зале — уже
// относительно зала (js/game/berth.js).

// Высота полёта над полом зала, м: выше терминала (14 м) и выше самого
// высокого корабля, стоящего на площадке («Прометей» — 66 м), с запасом.
const CRUISE_Y = 90;
// Скорости в зале, м/с: по тоннелю, по залу и спуск.
const V_TUNNEL = 45, V_HALL = 55, V_DOWN = 9;

const _tgt = v3(), _fw = v3(), _hv = v3();

/** Нос — по горизонтали станции на точку (м, оси станции), брюхо — к полу. */
function hallSteer(ship, st, p, at) {
  const dx = at[0] - p[0], dz = at[2] - p[2];
  const l = Math.hypot(dx, dz);
  if (l > 0.5) {
    _fw.x = st.basis.right.x * dx / l + st.basis.fwd.x * dz / l;
    _fw.y = st.basis.right.y * dx / l + st.basis.fwd.y * dz / l;
    _fw.z = st.basis.right.z * dx / l + st.basis.fwd.z * dz / l;
  } else {
    // На месте — курс прежний, лишь бы брюхом вниз.
    const u = st.basis.up, f = ship.basis.fwd, k = f.x * u.x + f.y * u.y + f.z * u.z;
    _fw.x = f.x - u.x * k; _fw.y = f.y - u.y * k; _fw.z = f.z - u.z * k;
  }
  return alignBasis(ship, _fw, st.basis.up);
}

/** Вертикаль подъёмными: к заданной вертикальной скорости (м/с). */
function liftTo(ship, vUpWant, z) {
  const full = Math.max(SHIP.liftMin, BERTH.g * SHIP.liftTWR);
  ship.control.lift = clamp((vUpWant / 1000 - z.vUp) * 1.2 / full, -1, 1);
}

/**
 * Докинг-компьютер внутри станции: тоннель → зал → над площадкой → вниз.
 * На вылет (d.out) — наоборот: вверх → к тоннелю → наружу.
 */
function updateInside(ship, d, dt) {
  const st = d.station;
  const Lt = st.layout;
  const z = hallZone(ship, st);
  const p = z.local;
  const pad = d.pad ? padByNo(Lt, d.pad) : null;
  const hall = Lt.hall;
  const cruise = Lt.floor + CRUISE_Y;
  const k = (v) => clamp(v / 1000 / SHIP.maxSpeed, 0, 1);

  if (d.out) {
    // Вылет: подняться на ось тоннеля, к нему — и по тоннелю наружу.
    if (d.phase === 'climb') {
      hallSteer(ship, st, p, [p[0], 0, p[2]]);
      liftTo(ship, clamp((0 - p[1]) / 4, -12, 18), z);
      ship.throttle = 0;
      if (p[1] > -12) d.phase = 'toTunnel';
      return L('ДОКИНГ-КОМПЬЮТЕР: ПОДЪЁМ ') + Math.max(0, -p[1]).toFixed(0) + L(' м');
    }
    const entry = [0, 0, hall.hi[2] - 60];
    if (d.phase === 'toTunnel') {
      const dist = Math.hypot(entry[0] - p[0], entry[2] - p[2]);
      const err = hallSteer(ship, st, p, entry);
      liftTo(ship, clamp(-p[1] / 4, -10, 10), z);
      ship.throttle = err > 0.35 ? 0 : k(clamp(dist / 5, 6, V_HALL));
      if (dist < 25) d.phase = 'outbound';
      return L('ДОКИНГ-КОМПЬЮТЕР: К ТОННЕЛЮ ') + dist.toFixed(0) + L(' м');
    }
    // По тоннелю — на ось и наружу; за створом компьютер отпускает сам
    // (js/main.js: корабль вне станции — ship.docking снят).
    const far = [0, 0, Lt.face + 2000];
    const err = hallSteer(ship, st, p, [-p[0] * 4, 0, far[2]]);
    liftTo(ship, clamp(-p[1] / 3, -8, 8), z);
    ship.throttle = err > 0.3 ? 0 : k(V_TUNNEL);
    return L('ДОКИНГ-КОМПЬЮТЕР: ВЫЛЕТ ПО ТОННЕЛЮ ') + Math.max(0, Lt.face - p[2]).toFixed(0) + L(' м');
  }

  // Заход: из тоннеля — в зал по оси.
  if (d.phase === 'tunnel') {
    // В зал — целиком: корма длинного корабля («Прометей» — 83 м за центром
    // масс) ещё в тоннеле, когда центр уже в зале, и снижаться раньше —
    // значит зацепить кормой пол тоннеля.
    const into = [0, 0, hall.hi[2] - Math.max(-HULL.lo.z, HULL.hi.z) * 1000 - 25];
    const dist = Math.max(0, p[2] - into[2]);
    const err = hallSteer(ship, st, p, [-p[0] * 4, 0, into[2] - 200]);
    liftTo(ship, clamp(-p[1] / 3, -8, 8), z);
    ship.throttle = err > 0.3 ? 0 : k(clamp(dist / 4, 12, V_TUNNEL));
    if (p[2] < into[2] + 5) d.phase = pad ? 'cruise' : 'hold';
    return L('ДОКИНГ-КОМПЬЮТЕР: ТОННЕЛЬ ') + dist.toFixed(0) + L(' м');
  }
  if (!pad) {
    // Площадки ещё нет (порт не ответил): висим на высоте перелёта.
    hallSteer(ship, st, p, p);
    liftTo(ship, clamp((cruise - p[1]) / 4, -10, 10), z);
    ship.throttle = 0;
    return L('ДОКИНГ-КОМПЬЮТЕР: ЖДЁМ ПЛОЩАДКУ');
  }
  const over = [pad.c[0], cruise, pad.c[2]];
  const hd = Math.hypot(over[0] - p[0], over[2] - p[2]);
  if (d.phase === 'cruise') {
    const err = hallSteer(ship, st, p, over);
    liftTo(ship, clamp((cruise - p[1]) / 4, -12, 12), z);
    // Тормозить заранее: на последних метрах — не быстрее метра в
    // секунду на метр, иначе тяжёлый корабль проскочит площадку.
    ship.throttle = err > 0.3 ? 0 : k(clamp(hd / 3, 0, V_HALL));
    if (hd < 6 && z.hSpeed * 1000 < 3) d.phase = 'descend';
    return L('ДОКИНГ-КОМПЬЮТЕР: К ПЛОЩАДКЕ ') + pad.n + ' · ' + hd.toFixed(0) + L(' м');
  }
  // Спуск: шасси, брюхом вниз, над серединой площадки.
  ship.gear.out = true;
  hallSteer(ship, st, p, hd > 3 ? over : p);
  const alt = p[1] - z.floor - SHIP.gearClear * 1000;
  liftTo(ship, -clamp(alt / 4, 2, V_DOWN), z);
  ship.throttle = hd > 3 ? k(clamp(hd / 3, 0, 6)) : 0;
  return L('ДОКИНГ-КОМПЬЮТЕР: ПОСАДКА НА ПЛОЩАДКУ ') + pad.n + ' · ' + Math.max(0, alt).toFixed(0) + L(' м');
}

/**
 * Ведёт корабль в порт. Пишет в ship.control / ship.throttle.
 * @returns строка статуса для HUD
 */
export function updateDockingComputer(ship, dt) {
  const d = ship.docking;
  if (!d) return null;
  const st = d.station;
  // Внутри станции — свой полёт: в зале, к площадке и обратно.
  if (ship.berth && ship.berth.st === st) {
    if (!['tunnel', 'cruise', 'descend', 'hold', 'climb', 'toTunnel', 'outbound'].includes(d.phase)) d.phase = 'tunnel';
    return updateInside(ship, d, dt);
  }
  const p = stationLocal(ship, st);
  // Снос — от середины полосы, в которой корпус проходит (slotFit), а не
  // от оси щели: у «Прометея» она на 10 м ниже.
  const fit = slotFit();
  const ex = p.x - fit.x, ey = p.y - fit.y;
  const lateral = Math.hypot(ex, ey);
  const b = st.basis;
  const band = steerBand();

  // Мировой вектор бокового смещения от оси порта — его и гасим.
  const latX = b.right.x * ex + b.up.x * ey;
  const latY = b.right.y * ex + b.up.y * ey;
  const latZ = b.right.z * ex + b.up.z * ey;

  const D = st.shape.D;
  const GATE_Z = D + GATE_GAP;
  // Подход с обратной стороны: сначала обходим станцию сбоку, иначе
  // прямая на створ прошла бы сквозь корпус.
  if (d.phase !== 'enter' && p.z < D + 0.3) d.phase = 'skirt';
  // Промахнулись в створ — уходим на повторный круг, а не в обшивку.
  if (d.phase === 'enter' && p.z < D + 0.02 && lateral > SLOT.hw * 0.7) {
    d.phase = 'skirt';
  }
  // Не вписывается в щель — на второй заход, пока нос перед створом
  // (decideAt): назад к точке ожидания, а не в обход.
  if (d.phase === 'enter' && p.z > D + 0.3 && p.z < D + decideAt()
    && (Math.abs(ex) > fit.mx * 0.8 || Math.abs(ey) > fit.my * 0.8)) {
    d.phase = 'hold';
    d.again = true;
  }

  if (d.phase === 'skirt') {
    let ux = p.x, uy = p.y;
    const l = Math.hypot(ux, uy);
    if (l < 0.05) { ux = 1; uy = 0; } else { ux /= l; uy /= l; }
    // Обход берём заведомо снаружи любого корпуса: у «Орбиса» кольцо
    // шириной в два километра, и четырёх километров хватает обоим.
    const skirt = stationPoint(st, ux * 4, uy * 4, GATE_Z + st.shape.bound);
    const dist = distTo(ship, skirt);
    const off = aimAt(ship, skirt);
    levelRoll(ship);
    ship.throttle = clamp(
      (Math.min(dist / 10, off > 0.3 ? 0.25 : SHIP.maxSpeed)) / SHIP.maxSpeed, 0, 1);
    if (dist < 0.5) d.phase = 'gate';
    return L('ДОКИНГ-КОМПЬЮТЕР: ОБХОД СТАНЦИИ ') + dist.toFixed(1) + L(' км');
  }

  if (d.phase === 'gate') {
    const gate = stationPoint(st, 0, 0, GATE_Z);
    const dist = distTo(ship, gate);
    const off = aimAt(ship, gate);
    levelRoll(ship);
    ship.throttle = clamp(
      (Math.min(dist / 8, off > 0.25 ? 0.25 : SHIP.maxSpeed)) / SHIP.maxSpeed, 0, 1);
    if (dist < 0.25) d.phase = 'hold';
    return L('ДОКИНГ-КОМПЬЮТЕР: ПОДХОД К СТВОРУ ') + dist.toFixed(1) + L(' км');
  }

  if (d.phase === 'hold') {
    // Держимся на оси порта в километре от створа и подгоняем крен.
    // Требовать нос точно по оси здесь нельзя: чтобы не отставать от
    // станции, нос смотрит немного «в дрейф».
    // Усиления — в долях полосы наведения (steerBand): у «Челленджера»
    // это прежние 0.35 и 0.2.
    const rollErr = matchRoll(ship, st);
    const gl = band * 0.7, gz = band * 0.4;
    _vec.x = st.vel.x - latX * gl + b.fwd.x * (GATE_Z - p.z) * gz;
    _vec.y = st.vel.y - latY * gl + b.fwd.y * (GATE_Z - p.z) * gz;
    _vec.z = st.vel.z - latZ * gl + b.fwd.z * (GATE_Z - p.z) * gz;
    flyAligned(ship, _vec, 1.6);
    // Входить — со сносом не больше двух третей запаса до рамы: треть
    // остаётся на то, что набежит по дороге. У «Челленджера» это прежние
    // 20 м, у крейсера — 10.
    if (lateral < Math.min(0.02, Math.min(fit.mx, fit.my) * 2 / 3) && rollErr < 0.10) d.phase = 'enter';
    return (d.again ? L('ДОКИНГ-КОМПЬЮТЕР: ВТОРОЙ ЗАХОД, снос ') : L('ДОКИНГ-КОМПЬЮТЕР: ВЫРАВНИВАНИЕ, снос '))
      + (lateral * 1000).toFixed(0) + L(' м, крен ') + (rollErr * 57.3).toFixed(0) + '°';
  }

  // enter: сближение по оси со скоростью, привязанной к остатку пути,
  // плюс скорость станции и гашение бокового сноса. Скорость — в долях
  // полосы наведения: на подход уходит одно и то же число постоянных
  // времени носа, и крейсер, который доворачивает вдвое дольше, идёт к
  // створу вдвое медленнее. У «Челленджера» (полоса 0.5/с) — прежние
  // 1/8 остатка в секунду, от 30 до 120 м/с.
  const gap = p.z - D;
  const slow = band / 0.5;
  const closing = clamp(gap / 8 * slow, 0.03 * slow, 0.12 * slow);
  matchRoll(ship, st, 2.2);
  _vec.x = st.vel.x - b.fwd.x * closing - latX * band;
  _vec.y = st.vel.y - b.fwd.y * closing - latY * band;
  _vec.z = st.vel.z - b.fwd.z * closing - latZ * band;
  flyAligned(ship, _vec, 2.0);
  return L('ДОКИНГ-КОМПЬЮТЕР: ВХОД ') + (Math.max(0, gap) * 1000).toFixed(0)
    + L(' м, снос ') + (lateral * 1000).toFixed(0) + L(' м');
}
