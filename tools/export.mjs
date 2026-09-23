// Выгрузка каталога для сервера: галактика, тела систем, корабль и модули.
//
// Зачем это нужно и почему выгрузка, а не вторая копия логики в PHP.
// Сервер обязан быть хозяином каталога — в онлайне верить клиенту в том,
// где стоит планета, нельзя. Но генератор мира уже написан и вылизан
// (js/game/galaxy.js + js/game/world.js), и переписывать его на PHP
// значило бы завести вторую правду: две реализации одного шума
// разъезжаются на третьем знаке и молча дают РАЗНЫЕ миры у клиента и
// сервера. Поэтому источник остаётся один, а база — его слепок.
//
// Рядом с каждой системой лежит её seed: пока генератор общий, любой
// клиент может собрать ту же систему сам, а сервер — проверить.
//
//   node tools/export.mjs [файл]     по умолчанию server/data/catalog.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { galaxy } from '../js/game/galaxy.js';
import { makeSystem } from '../js/game/world.js';
import { isLandable } from '../js/game/surface.js';
import { HULL_SIZE } from '../js/models/ships.js';

const out = process.argv[2] || 'server/data/catalog.json';

// Числа режем до разумной точности: орбита в 4 млн км с пятнадцатью
// знаками после запятой — это не точность, а мусор в файле и в базе.
const num = (v, digits = 6) => (v === null || v === undefined ? null : Number(v.toFixed(digits)));
const vec = (v) => (v ? [num(v.x, 9), num(v.y, 9), num(v.z, 9)] : null);

const bodyRow = (b, kind, parentLocalId, isHome = false) => ({
  localId: b.id,
  parentLocalId,
  kind,
  // Вид тела из игры (lava/ocean/gas/...): роль в системе и вид — разные
  // вещи, и терять вид нельзя, на нём будет стоять рынок.
  type: b.kind,
  name: b.name,
  radiusKm: num(b.radius, 3),
  orbitRadiusKm: b.orbit ? num(b.orbit.radius, 3) : null,
  orbitPeriodS: b.orbit ? num(b.orbit.period, 3) : null,
  orbitPhase: b.orbit ? num(b.orbit.phase, 9) : null,
  // Плоскость орбиты — два вектора: без них тело встанет в другое место,
  // и «станция на дальней стороне» окажется не там.
  orbitPlane: b.orbit ? { A: vec(b.orbit.A), B: vec(b.orbit.B) } : null,
  spinPeriodS: b.spin ? num((Math.PI * 2) / b.spin, 3) : null,
  pressBar: num(b.press || 0, 4),
  hasRings: !!b.rings,
  hasStation: !!b.station,
  // Обжитой мир системы: с него игра начинается, и его порт — точка
  // появления нового пилота. Без этой отметки серверу пришлось бы
  // угадывать её по виду планеты.
  isHomeWorld: isHome,
  landable: kind === 'planet' || kind === 'moon' ? isLandable(b) : false,
});

const g = galaxy();
const systems = [];

for (const sys of g.systems) {
  // Система собирается ровно так же, как при прибытии в игре: тем же
  // вызовом и тем же seed. Иначе слепок описывал бы не тот мир, в
  // который прилетит игрок.
  const world = makeSystem(sys);
  const bodies = [];

  bodies.push(bodyRow(world.star, 'star', null));
  for (const p of world.planets) {
    bodies.push(bodyRow(p, 'planet', world.star.id, p === world.home));
    for (const m of p.moons) bodies.push(bodyRow(m, 'moon', p.id));
    if (p.station) bodies.push(bodyRow(p.station, 'station', p.id));
  }

  systems.push({
    id: sys.id,
    seed: sys.seed,
    name: sys.name,
    home: !!sys.home,
    starClass: sys.cls.id,
    luminosity: sys.cls.lum,
    starRadiusKm: sys.cls.radius,
    starTempK: sys.cls.temp,
    habitableKm: num(sys.hab, 3),
    pos: { x: num(sys.pos.x, 4), y: num(sys.pos.y, 4), z: num(sys.pos.z, 4) },
    bodies,
  });
}

const catalog = {
  version: 1,
  generatedAt: new Date().toISOString(),
  galaxySeed: g.seed,
  // ГАБАРИТЫ корпуса, и только они: остальные числа корабля — урон,
  // скорость, щит, цена — живут в бэкенде (server/data/specs.php) и
  // выгружать их отсюда нечего. Габариты же диктует сам меш: сменили
  // модель — поменялись сами, и вписать их руками значило бы завести
  // второй ответ на вопрос, какой корабль длины.
  shipTypes: [{
    code: 'challenger',
    lengthM: num(HULL_SIZE.z * 1000, 1),
    widthM: num(HULL_SIZE.x * 1000, 1),
    heightM: num(HULL_SIZE.y * 1000, 1),
  }],
  systems,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(catalog, null, 1), 'utf8');

const bodies = systems.reduce((a, s) => a + s.bodies.length, 0);
const stations = systems.reduce((a, s) => a + s.bodies.filter((b) => b.kind === 'station').length, 0);
console.log(`каталог выгружен: ${out}`);
console.log(`  систем ${systems.length}, тел ${bodies} (станций ${stations}),`
  + ` габаритов корпусов ${catalog.shipTypes.length}`);
