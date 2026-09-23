<?php
/**
 * Разбор запросов: один список маршрутов и ничего больше.
 *
 * Маршруты плоские (`market.buy`, а не `POST /market/buy`) намеренно: так
 * они одинаково работают и через HTTP, и прямым вызовом из проверок. А
 * проверки ходят именно прямым вызовом — поднимать для них Apache значит
 * проверять заодно и его настройку, и падать потом по причинам, к серверу
 * игры отношения не имеющим.
 *
 * Кто требует входа, видно в одном месте — в списке ниже, а не в теле
 * обработчиков. Забыть проверку токена так нельзя.
 */

final class Api
{
    /** Маршрут => [обработчик, нужен ли токен]. */
    public static function routes(): array
    {
        return [
            'ping' => [[self::class, 'ping'], false],
            'auth.register' => [[self::class, 'authRegister'], false],
            'auth.login' => [[self::class, 'authLogin'], false],
            'auth.logout' => [[self::class, 'authLogout'], true],
            'galaxy.systems' => [[self::class, 'galaxySystems'], false],
            'galaxy.system' => [[self::class, 'galaxySystem'], false],
            'galaxy.stations' => [[self::class, 'galaxyStations'], false],
            'station.info' => [[self::class, 'stationInfo'], false],
            'station.dock' => [[self::class, 'stationDock'], true],
            'station.repair' => [[self::class, 'stationRepair'], true],
            'catalog.commodities' => [[self::class, 'commodities'], false],
            'catalog.ships' => [[self::class, 'shipTypes'], false],
            'player.state' => [[self::class, 'playerState'], true],
            'player.save' => [[self::class, 'playerSave'], true],
            'market.prices' => [[self::class, 'marketPrices'], true],
            'market.buy' => [[self::class, 'marketBuy'], true],
            'market.sell' => [[self::class, 'marketSell'], true],
            'missions.board' => [[self::class, 'missionBoard'], true],
            'missions.accept' => [[self::class, 'missionAccept'], true],
            'missions.complete' => [[self::class, 'missionComplete'], true],
            'missions.abandon' => [[self::class, 'missionAbandon'], true],
            'ledger.list' => [[self::class, 'ledgerList'], true],
        ];
    }

    /**
     * Выполнить маршрут.
     *
     * @param string      $route имя маршрута
     * @param array       $in    тело запроса
     * @param string|null $token токен сессии
     */
    public static function call(string $route, array $in = [], ?string $token = null): array
    {
        $routes = self::routes();
        if (!isset($routes[$route])) {
            throw ApiError::notFound('нет такого вызова: ' . $route);
        }
        [$fn, $needsAuth] = $routes[$route];

        $playerId = Auth::playerByToken($token);
        if ($needsAuth && $playerId === null) {
            throw ApiError::auth();
        }
        return $fn($in, $playerId);
    }

    // --- общее ---------------------------------------------------------

    private static function str(array $in, string $key, string $def = ''): string
    {
        return isset($in[$key]) && is_scalar($in[$key]) ? trim((string) $in[$key]) : $def;
    }

    private static function int(array $in, string $key, ?int $def = null): ?int
    {
        return isset($in[$key]) && is_numeric($in[$key]) ? (int) $in[$key] : $def;
    }

    private static function float(array $in, string $key, float $def = 0.0): float
    {
        return isset($in[$key]) && is_numeric($in[$key]) ? (float) $in[$key] : $def;
    }

    /**
     * Где игрок стоит. Станцию можно указать явно, но по умолчанию берётся
     * та, в которой он состыкован: клиент не должен пересказывать серверу
     * то, что сервер и так знает.
     */
    private static function whereDocked(int $playerId, array $in): array
    {
        $p = Players::byId($playerId);
        $sys = self::int($in, 'system', $p['system_id'] === null ? null : (int) $p['system_id']);
        $loc = self::int($in, 'station', $p['docked_body'] === null ? null : (int) $p['docked_body']);
        if ($sys === null || $loc === null) {
            throw ApiError::denied('not_docked', 'корабль не в порту');
        }
        return [$sys, $loc];
    }

    // --- обработчики ---------------------------------------------------

    public static function ping(array $in, ?int $playerId): array
    {
        return [
            'ok' => true,
            'schema' => (int) Schema::meta('schema_version', '0'),
            'galaxySeed' => (int) Schema::meta('galaxy_seed', '0'),
            'catalogSeededAt' => Schema::meta('catalog_seeded_at'),
            'systems' => (int) Db::one('SELECT COUNT(*) FROM `star_system`'),
            'bodies' => (int) Db::one('SELECT COUNT(*) FROM `body`'),
            'players' => (int) Db::one('SELECT COUNT(*) FROM `player`'),
            'authed' => $playerId !== null,
            'serverTime' => Db::now(),
        ];
    }

