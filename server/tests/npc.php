<?php
/**
 * Проверки NPC (server/src/Traffic.php, Npc.php): сколько их, где они
 * появляются, из чего собраны, как садятся, как гибнут и как уходят.
 *
 * Подключается из hub.php: та же проверочная база, те же поддельные
 * соединения и те же пилоты. Оракул рельефа здесь поддельный — грунт у
 * него ровная сфера, и площадка ровно там, где спросили, — чтобы
 * проверялась логика NPC, а не шум рельефа. Настоящий оракул (Node с
 * кодом мира) спрашивается в конце одним вопросом.
 */

echo PHP_EOL . '== NPC ==' . PHP_EOL;

/** Поддельный оракул: грунт — сфера на полкилометра выше радиуса тела. */
final class FakeOracle
{
    public const LIFT = 0.5;
    public int $sites = 0;

    public function alive(): bool
    {
        return true;
    }

    public function types(): array
    {
        return [
            'challenger' => ['gear' => 0.0136, 'clear' => 0.0096, 'k' => 1.0, 'half' => [0.0335, 0.0096, 0.0325]],
            'prometheus' => ['gear' => 0.0274, 'clear' => 0.0229, 'k' => 2.8392, 'half' => [0.04, 0.0429, 0.1124]],
        ];
    }

    private static function r(int $sys, int $body): float
    {
        return (float) Db::one('SELECT `radius_km` FROM `body` WHERE `system_id`=? AND `local_id`=?', [$sys, $body]);
    }

    public function area(int $sys, int $body, array $dir, float $km): ?array
    {
        $r = self::r($sys, $body);
        return ['ok' => true, 'r' => $r, 'top' => $r + self::LIFT + 1.0];
    }

    public function site(int $sys, int $body, array $dir, float $span = 3.0): ?array
    {
        $this->sites++;
        $d = Vec::unit($dir);
        return ['ok' => true, 'dir' => $d, 'r' => self::r($sys, $body) + self::LIFT, 'n' => $d, 'slope' => 0.0];
    }
}

$R3 = (float) Db::one('SELECT `radius_km` FROM `body` WHERE `system_id`=0 AND `local_id`=3');
$d0 = Vec::unit([0.3, 0.5, 0.81]);
// Пилот на «грунте» поддельного оракула, в осях тела 3 (Lave II).
$foot = static fn(array $dir) => Vec::scale(Vec::unit($dir), $R3 + FakeOracle::LIFT + 0.002);
$low = static fn(array $l) => ['sys' => 0, 'w' => null, 'b' => 3, 'l' => $l, 'spawn' => true];
$space = static fn(array $w) => ['sys' => 0, 'w' => $w, 'b' => null, 'l' => null, 'spawn' => true];
$deep = [900000.0, 1000.0, -300000.0];

/**
 * Прогнать движение: сколько NPC было разом, на каком расстоянии от
 * ближайшего пилота каждый вышел из прыжка, и все события.
 */
$run = static function (Traffic $tr, array $eyes, float $secs, float &$t, ?callable $each = null): array {
    $max = 0;
    $arrive = [];
    $events = [];
    for ($i = 0, $n = (int) round($secs / 0.2); $i < $n; $i++) {
        $t += 0.2;
        foreach ($tr->step($t, $eyes) as $ev) {
            $events[] = $ev;
            if ($ev['how'] === 'arrive') {
                $npc = $tr->get($ev['id']);
                $near = INF;
                foreach ($eyes as $e) {
                    $p = Traffic::posIn($e, $npc->frame);
                    if ($p !== null) {
                        $near = min($near, Vec::dist($p, $npc->p));
                    }
                }
                $arrive[] = $near;
            }
        }
        $max = max($max, count($tr->all()));
        if ($each !== null) {
            $each($tr, $t);
        }
    }
    return ['max' => $max, 'arrive' => $arrive, 'events' => $events];
};

// --- сколько ------------------------------------------------------------------

