<?php
/**
 * Игрок: создание, полное состояние, сохранение полёта.
 *
 * Это тот кусок, ради которого затевался сервер: сейчас всё состояние
 * игрока лежит в localStorage браузера, то есть у игрока в руках. В
 * онлайне так нельзя — не из-за недоверия, а потому что состояние одно на
 * всех: чужой корабль в порту должен быть там же, где его оставил хозяин.
 *
 * Что сервер проверяет, а что пока нет — важно понимать честно. Проверяются
 * ССЫЛКИ и ПРЕДЕЛЫ: система существует, порт существует и находится в той
 * же системе, корпус не больше заводского, числа — числа. Не проверяется
 * само движение: чтобы поймать «телепорт через полсистемы», нужен счёт
 * физики на сервере, а его нет. Это следующий этап, и до него сервер —
 * хранилище с правилами, а не судья.
 */

final class Players
{
    /** Новый пилот: корабль с завода, стартовый капитал, место в порту. */
    public static function create(string $login, string $passHash, string $name): int
    {
        return Db::tx(function () use ($login, $passHash, $name) {
            $now = Db::now();
            $playerId = Db::insert('player', [
                'login' => $login,
                'pass_hash' => $passHash,
                'name' => $name,
                'created_at' => $now,
                'last_seen_at' => $now,
                'balance' => 0,
            ]);

            $type = Db::row('SELECT * FROM `ship_type` ORDER BY `id` LIMIT 1');
            if ($type === null) {
                throw new RuntimeException('в базе нет ни одного типа кораблей: залейте каталог');
            }

            $shipId = Db::insert('ship', [
                'type_id' => $type['id'],
                'owner_id' => $playerId,
                'name' => '',
                'hull' => $type['hull_max'],
                // Щит ставится НИЖЕ, после комплектации: его ёмкость знает
                // модуль щита, а модулей на только что заведённом корабле
                // ещё нет — ship_equipment ссылается на его id.
                'shield' => 0,
                'fuel_t' => $type['fuel_t'],
                'created_at' => $now,
            ]);

            // Заводская комплектация: всё, что помечено stock.
            foreach (Db::all('SELECT `id` FROM `equipment_type` WHERE `stock`=1') as $e) {
                Db::insert('ship_equipment', ['ship_id' => $shipId, 'equipment_id' => $e['id']]);
            }
            Loadout::forget($shipId);
            Db::update('ship', ['shield' => Loadout::shield($shipId)['shield_max']],
                '`id`=?', [$shipId]);

            $start = self::startPoint();
            Db::update('player', [
                'ship_id' => $shipId,
                'system_id' => $start['system_id'],
                'docked_body' => $start['local_id'],
            ], '`id`=?', [$playerId]);

            // Стартовый капитал приходит СТРОКОЙ В ЛЕНТЕ, а не присвоением
            // баланса: в разделе «Финансы» не должно быть денег, взявшихся
            // ниоткуда, — даже первых.
            Ledger::add($playerId, 'НАЧАЛЬНЫЙ КАПИТАЛ', Content::START_BALANCE, 'start');
            return $playerId;
        });
    }

    /** Порт обжитого мира родной системы. */
    public static function startPoint(): array
    {
        $row = Db::row(
            "SELECT st.`system_id`, st.`local_id`
             FROM `body` st
             JOIN `body` w ON w.`system_id` = st.`system_id` AND w.`local_id` = st.`parent_local_id`
             JOIN `star_system` s ON s.`id` = st.`system_id`
             WHERE st.`kind`='station' AND w.`is_home_world`=1 AND s.`is_home`=1
             ORDER BY st.`local_id` LIMIT 1"
        );
        if ($row === null) {
            // Родной системы в каталоге может не оказаться только если его
            // не заливали; лучше честная ошибка, чем игрок в пустоте.
            throw new RuntimeException('в каталоге нет порта родной системы: залейте каталог');
        }
        return ['system_id' => (int) $row['system_id'], 'local_id' => (int) $row['local_id']];
    }

    public static function byId(int $id): array
    {
        $p = Db::row('SELECT * FROM `player` WHERE `id`=?', [$id]);
        if ($p === null) {
            throw ApiError::notFound('нет такого игрока');
        }
        return $p;
    }

