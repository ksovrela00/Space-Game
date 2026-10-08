<?php
/**
 * Порты: свойства, стыковка со сбором, ремонт.
 *
 * Станция лежит в `body` как тело — у неё есть орбита, радиус и хозяин,
 * как у луны. Но всё остальное у неё своё: сбор за стыковку, уровень
 * техники, набор услуг. Держать это в `body` значило бы завести десяток
 * столбцов, пустых у ста тел из ста шестнадцати, поэтому свойства живут
 * в `station`, а `body` остаётся про геометрию.
 *
 * Честно про стыковку: сервер НЕ ЗНАЕТ, подлетел ли корабль к порту на
 * самом деле. Он знает только то, что прислал клиент. Проверить это можно
 * будет, когда физика поедет на сервер; до тех пор `station.dock` — это
 * «запиши, что я в порту, и возьми с меня сбор», а не пропуск в шлюз.
 *
 * ЗАЛ И ПЛОЩАДКИ (схема 13). За щелью — зал с площадками
 * (js/game/stationplan.js), и встаёт корабль не «в порт вообще», а на
 * площадку. Площадку выдаёт порт (request): ему видно, какие заняты, а
 * двоим на одну садиться нельзя. Выданная держится за кораблём RESERVE_S —
 * на заход по тоннелю и посадку; стоящий на ней — пока не взлетит.
 */

final class Stations
{
    /** Сколько держится выданная, но не занятая площадка, с. */
    public const RESERVE_S = 600;

    /** Малая площадка берёт корабль до восьмидесяти метров (js/game/stationplan.js, padSizeFor). */
    public const PAD_S_MAX = 80.0;

    /** Какая площадка нужна кораблю: S или L — по его габаритам. */
    public static function padSizeOf(array $ship): string
    {
        $m = max((float) ($ship['length_m'] ?? 0), (float) ($ship['width_m'] ?? 0));
        return $m <= self::PAD_S_MAX ? 'S' : 'L';
    }

    /** Площадки станции: номер, размер, середина (м, оси станции). */
    public static function padsOf(int $systemId, int $localId): array
    {
        return Db::all(
            'SELECT sp.* FROM `station_pad` sp JOIN `body` b ON b.`id` = sp.`station_id`
             WHERE b.`system_id`=? AND b.`local_id`=? ORDER BY sp.`n`',
            [$systemId, $localId]
        );
    }

    /**
     * Номера площадок, которые держат другие корабли: стоят на них или им их
     * выдали.
     *
     * Стоящий корабль держит площадку, только пока его хозяин В ИГРЕ: корабль
     * того, кого нет, из мира пропадает (Hub, «в мире только те, кто в
     * игре»), и площадка под ним для остальных пуста. Вернётся хозяин, а на
     * его площадке уже стоит другой, — его корабль встанет на свободную
     * (Players::state, settle). Так и в ангарах Star Citizen: вышел из
     * игры — корабль ушёл в хранилище.
     */
    public static function busyPads(int $systemId, int $localId, int $exceptShip): array
    {
        // Вездеход в трюме (stowed) площадку не держит: место порта у него —
        // носителя (carryAlong), с тем же номером площадки, и раньше он
        // «занимал» её у собственного корабля. Повторная стыковка на свою
        // площадку получала отказ «площадка занята» (409), а при входе в игру
        // корабль переезжал с неё (settle), будто её занял другой.
        $rows = Db::all(
            'SELECT s.`pad` FROM `ship` s JOIN `player` p ON p.`id` = s.`owner_id`
             WHERE s.`system_id`=? AND s.`berth_station`=? AND s.`pad` IS NOT NULL
               AND s.`id`<>? AND s.`stored`=0 AND s.`stowed`=0
               AND ((s.`docked_body`=? AND p.`online`=1) OR (s.`docked_body` IS NULL AND s.`pad_at` > ?))',
            [$systemId, $localId, $exceptShip, $localId, Db::at(-self::RESERVE_S)]
        );
        return array_map(static function ($r) { return (int) $r['pad']; }, $rows);
    }

    /**
     * Стоит ли корабль в хранилище порта: отмечен так (stored) — или он в
     * порту, но в зал станции не вставал вовсе (berth_station пуст), как
     * корабли, вставшие в порт до схемы 13. Зала тогда не было, и у пульта
     * ангарной службы для них не было ни кнопки «вызвать», ни «путь к нему»,
     * а «пересесть» передавало командование кораблю без места в зале.
     * Любая стыковка по схеме 13 отмечает станцию — и севший на пол зала
     * мимо площадок в хранилище не попадает.
     */
    public static function inStorage(array $ship): bool
    {
        if ($ship['docked_body'] === null || ($ship['carrier_id'] ?? null) !== null) {
            return false;
        }
        return (int) ($ship['stored'] ?? 0) === 1 || (($ship['pad'] ?? null) === null && ($ship['berth_station'] ?? null) === null);
    }

