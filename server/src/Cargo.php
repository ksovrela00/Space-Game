<?php
/**
 * Трюм.
 *
 * Мера одна — ТОННЫ. Объём не считается нигде: в накладной важен вес, и
 * он же потом будет влиять на разгон. Один товар лежит одной строкой, а
 * не плодит записи при каждой покупке; средняя цена покупки при этом
 * пересчитывается, и по ней видно, в плюс или в минус идёт рейс.
 *
 * Тонны в базе — DECIMAL, и сложение идёт в базе, а не в PHP: на
 * плавающих числах остаток после сотни сделок оказывается 0.0000001 т
 * вместо пустого трюма, и «пустой» трюм перестаёт быть пустым.
 */

final class Cargo
{
    public static function listOf(int $shipId): array
    {
        $rows = Db::all(
            'SELECT c.`commodity_id`, m.`code`, m.`name`, m.`category`, m.`legal`,
                    c.`tons`, c.`avg_price`
             FROM `cargo` c JOIN `commodity` m ON m.`id` = c.`commodity_id`
             WHERE c.`ship_id`=? ORDER BY m.`name`',
            [$shipId]
        );
        foreach ($rows as &$r) {
            $r['commodity_id'] = (int) $r['commodity_id'];
            $r['tons'] = (float) $r['tons'];
            $r['avg_price'] = (float) $r['avg_price'];
            $r['legal'] = (bool) $r['legal'];
        }
        return $rows;
    }

    public static function usedTons(int $shipId): float
    {
        return (float) Db::one('SELECT COALESCE(SUM(`tons`), 0) FROM `cargo` WHERE `ship_id`=?', [$shipId]);
    }

    public static function freeTons(int $shipId, float $holdT): float
    {
        return max(0.0, $holdT - self::usedTons($shipId));
    }

    public static function tonsOf(int $shipId, int $commodityId): float
    {
        $v = Db::one('SELECT `tons` FROM `cargo` WHERE `ship_id`=? AND `commodity_id`=?', [$shipId, $commodityId]);
        return $v === null ? 0.0 : (float) $v;
    }

    /** Положить в трюм. Средняя цена — средневзвешенная по тоннажу. */
    public static function add(int $shipId, int $commodityId, float $tons, float $price): void
    {
        Db::run(
            'INSERT INTO `cargo` (`ship_id`,`commodity_id`,`tons`,`avg_price`) VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE
               `avg_price` = (`avg_price` * `tons` + VALUES(`avg_price`) * VALUES(`tons`))
                             / (`tons` + VALUES(`tons`)),
               `tons` = `tons` + VALUES(`tons`)',
            [$shipId, $commodityId, $tons, $price]
        );
    }

    /**
     * Снять с трюма. Строка, ушедшая в ноль, удаляется целиком: пустая
     * позиция в накладной — это мусор, который потом приходится молча
     * отфильтровывать в каждом месте, где трюм показывают.
     */
    public static function take(int $shipId, int $commodityId, float $tons): void
    {
        $have = self::tonsOf($shipId, $commodityId);
        if ($have + 1e-9 < $tons) {
            throw ApiError::denied('no_cargo', 'в трюме столько нет: есть ' . $have . ' т', [
                'have' => $have, 'want' => $tons,
            ]);
        }
        $left = round($have - $tons, 3);
        if ($left <= 0.0001) {
            Db::run('DELETE FROM `cargo` WHERE `ship_id`=? AND `commodity_id`=?', [$shipId, $commodityId]);
        } else {
            Db::update('cargo', ['tons' => $left], '`ship_id`=? AND `commodity_id`=?', [$shipId, $commodityId]);
        }
    }
}
