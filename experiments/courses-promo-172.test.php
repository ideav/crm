<?php
# Промокоды портала ideav.ru/courses (ideav/courses#172): include/courses_promo.php с подменённым HTTP.
#   1) верный код открывает курс сразу: «Доступ» с основанием «промокод» и ключом курса, счётчик +1, «Заявка» done;
#   2) лимит: после исчерпания второй ученик получает exhausted, доступа нет, счётчик не растёт;
#   3) неверный код, код другого курса, просроченный — понятные коды ошибок, ничего не пишется;
#   4) повторный ввод тем же учеником — already, место не списывается; гость — login;
#   5) сбой выдачи доступа возвращает списанное место; 10 неверных подряд — too_many.

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

$root = sys_get_temp_dir() . '/cpr172-' . getmypid();
rrmdir($root);
mkdir("$root/content/adept-0123456789abcdef0123456789abcdef", 0777, true);
mkdir("$root/content/partner-fedcba9876543210fedcba9876543210", 0777, true);
file_put_contents("$root/content/courses.json", json_encode(array('courses' => array(
    array('code' => 'adept', 'title' => 'Адепт', 'free' => false, 'price' => 9900),
    array('code' => 'partner', 'title' => 'Партнёр', 'free' => false, 'price' => 4900),
)), JSON_UNESCAPED_UNICODE));
file_put_contents("$root/schema.json", json_encode(array('tables' => array(
    'Доступ' => array('id' => 535, 'req' => array('Пользователь' => 536, 'Курс' => 537, 'Ключ' => 538, 'Основание' => 539, 'Дата и время' => 540)),
    'Оплата' => array('id' => 474, 'req' => array('Пользователь' => 526, 'Курс' => 527, 'Сумма' => 529)),
    'Промокод' => array('id' => 600, 'req' => array('Курс' => 601, 'Лимит' => 602, 'Использовано' => 603, 'Срок' => 604)),
    'Заявка' => array('id' => 610, 'req' => array('Пользователь' => 611, 'Курс' => 612, 'Код промокода' => 613, 'Статус' => 614, 'Дата и время' => 615)),
)), JSON_UNESCAPED_UNICODE));

$net = array('uid' => '1102', 'role' => 'Ученик', 'access' => array(), 'req' => array(), 'fail_access' => false,
    'promo' => array(
        array('i' => 700, 'r' => array('ALPHA', 'adept', '2', '0', '')),
        array('i' => 701, 'r' => array('beta', 'partner', '5', '0', '')),
        array('i' => 702, 'r' => array('OLD', 'adept', '5', '0', '01.01.2020')),
        array('i' => 703, 'r' => array('free', '', '', '0', '31.12.2099')),
    ));
function fake_http($method, $url, $headers, $body){
    global $net;
    $path = parse_url($url, PHP_URL_PATH);
    if($path === '/courses/xsrf'){
        $admin = false;
        foreach($headers as $h) if(strpos($h, 'idb_courses=ADMIN') !== false) $admin = true;
        return array(200, json_encode($admin ? array('_xsrf' => 'X', 'id' => 0, 'role' => 'admin') : array('_xsrf' => 'U', 'id' => $net['uid'], 'role' => $net['role'])));
    }
    if($path === '/courses/object/535/') return array(200, json_encode($net['access']));
    if($path === '/courses/object/600/') return array(200, json_encode($net['promo']));
    if($path === '/courses/object/610/') return array(200, json_encode($net['req']));
    if(preg_match('~^/courses/_m_set/(\d+)$~', $path, $m)){
        parse_str($body, $f);
        foreach($net['promo'] as &$p) if($p['i'] == $m[1]) $p['r'][3] = $f['t603'];
        return array(200, json_encode(array('id' => $m[1])));
    }
    if(preg_match('~^/courses/_m_new/(\d+)$~', $path, $m)){
        parse_str($body, $f);
        if((int)$m[1] === 535) {
            if($net['fail_access']) return array(200, json_encode(array(array('error' => 'нет доступа'))));
            $net['access'][] = array('i' => 9000 + count($net['access']), 'r' => array($f['t535'], $f['t536'] . ':u', $f['t537'], $f['t538'], $f['t539'], $f['t540']));
        }
        if((int)$m[1] === 610) $net['req'][] = array('i' => 9500 + count($net['req']), 'r' => array($f['t610'], $f['t611'] . ':u', $f['t612'], $f['t613'], $f['t614'], $f['t615']));
        return array(200, json_encode(array('id' => 9999)));
    }
    return array(404, 'not found: ' . $url);
}
$cfg = array('site' => 'https://ideav.ru', 'admin_token' => 'ADMIN', 'store_dir' => "$root/orders", 'content_dir' => "$root/content",
    'schema_file' => "$root/schema.json", 'http' => 'fake_http', 'log' => "$root/pay.log");
