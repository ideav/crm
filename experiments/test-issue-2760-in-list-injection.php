<?php
# Regression test for issue #2760.
# Verifies that validateInList() (added in index.php) keeps SQL injection
# attempts out of the IN() filter while still accepting legitimate numeric
# and properly quoted string lists. After issue #2762, rejection is signalled
# by a FALSE return (so the caller can fall through to a plain-text search)
# instead of a fatal die_info() call.

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

# Load the production validateInList() definition from index.php into this
# script. The function no longer calls die_info()/t9n() (rejection is signalled
# via FALSE), but the stubs are kept harmless for forward compatibility.
$indexSource = file_get_contents(__DIR__."/../index.php");
if($indexSource === false){
    fwrite(STDERR, "Cannot read index.php\n");
    exit(1);
}

class InListRejected extends Exception {}
function die_info($msg){ throw new InListRejected($msg); }
function t9n($msg){
    if(preg_match('/\[EN\](.*?)(\[[A-Z]{2}\]|$)/s', $msg, $m))
        return $m[1];
    return $m[0] ?? $msg;
}

eval(extractFunctionSource($indexSource, "validateInList"));

# --- Acceptance cases ---
assertTest(validateInList("1,2,3") === "1,2,3",
    "numeric list passes through unchanged");

assertTest(validateInList(" 1 , 2 , 3 ") === "1,2,3",
    "whitespace around numeric items is trimmed");

assertTest(validateInList("'a','b','c'") === "'a','b','c'",
    "quoted strings pass through unchanged");

assertTest(validateInList("1,'b',3") === "1,'b',3",
    "mixed numeric and quoted strings accepted");

assertTest(validateInList("'O''Brien'") === "'O\\'Brien'",
    "SQL-style '' escape inside quoted string normalised via addslashes");

assertTest(validateInList("'foo bar baz'") === "'foo bar baz'",
    "spaces inside a quoted string accepted");

# --- Rejection cases (injection attempts that must NOT produce an IN clause) ---
$rejected = function($input, $hint){
    $result = validateInList($input);
    if($result === FALSE){
        fwrite(STDOUT, "OK:   rejected (".$hint."): ".$input."\n");
        return;
    }
    fwrite(STDERR, "FAIL: accepted (".$hint."): ".$input." -> ".$result."\n");
    exit(1);
};

# Statement terminator
$rejected("1); DROP TABLE users; --", "stacked DROP TABLE");
# UNION attack via comment markers (--) — without the comment markers the new
# bare-identifier path would treat it as a literal string search, which is also
# safe, but the comment markers must still trigger fall-through.
$rejected("1) UNION SELECT 1 -- ", "UNION SELECT with comment");
# SLEEP-based time injection with a comment marker.
$rejected("1) OR SLEEP(5) -- ", "time-based SLEEP injection with --");
# BENCHMARK-based load injection with a comment marker.
$rejected("1) OR BENCHMARK(1000000,MD5(1)) -- ", "BENCHMARK injection with --");
# Comment markers on their own
$rejected("1 -- comment", "double-dash SQL comment");
$rejected("1 /* comment */", "C-style SQL comment");
$rejected("1 # hash comment", "hash comment");
# Unbalanced quote
$rejected("'unterminated", "unterminated single quote");
# Embedded semicolon inside a string
$rejected("'foo; bar'", "semicolon inside quoted string");
# Bare identifier containing a stray quote — caller should fall through rather
# than guess at the user's intent.
$rejected("a'b", "bare item with embedded single quote");
# Empty / delimiter-only payloads now fall through (issue #2762).
$rejected("", "empty list");
$rejected(",", "comma-only list");
$rejected(",,,", "many-commas-only list");
$rejected("  ", "whitespace-only list");

fwrite(STDOUT, "\nAll validateInList() injection checks passed.\n");
