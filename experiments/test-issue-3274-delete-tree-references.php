<?php
/*
 * Regression test for issue #3274.
 *
 * Bulk delete used to check only incoming references to the selected parent
 * rows. BatchDelete() then recursively removed child rows, so a parent with a
 * referenced child row was deleted silently. The delete guard must inspect the
 * whole delete tree before the parent is accepted for deletion.
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

$hasRefsSource = extract_function_source($index, 'DeleteTreeHasRefs');
$countRefsSource = extract_function_source($index, 'DeleteTreeRefsCount');
eval($hasRefsSource);
eval($countRefsSource);

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

function fake_fetch_rows($rows) {
    return function ($sql, $errMsg) use ($rows) {
        if (preg_match('/WHERE t=([0-9]+) LIMIT 1/', $sql, $m)) {
            $id = (int)$m[1];
            foreach ($rows as $row) {
                if ((int)$row['t'] === $id) {
                    return array(array('id' => $row['id']));
                }
            }
            return array();
        }
        if (preg_match('/COUNT\(id\) cnt FROM [a-zA-Z0-9_]+ WHERE t=([0-9]+)/', $sql, $m)) {
            $id = (int)$m[1];
            $cnt = 0;
            foreach ($rows as $row) {
                if ((int)$row['t'] === $id) {
                    $cnt++;
                }
            }
            return array(array('cnt' => $cnt));
        }
        if (preg_match('/WHERE up=([0-9]+)/', $sql, $m)) {
            $id = (int)$m[1];
            $children = array();
            foreach ($rows as $row) {
                if ((int)$row['up'] === $id) {
                    $children[] = array('id' => $row['id']);
                }
            }
            return $children;
        }
        throw new Exception("Unexpected SQL for $errMsg: $sql");
    };
}

function old_direct_only_bulk_delete_roots($roots, $fetchRows) {
    $out = array();
    foreach ($roots as $root) {
        $refs = call_user_func($fetchRows, "SELECT id FROM objects WHERE t=$root LIMIT 1", 'old direct refs');
        if (!count($refs)) {
            $out[] = $root;
        }
    }
    return $out;
}

function fixed_tree_bulk_delete_roots($roots, $fetchRows) {
    $out = array();
    foreach ($roots as $root) {
        if (!DeleteTreeHasRefs($root, $fetchRows)) {
            $out[] = $root;
        }
    }
    return $out;
}

echo "=== Scenario A: direct-only bulk check misses a referenced child ===\n";
$rows = array(
    array('id' => 100, 'up' => 1,   't' => 10),  // selected parent A
    array('id' => 101, 'up' => 1,   't' => 10),  // selected parent B
    array('id' => 200, 'up' => 100, 't' => 20),  // child of A
    array('id' => 201, 'up' => 101, 't' => 20),  // child of B
    array('id' => 300, 'up' => 999, 't' => 200), // external reference to child A
);
$fetchRows = fake_fetch_rows($rows);
check(
    'old direct-only check would delete both selected parents',
    old_direct_only_bulk_delete_roots(array(100, 101), $fetchRows) === array(100, 101)
);
check('tree guard detects reference below parent A', DeleteTreeHasRefs(100, $fetchRows) === true);
check('tree guard counts the referenced child once', DeleteTreeRefsCount(100, $fetchRows) === 1);
check('unreferenced sibling parent B remains deletable', DeleteTreeHasRefs(101, $fetchRows) === false);
check(
    'fixed bulk check skips only parent A',
    fixed_tree_bulk_delete_roots(array(100, 101), $fetchRows) === array(101)
);

echo "=== Scenario B: grandchild references also block the root ===\n";
$rows = array(
    array('id' => 500, 'up' => 1,   't' => 50),
    array('id' => 501, 'up' => 500, 't' => 51),
    array('id' => 502, 'up' => 501, 't' => 52),
    array('id' => 900, 'up' => 777, 't' => 502),
);
$fetchRows = fake_fetch_rows($rows);
check('grandchild reference blocks root deletion', DeleteTreeHasRefs(500, $fetchRows) === true);
check('grandchild reference is included in count', DeleteTreeRefsCount(500, $fetchRows) === 1);

echo "=== Scenario C: direct parent references keep existing behavior ===\n";
$rows = array(
    array('id' => 600, 'up' => 1,   't' => 60),
    array('id' => 601, 'up' => 600, 't' => 61),
    array('id' => 950, 'up' => 888, 't' => 600),
);
$fetchRows = fake_fetch_rows($rows);
check('direct reference still blocks deletion', DeleteTreeHasRefs(600, $fetchRows) === true);
check('direct reference count is preserved', DeleteTreeRefsCount(600, $fetchRows) === 1);

echo "=== Scenario D: unreferenced trees are accepted ===\n";
$rows = array(
    array('id' => 700, 'up' => 1,   't' => 70),
    array('id' => 701, 'up' => 700, 't' => 71),
);
$fetchRows = fake_fetch_rows($rows);
check('unreferenced tree has no refs', DeleteTreeHasRefs(700, $fetchRows) === false);
check('unreferenced tree count is zero', DeleteTreeRefsCount(700, $fetchRows) === 0);
check('non-positive ids are ignored by guard', DeleteTreeHasRefs(0, $fetchRows) === false);
check('non-positive ids have zero ref count', DeleteTreeRefsCount(0, $fetchRows) === 0);

if ($fail) {
    echo "\nFAILED: $fail checks failed, $pass passed\n";
    exit(1);
}

echo "\nOK: $pass checks passed\n";
