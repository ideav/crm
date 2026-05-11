<?php
/**
 * Google Sheets -> Integram BKI synchronization script.
 *
 * Usage:
 *   php google_sheets_sync.php [google_sheets_sync.config.php] [--dry-run]
 *   php google_sheets_sync.php --config=/path/to/config.php --upload
 *   php google_sheets_sync.php --output=/path/to/import.bki --no-upload
 */

function gss_is_absolute_path($path) {
    return is_string($path) && ($path === '' ? false : ($path[0] === '/' || preg_match('/^[A-Za-z]:[\/\\\\]/', $path) === 1));
}

function gss_resolve_path($path, $baseDir) {
    if ($path === null || $path === '') return $path;
    if (gss_is_absolute_path($path)) return $path;
    return rtrim($baseDir, '/\\') . DIRECTORY_SEPARATOR . $path;
}

function gss_parse_cli_options($argv) {
    $options = [
        'config' => __DIR__ . '/google_sheets_sync.config.php',
        'dry_run' => false,
        'force_upload' => null,
        'output' => null,
        'help' => false,
    ];

    $args = $argv;
    array_shift($args);

    foreach ($args as $arg) {
        if ($arg === '--help' || $arg === '-h') {
            $options['help'] = true;
        } elseif ($arg === '--dry-run' || $arg === '--no-upload') {
            $options['dry_run'] = true;
            $options['force_upload'] = false;
        } elseif ($arg === '--upload') {
            $options['dry_run'] = false;
            $options['force_upload'] = true;
        } elseif (strpos($arg, '--config=') === 0) {
            $options['config'] = substr($arg, strlen('--config='));
        } elseif (strpos($arg, '--output=') === 0) {
            $options['output'] = substr($arg, strlen('--output='));
        } elseif ($arg !== '' && $arg[0] !== '-') {
            $options['config'] = $arg;
        } else {
            throw new InvalidArgumentException("Unknown option: {$arg}");
        }
    }

    return $options;
}

function gss_usage() {
    return "Usage:\n"
        . "  php google_sheets_sync.php [config.php] [--dry-run|--no-upload|--upload]\n"
        . "  php google_sheets_sync.php --config=/path/config.php --output=/path/import.bki\n";
}

function gss_load_config($configPath) {
    if (!file_exists($configPath)) {
        throw new RuntimeException("Config file not found: {$configPath}");
    }

    $config = require $configPath;
    if (!is_array($config)) {
        throw new RuntimeException("Config file must return an array: {$configPath}");
    }

    return gss_normalize_config($config, dirname(realpath($configPath)));
}

function gss_normalize_config($config, $configDir) {
    $defaults = [
        'credentials_path' => __DIR__ . '/include/credentials.json',
        'spreadsheet_id' => '',
        'output_file' => __DIR__ . '/logs/google_sheets_sync.bki',
        'skip_empty_values' => false,
        'debug' => false,
        'http_timeout' => 60,
        'google_scope' => 'https://www.googleapis.com/auth/spreadsheets.readonly',
        'sheets' => [],
        'integram' => [],
    ];

    $config = array_merge($defaults, $config);
    $config['credentials_path'] = gss_resolve_path($config['credentials_path'], $configDir);
    $config['output_file'] = gss_resolve_path($config['output_file'], $configDir);

    $integramDefaults = [
        'enabled' => false,
        'base_url' => '',
        'database' => '',
        'token' => '',
        'xsrf' => '',
        'object' => '',
        'upload_endpoint' => '/object/443296?JSON&import=1',
        'base_url_has_database' => false,
        'url_template' => '',
        'createParent' => '1',
        'autoParent' => '449960',
    ];
    $config['integram'] = array_merge($integramDefaults, $config['integram']);
    unset($config['integram']['auth_endpoint'], $config['integram']['xsrf_endpoint']);

    return $config;
}

