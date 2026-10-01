<?php
/**
 * Топливо: сколько его, во что оно обходится и куда уходит.
 *
 * Считает СЕРВЕР, и в базу бак пишет только он. Бак — такой же счёт, как
 * корпус: будь он полем сохранения, игра записывала бы себе полный бак
 * после каждого прыжка, и топливо не стоило бы ничего.
 *
 * Расход приходит тремя путями, и у каждого свой «кто меряет»:
 *
 *   ДВИГАТЕЛИ — маршевые, подъёмные, маневровые. Игра шлёт в сокет
 *   ИЗМЕРЕНИЕ: сколько скорости набрала каждая группа сопел с начала
 *   связи, км/с (js/net/socket.js). Тонны из этого считает хаб своими
 *   числами — масса · Δv / скорость струи — и не больше того, что
 *   двигатель вообще может дать за прошедшее время (Hub::meter). Это
 *   тот же порядок, что у удара о грунт: измеряет игра, во что это
 *   обошлось, решает сервер.
 *
 *   КВАНТОВЫЙ ПРИВОД — меряет сам хаб по снимкам положения: отрезок,
 *   пройденный быстрее, чем летают на двигателях, и есть прыжок. Игре
 *   тут сообщать нечего, и промолчать ей нечем.
 *
 *   ВАРП — меряет база: сменилась система в сохранении или при стыковке
 *   (arrive) — списывается расстояние между звёздами по каталогу.
 *
 * Чего сервер не видит — и это надо знать: работу двигателей, о которой
 * игра промолчала или которую сделала без сокета. Промолчать выгодно —
 * это бесплатное топливо, — но только себе: ни чужих денег, ни чужого
 * корпуса это не касается. Главный расход — прыжки, — сервер меряет сам,
 * и молчанием его не обойти.
 *
 * Формулы здесь те же, что в игре (js/game/fuel.js): по ним она
 * показывает расход в тот же кадр, не дожидаясь ответа, и по ним живёт
 * автономный режим. Числа у обеих сторон одни — модули в каталоге и
 * масса корпуса из выгрузки.
 */

final class Fuel
{
    /**
     * Самая большая тяжесть, у которой корабль может висеть на подъёмных,
     * км/с². Нужна только ПРЕДЕЛУ расхода (Hub::meter): какая тяжесть под
     * кораблём, сервер не знает — физики у него нет, — и берёт с запасом
     * тяжесть газового гиганта.
     */
    public const G_CAP = 0.05;

    /**
     * Во сколько раз быстрее двигательного предела должен лететь корабль,
     * чтобы отрезок пути считался квантовым прыжком. Четыре раза с
     * запасом отделяют форсаж и падение с высоты (единицы км/с) от
     * прыжка (десятки тысяч): между ними три порядка, и промахнуться
     * негде. Перенос телом захвата — четыре метра в секунду у самой
     * быстрой луны галактики — сюда не доходит вовсе.
     */
    public const JUMP_GATE = 4;

