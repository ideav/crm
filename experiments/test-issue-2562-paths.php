<?php
/**
 * Reproduction + regression test for issue #2562.
 *
 * The gssync flow built output_file as the relative path
 *   templates/custom/{db}/logs/google_sheets_sync.bki
 * and passed it through gss_normalize_config() with baseDir
 *   /<docroot>/templates/custom/{db}/gss
 * causing gss_resolve_path() to join them and emit the duplicated
 *   /<docroot>/templates/custom/{db}/gss/templates/custom/{db}/logs/google_sheets_sync.bki
 *
 * Expected: output_file ends up as
 *   /<docroot>/templates/custom/{db}/logs/google_sheets_sync.bki
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

$docRoot = sys_get_temp_dir() . '/gss-2562-' . uniqid();
$z = 'sportzania';
$gssDir = "$docRoot/templates/custom/$z/gss";
$logsDir = "$docRoot/templates/custom/$z/logs";
mkdir($gssDir, 0775, true);
mkdir($logsDir, 0775, true);

# Reproduce the buggy behavior: index.php used to set output_file to a relative
# path under templates/custom/$z/logs, which gss_resolve_path then concatenated
# onto $gssDir.
$buggy = gss_resolve_path("templates/custom/$z/logs/google_sheets_sync.bki", $gssDir);
check('repro: relative output_file gets joined onto gss baseDir',
    "$gssDir/templates/custom/$z/logs/google_sheets_sync.bki",
    $buggy);

# Fix: index.php now passes an absolute path to gss_normalize_config,
# so gss_resolve_path keeps it intact.
$fixedConfig = ['output_file' => "$logsDir/google_sheets_sync.bki"];
$normalized = gss_normalize_config($fixedConfig, $gssDir);
check('fix: absolute output_file is preserved by gss_normalize_config',
    "$logsDir/google_sheets_sync.bki",
    $normalized['output_file']);

# realpath() of a freshly created logs dir + bki filename is also absolute,
# which is how index.php builds the absolute path.
$resolvedLogsDir = realpath($logsDir);
check('realpath of logs dir is absolute',
    true,
    is_string($resolvedLogsDir) && $resolvedLogsDir !== '' && $resolvedLogsDir[0] === '/');

# Cleanup
@rmdir($gssDir);
@rmdir(dirname($gssDir));
@rmdir($logsDir);
@rmdir(dirname($logsDir));
@rmdir(dirname(dirname($gssDir)));
@rmdir(dirname(dirname(dirname($gssDir))));
@rmdir($docRoot);

if ($failures > 0) {
    fwrite(STDERR, "\n$failures test(s) failed\n");
    exit(1);
}
echo "\nAll tests passed\n";
