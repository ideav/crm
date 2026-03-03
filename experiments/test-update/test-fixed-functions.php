<?php
/**
 * Test script to verify the fixed update.php functions work correctly
 * Tests functions in isolation without triggering main execution
 */

// Load only the functions, not the main block
// We'll copy just the function definitions here for testing

function httpGet($url, $headers = [], $timeout = 30) {
    if (function_exists('curl_init')) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_USERAGENT, 'PHP-GitHub-Sync-Script');

        $body = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            return ['body' => false, 'http_code' => null, 'error' => "cURL error: {$error}"];
        }
        return ['body' => $body, 'http_code' => $httpCode, 'error' => null];
    }

    if (!ini_get('allow_url_fopen')) {
        return [
            'body' => false,
            'http_code' => null,
            'error' => 'Neither cURL extension nor allow_url_fopen is available.'
        ];
    }

    $contextHeaders = [];
    foreach ($headers as $header) {
        $contextHeaders[] = $header;
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => $contextHeaders,
            'timeout' => $timeout,
            'ignore_errors' => true
        ]
    ]);

    $body = @file_get_contents($url, false, $context);
    $httpCode = null;

    if (isset($http_response_header)) {
        foreach ($http_response_header as $headerLine) {
            if (preg_match('#^HTTP/\S+\s+(\d+)#', $headerLine, $m)) {
                $httpCode = (int) $m[1];
            }
        }
    }

    if ($body === false) {
        $error = error_get_last();
        return [
            'body' => false,
            'http_code' => null,
            'error' => isset($error['message']) ? $error['message'] : 'file_get_contents failed'
        ];
    }

    return ['body' => $body, 'http_code' => $httpCode, 'error' => null];
}

function buildGitHubHeaders($token = '') {
    $headers = [
        'User-Agent: PHP-GitHub-Sync-Script',
        'Accept: application/vnd.github.v3+json'
    ];
    if (!empty($token)) {
        $headers[] = "Authorization: Bearer {$token}";
    }
    return $headers;
}

function getGitHubApiUrl($repository, $branch, $dirPath) {
    $repository = rtrim($repository, '/');
    if (preg_match('#github\.com/([^/]+)/([^/]+)#', $repository, $matches)) {
        $owner = $matches[1];
        $repo = $matches[2];
        $dirPath = rtrim($dirPath, '/');
        return "https://api.github.com/repos/{$owner}/{$repo}/contents/{$dirPath}?ref={$branch}";
    }
    return '';
}

function listGitHubDirectory($repository, $branch, $dirPath, $token = '') {
    $apiUrl = getGitHubApiUrl($repository, $branch, $dirPath);
    if (empty($apiUrl)) {
        return 'Invalid repository URL';
    }

    $result = httpGet($apiUrl, buildGitHubHeaders($token), 30);

    if ($result['body'] === false) {
        $errorDetail = $result['error'] ?? 'Unknown error';
        return "HTTP request failed: {$errorDetail}";
    }

    if ($result['http_code'] !== null && $result['http_code'] !== 200) {
        $apiResponse = json_decode($result['body'], true);
        $apiMessage = isset($apiResponse['message']) ? $apiResponse['message'] : '';

        if ($result['http_code'] === 403) {
            $rateLimitInfo = '';
            if (strpos($apiMessage, 'rate limit') !== false) {
                $rateLimitInfo = ' API rate limit exceeded. Add a GitHub token to the config (token: YOUR_TOKEN) for higher limits.';
            }
            return "GitHub API returned 403 Forbidden.{$rateLimitInfo}" . ($apiMessage ? " API message: {$apiMessage}" : '');
        } elseif ($result['http_code'] === 404) {
            return "Directory not found in repository: {$dirPath}";
        } else {
            return "GitHub API returned HTTP {$result['http_code']}" . ($apiMessage ? ": {$apiMessage}" : '');
        }
    }

    $items = json_decode($result['body'], true);
    if (!is_array($items)) {
        return "Invalid JSON response from GitHub API";
    }

    if (isset($items['message'])) {
        $message = $items['message'];
        if (strpos($message, 'rate limit') !== false) {
            return "GitHub API rate limit exceeded. Add a GitHub token to the config (token: YOUR_TOKEN) for higher limits. Message: {$message}";
        }
        return "GitHub API error: {$message}";
    }

    $files = [];
    foreach ($items as $item) {
        if (is_array($item) && isset($item['type']) && $item['type'] === 'file') {
            $files[] = $item['name'];
        }
    }

    return $files;
}

function parseConfig($configPath) {
    if (!file_exists($configPath)) {
        return false;
    }

    $lines = file($configPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return false;
    }

    $config = [
        'repository' => '',
        'branch' => 'main',
        'token' => '',
        'mappings' => []
    ];

    foreach ($lines as $line) {
        $line = trim($line);

        if (empty($line) || $line[0] === '#') {
            continue;
        }

        if (preg_match('/^repository\s*:\s*(.+)$/i', $line, $matches)) {
            $config['repository'] = trim($matches[1]);
            continue;
        }

        if (preg_match('/^branch\s*:\s*(.+)$/i', $line, $matches)) {
            $config['branch'] = trim($matches[1]);
            continue;
        }

        if (preg_match('/^token\s*:\s*(.+)$/i', $line, $matches)) {
            $config['token'] = trim($matches[1]);
            continue;
        }

        if (strpos($line, ':') !== false) {
            $parts = explode(':', $line, 2);
            if (count($parts) === 2) {
                $source = trim($parts[0]);
                $target = trim($parts[1]);
                if (!empty($source) && !empty($target)) {
                    $config['mappings'][] = [
                        'source' => $source,
                        'target' => $target
                    ];
                }
            }
        }
    }

    return $config;
}

