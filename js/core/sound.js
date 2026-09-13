// Звук корабля: сэмплы CC0 поверх живого синтеза.
//
// Два слоя, и оба нужны.
//
// СЭМПЛЫ (assets/sound, всё CC0 — см. assets/sound/CREDITS.md) дают
// материал: рокот машины, шипение сопел, вой ускорителя и, главное,
// настоящий металл. Скрежет обшивки синтезом получается похожим, но
// узнаваемо электронным — у настоящего листа железа спектр грязный
// так, как полосовыми фильтрами не подделать.
//
// СИНТЕЗ остаётся по двум причинам. Первая: игра обязана звучать без
// единого файла — склонировали репозиторий без assets, открыли, и всё
// работает. Вторая: сэмпл сам по себе мёртв. Живым его делает то же,
// что и синтез — скорость воспроизведения от тяги, фильтр от оборотов,
// разброс высоты у каждого скрипа. Поэтому сэмплы здесь не
// «проигрываются», а управляются ровно теми же параметрами.
//
// Устройство. Четыре постоянных голоса:
//
//   engine   главные движки: рокот + машинный слой, оба тянутся по тону
//   exhaust  шум сопел
//   drive    круизный ускоритель
//   thrust   подъёмные движки (R/F)
//
// и разовые поверх: clunk (удар), creak (скрежет), servo (привод
// шасси), spool (ступень ускорителя).
//
// Весь модуль обязан молча выживать без WebAudio: в node его нет вовсе,
// а в браузере контекст нельзя создать до жеста пользователя. Поэтому
// до start() всё — пустышки, а если файлы не отдались, включается
// синтез, и игра этого даже не замечает.

const DIR = new URL('../../assets/sound/', import.meta.url);

// Роль -> файл. Списком заданы те, что выбираются по кругу: один и тот
// же скрип подряд сразу слышен как сэмпл.
const BANK = {
  engineLow: 'engine_low.ogg',
  engineMid: 'engine_mid.ogg',
  exhaust: 'exhaust.ogg',
  drive: 'drive.ogg',
  thruster: 'thruster.ogg',
  station: 'station.ogg',
  creak: ['creak_01.ogg', 'creak_02.ogg', 'creak_03.ogg', 'creak_04.ogg'],
  hit: ['hit_01.ogg', 'hit_02.ogg'],
  slam: 'slam.ogg',
  clamp: 'clamp.ogg',
  servo: 'servo.ogg',
  latch: 'latch.ogg',
  spool: 'spool.ogg',
};

// Неравнократные отношения частот для СИНТЕЗИРОВАННОГО скрежета: так
// звенит пластина, а не струна. У струны обертоны кратны основному
// тону, и ухо слышит НОТУ; у куска обшивки моды идут вразнобой, и та же
// огибающая читается уже как металл.
const MODES = [1, 1.72, 2.44, 3.17, 4.11];