function gss_sync($config) {
    if (empty($config['sheets']) || !is_array($config['sheets'])) {
        throw new RuntimeException('Config key "sheets" must contain at least one sheet configuration.');
    }

    $httpOptions = ['timeout' => (int)$config['http_timeout']];
    $debug = !empty($config['debug']);
    gss_debug($debug, 'Requesting Google Sheets access token');
    $accessToken = gss_google_access_token(
        $config['credentials_path'],
        $config['google_scope'],
        $httpOptions
    );

    $allRecords = [];
    $sheetSummaries = [];

    foreach ($config['sheets'] as $sheetConfig) {
        $sheetName = isset($sheetConfig['name']) ? (string)$sheetConfig['name'] : '';
        if ($sheetName === '' && empty($sheetConfig['range'])) {
            throw new RuntimeException('Each sheet config must define "name" or "range".');
        }

        $spreadsheetId = isset($sheetConfig['spreadsheet_id']) && $sheetConfig['spreadsheet_id'] !== ''
            ? $sheetConfig['spreadsheet_id']
            : $config['spreadsheet_id'];
        if ($spreadsheetId === '') {
            throw new RuntimeException("Spreadsheet id is missing for sheet '{$sheetName}'.");
        }

        gss_debug($debug, "Fetching sheet '{$sheetName}'");
        $sheetRange = !empty($sheetConfig['range']) ? (string)$sheetConfig['range'] : gss_quote_sheet_name($sheetName);
        $rangeStartRow = gss_value_range_start_indexes($sheetRange)['row'];
        $values = gss_fetch_google_sheet_values($spreadsheetId, $sheetConfig, $accessToken, $httpOptions);
        $records = gss_extract_sheet_records(
            $sheetName !== '' ? $sheetName : (string)$sheetConfig['range'],
            $values,
            $sheetConfig['rows'] ?? [],
            $sheetConfig['columns'] ?? [],
            !empty($config['skip_empty_values']),
            $rangeStartRow
        );

        $allRecords = array_merge($allRecords, $records);
        $sheetSummaries[] = [
            'sheet' => $sheetName !== '' ? $sheetName : (string)$sheetConfig['range'],
            'rows' => count($values),
            'records' => count($records),
        ];
    }

    $content = gss_build_bki_content($allRecords);
    gss_debug($debug, "Writing BKI file '{$config['output_file']}'");
    gss_write_file($config['output_file'], $content);

    $uploadResult = null;
    if (!empty($config['integram']['enabled'])) {
        gss_debug($debug, 'Uploading BKI file to Integram');
        $uploadResult = gss_upload_to_integram($config['output_file'], $config['integram'], $httpOptions);
    }

    return [
        'output_file' => $config['output_file'],
        'record_count' => count($allRecords),
        'sheet_summaries' => $sheetSummaries,
        'upload' => $uploadResult,
    ];
}

function gss_debug($enabled, $message) {
    if (!$enabled) return;
    $line = '[google_sheets_sync] ' . $message . "\n";
    if (defined('STDERR')) {
        fwrite(STDERR, $line);
    } else {
        echo $line;
    }
}

function gss_write_file($path, $content) {
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        throw new RuntimeException("Failed to create directory: {$dir}");
    }

    $bytes = file_put_contents($path, $content, LOCK_EX);
    if ($bytes === false || $bytes !== strlen($content)) {
        throw new RuntimeException("Failed to write file: {$path}");
    }
}

function gss_google_access_token($credentialsPath, $scope, $httpOptions = []) {
    if (!file_exists($credentialsPath)) {
        throw new RuntimeException("Google credentials file not found: {$credentialsPath}");
    }

    $credentials = gss_read_json_file($credentialsPath, 'Google credentials');
    if (!empty($credentials['access_token'])) {
        return $credentials['access_token'];
    }

    foreach (['client_email', 'private_key'] as $key) {
        if (empty($credentials[$key])) {
            throw new RuntimeException("Google service account credentials must contain '{$key}'.");
        }
    }

    $tokenUri = $credentials['token_uri'] ?? 'https://oauth2.googleapis.com/token';
    $now = time();
    $header = ['alg' => 'RS256', 'typ' => 'JWT'];
    $claim = [
        'iss' => $credentials['client_email'],
        'scope' => $scope,
        'aud' => $tokenUri,
        'iat' => $now,
        'exp' => $now + 3600,
    ];

    $unsigned = gss_base64url_json($header) . '.' . gss_base64url_json($claim);
    $signature = '';
    $ok = openssl_sign($unsigned, $signature, $credentials['private_key'], OPENSSL_ALGO_SHA256);
    if (!$ok) {
        throw new RuntimeException('Failed to sign Google service account JWT.');
    }

    $jwt = $unsigned . '.' . gss_base64url($signature);
    $body = http_build_query([
        'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion' => $jwt,
    ], '', '&');

    $response = gss_http_request('POST', $tokenUri, [
        'Content-Type: application/x-www-form-urlencoded',
    ], $body, $httpOptions);

    gss_assert_success($response, 'Google OAuth token request');
    $json = gss_decode_json($response['body'], 'Google OAuth token response');
    if (empty($json['access_token'])) {
        throw new RuntimeException('Google OAuth token response does not contain access_token.');
    }

    return $json['access_token'];
}

function gss_read_json_file($path, $description) {
    $raw = file_get_contents($path);
    if ($raw === false) {
        throw new RuntimeException("Failed to read {$description}: {$path}");
    }

    $json = json_decode($raw, true);
    if (!is_array($json)) {
        throw new RuntimeException("Failed to parse {$description} JSON: {$path}");
    }

    return $json;
}

