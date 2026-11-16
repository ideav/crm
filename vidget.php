<?php
/**
 * vidget.php — скачивание видео/аудио с YouTube через yt-dlp (ideav/crm#5523).
 *
 * Страница скрыта от поисковиков: заголовок X-Robots-Tag и meta robots = noindex.
 * В robots.txt её НЕ вписываем — Disallow выдал бы адрес любому, кто его откроет.
 *
 * Требования на сервере:
 *   - PHP 7.4+ с разрешённой exec
 *   - yt-dlp  (https://github.com/yt-dlp/yt-dlp), путь — YTDLP_BIN
 *   - ffmpeg  (склейка видео и аудио, конвертация в mp3)
 *
 * Использование:
 *   Браузер: открыть /vidget.php, вставить ссылку
 *   CLI:     php vidget.php "https://www.youtube.com/watch?v=XXXX" [mp4|mp3]
 */

// ---------- Настройки ----------
define('YTDLP_BIN', getenv('VIDGET_YTDLP') ?: '/usr/local/bin/yt-dlp');
const FFMPEG_BIN  = '/usr/bin/ffmpeg';
const MAX_RUNTIME = 600;     // секунд
const STALE_AFTER = 3600;    // недоотданные файлы старше часа удаляются

// Прокси для yt-dlp (YouTube недоступен с серверов в РФ): одна строка вида
// socks5://127.0.0.1:1080 или http://user:pass@host:port в файле вне docroot
// (на ideav.ru — /var/www/www-root/data/vidget.proxy). Путь меняется переменной VIDGET_PROXY_FILE.
define('PROXY_FILE', getenv('VIDGET_PROXY_FILE') ?: dirname(__DIR__, 2) . '/vidget.proxy');

// Временная папка вне docroot: файлы в процессе загрузки не должны быть доступны по URL.
define('DOWNLOAD_DIR', rtrim(sys_get_temp_dir(), '/') . '/vidget');

set_time_limit(MAX_RUNTIME);

// ---------- Функции ----------
function isYoutubeUrl(string $url): bool
{
    $parts = parse_url($url);
    if (!$parts || !isset($parts['scheme'], $parts['host'])) {
        return false;
    }
    if (!in_array($parts['scheme'], ['http', 'https'], true)) {
        return false;
    }
    $host = strtolower($parts['host']);
    return (bool) preg_match('/^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)$/', $host);
}

function proxyUrl(): string
{
    $raw = is_readable(PROXY_FILE) ? trim((string) file_get_contents(PROXY_FILE)) : '';
    return preg_match('~^(socks5h?|socks4a?|https?)://\S+$~', $raw) ? $raw : '';
}

function cleanupStale(): void
{
    foreach (glob(DOWNLOAD_DIR . '/*') ?: [] as $f) {
        if (is_file($f) && filemtime($f) < time() - STALE_AFTER) {
            @unlink($f);
        }
    }
}

/**
 * @return array{ok:bool, file?:string, error?:string}
 */
