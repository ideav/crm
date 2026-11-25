<?php
# Видеовстречи портала ideav.ru/courses (ideav/courses#200): ключи Jitsi выдаёт только сервер.
# Мерка: include/courses_meet.php с подменённым HTTP (кто я по cookie, «Доступ», «Курс автора», «Профиль»).
#   1) без раздела meet в конфиге — 503; гость портала — 401; без «Доступа» — 403;
#   2) встречу заводит только ведущий (куратор/админ, владелец «Курса автора»), код видит только он;
#   3) ключ: подпись HS256 секретом, aud/iss/sub/room, срок ttl, модератор — только ведущий, имя из «Профиля»;
#   4) блок-лист: заблокированный ключа не получает, разблокированный снова получает;
#   5) гость по коду; блок гостя и «новый код» гасят старый код; закрытая встреча ключей не выдаёт.

require __DIR__ . '/../include/courses_meet.php';

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

$root = sys_get_temp_dir() . '/cmeet-' . getmypid();
rrmdir($root);
mkdir($root, 0777, true);
file_put_contents("$root/schema.json", json_encode(array('tables' => array(
    'Доступ' => array('id' => 535, 'req' => array('Пользователь' => 536, 'Курс' => 537, 'Ключ' => 538)),
    'Оплата' => array('id' => 474, 'req' => array('Пользователь' => 526)),
    'Профиль' => array('id' => 471, 'req' => array('Пользователь' => 506, 'Имя' => 507)),
    'Курс автора' => array('id' => 1409, 'req' => array('Владелец' => 1413, 'Код' => 1431)),
)), JSON_UNESCAPED_UNICODE));

# cookie idb_courses=<ключ> → кто я
$USERS = array(
    'CUR' => array('id' => '10', 'user' => 'curator1', 'role' => 'Куратор'),
    'AUT' => array('id' => '20', 'user' => 'author1', 'role' => 'Автор'),
    'STU' => array('id' => '30', 'user' => 'my30', 'role' => 'Ученик'),
    'OUT' => array('id' => '40', 'user' => 'my40', 'role' => 'Ученик'),
    'G' => array('id' => '0', 'user' => 'guest', 'role' => 'guest'),
);
$ROWS = array(
    535 => array(array('i' => 1, 'r' => array('30:adept', '30:my30', 'adept', 'k')), array('i' => 2, 'r' => array('30:a77', '30:my30', 'a77', 'k'))),
    471 => array(array('i' => 3, 'r' => array('Профиль', '30:my30', 'Мария Ученица'))),
    1409 => array(array('i' => 4, 'r' => array('Курс автора', '20:author1', 'a77'))),
);
function fake_http($method, $url, $headers, $body){
    global $USERS, $ROWS;
    $path = parse_url($url, PHP_URL_PATH);
    if($path === '/courses/xsrf'){
        foreach($headers as $h) if(preg_match('/idb_courses=(\w+)/', $h, $m)) {
            if($m[1] === 'ADMIN') return array(200, json_encode(array('_xsrf' => 'X', 'user' => 'admin', 'role' => 'admin', 'id' => 0)));
            if(isset($USERS[$m[1]])) return array(200, json_encode(array('_xsrf' => 'U') + $USERS[$m[1]]));
        }
        return array(200, json_encode(array('_xsrf' => '', 'user' => 'guest', 'role' => 'guest', 'id' => 0)));
    }
    if(preg_match('~^/courses/object/(\d+)/$~', $path, $m) && isset($ROWS[(int)$m[1]])) return array(200, json_encode($ROWS[(int)$m[1]]));
    return array(404, 'not found: ' . $url);
}

$SECRET = 'test-secret-0123456789';
$NOW = 1795000000;
$cfg = array('site' => 'https://ideav.ru', 'admin_token' => 'ADMIN', 'store_dir' => "$root/store", 'schema_file' => "$root/schema.json",
    'http' => 'fake_http', 'now' => $NOW, 'meet' => array('domain' => 'meet.ideav.ru', 'app_id' => 'ideav-courses', 'secret' => $SECRET, 'ttl' => 120));
