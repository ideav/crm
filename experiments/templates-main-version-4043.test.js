// Test for ideav/crm#4043 — комбинированная cache-bust версия ассетов в main.html.
//
// Раньше main.html-шаблоны грузили свои /js/* и /css/* БЕЗ версии — даже бамп ядра
// (VERSION в index.php) их не обновлял, браузер держал устаревшие файлы. Теперь у каждого
// НАШЕГО (first-party) ассета query = {_global_.version} (общая версия ядра) + локальный
// суффикс «.N» (правится прямо в main.html без правки ядра — «достаточно поменять что-то одно»).
//
// Гард против регресса: если в любой main.html добавят/вернут НАШ ассет без версии — тест
// падает. Проверяем все шесть main.html (базовые + кастомные atex/my/sportzania/db…). Вендор
// (primeicons/jquery/bootstrap/popper/moment) и уже-версионированный brand.css в проверку не
// входят: у них версия в имени файла / своём пути, суффикс не нужен.
//
// Run with: node experiments/templates-main-version-4043.test.js

var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var FILES = [
    'templates/main.html',
    'templates/ru/main.html',
    'templates/atex/main.html',
    'templates/my/main.html',
    'templates/sportzania/main.html',
    'templates/db1341756924ugo/main.html',
];
// Токен движка (index.php:536 GLOBAL_VARS["version"] = VERSION; str_ireplace при рендере).
var TOKEN = '{_global_.version}';

// Наши first-party ассеты — их и версионируем (обновляются нашими правками js/css ядра).
// Вендор с версией в имени (bootstrap4.5.2, jquery3.1.1, jquery-ui1.12.1, popper1.16.1,
// moment.min) и primeicons исключены умышленно; brand.css отдаётся своим путём /download/…
// и уже несёт ?{_global_.version} — в этот список не входит.
var CORE = [
    'styles.css', 'main-app.css', 'ai-chat.css', 'cabinet.css',
    'main.js', 'app.js', 'ai-agent-chat.js', 'main-app.js', 'form-submit.js', 'cabinet.js',
];

// Полные URL ссылок на CORE-ассеты (basename до '?' должен быть в списке CORE).
function coreAssets(html) {
    var re = /(?:src|href)="(\/(?:js|css)\/([^"?]+)(?:\?[^"]*)?)"/g, m, out = [];
    while ((m = re.exec(html)) !== null) {
        if (CORE.indexOf(m[2]) >= 0) out.push(m[1]);
    }
    return out;
}

FILES.forEach(function(rel) {
    var html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    var assets = coreAssets(html);
    assert(assets.length > 0, rel + ': найдены наши first-party /js|/css ассеты (' + assets.length + ')');

    // 1) каждый наш ассет несёт комбинированную версию «{_global_.version}.<локальная>».
    var bad = assets.filter(function(u) { return u.indexOf('?' + TOKEN + '.') < 0; });
    assert(bad.length === 0, rel + ': у КАЖДОГО нашего ассета query = ?' + TOKEN + '.<локальная>' +
        (bad.length ? ' — без версии: ' + bad.join(', ') : ''));

    // 2) вендор (primeicons) — БЕЗ суффикса версии (версионируется путём).
    if (/primeicons\.css/.test(html)) {
        assert(!/primeicons\.css\?/.test(html), rel + ': вендор primeicons остаётся без суффикса версии');
    }

    // 3) подстановка движка: {_global_.version} -> 110 даёт комбинированный «110.<локальная>».
    var rendered = html.split(TOKEN).join('110');
    var renderedAssets = coreAssets(rendered);
    var combined = renderedAssets.every(function(u) { return /\?110\.\d+$/.test(u); });
    assert(combined, rel + ': после подстановки версии URL вида ...?110.<N> (комбинированная)');

    // 4) «достаточно поменять что-то одно»: бамп ОБЩЕЙ (110->111) и бамп ЛОКАЛЬНОЙ (.1->.2)
    //    оба меняют итоговый URL первого ассета.
    var a0 = renderedAssets[0];                          // напр. /css/styles.css?110.1
    var globalBump = html.split(TOKEN).join('111');
    var afterGlobal = coreAssets(globalBump)[0];         // /css/styles.css?111.1
    var afterLocal = a0.replace(/\.(\d+)$/, function(_, n) { return '.' + (Number(n) + 1); });
    assert(afterGlobal !== a0 && afterLocal !== a0,
        rel + ': бамп общей (index.php) ИЛИ локальной (main.html) версии меняет URL');
});

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
