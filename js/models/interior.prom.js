// Помещения «Прометея»: план для сборщика js/models/interior.js.
//
// ЧТО ЭТО. Крейсер втрое длиннее «Челленджера», в нём тринадцать палуб
// (PROM.decks, js/models/prometheus.js), и помещения здесь — на всех:
//
//   палуба 1 (пол 46 м, голова башни) — мостик за тремя смотровыми окнами,
//     кабинет командира, зал совещаний;
//   палубы 2–5 (ствол башни) — управление полётами и каюта командира,
//     связь и сенсоры, инструктажная и кают-компания офицеров, каюты
//     офицеров и гауптвахта; окна ствола — настоящие;
//   палуба 6 (основание башни) — скафандровая, пост охраны, переход к
//     стыковочному узлу в будке на палубе;
//   палуба 7 (корма над маршевыми) — жилая палуба: кают-компания с окнами
//     в корму, камбуз, каюты, гидропоника и обсерватория в концах крыльев;
//   палуба 8 — коридор через весь средний корпус и двадцать две каюты
//     экипажа, у каждой иллюминатор — ровно там, где его рисует корпус;
//   палуба 9 — арсенал, склады, погреба ПРО;
//   палуба 10 — реакторный зал, пост энергетика, гиперпривод, двигательный
//     отсек;
//   палуба 11 — кормовой холл, машинное, медотсек, коридор вдоль корабля,
//     четыре шлюза среднего корпуса, арсенал, склад, лаборатория;
//   палуба 12 — топливные отсеки и трюм кормы;
//   палуба 13 (нос) — ангар-трюм в две палубы высотой, бортовые шлюзы с
//     трапами на грунт, кладовые и мастерские ангара.
//
// Палубы 1–12 связывает лифт в стволе башни: кабина на каждой палубе
// (js/game/lift.js). Палубу 11 с ангаром — трап в носу.
//
// ОСИ. План записан в осях СБОРКИ корпуса (м: z от среза сопел, y от
// киля) — так же, как PROM.decks и сам корпус, и числа читаются рядом с
// ними. В оси модели (начало в центре масс) их переводят Y() и Z(): сдвиг
// берётся у собранного корпуса (hull.prom.shift).
//
// ГДЕ МЕСТО. Ствол башни (x ±11, z 33–63) стоит над кормой, а корма под
// ним сплошная от киля до палубы: сердцевина между гондолами (y 0–7.6),
// нижняя плита (7–15), тёмный пояс (15–18) и верхняя плита (18–26). Шахта
// лифта в 3 × 3 м проходит всё это насквозь. Верхняя плита — во весь план
// кормы, 80 м от крыла до крыла: на ней жилая палуба. Средний корпус — 24 м
// в ширину (28 за серединой) и 26 в высоту. Нос ниже киля на 7.5 м: ангару
// там две палубы. Каждая комната вместе со стенами проверена по корпусу
// (tools/test.mjs, «помещения «Прометея»»).
//
// СБОРКА — ЛЕНИВАЯ (lazy): помещений полторы сотни, и сетки всех разом —
// это миллионы треугольников и сотни мегабайт. Сразу считается только
// твёрдое, двери и лампы; сетка комнаты собирается, когда комнату впервые
// видно (js/models/interior.js, meshOf).

import { INT, K, F, C, prop, lamp, buildFlat, makePlan, wallPoint, partBounds } from './interior.js';
import { CMAT } from './cockpit.js';

const H = INT.wallH;            // 3.32 м — высота стены пака
// Полы палуб (оси сборки), как в PROM.decks.
const FL = { 1: 46, 2: 42, 3: 38, 4: 34, 5: 30, 6: 26, 7: 22, 8: 18, 9: 14, 10: 10, 11: 6, 12: 2, 13: -3 };
const DECK = (n) => 'ПАЛУБА ' + n;

// Кабина лифта — одна шахта на все палубы: x ±1.6, z 40.2–43.4.
const CAR = { x: 1.6, z0: 40.2, z1: 43.4 };
const HALL_Z = 44.0;

/**
 * План помещений «Прометея» по собранному корпусу.
 * @param hull корпус (js/models/prometheus.js): из него — сдвиг осей
 */
