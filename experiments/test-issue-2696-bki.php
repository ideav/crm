<?php

/**
 * Test for issue #2696: формат .bki для загрузки в Интеграм.
 * Первая строка "DATA", разделитель ";", переносы строк и табы → пробелы,
 * ";" в значении экранируется "\;". Первое поле — ID (PK в Интеграме).
 */

define('EXPORT_B3X_SKIP_RUN', true);
require_once __DIR__ . '/../export_b3x.php';

function bkiAssert($condition, $message) {
    if (!$condition) {
        throw new Exception($message);
    }
}

// 1. bkiEscape: переносы (\n, \r, \r\n) и таб → пробел.
bkiAssert(bkiEscape("a\nb") === 'a b', "\\n must become space");
bkiAssert(bkiEscape("a\rb") === 'a b', "\\r must become space");
bkiAssert(bkiEscape("a\r\nb") === 'a b', "\\r\\n must become single space (not two)");
bkiAssert(bkiEscape("a\tb") === 'a b', "\\t must become space");
bkiAssert(bkiEscape("line1\nline2\tcol2") === 'line1 line2 col2', "mixed whitespace");

// 2. bkiEscape: ";" → "\;".
bkiAssert(bkiEscape('a;b') === 'a\\;b', "semicolon must be escaped");
bkiAssert(bkiEscape('a;b;c') === 'a\\;b\\;c', "multiple semicolons");
bkiAssert(bkiEscape(';;') === '\\;\\;', "leading/trailing semicolons");

// 3. bkiEscape: обычные строки без изменений.
bkiAssert(bkiEscape('hello world') === 'hello world', "plain text unchanged");
bkiAssert(bkiEscape('') === '', "empty stays empty");
bkiAssert(bkiEscape('Привет!') === 'Привет!', "unicode unchanged");

// 4. bkiEscape: числа и null приводятся к строке.
bkiAssert(bkiEscape(42) === '42', "int → string");
bkiAssert(bkiEscape(null) === '', "null → empty string");

// 5. formatBkiRow: склейка через ";".
bkiAssert(formatBkiRow(['1', 'John', 'NEW']) === '1;John;NEW', "simple row");
bkiAssert(formatBkiRow(['1', 'a;b', 'c']) === '1;a\\;b;c', "escape semicolon in value");
bkiAssert(formatBkiRow(['1', "multi\nline", 'tab\there'])
    === '1;multi line;tab here', "newlines and tabs in row values");
bkiAssert(formatBkiRow(['1', '', 'last']) === '1;;last', "empty middle field");

// 6. initBkiFile: создаёт файл с одной строкой "DATA" если не существует.
$tmpFile = sys_get_temp_dir() . '/test-issue-2696-' . getmypid() . '.bki';
if (file_exists($tmpFile)) unlink($tmpFile);
initBkiFile($tmpFile);
bkiAssert(file_exists($tmpFile), "init creates file");
bkiAssert(file_get_contents($tmpFile) === "DATA\n", "init writes 'DATA\\n'");

// 6a. initBkiFile: на существующий непустой файл не наступает.
file_put_contents($tmpFile, "DATA\nexisting;row\n");
initBkiFile($tmpFile);
bkiAssert(file_get_contents($tmpFile) === "DATA\nexisting;row\n", "init must not touch non-empty file");

// 6b. initBkiFile: пустой файл переинициализируется (filesize==0).
file_put_contents($tmpFile, '');
initBkiFile($tmpFile);
bkiAssert(file_get_contents($tmpFile) === "DATA\n", "init re-creates empty file");

// 7. appendBkiRow: дописывает строку в конец.
file_put_contents($tmpFile, "DATA\n");
appendBkiRow($tmpFile, ['1', 'Anna', 'NEW']);
appendBkiRow($tmpFile, ['2', "Boris\nB", 'IN_WORK']);
$content = file_get_contents($tmpFile);
bkiAssert($content === "DATA\n1;Anna;NEW\n2;Boris B;IN_WORK\n",
    "append produces DATA + escaped rows, got: " . json_encode($content));

// 8. writeBkiFile: атомарная полная перезапись (для departments/users).
writeBkiFile($tmpFile, [
    ['1', 'Sales', 'Root'],
    ['2', 'IT;dept', "multi\nline"],
]);
$content = file_get_contents($tmpFile);
bkiAssert($content === "DATA\n1;Sales;Root\n2;IT\\;dept;multi line\n",
    "writeBkiFile replaces content with DATA + escaped rows, got: " . json_encode($content));

// 9. ID идёт первым: реальный поток приведения через prepareRowData
// (формирует массив values в порядке полей; первое поле в leadFieldsMap — 'ID').
$leadLikePayload = [
    'ID' => 42,
    'DATE_CREATE' => '2026-05-16T10:00:00+03:00',
    'DATE_MODIFY' => '2026-05-16T15:30:00+03:00',
    'TITLE' => 'Lead with; semicolon',
    'NAME' => "Anna\nNewline",
];
$fields = ['ID', 'DATE_CREATE', 'DATE_MODIFY', 'TITLE', 'NAME'];
$row = prepareRowData($leadLikePayload, $fields);
$bkiLine = formatBkiRow($row);
bkiAssert(strpos($bkiLine, '42;') === 0, "ID must be first field in bki line, got: " . $bkiLine);
bkiAssert(strpos($bkiLine, 'Lead with\\; semicolon') !== false, "semicolon in title must be escaped, got: " . $bkiLine);
bkiAssert(strpos($bkiLine, "Anna\n") === false, "no raw newline in bki line, got: " . json_encode($bkiLine));

unlink($tmpFile);

echo "PASS: bkiEscape replaces newlines/tabs with spaces and escapes ';'\n";
echo "PASS: formatBkiRow joins values with ';' applying escapes\n";
echo "PASS: initBkiFile writes 'DATA\\n' and respects non-empty existing files\n";
echo "PASS: appendBkiRow appends escaped row, writeBkiFile replaces atomically\n";
echo "PASS: prepareRowData + formatBkiRow keeps ID first and escapes special chars\n";
