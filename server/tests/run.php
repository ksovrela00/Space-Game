<?php
/**
 * Проверки сервера.
 *
 * Работают на ОТДЕЛЬНОЙ базе (solar_trader_test) и сносят её в начале
 * каждого прогона: проверка, которая зависит от того, что осталось с
 * прошлого раза, рано или поздно начинает врать в обе стороны.
 *
 *   php server/tests/run.php
 *
 * Обращения идут через Api::call — тот же разбор маршрутов и тот же
 * разбор токена, что и по HTTP, но без Apache. Поднимать веб-сервер ради
 * проверок значит проверять заодно его настройку и падать по причинам, к
 * игре отношения не имеющим; HTTP-слой тонкий и проверяется отдельно,
 * руками или из браузера.
 */

putenv('SOLAR_DB=solar_trader_test');
require_once __DIR__ . '/../boot.php';

$fails = 0;
$checks = 0;
function ok(bool $cond, string $msg): void
{
    global $fails, $checks;
    $checks++;
    if (!$cond) {
        $fails++;
    }
    echo ($cond ? '  OK   ' : '  FAIL ') . $msg . PHP_EOL;
}

/** Ожидаем отказ с конкретным кодом: «просто упало» — не проверка. */
function denies(string $code, callable $fn, string $msg): void
{
    try {
        $fn();
        ok(false, $msg . ' -> отказа не было');
    } catch (ApiError $e) {
        ok($e->slug === $code, $msg . ' -> ' . $e->slug . ' («' . $e->getMessage() . '»)');
    }
}

function section(string $title): void
{
    echo PHP_EOL . '== ' . $title . ' ==' . PHP_EOL;
}

// --- подготовка --------------------------------------------------------------

section('база и схема');

Db::use(Schema::ensureDatabase('solar_trader_test'));
Schema::reset();
ok(count(Db::all('SHOW TABLES')) === count(Schema::tables()),
    'все таблицы созданы: ' . count(Schema::tables()));

$again = Schema::migrate();
ok($again === [], 'повторная миграция ничего не создаёт заново');

$catalog = Seeder::readCatalog(__DIR__ . '/../data/catalog.json');
$n = Seeder::all($catalog, true);

$systems = (int) Db::one('SELECT COUNT(*) FROM `star_system`');
$bodies = (int) Db::one('SELECT COUNT(*) FROM `body`');
ok($systems === count($catalog['systems']) && $bodies === $n['body'],
    "каталог залит: систем $systems, тел $bodies");

// ИДЕМПОТЕНТНОСТЬ. Заливка гоняется при каждом обновлении каталога, и
// вторая заливка не должна ни плодить тела, ни менять их id: на id
// ссылаются рынок и задания.
$idsBefore = Db::all('SELECT `id`,`system_id`,`local_id` FROM `body` ORDER BY `id`');
Seeder::catalog($catalog);
$idsAfter = Db::all('SELECT `id`,`system_id`,`local_id` FROM `body` ORDER BY `id`');
ok($idsBefore === $idsAfter && (int) Db::one('SELECT COUNT(*) FROM `body`') === $bodies,
    'повторная заливка каталога не плодит тела и не сдвигает их id');

ok((int) Db::one("SELECT COUNT(*) FROM `body` WHERE `kind`='star'") === $systems,
    'у каждой системы ровно одна звезда');

// --- рынок -------------------------------------------------------------------

section('рынок');

$stations = (int) Db::one("SELECT COUNT(*) FROM `body` WHERE `kind`='station'");
$withMarket = (int) Db::one('SELECT COUNT(DISTINCT `station_id`) FROM `market`');
ok($stations > 0 && $stations === $withMarket, "склад есть у всех $stations станций");

