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
 * КОРАБЛИ И ЛЮДИ — РАЗНЫЕ СПИСКИ. Соединение — это игрок. Он ВЕДЁТ свой
 * корабль (тот, которым командует, если корабль в той же системе), и он
 * же САМ где-то есть: в кресле, на палубе — своего или чужого корабля, —
 * на грунте. Корабль, хозяин которого в игре, но ведёт не его (пересел,
 * улетел пассажиром), стоит, где оставили, и его видно — хаб берёт его
 * из базы («без водителя», dorm).
 *
 * В МИРЕ ТОЛЬКО ТЕ, КТО В ИГРЕ. Ушёл игрок — пропал и он сам, и все его
 * корабли: стоящий на грунте корабль того, кого нет, — это мебель
 * чужой игры, и зайти в него всё равно не к кому. Пассажиров ушедшего
 * хаб ждёт GRACE, а не дождавшись, возвращает в кресла их собственных
 * кораблей (strand, Players::sendHome).
 *
 * Что летает по сокету:
 *
 *   клиент -> сервер
 *     {"t":"hello","token":"..."}            вход по тому же токену, что и API
 *     {"t":"pos","sys":0,                    система, где САМ пилот
 *      -- корабль, который он ведёт (нет полей x,y,z — не ведёт никакого):
 *      "sid":12,"x":..,"y":..,"z":..,"v":0.4,"mode":"flight",
 *      "fx":..,"fy":..,"fz":..,"ux":..,"uy":..,"uz":..,   куда смотрит и где верх
 *      "b":3,"lx":..,"ly":..,"lz":..,"lfx":..,"luy":..,   то же в осях тела (у тела)
 *      "g":1,"h":["nL"],"k":0.3,             шасси, открытые люки, работа подъёмных
 *      "wm":..,"wl":..,"wr":..,"n":17,       работа сопел с начала связи и номер снимка
 *      -- сам пилот:
 *      "me":{"st":"walk","s":12,"x":..,"y":..,"z":..,"yaw":..,"pitch":..,"v":1.9,"air":0}}
 *           или {"st":"out","b":3,"lx":..,"ly":..,"lz":..,"lfx":..,"lfy":..,"lfz":..,...}
 *     {"t":"ping"}
 *     {"t":"shot","w":"laser_g","x":..,"y":..,"z":..,"dx":..,"dy":..,"dz":..}
 *     {"t":"hit","id":12,"w":"laser_g"}     попадание по кораблю 12
 *     {"t":"hatch","ship":12,"id":"nL","open":true}   люк чужого корабля
 *
 *   сервер -> клиент
 *     {"t":"welcome","you":{...},"peers":[...],"people":[...],"wt":123.4}
 *     {"t":"peers","list":[...],"people":[...],"wt":123.4}  раз в тик, своя система
 *       list — корабли: id корабля, by — кто ведёт (или хозяин),
 *         место, осанка, корпус и щит, шасси, люки; dorm — без водителя:
 *         хозяин в игре, но ведёт не его, и стоит он по базе;
 *       people — люди: id игрока, где и как стоит
 *
 * wt — время мира (Clock): по нему клиенты держат орбиты в одной фазе.
 * Оно идёт в каждом снимке, а не только при входе: вкладка в фоне
 * перестаёт получать кадры, её часы отстают, и без поправки пилот,
 * вернувшийся к игре, увидит станцию не там, где остальные.
 *     {"t":"leave","id":7,"ship":12}         игрок 7 ушёл (и увёл корабль 12)
 *     {"t":"shot","by":7,...}                чужой выстрел — только картинка
 *     {"t":"hurt","by":7,"dmg":3,"hull":61,"dead":false}   попали В НАС
 *     {"t":"hitok","id":12,"hull":61,"dead":false}         попали МЫ
 *     {"t":"boom","id":12}                   корабль 12 уничтожен
 *     {"t":"hatchreq","ship":12,"id":"nL","open":true,"by":7}  просят люк НАШЕГО корабля
 *     {"t":"home","ship":12,"by":7,"home":30}  хозяин корабля 12 ушёл из игры:
 *                                            вы в кресле своего (30)
 *     {"t":"fuel","fuel":8.4,"cap":12,"n":17}  бак по счёту сервера после снимка n
 *     {"t":"error","code":"auth","message":"..."}
 *
 * Положение НЕ ПРОВЕРЯЕТСЯ: сервер не считает физику и знает лишь то, что
 * прислал клиент. Это честная граница сегодняшнего дня — присутствие тут
 * настоящее, а движение пока на доверии. Проверяется то, что проверяемо:
 * корабль ведёт только его хозяин, люк чужого корабля просят только
 * стоя рядом с ним.
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

    /**
     * Сколько ждём ушедшего хозяина, прежде чем вернуть его пассажиров
     * на их корабли, с.
     *
     * Уход — не всегда уход: обновил страницу, моргнул Wi-Fi, перезапустили
     * сервер. Игра переподключается сама, ступенями 1, 2, 5, 10, 20 с
     * (js/net/socket.js, BACKOFF): первые четыре — 18 с. Полминуты
     * покрывают их и загрузку страницы, и хозяин, нажавший F5, своих
     * пассажиров не высаживает. Корабль у остальных при этом пропадает
     * сразу: ждут его только те, кто стоит на его палубе.
     */
    public const GRACE = 30.0;

    /** Сколько просьб о люке в секунду слушаем: люк ходит полторы секунды. */
    public const HATCH_RATE = 4;

    /** Как часто перечитываем корпус и щит пилота из базы, с. */
    public const STAT_EVERY = 10;

    /**
     * Как часто перечитываем из базы корабли системы без водителя, с.
     *
     * Такой корабль не движется: меняются у него только люки (их хаб
     * сам пишет и сам сбрасывает этот срок) и то, что пишет сохранение
     * хозяина. Две секунды — столько не жалко подождать, чтобы увидеть
     * корабль, хозяин которого только что из него пересел.
     */
    public const DORM_EVERY = 2.0;

    /** Больше — молчащий клиент считается мёртвым, с. */
    public const IDLE_TIMEOUT = 90;

    /** Палуба корабля, м: дальше этого от центра точки на борту нет. */
    public const DECK_M = 60.0;

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

    /** @var array<int, array{at:float, list:array}> система => корабли без водителя */
    private array $dorm = [];

    /** @var array<int, float> игрок => когда ушёл: ждём его GRACE */
    private array $gone = [];

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

    /**
     * Запуск хаба. Кто по базе «в игре», был им у прошлого процесса — и
     * сейчас, скорее всего, переподключается. Ждём его, как ушедшего,
     * GRACE: перезапуск сервера не должен высаживать пассажиров, чей
     * хозяин вернётся через десять секунд. Не вернётся — strand.
     */
    public function boot(float $now): void
    {
        foreach (Db::all('SELECT `id` FROM `player` WHERE `online`=1') as $r) {
            $this->gone[(int) $r['id']] = $now;
        }
    }

    /** Есть ли у игрока соединение. */
    private function connected(int $playerId): bool
    {
        return $this->peerOf($playerId) !== null;
    }

    /** Ключ соединения игрока — или null. */
    private function peerOf(int $playerId)
    {
        foreach ($this->peers as $k => $p) {
            if ($p['player'] === $playerId) {
                return $k;
            }
        }
        return null;
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
            // Ведёт ли он сейчас корабль (в последнем снимке были его поля).
            'hosting' => false,
            'x' => 0.0, 'y' => 0.0, 'z' => 0.0, 'v' => 0.0,
            // Осанка корабля. По умолчанию — «смотрит по оси Z, верх по
            // Y»: пока пилот не прислал свою, показать его надо хоть
            // как-то, а не боком.
            'fx' => 0.0, 'fy' => 0.0, 'fz' => 1.0,
            'ux' => 0.0, 'uy' => 1.0, 'uz' => 0.0,
            // То же В ОСЯХ ТЕЛА, у которого корабль: соседи рисуют его с
            // опозданием в четверть секунды, а грунт под ним за это время
            // уезжает на десятки метров. В осях тела опоздание касается
            // только его собственного хода (js/game/peers.js).
            'local' => null,
            'g' => 0, 'h' => [], 'k' => 0.0,
            'mode' => 'flight',
            // Сам пилот: где и как стоит, и на чьём борту.
            'me' => null,
            'aboard' => null,
            'since' => $now,
            'seen' => $now,
            'posAt' => 0.0,
            'shotAt' => 0.0,
            'hitAt' => 0.0,
            'impactAt' => 0.0,
            'hatchAt' => 0.0,
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
            // подвисание. Пропадает он вместе с хозяином; прочие его
            // корабли (без водителя) уходят из списка со следующим тиком.
            $this->broadcast($peer['sys'], ['t' => 'leave', 'id' => $peer['player'],
                'ship' => $peer['hosting'] ? $peer['ship'] : null], $peer['player']);
            if ($peer['sys'] !== null) {
                $this->forgetDorm($peer['sys']);
            }
            // Вторая вкладка выбивает первую (hello) — это не уход.
            if (!$this->connected($peer['player'])) {
                $this->gone[$peer['player']] = $now;
            }
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
                $this->pos($conn, $peer, $msg, $now);
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
                // Из прыжка не стреляют — соседям нечего показывать. И не
                // стреляют, не ведя корабля: пушки у корабля, а не у пешехода.
                if (self::between($peer) || !$peer['hosting']) {
                    return;
                }
                $peer['shotAt'] = $now;
                $this->broadcast($peer['sys'], [
                    't' => 'shot',
                    'by' => $peer['player'],
                    'ship' => $peer['ship'],
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

            case 'hatch':
                $this->hatch($conn, $peer, $msg, $now);
                return;

            case 'ping':
                $this->send($conn, ['t' => 'pong', 'time' => round($now, 3)]);
                return;

            default:
                $this->send($conn, ['t' => 'error', 'code' => 'unknown', 'message' => 'неизвестный вызов']);
        }
    }

    /**
     * Снимок от игрока: его корабль (если он его ведёт) и он сам.
     */
    private function pos($conn, array &$peer, array $msg, float $now): void
    {
        // До входа не слушаем ничего: иначе любой желающий сможет
        // светиться в чужой системе, не имея учётной записи.
        if ($peer['player'] === null) {
            $this->send($conn, ['t' => 'error', 'code' => 'auth', 'message' => 'сначала hello']);
            return;
        }
        // Слишком частые обновления просто отбрасываем: тик всё равно
        // рассылает последнее известное.
        if ($now - $peer['posAt'] < 1.0 / self::POS_RATE) {
            return;
        }
        $peer['posAt'] = $now;
        $wasSys = $peer['sys'];
        $wasHere = $peer['hosting'] && !self::between($peer);
        $was = ['x' => $peer['x'], 'y' => $peer['y'], 'z' => $peer['z'], 'mode' => $peer['mode']];
        $peer['sys'] = isset($msg['sys']) ? (int) $msg['sys'] : $peer['sys'];

        // Какой корабль игра ведёт. Не тот, которым пилот командует по
        // базе, — не ведёт никакого: чужой корабль хаб не двигает. Игра
        // пересела (Players::command) — перечитываем, каким командует.
        $sid = isset($msg['sid']) && is_numeric($msg['sid']) ? (int) $msg['sid'] : $peer['ship'];
        if ($sid !== $peer['ship'] && $now - $peer['statAt'] > 1.0) {
            $this->loadStats($peer, $now, true);
        }
        $hosting = array_key_exists('x', $msg) && $peer['ship'] !== null && $sid === $peer['ship'];

        if ($hosting) {
            $peer['x'] = self::num($msg['x']);
            $peer['y'] = self::num($msg['y'] ?? 0);
            $peer['z'] = self::num($msg['z'] ?? 0);
            $peer['v'] = self::num($msg['v'] ?? 0);
            // Ориентацию только ПЕРЕСЫЛАЕМ: своей физики у сервера нет,
            // проверять её нечем, а нормирует вектор тот, кто рисует
            // (js/game/peers.js).
            foreach (['fx', 'fy', 'fz', 'ux', 'uy', 'uz'] as $k) {
                if (isset($msg[$k])) {
                    $peer[$k] = self::num($msg[$k]);
                }
            }
            $peer['local'] = isset($msg['b'], $msg['lx'], $msg['ly'], $msg['lz']) && is_numeric($msg['b'])
                ? ['b' => (int) $msg['b'],
                    'lx' => self::num($msg['lx']), 'ly' => self::num($msg['ly']), 'lz' => self::num($msg['lz']),
                    'lfx' => self::num($msg['lfx'] ?? 0), 'lfy' => self::num($msg['lfy'] ?? 0),
                    'lfz' => self::num($msg['lfz'] ?? 1),
                    'lux' => self::num($msg['lux'] ?? 0), 'luy' => self::num($msg['luy'] ?? 1),
                    'luz' => self::num($msg['luz'] ?? 0)]
                : null;
            $peer['g'] = self::clamp(self::num($msg['g'] ?? 0), 0, 1);
            $peer['h'] = self::hatchNames($msg['h'] ?? []);
            $peer['k'] = self::clamp(self::num($msg['k'] ?? 0), 0, 1);
            $mode = (string) ($msg['mode'] ?? 'flight');
            $peer['mode'] = in_array($mode, ['flight', 'docked', 'landed', 'warp'], true)
                ? $mode : 'flight';
        }
        $wasHosting = $peer['hosting'];
        $peer['hosting'] = $hosting;
        $peer['moved'] = true;
        if ($hosting) {
            $this->meter($peer, $msg, $now, $wasSys, $was);
        }

        // Сам пилот.
        $peer['me'] = self::person($msg['me'] ?? null);
        $peer['aboard'] = $peer['me'] !== null && $peer['me']['st'] !== 'out' ? $peer['me']['s'] : null;

        // Пропал из системы — говорим об этом СРАЗУ, а не ждём, пока
        // сосед сам забудет по истечении срока. Пропасть можно тремя
        // способами: уйти в другую систему, уйти в прыжок и перестать
        // вести корабль (пересел, улетел пассажиром) — корабль тогда
        // заснёт, и его покажет база.
        if ($wasSys !== null) {
            if ($wasSys !== $peer['sys']) {
                $this->broadcast($wasSys, ['t' => 'leave', 'id' => $peer['player'],
                    'ship' => $wasHosting ? $peer['ship'] : null], $peer['player']);
            } elseif ($wasHere && ($peer['hosting'] ? self::between($peer) : true)) {
                $this->broadcast($wasSys, ['t' => 'leave', 'id' => null, 'ship' => $peer['ship']],
                    $peer['player']);
            }
            if ($wasHosting !== $peer['hosting'] || $wasSys !== $peer['sys']) {
                $this->forgetDorm($wasSys);
            }
        }
        // Смена системы видна в списке пилотов у ВСЕХ: ради этого список
        // и нужен — видеть, кто куда ушёл.
        if ($wasSys !== $peer['sys']) {
            $this->sendRoster();
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
        // В игре — и вернулся вовремя, если уходил: его пассажиры остаются.
        Db::update('player', ['online' => 1], '`id`=?', [$playerId]);
        unset($this->gone[$playerId]);
        $this->awaitOwner($playerId, $now);

        $this->send($conn, [
            't' => 'welcome',
            'you' => ['id' => $playerId, 'name' => $peer['name'], 'sys' => $peer['sys'],
                'ship' => $peer['ship']],
            'tick' => self::TICK,
            'wt' => Clock::worldTime(),
            'peers' => $this->shipsOf($peer, $now),
            'people' => $this->peopleOf($peer),
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
     *
     * Цель — КОРАБЛЬ, и только тот, что ведут: в спящий не стреляют — его
     * нет ни в чьих прицелах, он стоит на грунте без хозяина.
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
        $shipId = (int) ($msg['id'] ?? 0);
        $code = (string) ($msg['w'] ?? '');
        if ($shipId <= 0 || $shipId === $peer['ship'] || $code === '') {
            return;
        }

        // В прыжке не стреляют. Стрелок между системами — это тот же
        // корабль, которого в системе нет: его самого не видно и не
        // достать, и попаданий от него быть не может.
        if (self::between($peer) || !$peer['hosting']) {
            return;
        }

        // Цель должна быть В СЕТИ И В ЭТОЙ ЖЕ СИСТЕМЕ: по кораблю,
        // которого здесь нет, попасть нельзя ничем.
        //
        // «Здесь нет» — это и ушедший в прыжок. Проверка повторяет ту,
        // что уже спрятала его из снимка, и повторяет НАМЕРЕННО: у
        // стрелка список соседей мог остаться с прошлой секунды, и
        // выстрел по исчезнувшему приходит на сервер как обычный.
        $victim = null;
        foreach ($this->peers as $p) {
            if ($p['player'] !== null && $p['hosting'] && $p['ship'] === $shipId
                && $p['sys'] === $peer['sys'] && !self::between($p)) {
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
        $res = Combat::damage($shipId, (float) $gun['damage']);

        // Кэш жертвы обновляем сразу: её корпус и щит рисуются у метки в
        // чужих приборах, и ждать перечитывания из базы там нечего.
        foreach ($this->peers as $k => $p) {
            if ($p['ship'] === $shipId) {
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
            't' => 'hitok', 'id' => $shipId,
            'hull' => $res['hull'], 'max' => $res['max'],
            'shield' => $res['shield'], 'smax' => $res['smax'],
            'absorbed' => $res['absorbed'], 'dead' => $res['dead'],
        ]);

        if ($res['dead']) {
            $this->wreck($shipId, $victim['sys'], $now);
            $this->say('уничтожен корабль ' . $victim['name'] . ' (огнём ' . $peer['name'] . ')');
        }
    }

    /**
     * Корабль уничтожен: страховка возвращает его в порт (Combat::
     * respawnShip), а всем рядом — весть о гибели. Её получают и те, кто
     * был на борту: их игра заберёт новое место у сервера.
     */
    private function wreck(int $shipId, ?int $sys, float $now): void
    {
        Combat::respawnShip($shipId);
        foreach ($this->peers as $k => $p) {
            if ($p['ship'] === $shipId) {
                $this->loadStats($this->peers[$k], $now, true);
            }
        }
        foreach ($this->peers as $p) {
            if ($p['player'] === null) {
                continue;
            }
            if (($sys !== null && $p['sys'] === $sys) || $p['aboard'] === $shipId) {
                $this->send($p['conn'], ['t' => 'boom', 'id' => $shipId]);
            }
        }
        if ($sys !== null) {
            $this->forgetDorm($sys);
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
        $peer['hull'] = $res['hull'];
        $peer['hullMax'] = $res['max'];

        $this->send($conn, [
            't' => 'impact', 'hull' => $res['hull'], 'max' => $res['max'],
            'dmg' => $res['damage'], 'dead' => $res['dead'],
        ]);

        if ($res['dead'] && $peer['ship'] !== null) {
            $this->wreck((int) $peer['ship'], $peer['sys'], $now);
            $this->say('разбился ' . $peer['name']);
        }
    }

    /**
     * Люк ЧУЖОГО корабля.
     *
     * Свой корабль игра водит сама, и люки у него открывает сама. Чужой —
     * нет: его ведёт другая игра (тогда просьба уходит ей, и она решает,
     * можно ли, — у неё напор воздуха и прыжок), или никто (корабль спит,
     * и люк переставляет хаб прямо в базе).
     *
     * Просить можно только стоя рядом: на его борту или на грунте у
     * трапа, в пределах Players::BOARD_KM. Открывать чужие люки из другого
     * конца системы — это уже не «постучался», а взлом.
     */
    private function hatch($conn, array &$peer, array $msg, float $now): void
    {
        if ($peer['player'] === null || $now - $peer['hatchAt'] < 1.0 / self::HATCH_RATE) {
            return;
        }
        $shipId = (int) ($msg['ship'] ?? 0);
        $hid = (string) ($msg['id'] ?? '');
        if ($shipId <= 0 || !preg_match('/^[A-Za-z0-9_]{1,12}$/', $hid)) {
            return;
        }
        $open = !empty($msg['open']);
        $peer['hatchAt'] = $now;
        $me = $peer['me'];

        // Ведёт ли этот корабль кто-то в игре.
        foreach ($this->peers as $p) {
            if ($p['player'] === null || !$p['hosting'] || $p['ship'] !== $shipId) {
                continue;
            }
            if ($p['player'] === $peer['player']) {
                return;                          // свой — игра открывает сама
            }
            $at = $p['local'] !== null
                ? ['body' => $p['local']['b'], 'p' => [$p['local']['lx'], $p['local']['ly'], $p['local']['lz']]]
                : null;
            if ($p['sys'] !== $peer['sys'] || !self::beside($me, $shipId, $at)) {
                return;
            }
            $this->send($p['conn'], ['t' => 'hatchreq', 'ship' => $shipId, 'id' => $hid,
                'open' => $open, 'by' => $peer['player'], 'name' => $peer['name']]);
            return;
        }

        // Без водителя — люк переставляем в базе. Если хозяин в игре:
        // корабля ушедшего нет в мире, и стучаться не во что.
        $row = Players::shipRow($shipId);
        if ($row === null || $row['system_id'] === null || (int) $row['system_id'] !== $peer['sys']
            || !$this->connected((int) $row['owner_id'])) {
            return;
        }
        if (!self::beside($me, $shipId, Players::shipPoint($row))) {
            return;
        }
        $list = array_values(array_diff(Players::hatchesOf($row), [$hid]));
        if ($open) {
            $list[] = $hid;
        }
        Db::update('ship', ['hatches' => Players::hatchList($list)], '`id`=?', [$shipId]);
        $this->forgetDorm((int) $row['system_id']);
    }

    /** Рядом ли пилот с кораблём: на его борту или на грунте у него. */
    private static function beside(?array $me, int $shipId, ?array $at): bool
    {
        if ($me === null) {
            return false;
        }
        if ($me['st'] !== 'out') {
            return $me['s'] === $shipId;
        }
        if ($at === null || $me['b'] !== $at['body']) {
            return false;
        }
        $d = sqrt(($me['lx'] - $at['p'][0]) ** 2 + ($me['ly'] - $at['p'][1]) ** 2
            + ($me['lz'] - $at['p'][2]) ** 2);
        return $d <= Players::BOARD_KM;
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
        $this->strandGone($now);
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
                $peer = $this->peers[$key];
            }
            $this->send($peer['conn'], ['t' => 'peers', 'list' => $this->shipsOf($peer, $now),
                'people' => $this->peopleOf($peer), 'wt' => $wt]);
            $sent++;
        }
        return $sent;
    }

    /**
     * Перечитать корпус и щит пилота из базы.
     *
     * Нужно не только при входе: корпус чинят в порту, и без обновления
     * сосед ещё десять минут висел бы битым в чужих приборах. И не только
     * корпус: пилот мог пересесть в другой свой корабль (Players::command).
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
             FROM `player` p JOIN `ship` s ON s.`id` = p.`ship_id`
             JOIN `ship_type` t ON t.`id` = s.`type_id`
             WHERE p.`id`=? AND s.`owner_id`=p.`id`',
            [$peer['player']]
        );
        if ($row === null) {
            return;
        }
        $id = (int) $row['id'];
        if ($peer['ship'] !== null && $peer['ship'] !== $id) {
            // Пересел: накопленный расход — прежнему кораблю, и счётчики
            // сопел начинаются заново.
            $this->flushFuel($peer, $now, false);
            $peer['pend'] = 0.0;
            $peer['work'] = null;
            $peer['qOk'] = false;
            $peer['guns'] = [];
        }
        // Хаб — отдельный процесс, и память модулей (Loadout) у него своя:
        // верфь меняет их запросом в другом процессе, и без этого хаб до
        // перезапуска считал бы щит и расход по снятому модулю.
        $peer['ship'] = $id;
        Loadout::forget($id);
        // Щит соседа — с его модуля: у двоих на одинаковых корпусах щиты
        // могут быть разные, и в приборах это должно быть видно.
        $row += Loadout::shield($id);
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
        $peer['fm'] = Fuel::model($id);
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
     * Корабль МЕЖДУ СИСТЕМАМИ: ушёл в варп-прыжок.
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

    /**
     * Вошедший стоит на борту чужого корабля, а хозяина нет: ждём и его
     * GRACE (вдруг оба переподключаются после перезапуска сервера), не
     * дождёмся — strand вернёт пассажира к себе.
     */
    private function awaitOwner(int $playerId, float $now): void
    {
        $owner = Db::one('SELECT s.`owner_id` FROM `player` p JOIN `ship` s ON s.`id` = p.`aboard_ship`
                          WHERE p.`id`=?', [$playerId]);
        if ($owner === null) {
            return;
        }
        $owner = (int) $owner;
        if ($owner !== $playerId && !$this->connected($owner) && !isset($this->gone[$owner])) {
            $this->gone[$owner] = $now;
        }
    }

    /** Ушедшие, которых не дождались: из игры — и их пассажиров по домам. */
    private function strandGone(float $now): void
    {
        foreach ($this->gone as $owner => $since) {
            if ($now - $since < self::GRACE) {
                continue;
            }
            unset($this->gone[$owner]);
            if ($this->connected($owner)) {
                continue;
            }
            Db::update('player', ['online' => 0], '`id`=?', [$owner]);
            $this->strand($owner);
        }
    }

    /**
     * Хозяин ушёл из игры, и его корабли пропали из мира, — тем, кто на
     * их борту, оставаться негде: стоять на палубе, которой ни для кого
     * нет, значит висеть в пустоте у всех на глазах. Каждый — в кресло
     * своего корабля (Players::sendHome).
     *
     * Где сейчас тот, кто в игре, решает ЕГО снимок, а не база: сохранение
     * идёт раз в восемь секунд, и сошедший по трапу по базе ещё на борту.
     * Где тот, кого нет (или кто ещё не прислал снимка), — по базе.
     */
    private function strand(int $owner): void
    {
        $ships = array_map('intval', array_column(
            Db::all('SELECT `id` FROM `ship` WHERE `owner_id`=?', [$owner]), 'id'));
        if (!$ships) {
            return;
        }
        $mine = array_flip($ships);
        $live = [];
        foreach ($this->peers as $k => $p) {
            if ($p['player'] === null || $p['player'] === $owner || $p['me'] === null) {
                continue;
            }
            $live[$p['player']] = true;
            if ($p['aboard'] !== null && isset($mine[$p['aboard']])) {
                $this->takeHome($k, $p['aboard'], $owner);
            }
        }
        foreach (Db::all('SELECT `id`, `aboard_ship` FROM `player`
                          WHERE `aboard_ship` IN (' . implode(',', $ships) . ') AND `id`<>?', [$owner]) as $r) {
            $pid = (int) $r['id'];
            if (isset($live[$pid])) {
                continue;
            }
            $k = $this->peerOf($pid);
            if ($k !== null) {
                $this->takeHome($k, (int) $r['aboard_ship'], $owner);
            } else {
                Players::sendHome($pid);
            }
        }
    }

    /** Пассажира в игре — на свой корабль, и сказать ему об этом. */
    private function takeHome($key, int $shipId, int $owner): void
    {
        $p = $this->peers[$key];
        $home = Players::sendHome((int) $p['player']);
        // До его следующего снимка он не стоит нигде: на чужой палубе его
        // больше не показываем.
        $this->peers[$key]['me'] = null;
        $this->peers[$key]['aboard'] = null;
        $this->send($p['conn'], ['t' => 'home', 'ship' => $shipId, 'by' => $owner, 'home' => $home]);
        $this->say($p['name'] . ' — на свой корабль: хозяин ушёл');
    }

    /**
     * Корабли, которые видит этот пилот.
     *
     * Ведомые — свои системы и не в прыжке. И один всегда, где бы он ни
     * был, — тот, на борту которого пилот едет пассажиром: в прыжке его
     * не видит никто, кроме тех, кто внутри, а им без него нечем даже
     * нарисовать стены вокруг себя.
     *
     * Без водителя — из базы, кроме тех, что сейчас кто-то ведёт, и
     * только тех, чей хозяин в игре.
     */
    private function shipsOf(array $me, float $now): array
    {
        $out = [];
        $hosted = [];
        $online = [];
        foreach ($this->peers as $p) {
            if ($p['player'] === null) {
                continue;
            }
            $online[$p['player']] = true;
            if (!$p['hosting'] || $p['ship'] === null) {
                continue;
            }
            $hosted[$p['ship']] = true;
            if ($p['player'] === $me['player']) {
                continue;
            }
            $ride = $me['aboard'] !== null && $me['aboard'] === $p['ship'];
            // Система обязана совпасть. Пилот в другой системе не просто
            // далеко — его там физически нет. Как и ушедший в прыжок: он
            // уже не здесь, хотя координаты прислал здешние.
            if (!$ride && ($me['sys'] === null || $p['sys'] !== $me['sys'] || self::between($p))) {
                continue;
            }
            $row = [
                'id' => $p['ship'],
                'by' => $p['player'],
                'name' => $p['name'],
                'x' => $p['x'], 'y' => $p['y'], 'z' => $p['z'],
                'v' => $p['v'],
                'fx' => $p['fx'], 'fy' => $p['fy'], 'fz' => $p['fz'],
                'ux' => $p['ux'], 'uy' => $p['uy'], 'uz' => $p['uz'],
                'hull' => round($p['hull'], 1), 'hmax' => $p['hullMax'],
                'sh' => round(self::shieldOf($p, $now), 1), 'smax' => $p['shieldMax'],
                'mode' => $p['mode'],
                'sys' => $p['sys'],
                'g' => $p['g'], 'h' => $p['h'], 'k' => $p['k'],
                // Кто в кресле: хозяин, если сидит в нём.
                'pilot' => $p['me'] !== null && $p['me']['st'] === 'seat' && $p['me']['s'] === $p['ship']
                    ? $p['player'] : null,
            ];
            if ($p['local'] !== null) {
                $row += $p['local'];
            }
            $out[] = $row;
        }
        if ($me['sys'] !== null) {
            foreach ($this->dormOf($me['sys'], $now) as $d) {
                // Свой корабль, которым пилот командует, ему из базы не нужен:
                // его игра ведёт сама (или вот-вот поведёт). Корабль того,
                // кого нет в игре, не нужен никому.
                if (isset($online[$d['by']]) && !isset($hosted[$d['id']]) && $d['id'] !== $me['ship']) {
                    $out[] = $d;
                }
            }
        }
        return $out;
    }

    /**
     * Люди, которых видит этот пилот: в его системе — и все, кто едет на
     * одном с ним борту, где бы тот ни был.
     */
    private function peopleOf(array $me): array
    {
        $out = [];
        foreach ($this->peers as $p) {
            if ($p['player'] === null || $p['player'] === $me['player'] || $p['me'] === null) {
                continue;
            }
            $ride = $me['aboard'] !== null && $p['aboard'] === $me['aboard'];
            if (!$ride && ($me['sys'] === null || $p['sys'] !== $me['sys'])) {
                continue;
            }
            $out[] = ['id' => $p['player'], 'name' => $p['name']] + $p['me'];
        }
        return $out;
    }

    /**
     * Корабли системы без водителя: из базы, раз в DORM_EVERY. Все —
     * кто из хозяев в игре, решает shipsOf на каждый снимок.
     *
     * В порту спящих не показываем: корабль в доке стоит внутри станции,
     * рисовать его снаружи некуда.
     */
    private function dormOf(int $sys, float $now): array
    {
        $c = $this->dorm[$sys] ?? null;
        if ($c !== null && $now - $c['at'] < self::DORM_EVERY) {
            return $c['list'];
        }
        $list = [];
        foreach (Db::all(
            'SELECT s.*, t.`hull_max`, p.`name` AS `owner_name`, p.`login` AS `owner_login`
             FROM `ship` s JOIN `ship_type` t ON t.`id` = s.`type_id`
             JOIN `player` p ON p.`id` = s.`owner_id`
             WHERE s.`system_id`=? AND s.`docked_body` IS NULL',
            [$sys]
        ) as $r) {
            $row = [
                'id' => (int) $r['id'],
                'by' => (int) $r['owner_id'],
                'name' => (string) ($r['owner_name'] ?: $r['owner_login']),
                'dorm' => 1,
                'mode' => $r['landed_body'] !== null ? 'landed' : 'flight',
                'sys' => $sys,
                'v' => 0.0,
                'hull' => round((float) $r['hull'], 1), 'hmax' => (float) $r['hull_max'],
                'sh' => 0.0, 'smax' => 0.0,
                'g' => (int) $r['gear_out'] || $r['landed_body'] !== null ? 1 : 0,
                'h' => Players::hatchesOf($r),
                'k' => 0.0,
                'pilot' => null,
            ];
            $pose = $r['landed_body'] !== null ? json_decode((string) $r['landed_pose'], true) : null;
            $anchor = $r['anchor_body'] !== null ? json_decode((string) $r['anchor_pose'], true) : null;
            if (is_array($pose) && is_array($pose['dir'] ?? null) && is_numeric($pose['radius'] ?? null)
                && is_array($pose['fwd'] ?? null) && is_array($pose['up'] ?? null)) {
                $rad = (float) $pose['radius'];
                $row += ['b' => (int) $r['landed_body'],
                    'lx' => self::num($pose['dir']['x'] ?? 0) * $rad,
                    'ly' => self::num($pose['dir']['y'] ?? 0) * $rad,
                    'lz' => self::num($pose['dir']['z'] ?? 0) * $rad]
                    + self::axes($pose['fwd'], $pose['up']);
            } elseif (is_array($anchor) && is_array($anchor['pos'] ?? null)) {
                $row += ['b' => (int) $r['anchor_body'],
                    'lx' => self::num($anchor['pos']['x'] ?? 0), 'ly' => self::num($anchor['pos']['y'] ?? 0),
                    'lz' => self::num($anchor['pos']['z'] ?? 0)]
                    + self::axes($anchor['fwd'] ?? null, $anchor['up'] ?? null);
            } else {
                $basis = json_decode((string) $r['basis'], true);
                $row += ['x' => (float) $r['pos_x'], 'y' => (float) $r['pos_y'], 'z' => (float) $r['pos_z'],
                    'fx' => self::num($basis['fwd']['x'] ?? 0), 'fy' => self::num($basis['fwd']['y'] ?? 0),
                    'fz' => self::num($basis['fwd']['z'] ?? 1),
                    'ux' => self::num($basis['up']['x'] ?? 0), 'uy' => self::num($basis['up']['y'] ?? 1),
                    'uz' => self::num($basis['up']['z'] ?? 0)];
            }
            $list[] = $row;
        }
        $this->dorm[$sys] = ['at' => $now, 'list' => $list];
        return $list;
    }

    private static function axes($f, $u): array
    {
        return [
            'lfx' => self::num($f['x'] ?? 0), 'lfy' => self::num($f['y'] ?? 0), 'lfz' => self::num($f['z'] ?? 1),
            'lux' => self::num($u['x'] ?? 0), 'luy' => self::num($u['y'] ?? 1), 'luz' => self::num($u['z'] ?? 0),
        ];
    }

    /** Корабли без водителя этой системы — перечитать при следующем снимке. */
    private function forgetDorm(int $sys): void
    {
        unset($this->dorm[$sys]);
    }

    /**
     * Где пилот сам — из снимка, поштучно и в пределах.
     *
     * Всё это пересылается соседям как есть, а приходит с чужой машины:
     * строку на месте числа или палубу в километр длиной пропускать
     * дальше нельзя.
     */
    private static function person($v): ?array
    {
        if (!is_array($v)) {
            return null;
        }
        $st = (string) ($v['st'] ?? '');
        if (!in_array($st, ['seat', 'walk', 'out'], true)) {
            return null;
        }
        $out = [
            'st' => $st,
            'yaw' => self::clamp(self::num($v['yaw'] ?? 0), -10, 10),
            'pitch' => self::clamp(self::num($v['pitch'] ?? 0), -1.6, 1.6),
            'v' => self::clamp(self::num($v['v'] ?? 0), 0, 20),
            'air' => !empty($v['air']) ? 1 : 0,
        ];
        if ($st === 'out') {
            if (!isset($v['b']) || !is_numeric($v['b'])) {
                return null;
            }
            $out += ['s' => null, 'b' => (int) $v['b'],
                'lx' => self::num($v['lx'] ?? 0), 'ly' => self::num($v['ly'] ?? 0), 'lz' => self::num($v['lz'] ?? 0),
                'lfx' => self::num($v['lfx'] ?? 0), 'lfy' => self::num($v['lfy'] ?? 0),
                'lfz' => self::num($v['lfz'] ?? 1)];
            return $out;
        }
        if (!isset($v['s']) || !is_numeric($v['s'])) {
            return null;
        }
        $deck = static fn($x) => self::clamp(self::num($x), -self::DECK_M, self::DECK_M);
        $out += ['s' => (int) $v['s'], 'x' => $deck($v['x'] ?? 0), 'y' => $deck($v['y'] ?? 0),
            'z' => $deck($v['z'] ?? 0)];
        return $out;
    }

    /** Открытые люки из снимка: имена, не больше восьми. */
    private static function hatchNames($v): array
    {
        $out = [];
        if (!is_array($v)) {
            return $out;
        }
        foreach ($v as $h) {
            if (is_string($h) && preg_match('/^[A-Za-z0-9_]{1,12}$/', $h)) {
                $out[] = $h;
            }
            if (count($out) >= 8) {
                break;
            }
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

    private static function clamp(float $v, float $lo, float $hi): float
    {
        return max($lo, min($hi, $v));
    }

    private function say(string $line): void
    {
        if ($this->log !== null) {
            ($this->log)($line);
        }
    }
}
