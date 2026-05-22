<?php
/**
 * Test for issue #2767:
 * In the `if(isRef($id, $par, $typ))` branch inside Compile_Report's REP_COL_SET
 * processing, $row["u$key"] may arrive as a free-text list of words that should
 * map to multiple reference values of the original ref type, e.g.:
 *   Тонер картридж печатного устройства xerox phaser 6700 ...
 * The existing code only treated $row["u$key"] as a single ref id and marked
 * anything else as invalid. This test exercises the resolver harness that the
 * production code uses: split the input the same way the new-record branch
 * does (preg_match_all with /[а-яА-Яa-zA-Z0-9\s]+/u), resolve each word to an
 * id in the ref-orig dictionary, and create missing words.
 */

class Issue2767MultiRefHarness {
    public $insertedNextId = 1000;
    public $refsByVal = array();
    public $inserts = array();

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

    public function insertRef($refOrig, $val){
        $id = $this->insertedNextId++;
        $this->refsByVal[$val] = $id;
        $this->inserts[] = array("up" => 1, "ord" => 1, "t" => $refOrig, "val" => $val, "id" => $id);
        return $id;
    }

    public function resolve($refOrig, $value){
        if($value === "" || $value === null)
            return array();
        if(is_numeric($value))
            return array((int)$value);
        if(preg_match_all('/[а-яА-Яa-zA-Z0-9\s]+/u', (string)$value, $items) === 0)
            return array();
        $ids = array();
        $seen = array();
        foreach($items[0] as $item){
            $item = trim($item);
            if($item === "")
                continue;
            $id = $this->seekRefByVal($refOrig, $item);
            if($id === false)
                $id = $this->insertRef($refOrig, $item);
            $id = (int)$id;
            if(!isset($seen[$id])){
                $ids[] = $id;
                $seen[$id] = true;
            }
        }
        return $ids;
    }
}

function assertSameIssue2767($expected, $actual, $message){
    if($expected !== $actual){
        fwrite(STDERR, "FAIL: $message\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
    echo "OK: $message\n";
}

# Existing dictionary that partially matches the issue example.
$harness = new Issue2767MultiRefHarness(array(
    "Тонер" => 501,
    "картридж" => 502,
    "xerox" => 503,
    "phaser" => 504,
    "6700" => 505,
    "ГК" => 506,
));

# 1. Numeric input falls through to single-id behaviour (no creation, no extra ids).
$ids = $harness->resolve(900, "501");
assertSameIssue2767(array(501), $ids, "numeric input resolves to a single id");
assertSameIssue2767(0, count($harness->inserts), "numeric input does not create new refs");

# 2. Free-text multi-ref input resolves known words and creates missing ones.
$harness2 = new Issue2767MultiRefHarness(array(
    "Тонер" => 501,
    "картридж" => 502,
    "xerox" => 503,
    "phaser" => 504,
    "6700" => 505,
    "ГК" => 506,
));
$value = "Тонер,картридж,печатного,устройства,xerox,phaser,6700,тип,черный,ресурсная,емкость,не,менее,5000,страниц,ГК,Hi,Back";
$ids = $harness2->resolve(900, $value);
assertSameIssue2767(true, count($ids) > 6, "multi-ref input yields more than the six pre-existing ids");
assertSameIssue2767(501, $ids[0], "first id is the existing 'Тонер'");
assertSameIssue2767(502, $ids[1], "second id is the existing 'картридж'");
$missingWords = array("печатного","устройства","тип","черный","ресурсная","емкость","не","менее","5000","страниц","Hi","Back");
foreach($missingWords as $word){
    $found = false;
    foreach($harness2->inserts as $ins)
        if($ins["val"] === $word){
            $found = true;
            break;
        }
    assertSameIssue2767(true, $found, "missing word '$word' was created");
}
assertSameIssue2767(count($missingWords), count($harness2->inserts), "exactly the missing words were created");

# 3. Empty value resolves to no ids (single delete path stays untouched).
$harness3 = new Issue2767MultiRefHarness(array());
assertSameIssue2767(array(), $harness3->resolve(900, ""), "empty value yields no ids");

# 4. Duplicate words in input collapse to unique ids.
$harness4 = new Issue2767MultiRefHarness(array("alpha" => 11, "beta" => 12));
$ids = $harness4->resolve(900, "alpha,alpha,beta");
assertSameIssue2767(array(11, 12), $ids, "duplicates are removed");
assertSameIssue2767(0, count($harness4->inserts), "no inserts for an all-known input");

# 5. Single non-numeric word also resolves (or creates) one id.
$harness5 = new Issue2767MultiRefHarness(array("ФАКТ" => 77));
assertSameIssue2767(array(77), $harness5->resolve(900, "ФАКТ"), "single known word resolves to its id");
$ids = $harness5->resolve(900, "ПЛАН");
assertSameIssue2767(1, count($ids), "single unknown word creates one id");
assertSameIssue2767(1, count($harness5->inserts), "one insert for the unknown word");
assertSameIssue2767("ПЛАН", $harness5->inserts[0]["val"], "the created word is 'ПЛАН'");

echo "\nAll tests passed for issue-2767.\n";
