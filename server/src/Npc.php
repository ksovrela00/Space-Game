<?php
/**
 * Один NPC: корабль, которым правит сервер.
 *
 * Здесь — как он летит и что делает; кто, где и когда появляется,
 * решает Traffic. Лётной модели игрока (js/game/ship.js) тут нет и быть
 * не должно: NPC не пилотируют ручкой, им нужно правдоподобно лететь
 * туда, куда решил сервер. Поэтому модель кинематическая, но честная в
 * главном: нос поворачивается не быстрее, чем позволяет корпус, скорость
 * набирается и гасится двигателем, занос гасят маневровые. Числа — из
 * модулей, стоящих на этом корабле (Traffic::outfit), и корпуса: NPC с
 * форсированным двигателем действительно быстрее, крейсер разгоняется
 * медленнее и ворочается тяжелее.
 *
 * КООРДИНАТЫ — в одних из двух осей. Мировые (frame = null): NPC в
 * пустоте, вдали от грунта. Оси тела (frame = номер тела): NPC у
 * поверхности — садится, стоит, взлетает. Оси тела вращаются вместе с
 * ним, как и сам игрок у грунта (js/game/gravity.js, spinCarry): стоящий
 * NPC стоит, а не уезжает с суточным вращением. Клиент переводит оси
 * тела в мировые сам (js/game/peers.js) — так же, как для кораблей
 * игроков. Из одних осей в другие NPC не переходит: появляется он в
 * своих и в них же уходит в прыжок.
 *
 * ЗАДАЧИ идут очередью (plan): «долететь до точки», «повисеть»,
 * «снизиться на площадку», «постоять», «взлететь», «уйти в прыжок»,
 * «бежать». Нападение переписывает очередь: NPC без оружия от боя
 * уходит.
 */

final class Npc
{
    /** Шаг полёта, с: хаб тикает 0.2 с, поворот по нему был бы грубоват. */
    public const STEP = 0.1;

    /** Ближе этого к точке — долетел, км. */
    public const REACH = 0.35;

    /** От пилотов и других NPC держатся в паре корпусов, км. */
    public const KEEP = 0.8;

    /**
     * Визит к пилоту (inspect): подлететь на STANDOFF км, носом на него,
     * повисеть и улететь. Дальше INSPECT_REACH пилота не ищет, не догнал
     * за INSPECT_GIVEUP — бросает. Пол у пилота свой (Traffic меряет грунт
     * вокруг него), и действует он ближе NEAR_FLOOR по горизонтали: дальше
     * NPC идёт над полом своего участка — горы по дороге не мерились.
     */
    public const STANDOFF = 1.0;
    public const INSPECT_REACH = 70.0;
    public const INSPECT_GIVEUP = 120.0;
    public const NEAR_FLOOR = 2.5;

    /** Снижение и взлёт: скорость по вертикали — доля высоты в секунду. */
    public const SINK_K = 0.12;
    public const SINK_MIN = 0.012;   // км/с — последние метры, на стойки
    public const SINK_MAX = 0.6;
    /** Шасси выходит ниже этой высоты над площадкой, км. */
    public const GEAR_ALT = 2.5;

    /** Нос в пределах этого угла от курса — привод калибруется, рад. */
    public const ALIGN = 0.105;      // 6°

    public int $id = 0;
    public int $sys = 0;
    public ?int $frame = null;
    public string $type = '';
    public string $name = '';
    /** @var string[] коды стоящих модулей и оружия */
    public array $eq = [];
    /** @var string[] что из них стоит сверх заводского (Traffic::extras) */
    public array $extra = [];

    public array $p = [0.0, 0.0, 0.0];
    public array $v = [0.0, 0.0, 0.0];
    public array $f = [0.0, 0.0, 1.0];
    public array $u = [0.0, 1.0, 0.0];

