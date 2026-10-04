// Оракул рельефа: что сервер NPC спрашивает о грунте и корпусах.
//
// Хаб (server/src/Hub.php) ведёт NPC сам — где они, куда летят, где
// садятся, — и для посадки ему нужно знать то, чего у PHP нет: высоту
// грунта, воду и уклон в данной точке тела. Рельеф — процедурный шум
// (js/gl/terrain.js) в тысячу строк, и вторая его копия на PHP разошлась
// бы с первой на третьем знаке: NPC стоял бы у всех в метре над землёй
// или по колено в ней. Ровно поэтому каталог тел сервер тоже не считает
// сам, а берёт выгрузкой генератора (tools/export.mjs).
//
// Здесь — тот же генератор, живьём: оракул собирает систему тем же
// makeSystem, что и игра, и отвечает её же функциями (findSite,
// groundRadius, surfaceNormal). Площадка, которую он назвал, у каждого
// клиента окажется ровно там же — они считают тем же кодом.
//
// Запускает его хаб сам (server/src/Oracle.php) и говорит с ним по
// локальному TCP строками JSON: запрос — строка, ответ — строка.
// Слушает только 127.0.0.1 и только порт, выбранный системой; номер
// порта печатает первой строкой. Хаб ушёл — закрылся stdin — оракул
// выходит сам: сиротой висеть ему незачем.
//
//   node server/ws/oracle.mjs            запустить (обычно это делает хаб)
//
// Вопросы:
//   {"t":"types"}                                          корпуса: стойки, размер
//   {"t":"area","sys":0,"body":3,"dir":[x,y,z],"km":60}    верх грунта вокруг точки
//   {"t":"site","sys":0,"body":3,"dir":[x,y,z],"span":3}   сухая ровная площадка рядом
//   {"t":"ground","sys":0,"body":3,"dir":[x,y,z]}          радиус грунта в точке
//   {"t":"pos","sys":0,"body":4,"wt":12345.6}              где тело на момент мира
//     (сверка: сервер считает орбиты сам, Traffic::posAt, — и обязан
//     получать то же, что игра)

import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { galaxy } from '../../js/game/galaxy.js';
import { makeSystem, bodyPosAt } from '../../js/game/world.js';
import { findSite, groundRadius, surfaceNormal, isSolid } from '../../js/game/surface.js';
import { setHull, HULL } from '../../js/game/hull.js';
import { HULL_TYPES } from '../../js/models/hulls.js';

/**
 * Предельный уклон площадки NPC, рад. Строже, чем у игрока (0.35 в
 * js/game/landing.js): NPC садится не по ногам, а целиком в точку, и
 * стойки на склоне в 20° висели бы в воздухе с одной стороны.
 */
export const NPC_SLOPE = 0.2;

/** От края города площадка NPC не ближе этого, км. */
export const CITY_CLEAR = 1.5;

/** Сколько точек меряет «верх грунта» в круге вокруг NPC. */
const AREA_SAMPLES = 400;

const unit = (v) => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) return null;
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? { x: v[0] / l, y: v[1] / l, z: v[2] / l } : null;
};

const r9 = (v) => Math.round(v * 1e9) / 1e9;
const arr = (v) => [r9(v.x), r9(v.y), r9(v.z)];

// Две касательные в точке d (правая тройка): ими меряется круг вокруг неё.
function tangents(d) {
  const h = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let u = { x: h.y * d.z - h.z * d.y, y: h.z * d.x - h.x * d.z, z: h.x * d.y - h.y * d.x };
  const ul = Math.hypot(u.x, u.y, u.z);
  u = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
  const v = { x: d.y * u.z - d.z * u.y, y: d.z * u.x - d.x * u.z, z: d.x * u.y - d.y * u.x };
  return [u, v];
}

// Точка на угловом расстоянии ang от d, по азимуту az.
function around(d, u, v, ang, az) {
  const s = Math.sin(ang), c = Math.cos(ang);
  const x = d.x * c + (u.x * Math.cos(az) + v.x * Math.sin(az)) * s;
  const y = d.y * c + (u.y * Math.cos(az) + v.y * Math.sin(az)) * s;
  const z = d.z * c + (u.z * Math.cos(az) + v.z * Math.sin(az)) * s;
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}

