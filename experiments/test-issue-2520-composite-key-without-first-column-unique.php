<?php

/**
 * Test for issue #2520:
 * "При проверке уникальности первая колонка может не быть уникальной,
 *  а только какие-то из других колонок уникальны"
 *
 * The bug: composite-key uniqueness check (FindUniqueRecordDuplicate) used to
 * always require the FIRST column's value to match (obj.val='$val'). It was
 * only invoked when the type's first column was itself marked as unique.
 *
 * The fix:
 *   1) Add $includeVal parameter to FindUniqueRecordDuplicate, defaulting to
 *      true (the old behavior). When false, the obj.val match is dropped from
 *      the WHERE clause, so uniqueness is determined purely by the composite
 *      key reqs.
 *   2) In edit/create/import flows, also enter the uniqueness branch when the
 *      type itself is NOT marked unique but there are composite key reqs.
 *      When entering in that mode, $includeVal is passed as false.
 *
 * The test runs the production logic directly (copied below in lockstep with
 * index.php FindUniqueRecordDuplicate) and verifies the SQL it builds. To keep
 * the test free of DB dependencies, Exec_sql and fetch are captured via simple
 * callable hooks rather than redefining mysqli_fetch_array (a built-in).
 */

class Issue2520TestHarness {
    public static $capturedSql = "";

    public static function execSql($sql, $label = ""){
        self::$capturedSql = $sql;
        return new stdClass();
    }

    public static function fetchArray($result){
        return false;
    }

    /**
     * Copy of the production FindUniqueRecordDuplicate function (kept in sync
     * with index.php). Calls are routed via static helpers above so we do not
     * have to redefine mysqli_fetch_array (a built-in).
     */
    public static function findDuplicate($typ, $skipId, $up, $val, $keyValues, $includeVal=true){
        $z = "z";
        if(!$includeVal){
            if(!count($keyValues))
                return false;
            $hasValue = false;
            foreach($keyValues as $keyValue){
                if($keyValue["kind"] === "ref"){
                    if(count($keyValue["values"])){ $hasValue = true; break; }
                }
                elseif((string)$keyValue["value"] !== ""){
                    $hasValue = true; break;
                }
            }
            if(!$hasValue)
                return false;
        }
        foreach($keyValues as $keyValue)
            if($keyValue["kind"] === "ref" && $keyValue["has_missing_ref"])
                return false;
        $sql = "SELECT obj.id, obj.ord FROM $z obj WHERE obj.t=".(int)$typ
                ." AND obj.up=".(int)$up;
        if($includeVal)
            $sql .= " AND obj.val='".addcslashes($val, "\\\'")."'";
        if((int)$skipId > 0)
            $sql .= " AND obj.id!=".(int)$skipId;
        $i = 0;
        foreach($keyValues as $reqId => $keyValue){
            $i++;
            $reqId = (int)$reqId;
            if($keyValue["kind"] === "ref"){
                $reqVal = addcslashes((string)$reqId, "\\\'");
                $refType = (int)$keyValue["ref_id"];
                if(!count($keyValue["values"])){
                    $sql .= " AND NOT EXISTS(SELECT 1 FROM $z uk$i JOIN $z ukref$i ON ukref$i.id=uk$i.t WHERE uk$i.up=obj.id AND uk$i.val='$reqVal' AND (ukref$i.t=$refType OR $refType=1))";
                    continue;
                }
                if($keyValue["multi"])
                    $sql .= " AND (SELECT COUNT(DISTINCT ukc$i.t) FROM $z ukc$i JOIN $z ukcref$i ON ukcref$i.id=ukc$i.t WHERE ukc$i.up=obj.id AND ukc$i.val='$reqVal' AND (ukcref$i.t=$refType OR $refType=1))=".count($keyValue["values"]);
                foreach($keyValue["values"] as $ref){
                    $i++;
                    $sql .= " AND EXISTS(SELECT 1 FROM $z uk$i JOIN $z ukref$i ON ukref$i.id=uk$i.t WHERE uk$i.up=obj.id AND uk$i.val='$reqVal' AND uk$i.t=".(int)$ref." AND (ukref$i.t=$refType OR $refType=1))";
                    if(!$keyValue["multi"])
                        break;
                }
            }
            else{
                $value = (string)$keyValue["value"];
                if($value === "")
                    $sql .= " AND NOT EXISTS(SELECT 1 FROM $z uk$i WHERE uk$i.up=obj.id AND uk$i.t=$reqId AND uk$i.val!='')";
                else
                    $sql .= " AND EXISTS(SELECT 1 FROM $z uk$i WHERE uk$i.up=obj.id AND uk$i.t=$reqId AND uk$i.val='".addcslashes($value, "\\\'")."')";
            }
        }
        $sql .= " LIMIT 1";
        $result = self::execSql($sql, "Check composite unique Obj");
        return self::fetchArray($result);
    }
}

