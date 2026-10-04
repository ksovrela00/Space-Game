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
    /** Сколько попаданий в секунду принимаем от одного пилота (одно гнездо). */
    public const HIT_RATE = 8;

    /**
     * Запас к темпу оружия: попадания приходят пачками — кадры стрелка и
     * сеть неровные, — и два подряд бывают ближе, чем 1/темп.
     */
    public const RATE_SLACK = 1.25;

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
     * Числа щита (shield_max и т.д.) в строке — не из ship_type: они
     * принадлежат МОДУЛЮ щита и подставляются из Loadout::shield().
     *
     * @param array $ship строка корабля с числами щита
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

    /**
     * Урон от удара о грунт.
     *
     * Формула здесь, а не в игре, потому что корпус — это счёт, а счёт
     * ведёт сервер. Игра сообщает ИЗМЕРЕНИЕ: с какой скоростью коснулись
     * грунта, стояли ли шасси, была ли поза правильной. Сколько это
     * стоит — решают числа из каталога (specs.php -> meta), и подменить
     * их на своей стороне бессмысленно: считают не там.
     *
     * Та же формула есть в игре (js/game/landing.js) — ею она показывает
     * удар сразу, не дожидаясь ответа. Решает всё равно сервер.
     * Что две стороны считают одинаково, стережёт проверка.
     *
     * @param float $norm  нормальная составляющая скорости, км/с
     * @param float $slide боковая, км/с
     */
    public static function impactDamage(float $norm, float $slide, bool $gear, bool $poseOk): float
    {
        $c = Specs::forGame()['combat'];
        $hit = sqrt($norm * $norm + ($slide * (float) $c['scrapeK']) ** 2);
        $soft = (float) ($gear ? $c['hitSoft'] : $c['bareSoft']);
        $t = max(0.0, ($hit - $soft) / ((float) $c['hitKill'] - $soft));
        $dmg = 100.0 * $t * $t * ($gear ? 1.0 : (float) $c['bareMul']);
        if (!$gear) {
            $dmg = max($dmg, (float) $c['belly']);
        }
        if (!$poseOk) {
            $dmg = max($dmg, (float) $c['poseFloor']) * (float) $c['poseMul'];
        }
        return $dmg;
    }

    /**
     * Удар о грунт: посчитать и списать с корпуса.
     *
     * Единственный путь, которым корпус убывает от полёта. Сохранение
     * корпус НЕ ПИШЕТ вовсе (Players::save) — иначе игрок отвечал бы на
     * вопрос о своём корпусе сам, а значит, никогда бы не разбивался.
     */
    public static function impact(int $playerId, float $norm, float $slide,
                                  bool $gear, bool $poseOk, bool $fatal = false): array
    {
        $dmg = $fatal ? INF : self::impactDamage($norm, $slide, $gear, $poseOk);

        // Бьётся корабль, которым пилот командует: удар о грунт докладывает
        // тот, кто его ведёт (Hub, impact).
        $shipId = (int) Players::ship($playerId)['id'];
        return Db::tx(function () use ($shipId, $dmg) {
            $row = Db::row(
                'SELECT s.`id`, s.`hull`, t.`hull_max`
                 FROM `ship` s JOIN `ship_type` t ON t.`id` = s.`type_id`
                 WHERE s.`id`=? FOR UPDATE',
                [$shipId]
            );
            if ($row === null) {
                throw new ApiError('no_ship', 'у пилота нет корабля');
            }
            $hull = max(0.0, (float) $row['hull'] - $dmg);
            Db::update('ship', ['hull' => $hull], '`id`=?', [(int) $row['id']]);
            return [
                'hull' => $hull,
                'max' => (float) $row['hull_max'],
                'damage' => min($dmg, (float) $row['hull']),
                'dead' => $hull <= 0.0,
            ];
        });
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

    /**
     * Оружейных гнёзд у корабля — по его корпусу (ship_type.spec,
     * gunMounts в server/data/specs.php). Стоящее оружие бьёт из каждого
     * гнезда в своём темпе: у крейсера с пятью башнями попаданий впятеро
     * больше, и сервер принимает их в этом темпе (Hub::hit).
     */
    public static function mounts(int $shipId): int
    {
        $spec = json_decode((string) Db::one(
            'SELECT t.`spec` FROM `ship` s JOIN `ship_type` t ON t.`id` = s.`type_id` WHERE s.`id`=?',
            [$shipId]
        ), true);
        return max(1, (int) (is_array($spec) ? ($spec['gunMounts'] ?? 1) : 1));
    }

    /**
     * Сколько попаданий в секунду принимать от корабля с этим оружием:
     * темп оружия на число гнёзд с запасом RATE_SLACK — но не меньше
     * общего потолка HIT_RATE (одноствольным — прежние восемь).
     */
    public static function hitRate(array $gun, int $mounts): float
    {
        return max((float) self::HIT_RATE, (float) $gun['rate'] * max(1, $mounts) * self::RATE_SLACK);
    }

    /** Стоит ли это оружие на корабле, которым пилот командует. */
    public static function armed(int $playerId, string $code): bool
    {
        $n = Db::one(
            'SELECT COUNT(*) FROM `ship_equipment` se
             JOIN `equipment_type` e ON e.`id` = se.`equipment_id`
             JOIN `player` p ON p.`ship_id` = se.`ship_id`
             WHERE p.`id`=? AND e.`code`=?',
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
     * Попадают в КОРАБЛЬ, а не в пилота: пилот может стоять на грунте в
     * километре от своего корабля, а на борту может ехать чужой.
     *
     * @return array{hull,max,shield,smax,absorbed,dead}
     */
    public static function damage(int $shipId, float $dmg): array
    {
        return Db::tx(function () use ($shipId, $dmg) {
            // Читаем ПОД ЗАМКОМ: два попадания в один миг — обычное дело,
            // и без него второе посчиталось бы от старых чисел.
            $row = Db::row(
                'SELECT s.`id`, s.`hull`, s.`shield`, s.`hit_at`, t.`hull_max`
                 FROM `ship` s JOIN `ship_type` t ON t.`id` = s.`type_id`
                 WHERE s.`id`=? FOR UPDATE',
                [$shipId]
            );
            if ($row === null) {
                throw new ApiError('no_ship', 'у пилота нет корабля');
            }
            // Щит — свойство МОДУЛЯ, стоящего на этом корабле, а не типа
            // корпуса: сняли щит — и попадание идёт прямо в обшивку.
            $row += Loadout::shield((int) $row['id']);

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
     * Возвращение в строй: корабль целый, в порту.
     *
     * Своего «экрана гибели» у сервера нет и быть не может — он не знает,
     * смотрит ли кто-то в этот момент в экран. Поэтому гибель сразу
     * превращается в состояние, из которого можно играть дальше: в тот
     * порт, откуда хозяин последний раз уходил. Цену за это (страховку,
     * потерю груза) добавлять рано — сначала должен появиться сам бой.
     *
     * @param int $victimId пилот, чей корабль (тот, которым он командует)
     */
    public static function respawn(int $victimId): void
    {
        $shipId = (int) Players::ship($victimId)['id'];
        self::respawnShip($shipId);
    }

    /**
     * Корабль — в порт, целым; хозяин — в его кресло, пассажиры — на борт.
     *
     * Хозяина страховка возвращает ВМЕСТЕ с кораблём, где бы он ни был:
     * стоял он на грунте у корабля, который расстреляли, — и остался бы на
     * чужой планете без корабля, в тупике, из которого не выбраться.
     * Пассажиры остаются на борту: их везли — их и довезли.
     */
    public static function respawnShip(int $shipId): void
    {
        Db::tx(function () use ($shipId) {
            $ship = Db::row('SELECT * FROM `ship` WHERE `id`=? FOR UPDATE', [$shipId]);
            if ($ship === null) {
                return;
            }
            $ownerId = (int) $ship['owner_id'];
            $p = Db::row('SELECT `id`,`last_station`,`crashes` FROM `player` WHERE `id`=? FOR UPDATE',
                [$ownerId]);
            if ($p === null) {
                return;
            }
            $sys = $ship['system_id'] === null ? null : (int) $ship['system_id'];
            $where = null;
            if ($sys !== null && $p['last_station'] !== null && Db::one(
                "SELECT `id` FROM `body` WHERE `system_id`=? AND `local_id`=? AND `kind`='station'",
                [$sys, (int) $p['last_station']]
            ) !== null) {
                $where = ['system_id' => $sys, 'local_id' => (int) $p['last_station']];
            }
            if ($where === null) {
                $where = Players::startPoint();
            }

            $hullMax = (float) Db::one('SELECT `hull_max` FROM `ship_type` WHERE `id`=?',
                [(int) $ship['type_id']]);
            // Щит после гибели тоже целый, и время последнего попадания
            // сбрасывается: новый корабль, новая жизнь. Люки задраены.
            Db::update('ship', [
                'hull' => $hullMax,
                'shield' => 0,
                'hit_at' => null,
                'system_id' => $where['system_id'],
                'docked_body' => $where['local_id'],
                'landed_body' => null,
                'landed_pose' => null,
                'landed_secured' => 0,
                'anchor_body' => null,
                'anchor_pose' => null,
                'pos_x' => 0, 'pos_y' => 0, 'pos_z' => 0,
                'basis' => null,
                'hatches' => null,
            ], '`id`=?', [$shipId]);
            // Страховка возвращает корабль с резервом в баке — с тем, на
            // чём можно выйти из дока. Больше не доливает: иначе разбиться
            // было бы дешевле, чем заправиться.
            Fuel::topUpReserve($shipId);

            Db::update('player', [
                'system_id' => $where['system_id'],
                'last_station' => $where['local_id'],
                'aboard_ship' => $shipId,
                'ship_id' => $shipId,
                'seated' => 1,
                'walk_pose' => null,
                'out_body' => null,
                'out_pose' => null,
                'crashes' => (int) $p['crashes'] + 1,
            ], '`id`=?', [$ownerId]);
            // Пассажиры — с кораблём, на ногах.
            Db::run('UPDATE `player` SET `system_id`=?, `seated`=0, `walk_pose`=NULL
                     WHERE `aboard_ship`=? AND `id`<>?', [$where['system_id'], $shipId, $ownerId]);
        });
    }
}
