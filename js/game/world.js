// Звёздная система: светило, планеты на круговых орбитах, луны и станции.
// Всё генерируется из seed, поэтому система одинакова между запусками.
//
// Два сознательных отступления от реальных масштабов:
//   * орбиты сжаты до 0.3–4 млн км — иначе перелёт занимал бы часы даже
//     на круизном ускорителе;
//   * орбитальные периоды огромны (годы), поэтому тела идут по орбитам
//     медленно — единицы метров в секунду.
//
// Рядом с телом корабль всё равно переносится вместе с ним (см.
// js/game/gravity.js): и орбитальное движение, и суточное вращение у
// поверхности скомпенсированы, иначе «зависнуть над точкой» нельзя было
// бы в принципе.

import { v3, normalize, cross } from '../core/vec3.js';
import { makeRng, makeName, ROMAN } from '../core/rng.js';
import { setGravity } from './gravity.js';
import { STATION_R } from '../models/station.js';

const TAU = Math.PI * 2;

// Плоскость орбиты с небольшим наклоном к эклиптике (XZ).
const orbitPlane = (rng) => {
  const inc = rng.range(-0.06, 0.06);
  const node = rng.range(0, TAU);
  const A = normalize(v3(Math.cos(node), 0, Math.sin(node)));
  const up = normalize(v3(Math.sin(inc) * Math.sin(node), Math.cos(inc), -Math.sin(inc) * Math.cos(node)));
  const B = normalize(cross(up, A));
  return { A, B, up };
};

const spinFrame = (rng) => {
  const tilt = rng.range(0.02, 0.5);
  const dir = rng.range(0, TAU);
  const pole = normalize(v3(Math.sin(tilt) * Math.cos(dir), Math.cos(tilt), Math.sin(tilt) * Math.sin(dir)));
  let ref = normalize(cross(pole, v3(0, 0, 1)));
  if (!isFinite(ref.x) || Math.hypot(ref.x, ref.y, ref.z) < 0.1) ref = normalize(cross(pole, v3(1, 0, 0)));
  const side = normalize(cross(pole, ref));
  return { pole, eqRef: ref, eqSide: side };
};

const jitter = (rng, c, amt) => [
  Math.max(0, Math.min(255, c[0] + rng.range(-amt, amt))),
  Math.max(0, Math.min(255, c[1] + rng.range(-amt, amt))),
  Math.max(0, Math.min(255, c[2] + rng.range(-amt, amt))),
];

// --- Процедурная поверхность: набор «пятен» (lat, lon, size, color) ---------

const spots = (rng, n, latRange, sizeRange, color, colorJit = 22) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      lat: rng.range(-latRange, latRange),
      lon: rng.range(0, TAU),
      size: rng.range(sizeRange[0], sizeRange[1]),
      color: jitter(rng, color, colorJit),
    });
  }
  return out;
};

const caps = (rng, size, color) => ([
  { lat: 1.45, lon: 0, size, color },
  { lat: -1.45, lon: Math.PI, size: size * 0.85, color },
]);

// Полосы газового гиганта — ряды пятен по широте.
const bands = (rng, colors) => {
  const out = [];
  const rows = rng.int(5, 8);
  for (let r = 0; r < rows; r++) {
    const lat = -1.2 + (r + rng.range(0.2, 0.8)) * (2.4 / rows);
    const color = jitter(rng, colors[r % colors.length], 14);
    const size = rng.range(0.14, 0.26);
    const count = Math.max(10, Math.round(26 * Math.cos(lat) + 6));
    for (let i = 0; i < count; i++) {
      out.push({
        lat: lat + rng.range(-0.04, 0.04),
        lon: (i / count) * TAU + rng.range(-0.05, 0.05),
        size,
        color,
      });
    }
  }
  return out;
};

const PALETTE = {
  lava: { base: [96, 62, 54], spot: [214, 92, 40], atmo: null },
  rock: { base: [128, 116, 104], spot: [92, 82, 74], atmo: null },
  desert: { base: [186, 150, 104], spot: [150, 112, 74], atmo: [214, 178, 130] },
  ocean: { base: [46, 88, 156], spot: [78, 132, 84], atmo: [120, 180, 255] },
  ice: { base: [186, 208, 224], spot: [226, 240, 250], atmo: [180, 220, 255] },
  gas: { base: [176, 148, 112], spot: [140, 112, 84], atmo: [214, 190, 150] },
  moon: { base: [138, 138, 142], spot: [104, 104, 110], atmo: null },
};

