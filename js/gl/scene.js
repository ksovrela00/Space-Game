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

import {
  createContext, rendererName, resizeCanvas, watchContextLoss, renderScale,
} from './context.js';
import { GpuTimer } from './gputime.js';
import { buildProgram } from './program.js';
import {
  MESH_VS, MESH_FS, MESH_FS_DETAIL, STARS_VS, STARS_FS, GLOW_VS, GLOW_FS,
  ATMO_VS, ATMO_FS, RING_VS, RING_FS, BAKE_VS, BAKE_FS,
  PLUME_VS, PLUME_FS, WARP_VS, WARP_FS, TUNNEL_VS, TUNNEL_FS, MOTE_VS, MOTE_FS,
  BOLT_VS, BOLT_FS, SHIELD_VS, SHIELD_FS,
  WARPTUN_VS, WARPTUN_FS,
  SKY_VS, SKY_FS, SKY_BAKE_VS, SKY_BAKE_FS, FOREST_VS,
} from './shaders.js';
import { ForestField } from './forestfield.js';
import { TREE_PROFILES, FAR as FOREST_FAR, thinAt } from './forest.js';
import { skyFor, skyUniforms, SKY_GAIN } from './nebula.js';
import {
  detailUniforms, tileDetailUniforms, makeDetailLoad, updateDetailLoad,
  plateUniforms, mountUniforms, FW_TARGET_GPU, FW_TARGET_CPU, FW_MAX,
} from './detail.js';
import { terrainOf } from './terrain.js';
import { edgeAngle } from './icosphere.js';
import { Baker, createBlankTexture, createSkyTexture, CUBE_FACES } from './bake.js';
import { TileSet } from './tiles.js';
import { loadGround, grainOrigin, grainPerUnit, GROUND, GRAIN_MAX_SPAN } from './ground.js';
import { tileKey, tileTexelAngle, tileCellAngle, TILE_MAX_LEVEL } from './quadtree.js';
import {
  SHIP_SHADOW, shadowFrame, shadowMatrix, hullRadius, depthVs, DEPTH_FS, makeShadowArray,
} from './shipshadow.js';
import { loadStationTex, stationK, STATION_TEX } from './stationtex.js';
import { cityLocal } from '../game/city.js';

import { localDir, altitudeOf } from '../game/surface.js';
import { ENTRY } from '../game/entry.js';
import { L } from '../core/lang.js';
import { SHIELD_AXES } from '../models/ships.js';
import { stageLift } from '../models/gear.js';
import { hullOf, podOf, ROOMS_TYPE } from '../models/hulls.js';
import { HULL } from '../game/hull.js';
import { lampBeams, lampCone, LAMP } from '../game/lamps.js';
import { washState, makeWash, engineLoad } from '../game/downwash.js';
import { lightLevel } from '../models/hulldetail.js';
import { washUniforms } from './wash.js';

import {
  buildFlatMesh, buildIndexedMesh, buildPointsMesh, buildQuad, buildRingMesh,
  buildWarpMesh, buildMoteMesh, buildShockMesh, buildBoltBuffer,
} from './mesh.js';
import { makeRng } from '../core/rng.js';
import { icosphere } from './icosphere.js';
import {
  requestPlanetMesh, pumpBuilds, pendingBuilds, planetLevel, disposePlanetMeshes,
} from './planetmesh.js';
import { SurfacePatch, PATCH } from './patches.js';
import { RockField } from './rocks.js';
import { FloraField } from './flora.js';
import { CityField, SHADE_MAX, shadeBoxes } from './citymesh.js';
import { perspective, modelView, dirToCamera, logDepthCoef } from './mat4.js';
import { makeBasis, lookAlong, toLocal, toWorld } from '../core/basis.js';
import { bodyBasis } from '../game/world.js';
import { warpPower } from '../game/warp.js';
import { FLOW } from '../game/flow.js';
import { Q } from '../core/quality.js';
import { buildCockpit } from '../models/cockpit.js';
import { CabinView, sunVisibility } from './cabin.js';
import { SuitView } from './spacesuit.js';
import { seatPlace } from '../models/spacesuit.js';
import { CARVE_MAX } from './hull.js';
import { hatchCut, hatchPanelAt, stairPose, bayCut } from '../game/airlock.js';
import { buildStairMesh, buildHatchMesh, buildCableMesh } from '../models/airstair.js';
import { waveSet, waterFrame, makeWaterFrame } from './water.js';
import { seesOutside, seesHull } from '../models/interior.js';
import { interiorOf } from '../game/stationplan.js';

// Пилот за бортом: на трапе или на грунте (js/game/walker.js, out).
// Дальше этого людей не рисуем, км: человек в двух метрах ростом с
// шестисот метров — меньше пикселя на любом экране.
const PEOPLE_FAR = 0.6;

const walkingOut = (game) => !!(game.walk && game.walk.on && game.walk.out);

/**
 * Корабль кадра — тот, в чьих помещениях глаз (js/main.js, game.frame):
 * свой или чужой, на палубе которого стоит пилот. Без игры — свой.
 */
const frameOf = (game) => game.frame || game.ship;
/** Шлюзы корабля V: у своего — помещений, у чужого — свои (js/game/airlock.js, makeAir). */
const airOf = (game, V) => (V && !V.own && V !== game.ship ? V.air
  : (game.ownAir ? game.ownAir() : (game.interior && game.interior.air))) || null;
/** Стоит ли пилот на палубе ЧУЖОГО корабля: тогда свой виден снаружи. */
const inForeign = (game) => !!(game.walk && game.walk.on && !game.walk.out && game.frame && !game.frame.own
  && game.frame !== game.ship);

// Насколько мягко спадает к краю обычное свечение (солнце, выхлоп, огни).
const GLOW_FALLOFF = 2.5;
const NEAR = 0.004;          // 4 метра
// Рубка — свой корпус изнутри и пост пилота — рисуется своим проходом
// (drawCockpit): фонарь над головой в метре с небольшим, и с ближней
// плоскостью сцены в четыре метра от него не осталось бы ни стойки. Там
// своя проекция — от четырёх сантиметров до двухсот пятидесяти метров
// (весь корпус), и своя логарифмическая глубина на этот отрезок: на нём
// она различает сотые доли миллиметра.
//
// Сделать ближнюю плоскость маленькой у всей сцены нельзя, и это было
// проверено кадром: проход неба сравнивает глубину без логарифма, и с
// тридцатью сантиметрами небо легло поверх грунта — земля пропала.
const NEAR_BRIDGE = 4e-5;          // км
// Пилот на ногах: грунт у самых ног и ступени трапа ближе четырёх метров,
// и с ближней плоскостью сцены их не было бы. Сантиметры здесь
// безопасны: все проходы с глубиной пишут её логарифмом (LOG_DEPTH_FRAG),
// а небо и звёзды рисуются без проверки глубины — снимок грунта с такой
// плоскостью это подтвердил (небо поверх земли не ложится).
//
// Она же — у вездехода в виде из кабины. Его глаз в кресле на 2.35 м над
// грунтом, и с плоскостью в четыре метра грунт пропадал из кадра ЦЕЛИКОМ —
// с камнями, одно небо (снимок rovercab); с этой — на месте. А вид сзади с
// ней терял грунт так же (снимок rover) и с четырьмя метрами его видит —
// там камера не опускается ниже 4.5 м над грунтом (js/game/drivecam.js, over).
const NEAR_FOOT = 5e-5;            // км
const FAR_BRIDGE = 0.25;           // км
const FAR = 2e9;             // с запасом на всю систему
const CULL_SLACK = 0.002;    // км — запас сферы меша при отсеве за кадром (seen)
const AMBIENT = 0.14;
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
/** Холодный цвет щита: он не должен путаться с огнём попадания. */
const SHIELD_TINT = new Float32Array([0.42, 0.72, 1.0]);
/** Полуоси оболочки: она повторяет габарит корпуса (js/models/ships.js). */
// Оболочка щита — по текущему корпусу (js/game/hull.js), к кадру.
const SHIELD_SCALE = new Float32Array(SHIELD_AXES);
// Сколько пылинок стоит в ячейке решётки (js/game/flow.js, FLOW.box).
// Четыре сотни на два километра — это крошка на каждые триста метров:
// в кадре десятки черт. Считать их нечем и незачем: буфер статический,
// на кадр приходится один вызов отрисовки.
const MOTE_COUNT = Q.motes;
// Оптическая толщина воздуха ВЕРТИКАЛЬНО ВВЕРХ от поверхности, при
// давлении в одну атмосферу: сколько света воздух СЪЕДАЕТ. Настоящий
// воздух в этом смысле почти прозрачен — ночью сквозь него видны
// звёзды, с орбиты видно грунт, — поэтому и число маленькое.
export const ATMO_THICK = 0.2;
// Во сколько раз свечение «быстрее» гашения. Небо голубое не потому,
// что воздух непрозрачный, а потому, что он сам светится рассеянным
// солнцем: вертикально он съедает пятую часть света, но днём это уже
// небо. Одним числом эти две вещи задавать нельзя — пробовали, и
// получилась молочная планета с орбиты (см. ATMO_FS).
//
// Честное однократное рассеяние дало бы ровно единицу: сколько света
// из луча ушло, столько в него и пришло. Двойка — надбавка за
// многократное рассеяние и за то, что у нас нет ни тоновой
// компрессии, ни адаптации глаза, а настоящее небо кажется ярче своей
// яркости именно из-за них. Больше брать нельзя: при восьмёрке диск
// планеты с двухсот километров светился в надир на 79%, то есть грунт
// пропадал под ровной синевой.
export const ATMO_GLOW = 2;
const MIN_PIXELS = 0.4;      // тела мельче — не рисуем
// Карта (renderMap): рассеянный свет ярче полётного — ночная сторона
// планеты на карте должна читаться шаром, а не дырой; ближняя плоскость —
// своя: камера карты подходит к телу на пару его радиусов.
const MAP_AMBIENT = 0.3;
const MAP_NEAR = 1e-3;
const BUILD_MS = 2.5;        // бюджет на досборку мешей тел за кадр

// Подсветка корабля в варп-тоннеле. Вчетверо выше обычной: теней в
// тоннеле нет, есть свечение со всех сторон, и с обычным значением
// корабль читался чёрным силуэтом.
const WARP_AMBIENT = 0.55;

