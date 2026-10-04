<?php
/**
 * Движение в космосе: NPC вокруг пилотов.
 *
 * Хаб (Hub) раз в тик отдаёт сюда, где сейчас пилоты, и получает назад,
 * кто из NPC куда делся. Сами NPC живут только здесь, в памяти хаба: в
 * базе их нет, и после перезапуска сервера космос заселяется заново. Это
 * честно — NPC это обстановка вокруг игроков, а не чьё-то имущество.
 *
 * ГДЕ ПОЯВЛЯЮТСЯ. Рядом с игроками, но не у них на глазах: NPC выходит из
 * квантового прыжка у своего участка (ниже), не ближе ARRIVE_MIN ни к
 * кому — в упор из пустоты не возникают, — и сразу со вспышкой выхода, как
 * у любого прыжка. Видят NPC только те, кто ближе SEE_KM, — это дальность
 * локатора. Вдали от всех NPC не нужен никому и тихо пропадает.
 *
 * СКОЛЬКО. Не «по пять на игрока»: двое, летящие вместе, — это одна
 * компания, и NPC вокруг них общие. Пилоты ближе GROUP_KM друг к другу
 * складываются в компанию, и на компанию из n человек приходится
 *
 *     T(n) = round(BASE · n^EXP + ADD),  BASE = 3, EXP = 0.4, ADD = 2,
 *
 * то есть 5 на одного, 6 на двоих, 7 на троих, 9 на восьмерых и не
 * больше GROUP_CAP. Растёт медленнее числа людей: толпа игроков не
 * превращает космос в пробку, а одинокий пилот не летает в пустоте. В
 * пустоте между планетами — меньше (DEEP_K): там и правда пусто. Те, кто
 * летит порознь, — разные компании, у каждой свои NPC.
 *
 * ГДЕ ИМЕННО. У каждого NPC свой участок: центр в HOME_MIN..HOME_MAX км
 * от пилота и не ближе APART к участку другого NPC. Так они расходятся по
 * округе, а не толпятся у пилота кучкой, — и каждый, кого видно, свой:
 * один садится у горы на севере, другой кружит на юге.
 *
 * ИЗ ЧЕГО. Корпус — из всех типов в базе (ship_type), с весом npcWeight
 * из server/data/specs.php, а без него — по цене: дешёвых кораблей в
 * космосе больше. Новый тип корабля попадает в поток сам, без строчки
 * здесь. Модули — из всех, что есть в базе для каждого гнезда: чаще
 * заводской, иногда дороже, иногда гнездо пустое (без щита летают и
 * так). Имя — случайное (Npc::nameOf).
 *
 * ЧТО ДЕЛАЮТ. Вдали от тел — неспешно облетают свой участок, подолгу
 * зависая у точек, и через несколько минут уходят. У поверхности тела с
 * твёрдым грунтом — чаще садятся: выходят из прыжка над площадкой,
 * снижаются на стойки, стоят минуты, взлетают и уходят. Живёт NPC так,
 * чтобы к нему успели подлететь: 6–10 минут, а не полторы. Площадку выбирает
 * оракул рельефа (Oracle) тем же кодом, каким садится игрок; без
 * оракула NPC не садятся, а только летают.
 */

final class Traffic
{
    /** Дальность локатора: NPC ближе этого есть в снимке, км. */
    public const SEE_KM = 80.0;
    /**
     * Видимый NPC пропадает только дальше этого, км. Без зазора NPC на
     * самой границе мигал бы в метке туда-сюда с каждым тиком.
     */
    public const HIDE_KM = 100.0;
    /** Дальше этого от всех — NPC не видит никто: убираем, км. */
    public const DROP_KM = 130.0;
    public const DROP_AFTER = 10.0;

    /** Пилоты ближе этого — одна компания, км. */
    public const GROUP_KM = 160.0;
    /** Сколько NPC на компанию: BASE · n^EXP + ADD, не больше GROUP_CAP. */
    public const BASE = 3.0;
    public const EXP = 0.4;
    public const ADD = 2.0;
    public const GROUP_CAP = 10;
    /** Вдали от тел (вне чьего-либо захвата) — меньше: там пусто. */
    public const DEEP_K = 0.6;
    public const SYS_CAP = 20;
    public const ALL_CAP = 60;

    /** Выход из прыжка — не ближе этого ни к кому из пилотов, км. */
    public const ARRIVE_MIN = 12.0;
    /** И в стольких км от центра своего участка, км. */
    public const ARRIVE_NEAR = 6.0;
    public const ARRIVE_FAR = 15.0;

    /**
     * Участок NPC: центр — в HOME_MIN..HOME_MAX км от пилота, не ближе
     * APART к центру чужого участка; облетает он точки в REGION_KM от
     * центра. Дальний край участка — 52 км от пилота, в пределах локатора.
     */
    public const HOME_MIN = 8.0;
    public const HOME_MAX = 40.0;
    public const APART = 12.0;
    public const REGION_KM = 12.0;

    /**
     * Облёт: сколько он длится, с (на это время набираются точки, но не
     * больше LEGS_CAP), доля хода между точками, как часто и как долго
     * висит у точки. Неспешно — чтобы его можно было догнать и
     * разглядеть: на ходу торговец уходит от торговца.
     */
    public const LIFE_MIN = 300.0;
    public const LIFE_MAX = 600.0;
    public const LEGS_CAP = 24;
    public const CRUISE_MIN = 0.3;
    public const CRUISE_MAX = 0.55;
    public const HOVER = 0.75;
    public const HOVER_MIN = 20.0;
    public const HOVER_MAX = 60.0;

    /**
     * Визиты: доля NPC, которые по дороге подлетают к пилоту на километр
     * (Npc::inspect), и сколько висят рядом, с. Без них NPC — фон, а
     * подлетевший поглядеть — уже кто-то.
     */
    public const INSPECT = 0.35;
    public const VISIT_MIN = 20.0;
    public const VISIT_MAX = 30.0;
    /** Сколько держится в снимке «только что из прыжка» (вспышка у клиента), с. */
    public const FLASH = 1.2;

    /** Между двумя прибытиями в компанию, с: NPC подтягиваются, а не сыплются. */
    public const GAP_MIN = 4.0;
    public const GAP_MAX = 10.0;
    /** Первое прибытие после появления пилота, с. */
    public const FIRST_MIN = 2.0;
    public const FIRST_MAX = 6.0;

