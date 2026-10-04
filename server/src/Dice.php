<?php
/**
 * Кости с семенем: случайность, которую можно повторить.
 *
 * mt_rand здесь не годится: его состояние общее на процесс, и любой
 * чужой вызов (Ratchet, проверка) сдвигает его. Проверке же нужно
 * сказать «с семенем 7 прилетит вот такой корабль» и получить ровно его.
 *
 * Генератор — Парк–Миллер (минимальный стандарт, 48271): произведение не
 * выходит за 2^47 и считается в целых PHP без переполнения в float.
 * Качества на выбор имени и маршрута хватает с огромным запасом.
 */

final class Dice
{
    private const M = 2147483647;
    private int $s;

    public function __construct(?int $seed = null)
    {
        $seed = $seed ?? random_int(1, self::M - 1);
        $this->s = ($seed % (self::M - 1) + self::M - 1) % (self::M - 1) + 1;
    }

    /** [0, 1) */
    public function f(): float
    {
        $this->s = ($this->s * 48271) % self::M;
        return ($this->s - 1) / (self::M - 1);
    }

    public function range(float $a, float $b): float
    {
        return $a + ($b - $a) * $this->f();
    }

    /** Целое от a до b включительно. */
    public function int(int $a, int $b): int
    {
        return $a + (int) floor($this->f() * ($b - $a + 1));
    }

    public function chance(float $p): bool
    {
        return $this->f() < $p;
    }

    public function pick(array $list)
    {
        $list = array_values($list);
        return $list[(int) floor($this->f() * count($list))];
    }

    /**
     * Выбор по весам: [[предмет, вес], ...]. Нулевой и отрицательный вес —
     * не выбирается вовсе; пусто — null.
     */
    public function weighted(array $pairs)
    {
        $sum = 0.0;
        foreach ($pairs as $p) {
            $sum += max(0.0, (float) $p[1]);
        }
        if ($sum <= 0) {
            return null;
        }
        $x = $this->f() * $sum;
        foreach ($pairs as $p) {
            $x -= max(0.0, (float) $p[1]);
            if ($x < 0) {
                return $p[0];
            }
        }
        return $pairs[count($pairs) - 1][0];
    }

    /** Случайное направление, равномерно по сфере. */
    public function unit3(): array
    {
        $y = $this->range(-1.0, 1.0);
        $a = $this->range(0.0, 2 * M_PI);
        $r = sqrt(max(0.0, 1 - $y * $y));
        return [cos($a) * $r, $y, sin($a) * $r];
    }
}
