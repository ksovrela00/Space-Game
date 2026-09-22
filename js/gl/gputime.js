// Сколько миллисекунд кадра съедает видеокарта.
//
// Зачем это отдельно от fps. При вертикальной синхронизации частота
// кадров стоит на шестидесяти, пока запас есть, и падает сразу вдвое,
// когда он кончился: по ней не видно ни того, сколько запаса осталось,
// ни того, кто занят — процессор или карта. Регулятору детализации
// (js/gl/detail.js) нужен честный расход, иначе он будет либо срезать
// деталь там, где всё и так успевает, либо не срезать там, где не
// успевает ничего.
//
// Замер асинхронный: ответ готов через кадр-два. Поэтому запросы лежат
// в очереди и читаются только готовыми — чтение готового запроса
// конвейер не останавливает, а ожидание неготового остановило бы ровно
// то, что мы измеряем.

const SMOOTH = 0.15;        // замер шумит на проценты — сглаживаем
const MAX_QUEUE = 4;        // больше двух-трёх кадров задержки не бывает

export class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = null;
    try {
      this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    } catch (e) {
      this.ext = null;
    }
    // Расширения может не быть (мок в проверках, часть драйверов) — это
    // рабочий путь, а не ошибка: регулятор тогда работает по
    // длительности кадра, см. FW_TARGET_CPU.
    this.available = !!(this.ext && gl.createQuery);
    this.ms = 0;            // сглаженное время кадра на карте
    this.last = 0;          // последний замер, как есть
    this.free = [];
    this.queue = [];
    this.active = null;
  }

  begin() {
    // Очередь полна — этот кадр просто не мерим. Переиспользовать
    // объект запроса, чей результат ещё не прочитан, нельзя.
    if (!this.available || this.active || this.queue.length >= MAX_QUEUE) return;
    const gl = this.gl;
    const q = this.free.pop() || gl.createQuery();
    if (!q) { this.available = false; return; }
    this.active = q;
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.queue.push(this.active);
    this.active = null;
  }

  /**
   * Забрать готовые замеры. Вызывать раз в кадр, до begin.
   *
   * GPU_DISJOINT_EXT означает, что карту в это время отобрали (смена
   * режима, другое окно, засыпание). Такой замер выбрасывается целиком:
   * один выброс в сотни миллисекунд увёл бы регулятор в самую грубую
   * деталь, и вернулся бы он оттуда только через несколько секунд.
   */
  poll() {
    if (!this.available || !this.queue.length) return this.ms;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.queue.length) {
      const q = this.queue[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.queue.shift();
      if (!disjoint) {
        this.last = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        this.ms = this.ms > 0 ? this.ms + (this.last - this.ms) * SMOOTH : this.last;
      }
      this.free.push(q);
    }
    return this.ms;
  }
}
