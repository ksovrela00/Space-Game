<?php
/**
 * Заливка базы: каталог из выгрузки генератора + содержимое экономики.
 *
 * Заливка ИДЕМПОТЕНТНА: её можно гонять сколько угодно раз, и вторая
 * заливка ничего не портит. Это не аккуратность ради аккуратности — тела
 * в базе связаны с рынком и заданиями внешними ключами, и «снести и
 * залить заново» уносило бы вместе с ними чужие склады и чьи-то взятые
 * подряды. Поэтому строки обновляются на месте по устойчивому ключу
 * (система + локальный номер тела).
 */

final class Seeder
{
    /**
     * Залить всё разом.
     *
     * Единственный вход для заливки — и CLI, и проверки зовут именно его.
     * Пока шагов было три, они были выписаны в обоих местах по отдельности,
     * и добавление четвёртого (свойства портов) сломало проверки: они
     * заливали базу по-старому и падали в другом месте. Один вызов —
     * разойтись негде.
     */
    public static function all(array $catalog, bool $forceMarket = false): array
    {
        $n = self::content($catalog);
        $n += self::catalog($catalog);
        $n['station'] = self::stations();
        $n['market'] = self::markets($forceMarket);
        return $n;
    }

    /** Товары, типы кораблей и модули. */
    public static function content(array $catalog): array
    {
        $n = ['commodity' => 0, 'ship_type' => 0, 'equipment_type' => 0];

        foreach (Content::COMMODITIES as $c) {
            Db::run(
                'INSERT INTO `commodity` (`code`,`name`,`category`,`base_price`,`spread`,`legal`)
                 VALUES (?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `category`=VALUES(`category`),
                   `base_price`=VALUES(`base_price`), `spread`=VALUES(`spread`), `legal`=VALUES(`legal`)',
                [$c['code'], $c['name'], $c['category'], $c['base'], $c['spread'], $c['legal']]
            );
            $n['commodity']++;
        }

        // Числа корабля, оружия и модулей приходят из server/data/specs.php:
        // это бэкенд, и он им хозяин. Из выгрузки генератора берутся только
        // ГАБАРИТЫ — их диктует сам меш корпуса (js/models/ships.js), и
        // вписывать их руками значило бы завести второй ответ на вопрос,
        // какой корабль длины.
        $specs = Specs::source();
        $size = [];
        foreach ($catalog['shipTypes'] ?? [] as $t) {
            $size[$t['code']] = $t;
        }

        foreach ($specs['shipTypes'] as $t) {
            $spec = $t['spec'];
            $dim = $size[$t['code']] ?? [];
            Db::run(
                'INSERT INTO `ship_type`
                   (`code`,`name`,`title`,`hull_max`,`shield_max`,`shield_regen`,`shield_delay`,
                    `hold_t`,`fuel_t`,`length_m`,`width_m`,`height_m`,`price`,`spec`)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `title`=VALUES(`title`),
                   `hull_max`=VALUES(`hull_max`), `shield_max`=VALUES(`shield_max`),
                   `shield_regen`=VALUES(`shield_regen`), `shield_delay`=VALUES(`shield_delay`),
                   `hold_t`=VALUES(`hold_t`), `fuel_t`=VALUES(`fuel_t`),
                   `length_m`=VALUES(`length_m`), `width_m`=VALUES(`width_m`),
                   `height_m`=VALUES(`height_m`), `price`=VALUES(`price`), `spec`=VALUES(`spec`)',
                [
                    $t['code'], $t['name'], $t['title'] ?? '',
                    $spec['maxHull'], $spec['maxShield'], $spec['shieldRegen'], $spec['shieldDelay'],
                    $spec['hold'], $spec['fuelMax'],
                    $dim['lengthM'] ?? 0, $dim['widthM'] ?? 0, $dim['heightM'] ?? 0,
                    (int) ($t['price'] ?? 0),
                    // В `spec` едет лётная модель БЕЗ тех шести чисел, что
                    // легли столбцами: одно число — одно место.
                    json_encode(Specs::specRest($spec), JSON_UNESCAPED_UNICODE),
                ]
            );
            $n['ship_type']++;
        }

        foreach (Specs::equipmentRows($specs) as $e) {
            Db::run(
                'INSERT INTO `equipment_type` (`code`,`name`,`slot`,`spec`,`price`,`stock`)
                 VALUES (?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `slot`=VALUES(`slot`),
                   `spec`=VALUES(`spec`), `price`=VALUES(`price`), `stock`=VALUES(`stock`)',
                [
                    $e['code'], $e['name'], $e['slot'],
                    json_encode($e['spec'], JSON_UNESCAPED_UNICODE),
                    $e['price'],
                    // `stock` здесь значит «стоит на корабле с завода».
                    $e['stock'] ? 1 : 0,
                ]
            );
            $n['equipment_type']++;
        }

        // Общие числа боя своей таблицы не стоят: их три, и таблица ради
        // трёх чисел — это лишняя связь, а не порядок.
        Schema::setMeta(Specs::META_KEY, json_encode($specs['combat'] ?? [], JSON_UNESCAPED_UNICODE));

        return $n;
    }

    /** Системы и тела. */
    public static function catalog(array $catalog): array
    {
        $n = ['star_system' => 0, 'body' => 0];

        foreach ($catalog['systems'] as $s) {
            Db::run(
                'INSERT INTO `star_system`
                   (`id`,`seed`,`name`,`star_class`,`luminosity`,`star_radius_km`,`star_temp_k`,
                    `habitable_km`,`is_home`,`pos_x`,`pos_y`,`pos_z`)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE `seed`=VALUES(`seed`), `name`=VALUES(`name`),
                   `star_class`=VALUES(`star_class`), `luminosity`=VALUES(`luminosity`),
                   `star_radius_km`=VALUES(`star_radius_km`), `star_temp_k`=VALUES(`star_temp_k`),
                   `habitable_km`=VALUES(`habitable_km`), `is_home`=VALUES(`is_home`),
                   `pos_x`=VALUES(`pos_x`), `pos_y`=VALUES(`pos_y`), `pos_z`=VALUES(`pos_z`)',
                [
                    $s['id'], $s['seed'], $s['name'], $s['starClass'], $s['luminosity'],
                    $s['starRadiusKm'], $s['starTempK'], $s['habitableKm'], $s['home'] ? 1 : 0,
                    $s['pos']['x'], $s['pos']['y'], $s['pos']['z'],
                ]
            );
            $n['star_system']++;

            foreach ($s['bodies'] as $b) {
                Db::run(
                    'INSERT INTO `body`
                       (`system_id`,`local_id`,`parent_local_id`,`kind`,`type`,`name`,`radius_km`,
                        `orbit_radius_km`,`orbit_period_s`,`orbit_phase`,`orbit_plane`,
                        `spin_period_s`,`press_bar`,`has_rings`,`has_station`,`is_home_world`,`landable`)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                     ON DUPLICATE KEY UPDATE `parent_local_id`=VALUES(`parent_local_id`),
                       `kind`=VALUES(`kind`), `type`=VALUES(`type`), `name`=VALUES(`name`),
                       `radius_km`=VALUES(`radius_km`), `orbit_radius_km`=VALUES(`orbit_radius_km`),
                       `orbit_period_s`=VALUES(`orbit_period_s`), `orbit_phase`=VALUES(`orbit_phase`),
                       `orbit_plane`=VALUES(`orbit_plane`), `spin_period_s`=VALUES(`spin_period_s`),
                       `press_bar`=VALUES(`press_bar`), `has_rings`=VALUES(`has_rings`),
                       `has_station`=VALUES(`has_station`), `is_home_world`=VALUES(`is_home_world`),
                       `landable`=VALUES(`landable`)',
                    [
                        $s['id'], $b['localId'], $b['parentLocalId'], $b['kind'], $b['type'], $b['name'],
                        $b['radiusKm'], $b['orbitRadiusKm'], $b['orbitPeriodS'], $b['orbitPhase'],
                        $b['orbitPlane'] === null ? null : json_encode($b['orbitPlane']),
                        $b['spinPeriodS'], $b['pressBar'],
                        $b['hasRings'] ? 1 : 0, $b['hasStation'] ? 1 : 0,
                        !empty($b['isHomeWorld']) ? 1 : 0, $b['landable'] ? 1 : 0,
                    ]
                );
                $n['body']++;
            }
        }

        Schema::setMeta('galaxy_seed', (string) $catalog['galaxySeed']);
        Schema::setMeta('catalog_generated_at', (string) $catalog['generatedAt']);
        Schema::setMeta('catalog_seeded_at', Db::now());
        return $n;
    }

    /**
     * Свойства станций.
     *
     * Считаются от вида мира, вокруг которого станция висит, и от того,
     * обжитой ли он. Как и склады, заливка идёт на месте: сбор и услуги
     * не должны меняться от того, что каталог перезалили.
     */
    public static function stations(): int
    {
        $rows = Db::all(
            "SELECT s.`id`, s.`system_id`, s.`name`,
                    COALESCE(p.`type`, 'station') AS `world`,
                    COALESCE(p.`is_home_world`, 0) AS `home`
             FROM `body` s
             LEFT JOIN `body` p ON p.`system_id` = s.`system_id` AND p.`local_id` = s.`parent_local_id`
             WHERE s.`kind` = 'station'"
        );
        $n = 0;
        Db::tx(function () use ($rows, &$n) {
            foreach ($rows as $st) {
                $a = Content::stationOf($st['world'], (int) $st['id'], (bool) $st['home']);
                Db::run(
                    'INSERT INTO `station`
                       (`body_id`,`system_id`,`name`,`world_type`,`tech`,`fee`,
                        `has_market`,`has_board`,`has_repair`,`has_outfit`,`repair_rate`,`pads`)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                     ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `world_type`=VALUES(`world_type`),
                       `tech`=VALUES(`tech`), `fee`=VALUES(`fee`), `has_market`=VALUES(`has_market`),
                       `has_board`=VALUES(`has_board`), `has_repair`=VALUES(`has_repair`),
                       `has_outfit`=VALUES(`has_outfit`), `repair_rate`=VALUES(`repair_rate`),
                       `pads`=VALUES(`pads`)',
                    [
                        $st['id'], $st['system_id'], $st['name'], $st['world'],
                        $a['tech'], $a['fee'], $a['has_market'], $a['has_board'],
                        $a['has_repair'], $a['has_outfit'], $a['repair_rate'], $a['pads'],
                    ]
                );
                $n++;
            }
        });
        return $n;
    }

    /**
     * Склады станций.
     *
     * Цена берётся от ВИДА МИРА, вокруг которого станция висит: это и
     * делает перелёт осмысленным. Товар, который здесь производят, стоит
     * дёшево и лежит на складе; тот, которого ждут, — дорог, и склад пуст.
     */
    public static function markets(bool $force = false): int
    {
        $stations = Db::all(
            "SELECT s.`id`, s.`system_id`, COALESCE(p.`type`, 'station') AS `world`
             FROM `body` s
             LEFT JOIN `body` p ON p.`system_id` = s.`system_id` AND p.`local_id` = s.`parent_local_id`
             WHERE s.`kind` = 'station'"
        );
        $goods = Db::all('SELECT `id`, `code` FROM `commodity`');
        $byCode = [];
        foreach (Content::COMMODITIES as $c) {
            $byCode[$c['code']] = $c;
        }

        $rows = 0;
        Db::tx(function () use ($stations, $goods, $byCode, $force, &$rows) {
            $now = Db::now();
            foreach ($stations as $st) {
                foreach ($goods as $g) {
                    $def = $byCode[$g['code']] ?? null;
                    if ($def === null) {
                        continue;
                    }
                    if (!Content::offeredAt($def, $st['world'], (int) $st['id'])) {
                        Db::run(
                            'DELETE FROM `market` WHERE `station_id`=? AND `commodity_id`=?',
                            [$st['id'], $g['id']]
                        );
                        continue;
                    }
                    $p = Content::priceAt($def, $st['world'], (int) $st['id']);
                    // Без --force склад не трогаем: игроки уже могли с него
                    // скупить товар, и пересчёт вернул бы его из воздуха.
                    $sql = $force
                        ? 'INSERT INTO `market` (`station_id`,`commodity_id`,`price`,`stock`,`updated_at`)
                           VALUES (?,?,?,?,?)
                           ON DUPLICATE KEY UPDATE `price`=VALUES(`price`), `stock`=VALUES(`stock`),
                             `updated_at`=VALUES(`updated_at`)'
                        : 'INSERT INTO `market` (`station_id`,`commodity_id`,`price`,`stock`,`updated_at`)
                           VALUES (?,?,?,?,?)
                           ON DUPLICATE KEY UPDATE `price`=VALUES(`price`), `updated_at`=VALUES(`updated_at`)';
                    Db::run($sql, [$st['id'], $g['id'], $p['price'], $p['stock'], $now]);
                    $rows++;
                }
            }
        });
        return $rows;
    }

    /** Прочитать выгрузку генератора. */
    public static function readCatalog(string $path): array
    {
        if (!is_file($path)) {
            throw new RuntimeException(
                "нет выгрузки каталога: $path\n" .
                'сначала: node tools/export.mjs'
            );
        }
        $data = json_decode((string) file_get_contents($path), true);
        if (!is_array($data) || empty($data['systems'])) {
            throw new RuntimeException("выгрузка каталога испорчена: $path");
        }
        return $data;
    }
}
