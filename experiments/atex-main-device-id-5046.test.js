// #5051 (развитие #5046) — ID устройства в правом верхнем меню (templates/atex/main.html):
// последняя строка меню пользователя — метка «ID:» и ОТДЕЛЬНО значение. Выбирается кликом
// только номер (user-select:all стоит на значении), метка в выделение не попадает: прежде
// строка «ID устройства: …» выделялась и копировалась целиком.
//
// Код тот же, что у сторожа планшета (#5046): localStorage `atehPad`, 32 hex-символа
// (pad-guard.ensureToken). Кода нет — он генерируется и запоминается, иначе показывать нечего.
//
// Проверяем ПОВЕДЕНИЕ: inline-скрипт, который заполняет #device-id-value, берётся из шаблона
// и выполняется на заглушках DOM / localStorage / crypto. Размещение строки в меню и
// user-select на значении — по разметке: поведением это не выразить (как в #5046 для левого меню).
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
var source = scripts.filter(function(s) { return s.indexOf("getElementById('device-id-value')") !== -1; })[0] || '';
source = source.replace(/^<script>/, '').replace(/<\/script>$/, '');

// Строка ID — в правом верхнем меню (navbar-right), в левом меню (aside) её быть не должно.
var navbarBlock = (html.match(/<div class="navbar-right">[\s\S]*?<\/nav>/) || [''])[0];
var asideBlock = (html.match(/<aside class="app-sidebar"[\s\S]*?<\/aside>/) || [''])[0];
assertEqual(navbarBlock.indexOf('id="user-menu-device-id"') !== -1, true, '#5051 строка ID — в правом верхнем меню');
assertEqual(navbarBlock.indexOf('<span>ID:</span>') !== -1, true, '#5051 метка «ID:» — отдельный узел');
assertEqual(asideBlock.indexOf('device-id') === -1, true, '#5051 в левом меню ID больше нет');

// user-select:all — на значении, не на всей строке: клик выделяет только номер.
var menuStyles = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
assertEqual(/\.user-menu-device-id \.device-id-value \{ user-select: all; \}/.test(menuStyles), true,
    '#5051 user-select:all стоит на значении — выбирается только номер');

function run(stored, cryptoOk) {
    var node = { textContent: '' };
    var data = {};
    if (stored) data.atehPad = stored;
    var sandbox = {
        document: { getElementById: function(id) { return id === 'device-id-value' ? node : null; } },
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
assertEqual(r1.text, TOKEN, '#5051 в узле значения ТОЛЬКО номер — метка «ID:» в него не входит');

var r2 = source ? run('') : { text: '', stored: '' };
assertEqual(/^[a-f0-9]{32}$/.test(r2.stored || ''), true, '#5051 кода нет — генерируется 32 hex и запоминается');
assertEqual(r2.text, r2.stored, '#5051 показан именно запомненный код');

var r3 = source ? run('мусор') : { stored: '' };
assertEqual(/^[a-f0-9]{32}$/.test(r3.stored || ''), true, '#5051 мусор вместо кода заменяется настоящим кодом');

var r4 = source ? run('', false) : { text: 'x' };
assertEqual(r4.text, '', '#5051 без crypto код не выдумывается — значения нет, страница не падает');

console.log('\n' + passed + '/' + total + ' passed');
