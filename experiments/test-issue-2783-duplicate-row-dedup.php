<?php
/**
 * Test for issue #2783:
 * When the JSON_OBJ endpoint applies a LIKE filter (FR_{colid}=%foo%) on a
 * non-MULTI/ARRAY column, Construct_WHERE() does not set $GLOBALS["distinct"]
 * (only MULTI/ARRAY types set it). The resulting SELECT may return duplicate
 * rows for the same vals.id when the joined column legitimately has more than
 * one matching row for one object. Reported symptoms in the issue:
 *
 *   - The filter URL
 *       /test/object/2406756/?JSON_OBJ&LIMIT=0,21&FR_2406760=%255180%25
 *     returns record id 3893632 twice: once with only the main value
 *     (`r:["00-00627661"]`) and once with the full row whose `r` has eleven
 *     elements — the five reqs appended twice.
 *   - A single-record query for id 3893632 returns the correct six elements,
 *     proving the data itself is fine; the bug is in how the list endpoint
 *     assembles its response.
 *
 * Root cause: index.php's &uni_obj_all loop creates one newapi[] entry per
 * row and points newapicnt[id] at the latest entry. When a duplicate row
 * lands, both entries share the same id but newapicnt is overwritten, so
 * every subsequent &uni_object_view_reqs appends into the latest entry —
 * once per blocks[$block]["id"][] occurrence, doubling the reqs there and
 * leaving the earlier entry with only the main value.
 *
 * The fix dedups duplicate rows at the top of the while-loop body before the
 * blocks/newapi pipeline sees them. This harness emulates that pipeline and
 * asserts that:
 *   1. The legacy behaviour reproduces the issue's symptom exactly
 *      (split + doubled entries for the same id).
 *   2. The fixed behaviour collapses to one entry with the correct cell
 *      count for a duplicated row.
 *   3. JSON_DATA (the older string-builder API) is also dedeuped so
 *      &uni_object_view_reqs is no longer fired twice per duplicate id.
 *   4. Distinct ids are untouched (no over-eager dedup).
 */

require_once __DIR__ . "/../experiments/issue-2783-helpers.php";

class Issue2783DuplicateRowHarness {
    /** @var bool When true, applies the fix; when false, simulates legacy. */
    public $applyFix = true;

    /** @var array Mock GLOBAL_VARS["newapi"] state, JSON_OBJ shape (array). */
    public $newapiObj = array();
    /** @var array Mock GLOBAL_VARS["newapicnt"] map id -> index. */
    public $newapicnt = array();

    /** @var array Mock GLOBAL_VARS["newapi"] state, JSON_DATA shape (strings keyed by id). */
    public $newapiData = array();

    /** @var array Mock blocks["uni_obj_all"]["id"] entries (drives reqs case). */
    public $blocksIds = array();

    /** @var string Mode: "JSON_OBJ" or "JSON_DATA". */
    public $mode;

    /** @var array Per-id "reqs" payload to attach during the reqs case. */
    public $reqsById = array();

    public function __construct($mode){
        $this->mode = $mode;
    }

    /**
     * Mirror the &uni_obj_all loop body for one fetched row, applying the
     * dedup guard from the fix when $applyFix is true.
     */
    public function ingestRow($row){
        if($this->applyFix){
            if($this->mode === "JSON_OBJ" && isset($this->newapicnt[$row["id"]]))
                return;
            if($this->mode === "JSON_DATA" && isset($this->newapiData[$row["id"]]))
                return;
        }
        if($this->mode === "JSON_OBJ"){
            $this->newapiObj[] = array(
                "i" => (int)$row["id"],
                "u" => (int)$row["up"],
                "o" => (int)$row["val_ord"],
                "r" => array($row["val"]),
            );
            $this->newapicnt[$row["id"]] = count($this->newapiObj) - 1;
        }
        else {
            // The real code starts an open string here that &uni_object_view_reqs
            // appends to. We only care about whether the id is "claimed" already.
            $this->newapiData[$row["id"]] = "{\"i\":".$row["id"]
                .",\"u\":".$row["up"]
                .",\"o\":".$row["val_ord"]
                .",\"r\":[\"".$row["val"]."\"";
        }
        $this->blocksIds[] = $row["id"];
    }

    /**
     * Mirror the &uni_object_view_reqs case: for each id in blocksIds, append
     * that id's reqs to the entry pointed to by newapicnt (JSON_OBJ) or to
     * the string keyed by id (JSON_DATA).
     */
    public function runReqsCase(){
        foreach($this->blocksIds as $parent_id){
            $reqs = isset($this->reqsById[$parent_id]) ? $this->reqsById[$parent_id] : array();
            if($this->mode === "JSON_OBJ"){
                $idx = $this->newapicnt[$parent_id];
                foreach($reqs as $req)
                    $this->newapiObj[$idx]["r"][] = $req;
            }
            else {
                foreach($reqs as $req)
                    $this->newapiData[$parent_id] .= ",\"$req\"";
            }
        }
        if($this->mode === "JSON_DATA")
            foreach($this->newapiData as $id => $s)
                $this->newapiData[$id] = $s . "]}";
    }
}

