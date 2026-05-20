<?php

/**
 * Test for issue #2736:
 * export_b3x.php must replace technical reference codes with human-readable
 * names from the attached crm_status.json mapping:
 *  - deals: STAGE_ID values from any ENTITY_ID starting with DEAL_STAGE
 *  - leads: UF_CRM_1648027063964 enum IDs
 *
 * Unknown codes must pass through unchanged so new/non-standard stages don't
 * silently disappear from the export.
 */

define('EXPORT_B3X_SKIP_RUN', true);
require_once __DIR__ . '/../export_b3x.php';

function issue2736Assert($condition, $message) {
    if (!$condition) {
        throw new Exception($message);
    }
}

// 1. Value-maps file is wired up and contains both dictionaries.
issue2736Assert(is_array($dealStageMap) && !empty($dealStageMap),
    'Deal stage map must be loaded from export_b3x_value_maps.php');
issue2736Assert(is_array($leadCategory1648027063964Map) && !empty($leadCategory1648027063964Map),
    'Lead UF_CRM_1648027063964 map must be loaded from export_b3x_value_maps.php');

// 2. Spot-check entries from the attached crm_status.json snapshot.
issue2736Assert(($dealStageMap['NEW'] ?? null) === 'Новая',
    'DEAL_STAGE NEW must map to "Новая"');
issue2736Assert(($dealStageMap['C16:WON'] ?? null) === 'Сделка успешна',
    'DEAL_STAGE_16 C16:WON must map to "Сделка успешна"');
issue2736Assert(($dealStageMap['C39:UC_DYXP90'] ?? null)
    === 'Провальная - Другое ( с указанием причины в названии)',
    'DEAL_STAGE_39 C39:UC_DYXP90 must keep its full human-readable name');

// 3. Spot-check lead category enum mapping.
issue2736Assert(($leadCategory1648027063964Map['4800'] ?? null) === 'Онлайн-школа',
    'UF_CRM_1648027063964 4800 must map to "Онлайн-школа"');
issue2736Assert(($leadCategory1648027063964Map['2082'] ?? null) === 'Траектория развития',
    'UF_CRM_1648027063964 2082 must map to "Траектория развития"');

// 4. prepareRowData substitutes the deal STAGE_ID.
$deal = [
    'ID' => 12345,
    'TITLE' => 'Тест',
    'STAGE_ID' => 'C16:WON',
];
$dealRow = prepareRowData($deal, ['ID', 'TITLE', 'STAGE_ID'], $dealValueMaps);
issue2736Assert($dealRow === ['12345', 'Тест', 'Сделка успешна'],
    'Deal STAGE_ID must be replaced with the human-readable name');

// 5. Unknown STAGE_ID falls through unchanged.
$unknownDeal = ['ID' => 1, 'STAGE_ID' => 'C99:UC_BRAND_NEW'];
$unknownRow = prepareRowData($unknownDeal, ['ID', 'STAGE_ID'], $dealValueMaps);
issue2736Assert($unknownRow === ['1', 'C99:UC_BRAND_NEW'],
    'Unknown STAGE_ID must pass through unchanged');

// 6. prepareRowData substitutes single-value UF_CRM_1648027063964.
$leadSingle = ['ID' => 7, 'UF_CRM_1648027063964' => '4800'];
$leadSingleRow = prepareRowData($leadSingle, ['ID', 'UF_CRM_1648027063964'], $leadValueMaps);
issue2736Assert($leadSingleRow === ['7', 'Онлайн-школа'],
    'Single-value UF_CRM_1648027063964 must be replaced with its name');

// 7. Multi-value UF_CRM_1648027063964 is translated per item then joined
//    via the existing comma-separated formatter (matches #2734 behavior).
$leadMulti = ['ID' => 8, 'UF_CRM_1648027063964' => [4800, 2082]];
$leadMultiRow = prepareRowData($leadMulti, ['ID', 'UF_CRM_1648027063964'], $leadValueMaps);
issue2736Assert($leadMultiRow === ['8', 'Онлайн-школа, Траектория развития'],
    'Multi-value UF_CRM_1648027063964 must be translated per element');

// 8. Unknown enum IDs in a multi-value list survive the translation step.
$leadMixed = ['ID' => 9, 'UF_CRM_1648027063964' => [4800, 9999]];
$leadMixedRow = prepareRowData($leadMixed, ['ID', 'UF_CRM_1648027063964'], $leadValueMaps);
issue2736Assert($leadMixedRow === ['9', 'Онлайн-школа, 9999'],
    'Unknown enum IDs must pass through alongside known ones');

// 9. Empty/null values are not touched by the map.
$leadEmpty = ['ID' => 10, 'UF_CRM_1648027063964' => ''];
$leadEmptyRow = prepareRowData($leadEmpty, ['ID', 'UF_CRM_1648027063964'], $leadValueMaps);
issue2736Assert($leadEmptyRow === ['10', ''],
    'Empty enum value must stay empty');

// 10. Existing prepareRowData calls without $valueMaps must still work.
$untouched = prepareRowData(['ID' => 11, 'STAGE_ID' => 'C16:WON'], ['ID', 'STAGE_ID']);
issue2736Assert($untouched === ['11', 'C16:WON'],
    'prepareRowData without value maps must keep the raw STAGE_ID');

// 11. BKI output uses the translated value as a single column too.
$bkiLine = formatBkiRow($dealRow);
issue2736Assert($bkiLine === '12345;Тест;Сделка успешна',
    'BKI output must contain the human-readable STAGE_ID');

echo "PASS: value maps load from export_b3x_value_maps.php\n";
echo "PASS: deal STAGE_ID is replaced with human-readable name\n";
echo "PASS: unknown STAGE_ID passes through unchanged\n";
echo "PASS: UF_CRM_1648027063964 is translated for single and multi values\n";
echo "PASS: BKI output mirrors the translated CSV value\n";
