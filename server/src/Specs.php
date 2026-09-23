<?php
/**
 * Характеристики корабля, оружия и модулей: чтение источника и выдача игре.
 *
 * Источник один — server/data/specs.php. Отсюда числа расходятся тремя
 * путями, и все три обязаны показывать одно и то же:
 *
 *   1. В БАЗУ — сеялкой (Seeder::specs), в ship_type и equipment_type.
 *   2. В ИГРУ по сети — маршрутом `catalog.specs`, и берётся он ИЗ БАЗЫ,
 *      а не из файла. Разница принципиальная: поправил число в базе —
 *      игра его увидит, не трогая файлов. База и есть бэкенд.
 *   3. В СЛЕПОК server/data/specs.json — им живут автономный режим
 *      (?offline=1, сервера нет вовсе) и проверки в Node.
 *
 * Слепок мог бы отстать от источника, и тогда игра без сервера летала бы
 * по другим числам, чем с сервером. Поэтому его сверяет проверка
 * (server/tests/run.php), а собирает — php server/cli/specs.php.
 */

final class Specs
{
    /** Ключ в `meta`, где лежат общие числа боя: своей таблицы им не надо. */
    public const META_KEY = 'specs_combat';

    /**
     * Числа лётной модели, у которых в ship_type есть свой столбец.
     *
     * Свой столбец у них потому, что по ним ходит SQL: урон и гибель
     * (Combat), свободный тоннаж (Market), бак нового корабля (Players).
     * В `spec` они НЕ ПИШУТСЯ — одно число живёт в одном месте, иначе
     * рано или поздно придётся выяснять, какая из двух копий настоящая.
     * Собирая ответ игре, сервер кладёт их в spec обратно.
     */
    public const COLUMNS = [
        'maxHull' => 'hull_max',
        'maxShield' => 'shield_max',
        'shieldRegen' => 'shield_regen',
        'shieldDelay' => 'shield_delay',
        'hold' => 'hold_t',
        'fuelMax' => 'fuel_t',
    ];

    /** Лётная модель без того, что лежит столбцами: ровно это идёт в `spec`. */
    public static function specRest(array $spec): array
    {
        foreach (array_keys(self::COLUMNS) as $key) {
            unset($spec[$key]);
        }
        return $spec;
    }

    private static ?array $cache = null;

    /** Источник: server/data/specs.php. */
    public static function source(): array
    {
        if (self::$cache === null) {
            $path = __DIR__ . '/../data/specs.php';
            if (!is_file($path)) {
                throw new RuntimeException('нет файла характеристик: ' . $path);
            }
            $data = require $path;
            if (!is_array($data) || empty($data['shipTypes'])) {
                throw new RuntimeException('файл характеристик пуст или испорчен: ' . $path);
            }
            self::$cache = $data;
        }
        return self::$cache;
    }

    /** Путь к машинному слепку. */
    public static function jsonPath(): string
    {
        return __DIR__ . '/../data/specs.json';
    }

    /**
     * Источник в том виде, в каком его получает игра.
     *
     * Ровно та же раскладка, что у forGame(), и это не случайность, а
     * условие: игра разбирает оба одним кодом (js/game/specs.js). Разойдись
     * они формой — и автономный режим полетел бы по другим правилам, чем
     * сетевой, причём молча.
     */
    public static function document(?array $specs = null): array
    {
        $specs = $specs ?? self::source();

        $ships = [];
        foreach ($specs['shipTypes'] as $t) {
            $ships[] = [
                'code' => $t['code'],
                'name' => $t['name'],
                'title' => $t['title'] ?? '',
                'price' => (int) ($t['price'] ?? 0),
                'spec' => $t['spec'],
            ];
        }

        $weapons = [];
        $modules = [];
        foreach (self::equipmentRows($specs) as $row) {
            if ($row['slot'] === 'gun') {
                $weapons[] = array_merge($row['spec'], [
                    'code' => $row['code'],
                    'name' => $row['name'],
                    'price' => $row['price'],
                    'ready' => (bool) $row['stock'],
                ]);
                continue;
            }
            $modules[] = [
                'code' => $row['code'],
                'name' => $row['name'],
                'slot' => $row['slot'],
                'spec' => $row['spec'],
                'price' => $row['price'],
                'installed' => (bool) $row['stock'],
            ];
        }

        return [
            'version' => (int) ($specs['version'] ?? 1),
            'shipTypes' => $ships,
            'weapons' => $weapons,
            'modules' => $modules,
            'combat' => $specs['combat'] ?? [],
        ];
    }

    /**
     * Слепок для автономного режима и проверок.
     *
     * Печатается с постоянными флагами, чтобы сверка слепка с источником
     * была сравнением строк, а не разбором «то же самое, но пробелы
     * другие».
     */
    public static function snapshot(): string
    {
        return json_encode(
            self::document(),
            JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
        ) . "\n";
    }

