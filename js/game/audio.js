// Что именно звучит в каждый момент полёта.
//
// Разделение такое же, как везде в проекте: js/core/sound.js — это
// «железо» (генераторы, фильтры, WebAudio), а здесь живут правила —
// какой у движков ход, когда корпус скрипит и почему. Правила обязаны
// считаться без всякого звукового контекста: тогда их видно в отладке и
// можно проверить в node, а не только ухом в браузере.
//
// Поэтому кадр разбит надвое: updateAudio() считает МИКС (непрерывные
// уровни) и копит РАЗОВЫЕ события, playAudio() отдаёт посчитанное в
// синтез. Между ними нет ничего, что нельзя было бы напечатать.

import { clamp, approach } from '../core/vec3.js';
import { makeRng } from '../core/rng.js';
import { SHIP } from './ship.js';
import { LEVELS } from './cruise.js';
import { ST } from './state.js';

export const AUDIO = {
  idle: 0.22,        // ход двигателей на холостых: тишины в кокпите не бывает
  smooth: 9,         // 1/с — с какой скоростью уровни догоняют цель
  // Корпус жалуется, когда скорость меняют резко. Порог выбран между
  // двумя числами модели корабля: больше, чем может ОДИН канал тяги
  // (accel 0.45, lateral 0.5, brake 0.75), но меньше, чем все сразу
  // (tormoz и занос вместе дают hypot(0.75, 0.5) = 0.90). Отсюда и
  // смысл звука: обычный полёт, включая торможение в пол, молчит, а
  // разворот на полном ходу с оттормаживанием — уже слышно. Ниже 0.75
  // скрежет сопровождал бы каждую остановку и не значил бы ничего.
  jerkFloor: 0.88,   // км/с²
  jerkFull: 6.0,     // здесь скрежет в полную силу
  jerkGap: 0.45,     // с — не чаще, иначе трение превращается в треск
  // Побитый корпус скрипит сам по себе. Чем меньше его осталось, тем
  // чаще: это единственный прибор, который слышно, не глядя на панель.
  fatigueHull: 78,   // %
  fatigueMin: 3.0,   // с — интервал при почти разрушенном корпусе
  fatigueMax: 17,    // с — у самого порога
  // На стоянке металл остывает и щёлкает. Чистая декорация, но именно
  // она не даёт станции и грунту звучать как выключенная игра.
  coolMin: 6,
  coolMax: 24,
  quiet: 0.4,        // с тишины после явного удара: он и так громкий
};

export function makeAudio(seed = 0x51ee7) {
  return {
    on: true,
    vol: 0.7,
    started: false,
    // Непрерывная часть. Хранится сглаженной: цель считается заново
    // каждый кадр, а ухо не терпит ступенек.
    mix: {
      engine: 0, pitch: 0, roar: 0,
      drive: 0, drivePitch: 0,
      thrust: 0, thrustPitch: 0.5,
      station: 0,
    },
    events: [],        // что сыграть разово в этом кадре
    rng: makeRng(seed),
    vel: { x: 0, y: 0, z: 0 },
    accel: 0,          // км/с² за последний кадр — по нему скрипит корпус
    hasVel: false,
    cruiseIndex: 0,
    gearMoving: false,
    creakGap: 0,       // сколько ещё нельзя скрипеть от нагрузки
    fatigue: 8,        // до следующего скрипа усталости
    cool: 12,          // до следующего щелчка остывающего металла
    quiet: 0,          // тишина после явного удара
  };
}

/** Забыть прошлый вектор скорости: телепорт и вылет — не удар. */
export function audioReset(a, ship) {
  a.hasVel = false;
  a.accel = 0;
  a.quiet = AUDIO.quiet;
  if (ship) { a.vel.x = ship.vel.x; a.vel.y = ship.vel.y; a.vel.z = ship.vel.z; a.hasVel = true; }
}

