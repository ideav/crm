<?php
# Мерка секции «Задачи cron» в dir_admin: блок # <crontab-dir-admin> в ядре и шаблоны.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/crontab-dir-admin.test.php
#
# crontab сервера не читается: Get_crontab() принимает готовые строки, весь разбор и отбор —
# в функциях блока. Движок шаблонов (Make_tree/Parse_block) берётся из ядра как есть.

error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
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

# Переводы строк нормализуем: ядро upsound хранится с CRLF, index.php — с LF.
function core_block($file){
    $src = file_get_contents($file);
    if(!preg_match('~# <crontab-dir-admin>(.*)# </crontab-dir-admin>~s', $src, $m))
        die("В $file не найден блок # <crontab-dir-admin> … # </crontab-dir-admin>\n");
    return str_replace("\r\n", "\n", $m[1]);
}

$core   = __DIR__."/../index.php";
$legacy = __DIR__."/../experiments/index_upsound_260723.fixed.php";
eval(core_block($core));

echo "1. Разбор crontab\n";
$lines = array(
    "MAILTO=\"\"",
    "SHELL=/bin/sh",
    "# Коннектор spz: Битрикс24 каждый час",
    "0 * * * * curl -s \"https://ideav.ru/b24ig.php?db=spz&config=sportzania-spz\" >/dev/null",
    "",
    "# забытое пояснение",
    "",
    "*/15  2-6 * * 1-5   php /var/www/www-root/data/www/ideav.ru/b24ig.php --db=ateh --config=onec",
    "@hourly curl -s https://ideav.ru/spz/gssync?JSON&config=my_config1&token=SECRET123",
    "#0 3 * * * отключённая задача",
    "30 4 * * * /usr/bin/php /var/www/www-root/data/www/ideav.ru/update.php",
    "\r",
);
$tasks = Crontab_parse($lines);
ok(count($tasks) === 4, "4 задачи: переменные окружения, комментарии и пустые строки не задачи", count($tasks));
ok($tasks[0]["schedule"] === "0 * * * *", "расписание из пяти полей", $tasks[0]["schedule"]);
ok(strpos($tasks[0]["command"], "b24ig.php?db=spz") !== FALSE, "команда целиком");
ok($tasks[0]["note"] === "Коннектор spz: Битрикс24 каждый час", "пояснение — комментарий строкой выше", $tasks[0]["note"]);
ok($tasks[1]["note"] === "", "пустая строка отрывает пояснение от задачи");
ok($tasks[1]["schedule"] === "*/15 2-6 * * 1-5", "пробелы в расписании схлопываются", $tasks[1]["schedule"]);
ok($tasks[2]["schedule"] === "@hourly", "специальные расписания @hourly и т.п.");
ok($tasks[3]["note"] === "0 3 * * * отключённая задача", "закомментированная задача — не задача, а пояснение следующей");
ok(count(Crontab_parse(array())) === 0 && count(Crontab_parse(NULL)) === 0, "пустой crontab не ломает разбор");

echo "\n2. Чья задача: имя базы только там, где его ставит Интеграм\n";
ok(Crontab_is_own("curl -s \"https://ideav.ru/b24ig.php?db=spz&config=x\"", "spz") === TRUE, "db=<база> в адресе");
ok(Crontab_is_own("php b24ig.php --db=spz --config=x", "spz") === TRUE, "--db=<база> в командной строке");
ok(Crontab_is_own("curl https://ideav.ru/spz/gssync?JSON", "spz") === TRUE, "первый сегмент адреса /<база>/");
ok(Crontab_is_own("curl https://ideav.ru/spz", "spz") === TRUE, "адрес, заканчивающийся именем базы");
ok(Crontab_is_own("rm -rf /var/www/www-root/data/www/ideav.ru/templates/custom/spz/logs/old", "spz") === TRUE, "папка базы templates/custom/<база>/");
ok(Crontab_is_own("find download/spz -mtime +30", "spz") === TRUE, "папка базы download/<база>");
ok(Crontab_is_own("curl \"https://ideav.ru/b24ig.php?db=spz2&config=x\"", "spz") === FALSE, "spz не выдаёт себя за spz2");
ok(Crontab_is_own("curl https://ideav.ru/spz2/gssync", "spz") === FALSE, "сегмент /spz2/ — чужой");
ok(Crontab_is_own("curl \"https://ideav.ru/b24ig.php?xdb=spz\"", "spz") === FALSE, "xdb= — не параметр db");
ok(Crontab_is_own("curl https://ideav.ru/b24ig.php?db=spz", "ru") === FALSE, "база ru не совпадает с доменом ideav.ru");
ok(Crontab_is_own("php /var/www/www-root/data/www/ideav.ru/update.php", "data") === FALSE, "база data не совпадает с путём /data/");
ok(Crontab_is_own("php /var/www/www-root/data/www/ideav.ru/update.php", "www") === FALSE, "база www не совпадает с путём сайта");
ok(Crontab_is_own("curl https://ideav.ru/spz/", "") === FALSE, "без имени базы своих нет");

