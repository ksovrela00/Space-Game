// Характеристики корабля, оружия и модулей: получить у бэкенда и разложить.
//
// В игре нет ни одного из этих чисел. Они лежат в server/data/specs.php,
// оттуда заливаются в базу, и база отдаёт их маршрутом `catalog.specs`.
// Так и должно быть: в онлайне «какая у меня скорость» и «какой урон у
// моей пушки» — вопросы к серверу, а не к вкладке браузера. Раньше было
// наоборот, и база была слепком клиентских констант.
//
// Два источника, и это не дубль, а два разных случая:
//
//   СЕРВЕР (`catalog.specs`) — обычный путь. Числа из базы, то есть
//   поправленные в базе долетают до корабля сами.
//
//   СЛЕПОК (server/data/specs.json) — автономный режим (?offline=1) и
//   запасной путь, когда сервера нет. Файл собран из того же источника
//   (php server/cli/specs.php), и что он не отстал, проверяет
//   server/tests/run.php.
//
// Запасной путь нужен именно запасным, а не молчаливым: если игра
// собиралась играть в онлайне, а числа взяла из файла, это надо сказать
// вслух — см. возвращаемое `source`.

import * as api from '../net/api.js';
import { L } from '../core/lang.js';
import { SHIP, applyShipSpec } from './ship.js';
import { applyWeaponSpecs } from './weapons.js';
import { applyModuleSpecs, applyShipEquipment, flightModel, installedIn, moduleSpec } from './loadout.js';
import { applyQuantumSpec } from './quantum.js';

/** Последний полученный набор — из него берут корпуса и цены. */
let doc = null;

/**
 * Откуда пришли числа: 'server' или 'snapshot'.
 *
 * Спрашивают проверки и загрузчик: «взяли из файла вместо сервера» — это
 * не отказ, но и не норма, и знать об этом надо.
 */
let source = null;

export const specsDoc = () => doc;
export const specsSource = () => source;

/** Где лежит слепок: рядом с игрой, как и сервер (см. js/net/api.js). */
export const snapshotUrl = () => {
  const path = location.pathname.replace(/\/[^/]*$/, '/');
  return location.origin + path + 'server/data/specs.json';
};

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
  applyShipSpec(flightModel(type.spec));
  SHIP.code = type.code;
  // Привод берёт свои числа из своего же модуля — того, который стоит на
  // корабле. Отдельным вызовом, а не внутри loadout.js: снаряжение — это
  // список для карточки, а привод — работающая часть игры, и знать друг о
  // друге им незачем.
  const drive = installedIn('drive');
  if (drive) applyQuantumSpec(moduleSpec(drive));
}

/**
 * Принять снаряжение КОНКРЕТНОГО корабля (`ship.equipment` из состояния).
 *
 * До входа корабль собран по заводской комплектации из каталога — иначе в
 * автономном режиме он остался бы без двигателя. Сервер говорит, что
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
 * приходит в player.state). Пока корпус один, вызов ничего не меняет —
 * но именно он делает «у каждого свой корабль» вопросом данных, а не
 * новой правки в игре.
 */
export function useShipType(code) {
  if (!doc || !code) return null;
  const type = doc.shipTypes.find((t) => t.code === code);
  if (!type || type.code === SHIP.code) return null;
  refit(type);
  return type.code;
}

async function snapshot() {
  const res = await fetch(snapshotUrl(), { cache: 'no-cache' });
  if (!res.ok) throw new Error(L('слепок характеристик не читается: ') + res.status);
  return res.json();
}

/**
 * Получить характеристики.
 *
 * @param offline играем без сервера — сразу слепок, сервер не трогаем
 * @returns {Promise<{source: 'server'|'snapshot', error: ?Error}>}
 */
export async function loadSpecs({ offline = false } = {}) {
  let error = null;
  if (!offline) {
    try {
      applySpecs(await api.specs());
      source = 'server';
      return { source, error: null };
    } catch (e) {
      // Сервера нет или он молчит. Это не повод не запуститься: числа
      // те же самые лежат рядом файлом. Но и молчать об этом нельзя —
      // ошибку отдаём наверх.
      error = e;
    }
  }
  applySpecs(await snapshot());
  source = 'snapshot';
  return { source, error };
}