    /**
     * Корабль вернувшегося в игру стоит на площадке, которую за это время
     * занял другой (в игре): встать на свободную. Свободной нет — в
     * хранилище порта.
     */
    public static function settle(array $ship): void
    {
        if ($ship['docked_body'] === null || $ship['pad'] === null || (int) ($ship['stored'] ?? 0) === 1
            || $ship['system_id'] === null) {
            return;
        }
        $sys = (int) $ship['system_id'];
        $st = (int) $ship['docked_body'];
        if (in_array((int) $ship['pad'], self::busyPads($sys, $st, (int) $ship['id']), true)) {
            self::park((int) $ship['id'], $sys, $st);
        }
    }

    /**
     * Свободная площадка под корабль размера need: малому — сперва малая
     * (большие остаются крейсерам), крупному — только большая. Нет — null.
     */
    public static function freePad(int $systemId, int $localId, string $need, int $exceptShip): ?int
    {
        $busy = array_flip(self::busyPads($systemId, $localId, $exceptShip));
        $pads = self::padsOf($systemId, $localId);
        foreach ($need === 'S' ? ['S', 'L'] : ['L'] as $want) {
            foreach ($pads as $p) {
                if ($p['size'] === $want && !isset($busy[(int) $p['n']])) {
                    return (int) $p['n'];
                }
            }
        }
        return null;
    }

    /**
     * Поза корабля на середине площадки (км, оси станции): нос — по оси
     * порта, брюхом к полу, центр масс — на просвете шасси над плитой.
     * Так ставят корабль, у которого своей позы нет: новый, из хранилища,
     * после страховки.
     */
    public static function padPose(int $systemId, int $localId, int $n, float $gearClearM): ?array
    {
        $p = Db::row(
            'SELECT sp.* FROM `station_pad` sp JOIN `body` b ON b.`id` = sp.`station_id`
             WHERE b.`system_id`=? AND b.`local_id`=? AND sp.`n`=?',
            [$systemId, $localId, $n]
        );
        if ($p === null) {
            return null;
        }
        return [
            'pos' => ['x' => (float) $p['x_m'] / 1000, 'y' => ((float) $p['y_m'] + 0.05 + $gearClearM) / 1000,
                'z' => (float) $p['z_m'] / 1000],
            'fwd' => ['x' => 0.0, 'y' => 0.0, 'z' => 1.0],
            'up' => ['x' => 0.0, 'y' => 1.0, 'z' => 0.0],
        ];
    }