export function prometheusPlan(hull) {
  const sh = hull.prom.shift;
  const Y = (y) => y - sh.y;
  const Z = (z) => z - sh.z;

  const rooms = [], doors = [], windows = [], openings = [];
  const fits = {};             // обстановка комнаты: вид (KINDS) или своя
  /** Комната: коробка в осях сборки; fit — вид обстановки. */
  const room = (id, name, n, x0, x1, z0, z1, fit, extra = {}) => {
    const y0 = extra.y0 !== undefined ? extra.y0 : FL[n];
    const y1 = extra.y1 !== undefined ? extra.y1 : y0 + H;
    const r = { id, name, deck: extra.deck || DECK(n), lo: [x0, Y(y0), Z(z0)], hi: [x1, Y(y1), Z(z1)] };
    if (extra.kind) r.kind = extra.kind;
    // Номер на двери (каюты палубы 8): к имени, без перевода.
    if (extra.num) r.num = extra.num;
    rooms.push(r);
    if (fit) fits[id] = fit;
    return r;
  };
  /** Дверь между a (сторона рамы) и b; c — середина по стене (оси сборки). */
  const door = (a, b, c, alongZ, code = false) => {
    doors.push({ id: a + '>' + b, a, b, c: alongZ ? Z(c) : c, code });
  };
  /** Окно в боковой стене (side ±1) — середина по z. */
  const winX = (id, s, zc, y, w, h) => windows.push({ room: id, side: s, c: Z(zc), y, w, h, id: id + ':' + windows.length });
  /** Окно в торцевой стене (side ±1 по z) — середина по x. */
  const winZ = (id, s, xc, y, w, h) => windows.push({ room: id, ax: 2, side: s, c: xc, y, w, h, id: id + ':' + windows.length });

  // ===== ПАЛУБА 1: голова башни ==============================================
  room('bridge', 'МОСТИК', 1, -11.8, 11.8, 55.0, 70.45, 'own', { y1: 51.0 });
  room('hall1', 'ЛИФТОВОЙ ХОЛЛ', 1, -3.0, 3.0, HALL_Z, 54.4, 'own');
  room('ready', 'КАБИНЕТ КОМАНДИРА', 1, -11.8, -3.6, HALL_Z, 54.4, 'own');
  room('chart', 'ЗАЛ СОВЕЩАНИЙ', 1, 3.6, 11.8, HALL_Z, 54.4, 'own');
  door('hall1', 'bridge', 0);
  door('hall1', 'ready', 49.2, true);
  door('hall1', 'chart', 49.2, true);
  // Лоб мостика — три смотровых окна корпуса (6.9, 6.6 и 6.9 × 4 м): стена
  // повторяет их проёмы. Обшивку в них не режут: у корпуса там настоящие
  // проёмы со стеклом (carve: false).
  for (const [c, w] of [[-7.45, 6.9], [0, 6.6], [7.45, 6.9]]) {
    windows.push({ id: 'bf' + c, room: 'bridge', ax: 2, side: 1, c, y: 0.3, w, h: 4.0, carve: false });
  }
  // Борта головы — окна в рост (накладки модели, winRow палубы 1):
  // по четыре на мостике, по три в комнатах за ним.
  for (const s of [-1, 1]) {
    for (const z of [56.9, 59.5, 62.1, 64.7]) winX('bridge', s, z, 1.05, 1.4, 1.9);
    for (const z of [46.5, 49.1, 51.7]) winX(s < 0 ? 'ready' : 'chart', s, z, 1.05, 1.4, 1.9);
  }

  // ===== ЛИФТ: кабины на палубах 1–12 ========================================
  const STOPS = [
    [1, 'МОСТИК'], [2, 'УПРАВЛЕНИЕ ПОЛЁТАМИ · КАЮТА КОМАНДИРА'], [3, 'СВЯЗЬ И СЕНСОРЫ'],
    [4, 'ИНСТРУКТАЖНАЯ · КАЮТ-КОМПАНИЯ ОФИЦЕРОВ'], [5, 'КАЮТЫ ОФИЦЕРОВ'], [6, 'СТЫКОВОЧНЫЙ УЗЕЛ'],
    [7, 'ЖИЛАЯ ПАЛУБА · КАЮТ-КОМПАНИЯ'], [8, 'КАЮТЫ ЭКИПАЖА'], [9, 'АРСЕНАЛ И СКЛАДЫ'],
    [10, 'РЕАКТОР · ГИПЕРПРИВОД'], [11, 'ШЛЮЗЫ · КОРИДОР В НОС · АНГАР'], [12, 'ТОПЛИВО · ТРЮМ'],
  ];
  for (const [n] of STOPS) {
    room('lift' + n, 'ЛИФТ', n, -CAR.x, CAR.x, CAR.z0, CAR.z1, 'own', { kind: 'lift' });
    door('hall' + n, 'lift' + n, 0);
  }

  // ===== ПАЛУБЫ 2–6: ствол и основание башни ==================================
  //
  // Один шаблон: холл от кабины лифта вперёд, по бокам — по две комнаты, за
  // кабиной — по одной (вход — из передней). Ствол — x ±11, и стены комнат
  // в полуметре от обшивки: окна ствола (накладки модели, палубы 3–5)
  // изнутри настоящие — тех же размеров и там же. Углы ствола срезаны
  // фаской в 2.2 м: боковые комнаты до них не доходят (sideFore, zAft).
  const TRUNK_WIN = [37.2, 39.6, 42.0, 44.4, 46.8, 49.2, 51.6, 54.0, 56.4, 58.8];
  const tower = (n, xMax, zAft, zFore, names, opts = {}) => {
    const hall = 'hall' + n;
    room(hall, opts.hallName || 'КОРИДОР', n, -1.8, 1.8, HALL_Z, zFore, 'hall');
    const zHall = zFore;
    zFore = opts.sideFore || zFore;
    const zMid = (HALL_Z + zFore) / 2;
    names.forEach(([nameA, fitA, nameB, fitB, nameC, fitC], i) => {
      const s = i === 0 ? -1 : 1;
      const side = s < 0 ? 'L' : 'R';
      const xs = (a, b) => (s < 0 ? [-b, -a] : [a, b]);
      const A = `d${n}${side}a`, B = `d${n}${side}b`, Cc = `d${n}${side}c`;
      room(A, nameA, n, ...xs(2.4, xMax), HALL_Z, zMid - 0.3, fitA);
      room(B, nameB, n, ...xs(2.4, xMax), zMid + 0.3, zFore, fitB);
      room(Cc, nameC, n, ...xs(2.2, xMax), zAft, CAR.z1, fitC);
      door(hall, A, (HALL_Z + zMid - 0.3) / 2, true);
      door(hall, B, Math.min((zMid + 0.3 + zFore) / 2, zHall - 1.6), true);
      door(A, Cc, s * (2.4 + xMax) / 2);
      if (opts.windows) {
        for (const [id, z0, z1] of [[A, HALL_Z, zMid - 0.3], [B, zMid + 0.3, zFore], [Cc, zAft, CAR.z1]]) {
          for (const z of TRUNK_WIN) if (z - 0.55 > z0 + 0.2 && z + 0.55 < z1 - 0.2) winX(id, s, z, 1.05, 1.1, 0.9);
        }
      }
    });
  };
  tower(2, 10.5, 36.5, 62.5, [
    ['ПОСТ УПРАВЛЕНИЯ ПОЛЁТАМИ', 'comms', 'ДИСПЕТЧЕРСКАЯ АНГАРА', 'comms', 'ТЕХНИЧЕСКИЙ ОТСЕК', 'store'],
    ['КАБИНЕТ', 'office', 'КАЮТА КОМАНДИРА', 'cabin2', 'САНУЗЕЛ', 'wash'],
  ], { sideFore: 60.25 });
  tower(3, 10.5, 35.75, 62.5, [
    ['СВЯЗЬ', 'comms', 'ШИФРОВАЛЬНАЯ', 'comms', 'АППАРАТНАЯ', 'servers'],
    ['СЕНСОРЫ', 'comms', 'ПОСТ НАБЛЮДЕНИЯ', 'comms', 'СКЛАД ЗИП', 'store'],
  ], { sideFore: 60.25, windows: true });
  tower(4, 10.5, 35.75, 62.5, [
    ['ИНСТРУКТАЖНАЯ', 'conf', 'АРХИВ', 'library', 'ОРУЖЕЙНАЯ', 'armory'],
    ['КАЮТ-КОМПАНИЯ ОФИЦЕРОВ', 'lounge', 'БУФЕТ', 'galley', 'САНУЗЕЛ', 'wash'],
  ], { sideFore: 60.25, windows: true });
  tower(5, 10.5, 35.75, 62.5, [
    ['КАЮТА ОФИЦЕРА', 'cabin2', 'КАЮТА ОФИЦЕРА', 'cabin2', 'ГАУПТВАХТА', 'brig'],
    ['КАЮТА ОФИЦЕРА', 'cabin2', 'КАЮТА ОФИЦЕРА', 'cabin2', 'САНУЗЕЛ', 'wash'],
  ], { sideFore: 60.25, windows: true });
  // Палуба 6 — основание башни (плинтус x ±13.5 с фасками по углам) и
  // переход сквозь контрфорс в будку на палубе: там стыковочный узел.
  tower(6, 11.0, 31.6, 64.4, [
    ['СКАФАНДРОВАЯ', 'suits', 'ПОСТ ОХРАНЫ', 'office', 'МАСТЕРСКАЯ', 'lab'],
    ['КЛАДОВАЯ', 'store', 'ТЕХНИЧЕСКИЙ ОТСЕК', 'store', 'СКЛАД', 'store'],
  ], { hallName: 'ВЕСТИБЮЛЬ' });
  room('dockway', 'ПЕРЕХОД К СТЫКОВОЧНОМУ УЗЛУ', 6, -1.2, 1.2, 65.0, 77.4, 'hall');
  room('dock', 'СТЫКОВОЧНЫЙ УЗЕЛ', 6, -4.0, 4.0, 78.0, 81.5, 'suits');
  door('hall6', 'dockway', 0, false, true);
  door('dockway', 'dock', 0, false, true);

  // ===== ПАЛУБА 7: жилая палуба кормы =========================================
  //
  // Верхняя плита кормы — во весь её план. Холл лифта выходит в
  // поперечный коридор; от него два продольных — к кормовому коридору,
  // вдоль которого жилые помещения, а за ними, у самой кормы, — кают-
  // компания с окнами назад. Концы крыльев — гидропоника и обсерватория с
  // окнами в торцах.
  room('hall7', 'ЛИФТОВОЙ ХОЛЛ', 7, -1.8, 1.8, HALL_Z, 52.4, 'hall');
  room('cor7', 'КОРИДОР', 7, -25.5, 25.5, 53.0, 55.4, 'hall');
  room('cor7A', 'КОРМОВОЙ КОРИДОР', 7, -37.0, 37.0, 37.0, 39.4, 'hall');
  door('hall7', 'cor7', 0);
  for (const s of [-1, 1]) {
    const S = s < 0 ? 'L' : 'R';
    const xs = (a, b) => (s < 0 ? [-b, -a] : [a, b]);
    room('cor7' + S, 'КОРИДОР', 7, ...xs(14.0, 16.4), 40.0, 52.4, 'hall');
    door('cor7' + S, 'cor7', s * 15.2, false, true);
    door('cor7' + S, 'cor7A', s * 15.2, false, true);
    room('d7in' + S, 'КАЮТЫ ЭКИПАЖА', 7, ...xs(2.4, 13.4), 40.0, 52.4, 'quarters');
    room('d7out' + S, s < 0 ? 'МЕДОТСЕК' : 'ЗАЛ ОТДЫХА', 7, ...xs(17.0, 30.0), 40.0, 52.4, s < 0 ? 'med' : 'lounge');
    door('cor7' + S, 'd7in' + S, 46.2, true);
    door('cor7' + S, 'd7out' + S, 46.2, true);
    // Концы крыльев: окна в торце (накладки модели, z 24.1–33.7).
    const wing = 'd7wing' + S;
    room(wing, s < 0 ? 'ГИДРОПОНИКА' : 'ОБСЕРВАТОРИЯ', 7, ...xs(27.1, 39.4), 20.5, 36.4, s < 0 ? 'plants' : 'lounge');
    door('cor7A', wing, s * 33.0);
    for (const z of [24.1, 27.3, 30.5, 33.7]) winX(wing, s, z, 1.05, 1.4, 1.0);
  }
  // Ряд у кормового коридора и ряд у кормы (окна — в торце плиты, z = 9).
  const D7F = [['d7f1', 'ПРАЧЕЧНАЯ', -26.5, -13.9, 'laundry'], ['d7f2', 'КАМБУЗ', -13.3, -0.3, 'galley'],
    ['d7f3', 'КЛАДОВАЯ ПРОВИЗИИ', 0.3, 13.3, 'store'], ['d7f4', 'БИБЛИОТЕКА', 13.9, 26.5, 'library']];
  for (const [id, name, x0, x1, fit] of D7F) {
    room(id, name, 7, x0, x1, 23.0, 36.4, fit);
    door('cor7A', id, (x0 + x1) / 2);
  }
  room('d7b1', 'КАЮТЫ ЭКИПАЖА', 7, -26.5, -13.9, 9.6, 22.4, 'quarters');
  room('d7mess', 'КАЮТ-КОМПАНИЯ', 7, -13.3, 13.3, 9.6, 22.4, 'own');
  room('d7b3', 'КАЮТЫ ЭКИПАЖА', 7, 13.9, 26.5, 9.6, 22.4, 'quarters');
  door('d7f1', 'd7b1', -20.2);
  door('d7f2', 'd7mess', -6.8);
  door('d7f3', 'd7mess', 6.8);
  door('d7f4', 'd7b3', 20.2);
  // Окна кормы: накладки модели (winRow по торцу z = 9) — x −22.8 + 2.4k,
  // без каждого пятого со сдвигом на два.
  for (let k = 0; k < 20; k++) {
    if (k % 5 === 2) continue;
    const x = -22.8 + 2.4 * k;
    const id = x < -14.65 ? 'd7b1' : x > 14.65 ? 'd7b3' : Math.abs(x) < 12.55 ? 'd7mess' : null;
    if (id && Math.abs(x) > 0.1) winZ(id, -1, x, 1.05, 1.1, 0.9);
  }

  // ===== ПАЛУБА 8: каюты экипажа ==============================================
  //
  // Коридор через корму и весь средний корпус, по бортам — каюты. Каюта
  // шириной 5.4 м — шаг иллюминаторов корпуса (накладки модели, winRow
  // палубы 8): у каждой ровно один, посередине внешней стены.
  room('hall8', 'ЛИФТОВОЙ ХОЛЛ', 8, -1.8, 1.8, HALL_Z, 52.4, 'hall');
  room('cor8A', 'КОРИДОР', 8, -1.2, 1.2, 53.0, 106.4, 'hall');
  room('cor8B', 'КОРИДОР', 8, -1.2, 1.2, 107.0, 140.4, 'hall');
  door('hall8', 'cor8A', 0, false, true);
  door('cor8A', 'cor8B', 0, false, true);
  let cab = 0;
  for (const s of [-1, 1]) {
    const S = s < 0 ? 'L' : 'R';
    const xs = (a, b) => (s < 0 ? [-b, -a] : [a, b]);
    room('d8s' + S, s < 0 ? 'КОМНАТА ОТДЫХА' : 'МЕДОТСЕК', 8, ...xs(2.4, 12.0), HALL_Z, 52.4, s < 0 ? 'lounge' : 'med');
    door('hall8', 'd8s' + S, 48.2, true);
    room('d8w' + S, s < 0 ? 'ДУШЕВАЯ' : 'САНУЗЕЛ', 8, ...xs(1.8, 8.0), 53.6, 62.6, 'wash');
    room('d8l' + S, s < 0 ? 'ПРАЧЕЧНАЯ' : 'КЛАДОВАЯ', 8, ...xs(1.8, 8.0), 63.2, 72.2, s < 0 ? 'laundry' : 'store');
    room('d8t' + S, s < 0 ? 'САНУЗЕЛ' : 'КЛАДОВАЯ', 8, ...xs(1.8, 11.4), 99.8, 106.4, s < 0 ? 'wash' : 'store');
    door('cor8A', 'd8w' + S, 58.1, true);
    door('cor8A', 'd8l' + S, 67.7, true);
    door('cor8A', 'd8t' + S, 103.0, true);
    for (const zc of [75.2, 80.6, 86.0, 91.4, 96.8, 110.0, 115.4, 120.8, 126.2, 131.6, 137.0]) {
      const W = zc < 100 ? 11.5 : 13.5;
      const id = 'cab' + (++cab);
      room(id, 'КАЮТА', 8, ...xs(1.8, W), zc - 2.4, zc + 2.4, 'cabin', { num: '8-' + String(cab).padStart(2, '0') });
      door(zc < 106.4 ? 'cor8A' : 'cor8B', id, zc, true);
      winX(id, s, zc, 1.0, 1.5, 1.3);
    }
  }

  // ===== ПАЛУБЫ 9, 10, 12: корма под башней ====================================
  const stern = (n, names, xA = 14.0) => {
    const hall = 'hall' + n;
    room(hall, 'ЛИФТОВОЙ ХОЛЛ', n, -1.8, 1.8, HALL_Z, 52.4, 'hall');
    names.forEach(([nameA, fitA, nameC, fitC], i) => {
      const s = i === 0 ? -1 : 1;
      const S = s < 0 ? 'L' : 'R';
      const xs = (a, b) => (s < 0 ? [-b, -a] : [a, b]);
      room(`d${n}${S}a`, nameA, n, ...xs(2.4, xA), HALL_Z, 52.4, fitA);
      room(`d${n}${S}c`, nameC, n, ...xs(2.2, xA), 30.0, CAR.z1, fitC);
      door(hall, `d${n}${S}a`, 48.2, true);
      door(`d${n}${S}a`, `d${n}${S}c`, s * 8.0);
    });
  };
  // Палуба 9: арсенал, склады и погреба ПРО (желоб с башнями снаружи).
  stern(9, [['АРСЕНАЛ', 'armory', 'СКЛАД ПРОДОВОЛЬСТВИЯ', 'store'], ['СКЛАД БОЕПРИПАСОВ', 'store', 'СКЛАД', 'store']]);
  room('cor9', 'КОРИДОР', 9, -1.2, 1.2, 53.0, 82.0, 'hall');
  door('hall9', 'cor9', 0, false, true);
  for (const s of [-1, 1]) {
    const id = 'd9pro' + (s < 0 ? 'L' : 'R');
    room(id, 'ПОГРЕБ ПРО', 9, ...(s < 0 ? [-9.6, -1.8] : [1.8, 9.6]), 70.6, 82.0, 'store');
    door('cor9', id, 76.3, true);
  }
  // Палуба 10: реактор и приводы.
  room('hall10', 'ЛИФТОВОЙ ХОЛЛ', 10, -1.8, 1.8, HALL_Z, 52.4, 'hall');
  room('reactor', 'РЕАКТОРНЫЙ ЗАЛ', 10, -24.0, -2.4, 26.0, 52.4, 'own');
  room('power', 'ПОСТ ЭНЕРГЕТИКА', 10, 2.4, 12.0, HALL_Z, 52.4, 'comms');
  room('hyper', 'ГИПЕРПРИВОД', 10, 2.4, 24.0, 26.0, CAR.z1, 'own');
  room('engines', 'ДВИГАТЕЛЬНЫЙ ОТСЕК', 10, -14.0, 14.0, 12.0, 25.4, 'own');
  door('hall10', 'reactor', 48.2, true);
  door('hall10', 'power', 48.2, true);
  door('power', 'hyper', 7.2);
  door('reactor', 'engines', -8.0);
  door('hyper', 'engines', 8.0);
  // Палуба 12: топливо и трюм кормы.
  stern(12, [['НАСОСНАЯ', 'tanks', 'ТОПЛИВНЫЙ ОТСЕК', 'tanks'], ['ТОПЛИВНЫЙ ОТСЕК', 'tanks', 'ТОПЛИВНЫЙ ОТСЕК', 'tanks']]);
  room('cor12', 'ТРЮМНЫЙ КОРИДОР', 12, -1.2, 1.2, 53.0, 69.4, 'hall');
  door('hall12', 'cor12', 0, false, true);
  for (const s of [-1, 1]) {
    const id = 'd12h' + (s < 0 ? 'L' : 'R');
    room(id, 'ТРЮМ', 12, ...(s < 0 ? [-13.0, -1.8] : [1.8, 13.0]), 57.0, 69.4, 'store');
    door('cor12', id, 63.2, true);
  }

  // ===== ПАЛУБА 11 ===========================================================
  room('hall11', 'КОРМОВОЙ ХОЛЛ', 11, -6.0, 6.0, HALL_Z, 52.4, 'own');
  room('engine', 'МАШИННОЕ ОТДЕЛЕНИЕ', 11, -12.0, -2.2, 30.0, 43.4, 'own');
  room('mess', 'СТОЛОВАЯ ЭКИПАЖА', 11, 2.2, 12.0, 30.0, 43.4, 'own');
  room('medS', 'МЕДОТСЕК', 11, -12.0, -6.6, HALL_Z, 52.4, 'own');
  room('crew', 'КАЮТЫ ЭКИПАЖА', 11, 6.6, 12.0, HALL_Z, 52.4, 'own');
  door('hall11', 'engine', -4.1);
  door('hall11', 'mess', 4.1);
  door('hall11', 'medS', 48.2, true);
  door('hall11', 'crew', 48.2, true);
  // Коридор вдоль корабля и что по его бортам.
  const STAIR_TOP = 141.0;
  const stairBot = STAIR_TOP + (Math.round((FL[11] - FL[13]) / INT.rise) - 1) * INT.tread;
  room('corS', 'КОРИДОР', 11, -1.2, 1.2, 53.0, 83.6, 'own');
  room('corM', 'КОРИДОР', 11, -1.2, 1.2, 84.2, 127.8, 'own');
  room('corF', 'КОРИДОР', 11, -1.2, 1.2, 128.4, STAIR_TOP, 'own');
  door('hall11', 'corS', 0, false, true);
  door('corS', 'corM', 0, false, true);
  door('corM', 'corF', 0, false, true);
  for (const s of [-1, 1]) {
    const S = s < 0 ? 'L' : 'R';
    const xs = (a, b) => (s < 0 ? [-b, -a] : [a, b]);
    room('air' + S + '86', s < 0 ? 'ШЛЮЗ ЛЕВОГО БОРТА' : 'ШЛЮЗ ПРАВОГО БОРТА', 11, ...xs(1.8, 11.2), 84.2, 87.8, 'own', { kind: 'lock' });
    room('air' + S + '130', s < 0 ? 'ШЛЮЗ ЛЕВОГО БОРТА' : 'ШЛЮЗ ПРАВОГО БОРТА', 11, ...xs(1.8, 13.2), 128.2, 131.8, 'own', { kind: 'lock' });
    door('corM', 'air' + S + '86', 86.0, true);
    door('corF', 'air' + S + '130', 130.0, true);
  }
  room('armory', 'АРСЕНАЛ', 11, -11.2, -1.8, 92.0, 100.0, 'own');
  room('cabinM', 'КАЮТА СТАРПОМА', 11, 1.8, 11.2, 92.0, 100.0, 'own');
  room('store', 'СКЛАД', 11, -13.2, -1.8, 107.0, 124.0, 'own');
  room('lab', 'ЛАБОРАТОРИЯ', 11, 1.8, 13.2, 107.0, 124.0, 'own');
  for (const id of ['armory', 'cabinM']) door('corM', id, 96.0, true);
  for (const id of ['store', 'lab']) door('corM', id, 115.5, true);

  // ===== ТРАП В НОС И ПАЛУБА 13 ================================================
  room('stairF', 'ТРАП', 13, -0.8, 0.8, STAIR_TOP, stairBot, 'own', { y1: 8.3, kind: 'shaft', deck: 'ПАЛУБЫ 11–13' });
  room('hangar', 'НОСОВОЙ АНГАР', 13, -12.5, 12.5, stairBot, 185.0, 'own', { y1: 4.6 });
  openings.push({ a: 'corF', b: 'stairF', u: [-0.8, 0.8], y: [Y(FL[11]), Y(8.3)] });
  openings.push({ a: 'stairF', b: 'hangar', u: [-0.8, 0.8], y: [Y(FL[13]), Y(4.6)] });
  for (const s of [-1, 1]) {
    const S = s < 0 ? 'L' : 'R';
    const xs = (a, b) => (s < 0 ? [-b, -a] : [a, b]);
    room('airB' + S, 'БОРТОВОЙ ШЛЮЗ', 13, ...xs(13.1, 18.0), 155.6, 160.6, 'own', { kind: 'lock' });
    room('d13k' + S, 'КЛАДОВАЯ АНГАРА', 13, ...xs(13.1, 18.0), 161.2, 172.0, 'store');
    room('d13w' + S, 'МАСТЕРСКАЯ АНГАРА', 13, ...xs(13.1, 18.0), 172.6, 184.4, 'lab');
    door('hangar', 'airB' + S, 158.1, true);
    door('hangar', 'd13k' + S, 166.6, true);
    door('hangar', 'd13w' + S, 178.5, true);
  }

  // Отделка крупнее у больших залов: плитка по 2.25–3 м и гладких стен
  // больше. Пак рассчитан на комнаты в пару стен длиной, а у крейсера
  // ангар — 25 × 32 м, коридоры — по полсотни метров.
  for (const r of rooms) {
    const w = r.hi[0] - r.lo[0], d = r.hi[2] - r.lo[2];
    r.plain = w < 3.7 || d < 3.7 ? 0.65 : 0.45;
    if (w * d > 150) { r.tile = 2.25; r.plain = 0.55; }
    if (w * d > 500) { r.tile = 3.0; r.plain = 0.75; }
  }

  const stairs = [
    { id: 'F', x: 0, zTop: Z(STAIR_TOP), yTop: Y(FL[11]), yBot: Y(FL[13]), dir: 1, room: 'stairF', to: 'hangar' },
  ];

  // Люки — те же двери на обшивке, что у модели (js/models/prometheus.js,
  // hatches). На грунт выходят из всех шести. Порог носовых (палуба 13) — в
  // 10.5 м над грунтом, трап в 52 ступени. У среднего корпуса порог на
  // палубе 11, в 19.5 м: трап в 97 ступеней, 23 м по горизонтали — сходня,
  // как у лайнера. Под ними ни гондол, ни стоек, ни крыльев: шлюзы на
  // z 86 и 130, гондолы кончаются на 72, нос начинается на 140. Панель —
  // заподлицо с бортом (на модели это накладка, а не ниша), поэтому
  // inset = skin.
  const hatch = (id, lock, side, skin, zc, w, y0, y1, extra = {}) => ({
    id, lock, side, skin, inset: skin, z: [Z(zc - w / 2), Z(zc + w / 2)], y: [Y(y0), Y(y1)],
    rgb: [112, 116, 124], ...extra,
  });
  const hatches = [
    hatch('lockL86', 'airL86', -1, 12.0, 86, 2.4, 6.0, 8.8),
    hatch('lockR86', 'airR86', 1, 12.0, 86, 2.4, 6.0, 8.8),
    hatch('lockL130', 'airL130', -1, 14.0, 130, 2.4, 6.0, 8.8),
    hatch('lockR130', 'airR130', 1, 14.0, 130, 2.4, 6.0, 8.8),
    hatch('bowL', 'airBL', -1, 18.5, 158.1, 2.6, -3.0, -0.2),
    hatch('bowR', 'airBR', 1, 18.5, 158.1, 2.6, -3.0, -0.2),
  ];

  // Вырез обшивки в окнах — одной коробкой на стену комнаты: от стены на
  // метр наружу (обшивка — в полуметре), по всем её окнам. Коробок в
  // шейдере шестнадцать, а окон у кают-компании палубы 7 — восемь. Между
  // окнами обшивку изнутри и так закрывает стена.
  const windowCarve = [];
  const byWall = new Map();
  for (const w of windows) {
    if (w.carve === false) continue;
    const key = w.room + ':' + (w.ax || 0) + ':' + w.side;
    if (!byWall.has(key)) byWall.set(key, []);
    byWall.get(key).push(w);
  }
  for (const list of byWall.values()) {
    const w0 = list[0], r = rooms.find((x) => x.id === w0.room);
    const ax = w0.ax || 0, uAx = ax === 0 ? 2 : 0;
    const at = w0.side < 0 ? r.lo[ax] : r.hi[ax];
    const lo = [0, 0, 0], hi = [0, 0, 0];
    lo[ax] = Math.min(at - w0.side * 0.05, at + w0.side * 1.0); hi[ax] = Math.max(at - w0.side * 0.05, at + w0.side * 1.0);
    lo[uAx] = Math.min(...list.map((w) => w.c - w.w / 2)) + 0.005;
    hi[uAx] = Math.max(...list.map((w) => w.c + w.w / 2)) - 0.005;
    lo[1] = r.lo[1] + Math.min(...list.map((w) => w.y)) + 0.005;
    hi[1] = r.lo[1] + Math.max(...list.map((w) => w.y + w.h)) - 0.005;
    windowCarve.push({ room: w0.room, lo, hi });
  }

  // Лифт: кабины одной шахты по палубам. Пульт — на правой стенке кабины.
  const R = Object.fromEntries(rooms.map((r) => [r.id, r]));
  const lifts = [{
    id: 'A', name: 'ЛИФТ',
    // Скорость кабины — шесть метров в секунду, как у лифтов высотных
    // зданий: от мостика до палубы 11 (сорок метров) — восемь секунд.
    speed: 6, accel: 2.5,
    stops: STOPS.map(([n, what]) => {
      const r = R['lift' + n];
      return { room: r.id, door: 'hall' + n + '>lift' + n, deck: DECK(n), n, what,
        panel: [r.hi[0] - 0.1, r.lo[1] + 1.2, (r.lo[2] + r.hi[2]) / 2] };
    }),
  }];

  const seatEye = [0, Y(47.6), Z(66.5)];
  return makePlan({
    code: 'prometheus',
    lazy: true,
    roomCarve: true,
    INT: { ...INT, deck: { bridge: Y(FL[1]), d11: Y(FL[11]), d13: Y(FL[13]) } },
    rooms, stairs, doors, hatches, windows, openings, lifts, windowCarve,
    landings: (ctx) => {
      // Пол шахты трапа под маршем — на палубе 13.
      const r = ctx.P.R.stairF;
      buildFlat(ctx.meshes.stairF, { side: 'y-', at: r.lo[1], u: [r.lo[0], r.hi[0]], v: [r.lo[2], r.hi[2]], holes: [] });
    },
    furnish: (ctx) => furnish(ctx, fits, Y, Z),
    // Свет снаружи — только на палубе 1, под окнами мостика (у окон
    // остальных палуб солнца в помещении нет, как у «Челленджера»).
    sunBox: { lo: [-12.2, Y(FL[1] - 0.2), Z(39.8)], hi: [12.2, Y(51.5), Z(71.2)] },
    // Кресло командира — на оси мостика, в 4.5 м от лобовых окон (глаз —
    // тот же, что у мостика корпуса, js/models/prometheus.js). Встав, он
    // оказывается за креслом; сесть — стоя за креслом.
    seat: {
      eye: seatEye, stand: [0, Y(FL[1]), Z(65.3)],
      zone: { lo: [-1.4, Y(FL[1]) - 0.5, Z(64.1)], hi: [1.4, Y(FL[1]) + 2.6, Z(66.25)] },
      room: 'bridge',
    },
    origin: seatEye,
    // Солнце в окна мостика: круг карты теней — во весь мостик и комнаты
    // за ним (sunBox, 24 × 31 м).
    sunR: 17,
    holdRoom: 'hangar',
    slots: () => hangarSlots(R.hangar, Y(FL[13]), Z(160.3)),
  });
}