// ПЕРЕПОЛНЕНИЕ. Хеш цен считается целочисленно, и выход за пределы
// 64-битного целого превращает его в число с плавающей точкой: результат
// перестаёт быть одинаковым на разных машинах, а цена — тем, что игрок
// увидел. Ловим это предупреждением, поднятым до ошибки.
$warned = [];
set_error_handler(function ($no, $msg) use (&$warned) {
    $warned[] = $msg;
    return true;
});
$vals = [];
// Входы намеренно разные В ПРЕДЕЛАХ 31 бита: хеш берёт остаток по
// 2^31, и числа, отличающиеся ровно на 2^31, обязаны дать один ответ —
// это свойство обрезки, а не слипание.
foreach ([0, 1, 12345, 987654321, 21072145958, 1234567890] as $n) {
    $v = Content::hash($n);
    $vals[] = $v;
    if ($v < 0 || $v >= 1) {
        $warned[] = 'hash(' . $n . ') = ' . $v . ' вне 0..1';
    }
}
restore_error_handler();
ok($warned === [], 'хеш цен считается без переполнения на всех входах'
    . ($warned ? ': ' . $warned[0] : ''));
ok(count(array_unique($vals)) === count($vals), 'хеш цен не слипается на разных входах');

// Товар дёшев там, где его производят, и дорог там, где ждут. На этом
// держится вся торговля: не будет разницы — не будет и смысла возить.
$water = Db::row("SELECT * FROM `commodity` WHERE `code`='water'");
$cheap = Db::row(
    "SELECT m.`price`, m.`stock` FROM `market` m
     JOIN `body` s ON s.`id`=m.`station_id`
     JOIN `body` p ON p.`system_id`=s.`system_id` AND p.`local_id`=s.`parent_local_id`
     WHERE m.`commodity_id`=? AND p.`type`='ice' LIMIT 1",
    [$water['id']]
);
$dear = Db::row(
    "SELECT m.`price`, m.`stock` FROM `market` m
     JOIN `body` s ON s.`id`=m.`station_id`
     JOIN `body` p ON p.`system_id`=s.`system_id` AND p.`local_id`=s.`parent_local_id`
     WHERE m.`commodity_id`=? AND p.`type` IN ('desert','lava') LIMIT 1",
    [$water['id']]
);
if ($cheap && $dear) {
    ok((int) $cheap['price'] < (int) $dear['price'] && (float) $cheap['stock'] > 0
        && (float) $dear['stock'] == 0.0,
        'вода у ледяного мира дешевле (' . $cheap['price'] . ') и есть на складе, '
        . 'у пустынного дороже (' . $dear['price'] . ') и склада нет');
} else {
    ok(false, 'в каталоге не нашлось пары «производит / ждёт» для воды');
}

