<?php
# Оплата курсов портала ideav.ru/cources через эквайринг Точки (ideav/courses#92).
# Мерка: include/cources_pay.php с подменённым HTTP (Точка и API базы cources — заглушки),
# заказы и каталог — во временной папке.
#   1) гость и бесплатный курс ссылку не получают; цена — из каталога, не из запроса;
#   2) в purpose нет цифр: twh.php берёт число из конца purpose как id пользователя my
#      и пополнил бы его баланс, если курсовой платёж дойдёт до старой ветки;
#   3) вебхук по нашему operationId пишет «Оплату» и «Доступ» с ключом курса, повтор — без дублей;
#   4) чужой operationId не наш (null) — twh.php продолжает старый путь my;
#   5) сбой записи → false (twh.php ответит 500, Точка повторит), заказ не закрыт;
#   6) сумма меньше цены → «Оплата» есть, «Доступа» нет.

require __DIR__ . '/../include/cources_pay.php';

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

function rrmdir($d){
    if(!is_dir($d)) return;
    foreach(scandir($d) as $f) if($f !== '.' && $f !== '..') { $p = "$d/$f"; is_dir($p) ? rrmdir($p) : unlink($p); }
    rmdir($d);
}

$root = sys_get_temp_dir() . '/cp92-' . getmypid();
rrmdir($root);
mkdir("$root/content/adept-0123456789abcdef0123456789abcdef", 0777, true);
mkdir("$root/content/partner-fedcba9876543210fedcba9876543210", 0777, true);
mkdir("$root/content/mini", 0777, true);
file_put_contents("$root/content/courses.json", json_encode(array('courses' => array(
    array('code' => 'mini', 'title' => 'Мини-курс', 'free' => true),
    array('code' => 'adept', 'title' => 'Адепт', 'free' => false, 'price' => 9900),
    array('code' => 'partner', 'title' => 'Партнёр-продавец', 'free' => false, 'price' => 4900),
)), JSON_UNESCAPED_UNICODE));
file_put_contents("$root/schema.json", json_encode(array('tables' => array(
    'Доступ' => array('id' => 535, 'req' => array('Пользователь' => 536, 'Курс' => 537, 'Ключ' => 538, 'Основание' => 539, 'Дата и время' => 540)),
    'Оплата' => array('id' => 474, 'req' => array('Пользователь' => 526, 'Курс' => 527, 'Сумма' => 529, 'Дата' => 530, 'Возврат' => 532, 'Номер' => 534)),
)), JSON_UNESCAPED_UNICODE));

# Заглушка сети: кто я (по cookie), объекты базы, запись, Точка.
$net = array('whoami' => array('id' => '1102', 'user' => 'my236968', 'role' => 'Ученик'), 'access' => array(), 'pay' => array(),
             'writes' => array(), 'tochka' => array(), 'fail_write' => false, 'op' => 'op-1');
