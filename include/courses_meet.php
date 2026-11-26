<?php
# Видеовстречи портала ideav.ru/courses (ideav/courses#200): свой Jitsi Meet, вход только по ключу (JWT).
#
# courses-meet.php (POST JSON, заголовок X-Requested-With) → Cm_handle($cfg, $cookie, $in):
#   list   {course}            — встречи курса: ученику с «Доступом» и ведущему;
#   create {course, title, mode} — ведущий заводит встречу, получает код для гостей; mode: talk — говорят все,
#                                lecture — говорят ведущий и один вызванный им участник (модерация звука в Jitsi);
#   token  {id}                — ключ входа ученику/ведущему (ведущий — модератор комнаты);
#   guest  {code, name}        — ключ гостю по коду встречи, вход в портал не нужен;
#   ban / unban {id, who}      — блок-лист встречи; блок гостя меняет код (гостя по имени не узнать);
#   code   {id}                — новый код (старый перестаёт пускать);
#   close  {id}                — встреча закрыта, ключи больше не выдаются.
# Ведущий — куратор/админ портала или владелец «Курса автора» с этим кодом.
# Ключ живёт meet.ttl секунд (2 мин): его хватает, чтобы войти, а выгнанный ведущим и заблокированный
# нового не получит. Имя в ключе, в комнате его не сменить (readOnlyName в конфиге Jitsi).
#
# Встречи — файлы <store_dir>/meet/<id>.json (как заказы оплаты): таблиц в базе не нужно.
# Конфиг — courses-pay.json, раздел meet: {domain, app_id, secret, ttl, sub}; sub — XMPP-домен Jitsi, по умолчанию domain.

require_once __DIR__ . '/courses_pay.php';

function Cm_fail($http, $error){ return array($http, array('ok' => false, 'error' => $error)); }

function Cm_dir($cfg){ return rtrim($cfg['store_dir'], '/') . '/meet'; }
function Cm_path($cfg, $id){ return Cm_dir($cfg) . '/' . $id . '.json'; }

function Cm_load($cfg, $id){
    if (!is_string($id) || !preg_match('/^[a-f0-9]{16}$/', $id)) return null;
    $m = json_decode((string)@file_get_contents(Cm_path($cfg, $id)), true);
    return is_array($m) ? $m : null;
}

function Cm_save($cfg, $m){
    if (!is_dir(Cm_dir($cfg))) @mkdir(Cm_dir($cfg), 0770, true);
    $tmp = Cm_path($cfg, $m['id']) . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, json_encode($m, JSON_UNESCAPED_UNICODE)) === false || !@rename($tmp, Cm_path($cfg, $m['id'])))
        throw new Exception('courses-meet: не записать встречу ' . $m['id']);
}

# Правка встречи под блокировкой: $fn(&$m) возвращает ответ; встреча сохраняется после него
function Cm_update($cfg, $id, $fn){
    if (!is_dir(Cm_dir($cfg))) @mkdir(Cm_dir($cfg), 0770, true);
    $lock = @fopen(Cm_dir($cfg) . '/.lock', 'c');
    if ($lock) flock($lock, LOCK_EX);
    try {
        $m = Cm_load($cfg, $id);
        if (!$m) return Cm_fail(404, 'meeting');
        $res = $fn($m);
        if ($res[0] === 200) Cm_save($cfg, $m);
        return $res;
    } finally {
        if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
    }
}

# Код для гостей: 8 знаков без похожих (0/O, 1/I), 40 бит
function Cm_new_code(){
    $abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $s = '';
    for ($i = 0; $i < 8; $i++) $s .= $abc[random_int(0, 31)];
    return substr($s, 0, 4) . '-' . substr($s, 4);
}
function Cm_norm_code($c){ return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)$c)); }

# ---- кто я ----
# ['id','login','name','role'] или null (гость портала)
function Cm_me($cfg, $cookie){
    if ($cookie === '') return null;
    try {
        $me = Cp_json($cfg, 'GET', Cp_url($cfg, 'xsrf?JSON'), array('Cookie: ' . $cookie));
    } catch (Exception $e) {
        return null;
    }
    $uid = isset($me['id']) ? (string)$me['id'] : '';
    $role = isset($me['role']) && is_string($me['role']) ? $me['role'] : '';
    if (!preg_match('/^\d+$/', $uid) || $uid === '0' || $role === 'guest') return null;
    $login = isset($me['user']) && is_string($me['user']) ? $me['user'] : '';
    # логин (почта, телефон) в комнату не уходит: без «Имени» в «Профиле» — «Ученик <id>»
    return array('id' => $uid, 'login' => $login, 'name' => 'Ученик ' . $uid, 'role' => $role);
}

