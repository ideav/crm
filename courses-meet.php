<?php
# Видеовстречи портала ideav.ru/courses (ideav/courses#200): POST JSON {action, ...}, ответ — JSON.
# Ключи входа в Jitsi, блок-лист и коды гостей — на сервере, логика — include/courses_meet.php.
require_once __DIR__ . '/include/courses_meet.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
function Cm_out($http, $data){ http_response_code($http); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }

# Только свой фронт: заголовок X-Requested-With не отправить кросс-доменной формой
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !isset($_SERVER['HTTP_X_REQUESTED_WITH'])) Cm_out(405, array('ok' => false, 'error' => 'method'));
try {
    $cfg = Cp_load_config();
} catch (Exception $e) {
    error_log($e->getMessage());
    Cm_out(500, array('ok' => false, 'error' => 'server'));
}
$in = json_decode(file_get_contents('php://input'), true);
list($http, $res) = Cm_handle($cfg, isset($_SERVER['HTTP_COOKIE']) ? $_SERVER['HTTP_COOKIE'] : '', is_array($in) ? $in : array());
Cm_out($http, $res);
