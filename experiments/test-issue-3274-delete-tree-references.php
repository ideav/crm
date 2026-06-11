<?php
/*
 * Regression test for issues #3274 and #3329.
 *
 * #3274: Bulk delete used to check only incoming references to the selected
 * parent rows. BatchDelete() then recursively removed child rows, so a parent
 * with a referenced child row was deleted silently. The delete guard must
 * inspect the whole delete tree before the parent is accepted for deletion.
 *
 * #3329: The tree walk must only descend into records of a subordinate table
 * (array members). Plain requisites (scalar fields, reference attributes) never
 * carry incoming references, so checking them is wasted work. A child is a
 * subordinate-table record when its type is an array defined on the parent's
 * type: arr.up = parentType AND arr.t = childType AND arr.t != arr.up — the same
 * test Check_Grant() uses to recognise array members.
 *
 * Run: php experiments/test-issue-3274-delete-tree-references.php
 */

$index = file_get_contents(__DIR__ . '/../index.php');

function extract_function_source($source, $name) {
    $needle = 'function ' . $name . '(';
    $pos = strpos($source, $needle);
    if ($pos === false) {
        throw new Exception("Function $name not found in index.php");
    }
    $open = strpos($source, '{', $pos);
    if ($open === false) {
        throw new Exception("Function $name has no opening brace");
    }
    $depth = 0;
    $len = strlen($source);
    for ($i = $open; $i < $len; $i++) {
        $ch = $source[$i];
        if ($ch === '{') {
            $depth++;
        } elseif ($ch === '}') {
            $depth--;
            if ($depth === 0) {
                return substr($source, $pos, $i - $pos + 1);
            }
        }
    }
    throw new Exception("Function $name has no closing brace");
}

eval(extract_function_source($index, 'DeleteTreeChildrenSql'));
eval(extract_function_source($index, 'DeleteTreeHasRefs'));
eval(extract_function_source($index, 'DeleteTreeRefsCount'));

$z = 'objects';
$pass = 0;
$fail = 0;

function check($name, $condition) {
    global $pass, $fail;
    if ($condition) {
        $pass++;
        echo "  PASS  $name\n";
    } else {
        $fail++;
        echo "  FAIL  $name\n";
    }
}

/*
 * The mock treats $rows as the whole objects table. Each row is (id, up, t).
 * It answers the three SQL shapes the delete-tree helpers emit and records every
 * id whose incoming references got probed, so tests can assert that plain
 * requisites are never probed.
 */
$GLOBALS['probed'] = array();
function fake_fetch_rows($rows) {
    $byId = array();
    foreach ($rows as $row) {
        $byId[(int)$row['id']] = $row;
    }
    return function ($sql, $errMsg) use ($rows, $byId) {
        // Incoming-reference probe: SELECT id ... WHERE t=N LIMIT 1
        if (preg_match('/WHERE t=([0-9]+) LIMIT 1/', $sql, $m)) {
            $id = (int)$m[1];
            $GLOBALS['probed'][] = $id;
            foreach ($rows as $row) {
                if ((int)$row['t'] === $id) {
                    return array(array('id' => $row['id']));
                }
            }
            return array();
        }
        // Incoming-reference count: SELECT COUNT(id) cnt ... WHERE t=N
        if (preg_match('/COUNT\(id\) cnt FROM [a-zA-Z0-9_]+ WHERE t=([0-9]+)/', $sql, $m)) {
            $id = (int)$m[1];
            $GLOBALS['probed'][] = $id;
            $cnt = 0;
            foreach ($rows as $row) {
                if ((int)$row['t'] === $id) {
                    $cnt++;
                }
            }
            return array(array('cnt' => $cnt));
        }
        // Subordinate-record children: ... arr.up=par.t AND arr.t=child.t AND arr.t!=arr.up WHERE child.up=N
        if (strpos($sql, 'arr.up=par.t') !== false && preg_match('/WHERE child\.up=([0-9]+)/', $sql, $m)) {
            $parentId = (int)$m[1];
            if (!isset($byId[$parentId])) {
                return array();
            }
            $parentType = (int)$byId[$parentId]['t'];
            $children = array();
            foreach ($rows as $child) {
                if ((int)$child['up'] !== $parentId) {
                    continue;
                }
                $childType = (int)$child['t'];
                // Is $childType an array defined on $parentType?
                $isArrayMember = false;
                foreach ($rows as $arr) {
                    if ((int)$arr['up'] === $parentType
                        && (int)$arr['t'] === $childType
                        && (int)$arr['t'] !== (int)$arr['up']) {
                        $isArrayMember = true;
                        break;
                    }
                }
                if ($isArrayMember) {
                    $children[] = array('id' => $child['id']);
                }
            }
            return $children;
        }
        throw new Exception("Unexpected SQL for $errMsg: $sql");
    };
}

/*
 * Shared mini-schema used by the data scenarios below.
 *
 * Metadata (up=0 tables, plus their column/array definitions):
 *   10 Order table              (id=10, up=0,  t=10)
 *   11 Order column "name"      (id=11, up=10, t=3)    scalar requisite def
 *   15 Order -> Line array def  (id=15, up=10, t=20)   arr.up=10, arr.t=20
 *   20 Line subordinate table   (id=20, up=0,  t=20)
 *   21 Line column "qty"        (id=21, up=20, t=13)   scalar requisite def
 *   25 Line -> Tax array def    (id=25, up=20, t=30)   nested array def
 *   30 Tax subordinate table    (id=30, up=0,  t=30)
 */
