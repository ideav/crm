<?php
# Урок платного курса портала ideav.ru/courses: ?course=<код>&lesson=<урок> (без lesson у авторского
# курса — манифест). Отдаётся только ученику с «Доступом»; 401 — не вошёл, 403 — доступа нет.
# Логика — include/courses_content.php.
require_once __DIR__ . '/include/courses_content.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
try {
    $cfg = Cp_load_config();
} catch (Exception $e) {
    error_log($e->getMessage());
    http_response_code(500);
    exit('{"error":"config"}');
}
list($code, $body) = Cc_get($cfg, isset($_SERVER['HTTP_COOKIE']) ? $_SERVER['HTTP_COOKIE'] : '',
    isset($_GET['course']) && is_string($_GET['course']) ? $_GET['course'] : '',
    isset($_GET['lesson']) && is_string($_GET['lesson']) ? $_GET['lesson'] : '');
http_response_code($code);
echo $body;