    /** Корабль игрока вместе с типом. */
    public static function ship(int $playerId): array
    {
        $row = Db::row(
            'SELECT sh.*, t.`code` AS `type_code`, t.`name` AS `type_name`, t.`title` AS `type_title`,
                    t.`hull_max`, t.`fuel_t` AS `fuel_max`,
                    t.`length_m`, t.`width_m`, t.`height_m`
             FROM `ship` sh JOIN `ship_type` t ON t.`id` = sh.`type_id`
             WHERE sh.`owner_id`=? ORDER BY sh.`id` LIMIT 1',
            [$playerId]
        );
        if ($row === null) {
            throw ApiError::notFound('у игрока нет корабля');
        }
        // Щит и трюм принадлежат МОДУЛЯМ, а не типу корпуса. Кладём их в
        // ту же строку под теми же именами, под какими они приезжали
        // столбцами: читателям (Market, Missions, Combat) знать об этой
        // перемене незачем — им нужен тоннаж, а не его происхождение.
        $shipId = (int) $row['id'];
        $flight = Loadout::flight($shipId);
        $row['hold_t'] = (float) ($flight['hold'] ?? 0);
        $row += Loadout::shield($shipId);
        return $row;
    }

    /** Полное состояние: то, с чего клиент начинает игру. */
    /**
     * Доустановить заводские модули, которых на корабле нет.
     *
     * Каталог пополняется по ходу разработки (так появилось оружие), а
     * корабли заведены раньше. Без этого у старых пилотов не оказалось бы
     * пушек вовсе, и «почему у меня не стреляет» выяснялось бы в бою.
     * Вызов идемпотентный: ставит только недостающее.
     *
     * ЗАНЯТОЕ ГНЕЗДО НЕ ТРОГАЕТ. Это не мелочь: в гнезде бывает несколько
     * видов одного прибора (два двигателя), и поставили пилоту другой —
     * заводского там больше нет. Проверяй мы наличие по коду предмета, а
     * не по занятости гнезда, доукомплектование возвращало бы заводской
     * обратно, и в гнезде оказывались бы два двигателя разом. Лететь
     * корабль стал бы по тому из них, у кого больше id, — то есть по
     * случайности.
     *
     * Вместимость гнезда берётся из самой комплектации: сколько приборов
     * этого гнезда помечено заводскими, столько их и помещается. Так
     * «компьютеров два» (докинг и посадочный) остаётся правдой, не
     * заведя отдельной таблицы гнёзд, которую пришлось бы помнить
     * править.
     */
    public static function ensureStock(int $shipId): void
    {
        // Заняты ли гнёзда. Занятое НЕ ТРОГАЕМ: что в нём стоит, решает не
        // эта функция — пилот мог купить другой двигатель, а хозяин
        // сервера поставить руками что угодно.
        $busy = [];
        foreach (Db::all(
            'SELECT e.`slot`, COUNT(*) AS `n` FROM `ship_equipment` se
             JOIN `equipment_type` e ON e.`id`=se.`equipment_id`
             WHERE se.`ship_id`=? GROUP BY e.`slot`',
            [$shipId]
        ) as $r) {
            $busy[(string) $r['slot']] = (int) $r['n'];
        }

        // Ёмкость гнезда СЧИТАЛАСЬ ПО ЧИСЛУ ЗАВОДСКИХ ТИПОВ этого слота, и
        // это было неверно. Стоит завести второй заводской привод — и
        // ёмкость слота `drive` становится двойкой, а кораблю с одним
        // приводом дозаливается второй. Ровно так в базе появлялась лишняя
        // строка после каждого запуска игры, сколько её ни удаляй: запрос
        // состояния зовёт эту функцию каждый раз.
        //
        // Теперь ёмкость приходит из каталога (Specs::slotCap): гнездо
        // `computer` держит два прибора — докинг-компьютер и посадочный, —
        // а все прочие по одному. Заводится ещё один вариант привода —
        // ёмкость не меняется, и дозаливка молчит.
        //
        // Заполненное гнездо не трогаем вовсе: что в нём стоит, решает не
        // эта функция. Пилот мог купить другой двигатель, а хозяин сервера
        // — поставить руками что угодно.
        // Берём только то, чего на корабле ЕЩЁ НЕТ. Без этого отбора
        // корабль с одним прибором из двухместного гнезда (скажем, с
        // докинг-компьютером без посадочного) получал бы повторную вставку
        // того же прибора — и падение на уникальном ключе.
        $put = false;
        foreach (Db::all(
            'SELECT `id`, `slot` FROM `equipment_type`
             WHERE `stock`=1 AND `id` NOT IN (
                 SELECT se.`equipment_id` FROM `ship_equipment` se WHERE se.`ship_id`=?
             ) ORDER BY `id`',
            [$shipId]
        ) as $e) {
            $slot = (string) $e['slot'];
            if (($busy[$slot] ?? 0) >= Specs::slotCap($slot)) {
                continue;
            }
            Db::insert('ship_equipment', ['ship_id' => $shipId, 'equipment_id' => (int) $e['id']]);
            $busy[$slot] = ($busy[$slot] ?? 0) + 1;
            $put = true;
        }
        if ($put) {
            Loadout::forget($shipId);
        }
    }

