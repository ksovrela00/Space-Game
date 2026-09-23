<?php
/**
 * Задания: доска на станции, взятие, сдача, срок.
 *
 * Сделан ПОКА ОДИН вид — доставка, и сделан целиком: взял груз в порту,
 * довёз до другого порта, сдал, получил награду. Виды «разведать тело» и
 * «привезти образец с поверхности» в схеме предусмотрены, но не выданы
 * намеренно: проверить их выполнение сервер сегодня не может — для этого
 * нужно знать, где корабль был на самом деле, то есть считать физику на
 * сервере. Выдавать задание, выполнение которого нельзя подтвердить, —
 * значит выдавать его на честное слово клиента.
 *
 * Доставка проверяется целиком и без веры на слово: корабль стоит в порту
 * назначения, и груз лежит в трюме. И то и другое — записи в базе.
 */

final class Missions
{
    /** Сколько предложений держим на доске одной станции. */
    public const BOARD_SIZE = 4;

    /** Сколько живёт невзятое предложение. */
    public const OFFER_TTL = 3600;

    /** Доска станции. Недостающие предложения досоздаются. */
    public static function board(int $systemId, int $stationLocalId): array
    {
        $station = Galaxy::body($systemId, $stationLocalId);
        if ($station['kind'] !== 'station') {
            throw ApiError::bad('доска заданий есть только в порту');
        }
        $stationId = (int) $station['id'];

        Db::run(
            "DELETE FROM `mission` WHERE `station_id`=? AND `state`='offered' AND `offered_at` < ?",
            [$stationId, Db::at(-self::OFFER_TTL)]
        );
        $have = (int) Db::one(
            "SELECT COUNT(*) FROM `mission` WHERE `station_id`=? AND `state`='offered'",
            [$stationId]
        );
        for ($i = $have; $i < self::BOARD_SIZE; $i++) {
            self::offer($station);
        }

        return self::rows(
            "SELECT * FROM `mission` WHERE `station_id`=? AND `state`='offered' ORDER BY `reward` DESC",
            [$stationId]
        );
    }

    /**
     * Придумать одно предложение.
     *
     * Куда везти, выбирается из ДРУГИХ станций, и предпочтение — своей
     * системе: межсистемный подряд должен быть редким и дорогим, иначе
     * первый же новичок берёт доставку через полгалактики.
     */
    private static function offer(array $station): void
    {
        $systemId = (int) $station['system_id'];
        $stationId = (int) $station['id'];

        $near = Galaxy::stations($systemId);
        $far = Db::all(
            "SELECT b.*, s.`id` AS `sys` FROM `body` b JOIN `star_system` s ON s.`id`=b.`system_id`
             WHERE b.`kind`='station' AND b.`system_id` <> ? ORDER BY RAND() LIMIT 8",
            [$systemId]
        );
        $pool = [];
        foreach ($near as $t) {
            if ((int) $t['id'] !== $stationId) {
                $pool[] = $t;
            }
        }
        // Дальние берутся вчетверо реже: доля в списке и есть вероятность.
        if ($far && count($pool) > 0) {
            $pool[] = $far[array_rand($far)];
        } elseif ($far) {
            $pool = [$far[array_rand($far)]];
        }
        if (!$pool) {
            return;
        }
        $target = $pool[array_rand($pool)];

        // Товар: что-нибудь, чем здесь торгуют и что есть на складе.
        $good = Db::row(
            'SELECT c.* FROM `market` m JOIN `commodity` c ON c.`id`=m.`commodity_id`
             WHERE m.`station_id`=? AND m.`stock` > 5 AND c.`legal`=1 ORDER BY RAND() LIMIT 1',
            [$stationId]
        );
        if ($good === null) {
            return;
        }

        $tons = (float) (2 + random_int(0, 6));
        $jumps = (int) $target['system_id'] === $systemId ? 0 : 1;
        $ly = $jumps ? Galaxy::distance($systemId, (int) $target['system_id']) : 0.0;

        // Награда: товар по рынку плюс плата за дорогу. Межсистемный рейс
        // платит заметно больше — он и стоит дольше.
        $market = (int) Db::one(
            'SELECT `price` FROM `market` WHERE `station_id`=? AND `commodity_id`=?',
            [$stationId, $good['id']]
        );
        $reward = (int) round($market * $tons * 1.35 + 120 * $tons + $ly * 90);
        $penalty = (int) round($reward * 0.35);
        $limit = (int) round(($jumps ? 900 + $ly * 40 : 600) + $tons * 30);

        $title = $jumps
            ? 'ПОДРЯД · ' . mb_strtoupper($target['name'])
            : 'ДОСТАВКА · ' . mb_strtoupper($target['name']);
        $descr = 'Доставить ' . rtrim(rtrim(number_format($tons, 1, '.', ''), '0'), '.')
            . ' т: ' . $good['name'] . '. Груз выдаётся в порту отправления.';

        Db::insert('mission', [
            'player_id' => null,
            'station_id' => $stationId,
            'kind' => 'deliver',
            'title' => $title,
            'descr' => $descr,
            'reward' => $reward,
            'penalty' => $penalty,
            'target_body' => (int) $target['id'],
            'commodity_id' => (int) $good['id'],
            'tons' => $tons,
            'time_limit_s' => $limit,
            'state' => 'offered',
            'offered_at' => Db::now(),
        ]);
    }

