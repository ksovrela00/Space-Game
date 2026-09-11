// Планеты рисуются не полигонами, а аналитически: силуэт шара, освещённость
// с фазой (терминатор), процедурные пятна поверхности, спроецированные на
// видимую полусферу, атмосферный ореол и кольца. Дешевле тесселяции сферы
// и выглядит ближе к Frontier.
//
// Силуэт берётся из camera.silhouette() — это ЭЛЛИПС со смещённым центром,
// а не круг: в перспективе шар вне оси взгляда растягивается по радиусу.
// Всё, что рисуется «в круге» (градиент, терминатор, дымка), рисуется в
// пространстве единичного круга, а трансформация canvas превращает его в
// нужный эллипс. Пятна поверхности проецируются честно, точка за точкой.

import { v3, dot, normalize, clamp } from '../core/vec3.js';
import { clipNear } from './clip.js';

const TAU = Math.PI * 2;

const shade = (c, s) => `rgb(${Math.min(255, c[0] * s) | 0},${Math.min(255, c[1] * s) | 0},${Math.min(255, c[2] * s) | 0})`;
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// Направление точки поверхности (широта/долгота) в мировых координатах.
const surfaceDir = (body, lat, lon, out = v3()) => {
  const A = body.eqRef, B = body.eqSide, N = body.pole;
  const cl = Math.cos(lat), sl = Math.sin(lat);
  const cx = cl * Math.cos(lon), cz = cl * Math.sin(lon);
  out.x = A.x * cx + B.x * cz + N.x * sl;
  out.y = A.y * cx + B.y * cz + N.y * sl;
  out.z = A.z * cx + B.z * cz + N.z * sl;
  return out;
};

/**
 * Геометрия освещения тела.
 *
 * Фаза (какая доля диска освещена) определяется ТОЛЬКО взаимным
 * положением солнца, тела и камеры — угол cos между направлениями
 * тело->солнце и тело->камера. Раньше здесь стояло dot(L, cam.fwd), то
 * есть ось ВЗГЛЯДА, и тень на планетах менялась при развороте корабля,
 * будто солнце поворачивается вместе с ним.
 *
 * От ориентации камеры зависит только одно: под каким углом терминатор
 * виден на экране. Это ось терминатора — составляющая направления на
 * солнце, перпендикулярная направлению на камеру, выраженная в экранных
 * осях.
 *
 * @param toCam вектор тело -> камера (не нормированный)
 */
export function sunGeometry(body, sunPos, cam, toCamX, toCamY, toCamZ) {
  const L = normalize(v3(
    sunPos.x - body.pos.x, sunPos.y - body.pos.y, sunPos.z - body.pos.z));
  const V = normalize(v3(toCamX, toCamY, toCamZ));
  const cosPhase = clamp(dot(L, V), -1, 1);

  let px = L.x - V.x * cosPhase;
  let py = L.y - V.y * cosPhase;
  let pz = L.z - V.z * cosPhase;
  const pl = Math.hypot(px, py, pz);
  let sunAng = 0;
  if (pl > 1e-9) {
    px /= pl; py /= pl; pz /= pl;
    const cb = cam.basis;
    const sx = px * cb.right.x + py * cb.right.y + pz * cb.right.z;
    const sy = px * cb.up.x + py * cb.up.y + pz * cb.up.z;
    sunAng = Math.atan2(-sy, sx);      // экранный y направлен вниз
  }
  return { L, V, cosPhase, sunAng };
}

/**
 * Поставить небесное тело в очередь отрисовки.
 * @param renderer Renderer
 * @param body     объект из world.js
 * @param sunPos   позиция светила в мире
 */
