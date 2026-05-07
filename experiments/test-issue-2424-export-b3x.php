<?php

/**
 * Test for issue #2424: deal export must not depend on current lead IDs.
 */

define('EXPORT_B3X_SKIP_RUN', true);
require_once __DIR__ . '/../export_b3x.php';

function issue2424Assert($condition, $message) {
    if (!$condition) {
        throw new Exception($message);
    }
}

$capturedCalls = [];
$mockApi = function ($webhook, $method, $params) use (&$capturedCalls) {
    $capturedCalls[] = [
        'webhook' => $webhook,
        'method' => $method,
        'params' => $params
    ];

    return [
        'result' => [
            ['ID' => 11, 'TITLE' => 'Linked deal', 'LEAD_ID' => 101],
            ['ID' => 12, 'TITLE' => 'Unlinked deal', 'LEAD_ID' => '']
        ],
        'total' => 2
    ];
};

$batch = getDealsBatch(
    'https://example.bitrix24.test/rest/1/token/',
    2026,
    10,
    50,
    ['ID', 'TITLE', 'LEAD_ID'],
    $mockApi
);

issue2424Assert(count($capturedCalls) === 1, 'Expected one Bitrix API call');

$call = $capturedCalls[0];
$params = $call['params'];

issue2424Assert($call['method'] === 'crm.deal.list', 'Deals must be fetched with crm.deal.list');
issue2424Assert($params['order'] === ['ID' => 'ASC'], 'Deals must be fetched in stable ID order');
issue2424Assert($params['limit'] === 50, 'Deals batch size must be passed through');
issue2424Assert($params['select'] === ['ID', 'TITLE', 'LEAD_ID'], 'Deals select fields must be passed through');
issue2424Assert($params['filter']['>=DATE_CREATE'] === '2026-01-01T00:00:00', 'Deal date filter must start at the requested year');
issue2424Assert($params['filter']['<=DATE_CREATE'] === '2026-12-31T23:59:59', 'Deal date filter must end at the requested year');
issue2424Assert($params['filter']['>ID'] === 10, 'Deal export must resume by last deal ID');
issue2424Assert(!array_key_exists('@LEAD_ID', $params['filter']), 'Deal export must not filter by lead IDs');
issue2424Assert(count($batch['deals']) === 2, 'Deal batch must include all API results');
issue2424Assert($batch['deals'][1]['LEAD_ID'] === '', 'Unlinked deals must remain in the export batch');

$legacyState = normalizeExportState([
    'last_id' => 14000,
    'is_complete' => true,
    'total_leads' => 14000,
    'total_deals' => 75
]);

issue2424Assert($legacyState['last_lead_id'] === 14000, 'Legacy lead progress must be preserved');
issue2424Assert($legacyState['last_deal_id'] === 0, 'Legacy deal progress must restart independently');
issue2424Assert($legacyState['leads_complete'] === true, 'Legacy complete state should preserve completed leads');
issue2424Assert($legacyState['deals_complete'] === false, 'Legacy complete state must not mark all deals complete');
issue2424Assert($legacyState['is_complete'] === false, 'Legacy migrated state must resume deal export');
issue2424Assert($legacyState['total_deals'] === 0, 'Legacy partial deal count must be reset before all-deal export');

echo "PASS: getDealsBatch fetches deals independently from lead IDs\n";
echo "PASS: legacy export state resumes with independent deal progress\n";
