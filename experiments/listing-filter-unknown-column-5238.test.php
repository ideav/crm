<?php
# Мерка к issue #5238: фильтр листинга таблицы по колонке, которой в таблице нет, не ставится.
# https://github.com/ideav/crm/issues/5238
#
# Запуск: php experiments/listing-filter-unknown-column-5238.test.php (в гейте — через одноимённый .test.js)
#
# Рабочее место передаёт в запрос свои параметры (FR_RoleID и т.п.) — они для отчётов рабочего
# места, а листинг /object/N собирал условия из ВСЕХ F_/FR_/TO_ запроса. Имя, не найденное среди
# реквизитов таблицы, уходило в SQL как есть: «aRoleID.t=RoleID» → Unknown column 'RoleID'.
# Функция из index.php берётся как есть; проверяется:
#   1) имя реквизита таблицы → его id;
#   2) имя самой таблицы → id таблицы;
#   3) id реквизита и id таблицы → как есть; U и I (родитель, id записи) → как есть;
#   4) имя, которого среди реквизитов нет (RoleID), — условия нет;
#   5) число, не являющееся реквизитом этой таблицы, — условия нет.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

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

$src = file_get_contents(__DIR__."/../index.php");
try { eval(extract_function_source($src, "Listing_filter_column")); }
catch(Exception $e){ echo "FAIL: в index.php нет функции Listing_filter_column\n"; exit(1); }

# Таблица пользователей 18: реквизиты «Роль» (115, ссылка) и «Email» (41); колонки RoleID нет.
$GLOBALS["REQNAMES"] = array("115" => "Роль", "41" => "Email");
$GLOBALS["GLOBAL_VARS"]["api"]["type"]["val"] = "Пользователь";
$id = 18;

expect(Listing_filter_column("Роль", $id) === "115", "имя реквизита → его id");
expect(Listing_filter_column("Email", $id) === "41", "имя реквизита Email → 41");
expect((string)Listing_filter_column("Пользователь", $id) === "18", "имя таблицы → id таблицы");
expect(Listing_filter_column("115", $id) === "115", "id реквизита → как есть");
expect(Listing_filter_column("18", $id) === "18", "id таблицы → как есть");
expect(Listing_filter_column("U", $id) === "U", "U (родитель) → как есть");
expect(Listing_filter_column("I", $id) === "I", "I (id записи) → как есть");
expect(Listing_filter_column("RoleID", $id) === FALSE, "RoleID — такой колонки нет, условия нет");
expect(Listing_filter_column("9999", $id) === FALSE, "id не из этой таблицы — условия нет");
expect(Listing_filter_column("", $id) === FALSE, "пустое имя — условия нет");

$GLOBALS["REQNAMES"] = NULL; # таблица без реквизитов
expect((string)Listing_filter_column("Пользователь", $id) === "18", "без реквизитов: имя таблицы → id");
expect(Listing_filter_column("RoleID", $id) === FALSE, "без реквизитов: чужое имя — условия нет");

if($failures){ echo "\n$failures FAIL\n"; exit(1); }
echo "\nOK\n";