// Очередь копится за кадр и разбирается в playAudio. Предел нужен на
// случай, если звук вообще не разбирают (нет WebAudio, вкладка в фоне):
// без него список рос бы до конца сессии.
const push = (a, e) => { if (a.on && a.events.length < 32) a.events.push(e); };

/**
 * Разовое событие игры -> звук. Вызывается из main.js там же, где
 * меняется состояние: так звук не приходится угадывать по признакам.
 *
 * @param kind hit | land | belly | crash | dock | launch | gear |
 *             takeoff | cruise
 */
export function audioCue(a, kind, opts = {}) {
  const dmg = clamp((opts.damage || 0) / 30, 0, 1);
  switch (kind) {
    case 'hit':
      // Удар о грунт: сначала масса приняла нагрузку, следом рвётся
      // обшивка. Чем крепче приложились, тем ниже и дольше скрежет.
      push(a, { kind: 'clunk', gain: 0.45 + 0.55 * dmg, freq: 190 - 70 * dmg, dur: 0.3 + 0.35 * dmg });
      push(a, { kind: 'creak', gain: 0.35 + 0.6 * dmg, freq: 420 - 260 * dmg, rough: 0.75, dur: 0.35 + 0.9 * dmg });
      a.quiet = AUDIO.quiet;
      break;
    case 'land':
      push(a, { kind: 'clunk', gain: 0.35, freq: 130, dur: 0.28 });
      push(a, { kind: 'creak', gain: 0.2, freq: 150, rough: 0.5, dur: 0.5 });
      a.quiet = AUDIO.quiet;
      break;
    case 'belly':
      // Посадка брюхом — это не удар, а долгое чирканье по грунту.
      push(a, { kind: 'creak', gain: 0.75, freq: 320, rough: 0.9, dur: 1.5 });
      push(a, { kind: 'clunk', gain: 0.4, freq: 110, dur: 0.4 });
      a.quiet = AUDIO.quiet;
      break;
    case 'crash':
      push(a, { kind: 'clunk', gain: 1, freq: 90, dur: 0.8 });
      push(a, { kind: 'creak', gain: 1, freq: 130, rough: 0.95, dur: 2.2 });
      push(a, { kind: 'creak', gain: 0.7, freq: 520, rough: 0.95, dur: 1.3 });
      a.quiet = 1.5;
      break;
    case 'dock':
      // Захваты порта — свой лязг: ни на удар, ни на посадку не похож.
      push(a, { kind: 'clamp', gain: 0.6 });
      push(a, { kind: 'servo', dur: 1.6, up: false });
      a.quiet = AUDIO.quiet;
      break;
    case 'launch':
      push(a, { kind: 'clunk', gain: 0.35, freq: 140, dur: 0.3 });
      break;
    case 'takeoff':
      push(a, { kind: 'clunk', gain: 0.3, freq: 160, dur: 0.25 });
      push(a, { kind: 'creak', gain: 0.25, freq: 260, rough: 0.6, dur: 0.4 });
      break;
    case 'gear':
      // Привод, а в конце — защёлка: без неё непонятно, довыпустилось ли.
      push(a, { kind: 'servo', dur: SHIP.gearTime, up: !!opts.out });
      push(a, { kind: 'clunk', gain: 0.28, freq: 220, dur: 0.18, delay: SHIP.gearTime });
      break;
    case 'cruise':
      push(a, { kind: 'spool', up: opts.dir > 0, level: clamp(opts.level || 0, 0, 1) });
      break;
    default: break;
  }
}

/**
 * Пересчитать звуковую картину кадра.
 * @param dt реальный шаг кадра (не шаг физики): звук идёт по времени игрока
 */
