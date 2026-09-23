<?php
/**
 * Бой: урон, гибель и возвращение в строй.
 *
 * Разделение ответственности здесь такое же, как со стыковкой и торговлей:
 * клиент СЧИТАЕТ, сервер РЕШАЕТ. Попадание видит стрелявший — у него на
 * экране и болт, и цель в одном времени, — но корпус меняет только
 * сервер, и только он говорит жертве, что в неё попали. Иначе «сколько у
 * меня корпуса» было бы у каждого своё.
 *
 * Чего сервер проверить НЕ может: летел ли болт на самом деле. Физики
 * снарядов на сервере нет, как нет и физики полёта. Поэтому проверяется
 * то, что проверяемо: оружие стоит на корабле, цель в той же системе и в
 * пределах дальности, а попадания идут не чаще, чем оружие способно
 * стрелять. Это отсекает случайную ерунду и опечатки, но не отсекает
 * умышленный обман — честно сказать об этом сразу лучше, чем сделать вид,
 * будто тут защита.
 */

final class Combat
{
    /** Сколько попаданий в секунду принимаем от одного пилота. */
    public const HIT_RATE = 8;

    /**
     * Запас к дальности оружия.
     *
     * Клиент считает попадание по СВОЕМУ кадру, а до сервера оно идёт ещё
     * полпинга, и за это время корабли разъезжаются. Без запаса честные
     * попадания на пределе дальности отбрасывались бы тем чаще, чем хуже
     * связь, — то есть наказывали бы за плохой интернет.
     */
    public const RANGE_SLACK = 1.4;

    /**
     * Щит на данный момент.
     *
     * Щит НЕ пересчитывается по таймеру: сервер не крутит цикл по всем
     * кораблям в базе, а считает заряд от времени последнего попадания в
     * тот момент, когда его спросили. Для невидимой оболочки, которая
     * только копится, этого достаточно, а фонового процесса не нужно.
     *
     * @param array $ship строка корабля с полями типа (shield_max и т.д.)
     * @param int|null $now unix-время, для проверок
     */
    public static function shieldNow(array $ship, ?int $now = null): float
    {
        $max = (float) ($ship['shield_max'] ?? 0);
        if ($max <= 0) {
            return 0.0;
        }
        // По кораблю ещё не попадали — щит целый. Так же читаются и
        // корабли, заведённые до появления щитов вовсе.
        if (($ship['hit_at'] ?? null) === null) {
            return $max;
        }
        $idle = max(0, ($now ?? time()) - (int) strtotime((string) $ship['hit_at']));
        $have = min($max, (float) ($ship['shield'] ?? 0));
        $delay = (float) ($ship['shield_delay'] ?? 0);
        if ($idle <= $delay) {
            return $have;
        }
        return min($max, $have + (float) ($ship['shield_regen'] ?? 0) * ($idle - $delay));
    }

    /** Числа оружия — из того же каталога, что и в игре. */
    public static function weapon(string $code): ?array
    {
        $row = Db::row('SELECT `code`,`name`,`spec` FROM `equipment_type` WHERE `code`=? AND `slot`=?',
            [$code, 'gun']);
        if ($row === null) {
            return null;
        }
        $spec = json_decode((string) $row['spec'], true);
        if (!is_array($spec) || !isset($spec['damage'], $spec['range'], $spec['rate'])) {
            return null;
        }
        $spec['code'] = $row['code'];
        $spec['name'] = $row['name'];
        return $spec;
    }

    /** Стоит ли это оружие на корабле пилота. */
    public static function armed(int $playerId, string $code): bool
    {
        $n = Db::one(
            'SELECT COUNT(*) FROM `ship_equipment` se
             JOIN `equipment_type` e ON e.`id` = se.`equipment_id`
             JOIN `ship` s ON s.`id` = se.`ship_id`
             WHERE s.`owner_id`=? AND e.`code`=?',
            [$playerId, $code]
        );
        return (int) $n > 0;
    }

    /**
     * Урон по кораблю: сперва щит, потом корпус.
     *
     * Порядок именно такой и в этом весь смысл щита: он принимает удар на
     * себя и отрастает сам, а корпус чинят за деньги в порту.
     *
     * @return array{hull,max,shield,smax,absorbed,dead}
     */
    public static function damage(int $victimId, float $dmg): array
    {
        return Db::tx(function () use ($victimId, $dmg) {
            // Читаем ПОД ЗАМКОМ: два попадания в один миг — обычное дело,
            // и без него второе посчиталось бы от старых чисел.
            $row = Db::row(
                'SELECT s.`id`, s.`hull`, s.`shield`, s.`hit_at`,
                        t.`hull_max`, t.`shield_max`, t.`shield_regen`, t.`shield_delay`
                 FROM `ship` s JOIN `ship_type` t ON t.`id` = s.`type_id`
                 WHERE s.`owner_id`=? FOR UPDATE',
                [$victimId]
            );
            if ($row === null) {
                throw new ApiError('no_ship', 'у пилота нет корабля');
            }

            $dmg = max(0.0, $dmg);
            $shield = self::shieldNow($row);
            $absorbed = min($shield, $dmg);
            $shield -= $absorbed;
            $hull = max(0.0, (float) $row['hull'] - ($dmg - $absorbed));

            Db::update('ship', [
                'hull' => $hull,
                'shield' => $shield,
                'hit_at' => Db::now(),
            ], '`id`=?', [(int) $row['id']]);

            return [
                'hull' => $hull, 'max' => (float) $row['hull_max'],
                'shield' => $shield, 'smax' => (float) $row['shield_max'],
                'absorbed' => $absorbed,
                'dead' => $hull <= 0.0,
            ];
        });
    }

    /**
     * Возвращение в строй: корабль целый, пилот в порту.
     *
     * Своего «экрана гибели» у сервера нет и быть не может — он не знает,
     * смотрит ли кто-то в этот момент в экран. Поэтому гибель сразу
     * превращается в состояние, из которого можно играть дальше: в тот
     * порт, откуда пилот последний раз уходил. Цену за это (страховку,
     * потерю груза) добавлять рано — сначала должен появиться сам бой.
     */
    public static function respawn(int $victimId): void
    {
        Db::tx(function () use ($victimId) {
            $p = Db::row('SELECT `id`,`ship_id`,`system_id`,`last_station`,`crashes`
                          FROM `player` WHERE `id`=? FOR UPDATE', [$victimId]);
            if ($p === null) {
                return;
            }
            $where = $p['last_station'] !== null
                ? ['system_id' => (int) $p['system_id'], 'local_id' => (int) $p['last_station']]
                : Players::startPoint();

            Db::update('player', [
                'system_id' => $where['system_id'],
                'docked_body' => $where['local_id'],
                'last_station' => $where['local_id'],
                'landed_body' => null,
                'landed_pose' => null,
                'landed_secured' => 0,
                'pos_x' => 0, 'pos_y' => 0, 'pos_z' => 0,
                'basis' => null,
                'crashes' => (int) $p['crashes'] + 1,
            ], '`id`=?', [$victimId]);

            $hullMax = Db::one(
                'SELECT t.`hull_max` FROM `ship` s JOIN `ship_type` t ON t.`id`=s.`type_id`
                 WHERE s.`id`=?',
                [(int) $p['ship_id']]
            );
            if ($hullMax !== null) {
                // Щит после гибели тоже целый, и время последнего
                // попадания сбрасывается: новый корабль, новая жизнь.
                Db::update('ship', [
                    'hull' => (float) $hullMax,
                    'shield' => 0,
                    'hit_at' => null,
                ], '`id`=?', [(int) $p['ship_id']]);
            }
        });
    }
}
