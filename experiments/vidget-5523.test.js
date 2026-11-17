// rules: none (defect #5523)
// vidget.php — страница скачивания видео (ideav/crm#5523, #5525: не только YouTube).
// Поведение через настоящий PHP: встроенный сервер php -S отдаёт страницу, проверяем
// скрытие от роботов (X-Robots-Tag + meta robots) и отказ на ссылку не с YouTube до запуска yt-dlp.

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const page = path.join(root, 'vidget.php');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    console.log('SKIP — php не найден в PATH, vidget.php не проверен');
    return;
}

function request(port, method, body) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port, path: '/vidget.php', method,
            headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {},
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function waitUp(port) {
    for (let i = 0; i < 50; i++) {
        try { return await request(port, 'GET'); } catch (e) { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('php -S не поднялся');
}

(async () => {
    const port = 18000 + Math.floor(Math.random() * 1000);
    const srv = spawn('php', ['-S', '127.0.0.1:' + port, '-t', root], { stdio: 'ignore' });
    let failed = 0;
    const check = (name, fn) => {
        try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
    };
    try {
        const get = await waitUp(port);
        check('GET отдаёт страницу 200', () => assert.strictEqual(get.status, 200));
        check('заголовок X-Robots-Tag: noindex, nofollow', () =>
            assert.match(String(get.headers['x-robots-tag'] || ''), /noindex.*nofollow/));
        check('meta robots noindex в разметке', () =>
            assert.match(get.body, /<meta name="robots" content="noindex/));
        check('форма с полем url и выбором mp4/mp3', () => {
            assert.match(get.body, /name="url"/);
            assert.match(get.body, /name="quality"/);
            assert.match(get.body, /value="mp3"/);
        });

        const bad = await request(port, 'POST', 'url=' + encodeURIComponent('https://nonexistent-host-5525.invalid/watch?v=x') + '&format=mp4');
        check('несуществующий сайт отклонён без запуска yt-dlp', () => {
            assert.strictEqual(bad.status, 200);
            // «не найден»; за fake-ip DNS (sing-box: 198.18.0.0/15) — «недоступен»; yt-dlp не вызван в обоих
            assert.match(bad.body, /не найден|недоступен для скачивания/);
            assert.doesNotMatch(bad.body, /Ошибка yt-dlp|не установлен yt-dlp/);
        });
        const dash = await request(port, 'POST', 'url=' + encodeURIComponent('-oX https://youtube.com/') + '&format=mp4');
        check('аргумент-опция вместо ссылки отклонён', () => assert.match(dash.body, /Нужна ссылка вида/));
        check('страница называет не только YouTube', () => assert.match(get.body, /Rutube/));
    } catch (e) {
        failed++;
        console.log('FAIL ' + e.message);
    } finally {
        srv.kill();
    }

    // Ссылки во внутреннюю сеть сервера не уходят в yt-dlp (SSRF): CLI даёт код 1 с понятной причиной.
    const rejects = [
        ['ftp://youtube.com/x', /Нужна ссылка вида/],
        ['http://127.0.0.1/video', /недоступен/],
        ['http://localhost:8080/video', /недоступен/],
        ['http://192.168.0.74/video', /недоступен/],
        ['http://10.1.2.3/video', /недоступен/],
        ['http://169.254.169.254/latest/meta-data/', /недоступен/],
        ['http://[::1]/video', /недоступен/],
    ];
    for (const [u, re] of rejects) {
        const r = spawnSync('php', [page, u], { encoding: 'utf8' });
        check('CLI отклоняет ' + u, () => {
            assert.strictEqual(r.status, 1);
            assert.match(r.stderr, re);
        });
    }

    // Прокси из файла вне docroot доходит до yt-dlp аргументом --proxy; мусор в файле — нет.
    // yt-dlp подменён скриптом, который пишет полученные аргументы в файл.
    // PHP на Windows не считает .bat исполняемым (is_executable) — там блок пропускается, в CI (ubuntu) идёт.
    if (process.platform === 'win32') {
        console.log('SKIP прокси: подмена yt-dlp только на POSIX, проверка идёт в CI');
    } else {
    const fs = require('fs');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidget-'));
    const argsOut = path.join(tmp, 'args.txt');
    const fake = path.join(tmp, 'yt-dlp');
    fs.writeFileSync(fake, '#!/bin/sh\necho "$@" > "' + argsOut + '"\nexit 1\n');
    fs.chmodSync(fake, 0o755);
    const proxyFile = path.join(tmp, 'vidget.proxy');
    const cookiesFile = path.join(tmp, 'vidget.cookies');
    const runWithProxy = (content, url, cookies) => {
        fs.writeFileSync(proxyFile, content);
        try { fs.unlinkSync(argsOut); } catch (e) { /* нет — и ладно */ }
        try { fs.unlinkSync(cookiesFile); } catch (e) { /* нет — и ладно */ }
        if (cookies) fs.writeFileSync(cookiesFile, cookies);
        spawnSync('php', [page, url || 'https://www.youtube.com/watch?v=jNQXAC9IVRw'], {
            encoding: 'utf8',
            env: Object.assign({}, process.env, { VIDGET_YTDLP: fake, VIDGET_PROXY_FILE: proxyFile, VIDGET_COOKIES_FILE: cookiesFile }),
        });
        return fs.existsSync(argsOut) ? fs.readFileSync(argsOut, 'utf8') : '';
    };
    const withProxy = runWithProxy('socks5h://127.0.0.1:1080\n');
    check('прокси из файла передан yt-dlp', () => assert.match(withProxy, /--proxy\W+socks5h:\/\/127\.0\.0\.1:1080/));
    check('ссылка идёт после "--"', () => assert.match(withProxy, /--\W+https:\/\/www\.youtube\.com\/watch\?v=jNQXAC9IVRw/));
    // заглушка из подсказки, записанная вместо адреса (16.11 так и случилось на ideav.ru)
    const placeholder = runWithProxy('socks5h://…\n');
    check('заглушка «socks5h://…» не передаётся как прокси', () => {
        assert.ok(placeholder.length > 0, 'yt-dlp не был вызван');
        assert.doesNotMatch(placeholder, /--proxy/);
    });
    const withAuth = runWithProxy('socks5h://u:p@proxy.example.com:1080\n');
    check('прокси с логином и паролем передан', () => assert.match(withAuth, /--proxy\W+socks5h:\/\/u:p@proxy\.example\.com:1080/));
    const garbage = runWithProxy('rm -rf / ; echo\n');
    check('мусор в файле прокси не передаётся', () => {
        assert.ok(garbage.length > 0, 'yt-dlp не был вызван');
        assert.doesNotMatch(garbage, /--proxy/);
    });
    check('только сайты со своим модулем yt-dlp (generic выключен)', () =>
        assert.match(withProxy, /--use-extractors\W+default,-generic/));
    // не-YouTube (публичный IP — без DNS в тесте): yt-dlp вызван, прокси не передан
    const other = runWithProxy('socks5h://127.0.0.1:1080\n', 'https://1.1.1.1/video/123');
    check('не-YouTube идёт без прокси', () => {
        assert.match(other, /--\W+https:\/\/1\.1\.1\.1\/video\/123/);
        assert.doesNotMatch(other, /--proxy/);
    });
    // #5530: YouTube режет адрес выхода проверкой на бота — нужны cookies аккаунта из файла вне docroot
    const netscape = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tx\n';
    const ytCookies = runWithProxy('socks5h://127.0.0.1:1080\n', null, netscape);
    check('cookies из файла переданы yt-dlp для YouTube', () =>
        assert.ok(ytCookies.includes('--cookies ' + cookiesFile), ytCookies));
    check('без файла cookies --cookies не передаётся', () => {
        assert.ok(withProxy.length > 0, 'yt-dlp не был вызван');
        assert.doesNotMatch(withProxy, /--cookies/);
    });
    const otherCookies = runWithProxy('socks5h://127.0.0.1:1080\n', 'https://1.1.1.1/video/123', netscape);
    check('не-YouTube идёт без cookies YouTube', () => {
        assert.ok(otherCookies.length > 0, 'yt-dlp не был вызван');
        assert.doesNotMatch(otherCookies, /--cookies/);
    });
    // через туннель TLS-рукопожатие иногда рвётся — закачка повторяется, а не бросается на 10-й попытке
    check('повторы закачки увеличены', () => {
        const m = ytCookies.match(/--retries (\d+)/);
        assert.ok(m && Number(m[1]) >= 30, ytCookies);
        assert.match(ytCookies, /--fragment-retries \d+/);
    });
    // #5535: каждый обрыв связи ждёт --socket-timeout — 15 с, а не 30
    check('таймаут сокета 15 с', () => assert.match(ytCookies, /--socket-timeout 15( |$)/, ytCookies));
    // #5535: выбор качества — высота кадра не выше заданной; без выбора и при мусоре — лучшее
    const withQuality = (q) => {
        try { fs.unlinkSync(argsOut); } catch (e) { /* нет — и ладно */ }
        spawnSync('php', [page, 'https://1.1.1.1/video/123', 'mp4'].concat(q ? [q] : []), {
            encoding: 'utf8', env: Object.assign({}, process.env, { VIDGET_YTDLP: fake, VIDGET_PROXY_FILE: proxyFile }),
        });
        return fs.existsSync(argsOut) ? fs.readFileSync(argsOut, 'utf8') : '';
    };
    const q720 = withQuality('720');
    check('качество 720p ограничивает высоту кадра', () => {
        assert.match(q720, /-f [^ ]*\[height<=720\]/, q720);
        assert.doesNotMatch(q720, /height<=1080/);
    });
    const qBest = withQuality(null);
    check('без выбора качества — без ограничения высоты', () => {
        assert.ok(qBest.length > 0, 'yt-dlp не был вызван');
        assert.doesNotMatch(qBest, /height<=/);
    });
    const qJunk = withQuality('9999]+ba/b[x');
    check('мусор вместо качества не попадает в -f', () => {
        assert.ok(qJunk.length > 0, 'yt-dlp не был вызван');
        assert.doesNotMatch(qJunk, /9999|height<=/);
    });
    fs.rmSync(tmp, { recursive: true, force: true });
    }

    if (failed) {
        console.log('FAIL — vidget-5523: ' + failed);
        process.exitCode = 1;
    } else {
        console.log('PASS — vidget-5523');
    }
})();
