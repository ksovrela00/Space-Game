// Корпус, на котором летим: сетка, стойки и всё, что из них выводится.
//
// Раньше корпус был один, и его числа — полуразмеры, просвет, пяты
// шасси, оболочка щита, масса — лежали константами в js/models/ships.js.
// Теперь кораблей два типа, и тип — это вопрос данных: какой корабль у
// пилота, говорит сервер (player.state, ship.type), а игра берёт числа у
// ТЕКУЩЕГО корпуса отсюда. Объект один и тот же на всю игру (как SHIP):
// на него смотрят по ссылке, и смена корпуса меняет его поля, а не его
// самого.
//
// Константы «Челленджера» в ships.js остались — они и есть его числа, и
// проверки сверяют с ними. Игра их больше не читает.

import { v3 } from '../core/vec3.js';
import { hullOf } from '../models/hulls.js';
import {
  extentOf, shieldAxesOf, gunPortsOf, HULL_DENSITY, HULL_VOLUME_M3, HULL_HALF,
} from '../models/ships.js';
import { HULL_LENGTH } from '../models/hull.data.js';

export const HULL = { code: null };

/**
 * Корпус, под который рассчитаны модули (их числа в server/data/specs.php
 * написаны для него: «полграмма на оконечностях корпуса в 67 м»). От него
 * меряется, во сколько раз другой корпус больше — см. scale в ship.js.
 */
export const REF = {
  volume: HULL_VOLUME_M3,
  half: HULL_HALF,
  length: HULL_LENGTH,
};

/**
 * Встать на корпус типа code. Возвращает HULL; неизвестный тип — тот же
 * «Челленджер», а не пустое место: тип приходит с сервера, и корабль без
 * корпуса — это падение игры на первом кадре.
 */
export function setHull(code) {
  const H = hullOf(code) || hullOf('challenger');
  if (HULL.code === H.code && HULL.mesh === H.mesh) return HULL;
  const mesh = H.mesh, gear = H.gear;
  const e = extentOf(mesh.verts);
  HULL.code = H.code;
  HULL.mesh = mesh;
  HULL.gear = gear;
  HULL.cockpit = !!H.cockpit;         // пост пилота с экранами (js/models/cockpit.js)
  HULL.rooms = !!H.rooms;             // помещения, шлюзы, трапы (js/models/interior.js)
  HULL.lo = e.lo;                     // км, крайние точки в осях корпуса
  HULL.hi = e.hi;
  HULL.half = e.half;                 // км, по модулю от центра масс
  HULL.size = e.size;                 // км, габарит
  HULL.length = mesh.length;          // км
  // Просветы: на брюхе — до самой низкой точки обшивки, на шасси — до пят.
  HULL.clear = -e.lo.y;
  HULL.gearClear = gear.legLengths[0] - gear.hardpoints[0].y;
  HULL.feet = gear.hardpoints.map((h) => v3(h.x, -HULL.gearClear, h.z));
  // Масса — из объёма той же плотностью, что у «Челленджера».
  HULL.volume = mesh.volumeM3;        // м³
  HULL.mass = HULL.volume * HULL_DENSITY;   // кг
  // Во сколько раз корпус «крупнее» того, под который рассчитаны модули:
  // корень кубический из отношения объёмов. У подобных тел это отношение
  // длин; у «Прометея» — 2.8 (длиннее он втрое, но тоньше в поясе).
  HULL.k = Math.cbrt(HULL.volume / REF.volume);
  HULL.shield = shieldAxesOf(mesh.verts, e.size);
  HULL.guns = gunPortsOf(e.size);
  HULL.eye = mesh.eye;                // км, глаз пилота (кокпит или мостик)
  HULL.exhausts = mesh.exhausts;
  return HULL;
}

/** Нос корпуса — насколько он впереди центра масс, км. */
export const noseOf = () => HULL.hi.z;

// До того, как сервер скажет, на чём летит пилот, — корабль по умолчанию:
// первый в списке корпусов (js/game/specs.js) и он же тот, на котором
// начинают. Пустой корпус дал бы NaN в просветах на первом же кадре.
setHull('challenger');
