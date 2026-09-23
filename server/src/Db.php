<?php
/**
 * Обёртка над PDO: соединение, запросы, транзакции.
 *
 * Своя, а не готовая библиотека, по той же причине, по которой в игре нет
 * сборки: в проекте не должно быть шага «сначала установи зависимости».
 * Нужного здесь мало — подготовленные запросы, транзакция и внятная
 * ошибка, — и всё это PDO даёт само.
 */

final class Db
{
    private static ?PDO $pdo = null;

    /** Соединение одно на процесс: запрос PHP короткий, пул не нужен. */
    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            self::$pdo = self::connect(MYSQLDB);
        }
        return self::$pdo;
    }

    /**
     * Соединение с конкретной базой (или вовсе без базы, если имя пустое —
     * так её создают).
     */
    public static function connect(string $dbName): PDO
    {
        $dsn = 'mysql:host=' . MYSQLHOST . ';port=' . MYSQLPORT . ';charset=utf8mb4';
        if ($dbName !== '') {
            $dsn .= ';dbname=' . $dbName;
        }
        $pdo = new PDO($dsn, MYSQLUSER, MYSQLPASS, [
            // Исключения, а не коды возврата: молча пропущенная ошибка в
            // денежной операции — это потерянные деньги игрока.
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Настоящие подготовленные запросы, а не подстановка на
            // стороне PHP: иначе типы чисел уезжают в строки, и сравнение
            // в WHERE начинает зависеть от кавычек.
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        // Время в соединении — UTC. Без этого NOW() отдаёт местное время
        // сервера, и сроки заданий у игроков из разных поясов разъедутся.
        $pdo->exec("SET time_zone = '+00:00'");
        return $pdo;
    }

    /** Подменить соединение (нужно проверкам: они работают на своей базе). */
    public static function use(PDO $pdo): void
    {
        self::$pdo = $pdo;
    }

    public static function run(string $sql, array $args = []): PDOStatement
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($args);
        return $st;
    }

    /** Одна строка или null. */
    public static function row(string $sql, array $args = []): ?array
    {
        $r = self::run($sql, $args)->fetch();
        return $r === false ? null : $r;
    }

    /** Все строки. */
    public static function all(string $sql, array $args = []): array
    {
        return self::run($sql, $args)->fetchAll();
    }

    /** Одно значение первой строки или null. */
    public static function one(string $sql, array $args = [])
    {
        $v = self::run($sql, $args)->fetchColumn();
        return $v === false ? null : $v;
    }

    public static function insert(string $table, array $data): int
    {
        $cols = array_keys($data);
        $sql = 'INSERT INTO `' . $table . '` (`' . implode('`,`', $cols) . '`) VALUES ('
            . implode(',', array_fill(0, count($cols), '?')) . ')';
        self::run($sql, array_values($data));
        return (int) self::pdo()->lastInsertId();
    }

    public static function update(string $table, array $data, string $where, array $args = []): int
    {
        $set = [];
        foreach (array_keys($data) as $c) {
            $set[] = '`' . $c . '`=?';
        }
        $sql = 'UPDATE `' . $table . '` SET ' . implode(',', $set) . ' WHERE ' . $where;
        return self::run($sql, array_merge(array_values($data), $args))->rowCount();
    }

    /**
     * Транзакция.
     *
     * Всё, что двигает деньги или груз, обязано идти через неё: покупка —
     * это четыре записи (списание, лента, трюм, склад станции), и оборвись
     * она посередине, у игрока окажется товар без списанных крон либо
     * наоборот.
     */
    public static function tx(callable $fn)
    {
        $pdo = self::pdo();
        // Вложенная транзакция превратилась бы в молчаливый COMMIT
        // внутреннего вызова: PDO не умеет точки сохранения сам.
        if ($pdo->inTransaction()) {
            return $fn();
        }
        $pdo->beginTransaction();
        try {
            $out = $fn();
            $pdo->commit();
            return $out;
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /** Время в том виде, в каком оно лежит в базе. */
    public static function now(): string
    {
        return gmdate('Y-m-d H:i:s');
    }

    public static function at(int $shift): string
    {
        return gmdate('Y-m-d H:i:s', time() + $shift);
    }
}
