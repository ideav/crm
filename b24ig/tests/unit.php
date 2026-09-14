<?php
/** Модульные тесты без сети: php tests/unit.php */
require __DIR__ . '/../b24ig.php';
require_once __DIR__ . '/MockBitrix.php';
date_default_timezone_set('Europe/Moscow');

$total = 0;
$failed = 0;
function eq($name, $actual, $expected)
{
    global $total, $failed;
    $total++;
    if ($actual !== $expected) {
        $failed++;
        echo "FAIL $name\n   получено: " . var_export($actual, true) . "\n   ожидалось: " . var_export($expected, true) . "\n";
    }
}
function throws($name, $fn, $needle)
{
    try {
        $fn();
        eq("$name (нет исключения)", false, true);
    } catch (Exception $e) {
        eq("$name → " . $e->getMessage(), strpos($e->getMessage(), $needle) !== false, true);
    }
}

// --- Bki
eq('escape ;', Bki::escape('a;b'), 'a\\;b');
eq('escape \\', Bki::escape('a\\b'), 'a\\\\b');
eq('escape \\;', Bki::escape('a\\;b'), 'a\\\\\\;b');
eq('escape переносы', Bki::escape("x\r\ny\tz\n"), 'x y z ');
eq('row с завершающим ;', Bki::row(array('1', 'a;b', '')), "1;a\\;b;;\n");
$ch = new BkiChunker(2, 100000);
$ch->add("1;\n");
eq('chunker не переполнен', $ch->wouldOverflow(1, 3), false);
$ch->add("2;\n");
eq('chunker переполнен по строкам', $ch->wouldOverflow(1, 3), true);
eq('chunker take', $ch->take(), "DATA\n1;\n2;\n");
eq('chunker пуст после take', $ch->isEmpty(), true);
$ch = new BkiChunker(100, 1024);
$ch->add(str_repeat('x', 1000) . ";\n");
eq('chunker переполнен по байтам', $ch->wouldOverflow(1, 100), true);

// --- утилиты
eq('upper_snake camel', upper_snake('responsibleId'), 'RESPONSIBLE_ID');
eq('upper_snake id', upper_snake('id'), 'ID');
eq('upper_snake уже UPPER', upper_snake('PARENT_ID'), 'PARENT_ID');
eq('upper_snake длинный', upper_snake('allowChangeDeadline'), 'ALLOW_CHANGE_DEADLINE');
eq('norm_name', norm_name("  Отдел   Ёлок ", array('trim', 'lower', 'yo')), 'отдел елок');
eq('arr_get', arr_get(array('a' => array('b' => 1)), 'a.b'), 1);
eq('arr_get default', arr_get(array(), 'a.b', 'x'), 'x');

// --- Transform
$ctxStub = new stdClass();
$ctxStub->root = __DIR__;
$tr = new Transform(new Dictionaries(array('task_status' => array('source' => 'static', 'map' => array('5' => 'Завершена', '7' => 'Отклонена'))), $ctxStub));
$rec = array('N' => '0012', 'M' => '1 500,5', 'B' => true, 'F' => false, 'YN' => 'n', 'ARR' => array(1, '2', ''),
    'PHONE' => array(array('VALUE' => '+7 1', 'VALUE_TYPE' => 'WORK'), array('VALUE' => '+7 2')),
    'ST' => '5', 'STX' => '9', 'LAST_NAME' => 'Иванов', 'NAME' => 'Иван', 'SECOND_NAME' => '', 'TXT' => "a\n  b ", 'DT' => '2026-05-12T10:17:25+03:00');