export function drawBody(renderer, body, sunPos) {
  const cam = renderer.camera;
  const R = body.radius;
  const dx = body.pos.x - cam.pos.x;
  const dy = body.pos.y - cam.pos.y;
  const dz = body.pos.z - cam.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  const isStar = body.kind === 'star';

  // Внутри тела: закрашиваем экран (аварийная ситуация, длится кадр-два).
  if (dist <= R * 1.001) {
    renderer.push(-1e15, (ctx) => {
      ctx.fillStyle = shade(body.color, isStar ? 2 : 0.6);
      ctx.fillRect(0, 0, cam.w, cam.h);
    });
    return;
  }

  const c = cam.toCamera(body.pos);
  const sil = cam.silhouette(c, R);

  if (!sil.ok) {
    // Силуэт выродился (θ + α >= 90°): он пересекает плоскость экрана и
    // проецируется уже не в эллипс, а в гиперболу. Так бывает только
    // вплотную к планете. Заливать весь экран здесь нельзя — при
    // развороте это давало вспышку «мы внутри планеты», а отказ рисовать
    // давал обратное: планета пропадала при подлёте. Рисуем настоящую
    // область: линию силуэта как 3D-окружность с отсечением по near.
    if (sil.cosNear > 0) drawNearSilhouette(renderer, body, c, sil, sunPos, depthOf(dist, R));
    return;
  }

  const ex = sil.x, ey = sil.y, ea = sil.a, eb = sil.b, ephi = sil.angle;
  const margin = ea + 8;
  if (ex < -margin || ex > cam.w + margin || ey < -margin || ey > cam.h + margin) return;

  const depth = dist - R;

  // Далёкое тело — просто светящаяся точка (как звезда, но чуть крупнее).
  if (eb < 1.1) {
    const bright = clamp(1.6 - dist / (isStar ? 1e9 : 4e6), 0.25, 1);
    renderer.push(depth, (ctx) => {
      ctx.globalAlpha = bright;
      ctx.fillStyle = shade(body.color, 1.25);
      ctx.fillRect(ex - 1, ey - 1, 2, 2);
      ctx.globalAlpha = 1;
    });
    return;
  }

  if (isStar) {
    renderer.push(depth, (ctx) => drawStarDisc(ctx, ex, ey, ea, eb, ephi, body));
    return;
  }

  // Освещение: фаза и экранная ось терминатора.
  const sun = sunGeometry(body, sunPos, cam, -dx, -dy, -dz);
  const L = sun.L, V = sun.V;
  const sunAng = sun.sunAng;
  const cosPhase = sun.cosPhase;

  // То же направление в пространстве единичного круга: под анизотропным
  // масштабом (ea, eb) углы меняются, поэтому вектор пересчитываем.
  const su = unitSpaceAngle(sunAng, ephi, ea, eb);

  const horizon = R / dist;                 // косинус угла горизонта
  const ppu = cam.focal / c.z;              // пикселей на км на этой глубине

  // Видимые пятна поверхности: считаем заранее, чтобы в draw() не лазить в камеру.
  const spots = [];
  if (eb > 7 && body.features) {
    const d = v3();
    for (const f of body.features) {
      surfaceDir(body, f.lat, f.lon + body.spinPhase, d);
      const cosV = d.x * V.x + d.y * V.y + d.z * V.z;
      if (cosV <= horizon + 0.015) continue;
      const wp = v3(body.pos.x + d.x * R, body.pos.y + d.y * R, body.pos.z + d.z * R);
      const pc = cam.toCamera(wp);
      if (pc.z <= cam.near) continue;
      const sp = cam.project(pc);
      const rad = f.size * R * (cam.focal / pc.z);
      if (rad < 0.7) continue;
      const fore = clamp((cosV - horizon) / (1 - horizon), 0, 1);
      const lit = clamp(d.x * L.x + d.y * L.y + d.z * L.z, 0, 1);
      spots.push({
        x: sp.x, y: sp.y,
        rx: Math.max(0.4, rad * Math.sqrt(Math.max(0.04, fore))),
        ry: rad,
        ang: Math.atan2(sp.y - ey, sp.x - ex),
        color: f.color,
        shade: 0.35 + 0.65 * lit,
      });
    }
  }

  // Кольца: сэмплируем окружность и разделяем на части перед/за планетой.
  let ringBack = null, ringFront = null;
  if (body.rings && eb > 3) {
    const segs = 96;
    const back = [], front = [];
    const A = body.eqRef, B = body.eqSide;
    const mid = (body.rings.inner + body.rings.outer) * 0.5 * R;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * TAU;
      const ca = Math.cos(a) * mid, sa = Math.sin(a) * mid;
      const wp = v3(
        body.pos.x + A.x * ca + B.x * sa,
        body.pos.y + A.y * ca + B.y * sa,
        body.pos.z + A.z * ca + B.z * sa);
      const pc = cam.toCamera(wp);
      const inFront = pc.z < c.z;
      if (pc.z <= cam.near) { (inFront ? front : back).push(null); continue; }
      const sp = cam.project(pc);
      (inFront ? front : back).push(sp);
      (inFront ? back : front).push(null);
    }
    ringBack = back; ringFront = front;
    body._ringWidth = (body.rings.outer - body.rings.inner) * R * ppu;
  }

  renderer.push(depth, (ctx) => {
    if (ringBack) strokeRing(ctx, ringBack, body, 0.55);

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, ey, ea, eb, ephi, 0, TAU);
    ctx.clip();

    // База и терминатор рисуются в пространстве единичного круга —
    // трансформация canvas сама растягивает их в силуэт-эллипс.
    inDisc(ctx, ex, ey, ea, eb, ephi, () => {
      const gx = Math.cos(su) * 0.5;
      const gy = Math.sin(su) * 0.5;
      const grd = ctx.createRadialGradient(gx, gy, 0.04, 0, 0, 1.25);
      grd.addColorStop(0, shade(body.color, 1.28));
      grd.addColorStop(0.45, shade(body.color, 1.0));
      grd.addColorStop(1, shade(body.color, 0.5));
      ctx.fillStyle = grd;
      ctx.fillRect(-1, -1, 2, 2);
    });

    // Поверхность: пятна спроецированы честно, в экранных координатах.
    for (const sp of spots) {
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, sp.rx, sp.ry, sp.ang, 0, TAU);
      ctx.fillStyle = shade(sp.color, sp.shade);
      ctx.fill();
    }

    inDisc(ctx, ex, ey, ea, eb, ephi, () => {
      // Ночная сторона: половина круга со стороны, противоположной солнцу,
      // плюс эллипс терминатора. При полной фазе обходы гасят друг друга
      // (правило nonzero), и тёмная область исчезает.
      if (cosPhase < 0.995) {
        ctx.beginPath();
        ctx.arc(0, 0, 1, su + Math.PI / 2, su + Math.PI * 1.5, false);
        ctx.ellipse(0, 0, Math.abs(cosPhase), 1, su,
          Math.PI * 1.5, Math.PI * 0.5, cosPhase > 0);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,6,0.9)';
        ctx.fill();
      }

      // Атмосферная дымка по кромке.
      if (body.atmo) {
        const ag = ctx.createRadialGradient(0, 0, 0.7, 0, 0, 1);
        ag.addColorStop(0, rgba(body.atmo, 0));
        ag.addColorStop(1, rgba(body.atmo, 0.42));
        ctx.fillStyle = ag;
        ctx.fillRect(-1, -1, 2, 2);
      }
    });

    ctx.restore();

    // Внешний ореол атмосферы — кольцо вокруг силуэта.
    // Внутренний радиус градиента задавать нельзя: всё, что внутри r0,
    // canvas заливает первым стопом, и ореол закрашивал бы саму планету
    // (в том числе ночную сторону).
    if (body.atmo && eb > 4) {
      inDisc(ctx, ex, ey, ea, eb, ephi, () => {
        const hr = 1.13;
        const edge = 1 / hr;
        const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, hr);
        hg.addColorStop(0, rgba(body.atmo, 0));
        hg.addColorStop(edge * 0.985, rgba(body.atmo, 0));
        hg.addColorStop(edge, rgba(body.atmo, 0.34));
        hg.addColorStop(1, rgba(body.atmo, 0));
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(0, 0, hr, 0, TAU);
        ctx.fill();
      });
    }

    if (ringFront) strokeRing(ctx, ringFront, body, 0.85);
  });
}

