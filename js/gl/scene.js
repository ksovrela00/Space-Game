// Отрисовка сцены в WebGL2.
//
// Проходы за кадр:
//   1) звёздный фон — без буфера глубины;
//   2) непрозрачное — планеты, солнце, станции, корабль;
//   3) прозрачное — кольца, атмосферы, ореолы (глубина читается, но не пишется).
//
// Все матрицы объектов считаются на CPU в double и приводятся к float32
// уже как смещение ОТ КАМЕРЫ (см. mat4.js) — иначе на орбитах в миллионы
// километров float32 теряет километры, и близкие объекты дрожат.

import { createContext, rendererName, resizeCanvas, watchContextLoss } from './context.js';
import { buildProgram } from './program.js';
import {
  MESH_VS, MESH_FS, STARS_VS, STARS_FS, GLOW_VS, GLOW_FS,
  ATMO_VS, ATMO_FS, RING_VS, RING_FS,
} from './shaders.js';
import {
  buildFlatMesh, buildIndexedMesh, buildPointsMesh, buildQuad, buildRingMesh,
} from './mesh.js';
import { icosphere } from './icosphere.js';
import { planetMesh, planetLevel, bodyBasis } from './planetmesh.js';
import { perspective, modelView, dirToCamera, logDepthCoef } from './mat4.js';
import { makeBasis } from '../core/basis.js';

const NEAR = 0.004;          // 4 метра
const FAR = 2e9;             // с запасом на всю систему
const AMBIENT = 0.14;
const MIN_PIXELS = 0.4;      // тела мельче — не рисуем

const applyMat16 = (m, x, y, z, out) => {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
};

export class GlScene {
  constructor(canvas, camera, starfield) {
    this.canvas = canvas;
    this.camera = camera;
    this.starfieldSrc = starfield;
    this.gl = createContext(canvas);
    this.ok = !!this.gl;
    this.error = null;
    this.tris = 0;
    this.draws = 0;
    if (!this.ok) {
      this.error = 'WebGL2 недоступен';
      return;
    }
    try {
      this.init();
    } catch (e) {
      this.ok = false;
      this.error = e.message;
      console.error(e);
    }
  }

  init() {
    const gl = this.gl;
    this.name = rendererName(gl);

    this.pMesh = buildProgram(gl, 'mesh', MESH_VS, MESH_FS);
    this.pStars = buildProgram(gl, 'stars', STARS_VS, STARS_FS);
    this.pGlow = buildProgram(gl, 'glow', GLOW_VS, GLOW_FS);
    this.pAtmo = buildProgram(gl, 'atmo', ATMO_VS, ATMO_FS);
    this.pRing = buildProgram(gl, 'ring', RING_VS, RING_FS);

    this.meshLocs = {
      aPos: this.pMesh.attrib('aPos'),
      aNormal: this.pMesh.attrib('aNormal'),
      aColor: this.pMesh.attrib('aColor'),
    };
    this.atmoLocs = { aPos: this.pAtmo.attrib('aPos') };
    this.ringLocs = { aPos: this.pRing.attrib('aPos'), aT: this.pRing.attrib('aT') };

    // Оболочка атмосферы — одна на все планеты, масштаб задаёт матрица.
    const shell = icosphere(3);
    this.atmoMesh = buildIndexedMesh(gl, this.atmoLocs, {
      positions: shell.positions,
      indices: shell.indices,
    });

    this.quad = buildQuad(gl, this.pGlow.attrib('aQuad'));
    this.stars = this.buildStars();

    this.proj = new Float32Array(16);
    this.mv = new Float32Array(16);
    this.nrm = new Float32Array(9);
    this.viewMat3 = new Float32Array(9);
    this.sunDir = new Float32Array(3);
    this.tmp3 = new Float32Array(3);
    this.basisTmp = makeBasis();
    this.jsMeshes = new WeakMap();
    this.logFC = logDepthCoef(FAR);

    watchContextLoss(this.canvas,
      () => { this.ok = false; this.error = 'контекст WebGL потерян'; },
      () => { this.jsMeshes = new WeakMap(); this.init(); this.ok = true; });
  }

  buildStars() {
    const src = this.starfieldSrc;
    const n = src.count;
    const dirs = new Float32Array(n * 3);
    const colors = new Float32Array(n * 4);
    const PALETTE = [
      [1, 1, 1], [0.875, 0.914, 1], [1, 0.949, 0.847],
      [1, 0.851, 0.753], [0.812, 0.878, 1], [0.941, 0.941, 1],
    ];
    for (let i = 0; i < n; i++) {
      dirs[i * 3] = src.dirs[i * 3];
      dirs[i * 3 + 1] = src.dirs[i * 3 + 1];
      dirs[i * 3 + 2] = src.dirs[i * 3 + 2];
      const c = PALETTE[src.tint[i] % PALETTE.length];
      colors[i * 4] = c[0];
      colors[i * 4 + 1] = c[1];
      colors[i * 4 + 2] = c[2];
      colors[i * 4 + 3] = src.mag[i];
    }
    return buildPointsMesh(this.gl, {
      aDir: this.pStars.attrib('aDir'),
      aColor: this.pStars.attrib('aColor'),
    }, dirs, colors);
  }