    /**
     * Взять подряд.
     *
     * Груз выдаётся сразу и кладётся в трюм: иначе «доставка» превращается
     * в «купи и довези», а это уже торговля, а не подряд. Не влезло в трюм
     * — подряд не взят.
     */
    public static function accept(int $playerId, int $missionId): array
    {
        return Db::tx(function () use ($playerId, $missionId) {
            $p = Players::byId($playerId);
            $ship = Players::ship($playerId);
            $m = Db::row('SELECT * FROM `mission` WHERE `id`=? FOR UPDATE', [$missionId]);
            if ($m === null) {
                throw ApiError::notFound('нет такого задания');
            }
            if ($m['state'] !== 'offered') {
                throw ApiError::denied('taken', 'этот подряд уже взяли');
            }
            if ($p['docked_body'] === null) {
                throw ApiError::denied('not_docked', 'подряд берут в порту');
            }
            $here = Galaxy::body((int) $p['system_id'], (int) $p['docked_body']);
            if ((int) $here['id'] !== (int) $m['station_id']) {
                throw ApiError::denied('wrong_station', 'этот подряд с другой станции');
            }

            $tons = (float) $m['tons'];
            $free = Cargo::freeTons((int) $ship['id'], (float) $ship['hold_t']);
            if ($free + 1e-9 < $tons) {
                throw ApiError::denied('no_room', 'в трюме свободно ' . $free . ' т, нужно ' . $tons, [
                    'free' => $free, 'need' => $tons,
                ]);
            }

            Cargo::add((int) $ship['id'], (int) $m['commodity_id'], $tons, 0);
            Db::update('mission', [
                'player_id' => $playerId,
                'state' => 'active',
                'taken_at' => Db::now(),
                'deadline_at' => Db::at((int) $m['time_limit_s']),
            ], '`id`=?', [$missionId]);

            return self::one($missionId);
        });
    }

    /** Сдать: стоим в порту назначения и груз при нас. */
    public static function complete(int $playerId, int $missionId): array
    {
        return Db::tx(function () use ($playerId, $missionId) {
            $p = Players::byId($playerId);
            $ship = Players::ship($playerId);
            $m = Db::row('SELECT * FROM `mission` WHERE `id`=? AND `player_id`=? FOR UPDATE',
                [$missionId, $playerId]);
            if ($m === null) {
                throw ApiError::notFound('нет такого задания');
            }
            if ($m['state'] !== 'active') {
                throw ApiError::denied('not_active', 'этот подряд уже закрыт');
            }
            if ($p['docked_body'] === null) {
                throw ApiError::denied('not_docked', 'сдают подряд в порту');
            }
            $here = Galaxy::body((int) $p['system_id'], (int) $p['docked_body']);
            if ((int) $here['id'] !== (int) $m['target_body']) {
                throw ApiError::denied('wrong_station', 'это не тот порт');
            }
            if ($m['deadline_at'] !== null && $m['deadline_at'] < Db::now()) {
                self::fail($m);
                throw ApiError::denied('expired', 'срок вышел');
            }

            Cargo::take((int) $ship['id'], (int) $m['commodity_id'], (float) $m['tons']);
            Db::update('mission', ['state' => 'done'], '`id`=?', [$missionId]);
            $money = Ledger::add($playerId, 'ПОДРЯД ВЫПОЛНЕН: ' . $m['title'],
                (int) $m['reward'], 'mission:' . $missionId);

            return ['mission' => self::one($missionId), 'balance' => $money['balance'],
                'reward' => (int) $m['reward']];
        });
    }

