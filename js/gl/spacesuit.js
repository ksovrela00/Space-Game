// Люди в кадре: пилоты в скафандрах (js/models/spacesuit.js).
//
// Рисуются теми же фрагментными шейдерами, что и всё вокруг, — своими
// у них только вершинные, с кожей на костях:
//
//   на грунте и вообще снаружи — общий шейдер сеток (MESH_FS): то же
//     солнце, та же дымка воздуха, тень своего корабля и фары, что у
//     камней под ногами. Иначе человек у трапа светился бы иначе, чем
//     трап;
//   на палубе — шейдер кабины (CABIN_FS): лампы помещений, свет из-под
//     фонаря рубки. Солнце туда не достаёт, и человек в трюме освещён
//     тем же, чем трюм.
//
// Нормали граней — по производным положения (uFlatN): сетка сварена, и
// своих нормалей у вершин нет (tools/spacesuit.mjs). Грани модели плоские
// — ровно так и выглядит всё остальное в игре.
//
// Модель грузится лениво, при первом человеке в кадре: двести с лишним
// килобайт чисел нужны только тому, кто встретил другого игрока.

import { buildProgram } from './program.js';
import { MESH_FS } from './shaders.js';
import { CABIN_FS } from './cabin.js';
import { loadSuit, suitPose } from '../models/spacesuit.js';

// Кожа: четыре кости на вершину, номера и веса — байтами.
const SKIN_GLSL = (n) => `
layout(location = 0) in vec3 aPos;
layout(location = 2) in vec4 aColor;
layout(location = 6) in vec4 aJoints;
layout(location = 7) in vec4 aWeights;
uniform mat4 uBones[${n}];
vec4 skinned() {
  mat4 m = uBones[int(aJoints.x + 0.5)] * aWeights.x
         + uBones[int(aJoints.y + 0.5)] * aWeights.y
         + uBones[int(aJoints.z + 0.5)] * aWeights.z
         + uBones[int(aJoints.w + 0.5)] * aWeights.w;
  return m * vec4(aPos, 1.0);
}`;

/** Снаружи: оси модели (м) -> вид (км), как у всех сеток мира. */
export const suitVs = (n) => `#version 300 es
${SKIN_GLSL(n)}
uniform mat4 uProj;
uniform mat4 uModelView;
uniform mat3 uNormalMat;
out vec3 vNormal;
out vec3 vViewPos;
out vec4 vColor;
out float vFragDepth;
out vec3 vLocal;
out vec2 vUv;
out vec2 vGrain;
out float vMat;
out vec3 vNormalL;
void main() {
  vec4 p = skinned();
  vec4 vp = uModelView * p;
  gl_Position = uProj * vp;
  vFragDepth = 1.0 + gl_Position.w;
  vViewPos = vp.xyz;
  // Нормаль — по производным во фрагментном (uFlatN): своей у вершин нет.
  vNormal = uNormalMat * vec3(0.0, 1.0, 0.0);
  vColor = aColor;
  vLocal = p.xyz;
  vUv = vec2(0.0);
  vGrain = vec2(0.0);
  vMat = 0.0;
  vNormalL = vec3(0.0, 1.0, 0.0);
}`;

/** На палубе: оси модели (м) -> оси кабины (м) -> вид, как у помещений. */
export const suitCabinVs = (n) => `#version 300 es
${SKIN_GLSL(n)}
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
out vec3 vPos;
out vec3 vN;
out vec4 vColor;
out float vMat;
out vec2 vUv;
out vec2 vUv2;
out float vFragDepth;
void main() {
  vec4 p = uModel * skinned();
  vPos = p.xyz;
  vN = vec3(0.0, 1.0, 0.0);
  vColor = aColor;
  // Материала нет: ни краски, ни рифления — ткань и пластик скафандра.
  vMat = 0.0;
  vUv = vec2(0.0);
  vUv2 = vec2(0.0);
  gl_Position = uProj * (uView * p);
  vFragDepth = 1.0 + gl_Position.w * 0.001;
}`;

export class SuitView {
  constructor(gl) {
    this.gl = gl;
    this.S = null;
    this.error = null;
    this.loading = false;
    this.pMain = null;
    this.pCabin = null;
    this.vao = null;
    this.bones = null;
    this.draws = 0;
  }

  /** Готова ли модель; если нет — начать грузить. */
  ready() {
    if (this.S) return true;
    if (!this.loading && !this.error) {
      this.loading = true;
      loadSuit().then((S) => this.build(S)).catch((e) => {
        this.error = e;
        console.warn('модель пилота не собралась', e);
      });
    }
    return false;
  }

  build(S) {
    const gl = this.gl;
    this.pMain = buildProgram(gl, 'suit', suitVs(S.bones), MESH_FS);
    this.pCabin = buildProgram(gl, 'suit-cabin', suitCabinVs(S.bones), CABIN_FS);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = (data, loc, size, type, norm) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, norm, 0, 0);
      return b;
    };
    this.buffers = [
      buf(S.pos, 0, 3, gl.FLOAT, false),
      buf(S.col, 2, 4, gl.FLOAT, false),
      buf(S.joints, 6, 4, gl.UNSIGNED_BYTE, false),
      buf(S.weights, 7, 4, gl.UNSIGNED_BYTE, true),
    ];
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, S.index, gl.STATIC_DRAW);
    this.buffers.push(ib);
    gl.bindVertexArray(null);
    this.vao = vao;
    this.count = S.index.length;
    this.bones = new Float32Array(S.bones * 16);
    this.S = S;
  }

  /** Поза человека — в униформы программы prog. */
  pose(prog, person, t) {
    suitPose(this.S, person, t, this.bones);
    this.gl.uniformMatrix4fv(prog.loc('uBones[0]'), false, this.bones);
  }

  /** Один человек: униформы позы и матриц уже стоят. */
  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    this.draws++;
  }
}
