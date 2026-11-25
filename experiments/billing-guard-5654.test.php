<?php
# Issue #5654: the data guard of the AI chat is billed separately — counter "guard_runs"
# (requests that went through the guard), on top of the #5206 counters (AI tokens, agent runs).
# The agent sends {"guard": N} in the same POST /{db}/billing/add (X-Billing-Token).
#
# Real functions from index.php run against a stubbed mysqli (namespace billing5654):
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
$code = "namespace billing5654;\n";
try {
    foreach(array("aiConfigValue", "billingUnits", "billingCounterAdd", "billingAddRequest") as $fn)
        $code .= extract_function_source($source, $fn)."\n";
} catch(Exception $e){
    echo "FAIL: ".$e->getMessage()."\n";
    exit(1);
}
eval('namespace billing5654;
const DATABASE = 271;
function t9n($s){ return preg_replace("/^\[RU\](.*)\[EN\].*$/su", "$1", $s); }
function mysqli_real_escape_string($c, $s){ return addslashes($s); }
function mysqli_affected_rows($c){ return $GLOBALS["__affected"]; }
function mysqli_query($c, $sql){
    $GLOBALS["__q"][] = $sql;
    $GLOBALS["__affected"] = 0;
    if(strpos($sql, "UPDATE") === 0)
        $GLOBALS["__affected"] = array_shift($GLOBALS["__upd"]);
    elseif(strpos($sql, "INSERT") === 0)
        $GLOBALS["__affected"] = 1;
    return true;
}');
eval($code);

function cfg($guard){
    foreach(array("BILLING_SERVICE_TOKEN" => "s3cret", "BILLING_AI_TOKENS_TYPE" => "9001",
                  "BILLING_AGENT_RUNS_TYPE" => "9002", "BILLING_GUARD_TYPE" => $guard,
                  "BILLING_AI_TOKENS_PER_UNIT" => "1000", "BILLING_AGENT_RUN_UNITS" => "5",
                  "BILLING_GUARD_RUN_UNITS" => "2") as $k => $v)
        putenv($v === "" ? $k : "$k=$v");
}
function run($upd, $body){
    $GLOBALS["__q"] = array(); $GLOBALS["__upd"] = $upd;
    return \billing5654\billingAddRequest(new stdClass(), "ateh", "POST", array("x-billing-token" => "s3cret"), $body);
}
function incs(){
    $out = array();
    foreach($GLOBALS["__q"] as $q)
        if(preg_match("/^UPDATE my c JOIN my db ON c.up=db.id SET c.ord=c.ord\+(\d+) WHERE db.t=271 AND db.val='ateh' AND c.t=(\d+)$/", $q, $m))
            $out[] = $m[2].":".$m[1];
    return $out;
}

# 1. Guarded answer: three counters, guard in its own units (1 request x 2).
cfg("9003");
$r = run(array(1, 1, 1), '{"tokens":2500,"runs":1,"guard":1}');
expect($r["code"] === 200 && incs() === array("9001:3", "9002:5", "9003:2"), "tokens+runs+guard: three UPDATEs");
expect(isset($r["body"]["added"]) && $r["body"]["added"] === array("ai_tokens" => 3, "agent_runs" => 5, "guard_runs" => 2),
    "reply reports guard units");

# 2. Guard only (request stopped by the guard, or the base's own model): one UPDATE.
$r = run(array(1), '{"guard":1}');
expect($r["code"] === 200 && incs() === array("9003:2"), "guard only: one UPDATE of guard_runs");

# 3. Missing guard counter row is created like the others.
$r = run(array(0, 0), '{"guard":3}');
expect($r["code"] === 200 && count(preg_grep("/^INSERT INTO my \(up, ord, t, val\) SELECT db.id, 6, 9003, 'guard_runs'/", $GLOBALS["__q"])) === 1,
    "missing guard counter: one INSERT with 3 x 2 units");

# 4. Guard type not configured: guard is not billed, the rest as before, no error.
cfg("");
$r = run(array(1, 1), '{"tokens":2500,"runs":1,"guard":1}');
expect($r["code"] === 200 && incs() === array("9001:3", "9002:5"), "no BILLING_GUARD_TYPE: guard ignored, tokens and runs billed");
expect(isset($r["body"]["added"]) && !isset($r["body"]["added"]["guard_runs"]), "no BILLING_GUARD_TYPE: no guard_runs in reply");
$r = run(array(), '{"guard":1}');
expect($r["code"] === 200 && count($GLOBALS["__q"]) === 0, "no BILLING_GUARD_TYPE, guard only: 200, no SQL");

# 5. Bad guard value -> 400, nothing written.
cfg("9003");
foreach(array('{"guard":-1}', '{"guard":"1"}', '{"runs":1,"guard":1.5}', '{"guard":0}') as $b){
    $r = run(array(), $b);
    expect($r["code"] === 400 && count($GLOBALS["__q"]) === 0, "body ".$b.": 400, no SQL");
}

# 6. #5206 bodies are unchanged.
$r = run(array(1, 1), '{"tokens":2500,"runs":2}');
expect($r["body"]["added"] === array("ai_tokens" => 3, "agent_runs" => 10), "#5206 body: same reply as before");

echo $failures === 0 ? "ALL PASS\n" : "$failures FAILED\n";
exit($failures === 0 ? 0 : 1);
