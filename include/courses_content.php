<?php
# Защита платного курса портала ideav.ru/courses: урок отдаёт сервер и только ученику с «Доступом».
#
# courses-content.php?course=<код>&lesson=<урок> → Cc_get(): ученик определяется ядром по его cookie
# (/courses/xsrf), строка «Доступ» ищется от имени админа базы с отбором по логину ученика. Доступ —
# сама строка; где лежит курс, решает сервер, а не «Ключ» в строке: встроенный курс читается с диска из
# <content_dir>/<код>-<ключ каталога>/<урок>.json, авторский — по манифесту из «Курса автора» (или «Каталога»;
# нет нигде — по адресу из «Ключа» строки). Без lesson у авторского курса отдаётся манифест без адресов
# файлов. Ключ курса и адреса файлов ученику не уходят.
# Бесплатные курсы открыты и так, через эту дверь не идут.
#
# Конфиг и хелперы Cp_* — из courses_pay.php (COURSES_PAY_CONFIG: site, admin_token, content_dir, schema_file).

require_once __DIR__ . '/courses_pay.php';

function Cc_fail($code, $error){ return array($code, json_encode(array('error' => $error), JSON_UNESCAPED_UNICODE)); }

# Строка «Доступ» ученика к курсу или null. Сначала отбор по логину (одна-две строки вместо таблицы);
# не нашлось — вся таблица: текст ссылки может не совпасть с логином из xsrf, а доступ терять нельзя.
function Cc_access_row($cfg, $tables, $uid, $login, $code){
    $filters = $login !== '' ? array(array('Пользователь' => $login), array()) : array(array());
    foreach ($filters as $filter)
        foreach (Cp_rows($cfg, $tables['Доступ'], $filter) as $r)
            if (Cp_ref_id($r['Пользователь']) === (string)$uid && $r['Курс'] === $code) return $r;
    return null;
}

# Адрес манифеста авторского курса. «Курс автора» — источник (у платного курса публикация кладёт манифест
# только туда, в «Каталоге» поле пустое, moder.js), затем «Каталог» (бесплатный курс), затем «Ключ» строки «Доступ».
function Cc_manifest_url($cfg, $tables, $code, $access){
    if (isset($tables['Курс автора']['req']['Код'], $tables['Курс автора']['req']['Манифест']))
        foreach (Cp_rows($cfg, $tables['Курс автора'], array('Код' => $code)) as $r)
            if ($r['Код'] === $code && $r['Манифест'] !== '') return $r['Манифест'];
    if (isset($tables['Каталог']['req']['Манифест']))
        foreach (Cp_rows($cfg, $tables['Каталог'], array('_main' => $code)) as $r)
            if ($r['_main'] === $code && $r['Манифест'] !== '') return $r['Манифест'];
    return $access['Ключ'];
}

# Адрес файла публикации на своём сайте (абсолютный) или null: чужие хосты и схемы не запрашиваем
function Cc_own_url($cfg, $u){
    $site = rtrim($cfg['site'], '/');
    $u = trim((string)$u);
    if (preg_match('~^/(?!/)[^\s\\\\]*$~', $u)) return $site . $u;
    if (strpos($u, $site . '/') === 0 && !preg_match('~[\s\\\\]~', $u)) return $u;
    return null;
}

function Cc_fetch_json($cfg, $url){
    list($code, $res) = Cp_http($cfg, 'GET', $url);
    $d = ($code >= 200 && $code < 300) ? json_decode($res, true) : null;
    return is_array($d) ? array($res, $d) : null;
}

# [HTTP-код, тело JSON]
function Cc_get($cfg, $cookie, $code, $lesson){
    if (!is_string($code) || !preg_match('/^[a-z0-9_-]{1,32}$/', $code)) return Cc_fail(404, 'course');
    if (!is_string($lesson) || !preg_match('/^[A-Za-z0-9_-]{0,64}$/', $lesson)) return Cc_fail(404, 'lesson');
    $authored = (bool)preg_match('/^a\d+$/', $code);
    if (!$authored && (!Cp_course($cfg, $code) || $lesson === '')) return Cc_fail(404, $lesson === '' ? 'lesson' : 'course');
    try {
        $me = Cp_json($cfg, 'GET', Cp_url($cfg, 'xsrf?JSON'), array('Cookie: ' . $cookie));
    } catch (Exception $e) {
        return Cc_fail(401, 'login');
    }
    $uid = isset($me['id']) ? (string)$me['id'] : '';
    $login = isset($me['user']) && is_string($me['user']) ? $me['user'] : '';
    if (!preg_match('/^\d+$/', $uid) || $uid === '0' || (isset($me['role']) && $me['role'] === 'guest')) return Cc_fail(401, 'login');
    try {
        $tables = Cp_schema($cfg);
        $access = Cc_access_row($cfg, $tables, $uid, $login, $code);
        $murl = ($access && $authored) ? Cc_own_url($cfg, Cc_manifest_url($cfg, $tables, $code, $access)) : null;
    } catch (Exception $e) {
        Cp_log($cfg, 'content_failed', array('user' => $uid, 'course' => $code, 'error' => $e->getMessage()));
        return Cc_fail(502, 'base');
    }
    if ($access === null) return Cc_fail(403, 'access');

    if (!$authored) {
        $dir = Cp_content_key($cfg, $code);
        $file = $dir ? $cfg['content_dir'] . '/' . $code . '-' . $dir . '/' . $lesson . '.json' : null;
        if (!$file || !is_file($file)) return Cc_fail(404, 'lesson');
        return array(200, file_get_contents($file));
    }

    $man = $murl ? Cc_fetch_json($cfg, $murl) : null;
    if (!$man) return Cc_fail(404, 'manifest');
    $m = $man[1];
    $lessons = (isset($m['lessons']) && is_array($m['lessons'])) ? $m['lessons'] : array();
    if ($lesson === '') {
        foreach ($lessons as $i => $l) if (is_array($l)) unset($lessons[$i]['url']);
        $m['lessons'] = array_values($lessons);
        return array(200, json_encode($m, JSON_UNESCAPED_UNICODE));
    }
    foreach ($lessons as $l) {
        if (!is_array($l) || !isset($l['id']) || (string)$l['id'] !== $lesson) continue;
        $lurl = Cc_own_url($cfg, isset($l['url']) ? $l['url'] : '');
        $got = $lurl ? Cc_fetch_json($cfg, $lurl) : null;
        return $got ? array(200, $got[0]) : Cc_fail(404, 'lesson');
    }
    return Cc_fail(404, 'lesson');
}
