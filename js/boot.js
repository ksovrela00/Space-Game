// Загрузчик: связаться с сервером — и только потом запустить игру.
//
// Без сервера игры нет. Автономного режима и запуска «из кэша» больше
// не существует: игра, которая без сервера живёт по своим правилам,
// молча расходится с настоящей. Поэтому здесь два вопроса до всего:
//
//   1. Есть ли вход. Нет токена — сразу на страницу входа.
//   2. Отвечает ли сервер: характеристики корабля (catalog.specs) и
//      состояние пилота (player.state). Не отвечает — на экране «НЕТ
//      СВЯЗИ С СЕРВЕРОМ», и попытки снова каждые RETRY. Ответил — игра
//      поднимается сама, перезагружать страницу не нужно.
//
// Отдельный файл нужен ещё и из-за порядка. Игра собирает корабль прямо
// при разборе своего модуля (`const ship = makeShip()`), и к этому
// моменту числа обязаны быть на месте. Ожидание внутрь main.js не
// поставить: его модуль к тому времени уже разбирается.

import { loadSpecs } from './game/specs.js';
import { start as sessionStart, session } from './net/session.js';
import { online as hasToken } from './net/api.js';
import { L, initLang } from './core/lang.js';

// Язык — до первой надписи: единственное, что этот файл может сказать
// игроку, это «нет связи», и сказать это он обязан на его языке.
initLang();

/** Через сколько пробовать снова, мс. */
export const RETRY = 3000;

/** Сказать, что сервера нет, и когда следующая попытка. */
function waiting(err, n) {
  const body = document.getElementById('bootBody');
  const text = L('НЕТ СВЯЗИ С СЕРВЕРОМ');
  const why = err && err.message ? err.message : String(err || '');
  const hint = L('Игра без сервера не запускается. Пробуем снова каждые ') + Math.round(RETRY / 1000)
    + L(' с · попытка ') + n;
  if (body) {
    body.innerHTML = '<p style="color:#ff7a66">' + text + '</p><p class="sub">' + why + '</p><p class="sub">'
      + hint + '</p>';
    const btn = document.getElementById('bootBtn');
    if (btn) btn.style.display = 'none';
  }
  console.warn(text + ': ' + why);
}

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Ждать сервер. true — можно запускать игру; false — ушли на страницу
 * входа (входа нет или он истёк).
 */
async function connect() {
  for (let n = 1; ; n++) {
    if (!hasToken()) {
      location.replace('login.html');
      return false;
    }
    try {
      await loadSpecs();
      const mode = await sessionStart();
      if (mode === 'none') {
        location.replace('login.html');
        return false;
      }
      if (mode === 'online') return true;
      throw new Error(session.error || L('сервер недоступен'));
    } catch (e) {
      waiting(e, n);
      await pause(RETRY);
    }
  }
}

if (await connect()) {
  const btn = document.getElementById('bootBtn');
  if (btn) btn.style.display = '';
  await import('./main.js');
}