export function updateAudio(a, game, dt) {
  // Очередь тут НЕ чистится. Явные события (удар, стыковка, шасси)
  // кладутся в неё из main.js раньше в том же кадре — в шаге физики и
  // в разборе клавиш, — и чистка в начале кадра их бы молча съедала.
  // Забирает и чистит очередь ровно один раз playAudio.
  const ship = game.ship;
  const mode = game.state.mode;
  const flying = mode === ST.FLIGHT;

  a.creakGap = Math.max(0, a.creakGap - dt);
  a.quiet = Math.max(0, a.quiet - dt);

  // --- насколько резко изменилась скорость: это и нагрузка на корпус,
  // и признак того, что движки работают на пределе.
  if (a.hasVel && dt > 1e-4) {
    const dx = ship.vel.x - a.vel.x, dy = ship.vel.y - a.vel.y, dz = ship.vel.z - a.vel.z;
    a.accel = Math.hypot(dx, dy, dz) / dt;
  } else {
    a.accel = 0;
  }
  a.vel.x = ship.vel.x; a.vel.y = ship.vel.y; a.vel.z = ship.vel.z;
  a.hasVel = true;

  // Тяга работает «в упор», пока корабль ещё не набрал заданную скорость:
  // ровно это ухо и слышит как натугу, а не сам факт движения.
  const strain = clamp(a.accel / SHIP.accel, 0, 1.4);
  const thr = Math.abs(ship.throttle);

  // Вход в атмосферу слышно раньше, чем видно: сначала шум обшивки,
  // потом уже свечение. Отдельного голоса не заводим — это тот же шум
  // сопел, только его источник другой, и он громче всего, что может
  // выдать двигатель.
  const entry = flying && game.entry ? game.entry.heat : 0;

  const m = a.mix;
  let engine = 0, pitch = 0, roar = 0;
  if (flying) {
    engine = AUDIO.idle + (1 - AUDIO.idle) * thr;
    pitch = 0.08 + 0.72 * thr + 0.2 * strain * thr;
    roar = 0.25 + 0.75 * thr;
    // Задний ход — те же движки против своей геометрии: тон ниже,
    // шума больше. Об этом прямо сказано в модели корабля, и звук
    // обязан это подтверждать, иначе задний ход неотличим на слух.
    if (ship.throttle < 0) { pitch *= 0.55; roar = Math.min(1, roar + 0.3); }
    if (entry > 0) {
      roar = Math.min(1, roar + entry * 1.2);
      engine = Math.min(1, engine + entry * 0.5);
      pitch = Math.min(1, pitch + entry * 0.25);
    }
  }
  // В порту двигатели заглушены — вместо них фоном идёт сама станция.
  // Смена фона и есть признак того, что корабль больше не свой хозяин.
  const station = mode === ST.DOCKED ? 1 : 0;
  // На грунте и после крушения — тишина: в ней и слышен остывающий металл.

  // Круизный ускоритель. Mass lock его глушит, и это слышно раньше,
  // чем читается надпись на панели.
  const maxIdx = LEVELS.length - 1;
  const idx = flying && !game.cruise.massLocked ? game.cruise.index : 0;
  const drive = idx / maxIdx;

  // Подъёмные движки: ручка, а не результат — по ней и ход шипения.
  const lift = flying ? clamp(ship.control ? ship.control.lift : 0, -1, 1) : 0;

  const k = AUDIO.smooth;
  m.engine = approach(m.engine, engine, k, dt);
  m.pitch = approach(m.pitch, clamp(pitch, 0, 1), k, dt);
  m.roar = approach(m.roar, clamp(roar, 0, 1), k, dt);
  m.drive = approach(m.drive, drive, k * 0.7, dt);
  m.drivePitch = approach(m.drivePitch, drive, k * 0.7, dt);
  m.thrust = approach(m.thrust, Math.abs(lift), k * 2, dt);
  m.thrustPitch = approach(m.thrustPitch, lift > 0 ? 1 : (lift < 0 ? 0 : 0.5), k * 2, dt);
  m.station = approach(m.station, station, k * 0.4, dt);

  // --- ступень ускорителя сменилась: разгон или сброс слышны свистом.
  if (flying && game.cruise.index !== a.cruiseIndex) {
    audioCue(a, 'cruise', {
      dir: game.cruise.index > a.cruiseIndex ? 1 : -1,
      level: game.cruise.index / maxIdx,
    });
  }
  a.cruiseIndex = game.cruise.index;

  // --- скрежет от нагрузки.
  if (flying && a.quiet <= 0 && a.creakGap <= 0 && a.accel > AUDIO.jerkFloor) {
    const t = clamp((a.accel - AUDIO.jerkFloor) / (AUDIO.jerkFull - AUDIO.jerkFloor), 0, 1);
    push(a, {
      kind: 'creak',
      gain: 0.18 + 0.5 * t,
      freq: 380 - 210 * t,          // чем сильнее нагрузка, тем ниже стон
      rough: 0.5 + 0.35 * t,
      dur: 0.3 + 0.8 * t,
    });
    a.creakGap = AUDIO.jerkGap;
  }

  // --- усталость побитого корпуса.
  if (flying && ship.hull < AUDIO.fatigueHull) {
    a.fatigue -= dt;
    if (a.fatigue <= 0) {
      const wear = clamp(1 - ship.hull / AUDIO.fatigueHull, 0, 1);
      a.fatigue = AUDIO.fatigueMin + (AUDIO.fatigueMax - AUDIO.fatigueMin) * (1 - wear) *
        a.rng.range(0.6, 1.4);
      push(a, {
        kind: 'creak',
        gain: 0.12 + 0.3 * wear,
        freq: a.rng.range(140, 300),
        rough: 0.8,
        dur: a.rng.range(0.5, 1.4),
      });
    }
  } else {
    a.fatigue = AUDIO.fatigueMin + (AUDIO.fatigueMax - AUDIO.fatigueMin) * 0.5;
  }

  // --- остывающий металл на стоянке.
  if (mode === ST.LANDED || mode === ST.DOCKED) {
    a.cool -= dt;
    if (a.cool <= 0) {
      a.cool = a.rng.range(AUDIO.coolMin, AUDIO.coolMax);
      push(a, {
        kind: 'creak',
        gain: a.rng.range(0.06, 0.16),
        freq: a.rng.range(260, 700),
        rough: 0.85,
        dur: a.rng.range(0.12, 0.4),
      });
    }
  } else {
    a.cool = a.rng.range(AUDIO.coolMin, AUDIO.coolMax);
  }

  return m;
}

