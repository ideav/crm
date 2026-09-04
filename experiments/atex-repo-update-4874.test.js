// #4874/#4876/#4878 — «Обновление из репозитория» в dir_admin: сводная расхождений,
// заливка файлов и отчёт по кнопке.
//
// Логика живёт в js/repo-update.js (глобальный ассет — js/* деплоится во все базы,
// dir_admin.html один на все базы). Здесь проверяются ЧИСТЫЙ слой (разбор адреса
// репозитория, выбор папок базы, разбор листинга менеджера, расхождения, план
// заливки) и БРАУЗЕРНЫЙ слой (init/open/run со стабами DOM и fetch).
//
// Run with: node experiments/atex-repo-update-4874.test.js

var mod = require('../js/repo-update.js');
var core = mod.core;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name
        + (ok ? '' : ' (ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual) + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function assertTrue(cond, name) { assertEqual(!!cond, true, name); }

// ── 1) адрес репозитория → {owner, repo} ──
assertEqual(core.parseRepoUrl('https://github.com/ideav/crm/'), { owner: 'ideav', repo: 'crm' },
    '#4874 адрес с хвостовым слэшем разбирается');
assertEqual(core.parseRepoUrl('https://github.com/ideav/crm'), { owner: 'ideav', repo: 'crm' },
    '#4874 адрес без слэша разбирается');
assertEqual(core.parseRepoUrl('https://github.com/ideav/crm.git'), { owner: 'ideav', repo: 'crm' },
    '#4874 суффикс .git отбрасывается');
assertEqual(core.parseRepoUrl(''), null, '#4874 пустой адрес — не репозиторий');
assertEqual(core.parseRepoUrl('https://gitlab.com/a/b/'), null, '#4874 не github — не принимаем');
assertEqual(core.parseRepoUrl('https://github.com/justowner/'), null, '#4874 без имени репозитория — не принимаем');

// ── 2) URL-ы GitHub API ──
var urls = core.githubUrls({ owner: 'ideav', repo: 'crm' }, 'main');
assertEqual(urls.api, 'https://api.github.com/repos/ideav/crm', '#4874 база API репозитория');
assertEqual(urls.tree, 'https://api.github.com/repos/ideav/crm/git/trees/main?recursive=1',
    '#4874 дерево репозитория — один запрос на все пути');
assertEqual(urls.raw('templates/atex/slitter.html'),
    'https://raw.githubusercontent.com/ideav/crm/main/templates/atex/slitter.html',
    '#4874 сырой файл по ветке');

// ── 3) папки базы в дереве репозитория ──
// У базы ateh папки в репо называются atex (маппинг update.conf), у остальных — имя базы.
var TREE = {
    tree: [
        { path: 'templates/dir_admin.html', type: 'blob', size: 100 },
        { path: 'templates/atex/slitter.html', type: 'blob', size: 200 },
        { path: 'templates/atex/packer.html', type: 'blob', size: 300 },
        { path: 'templates/atex/main.html', type: 'tree' },
        { path: 'templates/sportzania/main.html', type: 'blob', size: 400 },
        { path: 'download/atex/js/slitter.js', type: 'blob', size: 500 },
        { path: 'download/atex/css/slitter.css', type: 'blob', size: 600 },
        { path: 'download/atex/production-planning/10-engine.js', type: 'blob', size: 700 },
        { path: 'download/sportzania/js/app.js', type: 'blob', size: 800 },
        { path: 'js/app.js', type: 'blob', size: 900 }
    ]
};
assertEqual(core.resolveRepoFolders(TREE, 'ateh'), { templates: 'templates/atex', download: 'download/atex' },
    '#4874 у ateh папки называются atex — берутся вторым кандидатом');
assertEqual(core.resolveRepoFolders(TREE, 'sportzania'), { templates: 'templates/sportzania', download: 'download/sportzania' },
    '#4874 у остальных баз папка зовётся именем базы');
assertEqual(core.resolveRepoFolders(TREE, 'неттакой'), { templates: null, download: null },
    '#4874 папок базы нет — null, обновлять нечего');

// ── 4) файлы базы из дерева ──
var files = core.repoFiles(TREE, core.resolveRepoFolders(TREE, 'ateh'));
assertEqual(files.length, 5, '#4874 пять файлов двух деревьев (каталоги и чужие базы мимо)');
assertEqual(files[0], { repoPath: 'templates/atex/slitter.html', tree: 'templates', sub: '', name: 'slitter.html', size: 200 },
    '#4874 шаблон: дерево templates, без подпапки');
assertEqual(files[2], { repoPath: 'download/atex/js/slitter.js', tree: 'download', sub: '/js', name: 'slitter.js', size: 500 },
    '#4874 скрипт: дерево download, подпапка /js');

// ── 5) разбор листинга файлового менеджера (та же разметка, что рисует dir_admin.html) ──
var LISTING_HTML = '<table>'
    + '<tr><td><input type="checkbox" name="del[]" value="js"></td>'
    + '<td colspan="2"><a href="/ateh/dir_admin/?download=1&add_path=/"><b>js</b></a></td></tr>'
    + '<tr><td></td><td><a href="/ateh/dir_admin/?download=1&add_path=/js&gf=app.js">app.js</a></td>'
    + '<td align="right"> &nbsp;12.34 KB</td>'
    + '<td align="left"> &nbsp;03.09.2026 10:00:00</td></tr>'
    + '<tr><td></td><td><a href="/ateh/dir_admin/?download=1&add_path=/&gf=readme.txt">readme.txt</a></td>'
    + '<td align="right"> &nbsp;512 B</td>'
    + '<td align="left"> &nbsp;03.09.2026 10:00:00</td></tr>'
    + '</table>';
var listing = core.parseDirListing(LISTING_HTML);
assertEqual(listing, [
    { name: 'app.js', size: 12636 },
    { name: 'readme.txt', size: 512 }
], '#4874 листинг: имена и байты из человекочитаемых размеров; каталоги и ссылки без gf мимо');

// Человекочитаемый размер → байты (формат NormalSize из index.php).
assertEqual(core.toBytes('512 B'), 512, '#4874 байты как есть');
assertEqual(core.toBytes('12.34 KB'), 12636, '#4874 килобайты (округление NormalSize до сотых)');
assertEqual(core.toBytes('2 MB'), 2097152, '#4874 мегабайты');
assertEqual(core.toBytes('мусор'), 0, '#4874 не размер — ноль (файл посчитается изменившимся)');

// ── 6) расхождение репозитория с сервером ──
var repoList = [
    { repoPath: 'download/atex/js/app.js', tree: 'download', sub: '/js', name: 'app.js', size: 12636 },
    { repoPath: 'download/atex/js/slitter.js', tree: 'download', sub: '/js', name: 'slitter.js', size: 50000 },
    { repoPath: 'download/atex/js/new-file.js', tree: 'download', sub: '/js', name: 'new-file.js', size: 100 },
    { repoPath: 'templates/atex/main.html', tree: 'templates', sub: '', name: 'main.html', size: 40000 }
];
var serverList = [
    { name: 'app.js', size: 12636 },      // размер совпал — актуален
    { name: 'slitter.js', size: 49000 },  // размер отличается — обновился в репозитории
    { name: 'old-only.html', size: 10 }   // на сервере есть, в репозитории нет
];
var diff = core.diffWithMeta(repoList, serverList);
assertEqual(diff.same, ['download/atex/js/app.js'], '#4874 актуальные — по совпадению размера');
assertEqual(diff.changed, ['download/atex/js/slitter.js'], '#4874 изменившиеся — размер другой');
assertEqual(diff.added, ['download/atex/js/new-file.js', 'templates/atex/main.html'],
    '#4874 новые — на сервере их нет вовсе');
assertEqual(diff.extra, ['old-only.html'], '#4874 лишнее на сервере — только информация');

// ── 7) план заливки: что и куда лить ──
var plan = core.updatePlan(diff);
assertEqual(plan, [
    { repoPath: 'download/atex/js/slitter.js', tree: 'download', addPath: '/js', name: 'slitter.js' },
    { repoPath: 'download/atex/js/new-file.js', tree: 'download', addPath: '/js', name: 'new-file.js' },
    { repoPath: 'templates/atex/main.html', tree: 'templates', addPath: '', name: 'main.html' }
], '#4874 план: изменившиеся и новые, по дереву и подпапке назначения');

// ── 8) настройка «Настройка» с типом GIT → адрес репозитория ──
assertEqual(core.repoFromSetting({ val: 'https://github.com/ideav/crm/' }), 'https://github.com/ideav/crm/',
    '#4874 адрес — главное значение настройки');
assertEqual(core.repoFromSetting({ val: '', r: ['main', 'GIT', '273-value'] }), '273-value',
    '#4874 пустое главное значение — берём реквизит «Значение» (273)');
assertEqual(core.repoFromSetting(null), '', '#4874 настройки нет — пусто (будет дефолт)');

// ── 9) инициализация не падает в неожиданном окружении (#4876) ──
// Боевая страница отчиталась об ошибке внутри init. Каким бы ни было окружение,
// init не имеет права ронять страницу: нет document.getElementById — панель null,
// open() молча не делает ничего.
(function() {
    var savedDoc = global.document;
    global.document = {};   // document БЕЗ getElementById
    var initThrew = null, openThrew = null;
    try { mod.init({ db: 'ateh', xsrf: 'x' }); } catch (e) { initThrew = e.message; }
    global.document = savedDoc;
    try { mod.open(); } catch (e) { openThrew = e.message; }
    assertEqual(initThrew, null, '#4876 init не падает, если у document нет getElementById');
    assertEqual(openThrew, null, '#4876 open() без панели не падает');
})();

// ── DOM-стаб для браузерных сценариев ──
function PanelNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.style = {};
    this.value = '';
    this.disabled = false;
    this._className = '';
    this._text = '';
    var self = this;
    this.classList = { contains: function(c) { return self._cls().indexOf(c) !== -1; } };
}
PanelNode.prototype._cls = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(PanelNode.prototype, 'className', {
    get: function() { return this._className; }, set: function(v) { this._className = String(v || ''); } });
