<?php
# python2node#866: строки журнала, которые пишутся при завершении PHP (logRequest, записи
# кнопок-триггеров в BtRunDeferred), терялись на ideav.ru: PHP там работает как CGI, и в
# функциях register_shutdown_function текущий каталог уже не корень сайта, а LOGS_DIR был
# относительным. Каталог журнала обязан указывать в корень сайта при любом текущем каталоге.
#
# Определение LOGS_DIR берётся из index.php как есть и исполняется так, будто этот код стоит
# в index.php (__DIR__ — каталог index.php), после чего текущий каталог меняется на «/».
#
# Прогон: php experiments/logs-dir-absolute-866.test.php
# Отказ — только exit(1).

$root = realpath(__DIR__."/..");
$source = file_get_contents($root."/index.php");
if(!preg_match('/^define\("LOGS_DIR",[^;]*;/m', $source, $m)){
    echo "FAIL: LOGS_DIR definition not found in index.php\n";
    exit(1);
}
eval(str_replace("__DIR__", var_export($root, true), $m[0]));

$failures = 0;
function check($ok, $name){
    global $failures;
    echo ($ok ? "PASS: " : "FAIL: ").$name."\n";
    if(!$ok) $failures++;
}

$tmp = sys_get_temp_dir()."/logs-dir-866-".getmypid();
@mkdir($tmp);
chdir($tmp);
$file = LOGS_DIR."probe-866.jsonl";
$expected = $root.DIRECTORY_SEPARATOR."logs";
check(@file_put_contents($file, "{}\n") !== false && realpath(dirname($file)) === realpath($expected),
    "a log line written from another working directory lands in <site root>/logs");
@unlink($file);
@rmdir($tmp);

chdir("/");
check(realpath(dirname(LOGS_DIR."x")) === realpath($expected) || !is_dir($expected),
    "LOGS_DIR resolves to <site root>/logs from the filesystem root");

echo $failures ? "\nFAILED: $failures\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
