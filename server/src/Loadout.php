<?php

/**
 * ЧТО СТОИТ НА КОРАБЛЕ и что оно ему даёт.
 *
 * Числа лётной модели принадлежат МОДУЛЯМ: двигатель знает свою
 * скорость, разгон и тормоз, щит — ёмкость и восстановление, трюм —
 * тоннаж. Корпус хранит только своё (прочность, бак, радиус попадания).
 * Поэтому «какая у этого корабля скорость» — вопрос не к ship_type, а к
 * тому, что записано в ship_equipment.
 *
 * Сюда же сходятся все серверные вопросы про щит: урон (Combat), чужие
 * корабли в хабе (Hub), состояние пилота (Players). Раньше эти числа
 * лежали столбцами в ship_type, и у всех кораблей одного типа щит был
 * одинаковый по определению — поставить другой было нельзя даже в
 * мыслях.
 *
 * Разбирать `spec` каждый раз заново незачем: за один запрос про один и
 * тот же корабль спрашивают трижды (попадание, состояние, рассылка
 * соседям), и это один и тот же ответ.
 */
final class Loadout
{
    /** Разобранное снаряжение по кораблям: ship_id -> строки. */
    private static array $cache = [];

    /** Сбросить память — после установки или снятия модуля. */
    public static function forget(?int $shipId = null): void
    {
        if ($shipId === null) {
            self::$cache = [];
        } else {
            unset(self::$cache[$shipId]);
        }
    }

    /**
     * Модули, стоящие в гнёздах этого корабля, вместе с их числами.
     *
     * Берутся у корабля, а не из каталога «что положено с завода»: если
     * пилоту поставили двигатель, которого в каталоге уже нет, корабль
     * обязан лететь по тому, что на нём стоит.
     */
    public static function modules(int $shipId): array
    {
        if (isset(self::$cache[$shipId])) {
            return self::$cache[$shipId];
        }
        $rows = Db::all(
            'SELECT e.`code`, e.`name`, e.`slot`, e.`spec`
             FROM `ship_equipment` se JOIN `equipment_type` e ON e.`id` = se.`equipment_id`
             WHERE se.`ship_id`=? ORDER BY e.`id`',
            [$shipId]
        );
        foreach ($rows as &$r) {
            $spec = json_decode((string) $r['spec'], true);
            $r['spec'] = is_array($spec) ? $spec : [];
            $r['installed'] = true;
        }
        unset($r);
        return self::$cache[$shipId] = $rows;
    }

    /**
     * Числа, которые снаряжение даёт кораблю.
     *
     * Порядок и способ сборки тот же, что в игре (js/game/loadout.js,
     * flightModel) и в ответе с характеристиками (Specs::mergeFlight):
     * разойдись они, сервер и клиент по-разному ответили бы, какой у
     * корабля щит, — а в онлайне это решается не в пользу клиента.
     */
    public static function flight(int $shipId): array
    {
        $out = [];
        foreach (self::modules($shipId) as $m) {
            foreach ($m['spec']['flight'] ?? [] as $key => $value) {
                $out[$key] = $value;
            }
        }
        return $out;
    }

    /**
     * Числа щита этого корабля в том виде, в каком их ждёт SQL-строка.
     *
     * Отдельным методом, потому что спрашивают в трёх местах и всегда
     * одинаково: раньше эти три поля приезжали join-ом из ship_type, и
     * заменить их разом — значит не забыть ни одного.
     */
    public static function shield(int $shipId): array
    {
        $f = self::flight($shipId);
        return [
            'shield_max' => (float) ($f['maxShield'] ?? 0),
            'shield_regen' => (float) ($f['shieldRegen'] ?? 0),
            'shield_delay' => (float) ($f['shieldDelay'] ?? 0),
        ];
    }
}
