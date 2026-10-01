// #5046 — ID устройства серым в самом низу левого меню (templates/atex/main.html).
//
// Это тот код, который администратор вписывает в «Планшеты» пользователя: localStorage
// `atehPad`, 32 hex-символа (pad-guard.ensureToken). Кода нет — он генерируется и
// запоминается, иначе показывать нечего.
//
// Проверяем ПОВЕДЕНИЕ: inline-скрипт, который заполняет #sidebar-device-id, берётся из
// шаблона и выполняется на заглушках DOM / localStorage / crypto.
//
// Run with: node experiments/atex-main-device-id-5046.test.js

var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name
        + (ok ? '' : ' (ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual) + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

var html = fs.readFileSync(path.join(__dirname, '..', 'templates', 'atex', 'main.html'), 'utf8');
var scripts = html.match(/<script>[\s\S]*?<\/script>/g) || [];
var source = scripts.filter(function(s) { return s.indexOf("getElementById('sidebar-device-id')") !== -1; })[0] || '';
source = source.replace(/^<script>/, '').replace(/<\/script>$/, '');

// Узел #sidebar-device-id стоит в разметке левого меню (aside.app-sidebar).
var aside = (html.match(/<aside class="app-sidebar"[\s\S]*?<\/aside>/) || [''])[0];
assertEqual(/id="sidebar-device-id"/.test(aside), true, '#5046 место под ID устройства — в левом меню');

function run(stored, cryptoOk) {
    var node = { textContent: '' };
    var data = {};
    if (stored) data.atehPad = stored;
    var sandbox = {
        document: { getElementById: function(id) { return id === 'sidebar-device-id' ? node : null; } },
        localStorage: {
            getItem: function(k) { return data[k] == null ? null : data[k]; },
            setItem: function(k, v) { data[k] = String(v); }
        },
        window: { crypto: cryptoOk === false ? undefined : {
            getRandomValues: function(a) { for (var i = 0; i < a.length; i++) a[i] = (i * 17 + 5) % 256; return a; } } }
    };
    new Function('document', 'localStorage', 'window', source)(sandbox.document, sandbox.localStorage, sandbox.window);
    return { text: node.textContent, stored: data.atehPad };
}

var TOKEN = 'aaaa0000bbbb1111cccc2222dddd3333';
var r1 = source ? run(TOKEN) : { text: '' };
assertEqual(r1.text, 'ID устройства: ' + TOKEN, '#5046 код устройства есть — он и показан');

var r2 = source ? run('') : { text: '', stored: '' };
assertEqual(/^[a-f0-9]{32}$/.test(r2.stored || ''), true, '#5046 кода нет — генерируется 32 hex и запоминается');
assertEqual(r2.text, 'ID устройства: ' + r2.stored, '#5046 показан именно запомненный код');

var r3 = source ? run('мусор') : { stored: '' };
assertEqual(/^[a-f0-9]{32}$/.test(r3.stored || ''), true, '#5046 мусор вместо кода заменяется настоящим кодом');

var r4 = source ? run('', false) : { text: 'x' };
assertEqual(r4.text, '', '#5046 без crypto код не выдумывается — строки нет, страница не падает');

console.log('\n' + passed + '/' + total + ' passed');
