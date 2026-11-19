<?php
# Защита платного курса портала ideav.ru/courses: урок отдаёт сервер и только тому, у кого есть «Доступ».
# Мерка: include/courses_content.php с подменённым HTTP (кто я по cookie, строки «Доступа», файлы публикации).
#   1) гость → 401, вошедший без «Доступа» → 403, чужой «Доступ» курс не открывает;
#   2) встроенный платный курс: урок читается с диска из каталога <код>-<ключ>, ключ ученику не уходит;
#   3) авторский курс: манифест отдаётся без адресов файлов, урок — по адресу из манифеста;
#   4) адрес файла вне своего сайта не запрашивается; код урока с «..» не выводит из каталога курса.

require __DIR__ . '/../include/courses_content.php';

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

$KEY = '0123456789abcdef0123456789abcdef';
$root = sys_get_temp_dir() . '/ccg-' . getmypid();
rrmdir($root);
mkdir("$root/content/adept-$KEY", 0777, true);
mkdir("$root/content/mini", 0777, true);
file_put_contents("$root/content/courses.json", json_encode(array('courses' => array(
    array('code' => 'mini', 'title' => 'Мини-курс', 'free' => true),
    array('code' => 'adept', 'title' => 'Адепт', 'free' => false, 'price' => 9900),
)), JSON_UNESCAPED_UNICODE));
$LESSON = json_encode(array('id' => 'm1', 'title' => 'Модуль 1', 'html' => '<p>ПЛАТНЫЙ ТЕКСТ</p>'), JSON_UNESCAPED_UNICODE);
file_put_contents("$root/content/adept-$KEY/m1.json", $LESSON);
file_put_contents("$root/content/mini/00-start.json", '{"id":"00-start"}');
file_put_contents("$root/schema.json", json_encode(array('tables' => array(
    'Доступ' => array('id' => 535, 'req' => array('Пользователь' => 536, 'Курс' => 537, 'Ключ' => 538, 'Основание' => 539, 'Дата и время' => 540)),
    'Оплата' => array('id' => 474, 'req' => array('Пользователь' => 526, 'Курс' => 527, 'Сумма' => 529, 'Дата' => 530, 'Возврат' => 532, 'Номер' => 534)),
)), JSON_UNESCAPED_UNICODE));

$MAN = '/download/courses/aaa111/manifest.json';
$files = array(
    'https://ideav.ru' . $MAN => json_encode(array('code' => 'a12', 'title' => 'Курс автора', 'author' => 'Автор', 'forWhom' => 'Бухгалтерам', 'lessons' => array(
        array('id' => 'l7', 'n' => 1, 'title' => 'Первый', 'task' => 'quiz', 'url' => '/download/courses/bbb222/l7.json'),
        array('id' => 'l8', 'n' => 2, 'title' => 'Второй', 'task' => null, 'url' => 'https://evil.example/l8.json'),
    )), JSON_UNESCAPED_UNICODE),
    'https://ideav.ru/download/courses/bbb222/l7.json' => '{"id":"l7","html":"<p>АВТОРСКИЙ ТЕКСТ</p>"}',
);
$net = array('whoami' => array('id' => '1102', 'user' => 'my236968', 'role' => 'Ученик'), 'access' => array(), 'gets' => array());
function fake_http($method, $url, $headers, $body){
    global $net, $files;
    $path = parse_url($url, PHP_URL_PATH);
    if($path === '/courses/xsrf'){
        $isAdmin = false;
        foreach($headers as $h) if(stripos($h, 'Cookie:') === 0 && strpos($h, 'idb_courses=ADMIN') !== false) $isAdmin = true;
        return array(200, json_encode($isAdmin ? array('_xsrf' => 'X', 'user' => 'admin', 'role' => 'admin', 'id' => 0) : array('_xsrf' => 'U') + $net['whoami']));
    }
    if($path === '/courses/object/535/') return array(200, json_encode($net['access']));
    $net['gets'][] = $url;
    if(isset($files[$url])) return array(200, $files[$url]);
    return array(404, 'not found: ' . $url);
}
function access_row($uid, $course, $key){ return array('i' => 9000 + crc32($uid . $course) % 1000, 'r' => array("$uid:$course", "$uid:login", $course, $key, 'оплата', '01.11.2026 10:00:00')); }

$cfg = array('site' => 'https://ideav.ru', 'admin_token' => 'ADMIN', 'store_dir' => "$root/orders", 'content_dir' => "$root/content",
    'schema_file' => "$root/schema.json", 'http' => 'fake_http', 'log' => "$root/pay.log");

