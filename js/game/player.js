// Дела пилота: кроны, трюм и задания.
//
// Почему это не часть корабля. Корабль — железо: корпус, приводы,
// ёмкость трюма. Пилоту принадлежит то, что он везёт, сколько ему
// должны и сколько у него денег, и всё это обязано пережить замену
// корпуса (а она будет). Поэтому здесь нет ни одной ссылки на ship:
// ёмкость трюма приходит снаружи параметром.
//
// Модуль ничего не рисует и ничего не знает про меню — меню только
// читает эти поля (js/ui/menu.js).

/** Местная валюта. */
export const CROWN = 'кр';

/**
 * Сколько записей ленты храним. Лента — это история, а не бухгалтерия:
 * баланс живёт отдельным числом именно поэтому. Считать его суммой
 * записей нельзя, как только самые старые начнут выпадать, — а они
 * начнут: за длинный вылет их набегают сотни.
 */
export const LEDGER_MAX = 60;

export function makePlayer(demo = true) {
  const p = {
    balance: 0,
    ledger: [],        // {t, label, sum} — sum > 0 пришло, < 0 ушло
    cargo: [],         // {id, name, tons}
    missions: [],      // {id, title, desc, reward, left, total}
    time: 0,           // часы пилота, с: по ним ставятся отметки в ленте
    nextId: 1,
    // Пришли ли эти данные с сервера. По нему меню решает, показывать ли
    // оговорку «стартовый набор»: выдуманный груз не должен выглядеть
    // как настоящий.
    server: false,
  };
  if (demo) seedDemo(p);
  return p;
}

/**
 * ЕДИНСТВЕННЫЙ вход для изменения баланса. Прямое присваивание
 * запрещено намеренно: раздел «Финансы» — это лента, и запись без
 * строки в ленте означала бы деньги, взявшиеся ниоткуда. Проверка на
 * это стоит в tools/test.mjs.
 */
export function ledgerAdd(p, label, sum) {
  const entry = { t: p.time, label, sum };
  p.balance += sum;
  p.ledger.push(entry);
  if (p.ledger.length > LEDGER_MAX) p.ledger.shift();
  return entry;
}

/** Сколько пришло и сколько ушло за то, что ещё помнит лента. */
export function ledgerTotals(p) {
  let inSum = 0, outSum = 0;
  for (const e of p.ledger) {
    if (e.sum >= 0) inSum += e.sum; else outSum -= e.sum;
  }
  return { in: inSum, out: outSum };
}

/** Занято в трюме, т. */
export function cargoTons(p) {
  let t = 0;
  for (const c of p.cargo) t += c.tons;
  return t;
}

/**
 * Взять груз. Тоннаж — единственная мера: объём мы не считаем вовсе,
 * и трюм меряется тоннами, как в накладной.
 *
 * @returns {boolean} влезло ли
 */
export function loadCargo(p, name, tons, hold) {
  if (!(tons > 0) || cargoTons(p) + tons > hold + 1e-9) return false;
  // Один и тот же товар не плодит строк: в трюме он лежит одной кучей.
  const same = p.cargo.find((c) => c.name === name);
  if (same) same.tons += tons;
  else p.cargo.push({ id: p.nextId++, name, tons });
  return true;
}

/** Сбросить груз целиком или часть (аварийный сброс, продажа). */
export function dropCargo(p, id, tons = Infinity) {
  const i = p.cargo.findIndex((c) => c.id === id);
  if (i < 0) return 0;
  const c = p.cargo[i];
  const gone = Math.min(c.tons, tons);
  c.tons -= gone;
  if (c.tons <= 1e-9) p.cargo.splice(i, 1);
  return gone;
}

export function addMission(p, m) {
  const mission = {
    id: p.nextId++,
    title: m.title,
    desc: m.desc || '',
    reward: m.reward || 0,
    left: m.time || 0,
    total: m.time || 0,
    done: false,
  };
  p.missions.push(mission);
  return mission;
}

/**
 * Часы пилота и сроки заданий.
 *
 * Просроченное задание из списка НЕ пропадает: игрок должен увидеть, что
 * он провалил и на сколько опоздал. Убирать его (и брать штраф) будет
 * доска заданий на станции, когда появится, — здесь для этого нет ни
 * заказчика, ни счёта.
 */
export function updatePlayer(p, dt) {
  p.time += dt;
  for (const m of p.missions) {
    if (!m.done && m.left > 0) m.left = Math.max(0, m.left - dt);
  }
}

export const missionExpired = (m) => !m.done && m.left <= 0;

/** Сохранение: только данные, без методов и без ссылок на мир. */
export function savePlayer(p) {
  return {
    balance: p.balance,
    ledger: p.ledger,
    cargo: p.cargo,
    missions: p.missions,
    time: p.time,
    nextId: p.nextId,
  };
}

