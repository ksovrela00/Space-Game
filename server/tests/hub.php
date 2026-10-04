<?php
/**
 * Проверки хаба: кто кого видит в сокете.
 *
 *   php server/tests/hub.php
 *
 * Без единого настоящего сокета. Хаб работает с объектами, умеющими
 * send() и close(), — здесь ими служат поддельные соединения, которые
 * просто копят отправленное. Настоящую сеть проверять нечем и незачем:
 * её поведение — это поведение Ratchet, а не наше, а вот «пилот чужой
 * системы не виден» и «вышедший пропал» — ровно наше и ломается молча.
 */

putenv('SOLAR_DB=solar_trader_test');
require_once __DIR__ . '/../boot.php';

$fails = 0;
$checks = 0;
function ok(bool $cond, string $msg): void
{
    global $fails, $checks;
    $checks++;
    if (!$cond) {
        $fails++;
    }
    echo ($cond ? '  OK   ' : '  FAIL ') . $msg . PHP_EOL;
}

/** Поддельное соединение: копит отправленное, помнит, закрыли ли его. */
final class FakeConn
{
    public array $sent = [];
    public bool $closed = false;
    public function __construct(public string $resourceId)
    {
    }
    public function send($text): void
    {
        $this->sent[] = json_decode((string) $text, true);
    }
    public function close(): void
    {
        $this->closed = true;
    }
    /** Последнее сообщение данного вида. */
    public function last(?string $type = null): ?array
    {
        for ($i = count($this->sent) - 1; $i >= 0; $i--) {
            if ($type === null || ($this->sent[$i]['t'] ?? '') === $type) {
                return $this->sent[$i];
            }
        }
        return null;
    }
    public function has(string $type): bool
    {
        return $this->last($type) !== null;
    }
}

echo PHP_EOL . '== сокет: присутствие ==' . PHP_EOL;

// --- база под проверку --------------------------------------------------------

Db::use(Schema::ensureDatabase('solar_trader_test'));
if (Db::one("SELECT COUNT(*) FROM information_schema.tables
             WHERE table_schema='solar_trader_test' AND table_name='player'") == 0) {
    Schema::reset();
    Seeder::all(Seeder::readCatalog(__DIR__ . '/../data/catalog.json'), true);
}
// Каталог в проверочной базе может быть старше кода: оружие завелось
// позже самой базы, и без него проверять бой нечем.
if ((int) Db::one("SELECT COUNT(*) FROM `equipment_type` WHERE `slot`='gun'") === 0) {
    Seeder::all(Seeder::readCatalog(__DIR__ . '/../data/catalog.json'), true);
}
// И топливо: масса корпуса и модули бака завелись позже (схема 9).
Schema::migrate();
if ((float) Db::one("SELECT MAX(`mass_t`) FROM `ship_type`") <= 0
    || Db::one("SELECT `id` FROM `equipment_type` WHERE `code`='tank_x'") === null) {
    Seeder::all(Seeder::readCatalog(__DIR__ . '/../data/catalog.json'), true);
}

Db::run('DELETE FROM `player`');

$a = Auth::register('alfa', 'secret', 'АЛЬФА');
$b = Auth::register('beta', 'secret', 'БЕТА');
// Попадают в КОРАБЛЬ, а не в пилота: цель в сокете — номер корабля.
$shipA = (int) Players::ship($a['player_id'])['id'];
$shipB = (int) Players::ship($b['player_id'])['id'];

$hub = new Hub();
$t = 1000.0;

// --- вход ---------------------------------------------------------------------

$ca = new FakeConn('a');
$hub->open($ca, $t);
ok($hub->count() === 1 && $ca->sent === [], 'соединение открыто, но молчит до hello');

// Положение до входа не принимается: иначе светиться в чужой системе
// сможет кто угодно без учётной записи.
$hub->message($ca, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 1]), $t);
ok(($ca->last('error')['code'] ?? '') === 'auth', 'до hello положение не принимается');

$hub->message($ca, json_encode(['t' => 'hello', 'token' => str_repeat('f', 64)]), $t);
ok(($ca->last('error')['code'] ?? '') === 'auth' && $ca->closed,
    'чужой токен не пускает и соединение закрывается');

$ca = new FakeConn('a2');
$hub->open($ca, $t);
$hub->message($ca, json_encode(['t' => 'hello', 'token' => $a['token']]), $t);
$welcome = $ca->last('welcome');
ok($welcome !== null && $welcome['you']['name'] === 'АЛЬФА' && $welcome['peers'] === [],
    'вход принят, в системе пока никого');

// --- двое в одной системе -----------------------------------------------------

$cb = new FakeConn('b');
$hub->open($cb, $t);
$hub->message($cb, json_encode(['t' => 'hello', 'token' => $b['token']]), $t);

$t += 1;
$hub->message($ca, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 100, 'y' => 0, 'z' => 0, 'v' => 0.5]), $t);
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 200, 'y' => 0, 'z' => 0, 'v' => 0.1]), $t);
$hub->tick($t);

$listA = $ca->last('peers')['list'] ?? [];
$listB = $cb->last('peers')['list'] ?? [];
ok(count($listA) === 1 && $listA[0]['name'] === 'БЕТА' && abs($listA[0]['x'] - 200) < 1e-9,
    'в своей системе виден сосед и его место');
ok(count($listB) === 1 && $listB[0]['name'] === 'АЛЬФА', 'и он видит первого');
ok(!in_array('АЛЬФА', array_column($listA, 'name'), true), 'сам себя пилот в списке не видит');

// --- осанка корабля -----------------------------------------------------------
//
// Сервер ориентацию только пересылает, но если он её потеряет, чужой
// корабль на экране развернёт куда попало, а виноват будет клиент.

// Оба предыдущих сообщения шли без осанки — и всё равно она осмысленная:
// показать пилота боком хуже, чем показать наугад вперёд.
ok(abs(($listA[0]['fz'] ?? 0) - 1) < 1e-9 && abs(($listA[0]['uy'] ?? 0) - 1) < 1e-9,
    'пилот, не приславший осанку, смотрит вперёд, а не в никуда');

$t += 1;
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 200,
    'fx' => 1, 'fy' => 0, 'fz' => 0, 'ux' => 0, 'uy' => 0, 'uz' => 1]), $t);
$hub->tick($t);
$seen = ($ca->last('peers')['list'] ?? [])[0] ?? [];
ok(abs(($seen['fx'] ?? 0) - 1) < 1e-9 && abs(($seen['uz'] ?? 0) - 1) < 1e-9,
    'куда смотрит чужой корабль и где у него верх — доходит до соседа');
// Тип корпуса — в каждом снимке: соседа рисуют его корпусом, а не своим
// (js/game/peers.js, ty). Сейчас у обоих «Челленджер».
ok(($seen['ty'] ?? null) === 'challenger', 'тип корпуса соседа доходит до соседа: ' . ($seen['ty'] ?? '—'));

