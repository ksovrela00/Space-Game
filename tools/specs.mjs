// Характеристики для проверок: те же, что у игры, но с диска.
//
// Проверки идут в Node, где ни сервера, ни базы нет, — поэтому числа
// берутся из слепка (server/data/specs.json). Слепок собран из того же
// источника, что и база (php server/cli/specs.php), и что он не отстал,
// проверяет server/tests/run.php.
//
// Раскладывает их та же applySpecs, которой пользуется игра: будь здесь
// свой разбор, проверки проверяли бы его, а не то, как игра принимает
// числа на самом деле.

import { readFileSync } from 'node:fs';
import { applySpecs } from '../js/game/specs.js';

export const SPECS_PATH = new URL('../server/data/specs.json', import.meta.url);

/** Прочитать слепок и разложить по игре. Возвращает сам набор. */
export function loadSpecsFromDisk() {
  let doc;
  try {
    doc = JSON.parse(readFileSync(SPECS_PATH, 'utf8'));
  } catch (e) {
    throw new Error('не читается слепок характеристик (' + SPECS_PATH.pathname
      + '): ' + e.message + '\nсоберите его: node tools/php.mjs server/cli/specs.php');
  }
  applySpecs(doc);
  return doc;
}
