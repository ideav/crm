<?php
# Тест предела времени запроса (issue #4322): блок # <time-limit-4322> в index.php.
#
# Запуск (нужны docker-образы mariadb:11.4 и php с mysqli):
#   bash experiments/php-time-limit-4322.sh
# Скрипт поднимает MariaDB, прогоняет этот файл в PHP с mysqli и убирает контейнеры.

$failed = 0;
function ok($cond, $name, $info = ""){
    global $failed;
    if($cond)
        echo "  ok   $name\n";
    else{
        echo "  FAIL $name".($info === "" ? "" : " — $info")."\n";
        $failed++;
    }
}

# Предел живёт прямо в index.php — берём оттуда блок между метками <time-limit-4322>,
# иначе пришлось бы выполнить весь index.php целиком (это запуск приложения).
$src = file_get_contents(__DIR__."/../index.php");
if(!preg_match('~# <time-limit-4322>(.*)# </time-limit-4322>~s', $src, $m))
    die("В index.php не найден блок # <time-limit-4322> … # </time-limit-4322>\n");
eval($m[1]);
mysqli_report(MYSQLI_REPORT_OFF);  # как в index.php: ошибки MySQL возвращаются, а не бросаются

echo "1. Разбор GET-параметра TIME\n";
$_GET = array();
ok(Time_limit_requested() === 30, "без TIME — 30 c по умолчанию", Time_limit_requested());
$_GET["TIME"] = "5";
ok(Time_limit_requested() === 5, "TIME=5 — 5 c", Time_limit_requested());
$_GET["TIME"] = "600";
ok(Time_limit_requested() === 600, "TIME=600 — 600 c", Time_limit_requested());
$_GET["TIME"] = "99999";
ok(Time_limit_requested() === 600, "TIME=99999 обрезается потолком 10 минут", Time_limit_requested());
$_GET["TIME"] = "0";
ok(Time_limit_requested() === 1, "TIME=0 — не меньше 1 c", Time_limit_requested());
$_GET["TIME"] = "-7";
ok(Time_limit_requested() === 1, "TIME=-7 — не меньше 1 c", Time_limit_requested());
$_GET["TIME"] = "abc";
ok(Time_limit_requested() === 30, "нечисловой TIME — значение по умолчанию", Time_limit_requested());
$_GET = array();

echo "2. Предел только повышается и не перезапускает таймер\n";
$GLOBALS["TIME_LIMIT"] = 0;
ok(Limit_time(30) === 30, "первый вызов ставит 30 c");
ok(Limit_time(10) === 30, "меньшее значение предел не понижает");
ok(Limit_time(300) === 300, "большее значение предел поднимает");
ok(Limit_time(3600) === 600, "выше потолка не поднимает", $GLOBALS["TIME_LIMIT"]);

$host = getenv("TEST_DB_HOST"); $user = getenv("TEST_DB_USER");
$pass = getenv("TEST_DB_PASSWORD"); $name = getenv("TEST_DB_NAME");
$port = (int)(getenv("TEST_DB_PORT") ?: 3306);
if($host === FALSE || $host === ""){
    echo "\nБД не задана (TEST_DB_HOST) — проверки MySQL пропущены\n";
    exit($failed ? 1 : 0);
}

function test_connect($host, $user, $pass, $name, $port){
    $c = mysqli_init();
    mysqli_options($c, MYSQLI_OPT_CONNECT_TIMEOUT, 10);
    mysqli_options($c, MYSQLI_OPT_READ_TIMEOUT, TIME_LIMIT_MAX + TIME_LIMIT_SQL_SLACK);
    if(!@mysqli_real_connect($c, $host, $user, $pass, $name, $port))
        die("Не удалось подключиться к тестовой БД: ".mysqli_connect_error()."\n");
    return $c;
}

echo "3. Сервер БД сам прерывает затянувшийся SELECT\n";
$connection = test_connect($host, $user, $pass, $name, $port);
ok(Limit_sql_time(2, $connection), "предел выставлен (".mysqli_get_server_info($connection).")");
$t0 = microtime(TRUE);
$res = @mysqli_query($connection, "SELECT SLEEP(30)");
$spent = microtime(TRUE) - $t0;
$errno = mysqli_errno($connection);
ok($res === FALSE, "SELECT SLEEP(30) прерван, а не выполнен");
ok($spent < 10, "прерван за ".round($spent, 2)." c вместо 30 c");
ok(Sql_timeout_errno($errno), "ошибка распознана как таймаут (errno $errno)");

echo "4. KILL QUERY добивает запрос, оставшийся на сервере\n";
$victim = test_connect($host, $user, $pass, $name, $port);
$GLOBALS["DB_CONN"] = array("host" => $host, "user" => $user, "password" => $pass,
                            "name" => $name, "port" => $port);
$GLOBALS["SQL_THREAD_ID"] = mysqli_thread_id($victim);
# Запрос запускаем асинхронно — так он остаётся выполняться на сервере, как при
# срубленном PHP-процессе, и его можно добить со стороны.
mysqli_query($victim, "SELECT SLEEP(20)", MYSQLI_ASYNC);
Sql_running("SELECT SLEEP(20)");
$t0 = microtime(TRUE);
ok(Kill_sql_query(), "KILL QUERY отправлен");
ok(empty($GLOBALS["SQL_RUNNING"]), "метка выполняющегося запроса снята");
ok(Kill_sql_query() === FALSE, "повторный вызов не убивает второй раз");
$links = $errors = $reject = array($victim);
mysqli_poll($links, $errors, $reject, 15);
$out = @mysqli_reap_async_query($victim);
$spent = microtime(TRUE) - $t0;
ok($out === FALSE, "запрос на сервере прерван");
ok($spent < 10, "прерван за ".round($spent, 2)." c вместо 20 c");
ok(mysqli_errno($victim) === 1317, "errno 1317 (query execution was interrupted), получено ".mysqli_errno($victim));

echo $failed ? "\nПРОВАЛЕНО проверок: $failed\n" : "\nВсе проверки пройдены\n";
exit($failed ? 1 : 0);
