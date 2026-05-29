<?php
// ---------------------------------------------------------------------------
// In-memory mock of the Integram metadata editor API, faithful to index.php.
//
// Models the single-table ($z) meta-store: every row is {id, up, t, val, ord}.
// Replicates the dedup semantics of _d_new / _d_ref / _d_req, the attrs write
// of _d_attrs, and the `metadata` reconstruction query (index.php:10814).
//
// State persists in a JSON file between requests (php -S is single-process but
// each request is isolated), so the pwsh script's sequence of calls accumulates.
//
// Run:  php -S 127.0.0.1:8077 experiments/mock_integram.php
// Reset: send GET /reset   (clears the store, re-seeds base types)
// ---------------------------------------------------------------------------

const BASE_TYPES = [
    1 => 'FREE_LINK', 3 => 'SHORT', 4 => 'DATETIME', 5 => 'GRANT', 6 => 'PWD',
    7 => 'HTML', 8 => 'CHARS', 9 => 'DATE', 10 => 'FILE', 11 => 'BOOLEAN',
    12 => 'MEMO', 13 => 'NUMBER', 14 => 'SIGNED', 15 => 'CALCULATABLE',
    16 => 'REPORT_COLUMN', 17 => 'PATH',
];

$STATE_FILE = sys_get_temp_dir() . '/mock_integram_state.json';

function load_state($file) {
    if (!file_exists($file)) return seed_state($file);
    return json_decode(file_get_contents($file), true);
}
function save_state($file, $state) {
    file_put_contents($file, json_encode($state));
}
function seed_state($file) {
    // Base-type rows are self-referential (id == t), up=0.
    $rows = [];
    foreach (BASE_TYPES as $code => $name) {
        $rows[] = ['id' => $code, 'up' => 0, 't' => $code, 'val' => $name, 'ord' => 0];
    }
    $state = ['rows' => $rows, 'next_id' => 1000];
    save_state($file, $state);
    return $state;
}
function &row_by_id(&$state, $id) {
    foreach ($state['rows'] as $i => $r) {
        if ((int)$r['id'] === (int)$id) return $state['rows'][$i];
    }
    $null = null;
    return $null;
}
function insert(&$state, $up, $ord, $t, $val) {
    $id = $state['next_id']++;
    $state['rows'][] = ['id' => $id, 'up' => (int)$up, 't' => (int)$t, 'val' => $val, 'ord' => (int)$ord];
    return $id;
}
function next_ord(&$state, $up) {
    $max = 0;
    foreach ($state['rows'] as $r) {
        if ((int)$r['up'] === (int)$up && (int)$r['ord'] > $max) $max = (int)$r['ord'];
    }
    return $max + 1;
}

