<?php

/**
 * Test for issue #2689 (updates phase): выгрузка лидов и сделок, обновлённых
 * после прошлого экспорта. Фильтр >DATE_MODIFY > last_export_time AND <=ID,
 * чтобы не пересекаться с фазой "новых" (>ID). После полного прогона
 * (новые + обновлённые) скрипт фиксирует last_export_time.
 */

define('EXPORT_B3X_SKIP_RUN', true);
require_once __DIR__ . '/../export_b3x.php';

function updAssert($condition, $message) {
    if (!$condition) {
        throw new Exception($message);
    }
}

// 1. isUpdatesPhaseComplete: без last_export_time всегда true.
updAssert(isUpdatesPhaseComplete(getDefaultExportState()) === true,
    'fresh state: updates phase considered complete (нет фазы обновлений)');

$firstRunDone = normalizeExportState([
    'last_lead_id' => 100,
    'last_deal_id' => 50,
    'leads_complete' => true,
    'deals_complete' => true,
    'last_export_time' => null,
]);
updAssert(isUpdatesPhaseComplete($firstRunDone) === true,
    'first run done but last_export_time=null: updates phase complete');

$secondRunStart = normalizeExportState([
    'last_lead_id' => 100,
    'last_deal_id' => 50,
    'leads_complete' => true,
    'deals_complete' => true,
    'last_export_time' => '2026-05-15T10:00:00+03:00',
    'updates_leads_complete' => false,
    'updates_deals_complete' => false,
]);
updAssert(isUpdatesPhaseComplete($secondRunStart) === false,
    'second run with last_export_time set: updates phase must run');

$secondRunDone = $secondRunStart;
$secondRunDone['updates_leads_complete'] = true;
$secondRunDone['updates_deals_complete'] = true;
updAssert(isUpdatesPhaseComplete(normalizeExportState($secondRunDone)) === true,
    'both updates flags set: phase complete');

// 2. prepareResumeAfterComplete: новая логика учитывает обе фазы.

// 2a. Первый полный прогон (last_export_time=null после нашей пометки в коде —
// сначала пройдёт первый прогон, скрипт поставит last_export_time, и при
// следующем запуске мы попадём сюда).
$afterFirstRun = normalizeExportState([
    'last_lead_id' => 100,
    'last_deal_id' => 50,
    'leads_complete' => true,
    'deals_complete' => true,
    'last_export_time' => '2026-05-15T10:00:00+03:00',
]);
[$resumed1, $isResume1] = prepareResumeAfterComplete($afterFirstRun);
updAssert($isResume1 === true, 'resume after first complete run with last_export_time set');
updAssert($resumed1['leads_complete'] === false, 'leads_complete cleared');
updAssert($resumed1['deals_complete'] === false, 'deals_complete cleared');
updAssert($resumed1['updates_leads_complete'] === false, 'updates_leads_complete cleared too');
updAssert($resumed1['updates_deals_complete'] === false, 'updates_deals_complete cleared too');
updAssert($resumed1['updates_lead_last_id'] === 0, 'updates_lead_last_id reset for new pass');
updAssert($resumed1['updates_deal_last_id'] === 0, 'updates_deal_last_id reset for new pass');
updAssert($resumed1['last_lead_id'] === 100, 'last_lead_id preserved');
updAssert($resumed1['last_export_time'] === '2026-05-15T10:00:00+03:00', 'last_export_time preserved');

// 2b. Прерывание во время фазы обновлений — resume НЕ срабатывает, потому что
// обновления ещё не complete; продолжаем с того места, где остановились.
$midUpdates = normalizeExportState([
    'last_lead_id' => 100,
    'last_deal_id' => 50,
    'leads_complete' => true,
    'deals_complete' => true,
    'last_export_time' => '2026-05-15T10:00:00+03:00',
    'updates_lead_last_id' => 42,
    'updates_leads_complete' => false,
    'updates_deals_complete' => false,
]);
[$resumed2, $isResume2] = prepareResumeAfterComplete($midUpdates);
updAssert($isResume2 === false, 'no resume while updates phase in progress');
updAssert($resumed2['updates_lead_last_id'] === 42, 'mid-updates cursor preserved (no reset)');

// 2c. Полностью завершённый второй прогон → resume снимает всё.
$fullyDone = normalizeExportState([
    'last_lead_id' => 100,
    'last_deal_id' => 50,
    'leads_complete' => true,
    'deals_complete' => true,
    'last_export_time' => '2026-05-15T10:00:00+03:00',
    'updates_lead_last_id' => 99,
    'updates_deal_last_id' => 49,
    'updates_leads_complete' => true,
    'updates_deals_complete' => true,
]);
[$resumed3, $isResume3] = prepareResumeAfterComplete($fullyDone);
updAssert($isResume3 === true, 'resume after fully complete second run');
updAssert($resumed3['updates_lead_last_id'] === 0, 'updates cursors reset for next pass');
updAssert($resumed3['updates_deal_last_id'] === 0, 'updates cursors reset for next pass');

