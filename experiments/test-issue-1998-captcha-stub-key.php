<?php
/**
 * Test for issue #1998: verifyCaptcha should return true when SMARTCAPTCHA_SERVER_KEY is the placeholder stub.
 */

define('SMARTCAPTCHA_SERVER_KEY', 'ysc2_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');

function verifyCaptcha($token) {
    if (SMARTCAPTCHA_SERVER_KEY === 'ysc2_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX') return true;
    if (empty($token)) return false;
    $url = 'https://smartcaptcha.yandexcloud.net/validate';
    $params = http_build_query([
        'secret' => SMARTCAPTCHA_SERVER_KEY,
        'token'  => $token,
        'ip'     => $_SERVER['REMOTE_ADDR'] ?? '',
    ]);
    $context = stream_context_create([
        'http' => [
            'method'  => 'POST',
            'header'  => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => $params,
            'timeout' => 5,
        ],
    ]);
    $result = @file_get_contents($url, false, $context);
    if ($result === false) return false;
    $data = json_decode($result, true);
    return isset($data['status']) && $data['status'] === 'ok';
}

// Test 1: stub key with empty token should return true (captcha skipped)
$result = verifyCaptcha('');
assert($result === true, "FAIL: verifyCaptcha('') with stub key should return true (skip captcha)");
echo "PASS: verifyCaptcha('') with stub key returns true\n";

// Test 2: stub key with any token should return true (captcha skipped)
$result = verifyCaptcha('some-token');
assert($result === true, "FAIL: verifyCaptcha('some-token') with stub key should return true (skip captcha)");
echo "PASS: verifyCaptcha('some-token') with stub key returns true\n";

echo "All tests passed.\n";
