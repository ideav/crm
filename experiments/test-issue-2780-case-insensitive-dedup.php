<?php
/**
 * Test for issue #2780:
 * When a free-text multi-ref value contains the same word in several case
 * variants (e.g. "LaserJet", "Laserjet", "laserJet", "laserjet"), the dedup
 * pipeline introduced by #2769/#2772/#2776 used to treat each variant as a
 * distinct value and create one separate Ref row per variant. The user-visible
 * symptom in #2780: "LaserJet упоминается 4 раза" — four near-duplicate Ref
 * rows for the same brand, all inserted in a single batched INSERT during one
 * "Flush batch: Insert new Ref by val (deferred)".
 *
 * The cache keys live in PHP arrays, which are case-sensitive. So even with
 * a case-insensitive column collation the SELECT never gets a chance to dedup
 * across variants — they are all inserted together in the same batch before
 * any of them is queryable.
 *
 * The fix case-folds the cache key (mb_strtolower) for:
 *   - $blocks["_update"][$key]["_resolvedByVal"][$refOrig][$refItemKey]
 *   - $blocks["_update"][$key]["_pendingByVal"][$refOrig][$refItemKey]
 *   - $insertedByValKey  ($refOrig."\0".$pendingValKey)
 * The original casing (first occurrence wins) is still what ends up in the
 * refs table and the operator preview.
 *
 * The harness below mirrors the post-fix prepare + execute pipeline and
 * verifies dedup across case variants both within one record and across rows.
 */

