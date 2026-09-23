<?php
/**
 * Игрок: создание, полное состояние, сохранение полёта.
 *
 * Это тот кусок, ради которого затевался сервер: сейчас всё состояние
 * игрока лежит в localStorage браузера, то есть у игрока в руках. В
 * онлайне так нельзя — не из-за недоверия, а потому что состояние одно на
 * всех: чужой корабль в порту должен быть там же, где его оставил хозяин.
 *
 * Что сервер проверяет, а что пока нет — важно понимать честно. Проверяются
 * ССЫЛКИ и ПРЕДЕЛЫ: система существует, порт существует и находится в той
 * же системе, корпус не больше заводского, числа — числа. Не проверяется
 * само движение: чтобы поймать «телепорт через полсистемы», нужен счёт
 * физики на сервере, а его нет. Это следующий этап, и до него сервер —
 * хранилище с правилами, а не судья.
 */

final class Players
{
    /** Новый пилот: корабль с завода, стартовый капитал, место в порту. */
    public static function create(string $login, string $passHash, string $name): int
    {
        return Db::tx(function () use ($login, $passHash, $name) {
            $now = Db::now();
            $playerId = Db::insert('player', [
                'login' => $login,
                'pass_hash' => $passHash,
                'name' => $name,
                'created_at' => $now,
                'last_seen_at' => $now,
                'balance' => 0,
            ]);

            $type = Db::row('SELECT * FROM `ship_type` ORDER BY `id` LIMIT 1');
            if ($type === null) {
                throw new RuntimeException('в базе нет ни одного типа кораблей: залейте каталог');
            }

            $shipId = Db::insert('ship', [
                'type_id' => $type['id'],
                'owner_id' => $playerId,
                'name' => '',
                'hull' => $type['hull_max'],
                'shield' => $type['shield_max'],
                'fuel_t' => $type['fuel_t'],
                'created_at' => $now,
            ]);

            // Заводская комплектация: всё, что помечено stock.
            foreach (Db::all('SELECT `id` FROM `equipment_type` WHERE `stock`=1') as $e) {
                Db::insert('ship_equipment', ['ship_id' => $shipId, 'equipment_id' => $e['id']]);
            }

            $start = self::startPoint();
            Db::update('player', [
                'ship_id' => $shipId,
                'system_id' => $start['system_id'],
                'docked_body' => $start['local_id'],
            ], '`id`=?', [$playerId]);

            // Стартовый капитал приходит СТРОКОЙ В ЛЕНТЕ, а не присвоением
            // баланса: в разделе «Финансы» не должно быть денег, взявшихся
            // ниоткуда, — даже первых.
            Ledger::add($playerId, 'НАЧАЛЬНЫЙ КАПИТАЛ', Content::START_BALANCE, 'start');
            return $playerId;
        });
    }

    /** Порт обжитого мира родной системы. */
    public static function startPoint(): array
    {
        $row = Db::row(
            "SELECT st.`system_id`, st.`local_id`
             FROM `body` st
             JOIN `body` w ON w.`system_id` = st.`system_id` AND w.`local_id` = st.`parent_local_id`
             JOIN `star_system` s ON s.`id` = st.`system_id`
             WHERE st.`kind`='station' AND w.`is_home_world`=1 AND s.`is_home`=1
             ORDER BY st.`local_id` LIMIT 1"
        );
        if ($row === null) {
            // Родной системы в каталоге может не оказаться только если его
            // не заливали; лучше честная ошибка, чем игрок в пустоте.
            throw new RuntimeException('в каталоге нет порта родной системы: залейте каталог');
        }
        return ['system_id' => (int) $row['system_id'], 'local_id' => (int) $row['local_id']];
    }

    public static function byId(int $id): array
    {
        $p = Db::row('SELECT * FROM `player` WHERE `id`=?', [$id]);
        if ($p === null) {
            throw ApiError::notFound('нет такого игрока');
        }
        return $p;
    }

