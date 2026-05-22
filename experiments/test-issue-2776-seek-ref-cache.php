<?php
/**
 * Test for issue #2776:
 * In Compile_Report's multi-ref EDIT branch, "Seek Ref by val" (the SELECT
 * lookup that resolves a free-text word to an existing refs.id) used to run
 * once per (record, word) pair. When mass-editing dozens of records that all
 * share the same Russian/Latin words (Тонер, картридж, печатного, устройства,
 * brother, HL, ...), the same SELECT for "Тонер" / "brother" / ... fires N
 * times even though the result is identical.
 *
 * #2772 already deduplicated PENDING placeholders across records via
 * $blocks["_update"][$key]["_pendingByVal"] but did NOT cache the SELECT
 * result for words that ARE already in refs. Issue #2776 asks us to cache
 * those, so each distinct (refOrig, refItem) pair triggers at most one
 * "Seek Ref by val" within the same prepare pass.
 *
 * The harness below mirrors the prepare phase exactly and counts SELECTs.
 */

class Issue2776SeekRefCacheHarness {
    public $insertedNextId = 1000;
    public $refsByVal = array();
    public $inserts = array();
    public $prepareInserts = array();
    public $pendingSeq = 0;
    public $dsRefs = array();
    public $records = array();
    public $pendingByVal = array();
    public $resolvedByVal = array();
    public $tListPending = array();
    public $seekCalls = array();        // every (refOrig, val) lookup
    public $seekCallsByKey = array();   // (refOrig, val) => count

    public function __construct($refsByVal){
        $this->refsByVal = $refsByVal;
        $maxId = 0;
        foreach($refsByVal as $id) if($id > $maxId) $maxId = $id;
        $this->insertedNextId = $maxId + 1;
    }

