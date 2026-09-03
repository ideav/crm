// #4874 — «Обновление из репозитория» в dir_admin: сводная расхождений и заливка файлов.
//
// Логика живёт в js/repo-update.js (глобальный ассет — js/* деплоится во все базы,
// dir_admin.html один на все базы). Здесь проверяется ЧИСТЫЙ слой: разбор адреса
// репозитория, выбор папок базы в дереве репозитория, разбор листинга файлового
// менеджера, расхождение по размерам и план заливки.
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
// У базы ateh папки в репо называются atex (маппинг update.conf), у остальных —
// имя базы. Кандидаты: {db}, затем псевдоним atex.
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
    + '<!-- Begin:&File_list -->'
    + '<tr><td><input type="checkbox"  id="cheks" name="del[]" value="app.js"></td>'
    + '<td style="vertical-align:middle;">&nbsp;<a href="/ateh/dir_admin/?download=1&add_path=/js&gf=app.js">app.js</a>&nbsp;</td>'
    + '<td style="padding:2px;">&nbsp;<a href="#">иконки</a></td>'
    + '<td align="right"> &nbsp;12.34 KB</td>'
    + '<td align="left"> &nbsp;03.09.2026 10:00:00</td></tr>'
    + '<!-- End:&File_list -->'
    + '<!-- Begin:&File_list -->'
    + '<tr><td><input type="checkbox"  id="cheks" name="del[]" value="readme.txt"></td>'
    + '<td style="vertical-align:middle;">&nbsp;<a href="/ateh/dir_admin/?download=1&add_path=/&gf=readme.txt">readme.txt</a>&nbsp;</td>'
    + '<td style="padding:2px;">&nbsp;<a href="#">иконки</a></td>'
    + '<td align="right"> &nbsp;512 B</td>'
    + '<td align="left"> &nbsp;03.09.2026 10:00:00</td></tr>'
    + '<!-- End:&File_list -->'
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
// added — в репозитории есть, на сервере нет; changed — есть на обоих, размеры разные;
// same — размеры совпали; extra — на сервере лишнее (только информация, не удаляем).
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

console.log('\n' + passed + '/' + total + ' passed');
if (process.exitCode) process.exit(process.exitCode);
