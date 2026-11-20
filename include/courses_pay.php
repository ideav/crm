<?php
# Оплата курсов портала ideav.ru/courses через интернет-эквайринг Точки (ideav/courses#92).
#
# Ссылка: courses-pay.php?course=<код> → Cp_start_payment(): ученик определяется ядром по его
# cookie (/courses/xsrf), цена берётся из каталога courses.json, Точка создаёт платёж
# (payments_with_receipt), заказ сохраняется файлом <store_dir>/<operationId>.json, ученик уходит
# на страницу оплаты. После оплаты Точка возвращает его в /courses/?paid=<код>.
#
# Вебхук: у мерчанта один адрес — twh.php (он же обслуживает пополнение счёта в my). twh.php после
# проверки подписи зовёт Cp_webhook(): платёж с нашим operationId записывается в базу courses —
# «Оплата» (с неё считаются партнёрские начисления) и «Доступ» (основание «оплата», ключ курса).
# Чужой operationId → null, и twh.php продолжает путь my.
#
# В purpose и названии позиции нет цифр: twh.php берёт число из purpose как id пользователя my
# и пополнил бы его счёт, если курсовой платёж попадёт в старую ветку.
#
# Секреты (токен Точки, админ-токен courses) — в конфиге вне webroot, путь — COURSES_PAY_CONFIG.

if (!defined('COURSES_PAY_CONFIG')) define('COURSES_PAY_CONFIG', '/var/www/www-root/data/courses-pay.json');

function Cp_load_config($path = COURSES_PAY_CONFIG){
    $cfg = is_readable($path) ? json_decode(file_get_contents($path), true) : null;
    if (!is_array($cfg)) throw new Exception('courses-pay: нет конфига ' . $path);
    $cfg += array('site' => 'https://ideav.ru', 'tax_system' => 'usn_income', 'ttl' => 1440);
    return $cfg;
}

function Cp_log($cfg, $event, $data = array()){
    if (empty($cfg['log'])) return;
    @file_put_contents($cfg['log'], json_encode(array('t' => date('Y-m-d H:i:s'), 'event' => $event) + $data, JSON_UNESCAPED_UNICODE) . PHP_EOL, FILE_APPEND | LOCK_EX);
}

# HTTP: [код, тело]. В тестах подменяется через $cfg['http'].
function Cp_http($cfg, $method, $url, $headers = array(), $body = null){
    if (!empty($cfg['http'])) return call_user_func($cfg['http'], $method, $url, $headers, $body);
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    # Сертификат enter.tochka.com выпущен Russian Trusted Root CA (Минцифры) — корня нет
    # в системном хранилище, поэтому для Точки — свой файл корня.
    if (!empty($cfg['ca_file']) && parse_url($url, PHP_URL_HOST) === 'enter.tochka.com') curl_setopt($ch, CURLOPT_CAINFO, $cfg['ca_file']);
    $res = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return array($code, $res === false ? 'curl: ' . $err : $res);
}

function Cp_json($cfg, $method, $url, $headers = array(), $body = null){
    list($code, $res) = Cp_http($cfg, $method, $url, $headers, $body);
    $d = json_decode($res, true);
    $err = is_array($d) ? (isset($d[0]['error']) ? $d[0]['error'] : (isset($d['error']) && is_string($d['error']) ? $d['error'] : null)) : null;
    if ($code < 200 || $code >= 300 || !is_array($d) || $err) throw new Exception("HTTP $code $url: " . ($err ?: substr((string)$res, 0, 300)));
    return $d;
}

function Cp_authored($code){ return is_string($code) && (bool)preg_match('/^a\d{1,30}$/', $code); }

# Платный курс с ценой или null. Встроенный — из courses.json; авторский (a<N>) — из строки
# Каталога базы courses (ideav/crm#5588). Цена — только отсюда, не из запроса.
function Cp_course($cfg, $code){
    if (!is_string($code) || !preg_match('/^[a-z0-9_-]{1,32}$/', $code)) return null;
    if (Cp_authored($code)) {
        try { return Cp_authored_course($cfg, Cp_schema($cfg), $code); }
        catch (Exception $e) { Cp_log($cfg, 'catalog_failed', array('course' => $code, 'error' => $e->getMessage())); return null; }
    }
    $cat = json_decode(@file_get_contents($cfg['content_dir'] . '/courses.json'), true);
    foreach ((isset($cat['courses']) ? $cat['courses'] : array()) as $c)
        if (isset($c['code']) && $c['code'] === $code)
            return (empty($c['free']) && !empty($c['price']) && $c['price'] > 0) ? $c : null;
    return null;
}

