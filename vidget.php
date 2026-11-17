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
 *   CLI:     php vidget.php "https://www.youtube.com/watch?v=XXXX" [mp4|mp3] [best|1080|720|480]
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

/** Качество видео из формы: высота кадра (не выше) или best. Чужое значение — best. */
function quality(string $q): string
{
    return in_array($q, ['1080', '720', '480'], true) ? $q : 'best';
}

/** Выбор формата yt-dlp: mp4 c m4a, иначе что есть; с ограничением высоты кадра, если задано. */
function videoFormat(string $quality): string
{
    $h = $quality === 'best' ? '' : '[height<=' . $quality . ']';
    $f = 'bv*' . $h . '[ext=mp4]+ba[ext=m4a]/b' . $h . '[ext=mp4]/bv*' . $h . '+ba/b' . $h;
    // сайт не сообщил высоту ни одного формата — берём лучшее, а не падаем
    return $h === '' ? $f : $f . '/b';
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
 * Проверки и командная строка yt-dlp для задания $id.
 * $progress — печатать прогресс построчно (для фоновой закачки со страницы).
 *
 * @return array{ok:bool, cmd?:string, error?:string}
 */
function prepareJob(string $url, string $format, string $id, bool $progress, string $quality = 'best'): array
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

    $template = DOWNLOAD_DIR . '/' . $id . '_%(title).80s.%(ext)s';

    $args = [];
    // фоновая закачка не ограничена set_time_limit запроса — её обрывает timeout
    if ($progress && is_executable('/usr/bin/timeout')) {
        array_push($args, '/usr/bin/timeout', (string) MAX_RUNTIME);
    }
    array_push($args,
        YTDLP_BIN,
        '--no-playlist',
        $progress ? '--newline' : '--no-progress',
        '--no-cache-dir',
        // только сайты, для которых в yt-dlp есть свой модуль (YouTube, VK, Rutube, Яндекс,
        // Дзен, ОК, Mail.ru и ещё ~1800); «generic» выключен — он пошёл бы по любой ссылке
        '--use-extractors', 'default,-generic',
        '--trim-filenames', '120',
        // TLS-рукопожатие через прокси иногда рвётся: повторять и докачивать, а не бросать
        '--retries', '30',
        '--fragment-retries', '30',
        '--socket-timeout', '15',
        '-o', $template
    );
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
        array_push($args, '-f', videoFormat($quality), '--merge-output-format', 'mp4');
    }
    // "--" — дальше только URL, даже если он начинается с дефиса
    array_push($args, '--', $url);

    // Каждый аргумент экранируется — защита от command injection
    return ['ok' => true, 'cmd' => implode(' ', array_map('escapeshellarg', $args))];
}

/**
 * Итог закачки $id по коду выхода и выводу yt-dlp.
 *
 * @return array{ok:bool, file?:string, error?:string}
 */
function jobResult(string $id, int $code, array $output): array
{
    $files = array_values(array_filter(
        glob(DOWNLOAD_DIR . '/' . $id . '_*') ?: [],
        function ($f) { return !preg_match('/\.(part|ytdl|temp)$/', $f); }
    ));
    if ($code !== 0 || !$files) {
        foreach (glob(DOWNLOAD_DIR . '/' . $id . '_*') ?: [] as $f) {
            @unlink($f);
        }
        // строки прогресса в причину ошибки не берём
        $output = array_filter($output, function ($l) { return !preg_match('/^\[download\]\s+[\d.]+%/', $l); });
        $tail = implode("\n", array_slice($output, -5));
        if (stripos($tail, 'Unsupported URL') !== false) {
            return ['ok' => false, 'error' => 'Этот сайт не поддерживается.'];
        }
        if ($code === 124) {
            return ['ok' => false, 'error' => 'Закачка не уложилась в ' . intdiv(MAX_RUNTIME, 60) . ' минут.'];
        }
        return ['ok' => false, 'error' => 'Ошибка yt-dlp: ' . $tail];
    }
    return ['ok' => true, 'file' => $files[0]];
}

/**
 * Синхронная закачка (CLI и форма без JavaScript).
 *
 * @return array{ok:bool, file?:string, error?:string}
 */
function downloadVideo(string $url, string $format = 'mp4', string $quality = 'best'): array
{
    $id  = bin2hex(random_bytes(6));
    $job = prepareJob($url, $format, $id, false, $quality);
    if (!$job['ok']) {
        return $job;
    }
    exec($job['cmd'] . ' 2>&1', $output, $code);
    return jobResult($id, $code, $output);
}

// ---------- Фоновая закачка с прогрессом (страница опрашивает статус) ----------
function jobPath(string $id, string $ext): string
{
    return DOWNLOAD_DIR . '/' . $id . '.' . $ext; // без «_» — не попадает в glob файлов результата
}

