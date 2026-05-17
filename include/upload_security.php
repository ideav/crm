<?php

function UploadFileBlockedExtensions()
{
    return array(
        'asp' => true,
        'aspx' => true,
        'bash' => true,
        'cgi' => true,
        'cfm' => true,
        'fcgi' => true,
        'fpl' => true,
        'htaccess' => true,
        'htpasswd' => true,
        'jsp' => true,
        'jspx' => true,
        'ksh' => true,
        'phar' => true,
        'php' => true,
        'php2' => true,
        'php3' => true,
        'php4' => true,
        'php5' => true,
        'php7' => true,
        'php8' => true,
        'pht' => true,
        'phtm' => true,
        'phtml' => true,
        'pl' => true,
        'py' => true,
        'rb' => true,
        'sh' => true,
        'shtm' => true,
        'shtml' => true,
        'user.ini' => true,
        'zsh' => true,
    );
}

function UploadFileBasename($name)
{
    $name = str_replace("\0", '', (string)$name);
    $name = str_replace('\\', '/', $name);
    $parts = explode('/', $name);
    return trim((string)array_pop($parts));
}

function UploadFileExtension($name)
{
    return strtolower((string)pathinfo(UploadFileBasename($name), PATHINFO_EXTENSION));
}

function UploadFileStoredExtension($name)
{
    return (string)pathinfo(UploadFileBasename($name), PATHINFO_EXTENSION);
}

function UploadFileBlockedExtension($ext)
{
    $ext = strtolower(trim((string)$ext));
    $ext = ltrim($ext, '.');
    if($ext === '')
        return false;
    if(preg_match('/^php[0-9]*$/', $ext))
        return true;
    $blocked = UploadFileBlockedExtensions();
    return isset($blocked[$ext]);
}

function UploadFileNameSecurityError($name)
{
    $filename = UploadFileBasename($name);
    if($filename === '' || $filename === '.' || $filename === '..')
        return 'empty filename';
    if(strlen($filename) > 255)
        return 'filename too long';
    if(preg_match('/[[:cntrl:]]/', $filename))
        return 'control character in filename';
    if($filename[0] === '.')
        return 'hidden server control file';
    if(substr($filename, -1) === '.')
        return 'trailing dot in filename';

    $lower = strtolower($filename);
    $blockedNames = array(
        '.htaccess' => true,
        '.htpasswd' => true,
        '.user.ini' => true,
        'web.config' => true,
    );
    if(isset($blockedNames[$lower]))
        return 'server control file';

    $parts = explode('.', $lower);
    foreach($parts as $part)
        if(UploadFileBlockedExtension($part))
            return 'dangerous extension';

    return '';
}

function SafeUploadFileName($name)
{
    $filename = UploadFileBasename($name);
    if(UploadFileNameSecurityError($filename) !== '')
        return false;
    return $filename;
}
