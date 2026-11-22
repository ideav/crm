// #5615 — регресс от #5396: POST /my/register падал фаталом «Call to undefined function
// Ws_collect()». Обработчик регистрации (и newUser → Insert → logChange → Ws_collect) идёт по
// index.php раньше, чем подключался include/ws_push.php. Проверяем порядок: модуль подключён
// после include/connection.php (там могут стоять define WS_*) и до первого обработчика запросов,
// который пишет в базу, — /my/register.
//
// Run with: node experiments/ws-push-early-5615.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'index.php'), 'utf8');

function pos(re, what) {
    const m = re.exec(src);
    assert.ok(m, 'не найдено в index.php: ' + what);
    return m.index;
}

test('ws_push.php подключён до обработчика /my/register и после connection.php', () => {
    const ws = pos(/^require_once __DIR__ \. "\/include\/ws_push\.php";/m, 'require_once ws_push.php');
    const conn = pos(/^include "include\/connection\.php";/m, 'основной include connection.php');
    const reg = pos(/^if\(\(\$z === "my"\) && .*=== "register"\)\)/m, 'обработчик /my/register');
    assert.ok(conn < ws, 'ws_push.php должен идти после include/connection.php');
    assert.ok(ws < reg, 'ws_push.php должен быть подключён до обработчика /my/register (#5615)');
});

test('ws_push.php подключается один раз', () => {
    const n = (src.match(/^\s*(require|include)(_once)?\b.*include\/ws_push\.php/gm) || []).length;
    assert.strictEqual(n, 1);
});
