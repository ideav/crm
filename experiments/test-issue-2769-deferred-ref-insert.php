<?php
/**
 * Test for issue #2769:
 * Any DB updates (including the Insert of new reference values introduced by
 * #2767) must happen ONLY after the user has confirmed the UPDATE — i.e.,
 * after the
 *   if(isset($blocks["_update"]) && isset($_REQUEST["confirmed"])) { ... }
 * branch executes.
 *
 * This test simulates the resolve/execute split:
 *   - prepare() looks up existing refs (SELECT only) and reserves negative
 *     placeholder ids for words that need to be created, recording them in
 *     a `tListPending` array. NO Insert is performed.
 *   - execute() walks tListPending and performs Insert, substituting
 *     placeholder ids with the freshly assigned real ids.
 *
 * The harness mirrors the two paths now present in index.php so we can verify:
 *   1. prepare() never inserts.
 *   2. execute() inserts each pending word exactly once.
 *   3. The first id used for the UPDATE column type matches the first word.
 *   4. The fan-out list of ids contains real ids (no placeholders) after execute.
 */

class Issue2769DeferredHarness {
    public $insertedNextId = 1000;
    public $refsByVal = array();
    public $inserts = array();           // Inserts performed in execute()
    public $prepareInserts = array();    // Inserts performed in prepare() — MUST stay empty
    public $pendingSeq = 0;
    public $dsRefs = array();
    public $tList = null;
    public $tListPending = null;
    public $tForUpdate = null;

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

