<?php
/**
 * Test script to verify the fixed update.php functions work correctly
 */

// Include only the functions we need to test
require_once __DIR__ . '/../../update.php';

// We can't call main execution, so test individual functions

echo "=== Test 1: listGitHubDirectory - css ===\n";
$result = listGitHubDirectory('https://github.com/ideav/crm/', 'main', 'css');
if (is_array($result)) {
    echo "SUCCESS: Found " . count($result) . " files: " . implode(', ', $result) . "\n";
} else {
    echo "ERROR: $result\n";
}

echo "\n=== Test 2: listGitHubDirectory - js ===\n";
$result = listGitHubDirectory('https://github.com/ideav/crm/', 'main', 'js');
if (is_array($result)) {
    echo "SUCCESS: Found " . count($result) . " files: " . implode(', ', $result) . "\n";
} else {
    echo "ERROR: $result\n";
}

echo "\n=== Test 3: listGitHubDirectory - templates/my ===\n";
$result = listGitHubDirectory('https://github.com/ideav/crm/', 'main', 'templates/my');
if (is_array($result)) {
    echo "SUCCESS: Found " . count($result) . " files: " . implode(', ', $result) . "\n";
} else {
    echo "ERROR: $result\n";
}

echo "\n=== Test 4: listGitHubDirectory - templates/ru2 ===\n";
$result = listGitHubDirectory('https://github.com/ideav/crm/', 'main', 'templates/ru2');
if (is_array($result)) {
    echo "SUCCESS: Found " . count($result) . " files: " . implode(', ', $result) . "\n";
} else {
    echo "ERROR: $result\n";
}

echo "\n=== Test 5: listGitHubDirectory - nonexistent ===\n";
$result = listGitHubDirectory('https://github.com/ideav/crm/', 'main', 'nonexistent-dir');
if (is_array($result)) {
    echo "Got array (unexpected): " . print_r($result, true) . "\n";
} else {
    echo "Got error message (expected): $result\n";
}

echo "\n=== Test 6: parseConfig with token ===\n";
$tmpConf = tempnam(sys_get_temp_dir(), 'test') . '.conf';
file_put_contents($tmpConf, "repository: https://github.com/ideav/crm/\nbranch: main\ntoken: test-token-123\njs/* : /var/www/js/\n");
$config = parseConfig($tmpConf);
echo "repository: " . $config['repository'] . "\n";
echo "branch: " . $config['branch'] . "\n";
echo "token: " . $config['token'] . "\n";
echo "mappings: " . count($config['mappings']) . "\n";
unlink($tmpConf);

echo "\n=== Test 7: httpGet function ===\n";
echo "cURL available: " . (function_exists('curl_init') ? "yes" : "no") . "\n";
$result = httpGet('https://api.github.com/repos/ideav/crm/contents/css?ref=main', [
    'User-Agent: PHP-GitHub-Sync-Script',
    'Accept: application/vnd.github.v3+json'
]);
if ($result['body'] === false) {
    echo "ERROR: " . $result['error'] . "\n";
} else {
    $items = json_decode($result['body'], true);
    echo "SUCCESS: HTTP {$result['http_code']}, got " . count($items) . " items\n";
}
