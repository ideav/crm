<?php
# Issue #5206: billing counters of a user DB (AI tokens, agent runs) in tariff units.
# Each counter is a child row of the DB record in `my` (t=DATABASE, val=<db>); the
# counter itself is that row's ord, incremented by one UPDATE. The row is created once.
# The service call POST /{db}/billing/add is authorised by BILLING_SERVICE_TOKEN.
#
# Real functions from index.php run against a stubbed mysqli (namespace billing5206):
# what is checked is the SQL that reaches the DB and the reply, not the source text.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false) throw new Exception("not found: ".$name);
    $depth = 0; $len = strlen($source);
    for($i = strpos($source, "{", $start); $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("not closed: ".$name);
}

$source = file_get_contents(__DIR__."/../index.php");
$code = "namespace billing5206;\n";
try {
    foreach(array("aiConfigValue", "billingUnits", "billingCounterAdd", "billingAddRequest") as $fn)
        $code .= extract_function_source($source, $fn)."\n";
} catch(Exception $e){
    echo "FAIL: ".$e->getMessage()."\n";
    exit(1);
}
eval('namespace billing5206;
const DATABASE = 271;
function t9n($s){ return preg_replace("/^\[RU\](.*)\[EN\].*$/su", "$1", $s); }
function mysqli_real_escape_string($c, $s){ return addslashes($s); }
function mysqli_affected_rows($c){ return $GLOBALS["__affected"]; }
function mysqli_query($c, $sql){
    $GLOBALS["__q"][] = $sql;
    $GLOBALS["__affected"] = 0;
    if(strpos($sql, "UPDATE") === 0){
        $GLOBALS["__affected"] = array_shift($GLOBALS["__upd"]);
    }
    elseif(strpos($sql, "INSERT") === 0)
        $GLOBALS["__affected"] = isset($GLOBALS["__ins"]) ? $GLOBALS["__ins"] : 1;
    return true;
}');
eval($code);

function cfg($tok, $types){
    foreach(array("BILLING_SERVICE_TOKEN" => $tok, "BILLING_AI_TOKENS_TYPE" => $types ? "9001" : "",
                  "BILLING_AGENT_RUNS_TYPE" => $types ? "9002" : "",
                  "BILLING_AI_TOKENS_PER_UNIT" => "1000", "BILLING_AGENT_RUN_UNITS" => "5") as $k => $v)
        putenv($v === "" ? $k : "$k=$v");
}
function run($upd, $headers, $body, $method = "POST"){
    $GLOBALS["__q"] = array(); $GLOBALS["__upd"] = $upd;
    return \billing5206\billingAddRequest(new stdClass(), "ateh", $method, $headers, $body);
}

$ok = array("x-billing-token" => "s3cret");
$body = json_encode(array("tokens" => 2500, "runs" => 2));

# 1. Off by default: no token configured -> 404, nothing written.
cfg("", true);
$r = run(array(), $ok, $body);
expect($r["code"] === 404 && count($GLOBALS["__q"]) === 0, "no BILLING_SERVICE_TOKEN: 404, no SQL");

# 2. Wrong or missing token -> 403, nothing written.
cfg("s3cret", true);
$r = run(array(), array("x-billing-token" => "bad"), $body);
expect($r["code"] === 403 && count($GLOBALS["__q"]) === 0, "wrong token: 403, no SQL");
$r = run(array(), array(), $body);
expect($r["code"] === 403 && count($GLOBALS["__q"]) === 0, "no token header: 403, no SQL");

# 3. Only POST.
$r = run(array(), $ok, $body, "GET");
expect($r["code"] === 405 && count($GLOBALS["__q"]) === 0, "GET: 405, no SQL");

# 4. Counter types not configured -> 503, nothing written.
cfg("s3cret", false);
$r = run(array(), $ok, $body);
expect($r["code"] === 503 && count($GLOBALS["__q"]) === 0, "types not configured: 503, no SQL");

# 5. Bad body.
cfg("s3cret", true);
foreach(array("", "{", '{"tokens":0,"runs":0}', '{"tokens":-5}', '{"runs":"x"}') as $b){
    $r = run(array(), $ok, $b);
    expect($r["code"] === 400 && count($GLOBALS["__q"]) === 0, "body ".var_export($b, true).": 400, no SQL");
}

function incs(){
    $out = array();
    foreach($GLOBALS["__q"] as $q)
        if(preg_match("/^UPDATE my c JOIN my db ON c.up=db.id SET c.ord=c.ord\+(\d+) WHERE db.t=271 AND db.val='ateh' AND c.t=(\d+)$/", $q, $m))
            $out[] = $m[2].":".$m[1];
    return $out;
}
function inserts(){
    $out = array();
    foreach($GLOBALS["__q"] as $q)
        if(preg_match("/^INSERT INTO my \(up, ord, t, val\) SELECT db.id, (\d+), (\d+), '([a-z_]+)' FROM my db WHERE db.t=271 AND db.val='ateh' LIMIT 1$/", $q, $m))
            $out[] = $m[2].":".$m[1].":".$m[3];
    return $out;
}

# 6. Counters exist: one UPDATE each, in tariff units (ceil(2500/1000)=3, 2 runs x 5 = 10).
$r = run(array(1, 1), $ok, $body);
expect($r["code"] === 200, "existing counters: 200");
expect(incs() === array("9001:3", "9002:10") && count($GLOBALS["__q"]) === 2, "existing counters: exactly two UPDATEs, units 3 and 10");
expect($r["body"]["added"] === array("ai_tokens" => 3, "agent_runs" => 10), "reply reports added units");

# 7. Counter missing: created once under a lock, then nothing more.
$r = run(array(0, 0, 1), $ok, $body);
expect($r["code"] === 200 && inserts() === array("9001:3:ai_tokens"), "missing ai_tokens counter: one INSERT with the units");
$lock = preg_grep("/GET_LOCK\('billing_ateh_9001'/", $GLOBALS["__q"]);
$rel = preg_grep("/RELEASE_LOCK\('billing_ateh_9001'\)/", $GLOBALS["__q"]);
expect(count($lock) === 1 && count($rel) === 1, "counter creation is under GET_LOCK and released");

# 8. Concurrent creation: after the lock the row is there -> UPDATE, no INSERT.
$r = run(array(0, 1, 1), $ok, $body);
expect($r["code"] === 200 && inserts() === array() && incs() === array("9001:3", "9001:3", "9002:10"), "row appeared under lock: no duplicate INSERT");

# 9. Only runs: the AI-tokens counter is not touched.
$r = run(array(1), $ok, '{"runs":1}');
expect($r["code"] === 200 && incs() === array("9002:5"), "runs only: one UPDATE of agent_runs");

# 10. Small token count still costs one unit.
$r = run(array(1), $ok, '{"tokens":1}');
expect(incs() === array("9001:1"), "1 token = 1 unit (rounded up)");

# 11. DB record missing: INSERT affects nothing -> 404.
$GLOBALS["__ins"] = 0;
$r = run(array(0, 0), $ok, '{"tokens":10}');
expect($r["code"] === 404, "no DB record in my: 404");
unset($GLOBALS["__ins"]);

echo $failures === 0 ? "ALL PASS\n" : "$failures FAILED\n";
exit($failures === 0 ? 0 : 1);