eq('number', $tr->apply(array('transform' => 'number'), 'N', $rec), '0012');
eq('number пусто', $tr->apply(array('transform' => 'number'), 'NONE', $rec), '');
eq('money', $tr->apply(array('transform' => 'money'), 'M', $rec), '1500.5');
eq('yn bool true', $tr->apply(array('transform' => 'yn'), 'B', $rec), 'Y');
eq('yn bool false', $tr->apply(array('transform' => 'yn'), 'F', $rec), 'N');
eq('yn строка', $tr->apply(array('transform' => 'yn'), 'YN', $rec), 'N');
eq('join', $tr->apply(array('transform' => 'join'), 'ARR', $rec), '1,2');
eq('multifield', $tr->apply(array('transform' => 'multifield'), 'PHONE', $rec), '+7 1, +7 2');
eq('dict', $tr->apply(array('transform' => 'dict:task_status'), 'ST', $rec), 'Завершена');
eq('dict неизвестный код', $tr->apply(array('transform' => 'dict:task_status'), 'STX', $rec), '9');
eq('dict учёт неизвестных', isset($tr->unknown['task_status']['9']), true);
eq('template', $tr->apply(array('transform' => 'template', 'template' => '{LAST_NAME} {NAME} {SECOND_NAME}'), 'FIO', $rec), 'Иванов Иван');
eq('строка чистится', $tr->apply(array(), 'TXT', $rec), 'a b');
eq('datetime как есть', $tr->apply(array('transform' => 'datetime'), 'DT', $rec), '2026-05-12T10:17:25+03:00');
eq('from', $tr->apply(array('from' => 'NAME'), 'X@y', $rec), 'Иван');

// --- TableSchema (снимки metadata из spz)
$dep = TableSchema::fromMetadata(json_decode(file_get_contents(__DIR__ . '/fixtures/metadata/2859.json'), true));
eq('dep width', $dep->width, 6);
eq('dep ключ', $dep->column('ID Битрикс')['key'], true);
eq('dep позиция ключа', $dep->column('ID Битрикс')['pos'], 3);
eq('dep ссылка на себя', $dep->column('Родительский')['ref'], 2859);
eq('dep @name', $dep->column('@name')['pos'], 0);
eq('dep не уникальна', $dep->unique, false);
$pb = TableSchema::fromMetadata(json_decode(file_get_contents(__DIR__ . '/fixtures/metadata/969767.json'), true));
eq('pb multi', $pb->column('Департамент')['multi'], true);
eq('pb Табельный ссылка', $pb->column('Табельный')['ref'], 2946);
$lead = TableSchema::fromMetadata(json_decode(file_get_contents(__DIR__ . '/fixtures/metadata/482971.json'), true));
eq('lead width', $lead->width, 40);
eq('lead уникальна', $lead->unique, true);
eq('lead псевдоним', $lead->column('Создал (ID)') !== null, true);
eq('refIds multi', TableSchema::refIds('2862,2863:HR,IT'), array(2862, 2863));
eq('refIds пусто', TableSchema::refIds(''), array());
eq('refIds не ссылка', TableSchema::refIds('58802'), array());

// --- адаптер Битрикс24 на MockBitrix
$tmp = sys_get_temp_dir() . '/b24ig-unit-' . getmypid();
@mkdir($tmp);
$leads = array();
for ($i = 1; $i <= 120; $i++) {
    $leads[] = array('ID' => (string)$i, 'DATE_CREATE' => '2026-02-01T10:00:00+03:00',
        'DATE_MODIFY' => ($i > 110 ? '2026-09-01T10:00:00+03:00' : '2026-02-01T10:00:00+03:00'));
}
file_put_contents("$tmp/leads.json", json_encode($leads));
$users = array();
for ($i = 1; $i <= 120; $i++) $users[] = array('ID' => (string)$i, 'ACTIVE' => $i % 3 !== 0);
file_put_contents("$tmp/users.json", json_encode($users));
file_put_contents("$tmp/tasks.json", json_encode(array(array('ID' => '7', 'RESPONSIBLE_ID' => '5', 'CREATED_DATE' => '2026-03-01T00:00:00+03:00'))));
file_put_contents("$tmp/statuses.json", json_encode(array(
    array('ENTITY_ID' => 'DEAL_STAGE_1', 'STATUS_ID' => 'C1:WON', 'NAME' => 'Успех'),
    array('ENTITY_ID' => 'SOURCE', 'STATUS_ID' => 'CALL', 'NAME' => 'Звонок'),
)));
file_put_contents("$tmp/lead_direction.json", json_encode(array(array('ID' => '4800', 'VALUE' => 'Онлайн-школа'))));

