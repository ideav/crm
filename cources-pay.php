<?php
# Ссылка на оплату курса портала ideav.ru/cources (ideav/courses#92): ?course=<код>.
# Ученик определяется по своей cookie, цена — из каталога; уходит на страницу оплаты Точки,
# после оплаты возвращается в /cources/?paid=<код>. Логика — include/cources_pay.php.
require_once __DIR__ . '/include/cources_pay.php';

header('Cache-Control: no-store');
try {
    $cfg = Cp_load_config();
} catch (Exception $e) {
    error_log($e->getMessage());
    header('Location: /cources/?payfail=config#/map', true, 302);
    exit;
}
$r = Cp_start_payment($cfg, isset($_SERVER['HTTP_COOKIE']) ? $_SERVER['HTTP_COOKIE'] : '', isset($_GET['course']) ? $_GET['course'] : '');
header('Location: ' . $r['redirect'], true, 302);
