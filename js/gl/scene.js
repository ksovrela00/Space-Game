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
  MESH_VS, MESH_FS, MESH_FS_DETAIL, STARS_VS, STARS_FS, GLOW_VS, GLOW_FS,
  ATMO_VS, ATMO_FS, RING_VS, RING_FS, BAKE_VS, BAKE_FS, SHADOW_VS, SHADOW_FS,
  PLUME_VS, PLUME_FS, WARP_VS, WARP_FS, TUNNEL_VS, TUNNEL_FS, MOTE_VS, MOTE_FS,
} from './shaders.js';
import { detailUniforms, tileDetailUniforms } from './detail.js';
import { terrainOf } from './terrain.js';
import { edgeAngle } from './icosphere.js';
import { Baker, createBlankTexture } from './bake.js';
import { TileSet } from './tiles.js';
import { tileKey, tileTexelAngle } from './quadtree.js';
import { shipShadow } from '../game/shadow.js';

import { localDir, altitudeOf } from '../game/surface.js';
import {
  buildFlatMesh, buildIndexedMesh, buildPointsMesh, buildQuad, buildRingMesh, buildPlumeMesh,
  buildDynamicMesh, buildWarpMesh, buildMoteMesh,
} from './mesh.js';
import { makeRng } from '../core/rng.js';
import { icosphere } from './icosphere.js';
import { requestPlanetMesh, pumpBuilds, pendingBuilds, planetLevel } from './planetmesh.js';
import { SurfacePatch } from './patches.js';
import { RockField } from './rocks.js';
import { perspective, modelView, dirToCamera, logDepthCoef } from './mat4.js';
import { makeBasis, lookAlong, toLocal } from '../core/basis.js';
import { bodyBasis } from '../game/world.js';
import { FLOW } from '../game/flow.js';

