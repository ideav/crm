<?php
# Прогон issue #5242 на живом ядре (не входит в гейт: нужна база). Собирает мини-приложение
# «Договор → ссылка на Заявку, роль Юрист WRITE на Договор, READ на Заявку» одним _d_schema,
# повторяет вызов, пишет и читает записи по именам, проверяет старые вызовы.
#
# Запуск:
#   CORE=http://127.0.0.1:18242 DB=t5242 TOKEN=<ключ API админа базы> \
#     [ROLE_TOKEN=<ключ пользователя, которому дадут роль Юрист> ROLE_USER=<его логин>] \
#     php experiments/schema-json-5242-stand.php
# База должна быть пустой по этим именам (новая база из шаблона): прогон проверяет created>0.

$core = getenv("CORE"); $db = getenv("DB"); $token = getenv("TOKEN");
if(!$core || !$db || !$token){ fwrite(STDERR, "нужны CORE, DB, TOKEN\n"); exit(2); }
$failed = 0;
function ok($cond, $name, $info = ""){
	global $failed;
	echo ($cond ? "  ok   " : "  FAIL ").$name.(!$cond && $info !== "" ? " — $info" : "")."\n";
	if(!$cond) $failed++;
}
function call($method, $path, $body = NULL, $tok = NULL, $form = NULL){
	global $core, $db, $token;
	$tok = $tok ?: $token;
	$h = array("X-Authorization: $tok");
	$ch = curl_init();
	$url = "$core/$db/".implode("/", array_map(function($p){ return strpos($p, "?") === FALSE ? rawurlencode($p) : rawurlencode(strstr($p, "?", TRUE)).strstr($p, "?"); }, explode("/", $path)));
	if($method === "POST"){
		$x = json_decode(call("GET", "xsrf?JSON=1", NULL, $tok)[1], TRUE)["_xsrf"];
		if($form !== NULL)
			curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($form + array("_xsrf" => $x)));
		else{
			$h[] = "Content-Type: application/json";
			curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode((array)$body + array("_xsrf" => $x), JSON_UNESCAPED_UNICODE));
		}
	}
	curl_setopt_array($ch, array(CURLOPT_URL => $url, CURLOPT_RETURNTRANSFER => TRUE, CURLOPT_HTTPHEADER => $h, CURLOPT_TIMEOUT => 60));
	$out = curl_exec($ch);
	$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
	return array($code, $out, json_decode($out, TRUE));
}

$spec = array(
	"tables" => array(
		array("name" => "Заявка", "unique" => TRUE, "fields" => array(array("name" => "Сумма заявки", "type" => "SIGNED"))),
		array("name" => "Договор", "fields" => array(array("name" => "Заявка", "ref" => "Заявка", "required" => TRUE)
			, array("name" => "Сумма договора", "type" => "SIGNED")))),
	"reports" => array(array("name" => "Договоры", "columns" => array(
		array("name" => "Договор", "table" => "Договор"), array("name" => "Заявка", "table" => "Договор", "field" => "Заявка")
		, array("name" => "Сумма", "table" => "Договор", "field" => "Сумма договора")))),
	"roles" => array(array("name" => "Юрист", "grants" => array(
		array("table" => "Договор", "level" => "WRITE"), array("table" => "Заявка", "level" => "READ")
		, array("report" => "Договоры", "level" => "READ")))));

echo "── схема ──\n";
list($c, $raw, $r) = call("POST", "_d_schema?JSON", $spec);
ok($c === 200 && $r["ok"] === TRUE && $r["created"] > 0, "_d_schema создал схему", $raw);
list($c, $raw, $r2) = call("POST", "_d_schema?JSON", NULL, NULL, array("json" => json_encode($spec, JSON_UNESCAPED_UNICODE)));
ok($c === 200 && $r2["ok"] === TRUE && $r2["created"] === 0 && $r2["updated"] === 0, "повтор (полем формы json=) ничего не создал", $raw);
ok($r2["tables"]["Договор"]["fields"]["Заявка"] === $r["tables"]["Договор"]["fields"]["Заявка"], "повтор отдал те же id");
list($c, $raw, $m) = call("GET", "metadata/".$r["tables"]["Договор"]["id"]."?JSON=1");
$ref = array_values(array_filter($m["reqs"], function($q){ return isset($q["ref"]); }));
ok(count($ref) === 1 && (int)$ref[0]["ref"] === $r["tables"]["Заявка"]["id"], "metadata: Договор.Заявка — ссылка на Заявку", $raw);

echo "── термин с именем один ──\n";
list($c, $raw, $t1) = call("POST", "_d_schema?JSON", array("tables" => array(array("name" => "Договор", "fields" => array(array("name" => "Сумма заявки"))))));
list($c2, $raw2, $m1) = call("GET", "metadata/".$r["tables"]["Заявка"]["id"]."?JSON=1");
list($c3, $raw3, $m2) = call("GET", "metadata/".$r["tables"]["Договор"]["id"]."?JSON=1");
$orig = function($m, $name){ foreach($m["reqs"] as $q) if($q["val"] === $name) return $q["orig"]; return NULL; };
ok($c === 200 && $t1["ok"] === TRUE && $orig($m1, "Сумма заявки") !== NULL && $orig($m1, "Сумма заявки") === $orig($m2, "Сумма заявки")
	, "поле «Сумма заявки» Договора — тот же термин, что у Заявки (SIGNED, type не задан)", $raw);
