<?php
/**
 * Test for issue #2785:
 * "Как мог появиться дублированный реквизит при импорте?"
 * (How could a duplicate requisite appear during import?)
 *
 * The user uploaded a BKI file via the import endpoint and observed pairs
 * of identical INSERT rows in the resulting "Close batch: Import" SQL
 * statement, e.g.:
 *
 *   (3893632, 1, 2406760, 'Опция OKI Antenna-MC7x0/MB7x0/ES94x5 45518001 ...'),
 *   (3893632, 1, 2406760, 'Опция OKI Antenna-MC7x0/MB7x0/ES94x5 45518001 ...')
 *
 * Same (up, ord, t, val) emitted twice — semantically a single requisite,
 * yet the DB ends up with two rows for it (no UNIQUE constraint protects
 * (up, ord, t, val) on the data table).
 *
 * Looking at the non-plain BKI import branch (index.php:6304-6445), the
 * outer while(!feof) loop reads one line per record, parses it via
 * explode(";") and calls Insert_batch() once per value through the inner
 * foreach. Insert_batch accumulates tuples into $GLOBALS["SQLbatch"] and
 * flushes when the buffer exceeds 31000 chars or when called with
 * $up === "" (close-batch sentinel). There is NO deduplication: every call
 * appends a new ",(up,ord,t,'val')" fragment, so if the import loop emits
 * the same logical requisite twice for any reason (file-side duplication,
 * buffer-extending loop merging two lines, prefix-match in the imported→
 * local type reconciliation pointing two imported orders at the same local
 * key, etc.), both copies land in the batched INSERT.
 *
 * The safest defensive fix — mirroring the dedup caches added by
 * #2769/#2772/#2776/#2780 in Compile_Report — is to dedup at the
 * Insert_batch layer itself: within a single batch, the same
 * (up, ord, t, val) tuple is appended at most once. When the batch flushes
 * (either >31000 chars or "Close batch"), the seen-cache is cleared so
 * unrelated subsequent batches stay independent.
 *
 * The harness below provides a faithful stub of Insert_batch (with the
 * proposed dedup) and exercises the patterns observed in the issue log:
 *   (1) Two identical Insert_batch calls in a row collapse to one row in
 *       the batched INSERT, regardless of the call source (Import req,
 *       Import multi ref, etc.).
 *   (2) Calls with DIFFERENT (up, ord, t, val) tuples are preserved.
 *   (3) The dedup cache is per-batch — a new batch starts fresh after the
 *       previous one flushes (close-batch sentinel or >31000 chars).
 *   (4) The 18-records-then-2-clean-then-5-records-then-1-partial duplication
 *       pattern from the issue log (records 3893615..3893632 duplicated,
 *       3893633..3893634 clean, 3893635..3893639 duplicated, 3893640 partial)
 *       collapses to one row per logical requisite when the dedup is on.
 *   (5) Distinct ord values for the same (up, t, val) (e.g. multi-ref fan-out
 *       where ord increments per value) are still preserved.
 */

# ---------------------------------------------------------------------------
# Reference implementation of Insert_batch with the proposed dedup applied.
# Mirrors index.php's signature and behavior:
#   - $up === "" closes the batch (executes the accumulated INSERT)
#   - the >31000 byte threshold flushes mid-stream
#   - the seen-tuple cache is cleared on every flush so unrelated batches
#     stay independent
# ---------------------------------------------------------------------------
class Issue2785InsertBatchHarness {
    public $executedSQLs = array();   // strings handed to "exec_sql" via flush/close
    public $appendCount = 0;          // number of tuples that survived the dedup
    public $callCount = 0;            // total number of data insertBatch() calls (close-batch sentinel excluded)
    public $flushThreshold;
    public $tableName;

    private $sqlBatch = null;
    private $seenTuples = array();

    public function __construct($tableName = "z", $flushThreshold = 31000){
        $this->tableName = $tableName;
        $this->flushThreshold = $flushThreshold;
    }

