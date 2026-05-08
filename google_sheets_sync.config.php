<?php
/**
 * Settings for google_sheets_sync.php.
 *
 * Copy real Google service-account credentials to credentials.json, share the
 * spreadsheet with that service-account email, then fill spreadsheet_id and
 * Integram credentials below. credentials.json is ignored by git.
 */

return [
    'credentials_path' => __DIR__ . '/credentials.json',
    'spreadsheet_id' => '',
    'output_file' => __DIR__ . '/google_sheets_sync.bki',
    'skip_empty_values' => false,
    'debug' => false,

    'sheets' => [
        [
            'name' => 'Выручка (ддо - b2b)',
            'rows' => [
                'Выручка (ддл)',
                'Выручка (ддо)',
                'Выручка (ддо - b2b)',
                'Выручка (ддо - b2g - кружки)',
                'Выручка (ддо - b2g - выезды)',
                'Выручка (д.о.п)',
            ],
            'columns' => [
                ['01.01.2026', '31.01.2026', 'ПЛАН'],
                '2025',
                '2026',
            ],
        ],
    ],

    'integram' => [
        'enabled' => false,
        'base_url' => 'https://ideav.ru',
        'database' => '',
        'login' => '',
        'password' => '',
        'object' => '',
        'auth_endpoint' => 'auth?JSON',
        'xsrf_endpoint' => 'xsrf?JSON',
        'upload_endpoint' => 'object/{object}?JSON&import=1',
    ],
];
