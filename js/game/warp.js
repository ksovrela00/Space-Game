// Варп-привод: перелёт между звёздными системами.
//
// От квантового привода (js/game/quantum.js) отличается не масштабом, а
// смыслом. Квантовый ВЕДЁТ корабль: считает точку выхода, проверяет
// коридор, двигает позицию. Варп корабль никуда не ведёт — во время
// прыжка координаты не значат ничего, потому что старой системы уже нет,
// а новая ещё не собрана.
//
// Поэтому главное событие здесь не «долетели», а 'handover' — момент,
// когда снаружи надо выгрузить старую систему и собрать новую. Сам
// модуль ни того, ни другого не делает и про мир не знает: он только
// говорит, КОГДА. Так это и должно работать в сетевой игре, где систему
// пришлёт сервер, а не соберёт клиент.
//
// Тоннель длится десятки секунд ровно затем, чтобы под ним успела
// смениться система. Это не украшение, а укрытие.

import { v3, normalize } from '../core/vec3.js';
import { aimAngles, lookAlong } from '../core/basis.js';
import { systemDir, systemDistance, warpSeconds } from './galaxy.js';

export const WARP = {
  // Допуск по прицелу. 2.5° держать рукой тяжело: камера из-за спины
  // догоняет корабль с запаздыванием, и «точно в центре» на глаз — это
  // уже пара градусов промаха. У квантового привода 3°, здесь чуть шире:
  // там цель видно объектом, здесь — только отметкой.
  align: 4 * Math.PI / 180,     // рад
  spool: 4,                     // с — раскрутка привода при верном прицеле
  fade: 0.45,                   // доля готовности, теряемая за секунду мимо
  // Рывок: первую секунду корабль разгоняется по-настоящему и видно, как
  // система проваливается за корму. Дальше положение замирает — лететь
  // уже некуда и не в чем.
  lurch: 1.1,                   // с
  lurchSpeed: 9.0e5,            // км/с на пике рывка
  open: 1.3,                    // с — за сколько раскрывается тоннель
  close: 2.6,                   // с — за сколько он гаснет перед выходом
  // Доля пути, на которой меняется система. Тоннель к этому моменту
  // непрозрачен (open много меньше), а до гашения остаётся больше
  // половины времени — столько идёт прогрев мешей новой системы.
  handover: 0.3,
  handoverMin: 2.5,             // с — но не раньше этого, каким бы коротким ни был прыжок
  // Выход — в четырёх радиусах звезды. Она занимает там почти тридцать
  // градусов неба: прилёт обязан читаться как «приехали к звезде», а не
  // как «вынырнули где-то». Ближе нельзя — четыре радиуса это ещё и
  // запас на корону в будущем.
  exitR: 4,
};

export const makeWarp = () => ({
  phase: 'idle',      // idle | align | tunnel
  from: null,         // описание системы, откуда летим
  to: null,           // куда
  calib: 0,           // 0..1 — раскрутка привода
  aligned: false,     // нос в допуске
  t: 0,               // сколько уже в тоннеле, с
  total: 0,           // сколько всего идёт прыжок, с
  handed: false,      // систему уже сменили
  reason: '',
  flash: 0,           // 0..1 — вспышка входа и выхода
  punch: 0,           // 0..1 — удар по полю зрения
  power: 0,           // 0..1 — насколько раскрыт тоннель
  flow: 0,            // фаза потока, копится здесь, а не в сцене
  dir: v3(),          // ось прыжка в мировых осях
});

/** Ось прыжка: единичный вектор от текущей системы к цели. */
export const warpAxis = (from, to, out = v3()) => systemDir(from, to, out);

/** Насколько нос отклонён от оси прыжка, рад. */
export function offWarpAxis(ship, from, to) {
  const d = warpAxis(from, to, _axis);
  const ang = aimAngles(ship.basis, d);
  return Math.hypot(ang.pitch, ang.yaw);
}

const _axis = v3();

/**
 * Можно ли начать прыжок. Проверок намеренно мало.
 *
 * Привязки к массе рядом («mass lock») здесь НЕТ, хотя в играх этого
 * жанра она обычна. В этом проекте её однажды уже убрали вместе с
 * круизным множителем: она протекала во все подсистемы разом, и каждую
 * приходилось учить с ней жить (см. «Статус» в README). Возвращать её
 * ради одной кнопки незачем — прицел и так требует развернуть корабль,
 * а это и есть настоящее ограничение.
 */
export function canWarp(ship, from, to) {
  if (!to) return { ok: false, reason: 'ЦЕЛЬ ВАРПА НЕ ВЫБРАНА: M, ЗАТЕМ G, ЗАТЕМ СИСТЕМУ' };
  if (!from || to.seed === from.seed) return { ok: false, reason: 'ВЫ УЖЕ В ЭТОЙ СИСТЕМЕ' };
  if (ship.dockedAt) return { ok: false, reason: 'СНАЧАЛА ОТСТЫКОВКА' };
  if (ship.landedAt) return { ok: false, reason: 'СНАЧАЛА ВЗЛЁТ' };
  return { ok: true };
}

export function startWarp(w, from, to) {
  w.phase = 'align';
  w.from = from;
  w.to = to;
  w.calib = 0;
  w.t = 0;
  w.total = warpSeconds(from, to);
  w.handed = false;
  w.reason = '';
  w.power = 0;
  warpAxis(from, to, w.dir);
  return w;
}

export function stopWarp(w, reason = '') {
  const was = w.phase;
  w.phase = 'idle';
  w.to = null;
  w.calib = 0;
  w.t = 0;
  w.power = 0;
  w.handed = false;
  w.reason = reason;
  if (was === 'tunnel') w.flash = 1;
  return was;
}

