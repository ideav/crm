// rules: none (defect #5523)
// vidget.php — страница скачивания видео с YouTube (ideav/crm#5523).
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
            assert.match(get.body, /value="mp3"/);
        });

        const bad = await request(port, 'POST', 'url=' + encodeURIComponent('https://evil.example/watch?v=x') + '&format=mp4');
        check('чужой хост отклонён без запуска yt-dlp', () => {
            assert.strictEqual(bad.status, 200);
            assert.match(bad.body, /Некорректная ссылка YouTube/);
        });
        const dash = await request(port, 'POST', 'url=' + encodeURIComponent('-oX https://youtube.com/') + '&format=mp4');
        check('аргумент-опция вместо ссылки отклонён', () => assert.match(dash.body, /Некорректная ссылка YouTube/));
    } catch (e) {
        failed++;
        console.log('FAIL ' + e.message);
    } finally {
        srv.kill();
    }

    const cli = spawnSync('php', [page, 'ftp://youtube.com/x'], { encoding: 'utf8' });
    if (cli.status !== 1 || !/Некорректная ссылка/.test(cli.stderr)) {
        failed++;
        console.log('FAIL CLI: не-http ссылка должна давать код 1, получили ' + cli.status + ' ' + cli.stderr);
    } else {
        console.log('ok   CLI отклоняет не-http ссылку');
    }

    if (failed) {
        console.log('FAIL — vidget-5523: ' + failed);
        process.exitCode = 1;
    } else {
        console.log('PASS — vidget-5523');
    }
})();
