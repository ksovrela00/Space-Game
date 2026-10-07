// Детали разметки бортового терминала: экранирование, деньги и тонны,
// кнопки, шкалы, пары «подпись — значение».
//
// Отдельным модулем, потому что ими пишут три файла: рамка
// (js/ui/terminal.js), разделы пилота (js/ui/menu.js) и разделы порта
// (js/ui/station.js), — а рамка сама зовёт два других. Держи их рамка, и
// разделы импортировали бы её, а она их: круг, в котором первый же
// `export const` оказывается неопределённым при загрузке.

import { L, numLocale } from '../core/lang.js';

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Кроны с разрядами. «|| 0» — против «−0 кр»: ноль, округлённый из минус
 * десятитысячной, печатается со знаком. signed — знак и у прихода: в
 * ленте операций «+1 200» и «1 200» читаются по-разному.
 */
export const kr = (n, signed = false) => {
  const v = Math.round(n) || 0;
  const s = Math.abs(v).toLocaleString(numLocale());
  return (v < 0 ? '−' : (signed && v > 0 ? '+' : '')) + s + ' ' + L('кр');
};

/** Тонны с одним знаком после запятой: «4,6 т», «12 т». */
export const t1 = (v) => (Math.round(v * 10) / 10 || 0).toLocaleString(numLocale()) + ' ' + L('т');

/** Доля в процентах для ширины полосы: всегда 0–100. */
export const pct = (f) => (Math.max(0, Math.min(1, f || 0)) * 100).toFixed(1) + '%';

const attrs = (data) => Object.entries(data)
  .map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');

/**
 * Кнопка. Всё, что она делает, — в data-act и data-*: нажатия разбирает
 * один обработчик на весь терминал (js/ui/terminal.js), потому что
 * разметка пересобирается после каждой сделки, и слушатель на каждой
 * кнопке копился бы.
 */
export const btn = (label, act, data = {}, cls = '', off = false) =>
  `<button class="b ${cls}"${off ? ' disabled' : ''} data-act="${act}"${attrs(data)}>${label}</button>`;

/** Клавиша в подсказке: <kbd>Q</kbd>. */
export const kbd = (k) => `<kbd>${esc(k)}</kbd>`;

/**
 * Шкала доли. mark — черта на шкале (резерв бака): ниже неё прыжков нет.
 * live — ключ живого значения: шкала бака в полёте меняется каждый кадр,
 * и пересобирать ради неё весь раздел незачем (js/ui/terminal.js, live).
 */
export const meter = (frac, cls = '', mark = null, live = '') =>
  `<div class="meter ${cls}"><i${live ? ` data-bar="${live}"` : ''} style="width:${pct(frac)}"></i>${
    mark !== null ? `<s style="left:${pct(mark)}"></s>` : ''}</div>`;

/** Пары «подпись — значение». cls значения: good, warn, bad, dim. */
export const kv = (rows) => `<dl class="kv">${rows.filter(Boolean).map(([a, b, cls, live]) =>
  `<dt>${esc(a)}</dt><dd class="${cls || ''}"${live ? ` data-live="${live}"` : ''}>${esc(b)}</dd>`).join('')}</dl>`;

/** Пустой раздел: что здесь будет и откуда это берётся. */
export const empty = (title, text) =>
  `<div class="empty"><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}</div>`;

/** Заголовок блока. */
export const head = (text, extra = '') => `<h4 class="h">${esc(text)}${extra}</h4>`;