echo "\n3. Секреты скрыты\n";
$m = Crontab_mask("curl \"https://ideav.ru/spz/report?JSON&token=abc123&_xsrf=x9\"");
ok(strpos($m, "abc123") === FALSE && strpos($m, "token=***") !== FALSE && strpos($m, "_xsrf=***") !== FALSE, "token= и _xsrf= в адресе", $m);
$m = Crontab_mask("INTEGRAM_TOKEN=tok B24_WEBHOOK=https://b24/rest/1/abc/ API_KEY=k1 php b24ig.php");
ok(strpos($m, "tok ") === FALSE && strpos($m, "INTEGRAM_TOKEN=***") !== FALSE && strpos($m, "B24_WEBHOOK=***") !== FALSE && strpos($m, "API_KEY=***") !== FALSE, "переменные окружения с секретами", $m);
$m = Crontab_mask("curl -H \"X-Authorization: 9f8e7d\" -H 'Authorization: Bearer zzz' https://x");
ok(strpos($m, "9f8e7d") === FALSE && strpos($m, "zzz") === FALSE, "заголовки авторизации", $m);
$m = Crontab_mask("curl https://api_integram:Pa55w0rd@1c.local/base/odata/standard.odata/");
ok(strpos($m, "Pa55w0rd") === FALSE && strpos($m, "api_integram:***@") !== FALSE, "пароль в адресе user:pass@", $m);
$m = Crontab_mask("curl -u api:Secret1 https://x");
ok(strpos($m, "Secret1") === FALSE, "curl -u user:pass", $m);
$m = Crontab_mask("curl https://b24.sportzania.ru/rest/58802/k2j3h4g5f6/crm.lead.list.json");
ok(strpos($m, "k2j3h4g5f6") === FALSE && strpos($m, "/rest/58802/***") !== FALSE, "код вебхука Битрикса", $m);
$m = Crontab_mask("curl -b \"idb_spz=tokentoken\" https://ideav.ru/spz/dir_admin/");
ok(strpos($m, "tokentoken") === FALSE, "cookie idb_<база>", $m);
ok(Crontab_mask("php /var/www/www-root/data/www/ideav.ru/update.php") === "php /var/www/www-root/data/www/ideav.ru/update.php", "строка без секретов не меняется");
ok(Crontab_mask("curl https://x/?bypass=1&monkey=2") === "curl https://x/?bypass=1&monkey=2", "похожие слова (bypass=, monkey=) не маскируются");
$m = Crontab_mask("mysqldump -uroot -pS3cr3t spz > /var/www/www-root/data/www/ideav.ru/download/spz/dump.sql");
ok(strpos($m, "S3cr3t") === FALSE, "пароль mysql -p без пробела", $m);
$m = Crontab_mask("MYSQL_PWD=hunter2 mysqldump spz");
ok(strpos($m, "hunter2") === FALSE && strpos($m, "MYSQL_PWD=***") !== FALSE, "MYSQL_PWD=", $m);
$m = Crontab_mask("wget --password s3kret https://x");
ok(strpos($m, "s3kret") === FALSE, "--password со значением через пробел", $m);
$m = Crontab_mask('curl -d \'{"token":"abc123","x":1}\' https://ideav.ru/spz/report');
ok(strpos($m, "abc123") === FALSE, "секрет в JSON-теле запроса", $m);
ok(Crontab_mask("cp -p a b") === "cp -p a b", "cp -p (с пробелом) не считается паролем");

