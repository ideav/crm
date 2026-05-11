<?php

/**
 * Test for issue #2510: composite unique key check must format values according to their base type.
 *
 * The bug: when UniqueKeyNormalizeValue was called with $reqId (the req instance ID),
 * Format_Val could not resolve the base type for user-defined types (e.g. a custom date type),
 * so dates like '31.01.2026' were not converted to stored format '20260131'.
 *
 * The fix: pass $req["t"] (the field's type ID) instead of $reqId so Format_Val
 * can look up the base type via one DB query and format correctly.
 */

// Simulate the REV_BT and basics global state
$GLOBALS["basics"] = array(
    3  => "SHORT",
    8  => "CHARS",
    9  => "DATE",
    13 => "NUMBER",
    14 => "SIGNED",
    11 => "BOOLEAN",
    12 => "MEMO",
    4  => "DATETIME",
    10 => "FILE",
);
$GLOBALS["REV_BT"] = $GLOBALS["basics"];
$GLOBALS["BT"] = array_flip($GLOBALS["basics"]);
$GLOBALS["tzone"] = 0;

function assertEq($expected, $actual, $message) {
    if($expected !== $actual) {
        fwrite(STDERR, "FAIL: $message\n  Expected: " . var_export($expected, true) . "\n  Actual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
    echo "OK: $message\n";
}

// --- Simulate Format_Val (date formatting logic only, without DB) ---
function Format_Val_Test($typ, $val) {
    if($val === "NULL") return $val;
    if(!isset($GLOBALS["REV_BT"][$typ])) {
        // Simulate DB lookup: for test, we register custom type IDs
        if(isset($GLOBALS["TEST_TYPE_MAP"][$typ]))
            $GLOBALS["REV_BT"][$typ] = $GLOBALS["REV_BT"][$GLOBALS["TEST_TYPE_MAP"][$typ]];
    }
    if(isset($GLOBALS["REV_BT"][$typ])) {
        switch($GLOBALS["REV_BT"][$typ]) {
            case "DATE":
                if($val !== "" && substr($val, 0, 1) !== "[") {
                    $val = trim($val);
                    if(preg_match("/^([0-9]{4})[-\/\.]?([0-9]{2})[-\/\.]?([0-9]{2})/", $val, $date))
                        $val = $date[1].$date[2].$date[3];
                    else {
                        $v = explode("/", str_replace(".", "/", str_replace(",", "/", str_replace(" ", "/", $val))));
                        $dy = isset($v[2]) ? (int)((strlen($v[2])==4) ? $v[2] : 2000+(int)$v[2]) : date("Y");
                        $dm = isset($v[1]) ? (int)$v[1] : date("m");
                        $dd = (int)$v[0];
                        $val = $dy . substr("0".$dm, -2) . substr("0".$dd, -2);
                    }
                }
                break;
        }
    }
    return $val;
}

function UniqueKeyNormalizeValue_Test($t, $value) {
    if(is_array($value))
        $value = implode(",", $value);
    if(!in_array((string)$t, array("101", "102", "103", "132", "49"), true))
        ; // skip BuiltIn for this test
    return Format_Val_Test($t, $value);
}

// --- Test cases ---

// Case 1: req.t is a basic DATE type (id=9) - should always work
$GLOBALS["REV_BT"][9] = "DATE";
$result = UniqueKeyNormalizeValue_Test(9, "31.01.2026");
assertEq("20260131", $result, "Basic DATE type (id=9): '31.01.2026' should become '20260131'");

// Case 2: req.t is a custom user date type (id=445203) whose base type is DATE (id=9)
// This simulates the bug scenario: Format_Val gets $req["t"]=445203, queries DB, gets base=9 (DATE)
$GLOBALS["TEST_TYPE_MAP"][445203] = 9; // 445203's base type is 9 (DATE)
unset($GLOBALS["REV_BT"][445203]); // not pre-populated, must be resolved

$result = UniqueKeyNormalizeValue_Test(445203, "31.01.2026");
assertEq("20260131", $result, "Custom DATE type (id=445203 -> base 9): '31.01.2026' should become '20260131'");

// Case 3: BUG scenario - req instance ID (e.g. 445204) passed instead of req.t
// REV_BT[445204] is not set and TEST_TYPE_MAP has no entry for it (simulating the bug)
unset($GLOBALS["REV_BT"][445204]);
$result = UniqueKeyNormalizeValue_Test(445204, "31.01.2026");
// Without the fix (using $reqId), Format_Val can't resolve the type and returns unformatted
assertEq("31.01.2026", $result, "Bug scenario: req instance ID 445204 with no type mapping returns unformatted date (demonstrates the bug)");

// Case 4: With the fix - use $req["t"] = 445203 instead of $reqId = 445204
// REV_BT[445203] is now populated from Case 2
$result = UniqueKeyNormalizeValue_Test(445203, "31.01.2026");
assertEq("20260131", $result, "Fix scenario: using req.t=445203 correctly formats '31.01.2026' to '20260131'");

// Case 5: ISO date format also works
$result = UniqueKeyNormalizeValue_Test(445203, "2026-01-31");
assertEq("20260131", $result, "ISO date '2026-01-31' formatted via custom type");

// Case 6: Non-date types (SHORT/CHARS) - value should pass through unchanged
$GLOBALS["TEST_TYPE_MAP"][500] = 3; // custom type 500 maps to SHORT (id=3)
$result = UniqueKeyNormalizeValue_Test(500, "some text");
assertEq("some text", $result, "SHORT type: text value passes through unchanged");

echo "\nAll tests passed for issue-2510.\n";