function downloadVideo(string $url, string $format = 'mp4'): array
{
    if (!isYoutubeUrl($url)) {
        return ['ok' => false, 'error' => 'Некорректная ссылка YouTube.'];
    }
    if (!is_executable(YTDLP_BIN)) {
        return ['ok' => false, 'error' => 'На сервере не установлен yt-dlp.'];
    }
    if (!is_dir(DOWNLOAD_DIR) && !mkdir(DOWNLOAD_DIR, 0700, true)) {
        return ['ok' => false, 'error' => 'Не удалось создать папку для загрузок.'];
    }
    cleanupStale();

    $id       = bin2hex(random_bytes(6));
    $template = DOWNLOAD_DIR . '/' . $id . '_%(title).80s.%(ext)s';

    $args = [
        YTDLP_BIN,
        '--no-playlist',
        '--restrict-filenames',
        '--no-progress',
        '--no-cache-dir',
        '-o', $template,
    ];
    $proxy = proxyUrl();
    if ($proxy !== '') {
        array_push($args, '--proxy', $proxy);
    }
    if (is_executable(FFMPEG_BIN)) {
        array_push($args, '--ffmpeg-location', FFMPEG_BIN);
    }

    if ($format === 'mp3') {
        array_push($args, '-x', '--audio-format', 'mp3');
    } else {
        array_push($args, '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b', '--merge-output-format', 'mp4');
    }
    // "--" — дальше только URL, даже если он начинается с дефиса
    array_push($args, '--', $url);

    // Каждый аргумент экранируется — защита от command injection
    $cmd = implode(' ', array_map('escapeshellarg', $args)) . ' 2>&1';
    exec($cmd, $output, $code);

    $files = array_values(array_filter(
        glob(DOWNLOAD_DIR . '/' . $id . '_*') ?: [],
        function ($f) { return !preg_match('/\.(part|ytdl|temp)$/', $f); }
    ));
    if ($code !== 0 || !$files) {
        foreach (glob(DOWNLOAD_DIR . '/' . $id . '_*') ?: [] as $f) {
            @unlink($f);
        }
        return ['ok' => false, 'error' => 'Ошибка yt-dlp: ' . implode("\n", array_slice($output, -5))];
    }
    return ['ok' => true, 'file' => $files[0]];
}

function sendFile(string $path): void
{
    $name = preg_replace('/^[0-9a-f]{12}_/', '', basename($path));
    while (ob_get_level()) {
        ob_end_clean();
    }
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . $name . '"; filename*=UTF-8\'\'' . rawurlencode($name));
    header('Content-Length: ' . filesize($path));
    readfile($path);
    unlink($path); // удаляем файл после отдачи
    exit;
}

// ---------- CLI ----------
if (PHP_SAPI === 'cli') {
    $url    = $argv[1] ?? '';
    $format = ($argv[2] ?? 'mp4') === 'mp3' ? 'mp3' : 'mp4';
    $res    = downloadVideo($url, $format);
    if ($res['ok']) {
        echo "Готово: {$res['file']}\n";
        exit(0);
    }
    fwrite(STDERR, $res['error'] . "\n");
    exit(1);
}

// ---------- Web ----------
header('X-Robots-Tag: noindex, nofollow, noarchive, nosnippet');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

$error = '';
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $url    = trim($_POST['url'] ?? '');
    $format = ($_POST['format'] ?? 'mp4') === 'mp3' ? 'mp3' : 'mp4';
    $res    = downloadVideo($url, $format);
    if ($res['ok']) {
        sendFile($res['file']);
    }
    $error = $res['error'];
}
header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
    <meta name="referrer" content="no-referrer">
    <title>Видео</title>
    <style>
        body { font-family: sans-serif; max-width: 520px; margin: 60px auto; padding: 0 16px; }
        input[type=text] { width: 100%; padding: 8px; box-sizing: border-box; }
        button { margin-top: 12px; padding: 8px 16px; }
        .err { color: #b00020; white-space: pre-wrap; margin-top: 12px; }
        .hint { color: #666; font-size: 13px; margin-top: 12px; }
    </style>
</head>
<body>
    <h2>Скачать видео с YouTube</h2>
    <form method="post" onsubmit="document.getElementById('wait').hidden=false">
        <input type="text" name="url" placeholder="https://www.youtube.com/watch?v=..." required>
        <p>
            <label><input type="radio" name="format" value="mp4" checked> Видео (MP4)</label>
            <label><input type="radio" name="format" value="mp3"> Только аудио (MP3)</label>
        </p>
        <button type="submit">Скачать</button>
    </form>
    <div id="wait" class="hint" hidden>Качаем на сервер, потом браузер предложит сохранить файл. Длинное видео — до нескольких минут.</div>
    <?php if ($error): ?>
        <div class="err"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div>
    <?php endif; ?>
</body>
</html>