    // Лётные числа — из модулей и корпуса (Traffic::outfit).
    public float $speed = 1.2;     // км/с
    public float $accel = 0.45;    // км/с²
    public float $brake = 0.75;
    public float $lateral = 0.5;
    public float $turn = 0.4;      // рад/с
    public float $boost = 1.0;     // во сколько раз форсаж поднимает предел
    public float $spool = 3.0;     // с калибровки квантового привода
    public float $gearClear = 0.0136;

    public float $hull = 100.0;
    public float $hullMax = 100.0;
    public float $shield = 0.0;
    public float $shieldMax = 0.0;
    public float $regen = 0.0;
    public float $delay = 0.0;
    public float $hitAt = -1e9;

    public string $mode = 'flight';
    public float $gear = 0.0;
    public float $lift = 0.0;
    public bool $fleeing = false;
    public float $charge = 0.0;

    /** @var array[] задачи по очереди */
    public array $plan = [];
    public ?array $task = null;

    /**
     * Над чем ходит NPC в осях тела: радиус тела, верх грунта в округе
     * (по оракулу) и высота, ниже которой он не спускается вне посадки.
     */
    public ?array $area = null;

    /**
     * Центр его участка (Traffic::homeFor), в его осях; у тела — точка на
     * сфере радиуса тела. Другой NPC свой участок ставит не ближе APART.
     */
    public ?array $home = null;

    public float $born = 0.0;
    /** До какого момента в снимке стоит «только что из прыжка». */
    public float $qx = 0.0;
    /** С какого момента рядом никого (Traffic::DROP_KM). */
    public ?float $lonely = null;
    /** Ушёл: 'jump' — прыжком, 'drop' — тихо (не видел никто), 'dead'. */
    public ?string $gone = null;
    /** Кого только что начал сканировать (игрок): Traffic скажет ему об этом. */
    public ?int $scan = null;

    // --- полёт ------------------------------------------------------------

    /**
     * Шаг: dt делится на куски по STEP, на каждом — своя задача.
     *
     * @param array $avoid от кого держаться, в тех же осях: [[x, y, z], r] —
     *                     пилоты, другие NPC, станции
     * @param array $pilots где пилоты в осях NPC (игрок => точка): к ним
     *                     летают с визитом
     */
    public function step(float $dt, float $now, array $avoid = [], array $pilots = []): void
    {
        $n = max(1, (int) ceil($dt / self::STEP - 1e-9));
        $h = $dt / $n;
        for ($i = 0; $i < $n && $this->gone === null; $i++) {
            $this->tick($h, $now - $dt + $h * ($i + 1), $avoid, $pilots);
        }
    }

    private function tick(float $dt, float $now, array $avoid, array $pilots): void
    {
        if ($this->task === null) {
            $this->task = array_shift($this->plan);
            if ($this->task === null) {
                // Делать больше нечего — уходит. Пустая очередь у NPC
                // бывает только по ошибке плана, и висеть в космосе
                // памятником ей незачем.
                $this->task = ['k' => 'depart', 'h' => $this->f];
            }
            $this->task['t0'] = $now;
        }
        $done = false;
        switch ($this->task['k']) {
            case 'goto':
                $done = $this->go($dt, $now, $avoid);
                break;
            case 'loiter':
                $this->steer($this->task['h'] ?? $this->f, 0.02, $dt, $avoid);
                $done = $now - $this->task['t0'] >= $this->task['dur'];
                break;
            case 'descend':
                $done = $this->descend($dt);
                break;
            case 'landed':
                $this->mode = 'landed';
                $this->v = [0.0, 0.0, 0.0];
                $this->gear = 1.0;
                $this->lift = 0.0;
                $done = $now - $this->task['t0'] >= $this->task['dur'];
                break;
            case 'ascend':
                $done = $this->ascend($dt);
                break;
            case 'flee':
                $this->steer($this->away($this->task['from']), $this->speed * $this->boost, $dt, $avoid);
                $done = $now - $this->task['t0'] >= $this->task['dur'];
                break;
            case 'depart':
                $done = $this->depart($dt, $avoid);
                break;
            case 'inspect':
                $done = $this->inspect($dt, $now, $avoid, $pilots);
                break;
            default:
                $done = true;
        }
        if ($done) {
            if ($this->task['k'] === 'landed') {
                $this->mode = 'flight';
            }
            $this->task = null;
        }
    }

