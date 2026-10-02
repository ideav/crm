<?php
# Тест выбора таблицы-якоря для ссылки в отчёте (issue #5058): блок # <ref-anchors-5058> в ядре.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/report-ref-anchor-5058.test.php
#
# Compile_Report() без БД не выполнить, поэтому здесь — refAnchors() на картах STORED_REPS,
# снятых с отчётов прода ateh (8384 cut_planning, 674405 gp_pack), и контрольные случаи.
# Сам отчёт на Apache + MariaDB проверяет experiments/report-ref-anchor-5058-e2e.sh.

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

$core = str_replace("\r\n", "\n", file_get_contents(__DIR__."/../index.php"));
if(!preg_match('~# <ref-anchors-5058>(.*)# </ref-anchors-5058>~s', $core, $m)){
    echo "FAIL В index.php не найден блок # <ref-anchors-5058> … # </ref-anchors-5058>\n";
    exit(1);
}
eval($m[1]);

# Карта отчёта так, как её заполняет Compile_Report():
#   types[колонка] = id реквизита (или таблицы для главной колонки);
#   references[таблица][цель] = реквизит-ссылка (по ВСЕМ ссылкам таблиц, чьи колонки в отчёте);
#   ref_typ[реквизит] = цель;  parents[реквизит] = таблица-владелец.
function rep($types, $refs){
    $GLOBALS["STORED_REPS"] = array("parents" => array());
    $r = array("types" => $types, "references" => array(), "ref_typ" => array());
    foreach($refs as $ref){
        list($owner, $req, $target) = $ref;
        $r["references"][$owner][$target] = $req;
        $r["ref_typ"][$req] = $target;
        $GLOBALS["STORED_REPS"]["parents"][$req] = $owner;
    }
    $GLOBALS["STORED_REPS"][1] = $r;
}

echo "1. 8384 cut_planning: втулку (8188) цепляем к позиции заказа, а не к партии сырья\n";
# Партия сырья 1074 → 52653 «Диаметр втулки», позиция 1076 → 8194 «Диаметр втулки»;
# в отчёте стоит cut_sleeve = 1076.8194, «Дюймы» = 8188.66225.
rep(array(10 => "1078", 11 => "8456", 12 => "8194", 13 => "66225"),
    array(array("1074", "52653", "8188"), array("1076", "8194", "8188")));
ok(refAnchors(1, "8188") === array("1076" => "8194"), "якорь 1076 через 8194",
   var_export(refAnchors(1, "8188"), TRUE));

echo "\n2. Нет неоднозначности — прежний порядок (FALSE)\n";
rep(array(10 => "1078", 12 => "8194", 13 => "66225"),
    array(array("1076", "8194", "8188")));
ok(refAnchors(1, "8188") === FALSE, "одна таблица ссылается на цель");
rep(array(10 => "1078", 13 => "66225"),
    array(array("1074", "52653", "8188"), array("1076", "8194", "8188")));
ok(refAnchors(1, "8188") === FALSE, "две ссылаются, но ссылочной колонки в отчёте нет");
ok(refAnchors(1, "9999") === FALSE, "на цель не ссылается никто");

echo "\n3. Контрольный отчёт: в отчёте втулка партии (52653) — якорь партия\n";
rep(array(10 => "1078", 11 => "52653", 13 => "66225"),
    array(array("1074", "52653", "8188"), array("1076", "8194", "8188")));
ok(refAnchors(1, "8188") === array("1074" => "52653"), "якорь 1074 через 52653");

echo "\n4. 674405 gp_pack: тип сырья берём у вида сырья позиции (1138), не задания (95358)\n";
rep(array(10 => "1078", 11 => "1081", 12 => "1076", 13 => "1138", 14 => "84633"),
    array(array("1078", "95358", "1069"), array("1076", "1138", "1069")));
ok(refAnchors(1, "1069") === array("1076" => "1138"), "якорь 1076 через 1138");

echo "\n5. Обе ссылочные колонки в отчёте — оба якоря в порядке колонок\n";
rep(array(10 => "1078", 11 => "8194", 12 => "52653", 13 => "66225"),
    array(array("1074", "52653", "8188"), array("1076", "8194", "8188")));
ok(refAnchors(1, "8188") === array("1076" => "8194", "1074" => "52653"), "1076, затем 1074",
   var_export(refAnchors(1, "8188"), TRUE));

echo "\n6. Две ссылки одной таблицы на цель в отчёте — берётся первая по колонкам\n";
rep(array(10 => "1078", 11 => "8194", 12 => "8195", 13 => "66225"),
    array(array("1074", "52653", "8188"), array("1076", "8194", "8188"), array("1076", "8195", "8188")));
ok(refAnchors(1, "8188") === array("1076" => "8194"), "1076 через 8194, не 8195");

echo "\n7. Якоря не меняют порядок перебора: остаётся порядок присоединения\n";
$tables = array("1078" => "", "1074" => " LEFT JOIN …", "1081" => " LEFT JOIN …", "1076" => " LEFT JOIN …");
ok(array_keys(array_intersect_key($tables, array("1076" => "8194", "1074" => "52653"))) == array("1074", "1076"),
   "array_intersect_key сохраняет порядок \$tables");

echo $failed ? "\nFAILED: $failed\n" : "\nALL OK\n";
exit($failed ? 1 : 0);