/**
 * Загрузка. Сейв — это JSON из localStorage, то есть чужие данные: его
 * правят руками, он остаётся от прошлых версий игры и переживает смену
 * формата. Поэтому каждое поле проверяется по типу, а не берётся на
 * веру, — иначе первая же кривая запись роняет меню в полёте.
 */
export function loadPlayer(p, s) {
  if (!s || typeof s !== 'object') return p;
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
  p.balance = num(s.balance);
  p.time = num(s.time);
  p.nextId = Math.max(1, num(s.nextId, 1));
  p.ledger = Array.isArray(s.ledger)
    ? s.ledger.filter((e) => e && typeof e.label === 'string')
      .map((e) => ({ t: num(e.t), label: e.label, sum: num(e.sum) }))
      .slice(-LEDGER_MAX)
    : [];
  p.cargo = Array.isArray(s.cargo)
    ? s.cargo.filter((c) => c && typeof c.name === 'string' && num(c.tons) > 0)
      .map((c) => ({ id: num(c.id, p.nextId++), name: c.name, tons: num(c.tons) }))
    : [];
  p.missions = Array.isArray(s.missions)
    ? s.missions.filter((m) => m && typeof m.title === 'string').map((m) => ({
      id: num(m.id, p.nextId++),
      title: m.title,
      desc: typeof m.desc === 'string' ? m.desc : '',
      reward: num(m.reward),
      left: num(m.left),
      total: num(m.total, num(m.left)),
      done: !!m.done,
    }))
    : [];
  return p;
}

/**
 * Заполнить дела пилота состоянием с сервера.
 *
 * Поля перекладываются, а не используются как есть, ровно по одной
 * причине: меню рисует ОДНУ карточку и в сети, и без неё. Пусть
 * перекладывание живёт здесь, в одном месте, чем в каждом разделе меню
 * появится «если с сервера — то так, а если нет — то эдак».
 *
 * Стартовый набор при этом затирается целиком: как только сервер
 * отвечает, выдуманные вода и зерно в трюме — вранье.
 */
export function applyServer(p, st) {
  if (!st || !st.player) return p;

  p.balance = st.player.balance | 0;
  p.time = +st.player.playTimeS || 0;

  // Лента с сервера приходит СВЕЖИМ ВПЕРЁД, а здесь она хранится в
  // порядке событий: разворачиваем, иначе «Финансы» покажут историю
  // задом наперёд.
  p.ledger = (st.ledger || []).slice().reverse().map((e) => ({
    // `at` — время сервера (UTC). Держим его рядом с числовым t:
    // в сети отметка идёт по часам сервера, без сети — по часам пилота.
    at: e.at,
    t: p.time,
    label: e.label,
    sum: e.amount | 0,
  }));

  p.cargo = (st.cargo || []).map((c) => ({
    id: c.commodity_id,
    code: c.code,
    name: c.name,
    tons: +c.tons || 0,
    avgPrice: +c.avg_price || 0,
  }));

  p.missions = (st.missions || []).map((m) => ({
    id: m.id,
    title: m.title,
    desc: m.descr || '',
    reward: m.reward | 0,
    left: m.leftS === null || m.leftS === undefined ? 0 : +m.leftS,
    total: +m.timeLimitS || 0,
    done: m.state !== 'active',
    target: m.target ? m.target.name : null,
  }));

  p.nextId = Math.max(p.nextId, 1);
  p.server = true;
  return p;
}

/**
 * ВРЕМЕННО. Ни рынка, ни доски заданий ещё нет, а значит взять груз,
 * задание и первую крону пока неоткуда — все три раздела были бы пусты,
 * и посмотреть на них было бы нельзя. Это набор для вёрстки: как
 * появится станционная торговля, seedDemo убирается одной строкой в
 * makePlayer, и разделы наполняются по-настоящему.
 */
function seedDemo(p) {
  ledgerAdd(p, 'НАЧАЛЬНЫЙ КАПИТАЛ', 3400);
  ledgerAdd(p, 'СТРАХОВКА КОРПУСА, ВЗНОС', -250);
  ledgerAdd(p, 'ПОСТАВКА: ВОДА, 6 Т', -480);
  ledgerAdd(p, 'ПОСТАВКА: ЗЕРНО, 4 Т', -520);
  ledgerAdd(p, 'СТЫКОВОЧНЫЙ СБОР · LAVE II', -35);

  loadCargo(p, 'ВОДА', 6, 20);
  loadCargo(p, 'ЗЕРНО', 4, 20);
  loadCargo(p, 'ЖЕЛЕЗНАЯ РУДА', 3, 20);

  addMission(p, {
    title: 'ДОСТАВКА · LAVE VI',
    desc: 'Сдать 4 т зерна на станции газового гиганта. Груз в трюме.',
    reward: 1200,
    time: 40 * 60,
  });
  addMission(p, {
    title: 'РАЗВЕДКА · BEON',
    desc: 'Снять показания у звезды соседней системы. Нужен варп-прыжок.',
    reward: 2600,
    time: 75 * 60,
  });
}
