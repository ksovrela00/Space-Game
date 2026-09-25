// Список пилотов в сети (клавиша P).
//
// Зачем он нужен рядом со сканером, который и так показывает соседей.
// Сканер отвечает на вопрос «кто рядом» — и только на него: за пределами
// своей системы там пусто, а мир состоит из семи систем. Вопрос «кто
// вообще сейчас играет и где его искать» задают до того, как решить,
// куда лететь, и ответа на него в игре не было вовсе.
//
// Состав сети приходит с хаба и МЕНЯЕТСЯ РЕДКО — на входе, выходе и
// смене системы (server/src/Hub.php, sendRoster). Поэтому список не
// стоит ничего: он лежит готовым, а клавиша только показывает его.
//
// Панель не забирает управление, как меню, и это нарочно: смотрят её на
// ходу — «кто где» решается по дороге, а не на стоянке. Тот же приём,
// что у отладочного оверлея.

import { CY, CY_DIM, AMBER, GREEN, INK } from './theme.js';
import { L } from '../core/lang.js';
import { systemById } from '../game/galaxy.js';
import { Q } from '../core/quality.js';

const MONO = 'Consolas, monospace';

/**
 * Строки списка: кто, где и как это показать.
 *
 * Отдельно от рисования, потому что проверить можно только это:
 * сортировку, имя системы и отметку «здесь». Пиксели проверяются
 * глазами.
 *
 * @param roster [{id, name, sys}] с хаба (js/net/socket.js, net.roster)
 * @param meId   свой номер игрока или null
 * @param sysId  номер своей системы или null
 */
export function pilotRows(roster, meId = null, sysId = null) {
  const rows = (roster || []).map((p) => {
    const has = p.sys !== null && p.sys !== undefined;
    const s = has ? systemById(p.sys) : null;
    return {
      id: p.id,
      name: String(p.name || ('#' + p.id)).slice(0, 20),
      // Система без имени — это либо прыжок между системами, либо
      // система, которой нет в галактике игры. Второе значит, что игра и
      // сервер разошлись каталогом, и молчать об этом нельзя.
      where: s ? s.name : (has ? '#' + p.sys : L('В ПРЫЖКЕ')),
      here: has && p.sys === sysId,
      you: p.id === meId,
    };
  });
  // Сам пилот первым, за ним соседи по системе, дальше по имени. Своя
  // строка — точка отсчёта: от неё читают, кто рядом, а кто нет.
  rows.sort((a, b) => (b.you ? 1 : 0) - (a.you ? 1 : 0)
    || (b.here ? 1 : 0) - (a.here ? 1 : 0)
    || a.name.localeCompare(b.name));
  return rows;
}

/**
 * Показывать ли панель. Только по клавише — и без оглядки на связь.
 *
 * Без связи она тоже показывается, но одной строкой «СВЯЗИ НЕТ».
 * Иначе клавиша в автономной игре не делает ничего вовсе, а это
 * неотличимо от поломки.
 */
export const pilotsShown = (game) => !!game.showPilots;

export function drawPilots(r, game) {
  if (!pilotsShown(game)) return;
  const ctx = r.ctx;
  const live = !!(game.link && game.link.mode === 'live');
  const rows = live
    ? pilotRows(net(game), game.link.you ? game.link.you.id : null,
      game.sys ? game.sys.id : null)
    : [];

  const k = Q.hudScale;
  const lh = 15;
  const w = 250;
  const h = 26 + Math.max(1, rows.length) * lh + 6;
  // Ниже строки связи И НИЖЕ сообщений: те тоже идут по левому краю
  // сверху, и панель на их месте читается как каша из двух слоёв.
  const x = 18, y = 126;

  ctx.save();
  ctx.translate(x, y);
  if (k !== 1) ctx.scale(k, k);
  ctx.fillStyle = 'rgba(5,17,28,0.96)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  ctx.font = `11px ${MONO}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = CY;
  ctx.fillText(L('ПИЛОТЫ В СЕТИ') + (live ? '  ' + rows.length : ''), 8, 16);
  ctx.strokeStyle = CY_DIM;
  ctx.beginPath();
  ctx.moveTo(0, 22);
  ctx.lineTo(w, 22);
  ctx.stroke();

  let ty = 22 + lh;
  if (!rows.length) {
    ctx.fillStyle = CY_DIM;
    ctx.fillText(live ? L('никого') : L('СВЯЗИ НЕТ'), 8, ty);
  }
  for (const p of rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = p.you ? GREEN : INK;
    ctx.fillText((p.you ? '> ' : '  ') + p.name, 8, ty);
    ctx.textAlign = 'right';
    // Своя система — янтарём: по одному этому признаку и читают, к кому
    // можно долететь, не прыгая.
    ctx.fillStyle = p.here ? AMBER : CY_DIM;
    ctx.fillText(p.where, w - 8, ty);
    ty += lh;
  }
  ctx.restore();
}

// Состав сети берётся из состояния связи, а не из сокета напрямую:
// приборы не должны знать, чем игра соединена с миром.
function net(game) {
  return game.link && game.link.roster ? game.link.roster : [];
}
