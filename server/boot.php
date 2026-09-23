<?php
/**
 * Подключение всего серверного кода.
 *
 * Без автозагрузчика и без composer — по той же причине, по которой в
 * игре нет сборки: в проекте не должно быть шага «сначала установи
 * зависимости». Файлов полтора десятка, список читается глазами, и
 * порядок в нём значим только для конфига.
 */

require_once __DIR__ . '/config.php';

foreach ([
    'ApiError', 'Db', 'Schema', 'Content', 'Seeder',
    'Galaxy', 'Stations', 'Hub', 'Ledger', 'Cargo', 'Market', 'Missions', 'Players', 'Auth', 'Api',
] as $class) {
    require_once __DIR__ . '/src/' . $class . '.php';
}
