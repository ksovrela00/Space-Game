// Фары корабля.
//
// Ламп две, и они разные по назначению, а не для красоты:
//
//   * ПРЯМАЯ светит по курсу — ею смотрят вперёд в полёте;
//   * НИЖНЯЯ наклонена вниз и шире — ею смотрят туда, куда корабль на
//     самом деле придёт на снижении. Прямая на подходе к грунту светит в
//     горизонт, то есть в пустоту.
//
// Числа — из бэкенда, как у всего остального снаряжения: фары это модуль
// (`lamp` в server/data/specs.php), и дальность, углы и яркость приезжают
// вместе с ним. Здесь только геометрия: где лампа стоит и куда смотрит.
//
// Объект LAMP ПУСТ ДО ЗАГРУЗКИ — как SHIP и QUANTUM. Значение по
// умолчанию было бы тихой ложью: фары «работали» бы не теми числами, и
// никто бы не заметил.

import { v3 } from '../core/vec3.js';
import { HULL_HALF } from '../models/ships.js';

export const LAMP = {};

const DEG = Math.PI / 180;

/**
 * Принять числа фар от бэкенда.
 *
 * Углы приходят в ГРАДУСАХ и здесь же переводятся в косинусы: градусы —
 * то, что подкручивает человек, косинус — то, чем считает шейдер. То же
 * решение, что у конуса кардана (js/game/weapons.js).
 */
export function applyLampSpec(spec) {
  for (const k of Object.keys(LAMP)) delete LAMP[k];
  Object.assign(LAMP, spec || {});
  if (typeof LAMP.coneDeg === 'number') {
    // Косинусы внутренней и внешней кромки пятна. Внутренняя — там, где
    // свет ещё полный; между ними он гаснет. Без мягкой кромки пятно
    // выглядит вырезанным ножницами.
    LAMP.cosIn = Math.cos(LAMP.coneDeg * DEG * 0.55);
    LAMP.cosOut = Math.cos(LAMP.coneDeg * DEG);
  }
  if (typeof LAMP.wideDeg === 'number') {
    LAMP.wideIn = Math.cos(LAMP.wideDeg * DEG * 0.55);
    LAMP.wideOut = Math.cos(LAMP.wideDeg * DEG);
  }
  if (typeof LAMP.tiltDeg === 'number') LAMP.tilt = LAMP.tiltDeg * DEG;
  return LAMP;
}

/** Приехали ли числа фар. */
export const lampsReady = () => typeof LAMP.range === 'number';

const _beams = [
  { pos: v3(), dir: v3(), cosIn: 0, cosOut: 0 },
  { pos: v3(), dir: v3(), cosIn: 0, cosOut: 0 },
];

/**
 * Где сейчас лампы и куда смотрят — в мировых осях.
 *
 * Обе стоят в носу: там же, где стволы, и по той же причине — луч не
 * должен упираться в собственный корпус. Нижняя наклонена на tiltDeg
 * вниз ОТ НОСА, то есть наклон живёт в осях корабля и едет вместе с
 * креном: перевернулся — и ближний свет светит в небо. Так и должно
 * быть, это фара, а не подвес.
 *
 * @returns массив лучей или пустой, если фары выключены или чисел нет
 */
export function lampBeams(ship, out = _beams) {
  if (!ship || !ship.lights || !lampsReady()) return [];
  const b = ship.basis;
  // Нос корпуса: половина длины вперёд от центра.
  const nose = HULL_HALF.z;
  const px = ship.pos.x + b.fwd.x * nose;
  const py = ship.pos.y + b.fwd.y * nose;
  const pz = ship.pos.z + b.fwd.z * nose;

  const s = Math.sin(LAMP.tilt), c = Math.cos(LAMP.tilt);

  const a = out[0];
  a.pos.x = px; a.pos.y = py; a.pos.z = pz;
  a.dir.x = b.fwd.x; a.dir.y = b.fwd.y; a.dir.z = b.fwd.z;
  a.cosIn = LAMP.cosIn; a.cosOut = LAMP.cosOut;

  const d = out[1];
  d.pos.x = px; d.pos.y = py; d.pos.z = pz;
  // Поворот вокруг поперечной оси: вперёд с наклоном вниз.
  d.dir.x = b.fwd.x * c - b.up.x * s;
  d.dir.y = b.fwd.y * c - b.up.y * s;
  d.dir.z = b.fwd.z * c - b.up.z * s;
  d.cosIn = LAMP.wideIn; d.cosOut = LAMP.wideOut;

  return out;
}