    public static function state(int $playerId): array
    {
        $p = self::byId($playerId);
        $ship = self::ship($playerId);
        $shipId = (int) $ship['id'];
        self::ensureStock($shipId);

        $equipment = Db::all(
            'SELECT e.`code`, e.`name`, e.`slot`, e.`spec`, se.`level`, se.`health`
             FROM `ship_equipment` se JOIN `equipment_type` e ON e.`id` = se.`equipment_id`
             WHERE se.`ship_id`=? ORDER BY e.`id`',
            [$shipId]
        );
        foreach ($equipment as &$e) {
            $e['spec'] = $e['spec'] === null ? null : json_decode($e['spec'], true);
            $e['level'] = (int) $e['level'];
            $e['health'] = (float) $e['health'];
        }
        unset($e);

        return [
            // Время мира — общее для всех и считается сервером: орбиты
            // планет и станций идут от него, и разойдись оно у двоих,
            // они увидят один и тот же мир по-разному (см. Clock).
            'world' => ['time' => Clock::worldTime()],
            'player' => [
                'id' => (int) $p['id'],
                'login' => $p['login'],
                'name' => $p['name'],
                'balance' => (int) $p['balance'],
                'playTimeS' => (float) $p['play_time_s'],
                'stats' => [
                    'flownKm' => (float) $p['flown_km'],
                    'docks' => (int) $p['docks'],
                    'landings' => (int) $p['landings'],
                    'crashes' => (int) $p['crashes'],
                ],
            ],
            'position' => [
                'systemId' => $p['system_id'] === null ? null : (int) $p['system_id'],
                'pos' => ['x' => (float) $p['pos_x'], 'y' => (float) $p['pos_y'], 'z' => (float) $p['pos_z']],
                'basis' => $p['basis'] === null ? null : json_decode($p['basis'], true),
                'dockedBody' => $p['docked_body'] === null ? null : (int) $p['docked_body'],
                'targetBody' => $p['target_body'] === null ? null : (int) $p['target_body'],
                'warpTo' => $p['warp_to'] === null ? null : (int) $p['warp_to'],
                'lastStation' => $p['last_station'] === null ? null : (int) $p['last_station'],
                'view' => $p['view'],
                'landedBody' => $p['landed_body'] === null ? null : (int) $p['landed_body'],
                'landedPose' => $p['landed_pose'] === null ? null : json_decode($p['landed_pose'], true),
                'landedSecured' => (bool) $p['landed_secured'],
                'anchorBody' => $p['anchor_body'] === null ? null : (int) $p['anchor_body'],
                'anchorPose' => $p['anchor_pose'] === null ? null : json_decode($p['anchor_pose'], true),
            ],
            'ship' => [
                'id' => $shipId,
                'name' => $ship['name'],
                'hull' => (float) $ship['hull'],
                // Щит считается на СЕЙЧАС: в базе лежит его заряд на
                // момент последнего попадания, а он с тех пор отрастал.
                'shield' => Combat::shieldNow($ship),
                'fuelT' => (float) $ship['fuel_t'],
                'gearOut' => (bool) $ship['gear_out'],
                // Тип, а не его характеристики: за ними игра ходит в
                // `catalog.specs` — там они одни на всех и берутся из тех
                // же таблиц. Слать их ещё и здесь значило бы завести
                // второй путь к тем же числам, который однажды разойдётся
                // с первым. Габариты — исключение: они про ЭТОТ корпус и
                // нужны приборам подхода.
                'type' => [
                    'code' => $ship['type_code'],
                    'name' => $ship['type_name'],
                    'title' => $ship['type_title'],
                    'lengthM' => (float) $ship['length_m'],
                    'widthM' => (float) $ship['width_m'],
                    'heightM' => (float) $ship['height_m'],
                ],
                'equipment' => $equipment,
            ],
            'cargo' => Cargo::listOf($shipId),
            'holdUsedT' => Cargo::usedTons($shipId),
            'missions' => Missions::mine($playerId),
            'ledger' => Ledger::tail($playerId, 40),
        ];
    }