/**
 * Места под ящики в ангаре: ряды вдоль бортов, в два яруса, от носовой
 * стены к корме — до дверей бортовых шлюзов.
 */
function hangarSlots(Hg, floor, zMin) {
  const s = 0.8 * 1.4, h = 0.806 * 1.4;
  const out = [];
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; ; i++) {
      const z = Hg.hi[2] - 0.4 - s / 2 - i * (s + 0.06);
      if (z - s / 2 < zMin) break;
      for (const sx of [-1, 1]) {
        out.push({ x: sx * (Hg.hi[0] - 0.16 - s / 2), y: floor + layer * (h + 0.005), z,
          yaw: (((i * 7 + layer * 13 + (sx > 0 ? 3 : 0)) % 9) / 9 - 0.5) * 0.12, half: s / 2, h });
      }
    }
  }
  return out;
}

// --- обстановка по видам --------------------------------------------------------
//
// Предметы ставятся вдоль стен по свободным отрезкам (lineUp): мимо дверей
// (по 1.1 м в обе стороны от проёма), проёмов и люков, а высокие — и мимо
// окон. Лампы — по сетке потолка, примерно через 4.5 м.

const sc = (s) => (Array.isArray(s) ? s : [s, s, s]);
const it = (n, s, extra = {}) => ({ n, s, ...extra });
const DESK = it('desk', F, { top: [it('screen', F, { y: 0.77, d: 0.17, solid: false })] });
const SINK = it('washSink', F, { top: [it('mirror', F, { y: 1.2, solid: false, flat: true })] });
const KINDS = {
  cabin: [it('bunk', F), it('locker', F), DESK, it('locker', F), it('sideTable', F)],
  cabin2: [it('bunk', F), it('locker', F), it('locker', F), DESK, it('sofa', F), it('plant', F)],
  quarters: [it('bunk', F), it('bunk', F), it('bunk', F), it('bunk', F), it('locker', F), it('locker', F),
    it('locker', F), it('bunk', F), it('bunk', F), it('sideTable', F)],
  wash: [it('shower', F), it('toilet', F), SINK, it('washer', F), it('shower', F), it('toilet', F), SINK, it('trash', F)],
  office: [DESK, it('shelf', K), it('computerSmall', K), it('locker', F), it('plant', F)],
  comms: [it('computer', K), it('computer', K), it('computerSmall', K), it('computer', K), it('computer', K),
    it('computerSmall', K), DESK, it('computer', K)],
  servers: [it('computer', K), it('computer', K), it('computer', K), it('computer', K), it('computer', K),
    it('computer', K), it('computer', K), it('computer', K), it('computerSmall', K)],
  lab: [it('computer', K), it('capsule', K * 1.25), it('shelf', K), DESK, it('vessel', K), it('vesselTall', K),
    it('computer', K), it('shelf', K)],
  store: [it('shelfTall', K), it('shelf', K), it('crate', K), it('shelfTall', K), it('crate', K), it('shelf', K),
    it('shelfTall', K), it('crate', K), it('crate', K), it('shelfTall', K)],
  armory: [it('shelfTall', K), it('locker', F), it('locker', F), it('locker', F), it('shelfTall', K), it('crate', K),
    it('locker', F), it('crate', K)],
  lounge: [it('sofa', F), it('tv', F * 1.4, { y: 1.2, solid: false, flat: true }), it('sofa', F), it('plant', F),
    it('sideTable', F), it('plant', F), it('sofa', F)],
  galley: [it('cabinet', F), it('sink', F), it('cabinet', F), it('stove', F), it('cabinet', F), it('fridge', F),
    it('cabinet', F), it('cabinet', F)],
  conf: [it('tv', F * 1.6, { y: 1.2, solid: false, flat: true }), it('plant', F), it('shelf', K), it('plant', F)],
  library: [it('shelfTall', K), it('shelfTall', K), DESK, it('shelfTall', K), it('sofa', F), it('shelfTall', K), it('plant', F)],
  suits: [it('locker', F), it('locker', F), it('locker', F), it('locker', F), it('locker', F), it('locker', F),
    it('vesselTall', K), it('locker', F), it('locker', F)],
  brig: [it('bunk', F), it('toilet', F), SINK, it('bunk', F)],
  laundry: [it('washer', F), it('washer', F), it('washer', F), it('shelf', K), it('washer', F), it('trash', F)],
  plants: [it('shelf', K), it('plant', F), it('plant', F), it('shelf', K), it('plant', F), it('plant', F),
    it('shelf', K), it('plant', F), it('plant', F), it('shelf', K)],
  med: [it('capsule', K * 1.25), it('capsule', K * 1.25), it('computer', K), it('shelf', K), it('capsule', K * 1.25), it('vessel', K)],
  tanks: [it('pod', K), it('vesselTall', K), it('vesselTall', K), it('pod', K), it('vesselTall', K), it('computerSmall', K)],
  hall: [it('plant', F)],
};

