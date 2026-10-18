// #5186: адрес с вебрута, не похожий на имя базы (DB_MASK), — браузеру HTML-страница вместо
// голого текста «Invalid database». Адрес с точкой (*.html и т.п.) — «Страница не найдена» со
// ссылкой на главную; прочее — «Invalid database» со ссылкой на вход. Fetch/curl/JSON API —
// прежний текст «Invalid database» (js/app.js читает не-JSON ответ как «базы нет»).
// Ветка в index.php срабатывает до include/connection.php, поэтому БД не нужна: гоняем ядро
// php-шником с подставленным $_SERVER.

const { spawnSync } = require('child_process');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });

function hit(uri, { accept = '', get = {}, locale = '' } = {}) {
    const code = '$_SERVER["REQUEST_URI"]=' + JSON.stringify(uri) + ';'
        + '$_SERVER["REQUEST_METHOD"]="GET";'
        + (accept ? '$_SERVER["HTTP_ACCEPT"]=' + JSON.stringify(accept) + ';' : '')
        + '$_GET=json_decode(' + JSON.stringify(JSON.stringify(get)) + ', true);'
        + (locale ? '$_COOKIE["my_locale"]=' + JSON.stringify(locale) + ';' : '')
        + 'include "index.php";';
    const run = spawnSync('php', ['-d', 'display_errors=stderr', '-r', code], { cwd: root, encoding: 'utf8' });
    return run.stdout;
}

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

test('#5186 ответ ядра на адрес, не похожий на базу', { skip: probe.error ? 'php не найден в PATH' : false }, async (t) => {
    await t.test('удалённая *.html из браузера — страница 404 со ссылкой на главную', () => {
        const out = hit('/put-mega-adepta.html', { accept: BROWSER });
        assert.match(out, /<title>404 — Страница не найдена<\/title>/);
        assert.match(out, /<a href="\/">На главную<\/a>/);
        assert.doesNotMatch(out, /Invalid database/);
        assert.doesNotMatch(out, /put-mega-adepta/, 'адрес из URL на страницу не выводится');
    });

    await t.test('имя базы вне маски из браузера — «Invalid database» со ссылкой на вход', () => {
        const out = hit('/no-such-db', { accept: BROWSER });
        assert.match(out, /<h1>Invalid database<\/h1>/);
        assert.match(out, /<a href="\/my">Вход<\/a>/);
    });

    await t.test('английская локаль — английский текст', () => {
        const out = hit('/old-page.html', { accept: BROWSER, locale: 'EN' });
        assert.match(out, /<h1>Page not found<\/h1>/);
        assert.match(out, /<a href="\/my">Sign in<\/a>/);
    });

    await t.test('fetch/curl без text/html и JSON API — прежний текст', () => {
        assert.strictEqual(hit('/put-mega-adepta.html'), 'Invalid database');
        assert.strictEqual(hit('/no-such-db', { accept: 'application/json' }), 'Invalid database');
        assert.strictEqual(hit('/no-such-db', { accept: BROWSER, get: { JSON: '1' } }), 'Invalid database');
    });
});