function fake_http($method, $url, $headers, $body){
    global $net;
    $q = parse_url($url, PHP_URL_QUERY); $path = parse_url($url, PHP_URL_PATH);
    if(strpos($url, 'enter.tochka.com') !== false){
        $net['tochka'][] = array('url' => $url, 'headers' => $headers, 'body' => json_decode($body, true));
        return array(200, json_encode(array('Data' => array('operationId' => $net['op'], 'paymentLink' => 'https://merch.tochka.com/order/?uuid=' . $net['op']))));
    }
    if($path === '/cources/xsrf'){
        $isAdmin = false;
        foreach($headers as $h) if(stripos($h, 'Cookie:') === 0 && strpos($h, 'idb_cources=ADMIN') !== false) $isAdmin = true;
        return array(200, json_encode($isAdmin ? array('_xsrf' => 'X', 'user' => 'admin', 'role' => 'admin', 'id' => 0) : array('_xsrf' => 'U') + $net['whoami']));
    }
    if($path === '/cources/object/18/') return array(200, json_encode(array(array('i' => 1102, 'r' => array('my236968', '541:Ученик', 'student@example.com', '')))));
    if($path === '/cources/object/535/') return array(200, json_encode($net['access']));
    if($path === '/cources/object/474/') return array(200, json_encode($net['pay']));
    if(preg_match('~^/cources/_m_new/(\d+)$~', $path, $m)){
        if($net['fail_write']) return array(200, json_encode(array(array('error' => 'нет доступа'))));
        parse_str($body, $f);
        $net['writes'][] = array('table' => (int)$m[1], 'fields' => $f);
        $id = 9000 + count($net['writes']);
        if((int)$m[1] === 535) $net['access'][] = array('i' => $id, 'r' => array($f['t535'], $f['t536'] . ':my236968', $f['t537'], $f['t538'], $f['t539'], $f['t540']));
        if((int)$m[1] === 474) $net['pay'][] = array('i' => $id, 'r' => array($f['t474'], $f['t526'] . ':my236968', $f['t527'], $f['t529'], $f['t530'], '', $f['t534']));
        return array(200, json_encode(array('id' => $id)));
    }
    return array(404, 'not found: ' . $url);
}

$cfg = array(
    'site' => 'https://ideav.ru', 'tochka_token' => 'TT', 'customer_code' => '304686729', 'merchant_id' => '200000000035972',
    'admin_token' => 'ADMIN', 'store_dir' => "$root/orders", 'content_dir' => "$root/content", 'schema_file' => "$root/schema.json",
    'supplier' => array('phone' => '+70000000000', 'name' => 'АО ИНТЕГРАМ', 'taxCode' => '9716002710'), 'tax_system' => 'usn_income',
    'http' => 'fake_http', 'log' => "$root/pay.log",
);

# 1) гость
$net['whoami'] = array('id' => '1114', 'user' => 'guest', 'role' => 'guest');
$r = Cp_start_payment($cfg, 'idb_cources=G', 'adept');
expect(isset($r['error']) && $r['error'] === 'login' && count($net['tochka']) === 0, 'гость: ссылку не создаём, ведём на вход');
$net['whoami'] = array('id' => '1102', 'user' => 'my236968', 'role' => 'Ученик');

# бесплатный и неизвестный курс
$r = Cp_start_payment($cfg, 'idb_cources=U', 'mini');
expect(isset($r['error']) && count($net['tochka']) === 0, 'бесплатный курс не продаём');
$r = Cp_start_payment($cfg, 'idb_cources=U', '../adept');
expect(isset($r['error']) && count($net['tochka']) === 0, 'неизвестный код курса отклонён');

# ссылка на «Адепт»
$r = Cp_start_payment($cfg, 'idb_cources=U', 'adept');
$t = $net['tochka'][0]['body']['Data'] ?? array();
expect(($r['redirect'] ?? '') === 'https://merch.tochka.com/order/?uuid=op-1', 'ученик получает ссылку Точки');
expect(($t['amount'] ?? '') === '9900.00' && ($t['Items'][0]['amount'] ?? '') === '9900.00', 'сумма — цена из каталога: 9900.00');
expect(isset($t['purpose']) && !preg_match('/\d/', $t['purpose']) && !preg_match('/\d/', $t['Items'][0]['name']), 'в purpose и позиции чека нет цифр: «' . ($t['purpose'] ?? '') . '»');
expect(($t['Client']['email'] ?? '') === 'student@example.com', 'чек — на почту ученика');
expect(strpos($t['redirectUrl'] ?? '', 'https://ideav.ru/cources/?paid=adept') === 0 && strpos($t['failRedirectUrl'] ?? '', 'https://ideav.ru/cources/?payfail=adept') === 0, 'возврат после оплаты — в кабинет курсов');
expect(!isset($t['saveCard']) && !isset($t['consumerId']), 'карту не сохраняем, общего consumerId нет');
expect(in_array('Authorization: Bearer TT', $net['tochka'][0]['headers'], true), 'запрос к Точке с токеном из конфига');
$o = json_decode(@file_get_contents("$root/orders/op-1.json"), true);
expect(($o['user'] ?? null) === '1102' && ($o['course'] ?? null) === 'adept' && ($o['amount'] ?? null) == 9900, 'заказ сохранён по operationId');