    /** Пилот в прыжке (быстрее этого, км/с) NPC к себе не зовёт: пролетит мимо. */
    public const QUANTUM_V = 50.0;

    /**
     * Пилот ниже этого над рельефом — NPC у него в осях тела, км. Выше
     * корабль игрока уже не вращается с грунтом (js/game/gravity.js,
     * SPIN_NONE — 80 км), и NPC в осях тела дрейфовал бы относительно
     * него на сотни метров в секунду.
     */
    public const FRAME_ALT = 60.0;
    /**
     * Запас на рельеф, доля радиуса: выше этого грунт не поднимается ни
     * на одном теле (самые высокие горы — 1.2 % радиуса, lava и rock).
     * Им считается высота, когда оракула нет.
     */
    public const RELIEF_K = 0.02;
    /**
     * Круг вокруг центра участка, где меряется рельеф, км: участок (12),
     * выход из прыжка (до 15 за ним) и виток поиска площадки, когда у
     * центра вода (до 26).
     */
    public const AREA_KM = 45.0;
    /** Над верхом грунта округи — не ниже этого, км. */
    public const CLEAR_KM = 2.5;

    /** Доля NPC у поверхности, которые садятся (остальные пролетают). */
    public const LANDERS = 0.6;
    /** Сколько стоят на грунте, с: минуты — успеть подлететь и обойти. */
    public const STAY_MIN = 240.0;
    public const STAY_MAX = 600.0;
    /** Площадка не ближе этого к пилоту и к другому NPC, км. */
    public const PAD_CLEAR = 1.5;
    /**
     * Сколько держать от станции, км, сверх её габарита: точки маршрута и
     * выхода из прыжка — не ближе, а пролетающий мимо обходит её. Сквозь
     * станцию, у которой игроки проводят полжизни, NPC пролетать не может.
     */
    public const STATION_CLEAR = 4.0;
    /** И от грунта тела в мировых осях, км, сверх его радиуса и гор. */
    public const BODY_CLEAR = 5.0;

    /** Без чего NPC не обходится: прыжок и посадка — вся его жизнь. */
    public const NEEDS = ['drive', 'gear'];
    /** Насколько часто стоит заводской модуль, а не другой из того же гнезда. */
    public const STOCK = 0.6;
    /** Насколько часто необязательное гнездо пусто (щит, форсаж, сканер). */
    public const BARE = 0.12;
    /** Насколько часто занято гнездо, пустое с завода (дополнительный бак). */
    public const EXTRA = 0.25;
    /** Доля вооружённых. Оружие они пока не применяют, но оно у них есть. */
    public const ARMED = 0.7;

    private Dice $dice;
    /** @var object|null оракул рельефа: site(), area(), types(), alive() */
    private $oracle;
    /** @var callable|null */
    private $log;

    /** @var array<int, Npc> */
    private array $npcs = [];
    private int $next = 1;
    private ?float $at = null;
    /** @var array<int, float> игрок => когда его компании можно звать следующего */
    private array $gate = [];
    /** @var array<int, array> система => тела */
    private array $bodies = [];
    private ?array $pool = null;
    /** Время мира этого шага (Clock::worldTime) — по нему стоят тела; null — не знаем. */
    private ?float $wt = null;
    /** @var array<int, array> система => тела на этот шаг (bodiesAt) */
    private array $placed = [];

    public function __construct($oracle = null, ?int $seed = null, ?callable $log = null)
    {
        $this->oracle = $oracle;
        $this->dice = new Dice($seed);
        $this->log = $log;
    }

    /** @return array<int, Npc> */
    public function all(): array
    {
        return $this->npcs;
    }

    public function get(int $id): ?Npc
    {
        return $this->npcs[$id] ?? null;
    }

    public function remove(int $id): void
    {
        unset($this->npcs[$id]);
    }

    /**
     * Сколько NPC приходится на компанию из n пилотов.
     *
     * @param bool $near компания у тела (в чьём-то захвате), а не в пустоте
     */
    public static function target(int $n, bool $near = true): int
    {
        if ($n <= 0) {
            return 0;
        }
        $t = (self::BASE * $n ** self::EXP + self::ADD) * ($near ? 1.0 : self::DEEP_K);
        return max(1, min(self::GROUP_CAP, (int) round($t)));
    }

    // --- тик ----------------------------------------------------------------

    /**
     * Шаг: NPC летят, лишние пропадают, недостающие прибывают.
     *
     * @param array $eyes игрок => где он: ['sys', 'w' => мировая точка или
     *   null, 'b' => тело или null, 'l' => точка в осях тела или null,
     *   'spawn' => зовёт ли он NPC (не в доке, не в прыжке)]
     * @param float|null $wt время мира (Clock::worldTime): по нему считается,
     *   где сейчас станции и планеты; без него NPC их не обходят
     * @return array события: ['how' => 'jump'|'drop'|'arrive', 'id', ...]
     */
    public function step(float $now, array $eyes, ?float $wt = null): array
    {
        $this->wt = $wt;
        $this->placed = [];
        $dt = $this->at === null ? 0.0 : max(0.0, min(1.0, $now - $this->at));
        $this->at = $now;
        $events = [];

        if ($dt > 0) {
            foreach ($this->npcs as $n) {
                $pilots = $this->pilotsFor($n, $eyes);
                $n->step($dt, $now, $this->avoidFor($n, $eyes), $pilots);
                $this->visitFloor($n, $pilots);
                if ($n->scan !== null) {
                    $events[] = ['how' => 'scan', 'id' => $n->id, 'sys' => $n->sys, 'name' => $n->name,
                        'pid' => $n->scan];
                    $n->scan = null;
                }
            }
        }

        // Вдали от всех — пропадает. Ждём DROP_AFTER: пилот мог только что
        // уйти в док и сейчас выйдет обратно.
        foreach ($this->npcs as $n) {
            if ($n->gone !== null) {
                continue;
            }
            if ($this->nearest($n, $eyes) > self::DROP_KM) {
                $n->lonely = $n->lonely ?? $now;
                if ($now - $n->lonely > self::DROP_AFTER) {
                    $n->gone = 'drop';
                }
            } else {
                $n->lonely = null;
            }
        }
        foreach ($this->npcs as $id => $n) {
            if ($n->gone !== null && $n->gone !== 'dead') {
                $events[] = ['how' => $n->gone, 'id' => $id, 'sys' => $n->sys, 'name' => $n->name];
                unset($this->npcs[$id]);
            }
        }

        // Компании и прибытия.
        foreach (array_keys($this->gate) as $pid) {
            if (!isset($eyes[$pid])) {
                unset($this->gate[$pid]);
            }
        }
        foreach ($this->groups($eyes) as $group) {
            $wait = 0.0;
            foreach ($group as $pid => $e) {
                if (!isset($this->gate[$pid])) {
                    $this->gate[$pid] = $now + $this->dice->range(self::FIRST_MIN, self::FIRST_MAX);
                }
                $wait = max($wait, $this->gate[$pid]);
            }
            if ($now < $wait) {
                continue;
            }
            $near = false;
            foreach ($group as $e) {
                $near = $near || $e['b'] !== null;
            }
            if ($this->around($group) >= self::target(count($group), $near)
                || $this->count($group[array_key_first($group)]['sys']) >= self::SYS_CAP
                || count($this->npcs) >= self::ALL_CAP) {
                continue;
            }
            $n = $this->spawnFor($group, $eyes, $now);
            foreach (array_keys($group) as $pid) {
                $this->gate[$pid] = $now + ($n !== null ? $this->dice->range(self::GAP_MIN, self::GAP_MAX) : 3.0);
            }
            if ($n !== null) {
                $events[] = ['how' => 'arrive', 'id' => $n->id, 'sys' => $n->sys, 'name' => $n->name];
            }
        }
        return $events;
    }

