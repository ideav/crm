<?php
/**
 * Живой тест модуля 1С: настоящая база spz + имитация OData 1С (MockOData).
 * Сам создаёт временные таблицы «ТЕСТ1С …»: контрагенты, номенклатура с иерархией,
 * реализации с подчинённой таблицей «Товары». Прогоняет коннектор: первая загрузка,
 * повтор без изменений, пробный запуск и изменения. В конце удаляет таблицы, колонки и типы.
 *
 *   INTEGRAM_TOKEN=... php tests/live_1c_test.php
 */
require __DIR__ . '/../b24ig.php';
require __DIR__ . '/helpers.php';
date_default_timezone_set('Europe/Moscow');

$root = dirname(__DIR__);
$tmp = "$root/tests/tmp1c";
$token = getenv('INTEGRAM_TOKEN');
if (!$token) exit("нужен INTEGRAM_TOKEN\n");
$ig = new IntegramClient(array('base_url' => 'https://ideav.ru', 'db' => 'spz', 'token' => $token));
$madeTypes = array();

// ------------------------------------------------------------ DDL для временных таблиц
function newTable(IntegramClient $ig, $name)
{
    // без параметра unique: ядро делает таблицу уникальной при любом его значении, даже unique=0
    $r = $ig->post('_d_new?JSON=1', array('t' => 3, 'val' => $name));
    return (int)$r['obj'];
}
function newCol(IntegramClient $ig, $table, $base, $typeName, $alias, $key = false)
{
    global $madeTypes;
    $t = $ig->post('_d_new?JSON=1', array('t' => $base, 'val' => $typeName));
    $madeTypes[] = (int)$t['obj'];
    $r = $ig->post("_d_req/$table?JSON=1", array('t' => $t['obj']));
    $ig->post('_d_alias/' . $r['id'] . '?JSON=1', array('val' => $alias));
    if ($key) $ig->post('_d_key/' . $r['id'] . '?JSON=1', array());
    return (int)$r['id'];
}
function newRef(IntegramClient $ig, $table, $target, $alias)
{
    global $madeTypes;
    $ref = $ig->post("_d_ref/$target?JSON=1", array());
    $madeTypes[] = (int)$ref['obj'];
    $r = $ig->post("_d_req/$table?JSON=1", array('t' => $ref['obj']));
    $ig->post('_d_alias/' . $r['id'] . '?JSON=1', array('val' => $alias));
    return (int)$r['id'];
}

/** Удаляет все таблицы «ТЕСТ1С …»: записи → колонки → ref-типы и таблицы → типы колонок. */
function dropTestTables(IntegramClient $ig, array $types)
{
    $tables = array();
    foreach ($ig->get('metadata?JSON=1') as $t) if (strpos($t['val'], 'ТЕСТ1С ') === 0) $tables[(int)$t['id']] = $t;
    $errors = array();
    for ($round = 0; $round < 4; $round++) {      // записи со ссылками удаляются после ссылающихся
        $left = 0;
        foreach (array_keys($tables) as $id) {
            foreach (array_keys($ig->readAll($id)) as $rid) {
                try { $ig->mDel($rid); } catch (Exception $e) { $left++; }
            }
        }
        if (!$left) break;
    }
    foreach ($tables as $t) {
        foreach ($t['reqs'] as $r) {
            try { $ig->post('_d_del_req/' . $r['id'] . '?JSON=1', array('forced' => 1)); } catch (Exception $e) { $errors[] = "колонка {$r['id']}: " . $e->getMessage(); }
        }
    }
    $pending = array_unique(array_merge($types, array_keys($tables)));
    for ($round = 0; $round < 4 && $pending; $round++) {
        $next = array();
        foreach ($pending as $id) {
            try { $ig->post("_d_del/$id?JSON=1", array()); } catch (Exception $e) { $next[] = $id; }
        }
        $pending = $next;
    }
    foreach ($pending as $id) $errors[] = "тип/таблица $id не удалены";
    return $errors;
}

function runConnector(array $extra = array())
{
    global $tmp;
    $code = Runner::run(array_merge(array('config' => "$tmp/config.json"), $extra));
    return array($code, json_decode(file_get_contents("$tmp/logs/last-report.json"), true));
}