# Ключ платного курса — из имени каталога контента <код>-<ключ>
function Cp_content_key($cfg, $code){
    foreach (glob($cfg['content_dir'] . '/' . $code . '-*', GLOB_ONLYDIR) ?: array() as $d)
        if (preg_match('/^' . preg_quote($code, '/') . '-([0-9a-f]{16,64})$/', basename($d), $m)) return $m[1];
    return null;
}

# Авторский курс из Каталога: цена «16 900» / «16900.00» → число (как authors.js на портале)
function Cp_authored_course($cfg, $tables, $code){
    if (!isset($tables['Каталог']['req']['Цена'])) return null;
    foreach (Cp_rows($cfg, $tables['Каталог'], array('_main' => $code)) as $r) {
        if ($r['_main'] !== $code) continue;
        $price = (float)preg_replace('/[^0-9.]/', '', str_replace(',', '.', $r['Цена']));
        $title = isset($r['Название']) && $r['Название'] !== '' ? $r['Название'] : $code;
        return $price > 0 ? array('code' => $code, 'title' => $title, 'price' => $price, 'authored' => true) : null;
    }
    return null;
}

# Ключ «Доступа». Встроенный курс — из имени каталога контента; авторский — адрес манифеста:
# его читает Cc_manifest_url (include/courses_content.php) в том же порядке — «Курс автора»,
# затем Каталог. Нет манифеста — null: курс не продаём и не открываем.
function Cp_course_key($cfg, $tables, $code){
    if (!Cp_authored($code)) return Cp_content_key($cfg, $code);
    foreach (array('Курс автора' => 'Код', 'Каталог' => '_main') as $t => $f) {
        if (!isset($tables[$t]['req']['Манифест']) || ($f !== '_main' && !isset($tables[$t]['req'][$f]))) continue;
        foreach (Cp_rows($cfg, $tables[$t], array($f => $code)) as $r)
            if ($r[$f] === $code && $r['Манифест'] !== '') return $r['Манифест'];
    }
    return null;
}

# Цифры в римские: twh.php берёт число из purpose как id пользователя my («Ступень 1» → «Ступень I»)
function Cp_no_digits($s){
    return preg_replace_callback('/\d+/', function ($m) {
        $n = (int)$m[0]; if ($n < 1 || $n > 3999) return '';
        $out = '';
        foreach (array(1000 => 'M', 900 => 'CM', 500 => 'D', 400 => 'CD', 100 => 'C', 90 => 'XC', 50 => 'L', 40 => 'XL', 10 => 'X', 9 => 'IX', 5 => 'V', 4 => 'IV', 1 => 'I') as $v => $r)
            while ($n >= $v) { $out .= $r; $n -= $v; }
        return $out;
    }, (string)$s);
}

function Cp_schema($cfg){
    $s = json_decode(@file_get_contents($cfg['schema_file']), true);
    if (!isset($s['tables']['Доступ']['id'], $s['tables']['Оплата']['id'])) throw new Exception('courses-pay: нет schema.json');
    return $s['tables'];
}

# ---- API базы courses ----
function Cp_url($cfg, $path){ return rtrim($cfg['site'], '/') . '/courses/' . $path; }

function Cp_admin_get($cfg, $path){
    return Cp_json($cfg, 'GET', Cp_url($cfg, $path), array('Cookie: idb_courses=' . $cfg['admin_token']));
}

function Cp_admin_create($cfg, &$xsrf, $table, $main, $fields){
    if ($xsrf === null) { $x = Cp_admin_get($cfg, 'xsrf?JSON'); $xsrf = isset($x['_xsrf']) ? $x['_xsrf'] : ''; }
    $p = array('_xsrf' => $xsrf, 't' . $table['id'] => $main);
    foreach ($fields as $k => $v) {
        if (!isset($table['req'][$k])) throw new Exception('courses-pay: нет реквизита «' . $k . '»');
        $p['t' . $table['req'][$k]] = (string)$v;
    }
    $d = Cp_json($cfg, 'POST', Cp_url($cfg, '_m_new/' . $table['id'] . '?JSON&up=1'),
        array('Cookie: idb_courses=' . $cfg['admin_token'], 'Content-Type: application/x-www-form-urlencoded'), http_build_query($p));
    return isset($d['id']) ? $d['id'] : (isset($d['obj']) ? $d['obj'] : null);
}

