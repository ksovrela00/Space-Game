// Качество связи: пинг и потери снимков.
//
// Нужно не ради красоты цифр. Сеть ломается не только «совсем»: гораздо
// чаще она просто становится хуже, и в игре это выглядит как чужой
// корабль, который дёргается или подвисает. Отличить «сеть подтормаживает»
// от «игра тормозит» глазами невозможно, а решение — стоит ли лететь на
// стыковку рядом с чужим кораблём — принимается именно по этому.
//
// Пинг меряется своим ping/pong по тому же сокету: время ответа сервера —
// единственное, что клиент может измерить честно. Потери считаются не по
// пакетам (их номеров нет), а по РИТМУ: сервер шлёт снимок каждый тик,
// поэтому дырки в потоке и его остановка видны по временам приходов.
//
// Модуль чистый: на входе числа, на выходе числа. Ни сокета, ни DOM.

/** Насколько новый замер сдвигает сглаженный пинг. */
export const PING_SMOOTH = 0.3;

/** Окно, за которое считаем потери, с. */
export const LINK_WINDOW = 4;

/**
 * Сглаженный пинг.
 *
 * Без сглаживания число скачет от замера к замеру и читается хуже, чем
 * не читается вовсе: глаз ловит движение и перестаёт верить цифре.
 */
export const smoothPing = (prev, rtt) =>
  (prev === null || !Number.isFinite(prev) ? rtt : prev + (rtt - prev) * PING_SMOOTH);

/**
 * Доля потерянных снимков за окно, 0..1.
 *
 * Считается не «сколько пришло за четыре секунды» — на границе окна такой
 * счёт шумит на целый снимок, и чистая связь показывала пять процентов
 * потерь на ровном месте. Считаем иначе: сколько снимков ДОЛЖНО было
 * прийти между первым и последним из тех, что пришли, — и отдельно
 * молчание с последнего снимка. Одно ловит дырки в потоке, другое — его
 * остановку; без второго оборвавшийся поток выглядел бы идеальным, ведь
 * пришедшие снимки были ровные.
 */
export function linkLoss(beats, tick, now, window = LINK_WINDOW) {
  if (!Array.isArray(beats) || !beats.length || !(tick > 0)) return 0;
  const fresh = beats.filter((t) => t >= now - window);
  if (!fresh.length) return 1;

  const first = fresh[0];
  const last = fresh[fresh.length - 1];
  const span = last - first;
  let loss = 0;
  if (span >= tick * 2) {
    const want = span / tick + 1;
    loss = Math.max(0, 1 - fresh.length / want);
  }

  // Молчание сверх одного тика — тоже потеря, и чем дольше, тем полнее.
  const silent = Math.max(0, now - last - tick);
  if (silent > 0) loss = Math.max(loss, Math.min(1, silent / window));
  return Math.min(1, loss);
}

/**
 * Оценка связи: 0 — нет, 4 — отличная.
 *
 * Пороги выбраны по тому, что видно в игре: до 60 мс чужой корабль идёт
 * гладко; после 300 мс он заметно отстаёт от своего же следа, и лететь
 * рядом уже нельзя. Потери бьют сильнее задержки — потерянный снимок это
 * не «позже», а «никогда».
 */
export function linkGrade(ping, loss) {
  if (ping === null || !Number.isFinite(ping)) return 0;
  if (loss > 0.3 || ping > 300) return 1;
  if (loss > 0.15 || ping > 150) return 2;
  if (loss > 0.05 || ping > 60) return 3;
  return 4;
}

/**
 * Состояние связи для приборов.
 *
 * @param net состояние сокета (js/net/socket.js)
 * @param api режим связи с API: 'online' | 'offline' | 'none'
 */
export function linkState(net, now, api = 'online') {
  const mode = net && net.state ? net.state : 'off';
  if (mode !== 'live') {
    return { mode, api, ping: null, loss: 1, grade: 0 };
  }
  const loss = linkLoss(net.beats, net.tick || 0.2, now);
  const ping = typeof net.ping === 'number' && Number.isFinite(net.ping) ? net.ping : null;
  return { mode, api, ping, loss, grade: linkGrade(ping, loss) };
}