// Мусор вместо чисел не должен пролезть: NaN в матрице гасит корабль.
$t += 1;
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 200,
    'fx' => 'вбок', 'fy' => null, 'fz' => 'туда']), $t);
$hub->tick($t);
$junk = ($ca->last('peers')['list'] ?? [])[0] ?? [];
// После JSON нулевой float приезжает целым числом, поэтому спрашиваем не
// тип, а суть: это число, оно конечно, и оно ноль — а не слово 'вбок'.
ok(is_numeric($junk['fx'] ?? null) && is_numeric($junk['fz'] ?? null)
    && (float) $junk['fx'] === 0.0 && (float) $junk['fz'] === 0.0,
    'нечисловая осанка заменяется числом, а не пересылается как есть');

// --- время мира ---------------------------------------------------------------
//
// Часы мира идут в каждом снимке, а не только при входе: вкладка в фоне
// не получает кадров, её часы отстают, и без поправки вернувшийся пилот
// увидит станцию не там, где остальные.

$hub->tick($t);
$snap = $ca->last('peers');
ok(isset($snap['wt']) && is_numeric($snap['wt']) && abs($snap['wt'] - Clock::worldTime()) < 2,
    'в каждом снимке идёт время мира: ' . ($snap['wt'] ?? '—'));
ok(isset($welcome['wt']) && is_numeric($welcome['wt']),
    'и при входе оно приходит сразу, до первого снимка');

// --- разные системы -----------------------------------------------------------

$t += 1;
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 3, 'x' => 0, 'y' => 0, 'z' => 0]), $t);
$hub->tick($t);
ok(($ca->last('peers')['list'] ?? []) === [], 'пилот из другой системы не виден вовсе');
ok(($cb->last('peers')['list'] ?? []) === [], 'и наоборот');


// --- частота ------------------------------------------------------------------

$t += 1;
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 10]), $t);
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 999]), $t + 0.001);
$hub->tick($t + 0.002);
$listA = $ca->last('peers')['list'] ?? [];
ok(count($listA) === 1 && abs($listA[0]['x'] - 10) < 1e-9,
    'слишком частые обновления отбрасываются: x = ' . ($listA[0]['x'] ?? '—'));

// --- бой ----------------------------------------------------------------------
//
// Что сервер может проверить, а что нет, расписано в Combat. Здесь
// проверяется ровно то, что он взялся проверять: оружие на борту,
// дальность, темп и сам урон. Физики болта на сервере нет, и делать вид,
// что она есть, эти проверки не пытаются.

// Ставим обоих рядом: в километре друг от друга и в одной системе.
$t += 1;
$hub->message($ca, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 0, 'y' => 0, 'z' => 0]), $t);
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 1, 'y' => 0, 'z' => 0]), $t);
$hub->tick($t);

// Выстрел — это картинка: он доходит до соседа как есть.
$t += 1;
$hub->message($ca, json_encode(['t' => 'shot', 'w' => 'laser_g',
    'x' => 0, 'y' => 0, 'z' => 0, 'dx' => 1, 'dy' => 0, 'dz' => 0]), $t);
$shot = $cb->last('shot');
ok($shot !== null && $shot['by'] === $a['player_id'] && abs($shot['dx'] - 1) < 1e-9,
    'выстрел виден соседу: от кого и куда');

$hullOf = static function (int $playerId): float {
    return (float) Db::one('SELECT `hull` FROM `ship` WHERE `owner_id`=?', [$playerId]);
};
$shieldOf = static function (int $playerId): float {
    // Числа щита — у МОДУЛЯ, стоящего на этом корабле, а не у типа
    // корпуса: у двоих на одинаковых корпусах щиты бывают разные.
    $row = Db::row('SELECT `id`, `shield`, `hit_at` FROM `ship` WHERE `owner_id`=?', [$playerId]);
    return Combat::shieldNow($row + Loadout::shield((int) $row['id']));
};
$before = $hullOf($b['player_id']);

// Первым принимает ЩИТ, и корпус при этом цел. В этом весь его смысл:
// щит отрастает сам, а корпус чинят за деньги.
$t += 1;
$hub->message($ca, json_encode(['t' => 'hit', 'id' => $shipB, 'w' => 'laser_g']), $t);
$hurt = $cb->last('hurt');
$okShot = $ca->last('hitok');
ok(abs($hullOf($b['player_id']) - $before) < 1e-9 && $shieldOf($b['player_id']) < 40,
    'первым урон принимает щит, корпус цел: щит ' . $shieldOf($b['player_id']));
ok($hurt !== null && $hurt['by'] === $a['player_id'] && $hurt['absorbed'] > 0,
    'жертва знает, сколько принял щит: ' . ($hurt['absorbed'] ?? '—'));
ok($okShot !== null && $okShot['id'] === $shipB
    && abs($okShot['shield'] - $hurt['shield']) < 1e-9,
    'обе стороны видят одно и то же число щита');

// Щит пробит — дальше идёт корпус.
Db::update('ship', ['shield' => 0, 'hit_at' => Db::now()], '`owner_id`=?', [$b['player_id']]);
$t += 1;
$hub->message($ca, json_encode(['t' => 'hit', 'id' => $shipB, 'w' => 'laser_g']), $t);
$after = $hullOf($b['player_id']);
ok($after < $before, 'по пробитому щиту попадание снимает корпус: '
    . $before . ' -> ' . $after);
ok(abs(($cb->last('hurt')['hull'] ?? -1) - $after) < 1e-9,
    'жертва узнаёт свой корпус от сервера, а не считает его сама');

// Щит отрастает сам — без всякого фонового пересчёта: он считается от
// времени последнего попадания в тот момент, когда его спросили.
Db::update('ship', ['shield' => 0, 'hit_at' => Db::at(-600)], '`owner_id`=?', [$b['player_id']]);
ok(abs($shieldOf($b['player_id']) - 40) < 1e-9,
    'через десять минут тишины щит полон: ' . $shieldOf($b['player_id']));
Db::update('ship', ['shield' => 0, 'hit_at' => Db::now()], '`owner_id`=?', [$b['player_id']]);
ok($shieldOf($b['player_id']) < 1e-9, 'а сразу после попадания — нет');

// Темп: второе попадание в тот же миг не проходит. Иначе клиент с
// подкрученным циклом снимал бы корпус пачками.
$mid = $hullOf($b['player_id']);
$hub->message($ca, json_encode(['t' => 'hit', 'id' => $shipB, 'w' => 'laser_g']), $t);
ok(abs($hullOf($b['player_id']) - $mid) < 1e-9, 'попадания чаще оружейного темпа не принимаются');