// Рисование в пространстве единичного круга, который трансформация
// превращает в силуэт-эллипс планеты.
function inDisc(ctx, x, y, a, b, angle, draw) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(a, b);
  draw();
  ctx.restore();
}

// Экранный угол -> угол в пространстве единичного круга.
// Неравномерный масштаб (a, b) меняет углы, поэтому направление на солнце
// нельзя просто передать внутрь: его надо пересчитать.
function unitSpaceAngle(screenAngle, ephi, a, b) {
  const dx = Math.cos(screenAngle), dy = Math.sin(screenAngle);
  const c = Math.cos(-ephi), s = Math.sin(-ephi);
  const rx = dx * c - dy * s;
  const ry = dx * s + dy * c;
  return Math.atan2(ry / b, rx / a);
}

function strokeRing(ctx, pts, body, alpha) {
  const w = Math.max(0.6, body._ringWidth || 1);
  ctx.save();
  ctx.lineWidth = w;
  ctx.strokeStyle = rgba(body.rings.color, alpha * 0.75);
  let drawing = false;
  ctx.beginPath();
  for (const sp of pts) {
    if (!sp) { drawing = false; continue; }
    if (!drawing) { ctx.moveTo(sp.x, sp.y); drawing = true; }
    else ctx.lineTo(sp.x, sp.y);
  }
  ctx.stroke();
  // Тонкая тёмная щель внутри колец
  ctx.lineWidth = Math.max(0.4, w * 0.22);
  ctx.strokeStyle = rgba([0, 0, 0], alpha * 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawStarDisc(ctx, x, y, a, b, angle, body) {
  inDisc(ctx, x, y, a, b, angle, () => {
    const glow = 9;
    const g = ctx.createRadialGradient(0, 0, 0.6, 0, 0, glow);
    g.addColorStop(0, rgba(body.color, 0.55));
    g.addColorStop(0.12, rgba(body.color, 0.22));
    g.addColorStop(0.45, rgba(body.color, 0.06));
    g.addColorStop(1, rgba(body.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, glow, 0, TAU);
    ctx.fill();

    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.55, shade(body.color, 1.5));
    core.addColorStop(1, shade(body.color, 1.05));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
  });
}

const depthOf = (dist, R) => dist - R;

/**
 * Планета вплотную: силуэт пересекает плоскость экрана, эллипса не
 * существует. Берём настоящую линию силуэта — это 3D-окружность радиусом
 * R·cosα на расстоянии R²/d от центра в сторону камеры, — режем её по
 * ближней плоскости тем же алгоритмом, что и полигоны моделей, и заливаем
 * получившуюся область. Никаких особых случаев «всё или ничего».
 */
function drawNearSilhouette(renderer, body, c, sil, sunPos, depth) {
  const cam = renderer.camera;
  const R = body.radius;
  const d = sil.dist;
  const ux = c.x / d, uy = c.y / d, uz = c.z / d;
  const off = R * R / d;                       // сдвиг плоскости касания
  const rr = R * sil.cosA;                     // радиус линии силуэта
  const gx = c.x - ux * off, gy = c.y - uy * off, gz = c.z - uz * off;

  // Орты плоскости силуэта.
  const t = Math.abs(uy) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let e1 = normalize(v3(
    uy * t.z - uz * t.y,
    uz * t.x - ux * t.z,
    ux * t.y - uy * t.x));
  const e2 = normalize(v3(
    uy * e1.z - uz * e1.y,
    uz * e1.x - ux * e1.z,
    ux * e1.y - uy * e1.x));

  const N = 72;
  const ring = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const ca = Math.cos(a) * rr, sa = Math.sin(a) * rr;
    ring[i] = {
      x: gx + e1.x * ca + e2.x * sa,
      y: gy + e1.y * ca + e2.y * sa,
      z: gz + e1.z * ca + e2.z * sa,
    };
  }

  const clipped = clipNear(ring, cam.near);
  if (!clipped || clipped.length < 3) return;

  const pts = clipped.map((q) => {
    const sp = cam.project(q, { x: 0, y: 0 });
    return { x: sp.x, y: sp.y };
  });

  // Освещённость: линейный переход по экранной оси терминатора.
  // Вектор тело -> камера нужен в МИРОВЫХ координатах (c — в координатах
  // камеры, его сюда передавать нельзя).
  const sun = sunGeometry(body, sunPos, cam,
    cam.pos.x - body.pos.x, cam.pos.y - body.pos.y, cam.pos.z - body.pos.z);
  const sx = Math.cos(sun.sunAng), sy = Math.sin(sun.sunAng);

  renderer.push(depth, (ctx) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of pts) {
      if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
    }
    // Градиент строим по видимой части экрана, а не по всему полигону:
    // его вершины на плоскости отсечения уезжают далеко за кадр.
    const vx0 = Math.max(minX, -50), vx1 = Math.min(maxX, cam.w + 50);
    const vy0 = Math.max(minY, -50), vy1 = Math.min(maxY, cam.h + 50);
    const mx = (vx0 + vx1) / 2, my = (vy0 + vy1) / 2;
    const span = Math.max(80, Math.hypot(vx1 - vx0, vy1 - vy0) * 0.5);
    const g = ctx.createLinearGradient(
      mx + sx * span, my + sy * span,
      mx - sx * span, my - sy * span);
    g.addColorStop(0, shade(body.color, 1.15));
    g.addColorStop(0.45, shade(body.color, 0.75));
    g.addColorStop(1, shade(body.color, 0.2));

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
  });
}