# Строки таблицы как массивы значений по порядку реквизитов (первое — значение записи).
# $filter: имя реквизита (или '_main' — значение записи) => текст. Ссылку сервер отбирает по тексту
# (логину, названию), не по id — id сверяет вызывающий.
function Cp_rows($cfg, $table, $filter = array()){
    $q = '';
    foreach ($filter as $k => $v) $q .= '&F_' . ($k === '_main' ? $table['id'] : $table['req'][$k]) . '=' . rawurlencode($v);
    $rows = Cp_admin_get($cfg, 'object/' . $table['id'] . '/?JSON_OBJ&LIMIT=0,100000' . $q);
    $names = array_merge(array('_main'), array_keys($table['req']));
    $out = array();
    foreach ($rows as $r) {
        if (!isset($r['r']) || !is_array($r['r'])) continue;
        $row = array('_id' => isset($r['i']) ? $r['i'] : null);
        foreach ($names as $i => $n) $row[$n] = isset($r['r'][$i]) ? (string)$r['r'][$i] : '';
        $out[] = $row;
    }
    return $out;
}

function Cp_ref_id($v){ return preg_match('/^(\d+)(:|$)/', (string)$v, $m) ? $m[1] : ''; }

function Cp_has_access($cfg, $tables, $uid, $code){
    foreach (Cp_rows($cfg, $tables['Доступ']) as $r)
        if (Cp_ref_id($r['Пользователь']) === (string)$uid && $r['Курс'] === $code && $r['Ключ'] !== '') return true;
    return false;
}

function Cp_user_email($cfg, $uid){
    $rows = Cp_admin_get($cfg, 'object/18/?JSON_OBJ&F_I=' . (int)$uid);
    foreach ((isset($rows[0]['r']) ? $rows[0]['r'] : array()) as $v)
        if (is_string($v) && filter_var($v, FILTER_VALIDATE_EMAIL)) return $v;
    return null;
}

