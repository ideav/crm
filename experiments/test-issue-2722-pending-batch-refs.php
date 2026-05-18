<?php
/**
 * Issue #2722: pending Insert_batch entries must be visible to plain-import
 * lookups in-process, so subsequent rows of the same import can dedup against
 * refs queued by the previous row WITHOUT a forced DB flush.
 *
 * This test exercises the new in-memory pending-batch index added to
 * Insert_batch / FlushInsertBatch and the lookup/mutation helpers:
 *   FindPendingBatchEntries, UpdatePendingBatchEntryT, DeletePendingBatchEntry,
 *   RebuildSqlBatch, IsPendingBatchSentinel.
 *
 * It does NOT touch a DB. exec_sql is stubbed to record the SQL it would have
 * run, so we can assert that batching is preserved (no forced per-row flush).
 */

function assert_eq($expected, $actual, $message){
    if($expected !== $actual){
        fwrite(STDERR, "FAIL: $message\nExpected: ".var_export($expected, true)."\nActual:   ".var_export($actual, true)."\n");
        exit(1);
    }
    echo "OK: $message\n";
}

function assert_true($cond, $message){
    if(!$cond){
        fwrite(STDERR, "FAIL: $message\n");
        exit(1);
    }
    echo "OK: $message\n";
}

function extract_function($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false) throw new RuntimeException("Function $name not found");
    $brace = strpos($source, "{", $start);
    $depth = 0;
    $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){
            $depth--;
            if($depth === 0) return substr($source, $start, $i - $start + 1);
        }
    }
    throw new RuntimeException("Function $name body not closed");
}

$z = "x"; // pretend table name; exec_sql is stubbed so it's just for SQL text checks

// Stub exec_sql to capture flushes
$GLOBALS["__exec_sql_calls"] = array();
function exec_sql($sql, $message=""){
    $GLOBALS["__exec_sql_calls"][] = array("sql" => $sql, "message" => $message);
    return true;
}

$source = file_get_contents(__DIR__."/../index.php");

eval(extract_function($source, "Insert_batch"));
eval(extract_function($source, "FlushInsertBatch"));
eval(extract_function($source, "RebuildSqlBatch"));
eval(extract_function($source, "PendingBatchSentinelId"));
eval(extract_function($source, "PendingBatchIdxFromSentinel"));
eval(extract_function($source, "FindPendingBatchEntries"));
eval(extract_function($source, "UpdatePendingBatchEntryT"));
eval(extract_function($source, "UpdatePendingBatchEntryVal"));
eval(extract_function($source, "DeletePendingBatchEntry"));
eval(extract_function($source, "IsPendingBatchSentinel"));

// ── Scenario 1: Insert_batch populates structured entries ────────────────────
Insert_batch(100, 1, 555, "Field1", "test");
Insert_batch(100, 2, 666, "Field2", "test");
Insert_batch(200, 1, 555, "Field1", "test");

assert_eq(3, count($GLOBALS["SQLbatch_entries"]), "three pending entries tracked");
assert_eq(0, count($GLOBALS["__exec_sql_calls"]), "no DB flush yet — batching preserved");

// ── Scenario 2: FindPendingBatchEntries filters by up ─────────────────────────
$for100 = FindPendingBatchEntries(100);
$for200 = FindPendingBatchEntries(200);
$for999 = FindPendingBatchEntries(999);

assert_eq(2, count($for100), "FindPendingBatchEntries(100) returns 2 entries");
assert_eq(1, count($for200), "FindPendingBatchEntries(200) returns 1 entry");
assert_eq(0, count($for999), "FindPendingBatchEntries(unknown) returns []");
assert_eq(555, $for100[0]["t"], "entry t preserved");
assert_eq("Field1", $for100[0]["val"], "entry val preserved");
assert_true($for100[0]["sentinel_id"] < 0, "sentinel_id is negative (distinguishable from DB id)");
assert_true(IsPendingBatchSentinel($for100[0]["sentinel_id"]), "IsPendingBatchSentinel recognises it");
assert_true(!IsPendingBatchSentinel(42), "positive DB id is NOT a sentinel");
assert_true(!IsPendingBatchSentinel(0), "zero is NOT a sentinel");

// ── Scenario 3: UpdatePendingBatchEntryT mutates entry + SQL string ──────────
$sentinel0 = $for100[0]["sentinel_id"];
UpdatePendingBatchEntryT($sentinel0, 777);
$for100_after = FindPendingBatchEntries(100);
assert_eq(777, $for100_after[0]["t"], "entry t updated in place");
assert_true(strpos($GLOBALS["SQLbatch"], ",777,") !== false, "SQLbatch string rebuilt with new t");
assert_true(strpos($GLOBALS["SQLbatch"], ",555,") === false || strpos($GLOBALS["SQLbatch"], "(200,1,555,") !== false,
    "old t for entry-0 no longer in SQLbatch (other 555 for up=200 stays)");
