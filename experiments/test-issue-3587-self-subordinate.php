<?php
// ---------------------------------------------------------------------------
// Issue #3587 — a self-referential subordinate table is dropped from metadata.
//
// PR #2968 (#2967) stores a table's first-column alias in a "self-descriptor"
// requisite row:  (up = tableId, t = tableId, ord = 0).
// The metadata / obj_meta / terms / _t_alias endpoints recognise it ONLY by
//   req.t === tableId
// and skip it. #2984 then generalised "up == t" as THE marker of the
// descriptor and guarded core queries with `t != up`.
//
// #3587 disproves the "up == t  <=>  self-descriptor" assumption. A table can
// have a subordinate (nested) table that points back to ITSELF — the system
// "Меню" table has a child sub-table "Меню" (recursive menu). Its requisite
// row is  (up = tableId, t = tableId, ord > 0)  — up == t, exactly like the
// descriptor, but it is a REAL column at a real position.
//
// So the correct discriminator for the self-descriptor is  up == t AND ord = 0.
// Identifying it by  up == t  alone makes the self-referential subordinate
// table vanish from the metadata (reported: «В метаданных Меню нет подчинённой
// таблицы Меню»), and the `t != up` guard drops that column from every
// requisite-LISTING query too.
//
// Run: php experiments/test-issue-3587-self-subordinate.php
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
function one($db, $sql) { return $db->querySingle($sql); }

// --- Seed: system table 151 "Меню" (base type SHORT=3) --------------------
$T = 151;
ins($db, 3,   0,   3,   'SHORT', 0);             // base type row
ins($db, 151, 0,   3,   'Меню',  0);             // the table/term itself (id != t)
// three scalar columns (t = base/ref type, never the table id) — ord 1,2,4
ins($db, 153, 151, 8,   '',      1);             // "Адрес"     (CHARS=8)
ins($db, 158, 151, 3,   '',      2);             // "Параметры" (SHORT=3)
ins($db, 391, 151, 8,   '',      4);             // "Иконка"    (CHARS=8)
// the SELF-REFERENTIAL subordinate table "Меню→Меню": up==t==151, ord=3 (#3587)
ins($db, 300, 151, 151, '',      3);
// the SELF-DESCRIPTOR carrying the first-column alias: up==t==151, ord=0 (#2967)
ins($db, 301, 151, 151, '{"alias":"Меню"}', 0);
// two real data records (recursive menu items): t=151, up!=0, up!=t
ins($db, 2001, 1,    151, 'Главное',  0);
ins($db, 2002, 2001, 151, 'Подпункт', 0);

// --- Test harness ---------------------------------------------------------
$pass = 0; $fail = 0;
function check($name, $cond) {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  PASS  $name\n"; }
    else { $fail++; echo "  FAIL  $name\n"; }
}

echo "=== 1. metadata requisite emission (index.php case \"metadata\"/\"obj_meta\") ===\n";
// Replicates the PHP classification: a row is the self-descriptor (skipped)
// when req.t === tableId; emitted as column num when ord>0. Old code ignores
// ord, new code requires ord===0 for the descriptor.
$rows = [];
$res = $db->query("SELECT id, up, t, ord FROM z WHERE up=$T ORDER BY ord");
while ($r = $res->fetchArray(SQLITE3_ASSOC)) $rows[] = $r;
function emittedNums($rows, $T, $ordGuard) {
    $nums = [];
    foreach ($rows as $r) {
        $selfDesc = ((int)$r['t'] === $T) && (!$ordGuard || (int)$r['ord'] === 0);
        if ($selfDesc) continue;          // index.php:11753 — descriptor never emitted
        if ((int)$r['ord'] > 0) $nums[] = (int)$r['ord']; // index.php:11755
    }
    sort($nums);
    return $nums;
}
$old = emittedNums($rows, $T, false);   // marker = up==t only (buggy)
$new = emittedNums($rows, $T, true);    // marker = up==t AND ord==0 (fixed)
check("old code loses num 3 (got [".implode(',', $old)."], the «Меню→Меню» column)", $old === [1,2,4]);
check("fixed code emits all 4 columns incl. self-subordinate (got [".implode(',', $new)."])", $new === [1,2,3,4]);

echo "=== 2. the descriptor is exactly up==t AND ord==0 (not up==t alone) ===\n";
$bothUpT  = (int)one($db, "SELECT COUNT(*) FROM z WHERE up=$T AND t=$T");          // descriptor + self-subordinate
$trueDesc = (int)one($db, "SELECT COUNT(*) FROM z WHERE up=$T AND t=$T AND ord=0");// descriptor only
$selfSub  = (int)one($db, "SELECT id  FROM z WHERE up=$T AND t=$T AND ord>0");
check("two rows have up==t (descriptor AND self-subordinate), got $bothUpT", $bothUpT === 2);
check("exactly one is the true descriptor (up==t AND ord=0)", $trueDesc === 1);
check("the self-subordinate column is id 300 (ord>0)", (int)$selfSub === 300);

echo "=== 3. requisite-LISTING guard: t!=up has the #3587 blind spot ===\n";
// Columns of the table = children up=151. Three variants:
$noGuard  = (int)one($db, "SELECT COUNT(*) FROM z WHERE up=$T");                       // + descriptor = phantom
$tNeUp    = (int)one($db, "SELECT COUNT(*) FROM z WHERE up=$T AND t!=up");             // #2984 guard — drops self-subordinate too
$correct  = (int)one($db, "SELECT COUNT(*) FROM z WHERE up=$T AND NOT (t=up AND ord=0)"); // keeps self-subordinate
check("no-guard listing includes the descriptor as a phantom column (got $noGuard, real is 4)", $noGuard === 5);
check("t!=up guard WRONGLY drops the self-subordinate column (got $tNeUp, should be 4)", $tNeUp === 3);
check("correct guard keeps all 4 real columns, drops only the descriptor", $correct === 4);

echo "=== 4. instance counting: t!=up is still correct here ===\n";
// Data instances of the table = t=151 AND up!=0. Both up==t rows (descriptor
// and self-subordinate requisite) are NOT data records, so excluding all
// up==t rows is the right behaviour for counting instances.
$cntNoGuard = (int)one($db, "SELECT COUNT(*) FROM z WHERE t=$T AND up!=0");            // + descriptor + self-sub req
$cntGuard   = (int)one($db, "SELECT COUNT(*) FROM z WHERE t=$T AND up!=0 AND t!=up");  // 2 real records
check("unguarded instance count is inflated by the up==t rows (got $cntNoGuard, real is 2)", $cntNoGuard === 4);
check("t!=up instance count = 2 real records (guard correct for counting)", $cntGuard === 2);

echo "\n=== Result: $pass passed, $fail failed ===\n";
exit($fail ? 1 : 0);