function call($who, $in){ global $cfg; return Cm_handle($cfg, $who === '' ? '' : 'idb_courses=' . $who, $in); }
function jwt_payload($jwt, $secret){
    $p = explode('.', (string)$jwt);
    if(count($p) !== 3) return null;
    $sig = rtrim(strtr(base64_encode(hash_hmac('sha256', $p[0] . '.' . $p[1], $secret, true)), '+/', '-_'), '=');
    if(!hash_equals($sig, $p[2])) return null;
    $h = json_decode(base64_decode(strtr($p[0], '-_', '+/')), true);
    if(($h['alg'] ?? '') !== 'HS256') return null;
    return json_decode(base64_decode(strtr($p[1], '-_', '+/')), true);
}

# 1) выключено, гость, без доступа
$off = $cfg; unset($off['meet']);
list($c, ) = Cm_handle($off, 'idb_courses=CUR', array('action' => 'list', 'course' => 'adept'));
expect($c === 503, 'без раздела meet в конфиге — 503');
foreach(array('list', 'create', 'token') as $a){
    list($c, ) = call('G', array('action' => $a, 'course' => 'adept', 'id' => str_repeat('a', 16)));
    expect($c === 401, "гость портала: $a → 401");
    list($c, ) = call('', array('action' => $a, 'course' => 'adept'));
    expect($c === 401, "без cookie: $a → 401");
}
list($c, ) = call('OUT', array('action' => 'list', 'course' => 'adept'));
expect($c === 403, 'вошедший без «Доступа» к курсу встреч не видит');

# 2) кто заводит встречу
list($c, $r) = call('STU', array('action' => 'create', 'course' => 'adept', 'title' => 'Разбор'));
expect($c === 403, 'ученик встречу не заводит');
list($c, $r) = call('AUT', array('action' => 'create', 'course' => 'adept', 'title' => 'Чужой курс'));
expect($c === 403, 'автор чужого курса встречу не заводит');
list($c, $r) = call('CUR', array('action' => 'create', 'course' => 'adept', 'title' => 'Разбор ДЗ <b>'));
$M = $r['meeting'] ?? array();
expect($c === 200 && preg_match('/^[A-Z2-9]{4}-[A-Z2-9]{4}$/', $M['code'] ?? '') && ($M['title'] ?? '') === 'Разбор ДЗ  b', 'куратор заводит встречу, получает код гостя; разметка из названия вычищена');
list($c, $r) = call('AUT', array('action' => 'create', 'course' => 'a77', 'title' => 'Авторская'));
$A = $r['meeting'] ?? array();
expect($c === 200 && ($A['id'] ?? '') !== '', 'владелец «Курса автора» заводит встречу своего курса');
list($c, $r) = call('STU', array('action' => 'list', 'course' => 'adept'));
$seen = $r['meetings'][0] ?? array();
expect($c === 200 && $r['host'] === false && count($r['meetings']) === 1 && ($seen['id'] ?? '') === $M['id'], 'ученик с «Доступом» видит встречу курса');
expect(!isset($seen['code']) && !isset($seen['bans']) && !isset($seen['seen']), 'ученику код гостя, блок-лист и список вошедших не уходят');
list($c, $r) = call('CUR', array('action' => 'list', 'course' => 'adept'));
expect($c === 200 && $r['host'] === true && ($r['meetings'][0]['code'] ?? '') === $M['code'], 'ведущий видит код в списке');