    /** Долететь до точки: на подходе — тормозить, чтобы не проскочить. */
    private function go(float $dt, float $now, array $avoid): bool
    {
        $d = Vec::sub($this->task['to'], $this->p);
        $dist = Vec::len($d);
        if ($dist < self::REACH) {
            return true;
        }
        // Предел — тот, с которого двигатель успеет остановить корабль к
        // точке, с запасом на разворот.
        $want = min($this->speed * ($this->task['v'] ?? 0.85),
            sqrt(2 * $this->brake * 0.6 * max(0.0, $dist - 0.2)));
        $this->steer(Vec::scale($d, 1 / $dist), $want, $dt, $avoid);
        // Кружит вокруг точки, не попадая в неё (занос шире радиуса
        // разворота), — значит, долетел достаточно.
        return $now - $this->task['t0'] > ($this->task['max'] ?? 240);
    }

    /**
     * Нос — к курсу h, скорость — к want.
     *
     * Тяга идёт вдоль носа: пока нос не довернул, корабль летит туда,
     * куда летел, и тормозит. Боковой занос гасят маневровые с их
     * собственной силой (lateral) — поэтому после резкого разворота
     * корабль ещё какое-то время несёт боком, как и у игрока.
     */
    private function steer(array $h, float $want, float $dt, array $avoid): void
    {
        $h = $this->dodge($h, $avoid);
        $this->f = Vec::turn($this->f, $h, $this->turn * $dt);
        $this->u = $this->upFor($this->f);
        $a = max(0.0, Vec::dot($this->f, $h));
        $cmd = $want * $a * $a;
        $vf = Vec::dot($this->v, $this->f);
        $lat = Vec::madd($this->v, $this->f, -$vf);
        if ($cmd > $vf) {
            // Форсаж поднимает и тягу: без неё до тройной скорости корабль
            // полз бы втрое дольше (js/game/ship.js, boostAccel).
            $vf = min($cmd, $vf + $this->accel * ($this->fleeing ? max(1.0, $this->boost) : 1.0) * $dt);
        } else {
            $vf = max($cmd, $vf - $this->brake * $dt);
        }
        $ll = Vec::len($lat);
        if ($ll > 1e-9) {
            $lat = Vec::scale($lat, max(0.0, $ll - $this->lateral * $dt) / $ll);
        }
        $this->v = Vec::madd($lat, $this->f, $vf);
        // Полная скорость — не выше предела хода: занос после разворота
        // складывается с тягой вдоль нового курса, и без предела NPC на
        // вираже разгонялся бы до полутора пределов. Срезается тормозом,
        // а не разом: рывка в скорости не видно.
        $cap = $this->speed * ($this->fleeing ? $this->boost : 1.0);
        $vl = Vec::len($this->v);
        if ($vl > $cap) {
            $this->v = Vec::scale($this->v, max($cap, $vl - $this->brake * $dt) / $vl);
        }
        $this->p = Vec::madd($this->p, $this->v, $dt);
        $this->floor();
        $this->mode = 'flight';
        $this->gear = 0.0;
        $this->lift = 0.0;
    }