    /** Сколько NPC в системе. */
    public function count(int $sys): int
    {
        $c = 0;
        foreach ($this->npcs as $n) {
            if ($n->sys === $sys) {
                $c++;
            }
        }
        return $c;
    }

    /**
     * NPC, которых видит пилот, — строками снимка.
     *
     * @param array $vis кого он уже видит (id => true): у кого запись есть,
     *   тот пропадает лишь за HIDE_KM, а кто показывается впервые — приходит
     *   со снаряжением
     */
    public function rowsFor(?array $eye, array &$vis, float $now): array
    {
        $rows = [];
        foreach ($this->npcs as $id => $n) {
            $pos = $eye !== null && $n->sys === $eye['sys'] && $n->gone === null
                ? self::posIn($eye, $n->frame) : null;
            if ($pos === null) {
                unset($vis[$id]);
                continue;
            }
            $was = isset($vis[$id]);
            $d = Vec::dist($pos, $n->p);
            if ($d >= ($was ? self::HIDE_KM : self::SEE_KM)) {
                unset($vis[$id]);
                continue;
            }
            $vis[$id] = true;
            $rows[] = $n->row($now, !$was);
        }
        foreach (array_keys($vis) as $id) {
            if (!isset($this->npcs[$id])) {
                unset($vis[$id]);
            }
        }
        return $rows;
    }

    /**
     * Попадание по NPC. Проверки — те же, что для кораблей игроков
     * (Hub::hit): та же система, в пределах дальности оружия с запасом.
     * Дальность меряется в осях NPC: стрелок у тела говорит, где он, и в
     * его осях (Hub, local).
     *
     * @return array|null итог (как у Combat::damage) и сам NPC — или null
     */
    public function hit(int $id, ?array $eye, array $gun, float $now): ?array
    {
        $n = $this->npcs[$id] ?? null;
        if ($n === null || $n->gone !== null || $eye === null || $eye['sys'] !== $n->sys) {
            return null;
        }
        $pos = self::posIn($eye, $n->frame);
        if ($pos === null || Vec::dist($pos, $n->p) > (float) $gun['range'] * Combat::RANGE_SLACK) {
            return null;
        }
        $res = $n->damage((float) $gun['damage'], $now);
        if (!$res['dead']) {
            $n->attacked($pos, $now, $this->dice);
        }
        $res['npc'] = $n;
        return $res;
    }

    // --- где кто ------------------------------------------------------------

    /** Точка пилота в осях frame (null — мировые) или null, если в них его нет. */
    public static function posIn(array $eye, ?int $frame): ?array
    {
        if ($frame === null) {
            return $eye['w'];
        }
        return $eye['b'] === $frame ? $eye['l'] : null;
    }

    /** Расстояние между двумя пилотами — в общих осях, или бесконечность. */
    private static function apart(array $a, array $b): float
    {
        if ($a['sys'] !== $b['sys']) {
            return INF;
        }
        if ($a['w'] !== null && $b['w'] !== null) {
            return Vec::dist($a['w'], $b['w']);
        }
        if ($a['b'] !== null && $a['b'] === $b['b'] && $a['l'] !== null && $b['l'] !== null) {
            return Vec::dist($a['l'], $b['l']);
        }
        return INF;
    }

    /** Где пилоты в осях NPC: к кому он может прилететь с визитом. */
    private function pilotsFor(Npc $n, array $eyes): array
    {
        $out = [];
        foreach ($eyes as $pid => $e) {
            $pos = $e['sys'] === $n->sys ? self::posIn($e, $n->frame) : null;
            if ($pos !== null) {
                $out[$pid] = $pos;
            }
        }
        return $out;
    }

    /**
     * Пол у пилота, к которому NPC прилетел с визитом: верх грунта в паре
     * километров вокруг него (оракул) с запасом. Меряется раз на визит —
     * как только понятно, к кому летит. Без оракула — над самим пилотом:
     * он стоит на грунте или над ним.
     */
    private function visitFloor(Npc $n, array $pilots): void
    {
        $t = $n->task;
        if ($t === null || $t['k'] !== 'inspect' || $n->frame === null || !isset($t['pid']) || isset($t['floor'])) {
            return;
        }
        $at = $pilots[$t['pid']] ?? null;
        if ($at === null) {
            return;
        }
        $top = null;
        if ($this->oracle !== null && $this->oracle->alive()) {
            $a = $this->oracle->area($n->sys, $n->frame, Vec::r6(Vec::unit($at)), Npc::STANDOFF + 1.0);
            $top = $a !== null ? (float) $a['top'] + 0.35 : null;
        }
        $n->task['floor'] = $top ?? Vec::len($at) + 0.8;
    }

    /** До ближайшего пилота в осях NPC, км. */
    private function nearest(Npc $n, array $eyes): float
    {
        $best = INF;
        foreach ($eyes as $e) {
            $pos = $e['sys'] === $n->sys ? self::posIn($e, $n->frame) : null;
            if ($pos !== null) {
                $best = min($best, Vec::dist($pos, $n->p));
            }
        }
        return $best;
    }

