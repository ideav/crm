<?php
/**
 * Settings for google_sheets_sync.php.
 *
 * Copy real Google service-account credentials to include/credentials.json,
 * share the spreadsheet with that service-account email, then fill
 * spreadsheet_id and Integram upload tokens below. credentials.json is ignored
 * by git.
 */

return [
    'credentials_path' => __DIR__ . '/include/credentials.json',
    'spreadsheet_id' => '',
    'output_file' => __DIR__ . '/logs/google_sheets_sync.bki',
    'skip_empty_values' => false,
    'debug' => false,

    'sheets' => [
        [
            'name' => '(План-Факт) (2026)',
            'rows' => [
                'Выручка (ддл)',
                'Выручка (ддо)',
                'Выручка (ддо - b2b)',
                'Выручка (ддо - b2g - кружки)',
                'Выручка (ддо - b2g - выезды)',
                'Выручка (д.о.п)',
            ],
            'columns' => [
                ['01.**.202*', '3*.**.202*', "'ПЛАН'||'ФАКТ'"],
                ['01.02.202*', "'28.02.202*'||'29.02.202*'", "'ПЛАН'||'ФАКТ'"],
                '2025',
                '2026',
            ],
        ],
    ],

    'integram' => [
        'enabled' => false,
        'base_url' => 'https://ideav.ru',
        'token' => '',
        'xsrf' => '',
        'upload_endpoint' => '/object/443296?JSON&import=1',
    ],
];