# Имя из «Профиля» (поле «Имя»), иначе «Ученик <id>»
function Cm_name($cfg, $tables, $me){
    if (!isset($tables['Профиль']['req']['Пользователь'], $tables['Профиль']['req']['Имя']) || $me['login'] === '') return $me['name'];
    foreach (Cp_rows($cfg, $tables['Профиль'], array('Пользователь' => $me['login'])) as $r)
        if (Cp_ref_id($r['Пользователь']) === $me['id'] && trim($r['Имя']) !== '') return Cm_clean_name($r['Имя']);
    return $me['name'];
}
function Cm_clean_name($s){
    $s = trim((string)preg_replace('/[\x00-\x1F\x7F<>]+/u', ' ', (string)$s));
    return mb_substr($s, 0, 60, 'UTF-8');
}

# Ведущий курса: куратор или админ портала, владелец «Курса автора» с этим кодом
function Cm_is_host($cfg, $tables, $me, $course){
    if (preg_match('/куратор|curator|^admin|^админ/iu', $me['role'])) return true;
    if (!Cp_authored($course) || !isset($tables['Курс автора']['req']['Код'], $tables['Курс автора']['req']['Владелец'])) return false;
    foreach (Cp_rows($cfg, $tables['Курс автора'], array('Код' => $course)) as $r)
        if ($r['Код'] === $course && Cp_ref_id($r['Владелец']) === $me['id']) return true;
    return false;
}

function Cm_has_access($cfg, $tables, $me, $course){
    $filters = $me['login'] !== '' ? array(array('Пользователь' => $me['login']), array()) : array(array());
    foreach ($filters as $f)
        foreach (Cp_rows($cfg, $tables['Доступ'], $f) as $r)
            if (Cp_ref_id($r['Пользователь']) === $me['id'] && $r['Курс'] === $course) return true;
    return false;
}

# ---- ключ Jitsi ----
function Cm_b64u($s){ return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }

# JWT HS256 для prosody (AUTH_TYPE=jwt): aud/iss/sub/room проверяет сервер Jitsi, moderator — владелец комнаты
function Cm_jwt($cfg, $room, $user, $moderator){
    $mc = $cfg['meet'];
    $now = isset($cfg['now']) ? (int)$cfg['now'] : time();
    $p = array(
        'aud' => 'jitsi', 'iss' => $mc['app_id'], 'sub' => isset($mc['sub']) ? $mc['sub'] : $mc['domain'], 'room' => $room,
        'nbf' => $now - 10, 'exp' => $now + (int)$mc['ttl'],
        'moderator' => (bool)$moderator,
        'context' => array('user' => array('id' => $user['id'], 'name' => $user['name'], 'moderator' => $moderator ? 'true' : 'false'),
            'features' => array('recording' => $moderator ? 'true' : 'false')),
    );
    $h = Cm_b64u(json_encode(array('alg' => 'HS256', 'typ' => 'JWT')));
    $b = Cm_b64u(json_encode($p, JSON_UNESCAPED_UNICODE));
    return "$h.$b." . Cm_b64u(hash_hmac('sha256', "$h.$b", $mc['secret'], true));
}

function Cm_ticket($cfg, &$m, $user, $moderator){
    if (!empty($user['guest'])) {
        # гостей в «Входили» — не больше 50 последних: код может уйти по рукам, файл встречи не растёт без конца
        $g = array_keys(array_filter($m['seen'], function ($s) { return !empty($s['guest']); }));
        foreach (array_slice($g, 0, max(0, count($g) - 49)) as $old) unset($m['seen'][$old]);
    }
    $m['seen'][$user['id']] = array('name' => $user['name'], 'guest' => !empty($user['guest']), 't' => date('Y-m-d H:i:s', isset($cfg['now']) ? (int)$cfg['now'] : time()));
    return array(200, array('ok' => true, 'domain' => $cfg['meet']['domain'], 'room' => $m['room'], 'jwt' => Cm_jwt($cfg, $m['room'], $user, $moderator),
        'moderator' => (bool)$moderator, 'name' => $user['name'], 'title' => $m['title'], 'mode' => Cm_mode($m)));
}

function Cm_mode($m){ return isset($m['mode']) && $m['mode'] === 'lecture' ? 'lecture' : 'talk'; }