function gss_fetch_google_sheet_values($spreadsheetId, $sheetConfig, $accessToken, $httpOptions = []) {
    $range = '';
    if (!empty($sheetConfig['range'])) {
        $range = (string)$sheetConfig['range'];
    } elseif (!empty($sheetConfig['name'])) {
        $range = gss_quote_sheet_name((string)$sheetConfig['name']);
    }

    if ($range === '') {
        throw new RuntimeException('Google sheet range is empty.');
    }

    $query = http_build_query([
        'majorDimension' => 'ROWS',
        'valueRenderOption' => 'FORMATTED_VALUE',
    ], '', '&');
    $url = 'https://sheets.googleapis.com/v4/spreadsheets/'
        . rawurlencode($spreadsheetId)
        . '/values/'
        . rawurlencode($range)
        . '?' . $query;

    $response = gss_http_request('GET', $url, [
        'Authorization: Bearer ' . $accessToken,
        'Accept: application/json',
    ], null, $httpOptions);

    gss_assert_success($response, "Google Sheets values request for range {$range}");
    $json = gss_decode_json($response['body'], "Google Sheets values response for range {$range}");
    $values = isset($json['values']) && is_array($json['values']) ? $json['values'] : [];

    if (gss_should_expand_merged_cells($sheetConfig)) {
        $sheetTitle = gss_sheet_title_for_merge_lookup($sheetConfig, $range);
        if ($sheetTitle !== '') {
            $merges = gss_fetch_google_sheet_merges($spreadsheetId, $sheetTitle, $accessToken, $httpOptions);
            if (!empty($merges)) {
                $rangeStart = gss_value_range_start_indexes($range, $json['range'] ?? '');
                $values = gss_apply_google_sheet_merges($values, $merges, $rangeStart['row'], $rangeStart['column']);
            }
        }
    }

    return $values;
}

function gss_quote_sheet_name($sheetName) {
    return "'" . str_replace("'", "''", $sheetName) . "'";
}

function gss_should_expand_merged_cells($sheetConfig) {
    if (array_key_exists('expand_merged_cells', $sheetConfig)) {
        return !empty($sheetConfig['expand_merged_cells']);
    }
    return true;
}

function gss_sheet_title_for_merge_lookup($sheetConfig, $range) {
    $parts = gss_split_a1_notation($range);
    if ($parts['sheet'] !== '') {
        return $parts['sheet'];
    }

    if (!empty($sheetConfig['name'])) {
        return (string)$sheetConfig['name'];
    }

    return $parts['sheet'];
}

function gss_fetch_google_sheet_merges($spreadsheetId, $sheetTitle, $accessToken, $httpOptions = []) {
    if ($sheetTitle === '') {
        return [];
    }

    $query = http_build_query([
        'fields' => 'sheets(properties(sheetId,title),merges)',
    ], '', '&');
    $url = 'https://sheets.googleapis.com/v4/spreadsheets/'
        . rawurlencode($spreadsheetId)
        . '?' . $query;

    $response = gss_http_request('GET', $url, [
        'Authorization: Bearer ' . $accessToken,
        'Accept: application/json',
    ], null, $httpOptions);

    gss_assert_success($response, "Google Sheets metadata request for sheet {$sheetTitle}");
    $json = gss_decode_json($response['body'], "Google Sheets metadata response for sheet {$sheetTitle}");

    foreach ($json['sheets'] ?? [] as $sheet) {
        $title = $sheet['properties']['title'] ?? '';
        if ($title === $sheetTitle) {
            return isset($sheet['merges']) && is_array($sheet['merges']) ? $sheet['merges'] : [];
        }
    }

    return [];
}

function gss_value_range_start_indexes($requestedRange, $responseRange = '') {
    foreach ([$responseRange, $requestedRange] as $range) {
        if ($range === '') {
            continue;
        }

        $start = gss_a1_range_start_indexes($range);
        if ($start !== null) {
            return $start;
        }
    }

    return ['row' => 0, 'column' => 0];
}

function gss_a1_range_start_indexes($range) {
    $parts = gss_split_a1_notation($range);
    $cells = trim($parts['cells']);
    if ($cells === '') {
        return ['row' => 0, 'column' => 0];
    }

    $rangeParts = explode(':', $cells, 2);
    $startCell = trim($rangeParts[0]);
    if ($startCell === '') {
        return ['row' => 0, 'column' => 0];
    }

    if (preg_match('/^([A-Za-z]*)([0-9]*)$/', $startCell, $matches) !== 1) {
        return null;
    }

    $columnLetters = $matches[1] ?? '';
    $rowNumber = $matches[2] ?? '';
    if ($columnLetters === '' && $rowNumber === '') {
        return null;
    }

    if ($parts['sheet'] === '' && strlen($columnLetters) > 3) {
        return null;
    }

    return [
        'row' => $rowNumber === '' ? 0 : max(0, ((int)$rowNumber) - 1),
        'column' => $columnLetters === '' ? 0 : gss_column_letters_to_index($columnLetters),
    ];
}

function gss_column_letters_to_index($letters) {
    $letters = strtoupper($letters);
    $index = 0;
    $length = strlen($letters);
    for ($i = 0; $i < $length; $i++) {
        $index = ($index * 26) + (ord($letters[$i]) - ord('A') + 1);
    }
    return $index - 1;
}

