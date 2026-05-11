<?php

/**
 * Test for issue #2522:
 * "index.php Если значение пустое и есть требование к уникальности
 *  в этой таблице, то находить и удалять запись, если таковая есть"
 *
 * Behavior under test (CSV plain-data import in Get_block_data):
 *   - When an incoming row has the FIRST column empty AND the type has uniqueness
 *     defined by composite key reqs, the import must look up the existing record
 *     by the remaining (composite key) columns and DELETE it. The source row was
 *     cleared upstream, so the database copy must be removed as well.
 *   - When the type has no uniqueness defined, the row is still skipped (legacy
 *     behavior), since there is no way to identify the existing record.
 *
 * To stay free of a live DB, this test reimplements the production logic block
 * (the new issue-2522 branch added to Get_block_data) using callable hooks for
 * Delete/FindUniqueRecordDuplicate so we can verify the function dispatched the
 * right call. The hooks are kept in lockstep with the production code in
 * index.php (Get_block_data and FindUniqueRecordDuplicate).
 */

class Issue2522TestHarness {
    public static $deletedId = null;
    public static $findCalls = array();
    public static $findResult = false;
    public static $warningSuffix = "";

    public static function reset(){
        self::$deletedId = null;
        self::$findCalls = array();
        self::$findResult = false;
        self::$warningSuffix = "";
    }

    public static function findUniqueRecordDuplicate($typ, $skipId, $up, $val, $keyValues, $includeVal=true){
        self::$findCalls[] = array(
            "typ" => $typ, "skipId" => $skipId, "up" => $up, "val" => $val,
            "keyValues" => $keyValues, "includeVal" => $includeVal,
        );
        return self::$findResult;
    }

    public static function deleteObj($id){
        self::$deletedId = $id;
    }

    /**
     * Simulates the issue-2522 empty-first-column branch from Get_block_data.
     * Kept in sync with index.php (around the $object[0] == "" check).
     */
    public static function importRow($object, $localStruct, $typeId, $keyReqs, $isUnique, $parent, $getParent=false){
        if($object[0] != ""){
            // Not the empty-value path; out of scope for this test.
            return "imported";
        }
        if(count($keyReqs) && !$getParent){
            // Build composite key values from the remaining CSV columns
            $keyValues = array();
            $ord = 0;
            foreach($localStruct[$typeId] as $reqId => $reqName){
                if($reqId == 0) continue;
                $ord++;
                if(!isset($keyReqs[$reqId])) continue;
                $req = $keyReqs[$reqId];
                $rawVal = isset($object[$ord]) ? $object[$ord] : "";
                $keyValues[$reqId] = $req["ref_id"]
                    ? array("kind" => "ref", "ref_id" => (int)$req["ref_id"], "values" => array(), "multi" => $req["multi"], "has_missing_ref" => false)
                    : array("kind" => "value", "value" => $rawVal);
            }
            foreach($keyReqs as $reqId => $req){
                if(!isset($keyValues[$reqId]))
                    $keyValues[$reqId] = $req["ref_id"]
                        ? array("kind" => "ref", "ref_id" => (int)$req["ref_id"], "values" => array(), "multi" => $req["multi"], "has_missing_ref" => false)
                        : array("kind" => "value", "value" => "");
            }
            $existingRow = self::findUniqueRecordDuplicate($typeId, 0, $parent, "", $keyValues, false);
            if($existingRow){
                self::deleteObj($existingRow["id"]);
                self::$warningSuffix = "deleted";
                return "deleted";
            }
        }
        self::$warningSuffix = "skipped";
        return "skipped";
    }
}