    /**
     * Не ниже пола: в осях тела вне посадки NPC не спускается под верх
     * грунта округи (Traffic::area), что бы ни велел курс. Иначе отрезок
     * между двумя точками над горами прошёл бы сквозь гору.
     */
    private function floor(): void
    {
        if ($this->area === null) {
            return;
        }
        $r = Vec::len($this->p);
        $min = $this->area['floor'];
        // У пилота, к которому прилетел, пол — его: грунт вокруг него
        // меряется отдельно, и без этого NPC висел бы над ним в километрах.
        $t = $this->task;
        if ($t !== null && $t['k'] === 'inspect' && isset($t['floor'], $t['at'])
            && Vec::len(Vec::across(Vec::sub($this->p, $t['at']), Vec::unit($t['at']))) < self::NEAR_FLOOR) {
            $min = min($min, $t['floor']);
        }
        if ($r < $min && $r > 1e-9) {
            $up = Vec::scale($this->p, 1 / $r);
            $this->p = Vec::scale($up, $min);
            $down = Vec::dot($this->v, $up);
            if ($down < 0) {
                $this->v = Vec::madd($this->v, $up, -$down);
            }
        }
    }

    /**
     * Обойти тех, кто рядом: чем ближе, тем сильнее курс уводит прочь.
     * Каждый — точка с радиусом ([[x, y, z], r]): пилоты и NPC — пара
     * корпусов, станция — её габарит с запасом (Traffic::avoidFor).
     */
    private function dodge(array $h, array $avoid): array
    {
        $push = [0.0, 0.0, 0.0];
        foreach ($avoid as [$q, $r]) {
            $d = Vec::sub($this->p, $q);
            $l = Vec::len($d);
            if ($l < $r && $l > 1e-6) {
                $push = Vec::madd($push, $d, ($r - $l) / $r * 3.0 / $l);
            }
        }
        return Vec::len($push) > 0 ? Vec::unit(Vec::add($h, $push), $h) : $h;
    }

    /** «Верх» корабля: у тела — от его центра, в пустоте — какой был. */
    private function upFor(array $f): array
    {
        $ref = $this->frame !== null ? Vec::unit($this->p, $this->u) : $this->u;
        $u = Vec::across($ref, $f);
        return Vec::len($u) > 1e-6 ? Vec::unit($u) : Vec::perp($f);
    }

    /** Прочь от точки; у тела — ещё и вверх, а не в грунт. */
    private function away(array $from): array
    {
        $h = Vec::unit(Vec::sub($this->p, $from), $this->f);
        if ($this->frame !== null) {
            $h = Vec::unit(Vec::madd($h, Vec::unit($this->p), 0.5), $h);
        }
        return $h;
    }

    /**
     * Снижение на площадку: строго вниз по её вертикали, всё медленнее к
     * грунту, — так садится и посадочный компьютер игрока. Последние
     * метры — на стойках, нос — горизонтально, верх — по нормали склона.
     */
    private function descend(float $dt): bool
    {
        $t = $this->task;
        $d = Vec::sub($t['to'], $this->p);
        $h = Vec::len($d);
        $this->level($t['n'], $dt);
        if ($h < 0.002) {
            $this->p = $t['to'];
            $this->v = [0.0, 0.0, 0.0];
            $this->mode = 'landed';
            $this->gear = 1.0;
            $this->lift = 0.0;
            return true;
        }
        $vel = max(self::SINK_MIN, min(self::SINK_MAX, self::SINK_K * $h));
        $dir = Vec::scale($d, 1 / $h);
        $this->p = Vec::madd($this->p, $dir, min($h, $vel * $dt));
        $this->v = Vec::scale($dir, $vel);
        $this->mode = 'flight';
        $this->gear = $h < self::GEAR_ALT ? 1.0 : 0.0;
        $this->lift = $h < 4 ? 0.6 : 0.25;
        return false;
    }

    /** Взлёт: вертикально вверх до высоты ухода, шасси — убрать. */
    private function ascend(float $dt): bool
    {
        $t = $this->task;
        $d = Vec::sub($t['to'], $this->p);
        $h = Vec::len($d);
        $climb = Vec::dist($this->p, $t['from']);
        $this->level(Vec::unit($this->p), $dt);
        if ($h < 0.05) {
            $this->gear = 0.0;
            $this->lift = 0.0;
            $this->mode = 'flight';
            return true;
        }
        $vel = max(0.03, min(self::SINK_MAX, 0.03 + self::SINK_K * $climb)) * ($this->fleeing ? 2.0 : 1.0);
        $dir = Vec::scale($d, 1 / $h);
        $this->p = Vec::madd($this->p, $dir, min($h, $vel * $dt));
        $this->v = Vec::scale($dir, $vel);
        $this->mode = 'flight';
        $this->gear = $climb < 0.3 ? 1.0 : 0.0;
        $this->lift = $climb < 4 ? 0.7 : 0.3;
        return false;
    }