# Встреча для ведущего — с кодом, блок-листом и списком вошедших; для ученика — без них
function Cm_view($m, $host){
    $v = array('id' => $m['id'], 'course' => $m['course'], 'title' => $m['title'], 'host' => $m['host_name'], 'created' => $m['created'], 'closed' => !empty($m['closed']), 'mode' => Cm_mode($m));
    # ведущий, заведший встречу, в списке вошедших не показывается: блокировать себя нечего
    $seen = $m['seen'];
    unset($seen[$m['host']]);
    if ($host) $v += array('code' => $m['code'], 'bans' => array_values($m['bans']), 'seen' => (object)$seen,
        'records' => isset($m['records']) ? $m['records'] : array());
    return $v;
}

# Запись на сервере Jitsi: скрипт после выгрузки в Kinescope сообщает ссылку.
# Подпись — HMAC-SHA256 секретом meet.record_secret от "room|video|link|ts", не старше часа.
function Cm_recorded($cfg, $str){
    $secret = isset($cfg['meet']['record_secret']) ? (string)$cfg['meet']['record_secret'] : '';
    if ($secret === '') return Cm_fail(503, 'record_off');
    $room = $str('room'); $video = $str('video'); $link = $str('link'); $ts = $str('ts');
    $now = isset($cfg['now']) ? (int)$cfg['now'] : time();
    $good = hash_hmac('sha256', "$room|$video|$link|$ts", $secret);
    if (!preg_match('/^\d{1,12}$/', $ts) || abs($now - (int)$ts) > 3600 || !hash_equals($good, $str('sig'))) return Cm_fail(403, 'sig');
    if (!preg_match('~^https://kinescope\.io/[A-Za-z0-9_-]{1,64}$~', $link) || !preg_match('/^[A-Za-z0-9-]{1,64}$/', $video)) return Cm_fail(400, 'link');
    if (!preg_match('/^c-[a-z0-9_-]{1,32}-([a-f0-9]{16})$/', $room, $mm)) return Cm_fail(404, 'meeting');
    $m = Cm_load($cfg, $mm[1]);
    if (!$m || $m['room'] !== $room) return Cm_fail(404, 'meeting');
    return Cm_update($cfg, $m['id'], function (&$m) use ($video, $link, $now) {
        $recs = isset($m['records']) ? $m['records'] : array();
        foreach ($recs as $r) if ($r['video'] === $video) return array(200, array('ok' => true));
        $recs[] = array('video' => $video, 'link' => $link, 'at' => date('Y-m-d H:i:s', $now));
        $m['records'] = array_slice($recs, -50);
        return array(200, array('ok' => true));
    });
}

# Вход гостей с одного адреса: не больше 30 попыток за 10 минут (каждая читает все встречи)
function Cm_guest_rate_ok($cfg, $ip){
    if (!is_dir(Cm_dir($cfg))) @mkdir(Cm_dir($cfg), 0770, true);
    $now = isset($cfg['now']) ? (int)$cfg['now'] : time();
    $f = Cm_dir($cfg) . '/rate-' . sha1((string)$ip) . '.txt';
    $h = @fopen($f, 'c+');
    if (!$h) return true;
    flock($h, LOCK_EX);
    $t = array_filter(array_map('intval', explode(',', (string)stream_get_contents($h))), function ($x) use ($now) { return $x > $now - 600; });
    $ok = count($t) < 30;
    if ($ok) $t[] = $now;
    ftruncate($h, 0); rewind($h); fwrite($h, implode(',', $t));
    flock($h, LOCK_UN); fclose($h);
    return $ok;
}