// ====== TESTS ======

$pass = 0;
$fail = 0;

function test($name, $condition, $details = '') {
    global $pass, $fail;
    if ($condition) {
        echo "PASS: $name\n";
        $pass++;
    } else {
        echo "FAIL: $name" . ($details ? " ($details)" : "") . "\n";
        $fail++;
    }
}

echo "=== Test 1: listGitHubDirectory - css ===\n";
$result = listGitHubDirectory('https://github.com/ideav/crm/', 'main', 'css');
test("css dir is array", is_array($result));
test("css dir has 6 files", is_array($result) && count($result) === 6);
echo "Files: " . (is_array($result) ? implode(', ', $result) : $result) . "\n";

echo "\n=== Test 2: listGitHubDirectory - js ===\n";
$result = listGitHubDirectory('https://github.com/ideav/crm/', 'main', 'js');
test("js dir is array", is_array($result));
test("js dir has 6 files", is_array($result) && count($result) === 6);
echo "Files: " . (is_array($result) ? implode(', ', $result) : $result) . "\n";

echo "\n=== Test 3: listGitHubDirectory - templates/my ===\n";
$result = listGitHubDirectory('https://github.com/ideav/crm/', 'main', 'templates/my');
test("templates/my is array", is_array($result));
test("templates/my has files", is_array($result) && count($result) >= 1);
echo "Files: " . (is_array($result) ? implode(', ', $result) : $result) . "\n";

echo "\n=== Test 4: listGitHubDirectory - templates/ru2 ===\n";
$result = listGitHubDirectory('https://github.com/ideav/crm/', 'main', 'templates/ru2');
test("templates/ru2 is array", is_array($result));
test("templates/ru2 has files", is_array($result) && count($result) >= 1);
echo "Files: " . (is_array($result) ? implode(', ', $result) : $result) . "\n";

echo "\n=== Test 5: listGitHubDirectory - nonexistent (should return error string) ===\n";
$result = listGitHubDirectory('https://github.com/ideav/crm/', 'main', 'nonexistent-dir-xyz');
test("nonexistent returns error string", is_string($result));
test("error message is descriptive", is_string($result) && strlen($result) > 10);
echo "Error message: " . (is_string($result) ? $result : "unexpected array") . "\n";

echo "\n=== Test 6: parseConfig with token ===\n";
$tmpConf = tempnam(sys_get_temp_dir(), 'test') . '.conf';
file_put_contents($tmpConf, "repository: https://github.com/ideav/crm/\nbranch: main\ntoken: test-token-123\njs/* : /var/www/js/\n");
$config = parseConfig($tmpConf);
test("parseConfig returns array", is_array($config));
test("token parsed correctly", is_array($config) && $config['token'] === 'test-token-123');
test("repository parsed", is_array($config) && $config['repository'] === 'https://github.com/ideav/crm/');
test("branch parsed", is_array($config) && $config['branch'] === 'main');
test("mappings parsed", is_array($config) && count($config['mappings']) === 1);
unlink($tmpConf);

echo "\n=== Test 7: parseConfig without token (backward compat) ===\n";
$tmpConf2 = tempnam(sys_get_temp_dir(), 'test') . '.conf';
file_put_contents($tmpConf2, "repository: https://github.com/ideav/crm/\nbranch: main\ncss/* : /var/www/css/\n");
$config2 = parseConfig($tmpConf2);
test("parseConfig without token returns empty token", is_array($config2) && $config2['token'] === '');
unlink($tmpConf2);

echo "\n=== Test 8: httpGet function ===\n";
echo "cURL available: " . (function_exists('curl_init') ? "yes" : "no") . "\n";
$result = httpGet('https://api.github.com/repos/ideav/crm/contents/css?ref=main', buildGitHubHeaders(''));
test("httpGet returns body", $result['body'] !== false);
test("httpGet returns 200", $result['http_code'] === 200);
$items = json_decode($result['body'], true);
test("httpGet body is valid JSON array", is_array($items) && count($items) > 0);

echo "\n=== Test 9: Rate limit response detection ===\n";
// Simulate rate limit response
$rateLimitBody = '{"message":"API rate limit exceeded","documentation_url":"https://docs.github.com/rest"}';
$items = json_decode($rateLimitBody, true);
test("Rate limit JSON is array (PHP parses object as array)", is_array($items));
test("Rate limit has message key", isset($items['message']));
test("Rate limit message contains 'rate limit'", strpos($items['message'], 'rate limit') !== false);

echo "\n=== SUMMARY ===\n";
echo "Passed: $pass\n";
echo "Failed: $fail\n";
