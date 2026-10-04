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
import { buildCockpit } from './cockpit.js';
import { buildPromCockpit } from './cockpit.prom.js';

// cockpit — есть ли пост пилота с экранами (podOf), canopy — фонарь
// истребителя с переплётом (его стойки штрихами рисует худ на запасном
// пути Canvas 2D, где поста нет), rooms — есть ли помещения, шлюзы и
// трапы (js/models/interior.js; план «Прометея» — js/models/interior.prom.js).
// Посты у типов разные: у «Челленджера» — доска под фонарём
// (js/models/cockpit.js), у «Прометея» — кресло командира на мостике
// (js/models/cockpit.prom.js).
const BUILD = {
  challenger: () => ({ code: 'challenger', mesh: buildCobra(), gear: buildGear(), cockpit: true, canopy: true, rooms: true }),
  prometheus: () => {
    const mesh = buildPrometheus();
    return { code: 'prometheus', mesh, gear: buildPrometheusGear(mesh), cockpit: true, canopy: false, rooms: true };
  },
};

// Пост пилота типа: модель по его корпусу.
const POD = {
  challenger: (mesh) => buildCockpit(mesh),
  prometheus: (mesh) => buildPromCockpit(mesh),
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
  built.set(code, { code, mesh, gear, cockpit: !!POD[code], canopy: code === 'challenger', rooms: true });
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

const pods = new Map();

/**
 * Пост пилота типа code — модель (js/models/cockpit*.js), собирается один
 * раз: её рисует кабина и на своём корабле, и на палубе чужого того же
 * типа. Нет поста — null.
 */
export function podOf(code) {
  if (pods.has(code)) return pods.get(code);
  const H = hullOf(code);
  const p = H && H.cockpit && POD[code] ? POD[code](H.mesh) : null;
  pods.set(code, p);
  return p;
}

/** Известен ли такой тип корпуса. */
export const isHull = (code) => Object.prototype.hasOwnProperty.call(BUILD, code);
