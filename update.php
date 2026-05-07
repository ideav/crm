<?php
/**
 * GitHub Repository File Synchronization Script - FAST VERSION
 * Uses tree API for single request instead of per-file commits API
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);
header('Content-Type: text/html; charset=utf-8');

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
        return ['body' => false, 'http_code' => null, 'error' => 'No HTTP transport available'];
    }

    $context = stream_context_create(['http' => ['method' => 'GET', 'header' => $headers, 'timeout' => $timeout]]);
    $body = @file_get_contents($url, false, $context);
    $httpCode = null;

    if (isset($http_response_header)) {
        foreach ($http_response_header as $headerLine) {
            if (preg_match('#^HTTP/\S+\s+(\d+)#', $headerLine, $m)) {
                $httpCode = (int) $m[1];
            }
        }
    }

    return ['body' => $body, 'http_code' => $httpCode, 'error' => null];
}

function buildGitHubHeaders($token = '') {
    $headers = ['User-Agent: PHP-GitHub-Sync-Script', 'Accept: application/vnd.github.v3+json'];
    if (!empty($token)) {
        $headers[] = "Authorization: Bearer {$token}";
    }
    return $headers;
}

function parseConfig($configPath) {
    if (!file_exists($configPath)) return false;

    $lines = file($configPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) return false;

    $config = [
        'repository' => '',
        'branch' => 'main',
        'token' => '',
        'ignore_cache' => false,
        'mappings' => []
    ];

    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line) || $line[0] === '#') continue;

        if (preg_match('/^repository\s*:\s*(.+)$/i', $line, $matches)) {
            $config['repository'] = trim($matches[1]);
        } elseif (preg_match('/^branch\s*:\s*(.+)$/i', $line, $matches)) {
            $config['branch'] = trim($matches[1]);
        } elseif (preg_match('/^token\s*:\s*(.+)$/i', $line, $matches)) {
            $config['token'] = trim($matches[1]);
        } elseif (preg_match('/^ignore_cache\s*:\s*(.+)$/i', $line, $matches)) {
            $value = trim($matches[1]);
            $config['ignore_cache'] = ($value == '1' || $value == 'true' || $value == 'yes');
        } elseif (strpos($line, ':') !== false) {
            $parts = explode(':', $line, 2);
            if (count($parts) === 2) {
                $source = trim($parts[0]);
                $target = trim($parts[1]);
                if (!empty($source) && !empty($target)) {
                    $config['mappings'][] = ['source' => $source, 'target' => $target];
                }
            }
        }
    }
    return $config;
}

function getGitHubRepoInfo($repository) {
    $repository = rtrim($repository, '/');
    if (preg_match('#github\.com/([^/]+)/([^/]+)#', $repository, $matches)) {
        return ['owner' => $matches[1], 'repo' => $matches[2]];
    }
    return null;
}

function getGitHubTree($repository, $branch, $token = '') {
    $info = getGitHubRepoInfo($repository);
    if (!$info) return [];

    // First get the commit SHA
    $apiUrl = "https://api.github.com/repos/{$info['owner']}/{$info['repo']}/commits/{$branch}";
    $result = httpGet($apiUrl, buildGitHubHeaders($token), 30);

    if ($result['body'] === false || $result['http_code'] !== 200) {
        return [];
    }

    $commit = json_decode($result['body'], true);
    if (!isset($commit['commit']['tree']['sha'])) {
        return [];
    }

    // Then get the full tree (recursive = 1 gets all files)
    $treeUrl = "https://api.github.com/repos/{$info['owner']}/{$info['repo']}/git/trees/{$commit['commit']['tree']['sha']}?recursive=1";
    $result = httpGet($treeUrl, buildGitHubHeaders($token), 60);

    if ($result['body'] === false || $result['http_code'] !== 200) {
        return [];
    }

    $tree = json_decode($result['body'], true);
    if (!isset($tree['tree'])) {
        return [];
    }

    // Build map of file paths to SHA
    $fileMap = [];
    foreach ($tree['tree'] as $item) {
        if ($item['type'] === 'blob') {
            $fileMap[$item['path']] = $item['sha'];
        }
    }
    return $fileMap;
}

function downloadFile($url, $token = '') {
    $headers = ['User-Agent: PHP-GitHub-Sync-Script'];
    if (!empty($token)) {
        $headers[] = "Authorization: Bearer {$token}";
    }
    $result = httpGet($url, $headers, 60);
    if ($result['body'] === false || $result['http_code'] !== 200) {
        return false;
    }
    return $result['body'];
}

function ensureDirectory($path) {
    if (!is_dir($path)) {
        return @mkdir($path, 0755, true);
    }
    return true;
}

function getLocalSha($targetPath) {
    $shaFile = $targetPath . '.sha';
    if (file_exists($shaFile)) {
        return trim(file_get_contents($shaFile));
    }
    return '';
}

function saveLocalSha($targetPath, $sha) {
    @file_put_contents($targetPath . '.sha', $sha);
}

function syncFiles($config) {
    $results = ['success' => [], 'skipped' => [], 'errors' => []];
    $info = getGitHubRepoInfo($config['repository']);
    if (!$info) {
        $results['errors'][] = "Invalid repository URL";
        return $results;
    }

    // ONE API call to get all files and their SHAs
    echo "<!-- Fetching repository tree from GitHub... -->\n";
    $fileMap = getGitHubTree($config['repository'], $config['branch'], $config['token']);
    
    if (empty($fileMap)) {
        $results['errors'][] = "Failed to get repository tree. Check branch name and token.";
        return $results;
    }
    
    $token = $config['token'] ?? '';
    $ignoreCache = $config['ignore_cache'] ?? false;

    foreach ($config['mappings'] as $mapping) {
        $source = $mapping['source'];
        $target = $mapping['target'];

        // Wildcard support
        if (substr($source, -2) === '/*') {
            $dirPath = rtrim(substr($source, 0, -2), '/');
            
            // Find all files in this directory from the tree
            foreach ($fileMap as $filePath => $sha) {
                if (dirname($filePath) === $dirPath || strpos($filePath, $dirPath . '/') === 0) {
                    $fileName = basename($filePath);
                    $targetPath = rtrim($target, '/') . '/' . $fileName;
                    
                    $result = syncSingleFileFast($config['repository'], $config['branch'], $filePath, $targetPath, $sha, $token, $ignoreCache);
                    
                    if ($result['status'] === 'success') {
                        $results['success'][] = $result['message'];
                    } elseif ($result['status'] === 'skipped') {
                        $results['skipped'][] = $result['message'];
                    } else {
                        $results['errors'][] = $result['message'];
                    }
                }
            }
        } else {
            // Single file
            $fileName = basename($source);
            $targetPath = rtrim($target, '/') . '/' . $fileName;
            
            if (isset($fileMap[$source])) {
                $result = syncSingleFileFast($config['repository'], $config['branch'], $source, $targetPath, $fileMap[$source], $token, $ignoreCache);
                
                if ($result['status'] === 'success') {
                    $results['success'][] = $result['message'];
                } elseif ($result['status'] === 'skipped') {
                    $results['skipped'][] = $result['message'];
                } else {
                    $results['errors'][] = $result['message'];
                }
            } else {
                $results['errors'][] = "File not found in repository: {$source}";
            }
        }
    }

    return $results;
}

function syncSingleFileFast($repository, $branch, $sourcePath, $targetPath, $remoteSha, $token = '', $ignoreCache = false) {
    $localSha = getLocalSha($targetPath);
    
    // If ignore_cache is enabled OR SHA different -> download
    if ($ignoreCache || $localSha !== $remoteSha) {
        $rawUrl = "https://raw.githubusercontent.com/" . 
                  getGitHubRepoInfo($repository)['owner'] . "/" . 
                  getGitHubRepoInfo($repository)['repo'] . "/{$branch}/{$sourcePath}";
        
        $content = downloadFile($rawUrl, $token);
        
        if ($content === false) {
            return ['status' => 'error', 'message' => "Failed to download: {$sourcePath}"];
        }
        
        $targetDir = dirname($targetPath);
        if (!ensureDirectory($targetDir)) {
            return ['status' => 'error', 'message' => "Failed to create directory: {$targetDir}"];
        }
        
        if (@file_put_contents($targetPath, $content) === false) {
            return ['status' => 'error', 'message' => "Failed to write: {$targetPath}"];
        }
        
        saveLocalSha($targetPath, $remoteSha);
        
        $action = $ignoreCache ? "FORCED" : "UPDATED";
        return ['status' => 'success', 'message' => "{$action}: {$sourcePath} -> {$targetPath}"];
    }
    
    return ['status' => 'skipped', 'message' => "Unchanged: {$sourcePath} -> {$targetPath}"];
}

function outputResults($results) {
    echo "<!DOCTYPE html>
<html lang='ru'>
<head>
    <meta charset='UTF-8'>
    <title>GitHub Sync Results</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 900px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; }
        h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
        .success { color: #2e7d32; }
        .skipped { color: #1565c0; }
        .error { color: #c62828; }
        ul { list-style: none; padding: 0; }
        li { padding: 8px 12px; margin: 4px 0; border-radius: 4px; font-family: monospace; font-size: 13px; }
        .success li { background: #e8f5e9; }
        .skipped li { background: #e3f2fd; }
        .error li { background: #ffebee; }
        .summary { background: #f0f0f0; padding: 15px; border-radius: 4px; margin-top: 20px; }
        .summary span { margin-right: 20px; }
    </style>
</head>
<body>
<div class='container'>
    <h1>GitHub Sync Results</h1>
    <div class='summary'>
        <span class='success'><strong>Copied:</strong> " . count($results['success']) . "</span>
        <span class='skipped'><strong>Skipped:</strong> " . count($results['skipped']) . "</span>
        <span class='error'><strong>Errors:</strong> " . count($results['errors']) . "</span>
    </div>";

    if (!empty($results['success'])) {
        echo "<div class='success'><h2>Copied</h2><ul>";
        foreach ($results['success'] as $msg) echo "<li>" . htmlspecialchars($msg) . "</li>";
        echo "</ul></div>";
    }
    if (!empty($results['skipped'])) {
        echo "<div class='skipped'><h2>Skipped</h2><ul>";
        foreach ($results['skipped'] as $msg) echo "<li>" . htmlspecialchars($msg) . "</li>";
        echo "</ul></div>";
    }
    if (!empty($results['errors'])) {
        echo "<div class='error'><h2>Errors</h2><ul>";
        foreach ($results['errors'] as $msg) echo "<li>" . htmlspecialchars($msg) . "</li>";
        echo "</ul></div>";
    }
    
    echo "<p style='color:#888; margin-top:20px;'>Completed at: " . date('Y-m-d H:i:s') . "</p>
</div>
</body>
</html>";
}

// Main execution
$configFile = isset($_GET['config']) ? $_GET['config'] : '';
if (empty($configFile)) {
    echo "<h1>Error</h1><p>Usage: update.php?config=your-config.conf</p>";
    exit(1);
}

$configFile = basename($configFile);
$configPath = __DIR__ . '/' . $configFile;
$config = parseConfig($configPath);

if ($config === false) {
    echo "<h1>Error</h1><p>Could not read config file: " . htmlspecialchars($configFile) . "</p>";
    exit(1);
}

$results = syncFiles($config);
outputResults($results);