/** Отдать посчитанное в синтез. Единственное место, знающее про WebAudio. */
export function playAudio(a, sound) {
  if (!sound || !sound.ok) { a.events.length = 0; return; }
  const m = a.mix;
  sound.engine(a.on ? m.engine : 0, m.pitch, a.on ? m.roar : 0);
  sound.drive(a.on ? m.drive : 0, m.drivePitch);
  sound.thrust(a.on ? m.thrust : 0, m.thrustPitch);
  sound.ambient(a.on ? m.station : 0);
  for (const e of a.events) {
    switch (e.kind) {
      case 'creak': sound.creak(e.gain, e.freq, e.rough, e.dur); break;
      case 'clunk': sound.clunk(e.gain, e.freq, e.dur, e.delay || 0); break;
      case 'clamp': sound.clamp(e.gain); break;
      case 'servo': sound.servo(e.dur, e.up); break;
      case 'spool': sound.spool(e.up, e.level); break;
      default: break;
    }
  }
  a.events.length = 0;
}

/** Строка для отладочного оверлея. */
export function audioLine(a, sound) {
  const m = a.mix;
  const state = !a.on ? 'выкл' : (sound && sound.ok ? 'вкл' : 'ждёт жеста');
  const src = sound && sound.sampled ? 'сэмплы' : 'синтез';
  return `звук ${state} (${src}) ${Math.round(a.vol * 100)}%  движки ${m.engine.toFixed(2)}/` +
    `${m.pitch.toFixed(2)}  круиз ${m.drive.toFixed(2)}  подъём ${m.thrust.toFixed(2)}  ` +
    `нагрузка ${a.accel.toFixed(2)} км/с²`;
}
