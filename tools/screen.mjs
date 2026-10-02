// Снимок игры из НАСТОЯЩЕГО браузера.
//
// Зачем. Приборы рисуются на Canvas, сцена — в WebGL, и до сих пор
// увидеть кадр можно было только глазами человека за монитором. Отсюда
// вся беда с интерфейсом: правки делались вслепую, «покрупнее» и
// «повыше» проверялись пересказом. ASCII-снимок (tools/shot.mjs)
// перехватывает вызовы Canvas 2D и для WebGL бесполезен, а числа в
// tools/smoke.mjs говорят, ЧТО нарисовано, но не КАК это выглядит.
//
// Здесь всё честно: Chrome запускается без окна, открывает игру по
// http, доигрывает до нужной сцены и отдаёт PNG.
//
// Зависимостей нет и не будет. Chrome управляется своим протоколом
// (DevTools Protocol) поверх WebSocket, который в Node 22 уже встроен, —
// ни puppeteer, ни playwright ради сотни строк тянуть незачем.
//
//   node tools/screen.mjs                            снимок сцены flight
//   node tools/screen.mjs --scene=approach           подлёт к луне
//   node tools/screen.mjs --scene=dock --out=a.png   стыковка
//   node tools/screen.mjs --list                     какие сцены есть
//   node tools/screen.mjs --size=1920x1080 --hud=1.2
//   node tools/screen.mjs --do="GAME.ship.hull = 12" произвольная правка
//
// Снимок ГРУНТА просят с заплатками: node tools/screen.mjs --scene=…
//   --url='http://localhost/space_game/?offline=1&surface=clipmap'
// Плитки считаются на видеокарте, а в headless её нет — за отведённое
// время успевает три штуки, и вместо рельефа в кадре гладкий шар. У
// городских сцен это уже зашито в сцену (scene.url).
//
// Числа по грунту перед снимком: SURFDBG=1 node tools/screen.mjs …
// Показывает поле камней, поле растительности и ячейку сетки — по ним
// «деревьев не видно» разбирается на «не собрано», «не нарисовано» и
// «ушло под грунт».
//
// Игру отдаёт тот же сервер, что и обычно (XAMPP, http://localhost/…).
// Без сервера сцена не соберётся: числа корабля приходят из бэкенда.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name, def = null) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit === undefined ? def : hit.slice(name.length + 3);
};
const flag = (name) => process.argv.includes('--' + name);

// --- где Chrome ---------------------------------------------------------------

