<?php
/**
 * Единственная дверь HTTP: server/api.php?r=<маршрут>
 *
 * Одна точка входа, а не файл на каждый вызов, — чтобы разбор токена,
 * формат ответа и обработка ошибок были написаны ОДИН раз. Пропущенная
 * проверка токена в одном файле из двадцати — это именно то, как такие
 * серверы и текут.
 *
 * Тело запроса читается и как JSON, и как обычная форма: JSON — то, чем
 * говорит игра, форма — то, чем удобно ткнуть из браузера или curl.
 *
 * Ответ всегда одной формы:
 *     {"ok":true,  "data":{...}}
 *     {"ok":false, "error":{"code":"no_funds","message":"..."}}
 * Клиенту от этого не нужно гадать по коду HTTP, что случилось, — но и
 * код HTTP при этом честный, чтобы прокси и логи видели ошибку ошибкой.
 */

require_once __DIR__ . '/boot.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// Игру открывают с того же адреса (http://localhost/space_game/), и
// заголовки доступа тогда не нужны вовсе. Они нужны, только если страницу
// открыли иначе — с другого порта или из файла; разрешаем ровно localhost
// и ровно на время разработки. Открытый всем `*` здесь был бы дырой:
// токен уходит заголовком, а ответ читал бы кто угодно.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && preg_match('~^https?://(localhost|127\.0\.0\.1)(:\d+)?$~', $origin)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Headers: Content-Type, X-Auth-Token');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Vary: Origin');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$route = (string) ($_GET['r'] ?? $_POST['r'] ?? '');

// Тело: JSON или форма.
$in = [];
$raw = file_get_contents('php://input');
if ($raw !== '' && $raw !== false) {
    $json = json_decode($raw, true);
    if (is_array($json)) {
        $in = $json;
    }
}
$in = array_merge($_GET, $_POST, $in);
if ($route === '' && isset($in['r'])) {
    $route = (string) $in['r'];
}

$token = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? ($in['token'] ?? null);

try {
    $data = Api::call($route, $in, is_string($token) ? $token : null);
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
} catch (ApiError $e) {
    http_response_code($e->status);
    echo json_encode([
        'ok' => false,
        'error' => array_merge(['code' => $e->slug, 'message' => $e->getMessage()], $e->extra),
    ], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    // Наружу — только то, что случилась наша поломка. Подробности (файл,
    // строка, запрос) идут в лог сервера: в ответе они помогли бы
    // исключительно тому, кто эту поломку ищет для взлома.
    error_log('[solar-trader] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => ['code' => 'server', 'message' => 'внутренняя ошибка сервера'],
    ], JSON_UNESCAPED_UNICODE);
}