function gss_split_a1_notation($range) {
    $range = trim(gss_cell_to_string($range));
    if ($range === '') {
        return ['sheet' => '', 'cells' => ''];
    }

    $length = strlen($range);
    if ($range[0] === "'") {
        $sheet = '';
        for ($i = 1; $i < $length; $i++) {
            $char = $range[$i];
            if ($char === "'") {
                if ($i + 1 < $length && $range[$i + 1] === "'") {
                    $sheet .= "'";
                    $i++;
                    continue;
                }
                if ($i + 1 < $length && $range[$i + 1] === '!') {
                    return ['sheet' => $sheet, 'cells' => substr($range, $i + 2)];
                }
                if ($i + 1 === $length) {
                    return ['sheet' => $sheet, 'cells' => ''];
                }
                break;
            }
            $sheet .= $char;
        }

        return ['sheet' => '', 'cells' => $range];
    }

    $bangIndex = strpos($range, '!');
    if ($bangIndex !== false) {
        return [
            'sheet' => substr($range, 0, $bangIndex),
            'cells' => substr($range, $bangIndex + 1),
        ];
    }

    return ['sheet' => '', 'cells' => $range];
}

function gss_extract_sheet_records($sheetName, $values, $rowMatchers, $columnMatchers, $skipEmptyValues = false, $rangeStartRow = 0) {
    if (!is_array($rowMatchers) || empty($rowMatchers)) {
        throw new RuntimeException("Sheet '{$sheetName}' must define non-empty row matchers.");
    }
    if (!is_array($columnMatchers) || empty($columnMatchers)) {
        throw new RuntimeException("Sheet '{$sheetName}' must define non-empty column matchers.");
    }

    $matrix = gss_normalize_matrix($values);
    $maxColumns = gss_max_columns($matrix);
    $records = [];

    foreach ($matrix as $rowIndex => $row) {
        $rowSpecMatches = gss_match_specs_with_entries($row, $rowMatchers);
        if (empty($rowSpecMatches)) {
            continue;
        }

        for ($columnIndex = 0; $columnIndex < $maxColumns; $columnIndex++) {
            $matchedRows = [];
            $matchedColumns = [];
            $matchedRowEntries = [];
            $matchedColumnEntries = [];
            $hasColumnMatch = false;
            $column = gss_column_values_between($matrix, $columnIndex, 0, $rowIndex);

            foreach ($rowSpecMatches as $rowSpecMatch) {
                foreach ($columnMatchers as $columnSpec) {
                    $columnMatch = gss_match_spec_with_entries($column, $columnSpec);
                    if ($columnMatch['matched']) {
                        $matchedRows = array_merge($matchedRows, $rowSpecMatch['values']);
                        $matchedColumns = array_merge($matchedColumns, $columnMatch['values']);
                        $matchedRowEntries = array_merge($matchedRowEntries, $rowSpecMatch['entries']);
                        $matchedColumnEntries = array_merge($matchedColumnEntries, $columnMatch['entries']);
                        $hasColumnMatch = true;
                    }
                }
            }

            if (!$hasColumnMatch) {
                continue;
            }

            $value = isset($matrix[$rowIndex][$columnIndex]) ? $matrix[$rowIndex][$columnIndex] : '';
            if ($skipEmptyValues && trim((string)$value) === '') {
                continue;
            }

            $records[] = [
                'sheet' => $sheetName,
                'row_number' => $rowIndex + 1,
                'sheet_row_number' => $rangeStartRow + $rowIndex + 1,
                'rows' => gss_unique_preserve_order($matchedRows),
                'columns' => gss_unique_preserve_order($matchedColumns),
                'date' => gss_max_ddmmyyyy_value(gss_match_entry_values(array_merge($matchedRowEntries, $matchedColumnEntries))),
                'row' => gss_last_match_entry_value($matchedRowEntries),
                'column' => gss_last_match_entry_value($matchedColumnEntries),
                'value' => $value,
                'row_index' => $rowIndex,
                'column_index' => $columnIndex,
            ];
        }
    }

    return $records;
}

function gss_normalize_matrix($values) {
    $matrix = [];
    foreach ($values as $row) {
        $normalizedRow = [];
        if (is_array($row)) {
            foreach ($row as $value) {
                $normalizedRow[] = gss_cell_to_string($value);
            }
        } else {
            $normalizedRow[] = gss_cell_to_string($row);
        }
        $matrix[] = $normalizedRow;
    }
    return $matrix;
}

