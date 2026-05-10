<?php

function databaseNotFoundDetails($dbName)
{
    return t9n("[RU]База $dbName не найдена[EN]The $dbName database was not found");
}

function redirectDatabaseNotFound($dbName)
{
    login($dbName, "", "dBNotExists", databaseNotFoundDetails($dbName));
}

function handleDatabaseBootstrapError($dbName, $errno)
{
    if ((int)$errno === 1146) {
        redirectDatabaseNotFound($dbName);
    }
    header("HTTP/1.0 404 Not found");
    die("$dbName does not exist");
}

?>