    public static function authRegister(array $in, ?int $playerId): array
    {
        return Auth::register(self::str($in, 'login'), self::str($in, 'pass'), self::str($in, 'name'));
    }

    public static function authLogin(array $in, ?int $playerId): array
    {
        return Auth::login(self::str($in, 'login'), self::str($in, 'pass'));
    }

    public static function authLogout(array $in, ?int $playerId): array
    {
        Auth::logout(self::str($in, 'token'));
        return ['ok' => true];
    }

    public static function galaxySystems(array $in, ?int $playerId): array
    {
        return ['systems' => Galaxy::systems()];
    }

    public static function galaxySystem(array $in, ?int $playerId): array
    {
        $id = self::int($in, 'id');
        if ($id === null) {
            throw ApiError::bad('нужен номер системы');
        }
        return Galaxy::system($id);
    }

    public static function galaxyStations(array $in, ?int $playerId): array
    {
        $id = self::int($in, 'system');
        if ($id === null) {
            throw ApiError::bad('нужен номер системы');
        }
        return ['stations' => Stations::listOf($id)];
    }

    public static function stationInfo(array $in, ?int $playerId): array
    {
        $sys = self::int($in, 'system');
        $loc = self::int($in, 'station');
        if ($sys === null || $loc === null) {
            throw ApiError::bad('нужен порт: система и номер тела');
        }
        return ['station' => Stations::info($sys, $loc)];
    }

    public static function stationDock(array $in, ?int $playerId): array
    {
        return Stations::dock($playerId, self::int($in, 'system'), self::int($in, 'station'));
    }

    public static function stationRepair(array $in, ?int $playerId): array
    {
        return Stations::repair($playerId);
    }

    public static function commodities(array $in, ?int $playerId): array
    {
        $rows = Db::all('SELECT `code`,`name`,`category`,`base_price`,`legal` FROM `commodity` ORDER BY `base_price`');
        foreach ($rows as &$r) {
            $r['base_price'] = (int) $r['base_price'];
            $r['legal'] = (bool) $r['legal'];
        }
        return ['commodities' => $rows];
    }

    public static function shipTypes(array $in, ?int $playerId): array
    {
        return [
            'shipTypes' => Db::all('SELECT * FROM `ship_type` ORDER BY `id`'),
            'equipment' => Db::all('SELECT `code`,`name`,`slot`,`price`,`stock` FROM `equipment_type` ORDER BY `id`'),
        ];
    }

    public static function playerState(array $in, ?int $playerId): array
    {
        return Players::state($playerId);
    }

    public static function playerSave(array $in, ?int $playerId): array
    {
        return Players::save($playerId, is_array($in['save'] ?? null) ? $in['save'] : $in);
    }

    public static function marketPrices(array $in, ?int $playerId): array
    {
        [$sys, $loc] = self::whereDocked($playerId, $in);
        return Market::prices($sys, $loc);
    }

    public static function marketBuy(array $in, ?int $playerId): array
    {
        return Market::buy($playerId, self::str($in, 'code'), self::float($in, 'tons'));
    }

    public static function marketSell(array $in, ?int $playerId): array
    {
        return Market::sell($playerId, self::str($in, 'code'), self::float($in, 'tons'));
    }

    public static function missionBoard(array $in, ?int $playerId): array
    {
        [$sys, $loc] = self::whereDocked($playerId, $in);
        return ['board' => Missions::board($sys, $loc)];
    }

    public static function missionAccept(array $in, ?int $playerId): array
    {
        $id = self::int($in, 'id');
        if ($id === null) {
            throw ApiError::bad('нужен номер задания');
        }
        return ['mission' => Missions::accept($playerId, $id)];
    }

    public static function missionComplete(array $in, ?int $playerId): array
    {
        $id = self::int($in, 'id');
        if ($id === null) {
            throw ApiError::bad('нужен номер задания');
        }
        return Missions::complete($playerId, $id);
    }

    public static function missionAbandon(array $in, ?int $playerId): array
    {
        $id = self::int($in, 'id');
        if ($id === null) {
            throw ApiError::bad('нужен номер задания');
        }
        return Missions::abandon($playerId, $id);
    }

    public static function ledgerList(array $in, ?int $playerId): array
    {
        return [
            'ledger' => Ledger::tail($playerId, self::int($in, 'limit', 40)),
            'totals' => Ledger::totals($playerId),
            'balance' => (int) Db::one('SELECT `balance` FROM `player` WHERE `id`=?', [$playerId]),
        ];
    }
}
