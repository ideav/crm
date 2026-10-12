<?php
/**
 * Tests for the anonymous fallback on HTTP 401 (issue #5137).
 *
 * GitHub returns 401 — not anonymous access — when a request carries an
 * invalid/expired Authorization header, even for a public repository. A stale
 * token in update.conf therefore breaks prod sync entirely. update.php must
 * retry once without the credential; on a public repo the anonymous retry
 * succeeds and the stale token stops being a hard failure.
 *
 * Run from repo root:  php experiments/sync-test/test-token-fallback-5137.php
 */

// Same sandbox as test-error-messages.php: load function definitions from
// update.php without running the main flow.
$_GET = [];
$updatePhp = __DIR__ . '/../../update.php';
ob_start();
try {
    $src = file_get_contents($updatePhp);
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

echo "=== shouldRetryWithoutToken ===\n";

check('401 with a stale token → retry anonymously',
    shouldRetryWithoutToken(['body' => false, 'http_code' => 401, 'error' => null], 'ghp_stale0123456789') === true);

check('401 with a dummy token (template "token: xxx") → retry anonymously',
    shouldRetryWithoutToken(['body' => false, 'http_code' => 401, 'error' => null], 'xxx') === true);

check('401 with the placeholder token → no retry (it is never sent)',
    shouldRetryWithoutToken(['body' => false, 'http_code' => 401, 'error' => null], 'your-github-personal-access-token-here') === false);

check('401 with no token → no retry (request was already anonymous)',
    shouldRetryWithoutToken(['body' => false, 'http_code' => 401, 'error' => null], '') === false);

check('401 with null token → no retry',
    shouldRetryWithoutToken(['body' => false, 'http_code' => 401, 'error' => null], null) === false);

check('200 with a token → no retry',
    shouldRetryWithoutToken(['body' => '...', 'http_code' => 200, 'error' => null], 'ghp_stale0123456789') === false);

check('403 with a token → no retry (rate limit / permissions, not a stale credential)',
    shouldRetryWithoutToken(['body' => false, 'http_code' => 403, 'error' => null], 'ghp_stale0123456789') === false);

check('HTTP 0 (network) with a token → no retry',
    shouldRetryWithoutToken(['body' => false, 'http_code' => null, 'error' => 'timed out'], 'ghp_stale0123456789') === false);

echo "\n=== describeApiFailure 401 hint ===\n";

$url = 'https://api.github.com/repos/ideav/crm/commits/main';
$msg = describeApiFailure("HEAD commit for branch 'main'", $url, ['body' => false, 'http_code' => 401, 'error' => null]);
check('API HTTP 401 keeps the unauthorized wording',
    strpos($msg, 'unauthorized') !== false);
check('API HTTP 401 suggests removing the token for a public repo',
    stripos($msg, 'public') !== false);
check('API HTTP 401 includes url',
    strpos($msg, $url) !== false);

echo "\n";
if ($failures === 0) {
    echo "All {$tests} tests passed.\n";
    exit(0);
}
echo "{$failures} of {$tests} tests failed.\n";
exit(1);