// УДАР О ГРУНТ идёт тем же путём, что и бой, — сообщением в сокет. И по
// той же причине: корпус это счёт, а счёт ведёт сервер. Игра сообщает
// ИЗМЕРЕНИЕ (с какой скоростью коснулись, на шасси ли), а не урон и тем
// более не корпус.
Db::update('ship', ['hull' => 100], '`owner_id`=?', [$b['player_id']]);
$t += 1;
$hub->message($cb, json_encode(['t' => 'impact',
    'norm' => 0.050, 'slide' => 0, 'gear' => true, 'pose' => true]), $t);
$hitBack = $cb->last('impact');
$hullNow = $hullOf($b['player_id']);
ok($hitBack !== null && $hitBack['dmg'] > 5 && $hitBack['dmg'] < 20
    && abs($hullNow - (100 - $hitBack['dmg'])) < 1e-9,
    'удар о грунт списал корпус сервером: −' . round($hitBack['dmg'] ?? 0, 1)
    . '%, стало ' . round($hullNow, 1));

// Частить нельзя: подряд стучать по грунту чаще четырёх раз в секунду —
// это уже не посадка, а попытка залить хаб пакетами.
$hullBefore = $hullNow;
$hub->message($cb, json_encode(['t' => 'impact',
    'norm' => 0.050, 'slide' => 0, 'gear' => true, 'pose' => true]), $t);
ok(abs($hullOf($b['player_id']) - $hullBefore) < 1e-9,
    'второй удар в тот же миг отброшен: корпус ' . round($hullOf($b['player_id']), 1));

// Разбился — корабль восстановлен в порту, соседи видят вспышку.
$t += 1;
$hub->message($cb, json_encode(['t' => 'impact', 'fatal' => true]), $t);
$boom = $ca->last('boom');
ok(abs($hullOf($b['player_id']) - 100) < 1e-9 && $boom !== null
    && $boom['id'] === $shipB,
    'смертельный удар: корабль восстановлен в порту, соседи оповещены');

// Дальность: за её пределом попадания нет вовсе.
$t += 1;
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 50, 'y' => 0, 'z' => 0]), $t);
$hub->tick($t);
$far = $hullOf($b['player_id']);
$hub->message($ca, json_encode(['t' => 'hit', 'id' => $shipB, 'w' => 'laser_g']), $t);
ok(abs($hullOf($b['player_id']) - $far) < 1e-9, 'за 50 км лазером не достать');

// Оружия нет на борту — попадание отвергается словами, а не молча.
$t += 1;
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 1, 'y' => 0, 'z' => 0]), $t);
$hub->tick($t);
$hub->message($ca, json_encode(['t' => 'hit', 'id' => $shipB, 'w' => 'missile']), $t);
ok(($ca->last('error')['code'] ?? '') === 'no_gun', 'оружием, которого нет на борту, не попасть');

// Гибель: корпус в ноль, и пилот сразу возвращается в строй — в порт, из
// которого уходил. Экрана гибели у сервера нет и быть не может.
Db::update('ship', ['hull' => 2, 'shield' => 0, 'hit_at' => Db::now()],
    '`owner_id`=?', [$b['player_id']]);
Db::update('player', ['last_station' => 4], '`id`=?', [$b['player_id']]);
Db::update('ship', ['docked_body' => null], '`id`=?', [$shipB]);
$t += 1;
$hub->message($ca, json_encode(['t' => 'hit', 'id' => $shipB, 'w' => 'laser_g']), $t);
$dead = $cb->last('hurt');
$row = Db::row('SELECT s.`docked_body`, s.`hull`, t.`hull_max`, p.`crashes`
                FROM `player` p JOIN `ship` s ON s.`id`=p.`ship_id`
                JOIN `ship_type` t ON t.`id`=s.`type_id` WHERE p.`id`=?', [$b['player_id']]);
ok($dead !== null && $dead['dead'] === true, 'о гибели сказано прямо');
ok((int) $row['docked_body'] === 4 && abs((float) $row['hull'] - (float) $row['hull_max']) < 1e-9,
    'после гибели корабль целый и стоит в своём порту');
ok((int) $row['crashes'] > 0, 'гибель посчитана в статистике пилота');
ok(abs($shieldOf($b['player_id']) - 40) < 1e-9, 'и щит после гибели тоже целый');

// Корпус и щит соседа идут в каждом снимке: у его метки они и рисуются.
$t += 1;
$hub->tick($t);
$seenPeer = ($ca->last('peers')['list'] ?? [])[0] ?? [];
ok(isset($seenPeer['hull'], $seenPeer['hmax'], $seenPeer['sh'], $seenPeer['smax'])
    && $seenPeer['hmax'] > 0 && $seenPeer['smax'] > 0,
    'в снимке у соседа есть корпус и щит: '
    . ($seenPeer['hull'] ?? '—') . '/' . ($seenPeer['hmax'] ?? '—') . ' и '
    . ($seenPeer['sh'] ?? '—') . '/' . ($seenPeer['smax'] ?? '—'));


// Оружейные гнёзда: стоящее оружие бьёт из каждого гнезда корпуса в своём
// темпе (Combat::mounts, gunMounts в server/data/specs.php). У крейсера
// пять башен на крыше — и попадания от него принимаются впятеро чаще; у
// торговца с одной спаренной пушкой — по-прежнему не чаще восьми в
// секунду. Два попадания в один миг не проходят ни у кого.
$g = Auth::register('kreiser', 'secret', 'КРЕЙСЕР');
$shipG = (int) Players::ship($g['player_id'])['id'];
$promType = (int) Db::one('SELECT `id` FROM `ship_type` WHERE `code`=?', ['prometheus']);
Db::update('ship', ['type_id' => $promType], '`id`=?', [$shipG]);
ok(Combat::mounts($shipG) === 5 && Combat::mounts($shipA) === 1,
    'оружейных гнёзд у крейсера ' . Combat::mounts($shipG) . ', у торговца ' . Combat::mounts($shipA));
$cg = new FakeConn('g');
$hub->open($cg, $t);
$hub->message($cg, json_encode(['t' => 'hello', 'token' => $g['token']]), $t);
$t += 1;
$hub->message($cg, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 0, 'y' => 1, 'z' => 0]), $t);
$hub->message($ca, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 0, 'y' => 0, 'z' => 0]), $t);
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 1, 'y' => 0, 'z' => 0]), $t);
$hub->tick($t);
// Сколько из двух попаданий с промежутком $dt принято: по корпусу цели
// (щит снят, урон лазера — 3).
$landed = static function (FakeConn $conn, float $dt) use (&$t, $hub, $shipB, $b, $hullOf): int {
    Db::update('ship', ['hull' => 100, 'shield' => 0, 'hit_at' => Db::now()], '`owner_id`=?', [$b['player_id']]);
    $t += 1;
    $h0 = $hullOf($b['player_id']);
    $hub->message($conn, json_encode(['t' => 'hit', 'id' => $shipB, 'w' => 'laser_g']), $t);
    $hub->message($conn, json_encode(['t' => 'hit', 'id' => $shipB, 'w' => 'laser_g']), $t + $dt);
    return (int) round(($h0 - $hullOf($b['player_id'])) / (float) Combat::weapon('laser_g')['damage']);
};
$fromTrader = $landed($ca, 0.07);
$fromCruiser = $landed($cg, 0.07);
$sameInstant = $landed($cg, 0.0);
ok($fromTrader === 1 && $fromCruiser === 2 && $sameInstant === 1,
    "два попадания через 70 мс: от торговца принято $fromTrader, от крейсера с пятью гнёздами — $fromCruiser; "
    . "в один миг от крейсера — $sameInstant");
