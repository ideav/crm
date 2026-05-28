<?php
define('UPDATE_PHP_NO_MAIN', true);
require_once __DIR__ . '/../../update.php';

$pass = 0;
$fail = 0;

function test($name, $condition, $details = '') {
    global $pass, $fail;
    if ($condition) {
        echo "PASS: {$name}\n";
        $pass++;
    } else {
        echo "FAIL: {$name}" . ($details !== '' ? " ({$details})" : "") . "\n";
        $fail++;
    }
}

$legacy = tempnam(sys_get_temp_dir(), 'update-legacy-') . '.conf';
file_put_contents($legacy, implode("\n", [
    'repository: https://github.com/ideav/crm/',
    'branch: main',
    'token: xxx',
    'ignore_cache: yes',
    'css/* : /var/www/css/',
]));

$legacyConfig = parseConfig($legacy);
unlink($legacy);

test('legacy config keeps repository', $legacyConfig['repository'] === 'https://github.com/ideav/crm/');
test('legacy config keeps branch', $legacyConfig['branch'] === 'main');
test('legacy config keeps token', $legacyConfig['token'] === 'xxx');
test('legacy config keeps ignore_cache', $legacyConfig['ignore_cache'] === true);
test('legacy config does not require repository sections', !isset($legacyConfig['repositories']));
test('legacy config keeps mappings', count($legacyConfig['mappings']) === 1 && $legacyConfig['mappings'][0]['source'] === 'css/*');

$multi = tempnam(sys_get_temp_dir(), 'update-multi-') . '.conf';
file_put_contents($multi, implode("\n", [
    '[repository crm]',
    'repository: https://github.com/ideav/crm/',
    'branch: main',
    'token: xxx',
    'css/* : /var/www/css/',
    '',
    '[repository atex]',
    'repository: https://github.com/ideav/atex/',
    'branch: main',
    'templates/atex/* : /var/www/templates/custom/atex/',
    'download/atex/js/* : /var/www/download/atex/js/',
    'download/atex/css/* : /var/www/download/atex/css/',
]));

$multiConfig = parseConfig($multi);
unlink($multi);

test('multi config has repositories', isset($multiConfig['repositories']) && count($multiConfig['repositories']) === 2);
test('first repository name', $multiConfig['repositories'][0]['name'] === 'crm');
test('first repository url', $multiConfig['repositories'][0]['repository'] === 'https://github.com/ideav/crm/');
test('second repository name', $multiConfig['repositories'][1]['name'] === 'atex');
test('second repository url', $multiConfig['repositories'][1]['repository'] === 'https://github.com/ideav/atex/');
test('second repository has three mappings', count($multiConfig['repositories'][1]['mappings']) === 3);
test('second repository first mapping target', $multiConfig['repositories'][1]['mappings'][0]['target'] === '/var/www/templates/custom/atex/');

echo "\n{$pass} passed, {$fail} failed\n";
exit($fail > 0 ? 1 : 0);
