<?php
# Ввод промокода портала ideav.ru/courses (ideav/courses#172): POST course, code (форма или JSON).
# Проверка и списание — на сервере, логика — include/courses_promo.php. Ответ — JSON.
require_once __DIR__ . '/include/courses_promo.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
function Cpr_out($http, $data){ http_response_code($http); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }

# Только свой фронт: заголовок X-Requested-With не отправить кросс-доменной формой
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !isset($_SERVER['HTTP_X_REQUESTED_WITH'])) Cpr_out(405, array('ok' => false, 'error' => 'method'));
try {
    $cfg = Cp_load_config();
} catch (Exception $e) {
    error_log($e->getMessage());
    Cpr_out(500, array('ok' => false, 'error' => 'server'));
}
$in = $_POST;
if (!$in) { $j = json_decode(file_get_contents('php://input'), true); $in = is_array($j) ? $j : array(); }
list($http, $res) = Cpr_redeem($cfg, isset($_SERVER['HTTP_COOKIE']) ? $_SERVER['HTTP_COOKIE'] : '',
    isset($in['course']) ? $in['course'] : '', isset($in['code']) ? $in['code'] : '');
Cpr_out($http, $res);