    /**
     * Сохранение полёта.
     *
     * Принимает ровно то, что игра кладёт сейчас в localStorage, — и это
     * не случайность: смысл в том, чтобы одно хранилище можно было
     * заменить другим, ничего не переписывая в игре.
     */
    public static function save(int $playerId, array $in): array
    {
        $p = self::byId($playerId);
        $ship = self::ship($playerId);

        $num = static function ($v, float $def = 0.0): float {
            return is_numeric($v) && is_finite((float) $v) ? (float) $v : $def;
        };

        $set = [];

        if (isset($in['system'])) {
            $sysId = (int) $in['system'];
            if (Db::one('SELECT `id` FROM `star_system` WHERE `id`=?', [$sysId]) === null) {
                throw ApiError::bad('нет такой системы: ' . $sysId);
            }
            $set['system_id'] = $sysId;
        }
        $sysId = $set['system_id'] ?? ($p['system_id'] === null ? null : (int) $p['system_id']);

        if (isset($in['pos'])) {
            $set['pos_x'] = $num($in['pos']['x'] ?? null);
            $set['pos_y'] = $num($in['pos']['y'] ?? null);
            $set['pos_z'] = $num($in['pos']['z'] ?? null);
        }
        if (isset($in['basis'])) {
            $set['basis'] = json_encode($in['basis']);
        }

        // Тело, у которого стоит корабль, обязано быть в ТОЙ ЖЕ системе.
        // Без этой проверки сохранение «состыкован с портом другой
        // системы» прошло бы молча, а игра после загрузки поставила бы
        // корабль в пустоту.
        $bodyIn = static function ($v) use ($sysId) {
            if ($v === null || $v === '') {
                return null;
            }
            $local = (int) $v;
            if ($sysId === null) {
                throw ApiError::bad('тело указано, а система — нет');
            }
            $ok = Db::one('SELECT `id` FROM `body` WHERE `system_id`=? AND `local_id`=?', [$sysId, $local]);
            if ($ok === null) {
                throw ApiError::bad('в системе ' . $sysId . ' нет тела ' . $local);
            }
            return $local;
        };

        if (array_key_exists('docked', $in)) {
            $set['docked_body'] = $bodyIn($in['docked']);
        }
        if (array_key_exists('landed', $in)) {
            $landed = $in['landed'];
            if (is_array($landed) && isset($landed['id'])) {
                $set['landed_body'] = $bodyIn($landed['id']);
                $set['landed_pose'] = json_encode($landed['pose'] ?? null);
                $set['landed_secured'] = !empty($landed['secured']) ? 1 : 0;
            } else {
                $set['landed_body'] = null;
                $set['landed_pose'] = null;
                $set['landed_secured'] = 0;
            }
        }
        // Место в полёте — в осях тела захвата, рядом с которым корабль
        // вышел из игры. Складывается рядом с landed и по той же причине:
        // мировая точка через час указывает в пустоту. Числа раскладываются
        // поштучно, а не кладутся строкой от игры: в базе должны лежать
        // девять чисел, а не что угодно, что пришло с чужой машины.
        if (array_key_exists('anchor', $in)) {
            $a = $in['anchor'];
            $vec = static function ($v) use ($num) {
                if (!is_array($v)) {
                    return null;
                }
                return ['x' => $num($v['x'] ?? null), 'y' => $num($v['y'] ?? null),
                    'z' => $num($v['z'] ?? null)];
            };
            $pos = is_array($a) ? $vec($a['pos'] ?? null) : null;
            $fwd = is_array($a) ? $vec($a['fwd'] ?? null) : null;
            $up = is_array($a) ? $vec($a['up'] ?? null) : null;
            if ($pos !== null && $fwd !== null && $up !== null && isset($a['id'])) {
                $set['anchor_body'] = $bodyIn($a['id']);
                $set['anchor_pose'] = json_encode(['pos' => $pos, 'fwd' => $fwd, 'up' => $up]);
            } else {
                $set['anchor_body'] = null;
                $set['anchor_pose'] = null;
            }
        }
        if (array_key_exists('target', $in)) {
            $set['target_body'] = $bodyIn($in['target']);
        }
        if (array_key_exists('last', $in)) {
            $set['last_station'] = $bodyIn($in['last']);
        }
        if (array_key_exists('warpTo', $in)) {
            $w = $in['warpTo'];
            if ($w === null || $w === '') {
                $set['warp_to'] = null;
            } else {
                $wid = (int) $w;
                if (Db::one('SELECT `id` FROM `star_system` WHERE `id`=?', [$wid]) === null) {
                    throw ApiError::bad('нет такой системы для варпа: ' . $wid);
                }
                $set['warp_to'] = $wid;
            }
        }
        if (isset($in['view'])) {
            // Вид — из закрытого списка: это поле приходит от клиента, а
            // любое поле от клиента может прийти каким угодно.
            $set['view'] = in_array($in['view'], ['cockpit', 'chase'], true) ? $in['view'] : 'cockpit';
        }
        if (isset($in['time'])) {
            $set['play_time_s'] = max(0.0, $num($in['time']));
        }
        if (isset($in['stats']) && is_array($in['stats'])) {
            $s = $in['stats'];
            $set['flown_km'] = max(0.0, $num($s['flownKm'] ?? 0));
            $set['docks'] = max(0, (int) ($s['docks'] ?? 0));
            $set['landings'] = max(0, (int) ($s['landings'] ?? 0));
            $set['crashes'] = max(0, (int) ($s['crashes'] ?? 0));
        }

        if ($set) {
            $set['last_seen_at'] = Db::now();
            Db::update('player', $set, '`id`=?', [$playerId]);
        }

        // Состояние корабля живёт в своей таблице: корпус и бак принадлежат
        // КОРАБЛЮ, а не пилоту, и при смене корпуса останутся со старым.
        $shipSet = [];
        // КОРПУС ИЗ СОХРАНЕНИЯ НЕ ПИШЕТСЯ ВОВСЕ — ни в какую сторону.
        //
        // Сохранение приходит от игры, а игра живёт на чужой машине: что в
        // ней написано, решает тот, кто за ней сидит. Поэтому всё, что
        // имеет цену, считает сервер и только он:
        //
        //   попадание в бою   -> Combat::damage   (по своим числам оружия)
        //   удар о грунт      -> Combat::impact   (игра шлёт измерение)
        //   ремонт            -> Stations::repair (за деньги, в порту)
        //   гибель            -> Combat::respawn
        //
        // Игре остаётся то, что она одна и знает: где корабль, куда
        // повёрнут, у какого тела стоит. Эти числа ничего не стоят — на
        // них нельзя выиграть бой и нельзя не заплатить за ремонт.
        if (isset($in['fuel'])) {
            $shipSet['fuel_t'] = max(0.0, min((float) $ship['fuel_max'], $num($in['fuel'])));
        }
        if (array_key_exists('gear', $in)) {
            $shipSet['gear_out'] = !empty($in['gear']) ? 1 : 0;
        }
        if ($shipSet) {
            Db::update('ship', $shipSet, '`id`=?', [$ship['id']]);
        }

        return ['saved' => true, 'fields' => count($set) + count($shipSet)];
    }
}
