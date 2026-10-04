// NPC глазами игры: как их называть, что у них стоит и до каких пор их видно.
//
// Самих NPC игра не ведёт и не считает: их водит сервер (server/src/
// Traffic.php, Npc.php), а сюда они приходят в общем снимке чужих
// кораблей, с пометкой npc и отрицательным номером (js/game/peers.js).
// Здесь только то, что нужно приборам: подпись, снаряжение строкой и
// угасание метки у края локатора.

import { specsDoc } from './specs.js';
import { L } from '../core/lang.js';

/**
 * Дальность локатора для NPC, км: ближе see сервер их показывает, а
 * видимого прячет только дальше hide (Traffic::SEE_KM, HIDE_KM). Числа
 * приходят с сервера при входе (welcome, npc) — здесь лишь умолчание на
 * случай старого сервера.
 */
export const NPC_RANGE = { see: 80, hide: 100 };

export function setNpcRange(r) {
  if (r && Number.isFinite(r.see) && Number.isFinite(r.hide) && r.hide > r.see && r.see > 0) {
    NPC_RANGE.see = r.see;
    NPC_RANGE.hide = r.hide;
  }
  return NPC_RANGE;
}

/**
 * Насколько видна метка NPC на расстоянии d, 0..1.
 *
 * Сервер прячет NPC дальше hide, и метка, оборванная на границе, читалась
 * бы как «корабль исчез на ровном месте». Поэтому от see к hide она
 * гаснет: контакт уходит за край локатора, а не пропадает.
 */
export function npcFade(d) {
  const { see, hide } = NPC_RANGE;
  if (!(d > see)) return 1;
  return Math.max(0, Math.min(1, (hide - d) / (hide - see)));
}

/** Название корпуса по коду (Challenger, Prometheus) — или код. */
export function hullName(code) {
  const doc = specsDoc();
  const t = doc && code ? doc.shipTypes.find((x) => x.code === code) : null;
  return t ? t.name : (code || '');
}

/**
 * Что стоит на NPC, одной строкой для прибора: оружие, щит — и всё, что
 * поставлено сверх заводского (форсированный двигатель, дальний сканер).
 * Заводское перечислять незачем: оно есть у всех, и строка про него не
 * отличает одного NPC от другого. Что заводское, а что нет, решает
 * сервер (Traffic::extras): у крейсера свой заводской привод, и по
 * каталогу модулей этого не понять.
 *
 * @param codes коды модулей и оружия (снимок сервера, поле eq)
 * @param extra что из них сверх заводского (поле ex)
 * @returns массив подписей; пустой — снаряжение ещё не пришло
 */
export function npcGear(codes, extra = []) {
  if (!Array.isArray(codes)) return [];
  const doc = specsDoc();
  const mods = doc ? doc.modules : [];
  const guns = doc ? doc.weapons : [];
  const has = new Set(codes);
  const more = new Set(Array.isArray(extra) ? extra : []);
  const out = [];
  const gun = guns.find((w) => has.has(w.code));
  out.push(gun ? L(gun.name) : L('БЕЗ ОРУЖИЯ'));
  const shield = mods.find((m) => m.slot === 'shield' && has.has(m.code));
  out.push(shield ? L(shield.name) : L('БЕЗ ЩИТА'));
  for (const m of mods) {
    if (m.slot !== 'shield' && more.has(m.code)) out.push(L(m.name));
  }
  return out;
}
