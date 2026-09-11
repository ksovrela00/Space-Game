// Минимальная векторная математика. Все функции принимают необязательный out,
// чтобы в горячих циклах (трансформ вершин) не плодить объекты.

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });

export const set = (o, x, y, z) => { o.x = x; o.y = y; o.z = z; return o; };
export const copy = (o, a) => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };
export const clone = (a) => ({ x: a.x, y: a.y, z: a.z });

export const add = (a, b, out = v3()) => set(out, a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b, out = v3()) => set(out, a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a, s, out = v3()) => set(out, a.x * s, a.y * s, a.z * s);
export const neg = (a, out = v3()) => set(out, -a.x, -a.y, -a.z);

// a + b * s — самая частая операция в интеграторе
export const addMul = (a, b, s, out = v3()) =>
  set(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);

export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a, b, out = v3()) => set(out,
  a.y * b.z - a.z * b.y,
  a.z * b.x - a.x * b.z,
  a.x * b.y - a.y * b.x);

export const len2 = (a) => a.x * a.x + a.y * a.y + a.z * a.z;
export const len = (a) => Math.sqrt(len2(a));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2 = (a, b) => {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};

export const normalize = (a, out = v3()) => {
  const l = len(a);
  return l > 1e-12 ? mul(a, 1 / l, out) : set(out, 0, 0, 0);
};

export const lerp = (a, b, t, out = v3()) => set(out,
  a.x + (b.x - a.x) * t,
  a.y + (b.y - a.y) * t,
  a.z + (b.z - a.z) * t);

// Поворот вокруг произвольной единичной оси (формула Родрига).
export const rotateAxis = (v, axis, ang, out = v3()) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  const d = dot(axis, v) * (1 - c);
  const cx = axis.y * v.z - axis.z * v.y;
  const cy = axis.z * v.x - axis.x * v.z;
  const cz = axis.x * v.y - axis.y * v.x;
  return set(out,
    v.x * c + cx * s + axis.x * d,
    v.y * c + cy * s + axis.y * d,
    v.z * c + cz * s + axis.z * d);
};

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const mix = (a, b, t) => a + (b - a) * t;

// Плавное «доведение» значения к цели, независимое от частоты кадров.
export const approach = (cur, target, rate, dt) =>
  cur + (target - cur) * (1 - Math.exp(-rate * dt));