function gss_apply_google_sheet_merges($values, $merges, $rangeStartRow = 0, $rangeStartColumn = 0) {
    if (!is_array($merges) || empty($merges)) {
        return $values;
    }

    $matrix = gss_normalize_matrix($values);
    $rangeStartRow = max(0, (int)$rangeStartRow);
    $rangeStartColumn = max(0, (int)$rangeStartColumn);

    foreach ($merges as $merge) {
        if (!is_array($merge)) {
            continue;
        }
        if (!isset($merge['endRowIndex'], $merge['endColumnIndex'])) {
            continue;
        }

        $startRow = isset($merge['startRowIndex']) ? (int)$merge['startRowIndex'] : 0;
        $endRow = (int)$merge['endRowIndex'];
        $startColumn = isset($merge['startColumnIndex']) ? (int)$merge['startColumnIndex'] : 0;
        $endColumn = (int)$merge['endColumnIndex'];

        if ($endRow <= $startRow || $endColumn <= $startColumn) {
            continue;
        }

        $sourceRow = $startRow - $rangeStartRow;
        $sourceColumn = $startColumn - $rangeStartColumn;
        if ($sourceRow < 0 || $sourceColumn < 0 || $sourceRow >= count($matrix)) {
            continue;
        }
        if (!array_key_exists($sourceColumn, $matrix[$sourceRow])) {
            continue;
        }

        $sourceValue = gss_cell_to_string($matrix[$sourceRow][$sourceColumn]);
        if (trim($sourceValue) === '') {
            continue;
        }

        $firstRow = max($startRow, $rangeStartRow);
        $lastRow = $endRow - 1;
        $firstColumn = max($startColumn, $rangeStartColumn);
        $lastColumn = $endColumn - 1;

        for ($rowIndex = $firstRow; $rowIndex <= $lastRow; $rowIndex++) {
            $localRow = $rowIndex - $rangeStartRow;
            if ($localRow < 0 || $localRow >= count($matrix)) {
                continue;
            }

            for ($columnIndex = $firstColumn; $columnIndex <= $lastColumn; $columnIndex++) {
                $localColumn = $columnIndex - $rangeStartColumn;
                if ($localColumn < 0) {
                    continue;
                }

                gss_ensure_row_column($matrix[$localRow], $localColumn);
                if (trim(gss_cell_to_string($matrix[$localRow][$localColumn])) === '') {
                    $matrix[$localRow][$localColumn] = $sourceValue;
                }
            }
        }
    }

    return $matrix;
}

function gss_ensure_row_column(&$row, $columnIndex) {
    while (count($row) <= $columnIndex) {
        $row[] = '';
    }
}

function gss_cell_to_string($value) {
    if ($value === null) return '';
    if (is_bool($value)) return $value ? 'TRUE' : 'FALSE';
    if (is_array($value) || is_object($value)) return json_encode($value, JSON_UNESCAPED_UNICODE);
    return (string)$value;
}

function gss_max_columns($matrix) {
    $max = 0;
    foreach ($matrix as $row) {
        $max = max($max, count($row));
    }
    return $max;
}

function gss_column_values($matrix, $columnIndex) {
    $values = [];
    foreach ($matrix as $row) {
        $values[] = isset($row[$columnIndex]) ? $row[$columnIndex] : '';
    }
    return $values;
}

function gss_column_values_between($matrix, $columnIndex, $startRow, $endRow) {
    $values = [];
    $startRow = max(0, (int)$startRow);
    $endRow = min(count($matrix) - 1, (int)$endRow);

    for ($rowIndex = $startRow; $rowIndex <= $endRow; $rowIndex++) {
        $row = $matrix[$rowIndex];
        $values[] = isset($row[$columnIndex]) ? $row[$columnIndex] : '';
    }

    return $values;
}

function gss_match_specs($cells, $specs) {
    $matches = [];
    foreach (gss_match_specs_with_entries($cells, $specs) as $match) {
        $matches[] = [
            'key' => $match['key'],
            'values' => $match['values'],
        ];
    }
    return $matches;
}

function gss_match_specs_with_entries($cells, $specs) {
    $matches = [];
    foreach ($specs as $specKey => $spec) {
        $match = gss_match_spec_with_entries($cells, $spec);
        if ($match['matched']) {
            $matches[] = [
                'key' => (string)$specKey,
                'values' => gss_unique_preserve_order($match['values']),
                'entries' => $match['entries'],
            ];
        }
    }
    return $matches;
}

function gss_match_any_spec($cells, $specs) {
    $matches = [];
    foreach (gss_match_specs($cells, $specs) as $match) {
        $matches = array_merge($matches, $match['values']);
    }
    return gss_unique_preserve_order($matches);
}

function gss_match_spec($cells, $spec) {
    $match = gss_match_spec_with_entries($cells, $spec);
    return [
        'matched' => $match['matched'],
        'values' => $match['values'],
    ];
}

function gss_match_spec_with_entries($cells, $spec) {
    $patterns = is_array($spec) ? array_values($spec) : [$spec];
    $entries = gss_match_pattern_sequence_entries($cells, $patterns, 0, [], []);
    if ($entries === null) {
        return ['matched' => false, 'values' => [], 'entries' => []];
    }

    return [
        'matched' => true,
        'values' => gss_match_entry_values($entries),
        'entries' => $entries,
    ];
}

function gss_match_pattern_sequence($cells, $patterns, $patternIndex, $usedIndexes, $values) {
    $entries = gss_match_pattern_sequence_entries($cells, $patterns, $patternIndex, $usedIndexes, []);
    if ($entries === null) {
        return null;
    }
    return array_merge($values, gss_match_entry_values($entries));
}

