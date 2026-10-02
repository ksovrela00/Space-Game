<?php
/**
 * Игрок: создание, полное состояние, сохранение.
 *
 * Это тот кусок, ради которого затевался сервер: сейчас всё состояние
 * игрока лежит в localStorage браузера, то есть у игрока в руках. В
 * онлайне так нельзя — не из-за недоверия, а потому что состояние одно на
 * всех: чужой корабль в порту должен быть там же, где его оставил хозяин.
 *
 * ПИЛОТ И КОРАБЛЬ — РАЗНЫЕ ВЕЩИ (схема 10). Пилот — человек: сидит в
 * кресле, ходит по палубе, стоит на грунте, едет пассажиром в чужом
 * корабле. Корабль — вещь: стоит там, где его оставили, кто бы куда ни
 * ушёл. Отсюда два места в сохранении — `ship` (где корабль, которым
 * пилот командует) и `me` (где сам пилот), — и разные правила для них:
 *
 *   * место корабля пишет только ТОТ, КТО ИМ КОМАНДУЕТ (`player.ship_id`,
 *     и это всегда его хозяин). Пассажир корабль не двигает;
 *   * место пилота пишет сам пилот, но сменить корабль, на борту
 *     которого он стоит, можно только рядом с ним (BOARD_KM): с грунта
 *     у трапа или из соседнего корабля. Телепорта на чужой борт через
 *     полпланеты сервер не примет;
 *   * в кресло пилота садятся только в СВОЁМ корабле: чужой корабль
 *     везёт, но не слушается;
 *   * на чужом борту стоят, только пока его хозяин В ИГРЕ (`player.online`,
 *     его ведёт хаб). Ушёл хозяин — из мира ушли и его корабли, и
 *     пассажирам стоять не на чем: они возвращаются в кресла своих
 *     кораблей (sendHome).
 *
 * Что сервер проверяет, а что нет — важно понимать честно. Проверяются
 * ССЫЛКИ и ПРЕДЕЛЫ: система существует, порт существует и находится в той
 * же системе, корпус не больше заводского, числа — числа, корабль рядом.
 * Не проверяется само движение: чтобы поймать «телепорт через
 * полсистемы», нужен счёт физики на сервере, а его нет. Это следующий
 * этап, и до него сервер — хранилище с правилами, а не судья.
 */

final class Players
{
    /**
     * Насколько далеко от корабля можно быть, чтобы взойти на борт или
     * сойти с него, км.
     *
     * Место пилота приходит с сохранением раз в восемь секунд, и за это
     * время бегом проходят сорок метров; корабль — шестьдесят пять метров
     * в длину, трап — ещё пять. Полкилометра — с запасом на опоздавшее
     * сохранение и на то, что пилот обошёл корабль кругом. Больше нельзя:
     * дальше уже не «зашёл по трапу», а «оказался».
     */
    public const BOARD_KM = 0.5;

    /** Палуба корабля, м: дальше этого от центра точки на борту нет. */
    public const DECK_M = 60.0;

    /**
     * Палуба корабля его типа, м: дальше этого от центра масс точки на
     * борту нет. У «Челленджера» — прежние 60, у «Прометея» (195 м) —
     * шесть десятых длины: нос ангара в ста метрах от центра масс,
     * а корма жилой палубы — в семидесяти. Без корабля — по самому
     * большому типу (хаб разбирает снимок, ещё не зная, чей он).
     */
    public static function deckM(?array $ship = null): float
    {
        static $byType = null;
        if ($byType === null) {
            $byType = [];
            foreach (Db::all('SELECT `id`, `length_m` FROM `ship_type`') as $t) {
                $byType[(int) $t['id']] = max(self::DECK_M, 0.6 * (float) $t['length_m']);
            }
        }
        if ($ship === null) {
            return $byType ? max($byType) : self::DECK_M;
        }
        return $byType[(int) ($ship['type_id'] ?? 0)] ?? self::DECK_M;
    }

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

