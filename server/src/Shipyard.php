<?php
/**
 * Верфь корпусов: корабль целиком, а не модуль в гнездо.
 *
 * Корабль покупают в порту, где стоит свой корабль, и новый встаёт в тот
 * же док с заводской комплектацией и полным баком. Прежний остаётся
 * рядом: пересесть — Players::command (два корабля в одном доке —
 * переход по станции), и пересесть обратно можно так же.
 *
 * Где какие корпуса строят — по уровню техники станции (`tech` у корпуса
 * в server/data/specs.php): лёгкий торговец — на любой верфи (уровень 4),
 * крейсер — только в столицах (5). Деньги — только лентой (Ledger::add),
 * как и всё остальное: в выписке видно, что за сколько куплено.
 *
 * Продажа корпуса — следующий шаг: у проданного корабля есть груз, люки,
 * пассажиры и место в базе, и решать за пилота, что с ними, верфь пока не
 * берётся.
 */

final class Shipyard
{
    /** Уровень техники, с которого корпус продают. Нет в файле — только столицы. */
    public static function tech(string $code): int
    {
        foreach (Specs::source()['shipTypes'] as $t) {
            if ($t['code'] === $code) {
                return (int) ($t['tech'] ?? 5);
            }
        }
        return 5;
    }

    /**
     * Заводская комплектация корпуса: общий заводской набор, а в гнёздах,
     * для которых у корпуса свой модуль (`stock` в specs.php), — его.
     */
    public static function stockOf(string $code): array
    {
        $own = [];
        foreach (Specs::source()['shipTypes'] as $t) {
            if ($t['code'] === $code) {
                $own = $t['stock'] ?? [];
            }
        }
        $ids = [];
        foreach (Db::all('SELECT `id`, `slot` FROM `equipment_type` WHERE `stock`=1') as $e) {
            if (!isset($own[$e['slot']])) {
                $ids[] = (int) $e['id'];
            }
        }
        foreach ($own as $slot => $modCode) {
            $id = Db::one('SELECT `id` FROM `equipment_type` WHERE `code`=? AND `slot`=?', [$modCode, $slot]);
            if ($id !== null) {
                $ids[] = (int) $id;
            }
        }
        return $ids;
    }

    /** Порт пилота и его станция — или отказ словами. */
    private static function port(int $playerId): array
    {
        $port = Players::portOrDeny($playerId, 'корабли продают в порту: встаньте в док');
        $info = Stations::info($port['system_id'], $port['local_id']);
        $info['port'] = $port;
        return $info;
    }

    /** Свои корабли в этом доке: на них пересаживаются. */
    private static function here(int $playerId, array $port, int $activeId): array
    {
        $rows = Db::all('SELECT s.`id`, s.`name`, t.`code`, t.`name` AS `type_name`, t.`title`
            FROM `ship` s JOIN `ship_type` t ON t.`id` = s.`type_id`
            WHERE s.`owner_id`=? AND s.`system_id`=? AND s.`docked_body`=? ORDER BY s.`id`',
            [$playerId, $port['system_id'], $port['local_id']]);
        $out = [];
        foreach ($rows as $r) {
            $out[] = ['id' => (int) $r['id'], 'name' => $r['name'], 'type' => $r['code'],
                'typeName' => $r['type_name'], 'title' => $r['title'], 'active' => (int) $r['id'] === $activeId];
        }
        return $out;
    }

    /** Что продаёт верфь этого порта и какие свои корабли стоят здесь. */
    public static function offer(int $playerId): array
    {
        $info = self::port($playerId);
        $port = $info['port'];
        $open = !empty($info['services']['outfit']);
        $hulls = [];
        foreach (Db::all('SELECT * FROM `ship_type` ORDER BY `id`') as $t) {
            $tech = self::tech($t['code']);
            $hulls[] = [
                'code' => $t['code'], 'name' => $t['name'], 'title' => $t['title'],
                'price' => (int) $t['price'], 'tech' => $tech,
                'sold' => $open && $tech <= (int) $info['tech'],
                'lengthM' => (float) $t['length_m'], 'widthM' => (float) $t['width_m'],
                'heightM' => (float) $t['height_m'], 'massT' => (float) $t['mass_t'],
                'hullMax' => (float) $t['hull_max'], 'fuelT' => (float) $t['fuel_t'],
            ];
        }
        return [
            'open' => $open,
            'tech' => (int) $info['tech'],
            'hulls' => $hulls,
            'here' => self::here($playerId, $port, (int) $port['ship']['id']),
        ];
    }

    /**
     * Купить корпус: новый корабль встаёт в этот док. Пилот остаётся в
     * кресле прежнего — пересесть отдельным шагом (ship.command).
     */
    public static function buy(int $playerId, string $code): array
    {
        return Db::tx(function () use ($playerId, $code) {
            $info = self::port($playerId);
            $port = $info['port'];
            if (empty($info['services']['outfit'])) {
                throw ApiError::denied('no_outfit', 'верфи здесь нет: корабли продают на станциях уровня 4–5, '
                    . 'здесь ' . $info['tech']);
            }
            $type = Db::row('SELECT * FROM `ship_type` WHERE `code`=?', [$code]);
            if ($type === null) {
                throw ApiError::notFound('нет такого корпуса: ' . $code);
            }
            $tech = self::tech($code);
            if ($tech > (int) $info['tech']) {
                throw ApiError::denied('no_tech', $type['name'] . ' строят только на станциях уровня '
                    . $tech . ', здесь ' . $info['tech']);
            }
            Ledger::require($playerId, (int) $type['price']);

            $shipId = Db::insert('ship', [
                'type_id' => $type['id'],
                'owner_id' => $playerId,
                'name' => '',
                'hull' => $type['hull_max'],
                // Щит — после комплектации: его ёмкость знает модуль щита
                // (так же, как у нового пилота, Players::create).
                'shield' => 0,
                'fuel_t' => $type['fuel_t'],
                'system_id' => $port['system_id'],
                'docked_body' => $port['local_id'],
                'created_at' => Db::now(),
            ]);
            // Заводская комплектация корпуса (stockOf): общий набор, а у
            // крейсера — свой квантовый привод.
            foreach (self::stockOf($code) as $equipmentId) {
                Db::insert('ship_equipment', ['ship_id' => $shipId, 'equipment_id' => $equipmentId]);
            }
            Loadout::forget($shipId);
            Db::update('ship', ['shield' => Loadout::shield($shipId)['shield_max']], '`id`=?', [$shipId]);

            Ledger::add($playerId, 'ВЕРФЬ · КОРАБЛЬ: ' . $type['name'], -(int) $type['price'], 'hull:' . $code . ':' . $shipId);
            $state = Players::state($playerId);
            $state['bought'] = $shipId;
            return $state;
        });
    }
}
