<?php
# Мерка к режиму refresh/access токенов ядра (issue #5205):
#   A) refresh-токен: в базе — хеш, после ротации строка помнит прежний (повтор старого = кража);
#   B) access-токен: подпись на строке refresh, срок не дольше refresh, после ротации старый мёртв;
#   C) строки r/a из базы не годятся как ключ API (Token_db_val, Token_key_sql);
#   D) чистка: refresh гаснет по простою REFRESH_TTL и по сроку, считается в SESSION_MAX;
#   E) xsrf привязан к строке refresh, не меняется при обновлении access;
#   F) режим выключен по умолчанию, включается константой или INTEGRAM_AUTH_TOKENS.
#
# Запуск: php experiments/auth-refresh-5205.test.php (в гейте — через одноимённый .test.js)
# INDEX_PHP=<путь> — проверить другую версию ядра.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
define("SALT", "yyy");
$z = "abc";

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false) throw new Exception("not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("not closed: ".$name);
}
$source = file_get_contents(getenv("INDEX_PHP") ?: __DIR__."/../index.php");
if(preg_match_all('/^(?:defined\("\w+"\) \|\| )?define\("(SESSION_IDLE|SESSION_LIFETIME|SESSION_MAX)", (.+?)\);/m', $source, $mm, PREG_SET_ORDER))
    foreach($mm as $m) eval('define("'.$m[1].'", '.$m[2].');');
$missing = array();
foreach(array("xsrf", "Token_parse", "Token_stored_val", "Token_db_val", "Token_key_sql", "Session_prune_ids", "Auth_conf",
              "Refresh_mode", "Refresh_parse", "Refresh_row_val", "Refresh_row_matches", "Refresh_idle", "Refresh_xsrf",
              "Access_parse", "Access_mac", "Access_issue", "Access_check") as $fn){
    try { eval(extract_function_source($source, $fn)); } catch(Exception $e){ $missing[] = $fn; }
}
expect(!$missing, "в index.php есть все проверяемые функции".($missing ? " (нет: ".implode(", ", $missing).")" : ""));
if($missing){ echo "\n$failures FAIL\n"; exit(1); }

$now = 2000000000;
$sec1 = str_repeat("1a", 32); $sec2 = str_repeat("2b", 32);
$exp = $now + SESSION_LIFETIME;

# ── F) режим ────────────────────────────────────────────────────────────────────────────────
putenv("INTEGRAM_AUTH_TOKENS");
expect(!Refresh_mode(), "F: по умолчанию режим выключен (сессии как прежде)");
putenv("INTEGRAM_AUTH_TOKENS=refresh");
expect(Refresh_mode(), "F: INTEGRAM_AUTH_TOKENS=refresh включает режим");
putenv("INTEGRAM_AUTH_TOKENS=yes");
expect(!Refresh_mode(), "F: прочее значение режим не включает");
putenv("INTEGRAM_ACCESS_TTL=60");
expect(Auth_conf("ACCESS_TTL", 900) === 60, "F: срок access берётся из окружения");
putenv("INTEGRAM_ACCESS_TTL");
expect(Auth_conf("ACCESS_TTL", 900) === 900, "F: без настройки — значение по умолчанию");

# ── A) refresh ──────────────────────────────────────────────────────────────────────────────
$r1 = "r.$exp.$sec1";
$p1 = Refresh_parse($r1);
expect($p1 && $p1["exp"] === $exp && $p1["secret"] === $sec1, "A: refresh разбирается на срок и секрет");
expect(Refresh_parse("r.$exp.zz") === NULL && Refresh_parse("s.$exp.$sec1") === NULL, "A: чужой вид — не refresh");
$v1 = Refresh_row_val($exp, $sec1);
expect(strpos($v1, $sec1) === false && strpos($v1, hash("sha256", $sec1)) !== false, "A: в базе хеш секрета, не секрет");
expect(Refresh_row_matches($v1, $p1) === "current", "A: строка узнаёт свой refresh");
$v2 = Refresh_row_val($exp, $sec2, $sec1);
$p2 = Refresh_parse("r.$exp.$sec2");
expect(Refresh_row_matches($v2, $p2) === "current", "A: после ротации действует новый refresh");
expect(Refresh_row_matches($v2, $p1) === "previous", "A: прежний refresh узнаётся как повтор");
expect(Refresh_row_matches($v1, $p2) === "", "A: посторонний refresh не подходит");
expect(!Refresh_idle(floor($now / 60), $now) && Refresh_idle(floor(($now - 31 * 86400) / 60), $now), "A: простой больше REFRESH_TTL гасит refresh");

