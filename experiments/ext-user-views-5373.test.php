<?php
# issue #5373: SQL-доступ конкретного пользователя — вьюхи по правам его роли (include/ext_views.php).
# БД нет: план вьюх по метаданным-фикстуре и грантам роли в раскладке $GLOBALS["GRANTS"].
require __DIR__."/../include/field_attrs.php";
require __DIR__."/../include/ext_views.php";

$fails = 0;
function ok($cond, $name){
	global $fails;
	echo ($cond ? "ok" : "FAIL")." — $name\n";
	if(!$cond)
		$fails++;
}
function names($views){
	return array_map(function($v){ return $v["name"]; }, $views);
}
function view_by($views, $name){
	foreach($views as $v)
		if($v["name"] === $name)
			return $v;
	return NULL;
}
function cols($sql){
	preg_match_all("/ AS `([^`]+)`/u", $sql, $m);
	return $m[1];
}
function T($id, $name){
	return array("id" => $id, "name" => $name, "base" => "SHORT", "has_reqs" => TRUE, "has_recs" => TRUE);
}
function R($id, $kind, $name, $extra = array()){
	return $extra + array("id" => $id, "kind" => $kind, "name" => $name, "base" => "SHORT", "multi" => FALSE, "attrs" => "");
}
# Клиент (700): Телефон 701, Скидка 702, Менеджер → Сотрудник (703 ref 800), Договоры (704 child 900)
# Сотрудник (800) — справочник; Договор (900) подчинён Клиенту; Склад (1000) — независимая
# Отчёт (1100) — таблица с тем же именем, что Запрос 50 «Отчёт»
$meta = array("types" => array(700 => T(700, "Клиент"), 800 => T(800, "Сотрудник"), 900 => T(900, "Договор")
		, 1000 => T(1000, "Склад"), 1100 => T(1100, "Отчёт"))
	, "reqs" => array(700 => array(R(701, "field", "Телефон"), R(702, "field", "Скидка")
			, R(703, "ref", "Менеджер", array("target" => 800)), R(704, "child", "Договоры", array("target" => 900)))
		, 800 => array(R(801, "field", "Оклад")), 900 => array(R(901, "field", "Сумма")), 1100 => array(R(1101, "field", "Итог"))));
$src = "`ideav`.`db`";
$reports = array(50 => "Отчёт", 51 => "Закрытый", 52 => "Продажи");
$compile = function($id){ return "SELECT $id AS x"; };
function plan($grants, $taken = array()){
	global $meta, $reports, $compile, $src;
	$errors = array();
	return Ext_plan_user($meta, $reports, $compile, array("id" => 7, "name" => "Иван.Петров", "grants" => $grants), $src, $errors, $taken);
}

# ── Таблицы по правам роли ───────────────────────────────────────────────────
$g = array(700 => "READ", 702 => "BARRED", 50 => "READ", 52 => "WRITE", 51 => "BARRED");
$n = names(plan($g));
ok(in_array("иван_петров_клиент", $n), "имя вьюхи — <пользователь>_<таблица>");
ok(!in_array("иван_петров_склад", $n), "таблица без гранта роли вьюхи не получает");
ok(in_array("иван_петров_сотрудник", $n), "справочник, на который ссылается доступная таблица, виден (как Grant_1level)");
ok(cols(view_by(plan($g), "иван_петров_сотрудник")["sql"]) === array("id", "parent_id", "ord", "сотрудник")
	, "справочник, видимый только по ссылке, — id и главное значение, без реквизитов");
ok(in_array("оклад", cols(view_by(plan(array(700 => "READ", 800 => "READ")), "иван_петров_сотрудник")["sql"]))
	, "справочник с явным грантом — со всеми доступными реквизитами");