// Насколько мягко спадает к краю обычное свечение (солнце, выхлоп, огни).
const GLOW_FALLOFF = 2.5;
const NEAR = 0.004;          // 4 метра
const FAR = 2e9;             // с запасом на всю систему
const AMBIENT = 0.14;
// Во сколько раз тень гасит поверхность. Не в ноль: на безатмосферном
// теле в тень всё равно светит рассеянный свет от соседнего склона —
// и тот же ambient, которым освещена ночная сторона.
const SHADOW_DARK = 0.30;
// Поток частиц в прыжке: сколько их и как далеко впереди рождаются.
// Глубина рождения важнее числа: при uZ0 = 5 частица появляется в
// 1–15° от точки схода, то есть у самого центра, и разгоняется к краю
// сама собой. Меньше — и они будут возникать сразу посреди экрана.
const WARP_COUNT = 1400;
const WARP_Z0 = 5;
// Насколько хвост отстаёт от головы по фазе. Длина полосы получается
// не отсюда, а из перспективы: у центра частица еле ползёт, у края
// летит, и один и тот же интервал времени даёт там короткий штрих, а
// тут длинную черту.
const WARP_TAIL = 0.11;
// Прыжковый поток отдаёт в синеву, пылинки за бортом — почти белые:
// они просто освещены солнцем системы.
const WARP_COLOR = new Float32Array([0.82, 0.92, 1.0]);
const MOTE_COLOR = new Float32Array([0.88, 0.91, 0.98]);
// Сколько пылинок стоит в ячейке решётки (js/game/flow.js, FLOW.box).
// Четыре сотни на два километра — это крошка на каждые триста метров:
// в кадре десятки черт. Считать их нечем и незачем: буфер статический,
// на кадр приходится один вызов отрисовки.
const MOTE_COUNT = 400;
// Единичный базис: тень уже посчитана в мировых осях, поворачивать её
// нечем и незачем.
const IDENTITY_BASIS = {
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fwd: { x: 0, y: 0, z: 1 },
};
const MIN_PIXELS = 0.4;      // тела мельче — не рисуем
const BUILD_MS = 2.5;        // бюджет на досборку мешей тел за кадр
const PATCH_MS = 3.0;        // и на заплатки поверхности
const TILE_MS = 6.0;         // и на плитки (только пока они подгружаются)

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

    // Мелкий рельеф на пиксель — основной вариант; если он не соберётся
    // на каком-то драйвере, сцена должна остаться рабочей, поэтому есть
    // запасной шейдер без детали.
    this.detailOn = new URLSearchParams(
      typeof location !== 'undefined' ? location.search : '').get('detail') !== '0';
    if (this.detailOn) {
      try {
        this.pMesh = buildProgram(gl, 'mesh', MESH_VS, MESH_FS_DETAIL);
      } catch (e) {
        console.error('Мелкий рельеф не собрался, рисуем без него:\n' + e.message);
        this.detailOn = false;
      }
    }
    if (!this.detailOn) this.pMesh = buildProgram(gl, 'mesh', MESH_VS, MESH_FS);
    this.pStars = buildProgram(gl, 'stars', STARS_VS, STARS_FS);
    this.pGlow = buildProgram(gl, 'glow', GLOW_VS, GLOW_FS);
    this.pAtmo = buildProgram(gl, 'atmo', ATMO_VS, ATMO_FS);
    this.pRing = buildProgram(gl, 'ring', RING_VS, RING_FS);
    this.pPlume = buildProgram(gl, 'plume', PLUME_VS, PLUME_FS);
    this.pShadow = buildProgram(gl, 'shadow', SHADOW_VS, SHADOW_FS);
    this.pWarp = buildProgram(gl, 'warp', WARP_VS, WARP_FS);
    this.pTunnel = buildProgram(gl, 'tunnel', TUNNEL_VS, TUNNEL_FS);
    this.pMote = buildProgram(gl, 'mote', MOTE_VS, MOTE_FS);

    this.meshLocs = {
      aPos: this.pMesh.attrib('aPos'),
      aNormal: this.pMesh.attrib('aNormal'),
      aColor: this.pMesh.attrib('aColor'),
      aUv: this.pMesh.attrib('aUv'),
    };
    this.atmoLocs = { aPos: this.pAtmo.attrib('aPos') };
    this.ringLocs = { aPos: this.pRing.attrib('aPos'), aT: this.pRing.attrib('aT') };
    this.plumeLocs = { aPos: this.pPlume.attrib('aPos'), aT: this.pPlume.attrib('aT') };
    this.plumeMesh = buildPlumeMesh(gl, this.plumeLocs);
    // Оси факела строятся по вектору скорости, поэтому свой базис.
    this.plumeBasis = makeBasis();

    // Оболочка атмосферы — одна на все планеты, масштаб задаёт матрица.
    const shell = icosphere(3);
    this.atmoMesh = buildIndexedMesh(gl, this.atmoLocs, {
      positions: shell.positions,
      indices: shell.indices,
    });

    this.quad = buildQuad(gl, this.pGlow.attrib('aQuad'));
    // Тень переписывается каждый кадр. Силуэт — это настоящие грани
    // корпуса, отвёрнутые от солнца, поэтому вершин у него тысячи, а не
    // десятки: буфер берём с запасом на весь корпус.
    this.shadowMesh = buildDynamicMesh(gl, this.pShadow.attrib('aPos'), 6144);
    // Накрывающая сетка, по которой умножается тень (см. drawShadow).
    this.coverMesh = buildDynamicMesh(gl, this.pShadow.attrib('aPos'), 512);
    this.shadowBuf = {};
    this.stars = this.buildStars();
    // Поток частиц прыжка. Строится один раз на запуск и от звёзд не
    // зависит вовсе: звёзды бесконечно далеко и лететь мимо не могут.
    this.warp = buildWarpMesh(gl, {
      aParam: this.pWarp.attrib('aParam'),
      aT: this.pWarp.attrib('aT'),
    }, WARP_COUNT, makeRng(0x7a12));
    this.tunnelQuad = buildQuad(gl, this.pTunnel.attrib('aQuad'));
    this.jump = {
      power: 0, axis: { x: 0, y: 0, z: 1 }, cx: 0, cy: 0,
      // Мировые оси потока: сама ось движения и два перпендикуляра.
      // Считаются в МИРОВЫХ осях, чтобы поток не закручивался, когда
      // игрок вертит камерой.
      aw: { x: 0, y: 0, z: 1 }, e1: { x: 1, y: 0, z: 0 }, e2: { x: 0, y: 1, z: 0 },
      phase: 0, tail: 0,
    };
    // Пылинки за бортом (js/game/flow.js). В отличие от прыжкового
    // потока это НАСТОЯЩИЕ точки в пространстве, с расстоянием и
    // глубиной: их закрывает собой планета и корпус корабля, и видны
    // они со всех сторон, а не только по курсу.
    this.motes = buildMoteMesh(gl, {
      aCell: this.pMote.attrib('aCell'),
      aT: this.pMote.attrib('aT'),
    }, MOTE_COUNT, makeRng(0x3e11));
    // Постоянные буферы под их униформы: вектор на кадр — это мусор в
    // куче каждые шестнадцать миллисекунд.
    this.moteRel = new Float32Array(3);
    this.moteOfs = new Float32Array(3);
    this.moteStreak = new Float32Array(3);
    this.blankTex = createBlankTexture(gl);
    this.patch = new SurfacePatch(gl, this.meshLocs);
    // Камни у самой поверхности: предметы известного размера, по которым
    // глаз и меряет высоту (см. js/gl/rocks.js).
    this.rocks = new RockField(gl, this.meshLocs);

    // Поверхность плитками: геометрия и текстуры считаются по одному
    // разу на плитку и живут в кэше (js/gl/tiles.js). Прежний путь —
    // заплатки под кораблём с процедурной деталью на пиксель — остаётся
    // по `?surface=clipmap` для сравнения картинки.
    const q = new URLSearchParams(
      typeof location !== 'undefined' ? location.search : '');
    this.tilesOn = (q.get('surface') || 'tiles') === 'tiles';
    if (this.tilesOn) {
      try {
        this.pBake = buildProgram(gl, 'bake', BAKE_VS, BAKE_FS);
        this.bakeQuad = buildQuad(gl, this.pBake.attrib('aQuad'));
        this.baker = new Baker(gl);
        this.tiles = new TileSet(gl, this.meshLocs, this.baker, this.pBake, this.bakeQuad);
      } catch (e) {
        console.error('Запекание поверхности не собралось, рисуем заплатками:\n' + e.message);
        this.tilesOn = false;
      }
    }

    this.proj = new Float32Array(16);
    this.mv = new Float32Array(16);
    this.nrm = new Float32Array(9);
    this.viewMat3 = new Float32Array(9);
    this.sunDir = new Float32Array(3);
    this.tmp3 = new Float32Array(3);
    this.basisTmp = makeBasis();
    this.tmpPos = { x: 0, y: 0, z: 0 };
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
    // Сырые массивы остаются: из них же строится меш полос для прыжка.
    this.starData = { dirs, colors };
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

  /**
   * Uniform-ы мелкого рельефа для очередной сетки. Шейдер добавляет
   * ровно то, что в эту сетку не влезло, поэтому ему нужен угловой
   * размер её ячейки: у сферы это ребро икосферы, у заплатки — её шаг.
   */
  setDetail(prog, body, meshCell, budget = 1) {
    if (!this.detailOn) return;
    const u = body && body.isBody
      ? detailUniforms(terrainOf(body), meshCell, budget)
      : { on: 0 };
    this.applyDetail(prog, u);
  }

  applyDetail(prog, u) {
    const gl = this.gl;
    gl.uniform1f(prog.loc('uDetail'), u.on);
    if (!u.on) return;
    gl.uniform1i(prog.loc('uMaxCs'), u.maxCs);
    gl.uniform1i(prog.loc('uMaxOct'), u.maxOct);
    gl.uniform1i(prog.loc('uSeed'), u.seed);
    gl.uniform1f(prog.loc('uAmp'), u.amp);
    gl.uniform1f(prog.loc('uSpan'), u.span);
    gl.uniform1f(prog.loc('uFreq'), u.freq);
    gl.uniform1f(prog.loc('uRidge'), u.ridge);
    gl.uniform1f(prog.loc('uCraterW'), u.craterW);
    gl.uniform1i(prog.loc('uOctFrom'), u.octFrom);
    gl.uniform1i(prog.loc('uCsFrom'), u.csFrom);
    gl.uniform1f(prog.loc('uBakeFw'), u.bakeFw || 0);
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
    this.rockDraws = 0;
    this.streamDraws = 0;
    this.moteDraws = 0;

    const aspect = this.canvas.width / this.canvas.height;
    perspective(cam.fov, aspect, NEAR, FAR, this.proj);

    // Досборка геометрии и запекание поверхности — ДО настройки кадра.
    // Проход запекания рисует в свою текстуру: он меняет вьюпорт и
    // отключает тесты глубины, и если делать это после clear, весь
    // остальной кадр уйдёт в угол размером с текстуру плитки.
    this.pending = pendingBuilds();
    if (this.pending) pumpBuilds(gl, this.meshLocs, BUILD_MS);
    this.updatePatches(game);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.disable(gl.CULL_FACE);        // освещение двустороннее, отсев не нужен
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    // Очистка трафарета подчиняется stencilMask: без этой строки маска,
    // выставленная заплатками в прошлом кадре, осталась бы в буфере — и
    // сфера продолжала бы «не рисоваться» там, где заплаток уже нет.
    gl.stencilMask(0xff);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    this.updateJump(game);
    this.drawStars();
    this.drawOpaque(game, world, sunPos);
    this.drawTransparent(game, world, sunPos);
    this.drawMotes(game);
    this.drawTunnel();

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
  }

  /**
   * Состояние квантового прыжка для картинки: сила эффекта, ось движения
   * в координатах камеры и точка схода на экране.
   *
   * Точка схода — это не центр кадра: в виде от третьего лица камеру
   * можно отвернуть, и тоннель обязан остаться там, куда корабль летит
   * на самом деле. Именно на этом держится всё ощущение скорости.
   */
  updateJump(game) {
    const j = this.jump;
    const q = game.quantum;
    const ship = game.ship;
    j.power = 0;
    if (!q || q.phase !== 'jump' || !ship) return;

    const top = ship.quantumSpeed || 60000;
    // Корень: тоннель обязан появиться сразу, а не к середине разгона,
    // и так же честно растаять на торможении.
    j.power = Math.min(1, Math.pow(Math.max(0, q.speed) / top, 0.35));

    if (this.streamAxes(ship.vel, j) <= 0) { j.power = 0; return; }
    const b = this.camera.basis;
    const dx = j.aw.x, dy = j.aw.y, dz = j.aw.z;
    // Фаза потока — из состояния привода: она копится в шаге физики,
    // и картинка не зависит от того, с какой частотой идут кадры.
    j.phase = q.warp || 0;
    j.axis.x = dx * b.right.x + dy * b.right.y + dz * b.right.z;
    j.axis.y = dx * b.up.x + dy * b.up.y + dz * b.up.z;
    j.axis.z = dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z;

    const cam = this.camera;
    if (j.axis.z > 0.08) {
      const px = cam.cx + (j.axis.x / j.axis.z) * cam.focal;
      const py = cam.cy - (j.axis.y / j.axis.z) * cam.focal;
      j.cx = Math.max(-2, Math.min(2, (px / cam.w) * 2 - 1));
      j.cy = Math.max(-2, Math.min(2, 1 - (py / cam.h) * 2));
    } else {
      // Ось ушла за спину: точку схода не спроецировать, и тоннеля
      // быть не должно — сзади он выглядит как заливка экрана.
      j.cx = 0; j.cy = 0;
      j.power *= 0.25;
    }
  }

  /**
   * Мировые оси потока от вектора движения: сама ось и два
   * перпендикуляра к ней. Считаются в МИРОВЫХ осях, чтобы поток не
   * закручивался, когда игрок вертит камерой, а перпендикуляры
   * строятся от одной и той же опорной оси — пока корабль летит
   * прямо, они стоят на месте, и поток не вращается сам по себе.
   *
   * Возвращает длину вектора: нулевая скорость — потока нет.
   */
  streamAxes(v, out) {
    const L = Math.hypot(v.x, v.y, v.z);
    if (!(L > 1e-9)) return 0;
    const dx = v.x / L, dy = v.y / L, dz = v.z / L;
    out.aw.x = dx; out.aw.y = dy; out.aw.z = dz;
    const refY = Math.abs(dy) < 0.9;
    const rx = refY ? 0 : 1, ry = refY ? 1 : 0, rz = 0;
    let ex = dy * rz - dz * ry, ey = dz * rx - dx * rz, ez = dx * ry - dy * rx;
    const el = Math.hypot(ex, ey, ez) || 1;
    ex /= el; ey /= el; ez /= el;
    out.e1.x = ex; out.e1.y = ey; out.e1.z = ez;
    out.e2.x = dy * ez - dz * ey;
    out.e2.y = dz * ex - dx * ez;
    out.e2.z = dx * ey - dy * ex;
    return L;
  }

  /**
   * Один проход потока частиц: и прыжковый, и обычный рисуются одной
   * программой и одним мешем — разница только в темпе, длине черты и
   * яркости (см. WARP_VS).
   */
  drawStream(st, color) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    const prog = this.pWarp;
    prog.use();
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniformMatrix3fv(prog.loc('uView'), false, this.viewMat3);
    gl.uniform3fv(prog.loc('uAxis'), new Float32Array([st.aw.x, st.aw.y, st.aw.z]));
    gl.uniform3fv(prog.loc('uE1'), new Float32Array([st.e1.x, st.e1.y, st.e1.z]));
    gl.uniform3fv(prog.loc('uE2'), new Float32Array([st.e2.x, st.e2.y, st.e2.z]));
    gl.uniform1f(prog.loc('uPhase'), st.phase);
    gl.uniform1f(prog.loc('uTail'), st.tail);
    gl.uniform1f(prog.loc('uZ0'), WARP_Z0);
    gl.uniform1f(prog.loc('uPower'), st.power);
    gl.uniform3fv(prog.loc('uColor'), color);
    this.warp.draw();
    this.draws++;
    this.streamDraws++;
    gl.disable(gl.BLEND);
  }

  /**
   * Пылинки за бортом: один вызов отрисовки на кадр.
   *
   * Рисуются ПОСЛЕ непрозрачного прохода и с честной глубиной, но без
   * записи в буфер: пылинка перед планетой её закрывает, пылинка за
   * планетой — не видна. Прежний, проекционный поток этого не умел
   * вовсе: у его частиц не было расстояния, и рядом с планетой они
   * оказывались за ней.
   *
   * Вся траектория считается в вершинном шейдере (MOTE_VS). На
   * процессоре за кадр — три числа сдвига решётки и вектор смаза.
   */
  drawMotes(game) {
    const f = game.flow;
    if (!f || !(f.power > 0.004) || !game.ship) return;
    const gl = this.gl;
    const prog = this.pMote;
    const cam = this.camera;
    prog.use();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniformMatrix3fv(prog.loc('uView'), false, this.viewMat3);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    gl.uniform1f(prog.loc('uBox'), FLOW.box);
    // Решётка стоит вокруг КОРАБЛЯ, а камера отнесена от него на
    // длину троса: в виде от третьего лица разница метров сто, и без
    // неё пылинки сидели бы не там, где летит корабль.
    const sp = game.ship.pos;
    this.moteRel[0] = sp.x - cam.pos.x;
    this.moteRel[1] = sp.y - cam.pos.y;
    this.moteRel[2] = sp.z - cam.pos.z;
    this.moteOfs[0] = f.ofs.x; this.moteOfs[1] = f.ofs.y; this.moteOfs[2] = f.ofs.z;
    this.moteStreak[0] = f.streak.x;
    this.moteStreak[1] = f.streak.y;
    this.moteStreak[2] = f.streak.z;
    gl.uniform3fv(prog.loc('uShipRel'), this.moteRel);
    gl.uniform3fv(prog.loc('uOfs'), this.moteOfs);
    gl.uniform3fv(prog.loc('uStreak'), this.moteStreak);
    gl.uniform3fv(prog.loc('uColor'), MOTE_COLOR);
    gl.uniform1f(prog.loc('uPower'), f.power);
    this.motes.draw();
    this.draws++;
    this.moteDraws++;
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  /** Полноэкранный тоннель поверх всего. */
  drawTunnel() {
    const j = this.jump;
    if (!(j.power > 0.02)) return;
    const gl = this.gl;
    const prog = this.pTunnel;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    prog.use();
    gl.uniform2fv(prog.loc('uCenter'), new Float32Array([j.cx, j.cy]));
    gl.uniform1f(prog.loc('uAspect'), this.canvas.width / Math.max(1, this.canvas.height));
    gl.uniform1f(prog.loc('uTime'), (Date.now() % 1000000) / 1000);
    gl.uniform1f(prog.loc('uPower'), j.power);
    gl.uniform3fv(prog.loc('uColor'), new Float32Array([0.42, 0.70, 1.0]));
    this.tunnelQuad.draw();
    this.draws++;
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  // Ближайшее тело под камерой: только для него имеет смысл считать
  // подробные заплатки поверхности.
  nearestSurface(world) {
    const cam = this.camera;
    let best = null, bestGap = Infinity;
    for (const b of world.bodies) {
      if (b.kind === 'star' || b.kind === 'gas') continue;
      const gap = Math.hypot(
        b.pos.x - cam.pos.x, b.pos.y - cam.pos.y, b.pos.z - cam.pos.z) - b.radius;
      if (gap < bestGap) { bestGap = gap; best = b; }
    }
    // Плитки имеет смысл держать и на подлёте (корни строятся заранее),
    // а заплатки включаются только у самой поверхности.
    const range = this.tilesOn ? 30 : 0.2;
    return best && bestGap < best.radius * range ? best : null;
  }

  updatePatches(game) {
    const body = this.nearestSurface(game.world);
    this.updateRocks(body, game.world.star.pos);
    if (this.tilesOn) {
      this.updateTiles(body);
      this.patchBody = null;
      return;
    }
    this.patchBody = body
      ? this.patch.update(body, this.camera.pos, body._glLevel || 0, PATCH_MS)
      : this.patch.update(null, null, 0, 0);
  }

  /**
   * Поле камней под камерой. Работает одинаково для обоих способов
   * рисовать поверхность: камни лежат в осях тела и к плиткам не
   * привязаны.
   */
  updateRocks(body, sunPos) {
    if (!body) { this.rocks.clear(); this.rockBody = null; return; }
    const info = altitudeOf(body, this.camera.pos,
      this._rinfo || (this._rinfo = { dir: { x: 0, y: 0, z: 0 } }));
    const dir = localDir(body, this.camera.pos,
      this._rdir || (this._rdir = { x: 0, y: 0, z: 0 }));
    // Солнце в осях тела: по нему камни кладут свои тени.
    const fr = bodyBasis(body, this._rframe || (this._rframe = makeBasis()));
    toLocal(fr, body.pos, sunPos, this._rsun || (this._rsun = { x: 0, y: 0, z: 0 }));
    const sl = Math.hypot(this._rsun.x, this._rsun.y, this._rsun.z) || 1;
    this._rsun.x /= sl; this._rsun.y /= sl; this._rsun.z /= sl;
    this.rocks.update(body, dir, info.alt, this._rsun);
    this.rockBody = this.rocks.mesh ? body : null;
  }

  /**
   * Плитки ближайшего тела с поверхностью. Пока корневые шесть не
   * готовы, тело рисуется обычной сферой — так подгрузка не оставляет
   * дырок в кадре.
   */
  updateTiles(body) {
    if (!body) {
      if (this.tiles.body) this.tiles.clear();
      this.tileBody = null;
      return;
    }
    const info = altitudeOf(body, this.camera.pos,
      this._tinfo || (this._tinfo = { dir: { x: 0, y: 0, z: 0 } }));
    const dir = localDir(body, this.camera.pos,
      this._tdir || (this._tdir = { x: 0, y: 0, z: 0 }));
    this.tiles.update(body, dir, info.alt, this.camera.focal, TILE_MS);
    this.tileBody = this.tiles.rootsReady ? body : null;
  }

  // Плитки рисуются одной матрицей тела: меняется только текстура и —
  // при смене уровня — окно мелкой детали, которую шейдер добавляет
  // ниже текселя этой текстуры.
  drawTiles(prog, sunPos) {
    const gl = this.gl;
    const body = this.tileBody;
    const terrain = terrainOf(body);
    bodyBasis(body, this.basisTmp);
    gl.uniform1f(prog.loc('uSurfMode'), 1);
    gl.uniform1i(prog.loc('uSurfTex'), 0);
    gl.activeTexture(gl.TEXTURE0);
    let lastLevel = -1;
    for (const t of this.tiles.draw) {
      const e = this.tiles.get(tileKey(t.face, t.level, t.tx, t.ty));
      if (!e || !e.mesh) continue;
      if (this.detailOn && t.level !== lastLevel) {
        this.applyDetail(prog, tileDetailUniforms(terrain, tileTexelAngle(t.level)));
        lastLevel = t.level;
      }
      gl.bindTexture(gl.TEXTURE_2D, e.tex.tex);
      this.drawObject(prog, e.mesh, body.pos, this.basisTmp, body.radius, sunPos);
    }
    gl.uniform1f(prog.loc('uSurfMode'), 0);
    this.setDetail(prog, null, 0);
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

    // Звёзды рисуются всегда, в том числе в прыжке: они бесконечно
    // далеко и стоять на месте — их законное поведение. Лететь мимо
    // должен поток частиц, и это отдельный проход.
    this.pStars.use();
    gl.uniformMatrix4fv(this.pStars.loc('uProj'), false, this.proj);
    gl.uniformMatrix3fv(this.pStars.loc('uView'), false, m);
    gl.uniform1f(this.pStars.loc('uPointScale'),
      Math.min(window.devicePixelRatio || 1, 2));
    this.stars.draw();
    this.draws++;

    const j = this.jump;
    if (j.power > 0.02) {
      j.tail = WARP_TAIL * (0.25 + 0.75 * j.power);
      const saved = j.power;
      j.power = 0.25 + 0.75 * saved;
      this.drawStream(j, WARP_COLOR);
      j.power = saved;
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  drawOpaque(game, world, sunPos) {
    const gl = this.gl;
    const prog = this.pMesh;
    prog.use();
    // Сэмплер поверхности всегда должен смотреть в готовую текстуру,
    // даже когда она не используется.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.blankTex.tex);
    gl.uniform1i(prog.loc('uSurfTex'), 0);
    gl.uniform1f(prog.loc('uSurfMode'), 0);
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uAmbient'), AMBIENT);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);

    // Поверхность плитками: она полностью заменяет сферу этого тела,
    // поэтому ни трафарет, ни деталь на пиксель тут не нужны.
    if (this.tileBody) this.drawTiles(prog, sunPos);

    // Подробные заплатки поверхности — первыми, с записью трафарета:
    // там, где легла подробная земля, грубая сфера не нужна.
    const patchMeshes = this.patchBody ? this.patch.meshes : null;
    if (patchMeshes) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilMask(0xff);
      gl.stencilFunc(gl.ALWAYS, 1, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      bodyBasis(this.patchBody, this.basisTmp);
      for (const m of patchMeshes) {
        this.setDetail(prog, this.patchBody, m.cellAngle);
        this.drawObject(prog, m, this.patchBody.pos, this.basisTmp,
          this.patchBody.radius, sunPos);
      }
      gl.stencilMask(0);
    }

    // Планеты, луны, светило.
    for (const body of world.bodies) {
      if (body === this.tileBody) continue;      // нарисовано плитками
      const px = this.pixelsOf(body);
      if (px < MIN_PIXELS) continue;
      let level = planetLevel(body, px === Infinity ? 1e6 : px);
      const masked = patchMeshes && body === this.patchBody;
      // Под заплатками сфера почти целиком закрыта (их край — за
      // горизонтом), поэтому самый подробный уровень ей там не нужен:
      // это 80 тысяч треугольников и 60 мс сборки впустую.
      if (masked && level > 5) level = 5;
      const mesh = requestPlanetMesh(gl, this.meshLocs, body, level);
      bodyBasis(body, this.basisTmp);
      if (masked) {
        gl.enable(gl.STENCIL_TEST);
        gl.stencilFunc(gl.EQUAL, 0, 0xff);
      }
      // Светило само себе источник света — направление не важно.
      //
      // Под заплатками сфера почти целиком закрыта трафаретом, но
      // логарифмическая глубина отключает early-z, и фрагментный шейдер
      // отрабатывает её пиксели впустую. Поэтому там деталь урезана до
      // одного масштаба: видимой остаётся только даль за краем заплаток,
      // а на таком угле к поверхности след пикселя всё равно огромен.
      this.setDetail(prog, body, edgeAngle(level), masked ? 0.34 : 1);
      this.drawObject(prog, mesh, body.pos, this.basisTmp, body.radius,
        body.kind === 'star' ? { x: body.pos.x, y: body.pos.y, z: body.pos.z + 1 } : sunPos);
      if (masked) gl.disable(gl.STENCIL_TEST);
    }
    gl.disable(gl.STENCIL_TEST);
    this.setDetail(prog, null, 0);      // дальше — рукотворные объекты

    // Камни на грунте. Рисуются после поверхности и без деталировки на
    // пиксель: это обычные модели, просто мелкие и в осях тела.
    if (this.rockBody && this.rocks.mesh) {
      this.rockDraws++;
      bodyBasis(this.rockBody, this.basisTmp);
      this.drawObject(prog, this.rocks.mesh, this.rockBody.pos, this.basisTmp,
        this.rockBody.radius, sunPos);
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
    if (game.state.view === 'chase' && game.state.mode !== 'docked') {
      const ship = game.ship;
      this.drawObject(prog, this.glMeshFor(game.shipMesh), ship.pos, ship.basis, 1, sunPos);
      this.drawGear(prog, game, sunPos);
    }
  }

  // Стойки шасси: каждая рисуется своим вызовом от точки крепления,
  // масштаб по длине — так стойка выдвигается, а не растёт из центра.
  drawGear(prog, game, sunPos) {
    const ship = game.ship;
    const mesh = game.gearMesh;
    if (!mesh || !ship.gear || ship.gear.t < 0.01) return;
    const legMesh = this.glMeshFor(mesh);
    const b = ship.basis;
    mesh.hardpoints.forEach((hp, i) => {
      this.tmpPos.x = ship.pos.x + b.right.x * hp.x + b.up.x * hp.y + b.fwd.x * hp.z;
      this.tmpPos.y = ship.pos.y + b.right.y * hp.x + b.up.y * hp.y + b.fwd.y * hp.z;
      this.tmpPos.z = ship.pos.z + b.right.z * hp.x + b.up.z * hp.y + b.fwd.z * hp.z;
      const nominal = mesh.legLengths ? mesh.legLengths[i] : mesh.legLength;
      const drop = ship.gear.drop ? ship.gear.drop[i] : 0;
      this.drawObject(prog, legMesh, this.tmpPos, b,
        Math.max(0.001, nominal + drop) * ship.gear.t, sunPos);
    });
  }

  /**
   * Тень корабля на грунте: настоящий силуэт, нарисованный УМНОЖЕНИЕМ.
   *
   * Смешивание ZERO/SRC_COLOR оставляет от освещённой поверхности ту
   * долю, которая пришла не от солнца, — то есть ровно то, что и
   * означает тень. Складывать сюда чёрный с альфой нельзя: под тенью
   * тогда и рельеф, и цвет грунта одинаково уходят в серое.
   *
   * Но умножать САМ силуэт нельзя: корпус не выпуклый, проекции его
   * граней местами накладываются, а два умножения дают чёрное пятно.
   * Поэтому в два прохода: силуэт пишется в трафарет (без цвета), а
   * умножается по трафарету накрывающая сетка — она без перекрытий, и
   * каждый пиксель гасится ровно один раз.
   */
  drawShadow(game, sunPos) {
    const gl = this.gl;
    const buf = this.shadowBuf;
    const n = shipShadow(game.zone, game.ship, game.shipMesh, sunPos, buf);
    if (n < 3 || !buf.coverCount) return;
    const nSil = Math.min(n, this.shadowMesh.maxVerts);
    this.shadowMesh.update(buf.verts, nSil);
    this.coverMesh.update(buf.cover, Math.min(buf.coverCount, this.coverMesh.maxVerts));

    const prog = this.pShadow;
    prog.use();
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    gl.uniform1f(prog.loc('uDark'), SHADOW_DARK);
    // Вершины лежат в мировых осях относительно корабля, поэтому базис
    // объекта — единичный, а сдвиг до камеры считается в двойной
    // точности, как у всех остальных мешей.
    modelView(this.camera.basis, this.camera.pos, IDENTITY_BASIS, game.ship.pos, 1,
      this.mv, this.nrm);
    gl.uniformMatrix4fv(prog.loc('uModelView'), false, this.mv);

    // 1. силуэт -> трафарет, цвет не трогаем.
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.clearStencil(0);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.colorMask(false, false, false, false);
    this.shadowMesh.draw();

    // 2. по трафарету — накрывающая сетка, уже с умножением.
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.stencilMask(0);
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    this.coverMesh.draw();

    gl.stencilMask(0xff);
    gl.disable(gl.STENCIL_TEST);
    this.draws += 2;
  }

  drawTransparent(game, world, sunPos) {
    const gl = this.gl;
    gl.depthMask(false);
    gl.enable(gl.BLEND);

    // Тень — первой: всё остальное прозрачное (выхлоп, ореолы) светится
    // и должно ложиться поверх неё.
    if (game.state.mode === 'flight' || game.state.mode === 'landed') {
      this.drawShadow(game, sunPos);
    }

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

    this.drawEntryPlume(game, sunPos);
    this.drawGlows(game, world);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /**
   * Плазма входа в атмосферу.
   *
   * Оболочка строится вокруг вектора СКОРОСТИ, а не носа: горит
   * набегающий поток, и ему всё равно, как повёрнут корабль. Влетел
   * боком — факел идёт вдоль борта, и это видно.
   *
   * Размер растёт с нагревом: у порога это тонкая кромка вокруг носа, в
   * полную силу — след в несколько длин корпуса. Само свечение и его
   * цвет считает js/game/entry.js, здесь только рисование.
   */
  drawEntryPlume(game, sunPos) {
    const e = game.entry;
    if (!e || !(e.heat > 0)) return;
    const gl = this.gl;
    const ship = game.ship;
    const prog = this.pPlume;
    prog.use();
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    gl.uniform3fv(prog.loc('uColor'), new Float32Array(e.color));
    gl.uniform1f(prog.loc('uHeat'), e.heat);
    // Время нужно только дрожанию; секунды по настенным часам годятся.
    gl.uniform1f(prog.loc('uTime'), (Date.now() % 1000000) / 1000);

    const L = (game.shipMesh && game.shipMesh.length) || 0.065;
    gl.uniform1f(prog.loc('uRad'), L * (0.42 + 0.5 * e.heat));
    gl.uniform1f(prog.loc('uLen'), L * (1.5 + 7 * e.heat));
    // Порог затухания вблизи: четверть длины корпуса.
    gl.uniform1f(prog.loc('uNear'), L * 0.25);

    // Базис факела: вперёд — по потоку, «верх» берём у корабля, чтобы
    // дрожание не крутилось вокруг оси при развороте.
    lookAlong(this.plumeBasis, e.dir, ship.basis.up);
    // Лобовая точка чуть впереди носа: волна отходит от тела.
    const head = this._plumePos || (this._plumePos = { x: 0, y: 0, z: 0 });
    head.x = ship.pos.x + e.dir.x * L * 0.55;
    head.y = ship.pos.y + e.dir.y * L * 0.55;
    head.z = ship.pos.z + e.dir.z * L * 0.55;
    this.drawObject(prog, this.plumeMesh, head, this.plumeBasis, 1, sunPos);
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
    // Мягкий ореол — значение по умолчанию; пыль ставит свой (см. ниже).
    gl.uniform1f(prog.loc('uFalloff'), GLOW_FALLOFF);

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
    const own = game.state.view === 'chase';
    if (own && ship.throttle > 0.03 && game.shipMesh.exhausts) {
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

    // Пыль из-под движков. Частицы живут в осях ТЕЛА (см. js/game/dust.js),
    // поэтому и матрица берётся телесная: иначе пыль отставала бы от
    // грунта ровно на скорость вращения планеты.
    const dust = game.dust;
    if (dust && dust.body && dust.list.length) {
      // Край у пылинки мягкий: резкий давал белые шары вместо взвеси.
      // Плотность берётся числом частиц, а не размером каждой.
      gl.uniform1f(prog.loc('uFalloff'), 1.6);
      bodyBasis(dust.body, this.basisTmp);
      modelView(cam.basis, cam.pos, this.basisTmp, dust.body.pos, 1, this.mv, null);
      for (const p of dust.list) {
        const c = applyMat16(this.mv, p.x, p.y, p.z, this.tmp3);
        if (c[2] <= NEAR) continue;
        gl.uniform3fv(prog.loc('uCenterView'), new Float32Array([c[0], c[1], c[2]]));
        // Облачко растёт по мере полёта: пыль расходится.
        gl.uniform1f(prog.loc('uRadiusPx'), 7 + 18 * p.size * (0.3 + p.age));
        // Цвет — самого грунта, а не белый: это поднятая пыль, а не пар.
        gl.uniform3fv(prog.loc('uColor'), new Float32Array([0.74, 0.70, 0.64]));
        gl.uniform1f(prog.loc('uIntensity'), 0.62 * p.fade);
        this.quad.draw();
        this.draws++;
      }
      gl.uniform1f(prog.loc('uFalloff'), GLOW_FALLOFF);
    }

    // Маневровые. Видно их ровно тогда, когда приложен момент, — на
    // раскрутке и на остановке вращения; держать постоянный разворот в
    // пустоте нечем и незачем. Без них поворот происходит «сам собой»,
    // и корабль читается как модель на подставке, а не как железо,
    // которое ворочают двигателями.
    if (own && ship.rcs && game.shipMesh.rcs) {
      modelView(cam.basis, cam.pos, ship.basis, ship.pos, 1, this.mv, null);
      for (const axis of ['pitch', 'yaw', 'roll']) {
        const dir = ship.rcs[axis];
        if (!dir) continue;
        for (const port of game.shipMesh.rcs[axis][dir > 0 ? 0 : 1]) {
          const c = applyMat16(this.mv, port.x, port.y, port.z, this.tmp3);
          if (c[2] <= NEAR) continue;
          gl.uniform3fv(prog.loc('uCenterView'), new Float32Array([c[0], c[1], c[2]]));
          gl.uniform1f(prog.loc('uRadiusPx'), 16);
          gl.uniform3fv(prog.loc('uColor'), new Float32Array([0.85, 0.94, 1]));
          gl.uniform1f(prog.loc('uIntensity'), 1);
          this.quad.draw();
          this.draws++;
        }
      }
    }
  }
}