ok(Traffic::target(1) === 5 && Traffic::target(2) === 6 && Traffic::target(3) === 7
    && Traffic::target(8) === 9 && Traffic::target(40) === Traffic::GROUP_CAP,
    'NPC на компанию: одному ' . Traffic::target(1) . ', двоим ' . Traffic::target(2) . ', троим '
    . Traffic::target(3) . ', восьмерым ' . Traffic::target(8) . ', толпе — не больше ' . Traffic::GROUP_CAP);
ok(Traffic::target(2) < 2 * Traffic::target(1) && Traffic::target(1, false) < Traffic::target(1),
    'двое вместе — не вдвое больше одного; в пустоте между планетами — меньше, чем у тела');

$t = 50000.0;
$one = $run(new Traffic(new FakeOracle(), 3), [1 => $low($foot($d0))], 240, $t);
$near2 = Vec::madd($foot($d0), Vec::perp($d0), 3.0);
$two = $run(new Traffic(new FakeOracle(), 3), [1 => $low($foot($d0)), 2 => $low($near2)], 240, $t);
$apart = $run(new Traffic(new FakeOracle(), 3),
    [1 => $low($foot($d0)), 2 => $low($foot(Vec::scale($d0, -1)))], 240, $t);
ok($one['max'] === 5 && $two['max'] === 6 && $apart['max'] === 10,
    "за 4 минуты у грунта: одинокому пилоту — до {$one['max']} NPC, двоим в трёх км — до {$two['max']}, "
    . "двоим на разных сторонах планеты — до {$apart['max']}");

$all = array_merge($one['arrive'], $two['arrive'], $apart['arrive']);
ok($all && min($all) >= Traffic::ARRIVE_MIN - 1e-9 && max($all) < Traffic::SEE_KM,
    'из прыжка выходят не ближе ' . Traffic::ARRIVE_MIN . ' км ни к кому (ближайший — '
    . round(min($all), 1) . ' км) и в пределах локатора (дальний — ' . round(max($all), 1) . ' км), '
    . count($all) . ' прибытий');

$sp = $run(new Traffic(new FakeOracle(), 4), [1 => $space($deep)], 180, $t);
ok($sp['max'] === Traffic::target(1, false) && $sp['arrive']
    && min($sp['arrive']) >= Traffic::ARRIVE_MIN && max($sp['arrive']) < Traffic::SEE_KM,
    "в пустоте: до {$sp['max']} NPC, выходят в " . round(min($sp['arrive']), 1) . '–'
    . round(max($sp['arrive']), 1) . ' км от пилота');

// Кто в доке или в прыжке, NPC к себе не зовёт; ушли все — NPC пропадают тихо.
$tr = new Traffic(new FakeOracle(), 5);
$docked = $space($deep);
$docked['spawn'] = false;
$r = $run($tr, [1 => $docked], 60, $t);
ok($r['max'] === 0, 'пилот в доке (или в прыжке) NPC к себе не зовёт');
$tr = new Traffic(new FakeOracle(), 5);
$run($tr, [1 => $space($deep)], 60, $t);
$had = count($tr->all());
$r = $run($tr, [], Traffic::DROP_AFTER + 2, $t);
$drops = count(array_filter($r['events'], static fn($e) => $e['how'] === 'drop'));
ok($had > 0 && count($tr->all()) === 0 && $drops === $had,
    "пилот ушёл — $had NPC вокруг него пропали тихо через " . Traffic::DROP_AFTER . ' с (их не видел никто)');

