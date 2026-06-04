<?php
// ---------------------------------------------------------------------------
// Issue #2967 — table alias for the UI.
//
// Users want to name a table independently of its first column. The first
// column of a table IS the term's own `val` (there is no separate row for it),
// so there is nowhere to hang the first column's attrs. The chosen storage is
// a "self-descriptor" requisite row:
//
//     (up = tableId, t = tableId, val = attrsJson, ord = 0)
//
// This row is self-referential (req.t == its own table) which makes it an
// unambiguous marker. The metadata/terms reconstruction must:
//   1. NOT emit it as a column,
//   2. expose its attrs as a table-level `attrs`/`alias`,
//   3. keep the table visible even when it has no other columns,
//   4. not corrupt the `referenced` field of a table that is also referenced.
//
// This script ports the index.php `metadata` and `terms` reconstruction with
// the proposed changes and asserts the four properties above, so the design is
// validated before index.php is edited.
//
// Run: php experiments/test-issue-2967-table-alias.php
// ---------------------------------------------------------------------------

require __DIR__ . '/../include/field_attrs.php';

const BASE_TYPES = [
    1 => 'FREE_LINK', 3 => 'SHORT', 4 => 'DATETIME', 5 => 'GRANT', 6 => 'PWD',
    7 => 'HTML', 8 => 'CHARS', 9 => 'DATE', 10 => 'FILE', 11 => 'BOOLEAN',
    12 => 'MEMO', 13 => 'NUMBER', 14 => 'SIGNED', 15 => 'CALCULATABLE',
    16 => 'REPORT_COLUMN', 17 => 'PATH',
];

function seed_rows() {
    $rows = [];
    foreach (BASE_TYPES as $code => $name)
        $rows[] = ['id' => $code, 'up' => 0, 't' => $code, 'val' => $name, 'ord' => 0];
    return $rows;
}

// Marker test mirroring the SQL join shape: every row of the joined data set
// is one (top-level obj, req) pair. ref_id === id means req.t == obj.id, i.e.
// the self-descriptor row.
function is_self_descriptor($row) {
    return !is_null($row['ref_id']) && (int)$row['ref_id'] === (int)$row['id'];
}

