<?php
// Issue #5463: SET-запрос в реквизит, которого у записи ещё нет (ветка «A new record» блока
// Execute UPDATEs), резал текст по всему, что не буква/цифра/пробел, и вставлял каждый кусок
// отдельной строкой: e1@x.ru -> ru. Значение новой строки реквизита — одно, как подготовлено
// (для ссылки это id типа, сама ссылка — в t, мультиссылка раскладывается через tList).
// Исполняется настоящая ветка из index.php; БД — заглушки в своём неймспейсе (CI грузит mysqli).
// rules: none (defect #5463)
namespace Test5463;
// Заглушки не заполняют ref_typ для текстовых реквизитов — предупреждения ветки о ключах не по делу.
error_reporting(E_ALL & ~E_WARNING);

$ROWS = array();
$FLUSHED = 0;
function trace($s) {}
function Calc_Order($up, $t) { return 1; }
function Insert($up, $ord, $t, $val, $message) {
    $GLOBALS["ROWS"][] = array("up" => $up, "t" => $t, "val" => $val);
    return 9000 + count($GLOBALS["ROWS"]);
}
function Insert_batch($up, $ord, $t, $val, $message) {
    if ($up === "") { $GLOBALS["FLUSHED"]++; return; }
    $GLOBALS["ROWS"][] = array("up" => $up, "t" => $t, "val" => $val);
}

$src = file_get_contents(__DIR__ . "/../index.php");
$from = strpos($src, "if(isset(\$value[\"ord\"][\$n]))\t# A new record");
$to = $from === false ? false : strpos($src, "elseif(substr(\$fields[\$key],-4)===\".ord\")", $from);
if ($from === false || $to === false) { fwrite(STDERR, "ветка «A new record» не найдена в index.php\n"); exit(2); }
$branch = substr($src, $from, $to - $from);

// Один вызов ветки: новая строка реквизита типа $t под записью 501 со значением $val.
function runBranch($branch, $t, $val, $refTyp = array(), $tList = null) {
    $GLOBALS["ROWS"] = array();
    $GLOBALS["FLUSHED"] = 0;
    $GLOBALS["STORED_REPS"] = array(530 => array("ref_typ" => $refTyp));
    $id = 530; $key = 2; $n = 7;
    $names = array(2 => "c2");
    $blocks = array("_data_col" => array(530 => array("c2" => array(7 => ""))));
    $new_id_needed = array();
    $dsRefs = array(4242 => "Москва", 4243 => "Тверь");
    $value = array("ord" => array(7 => 1), "up" => array(7 => 501), "t" => array(7 => $t),
                   "val" => array(7 => $val), "new_id" => array(7 => 501));
    if ($tList !== null) $value["tList"] = array(7 => $tList);
    eval("namespace " . __NAMESPACE__ . ";\n" . $branch);
    return $GLOBALS["ROWS"];
}

$fail = 0;
function check($name, $rows, $want, &$fail) {
    $got = json_encode($rows, JSON_UNESCAPED_UNICODE);
    if ($got === json_encode($want, JSON_UNESCAPED_UNICODE) && $GLOBALS["FLUSHED"] > 0)
        echo "✔ $name\n";
    else { echo "✖ $name: записано $got, сброс пакета " . $GLOBALS["FLUSHED"] . "\n"; $fail = 1; }
}

// Текстовые реквизиты: значение целиком, одной строкой.
foreach (array("e1@x.ru", "anna@example.com", "+7 911 111-22-33", "Анна Смирнова", "1.5", "@@@") as $v)
    check("текст «" . $v . "» — одной строкой", runBranch($branch, 495, $v),
          array(array("up" => 501, "t" => 495, "val" => $v)), $fail);

// Ссылка: t = id записи справочника, val = id типа реквизита.
check("ссылка — одной строкой", runBranch($branch, 4242, "497", array(497 => 120)),
      array(array("up" => 501, "t" => 4242, "val" => "497")), $fail);

// Мультиссылка: первая ссылка — основной строкой, остальные из tList — соседними.
check("мультиссылка — строка на каждую ссылку", runBranch($branch, 4242, "497", array(497 => 120), array(4242, 4243)),
      array(array("up" => 501, "t" => 4242, "val" => "497"), array("up" => 501, "t" => 4243, "val" => "497")), $fail);

exit($fail);
