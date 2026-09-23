<?php
/**
 * Сокет-сервер: кто где летает. Порт 3893.
 *
 *   php server/ws/server.php            запустить
 *   php server/ws/server.php --quiet    без журнала в консоль
 *
 * Это ДОЛГОЖИВУЩИЙ процесс, в отличие от api.php: он висит, пока его не
 * остановят (Ctrl+C). Apache для него не нужен вовсе — Ratchet слушает
 * свой порт сам.
 *
 * Почему сокет, а не опрос по HTTP: положение чужих кораблей надо знать
 * по нескольку раз в секунду, и на опросе это десятки запросов в секунду
 * на каждого игрока, с полным разбором PHP и новым соединением к базе
 * каждый раз. Сокет держит одно соединение и шлёт по нему один снимок на
 * тик.
 *
 * Вся логика — в Hub (server/src/Hub.php), здесь только провода. Так хаб
 * проверяется без сети (server/tests/hub.php).
 *
 * Честно про защиту: соединение без TLS (ws://, не wss://) и слушает все
 * сетевые платы, чтобы можно было играть вдвоём по локальной сети. В
 * интернет такой порт выставлять нельзя.
 */

// Ratchet 0.4 написан до PHP 8.2 и заводит динамические свойства, на что
// 8.2 ругается при КАЖДОМ соединении. Это чужой код и чужая беда;
// глушим ровно этот класс предупреждений, а не все подряд — свои ошибки
// нам по-прежнему нужны.
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);

require_once __DIR__ . '/../boot.php';
require_once __DIR__ . '/../vendor/autoload.php';

use Ratchet\ConnectionInterface;
use Ratchet\MessageComponentInterface;
use Ratchet\Http\HttpServer;
use Ratchet\Server\IoServer;
use Ratchet\WebSocket\WsServer;

const WS_PORT = 3893;

$quiet = in_array('--quiet', $argv, true);
$log = static function (string $line) use ($quiet): void {
    if (!$quiet) {
        echo '[', gmdate('H:i:s'), '] ', $line, PHP_EOL;
    }
};

/**
 * Обёртка Ratchet вокруг хаба.
 *
 * Делает ровно три вещи: переводит события Ratchet в вызовы хаба, даёт
 * ему время и ловит исключения, чтобы падение одного соединения не
 * уронило сервер целиком.
 */
final class SolarWs implements MessageComponentInterface
{
    public function __construct(private Hub $hub, private $log)
    {
    }

    public function onOpen(ConnectionInterface $conn): void
    {
        $this->hub->open($conn, microtime(true));
    }

    public function onMessage(ConnectionInterface $from, $msg): void
    {
        try {
            $this->hub->message($from, (string) $msg, microtime(true));
        } catch (Throwable $e) {
            ($this->log)('ошибка разбора: ' . $e->getMessage());
            $from->send(json_encode(['t' => 'error', 'code' => 'server',
                'message' => 'внутренняя ошибка'], JSON_UNESCAPED_UNICODE));
        }
    }

    public function onClose(ConnectionInterface $conn): void
    {
        $this->hub->close($conn, microtime(true));
    }

    public function onError(ConnectionInterface $conn, Exception $e): void
    {
        // Одно испорченное соединение не должно ронять сервер: закрываем
        // его и живём дальше.
        ($this->log)('обрыв: ' . $e->getMessage());
        $conn->close();
    }
}

// База нужна только для проверки токенов; если её нет — сервер
// бессмысленен, и честнее не подниматься вовсе.
try {
    Db::pdo();
} catch (Throwable $e) {
    fwrite(STDERR, 'база не отвечает: ' . $e->getMessage() . PHP_EOL);
    fwrite(STDERR, 'сначала: npm run api:setup' . PHP_EOL);
    exit(1);
}

$hub = new Hub($log);
$loop = React\EventLoop\Loop::get();

// Тик рассылки. Он же чистит тех, кто молчит и не представился.
$loop->addPeriodicTimer(Hub::TICK, static function () use ($hub) {
    $hub->tick(microtime(true));
});

// Раз в минуту — строка в журнал: по ней видно, что сервер жив и сколько
// на нём народу.
$loop->addPeriodicTimer(60, static function () use ($hub, $log) {
    $log('в сети: ' . $hub->count() . ' соединений, пилотов ' . count($hub->online()));
});

// Сервер собирается ВРУЧНУЮ, а не через IoServer::factory. Причина
// настоящая, а не вкусовая: factory заводит СВОЙ цикл событий, и тогда
// таймеры, повешенные на Loop::get() выше, не срабатывают вовсе — сервер
// принимает сообщения, но не рассылает ни одного снимка. Поймано живой
// проверкой (npm run ws:live): пилоты друг друга не видели.
$socket = new React\Socket\SocketServer('0.0.0.0:' . WS_PORT, [], $loop);
$server = new IoServer(
    new HttpServer(new WsServer(new SolarWs($hub, $log))),
    $socket,
    $loop
);

// Адрес в сети печатаем сразу: с другой машины нужен именно он, а не
// localhost, и искать его в настройках Windows посреди игры — последнее,
// чем хочется заниматься.
$lan = gethostbyname(gethostname());
$log('сокет-сервер Solar Trader слушает порт ' . WS_PORT);
$log('  эта машина:   ws://localhost:' . WS_PORT);
if ($lan && $lan !== gethostname()) {
    $log('  из сети:      ws://' . $lan . ':' . WS_PORT);
    $log('  игра с другой машины: http://' . $lan . '/space_game/');
    $log('  если не подключается — брандмауэр: npm run lan');
}
$log('остановить — Ctrl+C');
$server->run();
