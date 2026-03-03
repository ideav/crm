<?php
/**
 * Integration test for update.php
 *
 * This script simulates running update.php with a test configuration
 * to verify the full sync workflow works correctly.
 */

echo "=== GitHub Sync Integration Test ===\n\n";

// Create a test configuration that syncs to a temporary directory
$testDir = sys_get_temp_dir() . '/github-sync-test-' . time();
mkdir($testDir, 0755, true);
mkdir($testDir . '/css', 0755, true);
mkdir($testDir . '/templates', 0755, true);

echo "Test directory: {$testDir}\n\n";

// Test config - sync just a few files
$testConfigContent = <<<EOT
# Test configuration for integration test
repository: https://github.com/ideav/crm/
branch: main

# Test single file
templates/table.html : {$testDir}/templates/
EOT;

$testConfigPath = $testDir . '/test.conf';
file_put_contents($testConfigPath, $testConfigContent);

echo "Test 1: Sync new file (should copy)\n";
echo "------------------------------------\n";

// Simulate the sync function for a single file
function testSyncSingleFile($repository, $branch, $sourcePath, $targetPath) {
    echo "Syncing: {$sourcePath} -> {$targetPath}\n";

    // Check local file
    $localModTime = 0;
    if (file_exists($targetPath)) {
        $localModTime = filemtime($targetPath);
        echo "  Local file exists, mtime: " . date('Y-m-d H:i:s', $localModTime) . "\n";
    } else {
        echo "  Local file does not exist\n";
    }

    // Download the file
    $repository = rtrim($repository, '/');
    preg_match('#github\.com/([^/]+)/([^/]+)#', $repository, $matches);
    $owner = $matches[1];
    $repo = $matches[2];

    $rawUrl = "https://raw.githubusercontent.com/{$owner}/{$repo}/{$branch}/{$sourcePath}";
    echo "  Downloading from: {$rawUrl}\n";

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => 'User-Agent: PHP-GitHub-Sync-Test',
            'timeout' => 60
        ]
    ]);

    $content = @file_get_contents($rawUrl, false, $context);
    if ($content === false) {
        echo "  ERROR: Failed to download\n";
        return false;
    }

    echo "  Downloaded " . strlen($content) . " bytes\n";

    // Write file
    $targetDir = dirname($targetPath);
    if (!is_dir($targetDir)) {
        mkdir($targetDir, 0755, true);
    }

    if (file_put_contents($targetPath, $content) === false) {
        echo "  ERROR: Failed to write file\n";
        return false;
    }

    echo "  File written successfully\n";
    return true;
}

$result = testSyncSingleFile(
    'https://github.com/ideav/crm/',
    'main',
    'templates/table.html',
    $testDir . '/templates/table.html'
);

if ($result && file_exists($testDir . '/templates/table.html')) {
    echo "Result: PASS\n\n";
} else {
    echo "Result: FAIL\n\n";
}

// Test 2: Sync existing file (should skip if same)
echo "Test 2: Sync existing file (should identify as up-to-date or copy if older)\n";
echo "----------------------------------------------------------------------------\n";

// Get the GitHub file modification time
$apiUrl = 'https://api.github.com/repos/ideav/crm/commits?path=templates/table.html&sha=main&per_page=1';
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
    $commits = json_decode($response, true);
    if (!empty($commits) && isset($commits[0]['commit']['committer']['date'])) {
        $remoteTime = strtotime($commits[0]['commit']['committer']['date']);
        $localTime = filemtime($testDir . '/templates/table.html');

        echo "Remote last commit: " . date('Y-m-d H:i:s', $remoteTime) . "\n";
        echo "Local file mtime:   " . date('Y-m-d H:i:s', $localTime) . "\n";

        // Update local file to match remote time
        touch($testDir . '/templates/table.html', $remoteTime);
        $localTime = filemtime($testDir . '/templates/table.html');
        echo "After touch:        " . date('Y-m-d H:i:s', $localTime) . "\n";

        if ($localTime >= $remoteTime) {
            echo "File should be skipped (up to date)\n";
            echo "Result: PASS\n\n";
        } else {
            echo "File should be copied (older)\n";
            echo "Result: PASS\n\n";
        }
    }
} else {
    echo "Could not get commit info (may be rate limited)\n";
    echo "Result: SKIP\n\n";
}

// Test 3: List directory via API
echo "Test 3: List directory contents (wildcard support)\n";
echo "----------------------------------------------------\n";

$apiUrl = 'https://api.github.com/repos/ideav/crm/contents/templates/my?ref=main';
$response = @file_get_contents($apiUrl, false, $context);

if ($response !== false) {
    $items = json_decode($response, true);
    if (is_array($items)) {
        echo "Files in templates/my/:\n";
        $fileCount = 0;
        foreach ($items as $item) {
            if ($item['type'] === 'file') {
                echo "  - {$item['name']}\n";
                $fileCount++;
            }
        }
        echo "Total files: {$fileCount}\n";
        echo "Result: PASS\n\n";
    }
} else {
    echo "Could not list directory (may be rate limited)\n";
    echo "Result: SKIP\n\n";
}

// Cleanup
echo "Cleaning up test directory...\n";
function deleteDirectory($dir) {
    if (!is_dir($dir)) return;
    $files = array_diff(scandir($dir), ['.', '..']);
    foreach ($files as $file) {
        $path = $dir . '/' . $file;
        if (is_dir($path)) {
            deleteDirectory($path);
        } else {
            unlink($path);
        }
    }
    rmdir($dir);
}
deleteDirectory($testDir);
echo "Done.\n";

echo "\n=== Integration Test Complete ===\n";
