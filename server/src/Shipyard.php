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

    /**
     * Купить вездеход в трюм своего корабля. Встаёт в его ангар и
     * приписан к нему: после гибели вездеход возвращается сюда же
     * (Combat::respawnShip). Второй в тот же трюм не встаёт.
     */
    private static function buyRover(int $playerId, array $ship, array $type): array
    {
        $shipId = (int) $ship['id'];
        if (Specs::hangarOf((string) $ship['type_code']) !== $type['code']) {
            throw ApiError::denied('no_hangar', 'в трюме ' . $ship['type_name'] . ' вездеходу не встать: ангара нет');
        }
        if (Players::roverOf($shipId) !== null) {
            throw ApiError::denied('have_rover', 'вездеход у этого корабля уже есть: он в трюме');
        }
        Ledger::require($playerId, (int) $type['price']);
        $roverId = Players::ensureHangar($shipId);
        Ledger::add($playerId, 'ВЕРФЬ · ВЕЗДЕХОД: ' . $type['name'], -(int) $type['price'],
            'rover:' . $shipId . ':' . $roverId);
        $state = Players::state($playerId);
        $state['bought'] = $roverId;
        return $state;
    }

    /**
     * Вызвать свой корабль из хранилища порта на площадку — как в ангаре
     * Star Citizen: тот, что стоит на площадке пилота, уходит в хранилище, а
     * вызванный поднимается на его место.
     *
     * Где пилот: на борту своего корабля в этом порту — тогда он и в
     * кресле вызванного; или пешком на полу станции, у пульта ангарной
     * службы (out_body — эта станция), — тогда он там и остаётся, а к
     * кораблю идёт сам. Вызванный — свой и в этом же порту (docked_body).
     */
    public static function retrieve(int $playerId, int $shipId): array
    {
        return Db::tx(function () use ($playerId, $shipId) {
            $p = Db::row('SELECT * FROM `player` WHERE `id`=? FOR UPDATE', [$playerId]);
            if ($p === null) {
                throw ApiError::notFound('нет такого игрока');
            }
            $want = Db::row('SELECT sh.*, t.`length_m`, t.`width_m`, t.`gear_clear_m`, t.`code` AS `type_code`
                 FROM `ship` sh JOIN `ship_type` t ON t.`id`=sh.`type_id` WHERE sh.`id`=?', [$shipId]);
            if ($want === null || (int) $want['owner_id'] !== $playerId) {
                throw ApiError::denied('not_owner', 'это не ваш корабль');
            }
            if ($want['docked_body'] === null || $want['system_id'] === null || $want['carrier_id'] !== null) {
                throw ApiError::denied('not_here', 'корабль не в порту');
            }
            $sys = (int) $want['system_id'];
            $st = (int) $want['docked_body'];
            // Пилот — в этом же порту: на полу станции (место «за бортом» в её
            // осях) или на борту корабля, что стоит здесь.
            $here = $p['aboard_ship'] === null && $p['out_body'] !== null && (int) $p['out_body'] === $st
                && $p['system_id'] !== null && (int) $p['system_id'] === $sys;
            if (!$here && $p['aboard_ship'] !== null) {
                $from = Players::shipRow((int) $p['aboard_ship']);
                $here = $from !== null && $from['docked_body'] !== null && (int) $from['docked_body'] === $st
                    && (int) $from['system_id'] === $sys;
            }
            if (!$here) {
                throw ApiError::denied('not_here', 'вызвать корабль можно только в том порту, где он стоит');
            }
            // Площадка: та, на которой стоит корабль, которым пилот командует,
            // если он здесь, — иначе свободная по размеру вызванного.
            $active = Players::shipRow((int) $p['ship_id']);
            $pad = null;
            if ($active !== null && (int) $active['id'] !== $shipId && $active['docked_body'] !== null
                && (int) $active['docked_body'] === $st && (int) $active['system_id'] === $sys && $active['pad'] !== null) {
                $row = Db::row('SELECT sp.`size` FROM `station_pad` sp JOIN `body` b ON b.`id`=sp.`station_id`
                     WHERE b.`system_id`=? AND b.`local_id`=? AND sp.`n`=?', [$sys, $st, (int) $active['pad']]);
                if ($row !== null && !($row['size'] === 'S' && Stations::padSizeOf($want) === 'L')) {
                    $pad = (int) $active['pad'];
                }
                // Прежний — в хранилище, со всеми, кто на борту: им — в кресло
                // нового (хозяину) и на ноги в нём же (пассажирам) не выйдет —
                // пассажиров на корабле в хранилище быть не может, их на станцию.
                Db::update('ship', ['stored' => 1, 'pad' => null, 'dock_pose' => null, 'hatches' => null],
                    '`id`=?', [(int) $active['id']]);
            }
            if ($pad === null) {
                $pad = Stations::freePad($sys, $st, Stations::padSizeOf($want), $shipId);
            }
            if ($pad === null) {
                throw ApiError::denied('no_pad', 'свободной площадки под этот корабль нет');
            }
            $pose = Stations::padPose($sys, $st, $pad, (float) $want['gear_clear_m']);
            Db::update('ship', ['stored' => 0, 'pad' => $pad, 'berth_station' => $st, 'pad_at' => Db::now(),
                'dock_pose' => $pose === null ? null : json_encode($pose), 'hatches' => null], '`id`=?', [$shipId]);
            // Командование — вызванным. Пилот на борту прежнего (он ушёл в
            // хранилище) — в кресло вызванного; на станции — остаётся там.
            $set = ['ship_id' => $shipId];
            if ($p['aboard_ship'] !== null) {
                $set += ['aboard_ship' => $shipId, 'seated' => 1, 'walk_pose' => null];
            }
            Db::update('player', $set, '`id`=?', [$playerId]);
            $state = Players::state($playerId);
            $state['retrieved'] = ['id' => $shipId, 'pad' => $pad];
            return $state;
        });
    }

    /** Свои корабли в этом доке: на них пересаживаются. */
    // Вездеход в трюме — не «свой корабль в доке»: пересесть в него в порту
    // нельзя (водят его по грунту, Players::command), и в списке он лишний.
    private static function here(int $playerId, array $port, int $activeId): array
    {
        $rows = Db::all('SELECT s.`id`, s.`name`, s.`pad`, s.`stored`, s.`berth_station`, s.`docked_body`, s.`carrier_id`, t.`code`, t.`name` AS `type_name`, t.`title`
            FROM `ship` s JOIN `ship_type` t ON t.`id` = s.`type_id`
            WHERE s.`owner_id`=? AND s.`system_id`=? AND s.`docked_body`=? AND s.`carrier_id` IS NULL ORDER BY s.`id`',
            [$playerId, $port['system_id'], $port['local_id']]);
        $out = [];
        foreach ($rows as $r) {
            $out[] = ['id' => (int) $r['id'], 'name' => $r['name'], 'type' => $r['code'],
                'typeName' => $r['type_name'], 'title' => $r['title'], 'active' => (int) $r['id'] === $activeId,
                // На площадке или в хранилище порта.
                'pad' => $r['pad'] === null ? null : (int) $r['pad'], 'stored' => Stations::inStorage($r)];
        }
        return $out;
    }

    /**
     * Ангар корабля, которым пилот командует: какой вездеход в него
     * встаёт, почём, и есть ли он уже. У корабля без ангара — null.
     */
    private static function hangarOffer(array $ship, bool $open): ?array
    {
        $code = Specs::hangarOf((string) $ship['type_code']);
        $type = $code === null ? null : Db::row('SELECT * FROM `ship_type` WHERE `code`=?', [$code]);
        if ($type === null) {
            return null;
        }
        $have = Players::roverOf((int) $ship['id']);
        return [
            'code' => $code, 'name' => $type['name'], 'title' => $type['title'], 'price' => (int) $type['price'],
            'for' => (int) $ship['id'], 'have' => $have, 'sold' => $open && $have === null,
        ];
    }

    /** Что продаёт верфь этого порта и какие свои корабли стоят здесь. */
    public static function offer(int $playerId): array
    {
        $info = self::port($playerId);
        $port = $info['port'];
        $open = !empty($info['services']['outfit']);
        $hulls = [];
        foreach (Db::all('SELECT * FROM `ship_type` ORDER BY `id`') as $t) {
            // Вездеход верфь не продаёт: его выдаёт ангар корабля.
            if (Specs::isGround($t['code'])) {
                continue;
            }
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
            'hangar' => self::hangarOffer($port['ship'], $open),
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
            // Вездеход — не корабль в док, а машина в трюм того корабля, которым
            // пилот командует: в его ангар (hangar) и приписан к нему.
            if (Specs::isGround($code)) {
                return self::buyRover($playerId, $port['ship'], $type);
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
                // Новый корабль — в хранилище порта: на площадку его вызывают
                // ангарной службой (retrieve), как и любой свой корабль здесь.
                'berth_station' => $port['local_id'],
                'stored' => 1,
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
