// Test for ideav/crm#4043 — комбинированная cache-bust версия ассетов в main.html.
//
// Раньше templates/main.html и templates/ru/main.html грузили свои /js/* и /css/* БЕЗ версии —
// даже бамп ядра (VERSION в index.php) их не обновлял, браузер держал устаревшие файлы. Теперь у
// каждого первого-стороннего ассета query = {_global_.version} (общая версия ядра) + локальный
// суффикс «.N» (правится прямо в main.html без правки ядра — «достаточно поменять что-то одно»).
//
// Гард против регресса: если в эти шаблоны добавят/вернут ассет /js/* или /css/* без версии —
// тест падает. Плюс проверяем, что подстановка движка (str_ireplace {_global_.version}) даёт
// комбинированный «<общая>.<локальная>» вид, и что бамп любой из частей меняет URL.
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

var FILES = ['templates/main.html', 'templates/ru/main.html'];
// Токен движка (index.php:536 GLOBAL_VARS["version"] = VERSION; index.php:8330 str_ireplace).
var TOKEN = '{_global_.version}';

// Все первые-сторонние теги ассетов (свои /js|/css). Вендор /assets/vendor/* исключаем —
// он версионируется своим путём (см. комментарий в шаблоне), суффикс не нужен.
function firstPartyAssets(html) {
    var re = /(?:src|href)="(\/(?:js|css)\/[^"]+)"/g, m, out = [];
    while ((m = re.exec(html)) !== null) out.push(m[1]);
    return out;
}

FILES.forEach(function(rel) {
    var html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    var assets = firstPartyAssets(html);
    assert(assets.length > 0, rel + ': есть первые-сторонние /js|/css ассеты (' + assets.length + ')');

    // 1) каждый несёт комбинированную версию «{_global_.version}.<локальная>».
    var bad = assets.filter(function(u) { return u.indexOf('?' + TOKEN + '.') < 0; });
    assert(bad.length === 0, rel + ': у КАЖДОГО ассета query = ?' + TOKEN + '.<локальная>' +
        (bad.length ? ' — без версии: ' + bad.join(', ') : ''));

    // 2) вендор (primeicons) — БЕЗ суффикса версии (версионируется путём).
    assert(/primeicons\.css"/.test(html), rel + ': вендор primeicons остаётся без суффикса версии');

    // 3) подстановка движка: {_global_.version} -> 110 даёт комбинированный «110.<локальная>».
    var rendered = html.split(TOKEN).join('110');
    var renderedAssets = firstPartyAssets(rendered);
    var combined = renderedAssets.every(function(u) { return /\?110\.\d+$/.test(u); });
    assert(combined, rel + ': после подстановки версии URL вида ...?110.<N> (комбинированная)');

    // 4) «достаточно поменять что-то одно»: бамп ОБЩЕЙ (110->111) и бамп ЛОКАЛЬНОЙ (.1->.2)
    //    оба меняют итоговый URL первого ассета.
    var a0 = renderedAssets[0];                          // напр. /css/styles.css?110.1
    var globalBump = html.split(TOKEN).join('111');
    var afterGlobal = firstPartyAssets(globalBump)[0];   // /css/styles.css?111.1
    var afterLocal = a0.replace(/\.(\d+)$/, function(_, n) { return '.' + (Number(n) + 1); });
    assert(afterGlobal !== a0 && afterLocal !== a0,
        rel + ': бамп общей (index.php) ИЛИ локальной (main.html) версии меняет URL');
});

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
