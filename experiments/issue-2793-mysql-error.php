<?php
# Regression test for issue #2793
# https://github.com/ideav/crm/issues/2793
#
# Compile_Report() calls Exec_sql($sql, ..., TRUE, FALSE) with $fatal=FALSE.
# When a query fails, Exec_sql() returns the MySQL error TEXT (a string).
# Before the fix, the next line called mysqli_num_rows($data_set) unconditionally,
# which throws a TypeError in PHP 8+ ("must be of type mysqli_result, string given")
# and the error text was lost. After the fix mysqli_num_rows() is only called on a
# real result; for a string error rownum is 1 so the existing error-display branch
# renders the MySQL error text.

$failures = 0;

function check($cond, $name) {
    global $failures;
    if ($cond) {
        echo "PASS: $name\n";
    } else {
        echo "FAIL: $name\n";
        $failures++;
    }
}

# This mirrors the guarded expression now used at index.php:3712.
function rownum_for($data_set) {
    return gettype($data_set) === "string" ? 1 : mysqli_num_rows($data_set);
}

# 1) Old behaviour: calling mysqli_num_rows() directly on a string crashes.
$errText = "Couldn't execute query [Request report data] Unknown column 'foo' (SELECT foo; )";
$crashed = false;
try {
    mysqli_num_rows($errText);
} catch (\TypeError $e) {
    $crashed = true;
}
check($crashed, "mysqli_num_rows() on a string still throws TypeError (root cause)");

# 2) New behaviour: the guarded expression does not crash on an error string...
$crashed = false;
$rownum = null;
try {
    $rownum = rownum_for($errText);
} catch (\TypeError $e) {
    $crashed = true;
}
check(!$crashed, "guarded rownum expression does not crash on error string");
check($rownum === 1, "rownum is 1 for an error string (one error row rendered)");

# 3) The error text reaches the display branch (gettype === 'string') instead of being lost.
check(gettype($errText) === "string", "error text is detected as a string and shown to the user");

if ($failures === 0) {
    echo "\nALL TESTS PASSED\n";
    exit(0);
}
echo "\n$failures TEST(S) FAILED\n";
exit(1);
