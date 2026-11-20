<?php
# Вебхук оплаты курса: подпись JWT и статус (ideav/courses#173). Предмет — include/courses_pay.php.
#   1) подпись RS256 сходится по PEM и по JWK; чужая подпись, alg=none, HS256, обрезанный токен — 403;
#   2) статус не APPROVED доступ не открывает и заказ не закрывает;
#   3) подписанный APPROVED открывает «Оплату»+«Доступ», повтор — без дублей.
require __DIR__ . '/../include/courses_pay.php';

$failures = 0;
function expect($cond, $name){ global $failures; if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; } }
function b64u($s){ return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function jwt($payload, $pk, $alg = 'RS256'){
    $h = b64u(json_encode(array('alg' => $alg, 'typ' => 'JWT'))); $b = b64u(json_encode($payload));
    $sig = '';
    if($alg === 'RS256') openssl_sign("$h.$b", $sig, $pk, OPENSSL_ALGO_SHA256);
    return "$h.$b." . b64u($sig);
}
function rrmdir($d){ if(!is_dir($d)) return; foreach(scandir($d) as $f) if($f !== '.' && $f !== '..') { $p = "$d/$f"; is_dir($p) ? rrmdir($p) : unlink($p); } rmdir($d); }

$conf = array('private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA);
$cnf = getenv('OPENSSL_CONF'); if(!$cnf) foreach(array('C:/web/php/extras/ssl/openssl.cnf', '/etc/ssl/openssl.cnf') as $c) if(is_file($c)) $conf['config'] = $c;
$pk = openssl_pkey_new($conf); $other = openssl_pkey_new($conf);
if(!$pk || !$other){ echo "SKIP — openssl не создаёт ключи\n"; exit(0); }
$d = openssl_pkey_get_details($pk);
$pem = $d['key'];
$jwk = array('kty' => 'RSA', 'e' => b64u($d['rsa']['e']), 'n' => b64u($d['rsa']['n']));

$root = sys_get_temp_dir() . '/cp173-' . getmypid(); rrmdir($root);
mkdir("$root/content/adept-0123456789abcdef0123456789abcdef", 0777, true);
file_put_contents("$root/content/courses.json", json_encode(array('courses' => array(array('code' => 'adept', 'title' => 'Адепт', 'price' => 9900)))));
file_put_contents("$root/schema.json", json_encode(array('tables' => array(
    'Доступ' => array('id' => 535, 'req' => array('Пользователь' => 536, 'Курс' => 537, 'Ключ' => 538, 'Основание' => 539, 'Дата и время' => 540)),
    'Оплата' => array('id' => 474, 'req' => array('Пользователь' => 526, 'Курс' => 527, 'Сумма' => 529, 'Дата' => 530, 'Возврат' => 532, 'Номер' => 534)),
)), JSON_UNESCAPED_UNICODE));
mkdir("$root/orders"); file_put_contents("$root/orders/op-1.json", json_encode(array('user' => '1102', 'course' => 'adept', 'amount' => 9900)));

$net = array('access' => array(), 'pay' => array(), 'writes' => array());
function fake_http($method, $url, $headers, $body){
    global $net; $path = parse_url($url, PHP_URL_PATH);
    if($path === '/courses/xsrf') return array(200, json_encode(array('_xsrf' => 'X')));
    if($path === '/courses/object/535/') return array(200, json_encode($net['access']));
    if($path === '/courses/object/474/') return array(200, json_encode($net['pay']));
    if(preg_match('~^/courses/_m_new/(\d+)$~', $path, $m)){
        parse_str($body, $f); $net['writes'][] = (int)$m[1];
        if((int)$m[1] === 535) $net['access'][] = array('i' => 1, 'r' => array($f['t535'], $f['t536'] . ':u', $f['t537'], $f['t538']));
        if((int)$m[1] === 474) $net['pay'][] = array('i' => 2, 'r' => array($f['t474'], $f['t526'] . ':u', $f['t527'], $f['t529'], $f['t530'], '', $f['t534']));
        return array(200, json_encode(array('id' => 9)));
    }
    return array(404, 'x');
}
$cfg = array('site' => 'https://ideav.ru', 'admin_token' => 'ADMIN', 'store_dir' => "$root/orders", 'content_dir' => "$root/content",
    'schema_file' => "$root/schema.json", 'http' => 'fake_http', 'webhook_public_key' => $pem);

$ev = array('webhookType' => 'acquiringInternetPayment', 'operationId' => 'op-1', 'amount' => '9900.00', 'status' => 'APPROVED');

expect(Cp_verify_jwt($cfg, jwt($ev, $pk)) === $ev, 'подпись сходится по PEM');
$cfgJ = $cfg; $cfgJ['webhook_public_key'] = $jwk;
expect(Cp_verify_jwt($cfgJ, jwt($ev, $pk)) === $ev, 'подпись сходится по JWK');
$cfgJs = $cfg; $cfgJs['webhook_public_key'] = json_encode($jwk);
expect(Cp_verify_jwt($cfgJs, jwt($ev, $pk)) === $ev, 'подпись сходится по JWK-строке');
expect(Cp_verify_jwt($cfg, jwt($ev, $other)) === null, 'чужая подпись отклонена');
expect(Cp_verify_jwt($cfg, jwt($ev, $pk, 'none')) === null, 'alg=none отклонён');
$t = jwt($ev, $pk); $p = explode('.', $t);
expect(Cp_verify_jwt($cfg, $p[0] . '.' . b64u(json_encode(array('amount' => '1') + $ev)) . '.' . $p[2]) === null, 'подмена тела отклонена');
expect(Cp_verify_jwt($cfg, 'abc') === null && Cp_verify_jwt($cfg, json_encode($ev)) === null, 'не JWT (в т.ч. голый JSON) отклонён');
$cfgN = $cfg; unset($cfgN['webhook_public_key']);
expect(Cp_verify_jwt($cfgN, $t) === null, 'без ключа в конфиге — отклонён');

list($code, ) = Cp_handle_webhook($cfg, jwt($ev, $other));
expect($code === 403 && !$net['writes'], 'неподписанный вебхук: 403, ничего не записано');

list($code, $r) = Cp_handle_webhook($cfg, jwt(array('status' => 'EXPIRED') + $ev, $pk));
$o = json_decode(file_get_contents("$root/orders/op-1.json"), true);
expect($code === 200 && !$net['writes'] && empty($o['done']), 'статус не APPROVED: доступа нет, заказ не закрыт');

list($code, $r) = Cp_handle_webhook($cfg, jwt(array('operationId' => 'foreign') + $ev, $pk));
expect($code === 200 && $r === null, 'чужой operationId: 200 и null (путь my продолжается)');

list($code, $r) = Cp_handle_webhook($cfg, jwt($ev, $pk));
expect($code === 200 && $r === true && $net['writes'] === array(474, 535), 'подписанный APPROVED: «Оплата» и «Доступ»');
list($code, $r) = Cp_handle_webhook($cfg, jwt($ev, $pk));
expect($code === 200 && count($net['writes']) === 2, 'повтор вебхука — без дублей');

rrmdir($root);
echo $failures ? "\n$failures FAIL\n" : "\nOK\n";
exit($failures ? 1 : 0);