// --- FieldAttrsBuild port (matches include/field_attrs.php behaviour) ---
function field_attrs_bool($v) {
    if (is_bool($v)) return $v;
    if (is_numeric($v)) return ((int)$v) !== 0;
    if (is_string($v)) { $v = strtolower(trim($v)); return !in_array($v, ['', '0', 'false', 'no', 'off'], true); }
    return !empty($v);
}
function field_attrs_build($default, $required, $multi, $alias, $key) {
    $json = [];
    if (field_attrs_bool($required)) $json['required'] = true;
    if (field_attrs_bool($multi)) $json['multi'] = true;
    if (field_attrs_bool($key)) $json['key'] = true;
    if (!is_null($alias) && $alias !== '') $json['alias'] = (string)$alias;
    if ($default !== '' && !is_null($default)) $json['default'] = (string)$default;
    return count($json) ? json_encode($json, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '';
}

function send_json($data) { header('Content-Type: application/json'); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }
function die_err($msg) { http_response_code(400); send_json(['error' => $msg]); }

// --- Routing ---
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$segments = array_values(array_filter(explode('/', $uri)));
// segments[0] = db name; the command is the rest.
$cmdPath = array_slice($segments, 1);
$cmd = $cmdPath[0] ?? '';
$arg = $cmdPath[1] ?? null;   // {table}/{target}/{reqId}

$state = load_state($STATE_FILE);

$req = array_merge($_GET, $_POST);
$val = isset($req['val']) ? trim($req['val']) : '';
$t = isset($req['t']) ? (int)$req['t'] : 0;
$unique = isset($req['unique']) ? (int)$req['unique'] : 0;

switch ($cmd) {

case 'reset':
    seed_state($STATE_FILE);
    send_json(['ok' => 1]);

case 'auth':
    send_json(['token' => 'mock-token', '_xsrf' => 'mock-xsrf', 'id' => 1, 'user' => $req['login'] ?? '']);

case '_d_new':
    if ($val === '') die_err('Empty type');
    if (!isset(BASE_TYPES[$t]) && $t !== 0) die_err("Invalid base type: $t");
    // Dedup by (val, t), excluding base-type self-rows (id==t).
    foreach ($state['rows'] as $r) {
        if ($r['val'] === $val && (int)$r['t'] === $t && (int)$r['id'] !== (int)$r['t']) {
            send_json(['obj' => (string)$r['id'], 'warning' => 'exists']);
        }
    }
    $obj = insert($state, 0, $unique, $t, $val);
    save_state($STATE_FILE, $state);
    send_json(['obj' => (string)$obj]);

case '_d_ref':
    $id = (int)$arg;
    $target = &row_by_id($state, $id);
    if (!$target) die_err("Type $id not found");
    if ((int)$target['up'] !== 0 || (int)$target['t'] === $id) die_err("Invalid type $id");
    // Dedup: a ref row has up=0, t=target, val=''.
    foreach ($state['rows'] as $r) {
        if ((int)$r['up'] === 0 && (int)$r['t'] === $id && $r['val'] === '') {
            send_json(['obj' => (string)$r['id'], 'warning' => 'exists']);
        }
    }
    $obj = insert($state, 0, 0, $id, '');
    save_state($STATE_FILE, $state);
    send_json(['obj' => (string)$obj]);

case '_d_req':
    $id = (int)$arg;   // table id
    $obj = &row_by_id($state, $id);
    if (!$obj || (int)$obj['up'] !== 0) die_err("Invalid table $id");
    if ($t === 1) { // free link
        if ($val === '') die_err('Empty free link name');
        foreach ($state['rows'] as $r) {
            if ((int)$r['up'] === $id && (int)$r['t'] === 1 && $r['val'] === $val)
                die_err('Free link already exists: ' . $r['id']);
        }
        $newId = insert($state, $id, next_ord($state, $id), 1, $val);
        save_state($STATE_FILE, $state);
        send_json(['id' => (string)$newId, 'obj' => (string)$id]);
    }
    $typ = &row_by_id($state, $t);
    if (!$typ || (int)$typ['up'] !== 0) die_err("Invalid requisite type $t");
    if ((int)$typ['t'] === $t) die_err("Invalid type $t is the base type");
    // Dedup: existing req of this table with this exact type.
    // (Mirrors the practical effect: simple/base/arr req types dedup; the
    //  CROSS-JOIN chain check in index.php means ref-type reqs are NOT
    //  deduped — re-adding a reference column creates a new req.)
    $isRefType = !isset(BASE_TYPES[(int)$typ['t']]); // typ points to another table => ref object
    if (!$isRefType) {
        foreach ($state['rows'] as $r) {
            if ((int)$r['up'] === $id && (int)$r['t'] === $t) {
                send_json(['id' => (string)$r['id'], 'obj' => (string)$id, 'warning' => 'exists']);
            }
        }
    }
    $newId = insert($state, $id, next_ord($state, $id), $t, '');
    save_state($STATE_FILE, $state);
    send_json(['id' => (string)$newId, 'obj' => (string)$id]);

case '_d_attrs':
    $id = (int)$arg;   // req id
    $r = &row_by_id($state, $id);
    if (!$r) die_err("Req $id not found");
    $attr = field_attrs_build($val, isset($req['set_null']), isset($req['multi']),
                              isset($req['alias']) ? $req['alias'] : null, isset($req['key']));
    $r['val'] = $attr;
    save_state($STATE_FILE, $state);
    send_json(['obj' => (string)$r['up']]);

case 'metadata':
    send_json(reconstruct_metadata($state));

default:
    die_err("Unknown command: $cmd");
}

// ---------------------------------------------------------------------------
// Faithful port of the `metadata` reconstruction (index.php:10814-10876).
// ---------------------------------------------------------------------------
function reconstruct_metadata($state) {
    $byId = [];
    foreach ($state['rows'] as $r) $byId[(int)$r['id']] = $r;

    // Build the joined dataset: one row per (top-level obj, req) pair.
    $data = [];
    foreach ($state['rows'] as $obj) {
        if ((int)$obj['up'] !== 0 || (int)$obj['id'] === (int)$obj['t'] || (int)$obj['t'] === 0) continue;
        $reqRows = array_values(array_filter($state['rows'], fn($r) => (int)$r['up'] === (int)$obj['id']));
        if (!$reqRows) { $reqRows = [null]; } // LEFT JOIN: keep obj with no reqs
        foreach ($reqRows as $req) {
            $typs = null; $refs = null; $arr_id = null;
            if ($req && (int)$req['t'] !== 1) {
                $typs = $byId[(int)$req['t']] ?? null;
            }
            if ($typs) {
                $cand = $byId[(int)$typs['t']] ?? null;
                if ($cand && (int)$cand['t'] !== (int)$cand['id']) $refs = $cand;
            }
            if (!$refs && $typs) {
                foreach ($state['rows'] as $a) {
                    if ((int)$a['up'] === (int)$typs['id'] && (int)$a['ord'] === 1) { $arr_id = (int)$typs['id']; break; }
                }
            }
            $base_typ = $refs ? (int)$refs['t'] : ($typs ? (int)$typs['t'] : null);
            if ($req && (int)$req['t'] === 1) {
                $req_val = $req['val'];
            } elseif ($refs) {
                $req_val = $refs['val'];
            } elseif ($typs) {
                $req_val = $typs['val'];
            } else {
                $req_val = null;
            }
            $data[] = [
                'id' => (int)$obj['id'], 'up' => (int)$obj['up'], 't' => (int)$obj['t'],
                'uniq' => (int)$obj['ord'], 'val' => $obj['val'],
                'req_t' => $req ? (int)$req['id'] : null,
                'ref_id' => $req ? (int)$req['t'] : null,
                'ref' => $refs ? (int)$refs['id'] : null,
                'attrs' => $req ? $req['val'] : null,
                'ord' => $req ? (int)$req['ord'] : 0,
                'base_typ' => $base_typ, 'req_val' => $req_val, 'arr_id' => $arr_id,
            ];
        }
    }

    // Pass 1: classify reqs/refs.
    $reqs = []; $refsMap = [];
    foreach ($data as $row) {
        if (!is_null($row['ref_id'])) $reqs[$row['ref_id']] = $row['id'];
        elseif ((int)$row['t'] > 17) $refsMap[$row['t']] = $row['id'];
    }

    // Pass 2: build meta.
    $meta = []; $metaReqs = [];
    foreach ($data as $row) {
        if (!$row['ord'] && isset($reqs[$row['id']])) continue; // skip pure column-types
        if ((int)$row['t'] > 17) continue;                      // skip ref objects
        if (!isset($meta[$row['id']])) {
            $m = ['id' => (string)$row['id'], 'up' => (string)$row['up'], 'type' => (string)$row['t'],
                  'val' => $row['val'], 'unique' => (string)$row['uniq']];
            if (isset($refsMap[$row['id']])) $m['referenced'] = (string)$refsMap[$row['id']];
            $meta[$row['id']] = $m;
        }
        if ($row['ord']) {
            $rq = ['num' => $row['ord'], 'id' => (string)$row['req_t'], 'val' => $row['req_val'],
                   'orig' => (string)($row['ref'] ? $row['ref'] : $row['ref_id']),
                   'type' => (string)($row['base_typ'] ?? '1')];
            if ($row['arr_id']) $rq['arr_id'] = (string)$row['arr_id'];
            if ($row['ref']) { $rq['ref'] = (string)$row['ref']; $rq['ref_id'] = (string)$row['ref_id']; }
            if (strlen((string)$row['attrs'])) $rq['attrs'] = (string)$row['attrs'];
            $metaReqs[$row['id']][] = $rq;
        }
    }
    $out = [];
    foreach ($meta as $k => $m) {
        $m['reqs'] = $metaReqs[$k] ?? [];
        // order reqs by num
        usort($m['reqs'], fn($a, $b) => $a['num'] <=> $b['num']);
        $out[] = $m;
    }
    return $out;
}