function validJobId(string $id): bool
{
    return (bool) preg_match('/^[0-9a-f]{12}$/', $id);
}

/**
 * @return array{ok:bool, id?:string, error?:string}
 */
function startJob(string $url, string $format, string $quality = 'best'): array
{
    $id  = bin2hex(random_bytes(6));
    $job = prepareJob($url, $format, $id, true, $quality);
    if (!$job['ok']) {
        return $job;
    }
    $log  = escapeshellarg(jobPath($id, 'log'));
    $code = jobPath($id, 'code');
    // код выхода пишется через временный файл и mv — опрос не прочтёт его наполовину
    $inner = $job['cmd'] . ' > ' . $log . ' 2>&1; echo $? > ' . escapeshellarg($code . '.tmp')
        . ' && mv ' . escapeshellarg($code . '.tmp') . ' ' . escapeshellarg($code);
    exec('nohup sh -c ' . escapeshellarg($inner) . ' > /dev/null 2>&1 &');
    return ['ok' => true, 'id' => $id];
}

function dropJob(string $id): void
{
    foreach (['log', 'code', 'code.tmp'] as $ext) {
        @unlink(jobPath($id, $ext));
    }
}

/**
 * @return array{state:string, percent?:float, stage?:string, error?:string}
 */
function jobStatus(string $id): array
{
    $logFile = jobPath($id, 'log');
    $log     = is_readable($logFile) ? (string) file_get_contents($logFile) : '';
    $codeRaw = @file_get_contents(jobPath($id, 'code'));
    if ($codeRaw === false && $log === '') {
        // yt-dlp ещё ничего не написал; зависшее задание страница бросает по своему таймеру
        return ['state' => 'running', 'stage' => 'Запускаем…'];
    }
    if ($codeRaw !== false && trim($codeRaw) !== '') {
        $res = jobResult($id, (int) trim($codeRaw), preg_split('/\r?\n/', trim($log)));
        if (!$res['ok']) {
            dropJob($id);
            return ['state' => 'error', 'error' => $res['error']];
        }
        return ['state' => 'done'];
    }

    $lines = preg_split('/\r?\n/', trim($log));
    $parts = count(preg_grep('/^\[download\] Destination:/', $lines));
    $last  = (string) end($lines);
    if (preg_match('/^\[(Merger|VideoConvertor|FixupM3u8)\]/', $last)) {
        return ['state' => 'running', 'stage' => 'Склеиваем видео и звук…'];
    }
    if (preg_match('/^\[ExtractAudio\]/', $last)) {
        return ['state' => 'running', 'stage' => 'Конвертируем в MP3…'];
    }
    $res = ['state' => 'running'];
    // обрыв связи: yt-dlp ждёт до --socket-timeout и повторяет — без этой строки страница «висит»
    if (preg_match('/Retrying \((\d+)\/(\d+)\)/', $last, $r)) {
        $res['note'] = 'связь с сайтом оборвалась, повтор ' . $r[1] . ' из ' . $r[2];
    }
    if (preg_match_all('/^\[download\]\s+([\d.]+)% of\s+~?\s*([\d.]+)(\w+)(?:.*ETA\s+([\d:]+))?/m', $log, $m, PREG_SET_ORDER)) {
        $p = end($m);
        $res['percent'] = (float) $p[1];
        $res['size']    = $p[2] . ' ' . strtr($p[3], ['GiB' => 'ГБ', 'MiB' => 'МБ', 'KiB' => 'КБ']);
        if (!empty($p[4]) && !isset($res['note'])) {
            $res['eta'] = $p[4];
        }
        $res['stage'] = $parts > 1 ? 'Качаем звук' : 'Качаем';
        return $res;
    }
    $res['stage'] = preg_grep('/Solving JS challenges/', $lines)
        ? 'Проходим проверку сайта…' : 'Получаем сведения о видео…';
    return $res;
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
    $res    = downloadVideo($url, $format, quality($argv[3] ?? 'best'));
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

function sendJson(array $data): void
{
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// статус фоновой закачки: ?job=<id>
if (isset($_GET['job'])) {
    $id = (string) $_GET['job'];
    sendJson(validJobId($id) ? jobStatus($id) : ['state' => 'error', 'error' => 'Задание не найдено.']);
}
// готовый файл фоновой закачки: ?file=<id>
if (isset($_GET['file'])) {
    $id  = (string) $_GET['file'];
    $res = validJobId($id) && trim((string) @file_get_contents(jobPath($id, 'code'))) === '0'
        ? jobResult($id, 0, []) : ['ok' => false];
    if ($res['ok']) {
        dropJob($id);
        sendFile($res['file']);
    }
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Файл не найден или уже скачан.';
    exit;
}

$error = '';
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $url    = trim($_POST['url'] ?? '');
    $format = ($_POST['format'] ?? 'mp4') === 'mp3' ? 'mp3' : 'mp4';
    $quality = quality($_POST['quality'] ?? 'best');
    if (!empty($_POST['async'])) {
        sendJson(startJob($url, $format, $quality));
    }
    // без JavaScript: закачка в этом же запросе, файл — ответом
    $res    = downloadVideo($url, $format, $quality);
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
        #wait { display: flex; align-items: center; gap: 10px; }
        #wait[hidden] { display: none; }
        .spin { flex: none; width: 18px; height: 18px; border: 3px solid #ddd; border-top-color: #1a73e8;
                border-radius: 50%; animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .bar { height: 6px; background: #eee; border-radius: 3px; margin-top: 8px; overflow: hidden; }
        .bar[hidden] { display: none; }
        .bar > div { height: 100%; width: 0; background: #1a73e8; transition: width .4s; }
        .ok { color: #137333; margin-top: 12px; }
        .err:empty { display: none; }
    </style>
</head>
<body>
    <h2>Скачать видео</h2>
    <p class="hint">YouTube, VK Видео, Rutube, Яндекс, Дзен, Одноклассники, Mail.ru и <a href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md" rel="noreferrer" target="_blank">другие сайты</a>.</p>
    <form method="post" id="form">
        <input type="text" name="url" placeholder="Ссылка на видео: https://…" required>
        <p>
            <label><input type="radio" name="format" value="mp4" checked> Видео (MP4)</label>
            <label><input type="radio" name="format" value="mp3"> Только аудио (MP3)</label>
        </p>
        <p>
            <label>Качество видео:
                <select name="quality">
                    <option value="best">Лучшее</option>
                    <option value="1080">До 1080p</option>
                    <option value="720" selected>До 720p — быстрее</option>
                    <option value="480">До 480p</option>
                </select>
            </label>
        </p>
        <button type="submit" id="go">Скачать</button>
    </form>
    <div id="wait" class="hint" hidden><span class="spin"></span><span id="stage">Качаем на сервер, потом браузер предложит сохранить файл. Длинное видео — до нескольких минут.</span></div>
    <div class="bar" id="bar" hidden><div id="fill"></div></div>
    <div class="ok" id="done" hidden>Готово — браузер сохраняет файл.</div>
    <div class="err" id="err"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div>
<script>
(function () {
    var form = document.getElementById('form'), go = document.getElementById('go');
    var wait = document.getElementById('wait'), stage = document.getElementById('stage');
    var bar = document.getElementById('bar'), fill = document.getElementById('fill');
    var done = document.getElementById('done'), err = document.getElementById('err');
    var LIMIT_MS = <?= (MAX_RUNTIME + 60) * 1000 ?>;

    function finish(msg) {
        wait.hidden = true; bar.hidden = true; go.disabled = false;
        if (msg) err.textContent = msg; else done.hidden = false;
    }
    function poll(id, started) {
        if (Date.now() - started > LIMIT_MS) return finish('Сервер не ответил, попробуйте ещё раз.');
        fetch('?job=' + id, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) {
            if (s.state === 'error') return finish(s.error);
            if (s.state === 'done') { finish(''); location.href = '?file=' + id; return; }
            var pct = typeof s.percent === 'number' ? s.percent : null;
            stage.textContent = (s.stage || 'Качаем')
                + (pct !== null ? ' — ' + pct.toFixed(1) + '%' + (s.size ? ' из ' + s.size : '') : '')
                + (s.eta ? ', осталось ' + s.eta : '')
                + (s.note ? ' (' + s.note + '…)' : '');
            bar.hidden = pct === null;
            if (pct !== null) fill.style.width = pct + '%';
            setTimeout(function () { poll(id, started); }, 1000);
        }).catch(function () { setTimeout(function () { poll(id, started); }, 2000); });
    }
    form.addEventListener('submit', function (e) {
        if (!window.fetch) { wait.hidden = false; return; } // старый браузер — обычная отправка
        e.preventDefault();
        var data = new FormData(form);
        data.append('async', '1');
        err.textContent = ''; done.hidden = true; go.disabled = true;
        wait.hidden = false; bar.hidden = true; fill.style.width = '0';
        stage.textContent = 'Проверяем ссылку…';
        fetch(location.pathname, { method: 'POST', body: data }).then(function (r) { return r.json(); }).then(function (r) {
            if (!r.ok) return finish(r.error);
            poll(r.id, Date.now());
        }).catch(function () { finish('Сервер не ответил, попробуйте ещё раз.'); });
    });
})();
</script>
</body>
</html>
