<?php
/**
 * Схема базы: все таблицы в одном месте.
 *
 * Отдельных файлов-миграций пока нет намеренно. База ещё ни разу не была
 * в бою, и любая правка схемы — это «снести и залить заново» (данные в
 * ней сейчас либо каталог, который пересоздаётся генератором, либо
 * тестовый игрок). Как только появится первый живой игрок, здесь появится
 * список шагов, а VERSION станет тем, по чему они догоняются; ради этого
 * версия и таблица meta заведены сразу.
 *
 * Что в базе лежит и почему именно это.
 *
 *   КАТАЛОГ (star_system, body) — слепок того, что выдал генератор
 *   (js/game/galaxy.js + js/game/world.js). Это НЕ вторая копия логики:
 *   заливается он выгрузкой из самого генератора (tools/export.mjs), и
 *   рядом с каждой системой лежит её seed. Сервер становится хозяином
 *   каталога — в онлайне иначе нельзя, клиенту верить в том, где стоит
 *   планета, не приходится, — но пока источник один, и разъехаться им
 *   негде.
 *
 *   СОДЕРЖИМОЕ (ship_type, equipment_type, commodity) — то, из чего
 *   собран мир: типы кораблей, оборудование, товары. Числа кораблей и
 *   оборудования приходят из тех же констант, по которым игра летает.
 *
 *   ИЗМЕНЯЕМОЕ (player, ship, ship_equipment, cargo, market, mission,
 *   ledger, session) — всё, что двигается по ходу игры. Ровно это в
 *   онлайне обязано жить на сервере, а не в localStorage браузера.
 */

final class Schema
{
    /** Версия схемы. Растёт при каждом изменении таблиц. */
    public const VERSION = 5;