function schema_rows() {
    return array(
        array('id' => 10, 'up' => 0,  't' => 10),
        array('id' => 11, 'up' => 10, 't' => 3),
        array('id' => 15, 'up' => 10, 't' => 20),
        array('id' => 20, 'up' => 0,  't' => 20),
        array('id' => 21, 'up' => 20, 't' => 13),
        array('id' => 25, 'up' => 20, 't' => 30),
        array('id' => 30, 'up' => 0,  't' => 30),
    );
}

echo "=== Scenario A: referenced subordinate record blocks the parent ===\n";
// Order 100 with a scalar field, a reference attribute, and a Line subordinate record.
$rows = array_merge(schema_rows(), array(
    array('id' => 100, 'up' => 1,   't' => 10),  // Order record (root, deletable)
    array('id' => 110, 'up' => 100, 't' => 11),  // scalar "name" requisite
    array('id' => 130, 'up' => 100, 't' => 700), // reference attribute -> object 700
    array('id' => 120, 'up' => 100, 't' => 20),  // Line subordinate record
    array('id' => 121, 'up' => 120, 't' => 21),  // Line's scalar "qty" requisite
    array('id' => 300, 'up' => 999, 't' => 120), // external reference TO Line 120
));
$fetchRows = fake_fetch_rows($rows);
$GLOBALS['probed'] = array();
check('referenced subordinate record blocks deletion', DeleteTreeHasRefs(100, $fetchRows) === true);
check('referenced subordinate record is counted once', DeleteTreeRefsCount(100, $fetchRows) === 1);
// Optimization: only real records (Order 100, Line 120) get probed — never the
// scalar requisites (110, 121) or the reference attribute (130).
$probed = array_unique($GLOBALS['probed']);
sort($probed);
check('only subordinate records are probed (100,120)', $probed === array(100, 120));
check('scalar requisite 110 is never probed', !in_array(110, $GLOBALS['probed']));
check('reference attribute 130 is never probed', !in_array(130, $GLOBALS['probed']));
check('nested scalar requisite 121 is never probed', !in_array(121, $GLOBALS['probed']));

echo "=== Scenario B: unreferenced tree is accepted, requisites still skipped ===\n";
$rows = array_merge(schema_rows(), array(
    array('id' => 100, 'up' => 1,   't' => 10),
    array('id' => 110, 'up' => 100, 't' => 11),  // scalar requisite
    array('id' => 130, 'up' => 100, 't' => 700), // reference attribute
    array('id' => 120, 'up' => 100, 't' => 20),  // Line subordinate record (unreferenced)
    array('id' => 121, 'up' => 120, 't' => 21),  // Line scalar requisite
));
$fetchRows = fake_fetch_rows($rows);
$GLOBALS['probed'] = array();
check('unreferenced tree has no refs', DeleteTreeHasRefs(100, $fetchRows) === false);
check('unreferenced tree count is zero', DeleteTreeRefsCount(100, $fetchRows) === 0);
$probed = array_unique($GLOBALS['probed']);
sort($probed);
check('still only records probed (100,120)', $probed === array(100, 120));

echo "=== Scenario C: deeply nested subordinate record blocks the root ===\n";
// Order 100 -> Line 120 -> Tax 125, with an external reference to the Tax record.
$rows = array_merge(schema_rows(), array(
    array('id' => 100, 'up' => 1,   't' => 10),  // Order
    array('id' => 120, 'up' => 100, 't' => 20),  // Line subordinate record
    array('id' => 125, 'up' => 120, 't' => 30),  // Tax nested subordinate record
    array('id' => 126, 'up' => 125, 't' => 99),  // Tax scalar requisite (def omitted -> requisite)
    array('id' => 400, 'up' => 888, 't' => 125), // external reference TO Tax 125
));
$fetchRows = fake_fetch_rows($rows);
$GLOBALS['probed'] = array();
check('grandchild subordinate reference blocks root', DeleteTreeHasRefs(100, $fetchRows) === true);
check('grandchild subordinate reference is counted', DeleteTreeRefsCount(100, $fetchRows) === 1);
$probed = array_unique($GLOBALS['probed']);
sort($probed);
check('records along the chain are probed (100,120,125)', $probed === array(100, 120, 125));
check('Tax scalar requisite 126 is never probed', !in_array(126, $GLOBALS['probed']));

echo "=== Scenario D: a reference directly on the parent still blocks it ===\n";
// Something outside points straight at the Order record being deleted.
$rows = array_merge(schema_rows(), array(
    array('id' => 100, 'up' => 1,   't' => 10),  // Order
    array('id' => 110, 'up' => 100, 't' => 11),  // scalar requisite
    array('id' => 500, 'up' => 777, 't' => 100), // external reference TO Order 100
));
$fetchRows = fake_fetch_rows($rows);
$GLOBALS['probed'] = array();
check('direct reference on parent blocks deletion', DeleteTreeHasRefs(100, $fetchRows) === true);
check('direct reference on parent is counted', DeleteTreeRefsCount(100, $fetchRows) === 1);

echo "=== Scenario E: guard ignores non-positive ids ===\n";
$fetchRows = fake_fetch_rows(schema_rows());
check('non-positive ids are ignored by guard', DeleteTreeHasRefs(0, $fetchRows) === false);
check('non-positive ids have zero ref count', DeleteTreeRefsCount(0, $fetchRows) === 0);

if ($fail) {
    echo "\nFAILED: $fail checks failed, $pass passed\n";
    exit(1);
}

echo "\nOK: $pass checks passed\n";
