<?php
/**
 * Вектор из трёх чисел — массив [x, y, z].
 *
 * Отдельным классом-обёрткой он не сделан намеренно: NPC шагают пять раз
 * в секунду, их десятки, и объект на каждое сложение — это мусор,
 * который PHP потом собирает. Массив дешевле и так же читается.
 */

final class Vec
{
    public static function add(array $a, array $b): array
    {
        return [$a[0] + $b[0], $a[1] + $b[1], $a[2] + $b[2]];
    }

    public static function sub(array $a, array $b): array
    {
        return [$a[0] - $b[0], $a[1] - $b[1], $a[2] - $b[2]];
    }

    public static function scale(array $a, float $k): array
    {
        return [$a[0] * $k, $a[1] * $k, $a[2] * $k];
    }

    /** a + b·k */
    public static function madd(array $a, array $b, float $k): array
    {
        return [$a[0] + $b[0] * $k, $a[1] + $b[1] * $k, $a[2] + $b[2] * $k];
    }

    public static function dot(array $a, array $b): float
    {
        return $a[0] * $b[0] + $a[1] * $b[1] + $a[2] * $b[2];
    }

    public static function cross(array $a, array $b): array
    {
        return [
            $a[1] * $b[2] - $a[2] * $b[1],
            $a[2] * $b[0] - $a[0] * $b[2],
            $a[0] * $b[1] - $a[1] * $b[0],
        ];
    }

    public static function len(array $a): float
    {
        return sqrt($a[0] * $a[0] + $a[1] * $a[1] + $a[2] * $a[2]);
    }

    public static function dist(array $a, array $b): float
    {
        return sqrt(($a[0] - $b[0]) ** 2 + ($a[1] - $b[1]) ** 2 + ($a[2] - $b[2]) ** 2);
    }

    /** Единичный; нулевой вектор — запасной (по умолчанию «вперёд»). */
    public static function unit(array $a, array $fallback = [0.0, 0.0, 1.0]): array
    {
        $l = self::len($a);
        return $l > 1e-12 ? [$a[0] / $l, $a[1] / $l, $a[2] / $l] : $fallback;
    }

    /** Составляющая a поперёк единичного n. */
    public static function across(array $a, array $n): array
    {
        return self::madd($a, $n, -self::dot($a, $n));
    }

    /** Любой единичный перпендикуляр к единичному a. */
    public static function perp(array $a): array
    {
        $h = abs($a[1]) < 0.9 ? [0.0, 1.0, 0.0] : [1.0, 0.0, 0.0];
        return self::unit(self::cross($h, $a));
    }

    /**
     * Повернуть единичный f к единичному h не больше чем на угол max (рад).
     *
     * Так поворачивается нос: у корабля есть предел угловой скорости, и
     * развернуться «сразу» он не может. Цель строго за кормой — ось
     * поворота любая поперечная: всё равно, через какой борт.
     */
    public static function turn(array $f, array $h, float $max): array
    {
        $c = max(-1.0, min(1.0, self::dot($f, $h)));
        $ang = acos($c);
        if ($ang <= $max) {
            return $h;
        }
        $axis = self::cross($f, $h);
        $al = self::len($axis);
        $axis = $al > 1e-9 ? self::scale($axis, 1 / $al) : self::perp($f);
        return self::unit(self::rotate($f, $axis, $max), $f);
    }

    /** Поворот v вокруг единичной оси k на угол a (формула Родрига). */
    public static function rotate(array $v, array $k, float $a): array
    {
        $c = cos($a);
        $s = sin($a);
        $kv = self::cross($k, $v);
        $d = self::dot($k, $v) * (1 - $c);
        return [
            $v[0] * $c + $kv[0] * $s + $k[0] * $d,
            $v[1] * $c + $kv[1] * $s + $k[1] * $d,
            $v[2] * $c + $kv[2] * $s + $k[2] * $d,
        ];
    }

    /**
     * Точка на сфере: от единичного d по касательной на угол ang и по
     * азимуту az. Так ищется место «в двадцати километрах от игрока» на
     * поверхности тела — по дуге, а не по хорде.
     */
    public static function around(array $d, float $ang, float $az): array
    {
        $u = self::perp($d);
        $v = self::cross($d, $u);
        $t = self::add(self::scale($u, cos($az)), self::scale($v, sin($az)));
        return self::unit(self::add(self::scale($d, cos($ang)), self::scale($t, sin($ang))), $d);
    }

    /** Округлить до миллиметра (км): снимок уходит в сеть пять раз в секунду. */
    public static function r6(array $a): array
    {
        return [round($a[0], 6), round($a[1], 6), round($a[2], 6)];
    }
}
