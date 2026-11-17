// rules: none (defect #5523)
// vidget.php: закачка в фоне с прогрессом. Страница шлёт POST async=1 → id задания,
// опрашивает ?job=<id> (проценты, этап), по готовности забирает ?file=<id>.
// yt-dlp подменён скриптом: печатает строки прогресса, как настоящий с --newline, и пишет файл.

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');

const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    console.log('SKIP — php не найден в PATH, vidget.php не проверен');
    return;
}
if (process.platform === 'win32') {
    console.log('SKIP — подмена yt-dlp только на POSIX, проверка идёт в CI');
    return;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidget-prog-'));
const gate = path.join(tmp, 'go');      // пока файла нет, поддельный yt-dlp ждёт на 42%
const fake = path.join(tmp, 'yt-dlp');
fs.writeFileSync(fake, [
    '#!/bin/sh',
    'out=""; prev=""; url=""',
    'for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; url="$a"; done',
    'case "$url" in *fail*) echo "ERROR: [youtube] x: Video unavailable"; exit 1;; esac',
    'f=$(printf "%s" "$out" | sed "s/%(title)\\.80s/Клип/; s/%(ext)s/mp4/")',
    'echo "[youtube] x: Downloading webpage"',
    'echo "[download] Destination: $f"',
    'echo "[download]  42.0% of 1.00MiB at 1.00MiB/s ETA 00:01"',
    'i=0; while [ ! -f "' + gate + '" ] && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done',
    'echo "[download] 100% of 1.00MiB"',
    'printf "VIDEO" > "$f"',
    'exit 0',
    '',
].join('\n'));
fs.chmodSync(fake, 0o755);

function request(port, method, p, body) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port, path: p, method,
            headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {},
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(port, id, pred) {
    let s;
    for (let i = 0; i < 60; i++) {
        s = JSON.parse((await request(port, 'GET', '/vidget.php?job=' + id)).body);
        if (pred(s)) return s;
        await sleep(100);
    }
    throw new Error('статус не дошёл до ожидаемого: ' + JSON.stringify(s));
}

(async () => {
    const port = 19000 + Math.floor(Math.random() * 1000);
    const srv = spawn('php', ['-S', '127.0.0.1:' + port, '-t', root], {
        stdio: 'ignore',
        env: Object.assign({}, process.env, { VIDGET_YTDLP: fake, VIDGET_PROXY_FILE: path.join(tmp, 'none'), VIDGET_COOKIES_FILE: path.join(tmp, 'none') }),
    });
    let failed = 0;
    const check = (name, fn) => {
        try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
    };
    try {
        let page;
        for (let i = 0; i < 50 && !page; i++) {
            try { page = await request(port, 'GET', '/vidget.php'); } catch (e) { await sleep(100); }
        }
        check('на странице крутилка и полоса прогресса', () => {
            assert.match(page.body, /class="spin"/);
            assert.match(page.body, /id="bar"/);
        });

        const bad = await request(port, 'POST', '/vidget.php', 'async=1&url=' + encodeURIComponent('http://127.0.0.1/x'));
        check('плохая ссылка — JSON с ошибкой сразу', () => {
            const r = JSON.parse(bad.body);
            assert.strictEqual(r.ok, false);
            assert.match(r.error, /недоступен/);
        });

        const t0 = Date.now();
        const start = await request(port, 'POST', '/vidget.php', 'async=1&format=mp4&url=' + encodeURIComponent('https://1.1.1.1/video/1'));
        const r = JSON.parse(start.body);
        check('запуск отвечает сразу, не дожидаясь yt-dlp', () => {
            assert.strictEqual(r.ok, true, start.body);
            assert.match(r.id, /^[0-9a-f]{12}$/);
            assert.ok(Date.now() - t0 < 3000, 'ответ через ' + (Date.now() - t0) + ' мс');
        });

        const mid = await pollUntil(port, r.id, (s) => typeof s.percent === 'number');
        check('в процессе — проценты из вывода yt-dlp', () => {
            assert.strictEqual(mid.state, 'running');
            assert.strictEqual(mid.percent, 42);
        });
        const early = await request(port, 'GET', '/vidget.php?file=' + r.id);
        check('?file до готовности — 404', () => assert.strictEqual(early.status, 404));

        fs.writeFileSync(gate, '');
        const fin = await pollUntil(port, r.id, (s) => s.state !== 'running');
        check('по завершении — state=done', () => assert.strictEqual(fin.state, 'done', JSON.stringify(fin)));
        const file = await request(port, 'GET', '/vidget.php?file=' + r.id);
        check('готовый файл отдаётся вложением', () => {
            assert.strictEqual(file.status, 200);
            assert.strictEqual(file.body, 'VIDEO');
            assert.match(String(file.headers['content-disposition']), /attachment/);
        });
        const again = await request(port, 'GET', '/vidget.php?file=' + r.id);
        check('второй раз файл не отдаётся', () => assert.strictEqual(again.status, 404));

        const f = JSON.parse((await request(port, 'POST', '/vidget.php', 'async=1&url=' + encodeURIComponent('https://1.1.1.1/fail'))).body);
        const ferr = await pollUntil(port, f.id, (s) => s.state !== 'running');
        check('ошибка yt-dlp доходит до страницы', () => {
            assert.strictEqual(ferr.state, 'error');
            assert.match(ferr.error, /Video unavailable/);
        });

        const inj = JSON.parse((await request(port, 'GET', '/vidget.php?job=' + encodeURIComponent('../../etc/passwd'))).body);
        check('чужой путь вместо id отклонён', () => assert.strictEqual(inj.state, 'error'));
    } catch (e) {
        failed++;
        console.log('FAIL ' + e.message);
    } finally {
        srv.kill();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    if (failed) {
        console.log('FAIL — vidget-progress: ' + failed);
        process.exitCode = 1;
    } else {
        console.log('PASS — vidget-progress');
    }
})();
