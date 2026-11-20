<?php
# ideav/courses#26: регистрация с лендинга курсов (ideav.ru/kurs/agents.html, кнопка «Стать агентом»
# ставит cookie ig_src) должна приходить в Telegram-чат заявок — так же, как заявки форм сайта.
#
# Мерка: настоящая regNotifyTelegram() из index.php в дочернем PHP-процессе, рядом — заглушки
# telegram-config.php и intake-shared.php (их на хосте выкладывает backlogram). Проверяем:
#   1) рядом нет файлов канала — ничего не отправляется и ничего не падает;
#   2) файлы есть — в очередь уходит одно сообщение без разметки: источник, почта, номер в my, aff, кампания;
#   3) доставка не удалась — сообщение остаётся в очереди (cleanup не зовётся), регистрация не падает.

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

$index = getenv("INDEX_PHP") ?: __DIR__."/../index.php";
try{
    $fn = extract_function_source(file_get_contents($index), "regNotifyTelegram");
}
catch(Exception $e){
    expect(false, "regNotifyTelegram есть в index.php (".$e->getMessage().")");
    exit(1);
}

function run_case($fn, $withChannel, $deliverOk, $args){
    $dir = sys_get_temp_dir()."/regnotify-".bin2hex(random_bytes(4));
    mkdir($dir);
    if($withChannel){
        file_put_contents("$dir/telegram-config.php", '<?php define("TELEGRAM_BOT_TOKEN", "t"); define("TELEGRAM_CHAT_ID", "1");');
        file_put_contents("$dir/intake-shared.php", '<?php
function intake_spool_dir(){ return "spool"; }
function intake_spool_save($spool, $msg, $att){ $GLOBALS["__log"][] = array("save", $spool, $msg, $att); return "spool/1"; }
function intake_spool_deliver($d){ $GLOBALS["__log"][] = array("deliver", $d); return '.($deliverOk ? 'true' : 'false').'; }
function intake_spool_cleanup($d){ $GLOBALS["__log"][] = array("cleanup", $d); }');
    }
    file_put_contents("$dir/child.php", "<?php\n".$fn."\n\$GLOBALS['__log'] = array();\n"
        ."regNotifyTelegram(".implode(", ", array_map('var_export_str', $args)).");\n"
        ."echo json_encode(\$GLOBALS['__log'], JSON_UNESCAPED_UNICODE);\n");
    $out = shell_exec(escapeshellarg(PHP_BINARY)." ".escapeshellarg("$dir/child.php")." 2>&1");
    foreach(glob("$dir/*") as $f) unlink($f);
    rmdir($dir);
    return array($out, json_decode((string)$out, true));
}
function var_export_str($v){ return var_export($v, true); }

# 1) нет канала рядом с ядром
list($out, $log) = run_case($fn, false, true, array("kurs-agents", "a@b.ru", 501, 77, ""));
expect(is_array($log) && count($log) === 0, "без telegram-config.php ничего не отправляется (вывод: ".trim((string)$out).")");

# 2) канал есть, доставка удалась
list($out, $log) = run_case($fn, true, true, array("kurs-agents", "a@b.ru", 501, 77, "123456", "utm_source=yandex&utm_campaign=agents\nX"));
$saves = is_array($log) ? array_values(array_filter($log, function($e){ return $e[0] === "save"; })) : array();
expect(count($saves) === 1, "в очередь уходит ровно одно сообщение (вывод: ".trim((string)$out).")");
$text = $saves ? $saves[0][2]["text"] : "";
expect($saves && $saves[0][2]["parse_mode"] === "", "сообщение без разметки (почта с _ и . не ломает MarkdownV2)");
expect(strpos($text, "регистрация агента") !== false, "в сообщении источник — регистрация агента с лендинга курсов");
expect(strpos($text, "a@b.ru") !== false, "в сообщении почта");
expect(preg_match('/my.*501/u', $text) === 1, "в сообщении номер в my (его агент ставит в ?aff=)");
expect(preg_match('/aff.*77/u', $text) === 1, "в сообщении пригласивший агент");
expect(strpos($text, "123456") !== false, "в сообщении кампания Директа");
expect(strpos($text, "Метки рекламы: utm_source=yandex&utm_campaign=agents X") !== false, "метки рекламы одной строкой: перевод строки из cookie не рвёт сообщение");
expect(is_array($log) && in_array(array("cleanup", "spool/1"), $log, true), "доставленное сообщение убирается из очереди");

# 3) канал есть, доставка не удалась — сообщение ждёт cron в очереди
list($out, $log) = run_case($fn, true, false, array("kurs-agents", "a@b.ru", 501, 0, ""));
expect(is_array($log) && !in_array(array("cleanup", "spool/1"), $log, true), "недоставленное сообщение остаётся в очереди (вывод: ".trim((string)$out).")");
$saves = is_array($log) ? array_values(array_filter($log, function($e){ return $e[0] === "save"; })) : array();
expect($saves && preg_match('/aff\): нет/u', $saves[0][2]["text"]) === 1, "без агента в сообщении «нет», а не 0");
expect($saves && strpos($saves[0][2]["text"], "Метки рекламы: нет") !== false, "без меток в сообщении «нет»");

echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