function gss_match_pattern_sequence_entries($cells, $patterns, $patternIndex, $usedIndexes, $entries) {
    if ($patternIndex >= count($patterns)) {
        return $entries;
    }

    $matches = gss_find_matching_cell_entries($cells, $patterns[$patternIndex], $usedIndexes);
    foreach ($matches as $match) {
        $nextUsedIndexes = $usedIndexes;
        $nextUsedIndexes[$match['index']] = true;

        $nextEntries = $entries;
        $nextEntries[] = $match;

        $result = gss_match_pattern_sequence_entries($cells, $patterns, $patternIndex + 1, $nextUsedIndexes, $nextEntries);
        if ($result !== null) {
            return $result;
        }
    }

    return null;
}

function gss_match_entry_values($entries) {
    $values = [];
    foreach ($entries as $entry) {
        $values[] = isset($entry['value']) ? $entry['value'] : '';
    }
    return $values;
}

function gss_last_match_entry_value($entries) {
    $bestIndex = null;
    $bestValue = '';

    foreach ($entries as $entry) {
        if (!isset($entry['index'])) {
            continue;
        }
        $index = (int)$entry['index'];
        if ($bestIndex === null || $index >= $bestIndex) {
            $bestIndex = $index;
            $bestValue = isset($entry['value']) ? gss_cell_to_string($entry['value']) : '';
        }
    }

    return $bestValue;
}

function gss_max_ddmmyyyy_value($values) {
    $bestKey = null;
    $bestValue = '';

    foreach ($values as $value) {
        $value = trim(gss_cell_to_string($value));
        $key = gss_ddmmyyyy_sort_key($value);
        if ($key === null) {
            continue;
        }
        if ($bestKey === null || $key > $bestKey) {
            $bestKey = $key;
            $bestValue = $value;
        }
    }

    return $bestValue;
}

function gss_ddmmyyyy_sort_key($value) {
    $value = trim(gss_cell_to_string($value));
    if (preg_match('/^([0-9]{2})\.([0-9]{2})\.([0-9]{4})$/', $value, $matches) !== 1) {
        return null;
    }

    $day = (int)$matches[1];
    $month = (int)$matches[2];
    $year = (int)$matches[3];
    if (!checkdate($month, $day, $year)) {
        return null;
    }

    return ($year * 10000) + ($month * 100) + $day;
}

function gss_find_matching_cell($cells, $pattern) {
    $match = gss_find_matching_cell_entry($cells, $pattern);
    return $match === null ? null : $match['value'];
}

function gss_find_matching_cell_entry($cells, $pattern, $usedIndexes = []) {
    $matches = gss_find_matching_cell_entries($cells, $pattern, $usedIndexes);
    return empty($matches) ? null : $matches[0];
}

function gss_find_matching_cell_entries($cells, $pattern, $usedIndexes = []) {
    $matches = [];
    foreach ($cells as $index => $cell) {
        if (isset($usedIndexes[$index])) {
            continue;
        }
        $cellValue = trim(gss_cell_to_string($cell));
        if (gss_pattern_matches($pattern, $cellValue)) {
            $matches[] = ['index' => $index, 'value' => $cellValue];
        }
    }
    return $matches;
}

function gss_pattern_matches($pattern, $value) {
    $value = trim(gss_cell_to_string($value));

    foreach (gss_pattern_options($pattern) as $patternOption) {
        if (gss_single_pattern_matches($patternOption, $value)) {
            return true;
        }
    }

    return false;
}

function gss_pattern_options($pattern) {
    $pattern = trim(gss_cell_to_string($pattern));
    if (strpos($pattern, '||') === false) {
        return [$pattern];
    }

    $options = [];
    foreach (explode('||', $pattern) as $option) {
        $options[] = gss_unquote_pattern_option(trim($option));
    }
    return $options;
}

function gss_unquote_pattern_option($pattern) {
    $length = strlen($pattern);
    if ($length < 2) {
        return $pattern;
    }

    $first = $pattern[0];
    $last = $pattern[$length - 1];
    if (($first === "'" && $last === "'") || ($first === '"' && $last === '"')) {
        return substr($pattern, 1, -1);
    }

    return $pattern;
}

function gss_single_pattern_matches($pattern, $value) {
    $pattern = trim(gss_cell_to_string($pattern));
    $value = trim(gss_cell_to_string($value));

    if (strpos($pattern, '*') === false) {
        return $value === $pattern;
    }

    $parts = explode('*', $pattern);
    $regexParts = [];
    foreach ($parts as $part) {
        $regexParts[] = preg_quote($part, '/');
    }
    $regex = '/^' . implode('.*', $regexParts) . '$/us';

    return preg_match($regex, $value) === 1;
}

function gss_unique_preserve_order($values) {
    $seen = [];
    $result = [];
    foreach ($values as $value) {
        $key = (string)$value;
        if (!array_key_exists($key, $seen)) {
            $seen[$key] = true;
            $result[] = $value;
        }
    }
    return $result;
}

