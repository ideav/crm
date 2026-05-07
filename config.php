<?php
$bitrix24_url = 'https://b24.sia.ru';
$bitrix24_webhook = $bitrix24_url . '/rest/58536/xxxxxxxxxxxxxxxxxxx/';

$csvPath = __DIR__ . '/logs/';
$stateFile = __DIR__ . '/export_state.json';
$debug = false;

define('BATCH_SIZE', 50);    // записей за запрос
define('TIME_LIMIT', 14);    // секунд до перезагрузки

?>