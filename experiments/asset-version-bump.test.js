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
// локально сторож пропускает (распакованный архив), а в CI (задана `CI`) это падение: клон без
// истории выключает сторож, поэтому job `regression` делает checkout с `fetch-depth: 0` (issue #5541).
//
// Пути шаблонов для `git show база:путь` — всегда через `/`: путь с `\` git не находит, и сторож
// принимает шаблон за новый (issue #5541). Самопроверка ниже гоняет сторож на временном
// репозитории с шаблоном во вложенной папке.
//
// Run with: node experiments/asset-version-bump.test.js

var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '\n  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var ROOT = path.resolve(__dirname, '..');
function gitQuiet(root, args) {
    try {
        return cp.execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) { return null; }
}

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

// Шаблоны, подключающие файл: пути от корня репозитория, разделитель `/` на любой ОС.
function templatesUsing(root, assetPath) {
    var found = [];
    (function walk(dir) {
        fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
            var p = path.join(dir, e.name);
            if (e.isDirectory()) return walk(p);
            if (!/\.html$/.test(e.name)) return;
            var text = fs.readFileSync(p, 'utf8');
            if (assetVersions(text, assetPath).length) found.push(path.relative(root, p).split(path.sep).join('/'));
        });
    })(path.join(root, 'templates'));
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

// Сторож целиком. → null, если git или база недоступны; иначе { assets, problems }.
function runGuard(root, base) {
    // Пустой дифф — это ПУСТО, а не «git недоступен»: null отдаёт только сбой команды.
    var changed = base ? gitQuiet(root, ['diff', '--name-only', base + '...HEAD']) : null;
    if (changed === null) return null;
    var assets = changed.split('\n').filter(function (f) { return /^(js|css)\/.+\.(js|css)$/.test(f); });
    var problems = [];
    assets.forEach(function (asset) {
        var ref = '/' + asset;
        var users = templatesUsing(root, ref);
        if (!users.length) return;                       // файл не подключён из шаблонов — нечего версионировать
        users.forEach(function (tpl) {
            var nowText = fs.readFileSync(path.join(root, tpl), 'utf8');
            var baseText = gitQuiet(root, ['show', base + ':' + tpl]);
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
    return { assets: assets, problems: problems };
}

// ── Самопроверка сторожа на временном репозитории (#5541) ────────────────────────────────
// Сценарий #5532: шаблон во вложенной папке, js изменён, версия в шаблоне не поднята.
(function selfTest() {
    if (gitQuiet(ROOT, ['--version']) === null) { console.log('\n  git недоступен — самопроверка пропущена.'); return; }
    var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-guard-'));
    function g(args) {
        cp.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false',
            '-c', 'commit.gpgsign=false'].concat(args), { cwd: tmp, stdio: 'ignore' });
    }
    function put(rel, text) {
        fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
        fs.writeFileSync(path.join(tmp, rel), text);
    }
    function commit(msg) { g(['add', '-A']); g(['commit', '-q', '-m', msg]); }
    try {
        g(['init', '-q']);
        put('templates/my/partners.html', '<script src="/js/partner-admin.js?{_global_.version}.2"></script>\n');
        put('js/partner-admin.js', 'var v = 1;\n');
        commit('base');
        g(['branch', 'guard-base']);
        put('js/partner-admin.js', 'var v = 2;\n');
        commit('js changed');

        var r = runGuard(tmp, 'guard-base');
        assert(r !== null && r.problems.length === 1 && r.problems[0].indexOf('templates/my/partners.html') !== -1,
            'самопроверка: js изменён, версия в templates/my/ не поднята → сторож краснеет (#5541)',
            r === null ? 'сторож пропущен' : 'замечаний: ' + r.problems.length + ' ' + r.problems.join('; '));

        put('templates/my/partners.html', '<script src="/js/partner-admin.js?{_global_.version}.3"></script>\n');
        commit('version bumped');
        r = runGuard(tmp, 'guard-base');
        assert(r !== null && r.problems.length === 0, 'самопроверка: версия поднята → сторож молчит',
            r === null ? 'сторож пропущен' : r.problems.join('; '));
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
})();

// ── Сторож: изменённый файл обязан поднять версию ────────────────────────────────────────
var base = process.env.BASE_REF || 'origin/main';
if (!gitQuiet(ROOT, ['rev-parse', '--verify', base])) base = gitQuiet(ROOT, ['rev-parse', '--verify', 'main']) ? 'main' : null;
var res = runGuard(ROOT, base);

if (res === null) {
    if (process.env.CI) {
        assert(false, 'в CI сторож версий работает (#5541)',
            'git или базовая ветка недоступны — checkout работы с гейтом нужен с `fetch-depth: 0`.');
    } else {
        console.log('\n  git или базовая ветка недоступны — сторож пропущен (локально это не ошибка).');
    }
} else {
    var problems = res.problems;
    assert(problems.length === 0,
        'каждый изменённый js/css поднял версию во всех шаблонах, где подключён (#4722)',
        problems.length ? problems.join('\n  ') +
            '\n  Поднимите суффикс `?{_global_.version}.N` — иначе браузер отдаст старый файл из кэша.' : '');
    console.log('  (сверка с ' + base + ': изменённых ассетов — ' + res.assets.length + ')');
}

console.log('\n' + passed + ' проверок прошли из ' + total);