# ── B) access ───────────────────────────────────────────────────────────────────────────────
$a1 = Access_issue($z, 77, $v1, $now);
$ap = Access_parse($a1);
expect($ap && $ap["rid"] === 77 && $ap["exp"] === $now + 900, "B: access несёт номер строки refresh и срок ACCESS_TTL");
expect(Access_check($z, $ap, $v1, $now + 10), "B: свежий access принимается");
expect(!Access_check($z, $ap, $v1, $now + 900), "B: истёкший access не принимается");
expect(!Access_check($z, $ap, $v2, $now + 10), "B: после ротации refresh прежний access мёртв");
expect(!Access_check("other", $ap, $v1, $now + 10), "B: access одной базы не годится в другой");
$forged = Access_parse("a.".($now + 900).".78.".substr($a1, -64));
expect(!Access_check($z, $forged, $v1, $now + 10), "B: подменённый номер строки не проходит подпись");
expect(!Access_check($z, $ap, "s.$exp.".hash("sha256", $sec1), $now + 10), "B: access только к строке refresh");
$short = Refresh_row_val($now + 100, $sec1);
expect(Access_parse(Access_issue($z, 77, $short, $now))["exp"] === $now + 100, "B: access не живёт дольше своего refresh");
expect(!Access_check($z, $ap, Refresh_row_val($now - 1, $sec1), $now + 10), "B: истёкший refresh гасит access");

# ── C) значения из базы не входят ключом API ───────────────────────────────────────────────
expect(Token_db_val($v1) === FALSE && Token_db_val($r1) === FALSE && Token_db_val($a1) === FALSE, "C: r/a не ищутся как ключ API");
expect(strpos(Token_key_sql("tok"), "r") !== false && preg_match('/\(([a-z|]+)\)/', Token_key_sql("tok"), $km)
    && in_array("r", explode("|", $km[1]), true), "C: строка refresh не считается ключом пользователя");

# ── D) чистка ───────────────────────────────────────────────────────────────────────────────
$min = floor($now / 60);
$rows = array(1 => array("val" => Refresh_row_val($now - 5, $sec1), "ord" => $min),
              2 => array("val" => Refresh_row_val($exp, $sec1), "ord" => floor(($now - 31 * 86400) / 60)),
              3 => array("val" => Refresh_row_val($exp, $sec2, $sec1), "ord" => $min),
              4 => array("val" => str_repeat("f", 64), "ord" => 1));
$drop = Session_prune_ids($rows, $now);
expect(in_array(1, $drop) && in_array(2, $drop), "D: истёкший и простаивающий refresh удаляются");
expect(!in_array(3, $drop) && !in_array(4, $drop), "D: живой refresh и ключ API остаются");
$many = array();
for($i = 1; $i <= SESSION_MAX + 2; $i++) $many[$i] = array("val" => Refresh_row_val($exp, $sec1), "ord" => $min);
expect(Session_prune_ids($many, $now) === array(1, 2), "D: refresh-сессии сверх SESSION_MAX удаляются со старых");

# ── E) xsrf ─────────────────────────────────────────────────────────────────────────────────
expect(Refresh_xsrf($z, 77) === Refresh_xsrf($z, 77) && Refresh_xsrf($z, 77) !== Refresh_xsrf($z, 78), "E: xsrf свой на строку refresh");
expect(Refresh_xsrf($z, 77) !== Refresh_xsrf("other", 77), "E: xsrf свой на базу");

echo "\n".($failures ? "$failures FAIL" : "OK")."\n";
exit($failures ? 1 : 0);
