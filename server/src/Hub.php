<?php
/**
 * Хаб: кто сейчас в игре и кто кого видит.
 *
 * Здесь НЕТ ни одного вызова Ratchet и ни одного сокета. Причина простая:
 * логика присутствия — это то, что легко сломать и невозможно заметить
 * глазами (пилоты чужой системы не должны быть видны, вышедший должен
 * пропасть, чужой токен не должен пускать), а проверять её через
 * настоящее сетевое соединение значит проверять заодно сеть, порт и
 * брандмауэр. Поэтому хаб работает с «соединениями» — любыми объектами,
 * умеющими send() и close(), — а Ratchet подставляет свои
 * (server/ws/server.php).
 *
 * Что летает по сокету:
 *
 *   клиент -> сервер
 *     {"t":"hello","token":"..."}            вход по тому же токену, что и API
 *     {"t":"pos","sys":0,"x":..,"y":..,"z":..,"v":0.4,"mode":"flight"}
 *     {"t":"ping"}
 *
 *   сервер -> клиент
 *     {"t":"welcome","you":{...},"peers":[...]}
 *     {"t":"peers","list":[...]}             раз в тик, только своя система
 *     {"t":"leave","id":7}
 *     {"t":"error","code":"auth","message":"..."}
 *
 * Положение НЕ ПРОВЕРЯЕТСЯ: сервер не считает физику и знает лишь то, что
 * прислал клиент. Это честная граница сегодняшнего дня — присутствие тут
 * настоящее, а движение пока на доверии.
 */

final class Hub
{
    /** Как часто рассылаем снимок, с. */
    public const TICK = 0.2;

    /** Сколько ждём hello до отключения, с. */
    public const HELLO_TIMEOUT = 10;

    /** Не чаще стольких обновлений положения в секунду от одного клиента. */
    public const POS_RATE = 25;

    /** Больше — молчащий клиент считается мёртвым, с. */
    public const IDLE_TIMEOUT = 90;

    /** @var array<int, array> id соединения => состояние */
    private array $peers = [];

    /** @var callable|null куда писать события (для журнала) */
    private $log;

    public function __construct(?callable $log = null)
    {
        $this->log = $log;
    }

    public function count(): int
    {
        return count($this->peers);
    }

    /** Кто сейчас в сети: для журнала и для ping по HTTP. */
    public function online(): array
    {
        $out = [];
        foreach ($this->peers as $p) {
            if ($p['player'] !== null) {
                $out[] = ['id' => $p['player'], 'name' => $p['name'], 'sys' => $p['sys']];
            }
        }
        return $out;
    }

    public function open($conn, float $now): void
    {
        $this->peers[$this->key($conn)] = [
            'conn' => $conn,
            'player' => null,          // пока не вошёл — ничего не видит и не шлёт
            'name' => '',
            'sys' => null,
            'x' => 0.0, 'y' => 0.0, 'z' => 0.0, 'v' => 0.0,
            'mode' => 'flight',
            'since' => $now,
            'seen' => $now,
            'posAt' => 0.0,
            'moved' => false,
        ];
    }

    public function close($conn, float $now): void
    {
        $key = $this->key($conn);
        $peer = $this->peers[$key] ?? null;
        unset($this->peers[$key]);
        if ($peer && $peer['player'] !== null) {
            // Остальным в той же системе говорим об уходе сразу, а не
            // ждём тика: корабль, исчезающий с задержкой, читается как
            // подвисание.
            $this->broadcast($peer['sys'], ['t' => 'leave', 'id' => $peer['player']], $peer['player']);
            $this->say('ушёл ' . $peer['name']);
        }
    }

    public function message($conn, string $text, float $now): void
    {
        $key = $this->key($conn);
        if (!isset($this->peers[$key])) {
            return;
        }
        $peer = &$this->peers[$key];
        $peer['seen'] = $now;

        $msg = json_decode($text, true);
        if (!is_array($msg) || !isset($msg['t'])) {
            $this->send($conn, ['t' => 'error', 'code' => 'bad_message', 'message' => 'непонятное сообщение']);
            return;
        }

        switch ($msg['t']) {
            case 'hello':
                $this->hello($conn, $peer, (string) ($msg['token'] ?? ''), $now);
                return;

            case 'pos':
                // До входа не слушаем ничего: иначе любой желающий сможет
                // светиться в чужой системе, не имея учётной записи.
                if ($peer['player'] === null) {
                    $this->send($conn, ['t' => 'error', 'code' => 'auth', 'message' => 'сначала hello']);
                    return;
                }
                // Слишком частые обновления просто отбрасываем: тик всё
                // равно рассылает последнее известное.
                if ($now - $peer['posAt'] < 1.0 / self::POS_RATE) {
                    return;
                }
                $peer['posAt'] = $now;
                $peer['sys'] = isset($msg['sys']) ? (int) $msg['sys'] : $peer['sys'];
                $peer['x'] = self::num($msg['x'] ?? 0);
                $peer['y'] = self::num($msg['y'] ?? 0);
                $peer['z'] = self::num($msg['z'] ?? 0);
                $peer['v'] = self::num($msg['v'] ?? 0);
                $mode = (string) ($msg['mode'] ?? 'flight');
                $peer['mode'] = in_array($mode, ['flight', 'docked', 'landed', 'warp'], true)
                    ? $mode : 'flight';
                $peer['moved'] = true;
                return;

            case 'ping':
                $this->send($conn, ['t' => 'pong', 'time' => round($now, 3)]);
                return;

            default:
                $this->send($conn, ['t' => 'error', 'code' => 'unknown', 'message' => 'неизвестный вызов']);
        }
    }