Db::update('ship', ['hull' => 100, 'shield' => 0], '`owner_id`=?', [$b['player_id']]);
$hub->close($cg, $t);

// --- прыжок: пилота между системами нет ---------------------------------------
//
// Игра ставит корабль к звезде НОВОЙ системы за несколько секунд до
// выхода из тоннеля (js/main.js, событие handover): координаты к этому
// моменту уже её, а пилот ещё в прыжке — он не видит ничего и ничего не
// может. Пока хаб раздавал его наравне со всеми, эти секунды были
// подарком тому, кто ждёт у звезды: цель видно, цель не отвечает.

$t += 1;
$hub->message($ca, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 0, 'y' => 0, 'z' => 0]), $t);
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 1, 'y' => 0, 'z' => 0]), $t);
$hub->tick($t);
ok(count($ca->last('peers')['list'] ?? []) === 1, 'до прыжка сосед виден');

// Ушёл в прыжок: координаты те же и система та же, но режим другой.
$t += 1;
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 1, 'y' => 0, 'z' => 0,
    'mode' => 'warp']), $t);
ok(($ca->last('leave')['ship'] ?? 0) === $shipB,
    'об уходе корабля в прыжок сказано сразу, а не по истечении срока');
$hub->tick($t);
ok(($ca->last('peers')['list'] ?? []) === [],
    'в прыжке пилота в снимке нет, хотя координаты он прислал здешние');

// И достать его нельзя. Стрелок при этом рядом и с оружием — отказ
// именно из-за прыжка, а не из-за дальности.
$hullWarp = $hullOf($b['player_id']);
Db::update('ship', ['shield' => 0, 'hit_at' => Db::now()], '`owner_id`=?', [$b['player_id']]);
$t += 1;
$hub->message($ca, json_encode(['t' => 'hit', 'id' => $shipB, 'w' => 'laser_g']), $t);
ok(abs($hullOf($b['player_id']) - $hullWarp) < 1e-9,
    'по ушедшему в прыжок попасть нельзя: корпус ' . round($hullOf($b['player_id']), 1));

// Из прыжка и сам не стреляет: ни картинкой, ни уроном.
$t += 1;
$before = count($ca->sent);
$hub->message($cb, json_encode(['t' => 'shot', 'w' => 'laser_g',
    'x' => 0, 'y' => 0, 'z' => 0, 'dx' => 1, 'dy' => 0, 'dz' => 0]), $t);
$shotSeen = false;
for ($i = $before; $i < count($ca->sent); $i++) {
    if (($ca->sent[$i]['t'] ?? '') === 'shot') {
        $shotSeen = true;
    }
}
ok(!$shotSeen, 'выстрел из прыжка соседям не показывают');

$hullA = $hullOf($a['player_id']);
Db::update('ship', ['shield' => 0, 'hit_at' => Db::now()], '`owner_id`=?', [$a['player_id']]);
$t += 1;
$hub->message($cb, json_encode(['t' => 'hit', 'id' => $shipA, 'w' => 'laser_g']), $t);
ok(abs($hullOf($a['player_id']) - $hullA) < 1e-9,
    'и попаданий из прыжка не бывает: корпус цели ' . round($hullOf($a['player_id']), 1));

// Вышел — и снова виден, без всякой повторной регистрации.
$t += 1;
$hub->message($cb, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 1, 'y' => 0, 'z' => 0,
    'mode' => 'flight']), $t);
$hub->tick($t);
ok(count($ca->last('peers')['list'] ?? []) === 1, 'вышел из прыжка — снова в снимке');

// --- уход ---------------------------------------------------------------------

$t += 1;
$hub->close($cb, $t);
$leave = $ca->last('leave');
ok($leave !== null && $leave['id'] === $b['player_id'], 'об уходе сообщают сразу, не дожидаясь тика');
$hub->tick($t);
ok(($ca->last('peers')['list'] ?? []) === [], 'ушедшего в списке больше нет');

// --- вторая вкладка -----------------------------------------------------------

$t += 1;
$ca2 = new FakeConn('a3');
$hub->open($ca2, $t);
$hub->message($ca2, json_encode(['t' => 'hello', 'token' => $a['token']]), $t);
ok($ca->closed && ($ca->last('error')['code'] ?? '') === 'replaced',
    'второй вход тем же пилотом выбивает первое окно');
ok($ca2->has('welcome'), 'новое окно при этом работает');

// --- мусор и молчуны ----------------------------------------------------------

$hub->message($ca2, 'не json вовсе', $t);
ok(($ca2->last('error')['code'] ?? '') === 'bad_message', 'мусорное сообщение отвергается');

$mute = new FakeConn('mute');
$hub->open($mute, $t);
$hub->tick($t + 1);
ok(!$mute->closed, 'молчуну дают время представиться');
$hub->tick($t + Hub::HELLO_TIMEOUT + 1);
ok($mute->closed, 'но не бесконечно: не представился — закрыли');

$hub->message($ca2, json_encode(['t' => 'ping']), $t);
ok($ca2->has('pong'), 'ping отвечает pong');

// --- состав сети ---------------------------------------------------------------
//
// Список пилотов (клавиша P) отвечает на другой вопрос, чем снимок
// соседей: не «кто рядом», а «кто вообще в игре и где его искать».
// Поэтому он идёт ВСЕМ и только при изменениях: вошёл, ушёл, сменил
// систему. Сцена здесь своя, с нуля: предыдущие разделы оставили
// соединения в каком угодно виде, а счёт рассылок требует чистоты.

$howMany = static function (FakeConn $c, string $type): int {
    return count(array_filter($c->sent, static fn ($m) => ($m['t'] ?? '') === $type));
};

// Свой хаб на этот раздел. Причина не в чистоте ради чистоты:
// в поддельных соединениях close() только ставит отметку, а из хаба
// их убирает Ratchet вызовом onClose — здесь его нет, и выбитые
// окна предыдущих разделов остались бы в составе сети.
$hub2 = new Hub();
$t += 10;
$r1 = new FakeConn('r1');
$hub2->open($r1, $t);
$hub2->message($r1, json_encode(['t' => 'hello', 'token' => $a['token']]), $t);
$hello1 = $r1->last('welcome');

