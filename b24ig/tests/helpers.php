<?php
/** Общие функции живых тестов. */

$results = array();

function check($name, $cond, $detail = '')
{
    global $results;
    $results[] = array($name, (bool)$cond);
    echo ($cond ? '  ✅ ' : '  ❌ ') . $name . ($cond || $detail === '' ? '' : " — $detail") . "\n";
}

function summary()
{
    global $results;
    $failed = count(array_filter($results, function ($r) { return !$r[1]; }));
    echo "\n" . ($failed ? "ПРОВАЛЕНО $failed из " . count($results) : 'OK: ' . count($results) . ' проверок') . "\n";
    return $failed ? 1 : 0;
}

function rrmdir($d)
{
    if (!is_dir($d)) return;
    foreach (array_diff(scandir($d), array('.', '..')) as $f) is_dir("$d/$f") ? rrmdir("$d/$f") : unlink("$d/$f");
    rmdir($d);
}

/** Записи таблицы и её схема (колонки по имени). */
function table(IntegramClient $ig, $id)
{
    return array('schema' => TableSchema::fromMetadata($ig->metadata($id)), 'rows' => $ig->readAll($id));
}

function val(array $t, array $row, $col)
{
    $c = $t['schema']->column($col);
    return isset($row[$c['pos']]) ? (string)$row[$c['pos']] : '';
}

function findBy(array $t, $col, $value)
{
    $out = array();
    $pos = $t['schema']->column($col)['pos'];
    foreach ($t['rows'] as $id => $r) if ((string)$r[$pos] === (string)$value) $out[$id] = $r;
    return $out;
}

function one(array $t, $col, $value)
{
    $f = findBy($t, $col, $value);
    return count($f) === 1 ? array(key($f), current($f)) : array(null, null);
}

/** JSON-фикстуры по именам; ключ с расширением .xml пишется как есть. */
function writeFixtures($dir, array $fx)
{
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    foreach ($fx as $name => $data) {
        if (substr($name, -4) === '.xml') file_put_contents("$dir/$name", $data);
        else file_put_contents("$dir/$name.json", json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    }
}