    /** Нос — в горизонт, верх — к n: корабль выравнивается над грунтом. */
    private function level(array $n, float $dt): void
    {
        $fh = Vec::across($this->f, $n);
        if (Vec::len($fh) > 1e-6) {
            $this->f = Vec::turn($this->f, Vec::unit($fh), $this->turn * $dt);
        }
        $u = Vec::unit(Vec::madd($this->u, Vec::sub($n, $this->u), min(1.0, $dt * 1.5)), $n);
        $u = Vec::across($u, $this->f);
        $this->u = Vec::len($u) > 1e-6 ? Vec::unit($u) : Vec::perp($this->f);
    }

    /**
     * Уход в прыжок: развернуться на курс, откалибровать привод (столько,
     * сколько он калибруется у игрока, — spool модуля) и исчезнуть.
     * Сбил курс — калибровка тает, как у игрока (fade).
     */
    private function depart(float $dt, array $avoid): bool
    {
        $h = $this->task['h'];
        $this->steer($h, $this->speed * ($this->fleeing ? $this->boost : 0.9), $dt, $avoid);
        if (Vec::dot($this->f, $h) > cos(self::ALIGN)) {
            $this->charge += $dt;
        } else {
            $this->charge = max(0.0, $this->charge - 0.5 * $dt);
        }
        if ($this->charge >= $this->spool) {
            $this->gone = 'jump';
            return true;
        }
        return false;
    }

    /**
     * Визит: подлететь к пилоту на километр, развернуться к нему носом и
     * повисеть полминуты — как будто сканирует, — а потом дальше по своим
     * делам. Пилот движется — точка подлёта движется с ним. Ушёл далеко,
     * пропал или не догнать — визит брошен.
     */
    private function inspect(float $dt, float $now, array $avoid, array $pilots): bool
    {
        if (!isset($this->task['pid'])) {
            $best = null;
            $bd = INF;
            foreach ($pilots as $pid => $q) {
                $d = Vec::dist($q, $this->p);
                if ($d < $bd) {
                    $bd = $d;
                    $best = $pid;
                }
            }
            if ($best === null || $bd > self::INSPECT_REACH) {
                return true;
            }
            $this->task['pid'] = $best;
        }
        $at = $pilots[$this->task['pid']] ?? null;
        if ($at === null) {
            return true;
        }
        $this->task['at'] = $at;
        // Точка подлёта — в километре от пилота, с той стороны, откуда летит.
        $to = Vec::madd($at, Vec::unit(Vec::sub($this->p, $at), $this->u), self::STANDOFF);
        if ($this->frame !== null && isset($this->task['floor'])) {
            $r = Vec::len($to);
            if ($r < $this->task['floor']) {
                $to = Vec::scale($to, $this->task['floor'] / $r);
            }
        }
        $d = Vec::dist($to, $this->p);
        if (!isset($this->task['since'])) {
            if ($d > 0.3) {
                if ($now - $this->task['t0'] > self::INSPECT_GIVEUP) {
                    return true;                     // не догнал — и ладно
                }
                $want = min($this->speed * 0.85, sqrt(2 * $this->brake * 0.6 * max(0.0, $d - 0.2)));
                $this->steer(Vec::scale(Vec::sub($to, $this->p), 1 / $d), $want, $dt, $avoid);
                return false;
            }
            $this->task['since'] = $now;
            $this->scan = (int) $this->task['pid'];
        }
        // На месте: снесло — подровняться, иначе нос на пилота и стоять.
        if ($d > 0.15) {
            $this->steer(Vec::scale(Vec::sub($to, $this->p), 1 / $d), min($this->speed * 0.5, $d * 0.6), $dt, $avoid);
        } else {
            $this->steer(Vec::unit(Vec::sub($at, $this->p), $this->f), 0.0, $dt, $avoid);
        }
        return $now - $this->task['since'] >= $this->task['dur'];
    }