    /** Корабль игрока вместе с типом. */
    public static function ship(int $playerId): array
    {
        $row = Db::row(
            'SELECT sh.*, t.`code` AS `type_code`, t.`name` AS `type_name`, t.`title` AS `type_title`,
                    t.`hull_max`, t.`shield_max`, t.`hold_t`, t.`fuel_t` AS `fuel_max`,
                    t.`max_speed`, t.`accel`, t.`brake`, t.`lateral`, t.`quantum_speed`,
                    t.`boost_max`, t.`boost_burn`, t.`length_m`, t.`width_m`, t.`height_m`
             FROM `ship` sh JOIN `ship_type` t ON t.`id` = sh.`type_id`
             WHERE sh.`owner_id`=? ORDER BY sh.`id` LIMIT 1',
            [$playerId]
        );
        if ($row === null) {
            throw ApiError::notFound('у игрока нет корабля');
        }
        return $row;
    }

    /** Полное состояние: то, с чего клиент начинает игру. */
    public static function state(int $playerId): array
    {
        $p = self::byId($playerId);
        $ship = self::ship($playerId);
        $shipId = (int) $ship['id'];

        $equipment = Db::all(
            'SELECT e.`code`, e.`name`, e.`slot`, e.`spec`, se.`level`, se.`health`
             FROM `ship_equipment` se JOIN `equipment_type` e ON e.`id` = se.`equipment_id`
             WHERE se.`ship_id`=? ORDER BY e.`id`',
            [$shipId]
        );
        foreach ($equipment as &$e) {
            $e['spec'] = $e['spec'] === null ? null : json_decode($e['spec'], true);
            $e['level'] = (int) $e['level'];
            $e['health'] = (float) $e['health'];
        }
        unset($e);

        return [
            'player' => [
                'id' => (int) $p['id'],
                'login' => $p['login'],
                'name' => $p['name'],
                'balance' => (int) $p['balance'],
                'playTimeS' => (float) $p['play_time_s'],
                'stats' => [
                    'flownKm' => (float) $p['flown_km'],
                    'docks' => (int) $p['docks'],
                    'landings' => (int) $p['landings'],
                    'crashes' => (int) $p['crashes'],
                ],
            ],
            'position' => [
                'systemId' => $p['system_id'] === null ? null : (int) $p['system_id'],
                'pos' => ['x' => (float) $p['pos_x'], 'y' => (float) $p['pos_y'], 'z' => (float) $p['pos_z']],
                'basis' => $p['basis'] === null ? null : json_decode($p['basis'], true),
                'dockedBody' => $p['docked_body'] === null ? null : (int) $p['docked_body'],
                'landedBody' => $p['landed_body'] === null ? null : (int) $p['landed_body'],
                'landedPose' => $p['landed_pose'] === null ? null : json_decode($p['landed_pose'], true),
            ],
            'ship' => [
                'id' => $shipId,
                'name' => $ship['name'],
                'hull' => (float) $ship['hull'],
                'shield' => (float) $ship['shield'],
                'fuelT' => (float) $ship['fuel_t'],
                'gearOut' => (bool) $ship['gear_out'],
                'type' => [
                    'code' => $ship['type_code'],
                    'name' => $ship['type_name'],
                    'title' => $ship['type_title'],
                    'hullMax' => (float) $ship['hull_max'],
                    'shieldMax' => (float) $ship['shield_max'],
                    'holdT' => (float) $ship['hold_t'],
                    'fuelMaxT' => (float) $ship['fuel_max'],
                    'maxSpeed' => (float) $ship['max_speed'],
                    'accel' => (float) $ship['accel'],
                    'brake' => (float) $ship['brake'],
                    'lateral' => (float) $ship['lateral'],
                    'quantumSpeed' => (float) $ship['quantum_speed'],
                    'boostMax' => (float) $ship['boost_max'],
                    'boostBurn' => (float) $ship['boost_burn'],
                    'lengthM' => (float) $ship['length_m'],
                    'widthM' => (float) $ship['width_m'],
                    'heightM' => (float) $ship['height_m'],
                ],
                'equipment' => $equipment,
            ],
            'cargo' => Cargo::listOf($shipId),
            'holdUsedT' => Cargo::usedTons($shipId),
            'missions' => Missions::mine($playerId),
            'ledger' => Ledger::tail($playerId, 40),
        ];
    }