    /** Отказаться: груз остаётся, штраф берётся. */
    public static function abandon(int $playerId, int $missionId): array
    {
        return Db::tx(function () use ($playerId, $missionId) {
            $m = Db::row('SELECT * FROM `mission` WHERE `id`=? AND `player_id`=? FOR UPDATE',
                [$missionId, $playerId]);
            if ($m === null) {
                throw ApiError::notFound('нет такого задания');
            }
            if ($m['state'] !== 'active') {
                throw ApiError::denied('not_active', 'этот подряд уже закрыт');
            }
            self::fail($m);
            return ['mission' => self::one((int) $m['id'])];
        });
    }

    private static function fail(array $m): void
    {
        Db::update('mission', ['state' => 'failed'], '`id`=?', [$m['id']]);
        if ((int) $m['penalty'] > 0 && $m['player_id'] !== null) {
            Ledger::add((int) $m['player_id'], 'ПОДРЯД СОРВАН: ' . $m['title'],
                -(int) $m['penalty'], 'mission:' . $m['id']);
        }
    }

    /**
     * Мои подряды. Просроченные закрываются ЗДЕСЬ, при первом же взгляде:
     * отдельного тика у сервера пока нет, а срок обязан истекать даже
     * тогда, когда игрок в игру не заходит.
     */
    public static function mine(int $playerId): array
    {
        $late = Db::all(
            "SELECT * FROM `mission` WHERE `player_id`=? AND `state`='active'
             AND `deadline_at` IS NOT NULL AND `deadline_at` < ?",
            [$playerId, Db::now()]
        );
        foreach ($late as $m) {
            self::fail($m);
        }
        return self::rows(
            "SELECT * FROM `mission` WHERE `player_id`=? AND `state` IN ('active','failed','done')
             ORDER BY FIELD(`state`,'active','failed','done'), `deadline_at`",
            [$playerId]
        );
    }

    private static function one(int $id): array
    {
        $rows = self::rows('SELECT * FROM `mission` WHERE `id`=?', [$id]);
        return $rows[0] ?? [];
    }

    private static function rows(string $sql, array $args): array
    {
        $out = [];
        foreach (Db::all($sql, $args) as $m) {
            $target = Db::row(
                'SELECT b.`name`, b.`system_id`, b.`local_id`, s.`name` AS `system`
                 FROM `body` b JOIN `star_system` s ON s.`id`=b.`system_id` WHERE b.`id`=?',
                [$m['target_body']]
            );
            $good = $m['commodity_id'] === null ? null
                : Db::row('SELECT `code`,`name` FROM `commodity` WHERE `id`=?', [$m['commodity_id']]);
            $left = null;
            if ($m['deadline_at'] !== null) {
                $left = max(0, strtotime($m['deadline_at'] . ' UTC') - time());
            }
            $out[] = [
                'id' => (int) $m['id'],
                'kind' => $m['kind'],
                'title' => $m['title'],
                'descr' => $m['descr'],
                'reward' => (int) $m['reward'],
                'penalty' => (int) $m['penalty'],
                'tons' => (float) $m['tons'],
                'commodity' => $good ? ['code' => $good['code'], 'name' => $good['name']] : null,
                'target' => $target ? [
                    'name' => $target['name'],
                    'system' => $target['system'],
                    'systemId' => (int) $target['system_id'],
                    'localId' => (int) $target['local_id'],
                ] : null,
                'timeLimitS' => (int) $m['time_limit_s'],
                'leftS' => $left,
                'state' => $m['state'],
            ];
        }
        return $out;
    }
}