/**
 * Расставить предметы вдоль стен комнаты r.
 *
 * Занятое считается в плане, прямоугольниками: перед каждой дверью,
 * проёмом и люком — проход в 1.6 м (и шире проёма по бокам), всё, что
 * в комнате уже стоит (стол посередине), и уже расставленное. Предмет
 * встаёт к стене задней стенкой, лицом в комнату, и занимает в плане
 * свою ширину вдоль стены и глубину от неё: койка торцом к стене уходит
 * в комнату на 2.2 м, и у угла с дверью она перегородила бы проход —
 * так и было, пока проверялась только полоса вдоль стены. У предмета
 * выше подоконника — ещё и мимо окон. Стены — по кругу, без дверей
 * вперёд.
 */
function lineUp(ctx, buf, r, items) {
  const faces = ctx.faces[r.id].filter((f) => f.ax !== 1);
  const walls = faces.map((f) => ({ f, at: f.u[0] + 0.45, end: f.u[1] - 0.45 }));
  walls.sort((a, b) => a.f.holes.filter((h) => h.door).length - b.f.holes.filter((h) => h.door).length
    || (b.f.u[1] - b.f.u[0]) - (a.f.u[1] - a.f.u[0]));
  const y0 = r.lo[1];
  const taken = [];
  for (const f of faces) {
    for (const h of f.holes) {
      if (h.window) continue;
      const wide = h.door ? 0.35 : h.hatch ? 0.8 : 0.3;
      taken.push(planRect(f, h.u[0] - wide, h.u[1] + wide, 1.6));
    }
  }
  for (const sd of ctx.solids) {
    if (!sd.prop || sd.hi[0] < r.lo[0] || sd.lo[0] > r.hi[0] || sd.hi[2] < r.lo[2] || sd.lo[2] > r.hi[2]
      || sd.hi[1] < r.lo[1] || sd.lo[1] > r.hi[1]) continue;
    taken.push([sd.lo[0], sd.lo[2], sd.hi[0], sd.hi[2]]);
  }
  const hits = (q) => taken.find((t) => q[0] < t[2] - 0.02 && q[2] > t[0] + 0.02 && q[1] < t[3] - 0.02 && q[3] > t[1] + 0.02);
  let wi = 0;
  for (const item of items) {
    const [lo, hi] = partBounds(item.n);
    const s = sc(item.s);
    const width = (hi[0] - lo[0]) * s[0], depth = (hi[2] - lo[2]) * s[2] + 0.06, top = y0 + hi[1] * s[1] + (item.y || 0);
    for (let tries = 0; tries < walls.length; tries++) {
      const W = walls[(wi + tries) % walls.length];
      const f = W.f;
      const wins = [];
      for (const h of f.holes) if (h.window && top > h.v[0] - 0.02) wins.push([h.u[0] - 0.08, h.u[1] + 0.08]);
      let u = W.at, placed = null;
      while (u + width <= W.end) {
        const win = wins.find(([a, b]) => u < b && u + width > a);
        if (win) { u = win[1] + 0.01; continue; }
        const q = planRect(f, u, u + width, depth);
        const t = hits(q);
        if (!t) { placed = q; break; }
        // Сдвинуться за занятое вдоль стены.
        const tu = f.uAx === 0 ? t[2] : t[3];
        u = Math.max(u + 0.1, tu + 0.01);
      }
      if (!placed) continue;
      placeAt(ctx, buf, f, item, u + width / 2, y0);
      taken.push(placed);
      W.at = u + width + 0.12;
      wi = (wi + tries + 1) % walls.length;
      break;
    }
  }
}

