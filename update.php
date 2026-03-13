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
 * - GitHub token support for higher API rate limits
 * - cURL fallback when allow_url_fopen is disabled
 * - Detailed error reporting for API failures
 */

// Error reporting for debugging (can be disabled in production)
error_reporting(E_ALL);
ini_set('display_errors', 1);

/**
 * Make an HTTP GET request using cURL or file_get_contents
 *
 * Uses cURL if available (preferred, works even when allow_url_fopen is disabled).
 * Falls back to file_get_contents if cURL is not available.
 *
 * @param string $url URL to fetch
 * @param array $headers HTTP headers to send
 * @param int $timeout Request timeout in seconds
 * @return array ['body' => string|false, 'http_code' => int|null, 'error' => string|null]
 */
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

    // Fallback to file_get_contents
    if (!ini_get('allow_url_fopen')) {
        return [
            'body' => false,
            'http_code' => null,
            'error' => 'Neither cURL extension nor allow_url_fopen is available. Please enable one of them in PHP configuration.'
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

/**
 * Build GitHub API request headers
 *
 * @param string $token Optional GitHub personal access token
 * @return array HTTP headers
 */
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

/**
 * Parse the configuration file
 *
 * Configuration format:
 * repository: https://github.com/owner/repo/
 * branch: main
 * token: your-github-personal-access-token (optional)
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
        'token' => '',
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

        // Parse token setting
        if (preg_match('/^token\s*:\s*(.+)$/i', $line, $matches)) {
            $config['token'] = trim($matches[1]);
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
 * @param string $token GitHub personal access token (optional)
 * @return int|false Unix timestamp or false on error
 */
function getGitHubFileModTime($repository, $branch, $filePath, $token = '') {
    $repository = rtrim($repository, '/');
    if (preg_match('#github\.com/([^/]+)/([^/]+)#', $repository, $matches)) {
        $owner = $matches[1];
        $repo = $matches[2];

        // Use commits API to get the last commit date for this file
        $apiUrl = "https://api.github.com/repos/{$owner}/{$repo}/commits?path={$filePath}&sha={$branch}&per_page=1";

        $result = httpGet($apiUrl, buildGitHubHeaders($token), 30);
        if ($result['body'] === false) {
            return false;
        }

        if ($result['http_code'] !== null && $result['http_code'] !== 200) {
            return false;
        }

        $commits = json_decode($result['body'], true);
        if (!empty($commits) && is_array($commits) && isset($commits[0]['commit']['committer']['date'])) {
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
 * @param string $token GitHub personal access token (optional)
 * @return array|string List of file names on success, error message string on failure
 */
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

    // Check for non-200 HTTP status codes
    if ($result['http_code'] !== null && $result['http_code'] !== 200) {
        // Try to extract GitHub API error message
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

    // GitHub API returns a JSON object (not array) when there's an error
    // Check for the 'message' key which indicates an API error response
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

/**
 * Download a file from GitHub
 *
 * @param string $url Raw GitHub URL
 * @param string $token GitHub personal access token (optional)
 * @return string|false File content or false on error
 */
function downloadFile($url, $token = '') {
    $headers = ['User-Agent: PHP-GitHub-Sync-Script'];
    if (!empty($token)) {
        $headers[] = "Authorization: Bearer {$token}";
    }
    $result = httpGet($url, $headers, 60);
    if ($result['body'] === false) {
        return false;
    }
    if ($result['http_code'] !== null && $result['http_code'] !== 200) {
        return false;
    }
    return $result['body'];
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
    $token = $config['token'] ?? '';

    foreach ($config['mappings'] as $mapping) {
        $source = $mapping['source'];
        $target = $mapping['target'];

        // Check if source uses wildcard
        if (substr($source, -2) === '/*') {
            // List directory and process all files
            $dirPath = substr($source, 0, -2);
            $files = listGitHubDirectory($repository, $branch, $dirPath, $token);

            if (is_string($files)) {
                // Error message returned
                $results['errors'][] = "Could not list directory: {$dirPath}. Reason: {$files}";
                continue;
            }

            if (empty($files)) {
                $results['errors'][] = "Could not list directory: {$dirPath}. Directory is empty or does not exist.";
                continue;
            }

            foreach ($files as $fileName) {
                $result = syncSingleFile(
                    $repository,
                    $branch,
                    "{$dirPath}/{$fileName}",
                    rtrim($target, '/') . '/' . $fileName,
                    $token
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

            $result = syncSingleFile($repository, $branch, $source, $targetPath, $token);

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
 * @param string $token GitHub personal access token (optional)
 * @return array Result with status and message
 */
function syncSingleFile($repository, $branch, $sourcePath, $targetPath, $token = '') {
    // Get GitHub file modification time
    $remoteModTime = getGitHubFileModTime($repository, $branch, $sourcePath, $token);

    // Check local file modification time
    $localModTime = 0;
    if (file_exists($targetPath)) {
        $localModTime = filemtime($targetPath);
    }

    // Skip if local file is newer or same
    if ($remoteModTime !== false && $localModTime >= $remoteModTime) {
        $modDateTime = date('Y-m-d H:i', $localModTime);
        return [
            'status' => 'skipped',
            'message' => "Skipped ({$modDateTime}): {$sourcePath} -> {$targetPath}"
        ];
    }

    // Download file
    $rawUrl = getGitHubRawUrl($repository, $branch, $sourcePath);
    $content = downloadFile($rawUrl, $token);

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
        echo "      <h2>Skipped Files (Already up to date)</h2>\n";
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