# ---- обработчик ----
# [HTTP-код, массив ответа]
function Cm_handle($cfg, $cookie, $in, $ip = ''){
    if (empty($cfg['meet']['secret']) || empty($cfg['meet']['domain']) || empty($cfg['meet']['app_id'])) return Cm_fail(503, 'meet_off');
    $cfg['meet'] += array('ttl' => 120);
    $act = isset($in['action']) && is_string($in['action']) ? $in['action'] : '';
    $str = function ($k) use ($in) { return isset($in[$k]) && is_string($in[$k]) ? trim($in[$k]) : ''; };

    if ($act === 'guest') {
        $code = Cm_norm_code($str('code'));
        $name = Cm_clean_name($str('name'));
        if (!Cm_guest_rate_ok($cfg, $ip)) return Cm_fail(429, 'too_many');
        if (strlen($code) !== 8) return Cm_fail(404, 'code');
        if ($name === '') return Cm_fail(400, 'name');
        foreach (glob(Cm_dir($cfg) . '/*.json') ?: array() as $f) {
            $m = Cm_load($cfg, basename($f, '.json'));
            if (!$m || Cm_norm_code($m['code']) !== $code) continue;
            if (!empty($m['closed'])) return Cm_fail(410, 'closed');
            $guest = array('id' => 'g-' . bin2hex(random_bytes(6)), 'name' => $name . ' (гость)', 'guest' => true);
            return Cm_update($cfg, $m['id'], function (&$m) use ($cfg, $guest, $code) {
                if (Cm_norm_code($m['code']) !== $code) return Cm_fail(404, 'code');
                return Cm_ticket($cfg, $m, $guest, false);
            });
        }
        return Cm_fail(404, 'code');
    }

    if ($act === 'recorded') return Cm_recorded($cfg, $str);

    $me = Cm_me($cfg, $cookie);
    if (!$me) return Cm_fail(401, 'login');
    try {
        $tables = Cp_schema($cfg);
        if ($act === 'list' || $act === 'create') {
            $course = $str('course');
            if (!preg_match('/^[a-z0-9_-]{1,32}$/', $course)) return Cm_fail(404, 'course');
        } else {
            $m = Cm_load($cfg, $str('id'));
            if (!$m) return Cm_fail(404, 'meeting');
            $course = $m['course'];
        }
        $host = Cm_is_host($cfg, $tables, $me, $course);
        if (!$host && !Cm_has_access($cfg, $tables, $me, $course)) return Cm_fail(403, 'access');
        $me['name'] = Cm_name($cfg, $tables, $me);
        if ($host && $me['name'] === 'Ученик ' . $me['id']) $me['name'] = 'Ведущий';
    } catch (Exception $e) {
        Cp_log($cfg, 'meet_failed', array('user' => $me['id'], 'action' => $act, 'error' => $e->getMessage()));
        return Cm_fail(502, 'base');
    }

    if ($act === 'list') {
        $out = array();
        foreach (glob(Cm_dir($cfg) . '/*.json') ?: array() as $f) {
            $m = Cm_load($cfg, basename($f, '.json'));
            if ($m && $m['course'] === $course && (empty($m['closed']) || $host)) $out[] = Cm_view($m, $host);
        }
        usort($out, function ($a, $b) { return strcmp($b['created'], $a['created']); });
        return array(200, array('ok' => true, 'host' => $host, 'meetings' => $out));
    }
    if ($act === 'create') {
        if (!$host) return Cm_fail(403, 'host');
        $title = Cm_clean_name($str('title'));
        $id = bin2hex(random_bytes(8));
        $m = array('id' => $id, 'room' => 'c-' . $course . '-' . $id, 'course' => $course, 'title' => $title !== '' ? $title : 'Встреча',
            'host' => $me['id'], 'host_name' => $me['name'], 'code' => Cm_new_code(), 'mode' => $str('mode') === 'lecture' ? 'lecture' : 'talk',
            'created' => date('Y-m-d H:i:s', isset($cfg['now']) ? (int)$cfg['now'] : time()), 'closed' => false, 'bans' => array(), 'seen' => array());
        Cm_save($cfg, $m);
        return array(200, array('ok' => true, 'meeting' => Cm_view($m, true)));
    }
    if ($act === 'token') {
        return Cm_update($cfg, $m['id'], function (&$m) use ($cfg, $me, $host) {
            if (!empty($m['closed'])) return Cm_fail(410, 'closed');
            if (!$host && in_array($me['id'], $m['bans'], true)) return Cm_fail(403, 'banned');
            return Cm_ticket($cfg, $m, $me, $host);
        });
    }
    if (!$host) return Cm_fail(403, 'host');
    $who = $str('who');
    return Cm_update($cfg, $m['id'], function (&$m) use ($act, $who) {
        if ($act === 'ban' || $act === 'unban') {
            if (!preg_match('/^(\d+|g-[a-f0-9]{12})$/', $who) || $who === (string)$m['host']) return Cm_fail(400, 'who');
            $m['bans'] = array_values(array_diff($m['bans'], array($who)));
            if ($act === 'ban') {
                $m['bans'][] = $who;
                # гость с тем же кодом взял бы новый ключ под новым id — код меняется
                if (strpos($who, 'g-') === 0) $m['code'] = Cm_new_code();
            }
        } elseif ($act === 'code') {
            $m['code'] = Cm_new_code();
        } elseif ($act === 'close') {
            $m['closed'] = true;
        } else {
            return Cm_fail(400, 'action');
        }
        return array(200, array('ok' => true, 'meeting' => Cm_view($m, true)));
    });
}