# 1) гость и вошедший без доступа
$net['whoami'] = array('id' => '1114', 'user' => 'guest', 'role' => 'guest');
$net['access'] = array(access_row('1114', 'adept', $KEY));
list($c, $b) = Cc_get($cfg, 'idb_courses=G', 'adept', 'm1');
expect($c === 401 && strpos($b, 'ПЛАТНЫЙ') === false, 'гость: 401, текста урока нет');
$net['whoami'] = array('id' => '1102', 'user' => 'my236968', 'role' => 'Ученик');
$net['access'] = array();
list($c, $b) = Cc_get($cfg, 'idb_courses=U', 'adept', 'm1');
expect($c === 403 && strpos($b, 'ПЛАТНЫЙ') === false, 'вошедший без «Доступа»: 403, текста урока нет');
$net['access'] = array(access_row('2000', 'adept', $KEY), access_row('1102', 'a12', $MAN));
list($c, $b) = Cc_get($cfg, 'idb_courses=U', 'adept', 'm1');
expect($c === 403, 'чужой «Доступ» и доступ к другому курсу урок не открывают');

# 2) встроенный платный курс
$net['access'] = array(access_row('1102', 'adept', $KEY));
list($c, $b) = Cc_get($cfg, 'idb_courses=U', 'adept', 'm1');
expect($c === 200 && $b === $LESSON, 'есть «Доступ»: урок отдан целиком');
expect(strpos($b, $KEY) === false, 'ключ курса в ответе не уходит');
list($c, ) = Cc_get($cfg, 'idb_courses=U', 'adept', 'm9');
expect($c === 404, 'урока нет в курсе → 404');
foreach(array('../courses', '..%2Fcourses', '../mini/00-start', 'm1.json', 'm1/../m1', '') as $bad){
    list($c, $b) = Cc_get($cfg, 'idb_courses=U', 'adept', $bad);
    expect($c === 404 && strpos($b, 'courses') === false && strpos($b, '00-start') === false, 'код урока «' . $bad . '» из каталога курса не выводит');
}
foreach(array('../adept', 'adept-' . $KEY, 'ADEPT', '') as $bad){
    list($c, ) = Cc_get($cfg, 'idb_courses=U', $bad, 'm1');
    expect($c === 404, 'код курса «' . $bad . '» отклонён');
}
list($c, ) = Cc_get($cfg, 'idb_courses=U', 'mini', '00-start');
expect($c === 404, 'бесплатный курс через эту дверь не отдаётся (он открыт и так)');
# ключ в «Доступе» не тот, что у каталога на диске (ключ сменили) — доступ остаётся: он у ученика, а не у ключа
$net['access'] = array(access_row('1102', 'adept', 'ffffffffffffffffffffffffffffffff'));
list($c, $b) = Cc_get($cfg, 'idb_courses=U', 'adept', 'm1');
expect($c === 200 && $b === $LESSON, 'после смены ключа курса старый «Доступ» продолжает открывать урок');

# 3) авторский курс
$net['access'] = array(access_row('1102', 'a12', $MAN));
$net['gets'] = array();
list($c, $b) = Cc_get($cfg, 'idb_courses=U', 'a12', '');
$m = json_decode($b, true);
expect($c === 200 && ($m['title'] ?? '') === 'Курс автора' && ($m['forWhom'] ?? '') === 'Бухгалтерам' && count($m['lessons'] ?? array()) === 2 && $m['lessons'][0]['id'] === 'l7', 'манифест авторского курса отдан: название, уроки');
expect(strpos($b, 'bbb222') === false && strpos($b, 'aaa111') === false && !isset($m['lessons'][0]['url']), 'в манифесте для ученика нет адресов файлов');
list($c, $b) = Cc_get($cfg, 'idb_courses=U', 'a12', 'l7');
expect($c === 200 && strpos($b, 'АВТОРСКИЙ ТЕКСТ') !== false, 'урок авторского курса отдан по адресу из манифеста');
list($c, ) = Cc_get($cfg, 'idb_courses=U', 'a12', 'l99');
expect($c === 404, 'урока нет в манифесте → 404');
$net['access'] = array();
list($c, $b) = Cc_get($cfg, 'idb_courses=U', 'a12', 'l7');
expect($c === 403 && strpos($b, 'АВТОРСКИЙ') === false, 'авторский курс без «Доступа»: 403');

# 4) чужой сайт не запрашиваем
$net['access'] = array(access_row('1102', 'a12', $MAN));
$net['gets'] = array();
list($c, ) = Cc_get($cfg, 'idb_courses=U', 'a12', 'l8');
$foreign = array_filter($net['gets'], function($u){ return strpos($u, 'https://ideav.ru/') !== 0; });
expect($c === 404 && !$foreign, 'урок с адресом на чужом сайте не запрашивается');
foreach(array('https://evil.example/manifest.json', 'https://ideav.ru.evil.example/m.json', '//evil.example/m.json', 'file:///etc/passwd', 'http://ideav.ru/m.json') as $bad){
    $net['access'] = array(access_row('1102', 'a12', $bad));
    $net['gets'] = array();
    list($c, ) = Cc_get($cfg, 'idb_courses=U', 'a12', 'l7');
    expect($c === 404 && !$net['gets'], 'манифест «' . $bad . '» не запрашивается');
}

rrmdir($root);
echo $failures ? "\n$failures FAILED\n" : "\nOK\n";
exit($failures ? 1 : 0);
