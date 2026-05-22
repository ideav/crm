<?php
/**
 * Test for issue #2772:
 * When the same unknown word (e.g. "черный") appears across MULTIPLE records
 * being edited in a single Compile_Report pass, the deferred-Insert pipeline
 * from #2770/#2771 must:
 *   1. assign the SAME placeholder id to the same value across records during
 *      the preview pass — so the operator sees one consistent "(новое) черный"
 *      reference, not a separate negative id per row, and
 *   2. perform exactly ONE Insert when the operator confirms — not one Insert
 *      per record that mentions the word.
 *
 * Additionally — and surfaced by #2772 in production data — when the records
 * being updated are EXISTING rows (the elseif(!isset($value["val"][$n])) UPDATE
 * branch of Compile_Report, not the new-record branch), the pending placeholder
 * MUST still be materialized before the UPDATE writes t=, otherwise the SQL
 * sets t to a negative placeholder id.
 *
 * The harness below mirrors that resolve / execute split across multiple rows.
 *
 * Cross-record dedup is what makes the second Тонер-картридж row (#2857984)
 * reuse the same brand new "черный" ref id that the first row (#2848986)
 * minted — instead of each row creating its own duplicate "черный" entry.
 */

class Issue2772MultiRecordHarness {
    public $insertedNextId = 1000;
    public $refsByVal = array();
    public $inserts = array();            // Inserts performed in execute()
    public $prepareInserts = array();     // Inserts in prepare() — MUST stay empty
    public $pendingSeq = 0;
    public $dsRefs = array();
    public $records = array();            // $rec => array("t" => id, "tList" => [...])
    public $pendingByVal = array();       // column-wide val => placeholder id
    public $tListPending = array();       // $rec => array(placeholder => entry)

    public function __construct($refsByVal){
        $this->refsByVal = $refsByVal;
        $maxId = 0;
        foreach($refsByVal as $id) if($id > $maxId) $maxId = $id;
        $this->insertedNextId = $maxId + 1;
    }

    public function seekRefByVal($refOrig, $val){
        if(isset($this->refsByVal[$val]))
            return $this->refsByVal[$val];
        return false;
    }

    public function insertRef($refOrig, $val, $phase){
        $id = $this->insertedNextId++;
        $this->refsByVal[$val] = $id;
        $record = array("up" => 1, "ord" => 1, "t" => $refOrig, "val" => $val, "id" => $id);
        if($phase === "prepare")
            $this->prepareInserts[] = $record;
        else
            $this->inserts[] = $record;
        return $id;
    }

    /**
     * Mirrors Compile_Report's per-record preparation of a multi-ref edit:
     *   - looks up existing refs via SELECT
     *   - reserves negative placeholders for missing values
     *   - shares placeholders across records via $this->pendingByVal
     */
    public function prepareRecord($rec, $refOrig, $value){
        if($value === "" || $value === null)
            return array();
        if(is_numeric($value)){
            $this->records[$rec] = array("t" => (int)$value);
            return array((int)$value);
        }
        if(preg_match_all('/[а-яА-Яa-zA-Z0-9\s]+/u', (string)$value, $items) === 0)
            return array();
        $ids = array();
        $seen = array();
        $pending = array();
        foreach($items[0] as $item){
            $item = trim($item);
            if($item === "")
                continue;
            $id = $this->seekRefByVal($refOrig, $item);
            if($id === false){
                if(isset($this->pendingByVal[$refOrig][$item])){
                    $id = $this->pendingByVal[$refOrig][$item];
                }
                else{
                    $this->pendingSeq++;
                    $id = -$this->pendingSeq;
                    $this->pendingByVal[$refOrig][$item] = $id;
                    $pending[$id] = array("val" => $item, "refOrig" => $refOrig);
                }
            }
            $id = (int)$id;
            if(!isset($seen[$id])){
                $ids[] = $id;
                $seen[$id] = true;
                $this->dsRefs[$id] = $item;
            }
        }
        if(count($ids)){
            $this->records[$rec] = array("t" => $ids[0]);
            if(count($ids) > 1)
                $this->records[$rec]["tList"] = $ids;
            if(count($pending))
                $this->tListPending[$rec] = $pending;
        }
        return $ids;
    }