// Ищется так же, как PHP (tools/php.mjs): прописать абсолютный путь
// значит сломать команду на второй машине.
const CHROMES = [
  process.env.SOLAR_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const chrome = CHROMES.find((p) => existsSync(p));
if (!chrome) {
  console.error('Chrome не найден. Укажите его явно: SOLAR_CHROME=путь node tools/screen.mjs');
  console.error('искали: ' + CHROMES.join(', '));
  process.exit(1);
}

// Экран станции с ответами сервера. Снимок идёт без сервера (offline=1),
// поэтому прайс и верфь подставляются здесь — такими, какими их отдаёт
// server/src/Market.php и Outfit.php. Проверяется ВЁРСТКА экрана, а не
// экономика: её проверяет серверный набор.
const PORT_SCENE = (tab) => `
  liftoff();
  return GAME.rescue().then(() => Promise.all([
    import('./js/net/session.js'), import('./js/ui/station.js'), import('./js/game/specs.js'),
  ])).then(([Sess, S, Sp]) => {
    Sess.session.mode = 'online';
    // Бак и корпус — после буксира: без сервера порт заправляет и чинит
    // даром, а снимок должен показать, как выглядит неполный бак.
    GAME.ship.fuel = 4.6;
    GAME.ship.hull = 72;
    GAME.player.balance = 41250;
    GAME.player.cargo = [{ code: 'grain', name: 'ЗЕРНО', tons: 6, avgPrice: 52 },
      { code: 'water', name: 'ВОДА', tons: 4, avgPrice: 41 }];
    GAME.port = { tech: 5, fee: 96, repairRate: 15,
      services: { market: true, board: true, repair: true, outfit: true } };
    const goods = [
      ['water', 'ВОДА', 'сырьё', 36, 22], ['ore', 'ЖЕЛЕЗНАЯ РУДА', 'сырьё', 74, 0],
      ['grain', 'ЗЕРНО', 'продовольствие', 51, 96.4], ['hydrogen', 'ВОДОРОД', 'топливо', 74, 18.2],
      ['minerals', 'МИНЕРАЛЫ', 'сырьё', 121, 0], ['biomass', 'БИОМАТЕРИАЛ', 'продовольствие', 102, 77.5],
      ['rare_metals', 'РЕДКИЕ МЕТАЛЛЫ', 'сырьё', 512, 0], ['machines', 'МАШИНЫ', 'техника', 336, 88.1],
      ['helium3', 'ГЕЛИЙ-3', 'топливо', 690, 0], ['electronics', 'ЭЛЕКТРОНИКА', 'техника', 488, 104],
      ['medicine', 'МЕДИКАМЕНТЫ', 'техника', 612, 61.9], ['stims', 'СТИМУЛЯТОРЫ', 'запрещённое', 2010, 0],
    ].map(([code, name, category, price, stock]) => ({
      code, name, category, price, stock, legal: code !== 'stims' }));
    const doc = Sp.specsDoc();
    const bySlot = new Map();
    for (const m of doc.modules) {
      if (!bySlot.has(m.slot)) bySlot.set(m.slot, { slot: m.slot, cap: m.slot === 'computer' ? 2 : 1,
        required: ['engine', 'rcs', 'lift'].includes(m.slot), installed: [], offers: [] });
      const sl = bySlot.get(m.slot);
      if (m.installed) sl.installed.push({ code: m.code, name: m.name, price: m.price,
        resale: Math.floor(m.price * 0.6), spec: m.spec });
    }
    for (const m of doc.modules) {
      if (m.installed) continue;
      const sl = bySlot.get(m.slot);
      const credit = sl.cap === 1 && sl.installed.length ? sl.installed[0].resale : 0;
      sl.offers.push({ code: m.code, name: m.name, price: m.price, tech: m.tech, spec: m.spec,
        sold: m.tech <= 5, credit, net: m.price - credit });
    }
    GAME.station.market = { fuelPrice: 74, goods };
    GAME.station.outfit = { open: true, resale: 0.6, slots: [...bySlot.values()] };
    S.stationAct(GAME, 'tab', { tab: '${tab}' });
  });
`;

// Пилот на ногах в помещении корабля (js/models/interior.js): встать с
// кресла и поставить ноги и взгляд. Подъём не проигрывается — в
// программном рендере каждый кадр с помещениями стоит секунду, а снимок
// нужен не подъёма, а комнаты. tons — сколько груза в трюме.
const WALK_SCENE = (pos, yaw, pitch = 0, tons = 0) => `
  liftoff();
  GAME.player.cargo = ${tons} ? [{ code: 'grain', name: 'ЗЕРНО', tons: ${tons}, avgPrice: 50 }] : [];
  return GAME.loadInterior().then(() => {
    GAME.state.view = 'cockpit';
    frames(1);
    GAME.rise();
    const w = GAME.walk;
    w.phase = 'walk';
    w.pos = [${pos.join(', ')}];
    w.yaw = ${yaw};
    w.pitch = ${pitch};
    frames(4);
  });
`;

// Пилот на ногах на «Прометее» (js/models/interior.prom.js): точка —
// в осях СБОРКИ корпуса (м, как в плане), её переводит сдвиг корпуса.
const PROM_WALK = (pos, yaw, pitch = 0, then = '') => `
  liftoff();
  return Promise.all([import('./js/game/specs.js'), import('./js/game/ship.js')]).then(([S, M]) => {
    S.useShipType('prometheus');
    GAME.syncHull();
    GAME.ship.fuel = M.SHIP.fuelCap;
    GAME.ship.hull = M.SHIP.maxHull;
    aimAt(GAME.world.stations[0], 2.5);
    return GAME.loadInterior();
  }).then(() => {
    GAME.state.view = 'cockpit';
    frames(1);
    GAME.rise();
    const sh = GAME.shipMesh.prom.shift;
    const w = GAME.walk;
    w.phase = 'walk';
    w.pos = [${pos[0]}, ${pos[1]} - sh.y, ${pos[2]} - sh.z];
    w.yaw = ${yaw};
    w.pitch = ${pitch};
    frames(6);
    ${then}
  });
`;

// Шлюз на стоянке у моря (js/game/airlock.js): корабль на сухом ровном
// месте океанического мира, люк hatch открыт и трап выдвинут сразу —
// цикл в программном рендере занял бы минуты. then — что дальше: вид,
// пилот на ногах и где он.
const LOCK_SCENE = (hatch, then, pre = '') => `
  liftoff();
  return Promise.resolve().then(() => { ${pre} }).then(() => standWhere(atmoWorld(),
    (t, F, b, d) => {
      if (window.__surf.groundRadius(b, d) - b.radius < 0.05) return 0;
      const g = F.growth(b, t, d.x, d.y, d.z);
      return g > 0.15 ? 0 : (flat(t, b, d) < 0.02 ? 1 : 0.02);
    }, 0.02, 30, 60, 0))
    .then(() => {
      window.__hold = null;
      GAME.ship.gear.out = true; GAME.ship.gear.t = 1;
      frames(2);
      GAME.landHere();
      frames(2);
      return GAME.loadInterior();
    })
    .then(() => {
      const air = GAME.interior.air;
      const hx = air.hatches.find((x) => x.id === '${hatch}');
      hx.want = true;
      air.locks[hx.lock].p = 1;
      hx.open = 1; hx.stair = 1;
      frames(2);
      ${then}
    });
`;

// Соседи (сокет без сокета, как в сцене pilots): рядом со своим кораблём
// садится чужой — спящий, с открытым люком и трапом, — а по грунту идёт
// человек. Всё кладётся туда, куда это кладёт сокет (window.NET), и
// каждым шагом ожидания заново: иначе снимки «протухают» (PEER_TTL).
const CREW_SCENE = (then) => LOCK_SCENE('sR', `
      const b = GAME.ship.landedAt, P = GAME.ship.landedPose, S = window.SCENE;
      // Точка у грунта рядом со своим кораблём: dr вправо и df вперёд (км,
      // оси тела), h — над нарисованным грунтом.
      const at = (dr, df, h) => {
        const R = P.radius;
        const x = P.dir.x * R + P.right.x * dr + P.fwd.x * df;
        const y = P.dir.y * R + P.right.y * dr + P.fwd.y * df;
        const z = P.dir.z * R + P.right.z * dr + P.fwd.z * df;
        const l = Math.hypot(x, y, z), d = { x: x / l, y: y / l, z: z / l };
        const g = S.drawnGround(b, d) + h;
        return { x: d.x * g, y: d.y * g, z: d.z * g };
      };
      const clear = P.radius - S.drawnGround(b, P.dir);
      const ship2 = at(0.085, -0.012, clear);
      // Человек на грунте ставится ПОСЛЕ того, как встал пилот: перед
      // камерой и лицом к ней (place ниже) — иначе он вне кадра.
      const anna = at(0.032, 0.004, 0);
      const face = { x: -P.right.x, y: -P.right.y, z: -P.right.z };
      window.__annaAt = (cam, dist) => import('./js/game/vessels.js').then((Vs) => {
        const f = cam.basis.fwd, u = Vs.bodyLocal(b, cam.pos);
        const ul = Math.hypot(u.x, u.y, u.z);
        const fl = Vs.bodyLocalDir(b, f);
        const k = (fl.x * u.x + fl.y * u.y + fl.z * u.z) / ul;
        const h = { x: fl.x - u.x / ul * k, y: fl.y - u.y / ul * k, z: fl.z - u.z / ul * k };
        const hl = Math.hypot(h.x, h.y, h.z);
        const p = { x: u.x + h.x / hl * dist, y: u.y + h.y / hl * dist, z: u.z + h.z / hl * dist };
        const pl = Math.hypot(p.x, p.y, p.z), d = { x: p.x / pl, y: p.y / pl, z: p.z / pl };
        const g = S.drawnGround(b, d);
        anna.x = d.x * g; anna.y = d.y * g; anna.z = d.z * g;
        face.x = -h.x / hl; face.y = -h.y / hl; face.z = -h.z / hl;
      });
      const n = window.NET;
      window.__crew = () => {
        n.state = 'live';
        n.you = { id: 1, name: 'ДЖЕЙМСОН', sys: 0 };
        n.peers = [{ id: 501, by: 9, name: 'АННА', dorm: 1, sys: 0, mode: 'landed', g: 1, h: ['sL', 'nL'],
          b: b.id, lx: ship2.x, ly: ship2.y, lz: ship2.z,
          lfx: P.fwd.x, lfy: P.fwd.y, lfz: P.fwd.z, lux: P.up.x, luy: P.up.y, luz: P.up.z }];
        n.people = [
          { id: 9, name: 'АННА', st: 'out', b: b.id, lx: anna.x, ly: anna.y, lz: anna.z,
            lfx: face.x, lfy: face.y, lfz: face.z, yaw: 0, pitch: 0, v: 1.8, air: 0 },
          { id: 12, name: 'ЗАХАР', st: 'walk', s: 501, x: -1.2, y: -9.0, z: 1.6, yaw: 0.4, pitch: 0, v: 0, air: 0 },
        ];
        n.rev++;
      };
      window.__crew();
      const hold0 = window.__hold;
      window.__hold = () => { if (hold0) hold0(); window.__crew(); };
      frames(4);
      ${then}`);

// «Прометей» соседом: тот же подложенный сокет, что в CREW_SCENE, но с
// типом корпуса (поле ty — js/game/peers.js, js/models/hulls.js). Стоит
// он правее своего корабля и чуть впереди, на собственных стойках: центр
// масс над грунтом — по его модели, а не по нашей.
const PROM_SCENE = (then, dr = 0.125, df = 0.05, side = false) => LOCK_SCENE('sR', `
      const b = GAME.ship.landedAt, P = GAME.ship.landedPose, S = window.SCENE;
      // Нос соседа — вперёд, как у своего, или вправо (side): тогда к
      // камере он стоит бортом целиком.
      const F = ${side} ? P.right : P.fwd;
      const at = (dr, df, h) => {
        const R = P.radius;
        const x = P.dir.x * R + P.right.x * dr + P.fwd.x * df;
        const y = P.dir.y * R + P.right.y * dr + P.fwd.y * df;
        const z = P.dir.z * R + P.right.z * dr + P.fwd.z * df;
        const l = Math.hypot(x, y, z), d = { x: x / l, y: y / l, z: z / l };
        const g = S.drawnGround(b, d) + h;
        return { x: d.x * g, y: d.y * g, z: d.z * g };
      };
      return import('./js/models/hulls.js').then((Hm) => {
        const prom = Hm.hullOf('prometheus').mesh;
        const ship2 = at(${dr}, ${df}, -prom.prom.ground / 1000);
        const n = window.NET;
        window.__crew = () => {
          n.state = 'live';
          n.you = { id: 1, name: 'ДЖЕЙМСОН', sys: 0 };
          n.peers = [{ id: 502, by: 9, name: 'АННА', dorm: 1, sys: 0, mode: 'landed', g: 1, h: [], ty: 'prometheus',
            b: b.id, lx: ship2.x, ly: ship2.y, lz: ship2.z,
            lfx: F.x, lfy: F.y, lfz: F.z, lux: P.up.x, luy: P.up.y, luz: P.up.z }];
          n.people = [];
          n.rev++;
        };
        window.__crew();
        const hold0 = window.__hold;
        window.__hold = () => { if (hold0) hold0(); window.__crew(); };
        frames(4);
        ${then}
      });`);

// --- сцены --------------------------------------------------------------------
//
// Сцена — это кусок кода, который выполняется В СТРАНИЦЕ после загрузки.
// Игра выставляет наружу window.GAME, и этого достаточно: положение,
// цель, режим и вид ставятся прямо в объекте, как их ставит сама игра.
//
// Кадры после правки нужны обязательно: почти всё в игре считается за
// кадр, и снимок сразу после присваивания показал бы прошлое состояние.

const SCENES = {
  boot: {
    title: 'стартовый экран',
    run: '',
  },
  flight: {
    title: 'обычный полёт у станции',
    run: `
      liftoff();
      const st = GAME.world.stations[0];
      aimAt(st, 14);
      GAME.state.view = 'chase';
    `,
  },
  station: {
    title: 'станция «Кориолис» крупным планом',
    run: `
      liftoff();
      showStation(pickStation('coriolis'), 3.2);
      GAME.state.view = 'chase';
    `,
  },
  orbis: {
    title: 'станция «Орбис» крупным планом',
    run: `
      liftoff();
      showStation(pickStation('orbis'), 4.2);
      GAME.state.view = 'chase';
    `,
  },
  port: {
    title: 'створ порта в упор',
    run: `
      liftoff();
      showStation(pickStation('coriolis'), 2.4, 0.05, 0);
      GAME.state.view = 'chase';
    `,
  },
  orbisport: {
    title: 'створ «Орбиса» в упор',
    run: `
      liftoff();
      showStation(pickStation('orbis'), 3.0, 0.05, 0);
      GAME.state.view = 'chase';
    `,
  },
  approach: {
    title: 'подлёт к луне: приборы подхода',
    run: `
      liftoff();
      const moon = GAME.world.bodies.find((b) => b.kind === 'moon');
      aimAt(moon, 40);
      GAME.state.view = 'chase';
    `,
  },
  dock: {
    title: 'створ порта: помощник стыковки',
    run: `
      liftoff();
      const st = GAME.world.stations[0];
      aimAt(st, 1.2);
      GAME.state.view = 'chase';
    `,
  },
  lights: {
    title: 'фары на ночной стороне луны',
    run: `
      liftoff();
      const moon = GAME.world.bodies.find((b) => b.kind === 'moon');
      GAME.ship.gear.out = true; GAME.ship.gear.t = 1;
      hover(moon, 1.4, 'night');
      // Нос вниз: горизонтальный луч уходил бы в горизонт по касательной,
      // и на грунте от него не оставалось бы ничего. Снижаются носом
      // вниз, и смотреть фары должны туда же.
      const b = GAME.ship.basis;
      const u = { x: b.up.x, y: b.up.y, z: b.up.z };
      const d = {
        x: b.fwd.x * 0.87 - u.x * 0.5,
        y: b.fwd.y * 0.87 - u.y * 0.5,
        z: b.fwd.z * 0.87 - u.z * 0.5 };
      const dl = Math.hypot(d.x, d.y, d.z);
      window.__lookAlong(b, { x: d.x / dl, y: d.y / dl, z: d.z / dl }, u);
      GAME.ship.lights = true;
      GAME.state.view = 'chase';
      frames(20);
    `,
  },
  // Город снимается ИЗ КАБИНЫ, а не от третьего лица: свой корабль в
  // таком виде занимает низ кадра и закрывает ровно то, ради чего снимок.
  city: {
    url: '&surface=clipmap',
    title: 'наземный город: вид с воздуха',
    run: `
      liftoff();
      // Отход считается от РАЗМЕРА ГОРОДА, а не в километрах: города
      // бывают и по четыре километра, и по семьдесят, и постоянные
      // «три километра назад» для одного вид с окраины, для другого —
      // вид на одну улицу.
      const R = GAME.world.cities[0].radius;
      showCity(R * 0.5, R * 0.95);
      GAME.state.view = 'cockpit';
    `,
  },
  citypad: {
    url: '&surface=clipmap',
    title: 'посадочная площадка города в упор',
    run: `
      liftoff();
      GAME.ship.gear.out = true; GAME.ship.gear.t = 1;
      showCityPad(0.32, 0.55);
      GAME.state.view = 'cockpit';
    `,
  },
  cityair: {
    url: '&surface=clipmap',
    title: 'город сверху: расчищенная площадка в рельефе',
    run: `
      liftoff();
      const R = GAME.world.cities[0].radius;
      showCity(R * 1.8, R * 0.15);
      GAME.state.view = 'cockpit';
      // Отладочный слой: с такой высоты город — горсть точек, и
      // «его не видно» имеет две разные причины (не собран или не
      // нарисован). Различить их иначе нечем.
    `,
  },
  citynight: {
    url: '&surface=clipmap',
    title: 'город ночью: окна и огни порта',
    run: `
      liftoff();
      const R = GAME.world.cities[0].radius;
      showCity(R * 0.35, R * 0.6, 'night');
      GAME.ship.lights = true;
      GAME.state.view = 'cockpit';
    `,
  },
  // Фары в городе. Тени от них считаются НА ПИКСЕЛЬ (js/gl/citymesh.js),
  // в мешe их нет вовсе, и увидеть их можно только так: ночью, у самых
  // домов, от третьего лица — чтобы в кадр попал и сам луч, и то, что
  // он не достаёт за постройками.
  citylamp: {
    url: '&surface=clipmap',
    title: 'фары в городе ночью: тени от луча',
    run: `
      liftoff();
      showCity(0.35, 0.6, 'night');
      GAME.ship.lights = true;
      GAME.state.view = 'chase';
    `,
  },
  // Список пилотов в сети (клавиша P).
  //
  // Сокета в снимке нет и быть не может, поэтому состав сети
  // подставляется в window.NET — тот самый объект, из которого игра
  // каждый кадр считает состояние связи. Значит, и строка вверху, и
  // панель считаются тем же кодом, что и в игре, а не рисуются мимо неё.
  pilots: {
    title: 'список пилотов в сети',
    run: `
      liftoff();
      aimAt(GAME.world.stations[0], 14);
      GAME.state.view = 'chase';
      const n = window.NET;
      const fake = () => {
        n.state = 'live';
        n.ping = 34;
        n.tick = 0.2;
        n.you = { id: 1, name: 'ДЖЕЙМСОН', sys: 0 };
        n.roster = [
          { id: 1, name: 'ДЖЕЙМСОН', sys: 0 },
          { id: 4, name: 'АННА', sys: 0 },
          { id: 7, name: 'ЗАХАР', sys: 3 },
          { id: 9, name: 'ГОСТЬ', sys: null },
        ];
        // Приходы снимков — по часам ИГРЫ (GAME.now), иначе они
        // считаются просроченными и связь выходит «в потерях».
        const t = GAME.now || performance.now() / 1000;
        n.beats.length = 0;
        for (let i = 10; i > 0; i--) n.beats.push(t - i * 0.2);
        GAME.showPilots = true;
      };
      fake();
      window.__hold = fake;
      frames(4);
    `,
  },
  // Страница входа — НЕ игра: window.GAME на ней не появится никогда,
  // и ждать его значит не снять её вовсе. Отсюда plain: страница
  // снимается как страница, без игровой обвязки и без кадров.
  login: {
    plain: 'login.html?offline=1',
    title: 'страница входа',
    run: '',
  },
  signup: {
    plain: 'login.html?offline=1',
    title: 'страница входа: регистрация',
    run: "document.getElementById('swap').click();",
  },
  // Горы и лес живут на атмосферном мире (пока это Lave II) и занимают
  // малую долю шара, поэтому обе сцены СНАЧАЛА ИЩУТ место: гору повыше
  // или лес погуще. Заплатки (surface=clipmap) — потому что плитки
  // считает видеокарта, а в headless её нет.
  mountains: {
    url: '&surface=clipmap',
    title: 'горный хребет атмосферного мира',
    run: `
      liftoff();
      // Снимок С РАВНИНЫ, за сорок километров от вершины, а не с самой
      // вершины. Горный массив у этого мира в полтораста километров
      // поперёк, и с его макушки видно только пологий купол под
      // ногами: первый снимок вышел ровным полем, хотя камера стояла на
      // десятикилометровой горе. Размер горы виден со стороны — как и
      // в жизни.
      return standWhere(atmoWorld(),
        (t, F, b, d) => t.mountainAt(d.x, d.y, d.z), 1.0, 26, 0, 1, 40)
        .then(() => { GAME.state.view = 'cockpit'; frames(8); });
    `,
  },
  forest: {
    url: '&surface=clipmap',
    title: 'лес на грунте: деревья, кусты, трава',
    run: `
      liftoff();
      // Лес ищем НА РОВНОМ МЕСТЕ, и уклон меряется честно — разностью
      // высот по касательной. Не придирка к виду: у самой земли корабль
      // доворачивается по склону, и снимок леса на косогоре выходит с
      // горизонтом наискось и половиной кадра в земле. Так и вышло на
      // первых трёх попытках этой сцены.
      return standWhere(atmoWorld(),
        (t, F, b, d) => {
          const g = F.growth(b, t, d.x, d.y, d.z);
          // Уклон меряется только у густых мест: выборка рельефа — самая
          // дорогая функция в игре, а кандидатов двадцать четыре тысячи.
          return g < 0.6 ? g * 0.01 : g * (flat(t, b, d) < 0.02 ? 1 : 0.05);
        },
        // Сто метров, а не тридцать, и это не вкус. Заплатки под
        // кораблём рисуют грунт с точностью до своей ячейки (десятки
        // метров), а высота корабля считается по ПОЛНОЙ высоте рельефа:
        // с тридцати метров камера оказывается под нарисованной землёй,
        // и кадр выходит чёрным. Так и вышло на четвёртой попытке.
        0.1, 30, 110, 22)
        .then(() => {
          GAME.ship.gear.out = true; GAME.ship.gear.t = 1;
          // Из кабины, а не от третьего лица: свой корабль с этой высоты
          // занимает низ кадра и закрывает ровно то, ради чего снимок.
          GAME.state.view = 'cockpit';
          frames(12);
        });
    `,
  },
  giant: {
    url: '&surface=clipmap',
    title: 'корабль висит над лесом в полусотне метров: вид от третьего лица',
    run: `
      liftoff();
      // Тот самый кадр, с которого началась работа над масштабом:
      // корабль в пятидесяти метрах над редколесьем, вид из-за спины.
      // Солнце за камерой (отворот на 150°): тень корабля ложится
      // вперёд, под ним, и её видно из-под брюха.
      //
      // Камера ставится под корпус сразу, а не ждёт полторы секунды
      // своего перелёта (js/game/chase.js, swing): в программном
      // рендере это полторы сотни кадров и шесть минут. Сам перелёт
      // проверяется в tools/test.mjs, здесь нужен только кадр.
      return standWhere(atmoWorld(),
        (t, F, b, d) => {
          const g = F.growth(b, t, d.x, d.y, d.z);
          return g < 0.6 ? g * 0.01 : g * (flat(t, b, d) < 0.02 ? 1 : 0.05);
        },
        0.051, 32, 150, 0)
        .then(() => {
          GAME.state.view = 'chase';
          // Камера садится на место сразу: корабль сюда телепортирован,
          // и тяжёлая камера догоняла бы его крен ещё секунду — горизонт
          // на снимке вышел бы заваленным (так и вышло в первый раз).
          GAME.chase.ready = false;
          GAME.chase.below = true; GAME.chase.low = 1;
          frames(24);
        });
    `,
  },
  giantdusk: {
    url: '&surface=clipmap',
    title: 'тот же корабль ночью и сбоку: окна, мостик, огни',
    run: `
      liftoff();
      // Пара к сцене giant. Окна — на бортах, и из-за спины их не видно
      // вовсе: смотреть надо сбоку, как при осмотре правой кнопкой. А
      // светятся они по-настоящему только в сумерках: днём окно темнее
      // обшивки под солнцем (js/models/hulldetail.js, winGlow).
      return standWhere(atmoWorld(),
        (t, F, b, d) => {
          const g = F.growth(b, t, d.x, d.y, d.z);
          return g < 0.6 ? g * 0.01 : g * (flat(t, b, d) < 0.02 ? 1 : 0.05);
        },
        // Солнце глубоко под горизонтом. Место подбирается с допуском в
        // девять градусов, и «минус четыре» дважды подряд дали солнце
        // чуть НАД горизонтом: земля уже в тени, а вертикальный борт
        // залит низким светом целиком — так на закате горят стены домов.
        // Окна на таком борту честно темнее обшивки, и их свечения не
        // видно вовсе. Ночь его показывает.
        0.051, -20, 150, 0)
        .then(() => {
          GAME.state.view = 'chase';
          GAME.chase.ready = false;
          GAME.chase.below = true; GAME.chase.low = 1;
          // Осмотр сам возвращается за спину, стоит отпустить кнопку, —
          // поэтому держится на каждом шаге ожидания.
          const hold = window.__hold;
          window.__hold = () => { hold(); GAME.camOrbit.yaw = 1.05; GAME.camOrbit.pitch = 0.12; };
          window.__hold();
          frames(24);
        });
    `,
  },
  gear: {
    url: '&surface=clipmap',
    title: 'шасси на стоянке: стойки-телескопы и пяты сбоку, от земли',
    run: `
      liftoff();
      // Ровное голое место (как у стоянки со шлюзом): трава закрыла бы пяты.
      return standWhere(atmoWorld(),
        (t, F, b, d) => {
          if (window.__surf.groundRadius(b, d) - b.radius < 0.05) return 0;
          const g = F.growth(b, t, d.x, d.y, d.z);
          return g > 0.15 ? 0 : (flat(t, b, d) < 0.02 ? 1 : 0.02);
        }, 0.02, 30, 60, 0)
        .then(() => {
          window.__hold = null;
          GAME.ship.gear.out = true; GAME.ship.gear.t = 1;
          frames(2);
          GAME.landHere();
          GAME.state.view = 'chase';
          GAME.chase.ready = false;
          GAME.chase.below = true; GAME.chase.low = 1;
          // Осмотр — сбоку и чуть сверху: видно все три стойки.
          window.__hold = () => { GAME.camOrbit.yaw = 1.15; GAME.camOrbit.pitch = 0.06; };
          window.__hold();
          frames(24);
        });
    `,
  },
  ground: {
    url: '&surface=clipmap',
    title: 'грунт с восьмидесяти метров: зерно и цвет земли',
    run: `
      liftoff();
      // Место ГОЛОЕ и РОВНОЕ: трава закрыла бы ровно то, ради чего
      // снимок, а уклон увёл бы половину кадра в горизонт.
      //
      // Восемьдесят метров, а не двадцать: заплатки рисуют грунт с
      // точностью до своей ячейки (двадцать метров), а высота корабля
      // считается по полной высоте рельефа — с двадцати метров камера
      // оказывается под нарисованной землёй (та же беда, что у сцены
      // forest).
      return standWhere(atmoWorld(),
        (t, F, b, d) => {
          // Суша, а не море. Самое ровное и голое место океанического
          // мира — это ДНО, и первый снимок вышел именно таким: ровная
          // синь с камнями до горизонта.
          if (window.__surf.groundRadius(b, d) - b.radius < 0.02) return 0;
          const g = F.growth(b, t, d.x, d.y, d.z);
          return g > 0.2 ? 0 : (flat(t, b, d) < 0.03 ? 1 : 0.05);
        },
        0.08, 20, 25, 40)
        .then(() => { GAME.state.view = 'cockpit'; frames(12); });
    `,
  },
  woods: {
    url: '&surface=clipmap',
    title: 'лес с шести километров: пятна леса до горизонта',
    run: `
      liftoff();
      // Смотреть надо ОТТУДА, откуда деревьев уже нет: их рисуют в
      // паре километров вокруг корабля, а лес виден с сотен — он
      // живёт в цвете грунта (js/gl/terrain.js, FOREST). Снимок ровно
      // про это: с шести километров в кадре не деревья, а лес.
      return standWhere(atmoWorld(),
        (t, F, b, d) => t.floraAt(d.x, d.y, d.z),
        6, 28, 20, 9)
        .then(() => { GAME.state.view = 'cockpit'; frames(10); });
    `,
  },
  gravel: {
    url: '&surface=clipmap',
    title: 'грунт с двадцати пяти метров: то самое зерно',
    run: `
      liftoff();
      // Пара к сцене ground, и не ради красоты: зерно фотографии — это
      // крошка мельче двадцати сантиметров, и с восьмидесяти метров её
      // не видно ВОВСЕ (так и задумано, иначе плитка в три метра
      // читается решёткой). Значит смотреть на неё надо оттуда, откуда
      // она работает, — иначе проверить нечего.
      //
      // Двадцать пять метров — предел: ниже камера уходит под
      // нарисованную землю, потому что заплатка рисует её с точностью
      // до своей ячейки в двадцать метров. Место поэтому берётся самое
      // ровное, какое нашлось.
      return standWhere(atmoWorld(),
        (t, F, b, d) => {
          if (window.__surf.groundRadius(b, d) - b.radius < 0.02) return 0;
          const g = F.growth(b, t, d.x, d.y, d.z);
          return g > 0.2 ? 0 : (flat(t, b, d) < 0.01 ? 1 : 0.02);
        },
        0.025, 20, 25, 55)
        .then(() => { GAME.state.view = 'cockpit'; frames(12); });
    `,
  },
  surface: {
    title: 'у самого грунта: отметка земли и посадочные условия',
    run: `
      liftoff();
      const moon = GAME.world.bodies.find((b) => b.kind === 'moon');
      GAME.ship.gear.out = true; GAME.ship.gear.t = 1;
      hover(moon, 0.35);
      GAME.state.view = 'chase';
    `,
  },
  warp: {
    title: 'выбрана система на карте галактики: метка цели варпа',
    run: `
      liftoff();
      const st = GAME.world.stations[0];
      aimAt(st, 40);
      GAME.state.view = 'chase';
      press('KeyM'); press('KeyG'); press('ArrowRight'); press('KeyM');
    `,
  },
  cockpit: {
    title: 'вид из кабины',
    run: `
      liftoff();
      const st = GAME.world.stations[0];
      aimAt(st, 14);
      GAME.state.view = 'cockpit';
    `,
  },
  // Кабина с поворотом головы: осмотр сам возвращается прямо, стоит
  // отпустить кнопку, поэтому поворот держится на каждом шаге ожидания.
  cockpitleft: {
    title: 'кабина: взгляд влево и вниз — пульт, РУД, боковое окно',
    run: `
      liftoff();
      aimAt(GAME.world.stations[0], 14);
      GAME.state.view = 'cockpit';
      const hold = window.__hold;
      window.__hold = () => { if (hold) hold(); GAME.camOrbit.yaw = -1.05; GAME.camOrbit.pitch = 0.5; };
      for (let i = 0; i < 10; i++) { window.__hold(); frames(1); }
    `,
  },
  cockpitright: {
    title: 'кабина: взгляд вправо и вниз — ручка управления, пульт',
    run: `
      liftoff();
      aimAt(GAME.world.stations[0], 14);
      GAME.state.view = 'cockpit';
      GAME.ship.control.roll = 1; GAME.yoke.roll = 0.3;
      const hold = window.__hold;
      window.__hold = () => { if (hold) hold(); GAME.camOrbit.yaw = 0.75; GAME.camOrbit.pitch = -0.6; };
      for (let i = 0; i < 10; i++) { window.__hold(); frames(1); }
    `,
  },
  cockpitup: {
    title: 'кабина: взгляд вверх — стекло над головой и пульт',
    run: `
      liftoff();
      aimAt(GAME.world.stations[0], 14);
      GAME.state.view = 'cockpit';
      const hold = window.__hold;
      window.__hold = () => { if (hold) hold(); GAME.camOrbit.yaw = 0.3; GAME.camOrbit.pitch = -0.92; };
      for (let i = 0; i < 10; i++) { window.__hold(); frames(1); }
    `,
  },
  cockpitday: {
    url: '&surface=clipmap',
    title: 'кабина днём у земли: солнце сквозь переплёт',
    run: `
      liftoff();
      return standWhere(atmoWorld(),
        (t, F, b, d) => {
          const g = F.growth(b, t, d.x, d.y, d.z);
          return g < 0.6 ? g * 0.01 : g * (flat(t, b, d) < 0.02 ? 1 : 0.05);
        },
        0.051, 38, 25, 0)
        .then(() => { GAME.state.view = 'cockpit'; frames(12); });
    `,
  },
  cockpitsun: {
    url: '&surface=clipmap',
    title: 'кабина: солнце сзади сверху — тени переплёта на доске',
    run: `
      liftoff();
      return standWhere(atmoWorld(),
        (t, F, b, d) => {
          const g = F.growth(b, t, d.x, d.y, d.z);
          return g < 0.6 ? g * 0.01 : g * (flat(t, b, d) < 0.02 ? 1 : 0.05);
        },
        0.051, 62, 160, 0)
        .then(() => { GAME.state.view = 'cockpit'; frames(12); });
    `,
  },
  cockpitnight: {
    url: '&surface=clipmap',
    title: 'кабина ночью: лампы, подсветка доски и свет экранов',
    run: `
      liftoff();
      return standWhere(atmoWorld(),
        (t, F, b, d) => {
          const g = F.growth(b, t, d.x, d.y, d.z);
          return g < 0.6 ? g * 0.01 : g * (flat(t, b, d) < 0.02 ? 1 : 0.05);
        },
        0.051, -20, 150, 0)
        .then(() => { GAME.state.view = 'cockpit'; frames(12); });
    `,
  },
  map: {
    title: 'карта системы',
    run: 'liftoff(); press("KeyM");',
  },
  portmarket: {
    title: 'экран станции: рынок',
    run: PORT_SCENE('market'),
  },
  portoutfit: {
    title: 'экран станции: верфь',
    run: PORT_SCENE('outfit'),
  },
  portfuel: {
    title: 'экран станции: заправка и ремонт',
    run: PORT_SCENE('fuel'),
  },
  fuel: {
    title: 'полёт на резерве: шкала топлива и подсказка про буксир',
    run: `
      liftoff();
      const st = GAME.world.stations[0];
      aimAt(st, 14);
      GAME.ship.fuel = 1.1;
      GAME.state.view = 'chase';
      frames(6);
    `,
  },
  walkbridge: {
    title: 'на ногах в рубке: переборка с дверью, переплёт фонаря',
    run: WALK_SCENE([0, 0.2, -10.0], 'Math.PI', -0.08),
  },
  walkstair: {
    title: 'верх трапа: вниз, в кают-компанию',
    run: WALK_SCENE([0, 0.2, -15.3], 'Math.PI', -0.55),
  },
  walkhall: {
    title: 'кают-компания: камбуз, стол, трап сверху',
    run: WALK_SCENE([-0.4, -4.94, -23.7], 0.15, 0.05),
  },
  walkcorridor: {
    title: 'коридор средней палубы: двери кают',
    run: WALK_SCENE([0, -4.94, -14.7], 0, -0.05),
  },
  walkhold: {
    title: 'грузовой трюм: 14 т груза — 14 ящиков',
    run: WALK_SCENE([0, -9.0, 2.8], 0.12, -0.05, 14),
  },
  walkengine: {
    title: 'машинное отделение: реакторы',
    run: WALK_SCENE([-0.2, -4.94, -25.4], 'Math.PI + 0.5', 0),
  },
  // Рама двери стоит на стене одной комнаты (a), а с другой стороны (b) в
  // стене только проём. Комната за закрытой дверью не рисуется — и раму
  // с её стороны тоже надо рисовать отдельно, иначе дверь «просвечивает».
  walkdoor: {
    title: 'машинное: закрытая дверь в кают-компанию — с той стороны, где нет рамы',
    run: WALK_SCENE([0, -4.94, -27.7], 0, 0.04),
  },
  // Окно (js/models/interior.js, WINDOWS): корабль повёрнут левым бортом
  // к станции — за окном кают-компании должен быть её створ, а не космос.
  walkwindow: {
    title: 'окно кают-компании: корабль бортом к станции',
    run: WALK_SCENE([-2.4, -4.94, -16.2], '-Math.PI / 2', 0).replace('frames(4);', `
    const S = GAME.world.stations[0], sh = GAME.ship, b = sh.basis;
    const cr = (a, c) => ({ x: a.y * c.z - a.z * c.y, y: a.z * c.x - a.x * c.z, z: a.x * c.y - a.y * c.x });
    const dot = (a, c) => a.x * c.x + a.y * c.y + a.z * c.z;
    const sgn = Math.sign(dot(cr(b.right, b.up), b.fwd));
    let d = { x: S.pos.x - sh.pos.x, y: S.pos.y - sh.pos.y, z: S.pos.z - sh.pos.z };
    let L = Math.hypot(d.x, d.y, d.z);
    const right = { x: -d.x / L, y: -d.y / L, z: -d.z / L };
    const k = dot(b.up, right);
    let up = { x: b.up.x - right.x * k, y: b.up.y - right.y * k, z: b.up.z - right.z * k };
    L = Math.hypot(up.x, up.y, up.z);
    up = { x: up.x / L, y: up.y / L, z: up.z / L };
    const f = cr(right, up);
    Object.assign(b.right, right); Object.assign(b.up, up);
    Object.assign(b.fwd, { x: f.x * sgn, y: f.y * sgn, z: f.z * sgn });
    frames(4);`),
  },
  lockopen: {
    url: '&surface=clipmap',
    title: 'стоянка у моря: носовой люк открыт, трап на грунте',
    run: LOCK_SCENE('nR', `
      GAME.state.view = 'chase';
      window.__hold = () => { GAME.camOrbit.yaw = -1.75; GAME.camOrbit.pitch = 0.08; };
      window.__hold();
      frames(6);`),
  },
  promlockopen: {
    url: '&surface=clipmap',
    title: '«Прометей» на стоянке: бортовой шлюз носа открыт, трап в 52 ступени на грунте',
    run: LOCK_SCENE('bowL', `
      GAME.state.view = 'chase';
      window.__hold = () => { GAME.camOrbit.yaw = 1.2; GAME.camOrbit.pitch = 0.05; };
      window.__hold();
      frames(6);`, `return import('./js/game/specs.js').then((S) => { S.useShipType('prometheus'); GAME.syncHull(); });`),
  },
  promlockdoor: {
    url: '&surface=clipmap',
    title: 'из бортового шлюза «Прометея» наружу: тоннель, проём, трап',
    run: LOCK_SCENE('bowL', `
      GAME.state.view = 'cockpit';
      frames(1);
      GAME.rise();
      const w = GAME.walk, I = GAME.interior, r = I.roomById.airBL;
      w.phase = 'walk';
      w.pos = [r.hi[0] - 1.0, r.lo[1], (r.lo[2] + r.hi[2]) / 2];
      w.yaw = -Math.PI / 2;
      w.pitch = -0.15;
      frames(6);`, `return import('./js/game/specs.js').then((S) => { S.useShipType('prometheus'); GAME.syncHull(); });`),
  },
  lockdoor: {
    url: '&surface=clipmap',
    title: 'из носового шлюза наружу: проём, трап, грунт',
    run: LOCK_SCENE('nR', `
      GAME.state.view = 'cockpit';
      frames(1);
      GAME.rise();
      const w = GAME.walk;
      w.phase = 'walk';
      w.pos = [2.4, -9.0, 15.3];
      w.yaw = Math.PI / 2 - 0.15;
      w.pitch = -0.22;
      frames(4);`),
  },
  walkout: {
    url: '&surface=clipmap',
    title: 'пилот на грунте: корабль, трап и бортовой люк',
    run: LOCK_SCENE('sR', `
      GAME.state.view = 'cockpit';
      frames(1);
      GAME.rise();
      const w = GAME.walk;
      w.phase = 'walk';
      // На порог — шаг за обшивку переводит в оси грунта.
      w.pos = [14.7, -7.97, -12.67];
      w.yaw = Math.PI / 2;
      frames(3);
      if (w.out) { w.pos = [14, w.pos[1] - 5.0, -9]; w.vel = [0, -5, 0]; w.yaw = -0.92; w.pitch = 0.2; }
      frames(12);`),
  },
  promchase: {
    title: 'свой «Прометей» у станции: вид из-за спины (камера отходит по длине корабля)',
    run: `
      liftoff();
      return Promise.all([import('./js/game/specs.js'), import('./js/game/ship.js')]).then(([S, M]) => {
        // Без сервера пересадки нет: корпус ставится так, как его ставит
        // ответ сервера (serverToSave → useShipType, syncHull), а бак и
        // корпус — по его числам.
        S.useShipType('prometheus');
        GAME.syncHull();
        GAME.ship.fuel = M.SHIP.fuelCap;
        GAME.ship.hull = M.SHIP.maxHull;
        aimAt(GAME.world.stations[0], 2.5);
        GAME.state.view = 'chase';
        GAME.chase.ready = false;
        frames(12);
      });
    `,
  },
  prombridge: {
    title: 'мостик «Прометея»: из кресла командира — три окна, палуба до носа, станция впереди',
    run: `
      liftoff();
      return Promise.all([import('./js/game/specs.js'), import('./js/game/ship.js')]).then(([S, M]) => {
        // Без сервера пересадки нет: корпус ставится так, как его ставит
        // ответ сервера (serverToSave → useShipType, syncHull), а бак и
        // корпус — по его числам.
        S.useShipType('prometheus');
        GAME.syncHull();
        GAME.ship.fuel = M.SHIP.fuelCap;
        GAME.ship.hull = M.SHIP.maxHull;
        aimAt(GAME.world.stations[0], 2.5);
        GAME.state.view = 'cockpit';
        // Помещения мостика: пульты, кресла, рамы окон.
        return GAME.loadInterior().then(() => frames(12));
      });
    `,
  },
  promwalkbridge: {
    title: 'мостик «Прометея» на ногах: за креслом командира, лицом к окнам',
    run: PROM_WALK([1.6, 46, 61.0], -0.08, -0.06),
  },
  promwalkback: {
    title: 'мостик «Прометея»: от окон назад — планшет-карта, экраны, дверь в лифтовой холл',
    run: PROM_WALK([2.5, 46, 69.0], 'Math.PI + 0.15', -0.12),
  },
  promwalkcabin: {
    title: 'каюта палубы 8: иллюминатор там же, где его рисует корпус',
    run: PROM_WALK([-5.0, 18, 85.0], '-Math.PI / 2 + 0.3', -0.02),
  },
  promwalkmess: {
    title: 'кают-компания жилой палубы: окна в корму',
    run: PROM_WALK([0.0, 22, 18.5], 'Math.PI', 0.0),
  },
  promwalkhangar: {
    title: 'носовой ангар: две палубы в высоту, двери бортовых шлюзов',
    run: PROM_WALK([0.0, -3, 156.0], 0.35, 0.05),
  },
  promplan: {
    title: 'план палубы 8 (M): пилот в каюте, путь к креслу командира проложен',
    run: PROM_WALK([-5.0, 18, 85.0], '-Math.PI / 2 + 0.3', -0.02, `
      return import('./js/ui/deckmap.js').then((D) => {
        GAME.setWalkGoal('bridge');
        D.openDeckMap(GAME.deckMap, GAME.interior, GAME.walk.room, GAME.walkGoal);
        frames(3);
      });`),
  },
  promroute: {
    title: 'путь к креслу командира: метка следующей двери в коридоре палубы 8',
    run: PROM_WALK([0.0, 18, 100.0], 'Math.PI', -0.02, `
      GAME.setWalkGoal('bridge');
      frames(3);`),
  },
  promwalkreactor: {
    title: 'реакторный зал палубы 10',
    run: PROM_WALK([-4.0, 10, 47.0], '-Math.PI * 0.75', -0.05),
  },
  prometheus: {
    url: '&surface=clipmap',
    title: '«Прометей» на стоянке впереди, бортом: вид из кабины «Челленджера»',
    run: PROM_SCENE(`
      // Вид из-за спины тут не годится: камера целится в свой корабль, и
      // он закрывает соседа. Из кабины сосед — за стеклом, в трёхстах
      // шестидесяти метрах, во весь борт.
      GAME.state.view = 'cockpit';
      frames(24);`, 0.0, 0.36, true),
  },
  prometheusfoot: {
    url: '&surface=clipmap',
    title: '«Прометей» с роста человека: нос и носовая стойка в шестидесяти метрах',
    run: PROM_SCENE(`
      GAME.state.view = 'cockpit';
      frames(1);
      GAME.rise();
      const w = GAME.walk;
      w.phase = 'walk';
      w.pos = [14.7, -7.97, -12.67];
      w.yaw = Math.PI / 2;
      frames(3);
      // С порога правого люка — на грунт, наискось к носу соседа: до его
      // носовой стойки шестьдесят метров (оси грунта — от порога).
      if (w.out) { w.pos = [65.3, w.pos[1] - 5.0, 201.3]; w.vel = [0, -5, 0]; w.yaw = 2.36; w.pitch = 0.12; }
      frames(12);`),
  },
  gearclose: {
    url: '&surface=clipmap',
    title: 'главная стойка вблизи, с роста человека: телескоп, подкос, пята',
    run: LOCK_SCENE('sR', `
      GAME.state.view = 'cockpit';
      frames(1);
      GAME.rise();
      const w = GAME.walk;
      w.phase = 'walk';
      w.pos = [14.7, -7.97, -12.67];
      w.yaw = Math.PI / 2;
      frames(3);
      // Правая главная стойка — почти под бортовым люком (оси грунта от
      // порога): встаём в шести метрах сбоку и сзади и смотрим на неё.
      if (w.out) { w.pos = [5.5, w.pos[1] - 5.0, 4.0]; w.vel = [0, -5, 0]; w.yaw = -2.33; w.pitch = 0.16; }
      frames(12);`),
  },
  crew: {
    url: '&surface=clipmap',
    title: 'соседи: чужой корабль рядом с открытым люком, человек на грунте',
    run: CREW_SCENE(`
      GAME.state.view = 'cockpit';
      frames(1);
      GAME.rise();
      const w = GAME.walk;
      w.phase = 'walk';
      w.pos = [14.7, -7.97, -12.67];
      w.yaw = Math.PI / 2;
      frames(3);
      if (w.out) { w.pos = [12, w.pos[1] - 5.0, 4]; w.vel = [0, -5, 0]; w.yaw = 1.42; w.pitch = 0.06; }
      frames(12);
      return window.__annaAt(GAME.camera, 0.009).then(() => { window.__crew(); frames(6); });`),
  },
  crewin: {
    url: '&surface=clipmap',
    title: 'на палубе чужого корабля: трюм, пассажир',
    run: CREW_SCENE(`
      GAME.state.view = 'cockpit';
      frames(1);
      GAME.rise();
      // Снимок соседа принимается кадром позже, чем положен в NET.
      for (let i = 0; i < 20 && !GAME.peers.some((p) => p.id === 501 && p.air); i++) { window.__crew(); frames(1); }
      const w = GAME.walk;
      const V = GAME.peers.find((p) => p.id === 501);
      w.phase = 'walk';
      w.vessel = V;
      w.air = V.air;
      w.out = null;
      w.pos = [0.6, -9.0, 7.0];
      w.yaw = Math.PI + 0.15;
      w.pitch = -0.08;
      frames(6);`),
  },
  cockpitfuel: {
    title: 'кабина на малом топливе: столбик ТОПЛ и лампа',
    run: `
      liftoff();
      const st = GAME.world.stations[0];
      aimAt(st, 14);
      GAME.ship.fuel = 2.4;
      GAME.state.view = 'cockpit';
      frames(30);
    `,
  },
  menu: {
    title: 'меню пилота',
    run: 'liftoff(); press("KeyI");',
  },
  help: {
    title: 'страница управления (клавиша H)',
    run: 'liftoff(); press("KeyH");',
  },
};

if (flag('list')) {
  console.log('сцены:');
  for (const [name, s] of Object.entries(SCENES)) console.log('  ' + name.padEnd(10) + s.title);
  process.exit(0);
}

const sceneName = arg('scene', 'flight');
const scene = SCENES[sceneName];
if (!scene) {
  console.error('нет такой сцены: ' + sceneName + '. Список: node tools/screen.mjs --list');
  process.exit(1);
}

// --- что снимаем --------------------------------------------------------------

const [W, H] = (arg('size', '1600x900')).split('x').map(Number);
const out = arg('out', 'shot.png');
const hud = arg('hud', null);
const extra = arg('do', '');
const wait = Number(arg('wait', 1200));

let url = arg('url', 'http://localhost/space_game/'
  + (scene.plain && !arg('url', null) ? scene.plain : ''));
// Автономный режим: снимок не должен зависеть от того, вошёл ли кто-то в
// игру на этой машине, а вход уводит на страницу входа.
if (!url.includes('?')) url += '?offline=1';
// Сцена может попросить свой ключ в адресе. Нужно городу: поверхность
// плитками печётся на видеокарте, а в headless её изображает
// SwiftShader — полсекунды на плитку, то есть за всё ожидание успевают
// три штуки, и город стоит на грубой сфере, проваливаясь в неё.
// Заплатки (surface=clipmap) считаются на процессоре и приезжают сразу.
if (scene.url && !arg('url', null)) url += scene.url;
if (hud) url += '&hud=' + hud;

// --- вспомогательное для сцен -------------------------------------------------
//
// Едет в страницу вместе со сценой. Это не часть игры: ставить корабль
// «в 14 км от станции» игра умеет сама (телепорт по K), но в снимке
// нужна точность, а не игровое удобство.

const HELPERS = `
  const GAME = window.GAME;
  const frames = (n) => { for (let i = 0; i < n; i++) window.__tick(); };
  const press = (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    frames(2);
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    frames(2);
  };
  const liftoff = () => {
    const b = document.getElementById('bootBtn');
    if (b) b.click();
    frames(6);
    if (GAME.state.mode === 'docked') press('Space');
    frames(30);
  };
  // Поставить корабль в gap километрах от поверхности цели, носом на неё.
  const aimAt = (t, gap) => {
    const p = GAME.ship.pos;
    const d = { x: 1, y: 0.25, z: 0.6 };
    const len = Math.hypot(d.x, d.y, d.z);
    const R = (t.radius || 0) + gap;
    p.x = t.pos.x + d.x / len * R;
    p.y = t.pos.y + d.y / len * R;
    p.z = t.pos.z + d.z / len * R;
    GAME.ship.vel.x = GAME.ship.vel.y = GAME.ship.vel.z = 0;
    GAME.ship.speed = 0;
    GAME.ship.throttle = 0;
    const i = GAME.nav.list.indexOf(t);
    if (i >= 0) GAME.nav.index = i;
    frames(4);
    // Нос на цель: тем же вызовом, которым это делает автопилот.
    const fwd = { x: t.pos.x - p.x, y: t.pos.y - p.y, z: t.pos.z - p.z };
    const fl = Math.hypot(fwd.x, fwd.y, fwd.z);
    fwd.x /= fl; fwd.y /= fl; fwd.z /= fl;
    window.__lookAlong(GAME.ship.basis, fwd, { x: 0, y: 1, z: 0 });
    frames(20);
  };
  // Встать у станции в dist километрах от центра, с видом на створ.
  //
  // Направление подбирается СМЕСЬЮ оси порта и направления на солнце:
  // станция висит над планетой портом наружу, и с оси порта её половину
  // витка видно только тёмной. Двигать станцию по орбите ради снимка
  // нельзя — так и потеряли её из кадра в первый раз.
  // Из станций нужного типа берём ту, что повёрнута портом к солнцу:
  // порт смотрит наружу от планеты, и у половины станций он в тени.
  const pickStation = (type) => {
    const sun = GAME.world.star;
    const all = GAME.world.stations.filter((s) => s.type === type);
    let best = null;
    for (const s of (all.length ? all : GAME.world.stations)) {
      const d = { x: sun.pos.x - s.pos.x, y: sun.pos.y - s.pos.y, z: sun.pos.z - s.pos.z };
      const l = Math.hypot(d.x, d.y, d.z) || 1;
      const k = (s.basis.fwd.x * d.x + s.basis.fwd.y * d.y + s.basis.fwd.z * d.z) / l;
      if (!best || k > best.k) best = { k, s };
    }
    return best.s;
  };
  const showStation = (st, dist, side = 0.45, sunMix = 0.75) => {
    const sun = GAME.world.star || GAME.world.bodies.find((b) => b.kind === 'star');
    const toSun = {
      x: sun.pos.x - st.pos.x, y: sun.pos.y - st.pos.y, z: sun.pos.z - st.pos.z };
    const sl = Math.hypot(toSun.x, toSun.y, toSun.z) || 1;
    toSun.x /= sl; toSun.y /= sl; toSun.z /= sl;

    const f = st.basis.fwd, r = st.basis.right, u = st.basis.up;
    const d = {
      x: f.x * 0.9 + toSun.x * sunMix + r.x * side + u.x * side * 0.5,
      y: f.y * 0.9 + toSun.y * sunMix + r.y * side + u.y * side * 0.5,
      z: f.z * 0.9 + toSun.z * sunMix + r.z * side + u.z * side * 0.5 };
    const l = Math.hypot(d.x, d.y, d.z);
    d.x /= l; d.y /= l; d.z /= l;
    const p = GAME.ship.pos;
    p.x = st.pos.x + d.x * dist;
    p.y = st.pos.y + d.y * dist;
    p.z = st.pos.z + d.z * dist;
    GAME.ship.vel.x = GAME.ship.vel.y = GAME.ship.vel.z = 0;
    GAME.ship.speed = 0; GAME.ship.throttle = 0;
    const i = GAME.nav.list.indexOf(st);
    if (i >= 0) GAME.nav.index = i;
    // Смотрим чуть НИЖЕ станции: в виде от третьего лица низ кадра
    // занимает свой же корабль, и станция в середине уходила бы за него.
    // Смещение считаем по МИРОВОЙ вертикали, а не по «верху» станции:
    // она вращается, и её верх за оборот успевает показать во все
    // стороны — кадр от этого прыгал.
    const aim = {
      x: st.pos.x - p.x,
      y: st.pos.y - dist * 0.22 - p.y,
      z: st.pos.z - p.z };
    const al = Math.hypot(aim.x, aim.y, aim.z) || 1;
    window.__lookAlong(GAME.ship.basis,
      { x: aim.x / al, y: aim.y / al, z: aim.z / al }, { x: 0, y: 1, z: 0 });
    frames(20);
  };
  // Повернуть тело так, чтобы город смотрел на солнце (или от него).
  //
  // Двигать по орбите нельзя — уедет вся система, — а суточное вращение
  // ровно для этого и есть: город стоит на грунте и едет вместе с ним.
  const turnCity = (c, side) => {
    const b = c.body;
    const sun = GAME.world.star;
    const d = { x: sun.pos.x - b.pos.x, y: sun.pos.y - b.pos.y, z: sun.pos.z - b.pos.z };
    const dl = Math.hypot(d.x, d.y, d.z) || 1;
    d.x /= dl; d.y /= dl; d.z /= dl;
    const want = side === 'night' ? -1 : 1;
    let best = null;
    const tmp = { x: 0, y: 0, z: 0 };
    const keep = b.spinPhase;
    for (let i = 0; i < 360; i++) {
      b.spinPhase = (i / 360) * Math.PI * 2;
      window.__surf.dirToWorldBody(b, c.dir, tmp);
      const k = (tmp.x * d.x + tmp.y * d.y + tmp.z * d.z) * want;
      if (!best || k > best.k) best = { k, ph: b.spinPhase };
    }
    b.spinPhase = best ? best.ph : keep;
    frames(2);
  };
  // Встать над городом: alt километров высоты, dist километров в сторону.
  const showCity = (alt, dist, side = null) => {
    const c = GAME.world.cities[0];
    if (!c) throw new Error('в системе нет города');
    turnCity(c, side);
    const u = c.basis.up, r = c.basis.right;
    const p = GAME.ship.pos;
    p.x = c.pos.x + u.x * alt + r.x * dist;
    p.y = c.pos.y + u.y * alt + r.y * dist;
    p.z = c.pos.z + u.z * alt + r.z * dist;
    GAME.ship.vel.x = GAME.ship.vel.y = GAME.ship.vel.z = 0;
    GAME.ship.speed = 0; GAME.ship.throttle = 0;
    const i = GAME.nav.list.indexOf(c);
    if (i >= 0) GAME.nav.index = i;
    const look = () => {
      const f = { x: c.pos.x - p.x, y: c.pos.y - p.y, z: c.pos.z - p.z };
      const fl = Math.hypot(f.x, f.y, f.z) || 1;
      window.__lookAlong(GAME.ship.basis,
        { x: f.x / fl, y: f.y / fl, z: f.z / fl }, c.basis.up);
    };
    look();
    // Держим корабль над городом всё ожидание: плитки поверхности
    // считаются в потоках и приходят через несколько секунд, а свободный
    // корабль за это время падает и уезжает с грунтом.
    window.__hold = () => {
      p.x = c.pos.x + c.basis.up.x * alt + c.basis.right.x * dist;
      p.y = c.pos.y + c.basis.up.y * alt + c.basis.right.y * dist;
      p.z = c.pos.z + c.basis.up.z * alt + c.basis.right.z * dist;
      GAME.ship.vel.x = GAME.ship.vel.y = GAME.ship.vel.z = 0;
      GAME.ship.speed = 0;
      look();
    };
    frames(30);
  };
  // То же, но целясь в посадочную площадку, а не в середину города.
  const showCityPad = (alt, dist, side = null) => {
    const c = GAME.world.cities[0];
    if (!c) throw new Error('в системе нет города');
    turnCity(c, side);
    const pad = c.plan.pads[1] || c.plan.pads[0];
    const u = c.basis.up, r = c.basis.right, fw = c.basis.fwd;
    const at = {
      x: c.pos.x + r.x * pad.x + fw.x * pad.z,
      y: c.pos.y + r.y * pad.x + fw.y * pad.z,
      z: c.pos.z + r.z * pad.x + fw.z * pad.z };
    const p = GAME.ship.pos;
    p.x = at.x + u.x * alt + r.x * dist;
    p.y = at.y + u.y * alt + r.y * dist;
    p.z = at.z + u.z * alt + r.z * dist;
    GAME.ship.vel.x = GAME.ship.vel.y = GAME.ship.vel.z = 0;
    GAME.ship.speed = 0; GAME.ship.throttle = 0;
    const look = () => {
      const a2 = {
        x: c.pos.x + c.basis.right.x * pad.x + c.basis.fwd.x * pad.z,
        y: c.pos.y + c.basis.right.y * pad.x + c.basis.fwd.y * pad.z,
        z: c.pos.z + c.basis.right.z * pad.x + c.basis.fwd.z * pad.z };
      const f = { x: a2.x - p.x, y: a2.y - p.y, z: a2.z - p.z };
      const fl = Math.hypot(f.x, f.y, f.z) || 1;
      window.__lookAlong(GAME.ship.basis,
        { x: f.x / fl, y: f.y / fl, z: f.z / fl }, c.basis.up);
      return a2;
    };
    look();
    window.__hold = () => {
      const a2 = look();
      p.x = a2.x + c.basis.up.x * alt + c.basis.right.x * dist;
      p.y = a2.y + c.basis.up.y * alt + c.basis.right.y * dist;
      p.z = a2.z + c.basis.up.z * alt + c.basis.right.z * dist;
      GAME.ship.vel.x = GAME.ship.vel.y = GAME.ship.vel.z = 0;
      GAME.ship.speed = 0;
      look();
    };
    frames(30);
  };
  // Зависнуть над телом на высоте alt, носом ПО ГОРИЗОНТУ.
  //
  // Встать там, где на теле ЕСТЬ ЧТО СНИМАТЬ, и при дневном свете.
  //
  // Нужен потому, что и горы, и лес занимают малую долю шара: попасть в
  // них наугад нельзя, а снимок пустой равнины ничего не говорит.
  // Отбор (pick) получает направление в осях тела и возвращает число —
  // берётся направление с наибольшим, из тех, где солнце стоит на
  // заданной высоте.
  //
  // Возвращает обещание: рельеф и растительность — модули игры, а
  // импорт в странице асинхронный.
  // off — отойти от найденного места на столько километров и смотреть
  // НА НЕГО. Нужно горам: с вершины стокилометрового массива не видно
  // ничего, кроме пологого купола под ногами, — гора читается только со
  // стороны. Отходим туда, где pick наименьший, то есть на равнину.
  const standWhere = async (b, pick, alt, elev, az, pitch, off = 0) => {
    const T = await import('./js/gl/terrain.js');
    const F = await import('./js/gl/flora.js');
    const S = window.__surf;
    const t = T.terrainOf(b);
    const sun = GAME.world.star;
    const nz = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; v.x /= l; v.y /= l; v.z /= l; return v; };
    const sw = nz({ x: sun.pos.x - b.pos.x, y: sun.pos.y - b.pos.y, z: sun.pos.z - b.pos.z });
    // Солнце в осях тела: рельеф считается в них же.
    const sl = S.localDir(b, { x: b.pos.x + sw.x * 1e6, y: b.pos.y + sw.y * 1e6, z: b.pos.z + sw.z * 1e6 });
    const lo = Math.sin((elev - 9) * Math.PI / 180), hi = Math.sin((elev + 9) * Math.PI / 180);
    let best = null;
    for (let i = 0; i < 24000; i++) {
      const u = -1 + 2 * (i / 23999), a = i * 2.399963, s2 = Math.sqrt(Math.max(0, 1 - u * u));
      const d = { x: s2 * Math.cos(a), y: u, z: s2 * Math.sin(a) };
      const e = d.x * sl.x + d.y * sl.y + d.z * sl.z;
      if (e < lo || e > hi) continue;
      if (Math.abs(d.y) > 0.55) continue;            // мимо полярных шапок
      const v = pick(t, F, b, d);
      if (!best || v > best.v) best = { v, d };
    }
    if (!best) return false;
    let d = best.d;
    let look = null;
    if (off > 0) {
      const hp = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      const u = nz({ x: hp.y * d.z - hp.z * d.y, y: hp.z * d.x - hp.x * d.z, z: hp.x * d.y - hp.y * d.x });
      const v = { x: d.y * u.z - d.z * u.y, y: d.z * u.x - d.x * u.z, z: d.x * u.y - d.y * u.x };
      const r = off / b.radius;
      let low = null;
      for (let k = 0; k < 32; k++) {
        const a = k / 32 * 2 * Math.PI, c = Math.cos(a) * r, s2 = Math.sin(a) * r;
        const q = nz({ x: d.x + u.x * c + v.x * s2, y: d.y + u.y * c + v.y * s2, z: d.z + u.z * c + v.z * s2 });
        // Солнце должно остаться ЗА СПИНОЙ: если встать не с той
        // стороны, гора выходит чёрным силуэтом против света, а кадр —
        // засвеченным небом. Так и вышло на первой попытке.
        const qd = q.x * d.x + q.y * d.y + q.z * d.z;
        const to = nz({ x: d.x - q.x * qd, y: d.y - q.y * qd, z: d.z - q.z * qd });
        const qs = q.x * sl.x + q.y * sl.y + q.z * sl.z;
        const sh = nz({ x: sl.x - q.x * qs, y: sl.y - q.y * qs, z: sl.z - q.z * qs });
        if (to.x * sh.x + to.y * sh.y + to.z * sh.z > -0.3) continue;
        const val = pick(t, F, b, q);
        if (!low || val < low.val) low = { val, q };
      }
      if (!low) return false;
      look = d;
      d = low.q;
    }
    const p = GAME.ship.pos;
    S.worldPoint(b, d, S.groundRadius(b, d) + alt, p);
    const up = nz({ x: p.x - b.pos.x, y: p.y - b.pos.y, z: p.z - b.pos.z });
    GAME.ship.vel.x = GAME.ship.vel.y = GAME.ship.vel.z = 0;
    GAME.ship.speed = 0; GAME.ship.throttle = 0;
    // Смотрим вдоль горизонта, отвернувшись от солнца на az и опустив
    // нос на pitch: с сотен метров земля впереди уходит под панель.
    const dd = up.x * sw.x + up.y * sw.y + up.z * sw.z;
    const fs = nz({ x: sw.x - up.x * dd, y: sw.y - up.y * dd, z: sw.z - up.z * dd });
    const rt = { x: up.y * fs.z - up.z * fs.y, y: up.z * fs.x - up.x * fs.z, z: up.x * fs.y - up.y * fs.x };
    const A = az * Math.PI / 180, P = pitch * Math.PI / 180;
    let f;
    if (look) {
      // Нос — на оставленную точку, но ПО ГОРИЗОНТУ: наклон задаётся
      // отдельно (pitch), иначе кадр уезжает в небо вместе с вершиной.
      const lp = { x: 0, y: 0, z: 0 };
      S.worldPoint(b, look, S.groundRadius(b, look), lp);
      const to = nz({ x: lp.x - p.x, y: lp.y - p.y, z: lp.z - p.z });
      const td = to.x * up.x + to.y * up.y + to.z * up.z;
      f = nz({ x: to.x - up.x * td, y: to.y - up.y * td, z: to.z - up.z * td });
    } else {
      f = nz({
        x: fs.x * Math.cos(A) + rt.x * Math.sin(A),
        y: fs.y * Math.cos(A) + rt.y * Math.sin(A),
        z: fs.z * Math.cos(A) + rt.z * Math.sin(A),
      });
    }
    const fp = nz({
      x: f.x * Math.cos(P) - up.x * Math.sin(P),
      y: f.y * Math.cos(P) - up.y * Math.sin(P),
      z: f.z * Math.cos(P) - up.z * Math.sin(P),
    });
    window.__lookAlong(GAME.ship.basis, fp, up);
    frames(30);
    // Корабль висит без опоры: за секунды ожидания он успел бы и сесть,
    // и завалиться на бок. Держим и место, и разворот — иначе горизонт
    // в кадре оказывается наискось (так и вышло на первом снимке).
    window.__hold = () => {
      GAME.ship.vel.x = GAME.ship.vel.y = GAME.ship.vel.z = 0;
      GAME.ship.speed = 0;
      S.worldPoint(b, d, S.groundRadius(b, d) + alt, GAME.ship.pos);
      window.__lookAlong(GAME.ship.basis, fp, up);
    };
    return true;
  };
  const atmoWorld = () => GAME.world.planets.find((p) => p.kind === 'ocean');
  // Уклон в точке: наибольший перепад высоты на сто метров по двум
  // касательным, в долях (0.02 — два метра на сто).
  const flat = (t, b, d) => {
    const hp = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    let ux = hp.y * d.z - hp.z * d.y, uy = hp.z * d.x - hp.x * d.z, uz = hp.x * d.y - hp.y * d.x;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = d.y * uz - d.z * uy, vy = d.z * ux - d.x * uz, vz = d.x * uy - d.y * ux;
    const k = 0.1 / b.radius;
    const h0 = t.displace(d.x, d.y, d.z);
    let worst = 0;
    for (const [ax, ay, az] of [[ux, uy, uz], [vx, vy, vz]]) {
      const q = { x: d.x + ax * k, y: d.y + ay * k, z: d.z + az * k };
      const l = Math.hypot(q.x, q.y, q.z);
      worst = Math.max(worst, Math.abs(t.displace(q.x / l, q.y / l, q.z / l) - h0) / k);
    }
    return worst;
  };

  // Нужен отдельно от aimAt: тот наводит нос на центр тела, то есть у
  // самой земли — прямо в грунт, и корабль честно в него влетает. У
  // поверхности смотреть надо вдоль, а не вниз.
  const hover = (b, alt, side = null) => {
    // side — с какой стороны тела висеть. По умолчанию произвольная;
    // 'night' ставит на противосолнечную, где только фары и светят.
    const sun = GAME.world.star;
    const up = side === 'night'
      ? { x: b.pos.x - sun.pos.x, y: b.pos.y - sun.pos.y, z: b.pos.z - sun.pos.z }
      : { x: 0.35, y: 0.9, z: 0.26 };
    const ul = Math.hypot(up.x, up.y, up.z);
    up.x /= ul; up.y /= ul; up.z /= ul;

    // Высота считается ОТ ГРУНТА, а не от радиуса тела: рельеф у луны в
    // несколько километров, и «радиус плюс километр» оказывается внутри
    // горы. Корабль тогда честно садится, и вместо зависания в кадре
    // стоянка.
    const S = window.__surf;
    const p = GAME.ship.pos;
    const dirLocal = S.localDir(b, {
      x: b.pos.x + up.x * b.radius,
      y: b.pos.y + up.y * b.radius,
      z: b.pos.z + up.z * b.radius });
    S.worldPoint(b, dirLocal, S.groundRadius(b, dirLocal) + alt, p);
    // «Вверх» пересчитываем от настоящего места: над горой он другой.
    up.x = p.x - b.pos.x; up.y = p.y - b.pos.y; up.z = p.z - b.pos.z;
    const ul2 = Math.hypot(up.x, up.y, up.z);
    up.x /= ul2; up.y /= ul2; up.z /= ul2;

    GAME.ship.vel.x = GAME.ship.vel.y = GAME.ship.vel.z = 0;
    GAME.ship.speed = 0; GAME.ship.throttle = 0;
    // Любое направление поперёк вертикали — это и есть горизонт.
    const t = Math.abs(up.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const f = {
      x: t.y * up.z - t.z * up.y,
      y: t.z * up.x - t.x * up.z,
      z: t.x * up.y - t.y * up.x,
    };
    const fl = Math.hypot(f.x, f.y, f.z);
    f.x /= fl; f.y /= fl; f.z /= fl;
    window.__lookAlong(GAME.ship.basis, f, up);
    frames(30);
  };
`;

// --- протокол Chrome ----------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 'solar-shot-'));
const port = 9222 + Math.floor(Math.random() * 300);

const proc = spawn(chrome, [
  '--headless=new',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  '--window-size=' + W + ',' + H,
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  // Без этого в headless нет настоящего GL: кадр придёт чёрным.
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Дождаться, пока Chrome поднимет свой порт, и взять адрес вкладки. */
async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* ещё не поднялся */ }
    await sleep(100);
  }
  throw new Error('Chrome не отозвался на порту ' + port);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const waiting = new Map();
  let seq = 0;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const slot = waiting.get(msg.id);
    if (!slot) return;
    waiting.delete(msg.id);
    if (msg.error) slot.reject(new Error(msg.error.message));
    else slot.resolve(msg.result);
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('не подключиться к Chrome')));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