ok(in_array("иван_петров_договор", $n), "подчинённая таблица наследует уровень родителя");
$c = cols(view_by(plan($g), "иван_петров_клиент")["sql"]);
ok(in_array("телефон", $c) && !in_array("скидка", $c), "колонка с BARRED не выводится, остальные — по уровню таблицы");
ok(in_array("договоры_count", $c), "колонка подчинённой таблицы есть, когда подчинённая таблица доступна");

$n2 = names(plan(array(700 => "READ", 900 => "BARRED")));
ok(!in_array("иван_петров_договор", $n2), "явный BARRED на подчинённую таблицу закрывает её");
ok(!in_array("договоры_count", cols(view_by(plan(array(700 => "READ", 900 => "BARRED")), "иван_петров_клиент")["sql"]))
	, "колонка закрытой подчинённой таблицы не выводится");
ok(!in_array("иван_петров_договор", names(plan(array(700 => "READ", 704 => "BARRED"))))
	, "BARRED на реквизит-массив закрывает подчинённую таблицу");
ok(in_array("иван_петров_склад", names(plan(array(1 => "READ")))), "грант на корень открывает все таблицы");
ok(names(plan(array())) === array(), "роль без грантов не получает ни одной вьюхи");
ok(!in_array("иван_петров_клиент", names(plan(array(1 => "READ", 700 => "BARRED")))), "явный BARRED сильнее гранта на корень");

# ── Запросы ──────────────────────────────────────────────────────────────────
ok(in_array("иван_петров_отчёт", $n) && in_array("иван_петров_продажи", $n) && !in_array("иван_петров_закрытый", $n)
	, "Запросы — по гранту роли на запрос, имя <пользователь>_<запрос>");
$rep = view_by(plan(array(1 => "READ")), "иван_петров_отчёт");
ok($rep !== NULL && $rep["kind"] === "report", "таблица и Запрос с одним именем — вьюха Запроса");
ok(!in_array("иван_петров_отчёт_1100", names(plan(array(1 => "READ")))), "одноимённая таблица уступает имя и вьюхи не получает");
ok(in_array("иван_петров_продажи", names(plan(array(22 => "READ")))), "грант на таблицу Запросов (22) открывает запросы");
ok(names(plan(array(700 => "READ"))) === array("иван_петров_клиент", "иван_петров_сотрудник", "иван_петров_договор")
	, "без гранта на запрос, таблицу Запросов и корень запросов нет");

# ── Имена, занятые другими пользователями ───────────────────────────────────
ok(in_array("иван_петров_клиент_700", names(plan(array(700 => "READ"), array("иван_петров_клиент" => TRUE))))
	, "имя, занятое вьюхой другого пользователя, получает суффикс _<id>");
ok(Ext_user_login("ateh", 12345) === "ext_ateh_12345", "логин читателя — ext_<база>_<id пользователя>");

# ── Подключение через SSH-туннель ───────────────────────────────────────────
$ci = Ext_connection_info("ext_a_7", "p@ss", "ext_a", array("host" => "127.0.0.1", "port" => 3306
	, "ssh" => array("host" => "ideav.ru", "port" => 2222, "user" => "dbtunnel")));
ok($ci["connection"] === "mysql://ext_a_7:p%40ss@127.0.0.1:".EXT_TUNNEL_LOCAL_PORT."/ext_a", "через туннель клиент ходит на свой локальный порт");
ok($ci["ssh"]["command"] === "ssh -N -L ".EXT_TUNNEL_LOCAL_PORT.":127.0.0.1:3306 -p 2222 dbtunnel@ideav.ru", "команда туннеля ведёт на MySQL со стороны SSH-сервера");
$direct = Ext_connection_info("ext_a_7", NULL, "ext_a", array("host" => "db.local", "port" => 3307));
ok(!isset($direct["ssh"]) && $direct["connection"] === "mysql://ext_a_7:<password>@db.local:3307/ext_a" && !isset($direct["password"])
	, "без SSH — прямое подключение; пароль, который не меняли, не возвращается");

echo $fails ? "\n$fails FAIL\n" : "\nALL OK\n";
exit($fails ? 1 : 0);
