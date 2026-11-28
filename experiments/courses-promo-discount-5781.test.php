<?php
# Процентная скидка по промокоду портала ideav.ru/courses (ideav/crm#5781).
#   1) код со «Скидкой» 1–99% не открывает курс: redeem отвечает status=discount, новая цена, место не списано;
#   2) код без «Скидки» (пусто/0/100) открывает курс бесплатно, как раньше;
#   3) ссылка оплаты с промокодом: в Точку уходит цена со скидкой, заказ помнит промокод;
#      неверный/просроченный/чужой код — оплата не создаётся;
#   4) вебхук подтверждённой оплаты: «Доступ» (основание «оплата»), место в лимите списано один раз;
#   5) лимит исчерпан — ссылку со скидкой не создаём.

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

$root = sys_get_temp_dir() . '/cpr5781-' . getmypid();
rrmdir($root);
mkdir("$root/content/adept-0123456789abcdef0123456789abcdef", 0777, true);
mkdir("$root/content/partner-fedcba9876543210fedcba9876543210", 0777, true);
file_put_contents("$root/content/courses.json", json_encode(array('courses' => array(
    array('code' => 'adept', 'title' => 'Адепт', 'free' => false, 'price' => 9900),
    array('code' => 'partner', 'title' => 'Партнёр', 'free' => false, 'price' => 4900),
)), JSON_UNESCAPED_UNICODE));
file_put_contents("$root/schema.json", json_encode(array('tables' => array(
    'Доступ' => array('id' => 535, 'req' => array('Пользователь' => 536, 'Курс' => 537, 'Ключ' => 538, 'Основание' => 539, 'Дата и время' => 540)),
    'Оплата' => array('id' => 474, 'req' => array('Пользователь' => 526, 'Курс' => 527, 'Сумма' => 529, 'Дата' => 530, 'Возврат' => 532, 'Номер' => 534)),
    'Промокод' => array('id' => 600, 'req' => array('Курс' => 601, 'Лимит' => 602, 'Использовано' => 603, 'Срок' => 604, 'Ключ' => 605, 'Скидка' => 606)),
    'Заявка' => array('id' => 610, 'req' => array('Пользователь' => 611, 'Курс' => 612, 'Код промокода' => 613, 'Статус' => 614, 'Дата и время' => 615)),
)), JSON_UNESCAPED_UNICODE));

$net = array('uid' => '1102', 'role' => 'Ученик', 'access' => array(), 'req' => array(), 'pay' => array(), 'tochka' => array(), 'op' => 'op-1',
    'promo' => array(
        array('i' => 700, 'r' => array('SALE90', '', '3', '0', '31.12.2099', '', '90')),
        array('i' => 701, 'r' => array('FREE', '', '', '0', '', '', '')),
        array('i' => 702, 'r' => array('HALF', 'partner', '', '0', '', '', '50')),
        array('i' => 703, 'r' => array('OLD90', '', '', '0', '01.01.2020', '', '90')),
        array('i' => 704, 'r' => array('ONE', '', '1', '1', '', '', '90')),
    ));
function fake_http($method, $url, $headers, $body){
    global $net;
    $path = parse_url($url, PHP_URL_PATH);
    if(strpos($url, 'enter.tochka.com') !== false){
        $net['tochka'][] = json_decode($body, true);
        return array(200, json_encode(array('Data' => array('operationId' => $net['op'], 'paymentLink' => 'https://merch.securepaytb.ru/order/?uuid=' . $net['op']))));
    }
    if($path === '/courses/xsrf'){
        $admin = false;
        foreach($headers as $h) if(strpos($h, 'idb_courses=ADMIN') !== false) $admin = true;
        return array(200, json_encode($admin ? array('_xsrf' => 'X', 'id' => 0, 'role' => 'admin') : array('_xsrf' => 'U', 'id' => $net['uid'], 'user' => 'u' . $net['uid'], 'role' => $net['role'])));
    }
    if($path === '/courses/object/18/') return array(200, json_encode(array(array('i' => 1102, 'r' => array('u1102', '541:Ученик', 'student@example.com')))));
    if($path === '/courses/object/535/') return array(200, json_encode($net['access']));
    if($path === '/courses/object/474/') return array(200, json_encode($net['pay']));
    if($path === '/courses/object/600/') return array(200, json_encode($net['promo']));
    if($path === '/courses/object/610/') return array(200, json_encode($net['req']));
    if(preg_match('~^/courses/_m_set/(\d+)$~', $path, $m)){
        parse_str($body, $f);
        foreach($net['promo'] as &$p) if($p['i'] == $m[1]) $p['r'][3] = $f['t603'];
        return array(200, json_encode(array('id' => $m[1])));
    }
    if(preg_match('~^/courses/_m_new/(\d+)$~', $path, $m)){
        parse_str($body, $f);
        $id = 9000 + count($net['access']) + count($net['pay']) + count($net['req']);
        if((int)$m[1] === 535) $net['access'][] = array('i' => $id, 'r' => array($f['t535'], $f['t536'] . ':u', $f['t537'], $f['t538'], $f['t539'], $f['t540']));
        if((int)$m[1] === 474) $net['pay'][] = array('i' => $id, 'r' => array($f['t474'], $f['t526'] . ':u', $f['t527'], $f['t529'], $f['t530'], '', $f['t534']));
        if((int)$m[1] === 610) $net['req'][] = array('i' => $id, 'r' => array($f['t610'], $f['t611'] . ':u', $f['t612'], $f['t613'], $f['t614'], $f['t615']));
        return array(200, json_encode(array('id' => $id)));
    }
    return array(404, 'not found: ' . $url);
}
$cfg = array('site' => 'https://ideav.ru', 'admin_token' => 'ADMIN', 'store_dir' => "$root/orders", 'content_dir' => "$root/content",
    'schema_file' => "$root/schema.json", 'http' => 'fake_http', 'log' => "$root/pay.log",
    'tochka_token' => 'TT', 'customer_code' => '1', 'merchant_id' => '2', 'supplier' => array('name' => 'АО ИНТЕГРАМ'));
