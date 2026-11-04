<?php
# issue #5373: вьюхи «по дате» для выгрузки в DWH за период (include/ext_views.php).
# Фильтр по колонке <поле>_raw вьюхи <таблица>__по_<поле> должен доходить до индекса t_val (t, val):
# ведущая строка вьюхи — значение поля, а сырое значение не обёрнуто функцией.
require __DIR__."/../include/field_attrs.php";
require __DIR__."/../include/ext_views.php";

$fails = 0;
function ok($cond, $name){
	global $fails;
	echo ($cond ? "ok" : "FAIL")." — $name\n";
	if(!$cond)
		$fails++;
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
function T($id, $name, $base = "SHORT"){
	return array("id" => $id, "name" => $name, "base" => $base, "has_reqs" => TRUE, "has_recs" => TRUE);
}
function R($id, $kind, $name, $extra = array()){
	return $extra + array("id" => $id, "kind" => $kind, "name" => $name, "base" => "SHORT", "multi" => FALSE, "attrs" => "");
}
# Заказ 700: Дата 701 (DATE), Создан 702 (DATETIME), Сумма 703, Даты 704 (DATE, множественный), Клиент 705 → 800
# Клиент 800: Рождение 801 (DATE); Смена 900 — таблица, главное значение которой — дата
$meta = array("types" => array(700 => T(700, "Заказ"), 800 => T(800, "Клиент"), 900 => T(900, "Смена", "DATE"))
	, "reqs" => array(700 => array(R(701, "field", "Дата", array("base" => "DATE")), R(702, "field", "Создан", array("base" => "DATETIME"))
			, R(703, "field", "Сумма", array("base" => "SIGNED")), R(704, "field", "Даты", array("base" => "DATE", "multi" => TRUE))
			, R(705, "ref", "Клиент", array("target" => 800)))
		, 800 => array(R(801, "field", "Рождение", array("base" => "DATE")))));
$src = "`ideav`.`db`";
function plan($grants){
	global $meta, $src;
	$errors = array();
	return Ext_plan_user($meta, array(), NULL, array("id" => 7, "name" => "dwh", "grants" => $grants), $src, $errors);
}
$all = plan(array(1 => "READ"));

$v = view_by($all, "dwh_заказ__по_дата");
ok($v !== NULL, "поле DATE таблицы даёт вьюху <таблица>__по_<поле>");
ok(view_by($all, "dwh_заказ__по_создан") !== NULL, "поле DATETIME тоже");
ok(view_by($all, "dwh_заказ__по_сумма") === NULL, "поле не-даты вьюхи по дате не даёт");
ok(view_by($all, "dwh_заказ__по_даты") === NULL, "множественное поле-дата вьюхи по дате не даёт");
$base = cols(view_by($all, "dwh_заказ")["sql"]);
$c = cols($v["sql"]);
ok(array_slice($c, 0, count($base)) === $base, "вьюха по дате — те же колонки, что у вьюхи таблицы");
ok(in_array("дата_raw", $c), "и сырое значение поля <поле>_raw");
# Сырое значение не обёрнуто функцией, ведущая строка — значение поля этого реквизита
ok(preg_match("/\bd\.val AS `дата_raw`/u", $v["sql"]) === 1 && preg_match("/FROM `ideav`.`db` d\b.*WHERE d\.t=701\b/su", $v["sql"]) === 1
	, "фильтр по <поле>_raw — условие на d.t и d.val (индекс t_val), а не подзапрос на запись");

ok(view_by(plan(array(700 => "READ", 701 => "BARRED")), "dwh_заказ__по_дата") === NULL, "закрытое ролью поле вьюхи по дате не даёт");
ok(view_by(plan(array(700 => "READ")), "dwh_клиент__по_рождение") === NULL
	, "справочник, видимый только по ссылке, вьюх по дате не даёт");
ok(view_by(plan(array(700 => "READ", 800 => "READ")), "dwh_клиент__по_рождение") !== NULL, "справочник с грантом — даёт");

$sm = view_by($all, "dwh_смена");
ok(in_array("смена_raw", cols($sm["sql"])) && preg_match("/\bv\.val AS `смена_raw`/u", $sm["sql"]) === 1
	, "у таблицы с главным значением-датой во вьюхе есть <таблица>_raw — сырое v.val (индекс t_val)");
ok(!in_array("заказ_raw", $base), "у таблицы с главным значением не-датой колонки _raw нет");

echo $fails ? "\n$fails FAIL\n" : "\nALL OK\n";
exit($fails ? 1 : 0);
