<?php
/**
 * Деньги: лента операций и баланс.
 *
 * Правило одно и оно жёсткое: баланс меняется ТОЛЬКО здесь и только
 * вместе со строкой в ленте. Прямое `UPDATE player SET balance` в обход
 * этого класса означало бы деньги, взявшиеся ниоткуда, — и невозможность
 * потом разобраться, откуда.
 *
 * Строка ленты хранит баланс ПОСЛЕ операции. Это не дублирование: лента
 * должна читаться как выписка из банка, в том числе задним числом и в
 * том числе после того, как первые записи уйдут за край.
 */

final class Ledger
{
    public static function add(int $playerId, string $label, int $amount, string $ref = ''): array
    {
        return Db::tx(function () use ($playerId, $label, $amount, $ref) {
            // Строка игрока берётся с блокировкой: два запроса подряд
            // (покупка и награда за задание) иначе прочитают один и тот же
            // баланс и второй затрёт первый. В одиночной игре это никогда
            // не выстрелит, в онлайне — выстрелит в первый же день.
            $balance = Db::one('SELECT `balance` FROM `player` WHERE `id`=? FOR UPDATE', [$playerId]);
            if ($balance === null) {
                throw ApiError::notFound('нет такого игрока');
            }
            $after = (int) $balance + $amount;
            Db::update('player', ['balance' => $after], '`id`=?', [$playerId]);
            Db::insert('ledger', [
                'player_id' => $playerId,
                'at' => Db::now(),
                'label' => mb_substr($label, 0, 128),
                'amount' => $amount,
                'balance_after' => $after,
                'ref' => mb_substr($ref, 0, 64),
            ]);
            return ['balance' => $after, 'amount' => $amount];
        });
    }

    /** Хватает ли денег. Отдельным вызовом, чтобы отказ был внятным. */
    public static function require(int $playerId, int $cost): int
    {
        $balance = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$playerId]);
        if ($balance < $cost) {
            throw ApiError::denied('no_funds', 'не хватает крон: нужно ' . $cost . ', есть ' . $balance, [
                'need' => $cost, 'have' => $balance,
            ]);
        }
        return $balance;
    }

    /** Последние записи, свежие сверху. */
    public static function tail(int $playerId, int $limit = 40): array
    {
        $limit = max(1, min(200, $limit));
        $rows = Db::all(
            'SELECT `at`,`label`,`amount`,`balance_after`,`ref` FROM `ledger`
             WHERE `player_id`=? ORDER BY `id` DESC LIMIT ' . $limit,
            [$playerId]
        );
        foreach ($rows as &$r) {
            $r['amount'] = (int) $r['amount'];
            $r['balance_after'] = (int) $r['balance_after'];
        }
        return $rows;
    }

    /** Сколько пришло и сколько ушло за всё время. */
    public static function totals(int $playerId): array
    {
        $r = Db::row(
            'SELECT
               COALESCE(SUM(CASE WHEN `amount` > 0 THEN `amount` ELSE 0 END), 0) AS `in`,
               COALESCE(SUM(CASE WHEN `amount` < 0 THEN -`amount` ELSE 0 END), 0) AS `out`
             FROM `ledger` WHERE `player_id`=?',
            [$playerId]
        );
        return ['in' => (int) $r['in'], 'out' => (int) $r['out']];
    }
}
