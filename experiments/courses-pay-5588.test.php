<?php
# Оплата авторского курса (код a<N>, строка Каталога) картой/СБП — ideav/crm#5588.
# Мерка: include/courses_pay.php и include/courses_promo.php с подменённым HTTP.
#   1) цена и название авторского курса — из строки Каталога (не из запроса и не из courses.json);
#      бесплатный (Цена 0) и неизвестный авторский курс не продаём;
#   2) курс без манифеста (ни в «Курс автора», ни в Каталоге) не продаём: деньги взяли бы,
#      а открыть нечего;
#   3) вебхук выдаёт «Доступ» с ключом = адрес манифеста из «Курс автора» (его читает
#      courses_content.php: Курс автора → Каталог → Доступ.Ключ);
#   4) промокод на авторский курс без своего «Ключа» открывает курс тем же ключом;
#   5) цифры названия в purpose — римскими: twh.php берёт число из purpose как id пользователя my.

require __DIR__ . '/../include/courses_promo.php';

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

$root = sys_get_temp_dir() . '/cp5588-' . getmypid();
rrmdir($root);
mkdir("$root/content", 0777, true);
file_put_contents("$root/content/courses.json", json_encode(array('courses' => array(
    array('code' => 'adept', 'title' => 'Адепт', 'free' => false, 'price' => 9900),
)), JSON_UNESCAPED_UNICODE));
file_put_contents("$root/schema.json", json_encode(array('tables' => array(
    'Доступ' => array('id' => 535, 'req' => array('Пользователь' => 536, 'Курс' => 537, 'Ключ' => 538, 'Основание' => 539, 'Дата и время' => 540)),
    'Оплата' => array('id' => 474, 'req' => array('Пользователь' => 526, 'Курс' => 527, 'Сумма' => 529, 'Дата' => 530, 'Возврат' => 532, 'Номер' => 534)),
    'Промокод' => array('id' => 473, 'req' => array('Курс' => 520, 'Лимит' => 522, 'Использовано' => 524, 'Срок' => 525, 'Ключ' => 2370)),
    'Заявка' => array('id' => 472, 'req' => array('Пользователь' => 514, 'Курс' => 515, 'Код промокода' => 517, 'Статус' => 518, 'Дата и время' => 519)),
    'Курс автора' => array('id' => 1409, 'req' => array('Владелец' => 1413, 'Цена' => 1418, 'Код' => 1431, 'Манифест' => 1433)),
    'Каталог' => array('id' => 1411, 'req' => array('Название' => 1447, 'Описание' => 1448, 'Цена' => 1451, 'Видимость' => 1456, 'Ссылка оплаты' => 1457, 'Манифест' => 1458)),
)), JSON_UNESCAPED_UNICODE));