Object.defineProperty(PanelNode.prototype, 'textContent', {
    get: function() { return this.childNodes.length
        ? this.childNodes.map(function(c) { return c.textContent; }).join(' ') : this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; } });
// appendChild строгий, как реальный DOM: не-Node (сырая строка и т.п.) — ошибка.
// Именно это пропустил прежний стаб: на бою строка-ребёнок в repoRow роняла панель
// с «parameter 1 is not of type 'Node'».
PanelNode.prototype.appendChild = function(n) {
    if (!(n instanceof PanelNode) && !(n instanceof TextNode)) {
        throw new TypeError("Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'.");
    }
    this.childNodes.push(n);
    n.parentNode = this;
    return n;
};
function TextNode(text) {
    this._text = String(text == null ? '' : text);
    this.textContent = this._text;
}
PanelNode.prototype.removeChild = function(n) {
    this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); return n; };
PanelNode.prototype.setAttribute = function(k, v) {
    this.attributes[k] = String(v);
    if (k === 'value') this.value = String(v);   // как в DOM: value-атрибут видно в свойстве
};
PanelNode.prototype.addEventListener = function(ev, fn) { this._onClick = fn; };
PanelNode.prototype.click = function() { if (this._onClick) this._onClick(); };
PanelNode.prototype._all = function(acc) {
    this.childNodes.forEach(function(c) { if (c instanceof PanelNode) { acc.push(c); c._all(acc); } }); return acc; };
