<?php
# Приёмник вебхука Точки для оплаты курсов портала ideav.ru/courses (ideav/courses#173).
# Самостоятельный адрес: его можно зарегистрировать в Точке вместо twh.php. Подпись (JWT RS256)
# проверяется ключом из конфига, платёж открывает курс через Cp_webhook() (идемпотентно по operationId).
# Платёж не по заказу курса (например, пополнение счёта my) — 200 без действий: для этого адреса он чужой.
require_once __DIR__ . '/include/courses_pay.php';

header('Content-Type: text/plain; charset=utf-8');
try {
    $cfg = Cp_load_config();
} catch (Exception $e) {
    error_log($e->getMessage());
    http_response_code(500);
    exit('config');
}
list($code, ) = Cp_handle_webhook($cfg, file_get_contents('php://input'));
http_response_code($code);
echo $code === 200 ? 'ok' : 'error';
