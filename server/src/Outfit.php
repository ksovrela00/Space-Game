<?php
/**
 * Верфь: что можно поставить на корабль в этом порту, покупка, продажа.
 *
 * Считает СЕРВЕР — и цену, и то, что вообще продаётся, и что станет с
 * кораблём после замены. Игра присылает только код модуля.
 *
 * Правила, и почему они такие:
 *
 *   * Модули ставят только на станциях с верфью (техника 4–5,
 *     Content::stationOf), а что там продают, решает уровень техники
 *     модуля: второй квантовый привод есть только в столицах. Иначе все
 *     порты одинаковы, и лететь дальше незачем.
 *
 *   * Гнездо держит столько приборов, сколько сказано в каталоге
 *     (Specs::slotCap). Покупка в занятое гнездо — это ЗАМЕНА: старый
 *     модуль верфь забирает по цене сдачи, и платишь разницу. Две строки
 *     в ленте, а не одна: выписка обязана показывать, что за сколько ушло.
 *
 *   * Сданный модуль стоит Content::RESALE от цены — меньше полной, иначе
 *     снаряжение превращается в бесплатную камеру хранения крон.
 *
 *   * Двигатель, маневровые и подъёмные можно только заменить, но не
 *     снять (Specs::required): без них корабль из дока не выйдет.
 *
 *   * Замена не должна ломать того, что уже на борту. Трюм меньше груза
 *     не ставится; бак меньше топлива — ставится, а лишнее топливо
 *     станция выкупает по своей цене: слить его больше некуда.
 *
 * Оружия на верфи пока нет: готова одна пушка, и продавать её на замену
 * самой себе незачем. Гнездо `gun` в выдаче не показывается.
 */

final class Outfit
{
    /** Порт, в котором стоит пилот. Верфь работает только в доке. */
    private static function port(int $playerId): array
    {
        $port = Players::portOrDeny($playerId, 'модули ставят в порту');
        $info = Stations::info($port['system_id'], $port['local_id']);
        $info['bodyId'] = (int) Galaxy::body($port['system_id'], $port['local_id'])['id'];
        return $info;
    }

    /**
     * Встаёт ли модуль на корпус этого типа. Нет списка корпусов — на
     * любой; крейсерский квантовый привод — только на крейсер.
     */
    public static function fits(array $mod, string $typeCode): bool
    {
        $hulls = $mod['spec']['hulls'] ?? null;
        return !is_array($hulls) || !$hulls || in_array($typeCode, $hulls, true);
    }

    /** Сколько верфь платит за снятый модуль. Кроны целые, вниз. */
    public static function resale(int $price): int
    {
        return (int) floor($price * Content::RESALE);
    }

    /** Модули, стоящие на корабле, вместе с каталогом. */
    private static function installed(int $shipId): array
    {
        $rows = Db::all(
            'SELECT se.`id` AS `row_id`, e.`id`, e.`code`, e.`name`, e.`slot`, e.`price`, e.`tech`, e.`spec`
             FROM `ship_equipment` se JOIN `equipment_type` e ON e.`id` = se.`equipment_id`
             WHERE se.`ship_id`=? ORDER BY e.`id`',
            [$shipId]
        );
        return array_map([self::class, 'row'], $rows);
    }

    private static function row(array $r): array
    {
        $spec = json_decode((string) ($r['spec'] ?? ''), true);
        $out = [
            'id' => (int) $r['id'],
            'code' => $r['code'],
            'name' => $r['name'],
            'slot' => $r['slot'],
            'price' => (int) $r['price'],
            'tech' => (int) $r['tech'],
            'spec' => is_array($spec) ? $spec : [],
        ];
        if (isset($r['row_id'])) {
            $out['rowId'] = (int) $r['row_id'];
        }
        return $out;
    }