list($c, $raw, $t2) = call("POST", "_d_schema?JSON", array("tables" => array(array("name" => "Сумма заявки", "type" => "DATE"))));
ok($c === 400 && strpos($t2["errors"][0], "уже есть с типом SIGNED") !== FALSE && strpos($t2["errors"][0], "запрошен DATE") !== FALSE
	, "тот же термин с другим типом — 400", $raw);

echo "── записи по именам ──\n";
list($c, $raw, $a) = call("POST", "_m_new/Заявка?JSON", array("up" => 1, "fields" => array("Заявка" => "З-1", "Сумма заявки" => 500)));
ok($c === 200 && $a["id"] > 0, "_m_new по именам (тело JSON)", $raw);
list($c, $raw, $b) = call("POST", "_m_batch?JSON", array("ops" => array(
	array("op" => "new", "id" => "Договор", "up" => 1, "fields" => array("Договор" => "Д-1", "Заявка" => "З-1", "Сумма договора" => 300)),
	array("op" => "set", "id" => ":id0", "fields" => array("Сумма договора" => 350)))));
ok($c === 200 && $b["ok"] === 2, "_m_batch: таблица и поля по именам, ссылка по значению", $raw);
$d1 = $b["results"][0]["id"];
list($c, $raw) = call("POST", "_m_set/$d1?JSON", NULL, NULL, array("fields" => json_encode(array("Сумма договора" => 360))));
ok($c === 200, "_m_set: fields= полем формы", $raw);
list($c, $raw, $rows) = call("GET", "object/Договор/?JSON_OBJ&NAMED&F_I=$d1");
ok($c === 200 && $rows[0]["Заявка"]["id"] === $a["id"] && $rows[0]["Сумма договора"] === "360.00", "чтение JSON_OBJ&NAMED", $raw);
list($c, $raw, $rows) = call("GET", "object/Заявка/?JSON_OBJ");
ok($c === 200 && count($rows) === 1 && $rows[0]["i"] === $a["id"], "object/Заявка/ (на неё есть ссылка, косая черта в конце) отдаёт записи", $raw);
list($c, $raw) = call("POST", "_m_set/$d1?JSON", array("fields" => array("Нет такого" => 1)));
ok($c === 400, "неизвестное имя поля — 400", $raw);
list($c, $raw, $old) = call("POST", "_m_set/$d1?JSON", NULL, NULL, array("t".$r["tables"]["Договор"]["fields"]["Сумма договора"] => "370"));
ok($c === 200 && (string)$old["obj"] === (string)$d1, "старый вызов t{id} работает", $raw);
list($c, $raw, $old) = call("GET", "object/".$r["tables"]["Договор"]["id"]."/?JSON_OBJ&F_I=$d1");
ok($c === 200 && $old[0]["r"][2] === "370.00", "старое чтение JSON_OBJ без изменений", $raw);
list($c, $raw, $rep) = call("GET", "report/Договоры?JSON_KV");
ok($c === 200 && is_array($rep) && $rep[0]["Сумма"] === "370.00", "отчёт из описания отвечает", $raw);

$rt = getenv("ROLE_TOKEN"); $ru = getenv("ROLE_USER");
if($rt && $ru){
	echo "── права роли ──\n";
	list($c, $raw, $u) = call("GET", "object/18/?JSON_OBJ&F_18=".rawurlencode($ru));
	list($c, $raw) = call("POST", "_m_set/".$u[0]["i"]."?JSON", array("fields" => array("Роль" => "Юрист")));
	ok($c === 200, "пользователю $ru дана роль Юрист по имени", $raw);
	list($c, $raw) = call("GET", "object/Заявка/?JSON_OBJ", NULL, $rt);
	ok($c === 200, "Юрист читает Заявки", $raw);
	list($c, $raw) = call("POST", "_m_set/".$a["id"]."?JSON", array("fields" => array("Сумма заявки" => 1)), $rt);
	ok($c === 403, "Юрист не пишет Заявки (403)", $c." ".$raw);
	list($c, $raw) = call("POST", "_m_set/$d1?JSON", array("fields" => array("Сумма договора" => 380)), $rt);
	ok($c === 200, "Юрист пишет Договоры", $raw);
	list($c, $raw) = call("GET", "report/Договоры?JSON_KV", NULL, $rt);
	ok($c === 200, "Юрист читает отчёт", $raw);
}
echo $failed ? "\nПРОВАЛЕНО: $failed\n" : "\nschema-json-5242-stand: всё прошло\n";
exit($failed ? 1 : 0);
