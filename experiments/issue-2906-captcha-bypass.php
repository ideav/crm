<?php
// Verification of the backend captcha-bypass helper hasValidTokenCookie() from
// issue #2906 ("the same logic in the core"). The function lives in index.php;
// this test runs an exact mirror of it inside a namespace where mysqli_* and
// checkDbName are stubbed, so the cookie-filtering and "first valid token wins"
// behavior can be exercised without a real database.
//
// Run with: php experiments/issue-2906-captcha-bypass.php

namespace Test2906;

const USER = 110;
const TOKEN = 125;
const USER_DB_MASK = "/^[a-z]\w{2,14}$/i";

// Tokens that the fake DB considers valid, keyed by "db|token".
$GLOBALS['VALID'] = [];
// Records every DB queried, so we can assert which cookies triggered a lookup.
$GLOBALS['QUERIED'] = [];

function checkDbName($mask, $db){ return preg_match($mask, $db); }

function mysqli_query($connection, $sql){
    // Parse "SELECT 1 FROM <db> tok, <db> u ... tok.val='<tok>' ..."
    if(!preg_match('/FROM (\w+) tok/', $sql, $m)) return false;
    $db = $m[1];
    preg_match("/tok.val='([^']*)'/", $sql, $tm);
    $tok = isset($tm[1]) ? $tm[1] : '';
    $GLOBALS['QUERIED'][] = $db;
    return isset($GLOBALS['VALID']["$db|$tok"]) ? ['hit' => true] : false;
}
function mysqli_fetch_array($res){ return is_array($res) ? $res : false; }

// ---- Mirror of index.php hasValidTokenCookie() ----
function hasValidTokenCookie(){
    global $connection;
    if(empty($_COOKIE) || !is_array($_COOKIE)) return false;
    foreach($_COOKIE as $name => $value){
        if(strpos($name, "idb_") !== 0) continue;
        $db = substr($name, 4);
        if(!checkDbName(USER_DB_MASK, $db)) continue;
        if($value === "" || $value === "gtuoeksetn") continue; // Empty or guest token
        $tok = addslashes($value);
        $res = @mysqli_query($connection, "SELECT 1 FROM $db tok, $db u"
            ." WHERE u.t=".USER." AND u.val!='guest' AND tok.up=u.id AND tok.val='$tok' AND tok.t=".TOKEN." LIMIT 1");
        if($res && mysqli_fetch_array($res)) return true;
    }
    return false;
}

$failures = 0;
function check($cond, $name){
    global $failures;
    echo ($cond ? "PASS" : "FAIL") . " — $name\n";
    if(!$cond) $failures++;
}

function scenario($cookies, $valid){
    $_COOKIE = $cookies;
    $GLOBALS['VALID'] = $valid;
    $GLOBALS['QUERIED'] = [];
    return hasValidTokenCookie();
}

// 1) Valid token => bypass.
check(scenario(['idb_acme' => 'tok-acme'], ['acme|tok-acme' => 1]) === true,
    'valid token => bypass');

// 2) No idb_* cookies => no bypass, no DB query.
$r = scenario(['session' => 'x', '_aff' => '5'], []);
check($r === false && count($GLOBALS['QUERIED']) === 0,
    'non-idb cookies are ignored, no query issued');

// 3) Guest token => skipped, no bypass, no query.
$r = scenario(['idb_demo' => 'gtuoeksetn'], ['demo|gtuoeksetn' => 1]);
check($r === false && count($GLOBALS['QUERIED']) === 0,
    'guest token is skipped without a query');

// 4) Empty token value => skipped, no query.
$r = scenario(['idb_x' => ''], []);
check($r === false && count($GLOBALS['QUERIED']) === 0,
    'empty token value is skipped');

// 5) Bad db name (fails USER_DB_MASK) => skipped, no query.
$r = scenario(['idb_a' => 'tok'], ['a|tok' => 1]); // "a" is too short for the mask
check($r === false && count($GLOBALS['QUERIED']) === 0,
    'db name failing the mask is skipped');

// 6) Stale token (not valid in DB) => no bypass, but a query was attempted.
$r = scenario(['idb_stale' => 'tok-stale'], []);
check($r === false && $GLOBALS['QUERIED'] === ['stale'],
    'stale token queried but does not bypass');

// 7) Mixed: first invalid then valid => bypass, both queried in order.
$r = scenario(['idb_bad' => 'tok-bad', 'idb_good' => 'tok-good'], ['good|tok-good' => 1]);
check($r === true && $GLOBALS['QUERIED'] === ['bad', 'good'],
    'mixed cookies => bypass once a valid token is found');

echo "\n" . ($failures === 0 ? "ALL TESTS PASSED" : "$failures TEST(S) FAILED") . "\n";
exit($failures === 0 ? 0 : 1);