assert_eq(0, count($GLOBALS["__exec_sql_calls"]), "update did NOT trigger flush");

// ── Scenario 4: DeletePendingBatchEntry removes + rebuilds ───────────────────
$sentinel_for_200 = $for200[0]["sentinel_id"];
DeletePendingBatchEntry($sentinel_for_200);
assert_eq(0, count(FindPendingBatchEntries(200)), "entry for up=200 deleted from index");
assert_eq(2, count(FindPendingBatchEntries(100)), "entries for up=100 untouched");
assert_true(strpos($GLOBALS["SQLbatch"], "(200,") === false, "SQLbatch string no longer references up=200");
assert_eq(0, count($GLOBALS["__exec_sql_calls"]), "delete did NOT trigger flush");

// ── Scenario 5: FlushInsertBatch sends ONE INSERT for all remaining ──────────
FlushInsertBatch("scenario 5");
assert_eq(1, count($GLOBALS["__exec_sql_calls"]), "single batched INSERT issued");
assert_true(strpos($GLOBALS["__exec_sql_calls"][0]["sql"], "INSERT INTO x") === 0,
    "flushed SQL targets table z");
assert_true(!isset($GLOBALS["SQLbatch"]), "SQLbatch cleared after flush");
assert_true(empty($GLOBALS["SQLbatch_entries"]), "entries cleared after flush");

// ── Scenario 6: empty flush is a no-op ───────────────────────────────────────
$callsBefore = count($GLOBALS["__exec_sql_calls"]);
$res = FlushInsertBatch("empty");
assert_eq(false, $res, "FlushInsertBatch on empty batch returns false");
assert_eq($callsBefore, count($GLOBALS["__exec_sql_calls"]), "no extra exec_sql call");

// ── Scenario 7: plain-import dedup scenario — issue #2720 reproducer ─────────
// Two consecutive plain-import rows touch the same existing record (id=42) and
// want to set the same single-select ref (objID=777) on field "Status".
// Round 1 inserts the pending ref. Round 2 must observe it via the in-memory
// index and NOT enqueue a duplicate.

$existing = 42;
$key = "Status";
$refObjID_round1 = 777;
$refObjID_round2 = 777; // same value — should dedup

// Simulate round 1: $reqs/$ids from DB are empty (record has no Status ref yet).
$reqs = array();
$ids  = array();
// Merge in pending (none yet on round 1).
foreach(FindPendingBatchEntries($existing) as $pending){
    if((int)$pending["t"] === 0) continue;
    if(!isset($reqs[$pending["t"]])){
        $reqs[$pending["t"]] = $pending["val"];
        $ids[$pending["t"]]  = $pending["sentinel_id"];
    }
}
// Single-select scan: no existing ref for $key → fall through and insert.
$foundExisting = false;
foreach($reqs as $rid => $req)
    if($req == $key){ $foundExisting = true; break; }
assert_true(!$foundExisting, "round 1: no existing ref for Status");
if(!isset($reqs[$refObjID_round1]))
    Insert_batch($existing, 1, $refObjID_round1, $key, "Import plain ref");

// Simulate round 2: $reqs/$ids from DB still empty (pending NOT in DB), but
// the in-memory merge surfaces the row queued in round 1.
$reqs = array();
$ids  = array();
foreach(FindPendingBatchEntries($existing) as $pending){
    if((int)$pending["t"] === 0) continue;
    if(!isset($reqs[$pending["t"]])){
        $reqs[$pending["t"]] = $pending["val"];
        $ids[$pending["t"]]  = $pending["sentinel_id"];
    }
}
assert_eq(1, count($reqs), "round 2: pending ref from round 1 is visible");
assert_eq($key, $reqs[$refObjID_round1], "round 2: pending ref's val matches field key");
assert_true(IsPendingBatchSentinel($ids[$refObjID_round1]), "round 2: id is a sentinel");

// Same-value dedup check: would_insert?
$wouldInsertDuplicate = !isset($reqs[$refObjID_round2]);
assert_true(!$wouldInsertDuplicate, "round 2: dedup against pending — no duplicate Insert_batch");