echo "\n4. Вывод: одна строка, обрезка после маскировки, экранирование\n";
$t = Crontab_text(str_repeat("я", 400));
ok(mb_strlen($t) === 300 && strlen($t) === 600, "300 символов, а не байт", mb_strlen($t));
$t = Crontab_text(str_repeat("x", 290)." token=".str_repeat("S", 50));
ok(strpos($t, "SSSS") === FALSE, "секрет на границе обрезки не просачивается", $t);
ok(Crontab_text("a\n  b\tc ") === "a b c", "пробелы и переводы строк схлопываются");
ok(Crontab_html("<b>x</b> & 'q'") === "&lt;b&gt;x&lt;/b&gt; &amp; &#039;q&#039;", "HTML экранирован", Crontab_html("<b>x</b> & 'q'"));

echo "\n5. Отбор задач для пользователя\n";
$z = "spz";
$GLOBALS["GLOBAL_VARS"] = array("user" => "spz");
$mine = Get_crontab(TRUE, $lines);
ok(count($mine) === 2, "владельцу spz — только задачи spz", count($mine));
ok(strpos($mine[1]["command"], "/spz/gssync") !== FALSE, "адрес /spz/… тоже его");
ok(Get_crontab() === $mine, "список запоминается на время запроса");
$GLOBALS["GLOBAL_VARS"] = array("user" => "admin");
ok(count(Get_crontab(TRUE, $lines)) === 4, "admin видит все задачи");
$z = "ru";
$GLOBALS["GLOBAL_VARS"] = array("user" => "ru");
ok(count(Get_crontab(TRUE, $lines)) === 0, "база ru не видит чужих задач на ideav.ru");

echo "\n6. Оба ядра и оба шаблона несут одно и то же\n";
ok(core_block($core) === core_block($legacy), "блок crontab-dir-admin в ядрах совпадает дословно");
foreach(array($core, $legacy) as $file){
    $src = str_replace("\r\n", "\n", file_get_contents($file));
    $short = basename($file);
    ok(strpos($src, 'case "&cronlist":') !== FALSE, "$short: обработчик списка &cronlist");
    ok(strpos($src, '$blocks[$block]["crontasks"][] = count(Get_crontab());') !== FALSE, "$short: счётчик задач в &dir_admin");
}
foreach(array("templates/dir_admin.html", "templates/upsound/dir_admin.html") as $tpl){
    $html = file_get_contents(__DIR__."/../".$tpl);
    ok(preg_match('~<!-- Begin:&Crontab -->.*<!-- Begin:&Cronlist -->.*<!-- End:&Cronlist -->.*\{_parent_\.CRONTASKS\}.*<!-- End:&Crontab -->~s', $html) === 1,
       "$tpl: секция в подблоке &Crontab, строки в &Cronlist, счётчик у родителя");
    foreach(array("{SCHEDULE}", "{COMMAND}", "{NOTE}") as $point)
        ok(strpos($html, $point) !== FALSE, "$tpl: точка вставки $point");
    ok(strpos($html, "{CRONTASKS}") === FALSE, "$tpl: голой точки вставки CRONTASKS нет");
}

echo "\n7. Движок: страница переживает старое ядро, новое ядро выводит задачи\n";
function core_function($src, $name){
    $tokens = token_get_all($src);
    $n = count($tokens);
    for($i = 0; $i < $n; $i++){
        if(!is_array($tokens[$i]) || $tokens[$i][0] !== T_FUNCTION)
            continue;
        $j = $i + 1;
        while($j < $n && is_array($tokens[$j]) && in_array($tokens[$j][0], array(T_WHITESPACE, T_COMMENT, T_DOC_COMMENT)))
            $j++;
        if($j >= $n || !is_array($tokens[$j]) || $tokens[$j][0] !== T_STRING || $tokens[$j][1] !== $name)
            continue;
        $code = "";
        $depth = 0;
        $started = FALSE;
        for($k = $i; $k < $n; $k++){
            $t = $tokens[$k];
            $code .= is_array($t) ? $t[1] : $t;
            if(!is_array($t)){
                if($t === "{"){ $depth++; $started = TRUE; }
                elseif($t === "}"){
                    $depth--;
                    if($started && $depth === 0)
                        return $code."\n";
                }
            }
            elseif($t[0] === T_CURLY_OPEN || $t[0] === T_DOLLAR_OPEN_CURLY_BRACES)
                $depth++;
        }
    }
    die("В ядре не найдена функция $name — мерка потеряла предмет\n");
}
eval(core_function(file_get_contents($core), "Make_tree").core_function(file_get_contents($core), "Parse_block"));
function trace($msg){}
function isApi(){ return FALSE; }
function BuiltIn($name){ return $name; }
function die_info($msg){ die("die_info: $msg\n"); }
function Get_file($name, $ui = TRUE){ return ""; }
function Get_block_data($block, $exe = TRUE, $noFilters = FALSE){
    global $blocks;
    $tmp = explode(".", $block);
    $name = array_pop($tmp);
    if(!isset($GLOBALS["FAKE_CORE"][$name]))
        return;
    foreach($GLOBALS["FAKE_CORE"][$name] as $key => $values)
        foreach($values as $value)
            $blocks[$block][$key][] = $value;
}
function render($template, $fake){
    global $blocks;
    $blocks = array();
    $GLOBALS["FAKE_CORE"] = $fake;
    $GLOBALS["GLOBAL_VARS"] = array("z" => "spz", "xsrf" => "XSRF-SECRET-VALUE", "user" => "spz");
    Make_tree($template, "");
    return Parse_block("");
}

