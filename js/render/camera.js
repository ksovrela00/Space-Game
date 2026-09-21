// Камера: мировые координаты -> координаты камеры -> экран.
// В координатах камеры x — вправо, y — вверх, z — вперёд (вглубь экрана).

import { v3 } from '../core/vec3.js';
import { makeBasis, toLocal } from '../core/basis.js';

export class Camera {
  constructor() {
    this.pos = v3();
    this.basis = makeBasis();
    this.fov = 68 * Math.PI / 180;
    this.near = 0.004;   // 4 метра
    this.w = 1; this.h = 1; this.cx = 0.5; this.cy = 0.5;
    this.focal = 1;
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.cx = w / 2; this.cy = h / 2;
    // Вертикальный FOV: половина высоты экрана = focal * tan(fov/2)
    this.focal = (h / 2) / Math.tan(this.fov / 2);
  }

  /**
   * Сменить поле зрения на ходу. Пересчитать focal обязательно: по нему
   * считает не только 3D-сцена, но и всё, что рисует HUD, — рамки цели,
   * указатель вектора, отметка грунта. Забыть его значит получить
   * приборы, съехавшие относительно картинки.
   */
  setFov(fov) {
    this.fov = fov;
    this.focal = (this.h / 2) / Math.tan(fov / 2);
  }

  // Мир -> координаты камеры.
  toCamera(p, out = v3()) { return toLocal(this.basis, this.pos, p, out); }

  // Координаты камеры -> экран. Вызывать только при c.z > near.
  project(c, out = { x: 0, y: 0 }) {
    const k = this.focal / c.z;
    out.x = this.cx + c.x * k;
    out.y = this.cy - c.y * k;
    return out;
  }

  // Сколько пикселей занимает 1 км на глубине z.
  pixelsPerUnit(z) { return this.focal / z; }

  // Угловой радиус шара в пикселях, если смотреть на него прямо.
  // Годится для прицельных рамок и подсказок; для самой планеты нужен
  // silhouette() — вне центра экрана круг перестаёт быть кругом.
  screenRadius(dist, radius) {
    if (dist <= radius) return Math.max(this.w, this.h) * 4;
    return this.focal * radius / Math.sqrt(dist * dist - radius * radius);
  }

  /**
   * Точный силуэт шара в перспективной проекции.
   *
   * В перспективе шар проецируется НЕ в круг постоянного радиуса: чем
   * дальше он от оси взгляда, тем сильнее силуэт растягивается по радиусу
   * и тем сильнее его центр уезжает от точки проекции центра шара. Если
   * рисовать круг, планета «дышит» при развороте корабля, а детали
   * поверхности (они проецируются честно) перестают совпадать с диском.
   *
   * Силуэт — это конус (X·u)² = |X|²cos²α, пересечённый с плоскостью
   * экрана. Для θ + α < 90° это эллипс:
   *   a = f·cosα·sinα / (cos²α − sin²θ)     (большая полуось, по радиусу)
   *   b = f·sinα / sqrt(cos²α − sin²θ)      (малая полуось, по касательной)
   *   смещение центра по радиусу = f·sinθ·cosθ / (cos²α − sin²θ)
   * где sinα = R/d, θ — угол между осью взгляда и направлением на центр.
   * На оси (θ = 0) обе полуоси равны f·tanα — обычный круг.
   *
   * @param c      центр шара в координатах камеры
   * @param radius радиус шара
   * @returns {ok, x, y, a, b, angle} или {ok: false, covers} при
   *          вырождении (шар настолько близко/сбоку, что силуэт уходит
   *          за плоскость экрана); covers — нужно ли заливать весь экран.
   */
  silhouette(c, radius, out = {}) {
    const d = Math.hypot(c.x, c.y, c.z);
    out.dist = d;
    if (d <= radius) {
      out.ok = false; out.covers = true;
      return out;
    }
    const m = radius / d;                       // sin α
    const k = Math.sqrt(1 - m * m);             // cos α
    const rho = Math.hypot(c.x, c.y);
    const s = rho / d;                          // sin θ
    const cosT = c.z / d;                       // cos θ (может быть < 0)
    const denom = k * k - s * s;
    out.sinA = m; out.cosA = k;
    out.sinT = s; out.cosT = cosT;
    // cos(θ − α): знак говорит, есть ли перед камерой хоть часть шара.
    out.cosNear = cosT * k + s * m;
    // Знак cosθ проверять обязательно: sinθ одинаков для θ и 180° − θ,
    // поэтому без него шар за спиной даёт такой же эллипс, как перед
    // носом, и планета продолжает «висеть» на экране после отлёта.
    if (denom <= 1e-9 || cosT <= 0) {
      // Либо шар за спиной (не видно), либо силуэт пересекает плоскость
      // экрана — так бывает только вплотную к поверхности. Заливаем экран
      // тогда, когда ось взгляда попадает внутрь конуса силуэта (θ < α).
      out.ok = false;
      out.covers = cosT > k;
      return out;
    }
    const f = this.focal;
    const shift = f * s * cosT / denom;
    const ux = rho > 1e-9 ? c.x / rho : 1;
    const uy = rho > 1e-9 ? -c.y / rho : 0;     // экранный y вниз
    out.ok = true;
    out.covers = false;
    out.a = f * k * m / denom;
    out.b = f * m / Math.sqrt(denom);
    out.x = this.cx + ux * shift;
    out.y = this.cy + uy * shift;
    out.angle = Math.atan2(uy, ux);
    return out;
  }
}
