<?php
/**
 * Оракул рельефа: дочерний процесс Node с тем же кодом мира, что у игры.
 *
 * Хабу для посадки NPC нужно знать грунт — высоту, воду, уклон. Грунт —
 * процедурный шум в тысячу строк JS (js/gl/terrain.js), и его копия на
 * PHP разошлась бы с ним на третьем знаке: NPC стоял бы над землёй или
 * в ней. Поэтому хаб не считает грунт, а спрашивает: оракул
 * (server/ws/oracle.mjs) собирает систему тем же makeSystem, что и игра,
 * и отвечает её же findSite и groundRadius.
 *
 * Node на машине хаба есть всегда: сам хаб запускается через него
 * (npm run ws -> tools/php.mjs), и оттуда же приходит путь к нему
 * (SOLAR_NODE). Не нашёлся — не беда: NPC летают, но не садятся.
 *
 * Связь — локальный TCP, а не трубы процесса. Трубы в Windows у PHP
 * нельзя ни перевести в неблокирующий режим, ни ограничить по времени, и
 * зависший оракул повесил бы весь хаб. У сокета таймаут работает везде.
 *
 * Вопросы синхронные и редкие: один-два на прибытие NPC, несколько
 * миллисекунд каждый. Не ответил за срок — оракул считается мёртвым, и
 * больше его не ждут.
 */

final class Oracle
{
    /** Сколько ждём ответа, с. Первый вопрос о корпусах собирает модели. */
    public const WAIT = 1.0;
    public const WAIT_FIRST = 8.0;

    private $proc = null;
    private array $pipes = [];
    private $sock = null;
    private bool $dead = false;
    private int $seq = 0;
    private ?array $types = null;
    /** @var callable|null */
    private $log;

    private function __construct(?callable $log)
    {
        $this->log = $log;
    }

    /**
     * Запустить оракул и связаться с ним. Не вышло — null: хаб живёт и
     * без него, только NPC не садятся.
     */
    public static function spawn(?callable $log = null): ?self
    {
        $o = new self($log);
        $node = getenv('SOLAR_NODE') ?: 'node';
        $script = realpath(__DIR__ . '/../ws/oracle.mjs');
        if ($script === false || !function_exists('proc_open')) {
            return null;
        }
        // Ошибки оракула — в свой журнал, а не в консоль хаба. Отдать ему
        // свой STDERR нельзя: в Windows дочерний процесс получает тот же
        // файл, и когда хаб пишет журнал в файл (> log 2>&1), после запуска
        // Node его строки ложатся с начала файла поверх прежних. Поймано
        // проверкой хаба: её вывод в файл обрывался на середине.
        $errLog = rtrim(sys_get_temp_dir(), '\\/') . DIRECTORY_SEPARATOR . 'solar-oracle.log';
        $spec = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['file', $errLog, 'a'],
        ];
        $proc = @proc_open([$node, $script], $spec, $pipes, dirname($script));
        if (!is_resource($proc)) {
            $o->say('оракул рельефа не запустился (' . $node . '): NPC без посадок');
            return null;
        }
        $o->proc = $proc;
        $o->pipes = $pipes;
        // Первая строка — номер порта. Node, которого нет, закрывает трубу
        // сразу, и fgets вернёт false, а не повиснет.
        $line = fgets($pipes[1]);
        if ($line === false || !preg_match('/^ORACLE (\d+)/', $line, $m)) {
            $o->say('оракул рельефа не ответил (журнал: ' . $errLog . '): NPC без посадок');
            $o->close();
            return null;
        }
        $sock = @stream_socket_client('tcp://127.0.0.1:' . $m[1], $errno, $errstr, 3.0);
        if ($sock === false) {
            $o->say('оракул рельефа недоступен (' . $errstr . '): NPC без посадок');
            $o->close();
            return null;
        }
        $o->sock = $sock;
        $o->say('оракул рельефа: порт ' . $m[1]);
        return $o;
    }

    public function alive(): bool
    {
        return !$this->dead && $this->sock !== null;
    }

    /**
     * Вопрос — ответ. Ответ сверяется по номеру: опоздавший ответ на
     * прошлый вопрос (тот, что не дождались) не выдаётся за этот.
     */
    public function ask(array $q, float $wait = self::WAIT): ?array
    {
        if (!$this->alive()) {
            return null;
        }
        $q['id'] = ++$this->seq;
        $till = microtime(true) + $wait;
        if (@fwrite($this->sock, json_encode($q) . "\n") === false) {
            return $this->fail('оракул рельефа: связь оборвалась');
        }
        while (true) {
            $left = $till - microtime(true);
            if ($left <= 0) {
                return $this->fail('оракул рельефа не ответил за ' . $wait . ' с');
            }
            stream_set_timeout($this->sock, (int) $left, (int) (($left - (int) $left) * 1e6));
            $line = fgets($this->sock);
            if ($line === false) {
                $meta = stream_get_meta_data($this->sock);
                return $this->fail(!empty($meta['timed_out'])
                    ? 'оракул рельефа не ответил за ' . $wait . ' с'
                    : 'оракул рельефа: связь оборвалась');
            }
            $r = json_decode($line, true);
            if (is_array($r) && ($r['id'] ?? null) === $q['id']) {
                return $r;
            }
        }
    }

    /** Корпуса: стойки, просвет, размер (код => числа). */
    public function types(): array
    {
        if ($this->types === null) {
            $r = $this->ask(['t' => 'types'], self::WAIT_FIRST);
            $this->types = is_array($r['types'] ?? null) ? $r['types'] : [];
        }
        return $this->types;
    }

    /** Верх грунта в круге km вокруг направления dir (оси тела). */
    public function area(int $sys, int $body, array $dir, float $km): ?array
    {
        $r = $this->ask(['t' => 'area', 'sys' => $sys, 'body' => $body, 'dir' => $dir, 'km' => $km]);
        return ($r['ok'] ?? false) ? $r : null;
    }

    /** Сухая ровная площадка у направления dir: {dir, r, n, slope} или null. */
    public function site(int $sys, int $body, array $dir, float $span = 3.0): ?array
    {
        $r = $this->ask(['t' => 'site', 'sys' => $sys, 'body' => $body, 'dir' => $dir, 'span' => $span]);
        return ($r['ok'] ?? false) ? $r : null;
    }

    public function close(): void
    {
        if (is_resource($this->sock)) {
            fclose($this->sock);
        }
        foreach ($this->pipes as $p) {
            if (is_resource($p)) {
                fclose($p);
            }
        }
        if (is_resource($this->proc)) {
            // stdin уже закрыт — оракул выходит сам, и proc_close, который
            // ждёт его выхода, возвращается сразу.
            proc_close($this->proc);
        }
        $this->sock = null;
        $this->proc = null;
        $this->pipes = [];
        $this->dead = true;
    }

    public function __destruct()
    {
        if (!$this->dead) {
            $this->close();
        }
    }

    private function fail(string $why): ?array
    {
        $this->say($why . ': NPC без посадок');
        $this->dead = true;
        return null;
    }

    private function say(string $line): void
    {
        if ($this->log !== null) {
            ($this->log)($line);
        }
    }
}
