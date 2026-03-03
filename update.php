<?php
/**
 * GitHub Repository File Synchronization Script
 *
 * This script copies files from a GitHub repository to local folders on the hosting server.
 * Configuration is loaded from a .conf file specified via GET parameter.
 *
 * Usage: update.php?config=update.conf
 *
 * Features:
 * - Supports wildcard (*) for copying all files in a folder
 * - Only copies files that are newer than the local version
 * - Preserves original filenames
 * - Updates modification time on copy
 */

// Error reporting for debugging (can be disabled in production)
error_reporting(E_ALL);
ini_set('display_errors', 1);

/**
 * Parse the configuration file
 *
 * Configuration format:
 * repository: https://github.com/owner/repo/
 * branch: main
 * source_path : target_path
 *
 * @param string $configPath Path to the configuration file
 * @return array|false Parsed configuration or false on error
 */
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
        'mappings' => []
    ];

    foreach ($lines as $line) {
        $line = trim($line);

        // Skip comments
        if (empty($line) || $line[0] === '#') {
            continue;
        }

        // Parse repository setting
        if (preg_match('/^repository\s*:\s*(.+)$/i', $line, $matches)) {
            $config['repository'] = trim($matches[1]);
            continue;
        }

        // Parse branch setting
        if (preg_match('/^branch\s*:\s*(.+)$/i', $line, $matches)) {
            $config['branch'] = trim($matches[1]);
            continue;
        }

        // Parse file mappings (source : target)
        if (strpos($line, ':') !== false) {
            // Split by first colon only (to handle Windows paths)
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

/**
 * Get the raw GitHub URL for a file
 *
 * @param string $repository Repository URL (e.g., https://github.com/owner/repo/)
 * @param string $branch Branch name
 * @param string $filePath Path to file in repository
 * @return string Raw content URL
 */
function getGitHubRawUrl($repository, $branch, $filePath) {
    // Extract owner and repo from GitHub URL
    $repository = rtrim($repository, '/');
    if (preg_match('#github\.com/([^/]+)/([^/]+)#', $repository, $matches)) {
        $owner = $matches[1];
        $repo = $matches[2];
        return "https://raw.githubusercontent.com/{$owner}/{$repo}/{$branch}/{$filePath}";
    }
    return '';
}

/**
 * Get the GitHub API URL for listing directory contents
 *
 * @param string $repository Repository URL
 * @param string $branch Branch name
 * @param string $dirPath Directory path in repository
 * @return string API URL
 */
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

/**
 * Get file modification time from GitHub API
 *
 * @param string $repository Repository URL
 * @param string $branch Branch name
 * @param string $filePath File path in repository
 * @return int|false Unix timestamp or false on error
 */
function getGitHubFileModTime($repository, $branch, $filePath) {
    $repository = rtrim($repository, '/');
    if (preg_match('#github\.com/([^/]+)/([^/]+)#', $repository, $matches)) {
        $owner = $matches[1];
        $repo = $matches[2];

        // Use commits API to get the last commit date for this file
        $apiUrl = "https://api.github.com/repos/{$owner}/{$repo}/commits?path={$filePath}&sha={$branch}&per_page=1";

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
            return false;
        }

        $commits = json_decode($response, true);
        if (!empty($commits) && isset($commits[0]['commit']['committer']['date'])) {
            return strtotime($commits[0]['commit']['committer']['date']);
        }
    }
    return false;
}

/**
 * List files in a GitHub directory
 *
 * @param string $repository Repository URL
 * @param string $branch Branch name
 * @param string $dirPath Directory path
 * @return array List of file names
 */
function listGitHubDirectory($repository, $branch, $dirPath) {
    $apiUrl = getGitHubApiUrl($repository, $branch, $dirPath);
    if (empty($apiUrl)) {
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
        return [];
    }

    $items = json_decode($response, true);
    if (!is_array($items)) {
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

/**
 * Download a file from GitHub
 *
 * @param string $url Raw GitHub URL
 * @return string|false File content or false on error
 */
function downloadFile($url) {
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => 'User-Agent: PHP-GitHub-Sync-Script',
            'timeout' => 60
        ]
    ]);

    return @file_get_contents($url, false, $context);
}

/**
 * Ensure target directory exists
 *
 * @param string $path Directory path
 * @return bool Success
 */