// Цвет звезды для варп-тоннеля, 0..1. Тоннель окрашен в свет той звезды,
// ОТКУДА летим, и к концу перекрашивается в свет той, КУДА: выходя из
// прыжка, видишь снаружи ровно тот оттенок, в котором летел последние
// секунды. Белая подложка (0.35) нужна, чтобы у красного карлика тоннель
// не выродился в один оранжевый канал и не потерял объём.
const _tint = new Float32Array(3);
// Куда попадает камера в осях города: пересчитывается каждый кадр, и
// заводить под это объект каждый раз незачем.
const _cityAt = { x: 0, y: 0, z: 0 };
// Направление на звезду в осях города: по нему кладутся тени.
const _citySun = { x: 0, y: 0, z: 0 };
// Где фара и куда светит — в осях города: по этому отбираются
// постройки, кладущие тень (js/gl/citymesh.js).
const _lampAt = { x: 0, y: 0, z: 0 };
const _lampCone = { x: 0, y: 0, z: 0, cos: 1 };
function starTint(sys) {
  const c = sys && sys.cls ? sys.cls.color : [255, 226, 168];
  for (let i = 0; i < 3; i++) _tint[i] = 0.35 + 0.65 * (c[i] / 255);
  return _tint;
}
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
    this.culled = 0;
    // Отсев за кадром (seen): ?cull=0 выключает — сравнить кадр с ним и без.
    this.cull = new URLSearchParams(
      typeof location !== 'undefined' ? location.search : '').get('cull') !== '0';
    this.cullTanX = 1; this.cullTanY = 1; this.cullCosX = 1; this.cullCosY = 1;
    if (!this.ok) {
      this.error = L('WebGL2 недоступен');
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
    // Мелкий рельеф на пиксель — самая дорогая работа в кадре: она идёт
    // на каждый закрашенный пиксель поверхности. На телефоне его нет по
    // профилю (js/core/quality.js), и это главный выигрыш кадра.
    this.detailOn = Q.detail && new URLSearchParams(
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
    // Дальний лес (js/gl/forest.js): свой вершинный шейдер, общий
    // фрагментный — освещение и дымка те же, что у всего остального. Не
    // собрался — лес остаётся полем у корабля, как было.
    try {
      this.pForest = buildProgram(gl, 'forest', FOREST_VS, MESH_FS);
    } catch (e) {
      console.error('Дальний лес не собрался, рисуем без него:\n' + e.message);
      this.pForest = null;
    }
    // Люди в скафандрах (js/gl/spacesuit.js): модель и программы — при
    // первом человеке в кадре.
    this.suit = new SuitView(gl);
    this.pStars = buildProgram(gl, 'stars', STARS_VS, STARS_FS);
    this.pGlow = buildProgram(gl, 'glow', GLOW_VS, GLOW_FS);
    this.pAtmo = buildProgram(gl, 'atmo', ATMO_VS, ATMO_FS);
    this.pRing = buildProgram(gl, 'ring', RING_VS, RING_FS);
    this.pPlume = buildProgram(gl, 'plume', PLUME_VS, PLUME_FS);
    this.pWarp = buildProgram(gl, 'warp', WARP_VS, WARP_FS);
    this.pTunnel = buildProgram(gl, 'tunnel', TUNNEL_VS, TUNNEL_FS);
    this.pWarpTun = buildProgram(gl, 'warptun', WARPTUN_VS, WARPTUN_FS);
    this.pMote = buildProgram(gl, 'mote', MOTE_VS, MOTE_FS);
    this.pBolt = buildProgram(gl, 'bolt', BOLT_VS, BOLT_FS);
    this.pShield = buildProgram(gl, 'shield', SHIELD_VS, SHIELD_FS);
    // Кабина (js/gl/cabin.js): свои шейдеры, тени и экраны. Не соберётся
    // — вид из кабины останется без неё, а не без игры; причина — в
    // консоли и в cabinError (её показывает tools/screen.mjs).
    try {
      this.cabin = new CabinView(gl, { shadow: Q.cabinShadow });
      this.cabinError = null;
    } catch (e) {
      console.error('Кабина не собралась:\n' + e.message);
      this.cabin = null;
      this.cabinError = e.message;
    }

    // Небо: полоса галактического диска и туманности (js/gl/nebula.js).
    // Не соберётся — сцена остаётся рабочей, фон просто чёрный, как был.
    this.skyOn = true;
    try {
      this.pSky = buildProgram(gl, 'sky', SKY_VS, SKY_FS);
      this.pSkyBake = buildProgram(gl, 'skybake', SKY_BAKE_VS, SKY_BAKE_FS);
      this.skyQuad = buildQuad(gl, this.pSky.attrib('aQuad'));
      this.skyBakeQuad = buildQuad(gl, this.pSkyBake.attrib('aQuad'));
    } catch (e) {
      console.error('Небо не собралось, фон остаётся чёрным:\n' + e.message);
      this.skyOn = false;
    }
    // Текстура неба печётся по грани за кадр при первом же кадре: seed
    // системы известен только оттуда (см. updateSky).
    this.skyTex = null;
    this.sky = null;
    this.skySeed = null;      // семя системы, под которое испечено небо
    this.skyFace = 0;
    this.skyScale = new Float32Array(2);

    this.meshLocs = {
      aPos: this.pMesh.attrib('aPos'),
      aNormal: this.pMesh.attrib('aNormal'),
      aColor: this.pMesh.attrib('aColor'),
      aUv: this.pMesh.attrib('aUv'),
      aGrain: this.pMesh.attrib('aGrain'),
      // Изгиб растений под струёй (js/gl/wash.js) и материал обшивки
      // корабля (js/gl/hull.js): у остальных сеток этих атрибутов нет.
      aBend: this.pMesh.attrib('aBend'),
      aMat: this.pMesh.attrib('aMat'),
    };
    this.atmoLocs = { aPos: this.pAtmo.attrib('aPos') };
    this.ringLocs = { aPos: this.pRing.attrib('aPos'), aT: this.pRing.attrib('aT') };
    this.plumeLocs = {
      aPos: this.pPlume.attrib('aPos'),
      aNormal: this.pPlume.attrib('aNormal'),
    };
    // Оболочка ударной волны строится из меша корабля, а он приходит
    // только с игрой — поэтому по первому требованию (drawEntryPlume).
    this.shockMesh = null;
    this.shockSrc = null;
    this.tmpFlow = { x: 0, y: 0, z: 0 };
    this.originZero = { x: 0, y: 0, z: 0 };

    // Оболочка атмосферы — одна на все планеты, масштаб задаёт матрица.
    //
    // Уровень 4, а не 3: меш вписан в сферу, то есть его силуэт чуть
    // УЖЕ настоящего верха воздуха. На уровне 3 у самой границы
    // атмосферы этот срез виден как отрезанный край дуги; на четвёртом
    // расхождение вчетверо меньше, а стоит оболочка всё тот же один
    // вызов на планету.
    const shell = icosphere(4);
    this.atmoMesh = buildIndexedMesh(gl, this.atmoLocs, {
      positions: shell.positions,
      indices: shell.indices,
    });
    // Оболочка щита — та же сфера, но СВОЙ буфер: расположение атрибутов
    // у каждой программы своё, и делить один VAO между двумя нельзя.
    // Уровень ниже: щит размером с корабль, и гранями его не разглядеть.
    const shieldShell = icosphere(3);
    this.shieldLocs = { aPos: this.pShield.attrib('aPos') };
    this.shieldMesh = buildIndexedMesh(gl, this.shieldLocs, {
      positions: shieldShell.positions,
      indices: shieldShell.indices,
    });

    this.quad = buildQuad(gl, this.pGlow.attrib('aQuad'));
    this.bolts = buildBoltBuffer(gl, {
      aPos: this.pBolt.attrib('aPos'),
      aUv: this.pBolt.attrib('aUv'),
      aColor: this.pBolt.attrib('aColor'),
    });
    // Тень своего корабля — картой глубины от солнца (js/gl/shipshadow.js).
    // Проход глубины рисует те же буферы корпуса, что и общая программа,
    // поэтому место атрибута у него то же. Карта и её буфер создаются
    // сразу и живут всю игру; не собрались — тени нет, игра остаётся.
    this.shipShadow = null;
    this.shipShadowOn = 0;
    this.shipShadowPasses = 0;
    try {
      this.pShipDepth = buildProgram(gl, 'ship-shadow', depthVs(this.meshLocs.aPos, this.meshLocs.aMat), DEPTH_FS);
      this.shipShadow = makeShadowArray(gl, SHIP_SHADOW.size, SHIP_SHADOW.layers);
    } catch (e) {
      console.error('Тень корабля не собралась, рисуем без неё:\n' + e.message);
    }
    this.shipShadowMat = new Float32Array(16);
    this.shipShadowFrame = null;
    // Слои карт этого кадра: кто отбрасывает тень (свой, чужие, станция)
    // и оси его карты (updateShipShadow).
    this.shadowLayers = [];
    this.shadowN = 0;
    this.shadowWho = [];
    // Сэмплер карты у программ сеток — один раз и навсегда на своём
    // блоке, и карта на нём лежит всегда: выборка со сравнением из
    // чужой текстуры — неопределённое поведение.
    for (const p of [this.pMesh, this.pForest]) {
      if (!p) continue;
      p.use();
      gl.uniform1i(p.loc('uShipShadow'), SHIP_SHADOW.unit);
      gl.uniform1f(p.loc('uShipShadowOn'), 0);
    }
    gl.activeTexture(gl.TEXTURE0 + SHIP_SHADOW.unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shipShadow ? this.shipShadow.tex : null);
    gl.activeTexture(gl.TEXTURE0);
    // Фактуры станции (js/gl/stationtex.js) — на своём блоке, привязаны
    // всегда: сэмплер массива на блоке 0 рядом с плоской текстурой сорвал
    // бы каждую отрисовку сеток.
    this.stationTex = loadStationTex(gl);
    for (const p of [this.pMesh, this.pForest]) {
      if (!p) continue;
      p.use();
      gl.uniform1i(p.loc('uStationTex'), STATION_TEX.unit);
      gl.uniform1fv(p.loc('uStationK'), stationK());
    }
    this.stars = this.buildStars();
    // Поток частиц прыжка. Строится один раз на запуск и от звёзд не
    // зависит вовсе: звёзды бесконечно далеко и лететь мимо не могут.
    this.warp = buildWarpMesh(gl, {
      aParam: this.pWarp.attrib('aParam'),
      aT: this.pWarp.attrib('aT'),
    }, WARP_COUNT, makeRng(0x7a12));
    this.tunnelQuad = buildQuad(gl, this.pTunnel.attrib('aQuad'));
    this.warpTunQuad = buildQuad(gl, this.pWarpTun.attrib('aQuad'));
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
    // Кабина собирается по первому требованию: в виде от третьего лица
    // она не нужна вовсе, а модель не бесплатная.
    this.cockpit = null;
    this.blankTex = createBlankTexture(gl);

    // Ручки в адресной строке (см. README, «Ручки в адресной строке»).
    const q = new URLSearchParams(
      typeof location !== 'undefined' ? location.search : '');

    // Фотография грунта (js/gl/ground.js). Возвращается сразу, пустая:
    // до земли ещё лететь, и ждать картинок в первом кадре незачем.
    //
    // `?photo=0` оставляет текстуры нейтральными — это тот же кадр без
    // фотографии, снятый той же сборкой. Иначе сравнивать «с ней и без
    // неё» пришлось бы правкой кода, а значит и другой сборкой.
    this.ground = loadGround(gl,
      q.get('photo') === '0' ? (src, on, fail) => fail() : undefined);
    // `?wash=0` — тот же кадр без струи движков на растениях (js/gl/wash.js):
    // изгиб к камере или от неё по одному снимку не разглядеть, а по
    // разнице двух снимков — сразу.
    this.washKnob = q.get('wash') !== '0';
    // `?water=0` — море без своего шейдера (js/gl/water.js; под водой тогда
    // виден песок дна — это замер, а не вид), `?rocks=0` — без камней. Обе — чтобы мерить цену: разница «карты» в отладке
    // (`~`) с ними и без них и есть то, что стоят вода и камни.
    this.waterKnob = q.get('water') !== '0';
    this.rocksKnob = q.get('rocks') !== '0';
    this.patch = new SurfacePatch(gl, this.meshLocs);
    // Камни у самой поверхности: предметы известного размера, по которым
    // глаз и меряет высоту (см. js/gl/rocks.js).
    this.rocks = new RockField(gl, this.meshLocs);
    this.forest = this.pForest && q.get('forest') !== '0' ? new ForestField(gl, this.pForest) : null;
    this.forestDraws = 0;
    this.forestTrees = 0;
    // Растительность: деревья, кусты, трава (js/gl/flora.js). Поле
    // отдельное от камней, потому что видно его в пять раз дальше и
    // пересобирается оно по своим порогам.
    this.flora = new FloraField(gl, this.meshLocs);
    // Наземный город: сто тысяч граней, собираемых порциями и один раз
    // (js/gl/citymesh.js). Рисуется как обычный предмет — со своим
    // положением и базисом, а не в долях радиуса тела.
    this.city = new CityField(gl, this.meshLocs);
    this.cityDraws = 0;

    // Поверхность плитками: геометрия и текстуры считаются по одному
    // разу на плитку и живут в кэше (js/gl/tiles.js). Прежний путь —
    // заплатки под кораблём с процедурной деталью на пиксель — остаётся
    // по `?surface=clipmap` для сравнения картинки.
    this.tilesOn = (q.get('surface') || 'tiles') === 'tiles';
    // Проход запекания общий: и у плиток поверхности, и у неба. Это один
    // кадровый буфер, поэтому держать их раздельно незачем.
    this.baker = new Baker(gl);
    if (this.tilesOn) {
      try {
        this.pBake = buildProgram(gl, 'bake', BAKE_VS, BAKE_FS);
        this.bakeQuad = buildQuad(gl, this.pBake.attrib('aQuad'));
        this.tiles = new TileSet(gl, this.meshLocs, this.baker, this.pBake, this.bakeQuad);
      } catch (e) {
        console.error('Запекание поверхности не собралось, рисуем заплатками:\n' + e.message);
        this.tilesOn = false;
      }
    }

    // Цена кадра: таймер карты (js/gl/gputime.js) и регулятор
    // детализации (js/gl/detail.js). `?fw=N` закрепляет множитель следа
    // пикселя: 1 — всегда полная резкость, как было до регулятора,
    // больше — насильно грубее. Это и есть способ посмотреть глазами,
    // чем деталь платит за кадры.
    this.gpuTimer = new GpuTimer(gl);
    this.detailLoad = makeDetailLoad();
    const fwPin = parseFloat(q.get('fw'));
    this.fwPin = Number.isFinite(fwPin) ? Math.max(1, Math.min(FW_MAX, fwPin)) : 0;
    this.fwScale = this.fwPin || 1;
    this.frameMs = 0;
    this.lastFrame = 0;
    // Масштаб буфера кадра (`?scale=`). Читается один раз: менять его на
    // ходу значит пересобирать буферы посреди полёта.
    this.scale = renderScale();

    this.proj = new Float32Array(16);
    this.mv = new Float32Array(16);
    this.nrm = new Float32Array(9);
    this.viewMat3 = new Float32Array(9);
    this.sunDir = new Float32Array(3);
    this.tmp3 = new Float32Array(3);
    // Фары: два луча, положение и направление в осях камеры.
    this.lampPos = new Float32Array(6);
    this.lampDir = new Float32Array(6);
    this.lampCos = new Float32Array(4);
    this.lampDir3 = new Float32Array(3);
    // Тени от фар: коробки ближайших построек и оси города.
    this.shadeA = new Float32Array(SHADE_MAX * 4);
    this.shadeB = new Float32Array(SHADE_MAX * 4);
    this.cityOrg = new Float32Array(3);
    this.cityAxes = new Float32Array(9);
    // Зал станции: её центр и оси в осях камеры (setHall).
    this.hallO = new Float32Array(3);
    this.hallM = new Float32Array(9);
    this.hallUp = new Float32Array(3);
    this.axis3 = new Float32Array(3);
    this.basisTmp = makeBasis();
    // Единичный базис: им берут матрицу ЧИСТОГО поворота камеры для
    // точек, уже посчитанных относительно неё (см. drawBolts).
    this.identBasis = makeBasis();
    this.tmpPos = { x: 0, y: 0, z: 0 };
    this.jsMeshes = new WeakMap();
    this.logFC = logDepthCoef(FAR);

    watchContextLoss(this.canvas,
      () => { this.ok = false; this.error = L('контекст WebGL потерян'); },
      () => { this.jsMeshes = new WeakMap(); this.init(); this.ok = true; });
  }

  /**
   * Заменить звёздный фон на фон другой системы.
   *
   * Звёзды и туманности берутся из одного семени, поэтому при переходе
   * меняются вместе: наклон галактической полосы над чужой звездой
   * обязан быть другим, иначе прилетел ты куда угодно, а небо осталось
   * домашнее. Старый буфер удаляется сразу — точек там тысячи.
   */
  setStarfield(src) {
    this.starfieldSrc = src;
    if (this.stars) this.stars.dispose();
    this.stars = this.buildStars();
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
    const changed = resizeCanvas(this.gl, this.canvas, Q.maxDpr, this.scale);
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

  /**
   * Положение точки в осях камеры (км, БЕЗ нормировки).
   *
   * Нужно атмосфере: она пересекает луч со сферами тела и потому должна
   * знать, где центр. Считается в double и приводится к float32 уже как
   * смещение от камеры — как и все остальные координаты в сцене.
   */
  centerInCamera(pos, out = this.tmp3) {
    const b = this.camera.basis, c = this.camera.pos;
    const dx = pos.x - c.x, dy = pos.y - c.y, dz = pos.z - c.z;
    out[0] = dx * b.right.x + dy * b.right.y + dz * b.right.z;
    out[1] = dx * b.up.x + dy * b.up.y + dz * b.up.z;
    out[2] = dx * b.fwd.x + dy * b.fwd.y + dz * b.fwd.z;
    return out;
  }

  /**
   * Фары корабля — в uniform-ы меша.
   *
   * Всё считается В ОСЯХ КАМЕРЫ, как и вся сцена: положение лампы
   * приводится к камере в double и только потом в float32. Если бы
   * лампа уехала в шейдер мировыми координатами, на орбите в четыре
   * миллиона километров от неё осталась бы труха — тот же довод, что и
   * для всей сцены.
   *
   * Ставится ОДИН РАЗ НА ПРОХОД, а не на объект: лампы одни и те же для
   * всего, что рисуется этой программой.
   */
  setLamps(prog, game) {
    const gl = this.gl;
    const beams = (game && game.ship) ? lampBeams(game.ship) : [];
    gl.uniform1i(prog.loc('uLampN'), beams.length);
    if (!beams.length) return 0;
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      this.centerInCamera(b.pos, this.tmp3);
      this.lampPos[i * 3] = this.tmp3[0];
      this.lampPos[i * 3 + 1] = this.tmp3[1];
      this.lampPos[i * 3 + 2] = this.tmp3[2];
      dirToCamera(this.camera.basis, b.dir.x, b.dir.y, b.dir.z, this.lampDir3);
      this.lampDir[i * 3] = this.lampDir3[0];
      this.lampDir[i * 3 + 1] = this.lampDir3[1];
      this.lampDir[i * 3 + 2] = this.lampDir3[2];
      this.lampCos[i * 2] = b.cosIn;
      this.lampCos[i * 2 + 1] = b.cosOut;
    }
    // Имена с «[0]»: у массива uniform-ов адрес спрашивают по первому
    // элементу. Без скобок часть драйверов (и программный растеризатор,
    // на котором снимаются кадры) возвращает null, а запись по null —
    // молчаливый пропуск: фары «включались» и не светили.
    gl.uniform3fv(prog.loc('uLampPos[0]'), this.lampPos);
    gl.uniform3fv(prog.loc('uLampDir[0]'), this.lampDir);
    gl.uniform2fv(prog.loc('uLampCos[0]'), this.lampCos);
    gl.uniform1f(prog.loc('uLampRange'), LAMP.range);
    gl.uniform1f(prog.loc('uLampPower'), LAMP.power);
    return beams.length;
  }

  /**
   * Тени построек от фар — в uniform-ы меша.
   *
   * Ставится ОДИН РАЗ НА ПРОХОД, рядом с самими фарами и по той же
   * причине: коробки нужны и грунту, и городу, и кораблю — всё это
   * рисуется одной программой, и тень одного дома должна лечь на всё
   * разом.
   *
   * Отбор — в осях города (js/gl/citymesh.js, shadeBoxes), а в шейдер
   * едут оси: фрагмент приходит в координатах камеры и переводится в
   * городские одним поворотом. Держать коробки в осях камеры нельзя —
   * их пришлось бы пересчитывать на каждый поворот головы.
   */
  setCityShade(prog, game) {
    const gl = this.gl;
    const city = this.city.city;
    const beams = (city && this.lamps && game && game.ship) ? lampBeams(game.ship) : [];
    let n = 0;
    if (beams.length) {
      cityLocal(city, beams[0].pos, _lampAt);
      // Грубая отсечка: луч не достаёт до города вовсе. Иначе перебор
      // тысяч коробок шёл бы каждый кадр и с орбиты.
      const far = city.radius + LAMP.range;
      if (Math.abs(_lampAt.y) < far && Math.hypot(_lampAt.x, _lampAt.z) < far) {
        const cone = lampCone(beams);
        const b = city.basis;
        _lampCone.x = cone.x * b.right.x + cone.y * b.right.y + cone.z * b.right.z;
        _lampCone.y = cone.x * b.up.x + cone.y * b.up.y + cone.z * b.up.z;
        _lampCone.z = cone.x * b.fwd.x + cone.y * b.fwd.y + cone.z * b.fwd.z;
        _lampCone.cos = cone.cos;
        n = shadeBoxes(city.plan, _lampAt, _lampCone, LAMP.range, city.groundR,
          this.shadeA, this.shadeB);
      }
    }
    gl.uniform1i(prog.loc('uShadeN'), n);
    if (!n) return 0;
    this.centerInCamera(city.pos, this.cityOrg);
    // Столбцы матрицы — оси города в осях камеры: в шейдере p * M даёт
    // ровно три скалярных произведения, то есть перевод в оси города.
    const bs = city.basis;
    const axes = [bs.right, bs.up, bs.fwd];
    for (let i = 0; i < 3; i++) {
      dirToCamera(this.camera.basis, axes[i].x, axes[i].y, axes[i].z, this.axis3);
      this.cityAxes[i * 3] = this.axis3[0];
      this.cityAxes[i * 3 + 1] = this.axis3[1];
      this.cityAxes[i * 3 + 2] = this.axis3[2];
    }
    gl.uniform3fv(prog.loc('uCityOrg'), this.cityOrg);
    gl.uniformMatrix3fv(prog.loc('uCityAxes'), false, this.cityAxes);
    gl.uniform4fv(prog.loc('uShadeA[0]'), this.shadeA);
    gl.uniform4fv(prog.loc('uShadeB[0]'), this.shadeB);
    return n;
  }

  /**
   * Станция, в зал которой смотрит глаз: ближайшая, и не дальше её
   * габарита с запасом. В зале своё освещение (shaders.js, hallAt), а
   * снаружи коробка зала ничего не задевает — зал виден разве что сквозь
   * щель, и светится он там своим светом.
   */
  hallStation(game) {
    const cam = this.camera;
    let best = null, bd = Infinity;
    for (const st of (game.world && game.world.stations) || []) {
      const d = Math.hypot(st.pos.x - cam.pos.x, st.pos.y - cam.pos.y, st.pos.z - cam.pos.z);
      if (d < st.radius * 1.4 && d < bd) { bd = d; best = st; }
    }
    return best;
  }

  /**
   * Свет зала станции — в uniform-ы сеток. Ставится на проход, как фары:
   * в зале одной программой рисуются и станция, и корабли на площадках, и
   * их стойки, трапы и люди.
   */
  setHall(prog, game) {
    const gl = this.gl;
    const st = this.hallStation(game);
    gl.uniform1f(prog.loc('uHallOn'), st ? 1 : 0);
    if (!st) return null;
    const cam = this.camera;
    this.centerInCamera(st.pos, this.hallO);
    const axes = [st.basis.right, st.basis.up, st.basis.fwd];
    for (let i = 0; i < 3; i++) {
      dirToCamera(cam.basis, axes[i].x, axes[i].y, axes[i].z, this.axis3);
      this.hallM[i * 3] = this.axis3[0];
      this.hallM[i * 3 + 1] = this.axis3[1];
      this.hallM[i * 3 + 2] = this.axis3[2];
    }
    dirToCamera(cam.basis, st.basis.up.x, st.basis.up.y, st.basis.up.z, this.hallUp);
    const V = this._hallBox || (this._hallBox = {});
    let box = V[st.type];
    if (!box) {
      // С запасом в три метра наружу: пол, стены и потолок зала лежат
      // РОВНО на границе коробки, и без запаса половина их пикселей
      // проходила проверку, а половина — нет (сыпь из солнечных и
      // зальных точек по всему полу).
      const I = interiorOf(st.type);
      const m = 0.003;
      const km = (a, s) => a.map((v) => v / 1000 + s * m);
      const t = I.tunnel;
      box = V[st.type] = {
        lo: km(I.hall.lo, -1), hi: km(I.hall.hi, 1),
        tlo: [-t.hw / 1000 - m, -t.hh / 1000 - m, t.z0 / 1000 - m], thi: [t.hw / 1000 + m, t.hh / 1000 + m, st.shape.D + m],
      };
    }
    gl.uniform3fv(prog.loc('uHallO'), this.hallO);
    gl.uniformMatrix3fv(prog.loc('uHallM'), false, this.hallM);
    gl.uniform3fv(prog.loc('uHallLo'), box.lo);
    gl.uniform3fv(prog.loc('uHallHi'), box.hi);
    gl.uniform3fv(prog.loc('uTunLo'), box.tlo);
    gl.uniform3fv(prog.loc('uTunHi'), box.thi);
    gl.uniform3fv(prog.loc('uHallUp'), this.hallUp);
    // Рассеянный, сверху (ряды под потолком), снизу (отражённый от пола) и
    // сбоку (от светлых стен): в настоящих ангарах стены светлые, и чёрным
    // провалом зал не читается.
    gl.uniform4f(prog.loc('uHallLight'), 0.40, 0.52, 0.14, 0.22);
    return st;
  }

  /** Погасить фары для прохода, которому они не нужны (кабина, варп). */
  noLamps(prog) {
    this.gl.uniform1i(prog.loc('uLampN'), 0);
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

  /**
   * Цена кадра и деталь по ней.
   *
   * Замер относится к ПРЕДЫДУЩЕМУ кадру (ответ таймера приходит с
   * задержкой), поэтому берётся до начала нового. Длительность кадра
   * сглаживается: она скачет и при ровной картинке, а пауза больше
   * половины секунды — это не нагрузка, а свёрнутое окно.
   */
  updateDetailBudget() {
    const now = performance.now();
    const period = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;
    if (period > 0 && period < 500) {
      this.frameMs = this.frameMs > 0
        ? this.frameMs + (period - this.frameMs) * 0.1
        : period;
    }
    const gpu = this.gpuTimer.poll();
    if (this.fwPin > 0) { this.fwScale = this.fwPin; return; }
    this.fwScale = this.gpuTimer.available && gpu > 0
      ? updateDetailLoad(this.detailLoad, gpu, FW_TARGET_GPU)
      : updateDetailLoad(this.detailLoad, this.frameMs, FW_TARGET_CPU);
  }

  applyDetail(prog, u) {
    const gl = this.gl;
    gl.uniform1f(prog.loc('uDetail'), u.on);
    if (!u.on) return;
    gl.uniform1f(prog.loc('uFwScale'), this.fwScale);
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
    // Горный слой (js/gl/terrain.js, «Горы»): общей функцией, чтобы два
    // списка uniform'ов не разъехались.
    mountUniforms(gl, prog, u);
    // Площадка наземного города (js/gl/terrain.js): на ней мелкого
    // рельефа нет. Нулевой радиус означает «площадки нет» — так тела без
    // города не платят за неё ничем.
    plateUniforms(gl, prog, u.plate);
  }

  /**
   * Попадает ли меш в кадр камеры: его сфера (mesh.bound) пересекает
   * пирамиду взгляда — боковые грани и плоскость глаза. Дальней плоскости
   * у сцены нет (логарифмическая глубина), и по ней не отсекаем.
   *
   * Только «рисовать или нет», а не «нужно ли»: что выбрано — плитки,
   * поля камней, уровни подробности — выбирается как раньше, и отвернулся
   * — грунт за спиной не грубеет. Видеокарта и сама не закрашивает пикселей
   * за кадром, но вершины и вызов она обрабатывает: у земли за кадром
   * 13–15% плиток грунта, сверху — до четверти.
   *
   * В проходе тени (depthEye — «камера» в солнце) не отсекаем: то, что за
   * кадром, бросает тень в кадр.
   */
  seen(mesh, pos, basis, scale) {
    const B = mesh.bound;
    if (!B || !this.cull || this.depthEye) return true;
    const cam = this.camera, cb = cam.basis, c = B.c;
    const dx = pos.x + (basis.right.x * c[0] + basis.up.x * c[1] + basis.fwd.x * c[2]) * scale - cam.pos.x;
    const dy = pos.y + (basis.right.y * c[0] + basis.up.y * c[1] + basis.fwd.y * c[2]) * scale - cam.pos.y;
    const dz = pos.z + (basis.right.z * c[0] + basis.up.z * c[1] + basis.fwd.z * c[2]) * scale - cam.pos.z;
    // Запас: трава гнётся под струёй двигателя в шейдере (wash), и сфера
    // по вершинам её не видит; плюс округления. Два метра и два процента.
    const r = B.r * Math.abs(scale) * 1.02 + CULL_SLACK;
    const z = dx * cb.fwd.x + dy * cb.fwd.y + dz * cb.fwd.z;
    if (z < -r) return false;
    const x = dx * cb.right.x + dy * cb.right.y + dz * cb.right.z;
    if ((Math.abs(x) - this.cullTanX * z) * this.cullCosX > r) return false;
    const y = dx * cb.up.x + dy * cb.up.y + dz * cb.up.z;
    if ((Math.abs(y) - this.cullTanY * z) * this.cullCosY > r) return false;
    return true;
  }

  drawObject(prog, mesh, pos, basis, scale, sunPos) {
    if (!this.seen(mesh, pos, basis, scale)) { this.culled++; return false; }
    const gl = this.gl;
    // В проходе глубины тени «камера» — солнце (updateShipShadow): те же
    // части корабля рисуются теми же вызовами, только в оси карты.
    const eye = this.depthEye || this.camera;
    modelView(eye.basis, eye.pos, basis, pos, scale, this.mv, this.nrm);
    gl.uniformMatrix4fv(prog.loc('uModelView'), false, this.mv);
    if (!this.depthEye) {
      gl.uniformMatrix3fv(prog.loc('uNormalMat'), false, this.nrm);
      gl.uniform3fv(prog.loc('uSunDir'), this.setSunDir(pos, sunPos));
    }
    mesh.draw();
    this.draws++;
    this.tris += mesh.faces || mesh.tris;
    return true;
  }

  render(game) {
    if (!this.ok) return;
    const gl = this.gl;
    const cam = this.camera;
    const world = game.world;
    const sunPos = world.star.pos;
    // Мировое время — общее у всех игроков (его ведёт сервер): по нему
    // бегут волны моря, и у всех они одни и те же (js/gl/water.js).
    this.worldTime = world.time;

    this.resize();
    this.updateDetailBudget();
    // Таймер охватывает весь кадр, включая запекание плиток: это тоже
    // работа карты, и регулятор обязан её видеть.
    this.gpuTimer.begin();
    this.tris = 0;
    this.draws = 0;
    this.culled = 0;
    this.rockDraws = 0;
    this.floraDraws = 0;
    this.cityDraws = 0;
    this.streamDraws = 0;
    this.moteDraws = 0;
    this.cabinDraws = 0;
    // Ступени стоек — по три вызова на стойку (js/models/gear.js): счёт
    // отдельно, чтобы сравнения «сколько стоит мир» мерили мир.
    this.gearDraws = 0;

    const aspect = this.canvas.width / this.canvas.height;
    const foot = (game.walk && game.walk.on) || (HULL.ground && game.state && game.state.view === 'cockpit');
    perspective(cam.fov, aspect, foot ? NEAR_FOOT : NEAR, FAR, this.proj);
    // Пирамида взгляда для отсева за кадром (seen): тангенсы половин угла
    // и косинусы для расстояния до боковых граней. Кабина рисуется со своей
    // ближней плоскостью, но с тем же углом и почти тем же соотношением
    // сторон — запаса в два процента хватает.
    this.cullTanY = Math.tan(cam.fov / 2) * 1.02;
    this.cullTanX = this.cullTanY * aspect;
    this.cullCosX = 1 / Math.hypot(1, this.cullTanX);
    this.cullCosY = 1 / Math.hypot(1, this.cullTanY);

    // Досборка геометрии и запекание поверхности — ДО настройки кадра.
    // Проход запекания рисует в свою текстуру: он меняет вьюпорт и
    // отключает тесты глубины, и если делать это после clear, весь
    // остальной кадр уйдёт в угол размером с текстуру плитки.
    this.pending = pendingBuilds();
    if (this.pending) pumpBuilds(gl, this.meshLocs, BUILD_MS);
    this.updatePatches(game);
    this.updateSky(world);
    // Видно ли из глаза то, что за бортом. Из глухой комнаты — нет, и
    // тогда мира снаружи в кадре нет вовсе (см. outsideSeen).
    this.outside = this.outsideSeen(game);
    // Карта тени корабля — тоже до настройки кадра: свой буфер и вьюпорт.
    // Изнутри глухой комнаты тень корабля падать не на что.
    if (this.outside) this.updateShipShadow(game, sunPos);

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

    // Под варп-тоннелем мира нет — ни в кадре, ни в памяти. Когда тоннель
    // непрозрачен, сцена не рисует НИЧЕГО, кроме него: половину этого
    // времени старая система уже выгружена, а новая ещё собирается.
    // Вместо отрисовки идёт прогрев — ровно то, ради чего прыжок и длится
    // полминуты.
    const cover = this.warpCover(game);
    if (cover > 0) {
      this.warmSystem(world);
      // Порядок важен: сперва СТЕНЫ, потом корабль. Тоннель —
      // полноэкранный аддитивный проход, и нарисованный поверх корабля он
      // ложился на него дымкой, а сам корабль темнел до силуэта. Он
      // находится ВНУТРИ тоннеля, а не за ним.
      this.drawWarpTunnel(game, cover);
      this.drawShipOnly(game);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      this.gpuTimer.end();
      return;
    }

    this.updateJump(game);
    if (this.outside) {
      this.drawStars();
      this.drawOpaque(game, world, sunPos);
      this.drawLocksOut(game, sunPos);
      this.drawTransparent(game, world, sunPos);
      this.drawMotes(game);
    }
    this.drawCockpit(game, sunPos);
    this.drawTunnel();
    this.drawWarpTunnel(game, 0);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    this.gpuTimer.end();
  }

  /**
   * Карта системы и галактики (js/ui/map.js).
   *
   * Та же видеокарта и те же программы, что в полёте, только глаз —
   * камера карты (map.camera), а список тел и их размеры даёт сама карта
   * (map.gl): тело мельче нескольких пикселей рисуется не меньше их, как
   * его значок, иначе шар и подписи разъехались бы. Мир за бортом под
   * картой не рисуется вовсе — его всё равно не видно, а стоил бы он
   * столько же, сколько полёт.
   *
   * Камера сцены подменяется на кадр и возвращается — всё, что считает от
   * this.camera (матрицы, свет, море, ореол), работает без переделки.
   */
  renderMap(game, map) {
    if (!this.ok) return false;
    const gl = this.gl;
    const saved = this.camera, savedCull = this.cull, savedJump = this.jump.power;
    const cam = map.camera;
    this.worldTime = game.world ? game.world.time : 0;
    this.resize();
    this.gpuTimer.begin();
    this.tris = 0; this.draws = 0; this.culled = 0;
    this.camera = cam;
    // Тел на карте десяток: отсев за кадром не окупается, а пирамиду для
    // него считает render — здесь её нет.
    this.cull = false;
    // Поток частиц прыжка рисуется вместе со звёздами — на карте он лишний.
    this.jump.power = 0;
    try {
      const aspect = this.canvas.width / Math.max(1, this.canvas.height);
      perspective(cam.fov, aspect, MAP_NEAR, FAR, this.proj);
      if (pendingBuilds()) pumpBuilds(gl, this.meshLocs, BUILD_MS);
      if (game.world) this.updateSky(game.world);

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clearDepth(1);
      gl.disable(gl.CULL_FACE);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.disable(gl.STENCIL_TEST);
      gl.stencilMask(0xff);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

      this.drawStars();
      if (map.gl.mode === 'system' && game.world) this.drawMapBodies(game, map);
      this.drawMapGlows(map);
    } finally {
      this.camera = saved;
      this.cull = savedCull;
      this.jump.power = savedJump;
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      this.gpuTimer.end();
    }
    return true;
  }

  /** Тела карты: шары той же программой, что в полёте, и кольца. */
  drawMapBodies(game, map) {
    const gl = this.gl;
    const cam = this.camera;
    const prog = this.pMesh;
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.blankTex.tex);
    gl.uniform1i(prog.loc('uSurfTex'), 0);
    gl.uniform1f(prog.loc('uSurfMode'), 0);
    this.useGround(prog);
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uAmbient'), MAP_AMBIENT);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    this.useShipShadow(prog, false);
    // Ни фар, ни теней от них, ни дымки, ни детали на пиксель: тела на
    // карте — модели на столе, а не грунт под ногами.
    this.setLamps(prog, null);
    gl.uniform1i(prog.loc('uShadeN'), 0);
    this.setAir(prog, null);
    this.setDetail(prog, null, 0);
    const sunPos = game.world.star.pos;
    for (const it of map.gl.bodies) {
      const body = it.body;
      const c = cam.toCamera(body.pos);
      const d = Math.hypot(c.x, c.y, c.z);
      const px = d > it.r ? cam.focal * it.r / d : 1e4;
      const level = Math.min(6, planetLevel(body, px));
      const mesh = requestPlanetMesh(gl, this.meshLocs, body, level);
      bodyBasis(body, this.basisTmp);
      this.setWater(prog, body);
      this.drawObject(prog, mesh, body.pos, this.basisTmp, it.r,
        body.kind === 'star' ? { x: body.pos.x, y: body.pos.y, z: body.pos.z + 1 } : sunPos);
    }
    this.setWater(prog, null);

    if (!map.gl.rings.length) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    const ring = this.pRing;
    ring.use();
    gl.uniformMatrix4fv(ring.loc('uProj'), false, this.proj);
    gl.uniform1f(ring.loc('uLogFC'), this.logFC);
    for (const it of map.gl.rings) {
      const body = it.body;
      if (!body._ringMesh) {
        body._ringMesh = buildRingMesh(gl, this.ringLocs, body.rings.inner, body.rings.outer);
      }
      // Плоскость колец — экваториальная (как в drawTransparent).
      const b = this.basisTmp;
      b.right.x = body.eqRef.x; b.right.y = body.eqRef.y; b.right.z = body.eqRef.z;
      b.up.x = body.eqSide.x; b.up.y = body.eqSide.y; b.up.z = body.eqSide.z;
      b.fwd.x = body.pole.x; b.fwd.y = body.pole.y; b.fwd.z = body.pole.z;
      gl.uniform3fv(ring.loc('uColor'), new Float32Array([
        body.rings.color[0] / 255, body.rings.color[1] / 255, body.rings.color[2] / 255]));
      this.drawObject(ring, body._ringMesh, body.pos, b, it.r, sunPos);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /**
   * Свечения карты: корона звезды системы, звёзды галактики. Радиус — в
   * пикселях: на карте свечение — знак, и размер у него экранный.
   */
  drawMapGlows(map) {
    const list = map.gl.glows;
    if (!list.length) return;
    const gl = this.gl;
    const cam = this.camera;
    const prog = this.pGlow;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    prog.use();
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    gl.uniform2fv(prog.loc('uViewport'), new Float32Array([this.canvas.width, this.canvas.height]));
    gl.uniform1f(prog.loc('uFalloff'), GLOW_FALLOFF);
    // Пиксели карты — в точках экрана (CSS), холст сцены — в своих.
    const dpr = this.canvas.width / Math.max(1, cam.w);
    for (const g of list) {
      const c = cam.toCamera(g.pos);
      if (c.z <= 0) continue;
      gl.uniform3fv(prog.loc('uCenterView'), new Float32Array([c.x, c.y, c.z]));
      gl.uniform1f(prog.loc('uRadiusPx'), g.px * dpr);
      gl.uniform3fv(prog.loc('uColor'), new Float32Array(g.color));
      gl.uniform1f(prog.loc('uIntensity'), g.k);
      this.quad.draw();
      this.draws++;
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /**
   * Станция изнутри: видимые секции (холлы площадок, галерея — js/main.js,
   * stationSections) и створки кабин лифта в них, раздвинутые по открытию.
   * Секция собирается при первом показе (js/models/stationhall.js,
   * sectionMesh); остальные не рисуются вовсе.
   */
  drawStationInside(prog, game, st, sunPos) {
    if (!game.stationSections) return;
    const v = game.stationSections(st);
    if (!v) return;
    const ids = new Set(v.ids);
    for (const id of v.ids) this.drawObject(prog, this.glMeshFor(game.stationSectionMesh(st, id)), st.pos, st.basis, 1, sunPos);
    const b = st.basis, p = this._leafPos || (this._leafPos = { x: 0, y: 0, z: 0 });
    for (const d of v.plan.liftDoors) {
      const cab = v.plan.roomById[d.rooms[0]];
      if (!cab || !ids.has(cab.section)) continue;
      const mesh = this.glMeshFor(game.liftLeaf(d.ax));
      const u = d.ax === 0 ? 2 : 0;
      // Створка — половина проёма; открываясь, уходит в стену на свою ширину.
      for (const sg of [-1, 1]) {
        const off = [0, 0, 0];
        off[u] = sg * d.half * (0.5 + d.open);
        const x = (d.pos[0] + off[0]) / 1000, y = d.pos[1] / 1000, z = (d.pos[2] + off[2]) / 1000;
        p.x = st.pos.x + b.right.x * x + b.up.x * y + b.fwd.x * z;
        p.y = st.pos.y + b.right.y * x + b.up.y * y + b.fwd.y * z;
        p.z = st.pos.z + b.right.z * x + b.up.z * y + b.fwd.z * z;
        this.drawObject(prog, mesh, p, b, 1, sunPos);
      }
    }
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

  /**
   * Свой корпус из рубки: тот же меш, что снаружи, но стёкла фонаря
   * сквозные (остаётся переплёт), а изнанка обшивки — стены рубки
   * (js/gl/hull.js, uHullInside). Проекция — рубки: от четырёх сантиметров.
   */
  drawHullInside(game, sunPos, logFC) {
    const gl = this.gl;
    const cam = this.camera;
    const prog = this.pMesh;
    const ship = frameOf(game);
    if (!game.shipMesh || !ship) return;
    // Из глухой комнаты корпус не виден: стены свои, обшивка в комнатах
    // вырезана. Кроме шлюза — закрытый люк изнутри и есть панель корпуса.
    if (!this.outside && this.inVis && game.interior && !seesHull(game.interior, this.inVis)) {
      this.gearDraws = 0;
      return;
    }
    perspective(cam.fov, cam.w / Math.max(1, cam.h), NEAR_BRIDGE, FAR_BRIDGE,
      this.projBridge || (this.projBridge = new Float32Array(16)));
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.blankTex.tex);
    gl.uniform1i(prog.loc('uSurfTex'), 0);
    gl.uniform1f(prog.loc('uSurfMode'), 0);
    this.useGround(prog);
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.projBridge);
    gl.uniform1f(prog.loc('uAmbient'), AMBIENT);
    // Изнутри — у кабины свои тени. Но за окнами мостика «Прометея» —
    // его же палуба и нос, и тень башни на них — эта, корабельная. Мостик
    // с окнами узнаётся по кругу солнца во весь мостик (interior.sunR).
    // Карты нет, когда мира снаружи не видно: её тогда не строили.
    this.useShipShadow(prog, !!(this.outside && game.interior && game.interior.sunR));
    // Фары светят вперёд, на мир, а не на свою обшивку.
    this.noLamps(prog);
    gl.uniform1f(prog.loc('uLogFC'), logFC);
    this.setDetail(prog, null, 0);
    // Воздуха и моря на обшивке нет. Обычно их снял проход поверхности,
    // но из глухой комнаты его не было — тогда снимаем здесь.
    if (!this.outside) {
      this.setAir(prog, null);
      this.setWater(prog, null);
    }
    // Воздух — тот, что выставлен сцене: на метрах от глаза дымки нет, и
    // трогать его незачем.
    gl.uniform1f(prog.loc('uSkyK'), this.skyAt(game, sunPos));
    gl.uniform1f(prog.loc('uLiftGlow'), ship === game.ship
      ? engineLoad(ship, this._load || (this._load = { lift: 0, main: 0 }), !!game.zone).lift
      : 0.2 + (ship.lift || 0));
    gl.uniform1f(prog.loc('uHullInside'), 1);
    // Вырез помещений и открытых люков: коробки, метры модели. И окна —
    // тех комнат, что сейчас видны: вырез окна доходит до наружной
    // обшивки, и из рубки сквозь фонарь в борту была бы дыра. Корпус и
    // помещения — того корабля, на палубе которого глаз (свой или чужой).
    const H = this.hullFor(game, ship);
    const I = game.interior;
    const air = I ? airOf(game, ship) : null;
    if (I) this.setShipCarveAir(prog, I, air, true, this.cabin ? this.cabin.visible(game) : null);
    else gl.uniform1i(prog.loc('uCarveN'), 0);
    this.drawObject(prog, this.glMeshFor(H.mesh), ship.pos, ship.basis, 1, sunPos);
    gl.uniform1i(prog.loc('uCarveN'), 0);
    this.drawGearOf(prog, game, ship, sunPos);
    // Створки люков и трапы — снаружи корабля, но из шлюза они в метре от
    // глаза: их видно сквозь проём.
    if (air) this.drawHatchesOf(prog, ship, air, sunPos);
    gl.uniform1f(prog.loc('uHullInside'), 0);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
  }

  /**
   * Кабина: то, что видно с места пилота.
   *
   * Отдельный проход и отдельный шейдер (js/gl/cabin.js). Кабина в МЕТРЕ
   * от глаза, а ближняя плоскость сцены стоит на четырёх метрах (NEAR):
   * в общем проходе от неё не осталось бы ни грани. И она ближе всего,
   * что есть в кадре, — значит закрывает собой всё: буфер глубины
   * очищается, и нарисованное раньше честно остаётся позади.
   */
  drawCockpit(game, sunPos) {
    const st = game.state;
    // Пилот за бортом: корабль нарисован снаружи (drawOpaque), рубки нет.
    if (walkingOut(game)) return;
    // Пилот на ногах — внутри корабля в любом режиме, и в порту тоже.
    const walking = !!(game.walk && game.walk.on);
    // В порту — тоже: корабль стоит на площадке в зале, и из кресла видно зал.
    if (!st || st.view !== 'cockpit') return;
    if (!game.ship || !this.cabin) return;
    // Пост — того корабля, на палубе которого глаз (js/models/hulls.js,
    // podOf): на своём — свой, с экранами; на чужом — пост его типа без
    // софта (его приборы — не наши). Проверки без модели в игре получают
    // пост «Челленджера» по первому требованию.
    const I = game.interior;
    const foreign = inForeign(game);
    let pod = foreign ? (I ? podOf(I.code) : null) : game.cockpit;
    if (!pod && !foreign && HULL.canopy) pod = this.cockpit || (this.cockpit = buildCockpit());
    // Без поста — помещения и корпус изнутри, приборы поверх кадра, как в
    // виде из-за спины (js/ui/hud.js); пока помещений нет — один корпус.
    // План без поста в рубке (pod: false) — тоже одни помещения.
    const deck = !!(I && !I.pod);
    if (!pod || (walking && deck)) {
      if (I) {
        const gl = this.gl;
        const size = [this.canvas.width, this.canvas.height];
        const pre = this.cabin.prepare(game, sunPos, size, true);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        const logFC = logDepthCoef(FAR_BRIDGE);
        this.drawHullInside(game, sunPos, logFC);
        this.cabinDraws = pre + 1 + this.gearDraws + this.cabin.drawPod(game, this.camera, size, logFC, true);
        this.cabinDraws += this.drawPeopleIn(game, logFC);
        this.cabinDraws += this.drawHoldAround(game, sunPos, size, logFC);
        this.draws += this.cabinDraws;
        return;
      }
      const gl = this.gl;
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this.drawHullInside(game, sunPos, logDepthCoef(FAR_BRIDGE));
      this.cabinDraws = 1 + this.gearDraws;
      return;
    }
    // Модель — из игры (там по ней раскладываются экраны); чужой пост или
    // собранный здесь — без экранов.
    const g = !foreign && pod === game.cockpit ? game : { ...game, cockpit: pod, displays: null };
    const gl = this.gl;
    const size = [this.canvas.width, this.canvas.height];
    // 1. Экраны в атлас и карта теней — до кадра: у них свой буфер.
    const pre = this.cabin.prepare(g, sunPos, size);
    // 2. Рубка ближе всего в кадре и закрывает собой всё: глубина — с нуля.
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const logFC = logDepthCoef(FAR_BRIDGE);
    // 3. Свой корпус изнутри: сквозь стекло фонаря — нос, крылья, корма.
    this.drawHullInside(game, sunPos, logFC);
    // 4. Пост пилота и стекло поверх — той же глубиной.
    this.cabinDraws = pre + 1 + this.cabin.drawPod(g, this.camera, size, logFC);
    // Люди на этой палубе — в свете её ламп.
    this.cabinDraws += this.drawPeopleIn(game, logFC);
    // Вездеход в трюме: за его стёклами — трюм носителя, а не улица.
    this.cabinDraws += this.drawHoldAround(game, sunPos, size, logFC);
    this.draws += this.cabinDraws;
    this.tris += this.cabin.parts
      ? (this.cabin.parts.shell.count + this.cabin.parts.glass.count) / 3 : 0;
  }

  /**
   * Коробки выреза своего корпуса (js/gl/hull.js, CARVE_MAX): панели
   * открытых люков — всегда, помещения — изнутри всегда, а снаружи только
   * пока открыт люк: сквозь проём видно шлюз, а не изнанку обшивки. Люки
   * — первыми: их срезать нельзя ни при каком числе коробок.
   */
  setShipCarve(prog, game, inside) {
    // Свой корабль: его шлюзы и его же планировка (air.I).
    const air = airOf(game, game.ship);
    if (!air) { this.gl.uniform1i(prog.loc('uCarveN'), 0); return; }
    this.setShipCarveAir(prog, air.I, air, inside);
  }

  /** То же для корабля с шлюзами air (свой или чужой). */
  setShipCarveAir(prog, I, air, inside, vis = null) {
    const gl = this.gl;
    const list = this._carve || (this._carve = []);
    list.length = 0;
    let open = false;
    if (air) {
      const cuts = this._cuts || (this._cuts = air.hatches.map(() => ({ lo: [0, 0, 0], hi: [0, 0, 0] })));
      air.hatches.forEach((hx, i) => { if (hx.open > 0) { open = true; list.push(hatchCut(hx, cuts[i])); } });
      // Опущенная платформа — проём в днище: сквозь него снаружи виден
      // трюм, а из трюма — грунт под кораблём.
      const bc = this._bayCuts || (this._bayCuts = new Map());
      for (const bx of air.bays || []) {
        if (bx.travel <= 0.005) continue;
        open = true;
        let c = bc.get(bx.id);
        if (!c) bc.set(bx.id, c = { lo: [0, 0, 0], hi: [0, 0, 0] });
        list.push(bayCut(bx, c));
      }
    }
    // Планировка — того корабля, чьи это шлюзы (у другого типа своя).
    if (air && air.I) I = air.I;
    if (I && (inside || open)) {
      if (I.roomCarve) {
        // Вырез по комнатам («Прометей», полторы сотни помещений):
        // изнутри — видимых, снаружи — шлюзов с открытыми люками.
        if (inside && vis) {
          for (const id of vis) if (I.roomCarve[id] && list.length < CARVE_MAX) list.push(I.roomCarve[id]);
        } else if (open) {
          for (const hx of air.hatches) if (hx.open > 0 && I.roomCarve[hx.lock]) list.push(I.roomCarve[hx.lock]);
        }
      } else {
        for (const c of I.carve) list.push(c);
      }
    }
    // Окна — только изнутри и только видимых комнат: снаружи сквозь проём
    // было бы видно откос без комнаты (её рисует проход кабины), и
    // обшивка остаётся целой.
    if (I && inside && vis && I.windowCarve) for (const c of I.windowCarve) if (vis.includes(c.room)) list.push(c);
    const n = Math.min(CARVE_MAX, list.length);
    gl.uniform1i(prog.loc('uCarveN'), n);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      gl.uniform3f(prog.loc(`uCarveLo[${i}]`), c.lo[0], c.lo[1], c.lo[2]);
      gl.uniform3f(prog.loc(`uCarveHi[${i}]`), c.hi[0], c.hi[1], c.hi[2]);
    }
  }

  /**
   * Створки открытых люков и трапы (js/game/airlock.js): сетки мира, как
   * стойки шасси, — в осях корабля и с его ходом.
   */
  drawHatches(prog, game, sunPos) {
    if (!game.ship) return;
    this.drawHatchesOf(prog, game.ship, airOf(game, game.ship), sunPos);
  }

  /** Створки и трапы корабля ship по его шлюзам air. */
  drawHatchesOf(prog, ship, air, sunPos) {
    if (!air || !ship) return;
    const b = ship.basis, b0 = b;
    const meshes = this._airMeshes || (this._airMeshes = new Map());
    const at = (p, out) => {
      out.x = ship.pos.x + (b.right.x * p[0] + b.up.x * p[1] + b.fwd.x * p[2]) / 1000;
      out.y = ship.pos.y + (b.right.y * p[0] + b.up.y * p[1] + b.fwd.y * p[2]) / 1000;
      out.z = ship.pos.z + (b.right.z * p[0] + b.up.z * p[1] + b.fwd.z * p[2]) / 1000;
      return out;
    };
    const dir = (d, out) => {
      out.x = b.right.x * d[0] + b.up.x * d[1] + b.fwd.x * d[2];
      out.y = b.right.y * d[0] + b.up.y * d[1] + b.fwd.y * d[2];
      out.z = b.right.z * d[0] + b.up.z * d[1] + b.fwd.z * d[2];
      return out;
    };
    const pose = this._stairPose || (this._stairPose = { o: [0, 0, 0], ex: [0, 0, 0], ey: [0, 0, 0], ez: [0, 0, 0] });
    const bs = this._stairBasis || (this._stairBasis = makeBasis());
    const hp = this._hp || (this._hp = [0, 0, 0]);
    for (const hx of air.hatches) {
      if (hx.open <= 0) continue;
      let hm = meshes.get(hx.id);
      if (!hm) meshes.set(hx.id, hm = buildHatchMesh(hx.h));
      this.drawObject(prog, this.glMeshFor(hm), at(hatchPanelAt(hx, hp), this.tmpPos), b, 1, sunPos);
      if (hx.stair <= 0) continue;
      const key = hx.design.n + ':' + hx.design.r.toFixed(4);
      let sm = meshes.get(key);
      if (!sm) meshes.set(key, sm = buildStairMesh(hx.design));
      stairPose(hx, hx.stair, pose);
      dir(pose.ex, bs.right); dir(pose.ey, bs.up); dir(pose.ez, bs.fwd);
      this.drawObject(prog, this.glMeshFor(sm), at(pose.o, this.tmpPos), bs, 1, sunPos);
    }
    // Грузовая платформа (js/game/airlock.js): плита — когда она ниже
    // днища, то есть снаружи корабля (выше — в трюме, и там её рисует
    // проход кабины светом трюма); тросы — от верха колодца к её углам.
    const I = air.I;
    for (const bx of air.bays || []) {
      if (bx.travel <= 0.02) continue;
      const b = bx.b, top = b.deck - bx.travel;
      const wm = I && I.bayWorld && I.bayWorld[bx.id];
      if (wm && top < b.belly) {
        hp[0] = 0; hp[1] = -bx.travel; hp[2] = 0;
        this.drawObject(prog, this.glMeshFor(wm), at(hp, this.tmpPos), b0, 1, sunPos);
      }
      const len = (b.deck - 0.12) - (top + 0.16);
      if (len < 0.05 || !b.corners) continue;
      let cm = meshes.get('cable');
      if (!cm) meshes.set('cable', cm = buildCableMesh());
      const cb = this._cableBasis || (this._cableBasis = makeBasis());
      cb.right.x = b0.right.x; cb.right.y = b0.right.y; cb.right.z = b0.right.z;
      cb.fwd.x = b0.fwd.x; cb.fwd.y = b0.fwd.y; cb.fwd.z = b0.fwd.z;
      cb.up.x = b0.up.x * len; cb.up.y = b0.up.y * len; cb.up.z = b0.up.z * len;
      for (const [cx, cz] of b.corners) {
        hp[0] = cx; hp[1] = b.deck - 0.12; hp[2] = cz;
        this.drawObject(prog, this.glMeshFor(cm), at(hp, this.tmpPos), cb, 1, sunPos);
      }
    }
  }

  /**
   * Шлюзы сквозь открытые люки, когда корабль виден снаружи: от третьего
   * лица и пилоту за бортом (js/gl/cabin.js, drawLocksOutside).
   */
  drawLocksOut(game, sunPos) {
    const own = airOf(game, game.ship);
    if (!this.cabin || !own) return;
    const size = [this.canvas.width, this.canvas.height];
    // Свой — от третьего лица, с грунта и с палубы чужого корабля.
    if (!game.ship.away && !game.ship.hidden
      && (game.state.view === 'chase' || walkingOut(game) || inForeign(game))) {
      const n = this.cabin.drawLocksOutside(game, this.camera, size, sunPos, this.logFC, game.ship, own);
      this.draws += n;
      this.cabinDraws += n;
    }
    // Чужие — те, что рядом и с открытым люком: сквозь проём виден шлюз.
    // Тот, на палубе которого стоим, рисует проход кабины целиком.
    const cam = this.camera;
    for (const V of game.peers || []) {
      if (!V.air || V === game.frame && inForeign(game)) continue;
      if (Math.hypot(V.pos.x - cam.pos.x, V.pos.y - cam.pos.y, V.pos.z - cam.pos.z) > 0.4) continue;
      if (!V.air.hatches.some((hx) => hx.open > 0.01) && !(V.air.bays || []).some((bx) => bx.travel > 0.01)) continue;
      const n = this.cabin.drawLocksOutside(game, cam, size, sunPos, this.logFC, V, V.air);
      this.draws += n;
      this.cabinDraws += n;
    }
  }

  /**
   * Насколько варп-тоннель закрывает кадр целиком, 0..1 (0 — не закрывает).
   *
   * Порог не 1.0, а 0.97: на последних процентах раскрытия мир под
   * тоннелем уже не читается, а рисовать его — это полный проход по всем
   * телам системы впустую.
   */
  warpCover(game) {
    const w = game.warp;
    if (!w || w.phase !== 'tunnel') return 0;
    const p = warpPower(w);
    return p > 0.97 ? p : 0;
  }

  /**
   * Прогрев системы под тоннелем: собрать грубые меши всех тел, пока их
   * никто не видит.
   *
   * Без этого прыжок только ПЕРЕНОСИТ «прогрузку» на момент выхода —
   * игрок вываливается к звезде и смотрит, как из шаров проступают
   * планеты. Уровень 2 взят намеренно низкий: он собирается быстро, а
   * уточняется на подлёте обычным порядком.
   */
  warmSystem(world) {
    for (const b of world.bodies) {
      if (b.kind === 'star') continue;
      requestPlanetMesh(this.gl, this.meshLocs, b, 2);
    }
    if (pendingBuilds()) pumpBuilds(this.gl, this.meshLocs, BUILD_MS * 2);
  }

  /**
   * Только корабль и кабина — без единого тела мира.
   *
   * Нужно под варп-тоннелем: системы в этот момент нет, а корабль есть, и
   * он единственное, по чему видно, что это полёт. Настройка программы
   * повторяет начало drawOpaque, но без поверхности, плиток и трафарета:
   * их здесь не для чего готовить.
   */
  drawShipOnly(game) {
    const gl = this.gl;
    const prog = this.pMesh;
    const ship = game.ship;
    const w = game.warp;

    // Светит сам тоннель, и светит СПЕРЕДИ: источник ставится далеко по
    // оси прыжка. Звезда для этого не годится — до смены системы она
    // осталась в покинутой, после смены корабль стоит к ней вплотную, и в
    // обоих случаях корабль выходил то чёрным силуэтом, то пересвеченным.
    // Подсветка снизу поднята: в тоннеле нет теней, есть свечение вокруг.
    const d = w && w.dir ? w.dir : { x: 0, y: 0, z: 1 };
    const lit = this._warpLit || (this._warpLit = { x: 0, y: 0, z: 0 });
    lit.x = ship.pos.x + d.x * 1e7;
    lit.y = ship.pos.y + d.y * 1e7;
    lit.z = ship.pos.z + d.z * 1e7;

    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.blankTex.tex);
    gl.uniform1i(prog.loc('uSurfTex'), 0);
    gl.uniform1f(prog.loc('uSurfMode'), 0);
    this.useGround(prog);
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uAmbient'), WARP_AMBIENT);
    this.useShipShadow(prog, false);   // в тоннеле солнца нет
    this.noLamps(prog);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    this.setDetail(prog, null, 0);

    if (game.state.view === 'chase' && game.state.mode !== 'docked' && game.shipMesh) {
      this.drawObject(prog, this.glMeshFor(game.shipMesh), ship.pos, ship.basis, 1, lit);
      this.drawGear(prog, game, lit);
    }
    this.drawCockpit(game, lit);
  }

  /**
   * Точка схода варп-тоннеля в NDC: куда на экране уходит ось прыжка.
   *
   * Та же задача, что у квантового тоннеля (см. updateJump), и решается
   * так же: направление переводится в оси камеры и проецируется. Ось за
   * спиной не проецируется вовсе — тогда точка схода остаётся прежней, и
   * тоннель просто уезжает за край кадра.
   */
  warpCenter(w, out) {
    const b = this.camera.basis;
    const d = w && w.dir ? w.dir : null;
    if (!d) { out.x = 0; out.y = 0; return out; }
    const ax = d.x * b.right.x + d.y * b.right.y + d.z * b.right.z;
    const ay = d.x * b.up.x + d.y * b.up.y + d.z * b.up.z;
    const az = d.x * b.fwd.x + d.y * b.fwd.y + d.z * b.fwd.z;
    if (!(az > 0.08)) return out;
    const cam = this.camera;
    const px = cam.cx + (ax / az) * cam.focal;
    const py = cam.cy - (ay / az) * cam.focal;
    out.x = Math.max(-3, Math.min(3, (px / cam.w) * 2 - 1));
    out.y = Math.max(-3, Math.min(3, 1 - (py / cam.h) * 2));
    return out;
  }

  /** Варп-тоннель: полноэкранный проход поверх всего. */
  drawWarpTunnel(game, cover) {
    const w = game.warp;
    if (!w || w.phase !== 'tunnel') return;
    const power = cover > 0 ? cover : warpPower(w);
    if (!(power > 0.01)) return;
    const gl = this.gl;
    const prog = this.pWarpTun;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    prog.use();
    // Точка схода считается КАЖДЫЙ кадр от оси прыжка в осях камеры, а не
    // прибита к середине.
    //
    // ТО, ЧТО БЫЛО СЛОМАНО: тоннель был экранным и при осмотре камерой
    // (ПКМ) оставался на месте — двигался только корабль. Со стороны это
    // читалось не как «повернул голову», а как «корабль крутится внутри
    // неподвижной трубы».
    this.warpCenter(game.warp, this._wc || (this._wc = { x: 0, y: 0 }));
    gl.uniform2f(prog.loc('uCenter'), this._wc.x, this._wc.y);
    gl.uniform1f(prog.loc('uAspect'), this.canvas.width / Math.max(1, this.canvas.height));
    // Время — МОНОТОННОЕ, прямо секунды прыжка. Первая версия собирала
    // его из фазы потока (w.flow * 40), а фаза берётся по модулю единицы:
    // на каждом обороте, то есть дважды в секунду, время скакало назад на
    // сорок единиц, и весь узор мгновенно подменялся другим. Это и было
    // мельтешение, от которого резало глаза.
    gl.uniform1f(prog.loc('uTime'), w.t);
    gl.uniform1f(prog.loc('uPower'), power);
    gl.uniform1f(prog.loc('uMix'), w.total > 0 ? w.t / w.total : 0);
    gl.uniform3fv(prog.loc('uFrom'), starTint(w.from));
    gl.uniform3fv(prog.loc('uTo'), starTint(w.to));
    this.warpTunQuad.draw();
    this.draws++;
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
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
  /**
   * Забыть систему целиком: освободить всё, что для неё собрано на GPU.
   *
   * Вызывается под тоннелем варп-прыжка, когда мир уже не виден
   * (js/main.js, enterSystem). Сборщик мусора сам здесь бессилен: меши
   * планет висят на телах старого мира, но БУФЕРЫ живут в драйвере, и
   * ссылок из JS на них нет вовсе — без явного удаления каждый прыжок
   * оставлял бы в видеопамяти целую систему.
   *
   * @returns сколько мешей освобождено — по этому числу проверка и
   *          отличает настоящую выгрузку от забытого вызова.
   */
  forgetSystem(world) {
    if (this.tiles) this.tiles.clear();
    if (this.rocks) this.rocks.clear();
    if (this.flora) this.flora.clear();
    if (this.city) this.city.clear();
    this.tileBody = null;
    this.rockBody = null;
    this.floraBody = null;
    this.skySeed = null;         // небо чужой системы печётся заново
    return world ? disposePlanetMeshes(world.bodies) : 0;
  }

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
    // Поверхность — ПЕРВОЙ, и это важно. Камни и растительность кладутся
    // на ту сетку, которая нарисована (surfaceCell), а её размер ячейки
    // известен только после того, как набор заплаток или плиток на этот
    // кадр уже выбран. В обратном порядке первое же поле собиралось по
    // ячейке «на глазок» — и уходило под грунт на полсотни метров.
    if (this.tilesOn) {
      this.updateTiles(body);
      this.patchBody = null;
    } else {
      this.patchBody = body
        ? this.patch.update(body, this.camera.pos, body._glLevel || 0, PATCH_MS)
        : this.patch.update(null, null, 0, 0);
    }
    this.updateRocks(body, game.world.star.pos);
    this.updateFlora(body);
    this.updateCity(game.world);
  }

  /**
   * Наземный город: какой собирать и когда.
   *
   * Сборка заводится ЗАРАНЕЕ — за сотню радиусов города, то есть задолго
   * до того, как он займёт в кадре хоть пиксель. Причина в том, что
   * подходят к нему сверху и быстро: начни собирать по видимости, и сто
   * тысяч граней появлялись бы уже на глазах.
   */
  updateCity(world) {
    const cities = world.cities;
    if (!cities || !cities.length) { this.city.clear(); return; }
    const cam = this.camera;
    let near = null, nd = Infinity;
    for (const c of cities) {
      const d = Math.hypot(c.pos.x - cam.pos.x, c.pos.y - cam.pos.y, c.pos.z - cam.pos.z);
      if (d < nd) { nd = d; near = c; }
    }
    this.cityNear = nd;
    if (nd >= near.radius * 100) { this.city.update(null); return; }
    // Где камера в осях города: от этого зависит, какие постройки
    // показывать настоящими моделями, а какие коробками
    // (js/gl/citymesh.js). Камера, а не корабль: смотрят камерой, и с
    // вида от третьего лица подробности должны быть там же.
    cityLocal(near, cam.pos, _cityAt);
    // Куда светит звезда в осях города: по этому кладутся тени построек
    // (js/gl/citymesh.js). Направление, а не положение: до звезды
    // миллионы километров, и на размере города луч параллелен.
    const sun = world.star.pos;
    let sx = sun.x - near.pos.x, sy = sun.y - near.pos.y, sz = sun.z - near.pos.z;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const bs = near.basis;
    _citySun.x = sx * bs.right.x + sy * bs.right.y + sz * bs.right.z;
    _citySun.y = sx * bs.up.x + sy * bs.up.y + sz * bs.up.z;
    _citySun.z = sx * bs.fwd.x + sy * bs.fwd.y + sz * bs.fwd.z;
    this.city.update(near, _cityAt, _citySun);
  }

  /**
   * Самая мелкая ячейка, до которой доходит нынешний способ рисовать
   * поверхность. По ней камни и растительность кладутся на грунт.
   *
   * Зачем не «полная высота». Сетка передаёт рельеф с ошибкой примерно
   * «уклон × ячейка». У горного мира уклон — треть, и на заплатках
   * (самая мелкая ячейка 20 м) это сорок метров: камни и деревья,
   * положенные на полную высоту, висят над склоном. Положенные на ту же
   * детализацию, какой грунт РИСУЕТСЯ, они стоят на нём ровно.
   *
   * Берётся самая мелкая ячейка ИЗ НЫНЕШНЕГО НАБОРА, а не предельная
   * для способа рисования: у заплаток размер ячейки зависит от высоты
   * (js/gl/patches.js, cellOfAlt), и с трёхсот метров она вчетверо
   * крупнее, чем у земли. Пока здесь стоял предел, деревья на этой
   * высоте уходили под грунт на полсотни метров — поле было собрано,
   * нарисовано и невидимо.
   */
  surfaceCell(body) {
    if (!body) return 0;
    if (this.tilesOn) {
      const lv = this.tiles ? this.tiles.finestLevel : 0;
      return lv > 0 ? tileCellAngle(lv) : tileCellAngle(TILE_MAX_LEVEL);
    }
    return (this.patch && this.patch.cellAngle) || PATCH.minCellKm / body.radius;
  }

  /**
   * Радиус грунта под направлением dir (оси тела) — так, как его сейчас
   * РИСУЕТ сетка, с той же подробностью, что и у камней с растениями
   * (см. surfaceCell). Нужен камере (js/game/chase.js): у земли она
   * держится на четырёх метрах, а нарисованный грунт отличается от
   * настоящего на «уклон × ячейку», и по настоящему она уходила бы под
   * картинку.
   */
  drawnGround(body, dir) {
    const t = terrainOf(body);
    if (t.isFlat) return body.radius;
    const cell = this.surfaceCell(body);
    const det = cell > 0 ? t.detailForCell(cell) : null;
    return body.radius * (1 + t.displace(dir.x, dir.y, dir.z, det));
  }

  /**
   * Грунт для ног, колёс, трапа и плиты: тот, что будет нарисован под
   * камерой, когда плитки догрузятся, — с подробностью самого мелкого
   * уровня. Не drawnGround: тот идёт за самым подробным из УЖЕ
   * нарисованных уровней, а после входа плитки приходят от грубых к
   * мелким, и грунт под ногами за секунды прыгал на сотни метров (в одной
   * точке Lave II: +650 м, −103 м, +6 м, и только с двенадцатого уровня —
   * в пределах двадцати сантиметров от полного). Пешеход проваливался, а
   * когда грунт поднимался обратно выше ступени — оставался под ним.
   * Под камерой у грунта плитки доходят до мелкого уровня, и с картинкой
   * этот грунт расходится на сантиметры; камера берёт нарисованный.
   * Заплатки (?surface=clipmap) — как рисуются: там подробность своя.
   */
  settledGround(body, dir) {
    if (!this.tilesOn) return this.drawnGround(body, dir);
    const t = terrainOf(body);
    if (t.isFlat) return body.radius;
    return body.radius * (1 + t.displace(dir.x, dir.y, dir.z, t.detailForCell(tileCellAngle(TILE_MAX_LEVEL))));
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
    if (this.rocksKnob) this.rocks.update(body, dir, info.alt, this._rsun, this.surfaceCell(body));
    else this.rocks.clear();
    this.rockBody = this.rocks.mesh ? body : null;
    // Солнце и точка под камерой те же, что у камней, — растительность
    // берёт их готовыми, чтобы не считать второй раз за кадр.
    this._floraDir = dir;
    this._floraAlt = info.alt;
  }

  /**
   * Поле растительности под камерой. Считается после камней и по их же
   * числам: тело, точка под камерой, высота и солнце у них общие.
   */
  updateFlora(body) {
    if (!body || !this._floraDir) {
      this.flora.clear(); this.floraBody = null;
      if (this.forest) this.forest.update(null);
      return;
    }
    this.floraCell = this.surfaceCell(body);
    this.flora.update(body, this._floraDir, this._floraAlt, this._rsun, this.floraCell);
    this.floraBody = this.flora.mesh ? body : null;
    // Дальний лес — вокруг той же точки под камерой.
    if (this.forest) this.forest.update(body, this._floraDir, this._floraAlt, this.camera.focal);
  }

  /**
   * Дальний лес: куски силуэтов вокруг камеры (js/gl/forestfield.js).
   *
   * Рисуется сразу после поля растений, своей программой. Дымка на нём
   * ЕСТЬ, в отличие от прочих предметов: те стоят в сотнях метров, а
   * лес — до пятнадцати километров, и без воздуха он лежал бы на
   * затуманенном грунте тёмными точками.
   */
  drawForest(game, sunPos) {
    const f = this.forest;
    this.forestDraws = 0;
    this.forestTrees = 0;
    if (!f || !f.body || !f.chunks.size || !(f.rGround > 0)) return;
    const gl = this.gl;
    const prog = this.pForest;
    const cam = this.camera;
    const body = f.body;
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.blankTex.tex);
    gl.uniform1i(prog.loc('uSurfTex'), 0);
    gl.uniform1f(prog.loc('uSurfMode'), 0);
    this.useGround(prog);
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uAmbient'), AMBIENT);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    this.setLamps(prog, game);
    this.setAir(prog, body);
    this.useShipShadow(prog, true);
    if (!this._forestProf) {
      this._forestProf = new Float32Array(32);
      TREE_PROFILES.forEach((pr, i) => { if (i < 8) this._forestProf.set(pr, i * 4); });
    }
    gl.uniform4fv(prog.loc('uProf[0]'), this._forestProf);
    gl.uniform1f(prog.loc('uTrunk'), FOREST_FAR.trunk);
    const d1 = thinAt(cam.focal);
    gl.uniform4f(prog.loc('uLod'), d1, d1 * 2, FOREST_FAR.band, f.rFar);

    const basis = bodyBasis(body, this.basisTmp);
    const camL = this._forestCam || (this._forestCam = { x: 0, y: 0, z: 0 });
    toLocal(basis, body.pos, cam.pos, camL);
    // Какие деревья взяло поле у корабля — их здесь пропускаем.
    const fl = this.flora;
    const nearOn = !!(fl.mesh && this.floraBody === body && fl.treeR > 0 && fl.treeAt);
    const pos = this._forestPos || (this._forestPos = { x: 0, y: 0, z: 0 });
    // Взгляд камеры в осях тела — для отсева кусков за спиной.
    const fw = cam.basis.fwd;
    const fx = fw.x * basis.right.x + fw.y * basis.right.y + fw.z * basis.right.z;
    const fy = fw.x * basis.up.x + fw.y * basis.up.y + fw.z * basis.up.z;
    const fz = fw.x * basis.fwd.x + fw.y * basis.fwd.y + fw.z * basis.fwd.z;
    const half = FOREST_FAR.chunk * 0.038 * 0.75;
    for (const c of f.chunks.values()) {
      const o = c.origin;
      const dx = o.x - camL.x, dy = o.y - camL.y, dz = o.z - camL.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist - half > f.rFar) continue;
      // За спиной — не рисуем (с запасом на полкуска и на угол зрения).
      if ((dx * fx + dy * fy + dz * fz) < -half) continue;
      // За горизонтом отдельно не отсекаем: круг и так не дальше
      // горизонта, а закрытое землёй честно отсекает буфер глубины.
      toWorld(basis, body.pos, o, pos);
      modelView(cam.basis, cam.pos, basis, pos, 1, this.mv, this.nrm);
      gl.uniformMatrix4fv(prog.loc('uModelView'), false, this.mv);
      gl.uniformMatrix3fv(prog.loc('uNormalMat'), false, this.nrm);
      gl.uniform3fv(prog.loc('uSunDir'), this.setSunDir(pos, sunPos));
      gl.uniform3f(prog.loc('uUp'), c.up.x, c.up.y, c.up.z);
      gl.uniform3f(prog.loc('uT'), c.T.x, c.T.y, c.T.z);
      gl.uniform3f(prog.loc('uB'), c.B.x, c.B.y, c.B.z);
      gl.uniform3f(prog.loc('uCamL'), camL.x - o.x, camL.y - o.y, camL.z - o.z);
      const nearHere = nearOn && c.face === fl.treeFace;
      gl.uniform1f(prog.loc('uNearOn'), nearHere ? 1 : 0);
      if (nearHere) {
        gl.uniform4f(prog.loc('uNear'), fl.treeAt.x - o.x, fl.treeAt.y - o.y, fl.treeAt.z - o.z, fl.treeR);
      }
      // Дальний кусок рисует только начало списка — редкие подрешётки.
      const near = dist - half;
      const count = near > d1 * 2 * (1 + FOREST_FAR.band) ? c.n2 : (near > d1 * (1 + FOREST_FAR.band) ? c.n1 : c.n);
      if (count <= 0) continue;
      gl.bindVertexArray(c.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, f.nBase, count);
      this.draws++;
      this.forestDraws++;
      this.forestTrees += count;
      this.tris += count * (f.nBase / 3);
    }
    gl.bindVertexArray(null);
  }

  /**
   * Точка в осях тела (доли радиуса) -> мир, в double. Начало сетки,
   * отсчитанной не от центра тела (плитки грунта, поле камней).
   * Базис тела — уже в basisTmp.
   */
  localOrigin(body, o) {
    const b = this.basisTmp, R = body.radius;
    const p = this._lo || (this._lo = { x: 0, y: 0, z: 0 });
    p.x = body.pos.x + R * (b.right.x * o[0] + b.up.x * o[1] + b.fwd.x * o[2]);
    p.y = body.pos.y + R * (b.right.y * o[0] + b.up.y * o[1] + b.fwd.y * o[2]);
    p.z = body.pos.z + R * (b.right.z * o[0] + b.up.z * o[1] + b.fwd.z * o[2]);
    return p;
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
    // Допуск плиток считается в пикселях, поэтому уменьшенный буфер
    // кадра (`?scale=`) должен уменьшить и фокусное: при половинном
    // разрешении та же плитка даёт вдвое меньшую ошибку на экране, и
    // дробить её дальше незачем.
    this.tiles.update(body, dir, info.alt, this.camera.focal * this.scale, TILE_MS);
    this.tileBody = this.tiles.rootsReady ? body : null;
  }

  // Плитки рисуются в осях тела, но каждая от СВОЕЙ середины (origin,
  // js/gl/tilegeo.js): начало плитки переводится в мир здесь, в double,
  // и во float32 уходит только его смещение от камеры. От центра тела
  // грунт у ног дрожал на десятки сантиметров при каждом движении мыши.
  // Меняются ещё текстура и — при смене уровня — окно мелкой детали,
  // которую шейдер добавляет ниже текселя этой текстуры.
  drawTiles(prog, sunPos) {
    const gl = this.gl;
    const body = this.tileBody;
    const terrain = terrainOf(body);
    bodyBasis(body, this.basisTmp);
    const shift = prog.loc('uLocalShift');
    gl.uniform1f(prog.loc('uSurfMode'), 1);
    gl.uniform1i(prog.loc('uSurfTex'), 0);
    gl.activeTexture(gl.TEXTURE0);
    const gk = grainPerUnit(body.radius, GROUND.grain.sizeKm);
    let lastLevel = -1;
    for (const t of this.tiles.draw) {
      const e = this.tiles.get(tileKey(t.face, t.level, t.tx, t.ty));
      if (!e || !e.mesh) continue;
      // За кадром — не рисуем и не готовим к рисованию (текстура, деталь).
      const at = this.localOrigin(body, e.origin);
      if (!this.seen(e.mesh, at, this.basisTmp, body.radius)) { this.culled++; continue; }
      // Угол плитки на грани куба — тот же счёт, что в tileBounds, но
      // без объекта: плиток в кадре сотни, и мусор здесь лишний.
      const step = 2 / (1 << t.level);
      this.setGrain(prog, body, t.face,
        -1 + t.tx * step, -1 + t.ty * step, step * gk);
      if (this.detailOn && t.level !== lastLevel) {
        this.applyDetail(prog, tileDetailUniforms(terrain, tileTexelAngle(t.level)));
        lastLevel = t.level;
      }
      gl.bindTexture(gl.TEXTURE_2D, e.tex.tex);
      gl.uniform3f(shift, e.origin[0], e.origin[1], e.origin[2]);
      this.drawObject(prog, e.mesh, at, this.basisTmp, body.radius, sunPos);
    }
    gl.uniform3f(shift, 0, 0, 0);
    gl.uniform1f(prog.loc('uSurfMode'), 0);
    gl.uniform1f(prog.loc('uGrainOn'), 0);
    this.setDetail(prog, null, 0);
  }

  /**
   * Небо системы: полоса галактического диска и туманности.
   *
   * Печётся ОДИН раз на запуск и по ОДНОЙ грани куба за кадр. Шесть
   * граней по 512² — это полтора миллиона текселей процедурного шума,
   * примерно полкадра поверхности: разом это заметный рывок на старте, а
   * по грани не видно вовсе, и к седьмому кадру небо готово.
   *
   * Seed берётся из системы: небо — её часть, и у другой звезды оно
   * будет другим (js/render/starfield.js, galaxyFor).
   */
  updateSky(world) {
    if (!this.skyOn || !world) return;
    const gl = this.gl;
    // Небо перезапекается, когда сменилось СЕМЯ системы, а не когда его
    // об этом попросили: у каждой звезды свои туманности и свой наклон
    // галактического диска, и прилететь в чужую систему под родным небом
    // значило бы обесценить и то, и другое. Сравнение по семени, а не
    // флажок «пересобрать», потому что забыть выставить флажок легко, а
    // заметить чужое небо в кадре — почти нельзя.
    if (this.skySeed !== world.seed) {
      this.skySeed = world.seed;
      this.sky = skyFor(world.seed);
      this.skyU = skyUniforms(this.sky);
      this.skyFace = 0;
    }
    if (this.skyFace >= 6) return;
    if (!this.skyTex) this.skyTex = createSkyTexture(gl, Q.sky);
    const f = CUBE_FACES[this.skyFace];
    const prog = this.pSkyBake;
    const u = this.skyU;
    const ok = this.baker.pass(this.skyTex, () => {
      prog.use();
      gl.uniform3f(prog.loc('uFaceF'), f.F[0], f.F[1], f.F[2]);
      gl.uniform3f(prog.loc('uFaceU'), f.U[0], f.U[1], f.U[2]);
      gl.uniform3f(prog.loc('uFaceV'), f.V[0], f.V[1], f.V[2]);
      gl.uniform3fv(prog.loc('uPole'), u.pole);
      gl.uniform3fv(prog.loc('uCore'), u.core);
      gl.uniform1f(prog.loc('uSigma'), u.sigma);
      gl.uniform1f(prog.loc('uGain'), SKY_GAIN);
      gl.uniform1i(prog.loc('uBlobs'), u.count);
      gl.uniform3fv(prog.loc('uBlobDir'), u.dirs);
      gl.uniform3fv(prog.loc('uBlobCol'), u.cols);
      gl.uniform3fv(prog.loc('uBlobPar'), u.pars);
      // Сдвиг решётки шума: у каждой системы своя, иначе облака разных
      // систем вышли бы одной и той же формы.
      gl.uniform1f(prog.loc('uSkySeed'), ((world.seed >>> 0) % 1024) / 1024);
      this.skyBakeQuad.draw();
    }, gl.TEXTURE_CUBE_MAP_POSITIVE_X + this.skyFace);
    // Кадровый буфер не собрался (нет нужного формата) — небо просто
    // остаётся чёрным, а не пропадает вместе со сценой.
    if (!ok) { this.skyOn = false; return; }
    this.skyFace++;
  }

  /**
   * Небо — фон: рисуется первым, без глубины и без смешивания, одной
   * выборкой из кубической карты на пиксель. Всё остальное ложится
   * поверх обычным порядком.
   */
  drawSky(viewMat3) {
    if (!this.skyOn || !this.skyTex || this.skyFace === 0) return;
    const gl = this.gl;
    const prog = this.pSky;
    prog.use();
    const t = Math.tan(this.camera.fov / 2);
    this.skyScale[0] = t * (this.canvas.width / Math.max(1, this.canvas.height));
    this.skyScale[1] = t;
    gl.uniformMatrix3fv(prog.loc('uView'), false, viewMat3);
    gl.uniform2fv(prog.loc('uScale'), this.skyScale);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.skyTex.tex);
    gl.uniform1i(prog.loc('uSky'), 0);
    this.skyQuad.draw();
    this.draws++;
    // Снимаем привязку: на этом же блоке текстур дальше работает
    // поверхность, и оставлять на нём кубическую карту незачем.
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
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

    // Небо — под звёздами: та же бесконечность, тот же поворот.
    this.drawSky(m);

    // Звёзды рисуются всегда, в том числе в прыжке: они бесконечно
    // далеко и стоять на месте — их законное поведение. Лететь мимо
    // должен поток частиц, и это отдельный проход.
    this.pStars.use();
    gl.uniformMatrix4fv(this.pStars.loc('uProj'), false, this.proj);
    gl.uniformMatrix3fv(this.pStars.loc('uView'), false, m);
    gl.uniform1f(this.pStars.loc('uPointScale'),
      Math.min(window.devicePixelRatio || 1, Q.maxDpr));
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
    this.useGround(prog);
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uAmbient'), AMBIENT);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    // Тень своего корабля — на весь проход: на грунт, камни, растения,
    // постройки, стойки, трап и сам корпус.
    this.useShipShadow(prog, true);
    // Фары — на весь проход разом: и грунт, и камни, и станции, и чужие
    // корабли рисуются этой же программой.
    this.lamps = this.setLamps(prog, game);
    // Тени от фар — туда же и тем же проходом.
    this.cityShade = this.setCityShade(prog, game);
    // Свет зала станции — тоже на весь проход.
    this.hall = this.setHall(prog, game);

    // Дымка на грунте: воздух между камерой и точкой поверхности.
    // Получает её ТОЛЬКО тело, в чью атмосферу вошла камера, — у
    // остальных uAir.w = 0, и блок в шейдере пропускается одним
    // сравнением (js/gl/shaders.js, AIR_GLSL).
    const airBody = this.airBodyOf(world);

    // Поверхность плитками: она полностью заменяет сферу этого тела,
    // поэтому ни трафарет, ни деталь на пиксель тут не нужны.
    if (this.tileBody) {
      this.setAir(prog, this.tileBody === airBody ? airBody : null);
      this.setWater(prog, this.tileBody);
      this.drawTiles(prog, sunPos);
    }

    // Подробные заплатки поверхности — первыми, с записью трафарета:
    // там, где легла подробная земля, грубая сфера не нужна.
    const patchMeshes = this.patchBody ? this.patch.meshes : null;
    if (patchMeshes) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilMask(0xff);
      gl.stencilFunc(gl.ALWAYS, 1, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      bodyBasis(this.patchBody, this.basisTmp);
      this.setAir(prog, this.patchBody === airBody ? airBody : null);
      this.setWater(prog, this.patchBody);
      // Грань и угол у всех уровней набора общие: центр один на всех.
      const pc = this.patch.cur;
      this.setGrain(prog, this.patchBody, pc && pc.grainFace,
        pc && pc.grainOrg ? pc.grainOrg.su : 0,
        pc && pc.grainOrg ? pc.grainOrg.sv : 0,
        pc && pc.grainOrg ? pc.grainSpan : 0);
      for (const m of patchMeshes) {
        this.setDetail(prog, this.patchBody, m.cellAngle);
        this.drawObject(prog, m, this.patchBody.pos, this.basisTmp,
          this.patchBody.radius, sunPos);
      }
      gl.uniform1f(prog.loc('uGrainOn'), 0);
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
      this.setAir(prog, body === airBody ? airBody : null);
      this.setWater(prog, body);
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
    this.setWater(prog, null);          // и моря у них нет
    // Дымки на них нет: корабли, камни и растительность стоят в сотнях
    // метров от камеры, и воздуха между ними и глазом нет ни на глаз,
    // ни в числах.
    this.setAir(prog, null);

    // Небо — здесь, пока не нарисованы близкие предметы (почему
    // именно здесь, см. drawAir). Проверка глубины ему НУЖНА — ею оно и
    // отделяется от земли, у которой своя дымка, — а вот глубину
    // оно не пишет: запись сломала бы всё, что рисуется следом.
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (this.drawAir(world, sunPos, true)) prog.use();
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    // Камни на грунте. Рисуются после поверхности и без деталировки на
    // пиксель: это обычные модели, просто мелкие и в осях тела — от
    // середины поля, как плитки от своей (точность, см. drawTiles).
    if (this.rockBody && this.rocks.mesh) {
      bodyBasis(this.rockBody, this.basisTmp);
      const o = this.rocks.origin;
      gl.uniform3f(prog.loc('uLocalShift'), o[0], o[1], o[2]);
      // Фактура камня (GROUND.rock) — в слот поверхности, режим 2.
      gl.uniform1f(prog.loc('uSurfMode'), 2);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.ground.rock);
      if (this.drawObject(prog, this.rocks.mesh, this.localOrigin(this.rockBody, o), this.basisTmp,
        this.rockBody.radius, sunPos)) this.rockDraws++;
      gl.bindTexture(gl.TEXTURE_2D, this.blankTex.tex);
      gl.uniform1f(prog.loc('uSurfMode'), 0);
      gl.uniform3f(prog.loc('uLocalShift'), 0, 0, 0);
    }

    // Растительность. В отличие от камней рисуется как ПРЕДМЕТ — со
    // своим началом координат на грунте и в километрах (js/gl/flora.js):
    // в долях радиуса трава короче шага float32 и схлопывается.
    if (this.floraBody && this.flora.mesh) {
      bodyBasis(this.floraBody, this.basisTmp);
      toWorld(this.basisTmp, this.floraBody.pos, this.flora.origin,
        this._floraPos || (this._floraPos = { x: 0, y: 0, z: 0 }));
      // Струя движков гнёт растения (js/gl/wash.js). Считается в осях
      // того же тела, на котором стоит поле, — другое тело под кораблём
      // значит, что до этих деревьев струя не достаёт.
      const w = washState(game, this.wash || (this.wash = makeWash()));
      this.washOn = !!(this.washKnob && w.on && w.body === this.floraBody);
      washUniforms(gl, prog, this.washOn ? w : null, this.flora.origin,
        performance.now() / 1000);
      if (this.drawObject(prog, this.flora.mesh, this._floraPos, this.basisTmp, 1, sunPos)) this.floraDraws++;
      gl.uniform1f(prog.loc('uWashOn'), 0);
    }

    // Дальний лес — те же деревья до горизонта (js/gl/forest.js). Своя
    // программа; после неё возвращаемся к общей.
    if (this.forest) {
      this.drawForest(game, sunPos);
      prog.use();
    }

    // Наземный город. После грунта и камней, но до станций: он ближе
    // всего к камере, и так он реже перерисовывается поверх уже
    // закрашенного (глубина отсекает остальное сама).
    if (this.city.mesh && this.city.city) {
      const c = this.city.city;
      const d = Math.hypot(
        c.pos.x - this.camera.pos.x, c.pos.y - this.camera.pos.y, c.pos.z - this.camera.pos.z);
      // Дальше этого город не занимает и пикселя — рисовать его там
      // незачем, за это отвечает метка в приборах.
      if (d < c.radius * 2 * this.camera.focal) {
        if (this.drawObject(prog, this.city.mesh, c.pos, c.basis, 1, sunPos)) this.cityDraws = 1;
      }
    }

    // Станции. Фактуры зала кладутся по осям станции (vLocal — точка
    // модели), сдвига, как у плиток грунта, нет.
    gl.uniform3f(prog.loc('uLocalShift'), 0, 0, 0);
    for (const st of world.stations) {
      const d = Math.hypot(
        st.pos.x - this.camera.pos.x,
        st.pos.y - this.camera.pos.y,
        st.pos.z - this.camera.pos.z);
      if (d > 8000) continue;
      // Меш — по станции: корпус её типа и зал по её планировке
      // (js/models/stations.js, js/models/stationhall.js).
      this.drawObject(prog, this.glMeshFor(game.stationMesh(st)), st.pos, st.basis, 1, sunPos);
      this.drawStationInside(prog, game, st, sunPos);
    }

    // Свой корабль от третьего лица. Из рубки его рисует проход кабины
    // (drawCockpit) — изнутри и со своей ближней плоскостью.
    //
    // Обшивке нужны два числа (js/gl/hull.js): как работают подъёмные
    // (жар в соплах на днище) и сколько неба отражается в стекле мостика.
    const skyK = this.skyAt(game, sunPos);
    gl.uniform1f(prog.loc('uSkyK'), skyK);
    // Пилот за бортом (на трапе, на грунте) видит свой корабль снаружи —
    // так же, как камера от третьего лица.
    if (!game.ship.away && !game.ship.hidden
      && (game.state.view === 'chase' || walkingOut(game) || inForeign(game))) {
      const ship = game.ship;
      // Вес держат подъёмные только у тела: в пустоте сопла холодные.
      gl.uniform1f(prog.loc('uLiftGlow'),
        engineLoad(ship, this._load || (this._load = { lift: 0, main: 0 }), !!game.zone).lift);
      this.setShipCarve(prog, game, false);
      this.drawObject(prog, this.glMeshFor(game.shipMesh), ship.pos, ship.basis, 1, sunPos);
      gl.uniform1i(prog.loc('uCarveN'), 0);
      this.drawGear(prog, game, sunPos);
      this.drawHatches(prog, game, sunPos);
    }
    // У чужих кораблей работу движков сервер не присылает: сопла у них
    // чуть тлеют, как на зависании.
    gl.uniform1f(prog.loc('uLiftGlow'), 0.2);

    // Чужие пилоты — тем же корпусом, что и свой: других моделей пока
    // нет, а пустое место там, где по приборам кто-то есть, ощущается
    // как поломка игры (так и было: два пилота стояли в восьмистах
    // метрах и не видели друг друга).
    //
    // Положение берётся сглаженное (js/game/peers.js), иначе корабль
    // поедет пятью скачками в секунду — по числу снимков от сервера.
    const peers = game.peers;
    if (peers && peers.length && game.shipMesh) {
      for (const p of peers) {
        // Корпус — его типа, и люки с вырезом обшивки — по планировке его
        // типа (p.air.I): шлюзы соседа заводятся, когда помещения его типа
        // собраны (js/main.js, vesselAir).
        const H = this.hullFor(game, p);
        const same = !!(p.air && p.air.I);
        const mesh = this.glMeshFor(H.mesh);
        // Дальше этого корпус не занимает и пикселя: длина, делённая на
        // расстояние и умноженная на фокус, — это и есть размер в точках.
        // Рисовать его там незачем, за это отвечает метка в HUD.
        const far = (H.mesh.length || 0.065) * this.camera.focal;
        // На палубе этого корабля стоим — его рисует проход кабины.
        if (p === game.frame && inForeign(game)) continue;
        const d = Math.hypot(
          p.pos.x - this.camera.pos.x,
          p.pos.y - this.camera.pos.y,
          p.pos.z - this.camera.pos.z);
        if (d > far) continue;
        gl.uniform1f(prog.loc('uLiftGlow'), 0.2 + (p.lift || 0));
        gl.uniform1f(prog.loc('uFlatN'), 0);
        // Открытый люк — вырез в обшивке, как у своего: сквозь него шлюз.
        const near = d < 2;
        if (near && same) this.setShipCarveAir(prog, p.air.I, p.air, false);
        this.drawObject(prog, mesh, p.pos, p.basis, 1, sunPos);
        gl.uniform1i(prog.loc('uCarveN'), 0);
        if (!near) continue;
        this.drawGearOf(prog, game, p, sunPos);
        if (same && p.air) this.drawHatchesOf(prog, p, p.air, sunPos);
      }
    }
    // Люди на грунте — своей программой (js/gl/spacesuit.js); программа
    // сеток после них — обратно, следующий за ними ждёт её.
    this.drawPeopleOut(game, sunPos);
    prog.use();
  }

  /**
   * Люди на грунте: пилоты в скафандрах (js/gl/spacesuit.js) — в том же
   * свете, дымке и тени корабля, что камни у них под ногами.
   */
  drawPeopleOut(game, sunPos) {
    const list = game.people;
    this.peopleDraws = 0;
    if (!list || !list.length || !this.suit) return;
    const cam = this.camera;
    const near = (p) => p.here && p.st === 'out'
      && Math.hypot(p.place.pos.x - cam.pos.x, p.place.pos.y - cam.pos.y, p.place.pos.z - cam.pos.z) < PEOPLE_FAR;
    if (!list.some(near) || !this.suit.ready()) return;
    const gl = this.gl, sv = this.suit, prog = sv.pMain;
    prog.use();
    if (!this._suitShadow) {
      gl.uniform1i(prog.loc('uShipShadow'), SHIP_SHADOW.unit);
      this._suitShadow = true;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.blankTex.tex);
    gl.uniform1i(prog.loc('uSurfTex'), 0);
    gl.uniform1f(prog.loc('uSurfMode'), 0);
    this.useGround(prog);
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uAmbient'), AMBIENT);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    gl.uniform1f(prog.loc('uFlatN'), 1);
    gl.uniform1i(prog.loc('uCarveN'), 0);
    gl.uniform1f(prog.loc('uHullInside'), 0);
    gl.uniform1f(prog.loc('uLiftGlow'), 0);
    gl.uniform1f(prog.loc('uSkyK'), 0);
    this.setLamps(prog, game);
    this.setHall(prog, game);
    this.useShipShadow(prog, true);
    const t = (typeof performance === 'object' ? performance.now() : Date.now()) / 1000;
    for (const p of list) {
      if (!near(p)) continue;
      const body = game.world.bodies.find((b) => b.id === p.body) || null;
      this.setAir(prog, body);
      sv.pose(prog, p, t);
      // Модель в метрах, мир в километрах.
      modelView(cam.basis, cam.pos, p.place.basis, p.place.pos, 0.001, this.mv, this.nrm);
      gl.uniformMatrix4fv(prog.loc('uModelView'), false, this.mv);
      gl.uniformMatrix3fv(prog.loc('uNormalMat'), false, this.nrm);
      gl.uniform3fv(prog.loc('uSunDir'), this.setSunDir(p.place.pos, sunPos));
      sv.draw();
      this.draws++;
      this.peopleDraws++;
      this.tris += sv.S.tris;
    }
  }

  /**
   * Люди на палубе корабля кадра: пассажиры, хозяин в кресле. В свете
   * ламп помещений (проход кабины, js/gl/cabin.js), и только в тех
   * помещениях, что видно из того, где глаз.
   *
   * @returns сколько вызовов отрисовки ушло
   */
  /**
   * Трюм вокруг вездехода, в котором глаз (js/game/hangar.js): его комнаты
   * в свете его ламп, той же глубиной, что кабина. Без этого сквозь лобовое
   * стекло машины в закрытом трюме было бы видно улицу.
   */
  drawHoldAround(game, sunPos, size, logFC) {
    if (!this.cabin) return 0;
    const back = this.cabin.interOf;
    let n = 0;
    const H = game.hangarAround ? game.hangarAround() : null;
    if (H) n += this.cabin.drawLocksOutside(game, this.camera, size, sunPos, logFC, H.V, H.air, [H.room]);
    // Из трюма — в открытую дверь вездехода, что в нём стоит: его шлюз.
    for (const it of game.hangarSeen || []) {
      if (it.V === game.frame || !it.rAir || !it.rAir.hatches.some((hx) => hx.open > 0.01)) continue;
      if (H || it.V.pos === undefined) continue;
      n += this.cabin.drawLocksOutside(game, this.camera, size, sunPos, logFC, it.V, it.rAir);
    }
    // Помещения кабины — снова свои: по ним следующий кадр и люди.
    if (back && this.cabin.interOf !== back) this.cabin.buildInterior(back);
    return n;
  }

  drawPeopleIn(game, logFC) {
    const V = game.frame || game.ship, list = game.people, I = game.interior, cab = this.cabin;
    if (!V || !list || !list.length || !I || !cab || !this.suit) return 0;
    const aboard = (p) => p.here && p.st !== 'out' && p.ship === V.id;
    if (!list.some(aboard) || !this.suit.ready()) return 0;
    const gl = this.gl, sv = this.suit, prog = sv.pCabin;
    prog.use();
    cab.bindCommon(prog, cab.light, cab.lightBasis, 0, null);
    gl.uniform1f(prog.loc('uLogFC'), logFC);
    gl.uniform1f(prog.loc('uFlatN'), 1);
    const vis = cab.visible(game);
    const t = (typeof performance === 'object' ? performance.now() : Date.now()) / 1000;
    const M = this._suitM || (this._suitM = new Float32Array(16));
    const off = this._suitOff || (this._suitOff = [0, 0, 0]);
    let n = 0;
    for (const p of list) {
      if (!aboard(p)) continue;
      let x = p.p[0], y = p.p[1], z = p.p[2], yaw = p.yaw;
      if (p.st === 'seat') {
        // Сидящего ставят по глазу кресла: голова — туда, где глаз пилота.
        seatPlace(sv.S, I.seat.eye, I.INT.deck.bridge, off);
        x = off[0]; y = off[1]; z = off[2];
        yaw = 0;
      }
      const room = p.st === 'seat' ? 'bridge' : ((I.roomAt([x, y + 0.5, z]) || {}).id || 'bridge');
      if (!vis.includes(room)) continue;
      // Оси модели -> оси кабины: поворот по курсу и сдвиг от начала осей
      // кабины (глаз в кресле этого корабля: у «Прометея» — не там, где у
      // «Челленджера», cab.org).
      const c = Math.cos(yaw), s = Math.sin(yaw);
      M[0] = c; M[1] = 0; M[2] = -s; M[3] = 0;
      M[4] = 0; M[5] = 1; M[6] = 0; M[7] = 0;
      M[8] = s; M[9] = 0; M[10] = c; M[11] = 0;
      M[12] = x - cab.org.x; M[13] = y - cab.org.y; M[14] = z - cab.org.z; M[15] = 1;
      gl.uniformMatrix4fv(prog.loc('uModel'), false, M);
      sv.pose(prog, p, t);
      sv.draw();
      this.tris += sv.S.tris;
      n++;
    }
    return n;
  }

  /**
   * Воздух над телами: объём, а не плёнка (см. ATMO_FS).
   *
   * @param inside true — только те тела, ВНУТРИ атмосферы которых
   *        сейчас камера; false — только остальные
   *
   * Разделение не косметическое. Оболочка — это объём, и вопрос в том,
   * какая её сторона видна:
   *
   *   * СНАРУЖИ видна ближняя сторона. Она лежит перед планетой,
   *     поэтому обычный порядок прозрачного прохода работает как надо:
   *     буфер глубины сам отрежет её там, где ближе оказался корабль
   *     или станция;
   *   * ИЗНУТРИ ближняя сторона за спиной, и видна дальняя — а она
   *     лежит ЗА планетой. Буфер глубины отбрасывал её над всем
   *     грунтом, и воздух пропадал целиком: над головой он почти
   *     прозрачен по делу, а над поверхностью его просто не было.
   *     Именно так «атмосфера исчезала» при снижении.
   *
   * Поэтому изнутри воздух рисуется БЕЗ проверки глубины и раньше —
   * сразу после поверхности, но до камней, станций и корабля. Порядок
   * при этом выходит физически верным сам собой: дымка ложится на
   * далёкий грунт и не ложится на то, что рядом с камерой.
   */
  drawAir(world, sunPos, inside) {
    const gl = this.gl;
    const atmo = this.pAtmo;
    let used = false;
    for (const body of world.bodies) {
      if (!body.atmo) continue;
      if (this.pixelsOf(body) < 3) continue;
      const top = body.radius * (1 + ENTRY.top);
      const dist = Math.hypot(
        body.pos.x - this.camera.pos.x,
        body.pos.y - this.camera.pos.y,
        body.pos.z - this.camera.pos.z);
      if ((dist < top) !== inside) continue;
      if (!used) {
        used = true;
        atmo.use();
        gl.uniformMatrix4fv(atmo.loc('uProj'), false, this.proj);
        gl.uniform1f(atmo.loc('uLogFC'), this.logFC);
        // Ровно одно закрашивание пикселя: два сложили бы столб воздуха
        // дважды. Снаружи нужна ближняя сторона оболочки, изнутри —
        // дальняя, поэтому и отсекаются разные грани.
        //
        // Стороны названы «наоборот» не по ошибке. Камерное пространство
        // здесь ЛЕВОЕ: +z смотрит вперёд (см. perspective в
        // js/gl/mat4.js), и проекция зеркалит обход вершин. Ближняя
        // половина сферы, обойдённая против часовой стрелки в модели,
        // на экране выходит ПО часовой — то есть задней гранью. В
        // проекте это всплыло впервые: освещение двустороннее, и
        // отсечение до сих пор не включалось нигде. Ошибиться здесь
        // стоило чёрного неба у самой земли — изнутри отсекалась
        // единственная видимая сторона.
        gl.enable(gl.CULL_FACE);
        gl.cullFace(inside ? gl.BACK : gl.FRONT);
      }
      this.setAir(atmo, body);
      // Пол, на котором обрывается луч. СНАРУЖИ это средняя сфера тела:
      // оттуда в кадре вся полусфера сразу, и лучшего приближения к
      // рельефу с такого расстояния нет.
      //
      // ИЗНУТРИ пола нет вовсе — ноль. Эта оболочка рисует НЕБО, то есть
      // пиксели, где земли нет; отделяет их проверка глубины (она здесь
      // включена), а дымку на самой земле считает грунт своим шейдером и
      // по своему точному расстоянию. Пока пол стоял и изнутри, он у
      // горизонта оказывался выше настоящей земли на километры — и по
      // всему горизонту шла тёмная полоса с космосом на просвет.
      gl.uniform1f(atmo.loc('uFloor'), inside ? 0 : body.radius);
      bodyBasis(body, this.basisTmp);
      this.drawObject(atmo, this.atmoMesh, body.pos, this.basisTmp, top, sunPos);
    }
    if (used) gl.disable(gl.CULL_FACE);
    return used;
  }

  /**
   * Uniform-ы воздуха для программы: и оболочке неба, и грунту.
   *
   * Считают они один и тот же интеграл (js/gl/shaders.js, AIR_GLSL),
   * поэтому и числа у них обязаны быть одни. body === null — воздуха
   * нет: так помечается всё, что дымки не получает (корабли, станции,
   * камни, а для грунта — любое тело, кроме того, в чью атмосферу
   * вошла камера).
   */
  /**
   * Море тела (js/gl/water.js): включить его грунту и раздать волны.
   * Фазы считаются здесь, в double, от КАМЕРЫ и по общему времени мира;
   * в шейдер уходит только смещение фрагмента от камеры — во float32 это
   * точно, а точка на теле в тысячах километров — нет. Тело без жидкого
   * моря (и всё, что не грунт) — uWater = 0.
   */
  setWater(prog, body) {
    const gl = this.gl;
    const on = this.waterKnob && !!body && body.kind !== 'star' && !!terrainOf(body).kindCfg.liquid;
    gl.uniform1f(prog.loc('uWater'), on ? 1 : 0);
    if (!on) return;
    const w = waterFrame(waveSet(body), this.camera.basis, this.camera.pos,
      bodyBasis(body, this._seaBasis || (this._seaBasis = makeBasis())), body.pos,
      this.worldTime || 0, this._seaFrame || (this._seaFrame = makeWaterFrame()));
    gl.uniform1f(prog.loc('uSeaR'), body.radius);
    // Небо, которое отражает море, когда камера вне воздуха (с орбиты):
    // цвет атмосферы тела. Изнутри воздуха его считает сам луч.
    const a = body.atmo || [150, 190, 235];
    gl.uniform3f(prog.loc('uSeaSky'), a[0] / 255, a[1] / 255, a[2] / 255);
    gl.uniform3fv(prog.loc('uWaveDir[0]'), w.dir);
    gl.uniform4fv(prog.loc('uWave[0]'), w.wave);
    gl.uniform1f(prog.loc('uShoreT'), w.shore);
  }

  /**
   * Видно ли из глаза то, что за бортом (js/models/interior.js,
   * seesOutside). Сидя в кресле — всегда: рубка с фонарём или окнами. На
   * ногах — если из видимых комнат есть окно, рубка или открытый люк.
   * Видимые комнаты — те же, что рисует кабина: своя и соседние через
   * открытые двери (visibleNow); дверь открывается, когда к ней
   * подходят, — мир появляется в кадре раньше, чем в проёме.
   */
  outsideSeen(game) {
    this.inVis = null;
    const w = game.walk;
    if (!w || !w.on || w.out || w.phase !== 'walk' || !game.state || game.state.view !== 'cockpit') return true;
    const I = game.interior;
    if (!I || !this.cabin || !w.room) return true;
    this.inVis = this.cabin.visible(game);
    return seesOutside(I, this.inVis, airOf(game, frameOf(game)));
  }

  setAir(prog, body) {
    const gl = this.gl;
    if (!body || !body.atmo) {
      gl.uniform4f(prog.loc('uAir'), 1, 1, 1, 0);
      return;
    }
    gl.uniform3fv(prog.loc('uAirCenter'), this.centerInCamera(body.pos));
    gl.uniform4f(prog.loc('uAir'), body.radius, body.radius * (1 + ENTRY.top),
      body.radius * ENTRY.top / ENTRY.scales,
      // Тонкий воздух и выглядеть должен тоньше: то же давление, что
      // жжёт обшивку слабее (js/game/entry.js, airDensity).
      ATMO_THICK * (body.press === undefined ? 1 : body.press));
    gl.uniform3f(prog.loc('uAirColor'),
      body.atmo[0] / 255, body.atmo[1] / 255, body.atmo[2] / 255);
    gl.uniform1f(prog.loc('uAirGlow'), ATMO_GLOW);
  }

  /**
   * Сэмплеры фотографии грунта на весь проход: они всегда должны
   * смотреть в готовую текстуру, даже когда слой выключен. Заодно
   * выключается и сам слой — включают его только там, где рисуется
   * земля.
   */
  useGround(prog) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.ground.grain);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.ground.tint);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(prog.loc('uGrainTex'), 1);
    gl.uniform1i(prog.loc('uTintTex'), 2);
    gl.uniform1f(prog.loc('uGrainOn'), 0);
  }

  /**
   * Начало отсчёта фотографии для одного меша земли.
   *
   * Дробная часть считается в double здесь, на процессоре, — в этом вся
   * соль (js/gl/ground.js): в шейдер уезжают доли плитки, а не миллионы
   * плиток, и точности хватает на сантиметры.
   *
   * @param face грань куба, по осям которой уложена фотография
   * @param su0,sv0 угол меша на этой грани
   * @param span размах координаты меша в плитках зерна
   */
  setGrain(prog, body, face, su0, sv0, span) {
    const gl = this.gl;
    // Слишком крупный меш не считаем вовсе: на таком размахе у float32
    // пропадает дробная часть, и узор пошёл бы квадратами. Такие плитки
    // лежат далеко, зерна на них и так не видно (js/gl/ground.js).
    if (!body || !(span > 0) || span > GRAIN_MAX_SPAN) {
      gl.uniform1f(prog.loc('uGrainOn'), 0);
      return false;
    }
    const o = grainOrigin(body.radius, su0, sv0, this.grainOrg
      || (this.grainOrg = [0, 0, 0, 0, 0, 0]));
    gl.uniform4f(prog.loc('uGrainOrg'), o[0], o[1], o[2], o[3]);
    gl.uniform2f(prog.loc('uTintOrg2'), o[4], o[5]);
    const f = CUBE_FACES[face];
    gl.uniform3f(prog.loc('uGrainU'), f.U[0], f.U[1], f.U[2]);
    gl.uniform3f(prog.loc('uGrainV'), f.V[0], f.V[1], f.V[2]);
    gl.uniform1f(prog.loc('uGrainOn'), 1);
    return true;
  }

  /**
   * Тело, в чьей атмосфере сейчас камера, — его поверхность и получает
   * дымку. Тем же условием пользуется drawAir: оболочка неба и дымка на
   * грунте обязаны включаться ВМЕСТЕ, иначе на горизонте появится шов.
   */
  airBodyOf(world) {
    for (const body of world.bodies) {
      if (!body.atmo) continue;
      const top = body.radius * (1 + ENTRY.top);
      const dx = body.pos.x - this.camera.pos.x;
      const dy = body.pos.y - this.camera.pos.y;
      const dz = body.pos.z - this.camera.pos.z;
      if (dx * dx + dy * dy + dz * dz < top * top) return body;
    }
    return null;
  }

  // Стойки шасси: ступени каждой — от её точки крепления (drawGearOf).
  drawGear(prog, game, sunPos) {
    this.drawGearOf(prog, game, game.ship, sunPos);
  }

  /**
   * Корпус и стойки корабля ship: у соседа — его типа (поле ty снимка,
   * js/game/peers.js), у своего и у соседа без типа — свои.
   */
  hullFor(game, ship) {
    if (!ship || ship === game.ship || ship.own) return { mesh: game.shipMesh, gear: game.gearMesh, code: HULL.code, wheel: HULL.wheel };
    return hullOf(ship.type || ROOMS_TYPE) || { mesh: game.shipMesh, gear: game.gearMesh, code: HULL.code };
  }

  /**
   * Стойки корабля ship (свой или чужой — у чужого шасси из снимка).
   * Каждая стойка — ступени телескопа (js/models/gear.js): ступень едет
   * на свою долю хода, а не растягивается, и пята остаётся пятой.
   */
  drawGearOf(prog, game, ship, sunPos) {
    const H = this.hullFor(game, ship), G = H.gear;
    // Вездеход — на колёсах, а не на стойках.
    if (G && G.wheels) { this.drawWheelsOf(prog, H, ship, sunPos); return; }
    if (!G || !ship.gear || ship.gear.t < 0.01) return;
    const b = ship.basis;
    G.hardpoints.forEach((hp, i) => {
      const leg = G.legs[i];
      const drop = ship.gear.drop ? ship.gear.drop[i] : 0;
      for (const part of leg.parts) {
        const y = hp.y + stageLift(leg, G.legLengths[i], drop, ship.gear.t, part.k);
        this.tmpPos.x = ship.pos.x + b.right.x * hp.x + b.up.x * y + b.fwd.x * hp.z;
        this.tmpPos.y = ship.pos.y + b.right.y * hp.x + b.up.y * y + b.fwd.y * hp.z;
        this.tmpPos.z = ship.pos.z + b.right.z * hp.x + b.up.z * y + b.fwd.z * hp.z;
        if (this.drawObject(prog, this.glMeshFor(part.mesh), this.tmpPos, b, 1, sunPos)) this.gearDraws++;
      }
    });
  }

  /**
   * Колёса вездехода (js/models/rover.js): сетка одна на все шесть, каждое
   * со своим поворотом (steer, рад; плюс — вправо), вращением (spin, рад) и
   * ходом подвески (drop, м; плюс — вниз) — их ведёт js/game/rover.js
   * (ship.wheels). У чужого вездехода этого нет — колёса стоят.
   *
   * Левые колёса — правые, повёрнутые на пол-оборота вокруг вертикали, а
   * не зеркало: зеркало вывернуло бы грани наизнанку. Вращение у всех одно
   * и то же в мире — верх колеса идёт вперёд, когда машина едет вперёд.
   */
  drawWheelsOf(prog, H, ship, sunPos) {
    const G = H.gear, mesh = H.wheel;
    if (!mesh) return;
    const b = ship.basis, st = ship.wheels || null;
    const wb = this._wheelBasis || (this._wheelBasis = makeBasis());
    G.hardpoints.forEach((hp, i) => {
      const w = st && st[i];
      const s = w ? w.steer : 0, phi = w ? w.spin : 0, drop = w ? w.drop / 1000 : 0;
      const cs = Math.cos(s), ss = Math.sin(s), cp = Math.cos(phi), sp = Math.sin(phi);
      // Оси колеса в осях корабля: ось вращения a, вперёд f (после поворота).
      const a = [cs, 0, -ss], f = [ss, 0, cs];
      const up = [f[0] * sp, cp, f[2] * sp];
      const fw = [f[0] * cp, -sp, f[2] * cp];
      const side = hp.x < 0 ? -1 : 1;
      const R = [a[0] * side, a[1] * side, a[2] * side], F = [fw[0] * side, fw[1] * side, fw[2] * side];
      const put = (v, out) => {
        out.x = b.right.x * v[0] + b.up.x * v[1] + b.fwd.x * v[2];
        out.y = b.right.y * v[0] + b.up.y * v[1] + b.fwd.y * v[2];
        out.z = b.right.z * v[0] + b.up.z * v[1] + b.fwd.z * v[2];
      };
      put(R, wb.right); put(up, wb.up); put(F, wb.fwd);
      const y = hp.y - drop;
      this.tmpPos.x = ship.pos.x + b.right.x * hp.x + b.up.x * y + b.fwd.x * hp.z;
      this.tmpPos.y = ship.pos.y + b.right.y * hp.x + b.up.y * y + b.fwd.y * hp.z;
      this.tmpPos.z = ship.pos.z + b.right.z * hp.x + b.up.z * y + b.fwd.z * hp.z;
      if (this.drawObject(prog, this.glMeshFor(mesh), this.tmpPos, wb, 1, sunPos)) this.gearDraws++;
    });
  }

  /**
   * Карты теней (js/gl/shipshadow.js): кто отбрасывает тень в этом кадре
   * и его глубина со стороны солнца — по слою на тело.
   *
   *   слой 0 — свой корабль: корпус, стойки, створки и трапы;
   *   дальше — ближайшие чужие корабли (не дальше SHIP_SHADOW.peerRange
   *     от глаза, не больше SHIP_SHADOW.peers);
   *   последний — ближайшая станция (не дальше stationRange).
   *
   * Всегда, когда солнце видно, — и в пустоте: тень там ложится на
   * корпуса и станции. Солнце за телом (ночь, затмение) — карт нет вовсе.
   */
  updateShipShadow(game, sunPos) {
    this.shipShadowOn = 0;
    this.shadowN = 0;
    this.shadowWho.length = 0;
    const S = this.shipShadow, ship = game.ship, world = game.world;
    if (!S || !ship || !world) return;
    if (game.warp && game.warp.phase === 'tunnel') return;
    const cam = this.camera;
    // Прямого света нет — нет и теней: солнце за планетой у глаза.
    if (sunVisibility(world, cam.pos) < 0.02) return;
    const casters = this._casters || (this._casters = []);
    casters.length = 0;
    const radius = (mesh) => {
      const R = this._radii || (this._radii = new Map());
      let r = R.get(mesh);
      if (r === undefined) { r = hullRadius(mesh) + SHIP_SHADOW.pad; R.set(mesh, r); }
      return r;
    };
    if (!ship.away && !ship.hidden && game.shipMesh) casters.push({ kind: 'own', pos: ship.pos, basis: ship.basis, r: radius(game.shipMesh) });
    // Чужие — ближайшие к глазу.
    const near = [];
    for (const p of game.peers || []) {
      if (!p.pos || !p.basis) continue;
      const d = Math.hypot(p.pos.x - cam.pos.x, p.pos.y - cam.pos.y, p.pos.z - cam.pos.z);
      if (d < SHIP_SHADOW.peerRange) near.push([d, p]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < near.length && i < SHIP_SHADOW.peers; i++) {
      const p = near[i][1], H = this.hullFor(game, p);
      casters.push({ kind: 'peer', ship: p, pos: p.pos, basis: p.basis, mesh: H.mesh, r: radius(H.mesh) });
    }
    // Станция — ближайшая.
    let st = null, sd = SHIP_SHADOW.stationRange;
    for (const s of world.stations || []) {
      const d = Math.hypot(s.pos.x - cam.pos.x, s.pos.y - cam.pos.y, s.pos.z - cam.pos.z);
      if (d < sd) { sd = d; st = s; }
    }
    if (st && game.stationMesh) {
      const mesh = game.stationMesh(st);
      casters.push({ kind: 'station', pos: st.pos, basis: st.basis, mesh, r: radius(mesh) });
    }

    const gl = this.gl, pd = this.pShipDepth;
    pd.use();
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.clearDepth(1);
    // Проходу глубины материал не нужен у сеток без него (станции, стойки):
    // постоянное значение — «не стекло».
    if (this.meshLocs.aMat >= 0) gl.vertexAttrib1f(this.meshLocs.aMat, 0);
    const n = Math.min(casters.length, S.layers);
    for (let i = 0; i < n; i++) {
      const c = casters[i];
      const sun = this._sunTo || (this._sunTo = { x: 0, y: 0, z: 0 });
      sun.x = sunPos.x - c.pos.x; sun.y = sunPos.y - c.pos.y; sun.z = sunPos.z - c.pos.z;
      const L = this.shadowLayers[i] || (this.shadowLayers[i] = { F: undefined, mat: new Float32Array(16) });
      const F = L.F = shadowFrame(c.pos, sun, c.r, L.F);
      // «Камера» прохода глубины — солнце: оси карты и центр в теле.
      const eye = this._depthEye || (this._depthEye = { pos: { x: 0, y: 0, z: 0 }, basis: makeBasis() });
      eye.pos.x = F.c.x; eye.pos.y = F.c.y; eye.pos.z = F.c.z;
      const eb = eye.basis;
      eb.right.x = F.r[0]; eb.right.y = F.r[1]; eb.right.z = F.r[2];
      eb.up.x = F.u[0]; eb.up.y = F.u[1]; eb.up.z = F.u[2];
      eb.fwd.x = F.f[0]; eb.fwd.y = F.f[1]; eb.fwd.z = F.f[2];
      gl.bindFramebuffer(gl.FRAMEBUFFER, S.fbos[i]);
      gl.viewport(0, 0, S.size, S.size);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(pd.loc('uInvH'), 1 / F.h);
      this.depthEye = eye;
      if (c.kind === 'own') {
        this.drawObject(pd, this.glMeshFor(game.shipMesh), ship.pos, ship.basis, 1, sunPos);
        this.drawGear(pd, game, sunPos);
        this.drawHatches(pd, game, sunPos);
      } else if (c.kind === 'peer') {
        this.drawObject(pd, this.glMeshFor(c.mesh), c.pos, c.basis, 1, sunPos);
        this.drawGearOf(pd, game, c.ship, sunPos);
        if (c.ship.air && c.ship.air.I) this.drawHatchesOf(pd, c.ship, c.ship.air, sunPos);
      } else {
        this.drawObject(pd, this.glMeshFor(c.mesh), c.pos, c.basis, 1, sunPos);
      }
      this.depthEye = null;
      this.shadowWho.push(c.kind);
      this.shipShadowPasses++;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowN = n;
    this.shipShadowOn = n > 0 ? 1 : 0;
    this.shipShadowFrame = n > 0 ? this.shadowLayers[0].F : null;
  }

  /** Тени — в программу сеток на этот проход (on = false — без них). */
  useShipShadow(prog, on) {
    const gl = this.gl;
    const n = on && this.shipShadowOn ? this.shadowN : 0;
    gl.uniform1f(prog.loc('uShipShadowOn'), n > 0 ? 1 : 0);
    gl.uniform1i(prog.loc('uShipShadowN'), n);
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const L = this.shadowLayers[i];
      shadowMatrix(L.F, this.camera, L.mat);
      gl.uniformMatrix4fv(prog.loc(`uShipShadowMat[${i}]`), false, L.mat);
      gl.uniform2f(prog.loc(`uShipShadowK[${i}]`), 1 / this.shipShadow.size, 2 * L.F.h / this.shipShadow.size);
    }
    // Карты лежат на своём блоке всегда, но проход кабины и запекание
    // работают с текстурами сами — привязываем заново, это дёшево.
    gl.activeTexture(gl.TEXTURE0 + SHIP_SHADOW.unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shipShadow.tex);
    gl.activeTexture(gl.TEXTURE0);
  }

  drawTransparent(game, world, sunPos) {
    // Солнце нужно и облакам пыли в проходе ореолов (drawAirDust).
    this.lastSunPos = sunPos;
    const gl = this.gl;
    gl.depthMask(false);
    gl.enable(gl.BLEND);

    // Болты — первыми из светящегося: они летят между кораблями, и их
    // обязан перекрывать корпус (глубина уже записана непрозрачным
    // проходом), а не наоборот.
    this.drawBolts(game);
    this.drawShields(game);

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

    // Атмосферы тех тел, ДО которых ещё не долетели. Те, внутрь которых
    // корабль уже вошёл, нарисованы раньше — сразу за поверхностью
    // (см. drawAir).
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.drawAir(world, sunPos, false);
    // Дальше снова аддитивное: ореолы и плазма светятся.
    gl.blendFunc(gl.ONE, gl.ONE);

    this.drawEntryPlume(game, sunPos);
    this.drawGlows(game, world);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /**
   * Оболочка щита: сфера вокруг корабля, видимая только в момент удара.
   *
   * Складывается из трёх вещей: еле заметной ровной подсветки (чтобы
   * читалась сама сфера), яркой кромки (чтобы это была оболочка, а не
   * заливка поверх корабля) и пятна в точке удара — туда пришёл луч.
   * Направление на точку хранится в осях МИРА и поворачивается сюда, а
   * не запоминается точкой: корабль летит, и оболочка летит с ним.
   */
  drawShields(game) {
    const guns = game.guns;
    if (!guns || !guns.shields || !guns.shields.length) return;
    const gl = this.gl;
    const cam = this.camera;
    const prog = this.pShield;
    const b = cam.basis;

    prog.use();
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    gl.uniform3fv(prog.loc('uColor'), SHIELD_TINT);
    SHIELD_SCALE.set(HULL.shield);
    gl.uniform3fv(prog.loc('uScale'), SHIELD_SCALE);
    // Сложение: оболочка светится и не должна темнить то, что за ней.
    gl.blendFunc(gl.ONE, gl.ONE);

    for (const f of guns.shields) {
      const ship = f.own ? game.ship : (game.peers || []).find((p) => p.id === f.id);
      if (!ship || !ship.pos || !ship.basis) continue;
      // Вспышка гаснет быстрее, чем живёт: удар виден сразу, а память о
      // нём — недолго.
      const k = Math.max(0, 1 - f.age / f.life);
      const fade = k * k;
      if (fade < 0.01) continue;

      // Оболочка идёт в ОСЯХ КОРАБЛЯ: она повторяет его форму, и вместе
      // с ним же вертится. Масштаб задаётся не здесь, а полуосями в
      // шейдере — матрица должна остаться поворотом.
      modelView(cam.basis, cam.pos, ship.basis, ship.pos, 1, this.mv, this.nrm);
      gl.uniformMatrix4fv(prog.loc('uModelView'), false, this.mv);
      gl.uniformMatrix3fv(prog.loc('uNormalMat'), false, this.nrm);
      // Направление на точку удара уже в осях корабля — переводить его
      // никуда не надо, там же живёт и параметр сферы.
      gl.uniform3fv(prog.loc('uHitDir'), new Float32Array([f.dx, f.dy, f.dz]));
      gl.uniform1f(prog.loc('uFade'), fade);
      this.shieldMesh.draw();
      this.draws++;
      this.tris += this.shieldMesh.faces || this.shieldMesh.tris || 0;
    }
  }

  /**
   * Болты в кадре.
   *
   * Четырёхугольник разворачивается К КАМЕРЕ на процессоре: болт — это
   * отрезок, и без разворота он пропадал бы, когда летит точно от нас или
   * на нас. Точки считаются ОТНОСИТЕЛЬНО КАМЕРЫ, как и всё в этой сцене:
   * в float32 координаты орбит теряют метры, а болт длиной пятьдесят
   * метров из этих метров и состоит.
   */
  drawBolts(game) {
    const guns = game.guns;
    const buf = this.bolts;
    if (!guns || !guns.bolts || !guns.bolts.length || !buf) return;
    const gl = this.gl;
    const cam = this.camera;
    const prog = this.pBolt;

    let n = 0;
    for (const b of guns.bolts) {
      if (n >= buf.max) break;
      const hx = b.x - cam.pos.x, hy = b.y - cam.pos.y, hz = b.z - cam.pos.z;
      const tx = hx - b.dx * b.len, ty = hy - b.dy * b.len, tz = hz - b.dz * b.len;

      // Толщина с полом по расстоянию: болт в километре иначе тоньше
      // пикселя, и очередь читается как редкое мигание.
      const d = Math.hypot(hx, hy, hz);
      // След прыжка (quantumFx, wide) — втрое толще: он в десятках
      // километров, и в пиксель шириной его не разглядеть.
      const w = Math.max(0.0025, d * 0.0016) * (b.wide || 1);

      // Поперечное направление: перпендикуляр и к болту, и к взгляду.
      let sx = b.dy * hz - b.dz * hy;
      let sy = b.dz * hx - b.dx * hz;
      let sz = b.dx * hy - b.dy * hx;
      const sl = Math.hypot(sx, sy, sz);
      if (!(sl > 1e-12)) continue;            // смотрим ровно вдоль болта
      sx = (sx / sl) * w; sy = (sy / sl) * w; sz = (sz / sl) * w;

      const P = buf.pos, U = buf.uv, C = buf.col;
      const q = [
        [tx - sx, ty - sy, tz - sz, -1, 0],
        [tx + sx, ty + sy, tz + sz, 1, 0],
        [hx + sx, hy + sy, hz + sz, 1, 1],
        [tx - sx, ty - sy, tz - sz, -1, 0],
        [hx + sx, hy + sy, hz + sz, 1, 1],
        [hx - sx, hy - sy, hz - sz, -1, 1],
      ];
      const col = b.color || [1, 0.4, 0.3];
      for (let i = 0; i < 6; i++) {
        const c = q[i];
        const vi = n * 6 + i;
        P[vi * 3] = c[0]; P[vi * 3 + 1] = c[1]; P[vi * 3 + 2] = c[2];
        U[vi * 2] = c[3]; U[vi * 2 + 1] = c[4];
        C[vi * 3] = col[0]; C[vi * 3 + 1] = col[1]; C[vi * 3 + 2] = col[2];
      }
      n++;
    }
    if (!n) return;

    buf.upload(n);
    prog.use();
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    // Матрица — чистый поворот камеры: точки уже сдвинуты к ней.
    modelView(cam.basis, cam.pos, this.identBasis, cam.pos, 1, this.mv, this.nrm);
    gl.uniformMatrix4fv(prog.loc('uModelView'), false, this.mv);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    // Сложение, а не смешивание: это свет, и два болта друг за другом
    // должны быть ярче одного.
    gl.blendFunc(gl.ONE, gl.ONE);
    this.tris += buf.draw();
    this.draws++;
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
    if (!e || !(e.heat > 0) || !game.shipMesh) return;
    const gl = this.gl;
    const ship = game.ship;
    // Оболочка считается один раз на корпус: сварка вершин, сглаживание
    // и нормали стоят миллисекунды, но каждый кадр их тратить незачем —
    // корпус не меняется.
    if (this.shockSrc !== game.shipMesh) {
      if (this.shockMesh) this.shockMesh.dispose();
      this.shockMesh = buildShockMesh(gl, this.plumeLocs, game.shipMesh);
      this.shockSrc = game.shipMesh;
    }
    const prog = this.pPlume;
    prog.use();
    gl.uniformMatrix4fv(prog.loc('uProj'), false, this.proj);
    gl.uniform1f(prog.loc('uLogFC'), this.logFC);
    gl.uniform3fv(prog.loc('uColor'), new Float32Array(e.color));
    gl.uniform1f(prog.loc('uHeat'), e.heat);
    // Время нужно только дрожанию; секунды по настенным часам годятся.
    gl.uniform1f(prog.loc('uTime'), (Date.now() % 1000000) / 1000);

    const L = game.shipMesh.length || 0.065;
    // Отход волны от лобовых поверхностей: на малом нагреве она
    // облизывает обшивку, на большом отходит заметным зазором.
    gl.uniform1f(prog.loc('uStand'), L * (0.04 + 0.28 * e.heat));
    // Длина следа за кормой.
    gl.uniform1f(prog.loc('uTail'), L * (0.5 + 6 * e.heat));
    gl.uniform1f(prog.loc('uSpan'), L * 0.5);
    // Порог затухания вблизи: четверть длины корпуса.
    gl.uniform1f(prog.loc('uNear'), L * 0.25);

    // Поток — в осях КОРАБЛЯ: волна строится по корпусу, поэтому и
    // наветренность считается в его же координатах. При развороте
    // раскаляется тот борт, который подставлен потоку.
    toLocal(ship.basis, this.originZero, e.dir, this.tmpFlow);
    gl.uniform3f(prog.loc('uFlow'), this.tmpFlow.x, this.tmpFlow.y, this.tmpFlow.z);
    this.drawObject(prog, this.shockMesh, ship.pos, ship.basis, 1, sunPos);
  }

  /**
   * Пыль в воздухе (js/game/dust.js, updateAirDust).
   *
   * Два отличия от пыли на луне, и оба про то, что это ОБЛАКО, а не
   * искры:
   *
   *   * размер — в метрах, а не в пикселях. Кольцо пыли под кораблём —
   *     это сотни метров, и дальний его край обязан быть мельче
   *     ближнего; облачко постоянного экранного размера превращало бы
   *     кольцо в ровную полосу;
   *   * смешивание — «поверх», а не сложением. Сложение делает частицу
   *     светом: на луне, где фон чёрный, это сходит, а над дневным
   *     лугом пыль выходила светящимися пятнами. Облако ЗАСЛОНЯЕТ то, что
   *     за ним, и освещено тем же солнцем, что и грунт.
   */
  drawAirDust(dust, prog) {
    const gl = this.gl;
    const cam = this.camera;
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(prog.loc('uFalloff'), 1.2);
    bodyBasis(dust.body, this.basisTmp);
    modelView(cam.basis, cam.pos, this.basisTmp, dust.body.pos, 1, this.mv, null);
    // Пиксели кадра на километр на единичной глубине: фокус камеры в
    // точках CSS, а буфер может быть крупнее (плотность экрана).
    const k = cam.focal * (this.canvas.height / Math.max(1, cam.h));
    // Освещённость облака: солнце над местным горизонтом.
    const lit = this.dustLit(dust.body);
    for (const p of dust.list) {
      const c = applyMat16(this.mv, p.x, p.y, p.z, this.tmp3);
      if (c[2] <= NEAR) continue;
      const px = p.size * k / c[2];
      if (px < 0.6) continue;
      gl.uniform3fv(prog.loc('uCenterView'), new Float32Array([c[0], c[1], c[2]]));
      gl.uniform1f(prog.loc('uRadiusPx'), Math.min(px, 900));
      const col = p.col || [0.74, 0.7, 0.64];
      gl.uniform3fv(prog.loc('uColor'),
        new Float32Array([col[0] * lit, col[1] * lit, col[2] * lit]));
      // Молодое облако плотнее: пока его не раздуло, оно заслоняет.
      gl.uniform1f(prog.loc('uIntensity'), 0.5 * p.fade * p.fade);
      this.quad.draw();
      this.draws++;
    }
    gl.uniform1f(prog.loc('uFalloff'), GLOW_FALLOFF);
    gl.blendFunc(gl.ONE, gl.ONE);
  }

  /**
   * Сколько светлого неба над кораблём, 0..1: его отражает стекло
   * мостика (js/gl/hull.js). Небо бывает только под воздухом и только
   * днём; в пустоте и ночью стекло отражает черноту.
   */
  skyAt(game, sunPos) {
    const z = game.zone;
    const b = z && z.body;
    if (!b || !b.atmo || !(z.alt < b.radius * ENTRY.top)) return 0;
    const p = game.ship.pos;
    const ux = p.x - b.pos.x, uy = p.y - b.pos.y, uz = p.z - b.pos.z;
    const sx = sunPos.x - p.x, sy = sunPos.y - p.y, sz = sunPos.z - p.z;
    const e = (ux * sx + uy * sy + uz * sz) / ((Math.hypot(ux, uy, uz) * Math.hypot(sx, sy, sz)) || 1);
    // Сумерки: небо светлеет, пока солнце поднимается на первые
    // пятнадцать градусов.
    const t = Math.max(0, Math.min(1, (e + 0.05) / 0.3));
    const day = t * t * (3 - 2 * t);
    // Выше над грунтом воздуха меньше, и небо темнеет к космосу.
    return day * Math.max(0, 1 - z.alt / (b.radius * ENTRY.top));
  }

  /**
   * Огни корабля (js/models/hulldetail.js): ходовые, вспышки, маяки.
   *
   * Точка огня не меньше двух пикселей: светящаяся точка на экране не
   * тает до нуля с расстоянием, как тает предмет, — её размывает сам
   * глаз. Ореол вокруг виден тем лучше, чем темнее вокруг: днём огонь
   * — точка, ночью — пятно.
   */
  drawNavLights(prog, mesh, pos, basis, t, dayK) {
    const lights = mesh.navLights;
    if (!lights || !lights.length) return;
    const gl = this.gl;
    const cam = this.camera;
    modelView(cam.basis, cam.pos, basis, pos, 1, this.mv, null);
    const k = cam.focal * (this.canvas.height / Math.max(1, cam.h));
    for (const L of lights) {
      const level = lightLevel(L.kind, t);
      if (level <= 0.01) continue;
      const c = applyMat16(this.mv, L.pos.x, L.pos.y, L.pos.z, this.tmp3);
      if (c[2] <= NEAR) continue;
      const size = L.kind === 'strobe' ? 0.0006 : 0.0004;          // км
      const core = Math.max(2.2, size * k / c[2]);
      // Ходовые днём тусклее — они для ночи; вспышки рассчитаны и на день.
      const bright = L.kind === 'nav' ? 1 - 0.45 * dayK : 1;
      gl.uniform3fv(prog.loc('uCenterView'), new Float32Array([c[0], c[1], c[2]]));
      gl.uniform3fv(prog.loc('uColor'), new Float32Array(L.color));
      gl.uniform1f(prog.loc('uRadiusPx'), core * 4);
      gl.uniform1f(prog.loc('uIntensity'), level * bright * 0.35 * (1 - 0.7 * dayK));
      this.quad.draw();
      gl.uniform1f(prog.loc('uRadiusPx'), core);
      gl.uniform1f(prog.loc('uIntensity'), level * bright);
      this.quad.draw();
      this.draws += 2;
    }
  }

  /** Сколько солнца падает на облако у поверхности, 0..1. */
  dustLit(body) {
    const sunPos = this.lastSunPos;
    if (!sunPos || !body) return 0.7;
    const up = this.camera.pos;
    const ux = up.x - body.pos.x, uy = up.y - body.pos.y, uz = up.z - body.pos.z;
    const sx = sunPos.x - body.pos.x, sy = sunPos.y - body.pos.y, sz = sunPos.z - body.pos.z;
    const e = (ux * sx + uy * sy + uz * sz) / ((Math.hypot(ux, uy, uz) * Math.hypot(sx, sy, sz)) || 1);
    return AMBIENT + (1 - AMBIENT) * Math.max(0, Math.min(1, e * 2.5));
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

    // Вспышки попаданий. Радиус в ПИКСЕЛЯХ даёт постоянный размер на
    // экране — это и нужно: вспышка в трёх километрах должна быть видна,
    // а не превращаться в точку. Растёт и гаснет она по возрасту.
    const guns = game.guns;
    if (guns && guns.blasts && guns.blasts.length) {
      for (const b of guns.blasts) {
        const k = Math.max(0, 1 - b.age / b.life);
        const grow = 1 - k * k;                   // сначала быстро, потом вяло
        glow({ x: b.x, y: b.y, z: b.z },
          (10 + 26 * grow) * (b.size || 1),
          new Float32Array(b.color),
          k * k);                                  // гаснет быстрее, чем растёт
      }
    }

    // Корона светила.
    const star = world.star;
    const starPx = this.pixelsOf(star);
    if (starPx > 0.5 && starPx !== Infinity) {
      glow(star.pos, starPx * 6,
        new Float32Array([star.color[0] / 255, star.color[1] / 255, star.color[2] / 255]),
        0.55);
    }

    // Факелы двигателей и огни своего корабля — в обоих видах: из рубки их
    // видно, стоит обернуться.
    const ship = game.ship;
    const own = !ship.away && !ship.hidden;
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

    // Огни — свои и чужих кораблей. Мигают по часам страницы: это
    // картинка, а не состояние корабля.
    {
      const t = performance.now() / 1000;
      const dayK = this.skyAt(game, world.star.pos);
      if (own && game.shipMesh.navLights) {
        this.drawNavLights(prog, game.shipMesh, ship.pos, ship.basis, t, dayK);
      }
      const peers = game.peers || [];
      for (let i = 0; i < peers.length; i++) {
        const p = peers[i];
        const pm = this.hullFor(game, p).mesh;
        const far = (pm.length || 0.065) * cam.focal * 20;
        const d = Math.hypot(p.pos.x - cam.pos.x, p.pos.y - cam.pos.y, p.pos.z - cam.pos.z);
        // Сдвиг по фазе — чтобы чужие вспышки не шли в такт своим.
        if (d < far && pm.navLights) this.drawNavLights(prog, pm, p.pos, p.basis, t + i * 0.37 + 0.5, dayK);
      }
    }

    // Пыль из-под движков. Частицы живут в осях ТЕЛА (см. js/game/dust.js),
    // поэтому и матрица берётся телесная: иначе пыль отставала бы от
    // грунта ровно на скорость вращения планеты.
    const dust = game.dust;
    if (dust && dust.body && dust.list.length && dust.air) {
      this.drawAirDust(dust, prog);
    } else if (dust && dust.body && dust.list.length) {
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
