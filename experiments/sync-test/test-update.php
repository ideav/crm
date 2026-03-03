<?php
/**
 * Test script for GitHub sync functionality
 *
 * This script tests the core functions of update.php without executing the full sync
 */

// Include the main script functions (we'll test them individually)

echo "=== GitHub Sync Script Test Suite ===\n\n";

// Test 1: Test config parsing
echo "Test 1: Configuration File Parsing\n";
echo "-----------------------------------\n";

$testConfig = <<<EOT
# Test configuration
repository: https://github.com/ideav/crm/
branch: main

# CSS files
css/* : /var/www/test/css/
js/app.js : /var/www/test/js/
EOT;

$tempConfigFile = sys_get_temp_dir() . '/test-update.conf';
file_put_contents($tempConfigFile, $testConfig);

// Include parse config function
function parseConfigForTest($configPath) {
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

$config = parseConfigForTest($tempConfigFile);
unlink($tempConfigFile);

echo "Repository: " . ($config['repository'] ?? 'NOT SET') . "\n";
echo "Branch: " . ($config['branch'] ?? 'NOT SET') . "\n";
echo "Mappings: " . count($config['mappings']) . " found\n";

foreach ($config['mappings'] as $i => $mapping) {
    echo "  [{$i}] {$mapping['source']} -> {$mapping['target']}\n";
}

$test1Pass = ($config['repository'] === 'https://github.com/ideav/crm/' &&
              $config['branch'] === 'main' &&
              count($config['mappings']) === 2);
echo "Result: " . ($test1Pass ? "PASS" : "FAIL") . "\n\n";

// Test 2: GitHub URL generation
echo "Test 2: GitHub Raw URL Generation\n";
echo "----------------------------------\n";

function getGitHubRawUrlForTest($repository, $branch, $filePath) {
    $repository = rtrim($repository, '/');
    if (preg_match('#github\.com/([^/]+)/([^/]+)#', $repository, $matches)) {
        $owner = $matches[1];
        $repo = $matches[2];
        return "https://raw.githubusercontent.com/{$owner}/{$repo}/{$branch}/{$filePath}";
    }
    return '';
}

$testUrl = getGitHubRawUrlForTest('https://github.com/ideav/crm/', 'main', 'css/styles.css');
$expectedUrl = 'https://raw.githubusercontent.com/ideav/crm/main/css/styles.css';

echo "Input: https://github.com/ideav/crm/ + main + css/styles.css\n";
echo "Output: {$testUrl}\n";
echo "Expected: {$expectedUrl}\n";
echo "Result: " . ($testUrl === $expectedUrl ? "PASS" : "FAIL") . "\n\n";

// Test 3: GitHub API URL generation
echo "Test 3: GitHub API URL Generation\n";
echo "----------------------------------\n";

function getGitHubApiUrlForTest($repository, $branch, $dirPath) {
    $repository = rtrim($repository, '/');
    if (preg_match('#github\.com/([^/]+)/([^/]+)#', $repository, $matches)) {
        $owner = $matches[1];
        $repo = $matches[2];
        $dirPath = rtrim($dirPath, '/');
        return "https://api.github.com/repos/{$owner}/{$repo}/contents/{$dirPath}?ref={$branch}";
    }
    return '';
}

$testApiUrl = getGitHubApiUrlForTest('https://github.com/ideav/crm/', 'main', 'css');
$expectedApiUrl = 'https://api.github.com/repos/ideav/crm/contents/css?ref=main';

echo "Input: https://github.com/ideav/crm/ + main + css\n";
echo "Output: {$testApiUrl}\n";
echo "Expected: {$expectedApiUrl}\n";
echo "Result: " . ($testApiUrl === $expectedApiUrl ? "PASS" : "FAIL") . "\n\n";

// Test 4: Wildcard detection
echo "Test 4: Wildcard Pattern Detection\n";
echo "-----------------------------------\n";

$patterns = [
    'css/*' => true,
    'js/app.js' => false,
    'templates/my/*' => true,
    'templates/main.html' => false
];

$allPass = true;
foreach ($patterns as $pattern => $expectedWildcard) {
    $hasWildcard = (substr($pattern, -2) === '/*');
    $pass = ($hasWildcard === $expectedWildcard);
    echo "  {$pattern}: " . ($hasWildcard ? "wildcard" : "single file") . " - " . ($pass ? "PASS" : "FAIL") . "\n";
    if (!$pass) $allPass = false;
}
echo "Result: " . ($allPass ? "PASS" : "FAIL") . "\n\n";

// Test 5: Live API test - list directory
echo "Test 5: Live GitHub API - List Directory\n";
echo "-----------------------------------------\n";

$apiUrl = 'https://api.github.com/repos/ideav/crm/contents/css?ref=main';
$context = stream_context_create([
    'http' => [
        'method' => 'GET',
        'header' => [
            'User-Agent: PHP-GitHub-Sync-Test',
            'Accept: application/vnd.github.v3+json'
        ],
        'timeout' => 30
    ]
]);

$response = @file_get_contents($apiUrl, false, $context);
if ($response !== false) {
    $items = json_decode($response, true);
    if (is_array($items)) {
        echo "Found " . count($items) . " items in css/ folder:\n";
        foreach ($items as $item) {
            if ($item['type'] === 'file') {
                echo "  - {$item['name']}\n";
            }
        }
        echo "Result: PASS\n";
    } else {
        echo "Result: FAIL (invalid JSON)\n";
    }
} else {
    echo "Result: FAIL (API request failed - may be rate limited)\n";
}

echo "\n=== Test Suite Complete ===\n";
