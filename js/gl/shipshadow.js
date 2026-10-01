// Тень своего корабля: карта глубины от солнца.
//
// Раньше тень была отдельным предметом: силуэт корпуса проецировался на
// плоскость, натягивался на сетку 7×7 высот рельефа и рисовался тёмным
// листом, поднятым над грунтом — не меньше чем на 1.2 м, чтобы не тонуть
// в сетке плиток. С кресла, с четырнадцати метров, подъёма не видно; с
// роста человека глаз — на 1.66 м, и тень висела над землёй на уровне
// груди отдельной плоскостью. На кочках она к тому же то уходила под
// грунт, то висела, а камни, стойки шасси и трап в неё не попадали.
//
// Теперь тени как предмета нет. Корабль (корпус, стойки, створки и
// трапы) рисуется ГЛУБИНОЙ со стороны солнца в свою карту, а каждый
// пиксель всего, что освещено солнцем, — грунта, камней, растений,
// построек, трапа и самого корпуса — спрашивает её: закрыт ли он от
// солнца кораблём. Если закрыт, гаснет только прямой свет, рассеянный
// остаётся. Тень лежит ровно на том, что нарисовано, — на кочках, на
// камнях, на ступенях, — потому что это и есть та поверхность.
//
// Карта — прямоугольная проекция вдоль солнечного луча, с центром в
// корабле и полуразмером в его радиус (с запасом на трап и стойки): при
// 2048 точках это четыре сантиметра на точку. Глубина в ней — только в
// пределах корабля; всё, что дальше от солнца, считается «за ним» — так
// тень корабля в трёх километрах над землёй ложится на землю той же
// картой.

import { Q } from '../core/quality.js';

export const SHIP_SHADOW = {
  size: Q.shipShadow || 2048,   // сторона карты, точек
  maxAlt: 3,                    // км — выше тень на грунте уже не разглядеть
  pad: 0.004,                   // км — запас к радиусу корпуса (трап и стойки лежат внутри него)
  unit: 7,                      // блок текстур: 0–2 — грунт, 4–6 — кабина
  offset: 1.5,                  // точек карты — сдвиг по нормали
  bias: 1.5,                    // точек карты — запас по глубине
};

/**
 * Оси карты (мировые): f — куда идёт свет (от солнца), r и u — поперёк;
 * c — центр (корабль), h — полуразмер, км.
 */
export function shadowFrame(c, sunDir, h, out = { c: { x: 0, y: 0, z: 0 }, r: [0, 0, 0], u: [0, 0, 0], f: [0, 0, 0], h: 0 }) {
  const l = Math.hypot(sunDir.x, sunDir.y, sunDir.z) || 1;
  const f = out.f;
  f[0] = -sunDir.x / l; f[1] = -sunDir.y / l; f[2] = -sunDir.z / l;
  const hx = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const r = out.r, u = out.u;
  r[0] = hx[1] * f[2] - hx[2] * f[1]; r[1] = hx[2] * f[0] - hx[0] * f[2]; r[2] = hx[0] * f[1] - hx[1] * f[0];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1;
  r[0] /= rl; r[1] /= rl; r[2] /= rl;
  u[0] = f[1] * r[2] - f[2] * r[1]; u[1] = f[2] * r[0] - f[0] * r[2]; u[2] = f[0] * r[1] - f[1] * r[0];
  out.c.x = c.x; out.c.y = c.y; out.c.z = c.z;
  out.h = h;
  return out;
}

/** Мировая точка -> карта: (s, t) — место в ней, z — глубина; всё в [0, 1] внутри куба. */
export function shadowCoord(F, p, out = [0, 0, 0]) {
  const dx = p.x - F.c.x, dy = p.y - F.c.y, dz = p.z - F.c.z;
  const k = 0.5 / F.h;
  out[0] = (dx * F.r[0] + dy * F.r[1] + dz * F.r[2]) * k + 0.5;
  out[1] = (dx * F.u[0] + dy * F.u[1] + dz * F.u[2]) * k + 0.5;
  out[2] = (dx * F.f[0] + dy * F.f[1] + dz * F.f[2]) * k + 0.5;
  return out;
}

