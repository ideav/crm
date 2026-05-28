<?php
/**
 * GitHub Repository File Synchronization Script
 *
 * Speed strategy:
 *   1. One GitHub API call to fetch the HEAD commit. If its SHA matches the
 *      cached one (and ignore_cache is off), exit early — no downloads.
 *   2. Otherwise, one tree call returns every blob SHA in the repository.
 *   3. Compare blob SHAs against the manifest; download only the changed
 *      files in parallel via curl_multi.
 *
 * All hashes (last-synced commit SHA + per-file blob SHAs keyed by absolute
 * target path) live in a single update.cache.json next to this script.
 * Legacy .sha sidecar files are no longer used; pass ?cleanup_legacy_sha=1
 * once to remove the orphans.
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);
header('Content-Type: text/html; charset=utf-8');

define('MANIFEST_VERSION', 1);
define('MANIFEST_NAME', 'update.cache.json');
define('LOCK_NAME', 'update.lock');
define('PARALLEL', 8);
define('HTTP_TIMEOUT', 60);
define('TOKEN_PLACEHOLDER', 'your-github-personal-access-token-here');

// ------------------------ HTTP ------------------------

function ghHeaders($token) {
    $h = ['User-Agent: PHP-GitHub-Sync-Script', 'Accept: application/vnd.github.v3+json'];
    if (!empty($token) && $token !== TOKEN_PLACEHOLDER) {
        $h[] = "Authorization: Bearer {$token}";
    }
    return $h;
}

function rawHeaders($token) {
    $h = ['User-Agent: PHP-GitHub-Sync-Script'];
    if (!empty($token) && $token !== TOKEN_PLACEHOLDER) {
        $h[] = "Authorization: Bearer {$token}";
    }
    return $h;
}

function httpGet($url, $headers, $timeout) {
    if (!function_exists('curl_init')) {
        return ['body' => false, 'http_code' => null, 'error' => 'cURL extension required'];
    }
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_USERAGENT      => 'PHP-GitHub-Sync-Script',
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($body === false) return ['body' => false, 'http_code' => null, 'error' => "cURL: {$err}"];
    return ['body' => $body, 'http_code' => $code, 'error' => null];
}

// ------------------------ GitHub helpers ------------------------

function parseRepo($repository) {
    $repository = rtrim($repository, '/');
    if (preg_match('#github\.com/([^/]+)/([^/]+)#', $repository, $m)) {
        return ['owner' => $m[1], 'repo' => $m[2]];
    }
    return null;
}

function urlBranch($branch) {
    return str_replace('%2F', '/', rawurlencode($branch));
}

function urlPath($path) {
    return str_replace('%2F', '/', rawurlencode($path));
}

function describeApiFailure($what, $url, $r) {
    $code = $r['http_code'] === null ? 0 : (int) $r['http_code'];
    $msg = "Failed to fetch {$what} (HTTP {$code})";
    if ($code === 0) {
        $err = isset($r['error']) ? trim((string) $r['error']) : '';
        if ($err === '') $err = 'no response from server (network / DNS / TLS / timeout)';
        $msg .= " — {$err}";
    } elseif ($code === 404) {
        $msg .= ' — not found (check repository and branch in update.conf)';
    } elseif ($code === 401) {
        $msg .= ' — unauthorized (invalid token in update.conf)';
    } elseif ($code === 403) {
        $msg .= ' — forbidden (rate limit, or token lacks access)';
    }
    $msg .= " [url: {$url}]";
    return $msg;
}

function ghCommit($info, $branch, $token) {
    $url = "https://api.github.com/repos/{$info['owner']}/{$info['repo']}/commits/" . urlBranch($branch);
    $r = httpGet($url, ghHeaders($token), 30);
    if ($r['body'] === false || $r['http_code'] !== 200) {
        return ['error' => describeApiFailure("HEAD commit for branch '{$branch}'", $url, $r)];
    }
    $j = json_decode($r['body'], true);
    if (!isset($j['sha'], $j['commit']['tree']['sha'])) {
        return ['error' => "Failed to parse commit response for branch '{$branch}' [url: {$url}]"];
    }
    return ['commit_sha' => $j['sha'], 'tree_sha' => $j['commit']['tree']['sha']];
}

function ghTree($info, $treeSha, $token) {
    $url = "https://api.github.com/repos/{$info['owner']}/{$info['repo']}/git/trees/{$treeSha}?recursive=1";
    $r = httpGet($url, ghHeaders($token), HTTP_TIMEOUT);
    if ($r['body'] === false || $r['http_code'] !== 200) {
        return ['error' => describeApiFailure('repository tree', $url, $r)];
    }
    $j = json_decode($r['body'], true);
    if (!isset($j['tree'])) {
        return ['error' => "Failed to parse tree response [url: {$url}]"];
    }
    $files = [];
    foreach ($j['tree'] as $item) {
        if (isset($item['type'], $item['path'], $item['sha']) && $item['type'] === 'blob') {
            $files[$item['path']] = $item['sha'];
        }
    }
    return ['files' => $files, 'truncated' => !empty($j['truncated'])];
}

function rawUrl($info, $branch, $path) {
    return 'https://raw.githubusercontent.com/' . $info['owner'] . '/' . $info['repo']
        . '/' . urlBranch($branch) . '/' . urlPath($path);
}

// ------------------------ Parallel download ------------------------

function downloadParallel($tasks, $info, $branch, $token, $concurrency) {
    if (empty($tasks)) return [];

    if (!function_exists('curl_multi_init')) {
        $out = [];
        foreach ($tasks as $i => $t) {
            $r = httpGet(rawUrl($info, $branch, $t['source']), rawHeaders($token), HTTP_TIMEOUT);
            $out[$i] = [
                'ok'        => $r['body'] !== false && $r['http_code'] === 200,
                'content'   => $r['body'],
                'http_code' => $r['http_code'],
                'error'     => $r['error'],
                'task'      => $t,
            ];
        }
        return $out;
    }

    $headers = rawHeaders($token);
    $mh = curl_multi_init();
    $handles = [];
    $results = [];
    $next = 0;
    $count = count($tasks);

    $start = function ($idx) use (&$handles, &$tasks, $info, $branch, $headers, $mh) {
        $t = $tasks[$idx];
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => rawUrl($info, $branch, $t['source']),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => HTTP_TIMEOUT,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_USERAGENT      => 'PHP-GitHub-Sync-Script',
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[(int)$ch] = ['idx' => $idx, 'ch' => $ch];
    };

    while ($next < $count && count($handles) < $concurrency) {
        $start($next++);
    }

    $running = 0;
    do {
        do { $mrc = curl_multi_exec($mh, $running); } while ($mrc === CURLM_CALL_MULTI_PERFORM);
        if ($running > 0 && curl_multi_select($mh, 1.0) === -1) usleep(50000);
        while ($info_done = curl_multi_info_read($mh)) {
            $ch = $info_done['handle'];
            $key = (int)$ch;
            if (!isset($handles[$key])) continue;
            $idx = $handles[$key]['idx'];
            $body = curl_multi_getcontent($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err  = curl_error($ch);
            $results[$idx] = [
                'ok'        => $body !== false && $body !== null && $code === 200 && $info_done['result'] === CURLE_OK,
                'content'   => $body,
                'http_code' => $code,
                'error'     => $err,
                'task'      => $tasks[$idx],
            ];
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
            unset($handles[$key]);
            if ($next < $count) $start($next++);
        }
    } while ($running > 0 || $next < $count || !empty($handles));

    curl_multi_close($mh);
    ksort($results);
    return $results;
}

// ------------------------ Config / Manifest ------------------------

function defaultConfigRepository() {
    return ['repository' => '', 'branch' => 'main', 'token' => '', 'ignore_cache' => false, 'mappings' => []];
}

function normalizeConfigRepositories($repositories) {
    $out = [];
    foreach ($repositories as $idx => $repoConfig) {
        $name = isset($repoConfig['name']) && $repoConfig['name'] !== '' ? $repoConfig['name'] : "repo" . ($idx + 1);
        $repoConfig['name'] = $name;
        $out[] = $repoConfig;
    }
    return $out;
}

function parseConfig($path) {
    if (!file_exists($path)) return false;
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) return false;

    $cfg = defaultConfigRepository();
    $repositories = [];
    $current = $cfg;
    $currentHasContent = false;
    $hasSections = false;
    $repoCounter = 0;

    $flushCurrent = function () use (&$repositories, &$current, &$currentHasContent, &$repoCounter) {
        if (!$currentHasContent) return;
        $repoCounter++;
        if (!isset($current['name']) || $current['name'] === '') {
            $info = parseRepo($current['repository']);
            $current['name'] = $info ? $info['owner'] . '/' . $info['repo'] : "repo{$repoCounter}";
        }
        $repositories[] = $current;
    };

    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;

        if (preg_match('/^\[repository\s+(.+)\]$/i', $line, $m) || preg_match('/^\[repo\s+(.+)\]$/i', $line, $m)) {
            $hasSections = true;
            $flushCurrent();
            $current = defaultConfigRepository();
            $current['name'] = trim($m[1]);
            $currentHasContent = true;
        } elseif (preg_match('/^repository\s*:\s*(.+)$/i', $line, $m)) {
            if ($currentHasContent && $current['repository'] !== '') {
                $flushCurrent();
                $current = defaultConfigRepository();
            }
            $current['repository'] = trim($m[1]);
            $currentHasContent = true;
        } elseif (preg_match('/^branch\s*:\s*(.+)$/i', $line, $m)) {
            $current['branch'] = trim($m[1]);
            $currentHasContent = true;
        } elseif (preg_match('/^token\s*:\s*(.+)$/i', $line, $m)) {
            $current['token'] = trim($m[1]);
            $currentHasContent = true;
        } elseif (preg_match('/^ignore_cache\s*:\s*(.+)$/i', $line, $m)) {
            $v = strtolower(trim($m[1]));
            $current['ignore_cache'] = ($v === '1' || $v === 'true' || $v === 'yes');
            $currentHasContent = true;
        } elseif (strpos($line, ':') !== false) {
            $parts = explode(':', $line, 2);
            $src = trim($parts[0]);
            $tgt = trim($parts[1]);
            if ($src !== '' && $tgt !== '') {
                $current['mappings'][] = ['source' => $src, 'target' => $tgt];
                $currentHasContent = true;
            }
        }
    }
    $flushCurrent();

    if ($hasSections && !empty($repositories)) {
        $cfg = $repositories[0];
        $cfg['repositories'] = normalizeConfigRepositories($repositories);
    } elseif (!empty($repositories)) {
        $cfg = $repositories[0];
    }
    return $cfg;
}

function manifestPath() {
    return __DIR__ . '/' . MANIFEST_NAME;
}

function loadManifest() {
    $path = manifestPath();
    if (!file_exists($path)) return ['version' => MANIFEST_VERSION, 'configs' => []];
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') return ['version' => MANIFEST_VERSION, 'configs' => []];
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data['configs']) || !is_array($data['configs'])) {
        return ['version' => MANIFEST_VERSION, 'configs' => []];
    }
    $data['version'] = MANIFEST_VERSION;
    return $data;
}

function saveManifest($manifest) {
    $manifest['updated_at'] = date('c');
    $path = manifestPath();
    $tmp = $path . '.tmp.' . getmypid();
    $json = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false) return false;
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) return false;
    if (!@rename($tmp, $path)) { @unlink($tmp); return false; }
    return true;
}

// ------------------------ Sync ------------------------

function expandMappings($mappings, $remoteFiles) {
    $tasks = [];
    foreach ($mappings as $m) {
        $src = $m['source'];
        $tgt = rtrim($m['target'], '/');
        if (substr($src, -2) === '/*') {
            // dir/* matches only direct children of <dir>, not nested files.
            // E.g. js/* takes js/dash.js but not js/utils/foo.js.
            $dir = rtrim(substr($src, 0, -2), '/');
            foreach ($remoteFiles as $path => $sha) {
                if (dirname($path) === $dir) {
                    $tasks[] = ['source' => $path, 'target' => $tgt . '/' . basename($path), 'sha' => $sha];
                }
            }
        } else {
            if (isset($remoteFiles[$src])) {
                $tasks[] = ['source' => $src, 'target' => $tgt . '/' . basename($src), 'sha' => $remoteFiles[$src]];
            } else {
                $tasks[] = ['source' => $src, 'target' => $tgt . '/' . basename($src), 'sha' => null, 'missing' => true];
            }
        }
    }
    return $tasks;
}

function ensureDir($dir) {
    return is_dir($dir) || @mkdir($dir, 0755, true);
}

function formatDownloadError($d, $info, $branch) {
    $t = $d['task'];
    $code = $d['http_code'] === null ? 0 : (int) $d['http_code'];
    $url = rawUrl($info, $branch, $t['source']);
    $msg = "Download failed (HTTP {$code}): {$t['source']}";

    // HTTP 0 means cURL never received an HTTP response: DNS, TCP, TLS, or
    // timeout failure. Surface the cURL error so the user can act on it
    // instead of guessing.
    if ($code === 0) {
        $err = isset($d['error']) ? trim((string) $d['error']) : '';
        if ($err === '') $err = 'no response from server (network / DNS / TLS / timeout)';
        $msg .= " — {$err}";
        $msg .= " [url: {$url}]";
    } elseif ($code === 404) {
        $msg .= " — file not found on branch '{$branch}' (check path and branch in update.conf)";
    } elseif ($code === 403) {
        $msg .= " — forbidden (rate limit or token without access; check 'token' in update.conf)";
    } elseif ($code === 401) {
        $msg .= " — unauthorized (invalid 'token' in update.conf)";
    }

    return $msg;
}

function syncWithCache($config, $configName) {
    $results = ['fast_path' => false, 'success' => [], 'skipped' => [], 'errors' => [], 'cleaned' => 0];

    $info = parseRepo($config['repository']);
    if (!$info) {
        $results['errors'][] = "Invalid repository URL: {$config['repository']}";
        return $results;
    }

    $manifest = loadManifest();
    $configEntry = isset($manifest['configs'][$configName]) ? $manifest['configs'][$configName] : ['commit_sha' => null, 'files' => []];
    if (!isset($configEntry['files']) || !is_array($configEntry['files'])) $configEntry['files'] = [];

    $head = ghCommit($info, $config['branch'], $config['token']);
    if (isset($head['error'])) {
        $results['errors'][] = $head['error'];
        return $results;
    }
    $results['commit'] = $head['commit_sha'];

    if (!$config['ignore_cache'] && isset($configEntry['commit_sha']) && $configEntry['commit_sha'] === $head['commit_sha']) {
        $results['fast_path'] = true;
        return $results;
    }

    $tree = ghTree($info, $head['tree_sha'], $config['token']);
    if (isset($tree['error'])) {
        $results['errors'][] = $tree['error'];
        return $results;
    }
    if ($tree['truncated']) {
        $results['errors'][] = "Repository tree was truncated by GitHub (>100k entries) — partial sync";
    }

    $tasks = expandMappings($config['mappings'], $tree['files']);
    foreach ($tasks as $t) {
        if (!empty($t['missing'])) $results['errors'][] = "File not found in repository: {$t['source']}";
    }
    $tasks = array_values(array_filter($tasks, function ($t) { return empty($t['missing']); }));

    $todo = [];
    foreach ($tasks as $t) {
        $cached = isset($configEntry['files'][$t['target']]) ? $configEntry['files'][$t['target']] : null;
        $exists = is_file($t['target']);
        if ($config['ignore_cache'] || !$exists || $cached !== $t['sha']) {
            $todo[] = $t;
        } else {
            $results['skipped'][] = "Unchanged: {$t['source']} -> {$t['target']}";
        }
    }

    $downloads = downloadParallel($todo, $info, $config['branch'], $config['token'], PARALLEL);

    foreach ($downloads as $d) {
        $t = $d['task'];
        if (!$d['ok']) {
            $results['errors'][] = formatDownloadError($d, $info, $config['branch']);
            continue;
        }
        if (!ensureDir(dirname($t['target']))) {
            $results['errors'][] = "Failed to create directory: " . dirname($t['target']);
            continue;
        }
        $tmp = $t['target'] . '.tmp.' . getmypid();
        if (@file_put_contents($tmp, $d['content']) === false) {
            $results['errors'][] = "Failed to write: {$t['target']}";
            continue;
        }
        if (!@rename($tmp, $t['target'])) {
            @unlink($tmp);
            $results['errors'][] = "Failed to rename into place: {$t['target']}";
            continue;
        }
        $configEntry['files'][$t['target']] = $t['sha'];
        $tag = $config['ignore_cache'] ? 'FORCED' : 'UPDATED';
        $results['success'][] = "{$tag}: {$t['source']} -> {$t['target']}";
    }

    $kept = [];
    foreach ($tasks as $t) $kept[$t['target']] = true;
    $configEntry['files'] = array_intersect_key($configEntry['files'], $kept);
    // Only advance the cached commit SHA when every pending download succeeded.
    // If any download failed the next run must retry rather than fast-pathing.
    if (empty($results['errors'])) {
        $configEntry['commit_sha'] = $head['commit_sha'];
    }
    $configEntry['updated_at'] = date('c');
    $manifest['configs'][$configName] = $configEntry;

    if (!saveManifest($manifest)) {
        $results['errors'][] = "Failed to write manifest: " . manifestPath();
    }

    if (!empty($_GET['cleanup_legacy_sha'])) {
        foreach ($configEntry['files'] as $target => $_) {
            $shaFile = $target . '.sha';
            if (is_file($shaFile) && @unlink($shaFile)) $results['cleaned']++;
        }
    }

    return $results;
}

function syncConfig($config, $configName) {
    if (empty($config['repositories']) || !is_array($config['repositories'])) {
        return syncWithCache($config, $configName);
    }

    $combined = ['fast_path' => true, 'success' => [], 'skipped' => [], 'errors' => [], 'cleaned' => 0, 'repositories' => []];
    foreach ($config['repositories'] as $repoConfig) {
        $repoName = isset($repoConfig['name']) ? $repoConfig['name'] : $repoConfig['repository'];
        $result = syncWithCache($repoConfig, $configName . ':' . $repoName);
        $combined['repositories'][$repoName] = $result;
        $combined['fast_path'] = $combined['fast_path'] && !empty($result['fast_path']);
        foreach (['success', 'skipped', 'errors'] as $key) {
            foreach ($result[$key] as $msg) {
                $combined[$key][] = "[{$repoName}] {$msg}";
            }
        }
        if (!empty($result['cleaned'])) $combined['cleaned'] += $result['cleaned'];
    }
    return $combined;
}

// ------------------------ Output ------------------------

function outputResults($results, $config, $configName, $elapsedMs) {
    $css = '<style>'
        . 'body{font-family:Arial,sans-serif;margin:20px;background:#f5f5f5}'
        . '.container{max-width:900px;margin:0 auto;background:#fff;padding:20px;border-radius:8px}'
        . 'h1{color:#333;border-bottom:2px solid #4CAF50;padding-bottom:10px}'
        . 'h2{font-size:1rem;margin-top:1.5rem}'
        . '.success{color:#2e7d32}.skipped{color:#1565c0}.error{color:#c62828}'
        . 'ul{list-style:none;padding:0}'
        . 'li{padding:8px 12px;margin:4px 0;border-radius:4px;font-family:monospace;font-size:13px}'
        . '.success li{background:#e8f5e9}.skipped li{background:#e3f2fd}.error li{background:#ffebee}'
        . '.summary{background:#f0f0f0;padding:15px;border-radius:4px;margin-top:20px}'
        . '.summary span{margin-right:20px}'
        . '.fastpath{background:#fff8e1;border:1px solid #ffe082;padding:10px 14px;border-radius:4px;margin-bottom:16px}'
        . '.meta{font-family:monospace;font-size:12px;color:#666;margin:6px 0 16px}'
        . '</style>';

    echo "<!DOCTYPE html><html lang='ru'><head><meta charset='UTF-8'><title>GitHub Sync Results</title>{$css}</head><body><div class='container'>";
    echo "<h1>GitHub Sync Results</h1>";
    echo "<div class='meta'>config: " . htmlspecialchars($configName)
        . " &middot; branch: " . htmlspecialchars(isset($config['branch']) ? $config['branch'] : 'multiple')
        . " &middot; commit: " . htmlspecialchars(isset($results['commit']) ? substr($results['commit'], 0, 7) : (isset($results['repositories']) ? 'multiple' : '?'))
        . " &middot; elapsed: {$elapsedMs} ms</div>";

    if (!empty($results['fast_path'])) {
        echo "<div class='fastpath'><strong>Up to date.</strong> HEAD не двигался — скачивать нечего.</div>";
    }

    echo "<div class='summary'>";
    echo "<span class='success'><strong>Copied:</strong> " . count($results['success']) . "</span>";
    echo "<span class='skipped'><strong>Skipped:</strong> " . count($results['skipped']) . "</span>";
    echo "<span class='error'><strong>Errors:</strong> " . count($results['errors']) . "</span>";
    if (!empty($results['cleaned'])) {
        echo "<span><strong>Legacy .sha removed:</strong> " . (int)$results['cleaned'] . "</span>";
    }
    echo "</div>";

    foreach (['success' => 'Copied', 'skipped' => 'Skipped', 'errors' => 'Errors'] as $k => $title) {
        if (!empty($results[$k])) {
            echo "<div class='{$k}'><h2>{$title}</h2><ul>";
            foreach ($results[$k] as $msg) echo "<li>" . htmlspecialchars($msg) . "</li>";
            echo "</ul></div>";
        }
    }
    echo "<p style='color:#888;margin-top:20px'>Completed at: " . date('Y-m-d H:i:s') . "</p></div></body></html>";
}

// ------------------------ Main ------------------------

if (!defined('UPDATE_PHP_NO_MAIN')) {
    $configFile = isset($_GET['config']) ? basename($_GET['config']) : '';
    if ($configFile === '') {
        echo "<h1>Error</h1><p>Usage: update.php?config=your-config.conf [&cleanup_legacy_sha=1]</p>";
        exit(1);
    }

    $configPath = __DIR__ . '/' . $configFile;
    $config = parseConfig($configPath);
    if ($config === false) {
        echo "<h1>Error</h1><p>Could not read config file: " . htmlspecialchars($configFile) . "</p>";
        exit(1);
    }

    $lockPath = __DIR__ . '/' . LOCK_NAME;
    $lockFp = @fopen($lockPath, 'c');
    if ($lockFp && !flock($lockFp, LOCK_EX | LOCK_NB)) {
        fclose($lockFp);
        echo "<h1>Busy</h1><p>Another sync is already running. Try again in a moment.</p>";
        exit(1);
    }

    $start = microtime(true);
    $results = syncConfig($config, $configFile);
    $elapsedMs = (int) round((microtime(true) - $start) * 1000);

    if ($lockFp) {
        flock($lockFp, LOCK_UN);
        fclose($lockFp);
    }

    outputResults($results, $config, $configFile, $elapsedMs);
}