$oldCore = array(   # ядро до этой правки: сессии знает, про cron — нет
    "&dir_admin"   => array("folder" => array("templates"), "another" => array("download"), "path" => array("templates/custom/spz"),
                            "add_path" => array(""), "files" => array(2), "folders" => array(1), "sessions" => array(0)),
    "&dir_list"    => array("name" => array("backups")),
    "&file_list"   => array("name" => array("main.html", "connector.json"), "size" => array("1 KB", "2 KB"),
                            "time" => array("14.09.2026 09:00:00", "14.09.2026 09:05:00")),
);
$newCore = $oldCore;
$newCore["&dir_admin"]["crontasks"] = array(2);
$cmdWithPoint = "curl \"https://ideav.ru/b24ig.php?db=spz&config=x\" # {_global_.xsrf}";
$newCore["&cronlist"] = array("schedule" => array("0 * * * *", "@hourly"),
                              "command"  => array(Crontab_html(Crontab_text($cmdWithPoint)), Crontab_html(Crontab_text("curl https://ideav.ru/spz/gssync?JSON&token=abc"))),
                              "note"     => array(Crontab_html("Коннектор <spz>"), ""));
$tpl = file_get_contents(__DIR__."/../templates/dir_admin.html");

$page = render($tpl, $oldCore);
ok(strpos($page, "connector.json") !== FALSE && strpos($page, "backups") !== FALSE, "старое ядро: списки файлов и каталогов на месте");
ok(strpos($page, "Задачи cron") === FALSE, "старое ядро: секция cron скрыта целиком");
ok(strpos($page, "{_block_") === FALSE && strpos($page, "CRONTASKS") === FALSE, "старое ядро: сырых точек вставки нет");

$page = render($tpl, $newCore);
ok(strpos($page, "Задачи cron") !== FALSE && strpos($page, "Задач: 2") !== FALSE, "новое ядро: секция и счётчик через _parent_");
ok(strpos($page, "b24ig.php?db=spz&amp;config=x") !== FALSE, "команда выведена (HTML-экранирована)");
ok(strpos($page, "@hourly") !== FALSE && strpos($page, "token=***") !== FALSE && strpos($page, "abc") === FALSE, "секрет в команде скрыт");
ok(strpos($page, "Коннектор &lt;spz&gt;") !== FALSE, "пояснение выведено и экранировано");
# Значение xsrf на странице законно есть — в форме секции сессий; смотрим только секцию cron.
preg_match('~<h4>Задачи cron</h4>(.*?)Задач: 2~s', $page, $sec);
$sec = isset($sec[1]) ? $sec[1] : "";
# Движок сам прячет скобки в подставленных значениях и возвращает их только на выходе.
ok($sec !== "" && strpos($sec, "XSRF-SECRET-VALUE") === FALSE && strpos($sec, "# {_global_.xsrf}") !== FALSE,
   "{_global_.xsrf} из строки cron выведен как текст, а не подставлен движком", substr($sec, 0, 200));
ok(strpos($page, "connector.json") !== FALSE, "новое ядро: список файлов не пострадал");

echo "\n".($failed ? "ПРОВАЛЕНО проверок: $failed\n" : "Все проверки пройдены\n");
exit($failed ? 1 : 0);
