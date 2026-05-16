<?php
/**
 * Экспорт лидов и сделок за указанный год в отдельные CSV-файлы
 * Только выбранные поля с русскими названиями колонок
 * - Автоперезагрузка при таймауте
 * - Защита от бесконечных перезагрузок
 */

require_once __DIR__ . '/config.php';

// ========== НАСТРОЙКИ ИЗ КОНФИГА ==========
$TARGET_YEAR = 2026;
$csvPath = rtrim($csvPath, '/') . '/';
$timeLimit = defined('TIME_LIMIT') ? TIME_LIMIT : 14;
$batchSize = defined('BATCH_SIZE') ? BATCH_SIZE : 50;
// ==========================================

// ========== НУЖНЫЕ ПОЛЯ И ИХ РУССКИЕ НАЗВАНИЯ ==========
$leadFieldsMap = [
    'ID' => 'ID',
    'TITLE' => 'Название',
    'NAME' => 'Имя',
    'SECOND_NAME' => 'Отчество',
    'LAST_NAME' => 'Фамилия',
    'COMPANY_TITLE' => 'Компания',
    'SOURCE_ID' => 'Источник',
    'SOURCE_DESCRIPTION' => 'Описание источника',
    'STATUS_ID' => 'Статус',
    'STATUS_SEMANTIC_ID' => 'Семантика статуса',
    'OPPORTUNITY' => 'Сумма',
    'IS_MANUAL_OPPORTUNITY' => 'Ручная сумма',
    'OPENED' => 'Открыт',
    'COMMENTS' => 'Комментарий',
    'HAS_PHONE' => 'Есть телефон',
    'HAS_EMAIL' => 'Есть почта',
    'HAS_IMOL' => 'Есть чат',
    'ASSIGNED_BY_ID' => 'Ответственный',
    'CREATED_BY_ID' => 'Создал',
    'MODIFY_BY_ID' => 'Изменил',
    'MOVED_BY_ID' => 'Переместил',
    'CONTACT_ID' => 'Контакт',
    'IS_RETURN_CUSTOMER' => 'Повторный',
    'ORIGINATOR_ID' => 'Инициатор',
    'ORIGIN_ID' => 'Источник происхождения',
    'UTM_SOURCE' => 'UTM источник',
    'UTM_MEDIUM' => 'UTM канал',
    'UTM_CAMPAIGN' => 'UTM кампания',
    'UTM_CONTENT' => 'UTM контент',
    'UTM_TERM' => 'UTM ключ',
    'LAST_ACTIVITY_BY' => 'Активность',
    'LAST_COMMUNICATION_TIME' => 'Последняя связь',
    'PHONE' => 'Телефоны',
    'EMAIL' => 'Почта',
    'WEB' => 'Сайты',
    'IM' => 'Мессенджеры',
    'LINK' => 'Ссылка',
];

$dealFieldsMap = [
    'ID' => 'ID',
    'TITLE' => 'Название',
    'LEAD_ID' => 'Лид',
    'STAGE_ID' => 'Стадия',
    'OPPORTUNITY' => 'Сумма',
    'CURRENCY_ID' => 'Валюта',
    'DATE_CREATE' => 'Дата создания',
    'DATE_MODIFY' => 'Дата изменения',
    'ASSIGNED_BY_ID' => 'Ответственный',
    'CLOSED' => 'Закрыта',
    'COMMENTS' => 'Комментарий',
];

$leadFields = array_keys($leadFieldsMap);
$leadHeaders = array_values($leadFieldsMap);
$dealFields = array_keys($dealFieldsMap);
$dealHeaders = array_values($dealFieldsMap);
// ======================================================

// ========== ФАЙЛЫ ДЛЯ ЭКСПОРТА ==========
$leadsCsvFile = $csvPath . 'leads_' . $TARGET_YEAR . '.csv';
$dealsCsvFile = $csvPath . 'deals_' . $TARGET_YEAR . '.csv';
$errorLogFile = $csvPath . 'export_error_counter_' . $TARGET_YEAR . '.json';

// ========== ЗАЩИТА ОТ БЕСКОНЕЧНЫХ ПЕРЕЗАГРУЗОК ==========
function incrementErrorCounter($file) {
    $data = ['count' => 0, 'first_error_time' => time()];
    if (file_exists($file)) {
        $data = json_decode(file_get_contents($file), true);
    }
    if (time() - $data['first_error_time'] > 300) {
        $data = ['count' => 0, 'first_error_time' => time()];
    }
    $data['count']++;
    file_put_contents($file, json_encode($data));
    return $data['count'];
}