function used($i){ global $net; foreach($net['promo'] as $p) if($p['i'] == $i) return (int)$p['r'][3]; return -1; }
function redeem($course, $code){ global $cfg; $r = Cpr_redeem($cfg, 'idb_courses=U', $course, $code); return $r[1]; }

# 1) верный код (регистр не важен) открывает курс сразу
$r = redeem('adept', ' alpha ');
expect(($r['ok'] ?? false) && $r['status'] === 'granted', 'верный код: granted');
expect(count($net['access']) === 1 && $net['access'][0]['r'][2] === 'adept' && $net['access'][0]['r'][4] === 'промокод'
    && $net['access'][0]['r'][3] === '0123456789abcdef0123456789abcdef', 'создан «Доступ»: курс, основание «промокод», ключ из каталога контента');
expect(used(700) === 1, 'счётчик активаций +1');
expect(count($net['req']) === 1 && $net['req'][0]['r'][4] === 'done' && $net['req'][0]['r'][3] === 'ALPHA', 'в журнале «Заявка» со статусом done');

# 4) повтор тем же учеником
$r = redeem('adept', 'ALPHA');
expect(($r['status'] ?? '') === 'already' && used(700) === 1 && count($net['access']) === 1, 'повтор: already, место не списано, дубля доступа нет');

# 2) лимит 2: второй ученик берёт последнее место, третий — exhausted
$net['uid'] = '1103'; $r = redeem('adept', 'ALPHA');
expect(($r['status'] ?? '') === 'granted' && used(700) === 2, 'второй ученик: последнее место');
$net['uid'] = '1104'; $r = redeem('adept', 'ALPHA');
expect(($r['error'] ?? '') === 'exhausted' && used(700) === 2 && count($net['access']) === 2, 'исчерпан: exhausted, счётчик и доступы не растут');


# 3) неверный, чужой курс, просроченный
$r = redeem('adept', 'NOPE');
expect(($r['error'] ?? '') === 'invalid', 'неверный код: invalid');
$r = redeem('adept', 'beta');
expect(($r['error'] ?? '') === 'wrong_course' && used(701) === 0, 'код другого курса: wrong_course');
$r = redeem('adept', 'OLD');
expect(($r['error'] ?? '') === 'expired' && used(702) === 0, 'срок истёк: expired');
$r = redeem('partner', 'free');
expect(($r['status'] ?? '') === 'granted' && used(703) === 1, 'код без курса и лимита подходит любому курсу');
$r = redeem('../x', 'free');
expect(($r['error'] ?? '') === 'course', 'кривой код курса отклонён');

# 5) сбой выдачи доступа возвращает место
$net['uid'] = '1200'; $net['fail_access'] = true;
$r = redeem('partner', 'beta');
expect(($r['error'] ?? '') === 'server' && used(701) === 0, 'сбой записи доступа: место возвращено, ответ server');
$net['fail_access'] = false;

# гость
$net['uid'] = '1114'; $net['role'] = 'guest';
$r = Cpr_redeem($cfg, 'idb_courses=G', 'adept', 'ALPHA');
expect($r[0] === 401 && $r[1]['error'] === 'login', 'гость: login (401)');
$net['role'] = 'Ученик';

# перебор: 10 неверных подряд → too_many
$net['uid'] = '1300';
for($i = 0; $i < 10; $i++) redeem('adept', 'bad' . $i);
$r = Cpr_redeem($cfg, 'idb_courses=U', 'adept', 'ALPHA');
expect($r[0] === 429 && $r[1]['error'] === 'too_many', 'перебор кодов: после 10 неверных — too_many (429)');

rrmdir($root);
echo $failures ? "\nFAILED: $failures\n" : "\nOK\n";
exit($failures ? 1 : 0);