    /**
     * От кого держаться: пилоты и другие NPC в тех же осях — в паре
     * корпусов, станции — за их габаритом с запасом. Каждый — точкой с
     * радиусом: [[x, y, z], r].
     */
    private function avoidFor(Npc $n, array $eyes): array
    {
        $out = [];
        foreach ($eyes as $e) {
            $pos = $e['sys'] === $n->sys ? self::posIn($e, $n->frame) : null;
            if ($pos !== null && Vec::dist($pos, $n->p) < 2.0) {
                $out[] = [$pos, Npc::KEEP];
            }
        }
        foreach ($this->npcs as $o) {
            if ($o !== $n && $o->sys === $n->sys && $o->frame === $n->frame && Vec::dist($o->p, $n->p) < 2.0) {
                $out[] = [$o->p, Npc::KEEP];
            }
        }
        if ($n->frame === null) {
            foreach ($this->stationsAt($n->sys) as $s) {
                $keep = $s['r'] + self::STATION_CLEAR * 0.5;
                if (Vec::dist($s['p'], $n->p) < $keep + 3.0) {
                    $out[] = [$s['p'], $keep];
                }
            }
        }
        return $out;
    }

    /**
     * Компании: пилоты, зовущие NPC, сцепленные расстоянием ближе
     * GROUP_KM (цепочкой: A рядом с B, B рядом с C — все вместе).
     *
     * @return array[] компании: игрок => где он
     */
    private function groups(array $eyes): array
    {
        $free = [];
        foreach ($eyes as $pid => $e) {
            if (!empty($e['spawn']) && ($e['w'] !== null || $e['l'] !== null)) {
                $free[$pid] = $e;
            }
        }
        $out = [];
        while ($free) {
            $pid = array_key_first($free);
            $group = [$pid => $free[$pid]];
            unset($free[$pid]);
            $queue = [$pid];
            while ($queue) {
                $a = $group[array_shift($queue)];
                foreach ($free as $q => $e) {
                    if (self::apart($a, $e) < self::GROUP_KM) {
                        $group[$q] = $e;
                        unset($free[$q]);
                        $queue[] = $q;
                    }
                }
            }
            $out[] = $group;
        }
        return $out;
    }

    /** Сколько NPC уже вокруг компании. */
    private function around(array $group): int
    {
        $c = 0;
        foreach ($this->npcs as $n) {
            foreach ($group as $e) {
                $pos = $e['sys'] === $n->sys ? self::posIn($e, $n->frame) : null;
                if ($pos !== null && Vec::dist($pos, $n->p) < self::SEE_KM + 20) {
                    $c++;
                    break;
                }
            }
        }
        return $c;
    }

    /** Свободна ли точка: ни пилота, ни NPC ближе min в тех же осях. */
    private function clear(array $p, ?int $frame, int $sys, array $eyes, float $min): bool
    {
        foreach ($eyes as $e) {
            $pos = $e['sys'] === $sys ? self::posIn($e, $frame) : null;
            if ($pos !== null && Vec::dist($pos, $p) < $min) {
                return false;
            }
        }
        foreach ($this->npcs as $n) {
            if ($n->sys === $sys && $n->frame === $frame && Vec::dist($n->p, $p) < min($min, 2.0)) {
                return false;
            }
        }
        // В пустоте — не в станции и не в планете: пилот бывает в сотне
        // километров над грунтом, а точка — на тридцать ниже него.
        if ($frame === null && $this->wt !== null) {
            foreach ($this->bodiesAt($sys) as $b) {
                $gap = $b['station'] ? self::STATION_CLEAR : self::BODY_CLEAR + $b['r'] * self::RELIEF_K;
                if (Vec::dist($b['p'], $p) < $b['r'] + $gap) {
                    return false;
                }
            }
        }
        return true;
    }

    // --- тела -----------------------------------------------------------------

