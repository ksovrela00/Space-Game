<?php
/**
 * Учётные записи и сессии.
 *
 * Пароль хранится только хешем (password_hash, по умолчанию bcrypt) — и
 * проверяется сравнением хешей, а не строк. Токен сессии — 32 случайных
 * байта из random_bytes: это криптостойкий источник, в отличие от rand(),
 * который по значению одного токена позволяет предсказать следующий.
 *
 * Честно про нынешний уровень защиты: соединение локальное и без TLS, то
 * есть токен идёт по сети открытым. Для машины разработчика это ничего не
 * меняет, но выставлять такой сервер наружу нельзя — сначала https.
 */

final class Auth
{
    public const TOKEN_DAYS = 30;
    public const MIN_PASS = 4;

    public static function register(string $login, string $pass, string $name = ''): array
    {
        $login = trim($login);
        if (!preg_match('/^[A-Za-z0-9_-]{3,32}$/', $login)) {
            throw ApiError::bad('логин: 3–32 знака, латиница, цифры, «-» и «_»');
        }
        if (mb_strlen($pass) < self::MIN_PASS) {
            throw ApiError::bad('пароль короче ' . self::MIN_PASS . ' знаков');
        }
        if (Db::one('SELECT `id` FROM `player` WHERE `login`=?', [$login]) !== null) {
            throw ApiError::denied('login_taken', 'такой логин уже занят');
        }
        // Имя приходит с формы регистрации, то есть из чужих рук. Режется
        // по тридцати двум знакам не ради красоты: в столбец VARCHAR(64)
        // более длинное не влезает вовсе, и вместо учётной записи человек
        // получил бы ошибку базы. Управляющие знаки убираются по той же
        // причине, по какой имя вообще проверяется: его видят другие
        // игроки в списке и рядом с кораблём.
        $name = trim(preg_replace('/[\x00-\x1f\x7f]+/u', ' ', $name));
        $name = mb_substr($name, 0, 32);

        return Db::tx(function () use ($login, $pass, $name) {
            $playerId = Players::create($login, password_hash($pass, PASSWORD_DEFAULT), $name ?: $login);
            return ['player_id' => $playerId, 'token' => self::openSession($playerId)];
        });
    }

    public static function login(string $login, string $pass): array
    {
        $row = Db::row('SELECT `id`,`pass_hash` FROM `player` WHERE `login`=?', [trim($login)]);
        // Один и тот же ответ на «нет такого логина» и «неверный пароль»:
        // разные ответы превращают форму входа в список существующих
        // игроков.
        if ($row === null || !password_verify($pass, $row['pass_hash'])) {
            throw ApiError::auth('логин или пароль не подходят');
        }
        $id = (int) $row['id'];
        Db::update('player', ['last_seen_at' => Db::now()], '`id`=?', [$id]);
        return ['player_id' => $id, 'token' => self::openSession($id)];
    }

    public static function openSession(int $playerId): string
    {
        $token = bin2hex(random_bytes(32));
        Db::insert('session', [
            'token' => $token,
            'player_id' => $playerId,
            'created_at' => Db::now(),
            'last_seen_at' => Db::now(),
            'expires_at' => Db::at(self::TOKEN_DAYS * 86400),
        ]);
        return $token;
    }

    /** Игрок по токену. Просроченные сессии не работают и убираются. */
    public static function playerByToken(?string $token): ?int
    {
        if (!$token || !preg_match('/^[0-9a-f]{64}$/', $token)) {
            return null;
        }
        $row = Db::row('SELECT `player_id`,`expires_at` FROM `session` WHERE `token`=?', [$token]);
        if ($row === null) {
            return null;
        }
        if ($row['expires_at'] < Db::now()) {
            Db::run('DELETE FROM `session` WHERE `token`=?', [$token]);
            return null;
        }
        Db::update('session', ['last_seen_at' => Db::now()], '`token`=?', [$token]);
        return (int) $row['player_id'];
    }

    public static function logout(string $token): void
    {
        Db::run('DELETE FROM `session` WHERE `token`=?', [$token]);
    }

    /** Убрать протухшие сессии (вызывается обслуживанием, не запросом). */
    public static function sweep(): int
    {
        return Db::run('DELETE FROM `session` WHERE `expires_at` < ?', [Db::now()])->rowCount();
    }
}
