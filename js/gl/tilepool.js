import { Q } from '../core/quality.js';
// Пул рабочих потоков для сборки плиток.
//
// Зачем. Плитка стоит 5-13 мс чистого счёта, а в кадре на всю сборку
// отводилось 6 мс — то есть одна плитка занимала кадр целиком, а то и
// два. Выход на детализацию у поверхности требует трёхсот с лишним
// плиток, и это три с половиной секунды счёта; при шести миллисекундах
// на кадр они растягиваются секунд на десять, а на машине послабее —
// на минуты. Ровно это и видно: сел у земли, а рельеф ещё долго
// «доезжает».
//
// Считать быстрее нельзя, а вот считать НЕ В КАДРЕ — можно. Геометрия
// плитки (js/gl/tilegeo.js) не трогает ни GL, ни DOM, результат её —
// типизированные массивы, которые переносятся между потоками без
// копирования. Значит, её место в отдельных потоках, а в кадре остаётся
// только загрузка в буферы и запекание.
//
// Потоков берём на один меньше, чем ядер (но не больше трёх): кадру
// нужно на чём-то идти, а больше трёх упираются уже в загрузку буферов
// на главном потоке.
//
// Если Worker недоступен (старый браузер, node в проверках) — пул
// молча выключается, и TileSet считает по-старому, порциями в кадре.

const WORKER_URL = new URL('./tileworker.js', import.meta.url);
// Потоков сборки — из профиля устройства: на телефоне их меньше, и не
// ради процессора, а ради памяти — каждый держит свою копию генератора
// рельефа (js/core/quality.js).
const MAX_WORKERS = Q.workers;

export class TilePool {
  constructor(max = MAX_WORKERS) {
    this.workers = [];
    this.idle = [];
    this.inFlight = new Map();     // поток -> задание
    this.done = [];                // готовое, ждёт загрузки в GL
    this.failed = [];              // задания, которые поток не осилил
    this.ok = false;
    this.dead = false;             // закрыт ли пул, пока ждал файлов
    if (typeof Worker === 'undefined') return;

    let n = 2;
    try {
      const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
      n = Math.max(1, Math.min(max, cores - 1));
    } catch (e) { /* нет navigator — берём двоих */ }

    // Потоки поднимаются не раньше, чем обновятся их файлы. Страница
    // освежает код тем, что подставляет модулям новые адреса (index.html),
    // но в рабочих потоках эта таблица не действует вовсе — поток читает
    // свои файлы по обычным адресам и взял бы их из кеша. Поэтому
    // index.html перезапрашивает их мимо кеша и кладёт обещание в
    // __srcFresh, а мы его дожидаемся. Пока потоков нет, TileSet считает
    // плитки прямо в кадре — это его обычный запасной путь.
    const fresh = typeof window !== 'undefined' ? window.__srcFresh : null;
    if (fresh && typeof fresh.then === 'function') fresh.then(() => this.spawn(n));
    else this.spawn(n);
  }

  /** Поднять n потоков. Отдельно от конструктора — ждёт свежих файлов. */
  spawn(n) {
    if (this.dead) return;          // пул успели закрыть, пока мы ждали
    for (let i = 0; i < n; i++) {
      try {
        const w = new Worker(WORKER_URL, { type: 'module' });
        w.onmessage = (e) => {
          this.inFlight.delete(w);
          this.idle.push(w);
          this.done.push(e.data);
        };
        // Умерший поток не должен вешать плитку навсегда: задание
        // возвращается наверх, и TileSet снимет заглушку, чтобы плитку
        // можно было заказать снова.
        w.onerror = () => {
          const job = this.inFlight.get(w);
          this.inFlight.delete(w);
          if (job) this.failed.push(job);
          this.idle.push(w);
        };
        this.workers.push(w);
        this.idle.push(w);
      } catch (e) { break; }
    }
    this.ok = this.workers.length > 0;
  }

  get free() { return this.idle.length; }
  get busy() { return this.inFlight.size; }

  post(job) {
    const w = this.idle.pop();
    if (!w) return false;
    this.inFlight.set(w, job);
    w.postMessage(job);
    return true;
  }

  /** Забрать готовое и очистить очередь. */
  take() {
    const d = this.done;
    this.done = [];
    return d;
  }

  takeFailed() {
    const f = this.failed;
    this.failed = [];
    return f;
  }

  dispose() {
    this.dead = true;
    for (const w of this.workers) { try { w.terminate(); } catch (e) { /* уже мёртв */ } }
    this.workers.length = 0;
    this.idle.length = 0;
    this.inFlight.clear();
    this.done.length = 0;
    this.ok = false;
  }
}
