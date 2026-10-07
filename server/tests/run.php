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

// Имя теперь приходит с формы регистрации, то есть из чужих рук. Длинное
// в столбец не влезает вовсе: без обрезки человек получил бы на форме
// ошибку базы вместо учётной записи.
$longName = Api::call('auth.register', ['login' => 'longname', 'pass' => 'secret',
    'name' => str_repeat('А', 80) . "\n\t\x07"]);
$longState = Players::state($longName['player_id']);
ok(mb_strlen($longState['player']['name']) === 32
    && !preg_match('/[\x00-\x1f]/', $longState['player']['name']),
    'длинное имя обрезано до 32 знаков и без управляющих: «'
    . $longState['player']['name'] . '»');

// Имя пропустили — в игре видно логин, а не пустота. Форма регистрации
// держит имя необязательным именно поэтому.
$noName = Api::call('auth.register', ['login' => 'noname', 'pass' => 'secret', 'name' => '  ']);
ok(Players::state($noName['player_id'])['player']['name'] === 'noname',
    'без имени пилота зовут по логину');

$again = Api::call('auth.login', ['login' => 'pilot', 'pass' => 'secret']);
ok($again['player_id'] === $pid && $again['token'] !== $token, 'вход выдаёт новый токен тому же игроку');

// Маршруты игрока без токена не работают — это проверяется на самом
// списке маршрутов, а не на одном примере: забыть флаг у нового вызова
// куда легче, чем написать его.
$unguarded = [];
foreach (Api::routes() as $name => [$fn, $needsAuth]) {
    $isPublic = in_array($name, ['ping', 'auth.register', 'auth.login',
        'galaxy.systems', 'galaxy.system', 'galaxy.stations', 'station.info', 'station.layout',
        'catalog.commodities', 'catalog.ships', 'catalog.specs'], true);
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

// Характеристики корабля проверки спрашивают там же, где их спрашивает
// игра, — маршрутом `catalog.specs`. В состоянии игрока их больше нет, и
// это намеренно: один путь к числу вместо двух.
$specs = Api::call('catalog.specs');
// Лётная модель корабля СОБИРАЕТСЯ: корпус, а поверх него числа
// установленных модулей. Проверять по одному корпусу значило бы
// проверять половину корабля — скорости и щита у него своих нет.
$shipSpec = Specs::mergeFlight($specs['shipTypes'][0]['spec'], $specs['modules']);

$state = Api::call('player.state', [], $token);
ok($state['player']['balance'] === Content::START_BALANCE,
    'стартовый капитал ' . $state['player']['balance'] . ' кр');
ok(count($state['ledger']) === 1 && $state['ledger'][0]['amount'] === Content::START_BALANCE,
    'капитал пришёл строкой в ленте, а не присвоением баланса');
// Сколько модулей на заводском корабле — считаем ПО КАТАЛОГУ, а не
// числом: заводским объявляет каталог (`stock`), и каждый новый такой
// модуль обязан оказаться на корабле сам. Числом эта проверка ловила не
// «набор собран», а «набор не менялся».
$stock = (int) Db::one('SELECT COUNT(*) FROM `equipment_type` WHERE `stock`=1');
ok($state['ship']['type']['code'] === 'challenger'
    && $state['ship']['hull'] === $shipSpec['maxHull']
    && count($state['ship']['equipment']) === $stock,
    'корабль с завода: ' . $state['ship']['type']['name'] . ', модулей '
    . count($state['ship']['equipment']) . ' из ' . $stock . ' заводских');
// Пушка входит в заводскую комплектацию: безоружный пилот в мире, где
// стреляют, — это не «выбор игрока», а невозможность играть.
$guns = array_values(array_filter($state['ship']['equipment'],
    static fn($e) => $e['slot'] === 'gun'));
// Щит — такой же модуль, как и остальные, и он тоже с завода: бой без
// щита это бой, в котором первая же очередь снимает корпус.
ok($shipSpec['maxShield'] > 0
    && abs($state['ship']['shield'] - $shipSpec['maxShield']) < 1e-9,
    'щит с завода целый: ' . $state['ship']['shield'] . ' из '
    . $shipSpec['maxShield']);
ok(count($guns) === 1 && $guns[0]['code'] === 'laser_g'
    && (float) $guns[0]['spec']['damage'] > 0,
    'на корабле с завода стоит ' . ($guns[0]['name'] ?? '—'));
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

// Габариты корпуса приходят из выгрузки генератора: их диктует меш, а не
// настройка. Остальные числа корабля — из server/data/specs.php, и
// проверяются они отдельным разделом ниже.
ok(abs($state['ship']['type']['lengthM'] - $catalog['shipTypes'][0]['lengthM']) < 1e-6,
    'габариты корпуса совпадают с выгрузкой модели');

// --- сохранение полёта -------------------------------------------------------

section('сохранение полёта');

$home = $state['position'];
// Корпуса в сохранении нет и быть не может: игра сохраняет только то,
// что знает одна она, — где корабль, куда повёрнут, сколько налетал.
$hullWas = $state['ship']['hull'];
// Из порта выходят действием (station.undock), а не сохранением.
Api::call('station.undock', [], $token);
Api::call('player.save', ['system' => 0, 'pos' => ['x' => 1000, 'y' => 20, 'z' => -3],
    'basis' => ['fwd' => [0, 0, 1]],
    'stats' => ['flownKm' => 123.5, 'docks' => 2]], $token);
$after = Api::call('player.state', [], $token);
ok(abs($after['position']['pos']['x'] - 1000) < 1e-9 && $after['position']['dockedBody'] === null
    && $after['ship']['hull'] === $hullWas && $after['player']['stats']['docks'] === 2,
    'полёт сохранён: место и статистика, корпус не тронут');

// Место в полёте хранится В ОСЯХ ТЕЛА, рядом с которым корабль вышел из
// игры. Мировых координат мало: время мира идёт и без игрока, а грунт на
// экваторе идёт сотни метров в секунду — за час записанная точка
// оказывается в сотнях километров от того места, где игрок вышел, и у
// самой поверхности это гибель корабля при входе.
$anchor = ['id' => 7,
    'pos' => ['x' => 1.5, 'y' => 20.25, 'z' => -3.5],
    'fwd' => ['x' => 0, 'y' => -1, 'z' => 0],
    'up' => ['x' => 0, 'y' => 0, 'z' => 1]];
Api::call('player.save', ['system' => 0, 'anchor' => $anchor], $token);
$after = Api::call('player.state', [], $token);
$got = $after['position']['anchorPose'];
ok($after['position']['anchorBody'] === 7
    && abs($got['pos']['y'] - 20.25) < 1e-9 && abs($got['pos']['z'] + 3.5) < 1e-9
    && abs($got['fwd']['y'] + 1) < 1e-9 && abs($got['up']['z'] - 1) < 1e-9,
    'место в полёте вернулось в осях тела: девять чисел и номер тела');

denies('bad_request', fn() => Api::call('player.save',
    ['system' => 0, 'anchor' => array_merge($anchor, ['id' => 9999])], $token),
    'якорь у тела не из этой системы отвергается');

// Взлетел в космос — якоря больше нет, и место снова мировое.
Api::call('player.save', ['system' => 0, 'anchor' => null], $token);
$after = Api::call('player.state', [], $token);
ok($after['position']['anchorBody'] === null && $after['position']['anchorPose'] === null,
    'без тела рядом якорь снимается');

denies('bad_request', fn() => Api::call('player.save', ['system' => 999], $token),
    'система не из каталога отвергается');
// В порт сохранением не встают: это действие с ценой (station.dock), а
// сохранение идёт фоном и опаздывает.
Api::call('player.save', ['system' => 0, 'docked' => $home['dockedBody']], $token);
ok(Api::call('player.state', [], $token)['position']['dockedBody'] === null,
    'сохранение в порт не ставит: встают в него только стыковкой');

// КОРПУС ИЗ СОХРАНЕНИЯ НЕ ПИШЕТСЯ ВОВСЕ — ни в какую сторону.
//
// Сохранение приходит от игры, а игра живёт на чужой машине. Всё, что
// имеет цену, считает сервер: попадание (Combat::damage), удар о грунт
// (Combat::impact), ремонт за деньги (Stations::repair), гибель
// (Combat::respawn). Прими сервер корпус из сохранения — и бой не стоил
// бы ничего: снял очередь, сохранился, корпус целый.
$damaged = $after['ship']['hull'];
Api::call('player.save', ['hull' => 100000], $token);
$after = Api::call('player.state', [], $token);
ok($after['ship']['hull'] === $damaged,
    'корпус из сохранения не растёт: как был ' . $damaged . ', так и остался '
    . $after['ship']['hull']);

Api::call('player.save', ['hull' => 1], $token);
$after = Api::call('player.state', [], $token);
ok($after['ship']['hull'] === $damaged,
    'и не убывает: сохранение корпуса не касается вовсе (' . $after['ship']['hull'] . ')');

// УДАР О ГРУНТ. Игра шлёт ИЗМЕРЕНИЕ, урон считает сервер своими числами.
$was = $after['ship']['hull'];
$hit = Api::call('ship.impact',
    ['norm' => 0.050, 'slide' => 0, 'gear' => true, 'pose' => true], $token);
$after = Api::call('player.state', [], $token);
ok($hit['damage'] > 5 && $hit['damage'] < 20
    && abs($after['ship']['hull'] - ($was - $hit['damage'])) < 1e-9,
    'удар о грунт списал корпус сервером: −' . round($hit['damage'], 1) . '%, стало '
    . round($after['ship']['hull'], 1));

// Касание в допуске не стоит ничего — на то и амортизаторы.
$soft = Api::call('ship.impact',
    ['norm' => 0.010, 'slide' => 0, 'gear' => true, 'pose' => true], $token);
ok($soft['damage'] === 0.0, 'мягкое касание на шасси не стоит ничего');

// Формула одна и та же на обеих сторонах (js/game/landing.js). Сверяем в
// опорных точках: разойдись они, игра показывала бы один урон, а сервер
// списывал другой — и виноват всегда был бы сервер, потому что он прав.
$grid = [
    [0.050, 0.0, true, true, 11.11],
    [0.095, 0.0, true, true, 117.36],
    [0.001, 0.0, false, true, 5.0],
];
$bad = [];
foreach ($grid as [$norm, $slide, $gear, $pose, $want]) {
    $got = Combat::impactDamage($norm, $slide, $gear, $pose);
    if (abs($got - $want) > 0.05) {
        $bad[] = $norm . ' -> ' . round($got, 2) . ' вместо ' . $want;
    }
}
ok($bad === [], 'урон от удара считается по числам каталога, опорные точки сходятся'
    . ($bad ? ': ' . implode('; ', $bad) : ''));

// Возвращаем как было: следующие проверки считают деньги за ремонт от
// этого корпуса.
Db::update('ship', ['hull' => $damaged], '`owner_id`=?', [$pid]);

// --- торговля ----------------------------------------------------------------

section('торговля');

// Возвращаем пилота в порт. Корпус при этом чиним НЕ сохранением: из
// него он больше не растёт, и это правило проверяется выше. В игре целый
// корпус получают за деньги в порту, а проверке нужна лишь позиция.
Api::call('station.dock', ['system' => 0, 'station' => $home['dockedBody']], $token);
Db::update('ship', ['hull' => 100], '`owner_id`=?', [$pid]);
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
$stationId = (int) Db::one("SELECT b.`id` FROM `body` b JOIN `ship` s ON s.`docked_body`=b.`local_id`
                           AND s.`system_id`=b.`system_id` JOIN `player` p ON p.`ship_id`=s.`id`
                           WHERE p.`id`=?", [$pid]);
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
$free = $shipSpec['hold'] - $st['holdUsedT'];
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
Api::call('station.undock', [], $token);
denies('not_docked', fn() => Api::call('market.buy', ['code' => $good['code'], 'tons' => 1], $token),
    'из космоса торговать нельзя');
Api::call('station.dock', ['system' => 0, 'station' => $home['dockedBody']], $token);

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
Api::call('station.undock', [], $token);
Api::call('station.dock', ['system' => $m['target']['systemId'], 'station' => $m['target']['localId']], $token);
$done = Api::call('missions.complete', ['id' => $m['id']], $token);
$state = Api::call('player.state', [], $token);
ok($done['reward'] === $m['reward'] && abs($state['holdUsedT']) < 1e-9,
    'подряд сдан: награда ' . $done['reward'] . ' кр, трюм пуст');

// Просрочка: срок обязан истекать и без участия игрока.
Api::call('station.undock', [], $token);
Api::call('station.dock', ['system' => 0, 'station' => $home['dockedBody']], $token);
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
Api::call('station.undock', [], $token);
$undocked = Players::ship($pid);
ok($undocked['docked_body'] === null, 'вылет из порта — действием: корабль больше не в доке');
$again = Api::call('station.undock', [], $token);
ok($again['undocked'] === true, 'повторный вылет ничего не ломает: игра переспрашивает после обрыва');
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

// Корпус сохранением не правится: ставим состояние прямо, как и всюду в
// этих проверках, где нужна исходная позиция.
Db::update('ship', ['hull' => 55], '`owner_id`=?', [$pid]);
$before = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
$fix = Api::call('station.repair', [], $token);
ok($fix['hull'] === 100.0 && $fix['cost'] > 0 && $fix['balance'] === $before - $fix['cost'],
    'ремонт: ' . $fix['repaired'] . '% корпуса за ' . $fix['cost'] . ' кр');

// Там, где чинить нечем, не чинят.
$poor = Db::row("SELECT b.`system_id`, b.`local_id`, st.`name`
                 FROM `station` st JOIN `body` b ON b.`id`=st.`body_id`
                 WHERE st.`has_repair`=0 LIMIT 1");
if ($poor) {
    // Позиция — прямо в базу: проверке нужен порт, а не перелёт до него.
    Db::update('ship', ['system_id' => (int) $poor['system_id'], 'docked_body' => (int) $poor['local_id'],
        'hull' => 40], '`owner_id`=?', [$pid]);
    denies('no_service', fn() => Api::call('station.repair', [], $token),
        'на порту без мастерской («' . $poor['name'] . '») не чинят');
    Db::update('ship', ['system_id' => 0, 'docked_body' => $home['dockedBody'], 'hull' => 100],
        '`owner_id`=?', [$pid]);
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

// Города системы уходят вместе с телами: игра спрашивает систему один
// раз, при входе, и второго круга по сети ради городов делать не должна.
$cities = $one['cities'] ?? [];
$c0 = $cities[0] ?? null;
$host = null;
foreach ($one['bodies'] as $b) {
    if ($c0 !== null && (int) $b['localId'] === (int) $c0['bodyLocalId']) {
        $host = $b;
    }
}
ok(count($cities) === 1 && $host !== null && $host['landable'] && $host['pressBar'] == 0,
    'город родной системы отдаётся вместе с ней: ' . ($c0['name'] ?? '—')
    . ' на теле ' . ($host['name'] ?? '—'));

// Из записи город собирается целиком, значит в ней обязаны быть и семя,
// и место, и они обязаны быть осмысленными. Пустое семя означало бы
// город, который у каждого клиента свой.
$len = $c0 === null ? 0 : sqrt(
    $c0['dir']['x'] ** 2 + $c0['dir']['y'] ** 2 + $c0['dir']['z'] ** 2);
ok($c0 !== null && $c0['seed'] > 0 && abs($len - 1) < 1e-6
    && $c0['radiusKm'] > 1 && $c0['pads'] >= 2
    && in_array($c0['layout'], ['grid', 'ring', 'spine', 'spread'], true),
    'запись города полна: семя ' . ($c0['seed'] ?? 0) . ', схема ' . ($c0['layout'] ?? '—')
    . ', ' . round(($c0['radiusKm'] ?? 0) * 2, 1) . ' км поперёк, площадок ' . ($c0['pads'] ?? 0));

// Планировки в базе нет и быть не должно: пять тысяч построек выводятся
// из семени, а мегабайты в базе не нужны никому.
ok(!isset($c0['parts']) && !isset($c0['boxes']) && strlen(json_encode($c0)) < 400,
    'в записи города нет планировки: ' . strlen(json_encode($c0)) . ' байт');

denies('not_found', fn() => Api::call('galaxy.system', ['id' => 999]), 'чужой номер системы');
denies('not_found', fn() => Api::call('ping.unknown'), 'несуществующий маршрут');

$ping = Api::call('ping');
ok($ping['systems'] === $systems && $ping['schema'] === Schema::VERSION,
    'ping отдаёт версию схемы ' . $ping['schema'] . ' и размер каталога');

// --- дозаливка заводского набора ----------------------------------------------

section('гнёзда корабля');

$shipId = (int) Db::one('SELECT `id` FROM `ship` WHERE `owner_id`=?', [$pid]);
$slotRows = static fn(string $slot) => Db::all(
    'SELECT e.`code` FROM `ship_equipment` se JOIN `equipment_type` e ON e.`id`=se.`equipment_id`
     WHERE se.`ship_id`=? AND e.`slot`=?',
    [$shipId, $slot]
);

// 1. Дозаливка идемпотентна: сколько её ни зови, лишнего не появится.
$before = (int) Db::one('SELECT COUNT(*) FROM `ship_equipment` WHERE `ship_id`=?', [$shipId]);
Players::ensureStock($shipId);
Players::ensureStock($shipId);
$after = (int) Db::one('SELECT COUNT(*) FROM `ship_equipment` WHERE `ship_id`=?', [$shipId]);
ok($before === $after, "повторная дозаливка ничего не дописывает: $before -> $after");

// 2. Гнездо на два прибора так и остаётся на два. Докинг-компьютер и
//    посадочный — разные приборы в одном гнезде, и оба заводские.
ok(count($slotRows('computer')) === 2 && Specs::slotCap('computer') === 2,
    'в гнезде компьютеров оба прибора: ' . implode(', ', array_column($slotRows('computer'), 'code')));

// 3. ГЛАВНОЕ. Второй заводской ВАРИАНТ для занятого гнезда не должен
//    дозаливаться. Ёмкость считалась как «сколько заводских типов есть у
//    слота», и появление второго привода делало ёмкость двойкой: сервер
//    дозаливал кораблю второй привод при каждом запросе состояния, и
//    удалить лишнюю строку руками было нельзя — она возвращалась.
$driveBefore = $slotRows('drive');
Db::run(
    'INSERT INTO `equipment_type` (`code`,`name`,`slot`,`spec`,`price`,`stock`)
     VALUES (?,?,?,?,?,1) ON DUPLICATE KEY UPDATE `stock`=1',
    ['quantum_x', 'КВАНТОВЫЙ ПРИВОД X', 'drive', '{}', 99000]
);
Players::ensureStock($shipId);
$driveAfter = $slotRows('drive');
ok(count($driveAfter) === count($driveBefore) && count($driveAfter) === 1,
    'второй заводской привод в занятое гнездо не лезет: приводов '
    . count($driveAfter) . ' (' . implode(', ', array_column($driveAfter, 'code')) . ')');

// 4. А пустое гнездо дозаливается — ради этого всё и заведено: так в
//    старые корабли попали щиты и пушка, когда их добавили в каталог.
Db::run('DELETE se FROM `ship_equipment` se JOIN `equipment_type` e ON e.`id`=se.`equipment_id`
         WHERE se.`ship_id`=? AND e.`slot`=?', [$shipId, 'shield']);
ok(count($slotRows('shield')) === 0, 'щит снят для проверки');
Players::ensureStock($shipId);
ok(count($slotRows('shield')) === 1, 'пустое гнездо дозаливается: щит вернулся');

// 5. Гнездо на два прибора, занятое НАПОЛОВИНУ. Случай коварный: в
//    цикле дозаливки надо брать только то, чего на корабле ещё нет, —
//    иначе она натыкается на уже стоящий прибор, видит свободное место в
//    гнезде и пытается вставить его второй раз. Это падение на уникальном
//    ключе, а не лишняя строка, то есть весь запрос состояния в ошибку.
Db::run('DELETE se FROM `ship_equipment` se JOIN `equipment_type` e ON e.`id`=se.`equipment_id`
         WHERE se.`ship_id`=? AND e.`code`=?', [$shipId, 'land']);
ok(count($slotRows('computer')) === 1, 'посадочный компьютер снят, докинг остался');
Players::ensureStock($shipId);
$comp = array_column($slotRows('computer'), 'code');
sort($comp);
ok($comp === ['dock', 'land'], 'дозалился ровно недостающий: ' . implode(', ', $comp));

Db::run('DELETE FROM `equipment_type` WHERE `code`=?', ['quantum_x']);

// --- характеристики: бэкенд им хозяин ----------------------------------------

section('характеристики корабля');

// 1. Слепок для проверок в Node не отстал от источника. Отстанет —
//    проверки будут гонять игру по другим числам, чем сервер, и
//    заметить это будет нечем.
ok(!Specs::snapshotStale(),
    'слепок server/data/specs.json собран из нынешнего specs.php'
    . (Specs::snapshotStale() ? ' — соберите: php server/cli/specs.php' : ''));

// 2. Слепок и ответ сервера — одно и то же, включая форму. Игра разбирает
//    их ОДНИМ кодом, и разойдись они, проверки в Node врали бы молча.
$fromFile = json_decode(Specs::snapshot(), true);
$fromApi = $specs;
ok(array_keys($fromFile) === array_keys($fromApi)
    && count($fromFile['modules']) === count($fromApi['modules'])
    && count($fromFile['weapons']) === count($fromApi['weapons']),
    'слепок и сервер отвечают одинаково: ' . count($fromApi['modules']) . ' модулей, '
    . count($fromApi['weapons']) . ' стволов');
$diff = [];
foreach ($fromFile['shipTypes'][0]['spec'] as $k => $v) {
    if (abs((float) $v - (float) ($fromApi['shipTypes'][0]['spec'][$k] ?? INF)) > 1e-9) {
        $diff[] = $k;
    }
}
ok($diff === [], 'лётная модель в слепке и в базе совпадает'
    . ($diff ? ': разошлись ' . implode(', ', $diff) : ''));

// 3. Одно число — одно место. То, что лежит столбцом, НЕ повторяется в
//    `spec`: иначе рано или поздно придётся выяснять, какая из копий
//    настоящая, и выяснять это будет игрок в бою.
$stored = json_decode((string) Db::one('SELECT `spec` FROM `ship_type` LIMIT 1'), true);
$dupes = array_values(array_intersect(array_keys($stored), array_keys(Specs::COLUMNS)));
ok($dupes === [], 'числа из столбцов не продублированы в spec'
    . ($dupes ? ': ' . implode(', ', $dupes) : ''));
ok(isset($stored['stunMin'], $stored['tumbleDamp'], $stored['hitRadius'])
    && !isset($stored['maxHull'], $stored['maxSpeed'], $stored['maxShield'], $stored['hold']),
    'в spec корпуса — только его собственное: скорость, щит и трюм принадлежат модулям');

// 4. У КАЖДОГО МОДУЛЯ СВОИ ЧИСЛА. Двигатель знает свою скорость, щит —
//    свою ёмкость, трюм — тоннаж. Это и есть суть устройства: модуль —
//    предмет, а не ярлык, и у другого двигателя числа другие.
$byCode = [];
foreach ($fromApi['modules'] as $m) {
    $byCode[$m['code']] = $m;
}
$engine = $byCode['engine'] ?? null;
ok($engine !== null
    && ($engine['spec']['flight']['maxSpeed'] ?? 0) > 0
    && ($engine['spec']['flight']['accel'] ?? 0) > 0,
    'двигатель хранит свои числа: ' . ($engine['spec']['flight']['maxSpeed'] ?? 0) . ' км/с');
ok(($byCode['shield']['spec']['flight']['maxShield'] ?? 0) > 0
    && ($byCode['hold']['spec']['flight']['hold'] ?? 0) > 0
    && ($byCode['gear']['spec']['flight']['gearTime'] ?? 0) > 0,
    'щит, трюм и шасси — тоже: ёмкость, тоннаж и время выпуска лежат у них');

//    Ни одно число при переезде не потерялось: собранная модель обязана
//    содержать всё, по чему корабль летит. Пропажа даёт NaN на первом же
//    кадре, причём молча.
$assembled = Specs::mergeFlight($fromApi['shipTypes'][0]['spec'], $fromApi['modules']);
$needKeys = ['maxSpeed', 'accel', 'brake', 'lateral', 'tipAccel', 'rotRamp', 'rcsLag',
    'boostMax', 'boostBurn', 'liftTWR', 'gearTime', 'hold', 'maxShield', 'maxHull',
    'quantumSpeed', 'hitRadius'];
$lost = array_values(array_diff($needKeys, array_keys($assembled)));
ok($lost === [], 'собранная модель полна: корпус плюс гнёзда дают все числа'
    . ($lost ? ', потеряны: ' . implode(', ', $lost) : ''));

//    И ГЛАВНОЕ, ради чего всё затевалось: другой двигатель — другой
//    корабль. Ставим в гнездо форсированный и смотрим на скорость самого
//    корабля, а не каталога.
$shipId = (int) $state['ship']['id'];
$slow = Loadout::flight($shipId)['maxSpeed'] ?? 0;
$stockEngine = (int) Db::one('SELECT `id` FROM `equipment_type` WHERE `code`=?', ['engine']);
$fastEngine = (int) Db::one('SELECT `id` FROM `equipment_type` WHERE `code`=?', ['engine_x']);
Db::update('ship_equipment', ['equipment_id' => $fastEngine],
    '`ship_id`=? AND `equipment_id`=?', [$shipId, $stockEngine]);
Loadout::forget($shipId);
$fast = Loadout::flight($shipId)['maxSpeed'] ?? 0;
Db::update('ship_equipment', ['equipment_id' => $stockEngine],
    '`ship_id`=? AND `equipment_id`=?', [$shipId, $fastEngine]);
Loadout::forget($shipId);
$back = Loadout::flight($shipId)['maxSpeed'] ?? 0;
ok($fast > $slow && abs($back - $slow) < 1e-9,
    'сменили двигатель — сменилась скорость корабля: ' . $slow . ' -> ' . $fast
    . ' и обратно ' . $back . ' км/с');

//    Ручная замена модуля обязана ВЫЖИВАТЬ. Доукомплектование заводским
//    набором (ensureStock) не имеет права вернуть снятый двигатель
//    обратно: в гнезде оказались бы два, и корабль полетел бы по тому из
//    них, у кого больше id, — то есть по случайности. Случай не
//    выдуманный: числа для того в базе и лежат, чтобы их правили руками.
$inSlot = static function (string $slot) use ($shipId): array {
    return array_column(Db::all(
        'SELECT e.`code` FROM `ship_equipment` se JOIN `equipment_type` e ON e.`id`=se.`equipment_id`
         WHERE se.`ship_id`=? AND e.`slot`=? ORDER BY se.`id`', [$shipId, $slot]), 'code');
};
Db::update('ship_equipment', ['equipment_id' => $fastEngine],
    '`ship_id`=? AND `equipment_id`=?', [$shipId, $stockEngine]);
Loadout::forget($shipId);
Players::ensureStock($shipId);
Loadout::forget($shipId);
$afterStock = $inSlot('engine');
$keptSpeed = Loadout::flight($shipId)['maxSpeed'] ?? 0;
Db::update('ship_equipment', ['equipment_id' => $stockEngine],
    '`ship_id`=? AND `equipment_id`=?', [$shipId, $fastEngine]);
Loadout::forget($shipId);
ok($afterStock === ['engine_x'] && $keptSpeed > $slow,
    'поставленный руками двигатель остаётся один в гнезде: ' . implode(', ', $afterStock)
    . ', ' . $keptSpeed . ' км/с');

//    И наоборот: ПУСТОЕ гнездо доукомплектование заполняет — ради этого
//    оно и заведено (каталог пополняется, а корабли заведены раньше).
//    Щит заодно показывает, что он принадлежит кораблю через модуль, а не
//    типу корпуса: сняли — попадание идёт прямо в обшивку.
$shieldId = (int) Db::one('SELECT `id` FROM `equipment_type` WHERE `code`=?', ['shield']);
$withShield = Loadout::shield($shipId)['shield_max'];
Db::run('DELETE FROM `ship_equipment` WHERE `ship_id`=? AND `equipment_id`=?', [$shipId, $shieldId]);
Loadout::forget($shipId);
$without = Loadout::shield($shipId)['shield_max'];
Players::ensureStock($shipId);
Loadout::forget($shipId);
$backShield = Loadout::shield($shipId)['shield_max'];
ok($withShield > 0 && $without === 0.0 && $backShield === $withShield,
    'сняли щит — его нет (' . $withShield . ' -> ' . $without
    . '), пустое гнездо доукомплектовано обратно (' . $backShield . ')');

// 5. Пушка — наоборот: её числа СВОИ, и лежат они при ней. По ним сервер
//    и считает попадания (Combat::weapon).
$gun = Combat::weapon('laser_g');
ok($gun !== null && $gun['damage'] > 0 && $gun['range'] > 0,
    'урон пушки сервер берёт у себя: ' . $gun['damage'] . ' × ' . $gun['range'] . ' км');

// 6. Главное свойство всей переделки: ПРАВКА В БАЗЕ ДОХОДИТ ДО ИГРЫ.
//    Раньше числа жили в коде клиента, и подкрутить их без правки игры
//    было нельзя вовсе.
$was = (float) Db::one('SELECT `hull_max` FROM `ship_type` WHERE `code`=?', ['challenger']);
Db::update('ship_type', ['hull_max' => 137.0], '`code`=?', ['challenger']);
$after = Api::call('catalog.specs');
ok(abs($after['shipTypes'][0]['spec']['maxHull'] - 137.0) < 1e-9,
    'поправленный в базе корпус доехал до игры: '
    . $after['shipTypes'][0]['spec']['maxHull']);
Db::update('ship_type', ['hull_max' => $was], '`code`=?', ['challenger']);

// 7. Цена корабля и модулей — такая же его характеристика, и живёт там же.
ok($fromApi['shipTypes'][0]['price'] > 0 && $engine['price'] > 0,
    'цены приехали вместе с предметами: корабль '
    . $fromApi['shipTypes'][0]['price'] . ' кр, двигатель ' . $engine['price'] . ' кр');


// 8. База, отставшая от кода, говорит об этом словами. Случай не
//    выдуманный: на второй машине делают git pull и забывают
//    `npm run api:setup`. Без проверки игра получила бы модель без
//    половины чисел и полетела бы на NaN — молча и никуда.
Db::run('ALTER TABLE `ship_type` DROP COLUMN `spec`');
$said = '';
try {
    Api::call('catalog.specs');
} catch (Throwable $e) {
    $said = $e->getMessage();
}
ok(strpos($said, 'база отстала') === 0 && strpos($said, 'api:setup') !== false,
    'устаревшая база названа по имени: ' . ($said ?: 'промолчала'));

// И чинится ровно тем, что сказано, — той же заливкой, без сноса данных.
Schema::migrate();
Seeder::content($catalog);
$healed = Api::call('catalog.specs');
ok(count($healed['shipTypes'][0]['spec']) === count(Specs::source()['shipTypes'][0]['spec']),
    'после заливки модель снова целая: ' . count($healed['shipTypes'][0]['spec']) . ' чисел');

// --- топливо -----------------------------------------------------------------

section('топливо');

// Проверки выше гоняли пилота по портам и могли снять ему модули —
// начинаем с заводского корабля в родном порту и с деньгами на верфь.
$shipId = (int) Db::one('SELECT `id` FROM `ship` WHERE `owner_id`=?', [$pid]);
Db::run('DELETE FROM `ship_equipment` WHERE `ship_id`=?', [$shipId]);
Db::update('ship', ['bare' => null, 'fuel_t' => 12, 'hull' => 100], '`id`=?', [$shipId]);
Players::ensureStock($shipId);
Loadout::forget();
Ledger::add($pid, 'ПРОВЕРКА: СРЕДСТВА НА ВЕРФЬ', 300000, 'test');
Db::update('ship', ['system_id' => 0, 'docked_body' => $home['dockedBody']], '`id`=?', [$shipId]);
Db::update('player', ['system_id' => 0, 'last_station' => $home['dockedBody'],
    'aboard_ship' => $shipId, 'seated' => 1], '`id`=?', [$pid]);

$massT = (float) Db::one("SELECT `mass_t` FROM `ship_type` WHERE `code`='challenger'");
$catMass = 0.0;
foreach ($catalog['shipTypes'] as $st) {
    if ($st['code'] === 'challenger') {
        $catMass = (float) $st['massT'];
    }
}
ok($massT > 1000 && abs($massT - $catMass) < 0.05,
    'масса корпуса в базе — из выгрузки меша: ' . $massT . ' т');

$fm = Fuel::model($shipId);
ok(abs($fm['cap'] - 12) < 1e-9 && abs($fm['reserve'] - 1.2) < 1e-9
    && $fm['exhaust'] > 0 && $fm['liftExhaust'] > 0 && $fm['rcsExhaust'] > 0
    && $fm['quantumFuel'] > 0 && $fm['warpFuel'] > 0,
    'модель бака собрана из корпуса и модулей: бак ' . $fm['cap'] . ' т, резерв '
    . $fm['reserve'] . ' т, струя ' . $fm['exhaust'] . ' км/с');

// Формула — масса · Δv / струя. Сверяем с рукой: разогнаться до предела
// и остановиться (2 × 1.2 км/с) стоит 1682 · 2.4 / 40 000 ≈ 0.1 т.
$trip = Fuel::thrustTons($fm, 2.4, 0, 0);
ok(abs($trip - $massT * 2.4 / $fm['exhaust']) < 1e-9 && $trip > 0.08 && $trip < 0.13,
    'разгон до предела и остановка стоят ' . round($trip, 3) . ' т');
ok(abs(Fuel::quantumTons($fm, 5e6) - 5 * $fm['quantumFuel']) < 1e-9,
    'квантовый ход в 5 млн км стоит ' . Fuel::quantumTons($fm, 5e6) . ' т');

// Предел варпа выведен из галактики: самое длинное ребро, без которого
// она распадается на части, обязано помещаться в бак за вычетом резерва.
$sys = Db::all('SELECT `id`,`pos_x`,`pos_y`,`pos_z` FROM `star_system`');
$d = static fn($a, $b) => sqrt(($a['pos_x'] - $b['pos_x']) ** 2 + ($a['pos_y'] - $b['pos_y']) ** 2
    + ($a['pos_z'] - $b['pos_z']) ** 2);
$inTree = [$sys[0]['id'] => true];
$longest = 0.0;
while (count($inTree) < count($sys)) {
    $best = null;
    foreach ($sys as $a) {
        if (!isset($inTree[$a['id']])) {
            continue;
        }
        foreach ($sys as $b) {
            if (isset($inTree[$b['id']])) {
                continue;
            }
            if ($best === null || $d($a, $b) < $best[0]) {
                $best = [$d($a, $b), $b['id']];
            }
        }
    }
    $inTree[$best[1]] = true;
    $longest = max($longest, $best[0]);
}
$range = ($fm['cap'] - $fm['reserve']) / $fm['warpFuel'];
ok($range >= $longest,
    'на заводском баке вся галактика связна: предел прыжка ' . round($range, 1)
    . ' св. г., нужное ребро ' . round($longest, 1));

// ТОПЛИВО ИЗ СОХРАНЕНИЯ НЕ ПИШЕТСЯ — как и корпус: полный бак из
// сохранения значил бы бесплатную заправку после каждого прыжка.
Db::update('ship', ['fuel_t' => 5], '`id`=?', [$shipId]);
Api::call('player.save', ['fuel' => 12, 'system' => 0], $token);
ok(abs((float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipId]) - 5) < 1e-9,
    'топливо из сохранения не растёт: 5 т так и осталось');
Api::call('player.save', ['fuel' => 0], $token);
ok(abs((float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipId]) - 5) < 1e-9,
    'и не убывает: расход считает сервер, а не сохранение');

// ВАРП списывает база: сменилась система в сохранении — прыжок был.
Db::update('ship', ['fuel_t' => 12], '`id`=?', [$shipId]);
Api::call('station.undock', [], $token);
Api::call('player.save', ['system' => 0], $token);
$ly = Galaxy::distance(0, 1);
$jump = Api::call('player.save', ['system' => 1, 'last' => null], $token);
$left = (float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipId]);
ok(abs($left - (12 - $ly * $fm['warpFuel'])) < 0.002 && abs($jump['fuel'] - $left) < 1e-9,
    'варп в соседнюю систему (' . round($ly, 1) . ' св. г.) стоил '
    . round(12 - $left, 2) . ' т, и сохранение вернуло бак игре');
Api::call('player.save', ['system' => 1], $token);
ok(abs((float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipId]) - $left) < 1e-9,
    'повторное сохранение в той же системе прыжком не считается');

// Встать в порт другой системы, не сохранившись, — тот же прыжок: иначе
// варп был бы бесплатным для того, кто не сохраняется до стыковки.
Api::call('station.dock', ['system' => 0, 'station' => $home['dockedBody']], $token);
$back = (float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipId]);
ok(abs($back - ($left - $ly * $fm['warpFuel'])) < 0.002,
    'стыковка в другой системе списала обратный прыжок: осталось ' . round($back, 2) . ' т');

// ЗАПРАВКА: по цене водорода на рынке этого порта.
$homeBody = Galaxy::body(0, (int) $home['dockedBody']);
$h2 = (int) Db::one("SELECT m.`price` FROM `market` m JOIN `commodity` c ON c.`id`=m.`commodity_id`
                     WHERE c.`code`='hydrogen' AND m.`station_id`=?", [$homeBody['id']]);
ok($h2 > 0 && Fuel::price((int) $homeBody['id']) === $h2,
    'тонна топлива стоит столько же, сколько тонна водорода на рынке порта: ' . $h2 . ' кр');

Db::update('ship', ['fuel_t' => 4], '`id`=?', [$shipId]);
$before = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
$fill = Api::call('station.refuel', [], $token);
ok(abs($fill['fuel'] - 12) < 1e-9 && $fill['cost'] === (int) ceil(8 * $h2)
    && $fill['balance'] === $before - $fill['cost'],
    'заправка до полного: 8 т за ' . $fill['cost'] . ' кр');
ok(str_contains((string) Db::one(
    'SELECT `label` FROM `ledger` WHERE `player_id`=? ORDER BY `id` DESC LIMIT 1', [$pid]), 'ЗАПРАВКА'),
    'заправка видна строкой в ленте');
denies('tank_full', fn() => Api::call('station.refuel', [], $token), 'полный бак не заправляют');

Db::update('ship', ['fuel_t' => 10], '`id`=?', [$shipId]);
$part = Api::call('station.refuel', ['tons' => 1], $token);
ok(abs($part['fuel'] - 11) < 1e-9 && $part['cost'] === $h2, 'долить тонну: ' . $part['cost'] . ' кр');
$over = Api::call('station.refuel', ['tons' => 50], $token);
ok(abs($over['fuel'] - 12) < 1e-9 && abs($over['tons'] - 1) < 1e-9,
    'больше бака не нальют: из пятидесяти тонн влезла одна');
denies('bad_request', fn() => Api::call('station.refuel', ['tons' => -3], $token),
    'отрицательный тоннаж отвергается');

// Денег не хватает — не нальют ни грамма, а скажут, сколько нужно.
Db::update('ship', ['fuel_t' => 2], '`id`=?', [$shipId]);
$rich = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
Ledger::add($pid, 'ПРОВЕРКА: ОПУСТОШИТЬ СЧЁТ', -($rich - 50), 'test');
denies('no_funds', fn() => Api::call('station.refuel', [], $token), 'без денег не заправляют');
ok(abs((float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipId]) - 2) < 1e-9,
    'и бак при отказе не тронут');
Ledger::add($pid, 'ПРОВЕРКА: ВЕРНУТЬ СЧЁТ', $rich - 50, 'test');

Api::call('station.undock', [], $token);
denies('not_docked', fn() => Api::call('station.refuel', [], $token), 'в полёте не заправляют');

// БУКСИР: из пустоты — в последний порт, бак до резерва.
Db::update('ship', ['fuel_t' => 0.3], '`id`=?', [$shipId]);
Db::update('player', ['last_station' => $home['dockedBody']], '`id`=?', [$pid]);
$before = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
$tow = Api::call('ship.rescue', [], $token);
$p = Players::ship($pid);
ok((int) $p['docked_body'] === (int) $home['dockedBody'] && abs($tow['fuel'] - 1.2) < 1e-9
    && $tow['fee'] === Content::RESCUE_FEE && $tow['balance'] === $before - Content::RESCUE_FEE,
    'буксир дотянул до последнего порта за ' . $tow['fee'] . ' кр и долил бак до резерва');
denies('docked', fn() => Api::call('ship.rescue', [], $token), 'из порта буксир не вызывают');

// Без денег буксир всё равно приходит — и забирает только то, что есть.
Api::call('station.undock', [], $token);
$rich = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
Ledger::add($pid, 'ПРОВЕРКА: ОПУСТОШИТЬ СЧЁТ', -($rich - 100), 'test');
$tow = Api::call('ship.rescue', [], $token);
ok($tow['fee'] === 100 && $tow['balance'] === 0, 'без денег буксир берёт, сколько есть, и в долг не уводит');
Ledger::add($pid, 'ПРОВЕРКА: ВЕРНУТЬ СЧЁТ', $rich - 100, 'test');

// Сверх резерва буксир не доливает: иначе он был бы дешёвой заправкой.
Api::call('station.undock', [], $token);
Db::update('ship', ['fuel_t' => 7], '`id`=?', [$shipId]);
$tow = Api::call('ship.rescue', [], $token);
ok(abs($tow['fuel'] - 7) < 1e-9, 'топлива больше резерва буксир не трогает: 7 т');

// Гибель — страховка возвращает корабль с резервом, но не с полным баком.
Db::update('ship', ['fuel_t' => 0], '`id`=?', [$shipId]);
Combat::respawn($pid);
ok(abs((float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipId]) - 1.2) < 1e-9,
    'после гибели в баке резерв: 1.2 т');
Db::update('ship', ['fuel_t' => 12], '`id`=?', [$shipId]);

// --- верфь -------------------------------------------------------------------

section('верфь');

$yard = Db::row("SELECT b.`system_id`, b.`local_id`, st.`name`, st.`tech`
                 FROM `station` st JOIN `body` b ON b.`id`=st.`body_id`
                 WHERE st.`has_outfit`=1 AND st.`tech`=5 ORDER BY b.`system_id`, b.`local_id` LIMIT 1");
$yard4 = Db::row("SELECT b.`system_id`, b.`local_id`, st.`name`
                  FROM `station` st JOIN `body` b ON b.`id`=st.`body_id`
                  WHERE st.`has_outfit`=1 AND st.`tech`=4 LIMIT 1");
$noYard = Db::row("SELECT b.`system_id`, b.`local_id`, st.`name`
                   FROM `station` st JOIN `body` b ON b.`id`=st.`body_id`
                   WHERE st.`has_outfit`=0 LIMIT 1");
$dockAt = static function (array $st) use ($pid, $shipId): void {
    Db::update('ship', ['system_id' => (int) $st['system_id'], 'docked_body' => (int) $st['local_id']],
        '`id`=?', [$shipId]);
    Db::update('player', ['system_id' => (int) $st['system_id']], '`id`=?', [$pid]);
};
$dockAt($yard);

$offer = Api::call('outfit.list', [], $token);
$slot = static function (array $offer, string $name): ?array {
    foreach ($offer['slots'] as $s) {
        if ($s['slot'] === $name) {
            return $s;
        }
    }
    return null;
};
$eng = $slot($offer, 'engine');
$engX = null;
foreach ($eng['offers'] as $o) {
    if ($o['code'] === 'engine_x') {
        $engX = $o;
    }
}
ok($offer['open'] === true && $eng['required'] === true && $eng['installed'][0]['code'] === 'engine'
    && $engX !== null && $engX['sold'] === true
    && $engX['credit'] === (int) floor(12000 * Content::RESALE) && $engX['net'] === 31000 - $engX['credit'],
    'верфь «' . $yard['name'] . '»: форсированный двигатель за ' . $engX['net']
    . ' кр с зачётом заводского');
$tank = $slot($offer, 'tank');
ok($tank !== null && $tank['installed'] === [] && $tank['offers'][0]['code'] === 'tank_x',
    'пустое с завода гнездо бака видно и предлагается');
ok($slot($offer, 'gun') === null, 'оружия на верфи нет');

$before = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
$buy = Api::call('outfit.buy', ['code' => 'engine_x'], $token);
$after = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
$rows = Db::all('SELECT `label`,`amount` FROM `ledger` WHERE `player_id`=? ORDER BY `id` DESC LIMIT 2', [$pid]);
ok($buy['removed'] === 'engine' && $after === $before - $buy['cost'] && $buy['cost'] === $engX['net']
    && str_contains($rows[0]['label'], 'УСТАНОВЛЕН') && str_contains($rows[1]['label'], 'СДАН'),
    'замена двигателя: сдан заводской, поставлен форсированный — две строки в ленте');
$state = Api::call('player.state', [], $token);
$engines = array_values(array_filter($state['ship']['equipment'], fn($e) => $e['slot'] === 'engine'));
ok(count($engines) === 1 && $engines[0]['code'] === 'engine_x'
    && abs(Loadout::flight($shipId)['maxSpeed'] - 1.8) < 1e-9
    && abs(Fuel::model($shipId)['exhaust'] - 29000) < 1e-9,
    'в гнезде один двигатель — новый, и корабль летит и тратит по его числам');
denies('installed', fn() => Api::call('outfit.buy', ['code' => 'engine_x'], $token),
    'второй раз тот же модуль не ставят');
denies('required', fn() => Api::call('outfit.sell', ['code' => 'engine_x'], $token),
    'двигатель нельзя продать — только заменить');

// Бак: поставили — объём вырос, сняли — лишнее топливо станция выкупила.
Api::call('outfit.buy', ['code' => 'tank_x'], $token);
ok(abs(Fuel::model($shipId)['cap'] - 20) < 1e-9, 'с дополнительным баком объём 20 т');
Api::call('station.refuel', [], $token);
$yardBody = Galaxy::body((int) $yard['system_id'], (int) $yard['local_id']);
$before = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
$sold = Api::call('outfit.sell', ['code' => 'tank_x'], $token);
$refund = (int) floor(8 * Fuel::price((int) $yardBody['id']));
ok(abs((float) Db::one('SELECT `fuel_t` FROM `ship` WHERE `id`=?', [$shipId]) - 12) < 1e-9
    && $sold['refund'] === $refund
    && (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid])
        === $before + (int) floor(14000 * Content::RESALE) + $refund,
    'снятый бак: топливо сверх 12 т выкуплено за ' . $refund . ' кр');

// Щит: сняли — его нет, и дозаливка не возвращает его даром.
$before = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
Api::call('outfit.sell', ['code' => 'shield'], $token);
$state = Api::call('player.state', [], $token);
ok(!in_array('shield', array_column($state['ship']['equipment'], 'slot'), true)
    && (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid])
        === $before + (int) floor(15000 * Content::RESALE)
    && (float) Db::one('SELECT `shield` FROM `ship` WHERE `id`=?', [$shipId]) === 0.0,
    'проданный щит не возвращается при входе: гнездо пусто по воле пилота, щит на нуле');
Api::call('outfit.buy', ['code' => 'shield_x'], $token);
Api::call('player.state', [], $token);
$shields = array_values(array_filter(Api::call('player.state', [], $token)['ship']['equipment'],
    fn($e) => $e['slot'] === 'shield'));
ok(count($shields) === 1 && $shields[0]['code'] === 'shield_x'
    && !in_array('shield', Players::bareSlots($shipId), true)
    && in_array('tank', Players::bareSlots($shipId), true),
    'купленный щит встаёт один, отметка «пусто» с его гнезда снята (у бака — осталась)');

// Компьютеров два в одном гнезде: продал оба, купил один — второй даром не приходит.
Api::call('outfit.sell', ['code' => 'land'], $token);
Api::call('outfit.sell', ['code' => 'dock'], $token);
Api::call('outfit.buy', ['code' => 'dock'], $token);
$comps = array_column(array_values(array_filter(Api::call('player.state', [], $token)['ship']['equipment'],
    fn($e) => $e['slot'] === 'computer')), 'code');
ok($comps === ['dock'], 'продал два компьютера, купил один — второй не дозаливается: ' . implode(',', $comps));
Api::call('outfit.buy', ['code' => 'land'], $token);

// Трюм: с грузом не снять, и меньше груза не поставить.
$water = (int) Db::one("SELECT `id` FROM `commodity` WHERE `code`='water'");
Api::call('outfit.buy', ['code' => 'hold_x'], $token);
Cargo::add($shipId, $water, 30, 30);
denies('cargo_aboard', fn() => Api::call('outfit.sell', ['code' => 'hold_x'], $token),
    'трюм с грузом не продают');
denies('no_room', fn() => Api::call('outfit.buy', ['code' => 'hold'], $token),
    '30 т груза в 20-тонный трюм не переставить');
Db::run('DELETE FROM `cargo` WHERE `ship_id`=?', [$shipId]);
Api::call('outfit.buy', ['code' => 'hold'], $token);

// Где что продают: столичный привод — только в столице, без верфи — ничего.
if ($yard4) {
    $dockAt($yard4);
    $q = $slot(Api::call('outfit.list', [], $token), 'drive');
    $qx = array_values(array_filter($q['offers'], fn($o) => $o['code'] === 'quantum_x'))[0] ?? null;
    ok($qx !== null && $qx['sold'] === false, 'на верфи уровня 4 («' . $yard4['name']
        . '») привод второго поколения не продают');
    denies('no_tech', fn() => Api::call('outfit.buy', ['code' => 'quantum_x'], $token),
        'и купить его там нельзя');
}
if ($noYard) {
    $dockAt($noYard);
    $off = Api::call('outfit.list', [], $token);
    ok($off['open'] === false, 'в порту без верфи («' . $noYard['name'] . '») список есть, но закрыт');
    denies('no_outfit', fn() => Api::call('outfit.buy', ['code' => 'scanner_x'], $token),
        'и ничего не продают');
    denies('no_outfit', fn() => Api::call('outfit.sell', ['code' => 'lamp'], $token),
        'и ничего не принимают');
}
Api::call('station.undock', [], $token);
denies('not_docked', fn() => Api::call('outfit.list', [], $token), 'в полёте верфи нет');

// Вернуть заводской двигатель: следующие наборы считают по нему.
$dockAt($yard);
Api::call('outfit.buy', ['code' => 'engine'], $token);
Db::update('ship', ['system_id' => 0, 'docked_body' => $home['dockedBody']], '`id`=?', [$shipId]);
Db::update('player', ['system_id' => 0], '`id`=?', [$pid]);

$sum = (int) Db::one('SELECT COALESCE(SUM(`amount`),0) FROM `ledger` WHERE `player_id`=?', [$pid]);
$balance = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pid]);
ok($sum === $balance, 'после заправок, буксира и верфи баланс сходится с лентой');

// --- пилот и корабль -----------------------------------------------------------
//
// Центр игры — пилот, а не корабль (схема 10). Корабль стоит, где его
// оставили; пилот ходит, где хочет, — но на чужой борт попадает только
// рядом с ним, а в кресло садится только своего.

section('пилот и корабль');

$ra = Auth::register('pilot_a', 'secret', 'ПИЛОТ А');
$rb = Auth::register('pilot_b', 'secret', 'ПИЛОТ Б');
$ta = $ra['token'];
$tb = $rb['token'];
$sa = Api::call('player.state', [], $ta);
$shipA1 = $sa['ship']['id'];
$shipB = Api::call('player.state', [], $tb)['ship']['id'];
ok($sa['me']['aboard'] === $shipA1 && $sa['me']['seated'] === true && $sa['me']['out'] === null
    && $sa['position']['dockedBody'] !== null,
    'новый пилот — в кресле своего корабля, корабль — в порту');

// Стоянка на Lave II: корабль в осях тела, как его кладёт игра (settle).
$land = Db::row("SELECT `local_id`, `radius_km` FROM `body` WHERE `system_id`=0 AND `name`='Lave II'");
$L = (int) $land['local_id'];
$R = (float) $land['radius_km'];
$poseAt = static function (float $dx) use ($R): array {
    $l = sqrt($dx * $dx + $R * $R);
    return ['dir' => ['x' => $dx / $l, 'y' => $R / $l, 'z' => 0], 'radius' => $R + 0.006,
        'right' => ['x' => 1, 'y' => 0, 'z' => 0], 'up' => ['x' => 0, 'y' => 1, 'z' => 0],
        'fwd' => ['x' => 0, 'y' => 0, 'z' => 1]];
};
$outAt = static fn(float $dx, float $dz = 0) => ['body' => $L, 'o' => ['x' => $dx, 'y' => $R, 'z' => $dz],
    'f' => ['x' => 0, 'y' => 0, 'z' => 1], 'pitch' => 0.1];

Api::call('station.undock', [], $ta);
Api::call('player.save', [
    'ship' => ['id' => $shipA1, 'system' => 0, 'gear' => true, 'hatches' => ['nL', 'bad name!'],
        'landed' => ['id' => $L, 'pose' => $poseAt(0), 'secured' => true]],
    'me' => ['aboard' => $shipA1, 'seated' => true]], $ta);
$st = Api::call('player.state', [], $ta);
ok($st['position']['landedBody'] === $L && $st['position']['dockedBody'] === null
    && $st['position']['hatches'] === ['nL'],
    'место корабля пишет тот, кто им командует: стоянка и открытый люк (мусорное имя люка отброшено)');

// Встать с кресла — переход, и делает его сервер (pilot.move), а не
// сохранение: сохранение «встал» место пилота не меняет.
$r = Api::call('player.save', ['me' => ['aboard' => $shipA1, 'seated' => false,
    'walk' => ['pos' => [1.5, -2.3, 10], 'yaw' => 0.5, 'pitch' => -0.2]]], $ta);
$st = Api::call('player.state', [], $ta);
ok(!empty($r['meStale']) && $st['me']['seated'] === true,
    'сохранение «встал» пилота с кресла не поднимает: это переход, а не поза');
$r = Api::call('pilot.move', ['me' => ['aboard' => $shipA1, 'seated' => false,
    'walk' => ['pos' => [1.5, -2.3, 10], 'yaw' => 0.5, 'pitch' => -0.2]]], $ta);
$st = Api::call('player.state', [], $ta);
ok($r['moved'] === true && $st['me']['seated'] === false && abs($st['me']['walk']['pos'][2] - 10) < 1e-9
    && abs($st['me']['walk']['yaw'] - 0.5) < 1e-9,
    'пилот встал (pilot.move) и на ногах в своём корабле: при входе в игру он там же, а не в кресле');
// Шаги по палубе — поза, и её пишет сохранение.
$r = Api::call('player.save', ['me' => ['aboard' => $shipA1, 'seated' => false,
    'walk' => ['pos' => [1.5, -2.3, 12], 'yaw' => 0.5, 'pitch' => -0.2]]], $ta);
$st = Api::call('player.state', [], $ta);
ok(empty($r['meStale']) && abs($st['me']['walk']['pos'][2] - 12) < 1e-9,
    'шаги по палубе пишет сохранение: место то же, поза новая');

// Сошёл на грунт у корабля.
$r = Api::call('pilot.move', ['me' => ['out' => $outAt(0.03, 0.02)]], $ta);
$st = Api::call('player.state', [], $ta);
ok($r['moved'] === true && $st['me']['aboard'] === null && $st['me']['out']['body'] === $L
    && abs($st['me']['out']['o']['x'] - 0.03) < 1e-9 && $st['position']['landedBody'] === $L,
    'пилот за бортом — в осях тела; корабль стоит, где стоял');

// Сойти с корабля в километрах от него нельзя: это уже не трап.
Api::call('pilot.move', ['me' => ['aboard' => $shipA1, 'seated' => false]], $ta);
$r = Api::call('pilot.move', ['me' => ['out' => $outAt(30)]], $ta);
ok($r['moved'] === false && $r['denied'] === 'too_far' && $r['me']['aboard'] === $shipA1,
    'сойти с борта в 30 км от корабля нельзя: пилот остался на борту, и ответ говорит, где он');
Api::call('pilot.move', ['me' => ['out' => $outAt(0.03)]], $ta);

// Второй пилот садится рядом — в восьмидесяти метрах.
Api::call('station.undock', [], $tb);
Api::call('player.save', ['ship' => ['id' => $shipB, 'system' => 0, 'gear' => true,
    'landed' => ['id' => $L, 'pose' => $poseAt(0.08), 'secured' => true]],
    'me' => ['aboard' => $shipB, 'seated' => true]], $tb);

// По грунту ходят куда угодно (шаги — поза, их пишет сохранение) — но
// на чужой борт попадают только рядом.
$r = Api::call('player.save', ['me' => ['out' => $outAt(40)]], $ta);
ok(empty($r['meStale']) && abs(Api::call('player.state', [], $ta)['me']['out']['o']['x'] - 40) < 1e-9,
    'шаги по грунту пишет сохранение: тело то же, точка новая');
$r = Api::call('pilot.move', ['me' => ['aboard' => $shipB, 'seated' => false]], $ta);
ok($r['denied'] === 'too_far' && $r['me']['out'] !== null,
    'на чужой борт за 40 км не попасть: сервер оставил пилота на грунте');
Api::call('player.save', ['me' => ['out' => $outAt(0.07)]], $ta);
// Соседа нет в игре — его корабля нет в мире, и зайти некуда.
$r = Api::call('pilot.move', ['me' => ['aboard' => $shipB, 'seated' => true]], $ta);
ok($r['denied'] === 'owner_away' && $r['me']['out'] !== null,
    'к соседу, которого нет в игре, и у трапа на борт не попасть');
// Сосед в игре — так его отмечает хаб (Hub::hello).
Db::update('player', ['online' => 1], '`id`=?', [$rb['player_id']]);
$r = Api::call('pilot.move', ['me' => ['aboard' => $shipB, 'seated' => true]], $ta);
$st = Api::call('player.state', [], $ta);
ok($r['moved'] === true && $st['me']['aboard'] === $shipB && $st['me']['seated'] === false
    && $st['aboard']['id'] === $shipB && $st['aboard']['ownerName'] === 'ПИЛОТ Б'
    && $st['aboard']['landedBody'] === $L,
    'поднялся на борт соседа; в чужое кресло не садятся — пассажир на ногах');

// Пассажир не двигает чужой корабль.
$r = Api::call('player.save', ['ship' => ['id' => $shipB, 'landed' => null, 'pos' => ['x' => 1, 'y' => 2, 'z' => 3]]], $ta);
$rowB = Players::shipRow($shipB);
ok(!empty($r['shipIgnored']) && (int) $rowB['landed_body'] === $L,
    'сохранение за чужой корабль не пишется: он стоит, где стоял');

// Хозяин улетает в другую систему — пассажир с ним, свой корабль на месте.
$fuelB0 = (float) $rowB['fuel_t'];
Api::call('player.save', ['ship' => ['id' => $shipB, 'system' => 3, 'landed' => null,
    'pos' => ['x' => 5e6, 'y' => 0, 'z' => 0]], 'me' => ['aboard' => $shipB, 'seated' => true]], $tb);
$st = Api::call('player.state', [], $ta);
$fuelB1 = (float) Players::shipRow($shipB)['fuel_t'];
$fuelA1 = (float) Players::shipRow($shipA1)['fuel_t'];
ok($st['me']['systemId'] === 3 && $st['me']['aboard'] === $shipB
    && $st['position']['systemId'] === 0 && $st['position']['landedBody'] === $L,
    'пассажир улетел с хозяином в систему 3, его корабль остался на Lave II');
ok($fuelB1 < $fuelB0 && abs($fuelA1 - (float) $sa['ship']['fuelT']) < 1e-9,
    'за варп платит бак того корабля, что прыгнул: −' . round($fuelB0 - $fuelB1, 2) . ' т, у пассажира бак цел');

// Пассажир в порту — но не в своём: его трюм остался в его корабле.
$homeSt = Db::row("SELECT `local_id` FROM `body` WHERE `system_id`=0 AND `kind`='station' ORDER BY `local_id` LIMIT 1");
Api::call('player.save', ['ship' => ['id' => $shipB, 'system' => 0, 'pos' => ['x' => 0, 'y' => 0, 'z' => 0]]], $tb);
Api::call('station.dock', ['system' => 0, 'station' => (int) $homeSt['local_id']], $tb);
denies('not_docked', fn() => Api::call('market.prices', [], $ta),
    'пассажир чужого корабля в порту не торгует');
ok(Api::call('market.prices', [], $tb)['prices'] !== [], 'а хозяин, стоящий в нём, торгует');

// Корабль погиб — страховка возвращает его в порт; хозяин в кресле,
// пассажир на борту.
Api::call('station.undock', [], $tb);
Api::call('pilot.move', ['me' => ['aboard' => $shipB, 'seated' => false,
    'walk' => ['pos' => [0, 0, 5], 'yaw' => 0, 'pitch' => 0]]], $tb);
Combat::respawnShip($shipB);
$pa = Players::byId($ra['player_id']);
$pb = Players::byId($rb['player_id']);
$rowB = Players::shipRow($shipB);
ok($rowB['docked_body'] !== null && (int) $pb['aboard_ship'] === $shipB && (int) $pb['seated'] === 1
    && (int) $pa['aboard_ship'] === $shipB && (int) $pa['seated'] === 0,
    'после гибели корабль в порту, хозяин в кресле, пассажир на борту');

// Хозяин вышел из игры: вход в игру возвращает пассажира к себе, а
// опоздавшее сохранение «я на его палубе» назад его не ставит.
Db::update('player', ['online' => 0], '`id`=?', [$rb['player_id']]);
$st = Api::call('player.state', [], $ta);
ok($st['me']['aboard'] === $shipA1 && $st['me']['seated'] === true && $st['me']['systemId'] === 0
    && $st['aboard'] === null,
    'хозяин ушёл — пассажир входит в игру в кресле своего корабля, в его системе');
$r = Api::call('player.save', ['me' => ['aboard' => $shipB, 'seated' => false,
    'walk' => ['pos' => [0, 0, 6], 'yaw' => 0, 'pitch' => 0]]], $ta);
ok(!empty($r['meStale']) && (int) Players::byId($ra['player_id'])['aboard_ship'] === $shipA1,
    'опоздавшее сохранение пассажира «я на его палубе» на чужой борт его не возвращает');

// Второй свой корабль: командование — только из его кресла.
$typeId = (int) Db::one('SELECT `type_id` FROM `ship` WHERE `id`=?', [$shipA1]);
$shipA2 = Db::insert('ship', ['type_id' => $typeId, 'owner_id' => $ra['player_id'], 'name' => 'ВТОРОЙ',
    'hull' => 100, 'fuel_t' => 12, 'system_id' => 0, 'landed_body' => $L,
    'landed_pose' => json_encode($poseAt(-0.1)), 'created_at' => Db::now()]);
Players::ensureStock($shipA2);
denies('not_owner', fn() => Api::call('ship.command', ['id' => $shipB], $ta), 'командовать чужим кораблём нельзя');
denies('not_aboard', fn() => Api::call('ship.command', ['id' => $shipA2], $ta),
    'своим — только с его борта');
Db::update('player', ['aboard_ship' => null, 'seated' => 0, 'out_body' => $L,
    'out_pose' => json_encode($outAt(-0.09))], '`id`=?', [$ra['player_id']]);
Api::call('pilot.move', ['me' => ['aboard' => $shipA2, 'seated' => true]], $ta);
$st = Api::call('ship.command', ['id' => $shipA2], $ta);
$fleet = array_column($st['fleet'], 'active', 'id');
// Вездеходы в трюмах обоих «Челленджеров» — тоже во флоте; кораблей два.
ok($st['ship']['id'] === $shipA2 && $st['me']['seated'] === true
    && count(array_filter($st['fleet'], fn($s) => $s['carrier'] === null)) === 2
    && $fleet[$shipA2] === true && $fleet[$shipA1] === false && $st['position']['landedBody'] === $L,
    'пересел во второй свой корабль: им и командует, первый стоит на месте');
// Место каждого корабля — с точкой: по ней карта ставит значок (js/game/fleet.js).
$byId = array_column($st['fleet'], null, 'id');
$f2 = $byId[$shipA2];
$p2 = $f2['point'] ?? ['b' => 0, 'x' => 0, 'y' => 0, 'z' => 0];
$want = $poseAt(-0.1);
ok($f2['where'] === 'landed' && $p2['b'] === $L && $f2['pos'] === null
    && abs(sqrt($p2['x'] ** 2 + $p2['y'] ** 2 + $p2['z'] ** 2) - $want['radius']) < 1e-6
    && $f2['bodyName'] === (string) Db::one('SELECT `name` FROM `body` WHERE `system_id`=0 AND `local_id`=?', [$L])
    && $f2['systemName'] === (string) Db::one('SELECT `name` FROM `star_system` WHERE `id`=0'),
    'во флоте у корабля — место: на грунте ' . $f2['bodyName'] . ' (' . $f2['systemName']
    . '), точка в осях тела на его стоянке');
// Сохранение, собранное ДО пересадки, а дошедшее ПОСЛЕ (запросы идут
// параллельно, порядок не обещан никем): ни корабль, ни место пилота из
// него не пишутся. Раньше место писалось — и пилот оказывался на борту
// прежнего корабля, пока новый улетал без него; порт потом отказывал
// новому «не на борту», а рынок и заправка — «не в порту».
$r = Api::call('player.save', ['ship' => ['id' => $shipA1, 'landed' => null],
    'me' => ['aboard' => $shipA1, 'seated' => true]], $ta);
$pa = Players::byId($ra['player_id']);
ok(!empty($r['shipIgnored']) && !empty($r['meStale']) && (int) Players::shipRow($shipA1)['landed_body'] === $L
    && (int) $pa['aboard_ship'] === $shipA2 && (int) $pa['seated'] === 1,
    'опоздавшее сохранение прежнего корабля не пишется: ни его место, ни пилот на его борту');

// --- Верфь корпусов: «Прометей» продают только в столицах, а пересаживаются
// на купленный прямо в доке — оба корабля стоят в одном порту.
section('верфь корпусов');
{
    $ry = Auth::register('pilot_y', 'secret', 'ПИЛОТ Й');
    $tky = $ry['token'];
    $pidY = (int) $ry['player_id'];
    $sy = Api::call('player.state', [], $tky);
    $yHome = (int) $sy['ship']['id'];
    $types = array_column(Specs::forGame()['shipTypes'], null, 'code');
    ok(isset($types['prometheus']) && (int) $types['prometheus']['price'] === 1500000
        && abs($types['prometheus']['spec']['hitRadius'] - 0.1) < 1e-9,
        'в каталоге два корпуса: «Прометей» за 1 500 000 кр, со своими числами корпуса');
    $mass = array_column(Db::all('SELECT `code`, `mass_t` FROM `ship_type`'), 'mass_t', 'code');
    ok((float) $mass['prometheus'] > 20 * (float) $mass['challenger'],
        'масса корпуса — из выгрузки модели: ' . $mass['prometheus'] . ' т против ' . $mass['challenger']);

    // Порты системы: где верфь есть и какого уровня.
    $ports = [];
    foreach (Db::all("SELECT `local_id` FROM `body` WHERE `system_id`=0 AND `kind`='station'") as $b) {
        $ports[] = Stations::info(0, (int) $b['local_id']);
    }
    $low = null;
    $top = null;
    foreach ($ports as $p) {
        if ($p['services']['outfit'] && $p['tech'] === 4 && $low === null) $low = $p;
        if ($p['tech'] >= 5 && $top === null) $top = $p;
    }
    $dockAt = static function (int $shipId, int $localId): void {
        Db::update('ship', ['system_id' => 0, 'docked_body' => $localId, 'landed_body' => null,
            'anchor_body' => null], '`id`=?', [$shipId]);
    };
    if ($low !== null) {
        $dockAt($yHome, $low['localId']);
        $o = Api::call('shipyard.list', [], $tky);
        $pr = array_column($o['hulls'], null, 'code')['prometheus'];
        ok($o['open'] && !$pr['sold'] && array_column($o['hulls'], null, 'code')['challenger']['sold'],
            'на верфи уровня 4 продают «Челленджер», а «Прометей» — нет');
        denies('no_tech', fn() => Api::call('shipyard.buy', ['code' => 'prometheus'], $tky),
            'крейсер на верфи уровня 4 не купить');
    }
    ok($top !== null, 'в родной системе есть столица: ' . ($top ? $top['name'] : '—'));
    $dockAt($yHome, $top['localId']);
    denies('no_funds', fn() => Api::call('shipyard.buy', ['code' => 'prometheus'], $tky),
        'без полутора миллионов крейсер не купить');
    Ledger::add($pidY, 'ПРОВЕРКА', 2000000, 'test');
    $before = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pidY]);
    $st = Api::call('shipyard.buy', ['code' => 'prometheus'], $tky);
    $newId = (int) $st['bought'];
    $row = Players::shipRow($newId);
    $after = (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$pidY]);
    $line = Db::row('SELECT * FROM `ledger` WHERE `player_id`=? ORDER BY `id` DESC LIMIT 1', [$pidY]);
    ok($newId > 0 && (int) $row['owner_id'] === $pidY && (int) $row['docked_body'] === $top['localId']
        && (int) $row['system_id'] === 0 && count(array_filter($st['fleet'], fn($s) => $s['carrier'] === null)) === 2
        && $st['ship']['id'] === $yHome
        && $before - $after === 1500000 && (int) $line['amount'] === -1500000
        && strpos($line['label'], 'Prometheus') !== false,
        'купил: новый корабль в том же доке, пилот пока в кресле прежнего, в ленте −1 500 000 кр');
    $mods = count(Loadout::modules($newId));
    $stock = (int) Db::one('SELECT COUNT(*) FROM `equipment_type` WHERE `stock`=1');
    ok((float) $row['fuel_t'] === 270.0 && (float) $row['hull'] === 600.0 && $mods === $stock && (float) $row['shield'] > 0,
        'с заводскими модулями (' . $mods . '), полным баком 270 т, корпусом 600 и щитом');
    $drive = array_values(array_filter(Loadout::modules($newId), fn($m) => $m['slot'] === 'drive'));
    $fm = Fuel::model($newId);
    ok(count($drive) === 1 && $drive[0]['code'] === 'quantum_p' && abs($fm['quantumSpeed'] - 140000) < 1e-6
        && abs($fm['mass'] - (float) $mass['prometheus']) < 1e-6,
        'с завода у крейсера свой квантовый привод: ' . $fm['quantumSpeed'] . ' км/с, расход — по его массе');
    // На «Челленджер» крейсерский привод не ставится: ему нужен реактор крейсера.
    denies('wrong_hull', fn() => Api::call('outfit.buy', ['code' => 'quantum_p'], $tky),
        'крейсерский привод на «Челленджер» не поставить');
    $offer = Api::call('outfit.list', [], $tky);
    $qp = null;
    foreach ($offer['slots'] as $sl) foreach ($sl['offers'] as $m) if ($m['code'] === 'quantum_p') $qp = $m;
    ok($qp !== null && $qp['fits'] === false && $qp['sold'] === false && $qp['hulls'] === ['prometheus'],
        'на верфи «Челленджера» он виден, но помечен: только для крейсера');

    $st = Api::call('ship.command', ['id' => $newId], $tky);
    ok($st['ship']['id'] === $newId && $st['ship']['type']['code'] === 'prometheus'
        && $st['me']['aboard'] === $newId && $st['me']['seated'] === true
        && $st['position']['dockedBody'] === $top['localId'],
        'пересел в одном доке: командует «Прометеем», сидит в его кресле');
    // Ровно тот случай, что ломал игру: сохранение «Челленджера», ушедшее
    // до пересадки, дошло после неё. Пилот остаётся в кресле «Прометея»,
    // и «Прометей» выходит из порта и встаёт в него снова — с рынком.
    $r = Api::call('player.save', ['ship' => ['id' => $yHome, 'system' => 0],
        'me' => ['aboard' => $yHome, 'seated' => true]], $tky);
    $py = Players::byId($pidY);
    ok(!empty($r['meStale']) && (int) $py['aboard_ship'] === $newId && (int) $py['seated'] === 1,
        'опоздавшее сохранение «Челленджера» пилота назад не пересаживает');
    Api::call('station.undock', [], $tky);
    $d = Api::call('station.dock', ['system' => 0, 'station' => $top['localId']], $tky);
    ok($d['station']['localId'] === $top['localId'] && count(Api::call('market.prices', [], $tky)['goods']) > 0,
        'и «Прометей» встаёт в порт и торгует: его пилот на борту');
    // Палуба корабля — по его длине (Players::deckM): ангар «Прометея» в
    // ста метрах от центра масс, мостик — в тридцати над ним, и точка на
    // борту не обрезается до шестидесяти метров «Челленджера».
    Api::call('pilot.move', ['me' => ['aboard' => $newId, 'seated' => false,
        'walk' => ['pos' => [0, 32.1, 100.5], 'yaw' => 0, 'pitch' => 0]]], $tky);
    $st = Api::call('player.state', [], $tky);
    ok($st['me']['seated'] === false && abs($st['me']['walk']['pos'][2] - 100.5) < 1e-9
        && abs($st['me']['walk']['pos'][1] - 32.1) < 1e-9 && abs(Players::deckM($row) - 117.0) < 1e-6,
        'на палубе «Прометея» точка в ста метрах от центра — на борту (палуба ' . Players::deckM($row) . ' м)');
    $st = Api::call('ship.command', ['id' => $yHome], $tky);
    ok($st['ship']['id'] === $yHome && $st['ship']['type']['code'] === 'challenger',
        'и обратно — в «Челленджер» в том же доке');
    Api::call('pilot.move', ['me' => ['aboard' => $yHome, 'seated' => false,
        'walk' => ['pos' => [0, 0, 100.5], 'yaw' => 0, 'pitch' => 0]]], $tky);
    $st = Api::call('player.state', [], $tky);
    ok(abs($st['me']['walk']['pos'][2] - Players::DECK_M) < 1e-9,
        'а у «Челленджера» — прежние ' . Players::DECK_M . ' м: дальше точки на борту нет');
    Api::call('pilot.move', ['me' => ['aboard' => $yHome, 'seated' => true]], $tky);
    // Корабли в разных портах — пересесть нельзя: туда ещё надо долететь.
    $other = null;
    foreach ($ports as $p) if ($p['localId'] !== $top['localId']) { $other = $p; break; }
    if ($other !== null) {
        $dockAt($yHome, $other['localId']);
        denies('not_aboard', fn() => Api::call('ship.command', ['id' => $newId], $tky),
            'из другого порта на «Прометей» не пересесть');
        $dockAt($yHome, $top['localId']);
    }
    $o = Api::call('shipyard.list', [], $tky);
    ok(count($o['here']) === 2 && count(array_filter($o['here'], fn($x) => $x['active'])) === 1,
        'в разделе «Корабли» оба своих корабля этого дока, активный один');
}

