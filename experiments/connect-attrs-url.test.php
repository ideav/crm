<?php
/**
 * _connect — адрес «Коннектора» из настроек столбца типа CONNECT (226).
 *
 * `_connect/{id}` берёт `val` строки-описания столбца типа CONNECT в таблице {id}, а это настройки
 * столбца. `_d_attrs` сохраняет их как JSON: {"default":"<адрес>"}. Ядро подставляло `val` в адрес
 * как есть и отправляло curl на `{"default":"http://…"}?q=…`, поэтому настроить коннектор штатно
 * (интерфейс, API) было нельзя. Адрес — это значение по умолчанию столбца; старый формат, где
 * адрес записан как есть, по-прежнему работает.
 *
 * Прогон: php experiments/connect-attrs-url.test.php
 * В гейт заходит через experiments/connect-attrs-url.test.js, который запускает этот файл.
 */

require_once __DIR__ . "/../include/field_attrs.php";

$checks = 0;
$failed = array();

function same($expected, $actual, $message){
	global $checks, $failed;
	$checks++;
	if($expected !== $actual)
		$failed[] = $message." — ожидалось ".var_export($expected, true).", получено ".var_export($actual, true);
}

if(!function_exists("ConnectUrl")){
	echo "FAIL: нет функции ConnectUrl (include/field_attrs.php)\n";
	exit(1);
}

$emb = "http://104.128.137.21:8077/match?token=T0";

# То, что сохраняет _d_attrs (штатная настройка столбца), — рабочий адрес
same($emb."&q=abc", ConnectUrl(FieldAttrsBuild($emb), array("q" => "abc")), "настройки из _d_attrs: адрес из default");
same("http://h/api?a=1&b=2", ConnectUrl(FieldAttrsBuild("http://h/api"), array("a" => "1", "b" => "2")), "адрес без ?: параметры через ?");

# Старый формат: адрес записан в val как есть
same($emb."&q=abc", ConnectUrl($emb, array("q" => "abc")), "адрес как есть (старый формат)");

# Прочие настройки столбца не попадают в адрес
same($emb."&q=1", ConnectUrl(FieldAttrsBuild($emb, true, false, "Эмбеддер"), array("q" => "1")), "required/alias не мешают");

# Без параметров — прежнее поведение ядра (разделитель в конце)
same("http://h/api?", ConnectUrl(FieldAttrsBuild("http://h/api"), array()), "без параметров");

if($failed){
	foreach($failed as $f) echo "FAIL: $f\n";
	echo "ПРОВАЛЕНО ".count($failed)." из $checks\n";
	exit(1);
}
echo "OK: $checks проверок\n";
