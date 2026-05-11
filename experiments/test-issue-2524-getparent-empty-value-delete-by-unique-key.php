<?php

/**
 * Test for issue #2524:
 * "https://github.com/ideav/crm/pull/2523 getParent() не отменяет логики очистки
 *  значений для уникальных строк, просто значение не в первой колонке файла, а
 *  во второй"
 *
 * Behavior under test (CSV plain-data import in Get_block_data, getParent mode):
 *   - When $getParent is active, CSV column 0 is the parent reference and the
 *     record's own value lives in column 1 (the second column). After the import
 *     resolves the parent and `array_shift`s, the value moves to $object[0].
 *   - If that value is empty AND the type has uniqueness defined by composite
 *     key reqs, the import must look up the existing record under the resolved
 *     parent by the remaining (composite key) columns and DELETE it — mirroring
 *     the issue-2522 fix that was previously skipped for getParent.
 *   - If the parent reference (column 0) itself is empty, the legacy
 *     "skip" branch at the top of the loop handles the row; the issue-2522
 *     branch still does not run under getParent because there is no parent to
 *     scope the lookup. This part is unchanged by issue-2524.
 *
 * Like the issue-2522 test, this stays free of a live DB by reimplementing the
 * production logic block from Get_block_data using callable hooks for
 * Delete/FindUniqueRecordDuplicate to verify the dispatched call.
 */

