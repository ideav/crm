<?php
# issue #5373: read-only вьюхи базы для внешнего SQL-клиента (include/ext_views.php).
# Сети и БД тут нет: проверяется план вьюх (имена, колонки, SQL) по метаданным-фикстуре.
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
function cols($sql){	# имена колонок вьюхи: всё, что стоит после AS `…`
	preg_match_all("/ AS `([^`]+)`/u", $sql, $m);
	return $m[1];
}

# ── Имена ────────────────────────────────────────────────────────────────────
ok(Ext_slug("Партия  сырья (шт.)") === "партия_сырья_шт", "slug: нижний регистр, мусор → «_», без «_» по краям");
foreach(array("a__b", "x - - y", "__", "Имя__Фамилия", "q_x") as $s)
	ok(strpos(Ext_slug($s), "__") === FALSE, "slug «".$s."» не содержит «__» — это разделитель частей имени");
ok(Ext_slug("!!!") === "x", "slug пустого имени — «x»");
$long = "t_".str_repeat("очень_длинное_имя_", 6);
$id = Ext_ident($long);
ok(mb_strlen($id, "UTF-8") === EXT_IDENT_MAX, "длинное имя укорочено до предела MySQL (64 символа)");
ok($id !== Ext_ident($long."2") && substr($id, -9, 1) === "_", "длинное имя — префикс + «_» + 8 символов md5 полного имени");
ok(Ext_ident("t_клиент") === "t_клиент", "короткое имя не меняется");
$taken = array();
ok(Ext_unique("t_a", $taken, 5) === "t_a" && Ext_unique("T_A", $taken, 7) === "T_A_7", "занятое имя (без учёта регистра) получает суффикс _<id>");
ok(Ext_grant_db("ext_my_db") === "`ext\\_my\\_db`", "в GRANT «_» имени базы экранирован — право на базу, а не на шаблон");

# ── План вьюх таблиц ─────────────────────────────────────────────────────────
function T($id, $name, $base, $reqs, $recs){
	return array("id" => $id, "name" => $name, "base" => $base, "has_reqs" => $reqs, "has_recs" => $recs);
}
function R($id, $kind, $name, $base, $extra = array()){
	return $extra + array("id" => $id, "kind" => $kind, "name" => $name, "base" => $base, "multi" => FALSE, "attrs" => "");
}
$types = array(18 => T(18, "Пользователь", "SHORT", TRUE, TRUE), 42 => T(42, "Роль", "SHORT", FALSE, TRUE)
	, 500 => T(500, "Тег", "SHORT", FALSE, TRUE), 600 => T(600, "Заказ", "DATE", TRUE, TRUE)
	, 700 => T(700, "Пустой", "SHORT", FALSE, FALSE), 701 => T(701, "Ключ", "PWD", FALSE, TRUE)
	, 702 => T(702, "Клиент", "SHORT", FALSE, TRUE), 703 => T(703, "клиент", "SHORT", FALSE, TRUE)
	, 704 => T(704, "Token", "SHORT", FALSE, TRUE));
$reqs = array(18 => array(
	R(20, "field", "Пароль", "PWD"), R(30, "field", "Телефон", "SHORT"), R(125, "field", "Token", "PWD")
	, R(126, "field", "xsrf", "SHORT"), R(130, "field", "Secret", "SHORT")
	, R(115, "ref", "Роль", "SHORT", array("target" => 42)), R(124, "field", "Activity", "DATETIME")
	, R(300, "field", "Retries", "NUMBER"), R(301, "field", "Активен", "BOOLEAN")
	, R(302, "ref", "Теги", "SHORT", array("target" => 500, "multi" => TRUE))
	, R(303, "child", "Заказы", "DATE", array("target" => 600))
	, R(304, "field", "ID", "SHORT"), R(305, "field", "Телефон", "SHORT")
	, R(306, "ref", "Пароль клиента", "PWD", array("target" => 701))));
$src = "`ideav`.`db`";
$views = Ext_plan_tables($types, $reqs, $src);
$names = array_map(function($v){ return $v["name"]; }, $views);

