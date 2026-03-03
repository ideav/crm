<?php
/**
 * Test script to diagnose GitHub directory listing failures
 * Tests the listGitHubDirectory function in isolation
 */

// Reproduce the exact functions from update.php
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

function listGitHubDirectory($repository, $branch, $dirPath) {
    $apiUrl = getGitHubApiUrl($repository, $branch, $dirPath);
    echo "API URL: $apiUrl\n";

    if (empty($apiUrl)) {
        echo "ERROR: empty API URL\n";
        return [];
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => [
                'User-Agent: PHP-GitHub-Sync-Script',
                'Accept: application/vnd.github.v3+json'
            ],
            'timeout' => 30
        ]
    ]);

    $response = @file_get_contents($apiUrl, false, $context);
    if ($response === false) {
        echo "ERROR: file_get_contents returned false\n";
        // Check what error happened
        $error = error_get_last();
        echo "PHP error: " . print_r($error, true) . "\n";
        return [];
    }

    echo "Response length: " . strlen($response) . "\n";

    $items = json_decode($response, true);
    if (!is_array($items)) {
        echo "ERROR: json_decode did not return array. json_last_error: " . json_last_error() . "\n";
        echo "Response preview: " . substr($response, 0, 200) . "\n";
        return [];
    }

    $files = [];
    foreach ($items as $item) {
        if ($item['type'] === 'file') {
            $files[] = $item['name'];
        }
    }

    return $files;
}

// Test the exact configuration from update.conf
$repository = 'https://github.com/ideav/crm/';
$branch = 'main';

$directories = ['css', 'js', 'templates/my', 'templates/ru2'];

foreach ($directories as $dir) {
    echo "\n=== Testing: $dir ===\n";
    $files = listGitHubDirectory($repository, $branch, $dir);
    if (empty($files)) {
        echo "RESULT: Could not list directory: $dir\n";
    } else {
        echo "RESULT: Found " . count($files) . " files: " . implode(', ', $files) . "\n";
    }
}

// Also test what happens when allow_url_fopen is disabled
echo "\n=== PHP Config ===\n";
echo "allow_url_fopen: " . (ini_get('allow_url_fopen') ? 'enabled' : 'DISABLED') . "\n";
echo "PHP version: " . PHP_VERSION . "\n";
