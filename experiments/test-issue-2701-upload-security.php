<?php
require_once __DIR__ . '/../include/upload_security.php';

function assertIssue2701($condition, $message)
{
    if(!$condition){
        fwrite(STDERR, "FAIL: $message\n");
        exit(1);
    }
}

function oldBlacklistAllowsIssue2701($filename)
{
    $ext = substr(strrchr($filename, '.'), 1);
    return !stripos(". php cgi pl fcgi fpl phtml shtml php2 php3 php4 php5 asp jsp ", " $ext ");
}

assertIssue2701(oldBlacklistAllowsIssue2701('shell.php.jpg'), 'old last-extension check demonstrates shell.php.jpg bypass');
assertIssue2701(oldBlacklistAllowsIssue2701('.htaccess'), 'old extension list demonstrates .htaccess bypass');

assertIssue2701(UploadFileNameSecurityError('shell.php.jpg') !== '', 'blocks dangerous middle extension');
assertIssue2701(UploadFileNameSecurityError('shell.php56.jpg') !== '', 'blocks php version handler extensions');
assertIssue2701(UploadFileNameSecurityError('SHELL.PHTML.txt') !== '', 'blocks dangerous middle extension case-insensitively');
assertIssue2701(UploadFileNameSecurityError('.htaccess') !== '', 'blocks Apache control files');
assertIssue2701(UploadFileNameSecurityError('.user.ini') !== '', 'blocks PHP per-directory config');
assertIssue2701(UploadFileNameSecurityError('web.config') !== '', 'blocks IIS control files');
assertIssue2701(UploadFileNameSecurityError("safe\nname.txt") !== '', 'blocks control characters');
assertIssue2701(UploadFileNameSecurityError('safe.txt.') !== '', 'blocks trailing dot confusion');

assertIssue2701(SafeUploadFileName('../../invoice.pdf') === 'invoice.pdf', 'normalizes path traversal to basename');
assertIssue2701(SafeUploadFileName('C:\\fakepath\\invoice.pdf') === 'invoice.pdf', 'normalizes browser fake paths');
assertIssue2701(SafeUploadFileName('report 2026.pdf') === 'report 2026.pdf', 'allows ordinary document names');
assertIssue2701(UploadFileExtension('Report.PDF') === 'pdf', 'normalizes extension case');
assertIssue2701(UploadFileStoredExtension('Report.PDF') === 'PDF', 'preserves stored extension case for existing file paths');

echo "PASS issue 2701 upload security\n";
