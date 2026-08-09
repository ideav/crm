<?php
# Регрессионный тест: вход по QR-коду (#4667).
#
# Проверяем серверное хранилище QR-сессий целиком, реальными функциями из
# index.php (файловый стор во временном каталоге, БД не нужна):
#   1) qrnew выдаёт РАЗНЫЕ код и секрет; сессия создаётся в статусе pending;
#   2) опрос без секрета/с чужим секретом токен НЕ отдаёт (denied) — код виден
#      всем, кто видит экран с QR, и одного кода мало;
#   3) после подтверждения телефоном опрос отдаёт постоянный токен ОДИН раз,
#      второй опрос — expired (сессию забрали);
#   4) просроченный код (старше QR_LOGIN_TTL) не подтверждается и не отдаётся;
#   5) чужой код в чужой базе не виден: стор пер-база;
#   6) прополка и потолок QR_LOGIN_MAX не дают файлу расти бесконечно;
#   7) кука qr_pending разворачивается в адрес страницы подтверждения только
#      при валидных имени базы и коде (возврат после входа через OAuth).

# Вывод буферизуем: qrLoginPendingRedirect() гасит куку через setcookie(), а тот
# ругается на «headers already sent», если тест уже что-то напечатал.
ob_start();

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

define("QR_LOGIN_TTL", 120);
define("QR_LOGIN_MAX", 200);
define("QR_CODE_MASK", "/^[a-f0-9]{32,64}$/");
define("DB_MASK", "/^[a-z0-9_]{1,15}$/i");

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false) throw new Exception("not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth=0; $len=strlen($source);
    for($i=$brace;$i<$len;$i++){
        if($source[$i]==="{") $depth++;
        elseif($source[$i]==="}"){ $depth--; if($depth===0) return substr($source,$start,$i-$start+1); }
    }
    throw new Exception("not closed: ".$name);
}

$source = file_get_contents(__DIR__."/../index.php");
$fns = array(
    "secureToken","qrLoginFile","qrLoginNew","qrLoginPrune","qrLoginAppend","qrLoginFind",
    "qrLoginReplace","qrLoginRemove","qrLoginExpired","qrLoginClaimStatus",
    "qrLoginEncode","qrLoginDecode","qrLoginLoadRaw","qrLoginMutate",
    "qrLoginCreate","qrLoginConfirm","qrLoginClaim","qrLoginGet","qrLoginPendingRedirect"
);
foreach($fns as $fn) eval(extract_function_source($source, $fn));

$db = "qr".getmypid();
$other = "qx".getmypid();
@unlink(qrLoginFile($db));
@unlink(qrLoginFile($other));

# 1) Создание сессии.
$session = qrLoginCreate($db, "Chrome · Windows · 10.0.0.1");
expect(is_array($session), "qrnew возвращает сессию");
expect(preg_match(QR_CODE_MASK, $session["code"]) === 1, "код в формате QR_CODE_MASK");
expect(preg_match(QR_CODE_MASK, $session["secret"]) === 1, "секрет в формате QR_CODE_MASK");
expect($session["code"] !== $session["secret"], "код и секрет — РАЗНЫЕ значения");
expect($session["status"] === "pending", "новая сессия ждёт телефон");
expect(qrLoginGet($db, $session["code"])["client"] === "Chrome · Windows · 10.0.0.1", "подпись устройства сохранена");

$second = qrLoginCreate($db, "");
expect($second["code"] !== $session["code"], "два запроса дают разные коды");

# 2) Опрос до подтверждения.
$claim = qrLoginClaim($db, $session["code"], $session["secret"]);
expect($claim["status"] === "pending", "со своим секретом до подтверждения — pending");
$claim = qrLoginClaim($db, $session["code"], "");
expect($claim["status"] === "denied", "без секрета — denied");
$claim = qrLoginClaim($db, $session["code"], $second["secret"]);
expect($claim["status"] === "denied", "с чужим секретом — denied");
$claim = qrLoginClaim($db, str_repeat("a", 64), $session["secret"]);
expect($claim["status"] === "expired", "неизвестный код — expired");