// Port of index.php:`metadata` reconstruction WITH the issue #2967 changes.
function reconstruct_metadata($rows, $oneId = 0) {
    $byId = [];
    foreach ($rows as $r) $byId[(int)$r['id']] = $r;
    $isOne = $oneId > 0;

    $data = [];
    foreach ($rows as $obj) {
        if ($isOne) { if ((int)$obj['id'] !== (int)$oneId) continue; }
        else { if ((int)$obj['up'] !== 0 || (int)$obj['id'] === (int)$obj['t'] || (int)$obj['t'] === 0) continue; }
        $reqRows = array_values(array_filter($rows, fn($r) => (int)$r['up'] === (int)$obj['id']));
        if (!$reqRows) $reqRows = [null];
        foreach ($reqRows as $req) {
            $typs = ($req && (int)$req['t'] !== 1) ? ($byId[(int)$req['t']] ?? null) : null;
            $refs = null;
            if ($typs) {
                $cand = $byId[(int)$typs['t']] ?? null;
                if ($cand && (int)$cand['t'] !== (int)$cand['id']) $refs = $cand;
            }
            $base_typ = $refs ? (int)$refs['t'] : ($typs ? (int)$typs['t'] : null);
            $req_val = ($req && (int)$req['t'] === 1) ? $req['val'] : ($refs ? $refs['val'] : ($typs ? $typs['val'] : null));
            $data[] = [
                'id' => (int)$obj['id'], 'up' => (int)$obj['up'], 't' => (int)$obj['t'],
                'uniq' => (int)$obj['ord'], 'val' => $obj['val'],
                'req_t' => $req ? (int)$req['id'] : null,
                'ref_id' => $req ? (int)$req['t'] : null,
                'ref' => $refs ? (int)$refs['id'] : null,
                'attrs' => $req ? $req['val'] : null,
                'ord' => $req ? (int)$req['ord'] : 0,
                'base_typ' => $base_typ, 'req_val' => $req_val,
            ];
        }
    }

    // Pass 1: classify. Self-descriptor rows are pulled aside as table attrs and
    // are NOT registered in $reqs (so they cannot trigger the column-type skip).
    $reqs = []; $refsMap = []; $tableAttrs = [];
    foreach ($data as $row) {
        if (is_self_descriptor($row)) { $tableAttrs[$row['id']] = $row['attrs']; continue; }
        if (!is_null($row['ref_id'])) $reqs[$row['ref_id']] = $row['id'];
        elseif ((int)$row['t'] > 17) $refsMap[$row['t']] = $row['id'];
    }

    // Pass 2: build meta.
    $meta = []; $metaReqs = [];
    foreach ($data as $row) {
        $selfDesc = is_self_descriptor($row);
        // A self-descriptor row still creates/annotates the table meta entry
        // (so a table whose only req is its self-descriptor stays visible), but
        // is never emitted as a column.
        if (!$selfDesc && !$row['ord'] && isset($reqs[$row['id']])) continue;
        if ((int)$row['t'] > 17) continue;
        if (!isset($meta[$row['id']])) {
            $m = ['id' => (string)$row['id'], 'up' => (string)$row['up'], 'type' => (string)$row['t'],
                  'val' => $row['val'], 'unique' => (string)$row['uniq']];
            if (isset($refsMap[$row['id']])) $m['referenced'] = (string)$refsMap[$row['id']];
            $attrs = isset($tableAttrs[$row['id']]) ? (string)$tableAttrs[$row['id']] : '';
            if (strlen($attrs)) {
                $m['attrs'] = $attrs;
                $alias = FieldAttrsAlias($attrs, '');
                if ($alias !== '') $m['alias'] = $alias;
            }
            $meta[$row['id']] = $m;
        }
        if ($selfDesc) continue;
        if ($row['ord']) {
            $metaReqs[$row['id']][] = ['num' => $row['ord'], 'id' => (string)$row['req_t'], 'val' => $row['req_val']];
        }
    }
    $out = [];
    foreach ($meta as $k => $m) {
        $m['reqs'] = $metaReqs[$k] ?? [];
        usort($m['reqs'], fn($a, $b) => $a['num'] <=> $b['num']);
        $out[] = $m;
    }
    return $out;
}

// Port of index.php:`terms` list WITH the alias exposure.
function reconstruct_terms($rows) {
    $byTable = [];
    foreach ($rows as $r) {
        if ((int)$r['up'] === 0 && (int)$r['id'] !== (int)$r['t'] && $r['val'] !== '' && (int)$r['t'] !== 0)
            $byTable[(int)$r['id']] = $r;
    }
    // collect self-descriptor attrs per table
    $attrsByTable = [];
    foreach ($rows as $r)
        if ((int)$r['up'] !== 0 && (int)$r['up'] === (int)$r['t'] && isset($byTable[(int)$r['up']]))
            $attrsByTable[(int)$r['up']] = $r['val'];
    $out = [];
    foreach ($byTable as $id => $r) {
        $item = ['id' => (string)$id, 'type' => (string)$r['t'], 'name' => $r['val']];
        $alias = isset($attrsByTable[$id]) ? FieldAttrsAlias($attrsByTable[$id], '') : '';
        if ($alias !== '') $item['alias'] = $alias;
        $out[] = $item;
    }
    return $out;
}

// --- Test harness ---------------------------------------------------------
$pass = 0; $fail = 0;
function check($name, $cond) {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  PASS  $name\n"; }
    else { $fail++; echo "  FAIL  $name\n"; }
}
function find_table($meta, $id) {
    foreach ($meta as $m) if ((int)$m['id'] === (int)$id) return $m;
    return null;
}