# 3) ключ
list($c, $r) = call('STU', array('action' => 'token', 'id' => $M['id']));
$p = jwt_payload($r['jwt'] ?? '', $SECRET);
expect($c === 200 && is_array($p), 'ученик получает ключ, подпись сходится с секретом');
expect(($p['aud'] ?? '') === 'jitsi' && ($p['iss'] ?? '') === 'ideav-courses' && ($p['sub'] ?? '') === 'meet.ideav.ru' && ($p['room'] ?? '') === $r['room'] && strpos($r['room'], $M['id']) !== false, 'в ключе aud/iss/sub и комната именно этой встречи');
expect(($p['exp'] ?? 0) === $NOW + 120 && ($p['nbf'] ?? 0) <= $NOW, 'ключ живёт ttl = 120 с');
expect(($p['context']['user']['moderator'] ?? '') === 'false' && ($p['moderator'] ?? null) === false && $r['moderator'] === false, 'ученик — не модератор');
expect(($p['context']['user']['id'] ?? '') === '30' && ($p['context']['user']['name'] ?? '') === 'Мария Ученица', 'имя в ключе — из «Профиля»');
expect(jwt_payload($r['jwt'], 'other-secret') === null, 'чужим секретом ключ не проверяется');
list($c, $r) = call('CUR', array('action' => 'token', 'id' => $M['id']));
$p = jwt_payload($r['jwt'] ?? '', $SECRET);
expect($c === 200 && ($p['context']['user']['moderator'] ?? '') === 'true' && $r['moderator'] === true, 'ведущий — модератор комнаты');
list($c, ) = call('OUT', array('action' => 'token', 'id' => $M['id']));
expect($c === 403, 'без «Доступа» ключа нет');
list($c, ) = call('STU', array('action' => 'token', 'id' => $A['id']));
expect($c === 200, 'ученик авторского курса получает ключ встречи автора');
foreach(array('../x', str_repeat('z', 16), '', 'ABCDEF0123456789') as $bad){
    list($c, ) = call('STU', array('action' => 'token', 'id' => $bad));
    expect($c === 404, "id встречи «{$bad}» отклонён");
}

# 4) блок-лист
list($c, ) = call('STU', array('action' => 'ban', 'id' => $M['id'], 'who' => '40'));
expect($c === 403, 'ученик никого не блокирует');
list($c, $r) = call('CUR', array('action' => 'ban', 'id' => $M['id'], 'who' => '30'));
expect($c === 200 && in_array('30', $r['meeting']['bans'], true) && isset($r['meeting']['seen']->{'30'}), 'ведущий блокирует вошедшего ученика');
list($c, $r) = call('STU', array('action' => 'token', 'id' => $M['id']));
expect($c === 403 && ($r['error'] ?? '') === 'banned' && !isset($r['jwt']), 'заблокированный ключа не получает');
list($c, $r) = call('STU', array('action' => 'list', 'course' => 'adept'));
expect($c === 200, 'заблокированный по-прежнему видит список (блок — только на встречу)');
list($c, ) = call('CUR', array('action' => 'unban', 'id' => $M['id'], 'who' => '30'));
list($c2, ) = call('STU', array('action' => 'token', 'id' => $M['id']));
expect($c === 200 && $c2 === 200, 'после разблокировки ключ снова выдаётся');
list($c, ) = call('CUR', array('action' => 'ban', 'id' => $M['id'], 'who' => '../1'));
expect($c === 400, 'кого блокировать — только id ученика или гостя');
list($c, ) = call('CUR', array('action' => 'ban', 'id' => $M['id'], 'who' => '10'));
list($c2, $r) = call('CUR', array('action' => 'list', 'course' => 'adept'));
expect($c === 400 && !isset($r['meetings'][0]['seen']->{'10'}) && isset($r['meetings'][0]['seen']->{'30'}), 'ведущий себя не блокирует и в списке вошедших себя не видит');