    /**
     * Модель бака корабля: объём, резерв, масса и расход каждого привода.
     *
     * Собирается так же, как лётная модель в игре: корпус (объём бака,
     * резерв, масса), а поверх — числа установленных модулей (Loadout).
     * Снятый двигатель не даёт расхода — он не даёт и тяги.
     */
    public static function model(int $shipId): array
    {
        $row = Db::row(
            'SELECT s.`fuel_t`, t.`fuel_t` AS `fuel_max`, t.`mass_t`, t.`spec`
             FROM `ship` s JOIN `ship_type` t ON t.`id` = s.`type_id` WHERE s.`id`=?',
            [$shipId]
        );
        if ($row === null) {
            throw ApiError::notFound('нет такого корабля');
        }
        $hull = json_decode((string) $row['spec'], true);
        $hull = is_array($hull) ? $hull : [];
        $f = Loadout::flight($shipId);
        $n = static function ($v): float {
            return is_numeric($v) && is_finite((float) $v) ? (float) $v : 0.0;
        };

        $maxSpeed = $n($f['maxSpeed'] ?? 0);
        $boostMax = max(1.0, $n($f['boostMax'] ?? 1));
        $boostRamp = $n($f['boostRamp'] ?? 0);
        $accel = $n($f['accel'] ?? 0);
        // Разгон на форсаже выводится так же, как в игре (SHIP.boostAccel):
        // с обычного предела до форсажного за boostRamp секунд.
        $boostAccel = $boostRamp > 0 ? $maxSpeed * ($boostMax - 1) / $boostRamp : 0.0;
        $liftTWR = $n($f['liftTWR'] ?? 0);

        return [
            'fuel' => (float) $row['fuel_t'],
            // Объём складывается: корпусной бак плюс дополнительный, если
            // он стоит. Так же считает игра (applyShipSpec, SHIP.fuelCap).
            'cap' => (float) $row['fuel_max'] + $n($f['fuelTank'] ?? 0),
            'reserve' => $n($hull['fuelReserve'] ?? 0),
            'mass' => (float) $row['mass_t'],
            'exhaust' => $n($f['exhaust'] ?? 0),
            'liftExhaust' => $n($f['liftExhaust'] ?? 0),
            'rcsExhaust' => $n($f['rcsExhaust'] ?? 0),
            'quantumFuel' => $n($f['quantumFuel'] ?? 0),
            'quantumSpeed' => $n($f['quantumSpeed'] ?? 0),
            'warpFuel' => $n($f['warpFuel'] ?? 0),
            // Пределы для хаба: сколько скорости каждая группа сопел вообще
            // может набрать за секунду. Больше этого измерение не спишет,
            // что бы ни прислала игра.
            'mainAccel' => max($accel, $n($f['brake'] ?? 0), $boostAccel),
            'liftAccel' => max($n($f['liftMin'] ?? 0), self::G_CAP * $liftTWR) + self::G_CAP,
            // Маневровые: занос плюс вращение. Вращение в пересчёте на
            // линейную скорость — сотые доли от заноса (см. js/game/ship.js),
            // и запаса вдвое хватает на оба.
            'rcsAccel' => 2 * $n($f['lateral'] ?? 0),
            'jumpGate' => self::JUMP_GATE * $maxSpeed * $boostMax,
        ];
    }

    /**
     * Тонны за работу двигателей: Δv каждой группы сопел, км/с.
     *
     * Топливо = масса · Δv / скорость струи — формула Циолковского на
     * малой доле массы (бак — семь тысячных корабля, расхождение с
     * точной — треть процента). Группа без струи (модуль снят) не
     * тратит ничего: без неё нет и тяги.
     */
    public static function thrustTons(array $m, float $main, float $lift, float $rcs): float
    {
        $k = 0.0;
        if ($m['exhaust'] > 0) {
            $k += max(0.0, $main) / $m['exhaust'];
        }
        if ($m['liftExhaust'] > 0) {
            $k += max(0.0, $lift) / $m['liftExhaust'];
        }
        if ($m['rcsExhaust'] > 0) {
            $k += max(0.0, $rcs) / $m['rcsExhaust'];
        }
        return $m['mass'] * $k;
    }

    /** Тонны за квантовый ход, км. */
    public static function quantumTons(array $m, float $km): float
    {
        return max(0.0, $km) / 1e6 * $m['quantumFuel'];
    }

    /** Тонны за варп-прыжок, световые годы. */
    public static function warpTons(array $m, float $ly): float
    {
        return max(0.0, $ly) * $m['warpFuel'];
    }