    /**
     * Поставить корабль на свободную площадку станции — с позой посередине.
     * Так встаёт новый корабль, корабль после страховки и после буксира.
     * Свободной нет — стоит в хранилище порта (stored): вызовут, когда
     * освободится.
     */
    public static function park(int $shipId, int $systemId, int $localId): ?int
    {
        $ship = Db::row('SELECT sh.*, t.`length_m`, t.`width_m`, t.`gear_clear_m` FROM `ship` sh
             JOIN `ship_type` t ON t.`id` = sh.`type_id` WHERE sh.`id`=?', [$shipId]);
        if ($ship === null) {
            return null;
        }
        $n = self::freePad($systemId, $localId, self::padSizeOf($ship), $shipId);
        $pose = $n === null ? null : self::padPose($systemId, $localId, $n, (float) $ship['gear_clear_m']);
        Db::update('ship', [
            'pad' => $n, 'berth_station' => $localId, 'pad_at' => Db::now(),
            'dock_pose' => $pose === null ? null : json_encode($pose), 'stored' => $n === null ? 1 : 0,
        ], '`id`=?', [$shipId]);
        return $n;
    }

    /**
     * Площадка у порта: корабль вошёл в щель или включил докинг-компьютер.
     * За кораблём уже есть площадка этой станции — та же (выдача продлевается).
     */
    public static function request(int $playerId, ?int $systemId, ?int $localId): array
    {
        return Db::tx(function () use ($playerId, $systemId, $localId) {
            $p = Players::byId($playerId);
            $ship = Players::ship($playerId);
            $shipId = (int) $ship['id'];
            if ((int) $p['aboard_ship'] !== $shipId) {
                throw ApiError::denied('not_aboard', 'площадку просит тот, кто ведёт корабль');
            }
            if (Specs::isGround((string) $ship['type_code'])) {
                throw ApiError::denied('ground', 'вездеход в порт не встаёт: он ездит по грунту');
            }
            $sys = $systemId ?? ($ship['system_id'] === null ? null : (int) $ship['system_id']);
            if ($sys === null || $localId === null) {
                throw ApiError::bad('нужен порт: система и номер тела');
            }
            self::info($sys, $localId);
            $need = self::padSizeOf($ship);
            if ($ship['pad'] !== null && (int) $ship['berth_station'] === $localId
                && (int) $ship['system_id'] === $sys) {
                Db::update('ship', ['pad_at' => Db::now()], '`id`=?', [$shipId]);
                return ['pad' => (int) $ship['pad'], 'size' => $need];
            }
            $n = self::freePad($sys, $localId, $need, $shipId);
            if ($n === null) {
                throw ApiError::denied('no_pad', 'свободных площадок нет — ждите в зале');
            }
            Db::update('ship', ['pad' => $n, 'berth_station' => $localId, 'pad_at' => Db::now()],
                '`id`=?', [$shipId]);
            return ['pad' => $n, 'size' => $need];
        });
    }

    /** Поза из чужих рук: место (км, не дальше двух от центра станции) и единичные оси. */
    private static function poseIn($v): ?array
    {
        if (!is_array($v)) {
            return null;
        }
        $vec = static function ($a, float $lim) {
            if (!is_array($a)) {
                return null;
            }
            $o = [];
            foreach (['x', 'y', 'z'] as $k) {
                $x = $a[$k] ?? null;
                if (!is_numeric($x) || !is_finite((float) $x) || abs((float) $x) > $lim) {
                    return null;
                }
                $o[$k] = (float) $x;
            }
            return $o;
        };
        $pos = $vec($v['pos'] ?? null, 2.0);
        $fwd = $vec($v['fwd'] ?? null, 1.01);
        $up = $vec($v['up'] ?? null, 1.01);
        if ($pos === null || $fwd === null || $up === null) {
            return null;
        }
        foreach ([$fwd, $up] as $d) {
            if (abs(sqrt($d['x'] ** 2 + $d['y'] ** 2 + $d['z'] ** 2) - 1) > 0.01) {
                return null;
            }
        }
        return ['pos' => $pos, 'fwd' => $fwd, 'up' => $up];
    }

    /** Площадки и помещения станции — то, что лежит в базе. */
    public static function layout(int $systemId, int $localId): array
    {
        $info = self::info($systemId, $localId);
        $pads = [];
        foreach (self::padsOf($systemId, $localId) as $p) {
            $pads[] = ['n' => (int) $p['n'], 'size' => $p['size'], 'side' => (int) $p['side'],
                'x' => (float) $p['x_m'], 'z' => (float) $p['z_m'], 'w' => (float) $p['w_m'], 'd' => (float) $p['d_m']];
        }
        $rooms = [];
        foreach (Db::all(
            'SELECT r.* FROM `station_room` r JOIN `body` b ON b.`id` = r.`station_id`
             WHERE b.`system_id`=? AND b.`local_id`=? ORDER BY r.`id`',
            [$systemId, $localId]
        ) as $r) {
            $rooms[] = ['code' => $r['code'], 'kind' => $r['kind'], 'name' => $r['name'],
                'shop' => $r['shop'], 'pad' => $r['pad'] === null ? null : (int) $r['pad'],
                'areaM2' => (float) $r['area_m2'], 'tenant' => $r['tenant_id'] === null ? null : (int) $r['tenant_id']];
        }
        return ['station' => $info, 'pads' => $pads, 'rooms' => $rooms];
    }
    /** Свойства порта вместе с его телом. */
    public static function info(int $systemId, int $localId): array
    {
        $body = Galaxy::body($systemId, $localId);
        if ($body['kind'] !== 'station') {
            throw ApiError::bad('это не станция: ' . $body['name']);
        }
        $st = Db::row('SELECT * FROM `station` WHERE `body_id`=?', [$body['id']]);
        if ($st === null) {
            throw ApiError::notFound('у порта нет свойств: залейте каталог заново');
        }
        return self::out($st, $body, $systemId, $localId);
    }

    /** Все порты системы. */
    public static function listOf(int $systemId): array
    {
        $rows = Db::all(
            'SELECT st.*, b.`local_id`, b.`parent_local_id`, b.`orbit_radius_km`,
                    p.`name` AS `world_name`
             FROM `station` st
             JOIN `body` b ON b.`id` = st.`body_id`
             LEFT JOIN `body` p ON p.`system_id` = b.`system_id` AND p.`local_id` = b.`parent_local_id`
             WHERE st.`system_id`=? ORDER BY b.`local_id`',
            [$systemId]
        );
        $out = [];
        foreach ($rows as $r) {
            $out[] = array_merge(
                self::out($r, null, $systemId, (int) $r['local_id']),
                ['world' => $r['world_name'], 'orbitRadiusKm' => (float) $r['orbit_radius_km']]
            );
        }
        return $out;
    }

    /**
     * Встать в порт: сбор берётся один раз, при стыковке.
     *
     * Первый постоянный расход в игре. Без расходов деньги только копятся,
     * и любая награда обесценивается к третьему часу.
     */
    public static function dock(int $playerId, ?int $systemId, ?int $localId, ?int $pad = null, $pose = null): array
    {
        return Db::tx(function () use ($playerId, $systemId, $localId, $pad, $pose) {
            $p = Players::byId($playerId);
            // Встаёт в порт КОРАБЛЬ, которым пилот командует, и пилот на
            // его борту: стыкует тот, кто сидит в кресле.
            $ship = Players::ship($playerId);
            $shipId = (int) $ship['id'];
            if ((int) $p['aboard_ship'] !== $shipId) {
                throw ApiError::denied('not_aboard', 'в порт ставит корабль тот, кто на его борту');
            }
            // Вездеход не летает — и в порт на орбите не встаёт.
            if (Specs::isGround((string) $ship['type_code'])) {
                throw ApiError::denied('ground', 'вездеход в порт не встаёт: он ездит по грунту');
            }
            $shipSys = $ship['system_id'] === null ? null : (int) $ship['system_id'];
            $sys = $systemId ?? $shipSys;
            if ($sys === null || $localId === null) {
                throw ApiError::bad('нужен порт: система и номер тела');
            }
            $info = self::info($sys, $localId);

            // Где на полу зала: площадка (если сел на неё) и поза. Чужую —
            // ту, что держит другой корабль, — не даём: двое на одной плите
            // стояли бы друг в друге. Малая не держит крупный корабль.
            $berth = ['berth_station' => $localId, 'pad' => null, 'pad_at' => Db::now(),
                'dock_pose' => null, 'stored' => 0];
            if ($pad !== null) {
                $row = null;
                foreach (self::padsOf($sys, $localId) as $q) {
                    if ((int) $q['n'] === $pad) {
                        $row = $q;
                    }
                }
                if ($row === null) {
                    throw ApiError::bad('на станции нет площадки ' . $pad);
                }
                if ($row['size'] === 'S' && self::padSizeOf($ship) === 'L') {
                    throw ApiError::denied('pad_small', 'площадка ' . $pad . ' мала для этого корабля');
                }
                if (in_array($pad, self::busyPads($sys, $localId, $shipId), true)) {
                    throw ApiError::denied('pad_busy', 'площадка ' . $pad . ' занята');
                }
                $berth['pad'] = $pad;
            }
            $poseIn = self::poseIn($pose);
            if ($poseIn !== null) {
                $berth['dock_pose'] = json_encode($poseIn);
            } elseif ($berth['pad'] !== null) {
                $pp = self::padPose($sys, $localId, $berth['pad'], (float) Db::one(
                    'SELECT `gear_clear_m` FROM `ship_type` WHERE `id`=?', [(int) $ship['type_id']]));
                $berth['dock_pose'] = $pp === null ? null : json_encode($pp);
            }

            // Уже стоим здесь — сбор второй раз не берём. Иначе повторный
            // вызов (а он будет: клиент переспрашивает при потере связи)
            // обчистит игрока.
            if ($shipSys === $sys && (int) $ship['docked_body'] === $localId) {
                Db::update('ship', $berth, '`id`=?', [$shipId]);
                return ['station' => $info, 'fee' => 0, 'charged' => false,
                    'balance' => (int) $p['balance'], 'pad' => $berth['pad']];
            }

            $fee = (int) $info['fee'];
            Ledger::require($playerId, $fee);
            // Встал в порт ДРУГОЙ системы — значит, прилетел туда варпом,
            // даже если сохранение об этом ещё не рассказало. Платят за
            // прыжок и здесь: иначе довольно было бы не сохраняться до
            // стыковки, и варп ничего бы не стоил.
            Fuel::arriveShip($shipId, $shipSys, $sys);
            Db::update('ship', [
                'system_id' => $sys,
                'docked_body' => $localId,
                'landed_body' => null,
                'landed_pose' => null,
                'landed_secured' => 0,
                'anchor_body' => null,
                'anchor_pose' => null,
                'hatches' => null,
            ] + $berth, '`id`=?', [$shipId]);
            Players::carryAlong($shipId);
            Db::update('player', [
                'docks' => (int) $p['docks'] + 1,
                'last_seen_at' => Db::now(),
            ], '`id`=?', [$playerId]);
            Db::run('UPDATE `player` SET `system_id`=? WHERE `aboard_ship`=?', [$sys, $shipId]);

            $money = $fee > 0
                ? Ledger::add($playerId, 'СТЫКОВОЧНЫЙ СБОР · ' . mb_strtoupper($info['name']),
                    -$fee, 'dock:' . $localId)
                : ['balance' => (int) $p['balance']];

            return ['station' => $info, 'fee' => $fee, 'charged' => $fee > 0,
                'balance' => $money['balance'], 'pad' => $berth['pad']];
        });
    }

    /**
     * Выйти из порта.
     *
     * Действие, а не поле сохранения — по той же причине, что и стыковка:
     * сохранение идёт фоном и опаздывает, и опоздавшее «в доке» после
     * вылета вернуло бы корабль в порт. Повторный вызов ничего не делает:
     * игра переспрашивает после обрыва связи.
     */
    public static function undock(int $playerId): array
    {
        return Db::tx(function () use ($playerId) {
            $p = Players::byId($playerId);
            $ship = Players::ship($playerId);
            $shipId = (int) $ship['id'];
            if ((int) $p['aboard_ship'] !== $shipId) {
                throw ApiError::denied('not_aboard', 'из порта выводит корабль тот, кто на его борту');
            }
            if ($ship['docked_body'] !== null) {
                // Площадка свободна сразу: корабль от неё оторвался и летит по
                // залу к тоннелю.
                Db::update('ship', ['docked_body' => null, 'dock_pose' => null, 'pad' => null,
                    'berth_station' => null, 'pad_at' => null], '`id`=?', [$shipId]);
                Players::carryAlong($shipId);
            }
            return ['undocked' => true];
        });
    }

    /**
     * Ремонт корпуса.
     *
     * До сих пор стыковка чинила корабль даром — то есть у корпуса не было
     * цены, и разбить его было не страшно. Теперь есть: чинят только там,
     * где есть чем, и за кроны.
     */
    public static function repair(int $playerId): array
    {
        return Db::tx(function () use ($playerId) {
            $port = Players::portOrDeny($playerId, 'чинят в порту');
            $ship = $port['ship'];
            $info = self::info($port['system_id'], $port['local_id']);
            if (!$info['services']['repair']) {
                throw ApiError::denied('no_service', 'здесь нечем чинить: уровень техники '
                    . $info['tech']);
            }

            $missing = (float) $ship['hull_max'] - (float) $ship['hull'];
            if ($missing <= 0.01) {
                throw ApiError::denied('no_damage', 'корпус цел');
            }
            $cost = (int) ceil($missing * (float) $info['repairRate']);
            Ledger::require($playerId, $cost);

            Db::update('ship', ['hull' => $ship['hull_max']], '`id`=?', [$ship['id']]);
            $money = Ledger::add($playerId, 'РЕМОНТ КОРПУСА · ' . mb_strtoupper($info['name']),
                -$cost, 'repair:' . $ship['id']);

            return [
                'hull' => (float) $ship['hull_max'],
                'repaired' => round($missing, 1),
                'cost' => $cost,
                'balance' => $money['balance'],
            ];
        });
    }

    private static function out(array $st, ?array $body, int $systemId, int $localId): array
    {
        return [
            'systemId' => $systemId,
            'localId' => $localId,
            'name' => $st['name'],
            'worldType' => $st['world_type'],
            'tech' => (int) $st['tech'],
            'fee' => (int) $st['fee'],
            'repairRate' => (float) $st['repair_rate'],
            'pads' => (int) $st['pads'],
            'services' => [
                'market' => (bool) $st['has_market'],
                'board' => (bool) $st['has_board'],
                'repair' => (bool) $st['has_repair'],
                'outfit' => (bool) $st['has_outfit'],
            ],
        ];
    }
}