/** Прямоугольник в плане у стены f: вдоль неё [u0, u1], от неё — на глубину d. */
function planRect(f, u0, u1, d) {
  const a = f.at, b = f.at + f.n[f.ax] * d;
  const n0 = Math.min(a, b), n1 = Math.max(a, b);
  return f.ax === 0 ? [n0, u0, n1, u1] : [u0, n0, u1, n1];
}

/** Предмет у стены f: середина по стене uc, лицом в комнату. */
function placeAt(ctx, buf, f, item, uc, y0) {
  const yaw = Math.atan2(f.n[0], f.n[2]);
  const ux = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const sgn = Math.sign(ux[f.uAx]) || 1;
  const put = (o, dBase) => {
    const [lo, hi] = partBounds(o.n);
    const s = sc(o.s);
    const cx = (lo[0] + hi[0]) / 2 * s[0];
    const d = (dBase || 0) + (o.flat ? 0.02 : 0.04) - lo[2] * s[2];
    const p = wallPoint(f, uc - sgn * cx, y0 + (o.y || 0), d);
    prop(ctx, buf, o.n, p[0], p[1], p[2], yaw, o.s, { solid: o.solid !== false });
  };
  put(item, 0);
  for (const t of item.top || []) put(t, t.d || 0);
}

/** Лампы по сетке потолка: примерно через 4.5 м. */
function ceilingLamps(ctx, buf, r, opts = {}) {
  const w = r.hi[0] - r.lo[0], d = r.hi[2] - r.lo[2];
  const nx = Math.max(1, Math.round(w / 4.5)), nz = Math.max(1, Math.round(d / 4.5));
  const range = opts.range || Math.max(3.2, r.hi[1] - r.lo[1] + 0.8);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      lamp(ctx, buf, r, r.lo[0] + (i + 0.5) * w / nx, r.lo[2] + (j + 0.5) * d / nz,
        { alongX: w > d, w: Math.min(0.9, Math.max(w, d) * 0.4), range, kind: opts.kind, color: opts.color });
    }
  }
}

