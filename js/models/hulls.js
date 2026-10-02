// Корпуса по типам: код типа (ship_type.code на сервере) → сетка корпуса
// и стойки шасси.
//
// Зачем реестр, а не по импорту в каждом месте. Корабль соседа рисуется
// его корпусом, а не нашим: тип приходит в снимке сокета (поле ty,
// js/game/peers.js). Собирать «Прометей» (двенадцать тысяч треугольников
// и подсчёт объёма) при загрузке игры, где его, может быть, никто не
// встретит, незачем — он собирается при первой встрече и дальше лежит
// здесь. Свой корпус игра собирает сама при старте (js/main.js) и
// кладёт сюда же, чтобы не было двух одинаковых сеток.

import { buildCobra, buildGear } from './ships.js';
import { buildPrometheus, buildPrometheusGear } from './prometheus.js';

// cockpit — есть ли пост пилота с экранами (js/models/cockpit.js), rooms —
// есть ли помещения, шлюзы и трапы (js/models/interior.js; план
// «Прометея» — js/models/interior.prom.js). Пост с экранами — только у
// «Челленджера»: на «Прометее» летают из кресла командира на мостике.
const BUILD = {
  challenger: () => ({ code: 'challenger', mesh: buildCobra(), gear: buildGear(), cockpit: true, rooms: true }),
  prometheus: () => {
    const mesh = buildPrometheus();
    return { code: 'prometheus', mesh, gear: buildPrometheusGear(mesh), cockpit: false, rooms: true };
  },
};

/**
 * Тип по умолчанию — у соседа, о котором сокет не сказал, на чём он
 * летит (старый хаб без поля ty): тот, на котором начинают.
 */
export const ROOMS_TYPE = 'challenger';

/** Коды всех корпусов, у которых есть модель. */
export const HULL_TYPES = Object.keys(BUILD);

const built = new Map();

/** Положить уже собранный корпус (свой, при старте игры). */
export function registerHull(code, mesh, gear) {
  built.set(code, { code, mesh, gear, cockpit: code === 'challenger', rooms: true });
}

/** Корпус и стойки типа code; неизвестный тип — null. */
export function hullOf(code) {
  let h = built.get(code);
  if (!h && BUILD[code]) {
    h = BUILD[code]();
    built.set(code, h);
  }
  return h || null;
}

/** Известен ли такой тип корпуса. */
export const isHull = (code) => Object.prototype.hasOwnProperty.call(BUILD, code);