$r2 = new FakeConn('r2');
$hub2->open($r2, $t);
$hub2->message($r2, json_encode(['t' => 'hello', 'token' => $b['token']]), $t);

$t += 1;
$hub2->message($r1, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 1, 'y' => 0, 'z' => 0]), $t);
$hub2->message($r2, json_encode(['t' => 'pos', 'sys' => 3, 'x' => 2, 'y' => 0, 'z' => 0]), $t);

$roster = $r1->last('roster')['list'] ?? [];
$where = array_column($roster, 'sys', 'name');
ok(count($roster) === 2 && ($where['АЛЬФА'] ?? null) === 0
    && ($where['БЕТА'] ?? null) === 3,
    'в составе сети видно, кто в какой системе: '
    . json_encode($where, JSON_UNESCAPED_UNICODE));
ok(isset($hello1['roster']) && count($hello1['roster']) === 1,
    'вошедший получает состав сразу, а не после чужого входа');

// Тик состав не повторяет — в этом вся его цена.
$was = $howMany($r1, 'roster');
$t += 1;
$hub2->tick($t);
$hub2->tick($t);
ok($howMany($r1, 'roster') === $was,
    'тик состав не повторяет: рассылок как было ' . $was . ', так и осталось');

// А перелёт в другую систему — повторяет: ради этого список и заведён.
$t += 1;
$hub2->message($r2, json_encode(['t' => 'pos', 'sys' => 5, 'x' => 0, 'y' => 0, 'z' => 0]), $t);
$moved = array_column($r1->last('roster')['list'] ?? [], 'sys', 'name');
ok($howMany($r1, 'roster') === $was + 1 && ($moved['БЕТА'] ?? null) === 5,
    'смена системы видна в списке у остальных');

// Ушёл из игры — пропал из состава у ВСЕХ, а не только у соседей по
// системе: для соседей есть leave, а список общий на всю галактику.
$hub2->close($r2, $t);
$after = $r1->last('roster')['list'] ?? [];
ok(count($after) === 1 && ($after[0]['name'] ?? '') === 'АЛЬФА',
    'ушедший пропадает из списка даже у тех, кто был в другой системе');

// --- топливо: замер расхода ------------------------------------------------------
//
// Расход двигателей хаб считает по счётчикам, которые шлёт игра, а
// квантовый — по самим положениям. В базу он уходит пачками, и игра
// получает бак по счёту сервера вместе с номером учтённого снимка.

echo PHP_EOL . '== сокет: топливо ==' . PHP_EOL;

$hub3 = new Hub();
$t = 5000.0;
$fuelA = static fn() => (float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipA]);
Db::run('DELETE FROM `ship_equipment` WHERE `ship_id`=?', [$shipA]);
Players::ensureStock($shipA);
Loadout::forget();
Db::update('ship', ['fuel_t' => 10], '`id`=?', [$shipA]);
$fm = Fuel::model($shipA);

$f1 = new FakeConn('f1');
$hub3->open($f1, $t);
$hub3->message($f1, json_encode(['t' => 'hello', 'token' => $a['token']]), $t);
$msg = $f1->last('fuel');
ok($msg !== null && abs($msg['fuel'] - 10) < 1e-9 && abs($msg['cap'] - 12) < 1e-9,
    'при входе игра узнаёт бак по счёту сервера: 10 из 12 т');

$pos = static function (float $x, array $extra, float $at) use ($hub3, $f1): void {
    $hub3->message($f1, json_encode($extra + ['t' => 'pos', 'sys' => 0, 'x' => $x, 'y' => 0, 'z' => 0,
        'v' => 0, 'mode' => 'flight']), $at);
};
$w = static fn($m, $l, $r, $n) => ['wm' => $m, 'wl' => $l, 'wr' => $r, 'n' => $n];

$t += 1;
$pos(0, $w(0, 0, 0, 1), $t);
ok(abs($fuelA() - 10) < 1e-9, 'первый снимок — только точка отсчёта');

$t += 1;
$pos(1, $w(1.0, 0, 0, 2), $t);
$want = 10 - $fm['mass'] * 1.0 / $fm['exhaust'];
ok(abs($fuelA() - $want) < 0.002 && ($f1->last('fuel')['n'] ?? 0) === 2
    && abs($f1->last('fuel')['fuel'] - $fuelA()) < 0.002,
    'разгон на 1 км/с списан: ' . round(10 - $fuelA(), 3) . ' т, игре ушёл бак после снимка 2');

// Больше, чем двигатель может дать за секунду, не спишется, что бы ни
// прислала игра: предел — это защита и от ошибки в ней, и от подделки.
$was = $fuelA();
$t += 1;
$pos(2, $w(1001.0, 0, 0, 3), $t);
$cap = $fm['mainAccel'] * (1 + Hub::METER_SLACK_S) * Hub::METER_SLACK;
ok(abs(($was - $fuelA()) - $fm['mass'] * $cap / $fm['exhaust']) < 0.002,
    'заявленные 1000 км/с срезаны пределом двигателя до ' . round($cap, 2) . ' км/с');

// Подъёмные и маневровые — каждая группа по своей струе. Числа взяты
// под их пределами: у подъёмных он — тяжесть газового гиганта.
$was = $fuelA();
$t += 1;
$pos(3, $w(1001.0, 0.3, 0.5, 4), $t);
$want = $fm['mass'] * (0.3 / $fm['liftExhaust'] + 0.5 / $fm['rcsExhaust']);
ok(abs(($was - $fuelA()) - $want) < 0.002,
    'подъёмные и маневровые списаны по своим струям: ' . round($want, 3) . ' т');

// Счётчики пошли заново — это новая точка отсчёта, а не расход.
$was = $fuelA();
$t += 1;
$pos(4, $w(0, 0, 0, 5), $t);
$t += 1;
$pos(5, $w(0, 0, 0, 6), $t);
ok(abs($was - $fuelA()) < 1e-9, 'обнулённые счётчики ничего не списывают');

// КВАНТОВЫЙ ХОД хаб меряет сам: двадцать пять снимков по 12 000 км за
// 0.2 с — это 60 000 км/с, прыжок. Игра о нём не сообщает ничего.
$was = $fuelA();
$x = 5.0;
for ($i = 1; $i <= 25; $i++) {
    $t += 0.2;
    $x += 12000;
    $pos($x, $w(0, 0, 0, 6 + $i), $t);
}
$t += 0.2;
$pos($x, $w(0, 0, 0, 40) + ['mode' => 'docked'], $t);
$want = Fuel::quantumTons($fm, 25 * 12000);
ok(abs(($was - $fuelA()) - $want) < 0.002,
    'квантовый ход в 300 тыс. км измерен по положениям: ' . round($was - $fuelA(), 3) . ' т');
