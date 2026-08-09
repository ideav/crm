// Секрет входа по QR не должен попадать ни в URL, ни в лог (ideav/crm#4677).
//
// Секрет `s` — единственное, что отделяет предъявителя от выдачи ПОСТОЯННОГО
// токена пользователя: `qrpoll` при `confirmed` отдаёт `token` и `_xsrf`. Пока
// клиент опрашивал GET-ом (`qrpoll?JSON&c=…&s=…`), секрет оседал в access-логе
// сервера, в логе приложения (`index.php` пишет URI каждого запроса), в логах
// прокси и в истории браузера. Причём маска лога закрывала `c` (код, и так
// нарисованный в QR) и не закрывала `s`.
//
// Тест держит обе половины правила: клиент шлёт код и секрет ТЕЛОМ POST, сервер
// принимает только POST, а маски логов знают про `c` и `s`.
//
// Run with: node experiments/qr-login-secret-not-logged-4677.test.js

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}
function assertTrue(cond, name) { assertEqual(!!cond, true, name); }

var app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
var php = fs.readFileSync(path.join(ROOT, 'index.php'), 'utf8');

// ── Клиент ──
// Ни один адрес, который строит клиент, не несёт секрет в строке запроса.
var qrpollUrls = app.match(/`[^`]*qrpoll[^`]*`/g) || [];
assertTrue(qrpollUrls.length > 0, 'клиент обращается к qrpoll');
var leaking = qrpollUrls.filter(function(u) { return /[?&]s=/.test(u); });
assertEqual(leaking, [], 'в адресе qrpoll нет секрета (`s=` в строке запроса)');
assertTrue(!/[?&]c=\$\{encodeURIComponent\(this\.session\.code\)/.test(app),
    'кода сессии в строке запроса тоже нет');

// Опрос идёт POST-ом, а код и секрет уходят телом.
var pollFn = app.slice(app.indexOf('async _poll()'));
pollFn = pollFn.slice(0, pollFn.indexOf('\n    }\n'));
assertTrue(/method:\s*'POST'/.test(pollFn), 'опрос qrpoll отправляется методом POST');
assertTrue(/body\.set\('c'/.test(pollFn) && /body\.set\('s'/.test(pollFn),
    'код и секрет уходят телом запроса');

// ── Сервер ──
var qrpollCase = php.slice(php.indexOf('case "qrpoll":'));
qrpollCase = qrpollCase.slice(0, qrpollCase.indexOf('case "qrlogin":'));
assertTrue(/REQUEST_METHOD"\]\s*!==\s*"POST"/.test(qrpollCase), 'qrpoll принимает только POST');
assertTrue(/\$_POST\["c"\]/.test(qrpollCase) && /\$_POST\["s"\]/.test(qrpollCase),
    'qrpoll читает код и секрет из тела, а не из $_REQUEST');
assertTrue(!/\$_REQUEST\["s"\]/.test(qrpollCase), 'qrpoll не берёт секрет из $_REQUEST (туда попадает и GET)');

// ── Маски логов ──
var uriMasks = php.match(/\(\[\?&\]\([a-z|]+\)=\)/g) || [];
assertTrue(uriMasks.length >= 2, 'маска URI применяется при логировании');
uriMasks.forEach(function(mask, i) {
    var names = mask.replace(/[^a-z|]/g, '').split('|');
    assertTrue(names.indexOf('s') !== -1, 'маска URI #' + (i + 1) + ' закрывает `s` (секрет QR)');
    assertTrue(names.indexOf('c') !== -1, 'маска URI #' + (i + 1) + ' закрывает `c` (код QR)');
});

var keysLine = (php.match(/\$sensitivePostKeys\s*=\s*\[[^\]]*\]/) || [''])[0];
assertTrue(/'c'/.test(keysLine), 'POST-параметр `c` не пишется в лог');
assertTrue(/'s'/.test(keysLine), 'POST-параметр `s` не пишется в лог');

console.log('\n' + passed + ' assertions passed');