// 3. getUpdatedLeadsBatch: фильтр содержит DATE_MODIFY, <=ID и >ID.
$calls = [];
$mockApi = function ($webhook, $method, $params) use (&$calls) {
    $calls[] = ['method' => $method, 'params' => $params];
    return ['result' => [['ID' => 11, 'TITLE' => 'updated lead']], 'total' => 1];
};
$batch = getUpdatedLeadsBatch(
    'https://example.test/',
    2026,
    '2026-05-15T10:00:00+03:00',
    100,
    10,
    50,
    ['ID', 'TITLE', 'DATE_MODIFY'],
    $mockApi
);
updAssert($calls[0]['method'] === 'crm.lead.list', 'updates leads must call crm.lead.list');
updAssert($calls[0]['params']['filter']['>DATE_MODIFY'] === '2026-05-15T10:00:00+03:00', 'DATE_MODIFY filter must be present');
updAssert($calls[0]['params']['filter']['<=ID'] === 100, 'must cap ID at max-id from new phase');
updAssert($calls[0]['params']['filter']['>ID'] === 10, 'must paginate by >ID for stable order');
updAssert($calls[0]['params']['order'] === ['ID' => 'ASC'], 'must order by ID ASC');
updAssert(count($batch['leads']) === 1, 'returns leads array');

// При lastUpdateId=0 фильтр >ID не передаётся.
$calls = [];
getUpdatedLeadsBatch('https://example.test/', 2026, '2026-05-15T10:00:00+03:00', 100, 0, 50, ['ID'], $mockApi);
updAssert(!array_key_exists('>ID', $calls[0]['params']['filter']), 'no >ID when lastUpdateId=0');

// 4. getUpdatedDealsBatch — то же поведение, но для crm.deal.list.
$calls = [];
$batchDeals = getUpdatedDealsBatch(
    'https://example.test/',
    2026,
    '2026-05-15T10:00:00+03:00',
    50,
    5,
    50,
    ['ID', 'TITLE'],
    $mockApi
);
updAssert($calls[0]['method'] === 'crm.deal.list', 'updates deals must call crm.deal.list');
updAssert($calls[0]['params']['filter']['>DATE_MODIFY'] === '2026-05-15T10:00:00+03:00', 'DATE_MODIFY filter');
updAssert($calls[0]['params']['filter']['<=ID'] === 50, '<=ID cap');
updAssert($calls[0]['params']['filter']['>ID'] === 5, 'pagination via >ID');

// 5. normalizeExportState: миграция state_version=2 (после PR #2690) в v3.
$v2State = [
    'state_version' => 2,
    'last_lead_id' => 100,
    'last_deal_id' => 50,
    'leads_complete' => true,
    'deals_complete' => true,
    'is_complete' => true,
    'total_leads' => 100,
    'total_deals' => 50,
];
$migrated = normalizeExportState($v2State);
updAssert($migrated['state_version'] === 3, 'state migrated to v3');
updAssert($migrated['last_export_time'] === null, 'new field last_export_time defaults to null');
updAssert($migrated['updates_lead_last_id'] === 0, 'new updates_lead_last_id defaults to 0');
updAssert($migrated['updates_leads_complete'] === false, 'updates_leads_complete defaults to false');
updAssert($migrated['total_updated_leads'] === 0, 'total_updated_leads defaults to 0');
updAssert($migrated['last_lead_id'] === 100, 'existing fields preserved through migration');

// 6. После миграции v2 с is_complete=true фаза updates тоже считается
// complete (потому что last_export_time = null). На следующем запуске
// prepareResumeAfterComplete снимет флаги новых, а флаги updates не тронет.
[$migratedResume, $migratedResumeFlag] = prepareResumeAfterComplete($migrated);
updAssert($migratedResumeFlag === true, 'v2 fully-complete state resumes on next run');
updAssert($migratedResume['leads_complete'] === false, 'leads_complete cleared after migration');
// updates_leads_complete был false и таким остаётся (last_export_time=null).
updAssert($migratedResume['updates_leads_complete'] === false, 'updates_leads_complete stays false');

echo "PASS: isUpdatesPhaseComplete correctly returns true for first-run states\n";
echo "PASS: prepareResumeAfterComplete handles both phases and preserves mid-updates cursor\n";
echo "PASS: getUpdatedLeadsBatch builds DATE_MODIFY + <=ID + >ID filter\n";
echo "PASS: getUpdatedDealsBatch builds DATE_MODIFY + <=ID + >ID filter\n";
echo "PASS: normalizeExportState migrates v2 → v3 with safe defaults\n";