function resetErrorCounter($file) {
    if (file_exists($file)) unlink($file);
}

function checkErrorLimit($file, $limit = 3) {
    if (!file_exists($file)) return true;
    $data = json_decode(file_get_contents($file), true);
    if ($data['count'] >= $limit) {
        echo "\n<span class='error'>[ОШИБКА] ПРЕРВАНО: Зафиксировано {$limit} ошибок подряд.</span>\n";
        echo "<br><a href='?reset=1'>Сбросить счётчик и попробовать снова</a>\n";
        exit(1);
    }
    return true;
}
// ========================================================

// ==================== ФУНКЦИИ API ====================

function callBitrix($bitrix24_webhook, $method, $params = []) {
    $url = $bitrix24_webhook . $method;

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($params));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        throw new Exception("HTTP Error: $httpCode");
    }

    $result = json_decode($response, true);

    if (isset($result['error'])) {
        throw new Exception("API Error: " . ($result['error_description'] ?? $result['error']));
    }

    return $result;
}

function getLeadsBatch($bitrix24_webhook, $year, $lastId = 0, $limit = 50, $selectFields = [], $apiCaller = null) {
    $yearStart = $year . '-01-01T00:00:00';
    $yearEnd = $year . '-12-31T23:59:59';

    $filter = [
        '>=DATE_CREATE' => $yearStart,
        '<=DATE_CREATE' => $yearEnd
    ];

    if ($lastId > 0) {
        $filter['>ID'] = $lastId;
    }

    $params = [
        'order' => ['ID' => 'ASC'],
        'filter' => $filter,
        'select' => $selectFields,
        'limit' => $limit
    ];

    $apiCaller = $apiCaller ?: 'callBitrix';
    $result = $apiCaller($bitrix24_webhook, 'crm.lead.list', $params);

    return [
        'leads' => $result['result'] ?? [],
        'total' => $result['total'] ?? 0
    ];
}

function getDealsBatch($bitrix24_webhook, $year, $lastId = 0, $limit = 50, $selectFields = [], $apiCaller = null) {
    $yearStart = $year . '-01-01T00:00:00';
    $yearEnd = $year . '-12-31T23:59:59';

    $filter = [
        '>=DATE_CREATE' => $yearStart,
        '<=DATE_CREATE' => $yearEnd
    ];

    if ($lastId > 0) {
        $filter['>ID'] = $lastId;
    }

    $params = [
        'order' => ['ID' => 'ASC'],
        'filter' => $filter,
        'select' => $selectFields,
        'limit' => $limit
    ];

    $apiCaller = $apiCaller ?: 'callBitrix';
    $result = $apiCaller($bitrix24_webhook, 'crm.deal.list', $params);

    return [
        'deals' => $result['result'] ?? [],
        'total' => $result['total'] ?? 0
    ];
}

function isExportComplete($state) {
    return !empty($state['leads_complete']) && !empty($state['deals_complete']);
}

/**
 * Issue #2689: при повторном запуске после полной выгрузки снимаем
 * complete-флаги, чтобы догрузить новые лиды/сделки с ID > last_*_id.
 * Возвращает [новый_state, флаг_режим_догрузки].
 */
function prepareResumeAfterComplete($state) {
    $isResume = isExportComplete($state)
        && ((int)($state['last_lead_id'] ?? 0) > 0 || (int)($state['last_deal_id'] ?? 0) > 0);
    if ($isResume) {
        $state['leads_complete'] = false;
        $state['deals_complete'] = false;
        $state['is_complete'] = false;
    }
    return [$state, $isResume];
}

function getDefaultExportState() {
    return [
        'state_version' => 2,
        'last_id' => 0,
        'last_lead_id' => 0,
        'last_deal_id' => 0,
        'leads_complete' => false,
        'deals_complete' => false,
        'is_complete' => false,
        'total_leads' => 0,
        'total_deals' => 0
    ];
}