    /**
     * Mirrors Compile_Report's confirmed-UPDATE pass:
     *   - materializes EVERY pending placeholder exactly once (column-wide)
     *   - remaps every record's t/tList from placeholder to the real id, so
     *     the EDIT branch's "UPDATE ... SET t=..." can never write a negative id.
     */
    public function execute(){
        $idMap = array();
        $insertedByValKey = array();
        foreach($this->tListPending as $rec => $entries){
            foreach($entries as $placeholder => $pending){
                $placeholder = (int)$placeholder;
                if(isset($idMap[$placeholder]))
                    continue;
                $valKey = $pending["refOrig"] . ":" . $pending["val"];
                if(isset($insertedByValKey[$valKey])){
                    $idMap[$placeholder] = $insertedByValKey[$valKey];
                }
                else{
                    $newId = $this->insertRef($pending["refOrig"], $pending["val"], "execute");
                    $insertedByValKey[$valKey] = $newId;
                    $idMap[$placeholder] = $newId;
                }
                $newId = $idMap[$placeholder];
                if(isset($this->dsRefs[$placeholder]) && !isset($this->dsRefs[$newId]))
                    $this->dsRefs[$newId] = $this->dsRefs[$placeholder];
            }
        }
        foreach($this->records as $rec => &$row){
            if(isset($idMap[(int)$row["t"]]))
                $row["t"] = $idMap[(int)$row["t"]];
            if(isset($row["tList"])){
                foreach($row["tList"] as $k => $v)
                    if(isset($idMap[(int)$v]))
                        $row["tList"][$k] = $idMap[(int)$v];
            }
        }
        unset($row);
        $this->tListPending = array();
        $this->pendingByVal = array();
    }
}

