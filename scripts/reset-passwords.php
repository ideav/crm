<?php
# Новые пароли всем пользователям базы. Нужен после переноса со старого Интеграма: пароли
# старого сервера новое ядро не принимает (local/ПЕРЕНОС-СО-СТАРОГО.md).
#
#   php scripts/reset-passwords.php <база> [логин …]
#
# Без логинов — все пользователи базы. Печатает «логин<TAB>пароль» по строке на пользователя.
# Пароль хешируется так же, как в ядре (Pwd_hash в index.php): bcrypt от HMAC-SHA256 ключом
# SALT.<база>. Доступ к БД и SALT — из тех же переменных, что у сайта (INTEGRAM_DB_*, INTEGRAM_SALT).
# Токены API пользователей не меняются.

const USER = 18;
const PASSWORD = 20;

function env($name, $default = ''){
    $v = getenv($name);
    return ($v === false || $v === '') ? $default : $v;
}
function stop($msg){
    fwrite(STDERR, "СТОП: $msg\n");
    exit(1);
}

$db = $argv[1] ?? '';
$logins = array_slice($argv, 2);
if(!preg_match('/^[A-Za-z0-9_]+$/', $db))
    stop("укажите базу: php scripts/reset-passwords.php <база> [логин …]");
$salt = env('INTEGRAM_SALT');
if($salt === '')
    stop("не задан INTEGRAM_SALT (без Docker: . /etc/apache2/envvars)");

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
try {
    $c = new mysqli(env('INTEGRAM_DB_HOST', 'localhost'), env('INTEGRAM_DB_USER', 'ideav'),
                    env('INTEGRAM_DB_PASSWORD', 'x'), env('INTEGRAM_DB_NAME', 'ideav'),
                    (int)env('INTEGRAM_DB_PORT', '3306'));
} catch(mysqli_sql_exception $e){
    stop("нет доступа к БД: ".$e->getMessage());
}
$c->set_charset('utf8mb4');
if(!$c->query("SHOW TABLES LIKE '$db'")->num_rows)
    stop("нет базы $db");

$users = [];
$res = $c->query("SELECT u.id, u.val, MIN(p.id) pwd FROM `$db` u LEFT JOIN `$db` p ON p.up=u.id AND p.t=".PASSWORD
                ." WHERE u.up=1 AND u.t=".USER." GROUP BY u.id, u.val ORDER BY u.val");
while($row = $res->fetch_assoc())
    if(!$logins || in_array($row['val'], $logins, TRUE))
        $users[$row['val']] = $row;
foreach($logins as $l)
    if(!isset($users[$l]))
        stop("нет пользователя $l в базе $db");
if(!$users)
    stop("в базе $db нет пользователей");

# Без 0/O, 1/l/I: пароль диктуют и переписывают руками.
$alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
$c->begin_transaction();
$upd = $c->prepare("UPDATE `$db` SET val=? WHERE id=?");
$ins = $c->prepare("INSERT INTO `$db` (up, ord, t, val) VALUES (?, 1, ".PASSWORD.", ?)");
$out = [];
foreach($users as $login => $u){
    $pwd = '';
    for($i = 0; $i < 12; $i++)
        $pwd .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    $hash = password_hash(base64_encode(hash_hmac('sha256', $pwd, $salt.$db, TRUE)), PASSWORD_DEFAULT);
    if($u['pwd']){
        $upd->bind_param('si', $hash, $u['pwd']);
        $upd->execute();
    } else {
        $ins->bind_param('is', $u['id'], $hash);
        $ins->execute();
    }
    $out[] = "$login\t$pwd";
}
$c->commit();
echo implode("\n", $out), "\n";
