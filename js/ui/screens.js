// Экраны вне полёта: станция, крушение, помощь — как DOM-оверлей.
// Карта системы рисуется на canvas поверх сцены.

import { fmtDist } from './hud.js';
import { ST } from '../game/state.js';
import { landedInfo } from '../game/landing.js';

const overlay = () => document.getElementById('overlay');
const panelEl = () => document.getElementById('panel');

export function hideOverlay() {
  overlay().classList.add('hidden');
  panelEl().innerHTML = '';
}

const show = (html, buttons) => {
  const p = panelEl();
  p.innerHTML = html;
  const box = document.createElement('div');
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (b.ghost ? ' ghost' : '');
    btn.textContent = b.label;
    btn.addEventListener('click', b.onClick);
    box.appendChild(btn);
  }
  p.appendChild(box);
  overlay().classList.remove('hidden');
};

export function showDocked(game) {
  const st = game.ship.dockedAt;
  const planet = st ? st.parent : null;
  show(`
    <h1>СТЫКОВКА</h1>
    <h2>${st ? st.name : ''}</h2>
    <table class="rows">
      <tr><td>Планета</td><td class="v">${planet ? planet.name : '—'}</td></tr>
      <tr><td>Тип</td><td class="v">${planet ? KIND_RU[planet.kind] || planet.kind : '—'}</td></tr>
      <tr><td>Радиус планеты</td><td class="v">${planet ? fmtDist(planet.radius) : '—'}</td></tr>
      <tr><td>Высота орбиты</td><td class="v">${st && planet ? fmtDist(st.orbit.radius - planet.radius) : '—'}</td></tr>
      <tr><td>Состояние корпуса</td><td class="v">${Math.round(game.ship.hull)}%</td></tr>
      <tr><td>Стыковок выполнено</td><td class="v">${game.stats.docks}</td></tr>
    </table>
    <p class="sub">Корпус восстановлен. Порт свободен для вылета.</p>
  `, [
    { label: 'ВЫЛЕТ', onClick: () => game.launch() },
    { label: 'КАРТА СИСТЕМЫ', ghost: true, onClick: () => { hideOverlay(); game.state.mode = ST.MAP; } },
  ]);
}

export function showLanded(game) {
  const info = landedInfo(game.ship);
  const b = info ? info.body : null;
  const hemis = info && info.lat >= 0 ? 'с.ш.' : 'ю.ш.';
  show(`
    <h1>ПОСАДКА ВЫПОЛНЕНА</h1>
    <h2>${b ? b.name : ''}</h2>
    <table class="rows">
      <tr><td>Тип</td><td class="v">${b ? KIND_RU[b.kind] || b.kind : '—'}</td></tr>
      <tr><td>Радиус тела</td><td class="v">${b ? fmtDist(b.radius) : '—'}</td></tr>
      <tr><td>Тяжесть</td><td class="v">${b ? b.g0.toFixed(2) + ' м/с²' : '—'}</td></tr>
      <tr><td>Координаты</td><td class="v">${info ? Math.abs(info.lat).toFixed(2) + '° ' + hemis + ', ' + info.lon.toFixed(2) + '°' : '—'}</td></tr>
      <tr><td>Высота площадки</td><td class="v">${info ? fmtDist(info.height) : '—'}</td></tr>
      <tr><td>Состояние корпуса</td><td class="v">${Math.round(game.ship.hull)}%</td></tr>
      <tr><td>Посадок выполнено</td><td class="v">${game.stats.landings || 0}</td></tr>
    </table>
    <p class="sub">Ремонта здесь нет: корпус восстанавливают только на станциях.
      Шасси выпущено, взлёт — на посадочных движках.</p>
  `, [
    { label: 'ВЗЛЁТ', onClick: () => game.takeoff() },
    { label: 'КАРТА СИСТЕМЫ', ghost: true, onClick: () => { hideOverlay(); game.state.mode = ST.MAP; } },
  ]);
}