    /**
     * Что есть на верфи этого порта — по гнёздам корабля.
     *
     * Отдаётся и там, где верфи нет: пилоту нужно видеть, что стоит на
     * корабле и за сколько это сдать, а «здесь не продают» — такое же
     * сведение, как цена.
     */
    public static function offer(int $playerId): array
    {
        $info = self::port($playerId);
        $ship = Players::ship($playerId);
        $shipId = (int) $ship['id'];
        $typeCode = (string) $ship['type_code'];
        $open = (bool) $info['services']['outfit'];
        $have = self::installed($shipId);
        $required = Specs::required();

        $slots = [];
        foreach (Db::all("SELECT * FROM `equipment_type` WHERE `slot` <> 'gun' ORDER BY `id`") as $r) {
            $m = self::row($r);
            $slot = $m['slot'];
            if (!isset($slots[$slot])) {
                $here = array_values(array_filter($have, fn($h) => $h['slot'] === $slot));
                $slots[$slot] = [
                    'slot' => $slot,
                    'cap' => Specs::slotCap($slot),
                    'required' => in_array($slot, $required, true),
                    'installed' => array_map(fn($h) => [
                        'code' => $h['code'], 'name' => $h['name'], 'price' => $h['price'],
                        'resale' => self::resale($h['price']), 'spec' => $h['spec'],
                    ], $here),
                    'offers' => [],
                    'full' => count($here),
                ];
            }
            $on = false;
            foreach ($have as $h) {
                if ($h['code'] === $m['code']) {
                    $on = true;
                }
            }
            if ($on) {
                continue;
            }
            $s = &$slots[$slot];
            // Что верфь зачтёт: в полное гнездо на одного — стоящий в нём
            // модуль, в гнездо со свободным местом — ничего.
            $credit = $s['full'] >= $s['cap'] && $s['cap'] === 1 && $s['installed']
                ? $s['installed'][0]['resale'] : 0;
            $s['offers'][] = [
                'code' => $m['code'], 'name' => $m['name'], 'price' => $m['price'],
                'tech' => $m['tech'], 'spec' => $m['spec'],
                'sold' => $open && $m['tech'] <= (int) $info['tech'] && self::fits($m, $typeCode),
                'fits' => self::fits($m, $typeCode),
                'hulls' => $m['spec']['hulls'] ?? null,
                'credit' => $credit,
                'net' => $m['price'] - $credit,
            ];
            unset($s);
        }
        foreach ($slots as &$s) {
            unset($s['full']);
        }
        unset($s);

        return [
            'station' => $info,
            'open' => $open,
            'resale' => Content::RESALE,
            'slots' => array_values($slots),
            'balance' => (int) Players::byId($playerId)['balance'],
        ];
    }

    /** Купить модуль; в занятое гнездо — заменой. */
    public static function buy(int $playerId, string $code): array
    {
        return Db::tx(function () use ($playerId, $code) {
            $info = self::port($playerId);
            self::requireYard($info);
            $r = Db::row('SELECT * FROM `equipment_type` WHERE `code`=?', [$code]);
            if ($r === null) {
                throw ApiError::notFound('нет такого модуля: ' . $code);
            }
            $mod = self::row($r);
            if ($mod['slot'] === 'gun') {
                throw ApiError::denied('not_sold', 'оружие на верфи пока не продают');
            }
            if ($mod['tech'] > (int) $info['tech']) {
                throw ApiError::denied('no_tech', 'этот модуль продают на станциях уровня '
                    . $mod['tech'] . ', здесь ' . $info['tech'], ['tech' => $mod['tech']]);
            }

            $ship = Players::ship($playerId);
            $shipId = (int) $ship['id'];
            if (!self::fits($mod, (string) $ship['type_code'])) {
                $names = [];
                foreach ($mod['spec']['hulls'] as $c) {
                    $names[] = (string) (Db::one('SELECT `name` FROM `ship_type` WHERE `code`=?', [$c]) ?? $c);
                }
                throw ApiError::denied('wrong_hull', 'этот модуль ставят только на ' . implode(', ', $names)
                    . ': ему нужен реактор этого корпуса');
            }
            $here = array_values(array_filter(self::installed($shipId), fn($h) => $h['slot'] === $mod['slot']));
            foreach ($here as $h) {
                if ($h['code'] === $mod['code']) {
                    throw ApiError::denied('installed', 'этот модуль уже стоит');
                }
            }
            $cap = Specs::slotCap($mod['slot']);
            $old = null;
            if (count($here) >= $cap) {
                if ($cap !== 1) {
                    throw ApiError::denied('slot_full', 'гнездо занято: сначала снимите один из приборов');
                }
                $old = $here[0];
            }

            // Трюм меньше груза не ставится: груз некуда деть, а выбросить
            // его за пилота верфь не вправе.
            if ($mod['slot'] === 'hold') {
                $used = Cargo::usedTons($shipId);
                $room = (float) ($mod['spec']['flight']['hold'] ?? 0);
                if ($used > $room + 1e-9) {
                    throw ApiError::denied('no_room', 'в трюме ' . $used . ' т груза, а этот трюм держит '
                        . $room . ' т', ['used' => $used, 'room' => $room]);
                }
            }

            $credit = $old ? self::resale($old['price']) : 0;
            Ledger::require($playerId, max(0, $mod['price'] - $credit));

            if ($old) {
                Db::run('DELETE FROM `ship_equipment` WHERE `id`=?', [$old['rowId']]);
                Ledger::add($playerId, 'ВЕРФЬ · СДАН: ' . $old['name'], $credit, 'sell:' . $old['code']);
            }
            Db::insert('ship_equipment', ['ship_id' => $shipId, 'equipment_id' => $mod['id']]);
            // Отметку «пусто по воле пилота» снимаем, только когда гнездо
            // заполнено: иначе продал два компьютера, купил один — и второй
            // дозаливка поставила бы даром.
            if (count($here) - ($old ? 1 : 0) + 1 >= $cap) {
                Players::markBare($shipId, $mod['slot'], false);
            }
            $money = Ledger::add($playerId, 'ВЕРФЬ · УСТАНОВЛЕН: ' . $mod['name'], -$mod['price'],
                'buy:' . $mod['code']);
            Loadout::forget($shipId);
            $after = self::settle($playerId, $shipId, $info);

            return [
                'installed' => $mod['code'],
                'removed' => $old ? $old['code'] : null,
                'cost' => $mod['price'] - $credit,
                'balance' => $after['balance'] ?? $money['balance'],
                'fuel' => $after['fuel'],
                'refund' => $after['refund'],
            ];
        });
    }

