<?php

/**
 * Test for issue #2734:
 * export_b3x.php must request UF_CRM_1648027063964 for leads and flatten its
 * Bitrix array value into one comma-separated export field.
 */

define('EXPORT_B3X_SKIP_RUN', true);
require_once __DIR__ . '/../export_b3x.php';

function issue2734Assert($condition, $message) {
    if (!$condition) {
        throw new Exception($message);
    }
}

issue2734Assert(
    array_key_exists('UF_CRM_1648027063964', $leadFieldsMap),
    'Lead export must include UF_CRM_1648027063964 in the field map'
);

issue2734Assert(
    in_array('UF_CRM_1648027063964', $leadFields, true),
    'Lead API select fields must include UF_CRM_1648027063964'
);

$lead = [
    'ID' => 101,
    'UF_CRM_1648027063964' => [4800, 4900],
];
$row = prepareRowData($lead, ['ID', 'UF_CRM_1648027063964']);

issue2734Assert($row === ['101', '4800, 4900'],
    'Custom multi-value field must be exported as comma-separated text');

$bkiLine = formatBkiRow($row);
issue2734Assert($bkiLine === '101;4800, 4900',
    'BKI output must keep the custom field as one semicolon-delimited column');

$capturedCalls = [];
$mockApi = function ($webhook, $method, $params) use (&$capturedCalls) {
    $capturedCalls[] = [
        'method' => $method,
        'params' => $params,
    ];
    return [
        'result' => [
            ['ID' => 101, 'UF_CRM_1648027063964' => [4800]],
        ],
        'total' => 1,
    ];
};

getLeadsBatch(
    'https://example.bitrix24.test/rest/1/token/',
    2026,
    0,
    50,
    $leadFields,
    $mockApi
);

issue2734Assert(
    in_array('UF_CRM_1648027063964', $capturedCalls[0]['params']['select'], true),
    'crm.lead.list select must request UF_CRM_1648027063964 from Bitrix'
);

echo "PASS: lead export requests UF_CRM_1648027063964\n";
echo "PASS: UF_CRM_1648027063964 array values export as one comma-separated field\n";