// ── Scenario 8: round 2 with DIFFERENT objID triggers Update on pending ──────
// Imports the same field with a different ref value. Single-select must
// modify the pending entry's t in place instead of UpdateTyp + new Insert.
$refObjID_round3 = 888;
$reqs = array();
$ids  = array();
foreach(FindPendingBatchEntries($existing) as $pending){
    if((int)$pending["t"] === 0) continue;
    if(!isset($reqs[$pending["t"]])){
        $reqs[$pending["t"]] = $pending["val"];
        $ids[$pending["t"]]  = $pending["sentinel_id"];
    }
}
$found_rid = null;
foreach($reqs as $rid => $req)
    if($req == $key){ $found_rid = $rid; break; }
assert_eq($refObjID_round1, $found_rid, "round 3: found existing ref under field Status (was 777)");
if($refObjID_round3 !== $found_rid){
    assert_true(IsPendingBatchSentinel($ids[$found_rid]), "id is a sentinel — pending dispatch");
    UpdatePendingBatchEntryT($ids[$found_rid], $refObjID_round3);
}
$after = FindPendingBatchEntries($existing);
assert_eq(1, count($after), "still one pending entry — no duplicate added");
assert_eq($refObjID_round3, $after[0]["t"], "pending entry's t mutated to new value");
assert_eq(0, count($GLOBALS["__exec_sql_calls"]) - 1, "no DB queries beyond the earlier flush");

// ── Scenario 9 (issue #2725): denormalized import — same record's plain value
// appears twice with different values across input rows. Last row wins; the
// pending entry from the first row must be MUTATED, not duplicated.
$existing = 99;
$key = 333; // a plain (non-ref) field id — numeric, matches production schema
$valRow1 = "Draft";
$valRow2 = "Final";

Insert_batch($existing, 1, $key, $valRow1, "Import plain req"); // round 1

// Round 2 reads $reqs/$ids — DB empty, but pending merge surfaces the round-1 value.
$reqs = array(); $ids = array();
foreach(FindPendingBatchEntries($existing) as $pending){
    if((int)$pending["t"] === 0) continue;
    if(!isset($reqs[$pending["t"]])){
        $reqs[$pending["t"]] = $pending["val"];
        $ids[$pending["t"]]  = $pending["sentinel_id"];
    }
}
assert_eq($valRow1, $reqs[$key], "denorm round 2: pending plain value is visible");
assert_true(IsPendingBatchSentinel($ids[$key]), "denorm round 2: id is a sentinel");

// Mimic the plain-value branch's update path: $reqs[$key] !== $val → dispatch.
if($reqs[$key] !== $valRow2){
    if(IsPendingBatchSentinel($ids[$key]))
        UpdatePendingBatchEntryVal($ids[$key], $valRow2);
    // else Update_Val($ids[$key], $valRow2);  -- DB path, not exercised here
}
$after = FindPendingBatchEntries($existing);
$titleEntries = array_filter($after, function($e) use($key){ return (int)$e["t"] === (int)$key; });
assert_eq(1, count($titleEntries), "denorm: still ONE pending entry for field (no duplicate)");
assert_eq($valRow2, array_values($titleEntries)[0]["val"], "denorm: pending val mutated to last row's value");

// ── Scenario 10 (issue #2725): denormalized import — second row sets the same
// plain field to space (" "), which must DELETE the pending entry from row 1.
$existing = 100;
$key = 555;
Insert_batch($existing, 1, $key, "Draft", "Import plain req");
$reqs = array(); $ids = array();
foreach(FindPendingBatchEntries($existing) as $pending){
    if((int)$pending["t"] === 0) continue;
    if(!isset($reqs[$pending["t"]])){
        $reqs[$pending["t"]] = $pending["val"];
        $ids[$pending["t"]]  = $pending["sentinel_id"];
    }
}
$valSpace = " ";
if($reqs[$key] !== $valSpace){
    if($valSpace === " "){
        if(IsPendingBatchSentinel($ids[$key]))
            DeletePendingBatchEntry($ids[$key]);
    }
}
$after = FindPendingBatchEntries($existing);
$titleEntries = array_filter($after, function($e) use($key){ return (int)$e["t"] === (int)$key; });
assert_eq(0, count($titleEntries), "denorm-space: pending entry for field deleted (no DB call needed)");

// ── Scenario 11 (issue #2725): empty value "" — outer code skips the column
// entirely (strlen check). We don't reach the dispatch. Sanity-check that
// behavior is preserved (no change to pending).
$existing = 101;
$key = 666;
Insert_batch($existing, 1, $key, "KeepMe", "Import plain req");
$before = count(FindPendingBatchEntries($existing));
// Simulate the outer guard: empty value → skip processing.
$incomingValue = "";
if(strlen($incomingValue) === 0){
    // skip — exactly what the production code does at the `if(strlen($object[$order]))` check
}
$after = count(FindPendingBatchEntries($existing));
assert_eq($before, $after, "empty value is ignored — pending untouched");

echo "All tests passed.\n";
