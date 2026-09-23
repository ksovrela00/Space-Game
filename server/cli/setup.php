<?php
/**
 * Подготовка базы одной командой.
 *
 *   php server/cli/setup.php                создать базу и таблицы, залить каталог
 *   php server/cli/setup.php --reset        снести таблицы и собрать заново
 *   php server/cli/setup.php --market       пересчитать склады станций
 *   php server/cli/setup.php --status       что сейчас в базе
 *   php server/cli/setup.php --demo         завести показательного пилота
 *
 * Перед первым запуском каталог надо выгрузить из генератора:
 *   node tools/export.mjs
 *
 * Числа корабля, оружия и модулей берутся из server/data/specs.php — их
 * выгружать неоткуда, они и есть источник.
 */

require_once __DIR__ . '/../boot.php';

/**
 * Показательный пилот.
 *
 * Половина таблиц базы — про игрока, и пока не зарегистрировался ни один,
 * они пусты. Это правильно, но по пустой базе не видно ни того, что всё
 * связано, ни того, что вообще работает. Эта команда заводит пилота
 * demo/demo и проживает за него первые полчаса: сбор за стыковку, покупка
 * груза, взятый подряд. После неё в базе есть строки во всех таблицах.
 */
function demoPilot(callable $say): string
{
    $login = 'demo';
    $exists = Db::one('SELECT `id` FROM `player` WHERE `login`=?', [$login]);
    if ($exists !== null) {
        return 'пилот demo уже есть (#' . $exists . '), новый не заводим';
    }

    $reg = Auth::register($login, 'demo', 'ДЕМО-ПИЛОТ');
    $pid = $reg['player_id'];
    $p = Players::byId($pid);
    $sys = (int) $p['system_id'];
    $port = (int) $p['docked_body'];

    // Вылет и возвращение: так в ленте появляется сбор за стыковку.
    Players::save($pid, ['docked' => null, 'pos' => ['x' => 620000, 'y' => 0, 'z' => 0]]);
    Stations::dock($pid, $sys, $port);

    // Немного груза — из того, что есть на складе.
    $good = Db::row(
        "SELECT c.`code` FROM `market` m
         JOIN `commodity` c ON c.`id`=m.`commodity_id`
         JOIN `body` b ON b.`id`=m.`station_id`
         WHERE b.`system_id`=? AND b.`local_id`=? AND m.`stock` > 6 ORDER BY m.`price` LIMIT 1",
        [$sys, $port]
    );
    if ($good) {
        Market::buy($pid, $good['code'], 5);
    }

    // И один подряд с доски.
    $board = Missions::board($sys, $port);
    foreach ($board as $m) {
        if ($m['tons'] <= 6) {
            Missions::accept($pid, $m['id']);
            break;
        }
    }

    $st = Players::state($pid);
    $say('пилот demo заведён: вход demo / demo');
    $say('  баланс ' . $st['player']['balance'] . ' кр, в трюме ' . $st['holdUsedT'] . ' т, '
        . 'подрядов ' . count($st['missions']) . ', записей в ленте ' . count($st['ledger']));
    return 'теперь непустые все таблицы — смотрите в phpMyAdmin';
}

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

    // Слепок характеристик пересобирается вместе с заливкой: он нужен
    // игре без сервера, и отстав, он тихо развёл бы автономный режим с
    // сетевым. Отдельная команда для него тоже есть (server/cli/specs.php),
    // но заставлять помнить о ней — значит однажды не вспомнить.
    if (Specs::snapshotStale()) {
        file_put_contents(Specs::jsonPath(), Specs::snapshot());
        $say('слепок характеристик пересобран: server/data/specs.json');
    }

    $n = Seeder::all($catalog, $has('--market') || $has('--reset'));
    $say(sprintf('содержимое: товаров %d, типов кораблей %d, модулей %d',
        $n['commodity'], $n['ship_type'], $n['equipment_type']));
    $say(sprintf('каталог: систем %d, тел %d', $n['star_system'], $n['body']));
    $say(sprintf('порты: %d со свойствами, %d позиций на складах',
        $n['station'], $n['market']));

    if ($has('--demo')) {
        $say('');
        $say(demoPilot($say));
    }

    $say('готово');
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'ОШИБКА: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
