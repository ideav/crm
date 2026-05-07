<?php
/**
 * Tests for update.php error message formatting.
 *
 * Verifies that HTTP 0 download/API failures surface the underlying cURL
 * error message and the URL, so users can diagnose the issue instead of
 * seeing a bare "Download failed (HTTP 0): ..." line.
 *
 * Run from repo root:  php experiments/sync-test/test-error-messages.php
 */

// Stub out request handling so we can include update.php without it running
// the main flow.
$_GET = [];

// update.php exits when no ?config=... is given. We bypass the main path by
// pre-defining a sentinel and short-circuiting via a custom error handler.
$updatePhp = __DIR__ . '/../../update.php';

// Capture and strip the main-block side effects by extracting just the
// function definitions. Simpler: include in a sandbox that suppresses exit.
ob_start();
// We have to run main(): replace exit(1) before include. But the main block
// only executes if config param is missing → it prints + exit(1). Catch it.
try {
    // Intentionally don't set $_GET['config'] so main exits early; we don't
    // care about its output, only the function definitions that get loaded.
    register_shutdown_function(function () {});
    // exit() during include is unrecoverable; instead, parse out functions.
    $src = file_get_contents($updatePhp);
    // Trim everything after "// ------------------------ Main".
    $cut = strpos($src, '// ------------------------ Main');
    $src = substr($src, 0, $cut);
    eval('?>' . $src);
} finally {
    ob_end_clean();
}

$failures = 0;
$tests = 0;

function check($label, $cond) {
    global $failures, $tests;
    $tests++;
    if ($cond) {
        echo "  PASS  {$label}\n";
    } else {
        echo "  FAIL  {$label}\n";
        $failures++;
    }
}

echo "=== formatDownloadError ===\n";

$info = ['owner' => 'ideav', 'repo' => 'crm'];
$task = ['source' => 'css/dash.css', 'target' => '/srv/www/css/dash.css', 'sha' => 'abc'];

// HTTP 0 with cURL error
$msg = formatDownloadError(
    ['ok' => false, 'http_code' => 0, 'error' => 'Could not resolve host: raw.githubusercontent.com', 'task' => $task],
    $info, 'main'
);
check('HTTP 0 includes cURL error', strpos($msg, 'Could not resolve host') !== false);
check('HTTP 0 includes URL hint', strpos($msg, 'raw.githubusercontent.com/ideav/crm/main/css/dash.css') !== false);
check('HTTP 0 prefix preserved', strpos($msg, 'Download failed (HTTP 0): css/dash.css') === 0);

// HTTP 0 with no cURL error (defensive default)
$msg = formatDownloadError(
    ['ok' => false, 'http_code' => 0, 'error' => '', 'task' => $task],
    $info, 'main'
);
check('HTTP 0 + empty error has fallback hint', strpos($msg, 'no response from server') !== false);

// http_code === null behaves like 0
$msg = formatDownloadError(
    ['ok' => false, 'http_code' => null, 'error' => 'SSL connect error', 'task' => $task],
    $info, 'main'
);
check('null http_code treated as 0', strpos($msg, 'HTTP 0') !== false && strpos($msg, 'SSL connect error') !== false);

// HTTP 404 explains check the path/branch
$msg = formatDownloadError(
    ['ok' => false, 'http_code' => 404, 'error' => '', 'task' => $task],
    $info, 'main'
);
check('HTTP 404 explains path/branch', strpos($msg, 'not found') !== false && strpos($msg, 'update.conf') !== false);

// HTTP 403 mentions rate limit / token
$msg = formatDownloadError(
    ['ok' => false, 'http_code' => 403, 'error' => '', 'task' => $task],
    $info, 'main'
);
check('HTTP 403 mentions rate limit/token', strpos($msg, 'rate limit') !== false || strpos($msg, 'token') !== false);

// HTTP 401 mentions invalid token
$msg = formatDownloadError(
    ['ok' => false, 'http_code' => 401, 'error' => '', 'task' => $task],
    $info, 'main'
);
check('HTTP 401 mentions invalid token', strpos($msg, 'unauthorized') !== false || strpos($msg, 'token') !== false);

echo "\n=== describeApiFailure ===\n";

$url = 'https://api.github.com/repos/ideav/crm/commits/main';
$msg = describeApiFailure("HEAD commit for branch 'main'", $url, ['body' => false, 'http_code' => null, 'error' => 'Operation timed out']);
check('API HTTP 0 includes timeout error', strpos($msg, 'Operation timed out') !== false && strpos($msg, 'HTTP 0') !== false);
check('API failure includes url', strpos($msg, $url) !== false);

$msg = describeApiFailure('repository tree', $url, ['body' => '...', 'http_code' => 404, 'error' => null]);
check('API HTTP 404 explains repo/branch', strpos($msg, 'not found') !== false);

echo "\n";
if ($failures === 0) {
    echo "All {$tests} tests passed.\n";
    exit(0);
}
echo "{$failures} of {$tests} tests failed.\n";
exit(1);