$src = new Bitrix24Source('test', new MockBitrix($tmp));
eq('адаптер реализует интерфейс', $src instanceof SourceAdapter, true);
eq('адаптер: имя подключения', $src->name(), 'test');
eq('условия → фильтр Битрикса', Bitrix24Source::filter(array(
    'period' => array('field' => 'DATE_CREATE', 'from' => '2026-01-01', 'to' => '2026-12-31'),
    'modified_gt' => array('field' => 'DATE_MODIFY', 'since' => '2026-09-01T00:00:00+03:00'),
    'id_lte' => 500, 'id_gt' => 10,
)), array('>=DATE_CREATE' => '2026-01-01T00:00:00', '<=DATE_CREATE' => '2026-12-31T23:59:59', '>DATE_MODIFY' => '2026-09-01T00:00:00+03:00', '<=ID' => 500));
eq('пустые условия → пустой фильтр', Bitrix24Source::filter(array('period' => null, 'id_gt' => 0)), array());

$pages = array();
$count = 0;
$src->each(array('method' => 'crm.lead.list', 'pagination' => 'id_cursor'),
    array('period' => array('field' => 'DATE_CREATE', 'from' => '2026-01-01', 'to' => null)), array('ID'),
    function ($items, $max) use (&$pages, &$count) {
        $pages[] = $max;
        $count += count($items);
    });
eq('id_cursor страницы', $pages, array(50, 100, 120));
eq('id_cursor всего', $count, 120);
$count = 0;
$src->each(array('method' => 'crm.lead.list', 'pagination' => 'id_cursor'), array('id_gt' => 100), array(), function ($items) use (&$count) { $count += count($items); });
eq('id_cursor с курсора', $count, 20);
$count = 0;
$src->each(array('method' => 'crm.lead.list', 'pagination' => 'id_cursor'),
    array('modified_gt' => array('field' => 'DATE_MODIFY', 'since' => '2026-08-01T00:00:00+03:00'), 'id_lte' => 115), array(),
    function ($items) use (&$count) { $count += count($items); });
eq('фаза изменённых', $count, 5);
$ids = array();
$src->each(array('method' => 'user.get', 'pagination' => 'start', 'filters' => array(array('ACTIVE' => true), array('ACTIVE' => false))), array(), array(),
    function ($items) use (&$ids) { foreach ($items as $it) $ids[] = $it['ID']; });
eq('start: все пользователи без дублей', count(array_unique($ids)) === 120 && count($ids) === 120, true);
$task = null;
$src->each(array('method' => 'tasks.task.list', 'pagination' => 'id_cursor', 'result_path' => 'result.tasks', 'response_keys' => 'camelCase'), array(), array(),
    function ($items) use (&$task) { $task = $items[0]; });
eq('camelCase → UPPER_SNAKE', isset($task['RESPONSIBLE_ID']) ? $task['RESPONSIBLE_ID'] : null, '5');
eq('describeFields crm', in_array('DATE_MODIFY', $src->describeFields(array('method' => 'crm.lead.list')), true), true);
eq('describeFields задачи', in_array('RESPONSIBLE_ID', $src->describeFields(array('method' => 'tasks.task.list')), true), true);
eq('describeFields user.get не поддерживается', $src->describeFields(array('method' => 'user.get')), null);
eq('справочник crm.status.list', $src->dictionary(array('source' => 'crm.status.list', 'entity_prefix' => 'DEAL_STAGE', 'code' => 'STATUS_ID', 'name' => 'NAME')), array('C1:WON' => 'Успех'));
eq('справочник списочного поля', $src->dictionary(array('source' => 'crm.lead.fields', 'field' => 'UF_CRM_1648027063964', 'items' => 'items', 'code' => 'ID', 'name' => 'VALUE')), array('4800' => 'Онлайн-школа'));
throws('неизвестный тип справочника', function () use ($src) { $src->dictionary(array('source' => 'odata.enum')); }, 'не поддерживает');

