<?php
/**
 * Issue #2689: выгрузка всех департаментов в departments.csv.
 * Не инкрементально — каждый запуск перезаписывает CSV целиком.
 */

define('EXPORT_B3X_SKIP_RUN', true);
require_once __DIR__ . '/export_b3x.php';

$departmentFieldsMap = [
    'ID' => 'ID',
    'NAME' => 'Название',
    'SORT' => 'Сортировка',
    'PARENT' => 'Родительский ID',
    'UF_HEAD' => 'Руководитель (ID)',
];

$departmentFields = array_keys($departmentFieldsMap);
$departmentHeaders = array_values($departmentFieldsMap);

$departmentsCsvFile = $csvPath . 'departments.csv';

/**
 * Полный pull департаментов с пагинацией через start/next.
 * Возвращает плоский массив записей.
 */
function fetchAllDepartments($bitrix24_webhook, $apiCaller = null) {
    $apiCaller = $apiCaller ?: 'callBitrix';
    $all = [];
    $start = 0;
    $guard = 0;
    do {
        $response = $apiCaller($bitrix24_webhook, 'department.get', ['start' => $start]);
        $items = $response['result'] ?? [];
        if (!empty($items)) {
            $all = array_merge($all, $items);
        }
        $start = isset($response['next']) ? (int)$response['next'] : null;
        if (++$guard > 1000) {
            throw new Exception('department.get pagination guard tripped');
        }
    } while ($start !== null && !empty($items));
    return $all;
}

/**
 * Перезаписывает CSV целиком: BOM + заголовки + все строки.
 */
function writeDepartmentsCsv($csvFile, array $headers, array $fields, array $departments) {
    $tmpFile = $csvFile . '.tmp';
    $handle = fopen($tmpFile, 'w');
    if ($handle === false) {
        throw new Exception("Cannot open $tmpFile for writing");
    }
    fwrite($handle, "\xEF\xBB\xBF");
    fputcsv($handle, $headers, ';');
    foreach ($departments as $dept) {
        fputcsv($handle, prepareRowData($dept, $fields), ';');
    }
    fclose($handle);
    if (!rename($tmpFile, $csvFile)) {
        throw new Exception("Cannot move $tmpFile to $csvFile");
    }
}

if (defined('EXPORT_B3X_DEPARTMENTS_SKIP_RUN') && EXPORT_B3X_DEPARTMENTS_SKIP_RUN) {
    return;
}

header('Content-Type: text/html; charset=utf-8');
ob_implicit_flush(true);
while (ob_get_level()) ob_end_flush();

if (!is_dir($csvPath)) {
    mkdir($csvPath, 0755, true);
}

echo "<!DOCTYPE html>
<html>
<head>
    <meta charset='UTF-8'>
    <title>Экспорт департаментов</title>
    <style>
        body { font-family: monospace; padding: 6px; background: #1e1e1e; color: #d4d4d4; }
        .info { color: #4ec9b0; }
        .success { color: #6a9955; }
        .error { color: #f48771; }
        a { color: #4ec9b0; }
    </style>
</head>
<body>
<pre>
";

echo ">>> ЭКСПОРТ ДЕПАРТАМЕНТОВ <<<\n";
echo "   URL: " . parse_url($bitrix24_webhook, PHP_URL_HOST) . "\n";
echo "   CSV: " . basename($departmentsCsvFile) . " (перезапись целиком)\n\n";

try {
    echo "   Загрузка department.get... ";
    $departments = fetchAllDepartments($bitrix24_webhook);
    $count = count($departments);
    echo "<span class='success'>OK ({$count} записей)</span>\n";

    writeDepartmentsCsv($departmentsCsvFile, $departmentHeaders, $departmentFields, $departments);

    echo "\n<span class='success'>[ГОТОВО] Выгружено {$count} департаментов</span>\n";
    echo "<hr>\n";
    echo "📁 <a href='" . basename($departmentsCsvFile) . "' download>Скачать departments.csv</a>\n";

    // Issue #2689: паровозик. После завершения переходим к следующему скрипту
    // (если он существует и не передан ?nochain=1).
    $nextScript = 'export_b3x_users.php';
    if (file_exists(__DIR__ . '/' . $nextScript) && empty($_GET['nochain'])) {
        echo "<br><br><span class='info'>[ПАРОВОЗИК] Через 2 секунды → {$nextScript}</span>";
        echo " <a href='#' id='b3x-stop-chain'>остановить</a>";
        echo "</pre><script>
var __b3xChain = setTimeout(function(){ location.href='{$nextScript}'; }, 2000);
document.getElementById('b3x-stop-chain').onclick = function(e){
    e.preventDefault();
    clearTimeout(__b3xChain);
    this.outerHTML = '<span class=\"info\">[цепочка остановлена]</span>';
};
</script>";
    }
} catch (Exception $e) {
    echo "\n<span class='error'>[ОШИБКА] " . htmlspecialchars($e->getMessage()) . "</span>\n";
}

echo "</pre></body></html>";
