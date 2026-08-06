<?php
# Мерка к issue #4624: страница dir_admin переживает ядро, которое ещё не знает про сессии.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/dir-admin-template-4624.test.php
#
# Что здесь проверяется. Шаблоны едут на сервер сами (update.php по update.conf), index.php —
# отдельно и вручную. Значит шаблон какое-то время работает со СТАРЫМ ядром. Движок обрывает
# разбор блока на первой точке вставки, для которой ядро не дало значения (index.php,
# Parse_block: «Break the parsing upon first missing value»), а подблоки разбираются последними —
# поэтому одна незнакомая ядру переменная уносит с собой списки файлов и каталогов.
#
# Обращений к БД нет: движок берётся из ядра как есть, а данные подаёт заглушка Get_block_data —
# ровно тем же ключом (последний сегмент имени блока), что и настоящая.

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

# ── Движок берём ИЗ ЯДРА ───────────────────────────────────────────────────────────────────
# Копировать Make_tree/Parse_block в тест нельзя: мерка тогда сторожила бы копию. Границы
# функции ищем токенайзером, а не счётом скобок: в теле есть строки вида str_replace("{", …).
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

$coreFile = __DIR__."/../index.php";
$coreSrc  = file_get_contents($coreFile);
eval(core_function($coreSrc, "Make_tree").core_function($coreSrc, "Parse_block"));

# ── Окружение движка ───────────────────────────────────────────────────────────────────────
function trace($msg){}
function isApi(){ return FALSE; }
function BuiltIn($name){ return $name; }              # встроенных значений в мерке нет
function die_info($msg){ die("die_info: $msg\n"); }
function Get_file($name, $ui = TRUE){ return ""; }    # <!-- FILE: --> в dir_admin.html не используется

# Заглушка ядра: настоящая Get_block_data выбирает case по ПОСЛЕДНЕМУ сегменту имени блока
# (index.php: $block_name = array_pop(explode(".", $block))) — здесь так же.
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

# Страница dir_admin собирается ровно так же, как в ядре:
#   Make_tree(Get_file("dir_admin.html"), ""); die(Parse_block(""));
function render($template, $core){
    global $blocks;
    $blocks = array();
    $GLOBALS["FAKE_CORE"] = $core;
    $GLOBALS["GLOBAL_VARS"] = array("z" => "ateh", "xsrf" => "XSRF-TOKEN", "user" => "ateh");
    Make_tree($template, "");
    return Parse_block("");
}

# Шаблон, каким он был до фикса: секция сессий стоит прямо в &Dir_Admin.
function old_layout($tpl){
    if(!preg_match('~<!-- Begin:&Sessions -->(.*?)<!-- End:&Sessions -->~s', $tpl, $m))
        die("В шаблоне нет подблока &Sessions — мерка потеряла предмет\n");
    $inlined = str_replace(array("{_parent_.SESSIONS}", "{_parent_.FOLDER}", "{_parent_.ADD_PATH}"),
                           array("{SESSIONS}", "{FOLDER}", "{ADD_PATH}"), $m[1]);
    return str_replace($m[0], $inlined, $tpl);
}

# ── Данные ядра ────────────────────────────────────────────────────────────────────────────
# «Старое» ядро — до issue #4590: про сессии не знает вовсе.
$oldCore = array(
    "&dir_admin" => array("folder"   => array("templates"),
                          "another"  => array("download"),
                          "path"     => array("templates/custom/ateh"),
                          "add_path" => array(""),
                          "files"    => array(2),
                          "folders"  => array(1)),
    "&dir_list"  => array("name" => array("backups")),
    "&file_list" => array("name" => array("main.html", "production-planning.html"),
                          "size" => array("12.3 KB", "480 KB"),
                          "time" => array("06.08.2026 09:00:00", "06.08.2026 09:05:00")),
);

# «Новое» ядро — с issue #4590: счётчик сессий и строки списка.
$newCore = $oldCore;
$newCore["&dir_admin"]["sessions"] = array(2);
$newCore["&processlist"] = array("pid"      => array(4242, 4243),
                                 "time"     => array(300, 12),
                                 "state"    => array("Query executing", "Query sending data"),
                                 "sql"      => array("SELECT SLEEP(300)", "SELECT id FROM ateh"),
                                 "own"      => array("", "эта страница"),
                                 "disabled" => array("", "disabled"));