$g = function ($n) { return sprintf('aaaaaaaa-1c00-0000-0000-%012d', $n); };

// ------------------------------------------------------------ подготовка
echo "Подготовка: временные таблицы\n";
rrmdir($tmp);
$left = dropTestTables($ig, array());   // хвосты прошлого запуска
$T = array();
$C = array();
$exit = 1;
try {
    $T['ctr'] = newTable($ig, 'ТЕСТ1С Контрагент');
    $C['ctr_guid'] = newCol($ig, $T['ctr'], 3, 'ТЕСТ1С.Контрагент.GUID', 'GUID 1С', true);
    $C['ctr_inn'] = newCol($ig, $T['ctr'], 3, 'ТЕСТ1С.Контрагент.ИНН', 'ИНН');
    $C['ctr_del'] = newCol($ig, $T['ctr'], 3, 'ТЕСТ1С.Контрагент.Удалён', 'Помечен на удаление');

    $T['prod'] = newTable($ig, 'ТЕСТ1С Номенклатура');
    $C['prod_guid'] = newCol($ig, $T['prod'], 3, 'ТЕСТ1С.Номенклатура.GUID', 'GUID 1С', true);
    $C['prod_art'] = newCol($ig, $T['prod'], 3, 'ТЕСТ1С.Номенклатура.Артикул', 'Артикул');
    $C['prod_parent'] = newRef($ig, $T['prod'], $T['prod'], 'Родитель');
    $C['prod_unit'] = newCol($ig, $T['prod'], 3, 'ТЕСТ1С.Номенклатура.Единица', 'Единица');

    $T['sale'] = newTable($ig, 'ТЕСТ1С Реализация');
    $C['sale_guid'] = newCol($ig, $T['sale'], 3, 'ТЕСТ1С.Реализация.GUID', 'GUID 1С', true);
    $C['sale_date'] = newCol($ig, $T['sale'], 4, 'ТЕСТ1С.Реализация.Дата', 'Дата');
    $C['sale_pay'] = newCol($ig, $T['sale'], 4, 'ТЕСТ1С.Реализация.ДатаОплаты', 'Дата оплаты');
    $C['sale_ctr'] = newRef($ig, $T['sale'], $T['ctr'], 'Контрагент');
    $C['sale_sum'] = newCol($ig, $T['sale'], 14, 'ТЕСТ1С.Реализация.Сумма', 'Сумма');
    $C['sale_posted'] = newCol($ig, $T['sale'], 3, 'ТЕСТ1С.Реализация.Проведён', 'Проведён');

    $T['item'] = newTable($ig, 'ТЕСТ1С Строка реализации');
    $C['item_prod'] = newRef($ig, $T['item'], $T['prod'], 'Номенклатура');
    $C['item_qty'] = newCol($ig, $T['item'], 14, 'ТЕСТ1С.Строка.Количество', 'Количество');
    $C['item_price'] = newCol($ig, $T['item'], 14, 'ТЕСТ1С.Строка.Цена', 'Цена');
    $C['item_sum'] = newCol($ig, $T['item'], 14, 'ТЕСТ1С.Строка.Сумма', 'Сумма');
    $r = $ig->post("_d_req/{$T['sale']}?JSON=1", array('t' => $T['item']));
    $ig->post('_d_alias/' . $r['id'] . '?JSON=1', array('val' => 'Товары'));
    echo '  таблицы: ' . json_encode($T) . "\n";

    // «старый» контрагент без GUID — должен привязаться по названию
    $ig->mNew($T['ctr'], array('t' . $T['ctr'] => 'ТЕСТ1С ООО Ромашка'));
    $legacy = one(table($ig, $T['ctr']), '@name', 'ТЕСТ1С ООО Ромашка')[0];

    $metadata = '<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" Version="1.0"><edmx:DataServices><Schema xmlns="http://schemas.microsoft.com/ado/2009/11/edm" Namespace="StandardODATA">
<EntityType Name="Catalog_ЕдиницыИзмерения"><Key><PropertyRef Name="Ref_Key"/></Key><Property Name="Ref_Key" Type="Edm.Guid"/><Property Name="Description" Type="Edm.String"/></EntityType>
<EntityType Name="Catalog_Контрагенты"><Key><PropertyRef Name="Ref_Key"/></Key><Property Name="Ref_Key" Type="Edm.Guid"/><Property Name="DataVersion" Type="Edm.String"/><Property Name="DeletionMark" Type="Edm.Boolean"/><Property Name="Description" Type="Edm.String"/><Property Name="ИНН" Type="Edm.String"/></EntityType>
<EntityType Name="Catalog_Номенклатура"><Key><PropertyRef Name="Ref_Key"/></Key><Property Name="Ref_Key" Type="Edm.Guid"/><Property Name="DataVersion" Type="Edm.String"/><Property Name="DeletionMark" Type="Edm.Boolean"/><Property Name="IsFolder" Type="Edm.Boolean"/><Property Name="Parent_Key" Type="Edm.Guid"/><Property Name="Description" Type="Edm.String"/><Property Name="Артикул" Type="Edm.String"/><Property Name="ЕдиницаИзмерения_Key" Type="Edm.Guid"/></EntityType>
<EntityType Name="Document_РеализацияТоваровУслуг"><Key><PropertyRef Name="Ref_Key"/></Key><Property Name="Ref_Key" Type="Edm.Guid"/><Property Name="DataVersion" Type="Edm.String"/><Property Name="DeletionMark" Type="Edm.Boolean"/><Property Name="Number" Type="Edm.String"/><Property Name="Date" Type="Edm.DateTime"/><Property Name="Posted" Type="Edm.Boolean"/><Property Name="Контрагент_Key" Type="Edm.Guid"/><Property Name="СуммаДокумента" Type="Edm.Double"/><Property Name="ДатаОплаты" Type="Edm.DateTime"/><Property Name="Товары" Type="Collection(StandardODATA.Document_РеализацияТоваровУслуг_Товары_RowType)"/></EntityType>
<ComplexType Name="Document_РеализацияТоваровУслуг_Товары_RowType"><Property Name="LineNumber" Type="Edm.Int64"/><Property Name="Номенклатура_Key" Type="Edm.Guid"/><Property Name="Количество" Type="Edm.Double"/><Property Name="Цена" Type="Edm.Double"/><Property Name="Сумма" Type="Edm.Double"/></ComplexType>
</Schema></edmx:DataServices></edmx:Edmx>';

    $E = OneCSource::EMPTY_GUID;
    $fx = array(
        'metadata.xml' => $metadata,
        'Catalog_ЕдиницыИзмерения' => array(array('Ref_Key' => $g(901), 'Description' => 'шт'), array('Ref_Key' => $g(902), 'Description' => 'кг')),
        'Catalog_Контрагенты' => array(
            array('Ref_Key' => $g(1), 'DataVersion' => 'AAAA1', 'DeletionMark' => false, 'Description' => 'ТЕСТ1С ООО Ромашка', 'ИНН' => '7700000001'),
            array('Ref_Key' => $g(2), 'DataVersion' => 'AAAA1', 'DeletionMark' => false, 'Description' => 'ТЕСТ1С ИП Иванов', 'ИНН' => '500100000002'),
        ),
        'Catalog_Номенклатура' => array(
            array('Ref_Key' => $g(10), 'DataVersion' => 'B1', 'DeletionMark' => false, 'IsFolder' => true, 'Parent_Key' => $E, 'Description' => 'ТЕСТ1С Товары', 'Артикул' => '', 'ЕдиницаИзмерения_Key' => $E),
            array('Ref_Key' => $g(11), 'DataVersion' => 'B1', 'DeletionMark' => false, 'IsFolder' => false, 'Parent_Key' => $g(10), 'Description' => 'ТЕСТ1С Мяч', 'Артикул' => 'M-1', 'ЕдиницаИзмерения_Key' => $g(901)),
            array('Ref_Key' => $g(12), 'DataVersion' => 'B1', 'DeletionMark' => false, 'IsFolder' => false, 'Parent_Key' => $g(10), 'Description' => 'ТЕСТ1С Сетка', 'Артикул' => 'S-2', 'ЕдиницаИзмерения_Key' => $g(902)),
        ),
        'Document_РеализацияТоваровУслуг' => array(
            array('Ref_Key' => $g(101), 'DataVersion' => 'D1', 'DeletionMark' => false, 'Number' => 'ТЕСТ1С-0001', 'Date' => '2026-09-01T10:00:00', 'Posted' => true,
                'Контрагент_Key' => $g(1), 'СуммаДокумента' => 1500.5, 'ДатаОплаты' => '0001-01-01T00:00:00',
                'Товары' => array(
                    array('LineNumber' => '1', 'Номенклатура_Key' => $g(11), 'Количество' => 2, 'Цена' => 500, 'Сумма' => 1000),
                    array('LineNumber' => '2', 'Номенклатура_Key' => $g(12), 'Количество' => 1, 'Цена' => 500.5, 'Сумма' => 500.5),
                )),
            array('Ref_Key' => $g(102), 'DataVersion' => 'D1', 'DeletionMark' => false, 'Number' => 'ТЕСТ1С-0002', 'Date' => '2026-09-02T11:30:00', 'Posted' => false,
                'Контрагент_Key' => $g(2), 'СуммаДокумента' => 300, 'ДатаОплаты' => '2026-09-10T12:00:00',
                'Товары' => array(array('LineNumber' => '1', 'Номенклатура_Key' => $g(11), 'Количество' => 1, 'Цена' => 300, 'Сумма' => 300))),
            array('Ref_Key' => $g(103), 'DataVersion' => 'D1', 'DeletionMark' => false, 'Number' => 'ТЕСТ1С-0003', 'Date' => '2025-12-15T09:00:00', 'Posted' => true,
                'Контрагент_Key' => $g(1), 'СуммаДокумента' => 1, 'ДатаОплаты' => '0001-01-01T00:00:00',
                'Товары' => array(array('LineNumber' => '1', 'Номенклатура_Key' => $g(12), 'Количество' => 1, 'Цена' => 1, 'Сумма' => 1))),
            array('Ref_Key' => $g(104), 'DataVersion' => 'D1', 'DeletionMark' => true, 'Number' => 'ТЕСТ1С-0004', 'Date' => '2026-09-03T09:00:00', 'Posted' => false,
                'Контрагент_Key' => $g(2), 'СуммаДокумента' => 5, 'ДатаОплаты' => '0001-01-01T00:00:00',
                'Товары' => array(array('LineNumber' => '1', 'Номенклатура_Key' => $g(12), 'Количество' => 5, 'Цена' => 1, 'Сумма' => 5))),
        ),
    );

    $cfg = array(
        'version' => 1, 'project' => 'test-1c',
        'sources' => array('1c' => array('type' => 'odata1c', 'transport' => 'mock', 'fixtures_dir' => 'tests/tmp1c/fixtures', 'timezone' => 'Europe/Moscow', 'page_size' => 2)),
        'target' => array('type' => 'integram', 'base_url' => 'https://ideav.ru', 'db' => 'spz', 'token' => '${INTEGRAM_TOKEN}', 'max_file_bytes' => 7000000, 'max_rows_per_file' => 5000),
        'runtime' => array('timezone' => 'Europe/Moscow', 'state_dir' => 'tests/tmp1c/state', 'log_dir' => 'tests/tmp1c/logs', 'lock_file' => 'tests/tmp1c/state/run.lock'),
        'safety' => array('on_schema_drift' => 'stop', 'never_send_empty_name' => true, 'require_key' => true, 'verify_counts' => true, 'max_new_ratio_on_full_load' => 0.2, 'advance_state_only_after_upload' => true),
        'dictionaries' => array('units' => array('connection' => '1c', 'source' => 'odata.entity', 'entity' => 'Catalog_ЕдиницыИзмерения', 'code' => 'Ref_Key', 'name' => 'Description')),
        'order' => array('contractors', 'products', 'sales', 'sale_items'),
        'entities' => array(
            'contractors' => array(
                'source' => array('connection' => '1c', 'entity' => 'Catalog_Контрагенты'),
                'load' => array('mode' => 'full', 'detect_changes' => array('field' => 'DataVersion')),
                'target' => array('table' => 'ТЕСТ1С Контрагент', 'table_id' => $T['ctr'], 'key' => 'GUID 1С', 'mode' => 'upsert', 'bind_existing' => array('by' => '@name')),
                'fields' => array(
                    'Ref_Key' => array('column' => 'GUID 1С'),
                    'Description' => array('column' => '@name'),
                    'ИНН' => array('column' => 'ИНН'),
                    'DeletionMark' => array('column' => 'Помечен на удаление', 'transform' => 'yn'),
                )),
            'products' => array(
                'source' => array('connection' => '1c', 'entity' => 'Catalog_Номенклатура'),
                'load' => array('mode' => 'full', 'detect_changes' => array('field' => 'DataVersion')),
                'target' => array('table' => 'ТЕСТ1С Номенклатура', 'table_id' => $T['prod'], 'key' => 'GUID 1С', 'mode' => 'upsert'),
                'hierarchy' => array('parent_field' => 'Parent_Key'),
                'fields' => array(
                    'Ref_Key' => array('column' => 'GUID 1С'),
                    'Description' => array('column' => '@name'),
                    'Артикул' => array('column' => 'Артикул'),
                    'ЕдиницаИзмерения_Key' => array('column' => 'Единица', 'transform' => 'dict:units'),
                    'Parent_Key' => array('column' => 'Родитель', 'ref' => array('entity' => 'products', 'by' => 'key', 'missing' => 'skip')),
                )),
            'sales' => array(
                'source' => array('connection' => '1c', 'entity' => 'Document_РеализацияТоваровУслуг', 'filter' => 'DeletionMark eq false'),
                'load' => array('mode' => 'full', 'period' => array('field' => 'Date', 'from' => '2026-01-01', 'to' => null), 'detect_changes' => array('field' => 'DataVersion')),
                'target' => array('table' => 'ТЕСТ1С Реализация', 'table_id' => $T['sale'], 'key' => 'GUID 1С', 'mode' => 'upsert'),
                'fields' => array(
                    'Ref_Key' => array('column' => 'GUID 1С'),
                    'Number' => array('column' => '@name'),
                    'Date' => array('column' => 'Дата', 'transform' => 'datetime'),
                    'ДатаОплаты' => array('column' => 'Дата оплаты', 'transform' => 'datetime'),
                    'Контрагент_Key' => array('column' => 'Контрагент', 'ref' => array('entity' => 'contractors', 'by' => 'key', 'missing' => 'skip')),
                    'СуммаДокумента' => array('column' => 'Сумма', 'transform' => 'money'),
                    'Posted' => array('column' => 'Проведён', 'transform' => 'yn'),
                )),
            'sale_items' => array(
                'source' => array('from_entity' => 'sales', 'collection' => 'Товары'),
                'load' => array('mode' => 'full'),
                'target' => array('table' => 'ТЕСТ1С Строка реализации', 'table_id' => $T['item'], 'mode' => 'replace_children', 'parent' => array('entity' => 'sales')),
                'fields' => array(
                    'LineNumber' => array('column' => '@name', 'transform' => 'number'),
                    'Номенклатура_Key' => array('column' => 'Номенклатура', 'ref' => array('entity' => 'products', 'by' => 'key', 'missing' => 'skip')),
                    'Количество' => array('column' => 'Количество', 'transform' => 'money'),
                    'Цена' => array('column' => 'Цена', 'transform' => 'money'),
                    'Сумма' => array('column' => 'Сумма', 'transform' => 'money'),
                )),
        ),
    );
    mkdir("$tmp/fixtures", 0775, true);
    file_put_contents("$tmp/config.json", json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    writeFixtures("$tmp/fixtures", $fx);

    // ======================================================== запуск 1
    echo "\nЗапуск 1: первая загрузка\n";
    list($code, $rep) = runConnector(array('allow_mass_create' => true));
    check('код выхода 0 и нет ошибок', $code === 0 && !$rep['errors'], json_encode($rep['errors'], JSON_UNESCAPED_UNICODE));

    $ctr = table($ig, $T['ctr']);
    list($c1) = one($ctr, 'GUID 1С', $g(1));
    list($c2) = one($ctr, 'GUID 1С', $g(2));
    check('контрагенты по GUID, без дублей', $c1 && $c2 && count($ctr['rows']) === 2);
    check('старый контрагент привязан по названию', $c1 === $legacy);
    check('ИНН и пометка удаления', val($ctr, $ctr['rows'][$c2], 'ИНН') === '500100000002' && val($ctr, $ctr['rows'][$c2], 'Помечен на удаление') === 'N');

    $prod = table($ig, $T['prod']);
    list($p10) = one($prod, 'GUID 1С', $g(10));
    list($p11) = one($prod, 'GUID 1С', $g(11));
    list($p12) = one($prod, 'GUID 1С', $g(12));
    check('номенклатура: 3 записи', $p10 && $p11 && $p12);
    check('иерархия: родитель по GUID', TableSchema::refIds(val($prod, $prod['rows'][$p11], 'Родитель')) === array($p10)
        && TableSchema::refIds(val($prod, $prod['rows'][$p12], 'Родитель')) === array($p10));
    check('пустая ссылка (нулевой GUID) — поле пустое', val($prod, $prod['rows'][$p10], 'Родитель') === '' && val($prod, $prod['rows'][$p10], 'Единица') === '');
    check('справочник из сущности 1С: единица измерения', val($prod, $prod['rows'][$p11], 'Единица') === 'шт' && val($prod, $prod['rows'][$p12], 'Единица') === 'кг');

    $sale = table($ig, $T['sale']);
    list($d1, $d1row) = one($sale, 'GUID 1С', $g(101));
    list($d2, $d2row) = one($sale, 'GUID 1С', $g(102));
    check('документы: период и пометка удаления отфильтрованы', $d1 && $d2 && count($sale['rows']) === 2);
    check('дата 1С без пояса записана с поясом подключения', (int)val($sale, $d1row, 'Дата') === strtotime('2026-09-01T10:00:00+03:00'));
    check('пустая дата 1С (0001-01-01) — поле пустое', val($sale, $d1row, 'Дата оплаты') === '', val($sale, $d1row, 'Дата оплаты'));
    check('непустая дата оплаты', (int)val($sale, $d2row, 'Дата оплаты') === strtotime('2026-09-10T12:00:00+03:00'));
    check('документ → контрагент по GUID', TableSchema::refIds(val($sale, $d1row, 'Контрагент')) === array($c1));
    check('сумма и проведён', (float)val($sale, $d1row, 'Сумма') === 1500.5 && val($sale, $d1row, 'Проведён') === 'Y' && val($sale, $d2row, 'Проведён') === 'N');

    $itemSchema = TableSchema::fromMetadata($ig->metadata($T['item']));
    $iv = function (array $row, $col) use ($itemSchema) { return (string)$row[$itemSchema->column($col)['pos']]; };
    $k1 = $ig->readChildren($T['item'], $d1);
    $k2 = $ig->readChildren($T['item'], $d2);
    $byLine = array();
    foreach ($k1 as $id => $r) $byLine[(string)$r[0]] = $r;
    check('табличная часть: 2 строки у первого, 1 у второго', count($k1) === 2 && count($k2) === 1);
    check('строки: номенклатура по GUID', isset($byLine['1'], $byLine['2']) && TableSchema::refIds($iv($byLine['1'], 'Номенклатура')) === array($p11)
        && TableSchema::refIds($iv($byLine['2'], 'Номенклатура')) === array($p12));
    check('строки: количество, цена, сумма', (float)$iv($byLine['2'], 'Цена') === 500.5 && (float)$iv($byLine['1'], 'Количество') === 2.0 && (float)$iv($byLine['1'], 'Сумма') === 1000.0);
    $k2ids = array_keys($k2);

    // ======================================================== запуск 2: без изменений
    echo "\nЗапуск 2: повтор без изменений\n";
    list($code, $rep) = runConnector();
    check('код выхода 0', $code === 0, json_encode($rep['errors'], JSON_UNESCAPED_UNICODE));
    $e = $rep['entities'];
    check('ничего не отправлено: все записи «без изменений»', $e['contractors']['rows'] === 0 && $e['products']['rows'] === 0 && $e['sales']['rows'] === 0
        && $e['contractors']['unchanged'] === 2 && $e['products']['unchanged'] === 3 && $e['sales']['unchanged'] === 2);
    check('табличные части не перезаписывались', $e['sale_items']['rows'] === 0 && array_keys($ig->readChildren($T['item'], $d1)) === array_keys($k1));

    // ======================================================== изменения
    $fx['Catalog_Контрагенты'][1]['Description'] = 'ТЕСТ1С ИП Иванов (переименован)';
    $fx['Catalog_Контрагенты'][1]['DataVersion'] = 'AAAA2';
    $fx['Document_РеализацияТоваровУслуг'][0]['DataVersion'] = 'D2';
    $fx['Document_РеализацияТоваровУслуг'][0]['Контрагент_Key'] = $g(2);
    $fx['Document_РеализацияТоваровУслуг'][0]['Товары'][1]['Количество'] = 3;
    $fx['Document_РеализацияТоваровУслуг'][0]['Товары'][] = array('LineNumber' => '3', 'Номенклатура_Key' => $g(11), 'Количество' => 5, 'Цена' => 10, 'Сумма' => 50);
    writeFixtures("$tmp/fixtures", $fx);

    echo "\nПробный запуск с изменениями\n";
    $versionsBefore = file_get_contents("$tmp/state/sales.versions.json");
    list($code, $rep) = runConnector(array('dry_run' => true));
    check('пробный запуск: код 0, в Интеграме без изменений', $code === 0 && count($ig->readChildren($T['item'], $d1)) === 2
        && one(table($ig, $T['ctr']), '@name', 'ТЕСТ1С ИП Иванов (переименован)')[0] === null);
    check('пробный запуск: версии не сохранены', file_get_contents("$tmp/state/sales.versions.json") === $versionsBefore);

    echo "\nЗапуск 3: изменения в 1С\n";
    list($code, $rep) = runConnector();
    check('код выхода 0', $code === 0, json_encode($rep['errors'], JSON_UNESCAPED_UNICODE));
    $e = $rep['entities'];
    check('отправлены только изменённые', $e['contractors']['rows'] === 1 && $e['contractors']['unchanged'] === 1
        && $e['sales']['rows'] === 1 && $e['sales']['unchanged'] === 1 && $e['products']['rows'] === 0 && $e['sale_items']['parents'] === 1);
    $ctr = table($ig, $T['ctr']);
    $sameGuid = array();
    foreach (findBy($ctr, 'GUID 1С', $g(2)) as $id => $r) $sameGuid[] = "$id «{$r[0]}»";
    check('переименование контрагента: та же запись', one($ctr, 'GUID 1С', $g(2))[0] === $c2 && $ctr['rows'][$c2][0] === 'ТЕСТ1С ИП Иванов (переименован)',
        "ожидалась запись $c2, с этим GUID: " . implode(', ', $sameGuid));
    $sale = table($ig, $T['sale']);
    check('документ: контрагент заменён', TableSchema::refIds(val($sale, $sale['rows'][$d1], 'Контрагент')) === array($c2));
    $k1 = $ig->readChildren($T['item'], $d1);
    $byLine = array();
    foreach ($k1 as $id => $r) $byLine[(string)$r[0]] = $r;
    check('строки изменённого документа заменены: 3 строки, новое количество', count($k1) === 3 && (float)$iv($byLine['2'], 'Количество') === 3.0
        && TableSchema::refIds($iv($byLine['3'], 'Номенклатура')) === array($p11));
    check('строки неизменённого документа не тронуты', array_keys($ig->readChildren($T['item'], $d2)) === $k2ids);
    $exit = 0;
} catch (Exception $ex) {
    check('тест завершился без исключения', false, get_class($ex) . ': ' . $ex->getMessage());
} finally {
    echo "\nУборка\n";
    $errors = dropTestTables($ig, $madeTypes);
    $rest = array();
    foreach ($ig->get('metadata?JSON=1') as $t) if (strpos($t['val'], 'ТЕСТ1С') === 0) $rest[] = $t['val'];
    check('временные таблицы, колонки и типы удалены', !$errors && !$rest, implode('; ', array_merge($errors, $rest)));
    exit(summary());
}