const makeSurface = (rng, kind) => {
  const p = PALETTE[kind] || PALETTE.rock;
  let features = [];
  switch (kind) {
    case 'ocean':
      features = spots(rng, rng.int(7, 11), 1.15, [0.20, 0.42], p.spot, 26)
        .concat(caps(rng, 0.34, [236, 244, 252]))
        .concat(spots(rng, 10, 1.1, [0.10, 0.20], [250, 250, 255], 4));
      break;
    case 'gas':
      features = bands(rng, [[196, 168, 128], [150, 120, 92], [212, 190, 150], [128, 100, 78]]);
      features.push({ lat: rng.range(-0.5, 0.5), lon: rng.range(0, TAU), size: 0.20, color: [206, 108, 74] });
      break;
    case 'ice':
      features = spots(rng, rng.int(12, 18), 1.3, [0.12, 0.30], p.spot, 12)
        .concat(caps(rng, 0.42, [246, 252, 255]));
      break;
    case 'lava':
      features = spots(rng, rng.int(14, 20), 1.2, [0.10, 0.26], p.spot, 30);
      break;
    default:
      features = spots(rng, rng.int(12, 20), 1.25, [0.12, 0.34], p.spot, 20);
      if (kind === 'desert') features = features.concat(caps(rng, 0.20, [230, 235, 240]));
  }
  return { color: jitter(rng, p.base, 10), atmo: p.atmo, features };
};

// --- Тела --------------------------------------------------------------------

let nextId = 1;

const makeBody = (rng, opts) => {
  const surf = makeSurface(rng, opts.kind);
  const frame = spinFrame(rng);
  return {
    id: nextId++,
    kind: opts.kind,
    name: opts.name,
    radius: opts.radius,
    color: surf.color,
    atmo: surf.atmo,
    features: surf.features,
    pole: frame.pole,
    eqRef: frame.eqRef,
    eqSide: frame.eqSide,
    spin: TAU / opts.spinPeriod,
    spinPhase: rng.range(0, TAU),
    rings: opts.rings || null,
    orbit: opts.orbit || null,
    parent: opts.parent || null,
    station: null,
    moons: [],
    pos: v3(),
    vel: v3(),
    isBody: true,
  };
};

const makeStation = (rng, planet, name) => {
  const alt = planet.radius * rng.range(0.45, 0.75);
  const plane = orbitPlane(rng);
  return {
    id: nextId++,
    kind: 'station',
    name,
    parent: planet,
    radius: STATION_R,
    orbit: {
      radius: planet.radius + alt,
      period: rng.range(1.5e7, 2.5e7),
      phase: rng.range(0, TAU),
      A: plane.A,
      B: plane.B,
      up: plane.up,
    },
    spinRate: TAU / rng.range(70, 96),   // оборот за ~80 секунд
    spinPhase: rng.range(0, TAU),
    pos: v3(),
    vel: v3(),
    // Базис: fwd — ось порта (наружу от планеты), right/up вращаются
    basis: { right: v3(1, 0, 0), up: v3(0, 1, 0), fwd: v3(0, 0, 1) },
    isStation: true,
  };
};

// --- Система -----------------------------------------------------------------

export function makeSystem(seed = 0x1a7e) {
  const rng = makeRng(seed);
  nextId = 1;

  const systemName = 'Lave';
  const star = makeBody(rng, {
    kind: 'star',
    name: systemName,
    radius: 62000,
    spinPeriod: 1e6,
  });
  star.color = [255, 226, 168];
  star.features = null;
  star.atmo = null;

  const layout = [
    { kind: 'lava', r: 1900, orbit: 340000, station: false },
    { kind: 'ocean', r: 4200, orbit: 620000, station: true, home: true },
    { kind: 'desert', r: 3400, orbit: 1020000, station: true },
    { kind: 'rock', r: 2600, orbit: 1580000, station: false },
    { kind: 'gas', r: 8200, orbit: 2420000, station: true, rings: true, moons: 2 },
    { kind: 'ice', r: 3000, orbit: 3600000, station: false, moons: 1 },
  ];

  const planets = [];
  let home = null;

  layout.forEach((L, i) => {
    const plane = orbitPlane(rng);
    const p = makeBody(rng, {
      kind: L.kind,
      name: `${systemName} ${ROMAN[i]}`,
      radius: L.r,
      // Период суток привязан к радиусу: скорость поверхности выходит
      // 0.1–0.3 км/с, как у настоящих планет. Раньше периоды были в сотни
      // раз короче — вращение красиво читалось с орбиты, но поверхность
      // при этом «ехала» со скоростью в десятки км/с, и сесть на неё было
      // физически невозможно (см. js/game/landing.js).
      spinPeriod: L.r * rng.range(20, 60),
      parent: star,
      orbit: {
        radius: L.orbit,
        period: rng.range(1.5e9, 4.0e9) * (1 + i * 0.6),
        phase: rng.range(0, TAU),
        A: plane.A,
        B: plane.B,
      },
      rings: L.rings ? {
        inner: 1.4, outer: 2.3,
        color: jitter(rng, [206, 186, 150], 10),
      } : null,
    });

    if (L.station) {
      p.station = makeStation(rng, p, `${makeName(rng)} Station`);
      p.station.planetName = p.name;
    }

    for (let m = 0; m < (L.moons || 0); m++) {
      const mplane = orbitPlane(rng);
      const mr = p.radius * rng.range(0.16, 0.30);
      const moon = makeBody(rng, {
        kind: 'moon',
        name: `${p.name}${String.fromCharCode(97 + m)}`,
        radius: mr,
        spinPeriod: mr * rng.range(25, 80),
        parent: p,
        orbit: {
          radius: p.radius * rng.range(3.5, 7),
          period: rng.range(6.0e7, 1.2e8),
          phase: rng.range(0, TAU),
          A: mplane.A,
          B: mplane.B,
        },
      });
      p.moons.push(moon);
    }

    if (L.home) home = p;
    planets.push(p);
  });

  const world = {
    name: systemName,
    seed,
    time: 0,
    star,
    planets,
    home,
    entities: [],          // сюда позже лягут NPC-корабли и снаряды
    bodies: [],            // плоский список тел для рендера и навигации
    stations: [],
  };

  world.bodies.push(star);
  for (const p of planets) {
    world.bodies.push(p);
    for (const m of p.moons) world.bodies.push(m);
    if (p.station) world.stations.push(p.station);
  }

  // Гравитация: масса из плотности и радиуса, радиус захвата — из массы
  // и массы хозяина. Порядок важен: сфера действия планеты считается по
  // массе светила, луны — по массе планеты.
  for (const b of world.bodies) setGravity(b);

  updateWorld(world, 0);
  return world;
}

