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
Db::run('DELETE FROM `player`');

$a = Auth::register('alfa', 'secret', 'АЛЬФА');
$b = Auth::register('beta', 'secret', 'БЕТА');

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

echo PHP_EOL . ($fails === 0
    ? "ХАБ: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ ($checks)"
    : "$fails ПРОВЕРОК УПАЛО из $checks") . PHP_EOL;
exit($fails ? 1 : 0);
