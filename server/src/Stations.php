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
 */

final class Stations
{
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
    public static function dock(int $playerId, ?int $systemId, ?int $localId): array
    {
        return Db::tx(function () use ($playerId, $systemId, $localId) {
            $p = Players::byId($playerId);
            $sys = $systemId ?? ($p['system_id'] === null ? null : (int) $p['system_id']);
            if ($sys === null || $localId === null) {
                throw ApiError::bad('нужен порт: система и номер тела');
            }
            $info = self::info($sys, $localId);

            // Уже стоим здесь — сбор второй раз не берём. Иначе повторный
            // вызов (а он будет: клиент переспрашивает при потере связи)
            // обчистит игрока.
            if ((int) $p['system_id'] === $sys && (int) $p['docked_body'] === $localId) {
                return ['station' => $info, 'fee' => 0, 'charged' => false,
                    'balance' => (int) $p['balance']];
            }

            $fee = (int) $info['fee'];
            Ledger::require($playerId, $fee);
            Db::update('player', [
                'system_id' => $sys,
                'docked_body' => $localId,
                'landed_body' => null,
                'landed_pose' => null,
                'docks' => (int) $p['docks'] + 1,
                'last_seen_at' => Db::now(),
            ], '`id`=?', [$playerId]);

            $money = $fee > 0
                ? Ledger::add($playerId, 'СТЫКОВОЧНЫЙ СБОР · ' . mb_strtoupper($info['name']),
                    -$fee, 'dock:' . $localId)
                : ['balance' => (int) $p['balance']];

            return ['station' => $info, 'fee' => $fee, 'charged' => $fee > 0,
                'balance' => $money['balance']];
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
            $p = Players::byId($playerId);
            $ship = Players::ship($playerId);
            if ($p['docked_body'] === null || $p['system_id'] === null) {
                throw ApiError::denied('not_docked', 'чинят в порту');
            }
            $info = self::info((int) $p['system_id'], (int) $p['docked_body']);
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