const clampRate = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const NOISE_SEC = 2;
const MAX_VOICES = 12;      // разовых звуков одновременно

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ok = false;
    this.sampled = false;    // сэмплы загружены и звучат вместо синтеза
    this.error = null;
    this.vol = 0.7;
    this.muted = false;
    this.live = 0;           // сколько разовых голосов сейчас звучит
    this.v = null;           // постоянные голоса
    this.noise = null;
    this.buf = {};           // роль -> AudioBuffer (или массив)
    this.raw = null;         // скачанное до жеста пользователя
    this.adopting = null;    // идущий переход на сэмплы
    this.pick = 0;
  }

  /**
   * Скачать файлы, не трогая звуковой контекст. Можно звать сразу при
   * загрузке страницы: сеть не требует жеста, и к моменту клика по
   * «ВЗЛЁТ» всё обычно уже лежит в памяти.
   */
  async prefetch() {
    if (this.raw) return this.raw;
    const files = new Set();
    for (const v of Object.values(BANK)) {
      if (Array.isArray(v)) v.forEach((f) => files.add(f));
      else files.add(v);
    }
    const out = {};
    await Promise.all([...files].map(async (f) => {
      try {
        const r = await fetch(new URL(f, DIR));
        if (r.ok) out[f] = await r.arrayBuffer();
      } catch (e) { /* нет файла — останется синтез */ }
    }));
    this.raw = out;
    return out;
  }

  /**
   * Поднять звуковой контекст. Вызывать ТОЛЬКО из обработчика жеста
   * пользователя (клик по «ВЗЛЁТ», нажатие клавиши): браузер иначе
   * создаст контекст в состоянии suspended и промолчит весь полёт.
   */
  start() {
    if (this.ok) { this.resume(); return true; }
    const AC = typeof globalThis !== 'undefined' &&
      (globalThis.AudioContext || globalThis.webkitAudioContext);
    if (!AC) { this.error = 'WebAudio недоступен'; return false; }
    try {
      const ctx = new AC();
      this.ctx = ctx;

      // Ограничитель на выходе: скрежетов может совпасть несколько
      // (удар — это сразу и clunk, и creak), и без него сумма уходит за
      // единицу и хрипит уже сама звуковая карта.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 8;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.vol;
      master.connect(comp);
      comp.connect(ctx.destination);
      this.master = master;

      // Буфер белого шума: на нём держатся синтезированные сопла,
      // подъёмные движки и скрежет, пока (или если) нет сэмплов.
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SEC), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;

      this.v = {
        engine: this._engineVoice(),
        exhaust: this._noiseVoice(420, 0.9),
        drive: this._driveVoice(),
        thrust: this._noiseVoice(900, 1.6),
      };
      this.ok = true;
      this.resume();
      this.adopt();          // если файлы уже скачаны — перейти на них
      return true;
    } catch (e) {
      this.error = String(e && e.message || e);
      this.ctx = null;
      return false;
    }
  }

  /**
   * Декодировать скачанное и перейти с синтеза на сэмплы.
   *
   * Переход идёт долго (сеть плюс декодирование), а звать adopt() могут
   * несколько раз подряд — его дёргает каждое нажатие клавиши, пока
   * контекст не поднят. Без защёлки второй вызов успевал бы войти,
   * пока первый ещё ждёт декодера, и построил бы ВТОРОЙ комплект
   * петель: тот же гул поверх самого себя, вдвое громче и не в фазе.
   */
  adopt() {
    if (!this.ok || this.sampled) return Promise.resolve(false);
    if (!this.adopting) this.adopting = this._adopt().finally(() => { this.adopting = null; });
    return this.adopting;
  }

  async _adopt() {
    if (!this.ok || this.sampled) return false;
    if (!this.raw) await this.prefetch();
    const decode = (ab) => new Promise((res) => {
      try {
        // Старая сигнатура с колбэками: её понимают все браузеры,
        // включая те, где decodeAudioData ещё не возвращает промис.
        this.ctx.decodeAudioData(ab.slice(0), res, () => res(null));
      } catch (e) { res(null); }
    });

    for (const [role, val] of Object.entries(BANK)) {
      if (Array.isArray(val)) {
        const list = [];
        for (const f of val) {
          const ab = this.raw[f];
          if (ab) { const b = await decode(ab); if (b) list.push(b); }
        }
        if (list.length) this.buf[role] = list;
      } else {
        const ab = this.raw[val];
        if (ab) { const b = await decode(ab); if (b) this.buf[role] = b; }
      }
    }

    // Петли — это и есть главная разница на слух. Нет их — остаёмся на
    // синтезе целиком, чтобы не смешивать два разных «двигателя».
    if (!this.buf.engineLow || !this.buf.exhaust) return false;

    this.v.sample = {
      low: this._loopVoice(this.buf.engineLow),
      mid: this.buf.engineMid ? this._loopVoice(this.buf.engineMid) : null,
      exhaust: this._loopVoice(this.buf.exhaust, 'lowpass', 6000),
      drive: this.buf.drive ? this._loopVoice(this.buf.drive) : null,
      thrust: this.buf.thruster ? this._loopVoice(this.buf.thruster, 'bandpass', 900) : null,
      station: this.buf.station ? this._loopVoice(this.buf.station) : null,
    };
    // Синтезированные голоса глушим насовсем — они своё отработали.
    const t = this.ctx.currentTime;
    for (const k of ['engine', 'exhaust', 'drive', 'thrust']) {
      this.v[k].gain.gain.setTargetAtTime(0, t, 0.12);
    }
    this.sampled = true;
    return true;
  }

  resume() { try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) { /* не критично */ } }
  suspend() { try { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); } catch (e) { /* не критично */ } }

  setVolume(v) {
    this.vol = Math.max(0, Math.min(1, v));
    this._master();
    return this.vol;
  }

  setMuted(on) {
    this.muted = !!on;
    this._master();
    return this.muted;
  }

  _master() {
    if (!this.ok) return;
    const g = this.muted ? 0 : this.vol;
    // Не ступенькой: мгновенный скачок громкости сам по себе щелчок.
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
  }

  // --- постоянные голоса ------------------------------------------------------

  /** Зацикленный сэмпл с фильтром: основа всех непрерывных звуков. */
  _loopVoice(buffer, filter = null, freq = 1000) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    let node = src;
    let flt = null;
    if (filter) {
      flt = ctx.createBiquadFilter();
      flt.type = filter;
      flt.frequency.value = freq;
      flt.Q.value = filter === 'bandpass' ? 1.2 : 0.8;
      src.connect(flt);
      node = flt;
    }
    node.connect(gain);
    gain.connect(this.master);
    src.start(0, Math.random() * buffer.duration);
    return { src, gain, flt };
  }

  _engineVoice() {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    lp.Q.value = 0.9;
    lp.connect(gain);
    gain.connect(this.master);
    // Три пилы вразнобой: одна звучит как сигнал генератора, три с
    // расстройкой уже гудят — биения между ними и дают «машину».
    const osc = [];
    for (const [mul, det, lvl] of [[1, 0, 1], [2.02, 7, 0.5], [3.01, -11, 0.28]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 40 * mul;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = lvl;
      o.connect(g); g.connect(lp);
      o.start();
      osc.push({ o, mul });
    }
    return { gain, lp, osc };
  }

  _noiseVoice(freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(bp); bp.connect(gain); gain.connect(this.master);
    src.start();
    return { gain, bp, src };
  }

  _driveVoice() {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const osc = [];
    for (const [mul, lvl] of [[1, 1], [1.5, 0.45], [2, 0.22]]) {
      const o = ctx.createOscillator();
      o.type = mul === 1 ? 'triangle' : 'sine';
      o.frequency.value = 110 * mul;
      const g = ctx.createGain();
      g.gain.value = lvl;
      o.connect(g); g.connect(gain);
      o.start();
      osc.push({ o, mul });
    }
    // Тремоло: ускоритель не поёт ровно, он пульсирует, и чем выше
    // уровень, тем чаще. Без этого вой похож на сирену, а не на машину.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 6;
    const depth = ctx.createGain();
    depth.gain.value = 0;
    lfo.connect(depth); depth.connect(gain.gain);
    lfo.start();
    return { gain, osc, lfo, depth };
  }

  // --- управление голосами (вызывается каждый кадр) --------------------------

  /**
   * Главные движки.
   * @param level 0..1 — громкость
   * @param pitch 0..1 — «обороты»: тон и открытие фильтра
   * @param roar  0..1 — шум сопел поверх гула
   */
  engine(level, pitch, roar) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    if (this.sampled) {
      const s = this.v.sample;
      // Скорость воспроизведения — это и есть «обороты»: рокот тянется
      // вверх вместе с тягой ровно так же, как тянулся бы генератор.
      s.low.src.playbackRate.setTargetAtTime(0.72 + 0.62 * pitch, t, 0.1);
      s.low.gain.gain.setTargetAtTime(0.5 * level, t, 0.08);
      if (s.mid) {
        s.mid.src.playbackRate.setTargetAtTime(0.8 + 0.75 * pitch, t, 0.1);
        // Машинный слой приходит с оборотами: на холостых его почти нет.
        s.mid.gain.gain.setTargetAtTime(0.36 * level * (0.25 + 0.75 * pitch), t, 0.08);
      }
      s.exhaust.src.playbackRate.setTargetAtTime(0.85 + 0.5 * pitch, t, 0.1);
      s.exhaust.flt.frequency.setTargetAtTime(900 + 5200 * pitch, t, 0.1);
      s.exhaust.gain.gain.setTargetAtTime(0.34 * roar, t, 0.08);
      return;
    }
    const v = this.v.engine;
    const f = 38 + 96 * pitch;
    for (const { o, mul } of v.osc) o.frequency.setTargetAtTime(f * mul, t, 0.08);
    v.lp.frequency.setTargetAtTime(190 + 1500 * pitch, t, 0.08);
    v.gain.gain.setTargetAtTime(0.16 * level, t, 0.07);
    const ex = this.v.exhaust;
    ex.bp.frequency.setTargetAtTime(380 + 1100 * pitch, t, 0.08);
    ex.gain.gain.setTargetAtTime(0.09 * roar, t, 0.07);
  }

  /**
   * Гул станции в порту. Отдельным голосом, а не «двигателем на малом
   * ходу»: в порту движки заглушены, и слышно именно станцию — по этой
   * смене фона и понятно, что корабль уже не свой хозяин.
   */
  ambient(level) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    if (this.sampled && this.v.sample.station) {
      this.v.sample.station.gain.gain.setTargetAtTime(0.4 * level, t, 0.25);
    }
  }

  /** Круизный ускоритель: level и pitch — 0..1 по номеру ступени. */
  drive(level, pitch) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    if (this.sampled && this.v.sample.drive) {
      const d = this.v.sample.drive;
      // Ступени идут через десять крат, поэтому и тон берём по степени:
      // линейная шкала на верхних ступенях уже не различается на слух.
      d.src.playbackRate.setTargetAtTime(0.62 * Math.pow(2, 1.35 * pitch), t, 0.15);
      d.gain.gain.setTargetAtTime(0.3 * level, t, 0.12);
      return;
    }
    const v = this.v.drive;
    const f = 105 * Math.pow(2, 2.7 * pitch);
    for (const { o, mul } of v.osc) o.frequency.setTargetAtTime(f * mul, t, 0.12);
    v.lfo.frequency.setTargetAtTime(5 + 26 * pitch, t, 0.12);
    v.depth.gain.setTargetAtTime(0.35 * level * 0.07, t, 0.12);
    v.gain.gain.setTargetAtTime(0.07 * level, t, 0.1);
  }

  /** Подъёмные движки: pitch 0..1, вверх звонче, чем вниз. */
  thrust(level, pitch) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    if (this.sampled && this.v.sample.thrust) {
      const s = this.v.sample.thrust;
      s.src.playbackRate.setTargetAtTime(0.8 + 0.5 * pitch, t, 0.06);
      s.flt.frequency.setTargetAtTime(700 + 900 * pitch, t, 0.06);
      s.gain.gain.setTargetAtTime(0.42 * level, t, 0.05);
      return;
    }
    const v = this.v.thrust;
    v.bp.frequency.setTargetAtTime(620 + 700 * pitch, t, 0.05);
    v.gain.gain.setTargetAtTime(0.1 * level, t, 0.05);
  }

  // --- разовые звуки ----------------------------------------------------------

  _slot() {
    if (!this.ok || this.live >= MAX_VOICES) return null;
    this.live++;
    return this.ctx.currentTime;
  }

  _release(node, at) {
    // Голос освобождается ровно один раз, но двумя путями. Обычный —
    // onended. Страховочный — таймер: если браузер события не дал (а
    // такое бывает на вкладке в фоне), счётчик без него залипнет на
    // пределе, и звук замолчит НАВСЕГДА — худший из возможных отказов,
    // потому что чинится только перезагрузкой страницы.
    let done = false;
    const end = () => { if (done) return; done = true; this.live = Math.max(0, this.live - 1); };
    node.onended = end;
    try { node.stop(at); } catch (e) { end(); }
    if (typeof setTimeout === 'function') {
      setTimeout(end, Math.max(0, (at - this.ctx.currentTime) * 1000) + 300);
    }
  }

  /**
   * Проиграть сэмпл разово.
   * @param rate  скорость: она же высота — ею сэмпл и «оживляется»
   * @param delay через сколько секунд начать
   */
  _shot(buffer, gain, rate = 1, delay = 0, filter = null) {
    const t0 = this._slot();
    if (t0 === null || !buffer) return false;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = Math.max(0.06, rate);
    const g = ctx.createGain();
    g.gain.value = Math.max(0.0001, gain);
    let node = src;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.frequency.value = filter.freq;
      f.Q.value = filter.q || 1;
      src.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.master);
    const at = t0 + delay;
    src.start(at);
    this._release(src, at + buffer.duration / Math.max(0.06, rate) + 0.05);
    return true;
  }

  /** Следующий сэмпл из списка: подряд один и тот же сразу выдаёт себя. */
  _round(role) {
    const list = this.buf[role];
    if (!list || !list.length) return null;
    this.pick = (this.pick + 1) % list.length;
    return list[this.pick];
  }

  /**
   * Скрип нужной длины. Длинному стону — длинная запись, короткому
   * скрипу — короткая. Растягивать скоростью нельзя: ниже 0.8 сразу
   * слышно замедленную запись, а не большой кусок железа.
   */
  _pickCreak(dur) {
    const list = this.buf.creak;
    if (!list || !list.length) return null;
    const wantLong = dur > 0.9;
    const fit = list.filter((b) => (b.duration > 1.4) === wantLong);
    const pool = fit.length ? fit : list;
    this.pick = (this.pick + 1) % pool.length;
    return pool[this.pick % pool.length];
  }

  /**
   * Кусок записи скрипа нужной длины, высоты и «размера».
   *
   * Размер железа задаёт ФИЛЬТР, а не скорость. Это главный вывод из
   * первой версии: там частота события шла прямо в playbackRate, для
   * тяжёлого удара выходило 0.53, и вместо большого листа обшивки ухо
   * слышало ровно то, чем это было, — вдвое замедленную запись двери.
   * Скорость теперь гуляет в пределах ±20%, где она читается как
   * натяжение, а не как замедление; всё остальное делает срез.
   */
  _creakShot(b, gain, freq, dur, delay = 0) {
    const t0 = this._slot();
    if (t0 === null) return;
    const ctx = this.ctx;
    // Разброс — ДО ограничения: если умножать после, он же и выносит
    // за окно, ради которого окно и заводили.
    const rate = clampRate(
      (0.84 + (freq - 130) / 770 * 0.34) * (0.97 + Math.random() * 0.06), 0.84, 1.2);
    const playable = b.duration / rate;
    const len = Math.max(0.12, Math.min(dur, playable));
    // Со случайного места, если записи хватает: у скрипа нет
    // «правильного» начала, а один и тот же вход сразу выдаёт сэмпл.
    const room = Math.max(0, playable - len);
    const off = room > 0.15 ? Math.random() * room * rate : 0;

    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(700, Math.min(9000, freq * 6));
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    const at = t0 + delay;
    const rel = Math.min(0.18, len * 0.35);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, gain), at + 0.02);
    g.gain.setValueAtTime(Math.max(0.0002, gain), at + Math.max(0.03, len - rel));
    g.gain.linearRampToValueAtTime(0.0001, at + len);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(at, off);
    this._release(src, at + len + 0.02);
  }

  /**
   * СКРЕЖЕТ МЕТАЛЛА.
   *
   * На сэмплах: лист железа, взятый с нужной скоростью. Замедление —
   * это увеличение листа: та же запись на 0.4 скорости звучит не как
   * «медленнее», а как ВДВОЕ БОЛЬШИЙ кусок обшивки, и именно этим
   * задаётся масштаб удара.
   *
   * Синтезом (когда файлов нет) собирается из трёх вещей:
   *  1. Неравнократные моды (MODES) — металл, а не нота.
   *  2. Рваная огибающая: скрежет — это СЕРИЯ срывов, металл цепляется
   *     и отпускает. Ступеньки по 30 мс со случайным разбросом (rough)
   *     и превращают гул в скрип.
   *  3. Уход частоты за время звука: нагруженная деталь меняет форму,
   *     вместе с ней уходят и резонансы.
   *
   * @param gain  0..1 громкость
   * @param freq  Гц — «размер» железа: 90-160 стон, 400-900 визг
   * @param rough 0..1 — насколько рвано
   * @param dur   с
   */
  creak(gain = 0.5, freq = 180, rough = 0.7, dur = 0.7) {
    if (!this.ok) return;
    if (this.sampled && this.buf.creak) {
      const b = this._pickCreak(dur);
      if (b) {
        this._creakShot(b, gain * 0.85, freq, dur);
        // Сильный удар ведёт не один лист: второй кусок, чуть позже и
        // тише, читается как «повело весь корпус». Скорость у него та
        // же — слой, а не каша.
        if (gain > 0.7 && dur > 0.8) {
          const b2 = this._pickCreak(dur);
          if (b2) this._creakShot(b2, gain * 0.4, freq * 1.6, dur * 0.7, 0.08 + Math.random() * 0.14);
        }
        return;
      }
    }
    const t0 = this._slot();
    if (t0 === null) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const off = Math.random() * (NOISE_SEC - 0.05);

    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(this.master);

    const n = freq > 350 ? 4 : 3;   // визгу нужно больше мод, стону хватает трёх
    for (let i = 0; i < n; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 9 + 16 * Math.random();
      const f0 = freq * MODES[i];
      const f1 = f0 * (0.84 + 0.34 * Math.random());
      bp.frequency.setValueAtTime(f0, t0);
      bp.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      const g = ctx.createGain();
      g.gain.value = 1 / (1 + i * 0.9);
      src.connect(bp); bp.connect(g); g.connect(out);
    }

    const steps = Math.max(5, Math.round(dur / 0.03));
    let t = t0;
    for (let i = 0; i < steps; i++) {
      const k = i / (steps - 1);
      const shape = Math.sin(Math.PI * Math.pow(k, 0.55));
      const jit = 1 - rough * Math.random();
      out.gain.setValueAtTime(Math.max(0.0001, gain * 0.5 * shape * jit), t);
      t += dur / steps;
    }
    out.gain.linearRampToValueAtTime(0.0001, t0 + dur);

    src.start(t0, off);
    this._release(src, t0 + dur + 0.02);
  }

  /**
   * Глухой удар. На сэмплах выбор по «весу»: низкая частота — тяжёлый
   * слэм, высокая — обычный удар по обшивке. Синтезом — падающий по
   * частоте тон: постоянный читался бы как гудок, а съезжающий вниз —
   * как принятая масса.
   */
  clunk(gain = 0.6, freq = 150, dur = 0.35, delay = 0) {
    if (!this.ok) return;
    if (this.sampled) {
      const heavy = freq < 140 && this.buf.slam;
      const b = heavy ? this.buf.slam : this._round('hit');
      if (b) {
        // Удар терпит больший сдвиг, чем скрип: у него вся энергия в
        // атаке, и она артефакты прячет. Но не безграничный — ниже 0.8
        // «замедленную запись» слышно и здесь, поэтому тяжесть удара
        // тоже отдана фильтру, а не скорости.
        const base = heavy ? 115 : 200;
        const rate = clampRate(freq / base * (0.97 + Math.random() * 0.06), 0.82, 1.35);
        this._shot(b, gain, rate, delay, {
          type: 'lowpass', freq: Math.max(600, Math.min(12000, freq * 22)), q: 0.7,
        });
        return;
      }
    }
    const t0 = this._slot();
    if (t0 === null) return;
    const ctx = this.ctx;
    const at = t0 + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(18, freq * 0.28), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, gain * 0.55), at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(this.master);
    o.start(at);
    this._release(o, at + dur + 0.02);

    const s = this._slot();
    if (s === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(Math.max(0.0001, gain * 0.3), at);
    ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    src.connect(hp); hp.connect(ng); ng.connect(this.master);
    src.start(at, Math.random() * (NOISE_SEC - 0.2));
    this._release(src, at + 0.14);
  }

  /** Захваты станции: тяжёлый лязг, ни на что другое не похожий. */
  clamp(gain = 0.6) {
    if (!this.ok) return;
    if (this.sampled && this.buf.clamp) { this._shot(this.buf.clamp, gain, 0.9); return; }
    this.clunk(gain, 120, 0.5);
  }

  /** Привод шасси: сэмпл растягивается ровно на время выпуска. */
  servo(dur = 2.4, up = true) {
    if (!this.ok) return;
    if (this.sampled && this.buf.servo) {
      const nat = this.buf.servo.duration;
      this._shot(this.buf.servo, 0.5, Math.max(0.3, nat / dur) * (up ? 1 : 1.15));
      if (this.buf.latch) this._shot(this.buf.latch, 0.4, up ? 1 : 1.2, Math.max(0, dur - 0.25));
      return;
    }
    const t0 = this._slot();
    if (t0 === null) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(up ? 62 : 74, t0);
    o.frequency.linearRampToValueAtTime(up ? 78 : 58, t0 + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.08);
    g.gain.setValueAtTime(0.05, t0 + dur - 0.1);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(lp); lp.connect(g); g.connect(this.master);
    o.start(t0);
    this._release(o, t0 + dur + 0.02);
  }

  /**
   * Ступень круизного ускорителя. Сброс — тот же звук задом наперёд:
   * разгон и торможение обязаны быть зеркальны, иначе на слух не
   * понять, в какую сторону переключили.
   */
  spool(up = true, level = 0.5) {
    if (!this.ok) return;
    if (this.sampled && this.buf.spool) {
      let b = this.buf.spool;
      if (!up) {
        if (!this._rev) {
          const ctx = this.ctx;
          const r = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
          for (let c = 0; c < b.numberOfChannels; c++) {
            const s = b.getChannelData(c), d = r.getChannelData(c);
            for (let i = 0; i < s.length; i++) d[i] = s[s.length - 1 - i];
          }
          this._rev = r;
        }
        b = this._rev;
      }
      this._shot(b, 0.45, 0.75 + 0.6 * level);
      return;
    }
    const t0 = this._slot();
    if (t0 === null) return;
    const ctx = this.ctx;
    const dur = 0.4;
    const f0 = 180 + 500 * level, f1 = f0 * (up ? 2.6 : 0.38);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.09, t0 + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0);
    this._release(o, t0 + dur + 0.02);
  }
}

export const sound = new Sound();
