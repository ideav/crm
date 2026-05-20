<?php

/**
 * Test for issue #2738:
 * export_b3x.php must replace lead SOURCE_ID technical codes with the
 * human-readable names from the attached crm_status.json mapping
 * (ENTITY_ID=SOURCE).
 *
 * Unknown SOURCE_ID values must pass through unchanged so новые/нештатные
 * источники не пропадают из выгрузки.
 */

define('EXPORT_B3X_SKIP_RUN', true);
require_once __DIR__ . '/../export_b3x.php';

function issue2738Assert($condition, $message) {
    if (!$condition) {
        throw new Exception($message);
    }
}

// 1. Lead source map is loaded and non-empty.
issue2738Assert(is_array($leadSourceMap) && !empty($leadSourceMap),
    'Lead source map must be loaded from export_b3x_value_maps.php');

// 2. Spot-check entries from the attached crm_status.json snapshot.
issue2738Assert(($leadSourceMap['CALL'] ?? null) === 'Маркетинг - Сайт - Входящий звонок',
    'SOURCE_ID CALL must map to "Маркетинг - Сайт - Входящий звонок"');
issue2738Assert(($leadSourceMap['STORE'] ?? null) === 'Рекомендация',
    'SOURCE_ID STORE must map to "Рекомендация"');
issue2738Assert(($leadSourceMap['WEBFORM'] ?? null) === 'Маркетинг - Сайт - Обратный звонок Envybox',
    'SOURCE_ID WEBFORM must map to "Маркетинг - Сайт - Обратный звонок Envybox"');
issue2738Assert(($leadSourceMap['CALLBACK'] ?? null) === 'Форма КЦ - Холодный обзвон',
    'SOURCE_ID CALLBACK must map to "Форма КЦ - Холодный обзвон"');
issue2738Assert(($leadSourceMap['UC_QIU27N'] ?? null) === 'Маркетинг - Сайт - Sportzania.ru',
    'SOURCE_ID UC_QIU27N must map to "Маркетинг - Сайт - Sportzania.ru"');
issue2738Assert(($leadSourceMap['REPEAT_SALE'] ?? null) === 'b2b (WB)',
    'SOURCE_ID REPEAT_SALE must map to "b2b (WB)"');
issue2738Assert(($leadSourceMap['1'] ?? null) === 'Маркетинг - WhatsApp',
    'Numeric SOURCE_ID 1 must map to "Маркетинг - WhatsApp"');
issue2738Assert(($leadSourceMap['173'] ?? null) === 'В2В / ПСБ туры',
    'Numeric SOURCE_ID 173 must map to "В2В / ПСБ туры"');
issue2738Assert(($leadSourceMap['17|TELEGRAM_UNLIM'] ?? null) === 'Маркетинг - Telegram',
    'Composite SOURCE_ID 17|TELEGRAM_UNLIM must map to "Маркетинг - Telegram"');

// 3. SOURCE_ID is wired into $leadValueMaps so prepareRowData substitutes it.
issue2738Assert(isset($leadValueMaps['SOURCE_ID']) && !empty($leadValueMaps['SOURCE_ID']),
    'SOURCE_ID must be present in $leadValueMaps so prepareRowData applies it');

// 4. prepareRowData replaces the scalar SOURCE_ID with a human name.
$lead = [
    'ID' => 12345,
    'TITLE' => 'Тест',
    'SOURCE_ID' => 'CALL',
];
$row = prepareRowData($lead, ['ID', 'TITLE', 'SOURCE_ID'], $leadValueMaps);
issue2738Assert($row === ['12345', 'Тест', 'Маркетинг - Сайт - Входящий звонок'],
    'Lead SOURCE_ID must be replaced with the human-readable name');

// 5. Numeric SOURCE_ID returned as a string from Bitrix API is also mapped.
$leadNumeric = ['ID' => 1, 'SOURCE_ID' => '1'];
$rowNumeric = prepareRowData($leadNumeric, ['ID', 'SOURCE_ID'], $leadValueMaps);
issue2738Assert($rowNumeric === ['1', 'Маркетинг - WhatsApp'],
    'Numeric SOURCE_ID must be translated by the map');

// 6. Composite SOURCE_ID (e.g. "17|TELEGRAM_UNLIM") is also mapped.
$leadComposite = ['ID' => 2, 'SOURCE_ID' => '17|TELEGRAM_UNLIM'];
$rowComposite = prepareRowData($leadComposite, ['ID', 'SOURCE_ID'], $leadValueMaps);
issue2738Assert($rowComposite === ['2', 'Маркетинг - Telegram'],
    'Composite SOURCE_ID must be translated by the map');

// 7. Unknown SOURCE_ID falls through unchanged.
$leadUnknown = ['ID' => 3, 'SOURCE_ID' => 'BRAND_NEW_SOURCE'];
$rowUnknown = prepareRowData($leadUnknown, ['ID', 'SOURCE_ID'], $leadValueMaps);
issue2738Assert($rowUnknown === ['3', 'BRAND_NEW_SOURCE'],
    'Unknown SOURCE_ID must pass through unchanged');

// 8. Empty/null SOURCE_ID stays empty.
$leadEmpty = ['ID' => 4, 'SOURCE_ID' => ''];
$rowEmpty = prepareRowData($leadEmpty, ['ID', 'SOURCE_ID'], $leadValueMaps);
issue2738Assert($rowEmpty === ['4', ''],
    'Empty SOURCE_ID must stay empty');

// 9. Translation is applied to SOURCE_ID and other fields independently in
//    the same row (UF_CRM_1648027063964 should still map to its enum NAME).
$leadMixed = [
    'ID' => 5,
    'SOURCE_ID' => 'STORE',
    'UF_CRM_1648027063964' => '4800',
];
$rowMixed = prepareRowData($leadMixed, ['ID', 'SOURCE_ID', 'UF_CRM_1648027063964'], $leadValueMaps);
issue2738Assert($rowMixed === ['5', 'Рекомендация', 'Онлайн-школа'],
    'Both SOURCE_ID and UF_CRM_1648027063964 must be translated together');

// 10. BKI output uses the translated source as a single column too.
$bkiLine = formatBkiRow($row);
issue2738Assert($bkiLine === '12345;Тест;Маркетинг - Сайт - Входящий звонок',
    'BKI output must contain the human-readable SOURCE_ID');

// 11. Deal value maps must not gain a SOURCE_ID entry (deals don't have it).
issue2738Assert(!isset($dealValueMaps['SOURCE_ID']),
    'Deal value maps must not be polluted with SOURCE_ID mapping');

// 12. Existing prepareRowData calls without $valueMaps must still keep the raw code.
$untouched = prepareRowData(['ID' => 6, 'SOURCE_ID' => 'CALL'], ['ID', 'SOURCE_ID']);
issue2738Assert($untouched === ['6', 'CALL'],
    'prepareRowData without value maps must keep the raw SOURCE_ID');

echo "PASS: lead source map loads from export_b3x_value_maps.php\n";
echo "PASS: SOURCE_ID is replaced with human-readable name in CSV/BKI rows\n";
echo "PASS: numeric and composite SOURCE_ID values are translated\n";
echo "PASS: unknown SOURCE_ID values pass through unchanged\n";
echo "PASS: empty SOURCE_ID stays empty, deal rows are untouched\n";
