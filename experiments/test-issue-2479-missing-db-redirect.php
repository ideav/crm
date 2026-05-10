<?php

$locale = 'RU';
$capturedLogin = null;

function t9n($msg)
{
    global $locale;
    $marker = '[' . $locale . ']';
    $start = mb_stripos($msg, $marker);
    if ($start === false) {
        return $msg;
    }
    $msg = mb_substr($msg, $start + mb_strlen($marker));
    preg_match('/(.*?)\[[A-Z]{2}\]/ms', $msg, $match);
    return isset($match[1]) ? $match[1] : $msg;
}

function login($z = '', $u = '', $message = '', $details = '')
{
    global $capturedLogin;
    $capturedLogin = array(
        'db' => $z,
        'login' => $u,
        'message' => $message,
        'details' => $details,
    );
    throw new RuntimeException('login called');
}

$helperPath = __DIR__ . '/../include/db_errors.php';
if (!file_exists($helperPath)) {
    fwrite(STDERR, "Expected include/db_errors.php to define the missing database redirect helper.\n");
    exit(1);
}

$indexPath = __DIR__ . '/../index.php';
$indexSource = file_get_contents($indexPath);
$reportPos = strpos($indexSource, 'mysqli_report(MYSQLI_REPORT_OFF)');
$connectionPos = strpos($indexSource, 'include "include/connection.php"');
if ($reportPos === false || $connectionPos === false || $reportPos > $connectionPos) {
    fwrite(STDERR, "Expected mysqli exceptions to be disabled before opening the bootstrap connection.\n");
    exit(1);
}
if (strpos($indexSource, 'handleDatabaseBootstrapError($z, mysqli_errno($connection))') === false) {
    fwrite(STDERR, "Expected the bootstrap database check to use handleDatabaseBootstrapError().\n");
    exit(1);
}

include $helperPath;

try {
    handleDatabaseBootstrapError('alex', 1146);
} catch (RuntimeException $e) {
    if ($e->getMessage() !== 'login called') {
        throw $e;
    }
}

if ($capturedLogin === null) {
    fwrite(STDERR, "Expected missing table error 1146 to redirect through login().\n");
    exit(1);
}

$expected = array(
    'db' => 'alex',
    'login' => '',
    'message' => 'dBNotExists',
);
foreach ($expected as $key => $value) {
    if ($capturedLogin[$key] !== $value) {
        fwrite(STDERR, "Unexpected login argument $key: " . var_export($capturedLogin[$key], true) . "\n");
        exit(1);
    }
}

if (strpos($capturedLogin['details'], 'База alex не найдена') === false) {
    fwrite(STDERR, "Expected details to explain that database alex was not found.\n");
    exit(1);
}

echo "issue-2479 missing database redirect test passed\n";