/** Стол с креслами посередине комнаты (совещания, кают-компании). */
function tableSet(ctx, buf, r, n = 3, chair = 'chair') {
  const x = (r.lo[0] + r.hi[0]) / 2, z = (r.lo[2] + r.hi[2]) / 2, y = r.lo[1];
  const along = (r.hi[2] - r.lo[2]) > (r.hi[0] - r.lo[0]);
  const PI = Math.PI;
  prop(ctx, buf, 'table', x, y, z, along ? PI / 2 : 0, [F * (n * 0.55), F * 1.15, F * 1.4]);
  for (let k = 0; k < n; k++) {
    const t = (k - (n - 1) / 2) * 1.0;
    if (along) {
      prop(ctx, buf, chair, x - 0.8, y, z + t, PI / 2, F);
      prop(ctx, buf, chair, x + 0.8, y, z + t, -PI / 2, F);
    } else {
      prop(ctx, buf, chair, x + t, y, z - 0.8, 0, F);
      prop(ctx, buf, chair, x + t, y, z + 0.8, PI, F);
    }
  }
}

function furnish(ctx, fits, Y, Z) {
  const M = ctx.meshes, R = ctx.P.R;
  // Сначала — по видам: всё, у чего обстановка не своя.
  for (const r of ctx.P.rooms) {
    const fit = fits[r.id];
    if (!fit || fit === 'own') continue;
    const b = M[r.id];
    if (fit === 'conf') tableSet(ctx, b, r, 3);
    if (fit === 'lounge') {
      const x = (r.lo[0] + r.hi[0]) / 2, z = (r.lo[2] + r.hi[2]) / 2;
      prop(ctx, b, 'coffeeTable', x, r.lo[1], z, 0, F);
      prop(ctx, b, 'rug', x, r.lo[1] + 0.004, z, 0, F, { solid: false });
    }
    lineUp(ctx, b, r, KINDS[fit] || []);
    ceilingLamps(ctx, b, r, fit === 'med' ? { color: [0.82, 0.9, 0.95] } : {});
  }
  ownRooms(ctx, M, R, Y, Z);
}

// --- своя обстановка -------------------------------------------------------------

