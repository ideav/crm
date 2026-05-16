<?php

/**
 * Test for issue #2689: на следующий запуск после "ВСЕ ВЫГРУЖЕНО"
 * скрипт должен снимать leads_complete/deals_complete и догружать новое
 * с ID > last_lead_id / last_deal_id, не теряя CSV и не сбрасывая last_*_id.
 */

define('EXPORT_B3X_SKIP_RUN', true);
require_once __DIR__ . '/../export_b3x.php';

function issue2689Assert($condition, $message) {
    if (!$condition) {
        throw new Exception($message);
    }
}

// 1. Полностью завершённый прошлый прогон → должен включиться режим догрузки.
$completedState = normalizeExportState([
    'last_lead_id' => 328089,
    'last_deal_id' => 124745,
    'leads_complete' => true,
    'deals_complete' => true,
    'total_leads' => 14683,
    'total_deals' => 6637,
]);
issue2689Assert(isExportComplete($completedState), 'precondition: state must be complete');

[$resumedState, $isResume] = prepareResumeAfterComplete($completedState);

issue2689Assert($isResume === true, 'resume flag must be raised when previous run was complete');
issue2689Assert($resumedState['leads_complete'] === false, 'leads_complete must be cleared on resume');
issue2689Assert($resumedState['deals_complete'] === false, 'deals_complete must be cleared on resume');
issue2689Assert($resumedState['is_complete'] === false, 'is_complete must be cleared on resume');
issue2689Assert($resumedState['last_lead_id'] === 328089, 'last_lead_id must be preserved on resume');
issue2689Assert($resumedState['last_deal_id'] === 124745, 'last_deal_id must be preserved on resume');
issue2689Assert($resumedState['total_leads'] === 14683, 'total_leads must be preserved on resume');
issue2689Assert($resumedState['total_deals'] === 6637, 'total_deals must be preserved on resume');

// 2. Незавершённый прогон → resume не срабатывает, ничего не меняется.
$partialState = normalizeExportState([
    'last_lead_id' => 100,
    'last_deal_id' => 0,
    'leads_complete' => false,
    'deals_complete' => false,
]);
[$samePartial, $partialResume] = prepareResumeAfterComplete($partialState);
issue2689Assert($partialResume === false, 'resume must not trigger on partial state');
issue2689Assert($samePartial === $partialState, 'partial state must pass through unchanged');

// 3. Свежий пустой стейт (первый запуск) → resume не срабатывает.
$freshState = getDefaultExportState();
[$sameFresh, $freshResume] = prepareResumeAfterComplete($freshState);
issue2689Assert($freshResume === false, 'resume must not trigger on fresh state');
issue2689Assert($sameFresh === $freshState, 'fresh state must pass through unchanged');

// 4. Полный стейт, но last_*_id = 0 (вырожденный случай: complete без выгруженных
// записей — например, в году вообще нет данных). Resume не нужен, иначе мы будем
// каждый раз делать два пустых запроса в Bitrix.
$emptyComplete = normalizeExportState([
    'last_lead_id' => 0,
    'last_deal_id' => 0,
    'leads_complete' => true,
    'deals_complete' => true,
]);
[$_, $emptyResume] = prepareResumeAfterComplete($emptyComplete);
issue2689Assert($emptyResume === false, 'resume must not trigger when nothing was ever exported');

echo "PASS: complete state turns into resume mode and keeps last_*_id\n";
echo "PASS: partial / fresh / empty-complete states do not trigger resume\n";