function normalizeExportState($state) {
    $default = getDefaultExportState();

    if (!is_array($state)) {
        return $default;
    }

    $isLegacyState = !array_key_exists('state_version', $state)
        || !array_key_exists('last_lead_id', $state)
        || !array_key_exists('last_deal_id', $state);

    if ($isLegacyState) {
        $state['last_lead_id'] = (int)($state['last_id'] ?? 0);
        $state['last_deal_id'] = 0;
        $state['leads_complete'] = !empty($state['is_complete']);
        $state['deals_complete'] = false;
        $state['total_deals'] = 0;
    }

    $state = array_merge($default, $state);
    $state['state_version'] = 2;
    $state['last_lead_id'] = (int)$state['last_lead_id'];
    $state['last_deal_id'] = (int)$state['last_deal_id'];
    $state['total_leads'] = (int)$state['total_leads'];
    $state['total_deals'] = (int)$state['total_deals'];
    $state['last_id'] = $state['last_lead_id'];
    $state['is_complete'] = isExportComplete($state);

    return $state;
}

function getExportState($stateFile) {
    if (!file_exists($stateFile)) {
        return getDefaultExportState();
    }

    return normalizeExportState(json_decode(file_get_contents($stateFile), true));
}

function saveExportState($stateFile, $state) {
    $state = normalizeExportState($state);
    file_put_contents($stateFile, json_encode($state, JSON_PRETTY_PRINT));
}

// ==================== ФУНКЦИИ ДЛЯ CSV ====================

/**
 * Инициализация CSV-файла с заголовками
 */
function initCsvFile($csvFile, $headers) {
    if (!file_exists($csvFile) || filesize($csvFile) == 0) {
        $handle = fopen($csvFile, 'w');
        fwrite($handle, "\xEF\xBB\xBF");    // BOM для UTF-8
        fputcsv($handle, $headers, ';');
        fclose($handle);
    }
}

/**
 * Добавление строки данных в CSV-файл
 */
function appendCsvRow($csvFile, $data) {
    $handle = fopen($csvFile, 'a');
    fputcsv($handle, $data, ';');
    fclose($handle);
}

/**
 * Преобразование значения поля в строку для CSV
 * Множественные поля (PHONE, EMAIL, WEB, IM) склеиваются через запятую
 */
function formatFieldValue($value) {
    // Если null - пустая строка
    if (is_null($value)) {
        return '';
    }

    // Если массив - обрабатываем как множественное поле
    if (is_array($value)) {
        $parts = [];
        foreach ($value as $item) {
            if (is_array($item)) {
                if (isset($item['VALUE'])) {
                    $parts[] = $item['VALUE'];
                } else {
                    $parts[] = json_encode($item, JSON_UNESCAPED_UNICODE);
                }
            } else {
                $parts[] = (string)$item;
            }
        }
        return implode(', ', $parts);
    }

    // Если булево значение
    if (is_bool($value)) {
        return $value ? 'Да' : 'Нет';
    }

    // Для строк - очищаем переносы
    if (is_string($value)) {
        return trim(preg_replace('/\s+/', ' ', str_replace(["\n", "\r"], ' ', $value)));
    }

    // Для чисел и прочего - просто приводим к строке
    return (string)$value;
}

/**
 * Подготовка строки данных для CSV на основе списка полей
 */
function prepareRowData($item, $fields) {
    $row = [];
    foreach ($fields as $field) {
        $value = $item[$field] ?? '';
        $row[] = formatFieldValue($value);
    }
    return $row;
}

if (defined('EXPORT_B3X_SKIP_RUN') && EXPORT_B3X_SKIP_RUN) {
    return;
}

// Проверка сброса
if (isset($_GET['reset']) && $_GET['reset'] == 1) {
    if (file_exists($stateFile)) unlink($stateFile);
    resetErrorCounter($errorLogFile);
    echo "Состояние сброшено. <a href='".str_replace('?reset=1', '', $_SERVER['REQUEST_URI'])."'>Начать заново</a><br>\n";
    exit;
}

header('Content-Type: text/html; charset=utf-8');
ob_implicit_flush(true);
while (ob_get_level()) ob_end_flush();

// Создаём директорию для CSV
if (!is_dir($csvPath)) {
    mkdir($csvPath, 0755, true);
}

// ==================== ОСНОВНАЯ ЛОГИКА ====================

global $bitrix24_webhook;

$startTime = time();
$state = getExportState($stateFile);

[$state, $isResumeAfterComplete] = prepareResumeAfterComplete($state);
if ($isResumeAfterComplete) {
    saveExportState($stateFile, $state);
}

$lastLeadId = $state['last_lead_id'];
$lastDealId = $state['last_deal_id'];
$isComplete = isExportComplete($state);

