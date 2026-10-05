// Камера вездехода от третьего лица: облёт вокруг машины мышью.
//
// Как в обычных играх с машинами: мышь водит камеру вокруг вездехода без
// зажатой кнопки (мышь захвачена, js/core/input.js), а когда её оставили в
// покое и машина едет — камера сама возвращается за спину. Стоит машина —
// не возвращается: тогда её осматривают.
//
// Камера кораблей (js/game/chase.js) сюда не годится: она уходит под брюхо
// у грунта, сносится от тяги и дрожит от двигателей — у вездехода нет ни
// брюха над землёй, ни тяги, ни двигателей.
//
// Числа здесь — не числа корабля, а настройка вида, как у CHASE.

export const DRIVECAM = {
  dist: 12,            // м — до середины машины
  aim: 1.6,            // м — точка, на которую смотрит камера, над грунтом
  pitch: 0.3,          // рад — наклон по умолчанию (сверху)
  pitchMin: -0.12,     // рад — ниже — почти у самого грунта
  pitchMax: 1.2,       // рад — почти сверху
  look: 0.0035,        // рад на точку мыши
  idle: 1.8,           // с — сколько мышь не трогали, прежде чем камера пойдёт за спину
  back: 1.6,           // 1/с — как быстро она уходит за спину
  // м — над грунтом под камерой не ниже этого. Не меньше ближней плоскости
  // сцены (4 м, js/gl/scene.js, NEAR) с запасом: камера ниже неё теряла
  // грунт из кадра целиком — одно небо (снимок rover).
  over: 4.5,
};

export function makeDriveCam() {
  return { yaw: 0, pitch: DRIVECAM.pitch, idle: DRIVECAM.idle };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Шаг облёта: сдвиг мыши (точки) крутит камеру; без мыши и на ходу она
 * идёт за спину. speed — скорость машины, м/с.
 */
export function stepDriveCam(c, look, speed, dt, k = 1) {
  const moved = Math.abs(look.x) + Math.abs(look.y) > 0;
  c.yaw = wrap(c.yaw + look.x * DRIVECAM.look * k);
  c.pitch = Math.max(DRIVECAM.pitchMin, Math.min(DRIVECAM.pitchMax, c.pitch + look.y * DRIVECAM.look * k));
  c.idle = moved ? 0 : c.idle + dt;
  if (c.idle > DRIVECAM.idle && Math.abs(speed) > 1.5) {
    // Едет назад — за спину значит смотреть вперёд по ходу, то есть за корму.
    const want = speed < 0 ? Math.PI : 0;
    const f = 1 - Math.exp(-DRIVECAM.back * dt);
    c.yaw = wrap(c.yaw + wrap(want - c.yaw) * f);
  }
  return c;
}

/**
 * Где камера: позади машины на dist под углом pitch, повёрнутая на yaw
 * вокруг её «вверх». Всё в осях машины, м: [x, y, z] — глаз, и точка, на
 * которую он смотрит.
 */
export function driveCamLocal(c, out = { eye: [0, 0, 0], at: [0, 0, 0] }) {
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
  out.at[0] = 0; out.at[1] = DRIVECAM.aim; out.at[2] = 0;
  out.eye[0] = -sy * cp * DRIVECAM.dist;
  out.eye[1] = DRIVECAM.aim + sp * DRIVECAM.dist;
  out.eye[2] = -cy * cp * DRIVECAM.dist;
  return out;
}