// --- конфиг: несколько подключений
$legacyFile = "$tmp/legacy.json";
file_put_contents($legacyFile, json_encode(array('project' => 'p', 'source' => array('type' => 'bitrix24', 'webhook' => 'x'),
    'target' => array('base_url' => 'https://example.test', 'db' => 'd', 'token' => 't'), 'order' => array('a'), 'entities' => array('a' => array()))));
$legacy = Runner::loadConfig($legacyFile);
eq('старый формат source → sources.default', isset($legacy['sources']['default']) && !isset($legacy['source']), true);

$cfg2 = array('project' => 'p', 'target' => array('base_url' => 'https://example.test', 'db' => 'd', 'token' => 't'),
    'runtime' => array('state_dir' => "$tmp/state"),
    'sources' => array(
        'b24' => array('type' => 'bitrix24', 'transport' => 'mock', 'fixtures_dir' => $tmp),
        'b24copy' => array('type' => 'bitrix24', 'transport' => 'mock', 'fixtures_dir' => $tmp),
    ),
    'order' => array('with', 'without', 'derived'),
    'entities' => array(
        'with' => array('source' => array('connection' => 'b24copy', 'method' => 'crm.lead.list')),
        'without' => array('source' => array('method' => 'crm.lead.list')),
        'derived' => array('source' => array('from_entity' => 'with')),
    ));
$ctx = new Context($cfg2, dirname(__DIR__), array());
eq('сущность берёт своё подключение', $ctx->sourceFor('with')->name(), 'b24copy');
eq('from_entity берёт подключение исходной сущности', $ctx->sourceFor('derived')->name(), 'b24copy');
throws('без connection при нескольких подключениях', function () use ($ctx) { $ctx->sourceFor('without'); }, 'укажите connection');
throws('неизвестное подключение', function () use ($ctx) { $ctx->source('1c'); }, 'не описано');
throws('неизвестный тип источника', function () use ($tmp) { Sources::create('x', array('type' => 'sap'), $tmp); }, 'неизвестный тип');
$cfg2['sources'] = array('only' => $cfg2['sources']['b24']);
$ctx = new Context($cfg2, dirname(__DIR__), array());
eq('единственное подключение подставляется само', $ctx->sourceFor('without')->name(), 'only');

// --- адаптер 1С (OData) на MockOData
require_once __DIR__ . '/MockOData.php';
$od = sys_get_temp_dir() . '/b24ig-unit-1c-' . getmypid();
@mkdir($od);
file_put_contents("$od/metadata.xml", '<?xml version="1.0" encoding="UTF-8"?><edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" Version="1.0"><edmx:DataServices><Schema xmlns="http://schemas.microsoft.com/ado/2009/11/edm" Namespace="StandardODATA">'
    . '<EntityType Name="Catalog_Контрагенты"><Key><PropertyRef Name="Ref_Key"/></Key><Property Name="Ref_Key" Type="Edm.Guid"/><Property Name="DataVersion" Type="Edm.String"/><Property Name="Description" Type="Edm.String"/><Property Name="Parent_Key" Type="Edm.Guid"/><Property Name="DeletionMark" Type="Edm.Boolean"/></EntityType>'
    . '<EntityType Name="Document_Реализация"><Property Name="Ref_Key" Type="Edm.Guid"/><Property Name="Date" Type="Edm.DateTime"/><Property Name="ДатаОплаты" Type="Edm.DateTime"/><Property Name="Товары" Type="Collection(StandardODATA.Document_Реализация_Товары_RowType)"/></EntityType>'
    . '<ComplexType Name="Document_Реализация_Товары_RowType"><Property Name="LineNumber" Type="Edm.Int64"/><Property Name="Номенклатура_Key" Type="Edm.Guid"/></ComplexType>'
    . '</Schema></edmx:DataServices></edmx:Edmx>');