    /** Снять модуль и сдать верфи. */
    public static function sell(int $playerId, string $code): array
    {
        return Db::tx(function () use ($playerId, $code) {
            $info = self::port($playerId);
            self::requireYard($info);
            $ship = Players::ship($playerId);
            $shipId = (int) $ship['id'];
            $mod = null;
            foreach (self::installed($shipId) as $h) {
                if ($h['code'] === $code) {
                    $mod = $h;
                }
            }
            if ($mod === null) {
                throw ApiError::denied('not_installed', 'такого модуля на корабле нет');
            }
            if ($mod['slot'] === 'gun') {
                throw ApiError::denied('not_sold', 'оружие на верфи пока не принимают');
            }
            if (in_array($mod['slot'], Specs::required(), true)) {
                throw ApiError::denied('required', 'без этого прибора корабль не выйдет из дока — '
                    . 'его можно только заменить');
            }
            if ($mod['slot'] === 'hold' && Cargo::usedTons($shipId) > 1e-9) {
                throw ApiError::denied('cargo_aboard', 'в трюме груз: сначала продайте его');
            }

            $credit = self::resale($mod['price']);
            Db::run('DELETE FROM `ship_equipment` WHERE `id`=?', [$mod['rowId']]);
            // Гнездо пусто по воле пилота: дозаливка заводского набора
            // иначе вернула бы модуль даром при следующем входе.
            Players::markBare($shipId, $mod['slot'], true);
            $money = Ledger::add($playerId, 'ВЕРФЬ · ПРОДАН: ' . $mod['name'], $credit, 'sell:' . $mod['code']);
            Loadout::forget($shipId);
            $after = self::settle($playerId, $shipId, $info);

            return [
                'removed' => $mod['code'],
                'credit' => $credit,
                'balance' => $after['balance'] ?? $money['balance'],
                'fuel' => $after['fuel'],
                'refund' => $after['refund'],
            ];
        });
    }

    private static function requireYard(array $info): void
    {
        if (!$info['services']['outfit']) {
            throw ApiError::denied('no_outfit', 'верфи здесь нет: модули ставят на станциях уровня 4–5, '
                . 'здесь ' . $info['tech']);
        }
    }

    /**
     * Привести корабль в согласие с новым снаряжением.
     *
     * Щит — не больше новой ёмкости (снятый щит — это ноль). Топливо — не
     * больше нового бака, а лишнее станция выкупает по своей цене.
     */
    private static function settle(int $playerId, int $shipId, array $info): array
    {
        $shieldMax = Loadout::shield($shipId)['shield_max'];
        Db::run('UPDATE `ship` SET `shield` = LEAST(`shield`, ?) WHERE `id`=?', [$shieldMax, $shipId]);

        $m = Fuel::model($shipId);
        $out = ['fuel' => $m['fuel'], 'refund' => 0];
        if ($m['fuel'] > $m['cap'] + 1e-6) {
            $excess = $m['fuel'] - $m['cap'];
            Db::update('ship', ['fuel_t' => round($m['cap'], 3)], '`id`=?', [$shipId]);
            $refund = (int) floor($excess * Fuel::price($info['bodyId']));
            $out['fuel'] = $m['cap'];
            $out['refund'] = $refund;
            if ($refund > 0) {
                $money = Ledger::add($playerId, 'ВЕРФЬ · ВЫКУП ТОПЛИВА: ' . Fuel::tons($excess),
                    $refund, 'fuel-back:' . $shipId);
                $out['balance'] = $money['balance'];
            }
        }
        return $out;
    }
}