  // GL-меш для модели из js/models/* (корабли, станция) — с плоским затенением.
  glMeshFor(jsMesh) {
    let m = this.jsMeshes.get(jsMesh);
    if (!m) {
      m = buildFlatMesh(this.gl, this.meshLocs, jsMesh);
      this.jsMeshes.set(jsMesh, m);
    }
    return m;
  }

  resize() {
    const changed = resizeCanvas(this.gl, this.canvas);
    // Камера общая с HUD; следим, чтобы focal соответствовал размеру окна.
    this.camera.resize(window.innerWidth, window.innerHeight);
    return changed;
  }

  // Видимый радиус тела в пикселях (точный угловой размер шара).
  pixelsOf(body) {
    const cam = this.camera;
    const d = Math.hypot(
      body.pos.x - cam.pos.x, body.pos.y - cam.pos.y, body.pos.z - cam.pos.z);
    if (d <= body.radius) return Infinity;
    return cam.screenRadius(d, body.radius);
  }

  setSunDir(objPos, sunPos) {
    dirToCamera(this.camera.basis,
      sunPos.x - objPos.x, sunPos.y - objPos.y, sunPos.z - objPos.z, this.sunDir);
    return this.sunDir;
  }

  drawObject(prog, mesh, pos, basis, scale, sunPos) {
    const gl = this.gl;
    modelView(this.camera.basis, this.camera.pos, basis, pos, scale, this.mv, this.nrm);
    gl.uniformMatrix4fv(prog.loc('uModelView'), false, this.mv);
    gl.uniformMatrix3fv(prog.loc('uNormalMat'), false, this.nrm);
    gl.uniform3fv(prog.loc('uSunDir'), this.setSunDir(pos, sunPos));
    mesh.draw();
    this.draws++;
    this.tris += mesh.faces || mesh.tris;
  }

