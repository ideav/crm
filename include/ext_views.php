<?php
# Read-only доступ к базе Интеграма по обычной строке подключения MySQL/MariaDB (issue #5373).
#
# Для пользователя базы <db> в схеме `ext_<db>` строятся настоящие VIEW по правам его роли:
#   <пользователь>_<таблица>                 — плоская вьюха таблицы: id, parent_id, ord, главное
#                                              значение и по колонке на каждый доступный реквизит;
#   <пользователь>_<таблица>__<реквизит>_list — строки множественного реквизита;
#   <пользователь>_<запрос>                  — вьюха Запроса, SQL движка отчётов от имени пользователя.
# Читатель — пользователь MySQL `ext_<db>_<id пользователя>` с SELECT/SHOW VIEW только на свои вьюхи:
# вьюхи работают правами создателя (SQL SECURITY DEFINER), таблица базы и чужие вьюхи ему закрыты.
# Значения базового типа PWD (пароли, токены) во вьюхи не попадают.

define("EXT_IDENT_MAX", 64);	# Предел длины имени объекта MySQL/MariaDB (в символах)
define("EXT_BASE_PWD", 6);
define("EXT_SECRET_NAMES", ":token:xsrf:secret:password:пароль:pwd:");

function Ext_base_names(){
	return array(3 => "SHORT", 8 => "CHARS", 9 => "DATE", 13 => "NUMBER", 14 => "SIGNED", 11 => "BOOLEAN"
		, 12 => "MEMO", 4 => "DATETIME", 10 => "FILE", 2 => "HTML", 7 => "BUTTON", 6 => "PWD", 5 => "GRANT"
		, 15 => "CALCULATABLE", 16 => "REPORT_COLUMN", 17 => "PATH");
}
# Имя в нижнем регистре, всё кроме букв и цифр → «_», подряд идущие «_» схлопываются.
# Поэтому «__» в имени вьюхи — только разделитель частей.
function Ext_slug($name){
	$s = mb_strtolower(trim((string)$name), "UTF-8");
	$s = preg_replace("/[^\p{L}\p{N}]+/u", "_", $s);
	$s = trim(preg_replace("/_+/", "_", $s), "_");
	return $s === "" ? "x" : $s;
}
# Длинное имя — префикс, «_» и 8 символов md5 полного имени.
function Ext_ident($name){
	if(mb_strlen($name, "UTF-8") <= EXT_IDENT_MAX)
		return $name;
	return mb_substr($name, 0, EXT_IDENT_MAX - 9, "UTF-8")."_".substr(md5($name), 0, 8);
}
# Свободное имя: занятое получает суффикс «_<id>».
function Ext_unique($name, &$taken, $suffix){
	$n = Ext_ident($name);
	if(isset($taken[mb_strtolower($n, "UTF-8")]))
		$n = Ext_ident($name."_".$suffix);
	$taken[mb_strtolower($n, "UTF-8")] = TRUE;
	return $n;
}
function Ext_qi($ident){
	return "`".str_replace("`", "``", $ident)."`";
}
function Ext_is_secret_name($name){
	return strpos(EXT_SECRET_NAMES, ":".mb_strtolower(trim((string)$name), "UTF-8").":") !== FALSE;
}
# Значение базы — текст (val MEDIUMTEXT). Колонка вьюхи получает тип по базовому типу реквизита;
# значение не по формату даёт NULL, а не ломает выборку.
function Ext_typed_expr($x, $base){
	switch($base){
		case "NUMBER":
			return "CASE WHEN $x REGEXP '^-?[0-9]+$' THEN CAST($x AS SIGNED) END";
		case "SIGNED":
			return "CASE WHEN $x REGEXP '^-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$' THEN CAST($x AS DECIMAL(38,10)) END";
		case "DATE":	# YYYYMMDD; длинное число — unix-время
			return "CASE WHEN $x REGEXP '^[0-9]{8}$' THEN STR_TO_DATE($x, '%Y%m%d')"
				." WHEN $x REGEXP '^[0-9]{9,}([.][0-9]+)?$' THEN DATE(FROM_UNIXTIME(CAST(FLOOR($x) AS UNSIGNED))) END";
		case "DATETIME":	# unix-секунды, бывают с дробной частью
			return "CASE WHEN $x REGEXP '^[0-9]+([.][0-9]+)?$' THEN FROM_UNIXTIME(CAST(FLOOR($x) AS UNSIGNED)) END";
		case "BOOLEAN":
			return "CASE WHEN $x IS NULL OR $x IN ('', '0') THEN 0 ELSE 1 END";
	}
	return $x;
}
function Ext_rows($conn, $sql){
	$res = mysqli_query($conn, $sql);
	if($res === FALSE)
		throw new Exception(mysqli_error($conn));
	$rows = array();
	while($row = mysqli_fetch_assoc($res))
		$rows[] = $row;
	return $rows;
}
# Метаданные базы: термины-таблицы и их реквизиты в той же раскладке, что Sj_type_reqs
# (include/schema_json.php): вид field / ref / child / link, базовый тип, цель ссылки, атрибуты.
function Ext_load_meta($conn, $src){
	$bases = Ext_base_names();
	$in = implode(",", array_keys($bases));
	$types = array();
	foreach(Ext_rows($conn, "SELECT t.id, t.val name, t.t base"
			.", EXISTS(SELECT 1 FROM $src q WHERE q.up=t.id AND q.t!=q.up) has_reqs"
			.", EXISTS(SELECT 1 FROM $src r JOIN $src p ON p.id=r.up AND p.up!=0 WHERE r.t=t.id AND r.up!=0) has_recs"
			." FROM $src t WHERE t.up=0 AND t.id!=t.t AND t.val!='' AND t.t IN ($in) ORDER BY t.id") as $row)
		$types[(int)$row["id"]] = array("id" => (int)$row["id"], "name" => $row["name"], "base" => $bases[(int)$row["base"]]
			, "has_reqs" => (bool)$row["has_reqs"], "has_recs" => (bool)$row["has_recs"]);
	$reqs = array();
	foreach(Ext_rows($conn, "SELECT req.up own, req.id, req.ord, req.t typ, req.val attrs, typ.t tbase, typ.val tname"
			.", ref.id ref, ref.val rname, ref.t rbase"
			.", EXISTS(SELECT 1 FROM $src ch WHERE ch.up=typ.id AND ch.t!=ch.up) arr"
			." FROM $src req JOIN $src own ON own.id=req.up AND own.up=0 JOIN $src typ ON typ.id=req.t"
			." LEFT JOIN $src ref ON ref.id=typ.t AND ref.t!=ref.id"
			." WHERE req.t!=req.up ORDER BY req.up, req.ord, req.id") as $row)
		$reqs[(int)$row["own"]][] = Ext_req($row, $bases);
	return array("types" => $types, "reqs" => $reqs);
}
function Ext_req($row, $bases){
	$r = array("id" => (int)$row["id"], "type" => (int)$row["typ"], "attrs" => (string)$row["attrs"], "multi" => FALSE);
	if((int)$row["typ"] === 1){
		$r["kind"] = "link";
		$r["base"] = "SHORT";
		$r["name"] = (string)$row["attrs"];
		return $r;
	}
	$alias = FieldAttrsAlias($r["attrs"], "");
	$r["multi"] = (bool)FieldAttrsHasMulti($r["attrs"]);
	if($row["ref"]){
		$r["kind"] = "ref";
		$r["target"] = (int)$row["ref"];
		$r["name"] = $alias !== "" ? $alias : (string)$row["rname"];
		$r["base"] = isset($bases[(int)$row["rbase"]]) ? $bases[(int)$row["rbase"]] : "";
	}
	else{
		$r["kind"] = $row["arr"] ? "child" : "field";
		$r["name"] = $alias !== "" ? $alias : (string)$row["tname"];
		$r["base"] = isset($bases[(int)$row["tbase"]]) ? $bases[(int)$row["tbase"]] : "";
		if($r["kind"] === "child")
			$r["target"] = (int)$row["typ"];
	}
	return $r;
}
# Вьюху получает термин-таблица: есть реквизиты или записи. Термин с базой PWD — нет.
function Ext_table_visible($type){
	return $type["base"] !== "PWD" && !Ext_is_secret_name($type["name"]) && ($type["has_reqs"] || $type["has_recs"]);
}
function Ext_req_secret($req){
	return $req["base"] === "PWD" || Ext_is_secret_name($req["name"]);
}
# ── Права роли ───────────────────────────────────────────────────────────────
# $grants — гранты роли в раскладке $GLOBALS["GRANTS"] (id объекта → READ / WRITE / BARRED),
# NULL — полный доступ (владелец базы). Уровень FALSE — объект роли не виден.
function Ext_readable($lev){
	return $lev === "READ" || $lev === "WRITE";
}
function Ext_grant_level($grants, $id){
	return Ext_readable($grants[$id]) ? $grants[$id] : FALSE;
}
# Связи таблиц: родитель подчинённой таблицы (с id реквизита-массива) и таблицы, ссылающиеся на цель.
function Ext_links($reqs){
	$parents = $refBy = array();
	foreach($reqs as $own => $list)
		foreach($list as $r)
			if($r["kind"] === "child")
				$parents[$r["target"]] = array($own, $r["id"]);
			elseif($r["kind"] === "ref")
				$refBy[$r["target"]][] = $own;
	return array("parents" => $parents, "refBy" => $refBy);
}
# Уровень таблицы, как его считает ядро (Grant_1level, Check_Grant): явный грант на таблицу;
# у подчинённой — грант на реквизит-массив, иначе уровень родителя; у независимой — грант на
# корень (1), иначе REF, если на неё ссылается таблица с явным грантом: такой справочник виден ради
# значений ссылок — только id и главное значение, без реквизитов и подчинённых. Явный BARRED закрывает.
function Ext_type_level($id, $grants, $links, &$memo = array()){
	if($grants === NULL)
		return "WRITE";
	if(array_key_exists($id, $memo))
		return $memo[$id];
	$memo[$id] = FALSE;	# цикл подчинения не зацикливает
	if(isset($grants[$id]))
		$lev = Ext_grant_level($grants, $id);
	elseif(isset($links["parents"][$id])){
		list($own, $arr) = $links["parents"][$id];
		$lev = isset($grants[$arr]) ? Ext_grant_level($grants, $arr) : Ext_type_level($own, $grants, $links, $memo);
		if($lev === "REF")
			$lev = FALSE;
	}
	elseif(isset($grants[1]) && Ext_readable($grants[1]))
		$lev = $grants[1];
	else{
		$lev = FALSE;
		foreach(isset($links["refBy"][$id]) ? $links["refBy"][$id] : array() as $own)
			if(isset($grants[$own]) && Ext_readable($grants[$own]))
				$lev = "REF";
	}
	return $memo[$id] = $lev;
}
# Колонка: явный грант на реквизит, иначе уровень таблицы.
function Ext_req_level($req, $tableLev, $grants){
	if($grants === NULL)
		return "WRITE";
	return isset($grants[$req["id"]]) ? Ext_grant_level($grants, $req["id"]) : $tableLev;
}
# Запрос: явный грант на запрос, иначе на таблицу Запросов (22), иначе на корень — как Check_Grant.
function Ext_report_level($id, $grants){
	if($grants === NULL)
		return "WRITE";
	foreach(array($id, 22, 1) as $k)
		if(isset($grants[$k]))
			return Ext_grant_level($grants, $k);
	return FALSE;
}
# Набор вьюх таблиц: array(array(name, kind, object, sql)). $src — таблица базы с именем схемы.
# $prefix — начало имени вьюхи; $grants — права роли (NULL — все таблицы); $taken — занятые имена;
# $reserved — имена вьюх Запросов: одноимённая таблица уступает имя запросу и вьюхи не получает.
function Ext_plan_tables($types, $reqs, $src, $prefix = "t_", $grants = NULL, &$taken = array(), $reserved = array()){
	$views = array();
	$links = Ext_links($reqs);
	$memo = array();
	foreach($types as $id => $type){
		if(!Ext_table_visible($type))
			continue;
		$tlev = Ext_type_level($id, $grants, $links, $memo);
		if(!$tlev)
			continue;
		if(isset($reserved[mb_strtolower(Ext_ident($prefix.Ext_slug($type["name"])), "UTF-8")]))
			continue;
		$vname = Ext_unique($prefix.Ext_slug($type["name"]), $taken, $id);
		$cols = array("id" => TRUE, "parent_id" => TRUE, "ord" => TRUE);
		$main = Ext_unique(Ext_slug($type["name"]), $cols, $id);
		$sel = array("v.id AS `id`", "v.up AS `parent_id`", "v.ord AS `ord`"
			, Ext_typed_expr("v.val", $type["base"])." AS ".Ext_qi($main));
		$lists = array();
		foreach(isset($reqs[$id]) && ($tlev !== "REF") ? $reqs[$id] : array() as $req){
			if(Ext_req_secret($req) || !Ext_req_level($req, $tlev, $grants))
				continue;
			$rid = $req["id"];
			if($req["kind"] === "child"){
				if(!Ext_type_level($req["target"], $grants, $links, $memo))
					continue;
				$c = Ext_unique(Ext_slug($req["name"])."_count", $cols, $rid);
				$sel[] = "(SELECT COUNT(*) FROM $src c WHERE c.up=v.id AND c.t=".$req["target"].") AS ".Ext_qi($c);
				continue;
			}
			if($req["multi"]){
				$lists[] = $req;
				continue;
			}
			$c = Ext_unique(Ext_slug($req["name"]), $cols, $rid);
			if($req["kind"] === "ref"){
				$from = "FROM $src r JOIN $src a ON a.id=r.t AND a.t=".$req["target"]
					." WHERE r.up=v.id AND r.val='$rid' ORDER BY r.ord, r.id LIMIT 1";
				$sel[] = "(SELECT a.val $from) AS ".Ext_qi($c);
				$cid = Ext_unique($c."_id", $cols, $rid);
				$sel[] = "(SELECT a.id $from) AS ".Ext_qi($cid);
			}
			elseif($req["base"] === "BOOLEAN")
				$sel[] = "EXISTS(SELECT 1 FROM $src f WHERE f.up=v.id AND f.t=$rid AND f.val NOT IN ('', '0')) AS ".Ext_qi($c);
			else
				$sel[] = "(SELECT ".Ext_typed_expr("f.val", $req["base"])." FROM $src f WHERE f.up=v.id AND f.t=$rid"
					." ORDER BY f.id LIMIT 1) AS ".Ext_qi($c);
		}
		$views[] = array("name" => $vname, "kind" => "table", "object" => $id
			, "sql" => "SELECT ".implode(",\n  ", $sel)."\nFROM $src v JOIN $src p ON p.id=v.up AND p.up!=0"
				."\nWHERE v.t=$id AND v.up!=0");
		foreach($lists as $req)
			$views[] = Ext_plan_list($vname, $id, $req, $src, $taken);
	}
	return $views;
}
function Ext_plan_list($vname, $typeId, $req, $src, &$taken){
	$rid = $req["id"];
	$name = Ext_unique($vname."__".Ext_slug($req["name"])."_list", $taken, $rid);
	if($req["kind"] === "ref")
		$sql = "SELECT r.up AS `parent_id`, a.id AS `item_id`, a.val AS `value`, r.ord AS `ord`"
			."\nFROM $src o JOIN $src r ON r.up=o.id AND r.val='$rid' JOIN $src a ON a.id=r.t AND a.t=".$req["target"]
			."\nWHERE o.t=$typeId AND o.up!=0";
	else
		$sql = "SELECT f.up AS `parent_id`, f.id AS `item_id`, ".Ext_typed_expr("f.val", $req["base"])." AS `value`, f.ord AS `ord`"
			."\nFROM $src o JOIN $src f ON f.up=o.id AND f.t=$rid"
			."\nWHERE o.t=$typeId AND o.up!=0";
	return array("name" => $name, "kind" => "list", "object" => $rid, "sql" => $sql);
}
# Вьюхи Запросов: $reports — array(id => имя), $compile($id) отдаёт SELECT движка отчётов или
# бросает исключение (такой запрос во вьюху не переносится, причина — в errors).
function Ext_plan_reports($reports, $compile, &$errors, $prefix = "q_", &$taken = array()){
	$views = array();
	foreach($reports as $id => $name){
		$vname = Ext_unique($prefix.Ext_slug($name), $taken, $id);
		try{
			$sql = $compile($id);
		}
		catch(Exception $e){
			$errors[] = array("view" => $vname, "object" => $id, "error" => $e->getMessage());
			continue;
		}
		$views[] = array("name" => $vname, "kind" => "report", "object" => $id, "sql" => $sql);
	}
	return $views;
}
function Ext_exec($conn, $sql){
	if(mysqli_query($conn, $sql) === FALSE)
		throw new Exception(mysqli_error($conn), mysqli_errno($conn));
}
function Ext_schema_name($z){
	return "ext_".$z;
}
# Реестр ядра — схема ext__registry (имя базы начинается с буквы, поэтому с ext_<db> не совпадает;
# читателям она не выдаётся): readers — учётки-читатели, views — чья вьюха в схеме ext_<db>.
define("EXT_REGISTRY", "`ext__registry`.`readers`");
define("EXT_REGISTRY_VIEWS", "`ext__registry`.`views`");
function Ext_registry($conn){
	Ext_exec($conn, "CREATE DATABASE IF NOT EXISTS `ext__registry` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
	Ext_exec($conn, "CREATE TABLE IF NOT EXISTS ".EXT_REGISTRY." (login VARCHAR(80) NOT NULL PRIMARY KEY"
		.", db VARCHAR(64) NOT NULL, user_id BIGINT NOT NULL DEFAULT 0, user_name VARCHAR(255) NOT NULL DEFAULT ''"
		.", created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY (db))");
	Ext_exec($conn, "CREATE TABLE IF NOT EXISTS ".EXT_REGISTRY_VIEWS." (db VARCHAR(64) NOT NULL, view VARCHAR(64) NOT NULL"
		.", login VARCHAR(80) NOT NULL, PRIMARY KEY (db, view), KEY (login))");
}
# В GRANT на базу имя базы — шаблон: «_» и «%» экранируются, иначе право выдаётся на шаблон.
function Ext_grant_db($schema){
	return Ext_qi(addcslashes($schema, "_%"));
}
function Ext_esc($conn, $s){
	return "'".mysqli_real_escape_string($conn, (string)$s)."'";
}
function Ext_user_login($z, $userId){
	return "ext_".$z."_".(int)$userId;
}
function Ext_check_db($z){
	if(!preg_match("/^[A-Za-z0-9_]+$/", $z))
		throw new Exception("Bad database name");
	if(strlen(Ext_user_login($z, 0)) > 22)	# логин читателя — до 32 символов (MySQL 8)
		throw new Exception("Database name is too long");
	return Ext_schema_name($z);
}
# Вьюхи пользователя: сначала Запросы (одноимённая таблица уступает им имя), затем таблицы.
# $user — id, name, grants (NULL — полный доступ); $reports — array(id => имя);
# $taken — имена, занятые вьюхами других пользователей.
function Ext_plan_user($meta, $reports, $compile, $user, $src, &$errors, $taken = array()){
	$prefix = Ext_slug($user["name"])."_";
	$granted = array();
	foreach($reports as $id => $name)
		if(Ext_report_level($id, $user["grants"]))
			$granted[$id] = $name;
	$views = $compile ? Ext_plan_reports($granted, $compile, $errors, $prefix, $taken) : array();
	$reserved = array();
	foreach($views as $v)
		$reserved[mb_strtolower($v["name"], "UTF-8")] = TRUE;
	foreach($errors as $e)
		$reserved[mb_strtolower($e["view"], "UTF-8")] = TRUE;
	return array_merge($views, Ext_plan_tables($meta["types"], $meta["reqs"], $src, $prefix, $user["grants"], $taken, $reserved));
}
# Пересборка вьюх пользователя $user базы $z и его читателя. $opts:
#   compile  — function($reportId): SQL Запроса от имени пользователя (без него Запросов нет);
#   password — задать/сменить пароль читателя (иначе у нового генерируется, у прежнего не трогается);
#   reader_host — хост учётки MySQL (по умолчанию '%'); host, port, ssh — адрес для подключения.
# Ошибка одной вьюхи пересборку не роняет: прежняя вьюха остаётся, причина — в errors.
function Ext_rebuild_user($conn, $z, $user, $opts = array()){
	$schema = Ext_check_db($z);
	$app = Ext_rows($conn, "SELECT DATABASE() db");
	$src = Ext_qi($app[0]["db"]).".".Ext_qi($z);
	$login = Ext_user_login($z, $user["id"]);
	Ext_registry($conn);
	$mine = $taken = array();
	foreach(Ext_rows($conn, "SELECT view, login FROM ".EXT_REGISTRY_VIEWS." WHERE db=".Ext_esc($conn, $schema)) as $row)
		if($row["login"] === $login)
			$mine[$row["view"]] = TRUE;
		else
			$taken[mb_strtolower($row["view"], "UTF-8")] = TRUE;
	$errors = array();
	$reports = array();
	if(isset($opts["compile"]))
		foreach(Ext_rows($conn, "SELECT id, val FROM $src WHERE t=22 AND up!=0 AND val!='' ORDER BY id") as $row)
			$reports[(int)$row["id"]] = $row["val"];
	$views = Ext_plan_user(Ext_load_meta($conn, $src), $reports, isset($opts["compile"]) ? $opts["compile"] : NULL
		, $user, $src, $errors, $taken);
	$res = Ext_reader($conn, $schema, $login, $user, $opts);
	$acct = Ext_account($conn, $login, $opts);
	Ext_exec($conn, "CREATE DATABASE IF NOT EXISTS ".Ext_qi($schema)." CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
	$keep = $rebuilt = array();
	foreach($views as $v){
		$keep[$v["name"]] = TRUE;
		$full = Ext_qi($schema).".".Ext_qi($v["name"]);
		try{
			Ext_exec($conn, "CREATE OR REPLACE SQL SECURITY DEFINER VIEW $full AS\n".$v["sql"]);
			Ext_exec($conn, "REPLACE INTO ".EXT_REGISTRY_VIEWS." (db, view, login) VALUES (".Ext_esc($conn, $schema)
				.", ".Ext_esc($conn, $v["name"]).", ".Ext_esc($conn, $login).")");
			Ext_exec($conn, "GRANT SELECT, SHOW VIEW ON $full TO $acct");
			$rebuilt[] = $v["name"];
		}
		catch(Exception $e){
			$errors[] = array("view" => $v["name"], "object" => $v["object"], "error" => $e->getMessage());
		}
	}
	foreach($errors as $e)
		$keep[$e["view"]] = TRUE;
	$dropped = array();
	foreach(array_keys($mine) as $name)
		if(!isset($keep[$name])){
			Ext_drop_view($conn, $schema, $name, $acct);
			$dropped[] = $name;
		}
	return array("schema" => $schema, "user" => $user["name"], "rebuilt" => $rebuilt, "dropped" => $dropped
		, "errors" => $errors) + $res;
}
function Ext_account($conn, $login, $opts){
	$host = isset($opts["reader_host"]) && $opts["reader_host"] !== "" ? $opts["reader_host"] : "%";
	return Ext_esc($conn, $login)."@".Ext_esc($conn, $host);
}
# Снять право и удалить вьюху. Право на таблицу при DROP VIEW не исчезает и перешло бы к
# одноимённой вьюхе другого пользователя — поэтому сначала REVOKE.
function Ext_drop_view($conn, $schema, $name, $acct){
	$full = Ext_qi($schema).".".Ext_qi($name);
	if(mysqli_query($conn, "REVOKE SELECT, SHOW VIEW ON $full FROM $acct") === FALSE
			&& !in_array(mysqli_errno($conn), array(1141, 1147, 1403), TRUE))	# права уже нет
		throw new Exception(mysqli_error($conn), mysqli_errno($conn));
	Ext_exec($conn, "DROP VIEW IF EXISTS $full");
	Ext_exec($conn, "DELETE FROM ".EXT_REGISTRY_VIEWS." WHERE db=".Ext_esc($conn, $schema)." AND view=".Ext_esc($conn, $name));
}
# Учётка-читатель пользователя. Ядро меняет лишь свою учётку — записанную в реестре за этой
# базой и этим пользователем; чужая одноимённая учётка — ошибка 409.
function Ext_reader($conn, $schema, $login, $user, $opts){
	$acct = Ext_account($conn, $login, $opts);
	$me = Ext_rows($conn, "SELECT CURRENT_USER() u");
	if(strtolower(preg_replace("/@.*$/", "", $me[0]["u"])) === strtolower($login))
		throw new Exception("Reader login $login is the application user", 409);
	$password = isset($opts["password"]) && $opts["password"] !== "" ? (string)$opts["password"] : NULL;
	$reg = "REPLACE INTO ".EXT_REGISTRY." (login, db, user_id, user_name) VALUES (".Ext_esc($conn, $login)
		.", ".Ext_esc($conn, $schema).", ".(int)$user["id"].", ".Ext_esc($conn, $user["name"]).")";
	# Новая учётка сразу с паролем: без него она хоть миг была бы открыта
	$initial = $password !== NULL ? $password : bin2hex(random_bytes(12));
	if(mysqli_query($conn, "CREATE USER $acct IDENTIFIED BY ".Ext_esc($conn, $initial)) !== FALSE)
		$password = $initial;
	else{
		if(mysqli_errno($conn) !== 1396)	# 1396 — учётка уже есть
			throw new Exception(mysqli_error($conn), mysqli_errno($conn));
		if(!count(Ext_rows($conn, "SELECT 1 FROM ".EXT_REGISTRY." WHERE login=".Ext_esc($conn, $login)
				." AND db=".Ext_esc($conn, $schema))))
			throw new Exception("MySQL user $login exists and was not created by Integram", 409);
		if($password !== NULL)
			Ext_exec($conn, "ALTER USER $acct IDENTIFIED BY ".Ext_esc($conn, $password));
	}
	Ext_exec($conn, $reg);
	return array("login" => $login) + Ext_connection_info($login, $password, $schema, $opts);
}
# Как подключиться. С SSH-туннелем (ssh_host задан) клиент ходит на свой 127.0.0.1:<local_port>,
# а туннель ведёт на сервер MySQL host:port, как его видит SSH-сервер. Без туннеля — напрямую.
define("EXT_TUNNEL_LOCAL_PORT", 13306);
function Ext_connection_info($login, $password, $schema, $opts){
	$host = isset($opts["host"]) && $opts["host"] !== "" ? $opts["host"] : "localhost";
	$port = isset($opts["port"]) ? (int)$opts["port"] : 3306;
	$pw = $password !== NULL ? rawurlencode($password) : "<password>";
	$res = array();
	if(isset($opts["ssh"]["host"]) && $opts["ssh"]["host"] !== ""){
		$s = $opts["ssh"];
		$sport = isset($s["port"]) ? (int)$s["port"] : 22;
		$suser = isset($s["user"]) && $s["user"] !== "" ? $s["user"] : "dbtunnel";
		$local = EXT_TUNNEL_LOCAL_PORT;
		$res["ssh"] = array("host" => $s["host"], "port" => $sport, "user" => $suser
			, "db_host" => $host, "db_port" => $port, "local_port" => $local
			, "command" => "ssh -N -L $local:$host:$port -p $sport $suser@".$s["host"]);
		$res["connection"] = "mysql://$login:$pw@127.0.0.1:$local/$schema";
	}
	else
		$res["connection"] = "mysql://$login:$pw@$host:$port/$schema";
	if($password !== NULL)
		$res["password"] = $password;
	return $res;
}
# Отозвать доступ пользователя: его вьюхи и учётка удаляются (DROP USER снимает и все права).
function Ext_revoke_user($conn, $z, $userId, $opts = array()){
	$schema = Ext_check_db($z);
	$login = Ext_user_login($z, $userId);
	Ext_registry($conn);
	if(!count(Ext_rows($conn, "SELECT 1 FROM ".EXT_REGISTRY." WHERE login=".Ext_esc($conn, $login)." AND db=".Ext_esc($conn, $schema))))
		throw new Exception("No SQL access for this user", 404);
	$acct = Ext_account($conn, $login, $opts);
	$dropped = array();
	foreach(Ext_rows($conn, "SELECT view FROM ".EXT_REGISTRY_VIEWS." WHERE db=".Ext_esc($conn, $schema)
			." AND login=".Ext_esc($conn, $login)) as $row){
		Ext_drop_view($conn, $schema, $row["view"], $acct);
		$dropped[] = $row["view"];
	}
	Ext_exec($conn, "DROP USER IF EXISTS $acct");
	Ext_exec($conn, "DELETE FROM ".EXT_REGISTRY." WHERE login=".Ext_esc($conn, $login));
	return array("schema" => $schema, "login" => $login, "dropped" => $dropped);
}
# Кому выдан доступ к базе: читатели и число их вьюх.
function Ext_list_readers($conn, $z){
	$schema = Ext_check_db($z);
	Ext_registry($conn);
	$out = array();
	foreach(Ext_rows($conn, "SELECT r.login, r.user_id, r.user_name, r.created, COUNT(v.view) views FROM ".EXT_REGISTRY." r"
			." LEFT JOIN ".EXT_REGISTRY_VIEWS." v ON v.db=r.db AND v.login=r.login"
			." WHERE r.db=".Ext_esc($conn, $schema)." GROUP BY r.login, r.user_id, r.user_name, r.created ORDER BY r.user_name") as $row)
		$out[] = array("login" => $row["login"], "user_id" => (int)$row["user_id"], "user" => $row["user_name"]
			, "created" => $row["created"], "views" => (int)$row["views"]);
	return array("schema" => $schema, "readers" => $out);
}
# SQL Запроса из движка отчётов (Compile_Report) без выполнения и без параметров запроса.
# Запрос, которому нужен id объекта из адреса (%..._OBJ_ID%), во вьюху не переносится.
function Ext_core_report_sql($id){
	$request = $_REQUEST;
	$_REQUEST = array();
	$GLOBALS["EXT_SQL_ONLY"] = TRUE;
	unset($GLOBALS["STORED_REPS"][$id]);
	ob_start();	# предупреждения движка отчётов не должны попасть в JSON-ответ
	try{
		Compile_Report($id, "ext$id", TRUE, FALSE, TRUE);
	}
	finally{
		ob_end_clean();
		unset($GLOBALS["EXT_SQL_ONLY"]);
		$_REQUEST = $request;
	}
	$sql = isset($GLOBALS["STORED_REPS"][$id]["sql"]) ? trim($GLOBALS["STORED_REPS"][$id]["sql"]) : "";
	unset($GLOBALS["STORED_REPS"][$id]);
	if($sql === "")
		throw new Exception("Empty report SQL");
	if(preg_match("/%\w+_OBJ_ID%/", $sql, $m))
		throw new Exception("Report needs an object id from the request: ".$m[0]);
	return $sql;
}
# Пользователь базы для BtAsUser: id, логин, роль. Токен и xsrf ему не выдаются.
function Ext_core_user($id){
	global $z;
	$row = mysqli_fetch_array(Exec_sql("SELECT u.id, u.val, role_def.id r, role_def.val role FROM $z u"
		." LEFT JOIN ($z r CROSS JOIN $z role_def) ON r.up=u.id AND role_def.id=r.t AND role_def.t=".ROLE
		." WHERE u.t=".USER." AND u.id=".(int)$id." LIMIT 1", "Ext: user"));
	if(!$row)
		my_die(t9n("[RU]Пользователь не найден[EN]User not found"), "404 Not Found");
	if(!$row["r"])
		my_die(t9n("[RU]У пользователя «".$row["val"]."» нет роли[EN]User '".$row["val"]."' has no role"));
	return array("user" => strtolower($row["val"]), "user_id" => (int)$row["id"], "role" => strtolower((string)$row["role"])
		, "role_id" => $row["r"], "token" => "", "xsrf" => "", "grants" => TRUE, "name" => $row["val"]);
}
# Пользователи базы с ролями — для выбора во вкладке dir_admin.
function Ext_core_users(){
	global $z;
	$out = array();
	$res = Exec_sql("SELECT u.id, u.val, role_def.val role FROM $z u"
		." LEFT JOIN ($z r CROSS JOIN $z role_def) ON r.up=u.id AND role_def.id=r.t AND role_def.t=".ROLE
		." WHERE u.t=".USER." AND u.up=1 ORDER BY u.val", "Ext: users");
	while($row = mysqli_fetch_array($res))
		$out[] = array("id" => (int)$row["id"], "name" => $row["val"], "role" => (string)$row["role"]);
	return $out;
}
# Гранты роли — только уровни объектов (маски, экспорт, удаление не нужны).
function Ext_core_grants(){
	$g = array();
	foreach(isset($GLOBALS["GRANTS"]) ? $GLOBALS["GRANTS"] : array() as $k => $v)
		if(is_numeric($k) && is_string($v))
			$g[(int)$k] = $v;
	return $g;
}
# Действие из ядра: rebuild (по умолчанию) | revoke | list. DDL идёт отдельной учёткой
# INTEGRAM_EXT_ADMIN_USER/_PASSWORD, если задана, иначе соединением приложения.
# Адрес MySQL в строке подключения — INTEGRAM_EXT_DB_HOST/_PORT (по умолчанию адрес сервера БД),
# хост учётки-читателя — INTEGRAM_EXT_READER_HOST ('%'), SSH-туннель — INTEGRAM_EXT_SSH_HOST/_PORT/_USER.
function Ext_core_action($action, $userId, $password){
	global $z, $connection;
	$db = isset($GLOBALS["DB_CONN"]) && is_array($GLOBALS["DB_CONN"]) ? $GLOBALS["DB_CONN"] : array();
	if(empty($db["name"])){	# connection.php без реквизитов (DB_CONN): база — текущая база соединения приложения
		$row = mysqli_fetch_row(mysqli_query($connection, "SELECT DATABASE()"));
		$db["name"] = $row[0];
	}
	$db += array("host" => "localhost", "port" => 3306);
	$conn = $connection;
	$admin = integram_env("INTEGRAM_EXT_ADMIN_USER", "");
	if($admin !== ""){
		$conn = mysqli_init();
		if(!@mysqli_real_connect($conn, $db["host"], $admin, integram_env("INTEGRAM_EXT_ADMIN_PASSWORD", ""), $db["name"], $db["port"]))
			my_die("Ext: cannot connect as $admin");
		$conn->set_charset("utf8mb4");
	}
	$opts = array("password" => is_string($password) ? $password : ""
		, "reader_host" => integram_env("INTEGRAM_EXT_READER_HOST", "%")
		, "host" => integram_env("INTEGRAM_EXT_DB_HOST", $db["host"])
		, "port" => (int)integram_env("INTEGRAM_EXT_DB_PORT", (string)$db["port"])
		, "ssh" => array("host" => integram_env("INTEGRAM_EXT_SSH_HOST", ""), "port" => (int)integram_env("INTEGRAM_EXT_SSH_PORT", "22")
			, "user" => integram_env("INTEGRAM_EXT_SSH_USER", "dbtunnel")));
	try{
		if($action === "list"){
			$ci = Ext_connection_info("<login>", NULL, Ext_schema_name($z), $opts);
			return Ext_list_readers($conn, $z) + array("users" => Ext_core_users()
				, "ssh" => isset($ci["ssh"]) ? $ci["ssh"] : NULL, "connection" => $ci["connection"]);
		}
		if($action === "revoke")
			return Ext_revoke_user($conn, $z, (int)$userId, $opts);
		$u = Ext_core_user($userId);
		return BtAsUser($u, function() use($conn, $z, $u, $opts){
			$grants = $u["user"] === strtolower($z) ? NULL : Ext_core_grants();	# владелец базы видит всё
			return Ext_rebuild_user($conn, $z, array("id" => $u["user_id"], "name" => $u["name"], "grants" => $grants)
				, $opts + array("compile" => "Ext_core_report_sql"));
		});
	}
	catch(Exception $e){
		if(in_array($e->getCode(), array(404, 409), TRUE))
			my_die("Ext: ".$e->getMessage(), $e->getCode() === 404 ? "404 Not Found" : "409 Conflict");
		my_die("Ext: ".$e->getMessage());
	}
}