    // --- бой ----------------------------------------------------------------

    /** Щит на этот момент: он отрастает сам, после паузы тишины. */
    public function shieldAt(float $now): float
    {
        if ($this->shieldMax <= 0) {
            return 0.0;
        }
        $idle = max(0.0, $now - $this->hitAt - $this->delay);
        return min($this->shieldMax, $this->shield + $this->regen * $idle);
    }

    /**
     * Попадание: сперва щит, потом корпус — по тому же правилу, что у
     * кораблей игроков (Combat::damage). Счёт держится в памяти хаба: NPC
     * в базе нет, их корпус никто, кроме хаба, не читает.
     */
    public function damage(float $dmg, float $now): array
    {
        $dmg = max(0.0, $dmg);
        $shield = $this->shieldAt($now);
        $absorbed = min($shield, $dmg);
        $this->shield = $shield - $absorbed;
        $this->hull = max(0.0, $this->hull - ($dmg - $absorbed));
        $this->hitAt = $now;
        $dead = $this->hull <= 0.0;
        if ($dead) {
            $this->gone = 'dead';
        }
        return [
            'hull' => round($this->hull, 3), 'max' => $this->hullMax,
            'shield' => round($this->shield, 3), 'smax' => $this->shieldMax,
            'absorbed' => $absorbed, 'dead' => $dead,
        ];
    }

    /**
     * По нам стреляют. Оружия у NPC в бою пока нет, и ответ один: бежать —
     * на форсаже, прочь от стрелка, — и уйти прыжком. Стоящий на грунте
     * сперва взлетает: с грунта в прыжок не уходят.
     *
     * @param array $from где стрелок, в осях NPC
     */
    public function attacked(array $from, float $now, Dice $dice): void
    {
        if ($this->gone !== null) {
            return;
        }
        if ($this->fleeing) {
            // Уже бежит: стрелок мог зайти с другой стороны.
            if ($this->task !== null && $this->task['k'] === 'flee') {
                $this->task['from'] = $from;
            }
            return;
        }
        $this->fleeing = true;
        $this->charge = 0.0;
        $run = ['k' => 'flee', 'from' => $from, 'dur' => $dice->range(6.0, 14.0)];
        $out = ['k' => 'depart', 'h' => $this->away($from)];
        $k = $this->task['k'] ?? '';
        if ($this->frame !== null && $this->area !== null && in_array($k, ['descend', 'landed', 'ascend'], true)) {
            $up = Vec::unit($this->p);
            $base = $k === 'ascend' ? $this->task['from'] : $this->p;
            $this->plan = [
                ['k' => 'ascend', 'from' => $base, 'to' => Vec::scale($up, max($this->area['floor'], Vec::len($this->p) + 1.5))],
                $run, $out,
            ];
        } else {
            $this->plan = [$run, $out];
        }
        // Текущая задача обрывается — с тем, что от неё осталось: стоял —
        // теперь летит.
        if ($k === 'landed') {
            $this->mode = 'flight';
        }
        $this->task = null;
    }

    // --- снимок -------------------------------------------------------------