export function showCrash(game) {
  show(`
    <h1>КОРПУС РАЗРУШЕН</h1>
    <p class="warn">${game.crashReason || 'Столкновение на недопустимой скорости.'}</p>
    <p class="sub">Страховка восстановила корабль на последней станции.</p>
  `, [
    { label: 'ПРОДОЛЖИТЬ', onClick: () => game.respawn() },
  ]);
}

export function showHelp(game) {
  show(`
    <h1>УПРАВЛЕНИЕ</h1>
    <table class="rows">
      <tr><td>W / S</td><td class="v">нос вниз / вверх</td></tr>
      <tr><td>A / D</td><td class="v">рыскание влево / вправо</td></tr>
      <tr><td>Q / E</td><td class="v">крен влево / вправо</td></tr>
      <tr><td>&larr; / &rarr;</td><td class="v">крен (схема Elite)</td></tr>
      <tr><td>Shift / Ctrl</td><td class="v">тяга больше / меньше</td></tr>
      <tr><td>Ctrl (долго)</td><td class="v">задний ход (после остановки)</td></tr>
      <tr><td>X / Z</td><td class="v">тяга в ноль / полная</td></tr>
      <tr><td>R / F</td><td class="v">подъёмные движки: тяга вверх / вниз</td></tr>
      <tr><td>Tab / Shift+Tab</td><td class="v">следующая / предыдущая цель</td></tr>
      <tr><td>T / Y</td><td class="v">круизный ускоритель +/−</td></tr>
      <tr><td>J</td><td class="v">автопилот к цели</td></tr>
      <tr><td>C</td><td class="v">докинг-компьютер (ближе 120 км)</td></tr>
      <tr><td>G</td><td class="v">шасси: выпуск / уборка</td></tr>
      <tr><td>L</td><td class="v">посадочный компьютер (тела без атмосферы)</td></tr>
      <tr><td>V</td><td class="v">кокпит / вид от 3-го лица</td></tr>
      <tr><td>ПКМ (зажать)</td><td class="v">осмотр камерой от 3-го лица</td></tr>
      <tr><td>M</td><td class="v">карта системы</td></tr>
      <tr><td>H</td><td class="v">эта справка</td></tr>
      <tr><td>N</td><td class="v">звук: включить / выключить</td></tr>
      <tr><td>- / =</td><td class="v">громкость тише / громче</td></tr>
      <tr><td>~</td><td class="v">отладочный оверлей</td></tr>
      <tr><td>K / Shift+K</td><td class="v">телепорт к цели / смена высоты телепорта</td></tr>
      <tr><td>Space</td><td class="v">вылет со станции, взлёт, рестарт после крушения</td></tr>
    </table>
    <p class="sub">Стыковка: войти в щель порта носом вперёд, скорость ниже
      0.28 км/с, крен согласован с вращением станции (зелёные огни сверху).</p>
    <p class="sub">В центре экрана два знака: прицел — куда смотрит нос,
      зелёный кружок с усами — куда корабль летит на самом деле. Чем дальше
      они друг от друга, тем сильнее снос; перечёркнутый знак означает
      движение назад.</p>
    <p class="sub">Скорость — вектор с инерцией: на развороте корабль сносит
      по старому курсу, торможение требует расстояния. С выпущенным шасси
      выключается компенсатор высоты, и тяготение начинает действовать
      по-настоящему: корабль падает, бросок вперёд идёт по дуге, а зависание
      держится только тягой подъёмных движков (зависание — примерно треть
      хода R). Удар о грунт вне
      допусков даёт отскок, кувырок и потерю управления на несколько десятых
      секунды; корпус при этом теряет тем больше, чем сильнее удар — по
      квадрату скорости. Корабль гибнет, когда корпуса не осталось.</p>
    <p class="sub">Посадка: сесть можно на луны и голые планеты — там, где нет
      атмосферы. Отдельного режима нет: тяга по-прежнему ведёт корабль вдоль
      носа, а <b>R/F</b> поднимают и опускают его подъёмными движками, так что
      снижаться брюхом вниз и лететь вперёд можно одновременно. С выпущенным
      шасси компенсатор высоты отключается, и корабль проседает под своим
      весом — тем быстрее, чем тяжелее тело. Касаться грунта надо на шасси,
      брюхом вниз, вертикально не быстрее 30 м/с и с боковой скоростью не
      выше 25 м/с. Всё это умеет делать посадочный компьютер (<b>L</b>) — он
      же выбирает ровную площадку.</p>
    <p class="sub">У поверхности под кораблём рисуется кольцо на грунте
      радиусом 30 метров и пунктирная нить до корабля с высотой: по ним
      видно и реальный масштаб, и точку, куда корабль опустится. Тень от
      солнца падает на грунт по-настоящему — по расстоянию до неё высота
      видна сразу.</p>
    <p class="sub">Гравитационный захват: рядом с телом вокруг прицела
      появляется рамка приборов — скорость, высота над рельефом, вертикальная
      и боковая скорость, дистанция до цели, притяжение и посадочные условия.
      В захвате корабль переносится
      вместе с телом. Планета уходит по орбите и вращается — корабль идёт с
      ней, поэтому с нулевой тягой он висит над одной и той же точкой грунта,
      а не над одной и той же точкой пространства.</p>
  `, [
    { label: 'НАЗАД', onClick: () => game.closeOverlay() },
  ]);
}