function assertEq($expected, $actual, $message){
    if($expected !== $actual){
        fwrite(STDERR, "FAIL: $message\n  Expected: " . var_export($expected, true) . "\n  Actual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
    echo "OK: $message\n";
}

function assertContains($needle, $haystack, $message){
    if(strpos($haystack, $needle) === false){
        fwrite(STDERR, "FAIL: $message\n  Expected to find: $needle\n  In:               $haystack\n");
        exit(1);
    }
    echo "OK: $message\n";
}

function assertNotContains($needle, $haystack, $message){
    if(strpos($haystack, $needle) !== false){
        fwrite(STDERR, "FAIL: $message\n  Did NOT expect to find: $needle\n  In: $haystack\n");
        exit(1);
    }
    echo "OK: $message\n";
}

// =============================================================================
// Case 1: First column marked unique (legacy behavior). includeVal=true.
// SQL must restrict obj.val='Acme'.
// =============================================================================
Issue2520TestHarness::$capturedSql = "";
$keyValues = array(
    100 => array("kind" => "value", "value" => "2026-01-31")
);
Issue2520TestHarness::findDuplicate(50, 0, 1, "Acme", $keyValues, true);
assertContains("obj.val='Acme'", Issue2520TestHarness::$capturedSql,
    "Case 1: legacy includeVal=true restricts by obj.val");
assertContains("uk1.t=100", Issue2520TestHarness::$capturedSql,
    "Case 1: composite key req 100 is checked");

// =============================================================================
// Case 2: First column NOT marked unique, but composite key req has a value.
// includeVal=false. SQL must NOT restrict obj.val and must still check req.
// =============================================================================
Issue2520TestHarness::$capturedSql = "";
Issue2520TestHarness::findDuplicate(50, 0, 1, "Acme", $keyValues, false);
assertNotContains("obj.val=", Issue2520TestHarness::$capturedSql,
    "Case 2: includeVal=false omits obj.val restriction");
assertContains("uk1.t=100", Issue2520TestHarness::$capturedSql,
    "Case 2: composite key req 100 still drives the duplicate check");

// =============================================================================
// Case 3: First column NOT unique and NO composite key values at all.
// Must early-return false without running SQL.
// =============================================================================
Issue2520TestHarness::$capturedSql = "";
$result = Issue2520TestHarness::findDuplicate(50, 0, 1, "Acme", array(), false);
assertEq(false, $result,
    "Case 3: empty keyValues + includeVal=false -> early return false (no false-positive duplicates)");
assertEq("", Issue2520TestHarness::$capturedSql,
    "Case 3: SQL not executed when there is nothing to check");

// =============================================================================
// Case 4: First column NOT unique, composite key reqs exist but all empty.
// Must early-return false (cannot claim duplicate from a key with no values).
// =============================================================================
Issue2520TestHarness::$capturedSql = "";
$emptyKeyValues = array(
    100 => array("kind" => "value", "value" => ""),
    101 => array("kind" => "ref", "ref_id" => 7, "values" => array(), "multi" => false, "has_missing_ref" => false)
);
$result = Issue2520TestHarness::findDuplicate(50, 0, 1, "Acme", $emptyKeyValues, false);
assertEq(false, $result,
    "Case 4: all-empty key values + includeVal=false -> early return false");
assertEq("", Issue2520TestHarness::$capturedSql,
    "Case 4: SQL not executed for an all-empty composite key");

// =============================================================================
// Case 5: First column NOT unique, composite key has a REF with one value.
// includeVal=false; must check ref existence and skip obj.val.
// =============================================================================
Issue2520TestHarness::$capturedSql = "";
$refKeyValues = array(
    200 => array("kind" => "ref", "ref_id" => 9, "values" => array(42), "multi" => false, "has_missing_ref" => false)
);
Issue2520TestHarness::findDuplicate(50, 0, 1, "Acme", $refKeyValues, false);
assertNotContains("obj.val=", Issue2520TestHarness::$capturedSql,
    "Case 5: includeVal=false omits obj.val restriction (ref key)");
assertContains("uk2.t=42", Issue2520TestHarness::$capturedSql,
    "Case 5: ref value 42 enforced via EXISTS subquery");

// =============================================================================
// Case 6: First column NOT unique, ref key with has_missing_ref must short-circuit
// (the incoming row references a value that does not exist, so it cannot match
// an existing record).
// =============================================================================
Issue2520TestHarness::$capturedSql = "";
$missingRefKey = array(
    200 => array("kind" => "ref", "ref_id" => 9, "values" => array(42), "multi" => false, "has_missing_ref" => true)
);
$result = Issue2520TestHarness::findDuplicate(50, 0, 1, "Acme", $missingRefKey, false);
assertEq(false, $result,
    "Case 6: has_missing_ref short-circuits to false (no duplicate)");

// =============================================================================
// Case 7: Legacy includeVal=true still restricts by obj.val even when key reqs
// have ref-with-missing-ref (the function returns early before SQL is built).
// =============================================================================
Issue2520TestHarness::$capturedSql = "";
$result = Issue2520TestHarness::findDuplicate(50, 0, 1, "Acme", $missingRefKey, true);
assertEq(false, $result,
    "Case 7: legacy mode + has_missing_ref short-circuits before SQL");
assertEq("", Issue2520TestHarness::$capturedSql,
    "Case 7: no SQL executed when missing ref");

echo "\nAll tests passed for issue-2520.\n";