export function makeOracle() {
  const worlds = new Map();
  let types = null;

  /** Система — та же сборка, что у игры при прилёте. */
  const worldOf = (id) => {
    if (!worlds.has(id)) {
      const sys = galaxy().systems.find((s) => s.id === id);
      worlds.set(id, sys ? makeSystem(sys) : null);
    }
    return worlds.get(id);
  };

  const bodyOf = (q) => {
    const w = worldOf(q.sys | 0);
    const b = w ? w.bodies.find((x) => x.id === (q.body | 0)) : null;
    return b && isSolid(b) ? b : null;
  };

  /**
   * Корпуса: высота центра над грунтом на стойках (gear), на брюхе
   * (clear), во сколько раз корпус крупнее того, под который рассчитаны
   * модули (k), и полуразмеры. Всё — из модели (js/game/hull.js).
   */
  const typesOf = () => {
    if (!types) {
      types = {};
      for (const code of HULL_TYPES) {
        setHull(code);
        types[code] = {
          gear: r9(HULL.gearClear), clear: r9(HULL.clear), k: r9(HULL.k),
          half: [r9(HULL.half.x), r9(HULL.half.y), r9(HULL.half.z)],
        };
      }
    }
    return { ok: true, types };
  };

  /**
   * Верх грунта в круге радиусом km вокруг точки: выше этого ни одна
   * гора не поднимается, и NPC, идущий над ним, ни во что не врежется.
   * Мерится выборкой — подсолнухом по кругу, — и тот, кто спрашивает,
   * держит запас: пик между двумя точками выборки бывает выше.
   */
  const area = (q) => {
    const b = bodyOf(q), d = unit(q.dir);
    if (!b || !d) return { ok: false };
    const span = Math.min(Math.max(Number(q.km) || 60, 1), 2000) / b.radius;
    const [u, v] = tangents(d);
    let top = groundRadius(b, d);
    for (let i = 0; i < AREA_SAMPLES; i++) {
      const p = around(d, u, v, span * Math.sqrt((i + 0.5) / AREA_SAMPLES), i * 2.399963);
      top = Math.max(top, groundRadius(b, p));
    }
    return { ok: true, r: b.radius, top: r9(top) };
  };

  /**
   * Площадка у точки: сухая и ровная, по той же findSite, которой
   * садится посадочный компьютер игрока. Не нашлась у самой точки —
   * ищем дальше, витком наружу: у берега океана ближайшая суша бывает
   * в десятке километров. И не в черте города: findSite про дома не
   * знает, а NPC на крыше квартала — это поломка, а не посадка.
   */
  const site = (q) => {
    const b = bodyOf(q), d = unit(q.dir);
    if (!b || !d) return { ok: false };
    const w = worldOf(q.sys | 0);
    const towns = w.cities.filter((c) => c.body === b);
    const inTown = (p) => towns.some((c) => {
      const cos = p.x * c.dir.x + p.y * c.dir.y + p.z * c.dir.z;
      return Math.acos(Math.max(-1, Math.min(1, cos))) * b.radius < c.radius + CITY_CLEAR;
    });
    const span = Math.min(Math.max(Number(q.span) || 3, 0.5), 20);
    const tries = Math.min(Math.max((q.tries | 0) || 16, 1), 64);
    const [u, v] = tangents(d);
    for (let i = 0; i < tries; i++) {
      const at = i === 0 ? d : around(d, u, v, (span * 2.2 * Math.sqrt(i)) / b.radius, i * 2.399963);
      const s = findSite(b, at, span);
      if (s.water || !(s.slope <= NPC_SLOPE) || inTown(s.dir)) continue;
      const dir = { x: s.dir.x, y: s.dir.y, z: s.dir.z };
      const n = surfaceNormal(b, dir);
      return { ok: true, dir: arr(dir), r: r9(groundRadius(b, dir)), n: arr(n), slope: r9(s.slope) };
    }
    return { ok: false };
  };

  function answer(q) {
    if (!q || typeof q !== 'object') return { ok: false, error: 'bad' };
    if (q.t === 'types') return typesOf();
    if (q.t === 'area') return area(q);
    if (q.t === 'site') return site(q);
    if (q.t === 'ground') {
      const b = bodyOf(q), d = unit(q.dir);
      return b && d ? { ok: true, r: r9(groundRadius(b, d)) } : { ok: false };
    }
    if (q.t === 'pos') {
      const w = worldOf(q.sys | 0);
      // Станции в мире лежат отдельным списком, не среди тел.
      const b = w ? w.bodies.concat(w.stations).find((x) => x.id === (q.body | 0)) : null;
      if (!b || !Number.isFinite(q.wt)) return { ok: false };
      return { ok: true, p: arr(bodyPosAt(b, q.wt)) };
    }
    if (q.t === 'ping') return { ok: true };
    return { ok: false, error: 'unknown' };
  }

  return { answer };
}

/** Сервер: строка JSON в ответ на строку JSON. */
function serve() {
  const oracle = makeOracle();
  const server = net.createServer((sock) => {
    sock.setNoDelay(true);
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let out;
        try {
          const q = JSON.parse(line);
          out = oracle.answer(q);
          if (q && q.id !== undefined) out.id = q.id;
        } catch (e) {
          out = { ok: false, error: String((e && e.message) || e) };
        }
        sock.write(JSON.stringify(out) + '\n');
      }
    });
    sock.on('error', () => { /* хаб ушёл посреди ответа — это его дело */ });
  });
  server.listen(0, '127.0.0.1', () => {
    process.stdout.write('ORACLE ' + server.address().port + '\n');
  });
  // Хаб закрыл наш stdin — значит, его больше нет.
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
  process.stdin.resume();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve();
