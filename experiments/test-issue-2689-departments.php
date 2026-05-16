<?php

/**
 * Test for issue #2689 (departments block): полная выгрузка департаментов
 * с пагинацией через start/next и перезапись CSV целиком.
 */

define('EXPORT_B3X_SKIP_RUN', true);
define('EXPORT_B3X_DEPARTMENTS_SKIP_RUN', true);
require_once __DIR__ . '/../export_b3x_departments.php';

function deptAssert($condition, $message) {
    if (!$condition) {
        throw new Exception($message);
    }
}

// 1. Пагинация: первый запрос отдаёт next=50, второй — без next.
$capturedCalls = [];
$pages = [
    ['result' => [
        ['ID' => 1, 'NAME' => 'Корневой', 'SORT' => 100, 'PARENT' => '', 'UF_HEAD' => 10],
        ['ID' => 2, 'NAME' => 'Продажи', 'SORT' => 200, 'PARENT' => 1, 'UF_HEAD' => 20],
    ], 'next' => 50],
    ['result' => [
        ['ID' => 3, 'NAME' => 'Маркетинг', 'SORT' => 300, 'PARENT' => 1, 'UF_HEAD' => 30],
    ]],
];
$callIndex = 0;
$mockApi = function ($webhook, $method, $params) use (&$capturedCalls, &$callIndex, $pages) {
    $capturedCalls[] = ['method' => $method, 'params' => $params];
    $response = $pages[$callIndex] ?? ['result' => []];
    $callIndex++;
    return $response;
};

$all = fetchAllDepartments('https://example.test/rest/1/token/', $mockApi);

deptAssert(count($capturedCalls) === 2, 'expected exactly 2 pagination calls, got ' . count($capturedCalls));
deptAssert($capturedCalls[0]['method'] === 'department.get', 'must call department.get');
deptAssert($capturedCalls[0]['params'] === ['start' => 0], 'first page must start=0');
deptAssert($capturedCalls[1]['params'] === ['start' => 50], 'second page must use next from first response');
deptAssert(count($all) === 3, 'all 3 departments must be aggregated');
deptAssert($all[0]['ID'] === 1 && $all[2]['ID'] === 3, 'order must be preserved');

// 2. Запись CSV: BOM, заголовки, строки в правильном порядке полей.
$tmpCsv = sys_get_temp_dir() . '/test-issue-2689-departments-' . getmypid() . '.csv';
$fields = ['ID', 'NAME', 'SORT', 'PARENT', 'UF_HEAD'];
$headers = ['ID', 'Название', 'Сортировка', 'Родительский ID', 'Руководитель (ID)'];
writeDepartmentsCsv($tmpCsv, $headers, $fields, $all);

$content = file_get_contents($tmpCsv);
deptAssert(substr($content, 0, 3) === "\xEF\xBB\xBF", 'CSV must start with UTF-8 BOM');
$lines = preg_split('/\r?\n/', trim(substr($content, 3)));
deptAssert(count($lines) === 4, 'CSV must have 1 header + 3 data rows, got ' . count($lines));
deptAssert($lines[0] === 'ID;Название;Сортировка;Родительский ID;Руководитель (ID)', 'header line mismatch: ' . $lines[0]);
deptAssert($lines[1] === '1;Корневой;100;;10', 'row 1 mismatch: ' . $lines[1]);
deptAssert($lines[2] === '2;Продажи;200;1;20', 'row 2 mismatch: ' . $lines[2]);

unlink($tmpCsv);

// 3. Перезапись: повторный writeDepartmentsCsv с другими данными полностью
// заменяет файл (а не дописывает).
writeDepartmentsCsv($tmpCsv, $headers, $fields, [['ID' => 99, 'NAME' => 'Новый', 'SORT' => 1, 'PARENT' => '', 'UF_HEAD' => '']]);
writeDepartmentsCsv($tmpCsv, $headers, $fields, [['ID' => 1, 'NAME' => 'Один', 'SORT' => 1, 'PARENT' => '', 'UF_HEAD' => '']]);
$content = file_get_contents($tmpCsv);
deptAssert(strpos($content, 'Новый') === false, 'second write must fully replace first');
deptAssert(strpos($content, 'Один') !== false, 'second write content must be present');
unlink($tmpCsv);

// 4. Защита от бесконечной пагинации: API всегда возвращает next.
$badApi = function () { return ['result' => [['ID' => 1]], 'next' => 50]; };
$tripped = false;
try {
    fetchAllDepartments('https://example.test/', $badApi);
} catch (Exception $e) {
    $tripped = strpos($e->getMessage(), 'guard') !== false;
}
deptAssert($tripped, 'pagination guard must trip on runaway next loop');

echo "PASS: fetchAllDepartments paginates via start/next\n";
echo "PASS: writeDepartmentsCsv writes BOM + headers + rows in field order\n";
echo "PASS: writeDepartmentsCsv replaces file content (no append)\n";
echo "PASS: pagination guard trips on runaway loop\n";