function gss_build_bki_content($records, $timestamp = null) {
    if ($timestamp === null) {
        $timestamp = time();
    }

    $lines = ['DATA'];
    foreach ($records as $record) {
        $rows = isset($record['rows']) && is_array($record['rows']) ? $record['rows'] : [];
        $columns = isset($record['columns']) && is_array($record['columns']) ? $record['columns'] : [];
        $date = array_key_exists('date', $record)
            ? $record['date']
            : gss_max_ddmmyyyy_value(array_merge($rows, $columns));
        $row = array_key_exists('row', $record)
            ? $record['row']
            : gss_last_list_value($rows);
        $column = array_key_exists('column', $record)
            ? $record['column']
            : gss_last_list_value($columns);

        $sheetRowNumber = array_key_exists('sheet_row_number', $record) ? $record['sheet_row_number'] : '';
        $sheet = array_key_exists('sheet', $record) ? $record['sheet'] : '';

        $lines[] = gss_escape_bki_value($sheet)
            . ';' . gss_escape_bki_value($record['value'])
            . ';' . gss_escape_bki_value($date)
            . ';' . gss_escape_bki_value($row)
            . ';' . gss_escape_bki_value($column)
            . ';' . gss_escape_bki_value($sheetRowNumber)
            . ';' . gss_escape_bki_value($timestamp)
            . ';';
    }

    return implode("\r\n", $lines) . "\r\n";
}

function gss_last_list_value($values) {
    if (!is_array($values) || empty($values)) {
        return '';
    }
    return gss_cell_to_string($values[count($values) - 1]);
}

function gss_escape_bki_list($values) {
    $escaped = [];
    foreach ($values as $value) {
        $escaped[] = gss_escape_bki_value($value);
    }
    return implode(',', $escaped);
}

function gss_escape_bki_value($value) {
    return strtr(gss_cell_to_string($value), [
        ':' => '\\:',
        ';' => '\\;',
        ',' => '\\,',
    ]);
}

function gss_upload_to_integram($filePath, $integramConfig, $httpOptions = []) {
    if (!file_exists($filePath)) {
        throw new RuntimeException("Upload file not found: {$filePath}");
    }
    $endpoint = gss_integram_upload_endpoint($integramConfig);
    $url = gss_integram_url($integramConfig, $endpoint);
    $headers = ['Accept: application/json'];
    $postFields = gss_integram_upload_post_fields($filePath, $integramConfig);

    $response = gss_http_request('POST', $url, $headers, $postFields, $httpOptions);
    gss_assert_success($response, 'Integram BKI upload');

    $decoded = json_decode($response['body'], true);
    return [
        'status' => $response['status'],
        'url' => $url,
        'response' => is_array($decoded) ? $decoded : $response['body'],
    ];
}

function gss_integram_upload_endpoint($config) {
    $endpoint = isset($config['upload_endpoint']) ? (string)$config['upload_endpoint'] : '';
    if ($endpoint === '') {
        throw new RuntimeException('Integram upload requires integram.upload_endpoint in config.');
    }

    if (strpos($endpoint, '{object}') !== false) {
        if (empty($config['object'])) {
            throw new RuntimeException('Integram upload endpoint uses {object}, but integram.object is empty.');
        }
        $endpoint = str_replace('{object}', rawurlencode((string)$config['object']), $endpoint);
    }

    return $endpoint;
}

function gss_integram_upload_post_fields($filePath, $config) {
    $tokens = gss_integram_tokens($config);

    $fields = [
        'token' => $tokens['token'],
        '_xsrf' => $tokens['xsrf'],
        'import' => '1',
        'bki_file' => new CURLFile($filePath, 'application/octet-stream', 'import.bki'),
    ];

    if (isset($config['createParent']) && (string)$config['createParent'] !== '') {
        $fields['createParent'] = (string)$config['createParent'];
    }
    if (isset($config['autoParent']) && (string)$config['autoParent'] !== '') {
        $fields['autoParent'] = (string)$config['autoParent'];
    }

    return $fields;
}

function gss_integram_tokens($config) {
    $token = isset($config['token']) ? (string)$config['token'] : '';
    $xsrf = isset($config['xsrf']) ? (string)$config['xsrf'] : '';

    if ($token === '') {
        throw new RuntimeException('Integram upload requires integram.token in config.');
    }
    if ($xsrf === '') {
        throw new RuntimeException('Integram upload requires integram.xsrf in config.');
    }

    return [
        'token' => $token,
        'xsrf' => $xsrf,
    ];
}

