// Поддельный сервер для проверок: API и сокет в памяти.
//
// Игра без сервера не запускается вовсе (js/boot.js): ни автономного
// режима, ни запуска из кэша — их убрали, потому что игра без сервера
// живёт по своим правилам и молча расходится с настоящей. Проверкам же
// сервер нужен не настоящий, а его голос: пилот в порту, корабль, груз,
// ответ на сохранение. Его и даёт этот файл.
//
// Читается он двумя путями. Node импортирует его как модуль
// (tools/smoke.mjs, shot.mjs, net.mjs). Снимки экрана (tools/screen.mjs)
// вкладывают его ТЕКСТ в страницу Chrome до её скриптов, сняв слово
// export, — поэтому здесь нет ни одного импорта и ни одного Node-API.
//
//   const S = makeFakeServer({ specs, station });
//   globalThis.fetch = S.fetch;  globalThis.WebSocket = S.WebSocket;
//   localStorage: solar_trader_token = FAKE_TOKEN
//
// S.saved — последнее сохранение, S.calls — все вызовы API, S.down = true —
// сервер «упал»: fetch бросает, как при обрыве сети, сокет закрывается.
// S.routes[route] = (body, S) => data — подменить ответ на один вызов.

export const FAKE_TOKEN = 'f'.repeat(64);

/**
 * @param specs   характеристики (тот же вид, что catalog.specs)
 * @param station номер станции родной системы, где пилот стоит в доке
 * @param system  номер системы
 */
