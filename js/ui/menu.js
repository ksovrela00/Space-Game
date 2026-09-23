// Меню пилота (клавиша I): корабль, груз, задания, финансы.
//
// Открывается ТОЛЬКО в полёте. В порту его нет намеренно: там будет своя
// станционная часть (рынок, доска заданий, ремонт), и одно меню на два
// места неизбежно превратилось бы в набор оговорок «здесь можно, здесь
// нельзя».
//
// Мир при открытом меню НЕ ОСТАНАВЛИВАЕТСЯ — в отличие от карты. Причин
// две. Первая: в сети остановить мир нельзя в принципе, и раз меню
// задумано на будущее с онлайном, останавливать его нельзя уже сейчас.
// Вторая: меню и должно быть местом, где решают на ходу — сбросить груз
// до досмотра, посмотреть срок задания в прыжке. Поэтому корабль летит
// дальше, а в подвале меню всё время висит скорость: это не украшение, а
// предупреждение.
//
// Управление кораблём на это время глохнет (input.enabled в js/main.js) —
// иначе клавиши разделов уводили бы корабль с курса.

import { CY, CY_DIM, AMBER, GREEN, RED, INK } from './theme.js';
import { SHIP } from '../game/ship.js';
import { HULL_SIZE } from '../models/ships.js';
import { CROWN, cargoTons, ledgerTotals, missionExpired } from '../game/player.js';
import { fmtTime, fmtSpeed, fmtDist, SCANNER_STEPS } from './hud.js';

const MONO = 'Consolas, monospace';

export const TABS = ['КОРАБЛЬ', 'ГРУЗ', 'ЗАДАНИЯ', 'ФИНАНСЫ'];

export function makeMenu() {
  return {
    open: false,
    tab: 0,
    // Прямоугольники закладок с прошлого кадра: по ним ловится щелчок.
    // Тот же приём, что у карты (js/ui/map.js) — вёрстка считается один
    // раз, при отрисовке, и разбора попадания отдельной копией нет.
    tabRects: [],
    hover: -1,             // закладка под курсором
    rect: null,            // рамка меню с прошлого кадра
    body: null,            // рабочее поле под закладками
    fs: 13,                // кегль, выбранный по размеру окна
  };
}

/**
 * Разбор ввода. Вызывается вместо всего остального управления, поэтому
 * возвращать сюда полётные клавиши не нужно — их на это время нет.
 */
export function menuInput(menu, input) {
  if (input.pressed('KeyI', 'Escape')) { menu.open = false; return; }
  for (let i = 0; i < TABS.length; i++) {
    if (input.pressed('Digit' + (i + 1), 'Numpad' + (i + 1))) menu.tab = i;
  }
  if (input.pressed('ArrowRight', 'KeyD')) menu.tab = (menu.tab + 1) % TABS.length;
  if (input.pressed('ArrowLeft', 'KeyA')) menu.tab = (menu.tab + TABS.length - 1) % TABS.length;
  // Закладка под курсором подсвечивается: курсор в меню видно (в полёте
  // он спрятан), и без отклика непонятно, жмётся ли тут вообще что-то.
  const { x, y } = input.mouse;
  menu.hover = -1;
  for (const r of menu.tabRects) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      menu.hover = r.i;
      if (input.mouse.clicked) menu.tab = r.i;
    }
  }
}

// --- мелкий инструмент вёрстки ----------------------------------------------

/** Кроны с разрядами и знаком: «+1 200 кр», «−35 кр». */
export const fmtCrowns = (n, signed = false) => {
  const v = Math.round(Math.abs(n)).toLocaleString('ru-RU');
  const sign = n < 0 ? '−' : (signed ? '+' : '');
  return sign + v + ' ' + CROWN;
};

/** Часы пилота: сколько он в деле. */
export const fmtClock = (s) => {
  const t = Math.max(0, Math.floor(s));
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  return hh + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
};

const fmtTons = (t) => (t >= 10 ? t.toFixed(0) : t.toFixed(1)) + ' т';