const _prev = v3();
const _P = v3();

// Пересчёт позиций. dt нужен только для оценки скоростей тел
// (станция движется по орбите, и корабль после стыковки летит вместе с ней).
export function updateWorld(world, dt) {
  world.time += dt;
  const t = world.time;

  const place = (b) => {
    if (!b.orbit) return;
    _prev.x = b.pos.x; _prev.y = b.pos.y; _prev.z = b.pos.z;
    const o = b.orbit;
    const a = o.phase + (t / o.period) * TAU;
    const ca = Math.cos(a) * o.radius, sa = Math.sin(a) * o.radius;
    const c = b.parent ? b.parent.pos : { x: 0, y: 0, z: 0 };
    b.pos.x = c.x + o.A.x * ca + o.B.x * sa;
    b.pos.y = c.y + o.A.y * ca + o.B.y * sa;
    b.pos.z = c.z + o.A.z * ca + o.B.z * sa;
    if (dt > 0) {
      b.vel.x = (b.pos.x - _prev.x) / dt;
      b.vel.y = (b.pos.y - _prev.y) / dt;
      b.vel.z = (b.pos.z - _prev.z) / dt;
    }
  };

  for (const p of world.planets) {
    place(p);
    p.spinPhase = (p.spinPhase + p.spin * dt) % TAU;
    for (const m of p.moons) {
      place(m);
      m.spinPhase = (m.spinPhase + m.spin * dt) % TAU;
    }
    if (p.station) {
      const s = p.station;
      place(s);
      s.spinPhase = (s.spinPhase + s.spinRate * dt) % TAU;
      // Ось порта — наружу от планеты; right/up катятся вокруг неё.
      // Оси вращения берём перпендикулярными оси порта: нормаль орбиты
      // (Q) и направление по орбите (P). Оси самой орбитальной плоскости
      // (A, B) для этого не годятся — радиальное направление лежит в ней,
      // и при некоторых фазах right вырождался в ноль и переворачивался.
      const f = s.basis.fwd;
      normalize(v3(s.pos.x - p.pos.x, s.pos.y - p.pos.y, s.pos.z - p.pos.z), f);
      const Q = s.orbit.up;
      const P = normalize(cross(Q, f), _P);
      const cs = Math.cos(s.spinPhase), sn = Math.sin(s.spinPhase);
      normalize(v3(
        P.x * cs + Q.x * sn,
        P.y * cs + Q.y * sn,
        P.z * cs + Q.z * sn), s.basis.right);
      cross(f, s.basis.right, s.basis.up);
    }
  }
}

/**
 * Локальный базис тела: y (up) — ось вращения, поворот вокруг неё —
 * суточное вращение. Меш поверхности статичен, всё вращение живёт в этой
 * матрице. Этим же базисом игровая логика переводит мировые координаты в
 * «широту-долготу» тела (js/game/surface.js).
 */
export function bodyBasis(body, out) {
  const p = body.pole, a = body.eqRef, s = body.eqSide;
  const c = Math.cos(body.spinPhase), sn = Math.sin(body.spinPhase);
  // right = eqRef, повёрнутый вокруг полюса; up = полюс.
  out.right.x = a.x * c + s.x * sn;
  out.right.y = a.y * c + s.y * sn;
  out.right.z = a.z * c + s.z * sn;
  out.up.x = p.x; out.up.y = p.y; out.up.z = p.z;
  // fwd = right x up (правая тройка, как и у камеры)
  out.fwd.x = out.right.y * p.z - out.right.z * p.y;
  out.fwd.y = out.right.z * p.x - out.right.x * p.z;
  out.fwd.z = out.right.x * p.y - out.right.y * p.x;
  return out;
}

// Ближайшее крупное тело — для mass lock и проверки столкновений.
export function nearestBody(world, pos) {
  let best = null, bestGap = Infinity;
  for (const b of world.bodies) {
    const gap = Math.hypot(pos.x - b.pos.x, pos.y - b.pos.y, pos.z - b.pos.z) - b.radius;
    if (gap < bestGap) { bestGap = gap; best = b; }
  }
  return { body: best, gap: bestGap };
}