$g = function ($n) { return sprintf('aaaaaaaa-0000-0000-0000-%012d', $n); };
$ctr = array();
for ($i = 1; $i <= 5; $i++) $ctr[] = array('Ref_Key' => $g($i), 'DataVersion' => "v$i", 'Description' => "К$i", 'Parent_Key' => OneCSource::EMPTY_GUID, 'DeletionMark' => $i === 5);
file_put_contents("$od/Catalog_Контрагенты.json", json_encode($ctr, JSON_UNESCAPED_UNICODE));
file_put_contents("$od/Document_Реализация.json", json_encode(array(
    array('Ref_Key' => $g(11), 'Date' => '2026-09-01T10:00:00', 'ДатаОплаты' => '0001-01-01T00:00:00', 'Товары' => array(array('LineNumber' => '1', 'Номенклатура_Key' => OneCSource::EMPTY_GUID))),
    array('Ref_Key' => $g(12), 'Date' => '2025-12-31T23:00:00', 'ДатаОплаты' => '2026-01-10T12:00:00', 'Товары' => array()),
), JSON_UNESCAPED_UNICODE));
$mock = new MockOData($od);
$one = new OneCSource('1c', $mock, array('timezone' => 'Europe/Moscow', 'page_size' => 2));
eq('1С: реализует интерфейс', $one instanceof SourceAdapter, true);
eq('1С: $filter из периода и фильтра источника', $one->filter(array('filter' => 'DeletionMark eq false'), array('period' => array('field' => 'Date', 'from' => '2026-01-01', 'to' => '2026-12-31'))),
    "(DeletionMark eq false) and Date ge datetime'2026-01-01T00:00:00' and Date le datetime'2026-12-31T23:59:59'");
throws('1С: курсор ID не поддерживается', function () use ($one) { $one->filter(array(), array('id_gt' => 5)); }, 'не поддерживается');
$calls = 0;
$got = array();
$one->each(array('entity' => 'Catalog_Контрагенты', 'filter' => 'DeletionMark eq false'), array(), array('Ref_Key', 'Description', 'НетТакогоПоля'),
    function ($items) use (&$calls, &$got) { $calls++; foreach ($items as $it) $got[] = $it; });
eq('1С: постранично $top/$skip (4 записи по 2)', $calls, 2);
eq('1С: фильтр DeletionMark', count($got), 4);
eq('1С: $select только из существующих полей', array_keys($got[0]), array('Ref_Key', 'Description'));
eq('1С: $skip второй страницы', $mock->requests[1][1]['$skip'], 2);
eq('1С: сортировка по Ref_Key', $mock->requests[0][1]['$orderby'], 'Ref_Key');
$docs = array();
$one->each(array('entity' => 'Document_Реализация'), array('period' => array('field' => 'Date', 'from' => '2026-01-01', 'to' => null)), array('Ref_Key', 'Date', 'ДатаОплаты', 'Товары'),
    function ($items) use (&$docs) { foreach ($items as $it) $docs[] = $it; });