function ownRooms(ctx, M, R, Y, Z) {
  const y1 = R.bridge.lo[1], y11 = R.hall11.lo[1], y13 = R.hangar.lo[1];
  const PI = Math.PI;

  // --- мостик: кресло командира на оси, рулевой справа, штурман слева
  // (канон), посты по бортам под окнами и между ними, планшет-карта
  // позади кресла.
  let b = M.bridge;
  const Br = R.bridge;
  prop(ctx, b, 'deskChair', 0, y1, Z(66.85), 0, F * 1.15);
  for (const sx of [-1, 1]) {
    prop(ctx, b, 'computerSmall', sx * 3.4, y1, Z(69.7), PI, K * 1.1);
    prop(ctx, b, 'deskChair', sx * 3.4, y1, Z(68.6), 0, F);
    for (const z of [56.9, 59.5, 62.1, 64.7]) prop(ctx, b, 'desk', sx * (Br.hi[0] - 0.42), y1, Z(z), -sx * PI / 2, F);
    for (const z of [58.2, 60.8, 63.4]) prop(ctx, b, 'computerSmall', sx * (Br.hi[0] - 0.3), y1, Z(z), -sx * PI / 2, K);
    prop(ctx, b, 'deskChair', sx * (Br.hi[0] - 1.2), y1, Z(59.5), sx * PI / 2, F);
    prop(ctx, b, 'deskChair', sx * (Br.hi[0] - 1.2), y1, Z(64.7), sx * PI / 2, F);
    // Большие экраны на задней стене, по бокам от двери.
    prop(ctx, b, 'tv', sx * 6.0, y1 + 1.5, Br.lo[2] + 0.14, 0, F * 2.2, { solid: false });
  }
  // Планшет — стол с картой, светящейся сверху; обход — по бортам от него.
  prop(ctx, b, 'table', 0, y1, Z(59.0), PI / 2, [F * 2.6, F * 2.9, F * 1.6]);
  b.box([-1.15, y1 + 0.955, Z(57.6)], [1.15, y1 + 0.965, Z(60.4)], [70, 150, 235], CMAT.lamp, 0.9);
  ctx.lamps.push({ pos: [0, y1 + 1.4, Z(59.0)], dir: [0, 1, 0], cos: -2, color: [0.25, 0.5, 0.9], range: 2.6,
    room: 'bridge', kind: 'ceiling' });
  for (const x of [-6.5, 0, 6.5]) {
    for (const z of [58.0, 63.0, 67.8]) lamp(ctx, b, Br, x, Z(z), { w: 1.4, range: 6.0 });
  }

  // --- холл мостика.
  b = M.hall1;
  const Lt = R.hall1;
  for (const sx of [-1, 1]) prop(ctx, b, 'plant', sx * 2.55, y1, Lt.hi[2] - 0.35, 0, F);
  for (const z of [46.6, 51.6]) lamp(ctx, b, Lt, 0, Z(z), { alongX: true, range: 3.6 });

  // --- кабинет командира: стол у передней стены, диван, стеллажи.
  b = M.ready;
  const Rd = R.ready;
  prop(ctx, b, 'desk', -7.6, y1, Rd.hi[2] - 0.5, PI, F);
  prop(ctx, b, 'screen', -7.6, y1 + 0.77, Rd.hi[2] - 0.33, PI, F, { solid: false });
  prop(ctx, b, 'deskChair', -7.6, y1, Rd.hi[2] - 1.15, 0, F);
  prop(ctx, b, 'shelfTall', -9.6, y1, Rd.lo[2] + 0.42, 0, K);
  prop(ctx, b, 'shelfTall', -6.6, y1, Rd.lo[2] + 0.42, 0, K);
  prop(ctx, b, 'sofa', -4.4, y1, Z(49.2) - 2.4, -PI / 2, F);
  prop(ctx, b, 'rug', -7.4, y1 + 0.004, Z(49.2), PI / 2, F, { solid: false });
  lamp(ctx, b, Rd, -7.6, Z(47.0), { range: 3.6 });
  lamp(ctx, b, Rd, -7.6, Z(52.0), { range: 3.6 });

  // --- зал совещаний.
  b = M.chart;
  const Ch = R.chart;
  tableSet(ctx, b, Ch, 3);
  prop(ctx, b, 'tv', 7.7, y1 + 1.2, Ch.hi[2] - 0.14, PI, F * 1.6, { solid: false });
  lamp(ctx, b, Ch, 7.7, Z(47.0), { alongX: true, range: 3.6 });
  lamp(ctx, b, Ch, 7.7, Z(51.8), { alongX: true, range: 3.6 });

  // --- кабины лифта: пульт на правой стенке, свет.
  for (const L of ctx.P.lifts) {
    for (const st of L.stops) {
      const r = R[st.room], bb = M[st.room];
      const x = r.hi[0], y = r.lo[1] + 1.0, z = (r.lo[2] + r.hi[2]) / 2;
      bb.box([x - 0.06, y, z - 0.25], [x, y + 0.55, z + 0.25], C.dark, CMAT.trim);
      bb.box([x - 0.075, y + 0.12, z - 0.18], [x - 0.06, y + 0.44, z + 0.18], [70, 190, 150], CMAT.paint, 0.8);
      bb.box([x - 0.08, y - 0.03, z - 0.27], [x, y, z + 0.27], C.hazard, CMAT.hazard);
      lamp(ctx, bb, r, 0, z, { alongX: true, w: 1.2, range: 3.0 });
    }
  }

  // --- кают-компания палубы 7: длинные столы, диваны у окон в корму.
  b = M.d7mess;
  const Dm = R.d7mess;
  for (const x of [-7.0, 0, 7.0]) {
    const r = { lo: [x - 2.2, Dm.lo[1], Dm.lo[2] + 4.0], hi: [x + 2.2, Dm.hi[1], Dm.hi[2] - 2.6] };
    tableSet(ctx, b, r, 4);
  }
  for (const x of [-11.0, -5.0, 5.0, 11.0]) prop(ctx, b, 'sofa', x, Dm.lo[1], Dm.lo[2] + 0.45, 0, F);
  prop(ctx, b, 'plant', -12.8, Dm.lo[1], Dm.hi[2] - 0.4, 0, F);
  prop(ctx, b, 'plant', 12.8, Dm.lo[1], Dm.hi[2] - 0.4, 0, F);
  ceilingLamps(ctx, b, Dm);

  // --- реакторный зал: шесть реакторов, их свет — по работе движков
  // (как у «Челленджера», js/gl/cabin.js, kind 'reactor').
  b = M.reactor;
  const Re = R.reactor;
  for (const z of [30.0, 35.5, 41.0]) {
    for (const x of [-18.0, -9.0]) {
      prop(ctx, b, 'pod', x, Re.lo[1], Z(z), 0, K * 1.15);
      ctx.lamps.push({ pos: [x, Re.lo[1] + 1.5, Z(z)], dir: [0, -1, 0], cos: -2, color: [0.25, 0.6, 0.95], range: 2.6,
        room: 'reactor', kind: 'reactor' });
    }
  }
  lineUp(ctx, b, Re, [it('computerSmall', K), it('computerSmall', K), it('computer', K), it('computer', K),
    it('vesselTall', K), it('vesselTall', K), it('shelfTall', K)]);
  ceilingLamps(ctx, b, Re);

  // --- гиперпривод: синие сердечники (канон: гипердвигатель светится синим).
  b = M.hyper;
  const Hy = R.hyper;
  for (const z of [31.0, 37.5]) {
    for (const x of [9.0, 17.5]) {
      prop(ctx, b, 'pod', x, Hy.lo[1], Z(z), 0, K * 1.15);
      ctx.lamps.push({ pos: [x, Hy.lo[1] + 1.5, Z(z)], dir: [0, -1, 0], cos: -2, color: [0.3, 0.45, 1.0], range: 2.6,
        room: 'hyper', kind: 'reactor' });
    }
  }
  lineUp(ctx, b, Hy, [it('computer', K), it('computerSmall', K), it('computer', K), it('vesselTall', K)]);
  ceilingLamps(ctx, b, Hy);

  // --- двигательный отсек: над маршевыми соплами.
  b = M.engines;
  const Eg = R.engines;
  for (const x of [-8.5, 8.5]) {
    prop(ctx, b, 'pod', x, Eg.lo[1], Z(17.0), 0, K * 1.15);
    prop(ctx, b, 'pod', x, Eg.lo[1], Z(21.5), 0, K * 1.15);
  }
  lineUp(ctx, b, Eg, [it('computer', K), it('computerSmall', K), it('vesselTall', K), it('vesselTall', K),
    it('shelfTall', K), it('computer', K)]);
  ceilingLamps(ctx, b, Eg);

  // --- кормовой холл палубы 11.
  b = M.hall11;
  const Hs = R.hall11;
  for (const sx of [-1, 1]) prop(ctx, b, 'plant', sx * 5.6, y11, Hs.hi[2] - 0.35, 0, F);
  prop(ctx, b, 'computerSmall', 2.6, y11, Hs.hi[2] - 0.3, PI, K);
  for (const x of [-3, 3]) for (const z of [46.0, 50.4]) lamp(ctx, b, Hs, x, Z(z), { range: 3.6 });

  // --- машинное палубы 11: вспомогательные реакторы, пульты, баллоны.
  b = M.engine;
  const En = R.engine;
  for (const z of [34.0, 39.6]) {
    prop(ctx, b, 'pod', -7.6, y11, Z(z), 0, K * 1.15);
    ctx.lamps.push({ pos: [-7.6, y11 + 1.5, Z(z)], dir: [0, -1, 0], cos: -2, color: [0.25, 0.6, 0.95], range: 2.6,
      room: 'engine', kind: 'reactor' });
  }
  for (const x of [-10.6, -9.6, -4.6, -3.6]) prop(ctx, b, 'computerSmall', x, y11, En.lo[2] + 0.3, 0, K);
  for (const z of [33.0, 36.0, 39.0]) prop(ctx, b, 'vesselTall', En.lo[0] + 0.3, y11, Z(z), 0, K);
  prop(ctx, b, 'shelfTall', -3.0, y11, Z(37.0), -PI / 2, K);
  for (const z of [33.0, 37.0, 41.0]) lamp(ctx, b, En, -4.6, Z(z), { range: 3.6 });

  // --- столовая палубы 11: камбуз по правому борту, столы.
  b = M.mess;
  const Ms = R.mess;
  ['cabinet', 'sink', 'cabinet', 'stove', 'cabinet', 'cabinet', 'cabinet'].forEach((name, i) => {
    const z = Z(32.0) + i * 0.9;
    prop(ctx, b, name, Ms.hi[0] - 0.55, y11, z, -PI / 2, F);
    prop(ctx, b, 'cabinetUpper', Ms.hi[0] - 0.32, y11 + 1.45, z, -PI / 2, F, { solid: false });
  });
  prop(ctx, b, 'fridge', Ms.hi[0] - 0.52, y11, Z(39.3), -PI / 2, F);
  prop(ctx, b, 'coffee', Ms.hi[0] - 0.55, y11 + 0.9, Z(32.0), -PI / 2, F, { solid: false });
  prop(ctx, b, 'microwave', Ms.hi[0] - 0.55, y11 + 0.9, Z(33.8), -PI / 2, F, { solid: false });
  for (const z of [33.5, 38.5]) {
    prop(ctx, b, 'table', 6.0, y11, Z(z), PI / 2, [F, F * 1.15, F * 1.3]);
    for (const dz of [-0.55, 0.55]) {
      prop(ctx, b, 'chair', 5.2, y11, Z(z) + dz, PI / 2, F);
      prop(ctx, b, 'chair', 6.8, y11, Z(z) + dz, -PI / 2, F);
    }
  }
  prop(ctx, b, 'sofa', Ms.lo[0] + 0.45, y11, Z(36.0), PI / 2, F);
  prop(ctx, b, 'tv', 6.0, y11 + 1.2, Ms.lo[2] + 0.14, 0, F, { solid: false });
  prop(ctx, b, 'trash', Ms.lo[0] + 0.3, y11, Z(42.9), 0, F);
  for (const x of [4.5, 9.0]) for (const z of [33.0, 38.5]) lamp(ctx, b, Ms, x, Z(z), { range: 3.6 });

  // --- медотсек и каюты кормы палубы 11.
  b = M.medS;
  const Md = R.medS;
  prop(ctx, b, 'capsule', Md.lo[0] + 0.7, y11, Z(46.0), PI / 2, K * 1.25);
  prop(ctx, b, 'capsule', Md.lo[0] + 0.7, y11, Z(48.6), PI / 2, K * 1.25);
  prop(ctx, b, 'computer', Md.lo[0] + 0.55, y11, Z(51.2), PI / 2, K);
  prop(ctx, b, 'shelf', -9.3, y11, Md.lo[2] + 0.42, 0, K);
  lamp(ctx, b, Md, -9.3, Z(46.4), { range: 3.2, color: [0.82, 0.9, 0.95] });
  lamp(ctx, b, Md, -9.3, Z(50.6), { range: 3.2, color: [0.82, 0.9, 0.95] });
  b = M.crew;
  const Cr = R.crew;
  for (const z of [45.3, 47.8, 50.3]) prop(ctx, b, 'bunk', Cr.hi[0] - 0.66, y11, Z(z) + 0.4, 0, F);
  for (const z of [46.4, 48.9]) prop(ctx, b, 'locker', Cr.hi[0] - 0.36, y11, Z(z) + 0.6, -PI / 2, F);
  prop(ctx, b, 'sideTable', 7.4, y11, Cr.hi[2] - 0.32, PI, F);
  lamp(ctx, b, Cr, 9.3, Z(46.4), { range: 3.2 });
  lamp(ctx, b, Cr, 9.3, Z(50.6), { range: 3.2 });

  // --- коридоры палубы 11: свет через шесть метров.
  for (const id of ['corS', 'corM', 'corF']) {
    const r = R[id];
    for (let z = r.lo[2] + 2.4; z < r.hi[2] - 1.0; z += 6.0) lamp(ctx, M[id], r, 0, z, { alongX: true, w: 0.7, range: 3.2 });
  }

  // --- шлюзы палубы 11: шкафчики со скафандрами, баллоны.
  for (const id of ['airL86', 'airR86', 'airL130', 'airR130']) {
    const r = R[id], bb = M[id];
    const s = r.lo[0] < 0 ? -1 : 1;
    const xin = s < 0 ? r.hi[0] : r.lo[0];
    for (const dx of [2.6, 3.4, 4.2]) prop(ctx, bb, 'locker', xin + s * dx, y11, r.lo[2] + 0.27, 0, F);
    prop(ctx, bb, 'vesselTall', xin + s * 5.4, y11, r.lo[2] + 0.3, 0, K);
    for (const dx of [2.6, 6.4]) lamp(ctx, bb, r, xin + s * dx, (r.lo[2] + r.hi[2]) / 2, { alongX: true, range: 3.6, kind: 'lock' });
  }

  // --- арсенал, каюта старпома, склад и лаборатория палубы 11.
  b = M.armory;
  const Ar = R.armory;
  for (const z of [93.4, 97.8]) prop(ctx, b, 'shelfTall', Ar.lo[0] + 0.42, y11, Z(z), PI / 2, K);
  for (const x of [-9.0, -7.0, -5.0]) prop(ctx, b, 'locker', x, y11, Ar.hi[2] - 0.27, PI, F);
  prop(ctx, b, 'crate', -4.0, y11, Ar.lo[2] + 0.5, 0.2, K);
  prop(ctx, b, 'crate', -5.0, y11, Ar.lo[2] + 0.5, -0.1, K);
  prop(ctx, b, 'crate', -4.0, y11 + 0.605, Ar.lo[2] + 0.5, 0.05, K);
  lamp(ctx, b, Ar, -6.5, Z(94.2), { alongX: true, range: 3.6 });
  lamp(ctx, b, Ar, -6.5, Z(97.8), { alongX: true, range: 3.6 });
  b = M.cabinM;
  const Cm = R.cabinM;
  prop(ctx, b, 'bunk', Cm.hi[0] - 0.66, y11, Z(94.0), 0, F);
  prop(ctx, b, 'locker', Cm.hi[0] - 0.36, y11, Z(97.6), -PI / 2, F);
  prop(ctx, b, 'desk', 6.0, y11, Cm.hi[2] - 0.5, PI, F);
  prop(ctx, b, 'screen', 6.0, y11 + 0.77, Cm.hi[2] - 0.33, PI, F, { solid: false });
  prop(ctx, b, 'deskChair', 6.0, y11, Cm.hi[2] - 1.15, 0, F);
  prop(ctx, b, 'rug', 6.5, y11 + 0.004, Z(95.6), 0, F, { solid: false });
  lamp(ctx, b, Cm, 6.5, Z(94.2), { range: 3.4 });
  lamp(ctx, b, Cm, 6.5, Z(97.8), { range: 3.4 });
  b = M.store;
  const So = R.store;
  for (const z of [109.0, 113.0, 118.0, 122.0]) prop(ctx, b, 'shelfTall', So.lo[0] + 0.42, y11, Z(z), PI / 2, K);
  for (const x of [-11.0, -8.5, -6.0]) prop(ctx, b, 'shelf', x, y11, So.hi[2] - 0.42, PI, K);
  for (const [x, z, yaw] of [[-8.0, 110.0, 0.2], [-7.0, 110.2, -0.1], [-8.0, 111.1, 0.05], [-9.4, 119.6, 0.3]]) {
    prop(ctx, b, 'crate', x, y11, Z(z), yaw, K);
  }
  prop(ctx, b, 'crate', -7.5, y11 + 0.605, Z(110.1), 0.1, K);
  for (const z of [109.5, 115.5, 121.5]) lamp(ctx, b, So, -7.5, Z(z), { alongX: true, range: 3.8 });
  b = M.lab;
  const Lb = R.lab;
  for (const z of [109.0, 111.0, 113.0]) prop(ctx, b, 'computer', Lb.hi[0] - 0.55, y11, Z(z), -PI / 2, K);
  prop(ctx, b, 'capsule', Lb.hi[0] - 0.7, y11, Z(121.5), -PI / 2, K * 1.25);
  prop(ctx, b, 'desk', 7.0, y11, Z(118.5), 0, F);
  prop(ctx, b, 'screen', 7.0, y11 + 0.77, Z(118.5) - 0.17, 0, F, { solid: false });
  for (const z of [120.5, 121.0]) prop(ctx, b, 'vessel', 4.0, y11, Z(z), 0, K);
  prop(ctx, b, 'shelf', 7.0, y11, Lb.lo[2] + 0.42, 0, K);
  for (const z of [109.5, 115.5, 121.5]) lamp(ctx, b, Lb, 7.5, Z(z), { alongX: true, range: 3.8, color: [0.85, 0.92, 1.0] });

  // --- шлюзы бортов носа: шкафчики со скафандрами.
  for (const id of ['airBL', 'airBR']) {
    const r = R[id], bb = M[id];
    const xm = (r.lo[0] + r.hi[0]) / 2;
    for (const dz of [0.35, 1.15]) prop(ctx, bb, 'locker', xm, y13, r.lo[2] + dz, 0, F);
    prop(ctx, bb, 'vesselTall', xm + 1.2, y13, r.lo[2] + 0.3, 0, K);
    lamp(ctx, bb, r, xm, (r.lo[2] + r.hi[2]) / 2, { range: 3.6, kind: 'lock' });
  }

  // --- трап в нос.
  const Sf = R.stairF;
  for (const z of [143.0, 147.5, 151.8]) lamp(ctx, M.stairF, Sf, 0, Z(z), { alongX: true, w: 0.6, range: 5.0 });

  // --- ангар: пульты у кормовой стены, свет под потолком (две палубы).
  b = M.hangar;
  const Hg = R.hangar;
  for (const x of [-4.0, 4.0]) prop(ctx, b, 'computerSmall', x, y13, Hg.lo[2] + 0.3, 0, K);
  for (const x of [-6.5, 6.5]) {
    for (const z of [158.0, 165.5, 173.0, 180.5]) lamp(ctx, b, Hg, x, Z(z), { w: 1.6, range: 7.5 });
  }
}