/** Строка «подпись — значение»: подпись слева, значение прижато вправо. */
function row(ctx, x, y, w, label, value, color = INK, dim = CY_DIM) {
  ctx.textAlign = 'left';
  ctx.fillStyle = dim;
  ctx.fillText(label, x, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = color;
  ctx.fillText(value, x + w, y);
}

/** Шкала без делений: здесь она показывает долю, а не показание прибора. */
function bar(ctx, x, y, w, h, frac, color) {
  ctx.fillStyle = 'rgba(79,179,224,0.12)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.max(0, Math.min(1, frac)) * w, h);
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Заголовок блока с чертой под ним. */
function head(ctx, x, y, w, text) {
  ctx.textAlign = 'left';
  ctx.fillStyle = CY;
  ctx.fillText(text, x, y);
  ctx.strokeStyle = CY_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 4.5);
  ctx.lineTo(x + w, y + 4.5);
  ctx.stroke();
}

/** Разбивка текста по ширине: описание задания — единственное место,
 *  где текст длиннее строки, и обрезать его многоточием жалко. */
function wrap(ctx, text, w) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (line && ctx.measureText(test).width > w) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

const hullColor = (frac) => (frac > 0.6 ? GREEN : frac > 0.3 ? AMBER : RED);

// --- разделы -----------------------------------------------------------------

function drawShip(ctx, b, game, fs) {
  const { ship } = game;
  const hullFrac = ship.hull / SHIP.maxHull;
  const fuelFrac = ship.fuel / SHIP.fuelMax;
  const m = (km) => (km * 1000).toFixed(1) + ' м';

  // Содержимое описывается СПИСКОМ, а не рисуется на месте: одна и та же
  // карточка ложится в две колонки на мониторе и в одну на телефоне, и
  // держать для этого две копии вёрстки — верный способ развести их.
  const left = [
    { t: 'name', s: (ship.mesh && ship.mesh.name ? ship.mesh.name : 'КОРАБЛЬ').toUpperCase() },
    { t: 'sub', s: 'ЛЁГКИЙ ТОРГОВЫЙ КОРАБЛЬ' },
    { t: 'head', s: 'ГАБАРИТЫ' },
    { t: 'row', a: 'ДЛИНА', b: m(HULL_SIZE.z) },
    { t: 'row', a: 'ШИРИНА', b: m(HULL_SIZE.x) },
    { t: 'row', a: 'ВЫСОТА', b: m(HULL_SIZE.y) },
    { t: 'head', s: 'СОСТОЯНИЕ' },
    { t: 'row', a: 'КОРПУС', b: Math.round(ship.hull) + ' %', c: hullColor(hullFrac) },
    { t: 'bar', frac: hullFrac, c: hullColor(hullFrac) },
  ];
  if (SHIP.maxShield > 0) {
    const sf = ship.shield / SHIP.maxShield;
    left.push({ t: 'row', a: 'ЩИТЫ', b: Math.round(ship.shield) + ' %', c: hullColor(sf) });
    left.push({ t: 'bar', frac: sf, c: CY });
  } else {
    // Пустая строка читалась бы как поломка прибора, поэтому «нет щитов»
    // написано словами.
    left.push({ t: 'row', a: 'ЩИТЫ', b: 'НЕ УСТАНОВЛЕНЫ', c: CY_DIM });
  }
  left.push({ t: 'row', a: 'ТОПЛИВО',
    b: ship.fuel.toFixed(1) + ' / ' + SHIP.fuelMax.toFixed(1) + ' т', c: AMBER });
  left.push({ t: 'bar', frac: fuelFrac, c: AMBER });

  // Значения берутся из настоящих констант, а не переписаны сюда: иначе
  // карточка начнёт врать в тот день, когда двигатель перенастроят.
  const right = [
    { t: 'head', s: 'ХАРАКТЕРИСТИКИ' },
    { t: 'row', a: 'ПРЕДЕЛ ХОДА', b: SHIP.maxSpeed.toFixed(2) + ' км/с' },
    { t: 'row', a: 'НА ФОРСАЖЕ', b: (SHIP.maxSpeed * SHIP.boostMax).toFixed(1) + ' км/с' },
    { t: 'row', a: 'РАЗГОН', b: SHIP.accel.toFixed(2) + ' км/с²' },
    { t: 'row', a: 'ТОРМОЖЕНИЕ', b: SHIP.brake.toFixed(2) + ' км/с²' },
    { t: 'row', a: 'ПОПЕРЁК КУРСА', b: SHIP.lateral.toFixed(2) + ' км/с²' },
    { t: 'head', s: 'УСТАНОВЛЕННЫЕ МОДУЛИ' },
    { t: 'row', a: 'МАРШЕВЫЙ ДВИГАТЕЛЬ', b: SHIP.maxSpeed.toFixed(2) + ' км/с' },
    { t: 'row', a: 'МАНЕВРОВЫЕ', b: SHIP.lateral.toFixed(2) + ' км/с²' },
    { t: 'row', a: 'ПОДЪЁМНЫЕ ДВИГАТЕЛИ', b: '×' + SHIP.liftTWR + ' к весу' },
    { t: 'row', a: 'ФОРСАЖ', b: '×' + SHIP.boostMax + ', ' + SHIP.boostBurn + ' с' },
    { t: 'row', a: 'КВАНТОВЫЙ ПРИВОД', b: fmtSpeed(SHIP.quantumSpeed) },
    { t: 'row', a: 'ВАРП-ПРИВОД', b: 'МЕЖСИСТЕМНЫЙ' },
    { t: 'row', a: 'ДОКИНГ-КОМПЬЮТЕР', b: 'ЕСТЬ' },
    { t: 'row', a: 'ПОСАДОЧНЫЙ КОМПЬЮТЕР', b: 'ЕСТЬ' },
    { t: 'row', a: 'СКАНЕР', b: fmtDist(SCANNER_STEPS[SCANNER_STEPS.length - 1]) },
    { t: 'row', a: 'ШАССИ', b: SHIP.gearTime.toFixed(1) + ' с' },
    { t: 'row', a: 'ТРЮМ', b: SHIP.hold + ' т' },
    { t: 'row', a: 'ЩИТЫ', b: 'НЕТ', c: CY_DIM },
  ];

  // Хватит ли ширины на две колонки, решает САМАЯ ДЛИННАЯ строка, а не
  // размер окна: подпись и значение стоят в одной строке навстречу друг
  // другу, и на узкой колонке они сходятся вплотную. На телефоне (390 px)
  // двух колонок не выходит вовсе — «ПОСАДОЧНЫЙ КОМПЬЮТЕР ЕСТЬ» требует
  // 26 знаков, а в колонке их 14.
  const chars = (it) => (it.t === 'row' ? it.a.length + String(it.b).length + 3
    : it.t === 'bar' ? 0 : String(it.s).length);
  const widest = Math.max(...left.map(chars), ...right.map(chars));
  const glyph = fs * 0.6;
  const twoCol = b.w / 2 - fs * 2 >= widest * glyph;

  const weight = (it) => (it.t === 'bar' ? 0.75 : it.t === 'head' ? 1.35 : it.t === 'name' ? 2.0 : 1);
  const paint = (items, x, w, y0, line) => {
    let y = y0;
    for (const it of items) {
      if (it.t === 'name') {
        ctx.font = `${Math.round(fs * 1.8)}px ${MONO}`;
        ctx.textAlign = 'left';
        ctx.fillStyle = INK;
        ctx.fillText(it.s, x, y + line * 1.2);
        ctx.font = `${fs}px ${MONO}`;
      } else if (it.t === 'sub') {
        ctx.textAlign = 'left';
        ctx.fillStyle = CY_DIM;
        ctx.fillText(it.s, x, y + line * 0.8);
      } else if (it.t === 'head') {
        head(ctx, x, y + line * 0.9, w, it.s);
      } else if (it.t === 'bar') {
        bar(ctx, x, y, w, Math.max(4, Math.round(fs * 0.4)), it.frac, it.c);
      } else {
        row(ctx, x, y + line * 0.8, w, it.a, it.b, it.c || INK);
      }
      y += line * weight(it);
    }
    return y;
  };

  const top = b.y + fs * 0.6;
  const avail = b.h - fs * 1.2;
  if (twoCol) {
    const colW = Math.floor((b.w - fs * 4) / 2);
    const rows = Math.max(left.reduce((a, it) => a + weight(it), 0),
      right.reduce((a, it) => a + weight(it), 0));
    const line = Math.min(fs * 1.62, avail / rows);
    paint(left, b.x, colW, top, line);
    paint(right, b.x + colW + fs * 4, colW, top, line);
  } else {
    // Одна колонка: межстрочный интервал считается из того, сколько
    // строк надо уместить. Иначе карточка вылезает за рамку снизу —
    // ровно это и поймала проверка вёрстки на 390x844.
    const rows = [...left, ...right].reduce((a, it) => a + weight(it), 0);
    const line = Math.min(fs * 1.5, avail / rows);
    const y = paint(left, b.x, b.w, top, line);
    paint(right, b.x, b.w, y, line);
  }
}

function drawCargo(ctx, b, game, fs) {
  const p = game.player;
  const line = Math.round(fs * 1.9);
  const used = cargoTons(p);
  const free = Math.max(0, SHIP.hold - used);

  let y = b.y + fs * 1.6;
  ctx.font = `${Math.round(fs * 1.5)}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.fillText('ЗАНЯТО ' + used.toFixed(1) + ' / ' + SHIP.hold.toFixed(1) + ' Т', b.x, y);
  ctx.font = `${fs}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = CY_DIM;
  ctx.fillText('СВОБОДНО ' + fmtTons(free), b.x + b.w, y);

  y += fs * 0.7;
  bar(ctx, b.x, y, b.w, Math.max(6, Math.round(fs * 0.6)), used / SHIP.hold,
    free <= 0 ? AMBER : CY);
  y += fs * 2.2;

  if (!p.cargo.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = CY_DIM;
    ctx.fillText('ТРЮМ ПУСТ', b.x + b.w / 2, y + fs * 2);
    return;
  }

  head(ctx, b.x, y, b.w, 'НАИМЕНОВАНИЕ');
  ctx.textAlign = 'right';
  ctx.fillStyle = CY;
  ctx.fillText('МАССА', b.x + b.w, y);
  y += line * 0.9;

  for (const c of p.cargo) {
    if (y > b.y + b.h - line * 0.5) break;
    row(ctx, b.x, y, b.w, c.name, fmtTons(c.tons), INK, INK);
    // Доля трюма под этой позицией: по полоскам видно, чем он забит,
    // без арифметики в уме.
    bar(ctx, b.x, y + fs * 0.35, b.w, Math.max(3, Math.round(fs * 0.28)),
      c.tons / SHIP.hold, CY_DIM);
    y += line;
  }
}

function drawMissions(ctx, b, game, fs) {
  const p = game.player;
  const line = Math.round(fs * 1.5);

  if (!p.missions.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = CY_DIM;
    ctx.fillText('АКТИВНЫХ ЗАДАНИЙ НЕТ', b.x + b.w / 2, b.y + b.h / 2);
    ctx.fillText('БРАТЬ ИХ БУДЕТ ГДЕ НА СТАНЦИЯХ', b.x + b.w / 2, b.y + b.h / 2 + line);
    return;
  }

  let y = b.y + fs * 1.8;
  for (const m of p.missions) {
    if (y > b.y + b.h - line * 2) break;
    const dead = missionExpired(m);

    ctx.font = `${Math.round(fs * 1.15)}px ${MONO}`;
    row(ctx, b.x, y, b.w, m.title, fmtCrowns(m.reward), dead ? RED : GREEN, INK);
    ctx.font = `${fs}px ${MONO}`;
    y += line;

    row(ctx, b.x, y, b.w,
      dead ? 'СРОК ВЫШЕЛ' : 'ОСТАЛОСЬ ' + fmtTime(m.left),
      dead ? 'ПРОСРОЧЕНО' : '', dead ? RED : AMBER, dead ? RED : AMBER);
    y += fs * 0.5;
    bar(ctx, b.x, y, b.w, Math.max(3, Math.round(fs * 0.25)),
      m.total > 0 ? m.left / m.total : 0, dead ? RED : AMBER);
    y += line * 0.8;

    ctx.textAlign = 'left';
    ctx.fillStyle = CY_DIM;
    for (const s of wrap(ctx, m.desc, b.w)) {
      // Длинное описание обрывается по нижней кромке поля, а не лезет за
      // рамку: проверять высоту только перед заданием мало — оно само
      // может оказаться в три строки.
      if (y > b.y + b.h) break;
      ctx.fillText(s, b.x, y);
      y += line * 0.85;
    }
    y += line * 0.7;
  }
}

function drawFinance(ctx, b, game, fs) {
  const p = game.player;
  const line = Math.round(fs * 1.45);
  const t = ledgerTotals(p);

  let y = b.y + fs * 1.8;
  ctx.textAlign = 'left';
  ctx.font = `${Math.round(fs * 1.9)}px ${MONO}`;
  ctx.fillStyle = p.balance < 0 ? RED : INK;
  ctx.fillText(fmtCrowns(p.balance), b.x, y);
  ctx.font = `${fs}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = GREEN;
  ctx.fillText('ПРИШЛО ' + fmtCrowns(t.in, true), b.x + b.w, y - line * 0.8);
  ctx.fillStyle = RED;
  ctx.fillText('УШЛО −' + fmtCrowns(t.out), b.x + b.w, y);

  y += line * 1.4;
  head(ctx, b.x, y, b.w, 'ВРЕМЯ');
  ctx.textAlign = 'left';
  ctx.fillStyle = CY;
  ctx.fillText('ОПЕРАЦИЯ', b.x + fs * 6.5, y);
  ctx.textAlign = 'right';
  ctx.fillText('СУММА', b.x + b.w, y);
  y += line;

  // Лента идёт СВЕЖИМ ВВЕРХ: последнее движение денег — то, ради чего
  // раздел и открывают.
  const fits = Math.max(0, Math.floor((b.y + b.h - y) / line));
  const shown = p.ledger.slice(-fits).reverse();
  for (const e of shown) {
    ctx.textAlign = 'left';
    ctx.fillStyle = CY_DIM;
    ctx.fillText(fmtClock(e.t), b.x, y);
    ctx.fillStyle = INK;
    ctx.fillText(e.label, b.x + fs * 6.5, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = e.sum >= 0 ? GREEN : RED;
    ctx.fillText(fmtCrowns(e.sum, true), b.x + b.w, y);
    y += line;
  }
  const hidden = p.ledger.length - shown.length;
  if (hidden > 0) {
    ctx.textAlign = 'left';
    ctx.fillStyle = CY_DIM;
    ctx.fillText('…ещё ' + hidden + ' записей выше', b.x, y);
  }
  if (!p.ledger.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = CY_DIM;
    ctx.fillText('ДВИЖЕНИЯ СРЕДСТВ НЕ БЫЛО', b.x + b.w / 2, y + line);
  }
}

// --- рамка --------------------------------------------------------------------

export function drawMenu(r, game) {
  const ctx = r.ctx;
  const menu = game.menu;
  const W = r.camera.w, H = r.camera.h;

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // Кадр под меню приглушён, но ВИДЕН: игрок обязан замечать, что летит.
  ctx.fillStyle = 'rgba(0,4,10,0.45)';
  ctx.fillRect(0, 0, W, H);

  const w = Math.min(W - 24, Math.max(360, Math.round(W * 0.74)));
  const h = Math.min(H - 24, Math.max(260, Math.round(H * 0.78)));
  const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
  // Кегль выбирается по МЕНЬШЕЙ стороне рамки. По одной высоте его
  // считать нельзя: телефон высокий и узкий, и на 390x844 закладки
  // «3 ЗАДАНИЯ» и «4 ФИНАНСЫ» налезали друг на друга — в рамку не
  // помещался даже заголовок раздела.
  const fs = Math.max(10, Math.min(17, Math.round(Math.min(h * 0.028, w * 0.026))));
  const headH = Math.round(fs * 2.4);
  const tabH = Math.round(fs * 2.2);
  const footH = Math.round(fs * 2.2);

  ctx.fillStyle = 'rgba(4,14,24,0.95)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = CY;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  // Шапка.
  ctx.fillStyle = 'rgba(28,86,130,0.55)';
  ctx.fillRect(x, y, w, headH);
  ctx.font = `${Math.round(fs * 1.1)}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.fillText('МЕНЮ ПИЛОТА', x + fs, y + headH * 0.68);
  ctx.textAlign = 'right';
  ctx.fillStyle = game.player.balance < 0 ? RED : AMBER;
  ctx.fillText(fmtCrowns(game.player.balance), x + w - fs, y + headH * 0.68);

  // Закладки.
  const tabW = Math.floor(w / TABS.length);
  menu.tabRects = [];
  ctx.font = `${fs}px ${MONO}`;
  for (let i = 0; i < TABS.length; i++) {
    const tx = x + i * tabW;
    const tw = i === TABS.length - 1 ? w - tabW * (TABS.length - 1) : tabW;
    const on = i === menu.tab;
    menu.tabRects.push({ i, x: tx, y: y + headH, w: tw, h: tabH });
    ctx.fillStyle = on ? 'rgba(79,179,224,0.22)'
      : menu.hover === i ? 'rgba(79,179,224,0.10)' : 'rgba(5,17,28,0.9)';
    ctx.fillRect(tx, y + headH, tw, tabH);
    ctx.strokeStyle = CY_DIM;
    ctx.strokeRect(tx + 0.5, y + headH + 0.5, tw - 1, tabH - 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = on ? INK : CY_DIM;
    ctx.fillText((i + 1) + ' ' + TABS[i], tx + tw / 2, y + headH + tabH * 0.66);
    if (on) {
      ctx.fillStyle = CY;
      ctx.fillRect(tx, y + headH + tabH - 2, tw, 2);
    }
  }

  const body = {
    x: x + fs * 1.4,
    y: y + headH + tabH,
    w: w - fs * 2.8,
    h: h - headH - tabH - footH,
  };
  // Рамка и поле остаются в состоянии меню: по ним ловится щелчок и
  // проверяется вёрстка (tools/smoke.mjs). Считать их второй раз
  // отдельной копией — верный способ развести проверку с игрой.
  menu.rect = { x, y, w, h };
  menu.body = body;
  menu.fs = fs;

  ctx.font = `${fs}px ${MONO}`;
  if (menu.tab === 0) drawShip(ctx, body, game, fs);
  else if (menu.tab === 1) drawCargo(ctx, body, game, fs);
  else if (menu.tab === 2) drawMissions(ctx, body, game, fs);
  else drawFinance(ctx, body, game, fs);

  // Подвал: чем управлять и — главное — что корабль всё это время летит.
  const fy = y + h - footH;
  ctx.fillStyle = 'rgba(5,17,28,0.9)';
  ctx.fillRect(x, fy, w, footH);
  ctx.strokeStyle = CY_DIM;
  ctx.beginPath();
  ctx.moveTo(x, fy + 0.5); ctx.lineTo(x + w, fy + 0.5);
  ctx.stroke();
  ctx.font = `${fs}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = CY_DIM;
  ctx.fillText('1–4 РАЗДЕЛ · I ЗАКРЫТЬ', x + fs, fy + footH * 0.68);
  ctx.textAlign = 'right';
  ctx.fillStyle = AMBER;
  ctx.fillText('КОРАБЛЬ В ПОЛЁТЕ · ' + fmtSpeed(game.ship.speed), x + w - fs, fy + footH * 0.68);

  ctx.restore();
}