export function makeFakeServer({ specs, station = 4, system = 0 } = {}) {
  const engine = specs.modules.filter((m) => m.installed);
  const S = {
    calls: [],
    saved: null,
    saves: 0,
    down: false,
    routes: {},
    sockets: [],
    // Переходы пилота, которые игра прислала (pilot.move), по порядку.
    moves: [],
    // Отказы сервера: S.refuse[route] = [код, слова] — вызов ответит отказом.
    refuse: {},
    // Кто в сети (welcome, roster): по нему игра судит, в игре ли хозяин
    // корабля, на борту которого едет пилот.
    roster: [],
    state: {
      world: { time: 1000 },
      player: {
        id: 1, login: 'pilot', name: 'JAMESON', balance: 2115, playTimeS: 600,
        stats: { flownKm: 0, docks: 1, landings: 0, crashes: 0 },
      },
      position: {
        systemId: system, pos: { x: 0, y: 0, z: 0 }, basis: null,
        dockedBody: station, landedBody: null, landedPose: null, landedSecured: false,
        anchorBody: null, anchorPose: null,
        targetBody: null, warpTo: null, lastStation: station, view: 'cockpit', hatches: [],
      },
      ship: {
        id: 1, name: '', hull: 100, shield: 40, fuelT: 12, gearOut: false,
        type: { code: 'challenger', name: 'Challenger' },
        equipment: engine.map((m) => ({ code: m.code, name: m.name, slot: m.slot, spec: m.spec, level: 1, health: 100 }))
          .concat(specs.weapons.filter((w) => w.ready).map((w) => ({ code: w.code, name: w.name, slot: 'gun',
            spec: w, level: 1, health: 100 }))),
      },
      // Груз, задания и лента — как у начинающего пилота: приборам и меню
      // есть что показать.
      cargo: [
        { commodity_id: 1, code: 'water', name: 'ВОДА', category: 'сырьё', legal: true, tons: 6, avg_price: 80 },
        { commodity_id: 2, code: 'grain', name: 'ЗЕРНО', category: 'продовольствие', legal: true, tons: 4, avg_price: 130 },
        { commodity_id: 3, code: 'ore', name: 'ЖЕЛЕЗНАЯ РУДА', category: 'сырьё', legal: true, tons: 3, avg_price: 60 },
      ],
      holdUsedT: 13,
      missions: [
        { id: 1, kind: 'deliver', title: 'ДОСТАВКА · LAVE VI', descr: 'Сдать 4 т зерна на станции газового гиганта.',
          reward: 1200, penalty: 300, tons: 4, timeLimitS: 2400, leftS: 2400, state: 'active',
          target: { name: 'LAVE VI', system: 'Lave', systemId: 0, localId: 10 } },
        { id: 2, kind: 'scout', title: 'РАЗВЕДКА · BEON', descr: 'Снять показания у звезды соседней системы.',
          reward: 2600, penalty: 0, tons: 0, timeLimitS: 4500, leftS: 4500, state: 'active', target: null },
      ],
      ledger: [
        { at: '2026-10-04 06:00:00', label: 'НАЧАЛЬНЫЙ КАПИТАЛ', amount: 3400, balance_after: 3400, ref: 'start' },
        { at: '2026-10-04 06:01:00', label: 'ПОСТАВКА: ВОДА, 6 Т', amount: -480, balance_after: 2920, ref: 'buy' },
        { at: '2026-10-04 06:02:00', label: 'ПОСТАВКА: ЗЕРНО, 4 Т', amount: -520, balance_after: 2400, ref: 'buy' },
        { at: '2026-10-04 06:03:00', label: 'СТЫКОВОЧНЫЙ СБОР', amount: -285, balance_after: 2115, ref: 'dock' },
      ],
      fleet: [{ id: 1, name: '', type: 'challenger', typeName: 'Challenger', active: true, systemId: system,
        where: 'docked', body: station, systemName: 'Lave', bodyName: null, point: null, pos: null }],
    },
  };

  const ok = (data) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
  const deny = (code, message, status = 409) => ({ ok: false, status,
    json: async () => ({ ok: false, error: { code, message } }) });
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const st = S.state;

  const answers = {
    'catalog.specs': () => specs,
    'player.state': () => clone(st),
    'player.save': (b) => {
      S.saved = b.save;
      S.saves++;
      return { saved: true, fields: 1, fuel: st.ship.fuelT, warpFuel: 0 };
    },
    'station.dock': (b) => {
      st.position.dockedBody = b.station;
      st.position.lastStation = b.station;
      return { station: { systemId: b.system, localId: b.station, name: 'ПОРТ', tech: 5, fee: 0, repairRate: 18,
        pads: 6, services: { market: true, board: true, repair: true, outfit: true } }, fee: 0, charged: false,
      balance: st.player.balance };
    },
    'station.undock': () => {
      st.position.dockedBody = null;
      return { undocked: true };
    },
    // Переход пилота принимается всегда: проверки сервера — в его наборе
    // (server/tests/run.php), здесь важно лишь, что игра его зовёт.
    'pilot.move': (b) => {
      // Место пилота поддельный сервер не ведёт (его state.me не трогаем):
      // прогон ставит пилота и в обход сервера, и чужое место потом
      // вернулось бы с буксиром или страховкой.
      S.moves.push(b.me || {});
      return { moved: true, me: b.me || null };
    },
    'station.repair': () => {
      const cost = Math.round((100 - st.ship.hull) * 18);
      st.ship.hull = 100;
      st.player.balance -= cost;
      return { hull: 100, cost, balance: st.player.balance };
    },
    'station.refuel': (b) => {
      const room = 12 - st.ship.fuelT;
      const tons = typeof b.tons === 'number' ? Math.min(b.tons, room) : room;
      const cost = Math.ceil(tons * 80);
      st.ship.fuelT += tons;
      st.player.balance -= cost;
      return { fuel: st.ship.fuelT, cap: 12, tons, price: 80, cost, balance: st.player.balance };
    },
    'ship.rescue': () => {
      // Буксир: в порт, бак до резерва, за деньги — как Fuel::rescue.
      const fee = 300;
      Object.assign(st.position, { dockedBody: st.position.lastStation, landedBody: null, landedPose: null,
        anchorBody: null, anchorPose: null });
      st.ship.fuelT = Math.max(st.ship.fuelT, 1.2);
      st.player.balance -= fee;
      return { fee, balance: st.player.balance };
    },
    'ship.impact': (b) => {
      if (b.fatal) S.insure();
      return { hull: st.ship.hull, max: 100, damage: 0, dead: !!b.fatal };
    },
    'ship.command': () => clone(st),
    'market.prices': () => ({ station: { name: 'ПОРТ', tech: 5 }, fuelPrice: 80, goods: [
      { code: 'water', name: 'ВОДА', category: 'сырьё', legal: true, base_price: 30, price: 30, stock: 100 },
      { code: 'grain', name: 'ЗЕРНО', category: 'продовольствие', legal: true, base_price: 65, price: 60, stock: 50 },
    ] }),
    'market.buy': (b) => ({ code: b.code, tons: b.tons, price: 30, sum: -30 * b.tons, balance: st.player.balance }),
    'market.sell': (b) => ({ code: b.code, tons: b.tons, price: 30, sum: 30 * b.tons, balance: st.player.balance }),
    'outfit.list': () => ({ open: true, resale: 0.6, balance: st.player.balance, slots: [] }),
    'shipyard.list': () => ({ open: true, tech: 5,
      here: [{ id: st.ship.id, active: true, typeName: 'Challenger', title: 'ЛЁГКИЙ ТОРГОВЫЙ КОРАБЛЬ' }],
      hulls: specs.shipTypes.map((t) => ({ code: t.code, name: t.name, title: t.title, price: t.price, sold: true,
        tech: 4, lengthM: 65, widthM: 67, heightM: 19, massT: 1682 })) }),
    // Города системы игра собирает сама; без списка в ответе она его не
    // трогает (js/main.js, syncCities).
    'galaxy.system': () => ({}),
    'galaxy.stations': () => ({ stations: [] }),
    'missions.board': () => ({ missions: [] }),
    'ledger.list': () => ({ ledger: st.ledger }),
    'auth.logout': () => ({}),
  };

  /**
   * Страховка после гибели — как Combat::respawn: корабль в последнем
   * порту. Без неё «Продолжить» забирал бы место, где корабль разбился.
   */
  S.insure = () => {
    Object.assign(st.position, { dockedBody: st.position.lastStation, landedBody: null, landedPose: null,
      anchorBody: null, anchorPose: null });
  };

  S.fetch = async (url, opts = {}) => {
    const href = String(url);
    if (href.indexOf('api.php') < 0) {
      // Звуки и прочие файлы — не сервер: пустой ответ.
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({}) };
    }
    const route = decodeURIComponent(href.split('r=')[1] || '');
    const body = opts.body ? JSON.parse(opts.body) : {};
    S.calls.push(route);
    if (S.down) throw new TypeError('failed to fetch');
    if (S.refuse[route]) return deny(S.refuse[route][0], S.refuse[route][1]);
    if (S.routes[route]) return ok(S.routes[route](body, S));
    const token = opts.headers && opts.headers['X-Auth-Token'];
    if (route !== 'catalog.specs' && token !== FAKE_TOKEN) return deny('auth', 'нужен вход', 401);
    const fn = answers[route];
    return ok(fn ? fn(body, S) : {});
  };

  /**
   * Сокет: открывается сразу, на hello отвечает welcome — и дальше молчит.
   * Что приходит в снимках, проверки кладут в net сами (js/net/socket.js).
   * Ответы — микрозадачами: проверки крутят кадры без событийного цикла,
   * и таймер до них не дошёл бы.
   */
  S.WebSocket = class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      S.sockets.push(this);
      queueMicrotask(() => {
        if (S.down) { this.readyState = 3; if (this.onclose) this.onclose({ code: 1006 }); return; }
        this.readyState = 1;
        if (this.onopen) this.onopen({});
      });
    }

    send(text) {
      const msg = JSON.parse(text);
      const reply = (m) => queueMicrotask(() => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: JSON.stringify(m) }); });
      if (msg.t === 'hello') {
        reply({ t: 'welcome', you: { id: st.player.id, name: st.player.name, sys: st.position.systemId, ship: st.ship.id },
          tick: 0.2, wt: st.world.time, peers: [], people: [], roster: S.roster, npc: { see: 80, hide: 100 } });
      } else if (msg.t === 'ping') {
        reply({ t: 'pong', time: 0 });
      } else if (msg.t === 'impact' && msg.fatal) {
        S.insure();
      }
    }

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.onclose) this.onclose({ code: 1000 });
    }
  };

  /** Уронить сокет, как падает хаб: игра обязана это увидеть. */
  S.dropSockets = () => { for (const s of S.sockets) s.close(); };

  return S;
}