function used($i){ global $net; foreach($net['promo'] as $p) if($p['i'] == $i) return (int)$p['r'][3]; return -1; }
function redeem($course, $code){ global $cfg; $r = Cpr_redeem($cfg, 'idb_courses=U', $course, $code); return $r[1]; }
function pay($course, $promo){ global $cfg; return Cp_start_payment($cfg, 'idb_courses=U', $course, $promo); }
function last_amount(){ global $net; $t = end($net['tochka']); return $t ? $t['Data']['amount'] : null; }

# 1) скидка 90% на любой курс: курс не открыт, цена посчитана, место не списано
$r = redeem('adept', 'sale90');
expect(($r['ok'] ?? false) && ($r['status'] ?? '') === 'discount' && ($r['discount'] ?? 0) == 90
    && ($r['price'] ?? 0) == 990 && ($r['full'] ?? 0) == 9900, 'скидка 90%: status=discount, 990 вместо 9900');
expect(count($net['access']) === 0 && used(700) === 0 && count($net['req']) === 0, 'скидка: доступа нет, место не списано, заявки нет');
$r = redeem('partner', 'SALE90');
expect(($r['status'] ?? '') === 'discount' && ($r['price'] ?? 0) == 490, 'пустой «Курс» — скидка на любой курс (партнёр: 490)');

# 2) код без скидки — бесплатно, как раньше
$r = redeem('adept', 'FREE');
expect(($r['status'] ?? '') === 'granted' && count($net['access']) === 1 && used(701) === 1, 'без «Скидки» курс открыт бесплатно');
$net['access'] = array();

# 3) ссылка оплаты с промокодом
$r = pay('adept', 'Sale90');
expect(isset($r['redirect']) && !isset($r['error']) && last_amount() === '990.00', 'оплата с промокодом: в Точку уходит 990.00');
$o = json_decode(@file_get_contents("$root/orders/op-1.json"), true);
expect(($o['amount'] ?? 0) == 990 && ($o['promo_id'] ?? '') == 700 && ($o['discount'] ?? 0) == 90, 'заказ помнит промокод, скидку и цену со скидкой');
$n = count($net['tochka']); $net['op'] = 'op-2';
$r = pay('adept', 'NOPE');
expect(($r['error'] ?? '') === 'promo' && count($net['tochka']) === $n, 'неверный промокод: оплата не создаётся');
$r = pay('adept', 'OLD90');
expect(($r['error'] ?? '') === 'promo' && count($net['tochka']) === $n, 'просроченный промокод: оплата не создаётся');
$r = pay('adept', 'HALF');
expect(($r['error'] ?? '') === 'promo' && count($net['tochka']) === $n, 'промокод другого курса: оплата не создаётся');
$r = pay('adept', 'ONE');
expect(($r['error'] ?? '') === 'promo' && count($net['tochka']) === $n, 'лимит исчерпан: оплата не создаётся');
$r = pay('adept', '');
expect(!isset($r['error']) && last_amount() === '9900.00', 'без промокода — полная цена');

# 4) вебхук: доступ, место списано один раз
$ok = Cp_webhook($cfg, array('operationId' => 'op-1', 'status' => 'APPROVED', 'amount' => '990.00'));
expect($ok === true && count($net['access']) === 1 && $net['access'][0]['r'][4] === 'оплата', 'оплата 990: «Доступ» с основанием «оплата»');
expect(used(700) === 1, 'место в лимите списано после оплаты');
$ok = Cp_webhook($cfg, array('operationId' => 'op-1', 'status' => 'APPROVED', 'amount' => '990.00'));
expect($ok === true && used(700) === 1 && count($net['access']) === 1, 'повтор вебхука: место не списано второй раз');

rrmdir($root);
echo $failures ? "\nFAILED: $failures\n" : "\nOK\n";
exit($failures ? 1 : 0);
