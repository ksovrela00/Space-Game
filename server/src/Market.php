<?php
/**
 * Рынок станции: цены, покупка, продажа.
 *
 * Считает СЕРВЕР, и это не перестраховка. Цена, склад и остаток крон —
 * ровно то, во что играют против других игроков; посчитай их клиент, и
 * первый же желающий купит тысячу тонн за одну крону. Поэтому клиент
 * присылает только «что и сколько», а всё остальное решается здесь.
 *
 * Торговать можно ТОЛЬКО стоя в порту: это и правило игры, и защита —
 * иначе рынок работал бы из любой точки галактики.
 */

final class Market
{
    /** Прайс станции. */
    public static function prices(int $systemId, int $stationLocalId): array
    {
        $station = Galaxy::body($systemId, $stationLocalId);
        if ($station['kind'] !== 'station') {
            throw ApiError::bad('это не станция: ' . $station['name']);
        }
        $rows = Db::all(
            'SELECT c.`code`, c.`name`, c.`category`, c.`legal`, c.`base_price`,
                    m.`price`, m.`stock`, m.`updated_at`
             FROM `market` m JOIN `commodity` c ON c.`id` = m.`commodity_id`
             WHERE m.`station_id`=? ORDER BY c.`base_price`',
            [$station['id']]
        );
        foreach ($rows as &$r) {
            $r['price'] = (int) $r['price'];
            $r['base_price'] = (int) $r['base_price'];
            $r['stock'] = (float) $r['stock'];
            $r['legal'] = (bool) $r['legal'];
        }
        return [
            // Свойства порта идут вместе с прайсом: клиенту в одном окне
            // нужны и цены, и то, что здесь вообще есть (верфь, ремонт).
            'station' => array_merge(
                Stations::info($systemId, $stationLocalId),
                ['world' => $station['parent_type']]
            ),
            'goods' => $rows,
        ];
    }

    public static function buy(int $playerId, string $code, float $tons): array
    {
        return self::trade($playerId, $code, $tons, true);
    }

    public static function sell(int $playerId, string $code, float $tons): array
    {
        return self::trade($playerId, $code, $tons, false);
    }

    /**
     * Сделка целиком: проверки, деньги, трюм и склад станции — в одной
     * транзакции. Оборвись она посередине, у игрока оказался бы товар без
     * списанных крон либо кроны без товара.
     */
    private static function trade(int $playerId, string $code, float $tons, bool $buying): array
    {
        $tons = round($tons, 3);
        if (!($tons > 0)) {
            throw ApiError::bad('тоннаж должен быть больше нуля');
        }

        return Db::tx(function () use ($playerId, $code, $tons, $buying) {
            $p = Players::byId($playerId);
            $ship = Players::ship($playerId);
            $shipId = (int) $ship['id'];

            if ($p['docked_body'] === null || $p['system_id'] === null) {
                throw ApiError::denied('not_docked', 'торговать можно только в порту');
            }
            $station = Galaxy::body((int) $p['system_id'], (int) $p['docked_body']);
            if ($station['kind'] !== 'station') {
                throw ApiError::denied('not_docked', 'торговать можно только в порту');
            }

            $good = Db::row('SELECT * FROM `commodity` WHERE `code`=?', [$code]);
            if ($good === null) {
                throw ApiError::notFound('нет такого товара: ' . $code);
            }
            // Строка рынка блокируется: два покупателя иначе разберут один
            // и тот же склад дважды.
            $slot = Db::row(
                'SELECT * FROM `market` WHERE `station_id`=? AND `commodity_id`=? FOR UPDATE',
                [$station['id'], $good['id']]
            );
            if ($slot === null) {
                throw ApiError::denied('not_traded', 'этим здесь не торгуют');
            }

            $price = (int) $slot['price'];
            $sum = (int) round($price * $tons);
            $stock = (float) $slot['stock'];

            if ($buying) {
                if ($stock + 1e-9 < $tons) {
                    throw ApiError::denied('no_stock', 'на складе только ' . $stock . ' т', [
                        'stock' => $stock,
                    ]);
                }
                $free = Cargo::freeTons($shipId, (float) $ship['hold_t']);
                if ($free + 1e-9 < $tons) {
                    throw ApiError::denied('no_room', 'в трюме свободно ' . $free . ' т', [
                        'free' => $free,
                    ]);
                }
                Ledger::require($playerId, $sum);

                Cargo::add($shipId, (int) $good['id'], $tons, $price);
                Db::update('market', ['stock' => round($stock - $tons, 3), 'updated_at' => Db::now()],
                    '`id`=?', [$slot['id']]);
                $money = Ledger::add($playerId, 'ПОКУПКА: ' . $good['name'] . ', ' . self::tons($tons),
                    -$sum, 'buy:' . $good['code']);
            } else {
                Cargo::take($shipId, (int) $good['id'], $tons);
                Db::update('market', ['stock' => round($stock + $tons, 3), 'updated_at' => Db::now()],
                    '`id`=?', [$slot['id']]);
                $money = Ledger::add($playerId, 'ПРОДАЖА: ' . $good['name'] . ', ' . self::tons($tons),
                    $sum, 'sell:' . $good['code']);
            }

            return [
                'code' => $good['code'],
                'tons' => $tons,
                'price' => $price,
                'sum' => $buying ? -$sum : $sum,
                'balance' => $money['balance'],
                'holdUsedT' => Cargo::usedTons($shipId),
                'holdT' => (float) $ship['hold_t'],
                'cargo' => Cargo::listOf($shipId),
            ];
        });
    }

    private static function tons(float $t): string
    {
        return rtrim(rtrim(number_format($t, 1, '.', ''), '0'), '.') . ' Т';
    }
}
