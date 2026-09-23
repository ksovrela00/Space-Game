<?php
/**
 * Ошибка, которую можно показать игроку.
 *
 * Отделена от всех прочих исключений намеренно: наружу уходит только то,
 * что клиент обязан понять и как-то обработать («не хватает крон», «трюм
 * полон»). Всё остальное — сломанный запрос, упавшая база — это наша
 * поломка, и подробности о ней в ответ не попадают: они идут в лог.
 */
final class ApiError extends RuntimeException
{
    // Поле названо slug, а не code: `code` у Exception уже есть (целое
    // число), и переопределить его типом PHP не даёт.
    public string $slug;
    public int $status;
    public array $extra;

    public function __construct(string $slug, string $message, int $status = 400, array $extra = [])
    {
        parent::__construct($message);
        $this->slug = $slug;
        $this->status = $status;
        $this->extra = $extra;
    }

    public static function auth(string $message = 'нужен вход'): self
    {
        return new self('auth', $message, 401);
    }

    public static function notFound(string $message): self
    {
        return new self('not_found', $message, 404);
    }

    public static function bad(string $message, array $extra = []): self
    {
        return new self('bad_request', $message, 400, $extra);
    }

    public static function denied(string $slug, string $message, array $extra = []): self
    {
        return new self($slug, $message, 409, $extra);
    }
}