function assertSame2772($expected, $actual, $message){
    if($expected !== $actual){
        fwrite(STDERR, "FAIL: $message\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
    echo "OK: $message\n";
}

# Real-world data from the issue: two Тонер-картридж rows that both list
# "черный" and a dozen other identical free-text words.
$harness = new Issue2772MultiRecordHarness(array(
    # existing refs (positive ids)
    "Тонер" => 2962074,
    "картридж" => 2963028,
    "печатного" => 2963029,
    "устройства" => 2963030,
    "тип" => 2963034,
    "ресурсная" => 2963036,
    "емкость" => 2963037,
    "не" => 2963038,
    "менее" => 2963039,
    "страниц" => 2963041,
    "ГК" => 2963042,
    "Cactus" => 2963043,
));

$row1 = "Тонер,картридж,печатного,устройства,brother,HL,L2300,2340,2360,DCP,L2500,MFC,L2700,тип,черный,ресурсная,емкость,не,менее,1000,страниц,ГК,Cactus";
$row2 = "Тонер,картридж,печатного,устройства,brother,HL,L2300,2340,2360,DCP,L2500,MFC,L2700,тип,черный,ресурсная,емкость,не,менее,1000,страниц,ГК,NV,Print";

$harness->prepareRecord(2848986, 900, $row1);
$harness->prepareRecord(2857984, 900, $row2);

# 1. prepare() never inserts.
assertSame2772(0, count($harness->prepareInserts), "prepare() must not insert any new refs (issue #2769)");

# 2. The shared "(новое) черный" gets ONE placeholder id, used by both rows.
assertSame2772(true, isset($harness->pendingByVal[900]["черный"]), "'черный' has a column-wide placeholder");
$blackPlaceholder = $harness->pendingByVal[900]["черный"];
assertSame2772(true, $blackPlaceholder < 0, "'черный' placeholder is a negative id");
$row1ContainsBlack = in_array($blackPlaceholder, $harness->records[2848986]["tList"], true);
$row2ContainsBlack = in_array($blackPlaceholder, $harness->records[2857984]["tList"], true);
assertSame2772(true, $row1ContainsBlack, "row #2848986 references the shared 'черный' placeholder");
assertSame2772(true, $row2ContainsBlack, "row #2857984 references the shared 'черный' placeholder");

# 3. Only ONE record carries the pending entry for "черный" — the row that
# first encountered the word. Other rows reuse the placeholder without
# adding a second pending entry.
$blackPendingOwners = 0;
foreach($harness->tListPending as $rec => $entries)
    if(isset($entries[$blackPlaceholder]))
        $blackPendingOwners++;
assertSame2772(1, $blackPendingOwners, "exactly one tListPending entry owns 'черный' (cross-record dedup)");

# 4. execute() inserts each unknown word exactly once.
$harness->execute();
$blackInserts = 0;
foreach($harness->inserts as $ins)
    if($ins["val"] === "черный") $blackInserts++;
assertSame2772(1, $blackInserts, "execute() inserts 'черный' exactly once across both rows");

# Same for every other word shared by both rows.
$sharedNewWords = array("brother", "HL", "L2300", "2340", "2360", "DCP", "L2500", "MFC", "L2700", "1000");
foreach($sharedNewWords as $word){
    $c = 0;
    foreach($harness->inserts as $ins)
        if($ins["val"] === $word) $c++;
    assertSame2772(1, $c, "execute() inserts '$word' exactly once across both rows");
}

# 5. After execute(), every t/tList id in every record is a real (positive) id.
foreach($harness->records as $rec => $row){
    assertSame2772(true, $row["t"] > 0, "row #$rec t is materialized (no placeholder)");
    if(isset($row["tList"]))
        foreach($row["tList"] as $tv)
            assertSame2772(true, $tv > 0, "row #$rec tList[$tv] is materialized");
}

# 6. Both rows reference the SAME real id for "черный" after materialization.
$row1Black = null;
foreach($harness->records[2848986]["tList"] as $tv)
    if(isset($harness->dsRefs[$tv]) && $harness->dsRefs[$tv] === "черный")
        $row1Black = $tv;
$row2Black = null;
foreach($harness->records[2857984]["tList"] as $tv)
    if(isset($harness->dsRefs[$tv]) && $harness->dsRefs[$tv] === "черный")
        $row2Black = $tv;
assertSame2772(true, $row1Black !== null, "row #2848986 has 'черный' label after execute");
assertSame2772($row1Black, $row2Black, "both rows reference the SAME real id for 'черный'");

# 7. Words unique to one row are inserted exactly once.
$uniqueRow1 = array("Cactus");                 // actually known — not pending
$uniqueRow2 = array("NV", "Print");
foreach($uniqueRow2 as $w){
    $c = 0;
    foreach($harness->inserts as $ins)
        if($ins["val"] === $w) $c++;
    assertSame2772(1, $c, "row-#2857984-only word '$w' inserted once");
}

# 8. Single-record scenario keeps the original #2769 behavior intact.
$single = new Issue2772MultiRecordHarness(array("alpha" => 11));
$single->prepareRecord(42, 900, "alpha,beta,gamma");
assertSame2772(0, count($single->prepareInserts), "single-record prepare() still inserts nothing");
assertSame2772(2, count($single->tListPending[42]), "single-record pending entries = unknown count");
$single->execute();
assertSame2772(2, count($single->inserts), "single-record execute() inserts each unknown once");
foreach($single->records[42]["tList"] as $tv)
    assertSame2772(true, $tv > 0, "single-record tList is fully materialized");

# 9. Calling execute() with no pending entries (all-known input) does nothing.
$allKnown = new Issue2772MultiRecordHarness(array("x" => 1, "y" => 2));
$allKnown->prepareRecord(1, 900, "x,y");
$allKnown->prepareRecord(2, 900, "y,x");
$allKnown->execute();
assertSame2772(0, count($allKnown->inserts), "all-known input across rows performs zero inserts");

# 10. Sanity check: the in-database refs gained EXACTLY the set of distinct
# unknown words seen across all rows, not duplicates.
$expectedNewWords = array(
    "brother", "HL", "L2300", "2340", "2360", "DCP", "L2500", "MFC", "L2700",
    "черный", "1000", "NV", "Print",
);
$insertedWords = array();
foreach($harness->inserts as $ins) $insertedWords[] = $ins["val"];
sort($expectedNewWords);
sort($insertedWords);
assertSame2772($expectedNewWords, $insertedWords, "execute() inserts exactly the set of distinct unknown words");

echo "\nAll tests passed for issue-2772 (cross-record placeholder dedup).\n";