# 5) гости, новый код, закрытие
$code = $M['code'];
list($c, ) = call('', array('action' => 'guest', 'code' => 'ZZZZ-ZZZZ', 'name' => 'Гость'));
expect($c === 404, 'неверный код — 404');
list($c, ) = call('', array('action' => 'guest', 'code' => $code, 'name' => '  '));
expect($c === 400, 'гость без имени — 400');
list($c, $r) = call('', array('action' => 'guest', 'code' => strtolower(str_replace('-', ' ', $code)), 'name' => 'Пётр'));
$p = jwt_payload($r['jwt'] ?? '', $SECRET);
$gid = $p['context']['user']['id'] ?? '';
expect($c === 200 && preg_match('/^g-[a-f0-9]{12}$/', $gid) && ($p['context']['user']['moderator'] ?? '') === 'false' && ($p['context']['user']['name'] ?? '') === 'Пётр (гость)', 'гость по коду (регистр и разделитель не важны) — ключ без модератора, пометка «гость»');
list($c, $r) = call('CUR', array('action' => 'ban', 'id' => $M['id'], 'who' => $gid));
$code2 = $r['meeting']['code'] ?? '';
expect($c === 200 && $code2 !== '' && $code2 !== $code, 'блок гостя меняет код встречи');
list($c, ) = call('', array('action' => 'guest', 'code' => $code, 'name' => 'Пётр'));
expect($c === 404, 'по старому коду заблокированный гость не входит');
list($c, $r) = call('CUR', array('action' => 'code', 'id' => $M['id']));
$code3 = $r['meeting']['code'] ?? '';
list($c2, ) = call('', array('action' => 'guest', 'code' => $code2, 'name' => 'Анна'));
list($c3, ) = call('', array('action' => 'guest', 'code' => $code3, 'name' => 'Анна'));
expect($c === 200 && $c2 === 404 && $c3 === 200, '«новый код»: старый не пускает, новый пускает');
list($c, ) = call('', array('action' => 'guest', 'code' => $A['code'], 'name' => 'Анна'));
expect($c === 200, 'код одной встречи не трогает другую');
list($c, ) = call('CUR', array('action' => 'close', 'id' => $M['id']));
list($c2, ) = call('STU', array('action' => 'token', 'id' => $M['id']));
list($c3, ) = call('', array('action' => 'guest', 'code' => $code3, 'name' => 'Анна'));
list($c4, ) = call('CUR', array('action' => 'token', 'id' => $M['id']));
expect($c === 200 && $c2 === 410 && $c3 === 410 && $c4 === 410, 'закрытая встреча ключей не выдаёт никому');
list($c, $r) = call('STU', array('action' => 'list', 'course' => 'adept'));
expect($c === 200 && count($r['meetings']) === 0, 'закрытая встреча из списка ученика пропала');
list($c, ) = call('CUR', array('action' => 'drop', 'id' => $A['id']));
expect($c === 400, 'неизвестное действие — 400');

# 6) замечания ревью PR #5719: логин не уходит в комнату, гостей не больше 50, вход гостей с адреса ограничен
list($c, $r) = call('CUR', array('action' => 'token', 'id' => $A['id']));
$p = jwt_payload($r['jwt'] ?? '', $SECRET);
expect($c === 200 && ($p['context']['user']['name'] ?? '') === 'Ведущий' && strpos(base64_decode(strtr(explode('.', $r['jwt'])[1], '-_', '+/')), 'curator1') === false, 'без «Имени» в «Профиле» в ключе не логин: у ведущего «Ведущий»');
list($c, $r) = call('STU', array('action' => 'token', 'id' => $A['id']));
expect($c === 200, 'ключ ученику после блока на другой встрече');
for ($i = 0; $i < 60; $i++) Cm_handle($cfg, '', array('action' => 'guest', 'code' => $A['code'], 'name' => 'Г' . $i), '10.0.0.' . $i);
list($c, $r) = call('AUT', array('action' => 'list', 'course' => 'a77'));
$gs = array_filter((array)$r['meetings'][0]['seen'], function ($s) { return !empty($s['guest']); });
expect(count($gs) === 50 && isset(array_values($gs)[49]['name']) && array_values($gs)[49]['name'] === 'Г59 (гость)', 'в «Входили» не больше 50 последних гостей');
$codes = array();
for ($i = 0; $i < 31; $i++) { list($c, ) = Cm_handle($cfg, '', array('action' => 'guest', 'code' => 'ZZZZ-ZZZ' . ($i % 10), 'name' => 'x'), '192.0.2.7'); $codes[] = $c; }
list($cOther, ) = Cm_handle($cfg, '', array('action' => 'guest', 'code' => $A['code'], 'name' => 'Анна'), '192.0.2.8');
expect(count(array_filter($codes, function ($x) { return $x === 404; })) === 30 && end($codes) === 429 && $cOther === 200, 'гость: 30 попыток за 10 минут с адреса, дальше 429; другой адрес пускает');
$cfg2 = $cfg; $cfg2['now'] = $NOW + 601;
list($c, ) = Cm_handle($cfg2, '', array('action' => 'guest', 'code' => $A['code'], 'name' => 'Анна'), '192.0.2.7');
expect($c === 200, 'через 10 минут адрес снова пускают');

rrmdir($root);
echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
