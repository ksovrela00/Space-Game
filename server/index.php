<?php
/**
 * Состояние сервера в браузере: http://localhost/space_game/server/
 *
 * Страница на одну задачу — ответить, жив ли сервер и что у него в базе.
 * Когда игра не может войти, вопросов ровно три: поднята ли база, залит
 * ли каталог, отвечает ли api.php. Здесь видны все три сразу, и не надо
 * лезть в консоль.
 *
 * Ничего не меняет и ничего не показывает про конкретных игроков, кроме
 * их числа: это страница обслуживания, а не админка.
 */

require_once __DIR__ . '/boot.php';

$err = null;
$rows = [];
$meta = [];
try {
    Db::pdo();
    foreach (array_keys(Schema::tables()) as $t) {
        $rows[$t] = (int) Db::one('SELECT COUNT(*) FROM `' . $t . '`');
    }
    $meta = [
        'версия схемы' => Schema::meta('schema_version', '—') . ' (в коде ' . Schema::VERSION . ')',
        'seed галактики' => Schema::meta('galaxy_seed', '—'),
        'каталог собран' => Schema::meta('catalog_generated_at', '—'),
        'каталог залит' => Schema::meta('catalog_seeded_at', '—'),
    ];
} catch (Throwable $e) {
    $err = $e->getMessage();
}

$h = static fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SOLAR TRADER :: сервер</title>
<style>
  body { background:#04101a; color:#d8f2ff; font:14px Consolas, monospace; margin:0; padding:24px; }
  h1 { font-size:18px; color:#4fb3e0; letter-spacing:2px; margin:0 0 4px; }
  .sub { color:rgba(79,179,224,0.6); margin:0 0 20px; }
  table { border-collapse:collapse; margin:0 0 20px; min-width:320px; }
  td { padding:3px 18px 3px 0; border-bottom:1px solid rgba(79,179,224,0.15); }
  td.v { text-align:right; color:#ffcc66; }
  .bad { color:#ff7a66; }
  .ok { color:#78e08f; }
  code { color:#78e08f; }
  .hint { color:rgba(216,242,255,0.55); max-width:640px; line-height:1.5; }
</style>
</head>
<body>
<h1>SOLAR TRADER :: СЕРВЕР</h1>
<p class="sub">база <?= $h(MYSQLDB) ?> на <?= $h(MYSQLHOST) ?>:<?= $h(MYSQLPORT) ?></p>

<?php if ($err !== null): ?>
  <p class="bad">База не отвечает: <?= $h($err) ?></p>
  <p class="hint">Запустите MySQL в панели XAMPP, затем соберите базу:<br>
    <code>npm run api:setup</code></p>
<?php elseif (($rows['star_system'] ?? 0) === 0): ?>
  <p class="bad">Схема есть, но каталог пуст.</p>
  <p class="hint">Выгрузите каталог из генератора и залейте его:<br>
    <code>npm run api:setup</code></p>
<?php else: ?>
  <p class="ok">Сервер готов.</p>
<?php endif; ?>

<?php if ($meta): ?>
<table>
  <?php foreach ($meta as $k => $v): ?>
  <tr><td><?= $h($k) ?></td><td class="v"><?= $h($v) ?></td></tr>
  <?php endforeach; ?>
</table>
<table>
  <?php foreach ($rows as $t => $n): ?>
  <tr><td><?= $h($t) ?></td><td class="v"><?= $h($n) ?></td></tr>
  <?php endforeach; ?>
</table>
<?php endif; ?>

<p class="hint">
  Проверить вызов: <code>api.php?r=ping</code>.
  Полный список вызовов — в README, раздел «Сервер».
  Проверки: <code>npm run api:test</code> (на отдельной базе solar_trader_test).
</p>
</body>
</html>
