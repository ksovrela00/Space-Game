// Рабочий поток сборки плиток.
//
// Тонкая оболочка вокруг js/gl/tilegeo.js: вся работа там, здесь только
// приём задания и отправка буферов. Логика вынесена в runJob, чтобы её
// можно было проверить обычным тестом, не поднимая поток.

import { buildTileGeo, geoToTransfer } from './tilegeo.js';

// Рельеф считается один раз на тело и переиспользуется: makeTerrain
// строит замыкания и таблицы, и на каждую плитку это заметные деньги.
const bodies = new Map();

export function runJob(msg) {
  const key = msg.spec.id + '/' + msg.spec.name;
  let body = bodies.get(key);
  if (!body) { body = { ...msg.spec }; bodies.set(key, body); }
  const geo = buildTileGeo(body, msg.t);
  // Номер поколения возвращается как есть: по нему главный поток
  // отличает ответ на свой заказ от ответа про уже покинутое тело.
  return { id: msg.id, key: msg.key, gen: msg.gen, geo: geoToTransfer(geo) };
}

/** Буферы, которые уезжают без копирования. */
export const transferList = (out) => [
  out.geo.positions, out.geo.normals, out.geo.colors, out.geo.uv, out.geo.indices,
];

// В обычном модуле self отсутствует — файл просто импортируется как
// библиотека (так его и проверяют тесты).
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e) => {
    const out = runJob(e.data);
    self.postMessage(out, transferList(out));
  };
}