# ---- заказы ----
function Cp_order_path($cfg, $op){
    if (!is_string($op) || !preg_match('/^[A-Za-z0-9-]{1,80}$/', $op)) return null;
    return rtrim($cfg['store_dir'], '/') . '/' . $op . '.json';
}
function Cp_order_save($cfg, $op, $o){
    if (!is_dir($cfg['store_dir'])) mkdir($cfg['store_dir'], 0700, true);
    file_put_contents(Cp_order_path($cfg, $op), json_encode($o, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

# ---- ссылка на оплату ----
# Возвращает ['redirect' => url] или ['error' => код, 'redirect' => url]
function Cp_start_payment($cfg, $cookie, $code){
    $site = rtrim($cfg['site'], '/');
    $back = $site . '/courses/#/map';
    $course = Cp_course($cfg, $code);
    if (!$course) return array('error' => 'course', 'redirect' => $back);
    try {
        $me = Cp_json($cfg, 'GET', Cp_url($cfg, 'xsrf?JSON'), array('Cookie: ' . $cookie));
    } catch (Exception $e) {
        Cp_log($cfg, 'whoami_failed', array('error' => $e->getMessage()));
        return array('error' => 'login', 'redirect' => $back);
    }
    $uid = isset($me['id']) ? (string)$me['id'] : '';
    if (!preg_match('/^\d+$/', $uid) || $uid === '0' || (isset($me['role']) && $me['role'] === 'guest'))
        return array('error' => 'login', 'redirect' => $back);
    try {
        $tables = Cp_schema($cfg);
        if (Cp_has_access($cfg, $tables, $uid, $code)) return array('redirect' => $back);
        if (!empty($course['authored']) && !Cp_course_key($cfg, $tables, $code)) {
            Cp_log($cfg, 'no_manifest', array('user' => $uid, 'course' => $code));
            return array('error' => 'course', 'redirect' => $back);
        }
        $email = Cp_user_email($cfg, $uid);
        $amount = number_format((float)$course['price'], 2, '.', '');
        $title = 'Доступ к курсу «' . Cp_no_digits($course['title']) . '» — ideav.ru/courses';
        $data = array(
            'customerCode' => $cfg['customer_code'],
            'merchantId' => $cfg['merchant_id'],
            'amount' => $amount,
            'purpose' => $title,
            'redirectUrl' => $site . '/courses/?paid=' . $code . '#/map',
            'failRedirectUrl' => $site . '/courses/?payfail=' . $code . '#/map',
            'paymentMode' => array('sbp', 'card', 'tinkoff'),
            'ttl' => (int)($cfg['ttl'] ?? 1440),
            'taxSystemCode' => $cfg['tax_system'] ?? 'usn_income',
            'Client' => $email ? array('email' => $email) : array('email' => $cfg['receipt_email'] ?? 'school@ideav.ru'),
            'Items' => array(array(
                'vatType' => 'none', 'name' => $title, 'amount' => $amount, 'quantity' => 1,
                'paymentMethod' => 'full_payment', 'paymentObject' => 'service', 'measure' => 'шт.',
                'Supplier' => $cfg['supplier'],
            )),
            'Supplier' => $cfg['supplier'],
        );
        $d = Cp_json($cfg, 'POST', 'https://enter.tochka.com/uapi/acquiring/v1.0/payments_with_receipt',
            array('Content-Type: application/json', 'Accept: application/json', 'Authorization: Bearer ' . $cfg['tochka_token']),
            json_encode(array('Data' => $data), JSON_UNESCAPED_UNICODE));
        $op = isset($d['Data']['operationId']) ? $d['Data']['operationId'] : null;
        $link = isset($d['Data']['paymentLink']) ? $d['Data']['paymentLink'] : null;
        if (!Cp_order_path($cfg, $op) || !$link || !preg_match('~^https://[^\s"<>]+$~', $link))
            throw new Exception('Точка не вернула operationId/paymentLink');
        Cp_order_save($cfg, $op, array('user' => $uid, 'login' => isset($me['user']) ? $me['user'] : '', 'course' => $code,
            'amount' => (float)$course['price'], 'created' => date('Y-m-d H:i:s')));
        Cp_log($cfg, 'link', array('op' => $op, 'user' => $uid, 'course' => $code, 'amount' => $amount));
        return array('redirect' => $link);
    } catch (Exception $e) {
        Cp_log($cfg, 'link_failed', array('user' => $uid, 'course' => $code, 'error' => $e->getMessage()));
        return array('error' => 'pay', 'redirect' => $site . '/courses/?payfail=' . $code . '#/map');
    }
}

# ---- вебхук ----
# null — платёж не наш; true — обработан (ответить Точке 200); false — сбой записи (ответить 500).
function Cp_webhook($cfg, $payload){
    $op = isset($payload['operationId']) ? $payload['operationId'] : null;
    $path = Cp_order_path($cfg, $op);
    if (!$path || !is_file($path)) return null;
    # доступ открывает только подтверждённая оплата; прочие статусы (создан, истёк, отказ) — не действие
    if (isset($payload['status']) && strtoupper((string)$payload['status']) !== 'APPROVED') {
        Cp_log($cfg, 'ignored_status', array('op' => $op, 'status' => (string)$payload['status']));
        return true;
    }
    $fh = fopen($path, 'c+');
    flock($fh, LOCK_EX); # Точка может прислать повтор параллельно
    try {
        $o = json_decode(stream_get_contents($fh), true);
        if (!empty($o['done'])) return true;
        $tables = Cp_schema($cfg);
        $amount = (float)(isset($payload['amount']) ? $payload['amount'] : 0);
        $uid = (string)$o['user']; $code = $o['course'];
        $xsrf = null;
        $paid = false;
        foreach (Cp_rows($cfg, $tables['Оплата']) as $r) if ($r['Номер'] === $op) $paid = true;
        if (!$paid)
            Cp_admin_create($cfg, $xsrf, $tables['Оплата'], $uid . ':' . $code . ':' . $op, array(
                'Пользователь' => $uid, 'Курс' => $code, 'Сумма' => rtrim(rtrim(number_format($amount, 2, '.', ''), '0'), '.'),
                'Дата' => date('d.m.Y'), 'Номер' => $op));
        $granted = false;
        if ($amount + 0.001 >= (float)$o['amount']) {
            if (!Cp_has_access($cfg, $tables, $uid, $code)) {
                $key = Cp_course_key($cfg, $tables, $code);
                if (!$key) throw new Exception('нет ключа курса ' . $code);
                Cp_admin_create($cfg, $xsrf, $tables['Доступ'], $uid . ':' . $code, array(
                    'Пользователь' => $uid, 'Курс' => $code, 'Ключ' => $key, 'Основание' => 'оплата', 'Дата и время' => date('d.m.Y H:i:s')));
            }
            $granted = true;
        } else {
            Cp_log($cfg, 'underpaid', array('op' => $op, 'user' => $uid, 'course' => $code, 'amount' => $amount, 'price' => $o['amount']));
        }
        $o['done'] = date('Y-m-d H:i:s'); $o['paid'] = $amount; $o['granted'] = $granted;
        ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($o, JSON_UNESCAPED_UNICODE));
        Cp_log($cfg, 'paid', array('op' => $op, 'user' => $uid, 'course' => $code, 'amount' => $amount, 'granted' => $granted));
        return true;
    } catch (Exception $e) {
        Cp_log($cfg, 'webhook_failed', array('op' => $op, 'error' => $e->getMessage()));
        return false;
    } finally {
        flock($fh, LOCK_UN); fclose($fh);
    }
}

# ---- подпись вебхука Точки (ideav/courses#173) ----
# Точка шлёт в теле вебхука JWT-строку (RS256), подписанную своим ключом. Открытый ключ
# (JWK со страницы документации Точки или PEM) кладётся в конфиг: 'webhook_public_key'.
function Cp_b64u($s){ return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true); }

function Cp_der($tag, $body){
    $l = strlen($body);
    $len = $l < 128 ? chr($l) : (($l < 256) ? "\x81" . chr($l) : "\x82" . chr($l >> 8) . chr($l & 255));
    return chr($tag) . $len . $body;
}
function Cp_der_int($bin){ $bin = ltrim($bin, "\x00"); if ($bin === '' || ord($bin[0]) > 127) $bin = "\x00" . $bin; return Cp_der(0x02, $bin); }

# Ключ в виде PEM: из PEM-строки, JWK-массива или JWK-JSON
function Cp_public_pem($key){
    if (is_string($key) && strpos($key, '-----BEGIN') !== false) return $key;
    if (is_string($key)) $key = json_decode($key, true);
    if (!is_array($key) || empty($key['n']) || empty($key['e'])) return null;
    $n = Cp_b64u($key['n']); $e = Cp_b64u($key['e']);
    if ($n === false || $e === false) return null;
    $rsa = Cp_der(0x30, Cp_der_int($n) . Cp_der_int($e));
    $spki = Cp_der(0x30, Cp_der(0x30, "\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00") . Cp_der(0x03, "\x00" . $rsa));
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

# JWT → массив payload или null, если подпись/алгоритм не те
function Cp_verify_jwt($cfg, $jwt){
    $parts = explode('.', trim((string)$jwt));
    if (count($parts) !== 3) return null;
    $h = json_decode((string)Cp_b64u($parts[0]), true);
    if (!is_array($h) || !isset($h['alg']) || $h['alg'] !== 'RS256') return null; # alg=none и HS256 не принимаем
    $pem = Cp_public_pem(isset($cfg['webhook_public_key']) ? $cfg['webhook_public_key'] : null);
    $sig = Cp_b64u($parts[2]);
    if (!$pem || $sig === false || !function_exists('openssl_verify')) return null;
    if (openssl_verify($parts[0] . '.' . $parts[1], $sig, $pem, OPENSSL_ALGO_SHA256) !== 1) return null;
    $p = json_decode((string)Cp_b64u($parts[1]), true);
    return is_array($p) ? $p : null;
}

# Тело вебхука целиком: [HTTP-код, null|true]. 403 — подпись не сошлась; 200+null — платёж не наш
# (вызывающий twh.php продолжает путь my); 200+true — обработан или не требует действий; 500 — повтор.
function Cp_handle_webhook($cfg, $raw){
    $p = Cp_verify_jwt($cfg, $raw);
    if ($p === null) { Cp_log($cfg, 'webhook_bad_signature'); return array(403, null); }
    $r = Cp_webhook($cfg, $p);
    return $r === false ? array(500, null) : array(200, $r);
}