// Очищаем файлы при первом запуске
if ($lastLeadId == 0 && empty($state['leads_complete'])) {
    if (file_exists($leadsCsvFile)) unlink($leadsCsvFile);
}
if ($lastDealId == 0 && empty($state['deals_complete'])) {
    if (file_exists($dealsCsvFile)) unlink($dealsCsvFile);
}

// Инициализируем файлы с заголовками на русском
initCsvFile($leadsCsvFile, $leadHeaders);
initCsvFile($dealsCsvFile, $dealHeaders);

echo "<!DOCTYPE html>
<html>
<head>
    <meta charset='UTF-8'>
    <title>Экспорт лидов и сделок за {$TARGET_YEAR} год</title>
    <style>
        body { font-family: monospace; padding: 6px; background: #1e1e1e; color: #d4d4d4; }
        .info { color: #4ec9b0; }
        .success { color: #6a9955; }
        .error { color: #f48771; }
        .progress { color: #ce9178; }
        .warning { color: #dcdcaa; }
        a { color: #4ec9b0; }
    </style>
</head>
<body>
<pre>
";

echo ">>> ЭКСПОРТ ЛИДОВ И СДЕЛОК ЗА {$TARGET_YEAR} ГОД <<<\n";
echo "   Таймаут: {$timeLimit} сек | Пачка: {$batchSize} записей\n";
echo "   URL: " . parse_url($bitrix24_webhook, PHP_URL_HOST) . "\n";
echo "   Полей лидов: " . count($leadFields) . "\n";
echo "   Полей сделок: " . count($dealFields) . "\n";
echo "   Последний ID лида: {$lastLeadId}\n";
echo "   Последний ID сделки: {$lastDealId}\n";
echo "   Лиды завершены: " . (!empty($state['leads_complete']) ? 'Да' : 'Нет') . "\n";
echo "   Сделки завершены: " . (!empty($state['deals_complete']) ? 'Да' : 'Нет') . "\n";
echo "   Выгружено лидов: " . ($state['total_leads'] ?? 0) . "\n";
echo "   Выгружено сделок: " . ($state['total_deals'] ?? 0) . "\n";
if ($isResumeAfterComplete) {
    echo "   <span class='info'>[ДОГРУЗКА] Ищу новые записи с ID > last_lead_id / last_deal_id</span>\n";
}
echo "\n";

$batchesProcessed = 0;
$shouldStop = false;
$errorCount = 0;
$maxLeadId = $lastLeadId;
$maxDealId = $lastDealId;

try {
    while (!isExportComplete($state) && !$shouldStop) {
        // Проверка времени
        if (time() - $startTime >= $timeLimit) {
            echo "\n<span class='info'>[ВРЕМЯ] Лимит ({$timeLimit} сек). Перезагрузка...</span>\n";
            resetErrorCounter($errorLogFile);
            $shouldStop = true;
            break;
        }

        $processedLeads = 0;
        $processedDeals = 0;

        if (empty($state['leads_complete'])) {
            echo "   Запрос лидов (ID > {$lastLeadId})... ";

            try {
                $batch = getLeadsBatch($bitrix24_webhook, $TARGET_YEAR, $lastLeadId, $batchSize, $leadFields);
                $leads = $batch['leads'];
                $errorCount = 0;
                resetErrorCounter($errorLogFile);
            } catch (Exception $e) {
                $errorCount++;
                incrementErrorCounter($errorLogFile);
                checkErrorLimit($errorLogFile, 3);
                echo "<span class='error'>Ошибка: " . $e->getMessage() . "</span>\n";
                sleep(2);
                continue;
            }

            $leadsCount = count($leads);

            if ($leadsCount == 0) {
                echo "<span class='info'>0 лидов — блок лидов завершен</span>\n";
                $state['leads_complete'] = true;
            } else {
                echo "<span class='progress'>получено {$leadsCount} лидов</span>\n";

                // Записываем лидов
                foreach ($leads as $lead) {
                    $leadRow = prepareRowData($lead, $leadFields);
                    appendCsvRow($leadsCsvFile, $leadRow);
                    $processedLeads++;

                    if ($lead['ID'] > $maxLeadId) {
                        $maxLeadId = $lead['ID'];
                    }
                }
            }

            $state['last_lead_id'] = $maxLeadId;
            $state['total_leads'] = ($state['total_leads'] ?? 0) + $processedLeads;
            saveExportState($stateFile, $state);
            $lastLeadId = $maxLeadId;
        }

        if (time() - $startTime >= $timeLimit) {
            echo "\n<span class='info'>[ВРЕМЯ] Лимит ({$timeLimit} сек). Перезагрузка...</span>\n";
            resetErrorCounter($errorLogFile);
            $shouldStop = true;
            break;
        }

        if (empty($state['deals_complete'])) {
            echo "   Запрос всех сделок (ID > {$lastDealId})... ";

            try {
                $batch = getDealsBatch($bitrix24_webhook, $TARGET_YEAR, $lastDealId, $batchSize, $dealFields);
                $deals = $batch['deals'];
                $errorCount = 0;
                resetErrorCounter($errorLogFile);
            } catch (Exception $e) {
                $errorCount++;
                incrementErrorCounter($errorLogFile);
                checkErrorLimit($errorLogFile, 3);
                echo "<span class='error'>Ошибка: " . $e->getMessage() . "</span>\n";
                sleep(2);
                continue;
            }

            $dealsCount = count($deals);

            if ($dealsCount == 0) {
                echo "<span class='info'>0 сделок — блок сделок завершен</span>\n";
                $state['deals_complete'] = true;
            } else {
                echo "<span class='success'>OK (" . $dealsCount . " сделок)</span>\n";

                // Записываем все сделки независимо от привязки к лидам
                foreach ($deals as $deal) {
                    $dealRow = prepareRowData($deal, $dealFields);
                    appendCsvRow($dealsCsvFile, $dealRow);
                    $processedDeals++;

                    if ($deal['ID'] > $maxDealId) {
                        $maxDealId = $deal['ID'];
                    }
                }
            }

            $state['last_deal_id'] = $maxDealId;
            $state['total_deals'] = ($state['total_deals'] ?? 0) + $processedDeals;
            saveExportState($stateFile, $state);
            $lastDealId = $maxDealId;
        }

        $batchesProcessed++;
        saveExportState($stateFile, $state);

        echo "      Пачка {$batchesProcessed}: +{$processedLeads} лидов, +{$processedDeals} сделок | лид ID: {$maxLeadId}, сделка ID: {$maxDealId}\n";
    }

    $totalLeads = $state['total_leads'] ?? 0;
    $totalDeals = $state['total_deals'] ?? 0;

    echo "\n<span class='info'>ИТОГИ СЕССИИ:</span>\n";
    echo "   Обработано пачек: {$batchesProcessed}\n";
    echo "   Всего лидов: {$totalLeads}\n";
    echo "   Всего сделок: {$totalDeals}\n";

    if (isExportComplete($state)) {
        echo "\n<span class='success'>[ГОТОВО] ВСЕ ДАННЫЕ ЗА {$TARGET_YEAR} ГОД ВЫГРУЖЕНЫ!</span>\n";
        echo "<hr>\n";
        echo "📁 <a href='" . basename($leadsCsvFile) . "' download>Скачать лидов ({$totalLeads})</a>\n";
        echo "<br>📁 <a href='" . basename($dealsCsvFile) . "' download>Скачать сделки ({$totalDeals})</a>\n";
        echo "<br><br>🗑️ <a href='?reset=1'>Сбросить и начать заново</a>\n";
    } else {
        echo "\n<span class='progress'>[ПЕРЕЗАГРУЗКА] Через 0,1 секунду...</span>\n";
        echo "</pre><script>setTimeout(function(){ location.reload(); }, 100);</script>";
    }

} catch (Exception $e) {
    echo "\n<span class='error'>[ОШИБКА] " . $e->getMessage() . "</span>\n";
    if ($maxLeadId > $state['last_lead_id']) {
        $state['last_lead_id'] = $maxLeadId;
    }
    if ($maxDealId > $state['last_deal_id']) {
        $state['last_deal_id'] = $maxDealId;
    }
    saveExportState($stateFile, $state);

    $errorCount = incrementErrorCounter($errorLogFile);
    if ($errorCount >= 3) {
        echo "\n<span class='error'>[ПРЕРВАНО] 3 ошибки подряд.</span>\n";
        echo "<br><a href='?reset=1'>Сбросить счётчик</a>\n";
    } else {
        echo "\n<span class='info'>[ПЕРЕЗАГРУЗКА] Через 3 секунды...</span>";
        echo "</pre><script>setTimeout(function(){ location.reload(); }, 3000);</script>";
    }
}

echo "</pre></body></html>";