// У станции: ни выхода из прыжка в ней, ни пролёта сквозь неё. Где она,
// сервер считает по орбитам из базы на время мира (Traffic::posAt).
$wt = 2.5e6;
$tr = new Traffic(new FakeOracle(), 6);
$stId = (int) Db::one("SELECT `local_id` FROM `body` WHERE `system_id`=0 AND `kind`='station' ORDER BY `local_id` LIMIT 1");
$stR = (float) Db::one('SELECT `radius_km` FROM `body` WHERE `system_id`=0 AND `local_id`=?', [$stId]);
$stP = $tr->posAt(0, $stId, $wt);
$dock = [1 => $space(Vec::madd($stP, Vec::unit([1.0, 0.3, -0.4]), 3.0))];
$closest = INF;
$born = INF;
for ($i = 0; $i < 900; $i++) {
    $t += 0.2;
    foreach ($tr->step($t, $dock, $wt) as $ev) {
        if ($ev['how'] === 'arrive') {
            $born = min($born, Vec::dist($tr->get($ev['id'])->p, $stP));
        }
    }
    foreach ($tr->all() as $n) {
        $closest = min($closest, Vec::dist($n->p, $stP));
    }
}
ok($born >= $stR + Traffic::STATION_CLEAR && $closest > $stR + 0.5,
    'у станции: из прыжка — не ближе ' . round($born, 1) . ' км к ней, а пролетающие обходят её — ближе '
    . round($closest, 2) . ' км к центру никто не подходил (габарит ' . $stR . ' км)');

// Участки разнесены: у каждого NPC свой, в 8–40 км от пилота и не ближе
// 12 км к чужому, — а не кучка у пилота.
$tr = new Traffic(new FakeOracle(), 3);
$run($tr, [1 => $low($foot($d0))], 120, $t);
$homes = array_values(array_map(static fn($n) => $n->home, $tr->all()));
$gap = INF;
$far = [INF, 0.0];
for ($i = 0; $i < count($homes); $i++) {
    $dh = Vec::dist(Vec::scale(Vec::unit($homes[$i]), $R3), Vec::scale($d0, $R3));
    $far = [min($far[0], $dh), max($far[1], $dh)];
    for ($j = $i + 1; $j < count($homes); $j++) {
        $gap = min($gap, Vec::dist($homes[$i], $homes[$j]));
    }
}
ok(count($homes) === 5 && $gap >= Traffic::APART && $far[0] >= Traffic::HOME_MIN - 0.1 && $far[1] <= Traffic::HOME_MAX + 0.1,
    'у пяти NPC — пять участков в ' . round($far[0]) . '–' . round($far[1]) . ' км от пилота, ближайшие два — в '
    . round($gap, 1) . ' км друг от друга: расходятся по округе, а не толпятся');

// Живут минуты, а не полторы, и часть подлетает к пилоту посмотреть: на
// километр, носом на него, на 20–30 секунд, — и улетает.
$tr = new Traffic(new FakeOracle(), 31);
$P = $deep;
$born = [];
$lives = [];
$scans = [];
$near = [];          // NPC => [секунд в 1.5 км, ближе всего, носом на пилота]
for ($i = 0; $i < 12000; $i++) {
    $t += 0.2;
    foreach ($tr->step($t, [1 => $space($P)]) as $ev) {
        if ($ev['how'] === 'arrive') {
            $born[$ev['id']] = $t;
        } elseif ($ev['how'] === 'jump' && isset($born[$ev['id']])) {
            $lives[] = $t - $born[$ev['id']];
        } elseif ($ev['how'] === 'scan') {
            $scans[] = $ev;
        }
    }
    foreach ($tr->all() as $n) {
        $d = Vec::dist($n->p, $P);
        $m = $near[$n->id] ?? [0.0, INF, 0.0];
        if ($d < 1.5) {
            $m[0] += 0.2;
            $m[2] = max($m[2], Vec::dot($n->f, Vec::unit(Vec::sub($P, $n->p))));
        }
        $m[1] = min($m[1], $d);
        $near[$n->id] = $m;
    }
}
sort($lives);
$median = $lives ? $lives[intdiv(count($lives), 2)] : 0;
ok(count($lives) >= 4 && $median >= 300 && $lives[0] >= 150,
    'живут минуты: ' . count($lives) . ' NPC ушли прыжком, медиана жизни — ' . round($median / 60, 1)
    . ' мин, самый короткий — ' . round(($lives[0] ?? 0) / 60, 1) . ' мин');