    /** Порядок важен: внешние ключи ссылаются назад. */
    public static function tables(): array
    {
        return [

            // --- служебное ---------------------------------------------

            'meta' => "CREATE TABLE `meta` (
                `k` VARCHAR(64) NOT NULL PRIMARY KEY,
                `v` TEXT NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            // --- каталог: где какая звезда и что вокруг неё ------------

            'star_system' => "CREATE TABLE `star_system` (
                -- id тот же, что у генератора: он попадает в сохранения
                -- и в цель варпа, поэтому своей нумерации здесь нет.
                `id` INT NOT NULL PRIMARY KEY,
                `seed` BIGINT UNSIGNED NOT NULL,
                `name` VARCHAR(64) NOT NULL,
                `star_class` CHAR(1) NOT NULL,
                `luminosity` DOUBLE NOT NULL,
                `star_radius_km` DOUBLE NOT NULL,
                `star_temp_k` INT NOT NULL,
                -- Орбита равновесной температуры 255 K: по ней в игре
                -- откалибровано всё остальное.
                `habitable_km` DOUBLE NOT NULL,
                `is_home` TINYINT(1) NOT NULL DEFAULT 0,
                -- Место в галактике, световые годы.
                `pos_x` DOUBLE NOT NULL,
                `pos_y` DOUBLE NOT NULL,
                `pos_z` DOUBLE NOT NULL,
                UNIQUE KEY `name` (`name`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            'body' => "CREATE TABLE `body` (
                `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `system_id` INT NOT NULL,
                -- Номер тела ВНУТРИ системы: именно он лежит в сохранении
                -- игрока (цель, порт, точка стоянки), и он обязан пережить
                -- пересборку каталога.
                `local_id` INT NOT NULL,
                `parent_local_id` INT NULL,
                -- Роль тела в системе...
                `kind` ENUM('star','planet','moon','station') NOT NULL,
                -- ...и его ВИД из игры: lava, rock, desert, ocean, ice,
                -- gas, moon, star, station. Роль и вид — разные вещи, и
                -- вид нужен не для красоты: на нём будет держаться рынок
                -- (лава даёт руду, океан — продовольствие, газовый
                -- гигант — топливо), и по нему же клиент красит тела.
                `type` VARCHAR(16) NOT NULL,
                `name` VARCHAR(96) NOT NULL,
                `radius_km` DOUBLE NOT NULL,
                `orbit_radius_km` DOUBLE NULL,
                `orbit_period_s` DOUBLE NULL,
                `orbit_phase` DOUBLE NULL,
                -- Плоскость орбиты — два вектора; в базе они лежат как
                -- есть, потому что читает их только тот, кто собирает мир.
                `orbit_plane` TEXT NULL,
                `spin_period_s` DOUBLE NULL,
                `press_bar` DOUBLE NOT NULL DEFAULT 0,
                `has_rings` TINYINT(1) NOT NULL DEFAULT 0,
                `has_station` TINYINT(1) NOT NULL DEFAULT 0,
                -- Обжитой мир системы: его порт — точка появления пилота.
                `is_home_world` TINYINT(1) NOT NULL DEFAULT 0,
                `landable` TINYINT(1) NOT NULL DEFAULT 0,
                UNIQUE KEY `in_system` (`system_id`, `local_id`),
                KEY `by_kind` (`system_id`, `kind`),
                CONSTRAINT `body_system` FOREIGN KEY (`system_id`)
                    REFERENCES `star_system` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            // Станция — тело в `body`, но у неё есть то, чего у планеты
            // нет и быть не может: сбор за стыковку, уровень техники,
            // набор услуг. Держать это столбцами в `body` значило бы
            // завести десяток полей, пустых у ста тел из ста шестнадцати.
            'station' => "CREATE TABLE `station` (
                `body_id` BIGINT UNSIGNED NOT NULL PRIMARY KEY,
                `system_id` INT NOT NULL,
                `name` VARCHAR(96) NOT NULL,
                -- Мир, вокруг которого висит: от него и рынок, и техника.
                `world_type` VARCHAR(16) NOT NULL,
                -- Уровень техники 1–5. Решает, что здесь вообще можно
                -- получить: на руднике не продадут варп-привод.
                `tech` TINYINT NOT NULL DEFAULT 1,
                -- Сбор за стыковку, кроны. Первый постоянный расход в игре:
                -- без расходов деньги только копятся.
                `fee` INT NOT NULL DEFAULT 0,
                `has_market` TINYINT(1) NOT NULL DEFAULT 1,
                `has_board` TINYINT(1) NOT NULL DEFAULT 0,
                `has_repair` TINYINT(1) NOT NULL DEFAULT 0,
                `has_outfit` TINYINT(1) NOT NULL DEFAULT 0,
                -- Кроны за один процент корпуса: на развитой станции дешевле.
                `repair_rate` DOUBLE NOT NULL DEFAULT 20,
                -- Мест у причала. Пока ни на что не влияет, но в онлайне
                -- на этом стоит очередь на стыковку.
                `pads` TINYINT NOT NULL DEFAULT 4,
                `market_refresh_at` DATETIME NULL,
                KEY `in_system` (`system_id`),
                CONSTRAINT `station_body` FOREIGN KEY (`body_id`)
                    REFERENCES `body` (`id`) ON DELETE CASCADE,
                CONSTRAINT `station_system` FOREIGN KEY (`system_id`)
                    REFERENCES `star_system` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            // --- содержимое: из чего собран мир ------------------------

            'ship_type' => "CREATE TABLE `ship_type` (
                `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `code` VARCHAR(32) NOT NULL,
                `name` VARCHAR(64) NOT NULL,
                `title` VARCHAR(96) NOT NULL DEFAULT '',
                -- Столбцами лежит то, по чему СЧИТАЕТ САМ СЕРВЕР и что
                -- принадлежит самому корпусу: прочность при попадании
                -- (Combat) и бак нового корабля (Players). По ним ходит
                -- SQL, им нужны типы и они обязаны быть видны в таблице.
                --
                -- Щита и трюма здесь НЕТ: они принадлежат модулям, стоящим
                -- в гнёздах (ship_equipment), и у двух кораблей одного
                -- типа бывают разными. Берутся они через Loadout.
                `hull_max` DOUBLE NOT NULL,
                `fuel_t` DECIMAL(10,3) NOT NULL,
                -- Габариты из самой модели корпуса, метры.
                `length_m` DOUBLE NOT NULL,
                `width_m` DOUBLE NOT NULL,
                `height_m` DOUBLE NOT NULL,
                `price` BIGINT NOT NULL DEFAULT 0,
                -- Остальная лётная модель: разгон, торможение, угловые
                -- скорости, форсаж, шасси — два десятка чисел, которые
                -- нужны ТОЛЬКО кораблю на экране. Текстом, а не столбцами,
                -- потому что SQL по ним не ходит, а заводить столбец под
                -- каждую ручку настройки значит менять схему при каждой
                -- подкрутке.
                --
                -- Числа из столбцов выше здесь НЕ ПОВТОРЯЮТСЯ: одно число —
                -- одно место. Собирая ответ игре, сервер кладёт их сюда
                -- обратно (Specs::forGame), и поправленный в таблице
                -- hull_max доходит до корабля, а не спорит с копией.
                `spec` TEXT NULL,
                UNIQUE KEY `code` (`code`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            'equipment_type' => "CREATE TABLE `equipment_type` (
                `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `code` VARCHAR(32) NOT NULL,
                `name` VARCHAR(64) NOT NULL,
                `slot` VARCHAR(32) NOT NULL,
                -- Что этот модуль делает в числах: разное у разных слотов,
                -- поэтому текстом, а не столбцами.
                `spec` TEXT NULL,
                `price` BIGINT NOT NULL DEFAULT 0,
                `mass_t` DECIMAL(10,3) NOT NULL DEFAULT 0,
                `stock` TINYINT(1) NOT NULL DEFAULT 0,
                UNIQUE KEY `code` (`code`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            'commodity' => "CREATE TABLE `commodity` (
                `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `code` VARCHAR(32) NOT NULL,
                `name` VARCHAR(64) NOT NULL,
                `category` VARCHAR(32) NOT NULL,
                `base_price` INT NOT NULL,
                -- Разброс цены по системам, доля базовой: у руды он мал, у
                -- редких товаров велик — на этом и держится торговля.
                `spread` DOUBLE NOT NULL DEFAULT 0.25,
                `legal` TINYINT(1) NOT NULL DEFAULT 1,
                UNIQUE KEY `code` (`code`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            // --- изменяемое: игроки и их дела --------------------------

            'player' => "CREATE TABLE `player` (
                `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `login` VARCHAR(32) NOT NULL,
                `pass_hash` VARCHAR(255) NOT NULL,
                `name` VARCHAR(64) NOT NULL,
                `created_at` DATETIME NOT NULL,
                `last_seen_at` DATETIME NULL,
                -- Деньги — ЦЕЛЫЕ кроны. Никаких плавающих: доля кроны в
                -- игре не существует, а плавающая арифметика в деньгах
                -- рано или поздно даёт 999.9999999.
                `balance` BIGINT NOT NULL DEFAULT 0,
                `ship_id` INT NULL,
                `system_id` INT NULL,
                `pos_x` DOUBLE NOT NULL DEFAULT 0,
                `pos_y` DOUBLE NOT NULL DEFAULT 0,
                `pos_z` DOUBLE NOT NULL DEFAULT 0,
                `basis` TEXT NULL,
                `docked_body` INT NULL,
                `landed_body` INT NULL,
                `landed_pose` TEXT NULL,
                `landed_secured` TINYINT(1) NOT NULL DEFAULT 0,
                -- План полёта: выбранная цель, отмеченная система варпа,
                -- последний порт и вид камеры. Это не «настройки», а
                -- состояние игры: выбрал цель, отложил, вернулся — цель
                -- обязана быть на месте. В сейве браузера они были с
                -- самого начала, и при переезде на сервер терять их
                -- нельзя.
                `target_body` INT NULL,
                `warp_to` INT NULL,
                `last_station` INT NULL,
                `view` VARCHAR(16) NOT NULL DEFAULT 'cockpit',
                `play_time_s` DOUBLE NOT NULL DEFAULT 0,
                `flown_km` DOUBLE NOT NULL DEFAULT 0,
                `docks` INT NOT NULL DEFAULT 0,
                `landings` INT NOT NULL DEFAULT 0,
                `crashes` INT NOT NULL DEFAULT 0,
                UNIQUE KEY `login` (`login`),
                CONSTRAINT `player_system` FOREIGN KEY (`system_id`)
                    REFERENCES `star_system` (`id`) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            'ship' => "CREATE TABLE `ship` (
                `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `type_id` INT NOT NULL,
                `owner_id` INT NOT NULL,
                `name` VARCHAR(64) NOT NULL DEFAULT '',
                `hull` DOUBLE NOT NULL,
                `shield` DOUBLE NOT NULL DEFAULT 0,
                -- Когда по кораблю попали в последний раз. Щит не
                -- пересчитывается по таймеру — он считается от этого
                -- времени в тот момент, когда его спросили (см. Combat).
                `hit_at` DATETIME NULL,
                `fuel_t` DECIMAL(10,3) NOT NULL,
                `gear_out` TINYINT(1) NOT NULL DEFAULT 0,
                `created_at` DATETIME NOT NULL,
                KEY `owner` (`owner_id`),
                CONSTRAINT `ship_type` FOREIGN KEY (`type_id`)
                    REFERENCES `ship_type` (`id`),
                CONSTRAINT `ship_owner` FOREIGN KEY (`owner_id`)
                    REFERENCES `player` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            'ship_equipment' => "CREATE TABLE `ship_equipment` (
                `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `ship_id` INT NOT NULL,
                `equipment_id` INT NOT NULL,
                `level` INT NOT NULL DEFAULT 1,
                `health` DOUBLE NOT NULL DEFAULT 100,
                UNIQUE KEY `one_per_slot` (`ship_id`, `equipment_id`),
                CONSTRAINT `equip_ship` FOREIGN KEY (`ship_id`)
                    REFERENCES `ship` (`id`) ON DELETE CASCADE,
                CONSTRAINT `equip_type` FOREIGN KEY (`equipment_id`)
                    REFERENCES `equipment_type` (`id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            'cargo' => "CREATE TABLE `cargo` (
                `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `ship_id` INT NOT NULL,
                `commodity_id` INT NOT NULL,
                -- Тонны — DECIMAL, а не DOUBLE: трюм складывают и вычитают
                -- сотни раз за вылет, и на плавающих числах остаток
                -- рано или поздно оказывается 0.0000001 т вместо пустого.
                `tons` DECIMAL(12,3) NOT NULL,
                -- Средняя цена покупки: по ней в трюме видно, в плюс или
                -- в минус идёт рейс.
                `avg_price` DOUBLE NOT NULL DEFAULT 0,
                UNIQUE KEY `one_row_per_good` (`ship_id`, `commodity_id`),
                CONSTRAINT `cargo_ship` FOREIGN KEY (`ship_id`)
                    REFERENCES `ship` (`id`) ON DELETE CASCADE,
                CONSTRAINT `cargo_commodity` FOREIGN KEY (`commodity_id`)
                    REFERENCES `commodity` (`id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            'market' => "CREATE TABLE `market` (
                `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `station_id` BIGINT UNSIGNED NOT NULL,
                `commodity_id` INT NOT NULL,
                `price` INT NOT NULL,
                `stock` DECIMAL(12,3) NOT NULL DEFAULT 0,
                `updated_at` DATETIME NOT NULL,
                UNIQUE KEY `one_row_per_good` (`station_id`, `commodity_id`),
                CONSTRAINT `market_station` FOREIGN KEY (`station_id`)
                    REFERENCES `body` (`id`) ON DELETE CASCADE,
                CONSTRAINT `market_commodity` FOREIGN KEY (`commodity_id`)
                    REFERENCES `commodity` (`id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            'mission' => "CREATE TABLE `mission` (
                `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                -- Предложение на доске ничьё, пока его не взяли.
                `player_id` INT NULL,
                `station_id` BIGINT UNSIGNED NOT NULL,
                `kind` ENUM('deliver','survey','fetch') NOT NULL,
                `title` VARCHAR(96) NOT NULL,
                `descr` VARCHAR(255) NOT NULL DEFAULT '',
                `reward` BIGINT NOT NULL DEFAULT 0,
                `penalty` BIGINT NOT NULL DEFAULT 0,
                `target_body` BIGINT UNSIGNED NULL,
                `commodity_id` INT NULL,
                `tons` DECIMAL(12,3) NOT NULL DEFAULT 0,
                `time_limit_s` INT NOT NULL DEFAULT 0,
                `state` ENUM('offered','active','done','failed') NOT NULL DEFAULT 'offered',
                `offered_at` DATETIME NOT NULL,
                `taken_at` DATETIME NULL,
                `deadline_at` DATETIME NULL,
                KEY `board` (`station_id`, `state`),
                KEY `mine` (`player_id`, `state`),
                CONSTRAINT `mission_station` FOREIGN KEY (`station_id`)
                    REFERENCES `body` (`id`) ON DELETE CASCADE,
                CONSTRAINT `mission_player` FOREIGN KEY (`player_id`)
                    REFERENCES `player` (`id`) ON DELETE CASCADE,
                CONSTRAINT `mission_commodity` FOREIGN KEY (`commodity_id`)
                    REFERENCES `commodity` (`id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            'ledger' => "CREATE TABLE `ledger` (
                `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `player_id` INT NOT NULL,
                `at` DATETIME NOT NULL,
                `label` VARCHAR(128) NOT NULL,
                `amount` BIGINT NOT NULL,
                -- Баланс ПОСЛЕ операции хранится строкой ленты, а не
                -- считается заново: лента должна читаться как выписка из
                -- банка, в том числе задним числом.
                `balance_after` BIGINT NOT NULL,
                `ref` VARCHAR(64) NOT NULL DEFAULT '',
                KEY `mine` (`player_id`, `id`),
                CONSTRAINT `ledger_player` FOREIGN KEY (`player_id`)
                    REFERENCES `player` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

            'session' => "CREATE TABLE `session` (
                `token` CHAR(64) NOT NULL PRIMARY KEY,
                `player_id` INT NOT NULL,
                `created_at` DATETIME NOT NULL,
                `last_seen_at` DATETIME NOT NULL,
                `expires_at` DATETIME NOT NULL,
                KEY `mine` (`player_id`),
                CONSTRAINT `session_player` FOREIGN KEY (`player_id`)
                    REFERENCES `player` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        ];
    }

    /** Создать базу, если её нет, и вернуть соединение с ней. */
    public static function ensureDatabase(string $dbName): PDO
    {
        $root = Db::connect('');
        $root->exec('CREATE DATABASE IF NOT EXISTS `' . $dbName
            . '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        return Db::connect($dbName);
    }

    /** Создать недостающие таблицы. Существующие не трогает. */
    /**
     * Столбцы, появившиеся позже своих таблиц.
     *
     * Полноценных миграций тут нет и пока не нужно, но и сносить базу
     * ради одного столбца нельзя: в ней живой пилот с деньгами и
     * грузом. Поэтому список недостающих столбцов — и догон по нему.
     */
    public static function columns(): array
    {
        return [
            'ship_type' => [
                'spec' => 'TEXT NULL',
            ],
            'ship' => [
                'hit_at' => 'DATETIME NULL',
            ],
        ];
    }

    /**
     * Столбцы, которых больше быть не должно.
     *
     * Снос нужен затем же, зачем и досоздание: база на второй машине
     * живёт с игроками, и «снеси и залей заново» унесло бы их вместе с
     * лишним столбцом. Здесь лежат числа лётной модели, которые переехали
     * в `ship_type.spec` (версия 5): держать их и столбцом, и в слепке
     * значило бы спрашивать, какая из двух копий настоящая.
     */
    public static function dropped(): array
    {
        return [
            'ship_type' => ['max_speed', 'accel', 'brake', 'lateral',
                'quantum_speed', 'boost_max', 'boost_burn',
                // Версия 6: щит и трюм переехали к модулям, которым они и
                // принадлежат. Столбец остался бы вторым ответом на вопрос,
                // какой у корабля щит, — и отвечал бы за все корабли сразу.
                'shield_max', 'shield_regen', 'shield_delay', 'hold_t'],
        ];
    }

    public static function migrate(): array
    {
        $made = [];
        $have = [];
        foreach (Db::all('SHOW TABLES') as $row) {
            $have[strtolower(reset($row))] = true;
        }
        foreach (self::tables() as $name => $ddl) {
            if (!isset($have[strtolower($name)])) {
                Db::run($ddl);
                $made[] = $name;
                $have[strtolower($name)] = true;
            }
        }
        foreach (self::columns() as $table => $cols) {
            if (!isset($have[strtolower($table)])) {
                continue;                       // таблица только что создана целиком
            }
            $existing = [];
            foreach (Db::all('SHOW COLUMNS FROM `' . $table . '`') as $c) {
                $existing[strtolower($c['Field'])] = true;
            }
            foreach ($cols as $col => $ddl) {
                if (isset($existing[strtolower($col)])) {
                    continue;
                }
                Db::run('ALTER TABLE `' . $table . '` ADD COLUMN `' . $col . '` ' . $ddl);
                $made[] = $table . '.' . $col;
            }
        }
        foreach (self::dropped() as $table => $cols) {
            if (!isset($have[strtolower($table)])) {
                continue;
            }
            $existing = [];
            foreach (Db::all('SHOW COLUMNS FROM `' . $table . '`') as $c) {
                $existing[strtolower($c['Field'])] = true;
            }
            foreach ($cols as $col) {
                if (!isset($existing[strtolower($col)])) {
                    continue;
                }
                Db::run('ALTER TABLE `' . $table . '` DROP COLUMN `' . $col . '`');
                $made[] = '-' . $table . '.' . $col;
            }
        }
        self::setMeta('schema_version', (string) self::VERSION);
        return $made;
    }

    /**
     * Снести всё и создать заново.
     *
     * Внешние ключи выключаются на время сноса: порядок удаления иначе
     * пришлось бы держать руками, а он уже задан ссылками.
     */
    public static function reset(): void
    {
        Db::run('SET FOREIGN_KEY_CHECKS=0');
        foreach (array_reverse(array_keys(self::tables())) as $name) {
            Db::run('DROP TABLE IF EXISTS `' . $name . '`');
        }
        Db::run('SET FOREIGN_KEY_CHECKS=1');
        self::migrate();
    }

    public static function setMeta(string $k, string $v): void
    {
        Db::run('INSERT INTO `meta` (`k`,`v`) VALUES (?,?) ON DUPLICATE KEY UPDATE `v`=VALUES(`v`)', [$k, $v]);
    }

    public static function meta(string $k, ?string $default = null): ?string
    {
        $v = Db::one('SELECT `v` FROM `meta` WHERE `k`=?', [$k]);
        return $v === null ? $default : (string) $v;
    }
}
