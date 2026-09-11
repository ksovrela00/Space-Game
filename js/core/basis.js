// Ориентация тела — тройка ортонормированных векторов (right, up, fwd).
// Правая система координат: fwd = cross(right, up), up = cross(fwd, right).
// Углы Эйлера не храним, поэтому нет gimbal lock; накопленную ошибку
// вычислений убирает ортонормализация Грама–Шмидта каждый кадр.

import { v3, set, copy, dot, cross, normalize, rotateAxis } from './vec3.js';

export const makeBasis = () => ({
  right: v3(1, 0, 0),
  up: v3(0, 1, 0),
  fwd: v3(0, 0, 1),
});

export const copyBasis = (dst, src) => {
  copy(dst.right, src.right);
  copy(dst.up, src.up);
  copy(dst.fwd, src.fwd);
  return dst;
};

// fwd считаем эталоном, остальные оси подтягиваем к нему.
export const orthonormalize = (b) => {
  normalize(b.fwd, b.fwd);
  const d = dot(b.right, b.fwd);
  set(b.right,
    b.right.x - b.fwd.x * d,
    b.right.y - b.fwd.y * d,
    b.right.z - b.fwd.z * d);
  normalize(b.right, b.right);
  cross(b.fwd, b.right, b.up); // cross(z, x) = y
  return b;
};

const _tmp = v3();

const rotAll = (b, axis, ang) => {
  if (Math.abs(ang) < 1e-12) return;
  rotateAxis(b.right, axis, ang, _tmp); copy(b.right, _tmp);
  rotateAxis(b.up, axis, ang, _tmp); copy(b.up, _tmp);
  rotateAxis(b.fwd, axis, ang, _tmp); copy(b.fwd, _tmp);
};

// pitch > 0 — нос вверх, yaw > 0 — нос вправо, roll > 0 — крен вправо.
// Оси берём до поворота, иначе три поворота начнут влиять друг на друга.
export const rotateBasis = (b, pitch, yaw, roll) => {
  const right = { x: b.right.x, y: b.right.y, z: b.right.z };
  const up = { x: b.up.x, y: b.up.y, z: b.up.z };
  const fwd = { x: b.fwd.x, y: b.fwd.y, z: b.fwd.z };
  if (pitch) rotAll(b, right, -pitch);
  if (yaw) rotAll(b, up, yaw);
  if (roll) rotAll(b, fwd, -roll);
  return orthonormalize(b);
};

// Мир -> локальные координаты тела.
export const toLocal = (b, origin, p, out = v3()) => {
  const dx = p.x - origin.x, dy = p.y - origin.y, dz = p.z - origin.z;
  return set(out,
    dx * b.right.x + dy * b.right.y + dz * b.right.z,
    dx * b.up.x + dy * b.up.y + dz * b.up.z,
    dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z);
};

// Локальные координаты -> мир.
export const toWorld = (b, origin, p, out = v3()) => set(out,
  origin.x + b.right.x * p.x + b.up.x * p.y + b.fwd.x * p.z,
  origin.y + b.right.y * p.x + b.up.y * p.y + b.fwd.y * p.z,
  origin.z + b.right.z * p.x + b.up.z * p.y + b.fwd.z * p.z);

// Поворот направления без сдвига (локальное -> мировое).
export const dirToWorld = (b, p, out = v3()) => set(out,
  b.right.x * p.x + b.up.x * p.y + b.fwd.x * p.z,
  b.right.y * p.x + b.up.y * p.y + b.fwd.y * p.z,
  b.right.z * p.x + b.up.z * p.y + b.fwd.z * p.z);

// Базис, смотрящий вдоль dir; up подбирается автоматически.
export const lookAlong = (b, dir, hintUp = null) => {
  normalize(dir, b.fwd);
  const up = hintUp || (Math.abs(b.fwd.y) > 0.98 ? v3(0, 0, 1) : v3(0, 1, 0));
  cross(up, b.fwd, b.right); // cross(y, z) = x
  if (Math.hypot(b.right.x, b.right.y, b.right.z) < 1e-6) set(b.right, 1, 0, 0);
  normalize(b.right, b.right);
  cross(b.fwd, b.right, b.up);
  return b;
};

// Углы, на которые надо развернуть тело, чтобы нос смотрел на dir.
// Возвращает {pitch, yaw} в радианах — этим кормится автопилот.
export const aimAngles = (b, dirWorld) => {
  const d = normalize(dirWorld, v3());
  const x = dot(d, b.right);
  const y = dot(d, b.up);
  const z = dot(d, b.fwd);
  return { pitch: Math.atan2(y, Math.hypot(x, z)), yaw: Math.atan2(x, z) };
};