section('вездеход и ангар');
{
    // Каталог по сети отвечает при типах без hangar: строка — не число
    // лётной модели, и сверка «база отстала от кода» её не требует.
    $specs = Api::call('catalog.specs', []);
    $codes = array_column($specs['shipTypes'], 'code');
    ok(in_array('rover', $codes, true) && in_array('prometheus', $codes, true),
        'каталог по сети отвечает: у «Прометея» и вездехода нет hangar — это не отставание базы');

    $rv = Auth::register('pilot_rv', 'secret', 'ВОДИТЕЛЬ');
    $tkv = $rv['token'];
    $pidV = (int) $rv['player_id'];
    $s = Api::call('player.state', [], $tkv);
    $home = (int) $s['ship']['id'];
    ok(array_filter($s['fleet'], fn($x) => $x['carrier'] !== null) === [],
        'даром вездехода нет: новый «Челленджер» — с пустым ангаром');
    // Верфь — в порту с верфью: там вездеход и покупают, в трюм своего корабля.
    $yard = null;
    foreach (Db::all("SELECT `local_id` FROM `body` WHERE `system_id`=0 AND `kind`='station'") as $b) {
        $i = Stations::info(0, (int) $b['local_id']);
        if ($i['services']['outfit'] && $yard === null) $yard = $i;
    }
    Db::update('ship', ['system_id' => 0, 'docked_body' => $yard['localId']], '`id`=?', [$home]);
    $o = Api::call('shipyard.list', [], $tkv);
    ok(!in_array('rover', array_column($o['hulls'], 'code'), true) && $o['hangar']['code'] === 'rover'
        && $o['hangar']['price'] === 24000 && $o['hangar']['for'] === $home && $o['hangar']['have'] === null
        && $o['hangar']['sold'] === true,
        'на верфи вездеход — не корпус в док, а машина в ангар своего корабля: 24 000 кр');
    denies('no_funds', fn() => Api::call('shipyard.buy', ['code' => 'rover'], $tkv), 'без 24 000 кр вездехода не купить');
    Ledger::add($pidV, 'ПРОВЕРКА', 100000, 'test');
    $st = Api::call('shipyard.buy', ['code' => 'rover'], $tkv);
    $rid = (int) $st['bought'];
    $rrow = Players::shipRow($rid);
    $line = Db::row('SELECT * FROM `ledger` WHERE `player_id`=? ORDER BY `id` DESC LIMIT 1', [$pidV]);
    $fv = array_column($st['fleet'], null, 'id');
    ok($rid > 0 && (int) $rrow['carrier_id'] === $home && (int) $rrow['stowed'] === 1
        && (int) $rrow['docked_body'] === $yard['localId'] && $fv[$rid]['type'] === 'rover'
        && (int) $line['amount'] === -24000 && $st['ship']['id'] === $home,
        'купил: вездеход в трюме своего корабля, приписан к нему, в ленте −24 000 кр, пилот в прежнем кресле');
    ok(count(Loadout::modules($rid)) === 0 && (float) $rrow['hull'] === 60.0,
        'модулей корабля у вездехода нет (ensureStock их не ставит), корпус — свой, 60');
    denies('have_rover', fn() => Api::call('shipyard.buy', ['code' => 'rover'], $tkv),
        'второй вездеход в тот же трюм не встаёт');
    ok(Api::call('shipyard.list', [], $tkv)['hangar']['have'] === $rid,
        'и верфь это видит: ангар занят');
    ok(Players::ensureHangar((int) Db::one("SELECT sh.`id` FROM `ship` sh JOIN `ship_type` t ON t.`id`=sh.`type_id`
        WHERE t.`code`='prometheus' LIMIT 1") ?: 0) === null,
        'у «Прометея» ангара нет — и вездехода в нём не будет');
    ok(count(Api::call('shipyard.list', [], $tkv)['here']) === 1,
        'в «Кораблях» дока вездеход не числится: пересаживаются в него не в порту');
    $s = Api::call('player.state', [], $tkv);

    // В порту вездеход не водят.
    denies('not_landed', fn() => Api::call('ship.command', ['id' => $rid], $tkv),
        'из трюма корабля в порту вездеход не вывести');

    // Корабль сел — вездеход в трюме с ним.
    Api::call('station.undock', [], $tkv);
    Api::call('player.save', ['ship' => ['id' => $home, 'system' => 0, 'gear' => true,
        'landed' => ['id' => $L, 'pose' => $poseAt(0.4), 'secured' => true]],
        'me' => ['aboard' => $home, 'seated' => true]], $tkv);
    $rrow = Players::shipRow($rid);
    ok((int) $rrow['landed_body'] === $L && $rrow['landed_pose'] === Players::shipRow($home)['landed_pose']
        && $rrow['docked_body'] === null,
        'корабль сел — вездеход в его трюме там же: место у них одно (carryAlong)');

    // В кресло вездехода — с борта корабля: они рядом.
    Api::call('pilot.move', ['me' => ['aboard' => $rid, 'seated' => true]], $tkv);
    $st = Api::call('ship.command', ['id' => $rid], $tkv);
    ok($st['ship']['id'] === $rid && $st['ship']['type']['code'] === 'rover' && $st['ship']['stowed'] === true
        && $st['ship']['carrier'] === $home && $st['position']['landedBody'] === $L,
        'командует вездеходом в трюме: тип rover, носитель и «в трюме» — в состоянии');

    // Стоит в трюме — своё место сохранением не пишется.
    $far = ['id' => $L, 'pos' => ['x' => 3.0, 'y' => $R, 'z' => 0], 'fwd' => ['x' => 0, 'y' => 0, 'z' => 1],
        'up' => ['x' => 0, 'y' => 1, 'z' => 0]];
    Api::call('player.save', ['ship' => ['id' => $rid, 'system' => 0, 'anchor' => $far, 'landed' => null]], $tkv);
    $rrow = Players::shipRow($rid);
    ok((int) $rrow['stowed'] === 1 && (int) $rrow['landed_body'] === $L && $rrow['anchor_body'] === null,
        'в трюме место вездехода — носителя: точку за три километра сохранение не пишет');
    // Съезд за три километра от корабля — не съезд с платформы.
    Api::call('player.save', ['ship' => ['id' => $rid, 'system' => 0, 'stowed' => false, 'anchor' => $far,
        'landed' => null]], $tkv);
    ok((int) Players::shipRow($rid)['stowed'] === 1,
        'съехать из трюма за три километра от корабля нельзя: место не пишется, он в трюме');
    // Съезд у самого корабля: пятнадцать метров вбок.
    $near = $far;
    $near['pos'] = ['x' => 0.4 + 0.015, 'y' => $R + 0.006, 'z' => 0];
    Api::call('player.save', ['ship' => ['id' => $rid, 'system' => 0, 'stowed' => false, 'anchor' => $near,
        'landed' => null]], $tkv);
    $rrow = Players::shipRow($rid);
    ok((int) $rrow['stowed'] === 0 && (int) $rrow['anchor_body'] === $L && $rrow['landed_body'] === null,
        'съехал у корабля: в трюме его больше нет, место — своё');
    // Отставшая стоянка носителя от игры у съехавшего вездехода не пишется:
    // при входе он встал бы в середину корабля над грунтом и упал оттуда.
    Api::call('player.save', ['ship' => ['id' => $rid, 'system' => 0, 'anchor' => $near,
        'landed' => ['id' => $L, 'pose' => $poseAt(0.4), 'secured' => true]]], $tkv);
    $rrow = Players::shipRow($rid);
    ok($rrow['landed_body'] === null && (int) $rrow['anchor_body'] === $L,
        'стоянку вездеход не получает: его место — точка в осях тела, а не стоянка носителя');
    $st = Api::call('player.state', [], $tkv);
    $fv = array_column($st['fleet'], null, 'id');
    ok($st['ship']['stowed'] === false && $fv[$rid]['stowed'] === false && $fv[$rid]['carrier'] === $home,
        'и в состоянии, и во флоте он на грунте, но приписан к своему кораблю');
    // Уехал — его место пишется любое, но «в трюм» издалека не встать.
    Api::call('player.save', ['ship' => ['id' => $rid, 'system' => 0, 'stowed' => true, 'anchor' => $far,
        'landed' => null]], $tkv);
    $rrow = Players::shipRow($rid);
    ok((int) $rrow['stowed'] === 0 && abs(json_decode($rrow['anchor_pose'], true)['pos']['x'] - 3.0) < 1e-9,
        'уехал за три километра: место пишется, а «в трюм» оттуда не встать');
    Api::call('player.save', ['ship' => ['id' => $rid, 'system' => 0, 'stowed' => true, 'anchor' => $near,
        'landed' => null]], $tkv);
    $rrow = Players::shipRow($rid);
    ok((int) $rrow['stowed'] === 1 && (int) $rrow['landed_body'] === $L && $rrow['anchor_body'] === null,
        'вернулся к кораблю и встал в трюм: место снова носителя');

    // Порт и буксир — не для вездехода.
    $port = (int) $s['position']['dockedBody'];
    denies('ground', fn() => Api::call('station.dock', ['system' => 0, 'station' => $port], $tkv),
        'вездеход в порт не встаёт');
    denies('ground', fn() => Api::call('ship.rescue', [], $tkv), 'буксир за вездеходом не прилетает');

    // Гибель вездехода далеко от корабля — снова в трюме, целый, водитель в кресле.
    Api::call('player.save', ['ship' => ['id' => $rid, 'system' => 0, 'stowed' => false, 'anchor' => $near,
        'landed' => null]], $tkv);
    Api::call('player.save', ['ship' => ['id' => $rid, 'system' => 0, 'anchor' => $far, 'landed' => null]], $tkv);
    Db::update('ship', ['hull' => 3], '`id`=?', [$rid]);
    Combat::respawnShip($rid);
    $rrow = Players::shipRow($rid);
    $pv = Players::byId($pidV);
    ok((int) $rrow['stowed'] === 1 && (float) $rrow['hull'] === 60.0 && (int) $rrow['landed_body'] === $L
        && (int) $pv['aboard_ship'] === $rid && (int) $pv['ship_id'] === $rid && (int) $pv['seated'] === 1,
        'вездеход погиб — снова в трюме своего корабля, целый, водитель в его кресле');
    // Гибель корабля: он в порт, и вездеход, где бы ни стоял, — с ним.
    Api::call('player.save', ['ship' => ['id' => $rid, 'system' => 0, 'stowed' => false, 'anchor' => $near,
        'landed' => null]], $tkv);
    Combat::respawnShip($home);
    $rrow = Players::shipRow($rid);
    $hrow = Players::shipRow($home);
    ok((int) $rrow['stowed'] === 1 && $hrow['docked_body'] !== null
        && (int) $rrow['docked_body'] === (int) $hrow['docked_body'],
        'корабль погиб — в порт, и его вездеход снова в трюме, в том же порту');

    // С верфи «Челленджер» — с пустым ангаром: вездеход к нему покупают отдельно.
    Ledger::add($pidV, 'ПРОВЕРКА', 200000, 'test');
    Db::update('ship', ['docked_body' => $yard['localId'], 'landed_body' => null], '`id`=?', [$home]);
    Players::carryAlong($home);
    $st = Api::call('shipyard.buy', ['code' => 'challenger'], $tkv);
    $bought = (int) $st['bought'];
    ok($bought > 0 && Players::roverOf($bought) === null,
        'купленный «Челленджер» — с пустым ангаром: вездеход к нему покупают отдельно');
}

// Перенос со схемы 9: место корабля лежало в строке пилота. Живой пилот,
// стоявший на грунте, обязан остаться на грунте, а не очутиться в порту.
$old = ['pos_x' => 'DOUBLE NOT NULL DEFAULT 0', 'pos_y' => 'DOUBLE NOT NULL DEFAULT 0',
    'pos_z' => 'DOUBLE NOT NULL DEFAULT 0', 'basis' => 'TEXT NULL', 'docked_body' => 'INT NULL',
    'landed_body' => 'INT NULL', 'landed_pose' => 'TEXT NULL',
    'landed_secured' => 'TINYINT(1) NOT NULL DEFAULT 0', 'anchor_body' => 'INT NULL',
    'anchor_pose' => 'TEXT NULL'];
foreach ($old as $c => $ddl) {
    Db::run('ALTER TABLE `player` ADD COLUMN `' . $c . '` ' . $ddl);
}
$rc = Auth::register('pilot_c', 'secret', 'ПИЛОТ В');
$shipC = (int) Players::ship($rc['player_id'])['id'];
Db::update('ship', ['docked_body' => null], '`id`=?', [$shipC]);
Db::update('player', ['landed_body' => $L, 'landed_pose' => json_encode($poseAt(1.5)), 'landed_secured' => 1,
    'aboard_ship' => null, 'docked_body' => null], '`id`=?', [$rc['player_id']]);
$made = Schema::migrate();
$rowC = Players::shipRow($shipC);
$cols = array_column(Db::all('SHOW COLUMNS FROM `player`'), 'Field');
ok((int) $rowC['landed_body'] === $L && (int) $rowC['landed_secured'] === 1
    && (int) Players::byId($rc['player_id'])['aboard_ship'] === $shipC
    && !in_array('landed_body', $cols, true) && in_array('-player.landed_body', $made, true),
    'перенос со схемы 9: стоянка переехала к кораблю, пилот в его кресле, старые столбцы снесены');

// --- станция изнутри: площадки, помещения, хранилище -------------------------

section('станция изнутри: площадки и помещения');
{
    // Каталог: площадки и помещения у каждой станции — из планировки
    // генератора (js/game/stationplan.js), от шести до десяти площадок и от
    // десяти до двадцати помещений.
    $per = Db::all("SELECT b.`id`, b.`name`,
            (SELECT COUNT(*) FROM `station_pad` sp WHERE sp.`station_id`=b.`id`) AS `pads`,
            (SELECT COUNT(*) FROM `station_room` r WHERE r.`station_id`=b.`id`) AS `rooms`,
            st.`pads` AS `berths`
         FROM `body` b JOIN `station` st ON st.`body_id`=b.`id` WHERE b.`kind`='station'");
    $bad = array_filter($per, static function ($r) {
        return $r['pads'] < 6 || $r['pads'] > 10 || $r['rooms'] < 10 || $r['rooms'] > 20 || (int) $r['berths'] !== (int) $r['pads'];
    });
    ok($per && !$bad, 'у всех ' . count($per) . ' станций 6–10 площадок и 10–20 помещений, мест у причала — по площадкам'
        . ($bad ? ': ' . implode(', ', array_column($bad, 'name')) : ''));
    $shops = (int) Db::one("SELECT COUNT(*) FROM `station_room` WHERE `kind`='shop' AND `shop` IS NOT NULL");
    $gates = (int) Db::one("SELECT COUNT(*) FROM `station_room` WHERE `kind`='gate' AND `pad` IS NOT NULL");
    ok($shops > 0 && $gates === (int) Db::one('SELECT COUNT(*) FROM `station_pad`'),
        "лавки помечены видом будущей лавки ($shops), у каждой площадки свой зал ожидания ($gates)");
    // Хозяин лавки переживает перезаливку каталога: помещения обновляются
    // на месте, по коду, а не сносятся.
    $room = Db::row("SELECT * FROM `station_room` WHERE `kind`='shop' ORDER BY `id` LIMIT 1");
    Db::update('station_room', ['tenant_id' => 42], '`id`=?', [(int) $room['id']]);
    Seeder::catalog($catalog);
    $again = Db::row('SELECT * FROM `station_room` WHERE `id`=?', [(int) $room['id']]);
    ok($again !== null && (int) $again['tenant_id'] === 42 && $again['code'] === $room['code'],
        'перезаливка каталога не уносит хозяина лавки: ' . $room['name']);
    Db::update('station_room', ['tenant_id' => null], '`id`=?', [(int) $room['id']]);

    // Новый пилот — на площадке в зале родного порта, с позой на её середине.
    $ra = Auth::register('pad_a', 'secret', 'ПЛОЩАДКА А');
    $ta = $ra['token'];
    $sa = Api::call('player.state', [], $ta);
    $home = (int) $sa['position']['dockedBody'];
    $berthA = $sa['position']['berth'];
    ok($berthA !== null && is_int($berthA['pad']) && $berthA['stored'] === false
        && abs($berthA['pose']['up']['y'] - 1) < 1e-9,
        'новый корабль стоит на площадке ' . ($berthA['pad'] ?? '—') . ' в зале порта, а не «в доке вообще»');

    // С корабля на площадке — по трапу на пол зала (js/game/stationwalk.js):
    // опора — сама станция, место пилота — в её осях, как на грунте — в
    // осях тела. И обратно на борт — с пола рядом с кораблём.
    $pa = $berthA['pose']['pos'];
    $shipA0 = (int) Players::ship($ra['player_id'])['id'];
    $floor = static fn($dx) => ['system' => 0, 'out' => ['body' => $home,
        'o' => ['x' => $pa['x'] + $dx, 'y' => $pa['y'] - 0.004, 'z' => $pa['z']],
        'f' => ['x' => 0, 'y' => 0, 'z' => 1], 'pitch' => 0]];
    $mv = Api::call('pilot.move', ['me' => $floor(0.012)], $ta);
    $sw = Api::call('player.state', [], $ta);
    ok($mv['moved'] === true && $sw['me']['aboard'] === null && $sw['me']['out']['body'] === $home
        && $sw['position']['dockedBody'] === $home,
        'с корабля на площадке — на пол зала: пилот в осях станции, корабль в порту');
    $mv = Api::call('pilot.move', ['me' => ['aboard' => $shipA0, 'own' => true, 'seated' => true]], $ta);
    ok($mv['moved'] === true && $mv['me']['aboard'] === $shipA0, 'с пола зала у трапа — снова на борту, в кресле');
    // А с корабля в хранилище порта на пол не сойти: его нет на площадке.
    $farFloor = Api::call('pilot.move', ['me' => $floor(0.9)], $ta);
    ok($farFloor['moved'] === false && $farFloor['denied'] === 'too_far',
        'сойти на пол зала в 900 м от своего корабля нельзя: это не трап');

    // Второй пилот в том же порту, пока первый в игре, — на другой площадке.
    Db::update('player', ['online' => 1], '`id`=?', [$ra['player_id']]);
    $rb = Auth::register('pad_b', 'secret', 'ПЛОЩАДКА Б');
    $tb = $rb['token'];
    $sb = Api::call('player.state', [], $tb);
    ok($sb['position']['berth']['pad'] !== $berthA['pad'], 'второй корабль того же порта — на другой площадке: '
        . $sb['position']['berth']['pad']);

    // Площадку держит стоящий на ней (его хозяин в игре — ведёт хаб):
    // сесть на чужую нельзя.
    Db::update('player', ['online' => 1], '`id`=?', [$ra['player_id']]);
    Api::call('station.undock', [], $tb);
    denies('pad_busy', fn() => Api::call('station.dock', ['system' => 0, 'station' => $home, 'pad' => $berthA['pad']], $tb),
        'на занятую площадку не встать');
    // Площадка — по просьбе: порт выдаёт свободную и держит её за кораблём.
    $req = Api::call('station.request', ['system' => 0, 'station' => $home], $tb);
    $req2 = Api::call('station.request', ['system' => 0, 'station' => $home], $tb);
    ok(is_int($req['pad']) && $req['pad'] !== $berthA['pad'] && $req2['pad'] === $req['pad'],
        'порт выдаёт свободную площадку (' . $req['pad'] . ') и повторная просьба — та же');
    // Встал на выданную, с позой из игры.
    $pose = ['pos' => ['x' => 0.08, 'y' => -0.14, 'z' => 0.05], 'fwd' => ['x' => 0, 'y' => 0, 'z' => 1], 'up' => ['x' => 0, 'y' => 1, 'z' => 0]];
    $d = Api::call('station.dock', ['system' => 0, 'station' => $home, 'pad' => $req['pad'], 'pose' => $pose], $tb);
    $sb = Api::call('player.state', [], $tb);
    ok($d['pad'] === $req['pad'] && $sb['position']['berth']['pad'] === $req['pad']
        && abs($sb['position']['berth']['pose']['pos']['x'] - 0.08) < 1e-9,
        'встал на выданную площадку: номер и поза на полу зала — в базе');
    // Кривая поза из чужих рук в базу не идёт — площадка ставит свою.
    Api::call('station.undock', [], $tb);
    Api::call('station.dock', ['system' => 0, 'station' => $home, 'pad' => $req['pad'],
        'pose' => ['pos' => ['x' => 'NaN', 'y' => 9e9, 'z' => 0], 'fwd' => ['x' => 0, 'y' => 0, 'z' => 7]]], $tb);
    $pb = Api::call('player.state', [], $tb)['position']['berth']['pose'];
    ok(is_array($pb) && abs($pb['pos']['y']) < 1 && abs($pb['up']['y'] - 1) < 1e-9,
        'поза с мусором не пишется: корабль на середине площадки');
    // Взлетел — площадка свободна сразу.
    Api::call('station.undock', [], $tb);
    ok(!in_array($req['pad'], Stations::busyPads(0, $home, -1), true), 'взлетел — площадка свободна');
    // Сел мимо площадок — тоже в порту.
    $d0 = Api::call('station.dock', ['system' => 0, 'station' => $home], $tb);
    ok($d0['pad'] === null && Api::call('player.state', [], $tb)['position']['dockedBody'] === $home,
        'сел на пол зала мимо площадок — в порту, без площадки');

    // Крупному кораблю малая площадка мала.
    $small = (int) Db::one("SELECT sp.`n` FROM `station_pad` sp JOIN `body` b ON b.`id`=sp.`station_id`
        WHERE b.`system_id`=0 AND b.`local_id`=? AND sp.`size`='S' ORDER BY sp.`n` LIMIT 1", [$home]);
    $shipB = (int) Players::ship($rb['player_id'])['id'];
    $prom = (int) Db::one("SELECT `id` FROM `ship_type` WHERE `code`='prometheus'");
    $chal = (int) Db::one("SELECT `id` FROM `ship_type` WHERE `code`='challenger'");
    Db::update('ship', ['type_id' => $prom], '`id`=?', [$shipB]);
    Api::call('station.undock', [], $tb);
    denies('pad_small', fn() => Api::call('station.dock', ['system' => 0, 'station' => $home, 'pad' => $small], $tb),
        '«Прометей» на малую площадку не встаёт');
    $rp = Api::call('station.request', ['system' => 0, 'station' => $home], $tb);
    $size = Db::one('SELECT sp.`size` FROM `station_pad` sp JOIN `body` b ON b.`id`=sp.`station_id`
        WHERE b.`system_id`=0 AND b.`local_id`=? AND sp.`n`=?', [$home, $rp['pad']]);
    ok($size === 'L', 'крейсеру порт выдаёт большую площадку: ' . $rp['pad']);
    Db::update('ship', ['type_id' => $chal], '`id`=?', [$shipB]);
    Api::call('station.dock', ['system' => 0, 'station' => $home], $tb);

    // Хозяин вышел из игры — его корабль из мира ушёл, и площадка под ним
    // для остальных свободна; вернулся, а на ней другой, — встаёт на свободную.
    Db::update('player', ['online' => 0], '`id`=?', [$ra['player_id']]);
    Api::call('station.undock', [], $tb);
    Api::call('station.dock', ['system' => 0, 'station' => $home, 'pad' => $berthA['pad']], $tb);
    Db::update('player', ['online' => 1], '`id`=?', [$rb['player_id']]);
    $back = Api::call('player.state', [], $ta)['position']['berth'];
    ok($back['pad'] !== $berthA['pad'] && $back['pad'] !== null,
        'пока хозяина не было, на его площадку сел другой — вернувшись, он стоит на площадке ' . $back['pad']);
    Db::update('player', ['online' => 0], '`id`=?', [$rb['player_id']]);
    Api::call('station.undock', [], $tb);
    Api::call('station.dock', ['system' => 0, 'station' => $home], $tb);

    // Площадки и помещения — по сети.
    $lay = Api::call('station.layout', ['system' => 0, 'station' => $home]);
    ok(count($lay['pads']) >= 6 && count($lay['rooms']) >= 10
        && count(array_filter($lay['rooms'], fn($r) => $r['kind'] === 'shop' || $r['kind'] === 'bar')) > 0,
        'station.layout: площадок ' . count($lay['pads']) . ', помещений ' . count($lay['rooms']));

    // Хранилище порта: купленный корабль — в нём, а не на площадке.
    Ledger::add($ra['player_id'], 'ПРОВЕРКА', 300000, 'test');
    $capital = (int) Db::one("SELECT b.`local_id` FROM `station` st JOIN `body` b ON b.`id`=st.`body_id`
        WHERE st.`system_id`=0 AND st.`has_outfit`=1 ORDER BY st.`tech` DESC LIMIT 1");
    $shipA = (int) Players::ship($ra['player_id'])['id'];
    Db::update('ship', ['docked_body' => $capital, 'berth_station' => $capital], '`id`=?', [$shipA]);
    Stations::park($shipA, 0, $capital);
    $padA = (int) Players::shipRow($shipA)['pad'];
    $bought = Api::call('shipyard.buy', ['code' => 'challenger'], $ta);
    $nb = Players::shipRow((int) $bought['bought']);
    ok((int) $nb['stored'] === 1 && $nb['pad'] === null && (int) $nb['docked_body'] === $capital,
        'купленный корабль — в хранилище порта, а не на площадке');
    // Вызвать его: он поднимается на площадку прежнего, прежний — в хранилище,
    // пилот — в кресле вызванного.
    $sr = Api::call('ship.retrieve', ['id' => (int) $bought['bought']], $ta);
    $old = Players::shipRow($shipA);
    $nb = Players::shipRow((int) $bought['bought']);
    ok($sr['ship']['id'] === (int) $bought['bought'] && $sr['me']['aboard'] === (int) $bought['bought']
        && $sr['me']['seated'] === true && (int) $nb['pad'] === $padA && (int) $nb['stored'] === 0
        && (int) $old['stored'] === 1 && $old['pad'] === null && $nb['dock_pose'] !== null,
        'вызван из хранилища: на площадке ' . $padA . ' вместо прежнего, пилот в его кресле, прежний — в хранилище');
    // И обратно — пересадкой (ship.command): корабль в хранилище вызывается сам.
    $sc = Api::call('ship.command', ['id' => $shipA], $ta);
    ok($sc['ship']['id'] === $shipA && (int) Players::shipRow($shipA)['stored'] === 0
        && (int) Players::shipRow((int) $bought['bought'])['stored'] === 1,
        'пересадка в корабль из хранилища — тот же вызов: он на площадке, второй — в хранилище');
    // Чужой корабль не вызвать, и не из своего порта — тоже.
    denies('not_owner', fn() => Api::call('ship.retrieve', ['id' => $shipB], $ta), 'чужой корабль не вызвать');
}

// --- итог --------------------------------------------------------------------

echo PHP_EOL . ($fails === 0
    ? "ВСЕ ПРОВЕРКИ СЕРВЕРА ПРОЙДЕНЫ ($checks)"
    : "$fails ПРОВЕРОК УПАЛО из $checks") . PHP_EOL;
exit($fails ? 1 : 0);