    /** Отстал ли слепок от источника. */
    public static function snapshotStale(): bool
    {
        $path = self::jsonPath();
        return !is_file($path) || file_get_contents($path) !== self::snapshot();
    }

    /**
     * Оружие и модули одним списком — так они лежат в equipment_type.
     *
     * Оружие идёт в тот же список со слотом `gun`: для сервера пушка —
     * такой же предмет на борту, и проверка «стоит ли это оружие на
     * корабле» (Combat::armed) ходит именно сюда.
     */
    public static function equipmentRows(array $specs): array
    {
        $rows = [];

        foreach ($specs['modules'] ?? [] as $m) {
            // `reads` едет в базу СПИСКОМ ИМЁН, а не готовыми числами.
            // Скопировать сюда maxSpeed корпуса было бы соблазнительно —
            // и означало бы, что после правки ship_type в карточке ещё
            // неделю стоит старое число. Пусть лучше карточка каждый раз
            // смотрит в лётную модель.
            $spec = $m['spec'] ?? [];
            if (!empty($m['reads'])) {
                $spec['reads'] = array_values($m['reads']);
            }
            $rows[] = [
                'code' => $m['code'],
                'name' => $m['name'],
                'slot' => $m['slot'],
                'spec' => $spec,
                'price' => (int) ($m['price'] ?? 0),
                'stock' => !empty($m['installed']),
            ];
        }

        foreach ($specs['weapons'] ?? [] as $w) {
            $spec = $w;
            unset($spec['code'], $spec['name'], $spec['price']);
            $rows[] = [
                'code' => $w['code'],
                'name' => $w['name'],
                'slot' => 'gun',
                'spec' => $spec,
                'price' => (int) ($w['price'] ?? 0),
                // `stock` значит «стоит на корабле с завода»: у оружия это
                // ready — сделано ли оно вообще.
                'stock' => !empty($w['ready']),
            ];
        }

        return $rows;
    }

    /**
     * То, что получает игра: собрано ИЗ БАЗЫ.
     *
     * Читается из таблиц, а не из файла, потому что база — хозяин чисел
     * в онлайне. Файл её наполняет, но последнее слово за ней: правка в
     * ship_type долетает до корабля без пересборки чего бы то ни было.
     */
    public static function forGame(): array
    {
        $ships = [];
        foreach (Db::all('SELECT * FROM `ship_type` ORDER BY `id`') as $row) {
            $spec = json_decode((string) ($row['spec'] ?? ''), true);
            if (!is_array($spec)) {
                $spec = [];
            }
            // В `spec` этих чисел нет — они лежат столбцами, и здесь
            // возвращаются в лётную модель. Правка hull_max в таблице
            // доходит до корабля именно так, ничего не пересобирая.
            foreach (self::COLUMNS as $key => $col) {
                $spec[$key] = (float) $row[$col];
            }
            $ships[] = [
                'code' => $row['code'],
                'name' => $row['name'],
                'title' => $row['title'],
                'price' => (int) $row['price'],
                'spec' => $spec,
            ];
        }

        $weapons = [];
        $modules = [];
        foreach (Db::all('SELECT `code`,`name`,`slot`,`spec`,`price`,`stock` FROM `equipment_type` ORDER BY `id`') as $row) {
            $spec = json_decode((string) $row['spec'], true);
            if (!is_array($spec)) {
                $spec = [];
            }
            if ($row['slot'] === 'gun') {
                $weapons[] = array_merge($spec, [
                    'code' => $row['code'],
                    'name' => $row['name'],
                    'price' => (int) $row['price'],
                    'ready' => (bool) $row['stock'],
                ]);
                continue;
            }
            $modules[] = [
                'code' => $row['code'],
                'name' => $row['name'],
                'slot' => $row['slot'],
                'spec' => $spec,
                'price' => (int) $row['price'],
                'installed' => (bool) $row['stock'],
            ];
        }

        // База может быть старше кода: на второй машине сделали git pull и
        // забыли `npm run api:setup`. Без этой проверки игра получила бы
        // модель без половины чисел и полетела бы на NaN — то есть никуда,
        // причём молча. Пусть лучше скажет, что делать.
        $want = array_keys(self::source()['shipTypes'][0]['spec']);
        foreach ($ships as $ship) {
            $lack = array_values(array_diff($want, array_keys($ship['spec'])));
            if ($lack !== []) {
                throw new RuntimeException(
                    'база отстала от кода: у корпуса «' . $ship['code'] . '» нет чисел ('
                    . implode(', ', array_slice($lack, 0, 5)) . '). Выполните: npm run api:setup'
                );
            }
        }

        $combat = json_decode((string) Db::one('SELECT `v` FROM `meta` WHERE `k`=?', [self::META_KEY]), true);
        if (!is_array($combat)) {
            $combat = self::source()['combat'] ?? [];
        }

        return [
            'version' => (int) (self::source()['version'] ?? 1),
            'shipTypes' => $ships,
            'weapons' => $weapons,
            'modules' => $modules,
            'combat' => $combat,
        ];
    }
}
