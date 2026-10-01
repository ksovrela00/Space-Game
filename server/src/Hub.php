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
 *     {"t":"pos","sys":0,"x":..,"y":..,"z":..,"v":0.4,"mode":"flight",
 *      "fx":..,"fy":..,"fz":..,"ux":..,"uy":..,"uz":..,   куда смотрит и где верх
 *      "wm":..,"wl":..,"wr":..,"n":17}   работа сопел с начала связи, км/с, и номер снимка
 *     {"t":"ping"}
 *     {"t":"shot","w":"laser_g","x":..,"y":..,"z":..,"dx":..,"dy":..,"dz":..}
 *     {"t":"hit","id":7,"w":"laser_g"}      попадание по пилоту 7
 *
 *   сервер -> клиент
 *     {"t":"welcome","you":{...},"peers":[...],"wt":123.4}
 *     {"t":"peers","list":[...],"wt":123.4}  раз в тик, только своя система
 *       в списке у каждого: место, осанка, корпус и щит (hull/hmax/sh/smax)
 *
 * wt — время мира (Clock): по нему клиенты держат орбиты в одной фазе.
 * Оно идёт в каждом снимке, а не только при входе: вкладка в фоне
 * перестаёт получать кадры, её часы отстают, и без поправки пилот,
 * вернувшийся к игре, увидит станцию не там, где остальные.
 *     {"t":"leave","id":7}
 *     {"t":"shot","by":7,...}                чужой выстрел — только картинка
 *     {"t":"hurt","by":7,"dmg":3,"hull":61,"dead":false}   попали В НАС
 *     {"t":"hitok","id":7,"hull":61,"dead":false}          попали МЫ
 *     {"t":"boom","id":7}                    чей-то корабль уничтожен
 *     {"t":"fuel","fuel":8.4,"cap":12,"n":17}  бак по счёту сервера после снимка n
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

    /** Не чаще стольких выстрелов в секунду от одного клиента. */
    public const SHOT_RATE = 10;

    /**
     * Сколько ударов о грунт в секунду слушаем с одного корабля.
     *
     * Четырёх хватает с запасом: отскок длится доли секунды, а подряд
     * стучать по грунту чаще — это уже не посадка, а попытка залить хаб
     * пакетами.
     */
    public const IMPACT_RATE = 4;

    /** Как часто перечитываем корпус и щит пилота из базы, с. */
    public const STAT_EVERY = 10;

    /** Больше — молчащий клиент считается мёртвым, с. */
    public const IDLE_TIMEOUT = 90;

    /**
     * Запас предела расхода: во сколько раз больше того, что двигатель
     * может дать за прошедшее время, и сколько секунд сверху.
     *
     * Время на сервере — время прихода снимков, а игра считает своим
     * шагом физики; после рывка сети два снимка приходят разом, и между
     * ними по часам хаба проходит миллисекунда. Без запаса честный разгон
     * срезался бы пределом.
     */
    public const METER_SLACK = 1.5;
    public const METER_SLACK_S = 0.5;

    /**
     * Когда расход уходит в базу: накопилось столько тонн — или прошло
     * столько секунд. Писать на каждый снимок незачем (пять запросов в
     * секунду на пилота), а копить долго нельзя: заправка в порту читает
     * бак из базы.
     */
    public const FLUSH_T = 0.05;
    public const FLUSH_EVERY = 2.0;

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

    /**
     * Разослать СОСТАВ СЕТИ: кто в игре и в какой системе.
     *
     * В тик этот список НЕ кладётся, хотя места бы хватило: тик идёт
     * пять раз в секунду и несёт то, что меняется каждый раз — координаты
     * соседей. Состав же меняется раз в несколько минут: вошёл, ушёл,
     * сменил систему. Три события на весь вечер против пяти
     * повторов в секунду на каждого.
     */
    private function sendRoster(): void
    {
        $list = $this->online();
        foreach ($this->peers as $p) {
            if ($p['player'] !== null) {
                $this->send($p['conn'], ['t' => 'roster', 'list' => $list]);
            }
        }
    }

    public function open($conn, float $now): void
    {
        $this->peers[$this->key($conn)] = [
            'conn' => $conn,
            'player' => null,          // пока не вошёл — ничего не видит и не шлёт
            'name' => '',
            'sys' => null,
            'x' => 0.0, 'y' => 0.0, 'z' => 0.0, 'v' => 0.0,
            // Осанка корабля. По умолчанию — «смотрит по оси Z, верх по
            // Y»: пока пилот не прислал свою, показать его надо хоть
            // как-то, а не боком.
            'fx' => 0.0, 'fy' => 0.0, 'fz' => 1.0,
            'ux' => 0.0, 'uy' => 1.0, 'uz' => 0.0,
            'mode' => 'flight',
            'since' => $now,
            'seen' => $now,
            'posAt' => 0.0,
            'shotAt' => 0.0,
            'hitAt' => 0.0,
            'impactAt' => 0.0,
            // Что стоит на корабле — спрашиваем у базы один раз на
            // соединение: оружие в полёте не меняется, а запрос на
            // каждое попадание превратил бы бой в поток запросов.
            'guns' => [],
            // Корпус и щит соседа рисуются у его метки, поэтому идут в
            // каждом снимке. Читаются из базы РЕДКО: при входе, при
            // попадании и раз в STAT_EVERY — гонять запрос на каждый тик
            // ради двух чисел незачем.
            'hull' => 0.0, 'hullMax' => 0.0,
            'shield' => 0.0, 'shieldMax' => 0.0,
            'regen' => 0.0, 'delay' => 0.0,
            'shieldAt' => $now, 'statAt' => 0.0,
            'moved' => false,
            // Топливо (server/src/Fuel.php): модель бака, счётчики работы
            // сопел из прошлого снимка и то, что ещё не ушло в базу.
            'ship' => null, 'fm' => null, 'fuel' => null,
            'work' => null, 'seq' => 0, 'meterAt' => null,
            // Можно ли мерить прыжок от прошлого места. Нельзя до первого
            // снимка (прошлое место — ноль координат) и после того, как
            // сервер сам переставил корабль (гибель, буксир).
            'qOk' => false,
            'pend' => 0.0, 'flushAt' => $now,
        ];
    }

    public function close($conn, float $now): void
    {
        $key = $this->key($conn);
        $peer = $this->peers[$key] ?? null;
        // Накопленный расход — в базу: ушёл пилот или нет, топливо он
        // потратил.
        if ($peer !== null) {
            $this->flushFuel($peer, $now, false);
        }
        unset($this->peers[$key]);
        if ($peer && $peer['player'] !== null) {
            // Остальным в той же системе говорим об уходе сразу, а не
            // ждём тика: корабль, исчезающий с задержкой, читается как
            // подвисание.
            $this->broadcast($peer['sys'], ['t' => 'leave', 'id' => $peer['player']], $peer['player']);
            // Ушедший пропадает из состава у всех, а не только у соседей
            // по системе: список пилотов общий на всю галактику.
            $this->sendRoster();
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
                $wasSys = $peer['sys'];
                $wasHere = !self::between($peer);
                $was = ['x' => $peer['x'], 'y' => $peer['y'], 'z' => $peer['z'], 'mode' => $peer['mode']];
                $peer['sys'] = isset($msg['sys']) ? (int) $msg['sys'] : $peer['sys'];
                $peer['x'] = self::num($msg['x'] ?? 0);
                $peer['y'] = self::num($msg['y'] ?? 0);
                $peer['z'] = self::num($msg['z'] ?? 0);
                $peer['v'] = self::num($msg['v'] ?? 0);
                // Ориентацию только ПЕРЕСЫЛАЕМ: своей физики у сервера
                // нет, проверять её нечем, а нормирует вектор тот, кто
                // рисует (js/game/peers.js).
                foreach (['fx', 'fy', 'fz', 'ux', 'uy', 'uz'] as $k) {
                    if (isset($msg[$k])) {
                        $peer[$k] = self::num($msg[$k]);
                    }
                }
                $mode = (string) ($msg['mode'] ?? 'flight');
                $peer['mode'] = in_array($mode, ['flight', 'docked', 'landed', 'warp'], true)
                    ? $mode : 'flight';
                $peer['moved'] = true;
                $this->meter($peer, $msg, $now, $wasSys, $was);

                // Пропал из системы — говорим об этом СРАЗУ, а не ждём,
                // пока сосед сам забудет по истечении срока. Пропасть
                // можно двумя способами: уйти в другую систему и уйти в
                // прыжок, и второе так же окончательно, как первое.
                if ($wasSys !== null && $peer['player'] !== null
                    && ($wasSys !== $peer['sys'] || ($wasHere && self::between($peer)))) {
                    $this->broadcast($wasSys, ['t' => 'leave', 'id' => $peer['player']], $peer['player']);
                }
                // Смена системы видна в списке пилотов у ВСЕХ: ради этого
                // список и нужен — видеть, кто куда ушёл.
                if ($wasSys !== $peer['sys']) {
                    $this->sendRoster();
                }
                return;

            case 'shot':
                // Выстрел ПЕРЕСЫЛАЕТСЯ как есть: это картинка, урона в нём
                // нет. Проверяется только темп — чтобы одним клиентом
                // нельзя было залить систему пакетами.
                if ($peer['player'] === null) {
                    return;
                }
                if ($now - $peer['shotAt'] < 1.0 / self::SHOT_RATE) {
                    return;
                }
                // Из прыжка не стреляют — соседям нечего показывать.
                if (self::between($peer)) {
                    return;
                }
                $peer['shotAt'] = $now;
                $this->broadcast($peer['sys'], [
                    't' => 'shot',
                    'by' => $peer['player'],
                    'w' => (string) ($msg['w'] ?? ''),
                    'x' => self::num($msg['x'] ?? 0),
                    'y' => self::num($msg['y'] ?? 0),
                    'z' => self::num($msg['z'] ?? 0),
                    'dx' => self::num($msg['dx'] ?? 0),
                    'dy' => self::num($msg['dy'] ?? 0),
                    'dz' => self::num($msg['dz'] ?? 1),
                ], $peer['player']);
                return;

            case 'hit':
                $this->hit($conn, $peer, $msg, $now);
                return;

            case 'impact':
                $this->impact($conn, $peer, $msg, $now);
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
        $this->loadStats($peer, $now);

        $this->send($conn, [
            't' => 'welcome',
            'you' => ['id' => $playerId, 'name' => $peer['name'], 'sys' => $peer['sys']],
            'tick' => self::TICK,
            'wt' => Clock::worldTime(),
            'peers' => $this->peersOf($peer['sys'], $playerId, $now),
            // Состав сети целиком — вошедшему он нужен сразу, а не после
            // первого чужого входа.
            'roster' => $this->online(),
        ]);
        // А остальным — обновлённый состав с новичком в нём.
        $this->sendRoster();
        $this->say('вошёл ' . $peer['name'] . ' (система ' . ($peer['sys'] ?? '—') . ')');
    }

    /**
     * Попадание: что сервер может проверить, а что нет.
     *
     * Проверяемо: оружие стоит на корабле, цель в той же системе, она в
     * пределах дальности с запасом, и попадания идут не чаще, чем оружие
     * умеет стрелять. Непроверяемо: летел ли болт на самом деле — физики
     * снарядов на сервере нет, как нет и физики полёта (см. Combat).
     */
    private function hit($conn, array &$peer, array $msg, float $now): void
    {
        if ($peer['player'] === null) {
            $this->send($conn, ['t' => 'error', 'code' => 'auth', 'message' => 'сначала hello']);
            return;
        }
        if ($now - $peer['hitAt'] < 1.0 / Combat::HIT_RATE) {
            return;                                  // темп выше оружейного
        }
        $victimId = (int) ($msg['id'] ?? 0);
        $code = (string) ($msg['w'] ?? '');
        if ($victimId <= 0 || $victimId === $peer['player'] || $code === '') {
            return;
        }

        // В прыжке не стреляют. Стрелок между системами — это тот же
        // корабль, которого в системе нет: его самого не видно и не
        // достать, и попаданий от него быть не может.
        if (self::between($peer)) {
            return;
        }

        // Жертва должна быть В СЕТИ И В ЭТОЙ ЖЕ СИСТЕМЕ: по кораблю,
        // которого здесь нет, попасть нельзя ничем.
        //
        // «Здесь нет» — это и ушедший в прыжок. Проверка повторяет ту,
        // что уже спрятала его из снимка, и повторяет НАМЕРЕННО: у
        // стрелка список соседей мог остаться с прошлой секунды, и
        // выстрел по исчезнувшему приходит на сервер как обычный.
        $victim = null;
        foreach ($this->peers as $p) {
            if ($p['player'] === $victimId && $p['sys'] === $peer['sys']
                && !self::between($p)) {
                $victim = $p;
                break;
            }
        }
        if ($victim === null) {
            return;
        }

        if (!isset($peer['guns'][$code])) {
            $peer['guns'][$code] = Combat::armed($peer['player'], $code)
                ? Combat::weapon($code) : null;
        }
        $gun = $peer['guns'][$code];
        if ($gun === null) {
            $this->send($conn, ['t' => 'error', 'code' => 'no_gun',
                'message' => 'такого оружия на корабле нет']);
            return;
        }

        $d = sqrt(
            ($victim['x'] - $peer['x']) ** 2 +
            ($victim['y'] - $peer['y']) ** 2 +
            ($victim['z'] - $peer['z']) ** 2
        );
        if ($d > (float) $gun['range'] * Combat::RANGE_SLACK) {
            return;                                  // дальше, чем бьёт оружие
        }

        $peer['hitAt'] = $now;
        $res = Combat::damage($victimId, (float) $gun['damage']);

        // Кэш жертвы обновляем сразу: её корпус и щит рисуются у метки в
        // чужих приборах, и ждать перечитывания из базы там нечего.
        foreach ($this->peers as $k => $p) {
            if ($p['player'] === $victimId) {
                $this->peers[$k]['hull'] = $res['hull'];
                $this->peers[$k]['hullMax'] = $res['max'];
                $this->peers[$k]['shield'] = $res['shield'];
                $this->peers[$k]['shieldMax'] = $res['smax'];
                $this->peers[$k]['shieldAt'] = $now;
            }
        }

        $this->send($victim['conn'], [
            't' => 'hurt', 'by' => $peer['player'], 'name' => $peer['name'],
            'dmg' => (float) $gun['damage'], 'hull' => $res['hull'],
            'max' => $res['max'], 'shield' => $res['shield'], 'smax' => $res['smax'],
            'absorbed' => $res['absorbed'], 'dead' => $res['dead'],
        ]);
        $this->send($conn, [
            't' => 'hitok', 'id' => $victimId,
            'hull' => $res['hull'], 'max' => $res['max'],
            'shield' => $res['shield'], 'smax' => $res['smax'],
            'absorbed' => $res['absorbed'], 'dead' => $res['dead'],
        ]);

        if ($res['dead']) {
            // Гибель сразу превращается в состояние, из которого можно
            // играть дальше: корабль целый, пилот в своём порту.
            Combat::respawn($victimId);
            foreach ($this->peers as $k => $p) {
                if ($p['player'] === $victimId) {
                    $this->loadStats($this->peers[$k], $now, true);
                }
            }
            $this->broadcast($peer['sys'], ['t' => 'boom', 'id' => $victimId], $victimId);
            $this->say('уничтожен ' . $victim['name'] . ' (огнём ' . $peer['name'] . ')');
        }
    }

    /**
     * Удар о грунт: считает СЕРВЕР.
     *
     * Игра сообщает ИЗМЕРЕНИЕ — с какой скоростью коснулись, на шасси ли,
     * в правильной ли позе, — а во сколько это обошлось корпусу, решает
     * Combat::impact по числам из каталога. Ни урона, ни тем более
     * корпуса игра не присылает: иначе «сколько у меня осталось» отвечал
     * бы тот, кому это выгодно.
     *
     * Здесь, в сокете, а не отдельным запросом, потому что это живое
     * событие полёта — рядом с выстрелом и попаданием: соединение уже
     * открыто, а гибель надо тут же показать соседям.
     */
    private function impact($conn, array &$peer, array $msg, float $now): void
    {
        if ($peer['player'] === null) {
            return;
        }
        if ($now - $peer['impactAt'] < 1.0 / self::IMPACT_RATE) {
            return;
        }
        $peer['impactAt'] = $now;

        $res = Combat::impact(
            (int) $peer['player'],
            self::num($msg['norm'] ?? 0),
            self::num($msg['slide'] ?? 0),
            !empty($msg['gear']),
            !empty($msg['pose']),
            !empty($msg['fatal'])
        );

        // Корпус в кэше — тот, что видят соседи у метки: ждать
        // перечитывания из базы там нечего.
        foreach ($this->peers as $k => $p) {
            if ($p['player'] === $peer['player']) {
                $this->peers[$k]['hull'] = $res['hull'];
                $this->peers[$k]['hullMax'] = $res['max'];
            }
        }

        $this->send($conn, [
            't' => 'impact', 'hull' => $res['hull'], 'max' => $res['max'],
            'dmg' => $res['damage'], 'dead' => $res['dead'],
        ]);

        if ($res['dead']) {
            Combat::respawn((int) $peer['player']);
            foreach ($this->peers as $k => $p) {
                if ($p['player'] === $peer['player']) {
                    $this->loadStats($this->peers[$k], $now, true);
                }
            }
            $this->broadcast($peer['sys'], ['t' => 'boom', 'id' => $peer['player']], $peer['player']);
            $this->say('разбился ' . $peer['name']);
        }
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
        // Время мира спрашиваем РАЗ на тик, а не на каждого: это обращение
        // к базе, а снимок у всех всё равно один и тот же.
        $wt = Clock::worldTime();
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
            // Корпус мог измениться мимо нас: починились в порту,
            // например. Перечитываем редко, но перечитываем.
            if ($now - $peer['statAt'] > self::STAT_EVERY) {
                $this->loadStats($this->peers[$key], $now);
            }
            $list = $this->peersOf($peer['sys'], $peer['player'], $now);
            $this->send($peer['conn'], ['t' => 'peers', 'list' => $list, 'wt' => $wt]);
            $sent++;
        }
        return $sent;
    }

    /**
     * Перечитать корпус и щит пилота из базы.
     *
     * Нужно не только при входе: корпус чинят в порту, и без обновления
     * сосед ещё десять минут висел бы битым в чужих приборах.
     */
    private function loadStats(array &$peer, float $now, bool $moved = false): void
    {
        $peer['statAt'] = $now;
        // Корабль переставил сервер (гибель): отрезок до нового места —
        // не прыжок, и мерить его нечего.
        if ($moved) {
            $peer['qOk'] = false;
        }
        $row = Db::row(
            'SELECT s.`id`, s.`hull`, s.`shield`, s.`hit_at`, t.`hull_max`
             FROM `ship` s JOIN `ship_type` t ON t.`id` = s.`type_id`
             WHERE s.`owner_id`=? LIMIT 1',
            [$peer['player']]
        );
        if ($row === null) {
            return;
        }
        // Хаб — отдельный процесс, и память модулей (Loadout) у него своя:
        // верфь меняет их запросом в другом процессе, и без этого хаб до
        // перезапуска считал бы щит и расход по снятому модулю.
        $peer['ship'] = (int) $row['id'];
        Loadout::forget($peer['ship']);
        // Щит соседа — с его модуля: у двоих на одинаковых корпусах щиты
        // могут быть разные, и в приборах это должно быть видно.
        $row += Loadout::shield((int) $row['id']);
        $peer['hull'] = (float) $row['hull'];
        $peer['hullMax'] = (float) $row['hull_max'];
        $peer['shieldMax'] = (float) $row['shield_max'];
        $peer['regen'] = (float) $row['shield_regen'];
        $peer['delay'] = (float) $row['shield_delay'];
        // Щит приводим к ВРЕМЕНИ ХАБА: в базе он записан на момент
        // последнего попадания по часам СУБД, а здесь всё считается от
        // microtime процесса, и смешивать эти шкалы нельзя.
        $peer['shield'] = Combat::shieldNow($row);
        $peer['shieldAt'] = $now;
        // Бак — тоже отсюда: его меняют мимо хаба заправка, верфь и варп
        // (Players::save), и игра обязана узнать об этом, не перезаходя.
        $peer['fm'] = Fuel::model($peer['ship']);
        $peer['fuel'] = $peer['fm']['fuel'];
        $this->sendFuel($peer);
    }

    /**
     * Замер расхода топлива по снимку.
     *
     * Двигатели — по счётчикам, которые шлёт игра: сколько скорости
     * набрала каждая группа сопел с начала связи. Считаем разницу с
     * прошлым снимком, а не сами числа: снимки, пришедшие чаще POS_RATE,
     * отбрасываются, и с разницами их работа пропала бы вместе с ними.
     * Предел — сколько группа вообще может дать за прошедшее время
     * (Fuel::model), с запасом METER_SLACK.
     *
     * Квантовый прыжок — по самим положениям, игре тут сообщать нечего:
     * отрезок, пройденный быстрее jumpGate, и есть прыжок. Не мерим то,
     * что прыжком не является: смену системы (варп считает база), тоннель
     * (рывок в миллион км/с — это варп, а не квантовый привод), стоянку и
     * док (корабль едет с телом, а не летит).
     */
    private function meter(array &$peer, array $msg, float $now, ?int $wasSys, array $was): void
    {
        $m = $peer['fm'];
        if ($m === null) {
            return;
        }
        $dt = $peer['meterAt'] === null ? 0.0 : max(0.0, $now - $peer['meterAt']);
        $peer['meterAt'] = $now;
        $span = ($dt + self::METER_SLACK_S) * self::METER_SLACK;
        $tons = 0.0;

        if (isset($msg['wm'], $msg['wl'], $msg['wr'])) {
            $w = [self::num($msg['wm']), self::num($msg['wl']), self::num($msg['wr'])];
            $prev = $peer['work'];
            $peer['work'] = $w;
            // Счётчики пошли вниз — игра начала их заново (перезагрузка
            // вкладки при живом сокете не бывает, а вот сброс — бывает).
            // Это новая точка отсчёта, а не отрицательный расход.
            if ($prev !== null && $dt > 0
                && $w[0] >= $prev[0] && $w[1] >= $prev[1] && $w[2] >= $prev[2]) {
                $tons += Fuel::thrustTons($m,
                    min($w[0] - $prev[0], $m['mainAccel'] * $span),
                    min($w[1] - $prev[1], $m['liftAccel'] * $span),
                    min($w[2] - $prev[2], $m['rcsAccel'] * $span));
            }
        }

        $still = ['docked', 'landed', 'warp'];
        if ($peer['qOk'] && $dt > 0 && $wasSys !== null && $wasSys === $peer['sys']
            && !in_array($was['mode'], $still, true) && !in_array($peer['mode'], $still, true)) {
            $seg = sqrt(($peer['x'] - $was['x']) ** 2 + ($peer['y'] - $was['y']) ** 2
                + ($peer['z'] - $was['z']) ** 2);
            if ($seg > $m['jumpGate'] * $dt) {
                // Больше, чем привод проходит за это время, не спишется:
                // отладочный телепорт через полсистемы прыжком не является.
                $tons += Fuel::quantumTons($m, min($seg, $m['quantumSpeed'] * $span));
            }
        }
        $peer['qOk'] = true;
        if (isset($msg['n']) && is_numeric($msg['n'])) {
            $peer['seq'] = (int) $msg['n'];
        }
        $peer['pend'] += $tons;

        // В док или на грунт — сразу в базу: там заправка, и она читает
        // бак из базы, а не из памяти хаба.
        $parked = in_array($peer['mode'], ['docked', 'landed'], true)
            && !in_array($was['mode'], ['docked', 'landed'], true);
        if ($peer['pend'] >= self::FLUSH_T || $parked
            || ($peer['pend'] > 0 && $now - $peer['flushAt'] >= self::FLUSH_EVERY)) {
            $this->flushFuel($peer, $now);
        }
    }

    /** Накопленный расход — в базу, и игре — бак по счёту сервера. */
    private function flushFuel(array &$peer, float $now, bool $tell = true): void
    {
        $peer['flushAt'] = $now;
        // База держит килограммы: дробную часть оставляем копиться.
        $t = floor($peer['pend'] * 1000) / 1000;
        if ($t <= 0 || $peer['ship'] === null) {
            return;
        }
        $peer['pend'] -= $t;
        $peer['fuel'] = Fuel::burn($peer['ship'], $t);
        if ($tell) {
            $this->sendFuel($peer);
        }
    }

    /**
     * Бак игре. Вместе с ним — номер последнего учтённого снимка: игра
     * вычтет то, что потратила после него, и число на шкале не прыгнет
     * назад на ту долю секунды, что снимок шёл до сервера и обратно.
     */
    private function sendFuel(array $peer): void
    {
        if ($peer['fm'] === null || $peer['fuel'] === null) {
            return;
        }
        $this->send($peer['conn'], [
            't' => 'fuel',
            'fuel' => round(max(0.0, $peer['fuel'] - $peer['pend']), 3),
            'cap' => $peer['fm']['cap'],
            'n' => $peer['seq'],
        ]);
    }

    /** Щит соседа на данный момент: он отрастает и между попаданиями. */
    private static function shieldOf(array $peer, float $now): float
    {
        if ($peer['shieldMax'] <= 0) {
            return 0.0;
        }
        $idle = max(0.0, $now - $peer['shieldAt'] - $peer['delay']);
        return min($peer['shieldMax'], $peer['shield'] + $peer['regen'] * $idle);
    }

    /**
     * Пилот МЕЖДУ СИСТЕМАМИ: ушёл в варп-прыжок.
     *
     * Такого в системе физически нет. Существенно это потому, что игра
     * ставит корабль к звезде НОВОЙ системы за несколько секунд до
     * выхода из тоннеля (js/main.js, событие handover): координаты к
     * этому моменту уже её, а пилот ещё в прыжке — он не видит ничего и
     * ничего не может. Пока хаб раздавал его наравне со всеми, эти
     * секунды были чистым подарком тому, кто ждёт у звезды: цель видно,
     * цель не отвечает.
     *
     * Верим при этом КЛИЕНТУ — другого источника нет, физики прыжка на
     * сервере не существует. Обмануть это можно: объявить себя вечно
     * прыгающим и стать невидимым. Но ровно так же можно просто не слать
     * своё положение вовсе, и от этого защиты тоже нет — см. «Что
     * проверяет сервер» в README. Зато невидимый заодно и безоружен:
     * попадания от него не принимаются.
     */
    private static function between(array $p): bool
    {
        return ($p['mode'] ?? 'flight') === 'warp';
    }

    /** Кто виден пилоту: только его система и только вошедшие. */
    private function peersOf(?int $sys, int $exceptPlayer, float $now): array
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
            // Как и ушедший в прыжок: он уже не здесь, хотя координаты
            // прислал здешние.
            if (self::between($p)) {
                continue;
            }
            $out[] = [
                'id' => $p['player'],
                'name' => $p['name'],
                'x' => $p['x'], 'y' => $p['y'], 'z' => $p['z'],
                'v' => $p['v'],
                'fx' => $p['fx'], 'fy' => $p['fy'], 'fz' => $p['fz'],
                'ux' => $p['ux'], 'uy' => $p['uy'], 'uz' => $p['uz'],
                'hull' => round($p['hull'], 1), 'hmax' => $p['hullMax'],
                'sh' => round(self::shieldOf($p, $now), 1), 'smax' => $p['shieldMax'],
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
