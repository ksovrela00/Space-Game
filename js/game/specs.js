// Характеристики корабля, оружия и модулей: получить у бэкенда и разложить.
//
// В игре нет ни одного из этих чисел. Они лежат в server/data/specs.php,
// оттуда заливаются в базу, и база отдаёт их маршрутом `catalog.specs`.
// Так и должно быть: в онлайне «какая у меня скорость» и «какой урон у
// моей пушки» — вопросы к серверу, а не к вкладке браузера. Раньше было
// наоборот, и база была слепком клиентских констант.
//
// Источник один — сервер. Запасного пути нет: без сервера игра не
// запускается вовсе (js/boot.js), и числа «из файла на всякий случай»
// означали бы корабль, летящий не по тем правилам, по которым его судит
// сервер. Слепок server/data/specs.json остался, но только как
// подставка для проверок в Node (tools/specs.mjs) — игра его не читает.

import * as api from '../net/api.js';
import { L } from '../core/lang.js';
import { SHIP, applyShipSpec } from './ship.js';
import { applyWeaponSpecs } from './weapons.js';
import { applyModuleSpecs, applyShipEquipment, flightModel, installedIn, moduleSpec } from './loadout.js';
import { applyLampSpec } from './lamps.js';
import { applyQuantumSpec } from './quantum.js';
import { setHull } from './hull.js';

/** Последний полученный набор — из него берут корпуса и цены. */
let doc = null;

export const specsDoc = () => doc;

/**
 * Числа корпуса типа code из каталога: у соседа другого типа свой радиус
 * попадания (js/game/peers.js). Нет такого типа — null.
 */
export function typeSpec(code) {
  const t = doc && code ? doc.shipTypes.find((x) => x.code === code) : null;
  return t ? t.spec : null;
}

/**
 * Разложить полученное по игре.
 *
 * Возвращает код применённого корпуса. Корпус выбирается по коду, а при
 * отсутствии — первый: список кораблей ведёт бэкенд, и гадать, какой из
 * них «главный», игре не о чем.
 */
export function applySpecs(data, code = null) {
  if (!data || !Array.isArray(data.shipTypes) || !data.shipTypes.length) {
    throw new Error(L('характеристики пусты: нечем собрать корабль'));
  }
  doc = data;
  const type = (code && data.shipTypes.find((t) => t.code === code)) || data.shipTypes[0];
  applyWeaponSpecs(data.weapons, data.combat);
  // Снаряжение — ДО лётной модели, а не после: скорость, манёвренность,
  // щит и трюм принадлежат модулям, и без них у корпуса их нет вовсе.
  applyModuleSpecs(data.modules);
  refit(type);
  return type.code;
}

/**
 * Собрать корабль: корпус плюс то, что стоит в гнёздах.
 *
 * Одно место на все случаи — первая загрузка, пересадка на другой корпус,
 * приход состояния пилота с его снаряжением. Собирать модель в трёх
 * местах значило бы три разных корабля из одних и тех же чисел.
 */
function refit(type) {
  // Корпус — до лётной модели: просветы, плечи и масштаб берутся у него
  // (js/game/hull.js, js/game/ship.js).
  setHull(type.code);
  applyShipSpec(flightModel(type.spec));
  SHIP.code = type.code;
  SHIP.typeName = type.name;
  SHIP.typeTitle = type.title;
  // Привод берёт свои числа из своего же модуля — того, который стоит на
  // корабле. Отдельным вызовом, а не внутри loadout.js: снаряжение — это
  // список для карточки, а привод — работающая часть игры, и знать друг о
  // друге им незачем.
  const drive = installedIn('drive');
  if (drive) applyQuantumSpec(moduleSpec(drive));
  // Фары — тем же приёмом: свои числа берёт стоящий на корабле модуль.
  const lamp = installedIn('lamp');
  if (lamp) applyLampSpec(moduleSpec(lamp));
}

/**
 * Принять снаряжение КОНКРЕТНОГО корабля (`ship.equipment` из состояния).
 *
 * До ответа корабль собран по заводской комплектации из каталога — иначе
 * он остался бы без двигателя. Сервер говорит, что
 * стоит на этом корабле на самом деле, и модель пересобирается.
 */
export function useShipEquipment(list) {
  if (!doc || !Array.isArray(list) || !list.length) return null;
  applyShipEquipment(list);
  const type = doc.shipTypes.find((t) => t.code === SHIP.code) || doc.shipTypes[0];
  refit(type);
  return list.length;
}

/**
 * Пересесть на другой корпус.
 *
 * Зовётся, когда сервер сказал, на чём летит этот пилот (его type.code
 * приходит в player.state): корабль пересобирается под тот корпус —
 * сетка, стойки, масса и лётная модель (js/game/hull.js). Сетку в кадре
 * меняет игра (js/main.js, syncHull).
 */
export function useShipType(code) {
  if (!doc || !code) return null;
  const type = doc.shipTypes.find((t) => t.code === code);
  if (!type || type.code === SHIP.code) return null;
  refit(type);
  return type.code;
}

/**
 * Получить характеристики у сервера. Не ответил — ошибка наверх: без
 * чисел корабля игры нет (js/boot.js ждёт и пробует снова).
 */
export async function loadSpecs() {
  const data = await api.specs();
  applySpecs(data);
  return data;
}
