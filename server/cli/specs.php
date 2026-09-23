<?php
/**
 * Слепок характеристик для автономного режима и проверок.
 *
 *   php server/cli/specs.php            собрать server/data/specs.json
 *   php server/cli/specs.php --check    только сказать, отстал ли слепок
 *
 * Зачем слепок вообще нужен, раз числа лежат в базе. Затем, что игра
 * умеет запускаться без сервера (?offline=1) и проверки в Node тоже
 * работают без него. Им нужен файл, который можно прочитать с диска и
 * который заведомо совпадает с тем, что скажет сервер.
 *
 * Базу этот вызов не трогает: слепок собирается из server/data/specs.php.
 */

require_once __DIR__ . '/../boot.php';

$check = in_array('--check', $argv, true);
$path = Specs::jsonPath();

if ($check) {
    if (Specs::snapshotStale()) {
        fwrite(STDERR, "слепок характеристик отстал: " . $path . "\n");
        fwrite(STDERR, "соберите заново: php server/cli/specs.php\n");
        exit(1);
    }
    echo "слепок характеристик совпадает с источником\n";
    exit(0);
}

$json = Specs::snapshot();
file_put_contents($path, $json);

$specs = Specs::source();
printf(
    "слепок собран: %s (%d байт)\n  корпусов %d, оружия %d, модулей %d\n",
    $path,
    strlen($json),
    count($specs['shipTypes'] ?? []),
    count($specs['weapons'] ?? []),
    count($specs['modules'] ?? [])
);