    /**
     * Сохранение полёта.
     *
     * Принимает ровно то, что игра кладёт сейчас в localStorage, — и это
     * не случайность: смысл в том, чтобы одно хранилище можно было
     * заменить другим, ничего не переписывая в игре.
     */
    public static function save(int $playerId, array $in): array
    {
        $p = self::byId($playerId);
        $ship = self::ship($playerId);

        $num = static function ($v, float $def = 0.0): float {
            return is_numeric($v) && is_finite((float) $v) ? (float) $v : $def;
        };

        $set = [];

        if (isset($in['system'])) {
            $sysId = (int) $in['system'];
            if (Db::one('SELECT `id` FROM `star_system` WHERE `id`=?', [$sysId]) === null) {
                throw ApiError::bad('нет такой системы: ' . $sysId);
            }
            $set['system_id'] = $sysId;
        }
        $sysId = $set['system_id'] ?? ($p['system_id'] === null ? null : (int) $p['system_id']);

        if (isset($in['pos'])) {
            $set['pos_x'] = $num($in['pos']['x'] ?? null);
            $set['pos_y'] = $num($in['pos']['y'] ?? null);
            $set['pos_z'] = $num($in['pos']['z'] ?? null);
        }
        if (isset($in['basis'])) {
            $set['basis'] = json_encode($in['basis']);
        }

        // Тело, у которого стоит корабль, обязано быть в ТОЙ ЖЕ системе.
        // Без этой проверки сохранение «состыкован с портом другой
        // системы» прошло бы молча, а игра после загрузки поставила бы
        // корабль в пустоту.
        $bodyIn = static function ($v) use ($sysId) {
            if ($v === null || $v === '') {
                return null;
            }
            $local = (int) $v;
            if ($sysId === null) {
                throw ApiError::bad('тело указано, а система — нет');
            }
            $ok = Db::one('SELECT `id` FROM `body` WHERE `system_id`=? AND `local_id`=?', [$sysId, $local]);
            if ($ok === null) {
                throw ApiError::bad('в системе ' . $sysId . ' нет тела ' . $local);
            }
            return $local;
        };

        if (array_key_exists('docked', $in)) {
            $set['docked_body'] = $bodyIn($in['docked']);
        }
        if (array_key_exists('landed', $in)) {
            $landed = $in['landed'];
            if (is_array($landed) && isset($landed['id'])) {
                $set['landed_body'] = $bodyIn($landed['id']);
                $set['landed_pose'] = json_encode($landed['pose'] ?? null);
            } else {
                $set['landed_body'] = null;
                $set['landed_pose'] = null;
            }
        }
        if (isset($in['time'])) {
            $set['play_time_s'] = max(0.0, $num($in['time']));
        }
        if (isset($in['stats']) && is_array($in['stats'])) {
            $s = $in['stats'];
            $set['flown_km'] = max(0.0, $num($s['flownKm'] ?? 0));
            $set['docks'] = max(0, (int) ($s['docks'] ?? 0));
            $set['landings'] = max(0, (int) ($s['landings'] ?? 0));
            $set['crashes'] = max(0, (int) ($s['crashes'] ?? 0));
        }

        if ($set) {
            $set['last_seen_at'] = Db::now();
            Db::update('player', $set, '`id`=?', [$playerId]);
        }

        // Состояние корабля живёт в своей таблице: корпус и бак принадлежат
        // КОРАБЛЮ, а не пилоту, и при смене корпуса останутся со старым.
        $shipSet = [];
        if (isset($in['hull'])) {
            // Больше заводского корпус быть не может — это первое, что
            // подделывают, и стоит это одной строки.
            $shipSet['hull'] = max(0.0, min((float) $ship['hull_max'], $num($in['hull'])));
        }
        if (isset($in['fuel'])) {
            $shipSet['fuel_t'] = max(0.0, min((float) $ship['fuel_max'], $num($in['fuel'])));
        }
        if (array_key_exists('gear', $in)) {
            $shipSet['gear_out'] = !empty($in['gear']) ? 1 : 0;
        }
        if ($shipSet) {
            Db::update('ship', $shipSet, '`id`=?', [$ship['id']]);
        }

        return ['saved' => true, 'fields' => count($set) + count($shipSet)];
    }
}
