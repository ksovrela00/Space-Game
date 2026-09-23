<?php
/**
 * Подготовка базы одной командой.
 *
 *   php server/cli/setup.php                создать базу и таблицы, залить каталог
 *   php server/cli/setup.php --reset        снести таблицы и собрать заново
 *   php server/cli/setup.php --market       пересчитать склады станций
 *   php server/cli/setup.php --status       что сейчас в базе
 *
 * Перед первым запуском каталог надо выгрузить из генератора:
 *   node tools/export.mjs
 */

require_once __DIR__ . '/../boot.php';

$args = array_slice($argv, 1);
$has = static fn(string $f): bool => in_array($f, $args, true);

$say = static function (string $s): void {
    echo $s, PHP_EOL;
};

try {
    // Соединение с базой, которой может ещё не быть, — поэтому сначала
    // создаём её, и только потом работаем.
    Db::use(Schema::ensureDatabase(MYSQLDB));
    $say('база: ' . MYSQLDB . ' на ' . MYSQLHOST . ':' . MYSQLPORT);

    if ($has('--status')) {
        $say('версия схемы: ' . Schema::meta('schema_version', '—'));
        $say('каталог залит: ' . (Schema::meta('catalog_seeded_at') ?: '—'));
        $say('seed галактики: ' . (Schema::meta('galaxy_seed') ?: '—'));
        foreach (array_keys(Schema::tables()) as $t) {
            $n = Db::one('SELECT COUNT(*) FROM `' . $t . '`');
            $say(sprintf('  %-16s %s', $t, $n === null ? '—' : $n));
        }
        exit(0);
    }

    if ($has('--reset')) {
        Schema::reset();
        $say('схема пересоздана с нуля');
    } else {
        $made = Schema::migrate();
        $say($made ? 'созданы таблицы: ' . implode(', ', $made) : 'схема на месте, таблицы не трогали');
    }

    $catalogPath = __DIR__ . '/../data/catalog.json';
    $catalog = Seeder::readCatalog($catalogPath);
    $say('выгрузка каталога от ' . $catalog['generatedAt']);

    $n = Seeder::content($catalog);
    $say(sprintf('содержимое: товаров %d, типов кораблей %d, модулей %d',
        $n['commodity'], $n['ship_type'], $n['equipment_type']));

    $n = Seeder::catalog($catalog);
    $say(sprintf('каталог: систем %d, тел %d', $n['star_system'], $n['body']));

    $rows = Seeder::markets($has('--market') || $has('--reset'));
    $say('склады станций: ' . $rows . ' позиций');

    $say('готово');
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'ОШИБКА: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