$visits = array_filter($near, static fn($m) => $m[0] >= Traffic::VISIT_MIN - 2);
$closest = min(array_map(static fn($m) => $m[1], $near));
$facing = $visits ? min(array_map(static fn($m) => $m[2], $visits)) : 0;
$longest = $visits ? max(array_map(static fn($m) => $m[0], $visits)) : 0;
ok($visits && count($scans) >= count($visits) && $scans[0]['pid'] === 1 && $closest > 0.6
    && $facing > 0.95 && $longest < Traffic::VISIT_MAX + 25,
    count($visits) . ' из ' . count($near) . ' NPC подлетали к пилоту посмотреть: в километр (ближе '
    . round($closest, 2) . ' км никто), носом на него, до ' . round($longest) . ' с рядом — и пилоту '
    . 'сказано «сканирует»');

// --- из чего ------------------------------------------------------------------

$tr = new Traffic(new FakeOracle(), 21);
$drafts = [];
for ($i = 0; $i < 400; $i++) {
    $drafts[] = $tr->draft();
}
$types = [];
foreach (Db::all('SELECT `code` FROM `ship_type`') as $row) {
    $types[$row['code']] = 0;
}
foreach ($drafts as $n) {
    $types[$n->type]++;
}
$share = $types['prometheus'] / count($drafts);
// Вездеход (npcWeight 0) NPC не водят: из типов с весом — все, без веса — ни одного.
$weighted = array_filter($types, static fn($k) => (Specs::typeSpec($k)['npcWeight'] ?? 1) > 0, ARRAY_FILTER_USE_KEY);
ok(min($weighted) > 0 && ($types['rover'] ?? 0) === 0 && $share > 0.06 && $share < 0.22,
    'корпус — из всех типов в базе с весом (' . implode(', ', array_map(static fn($k, $v) => "$k $v", array_keys($types), $types))
    . '), вездехода нет; крейсер — редкая встреча: ' . round($share * 100) . ' %');

$modRows = [];
foreach (Db::all('SELECT `code`,`slot`,`spec` FROM `equipment_type`') as $row) {
    $modRows[$row['code']] = ['slot' => $row['slot'], 'spec' => json_decode((string) $row['spec'], true) ?: []];
}
$need = array_merge(Specs::required(), Traffic::NEEDS);
$bad = [];
$looks = [];
foreach ($drafts as $n) {
    $slots = [];
    foreach ($n->eq as $code) {
        $m = $modRows[$code] ?? null;
        if ($m === null) {
            $bad[] = "нет модуля $code";
            continue;
        }
        $slots[$m['slot']] = ($slots[$m['slot']] ?? 0) + 1;
        if (!empty($m['spec']['hulls']) && !in_array($n->type, $m['spec']['hulls'], true)) {
            $bad[] = "$code на {$n->type}";
        }
    }
    foreach ($slots as $slot => $c) {
        if ($c > Specs::slotCap($slot)) {
            $bad[] = "в гнезде $slot $c модулей";
        }
    }
    foreach ($need as $slot) {
        if (empty($slots[$slot])) {
            $bad[] = "{$n->type} без $slot";
        }
    }
    $sorted = $n->eq;
    sort($sorted);
    $looks[implode(',', $sorted)] = true;
}
ok($bad === [], 'снаряжение NPC — из модулей базы, по гнёздам, на свой корпус; двигатель, маневровые, '
    . 'подъёмные, привод и шасси есть у всех' . ($bad ? ': ' . implode('; ', array_slice($bad, 0, 4)) : ''));

$has = static fn(Npc $n, string $c) => in_array($c, $n->eq, true);
$count = static fn(callable $f) => count(array_filter($drafts, $f));
$bare = $count(static fn($n) => !$has($n, 'shield') && !$has($n, 'shield_x'));
$fast = $count(static fn($n) => $has($n, 'engine_x'));
$armed = $count(static fn($n) => $has($n, 'laser_g'));
ok(count($looks) > 40 && $bare > 0 && $fast > 0 && $armed > 0 && $armed < count($drafts),
    count($looks) . ' разных комплектаций из 400: без щита ' . $bare . ', с форсированным двигателем '
    . $fast . ', вооружены ' . $armed);