PanelNode.prototype.querySelectorAll = function(sel) {
    var cls = sel.replace(/^\./, '');
    return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
PanelNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

// ── 10) init+open: панель получает сводку, дефолтный репозиторий в поле ──
(function() {
    var savedDoc = global.document, savedFetch = global.fetch;
    var panel = new PanelNode('div');
    panel.setAttribute('id', 'repo-update');
    global.document = {
        createElement: function(t) { return new PanelNode(t); },
        createTextNode: function(t) { return new TextNode(t); },
        getElementById: function(id) { return id === 'repo-update' ? panel : null; }
    };
    global.fetch = function(url) {
        var path = String(url);
        var body;
        if (path.indexOf('api.github.com') !== -1 && path.indexOf('/git/trees/') !== -1) {
            // Дерево с ДВУМЯ файлами в download/js: slitter.js и pf-entry.js — оба
            // отличаются от сервера. Слог #4878: при пофайловом сравнении второй
            // файл папки попадал и в «отличаются», и в «только на сервере».
            body = {
                tree: TREE.tree.concat([
                    { path: 'download/atex/js/pf-entry.js', type: 'blob', size: 800 }
                ])
            };
        }
        else if (path.indexOf('object/269') !== -1) body = { object: [], reqs: {} };   // настройки нет — дефолт
        else if (path.indexOf('dir_admin') !== -1) {
            body = '<input name="add_path" type="hidden" value="/js">'
                + '<tr><td></td><td><a href="/ateh/dir_admin/?download=1&add_path=/js&gf=slitter.js">slitter.js</a></td>'
                + '<td align="right"> &nbsp;12.34 KB</td></tr>'
                + '<tr><td></td><td><a href="/ateh/dir_admin/?download=1&add_path=/js&gf=pf-core.js">pf-core.js</a></td>'
                + '<td align="right"> &nbsp;3 KB</td></tr>';
        } else body = {};
        // dir_admin отвечает СЫРЫМ HTML — JSON.stringify здесь ломал парсер:
        // экранированные кавычки прятали add_path и листинг «сходился» всюду (#4878)
        return Promise.resolve({ ok: true, text: function() { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); }, json: function() { return Promise.resolve(body); } });
    };

    mod.init({ db: 'ateh', xsrf: 'x' });
    mod.open();

    Promise.resolve().then(function() {
        return new Promise(function(r) { setTimeout(r, 10); });
    }).then(function() {
        var repoInput = panel.querySelector('.ru-repo');
        assertEqual(repoInput && repoInput.value, 'https://github.com/ideav/crm/',
            '#4876 без настройки GIT в поле — дефолтный репозиторий');
        assertTrue(panel.textContent.indexOf('Сводка по репозиторию') !== -1,
            '#4876 после open() в панели — сводка расхождений (браузерный слой жив)');
        // #4878: «только на сервере» показывается С ПОЛНЫМ путём — голое имя
        // pf-core.js выглядело как тот же файл, что и в «отличаются».
        assertTrue(panel.textContent.indexOf('download/atex/js/pf-core.js') !== -1,
            '#4878 лишний на сервере файл назван с путём папки базы');
        // #4878: файл, изменившийся в папке, НЕ попадает в «только на сервере» —
        // сравнение с листингом идёт ПАПКОЙ, а не по одному файлу.
        assertTrue(panel.textContent.indexOf('только на сервере 1') !== -1,
            '#4878 в «только на сервере» — только посторонний файл, без изменившихся');
        global.document = savedDoc;
        global.fetch = savedFetch;
    });
})();

