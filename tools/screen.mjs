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
  map: {
    title: 'карта системы',
    run: 'liftoff(); press("KeyM");',
  },
  menu: {
    title: 'меню пилота',
    run: 'liftoff(); press("KeyI");',
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

let url = arg('url', 'http://localhost/space_game/');
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
  // появляется window.GAME.
  let ok = false;
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
