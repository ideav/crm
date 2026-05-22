<?php
# Regression test for issue #2762.
# Verifies that validateInList() (in index.php) now:
#   1. Auto-wraps bare values in single quotes:  IN(a,b,c)  -> 'a','b','c'
#   2. Cleans up leading / trailing / double commas:
#        IN(a,b,)   -> 'a','b'
#        IN(,a,b)   -> 'a','b'
#        IN(a,,b)   -> 'a','b'
#   3. Returns FALSE for inputs that remain incorrect so Construct_WHERE()
#      can fall through to the else-branch and treat the original IN(...)
#      expression as plain text instead of building an IN() clause.

function assertTest($condition, $message){
    if(!$condition){
        fwrite(STDERR, "FAIL: ".$message."\n");
        exit(1);
    }
    fwrite(STDOUT, "OK:   ".$message."\n");
}

function extractFunctionSource($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false)
        throw new Exception("Function not found: ".$name);
    $brace = strpos($source, "{", $start);
    if($brace === false)
        throw new Exception("Function body not found: ".$name);
    $depth = 0;
    $length = strlen($source);
    for($i = $brace; $i < $length; $i++){
        if($source[$i] === "{")
            $depth++;
        elseif($source[$i] === "}"){
            $depth--;
            if($depth === 0)
                return substr($source, $start, $i - $start + 1);
        }
    }
    throw new Exception("Function body is not closed: ".$name);
}

$indexSource = file_get_contents(__DIR__."/../index.php");
if($indexSource === false){
    fwrite(STDERR, "Cannot read index.php\n");
    exit(1);
}

# die_info() is no longer reachable from validateInList() after issue #2762,
# but we keep harmless stubs in case future edits reintroduce a call.
class InListRejected extends Exception {}
function die_info($msg){ throw new InListRejected($msg); }
function t9n($msg){
    if(preg_match('/\[EN\](.*?)(\[[A-Z]{2}\]|$)/s', $msg, $m))
        return $m[1];
    return $m[0] ?? $msg;
}

eval(extractFunctionSource($indexSource, "validateInList"));

# --- (1) Bare identifiers get auto-wrapped in single quotes ---
assertTest(validateInList("a,b,c") === "'a','b','c'",
    "IN(a,b,c) -> 'a','b','c' (bare identifiers wrapped in quotes)");

assertTest(validateInList("red,green,blue") === "'red','green','blue'",
    "colour names wrapped in quotes");

assertTest(validateInList("a, b , c") === "'a','b','c'",
    "whitespace around bare identifiers is trimmed before wrapping");

assertTest(validateInList("foo bar,baz qux") === "'foo bar','baz qux'",
    "bare identifiers with embedded spaces are wrapped as a whole");

# Numeric items keep their unquoted form even when mixed with bare identifiers.
assertTest(validateInList("1,a,2,b") === "1,'a',2,'b'",
    "mixed numerics and bare identifiers (numerics kept unquoted)");

# Already-quoted items mix freely with bare ones.
assertTest(validateInList("'foo',bar,42") === "'foo','bar',42",
    "mix of pre-quoted, bare and numeric items");

# --- (2) Leading / trailing / double commas are stripped ---
assertTest(validateInList("a,b,") === "'a','b'",
    "trailing comma is stripped (IN(a,b,))");

assertTest(validateInList(",a,b") === "'a','b'",
    "leading comma is stripped (IN(,a,b))");

assertTest(validateInList("a,,b") === "'a','b'",
    "double comma is collapsed (IN(a,,b))");

assertTest(validateInList(",,a,,,b,,") === "'a','b'",
    "many stray commas around bare identifiers collapsed");

assertTest(validateInList(" , 1 , , 2 , ") === "1,2",
    "stray commas + whitespace around numeric items collapsed");

# --- (3) Fall-through (returns FALSE) when the expression remains incorrect ---
$fallthrough = function($input, $hint){
    $result = validateInList($input);
    if($result === FALSE){
        fwrite(STDOUT, "OK:   fall-through (".$hint."): ".$input."\n");
        return;
    }
    fwrite(STDERR, "FAIL: did not fall through (".$hint."): ".$input." -> ".$result."\n");
    exit(1);
};

# Nothing usable after cleanup -> fall through.
$fallthrough("", "empty payload");
$fallthrough(",", "comma-only payload");
$fallthrough(",,,", "many-commas-only payload");
$fallthrough("   ", "whitespace-only payload");

# Injection markers survive the cleanup -> fall through (the calling code
# will then treat the whole original IN(...) literal as a plain-text search).
$fallthrough("1) OR SLEEP(5) -- ", "time-based injection with comment");
$fallthrough("1; DROP TABLE users", "stacked DROP TABLE");
$fallthrough("foo /* bar */ baz", "embedded C-style comment");
$fallthrough("foo # bar", "hash comment in bare item");
$fallthrough("'unterminated", "unterminated single quote");
$fallthrough("a'b", "bare item containing a stray single quote");

# --- Safety check: the wrapped bare items are properly escaped ---
# A bare item must never be able to escape its quotes, even if the input
# contains backslashes. (Single quotes in bare items are rejected above.)
assertTest(validateInList("a\\b") === "'a\\\\b'",
    "backslash inside bare identifier is doubled by addslashes()");

fwrite(STDOUT, "\nAll validateInList() normalisation checks passed.\n");
