<?php
/**
 * Коннектор источников данных (Битрикс24, 1С через OData) → Интеграм.
 *
 *   Проект в папке коннектора:  php b24ig.php --config=config/<проект>.json
 *   База на сервере Интеграма:  php b24ig.php --db=<база> --config=<имя>
 *   По URL (cron на сервере):   https://ideav.ru/b24ig.php?db=<база>&config=<имя>
 *
 * Конфиг базы, secrets.json, состояние и логи — в templates/custom/<база>/connector/.
 * Параметры проекта — в конфиге (см. CONFIG.md).
 */
define('B24IG_ROOT', __DIR__);

// на сервере код лежит в include/b24ig (раскладка ideav/crm), при разработке — в src
$b24igSrc = is_dir(__DIR__ . '/include/b24ig') ? __DIR__ . '/include/b24ig' : __DIR__ . '/src';
foreach (array('Util', 'Http', 'Bki', 'BitrixClient', 'Source', 'Bitrix24Source', 'ODataClient', 'OneCSource',
             'IntegramClient', 'Transform', 'EntitySync', 'Runner') as $b24igFile) {
    require_once "$b24igSrc/$b24igFile.php";
}

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    exit(PHP_SAPI === 'cli' ? Runner::cli($argv) : Runner::web($_GET));
}