    /**
     * Списать топливо. Дно — ноль: в долг бак не уходит.
     *
     * Вычитание идёт В БАЗЕ, а не «прочитал — вычел — записал»: бак
     * пишут двое — хаб по ходу полёта и заправка по запросу, — и запись
     * целиком затёрла бы заправку, пришедшую между чтением и записью.
     */
    public static function burn(int $shipId, float $tons): float
    {
        $t = round(max(0.0, $tons), 3);
        if ($t > 0) {
            Db::run('UPDATE `ship` SET `fuel_t` = GREATEST(0, `fuel_t` - ?) WHERE `id`=?', [$t, $shipId]);
        }
        return (float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipId]);
    }

    /**
     * Корабль сменил систему: списать варп по расстоянию между звёздами.
     *
     * Зовут те, кто пишет `ship.system_id` СО СЛОВ ИГРЫ: сохранение и
     * стыковка. Гибель и буксир систему тоже меняют, но это решение
     * сервера, а не прыжок, и платить за него топливом не за что.
     *
     * Прыжок, на который топлива не хватало, всё равно состоялся —
     * отменить его серверу нечем: физики у него нет. Бак уходит в ноль.
     * Игра при этом такой прыжок не начинает (js/game/warp.js, canWarp),
     * так что сюда он попадает только в обход её проверки.
     *
     * @return float сколько тонн списано
     */
    public static function arrive(int $playerId, ?int $from, int $to): float
    {
        return self::arriveShip((int) Players::ship($playerId)['id'], $from, $to);
    }

    /** То же — для корабля по номеру: платит бак того, кто прыгнул. */
    public static function arriveShip(int $shipId, ?int $from, int $to): float
    {
        if ($from === null || $from === $to) {
            return 0.0;
        }
        $m = self::model($shipId);
        $tons = self::warpTons($m, Galaxy::distance($from, $to));
        self::burn($shipId, $tons);
        return $tons;
    }

    /**
     * Цена тонны топлива в этом порту — цена водорода на его рынке.
     *
     * Топливо и есть водород, и своей цены ему не заведено: иначе у
     * газового гиганта заправка стоила бы столько же, сколько у ледяного
     * рудника, куда водород везут издалека. Со СКЛАДА рынка оно при этом
     * не берётся: у заправщика свой запас. Там, где водород ждут, склад
     * пуст, и без этого там нельзя было бы заправиться вовсе.
     */
    public static function price(int $stationBodyId): int
    {
        $row = Db::row(
            "SELECT m.`price`, c.`base_price` FROM `commodity` c
             LEFT JOIN `market` m ON m.`commodity_id` = c.`id` AND m.`station_id` = ?
             WHERE c.`code` = 'hydrogen'",
            [$stationBodyId]
        );
        if ($row === null) {
            throw new RuntimeException('в каталоге нет водорода: залейте каталог (npm run api:setup)');
        }
        return max(1, (int) ($row['price'] ?? $row['base_price']));
    }

    /**
     * Долить бак до резерва, если он ниже.
     *
     * Страховка после гибели и буксир возвращают корабль в порт с тем, на
     * чём можно хотя бы выйти из дока. Сверх резерва не доливают: иначе
     * разбиться было бы дешевле, чем заправиться.
     */
    public static function topUpReserve(int $shipId): float
    {
        $m = self::model($shipId);
        Db::run('UPDATE `ship` SET `fuel_t` = GREATEST(`fuel_t`, ?) WHERE `id`=?',
            [round(min($m['reserve'], $m['cap']), 3), $shipId]);
        return (float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipId]);
    }

    /**
     * Заправка в порту.
     *
     * @param float|null $tons сколько налить; null — до полного
     */
    public static function refuel(int $playerId, ?float $tons = null): array
    {
        return Db::tx(function () use ($playerId, $tons) {
            $port = Players::portOrDeny($playerId, 'заправляют в порту');
            $info = Stations::info($port['system_id'], $port['local_id']);
            $body = Galaxy::body($port['system_id'], $port['local_id']);
            $shipId = (int) $port['ship']['id'];
            // Строка корабля — с блокировкой: хаб в это время может
            // списывать расход, и две записи иначе разошлись бы.
            Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=? FOR UPDATE', [$shipId]);
            $m = self::model($shipId);

            $room = max(0.0, $m['cap'] - $m['fuel']);
            $want = $tons === null ? $room : min(max(0.0, $tons), $room);
            // Килограммы: столько держит база, дробнее наливать нечего.
            $want = floor($want * 1000 + 1e-6) / 1000;
            if ($want < 0.001) {
                throw ApiError::denied('tank_full', 'бак полон');
            }
            $price = self::price((int) $body['id']);
            // Кроны целые, и округление — в пользу заправщика: иначе
            // сотня заправок по сто грамм стоила бы ноль.
            $cost = (int) ceil($want * $price - 1e-9);
            Ledger::require($playerId, $cost);

            Db::run('UPDATE `ship` SET `fuel_t` = LEAST(?, `fuel_t` + ?) WHERE `id`=?',
                [round($m['cap'], 3), $want, $shipId]);
            $money = Ledger::add($playerId, 'ЗАПРАВКА: ' . self::tons($want) . ' · '
                . mb_strtoupper($info['name']), -$cost, 'fuel:' . $shipId);

            return [
                'fuel' => (float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipId]),
                'cap' => $m['cap'],
                'tons' => $want,
                'price' => $price,
                'cost' => $cost,
                'balance' => $money['balance'],
            ];
        });
    }

    /**
     * Аварийный буксир: корабль в порт, бак до резерва.
     *
     * Выход из тупика, а не услуга: пустой бак в пустоте иначе значит
     * конец игры — квантовый прыжок не начнётся, а на двигателях до порта
     * в миллионе километров лететь неделю. Тариф берётся в меру того, что
     * есть на счёте, и в долг не уводит: пилот без денег иначе оказался
     * бы в том же тупике, только в доке.
     *
     * Куда тянут: в последний порт этой системы, а если его нет (только
     * что прибыли варпом) — в главный порт системы, с самой высокой
     * техникой. Где корабль на самом деле, сервер знает лишь со слов
     * игры, и искать по ним «ближайший» значило бы верить им в том, что
     * стоит денег.
     *
     * Тянут КОРАБЛЬ, которым пилот командует, — и пилот при этом на его
     * борту: буксир вызывают из кресла, а не с другого конца системы.
     * Пассажиры едут вместе с кораблём.
     */
    public static function rescue(int $playerId): array
    {
        return Db::tx(function () use ($playerId) {
            $p = Db::row('SELECT * FROM `player` WHERE `id`=? FOR UPDATE', [$playerId]);
            if ($p === null) {
                throw ApiError::notFound('нет такого игрока');
            }
            $ship = Players::ship($playerId);
            $shipId = (int) $ship['id'];
            if ($ship['docked_body'] !== null) {
                throw ApiError::denied('docked', 'корабль в порту: заправка здесь же');
            }
            if ((int) $p['aboard_ship'] !== $shipId) {
                throw ApiError::denied('not_aboard', 'буксир вызывают с борта своего корабля');
            }

            $sys = $ship['system_id'] === null ? null : (int) $ship['system_id'];
            $dest = null;
            if ($sys !== null && $p['last_station'] !== null && Db::one(
                "SELECT `id` FROM `body` WHERE `system_id`=? AND `local_id`=? AND `kind`='station'",
                [$sys, (int) $p['last_station']]
            ) !== null) {
                $dest = ['system_id' => $sys, 'local_id' => (int) $p['last_station']];
            } elseif ($sys !== null) {
                $row = Db::row(
                    'SELECT b.`local_id` FROM `station` st JOIN `body` b ON b.`id` = st.`body_id`
                     WHERE st.`system_id`=? ORDER BY st.`tech` DESC, b.`local_id` LIMIT 1',
                    [$sys]
                );
                if ($row !== null) {
                    $dest = ['system_id' => $sys, 'local_id' => (int) $row['local_id']];
                }
            }
            if ($dest === null) {
                $dest = Players::startPoint();
            }
            $info = Stations::info($dest['system_id'], $dest['local_id']);

            $fee = min(Content::RESCUE_FEE, max(0, (int) $p['balance']));
            Db::update('ship', [
                'system_id' => $dest['system_id'],
                'docked_body' => $dest['local_id'],
                'landed_body' => null,
                'landed_pose' => null,
                'landed_secured' => 0,
                'anchor_body' => null,
                'anchor_pose' => null,
                'pos_x' => 0, 'pos_y' => 0, 'pos_z' => 0,
                'basis' => null,
                'hatches' => null,
            ], '`id`=?', [$shipId]);
            Db::update('player', [
                'last_station' => $dest['local_id'],
                'last_seen_at' => Db::now(),
            ], '`id`=?', [$playerId]);
            // Все, кто на борту, — в порту вместе с кораблём.
            Db::run('UPDATE `player` SET `system_id`=? WHERE `aboard_ship`=?',
                [$dest['system_id'], $shipId]);

            $fuel = self::topUpReserve($shipId);
            $money = $fee > 0
                ? Ledger::add($playerId, 'АВАРИЙНЫЙ БУКСИР · ' . mb_strtoupper($info['name']),
                    -$fee, 'rescue:' . $dest['local_id'])
                : ['balance' => (int) $p['balance']];

            return [
                'station' => $info,
                'fee' => $fee,
                'fuel' => $fuel,
                'balance' => $money['balance'],
            ];
        });
    }

    /** «6.4 Т» — для ленты операций. */
    public static function tons(float $t): string
    {
        return rtrim(rtrim(number_format($t, 2, '.', ''), '0'), '.') . ' Т';
    }
}
