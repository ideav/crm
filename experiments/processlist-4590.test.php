<?php
# Тест списка сессий MySQL в dir_admin (issue #4590): блок # <processlist-4590> в ядре.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/processlist-4590.test.php
#
# Обращений к БД тут нет: Get_processlist() только читает SHOW FULL PROCESSLIST, а весь
# отбор — в Processlist_rows(), ей и скармливаем готовые строки.

mb_internal_encoding("UTF-8");

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

# Функции живут прямо в ядре — берём блок между метками, иначе пришлось бы выполнить
# весь index.php целиком (это запуск приложения).
# Переводы строк нормализуем: ядро upsound хранится с CRLF, index.php — с LF,
# а сравнивать блоки надо по содержимому.
function core_block($file){
    $src = file_get_contents($file);
    if(!preg_match('~# <processlist-4590>(.*)# </processlist-4590>~s', $src, $m))
        die("В $file не найден блок # <processlist-4590> … # </processlist-4590>\n");
    return str_replace("\r\n", "\n", $m[1]);
}

$core   = __DIR__."/../index.php";
$legacy = __DIR__."/../experiments/index_upsound_260723.fixed.php";

# Ядро зовёт t9n() для сообщений; здесь достаточно отдать русскую половину.
function t9n($msg){
    if(preg_match('~\[RU\](.*?)\[EN\]~s', $msg, $m))
        return $m[1];
    return $msg;
}

eval(core_block($core));

# Строка SHOW FULL PROCESSLIST такой, какой её отдаёт MySQL.
function proc($id, $time, $info, $command = "Query", $state = "executing"){
    return array("Id" => (string)$id, "User" => "ideav", "Host" => "localhost:1", "db" => "ideav",
                 "Command" => $command, "Time" => (string)$time, "State" => $state, "Info" => $info);
}

echo "1. Чья сессия: имя базы ищется как отдельное слово\n";
ok(Processlist_is_own("SELECT * FROM ups WHERE id=1", "ups") === TRUE, "запрос к своей таблице — свой");
ok(Processlist_is_own("SELECT * FROM upsound a", "ups") === FALSE, "ups не выдаёт себя за upsound");
ok(Processlist_is_own("SELECT * FROM my_ups x", "ups") === FALSE, "суффикс чужого имени не считается");
ok(Processlist_is_own("SELECT ups.val FROM ups", "ups") === TRUE, "имя через точку тоже находится");
ok(Processlist_is_own("SHOW FULL PROCESSLIST", "ups") === FALSE, "запрос без имени базы — чужой");
ok(Processlist_is_own("SELECT * FROM ups", "") === FALSE, "без имени базы своих нет");

echo "\n2. Текст запроса: одна строка, 127 символов, кириллица не рубится пополам\n";
$long = str_repeat("я", 200);
ok(mb_strlen(Processlist_sql_text($long)) === 127, "ровно 127 символов",
   mb_strlen(Processlist_sql_text($long)));
ok(strlen(Processlist_sql_text($long)) === 254, "127 символов кириллицы = 254 байта: обрезка по символам",
   strlen(Processlist_sql_text($long)));
ok(Processlist_sql_text("SELECT\n  *\tFROM\r\n ups") === "SELECT * FROM ups", "перевод строки и табуляция схлопываются",
   Processlist_sql_text("SELECT\n  *\tFROM\r\n ups"));
ok(Processlist_sql_text("  SELECT 1  ") === "SELECT 1", "краевые пробелы снимаются");
ok(Processlist_sql_text("SELECT 1", 3) === "SEL", "длина обрезки задаётся параметром");
ok(PROCESSLIST_SQL_CHARS === 127, "по умолчанию показываем 127 символов (issue #4590)");

echo "\n3. Отбор сессий: спящие не в счёт, чужие — только админу\n";
$rows = array(
    proc(1, 5,  "SELECT * FROM ups WHERE id=1"),
    proc(2, 0,  "", "Sleep", ""),                    # соединение без запроса
    proc(3, 90, "SELECT * FROM upsound WHERE id=2"), # чужая база
    proc(4, 42, "UPDATE ups SET val='x'"),
);
$mine = Processlist_rows($rows, FALSE, "ups");
ok(count($mine) === 2, "владельцу базы видны только его запросы", count($mine));
ok($mine[0]["id"] === 4 && $mine[1]["id"] === 1, "долгие сверху", $mine[0]["id"].",".$mine[1]["id"]);
ok($mine[0]["time"] === 42 && is_int($mine[0]["time"]), "время — число секунд");
ok($mine[0]["info"] === "UPDATE ups SET val='x'", "текст запроса передан целиком: режет уже вывод");

$all = Processlist_rows($rows, TRUE, "ups");
ok(count($all) === 3, "админ видит и чужие запросы, но не спящие сессии", count($all));
ok($all[0]["id"] === 3, "у админа сверху самый долгий запрос", $all[0]["id"]);

ok(count(Processlist_rows(array(), FALSE, "ups")) === 0, "пустой список не ломает отбор");
ok(count(Processlist_rows(array(proc(9, 1, "   ")), FALSE, "ups")) === 0,
   "запрос из одних пробелов — это не запрос");

echo "\n4. Снятие сессии: чужое и своё не трогаем\n";
$GLOBALS["PROCESSLIST"] = Processlist_rows($rows, FALSE, "ups");  # список уже прочитан
$GLOBALS["SQL_THREAD_ID"] = 1;                                    # эту страницу обслуживает сессия 1
ok(strpos(Kill_processlist(0), "Неверный номер") !== FALSE, "нулевой номер отвергнут", Kill_processlist(0));
ok(strpos(Kill_processlist(-5), "Неверный номер") !== FALSE, "отрицательный номер отвергнут");
ok(strpos(Kill_processlist("abc"), "Неверный номер") !== FALSE, "нечисловой номер отвергнут");
ok(strpos(Kill_processlist(1), "обслуживает эту страницу") !== FALSE,
   "своя сессия не снимается", Kill_processlist(1));
ok(strpos(Kill_processlist(3), "принадлежит другой базе") !== FALSE,
   "чужая сессия недоступна: её нет в списке", Kill_processlist(3));
ok(strpos(Kill_processlist(777), "уже завершилась") !== FALSE, "исчезнувшая сессия — понятное сообщение");

echo "\n5. Оба ядра и оба шаблона несут одно и то же\n";
ok(core_block($core) === core_block($legacy), "блок processlist-4590 в ядрах совпадает дословно");
foreach(array("templates/dir_admin.html", "templates/upsound/dir_admin.html") as $tpl){
    $html = file_get_contents(__DIR__."/../".$tpl);
    ok(strpos($html, "<!-- Begin:&Processlist -->") !== FALSE, "$tpl: блок Processlist на месте");
    ok(strpos($html, "<!-- End:&Processlist -->") !== FALSE, "$tpl: блок Processlist закрыт");
    ok(strpos($html, 'name="kill" value="{PID}"') !== FALSE, "$tpl: кнопка шлёт номер сессии");
    ok(strpos($html, 'name="_xsrf"') !== FALSE, "$tpl: форма снятия несёт _xsrf");
    foreach(array("{PID}", "{TIME}", "{STATE}", "{SQL}", "{DISABLED}", "{OWN}", "{SESSIONS}") as $point)
        ok(strpos($html, $point) !== FALSE, "$tpl: точка вставки $point");
}

echo "\n".($failed ? "ПРОВАЛЕНО проверок: $failed\n" : "Все проверки пройдены\n");
exit($failed ? 1 : 0);