    /** Тело системы: радиус, твёрдый ли грунт, можно ли садиться, орбита. */
    private function body(int $sys, int $local): ?array
    {
        if (!isset($this->bodies[$sys])) {
            $list = [];
            foreach (Db::all('SELECT `local_id`,`parent_local_id`,`kind`,`type`,`radius_km`,`landable`,
                                     `orbit_radius_km`,`orbit_period_s`,`orbit_phase`,`orbit_plane`
                              FROM `body` WHERE `system_id`=?', [$sys]) as $r) {
                $solid = in_array($r['kind'], ['planet', 'moon'], true) && $r['type'] !== 'gas';
                $plane = json_decode((string) $r['orbit_plane'], true);
                $list[(int) $r['local_id']] = [
                    'r' => (float) $r['radius_km'], 'solid' => $solid,
                    'landable' => $solid && (bool) $r['landable'],
                    'station' => $r['kind'] === 'station',
                    'parent' => $r['parent_local_id'] === null ? null : (int) $r['parent_local_id'],
                    'orbit' => $r['orbit_period_s'] !== null && is_array($plane) && (float) $r['orbit_period_s'] > 0
                        ? ['r' => (float) $r['orbit_radius_km'], 'period' => (float) $r['orbit_period_s'],
                            'phase' => (float) $r['orbit_phase'],
                            'A' => array_map('floatval', $plane['A']), 'B' => array_map('floatval', $plane['B'])]
                        : null,
                ];
            }
            $this->bodies[$sys] = $list;
        }
        return $this->bodies[$sys][$local] ?? null;
    }

    /**
     * Где тело на момент мира wt, мировая точка. Орбиты аналитические, и
     * формула — та же, что у игры (js/game/world.js, bodyPosAt): угол по
     * орбите от фазы и доли периода, сложенный по цепочке родителей. Время
     * у них общее (Clock), и станция у сервера стоит там же, где у всех.
     */
    public function posAt(int $sys, int $local, float $wt): array
    {
        $out = [0.0, 0.0, 0.0];
        for ($b = $this->body($sys, $local), $guard = 0; $b !== null && $guard < 8; $guard++) {
            $o = $b['orbit'];
            if ($o !== null) {
                $a = $o['phase'] + ($wt / $o['period']) * 2 * M_PI;
                $out = Vec::madd(Vec::madd($out, $o['A'], cos($a) * $o['r']), $o['B'], sin($a) * $o['r']);
            }
            $b = $b['parent'] !== null ? $this->body($sys, $b['parent']) : null;
        }
        return $out;
    }

    /** Тела системы на этот шаг: точка, радиус, станция ли. Считаются раз за шаг. */
    private function bodiesAt(int $sys): array
    {
        if ($this->wt === null) {
            return [];
        }
        if (!isset($this->placed[$sys])) {
            $this->body($sys, 0);
            $out = [];
            foreach ($this->bodies[$sys] as $local => $b) {
                $out[] = ['p' => $this->posAt($sys, $local, $this->wt), 'r' => $b['r'], 'station' => $b['station']];
            }
            $this->placed[$sys] = $out;
        }
        return $this->placed[$sys];
    }

    /** Станции системы на этот шаг. */
    private function stationsAt(int $sys): array
    {
        return array_values(array_filter($this->bodiesAt($sys), static fn($b) => $b['station']));
    }

    /**
     * В чьих осях появится NPC у этого пилота: тела, если пилот низко над
     * его твёрдым грунтом, иначе мировых (null).
     */
    private function frameBody(array $e): ?int
    {
        if ($e['b'] === null || $e['l'] === null) {
            return null;
        }
        $b = $this->body($e['sys'], $e['b']);
        if ($b === null || !$b['solid']) {
            return null;
        }
        $alt = Vec::len($e['l']) - $b['r'];
        return $alt < self::FRAME_ALT + $b['r'] * self::RELIEF_K ? $e['b'] : null;
    }

    /**
     * Над чем ходит NPC у поверхности: верх грунта в круге AREA_KM вокруг
     * пилота (оракул) и пол — над ним с запасом. Без оракула — запас на
     * самые высокие горы тела.
     */
    private function areaOf(int $sys, int $local, array $dir): array
    {
        $R = $this->body($sys, $local)['r'];
        $top = null;
        if ($this->oracle !== null && $this->oracle->alive()) {
            $a = $this->oracle->area($sys, $local, $dir, self::AREA_KM);
            if ($a !== null) {
                $top = (float) $a['top'];
            }
        }
        $top = $top ?? $R * (1 + self::RELIEF_K);
        return ['r' => $R, 'top' => $top, 'floor' => $top + self::CLEAR_KM];
    }

    // --- состав -------------------------------------------------------------

    /**
     * Из чего собирают NPC: все типы корпусов и все модули из базы.
     * Читается раз: каталог за жизнь хаба не меняется (а поменяется —
     * хаб перезапускают и так, как после npm run api:setup).
     */
    private function pool(): array
    {
        if ($this->pool !== null) {
            return $this->pool;
        }
        $rows = Db::all('SELECT `code`,`name`,`hull_max`,`mass_t`,`length_m`,`width_m`,`height_m`,`price`,`spec`
                         FROM `ship_type` ORDER BY `id`');
        $prices = array_filter(array_map(static fn($r) => (float) $r['price'], $rows), static fn($p) => $p > 0);
        $minPrice = $prices ? min($prices) : 1.0;
        $minMass = 1.0;
        foreach ($rows as $r) {
            $minMass = $minMass === 1.0 ? max(1.0, (float) $r['mass_t']) : min($minMass, max(1.0, (float) $r['mass_t']));
        }
        $types = [];
        foreach ($rows as $r) {
            $spec = json_decode((string) $r['spec'], true) ?: [];
            $price = (float) $r['price'];
            // Вес в потоке: записанный у типа — или по цене. Дешёвых
            // кораблей в космосе больше, и крейсер — редкая встреча.
            $w = isset($spec['npcWeight']) ? (float) $spec['npcWeight']
                : ($price > 0 ? ($minPrice / $price) ** 0.6 : 1.0);
            if ($w <= 0) {
                continue;
            }
            $types[] = [
                'code' => (string) $r['code'], 'name' => (string) $r['name'],
                'hull' => (float) $r['hull_max'], 'mass' => (float) $r['mass_t'],
                'len' => (float) $r['length_m'], 'wid' => (float) $r['width_m'], 'hgt' => (float) $r['height_m'],
                'spec' => $spec, 'w' => $w,
            ];
        }
        $slots = [];
        foreach (Db::all('SELECT `code`,`name`,`slot`,`spec`,`price`,`stock` FROM `equipment_type` ORDER BY `id`') as $r) {
            $slots[$r['slot']][] = [
                'code' => (string) $r['code'], 'name' => (string) $r['name'], 'slot' => (string) $r['slot'],
                'spec' => json_decode((string) $r['spec'], true) ?: [],
                'price' => (float) $r['price'], 'stock' => (bool) $r['stock'],
            ];
        }
        $geo = $this->oracle !== null && $this->oracle->alive() ? $this->oracle->types() : [];
        return $this->pool = ['types' => $types, 'slots' => $slots, 'minMass' => $minMass, 'geo' => $geo];
    }

    /**
     * Свой заводской модуль корпуса по гнёздам (stock у типа в
     * server/data/specs.php): у крейсера — свой квантовый привод. Так же
     * собирает завод верфи (Shipyard::stockOf).
     */
    private static function hullStock(string $code): array
    {
        foreach (Specs::source()['shipTypes'] as $t) {
            if ($t['code'] === $code) {
                return is_array($t['stock'] ?? null) ? $t['stock'] : [];
            }
        }
        return [];
    }

    /**
     * Что из снаряжения стоит сверх заводского: им один NPC и отличается
     * от другого, и его прибор показывает (js/game/npc.js, npcGear).
     */
    public static function extras(string $code, array $mods): array
    {
        $own = self::hullStock($code);
        $out = [];
        foreach ($mods as $m) {
            $factory = isset($own[$m['slot']]) ? $own[$m['slot']] === $m['code'] : $m['stock'];
            if (!$factory && $m['slot'] !== 'gun') {
                $out[] = $m['code'];
            }
        }
        return $out;
    }

    /** Вес модуля в гнезде: дешевле — чаще. */
    private static function priceW(array $r, array $fit): float
    {
        $prices = array_filter(array_map(static fn($m) => $m['price'], $fit), static fn($p) => $p > 0);
        $min = $prices ? min($prices) : 1.0;
        return $r['price'] > 0 ? ($min / $r['price']) ** 0.8 : 1.0;
    }

    /**
     * Снаряжение NPC: по модулю на гнездо, из всего, что есть в базе и
     * ставится на этот корпус.
     *
     * @return array [модули, оружие или null]
     */
    public function outfit(array $type): array
    {
        $pool = $this->pool();
        $need = array_merge(Specs::required(), self::NEEDS);
        $hullStock = self::hullStock($type['code']);
        $mods = [];
        foreach ($pool['slots'] as $slot => $rows) {
            if ($slot === 'gun') {
                continue;
            }
            $fit = array_values(array_filter($rows, static fn($r) => empty($r['spec']['hulls'])
                || in_array($type['code'], $r['spec']['hulls'], true)));
            if (!$fit) {
                continue;
            }
            if (Specs::slotCap($slot) > 1) {
                // Гнездо на несколько приборов (компьютеры): заводские
                // стоят почти всегда.
                foreach ($fit as $r) {
                    if ($r['stock'] && $this->dice->chance(0.9)) {
                        $mods[] = $r;
                    }
                }
                continue;
            }
            $stock = null;
            foreach ($fit as $r) {
                if (isset($hullStock[$slot]) ? $r['code'] === $hullStock[$slot] : $r['stock']) {
                    $stock = $r;
                    break;
                }
            }
            if (!in_array($slot, $need, true)) {
                if ($stock === null ? !$this->dice->chance(self::EXTRA) : $this->dice->chance(self::BARE)) {
                    continue;
                }
            }
            $pick = $stock !== null && $this->dice->chance(self::STOCK) ? $stock
                : $this->dice->weighted(array_map(static fn($r) => [$r, self::priceW($r, $fit)], $fit));
            if ($pick !== null) {
                $mods[] = $pick;
            }
        }
        $guns = array_values(array_filter($pool['slots']['gun'] ?? [], static fn($r) => $r['stock']));
        $gun = $guns && $this->dice->chance(self::ARMED)
            ? $this->dice->weighted(array_map(static fn($r) => [$r, self::priceW($r, $guns)], $guns)) : null;
        return [$mods, $gun];
    }

    /**
     * Лётные числа NPC — из корпуса и стоящих модулей, тем же сложением,
     * что у игрока (Specs::mergeFlight): двигатель даёт скорость и разгон,
     * маневровые — поворот, щит — свою ёмкость. Корпус крупнее — тяга на
     * тонну меньше, нос тяжелее (js/game/ship.js, hullScale).
     */
    private function rig(Npc $n, array $type, array $mods): void
    {
        $pool = $this->pool();
        $fl = $type['spec'];
        $drive = [];
        foreach ($mods as $m) {
            foreach ($m['spec']['flight'] ?? [] as $k => $v) {
                $fl[$k] = $v;
            }
            if ($m['slot'] === 'drive') {
                $drive = $m['spec'];
            }
        }
        $geo = $pool['geo'][$type['code']] ?? null;
        $k = $geo !== null ? (float) $geo['k'] : max(1.0, $type['mass'] / $pool['minMass']) ** (1 / 3);
        $thrust = (float) ($fl['thrustK'] ?? 1.0) / ($k ** 3);
        $n->speed = (float) ($fl['maxSpeed'] ?? 1.0);
        $n->accel = (float) ($fl['accel'] ?? 0.45) * $thrust;
        $n->brake = (float) ($fl['brake'] ?? 0.75) * $thrust;
        $n->lateral = (float) ($fl['lateral'] ?? 0.5);
        $half = $geo !== null ? $geo['half'] : [$type['wid'] / 2000, $type['hgt'] / 2000, $type['len'] / 2000];
        // Предел поворота — по прочности оконечностей: ω = √(a/r).
        $n->turn = sqrt((float) ($fl['tipAccel'] ?? 4.9) / 1000 / max(0.005, hypot($half[0], $half[2])));
        $n->boost = max(1.0, (float) ($fl['boostMax'] ?? 1.0));
        $n->shieldMax = (float) ($fl['maxShield'] ?? 0.0);
        $n->shield = $n->shieldMax;
        $n->regen = (float) ($fl['shieldRegen'] ?? 0.0);
        $n->delay = (float) ($fl['shieldDelay'] ?? 0.0);
        $n->spool = (float) ($drive['spool'] ?? 3.0);
        $n->gearClear = $geo !== null ? (float) $geo['gear'] : $type['hgt'] / 2000 + 0.004;
        $n->hullMax = $type['hull'];
        $n->hull = $type['hull'];
    }

    /** Имя, которого сейчас нет ни у кого из NPC. */
    private function freshName(): string
    {
        $taken = [];
        foreach ($this->npcs as $n) {
            $taken[$n->name] = true;
        }
        for ($i = 0; $i < 20; $i++) {
            $name = Npc::nameOf($this->dice);
            if (!isset($taken[$name])) {
                return $name;
            }
        }
        return $name;
    }

    // --- прибытие -------------------------------------------------------------

    /**
     * NPC без места и без плана: корпус из потока, имя, снаряжение и лётные
     * числа. Из него прибытие делает настоящего (spawnFor), а проверки
     * смотрят на сотню таких, какие корабли вообще бывают.
     */
    public function draft(): ?Npc
    {
        $pool = $this->pool();
        $type = $this->dice->weighted(array_map(static fn($t) => [$t, $t['w']], $pool['types']));
        if ($type === null) {
            return null;
        }
        $n = new Npc();
        $n->id = -$this->next;
        $n->type = $type['code'];
        $n->name = $this->freshName();
        [$mods, $gun] = $this->outfit($type);
        $this->rig($n, $type, $mods);
        $n->eq = array_map(static fn($m) => $m['code'], $mods);
        $n->extra = self::extras($type['code'], $mods);
        if ($gun !== null) {
            $n->eq[] = $gun['code'];
        }
        return $n;
    }

    /** Новый NPC у компании: корпус, снаряжение, план. Не вышло — null. */
    private function spawnFor(array $group, array $eyes, float $now): ?Npc
    {
        $n = $this->draft();
        if ($n === null) {
            return null;
        }
        $anchor = $this->dice->pick($group);
        $n->sys = (int) $anchor['sys'];
        $n->born = $now;
        $n->qx = $now + self::FLASH;

        $frame = $this->frameBody($anchor);
        $how = '';
        if ($frame === null) {
            $n->home = $anchor['w'] !== null ? $this->homeFor($n, $anchor['w'], $eyes) : null;
            $ok = $n->home !== null && $this->planSpace($n, $eyes);
            $how = 'в пустоте';
        } else {
            $n->frame = $frame;
            $n->home = $this->homeFor($n, $anchor['l'], $eyes);
            $ok = false;
            if ($n->home !== null) {
                $n->area = $this->areaOf($n->sys, $frame, Vec::unit($n->home));
                if ($this->body($n->sys, $frame)['landable'] && $this->oracle !== null && $this->oracle->alive()
                    && $this->dice->chance(self::LANDERS)) {
                    $ok = $this->planLanding($n, $eyes);
                    $how = 'садится на тело ' . $frame;
                }
                if (!$ok) {
                    $ok = $this->planLow($n, $anchor['l'], $eyes);
                    $how = 'над телом ' . $frame;
                }
            }
        }
        if (!$ok) {
            return null;
        }
        $this->next++;
        $this->npcs[$n->id] = $n;
        $this->say('NPC ' . $n->name . ' (' . $n->type . ') вышел из прыжка: система ' . $n->sys . ', ' . $how);
        return $n;
    }

    /** Точка выхода из прыжка: не ближе ARRIVE_MIN ни к кому. */
    private function arrival(callable $gen, ?int $frame, int $sys, array $eyes): ?array
    {
        for ($i = 0; $i < 10; $i++) {
            $p = $gen();
            if ($this->clear($p, $frame, $sys, $eyes, self::ARRIVE_MIN)) {
                return $p;
            }
        }
        return null;
    }

    /**
     * Центр участка NPC: в HOME_MIN..HOME_MAX км от пилота и как можно
     * дальше от чужих участков — не ближе APART, а если так не выходит
     * (вокруг уже тесно), то хотя бы дальше всех прочих попыток. Иначе
     * NPC толпились бы у пилота кучкой, а округа пустовала.
     *
     * @param array $a где пилот в осях NPC
     */
    private function homeFor(Npc $n, array $a, array $eyes): ?array
    {
        $best = null;
        $bestGap = -1.0;
        for ($i = 0; $i < 16; $i++) {
            if ($n->frame === null) {
                $c = Vec::madd($a, $this->dice->unit3(), $this->dice->range(self::HOME_MIN, self::HOME_MAX));
                if (!$this->clear($c, null, $n->sys, $eyes, 4.0)) {
                    continue;
                }
            } else {
                $R = $this->body($n->sys, $n->frame)['r'];
                $c = Vec::scale(Vec::around(Vec::unit($a), $this->dice->range(self::HOME_MIN, self::HOME_MAX) / $R,
                    $this->dice->range(0, 2 * M_PI)), $R);
            }
            $gap = INF;
            foreach ($this->npcs as $o) {
                if ($o->home !== null && $o->sys === $n->sys && $o->frame === $n->frame) {
                    $gap = min($gap, Vec::dist($o->home, $c));
                }
            }
            if ($gap >= self::APART) {
                return $c;
            }
            if ($gap > $bestGap) {
                $best = $c;
                $bestGap = $gap;
            }
        }
        return $best;
    }

    /** Нос — на первую цель, скорость — выхода из прыжка. */
    private function launch(Npc $n, array $p, array $to): void
    {
        $n->p = $p;
        $n->f = Vec::unit(Vec::sub($to, $p), $n->f);
        $ref = $n->frame !== null ? Vec::unit($p) : Vec::perp($n->f);
        $u = Vec::across($ref, $n->f);
        $n->u = Vec::len($u) > 1e-6 ? Vec::unit($u) : Vec::perp($n->f);
        $n->v = Vec::scale($n->f, min($n->speed, 1.0));
    }

    /**
     * Облёт участка: точка за точкой неспешным ходом, у большинства —
     * зависнуть на полминуты-минуту. Точки даёт where(): в пустоте — шар
     * вокруг центра, у тела — круг над грунтом.
     *
     * Сколько точек — решает не число, а время: облёт набирается, пока
     * по оценке (путь на ходу плюс разгон и торможение, плюс зависания)
     * не займёт budget секунд. Число точек при неудачном раскладе — пять
     * соседних точек в паре км друг от друга — давало жизнь в две минуты.
     *
     * @param array $from откуда начинается облёт (точка выхода из прыжка)
     */
    private function legs(Npc $n, callable $where, float $budget, array $from, array $eyes): array
    {
        $plan = [];
        $spent = 0.0;
        $prev = $from;
        for ($i = 0; $i < self::LEGS_CAP && $spent < $budget; $i++) {
            $w = null;
            for ($j = 0; $j < 8 && $w === null; $j++) {
                $c = $where();
                $w = $this->clear($c, $n->frame, $n->sys, $eyes, 2.0) ? $c : null;
            }
            if ($w === null) {
                continue;
            }
            $v = $this->dice->range(self::CRUISE_MIN, self::CRUISE_MAX);
            $plan[] = ['k' => 'goto', 'to' => $w, 'v' => $v];
            $spent += Vec::dist($prev, $w) / max(0.05, $v * $n->speed) + 6.0;
            $prev = $w;
            if ($this->dice->chance(self::HOVER)) {
                $dur = $this->dice->range(self::HOVER_MIN, self::HOVER_MAX);
                $plan[] = ['k' => 'loiter', 'dur' => $dur, 'h' => $this->dice->unit3()];
                $spent += $dur;
            }
        }
        return $plan;
    }

    /**
     * Визит к пилоту: у части NPC (INSPECT) в облёт вставлен подлёт к
     * ближайшему пилоту — в километр, носом на него, на 20–30 секунд, как
     * будто сканирует, — и дальше по своим делам (Npc::inspect). Ставится
     * после первой-второй точки: пока пилот ещё рядом.
     */
    private function withVisit(array $plan): array
    {
        if (!$this->dice->chance(self::INSPECT)) {
            return $plan;
        }
        // Перед второй или третьей точкой облёта: после зависания у
        // прежней, а не между точкой и её зависанием — иначе, улетая от
        // пилота, NPC ещё полминуты «висел бы у точки» прямо у него.
        $before = $this->dice->int(2, 3);
        $visit = ['k' => 'inspect', 'dur' => $this->dice->range(self::VISIT_MIN, self::VISIT_MAX)];
        $seen = 0;
        foreach ($plan as $i => $t) {
            if ($t['k'] === 'goto' && ++$seen === $before) {
                array_splice($plan, $i, 0, [$visit]);
                return $plan;
            }
        }
        $plan[] = $visit;
        return $plan;
    }

    /** Последняя точка облёта (или запасная), куда смотреть при уходе. */
    private static function lastPoint(array $plan, array $or): array
    {
        for ($i = count($plan) - 1; $i >= 0; $i--) {
            if ($plan[$i]['k'] === 'goto') {
                return $plan[$i]['to'];
            }
        }
        return $or;
    }

    /** В пустоте: облететь свой участок и уйти прыжком. */
    private function planSpace(Npc $n, array $eyes): bool
    {
        $home = $n->home;
        $p = $this->arrival(fn() => Vec::madd($home, $this->dice->unit3(),
            $this->dice->range(self::ARRIVE_NEAR, self::ARRIVE_FAR)), null, $n->sys, $eyes);
        if ($p === null) {
            return false;
        }
        $plan = $this->legs($n, fn() => Vec::madd($home, $this->dice->unit3(), $this->dice->range(2.0, self::REGION_KM)),
            $this->dice->range(self::LIFE_MIN, self::LIFE_MAX), $p, $eyes);
        if (!$plan) {
            return false;
        }
        $plan = $this->withVisit($plan);
        $last = self::lastPoint($plan, $p);
        $out = Vec::unit(Vec::madd(Vec::unit(Vec::sub($last, $home), Vec::perp($n->f)), $this->dice->unit3(), 0.5));
        $plan[] = ['k' => 'depart', 'h' => $out];
        $n->plan = $plan;
        $this->launch($n, $p, $plan[0]['to']);
        return true;
    }

    /** Полоса облёта над грунтом: от пола участка и до высоты пилота. */
    private function band(Npc $n, array $a): array
    {
        $lo = $n->area['floor'] + 1.0;
        return [$lo, min($lo + 40.0, max($lo + 8.0, Vec::len($a) + 6.0))];
    }

    /**
     * Уход от тела: вверх и вперёд по ходу — от грунта, а не в него.
     * Смотрит от предпоследней точки к последней.
     */
    private static function climbOut(array $last, array $prev): array
    {
        $up = Vec::unit($last);
        $fwd = Vec::unit(Vec::across(Vec::sub($last, $prev), $up), Vec::perp($up));
        return Vec::unit(Vec::add(Vec::scale($up, 0.8), Vec::scale($fwd, 0.6)));
    }

    /** У поверхности, без посадки: облететь участок над грунтом и уйти вверх. */
    private function planLow(Npc $n, array $a, array $eyes): bool
    {
        $dh = Vec::unit($n->home);
        $R = $n->area['r'];
        [$lo, $hi] = $this->band($n, $a);
        $p = $this->arrival(fn() => Vec::scale(Vec::around($dh, $this->dice->range(self::ARRIVE_NEAR, self::ARRIVE_FAR) / $R,
            $this->dice->range(0, 2 * M_PI)), $this->dice->range($lo, $hi)), $n->frame, $n->sys, $eyes);
        if ($p === null) {
            return false;
        }
        $over = fn() => Vec::scale(Vec::around($dh, $this->dice->range(2.0, self::REGION_KM) / $R,
            $this->dice->range(0, 2 * M_PI)), $this->dice->range($lo, $hi));
        $plan = $this->legs($n, $over, $this->dice->range(self::LIFE_MIN, self::LIFE_MAX), $p, $eyes);
        if (!$plan) {
            return false;
        }
        $plan = $this->withVisit($plan);
        $last = self::lastPoint($plan, $p);
        $plan[] = ['k' => 'depart', 'h' => self::climbOut($last, $p)];
        $n->plan = $plan;
        $this->launch($n, $p, $plan[0]['to']);
        return true;
    }

    /**
     * Посадка: площадка у центра участка — сухая и ровная, по оракулу.
     * Выход из прыжка — над ней, на высоте пола округи и в стороне;
     * дальше: долететь, снизиться на стойки, постоять минуты, взлететь
     * вертикально, облететь участок и уйти.
     */
    private function planLanding(Npc $n, array $eyes): bool
    {
        $dh = Vec::unit($n->home);
        $R = $n->area['r'];
        $want = Vec::around($dh, $this->dice->range(0.0, 5.0) / $R, $this->dice->range(0, 2 * M_PI));
        $site = $this->oracle->site($n->sys, $n->frame, Vec::r6($want), 3.0);
        if ($site === null) {
            return false;
        }
        $sd = Vec::unit($site['dir']);
        $sr = (float) $site['r'];
        $nrm = Vec::unit($site['n'], $sd);
        // Центр корабля на стойках: над грунтом площадки по её нормали.
        $touch = Vec::madd(Vec::scale($sd, $sr), $nrm, $n->gearClear);
        if (!$this->clear($touch, $n->frame, $n->sys, $eyes, self::PAD_CLEAR)) {
            return false;
        }
        foreach ($this->npcs as $o) {
            foreach (array_merge($o->task !== null ? [$o->task] : [], $o->plan) as $t) {
                if ($t['k'] === 'descend' && $o->frame === $n->frame && $o->sys === $n->sys
                    && Vec::dist($t['to'], $touch) < self::APART * 0.5) {
                    return false;               // рядом уже садится другой NPC
                }
            }
        }
        $cruise = max($n->area['floor'], $sr + 3.0);
        $above = Vec::scale($sd, $cruise);
        $p = $this->arrival(fn() => Vec::scale(Vec::around($sd, $this->dice->range(self::ARRIVE_NEAR, 14.0) / $sr,
            $this->dice->range(0, 2 * M_PI)), $cruise + $this->dice->range(0.0, 4.0)), $n->frame, $n->sys, $eyes);
        if ($p === null) {
            return false;
        }
        // Взлетев, ещё облетает участок — невысоко, над полом округи.
        $over = fn() => Vec::scale(Vec::around($dh, $this->dice->range(2.0, self::REGION_KM) / $R,
            $this->dice->range(0, 2 * M_PI)), $cruise + $this->dice->range(1.0, 8.0));
        $after = $this->withVisit($this->legs($n, $over, $this->dice->range(60.0, 180.0), $above, $eyes));
        $n->plan = array_merge([
            ['k' => 'goto', 'to' => $above, 'v' => 0.6],
            ['k' => 'descend', 'to' => $touch, 'n' => $nrm],
            ['k' => 'landed', 'dur' => $this->dice->range(self::STAY_MIN, self::STAY_MAX)],
            ['k' => 'ascend', 'from' => $touch, 'to' => $above],
        ], $after, [
            ['k' => 'depart', 'h' => self::climbOut(self::lastPoint($after, $above), $p)],
        ]);
        $this->launch($n, $p, $above);
        return true;
    }

    private function say(string $line): void
    {
        if ($this->log !== null) {
            ($this->log)($line);
        }
    }
}