eq('1С: период отсекает документ 2025 года', count($docs), 1);
eq('1С: дата без пояса → с поясом подключения', $docs[0]['Date'], '2026-09-01T10:00:00+03:00');
eq('1С: пустая дата 0001-01-01 → null', $docs[0]['ДатаОплаты'], null);
eq('1С: нулевой GUID в строке табличной части → null', $docs[0]['Товары'][0]['Номенклатура_Key'], null);
eq('1С: describeFields из $metadata', $one->describeFields(array('entity' => 'Catalog_Контрагенты')), array('Ref_Key', 'DataVersion', 'Description', 'Parent_Key', 'DeletionMark'));
eq('1С: ComplexType табличной части разобран', $one->describeFields(array('entity' => 'Document_Реализация_Товары_RowType')), array('LineNumber', 'Номенклатура_Key'));
throws('1С: неизвестная сущность', function () use ($one) { $one->describeFields(array('entity' => 'Catalog_Нет')); }, 'нет сущности');
eq('1С: справочник odata.entity', $one->dictionary(array('source' => 'odata.entity', 'entity' => 'Catalog_Контрагенты')),
    array($g(1) => 'К1', $g(2) => 'К2', $g(3) => 'К3', $g(4) => 'К4', $g(5) => 'К5'));
eq('OData: путь с кириллицей и $-параметрами', ODataClient::path('Catalog_Контрагенты', array('$top' => 2, '$filter' => "Date ge datetime'2026-01-01T00:00:00'")),
    rawurlencode('Catalog_Контрагенты') . '?$top=2&$filter=' . rawurlencode("Date ge datetime'2026-01-01T00:00:00'"));
eq('фабрика: odata1c', Sources::create('x', array('type' => 'odata1c', 'transport' => 'mock', 'fixtures_dir' => $od), dirname(__DIR__)) instanceof OneCSource, true);
$sf = EntitySync::sourceFields(array('load' => array('detect_changes' => array('field' => 'DataVersion')), 'fields' => array('Ref_Key' => array('column' => 'GUID'))));
eq('sourceFields: поле версии запрашивается у источника', $sf, array('DataVersion' => false, 'Ref_Key' => false));
exec('rm -rf ' . escapeshellarg($od));

// --- поля источника из конфига
$cfg = json_decode(file_get_contents(__DIR__ . '/../config/sportzania-spz.json'), true);
$sf = EntitySync::sourceFields($cfg['entities']['leads']);
eq('sourceFields LINK необязательное', $sf['LINK'], true);
eq('sourceFields ID обязательное', $sf['ID'], false);
$sf = EntitySync::sourceFields($cfg['entities']['tabel']);
eq('sourceFields шаблон', isset($sf['SECOND_NAME']), true);
eq('конфиг проекта на sources', isset($cfg['sources']['b24']) && !isset($cfg['source']), true);

exec('rm -rf ' . escapeshellarg($tmp));
// --- запуск для базы на сервере Интеграма: пути, секреты, очистка логов
$site = sys_get_temp_dir() . '/b24ig-site-' . getmypid();
$p = Runner::dbPaths($site, 'spz', 'sportzania-spz');
eq('dbPaths: конфиг базы', $p['config'], "$site/templates/custom/spz/connector/sportzania-spz.json");
eq('dbPaths: папка данных базы', $p['data_root'], "$site/templates/custom/spz/connector");
eq('dbPaths: secrets.json', $p['secrets'], "$site/templates/custom/spz/connector/secrets.json");
throws('dbPaths: обход каталога в имени базы', function () use ($site) { Runner::dbPaths($site, '../spz', 'x'); }, 'имя базы');
throws('dbPaths: слэш в имени конфига', function () use ($site) { Runner::dbPaths($site, 'spz', 'a/b'); }, 'имя конфига');
throws('dbPaths: расширение в имени конфига', function () use ($site) { Runner::dbPaths($site, 'spz', 'x.json'); }, 'имя конфига');
@mkdir($site, 0775, true);
file_put_contents("$site/c.json", json_encode(array('project' => 'p', 'sources' => array('b' => array('type' => 'bitrix24', 'webhook' => '${B24IG_UNIT_WEBHOOK}')),
    'target' => array('base_url' => 'x', 'db' => 'spz', 'token' => '${B24IG_UNIT_TOKEN}'), 'order' => array('a'), 'entities' => array('a' => array()))));