# Helper: run a duplicate-row scenario end-to-end and return the harness.
function run_dup_scenario($mode, $applyFix, $rows, $reqsById){
    $h = new Issue2783DuplicateRowHarness($mode);
    $h->applyFix = $applyFix;
    $h->reqsById = $reqsById;
    foreach($rows as $r)
        $h->ingestRow($r);
    $h->runReqsCase();
    return $h;
}

# ---------------------------------------------------------------------------
# Reproduce the symptom from issue #2783, JSON_OBJ shape.
# Record 3893632 appears twice in the SELECT result set due to a filter join.
$row3893632 = array("id" => 3893632, "up" => 1, "val_ord" => 0, "val" => "00-00627661");
$reqsById3893632 = array(
    3893632 => array("R-2406758:foo", "R-2406759:bar", "R-2406760:%5180%", "R-2406761:baz", "R-2406762:qux"),
);

# Legacy (broken) behaviour: split into two entries, the latter doubled.
$legacy = run_dup_scenario("JSON_OBJ", false, array($row3893632, $row3893632), $reqsById3893632);
assert_eq("Legacy JSON_OBJ produces two newapi entries for duplicate id", 2, count($legacy->newapiObj));
assert_eq("Legacy JSON_OBJ first entry has only main value", 1, count($legacy->newapiObj[0]["r"]));
assert_eq("Legacy JSON_OBJ second entry has 1 main + 2 * 5 reqs = 11", 11, count($legacy->newapiObj[1]["r"]));

# Fixed behaviour: collapses to one entry with main + reqs once.
$fixed = run_dup_scenario("JSON_OBJ", true, array($row3893632, $row3893632), $reqsById3893632);
assert_eq("Fixed JSON_OBJ produces one entry for duplicate id", 1, count($fixed->newapiObj));
assert_eq("Fixed JSON_OBJ entry has 1 main + 5 reqs = 6", 6, count($fixed->newapiObj[0]["r"]));
assert_eq("Fixed JSON_OBJ entry's main value is intact", "00-00627661", $fixed->newapiObj[0]["r"][0]);

# Same scenario via JSON_DATA shape: legacy fires reqs twice (doubled string),
# fixed fires reqs once.
$legacyData = run_dup_scenario("JSON_DATA", false, array($row3893632, $row3893632), $reqsById3893632);
$legacyReqOccurrences = substr_count($legacyData->newapiData[3893632], "R-2406758:foo");
assert_eq("Legacy JSON_DATA appends each req twice for duplicate id", 2, $legacyReqOccurrences);

$fixedData = run_dup_scenario("JSON_DATA", true, array($row3893632, $row3893632), $reqsById3893632);
$fixedReqOccurrences = substr_count($fixedData->newapiData[3893632], "R-2406758:foo");
assert_eq("Fixed JSON_DATA appends each req exactly once for duplicate id", 1, $fixedReqOccurrences);

# ---------------------------------------------------------------------------
# Three duplicates (e.g. column joined three times by overlapping LIKE matches)
# should still collapse to one entry under the fix.
$tripled = run_dup_scenario("JSON_OBJ", true, array($row3893632, $row3893632, $row3893632), $reqsById3893632);
assert_eq("Fixed JSON_OBJ collapses three duplicates to one entry", 1, count($tripled->newapiObj));
assert_eq("Fixed JSON_OBJ tripled-case still has 1 main + 5 reqs = 6", 6, count($tripled->newapiObj[0]["r"]));

# ---------------------------------------------------------------------------
# Distinct ids must not be dedeuped together: two different records on the
# page each keep their own entry.
$rowOther = array("id" => 3893633, "up" => 1, "val_ord" => 1, "val" => "00-00627662");
$reqsByIdMixed = array(
    3893632 => array("R-2406758:foo", "R-2406759:bar"),
    3893633 => array("R-2406758:other"),
);
$mixed = run_dup_scenario("JSON_OBJ", true, array($row3893632, $row3893632, $rowOther), $reqsByIdMixed);
assert_eq("Distinct ids stay separate after dedup", 2, count($mixed->newapiObj));
assert_eq("Dedup entry #0 keeps id 3893632", 3893632, $mixed->newapiObj[0]["i"]);
assert_eq("Dedup entry #1 keeps id 3893633", 3893633, $mixed->newapiObj[1]["i"]);
assert_eq("Dedup entry #0 has 1 main + 2 reqs = 3", 3, count($mixed->newapiObj[0]["r"]));
assert_eq("Dedup entry #1 has 1 main + 1 req = 2", 2, count($mixed->newapiObj[1]["r"]));

# ---------------------------------------------------------------------------
# A single non-duplicated row is the trivial passthrough case — must still
# produce one well-formed entry.
$single = run_dup_scenario("JSON_OBJ", true, array($row3893632), $reqsById3893632);
assert_eq("Single-row case yields one entry", 1, count($single->newapiObj));
assert_eq("Single-row case yields 1 main + 5 reqs = 6", 6, count($single->newapiObj[0]["r"]));

echo "\nAll assertions passed for issue #2783 duplicate-row dedup.\n";