    /**
     * Вход по токену — тому же, что у API.
     *
     * Своего входа у сокета нет намеренно: две двери с разными правилами
     * рано или поздно разъезжаются, и закрытой остаётся только одна.
     */
    private function hello($conn, array &$peer, string $token, float $now): void
    {
        if ($peer['player'] !== null) {
            return;                                  // повторный hello — не беда
        }
        $playerId = Auth::playerByToken($token);
        if ($playerId === null) {
            $this->send($conn, ['t' => 'error', 'code' => 'auth', 'message' => 'нужен вход']);
            $conn->close();
            return;
        }

        // Один пилот — одно соединение. Вторая вкладка выбивает первую:
        // иначе игрок видит сам себя чужим кораблём и гоняется за ним.
        foreach ($this->peers as $k => $other) {
            if ($k !== $this->key($conn) && $other['player'] === $playerId) {
                $this->send($other['conn'], ['t' => 'error', 'code' => 'replaced',
                    'message' => 'этот пилот вошёл в другом окне']);
                $other['conn']->close();
            }
        }

        $row = Db::row('SELECT `name`,`login`,`system_id` FROM `player` WHERE `id`=?', [$playerId]);
        $peer['player'] = $playerId;
        $peer['name'] = $row ? ($row['name'] ?: $row['login']) : ('#' . $playerId);
        $peer['sys'] = $row && $row['system_id'] !== null ? (int) $row['system_id'] : null;

        $this->send($conn, [
            't' => 'welcome',
            'you' => ['id' => $playerId, 'name' => $peer['name'], 'sys' => $peer['sys']],
            'tick' => self::TICK,
            'peers' => $this->peersOf($peer['sys'], $playerId),
        ]);
        $this->say('вошёл ' . $peer['name'] . ' (система ' . ($peer['sys'] ?? '—') . ')');
    }

    /**
     * Тик: каждому — снимок тех, кто в его системе.
     *
     * Рассылка идёт по тику, а не по каждому входящему сообщению: при
     * десятке пилотов это разница между десятью пакетами в кадр и
     * пятью в секунду.
     */
    public function tick(float $now): int
    {
        $sent = 0;
        foreach ($this->peers as $key => $peer) {
            if ($peer['player'] === null) {
                // Молчит и не представился — закрываем: это либо сканер
                // портов, либо брошенная вкладка.
                if ($now - $peer['since'] > self::HELLO_TIMEOUT) {
                    $peer['conn']->close();
                }
                continue;
            }
            if ($now - $peer['seen'] > self::IDLE_TIMEOUT) {
                $peer['conn']->close();
                continue;
            }
            $list = $this->peersOf($peer['sys'], $peer['player']);
            $this->send($peer['conn'], ['t' => 'peers', 'list' => $list]);
            $sent++;
        }
        return $sent;
    }

    /** Кто виден пилоту: только его система и только вошедшие. */
    private function peersOf(?int $sys, int $exceptPlayer): array
    {
        $out = [];
        foreach ($this->peers as $p) {
            if ($p['player'] === null || $p['player'] === $exceptPlayer) {
                continue;
            }
            // Система обязана совпасть. Пилот в другой системе не просто
            // далеко — его там физически нет.
            if ($sys === null || $p['sys'] !== $sys) {
                continue;
            }
            $out[] = [
                'id' => $p['player'],
                'name' => $p['name'],
                'x' => $p['x'], 'y' => $p['y'], 'z' => $p['z'],
                'v' => $p['v'],
                'mode' => $p['mode'],
            ];
        }
        return $out;
    }

    private function broadcast(?int $sys, array $msg, int $exceptPlayer): void
    {
        foreach ($this->peers as $p) {
            if ($p['player'] === null || $p['player'] === $exceptPlayer) {
                continue;
            }
            if ($sys !== null && $p['sys'] !== $sys) {
                continue;
            }
            $this->send($p['conn'], $msg);
        }
    }

    private function send($conn, array $msg): void
    {
        $conn->send(json_encode($msg, JSON_UNESCAPED_UNICODE));
    }

    private function key($conn): string
    {
        // Ratchet раздаёт соединениям resourceId; в проверках его может не
        // быть, и тогда ключом служит сам объект.
        return isset($conn->resourceId) ? 'r' . $conn->resourceId : spl_object_hash($conn);
    }

    private static function num($v): float
    {
        return is_numeric($v) && is_finite((float) $v) ? (float) $v : 0.0;
    }

    private function say(string $line): void
    {
        if ($this->log !== null) {
            ($this->log)($line);
        }
    }
}