    public function insertBatch($up, $ord, $t, $val, $message){
        if($up === "" && $this->sqlBatch !== null){
            $this->executeBatch("Close batch: $message");
            return;
        }
        if($up === "")
            return;
        $this->callCount++;

        # The proposed dedup: skip an identical (up, ord, t, val) tuple if it
        # has already been appended in the current batch.
        $key = $up."\0".$ord."\0".$t."\0".$val;
        if(isset($this->seenTuples[$key]))
            return;
        $this->seenTuples[$key] = true;

        $fragment = "($up,$ord,$t,'".addslashes($val)."')";
        if($this->sqlBatch === null)
            $this->sqlBatch = $fragment;
        else
            $this->sqlBatch .= ",".$fragment;
        $this->appendCount++;

        if(strlen($this->sqlBatch) > $this->flushThreshold)
            $this->executeBatch("Flush batch: $message");
    }

    public function closeBatch($message = "Import"){
        $this->insertBatch("", "", "", "", $message);
    }

    public function tuplesInLastBatch(){
        $matches = array();
        $last = end($this->executedSQLs);
        if($last === false)
            return $matches;
        if(!preg_match_all('/\((\d+),(\d+),(\d+),\'(.*?)\'\)(?:,|$)/s', $last, $m, PREG_SET_ORDER))
            return $matches;
        foreach($m as $row)
            $matches[] = array((int)$row[1], (int)$row[2], (int)$row[3], $row[4]);
        return $matches;
    }

    private function executeBatch($message){
        $sql = "INSERT INTO ".$this->tableName." (up, ord, t, val) VALUES ".$this->sqlBatch;
        $this->executedSQLs[] = $sql;
        $this->sqlBatch = null;
        $this->seenTuples = array();
    }
}

# ---------------------------------------------------------------------------
# Tiny assertion helpers (keep the test runnable with plain `php`).
# ---------------------------------------------------------------------------
$passed = 0;
$failed = 0;
function ok($cond, $msg){
    global $passed, $failed;
    if($cond){ $passed++; echo "  PASS: $msg\n"; }
    else { $failed++; fwrite(STDERR, "  FAIL: $msg\n"); }
}
function eqInt($expected, $actual, $msg){
    ok((int)$expected === (int)$actual, $msg." (expected ".(int)$expected.", got ".(int)$actual.")");
}

# ---------------------------------------------------------------------------
# Scenario 1 — the exact symptom from the issue log:
# the same Insert_batch call repeats twice in a row. With the fix, only the
# first survives; with the bug, both make it into the INSERT.
# ---------------------------------------------------------------------------
echo "\n=== Scenario 1: identical consecutive Insert_batch calls collapse ===\n";
$h = new Issue2785InsertBatchHarness();
$h->insertBatch(3893632, 1, 2406760, "Опция OKI Antenna-MC7x0/MB7x0/ES94x5 45518001 Антенна для MC760/MC770/MC780/MB760/MB70\nТребуется установка сервис инженером", "Import req");
$h->insertBatch(3893632, 1, 2406760, "Опция OKI Antenna-MC7x0/MB7x0/ES94x5 45518001 Антенна для MC760/MC770/MC780/MB760/MB70\nТребуется установка сервис инженером", "Import req");
$h->closeBatch("Import");

eqInt(2, $h->callCount, "Insert_batch was invoked twice");
eqInt(1, $h->appendCount, "only one tuple survived the dedup");
$tuples = $h->tuplesInLastBatch();
eqInt(1, count($tuples), "exactly one (up,ord,t,val) row in the final INSERT");
ok($tuples[0][0] === 3893632, "row's up == 3893632");
ok($tuples[0][2] === 2406760, "row's t == 2406760");

# ---------------------------------------------------------------------------
# Scenario 2 — distinct tuples are preserved.
# ---------------------------------------------------------------------------
echo "\n=== Scenario 2: distinct tuples are preserved ===\n";
$h = new Issue2785InsertBatchHarness();
$h->insertBatch(3893615, 1, 2406758, "43487709", "Import req");
$h->insertBatch(3893615, 1, 2406760, "Тонер-картридж OKI TONER-Y-C86/8800 43487709 Жёлтый для C8600/C8800 на 6,000 стр. A4", "Import req");
$h->insertBatch(3893616, 1, 2406758, "43487710", "Import req");
$h->insertBatch(3893616, 1, 2406760, "Тонер-картридж OKI TONER-M-C86/8800 43487710 Пурпурный для C8600/C8800 на 6,000 стр. A4", "Import req");
$h->closeBatch("Import");

