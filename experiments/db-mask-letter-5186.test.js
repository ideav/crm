// #5186: имя базы начинается с буквы. Адрес вида /404, /1abc, /_x — не база: ядро отвечает
// страницей «Invalid database» со ссылкой на вход до подключения к БД (а не идёт проверять
// таблицу и не падает 500). Имена с буквой первой (/my, /a1) уходят дальше, к БД.

const { spawnSync } = require('child_process');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });

// Ветка «не база» отвечает до include/connection.php; дальше в CLI без БД ядро сразу умирает
// на подключении — его вывод нас не интересует, важно только, что это НЕ страница «не база».
function hit(uri) {
    const code = '$_SERVER["REQUEST_URI"]=' + JSON.stringify(uri) + ';'
        + '$_SERVER["REQUEST_METHOD"]="GET";'
        + '$_SERVER["HTTP_ACCEPT"]="text/html";'
        + 'include "index.php";';
    return spawnSync('php', ['-d', 'display_errors=stderr', '-r', code], { cwd: root, encoding: 'utf8' }).stdout;
}

test('#5186 имя базы — первая буква', { skip: probe.error ? 'php не найден в PATH' : false }, async (t) => {
    for (const uri of ['/404', '/1abc', '/_x', '/9']) {
        await t.test(uri + ' — не база', () => {
            assert.match(hit(uri), /<h1>Invalid database<\/h1>/);
        });
    }
    for (const uri of ['/my', '/a1', '/Ateh1']) {
        await t.test(uri + ' — имя базы, идёт к БД', () => {
            assert.doesNotMatch(hit(uri), /Invalid database/);
        });
    }
});