class Issue2524TestHarness {
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
     * Simulates the post-array_shift empty-value branch added for issue-2524
     * in Get_block_data. Kept in sync with index.php.
     *
     * Inputs:
     *   $object       — CSV columns AFTER getParent's array_shift (so $object[0]
     *                   is the record value, $object[1..] are reqs in local_struct order).
     *   $resolvedParent — id resolved from the original first column.
     *   $keyReqs      — UniqueKeyReqs($id) result. Empty = no composite key.
     */
    public static function postShiftRow($object, $localStruct, $typeId, $keyReqs, $resolvedParent){
        if($object[0] !== "")
            return "imported"; // value is present; out of scope for this fix
        if(!count($keyReqs)){
            self::$warningSuffix = "skipped";
            return "skipped"; // legacy skip: no key, nothing to delete by
        }
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
        $existingRow = self::findUniqueRecordDuplicate($typeId, 0, $resolvedParent, "", $keyValues, false);
        if($existingRow){
            self::deleteObj($existingRow["id"]);
            self::$warningSuffix = "deleted";
            return "deleted";
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

// Shared fixtures: a child type whose composite key spans both reqs.
$typeId = 60;
$resolvedParent = 4242; // id resolved from the CSV's first column (parent ref)
$localStruct = array(
    60 => array(
        0   => "self",
        110 => "year",
        111 => "vendor",
    ),
);
$keyReqsBoth = array(
    110 => array("t" => 110, "ref_id" => 0, "multi" => false, "key" => true),
    111 => array("t" => 111, "ref_id" => 12, "multi" => false, "key" => true),
);
$keyReqsValueOnly = array(
    110 => array("t" => 110, "ref_id" => 0, "multi" => false, "key" => true),
);
$noKeyReqs = array();

// =============================================================================
// Case 1: getParent + empty value (column 1) + composite key + match -> delete.
//         (Post-shift state: $object[0]="", $object[1]="2026", $object[2]="Acme".)
// =============================================================================
Issue2524TestHarness::reset();
Issue2524TestHarness::$findResult = array("id" => 8001, "ord" => 3);
$row = array("", "2026", "Acme");
$result = Issue2524TestHarness::postShiftRow($row, $localStruct, $typeId, $keyReqsBoth, $resolvedParent);
assertEq("deleted", $result,
    "Case 1: empty value under getParent + composite key + existing -> deleted");
assertEq(8001, Issue2524TestHarness::$deletedId,
    "Case 1: Delete() called with the existing record id");
assertEq(1, count(Issue2524TestHarness::$findCalls),
    "Case 1: FindUniqueRecordDuplicate called once");
$call = Issue2524TestHarness::$findCalls[0];
assertEq(false, $call["includeVal"],
    "Case 1: lookup passes includeVal=false (do not filter by obj.val)");
assertEq($resolvedParent, $call["up"],
    "Case 1: lookup uses the resolved parent id (scoped uniqueness)");
assertEq("2026", $call["keyValues"][110]["value"],
    "Case 1: composite key value 110 propagated from CSV column 1 (post-shift index 1)");

// =============================================================================
// Case 2: getParent + empty value + composite key + no match -> skip, no delete.
// =============================================================================
Issue2524TestHarness::reset();
Issue2524TestHarness::$findResult = false;
$row = array("", "9999", "Nobody");
$result = Issue2524TestHarness::postShiftRow($row, $localStruct, $typeId, $keyReqsBoth, $resolvedParent);
assertEq("skipped", $result,
    "Case 2: empty value under getParent + no match -> skipped (no record to delete)");
assertEq(null, Issue2524TestHarness::$deletedId,
    "Case 2: Delete() not called when nothing matches");
assertEq(1, count(Issue2524TestHarness::$findCalls),
    "Case 2: FindUniqueRecordDuplicate was still invoked");
$call = Issue2524TestHarness::$findCalls[0];
assertEq($resolvedParent, $call["up"],
    "Case 2: lookup is still scoped under the resolved parent");

// =============================================================================
// Case 3: getParent + empty value + NO uniqueness reqs -> legacy import path,
//         no Find/Delete (the fix must not change behavior for non-unique types).
// =============================================================================
Issue2524TestHarness::reset();
Issue2524TestHarness::$findResult = array("id" => 7777, "ord" => 0); // unused
$row = array("", "2026", "Acme");
$result = Issue2524TestHarness::postShiftRow($row, $localStruct, $typeId, $noKeyReqs, $resolvedParent);
assertEq("skipped", $result,
    "Case 3: empty value under getParent + no key -> skipped, no delete");
assertEq(null, Issue2524TestHarness::$deletedId,
    "Case 3: Delete() not called when uniqueness is not enforced");
assertEq(0, count(Issue2524TestHarness::$findCalls),
    "Case 3: FindUniqueRecordDuplicate not called when uniqueness is not enforced");

// =============================================================================
// Case 4: getParent + empty value + composite key with all empty key cols ->
//         FindUniqueRecordDuplicate short-circuits to false; no Delete.
// =============================================================================
Issue2524TestHarness::reset();
Issue2524TestHarness::$findResult = false; // simulate production short-circuit
$row = array("", "", "");
$result = Issue2524TestHarness::postShiftRow($row, $localStruct, $typeId, $keyReqsBoth, $resolvedParent);
assertEq("skipped", $result,
    "Case 4: empty value + empty key cols under getParent -> no delete");
assertEq(null, Issue2524TestHarness::$deletedId,
    "Case 4: Delete() not called when there is nothing to look up");
$call = Issue2524TestHarness::$findCalls[0];
assertEq("", $call["keyValues"][110]["value"],
    "Case 4: composite key value 110 is empty");

// =============================================================================
// Case 5: getParent + non-empty value (column 1 populated) -> falls through to
//         the normal import path; the new branch must NOT activate.
// =============================================================================
Issue2524TestHarness::reset();
Issue2524TestHarness::$findResult = array("id" => 5555, "ord" => 0); // would match, must not be used
$row = array("2026", "Acme", "extra"); // post-shift first column non-empty
$result = Issue2524TestHarness::postShiftRow($row, $localStruct, $typeId, $keyReqsBoth, $resolvedParent);
assertEq("imported", $result,
    "Case 5: non-empty value under getParent -> normal import (no delete here)");
assertEq(null, Issue2524TestHarness::$deletedId,
    "Case 5: Delete() not called when value is present");
assertEq(0, count(Issue2524TestHarness::$findCalls),
    "Case 5: FindUniqueRecordDuplicate not called when value is present");

// =============================================================================
// Case 6: getParent + value-only composite key (no ref reqs) + match -> delete.
// =============================================================================
Issue2524TestHarness::reset();
Issue2524TestHarness::$findResult = array("id" => 4444, "ord" => 1);
$row = array("", "2026", "Anything");
$result = Issue2524TestHarness::postShiftRow($row, $localStruct, $typeId, $keyReqsValueOnly, $resolvedParent);
assertEq("deleted", $result,
    "Case 6: value-only composite key under getParent triggers delete on empty value");
assertEq(4444, Issue2524TestHarness::$deletedId,
    "Case 6: Delete() called with the matched record id");
$call = Issue2524TestHarness::$findCalls[0];
assertTrue(isset($call["keyValues"][110]),
    "Case 6: key value for req 110 is passed");
assertEq(false, $call["includeVal"],
    "Case 6: lookup passes includeVal=false");
assertEq($resolvedParent, $call["up"],
    "Case 6: lookup is scoped under the resolved parent");

// =============================================================================
// Case 7: Root parent (parent=1). The fix should work uniformly: per the issue
//         description "у корневых записей родитель - 1, но работает всё так же".
// =============================================================================
Issue2524TestHarness::reset();
Issue2524TestHarness::$findResult = array("id" => 3030, "ord" => 1);
$row = array("", "2026", "Acme");
$result = Issue2524TestHarness::postShiftRow($row, $localStruct, $typeId, $keyReqsBoth, /*resolvedParent=*/1);
assertEq("deleted", $result,
    "Case 7: empty value under getParent + parent=1 (root) -> still deletes");
assertEq(3030, Issue2524TestHarness::$deletedId,
    "Case 7: Delete() called with the matched record id under root parent");
$call = Issue2524TestHarness::$findCalls[0];
assertEq(1, $call["up"],
    "Case 7: lookup scoped under parent=1");

echo "\nAll tests passed for issue-2524.\n";
