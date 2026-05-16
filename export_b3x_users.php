<?php
/**
 * Issue #2689: выгрузка всех пользователей в users.csv.
 * Не инкрементально — каждый запуск перезаписывает CSV целиком.
 */

define('EXPORT_B3X_SKIP_RUN', true);
require_once __DIR__ . '/export_b3x.php';

$userFieldsMap = [
    'ID' => 'ID',
    'ACTIVE' => 'Активен',
    'NAME' => 'Имя',
    'LAST_NAME' => 'Фамилия',
    'SECOND_NAME' => 'Отчество',
    'EMAIL' => 'Почта',
    'WORK_PHONE' => 'Рабочий телефон',
    'PERSONAL_MOBILE' => 'Мобильный',
    'WORK_POSITION' => 'Должность',
    'UF_DEPARTMENT' => 'Департаменты (ID)',
    'LAST_LOGIN' => 'Последний вход',
    'DATE_REGISTER' => 'Дата регистрации',
];

$userFields = array_keys($userFieldsMap);
$userHeaders = array_values($userFieldsMap);

$usersCsvFile = $csvPath . 'users.csv';
// Issue #2696: дополнительная выгрузка в .bki для Интеграма.
$usersBkiFile = $csvPath . 'users.bki';

// ========== ХЕЛПЕРЫ BKI (Issue #2696) ==========
// function_exists guard: если export_b3x.php тоже объявил хелперы,
// этот блок пропускается. Так PR независим от порядка мержа.
if (!function_exists('bkiEscape')) {
    function bkiEscape($value) {
        $value = str_replace(["\r\n", "\r", "\n", "\t"], ' ', (string)$value);
        return str_replace(';', '\\;', $value);
    }
    function formatBkiRow(array $values) {
        return implode(';', array_map('bkiEscape', $values));
    }
    function initBkiFile($file) {
        if (!file_exists($file) || filesize($file) == 0) {
            file_put_contents($file, "DATA\n");
        }
    }
    function appendBkiRow($file, array $values) {
        file_put_contents($file, formatBkiRow($values) . "\n", FILE_APPEND);
    }
    function writeBkiFile($file, array $rows) {
        $content = "DATA\n";
        foreach ($rows as $values) {
            $content .= formatBkiRow($values) . "\n";
        }
        $tmp = $file . '.tmp';
        file_put_contents($tmp, $content);
        rename($tmp, $file);
    }
}

/**
 * Полный pull пользователей с пагинацией через start/next.
 * Bitrix user.get отдаёт уволенных, если передать ACTIVE=false в фильтре;
 * мы делаем два прохода (активные + неактивные) и склеиваем — без фильтра
 * API возвращает только ACTIVE=true.
 */
function fetchAllUsers($bitrix24_webhook, $apiCaller = null) {
    $apiCaller = $apiCaller ?: 'callBitrix';
    $all = [];
    $seen = [];

    foreach ([['ACTIVE' => true], ['ACTIVE' => false]] as $filter) {
        $start = 0;
        $guard = 0;
        do {
            $response = $apiCaller($bitrix24_webhook, 'user.get', [
                'FILTER' => $filter,
                'start' => $start,
            ]);
            $items = $response['result'] ?? [];
            foreach ($items as $user) {
                $id = $user['ID'] ?? null;
                if ($id === null || isset($seen[$id])) {
                    continue;
                }
                $seen[$id] = true;
                $all[] = $user;
            }
            $start = isset($response['next']) ? (int)$response['next'] : null;
            if (++$guard > 1000) {
                throw new Exception('user.get pagination guard tripped');
            }
        } while ($start !== null && !empty($items));
    }

    return $all;
}

/**
 * Перезаписывает CSV целиком: BOM + заголовки + все строки.
 * Атомарная замена через .tmp + rename.
 */
function writeUsersCsv($csvFile, array $headers, array $fields, array $users) {
    $tmpFile = $csvFile . '.tmp';
    $handle = fopen($tmpFile, 'w');
    if ($handle === false) {
        throw new Exception("Cannot open $tmpFile for writing");
    }
    fwrite($handle, "\xEF\xBB\xBF");
    fputcsv($handle, $headers, ';');
    foreach ($users as $user) {
        fputcsv($handle, prepareRowData($user, $fields), ';');
    }
    fclose($handle);
    if (!rename($tmpFile, $csvFile)) {
        throw new Exception("Cannot move $tmpFile to $csvFile");
    }
}

if (defined('EXPORT_B3X_USERS_SKIP_RUN') && EXPORT_B3X_USERS_SKIP_RUN) {
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
    <title>Экспорт пользователей</title>
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

echo ">>> ЭКСПОРТ ПОЛЬЗОВАТЕЛЕЙ <<<\n";
echo "   URL: " . parse_url($bitrix24_webhook, PHP_URL_HOST) . "\n";
echo "   CSV: " . basename($usersCsvFile) . " (перезапись целиком, активные + уволенные)\n\n";

try {
    echo "   Загрузка user.get... ";
    $users = fetchAllUsers($bitrix24_webhook);
    $count = count($users);
    echo "<span class='success'>OK ({$count} записей)</span>\n";

    writeUsersCsv($usersCsvFile, $userHeaders, $userFields, $users);

    // Issue #2696: параллельно — снимок в .bki для Интеграма (полная перезапись).
    $bkiRows = [];
    foreach ($users as $user) {
        $bkiRows[] = prepareRowData($user, $userFields);
    }
    writeBkiFile($usersBkiFile, $bkiRows);

    echo "\n<span class='success'>[ГОТОВО] Выгружено {$count} пользователей</span>\n";
    echo "<hr>\n";
    echo "📁 <a href='" . basename($usersCsvFile) . "' download>Скачать users.csv</a>\n";
    echo "<br>📁 <a href='" . basename($usersBkiFile) . "' download>Скачать users.bki</a>\n";

    // Issue #2689: паровозик. После завершения переходим к следующему скрипту
    // (если он существует и не передан ?nochain=1).
    $nextScript = 'export_b3x_tasks.php';
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