$MAN = '/download/courses/content/edgul-st1-c06d64e61a30a190053f/manifest.json';
$net = array('whoami' => array('id' => '1102', 'user' => 'my236968', 'role' => 'Ученик'), 'access' => array(), 'pay' => array(),
    'writes' => array(), 'tochka' => array(), 'op' => 'op-a1',
    # Каталог: _main, Название, Описание, Цена, Видимость, Ссылка оплаты, Манифест
    'catalog' => array(
        array('i' => 2393, 'r' => array('a2026', 'Биоэнергетика. Ступень 1', 'описание', '16 900', 'каталог', '', '')),
        array('i' => 2394, 'r' => array('a2030', 'Открытый курс', 'описание', '0', 'каталог', '', '/download/courses/content/open/manifest.json')),
        array('i' => 2395, 'r' => array('a2040', 'Без манифеста', 'описание', '5000', 'каталог', '', '')),
    ),
    # Курс автора: _main, Владелец, Цена, Код, Манифест
    'author' => array(
        array('i' => 1999, 'r' => array('Биоэнергетика. Ступень 1', '', '16900', 'a2026', $MAN)),
    ),
    # Промокод: _main, Курс, Лимит, Использовано, Срок, Ключ
    'promo' => array(
        array('i' => 2600, 'r' => array('EDG-NOKEY', 'a2026', '5', '0', '', '')),
    ),
);
function fake_http($method, $url, $headers, $body){
    global $net;
    $path = parse_url($url, PHP_URL_PATH);
    if(strpos($url, 'enter.tochka.com') !== false){
        $net['tochka'][] = array('url' => $url, 'body' => json_decode($body, true));
        return array(200, json_encode(array('Data' => array('operationId' => $net['op'], 'paymentLink' => 'https://merch.securepaytb.ru/order/?uuid=' . $net['op']))));
    }
    if($path === '/courses/xsrf'){
        $isAdmin = false;
        foreach($headers as $h) if(stripos($h, 'Cookie:') === 0 && strpos($h, 'idb_courses=ADMIN') !== false) $isAdmin = true;
        return array(200, json_encode($isAdmin ? array('_xsrf' => 'X', 'user' => 'admin', 'role' => 'admin', 'id' => 0) : array('_xsrf' => 'U') + $net['whoami']));
    }
    if($path === '/courses/object/18/') return array(200, json_encode(array(array('i' => 1102, 'r' => array('my236968', '541:Ученик', 'student@example.com', '')))));
    if($path === '/courses/object/535/') return array(200, json_encode($net['access']));
    if($path === '/courses/object/474/') return array(200, json_encode($net['pay']));
    if($path === '/courses/object/1411/') return array(200, json_encode($net['catalog']));
    if($path === '/courses/object/1409/') return array(200, json_encode($net['author']));
    if($path === '/courses/object/473/') return array(200, json_encode($net['promo']));
    if($path === '/courses/object/472/') return array(200, json_encode(array()));
    if(preg_match('~^/courses/_m_set/(\d+)$~', $path, $m)){
        parse_str($body, $f);
        foreach($net['promo'] as &$p) if($p['i'] == $m[1] && isset($f['t524'])) $p['r'][3] = $f['t524'];
        return array(200, json_encode(array('id' => $m[1])));
    }
    if(preg_match('~^/courses/_m_new/(\d+)$~', $path, $m)){
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
function accessRows($course){ global $net; return array_values(array_filter($net['writes'], function($w) use ($course){ return $w['table'] === 535 && $w['fields']['t537'] === $course; })); }

# 1) бесплатный и неизвестный авторский курс не продаём
$r = Cp_start_payment($cfg, 'idb_courses=U', 'a2030');
expect(isset($r['error']) && count($net['tochka']) === 0, 'авторский курс с ценой 0 не продаём');
$r = Cp_start_payment($cfg, 'idb_courses=U', 'a9999');
expect(isset($r['error']) && count($net['tochka']) === 0, 'неизвестный авторский курс не продаём');

# 2) без манифеста не продаём
$r = Cp_start_payment($cfg, 'idb_courses=U', 'a2040');
expect(isset($r['error']) && count($net['tochka']) === 0, 'авторский курс без манифеста не продаём (открыть было бы нечего)');

# ссылка на a2026
$r = Cp_start_payment($cfg, 'idb_courses=U', 'a2026');
$t = $net['tochka'][0]['body']['Data'] ?? array();
expect(($r['redirect'] ?? '') === 'https://merch.securepaytb.ru/order/?uuid=op-a1', 'авторский курс: ученик получает ссылку Точки (было: ' . json_encode($r, JSON_UNESCAPED_UNICODE) . ')');
expect(($t['amount'] ?? '') === '16900.00' && ($t['Items'][0]['amount'] ?? '') === '16900.00', 'сумма — цена из строки Каталога «16 900»: 16900.00');
expect(isset($t['purpose']) && strpos($t['purpose'], 'Биоэнергетика. Ступень I»') !== false
    && !preg_match('/\d/', $t['purpose']) && !preg_match('/\d/', $t['Items'][0]['name'] ?? '1'),
    'в purpose — название из Каталога, цифры римскими (twh.php берёт число из purpose как id my): «' . ($t['purpose'] ?? '') . '»');
$o = json_decode(@file_get_contents("$root/orders/op-a1.json"), true);
expect(($o['course'] ?? null) === 'a2026' && ($o['amount'] ?? null) == 16900, 'заказ сохранён: курс a2026, сумма 16900');

# 3) вебхук → «Доступ» с ключом-манифестом
expect(Cp_webhook($cfg, array('operationId' => 'op-a1', 'amount' => '16900.00', 'status' => 'APPROVED')) === true, 'вебхук по авторскому курсу обработан');
$acc = accessRows('a2026');
expect(count($acc) === 1 && $acc[0]['fields']['t536'] === '1102' && $acc[0]['fields']['t538'] === $MAN && $acc[0]['fields']['t539'] === 'оплата',
    '«Доступ»: ученик 1102, ключ = манифест из «Курс автора», основание «оплата»');
$pay = array_values(array_filter($net['writes'], function($w){ return $w['table'] === 474; }));
expect(count($pay) === 1 && $pay[0]['fields']['t527'] === 'a2026' && $pay[0]['fields']['t529'] === '16900', 'записана «Оплата» 16900 по a2026');

# 4) промокод без своего Ключа — ключ курса
$net['access'] = array(); $net['writes'] = array();
$r = Cpr_redeem($cfg, 'idb_courses=U', 'a2026', 'EDG-NOKEY');
$acc = accessRows('a2026');
expect(($r[1]['ok'] ?? false) === true && count($acc) === 1 && $acc[0]['fields']['t538'] === $MAN && $acc[0]['fields']['t539'] === 'промокод',
    'промокод на авторский курс без «Ключа» открывает курс ключом-манифестом (ответ: ' . json_encode($r[1], JSON_UNESCAPED_UNICODE) . ')');

rrmdir($root);
echo $failures ? "\n$failures FAIL\n" : "\nOK\n";
exit($failures ? 1 : 0);