    /**
     * Строка в снимок — той же формы, что у кораблей игроков
     * (Hub::shipsOf), с пометкой npc. id — отрицательный: у кораблей
     * игроков он из базы и положительный, и спутать их нельзя.
     *
     * @param bool $full добавить снаряжение (eq — всё, ex — сверх
     *                   заводского): его шлют раз, когда NPC впервые
     *                   показался этому пилоту
     */
    public function row(float $now, bool $full = false): array
    {
        $r = [
            'id' => $this->id, 'npc' => 1, 'by' => null, 'name' => $this->name,
            'ty' => $this->type, 'mode' => $this->mode, 'sys' => $this->sys,
            'v' => round(Vec::len($this->v), 4),
            'hull' => round($this->hull, 1), 'hmax' => $this->hullMax,
            'sh' => round($this->shieldAt($now), 1), 'smax' => $this->shieldMax,
            'g' => $this->gear, 'h' => [], 'k' => $this->lift, 'pilot' => null,
        ];
        $p = Vec::r6($this->p);
        $f = Vec::r6($this->f);
        $u = Vec::r6($this->u);
        if ($this->frame === null) {
            $r += ['x' => $p[0], 'y' => $p[1], 'z' => $p[2],
                'fx' => $f[0], 'fy' => $f[1], 'fz' => $f[2],
                'ux' => $u[0], 'uy' => $u[1], 'uz' => $u[2]];
        } else {
            $r += ['b' => $this->frame, 'lx' => $p[0], 'ly' => $p[1], 'lz' => $p[2],
                'lfx' => $f[0], 'lfy' => $f[1], 'lfz' => $f[2],
                'lux' => $u[0], 'luy' => $u[1], 'luz' => $u[2]];
        }
        if ($now < $this->qx) {
            $r['qx'] = 1;
        }
        if ($full) {
            $r['eq'] = $this->eq;
            $r['ex'] = $this->extra;
        }
        return $r;
    }

    // --- имена --------------------------------------------------------------

    /** Имена — со всего света: космос заселяли не одним языком. */
    private const GIVEN = [
        'Ada', 'Aiko', 'Alma', 'Anouk', 'Arjun', 'Astrid', 'Bao', 'Bastian', 'Bodhi', 'Bran',
        'Cato', 'Chiara', 'Cyra', 'Dara', 'Darius', 'Dmitri', 'Eamon', 'Elif', 'Emre', 'Erno',
        'Esme', 'Farid', 'Faye', 'Freya', 'Gael', 'Hana', 'Idris', 'Ilse', 'Ines', 'Ingrid',
        'Ivo', 'Jalen', 'Joss', 'Jun', 'Kaia', 'Kasimir', 'Kenji', 'Kofi', 'Lars', 'Leilani',
        'Lio', 'Maren', 'Mateo', 'Mira', 'Nadia', 'Niko', 'Noor', 'Oren', 'Orla', 'Paz',
        'Quinn', 'Rafa', 'Ravi', 'Rhea', 'Sami', 'Sanna', 'Soren', 'Tamsin', 'Teo', 'Tove',
        'Udo', 'Vera', 'Vik', 'Wren', 'Yara', 'Yusuf', 'Zaid', 'Zora',
    ];

    /** Фамилии — из слогов, как названия станций (js/core/rng.js, makeName). */
    private const SYL_A = [
        'Vor', 'Kel', 'Tan', 'Mar', 'Sol', 'Rav', 'Den', 'Hal', 'Quin', 'Bre', 'Lor', 'Zan', 'Ost',
        'Cor', 'Fen', 'Gal', 'Ires', 'Mok', 'Nev', 'Pell', 'Sar', 'Tor', 'Ulm', 'Wex', 'Yar',
    ];
    private const SYL_B = [
        'an', 'en', 'ov', 'ek', 'is', 'ar', 'ul', 'ani', 'ett', 'ora', 'ski', 'in', 'ard', 'ow',
        'ez', 'ane', 'ick', 'ova', 'os', 'ey',
    ];
    private const SYL_C = ['son', 'berg', 'vik', 'ley', 'mont', 'well', 'sky', 'haven', 'ford', 'dal'];

    public static function nameOf(Dice $dice): string
    {
        $last = $dice->pick(self::SYL_A) . $dice->pick(self::SYL_B);
        if ($dice->chance(0.4)) {
            $last .= $dice->pick(self::SYL_C);
        }
        return $dice->pick(self::GIVEN) . ' ' . $last;
    }
}
