<?php
# Промокоды портала ideav.ru/courses (ideav/courses#172): код открывает курс сразу, без модерации.
#
# Список кодов — таблица «Промокод» базы courses (код = значение записи; Курс, Лимит, Использовано, Срок,
# необязательный Ключ). Ученик кода не видит: у роли «Ученик» нет гранта на эту таблицу, проверку и
# списание делает сервер админ-токеном — в браузере открыть курс нельзя. Проверка лимита, увеличение
# счётчика и выдача «Доступа» идут под одной блокировкой flock (защита от гонки двух активаций
# последнего места). Успех → «Доступ» (основание «промокод») и «Заявка» со статусом done (журнал).
#
# Хелперы Cp_* — из courses_pay.php (тот же конфиг COURSES_PAY_CONFIG, schema_file, content_dir, store_dir).
# Ответ: [http, массив]; ok=true, status=granted|already; ошибки — error=login|bad_code|invalid|wrong_course|
# expired|exhausted|course|too_many|server.

require_once __DIR__ . '/courses_pay.php';

const CPR_MAX_FAILS = 10;   # неверных кодов на ученика
const CPR_FAIL_WINDOW = 600; # за сколько секунд

# «ДД.ММ.ГГГГ», «ГГГГММДД», «ГГГГ-ММ-ДД» или unix-секунды → unix конца этого дня; пусто → null
function Cpr_date_end($v){
    $v = trim((string)$v);
    if ($v === '') return null;
    if (preg_match('/^(\d{1,2})\.(\d{1,2})\.(\d{4})/', $v, $m)) return mktime(23, 59, 59, (int)$m[2], (int)$m[1], (int)$m[3]);
    if (preg_match('/^(\d{4})-?(\d{2})-?(\d{2})$/', $v, $m)) return mktime(23, 59, 59, (int)$m[2], (int)$m[3], (int)$m[1]);
    if (preg_match('/^\d{9,11}$/', $v)) return (int)$v + 86400 - 1;
    return null;
}

function Cpr_norm($code){ return mb_strtolower(trim((string)$code), 'UTF-8'); }

# Правка реквизитов существующей записи (_m_set)
function Cpr_admin_set($cfg, &$xsrf, $table, $id, $fields){
    if ($xsrf === null) { $x = Cp_admin_get($cfg, 'xsrf?JSON'); $xsrf = isset($x['_xsrf']) ? $x['_xsrf'] : ''; }
    $p = array('_xsrf' => $xsrf);
    foreach ($fields as $k => $v) {
        if (!isset($table['req'][$k])) throw new Exception('courses-promo: нет реквизита «' . $k . '»');
        $p['t' . $table['req'][$k]] = (string)$v;
    }
    Cp_json($cfg, 'POST', Cp_url($cfg, '_m_set/' . (int)$id . '?JSON'),
        array('Cookie: idb_courses=' . $cfg['admin_token'], 'Content-Type: application/x-www-form-urlencoded'), http_build_query($p));
}

# Ученик по его cookie: id или null (гость)
function Cpr_whoami($cfg, $cookie){
    $me = Cp_json($cfg, 'GET', Cp_url($cfg, 'xsrf?JSON'), array('Cookie: ' . $cookie));
    $uid = isset($me['id']) ? (string)$me['id'] : '';
    if (!preg_match('/^\d+$/', $uid) || $uid === '0' || (isset($me['role']) && $me['role'] === 'guest')) return null;
    return $uid;
}

# Счётчик неверных кодов ученика (в файле store_dir; вызывать под блокировкой)
function Cpr_fail_path($cfg, $uid){ return rtrim($cfg['store_dir'], '/') . '/promo-fail-' . (int)$uid . '.json'; }
function Cpr_fails($cfg, $uid){
    $a = json_decode(@file_get_contents(Cpr_fail_path($cfg, $uid)), true);
    $now = time();
    return is_array($a) ? array_values(array_filter($a, function ($t) use ($now) { return $now - (int)$t < CPR_FAIL_WINDOW; })) : array();
}
function Cpr_fail_add($cfg, $uid){
    $a = Cpr_fails($cfg, $uid); $a[] = time();
    file_put_contents(Cpr_fail_path($cfg, $uid), json_encode($a), LOCK_EX);
}

# Найти код в таблице «Промокод»; null — нет такого
function Cpr_find($cfg, $tables, $code){
    foreach (Cp_rows($cfg, $tables['Промокод']) as $r)
        if (Cpr_norm($r['_main']) === Cpr_norm($code)) return $r;
    return null;
}

