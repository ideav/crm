<?php

/**
 * Test for issue #2689 (users block): полная выгрузка пользователей
 * с пагинацией для активных и уволенных, дедупликация по ID,
 * перезапись CSV целиком.
 */

define('EXPORT_B3X_SKIP_RUN', true);
define('EXPORT_B3X_USERS_SKIP_RUN', true);
require_once __DIR__ . '/../export_b3x_users.php';

function usersAssert($condition, $message) {
    if (!$condition) {
        throw new Exception($message);
    }
}

// 1. Пагинация по двум фильтрам (ACTIVE=true, ACTIVE=false), дедупликация.
$calls = [];
$mockApi = function ($webhook, $method, $params) use (&$calls) {
    $calls[] = ['method' => $method, 'params' => $params];
    $isActive = !empty($params['FILTER']['ACTIVE']);
    $start = (int)($params['start'] ?? 0);
    if ($isActive) {
        // Двухстраничный ответ для активных.
        if ($start === 0) {
            return [
                'result' => [
                    ['ID' => 1, 'NAME' => 'Anna', 'LAST_NAME' => 'A', 'ACTIVE' => true],
                    ['ID' => 2, 'NAME' => 'Boris', 'LAST_NAME' => 'B', 'ACTIVE' => true],
                ],
                'next' => 50,
            ];
        }
        return ['result' => [
            ['ID' => 3, 'NAME' => 'Vera', 'LAST_NAME' => 'V', 'ACTIVE' => true],
        ]];
    }
    // Уволенные: один пользователь, причём ID=2 — дубль активного, проверим dedup.
    return ['result' => [
        ['ID' => 2, 'NAME' => 'Boris-duplicate', 'LAST_NAME' => 'B', 'ACTIVE' => false],
        ['ID' => 99, 'NAME' => 'Old', 'LAST_NAME' => 'O', 'ACTIVE' => false],
    ]];
};

$all = fetchAllUsers('https://example.test/rest/1/token/', $mockApi);

usersAssert(count($calls) === 3, 'expected 3 calls (active p1, active p2, inactive p1), got ' . count($calls));
usersAssert($calls[0]['method'] === 'user.get', 'must call user.get');
usersAssert($calls[0]['params']['FILTER']['ACTIVE'] === true, 'first pass must filter ACTIVE=true');
usersAssert($calls[2]['params']['FILTER']['ACTIVE'] === false, 'second pass must filter ACTIVE=false');
usersAssert(count($all) === 4, 'expected 4 unique users (1,2,3,99), got ' . count($all));

$ids = array_map(function ($u) { return $u['ID']; }, $all);
usersAssert($ids === [1, 2, 3, 99], 'order must follow fetch order with dedup: ' . implode(',', $ids));

// Дубль ID=2 должен сохраниться от первого прохода (активный Boris), а не быть
// перезаписан "Boris-duplicate" из неактивных.
usersAssert($all[1]['NAME'] === 'Boris', 'dedup must keep first occurrence (active), not later inactive duplicate');

// 2. CSV: BOM, заголовки, порядок полей.
$tmpCsv = sys_get_temp_dir() . '/test-issue-2689-users-' . getmypid() . '.csv';
$fields = ['ID', 'NAME', 'LAST_NAME', 'ACTIVE'];
$headers = ['ID', 'Имя', 'Фамилия', 'Активен'];
writeUsersCsv($tmpCsv, $headers, $fields, [
    ['ID' => 1, 'NAME' => 'Anna', 'LAST_NAME' => 'A', 'ACTIVE' => true],
    ['ID' => 99, 'NAME' => 'Old', 'LAST_NAME' => 'O', 'ACTIVE' => false],
]);
$content = file_get_contents($tmpCsv);
usersAssert(substr($content, 0, 3) === "\xEF\xBB\xBF", 'CSV must start with UTF-8 BOM');
$lines = preg_split('/\r?\n/', trim(substr($content, 3)));
usersAssert($lines[0] === 'ID;Имя;Фамилия;Активен', 'header line mismatch: ' . $lines[0]);
usersAssert($lines[1] === '1;Anna;A;Да', 'row 1 mismatch (bool→Да): ' . $lines[1]);
usersAssert($lines[2] === '99;Old;O;Нет', 'row 2 mismatch (bool→Нет): ' . $lines[2]);

// 3. Перезапись: повторный writeUsersCsv заменяет файл, а не дописывает.
writeUsersCsv($tmpCsv, $headers, $fields, [['ID' => 7, 'NAME' => 'New', 'LAST_NAME' => 'N', 'ACTIVE' => true]]);
$content = file_get_contents($tmpCsv);
usersAssert(strpos($content, 'Anna') === false, 'second write must fully replace first');
usersAssert(strpos($content, 'New') !== false, 'second write content must be present');
unlink($tmpCsv);

// 4. Pagination guard.
$badApi = function () { return ['result' => [['ID' => 1]], 'next' => 50]; };
$tripped = false;
try {
    fetchAllUsers('https://example.test/', $badApi);
} catch (Exception $e) {
    $tripped = strpos($e->getMessage(), 'guard') !== false;
}
usersAssert($tripped, 'pagination guard must trip on runaway loop');

echo "PASS: fetchAllUsers paginates active + inactive and deduplicates by ID\n";
echo "PASS: writeUsersCsv writes BOM + headers + rows with correct field order\n";
echo "PASS: writeUsersCsv replaces file content (no append)\n";
echo "PASS: pagination guard trips on runaway loop\n";
