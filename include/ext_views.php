<?php
# Read-only доступ к базе Интеграма по обычной строке подключения MySQL/MariaDB (issue #5373).
#
# Для базы <db> (таблица `<db>` схемы приложения) строится схема `ext_<db>` из настоящих VIEW:
#   t_<таблица>                 — плоская вьюха таблицы: id, parent_id, ord, главное значение и
#                                 по колонке на каждый реквизит;
#   t_<таблица>__<реквизит>_list — строки множественного реквизита (parent_id, item_id, value, ord);
#   q_<запрос>                  — вьюха Запроса (отчёта), SQL движка отчётов.
# Читатель — пользователь MySQL `ext_<db>` с правами SELECT/SHOW VIEW только на `ext_<db>`.*:
# вьюхи работают правами создателя (SQL SECURITY DEFINER), сама таблица базы читателю закрыта.
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
# Набор вьюх таблиц: array(array(name, kind, object, sql)). $src — таблица базы с именем схемы.
function Ext_plan_tables($types, $reqs, $src){
	$views = array();
	$taken = array();
	foreach($types as $id => $type){
		if(!Ext_table_visible($type))
			continue;
		$vname = Ext_unique("t_".Ext_slug($type["name"]), $taken, $id);
		$cols = array("id" => TRUE, "parent_id" => TRUE, "ord" => TRUE);
		$main = Ext_unique(Ext_slug($type["name"]), $cols, $id);
		$sel = array("v.id AS `id`", "v.up AS `parent_id`", "v.ord AS `ord`"
			, Ext_typed_expr("v.val", $type["base"])." AS ".Ext_qi($main));
		$lists = array();
		foreach(isset($reqs[$id]) ? $reqs[$id] : array() as $req){
			if(Ext_req_secret($req))
				continue;
			$rid = $req["id"];
			if($req["kind"] === "child"){
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
function Ext_plan_reports($reports, $compile, &$errors){
	$views = array();
	$taken = array();
	foreach($reports as $id => $name){
		$vname = Ext_unique("q_".Ext_slug($name), $taken, $id);
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
# Пересборка всех вьюх базы $z и пользователя-читателя. $opts:
#   compile  — function($reportId): SQL Запроса (без него вьюхи запросов не строятся);
#   password — задать/сменить пароль читателя (иначе у нового генерируется, у прежнего не трогается);
#   host, port — адрес сервера для строки подключения.
# Ошибка одной вьюхи пересборку не роняет: прежняя вьюха остаётся, причина — в errors.
function Ext_rebuild($conn, $z, $opts = array()){
	if(!preg_match("/^[A-Za-z0-9_]+$/", $z))
		throw new Exception("Bad database name");
	$schema = Ext_schema_name($z);
	if(strlen($schema) > EXT_IDENT_MAX)
		throw new Exception("Database name is too long");
	$app = Ext_rows($conn, "SELECT DATABASE() db");
	$src = Ext_qi($app[0]["db"]).".".Ext_qi($z);
	$meta = Ext_load_meta($conn, $src);
	$errors = array();
	$views = Ext_plan_tables($meta["types"], $meta["reqs"], $src);
	if(isset($opts["compile"])){
		$reports = array();
		foreach(Ext_rows($conn, "SELECT id, val FROM $src WHERE t=22 AND up!=0 AND val!='' ORDER BY id") as $row)
			$reports[(int)$row["id"]] = $row["val"];
		$views = array_merge($views, Ext_plan_reports($reports, $opts["compile"], $errors));
	}
	Ext_exec($conn, "CREATE DATABASE IF NOT EXISTS ".Ext_qi($schema)." CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
	$keep = $rebuilt = array();
	foreach($views as $v){
		$keep[$v["name"]] = TRUE;
		try{
			Ext_exec($conn, "CREATE OR REPLACE SQL SECURITY DEFINER VIEW ".Ext_qi($schema).".".Ext_qi($v["name"])." AS\n".$v["sql"]);
			$rebuilt[] = $v["name"];
		}
		catch(Exception $e){
			$errors[] = array("view" => $v["name"], "object" => $v["object"], "error" => $e->getMessage());
		}
	}
	foreach($errors as $e)
		$keep[$e["view"]] = TRUE;
	$dropped = array();
	foreach(Ext_rows($conn, "SELECT table_name n FROM information_schema.views WHERE table_schema='"
			.mysqli_real_escape_string($conn, $schema)."'") as $row)
		if(!isset($keep[$row["n"]])){
			Ext_exec($conn, "DROP VIEW IF EXISTS ".Ext_qi($schema).".".Ext_qi($row["n"]));
			$dropped[] = $row["n"];
		}
	$res = array("schema" => $schema, "rebuilt" => $rebuilt, "dropped" => $dropped, "errors" => $errors);
	return $res + Ext_reader($conn, $schema, $opts);
}
# Реестр читателей, созданных ядром: схема ext__registry (имя базы начинается с буквы, поэтому
# с ext_<db> не совпадает; читателям она не выдаётся).
define("EXT_REGISTRY", "`ext__registry`.`readers`");
function Ext_registry($conn){
	Ext_exec($conn, "CREATE DATABASE IF NOT EXISTS `ext__registry` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
	Ext_exec($conn, "CREATE TABLE IF NOT EXISTS ".EXT_REGISTRY." (login VARCHAR(80) NOT NULL PRIMARY KEY"
		.", db VARCHAR(64) NOT NULL, created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
}
# В GRANT имя базы — шаблон: «_» и «%» экранируются, иначе право выдаётся на шаблон, а не на базу.
function Ext_grant_db($schema){
	return Ext_qi(addcslashes($schema, "_%"));
}
# Читатель ext_<db>@'%': SELECT, SHOW VIEW только на свою схему. Ядро меняет лишь свою учётку —
# записанную в реестре за этой базой; чужая одноимённая учётка — ошибка 409.
function Ext_reader($conn, $schema, $opts){
	$login = $schema;
	$esc = mysqli_real_escape_string($conn, $login);
	$user = "'$esc'@'%'";
	$me = Ext_rows($conn, "SELECT CURRENT_USER() u");
	if(strtolower(preg_replace("/@.*$/", "", $me[0]["u"])) === strtolower($login))
		throw new Exception("Reader login $login is the application user", 409);
	Ext_registry($conn);
	$password = isset($opts["password"]) && $opts["password"] !== "" ? (string)$opts["password"] : NULL;
	# Новая учётка сразу с паролем: без него она хоть миг была бы открыта
	$initial = $password !== NULL ? $password : bin2hex(random_bytes(12));
	if(mysqli_query($conn, "CREATE USER $user IDENTIFIED BY '".mysqli_real_escape_string($conn, $initial)."'") !== FALSE){
		$password = $initial;
		Ext_exec($conn, "REPLACE INTO ".EXT_REGISTRY." (login, db) VALUES ('$esc', '".mysqli_real_escape_string($conn, $schema)."')");
	}
	else{
		if(mysqli_errno($conn) !== 1396)	# 1396 — учётка уже есть
			throw new Exception(mysqli_error($conn), mysqli_errno($conn));
		if(!count(Ext_rows($conn, "SELECT 1 FROM ".EXT_REGISTRY." WHERE login='$esc' AND db='"
				.mysqli_real_escape_string($conn, $schema)."'")))
			throw new Exception("MySQL user $login exists and was not created by Integram", 409);
		if($password !== NULL)
			Ext_exec($conn, "ALTER USER $user IDENTIFIED BY '".mysqli_real_escape_string($conn, $password)."'");
	}
	Ext_exec($conn, "GRANT SELECT, SHOW VIEW ON ".Ext_grant_db($schema).".* TO $user");
	$host = isset($opts["host"]) ? $opts["host"] : "localhost";
	$port = isset($opts["port"]) ? (int)$opts["port"] : 3306;
	$res = array("login" => $login
		, "connection" => "mysql://$login:".($password !== NULL ? rawurlencode($password) : "<password>")."@$host:$port/$schema");
	if($password !== NULL)
		$res["password"] = $password;
	return $res;
}
# SQL Запроса из движка отчётов (Compile_Report) без выполнения и без параметров запроса.
# Запрос, которому нужен id объекта из адреса (%..._OBJ_ID%), во вьюху не переносится.
function Ext_core_report_sql($id){
	$request = $_REQUEST;
	$_REQUEST = array();
	$GLOBALS["EXT_SQL_ONLY"] = TRUE;
	unset($GLOBALS["STORED_REPS"][$id]);
	try{
		Compile_Report($id, "ext$id", TRUE, FALSE, TRUE);
	}
	finally{
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
# Пересборка из ядра: DDL идёт отдельной учёткой INTEGRAM_EXT_ADMIN_USER/_PASSWORD, если задана,
# иначе соединением приложения. Адрес в строке подключения — INTEGRAM_EXT_PUBLIC_HOST/_PORT
# (по умолчанию адрес сервера БД).
function Ext_rebuild_core($password){
	global $z, $connection;
	$db = $GLOBALS["DB_CONN"];
	$conn = $connection;
	$admin = integram_env("INTEGRAM_EXT_ADMIN_USER", "");
	if($admin !== ""){
		$conn = mysqli_init();
		if(!@mysqli_real_connect($conn, $db["host"], $admin, integram_env("INTEGRAM_EXT_ADMIN_PASSWORD", ""), $db["name"], $db["port"]))
			my_die("Ext: cannot connect as $admin");
		$conn->set_charset("utf8mb4");
	}
	try{
		return Ext_rebuild($conn, $z, array("compile" => "Ext_core_report_sql", "password" => is_string($password) ? $password : ""
			, "host" => integram_env("INTEGRAM_EXT_PUBLIC_HOST", $db["host"])
			, "port" => (int)integram_env("INTEGRAM_EXT_PUBLIC_PORT", (string)$db["port"])));
	}
	catch(Exception $e){
		if($e->getCode() === 409)
			header("HTTP/1.0 409 Conflict");
		my_die("Ext: ".$e->getMessage());
	}
}