echo "=== Scenario A: table with alias + real columns ===\n";
$rows = seed_rows();
// Table 1000 "Клиент" (SHORT t=3), one extra column 1001 "Телефон" (SHORT),
// and a self-descriptor 1002 carrying alias "Клиенты".
$rows[] = ['id' => 1000, 'up' => 0,    't' => 3,    'val' => 'Клиент',  'ord' => 0];
$rows[] = ['id' => 1001, 'up' => 1000, 't' => 3,    'val' => '',        'ord' => 1];
$rows[] = ['id' => 1002, 'up' => 1000, 't' => 1000, 'val' => FieldAttrsSetAlias('', 'Клиенты'), 'ord' => 0];
$meta = reconstruct_metadata($rows, 1000);
$t = find_table($meta, 1000);
check('table present', $t !== null);
check('table alias = Клиенты', ($t['alias'] ?? null) === 'Клиенты');
check('table val unchanged (Клиент)', $t['val'] === 'Клиент');
check('exactly 1 column (self-descriptor excluded)', count($t['reqs']) === 1);
check('column is Телефон-row id 1001', (int)$t['reqs'][0]['id'] === 1001);

echo "=== Scenario B: table with alias and NO other columns stays visible ===\n";
$rows = seed_rows();
$rows[] = ['id' => 1000, 'up' => 0,    't' => 3,    'val' => 'Город', 'ord' => 0];
$rows[] = ['id' => 1001, 'up' => 1000, 't' => 1000, 'val' => FieldAttrsSetAlias('', 'Города'), 'ord' => 0];
$metaAll = reconstruct_metadata($rows, 0);
$t = find_table($metaAll, 1000);
check('table still listed in all-tables mode', $t !== null);
check('alias = Города', $t && ($t['alias'] ?? null) === 'Города');
check('no columns emitted', $t && count($t['reqs']) === 0);

echo "=== Scenario C: referenced table that also has an alias ===\n";
$rows = seed_rows();
// Reference table 1000 "Страна" with alias, referenced by table 2000 "Город".
// A reference is a top-level ref object (up=0, t=target); a column of the owner
// then points at that ref object (faithful to _d_ref + _d_req in index.php).
$rows[] = ['id' => 1000, 'up' => 0,    't' => 3,    'val' => 'Страна', 'ord' => 1]; // unique => referenceable
$rows[] = ['id' => 1001, 'up' => 1000, 't' => 1000, 'val' => FieldAttrsSetAlias('', 'Страны'), 'ord' => 0];
$rows[] = ['id' => 1500, 'up' => 0,    't' => 1000, 'val' => '',       'ord' => 0]; // ref object for Страна
$rows[] = ['id' => 2000, 'up' => 0,    't' => 3,    'val' => 'Город',  'ord' => 0];
$rows[] = ['id' => 2001, 'up' => 2000, 't' => 1500, 'val' => '',       'ord' => 1]; // column referencing Страна
$metaAll = reconstruct_metadata($rows, 0);
$strana = find_table($metaAll, 1000);
$gorod  = find_table($metaAll, 2000);
check('Страна present with alias', $strana && ($strana['alias'] ?? null) === 'Страны');
check('Страна referenced field intact', $strana && ($strana['referenced'] ?? null) === '1500');
check('Город present', $gorod !== null);
check('Город has the reference column', $gorod && count($gorod['reqs']) === 1);
check('ref object 1500 not listed as a table', find_table($metaAll, 1500) === null);

echo "=== Scenario D: terms list exposes alias ===\n";
$rows = seed_rows();
$rows[] = ['id' => 1000, 'up' => 0,    't' => 3,    'val' => 'Клиент', 'ord' => 0];
$rows[] = ['id' => 1001, 'up' => 1000, 't' => 1000, 'val' => FieldAttrsSetAlias('', 'Клиенты'), 'ord' => 0];
$rows[] = ['id' => 2000, 'up' => 0,    't' => 3,    'val' => 'Заказ',  'ord' => 0]; // no alias
$terms = reconstruct_terms($rows);
$byId = [];
foreach ($terms as $tm) $byId[(int)$tm['id']] = $tm;
check('Клиент term has alias Клиенты', ($byId[1000]['alias'] ?? null) === 'Клиенты');
check('Клиент term name still Клиент', ($byId[1000]['name'] ?? null) === 'Клиент');
check('Заказ term has no alias key', !isset($byId[2000]['alias']));

echo "\n=== Result: $pass passed, $fail failed ===\n";
exit($fail ? 1 : 0);