$tplFile   = __DIR__."/../templates/dir_admin.html";
$upsFile   = __DIR__."/../templates/upsound/dir_admin.html";
$tpl       = file_get_contents($tplFile);
$ups       = file_get_contents($upsFile);

echo "1. Старое ядро (про сессии не знает): страница цела, секция сессий просто не выводится\n";
$page = render($tpl, $oldCore);
ok(strpos($page, "production-planning.html") !== FALSE, "список файлов на месте");
ok(strpos($page, "backups") !== FALSE, "список каталогов на месте");
ok(strpos($page, "Файлов: 2, каталогов: 1") !== FALSE, "счётчики файлов и каталогов заполнены");
ok(strpos($page, "{_block_") === FALSE, "ни одной сырой точки вставки подблока");
ok(strpos($page, "{SESSIONS}") === FALSE && strpos($page, "{_parent_.SESSIONS}") === FALSE,
   "счётчик сессий не вылезает сырым");
ok(strpos($page, "Запросы к базе данных") === FALSE, "секция сессий скрыта целиком, а не наполовину");

echo "\n2. Новое ядро: секция сессий выводится\n";
$page = render($tpl, $newCore);
ok(strpos($page, "Запросы к базе данных") !== FALSE, "секция на месте");
ok(strpos($page, "Запросов выполняется: 2") !== FALSE, "счётчик взят у родителя через _parent_");
ok(strpos($page, "SELECT SLEEP(300)") !== FALSE, "строки списка сессий выведены");
ok(strpos($page, "эта страница") !== FALSE, "своя сессия помечена");
ok(strpos($page, "/ateh/dir_admin/?templates=1") !== FALSE, "форма секции знает каталог (_parent_.FOLDER)");
ok(strpos($page, "production-planning.html") !== FALSE, "список файлов не пострадал");
ok(strpos($page, "{_block_") === FALSE, "ни одной сырой точки вставки подблока");

echo "\n3. Механизм поломки (issue #4624): точка вставки ядра прямо в &Dir_Admin\n";
$old = old_layout($tpl);
$page = render($old, $oldCore);
ok(strpos($page, "production-planning.html") === FALSE, "старая раскладка + старое ядро: список файлов ПРОПАЛ");
ok(strpos($page, "Файлов: 2, каталогов: 1") === FALSE, "с ним пропало и всё остальное содержимое блока");
$page = render($old, $newCore);
ok(strpos($page, "production-planning.html") !== FALSE, "та же раскладка на новом ядре работает — поломка именно от рассинхрона");

echo "\n4. Оба шаблона правятся одинаково\n";
foreach(array($tplFile => $tpl, $upsFile => $ups) as $file => $text){
    $short = basename(dirname($file))."/".basename($file);
    ok(strpos($text, "<!-- Begin:&Sessions -->") !== FALSE && strpos($text, "<!-- End:&Sessions -->") !== FALSE,
       "$short: секция обёрнута в подблок &Sessions");
    ok(strpos($text, "{SESSIONS}") === FALSE, "$short: голой точки вставки SESSIONS не осталось");
    ok(strpos($text, "{_parent_.SESSIONS}") !== FALSE, "$short: счётчик берётся у родителя");
    ok(preg_match('~<!-- Begin:&Sessions -->.*\{_parent_\.SESSIONS}.*<!-- End:&Sessions -->~s', $text) === 1,
       "$short: счётчик стоит внутри подблока");
}

echo "\n5. Комментарии в шаблоне без фигурных скобок\n";
# Движок читает {ЧТО-УГОДНО} и в комментарии тоже: точка вставки внутри пояснения
# оборвала бы разбор ровно так же, как оборвал его {SESSIONS}.
foreach(array($tplFile => $tpl, $upsFile => $ups) as $file => $text){
    $short = basename(dirname($file))."/".basename($file);
    $bad = array();
    preg_match_all('~<!--(.*?)-->~s', $text, $comments);
    foreach($comments[1] as $c)
        if(!preg_match('~^\s*(begin|end|file)\s*:~i', $c) && preg_match('~\{[A-ZА-Я0-9_ \-]~ui', $c))
            $bad[] = trim(mb_substr($c, 0, 40));
    ok(count($bad) === 0, "$short: ни одного комментария с точкой вставки", implode(" | ", $bad));
}

echo "\n";
if($failed){
    echo "FAILED: $failed\n";
    exit(1);
}
echo "ALL TESTS PASSED\n";
