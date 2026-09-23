<?php
/**
 * Чтение каталога: где какая звезда и что вокруг неё.
 *
 * Тела адресуются парой «система + локальный номер», а не сквозным id.
 * Локальный номер — это тот самый id, который генератор раздаёт телу при
 * сборке системы и который лежит в сохранении игрока (цель, порт, точка
 * стоянки). Сквозной id базы клиенту вообще не показывается: он живёт
 * только внутри сервера и нужен только внешним ключам.
 */

final class Galaxy
{
    /** Все системы: то, что рисует карта галактики. */
    public static function systems(): array
    {
        $rows = Db::all(
            'SELECT s.*, (SELECT COUNT(*) FROM `body` b
                          WHERE b.`system_id`=s.`id` AND b.`kind`=\'planet\') AS `planets`,
                         (SELECT COUNT(*) FROM `body` b
                          WHERE b.`system_id`=s.`id` AND b.`kind`=\'station\') AS `stations`
             FROM `star_system` s ORDER BY s.`id`'
        );
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'id' => (int) $r['id'],
                'seed' => (int) $r['seed'],
                'name' => $r['name'],
                'starClass' => $r['star_class'],
                'luminosity' => (float) $r['luminosity'],
                'starRadiusKm' => (float) $r['star_radius_km'],
                'starTempK' => (int) $r['star_temp_k'],
                'habitableKm' => (float) $r['habitable_km'],
                'home' => (bool) $r['is_home'],
                'pos' => ['x' => (float) $r['pos_x'], 'y' => (float) $r['pos_y'], 'z' => (float) $r['pos_z']],
                'planets' => (int) $r['planets'],
                'stations' => (int) $r['stations'],
            ];
        }
        return $out;
    }

    public static function system(int $id): array
    {
        $s = Db::row('SELECT * FROM `star_system` WHERE `id`=?', [$id]);
        if ($s === null) {
            throw ApiError::notFound('нет такой системы: ' . $id);
        }
        $bodies = [];
        foreach (Db::all('SELECT * FROM `body` WHERE `system_id`=? ORDER BY `local_id`', [$id]) as $b) {
            $bodies[] = self::bodyOut($b);
        }
        return [
            'id' => (int) $s['id'],
            'seed' => (int) $s['seed'],
            'name' => $s['name'],
            'starClass' => $s['star_class'],
            'habitableKm' => (float) $s['habitable_km'],
            'home' => (bool) $s['is_home'],
            'pos' => ['x' => (float) $s['pos_x'], 'y' => (float) $s['pos_y'], 'z' => (float) $s['pos_z']],
            'bodies' => $bodies,
        ];
    }

    /** Одно тело вместе с видом родителя (его спрашивает рынок). */
    public static function body(int $systemId, int $localId): array
    {
        $row = Db::row(
            'SELECT b.*, p.`type` AS `parent_type`, p.`name` AS `parent_name`
             FROM `body` b
             LEFT JOIN `body` p ON p.`system_id` = b.`system_id` AND p.`local_id` = b.`parent_local_id`
             WHERE b.`system_id`=? AND b.`local_id`=?',
            [$systemId, $localId]
        );
        if ($row === null) {
            throw ApiError::notFound('нет тела ' . $localId . ' в системе ' . $systemId);
        }
        return $row;
    }

    public static function bodyOut(array $b): array
    {
        return [
            'localId' => (int) $b['local_id'],
            'parentLocalId' => $b['parent_local_id'] === null ? null : (int) $b['parent_local_id'],
            'kind' => $b['kind'],
            'type' => $b['type'],
            'name' => $b['name'],
            'radiusKm' => (float) $b['radius_km'],
            'orbitRadiusKm' => $b['orbit_radius_km'] === null ? null : (float) $b['orbit_radius_km'],
            'orbitPeriodS' => $b['orbit_period_s'] === null ? null : (float) $b['orbit_period_s'],
            'orbitPhase' => $b['orbit_phase'] === null ? null : (float) $b['orbit_phase'],
            'orbitPlane' => $b['orbit_plane'] === null ? null : json_decode($b['orbit_plane'], true),
            'spinPeriodS' => $b['spin_period_s'] === null ? null : (float) $b['spin_period_s'],
            'pressBar' => (float) $b['press_bar'],
            'hasRings' => (bool) $b['has_rings'],
            'hasStation' => (bool) $b['has_station'],
            'isHomeWorld' => (bool) $b['is_home_world'],
            'landable' => (bool) $b['landable'],
        ];
    }

    /** Расстояние между системами, световые годы. */
    public static function distance(int $a, int $b): float
    {
        $x = Db::row('SELECT `pos_x`,`pos_y`,`pos_z` FROM `star_system` WHERE `id`=?', [$a]);
        $y = Db::row('SELECT `pos_x`,`pos_y`,`pos_z` FROM `star_system` WHERE `id`=?', [$b]);
        if ($x === null || $y === null) {
            throw ApiError::notFound('нет такой системы');
        }
        return sqrt(
            ($x['pos_x'] - $y['pos_x']) ** 2 +
            ($x['pos_y'] - $y['pos_y']) ** 2 +
            ($x['pos_z'] - $y['pos_z']) ** 2
        );
    }

    /** Станции: все или в одной системе. */
    public static function stations(?int $systemId = null): array
    {
        $sql = "SELECT b.*, p.`type` AS `parent_type` FROM `body` b
                LEFT JOIN `body` p ON p.`system_id`=b.`system_id` AND p.`local_id`=b.`parent_local_id`
                WHERE b.`kind`='station'";
        $args = [];
        if ($systemId !== null) {
            $sql .= ' AND b.`system_id`=?';
            $args[] = $systemId;
        }
        return Db::all($sql . ' ORDER BY b.`system_id`, b.`local_id`', $args);
    }
}
