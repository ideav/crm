<?php
# Regression test for issue #2760.
# Verifies that validateInList() (added in index.php) rejects SQL injection
# attempts inside the value of an "IN(...)" filter while still accepting
# legitimate numeric and properly quoted string lists.

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
# script, stubbing out the few helpers it relies on (die_info / t9n) so we can
# observe the rejection branch as an exception rather than process death.
$indexSource = file_get_contents(__DIR__."/../index.php");
if($indexSource === false){
    fwrite(STDERR, "Cannot read index.php\n");
    exit(1);
}

class InListRejected extends Exception {}
function die_info($msg){ throw new InListRejected($msg); }
function t9n($msg){
    # Strip [RU]…[EN]… markers so assertions can match a stable prefix.
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

# --- Rejection cases (injection attempts) ---
$rejected = function($input, $hint) {
    try {
        validateInList($input);
    } catch(InListRejected $e) {
        fwrite(STDOUT, "OK:   rejected (".$hint."): ".$input."\n");
        return;
    }
    fwrite(STDERR, "FAIL: accepted (".$hint."): ".$input."\n");
    exit(1);
};

# Bare unquoted text is not a valid IN() item.
$rejected("foo", "unquoted identifier");
# Statement terminator
$rejected("1); DROP TABLE users; --", "stacked DROP TABLE");
# UNION attack without the FROM/SELECT/TABLE words that the old checkInjection blocked
$rejected("1) UNION SELECT 1", "UNION SELECT (already blocked previously)");
# SLEEP-based time injection — was NOT blocked by the old checkInjection.
$rejected("1) OR SLEEP(5", "time-based SLEEP injection");
# BENCHMARK-based load injection — was NOT blocked by the old checkInjection.
$rejected("1) OR BENCHMARK(1000000,MD5(1)", "BENCHMARK injection");
# Comment markers
$rejected("1 -- comment", "double-dash SQL comment");
$rejected("1 /* comment */", "C-style SQL comment");
$rejected("1 # hash comment", "hash comment");
# Unbalanced quote
$rejected("'unterminated", "unterminated single quote");
# Embedded semicolon inside a string
$rejected("'foo; bar'", "semicolon inside quoted string");
# Empty / delimiter-only payloads (related to issue #2758 plaintext error).
$rejected("", "empty list");
$rejected(",", "comma-only list");
$rejected("  ", "whitespace-only list");

fwrite(STDOUT, "\nAll validateInList() checks passed.\n");