ok(($f1->last('fuel')['n'] ?? 0) === 40, 'в доке расход ушёл в базу сразу, не дожидаясь срока');

// Обычный полёт прыжком не считается, как и тоннель варпа, и смена системы.
$was = $fuelA();
for ($i = 1; $i <= 5; $i++) {
    $t += 0.2;
    $x += 0.2;
    $pos($x, $w(0, 0, 0, 40 + $i), $t);
}
for ($i = 1; $i <= 5; $i++) {
    $t += 0.2;
    $x += 1e6;
    $pos($x, $w(0, 0, 0, 50 + $i) + ['mode' => 'warp'], $t);
}
$t += 0.2;
$pos(9e7, $w(0, 0, 0, 60) + ['sys' => 3], $t);
$t += 3;
$pos(9e7, $w(0, 0, 0, 61) + ['sys' => 3], $t);
ok(abs($was - $fuelA()) < 1e-9, 'полёт на двигателях, тоннель и смена системы квантовым ходом не считаются');

// Ушёл — накопленное не пропало.
$was = $fuelA();
$t += 0.5;
$pos(9e7, $w(0.2, 0, 0, 62) + ['sys' => 3], $t);
ok(abs($was - $fuelA()) < 1e-9, 'малый расход копится в памяти, не дёргая базу');
$hub3->close($f1, $t);
ok(abs(($was - $fuelA()) - $fm['mass'] * 0.2 / $fm['exhaust']) < 0.002,
    'на выходе накопленное ушло в базу: ' . round($was - $fuelA(), 3) . ' т');

// Верфь меняет модули запросом в ДРУГОМ процессе. Хаб обязан это увидеть
// при очередном перечитывании, а не после перезапуска.
$f2 = new FakeConn('f2');
$hub3->open($f2, $t);
$hub3->message($f2, json_encode(['t' => 'hello', 'token' => $a['token']]), $t);
Loadout::flight($shipA);                                   // память хаба «прогрета»
$tankId = (int) Db::one("SELECT `id` FROM `equipment_type` WHERE `code`='tank_x'");
Db::insert('ship_equipment', ['ship_id' => $shipA, 'equipment_id' => $tankId]);
$t += Hub::STAT_EVERY + 1;
$hub3->message($f2, json_encode(['t' => 'pos', 'sys' => 0, 'x' => 0]), $t);
$hub3->tick($t);
ok(abs(($f2->last('fuel')['cap'] ?? 0) - 20) < 1e-9,
    'поставленный мимо хаба бак он видит при перечитывании: объём 20 т');
Db::run('DELETE FROM `ship_equipment` WHERE `ship_id`=? AND `equipment_id`=?', [$shipA, $tankId]);
Loadout::forget();
$hub3->close($f2, $t);

// --- пилот и корабль --------------------------------------------------------------
//
// Соединение — игрок. Корабль он ведёт, только если тот его и здесь;
// сам он может быть где угодно — и это видно соседям отдельным списком.
// В мире только те, кто в игре: корабль ушедшего не виден никому.

echo PHP_EOL . '== сокет: пилот и корабль ==' . PHP_EOL;

$hub4 = new Hub();
$t = 9000.0;
$land = Db::row("SELECT `local_id`, `radius_km` FROM `body` WHERE `system_id`=0 AND `name`='Lave II'");
$L = (int) $land['local_id'];
$R = (float) $land['radius_km'];
$pose = static fn(float $dx) => json_encode(['dir' => ['x' => $dx / sqrt($dx * $dx + $R * $R), 'y' => $R / sqrt($dx * $dx + $R * $R), 'z' => 0],
    'radius' => $R + 0.006, 'right' => ['x' => 1, 'y' => 0, 'z' => 0], 'up' => ['x' => 0, 'y' => 1, 'z' => 0],
    'fwd' => ['x' => 0, 'y' => 0, 'z' => 1]]);
// Альфа стоит на Lave II и вышла из игры — её корабль спит у грунта.
Db::update('ship', ['system_id' => 0, 'docked_body' => null, 'landed_body' => $L, 'landed_pose' => $pose(0),
    'gear_out' => 1, 'hatches' => json_encode(['sR'])], '`id`=?', [$shipA]);
Db::update('ship', ['system_id' => 0, 'docked_body' => null, 'landed_body' => $L, 'landed_pose' => $pose(0.09),
    'gear_out' => 1, 'hatches' => null], '`id`=?', [$shipB]);
Db::update('player', ['system_id' => 0], '`id` IN (?, ?)', [$a['player_id'], $b['player_id']]);
Db::run('UPDATE `player` SET `online`=0');

$cb4 = new FakeConn('p1');
$hub4->open($cb4, $t);
$hub4->message($cb4, json_encode(['t' => 'hello', 'token' => $b['token']]), $t);
$t += 1;
$hub4->tick($t);
$ships = $cb4->last('peers')['list'] ?? [];
ok(!in_array($shipA, array_column($ships, 'id'), true),
    'корабля Альфы, которой нет в игре, не видно: он стоит в базе, но в мире только те, кто в игре');
ok(!in_array($shipB, array_column($ships, 'id'), true),
    'свой корабль, которым пилот командует, ему самому из базы не показывается: его ведёт игра');

// Бета ведёт свой корабль и сама выходит на грунт, к трапу Альфы.
$me = ['st' => 'out', 'b' => $L, 'lx' => 0.01, 'ly' => $R, 'lz' => 0.004, 'lfx' => 1, 'lfy' => 0, 'lfz' => 0,
    'yaw' => 0, 'pitch' => 0.1, 'v' => 1.9, 'air' => 0];
$posB = ['t' => 'pos', 'sys' => 0, 'sid' => $shipB, 'x' => 5, 'y' => 0, 'z' => 0, 'mode' => 'landed',
    'b' => $L, 'lx' => 0.09, 'ly' => $R + 0.006, 'lz' => 0, 'g' => 1, 'h' => ['nL', '../etc'], 'me' => $me];
$t += 1;
$hub4->message($cb4, json_encode($posB), $t);

// Люк корабля Альфы, пока её нет, не открыть и у самого трапа: стучаться
// не к кому.
$t += 1;
$hub4->message($cb4, json_encode(['t' => 'hatch', 'ship' => $shipA, 'id' => 'nL', 'open' => true]), $t);
ok(Players::hatchesOf(Players::shipRow($shipA)) === ['sR'],
    'люк корабля той, кого нет в игре, не открывается и у трапа');