  render(game) {
    if (!this.ok) return;
    const gl = this.gl;
    const cam = this.camera;
    const world = game.world;
    const sunPos = world.star.pos;

    this.resize();
    this.tris = 0;
    this.draws = 0;

    const aspect = this.canvas.width / this.canvas.height;
    perspective(cam.fov, aspect, NEAR, FAR, this.proj);

    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.disable(gl.CULL_FACE);        // освещение двустороннее, отсев не нужен
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.drawStars();
    this.drawOpaque(game, world, sunPos);
    this.drawTransparent(game, world, sunPos);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawStars() {
    const gl = this.gl;
    const b = this.camera.basis;
    // Только поворот: звёзды бесконечно далеко.
    const m = this.viewMat3;
    m[0] = b.right.x; m[1] = b.up.x; m[2] = b.fwd.x;
    m[3] = b.right.y; m[4] = b.up.y; m[5] = b.fwd.y;
    m[6] = b.right.z; m[7] = b.up.z; m[8] = b.fwd.z;

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    this.pStars.use();
    gl.uniformMatrix4fv(this.pStars.loc('uProj'), false, this.proj);
    gl.uniformMatrix3fv(this.pStars.loc('uView'), false, m);
    gl.uniform1f(this.pStars.loc('uPointScale'),
      Math.min(window.devicePixelRatio || 1, 2));
    this.stars.draw();
    this.draws++;
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  drawOpaque(game, world, sunPos) {
    const gl = this.gl;
    const prog = this.pMesh;
    prog.use();
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uAmbient'), AMBIENT);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);

    // Планеты, луны, светило.
    for (const body of world.bodies) {
      const px = this.pixelsOf(body);
      if (px < MIN_PIXELS) continue;
      const level = planetLevel(body, px === Infinity ? 1e6 : px);
      const mesh = planetMesh(gl, this.meshLocs, body, level);
      bodyBasis(body, this.basisTmp);
      // Светило само себе источник света — направление не важно.
      this.drawObject(prog, mesh, body.pos, this.basisTmp, body.radius,
        body.kind === 'star' ? { x: body.pos.x, y: body.pos.y, z: body.pos.z + 1 } : sunPos);
    }

    // Станции.
    for (const st of world.stations) {
      const d = Math.hypot(
        st.pos.x - this.camera.pos.x,
        st.pos.y - this.camera.pos.y,
        st.pos.z - this.camera.pos.z);
      if (d > 8000) continue;
      this.drawObject(prog, this.glMeshFor(game.stationMesh), st.pos, st.basis, 1, sunPos);
    }

    // Свой корабль — только в виде от третьего лица.
    if (game.state.view === 'chase' && game.state.mode === 'flight') {
      this.drawObject(prog, this.glMeshFor(game.shipMesh),
        game.ship.pos, game.ship.basis, 1, sunPos);
    }
  }

  drawTransparent(game, world, sunPos) {
    const gl = this.gl;
    gl.depthMask(false);
    gl.enable(gl.BLEND);

    // Кольца: полупрозрачный слой, поэтому обычное смешивание
    // (цвет уже умножен на альфу в шейдере).
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const ring = this.pRing;
    ring.use();
    gl.uniformMatrix4fv(ring.loc('uProj'), false, this.proj);
    gl.uniform1f(ring.loc('uLogFC'), this.logFC);
    for (const body of world.bodies) {
      if (!body.rings) continue;
      if (this.pixelsOf(body) < 2) continue;
      if (!body._ringMesh) {
        body._ringMesh = buildRingMesh(gl, this.ringLocs,
          body.rings.inner, body.rings.outer);
      }
      // Плоскость колец — экваториальная: fwd вдоль полюса.
      const b = this.basisTmp;
      b.right.x = body.eqRef.x; b.right.y = body.eqRef.y; b.right.z = body.eqRef.z;
      b.up.x = body.eqSide.x; b.up.y = body.eqSide.y; b.up.z = body.eqSide.z;
      b.fwd.x = body.pole.x; b.fwd.y = body.pole.y; b.fwd.z = body.pole.z;
      gl.uniform3fv(ring.loc('uColor'), new Float32Array([
        body.rings.color[0] / 255, body.rings.color[1] / 255, body.rings.color[2] / 255]));
      this.drawObject(ring, body._ringMesh, body.pos, b, body.radius, sunPos);
    }

    // Атмосферы и ореолы — аддитивно.
    gl.blendFunc(gl.ONE, gl.ONE);
    const atmo = this.pAtmo;
    atmo.use();
    gl.uniformMatrix4fv(atmo.loc('uProj'), false, this.proj);
    gl.uniform1f(atmo.loc('uLogFC'), this.logFC);
    for (const body of world.bodies) {
      if (!body.atmo) continue;
      if (this.pixelsOf(body) < 3) continue;
      gl.uniform3fv(atmo.loc('uColor'), new Float32Array([
        body.atmo[0] / 255, body.atmo[1] / 255, body.atmo[2] / 255]));
      gl.uniform1f(atmo.loc('uDensity'), 0.9);
      bodyBasis(body, this.basisTmp);
      this.drawObject(atmo, this.atmoMesh, body.pos, this.basisTmp,
        body.radius * 1.035, sunPos);
    }

    this.drawGlows(game, world);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawGlows(game, world) {
    const gl = this.gl;
    const cam = this.camera;
    const prog = this.pGlow;
    prog.use();
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    gl.uniform2fv(prog.loc('uViewport'),
      new Float32Array([this.canvas.width, this.canvas.height]));

    const glow = (posWorld, radiusPx, color, intensity) => {
      const c = cam.toCamera(posWorld);
      if (c.z <= NEAR) return;
      gl.uniform3fv(prog.loc('uCenterView'), new Float32Array([c.x, c.y, c.z]));
      gl.uniform1f(prog.loc('uRadiusPx'), radiusPx);
      gl.uniform3fv(prog.loc('uColor'), color);
      gl.uniform1f(prog.loc('uIntensity'), intensity);
      this.quad.draw();
      this.draws++;
    };

    // Корона светила.
    const star = world.star;
    const starPx = this.pixelsOf(star);
    if (starPx > 0.5 && starPx !== Infinity) {
      glow(star.pos, starPx * 6,
        new Float32Array([star.color[0] / 255, star.color[1] / 255, star.color[2] / 255]),
        0.55);
    }

    // Факелы двигателей в виде от третьего лица.
    const ship = game.ship;
    if (game.state.view === 'chase' && ship.throttle > 0.03 && game.shipMesh.exhausts) {
      modelView(cam.basis, cam.pos, ship.basis, ship.pos, 1, this.mv, null);
      for (const e of game.shipMesh.exhausts) {
        const c = applyMat16(this.mv, e.x, e.y, e.z, this.tmp3);
        if (c[2] <= NEAR) continue;
        gl.uniform3fv(prog.loc('uCenterView'), new Float32Array([c[0], c[1], c[2]]));
        gl.uniform1f(prog.loc('uRadiusPx'), 8 + 26 * ship.throttle);
        gl.uniform3fv(prog.loc('uColor'), new Float32Array([1, 0.55, 0.2]));
        gl.uniform1f(prog.loc('uIntensity'), 0.5 + 0.5 * ship.throttle);
        this.quad.draw();
        this.draws++;
      }
    }
  }
}