            $start = self::startPoint();
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
                // Новый корабль стоит в порту родной системы.
                'system_id' => $start['system_id'],
                'docked_body' => $start['local_id'],
                'created_at' => $now,
            ]);

            // Заводская комплектация: всё, что помечено stock.
            foreach (Db::all('SELECT `id` FROM `equipment_type` WHERE `stock`=1') as $e) {
                Db::insert('ship_equipment', ['ship_id' => $shipId, 'equipment_id' => $e['id']]);
            }
            Loadout::forget($shipId);
            Db::update('ship', ['shield' => Loadout::shield($shipId)['shield_max']],
                '`id`=?', [$shipId]);

            // ...а пилот — в его кресле.
            Db::update('player', [
                'ship_id' => $shipId,
                'system_id' => $start['system_id'],
                'aboard_ship' => $shipId,
                'seated' => 1,
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

    /**
     * Корабль, которым пилот командует, вместе с типом.
     *
     * Не «первый из его кораблей», а тот, что записан в `player.ship_id`:
     * кораблей может быть несколько. Если записи нет или она чужая
     * (корабль продали, базу правили руками) — первый свой, и запись
     * чинится тут же: пилот без корабля, которым командует, не может
     * ни торговать, ни лететь.
     */
    public static function ship(int $playerId): array
    {
        $sql = 'SELECT sh.*, t.`code` AS `type_code`, t.`name` AS `type_name`, t.`title` AS `type_title`,
                    t.`hull_max`, t.`fuel_t` AS `fuel_max`,
                    t.`length_m`, t.`width_m`, t.`height_m`
             FROM `ship` sh JOIN `ship_type` t ON t.`id` = sh.`type_id` ';
        $row = Db::row($sql . 'JOIN `player` p ON p.`ship_id` = sh.`id`
             WHERE p.`id`=? AND sh.`owner_id`=p.`id`', [$playerId]);
        if ($row === null) {
            $row = Db::row($sql . 'WHERE sh.`owner_id`=? ORDER BY sh.`id` LIMIT 1', [$playerId]);
            if ($row !== null) {
                Db::update('player', ['ship_id' => (int) $row['id']], '`id`=?', [$playerId]);
            }
        }
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

    /**
     * Порт, в котором пилот может вести дела: его корабль стоит в доке, и
     * сам он на борту.
     *
     * Оба условия, а не одно. Рынок продаёт В ТРЮМ, верфь ставит модуль
     * В ГНЕЗДО — то есть туда, где стоит корабль. Пассажир чужого
     * корабля, вошедшего в порт, в этом порту, но его трюм — там, где он
     * оставил свой корабль.
     *
     * @return array{system_id:int, local_id:int, ship:array}|null
     */
    public static function port(int $playerId): ?array
    {
        $p = self::byId($playerId);
        $ship = self::ship($playerId);
        if ($ship['docked_body'] === null || $ship['system_id'] === null
            || (int) $p['aboard_ship'] !== (int) $ship['id']) {
            return null;
        }
        return ['system_id' => (int) $ship['system_id'], 'local_id' => (int) $ship['docked_body'],
            'ship' => $ship];
    }

    /** То же, но без порта — отказ с понятным словом. */
    public static function portOrDeny(int $playerId, string $why): array
    {
        $port = self::port($playerId);
        if ($port === null) {
            throw ApiError::denied('not_docked', $why);
        }
        return $port;
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
        // Гнёзда, опустошённые на верфи, — решение пилота, а не пробел в
        // комплектации: он за них получил кроны (Outfit::sell).
        $bare = self::bareSlots($shipId);
        $put = false;
        foreach (Db::all(
            'SELECT `id`, `slot` FROM `equipment_type`
             WHERE `stock`=1 AND `id` NOT IN (
                 SELECT se.`equipment_id` FROM `ship_equipment` se WHERE se.`ship_id`=?
             ) ORDER BY `id`',
            [$shipId]
        ) as $e) {
            $slot = (string) $e['slot'];
            if (($busy[$slot] ?? 0) >= Specs::slotCap($slot) || in_array($slot, $bare, true)) {
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

    /** Гнёзда, которые пилот опустошил сам (ship.bare). */
    public static function bareSlots(int $shipId): array
    {
        $v = json_decode((string) Db::one('SELECT `bare` FROM `ship` WHERE `id`=?', [$shipId]), true);
        return is_array($v) ? array_values(array_filter($v, 'is_string')) : [];
    }

    /** Отметить гнездо опустошённым пилотом — или снять отметку. */
    public static function markBare(int $shipId, string $slot, bool $bare): void
    {
        $list = array_values(array_diff(self::bareSlots($shipId), [$slot]));
        if ($bare) {
            $list[] = $slot;
        }
        Db::update('ship', ['bare' => $list ? json_encode($list) : null], '`id`=?', [$shipId]);
    }

    // --- где стоит корабль ------------------------------------------------------

    private static function json(?string $v)
    {
        return $v === null ? null : json_decode($v, true);
    }

    /** Открытые люки корабля: список имён. */
    public static function hatchesOf(array $ship): array
    {
        $v = self::json($ship['hatches'] ?? null);
        return is_array($v) ? array_values(array_filter($v, 'is_string')) : [];
    }

    /**
     * Где корабль — в том виде, в каком его раскладывает игра
     * (js/main.js, applyState): система, порт, стоянка, якорь, точка.
     */
    public static function placeOf(array $ship): array
    {
        $int = static fn($v) => $v === null ? null : (int) $v;
        return [
            'systemId' => $int($ship['system_id']),
            'pos' => ['x' => (float) $ship['pos_x'], 'y' => (float) $ship['pos_y'], 'z' => (float) $ship['pos_z']],
            'basis' => self::json($ship['basis']),
            'dockedBody' => $int($ship['docked_body']),
            'landedBody' => $int($ship['landed_body']),
            'landedPose' => self::json($ship['landed_pose']),
            'landedSecured' => (bool) $ship['landed_secured'],
            'anchorBody' => $int($ship['anchor_body']),
            'anchorPose' => self::json($ship['anchor_pose']),
            'gearOut' => (bool) $ship['gear_out'],
            'hatches' => self::hatchesOf($ship),
        ];
    }

    /**
     * Точка корабля в ОСЯХ ТЕЛА, км, и само тело — для проверки «рядом ли».
     *
     * Есть только у стоящего на грунте и у висящего над телом: именно там
     * и ходят пешком. В порту и в пустоте точки нет — сойти с корабля там
     * некуда, взойти неоткуда.
     *
     * @return array{body:int, p:array{0:float,1:float,2:float}}|null
     */
    public static function shipPoint(array $ship): ?array
    {
        if ($ship['landed_body'] !== null) {
            $pose = self::json($ship['landed_pose']);
            $d = is_array($pose) ? ($pose['dir'] ?? null) : null;
            $r = is_array($pose) ? ($pose['radius'] ?? null) : null;
            if (is_array($d) && is_numeric($r)) {
                return ['body' => (int) $ship['landed_body'], 'p' => [
                    (float) ($d['x'] ?? 0) * (float) $r,
                    (float) ($d['y'] ?? 0) * (float) $r,
                    (float) ($d['z'] ?? 0) * (float) $r,
                ]];
            }
        }
        if ($ship['anchor_body'] !== null) {
            $pose = self::json($ship['anchor_pose']);
            $p = is_array($pose) ? ($pose['pos'] ?? null) : null;
            if (is_array($p)) {
                return ['body' => (int) $ship['anchor_body'],
                    'p' => [(float) ($p['x'] ?? 0), (float) ($p['y'] ?? 0), (float) ($p['z'] ?? 0)]];
            }
        }
        return null;
    }

    /** Где сам пилот в осях тела (за бортом) — или null. */
    private static function personPoint(array $p): ?array
    {
        if ($p['aboard_ship'] !== null || $p['out_body'] === null) {
            return null;
        }
        $pose = self::json($p['out_pose']);
        $o = is_array($pose) ? ($pose['o'] ?? null) : null;
        if (!is_array($o)) {
            return null;
        }
        return ['body' => (int) $p['out_body'],
            'p' => [(float) ($o['x'] ?? 0), (float) ($o['y'] ?? 0), (float) ($o['z'] ?? 0)]];
    }

    /** Две точки на одном теле ближе BOARD_KM. */
    private static function near(?array $a, ?array $b, float $km = self::BOARD_KM): bool
    {
        if ($a === null || $b === null || $a['body'] !== $b['body']) {
            return false;
        }
        $dx = $a['p'][0] - $b['p'][0];
        $dy = $a['p'][1] - $b['p'][1];
        $dz = $a['p'][2] - $b['p'][2];
        return sqrt($dx * $dx + $dy * $dy + $dz * $dz) <= $km;
    }

    /** Строка корабля по номеру (без типа). */
    public static function shipRow(int $shipId): ?array
    {
        return Db::row('SELECT * FROM `ship` WHERE `id`=?', [$shipId]);
    }

    /**
     * Пилот на борту своего корабля, стоящего в том же порту, что и `$ship`:
     * оба в доке одной станции одной системы.
     */
    public static function sameDock(array $p, array $ship): bool
    {
        if ($p['aboard_ship'] === null || $ship['docked_body'] === null || $ship['system_id'] === null) {
            return false;
        }
        // Чей корабль, на борту которого стоит пилот, — неважно: пассажир
        // чужого корабля в том же доке тоже переходит к своему по станции.
        $from = self::shipRow((int) $p['aboard_ship']);
        return $from !== null
            && $from['docked_body'] !== null && $from['system_id'] !== null
            && (int) $from['docked_body'] === (int) $ship['docked_body']
            && (int) $from['system_id'] === (int) $ship['system_id'];
    }

    /**
     * Может ли пилот, стоящий там, где стоит, оказаться на борту `$ship`.
     *
     * С грунта — если корабль на том же теле и рядом. С другого корабля —
     * если оба стоят на одном теле рядом друг с другом (между двумя
     * сохранениями пилот успевает сойти с одного трапа и подняться по
     * другому). Ниоткуда — только на свой корабль: так выглядит запись,
     * в которой места пилота ещё не было.
     */
    public static function canBoard(array $p, array $ship): bool
    {
        if ($p['system_id'] !== null && $ship['system_id'] !== null
            && (int) $p['system_id'] !== (int) $ship['system_id']) {
            return false;
        }
        $at = self::shipPoint($ship);
        if ($p['aboard_ship'] !== null) {
            $from = self::shipRow((int) $p['aboard_ship']);
            if ($from === null) {
                return (int) $ship['owner_id'] === (int) $p['id'];
            }
            return self::near(self::shipPoint($from), $at);
        }
        $me = self::personPoint($p);
        if ($me === null) {
            return (int) $ship['owner_id'] === (int) $p['id'];
        }
        return self::near($me, $at);
    }

    /** Хозяина корабля нет в игре — и это не сам пилот. */
    private static function ownerAway(array $ship, int $playerId): bool
    {
        $owner = (int) $ship['owner_id'];
        return $owner !== $playerId
            && !(int) Db::one('SELECT `online` FROM `player` WHERE `id`=?', [$owner]);
    }

    /**
     * Вернуть пилота в кресло его корабля — того, которым он командует.
     *
     * Так кончается поездка пассажиром, когда хозяин ушёл из игры: его
     * корабль ушёл из мира вместе с ним (Hub::strand), и стоять больше не
     * на чем. Высадить на грунт у трапа было бы честнее с виду, но
     * корабль мог висеть в пустоте или стоять в доке, а свой у пассажира
     * бывает в другой системе — он остался бы там, где сам не дойдёт.
     * Свой корабль ждёт его, где оставлен: туда и в ту систему.
     *
     * @return int корабль, в кресле которого он теперь
     */
    public static function sendHome(int $playerId): int
    {
        $ship = self::ship($playerId);
        $set = ['aboard_ship' => (int) $ship['id'], 'seated' => 1, 'walk_pose' => null,
            'out_body' => null, 'out_pose' => null];
        if ($ship['system_id'] !== null) {
            $set['system_id'] = (int) $ship['system_id'];
        }
        Db::update('player', $set, '`id`=?', [$playerId]);
        return (int) $ship['id'];
    }

    /** Пилот без корабля, которым командует, его не видит в своём состоянии. */
    private static function vessel(array $row): array
    {
        $owner = Db::row('SELECT `name`,`login` FROM `player` WHERE `id`=?', [(int) $row['owner_id']]);
        $type = Db::row('SELECT `code`,`name` FROM `ship_type` WHERE `id`=?', [(int) $row['type_id']]);
        return [
            'id' => (int) $row['id'],
            'ownerId' => (int) $row['owner_id'],
            'ownerName' => $owner ? ($owner['name'] ?: $owner['login']) : '',
            'name' => (string) $row['name'],
            'type' => $type ? ['code' => $type['code'], 'name' => $type['name']] : null,
        ] + self::placeOf($row);
    }

    /** Все корабли пилота: каким командует, где стоят остальные. */
    public static function fleet(int $playerId, int $activeId): array
    {
        $out = [];
        foreach (Db::all(
            'SELECT sh.*, t.`code` AS `type_code`, t.`name` AS `type_name`
             FROM `ship` sh JOIN `ship_type` t ON t.`id`=sh.`type_id`
             WHERE sh.`owner_id`=? ORDER BY sh.`id`',
            [$playerId]
        ) as $r) {
            $out[] = [
                'id' => (int) $r['id'],
                'name' => (string) $r['name'],
                'type' => $r['type_code'],
                'typeName' => $r['type_name'],
                'active' => (int) $r['id'] === $activeId,
                'systemId' => $r['system_id'] === null ? null : (int) $r['system_id'],
                'where' => $r['docked_body'] !== null ? 'docked'
                    : ($r['landed_body'] !== null ? 'landed' : 'flight'),
                'body' => $r['docked_body'] !== null ? (int) $r['docked_body']
                    : ($r['landed_body'] !== null ? (int) $r['landed_body']
                        : ($r['anchor_body'] !== null ? (int) $r['anchor_body'] : null)),
            ];
        }
        return $out;
    }

    /** Где пилот сам — в том виде, в каком его раскладывает игра. */
    public static function meOf(array $p): array
    {
        $out = null;
        if ($p['aboard_ship'] === null && $p['out_body'] !== null) {
            $pose = self::json($p['out_pose']);
            if (is_array($pose)) {
                $out = ['body' => (int) $p['out_body']] + $pose;
            }
        }
        return [
            'systemId' => $p['system_id'] === null ? null : (int) $p['system_id'],
            'aboard' => $p['aboard_ship'] === null ? null : (int) $p['aboard_ship'],
            'seated' => (bool) $p['seated'],
            'walk' => $p['aboard_ship'] !== null && !$p['seated'] ? self::json($p['walk_pose']) : null,
            'out' => $out,
        ];
    }

    public static function state(int $playerId): array
    {
        $p = self::byId($playerId);
        $ship = self::ship($playerId);
        $shipId = (int) $ship['id'];
        self::ensureStock($shipId);
        // Строка пилота могла поправиться выше (ship чинит ship_id).
        $p = self::byId($playerId);
        // На борту чужого корабля, а хозяина нет в игре: такого корабля
        // ни для кого больше нет, и стоять на нём нельзя. Обычно таких
        // пассажиров возвращает хаб (Hub::strand) — здесь на случай, когда
        // хаба не было вовсе или он упал, не успев.
        if ($p['aboard_ship'] !== null) {
            $row = self::shipRow((int) $p['aboard_ship']);
            if ($row !== null && self::ownerAway($row, $playerId)) {
                self::sendHome($playerId);
                $p = self::byId($playerId);
            }
        }

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

        // На борту ЧУЖОГО корабля (или своего, но не того, которым
        // командует): игре нужно знать, где он стоит, — пока сокет не
        // прислал первый снимок, ставить пилота не на что.
        $aboard = null;
        if ($p['aboard_ship'] !== null && (int) $p['aboard_ship'] !== $shipId) {
            $row = self::shipRow((int) $p['aboard_ship']);
            if ($row !== null) {
                $aboard = self::vessel($row);
            }
        }

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
            // Где КОРАБЛЬ, которым пилот командует, и план его полёта.
            'position' => self::placeOf($ship) + [
                'targetBody' => $p['target_body'] === null ? null : (int) $p['target_body'],
                'warpTo' => $p['warp_to'] === null ? null : (int) $p['warp_to'],
                'lastStation' => $p['last_station'] === null ? null : (int) $p['last_station'],
                'view' => $p['view'],
            ],
            // Где САМ ПИЛОТ: в кресле, на палубе, на грунте.
            'me' => self::meOf($p),
            'aboard' => $aboard,
            'fleet' => self::fleet($playerId, $shipId),
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

    // --- сохранение ----------------------------------------------------------------

    private static function num($v, float $def = 0.0): float
    {
        return is_numeric($v) && is_finite((float) $v) ? (float) $v : $def;
    }

    /** Три числа из {x,y,z} — или null. */
    private static function vec($v): ?array
    {
        if (!is_array($v)) {
            return null;
        }
        return ['x' => self::num($v['x'] ?? null), 'y' => self::num($v['y'] ?? null),
            'z' => self::num($v['z'] ?? null)];
    }

    /** Единичный вектор из {x,y,z} — или null, если он выродился. */
    private static function unit($v): ?array
    {
        $a = self::vec($v);
        if ($a === null) {
            return null;
        }
        $l = sqrt($a['x'] ** 2 + $a['y'] ** 2 + $a['z'] ** 2);
        if (!($l > 1e-6)) {
            return null;
        }
        return ['x' => $a['x'] / $l, 'y' => $a['y'] / $l, 'z' => $a['z'] / $l];
    }

    /**
     * Тело, указанное сохранением, обязано быть в ТОЙ ЖЕ системе. Без
     * этой проверки «состыкован с портом другой системы» прошло бы молча,
     * а игра после загрузки поставила бы корабль в пустоту.
     */
    private static function bodyIn($v, ?int $sysId): ?int
    {
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
    }

    private static function systemIn($v): int
    {
        $sysId = (int) $v;
        if (Db::one('SELECT `id` FROM `star_system` WHERE `id`=?', [$sysId]) === null) {
            throw ApiError::bad('нет такой системы: ' . $sysId);
        }
        return $sysId;
    }

    /** Поля места корабля в сохранении старого вида (до схемы 10). */
    private const SHIP_KEYS = ['system', 'pos', 'basis', 'docked', 'landed', 'anchor', 'gear', 'hatches'];

    /**
     * Сохранение.
     *
     * Принимает ровно то, что игра кладёт в localStorage, — и это не
     * случайность: смысл в том, чтобы одно хранилище можно было заменить
     * другим, ничего не переписывая в игре.
     *
     * Три части, и у каждой свой хозяин:
     *
     *   `ship` — где корабль, которым пилот командует. Только он;
     *            id другого корабля здесь не пройдёт;
     *   `me`   — где сам пилот: на борту какого корабля, в кресле ли, где
     *            на палубе или на грунте;
     *   остальное — план полёта (цель, порт, вид) и счётчики пилота.
     *
     * Сохранение старого вида (место корабля полями верхнего уровня, без
     * `me`) читается как «пилот в кресле своего корабля»: так его пишет
     * кэш браузера от прошлой версии игры.
     */
    public static function save(int $playerId, array $in): array
    {
        $p = self::byId($playerId);
        $ship = self::ship($playerId);
        $shipId = (int) $ship['id'];
        $p = self::byId($playerId);

        $legacy = !array_key_exists('ship', $in) && !array_key_exists('me', $in);
        $shipIn = $legacy ? array_intersect_key($in, array_flip(self::SHIP_KEYS)) : ($in['ship'] ?? null);

        // --- корабль ------------------------------------------------------------
        $shipSet = [];
        $warp = 0.0;
        $ignored = false;
        if (is_array($shipIn) && $shipIn) {
            if (isset($shipIn['id']) && (int) $shipIn['id'] !== $shipId) {
                // Сохранение за корабль, которым пилот уже не командует
                // (пересел, а сохранение было в пути), — не пишем. Ошибкой
                // это не считается: иначе игра решила бы, что связи нет.
                $ignored = true;
            } else {
                $wasSys = $ship['system_id'] === null ? null : (int) $ship['system_id'];
                if (isset($shipIn['system'])) {
                    $shipSet['system_id'] = self::systemIn($shipIn['system']);
                }
                $sysS = $shipSet['system_id'] ?? $wasSys;
                $shipSet += self::shipFields($shipIn, $sysS);
                if ($shipSet) {
                    Db::update('ship', $shipSet, '`id`=?', [$shipId]);
                }
                // Корабль сменил систему — значит, был варп-прыжок, и за
                // него платят топливом. Считает сервер по каталогу:
                // расстояние между звёздами он знает сам. И все, кто на
                // борту, — хозяин и пассажиры, — теперь в новой системе.
                if (isset($shipSet['system_id']) && $shipSet['system_id'] !== $wasSys) {
                    $warp = Fuel::arriveShip($shipId, $wasSys, $shipSet['system_id']);
                    Db::run('UPDATE `player` SET `system_id`=? WHERE `aboard_ship`=?',
                        [$shipSet['system_id'], $shipId]);
                }
            }
        }

        // --- сам пилот ----------------------------------------------------------
        $set = [];
        $denied = null;
        $p = self::byId($playerId);
        if (!$legacy && is_array($in['me'] ?? null)) {
            [$set, $denied] = self::meFields($p, $in['me'], $shipId);
        } elseif ($legacy && isset($shipSet['system_id']) && $p['aboard_ship'] === null) {
            // Старый вид без места пилота — пилот считается в кресле.
            $set = ['aboard_ship' => $shipId, 'seated' => 1, 'walk_pose' => null,
                'out_body' => null, 'out_pose' => null, 'system_id' => $shipSet['system_id']];
        }

        // --- план полёта и счётчики ---------------------------------------------
        $sysP = isset($set['system_id']) ? $set['system_id']
            : ($p['system_id'] === null ? null : (int) $p['system_id']);
        if (array_key_exists('target', $in)) {
            $set['target_body'] = self::bodyIn($in['target'], $sysP);
        }
        if (array_key_exists('last', $in)) {
            // Последний порт — порт системы, где стоит корабль: в него
            // тянет буксир и возвращает страховка.
            $set['last_station'] = self::bodyIn($in['last'],
                $shipSet['system_id'] ?? ($ship['system_id'] === null ? null : (int) $ship['system_id']));
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
            $set['play_time_s'] = max(0.0, self::num($in['time']));
        }
        if (isset($in['stats']) && is_array($in['stats'])) {
            $s = $in['stats'];
            $set['flown_km'] = max(0.0, self::num($s['flownKm'] ?? 0));
            $set['docks'] = max(0, (int) ($s['docks'] ?? 0));
            $set['landings'] = max(0, (int) ($s['landings'] ?? 0));
            $set['crashes'] = max(0, (int) ($s['crashes'] ?? 0));
        }

        if ($set || $shipSet) {
            $set['last_seen_at'] = Db::now();
            Db::update('player', $set, '`id`=?', [$playerId]);
        }

        $out = [
            'saved' => true,
            'fields' => count($set) + count($shipSet),
            // Бак — каким его видит сервер после этого сохранения: игра
            // без сокета иначе не узнала бы о списанном варпе до
            // следующей загрузки.
            'fuel' => (float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipId]),
            'warpFuel' => round($warp, 3),
        ];
        if ($ignored) {
            $out['shipIgnored'] = true;
        }
        if ($denied !== null) {
            // Чего сервер не принял и почему: игра вернёт пилота туда,
            // где он по счёту сервера есть.
            $out['meDenied'] = $denied;
            $out['me'] = self::meOf(self::byId($playerId));
        }
        return $out;
    }

    /**
     * Поля места корабля из сохранения.
     *
     * КОРПУС ИЗ СОХРАНЕНИЯ НЕ ПИШЕТСЯ ВОВСЕ — ни в какую сторону.
     * Сохранение приходит от игры, а игра живёт на чужой машине: что в
     * ней написано, решает тот, кто за ней сидит. Поэтому всё, что имеет
     * цену, считает сервер и только он:
     *
     *   попадание в бою   -> Combat::damage   (по своим числам оружия)
     *   удар о грунт      -> Combat::impact   (игра шлёт измерение)
     *   ремонт            -> Stations::repair (за деньги, в порту)
     *   гибель            -> Combat::respawn
     *
     * Игре остаётся то, что она одна и знает: где корабль, куда повёрнут,
     * у какого тела стоит, открыты ли люки. Эти числа ничего не стоят —
     * на них нельзя выиграть бой и нельзя не заплатить за ремонт.
     *
     * ТОПЛИВО — по той же причине, что и корпус: оно стоит денег, и полный
     * бак из сохранения означал бы бесплатную заправку после каждого
     * прыжка. Расход считает хаб (Hub::meter) и варп (Fuel::arriveShip),
     * заправку — Fuel::refuel. Поле `fuel` игра по-прежнему кладёт в
     * сохранение — для автономного режима, — и здесь оно не читается.
     */
    private static function shipFields(array $in, ?int $sysId): array
    {
        $set = [];
        if (isset($in['pos'])) {
            $v = self::vec($in['pos']) ?? ['x' => 0.0, 'y' => 0.0, 'z' => 0.0];
            $set['pos_x'] = $v['x'];
            $set['pos_y'] = $v['y'];
            $set['pos_z'] = $v['z'];
        }
        if (isset($in['basis'])) {
            $set['basis'] = json_encode($in['basis']);
        }
        if (array_key_exists('docked', $in)) {
            $set['docked_body'] = self::bodyIn($in['docked'], $sysId);
        }
        if (array_key_exists('landed', $in)) {
            $landed = $in['landed'];
            if (is_array($landed) && isset($landed['id'])) {
                $set['landed_body'] = self::bodyIn($landed['id'], $sysId);
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
        // мировая точка через час указывает в пустоту. Числа
        // раскладываются поштучно, а не кладутся строкой от игры: в базе
        // должны лежать девять чисел, а не что угодно, что пришло с чужой
        // машины.
        if (array_key_exists('anchor', $in)) {
            $a = $in['anchor'];
            $pos = is_array($a) ? self::vec($a['pos'] ?? null) : null;
            $fwd = is_array($a) ? self::vec($a['fwd'] ?? null) : null;
            $up = is_array($a) ? self::vec($a['up'] ?? null) : null;
            if ($pos !== null && $fwd !== null && $up !== null && isset($a['id'])) {
                $set['anchor_body'] = self::bodyIn($a['id'], $sysId);
                $set['anchor_pose'] = json_encode(['pos' => $pos, 'fwd' => $fwd, 'up' => $up]);
            } else {
                $set['anchor_body'] = null;
                $set['anchor_pose'] = null;
            }
        }
        if (array_key_exists('gear', $in)) {
            $set['gear_out'] = !empty($in['gear']) ? 1 : 0;
        }
        if (array_key_exists('hatches', $in)) {
            $set['hatches'] = self::hatchList($in['hatches']);
        }
        return $set;
    }

    /** Открытые люки — из закрытого вида имён: в базу не идёт что попало. */
    public static function hatchList($v): ?string
    {
        if (!is_array($v)) {
            return null;
        }
        $list = [];
        foreach ($v as $h) {
            if (is_string($h) && preg_match('/^[A-Za-z0-9_]{1,12}$/', $h) && !in_array($h, $list, true)) {
                $list[] = $h;
            }
            if (count($list) >= 8) {
                break;
            }
        }
        return $list ? json_encode($list) : null;
    }

    /** Взгляд: угол, ограниченный разумным, — из чужих рук приходит любое число. */
    private static function angle($v, float $lim = M_PI): float
    {
        return max(-$lim, min($lim, self::num($v)));
    }

    /**
     * Место пилота из сохранения: поля строки и отказ, если он был.
     *
     * @return array{0:array, 1:?string} [поля для player, причина отказа]
     */
    private static function meFields(array $p, array $me, int $activeId): array
    {
        $set = [];
        $aboard = isset($me['aboard']) && is_numeric($me['aboard']) ? (int) $me['aboard'] : null;
        $wasAboard = $p['aboard_ship'] === null ? null : (int) $p['aboard_ship'];

        if ($aboard !== null) {
            $target = self::shipRow($aboard);
            if ($target === null) {
                return [[], 'no_ship'];
            }
            if ($aboard !== $wasAboard && !self::canBoard($p, $target)) {
                return [[], 'too_far'];
            }
            // На чужом борту — только пока его хозяин в игре. Проверка не
            // только при посадке: опоздавшее сохранение пассажира, которого
            // хаб уже вернул к себе, не должно усадить его обратно.
            if (self::ownerAway($target, (int) $p['id'])) {
                return [[], 'owner_away'];
            }
            $set['aboard_ship'] = $aboard;
            $set['out_body'] = null;
            $set['out_pose'] = null;
            // Пассажир там же, где корабль: он с ним и летит.
            if ($target['system_id'] !== null) {
                $set['system_id'] = (int) $target['system_id'];
            }
            // В кресло пилота — только в корабле, которым командуешь.
            // Чужой корабль везёт, но не слушается; свой, но другой —
            // сначала принять командование (Players::command).
            $seated = !empty($me['seated']) && $aboard === $activeId
                && (int) $target['owner_id'] === (int) $p['id'];
            $set['seated'] = $seated ? 1 : 0;
            $set['walk_pose'] = null;
            $w = $me['walk'] ?? null;
            if (!$seated && is_array($w) && is_array($w['pos'] ?? null)) {
                $dm = self::deckM($target);
                $pos = array_map(static fn($x) => max(-$dm, min($dm, self::num($x))),
                    array_slice(array_values($w['pos']), 0, 3));
                if (count($pos) === 3) {
                    $set['walk_pose'] = json_encode([
                        'pos' => $pos,
                        'yaw' => self::angle($w['yaw'] ?? 0),
                        'pitch' => self::angle($w['pitch'] ?? 0, 1.6),
                    ]);
                }
            }
            return [$set, null];
        }

        // За бортом: на грунте тела.
        $out = $me['out'] ?? null;
        if (!is_array($out) || !isset($out['body'])) {
            return [[], 'bad_place'];
        }
        $sys = isset($me['system']) ? self::systemIn($me['system'])
            : ($p['system_id'] === null ? null : (int) $p['system_id']);
        $body = self::bodyIn($out['body'], $sys);
        $o = self::vec($out['o'] ?? null);
        $f = self::unit($out['f'] ?? null);
        if ($o === null || $f === null) {
            return [[], 'bad_place'];
        }
        $here = ['body' => $body, 'p' => [$o['x'], $o['y'], $o['z']]];
        // Сойти можно только с корабля, который стоит рядом с этой
        // точкой, и только на то тело, на котором уже стоишь.
        if ($wasAboard !== null) {
            $from = self::shipRow($wasAboard);
            if ($from === null || !self::near(self::shipPoint($from), $here)) {
                return [[], 'too_far'];
            }
        } elseif ($p['out_body'] !== null && (int) $p['out_body'] !== $body) {
            return [[], 'too_far'];
        }
        $set['aboard_ship'] = null;
        $set['seated'] = 0;
        $set['walk_pose'] = null;
        $set['out_body'] = $body;
        $set['out_pose'] = json_encode(['o' => $o, 'f' => $f,
            'pitch' => self::angle($out['pitch'] ?? 0, 1.6)]);
        if ($sys !== null) {
            $set['system_id'] = $sys;
        }
        return [$set, null];
    }

    /**
     * Принять командование своим кораблём: сесть в его кресло.
     *
     * Кораблей у пилота может быть несколько, а ведёт игра один — тот,
     * которым он командует. Пересесть можно только в СВОЙ корабль и
     * только стоя на его борту: командование не передаётся по радио.
     * Прежний корабль остаётся там, где стоял, — со всеми люками и
     * грузом.
     *
     * Исключение — ОДИН ДОК: оба корабля стоят в одном порту, и пилот
     * переходит из одного в другой по станции. Так пересаживаются на
     * купленный на верфи корпус (server/src/Shipyard.php): шагов по
     * станции в игре нет, а до кресла нового корабля — один переход.
     */
    public static function command(int $playerId, int $shipId): array
    {
        return Db::tx(function () use ($playerId, $shipId) {
            $p = Db::row('SELECT * FROM `player` WHERE `id`=? FOR UPDATE', [$playerId]);
            if ($p === null) {
                throw ApiError::notFound('нет такого игрока');
            }
            $row = self::shipRow($shipId);
            if ($row === null || (int) $row['owner_id'] !== $playerId) {
                throw ApiError::denied('not_owner', 'это не ваш корабль');
            }
            if ((int) $p['aboard_ship'] !== $shipId && !self::sameDock($p, $row)) {
                throw ApiError::denied('not_aboard', 'командуют из кресла: сначала на борт');
            }
            Db::update('player', ['ship_id' => $shipId, 'aboard_ship' => $shipId, 'seated' => 1, 'walk_pose' => null],
                '`id`=?', [$playerId]);
            return self::state($playerId);
        });
    }
}