export const KIND_RU = {
  star: 'звезда',
  lava: 'вулканическая',
  rock: 'каменистая',
  desert: 'пустынная',
  ocean: 'океаническая',
  ice: 'ледяная',
  gas: 'газовый гигант',
  moon: 'луна',
};

// --- Карта системы -----------------------------------------------------------

export function drawMap(r, game) {
  const ctx = r.ctx;
  const w = r.camera.w, h = r.camera.h;
  const cx = w / 2, cy = h / 2 + 10;
  const maxR = Math.min(w, h) * 0.40;

  ctx.save();
  ctx.fillStyle = 'rgba(0,4,10,0.88)';
  ctx.fillRect(0, 0, w, h);

  // Логарифмический радиус: иначе внутренние орбиты сливаются в точку.
  const outer = game.world.planets[game.world.planets.length - 1].orbit.radius;
  const scale = (dist) => {
    const t = Math.log10(1 + dist / 1000) / Math.log10(1 + outer / 1000);
    return t * maxR;
  };

  ctx.font = '11px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#4fb3e0';
  ctx.fillText('КАРТА СИСТЕМЫ ' + game.world.name.toUpperCase() + '   (M — закрыть)', cx, 34);

  // Светило
  ctx.fillStyle = '#ffe2a8';
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();

  const target = game.nav.list[game.nav.index];

  for (const p of game.world.planets) {
    const rr = scale(p.orbit.radius);
    ctx.strokeStyle = 'rgba(79,179,224,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();

    // Позиция на орбите: проекция мировых координат на плоскость XZ.
    const a = Math.atan2(p.pos.z, p.pos.x);
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;

    const isTarget = target === p || (p.station && target === p.station);
    ctx.fillStyle = isTarget ? '#ffcc66' : '#9fd9ff';
    ctx.beginPath();
    ctx.arc(px, py, p.kind === 'gas' ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = isTarget ? '#ffcc66' : 'rgba(159,217,230,0.7)';
    ctx.fillText(p.name + (p.station ? ' *' : ''), px + 8, py + 4);
  }

  // Корабль
  const sa = Math.atan2(game.ship.pos.z, game.ship.pos.x);
  const sr = scale(Math.hypot(game.ship.pos.x, game.ship.pos.z));
  const sx = cx + Math.cos(sa) * sr;
  const sy = cy + Math.sin(sa) * sr;
  ctx.strokeStyle = '#78e08f';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx - 5, sy); ctx.lineTo(sx + 5, sy);
  ctx.moveTo(sx, sy - 5); ctx.lineTo(sx, sy + 5);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(159,217,230,0.6)';
  ctx.fillText('* — есть станция   |   зелёный крест — ваш корабль', cx, h - 30);
  ctx.restore();
}