function ensureDirectory($path) {
    if (!is_dir($path)) {
        return @mkdir($path, 0755, true);
    }
    return true;
}

/**
 * Synchronize files from GitHub to local server
 *
 * @param array $config Parsed configuration
 * @return array Results of synchronization
 */
function syncFiles($config) {
    $results = [
        'success' => [],
        'skipped' => [],
        'errors' => []
    ];

    $repository = $config['repository'];
    $branch = $config['branch'];

    foreach ($config['mappings'] as $mapping) {
        $source = $mapping['source'];
        $target = $mapping['target'];

        // Check if source uses wildcard
        if (substr($source, -2) === '/*') {
            // List directory and process all files
            $dirPath = substr($source, 0, -2);
            $files = listGitHubDirectory($repository, $branch, $dirPath);

            if (empty($files)) {
                $results['errors'][] = "Could not list directory: {$dirPath}";
                continue;
            }

            foreach ($files as $fileName) {
                $result = syncSingleFile(
                    $repository,
                    $branch,
                    "{$dirPath}/{$fileName}",
                    rtrim($target, '/') . '/' . $fileName
                );

                if ($result['status'] === 'success') {
                    $results['success'][] = $result['message'];
                } elseif ($result['status'] === 'skipped') {
                    $results['skipped'][] = $result['message'];
                } else {
                    $results['errors'][] = $result['message'];
                }
            }
        } else {
            // Single file
            $fileName = basename($source);
            $targetPath = rtrim($target, '/') . '/' . $fileName;

            $result = syncSingleFile($repository, $branch, $source, $targetPath);

            if ($result['status'] === 'success') {
                $results['success'][] = $result['message'];
            } elseif ($result['status'] === 'skipped') {
                $results['skipped'][] = $result['message'];
            } else {
                $results['errors'][] = $result['message'];
            }
        }
    }

    return $results;
}

/**
 * Synchronize a single file
 *
 * @param string $repository Repository URL
 * @param string $branch Branch name
 * @param string $sourcePath Source path in repository
 * @param string $targetPath Local target path
 * @return array Result with status and message
 */
function syncSingleFile($repository, $branch, $sourcePath, $targetPath) {
    // Get GitHub file modification time
    $remoteModTime = getGitHubFileModTime($repository, $branch, $sourcePath);

    // Check local file modification time
    $localModTime = 0;
    if (file_exists($targetPath)) {
        $localModTime = filemtime($targetPath);
    }

    // Skip if local file is newer or same
    if ($remoteModTime !== false && $localModTime >= $remoteModTime) {
        return [
            'status' => 'skipped',
            'message' => "Skipped (up to date): {$sourcePath} -> {$targetPath}"
        ];
    }

    // Download file
    $rawUrl = getGitHubRawUrl($repository, $branch, $sourcePath);
    $content = downloadFile($rawUrl);

    if ($content === false) {
        return [
            'status' => 'error',
            'message' => "Failed to download: {$sourcePath}"
        ];
    }

    // Ensure target directory exists
    $targetDir = dirname($targetPath);
    if (!ensureDirectory($targetDir)) {
        return [
            'status' => 'error',
            'message' => "Failed to create directory: {$targetDir}"
        ];
    }

    // Write file
    if (@file_put_contents($targetPath, $content) === false) {
        return [
            'status' => 'error',
            'message' => "Failed to write: {$targetPath}"
        ];
    }

    // Update modification time if we know the remote time
    if ($remoteModTime !== false) {
        @touch($targetPath, $remoteModTime);
    }

    return [
        'status' => 'success',
        'message' => "Copied: {$sourcePath} -> {$targetPath}"
    ];
}

/**
 * Output results in HTML format
 *
 * @param array $results Synchronization results
 */
