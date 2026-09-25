<?php
/**
 * Пилоты из командной строки.
 *
 *   php server/cli/player.php list
 *   php server/cli/player.php add <логин> <пароль> [имя]
 *   php server/cli/player.php pass <логин> <новый пароль>
 *   php server/cli/player.php drop <логин>
 *
 * Регистрация есть и на странице входа (login.html) — тот же Auth::register.
 * Отсюда она осталась для того, что через форму не сделать: завести игрока
 * без браузера, сменить забытый пароль и удалить учётную запись.
 *
 * Честно про уровень: регистрация открыта всякому, кто дотянется до
 * сервера. В локальной сети это то, что нужно; наружу такой сервер
 * выставлять нельзя и без неё — сначала https (README, «Сервер»).
 */

require_once __DIR__ . '/../boot.php';

$cmd = $argv[1] ?? 'list';
$say = static function (string $s): void {
    echo $s, PHP_EOL;
};

try {
    Db::pdo();

    if ($cmd === 'list') {
        $rows = Db::all(
            'SELECT p.`id`, p.`login`, p.`name`, p.`balance`, p.`last_seen_at`,
                    s.`name` AS `system`, sh.`hull`
             FROM `player` p
             LEFT JOIN `star_system` s ON s.`id` = p.`system_id`
             LEFT JOIN `ship` sh ON sh.`owner_id` = p.`id`
             ORDER BY p.`id`'
        );
        if (!$rows) {
            $say('пилотов нет. Завести: php server/cli/player.php add <логин> <пароль>');
            exit(0);
        }
        foreach ($rows as $r) {
            $say(sprintf('#%-3d %-16s %-16s %8d кр  корпус %3d%%  %s  вход %s',
                $r['id'], $r['login'], $r['name'], $r['balance'],
                (int) $r['hull'], $r['system'] ?? '—', $r['last_seen_at'] ?? 'никогда'));
        }
        exit(0);
    }

    if ($cmd === 'add') {
        $login = $argv[2] ?? '';
        $pass = $argv[3] ?? '';
        $name = $argv[4] ?? $login;
        if ($login === '' || $pass === '') {
            throw new RuntimeException('нужны логин и пароль');
        }
        $r = Auth::register($login, $pass, $name);
        $say('пилот заведён: #' . $r['player_id'] . ' ' . $login);
        $st = Players::state($r['player_id']);
        $say('  корабль ' . $st['ship']['type']['name'] . ', баланс '
            . $st['player']['balance'] . ' кр, порт родной системы');
        exit(0);
    }

    if ($cmd === 'pass') {
        $login = $argv[2] ?? '';
        $pass = $argv[3] ?? '';
        if ($login === '' || mb_strlen($pass) < Auth::MIN_PASS) {
            throw new RuntimeException('нужны логин и пароль не короче ' . Auth::MIN_PASS);
        }
        $id = Db::one('SELECT `id` FROM `player` WHERE `login`=?', [$login]);
        if ($id === null) {
            throw new RuntimeException('нет такого пилота: ' . $login);
        }
        Db::update('player', ['pass_hash' => password_hash($pass, PASSWORD_DEFAULT)], '`id`=?', [$id]);
        // Старые сессии после смены пароля не живут: иначе «сменил пароль»
        // не значит ровно ничего для того, кто уже вошёл.
        $n = Db::run('DELETE FROM `session` WHERE `player_id`=?', [$id])->rowCount();
        $say('пароль сменён, закрыто сессий: ' . $n);
        exit(0);
    }

    if ($cmd === 'drop') {
        $login = $argv[2] ?? '';
        $id = Db::one('SELECT `id` FROM `player` WHERE `login`=?', [$login]);
        if ($id === null) {
            throw new RuntimeException('нет такого пилота: ' . $login);
        }
        // Корабль, трюм, лента и сессии уйдут за ним по внешним ключам.
        Db::run('DELETE FROM `player` WHERE `id`=?', [$id]);
        $say('пилот ' . $login . ' удалён вместе с кораблём и лентой');
        exit(0);
    }

    throw new RuntimeException('неизвестная команда: ' . $cmd);
} catch (Throwable $e) {
    fwrite(STDERR, 'ОШИБКА: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
