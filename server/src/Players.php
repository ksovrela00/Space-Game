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

    /**
     * Как близко к носителю вездеход встаёт в его трюм и съезжает из него,
     * км. Платформа трюма «Челленджера» — в девяти метрах от середины
     * корабля (js/models/interior.js, BAYS), машина на ней — ещё в трёх;
     * двадцать пять метров — с запасом на стоянку на склоне. Дальше —
     * значит, не с платформы: в трюм за километр не заезжают.
     */
    public const STOW_KM = 0.025;

    /** Поля места корабля: у вездехода в трюме они те же, что у носителя. */
    private const PLACE = ['system_id', 'pos_x', 'pos_y', 'pos_z', 'basis', 'docked_body', 'landed_body',
        'landed_pose', 'landed_secured', 'anchor_body', 'anchor_pose', 'pad', 'berth_station', 'dock_pose'];

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
            // На площадку в зале порта: корабль стоит на полу, а не «в доке вообще».
            Stations::park($shipId, $start['system_id'], $start['local_id']);

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
        if ($ship['docked_body'] === null || $ship['system_id'] === null) {
            return null;
        }
        // В порту — на борту своего корабля в доке или пешком на полу той же
        // станции (схема 13, js/game/stationwalk.js): к пульту ангарной
        // службы и в лавки ходят ногами.
        $aboard = (int) $p['aboard_ship'] === (int) $ship['id'];
        $onFloor = $p['aboard_ship'] === null && $p['out_body'] !== null
            && (int) $p['out_body'] === (int) $ship['docked_body']
            && $p['system_id'] !== null && (int) $p['system_id'] === (int) $ship['system_id'];
        if (!$aboard && !$onFloor) {
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
        // Наземному кораблю (вездеходу) модулей корабля не положено: ни
        // двигателя, ни привода, ни щита у него нет — он ездит на колёсах.
        $code = Db::one('SELECT t.`code` FROM `ship` sh JOIN `ship_type` t ON t.`id`=sh.`type_id` WHERE sh.`id`=?',
            [$shipId]);
        if ($code !== null && Specs::isGround((string) $code)) {
            return;
        }
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

    /** Вездеход, приписанный к трюму корабля, — его номер или null. */
    public static function roverOf(int $shipId): ?int
    {
        $id = Db::one('SELECT `id` FROM `ship` WHERE `carrier_id`=? ORDER BY `id` LIMIT 1', [$shipId]);
        return $id === null ? null : (int) $id;
    }

    /**
     * Поставить в трюм корабля вездеход его ангара (Specs::hangarOf) — так
     * кончается покупка вездехода на верфи (Shipyard::buy). Приписан он к
     * этому кораблю навсегда: после гибели возвращается в его трюм (restow).
     * Уже есть приписанный — второго не ставит.
     *
     * @return int|null номер вездехода, или null — у типа нет ангара
     */
    public static function ensureHangar(int $shipId): ?int
    {
        $ship = Db::row('SELECT sh.*, t.`code` AS `type_code` FROM `ship` sh
             JOIN `ship_type` t ON t.`id`=sh.`type_id` WHERE sh.`id`=?', [$shipId]);
        if ($ship === null) {
            return null;
        }
        $code = Specs::hangarOf((string) $ship['type_code']);
        if ($code === null) {
            return null;
        }
        $have = Db::one('SELECT `id` FROM `ship` WHERE `carrier_id`=? ORDER BY `id` LIMIT 1', [$shipId]);
        if ($have !== null) {
            return (int) $have;
        }
        $type = Db::row('SELECT * FROM `ship_type` WHERE `code`=?', [$code]);
        if ($type === null) {
            return null;                        // каталог залит без вездехода
        }
        return Db::insert('ship', [
            'type_id' => $type['id'],
            'owner_id' => (int) $ship['owner_id'],
            'name' => '',
            'hull' => $type['hull_max'],
            'shield' => 0,
            'fuel_t' => $type['fuel_t'],
            'carrier_id' => $shipId,
            'stowed' => 1,
            'created_at' => Db::now(),
        ] + self::placeFields($ship));
    }

    /**
     * Один ли это борт: вездеход стоит в трюме другого корабля (в любую
     * сторону). Из трюма к двери вездехода подходят пешком, и с его порога
     * сходят в трюм — пилот «рядом» с обоими (Hub, просьбы о люках).
     */
    public static function sameHold(int $a, int $b): bool
    {
        return (int) Db::one('SELECT COUNT(*) FROM `ship` WHERE `stowed`=1 AND
            ((`id`=? AND `carrier_id`=?) OR (`id`=? AND `carrier_id`=?))', [$a, $b, $b, $a]) > 0;
    }

    /** Поля места из строки корабля — чтобы поставить туда же другой. */
    public static function placeFields(array $row): array
    {
        return array_intersect_key($row, array_flip(self::PLACE));
    }

    /**
     * Вездеходы в трюме носителя — туда же, где он: стоящий в трюме едет
     * вместе с кораблём, и место у них одно. Зовут это все, кто двигает
     * корабль: сохранение, порт, страховка, буксир.
     */
    public static function carryAlong(int $carrierId): void
    {
        $row = self::shipRow($carrierId);
        if ($row === null) {
            return;
        }
        Db::update('ship', self::placeFields($row), '`carrier_id`=? AND `stowed`=1', [$carrierId]);
    }

    /**
     * Вернуть вездеход в трюм носителя — целым: так кончается его гибель и
     * гибель носителя (Combat::respawnShip).
     */
    public static function restow(int $roverId): void
    {
        $row = Db::row('SELECT sh.`carrier_id`, t.`hull_max` FROM `ship` sh
             JOIN `ship_type` t ON t.`id`=sh.`type_id` WHERE sh.`id`=?', [$roverId]);
        if ($row === null || $row['carrier_id'] === null) {
            return;
        }
        $carrier = self::shipRow((int) $row['carrier_id']);
        if ($carrier === null) {
            return;
        }
        Db::update('ship', ['stowed' => 1, 'hull' => $row['hull_max'], 'shield' => 0, 'hit_at' => null,
            'hatches' => null] + self::placeFields($carrier), '`id`=?', [$roverId]);
    }

    /**
     * Сохранение вездехода, приписанного к трюму (save). Своё место у него
     * есть, только пока он не в трюме; в трюм он встаёт и из него съезжает
     * у самого носителя (STOW_KM), а носитель для этого стоит на грунте.
     * От игры — одно слово «в трюме или нет»; верит ему сервер, только если
     * так и есть по местам обоих.
     *
     * @param array $ship  строка вездехода (до сохранения)
     * @param array $in    что прислала игра за корабль
     * @param array $set   поля, собранные из него (shipFields)
     * @return array поля, которые писать
     */
    private static function stowSave(array $ship, array $in, array $set): array
    {
        $carrier = self::shipRow((int) $ship['carrier_id']);
        $stowed = (bool) $ship['stowed'];
        $want = array_key_exists('stowed', $in) ? (bool) $in['stowed'] : $stowed;
        if ($carrier === null) {
            return $set + ($stowed ? ['stowed' => 0] : []);
        }
        $place = array_intersect_key($set, array_flip(self::PLACE));
        $at = self::shipPoint(array_merge($ship, $place));
        $home = self::shipPoint($carrier);
        $close = $carrier['landed_body'] !== null && self::near($at, $home, self::STOW_KM);
        $noPlace = static function (array $s): array {
            foreach (self::PLACE as $k) {
                unset($s[$k]);
            }
            return $s;
        };
        if ($stowed && $want) {
            // Стоит в трюме: место — носителя, своё из сохранения не пишется.
            return $noPlace($set);
        }
        if (!$stowed && $want) {
            // Въехал: в трюм — только у самого носителя, стоящего на грунте.
            return $close ? $noPlace($set) + self::placeFields($carrier) + ['stowed' => 1] : $set;
        }
        if ($stowed) {
            // Съезжает: место из сохранения — только рядом с носителем;
            // дальше — это не съезд с платформы, и места такого не пишем.
            return $close ? $set + ['stowed' => 0] : $noPlace($set);
        }
        return $set;
    }

    /** Гнёзда, которые пилот опустошил сам (ship.bare). */    /** Гнёзда, которые пилот опустошил сам (ship.bare). */
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
            // Где на полу зала станции (схема 13): площадка, поза в осях
            // станции и стоит ли он в хранилище порта (вызывают — ангарной
            // службой, Shipyard::retrieve).
            'berth' => $ship['docked_body'] === null ? null : [
                'pad' => $int($ship['pad'] ?? null),
                'pose' => self::json($ship['dock_pose'] ?? null),
                'stored' => Stations::inStorage($ship),
            ],
        ];
    }

    /**
     * Точка корабля в ОСЯХ ТЕЛА, км, и само тело — для проверки «рядом ли».
     *
     * Есть у стоящего на грунте, у висящего над телом и у стоящего на
     * площадке в зале станции (схема 13): там опора — сама станция, и
     * пешком ходят по полу её зала (js/game/stationwalk.js). В пустоте и в
     * хранилище порта точки нет — сойти с корабля там некуда.
     *
     * @return array{body:int, p:array{0:float,1:float,2:float}}|null
     */
    public static function shipPoint(array $ship): ?array
    {
        if ($ship['docked_body'] !== null) {
            $pose = (int) ($ship['stored'] ?? 0) === 1 ? null : self::json($ship['dock_pose'] ?? null);
            $p = is_array($pose) ? ($pose['pos'] ?? null) : null;
            if (!is_array($p)) {
                return null;
            }
            return ['body' => (int) $ship['docked_body'],
                'p' => [(float) ($p['x'] ?? 0), (float) ($p['y'] ?? 0), (float) ($p['z'] ?? 0)]];
        }
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

    /**
     * Все корабли пилота: каким командует, где стоят остальные.
     *
     * Место — с точкой, а не одним «где-то у тела»: по ней карта
     * (js/game/fleet.js) ставит значок корабля туда, где его оставили. На
     * грунте и у тела — точка в осях тела (point: b, x, y, z — как у
     * shipPoint): тело вращается, и мировая точка устарела бы за минуту.
     * В пустоте — мировая (pos). В порту точки нет — корабль в станции.
     * Названия тела и системы — для корабля в другой системе: её состава
     * игра не знает, пока туда не прилетит.
     */
    public static function fleet(int $playerId, int $activeId): array
    {
        $out = [];
        foreach (Db::all(
            'SELECT sh.*, t.`code` AS `type_code`, t.`name` AS `type_name`,
                    ss.`name` AS `system_name`, b.`name` AS `body_name`
             FROM `ship` sh JOIN `ship_type` t ON t.`id`=sh.`type_id`
             LEFT JOIN `star_system` ss ON ss.`id` = sh.`system_id`
             LEFT JOIN `body` b ON b.`system_id` = sh.`system_id`
                 AND b.`local_id` = COALESCE(sh.`docked_body`, sh.`landed_body`, sh.`anchor_body`)
             WHERE sh.`owner_id`=? ORDER BY sh.`id`',
            [$playerId]
        ) as $r) {
            $point = $r['docked_body'] === null ? self::shipPoint($r) : null;
            $out[] = [
                'id' => (int) $r['id'],
                'name' => (string) $r['name'],
                'type' => $r['type_code'],
                'typeName' => $r['type_name'],
                'active' => (int) $r['id'] === $activeId,
                // Вездеход: к чьему трюму приписан и стоит ли в нём.
                'carrier' => $r['carrier_id'] === null ? null : (int) $r['carrier_id'],
                'stowed' => (bool) $r['stowed'],
                'systemId' => $r['system_id'] === null ? null : (int) $r['system_id'],
                'where' => $r['docked_body'] !== null ? 'docked'
                    : ($r['landed_body'] !== null ? 'landed' : 'flight'),
                'body' => $r['docked_body'] !== null ? (int) $r['docked_body']
                    : ($r['landed_body'] !== null ? (int) $r['landed_body']
                        : ($r['anchor_body'] !== null ? (int) $r['anchor_body'] : null)),
                'systemName' => $r['system_name'] === null ? null : (string) $r['system_name'],
                'bodyName' => $r['body_name'] === null ? null : (string) $r['body_name'],
                'point' => $point === null ? null
                    : ['b' => $point['body'], 'x' => $point['p'][0], 'y' => $point['p'][1], 'z' => $point['p'][2]],
                'pos' => $r['docked_body'] === null && $point === null
                    ? ['x' => (float) $r['pos_x'], 'y' => (float) $r['pos_y'], 'z' => (float) $r['pos_z']] : null,
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
        // Площадку, на которой он стоял, мог занять другой, пока его не было.
        Stations::settle($ship);
        $ship = self::ship($playerId);
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
                // Вездеход: носитель и стоит ли в его трюме (тогда место
                // выше — место носителя, и игра ставит машину в трюм).
                'carrier' => $ship['carrier_id'] === null ? null : (int) $ship['carrier_id'],
                'stowed' => (bool) $ship['stowed'],
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
                // Вездеход, приписанный к трюму: в трюме место — носителя.
                if ($ship['carrier_id'] !== null) {
                    $shipSet = self::stowSave($ship, $shipIn, $shipSet);
                }
                // Наземный корабль вне трюма на стоянку не садится: его место —
                // точка в осях тела (anchor). Стоянка от игры у него — только
                // отставшая стоянка носителя, с которой он съехал, и при входе
                // вездеход вставал в середину корабля над грунтом и падал.
                if (Specs::isGround((string) $ship['type_code']) && !(int) ($shipSet['stowed'] ?? $ship['stowed'])) {
                    $shipSet['landed_body'] = null;
                    $shipSet['landed_pose'] = null;
                    $shipSet['landed_secured'] = 0;
                }
                if ($shipSet) {
                    Db::update('ship', $shipSet, '`id`=?', [$shipId]);
                }
                // Корабль сдвинулся — вездеход в его трюме с ним.
                if (array_intersect_key($shipSet, array_flip(self::PLACE))) {
                    self::carryAlong($shipId);
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
        // МЕСТО пилота сохранение не меняет: на чьём он борту, в кресле
        // ли, на грунте ли — это переходы, и делает их сервер в момент
        // перехода (Players::move, pilot.move). Сохранение идёт фоном и
        // опаздывает: собранное до пересадки, оно приходило после неё и
        // возвращало пилота на борт прежнего корабля — новый улетал уже
        // без него, а порт отказывал «не на борту». Здесь — только поза
        // там, где пилот уже есть по счёту сервера; не совпало — мимо.
        $set = [];
        $p = self::byId($playerId);
        $stale = !$legacy && is_array($in['me'] ?? null) && !self::poseSave($p, $in['me']);

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
        if ($stale) {
            // Место в сохранении не то, что у сервера: оно опоздало к
            // переходу. Не ошибка — следующее придёт уже с новым местом.
            $out['meStale'] = true;
        }
        return $out;
    }

    /**
     * Поза пилота из сохранения — там, где он уже есть: шаги по палубе,
     * шаги по грунту. Условие места стоит в самом UPDATE, а не только в
     * проверке перед ним: переход (move) мог закоммититься между ними.
     *
     * @return bool совпало ли место в сохранении с местом у сервера
     */
    private static function poseSave(array $p, array $me): bool
    {
        $id = (int) $p['id'];
        $aboard = isset($me['aboard']) && is_numeric($me['aboard']) ? (int) $me['aboard'] : null;
        if ($aboard !== null) {
            if ($p['aboard_ship'] === null || (int) $p['aboard_ship'] !== $aboard) {
                return false;
            }
            // Встал или сел — это переход, а не поза.
            if (!empty($me['seated']) !== !empty($p['seated'])) {
                return false;
            }
            $pose = empty($me['seated']) ? self::walkPose($me['walk'] ?? null, self::shipRow($aboard)) : null;
            if ($pose !== null) {
                Db::run('UPDATE `player` SET `walk_pose`=? WHERE `id`=? AND `aboard_ship`=? AND `seated`=0',
                    [$pose, $id, $aboard]);
            }
            return true;
        }
        $out = $me['out'] ?? null;
        if (!is_array($out) || !isset($out['body']) || $p['aboard_ship'] !== null || $p['out_body'] === null) {
            return false;
        }
        // Номер тела сравнивается как есть: bodyIn бросил бы на чужой
        // системе и уронил бы всё сохранение из-за опоздавшей позы.
        $body = (int) $out['body'];
        if ((int) $p['out_body'] !== $body) {
            return false;
        }
        $o = self::vec($out['o'] ?? null);
        $f = self::unit($out['f'] ?? null);
        if ($o !== null && $f !== null) {
            Db::run('UPDATE `player` SET `out_pose`=? WHERE `id`=? AND `out_body`=? AND `aboard_ship` IS NULL',
                [json_encode(['o' => $o, 'f' => $f, 'pitch' => self::angle($out['pitch'] ?? 0, 1.6)]), $id, $body]);
        }
        return true;
    }

    /** Точка на палубе и взгляд — строкой для walk_pose; мусор — null. */
    private static function walkPose($w, ?array $ship): ?string
    {
        if ($ship === null || !is_array($w) || !is_array($w['pos'] ?? null)) {
            return null;
        }
        $dm = self::deckM($ship);
        $pos = array_map(static fn($x) => max(-$dm, min($dm, self::num($x))),
            array_slice(array_values($w['pos']), 0, 3));
        if (count($pos) !== 3) {
            return null;
        }
        return json_encode([
            'pos' => $pos,
            'yaw' => self::angle($w['yaw'] ?? 0),
            'pitch' => self::angle($w['pitch'] ?? 0, 1.6),
        ]);
    }

    /**
     * Переход пилота: встал с кресла, сел в него, сошёл на грунт, поднялся
     * на борт — свой или соседский.
     *
     * Действие, а не поле сохранения, и делается сразу, под замком строки
     * пилота: переходы идут по порядку, и проверка «рядом ли корабль» —
     * от того места, где пилот на самом деле, а не от того, что успело
     * дойти фоном. Отказ — не ошибка: в ответе место по счёту сервера, и
     * игра ставит пилота туда.
     *
     * @return array{moved:bool, me:array, denied?:string, why?:string}
     */
    public static function move(int $playerId, array $me): array
    {
        return Db::tx(function () use ($playerId, $me) {
            $p = Db::row('SELECT * FROM `player` WHERE `id`=? FOR UPDATE', [$playerId]);
            if ($p === null) {
                throw ApiError::notFound('нет такого игрока');
            }
            $ship = self::ship($playerId);
            [$set, $denied] = self::meFields($p, $me, (int) $ship['id']);
            if ($denied === null && $set) {
                $set['last_seen_at'] = Db::now();
                Db::update('player', $set, '`id`=?', [$playerId]);
            }
            $out = ['moved' => $denied === null, 'me' => self::meOf(self::byId($playerId))];
            if ($denied !== null) {
                $out['denied'] = $denied;
                $out['why'] = self::MOVE_WHY[$denied] ?? $denied;
            }
            return $out;
        });
    }

    /** Почему переход не принят — словами для игрока. */
    private const MOVE_WHY = [
        'too_far' => 'корабль далеко',
        'owner_away' => 'хозяина корабля нет в игре',
        'no_ship' => 'такого корабля нет',
        'bad_place' => 'непонятно, куда',
    ];

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
     * заправку — Fuel::refuel. Поле `fuel` в сохранении, если и придёт,
     * здесь не читается.
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
        // Порт сохранением не ставится и не снимается: встать в него —
        // действие с ценой (Stations::dock), выйти — тоже действие
        // (Stations::undock). Сохранение опаздывает, и опоздавшее с портом
        // ставило бы корабль обратно в док — с рынком, верфью и даром.
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
            $set['walk_pose'] = $seated ? null : self::walkPose($me['walk'] ?? null, $target);
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
            // Корабль в хранилище порта (схема 13): пересесть в него — значит
            // сначала вызвать его на площадку (Shipyard::retrieve). Он и
            // командование передаёт, и пилота сажает в кресло.
            if (Stations::inStorage($row)) {
                return Shipyard::retrieve($playerId, $shipId);
            }
            if ((int) $p['aboard_ship'] !== $shipId && !self::sameDock($p, $row)) {
                throw ApiError::denied('not_aboard', 'командуют из кресла: сначала на борт');
            }
            // Вездеход ездит по грунту: из трюма корабля в порту или в полёте
            // ему некуда съехать, и вести его там нечего.
            if ((int) $row['stowed'] === 1 && $row['landed_body'] === null) {
                throw ApiError::denied('not_landed', 'вездеход водят по грунту: сначала посадите корабль');
            }
            Db::update('player', ['ship_id' => $shipId, 'aboard_ship' => $shipId, 'seated' => 1, 'walk_pose' => null],
                '`id`=?', [$playerId]);
            return self::state($playerId);
        });
    }
}
