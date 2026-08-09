// Ресурс start.html, лежащий В РЕПОЗИТОРИИ, обязан раскладываться (ideav/crm#4671).
//
// `start.html` отдаётся с корня сайта, а её файлы попадают туда только через
// маппинги `update.conf` (`js/*`, `css/*`, …). Каталога `assets/` среди них нет:
// то, что там лежит, залито на сервер руками. Значит новый файл, добавленный в
// репозиторий под `assets/`, на боевую не доезжает: сервер отвечает на него
// редиректом/HTML, браузер спотыкается о первый «<»
// (`Uncaught SyntaxError: Unexpected token '<'`), и объект библиотеки не
// появляется. Так умер вход по QR — кнопка живая, `window.QRCode` undefined.
//
// Правило, которое держит тест: если файл ЕСТЬ в репозитории и на него ссылается
// start.html, путь ссылки обязан попадать под раскладываемый префикс. Ссылки на
// файлы, которых в репозитории нет (залитые на сервер отдельно: logo.png,
// terms.html, acct.html…), под правило не подпадают — update.php их не трогает.
//
// Run with: node experiments/start-html-assets-deployed.test.js

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

// Залито на сервер вручную ДО того, как появился update.conf с этими путями.
// Список только сокращается: новые исключения сюда не дописывать — класть файл
// туда, откуда он раскладывается.
// (проверено 09.08.2026: оба отдаются с боевой со статусом 200).
var LEGACY_HAND_UPLOADED = [
    'assets/vendor/primeicons/primeicons.css',
    'i/logo_black_bg.jpg'
];

var html = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');
var conf = fs.readFileSync(path.join(ROOT, 'update.conf'), 'utf8');

// Префиксы из update.conf: строки «источник : цель», источник вида `js/*` или
// `start.html`. Комментарии (#) и заголовки секций пропускаем.
function deployedPrefixes(text) {
    var out = [];
    text.split(/\r?\n/).forEach(function(line) {
        var raw = line.trim();
        if (!raw || raw.charAt(0) === '#' || raw.charAt(0) === '[') return;
        var colon = raw.indexOf(' : ');
        if (colon === -1) return;
        out.push(raw.slice(0, colon).trim().replace(/\*$/, ''));
    });
    return out;
}
var PREFIXES = deployedPrefixes(conf);
assertEqual(PREFIXES.indexOf('js/') !== -1, true, 'update.conf раскладывает js/*');
assertEqual(PREFIXES.indexOf('start.html') !== -1, true, 'update.conf раскладывает саму start.html');
assertEqual(PREFIXES.some(function(p) { return p.indexOf('assets/') === 0; }), false,
    'update.conf НЕ раскладывает assets/ — класть туда новое нельзя');

// Локальные ссылки страницы: src=… и href= без схемы и без //.
function localRefs(text) {
    var out = [];
    var re = /(?:src|href)="([^"]+)"/g;
    var m;
    while ((m = re.exec(text)) !== null) {
        var url = m[1];
        if (/^(?:[a-z]+:|\/\/|#|data:|mailto:)/i.test(url)) continue;
        var clean = url.replace(/^\.?\//, '').split(/[?#]/)[0];
        if (clean && out.indexOf(clean) === -1) out.push(clean);
    }
    return out;
}

var refs = localRefs(html);
assertEqual(refs.length > 0, true, 'в start.html есть локальные ресурсы');

// Файлы репозитория — те, что update.php обязан доставить.
var inRepo = refs.filter(function(ref) {
    return fs.existsSync(path.join(ROOT, ref)) && LEGACY_HAND_UPLOADED.indexOf(ref) === -1;
});
assertEqual(inRepo.length > 0, true, 'часть ресурсов start.html лежит в репозитории');

var undeployed = inRepo.filter(function(ref) {
    return !PREFIXES.some(function(p) { return ref === p || ref.indexOf(p) === 0; });
});
assertEqual(undeployed, [], 'каждый ресурс start.html из репозитория лежит под раскладываемым префиксом');

// Точечно про виновника #4671.
assertEqual(/<script[^>]+src="js\/qrcode\.js"/.test(html), true,
    'кодировщик QR подключён из js/ (assets/ не доезжает)');
assertEqual(/src="assets\/vendor\/qrcode/.test(html), false,
    'старого пути assets/vendor/qrcode в start.html нет');
assertEqual(fs.existsSync(path.join(ROOT, 'js', 'qrcode.js')), true,
    'сам файл js/qrcode.js в репозитории есть');

console.log('\n' + passed + ' assertions passed');