function outputResults($results) {
    echo "<!DOCTYPE html>\n";
    echo "<html lang='ru'>\n";
    echo "<head>\n";
    echo "  <meta charset='UTF-8'>\n";
    echo "  <meta name='viewport' content='width=device-width, initial-scale=1.0'>\n";
    echo "  <title>GitHub Sync Results</title>\n";
    echo "  <style>\n";
    echo "    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }\n";
    echo "    .container { max-width: 900px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }\n";
    echo "    h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }\n";
    echo "    .section { margin: 20px 0; }\n";
    echo "    .section h2 { margin-bottom: 10px; }\n";
    echo "    .success { color: #2e7d32; }\n";
    echo "    .skipped { color: #1565c0; }\n";
    echo "    .error { color: #c62828; }\n";
    echo "    ul { list-style-type: none; padding: 0; }\n";
    echo "    li { padding: 8px 12px; margin: 4px 0; border-radius: 4px; font-family: monospace; font-size: 13px; word-break: break-all; }\n";
    echo "    .success li { background: #e8f5e9; }\n";
    echo "    .skipped li { background: #e3f2fd; }\n";
    echo "    .error li { background: #ffebee; }\n";
    echo "    .summary { background: #f0f0f0; padding: 15px; border-radius: 4px; margin-top: 20px; }\n";
    echo "    .summary span { margin-right: 20px; }\n";
    echo "  </style>\n";
    echo "</head>\n";
    echo "<body>\n";
    echo "  <div class='container'>\n";
    echo "    <h1>GitHub Sync Results</h1>\n";

    // Summary
    $totalSuccess = count($results['success']);
    $totalSkipped = count($results['skipped']);
    $totalErrors = count($results['errors']);

    echo "    <div class='summary'>\n";
    echo "      <span class='success'><strong>Copied:</strong> {$totalSuccess}</span>\n";
    echo "      <span class='skipped'><strong>Skipped:</strong> {$totalSkipped}</span>\n";
    echo "      <span class='error'><strong>Errors:</strong> {$totalErrors}</span>\n";
    echo "    </div>\n";

    // Success
    if (!empty($results['success'])) {
        echo "    <div class='section success'>\n";
        echo "      <h2>Successfully Copied Files</h2>\n";
        echo "      <ul>\n";
        foreach ($results['success'] as $msg) {
            echo "        <li>" . htmlspecialchars($msg) . "</li>\n";
        }
        echo "      </ul>\n";
        echo "    </div>\n";
    }

    // Skipped
    if (!empty($results['skipped'])) {
        echo "    <div class='section skipped'>\n";
        echo "      <h2>Skipped Files (Up to Date)</h2>\n";
        echo "      <ul>\n";
        foreach ($results['skipped'] as $msg) {
            echo "        <li>" . htmlspecialchars($msg) . "</li>\n";
        }
        echo "      </ul>\n";
        echo "    </div>\n";
    }

    // Errors
    if (!empty($results['errors'])) {
        echo "    <div class='section error'>\n";
        echo "      <h2>Errors</h2>\n";
        echo "      <ul>\n";
        foreach ($results['errors'] as $msg) {
            echo "        <li>" . htmlspecialchars($msg) . "</li>\n";
        }
        echo "      </ul>\n";
        echo "    </div>\n";
    }

    echo "    <p style='color:#888; margin-top:20px; font-size:12px;'>Completed at: " . date('Y-m-d H:i:s') . "</p>\n";
    echo "  </div>\n";
    echo "</body>\n";
    echo "</html>\n";
}

// Main execution
header('Content-Type: text/html; charset=utf-8');

// Get config file from GET parameter
$configFile = isset($_GET['config']) ? $_GET['config'] : '';

if (empty($configFile)) {
    echo "<h1>Error</h1><p>No configuration file specified. Usage: update.php?config=your-config.conf</p>";
    exit(1);
}

// Security: only allow .conf files in the same directory
$configFile = basename($configFile);
if (!preg_match('/^[\w\-\.]+\.conf$/', $configFile)) {
    echo "<h1>Error</h1><p>Invalid configuration file name. Only alphanumeric characters, dashes, dots, and underscores are allowed. File must have .conf extension.</p>";
    exit(1);
}

$configPath = __DIR__ . '/' . $configFile;

// Parse configuration
$config = parseConfig($configPath);

if ($config === false) {
    echo "<h1>Error</h1><p>Could not read configuration file: " . htmlspecialchars($configFile) . "</p>";
    exit(1);
}

if (empty($config['repository'])) {
    echo "<h1>Error</h1><p>No repository specified in configuration.</p>";
    exit(1);
}

if (empty($config['mappings'])) {
    echo "<h1>Error</h1><p>No file mappings specified in configuration.</p>";
    exit(1);
}

// Perform synchronization
$results = syncFiles($config);

// Output results
outputResults($results);