    public function seekRefByVal($refOrig, $val){
        $this->seekCalls[] = array("refOrig" => $refOrig, "val" => $val);
        $key = $refOrig."\0".$val;
        if(!isset($this->seekCallsByKey[$key]))
            $this->seekCallsByKey[$key] = 0;
        $this->seekCallsByKey[$key]++;
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
     * Mirrors the post-fix Compile_Report prepare phase for a multi-ref edit:
     *   - check the column-wide resolvedByVal cache first
     *   - check the column-wide pendingByVal cache next
     *   - only fall through to the actual SELECT lookup when both miss
     *   - cache the SELECT result so the next record reuses it
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
            if(isset($this->resolvedByVal[$refOrig][$item])){
                $id = $this->resolvedByVal[$refOrig][$item];
            }
            elseif(isset($this->pendingByVal[$refOrig][$item])){
                $id = $this->pendingByVal[$refOrig][$item];
            }
            else{
                $found = $this->seekRefByVal($refOrig, $item);
                if($found !== false){
                    $id = (int)$found;
                    $this->resolvedByVal[$refOrig][$item] = $id;
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

    public function execute(){
        $idMap = array();
        $insertedByValKey = array();
        foreach($this->tListPending as $rec => $entries){
            foreach($entries as $placeholder => $pending){
                $placeholder = (int)$placeholder;
                if(isset($idMap[$placeholder]))
                    continue;
                $valKey = $pending["refOrig"] . "\0" . $pending["val"];
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
        $this->resolvedByVal = array();
    }
}

function assertSame2776($expected, $actual, $message){
    if($expected !== $actual){
        fwrite(STDERR, "FAIL: $message\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
    echo "OK: $message\n";
}

# Real-world data from issue #2776 / #2772: a column being mass-edited where
# every record's free-text value shares the same dictionary of words.
$harness = new Issue2776SeekRefCacheHarness(array(
    # existing refs (positive ids) — these MUST be looked up via SELECT
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

$sharedKnown = "Тонер,картридж,печатного,устройства,тип,ресурсная,емкость,не,менее,страниц,ГК";
$sharedUnknown = "brother,HL,L2300,2340,2360,DCP,L2500,MFC,L2700,черный,1000";

# Eight records, all sharing the same dictionary of words. This is the
# "right column of values" pattern from the screenshot in issue #2776.
$rows = array(
    2848986 => $sharedKnown . "," . $sharedUnknown . ",Cactus",
    2857984 => $sharedKnown . "," . $sharedUnknown . ",NV,Print",
    2857985 => $sharedKnown . "," . $sharedUnknown . ",Cactus",
    2857986 => $sharedKnown . "," . $sharedUnknown . ",Cactus",
    2857987 => $sharedKnown . "," . $sharedUnknown . ",NV,Print",
    2857988 => $sharedKnown . "," . $sharedUnknown . ",Cactus",
    2857989 => $sharedKnown . "," . $sharedUnknown . ",NV,Print",
    2857990 => $sharedKnown . "," . $sharedUnknown . ",Cactus",
);

foreach($rows as $rec => $val)
    $harness->prepareRecord($rec, 900, $val);

# 1. prepare() never inserts (#2769 invariant still holds).
assertSame2776(0, count($harness->prepareInserts), "prepare() must not insert any new refs");

# 2. Issue #2776 core: every distinct (refOrig, val) is SELECTed at most ONCE,
#    regardless of how many records mention it.
foreach($harness->seekCallsByKey as $key => $count){
    assertSame2776(1, $count, "'$key' was SELECTed exactly once (cache hit on repeat)");
}

# 3. Total SELECT count equals the number of DISTINCT (refOrig, val) pairs.
$expectedDistinct = array();
foreach($rows as $rec => $val){
    foreach(explode(",", $val) as $item){
        $item = trim($item);
        if($item === "") continue;
        $expectedDistinct[$item] = true;
    }
}
assertSame2776(count($expectedDistinct), count($harness->seekCallsByKey),
    "SELECT count == number of distinct words across all records");

# 4. Known words: previously each known word was looked up once per record
#    (count(rows) calls). After the fix it's 1.
$knownWords = array("Тонер", "картридж", "печатного", "устройства", "тип",
    "ресурсная", "емкость", "не", "менее", "страниц", "ГК");
foreach($knownWords as $w){
    $key = "900\0".$w;
    assertSame2776(true, isset($harness->seekCallsByKey[$key]),
        "known word '$w' was SELECTed at least once");
    assertSame2776(1, $harness->seekCallsByKey[$key],
        "known word '$w' SELECTed exactly once (was " . count($rows) . "x before the fix)");
}

# 5. Unknown words go to pendingByVal on the first encounter. The fall-through
#    means the second record's lookup hits the cache and never re-runs SELECT.
$unknownWords = array("brother", "HL", "L2300", "2340", "2360", "DCP", "L2500",
    "MFC", "L2700", "черный", "1000", "NV", "Print");
foreach($unknownWords as $w){
    $key = "900\0".$w;
    assertSame2776(1, $harness->seekCallsByKey[$key],
        "unknown word '$w' SELECTed exactly once before placeholder takes over");
}

# 6. Resolve correctness: every record still maps known words to the same
#    real ids the database returned.
foreach($rows as $rec => $val){
    $tList = $harness->records[$rec]["tList"];
    $thisRowMap = array();
    foreach($tList as $rid)
        if(isset($harness->dsRefs[$rid]))
            $thisRowMap[$harness->dsRefs[$rid]] = $rid;
    foreach($knownWords as $w){
        assertSame2776($harness->refsByVal[$w], $thisRowMap[$w],
            "row #$rec '$w' resolves to its real id");
    }
}

# 7. execute() inserts each shared unknown word exactly once across all rows.
$harness->execute();
foreach(array("brother","HL","L2300","2340","2360","DCP","L2500","MFC","L2700","черный","1000","NV","Print") as $w){
    $c = 0;
    foreach($harness->inserts as $ins)
        if($ins["val"] === $w) $c++;
    assertSame2776(1, $c, "execute() inserts '$w' exactly once");
}

# 8. After execute(), every record's t/tList contains real (positive) ids.
foreach($harness->records as $rec => $row){
    assertSame2776(true, $row["t"] > 0, "row #$rec t is materialized");
    if(isset($row["tList"]))
        foreach($row["tList"] as $tv)
            assertSame2776(true, $tv > 0, "row #$rec tList[$tv] is materialized");
}

# 9. Single-record + all-known input keeps the original behavior: each word is
#    SELECTed once and zero pending inserts happen.
$single = new Issue2776SeekRefCacheHarness(array("alpha" => 11, "beta" => 12, "gamma" => 13));
$single->prepareRecord(42, 900, "alpha,beta,gamma");
assertSame2776(3, count($single->seekCallsByKey), "single-record: each word triggers one SELECT");
$single->execute();
assertSame2776(0, count($single->inserts), "all-known input across rows performs zero inserts");

# 10. Repeated identical lookups within a SINGLE record also short-circuit.
#     The tokenizer can split "брат брат брат" into three identical tokens,
#     each of which should hit the cache after the first lookup.
$repeat = new Issue2776SeekRefCacheHarness(array("брат" => 77));
$repeat->prepareRecord(1, 900, "брат,брат,брат,брат,брат");
assertSame2776(1, count($repeat->seekCalls), "repeated identical tokens trigger one SELECT total");
assertSame2776(array(77), $repeat->records[1]["t"] ? array($repeat->records[1]["t"]) : array(),
    "repeated tokens resolve to the same real id and dedup at the seen-list level");

# 11. Cache is column-scoped (cleared by execute()) — a SECOND prepare pass
#     after execute() rebuilds the cache. This protects against stale data if
#     refs is mutated between pre-confirm and confirm.
$stale = new Issue2776SeekRefCacheHarness(array("alpha" => 11));
$stale->prepareRecord(1, 900, "alpha");
$stale->execute();
$stale->prepareRecord(2, 900, "alpha");
assertSame2776(2, count($stale->seekCalls), "cache resets after execute(); next prepare re-queries");

echo "\nAll tests passed for issue-2776 (Seek Ref by val caching).\n";
