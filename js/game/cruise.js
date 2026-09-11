// Круизный ускоритель («torus drive»): множитель к перемещению корабля.
// Без него перелёт между планетами на 1.2 км/с занимал бы часы.
// Умножается только перемещение корабля — мировые часы идут в реальном
// темпе, поэтому планеты не начинают носиться по орбитам.
//
// Ускоритель глохнет рядом с крупным телом (mass lock) и автоматически
// ограничивается так, чтобы за один шаг физики нельзя было проскочить
// сквозь планету.

import { nearestBody } from './world.js';

export const LEVELS = [1, 10, 100, 1000, 10000, 50000];

export const makeCruise = () => ({
  index: 0,
  level: 1,
  massLocked: false,
  lockedBy: null,
  limitedTo: LEVELS.length - 1,
});

export const cruiseLabel = (level) => (level === 1 ? 'x1' : 'x' + level.toLocaleString('ru-RU'));

export function stepCruise(cruise, dir) {
  cruise.index = Math.max(0, Math.min(LEVELS.length - 1, cruise.index + dir));
}

export function resetCruise(cruise) {
  cruise.index = 0;
  cruise.level = 1;
}

/**
 * Пересчитать фактический множитель.
 * @param dt шаг физики (сек) — нужен для оценки длины шага
 */
export function updateCruise(cruise, world, ship, dt) {
  const { body, gap } = nearestBody(world, ship.pos);
  cruise.lockedBy = null;
  cruise.massLocked = false;

  // Mass lock: у планеты и станции ускоритель не работает.
  // Радиус блокировки заведомо меньше и высоты орбиты станции (0.45–0.75 R),
  // и радиуса, по которому автопилот обходит тела (1.7 R) — иначе корабль
  // оказывается запертым на 1.2 км/с там, где должен идти на круизе.
  const lockRange = Math.max(100, body ? body.radius * 0.25 + 100 : 100);
  if (body && gap < lockRange) {
    cruise.massLocked = true;
    cruise.lockedBy = body;
  }

  // Станции тоже глушат ускоритель, иначе можно проскочить порт.
  if (!cruise.massLocked) {
    for (const st of world.stations) {
      const d = Math.hypot(st.pos.x - ship.pos.x, st.pos.y - ship.pos.y, st.pos.z - ship.pos.z);
      if (d < 25) { cruise.massLocked = true; cruise.lockedBy = st; break; }
    }
  }

  let maxIndex = LEVELS.length - 1;
  if (cruise.massLocked) {
    // Не глухой ноль: x10 рядом с телом даёт возможность уйти, но всё
    // ещё не позволяет проскочить планету за один шаг физики.
    maxIndex = 1;
  } else {
    // Шаг перемещения не должен превышать пятую часть зазора до тела.
    const stepBudget = Math.max(1, gap * 0.15);
    const perStep = Math.max(1e-6, ship.speed * dt);
    while (maxIndex > 0 && LEVELS[maxIndex] * perStep > stepBudget) maxIndex--;
  }

  cruise.limitedTo = maxIndex;
  if (cruise.index > maxIndex) cruise.index = maxIndex;
  cruise.level = LEVELS[cruise.index];
  return cruise.level;
}