# 3) Телефон подтвердил вход: отдаём постоянный токен ОДИН раз.
expect(qrLoginConfirm($db, $session["code"], "ivan", "TOK-PERMANENT", "XSRF-22") === "confirmed", "подтверждение принято");
$claim = qrLoginClaim($db, $session["code"], "");
expect($claim["status"] === "denied", "подтверждённую сессию без секрета не забрать");
$claim = qrLoginClaim($db, $session["code"], $session["secret"]);
expect($claim["status"] === "confirmed", "со своим секретом — confirmed");
expect($claim["session"]["token"] === "TOK-PERMANENT", "отдан постоянный токен пользователя");
expect($claim["session"]["xsrf"] === "XSRF-22", "отдан xsrf");
expect($claim["session"]["user"] === "ivan", "отдано имя пользователя");
$claim = qrLoginClaim($db, $session["code"], $session["secret"]);
expect($claim["status"] === "expired", "повторный опрос токен НЕ отдаёт — сессия забрана");
expect(qrLoginGet($db, $session["code"]) === null, "забранной сессии в сторе нет");

# 4) Просрочка: код живёт QR_LOGIN_TTL.
$stale = qrLoginCreate($db, "");
qrLoginMutate($db, function($sessions) use ($stale){
    $s = qrLoginFind($sessions, $stale["code"]);
    $s["createdAt"] = time() - QR_LOGIN_TTL - 1;
    return array(qrLoginReplace($sessions, $stale["code"], $s), null);
});
expect(qrLoginGet($db, $stale["code"]) === null, "просроченный код не открывает страницу подтверждения");
expect(qrLoginConfirm($db, $stale["code"], "ivan", "TOK", "X") === "expired", "просроченный код не подтверждается");
expect(qrLoginClaim($db, $stale["code"], $stale["secret"])["status"] === "expired", "просроченный код токен не отдаёт");

# 5) Стор — пер-база: код одной базы в другой не существует.
$mine = qrLoginCreate($db, "");
expect(qrLoginGet($other, $mine["code"]) === null, "код чужой базы не виден");
qrLoginConfirm($other, $mine["code"], "hacker", "TOK-ALIEN", "X");
expect(qrLoginClaim($db, $mine["code"], $mine["secret"])["status"] === "pending", "подтверждение в чужой базе на сессию не влияет");

# 6) Прополка и потолок (чистые функции, без файла).
$now = time();
$list = array(
    array("code"=>"a","createdAt"=>$now - QR_LOGIN_TTL - 5),
    array("code"=>"b","createdAt"=>$now),
    array("createdAt"=>$now),          # без кода — мусор
    "not an array"
);
$pruned = qrLoginPrune($list, $now, QR_LOGIN_TTL);
expect(count($pruned) === 1 && $pruned[0]["code"] === "b", "прополка убирает просроченные и мусор");
$capped = array();
for($i = 0; $i < QR_LOGIN_MAX + 5; $i++)
    $capped = qrLoginAppend($capped, array("code"=>"c$i","createdAt"=>$now), QR_LOGIN_MAX);
expect(count($capped) === QR_LOGIN_MAX, "потолок QR_LOGIN_MAX держит размер файла");
expect($capped[count($capped)-1]["code"] === "c".(QR_LOGIN_MAX + 4), "последней остаётся самая свежая сессия");

# 7) Возврат после входа через OAuth: адрес собирается только из валидных значений.
$_COOKIE["qr_pending"] = "ateh:".str_repeat("f", 64);
expect(qrLoginPendingRedirect() === "/ateh/qrlogin?c=".str_repeat("f", 64), "кука разворачивается в страницу подтверждения");
$_COOKIE["qr_pending"] = "ateh:../../evil";
expect(qrLoginPendingRedirect() === "", "мусорный код — без редиректа");
$_COOKIE["qr_pending"] = "https://evil.example:".str_repeat("f", 64);
expect(qrLoginPendingRedirect() === "", "чужой хост вместо базы — без редиректа");
unset($_COOKIE["qr_pending"]);
expect(qrLoginPendingRedirect() === "", "без куки — без редиректа");

@unlink(qrLoginFile($db));
@unlink(qrLoginFile($other));

echo $failures ? "\n$failures FAILED\n" : "\nAll tests passed\n";
ob_end_flush();
exit($failures ? 1 : 0);