    public function prepare($refOrig, $value){
        $this->tList = null;
        $this->tListPending = null;
        $this->tForUpdate = null;
        if($value === "" || $value === null)
            return array();
        if(is_numeric($value)){
            $this->tForUpdate = (int)$value;
            return array((int)$value);
        }
        if(preg_match_all('/[а-яА-Яa-zA-Z0-9\s]+/u', (string)$value, $items) === 0)
            return array();
        $ids = array();
        $seen = array();
        $pending = array();
        $pendingByVal = array();
        foreach($items[0] as $item){
            $item = trim($item);
            if($item === "")
                continue;
            $id = $this->seekRefByVal($refOrig, $item);
            if($id === false){
                if(isset($pendingByVal[$item]))
                    $id = $pendingByVal[$item];
                else{
                    $this->pendingSeq++;
                    $id = -$this->pendingSeq;
                    $pending[$id] = array("val" => $item, "refOrig" => $refOrig);
                    $pendingByVal[$item] = $id;
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
            $this->tForUpdate = $ids[0];
            if(count($ids) > 1)
                $this->tList = $ids;
            if(count($pending))
                $this->tListPending = $pending;
        }
        return $ids;
    }

    public function execute(){
        if(!is_array($this->tListPending))
            return;
        $idMap = array();
        foreach($this->tListPending as $placeholder => $pending){
            $newId = $this->insertRef($pending["refOrig"], $pending["val"], "execute");
            $idMap[(int)$placeholder] = (int)$newId;
            if(isset($this->dsRefs[$placeholder])){
                $this->dsRefs[$newId] = $this->dsRefs[$placeholder];
                unset($this->dsRefs[$placeholder]);
            }
        }
        if(isset($idMap[(int)$this->tForUpdate]))
            $this->tForUpdate = $idMap[(int)$this->tForUpdate];
        if(is_array($this->tList))
            foreach($this->tList as $k => $v)
                if(isset($idMap[(int)$v]))
                    $this->tList[$k] = $idMap[(int)$v];
        $this->tListPending = null;
    }
}

function assertSame2769($expected, $actual, $message){
    if($expected !== $actual){
        fwrite(STDERR, "FAIL: $message\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
    echo "OK: $message\n";
}

# 1. Free-text multi-ref input does not Insert during prepare().
$harness = new Issue2769DeferredHarness(array(
    "Тонер" => 501,
    "картридж" => 502,
    "xerox" => 503,
    "phaser" => 504,
    "6700" => 505,
    "ГК" => 506,
));
$value = "Тонер,картридж,печатного,устройства,xerox,phaser,6700,тип,черный,ресурсная,емкость,не,менее,5000,страниц,ГК,Hi,Back";
$ids = $harness->prepare(900, $value);
assertSame2769(0, count($harness->prepareInserts), "prepare() must not insert any new refs");
assertSame2769(0, count($harness->inserts), "execute()-only inserts are empty before execute() is called");
# First id is the existing 'Тонер' (positive) — not a placeholder.
assertSame2769(501, $ids[0], "first id is the existing 'Тонер'");
# Some ids must be negative placeholders for unknown words.
$negCount = 0;
foreach($ids as $id) if($id < 0) $negCount++;
assertSame2769(true, $negCount > 0, "unknown words receive negative placeholder ids during prepare()");
# tForUpdate stays the first id (placeholder OK because no UPDATE has run yet).
assertSame2769(501, $harness->tForUpdate, "tForUpdate after prepare() is the first resolved id");
# tListPending contains exactly the unknown words.
$expectedWords = array("печатного","устройства","тип","черный","ресурсная","емкость","не","менее","5000","страниц","Hi","Back");
$pendingWords = array();
foreach($harness->tListPending as $p => $entry) $pendingWords[] = $entry["val"];
sort($expectedWords);
sort($pendingWords);
assertSame2769($expectedWords, $pendingWords, "tListPending lists exactly the unknown words");

# 2. execute() inserts each pending word exactly once and replaces placeholders.
$harness->execute();
assertSame2769(count($expectedWords), count($harness->inserts), "execute() inserts exactly the missing words");
foreach($harness->tList as $id)
    assertSame2769(true, $id > 0, "tList after execute() contains no placeholder ids");
assertSame2769(true, $harness->tForUpdate > 0, "tForUpdate after execute() is a real id");
assertSame2769(null, $harness->tListPending, "tListPending is cleared after execute()");

# 3. Calling execute() a second time is idempotent — no extra inserts.
$insertCountAfter = count($harness->inserts);
$harness->execute();
assertSame2769($insertCountAfter, count($harness->inserts), "execute() is idempotent");

# 4. All-known input doesn't create any pending Inserts.
$harness2 = new Issue2769DeferredHarness(array("alpha" => 11, "beta" => 12));
$ids2 = $harness2->prepare(900, "alpha,beta");
assertSame2769(array(11, 12), $ids2, "all known words resolve directly");
assertSame2769(null, $harness2->tListPending, "no tListPending when all words are known");
$harness2->execute();
assertSame2769(0, count($harness2->inserts), "no inserts when all words are known");
assertSame2769(0, count($harness2->prepareInserts), "no prepare-phase inserts either");

# 5. Numeric input still falls through cleanly.
$harness3 = new Issue2769DeferredHarness(array());
$ids3 = $harness3->prepare(900, "777");
assertSame2769(array(777), $ids3, "numeric input still resolves to a single id");
assertSame2769(0, count($harness3->prepareInserts), "numeric input doesn't insert");
$harness3->execute();
assertSame2769(0, count($harness3->inserts), "numeric input doesn't insert on execute either");

# 6. Single unknown word — pending during prepare, materialized during execute.
$harness4 = new Issue2769DeferredHarness(array());
$ids4 = $harness4->prepare(900, "FreshWord");
assertSame2769(1, count($ids4), "single unknown word yields one placeholder id");
assertSame2769(true, $ids4[0] < 0, "the id is a negative placeholder before execute");
assertSame2769(0, count($harness4->prepareInserts), "no insert during prepare");
$harness4->execute();
assertSame2769(1, count($harness4->inserts), "single insert on execute");
assertSame2769("FreshWord", $harness4->inserts[0]["val"], "the inserted value is the original word");
assertSame2769(true, $harness4->tForUpdate > 0, "tForUpdate is materialized");

# 7. Duplicate unknown words collapse to a single pending entry.
$harness5 = new Issue2769DeferredHarness(array());
$ids5 = $harness5->prepare(900, "Repeat,Repeat,Repeat");
assertSame2769(1, count($ids5), "duplicates collapse to one id");
assertSame2769(0, count($harness5->prepareInserts), "no prepare-phase inserts even with duplicates");
$harness5->execute();
assertSame2769(1, count($harness5->inserts), "duplicate input still only inserts once");

echo "\nAll tests passed for issue-2769.\n";
