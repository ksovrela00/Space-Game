// Свежий код на каждой перезагрузке.
//
// ПОЧЕМУ ОДНИХ ЗАГОЛОВКОВ СЕРВЕРА МАЛО. `no-store` в .htaccess действует
// только на тот ответ, который браузер спросит, — а он не спрашивает.
// Копии файлов у него уже лежат: сохранённые тогда, когда сервер отдавал
// их без Cache-Control, но с Last-Modified. В этом случае браузеру
// разрешено назначить срок годности самому, «по догадке»: десятая доля
// возраста файла. Для файла месячной давности это трое суток без единого
// запроса к серверу. Саму страницу при F5 браузер перепроверяет всегда,
// а её модули — нет, и помогает только Ctrl+F5.
//
// ЧТО ДЕЛАЕТ ЭТОТ ФАЙЛ. Свежесть берётся оттуда, где кеш бессилен, — из
// адреса: ко всем модулям приписывается ?v=<метка загрузки>. Адреса,
// которого браузер раньше не видел, в кеше быть не может.
//
// Приписать метку к одному тегу script мало: модули импортируют друг
// друга по относительным путям, а при разборе такого пути запрос
// отбрасывается — свежей стала бы одна точка входа, а остальной код
// пришёл бы из кеша. Получилась бы смесь нового и старого, то есть
// версия, которой никогда не существовало, и это хуже честно старой
// игры. Поэтому адреса переписывает таблица импортов (importmap):
// браузер сверяется с ней ДО того, как пойдёт за файлом.
//
// Подключается из index.html и login.html одной строкой через
// document.write — синхронно, иначе таблица может не успеть встать
// раньше первого модуля (на странице входа модуль записан прямо в
// разметке). Метку страница передаёт в window.__srcStamp.
(function () {
  var v = window.__srcStamp || '';

  // Все файлы игры, поимённо. Список нужен потому, что у таблицы импортов
  // нет правила «всё, что в этой папке»: переписать адрес можно только
  // точным совпадением. Проверка следит, чтобы список совпадал с
  // содержимым js/ — иначе новый файл молча остался бы на старом адресе
  // (tools/test.mjs, раздел «свежий код»).
  var SRC = {
    '': [
      'boot', 'main'
    ],
    'core/': [
      'basis', 'input', 'lang.en', 'lang', 'mode', 'quality', 'rng',
      'sound', 'vec3'
    ],
    'game/': [
      'audio', 'bodyinfo', 'clock', 'docking', 'dust', 'entry', 'flow',
      'city', 'galaxy', 'gravity', 'lamps', 'landing', 'loadout', 'nav', 'peers', 'pilot',
      'player', 'quantum', 'shadow', 'ship', 'specs', 'state', 'surface',
      'warp', 'weapons', 'world'
    ],
    'gl/': [
      'bake', 'citymesh', 'context', 'detail', 'gputime', 'icosphere', 'mat4',
      'mesh', 'nebula', 'patches', 'planetmesh', 'program', 'quadtree',
      'rocks', 'scene', 'shaders', 'terrain', 'tilegeo', 'tilepool',
      'tiles', 'tileworker'
    ],
    'models/': [
      'city', 'city.parts', 'cockpit', 'geometry', 'hull.data', 'ships',
      'station.parts', 'stations'
    ],
    'net/': [
      'api', 'quality', 'session', 'socket'
    ],
    'render/': [
      'camera', 'clip', 'planetview', 'renderer', 'starfield'
    ],
    'ui/': [
      'debug', 'hud', 'map', 'menu', 'panels', 'screens', 'theme',
      'touch'
    ]
  };

  // Поток сборки плиток живёт по своим правилам: внутри рабочих потоков
  // таблицы импортов нет как явления. Его файлы обновляются иначе — см.
  // ниже.
  var INWORKER = [
    'gl/bake', 'gl/icosphere', 'gl/quadtree', 'gl/terrain',
    'gl/tilegeo', 'gl/tileworker'
  ];

  var path = function (p) { return 'js/' + p + '.js'; };

  // Если таблицы импортов в браузере нет, метку не ставим ВОВСЕ: свежей
  // была бы одна точка входа, а остальное пришло бы из кеша. В таком
  // браузере всё грузится по-прежнему, а кеш остаётся на совести сервера.
  var can = typeof HTMLScriptElement !== 'undefined' &&
    !!HTMLScriptElement.supports && HTMLScriptElement.supports('importmap');

  if (!can) v = '';
  window.__srcStamp = v;

  if (can) {
    var imports = {};
    for (var dir in SRC) {
      for (var i = 0; i < SRC[dir].length; i++) {
        var p = './' + path(dir + SRC[dir][i]);
        imports[p] = p + '?v=' + v;
      }
    }
    var map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({ imports: imports });
    // Таблица обязана попасть в документ раньше первого модуля: браузер
    // читает её один раз, а вставленную позже уже игнорирует.
    document.head.appendChild(map);
  }

  // Стиль болеет тем же и лечится тем же. Ставится он отсюда, а не тегом
  // link в разметке, потому что метку в разметку не впишешь.
  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'css/style.css' + (v ? '?v=' + v : '');
  document.head.appendChild(css);

  // Файлы потока просим у сети напрямую. cache: 'reload' — это и есть
  // «не смотреть в кеш, сходить в сеть и заменить копию»: после этого
  // поток, который читает их по обычным адресам, получит свежие. Ждёт
  // эту работу js/gl/tilepool.js — он не поднимает потоки раньше.
  window.__srcFresh = (v && typeof fetch === 'function')
    ? Promise.all(INWORKER.map(function (p) {
        return fetch(path(p), { cache: 'reload' }).catch(function () { /* нет сети — играем как есть */ });
      }))
    : null;
})();