ok(view_by($views, "t_пользователь") !== NULL && view_by($views, "t_роль") !== NULL, "таблица с реквизитами и таблица-справочник с записями получают вьюху");
ok(!in_array("t_пустой", $names), "термин без реквизитов и без записей вьюхи не получает");
ok(!in_array("t_ключ", $names) && !in_array("t_token", $names), "термин с базой PWD или именем секрета вьюхи не получает");
ok(in_array("t_клиент", $names) && in_array("t_клиент_703", $names), "одноимённые таблицы различаются суффиксом _<id>");

$u = view_by($views, "t_пользователь");
$c = cols($u["sql"]);
ok(array_slice($c, 0, 4) === array("id", "parent_id", "ord", "пользователь"), "первые колонки: id, parent_id, ord, главное значение");
foreach(array("пароль", "token", "xsrf", "secret", "пароль_клиента") as $s)
	ok(!in_array($s, $c), "секрет «".$s."» колонкой не выводится");
ok(strpos($u["sql"], "f.t=20 ") === FALSE && strpos($u["sql"], "f.t=125 ") === FALSE, "значения PWD-реквизитов вьюха не читает вовсе");
ok(in_array("роль", $c) && in_array("роль_id", $c), "ссылка: имя цели и её id");
ok(strpos($u["sql"], "r.val='115'") !== FALSE && strpos($u["sql"], "a.t=42") !== FALSE, "ссылка ищется по строке val=<id реквизита> и только среди записей цели");
ok(in_array("заказы_count", $c) && strpos($u["sql"], "c.t=600") !== FALSE, "подчинённая таблица — колонка <имя>_count");
ok(!in_array("теги", $c), "множественная ссылка в плоскую вьюху не попадает");
ok(in_array("id_304", $c) && in_array("телефон_305", $c), "колонка не задваивает служебную и соседнюю — суффикс _<id реквизита>");
ok(count($c) === count(array_unique($c)), "имена колонок вьюхи уникальны");
ok(strpos($u["sql"], "FROM_UNIXTIME") !== FALSE && strpos($u["sql"], "CAST(f.val AS SIGNED)") !== FALSE, "DATETIME и NUMBER приведены к типам");
ok(strpos($u["sql"], "EXISTS(SELECT 1 FROM $src f WHERE f.up=v.id AND f.t=301") !== FALSE, "BOOLEAN — признак наличия непустого значения");
ok(strpos($u["sql"], "JOIN $src p ON p.id=v.up AND p.up!=0") !== FALSE, "строки-реквизиты (родитель — термин) записями не считаются");

$l = view_by($views, "t_пользователь__теги_list");
ok($l !== NULL && cols($l["sql"]) === array("parent_id", "item_id", "value", "ord"), "множественная ссылка — вьюха _list (parent_id, item_id, value, ord)");
ok($l !== NULL && strpos($l["sql"], "r.val='302'") !== FALSE && strpos($l["sql"], "o.t=18") !== FALSE, "_list берёт строки ссылки своего реквизита у записей своей таблицы");
$o = view_by($views, "t_заказ");
ok($o !== NULL && strpos($o["sql"], "STR_TO_DATE(v.val") !== FALSE, "главное значение приведено по базе термина (DATE)");

# ── Запросы ──────────────────────────────────────────────────────────────────
$errors = array();
$q = Ext_plan_reports(array(10 => "Заказы", 11 => "Сломанный", 12 => "заказы")
	, function($id){ if($id === 11) throw new Exception("boom"); return "SELECT $id AS x"; }, $errors);
ok(count($q) === 2 && $q[0]["name"] === "q_заказы" && $q[1]["name"] === "q_заказы_12", "вьюха Запроса — q_<имя>, одноимённые — с суффиксом");
ok(count($errors) === 1 && $errors[0]["object"] === 11 && $errors[0]["error"] === "boom", "ошибка одного Запроса уходит в errors и не роняет остальные");

echo $fails ? "\n$fails FAIL\n" : "\nALL OK\n";
exit($fails ? 1 : 0);