/**
 * Матрица для шейдера: точка В ОСЯХ КАМЕРЫ (км) -> карта. Считается в
 * double и только потом уходит во float32: перенос в ней — смещение
 * камеры от корабля, десятки метров, а не мировые координаты.
 */
export function shadowMatrix(F, cam, out = new Float32Array(16)) {
  const k = 0.5 / F.h;
  const b = cam.basis;
  const ax = [b.right, b.up, b.fwd];
  const dx = cam.pos.x - F.c.x, dy = cam.pos.y - F.c.y, dz = cam.pos.z - F.c.z;
  const rows = [F.r, F.u, F.f];
  for (let row = 0; row < 3; row++) {
    const L = rows[row];
    for (let col = 0; col < 3; col++) {
      const a = ax[col];
      out[col * 4 + row] = (a.x * L[0] + a.y * L[1] + a.z * L[2]) * k;
    }
    out[12 + row] = (dx * L[0] + dy * L[1] + dz * L[2]) * k + 0.5;
  }
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}

/** Радиус корпуса (км) — по вершинам модели. */
export function hullRadius(mesh) {
  let r = 0;
  for (const v of mesh.verts) r = Math.max(r, Math.hypot(v.x, v.y, v.z));
  return r;
}

// --- шейдеры -------------------------------------------------------------------

/**
 * Проход глубины. Атрибут места стоит на том же номере, что у общей
 * программы сеток: корпус, стойки и трапы рисуются своими же буферами.
 */
export const depthVs = (posLoc) => `#version 300 es
layout(location = ${posLoc}) in vec3 aPos;
uniform mat4 uModelView;   // модель -> оси карты, км от корабля
uniform float uInvH;       // 1 / полуразмер карты
void main() {
  vec4 v = uModelView * vec4(aPos, 1.0);
  gl_Position = vec4(v.xyz * uInvH, 1.0);
}`;

export const DEPTH_FS = `#version 300 es
precision highp float;
void main() {}`;

const f = (x) => { const s = String(x); return s.includes('.') ? s : s + '.0'; };

/**
 * Выборка во фрагментном шейдере сеток (MESH_FS). Четыре выборки со
 * сравнением, каждая сама сглажена билинейно: край тени — в две-три
 * точки карты, около десяти сантиметров, как полутень от солнца в
 * полградуса на десятке метров. Точка отодвигается по нормали — иначе
 * освещённая поверхность «затеняет сама себя» рябью.
 */
export const SHIP_SHADOW_GLSL = `
uniform float uShipShadowOn;
uniform highp sampler2DShadow uShipShadow;
uniform mat4 uShipShadowMat;    // оси камеры (км) -> карта
uniform vec2 uShipShadowK;      // точка карты: в долях карты и в км
float shipShadowAt(vec3 p, vec3 n) {
  vec3 s = (uShipShadowMat * vec4(p + n * (uShipShadowK.y * ${f(SHIP_SHADOW.offset)}), 1.0)).xyz;
  if (s.x <= 0.0 || s.y <= 0.0 || s.x >= 1.0 || s.y >= 1.0 || s.z <= 0.0) return 1.0;
  // Дальше куба — «за кораблём»: глубина упирается в его заднюю стенку.
  float r = min(s.z, 1.0) - uShipShadowK.x * ${f(SHIP_SHADOW.bias)};
  float t = uShipShadowK.x * 0.75;
  return 0.25 * (texture(uShipShadow, vec3(s.xy + vec2(-t, -t), r))
               + texture(uShipShadow, vec3(s.xy + vec2( t, -t), r))
               + texture(uShipShadow, vec3(s.xy + vec2(-t,  t), r))
               + texture(uShipShadow, vec3(s.xy + vec2( t,  t), r)));
}
`;

// --- карта ----------------------------------------------------------------------

/**
 * Текстура глубины со сравнением и её кадровый буфер. Не собрался буфер
 * (нет нужного формата) — тени нет, сцена остаётся рабочей.
 */
export function makeShadowTarget(gl, size) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  if (!ok) { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); return null; }
  return { tex, fbo, size };
}