// ── 11) ОТЧЁТ ПОСЛЕ ОБНОВЛЕНИЯ (#4878) ──────────────────────────────────────────
// По кнопке «Обновить» обязан появляться отчёт: что залито, что с ошибками и по
// какой причине. «Непонятно что произошло» — тикет #4878. Секция стартует после
// секции 10 (у модуля один ctx — синглтон, сценарии не должны интерливиться).
setTimeout(function() {
    var savedDoc = global.document, savedFetch = global.fetch;
    var panel = new PanelNode('div');
    panel.setAttribute('id', 'repo-update');
    global.document = {
        createElement: function(t) { return new PanelNode(t); },
        createTextNode: function(t) { return new TextNode(t); },
        getElementById: function(id) { return id === 'repo-update' ? panel : null; }
    };
    var posted = [];
    global.fetch = function(url, opts) {
        var path = String(url);
        if (path.indexOf('raw.githubusercontent.com') !== -1) {
            return Promise.resolve({ ok: true, text: function() { return Promise.resolve('// fresh build'); } });
        }
        if (path.indexOf('dir_admin') !== -1 && opts && opts.method === 'POST') {
            posted.push(path);
            var fail = path.indexOf('templates') !== -1;   // шаблон — отказ в правах
            return Promise.resolve({
                ok: !fail, redirected: !fail,
                text: function() { return Promise.resolve(fail ? 'Недостаточно прав для загрузки файлов' : ''); }
            });
        }
        if (path.indexOf('api.github.com') !== -1 && path.indexOf('/git/trees/') !== -1) {
            return Promise.resolve({ ok: true, json: function() { return Promise.resolve(TREE); } });
        }
        if (path.indexOf('object/269') !== -1) {
            return Promise.resolve({ ok: true, text: function() { return Promise.resolve(JSON.stringify({ object: [], reqs: {} })); } });
        }
        if (path.indexOf('dir_admin') !== -1) {
            return Promise.resolve({ ok: true, text: function() {
                return Promise.resolve('<input name="add_path" type="hidden" value="/js">'
                    + '<tr><td></td><td><a href="/ateh/dir_admin/?download=1&add_path=/js&gf=slitter.js">slitter.js</a></td>'
                    + '<td align="right"> &nbsp;12.34 KB</td></tr>');
            } });
        }
        return Promise.resolve({ ok: true, text: function() { return Promise.resolve('{}'); }, json: function() { return Promise.resolve({}); } });
    };

    mod.init({ db: 'ateh', xsrf: 'x' });
    mod.open();
    Promise.resolve().then(function() { return new Promise(function(r) { setTimeout(r, 10); }); }).then(function() {
        assertTrue(typeof mod.run === 'function', '#4878 у пульта есть запуск обновления (mod.run)');
        assertTrue(posted.length === 0, '#4878 до запуска обновления в менеджер ничего не льётся');
        return mod.run();
    }).then(function() {
        return new Promise(function(r) { setTimeout(r, 10); });
    }).then(function() {
        var report = panel.querySelector('.ru-report');
        assertTrue(!!report, '#4878 после обновления в панели — блок отчёта');
        assertTrue(report.textContent.indexOf('Отчёт об обновлении') !== -1,
            '#4878 отчёт назван отчётом');
        assertTrue(report.textContent.indexOf('Залито: 3 из 5') !== -1,
            '#4878 в отчёте — сколько файлов залито из плана');
        assertTrue(report.textContent.indexOf('С ошибками: 2.') !== -1,
            '#4878 в отчёте — сколько файлов с ошибками');
        assertTrue(report.textContent.indexOf('нет прав на запись файлов') !== -1,
            '#4878 причина ошибки названа словами сервера');
        assertTrue(posted.length === 5, '#4878 попытка заливки была для каждого файла плана');
        console.log('');
        console.log(passed + '/' + total + ' passed');
        if (process.exitCode) process.exit(process.exitCode);
    });
}, 60);