$names = array_map(static fn($n) => $n->name, $drafts);
ok(count(array_unique($names)) >= 390 && preg_match('/^[A-Z][a-z]+ [A-Z][a-z]+$/', $names[0]) === 1,
    'имена случайные: ' . count(array_unique($names)) . ' разных из 400 («' . $names[0] . '», «' . $names[1] . '»)');

// Модули меняют корабль: форсированный двигатель быстрее, у крейсера
// разгон и поворот тяжелее, щит — по модулю, без модуля — ноль.
$pick = static function (callable $f) use ($drafts): ?Npc {
    foreach ($drafts as $n) {
        if ($f($n)) {
            return $n;
        }
    }
    return null;
};
$ch = $pick(static fn($n) => $n->type === 'challenger' && $has($n, 'engine'));
$chx = $pick(static fn($n) => $n->type === 'challenger' && $has($n, 'engine_x'));
$pr = $pick(static fn($n) => $n->type === 'prometheus' && $has($n, 'engine'));
$noSh = $pick(static fn($n) => !$has($n, 'shield') && !$has($n, 'shield_x'));
$sh = $pick(static fn($n) => $has($n, 'shield'));
ok($ch && $chx && $pr && $noSh && $sh
    && abs($chx->speed - 1.8) < 1e-9 && abs($ch->speed - 1.2) < 1e-9
    && $pr->accel < $ch->accel * 0.7 && $pr->turn < $ch->turn && $pr->hullMax > $ch->hullMax
    && $noSh->shieldMax == 0 && abs($sh->shieldMax - 40) < 1e-9,
    sprintf('числа — из модулей и корпуса: ход %.1f и %.1f км/с (форсированный), разгон торговца %.2f, '
        . 'крейсера %.2f км/с², поворот %.0f°/с и %.0f°/с, щит %.0f или нет вовсе',
        $ch ? $ch->speed : 0, $chx ? $chx->speed : 0, $ch ? $ch->accel : 0, $pr ? $pr->accel : 0,
        $ch ? rad2deg($ch->turn) : 0, $pr ? rad2deg($pr->turn) : 0, $sh ? $sh->shieldMax : 0));
$prx = $pick(static fn($n) => $n->type === 'prometheus');
ok($prx !== null && !in_array('quantum_p', $prx->extra, true)
    && ($chx === null || in_array('engine_x', $chx->extra, true)) && !in_array('engine', $ch->extra, true),
    'сверх заводского (ex) — то, что не стоит с завода: свой привод крейсера к ним не относится');

// --- посадка ------------------------------------------------------------------

$tr = new Traffic(new FakeOracle(), 8);
$pilot = [1 => $low($foot($d0))];
$landed = [];
$climbed = [];
$run($tr, $pilot, 1300, $t, static function (Traffic $tr, float $t) use (&$landed, &$climbed, $R3): void {
    foreach ($tr->all() as $n) {
        if ($n->mode === 'landed' && !isset($landed[$n->id])) {
            $landed[$n->id] = ['h' => Vec::len($n->p) - ($R3 + FakeOracle::LIFT), 'gear' => $n->gearClear,
                'g' => $n->gear, 'v' => Vec::len($n->v), 'up' => Vec::dot($n->u, Vec::unit($n->p))];
        }
        if (isset($landed[$n->id]) && $n->mode === 'flight') {
            $climbed[$n->id] = max($climbed[$n->id] ?? 0, Vec::len($n->p) - ($R3 + FakeOracle::LIFT));
        }
    }
});
$okLand = $landed !== [];
foreach ($landed as $l) {
    $okLand = $okLand && abs($l['h'] - $l['gear']) < 1e-6 && $l['g'] == 1 && $l['v'] == 0 && $l['up'] > 0.999;
}
$first = $landed ? reset($landed) : ['h' => 0, 'gear' => 0];
ok($okLand, count($landed) . ' NPC сели на площадки оракула: центр над грунтом ровно на стойки ('
    . round($first['h'] * 1000, 1) . ' м при просвете ' . round($first['gear'] * 1000, 1)
    . ' м), шасси выпущено, стоят, верх — от центра тела');
