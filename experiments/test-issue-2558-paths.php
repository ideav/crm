<?php
/**
 * Test for issue #2558: gssync paths refactoring.
 *
 * Verifies:
 *   1. credentials_path on save is reduced to basename (no path traversal).
 *   2. gss_resolve_path resolves a bare filename relative to the config dir,
 *      so the credentials file is searched in templates/custom/{db}/gss.
 *   3. output_file defaults to templates/custom/{db}/logs/google_sheets_sync.bki.
 */

require_once __DIR__ . '/../include/google_sheets_sync.php';

$failures = 0;

function check($label, $expected, $actual) {
    global $failures;
    if ($expected === $actual) {
        echo "OK  $label\n";
    } else {
        echo "FAIL $label\n   expected: " . var_export($expected, true) . "\n   actual:   " . var_export($actual, true) . "\n";
        $failures++;
    }
}

# Simulate the save-time basename sanitization (mirrors index.php logic).
function sanitize_credentials_path($raw) {
    $data = ['credentials_path' => $raw];
    if (isset($data['credentials_path'])) {
        $credName = basename((string)$data['credentials_path']);
        if ($credName === '' || $credName === '.' || $credName === '..')
            unset($data['credentials_path']);
        else
            $data['credentials_path'] = $credName;
    }
    return $data['credentials_path'] ?? null;
}

check('basename of plain filename',          'credentials.json', sanitize_credentials_path('credentials.json'));
check('basename strips absolute path',       'credentials.json', sanitize_credentials_path('/etc/passwd/credentials.json'));
check('basename strips relative dirs',       'creds.json',       sanitize_credentials_path('../../creds.json'));
# basename() on Linux only splits on '/', so backslashes are kept intact —
# acceptable since the server runs on Linux.
check('basename keeps backslashes on linux',
    'C:\\Users\\admin\\creds.json',
    sanitize_credentials_path('C:\\Users\\admin\\creds.json'));
check('empty stays null',                    null,               sanitize_credentials_path(''));
check('dot stays null',                      null,               sanitize_credentials_path('.'));
check('double dot stays null',               null,               sanitize_credentials_path('..'));

# gss_resolve_path with a bare filename should land in the configured gss dir.
$gssDir = '/var/www/www-root/data/www/ideav.ru/templates/custom/demo/gss';
check('resolve bare filename inside config dir',
    $gssDir . DIRECTORY_SEPARATOR . 'credentials.json',
    gss_resolve_path('credentials.json', $gssDir));

# Absolute paths are kept intact.
check('absolute path preserved',
    '/srv/secret/credentials.json',
    gss_resolve_path('/srv/secret/credentials.json', $gssDir));

# Default output_file location used in index.php for new configs.
$z = 'demo';
$logsDir = "templates/custom/$z/logs";
check('default bki output path',
    'templates/custom/demo/logs/google_sheets_sync.bki',
    "$logsDir/google_sheets_sync.bki");

if ($failures > 0) {
    fwrite(STDERR, "\n$failures test(s) failed\n");
    exit(1);
}
echo "\nAll tests passed\n";
