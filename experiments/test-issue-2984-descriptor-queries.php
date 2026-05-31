<?php
// ---------------------------------------------------------------------------
// Issue #2984 — core queries must account for the self-descriptor row.
//
// PR #2968 (issue #2967) introduced a "self-descriptor" requisite row so a
// table can carry a display alias for its first column:
//
//     (up = tableId, t = tableId, val = attrsJson, ord = 0)
//
// Its defining trait is `up == t` (both equal the table id) — the ONLY
// legitimate row in `$z` where `up` equals a non-zero `t`. Every other row
// has `t != up`:
//   * a table/term has up=0 (and id!=t),
//   * a column/requisite has t = its base/ref type, never its own parent,
//   * a data record has up!=0 and t = its table id, never up.
//
// PR #2968 only taught the metadata / terms / obj_meta endpoints about it.
// Many other core queries join requisites to a table by `up = {table id}`,
// or count instances by `t = {table id}`, WITHOUT excluding the descriptor.
// Those queries pick the descriptor up as a phantom column or over-count
// instances by one. This issue audits and fixes them with the established
// `t != up` SQL idiom (already used at index.php:6822/6838/10198).
//
// This script builds the real `$z` schema in SQLite, seeds a table with a
// self-descriptor + columns + data records, and runs each affected query
// class in BOTH its pre-fix (unguarded) and post-fix (`t!=up`-guarded) form.
// It asserts the unguarded form is wrong (so the bug is real and reproduced)
// and the guarded form is correct (so the fix works).
//
// Run: php experiments/test-issue-2984-descriptor-queries.php
// ---------------------------------------------------------------------------

$db = new SQLite3(':memory:');
$db->exec('CREATE TABLE z (id INTEGER PRIMARY KEY, up INTEGER, t INTEGER, val TEXT, ord INTEGER)');

function ins($db, $id, $up, $t, $val, $ord) {
    $st = $db->prepare('INSERT INTO z (id, up, t, val, ord) VALUES (:id, :up, :t, :val, :ord)');
    $st->bindValue(':id', $id, SQLITE3_INTEGER);
    $st->bindValue(':up', $up, SQLITE3_INTEGER);
    $st->bindValue(':t', $t, SQLITE3_INTEGER);
    $st->bindValue(':val', $val, SQLITE3_TEXT);
    $st->bindValue(':ord', $ord, SQLITE3_INTEGER);
    $st->execute();
}
function one($db, $sql) {
    $r = $db->querySingle($sql);
    return $r;
}

// --- Seed: table 1000 "Клиент" (base type SHORT=3) ------------------------
// base type row
ins($db, 3, 0, 3, 'SHORT', 0);
// the table/term itself (first column name lives in its own val)
ins($db, 1000, 0, 3, 'Клиент', 0);
// a real second column "Телефон" (ord=1), base type SHORT
ins($db, 1001, 1000, 3, '', 1);
// the SELF-DESCRIPTOR carrying the alias attrs (up==t==1000, ord=0)
ins($db, 1002, 1000, 1000, '{"alias":"Клиенты"}', 0);
// three data records (instances) of the table: t=1000, up!=0
ins($db, 2001, 1, 1000, 'Иванов', 0);
ins($db, 2002, 1, 1000, 'Петров', 0);
ins($db, 2003, 1, 1000, 'Сидоров', 0);
// per-record requisite values for the second column (up=record, t=1001)
ins($db, 3001, 2001, 1001, '+7-111', 0);
ins($db, 3002, 2002, 1001, '+7-222', 0);

// --- Test harness ---------------------------------------------------------
$pass = 0; $fail = 0;
function check($name, $cond) {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  PASS  $name\n"; }
    else { $fail++; echo "  FAIL  $name\n"; }
}

$cur_typ = 1000;

echo "=== 1. Requisite listing (index.php &uni_obj_head / GetObjectReqs) ===\n";
// Columns of the table = child rows up=tableId. The descriptor (up=1000) is a
// child too, so the unguarded listing yields a phantom requisite.
$sqlNoGuard = "SELECT COUNT(*) FROM z a WHERE a.up=$cur_typ";
$sqlGuard   = "SELECT COUNT(*) FROM z a WHERE a.up=$cur_typ AND a.t!=a.up";
$nNo = (int)one($db, $sqlNoGuard);
$nOk = (int)one($db, $sqlGuard);
check("unguarded over-counts reqs (got $nNo, real is 1)", $nNo === 2);
check("guarded yields exactly the real columns (1)", $nOk === 1);
// and the surviving row is the real column, not the descriptor
$rid = (int)one($db, "SELECT a.id FROM z a WHERE a.up=$cur_typ AND a.t!=a.up");
check("guarded survivor is the real column id 1001", $rid === 1001);

echo "=== 2. Instance count, table view (index.php 6904) ===\n";
// Original (buggy) formula: total children of t minus the up=0 term row.
// The descriptor has up=1000 (!=0) so it is counted but never subtracted.
$sqlNoGuard = "SELECT (SELECT COUNT(1) FROM z WHERE t=$cur_typ)
                    - (SELECT COUNT(1) FROM z WHERE t=$cur_typ AND up=0)";