// Альфа возвращается: видит Бету — и её корабль, и её саму.
$ca4 = new FakeConn('p2');
$hub4->open($ca4, $t);
$hub4->message($ca4, json_encode(['t' => 'hello', 'token' => $a['token']]), $t);
$t += 1;
$hub4->tick($t);
$snap = $ca4->last('peers');
$shipSeen = array_values(array_filter($snap['list'] ?? [], static fn($s) => $s['id'] === $shipB))[0] ?? null;
$annaSeen = array_values(array_filter($snap['people'] ?? [], static fn($p) => $p['id'] === $b['player_id']))[0] ?? null;
ok($shipSeen !== null && empty($shipSeen['dorm']) && $shipSeen['by'] === $b['player_id']
    && $shipSeen['b'] === $L && $shipSeen['h'] === ['nL'],
    'корабль, который ведут, — по снимку хозяина: в осях тела, люки из снимка (мусорное имя отброшено)');
ok($annaSeen !== null && $annaSeen['st'] === 'out' && $annaSeen['b'] === $L && abs($annaSeen['lx'] - 0.01) < 1e-9,
    'и сама Бета — человеком на грунте, отдельно от своего корабля');

// Пилот, который шлёт снимок за чужой корабль, его не ведёт.
$t += 1;
$hub4->message($ca4, json_encode(['t' => 'pos', 'sys' => 0, 'sid' => $shipB, 'x' => 999, 'y' => 0, 'z' => 0,
    'me' => ['st' => 'walk', 's' => $shipA, 'x' => 0, 'y' => -9, 'z' => 3]]), $t);
$hub4->tick($t);
$still = array_values(array_filter($cb4->last('peers')['list'] ?? [], static fn($s) => $s['id'] === $shipA))[0] ?? null;
ok($still !== null && ($still['dorm'] ?? 0) === 1 && $still['by'] === $a['player_id'] && $still['b'] === $L
    && $still['h'] === ['sR'] && $still['g'] === 1 && abs(hypot($still['lx'], $still['ly']) - ($R + 0.006)) < 1e-6
    && ($still['ty'] ?? null) === 'challenger',
    'снимок за чужой корабль не делает Альфу водителем: она в игре, а её корабль виден без водителя, по базе — на стоянке, в осях тела, с открытым люком');

// Люк корабля без водителя просят стоя у трапа — и он открывается в базе.
$t += 1;
$hub4->message($cb4, json_encode(['t' => 'hatch', 'ship' => $shipA, 'id' => 'nL', 'open' => true]), $t);
$hatches = Players::hatchesOf(Players::shipRow($shipA));
ok(in_array('nL', $hatches, true) && in_array('sR', $hatches, true),
    'стоя у трапа корабля без водителя (хозяйка в игре), люк попросили — открылся: в базе: ' . json_encode($hatches));
// Издалека — нет.
$far = $posB;
$far['me']['lx'] = 40;
$t += 1;
$hub4->message($cb4, json_encode($far), $t);
$t += 1;
$hub4->message($cb4, json_encode(['t' => 'hatch', 'ship' => $shipA, 'id' => 'sR', 'open' => false]), $t);
ok(in_array('sR', Players::hatchesOf(Players::shipRow($shipA)), true),
    'за 40 км люк чужого корабля не закрыть');

// Альфа начинает вести свой корабль — люк Беты просят у неё, а не у базы.
$t += 1;
$hub4->message($ca4, json_encode(['t' => 'pos', 'sys' => 0, 'sid' => $shipA, 'x' => 0, 'y' => 0, 'z' => 0, 'mode' => 'landed',
    'b' => $L, 'lx' => 0, 'ly' => $R + 0.006, 'lz' => 0, 'g' => 1, 'h' => ['sR', 'nL'],
    'me' => ['st' => 'walk', 's' => $shipA, 'x' => 0, 'y' => -9, 'z' => 3]]), $t);
$hub4->message($cb4, json_encode($posB), $t + 0.1);
$t += 1;
$hub4->message($cb4, json_encode(['t' => 'hatch', 'ship' => $shipA, 'id' => 'sR', 'open' => false]), $t);
$req = $ca4->last('hatchreq');
ok($req !== null && $req['ship'] === $shipA && $req['id'] === 'sR' && $req['open'] === false
    && $req['by'] === $b['player_id'],
    'люк корабля, который ведут, просят у того, кто ведёт: просьба дошла до Альфы');

// Бета поднимается на борт к Альфе и улетает с ней в прыжок: корабль
// пропадает у всех, кроме тех, кто на его борту.
$cc4 = new FakeConn('p3');
$hub4->open($cc4, $t);
$c = Auth::register('gamma', 'secret', 'ГАММА');
$hub4->message($cc4, json_encode(['t' => 'hello', 'token' => $c['token']]), $t);
$hub4->message($cc4, json_encode(['t' => 'pos', 'sys' => 0, 'me' => ['st' => 'out', 'b' => $L, 'lx' => 1, 'ly' => $R, 'lz' => 0]]), $t);
$t += 1;
$aboard = $posB;
$aboard['me'] = ['st' => 'walk', 's' => $shipA, 'x' => 1, 'y' => -9, 'z' => 4, 'yaw' => 0, 'v' => 0];
$hub4->message($cb4, json_encode($aboard), $t);
$hub4->message($ca4, json_encode(['t' => 'pos', 'sys' => 0, 'sid' => $shipA, 'x' => 0, 'y' => 0, 'z' => 0, 'mode' => 'warp',
    'me' => ['st' => 'seat', 's' => $shipA, 'x' => 0, 'y' => 0, 'z' => 0]]), $t + 0.1);
$t += 1;
$hub4->tick($t);
$rideB = in_array($shipA, array_column($cb4->last('peers')['list'] ?? [], 'id'), true);
$rideC = in_array($shipA, array_column($cc4->last('peers')['list'] ?? [], 'id'), true);
ok($rideB && !$rideC, 'в прыжке корабль Альфы видит только пассажир на его борту, а не тот, кто остался на грунте');
// Корабль вышел в другой системе: пассажир по-прежнему его видит — и
// Альфу в кресле, хоть сам ещё в старой системе.
$t += 1;
$hub4->message($ca4, json_encode(['t' => 'pos', 'sys' => 3, 'sid' => $shipA, 'x' => 7e5, 'y' => 0, 'z' => 0, 'mode' => 'flight',
    'me' => ['st' => 'seat', 's' => $shipA, 'x' => 0, 'y' => 0, 'z' => 0]]), $t);
$hub4->tick($t);
$list = $cb4->last('peers')['list'] ?? [];
$there = array_values(array_filter($list, static fn($s) => $s['id'] === $shipA))[0] ?? null;
$pilot = array_values(array_filter($cb4->last('peers')['people'] ?? [], static fn($p) => $p['id'] === $a['player_id']))[0] ?? null;
ok($there !== null && $there['sys'] === 3 && $there['pilot'] === $a['player_id'] && $pilot !== null && $pilot['st'] === 'seat',
    'корабль ушёл в систему 3 — пассажир его видит (sys 3, в кресле Альфа): за ним игра и перейдёт');