# 4) чужой платёж (пополнение my) — не наш
expect(Cp_webhook($cfg, array('operationId' => 'other', 'purpose' => 'Пополнение счета 217874', 'amount' => '103.00', 'status' => 'APPROVED')) === null, 'чужой operationId → null, twh.php идёт старым путём');

# 5) сбой записи
$net['fail_write'] = true;
expect(Cp_webhook($cfg, array('operationId' => 'op-1', 'purpose' => $t['purpose'], 'amount' => '9900.00', 'status' => 'APPROVED')) === false, 'сбой записи → false (Точка повторит)');
$o = json_decode(file_get_contents("$root/orders/op-1.json"), true);
expect(empty($o['done']), 'заказ после сбоя не закрыт');
$net['fail_write'] = false;

# 3) оплата прошла
expect(Cp_webhook($cfg, array('operationId' => 'op-1', 'purpose' => $t['purpose'], 'amount' => '9900.00', 'status' => 'APPROVED')) === true, 'наш платёж обработан');
$pay = array_values(array_filter($net['writes'], function($w){ return $w['table'] === 474; }));
$acc = array_values(array_filter($net['writes'], function($w){ return $w['table'] === 535; }));
expect(count($pay) === 1 && $pay[0]['fields']['t526'] === '1102' && $pay[0]['fields']['t527'] === 'adept' && $pay[0]['fields']['t529'] === '9900' && $pay[0]['fields']['t534'] === 'op-1'
    && preg_match('/^\d\d\.\d\d\.\d{4}$/', $pay[0]['fields']['t530']), 'записана «Оплата»: ученик, курс, сумма, дата, номер = operationId');
expect(count($acc) === 1 && $acc[0]['fields']['t536'] === '1102' && $acc[0]['fields']['t538'] === '0123456789abcdef0123456789abcdef' && $acc[0]['fields']['t539'] === 'оплата'
    && preg_match('/^\d\d\.\d\d\.\d{4} \d\d:\d\d:\d\d$/', $acc[0]['fields']['t540']), 'выдан «Доступ» с ключом курса и основанием «оплата»');
expect(($pay[0]['fields']['_xsrf'] ?? '') === 'X', 'запись — от админа базы с его xsrf');

# повтор вебхука
$n = count($net['writes']);
expect(Cp_webhook($cfg, array('operationId' => 'op-1', 'purpose' => $t['purpose'], 'amount' => '9900.00', 'status' => 'APPROVED')) === true && count($net['writes']) === $n, 'повтор вебхука — без дублей');

# уже есть доступ → без оплаты, сразу в курс
$r = Cp_start_payment($cfg, 'idb_cources=U', 'adept');
expect(count($net['tochka']) === 1 && strpos($r['redirect'] ?? '', '/cources/#/map') !== false, 'доступ уже есть — вторую ссылку не создаём');

# 6) недоплата: «Партнёр» за 100 ₽
$net['op'] = 'op-2';
$r = Cp_start_payment($cfg, 'idb_cources=U', 'partner');
$n = count($net['writes']);
expect(Cp_webhook($cfg, array('operationId' => 'op-2', 'purpose' => 'x', 'amount' => '100.00', 'status' => 'APPROVED')) === true, 'недоплата подтверждена Точке');
$w = array_slice($net['writes'], $n);
expect(count($w) === 1 && $w[0]['table'] === 474, 'недоплата: «Оплата» записана, «Доступ» не выдан');

rrmdir($root);
echo $failures ? "\n$failures FAIL\n" : "\nOK\n";
exit($failures ? 1 : 0);
