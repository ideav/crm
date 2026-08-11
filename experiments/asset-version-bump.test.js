// ЖЁСТКОЕ ПРАВИЛО (issue #4722): изменил `js/*.js` или `css/*.css` — подними версию во ВСЕХ
// шаблонах, где файл подключён.
//
// Иначе браузер отдаёт пользователю старый файл из кэша: правка выложена, а страница работает
// по-прежнему. Так уехали три правки конвертора моделей — `js/dash-import.js` менялся в шести
// коммитах, `templates/dash-import.html` в трёх.
//
// Проверка ТОЧЕЧНАЯ, а не «у всех ссылок должна быть версия»: вендорные библиотеки (bootstrap,
// jquery, moment) подключены без версии и не меняются — требовать её у них значит утопить сторож
// в 179 ложных срабатываниях. Спрашиваем только с тех файлов, которые ИЗМЕНИЛИСЬ в этой ветке.
//
// Сравнение идёт с базовой веткой (`BASE_REF`, по умолчанию `origin/main`). Нет git или базы —
// сторож молча пропускает: он для CI и для локальной ветки, а не для распакованного архива.
//
// Run with: node experiments/asset-version-bump.test.js

var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '\n  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var ROOT = path.resolve(__dirname, '..');
function git(args) {
    return cp.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}
function gitQuiet(args) { try { return git(args); } catch (e) { return null; } }

// ── Чистое ядро: какие версии подключены в шаблоне для данного файла ─────────────────────
// → массив строк-версий («{_global_.version}.2», «0{_global_.version}», «120»), по одной на
// каждое подключение. Пустая строка — подключение БЕЗ версии.
function assetVersions(templateText, assetPath) {
    var out = [];
    var esc = assetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(?:src|href)="' + esc + '(?:\\?([^"]*))?"', 'g');
    var m;
    while ((m = re.exec(templateText)) !== null) out.push(m[1] || '');
    return out;
}

// Шаблоны, подключающие файл.
function templatesUsing(assetPath) {
    var found = [];
    (function walk(dir) {
        fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
            var p = path.join(dir, e.name);
            if (e.isDirectory()) return walk(p);
            if (!/\.html$/.test(e.name)) return;
            var text = fs.readFileSync(p, 'utf8');
            if (assetVersions(text, assetPath).length) found.push(path.relative(ROOT, p));
        });
    })(path.join(ROOT, 'templates'));
    return found;
}

// ── Проверки чистой части (работают всегда) ──────────────────────────────────────────────
var sample = '<link href="/css/dash-import.css?{_global_.version}.1">\n' +
             '<script src="/js/dash-import.js?{_global_.version}.2"></script>\n' +
             '<script src="/js/main.js"></script>';
assert(assetVersions(sample, '/js/dash-import.js').join('|') === '{_global_.version}.2',
    'версия подключения читается из шаблона', assetVersions(sample, '/js/dash-import.js').join('|'));
assert(assetVersions(sample, '/js/main.js').join('|') === '',
    'подключение без версии видно как пустая версия — на него правило и ругается');
assert(assetVersions(sample, '/js/нет-такого.js').length === 0, 'чужой файл в шаблоне не находится');

// ── Сторож: изменённый файл обязан поднять версию ────────────────────────────────────────
var base = process.env.BASE_REF || 'origin/main';
if (!gitQuiet(['rev-parse', '--verify', base])) base = gitQuiet(['rev-parse', '--verify', 'main']) ? 'main' : null;
// Пустой дифф — это ПУСТО, а не «git недоступен»: null отдаёт только сбой команды.
var changed = base ? gitQuiet(['diff', '--name-only', base + '...HEAD']) : null;

if (changed === null) {
    console.log('\n  git или базовая ветка недоступны — сторож пропущен (это не ошибка).');
} else {
    var assets = changed.split('\n').filter(function (f) { return /^(js|css)\/.+\.(js|css)$/.test(f); });
    var problems = [];
    assets.forEach(function (asset) {
        var ref = '/' + asset;
        var users = templatesUsing(ref);
        if (!users.length) return;                       // файл не подключён из шаблонов — нечего версионировать
        users.forEach(function (tpl) {
            var nowText = fs.readFileSync(path.join(ROOT, tpl), 'utf8');
            var baseText = gitQuiet(['show', base + ':' + tpl]);
            var now = assetVersions(nowText, ref);
            if (now.indexOf('') !== -1) {
                problems.push(asset + ' в ' + tpl + ': подключение БЕЗ версии — правка не доедет до браузера');
                return;
            }
            if (baseText === null) return;               // шаблон новый — версия проставлена сразу
            var was = assetVersions(baseText, ref);
            if (was.join('|') === now.join('|')) {
                problems.push(asset + ' изменён, а в ' + tpl + ' версия та же: ' + now.join('|'));
            }
        });
    });
    assert(problems.length === 0,
        'каждый изменённый js/css поднял версию во всех шаблонах, где подключён (#4722)',
        problems.length ? problems.join('\n  ') +
            '\n  Поднимите суффикс `?{_global_.version}.N` — иначе браузер отдаст старый файл из кэша.' : '');
    console.log('  (сверка с ' + base + ': изменённых ассетов — ' + assets.length + ')');
}

console.log('\n' + passed + ' проверок прошли из ' + total);
