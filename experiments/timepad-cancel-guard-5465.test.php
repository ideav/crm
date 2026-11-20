<?php
# Мерка к issue #5465: условие when триггеров отмены билета базы timepad.
# https://github.com/ideav/crm/issues/5465
#
# Гость создаёт запись «Отмена» с кодом билета; триггеры от пользователя claude зовут EXECUTE-запросы
# «Отменить билет» и «Освободить слот» с FR_code={Код билета}. Внешний фильтр ядра (Construct_WHERE)
# читает %, [..], !, <, >, @, IN(, REGEXP: как операторы: «TP%» отменил бы все билеты разом.
# Поэтому when пропускает только код вида TP + 8 знаков A–Z/0–9. Строка when — из fixture,
# в базе записана она же; вычисляет её настоящий вычислитель формул ядра (include/button_triggers.php).
#
# Запуск: php experiments/timepad-cancel-guard-5465.test.php

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
require __DIR__."/../include/field_attrs.php";
require __DIR__."/../include/button_triggers.php";

$fx = json_decode(file_get_contents(__DIR__."/timepad-cancel-guard-5465.fixture.json"), true);
$run = function($code) use ($fx){
    return BtTruthy(BtFormulaEval($fx["when"], array("fields" => array("Код билета" => $code))));
};
foreach($fx["accept"] as $code)
    expect($run($code) === true, "код билета принимается: $code");
foreach($fx["reject"] as $code)
    expect($run($code) === false, "отказ: ".json_encode($code, JSON_UNESCAPED_UNICODE));
# Нормализатор модификатора не должен менять условие при записи (_d_action)
$n = FieldAttrsNormalizeAction(array("type" => "query", "query" => "Отменить билет", "params" => "FR_code={Код билета}",
    "on" => array("CREATE"), "when" => $fx["when"], "user" => 463), $err);
expect(is_array($n) && $n["when"] === $fx["when"], "условие сохраняется в модификаторе без изменений");

if($failures){
    fwrite(STDERR, "FAILED: $failures\n");
    exit(1);
}
echo "OK\n";