/** Выполнить код в странице и вернуть результат. */
async function run(cdp, code) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: '(() => {' + code + '})()',
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    const e = r.exceptionDetails;
    throw new Error('в странице: ' + (e.exception ? e.exception.description : e.text));
  }
  return r.result.value;
}

try {
  const cdp = connect(await target());
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  await cdp.send('Page.navigate', { url });

  // Ждём не «загрузки страницы», а саму игру: модули грузятся, потом
  // загрузчик идёт за характеристиками на сервер, и только после этого
  // появляется window.GAME. Страница без игры (plain) ждёт своё: чтобы
  // скрипт модулем успел расставить надписи.
  let ok = false;
  if (scene.plain) {
    for (let i = 0; i < 100 && !ok; i++) {
      ok = await run(cdp, "return !!document.querySelector('#go') && document.querySelector('#go').textContent !== ''");
      if (!ok) await sleep(50);
    }
    if (!ok) throw new Error('страница не собралась: нет кнопки входа');
    if (scene.run) await run(cdp, scene.run);
    if (extra) await run(cdp, extra);
    await sleep(wait);
    const shotP = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(out, Buffer.from(shotP.data, 'base64'));
    console.log(`снимок: ${out}  (${W}×${H}, сцена «${scene.title}»)`);
    cdp.close();
    proc.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* и ладно */ }
    process.exit(0);
  }
  for (let i = 0; i < 200; i++) {
    ok = await run(cdp, 'return !!(window.GAME && window.GAME.world)');
    if (ok) break;
    await sleep(100);
  }
  if (!ok) {
    const err = await run(cdp, `
      const b = document.getElementById('bootBody');
      return b ? b.textContent.slice(0, 200) : 'страница пуста';
    `);
    throw new Error('игра не поднялась: ' + err);
  }

  // Кадры двигаем сами: requestAnimationFrame в headless идёт, но
  // сцену надо доиграть до нужного места за предсказуемое число шагов.
  await run(cdp, `
    window.__tick = () => {};
    const raf = window.requestAnimationFrame;
    let cb = null;
    window.requestAnimationFrame = (fn) => { cb = fn; return 1; };
    let t = performance.now();
    window.__tick = () => { t += 16.7; const f = cb; cb = null; if (f) f(t); };
  `);
  // lookAlong нужен помощникам сцены, а модули страницы наружу не видны.
  await run(cdp, `
    return import('./js/core/basis.js').then((m) => { window.__lookAlong = m.lookAlong; return true; });
  `);
  // Рельеф: без него «зависнуть на километре» означает «радиус плюс
  // километр», а у тела с горами это внутри горы — корабль садится, и
  // сцена показывает не то, что просили.
  await run(cdp, `
    return import('./js/game/surface.js').then((m) => { window.__surf = m; return true; });
  `);

  if (scene.run) await run(cdp, HELPERS + scene.run + '\nframes(8);');
  if (extra) await run(cdp, HELPERS + extra + '\nframes(8);');
  // Пауза перед снимком — чтобы досчитались плитки поверхности и тени:
  // они собираются в потоках и по таймерам, а не в кадре. Ход игры при
  // этом НЕ возобновляем: сцена должна остаться той, которую поставили,
  // а не уехать за секунду ожидания (корабль у грунта за неё успевает
  // сесть). Кадры добиваем вручную.
  const until = Date.now() + wait;
  while (Date.now() < until) {
    // Сцена может попросить удерживать корабль: window.__hold зовётся на
    // каждом шаге ожидания. Нужно тем сценам, где корабль висит без
    // опоры, — за секунды ожидания он успевает и упасть, и уехать вместе
    // с грунтом, и снимок показывает не то, что ставили.
    await run(cdp, 'if (window.__hold) window.__hold(); window.__tick(); return 1;');
    await sleep(50);
  }

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  // Отчёт о городе перед снимком: CITYDBG=1 node tools/screen.mjs --scene=city
  //
  // «Города не видно» имеет три разные причины — не собран, не нарисован
  // или слился с грунтом по цвету, — и по картинке они неразличимы. Один
  // раз на этом уже потеряли полчаса: город оказался и собран, и
  // нарисован, а не видно его было потому, что крыши вышли той же
  // яркости, что бетон плиты.
  // Отчёт о поверхности: SURFDBG=1 node tools/screen.mjs …
  //
  // «Деревьев не видно» имеет те же три причины, что и у города, и по
  // снимку они неразличимы: поле не собрано, собрано и не нарисовано,
  // или выросло пусто. Числа различают их сразу.
  // Отчёт о людях и чужих кораблях: PEOPLEDBG=1 node tools/screen.mjs --scene=crew
  //
  // «Человека не видно» — это и «снимок не принят», и «не стоит ни на
  // чём в этом мире», и «модель не собралась», и «собралась, но не
  // нарисована». По кадру они неразличимы.
  if (process.env.PEOPLEDBG) {
    const info = await run(cdp, `
      const s = window.SCENE.suit;
      return JSON.stringify({
        people: GAME.people.map((p) => ({ id: p.id, st: p.st, here: p.here, ship: p.ship, body: p.body,
          d: p.place ? Math.hypot(p.place.pos.x - GAME.camera.pos.x, p.place.pos.y - GAME.camera.pos.y,
            p.place.pos.z - GAME.camera.pos.z) * 1000 : null })),
        peers: GAME.peers.map((v) => ({ id: v.id, dorm: v.dorm, air: !!v.air, hatches: v.hatches, gear: v.gear.t })),
        suit: s ? { ready: !!s.S, loading: s.loading, error: s.error ? String(s.error.message || s.error) : null,
          draws: s.draws } : null,
        out: window.SCENE.peopleDraws,
        frame: GAME.frame && GAME.frame.id,
      });
    `);
    console.log('люди: ' + info);
  }
  if (process.env.SURFDBG) {
    const info = await run(cdp, `
      const st = GAME.renderStats;
      // Куда смотрит нос относительно горизонта. Без этого числа
      // «грунта не видно» и «камера задрана в небо» по снимку
      // неразличимы: и там и там кадр ровного цвета.
      const p = GAME.ship.pos;
      let near = null;
      for (const b of GAME.world.bodies) {
        const d = Math.hypot(p.x - b.pos.x, p.y - b.pos.y, p.z - b.pos.z) - b.radius;
        if (!near || d < near.d) near = { d, b };
      }
      const u = near && (() => {
        const b = near.b;
        const l = Math.hypot(p.x - b.pos.x, p.y - b.pos.y, p.z - b.pos.z) || 1;
        return { x: (p.x - b.pos.x) / l, y: (p.y - b.pos.y) / l, z: (p.z - b.pos.z) / l };
      })();
      const f = GAME.ship.basis.fwd;
      return JSON.stringify({
        alt: GAME.hud && GAME.hud.alt,
        near: near && near.b.name,
        overKm: near && +near.d.toFixed(3),
        lookDeg: u && +(Math.asin(Math.max(-1, Math.min(1,
          f.x * u.x + f.y * u.y + f.z * u.z))) * 180 / Math.PI).toFixed(1),
        flora: st.flora, rocks: st.rocks, patches: st.patches, forest: st.forest,
        // Камера от третьего лица: ушла ли под корпус, насколько её
        // подняла земля, и что метёт струя.
        cam: GAME.chase && {
          low: +GAME.chase.low.toFixed(2), lift: +(GAME.chase.lift * 1000).toFixed(1),
          altM: near && +((Math.hypot(GAME.camera.pos.x - near.b.pos.x,
            GAME.camera.pos.y - near.b.pos.y, GAME.camera.pos.z - near.b.pos.z)
            - window.__surf.groundRadius(near.b, window.__surf.localDir(near.b, GAME.camera.pos)))
            * 1000).toFixed(1),
        },
        dust: GAME.dust && { n: GAME.dust.list.length, air: GAME.dust.air,
          ringM: +(GAME.dust.ring * 1000).toFixed(0) },
        tiles: st.tiles && { drawn: st.tiles.drawn, level: st.tiles.level },
        polys: st.polys, items: st.items,
      });
    `);
    console.log('поверхность:', info);
  }
  // Кабина: собрались ли её шейдеры (мок GL в tools/gl.mjs их не
  // компилирует — ошибку GLSL видно только здесь), рисуются ли экраны.
  if (process.env.CABINDBG) {
    const info = await run(cdp, `return JSON.stringify(GAME.renderStats && GAME.renderStats.cabin);`);
    console.log('кабина:', info);
  }
  if (process.env.CITYDBG) {
    const info = await run(cdp, `
      const c = GAME.world.cities[0];
      const p = GAME.ship.pos;
      return JSON.stringify({
        cities: GAME.world.cities.length,
        radius: c && c.radius,
        stats: GAME.renderStats && GAME.renderStats.city,
        dist: c ? Math.hypot(c.pos.x - p.x, c.pos.y - p.y, c.pos.z - p.z) : null,
      });
    `);
    console.log('город:', info);
  }
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`снимок: ${out}  (${W}×${H}, сцена «${scene.title}»)`);
  cdp.close();
} catch (e) {
  console.error('ОШИБКА: ' + e.message);
  process.exitCode = 1;
} finally {
  proc.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* и ладно */ }
}