$sqlGuard   = "SELECT (SELECT COUNT(1) FROM z WHERE t=$cur_typ AND t!=up)
                    - (SELECT COUNT(1) FROM z WHERE t=$cur_typ AND up=0)";
$nNo = (int)one($db, $sqlNoGuard);
$nOk = (int)one($db, $sqlGuard);
check("unguarded count is inflated by the descriptor (got $nNo, real is 3)", $nNo === 4);
check("guarded count equals the 3 real instances", $nOk === 3);

echo "=== 3. API instance count (index.php 6833 _count) ===\n";
$sqlNoGuard = "SELECT COUNT(vals.id) FROM z vals WHERE vals.t=$cur_typ";
$sqlGuard   = "SELECT COUNT(vals.id) FROM z vals WHERE vals.t=$cur_typ AND vals.t!=vals.up";
$nNo = (int)one($db, $sqlNoGuard);
$nOk = (int)one($db, $sqlGuard);
check("unguarded API count includes descriptor (got $nNo, real is 3)", $nNo === 4);
check("guarded API count = 3", $nOk === 3);

echo "=== 4. Type-deletion guard (index.php _d_del / _deleteterm 10723) ===\n";
// Deletion is blocked when the type still has instances. With the descriptor
// counted, an aliased table with NO real instances looks non-empty and cannot
// be deleted. Use a fresh empty-but-aliased table to show it.
$db->exec('DELETE FROM z WHERE id IN (2001,2002,2003,3001,3002)'); // drop instances
$usedNo = (int)one($db, "SELECT COUNT(id) FROM z WHERE t=$cur_typ");
$usedOk = (int)one($db, "SELECT COUNT(id) FROM z WHERE t=$cur_typ AND t!=up");
check("unguarded usage count blocks deletion of empty aliased table (got $usedNo)", $usedNo === 1);
check("guarded usage count is 0 -> deletion allowed", $usedOk === 0);
// restore instances for following tests
ins($db, 2001, 1, 1000, 'Иванов', 0);
ins($db, 2002, 1, 1000, 'Петров', 0);
ins($db, 2003, 1, 1000, 'Сидоров', 0);

echo "=== 5. Requisite JOIN to first column (reqs.up=a.id pattern) ===\n";
// Pattern used by rep_cols / grant_list / csv_all / &edit_typs etc.:
//   LEFT JOIN z reqs ON reqs.up = {table id}
// Without the guard the table joins to its own descriptor as a bogus req.
$sqlNoGuard = "SELECT COUNT(*) FROM z a LEFT JOIN z reqs ON reqs.up=a.id
                    WHERE a.id=$cur_typ AND reqs.id IS NOT NULL";
$sqlGuard   = "SELECT COUNT(*) FROM z a LEFT JOIN z reqs ON reqs.up=a.id AND reqs.t!=reqs.up
                    WHERE a.id=$cur_typ AND reqs.id IS NOT NULL";
$nNo = (int)one($db, $sqlNoGuard);
$nOk = (int)one($db, $sqlGuard);
check("unguarded join attaches descriptor as a req (got $nNo)", $nNo === 2);
check("guarded join attaches only the real column (1)", $nOk === 1);

echo "=== 6. Recursive dependent-items base case (index.php 3680/3685) ===\n";
// Base case of the report recursion: SELECT id ... WHERE t=$typ AND up!=0.
// The descriptor satisfies t=1000 AND up!=0, so it leaks into the seed set.
$sqlNoGuard = "SELECT COUNT(*) FROM (SELECT id FROM z WHERE t=$cur_typ AND up!=0 AND val!='')";
$sqlGuard   = "SELECT COUNT(*) FROM (SELECT id FROM z WHERE t=$cur_typ AND up!=0 AND t!=up AND val!='')";
$nNo = (int)one($db, $sqlNoGuard);
$nOk = (int)one($db, $sqlGuard);
// 3 instances have non-empty val; the descriptor's val is non-empty JSON too.
check("unguarded recursion seeds the descriptor (got $nNo, real is 3)", $nNo === 4);
check("guarded recursion seeds only real instances (3)", $nOk === 3);

echo "=== 7. The guard never drops a legitimate row ===\n";
// Sanity: across the whole seeded base, exactly ONE row has up==t (the
// descriptor). Every table, column and record keeps t!=up.
$descrCount = (int)one($db, "SELECT COUNT(*) FROM z WHERE up=t AND up!=0");
$realRows   = (int)one($db, "SELECT COUNT(*) FROM z WHERE t!=up");
$total      = (int)one($db, "SELECT COUNT(*) FROM z");
check("exactly one up==t row exists (the descriptor)", $descrCount === 1);
check("t!=up keeps every other row", $realRows === $total - 1);

echo "\n=== Result: $pass passed, $fail failed ===\n";
exit($fail ? 1 : 0);
