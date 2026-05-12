<?php
/**
 * Test for issue #2566:
 * - gssync form must accept xsrf token next to authorization token.
 * - If integram.xsrf is not set (empty), gss_integram_tokens() should fall back
 *   to integram.token instead of throwing.
 */

require_once __DIR__ . '/../include/google_sheets_sync.php';

// 1) xsrf explicitly set — both values should be returned as-is.
$tokens = gss_integram_tokens(['token' => 'tok-1', 'xsrf' => 'xsrf-1']);
assert($tokens['token'] === 'tok-1', 'token preserved');
assert($tokens['xsrf'] === 'xsrf-1', 'xsrf preserved');

// 2) xsrf missing — must fall back to token.
$tokens = gss_integram_tokens(['token' => 'tok-2']);
assert($tokens['token'] === 'tok-2', 'token preserved when xsrf missing');
assert($tokens['xsrf'] === 'tok-2', 'xsrf falls back to token when missing');

// 3) xsrf empty string — must fall back to token.
$tokens = gss_integram_tokens(['token' => 'tok-3', 'xsrf' => '']);
assert($tokens['xsrf'] === 'tok-3', 'xsrf falls back to token when empty');

// 4) token missing — still throws (xsrf cannot pretend to be a token).
$threw = false;
try {
    gss_integram_tokens(['xsrf' => 'xsrf-only']);
} catch (RuntimeException $e) {
    $threw = true;
}
assert($threw, 'missing token must still throw');

echo "OK: gss_integram_tokens falls back to token when xsrf is empty (#2566)\n";
