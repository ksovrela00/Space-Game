// Стыковка со станцией: проверка условий входа в порт, столкновения
// с корпусом и докинг-компьютер (скриптованный подлёт).

import { v3, normalize, dot, clamp } from '../core/vec3.js';
import { toLocal, toWorld } from '../core/basis.js';
import { SHIP } from './ship.js';
import { aimAt, flyVelocity, levelRoll, rateCmd } from './pilot.js';
import { SLOT } from '../models/stations.js';
import { HULL } from './hull.js';
import { L } from '../core/lang.js';

export const LIMITS = {
  speed: 0.28,     // км/с — максимальная относительная скорость входа
  align: 0.86,     // косинус угла между носом и осью порта
  roll: 0.78,      // косинус рассогласования крена (по модулю)
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
  const roll = Math.abs(dot(ship.basis.right, station.basis.right));
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
 * @returns null | 'docked' | 'crash'
 */
export function checkStation(ship, station) {
  const sh = station.shape;
  const p = stationLocal(ship, station);
  // Створ — это СЛОЙ от плоскости порта до задней стенки, а не всё
  // полупространство за ней. Без нижней границы корабль, оказавшийся на
  // оси в шестидесяти километрах ПОЗАДИ станции, считался бы вошедшим в
  // щель и стыковался мгновенно — так и было, пока проверку не написали.
  if (p.z > sh.D || p.z < -sh.D) return null;

  // Зазор в створе — по реальным обводам корпуса, а не по числу из
  // воздуха: в щель проходит корабль целиком, а не его центр (slotFit).
  // Крен станции согласован (LIMITS.roll), и оси корабля и щели
  // совпадают по модулю.
  const fit = slotFit();
  const inSlot = Math.abs(p.x - fit.x) < fit.mx && Math.abs(p.y - fit.y) < fit.my;
  if (inSlot) {
    // В створе порта: считаем стыковку состоявшейся, когда прошли раму.
    if (p.z < sh.D - 0.03) {
      const q = dockingQuality(ship, station);
      return q.ok ? 'docked' : 'crash';
    }
    return null;
  }
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

export function startDockingComputer(ship, station) {
  const d = Math.hypot(
    station.pos.x - ship.pos.x,
    station.pos.y - ship.pos.y,
    station.pos.z - ship.pos.z);
  if (d > DOCK_RANGE) return { ok: false, reason: L('СТАНЦИЯ СЛИШКОМ ДАЛЕКО — ПРЫЖОК (B)') };
  ship.docking = { station, phase: 'gate' };
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

// Согласование крена с вращающейся станцией (по модулю 180°).
const matchRoll = (ship, station, k = 2.0) => {
  const tr = station.basis.right;
  let err = Math.atan2(dot(tr, ship.basis.up), dot(tr, ship.basis.right));
  if (Math.abs(err) > Math.PI / 2) err -= Math.sign(err) * Math.PI;
  // Вперёд подаём скорость вращения станции, иначе регулятор всё время
  // отстаёт от вращающегося порта.
  const feed = station.spinRate * (dot(station.basis.fwd, ship.basis.fwd) < 0 ? 1 : -1);
  // Ошибка — по кривой торможения (js/game/pilot.js, rateCmd), вращение
  // станции — прямой подачей.
  const w = rateCmd(-err, SHIP.rollRate, SHIP.rollAccel, k) * SHIP.rollRate + feed;
  ship.control.roll = clamp(w / SHIP.rollRate, -1, 1);
  return Math.abs(err);
};

/**
 * Ведёт корабль в порт. Пишет в ship.control / ship.throttle.
 * @returns строка статуса для HUD
 */
export function updateDockingComputer(ship, dt) {
  const d = ship.docking;
  if (!d) return null;
  const st = d.station;
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