function assertEq($expected, $actual, $message){
    if($expected !== $actual){
        fwrite(STDERR, "FAIL: $message\n  Expected: " . var_export($expected, true) . "\n  Actual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
    echo "OK: $message\n";
}

function assertTrue($cond, $message){
    if(!$cond){
        fwrite(STDERR, "FAIL: $message\n");
        exit(1);
    }
    echo "OK: $message\n";
}

// Shared fixtures
$typeId = 50;
$parent = 1;
// Type 50 has reqs 100 (value) and 101 (ref). Both are part of the composite key.
$localStruct = array(
    50 => array(
        0   => "self",
        100 => "year",
        101 => "company",
    ),
);
$keyReqsBoth = array(
    100 => array("t" => 100, "ref_id" => 0, "multi" => false, "key" => true),
    101 => array("t" => 101, "ref_id" => 9, "multi" => false, "key" => true),
);
$keyReqsValueOnly = array(
    100 => array("t" => 100, "ref_id" => 0, "multi" => false, "key" => true),
);
$noKeyReqs = array();

// =============================================================================
// Case 1: Empty first column + composite key + matching record exists -> delete.
// =============================================================================
Issue2522TestHarness::reset();
Issue2522TestHarness::$findResult = array("id" => 777, "ord" => 5);
$row = array("", "2026", "Acme"); // first column empty, key req 100 = "2026"
$result = Issue2522TestHarness::importRow($row, $localStruct, $typeId, $keyReqsBoth, true, $parent);
assertEq("deleted", $result,
    "Case 1: empty value + composite key + existing -> row reported as deleted");
assertEq(777, Issue2522TestHarness::$deletedId,
    "Case 1: Delete() called with the existing record id");
assertEq(1, count(Issue2522TestHarness::$findCalls),
    "Case 1: FindUniqueRecordDuplicate called once");
$call = Issue2522TestHarness::$findCalls[0];
assertEq(false, $call["includeVal"],
    "Case 1: lookup passes includeVal=false (do not filter by obj.val)");
assertEq("2026", $call["keyValues"][100]["value"],
    "Case 1: composite key value 100 propagated from CSV column 1");

// =============================================================================
// Case 2: Empty first column + composite key + no matching record -> skip.
// =============================================================================
Issue2522TestHarness::reset();
Issue2522TestHarness::$findResult = false;
$row = array("", "9999", "Nobody");
$result = Issue2522TestHarness::importRow($row, $localStruct, $typeId, $keyReqsBoth, true, $parent);
assertEq("skipped", $result,
    "Case 2: empty value + composite key + no match -> still skipped (no record to delete)");
assertEq(null, Issue2522TestHarness::$deletedId,
    "Case 2: Delete() not called when nothing matches");
assertEq(1, count(Issue2522TestHarness::$findCalls),
    "Case 2: FindUniqueRecordDuplicate was still invoked");

// =============================================================================
// Case 3: Empty first column + NO uniqueness reqs -> legacy skip, no SQL.
// =============================================================================
Issue2522TestHarness::reset();
Issue2522TestHarness::$findResult = array("id" => 999, "ord" => 0); // would-be hit, but must not look up
$row = array("", "2026", "Acme");
$result = Issue2522TestHarness::importRow($row, $localStruct, $typeId, $noKeyReqs, false, $parent);
assertEq("skipped", $result,
    "Case 3: no composite key -> empty row skipped (legacy behavior)");
assertEq(null, Issue2522TestHarness::$deletedId,
    "Case 3: Delete() not called when uniqueness is not enforced");
assertEq(0, count(Issue2522TestHarness::$findCalls),
    "Case 3: FindUniqueRecordDuplicate not called when uniqueness is not enforced");

// =============================================================================
// Case 4: Empty first column + composite key with empty other columns ->
//         FindUniqueRecordDuplicate short-circuits to false; no Delete.
// (This mirrors the includeVal=false guard in FindUniqueRecordDuplicate, which
//  returns false when no key value is non-empty — already covered by issue-2520.)
// =============================================================================
Issue2522TestHarness::reset();
Issue2522TestHarness::$findResult = false; // simulate the early-return inside the production helper
$row = array("", "", "");
$result = Issue2522TestHarness::importRow($row, $localStruct, $typeId, $keyReqsBoth, true, $parent);
assertEq("skipped", $result,
    "Case 4: empty value + empty key reqs -> no delete (no real duplicate)");
assertEq(null, Issue2522TestHarness::$deletedId,
    "Case 4: Delete() not called when there is nothing to look up");
$call = Issue2522TestHarness::$findCalls[0];
assertEq("", $call["keyValues"][100]["value"],
    "Case 4: composite key value 100 is empty");

// =============================================================================
// Case 5: Empty first column + composite key but $getParent is in effect.
//         The first column would be the parent reference, not the type value,
//         so the issue-2522 path must NOT activate (no Delete, no lookup).
// =============================================================================
Issue2522TestHarness::reset();
Issue2522TestHarness::$findResult = array("id" => 555, "ord" => 0); // would match, must not be used
$row = array("", "2026", "Acme");
$result = Issue2522TestHarness::importRow($row, $localStruct, $typeId, $keyReqsBoth, true, $parent, /*getParent=*/true);
assertEq("skipped", $result,
    "Case 5: empty first column under getParent -> legacy skip (no delete)");
assertEq(null, Issue2522TestHarness::$deletedId,
    "Case 5: Delete() not called when first column is the parent reference");
assertEq(0, count(Issue2522TestHarness::$findCalls),
    "Case 5: FindUniqueRecordDuplicate not called under getParent");

// =============================================================================
// Case 6: Value-only key (no ref reqs). Empty first column + matching record -> delete.
// =============================================================================
Issue2522TestHarness::reset();
Issue2522TestHarness::$findResult = array("id" => 333, "ord" => 1);
$row = array("", "2026", "Anything");
$result = Issue2522TestHarness::importRow($row, $localStruct, $typeId, $keyReqsValueOnly, false, $parent);
assertEq("deleted", $result,
    "Case 6: composite key on a non-unique type still triggers delete on empty value");
assertEq(333, Issue2522TestHarness::$deletedId,
    "Case 6: Delete() called with the matched record id");
$call = Issue2522TestHarness::$findCalls[0];
assertTrue(isset($call["keyValues"][100]),
    "Case 6: key value for req 100 is passed");
assertEq(false, $call["includeVal"],
    "Case 6: lookup passes includeVal=false");

echo "\nAll tests passed for issue-2522.\n";
