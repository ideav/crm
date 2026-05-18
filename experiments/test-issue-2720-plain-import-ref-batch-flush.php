<?php

/**
 * Issue #2720 plain import batch visibility checks.
 *
 * PR #2715 fixed replacement of plain DATA reference values, but the import
 * code batches requisite/reference inserts. A later row for the same record
 * cannot see those rows in SELECT queries until the insert batch is flushed.
 */

function assert_eq($expected, $actual, $message){
    if($expected !== $actual){
        fwrite(STDERR, "FAIL: $message\nExpected: ".var_export($expected, true)."\nActual:   ".var_export($actual, true)."\n");
        exit(1);
    }
    echo "OK: $message\n";
}

function assert_contains($needle, $haystack, $message){
    if(strpos($haystack, $needle) === false){
        fwrite(STDERR, "FAIL: $message\nMissing: $needle\n");
        exit(1);
    }
    echo "OK: $message\n";
}

function extract_function($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false)
        throw new RuntimeException("Function $name not found");
    $brace = strpos($source, "{", $start);
    $depth = 0;
    $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{")
            $depth++;
        elseif($source[$i] === "}"){
            $depth--;
            if($depth === 0)
                return substr($source, $start, $i - $start + 1);
        }
    }
    throw new RuntimeException("Function $name body not closed");
}

class Issue2720BatchHarness {
    public $committedRefs = array();
    public $batchRefs = array();
    public $nextReqId = 1000;
    public $flushes = 0;

    public function currentRefs($recordId, $reqId){
        if(isset($this->committedRefs[$recordId]) && isset($this->committedRefs[$recordId][$reqId]))
            return $this->committedRefs[$recordId][$reqId];
        return array();
    }

    public function insertBatch($recordId, $reqId, $refObjId){
        $this->batchRefs[] = array("recordId" => $recordId, "reqId" => $reqId, "refObjId" => $refObjId);
    }

    public function flushBatch(){
        if(!count($this->batchRefs))
            return;
        $this->flushes++;
        foreach($this->batchRefs as $row){
            $recordId = $row["recordId"];
            $reqId = $row["reqId"];
            $refObjId = $row["refObjId"];
            if(!isset($this->committedRefs[$recordId]))
                $this->committedRefs[$recordId] = array();
            if(!isset($this->committedRefs[$recordId][$reqId]))
                $this->committedRefs[$recordId][$reqId] = array();
            if(!isset($this->committedRefs[$recordId][$reqId][$refObjId]))
                $this->committedRefs[$recordId][$reqId][$refObjId] = array();
            $this->committedRefs[$recordId][$reqId][$refObjId][] = $this->nextReqId++;
        }
        $this->batchRefs = array();
    }

    public function importSingleRefWithoutLookupFlush($recordId, $reqId, $refObjId){
        $currentRefs = $this->currentRefs($recordId, $reqId);
        if(count($currentRefs))
            return "kept";
        $this->insertBatch($recordId, $reqId, $refObjId);
        return "inserted";
    }

    public function importSingleRefWithLookupFlush($recordId, $reqId, $refObjId){
        $this->flushBatch();
        return $this->importSingleRefWithoutLookupFlush($recordId, $reqId, $refObjId);
    }

    public function committedRefCount($recordId, $reqId, $refObjId){
        return count($this->committedRefs[$recordId][$reqId][$refObjId]);
    }
}

$recordId = 43072;
$statusReq = 8907;
$done = 8925;

$old = new Issue2720BatchHarness();
assert_eq("inserted", $old->importSingleRefWithoutLookupFlush($recordId, $statusReq, $done),
    "old path queues the first missing single-select ref");
assert_eq("inserted", $old->importSingleRefWithoutLookupFlush($recordId, $statusReq, $done),
    "old path cannot see the pending batch row and queues a duplicate");
$old->flushBatch();
assert_eq(2, $old->committedRefCount($recordId, $statusReq, $done),
    "old path reproduces duplicate refs after final batch flush");

$fixed = new Issue2720BatchHarness();
assert_eq("inserted", $fixed->importSingleRefWithLookupFlush($recordId, $statusReq, $done),
    "fixed path queues the first missing single-select ref");
assert_eq("kept", $fixed->importSingleRefWithLookupFlush($recordId, $statusReq, $done),
    "fixed path flushes before lookup and sees the existing ref");
$fixed->flushBatch();
assert_eq(1, $fixed->committedRefCount($recordId, $statusReq, $done),
    "fixed path keeps only one ref after final batch flush");

$index = file_get_contents(__DIR__."/../index.php");
assert_contains("function FlushInsertBatch(", $index,
    "production code exposes an explicit insert-batch flush helper");
assert_contains("FlushInsertBatch(\"Before plain import lookup\")", $index,
    "plain DATA import flushes pending inserts before DB-backed lookups");

$executedSql = array();
$z = "issue2720_tmp";
function exec_sql($sql, $message){
    global $executedSql;
    $executedSql[] = array($sql, $message);
}
eval(extract_function($index, "FlushInsertBatch"));
eval(extract_function($index, "Insert_batch"));

unset($GLOBALS["SQLbatch"]);
Insert_batch("", "", "", "", "Empty close");
assert_eq(0, count($executedSql),
    "closing an empty insert batch does not execute malformed SQL");

Insert_batch(1, 1, 2, "Done", "Queue ref");
assert_eq(0, count($executedSql),
    "queued insert remains pending before an explicit flush");
assert_eq("(1,1,2,'Done')", $GLOBALS["SQLbatch"],
    "queued insert is stored in SQLbatch");
assert_eq(TRUE, FlushInsertBatch("Before lookup"),
    "explicit flush reports that a pending batch was closed");
assert_eq(array("INSERT INTO issue2720_tmp (up, ord, t, val) VALUES (1,1,2,'Done')", "Close batch: Before lookup"), $executedSql[0],
    "explicit flush writes the pending batch with the requested trace message");
assert_eq(FALSE, isset($GLOBALS["SQLbatch"]),
    "explicit flush clears SQLbatch");

echo "\nAll issue-2720 plain import batch flush checks passed.\n";