function gss_integram_url($config, $endpoint) {
    $endpoint = (string)$endpoint;
    if ($endpoint === '') {
        throw new RuntimeException('Integram endpoint is empty.');
    }

    if (preg_match('/^https?:\/\//i', $endpoint) === 1) {
        return $endpoint;
    }

    if (!empty($config['url_template'])) {
        $baseUrl = isset($config['base_url']) ? rtrim((string)$config['base_url'], '/') : '';
        $database = isset($config['database']) ? trim((string)$config['database'], '/') : '';

        return strtr($config['url_template'], [
            '{base_url}' => $baseUrl,
            '{database}' => $database,
            '{endpoint}' => ltrim($endpoint, '/'),
        ]);
    }

    if ($endpoint[0] === '/') {
        return rtrim(gss_integram_host_url($config), '/') . $endpoint;
    }

    $endpoint = ltrim($endpoint, '/');
    $baseUrl = rtrim(gss_integram_host_url($config), '/');

    if (!empty($config['base_url_has_database'])) {
        return $baseUrl . '/' . $endpoint;
    }

    $database = isset($config['database']) ? trim((string)$config['database'], '/') : '';
    if ($database === '') {
        return $baseUrl . '/' . $endpoint;
    }

    return $baseUrl . '/' . $database . '/' . $endpoint;
}

function gss_integram_host_url($config) {
    $baseUrl = isset($config['base_url']) ? rtrim((string)$config['base_url'], '/') : '';
    if ($baseUrl !== '') {
        return $baseUrl;
    }

    $host = $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '';
    if ($host === '') {
        throw new RuntimeException('Integram base_url is empty and current host is unavailable.');
    }

    $https = $_SERVER['HTTPS'] ?? '';
    $scheme = (!empty($https) && strtolower((string)$https) !== 'off') ? 'https' : 'http';
    if (strpos($host, ':') === false && !empty($_SERVER['SERVER_PORT'])) {
        $port = (string)$_SERVER['SERVER_PORT'];
        if (($scheme === 'https' && $port !== '443') || ($scheme === 'http' && $port !== '80')) {
            $host .= ':' . $port;
        }
    }

    return $scheme . '://' . $host;
}

function gss_http_request($method, $url, $headers = [], $body = null, $options = []) {
    if (!function_exists('curl_init')) {
        throw new RuntimeException('The PHP cURL extension is required.');
    }

    $ch = curl_init();
    $curlOptions = [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_USERAGENT => 'Integram-Google-Sheets-Sync/1.0',
    ];

    if (!empty($options['timeout'])) {
        $curlOptions[CURLOPT_TIMEOUT] = (int)$options['timeout'];
    }

    if ($body !== null) {
        $curlOptions[CURLOPT_POSTFIELDS] = $body;
    }

    curl_setopt_array($ch, $curlOptions);
    $raw = curl_exec($ch);
    if ($raw === false) {
        $error = curl_error($ch);
        curl_close($ch);
        throw new RuntimeException("HTTP request failed: {$error}");
    }

    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $responseHeaders = substr($raw, 0, $headerSize);
    $responseBody = substr($raw, $headerSize);
    curl_close($ch);

    return [
        'status' => (int)$status,
        'headers' => $responseHeaders,
        'body' => $responseBody,
        'url' => $url,
    ];
}

function gss_assert_success($response, $context) {
    if ($response['status'] < 200 || $response['status'] >= 300) {
        $body = trim((string)$response['body']);
        if (strlen($body) > 1000) {
            $body = substr($body, 0, 1000) . '...';
        }
        throw new RuntimeException("{$context} failed with HTTP {$response['status']}: {$body}");
    }
}

function gss_decode_json($body, $context) {
    $json = json_decode($body, true);
    if (!is_array($json)) {
        throw new RuntimeException("Failed to parse {$context} JSON.");
    }
    return $json;
}

function gss_base64url_json($data) {
    return gss_base64url(json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
}

function gss_base64url($data) {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function gss_apply_overrides($config, $options) {
    if (!empty($options['output'])) {
        $config['output_file'] = gss_resolve_path($options['output'], getcwd());
    }
    if ($options['force_upload'] !== null) {
        $config['integram']['enabled'] = (bool)$options['force_upload'];
    }
    if (!empty($options['dry_run'])) {
        $config['integram']['enabled'] = false;
    }
    return $config;
}

function gss_print_summary($summary) {
    echo "Output file: {$summary['output_file']}\n";
    echo "Records: {$summary['record_count']}\n";
    foreach ($summary['sheet_summaries'] as $sheetSummary) {
        echo "- {$sheetSummary['sheet']}: {$sheetSummary['records']} records from {$sheetSummary['rows']} rows\n";
    }
    if ($summary['upload'] !== null) {
        echo "Upload: HTTP {$summary['upload']['status']} {$summary['upload']['url']}\n";
    } else {
        echo "Upload: skipped\n";
    }
}

function gss_main($argv) {
    $options = gss_parse_cli_options($argv);
    if ($options['help']) {
        echo gss_usage();
        return 0;
    }

    $config = gss_load_config($options['config']);
    $config = gss_apply_overrides($config, $options);
    $summary = gss_sync($config);
    gss_print_summary($summary);
    return 0;
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    try {
        exit(gss_main($argv ?? []));
    } catch (Throwable $e) {
        if (defined('STDERR')) {
            fwrite(STDERR, 'Error: ' . $e->getMessage() . "\n");
        } else {
            echo 'Error: ' . $e->getMessage() . "\n";
        }
        exit(1);
    }
}