# Погасить код: [http, ответ]
function Cpr_redeem($cfg, $cookie, $course, $code){
    $code = trim((string)$code);
    if (!is_string($course) || !preg_match('/^[a-z0-9_-]{1,32}$/', $course)) return array(400, array('ok' => false, 'error' => 'course'));
    if ($code === '' || mb_strlen($code, 'UTF-8') > 64 || preg_match('/[\x00-\x1f<>"]/', $code)) return array(400, array('ok' => false, 'error' => 'bad_code'));
    try {
        $uid = Cpr_whoami($cfg, $cookie);
        if ($uid === null) return array(401, array('ok' => false, 'error' => 'login'));
        $tables = Cp_schema($cfg);
        foreach (array('Промокод', 'Заявка') as $n) if (!isset($tables[$n]['id'])) throw new Exception('нет таблицы ' . $n . ' в schema.json');
        if (!is_dir($cfg['store_dir'])) mkdir($cfg['store_dir'], 0700, true);
        $lock = fopen(rtrim($cfg['store_dir'], '/') . '/promo.lock', 'c');
        flock($lock, LOCK_EX);
        try {
            return Cpr_redeem_locked($cfg, $tables, $uid, $course, $code);
        } finally {
            flock($lock, LOCK_UN); fclose($lock);
        }
    } catch (Exception $e) {
        Cp_log($cfg, 'promo_failed', array('course' => $course, 'error' => $e->getMessage()));
        return array(500, array('ok' => false, 'error' => 'server'));
    }
}

function Cpr_redeem_locked($cfg, $tables, $uid, $course, $code){
    if (Cp_has_access($cfg, $tables, $uid, $course)) return array(200, array('ok' => true, 'status' => 'already', 'course' => $course));
    if (count(Cpr_fails($cfg, $uid)) >= CPR_MAX_FAILS) return array(429, array('ok' => false, 'error' => 'too_many'));
    $p = Cpr_find($cfg, $tables, $code);
    $err = null;
    if (!$p) $err = 'invalid';
    elseif ($p['Курс'] !== '' && $p['Курс'] !== $course) $err = 'wrong_course';
    else {
        $end = Cpr_date_end($p['Срок']);
        if ($end !== null && time() > $end) $err = 'expired';
        elseif ((int)$p['Лимит'] > 0 && (int)$p['Использовано'] >= (int)$p['Лимит']) $err = 'exhausted';
    }
    if ($err) {
        if ($err === 'invalid' || $err === 'wrong_course') Cpr_fail_add($cfg, $uid);
        Cp_log($cfg, 'promo_denied', array('user' => $uid, 'course' => $course, 'error' => $err));
        return array(200, array('ok' => false, 'error' => $err));
    }
    $key = (isset($tables['Промокод']['req']['Ключ']) && !empty($p['Ключ'])) ? $p['Ключ'] : Cp_course_key($cfg, $tables, $course);
    if (!$key) return array(200, array('ok' => false, 'error' => 'course'));
    $xsrf = null; $used = (int)$p['Использовано'];
    # сначала списываем место, потом выдаём доступ; не вышло — возвращаем место
    Cpr_admin_set($cfg, $xsrf, $tables['Промокод'], $p['_id'], array('Использовано' => $used + 1));
    try {
        $now = date('d.m.Y H:i:s');
        Cp_admin_create($cfg, $xsrf, $tables['Доступ'], $uid . ':' . $course, array(
            'Пользователь' => $uid, 'Курс' => $course, 'Ключ' => $key, 'Основание' => 'промокод', 'Дата и время' => $now));
    } catch (Exception $e) {
        try { Cpr_admin_set($cfg, $xsrf, $tables['Промокод'], $p['_id'], array('Использовано' => $used)); } catch (Exception $e2) { /* в лог ниже */ }
        throw $e;
    }
    try { # журнал: заявка сразу в статусе done (модератору разбирать нечего)
        Cp_admin_create($cfg, $xsrf, $tables['Заявка'], $uid . ':' . $course . ':' . time(), array(
            'Пользователь' => $uid, 'Курс' => $course, 'Код промокода' => $p['_main'], 'Статус' => 'done', 'Дата и время' => $now));
    } catch (Exception $e) { Cp_log($cfg, 'promo_journal_failed', array('user' => $uid, 'error' => $e->getMessage())); }
    Cp_log($cfg, 'promo_granted', array('user' => $uid, 'course' => $course, 'code' => $p['_main'], 'used' => $used + 1, 'limit' => $p['Лимит']));
    return array(200, array('ok' => true, 'status' => 'granted', 'course' => $course));
}
