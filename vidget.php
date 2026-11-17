<?php
/**
 * vidget.php — скачивание видео/аудио через yt-dlp: YouTube, VK, Rutube, Яндекс, Дзен, ОК
 * и другие сайты, которые yt-dlp знает (ideav/crm#5523, #5525).
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

// Cookies YouTube-аккаунта в формате Netscape (cookies.txt), файл вне docroot
// (на ideav.ru — /var/www/www-root/data/vidget.cookies, владелец www-root, 600: yt-dlp
// дописывает в него обновлённые cookies). Без них YouTube на адресе выхода отвечает
// «Sign in to confirm you're not a bot». Путь меняется переменной VIDGET_COOKIES_FILE.
define('COOKIES_FILE', getenv('VIDGET_COOKIES_FILE') ?: dirname(__DIR__, 2) . '/vidget.cookies');

// Временная папка вне docroot: файлы в процессе загрузки не должны быть доступны по URL.
define('DOWNLOAD_DIR', rtrim(sys_get_temp_dir(), '/') . '/vidget');

set_time_limit(MAX_RUNTIME);

// ---------- Функции ----------
function urlHost(string $url): string
{
    $parts = parse_url($url);
    if (!$parts || !isset($parts['scheme'], $parts['host'])) {
        return '';
    }
    if (!in_array(strtolower($parts['scheme']), ['http', 'https'], true)) {
        return '';
    }
    return strtolower(trim($parts['host'], '[]'));
}

function isYoutubeHost(string $host): bool
{
    return (bool) preg_match('/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/', $host);
}

/**
 * Ссылка годится, если хост — публичный адрес: имя или IP, все адреса которого вне
 * частных/служебных диапазонов. Иначе yt-dlp пошёл бы за ссылкой во внутреннюю сеть сервера.
 */
function checkUrl(string $url): string
{
    $host = urlHost($url);
    if ($host === '') {
        return 'Нужна ссылка вида https://…';
    }
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        $ips = [$host];
    } else {
        $ips = array_merge(gethostbynamel($host) ?: [], dnsAaaa($host));
        if (!$ips) {
            return 'Сайт ' . $host . ' не найден.';
        }
    }
    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return 'Адрес ' . $host . ' недоступен для скачивания.';
        }
    }
    return '';
}

function dnsAaaa(string $host): array
{
    $recs = function_exists('dns_get_record') ? @dns_get_record($host, DNS_AAAA) : [];
    return array_column($recs ?: [], 'ipv6');
}

function proxyUrl(): string
{
    $raw = is_readable(PROXY_FILE) ? trim((string) file_get_contents(PROXY_FILE)) : '';
    // схема://[логин:пароль@]хост:порт — хост из латиницы/цифр/точек/дефисов (заглушка «…» не пройдёт)
    return preg_match('~^(socks5h?|socks4a?|https?)://([^\s@/]+@)?[A-Za-z0-9.-]+:\d{1,5}/?$~', $raw) ? $raw : '';
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
    $bad = checkUrl($url);
    if ($bad !== '') {
        return ['ok' => false, 'error' => $bad];
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
        '--no-progress',
        '--no-cache-dir',
        // только сайты, для которых в yt-dlp есть свой модуль (YouTube, VK, Rutube, Яндекс,
        // Дзен, ОК, Mail.ru и ещё ~1800); «generic» выключен — он пошёл бы по любой ссылке
        '--use-extractors', 'default,-generic',
        '--trim-filenames', '120',
        // TLS-рукопожатие через прокси иногда рвётся: повторять и докачивать, а не бросать
        '--retries', '30',
        '--fragment-retries', '30',
        '--socket-timeout', '30',
        '-o', $template,
    ];
    $youtube = isYoutubeHost(urlHost($url));
    // прокси — только для YouTube: российские сайты из-за рубежа часто не отдают видео
    $proxy = $youtube ? proxyUrl() : '';
    if ($proxy !== '') {
        array_push($args, '--proxy', $proxy);
    }
    // cookies аккаунта YouTube — только YouTube, другим сайтам их не отдаём
    if ($youtube && is_readable(COOKIES_FILE)) {
        array_push($args, '--cookies', COOKIES_FILE);
    }
    if (is_executable(FFMPEG_BIN)) {
        array_push($args, '--ffmpeg-location', FFMPEG_BIN);
    }

    if ($format === 'mp3') {
        array_push($args, '-x', '--audio-format', 'mp3');
    } else {
        array_push($args, '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4');
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
        $tail = implode("\n", array_slice($output, -5));
        if (stripos($tail, 'Unsupported URL') !== false) {
            return ['ok' => false, 'error' => 'Этот сайт не поддерживается.'];
        }
        return ['ok' => false, 'error' => 'Ошибка yt-dlp: ' . $tail];
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
    // имя может быть кириллицей: ASCII-запасной вариант + filename* в UTF-8 (RFC 6266)
    $ascii = preg_replace('/[^A-Za-z0-9._-]+/', '_', $name);
    header('Content-Disposition: attachment; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode($name));
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
    <h2>Скачать видео</h2>
    <p class="hint">YouTube, VK Видео, Rutube, Яндекс, Дзен, Одноклассники, Mail.ru и <a href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md" rel="noreferrer" target="_blank">другие сайты</a>.</p>
    <form method="post" onsubmit="document.getElementById('wait').hidden=false">
        <input type="text" name="url" placeholder="Ссылка на видео: https://…" required>
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