class Issue2780CaseInsensitiveHarness {
    public $insertedNextId = 1000;
    public $refsByVal = array();
    public $inserts = array();            // Inserts performed in execute()
    public $prepareInserts = array();     // Inserts in prepare() — MUST stay empty
    public $pendingSeq = 0;
    public $dsRefs = array();
    public $records = array();
    public $pendingByVal = array();
    public $resolvedByVal = array();
    public $tListPending = array();
    public $seekCalls = array();
    public $seekCallsByKey = array();

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
        # Mirror typical utf8_general_ci collation: case-insensitive equality.
        $needle = function_exists('mb_strtolower') ? mb_strtolower($val, 'UTF-8') : strtolower($val);
        foreach($this->refsByVal as $haveVal => $id){
            $have = function_exists('mb_strtolower') ? mb_strtolower($haveVal, 'UTF-8') : strtolower($haveVal);
            if($have === $needle)
                return $id;
        }
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
            # The fix: case-fold the cache key so all case variants collapse to one.
            $itemKey = function_exists('mb_strtolower') ? mb_strtolower($item, 'UTF-8') : strtolower($item);
            if(isset($this->resolvedByVal[$refOrig][$itemKey])){
                $id = $this->resolvedByVal[$refOrig][$itemKey];
            }
            elseif(isset($this->pendingByVal[$refOrig][$itemKey])){
                $id = $this->pendingByVal[$refOrig][$itemKey];
            }
            else{
                $found = $this->seekRefByVal($refOrig, $item);
                if($found !== false){
                    $id = (int)$found;
                    $this->resolvedByVal[$refOrig][$itemKey] = $id;
                }
                else{
                    $this->pendingSeq++;
                    $id = -$this->pendingSeq;
                    $this->pendingByVal[$refOrig][$itemKey] = $id;
                    $pending[$id] = array("val" => $item, "refOrig" => $refOrig);
                }
            }
            $id = (int)$id;
            if(!isset($seen[$id])){
                $ids[] = $id;
                $seen[$id] = true;
                if(!isset($this->dsRefs[$id]))
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
                $valLower = function_exists('mb_strtolower') ? mb_strtolower($pending["val"], 'UTF-8') : strtolower($pending["val"]);
                $valKey = $pending["refOrig"]."\0".$valLower;
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

function assertSame2780($expected, $actual, $message){
    if($expected !== $actual){
        fwrite(STDERR, "FAIL: $message\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
    echo "OK: $message\n";
}

# ---------------------------------------------------------------------------
# Scenario 1 — the original issue #2780 batch
# A single record's free-text value mentions LaserJet in four case variants.
# Pre-fix: four pending placeholders, four batched INSERTs ("LaserJet appears
# four times in the reference"). Post-fix: one placeholder, one INSERT.
# ---------------------------------------------------------------------------
$h = new Issue2780CaseInsensitiveHarness(array(
    "HP" => 100,
    "Canon" => 101,
));

$h->prepareRecord(1, 900, "LaserJet,Laserjet,laserJet,laserjet,HP");

assertSame2780(0, count($h->prepareInserts), "prepare() must not Insert (issue #2769)");

# All four variants resolve to the SAME negative placeholder.
$variants = array("LaserJet", "Laserjet", "laserJet", "laserjet");
$placeholders = array();
foreach($variants as $v){
    $vKey = mb_strtolower($v, 'UTF-8');
    assertSame2780(true, isset($h->pendingByVal[900][$vKey]),
        "case variant '$v' (key '$vKey') has a placeholder");
    $placeholders[$v] = $h->pendingByVal[900][$vKey];
}
$first = reset($placeholders);
foreach($placeholders as $v => $p)
    assertSame2780($first, $p, "variant '$v' shares the same placeholder as 'LaserJet'");

# tListPending should hold exactly ONE entry — the first-seen variant.
assertSame2780(1, count($h->tListPending[1]),
    "tListPending has exactly one pending entry for the LaserJet group");
$pendingEntry = reset($h->tListPending[1]);
assertSame2780("LaserJet", $pendingEntry["val"],
    "first occurrence wins: 'LaserJet' is the value stored on insert");

# Confirm: execute() runs exactly ONE Insert for the LaserJet group.
$h->execute();
$laserCount = 0;
foreach($h->inserts as $ins){
    $v = $ins["val"];
    if(strcasecmp($v, "LaserJet") === 0) $laserCount++;
}
assertSame2780(1, $laserCount,
    "execute() inserts exactly ONE row for the LaserJet group (was 4 before #2780)");

# The single inserted row uses the first-seen casing.
$insertedLaserVal = null;
foreach($h->inserts as $ins){
    if(strcasecmp($ins["val"], "LaserJet") === 0){
        $insertedLaserVal = $ins["val"];
        break;
    }
}
assertSame2780("LaserJet", $insertedLaserVal,
    "the inserted row preserves the first-seen original casing");

# Sanity: HP was known, so no extra Insert.
foreach($h->inserts as $ins)
    assertSame2780(true, strcasecmp($ins["val"], "HP") !== 0,
        "known word 'HP' (case-insensitive) is not Inserted");

# ---------------------------------------------------------------------------
# Scenario 2 — variants spread across MULTIPLE records (#2772 invariant)
# Each record mentions a different case variant. Dedup must hold column-wide.
# ---------------------------------------------------------------------------
$h2 = new Issue2780CaseInsensitiveHarness(array());
$h2->prepareRecord(1, 900, "LaserJet,foo");
$h2->prepareRecord(2, 900, "laserjet,bar");
$h2->prepareRecord(3, 900, "LASERJET,baz");
$h2->prepareRecord(4, 900, "Laserjet,qux");

$h2->execute();

$laserCount2 = 0;
foreach($h2->inserts as $ins)
    if(strcasecmp($ins["val"], "LaserJet") === 0) $laserCount2++;
assertSame2780(1, $laserCount2,
    "cross-record case-insensitive dedup: one LaserJet Insert for 4 records");

# Every record's tList contains exactly one entry that points at the same
# materialized LaserJet id.
$laserId = null;
foreach($h2->inserts as $ins)
    if(strcasecmp($ins["val"], "LaserJet") === 0) $laserId = $ins["id"];
foreach(array(1, 2, 3, 4) as $rec){
    $row = $h2->records[$rec];
    $list = isset($row["tList"]) ? $row["tList"] : array($row["t"]);
    $found = false;
    foreach($list as $rid) if($rid === $laserId) $found = true;
    assertSame2780(true, $found,
        "row #$rec references the shared LaserJet id ($laserId)");
}

# ---------------------------------------------------------------------------
# Scenario 3 — Cyrillic case variants (mb_strtolower required)
# Russian text has case too; the fix must use mb_strtolower for UTF-8.
# ---------------------------------------------------------------------------
# Tokenizer regex /[а-яА-Я]/ excludes Ё/ё (U+0401/U+0451), so these tests
# use Cyrillic words built only from chars the tokenizer matches.
$h3 = new Issue2780CaseInsensitiveHarness(array());
$h3->prepareRecord(1, 900, "Черный,ЧЕРНЫЙ,черный,Печать,печать");
$h3->execute();
$chCount = 0;
foreach($h3->inserts as $ins)
    if(mb_strtolower($ins["val"], 'UTF-8') === "черный") $chCount++;
assertSame2780(1, $chCount, "Cyrillic case variants of 'Черный' dedup to one Insert");

$pchCount = 0;
foreach($h3->inserts as $ins)
    if(mb_strtolower($ins["val"], 'UTF-8') === "печать") $pchCount++;
assertSame2780(1, $pchCount, "Cyrillic case variants of 'Печать' dedup to one Insert");

# ---------------------------------------------------------------------------
# Scenario 4 — case variant of an EXISTING db value
# DB already has "LaserJet". A new record uses "laserjet". With a case-
# insensitive collation the SELECT finds the existing row, the resolved-cache
# is keyed by the lowercase form, and no Insert happens.
# ---------------------------------------------------------------------------
$h4 = new Issue2780CaseInsensitiveHarness(array("LaserJet" => 500));
$h4->prepareRecord(1, 900, "laserjet,LASERJET,LaserJet");
$h4->execute();

assertSame2780(0, count($h4->inserts),
    "case variant of an existing DB value triggers zero Inserts");

# All three case variants in the record map to id 500 (the existing one).
$row1 = $h4->records[1];
$list = isset($row1["tList"]) ? $row1["tList"] : array($row1["t"]);
$uniq = array_unique($list);
assertSame2780(array(500), array_values($uniq),
    "all three case variants resolve to the existing LaserJet id");

# ---------------------------------------------------------------------------
# Scenario 5 — words that differ in MORE than case are NOT merged
# "LaserJet" and "ColorLaserJet" must stay distinct (the #2780 log mentioned
# ColorLaserJet alongside LaserJet — these must NOT collapse).
# ---------------------------------------------------------------------------
$h5 = new Issue2780CaseInsensitiveHarness(array());
$h5->prepareRecord(1, 900, "LaserJet,ColorLaserJet,colorlaserjet");
$h5->execute();

$laser = 0; $color = 0;
foreach($h5->inserts as $ins){
    if(strcasecmp($ins["val"], "LaserJet") === 0) $laser++;
    if(strcasecmp($ins["val"], "ColorLaserJet") === 0) $color++;
}
assertSame2780(1, $laser, "'LaserJet' alone gets one Insert");
assertSame2780(1, $color, "'ColorLaserJet' (and its case variant) get one Insert — distinct from LaserJet");

# ---------------------------------------------------------------------------
# Scenario 6 — #2776 SELECT-cache invariant still holds under case folding
# Repeating the same word with different casing across rows triggers ONE
# Seek Ref by val SELECT (the first one); subsequent lookups hit the cache.
# ---------------------------------------------------------------------------
$h6 = new Issue2780CaseInsensitiveHarness(array("HP" => 100));
$h6->prepareRecord(1, 900, "HP");
$h6->prepareRecord(2, 900, "hp");
$h6->prepareRecord(3, 900, "Hp");
$h6->prepareRecord(4, 900, "hP");

# Exactly one SELECT call for the HP group (since the cache is case-folded).
$hpSelects = 0;
foreach($h6->seekCalls as $c) if(strcasecmp($c["val"], "HP") === 0) $hpSelects++;
assertSame2780(1, $hpSelects,
    "case-folded resolvedByVal: only the first HP variant queries the DB");

# ---------------------------------------------------------------------------
# Scenario 7 — repeated identical tokens inside ONE record (existing #2776
# behavior must still hold).
# ---------------------------------------------------------------------------
$h7 = new Issue2780CaseInsensitiveHarness(array("брат" => 77));
$h7->prepareRecord(1, 900, "брат,БРАТ,Брат,брат");
$h7->execute();
assertSame2780(0, count($h7->inserts), "repeated case variants of a known word: zero inserts");
assertSame2780(array(77), array_values(array_unique(
    isset($h7->records[1]["tList"]) ? $h7->records[1]["tList"] : array($h7->records[1]["t"])
)), "all case variants of 'брат' point at the same existing id");

# ---------------------------------------------------------------------------
# Scenario 8 — confirm the all-known input is still a no-op
# ---------------------------------------------------------------------------
$h8 = new Issue2780CaseInsensitiveHarness(array("alpha" => 11, "beta" => 12));
$h8->prepareRecord(1, 900, "ALPHA,Beta,alpha");
$h8->execute();
assertSame2780(0, count($h8->inserts), "all-known case-variant input: zero inserts");

echo "\nAll tests passed for issue-2780 (case-insensitive Ref dedup).\n";