ok((int) Db::one("SELECT COUNT(*) FROM `market` m JOIN `commodity` c ON c.`id`=m.`commodity_id`
                  JOIN `body` s ON s.`id`=m.`station_id`
                  JOIN `body` p ON p.`system_id`=s.`system_id` AND p.`local_id`=s.`parent_local_id`
                  WHERE c.`legal`=0 AND p.`type`='ocean'") === 0,
    'запрещённый товар не выставлен на обжитых мирах');

// --- вход --------------------------------------------------------------------

section('учётные записи');

denies('bad_request', fn() => Api::call('auth.register', ['login' => 'a', 'pass' => 'secret']),
    'слишком короткий логин не принимается');
denies('bad_request', fn() => Api::call('auth.register', ['login' => 'pilot', 'pass' => '1']),
    'слишком короткий пароль не принимается');

$reg = Api::call('auth.register', ['login' => 'pilot', 'pass' => 'secret', 'name' => 'ПИЛОТ']);
$token = $reg['token'];
$pid = $reg['player_id'];
ok(strlen($token) === 64 && $pid > 0, 'регистрация выдала токен и игрока #' . $pid);

denies('login_taken', fn() => Api::call('auth.register', ['login' => 'pilot', 'pass' => 'secret']),
    'логин занят');
denies('auth', fn() => Api::call('auth.login', ['login' => 'pilot', 'pass' => 'nope']),
    'неверный пароль не пускает');

$again = Api::call('auth.login', ['login' => 'pilot', 'pass' => 'secret']);
ok($again['player_id'] === $pid && $again['token'] !== $token, 'вход выдаёт новый токен тому же игроку');

// Маршруты игрока без токена не работают — это проверяется на самом
// списке маршрутов, а не на одном примере: забыть флаг у нового вызова
// куда легче, чем написать его.
$unguarded = [];
foreach (Api::routes() as $name => [$fn, $needsAuth]) {
    $isPublic = in_array($name, ['ping', 'auth.register', 'auth.login',
        'galaxy.systems', 'galaxy.system', 'galaxy.stations', 'station.info',
        'catalog.commodities', 'catalog.ships'], true);
    if (!$isPublic && !$needsAuth) {
        $unguarded[] = $name;
    }
}
ok($unguarded === [], 'все игровые маршруты требуют входа' . ($unguarded ? ': ' . implode(', ', $unguarded) : ''));
denies('auth', fn() => Api::call('player.state', [], null), 'без токена состояние не отдаётся');
denies('auth', fn() => Api::call('player.state', [], str_repeat('0', 64)), 'чужой токен не работает');

// Просроченная сессия не работает и убирается. Без проверки срока токен
// живёт вечно, а «выйти со всех устройств» перестаёт что-либо значить.
$stale = Auth::openSession($pid);
Db::update('session', ['expires_at' => Db::at(-60)], '`token`=?', [$stale]);
denies('auth', fn() => Api::call('player.state', [], $stale), 'просроченный токен не пускает');
ok(Db::one('SELECT `token` FROM `session` WHERE `token`=?', [$stale]) === null,
    'просроченная сессия удалена из базы');

// --- новый пилот -------------------------------------------------------------

section('новый пилот');

$state = Api::call('player.state', [], $token);
ok($state['player']['balance'] === Content::START_BALANCE,
    'стартовый капитал ' . $state['player']['balance'] . ' кр');
ok(count($state['ledger']) === 1 && $state['ledger'][0]['amount'] === Content::START_BALANCE,
    'капитал пришёл строкой в ленте, а не присвоением баланса');
ok($state['ship']['type']['code'] === 'challenger'
    && $state['ship']['hull'] === $state['ship']['type']['hullMax']
    && count($state['ship']['equipment']) === 11,
    'корабль с завода: ' . $state['ship']['type']['name'] . ', модулей '
    . count($state['ship']['equipment']));
ok($state['position']['dockedBody'] !== null && $state['position']['systemId'] === 0,
    'пилот стоит в порту родной системы');
ok($state['cargo'] === [] && $state['holdUsedT'] === 0.0, 'трюм пуст');

// Время мира приходит вместе с состоянием и одно на всех: от него идут
// орбиты планет и станций. Пока его здесь не было, клиент подставлял
// налёт пилота — и два человека, стоя рядом, видели станцию в разных
// местах.
ok(isset($state['world']['time']) && is_numeric($state['world']['time'])
    && abs($state['world']['time'] - Clock::worldTime()) < 2,
    'состояние несёт время мира: ' . ($state['world']['time'] ?? '—') . ' с');
$again = Api::call('player.state', [], $token);
ok($again['world']['time'] >= $state['world']['time'],
    'часы мира идут вперёд, а не начинаются заново при каждом запросе');

// Числа корабля в базе — те же, что в игре: карточка корабля и сервер
// обязаны говорить об одном и том же железе.
$shipType = $catalog['shipTypes'][0];
ok(abs($state['ship']['type']['maxSpeed'] - $shipType['maxSpeed']) < 1e-9
    && abs($state['ship']['type']['holdT'] - $shipType['holdT']) < 1e-9
    && abs($state['ship']['type']['lengthM'] - $shipType['lengthM']) < 1e-6,
    'характеристики корабля совпадают с выгрузкой из игры');

// --- сохранение полёта -------------------------------------------------------

section('сохранение полёта');

$home = $state['position'];
Api::call('player.save', ['system' => 0, 'pos' => ['x' => 1000, 'y' => 20, 'z' => -3],
    'basis' => ['fwd' => [0, 0, 1]], 'docked' => null, 'hull' => 61.5,
    'stats' => ['flownKm' => 123.5, 'docks' => 2]], $token);
$after = Api::call('player.state', [], $token);
ok(abs($after['position']['pos']['x'] - 1000) < 1e-9 && $after['position']['dockedBody'] === null
    && abs($after['ship']['hull'] - 61.5) < 1e-9 && $after['player']['stats']['docks'] === 2,
    'полёт сохранён: место, корпус, статистика');

denies('bad_request', fn() => Api::call('player.save', ['system' => 999], $token),
    'система не из каталога отвергается');
denies('bad_request', fn() => Api::call('player.save', ['system' => 0, 'docked' => 9999], $token),
    'порт не из этой системы отвергается');

// Корпус выше заводского — первое, что подделывают.
Api::call('player.save', ['hull' => 100000], $token);
$after = Api::call('player.state', [], $token);
ok($after['ship']['hull'] === $after['ship']['type']['hullMax'],
    'корпус выше заводского обрезается до ' . $after['ship']['type']['hullMax']);

// --- торговля ----------------------------------------------------------------

section('торговля');

// Возвращаем пилота в порт.
Api::call('player.save', ['system' => 0, 'docked' => $home['dockedBody'], 'hull' => 100], $token);
$prices = Api::call('market.prices', [], $token);
ok(count($prices['goods']) > 3, 'прайс порта: позиций ' . count($prices['goods'])
    . ' у «' . $prices['station']['name'] . '» (' . $prices['station']['world'] . ')');

$good = null;
foreach ($prices['goods'] as $g) {
    if ($g['stock'] >= 5) {
        $good = $g;
        break;
    }
}
ok($good !== null, 'на складе есть что купить: ' . ($good['name'] ?? '—'));

$before = Api::call('player.state', [], $token)['player']['balance'];
$buy = Api::call('market.buy', ['code' => $good['code'], 'tons' => 4], $token);
ok($buy['balance'] === $before - $good['price'] * 4
    && abs($buy['holdUsedT'] - 4) < 1e-9,
    'покупка: 4 т по ' . $good['price'] . ' кр, баланс ' . $before . ' -> ' . $buy['balance']);

$stockNow = null;
foreach (Api::call('market.prices', [], $token)['goods'] as $g) {
    if ($g['code'] === $good['code']) {
        $stockNow = $g['stock'];
    }
}
ok(abs($stockNow - ($good['stock'] - 4)) < 1e-9,
    'склад станции уменьшился: ' . $good['stock'] . ' -> ' . $stockNow);

// Чтобы проверять ТРЮМ, а не склад, склад надо сделать заведомо большим:
// иначе покупка упирается в «на складе только столько», и проверка молча
// проверяет не то, что написано в её названии (на этом она и попалась).
$stationId = (int) Db::one("SELECT b.`id` FROM `body` b JOIN `player` p ON p.`docked_body`=b.`local_id`
                           AND p.`system_id`=b.`system_id` WHERE p.`id`=?", [$pid]);
$goodId = (int) Db::one('SELECT `id` FROM `commodity` WHERE `code`=?', [$good['code']]);
Db::update('market', ['stock' => 999], '`station_id`=? AND `commodity_id`=?', [$stationId, $goodId]);
denies('no_room', fn() => Api::call('market.buy', ['code' => $good['code'], 'tons' => 500], $token),
    'в трюм больше ёмкости не влезает');
denies('bad_request', fn() => Api::call('market.buy', ['code' => $good['code'], 'tons' => 0], $token),
    'нулевая сделка не проходит');
denies('not_found', fn() => Api::call('market.buy', ['code' => 'unobtanium', 'tons' => 1], $token),
    'несуществующий товар');

// Не хватает денег. Берём самый дорогой товар порта и ровно тот тоннаж,
// который в трюм ВЛЕЗАЕТ: иначе отказ пришёл бы по месту, а не по
// деньгам, и проверка снова проверяла бы не то.
$rich = $prices['goods'][count($prices['goods']) - 1];
$richId = (int) Db::one('SELECT `id` FROM `commodity` WHERE `code`=?', [$rich['code']]);
Db::update('market', ['stock' => 999], '`station_id`=? AND `commodity_id`=?', [$stationId, $richId]);
// Берём ровно СВОБОДНЫЙ тоннаж, а не всю ёмкость: в трюме уже лежит
// купленное выше, и на полной ёмкости отказ снова пришёл бы по месту.
$st = Api::call('player.state', [], $token);
$free = $st['ship']['type']['holdT'] - $st['holdUsedT'];
ok($rich['price'] * $free > Content::START_BALANCE,
    'свободный трюм «' . $rich['name'] . '» дороже стартового капитала: '
    . (int) ($rich['price'] * $free) . ' кр за ' . $free . ' т');
denies('no_funds', fn() => Api::call('market.buy',
    ['code' => $rich['code'], 'tons' => $free], $token), 'не хватает крон');

$sell = Api::call('market.sell', ['code' => $good['code'], 'tons' => 4], $token);
ok(abs($sell['holdUsedT']) < 1e-9 && $sell['balance'] === $buy['balance'] + $good['price'] * 4,
    'продажа вернула груз на склад и деньги в баланс');

denies('no_cargo', fn() => Api::call('market.sell', ['code' => $good['code'], 'tons' => 1], $token),
    'продать то, чего нет в трюме, нельзя');

// Не в порту — не торгуем.
Api::call('player.save', ['system' => 0, 'docked' => null], $token);
denies('not_docked', fn() => Api::call('market.buy', ['code' => $good['code'], 'tons' => 1], $token),
    'из космоса торговать нельзя');
Api::call('player.save', ['system' => 0, 'docked' => $home['dockedBody']], $token);

// --- деньги сходятся ---------------------------------------------------------

section('деньги');

$sum = (int) Db::one('SELECT COALESCE(SUM(`amount`),0) FROM `ledger` WHERE `player_id`=?', [$pid]);
$balance = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
ok($sum === $balance, "баланс сходится с лентой: $balance = сумма всех операций");

$last = Db::row('SELECT `balance_after` FROM `ledger` WHERE `player_id`=? ORDER BY `id` DESC LIMIT 1', [$pid]);
ok((int) $last['balance_after'] === $balance, 'последняя строка ленты помнит тот же баланс');

// --- задания -----------------------------------------------------------------

section('задания');

$board = Api::call('missions.board', [], $token)['board'];
ok(count($board) === Missions::BOARD_SIZE, 'доска порта: подрядов ' . count($board));

$again = Api::call('missions.board', [], $token)['board'];
ok(count($again) === Missions::BOARD_SIZE, 'повторный взгляд на доску не плодит подряды');

$m = $board[0];
ok($m['reward'] > 0 && $m['tons'] > 0 && $m['target'] !== null && $m['commodity'] !== null,
    'подряд: «' . $m['title'] . '», ' . $m['tons'] . ' т ' . $m['commodity']['name']
    . ' за ' . $m['reward'] . ' кр');

$taken = Api::call('missions.accept', ['id' => $m['id']], $token)['mission'];
$state = Api::call('player.state', [], $token);
ok($taken['state'] === 'active' && abs($state['holdUsedT'] - $m['tons']) < 1e-9,
    'подряд взят, груз выдан в трюм: ' . $state['holdUsedT'] . ' т');

denies('taken', fn() => Api::call('missions.accept', ['id' => $m['id']], $token),
    'взятый подряд нельзя взять второй раз');

denies('wrong_station', fn() => Api::call('missions.complete', ['id' => $m['id']], $token),
    'сдать подряд в порту отправления нельзя');

// Перелетаем в порт назначения и сдаём.
Api::call('player.save', [
    'system' => $m['target']['systemId'], 'docked' => $m['target']['localId'],
], $token);
$done = Api::call('missions.complete', ['id' => $m['id']], $token);
$state = Api::call('player.state', [], $token);
ok($done['reward'] === $m['reward'] && abs($state['holdUsedT']) < 1e-9,
    'подряд сдан: награда ' . $done['reward'] . ' кр, трюм пуст');

// Просрочка: срок обязан истекать и без участия игрока.
Api::call('player.save', ['system' => 0, 'docked' => $home['dockedBody']], $token);
$board = Api::call('missions.board', [], $token)['board'];
$m2 = null;
foreach ($board as $cand) {
    if ($cand['tons'] <= 8) {
        $m2 = $cand;
        break;
    }
}
$taken2 = Api::call('missions.accept', ['id' => $m2['id']], $token)['mission'];
Db::update('mission', ['deadline_at' => Db::at(-60)], '`id`=?', [$m2['id']]);
$balanceBefore = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
$mine = Api::call('player.state', [], $token)['missions'];
$failed = null;
foreach ($mine as $x) {
    if ($x['id'] === $m2['id']) {
        $failed = $x;
    }
}
$balanceAfter = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
ok($failed !== null && $failed['state'] === 'failed'
    && $balanceAfter === $balanceBefore - $m2['penalty'],
    'просроченный подряд закрылся сам и взял штраф ' . $m2['penalty'] . ' кр');

$sum = (int) Db::one('SELECT COALESCE(SUM(`amount`),0) FROM `ledger` WHERE `player_id`=?', [$pid]);
ok($sum === $balanceAfter, 'после наград и штрафов баланс всё ещё сходится с лентой');

// --- порты -------------------------------------------------------------------

section('порты');

$ports = (int) Db::one('SELECT COUNT(*) FROM `station`');
ok($ports === $stations, "свойства есть у всех $ports портов");
ok((int) Db::one('SELECT COUNT(*) FROM `station` WHERE `tech` < 1 OR `tech` > 5') === 0,
    'уровень техники у всех в пределах 1–5');

// Столица системы обязана быть развитее рудника: ради этой разницы
// уровень техники и заведён — иначе все порты одинаковы и лететь дальше
// незачем.
$best = Db::row("SELECT st.`tech`, st.`name` FROM `station` st ORDER BY st.`tech` DESC LIMIT 1");
$worst = Db::row("SELECT st.`tech`, st.`name` FROM `station` st ORDER BY st.`tech` ASC LIMIT 1");
ok((int) $best['tech'] > (int) $worst['tech'],
    'порты различаются: «' . $best['name'] . '» тех ' . $best['tech']
    . ' против «' . $worst['name'] . '» тех ' . $worst['tech']);
ok((int) Db::one('SELECT COUNT(*) FROM `station` WHERE `has_outfit`=1 AND `tech` < 4') === 0,
    'верфь стоит только на развитых портах');

// СТЫКОВКА СО СБОРОМ. Первый постоянный расход в игре.
Api::call('player.save', ['system' => 0, 'docked' => null], $token);
$port = Api::call('station.info', ['system' => 0, 'station' => $home['dockedBody']])['station'];
$before = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
$dock = Api::call('station.dock', ['system' => 0, 'station' => $home['dockedBody']], $token);
ok($dock['charged'] === true && $dock['balance'] === $before - $port['fee'],
    'стыковка взяла сбор ' . $port['fee'] . ' кр в «' . $port['name'] . '»');
ok(Db::one("SELECT `label` FROM `ledger` WHERE `player_id`=? ORDER BY `id` DESC LIMIT 1", [$pid])
    !== null && str_contains((string) Db::one(
        "SELECT `label` FROM `ledger` WHERE `player_id`=? ORDER BY `id` DESC LIMIT 1", [$pid]),
        'СТЫКОВОЧНЫЙ СБОР'),
    'сбор виден строкой в ленте');

// Повторный вызов не должен обчищать игрока: клиент переспрашивает при
// потере связи, и это нормальное поведение, а не ошибка.
$twice = Api::call('station.dock', ['system' => 0, 'station' => $home['dockedBody']], $token);
ok($twice['charged'] === false && $twice['fee'] === 0,
    'повторная стыковка в том же порту сбор не берёт');

// РЕМОНТ. До сих пор стыковка чинила корабль даром — то есть у корпуса не
// было цены, и разбить его было не страшно.
denies('no_damage', fn() => Api::call('station.repair', [], $token), 'целый корпус чинить нечего');

Api::call('player.save', ['hull' => 55], $token);
$before = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
$fix = Api::call('station.repair', [], $token);
ok($fix['hull'] === 100.0 && $fix['cost'] > 0 && $fix['balance'] === $before - $fix['cost'],
    'ремонт: ' . $fix['repaired'] . '% корпуса за ' . $fix['cost'] . ' кр');

// Там, где чинить нечем, не чинят.
$poor = Db::row("SELECT b.`system_id`, b.`local_id`, st.`name`
                 FROM `station` st JOIN `body` b ON b.`id`=st.`body_id`
                 WHERE st.`has_repair`=0 LIMIT 1");
if ($poor) {
    Api::call('player.save', ['system' => (int) $poor['system_id'],
        'docked' => (int) $poor['local_id'], 'hull' => 40], $token);
    denies('no_service', fn() => Api::call('station.repair', [], $token),
        'на порту без мастерской («' . $poor['name'] . '») не чинят');
    Api::call('player.save', ['system' => 0, 'docked' => $home['dockedBody'], 'hull' => 100], $token);
} else {
    ok(false, 'не нашлось порта без мастерской — проверять отказ не на чем');
}

$sum = (int) Db::one('SELECT COALESCE(SUM(`amount`),0) FROM `ledger` WHERE `player_id`=?', [$pid]);
$balance = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
ok($sum === $balance, 'после сборов и ремонта баланс всё ещё сходится с лентой');

$list = Api::call('galaxy.stations', ['system' => 0])['stations'];
ok(count($list) === 4 && isset($list[0]['services']['outfit']),
    'список портов системы отдаётся с услугами: ' . count($list));

// --- каталог наружу ----------------------------------------------------------

section('каталог по сети');

$g = Api::call('galaxy.systems');
ok(count($g['systems']) === $systems && $g['systems'][0]['home'] === true,
    'галактика отдаётся целиком, родная система помечена');

$one = Api::call('galaxy.system', ['id' => 0]);
$kinds = [];
foreach ($one['bodies'] as $b) {
    $kinds[$b['kind']] = ($kinds[$b['kind']] ?? 0) + 1;
}
ok(($kinds['star'] ?? 0) === 1 && ($kinds['planet'] ?? 0) === 9 && ($kinds['station'] ?? 0) === 4,
    'родная система: звезда, планет ' . ($kinds['planet'] ?? 0) . ', станций ' . ($kinds['station'] ?? 0));

denies('not_found', fn() => Api::call('galaxy.system', ['id' => 999]), 'чужой номер системы');
denies('not_found', fn() => Api::call('ping.unknown'), 'несуществующий маршрут');

$ping = Api::call('ping');
ok($ping['systems'] === $systems && $ping['schema'] === Schema::VERSION,
    'ping отдаёт версию схемы ' . $ping['schema'] . ' и размер каталога');

// --- итог --------------------------------------------------------------------

echo PHP_EOL . ($fails === 0
    ? "ВСЕ ПРОВЕРКИ СЕРВЕРА ПРОЙДЕНЫ ($checks)"
    : "$fails ПРОВЕРОК УПАЛО из $checks") . PHP_EOL;
exit($fails ? 1 : 0);