ok($climbed !== [] && max($climbed) > 2.0,
    'посидев, NPC взлетают: ' . count($climbed) . ' поднялись, выше всех на ' . round(max($climbed ?: [0]), 1) . ' км');

// --- видимость ------------------------------------------------------------------

$tr = new Traffic(new FakeOracle(), 5);
$eye = $space($deep);
$run($tr, [1 => $eye], 30, $t);
$list = $tr->all();
$npc = $list ? reset($list) : null;
$rowOf = static function (array $rows, int $id): ?array {
    foreach ($rows as $r) {
        if ($r['id'] === $id) {
            return $r;
        }
    }
    return null;
};
$vis = [];
$first = $npc ? $rowOf($tr->rowsFor($eye, $vis, $t), $npc->id) : null;
$second = $npc ? $rowOf($tr->rowsFor($eye, $vis, $t), $npc->id) : null;
ok($first !== null && $first['npc'] === 1 && $first['id'] < 0 && $first['by'] === null
    && isset($first['eq'], $first['x'], $first['fx']) && $second !== null && !isset($second['eq']),
    'в снимке NPC — строка корабля с npc:1, номером ' . ($first['id'] ?? '?') . ' и без хозяина; '
    . 'снаряжение — только при первом показе');
$at = static fn(float $km) => $space(Vec::madd($npc->p, [1.0, 0.0, 0.0], $km));
$vis = [];
$seen = [];
foreach ([70.0, 90.0, 101.0, 90.0, 79.0] as $km) {
    $seen[] = $rowOf($tr->rowsFor($at($km), $vis, $t), $npc->id) !== null ? 1 : 0;
}
ok($seen === [1, 1, 0, 0, 1],
    'локатор: виден ближе ' . Traffic::SEE_KM . ' км, пропадает дальше ' . Traffic::HIDE_KM
    . ' км, а пропавший показывается снова только ближе ' . Traffic::SEE_KM . ' (70/90/101/90/79 км: '
    . implode('', $seen) . ')');

// --- через хаб: снимок, попадания, гибель, уход ---------------------------------

$t += 1000;
$traffic = new Traffic(new FakeOracle(), 9);
$hubN = new Hub(null, $traffic);
$cn = new FakeConn('npc-a');
$hubN->open($cn, $t);
$hubN->message($cn, json_encode(['t' => 'hello', 'token' => $a['token']]), $t);
$w = $cn->last('welcome');
$sid = (int) ($w['you']['ship'] ?? 0);
ok(($w['npc']['see'] ?? 0) == Traffic::SEE_KM && ($w['npc']['hide'] ?? 0) == Traffic::HIDE_KM,
    'при входе игра узнаёт дальность локатора для NPC');
Db::update('ship', ['hull' => 100, 'shield' => 0, 'hit_at' => null], '`id`=?', [$sid]);

$posA = static function (array $p) use ($hubN, $cn, $sid, &$t): void {
    $hubN->message($cn, json_encode(['t' => 'pos', 'sys' => 0, 'sid' => $sid, 'x' => $p[0], 'y' => $p[1],
        'z' => $p[2], 'v' => 0.1, 'mode' => 'flight']), $t);
};
$npcRows = static function (?array $msg): array {
    return $msg ? array_values(array_filter($msg['list'], static fn($r) => !empty($r['npc']))) : [];
};
$firstSeen = null;
$leaves = 0;
for ($i = 0; $i < 300 && $firstSeen === null; $i++) {
    $t += 0.2;
    $posA($deep);
    $hubN->tick($t);
    $rows = $npcRows($cn->last('peers'));
    $firstSeen = $rows[0] ?? null;
}
ok($firstSeen !== null && !empty($firstSeen['qx']) && isset($firstSeen['eq']),
    'NPC приходит в снимок пилота сам, с пометкой «только что из прыжка» (qx) и снаряжением');