/** Сколько секунд осталось до выхода (0, если прыжок не идёт). */
export const warpLeft = (w) => (w.phase === 'tunnel' ? Math.max(0, w.total - w.t) : 0);

/** Момент смены системы, с от начала тоннеля. */
export const handoverAt = (w) => Math.max(WARP.handoverMin, w.total * WARP.handover);

/**
 * Насколько раскрыт тоннель, 0..1.
 *
 * Считается отдельной функцией, потому что от неё зависит не только
 * картинка: пока тоннель непрозрачен, систему можно менять незаметно, и
 * именно по этому числу сцена решает, показывать ли мир вообще.
 */
export function warpPower(w) {
  if (w.phase !== 'tunnel') return 0;
  const left = w.total - w.t;
  return Math.min(1, w.t / WARP.open, Math.max(0, left / WARP.close));
}

const _dir = v3();

/**
 * Шаг привода. Возвращает событие:
 * null | 'engage' | 'handover' | 'arrive' | 'abort'.
 *
 * 'handover' снаружи обязано означать ровно одно: выгрузить старую
 * систему и собрать новую. Возвращается оно РОВНО ОДИН раз за прыжок.
 */
export function updateWarp(w, ship, dt) {
  if (w.flash > 0) w.flash = Math.max(0, w.flash - dt * 1.4);
  if (w.punch > 0) w.punch = Math.max(0, w.punch - dt * 1.8);
  if (w.phase === 'idle') return null;
  if (!w.to || !w.from) { stopWarp(w); return 'abort'; }

  if (w.phase === 'align') {
    w.aligned = offWarpAxis(ship, w.from, w.to) <= WARP.align;
    if (w.aligned) w.calib = Math.min(1, w.calib + dt / WARP.spool);
    else w.calib = Math.max(0, w.calib - dt * WARP.fade);
    if (w.calib < 1) return null;
    const res = canWarp(ship, w.from, w.to);
    if (!res.ok) { stopWarp(w, res.reason); return 'abort'; }
    w.phase = 'tunnel';
    w.t = 0;
    w.flash = 1;
    w.punch = 1;
    warpAxis(w.from, w.to, w.dir);
    return 'engage';
  }

  // --- тоннель
  w.t += dt;
  w.power = warpPower(w);
  // Поток тем быстрее, чем шире раскрыт тоннель. Фаза копится здесь, а
  // не в сцене: иначе картинка зависела бы от частоты кадров.
  w.flow = (w.flow + dt * (0.3 + 1.7 * w.power)) % 1;

  // Рывок: корабль по-настоящему уходит по оси, и первую секунду видно,
  // как система проваливается за корму. Дальше позиция замирает —
  // двигать её некуда, старого мира уже нет, а новый ещё не собран.
  if (w.t < WARP.lurch) {
    const k = Math.sin((w.t / WARP.lurch) * Math.PI * 0.5);
    const sp = WARP.lurchSpeed * k * k;
    ship.pos.x += w.dir.x * sp * dt;
    ship.pos.y += w.dir.y * sp * dt;
    ship.pos.z += w.dir.z * sp * dt;
    ship.vel.x = w.dir.x * sp; ship.vel.y = w.dir.y * sp; ship.vel.z = w.dir.z * sp;
    ship.speed = sp;
    lookAlong(ship.basis, w.dir, ship.basis.up);
  } else {
    // Скорость приборам всё равно показывается: ход идёт, просто в
    // координатах, которых пока нет.
    ship.vel.x = w.dir.x * WARP.lurchSpeed;
    ship.vel.y = w.dir.y * WARP.lurchSpeed;
    ship.vel.z = w.dir.z * WARP.lurchSpeed;
    ship.speed = WARP.lurchSpeed;
  }

  if (!w.handed && w.t >= handoverAt(w)) {
    w.handed = true;
    return 'handover';
  }
  if (w.t >= w.total) return 'arrive';
  return null;
}

/**
 * Поставить корабль на выход из прыжка: в четырёх радиусах звезды, носом
 * на неё.
 *
 * Сторона выбирается по оси прыжка: корабль пришёл по ней, значит звезда
 * должна оказаться ровно по курсу. Случайная сторона выглядела бы как
 * подмена — тоннель вёл прямо, а вынесло вбок.
 */
export function placeAtStar(w, ship, star) {
  const R = star.radius * WARP.exitR;
  normalize(v3(w.dir.x, w.dir.y, w.dir.z), _dir);
  ship.pos.x = star.pos.x - _dir.x * R;
  ship.pos.y = star.pos.y - _dir.y * R;
  ship.pos.z = star.pos.z - _dir.z * R;
  lookAlong(ship.basis, _dir, ship.basis.up);
  ship.vel.x = 0; ship.vel.y = 0; ship.vel.z = 0;
  ship.speed = 0;
  ship.throttle = 0;
  return ship.pos;
}

/**
 * Завершить прыжок: привод гасится, ход обнуляется.
 *
 * Корабль к этому моменту уже стоит у звезды — его переставили в момент
 * смены системы (placeAtStar), а не сейчас. Но скорость всё это время
 * держалась варповой: по ней в тоннеле идёт поток частиц. Гасить её надо
 * здесь, иначе корабль вылетит из прыжка на девятистах тысячах км/с.
 */
export function finishWarp(w, ship) {
  const to = w.to;
  stopWarp(w);
  w.flash = 1;
  w.punch = 0.7;
  if (ship) {
    ship.vel.x = 0; ship.vel.y = 0; ship.vel.z = 0;
    ship.speed = 0;
    ship.throttle = 0;
  }
  return to;
}

/** Расстояние до цели, световых лет — для приборов. */
export const warpDistance = (w) => (w.from && w.to ? systemDistance(w.from, w.to) : 0);
