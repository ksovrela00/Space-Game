// Рабочий поток сборки дальнего леса.
//
// Тонкая оболочка вокруг js/gl/forest.js, как tileworker у плиток: вся
// работа там, здесь приём задания и отправка массива без копирования.
// Кусок стоит полтора-два десятка миллисекунд счёта — рельеф, густота и
// высота грунта под каждым деревом, — а на круг их две с лишним сотни:
// в кадре это были бы секунды заиканий.

import { forestChunk } from './forest.js';

// Рельеф строится один раз на тело: makeTerrain собирает замыкания и
// таблицы, и на каждый кусок это заметные деньги.
const bodies = new Map();

export function runForestJob(msg) {
  const key = msg.spec.id + '/' + msg.spec.name;
  let body = bodies.get(key);
  if (!body) { body = { ...msg.spec }; bodies.set(key, body); }
  const ch = forestChunk(body, msg.face, msg.bi, msg.bj);
  return { id: msg.id, gen: msg.gen, key: msg.key, chunk: ch };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e) => {
    const out = runForestJob(e.data);
    self.postMessage(out, [out.chunk.inst.buffer]);
  };
}
