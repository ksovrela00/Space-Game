<?php
/**
 * NPC — только для хаба: Traffic, Npc и то, на чём они стоят.
 *
 * Отдельно от boot.php намеренно. boot.php подключает каждый запрос API
 * под Apache, и любая ошибка в любом файле из его списка роняет весь API:
 * игра уходит в «нет связи с сервером», хотя сервер жив. Так однажды и
 * вышло — посреди правки NPC, которые API не нужны вовсе. Код хаба
 * живёт здесь и может сломать только хаб.
 *
 * Подключают: server/ws/server.php и проверки хаба (server/tests/hub.php).
 */

require_once __DIR__ . '/boot.php';

foreach (['Vec', 'Dice', 'Oracle', 'Npc', 'Traffic'] as $class) {
    require_once __DIR__ . '/src/' . $class . '.php';
}