// Подлетели в упор и стреляем. Мишень — торговец: крейсер за полминуты
// огня успел бы уйти прыжком.
$target = null;
for ($i = 0; $i < 600 && $target === null; $i++) {
    $t += 0.2;
    $posA($deep);
    $hubN->tick($t);
    foreach ($npcRows($cn->last('peers')) as $r) {
        if ($r['ty'] === 'challenger') {
            $target = $r['id'];
        }
    }
}
$victim = $target !== null ? $traffic->get($target) : null;
$beside = static fn() => Vec::madd($victim->p, [0.0, 1.0, 0.0], 1.5);
$hit = static function () use ($hubN, $cn, $target, &$t): ?array {
    $n = count($cn->sent);
    $hubN->message($cn, json_encode(['t' => 'hit', 'id' => $target, 'w' => 'laser_g']), $t);
    // Ответ на попадание — hitok; при гибели за ним следом идёт boom.
    foreach (array_slice($cn->sent, $n) as $m) {
        if (($m['t'] ?? '') === 'hitok') {
            return $m;
        }
    }
    return null;
};
$posA($victim ? Vec::madd($victim->p, [0.0, 1.0, 0.0], 6.0) : $deep);
$t += 0.5;
$far = $victim ? $hit() : null;
$t += 0.5;
$posA($victim ? $beside() : $deep);
$h1 = $victim ? $hit() : null;
ok($victim !== null && $far === null && ($h1['t'] ?? '') === 'hitok' && $h1['id'] === $target
    && $h1['absorbed'] > 0 && $h1['shield'] < $victim->shieldMax && $h1['hull'] == $victim->hullMax,
    'попадание по NPC считает хаб: с 6 км — мимо дальности, в упор — щит принял '
    . ($h1['absorbed'] ?? '?') . ', корпус цел');
ok($victim !== null && $victim->fleeing && (($victim->task ?? $victim->plan[0] ?? [])['k'] ?? '') === 'flee',
    'NPC без оружия от боя уходит: бежит на форсаже, чтобы уйти прыжком');

$dead = null;
for ($i = 0; $i < 400 && $dead === null && $victim !== null; $i++) {
    $t += 0.13;
    $hubN->tick($t);
    $posA($beside());
    $r = $hit();
    if ($r !== null && !empty($r['dead'])) {
        $dead = $r;
    }
}
$boom = $cn->last('boom');
ok($dead !== null && ($boom['id'] ?? 0) === $target && !empty($boom['npc']) && $traffic->get($target) === null,
    'добит за ' . $i . ' попаданий: «цель уничтожена», весть о гибели (boom, npc) — и NPC больше нет');
$t += 0.2;
$posA($deep);
$hubN->tick($t);
ok(!in_array($target, array_column($npcRows($cn->last('peers')), 'id'), true),
    'погибшего NPC в снимке больше нет');

// Ушедшего прыжком провожают вспышкой те, кто его видел.
$seenTo = count($cn->sent);
for ($i = 0; $i < 8000 && $leaves === 0; $i++) {
    $t += 0.2;
    $posA($deep);
    $hubN->tick($t);
    foreach (array_slice($cn->sent, $seenTo) as $m) {
        if (($m['t'] ?? '') === 'leave' && !empty($m['q']) && ($m['ship'] ?? 0) < 0) {
            $leaves++;
        }
    }
    $seenTo = count($cn->sent);
}
ok($leaves > 0, 'NPC, ушедший прыжком на глазах у пилота, — это leave с q (вспышка ухода)');
$hubN->close($cn, $t);

// --- настоящий оракул ---------------------------------------------------------