eqInt(4, $h->callCount, "four distinct Insert_batch calls");
eqInt(4, $h->appendCount, "all four tuples survived (no false positives)");
$tuples = $h->tuplesInLastBatch();
eqInt(4, count($tuples), "all four rows in the final INSERT");

# ---------------------------------------------------------------------------
# Scenario 3 — the bug pattern observed in the issue log:
# pairs of (sku, description) emitted twice for the same parent. The dedup
# collapses each pair-of-pairs to a single pair.
# ---------------------------------------------------------------------------
echo "\n=== Scenario 3: pair-of-pairs duplication collapses to a single pair ===\n";
$h = new Issue2785InsertBatchHarness();
# Simulate the foreach in the non-plain branch firing 4 times for record 3893615
# because $object happened to contain (sku, description, sku, description).
$pairs = array(
    array(3893615, 2406758, "43487709"),
    array(3893615, 2406760, "Тонер-картридж OKI TONER-Y-C86/8800 43487709 Жёлтый для C8600/C8800 на 6,000 стр. A4"),
    array(3893615, 2406758, "43487709"),
    array(3893615, 2406760, "Тонер-картридж OKI TONER-Y-C86/8800 43487709 Жёлтый для C8600/C8800 на 6,000 стр. A4"),
);
foreach($pairs as $p)
    $h->insertBatch($p[0], 1, $p[1], $p[2], "Import req");
$h->closeBatch("Import");

eqInt(4, $h->callCount, "non-plain foreach fired 4 times for the same record");
eqInt(2, $h->appendCount, "dedup collapsed the doubled emission back to one (sku, desc) pair");
$tuples = $h->tuplesInLastBatch();
eqInt(2, count($tuples), "INSERT contains exactly the sku row and the description row");
ok($tuples[0][2] === 2406758 && $tuples[0][3] === "43487709", "first row is the SKU");
ok($tuples[1][2] === 2406760, "second row is the description");

# ---------------------------------------------------------------------------
# Scenario 4 — full replay of the issue log's record IDs.
# 17 clean records → 18 doubled records → 2 clean → 5 doubled → 1 partial.
# With the dedup ON, every logical requisite appears once.
# ---------------------------------------------------------------------------
echo "\n=== Scenario 4: 17/18/2/5/1 record blocks from the issue log ===\n";
$h = new Issue2785InsertBatchHarness("z", 1000000);  # large threshold so it all lands in one batch
$skuType = 2406758;
$descType = 2406760;
$emit = function($parentId, $doubled) use ($h, $skuType, $descType){
    $sku = "SKU-$parentId";
    $desc = "Описание $parentId";
    $h->insertBatch($parentId, 1, $skuType, $sku, "Import req");
    $h->insertBatch($parentId, 1, $descType, $desc, "Import req");
    if($doubled){
        # The bug: same call sequence fires a second time for the same parent.
        $h->insertBatch($parentId, 1, $skuType, $sku, "Import req");
        $h->insertBatch($parentId, 1, $descType, $desc, "Import req");
    }
};

for($id = 3893598; $id <= 3893614; $id++) $emit($id, false);     # 17 clean
for($id = 3893615; $id <= 3893632; $id++) $emit($id, true);      # 18 doubled
for($id = 3893633; $id <= 3893634; $id++) $emit($id, false);     # 2 clean
for($id = 3893635; $id <= 3893639; $id++) $emit($id, true);      # 5 doubled
$h->insertBatch(3893640, 1, $skuType, "SKU-3893640", "Import req");  # 1 partial
$h->closeBatch("Import");