// Корабль погиб — весть о нём получает и пассажир, где бы ни был.
$t += 1;
$hub4->message($ca4, json_encode(['t' => 'impact', 'fatal' => true]), $t);
ok(($cb4->last('boom')['id'] ?? 0) === $shipA, 'корабль погиб — пассажир узнаёт об этом сразу (boom)');

// --- ушла хозяйка ------------------------------------------------------------
//
// Ушёл хозяин — его корабль пропал у всех сразу. Пассажиров хаб ждёт
// GRACE (обновил страницу, моргнула сеть) и, не дождавшись, возвращает в
// кресла их собственных кораблей.

echo PHP_EOL . '== сокет: ушла хозяйка ==' . PHP_EOL;

// Бета стоит на палубе Альфы — и по базе тоже (её сохранение).
Db::update('player', ['aboard_ship' => $shipA, 'seated' => 0], '`id`=?', [$b['player_id']]);

$t += 1;
$hub4->message($ca4, json_encode(['t' => 'pos', 'sys' => 0, 'sid' => $shipA, 'x' => 0, 'y' => 0, 'z' => 0, 'mode' => 'docked',
    'me' => ['st' => 'seat', 's' => $shipA, 'x' => 0, 'y' => 0, 'z' => 0]]), $t);
$hub4->message($cb4, json_encode(['t' => 'pos', 'sys' => 0,
    'me' => ['st' => 'walk', 's' => $shipA, 'x' => 1, 'y' => -9, 'z' => 4]]), $t);
$hub4->message($cc4, json_encode(['t' => 'pos', 'sys' => 0,
    'me' => ['st' => 'out', 'b' => $L, 'lx' => 1, 'ly' => $R, 'lz' => 0]]), $t);
$t += 1;
$hub4->tick($t);
$sawA = in_array($shipA, array_column($cc4->last('peers')['list'] ?? [], 'id'), true);
$t += 1;
$hub4->close($ca4, $t);
$t += Hub::TICK;
$hub4->tick($t);
$snapC = $cc4->last('peers');
ok($sawA && !in_array($shipA, array_column($snapC['list'] ?? [], 'id'), true)
    && !in_array($a['player_id'], array_column($snapC['people'] ?? [], 'id'), true) && !$cb4->has('home'),
    'Альфа закрыла игру — ни её корабля, ни её самой больше не видно; пассажира пока не трогают');

// Вернулась через десять секунд — обновила страницу.
$t += 10;
$ca5 = new FakeConn('p4');
$hub4->open($ca5, $t);
$hub4->message($ca5, json_encode(['t' => 'hello', 'token' => $a['token']]), $t);
$t += Hub::GRACE;
$hub4->tick($t);
ok(!$cb4->has('home') && (int) Players::byId($b['player_id'])['aboard_ship'] === $shipA,
    'вернулась через 10 с (обновила страницу) — пассажир по-прежнему на её борту');

// Вторая вкладка выбивает первую — это тоже не уход.
$ca6 = new FakeConn('p5');
$hub4->open($ca6, $t);
$hub4->message($ca6, json_encode(['t' => 'hello', 'token' => $a['token']]), $t);
$hub4->close($ca5, $t);                         // так Ratchet закрывает выбитое
$t += Hub::GRACE + 1;
$hub4->tick($t);
ok($ca5->closed && !$cb4->has('home'), 'вторая вкладка выбила первую — это не уход: пассажира не трогают');

// Ушла насовсем. Через GRACE пассажиры — у себя: и тот, кто в игре (ему
// об этом говорят), и тот, кого нет, но кто по базе на её борту.
Db::update('player', ['aboard_ship' => $shipA, 'seated' => 0, 'out_body' => null], '`id`=?', [$c['player_id']]);
$hub4->close($cc4, $t);
$hub4->close($ca6, $t);
$t += Hub::GRACE - 1;
$hub4->tick($t);
$early = $cb4->has('home');
$t += 2;
$hub4->tick($t);
$home = $cb4->last('home');
$pb = Players::byId($b['player_id']);
$pc = Players::byId($c['player_id']);
$shipC = (int) Players::ship($c['player_id'])['id'];
ok(!$early && $home !== null && $home['ship'] === $shipA && $home['home'] === $shipB
    && (int) $pb['aboard_ship'] === $shipB && (int) $pb['seated'] === 1
    && (int) $pc['aboard_ship'] === $shipC && (int) $pc['seated'] === 1,
    'не вернулась за ' . Hub::GRACE . ' с — пассажиры в креслах своих кораблей (тому, кто в игре, — home)');
ok((int) Players::byId($a['player_id'])['online'] === 0 && (int) $pb['online'] === 1,
    'по базе Альфа больше не в игре, Бета — в игре');

// Перезапуск сервера: кто был в игре у прошлого процесса, того ждут
// столько же — и, не дождавшись, возвращают пассажиров.
$t += 100;
Db::update('player', ['online' => 1], '`id`=?', [$a['player_id']]);
Db::update('player', ['aboard_ship' => $shipA, 'seated' => 0], '`id`=?', [$b['player_id']]);
$hub5 = new Hub();
$hub5->boot($t);
$cb5 = new FakeConn('p6');
$hub5->open($cb5, $t);
$hub5->message($cb5, json_encode(['t' => 'hello', 'token' => $b['token']]), $t);
$hub5->message($cb5, json_encode(['t' => 'pos', 'sys' => 0,
    'me' => ['st' => 'walk', 's' => $shipA, 'x' => 0, 'y' => -9, 'z' => 3]]), $t);
$t += 5;
$hub5->tick($t);
$soon = $cb5->has('home');
$t += Hub::GRACE;
$hub5->tick($t);
ok(!$soon && ($cb5->last('home')['ship'] ?? 0) === $shipA
    && (int) Players::byId($b['player_id'])['aboard_ship'] === $shipB,
    'сервер перезапущен: хозяйку ждали GRACE, не дождались — пассажир у себя');

// Хаб не знает хозяйку вовсе (база говорит «в игре», а соединения нет):
// вошедшему на её борт — тот же срок.
$t += 100;
Db::update('player', ['aboard_ship' => $shipA, 'seated' => 0], '`id`=?', [$b['player_id']]);
$hub6 = new Hub();
$cb6 = new FakeConn('p7');
$hub6->open($cb6, $t);
$hub6->message($cb6, json_encode(['t' => 'hello', 'token' => $b['token']]), $t);
$t += Hub::GRACE + 1;
$hub6->tick($t);
ok(($cb6->last('home')['ship'] ?? 0) === $shipA,
    'вошёл на борт той, кого нет в хабе, — через GRACE он у себя, даже не прислав снимка');

echo PHP_EOL . ($fails === 0
    ? "ХАБ: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ ($checks)"
    : "$fails ПРОВЕРОК УПАЛО из $checks") . PHP_EOL;
exit($fails ? 1 : 0);