$oracle = getenv('SOLAR_NODE') ? Oracle::spawn() : null;
if ($oracle === null) {
    ok(getenv('SOLAR_NODE') === false, 'оракул рельефа: Node не указан (SOLAR_NODE) — проверка пропущена');
} else {
    // Станции — там же, где у игры: орбиты сервер считает сам.
    $trO = new Traffic(null, 1);
    $worst = 0.0;
    foreach (Db::all("SELECT `local_id` FROM `body` WHERE `system_id`=0 AND `kind` IN ('station','moon','planet')") as $row) {
        foreach ([0.0, 3.7e5, 4.1e7] as $at) {
            $js = $oracle->ask(['t' => 'pos', 'sys' => 0, 'body' => (int) $row['local_id'], 'wt' => $at]);
            $worst = max($worst, Vec::dist($js['p'] ?? [INF, 0, 0], $trO->posAt(0, (int) $row['local_id'], $at)));
        }
    }
    ok($worst < 0.01, 'тела системы у сервера (Traffic::posAt) стоят там же, где у игры (bodyPosAt): '
        . 'расхождение до ' . round($worst * 1000, 3) . ' м на трёх моментах мира');

    // Вся цепочка на настоящем рельефе: пилот стоит на Lave II, NPC садится
    // рядом — и стоит центром ровно на высоте своих стоек над грунтом в
    // точке посадки, по нормали площадки.
    $real = new Traffic($oracle, 12);
    $here = $oracle->site(0, 3, [0.3, 0.5, 0.81], 3.0);
    $stand = [1 => $low(Vec::scale(Vec::unit($here['dir']), $here['r'] + 0.002))];
    $sat = null;
    for ($i = 0; $i < 3000 && $sat === null; $i++) {
        $t += 0.2;
        $real->step($t, $stand);
        foreach ($real->all() as $n) {
            if ($n->mode === 'landed') {
                $sat = $n;
            }
        }
    }
    $gap = null;
    if ($sat !== null) {
        $d = Vec::unit($sat->p);
        $g = $oracle->ask(['t' => 'ground', 'sys' => 0, 'body' => 3, 'dir' => $d]);
        // Центр — на высоте стоек по нормали; по радиусу это чуть меньше
        // на склоне, поэтому меряем сам отрезок до грунта под площадкой.
        $gap = Vec::len($sat->p) - (float) $g['r'];
    }
    ok($sat !== null && $gap !== null && $gap > $sat->gearClear * 0.97 && $gap < $sat->gearClear * 1.03
        && Vec::dist($sat->p, $stand[1]['l']) > Traffic::PAD_CLEAR,
        'на настоящем рельефе NPC ' . ($sat ? $sat->name : '—') . ' сел в '
        . ($sat ? round(Vec::dist($sat->p, $stand[1]['l']), 1) : '?') . ' км от пилота: центр над грунтом на '
        . ($gap !== null ? round($gap * 1000, 1) : '?') . ' м при стойках ' . ($sat ? round($sat->gearClear * 1000, 1) : '?') . ' м');
    $ty = $oracle->types();
    $site = $oracle->site(0, 3, [0.3, 0.5, 0.81], 3.0);
    $gas = $oracle->site(0, 9, [0.3, 0.5, 0.81], 3.0);
    $area = $oracle->area(0, 3, [0.3, 0.5, 0.81], 60.0);
    ok(isset($ty['challenger']['gear'], $ty['prometheus']['gear'])
        && $ty['prometheus']['gear'] > $ty['challenger']['gear']
        && $site !== null && abs(Vec::len($site['dir']) - 1) < 1e-6 && $site['r'] > $R3 && $site['r'] < $R3 * 1.02
        && $site['slope'] <= 0.2 && $gas === null && $area !== null && $area['top'] >= $site['r'] - 50,
        'оракул рельефа (Node, код мира игры): стойки корпусов, сухая ровная площадка на Lave II в '
        . round($site['r'] - $R3, 2) . ' км над радиусом, у газового гиганта площадок нет');
    $oracle->close();
}