$expectedCalls = (17 * 2) + (18 * 4) + (2 * 2) + (5 * 4) + 1;
$expectedAppends = (17 * 2) + (18 * 2) + (2 * 2) + (5 * 2) + 1;
eqInt($expectedCalls, $h->callCount, "total Insert_batch calls match the doubled pattern");
eqInt($expectedAppends, $h->appendCount, "dedup brings the survivor count back to one per logical requisite");

$tuples = $h->tuplesInLastBatch();
# Every parent appears at most twice (one SKU + one description), except 3893640.
$perParent = array();
foreach($tuples as $row){
    $key = $row[0]."\0".$row[2];
    if(!isset($perParent[$key])) $perParent[$key] = 0;
    $perParent[$key]++;
}
$maxRowsPerKey = max($perParent);
eqInt(1, $maxRowsPerKey, "each (parent, type) pair appears at most once in the final INSERT");

# ---------------------------------------------------------------------------
# Scenario 5 — multi-ref fan-out: the same (up, t, val) but DIFFERENT ord
# values must be preserved. This guards against an overly aggressive dedup
# that keys only on (up, t, val).
# ---------------------------------------------------------------------------
echo "\n=== Scenario 5: multi-ref fan-out with incrementing ord stays distinct ===\n";
$h = new Issue2785InsertBatchHarness();
$h->insertBatch(900, 1, 700, "ref1", "Import multi ref");
$h->insertBatch(900, 2, 700, "ref1", "Import multi ref");
$h->insertBatch(900, 3, 700, "ref1", "Import multi ref");
$h->closeBatch("Import");

eqInt(3, $h->callCount, "three multi-ref calls");
eqInt(3, $h->appendCount, "all three preserved (ord differs)");

# ---------------------------------------------------------------------------
# Scenario 6 — dedup cache is per-batch. After a close-batch sentinel, the
# next batch starts with a fresh seen-set so an identical tuple from a
# subsequent import call is not silently dropped.
# ---------------------------------------------------------------------------
echo "\n=== Scenario 6: dedup cache is cleared on flush/close ===\n";
$h = new Issue2785InsertBatchHarness();
$h->insertBatch(100, 1, 200, "hello", "Import req");
$h->closeBatch("Import");           # batch 1 closes — cache must clear
$h->insertBatch(100, 1, 200, "hello", "Import req");
$h->closeBatch("Import");           # batch 2 closes

eqInt(2, count($h->executedSQLs), "two separate batches executed");
$tuples1 = array(); $tuples2 = array();
preg_match_all('/\((\d+),(\d+),(\d+),\'(.*?)\'\)/', $h->executedSQLs[0], $m1);
preg_match_all('/\((\d+),(\d+),(\d+),\'(.*?)\'\)/', $h->executedSQLs[1], $m2);
eqInt(1, count($m1[0]), "first batch contains one row");
eqInt(1, count($m2[0]), "second batch contains one row (NOT silently dropped)");

# ---------------------------------------------------------------------------
# Scenario 7 — mid-stream flush at >31000 chars also clears the cache.
# ---------------------------------------------------------------------------
echo "\n=== Scenario 7: >31000-byte mid-stream flush clears the cache ===\n";
$h = new Issue2785InsertBatchHarness("z", 80);  # tiny threshold for the test
# Emit enough distinct tuples to exceed 80 bytes
for($i = 1; $i <= 12; $i++)
    $h->insertBatch($i, 1, 7, "val-$i", "Import req");
# At this point at least one Flush batch has fired. Adding a duplicate of
# tuple #1 must succeed (the cache for the flushed batch is gone).
$h->insertBatch(1, 1, 7, "val-1", "Import req");
$h->closeBatch("Import");

# Confirm that tuple (1,1,7,'val-1') appears EXACTLY twice across all
# executed batches — once in the initial batch, once in the post-flush one.
$count_1_1_7 = 0;
foreach($h->executedSQLs as $sql)
    $count_1_1_7 += substr_count($sql, "(1,1,7,'val-1')");
eqInt(2, $count_1_1_7, "post-flush re-emission of (1,1,7,'val-1') is preserved");

echo "\n=== Results: $passed passed, $failed failed ===\n\n";
exit($failed > 0 ? 1 : 0);
