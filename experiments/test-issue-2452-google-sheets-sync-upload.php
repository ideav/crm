<?php

require_once __DIR__ . '/../google_sheets_sync.php';

function assertSameIssue2452($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

function assertTrueIssue2452($condition, $message) {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

$config = gss_normalize_config([
    'integram' => [
        'enabled' => true,
        'base_url' => 'https://ideav.ru',
        'token' => 'token-123',
        'xsrf' => 'xsrf-456',
    ],
], __DIR__);

$integram = $config['integram'];
assertSameIssue2452('/object/443296?JSON&import=1', $integram['upload_endpoint'], 'uses requested upload endpoint by default');
assertTrueIssue2452(!array_key_exists('auth_endpoint', $integram), 'auth_endpoint is no longer a normalized setting');
assertTrueIssue2452(!array_key_exists('xsrf_endpoint', $integram), 'xsrf_endpoint is no longer a normalized setting');
assertSameIssue2452(
    'https://ideav.ru/object/443296?JSON&import=1',
    gss_integram_url($integram, $integram['upload_endpoint']),
    'resolves leading-slash upload endpoint against the configured host without database path'
);

$oldServer = $_SERVER;
$_SERVER['HTTP_HOST'] = 'crm.example.test';
$_SERVER['HTTPS'] = 'on';
assertSameIssue2452(
    'https://crm.example.test/object/443296?JSON&import=1',
    gss_integram_url(['base_url' => ''], '/object/443296?JSON&import=1'),
    'resolves relative upload endpoint against current host when base_url is omitted'
);
$_SERVER = $oldServer;

$tmpFile = tempnam(sys_get_temp_dir(), 'gss-2452-');
file_put_contents($tmpFile, "DATA\r\n");
$postFields = gss_integram_upload_post_fields($tmpFile, $integram);

assertSameIssue2452('token-123', $postFields['token'], 'passes token as POST field');
assertSameIssue2452('xsrf-456', $postFields['_xsrf'], 'passes xsrf as POST field');
assertSameIssue2452('1', $postFields['import'], 'keeps import flag as POST field');
assertTrueIssue2452($postFields['bki_file'] instanceof CURLFile, 'passes BKI content as multipart file');

unlink($tmpFile);

echo "PASS issue 2452 Google Sheets sync upload settings\n";