putenv('B24IG_UNIT_TOKEN=из-окружения');
$c = Runner::loadConfig("$site/c.json", array('B24IG_UNIT_TOKEN' => 'из-файла', 'B24IG_UNIT_WEBHOOK' => 'https://hook'));
eq('секрет: окружение важнее secrets.json', $c['target']['token'], 'из-окружения');
eq('секрет: из secrets.json, если в окружении нет', $c['sources']['b']['webhook'], 'https://hook');
putenv('B24IG_UNIT_TOKEN');
$logs = "$site/logs";
@mkdir($logs, 0775, true);
file_put_contents("$logs/2026-01-01.log", "old\n");
touch("$logs/2026-01-01.log", time() - 40 * 86400);
file_put_contents("$logs/заметка.txt", "не лог\n");
touch("$logs/заметка.txt", time() - 40 * 86400);
Log::init($logs, 30);
eq('log_keep_days: старый дневной лог удалён', is_file("$logs/2026-01-01.log"), false);
eq('log_keep_days: чужие файлы не трогаются', is_file("$logs/заметка.txt"), true);
exec('rm -rf ' . escapeshellarg($site));

// --- запирание путей из конфига базы (безопасность): db-режим → без .. и абсолютных путей
$cfgBase = array('project' => 'p', 'sources' => array('b' => array('type' => 'bitrix24', 'transport' => 'mock', 'fixtures_dir' => sys_get_temp_dir())),
    'target' => array('base_url' => 'x', 'db' => 'spz', 'token' => 't'), 'order' => array(), 'entities' => array());
$cfgBad = $cfgBase; $cfgBad['runtime'] = array('state_dir' => '/etc/evil');
throws('db-режим: абсолютный state_dir отклонён', function () use ($cfgBad) { new Context($cfgBad, '/data', array('db' => 'spz'), '/code'); }, 'внутри папки базы');
$cfgDot = $cfgBase; $cfgDot['runtime'] = array('state_dir' => '../other/state');
throws('db-режим: .. в пути отклонён', function () use ($cfgDot) { new Context($cfgDot, '/data', array('db' => 'spz'), '/code'); }, 'внутри папки базы');
$ctxProj = new Context($cfgBase, sys_get_temp_dir() . '/b24ig-proj-' . getmypid(), array());   // проектный режим: абсолютные пути разрешены
eq('проектный режим: путь не запирается', $ctxProj->confinePaths, false);
$ctxDb = new Context($cfgBase, sys_get_temp_dir() . '/b24ig-db-' . getmypid(), array('db' => 'spz'), sys_get_temp_dir());
throws('dataFile: .. отклонён', function () use ($ctxDb) { $ctxDb->dataFile('../x', 'тест'); }, 'внутри папки базы');
throws('dataFile: абсолютный отклонён', function () use ($ctxDb) { $ctxDb->dataFile('/etc/passwd', 'тест'); }, 'внутри папки базы');
eq('dataFile: обычное имя внутри папки базы', $ctxDb->dataFile('maps.json', 'тест'), $ctxDb->root . '/maps.json');
exec('rm -rf ' . escapeshellarg($ctxProj->root) . ' ' . escapeshellarg($ctxDb->root));

// --- pagination=start несовместима с периодом и инкрементом (иначе условия молча теряются)
$startSrc = new Bitrix24Source('b', new MockBitrix(sys_get_temp_dir()));
throws('start + период → ошибка', function () use ($startSrc) {
    $startSrc->each(array('method' => 'user.get', 'pagination' => 'start'),
        array('period' => array('field' => 'DATE', 'from' => '2026-01-01')), array(), function () {});
}, 'не поддерживает период');

echo ($failed ? "ПРОВАЛЕНО $failed из $total\n" : "OK: $total проверок\n");
exit($failed ? 1 : 0);
